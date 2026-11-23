import normTableData from "../norm_table.json" with { type: "json" };
import type { NormTable } from "../norm_table.json.d.ts";
import { JOINER_SCRIPT_RANGES, UNICODE_15_1_BIN_BASE64 } from "./unicode_15_1.generated.js";

export type { NormTable };

export const NORM_TABLE: NormTable = normTableData;

const STAGE2_MAP_BY_CP = new Map<number, string>();
for (const [k, v] of Object.entries(NORM_TABLE.map)) {
  const cp = k.codePointAt(0);
  if (cp !== undefined) {
    STAGE2_MAP_BY_CP.set(cp, v);
  }
}

const LOWER_OVERRIDES_BY_CP = new Map<number, string>();
for (const [k, v] of Object.entries(NORM_TABLE.lower_overrides)) {
  const cp = k.codePointAt(0);
  if (cp !== undefined) {
    LOWER_OVERRIDES_BY_CP.set(cp, v);
  }
}

let maxLatinComposeSeqUnits = 0;
for (const k of Object.keys(NORM_TABLE.latin_compose)) {
  if (k.length > maxLatinComposeSeqUnits) {
    maxLatinComposeSeqUnits = k.length;
  }
}

export const GENERAL_CATEGORIES = [
  "Cn", "Lu", "Ll", "Lt", "Lm", "Lo",
  "Mn", "Mc", "Me",
  "Nd", "Nl", "No",
  "Pc", "Pd", "Ps", "Pe", "Pi", "Pf", "Po",
  "Sm", "Sc", "Sk", "So",
  "Zs", "Zl", "Zp",
  "Cc", "Cf", "Cs", "Co"
] as const;

export type GeneralCategory = (typeof GENERAL_CATEGORIES)[number];

const MAX_CODE_POINT = 0x10ffff;
const BMP_SIZE = 0x10000;

export interface Unicode151Table {
  readonly bmpCategories: Uint8Array;
  readonly bmpSimpleLower: Uint32Array;
  readonly suppCatStarts: Uint32Array;
  readonly suppCatEnds: Uint32Array;
  readonly suppCatCodes: Uint8Array;
  readonly suppLowerSrc: Uint32Array;
  readonly suppLowerDst: Uint32Array;
}

export interface CodePointUnit {
  readonly cp: number;
  readonly len: 1 | 2;
  readonly isUnpairedSurrogate: boolean;
}

export interface NormResult {
  readonly text: string;
  readonly map: number[];
}

function decodeBase64(b64: string): Uint8Array {
  const len = b64.length;
  if (len % 4 !== 0) {
    throw new Error("Invalid base64 length in unicode_15_1 table");
  }
  let padding = 0;
  if (len >= 2) {
    if (b64.charCodeAt(len - 1) === 0x3d) padding += 1;
    if (b64.charCodeAt(len - 2) === 0x3d) padding += 1;
  }
  const outLen = (len / 4) * 3 - padding;
  const out = new Uint8Array(outLen);

  function b64Val(code: number): number {
    if (code >= 0x41 && code <= 0x5a) return code - 0x41; // A-Z
    if (code >= 0x61 && code <= 0x7a) return code - 0x61 + 26; // a-z
    if (code >= 0x30 && code <= 0x39) return code - 0x30 + 52; // 0-9
    if (code === 0x2b) return 62; // +
    if (code === 0x2f) return 63; // /
    return -1;
  }

  let outIdx = 0;
  for (let i = 0; i < len; i += 4) {
    const a = b64Val(b64.charCodeAt(i));
    const b = b64Val(b64.charCodeAt(i + 1));
    const cCode = b64.charCodeAt(i + 2);
    const dCode = b64.charCodeAt(i + 3);
    const c = cCode === 0x3d ? 0 : b64Val(cCode);
    const d = dCode === 0x3d ? 0 : b64Val(dCode);
    if (a < 0 || b < 0 || c < 0 || d < 0) {
      throw new Error("Invalid base64 character in unicode_15_1 table");
    }
    const triple = (a << 18) | (b << 12) | (c << 6) | d;
    out[outIdx++] = (triple >> 16) & 0xff;
    if (cCode !== 0x3d) {
      out[outIdx++] = (triple >> 8) & 0xff;
    }
    if (dCode !== 0x3d) {
      out[outIdx++] = triple & 0xff;
    }
  }
  return out;
}

function readU16LE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset]! | (bytes[offset + 1]! << 8)) >>> 0;
}

function readU32LE(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset]! |
      (bytes[offset + 1]! << 8) |
      (bytes[offset + 2]! << 16) |
      (bytes[offset + 3]! << 24)) >>>
    0
  );
}

/**
 * Parse the binary Unicode 15.1.0 general category and simple lowercase table.
 */
