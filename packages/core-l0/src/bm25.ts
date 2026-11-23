/**
 * BM25 retrieval tokenization (`tokBM25`), corpus indexing, BM25 scoring with
 * quantity-class bonus, and transitive `gridKey` ranking (`02` §8.1–§8.2, §8.6).
 *
 * Pure Tier A L0 module: zero Firebase, DOM, network, Node I/O, clock, or regex usage.
 */

import { scanCitations } from "./citations.js";
import { applyLatexSubstitutions, type TextRangeLike } from "./latex.js";
import { MASK_CHAR, preMask, type SourceFormat } from "./mask.js";
import {
  codePointAtSafe,
  isDigit,
  isLetter,
  normLower,
  normLowerWithMap,
} from "./norm.js";
import { formatCanonicalDecimal } from "./numberParser.js";
import { BM25_STOPWORDS, porterStem } from "./porter.js";
import { extractQuantities, type QuantTuple, type TextRange } from "./quantity.js";
import { sameFamily, UNIT_WORDS } from "./units.js";

export type EvidenceSourceKind =
  | "ABSTRACT"
  | "FULLTEXT"
  | "USER_PDF"
  | "PHYSICAL_TABLE"
  | "PHYSICAL_TEXT"
  | "LAB_NOTE"
  | "MANUSCRIPT";

export const BM25_K1 = 1.2;
export const BM25_B = 0.75;
export const BM25_CLAUSE_WEIGHT = 1.0;
export const BM25_CONTEXT_WEIGHT = 0.5;
export const BM25_QUANTITY_BONUS = 1.0;
export const GRID_KEY_SCALE = 1_000_000_000;

const CITATION_PLACEHOLDER = "\u27e6c\u27e7";

const SOURCE_KIND_RANK: Readonly<Record<EvidenceSourceKind, number>> = {
  ABSTRACT: 0,
  FULLTEXT: 1,
  USER_PDF: 2,
  PHYSICAL_TABLE: 3,
  PHYSICAL_TEXT: 4,
  LAB_NOTE: 5,
  MANUSCRIPT: 6,
};

export interface TokBM25Options {
  readonly lang?: string;
  readonly format?: SourceFormat;
  readonly markerRanges?: readonly TextRange[];
  readonly deleteCitations?: boolean;
  readonly applyLatex?: boolean;
}

export interface Bm25UnitInput {
  readonly chunkId: string;
  readonly refId: string;
  readonly sourceKind: EvidenceSourceKind;
  readonly ordinal: number;
  readonly text: string;
  readonly section?: string;
  readonly tokens?: readonly string[];
  readonly quantities?: readonly QuantTuple[];
  readonly lang?: string;
}

export interface Bm25IndexedUnit {
  readonly chunkId: string;
  readonly refId: string;
  readonly sourceKind: EvidenceSourceKind;
  readonly ordinal: number;
  readonly section: string;
  readonly text: string;
  readonly tokens: readonly string[];
  readonly termFreqs: ReadonlyMap<string, number>;
  readonly tokenSet: ReadonlySet<string>;
  readonly length: number;
  readonly lang?: string;
  getQuantities(): readonly QuantTuple[];
}

export interface Bm25Corpus {
  readonly units: readonly Bm25IndexedUnit[];
  readonly docCount: number;
  readonly avgdl: number;
  readonly docFreq: ReadonlyMap<string, number>;
  readonly idfOverrides?: ReadonlyMap<string, number>;
}

export interface BuildBm25CorpusOptions {
  readonly lang?: string;
  readonly idfOverrides?: ReadonlyMap<string, number>;
}

export interface BuildBm25QueryOptions extends TokBM25Options {
  readonly claimTokens?: readonly string[];
  readonly contextTokens?: readonly string[];
  readonly claimQuantities?: readonly QuantTuple[];
}

export interface Bm25Query {
  readonly terms: readonly string[];
  readonly weights: ReadonlyMap<string, number>;
  readonly claimTokens: readonly string[];
  readonly claimWordTerms: readonly string[];
  readonly claimQuantities: readonly QuantTuple[];
}

