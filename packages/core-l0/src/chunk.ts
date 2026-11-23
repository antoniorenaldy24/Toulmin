/**
 * Deterministic evidence chunking, `chunkId` / `evidenceVersion` identity hashing,
 * PDF reconstruction/dehyphenation, JATS XML extraction, physical row formatting,
 * and unit shaping (`docs/spec/02_L0_TIER_A_PRE_DECODE.md` §8.7, `01` §3.2).
 *
 * Pure Tier A L0 module: zero Node I/O, Firebase, DOM, network, clock, or regex usage.
 */

import { type Bm25Query, type EvidenceSourceKind, tokBM25 } from "./bm25.js";
import { extractWordSpans, countWords } from "./citations.js";
import { type PreMaskResult } from "./mask.js";
import {
  codePointAtSafe,
  isBaseLetter,
  isDigit,
  isLetter,
  isLower,
  isSpace,
  norm,
  normLower,
  sha256hex,
  utf8Encode,
} from "./norm.js";
import { formatCanonicalDecimal, parseFiniteNumberAt } from "./numberParser.js";
import { BM25_STOPWORDS, porterStem } from "./porter.js";
import { extractQuantities } from "./quantity.js";
import { scanSuffixUnitFast } from "./units.js";
import {
  SectionTracker,
  createEmptyImportQualityReport,
  matchCanonicalSectionLabel,
  stripLeadingSectionNumbering,
  trimSpace,
  type CanonicalSectionLabel,
} from "./sections.js";
import { segmentDocument } from "./segment.js";
import { WORDLIST_EN_FRONT_CODED } from "./wordlist_en.generated.js";

export const NEIGHBOUR_EXTENSION_MAX_WORDS = 12;
export const WINDOW_SHAPING_MAX_WORDS = 60;
export const PDF_HIDDEN_FONT_HEIGHT_MIN = 2;
export const PDF_HEADING_MAX_WORDS = 8;
export const PDF_REFERENCES_CUT_RATIO = 0.6;
export const PDF_COLUMN_GAP_RATIO = 0.15;
export const PDF_LINE_BASELINE_TOLERANCE_FACTOR = 0.5;
export const PDF_SUBSUP_MAX_HEIGHT_RATIO = 0.8;
export const PDF_SUBSUP_MIN_OFFSET_EM = 0.2;
export const PDF_SUBSUP_MAX_OFFSET_EM = 0.6;
export const PDF_WORD_GAP_FACTOR = 0.15;
export const PDF_RUNNING_HF_MIN_PAGES = 3;
export const PDF_RUNNING_HF_PAGE_RATIO = 0.5;
export const PDF_MIN_LINE_ALPHA_CHARS = 3;
export const PDF_HIDDEN_TEXT_MIN_ALPHA_WORDS = 4;

export interface EvidenceUnit {
  readonly chunkId: string;
  readonly sourceKind: EvidenceSourceKind;
  readonly section: string;
  readonly text: string;
  readonly ordinal: number;
}

export interface ShapedWindowResult {
  readonly text: string;
  readonly span: { readonly start: number; readonly end: number };
  readonly wordCount: number;
  readonly matchCount: number;
  readonly startWordIndex: number;
}

export interface ChunkAbstractOptions {
  readonly applyNeighbourExtension?: boolean;
}

export interface PdfTextItem {
  readonly str: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly renderMode?: number;
  readonly fillColor?: string;
}

export interface PdfPageInput {
  readonly pageNumber?: number;
  readonly width: number;
  readonly height: number;
  readonly viewBox?: readonly [number, number, number, number];
  readonly backgroundColor?: string;
  readonly items: readonly PdfTextItem[];
}

export interface ChunkPdfOptions {
  readonly sourceKind?: "FULLTEXT" | "USER_PDF";
  readonly yDirection?: "bottom-up" | "top-down";
  /** Spike `S-W5` flag (`02` §8.7 step 7): defaults to `false` until resolved. */
  readonly spike_s_w5_primary?: boolean;
  readonly applyNeighbourExtension?: boolean;
}

export interface PdfHiddenItemRecord {
  readonly pageNumber: number;
  readonly text: string;
  readonly reason: "FONT_TOO_SMALL" | "OUT_OF_VIEW_BOX" | "RENDER_MODE_INVISIBLE" | "BACKGROUND_FILL";
}

export interface ChunkPdfResult {
  readonly units: readonly EvidenceUnit[];
  readonly hiddenTextPages: readonly number[];
  readonly hiddenItems: readonly PdfHiddenItemRecord[];
  readonly pageTexts: readonly string[];
}

export interface OrderedXmlNode {
  readonly [tagOrSpecial: string]: unknown;
  readonly ":@"?: Readonly<Record<string, unknown>>;
}

export interface ChunkJatsOptions {
  readonly sourceKind?: "FULLTEXT" | "USER_PDF";
  readonly applyNeighbourExtension?: boolean;
}

export interface ChunkJatsResult {
  readonly units: readonly EvidenceUnit[];
  readonly doi: string | null;
}

export interface SelectRowCellInput {
  readonly header: string;
  readonly upperHeader?: string;
  readonly cell: string;
}

const PDF_HEADING_KEYWORDS: ReadonlySet<string> = new Set([
  "abstract",
  "introduction",
  "background",
  "methods",
  "method",
  "materials and methods",
  "results",
  "discussion",
  "conclusion",
  "conclusions",
  "limitations",
  "references",
  "acknowledgements",
  "acknowledgments",
]);

const XML_BLOCK_TAGS: ReadonlySet<string> = new Set([
  "abstract",
  "blockquote",
  "br",
  "caption",
  "div",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "li",
  "list-item",
  "p",
  "sec",
  "td",
  "th",
  "title",
  "tr",
]);

const JATS_SKIP_TAGS: ReadonlySet<string> = new Set([
  "aff",
  "article-categories",
  "article-title",
  "contrib-group",
  "counts",
  "elocation-id",
  "fn-group",
  "fpage",
  "funding-group",
  "history",
  "issn",
  "issue",
  "journal-meta",
  "kwd-group",
  "lpage",
  "permissions",
  "pub-date",
  "publisher",
  "ref-list",
  "title-group",
  "volume",
]);

const NAMED_XML_ENTITIES: ReadonlyMap<string, string> = new Map([
  ["amp", "&"],
  ["AMP", "&"],
  ["lt", "<"],
  ["LT", "<"],
  ["gt", ">"],
  ["GT", ">"],
  ["quot", '"'],
  ["QUOT", '"'],
  ["apos", "'"],
  ["nbsp", " "],
  ["NBSP", " "],
  ["ensp", " "],
  ["emsp", " "],
  ["thinsp", "\u2009"],
  ["ndash", "\u2013"],
  ["mdash", "\u2014"],
  ["minus", "\u2212"],
  ["plusmn", "\u00b1"],
  ["times", "\u00d7"],
  ["divide", "\u00f7"],
  ["le", "\u2264"],
  ["ge", "\u2265"],
  ["ne", "\u2260"],
  ["approx", "\u2248"],
  ["asymp", "\u2248"],
  ["permil", "\u2030"],
  ["micro", "\u03bc"],
  ["Alpha", "\u0391"],
  ["Beta", "\u0392"],
  ["Gamma", "\u0393"],
  ["Delta", "\u0394"],
  ["Epsilon", "\u0395"],
  ["Zeta", "\u0396"],
  ["Eta", "\u0397"],
  ["Theta", "\u0398"],
  ["Iota", "\u0399"],
  ["Kappa", "\u039a"],
  ["Lambda", "\u039b"],
  ["Mu", "\u039c"],
  ["Nu", "\u039d"],
  ["Xi", "\u039e"],
  ["Omicron", "\u039f"],
  ["Pi", "\u03a0"],
  ["Rho", "\u03a1"],
  ["Sigma", "\u03a3"],
  ["Tau", "\u03a4"],
  ["Upsilon", "\u03a5"],
  ["Phi", "\u03a6"],
  ["Chi", "\u03a7"],
  ["Psi", "\u03a8"],
  ["Omega", "\u03a9"],
  ["alpha", "\u03b1"],
  ["beta", "\u03b2"],
  ["gamma", "\u03b3"],
  ["delta", "\u03b4"],
  ["epsilon", "\u03b5"],
  ["zeta", "\u03b6"],
  ["eta", "\u03b7"],
  ["theta", "\u03b8"],
  ["iota", "\u03b9"],
  ["kappa", "\u03ba"],
  ["lambda", "\u03bb"],
  ["mu", "\u03bc"],
  ["nu", "\u03bd"],
  ["xi", "\u03be"],
  ["omicron", "\u03bf"],
  ["pi", "\u03c0"],
  ["rho", "\u03c1"],
  ["sigmaf", "\u03c2"],
  ["sigma", "\u03c3"],
  ["tau", "\u03c4"],
  ["upsilon", "\u03c5"],
  ["phi", "\u03c6"],
  ["chi", "\u03c7"],
  ["psi", "\u03c8"],
  ["omega", "\u03c9"],
  ["deg", "\u00b0"],
  ["hellip", "\u2026"],
  ["lsquo", "\u2018"],
  ["rsquo", "\u2019"],
  ["ldquo", "\u201c"],
  ["rdquo", "\u201d"],
  ["middot", "\u00b7"],
  ["bull", "\u2022"],
  ["copy", "\u00a9"],
  ["COPY", "\u00a9"],
  ["reg", "\u00ae"],
  ["REG", "\u00ae"],
  ["trade", "\u2122"],
  ["TRADE", "\u2122"],
]);

let cachedWordlistArray: readonly string[] | null = null;
let cachedWordlistSet: ReadonlySet<string> | null = null;
let cachedWordlistText: string | null = null;

function decodeWordlistOnce(): readonly string[] {
  if (cachedWordlistArray !== null) {
    return cachedWordlistArray;
  }
  const packed = WORDLIST_EN_FRONT_CODED;
  const words: string[] = [];
  let prev = "";
  let i = 0;
  const n = packed.length;
  while (i < n) {
    const comma = packed.indexOf(",", i);
    const end = comma === -1 ? n : comma;
    if (end > i) {
      const codeChar = packed.charCodeAt(i);
      const shared =
        codeChar >= 48 && codeChar <= 57
          ? codeChar - 48
          : codeChar >= 97 && codeChar <= 122
            ? codeChar - 97 + 10
            : 0;
      const word = prev.slice(0, shared) + packed.slice(i + 1, end);
      words.push(word);
      prev = word;
    }
    i = comma === -1 ? n : comma + 1;
  }
  cachedWordlistArray = words;
  return words;
}

/**
 * Returns the bundled 50,000-word English dictionary (`packages/core-l0/wordlist_en.txt`)
 * decoded lazily with zero Node/FS I/O.
 */
export function getWordlistEnSet(): ReadonlySet<string> {
  if (cachedWordlistSet === null) {
    cachedWordlistSet = new Set<string>(decodeWordlistOnce());
  }
  return cachedWordlistSet;
}

/**
 * Returns the exact `\n`-terminated text representation of `wordlist_en.txt`.
 */
export function getWordlistEnText(): string {
  if (cachedWordlistText === null) {
    cachedWordlistText = decodeWordlistOnce().join("\n") + "\n";
  }
  return cachedWordlistText;
}

/**
 * Checks whether `word` (after `normLower`) is present in `wordlist_en.txt`.
 */
export function isInWordlistEn(word: string): boolean {
  if (word.length === 0) {
    return false;
  }
  return getWordlistEnSet().has(normLower(word));
}

function asciiLower(s: string): string {
  let out = "";
  let changed = false;
  for (let i = 0; i < s.length; i++) {
    const cu = s.charCodeAt(i);
    if (cu >= 65 && cu <= 90) {
      if (!changed) {
        out = s.slice(0, i);
        changed = true;
      }
      out += String.fromCharCode(cu + 32);
    } else if (changed) {
      out += s.charAt(i);
    }
  }
  return changed ? out : s;
}