export function parseUnicode151Bin(bytes: Uint8Array): Unicode151Table {
  if (bytes.length < 16) {
    throw new Error("unicode_15_1.bin too short");
  }
  if (
    bytes[0] !== 0x55 || // 'U'
    bytes[1] !== 0x31 || // '1'
    bytes[2] !== 0x35 || // '5'
    bytes[3] !== 0x31    // '1'
  ) {
    throw new Error("Invalid unicode_15_1.bin magic header");
  }
  const version = readU16LE(bytes, 4);
  if (version !== 1) {
    throw new Error(`Unsupported unicode_15_1.bin version: ${version}`);
  }
  const catRunCount = readU32LE(bytes, 8);
  const lowerCount = readU32LE(bytes, 12);
  const expectedLength = 16 + (catRunCount + lowerCount) * 8;
  if (bytes.length !== expectedLength) {
    throw new Error(
      `Corrupt unicode_15_1.bin length: expected ${expectedLength}, got ${bytes.length}`
    );
  }

  const bmpCategories = new Uint8Array(BMP_SIZE);
  const bmpSimpleLower = new Uint32Array(BMP_SIZE);

  const suppCatStartsList: number[] = [];
  const suppCatEndsList: number[] = [];
  const suppCatCodesList: number[] = [];

  let offset = 16;
  for (let i = 0; i < catRunCount; i += 1) {
    const word0 = readU32LE(bytes, offset);
    const end = readU32LE(bytes, offset + 4);
    offset += 8;

    const start = word0 & 0x1fffff;
    const catCode = (word0 >>> 24) & 0xff;
    if (catCode >= GENERAL_CATEGORIES.length) {
      throw new Error(`Invalid category code ${catCode} in unicode_15_1.bin`);
    }

    if (start < BMP_SIZE) {
      const bmpEnd = end < BMP_SIZE ? end : BMP_SIZE - 1;
      for (let cp = start; cp <= bmpEnd; cp += 1) {
        bmpCategories[cp] = catCode;
      }
    }
    if (end >= BMP_SIZE) {
      const suppStart = start >= BMP_SIZE ? start : BMP_SIZE;
      suppCatStartsList.push(suppStart);
      suppCatEndsList.push(end);
      suppCatCodesList.push(catCode);
    }
  }

  const suppLowerSrcList: number[] = [];
  const suppLowerDstList: number[] = [];

  for (let i = 0; i < lowerCount; i += 1) {
    const src = readU32LE(bytes, offset);
    const dst = readU32LE(bytes, offset + 4);
    offset += 8;

    if (src < BMP_SIZE) {
      bmpSimpleLower[src] = dst;
    } else {
      suppLowerSrcList.push(src);
      suppLowerDstList.push(dst);
    }
  }

  return {
    bmpCategories,
    bmpSimpleLower,
    suppCatStarts: Uint32Array.from(suppCatStartsList),
    suppCatEnds: Uint32Array.from(suppCatEndsList),
    suppCatCodes: Uint8Array.from(suppCatCodesList),
    suppLowerSrc: Uint32Array.from(suppLowerSrcList),
    suppLowerDst: Uint32Array.from(suppLowerDstList)
  };
}

const RAW_UNICODE_15_1_BYTES = decodeBase64(UNICODE_15_1_BIN_BASE64);
const UNICODE_15_1_TABLE = parseUnicode151Bin(RAW_UNICODE_15_1_BYTES);

/**
 * Return a fresh copy of the bundled Unicode 15.1.0 binary table bytes.
 */
export function getUnicode151BinBytes(): Uint8Array {
  return RAW_UNICODE_15_1_BYTES.slice();
}

function generalCategoryCode(cp: number): number {
  if (cp < 0 || cp > MAX_CODE_POINT || !Number.isInteger(cp)) {
    return 0; // Cn
  }
  if (cp < BMP_SIZE) {
    return UNICODE_15_1_TABLE.bmpCategories[cp]!;
  }
  const starts = UNICODE_15_1_TABLE.suppCatStarts;
  const ends = UNICODE_15_1_TABLE.suppCatEnds;
  let lo = 0;
  let hi = starts.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const s = starts[mid]!;
    if (cp < s) {
      hi = mid - 1;
    } else if (cp > ends[mid]!) {
      lo = mid + 1;
    } else {
      return UNICODE_15_1_TABLE.suppCatCodes[mid]!;
    }
  }
  return 0;
}

/**
 * Look up the Unicode 15.1.0 General_Category of a code point.
 * Unpaired surrogates (0xD800..0xDFFF) return "Cs".
 */
export function generalCategory(cp: number): GeneralCategory {
  return GENERAL_CATEGORIES[generalCategoryCode(cp)]!;
}

/**
 * Look up the Unicode 15.1.0 field-13 simple lowercase mapping of a code point.
 * Returns the original code point if it has no simple lowercase mapping.
 */
export function simpleLowerCodePoint(cp: number): number {
  if (cp < 0 || cp > MAX_CODE_POINT || !Number.isInteger(cp)) {
    return cp;
  }
  if (cp < BMP_SIZE) {
    const mapped = UNICODE_15_1_TABLE.bmpSimpleLower[cp]!;
    return mapped === 0 && cp !== 0 ? cp : mapped;
  }
  const srcs = UNICODE_15_1_TABLE.suppLowerSrc;
  let lo = 0;
  let hi = srcs.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const s = srcs[mid]!;
    if (cp < s) {
      hi = mid - 1;
    } else if (cp > s) {
      lo = mid + 1;
    } else {
      return UNICODE_15_1_TABLE.suppLowerDst[mid]!;
    }
  }
  return cp;
}

/**
 * Read a Unicode scalar value or unpaired surrogate at UTF-16 offset `index`.
 * Throws a `RangeError` if `index` is out of bounds (`index < 0 || index >= text.length`).
 */
export function codePointAtSafe(text: string, index: number): CodePointUnit {
  if (!Number.isInteger(index) || index < 0 || index >= text.length) {
    throw new RangeError(`codePointAtSafe: index ${index} out of bounds for length ${text.length}`);
  }
  const cu0 = text.charCodeAt(index);
  if (cu0 >= 0xd800 && cu0 <= 0xdbff) {
    if (index + 1 < text.length) {
      const cu1 = text.charCodeAt(index + 1);
      if (cu1 >= 0xdc00 && cu1 <= 0xdfff) {
        const cp = ((cu0 - 0xd800) << 10) + (cu1 - 0xdc00) + 0x10000;
        return { cp, len: 2, isUnpairedSurrogate: false };
      }
    }
    return { cp: cu0, len: 1, isUnpairedSurrogate: true };
  }
  if (cu0 >= 0xdc00 && cu0 <= 0xdfff) {
    return { cp: cu0, len: 1, isUnpairedSurrogate: true };
  }
  return { cp: cu0, len: 1, isUnpairedSurrogate: false };
}

