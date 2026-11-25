/**
 * Linear-time citation-marker scanner (`O(n)`), shared §4.1 word helper,
 * and deterministic key resolver (`docs/spec/02_L0_TIER_A_PRE_DECODE.md` §4.1, §5;
 * `01` §1.1).
 *
 * Pure TypeScript using precomputed backward delimiter tables and character-code
 * scanners: zero regular expressions, zero `.toLowerCase()`, zero `.normalize()`.
 */

import { CITE_COMMANDS, NARRATIVE_CITE_COMMANDS, type TextRangeLike } from "./latex.js";
import { isAsciiLetter, skipAdjacentWhitespace, type PreMaskResult } from "./mask.js";
import {
  codePointAtSafe,
  foldLatin,
  isCombiningMark,
  isDigit,
  isKeyChar,
  isLetter,
  isLetterAt,
  isSpace,
  isUpper,
  normLower,
} from "./norm.js";
import { createEmptyImportQualityReport, type ImportQualityReport } from "./sections.js";

export type MarkerKind = "EXPLICIT" | "HEURISTIC";

export type BibStatus =
  | "PENDING"
  | "RESOLVED"
  | "DOI_NOT_FOUND"
  | "NOT_INDEXED"
  | "AMBIGUOUS"
  | "METADATA_MISMATCH"
  | "UNRESOLVED_KEY"
  | "UPSTREAM_UNAVAILABLE"
  | "RATE_LIMITED";

export type CitationRuleKind =
  | "latex_cite"
  | "pandoc_bracket"
  | "numeric_bracket"
  | "pandoc_narrative"
  | "author_year_paren"
  | "author_year_narrative"
  | "docx_field"
  | "docx_superscript";

export const MULTICITE_COMMANDS: ReadonlySet<string> = new Set([
  "cites",
  "parencites",
  "textcites",
  "autocites",
  "footcites",
]);

export const INTERVAL_CONTEXT_WORDS: ReadonlySet<string> = new Set([
  "ci",
  "iqr",
  "sd",
  "se",
  "sem",
  "range",
  "interval",
  "ranges",
  "intervals",
  "cri",
  "hdi",
]);

export const NON_NAME_WORDS: ReadonlySet<string> = new Set([
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
  "jan",
  "feb",
  "mar",
  "apr",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
  "spring",
  "summer",
  "autumn",
  "fall",
  "winter",
  "table",
  "tables",
  "figure",
  "figures",
  "fig",
  "section",
  "chapter",
  "appendix",
  "supplement",
  "eq",
  "equation",
  "version",
  "release",
  "update",
  "phase",
  "wave",
  "cohort",
  "trial",
  "study",
  "survey",
  "census",
  "report",
  "year",
  "fy",
  "q1",
  "q2",
  "q3",
  "q4",
]);

export const SURNAME_PARTICLES: readonly string[] = [
  "van der ",
  "de la ",
  "van ",
  "von ",
  "de ",
  "del ",
  "di ",
  "da ",
  "le ",
  "la ",
  "du ",
];

export const AUTHOR_YEAR_PREFIXES: readonly string[] = [
  "see also ",
  "see ",
  "e.g., ",
  "e.g. ",
  "cf. ",
];

export const FIRST_CITATION_ORDER_STYLES: readonly string[] = [
  "unsrt",
  "ieee",
  "vancouver",
  "nature",
  "ama",
];

const MAX_KEYS_PER_MARKER = 64;
const MAX_MULTICITE_GROUPS = 16;
const MAX_PANDOC_AFFIX_LEN = 100;
const MAX_BRACKET_LEN = 2_000;
const MAX_CITE_OPT_LEN = 200;
const MAX_CITE_KEY_GROUP_LEN = 2_000;
const MAX_NUMERIC_RANGE_SPAN = 30;
const MAX_PAREN_LEN = 300;
const MAX_SURNAME_LEN = 40;
const MAX_NARRATIVE_LOOKBACK = 60;