function isAsciiLetterCode(cu: number): boolean {
  return (cu >= 65 && cu <= 90) || (cu >= 97 && cu <= 122);
}

function isAsciiTagNameChar(cu: number): boolean {
  return (
    isAsciiLetterCode(cu) ||
    (cu >= 48 && cu <= 57) ||
    cu === 45 || // '-'
    cu === 95 || // '_'
    cu === 58 || // ':'
    cu === 46 // '.'
  );
}

function collapseAsciiSpacesAndTrim(text: string): string {
  const n = text.length;
  const parts: string[] = [];
  let inSpace = true;
  let segStart = -1;

  for (let i = 0; i < n; i++) {
    const cu = text.charCodeAt(i);
    const sp = cu === 32 || cu === 9 || cu === 10 || cu === 13;
    if (sp) {
      if (!inSpace) {
        if (segStart !== -1) {
          parts.push(text.slice(segStart, i));
          segStart = -1;
        }
        parts.push(" ");
        inSpace = true;
      }
    } else {
      if (inSpace) {
        segStart = i;
        inSpace = false;
      }
    }
  }
  if (!inSpace && segStart !== -1) {
    parts.push(text.slice(segStart));
  }
  if (parts.length > 0 && parts[parts.length - 1] === " ") {
    parts.pop();
  }
  return parts.join("");
}

/**
 * Computes `chunkId` (`02` §8.7):
 * `sha256hex(refId + "|" + kind + "|" + section + "|" + ordinal + "|" + sha256hex(text).slice(0, 8)).slice(0, 24)`.
 */
export function computeChunkId(
  refId: string,
  kind: EvidenceSourceKind,
  section: string,
  ordinal: number,
  text: string,
): string {
  const contentHash = sha256hex(text).slice(0, 8);
  return sha256hex(`${refId}|${kind}|${section}|${ordinal}|${contentHash}`).slice(0, 24);
}

/**
 * Computes `evidenceVersion` (`01` §3.2):
 * `sha256hex(join("|", sort(chunkIds)))`, sorted lexicographically by UTF-8 bytes.
 */
export function computeEvidenceVersion(chunkIds: readonly string[]): string {
  const items = chunkIds.map((id) => ({ id, bytes: utf8Encode(id) }));
  items.sort((a, b) => {
    const len = Math.min(a.bytes.length, b.bytes.length);
    for (let i = 0; i < len; i++) {
      const diff = a.bytes[i]! - b.bytes[i]!;
      if (diff !== 0) {
        return diff;
      }
    }
    return a.bytes.length - b.bytes.length;
  });
  return sha256hex(items.map((x) => x.id).join("|"));
}

/**
 * Decodes named XML/HTML/JATS character entities and numeric character references (`&#...;`, `&#x...;`).
 */
export function decodeXmlEntities(text: string): string {
  if (!text.includes("&")) {
    return text;
  }
  const parts: string[] = [];
  const n = text.length;
  let i = 0;
  let segStart = 0;

  while (i < n) {
    const amp = text.indexOf("&", i);
    if (amp === -1) {
      break;
    }
    const semiLimit = Math.min(n, amp + 18);
    let semi = -1;
    for (let j = amp + 1; j < semiLimit; j++) {
      const cu = text.charCodeAt(j);
      if (cu === 59 /* ';' */) {
        semi = j;
        break;
      }
      if (cu === 38 /* '&' */ || cu === 60 /* '<' */ || isSpace(cu)) {
        break;
      }
    }
    if (semi === -1) {
      i = amp + 1;
      continue;
    }
    const body = text.slice(amp + 1, semi);
    let decoded: string | null = null;
    if (body.length > 0 && body.charCodeAt(0) === 35 /* '#' */) {
      let cp = -1;
      if (body.length > 1 && (body.charCodeAt(1) === 120 || body.charCodeAt(1) === 88)) {
        const hexStr = body.slice(2);
        if (hexStr.length > 0) {
          let validHex = true;
          let acc = 0;
          for (let k = 0; k < hexStr.length; k++) {
            const c = hexStr.charCodeAt(k);
            let d = -1;
            if (c >= 48 && c <= 57) d = c - 48;
            else if (c >= 97 && c <= 102) d = c - 97 + 10;
            else if (c >= 65 && c <= 70) d = c - 65 + 10;
            if (d === -1) {
              validHex = false;
              break;
            }
            acc = acc * 16 + d;
          }
          if (validHex) {
            cp = acc;
          }
        }
      } else {
        const decStr = body.slice(1);
        if (decStr.length > 0) {
          let validDec = true;
          let acc = 0;
          for (let k = 0; k < decStr.length; k++) {
            const c = decStr.charCodeAt(k);
            if (c < 48 || c > 57) {
              validDec = false;
              break;
            }
            acc = acc * 10 + (c - 48);
          }
          if (validDec) {
            cp = acc;
          }
        }
      }
      if (cp >= 0x09 && cp <= 0x10ffff && (cp < 0xd800 || cp > 0xdfff)) {
        decoded = String.fromCodePoint(cp);
      }
    } else {
      decoded = NAMED_XML_ENTITIES.get(body) ?? null;
    }

    if (decoded !== null) {
      if (amp > segStart) {
        parts.push(text.slice(segStart, amp));
      }
      parts.push(decoded);
      i = semi + 1;
      segStart = i;
    } else {
      i = amp + 1;
    }
  }

  if (segStart === 0) {
    return text;
  }
  if (segStart < n) {
    parts.push(text.slice(segStart));
  }
  return parts.join("");
}

function stripNamespacePrefix(tagName: string): string {
  const colon = tagName.indexOf(":");
  return colon !== -1 ? tagName.slice(colon + 1) : tagName;
}

function findTagCloseOutsideQuotes(input: string, startAfterLt: number): number {
  const n = input.length;
  let quote = 0;
  for (let i = startAfterLt; i < n; i++) {
    const c = input.charCodeAt(i);
    if (quote !== 0) {
      if (c === quote) {
        quote = 0;
      }
    } else if (c === 34 /* '"' */ || c === 39 /* "'" */) {
      quote = c;
    } else if (c === 62 /* '>' */) {
      return i;
    } else if (c === 60 /* '<' */) {
      // Unquoted `<` terminates malformed/unclosed tag scan in O(1) amortized steps.
      return -1;
    }
  }
  return -1;
}

/**
 * Strips JATS and HTML tags in O(n) time without eating literal `<` comparisons (`p < 0.05`),
 * preserves space boundaries on block elements, decodes character entities, and collapses spaces.
 */
export function stripJatsAndHtmlTags(raw: string): string {
  if (raw.length === 0) {
    return "";
  }
  const n = raw.length;
  const parts: string[] = [];
  let cursor = 0;
  let i = 0;
  let noMoreCommentClose = false;
  let noMoreCdataClose = false;
  let noMoreBangClose = false;
  let noMorePiClose = false;

  while (i < n) {
    const lt = raw.indexOf("<", i);
    if (lt === -1) {
      break;
    }
    if (lt + 1 >= n) {
      break;
    }
    const next = raw.charCodeAt(lt + 1);

    // Comment or CDATA / DOCTYPE
    if (next === 33 /* '!' */) {
      if (raw.startsWith("<!--", lt)) {
        const closeComment = noMoreCommentClose ? -1 : raw.indexOf("-->", lt + 4);
        if (closeComment !== -1) {
          if (lt > cursor) parts.push(raw.slice(cursor, lt));
          cursor = closeComment + 3;
          i = cursor;
          continue;
        }
        noMoreCommentClose = true;
      } else if (raw.startsWith("<![CDATA[", lt)) {
        const closeCdata = noMoreCdataClose ? -1 : raw.indexOf("]]>", lt + 9);
        if (closeCdata !== -1) {
          if (lt > cursor) parts.push(raw.slice(cursor, lt));
          parts.push(raw.slice(lt + 9, closeCdata));
          cursor = closeCdata + 3;
          i = cursor;
          continue;
        }
        noMoreCdataClose = true;
      } else {
        const closeBang = noMoreBangClose ? -1 : raw.indexOf(">", lt + 2);
        if (closeBang !== -1) {
          if (lt > cursor) parts.push(raw.slice(cursor, lt));
          cursor = closeBang + 1;
          i = cursor;
          continue;
        }
        noMoreBangClose = true;
      }
      i = lt + 1;
      continue;
    }

    // Processing instruction <?...?>
    if (next === 63 /* '?' */) {
      const closePi = noMorePiClose ? -1 : raw.indexOf("?>", lt + 2);
      if (closePi !== -1) {
        if (lt > cursor) parts.push(raw.slice(cursor, lt));
        cursor = closePi + 2;
        i = cursor;
        continue;
      }
      noMorePiClose = true;
      i = lt + 1;
      continue;
    }

    // Element open/close/self-closing tag (`<letter...>` or `</letter...>`)
    let nameStart = lt + 1;
    if (next === 47 /* '/' */) {
      nameStart = lt + 2;
    }
    if (nameStart >= n || !isAsciiLetterCode(raw.charCodeAt(nameStart))) {
      i = lt + 1;
      continue;
    }
    let nameEnd = nameStart + 1;
    while (nameEnd < n && isAsciiTagNameChar(raw.charCodeAt(nameEnd))) {
      nameEnd++;
    }
    // Validate separator after tag name (space, '>', or '/')
    if (
      nameEnd >= n ||
      (raw.charCodeAt(nameEnd) !== 62 &&
        raw.charCodeAt(nameEnd) !== 47 &&
        !isSpace(raw.charCodeAt(nameEnd)))
    ) {
      i = lt + 1;
      continue;
    }
    const closeTag = findTagCloseOutsideQuotes(raw, nameEnd);
    if (closeTag === -1) {
      i = lt + 1;
      continue;
    }

    if (lt > cursor) {
      parts.push(raw.slice(cursor, lt));
    }
    const localName = asciiLower(stripNamespacePrefix(raw.slice(nameStart, nameEnd)));
    if (XML_BLOCK_TAGS.has(localName)) {
      parts.push(" ");
    }
    cursor = closeTag + 1;
    i = cursor;
  }

  if (cursor < n) {
    parts.push(raw.slice(cursor));
  }
  return collapseAsciiSpacesAndTrim(decodeXmlEntities(parts.join("")));
}

function createNoMaskPreMaskResult(normedText: string): PreMaskResult {
  return {
    format: "md",
    maskedText: normedText,
    regions: [],
    blockRegions: [],
    mathRegions: [],
    proseStreams: [],
    tables: [],
    bibItems: [],
    sectionTransitions: [],
    listItemStarts: [],
    userMacros: new Map(),
    customCiteMacros: new Set(),
    frontMatter: {},
    report: createEmptyImportQualityReport(),
  };
}

/**
 * Segments already-cleaned prose strictly using §4 with zero math masking (`02` §8.7).
 */
function segmentPlainSectionText(text: string): string[] {
  const normed = trimSpace(norm(text).text);
  if (normed.length === 0) {
    return [];
  }
  const res = segmentDocument(normed, "md", {
    preMaskResult: createNoMaskPreMaskResult(normed),
  });
  const out: string[] = [];
  for (let i = 0; i < res.sentences.length; i++) {
    const sent = trimSpace(res.sentences[i]!.rawText);
    if (sent.length > 0) {
      out.push(sent);
    }
  }
  return out;
}

/**
 * Neighbour extension (`02` §8.7):
 * A unit of `<= 12` words is extended with the previous and the next unextended unit
 * of the same section, joined by one space.
 */
