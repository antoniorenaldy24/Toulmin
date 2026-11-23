/**
 * Untrusted-evidence prompt-injection sanitizer, mixed-script detector,
 * character-level cleaning, metadata withholding, and evidence delimiter
 * escaping (`docs/spec/02_L0_TIER_A_PRE_DECODE.md` §9).
 *
 * Pure Tier A L0 module: zero Node I/O, Firebase, DOM, network, clock,
 * platform case/normalization APIs, or regular expressions.
 */

import {
  NORM_TABLE,
  codePointAtSafe,
  isBaseLetter,
  isCombiningMark,
  isDigit,
  isJoinerPreservedScript,
  isKeyChar,
  isMarkMnOrMe,
  isSpace,
  norm,
  normLower,
} from "./norm.js";

export type SanitizeTier = "clean" | "logged" | "blocked";

export type SanitizeBlockReason =
  | "TAG_CHARS"
  | "BIDI_OVERRIDE"
  | "INVISIBLE_CHARS"
  | "MIXED_SCRIPT"
  | "HIDDEN_PDF_TEXT"
  | "INJ-01"
  | "INJ-02"
  | "INJ-03"
  | "INJ-04"
  | "INJ-05"
  | "INJ-06"
  | "INJ-07"
  | "INJ-08"
  | "INJ-09"
  | "INJ-10"
  | "INJ-11"
  | "INJ-12"
  | "INJ-13";

export type SanitizeLogReason =
  | "PUA_UNMAPPED"
  | "LOG_VERDICT_WORD"
  | "LOG_ROLEPLAY"
  | "LOG_LABEL_PREFIX";

export type SanitizeReason = SanitizeBlockReason | SanitizeLogReason;

export type MetadataFieldName = "title" | "venue" | "first_author" | "doi";

export const INVISIBLE_CHARS_BLOCK_THRESHOLD = 3;
export const MIXED_SCRIPT_BLOCK_THRESHOLD = 2;
export const INJ12_URL_MAX_LEN = 200;
export const DOI_SUFFIX_MAX_LEN = 300;
export const DOI_PREFIX_MIN_DIGITS = 4;
export const DOI_PREFIX_MAX_DIGITS = 9;

export interface SanitizeOptions {
  /** Set `true` when the page's hidden-text guard dropped >= 4 alphabetic words (`02` §9.3). */
  readonly hiddenPdfText?: boolean;
}

export interface SanitizeResult {
  readonly text: string;
  readonly map: readonly number[];
  readonly detectText: string;
  readonly tier: SanitizeTier;
  readonly reasons: readonly SanitizeReason[];
  readonly blockReasons: readonly SanitizeBlockReason[];
  readonly logReasons: readonly SanitizeLogReason[];
  readonly blocked: boolean;
  readonly invisibleCharCount: number;
  readonly mixedScriptWordCount: number;
}

export interface SanitizeMetadataResult {
  readonly field: MetadataFieldName;
  readonly value: string;
  readonly withheld: boolean;
  readonly sanitizeResult: SanitizeResult;
}

const SYMBOL_PUA_MAP = buildCodePointMap(NORM_TABLE.SYMBOL_PUA_TABLE);
const COMPAT_FOLD_MAP = buildCodePointMap(NORM_TABLE.compat_fold);
const CONFUSABLES_MAP = buildCodePointMap(NORM_TABLE.confusables);

function buildCodePointMap(record: Readonly<Record<string, string>>): ReadonlyMap<number, string> {
  const out = new Map<number, string>();
  for (const [k, v] of Object.entries(record)) {
    const cp = k.codePointAt(0);
    if (cp !== undefined) {
      out.set(cp, v);
    }
  }
  return out;
}

const INJ01_TRIGGERS: ReadonlySet<string> = new Set([
  "ignore",
  "disregard",
  "forget",
  "override",
]);
const INJ01_QUALIFIERS: ReadonlySet<string> = new Set([
  "previous",
  "prior",
  "above",
  "earlier",
  "all",
  "any",
]);
const INJ01_TARGETS: ReadonlySet<string> = new Set([
  "instruction",
  "instructions",
  "prompt",
  "prompts",
  "rules",
  "directions",
]);

const INJ02_ROLES: ReadonlySet<string> = new Set(["system", "developer", "assistant"]);
const INJ02_NOUNS: ReadonlySet<string> = new Set([
  "prompt",
  "message",
  "instruction",
  "instructions",
]);

const INJ03_DETS: ReadonlySet<string> = new Set(["a", "an", "the", "my"]);
const INJ03_MODELS: ReadonlySet<string> = new Set([
  "ai",
  "assistant",
  "model",
  "chatbot",
  "llm",
  "gpt",
]);

const INJ04_VERBS: ReadonlySet<string> = new Set([
  "respond",
  "reply",
  "answer",
  "output",
  "return",
  "print",
]);
const INJ04_PREPS: ReadonlySet<string> = new Set(["with", "as", "in"]);
const INJ04_SINGLE_TARGETS: ReadonlySet<string> = new Set([
  "json",
  "yes",
  "no",
  "true",
  "false",
  "supported",
  "contradicts",
]);

const INJ05_ADJS: ReadonlySet<string> = new Set([
  "new",
  "revised",
  "real",
  "actual",
  "hidden",
]);
const INJ05_NOUNS: ReadonlySet<string> = new Set([
  "instruction",
  "instructions",
  "task",
  "rules",
]);

const INJ06_TAGS: ReadonlySet<string> = new Set([
  "system",
  "assistant",
  "user",
  "evidence",
  "instruction",
  "im_start",
  "im_end",
]);

const INJ07_LITERALS: readonly string[] = [
  "[inst]",
  "[/inst]",
  "<<sys>>",
  "<</sys>>",
  "<<evidence",
  "<</evidence",
];

const INJ08_WORDS: ReadonlySet<string> = new Set([
  "instruction",
  "instructions",
  "system",
  "task",
  "prompt",
]);

const INJ09_ADJS: ReadonlySet<string> = new Set(["correct", "right", "true"]);
const INJ09_NOUNS: ReadonlySet<string> = new Set(["verdict", "answer", "label"]);

const INJ10_VERBS: ReadonlySet<string> = new Set(["follow", "obey"]);
const INJ10_MODS: ReadonlySet<string> = new Set(["the", "your", "any", "previous"]);
const INJ10_NOUNS: ReadonlySet<string> = new Set([
  "instruction",
  "instructions",
  "rules",
  "system",
]);