export interface Bm25ScoreBreakdown {
  readonly bm25: number;
  readonly bonus: number;
  readonly score: number;
  readonly gridScore: number;
}

export interface Bm25ScoredUnit extends Bm25ScoreBreakdown {
  readonly unit: Bm25IndexedUnit;
}

interface PositionedToken {
  readonly pos: number;
  readonly seq: number;
  readonly token: string;
}

interface NumericMaskInterval {
  readonly start: number;
  readonly end: number;
}

/**
 * Deterministic UTF-16 code-unit lexicographical comparison (never locale-dependent).
 */
export function compareCodeUnits(a: string, b: string): number {
  const minLen = a.length < b.length ? a.length : b.length;
  for (let i = 0; i < minLen; i++) {
    const ca = a.charCodeAt(i);
    const cb = b.charCodeAt(i);
    if (ca !== cb) {
      return ca - cb;
    }
  }
  return a.length - b.length;
}

/**
 * Quantizes a non-negative score/coverage to an exact integer comparison key:
 * `gridKey(x) = floor(x * 1e9 + 0.5)` (`02` §8.2).
 */
export function gridKey(x: number): number {
  if (!Number.isFinite(x) || x <= 0) {
    return 0;
  }
  return Math.floor(x * GRID_KEY_SCALE + 0.5);
}

/**
 * Returns true if `token` is a numeric `#<canonical>` token emitted by `tokBM25`.
 */
export function isNumericBm25Token(token: string): boolean {
  return token.length > 1 && token.charCodeAt(0) === 35; /* '#' */
}

/**
 * Returns true if `token` is a word stem token (never a numeric `#...` token).
 */
export function isWordBm25Token(token: string): boolean {
  return token.length > 0 && token.charCodeAt(0) !== 35; /* '#' */
}

export function sourceKindRank(kind: EvidenceSourceKind): number {
  return SOURCE_KIND_RANK[kind];
}

function detectPreMaskFormat(text: string, explicitFormat?: SourceFormat): SourceFormat {
  if (explicitFormat !== undefined) {
    return explicitFormat;
  }
  if (
    text.includes("\\(") ||
    text.includes("\\[") ||
    text.includes("\\begin{") ||
    text.includes("\\section") ||
    text.includes("\\documentclass") ||
    text.includes("\\footnote")
  ) {
    return "latex";
  }
  return "md";
}

function needsPreMaskScan(text: string, format: SourceFormat): boolean {
  if (text.includes("$") || text.includes("`")) {
    return true;
  }
  if (format === "latex") {
    return (
      text.includes("\\(") ||
      text.includes("\\[") ||
      text.includes("\\begin{") ||
      text.includes("\\footnote") ||
      text.includes("%")
    );
  }
  return text.includes("<!--") || text.includes("---");
}

function stripPlaceholdersAndMasks(text: string): string {
  if (!text.includes(CITATION_PLACEHOLDER) && !text.includes(MASK_CHAR)) {
    return text;
  }
  const parts: string[] = [];
  let i = 0;
  let segStart = 0;
  const n = text.length;
  while (i < n) {
    const ch = text.charCodeAt(i);
    if (ch === 0x27e6 && text.startsWith(CITATION_PLACEHOLDER, i)) {
      if (i > segStart) {
        parts.push(text.slice(segStart, i));
      }
      parts.push(" ");
      i += CITATION_PLACEHOLDER.length;
      segStart = i;
      continue;
    }
    if (ch === 0xe000) {
      if (i > segStart) {
        parts.push(text.slice(segStart, i));
      }
      parts.push(" ");
      i++;
      while (i < n && text.charCodeAt(i) === 0xe000) {
        i++;
      }
      segStart = i;
      continue;
    }
    i++;
  }
  if (segStart < n) {
    parts.push(text.slice(segStart));
  }
  return parts.join("");
}