export function applyNeighbourExtension(texts: readonly string[]): string[] {
  const len = texts.length;
  const out = new Array<string>(len);
  for (let i = 0; i < len; i++) {
    const cur = texts[i]!;
    if (countWords(cur) <= NEIGHBOUR_EXTENSION_MAX_WORDS) {
      const pieces: string[] = [];
      if (i > 0) pieces.push(texts[i - 1]!);
      pieces.push(cur);
      if (i + 1 < len) pieces.push(texts[i + 1]!);
      out[i] = pieces.join(" ");
    } else {
      out[i] = cur;
    }
  }
  return out;
}

function normalizeQueryTermSet(
  query: Bm25Query | readonly string[] | ReadonlySet<string> | string,
): ReadonlySet<string> {
  if (typeof query === "string") {
    return new Set(tokBM25(query));
  }
  if (Array.isArray(query)) {
    return new Set(query);
  }
  if (query instanceof Set) {
    return query;
  }
  return new Set((query as Bm25Query).terms);
}

function isPureAsciiLetters(s: string): boolean {
  if (s.length === 0) return false;
  for (let i = 0; i < s.length; i++) {
    if (!isAsciiLetterCode(s.charCodeAt(i))) {
      return false;
    }
  }
  return true;
}

interface SurfaceWordSpan {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

function extractSurfaceWordSpans(text: string): SurfaceWordSpan[] {
  const spans: SurfaceWordSpan[] = [];
  const n = text.length;
  let inToken = false;
  let tokenStart = 0;
  let tokenHasAlnum = false;
  let i = 0;

  while (i < n) {
    const u = codePointAtSafe(text, i);
    const sp = !u.isUnpairedSurrogate && isSpace(u.cp);
    if (sp) {
      if (inToken) {
        if (tokenHasAlnum) {
          spans.push({ text: text.slice(tokenStart, i), start: tokenStart, end: i });
        }
        inToken = false;
        tokenHasAlnum = false;
      }
    } else {
      if (!inToken) {
        inToken = true;
        tokenStart = i;
      }
      if (!tokenHasAlnum && !u.isUnpairedSurrogate && (isBaseLetter(u.cp) || isDigit(u.cp))) {
        tokenHasAlnum = true;
      }
    }
    i += u.len;
  }

  if (inToken && tokenHasAlnum) {
    spans.push({ text: text.slice(tokenStart, n), start: tokenStart, end: n });
  }
  return spans;
}

function isRangeValueRawForWindow(valueRaw: string): boolean {
  const lower = normLower(valueRaw);
  if (lower.includes(" to ") || lower.includes(" and ") || lower.includes(", ")) {
    return true;
  }
  let braceDepth = 0;
  for (let i = 0; i < lower.length; i++) {
    const ch = lower.charCodeAt(i);
    if (ch === 123 /* '{' */ && i > 0 && lower.charCodeAt(i - 1) === 94 /* '^' */) {
      braceDepth++;
      continue;
    }
    if (braceDepth > 0) {
      if (ch === 123 /* '{' */) {
        braceDepth++;
      } else if (ch === 125 /* '}' */) {
        braceDepth--;
      }
      continue;
    }
    if (ch === 45 /* '-' */ && i > 0) {
      const prev = lower.charCodeAt(i - 1);
      if (prev !== 101 /* 'e' */ && prev !== 94 /* '^' */) {
        return true;
      }
    }
  }
  return false;
}

function emitBm25NumericTokensForWindowTuple(
  text: string,
  qt: ReturnType<typeof extractQuantities>[number],
): string[] {
  if (qt.valueNorm === null || !Number.isFinite(qt.valueNorm)) {
    return [];
  }
  const suffix = qt.unitCanon === "%" ? "%" : "";
  const fmt = (v: number): string => `#${formatCanonicalDecimal(v)}${suffix}`;
  const lo = qt.valueLo;
  const hi = qt.valueHi;
  if (lo !== null && hi !== null && Number.isFinite(lo) && Number.isFinite(hi)) {
    if (isRangeValueRawForWindow(qt.valueRaw)) {
      return [fmt(lo), fmt(hi)];
    }
    if (lo !== hi) {
      const spanSlice = text.slice(qt.span.start, qt.span.end);
      if (spanSlice.includes("\u00b1") || spanSlice.includes("+/-")) {
        return [fmt(qt.valueNorm)];
      }
      return [fmt(qt.valueNorm), fmt(lo), fmt(hi)];
    }
  }
  return [fmt(qt.valueNorm)];
}

const EMPTY_NORM_MAP: readonly number[] = [];

function matchAsciiWordToken(wordText: string, queryTerms: ReadonlySet<string>): boolean {
  if (isPureAsciiLetters(wordText)) {
    const lower = asciiLower(wordText);
    return !BM25_STOPWORDS.has(lower) && queryTerms.has(porterStem(lower));
  }
  return matchesQueryWordToken(wordText, queryTerms);
}

/**
 * Linear-time fast path for clean ASCII `<leading-finite-number><letter-tail>` surface tokens
 * (e.g. `"30mg"`, `"20mg"`, `"30percent"`, `"5.2mg/dL"`), preserving exact `tokBM25` Rule 8 masking
 * without paying per-token `extractQuantities` / SHA-256 overhead. Returns the unmasked tail or
 * `null` when full `tokBM25` inspection is needed.
 */
function tryStripSimpleLeadingAsciiNumber(wordText: string): string | null {
  const n = wordText.length;
  if (n < 2) {
    return null;
  }
  const c0 = wordText.charCodeAt(0);
  if (c0 < 48 || c0 > 57) {
    return null;
  }
  for (let i = 1; i < n; i++) {
    if (wordText.charCodeAt(i) >= 0x80) {
      return null;
    }
  }
  const num = parseFiniteNumberAt(wordText, wordText, EMPTY_NORM_MAP, 0, true, true);
  if (num === null || num.endNorm <= 0 || num.endNorm >= n) {
    return null;
  }
  const tailStart = num.endNorm;
  const cAfter = wordText.charCodeAt(tailStart);
  const isAlpha = (cAfter >= 65 && cAfter <= 90) || (cAfter >= 97 && cAfter <= 122);
  if (!isAlpha) {
    return null;
  }
  // Defer e/E/x/X suffixes so scientific-notation / multiplication edges go through full tokBM25.
  if (cAfter === 101 || cAfter === 69 || cAfter === 120 || cAfter === 88) {
    return null;
  }
  for (let i = tailStart; i < n; i++) {
    const ch = wordText.charCodeAt(i);
    if (
      (ch >= 48 && ch <= 57) ||
      ch === 36 || // '$'
      ch === 96 || // '`'
      ch === 92 || // '\'
      ch === 37 // '%'
    ) {
      return null;
    }
  }
  if (wordText.includes("<!--") || wordText.includes("---")) {
    return null;
  }
  if (num.isYearIntCandidate) {
    const lowerWord = asciiLower(wordText);
    const suf = scanSuffixUnitFast(wordText, lowerWord, tailStart, false, true);
    if (suf === null) {
      return null;
    }
  }
  return wordText.slice(tailStart);
}

function classifySurfaceWordToken(wordText: string): {
  readonly hasPotentialLetter: boolean;
  readonly needsBm25Fallback: boolean;
} {
  const n = wordText.length;
  let hasPotentialLetter = false;
  let hasBoundaryNumTrigger = false;
  let dollarCount = 0;
  let backtickCount = 0;
  let hasBackslash = false;
  let hasPct = false;
  let prevIsAsciiAlnum = false;

  for (let i = 0; i < n; ) {
    const cu = wordText.charCodeAt(i);
    if (cu < 0x80) {
      if ((cu >= 65 && cu <= 90) || (cu >= 97 && cu <= 122)) {
        hasPotentialLetter = true;
        prevIsAsciiAlnum = true;
      } else if (cu >= 48 && cu <= 57) {
        if (!prevIsAsciiAlnum) {
          hasBoundaryNumTrigger = true;
        }
        prevIsAsciiAlnum = true;
      } else {
        prevIsAsciiAlnum = false;
        if (cu === 36 /* '$' */) {
          dollarCount++;
        } else if (cu === 96 /* '`' */) {
          backtickCount++;
        } else if (cu === 92 /* '\\' */) {
          hasBackslash = true;
        } else if (cu === 37 /* '%' */) {
          hasPct = true;
        }
      }
      i++;
      continue;
    }

    const u = codePointAtSafe(wordText, i);
    const cp = u.cp;
    if (!u.isUnpairedSurrogate) {
      if (
        isDigit(cp) ||
        cp === 0x00b2 ||
        cp === 0x00b3 ||
        cp === 0x00b9 ||
        (cp >= 0x2070 && cp <= 0x2079) ||
        (cp >= 0xff10 && cp <= 0xff19) ||
        (cp >= 0xe000 && cp <= 0xf8ff)
      ) {
        hasBoundaryNumTrigger = true;
      }
      if (isBaseLetter(cp) || (cp >= 0xe000 && cp <= 0xf8ff) || (cp >= 0x24b6 && cp <= 0x24e9)) {
        hasPotentialLetter = true;
      }
      if (cp === 0x27e6) {
        return { hasPotentialLetter: true, needsBm25Fallback: true };
      }
    }
    prevIsAsciiAlnum = false;
    i += u.len;
  }

  if (!hasPotentialLetter) {
    return { hasPotentialLetter: false, needsBm25Fallback: false };
  }

  const hasMaskTrigger =
    dollarCount >= 2 ||
    backtickCount >= 2 ||
    hasPct ||
    (hasBackslash &&
      (wordText.includes("\\(") ||
        wordText.includes("\\[") ||
        wordText.includes("\\begin{") ||
        wordText.includes("\\section") ||
        wordText.includes("\\documentclass") ||
        wordText.includes("\\footnote"))) ||
    wordText.includes("<!--") ||
    wordText.includes("---");

  return {
    hasPotentialLetter: true,
    needsBm25Fallback: hasBoundaryNumTrigger || hasMaskTrigger,
  };
}

function matchesQueryWordToken(wordText: string, queryTerms: ReadonlySet<string>): boolean {
  const n = wordText.length;
  let allAscii = true;
  for (let i = 0; i < n; i++) {
    if (wordText.charCodeAt(i) >= 0x80) {
      allAscii = false;
      break;
    }
  }

  if (allAscii) {
    let i = 0;
    while (i < n) {
      const cu = wordText.charCodeAt(i);
      const isLet = (cu >= 65 && cu <= 90) || (cu >= 97 && cu <= 122);
      const isDig = cu >= 48 && cu <= 57;
      if (!isLet && !isDig) {
        i++;
        continue;
      }
      const runStart = i;
      let hasLetter = isLet;
      i++;
      while (i < n) {
        const c = wordText.charCodeAt(i);
        if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122)) {
          hasLetter = true;
          i++;
        } else if (c >= 48 && c <= 57) {
          i++;
        } else {
          break;
        }
      }
      if (hasLetter) {
        const tokLower = asciiLower(wordText.slice(runStart, i));
        if (!BM25_STOPWORDS.has(tokLower) && queryTerms.has(porterStem(tokLower))) {
          return true;
        }
      }
    }
    return false;
  }

  const lower = normLower(wordText);
  const ln = lower.length;
  let i = 0;
  while (i < ln) {
    const unit = codePointAtSafe(lower, i);
    if (unit.isUnpairedSurrogate) {
      i++;
      continue;
    }
    const startLet = isLetter(unit.cp, false);
    if (!startLet && !isDigit(unit.cp)) {
      i += unit.len;
      continue;
    }
    const runStart = i;
    let hasLetter = startLet;
    let prevIsLetter = startLet;
    i += unit.len;
    while (i < ln) {
      const next = codePointAtSafe(lower, i);
      if (next.isUnpairedSurrogate) {
        break;
      }
      const nextLet = isLetter(next.cp, prevIsLetter);
      if (nextLet || isDigit(next.cp)) {
        if (nextLet) {
          hasLetter = true;
        }
        prevIsLetter = nextLet;
        i += next.len;
      } else {
        break;
      }
    }
    if (hasLetter) {
      const tok = lower.slice(runStart, i);
      if (!BM25_STOPWORDS.has(tok) && queryTerms.has(porterStem(tok))) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Window shaping (`02` §8.7):
 * A unit longer than 60 words is reduced to the 60-word window with the most
 * query-term matches (`ties -> earliest window`). Computed at selection time.
 */
export function shapeEvidenceWindow(
  text: string,
  query: Bm25Query | readonly string[] | ReadonlySet<string> | string,
): ShapedWindowResult {
  const wordSpans = extractSurfaceWordSpans(text);
  const wordCount = wordSpans.length;
  if (wordCount <= WINDOW_SHAPING_MAX_WORDS) {
    return {
      text,
      span: { start: 0, end: text.length },
      wordCount,
      matchCount: 0,
      startWordIndex: 0,
    };
  }

  const queryTerms = normalizeQueryTermSet(query);
  const numWindows = wordCount - WINDOW_SHAPING_MAX_WORDS + 1;
  const windowDeltas = new Int32Array(numWindows + 1);

  const addWindowMatchSpan = (wStart: number, wEnd: number, weight: number): void => {
    if (weight <= 0 || wStart > wEnd) {
      return;
    }
    if (wEnd - wStart >= WINDOW_SHAPING_MAX_WORDS) {
      return;
    }
    const enterL = Math.max(0, wEnd - WINDOW_SHAPING_MAX_WORDS + 1);
    const exitL = wStart + 1;
    if (enterL < numWindows) {
      windowDeltas[enterL]! += weight;
      if (exitL < numWindows) {
        windowDeltas[exitL]! -= weight;
      }
    }
  };

  if (queryTerms.size > 0) {
    let hasNumericQueryTerm = false;
    for (const term of queryTerms) {
      if (term.charCodeAt(0) === 35 /* '#' */) {
        hasNumericQueryTerm = true;
        break;
      }
    }

    const numericWordCovered = new Uint8Array(wordCount);

    if (hasNumericQueryTerm) {
      const quants = extractQuantities(text, { applyLatex: false, citationSpans: [] });
      let wCursor = 0;
      for (let q = 0; q < quants.length; q++) {
        const qt = quants[q]!;
        const numTokens = emitBm25NumericTokensForWindowTuple(text, qt);
        if (numTokens.length === 0) {
          continue;
        }
        let matchedUniqueTokens = 0;
        const seenQtTokens = new Set<string>();
        for (let t = 0; t < numTokens.length; t++) {
          const tok = numTokens[t]!;
          if (queryTerms.has(tok) && !seenQtTokens.has(tok)) {
            seenQtTokens.add(tok);
            matchedUniqueTokens++;
          }
        }
        if (matchedUniqueTokens === 0) {
          continue;
        }

        // Cover the masked numeric value span (and percent cue words when `%`), keeping units like `mg` independent.
        let valueStart = qt.span.start;
        let valueEnd = qt.span.end;
        if (qt.unitCanon !== "%" && qt.valueRaw.length > 0) {
          const rawPos = text.indexOf(qt.valueRaw, qt.span.start);
          if (rawPos !== -1 && rawPos + qt.valueRaw.length <= qt.span.end) {
            valueStart = rawPos;
            valueEnd = rawPos + qt.valueRaw.length;
          }
        }

        while (wCursor > 0 && wordSpans[wCursor - 1]!.end > valueStart) {
          wCursor--;
        }
        while (wCursor < wordCount && wordSpans[wCursor]!.end <= valueStart) {
          wCursor++;
        }
        const wStart = wCursor;
        let k = wStart;
        while (k < wordCount && wordSpans[k]!.start < valueEnd) {
          k++;
        }
        const wEnd = k - 1;
        if (wEnd < wStart) {
          continue;
        }

        let alreadyCovered = false;
        for (let idx = wStart; idx <= wEnd; idx++) {
          if (numericWordCovered[idx] === 1) {
            alreadyCovered = true;
            break;
          }
        }
        if (alreadyCovered) {
          continue;
        }

        for (let idx = wStart; idx <= wEnd; idx++) {
          numericWordCovered[idx] = 1;
        }
        addWindowMatchSpan(wStart, wEnd, 1);
      }
    }

    const bm25FallbackCache = new Map<string, boolean>();
    for (let i = 0; i < wordCount; i++) {
      if (numericWordCovered[i] === 1) {
        continue;
      }
      const ws = wordSpans[i]!;
      let wordHit = false;
      if (isPureAsciiLetters(ws.text)) {
        const lower = asciiLower(ws.text);
        if (!BM25_STOPWORDS.has(lower) && queryTerms.has(porterStem(lower))) {
          wordHit = true;
        }
      } else {
        const cls = classifySurfaceWordToken(ws.text);
        if (cls.hasPotentialLetter) {
          if (cls.needsBm25Fallback) {
            const strippedTail = tryStripSimpleLeadingAsciiNumber(ws.text);
            if (strippedTail !== null) {
              wordHit = matchAsciiWordToken(strippedTail, queryTerms);
            } else {
              const cached = bm25FallbackCache.get(ws.text);
              if (cached !== undefined) {
                wordHit = cached;
              } else {
                const toks = tokBM25(ws.text, { deleteCitations: false, applyLatex: false });
                for (let t = 0; t < toks.length; t++) {
                  if (queryTerms.has(toks[t]!)) {
                    wordHit = true;
                    break;
                  }
                }
                bm25FallbackCache.set(ws.text, wordHit);
              }
            }
          } else {
            wordHit = matchesQueryWordToken(ws.text, queryTerms);
          }
        }
      }
      if (wordHit) {
        addWindowMatchSpan(i, i, 1);
      }
    }
  }

  let runningSum = 0;
  let bestSum = -1;
  let bestStart = 0;

  for (let startIdx = 0; startIdx < numWindows; startIdx++) {
    runningSum += windowDeltas[startIdx]!;
    // Strict `>` ensures ties always keep the earliest window.
    if (runningSum > bestSum) {
      bestSum = runningSum;
      bestStart = startIdx;
    }
  }

  const finalBestSum = Math.max(0, bestSum);
  const startOffset = wordSpans[bestStart]!.start;
  const endOffset = wordSpans[bestStart + WINDOW_SHAPING_MAX_WORDS - 1]!.end;
  return {
    text: text.slice(startOffset, endOffset),
    span: { start: startOffset, end: endOffset },
    wordCount: WINDOW_SHAPING_MAX_WORDS,
    matchCount: finalBestSum,
    startWordIndex: bestStart,
  };
}

function buildEvidenceUnits(
  refId: string,
  sourceKind: EvidenceSourceKind,
  section: string,
  rawSentences: readonly string[],
  startOrdinal: number,
  enableNeighbourExtension: boolean,
): EvidenceUnit[] {
  if (rawSentences.length === 0) {
    return [];
  }
  const shaped = enableNeighbourExtension ? applyNeighbourExtension(rawSentences) : rawSentences;
  const out = new Array<EvidenceUnit>(shaped.length);
  for (let i = 0; i < shaped.length; i++) {
    const ordinal = startOrdinal + i;
    const text = shaped[i]!;
    out[i] = {
      chunkId: computeChunkId(refId, sourceKind, section, ordinal, text),
      sourceKind,
      section,
      text,
      ordinal,
    };
  }
  return out;
}

/**
 * Abstract chunking (`02` §8.7):
 * Strips JATS/HTML tags, decodes entities, segments with §4 (no math masking),
 * applies neighbour extension (`<= 12` words), and assigns `ABSTRACT` chunk IDs.
 */
export function chunkAbstract(
  refId: string,
  rawAbstract: string,
  options?: ChunkAbstractOptions,
): EvidenceUnit[] {
  const stripped = stripJatsAndHtmlTags(rawAbstract);
  if (stripped.length === 0) {
    return [];
  }
  const sentences = segmentPlainSectionText(stripped);
  return buildEvidenceUnits(
    refId,
    "ABSTRACT",
    "abstract",
    sentences,
    0,
    options?.applyNeighbourExtension !== false,
  );
}

// ───────────────────────── PDF Line Reconstruction & Chunking ─────────────────────────

function normalizeColorString(raw: string): string {
  const trimmed = asciiLower(trimSpace(raw));
  if (trimmed === "white") {
    return "#ffffff";
  }
  if (trimmed === "black") {
    return "#000000";
  }
  if (trimmed.length === 4 && trimmed.charCodeAt(0) === 35 /* '#' */) {
    const r = trimmed.charAt(1);
    const g = trimmed.charAt(2);
    const b = trimmed.charAt(3);
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  if (trimmed.startsWith("rgb(") && trimmed.endsWith(")")) {
    const inner = trimmed.slice(4, -1);
    const comps = inner.split(",");
    if (comps.length === 3) {
      const hexParts: string[] = [];
      for (let i = 0; i < 3; i++) {
        const val = Number.parseInt(trimSpace(comps[i]!), 10);
        if (!Number.isFinite(val) || val < 0 || val > 255) {
          return trimmed;
        }
        const h = val.toString(16);
        hexParts.push(h.length === 1 ? "0" + h : h);
      }
      return `#${hexParts[0]!}${hexParts[1]!}${hexParts[2]!}`;
    }
  }
  return trimmed;
}

function isDisjointFromViewBox(
  item: PdfTextItem,
  viewBox: readonly [number, number, number, number],
): boolean {
  const [minX, minY, maxX, maxY] = viewBox;
  const itemMaxX = item.x + Math.max(0, item.width);
  const itemMaxY = item.y + Math.max(0, item.height);
  if (item.width <= 0) {
    if (item.x < minX || item.x > maxX) return true;
  } else if (itemMaxX <= minX || item.x >= maxX) {
    return true;
  }
  if (item.height <= 0) {
    if (item.y < minY || item.y > maxY) return true;
  } else if (itemMaxY <= minY || item.y >= maxY) {
    return true;
  }
  return false;
}

function countAlphabeticChars(text: string): number {
  let count = 0;
  let i = 0;
  while (i < text.length) {
    const u = codePointAtSafe(text, i);
    if (!u.isUnpairedSurrogate && isBaseLetter(u.cp)) {
      count++;
    }
    i += u.len;
  }
  return count;
}

function countAlphabeticWords(text: string): number {
  const spans = extractWordSpans(text);
  let count = 0;
  for (let i = 0; i < spans.length; i++) {
    if (countAlphabeticChars(spans[i]!.text) > 0) {
      count++;
    }
  }
  return count;
}

function medianOfSortedNumbers(sorted: readonly number[]): number {
  if (sorted.length === 0) return 0;
  const mid = sorted.length >> 1;
  if ((sorted.length & 1) === 1) {
    return sorted[mid]!;
  }
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function medianOfNumbers(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const copy = values.slice().sort((a, b) => a - b);
  return medianOfSortedNumbers(copy);
}

interface PdfPreparedLine {
  readonly text: string;
  readonly fontHeight: number;
  readonly y: number;
}

interface PdfLineItemPiece {
  readonly item: PdfTextItem;
  readonly prefix: "" | "^" | "_";
}

interface PdfLineCluster {
  readonly baseItems: PdfTextItem[];
  readonly subSupItems: PdfLineItemPiece[];
  baselineY: number;
  anchorHeight: number;
  medianFontHeight: number;
}

function renderPdfLineCluster(cluster: PdfLineCluster): PdfPreparedLine {
  const combined: PdfLineItemPiece[] = [];
  for (let i = 0; i < cluster.baseItems.length; i++) {
    combined.push({ item: cluster.baseItems[i]!, prefix: "" });
  }
  for (let i = 0; i < cluster.subSupItems.length; i++) {
    combined.push(cluster.subSupItems[i]!);
  }
  combined.sort((a, b) => (a.item.x !== b.item.x ? a.item.x - b.item.x : a.item.y - b.item.y));

  const em = cluster.medianFontHeight > 0 ? cluster.medianFontHeight : cluster.anchorHeight;
  const parts: string[] = [];
  let prevEnd = 0;
  let prevFontHeight = em;
  let prevHadTrailingSpace = false;
  let hasContent = false;

  for (let i = 0; i < combined.length; i++) {
    const piece = combined[i]!;
    const rawStr = piece.item.str;
    const rawTrimmed = trimSpace(rawStr);
    if (rawTrimmed.length === 0) {
      if (hasContent && rawStr.length > 0) {
        prevHadTrailingSpace = true;
      }
      continue;
    }
    const hadLeadingSpace = isSpace(codePointAtSafe(rawStr, 0).cp);
    const tailCp = codePointAtSafe(
      rawStr,
      rawStr.length >= 2 &&
        rawStr.charCodeAt(rawStr.length - 1) >= 0xdc00 &&
        rawStr.charCodeAt(rawStr.length - 1) <= 0xdfff
        ? rawStr.length - 2
        : rawStr.length - 1,
    );
    const hadTrailingSpace = !tailCp.isUnpairedSurrogate && isSpace(tailCp.cp);
    const tokenText = piece.prefix.length > 0 ? piece.prefix + rawTrimmed : rawTrimmed;
    if (hasContent) {
      const gap = piece.item.x - prevEnd;
      const refHeight = piece.prefix.length > 0 ? em : Math.max(prevFontHeight, piece.item.height);
      const explicitBoundarySpace =
        piece.prefix.length === 0 && (prevHadTrailingSpace || hadLeadingSpace);
      if (explicitBoundarySpace || gap > PDF_WORD_GAP_FACTOR * refHeight) {
        parts.push(" ");
      }
    }
    parts.push(tokenText);
    prevEnd = piece.item.x + Math.max(0, piece.item.width);
    prevFontHeight = piece.prefix.length > 0 ? em : piece.item.height;
    prevHadTrailingSpace = hadTrailingSpace;
    hasContent = true;
  }

  return {
    text: collapseAsciiSpacesAndTrim(parts.join("")),
    fontHeight: em,
    y: cluster.baselineY,
  };
}

function reconstructLinesInPartition(
  items: readonly PdfTextItem[],
  yDirection: "bottom-up" | "top-down",
  pageMedianFontHeight: number,
): PdfPreparedLine[] {
  if (items.length === 0) {
    return [];
  }

  const baseCandidates: PdfTextItem[] = [];
  const smallCandidates: PdfTextItem[] = [];
  const smallThresh = pageMedianFontHeight * PDF_SUBSUP_MAX_HEIGHT_RATIO;

  for (let i = 0; i < items.length; i++) {
    const it = items[i]!;
    if (trimSpace(it.str).length === 0) {
      continue;
    }
    if (pageMedianFontHeight > 0 && it.height <= smallThresh) {
      smallCandidates.push(it);
    } else {
      baseCandidates.push(it);
    }
  }

  const compareY = (a: PdfTextItem, b: PdfTextItem): number => {
    if (a.y !== b.y) {
      return yDirection === "bottom-up" ? b.y - a.y : a.y - b.y;
    }
    return a.x - b.x;
  };

  const primaryPool = baseCandidates.length > 0 ? baseCandidates : smallCandidates;
  const sortedPrimary = primaryPool.slice().sort(compareY);
  const clusters: PdfLineCluster[] = [];

  for (let i = 0; i < sortedPrimary.length; i++) {
    const it = sortedPrimary[i]!;
    let bestIdx = -1;
    let bestDist = Number.POSITIVE_INFINITY;
    for (let c = 0; c < clusters.length; c++) {
      const cl = clusters[c]!;
      const refHeight =
        it.height > 0 && cl.anchorHeight > 0
          ? Math.min(it.height, cl.anchorHeight)
          : Math.max(it.height, cl.anchorHeight);
      const tol = PDF_LINE_BASELINE_TOLERANCE_FACTOR * refHeight;
      const dist = Math.abs(it.y - cl.baselineY);
      if (dist <= tol && dist < bestDist) {
        bestDist = dist;
        bestIdx = c;
      }
    }
    if (bestIdx === -1) {
      clusters.push({
        baseItems: [it],
        subSupItems: [],
        baselineY: it.y,
        anchorHeight: it.height,
        medianFontHeight: it.height,
      });
    } else {
      const cl = clusters[bestIdx]!;
      cl.baseItems.push(it);
      cl.baselineY = medianOfNumbers(cl.baseItems.map((b) => b.y));
      cl.medianFontHeight = medianOfNumbers(cl.baseItems.map((b) => b.height));
      cl.anchorHeight = cl.medianFontHeight;
    }
  }

  if (baseCandidates.length > 0 && smallCandidates.length > 0) {
    const leftoverSmall: PdfTextItem[] = [];
    for (let i = 0; i < smallCandidates.length; i++) {
      const it = smallCandidates[i]!;
      let bestClusterIdx = -1;
      let bestDist = Number.POSITIVE_INFINITY;
      let bestKind: "^" | "_" | "" = "";

      for (let c = 0; c < clusters.length; c++) {
        const cl = clusters[c]!;
        const em = cl.medianFontHeight;
        if (em <= 0 || it.height > em * PDF_SUBSUP_MAX_HEIGHT_RATIO) {
          continue;
        }
        const rawOffset = it.y - cl.baselineY;
        const absOffset = Math.abs(rawOffset);
        const minOff = PDF_SUBSUP_MIN_OFFSET_EM * em;
        const maxOff = PDF_SUBSUP_MAX_OFFSET_EM * em;
        if (absOffset >= minOff && absOffset <= maxOff) {
          const isSuper = yDirection === "bottom-up" ? rawOffset > 0 : rawOffset < 0;
          const kind: "^" | "_" = isSuper ? "^" : "_";
          if (absOffset < bestDist) {
            bestDist = absOffset;
            bestClusterIdx = c;
            bestKind = kind;
          }
        }
      }

      if (bestClusterIdx !== -1 && bestKind !== "") {
        clusters[bestClusterIdx]!.subSupItems.push({ item: it, prefix: bestKind });
      } else {
        leftoverSmall.push(it);
      }
    }

    if (leftoverSmall.length > 0) {
      leftoverSmall.sort(compareY);
      for (let i = 0; i < leftoverSmall.length; i++) {
        const it = leftoverSmall[i]!;
        let placed = false;
        for (let c = 0; c < clusters.length; c++) {
          const cl = clusters[c]!;
          const tol = PDF_LINE_BASELINE_TOLERANCE_FACTOR * it.height;
          if (Math.abs(it.y - cl.baselineY) <= tol) {
            cl.baseItems.push(it);
            placed = true;
            break;
          }
        }
        if (!placed) {
          clusters.push({
            baseItems: [it],
            subSupItems: [],
            baselineY: it.y,
            anchorHeight: it.height,
            medianFontHeight: it.height,
          });
        }
      }
    }
  }

  clusters.sort((a, b) =>
    yDirection === "bottom-up" ? b.baselineY - a.baselineY : a.baselineY - b.baselineY,
  );

  const lines: PdfPreparedLine[] = [];
  for (let c = 0; c < clusters.length; c++) {
    const rendered = renderPdfLineCluster(clusters[c]!);
    if (rendered.text.length > 0) {
      lines.push(rendered);
    }
  }
  return lines;
}

function detectBimodalColumnSplitX(
  items: readonly PdfTextItem[],
  pageWidth: number,
): number | null {
  if (pageWidth <= 0 || items.length < 4) {
    return null;
  }
  const centers: number[] = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i]!;
    if (trimSpace(it.str).length === 0) {
      continue;
    }
    if (it.width <= 0.6 * pageWidth) {
      centers.push(it.x + it.width / 2);
    }
  }
  if (centers.length < 4) {
    return null;
  }
  centers.sort((a, b) => a - b);

  let maxGap = 0;
  let splitIdx = -1;
  for (let i = 0; i + 1 < centers.length; i++) {
    const gap = centers[i + 1]! - centers[i]!;
    if (gap > maxGap) {
      maxGap = gap;
      splitIdx = i;
    }
  }

  if (splitIdx === -1 || maxGap <= PDF_COLUMN_GAP_RATIO * pageWidth) {
    return null;
  }
  const leftCount = splitIdx + 1;
  const rightCount = centers.length - leftCount;
  const minCluster = Math.max(2, Math.floor(centers.length * 0.15));
  if (leftCount < minCluster || rightCount < minCluster) {
    return null;
  }

  return (centers[splitIdx]! + centers[splitIdx + 1]!) / 2;
}

function reconstructPageLines(
  items: readonly PdfTextItem[],
  pageWidth: number,
  yDirection: "bottom-up" | "top-down",
  pageMedianFontHeight: number,
): PdfPreparedLine[] {
  const splitX = detectBimodalColumnSplitX(items, pageWidth);
  if (splitX === null) {
    return reconstructLinesInPartition(items, yDirection, pageMedianFontHeight);
  }

  const leftItems: PdfTextItem[] = [];
  const rightItems: PdfTextItem[] = [];
  const spanningItems: PdfTextItem[] = [];
  const spanMinWidth = 0.35 * pageWidth;

  for (let i = 0; i < items.length; i++) {
    const it = items[i]!;
    if (it.width > spanMinWidth && it.x < splitX && it.x + it.width > splitX) {
      spanningItems.push(it);
      continue;
    }
    const center = it.x + it.width / 2;
    if (center < splitX) {
      leftItems.push(it);
    } else {
      rightItems.push(it);
    }
  }

  const leftLines = reconstructLinesInPartition(leftItems, yDirection, pageMedianFontHeight);
  const rightLines = reconstructLinesInPartition(rightItems, yDirection, pageMedianFontHeight);
  if (spanningItems.length === 0) {
    return [...leftLines, ...rightLines];
  }

  const spanningLines = reconstructLinesInPartition(
    spanningItems,
    yDirection,
    pageMedianFontHeight,
  );
  const colBoundaryY = [...leftLines, ...rightLines].reduce((best, l) => {
    if (best === null) return l.y;
    return yDirection === "bottom-up" ? Math.max(best, l.y) : Math.min(best, l.y);
  }, null as number | null);

  const topSpanning: PdfPreparedLine[] = [];
  const bottomSpanning: PdfPreparedLine[] = [];
  for (let i = 0; i < spanningLines.length; i++) {
    const sl = spanningLines[i]!;
    const isTop =
      colBoundaryY === null ||
      (yDirection === "bottom-up" ? sl.y > colBoundaryY : sl.y < colBoundaryY);
    if (isTop) {
      topSpanning.push(sl);
    } else {
      bottomSpanning.push(sl);
    }
  }
  return [...topSpanning, ...leftLines, ...rightLines, ...bottomSpanning];
}

function extractTrailingHyphenPrefix(line: string): {
  readonly prefixStart: number;
  readonly leftWord: string;
} | null {
  if (!line.endsWith("-") || line.length < 2) {
    return null;
  }
  let pos = line.length - 1;
  while (pos > 0) {
    const cu = line.charCodeAt(pos - 1);
    if (cu < 0x80) {
      if (isAsciiLetterCode(cu)) {
        pos--;
      } else {
        break;
      }
    } else {
      let prevStart = pos - 1;
      if (cu >= 0xdc00 && cu <= 0xdfff && prevStart > 0) {
        prevStart--;
      }
      const u = codePointAtSafe(line, prevStart);
      if (!u.isUnpairedSurrogate && isBaseLetter(u.cp)) {
        pos = prevStart;
      } else {
        break;
      }
    }
  }
  if (pos >= line.length - 1) {
    return null;
  }
  return { prefixStart: pos, leftWord: line.slice(pos, line.length - 1) };
}

function extractLeadingLowercaseWord(line: string): {
  readonly rightWord: string;
  readonly rightEnd: number;
} | null {
  if (line.length === 0) {
    return null;
  }
  const first = codePointAtSafe(line, 0);
  if (first.isUnpairedSurrogate || !isLower(first.cp)) {
    return null;
  }
  let end = first.len;
  while (end < line.length) {
    const u = codePointAtSafe(line, end);
    if (!u.isUnpairedSurrogate && isBaseLetter(u.cp)) {
      end += u.len;
    } else {
      break;
    }
  }
  return { rightWord: line.slice(0, end), rightEnd: end };
}

/**
 * Dehyphenates reconstructed PDF lines (`02` §8.7 step 2):
 * A line-final `-` followed by a line starting with a lowercase letter is deleted
 * and joined ONLY IF `joined` is in `wordlist_en.txt` and `left-right` is not.
 * Otherwise `-` is kept (`long-term` stays `long-term`).
 */
export function dehyphenatePdfLines(lines: readonly string[]): string {
  const cleaned: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const t = trimSpace(lines[i]!);
    if (t.length > 0) {
      cleaned.push(t);
    }
  }
  if (cleaned.length === 0) {
    return "";
  }

  let acc = cleaned[0]!;
  for (let i = 1; i < cleaned.length; i++) {
    const nextLine = cleaned[i]!;
    const leftInfo = extractTrailingHyphenPrefix(acc);
    const rightInfo = leftInfo !== null ? extractLeadingLowercaseWord(nextLine) : null;
    if (leftInfo !== null && rightInfo !== null) {
      const joined = leftInfo.leftWord + rightInfo.rightWord;
      const hyphenated = `${leftInfo.leftWord}-${rightInfo.rightWord}`;
      if (isInWordlistEn(joined) && !isInWordlistEn(hyphenated)) {
        acc = acc.slice(0, acc.length - 1) + nextLine;
      } else {
        acc = acc + nextLine;
      }
    } else {
      acc = `${acc} ${nextLine}`;
    }
  }
  return collapseAsciiSpacesAndTrim(acc);
}

function classifyPdfHeading(
  line: PdfPreparedLine,
  pageMedianHeight: number,
  isFirstHeading: boolean,
): { readonly isHeading: boolean; readonly level: number; readonly isNumberedSub: boolean } {
  const words = countWords(line.text);
  if (words === 0 || words > PDF_HEADING_MAX_WORDS) {
    return { isHeading: false, level: 3, isNumberedSub: false };
  }
  const lowered = trimSpace(normLower(line.text));
  const stripped = trimSpace(stripLeadingSectionNumbering(lowered));
  const hasKeywordMatch = PDF_HEADING_KEYWORDS.has(stripped);
  const isLargerFont = pageMedianHeight > 0 && line.fontHeight >= pageMedianHeight + 1.0;

  if (!hasKeywordMatch && !isLargerFont) {
    return { isHeading: false, level: 3, isNumberedSub: false };
  }

  // Detect `N.M ...` numbered subheadings so they inherit enclosing canonical label when unmatched.
  let isNumberedSub = false;
  if (stripped.length < lowered.length) {
    const prefixPart = trimSpace(lowered.slice(0, lowered.length - stripped.length));
    if (prefixPart.includes(".")) {
      const dotPos = prefixPart.indexOf(".");
      if (dotPos > 0 && dotPos + 1 < prefixPart.length && isDigit(prefixPart.charCodeAt(dotPos + 1))) {
        isNumberedSub = true;
      }
    }
  }

  const matchesSectionRule = matchCanonicalSectionLabel(line.text, isFirstHeading) !== null;
  const level = isNumberedSub && !matchesSectionRule ? 4 : 3;
  return { isHeading: true, level, isNumberedSub };
}

/**
 * Full-text chunking from PDF text items (`02` §8.7 steps 1–8):
 * 1. Line reconstruction (0.5× font height baseline, sup/sub `^`/`_`, x sort, 0.15× gap space);
 * 2. Dehyphenation via `wordlist_en.txt`;
 * 3. Bimodal columns (> 15% page width gap -> left column before right column);
 * 4. Heading detection (<= 8 words & >= median + 1 pt or numbered §8.7 keyword);
 * 5. References cut (>= 60% chars drops references + tail; < 60% drops references only);
 * 6. Running headers/footers (>= 3 pages & >= 50% pages dropped; < 3 alpha chars dropped);
 * 7. Hidden-text guard (< 2 pt, outside viewBox, S-W5 renderMode 3 / background fillColor);
 * 8. Per-section §4 segmentation + neighbour extension + `chunkId`.
 */
export function chunkPdfPages(
  refId: string,
  pages: readonly PdfPageInput[],
  options?: ChunkPdfOptions,
): ChunkPdfResult {
  const sourceKind = options?.sourceKind ?? "FULLTEXT";
  const yDirection = options?.yDirection ?? "bottom-up";
  const enableSW5 = options?.spike_s_w5_primary === true;
  const enableNeighbourExtension = options?.applyNeighbourExtension !== false;

  const hiddenItems: PdfHiddenItemRecord[] = [];
  const hiddenTextPages: number[] = [];

  interface PageLineBundle {
    readonly pageNumber: number;
    readonly medianFontHeight: number;
    readonly lines: PdfPreparedLine[];
  }

  const perPage: PageLineBundle[] = [];

  // Steps 7, 3, 1 per page
  for (let p = 0; p < pages.length; p++) {
    const page = pages[p]!;
    const pageNum = page.pageNumber ?? p + 1;
    const viewBox: readonly [number, number, number, number] = page.viewBox ?? [
      0,
      0,
      page.width,
      page.height,
    ];
    const bgNorm = normalizeColorString(page.backgroundColor ?? "#ffffff");

    const visibleItems: PdfTextItem[] = [];
    const droppedTexts: string[] = [];

    for (let k = 0; k < page.items.length; k++) {
      const item = page.items[k]!;
      let dropReason: PdfHiddenItemRecord["reason"] | null = null;
      if (item.height < PDF_HIDDEN_FONT_HEIGHT_MIN) {
        dropReason = "FONT_TOO_SMALL";
      } else if (isDisjointFromViewBox(item, viewBox)) {
        dropReason = "OUT_OF_VIEW_BOX";
      } else if (enableSW5) {
        if (item.renderMode === 3) {
          dropReason = "RENDER_MODE_INVISIBLE";
        } else if (item.fillColor !== undefined && normalizeColorString(item.fillColor) === bgNorm) {
          dropReason = "BACKGROUND_FILL";
        }
      }

      if (dropReason !== null) {
        hiddenItems.push({ pageNumber: pageNum, text: item.str, reason: dropReason });
        droppedTexts.push(item.str);
      } else if (trimSpace(item.str).length > 0) {
        visibleItems.push(item);
      }
    }

    if (droppedTexts.length > 0 && countAlphabeticWords(droppedTexts.join(" ")) >= PDF_HIDDEN_TEXT_MIN_ALPHA_WORDS) {
      hiddenTextPages.push(pageNum);
    }

    const pageHeights = visibleItems.map((it) => it.height).sort((a, b) => a - b);
    const medianHeight = medianOfSortedNumbers(pageHeights);
    const lines = reconstructPageLines(visibleItems, page.width, yDirection, medianHeight);
    perPage.push({ pageNumber: pageNum, medianFontHeight: medianHeight, lines });
  }

  // Step 6: Running headers & footers (>= 3 pages, >= 50% pages) + < 3 alphabetic chars
  const linePageCounts = new Map<string, number>();
  if (perPage.length >= PDF_RUNNING_HF_MIN_PAGES) {
    for (let p = 0; p < perPage.length; p++) {
      const seenOnPage = new Set<string>();
      const lines = perPage[p]!.lines;
      for (let i = 0; i < lines.length; i++) {
        seenOnPage.add(lines[i]!.text);
      }
      for (const lineText of seenOnPage) {
        linePageCounts.set(lineText, (linePageCounts.get(lineText) ?? 0) + 1);
      }
    }
  }

  const runningThreshold = perPage.length * PDF_RUNNING_HF_PAGE_RATIO;
  interface FilteredPdfLine extends PdfPreparedLine {
    readonly pageMedianFontHeight: number;
  }

  const filteredLines: FilteredPdfLine[] = [];
  const pageTexts: string[] = [];

  for (let p = 0; p < perPage.length; p++) {
    const bundle = perPage[p]!;
    const keptForPage: string[] = [];
    for (let i = 0; i < bundle.lines.length; i++) {
      const line = bundle.lines[i]!;
      if (countAlphabeticChars(norm(line.text).text) < PDF_MIN_LINE_ALPHA_CHARS) {
        continue;
      }
      if (
        perPage.length >= PDF_RUNNING_HF_MIN_PAGES &&
        (linePageCounts.get(line.text) ?? 0) >= runningThreshold
      ) {
        continue;
      }
      filteredLines.push({
        ...line,
        pageMedianFontHeight: bundle.medianFontHeight,
      });
      keptForPage.push(line.text);
    }
    pageTexts.push(dehyphenatePdfLines(keptForPage));
  }

  // Compute total char length for Step 5 references 60% threshold
  let totalChars = 0;
  for (let i = 0; i < filteredLines.length; i++) {
    totalChars += filteredLines[i]!.text.length + (i > 0 ? 1 : 0);
  }

  // Steps 4 & 5: Heading detection + References cut + Section accumulation
  const tracker = new SectionTracker();
  let seenHeading = false;
  let charOffset = 0;
  let inReferences = false;

  interface SectionLineBucket {
    readonly section: CanonicalSectionLabel;
    readonly lines: string[];
  }
  const buckets: SectionLineBucket[] = [];

  const appendSectionLine = (section: CanonicalSectionLabel, text: string): void => {
    const last = buckets[buckets.length - 1];
    if (last !== undefined && last.section === section) {
      last.lines.push(text);
    } else {
      buckets.push({ section, lines: [text] });
    }
  };

  for (let i = 0; i < filteredLines.length; i++) {
    const line = filteredLines[i]!;
    const cls = classifyPdfHeading(line, line.pageMedianFontHeight, !seenHeading);
    if (cls.isHeading) {
      seenHeading = true;
      const state = tracker.pushHeading(cls.level, line.text);
      if (state.label === "references") {
        if (totalChars > 0 && charOffset >= PDF_REFERENCES_CUT_RATIO * totalChars) {
          break;
        }
        inReferences = true;
        charOffset += line.text.length + 1;
        continue;
      }
      inReferences = false;
      charOffset += line.text.length + 1;
      continue;
    }

    if (!inReferences) {
      appendSectionLine(tracker.current.label, line.text);
    }
    charOffset += line.text.length + 1;
  }

  // Steps 2 & 8: Dehyphenate, segment with §4 (no math masking), neighbour-extend, assign ordinal & chunkId
  const units: EvidenceUnit[] = [];
  const ordinalBySection = new Map<string, number>();

  for (let b = 0; b < buckets.length; b++) {
    const bucket = buckets[b]!;
    const prose = dehyphenatePdfLines(bucket.lines);
    if (prose.length === 0) {
      continue;
    }
    const sentences = segmentPlainSectionText(prose);
    if (sentences.length === 0) {
      continue;
    }
    const startOrd = ordinalBySection.get(bucket.section) ?? 0;
    const sectionUnits = buildEvidenceUnits(
      refId,
      sourceKind,
      bucket.section,
      sentences,
      startOrd,
      enableNeighbourExtension,
    );
    ordinalBySection.set(bucket.section, startOrd + sectionUnits.length);
    for (let u = 0; u < sectionUnits.length; u++) {
      units.push(sectionUnits[u]!);
    }
  }

  return {
    units,
    hiddenTextPages,
    hiddenItems,
    pageTexts,
  };
}

// ───────────────────────── JATS XML Ordered Parsing & Chunking ─────────────────────────

function parseXmlAttributes(rawAttrPart: string): Readonly<Record<string, unknown>> | undefined {
  const attrs: Record<string, unknown> = {};
  let hasAny = false;
  let i = 0;
  const n = rawAttrPart.length;
  while (i < n) {
    while (i < n && isSpace(rawAttrPart.charCodeAt(i))) {
      i++;
    }
    if (i >= n) break;
    const nameStart = i;
    while (i < n && isAsciiTagNameChar(rawAttrPart.charCodeAt(i))) {
      i++;
    }
    if (i === nameStart) {
      i++;
      continue;
    }
    const attrName = rawAttrPart.slice(nameStart, i);
    while (i < n && isSpace(rawAttrPart.charCodeAt(i))) {
      i++;
    }
    if (i < n && rawAttrPart.charCodeAt(i) === 61 /* '=' */) {
      i++;
      while (i < n && isSpace(rawAttrPart.charCodeAt(i))) {
        i++;
      }
      let val = "";
      if (i < n && (rawAttrPart.charCodeAt(i) === 34 || rawAttrPart.charCodeAt(i) === 39)) {
        const q = rawAttrPart.charCodeAt(i);
        i++;
        const vStart = i;
        while (i < n && rawAttrPart.charCodeAt(i) !== q) {
          i++;
        }
        val = decodeXmlEntities(rawAttrPart.slice(vStart, i));
        if (i < n) i++;
      } else {
        const vStart = i;
        while (i < n && !isSpace(rawAttrPart.charCodeAt(i))) {
          i++;
        }
        val = decodeXmlEntities(rawAttrPart.slice(vStart, i));
      }
      attrs[`@_${attrName}`] = val;
      hasAny = true;
    } else {
      attrs[`@_${attrName}`] = true;
      hasAny = true;
    }
  }
  return hasAny ? attrs : undefined;
}

/**
 * Pure O(n) zero-regex XML parser producing `fast-xml-parser` (`preserveOrder: true`,
 * `ignoreAttributes: false`) compatible ordered node arrays while keeping inline spacing intact.
 */
export function parseXmlOrdered(xml: string): OrderedXmlNode[] {
  const root: OrderedXmlNode[] = [];
  const stack: Array<{ readonly tagName: string; readonly children: OrderedXmlNode[] }> = [
    { tagName: "__root__", children: root },
  ];
  const openTagCounts = new Map<string, number>();

  const n = xml.length;
  let i = 0;
  let noMoreCommentClose = false;
  let noMoreCdataClose = false;
  let noMoreBangClose = false;
  let noMorePiClose = false;

  const pushText = (rawSlice: string): void => {
    if (rawSlice.length === 0) return;
    const decoded = decodeXmlEntities(rawSlice);
    if (decoded.length === 0) return;
    stack[stack.length - 1]!.children.push({ "#text": decoded });
  };

  while (i < n) {
    const lt = xml.indexOf("<", i);
    if (lt === -1) {
      pushText(xml.slice(i));
      break;
    }
    if (lt > i) {
      pushText(xml.slice(i, lt));
    }
    if (lt + 1 >= n) {
      pushText("<");
      break;
    }

    const next = xml.charCodeAt(lt + 1);
    if (next === 33 /* '!' */) {
      if (xml.startsWith("<!--", lt)) {
        const endComment = noMoreCommentClose ? -1 : xml.indexOf("-->", lt + 4);
        if (endComment !== -1) {
          i = endComment + 3;
          continue;
        }
        noMoreCommentClose = true;
      } else if (xml.startsWith("<![CDATA[", lt)) {
        const endCdata = noMoreCdataClose ? -1 : xml.indexOf("]]>", lt + 9);
        if (endCdata !== -1) {
          const cdataContent = xml.slice(lt + 9, endCdata);
          if (cdataContent.length > 0) {
            stack[stack.length - 1]!.children.push({ "#text": cdataContent });
          }
          i = endCdata + 3;
          continue;
        }
        noMoreCdataClose = true;
      } else {
        const endBang = noMoreBangClose ? -1 : xml.indexOf(">", lt + 2);
        if (endBang !== -1) {
          i = endBang + 1;
          continue;
        }
        noMoreBangClose = true;
      }
      pushText("<");
      i = lt + 1;
      continue;
    }

    if (next === 63 /* '?' */) {
      const endPi = noMorePiClose ? -1 : xml.indexOf("?>", lt + 2);
      if (endPi !== -1) {
        i = endPi + 2;
        continue;
      }
      noMorePiClose = true;
      pushText("<");
      i = lt + 1;
      continue;
    }

    const isClose = next === 47 /* '/' */;
    const nameStart = isClose ? lt + 2 : lt + 1;
    if (nameStart >= n || !isAsciiLetterCode(xml.charCodeAt(nameStart))) {
      pushText("<");
      i = lt + 1;
      continue;
    }
    let nameEnd = nameStart + 1;
    while (nameEnd < n && isAsciiTagNameChar(xml.charCodeAt(nameEnd))) {
      nameEnd++;
    }
    const closeBracket = findTagCloseOutsideQuotes(xml, nameEnd);
    if (closeBracket === -1) {
      pushText("<");
      i = lt + 1;
      continue;
    }
    const tagName = xml.slice(nameStart, nameEnd);

    if (isClose) {
      if ((openTagCounts.get(tagName) ?? 0) > 0) {
        for (let s = stack.length - 1; s >= 1; s--) {
          const frame = stack[s]!;
          const c = openTagCounts.get(frame.tagName) ?? 0;
          if (c > 1) {
            openTagCounts.set(frame.tagName, c - 1);
          } else {
            openTagCounts.delete(frame.tagName);
          }
          if (frame.tagName === tagName) {
            stack.length = s;
            break;
          }
        }
      }
      i = closeBracket + 1;
      continue;
    }

    let attrEnd = closeBracket;
    let isSelfClosing = false;
    let checkBack = closeBracket - 1;
    while (checkBack >= nameEnd && isSpace(xml.charCodeAt(checkBack))) {
      checkBack--;
    }
    if (checkBack >= nameEnd && xml.charCodeAt(checkBack) === 47 /* '/' */) {
      isSelfClosing = true;
      attrEnd = checkBack;
    }

    const attrs = attrEnd > nameEnd ? parseXmlAttributes(xml.slice(nameEnd, attrEnd)) : undefined;
    const childList: OrderedXmlNode[] = [];
    const elemNode: OrderedXmlNode =
      attrs !== undefined ? { [tagName]: childList, ":@": attrs } : { [tagName]: childList };
    stack[stack.length - 1]!.children.push(elemNode);

    if (!isSelfClosing) {
      stack.push({ tagName, children: childList });
      openTagCounts.set(tagName, (openTagCounts.get(tagName) ?? 0) + 1);
    }
    i = closeBracket + 1;
  }

  return root;
}

function getOrderedNodeTagAndChildren(node: OrderedXmlNode): {
  readonly rawTag: string;
  readonly localTag: string;
  readonly children: readonly OrderedXmlNode[];
} | null {
  const keys = Object.keys(node);
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i]!;
    if (k === ":@" || k === "#text" || k === "#comment" || k.startsWith("?")) {
      continue;
    }
    const val = node[k];
    if (Array.isArray(val)) {
      return {
        rawTag: k,
        localTag: asciiLower(stripNamespacePrefix(k)),
        children: val as readonly OrderedXmlNode[],
      };
    }
  }
  return null;
}