const INJ11_BOUNDARY: ReadonlySet<string> = new Set(["begin", "end"]);
const INJ11_TARGETS: ReadonlySet<string> = new Set(["system", "instructions", "prompt"]);

const INJ12_PARAMS: ReadonlySet<string> = new Set(["prompt", "instruction", "q"]);

const LOG_VERDICT_WORDS: ReadonlySet<string> = new Set([
  "supported",
  "contradicts",
  "contradicted",
]);
const LOG_LABEL_WORDS: ReadonlySet<string> = new Set([
  "label",
  "classification",
  "verdict",
]);

function unitsToString(units: readonly number[]): string {
  const len = units.length;
  if (len === 0) return "";
  const CHUNK_SIZE = 4096;
  if (len <= CHUNK_SIZE) {
    return String.fromCharCode(...units);
  }
  const parts: string[] = [];
  for (let i = 0; i < len; i += CHUNK_SIZE) {
    const end = i + CHUNK_SIZE < len ? i + CHUNK_SIZE : len;
    parts.push(String.fromCharCode(...units.slice(i, end)));
  }
  return parts.join("");
}

function pushCodePointWithOffset(
  outUnits: number[],
  outMap: number[],
  cp: number,
  rawOffset: number,
): void {
  if (cp <= 0xffff) {
    outUnits.push(cp);
    outMap.push(rawOffset);
    return;
  }
  const v = cp - 0x10000;
  outUnits.push(0xd800 + (v >> 10));
  outMap.push(rawOffset);
  outUnits.push(0xdc00 + (v & 0x3ff));
  outMap.push(rawOffset);
}

function pushStringWithOffset(
  outUnits: number[],
  outMap: number[],
  str: string,
  rawOffset: number,
): void {
  for (let k = 0; k < str.length; k++) {
    outUnits.push(str.charCodeAt(k));
    outMap.push(rawOffset);
  }
}

function isSimpleControlToDelete(cp: number): boolean {
  if (cp <= 0x001f) {
    return cp !== 0x0009 && cp !== 0x000a && cp !== 0x000d;
  }
  return cp >= 0x007f && cp <= 0x009f;
}

function isBidiOverrideControl(cp: number): boolean {
  return (cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069);
}

function isDirectionalMark(cp: number): boolean {
  return cp === 0x200e || cp === 0x200f || cp === 0x061c;
}

function isZeroWidthOrInvisible(cp: number): boolean {
  return (
    cp === 0x200b ||
    (cp >= 0x2060 && cp <= 0x2064) ||
    cp === 0xfeff ||
    cp === 0x034f ||
    (cp >= 0xfe00 && cp <= 0xfe0f) ||
    cp === 0x3164 ||
    cp === 0xffa0 ||
    cp === 0x115f ||
    cp === 0x1160 ||
    cp === 0x180e
  );
}

function prevValidCodePoint(rawText: string, endIndex: number): number | null {
  if (endIndex <= 0) return null;
  const cu1 = rawText.charCodeAt(endIndex - 1);
  if (cu1 >= 0xdc00 && cu1 <= 0xdfff) {
    if (endIndex >= 2) {
      const cu0 = rawText.charCodeAt(endIndex - 2);
      if (cu0 >= 0xd800 && cu0 <= 0xdbff) {
        return ((cu0 - 0xd800) << 10) + (cu1 - 0xdc00) + 0x10000;
      }
    }
    return null;
  }
  if (cu1 >= 0xd800 && cu1 <= 0xdbff) {
    return null;
  }
  return cu1;
}

function nextValidCodePoint(rawText: string, startIndex: number): number | null {
  if (startIndex >= rawText.length) return null;
  const unit = codePointAtSafe(rawText, startIndex);
  return unit.isUnpairedSurrogate ? null : unit.cp;
}

interface CharacterCleanResult {
  readonly cleanedText: string;
  readonly cleanMap: number[];
  readonly invisibleCharCount: number;
  readonly hasTagChars: boolean;
  readonly hasBidiOverride: boolean;
  readonly hasPuaUnmapped: boolean;
}

/**
 * Stage 1–2 of sanitization (`02` §9.1): counts raw invisible chars and cleans
 * controls, tag chars, bidi overrides, directional marks, invisibles, non-script
 * joiners, and PUA characters while keeping an exact UTF-16 offset map.
 */
function cleanCharactersAndCount(rawText: string): CharacterCleanResult {
  const n = rawText.length;
  const outUnits: number[] = [];
  const cleanMap: number[] = [];
  let invisibleCharCount = 0;
  let hasTagChars = false;
  let hasBidiOverride = false;
  let hasPuaUnmapped = false;

  let i = 0;
  while (i < n) {
    const cu0 = rawText.charCodeAt(i);
    if (cu0 < 0x80) {
      if (isSimpleControlToDelete(cu0)) {
        i += 1;
        continue;
      }
      outUnits.push(cu0);
      cleanMap.push(i);
      i += 1;
      continue;
    }

    const unit = codePointAtSafe(rawText, i);
    if (unit.isUnpairedSurrogate) {
      outUnits.push(unit.cp);
      cleanMap.push(i);
      i += 1;
      continue;
    }

    const cp = unit.cp;

    // C1 controls U+0080..U+009F
    if (cp >= 0x0080 && cp <= 0x009f) {
      i += unit.len;
      continue;
    }

    // Unicode tag characters U+E0000..U+E007F
    if (cp >= 0xe0000 && cp <= 0xe007f) {
      hasTagChars = true;
      i += unit.len;
      continue;
    }

    // Bidi embedding, override and isolate controls
    if (isBidiOverrideControl(cp)) {
      hasBidiOverride = true;
      i += unit.len;
      continue;
    }

    // Directional marks
    if (isDirectionalMark(cp)) {
      i += unit.len;
      continue;
    }

    // Zero-width and invisible characters
    if (isZeroWidthOrInvisible(cp)) {
      invisibleCharCount += 1;
      i += unit.len;
      continue;
    }

    // Script-aware joiners U+200C / U+200D
    if (cp === 0x200c || cp === 0x200d) {
      const prevCp = prevValidCodePoint(rawText, i);
      const nextCp = nextValidCodePoint(rawText, i + unit.len);
      if (
        prevCp !== null &&
        nextCp !== null &&
        isJoinerPreservedScript(prevCp) &&
        isJoinerPreservedScript(nextCp)
      ) {
        outUnits.push(cp);
        cleanMap.push(i);
      } else {
        invisibleCharCount += 1;
      }
      i += unit.len;
      continue;
    }

    // Private Use Area U+E000..U+F8FF (BMP PUA)
    if (cp >= 0xe000 && cp <= 0xf8ff) {
      const puaReplacement = SYMBOL_PUA_MAP.get(cp);
      if (puaReplacement !== undefined) {
        pushStringWithOffset(outUnits, cleanMap, puaReplacement, i);
      } else {
        hasPuaUnmapped = true;
      }
      i += unit.len;
      continue;
    }

    pushCodePointWithOffset(outUnits, cleanMap, cp, i);
    i += unit.len;
  }

  cleanMap.push(n);
  return {
    cleanedText: unitsToString(outUnits),
    cleanMap,
    invisibleCharCount,
    hasTagChars,
    hasBidiOverride,
    hasPuaUnmapped,
  };
}