function readPrevCodePointBefore(
  text: string,
  endIndex: number
): { start: number; cp: number; isUnpairedSurrogate: boolean } | null {
  if (endIndex <= 0) return null;
  const cu1 = text.charCodeAt(endIndex - 1);
  if (cu1 >= 0xdc00 && cu1 <= 0xdfff) {
    if (endIndex >= 2) {
      const cu0 = text.charCodeAt(endIndex - 2);
      if (cu0 >= 0xd800 && cu0 <= 0xdbff) {
        const cp = ((cu0 - 0xd800) << 10) + (cu1 - 0xdc00) + 0x10000;
        return { start: endIndex - 2, cp, isUnpairedSurrogate: false };
      }
    }
    return { start: endIndex - 1, cp: cu1, isUnpairedSurrogate: true };
  }
  if (cu1 >= 0xd800 && cu1 <= 0xdbff) {
    return { start: endIndex - 1, cp: cu1, isUnpairedSurrogate: true };
  }
  return { start: endIndex - 1, cp: cu1, isUnpairedSurrogate: false };
}

/**
 * Return true if `cp` lies in one of the script or Emoji ranges where U+200C / U+200D
 * joiners are preserved (02 §2.2.2).
 */
export function isJoinerPreservedScript(cp: number): boolean {
  let lo = 0;
  let hi = JOINER_SCRIPT_RANGES.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const range = JOINER_SCRIPT_RANGES[mid]!;
    if (cp < range[0]) {
      hi = mid - 1;
    } else if (cp > range[1]) {
      lo = mid + 1;
    } else {
      return true;
    }
  }
  return false;
}

// General_Category numeric codes in GENERAL_CATEGORIES:
// 1:Lu, 2:Ll, 3:Lt, 4:Lm, 5:Lo, 6:Mn, 7:Mc, 8:Me, 12..18:P*
function isBaseLetterCode(code: number): boolean {
  return code >= 1 && code <= 5;
}

/** True iff `cp` has Unicode 15.1 General_Category L (Lu, Ll, Lt, Lm, Lo). */
export function isBaseLetter(cp: number): boolean {
  return isBaseLetterCode(generalCategoryCode(cp));
}

/** True iff `cp` has Unicode 15.1 General_Category Mn or Mc. */
export function isCombiningMark(cp: number): boolean {
  const code = generalCategoryCode(cp);
  return code === 6 || code === 7;
}

/** True iff `cp` has Unicode 15.1 General_Category Mn or Me (stripped in detectText). */
export function isMarkMnOrMe(cp: number): boolean {
  const code = generalCategoryCode(cp);
  return code === 6 || code === 8;
}

/** True iff `cp` has Unicode 15.1 General_Category P (Pc, Pd, Ps, Pe, Pi, Pf, Po). */
export function isPunctuation(cp: number): boolean {
  const code = generalCategoryCode(cp);
  return code >= 12 && code <= 18;
}

/**
 * `LETTER` class (02 §2.1): base letter L, or Mn/Mc combining mark immediately following a `LETTER`.
 */
export function isLetter(cp: number, prevIsLetter = false): boolean {
  const code = generalCategoryCode(cp);
  if (isBaseLetterCode(code)) return true;
  return prevIsLetter && (code === 6 || code === 7);
}

/**
 * `LETTER` class evaluated at UTF-16 offset `index` inside `text`.
 * Correctly tracks preceding base letters across multi-mark runs and surrogate pairs.
 */
export function isLetterAt(text: string, index: number): boolean {
  if (index < 0 || index >= text.length) return false;
  const unit = codePointAtSafe(text, index);
  if (unit.isUnpairedSurrogate) return false;
  const code = generalCategoryCode(unit.cp);
  if (isBaseLetterCode(code)) return true;
  if (code !== 6 && code !== 7) return false;

  let cursor = index;
  while (cursor > 0) {
    const prev = readPrevCodePointBefore(text, cursor);
    if (!prev || prev.isUnpairedSurrogate) return false;
    const prevCode = generalCategoryCode(prev.cp);
    if (isBaseLetterCode(prevCode)) return true;
    if (prevCode === 6 || prevCode === 7) {
      cursor = prev.start;
      continue;
    }
    return false;
  }
  return false;
}

/** `UPPER` class (02 §2.1): General_Category Lu or Lt. */
export function isUpper(cp: number): boolean {
  const code = generalCategoryCode(cp);
  return code === 1 || code === 3;
}

/** `LOWER` class (02 §2.1): General_Category Ll. */
export function isLower(cp: number): boolean {
  return generalCategoryCode(cp) === 2;
}

/** `DIGIT` class (02 §2.1): ASCII '0'-'9' only. */
export function isDigit(cp: number): boolean {
  return cp >= 0x30 && cp <= 0x39;
}

/** `SPACE` class (02 §2.1): U+0020, U+0009, U+000A, U+000D. */
export function isSpace(cp: number): boolean {
  return cp === 0x20 || cp === 0x09 || cp === 0x0a || cp === 0x0d;
}

/** `PUNCT_SENT` class (02 §2.1): '.', '?', '!'. */
export function isPunctSent(cp: number): boolean {
  return cp === 0x2e || cp === 0x3f || cp === 0x21;
}

/** `CLOSERS` class (02 §2.1): '"', "'", ')', ']', '}'. */
export function isCloser(cp: number): boolean {
  return (
    cp === 0x22 ||
    cp === 0x27 ||
    cp === 0x29 ||
    cp === 0x5d ||
    cp === 0x7d
  );
}

/**
 * `KEY_CHAR` class (02 §2.1): ASCII letters, ASCII digits, and `_ : . # $ % & - + ? < > ~ / '`.
 */
export function isKeyChar(cp: number): boolean {
  if (cp >= 0x30 && cp <= 0x39) return true; // 0-9
  if (cp >= 0x41 && cp <= 0x5a) return true; // A-Z
  if (cp >= 0x61 && cp <= 0x7a) return true; // a-z
  switch (cp) {
    case 0x5f: // _
    case 0x3a: // :
    case 0x2e: // .
    case 0x23: // #
    case 0x24: // $
    case 0x25: // %
    case 0x26: // &
    case 0x2d: // -
    case 0x2b: // +
    case 0x3f: // ?
    case 0x3c: // <
    case 0x3e: // >
    case 0x7e: // ~
    case 0x2f: // /
    case 0x27: // '
      return true;
    default:
      return false;
  }
}