export interface WordSpan {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

export interface AuthorYearQuery {
  readonly surname: string;
  readonly surnameFolded: string;
  readonly year: string;
  readonly extraYears: readonly string[];
  readonly isOrgAcronym: boolean;
  readonly locator: string | null;
}

export interface CitationMarker {
  readonly start: number;
  readonly end: number;
  readonly rawText: string;
  readonly rule: CitationRuleKind;
  readonly kind: MarkerKind;
  readonly narrative: boolean;
  readonly keys: readonly string[];
  readonly numericIds: readonly number[];
  readonly authorYears: readonly AuthorYearQuery[];
  readonly authoritativeRefIds?: readonly string[];
}

export interface AuthoritativeDocxMarker {
  readonly start: number;
  readonly end: number;
  readonly kind: "docx_field" | "docx_superscript";
  readonly keys?: readonly string[];
  readonly numericIds?: readonly number[];
  readonly refIds?: readonly string[];
}

export interface ScanCitationsOptions {
  readonly customCiteMacros?: ReadonlySet<string>;
  readonly hasKnownNumberingOrder?: boolean;
  readonly numberedBibSize?: number;
  readonly bibKeys?: ReadonlySet<string>;
  readonly docxMarkers?: readonly AuthoritativeDocxMarker[];
}

export interface BibliographyEntry {
  readonly refId: string;
  readonly key: string;
  readonly orderIndex?: number;
  readonly firstAuthorFamily?: string;
  readonly corporateAuthor?: string;
  readonly shortauthor?: string;
  readonly shorthand?: string;
  readonly year?: string;
}

export interface MarkdownNumberedRef {
  readonly index: number;
  readonly text: string;
  readonly lineStart: number;
}

export type MarkerResolutionStatus =
  | "RESOLVED"
  | "UNRESOLVED_KEY"
  | "AMBIGUOUS"
  | "POSSIBLE_CITATION";

export interface ResolvedCitationMarker {
  readonly marker: CitationMarker;
  readonly status: MarkerResolutionStatus;
  readonly refIds: readonly string[];
  readonly unresolvedKeys: readonly string[];
  readonly ambiguousCandidates: readonly string[];
}

export interface ResolveCitationsOptions {
  readonly entries?: readonly BibliographyEntry[];
  readonly bibItems?: readonly { readonly key: string; readonly label: string | null }[];
  readonly docxNumberedRefs?: readonly string[];
  readonly markdownNumberedRefs?: readonly MarkdownNumberedRef[];
  readonly bibStyle?: string;
  readonly report?: ImportQualityReport;
}

export interface CitationResolutionResult {
  readonly resolvedMarkers: readonly ResolvedCitationMarker[];
  readonly resolvedRefIds: readonly string[];
  readonly unresolvedKeys: readonly string[];
  readonly possibleCitations: readonly { readonly range: TextRangeLike; readonly text: string }[];
  readonly ambiguousMarkers: readonly ResolvedCitationMarker[];
  readonly report: ImportQualityReport;
}

function isMaskChar(cp: number): boolean {
  return cp === 0xe000;
}

function isSentenceStopChar(cp: number): boolean {
  return cp === 0x2e || cp === 0x3f || cp === 0x21 || cp === 0x3b || cp === 0x0a || cp === 0x0d;
}

function containsAsciiSubstrCaseInsensitive(haystack: string, needleLower: string): boolean {
  const n = haystack.length;
  const m = needleLower.length;
  if (m === 0) return true;
  if (n < m) return false;
  for (let i = 0; i <= n - m; i++) {
    let ok = true;
    for (let j = 0; j < m; j++) {
      let c = haystack.charCodeAt(i + j);
      if (c >= 65 && c <= 90) c += 32;
      if (c !== needleLower.charCodeAt(j)) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

function trimSpaceLocal(input: string): string {
  let left = 0;
  const n = input.length;
  while (left < n && isSpace(input.charCodeAt(left))) {
    left++;
  }
  let right = n;
  while (right > left && isSpace(input.charCodeAt(right - 1))) {
    right--;
  }
  return input.slice(left, right);
}

function advanceExclusionIndex(
  excluded: readonly TextRangeLike[] | undefined,
  exIdx: number,
  pos: number,
): number {
  if (excluded === undefined) return 0;
  while (exIdx < excluded.length) {
    const r = excluded[exIdx];
    if (r !== undefined && pos >= r.end) {
      exIdx++;
    } else {
      break;
    }
  }
  return exIdx;
}

function isInsideExclusion(
  excluded: readonly TextRangeLike[] | undefined,
  exIdx: number,
  pos: number,
): TextRangeLike | null {
  if (excluded === undefined || exIdx >= excluded.length) return null;
  const r = excluded[exIdx];
  if (r !== undefined && pos >= r.start && pos < r.end) {
    return r;
  }
  return null;
}

function forEachWordSpan(
  text: string,
  start: number,
  end: number,
  excludedSpans: readonly TextRangeLike[] | undefined,
  onWord: (wordStart: number, wordEnd: number, letterCount: number) => void,
): void {
  const limit = Math.min(end, text.length);
  let i = Math.max(0, start);
  let exIdx = advanceExclusionIndex(excludedSpans, 0, i);

  while (i < limit) {
    exIdx = advanceExclusionIndex(excludedSpans, exIdx, i);
    const activeEx = isInsideExclusion(excludedSpans, exIdx, i);
    if (activeEx !== null) {
      i = Math.min(limit, activeEx.end);
      continue;
    }

    const cu = text.charCodeAt(i);
    if (isMaskChar(cu)) {
      i++;
      continue;
    }

    let wordStart: number;
    let cur: number;
    let prevIsLetter: boolean;
    let letterCount: number;

    if (cu < 0x80) {
      const firstIsAsciiLetter = (cu >= 65 && cu <= 90) || (cu >= 97 && cu <= 122);
      const firstIsAsciiDigit = cu >= 48 && cu <= 57;
      if (!firstIsAsciiLetter && !firstIsAsciiDigit) {
        i++;
        continue;
      }
      wordStart = i;
      cur = i + 1;
      prevIsLetter = firstIsAsciiLetter;
      letterCount = firstIsAsciiLetter ? 1 : 0;
    } else {
      const unit = codePointAtSafe(text, i);
      const firstIsLetter = !unit.isUnpairedSurrogate && isLetter(unit.cp, false);
      if (unit.isUnpairedSurrogate || !(firstIsLetter || isDigit(unit.cp))) {
        i += unit.len;
        continue;
      }
      wordStart = i;
      cur = i + unit.len;
      prevIsLetter = firstIsLetter;
      letterCount = firstIsLetter ? 1 : 0;
    }

    while (cur < limit) {
      exIdx = advanceExclusionIndex(excludedSpans, exIdx, cur);
      if (isInsideExclusion(excludedSpans, exIdx, cur) !== null) {
        break;
      }
      const nextCu = text.charCodeAt(cur);
      if (isMaskChar(nextCu)) {
        break;
      }
      if (nextCu < 0x80) {
        const nextIsAsciiLetter =
          (nextCu >= 65 && nextCu <= 90) || (nextCu >= 97 && nextCu <= 122);
        const nextIsAsciiDigit = nextCu >= 48 && nextCu <= 57;
        if (nextIsAsciiLetter || nextIsAsciiDigit) {
          if (nextIsAsciiLetter) letterCount++;
          prevIsLetter = nextIsAsciiLetter;
          cur++;
          continue;
        }
        if ((nextCu === 0x27 || nextCu === 0x2d) && cur + 1 < limit) {
          const peekExIdx = advanceExclusionIndex(excludedSpans, exIdx, cur + 1);
          if (isInsideExclusion(excludedSpans, peekExIdx, cur + 1) === null) {
            const afterCu = text.charCodeAt(cur + 1);
            if (!isMaskChar(afterCu)) {
              if (afterCu < 0x80) {
                const afterIsAsciiLetter =
                  (afterCu >= 65 && afterCu <= 90) || (afterCu >= 97 && afterCu <= 122);
                const afterIsAsciiDigit = afterCu >= 48 && afterCu <= 57;
                if (afterIsAsciiLetter || afterIsAsciiDigit) {
                  if (afterIsAsciiLetter) letterCount++;
                  prevIsLetter = afterIsAsciiLetter;
                  cur += 2;
                  continue;
                }
              } else {
                const after = codePointAtSafe(text, cur + 1);
                if (!after.isUnpairedSurrogate) {
                  const afterIsLetter = isLetter(after.cp, false);
                  if (afterIsLetter || isDigit(after.cp)) {
                    if (afterIsLetter) letterCount++;
                    prevIsLetter = afterIsLetter;
                    cur += 1 + after.len;
                    continue;
                  }
                }
              }
            }
          }
        }
        break;
      }

      const nextUnit = codePointAtSafe(text, cur);
      if (nextUnit.isUnpairedSurrogate) {
        break;
      }
      const nextIsLetter = isLetter(nextUnit.cp, prevIsLetter);
      if (nextIsLetter || isDigit(nextUnit.cp)) {
        if (nextIsLetter) letterCount++;
        prevIsLetter = nextIsLetter;
        cur += nextUnit.len;
        continue;
      }
      break;
    }

    onWord(wordStart, cur, letterCount);
    i = cur;
  }
}

/**
 * Shared §4.1 word scanner: extracts maximal runs of `LETTER`, `DIGIT`, and internal
 * `'` (`U+0027`) or `-` (`U+002D`) strictly flanked by `LETTER`/`DIGIT` on both sides,
 * skipping `MASK_CHAR` (`U+E000`) and sorted `excludedSpans` (e.g. citation markers).
 */
export function extractWordSpans(
  text: string,
  start: number = 0,
  end: number = text.length,
  excludedSpans?: readonly TextRangeLike[],
): WordSpan[] {
  const words: WordSpan[] = [];
  forEachWordSpan(text, start, end, excludedSpans, (wordStart, wordEnd) => {
    words.push({
      start: wordStart,
      end: wordEnd,
      text: text.slice(wordStart, wordEnd),
    });
  });
  return words;
}

/**
 * Computes word count and whether any word has `>= 3` `LETTER` code points without allocating slices.
 */
export function getWordSpanStats(
  text: string,
  start: number = 0,
  end: number = text.length,
  excludedSpans?: readonly TextRangeLike[],
): { readonly wordCount: number; readonly hasLongWord: boolean } {
  let wordCount = 0;
  let hasLongWord = false;
  forEachWordSpan(text, start, end, excludedSpans, (_s, _e, letterCount) => {
    wordCount++;
    if (letterCount >= 3) {
      hasLongWord = true;
    }
  });
  return { wordCount, hasLongWord };
}

/**
 * Counts §4.1 words inside `[start, end)` while ignoring `MASK_CHAR` and `excludedSpans`.
 */
export function countWords(
  text: string,
  start: number = 0,
  end: number = text.length,
  excludedSpans?: readonly TextRangeLike[],
): number {
  let wordCount = 0;
  forEachWordSpan(text, start, end, excludedSpans, () => {
    wordCount++;
  });
  return wordCount;
}

interface BackwardDelims {
  readonly nextCloseBracket: Int32Array;
  readonly nextOpenBracket: Int32Array;
  readonly nextCloseParen: Int32Array;
  readonly nextOpenParen: Int32Array;
  readonly nextCloseBrace: Int32Array;
  readonly nextOpenBrace: Int32Array;
  readonly nextMask: Int32Array;
}

function buildBackwardDelims(text: string): BackwardDelims {
  const n = text.length;
  const nextCloseBracket = new Int32Array(n + 1);
  const nextOpenBracket = new Int32Array(n + 1);
  const nextCloseParen = new Int32Array(n + 1);
  const nextOpenParen = new Int32Array(n + 1);
  const nextCloseBrace = new Int32Array(n + 1);
  const nextOpenBrace = new Int32Array(n + 1);
  const nextMask = new Int32Array(n + 1);

  let cBracket = n;
  let oBracket = n;
  let cParen = n;
  let oParen = n;
  let cBrace = n;
  let oBrace = n;
  let mPos = n;

  nextCloseBracket[n] = n;
  nextOpenBracket[n] = n;
  nextCloseParen[n] = n;
  nextOpenParen[n] = n;
  nextCloseBrace[n] = n;
  nextOpenBrace[n] = n;
  nextMask[n] = n;

  for (let i = n - 1; i >= 0; i--) {
    const ch = text.charCodeAt(i);
    if (ch === 93) cBracket = i;
    else if (ch === 91) oBracket = i;
    else if (ch === 41) cParen = i;
    else if (ch === 40) oParen = i;
    else if (ch === 125) cBrace = i;
    else if (ch === 123) oBrace = i;
    else if (ch === 0xe000) mPos = i;

    nextCloseBracket[i] = cBracket;
    nextOpenBracket[i] = oBracket;
    nextCloseParen[i] = cParen;
    nextOpenParen[i] = oParen;
    nextCloseBrace[i] = cBrace;
    nextOpenBrace[i] = oBrace;
    nextMask[i] = mPos;
  }

  return {
    nextCloseBracket,
    nextOpenBracket,
    nextCloseParen,
    nextOpenParen,
    nextCloseBrace,
    nextOpenBrace,
    nextMask,
  };
}

function isAllKeyChars(key: string): boolean {
  if (key.length === 0) return false;
  let i = 0;
  while (i < key.length) {
    const unit = codePointAtSafe(key, i);
    if (unit.isUnpairedSurrogate || !isKeyChar(unit.cp)) {
      return false;
    }
    i += unit.len;
  }
  return true;
}

function isWordBoundaryBefore(text: string, pos: number): boolean {
  if (pos <= 0) return true;
  const cu = text.charCodeAt(pos - 1);
  if (isMaskChar(cu) || isDigit(cu)) return false;
  let prevStart = pos - 1;
  if (cu >= 0xdc00 && cu <= 0xdfff && prevStart > 0) {
    const high = text.charCodeAt(prevStart - 1);
    if (high >= 0xd800 && high <= 0xdbff) {
      prevStart--;
    }
  }
  return !isLetterAt(text, prevStart);
}

function stripParticlesLower(loweredSurname: string): string {
  for (const particle of SURNAME_PARTICLES) {
    if (loweredSurname.startsWith(particle)) {
      return loweredSurname.slice(particle.length);
    }
  }
  return loweredSurname;
}

function parseLatexCiteCandidate(
  text: string,
  p: number,
  delims: BackwardDelims,
  stopLimit: number,
  customCiteMacros: ReadonlySet<string> | undefined,
): CitationMarker | null {
  const n = stopLimit;
  if (p + 1 >= n || !isAsciiLetter(text.charCodeAt(p + 1))) {
    return null;
  }
  let cmdEnd = p + 2;
  while (cmdEnd < n && isAsciiLetter(text.charCodeAt(cmdEnd))) {
    cmdEnd++;
  }
  const cmd = text.slice(p + 1, cmdEnd);
  const isCustomCite =
    customCiteMacros !== undefined &&
    containsAsciiSubstrCaseInsensitive(cmd, "cite") &&
    customCiteMacros.has(cmd);
  if (!CITE_COMMANDS.has(cmd) && !isCustomCite) {
    return null;
  }

  let cur = cmdEnd;
  if (cur < n && text.charCodeAt(cur) === 42) {
    cur++;
  }

  const isMulti = MULTICITE_COMMANDS.has(cmd);
  const maxGroups = isMulti ? MAX_MULTICITE_GROUPS : 1;
  const keys: string[] = [];
  let acceptedEnd = -1;

  for (let g = 0; g < maxGroups; g++) {
    let scanPos = cur;
    for (let opt = 0; opt < 2; opt++) {
      const adjOpt = skipAdjacentWhitespace(text, scanPos, n);
      if (adjOpt.crossedBlankLine || adjOpt.pos >= n || text.charCodeAt(adjOpt.pos) !== 91) {
        break;
      }
      const openBrk = adjOpt.pos;
      const closeBrk = delims.nextCloseBracket[openBrk + 1]!;
      const nextOpenBrk = delims.nextOpenBracket[openBrk + 1]!;
      const nextMaskPos = delims.nextMask[openBrk + 1]!;
      if (
        closeBrk >= n ||
        closeBrk >= nextMaskPos ||
        nextOpenBrk < closeBrk ||
        closeBrk - openBrk > MAX_CITE_OPT_LEN
      ) {
        return g === 0 ? null : buildLatexMarker();
      }
      scanPos = closeBrk + 1;
    }

    const adjBrace = skipAdjacentWhitespace(text, scanPos, n);
    if (adjBrace.crossedBlankLine || adjBrace.pos >= n || text.charCodeAt(adjBrace.pos) !== 123) {
      if (g === 0) return null;
      break;
    }
    const openBrace = adjBrace.pos;
    const closeBrace = delims.nextCloseBrace[openBrace + 1]!;
    const nextOpenBrace = delims.nextOpenBrace[openBrace + 1]!;
    const nextMaskPos = delims.nextMask[openBrace + 1]!;
    if (
      closeBrace >= n ||
      closeBrace >= nextMaskPos ||
      nextOpenBrace < closeBrace ||
      closeBrace - openBrace > MAX_CITE_KEY_GROUP_LEN
    ) {
      if (g === 0) return null;
      break;
    }

    const inner = text.slice(openBrace + 1, closeBrace);
    const rawParts = inner.split(",");
    for (const part of rawParts) {
      const k = trimSpaceLocal(part);
      if (!isAllKeyChars(k) || keys.length >= MAX_KEYS_PER_MARKER) {
        return null;
      }
      keys.push(k);
    }

    acceptedEnd = closeBrace + 1;
    cur = acceptedEnd;
  }

  function buildLatexMarker(): CitationMarker | null {
    if (acceptedEnd === -1 || keys.length === 0) return null;
    return {
      start: p,
      end: acceptedEnd,
      rawText: text.slice(p, acceptedEnd),
      rule: "latex_cite",
      kind: "EXPLICIT",
      narrative: NARRATIVE_CITE_COMMANDS.has(cmd),
      keys,
      numericIds: [],
      authorYears: [],
    };
  }

  return buildLatexMarker();
}

function tryParsePandocBracket(
  text: string,
  p: number,
  q: number,
): CitationMarker | null {
  const inner = text.slice(p + 1, q);
  if (inner.indexOf("@") === -1) return null;
  const items = inner.split(";");
  if (items.length === 0 || items.length > MAX_KEYS_PER_MARKER) return null;

  const keys: string[] = [];
  for (const item of items) {
    let atIdx = -1;
    for (let k = 0; k < item.length; k++) {
      if (item.charCodeAt(k) === 64) {
        if (atIdx !== -1) return null;
        atIdx = k;
      }
    }
    if (atIdx === -1) return null;

    let prefixEnd = atIdx;
    if (atIdx > 0 && item.charCodeAt(atIdx - 1) === 45) {
      if (atIdx - 1 === 0 || isSpace(item.charCodeAt(atIdx - 2)) || item.charCodeAt(atIdx - 2) === 44) {
        prefixEnd = atIdx - 1;
      }
    }
    if (prefixEnd > 0) {
      const chBefore = item.charCodeAt(prefixEnd - 1);
      if (chBefore === 46 || isDigit(chBefore) || isLetterAt(item, prefixEnd - 1)) {
        return null;
      }
    }

    let keyEnd = atIdx + 1;
    while (keyEnd < item.length) {
      const unit = codePointAtSafe(item, keyEnd);
      if (unit.isUnpairedSurrogate || !isKeyChar(unit.cp)) {
        break;
      }
      keyEnd += unit.len;
    }
    if (keyEnd === atIdx + 1) return null;

    const key = item.slice(atIdx + 1, keyEnd);
    const affixLen = prefixEnd + (item.length - keyEnd);
    if (affixLen > MAX_PANDOC_AFFIX_LEN) {
      return null;
    }
    keys.push(key);
  }

  return {
    start: p,
    end: q + 1,
    rawText: text.slice(p, q + 1),
    rule: "pandoc_bracket",
    kind: "EXPLICIT",
    narrative: false,
    keys,
    numericIds: [],
    authorYears: [],
  };
}

function isBareNumberToken(token: string): boolean {
  if (token.length === 0) return false;
  let start = 0;
  if (token.charCodeAt(start) === 40 /* '(' */) {
    start++;
  }
  if (start >= token.length) return false;
  let hasSign = false;
  const signCh = token.charCodeAt(start);
  if (signCh === 45 /* '-' */ || signCh === 43 /* '+' */ || signCh === 0x2212 /* '−' */) {
    hasSign = true;
    start++;
  }
  if (start >= token.length) return false;
  let sawSep = false;
  const bodyLen = token.length - start;
  for (let i = start; i < token.length; i++) {
    const ch = token.charCodeAt(i);
    if (isDigit(ch)) continue;
    if ((ch === 46 || ch === 44) && !sawSep && i > start && i + 1 < token.length) {
      sawSep = true;
      continue;
    }
    return false;
  }
  if (!sawSep && !hasSign && bodyLen === 4) {
    const yr = Number(token.slice(start));
    if (yr >= 1900 && yr <= 2099) {
      return false;
    }
  }
  return true;
}

function parseAsciiInt1to4(s: string): number | null {
  if (s.length < 1 || s.length > 4) return null;
  for (let i = 0; i < s.length; i++) {
    if (!isDigit(s.charCodeAt(i))) return null;
  }
  return Number(s);
}

interface NumericLookbackState {
  cursor: number;
  w1: string | undefined;
  w2: string | undefined;
  tokStart: number;
  tokEnd: number;
  inTok: boolean;
}

function advanceNumericLookback(
  text: string,
  state: NumericLookbackState,
  lastMarkerEnd: number,
  p: number,
): void {
  if (lastMarkerEnd > state.cursor) {
    state.cursor = lastMarkerEnd;
    state.w1 = undefined;
    state.w2 = undefined;
    state.tokStart = lastMarkerEnd;
    state.tokEnd = lastMarkerEnd;
    state.inTok = false;
  }

  let segStart = state.cursor;
  for (let k = p - 1; k >= state.cursor; k--) {
    const cp = text.charCodeAt(k);
    const isDecimalDot = cp === 46 && k + 1 < p && isDigit(text.charCodeAt(k + 1));
    if (isMaskChar(cp) || (isSentenceStopChar(cp) && !isDecimalDot)) {
      segStart = k + 1;
      state.w1 = undefined;
      state.w2 = undefined;
      state.tokStart = segStart;
      state.tokEnd = segStart;
      state.inTok = false;
      break;
    }
  }

  const isPureDigitsSpan = (s: number, e: number): boolean => {
    if (s < 0 || e <= s) return false;
    for (let idx = s; idx < e; idx++) {
      if (!isDigit(text.charCodeAt(idx))) return false;
    }
    return true;
  };

  let aStart = -1;
  let aEnd = -1;
  let bStart = -1;
  let bEnd = -1;
  let bMergedDecimal = false;
  forEachWordSpan(text, segStart, p, undefined, (ws, we) => {
    if (
      bStart !== -1 &&
      !bMergedDecimal &&
      ws === bEnd + 1 &&
      text.charCodeAt(bEnd) === 46 &&
      isPureDigitsSpan(bStart, bEnd) &&
      isPureDigitsSpan(ws, we)
    ) {
      bEnd = we;
      bMergedDecimal = true;
      return;
    }
    aStart = bStart;
    aEnd = bEnd;
    bStart = ws;
    bEnd = we;
    bMergedDecimal = false;
  });
  if (aStart !== -1) {
    state.w2 = text.slice(aStart, aEnd);
    state.w1 = text.slice(bStart, bEnd);
  } else if (bStart !== -1) {
    state.w2 = state.w1;
    state.w1 = text.slice(bStart, bEnd);
  }

  for (let i = segStart; i < p; i++) {
    if (isSpace(text.charCodeAt(i))) {
      state.inTok = false;
    } else {
      if (!state.inTok) {
        state.tokStart = i;
        state.inTok = true;
      }
      state.tokEnd = i + 1;
    }
  }

  state.cursor = p;
}

function tryParseNumericBracket(
  text: string,
  p: number,
  q: number,
  lastMarkerEnd: number,
  numericLookback: NumericLookbackState,
  options: ScanCitationsOptions | undefined,
): CitationMarker | null {
  const inner = text.slice(p + 1, q);
  if (inner.indexOf(".") !== -1) return null;

  const segments = inner.split(",");
  if (segments.length === 0) return null;

  const expanded: number[] = [];
  let singleRangeLo = -1;
  let singleRangeHi = -1;
  let singlePairCount = 0;

  for (const rawSeg of segments) {
    const seg = trimSpaceLocal(rawSeg);
    if (seg.length === 0) return null;

    let dashIdx = -1;
    for (let k = 0; k < seg.length; k++) {
      const ch = seg.charCodeAt(k);
      if (ch === 45 || ch === 0x2013) {
        if (dashIdx !== -1) return null;
        dashIdx = k;
      }
    }

    if (dashIdx === -1) {
      const val = parseAsciiInt1to4(seg);
      if (val === null || val < 1) return null;
      expanded.push(val);
      singlePairCount++;
    } else {
      const leftStr = trimSpaceLocal(seg.slice(0, dashIdx));
      const rightStr = trimSpaceLocal(seg.slice(dashIdx + 1));
      const a = parseAsciiInt1to4(leftStr);
      const b = parseAsciiInt1to4(rightStr);
      if (a === null || b === null || a < 1 || b < a || b - a > MAX_NUMERIC_RANGE_SPAN) {
        return null;
      }
      if (segments.length === 1) {
        singleRangeLo = a;
        singleRangeHi = b;
      }
      for (let v = a; v <= b; v++) {
        expanded.push(v);
      }
    }
  }

  if (expanded.length === 0) return null;

  if (options?.numberedBibSize !== undefined) {
    for (const v of expanded) {
      if (v > options.numberedBibSize) {
        return null;
      }
    }
  }

  // Advance incremental O(n) lookback for token immediately before `[` and last 2 words before `[`
  advanceNumericLookback(text, numericLookback, lastMarkerEnd, p);
  if (
    numericLookback.tokEnd > numericLookback.tokStart &&
    text.charCodeAt(numericLookback.tokEnd - 1) === 0x00b1
  ) {
    return null;
  }

  if (numericLookback.w1 !== undefined && INTERVAL_CONTEXT_WORDS.has(normLower(numericLookback.w1))) {
    return null;
  }
  if (numericLookback.w2 !== undefined && INTERVAL_CONTEXT_WORDS.has(normLower(numericLookback.w2))) {
    return null;
  }

  const isExactTwoNumberInterval =
    (segments.length === 2 &&
      singlePairCount === 2 &&
      expanded.length === 2 &&
      expanded[0]! < expanded[1]!) ||
    (segments.length === 1 && singleRangeLo !== -1 && singleRangeLo < singleRangeHi);

  const lastTok = isExactTwoNumberInterval
    ? text.slice(numericLookback.tokStart, numericLookback.tokEnd)
    : "";
  if (isExactTwoNumberInterval && isBareNumberToken(lastTok)) {
    let after = q + 1;
    while (after < text.length && isSpace(text.charCodeAt(after))) {
      after++;
    }
    if (after < text.length) {
      const nextCh = text.charCodeAt(after);
      if (
        !isMaskChar(nextCh) &&
        (isLetterAt(text, after) ||
          nextCh === 37 || // '%'
          nextCh === 0x00b0 || // '°'
          nextCh === 0x03bc || // 'μ'
          nextCh === 0x00b5) // 'µ'
      ) {
        return null;
      }
    }
  }

  const kind: MarkerKind = options?.hasKnownNumberingOrder === true ? "EXPLICIT" : "HEURISTIC";
  return {
    start: p,
    end: q + 1,
    rawText: text.slice(p, q + 1),
    rule: "numeric_bracket",
    kind,
    narrative: false,
    keys: [],
    numericIds: expanded,
    authorYears: [],
  };
}

interface ParsedSurname {
  readonly surname: string;
  readonly endPos: number;
  readonly isOrgAcronym: boolean;
}

function parseSurnameAt(text: string, start: number, limit: number): ParsedSurname | null {
  let cur = start;
  const lowerSlice = normLower(text.slice(start, Math.min(limit, start + 12)));
  for (const particle of SURNAME_PARTICLES) {
    if (lowerSlice.startsWith(particle)) {
      cur += particle.length;
      break;
    }
  }

  if (cur >= limit) return null;
  const firstUnit = codePointAtSafe(text, cur);
  if (firstUnit.isUnpairedSurrogate || !isUpper(firstUnit.cp)) {
    return null;
  }

  let endPos = cur + firstUnit.len;
  let coreCpCount = 1;
  let allCoreUpper = true;
  let prevIsLetter = true;

  while (endPos < limit && endPos - start < MAX_SURNAME_LEN) {
    const unit = codePointAtSafe(text, endPos);
    if (unit.isUnpairedSurrogate) break;
    if (isLetter(unit.cp, prevIsLetter)) {
      prevIsLetter = true;
      if (!isCombiningMark(unit.cp)) {
        coreCpCount++;
        if (!isUpper(unit.cp)) {
          allCoreUpper = false;
        }
      }
      endPos += unit.len;
      continue;
    }
    if (unit.cp === 0x27 || unit.cp === 0x2d) {
      if (endPos + 1 < limit) {
        const after = codePointAtSafe(text, endPos + 1);
        if (!after.isUnpairedSurrogate && isLetter(after.cp, false)) {
          allCoreUpper = false;
          prevIsLetter = true;
          coreCpCount += 2;
          endPos += 1 + after.len;
          continue;
        }
      }
    }
    break;
  }

  if (endPos - start > MAX_SURNAME_LEN || coreCpCount < 2) {
    return null;
  }
  const isOrgAcronym = cur === start && allCoreUpper;
  if (allCoreUpper && (cur !== start || coreCpCount > 6)) {
    return null;
  }

  const fullSurname = text.slice(start, endPos);
  const fullLower = normLower(fullSurname);
  const coreLower = normLower(text.slice(cur, endPos));
  if (NON_NAME_WORDS.has(fullLower) || NON_NAME_WORDS.has(coreLower)) {
    return null;
  }

  return { surname: fullSurname, endPos, isOrgAcronym };
}

interface ParsedYearAndLocator {
  readonly year: string;
  readonly extraYears: readonly string[];
  readonly locator: string | null;
  readonly endPos: number;
}

function parseYearAndLocatorAt(text: string, start: number, limit: number): ParsedYearAndLocator | null {
  if (start + 4 > limit) return null;
  const prefix = text.slice(start, start + 2);
  if (prefix !== "19" && prefix !== "20") return null;
  if (!isDigit(text.charCodeAt(start + 2)) || !isDigit(text.charCodeAt(start + 3))) {
    return null;
  }

  let cur = start + 4;
  let baseYear = text.slice(start, cur);
  const extraYears: string[] = [];

  if (cur < limit) {
    const u = codePointAtSafe(text, cur);
    if (!u.isUnpairedSurrogate && u.cp >= 97 && u.cp <= 122) {
      const nextAfterLetter = cur + 1 < limit ? text.charCodeAt(cur + 1) : -1;
      const isAlphaContinuation =
        cur + 1 < limit && isLetterAt(text, cur + 1);
      if (isAlphaContinuation) {
        return null;
      }
      baseYear = `${baseYear}${text.charAt(cur)}`;
      cur++;
      if (nextAfterLetter === 44) {
        // Optional `,b` lowercase suffix list (`2020a,b`), stop before `, p.` / `, pp.` / `, ch.` / `, fig.`
        let listCur = cur;
        while (
          listCur + 1 < limit &&
          text.charCodeAt(listCur) === 44 &&
          text.charCodeAt(listCur + 1) >= 97 &&
          text.charCodeAt(listCur + 1) <= 122 &&
          (listCur + 2 >= limit ||
            text.charCodeAt(listCur + 2) === 44 ||
            isSpace(text.charCodeAt(listCur + 2)))
        ) {
          extraYears.push(`${text.slice(start, start + 4)}${text.charAt(listCur + 1)}`);
          listCur += 2;
        }
        cur = listCur;
      }
    } else if (!u.isUnpairedSurrogate && (isLetter(u.cp, false) || isDigit(u.cp))) {
      return null;
    }
  }

  let locator: string | null = null;
  if (cur < limit) {
    const rest = text.slice(cur, limit);
    const locatorPrefixes = [", pp. ", ", p. ", ", ch. ", ", fig. "];
    let matchedPrefix: string | null = null;
    for (const lp of locatorPrefixes) {
      if (rest.startsWith(lp)) {
        matchedPrefix = lp;
        break;
      }
    }
    if (matchedPrefix === null) {
      return null;
    }
    let numPos = cur + matchedPrefix.length;
    let d1 = 0;
    while (numPos + d1 < limit && isDigit(text.charCodeAt(numPos + d1))) {
      d1++;
    }
    if (d1 < 1 || d1 > 5) return null;
    numPos += d1;

    if (matchedPrefix === ", pp. ") {
      if (numPos < limit && (text.charCodeAt(numPos) === 45 || text.charCodeAt(numPos) === 0x2013)) {
        numPos++;
        let d2 = 0;
        while (numPos + d2 < limit && isDigit(text.charCodeAt(numPos + d2))) {
          d2++;
        }
        if (d2 < 1 || d2 > 5) return null;
        numPos += d2;
      }
    }
    if (numPos !== limit) return null;
    locator = text.slice(cur + 2, limit);
    cur = limit;
  }

  return { year: baseYear, extraYears, locator, endPos: cur };
}

function parseAuthorContinuation(
  text: string,
  afterSurname: number,
  limit: number,
): number {
  if (text.startsWith(" et al.", afterSurname)) {
    return afterSurname + " et al.".length;
  }
  const conj = text.startsWith(" and ", afterSurname)
    ? " and "
    : text.startsWith(" & ", afterSurname)
      ? " & "
      : null;
  if (conj !== null) {
    const secondStart = afterSurname + conj.length;
    const second = parseSurnameAt(text, secondStart, limit);
    if (second !== null) {
      return second.endPos;
    }
  }
  return afterSurname;
}

function parseAuthorYearItem(rawItem: string): AuthorYearQuery | null {
  const item = trimSpaceLocal(rawItem);
  if (item.length === 0) return null;
  let cur = 0;
  const lowerStart = normLower(item.slice(0, Math.min(item.length, 10)));
  for (const prefix of AUTHOR_YEAR_PREFIXES) {
    if (lowerStart.startsWith(prefix)) {
      cur += prefix.length;
      while (cur < item.length && isSpace(item.charCodeAt(cur))) {
        cur++;
      }
      break;
    }
  }

  const s1 = parseSurnameAt(item, cur, item.length);
  if (s1 === null) return null;

  let afterAuthor = parseAuthorContinuation(item, s1.endPos, item.length);
  if (afterAuthor < item.length && item.charCodeAt(afterAuthor) === 44) {
    afterAuthor++;
  }
  if (afterAuthor >= item.length || item.charCodeAt(afterAuthor) !== 32) {
    return null;
  }
  const yearStart = afterAuthor + 1;
  const parsedYear = parseYearAndLocatorAt(item, yearStart, item.length);
  if (parsedYear === null || parsedYear.endPos !== item.length) {
    return null;
  }

  return {
    surname: s1.surname,
    surnameFolded: foldLatin(stripParticlesLower(normLower(s1.surname))),
    year: parsedYear.year,
    extraYears: parsedYear.extraYears,
    isOrgAcronym: s1.isOrgAcronym,
    locator: parsedYear.locator,
  };
}

function tryParseAuthorYearParen(
  text: string,
  p: number,
  q: number,
): CitationMarker | null {
  const inner = text.slice(p + 1, q);
  const rawItems = inner.split(";");
  if (rawItems.length === 0) return null;
  const authorYears: AuthorYearQuery[] = [];
  for (const item of rawItems) {
    const parsed = parseAuthorYearItem(item);
    if (parsed === null) return null;
    authorYears.push(parsed);
  }
  return {
    start: p,
    end: q + 1,
    rawText: text.slice(p, q + 1),
    rule: "author_year_paren",
    kind: "HEURISTIC",
    narrative: false,
    keys: [],
    numericIds: [],
    authorYears,
  };
}

function tryParseAuthorYearNarrative(
  text: string,
  p: number,
  q: number,
  lastMarkerEnd: number,
): CitationMarker | null {
  if (p < 2 || text.charCodeAt(p - 1) !== 32) return null;
  const innerTrimmed = trimSpaceLocal(text.slice(p + 1, q));
  const parsedYear = parseYearAndLocatorAt(innerTrimmed, 0, innerTrimmed.length);
  if (parsedYear === null || parsedYear.endPos !== innerTrimmed.length) {
    return null;
  }

  const nameEnd = p - 1;
  let lookbackStart = Math.max(lastMarkerEnd, p - MAX_NARRATIVE_LOOKBACK);
  let scanBackStart = nameEnd - 1;
  if (
    nameEnd >= 7 &&
    text.charCodeAt(nameEnd - 1) === 0x2e &&
    normLower(text.slice(nameEnd - 7, nameEnd)) === " et al."
  ) {
    scanBackStart = nameEnd - 8;
  }
  for (let k = scanBackStart; k >= lookbackStart; k--) {
    const cp = text.charCodeAt(k);
    if (isMaskChar(cp) || isSentenceStopChar(cp)) {
      lookbackStart = k + 1;
      break;
    }
  }

  // Try longest surname match ending right before ` (`
  for (let cand = lookbackStart; cand < nameEnd; cand++) {
    if (!isWordBoundaryBefore(text, cand)) continue;
    const s1 = parseSurnameAt(text, cand, nameEnd);
    if (s1 === null) continue;
    const fullEnd = parseAuthorContinuation(text, s1.endPos, nameEnd);
    if (fullEnd === nameEnd) {
      return {
        start: cand,
        end: q + 1,
        rawText: text.slice(cand, q + 1),
        rule: "author_year_narrative",
        kind: "HEURISTIC",
        narrative: true,
        keys: [],
        numericIds: [],
        authorYears: [
          {
            surname: s1.surname,
            surnameFolded: foldLatin(stripParticlesLower(normLower(s1.surname))),
            year: parsedYear.year,
            extraYears: parsedYear.extraYears,
            isOrgAcronym: s1.isOrgAcronym,
            locator: parsedYear.locator,
          },
        ],
      };
    }
  }

  return null;
}

function isPandocTrailingStopChar(code: number): boolean {
  return code === 46 || code === 63 || code === 58 || code === 39;
}

function tryParsePandocNarrative(
  text: string,
  p: number,
  stopLimit: number,
  bibKeys: ReadonlySet<string> | undefined,
  bibKeysLower: ReadonlyMap<string, string> | undefined,
  maxBibKeyLen: number,
  maxBibKeyTrailingStops: number,
): CitationMarker | null {
  if (bibKeys === undefined || bibKeys.size === 0 || maxBibKeyLen <= 0) return null;
  if (p > 0) {
    const chBefore = text.charCodeAt(p - 1);
    let prevStart = p - 1;
    if (chBefore >= 0xdc00 && chBefore <= 0xdfff && prevStart > 0) {
      const high = text.charCodeAt(prevStart - 1);
      if (high >= 0xd800 && high <= 0xdbff) {
        prevStart--;
      }
    }
    if (
      chBefore === 46 ||
      chBefore === 91 ||
      isDigit(chBefore) ||
      isMaskChar(chBefore) ||
      isLetterAt(text, prevStart)
    ) {
      return null;
    }
  }

  let endPos = p + 1;
  while (endPos < stopLimit) {
    const cu = text.charCodeAt(endPos);
    if (cu < 0x80) {
      if (!isKeyChar(cu)) {
        break;
      }
      endPos++;
      continue;
    }
    const unit = codePointAtSafe(text, endPos);
    if (unit.isUnpairedSurrogate || !isKeyChar(unit.cp)) {
      break;
    }
    endPos += unit.len;
  }

  let coreEnd = endPos;
  while (coreEnd > p + 1 && isPandocTrailingStopChar(text.charCodeAt(coreEnd - 1))) {
    coreEnd--;
  }
  if (coreEnd - (p + 1) > maxBibKeyLen) {
    return null;
  }

  let testEnd = Math.min(endPos, coreEnd + maxBibKeyTrailingStops, p + 1 + maxBibKeyLen);
  while (testEnd > p + 1 && testEnd >= coreEnd) {
    const candidate = text.slice(p + 1, testEnd);
    if (bibKeys.has(candidate) || bibKeysLower?.has(normLower(candidate))) {
      return {
        start: p,
        end: testEnd,
        rawText: text.slice(p, testEnd),
        rule: "pandoc_narrative",
        kind: "EXPLICIT",
        narrative: true,
        keys: [candidate],
        numericIds: [],
        authorYears: [],
      };
    }
    const lastCh = candidate.charCodeAt(candidate.length - 1);
    if (isPandocTrailingStopChar(lastCh)) {
      testEnd--;
      continue;
    }
    break;
  }
  return null;
}

/**
 * Runs the linear-time O(n) citation-marker scanner (`02` §5.1–§5.2) across Rules 1–6.
 * Returned markers are strictly non-overlapping and sorted by `start`.
 */
export function scanCitations(text: string, options?: ScanCitationsOptions): CitationMarker[] {
  const n = text.length;
  const delims = buildBackwardDelims(text);
  const sortedDocx =
    options?.docxMarkers !== undefined && options.docxMarkers.length > 0
      ? [...options.docxMarkers].sort((a, b) => a.start - b.start)
      : [];

  let bibKeysLower: Map<string, string> | undefined;
  let maxBibKeyLen = 0;
  let maxBibKeyTrailingStops = 0;
  if (options?.bibKeys !== undefined && options.bibKeys.size > 0) {
    bibKeysLower = new Map();
    for (const k of options.bibKeys) {
      const low = normLower(k);
      if (k.length > maxBibKeyLen) maxBibKeyLen = k.length;
      if (low.length > maxBibKeyLen) maxBibKeyLen = low.length;
      let kStops = 0;
      while (kStops < k.length && isPandocTrailingStopChar(k.charCodeAt(k.length - 1 - kStops))) {
        kStops++;
      }
      if (kStops > maxBibKeyTrailingStops) maxBibKeyTrailingStops = kStops;
      let lStops = 0;
      while (lStops < low.length && isPandocTrailingStopChar(low.charCodeAt(low.length - 1 - lStops))) {
        lStops++;
      }
      if (lStops > maxBibKeyTrailingStops) maxBibKeyTrailingStops = lStops;
      if (!bibKeysLower.has(low)) {
        bibKeysLower.set(low, k);
      }
    }
  }

  const markers: CitationMarker[] = [];
  let p = 0;
  let docxIdx = 0;
  let lastMarkerEnd = 0;
  const numericLookback: NumericLookbackState = {
    cursor: 0,
    w1: undefined,
    w2: undefined,
    tokStart: 0,
    tokEnd: 0,
    inTok: false,
  };

  while (p < n) {
    while (docxIdx < sortedDocx.length && sortedDocx[docxIdx]!.end <= p) {
      docxIdx++;
    }
    const nextDocx = sortedDocx[docxIdx];
    const nextDocxStart = nextDocx !== undefined ? nextDocx.start : n;

    // Rule 6 — authoritative `.docx` field-code / superscript marker
    if (nextDocx !== undefined && p === nextDocx.start) {
      markers.push({
        start: nextDocx.start,
        end: nextDocx.end,
        rawText: text.slice(nextDocx.start, nextDocx.end),
        rule: nextDocx.kind,
        kind: "EXPLICIT",
        narrative: false,
        keys: nextDocx.keys ?? [],
        numericIds: nextDocx.numericIds ?? [],
        authorYears: [],
        ...(nextDocx.refIds !== undefined ? { authoritativeRefIds: nextDocx.refIds } : {}),
      });
      lastMarkerEnd = nextDocx.end;
      p = nextDocx.end;
      docxIdx++;
      continue;
    }

    const ch = text.charCodeAt(p);
    if (isMaskChar(ch)) {
      p++;
      continue;
    }

    // Rule 1 — LaTeX cite commands (skip `\\` and non-letter control symbols cleanly)
    if (ch === 92) {
      if (p + 1 < nextDocxStart && !isAsciiLetter(text.charCodeAt(p + 1))) {
        p += 2;
        continue;
      }
      const m = parseLatexCiteCandidate(
        text,
        p,
        delims,
        nextDocxStart,
        options?.customCiteMacros,
      );
      if (m !== null) {
        markers.push(m);
        lastMarkerEnd = m.end;
        p = m.end;
        continue;
      }
      let cmdEnd = p + 1;
      while (cmdEnd < nextDocxStart && isAsciiLetter(text.charCodeAt(cmdEnd))) {
        cmdEnd++;
      }
      p = cmdEnd > p + 1 ? cmdEnd : p + 1;
      continue;
    }

    // Rule 2 — Bracket markers (`[...]` Pandoc or Numeric)
    if (ch === 91) {
      const q = delims.nextCloseBracket[p + 1]!;
      const nextOpen = delims.nextOpenBracket[p + 1]!;
      const nextM = delims.nextMask[p + 1]!;
      if (
        q < nextDocxStart &&
        q < nextM &&
        nextOpen > q &&
        q - p <= MAX_BRACKET_LEN
      ) {
        const afterCh = q + 1 < n ? text.charCodeAt(q + 1) : -1;
        if (afterCh !== 40 && afterCh !== 91) {
          const pandoc = tryParsePandocBracket(text, p, q);
          if (pandoc !== null) {
            markers.push(pandoc);
            lastMarkerEnd = pandoc.end;
            p = pandoc.end;
            continue;
          }
          const numeric = tryParseNumericBracket(text, p, q, lastMarkerEnd, numericLookback, options);
          if (numeric !== null) {
            markers.push(numeric);
            lastMarkerEnd = numeric.end;
            p = numeric.end;
            continue;
          }
        }
      }
      p++;
      continue;
    }

    // Rule 3 — Pandoc narrative (`@key` in loaded `.bib`)
    if (ch === 64) {
      const pandocNar = tryParsePandocNarrative(
        text,
        p,
        nextDocxStart,
        options?.bibKeys,
        bibKeysLower,
        maxBibKeyLen,
        maxBibKeyTrailingStops,
      );
      if (pandocNar !== null) {
        markers.push(pandocNar);
        lastMarkerEnd = pandocNar.end;
        p = pandocNar.end;
        continue;
      }
      p++;
      continue;
    }

    // Rule 4 & Rule 5 — Author–year parenthetical and narrative (`(...)`)
    if (ch === 40) {
      const q = delims.nextCloseParen[p + 1]!;
      const nextOpen = delims.nextOpenParen[p + 1]!;
      const nextM = delims.nextMask[p + 1]!;
      if (
        q < nextDocxStart &&
        q < nextM &&
        nextOpen > q &&
        q - p <= MAX_PAREN_LEN
      ) {
        const paren = tryParseAuthorYearParen(text, p, q);
        if (paren !== null) {
          markers.push(paren);
          lastMarkerEnd = paren.end;
          p = paren.end;
          continue;
        }
        const nar = tryParseAuthorYearNarrative(text, p, q, lastMarkerEnd);
        if (nar !== null) {
          // Rule 5 marker range starts at surname (`nar.start < p`)
          markers.push(nar);
          lastMarkerEnd = nar.end;
          p = nar.end;
          continue;
        }
      }
      p++;
      continue;
    }

    p++;
  }

  return markers;
}

/**
 * Extracts a bibliography style from LaTeX `\bibliographystyle{...}` when present (`02` §5.4 rule 2).
 */
export function extractLatexBibStyle(source: string): string | undefined {
  const needle = "\\bibliographystyle";
  let pos = 0;
  while (pos < source.length) {
    const idx = source.indexOf(needle, pos);
    if (idx === -1) return undefined;
    const after = idx + needle.length;
    if (after < source.length && !isAsciiLetter(source.charCodeAt(after))) {
      const adj = skipAdjacentWhitespace(source, after, source.length);
      if (!adj.crossedBlankLine && adj.pos < source.length && source.charCodeAt(adj.pos) === 123) {
        const close = source.indexOf("}", adj.pos + 1);
        if (close !== -1 && close - adj.pos <= 128) {
          return trimSpaceLocal(source.slice(adj.pos + 1, close));
        }
      }
    }
    pos = after;
  }
  return undefined;
}

/**
 * Parses numbered Markdown reference lines (`1. ...` or `[1] ...`) under headings
 * canonicalized to `"references"` (`02` §5.4 rule 2).
 */
export function extractMarkdownNumberedReferences(
  source: string,
  preMaskResult: PreMaskResult,
): MarkdownNumberedRef[] {
  const refs: MarkdownNumberedRef[] = [];
  const transitions = preMaskResult.sectionTransitions;
  if (transitions.length === 0) return refs;

  const isInReferences = (offset: number): boolean => {
    let curLabel = "unlabeled";
    for (const tr of transitions) {
      if (tr.offset <= offset) {
        curLabel = tr.state.label;
      } else {
        break;
      }
    }
    return curLabel === "references";
  };

  const n = source.length;
  let lineStart = 0;
  while (lineStart < n) {
    let lineEnd = lineStart;
    while (lineEnd < n && source.charCodeAt(lineEnd) !== 10 && source.charCodeAt(lineEnd) !== 13) {
      lineEnd++;
    }
    const nextStart =
      lineEnd < n && source.charCodeAt(lineEnd) === 13 && lineEnd + 1 < n && source.charCodeAt(lineEnd + 1) === 10
        ? lineEnd + 2
        : lineEnd < n
          ? lineEnd + 1
          : n;

    if (isInReferences(lineStart)) {
      let sp = 0;
      while (sp < 3 && lineStart + sp < lineEnd && source.charCodeAt(lineStart + sp) === 32) {
        sp++;
      }
      const p = lineStart + sp;
      if (p < lineEnd) {
        if (source.charCodeAt(p) === 91) {
          let d = 0;
          while (p + 1 + d < lineEnd && isDigit(source.charCodeAt(p + 1 + d))) d++;
          if (
            d >= 1 &&
            d <= 4 &&
            p + 1 + d < lineEnd &&
            source.charCodeAt(p + 1 + d) === 93 &&
            p + 2 + d < lineEnd &&
            (source.charCodeAt(p + 2 + d) === 32 || source.charCodeAt(p + 2 + d) === 9)
          ) {
            const idx = Number(source.slice(p + 1, p + 1 + d));
            refs.push({
              index: idx,
              text: trimSpaceLocal(source.slice(p + 3 + d, lineEnd)),
              lineStart,
            });
          }
        } else if (isDigit(source.charCodeAt(p))) {
          let d = 0;
          while (p + d < lineEnd && isDigit(source.charCodeAt(p + d))) d++;
          if (
            d >= 1 &&
            d <= 4 &&
            p + d < lineEnd &&
            source.charCodeAt(p + d) === 46 &&
            p + d + 1 < lineEnd &&
            (source.charCodeAt(p + d + 1) === 32 || source.charCodeAt(p + d + 1) === 9)
          ) {
            const idx = Number(source.slice(p, p + d));
            refs.push({
              index: idx,
              text: trimSpaceLocal(source.slice(p + d + 2, lineEnd)),
              lineStart,
            });
          }
        }
      }
    }
    lineStart = nextStart;
  }

  return refs;
}

/**
 * Extracts uppercase initials of capitalized words in a corporate author name (`02` §5.4 rule 3).
 * E.g. `"{{World Health Organization}}"` -> `"WHO"`, `"Centers for Disease Control"` -> `"CDC"`.
 */
export function extractCorporateInitials(corporateAuthor: string): string {
  const words = extractWordSpans(corporateAuthor);
  const chars: string[] = [];
  for (const w of words) {
    const unit = codePointAtSafe(w.text, 0);
    if (!unit.isUnpairedSurrogate && isUpper(unit.cp)) {
      chars.push(w.text.slice(0, unit.len));
    }
  }
  return chars.join("");
}

function entryMatchesAuthorYear(entry: BibliographyEntry, q: AuthorYearQuery): boolean {
  if (entry.year === undefined) return false;
  const yearsMatch =
    entry.year === q.year || (q.extraYears.length > 0 && q.extraYears.includes(entry.year));
  if (!yearsMatch) return false;

  if (q.isOrgAcronym) {
    const lowerQ = normLower(q.surname);
    if (entry.shortauthor !== undefined && normLower(entry.shortauthor) === lowerQ) {
      return true;
    }
    if (entry.shorthand !== undefined && normLower(entry.shorthand) === lowerQ) {
      return true;
    }
    if (entry.corporateAuthor !== undefined) {
      const initials = extractCorporateInitials(entry.corporateAuthor);
      if (initials.length >= 2 && normLower(initials) === lowerQ) {
        return true;
      }
    }
    return false;
  }

  if (entry.firstAuthorFamily === undefined) return false;
  const entryFamilyFolded = foldLatin(stripParticlesLower(normLower(entry.firstAuthorFamily)));
  return entryFamilyFolded === q.surnameFolded;
}

function recordUnique(arr: string[], val: string): void {
  if (!arr.includes(val)) {
    arr.push(val);
  }
}

/**
 * Resolves scanned citation markers to canonical `refId`s under `02` §5.4 rules 1–4.
 */
export function resolveCitationMarkers(
  markers: readonly CitationMarker[],
  options?: ResolveCitationsOptions,
): CitationResolutionResult {
  const entries = options?.entries ?? [];
  const report = options?.report ?? createEmptyImportQualityReport();

  const exactKeyMap = new Map<string, BibliographyEntry[]>();
  const lowerKeyMap = new Map<string, BibliographyEntry[]>();
  for (const e of entries) {
    const exactList = exactKeyMap.get(e.key) ?? [];
    exactList.push(e);
    exactKeyMap.set(e.key, exactList);

    const low = normLower(e.key);
    const lowList = lowerKeyMap.get(low) ?? [];
    lowList.push(e);
    lowerKeyMap.set(low, lowList);
  }

  // Rule 2 numeric ordering priority (§5.4 item 2)
  const numberedOrderRefMap = new Map<number, string>();
  let hasExplicitOrder = false;

  if (options?.bibItems !== undefined && options.bibItems.length > 0) {
    hasExplicitOrder = true;
    for (let idx = 0; idx < options.bibItems.length; idx++) {
      const item = options.bibItems[idx]!;
      const found = exactKeyMap.get(item.key)?.[0] ?? lowerKeyMap.get(normLower(item.key))?.[0];
      numberedOrderRefMap.set(
        idx + 1,
        found !== undefined ? found.refId : `bibitem:${idx + 1}:${item.key}`,
      );
    }
  } else if (options?.docxNumberedRefs !== undefined && options.docxNumberedRefs.length > 0) {
    hasExplicitOrder = true;
    for (let idx = 0; idx < options.docxNumberedRefs.length; idx++) {
      numberedOrderRefMap.set(idx + 1, options.docxNumberedRefs[idx]!);
    }
  } else if (options?.markdownNumberedRefs !== undefined && options.markdownNumberedRefs.length > 0) {
    hasExplicitOrder = true;
    for (const ref of options.markdownNumberedRefs) {
      if (ref.index >= 1 && !numberedOrderRefMap.has(ref.index)) {
        numberedOrderRefMap.set(ref.index, `mdref:${ref.index}`);
      }
    }
  } else if (options?.bibStyle !== undefined) {
    const lowerStyle = normLower(options.bibStyle);
    const isFirstCitationOrder = FIRST_CITATION_ORDER_STYLES.some((s) =>
      containsAsciiSubstrCaseInsensitive(lowerStyle, s),
    );
    if (isFirstCitationOrder && entries.length > 0) {
      hasExplicitOrder = true;
      const ordered = [...entries].sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));
      for (let idx = 0; idx < ordered.length; idx++) {
        numberedOrderRefMap.set(idx + 1, ordered[idx]!.refId);
      }
    }
  }

  const resolvedMarkers: ResolvedCitationMarker[] = [];
  const allResolvedRefIds: string[] = [];
  const allUnresolvedKeys: string[] = [];
  const possibleCitations: { readonly range: TextRangeLike; readonly text: string }[] = [];
  const ambiguousMarkers: ResolvedCitationMarker[] = [];

  for (const m of markers) {
    const refIds: string[] = [];
    const unresolved: string[] = [];
    const ambiguous: string[] = [];

    let numericPromotedExplicit = false;
    if (m.rule === "docx_field" || m.rule === "docx_superscript") {
      if (m.authoritativeRefIds !== undefined && m.authoritativeRefIds.length > 0) {
        for (const id of m.authoritativeRefIds) recordUnique(refIds, id);
      } else {
        for (const k of m.keys) {
          const hit = exactKeyMap.get(k)?.[0] ?? lowerKeyMap.get(normLower(k))?.[0];
          if (hit !== undefined) recordUnique(refIds, hit.refId);
          else unresolved.push(k);
        }
        for (const num of m.numericIds) {
          const targetRef = num >= 1 ? numberedOrderRefMap.get(num) : undefined;
          if (targetRef !== undefined) {
            recordUnique(refIds, targetRef);
          } else {
            unresolved.push(String(num));
          }
        }
      }
    } else if (m.rule === "latex_cite" || m.rule === "pandoc_bracket" || m.rule === "pandoc_narrative") {
      for (const k of m.keys) {
        const exactHits = exactKeyMap.get(k);
        if (exactHits !== undefined && exactHits.length === 1) {
          recordUnique(refIds, exactHits[0]!.refId);
        } else if (exactHits !== undefined && exactHits.length > 1) {
          for (const h of exactHits) recordUnique(ambiguous, h.refId);
        } else {
          const lowHits = lowerKeyMap.get(normLower(k));
          if (lowHits !== undefined && lowHits.length === 1) {
            recordUnique(refIds, lowHits[0]!.refId);
          } else if (lowHits !== undefined && lowHits.length > 1) {
            for (const h of lowHits) recordUnique(ambiguous, h.refId);
          } else {
            unresolved.push(k);
          }
        }
      }
    } else if (m.rule === "numeric_bracket") {
      const effectiveExplicit = hasExplicitOrder || m.kind === "EXPLICIT";
      numericPromotedExplicit = effectiveExplicit;
      if (effectiveExplicit) {
        for (const num of m.numericIds) {
          const targetRef = num >= 1 ? numberedOrderRefMap.get(num) : undefined;
          if (targetRef !== undefined) {
            recordUnique(refIds, targetRef);
          } else {
            unresolved.push(String(num));
          }
        }
      }
      // Without known numbering order, numeric_bracket stays HEURISTIC -> POSSIBLE_CITATION
    } else {
      // author_year_paren / author_year_narrative (HEURISTIC)
      for (const q of m.authorYears) {
        const matches: BibliographyEntry[] = [];
        for (const e of entries) {
          if (entryMatchesAuthorYear(e, q)) {
            matches.push(e);
          }
        }
        if (matches.length === 1) {
          recordUnique(refIds, matches[0]!.refId);
        } else if (matches.length > 1) {
          for (const h of matches) recordUnique(ambiguous, h.refId);
        }
      }
    }

    const isExplicit = m.rule === "numeric_bracket" ? numericPromotedExplicit : m.kind === "EXPLICIT";
    const resolvedMarkerObj =
      isExplicit && m.kind !== "EXPLICIT" ? { ...m, kind: "EXPLICIT" as const } : m;

    let status: MarkerResolutionStatus;
    if (isExplicit && unresolved.length > 0) {
      status = "UNRESOLVED_KEY";
      for (const uk of unresolved) {
        recordUnique(allUnresolvedKeys, uk);
        recordUnique(report.unresolvedKeys, uk);
      }
    } else if (ambiguous.length > 0) {
      status = "AMBIGUOUS";
    } else if (refIds.length === 0) {
      status = isExplicit ? "UNRESOLVED_KEY" : "POSSIBLE_CITATION";
      if (status === "POSSIBLE_CITATION") {
        possibleCitations.push({ range: { start: m.start, end: m.end }, text: m.rawText });
        report.possibleCitations.push(m.rawText);
      }
    } else {
      status = "RESOLVED";
      for (const id of refIds) {
        recordUnique(allResolvedRefIds, id);
      }
    }

    const resolvedEntry: ResolvedCitationMarker = {
      marker: resolvedMarkerObj,
      status,
      refIds,
      unresolvedKeys: unresolved,
      ambiguousCandidates: ambiguous,
    };
    resolvedMarkers.push(resolvedEntry);
    if (status === "AMBIGUOUS") {
      ambiguousMarkers.push(resolvedEntry);
    }
  }

  return {
    resolvedMarkers,
    resolvedRefIds: allResolvedRefIds,
    unresolvedKeys: allUnresolvedKeys,
    possibleCitations,
    ambiguousMarkers,
    report,
  };
}