/**
 * Applies `compat_fold` from `norm_table.json` (`02` §9.2).
 */
export function compatFold(input: string): string {
  const n = input.length;
  const outUnits: number[] = [];
  let changed = false;
  let i = 0;

  while (i < n) {
    const cu0 = input.charCodeAt(i);
    if (cu0 < 0x80) {
      if (changed) outUnits.push(cu0);
      i += 1;
      continue;
    }
    const unit = codePointAtSafe(input, i);
    if (unit.isUnpairedSurrogate) {
      if (changed) outUnits.push(unit.cp);
      i += 1;
      continue;
    }
    const folded = COMPAT_FOLD_MAP.get(unit.cp);
    if (folded !== undefined) {
      if (!changed) {
        for (let p = 0; p < i; p++) {
          outUnits.push(input.charCodeAt(p));
        }
        changed = true;
      }
      for (let k = 0; k < folded.length; k++) {
        outUnits.push(folded.charCodeAt(k));
      }
    } else if (changed) {
      for (let k = 0; k < unit.len; k++) {
        outUnits.push(input.charCodeAt(i + k));
      }
    }
    i += unit.len;
  }

  return changed ? unitsToString(outUnits) : input;
}

/**
 * Deletes every code point with Unicode 15.1 General_Category Mn or Me (`02` §9.2).
 */
export function stripMarks(input: string): string {
  const n = input.length;
  const outUnits: number[] = [];
  let changed = false;
  let i = 0;

  while (i < n) {
    const cu0 = input.charCodeAt(i);
    if (cu0 < 0x80) {
      if (changed) outUnits.push(cu0);
      i += 1;
      continue;
    }
    const unit = codePointAtSafe(input, i);
    if (!unit.isUnpairedSurrogate && isMarkMnOrMe(unit.cp)) {
      if (!changed) {
        for (let p = 0; p < i; p++) {
          outUnits.push(input.charCodeAt(p));
        }
        changed = true;
      }
    } else if (changed) {
      for (let k = 0; k < unit.len; k++) {
        outUnits.push(input.charCodeAt(i + k));
      }
    }
    i += unit.len;
  }

  return changed ? unitsToString(outUnits) : input;
}

/**
 * Applies Cyrillic/Greek `confusables` folding from `norm_table.json` (`02` §9.2).
 */
export function foldConfusables(input: string): string {
  const n = input.length;
  const outUnits: number[] = [];
  let changed = false;
  let i = 0;

  while (i < n) {
    const cu0 = input.charCodeAt(i);
    if (cu0 < 0x80) {
      if (changed) outUnits.push(cu0);
      i += 1;
      continue;
    }
    const unit = codePointAtSafe(input, i);
    if (unit.isUnpairedSurrogate) {
      if (changed) outUnits.push(unit.cp);
      i += 1;
      continue;
    }
    const mapped = CONFUSABLES_MAP.get(unit.cp);
    if (mapped !== undefined) {
      if (!changed) {
        for (let p = 0; p < i; p++) {
          outUnits.push(input.charCodeAt(p));
        }
        changed = true;
      }
      for (let k = 0; k < mapped.length; k++) {
        outUnits.push(mapped.charCodeAt(k));
      }
    } else if (changed) {
      for (let k = 0; k < unit.len; k++) {
        outUnits.push(input.charCodeAt(i + k));
      }
    }
    i += unit.len;
  }

  return changed ? unitsToString(outUnits) : input;
}

/**
 * Builds the `detectText` string (`02` §9.2):
 * `foldConfusables(stripMarks(compatFold(normLower(cleanedText))))`.
 * Used exclusively for pattern matching; offsets are never taken from `detectText`.
 */
export function buildDetectText(cleanedText: string): string {
  return foldConfusables(stripMarks(compatFold(normLower(cleanedText))));
}

function isLatinBaseLetterCp(cp: number): boolean {
  if (!isBaseLetter(cp)) return false;
  return (
    (cp >= 0x0041 && cp <= 0x005a) ||
    (cp >= 0x0061 && cp <= 0x007a) ||
    (cp >= 0x00c0 && cp <= 0x00d6) ||
    (cp >= 0x00d8 && cp <= 0x00f6) ||
    (cp >= 0x00f8 && cp <= 0x02af) ||
    (cp >= 0x1d00 && cp <= 0x1d25) ||
    (cp >= 0x1d2c && cp <= 0x1dbf) ||
    (cp >= 0x1e00 && cp <= 0x1eff) ||
    (cp >= 0x2c60 && cp <= 0x2c7f) ||
    (cp >= 0xa720 && cp <= 0xa7ff) ||
    (cp >= 0xab30 && cp <= 0xab6f) ||
    (cp >= 0xfb00 && cp <= 0xfb06) ||
    (cp >= 0xff21 && cp <= 0xff3a) ||
    (cp >= 0xff41 && cp <= 0xff5a)
  );
}

function isCyrillicBaseLetterCp(cp: number): boolean {
  if (!isBaseLetter(cp)) return false;
  return (
    (cp >= 0x0400 && cp <= 0x052f) ||
    (cp >= 0x1c80 && cp <= 0x1c8f) ||
    (cp >= 0x2de0 && cp <= 0x2dff) ||
    (cp >= 0xa640 && cp <= 0xa69f)
  );
}