function getNodeAttrString(node: OrderedXmlNode, attrName: string): string | null {
  const attrs = node[":@"];
  if (attrs === undefined) return null;
  const val = attrs[`@_${attrName}`];
  return typeof val === "string" ? val : val !== undefined ? String(val) : null;
}

function flattenInlineXmlNodes(nodes: readonly OrderedXmlNode[]): string {
  const parts: string[] = [];
  const walk = (list: readonly OrderedXmlNode[]): void => {
    for (let i = 0; i < list.length; i++) {
      const node = list[i]!;
      const txt = node["#text"];
      if (typeof txt === "string" || typeof txt === "number" || typeof txt === "boolean") {
        parts.push(String(txt));
        continue;
      }
      const elem = getOrderedNodeTagAndChildren(node);
      if (elem === null) continue;
      if (elem.localTag === "break" || elem.localTag === "br") {
        parts.push(" ");
        continue;
      }
      if (elem.localTag === "table-wrap" || elem.localTag === "ref-list") {
        continue;
      }
      walk(elem.children);
    }
  };
  walk(nodes);
  return collapseAsciiSpacesAndTrim(parts.join(""));
}

interface JatsTableCell {
  readonly text: string;
  readonly colspan: number;
  readonly rowspan: number;
}

interface JatsTableRowData {
  readonly cells: JatsTableCell[];
  readonly hasTh: boolean;
  readonly hasTd: boolean;
}