function normAsciiDigitChar(cp: number): string | null {
  if (cp >= 0x30 && cp <= 0x39) {
    return String.fromCharCode(cp);
  }
  if (cp >= 0xff10 && cp <= 0xff19) {
    return String.fromCharCode(cp - 0xfee0);
  }
  return null;
}

function isSuperscriptDigit(cp: number): boolean {
  return (
    cp === 0x2070 ||
    cp === 0x00b9 ||
    cp === 0x00b2 ||
    cp === 0x00b3 ||
    (cp >= 0x2074 && cp <= 0x2079)
  );
}

function isStage2Superscript(cp: number): boolean {
  return isSuperscriptDigit(cp) || cp === 0x207a || cp === 0x207b;
}

function unitsToString(units: number[]): string {
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

function pushStrUnits(
  units: number[],
  offs: number[],
  str: string,
  srcOffset: number
): void {
  for (let i = 0; i < str.length; i += 1) {
    units.push(str.charCodeAt(i));
    offs.push(srcOffset);
  }
}

function pushCodePointUnits(
  units: number[],
  offs: number[],
  cp: number,
  srcOffset: number
): void {
  if (cp <= 0xffff) {
    units.push(cp);
    offs.push(srcOffset);
  } else {
    const u = cp - 0x10000;
    units.push(0xd800 + (u >> 10), 0xdc00 + (u & 0x3ff));
    offs.push(srcOffset, srcOffset);
  }
}

/**
 * 3-stage deterministic normalization (02 §2.2) with exact UTF-16 source offset map.
 * Never calls platform String.prototype.normalize().
 */
export function norm(x: string): NormResult {
  const xLen = x.length;
  // Clean ASCII fast path: no non-ASCII, no CR/TAB, no consecutive spaces -> identity text & map
  let isCleanAscii = true;
  let prevSpace = false;
  for (let idx = 0; idx < xLen; idx += 1) {
    const cu = x.charCodeAt(idx);
    if (cu >= 0x80 || cu === 0x0d || cu === 0x09) {
      isCleanAscii = false;
      break;
    }
    if (cu === 0x20) {
      if (prevSpace) {
        isCleanAscii = false;
        break;
      }
      prevSpace = true;
    } else {
      prevSpace = false;
    }
  }
  if (isCleanAscii) {
    const map = new Array<number>(xLen + 1);
    for (let idx = 0; idx <= xLen; idx += 1) {
      map[idx] = idx;
    }
    return { text: x, map };
  }

  // Stage 1: latin_compose (strictly O(n))
  const s1Cps: number[] = [];
  const s1Offs: number[] = [];
  const latinCompose = NORM_TABLE.latin_compose;

  let i = 0;
  while (i < xLen) {
    const unit = codePointAtSafe(x, i);
    let end = i + unit.len;
    while (end < xLen) {
      const cu = x.charCodeAt(end);
      if (cu >= 0x0300 && cu <= 0x036f) {
        end += 1;
      } else {
        break;
      }
    }
    if (end > i + unit.len) {
      if (
        !unit.isUnpairedSurrogate &&
        (unit.cp < 0x0300 || unit.cp > 0x036f) &&
        end - i <= maxLatinComposeSeqUnits
      ) {
        const seq = x.slice(i, end);
        const composed = latinCompose[seq];
        if (composed !== undefined) {
          s1Cps.push(composed.codePointAt(0)!);
          s1Offs.push(i);
          i = end;
          continue;
        }
      }
      s1Cps.push(unit.cp);
      s1Offs.push(i);
      for (let m = i + unit.len; m < end; m += 1) {
        s1Cps.push(x.charCodeAt(m));
        s1Offs.push(m);
      }
      i = end;
      continue;
    }
    s1Cps.push(unit.cp);
    s1Offs.push(i);
    i += unit.len;
  }

  // Stage 2: one-code-point mapping table & contextual rules
  const s2Units: number[] = [];
  const s2Offs: number[] = [];
  const s1Len = s1Cps.length;
  let prevWasSuperscript = false;

  let k = 0;
  while (k < s1Len) {
    const cp = s1Cps[k]!;
    const srcOff = s1Offs[k]!;

    // CRLF -> LF
    if (cp === 0x000d && k + 1 < s1Len && s1Cps[k + 1] === 0x000a) {
      s2Units.push(0x000a);
      s2Offs.push(srcOff);
      prevWasSuperscript = false;
      k += 2;
      continue;
    }

    // Script-aware U+200C / U+200D
    if (cp === 0x200c || cp === 0x200d) {
      if (
        k > 0 &&
        k + 1 < s1Len &&
        isJoinerPreservedScript(s1Cps[k - 1]!) &&
        isJoinerPreservedScript(s1Cps[k + 1]!)
      ) {
        s2Units.push(cp);
        s2Offs.push(srcOff);
      }
      prevWasSuperscript = false;
      k += 1;
      continue;
    }

    // Lancet decimal U+00B7 vs multiplication dot
    if (cp === 0x00b7) {
      prevWasSuperscript = false;
      const prevDigit = k > 0 ? normAsciiDigitChar(s1Cps[k - 1]!) : null;
      const nextDigit = k + 1 < s1Len ? normAsciiDigitChar(s1Cps[k + 1]!) : null;
      let isLancetDecimal = prevDigit !== null && nextDigit !== null;
      if (isLancetDecimal && nextDigit === "1" && k + 3 < s1Len) {
        const secondDigit = normAsciiDigitChar(s1Cps[k + 2]!);
        if (secondDigit === "0") {
          const after10 = s1Cps[k + 3]!;
          if (
            after10 === 0x005e ||
            after10 === 0xff3e ||
            isSuperscriptDigit(after10) ||
            ((after10 === 0x207a || after10 === 0x207b) &&
              k + 4 < s1Len &&
              isSuperscriptDigit(s1Cps[k + 4]!))
          ) {
            isLancetDecimal = false;
          }
        }
      }
      s2Units.push(isLancetDecimal ? 0x002e : 0x00d7);
      s2Offs.push(srcOff);
      k += 1;
      continue;
    }

    // Superscripts sharing one leading "^"
    if (isStage2Superscript(cp)) {
      const mapped = STAGE2_MAP_BY_CP.get(cp)!;
      const out = prevWasSuperscript ? mapped.slice(1) : mapped;
      pushStrUnits(s2Units, s2Offs, out, srcOff);
      prevWasSuperscript = true;
      k += 1;
      continue;
    }

    prevWasSuperscript = false;
    if (cp < 0x80) {
      s2Units.push(cp === 0x0d ? 0x0a : cp);
      s2Offs.push(srcOff);
      k += 1;
      continue;
    }
    const mapped = STAGE2_MAP_BY_CP.get(cp);
    if (mapped !== undefined) {
      pushStrUnits(s2Units, s2Offs, mapped, srcOff);
    } else {
      pushCodePointUnits(s2Units, s2Offs, cp, srcOff);
    }
    k += 1;
  }

  // Stage 3: collapse U+0020 / U+0009 runs to one U+0020 without trimming
  const s3Units: number[] = [];
  const map: number[] = [];
  const s2Len = s2Units.length;

  let j = 0;
  while (j < s2Len) {
    const u = s2Units[j]!;
    if (u === 0x0020 || u === 0x0009) {
      s3Units.push(0x0020);
      map.push(s2Offs[j]!);
      j += 1;
      while (j < s2Len && (s2Units[j] === 0x0020 || s2Units[j] === 0x0009)) {
        j += 1;
      }
    } else {
      s3Units.push(u);
      map.push(s2Offs[j]!);
      j += 1;
    }
  }

  map.push(xLen);
  return {
    text: unitsToString(s3Units),
    map
  };
}

/**
 * `normLower` returning both lowercased text and carried-over UTF-16 offset map (02 §2.3).
 */
export function normLowerWithMap(x: string): NormResult {
  const xLen = x.length;
  let allAsciiClean = true;
  let prevSpace = false;
  for (let i = 0; i < xLen; i += 1) {
    const cu = x.charCodeAt(i);
    if (cu >= 0x80 || cu === 0x0d || cu === 0x09) {
      allAsciiClean = false;
      break;
    }
    if (cu === 0x20) {
      if (prevSpace) {
        allAsciiClean = false;
        break;
      }
      prevSpace = true;
    } else {
      prevSpace = false;
    }
  }

  if (allAsciiClean) {
    const outMap = new Array<number>(xLen + 1);
    let out = "";
    let changed = false;
    for (let i = 0; i < xLen; i += 1) {
      outMap[i] = i;
      const cu = x.charCodeAt(i);
      if (cu >= 0x41 && cu <= 0x5a) {
        if (!changed) {
          out = x.slice(0, i);
          changed = true;
        }
        out += String.fromCharCode(cu + 32);
      } else if (changed) {
        out += x.charAt(i);
      }
    }
    outMap[xLen] = xLen;
    return {
      text: changed ? out : x,
      map: outMap
    };
  }

  const { text, map } = norm(x);
  const outUnits: number[] = [];
  const outMap: number[] = [];

  let i = 0;
  while (i < text.length) {
    const rawOff = map[i] ?? xLen;
    const cu0 = text.charCodeAt(i);
    if (cu0 < 0x80) {
      outUnits.push(cu0 >= 0x41 && cu0 <= 0x5a ? cu0 + 32 : cu0);
      outMap.push(rawOff);
      i += 1;
      continue;
    }
    const unit = codePointAtSafe(text, i);
    if (unit.isUnpairedSurrogate) {
      outUnits.push(unit.cp);
      outMap.push(rawOff);
      i += 1;
      continue;
    }
    const override = LOWER_OVERRIDES_BY_CP.get(unit.cp);
    if (override !== undefined) {
      pushStrUnits(outUnits, outMap, override, rawOff);
    } else {
      const lowerCp = simpleLowerCodePoint(unit.cp);
      pushCodePointUnits(outUnits, outMap, lowerCp, rawOff);
    }
    i += unit.len;
  }

  outMap.push(xLen);
  return {
    text: unitsToString(outUnits),
    map: outMap
  };
}

/**
 * `normLower(x)` (02 §2.3): `norm(x)` followed by Unicode 15.1.0 field-13 simple
 * lowercasing from `unicode_15_1.bin` plus `lower_overrides` (keeping U+0130 unchanged).
 */
export function normLower(x: string): string {
  const xLen = x.length;
  let allAscii = true;
  let needsRewrite = false;
  let prevSpace = false;

  for (let i = 0; i < xLen; i += 1) {
    const cu = x.charCodeAt(i);
    if (cu >= 0x80) {
      allAscii = false;
      break;
    }
    if ((cu >= 0x41 && cu <= 0x5a) || cu === 0x0d || cu === 0x09) {
      needsRewrite = true;
      prevSpace = cu === 0x09;
    } else if (cu === 0x20) {
      if (prevSpace) {
        needsRewrite = true;
      }
      prevSpace = true;
    } else {
      prevSpace = false;
    }
  }

  if (allAscii) {
    if (!needsRewrite) {
      return x;
    }
    const outUnits = new Array<number>();
    let inSpace = false;
    for (let i = 0; i < xLen; i += 1) {
      const cu = x.charCodeAt(i);
      if (cu === 0x20 || cu === 0x09) {
        if (!inSpace) {
          outUnits.push(0x20);
          inSpace = true;
        }
      } else if (cu === 0x0d) {
        if (i + 1 < xLen && x.charCodeAt(i + 1) === 0x0a) {
          i += 1;
        }
        outUnits.push(0x0a);
        inSpace = false;
      } else if (cu >= 0x41 && cu <= 0x5a) {
        outUnits.push(cu + 32);
        inSpace = false;
      } else {
        outUnits.push(cu);
        inSpace = false;
      }
    }
    return unitsToString(outUnits);
  }

  return normLowerWithMap(x).text;
}

/**
 * Applies Unicode 15.1.0 field-13 simple lowercasing + `lower_overrides` per code point
 * to an ALREADY-normalized (`norm()`) string without running `norm()` a second time.
 * Preserves exact UTF-16 length alignment with `normText`.
 */
export function lowercaseNormalized(normText: string): string {
  const len = normText.length;
  let allAscii = true;
  let hasUpper = false;
  for (let i = 0; i < len; i += 1) {
    const cu = normText.charCodeAt(i);
    if (cu >= 0x80) {
      allAscii = false;
      break;
    }
    if (cu >= 0x41 && cu <= 0x5a) {
      hasUpper = true;
    }
  }
  if (allAscii) {
    if (!hasUpper) {
      return normText;
    }
    const outUnits = new Array<number>(len);
    for (let i = 0; i < len; i += 1) {
      const cu = normText.charCodeAt(i);
      outUnits[i] = cu >= 0x41 && cu <= 0x5a ? cu + 32 : cu;
    }
    return unitsToString(outUnits);
  }

  const outUnits: number[] = [];
  let i = 0;
  while (i < len) {
    const cu0 = normText.charCodeAt(i);
    if (cu0 < 0x80) {
      outUnits.push(cu0 >= 0x41 && cu0 <= 0x5a ? cu0 + 32 : cu0);
      i += 1;
      continue;
    }
    const unit = codePointAtSafe(normText, i);
    if (unit.isUnpairedSurrogate) {
      outUnits.push(unit.cp);
      i += 1;
      continue;
    }
    const override = LOWER_OVERRIDES_BY_CP.get(unit.cp);
    if (override !== undefined) {
      for (let k = 0; k < override.length; k += 1) {
        outUnits.push(override.charCodeAt(k));
      }
    } else {
      const lowerCp = simpleLowerCodePoint(unit.cp);
      if (lowerCp <= 0xffff) {
        outUnits.push(lowerCp);
      } else {
        const u = lowerCp - 0x10000;
        outUnits.push(0xd800 + (u >> 10), 0xdc00 + (u & 0x3ff));
      }
    }
    i += unit.len;
  }
  return unitsToString(outUnits);
}

/**
 * `foldLatin(x)` (02 §2.3): strips Latin diacritics using `latin_fold` after
 * `latin_compose` so decomposed and precomposed inputs fold identically.
 */
export function foldLatin(x: string): string {
  const xLen = x.length;
  const latinCompose = NORM_TABLE.latin_compose;
  const latinFold = NORM_TABLE.latin_fold;

  // Stage 1: latin_compose (strictly O(n))
  const s1Units: string[] = [];
  let i = 0;
  while (i < xLen) {
    const unit = codePointAtSafe(x, i);
    let end = i + unit.len;
    while (end < xLen) {
      const cu = x.charCodeAt(end);
      if (cu >= 0x0300 && cu <= 0x036f) {
        end += 1;
      } else {
        break;
      }
    }
    if (end > i + unit.len) {
      if (
        !unit.isUnpairedSurrogate &&
        (unit.cp < 0x0300 || unit.cp > 0x036f) &&
        end - i <= maxLatinComposeSeqUnits
      ) {
        const seq = x.slice(i, end);
        const composed = latinCompose[seq];
        if (composed !== undefined) {
          s1Units.push(composed);
          i = end;
          continue;
        }
      }
      s1Units.push(x.slice(i, i + unit.len));
      for (let m = i + unit.len; m < end; m += 1) {
        s1Units.push(x.charAt(m));
      }
      i = end;
      continue;
    }
    s1Units.push(x.slice(i, i + unit.len));
    i += unit.len;
  }

  // Fold Latin letters and drop any leftover U+0300..U+036F marks attached to a Latin letter
  const out: string[] = [];
  let prevWasLatin = false;
  for (const ch of s1Units) {
    const folded = latinFold[ch];
    if (folded !== undefined) {
      out.push(folded);
      prevWasLatin = true;
      continue;
    }
    const unit = codePointAtSafe(ch, 0);
    if (!unit.isUnpairedSurrogate && unit.cp >= 0x0300 && unit.cp <= 0x036f && prevWasLatin) {
      continue;
    }
    out.push(ch);
    prevWasLatin =
      !unit.isUnpairedSurrogate &&
      ((unit.cp >= 0x41 && unit.cp <= 0x5a) ||
        (unit.cp >= 0x61 && unit.cp <= 0x7a) ||
        (unit.cp >= 0x00c0 && unit.cp <= 0x024f && isBaseLetter(unit.cp)) ||
        (unit.cp >= 0x1e00 && unit.cp <= 0x1eff && isBaseLetter(unit.cp)));
  }

  return out.join("");
}

/**
 * Encode a JS string as UTF-8 bytes, replacing any unpaired surrogate with U+FFFD
 * (0xEF, 0xBF, 0xBD) on every platform (02 §2.3).
 */
export function utf8Encode(x: string): Uint8Array {
  const n = x.length;
  let allAscii = true;
  for (let i = 0; i < n; i += 1) {
    if (x.charCodeAt(i) >= 0x80) {
      allAscii = false;
      break;
    }
  }
  if (allAscii) {
    const asciiBuf = new Uint8Array(n);
    for (let i = 0; i < n; i += 1) {
      asciiBuf[i] = x.charCodeAt(i);
    }
    return asciiBuf;
  }

  const buf = new Uint8Array(n * 3);
  let pos = 0;
  let i = 0;
  while (i < n) {
    const cu = x.charCodeAt(i);
    if (cu <= 0x7f) {
      buf[pos++] = cu;
      i += 1;
      continue;
    }
    const unit = codePointAtSafe(x, i);
    const cp = unit.isUnpairedSurrogate ? 0xfffd : unit.cp;
    if (cp <= 0x7ff) {
      buf[pos++] = 0xc0 | (cp >> 6);
      buf[pos++] = 0x80 | (cp & 0x3f);
    } else if (cp <= 0xffff) {
      buf[pos++] = 0xe0 | (cp >> 12);
      buf[pos++] = 0x80 | ((cp >> 6) & 0x3f);
      buf[pos++] = 0x80 | (cp & 0x3f);
    } else {
      buf[pos++] = 0xf0 | (cp >> 18);
      buf[pos++] = 0x80 | ((cp >> 12) & 0x3f);
      buf[pos++] = 0x80 | ((cp >> 6) & 0x3f);
      buf[pos++] = 0x80 | (cp & 0x3f);
    }
    i += unit.len;
  }
  return buf.subarray(0, pos);
}

const SHA256_K = new Int32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]);