function isConfusableGreekLetterCp(cp: number): boolean {
  return (
    ((cp >= 0x0370 && cp <= 0x03ff) ||
      (cp >= 0x1f00 && cp <= 0x1fff) ||
      (cp >= 0x1d26 && cp <= 0x1d2b)) &&
    CONFUSABLES_MAP.has(cp)
  );
}

function isNextWordLetterOrDigit(text: string, idx: number): boolean {
  if (idx >= text.length) return false;
  const cu = text.charCodeAt(idx);
  if (cu < 0x80) {
    return (
      (cu >= 0x61 && cu <= 0x7a) ||
      (cu >= 0x41 && cu <= 0x5a) ||
      (cu >= 0x30 && cu <= 0x39)
    );
  }
  const u = codePointAtSafe(text, idx);
  if (u.isUnpairedSurrogate) return false;
  return isBaseLetter(u.cp) || isDigit(u.cp);
}

/**
 * Counts mixed-script words on `normLower(cleanedText)` BEFORE folding (`02` §9.3).
 * Words follow §4.1 (`LETTER`, `DIGIT`, and internal `'`/`-` flanked on both sides by `LETTER`/`DIGIT`).
 * A word is mixed-script iff it has NO `DIGIT` and NO `-` and either:
 * (a) >= 2 Latin letters and >= 1 Cyrillic letter; or
 * (b) a Greek confusable letter between two Latin letters.
 */
export function countMixedScriptWords(loweredText: string): number {
  const n = loweredText.length;
  let mixedCount = 0;

  let inWord = false;
  let hasDigitOrHyphen = false;
  let latinCount = 0;
  let cyrillicCount = 0;
  let pendingGreekConfusable = false;
  let hasGreekBetweenLatin = false;

  const flushWord = (): void => {
    if (!inWord) return;
    if (!hasDigitOrHyphen) {
      if ((latinCount >= 2 && cyrillicCount >= 1) || hasGreekBetweenLatin) {
        mixedCount += 1;
      }
    }
    inWord = false;
    hasDigitOrHyphen = false;
    latinCount = 0;
    cyrillicCount = 0;
    pendingGreekConfusable = false;
    hasGreekBetweenLatin = false;
  };

  let i = 0;
  while (i < n) {
    const cu0 = loweredText.charCodeAt(i);
    if (cu0 < 0x80) {
      const isAsciiAlpha = (cu0 >= 0x61 && cu0 <= 0x7a) || (cu0 >= 0x41 && cu0 <= 0x5a);
      if (isAsciiAlpha) {
        inWord = true;
        latinCount += 1;
        if (pendingGreekConfusable) {
          hasGreekBetweenLatin = true;
          pendingGreekConfusable = false;
        }
      } else if (isDigit(cu0)) {
        inWord = true;
        hasDigitOrHyphen = true;
      } else if (cu0 === 0x2d /* '-' */ || cu0 === 0x27 /* "'" */) {
        if (inWord && isNextWordLetterOrDigit(loweredText, i + 1)) {
          if (cu0 === 0x2d) {
            hasDigitOrHyphen = true;
          }
        } else {
          flushWord();
        }
      } else {
        flushWord();
      }
      i += 1;
      continue;
    }

    const unit = codePointAtSafe(loweredText, i);
    if (unit.isUnpairedSurrogate) {
      flushWord();
      i += 1;
      continue;
    }

    const cp = unit.cp;
    if (isBaseLetter(cp)) {
      inWord = true;
      if (isLatinBaseLetterCp(cp)) {
        latinCount += 1;
        if (pendingGreekConfusable) {
          hasGreekBetweenLatin = true;
          pendingGreekConfusable = false;
        }
      } else if (isCyrillicBaseLetterCp(cp)) {
        cyrillicCount += 1;
      } else if (isConfusableGreekLetterCp(cp)) {
        if (latinCount > 0) {
          pendingGreekConfusable = true;
        }
      }
    } else if (isCombiningMark(cp)) {
      if (inWord) {
        // stay inside word across combining marks
      }
    } else {
      flushWord();
    }
    i += unit.len;
  }

  flushWord();
  return mixedCount;
}

interface DetectWord {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

function extractDetectWords(detectText: string): DetectWord[] {
  const n = detectText.length;
  const words: DetectWord[] = [];
  let wordStart = -1;
  let i = 0;

  while (i < n) {
    const cu0 = detectText.charCodeAt(i);
    if (cu0 < 0x80) {
      const isAlnum = (cu0 >= 0x61 && cu0 <= 0x7a) || (cu0 >= 0x30 && cu0 <= 0x39);
      if (isAlnum) {
        if (wordStart === -1) wordStart = i;
      } else if (wordStart !== -1) {
        words.push({ text: detectText.slice(wordStart, i), start: wordStart, end: i });
        wordStart = -1;
      }
      i += 1;
      continue;
    }

    const unit = codePointAtSafe(detectText, i);
    const isAlnum = !unit.isUnpairedSurrogate && (isBaseLetter(unit.cp) || isDigit(unit.cp));
    if (isAlnum) {
      if (wordStart === -1) wordStart = i;
    } else if (wordStart !== -1) {
      words.push({ text: detectText.slice(wordStart, i), start: wordStart, end: i });
      wordStart = -1;
    }
    i += unit.len;
  }

  if (wordStart !== -1) {
    words.push({ text: detectText.slice(wordStart, n), start: wordStart, end: n });
  }
  return words;
}

function hasOnlySpaceBetween(text: string, start: number, end: number): boolean {
  if (end <= start) return false;
  for (let i = start; i < end; i++) {
    if (!isSpace(text.charCodeAt(i))) {
      return false;
    }
  }
  return true;
}

function detectInj01(words: readonly DetectWord[]): boolean {
  let lastTrigger = -1;
  let lastQual = -1;
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!.text;
    if (lastQual !== -1 && i - lastQual >= 1 && i - lastQual <= 5 && INJ01_TARGETS.has(w)) {
      return true;
    }
    if (lastTrigger !== -1 && i - lastTrigger >= 1 && i - lastTrigger <= 9 && INJ01_QUALIFIERS.has(w)) {
      lastQual = i;
    }
    if (INJ01_TRIGGERS.has(w)) {
      lastTrigger = i;
    }
  }
  return false;
}