function extractJatsTableRowCells(trChildren: readonly OrderedXmlNode[]): JatsTableRowData {
  const cells: JatsTableCell[] = [];
  let hasTh = false;
  let hasTd = false;
  for (let i = 0; i < trChildren.length; i++) {
    const elem = getOrderedNodeTagAndChildren(trChildren[i]!);
    if (elem === null || (elem.localTag !== "th" && elem.localTag !== "td")) {
      continue;
    }
    if (elem.localTag === "th") {
      hasTh = true;
    } else {
      hasTd = true;
    }
    const csRaw = getNodeAttrString(trChildren[i]!, "colspan");
    const rsRaw = getNodeAttrString(trChildren[i]!, "rowspan");
    const colspan = csRaw !== null ? Math.max(1, Number.parseInt(csRaw, 10) || 1) : 1;
    const rowspan = rsRaw !== null ? Math.max(1, Number.parseInt(rsRaw, 10) || 1) : 1;
    cells.push({
      text: flattenInlineXmlNodes(elem.children),
      colspan,
      rowspan,
    });
  }
  return { cells, hasTh, hasTd };
}

function expandHeaderMatrix(headerRows: readonly (readonly JatsTableCell[])[]): string[] {
  if (headerRows.length === 0) return [];
  const grid: (string | undefined)[][] = headerRows.map(() => []);
  let numCols = 0;

  for (let r = 0; r < headerRows.length; r++) {
    const row = headerRows[r]!;
    let col = 0;
    for (let c = 0; c < row.length; c++) {
      while (grid[r]![col] !== undefined) {
        col++;
      }
      const cell = row[c]!;
      for (let dr = 0; dr < cell.rowspan && r + dr < headerRows.length; dr++) {
        for (let dc = 0; dc < cell.colspan; dc++) {
          grid[r + dr]![col + dc] = cell.text;
        }
      }
      col += cell.colspan;
      if (col > numCols) {
        numCols = col;
      }
    }
  }

  const headers = new Array<string>(numCols);
  for (let c = 0; c < numCols; c++) {
    const labels: string[] = [];
    for (let r = 0; r < grid.length; r++) {
      const val = trimSpace(grid[r]![c] ?? "");
      if (val.length > 0 && (labels.length === 0 || labels[labels.length - 1] !== val)) {
        labels.push(val);
      }
    }
    headers[c] = labels.length > 0 ? labels.join(" \u00b7 ") : `Column ${c + 1}`;
  }
  return headers;
}