const SHA256_W = new Int32Array(64);
const SHA256_PAD_SCRATCH = new Uint8Array(256);
const SHA256_STATE_SCRATCH = new Int32Array(8);

const HEX_CHARS = "0123456789abcdef";
const HEX_BYTE: readonly string[] = Array.from(
  { length: 256 },
  (_, b) => HEX_CHARS.charAt(b >>> 4) + HEX_CHARS.charAt(b & 0xf)
);

function wordToHex(word: number): string {
  return (
    HEX_BYTE[(word >>> 24) & 0xff]! +
    HEX_BYTE[(word >>> 16) & 0xff]! +
    HEX_BYTE[(word >>> 8) & 0xff]! +
    HEX_BYTE[word & 0xff]!
  );
}

function writeSha256PadAndLength(
  buf: Uint8Array,
  tailBytesLen: number,
  totalMsgBytes: number,
): number {
  const paddedLen = ((tailBytesLen + 9 + 63) >>> 6) << 6;
  buf[tailBytesLen] = 0x80;
  buf.fill(0, tailBytesLen + 1, paddedLen - 8);
  const bitLenHi = Math.floor(totalMsgBytes / 0x20000000) | 0;
  const bitLenLo = (totalMsgBytes << 3) | 0;
  buf[paddedLen - 8] = (bitLenHi >>> 24) & 0xff;
  buf[paddedLen - 7] = (bitLenHi >>> 16) & 0xff;
  buf[paddedLen - 6] = (bitLenHi >>> 8) & 0xff;
  buf[paddedLen - 5] = bitLenHi & 0xff;
  buf[paddedLen - 4] = (bitLenLo >>> 24) & 0xff;
  buf[paddedLen - 3] = (bitLenLo >>> 16) & 0xff;
  buf[paddedLen - 2] = (bitLenLo >>> 8) & 0xff;
  buf[paddedLen - 1] = bitLenLo & 0xff;
  return paddedLen;
}