function detectInj05ColonAfterWords(
  detectText: string,
  words: readonly DetectWord[],
  nounWordIdx: number,
): boolean {
  const startSearch = words[nounWordIdx]!.end;
  // Find limit right after at most 3 following words
  const maxWordIdx = Math.min(words.length - 1, nounWordIdx + 3);
  const scanEnd = words[maxWordIdx]!.end;

  for (let i = startSearch; i < detectText.length; i++) {
    const ch = detectText.charCodeAt(i);
    if (ch === 0x3a /* ':' */) {
      return true;
    }
    if (ch === 0x0a /* '\n' */ || ch === 0x2e /* '.' */ || ch === 0x3f /* '?' */ || ch === 0x21 /* '!' */) {
      return false;
    }
    if (i >= scanEnd && !isSpace(ch)) {
      return false;
    }
  }
  return false;
}

function detectInj06XmlRoleTag(detectText: string): boolean {
  const n = detectText.length;
  let i = 0;
  while (i < n) {
    const lt = detectText.indexOf("<", i);
    if (lt === -1) return false;
    let cur = lt + 1;
    while (cur < n && isSpace(detectText.charCodeAt(cur))) {
      cur++;
    }
    if (cur < n && detectText.charCodeAt(cur) === 0x2f /* '/' */) {
      cur++;
    }
    const hasLeadingPipe = cur < n && detectText.charCodeAt(cur) === 0x7c /* '|' */;
    if (hasLeadingPipe) {
      cur++;
    }
    const wordStart = cur;
    while (cur < n) {
      const ch = detectText.charCodeAt(cur);
      if ((ch >= 0x61 && ch <= 0x7a) || ch === 0x5f /* '_' */) {
        cur++;
      } else {
        break;
      }
    }
    if (cur > wordStart) {
      const tagWord = detectText.slice(wordStart, cur);
      const validPipeTag =
        !hasLeadingPipe || tagWord === "im_start" || tagWord === "im_end";
      if (validPipeTag && INJ06_TAGS.has(tagWord)) {
        const nextValid =
          cur >= n
            ? true
            : (() => {
                const u = codePointAtSafe(detectText, cur);
                return (
                  u.isUnpairedSurrogate ||
                  (!isBaseLetter(u.cp) && !isDigit(u.cp) && u.cp !== 0x5f)
                );
              })();
        if (nextValid) {
          return true;
        }
      }
    }
    i = lt + 1;
  }
  return false;
}

function detectInj07Delimiters(detectText: string): boolean {
  for (let i = 0; i < INJ07_LITERALS.length; i++) {
    if (detectText.includes(INJ07_LITERALS[i]!)) {
      return true;
    }
  }
  return false;
}

function detectInj08MarkdownHeading(detectText: string): boolean {
  const n = detectText.length;
  let i = 0;
  while (i < n) {
    while (i < n && (detectText.charCodeAt(i) === 0x20 || detectText.charCodeAt(i) === 0x09)) {
      i++;
    }
    let hashes = 0;
    while (i < n && detectText.charCodeAt(i) === 0x23 /* '#' */) {
      hashes++;
      i++;
    }
    if (hashes >= 2) {
      while (i < n && (detectText.charCodeAt(i) === 0x20 || detectText.charCodeAt(i) === 0x09)) {
        i++;
      }
      const wordStart = i;
      while (i < n) {
        const ch = detectText.charCodeAt(i);
        if (ch >= 0x61 && ch <= 0x7a) {
          i++;
        } else {
          break;
        }
      }
      if (i > wordStart && INJ08_WORDS.has(detectText.slice(wordStart, i))) {
        const atWordEnd =
          i >= n ||
          (() => {
            const u = codePointAtSafe(detectText, i);
            return u.isUnpairedSurrogate || (!isBaseLetter(u.cp) && !isDigit(u.cp) && u.cp !== 0x5f);
          })();
        if (atWordEnd) {
          return true;
        }
      }
    }
    const nl = detectText.indexOf("\n", i);
    if (nl === -1) break;
    i = nl + 1;
  }
  return false;
}

function detectInj12QueryUrl(detectText: string): boolean {
  const n = detectText.length;
  let i = 0;
  while (i < n) {
    const httpIdx = detectText.indexOf("http", i);
    if (httpIdx === -1) return false;
    let schemeLen = 0;
    if (detectText.startsWith("http://", httpIdx)) {
      schemeLen = 7;
    } else if (detectText.startsWith("https://", httpIdx)) {
      schemeLen = 8;
    } else {
      i = httpIdx + 4;
      continue;
    }

    if (httpIdx > 0) {
      const prev = detectText.charCodeAt(httpIdx - 1);
      if (prev >= 0x61 && prev <= 0x7a) {
        i = httpIdx + schemeLen;
        continue;
      }
    }

    const maxUrlEnd = Math.min(n, httpIdx + INJ12_URL_MAX_LEN);
    let urlEnd = httpIdx + schemeLen;
    while (urlEnd < maxUrlEnd) {
      const ch = detectText.charCodeAt(urlEnd);
      if (
        isSpace(ch) ||
        ch === 0x22 /* '"' */ ||
        ch === 0x27 /* "'" */ ||
        ch === 0x3c /* '<' */ ||
        ch === 0x3e /* '>' */ ||
        ch === 0x29 /* ')' */ ||
        ch === 0x5d /* ']' */ ||
        ch === 0x7d /* '}' */
      ) {
        break;
      }
      urlEnd++;
    }

    // Ignore URLs exceeding 200 chars only when truncated before query; here bounded slice up to 200 chars is inspected
    const urlSlice = detectText.slice(httpIdx, urlEnd);
    const qMark = urlSlice.indexOf("?");
    if (qMark !== -1) {
      const hashMark = urlSlice.indexOf("#", qMark + 1);
      const queryPart =
        hashMark === -1 ? urlSlice.slice(qMark + 1) : urlSlice.slice(qMark + 1, hashMark);
      const pairs = queryPart.split("&");
      for (let p = 0; p < pairs.length; p++) {
        const seg = pairs[p]!;
        const eq = seg.indexOf("=");
        if (eq > 0 && INJ12_PARAMS.has(seg.slice(0, eq))) {
          return true;
        }
      }
    }

    i = urlEnd > httpIdx ? urlEnd : httpIdx + schemeLen;
  }
  return false;
}

function isWordBoundaryAt(text: string, idx: number): boolean {
  if (idx < 0 || idx >= text.length) return true;
  const u = codePointAtSafe(text, idx);
  return u.isUnpairedSurrogate || (!isBaseLetter(u.cp) && !isDigit(u.cp) && u.cp !== 0x5f);
}