function extractJatsTableRows(tableChildren: readonly OrderedXmlNode[]): string[] {
  const theadRows: JatsTableCell[][] = [];
  const bodyRows: JatsTableRowData[] = [];

  const collectTrs = (
    nodes: readonly OrderedXmlNode[],
    pushRow: (row: JatsTableRowData) => void,
  ): void => {
    for (let i = 0; i < nodes.length; i++) {
      const elem = getOrderedNodeTagAndChildren(nodes[i]!);
      if (elem === null) continue;
      if (elem.localTag === "tr") {
        pushRow(extractJatsTableRowCells(elem.children));
      } else {
        collectTrs(elem.children, pushRow);
      }
    }
  };

  for (let i = 0; i < tableChildren.length; i++) {
    const elem = getOrderedNodeTagAndChildren(tableChildren[i]!);
    if (elem === null) continue;
    if (elem.localTag === "thead") {
      collectTrs(elem.children, (row) => theadRows.push(row.cells));
    } else if (elem.localTag === "tbody") {
      collectTrs(elem.children, (row) => bodyRows.push(row));
    } else if (elem.localTag === "tr") {
      bodyRows.push(extractJatsTableRowCells(elem.children));
    }
  }

  // Promote leading all-<th> header rows when <thead> is omitted (whether in <tbody> or direct <tr>).
  if (theadRows.length === 0) {
    while (bodyRows.length > 0 && bodyRows[0]!.hasTh && !bodyRows[0]!.hasTd) {
      theadRows.push(bodyRows.shift()!.cells);
    }
  }

  const headers = expandHeaderMatrix(theadRows);
  const formattedRows: string[] = [];

  for (let r = 0; r < bodyRows.length; r++) {
    const rowCells = bodyRows[r]!.cells;
    if (rowCells.length === 0) continue;
    const expandedCells: string[] = [];
    for (let c = 0; c < rowCells.length; c++) {
      const cell = rowCells[c]!;
      for (let rep = 0; rep < cell.colspan; rep++) {
        expandedCells.push(cell.text);
      }
    }
    const pairs: string[] = [];
    for (let c = 0; c < expandedCells.length; c++) {
      const hdr = headers[c] ?? `Column ${c + 1}`;
      pairs.push(`${hdr}: ${expandedCells[c]!}`);
    }
    const rowText = collapseAsciiSpacesAndTrim(pairs.join("; "));
    if (rowText.length > 0) {
      formattedRows.push(rowText);
    }
  }

  return formattedRows;
}