function compressSha256BlocksToState(
  bytes: Uint8Array,
  fullBlockBytes: number,
  st: Int32Array,
): void {
  let h0 = st[0]!;
  let h1 = st[1]!;
  let h2 = st[2]!;
  let h3 = st[3]!;
  let h4 = st[4]!;
  let h5 = st[5]!;
  let h6 = st[6]!;
  let h7 = st[7]!;

  const w = SHA256_W;
  const k = SHA256_K;

  for (let offset = 0; offset < fullBlockBytes; offset += 64) {
    for (let t = 0; t < 16; t += 1) {
      const j = offset + (t << 2);
      w[t] = (bytes[j]! << 24) | (bytes[j + 1]! << 16) | (bytes[j + 2]! << 8) | bytes[j + 3]!;
    }
    for (let t = 16; t < 64; t += 1) {
      const w15 = w[t - 15]!;
      const w2 = w[t - 2]!;
      const s0 = ((w15 >>> 7) | (w15 << 25)) ^ ((w15 >>> 18) | (w15 << 14)) ^ (w15 >>> 3);
      const s1 = ((w2 >>> 17) | (w2 << 15)) ^ ((w2 >>> 19) | (w2 << 13)) ^ (w2 >>> 10);
      w[t] = (w[t - 16]! + s0 + w[t - 7]! + s1) | 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let t = 0; t < 64; t += 1) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + k[t]! + w[t]!) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) | 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) | 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) | 0;
    }

    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
    h5 = (h5 + f) | 0;
    h6 = (h6 + g) | 0;
    h7 = (h7 + h) | 0;
  }

  st[0] = h0;
  st[1] = h1;
  st[2] = h2;
  st[3] = h3;
  st[4] = h4;
  st[5] = h5;
  st[6] = h6;
  st[7] = h7;
}