/**
 * Step 1 of `tokBM25` (`02` §8.1): deletes citation markers and applies math / LaTeX
 * substitutions of §3.2 while preserving casing for case-sensitive quantity rules (`HR`, `OR`).
 */
function preprocessForBm25(x: string, options?: TokBM25Options): string {
  const hasExplicitMarkers = options?.markerRanges !== undefined && options.markerRanges.length > 0;
  const shouldDeleteCitations = options?.deleteCitations !== false;
  const shouldApplyLatex = options?.applyLatex !== false;

  if (
    !hasExplicitMarkers &&
    !x.includes("\\") &&
    !x.includes("$") &&
    !x.includes("`") &&
    !x.includes("<!--") &&
    !x.includes("---") &&
    !x.includes(CITATION_PLACEHOLDER) &&
    !x.includes(MASK_CHAR) &&
    (!shouldDeleteCitations || (!x.includes("[") && !x.includes("(")))
  ) {
    return x;
  }

  const format = detectPreMaskFormat(x, options?.format);
  const runMask = needsPreMaskScan(x, format);
  const maskRes = runMask
    ? preMask(x, format, format === "md" ? { frontMatterMath: true } : undefined)
    : null;

  let citeSpans: readonly TextRangeLike[] = [];
  if (options?.markerRanges !== undefined) {
    citeSpans = options.markerRanges;
  } else if (shouldDeleteCitations) {
    const scanTarget = maskRes !== null ? maskRes.maskedText : x;
    if (scanTarget.includes("[") || scanTarget.includes("(") || scanTarget.includes("\\")) {
      citeSpans = scanCitations(scanTarget);
    }
  }

  interface Segment {
    readonly start: number;
    readonly end: number;
    readonly replacement: string;
    readonly priority: number;
  }

  const segments: Segment[] = [];
  for (const r of citeSpans) {
    if (r.start >= 0 && r.end > r.start && r.end <= x.length) {
      segments.push({ start: r.start, end: r.end, replacement: " ", priority: 0 });
    }
  }
  if (maskRes !== null) {
    for (const m of maskRes.mathRegions) {
      if (m.start >= 0 && m.end > m.start && m.end <= x.length) {
        segments.push({ start: m.start, end: m.end, replacement: m.text, priority: 1 });
      }
    }
    for (const r of maskRes.regions) {
      if (
        r.kind !== "inline_math" &&
        r.kind !== "display_math" &&
        r.start >= 0 &&
        r.end > r.start &&
        r.end <= x.length
      ) {
        segments.push({ start: r.start, end: r.end, replacement: " ", priority: 2 });
      }
    }
  }

  if (segments.length === 0) {
    const clean = stripPlaceholdersAndMasks(x);
    if (shouldApplyLatex && clean.includes("\\")) {
      return applyLatexSubstitutions(clean, {
        ...(maskRes !== null && maskRes.userMacros.size > 0
          ? { userMacros: maskRes.userMacros }
          : {}),
        ...(maskRes !== null && maskRes.customCiteMacros.size > 0
          ? { customCiteMacros: maskRes.customCiteMacros }
          : {}),
      }).text;
    }
    return clean;
  }

  segments.sort((a, b) => {
    if (a.start !== b.start) {
      return a.start - b.start;
    }
    if (a.priority !== b.priority) {
      return a.priority - b.priority;
    }
    return b.end - a.end;
  });

  const latexOpts =
    maskRes !== null && (maskRes.userMacros.size > 0 || maskRes.customCiteMacros.size > 0)
      ? {
          ...(maskRes.userMacros.size > 0 ? { userMacros: maskRes.userMacros } : {}),
          ...(maskRes.customCiteMacros.size > 0
            ? { customCiteMacros: maskRes.customCiteMacros }
            : {}),
        }
      : undefined;

  const parts: string[] = [];
  let cursor = 0;

  const pushProseSlice = (slice: string): void => {
    const clean = stripPlaceholdersAndMasks(slice);
    if (clean.length === 0) {
      return;
    }
    if (shouldApplyLatex && clean.includes("\\")) {
      parts.push(applyLatexSubstitutions(clean, latexOpts).text);
    } else {
      parts.push(clean);
    }
  };

  for (const seg of segments) {
    if (seg.start < cursor) {
      continue;
    }
    if (seg.start > cursor) {
      pushProseSlice(x.slice(cursor, seg.start));
    }
    if (seg.replacement.length > 0) {
      parts.push(seg.replacement);
    }
    cursor = seg.end;
  }
  if (cursor < x.length) {
    pushProseSlice(x.slice(cursor));
  }

  return parts.join("");
}