/**
 * Full-text chunking from already-parsed `fast-xml-parser` (`preserveOrder: true`,
 * `ignoreAttributes: false`) ordered nodes (`02` §8.7).
 */
export function chunkJatsOrderedNodes(
  refId: string,
  orderedNodes: readonly OrderedXmlNode[],
  options?: ChunkJatsOptions,
): ChunkJatsResult {
  const sourceKind = options?.sourceKind ?? "FULLTEXT";
  const enableNeighbourExtension = options?.applyNeighbourExtension !== false;

  let doi: string | null = null;
  let seenHeading = false;
  const secStack: Array<{ readonly level: number; readonly label: CanonicalSectionLabel }> = [];
  const currentSectionLabel = (): CanonicalSectionLabel =>
    secStack.length > 0 ? secStack[secStack.length - 1]!.label : "unlabeled";

  interface JatsProseBucket {
    readonly kind: "prose" | "table";
    readonly section: string;
    readonly items: string[];
  }
  const buckets: JatsProseBucket[] = [];

  const pushProseSentence = (section: string, sentence: string): void => {
    const last = buckets[buckets.length - 1];
    if (last !== undefined && last.kind === "prose" && last.section === section) {
      last.items.push(sentence);
    } else {
      buckets.push({ kind: "prose", section, items: [sentence] });
    }
  };

  const pushTableRow = (rowText: string): void => {
    const last = buckets[buckets.length - 1];
    if (last !== undefined && last.kind === "table" && last.section === "table") {
      last.items.push(rowText);
    } else {
      buckets.push({ kind: "table", section: "table", items: [rowText] });
    }
  };

  const emitParagraphProse = (paragraphNodes: readonly OrderedXmlNode[], section: string): void => {
    const text = flattenInlineXmlNodes(paragraphNodes);
    if (text.length === 0) return;
    const sentences = segmentPlainSectionText(text);
    for (let i = 0; i < sentences.length; i++) {
      pushProseSentence(section, sentences[i]!);
    }
  };

  const walkParagraphDirect = (
    pChildren: readonly OrderedXmlNode[],
    section: string,
    secDepth: number,
  ): void => {
    // Emit inline content in document order, splitting cleanly around any embedded <table-wrap>
    let buffered: OrderedXmlNode[] = [];
    const flushBuffered = (): void => {
      if (buffered.length > 0) {
        emitParagraphProse(buffered, section);
        buffered = [];
      }
    };
    for (let i = 0; i < pChildren.length; i++) {
      const child = pChildren[i]!;
      const elem = getOrderedNodeTagAndChildren(child);
      if (elem !== null && elem.localTag === "table-wrap") {
        flushBuffered();
        walkTableWrap(elem.children, section);
      } else if (elem !== null && elem.localTag === "sec") {
        flushBuffered();
        walkNodes([child], secDepth);
      } else {
        buffered.push(child);
      }
    }
    flushBuffered();
  };

  const walkTableWrap = (wrapChildren: readonly OrderedXmlNode[], enclosingSection: string): void => {
    for (let i = 0; i < wrapChildren.length; i++) {
      const child = wrapChildren[i]!;
      const elem = getOrderedNodeTagAndChildren(child);
      if (elem === null) continue;
      if (elem.localTag === "caption") {
        for (let k = 0; k < elem.children.length; k++) {
          const capChild = getOrderedNodeTagAndChildren(elem.children[k]!);
          if (capChild !== null && (capChild.localTag === "p" || capChild.localTag === "title")) {
            emitParagraphProse(capChild.children, enclosingSection);
          } else if (elem.children[k]!["#text"] !== undefined) {
            emitParagraphProse([elem.children[k]!], enclosingSection);
          }
        }
      } else if (elem.localTag === "table") {
        const rows = extractJatsTableRows(elem.children);
        for (let r = 0; r < rows.length; r++) {
          pushTableRow(rows[r]!);
        }
      }
    }
  };

  const walkNodes = (nodes: readonly OrderedXmlNode[], secDepth: number): void => {
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]!;
      const elem = getOrderedNodeTagAndChildren(node);
      if (elem === null) continue;

      if (JATS_SKIP_TAGS.has(elem.localTag)) {
        continue;
      }

      if (elem.localTag === "article-id") {
        if (doi === null && getNodeAttrString(node, "pub-id-type") === "doi") {
          const candidate = trimSpace(flattenInlineXmlNodes(elem.children));
          if (candidate.length > 0) {
            doi = candidate;
          }
        }
        continue;
      }

      if (elem.localTag === "abstract") {
        secStack.push({ level: 3 + secDepth, label: "abstract" });
        walkNodes(elem.children, secDepth + 1);
        secStack.pop();
        continue;
      }

      if (elem.localTag === "sec" || elem.localTag === "ack" || elem.localTag === "app") {
        const nextLevel = 3 + secDepth;
        let titleText = "";
        for (let c = 0; c < elem.children.length; c++) {
          const ce = getOrderedNodeTagAndChildren(elem.children[c]!);
          if (ce !== null && ce.localTag === "title") {
            titleText = flattenInlineXmlNodes(ce.children);
            break;
          }
        }
        if (titleText.length === 0) {
          titleText = getNodeAttrString(node, "sec-type") ?? (elem.localTag === "app" ? "appendix" : "");
        }
        let pushed = false;
        if (titleText.length > 0) {
          const isFirst = !seenHeading;
          seenHeading = true;
          const matched = matchCanonicalSectionLabel(titleText, isFirst);
          const nextLabel: CanonicalSectionLabel =
            matched !== null ? matched : currentSectionLabel();
          secStack.push({ level: nextLevel, label: nextLabel });
          pushed = true;
        }
        walkNodes(elem.children, secDepth + 1);
        if (pushed) {
          secStack.pop();
        }
        continue;
      }

      if (elem.localTag === "title") {
        continue;
      }

      if (elem.localTag === "table-wrap") {
        walkTableWrap(elem.children, currentSectionLabel());
        continue;
      }

      if (elem.localTag === "table") {
        const rows = extractJatsTableRows(elem.children);
        for (let r = 0; r < rows.length; r++) {
          pushTableRow(rows[r]!);
        }
        continue;
      }

      if (elem.localTag === "p") {
        walkParagraphDirect(elem.children, currentSectionLabel(), secDepth);
        continue;
      }

      walkNodes(elem.children, secDepth);
    }
  };

  walkNodes(orderedNodes, 0);

  const units: EvidenceUnit[] = [];
  const ordinalBySection = new Map<string, number>();

  for (let b = 0; b < buckets.length; b++) {
    const bucket = buckets[b]!;
    const startOrd = ordinalBySection.get(bucket.section) ?? 0;
    const isProse = bucket.kind === "prose";
    const built = buildEvidenceUnits(
      refId,
      sourceKind,
      bucket.section,
      bucket.items,
      startOrd,
      isProse && enableNeighbourExtension,
    );
    ordinalBySection.set(bucket.section, startOrd + built.length);
    for (let u = 0; u < built.length; u++) {
      units.push(built[u]!);
    }
  }

  return { units, doi };
}