function initSha256State(st: Int32Array): void {
  st[0] = 0x6a09e667 | 0;
  st[1] = 0xbb67ae85 | 0;
  st[2] = 0x3c6ef372 | 0;
  st[3] = 0xa54ff53a | 0;
  st[4] = 0x510e527f | 0;
  st[5] = 0x9b05688c | 0;
  st[6] = 0x1f83d9ab | 0;
  st[7] = 0x5be0cd19 | 0;
}

function stateToHex(st: Int32Array, hex32Only: boolean): string {
  if (hex32Only) {
    return (
      wordToHex(st[0]!) +
      wordToHex(st[1]!) +
      wordToHex(st[2]!) +
      wordToHex(st[3]!)
    );
  }
  return (
    wordToHex(st[0]!) +
    wordToHex(st[1]!) +
    wordToHex(st[2]!) +
    wordToHex(st[3]!) +
    wordToHex(st[4]!) +
    wordToHex(st[5]!) +
    wordToHex(st[6]!) +
    wordToHex(st[7]!)
  );
}

/**
 * Pure TypeScript synchronous SHA-256 over raw bytes, returning 64 lowercase hex chars.
 */
export function sha256hexBytes(bytes: Uint8Array): string {
  const len = bytes.length;
  const paddedLen = ((len + 9 + 63) >>> 6) << 6;
  const padded = paddedLen <= 256 ? SHA256_PAD_SCRATCH : new Uint8Array(paddedLen);
  padded.set(bytes);
  writeSha256PadAndLength(padded, len, len);
  initSha256State(SHA256_STATE_SCRATCH);
  compressSha256BlocksToState(padded, paddedLen, SHA256_STATE_SCRATCH);
  return stateToHex(SHA256_STATE_SCRATCH, false);
}