function isWordStartBoundaryBefore(text: string, idx: number): boolean {
  if (idx <= 0) return true;
  const cu = text.charCodeAt(idx - 1);
  if (cu < 0x80) {
    return (
      !((cu >= 0x61 && cu <= 0x7a) || (cu >= 0x41 && cu <= 0x5a) || isDigit(cu)) && cu !== 0x5f
    );
  }
  const prev = prevValidCodePoint(text, idx);
  return prev === null || (!isBaseLetter(prev) && !isDigit(prev));
}

function detectInj13SchemaVocab(detectText: string): boolean {
  const n = detectText.length;

  // 1. Quoted `"verdict"` followed by optional spaces and `:`
  let qCursor = 0;
  while (qCursor < n) {
    const pos = detectText.indexOf('"verdict"', qCursor);
    if (pos === -1) break;
    let p = pos + 9;
    while (p < n && (detectText.charCodeAt(p) === 0x20 || detectText.charCodeAt(p) === 0x09)) {
      p++;
    }
    if (p < n && detectText.charCodeAt(p) === 0x3a /* ':' */) {
      return true;
    }
    qCursor = pos + 9;
  }

  // 2. `nei_silent_escalate` whole word
  let neiCursor = 0;
  while (neiCursor < n) {
    const pos = detectText.indexOf("nei_silent_escalate", neiCursor);
    if (pos === -1) break;
    if (isWordStartBoundaryBefore(detectText, pos) && isWordBoundaryAt(detectText, pos + 19)) {
      return true;
    }
    neiCursor = pos + 19;
  }

  // 3. `s0[1-4]_[a-z_]+` whole word
  let sCursor = 0;
  while (sCursor < n) {
    const pos = detectText.indexOf("s0", sCursor);
    if (pos === -1) break;
    if (pos + 4 < n && isWordStartBoundaryBefore(detectText, pos)) {
      const d = detectText.charCodeAt(pos + 2);
      const u = detectText.charCodeAt(pos + 3);
      if (d >= 0x31 && d <= 0x34 && u === 0x5f /* '_' */) {
        let end = pos + 4;
        let hasSuffixChar = false;
        while (end < n) {
          const c = detectText.charCodeAt(end);
          if ((c >= 0x61 && c <= 0x7a) || c === 0x5f) {
            hasSuffixChar = true;
            end++;
          } else {
            break;
          }
        }
        if (hasSuffixChar && isWordBoundaryAt(detectText, end)) {
          return true;
        }
      }
    }
    sCursor = pos + 2;
  }

  return false;
}

interface PatternEvalResult {
  readonly blockInjIds: readonly SanitizeBlockReason[];
  readonly logReasons: readonly SanitizeLogReason[];
}