function isRangeValueRaw(valueRaw: string): boolean {
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

function formatNumericToken(value: number, isPercent: boolean): string {
  const canon = formatCanonicalDecimal(value);
  return isPercent ? `#${canon}%` : `#${canon}`;
}

function emitNumericTokensForTuple(prepText: string, qt: QuantTuple): string[] {
  if (qt.valueNorm === null || !Number.isFinite(qt.valueNorm)) {
    return [];
  }
  const isPct = qt.unitCanon === "%";
  const lo = qt.valueLo;
  const hi = qt.valueHi;
  if (lo !== null && hi !== null && Number.isFinite(lo) && Number.isFinite(hi)) {
    if (isRangeValueRaw(qt.valueRaw)) {
      return [formatNumericToken(lo, isPct), formatNumericToken(hi, isPct)];
    }
    if (lo !== hi) {
      const spanSlice = prepText.slice(qt.span.start, qt.span.end);
      if (spanSlice.includes("\u00b1") || spanSlice.includes("+/-")) {
        return [formatNumericToken(qt.valueNorm, isPct)];
      }
      return [
        formatNumericToken(qt.valueNorm, isPct),
        formatNumericToken(lo, isPct),
        formatNumericToken(hi, isPct),
      ];
    }
  }
  return [formatNumericToken(qt.valueNorm, isPct)];
}

function asciiMatchIgnoreCaseAt(text: string, pos: number, wordLower: string): boolean {
  if (pos + wordLower.length > text.length) {
    return false;
  }
  for (let i = 0; i < wordLower.length; i++) {
    let cu = text.charCodeAt(pos + i);
    if (cu >= 65 && cu <= 90) {
      cu += 32;
    }
    if (cu !== wordLower.charCodeAt(i)) {
      return false;
    }
  }
  return true;
}

function isBasicWordCharAt(text: string, idx: number): boolean {
  if (idx < 0 || idx >= text.length) {
    return false;
  }
  const u = codePointAtSafe(text, idx);
  return !u.isUnpairedSurrogate && (isLetter(u.cp, false) || isDigit(u.cp));
}

function resolveNumericMaskIntervals(
  prepText: string,
  qt: QuantTuple,
  outIntervals: NumericMaskInterval[],
): number {
  let valueStart = qt.span.start;
  let valueEnd = qt.span.end;
  if (qt.valueRaw.length > 0) {
    const found = prepText.indexOf(qt.valueRaw, qt.span.start);
    if (found !== -1 && found + qt.valueRaw.length <= qt.span.end) {
      valueStart = found;
      valueEnd = found + qt.valueRaw.length;
    }
  }
  outIntervals.push({ start: valueStart, end: valueEnd });

  if (qt.unitCanon === "%") {
    const pctWords = ["per cent", "percent", "pct"];
    let cursor = qt.span.start;
    while (cursor < qt.span.end) {
      let matched = false;
      for (let w = 0; w < pctWords.length; w++) {
        const word = pctWords[w]!;
        const wordEnd = cursor + word.length;
        if (
          wordEnd <= qt.span.end &&
          asciiMatchIgnoreCaseAt(prepText, cursor, word) &&
          !isBasicWordCharAt(prepText, cursor - 1) &&
          !isBasicWordCharAt(prepText, wordEnd)
        ) {
          outIntervals.push({ start: cursor, end: wordEnd });
          cursor = wordEnd;
          matched = true;
          break;
        }
      }
      if (!matched) {
        cursor++;
      }
    }
  }

  return valueStart;
}

function maskIntervalsWithSpaces(text: string, intervals: readonly NumericMaskInterval[]): string {
  if (intervals.length === 0) {
    return text;
  }
  const parts: string[] = [];
  let cursor = 0;
  for (let i = 0; i < intervals.length; i++) {
    const iv = intervals[i]!;
    if (iv.end <= cursor) {
      continue;
    }
    const start = Math.max(cursor, iv.start);
    if (start > cursor) {
      parts.push(text.slice(cursor, start));
    }
    const maskLen = iv.end - start;
    if (maskLen > 0) {
      parts.push(" ".repeat(maskLen));
    }
    cursor = iv.end;
  }
  if (cursor < text.length) {
    parts.push(text.slice(cursor));
  }
  return parts.join("");
}

/**
 * Tokenizes `x` for BM25 retrieval (`02` §8.1):
 * 1. Deletes citation markers and applies §3.2 math/LaTeX substitutions;
 * 2. Emits `#<canonical>` (`#<canonical>%` for percent) numeric tokens via §7;
 * 3. Lowercases remaining text with `normLower`, splits maximal `LETTER`/`DIGIT` runs containing at least one letter;
 * 4. Drops `BM25_STOPWORDS` (preserving `not`, `no`, `nor`, `never`, `without`);
 * 5. Stems words strictly using `porter_v1.json`.
 */
export function tokBM25(x: string, options?: TokBM25Options): string[] {
  if (x.length === 0) {
    return [];
  }

  const prepText = preprocessForBm25(x, options);
  if (prepText.length === 0) {
    return [];
  }

  const quantities = extractQuantities(prepText, {
    ...(options?.lang !== undefined ? { lang: options.lang } : {}),
    applyLatex: false,
    citationSpans: [],
  });

  const emitted: PositionedToken[] = [];
  const maskIntervals: NumericMaskInterval[] = [];
  let seq = 0;

  for (let i = 0; i < quantities.length; i++) {
    const qt = quantities[i]!;
    const numTokens = emitNumericTokensForTuple(prepText, qt);
    if (numTokens.length === 0) {
      continue;
    }
    const emitPos = resolveNumericMaskIntervals(prepText, qt, maskIntervals);
    for (let k = 0; k < numTokens.length; k++) {
      emitted.push({ pos: emitPos, seq: seq++, token: numTokens[k]! });
    }
  }

  maskIntervals.sort((a, b) => (a.start !== b.start ? a.start - b.start : a.end - b.end));

  const remainingText = maskIntervalsWithSpaces(prepText, maskIntervals);
  const normRes = normLowerWithMap(remainingText);
  const lower = normRes.text;
  const normMap = normRes.map;
  const n = lower.length;

  let i = 0;
  while (i < n) {
    const cu = lower.charCodeAt(i);
    if (cu < 0x80) {
      const isAsciiLet = cu >= 97 && cu <= 122;
      const isAsciiDig = cu >= 48 && cu <= 57;
      if (!isAsciiLet && !isAsciiDig) {
        i++;
        continue;
      }
      const runStart = i;
      let hasLetter = isAsciiLet;
      let prevIsLetter = isAsciiLet;
      i++;
      while (i < n) {
        const c = lower.charCodeAt(i);
        if (c < 0x80) {
          if (c >= 97 && c <= 122) {
            hasLetter = true;
            prevIsLetter = true;
            i++;
          } else if (c >= 48 && c <= 57) {
            prevIsLetter = false;
            i++;
          } else {
            break;
          }
        } else {
          const u = codePointAtSafe(lower, i);
          if (u.isUnpairedSurrogate) {
            break;
          }
          const nextLet = isLetter(u.cp, prevIsLetter);
          if (nextLet || isDigit(u.cp)) {
            if (nextLet) {
              hasLetter = true;
            }
            prevIsLetter = nextLet;
            i += u.len;
          } else {
            break;
          }
        }
      }
      if (hasLetter) {
        const word = lower.slice(runStart, i);
        if (!BM25_STOPWORDS.has(word)) {
          const stem = porterStem(word);
          if (stem.length > 0) {
            emitted.push({ pos: normMap[runStart] ?? runStart, seq: seq++, token: stem });
          }
        }
      }
      continue;
    }

    const u0 = codePointAtSafe(lower, i);
    if (u0.isUnpairedSurrogate) {
      i += u0.len;
      continue;
    }
    const startIsLetter = isLetter(u0.cp, false);
    const startIsDigit = isDigit(u0.cp);
    if (!startIsLetter && !startIsDigit) {
      i += u0.len;
      continue;
    }

    const runStart = i;
    let hasLetter = startIsLetter;
    let prevIsLetter = startIsLetter;
    i += u0.len;

    while (i < n) {
      const u = codePointAtSafe(lower, i);
      if (u.isUnpairedSurrogate) {
        break;
      }
      const nextLet = isLetter(u.cp, prevIsLetter);
      if (nextLet || isDigit(u.cp)) {
        if (nextLet) {
          hasLetter = true;
        }
        prevIsLetter = nextLet;
        i += u.len;
      } else {
        break;
      }
    }

    if (hasLetter) {
      const word = lower.slice(runStart, i);
      if (!BM25_STOPWORDS.has(word)) {
        const stem = porterStem(word);
        if (stem.length > 0) {
          emitted.push({ pos: normMap[runStart] ?? runStart, seq: seq++, token: stem });
        }
      }
    }
  }

  if (maskIntervals.length > 0 && emitted.length > 1) {
    emitted.sort((a, b) => (a.pos !== b.pos ? a.pos - b.pos : a.seq - b.seq));
  }

  const out = new Array<string>(emitted.length);
  for (let k = 0; k < emitted.length; k++) {
    out[k] = emitted[k]!.token;
  }
  return out;
}

/**
 * Exact BM25 IDF (`02` §8.2): `ln(1 + (N - n_t + 0.5) / (n_t + 0.5))`.
 */
export function computeIdf(docCount: number, docFreq: number): number {
  if (docCount <= 0) {
    return 0;
  }
  const df = Math.max(0, Math.min(docCount, docFreq));
  return Math.log(1 + (docCount - df + 0.5) / (df + 0.5));
}

/**
 * Looks up `IDF(t)` for a corpus, honoring any explicit per-term overrides (e.g. normative fixtures).
 */
export function getCorpusIdf(corpus: Bm25Corpus, term: string): number {
  const override = corpus.idfOverrides?.get(term);
  if (override !== undefined) {
    return override;
  }
  return computeIdf(corpus.docCount, corpus.docFreq.get(term) ?? 0);
}

/**
 * Indexes all available evidence units into a BM25 corpus (`02` §8.2).
 */
export function buildBm25Corpus(
  units: readonly Bm25UnitInput[],
  options?: BuildBm25CorpusOptions,
): Bm25Corpus {
  const indexed: Bm25IndexedUnit[] = new Array<Bm25IndexedUnit>(units.length);
  const docFreq = new Map<string, number>();
  let totalLength = 0;

  for (let i = 0; i < units.length; i++) {
    const raw = units[i]!;
    const unitLang = raw.lang ?? options?.lang;
    const tokens =
      raw.tokens !== undefined
        ? raw.tokens.slice()
        : tokBM25(raw.text, unitLang !== undefined ? { lang: unitLang } : undefined);

    const termFreqs = new Map<string, number>();
    const tokenSet = new Set<string>();
    for (let k = 0; k < tokens.length; k++) {
      const tok = tokens[k]!;
      termFreqs.set(tok, (termFreqs.get(tok) ?? 0) + 1);
      if (!tokenSet.has(tok)) {
        tokenSet.add(tok);
        docFreq.set(tok, (docFreq.get(tok) ?? 0) + 1);
      }
    }

    totalLength += tokens.length;

    let cachedQuantities: readonly QuantTuple[] | null =
      raw.quantities !== undefined ? raw.quantities : null;
    const textForQuant = raw.text;

    indexed[i] = {
      chunkId: raw.chunkId,
      refId: raw.refId,
      sourceKind: raw.sourceKind,
      ordinal: raw.ordinal,
      section: raw.section ?? "abstract",
      text: raw.text,
      tokens,
      termFreqs,
      tokenSet,
      length: tokens.length,
      ...(unitLang !== undefined ? { lang: unitLang } : {}),
      getQuantities(): readonly QuantTuple[] {
        if (cachedQuantities === null) {
          cachedQuantities = extractQuantities(textForQuant, {
            ...(unitLang !== undefined ? { lang: unitLang } : {}),
          });
        }
        return cachedQuantities;
      },
    };
  }

  const docCount = indexed.length;
  const avgdl = docCount > 0 ? totalLength / docCount : 0;

  return {
    units: indexed,
    docCount,
    avgdl,
    docFreq,
    ...(options?.idfOverrides !== undefined ? { idfOverrides: options.idfOverrides } : {}),
  };
}

/**
 * Builds a Stage 2 BM25 query (`02` §8.2): clause tokens at weight `1.0`,
 * remaining sentence prompt tokens at weight `0.5`, distinct terms sorted ascending
 * by UTF-16 code units, plus clause word terms and quantity tuples.
 */
export function buildBm25Query(
  claimText: string,
  sentenceText?: string,
  options?: BuildBm25QueryOptions,
): Bm25Query {
  const claimTokens =
    options?.claimTokens !== undefined ? options.claimTokens.slice() : tokBM25(claimText, options);

  const weights = new Map<string, number>();
  const claimWordSet = new Set<string>();

  for (let i = 0; i < claimTokens.length; i++) {
    const tok = claimTokens[i]!;
    weights.set(tok, BM25_CLAUSE_WEIGHT);
    if (isWordBm25Token(tok)) {
      claimWordSet.add(tok);
    }
  }

  if (options?.contextTokens !== undefined || sentenceText !== undefined) {
    const sentTokens =
      options?.contextTokens !== undefined
        ? options.contextTokens
        : tokBM25(sentenceText!, options);
    for (let i = 0; i < sentTokens.length; i++) {
      const tok = sentTokens[i]!;
      if (!weights.has(tok)) {
        weights.set(tok, BM25_CONTEXT_WEIGHT);
      }
    }
  }

  const terms = Array.from(weights.keys()).sort(compareCodeUnits);
  const claimWordTerms = Array.from(claimWordSet).sort(compareCodeUnits);
  const claimQuantities =
    options?.claimQuantities !== undefined
      ? options.claimQuantities
      : extractQuantities(claimText, {
          ...(options?.lang !== undefined ? { lang: options.lang } : {}),
          ...(options?.format !== undefined ? { format: options.format } : {}),
          ...(options?.applyLatex !== undefined ? { applyLatex: options.applyLatex } : {}),
          ...(options?.markerRanges !== undefined ? { citationSpans: options.markerRanges } : {}),
        });

  return {
    terms,
    weights,
    claimTokens,
    claimWordTerms,
    claimQuantities,
  };
}

/**
 * Builds a B4 candidate-reference query (`02` §8.2, §8.6): sentence prompt text at weight `1.0`.
 */
export function buildB4Query(sentenceText: string, options?: TokBM25Options): Bm25Query {
  return buildBm25Query(sentenceText, undefined, options);
}

/**
 * Quantity bonus (`02` §8.2): `+1.0` if some claim tuple and some unit tuple share
 * `metricClass != "other"`, the same unit family (`sameFamily`), and at least one
 * non-unit key lemma.
 */
export function computeQuantityBonus(
  claimQuantities: readonly QuantTuple[],
  unitQuantities: readonly QuantTuple[],
): number {
  if (claimQuantities.length === 0 || unitQuantities.length === 0) {
    return 0;
  }

  for (let i = 0; i < claimQuantities.length; i++) {
    const cq = claimQuantities[i]!;
    if (cq.metricClass === "other" || cq.keyLemmas.length === 0) {
      continue;
    }
    for (let j = 0; j < unitQuantities.length; j++) {
      const uq = unitQuantities[j]!;
      if (
        uq.metricClass !== cq.metricClass ||
        uq.keyLemmas.length === 0 ||
        !sameFamily(cq.unitCanon, uq.unitCanon)
      ) {
        continue;
      }
      for (let a = 0; a < cq.keyLemmas.length; a++) {
        const lemma = cq.keyLemmas[a]!;
        if (UNIT_WORDS.has(lemma)) {
          continue;
        }
        if (uq.keyLemmas.includes(lemma)) {
          return BM25_QUANTITY_BONUS;
        }
      }
    }
  }

  return 0;
}

/**
 * Computes exact BM25 score, quantity bonus, total score, and transitive `gridKey` (`02` §8.2).
 */
export function scoreBm25Unit(
  corpus: Bm25Corpus,
  query: Bm25Query,
  unit: Bm25IndexedUnit,
): Bm25ScoreBreakdown {
  let bm25 = 0;
  const avgdl = corpus.avgdl;

  if (avgdl > 0 && unit.length > 0 && query.terms.length > 0) {
    const lengthNorm = BM25_K1 * (1 - BM25_B + BM25_B * (unit.length / avgdl));
    for (let i = 0; i < query.terms.length; i++) {
      const term = query.terms[i]!;
      const tf = unit.termFreqs.get(term) ?? 0;
      if (tf === 0) {
        continue;
      }
      const w = query.weights.get(term) ?? 0;
      if (w === 0) {
        continue;
      }
      const idf = getCorpusIdf(corpus, term);
      const tfNorm = (tf * (BM25_K1 + 1)) / (tf + lengthNorm);
      bm25 += w * idf * tfNorm;
    }
  }

  let bonus = 0;
  if (query.claimQuantities.some((q) => q.metricClass !== "other" && q.keyLemmas.length > 0)) {
    bonus = computeQuantityBonus(query.claimQuantities, unit.getQuantities());
  }

  const score = bm25 + bonus;
  return {
    bm25,
    bonus,
    score,
    gridScore: gridKey(score),
  };
}

/**
 * Deterministic BM25 ranking comparator (`02` §8.2):
 * `gridKey(score)` desc -> source kind (`ABSTRACT` < `FULLTEXT` < `USER_PDF` < physical) ->
 * unit ordinal asc -> `refId` asc -> `chunkId` asc.
 */
export function compareBm25Candidates(a: Bm25ScoredUnit, b: Bm25ScoredUnit): number {
  if (a.gridScore !== b.gridScore) {
    return b.gridScore - a.gridScore;
  }
  const rankDiff = sourceKindRank(a.unit.sourceKind) - sourceKindRank(b.unit.sourceKind);
  if (rankDiff !== 0) {
    return rankDiff;
  }
  if (a.unit.ordinal !== b.unit.ordinal) {
    return a.unit.ordinal - b.unit.ordinal;
  }
  const refCmp = compareCodeUnits(a.unit.refId, b.unit.refId);
  if (refCmp !== 0) {
    return refCmp;
  }
  return compareCodeUnits(a.unit.chunkId, b.unit.chunkId);
}

/**
 * Scores and ranks all corpus units (or those belonging to `filterRefId`).
 */
export function rankBm25Units(
  corpus: Bm25Corpus,
  query: Bm25Query,
  filterRefId?: string,
): Bm25ScoredUnit[] {
  const scored: Bm25ScoredUnit[] = [];
  for (let i = 0; i < corpus.units.length; i++) {
    const unit = corpus.units[i]!;
    if (filterRefId !== undefined && unit.refId !== filterRefId) {
      continue;
    }
    const breakdown = scoreBm25Unit(corpus, query, unit);
    scored.push({
      unit,
      ...breakdown,
    });
  }
  scored.sort(compareBm25Candidates);
  return scored;
}