/**
 * Pure TypeScript synchronous `sha256hex(x)` (02 §2.3): lowercase hex SHA-256 of UTF-8 bytes
 * after converting any unpaired surrogates to U+FFFD.
 */
export function sha256hex(x: string): string {
  const len = x.length;
  if (len <= 247) {
    let allAscii = true;
    for (let i = 0; i < len; i += 1) {
      const cu = x.charCodeAt(i);
      if (cu >= 0x80) {
        allAscii = false;
        break;
      }
      SHA256_PAD_SCRATCH[i] = cu;
    }
    if (allAscii) {
      const paddedLen = writeSha256PadAndLength(SHA256_PAD_SCRATCH, len, len);
      initSha256State(SHA256_STATE_SCRATCH);
      compressSha256BlocksToState(SHA256_PAD_SCRATCH, paddedLen, SHA256_STATE_SCRATCH);
      return stateToHex(SHA256_STATE_SCRATCH, false);
    }
  }
  return sha256hexBytes(utf8Encode(x));
}

export interface Sha256PrefixHasher {
  digestHex32(suffix: string): string;
  digestHex(suffix: string): string;
}

/**
 * Pre-computes SHA-256 midstate over the full 64-byte blocks of `prefix` so repeated
 * `sha256hex(prefix + suffix)` calls hash only the remaining tail bytes.
 */
export function createSha256PrefixHasher(prefix: string): Sha256PrefixHasher {
  const prefixBytes = utf8Encode(prefix);
  const prefixByteLen = prefixBytes.length;
  const fullBlockBytes = prefixByteLen & ~63;
  const remLen = prefixByteLen - fullBlockBytes;
  const rem = prefixBytes.slice(fullBlockBytes);

  const mid = new Int32Array(8);
  initSha256State(mid);
  if (fullBlockBytes > 0) {
    compressSha256BlocksToState(prefixBytes, fullBlockBytes, mid);
  }
  const b0 = mid[0]!;
  const b1 = mid[1]!;
  const b2 = mid[2]!;
  const b3 = mid[3]!;
  const b4 = mid[4]!;
  const b5 = mid[5]!;
  const b6 = mid[6]!;
  const b7 = mid[7]!;

  const hashSuffix = (suffix: string, hex32Only: boolean): string => {
    const sLen = suffix.length;
    if (remLen + sLen <= 247) {
      let allAscii = true;
      for (let i = 0; i < remLen; i += 1) {
        SHA256_PAD_SCRATCH[i] = rem[i]!;
      }
      for (let i = 0; i < sLen; i += 1) {
        const cu = suffix.charCodeAt(i);
        if (cu >= 0x80) {
          allAscii = false;
          break;
        }
        SHA256_PAD_SCRATCH[remLen + i] = cu;
      }
      if (allAscii) {
        const tailLen = remLen + sLen;
        const totalMsgBytes = prefixByteLen + sLen;
        const paddedLen = writeSha256PadAndLength(SHA256_PAD_SCRATCH, tailLen, totalMsgBytes);
        SHA256_STATE_SCRATCH[0] = b0;
        SHA256_STATE_SCRATCH[1] = b1;
        SHA256_STATE_SCRATCH[2] = b2;
        SHA256_STATE_SCRATCH[3] = b3;
        SHA256_STATE_SCRATCH[4] = b4;
        SHA256_STATE_SCRATCH[5] = b5;
        SHA256_STATE_SCRATCH[6] = b6;
        SHA256_STATE_SCRATCH[7] = b7;
        compressSha256BlocksToState(SHA256_PAD_SCRATCH, paddedLen, SHA256_STATE_SCRATCH);
        return stateToHex(SHA256_STATE_SCRATCH, hex32Only);
      }
    }

    const sufBytes = utf8Encode(suffix);
    const tailLen = remLen + sufBytes.length;
    const totalMsgBytes = prefixByteLen + sufBytes.length;
    const paddedLen = ((tailLen + 9 + 63) >>> 6) << 6;
    const buf = paddedLen <= 256 ? SHA256_PAD_SCRATCH : new Uint8Array(paddedLen);
    buf.set(rem, 0);
    buf.set(sufBytes, remLen);
    writeSha256PadAndLength(buf, tailLen, totalMsgBytes);
    SHA256_STATE_SCRATCH[0] = b0;
    SHA256_STATE_SCRATCH[1] = b1;
    SHA256_STATE_SCRATCH[2] = b2;
    SHA256_STATE_SCRATCH[3] = b3;
    SHA256_STATE_SCRATCH[4] = b4;
    SHA256_STATE_SCRATCH[5] = b5;
    SHA256_STATE_SCRATCH[6] = b6;
    SHA256_STATE_SCRATCH[7] = b7;
    compressSha256BlocksToState(buf, paddedLen, SHA256_STATE_SCRATCH);
    return stateToHex(SHA256_STATE_SCRATCH, hex32Only);
  };

  return {
    digestHex32: (suffix: string): string => hashSuffix(suffix, true),
    digestHex: (suffix: string): string => hashSuffix(suffix, false),
  };
}