function evaluatePatternsOnDetectText(detectText: string): PatternEvalResult {
  const words = extractDetectWords(detectText);
  const wc = words.length;

  let m01 = false;
  let m02 = false;
  let m03 = false;
  let m04 = false;
  let m05 = false;
  let m09 = false;
  let m10 = false;
  let m11 = false;

  let logVerdictWord = false;
  let logRoleplay = false;
  let logLabelPrefix = false;

  if (wc > 0) {
    m01 = detectInj01(words);

    for (let i = 0; i < wc; i++) {
      const w0 = words[i]!;
      const t0 = w0.text;

      // Log tier checks
      if (LOG_VERDICT_WORDS.has(t0)) {
        logVerdictWord = true;
      }
      if (t0 === "pretend") {
        logRoleplay = true;
      } else if ((t0 === "act" || t0 === "behave") && i + 1 < wc) {
        const w1 = words[i + 1]!;
        if (w1.text === "as" && hasOnlySpaceBetween(detectText, w0.end, w1.start)) {
          logRoleplay = true;
        }
      }
      if (LOG_LABEL_WORDS.has(t0) && w0.end < detectText.length && detectText.charCodeAt(w0.end) === 0x3a) {
        const precededByQuote = w0.start > 0 && detectText.charCodeAt(w0.start - 1) === 0x22;
        if (!precededByQuote) {
          logLabelPrefix = true;
        }
      }

      if (i + 1 >= wc) continue;
      const w1 = words[i + 1]!;
      const t1 = w1.text;
      const sp01 = hasOnlySpaceBetween(detectText, w0.end, w1.start);

      // INJ-02: (system|developer|assistant) (prompt|message|instruction|instructions)
      if (!m02 && sp01 && INJ02_ROLES.has(t0) && INJ02_NOUNS.has(t1)) {
        m02 = true;
      }

      // INJ-05: (new|revised|real|actual|hidden) (instruction|instructions|task|rules) followed within <= 3 words by `:`
      if (!m05 && sp01 && INJ05_ADJS.has(t0) && INJ05_NOUNS.has(t1)) {
        if (detectInj05ColonAfterWords(detectText, words, i + 1)) {
          m05 = true;
        }
      }

      // INJ-03: you are (now )?(a|an|the|my )?(ai|assistant|language model|model|chatbot|llm|gpt)
      if (!m03 && sp01 && t0 === "you" && t1 === "are") {
        let j = i + 2;
        if (j < wc && words[j]!.text === "now" && hasOnlySpaceBetween(detectText, words[j - 1]!.end, words[j]!.start)) {
          j++;
        }
        if (j < wc && INJ03_DETS.has(words[j]!.text) && hasOnlySpaceBetween(detectText, words[j - 1]!.end, words[j]!.start)) {
          j++;
        }
        if (j < wc && hasOnlySpaceBetween(detectText, words[j - 1]!.end, words[j]!.start)) {
          const cand = words[j]!.text;
          if (INJ03_MODELS.has(cand)) {
            m03 = true;
          } else if (
            cand === "language" &&
            j + 1 < wc &&
            words[j + 1]!.text === "model" &&
            hasOnlySpaceBetween(detectText, words[j]!.end, words[j + 1]!.start)
          ) {
            m03 = true;
          }
        }
      }

      // INJ-04: (respond|reply|answer|output|return|print) (only )?(with|as|in) (json|the following|yes|no|true|false|supported|contradicts|a verdict)
      if (!m04 && INJ04_VERBS.has(t0)) {
        let j = i + 1;
        if (j < wc && words[j]!.text === "only" && hasOnlySpaceBetween(detectText, w0.end, words[j]!.start)) {
          j++;
        }
        if (j < wc && INJ04_PREPS.has(words[j]!.text) && hasOnlySpaceBetween(detectText, words[j - 1]!.end, words[j]!.start)) {
          const tj = j + 1;
          if (tj < wc && hasOnlySpaceBetween(detectText, words[j]!.end, words[tj]!.start)) {
            const targetWord = words[tj]!.text;
            if (INJ04_SINGLE_TARGETS.has(targetWord)) {
              m04 = true;
            } else if (
              tj + 1 < wc &&
              hasOnlySpaceBetween(detectText, words[tj]!.end, words[tj + 1]!.start)
            ) {
              const nextWord = words[tj + 1]!.text;
              if (
                (targetWord === "the" && nextWord === "following") ||
                (targetWord === "a" && nextWord === "verdict")
              ) {
                m04 = true;
              }
            }
          }
        }
      }

      // INJ-09: (the )?(correct|right|true) (verdict|answer|label) (is|=)
      if (!m09 && sp01 && INJ09_ADJS.has(t0) && INJ09_NOUNS.has(t1)) {
        if (
          i + 2 < wc &&
          words[i + 2]!.text === "is" &&
          hasOnlySpaceBetween(detectText, w1.end, words[i + 2]!.start)
        ) {
          m09 = true;
        } else {
          let p = w1.end;
          while (p < detectText.length && (detectText.charCodeAt(p) === 0x20 || detectText.charCodeAt(p) === 0x09)) {
            p++;
          }
          if (p < detectText.length && detectText.charCodeAt(p) === 0x3d /* '=' */) {
            m09 = true;
          }
        }
      }

      // INJ-10: do not (follow|obey) (the |your |any |previous )?(instruction|instructions|rules|system)
      if (!m10 && sp01 && t0 === "do" && t1 === "not" && i + 2 < wc) {
        const w2 = words[i + 2]!;
        if (INJ10_VERBS.has(w2.text) && hasOnlySpaceBetween(detectText, w1.end, w2.start)) {
          let j = i + 3;
          if (j < wc && INJ10_MODS.has(words[j]!.text) && hasOnlySpaceBetween(detectText, w2.end, words[j]!.start)) {
            j++;
          }
          if (
            j < wc &&
            INJ10_NOUNS.has(words[j]!.text) &&
            hasOnlySpaceBetween(detectText, words[j - 1]!.end, words[j]!.start)
          ) {
            m10 = true;
          }
        }
      }

      // INJ-11: (begin|end) (of )?(system|instructions|prompt)
      if (!m11 && INJ11_BOUNDARY.has(t0)) {
        let j = i + 1;
        if (j < wc && words[j]!.text === "of" && hasOnlySpaceBetween(detectText, w0.end, words[j]!.start)) {
          j++;
        }
        if (
          j < wc &&
          INJ11_TARGETS.has(words[j]!.text) &&
          hasOnlySpaceBetween(detectText, words[j - 1]!.end, words[j]!.start)
        ) {
          m11 = true;
        }
      }
    }
  }

  const m06 = detectInj06XmlRoleTag(detectText);
  const m07 = detectInj07Delimiters(detectText);
  const m08 = detectInj08MarkdownHeading(detectText);
  const m12 = detectInj12QueryUrl(detectText);
  const m13 = detectInj13SchemaVocab(detectText);

  const blockInjIds: SanitizeBlockReason[] = [];
  if (m01) blockInjIds.push("INJ-01");
  if (m02) blockInjIds.push("INJ-02");
  if (m03) blockInjIds.push("INJ-03");
  if (m04) blockInjIds.push("INJ-04");
  if (m05) blockInjIds.push("INJ-05");
  if (m06) blockInjIds.push("INJ-06");
  if (m07) blockInjIds.push("INJ-07");
  if (m08) blockInjIds.push("INJ-08");
  if (m09) blockInjIds.push("INJ-09");
  if (m10) blockInjIds.push("INJ-10");
  if (m11) blockInjIds.push("INJ-11");
  if (m12) blockInjIds.push("INJ-12");
  if (m13) blockInjIds.push("INJ-13");

  const logReasons: SanitizeLogReason[] = [];
  if (logVerdictWord) logReasons.push("LOG_VERDICT_WORD");
  if (logRoleplay) logReasons.push("LOG_ROLEPLAY");
  if (logLabelPrefix) logReasons.push("LOG_LABEL_PREFIX");

  return { blockInjIds, logReasons };
}

/**
 * Runs the full deterministic untrusted-evidence sanitizer pipeline (`02` §9):
 * 1. Count raw invisible chars;
 * 2. Character-level clean + map (`cleanMap`);
 * 3. `norm()` + compose offset map to raw text coordinates;
 * 4. Build `detectText`;
 * 5. Evaluate mixed-script words and block/log rules.
 */
export function sanitizeText(rawText: string, options?: SanitizeOptions): SanitizeResult {
  const cleaned = cleanCharactersAndCount(rawText);
  const normRes = norm(cleaned.cleanedText);
  const outLen = normRes.text.length;
  const composedMap = new Array<number>(outLen + 1);
  for (let j = 0; j < outLen; j++) {
    const cleanIdx = normRes.map[j]!;
    composedMap[j] = cleaned.cleanMap[cleanIdx] ?? rawText.length;
  }
  composedMap[outLen] = rawText.length;

  const cleanedLowered = normLower(cleaned.cleanedText);
  const detectText = foldConfusables(stripMarks(compatFold(cleanedLowered)));
  const mixedScriptWordCount = countMixedScriptWords(cleanedLowered);
  const patternEval = evaluatePatternsOnDetectText(detectText);

  const blockReasons: SanitizeBlockReason[] = [];
  if (cleaned.hasTagChars) blockReasons.push("TAG_CHARS");
  if (cleaned.hasBidiOverride) blockReasons.push("BIDI_OVERRIDE");
  if (cleaned.invisibleCharCount >= INVISIBLE_CHARS_BLOCK_THRESHOLD) {
    blockReasons.push("INVISIBLE_CHARS");
  }
  if (mixedScriptWordCount >= MIXED_SCRIPT_BLOCK_THRESHOLD) {
    blockReasons.push("MIXED_SCRIPT");
  }
  if (options?.hiddenPdfText === true) {
    blockReasons.push("HIDDEN_PDF_TEXT");
  }
  for (let i = 0; i < patternEval.blockInjIds.length; i++) {
    blockReasons.push(patternEval.blockInjIds[i]!);
  }

  const logReasons: SanitizeLogReason[] = [];
  if (cleaned.hasPuaUnmapped) {
    logReasons.push("PUA_UNMAPPED");
  }
  for (let i = 0; i < patternEval.logReasons.length; i++) {
    logReasons.push(patternEval.logReasons[i]!);
  }

  const reasons: SanitizeReason[] = [...blockReasons, ...logReasons];
  const tier: SanitizeTier =
    blockReasons.length > 0 ? "blocked" : logReasons.length > 0 ? "logged" : "clean";

  return {
    text: normRes.text,
    map: composedMap,
    detectText,
    tier,
    reasons,
    blockReasons,
    logReasons,
    blocked: tier === "blocked",
    invisibleCharCount: cleaned.invisibleCharCount,
    mixedScriptWordCount,
  };
}