/**
 * Full-text chunking from raw JATS XML string (`02` §8.7).
 */
export function chunkJatsXml(
  refId: string,
  xml: string,
  options?: ChunkJatsOptions,
): ChunkJatsResult {
  const ordered = parseXmlOrdered(xml);
  return chunkJatsOrderedNodes(refId, ordered, options);
}

// ───────────────────────── Physical Select-Row & Printed Text Units ─────────────────────────

/**
 * Formats an Android O2 Select-row table row (`02` §8.7 line 784):
 * `"{columnHeader₁}: {cell₁}; {columnHeader₂}: {cell₂}; …"`,
 * with two-row merged headers written `"{upper} · {lower}"`.
 */
export function formatSelectRowText(pairs: readonly SelectRowCellInput[]): string {
  const parts: string[] = [];
  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i]!;
    const lower = trimSpace(norm(pair.header).text);
    const upper = pair.upperHeader !== undefined ? trimSpace(norm(pair.upperHeader).text) : "";
    const header =
      upper.length > 0 && lower.length > 0
        ? `${upper} \u00b7 ${lower}`
        : upper.length > 0
          ? upper
          : lower;
    const cell = trimSpace(norm(pair.cell).text);
    parts.push(`${header}: ${cell}`);
  }
  return collapseAsciiSpacesAndTrim(parts.join("; "));
}

/**
 * Creates a physical Select-row `PHYSICAL_TABLE` evidence unit (`02` §8.7 line 784).
 */
export function chunkPhysicalTableRow(
  refId: string,
  photoSha256: string,
  pairs: readonly SelectRowCellInput[],
  ordinal: number = 0,
): EvidenceUnit {
  const section = `print:${photoSha256.slice(0, 12)}`;
  const text = formatSelectRowText(pairs);
  return {
    chunkId: computeChunkId(refId, "PHYSICAL_TABLE", section, ordinal, text),
    sourceKind: "PHYSICAL_TABLE",
    section,
    text,
    ordinal,
  };
}

/**
 * Creates a physical printed-text `PHYSICAL_TEXT` evidence unit (`02` §8.7 line 784).
 */
export function chunkPhysicalText(
  refId: string,
  photoSha256: string,
  ocrText: string,
  ordinal: number = 0,
): EvidenceUnit {
  const section = `print:${photoSha256.slice(0, 12)}`;
  const text = collapseAsciiSpacesAndTrim(norm(ocrText).text);
  return {
    chunkId: computeChunkId(refId, "PHYSICAL_TEXT", section, ordinal, text),
    sourceKind: "PHYSICAL_TEXT",
    section,
    text,
    ordinal,
  };
}