/**
 * Escapes `<<` -> `‹‹` (U+2039 U+2039) and `>>` -> `››` (U+203A U+203A)
 * so untrusted evidence can never forge delimiter tags (`02` §9.5).
 */
export function escapeEvidenceDelimiters(text: string): string {
  if (!text.includes("<<") && !text.includes(">>")) {
    return text;
  }
  const n = text.length;
  const parts: string[] = [];
  let segStart = 0;
  let i = 0;

  while (i < n) {
    const ch = text.charCodeAt(i);
    if (ch === 0x3c /* '<' */ && i + 1 < n && text.charCodeAt(i + 1) === 0x3c) {
      if (i > segStart) parts.push(text.slice(segStart, i));
      parts.push("\u2039\u2039");
      i += 2;
      segStart = i;
      continue;
    }
    if (ch === 0x3e /* '>' */ && i + 1 < n && text.charCodeAt(i + 1) === 0x3e) {
      if (i > segStart) parts.push(text.slice(segStart, i));
      parts.push("\u203a\u203a");
      i += 2;
      segStart = i;
      continue;
    }
    i += 1;
  }

  if (segStart < n) {
    parts.push(text.slice(segStart));
  }
  return parts.join("");
}

/**
 * Wraps sanitized evidence in `<<EVIDENCE id=…>>\n…\n<</EVIDENCE>>` after escaping
 * internal `<<` / `>>` (`02` §9.5).
 */
export function wrapEvidenceBlock(id: number, sanitizedText: string): string {
  return `<<EVIDENCE id=${id}>>\n${escapeEvidenceDelimiters(sanitizedText)}\n<</EVIDENCE>>`;
}

function isAllowedDoiSuffixChar(cp: number): boolean {
  return (
    isKeyChar(cp) ||
    cp === 0x28 /* '(' */ ||
    cp === 0x29 /* ')' */ ||
    cp === 0x3b /* ';' */ ||
    cp === 0x3c /* '<' */ ||
    cp === 0x3e /* '>' */ ||
    cp === 0x5b /* '[' */ ||
    cp === 0x5d /* ']' */
  );
}

/**
 * Exact DOI prompt placement check (`02` §9.5):
 * `10.` + 4–9 `DIGIT` + `/` + 1–300 characters of `KEY_CHAR`, `(`, `)`, `;`, `<`, `>`, `[`, `]`.
 */
export function isValidPromptDoi(text: string): boolean {
  if (!text.startsWith("10.")) {
    return false;
  }
  const n = text.length;
  let pos = 3;
  let digitCount = 0;
  while (pos < n && isDigit(text.charCodeAt(pos))) {
    digitCount++;
    pos++;
  }
  if (digitCount < DOI_PREFIX_MIN_DIGITS || digitCount > DOI_PREFIX_MAX_DIGITS) {
    return false;
  }
  if (pos >= n || text.charCodeAt(pos) !== 0x2f /* '/' */) {
    return false;
  }
  pos++;
  let suffixCount = 0;
  while (pos < n) {
    const unit = codePointAtSafe(text, pos);
    if (unit.isUnpairedSurrogate || !isAllowedDoiSuffixChar(unit.cp)) {
      return false;
    }
    suffixCount++;
    if (suffixCount > DOI_SUFFIX_MAX_LEN) {
      return false;
    }
    pos += unit.len;
  }
  return suffixCount >= 1;
}

const WITHHELD_PLACEHOLDER: Readonly<Record<MetadataFieldName, string>> = {
  title: "[title withheld]",
  venue: "[venue withheld]",
  first_author: "[author withheld]",
  doi: "[doi withheld]",
};

/**
 * Sanitizes bibliographic metadata shown in prompts (`02` §9.5).
 * Blocked `title`/`venue`/`first_author` become `[* withheld]`; `doi` must also
 * satisfy `isValidPromptDoi` after sanitization or becomes `[doi withheld]`.
 */
export function sanitizeMetadataField(
  field: MetadataFieldName,
  rawValue: string,
): SanitizeMetadataResult {
  const sanitizeResult = sanitizeText(rawValue);
  if (sanitizeResult.blocked) {
    return {
      field,
      value: WITHHELD_PLACEHOLDER[field],
      withheld: true,
      sanitizeResult,
    };
  }
  if (field === "doi" && !isValidPromptDoi(sanitizeResult.text)) {
    return {
      field,
      value: WITHHELD_PLACEHOLDER.doi,
      withheld: true,
      sanitizeResult,
    };
  }
  return {
    field,
    value: escapeEvidenceDelimiters(sanitizeResult.text),
    withheld: false,
    sanitizeResult,
  };
}

/**
 * Predicate helper returning `true` iff evidence `text` falls in the `blocked` tier.
 */
export function isEvidenceUnitBlocked(rawText: string, options?: SanitizeOptions): boolean {
  return sanitizeText(rawText, options).blocked;
}

/**
 * Creates an `isUnitBlocked` callback directly compatible with
 * `selectEvidenceCandidates(..., { isUnitBlocked })` in `coverage.ts` (`02` §8.5, §9.5).
 */
export function createSanitizerUnitBlocker(
  isHiddenUnit?: (unit: { readonly chunkId?: string; readonly text: string }) => boolean,
): (unit: { readonly chunkId?: string; readonly text: string }) => boolean {
  return (unit) => {
    const hidden = isHiddenUnit !== undefined ? isHiddenUnit(unit) : false;
    return sanitizeText(unit.text, hidden ? { hiddenPdfText: true } : undefined).blocked;
  };
}
