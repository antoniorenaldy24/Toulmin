/**
 * Format-scoped linear-time pre-masking engine (`docs/spec/02_L0_TIER_A_PRE_DECODE.md` §3.1)
 * plus B5 table cell (`03` §4.1) and `\bibitem` (`03` §5.2) extraction.
 *
 * Strictly O(n): uses precomputed brace maps, environment pairing maps, and
 * monotone negative-search frontiers. Zero regular expressions.
 */

import { buildBraceCloseMap, collapseAndTrimAsciiSpace, mathText } from "./math.js";
import { isDigit, isSpace } from "./norm.js";
import {
  LATEX_SECTION_LEVELS,
  SectionTracker,
  createEmptyImportQualityReport,
  type ImportQualityReport,
  type LatexSectionCommand,
  type SectionState,
} from "./sections.js";

export const MASK_CHAR = "\uE000";

export const YAML_FRONT_MATTER_MAX_LEN = 20_000;
export const HTML_COMMENT_MAX_LEN = 100_000;
export const FENCED_CODE_MAX_LEN = 200_000;
export const INLINE_CODE_MAX_LEN = 400;
export const DISPLAY_MATH_MAX_LEN = 20_000;
export const INLINE_MATH_MAX_LEN = 400;
export const NON_PROSE_ENV_MAX_LEN = 200_000;
export const CAPTION_MAX_LEN = 5_000;
export const FOOTNOTE_MAX_LEN = 5_000;
export const SECTION_TITLE_MAX_LEN = 2_000;
export const ARG_BRACKET_MAX_LEN = 200;
export const ARG_BRACE_MAX_LEN = 2_000;
export const ARG_MAX_BRACKETS = 2;
export const ARG_MAX_BRACES = 3;
export const MACRO_PARAM_MAX_LEN = 40;
export const MACRO_BODY_MAX_LEN = 2_000;
export const USER_MACRO_MAX_BODY_LEN = 200;
export const USER_MACRO_MAX_COUNT = 200;

export const DISPLAY_MATH_ENVS: ReadonlySet<string> = new Set([
  "equation",
  "align",
  "gather",
  "multline",
  "eqnarray",
  "math",
  "displaymath",
]);

export const NON_PROSE_ENVS: ReadonlySet<string> = new Set([
  "figure",
  "table",
  "tabular",
  "tabularx",
  "longtable",
  "lstlisting",
  "verbatim",
  "minted",
  "algorithm",
  "tikzpicture",
  "comment",
  "thebibliography",
]);

export const RAW_NON_PROSE_ENVS: ReadonlySet<string> = new Set([
  "lstlisting",
  "verbatim",
  "minted",
  "comment",
]);

export const TABLE_ENVS: ReadonlySet<string> = new Set([
  "tabular",
  "tabularx",
  "longtable",
]);

export const KNOWN_PROSE_ENVS: ReadonlySet<string> = new Set([
  "abstract",
  "document",
  "itemize",
  "enumerate",
  "description",
  "list",
  "trivlist",
  "quote",
  "quotation",
  "verse",
  "center",
  "flushleft",
  "flushright",
  "minipage",
  "parbox",
  "theorem",
  "lemma",
  "proposition",
  "corollary",
  "definition",
  "remark",
  "example",
  "proof",
  "cases",
  "acknowledgments",
  "acknowledgements",
  "appendix",
  "appendices",
]);

export const STRUCTURAL_COMMANDS: ReadonlySet<string> = new Set([
  "documentclass",
  "usepackage",
  "label",
  "ref",
  "eqref",
  "autoref",
  "cref",
  "Cref",
  "pageref",
  "includegraphics",
  "bibliography",
  "bibliographystyle",
  "addbibresource",
  "DeclareMathOperator",
  "input",
  "include",
  "subfile",
  "vspace",
  "hspace",
  "maketitle",
  "tableofcontents",
  "nocite",
  "setlength",
  "graphicspath",
]);

export const SECTION_COMMANDS: ReadonlySet<string> = new Set([
  "part",
  "chapter",
  "section",
  "subsection",
  "subsubsection",
  "paragraph",
]);

export const FOOTNOTE_COMMANDS: ReadonlySet<string> = new Set([
  "footnote",
  "footnotetext",
]);

export const MACRO_DEF_COMMANDS: ReadonlySet<string> = new Set([
  "newcommand",
  "renewcommand",
  "providecommand",
  "def",
  "let",
  "DeclareCiteCommand",
]);

export type SourceFormat = "latex" | "md";

export interface MaskedSpan {
  readonly start: number;
  readonly end: number;
}

export type MaskedRegionKind =
  | "yaml_front_matter"
  | "latex_comment"
  | "html_comment"
  | "display_math"
  | "inline_math"
  | "non_prose_env"
  | "footnote"
  | "structural_command"
  | "macro_def"
  | "section_heading"
  | "abstract_tag"
  | "env_tag"
  | "list_item"
  | "fenced_code"
  | "inline_code"
  | "md_heading"
  | "md_table";

export interface MaskedRegion {
  readonly kind: MaskedRegionKind;
  readonly start: number;
  readonly end: number;
  readonly isBlockBoundary: boolean;
}

export interface MathRegionRecord {
  readonly kind: "display" | "inline";
  readonly start: number;
  readonly end: number;
  readonly raw: string;
  readonly text: string;
}

export interface ExtractedProseStream {
  readonly kind: "caption" | "footnote";
  readonly start: number;
  readonly end: number;
  readonly rawText: string;
  readonly section: SectionState;
}

export interface ExtractedTable {
  readonly sourceKind: "latex_tabular" | "md_table";
  readonly envName?: string;
  readonly start: number;
  readonly end: number;
  readonly headers: readonly string[];
  readonly rows: readonly (readonly string[])[];
  readonly section: SectionState;
}

export interface ExtractedBibItem {
  readonly label: string | null;
  readonly key: string;
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

export interface SectionTransition {
  readonly offset: number;
  readonly bodyStart: number;
  readonly state: SectionState;
}

export interface FrontMatterMetadata {
  readonly bibliography?: string;
  readonly lang?: string;
  readonly math?: boolean;
}

export interface PreMaskOptions {
  readonly frontMatterMath?: boolean;
  readonly report?: ImportQualityReport;
}

export interface PreMaskResult {
  readonly format: SourceFormat;
  readonly maskedText: string;
  readonly regions: readonly MaskedRegion[];
  readonly blockRegions: readonly MaskedSpan[];
  readonly mathRegions: readonly MathRegionRecord[];
  readonly proseStreams: readonly ExtractedProseStream[];
  readonly tables: readonly ExtractedTable[];
  readonly bibItems: readonly ExtractedBibItem[];
  readonly sectionTransitions: readonly SectionTransition[];
  readonly listItemStarts: readonly number[];
  readonly userMacros: ReadonlyMap<string, string>;
  readonly customCiteMacros: ReadonlySet<string>;
  readonly frontMatter: FrontMatterMetadata;
  readonly report: ImportQualityReport;
}

export function isAsciiLetter(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isHorizontalSpace(code: number): boolean {
  return code === 32 || code === 9;
}

function isLineBreakCode(code: number): boolean {
  return code === 10 || code === 13;
}

function stripTrailingStar(envName: string): string {
  return envName.endsWith("*") ? envName.slice(0, -1) : envName;
}

function recordDistinct(list: string[], value: string): void {
  if (!list.includes(value)) {
    list.push(value);
  }
}

function containsCiteAsciiCaseInsensitive(name: string): boolean {
  const n = name.length;
  for (let i = 0; i + 3 < n; i++) {
    const c0 = name.charCodeAt(i);
    const c1 = name.charCodeAt(i + 1);
    const c2 = name.charCodeAt(i + 2);
    const c3 = name.charCodeAt(i + 3);
    if (
      (c0 === 99 || c0 === 67) &&
      (c1 === 105 || c1 === 73) &&
      (c2 === 116 || c2 === 84) &&
      (c3 === 101 || c3 === 69)
    ) {
      return true;
    }
  }
  return false;
}

function asciiLower(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    out += code >= 65 && code <= 90 ? String.fromCharCode(code + 32) : s.charAt(i);
  }
  return out;
}

/** Counts consecutive `\` characters immediately preceding `index`. */
export function countPrecedingBackslashes(input: string, index: number): number {
  let count = 0;
  let k = index - 1;
  while (k >= 0 && input.charCodeAt(k) === 92) {
    count++;
    k--;
  }
  return count;
}

/**
 * Checks whether `[start, end)` occupies its own line (only horizontal space
 * before `start` back to line start, and only horizontal space after `end` up to line end).
 */
function isOnOwnLine(input: string, start: number, end: number): boolean {
  let left = start - 1;
  while (left >= 0) {
    const code = input.charCodeAt(left);
    if (isLineBreakCode(code)) {
      break;
    }
    if (!isHorizontalSpace(code)) {
      return false;
    }
    left--;
  }
  let right = end;
  while (right < input.length) {
    const code = input.charCodeAt(right);
    if (isLineBreakCode(code)) {
      break;
    }
    if (!isHorizontalSpace(code)) {
      return false;
    }
    right++;
  }
  return true;
}

/**
 * Advances past spaces, tabs, and at most one line break (`\r\n`, `\n`, or `\r`).
 * When a blank line is encountered, `crossedBlankLine` is set `true` and scanning stops.
 */
export function skipAdjacentWhitespace(
  input: string,
  start: number,
  end: number,
): { readonly pos: number; readonly crossedBlankLine: boolean } {
  let cur = start;
  let lineBreaks = 0;
  while (cur < end) {
    const code = input.charCodeAt(cur);
    if (isHorizontalSpace(code)) {
      cur++;
    } else if (code === 13) {
      if (lineBreaks >= 1) {
        return { pos: cur, crossedBlankLine: true };
      }
      lineBreaks++;
      cur += cur + 1 < end && input.charCodeAt(cur + 1) === 10 ? 2 : 1;
    } else if (code === 10) {
      if (lineBreaks >= 1) {
        return { pos: cur, crossedBlankLine: true };
      }
      lineBreaks++;
      cur++;
    } else {
      break;
    }
  }
  return { pos: cur, crossedBlankLine: false };
}

/**
 * Scans a `[…]` group starting at `openIdx` (`[`):
 * enforces length ≤ `maxLen`, disallows unescaped nested `[`, and skips balanced `{…}`.
 */
export function scanBracketGroup(
  input: string,
  braceClose: Int32Array,
  openIdx: number,
  endLimit: number,
  maxLen: number,
): number {
  if (openIdx >= endLimit || input.charCodeAt(openIdx) !== 91) {
    return -1;
  }
  const stop = Math.min(endLimit, openIdx + maxLen);
  let i = openIdx + 1;
  while (i < stop) {
    const code = input.charCodeAt(i);
    if (code === 92) {
      i += 2;
      continue;
    }
    if (code === 123) {
      const close = braceClose[i] ?? -1;
      if (close !== -1 && close < stop) {
        i = close + 1;
        continue;
      }
      return -1;
    }
    if (code === 93) {
      return i;
    }
    if (code === 91) {
      return -1;
    }
    i++;
  }
  return -1;
}

export interface ArgumentSequenceResult {
  readonly end: number;
  readonly brackets: readonly { readonly start: number; readonly end: number }[];
  readonly braces: readonly { readonly start: number; readonly end: number }[];
}

/**
 * Shared argument-sequence scanner (`02` §3.1):
 * accepts up to 2 `[…]` (≤ 200 chars, no nested `[`) and up to 3 balanced `{…}`
 * (≤ 2,000 chars) in any order, adjacent across spaces/tabs/at most 1 newline.
 */
export function scanArgumentSequence(
  input: string,
  braceClose: Int32Array,
  startPos: number,
  endLimit: number = input.length,
): ArgumentSequenceResult {
  const brackets: { readonly start: number; readonly end: number }[] = [];
  const braces: { readonly start: number; readonly end: number }[] = [];
  let acceptedEnd = startPos;

  while (brackets.length < ARG_MAX_BRACKETS || braces.length < ARG_MAX_BRACES) {
    const adj = skipAdjacentWhitespace(input, acceptedEnd, endLimit);
    if (adj.crossedBlankLine || adj.pos >= endLimit) {
      break;
    }
    const ch = input.charCodeAt(adj.pos);
    if (ch === 91 && brackets.length < ARG_MAX_BRACKETS) {
      const close = scanBracketGroup(input, braceClose, adj.pos, endLimit, ARG_BRACKET_MAX_LEN);
      if (close === -1) {
        break;
      }
      brackets.push({ start: adj.pos, end: close + 1 });
      acceptedEnd = close + 1;
      continue;
    }
    if (ch === 123 && braces.length < ARG_MAX_BRACES) {
      const close = braceClose[adj.pos] ?? -1;
      if (close === -1 || close >= endLimit || close + 1 - adj.pos > ARG_BRACE_MAX_LEN) {
        break;
      }
      braces.push({ start: adj.pos, end: close + 1 });
      acceptedEnd = close + 1;
      continue;
    }
    break;
  }

  return { end: acceptedEnd, brackets, braces };
}

function advanceLineEnd(input: string, start: number, end: number): { readonly contentEnd: number; readonly nextLineStart: number } {
  let i = start;
  while (i < end) {
    const code = input.charCodeAt(i);
    if (code === 13) {
      const next = i + 1 < end && input.charCodeAt(i + 1) === 10 ? i + 2 : i + 1;
      return { contentEnd: i, nextLineStart: next };
    }
    if (code === 10) {
      return { contentEnd: i, nextLineStart: i + 1 };
    }
    i++;
  }
  return { contentEnd: end, nextLineStart: end };
}

function trimHorizontal(input: string): string {
  let s = 0;
  while (s < input.length && isHorizontalSpace(input.charCodeAt(s))) {
    s++;
  }
  let e = input.length;
  while (e > s && isHorizontalSpace(input.charCodeAt(e - 1))) {
    e--;
  }
  return input.slice(s, e);
}

function unquoteYamlValue(raw: string): string {
  let val = trimHorizontal(raw);
  let inSingle = false;
  let inDouble = false;
  for (let k = 0; k < val.length; k++) {
    const ch = val.charCodeAt(k);
    if (ch === 34 && !inSingle) {
      inDouble = !inDouble;
    } else if (ch === 39 && !inDouble) {
      inSingle = !inSingle;
    } else if (ch === 35 && !inSingle && !inDouble && (k === 0 || isHorizontalSpace(val.charCodeAt(k - 1)))) {
      val = trimHorizontal(val.slice(0, k));
      break;
    }
  }
  if (val.length >= 2) {
    const first = val.charCodeAt(0);
    const last = val.charCodeAt(val.length - 1);
    if ((first === 34 && last === 34) || (first === 39 && last === 39)) {
      return val.slice(1, -1);
    }
  }
  return val;
}

function parseYamlFrontMatter(
  source: string,
  missFence: { failedBefore: number },
): { readonly end: number; readonly metadata: FrontMatterMetadata } | null {
  if (!source.startsWith("---")) {
    return null;
  }
  const firstLine = advanceLineEnd(source, 0, source.length);
  if (trimHorizontal(source.slice(0, firstLine.contentEnd)) !== "---") {
    return null;
  }
  const limit = Math.min(source.length, YAML_FRONT_MATTER_MAX_LEN);
  if (missFence.failedBefore >= limit) {
    return null;
  }

  let cursor = firstLine.nextLineStart;
  while (cursor < limit) {
    const line = advanceLineEnd(source, cursor, source.length);
    const trimmed = trimHorizontal(source.slice(cursor, line.contentEnd));
    if (trimmed === "---" || trimmed === "...") {
      if (line.contentEnd > YAML_FRONT_MATTER_MAX_LEN) {
        return null;
      }
      const bodyStart = firstLine.nextLineStart;
      let pos = bodyStart;
      let bibliography: string | undefined;
      let lang: string | undefined;
      let math: boolean | undefined;

      while (pos < cursor) {
        const entryLine = advanceLineEnd(source, pos, cursor);
        const text = trimHorizontal(source.slice(pos, entryLine.contentEnd));
        pos = entryLine.nextLineStart;
        if (text.length === 0 || text.startsWith("#")) {
          continue;
        }
        const colon = text.indexOf(":");
        if (colon <= 0) {
          continue;
        }
        const key = trimHorizontal(text.slice(0, colon));
        const val = unquoteYamlValue(text.slice(colon + 1));
        if (key === "bibliography" && val.length > 0) {
          bibliography = val;
        } else if (key === "lang" && val.length > 0) {
          lang = val;
        } else if (key === "math") {
          const lower = asciiLower(val);
          if (lower === "true") {
            math = true;
          } else if (lower === "false") {
            math = false;
          }
        }
      }

      const meta: FrontMatterMetadata = {
        ...(bibliography !== undefined ? { bibliography } : {}),
        ...(lang !== undefined ? { lang } : {}),
        ...(math !== undefined ? { math } : {}),
      };
      return { end: line.contentEnd, metadata: meta };
    }
    if (line.nextLineStart >= limit && trimmed !== "---" && trimmed !== "...") {
      break;
    }
    cursor = line.nextLineStart;
  }
  missFence.failedBefore = limit;
  return null;
}

function findUnescapedDelimiterForward(
  source: string,
  delim: string,
  searchStart: number,
  maxEnd: number,
  missFrontier: { failedBefore: number },
): number {
  const actualStart = Math.max(searchStart, missFrontier.failedBefore);
  let pos = actualStart;
  while (pos + delim.length <= maxEnd) {
    const found = source.indexOf(delim, pos);
    if (found === -1) {
      missFrontier.failedBefore = source.length;
      return -1;
    }
    if (found + delim.length > maxEnd) {
      if (found > missFrontier.failedBefore) {
        missFrontier.failedBefore = found;
      }
      return -1;
    }
    if (countPrecedingBackslashes(source, found) % 2 === 0) {
      return found;
    }
    pos = delim === "$$" ? found + 1 : found + delim.length;
  }
  if (pos > missFrontier.failedBefore) {
    missFrontier.failedBefore = pos;
  }
  return -1;
}

function findVerbatimDelimiterForward(
  source: string,
  delim: string,
  searchStart: number,
  maxEnd: number,
  missFrontier: { failedBefore: number },
): number {
  const actualStart = Math.max(searchStart, missFrontier.failedBefore);
  if (actualStart + delim.length > maxEnd) {
    return -1;
  }
  const found = source.indexOf(delim, actualStart);
  if (found === -1) {
    missFrontier.failedBefore = source.length;
    return -1;
  }
  if (found + delim.length > maxEnd) {
    if (found > missFrontier.failedBefore) {
      missFrontier.failedBefore = found;
    }
    return -1;
  }
  return found;
}

/**
 * Precomputes O(n) balanced `\begin{envName}` -> end-after-`\end{envName}` positions
 * across `source` for nestable non-prose environments, ignoring `%` comments.
 */
function computeNestableEnvMatchMap(source: string, envName: string): ReadonlyMap<number, number> {
  const result = new Map<number, number>();
  const beginTag = `\\begin{${envName}}`;
  const endTag = `\\end{${envName}}`;
  if (source.indexOf(endTag) === -1) {
    return result;
  }

  const stack: number[] = [];
  const n = source.length;
  let cursor = 0;
  let scanPos = 0;
  let inComment = false;

  while (cursor < n) {
    const nextBegin = source.indexOf(beginTag, cursor);
    const nextEnd = source.indexOf(endTag, cursor);
    let pos = -1;
    let isBegin = false;
    if (nextBegin !== -1 && (nextEnd === -1 || nextBegin < nextEnd)) {
      pos = nextBegin;
      isBegin = true;
    } else if (nextEnd !== -1) {
      pos = nextEnd;
      isBegin = false;
    } else {
      break;
    }

    // Advance comment/escape state monotonically once across `source`
    while (scanPos < pos) {
      if (inComment) {
        const nl = source.indexOf("\n", scanPos);
        const cr = source.indexOf("\r", scanPos);
        let brk = -1;
        if (nl !== -1 && (cr === -1 || nl < cr)) {
          brk = nl;
        } else if (cr !== -1) {
          brk = cr;
        }
        if (brk === -1 || brk >= pos) {
          scanPos = pos;
          break;
        }
        inComment = false;
        scanPos = brk + 1;
        continue;
      }
      const ch = source.charCodeAt(scanPos);
      if (ch === 10 || ch === 13) {
        inComment = false;
        scanPos++;
      } else if (ch === 92) {
        if (scanPos + 1 < pos) {
          scanPos += 2;
        } else {
          break;
        }
      } else if (ch === 37) {
        inComment = true;
        scanPos++;
      } else {
        scanPos++;
      }
    }

    const escaped = scanPos === pos - 1 && source.charCodeAt(scanPos) === 92;
    if (!inComment && !escaped) {
      if (isBegin) {
        stack.push(pos);
      } else {
        const openPos = stack.pop();
        if (openPos !== undefined) {
          result.set(openPos, pos + endTag.length);
        }
      }
    }

    cursor = pos + (isBegin ? beginTag.length : endTag.length);
  }
  return result;
}

function stripLatexCommentsInSlice(slice: string): string {
  const parts: string[] = [];
  let i = 0;
  let chunkStart = 0;
  const n = slice.length;
  while (i < n) {
    const ch = slice.charCodeAt(i);
    if (ch === 92) {
      i += 2;
      continue;
    }
    if (ch === 37) {
      parts.push(slice.slice(chunkStart, i));
      while (i < n && !isLineBreakCode(slice.charCodeAt(i))) {
        i++;
      }
      chunkStart = i;
      continue;
    }
    i++;
  }
  if (chunkStart < n) {
    parts.push(slice.slice(chunkStart, n));
  }
  return parts.join("");
}

function cleanBooktabsAndRules(cellOrRow: string): string {
  const ruleNames = ["hline", "toprule", "midrule", "bottomrule", "cline", "cmidrule", "addlinespace"];
  const braceClose = buildBraceCloseMap(cellOrRow);
  const parts: string[] = [];
  let i = 0;
  const n = cellOrRow.length;

  while (i < n) {
    if (cellOrRow.charCodeAt(i) === 92) {
      let nameEnd = i + 1;
      while (nameEnd < n && isAsciiLetter(cellOrRow.charCodeAt(nameEnd))) {
        nameEnd++;
      }
      const cmd = cellOrRow.slice(i + 1, nameEnd);
      if (ruleNames.includes(cmd)) {
        let cur = nameEnd;
        if (cmd === "cmidrule" || cmd === "addlinespace") {
          while (cur < n && isHorizontalSpace(cellOrRow.charCodeAt(cur))) {
            cur++;
          }
          if (cur < n && cellOrRow.charCodeAt(cur) === 40) {
            const closeParen = cellOrRow.indexOf(")", cur + 1);
            if (closeParen !== -1 && closeParen - cur < 20) {
              cur = closeParen + 1;
            }
          }
          if (cur < n && cellOrRow.charCodeAt(cur) === 91) {
            const closeBrk = scanBracketGroup(cellOrRow, braceClose, cur, n, 100);
            if (closeBrk !== -1) {
              cur = closeBrk + 1;
            }
          }
        }
        if (cmd === "cline" || cmd === "cmidrule") {
          while (cur < n && isHorizontalSpace(cellOrRow.charCodeAt(cur))) {
            cur++;
          }
          if (cur < n && cellOrRow.charCodeAt(cur) === 123) {
            const closeBr = braceClose[cur] ?? -1;
            if (closeBr !== -1) {
              cur = closeBr + 1;
            }
          }
        }
        i = cur;
        continue;
      }
      parts.push(cellOrRow.slice(i, nameEnd > i + 1 ? nameEnd : i + 2));
      i = nameEnd > i + 1 ? nameEnd : i + 2;
      continue;
    }
    parts.push(cellOrRow.charAt(i));
    i++;
  }
  return parts.join("");
}

function splitTopLevelLatexRows(body: string): string[] {
  const cleaned = stripLatexCommentsInSlice(body);
  const rows: string[] = [];
  let rowStart = 0;
  let braceDepth = 0;
  let i = 0;
  const n = cleaned.length;

  while (i < n) {
    const ch = cleaned.charCodeAt(i);
    if (ch === 92) {
      if (braceDepth === 0 && i + 1 < n && cleaned.charCodeAt(i + 1) === 92) {
        rows.push(cleaned.slice(rowStart, i));
        let next = i + 2;
        if (next < n && cleaned.charCodeAt(next) === 42) {
          next++;
        }
        while (next < n && isHorizontalSpace(cleaned.charCodeAt(next))) {
          next++;
        }
        if (next < n && cleaned.charCodeAt(next) === 91) {
          const close = cleaned.indexOf("]", next + 1);
          if (close !== -1 && close - next <= 40) {
            next = close + 1;
          }
        }
        rowStart = next;
        i = next;
        continue;
      }
      i += 2;
      continue;
    }
    if (ch === 123) {
      braceDepth++;
    } else if (ch === 125 && braceDepth > 0) {
      braceDepth--;
    }
    i++;
  }
  if (rowStart < n) {
    rows.push(cleaned.slice(rowStart, n));
  }
  return rows;
}

function splitTopLevelLatexCells(row: string): string[] {
  const cells: string[] = [];
  let cellStart = 0;
  let braceDepth = 0;
  let i = 0;
  const n = row.length;

  while (i < n) {
    const ch = row.charCodeAt(i);
    if (ch === 92) {
      i += 2;
      continue;
    }
    if (ch === 123) {
      braceDepth++;
    } else if (ch === 125 && braceDepth > 0) {
      braceDepth--;
    } else if (ch === 38 && braceDepth === 0) {
      cells.push(row.slice(cellStart, i));
      cellStart = i + 1;
    }
    i++;
  }
  cells.push(row.slice(cellStart, n));
  return cells;
}

function expandMulticolumnCell(rawCell: string): readonly string[] {
  const trimmed = collapseAndTrimAsciiSpace(cleanBooktabsAndRules(rawCell));
  if (!trimmed.startsWith("\\multicolumn")) {
    return [trimmed];
  }
  const afterCmd = "\\multicolumn".length;
  if (afterCmd < trimmed.length && isAsciiLetter(trimmed.charCodeAt(afterCmd))) {
    return [trimmed];
  }
  const braceClose = buildBraceCloseMap(trimmed);
  const seq = scanArgumentSequence(trimmed, braceClose, afterCmd, trimmed.length);
  if (seq.braces.length < 3 || seq.brackets.length > 0) {
    return [trimmed];
  }
  const b0 = seq.braces[0];
  const b2 = seq.braces[2];
  if (b0 === undefined || b2 === undefined) {
    return [trimmed];
  }
  const kStr = collapseAndTrimAsciiSpace(trimmed.slice(b0.start + 1, b0.end - 1));
  let count = 1;
  if (kStr.length > 0 && kStr.length <= 2) {
    let validDigits = true;
    for (let j = 0; j < kStr.length; j++) {
      if (!isDigit(kStr.charCodeAt(j))) {
        validDigits = false;
        break;
      }
    }
    if (validDigits) {
      count = Math.min(64, Math.max(1, Number(kStr)));
    }
  }
  const cellText = collapseAndTrimAsciiSpace(trimmed.slice(b2.start + 1, b2.end - 1));
  const out: string[] = [];
  for (let c = 0; c < count; c++) {
    out.push(cellText);
  }
  return out;
}

function parseLatexTabularSlice(
  source: string,
  envName: string,
  envStart: number,
  tagEnd: number,
  bodyEnd: number,
  endTagLen: number,
  braceClose: Int32Array,
  section: SectionState,
): ExtractedTable {
  const baseEnv = stripTrailingStar(envName);
  let contentStart = tagEnd;

  // Skip tabular/longtable [pos]{cols}, tabular* {width}[pos]{cols}, or tabularx {width}{cols}
  const bracesToSkip = envName === "tabular*" || baseEnv === "tabularx" ? 2 : 1;
  for (let b = 0; b < bracesToSkip; b++) {
    let adj = skipAdjacentWhitespace(source, contentStart, bodyEnd);
    if (!adj.crossedBlankLine && adj.pos < bodyEnd && source.charCodeAt(adj.pos) === 91) {
      const closeBrk = scanBracketGroup(source, braceClose, adj.pos, bodyEnd, ARG_BRACKET_MAX_LEN);
      if (closeBrk !== -1) {
        contentStart = closeBrk + 1;
        adj = skipAdjacentWhitespace(source, contentStart, bodyEnd);
      }
    }
    if (!adj.crossedBlankLine && adj.pos < bodyEnd && source.charCodeAt(adj.pos) === 123) {
      const close = braceClose[adj.pos] ?? -1;
      if (close !== -1 && close < bodyEnd) {
        contentStart = close + 1;
      }
    }
  }

  const rawRows = splitTopLevelLatexRows(source.slice(contentStart, bodyEnd));
  const parsedRows: string[][] = [];
  for (const rawRow of rawRows) {
    const cells = splitTopLevelLatexCells(rawRow);
    const expandedRow: string[] = [];
    for (const cell of cells) {
      const parts = expandMulticolumnCell(cell);
      for (const part of parts) {
        expandedRow.push(part);
      }
    }
    const allEmpty = expandedRow.every((c) => c.length === 0);
    if (!allEmpty) {
      parsedRows.push(expandedRow);
    }
  }

  const headers = parsedRows[0] ?? [];
  const dataRows = parsedRows.slice(1);
  return {
    sourceKind: "latex_tabular",
    envName,
    start: envStart,
    end: bodyEnd + endTagLen,
    headers,
    rows: dataRows,
    section,
  };
}

function extractCaptionsFromLatexSlice(
  source: string,
  start: number,
  end: number,
  braceClose: Int32Array,
  section: SectionState,
  streams: ExtractedProseStream[],
): void {
  let i = start;
  while (i < end) {
    const code = source.charCodeAt(i);
    if (code === 37 && countPrecedingBackslashes(source, i) % 2 === 0) {
      while (i < end && !isLineBreakCode(source.charCodeAt(i))) {
        i++;
      }
      continue;
    }
    if (code === 92) {
      if (source.startsWith("\\caption", i)) {
        let after = i + "\\caption".length;
        if (after >= end || !isAsciiLetter(source.charCodeAt(after))) {
          if (after < end && source.charCodeAt(after) === 42) {
            after++;
          }
          const adj1 = skipAdjacentWhitespace(source, after, end);
          let cur = adj1.pos;
          if (!adj1.crossedBlankLine && cur < end && source.charCodeAt(cur) === 91) {
            const brkClose = scanBracketGroup(source, braceClose, cur, end, ARG_BRACKET_MAX_LEN);
            if (brkClose !== -1) {
              const adj2 = skipAdjacentWhitespace(source, brkClose + 1, end);
              if (!adj2.crossedBlankLine) {
                cur = adj2.pos;
              }
            }
          }
          if (cur < end && source.charCodeAt(cur) === 123) {
            const close = braceClose[cur] ?? -1;
            if (close !== -1 && close < end && close + 1 - cur <= CAPTION_MAX_LEN) {
              streams.push({
                kind: "caption",
                start: i,
                end: close + 1,
                rawText: source.slice(cur + 1, close),
                section,
              });
              i = close + 1;
              continue;
            }
          }
        }
      }
      i += 2;
      continue;
    }
    i++;
  }
}

function extractNestedTablesFromNonProseEnv(
  source: string,
  sliceStart: number,
  sliceEnd: number,
  braceClose: Int32Array,
  section: SectionState,
  envMatchCache: Map<string, ReadonlyMap<number, number>>,
  tables: ExtractedTable[],
  report: ImportQualityReport,
): void {
  let i = sliceStart;
  while (i < sliceEnd) {
    const code = source.charCodeAt(i);
    if (code === 37 && countPrecedingBackslashes(source, i) % 2 === 0) {
      while (i < sliceEnd && !isLineBreakCode(source.charCodeAt(i))) {
        i++;
      }
      continue;
    }
    if (code === 92) {
      if (source.startsWith("\\begin{", i) && countPrecedingBackslashes(source, i) % 2 === 0) {
        const closeBrace = source.indexOf("}", i + 7);
        if (closeBrace !== -1 && closeBrace < sliceEnd && closeBrace - (i + 7) <= 64) {
          const envName = source.slice(i + 7, closeBrace);
          const base = stripTrailingStar(envName);
          if (TABLE_ENVS.has(base)) {
            let map = envMatchCache.get(envName);
            if (map === undefined) {
              map = computeNestableEnvMatchMap(source, envName);
              envMatchCache.set(envName, map);
            }
            const endPos = map.get(i);
            if (endPos !== undefined && endPos <= sliceEnd && endPos - i <= NON_PROSE_ENV_MAX_LEN) {
              const endTagLen = `\\end{${envName}}`.length;
              tables.push(
                parseLatexTabularSlice(
                  source,
                  envName,
                  i,
                  closeBrace + 1,
                  endPos - endTagLen,
                  endTagLen,
                  braceClose,
                  section,
                ),
              );
              report.tablesParsed++;
              i = endPos;
              continue;
            }
          }
        }
      }
      i += 2;
      continue;
    }
    i++;
  }
}

function extractBibItemsFromLatexEnv(
  source: string,
  tagEnd: number,
  bodyEnd: number,
  braceClose: Int32Array,
  bibItems: ExtractedBibItem[],
): void {
  // Skip optional widest-label brace argument immediately after \begin{thebibliography}
  let pos = tagEnd;
  const adj = skipAdjacentWhitespace(source, pos, bodyEnd);
  if (adj.pos < bodyEnd && source.charCodeAt(adj.pos) === 123) {
    const close = braceClose[adj.pos] ?? -1;
    if (close !== -1 && close < bodyEnd) {
      pos = close + 1;
    }
  }

  const hits: { readonly itemStart: number; readonly label: string | null; readonly key: string; readonly textStart: number }[] = [];
  let i = pos;
  while (i < bodyEnd) {
    const ch = source.charCodeAt(i);
    if (ch === 37 && countPrecedingBackslashes(source, i) % 2 === 0) {
      while (i < bodyEnd && !isLineBreakCode(source.charCodeAt(i))) {
        i++;
      }
      continue;
    }
    if (ch === 92 && source.startsWith("\\bibitem", i)) {
      const afterCmd = i + "\\bibitem".length;
      if (afterCmd < bodyEnd && !isAsciiLetter(source.charCodeAt(afterCmd))) {
        let cur = skipAdjacentWhitespace(source, afterCmd, bodyEnd).pos;
        let label: string | null = null;
        if (cur < bodyEnd && source.charCodeAt(cur) === 91) {
          const closeBrk = scanBracketGroup(source, braceClose, cur, bodyEnd, ARG_BRACKET_MAX_LEN);
          if (closeBrk !== -1) {
            label = collapseAndTrimAsciiSpace(source.slice(cur + 1, closeBrk));
            cur = skipAdjacentWhitespace(source, closeBrk + 1, bodyEnd).pos;
          }
        }
        if (cur < bodyEnd && source.charCodeAt(cur) === 123) {
          const closeKey = braceClose[cur] ?? -1;
          if (closeKey !== -1 && closeKey < bodyEnd) {
            const key = trimHorizontal(source.slice(cur + 1, closeKey));
            hits.push({ itemStart: i, label, key, textStart: closeKey + 1 });
            i = closeKey + 1;
            continue;
          }
        }
      }
      i += 2;
      continue;
    }
    if (ch === 92) {
      i += 2;
      continue;
    }
    i++;
  }

  for (let h = 0; h < hits.length; h++) {
    const item = hits[h];
    if (item === undefined) {
      continue;
    }
    const nextItem = hits[h + 1];
    const itemEnd = nextItem !== undefined ? nextItem.itemStart : bodyEnd;
    const cleaned = collapseAndTrimAsciiSpace(
      stripLatexCommentsInSlice(source.slice(item.textStart, itemEnd)),
    );
    bibItems.push({
      label: item.label,
      key: item.key,
      text: cleaned,
      start: item.itemStart,
      end: itemEnd,
    });
  }
}

interface MacroParseResult {
  readonly end: number;
  readonly name: string;
  readonly body: string | null;
  readonly expandable: boolean;
  readonly isCiteEligible: boolean;
}

function tryParseNewcommandMacro(
  source: string,
  cmdEnd: number,
  braceClose: Int32Array,
): MacroParseResult | null {
  const n = source.length;
  let cur = cmdEnd;
  if (cur < n && source.charCodeAt(cur) === 42) {
    cur++;
  }
  cur = skipAdjacentWhitespace(source, cur, n).pos;
  if (cur >= n) {
    return null;
  }

  let macroName = "";
  if (source.charCodeAt(cur) === 123) {
    const close = braceClose[cur] ?? -1;
    if (close === -1) {
      return null;
    }
    const inner = trimHorizontal(source.slice(cur + 1, close));
    if (inner.length < 2 || inner.charCodeAt(0) !== 92) {
      return null;
    }
    for (let j = 1; j < inner.length; j++) {
      if (!isAsciiLetter(inner.charCodeAt(j))) {
        return null;
      }
    }
    macroName = inner.slice(1);
    cur = close + 1;
  } else if (source.charCodeAt(cur) === 92) {
    let nameEnd = cur + 1;
    while (nameEnd < n && isAsciiLetter(source.charCodeAt(nameEnd))) {
      nameEnd++;
    }
    if (nameEnd === cur + 1) {
      return null;
    }
    macroName = source.slice(cur + 1, nameEnd);
    cur = nameEnd;
  } else {
    return null;
  }

  let paramCount = 0;
  let adj = skipAdjacentWhitespace(source, cur, n);
  cur = adj.pos;
  if (!adj.crossedBlankLine && cur < n && source.charCodeAt(cur) === 91) {
    const closeArgCount = scanBracketGroup(source, braceClose, cur, n, 10);
    if (closeArgCount === -1) {
      return null;
    }
    const digitText = trimHorizontal(source.slice(cur + 1, closeArgCount));
    if (digitText.length !== 1 || digitText.charCodeAt(0) < 49 || digitText.charCodeAt(0) > 57) {
      return null;
    }
    paramCount = digitText.charCodeAt(0) - 48;
    cur = closeArgCount + 1;

    adj = skipAdjacentWhitespace(source, cur, n);
    cur = adj.pos;
    if (!adj.crossedBlankLine && cur < n && source.charCodeAt(cur) === 91) {
      const closeDef = scanBracketGroup(source, braceClose, cur, n, ARG_BRACKET_MAX_LEN);
      if (closeDef === -1) {
        return null;
      }
      cur = closeDef + 1;
      adj = skipAdjacentWhitespace(source, cur, n);
      cur = adj.pos;
    }
  }

  if (adj.crossedBlankLine || cur >= n || source.charCodeAt(cur) !== 123) {
    return null;
  }
  const bodyClose = braceClose[cur] ?? -1;
  if (bodyClose === -1 || bodyClose + 1 - cur > MACRO_BODY_MAX_LEN) {
    return null;
  }
  const body = source.slice(cur + 1, bodyClose);
  const expandable =
    paramCount === 0 && body.length <= USER_MACRO_MAX_BODY_LEN && !body.includes("#");

  return {
    end: bodyClose + 1,
    name: macroName,
    body,
    expandable,
    isCiteEligible: containsCiteAsciiCaseInsensitive(macroName),
  };
}

function tryParseDefMacro(
  source: string,
  cmdEnd: number,
  braceClose: Int32Array,
): MacroParseResult | null {
  const n = source.length;
  const cur0 = skipAdjacentWhitespace(source, cmdEnd, n).pos;
  if (cur0 >= n || source.charCodeAt(cur0) !== 92) {
    return null;
  }
  let nameEnd = cur0 + 1;
  while (nameEnd < n && isAsciiLetter(source.charCodeAt(nameEnd))) {
    nameEnd++;
  }
  if (nameEnd === cur0 + 1) {
    return null;
  }
  const macroName = source.slice(cur0 + 1, nameEnd);

  const stop = Math.min(n, nameEnd + MACRO_PARAM_MAX_LEN);
  let braceOpen = -1;
  let k = nameEnd;
  while (k < stop) {
    const ch = source.charCodeAt(k);
    if (ch === 123) {
      braceOpen = k;
      break;
    }
    if (ch === 125 || isLineBreakCode(ch)) {
      return null;
    }
    k++;
  }
  if (braceOpen === -1) {
    return null;
  }
  const paramText = trimHorizontal(source.slice(nameEnd, braceOpen));
  const bodyClose = braceClose[braceOpen] ?? -1;
  if (bodyClose === -1 || bodyClose + 1 - braceOpen > MACRO_BODY_MAX_LEN) {
    return null;
  }
  const body = source.slice(braceOpen + 1, bodyClose);
  const expandable =
    paramText.length === 0 && body.length <= USER_MACRO_MAX_BODY_LEN && !body.includes("#");

  return {
    end: bodyClose + 1,
    name: macroName,
    body,
    expandable,
    isCiteEligible: containsCiteAsciiCaseInsensitive(macroName),
  };
}

function tryParseLetMacro(source: string, cmdEnd: number): {
  readonly end: number;
  readonly name: string;
  readonly targetName: string | null;
} | null {
  const n = source.length;
  let cur = cmdEnd;
  while (cur < n && isHorizontalSpace(source.charCodeAt(cur))) {
    cur++;
  }
  if (cur >= n || source.charCodeAt(cur) !== 92) {
    return null;
  }
  let nameEnd = cur + 1;
  while (nameEnd < n && isAsciiLetter(source.charCodeAt(nameEnd))) {
    nameEnd++;
  }
  if (nameEnd === cur + 1) {
    return null;
  }
  const name = source.slice(cur + 1, nameEnd);
  cur = nameEnd;
  while (cur < n && isHorizontalSpace(source.charCodeAt(cur))) {
    cur++;
  }
  if (cur < n && source.charCodeAt(cur) === 61) {
    cur++;
    while (cur < n && isHorizontalSpace(source.charCodeAt(cur))) {
      cur++;
    }
  }
  if (cur >= n) {
    return null;
  }
  if (source.charCodeAt(cur) === 92) {
    let tEnd = cur + 1;
    while (tEnd < n && isAsciiLetter(source.charCodeAt(tEnd))) {
      tEnd++;
    }
    if (tEnd === cur + 1) {
      return tEnd < n ? { end: tEnd + 1, name, targetName: null } : null;
    }
    return { end: tEnd, name, targetName: source.slice(cur + 1, tEnd) };
  }
  return { end: cur + 1, name, targetName: null };
}

function tryParseDeclareCiteCommand(
  source: string,
  cmdEnd: number,
  braceClose: Int32Array,
): { readonly end: number; readonly name: string } | null {
  const n = source.length;
  let cur = cmdEnd;
  if (cur < n && source.charCodeAt(cur) === 42) {
    cur++;
  }
  cur = skipAdjacentWhitespace(source, cur, n).pos;
  if (cur >= n) {
    return null;
  }
  let macroName = "";
  if (source.charCodeAt(cur) === 123) {
    const close = braceClose[cur] ?? -1;
    if (close === -1) {
      return null;
    }
    const inner = trimHorizontal(source.slice(cur + 1, close));
    if (inner.length < 2 || inner.charCodeAt(0) !== 92) {
      return null;
    }
    for (let j = 1; j < inner.length; j++) {
      if (!isAsciiLetter(inner.charCodeAt(j))) {
        return null;
      }
    }
    macroName = inner.slice(1);
    cur = close + 1;
  } else if (source.charCodeAt(cur) === 92) {
    let nameEnd = cur + 1;
    while (nameEnd < n && isAsciiLetter(source.charCodeAt(nameEnd))) {
      nameEnd++;
    }
    if (nameEnd === cur + 1) {
      return null;
    }
    macroName = source.slice(cur + 1, nameEnd);
    cur = nameEnd;
  } else {
    return null;
  }

  let endPos = cur;
  for (let round = 0; round < 6; round++) {
    const adj = skipAdjacentWhitespace(source, endPos, n);
    if (adj.crossedBlankLine || adj.pos >= n) {
      break;
    }
    const ch = source.charCodeAt(adj.pos);
    if (ch === 91) {
      const brk = scanBracketGroup(source, braceClose, adj.pos, n, ARG_BRACKET_MAX_LEN);
      if (brk === -1) {
        break;
      }
      endPos = brk + 1;
    } else if (ch === 123) {
      const close = braceClose[adj.pos] ?? -1;
      if (close === -1 || close + 1 - adj.pos > MACRO_BODY_MAX_LEN) {
        break;
      }
      endPos = close + 1;
    } else {
      break;
    }
  }
  return { end: endPos, name: macroName };
}

function parseMdTableBlock(
  source: string,
  startPos: number,
  section: SectionState,
): { readonly end: number; readonly table: ExtractedTable } | null {
  const n = source.length;
  let pos = startPos;
  const rawLines: string[] = [];
  let blockEnd = startPos;

  while (pos < n) {
    const line = advanceLineEnd(source, pos, n);
    const trimmed = trimHorizontal(source.slice(pos, line.contentEnd));
    if (trimmed.length >= 2 && trimmed.startsWith("|") && trimmed.endsWith("|")) {
      rawLines.push(trimmed);
      blockEnd = line.contentEnd;
      pos = line.nextLineStart;
    } else {
      break;
    }
  }

  if (rawLines.length === 0) {
    return null;
  }

  const isSeparatorLine = (line: string): boolean => {
    let sawDash = false;
    for (let k = 0; k < line.length; k++) {
      const ch = line.charCodeAt(k);
      if (ch === 45) {
        sawDash = true;
      } else if (ch !== 124 && ch !== 58 && !isHorizontalSpace(ch)) {
        return false;
      }
    }
    return sawDash;
  };

  const splitPipeCells = (line: string): string[] => {
    const cells: string[] = [];
    let cellStart = 1;
    const end = line.length - 1;
    let k = 1;
    while (k < end) {
      const ch = line.charCodeAt(k);
      if (ch === 92) {
        k += 2;
        continue;
      }
      if (ch === 124) {
        cells.push(collapseAndTrimAsciiSpace(line.slice(cellStart, k)));
        cellStart = k + 1;
      }
      k++;
    }
    cells.push(collapseAndTrimAsciiSpace(line.slice(cellStart, end)));
    return cells;
  };

  const parsedRows: string[][] = [];
  for (const line of rawLines) {
    if (!isSeparatorLine(line)) {
      parsedRows.push(splitPipeCells(line));
    }
  }

  const headers = parsedRows[0] ?? [];
  const dataRows = parsedRows.slice(1);
  return {
    end: blockEnd,
    table: {
      sourceKind: "md_table",
      start: startPos,
      end: blockEnd,
      headers,
      rows: dataRows,
      section,
    },
  };
}

interface FenceCloseEntry {
  readonly lineStart: number;
  readonly contentEnd: number;
  readonly runLen: number;
}

interface FenceCloseTree {
  readonly entries: readonly FenceCloseEntry[];
  readonly maxTree: Int32Array;
}

interface MdFenceCloseIndex {
  readonly backtick: FenceCloseTree;
  readonly tilde: FenceCloseTree;
}

function buildFenceCloseTree(entries: readonly FenceCloseEntry[]): FenceCloseTree {
  if (entries.length === 0) {
    return { entries, maxTree: new Int32Array(0) };
  }
  const tree = new Int32Array(entries.length * 4);
  const build = (node: number, l: number, r: number): void => {
    if (l === r) {
      tree[node] = entries[l]?.runLen ?? 0;
      return;
    }
    const mid = (l + r) >> 1;
    build(node * 2, l, mid);
    build(node * 2 + 1, mid + 1, r);
    const leftVal = tree[node * 2] ?? 0;
    const rightVal = tree[node * 2 + 1] ?? 0;
    tree[node] = leftVal >= rightVal ? leftVal : rightVal;
  };
  build(1, 0, entries.length - 1);
  return { entries, maxTree: tree };
}

function buildMdFenceIndex(source: string): MdFenceCloseIndex {
  const backticks: FenceCloseEntry[] = [];
  const tildes: FenceCloseEntry[] = [];
  const n = source.length;
  let cursor = 0;

  while (cursor < n) {
    const line = advanceLineEnd(source, cursor, n);
    let sp = 0;
    while (sp < 3 && cursor + sp < line.contentEnd && source.charCodeAt(cursor + sp) === 32) {
      sp++;
    }
    const start = cursor + sp;
    if (start < line.contentEnd) {
      const ch = source.charCodeAt(start);
      if (ch === 96 || ch === 126) {
        let runLen = 0;
        while (start + runLen < line.contentEnd && source.charCodeAt(start + runLen) === ch) {
          runLen++;
        }
        if (runLen >= 3) {
          let onlySpaceAfter = true;
          for (let k = start + runLen; k < line.contentEnd; k++) {
            if (!isHorizontalSpace(source.charCodeAt(k))) {
              onlySpaceAfter = false;
              break;
            }
          }
          if (onlySpaceAfter) {
            const entry = { lineStart: cursor, contentEnd: line.contentEnd, runLen };
            if (ch === 96) {
              backticks.push(entry);
            } else {
              tildes.push(entry);
            }
          }
        }
      }
    }
    cursor = line.nextLineStart;
  }

  return {
    backtick: buildFenceCloseTree(backticks),
    tilde: buildFenceCloseTree(tildes),
  };
}

function findFirstFenceCloseIndex(
  tree: FenceCloseTree,
  minLineStart: number,
  minLen: number,
): number {
  const entries = tree.entries;
  const m = entries.length;
  if (m === 0) {
    return -1;
  }
  let lo = 0;
  let hi = m;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const entry = entries[mid];
    if (entry !== undefined && entry.lineStart < minLineStart) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  if (lo >= m) {
    return -1;
  }

  const maxTree = tree.maxTree;
  const search = (node: number, l: number, r: number): number => {
    if (r < lo || (maxTree[node] ?? 0) < minLen) {
      return -1;
    }
    if (l === r) {
      return l;
    }
    const mid = (l + r) >> 1;
    const leftHit = search(node * 2, l, mid);
    if (leftHit !== -1) {
      return leftHit;
    }
    return search(node * 2 + 1, mid + 1, r);
  };
  return search(1, 0, m - 1);
}

function tryMatchMdFence(
  source: string,
  lineStart: number,
  getFenceIndex: () => MdFenceCloseIndex,
): number {
  const n = source.length;
  let spaces = 0;
  while (spaces < 3 && lineStart + spaces < n && source.charCodeAt(lineStart + spaces) === 32) {
    spaces++;
  }
  const fenceStart = lineStart + spaces;
  if (fenceStart + 2 >= n) {
    return -1;
  }
  const fenceChar = source.charCodeAt(fenceStart);
  if (fenceChar !== 96 && fenceChar !== 126) {
    return -1;
  }
  let fenceLen = 0;
  while (fenceStart + fenceLen < n && source.charCodeAt(fenceStart + fenceLen) === fenceChar) {
    fenceLen++;
  }
  if (fenceLen < 3) {
    return -1;
  }
  const openLine = advanceLineEnd(source, fenceStart + fenceLen, n);
  if (fenceChar === 96) {
    for (let k = fenceStart + fenceLen; k < openLine.contentEnd; k++) {
      if (source.charCodeAt(k) === 96) {
        return -1;
      }
    }
  }

  const index = getFenceIndex();
  const tree = fenceChar === 96 ? index.backtick : index.tilde;
  const hitIdx = findFirstFenceCloseIndex(tree, openLine.nextLineStart, fenceLen);
  if (hitIdx === -1) {
    return -1;
  }
  const hitEntry = tree.entries[hitIdx];
  if (hitEntry !== undefined && hitEntry.contentEnd - lineStart <= FENCED_CODE_MAX_LEN) {
    return hitEntry.contentEnd;
  }
  return -1;
}

/**
 * Comment-aware and verbatim-aware brace matcher (`O(n)`) for raw LaTeX sources:
 * ignores `{`/`}` inside unescaped `%` comments and closed `RAW_NON_PROSE_ENVS` blocks.
 */
function buildLatexBraceCloseMap(source: string): Int32Array {
  const n = source.length;
  const closeMap = new Int32Array(n);
  closeMap.fill(-1);
  const stack: number[] = [];
  const localRawEnvMissMap = new Map<string, { failedBefore: number }>();

  const getMiss = (endTag: string): { failedBefore: number } => {
    let entry = localRawEnvMissMap.get(endTag);
    if (entry === undefined) {
      entry = { failedBefore: 0 };
      localRawEnvMissMap.set(endTag, entry);
    }
    return entry;
  };

  let i = 0;
  while (i < n) {
    const ch = source.charCodeAt(i);
    if (ch === 37) {
      while (i < n && !isLineBreakCode(source.charCodeAt(i))) {
        i++;
      }
      continue;
    }
    if (ch === 92) {
      if (source.startsWith("\\begin{", i)) {
        const closeBrace = source.indexOf("}", i + 7);
        if (closeBrace !== -1 && closeBrace - (i + 7) <= 64) {
          const envName = source.slice(i + 7, closeBrace);
          const baseEnv = stripTrailingStar(envName);
          if (RAW_NON_PROSE_ENVS.has(baseEnv)) {
            const endTag = `\\end{${envName}}`;
            const limit = Math.min(n, i + NON_PROSE_ENV_MAX_LEN);
            const closeIdx = findVerbatimDelimiterForward(
              source,
              endTag,
              closeBrace + 1,
              limit,
              getMiss(endTag),
            );
            if (closeIdx !== -1) {
              i = closeIdx + endTag.length;
              continue;
            }
            i = closeBrace + 1;
            continue;
          }
        }
      }
      i += 2;
      continue;
    }
    if (ch === 123) {
      stack.push(i);
    } else if (ch === 125) {
      const openIdx = stack.pop();
      if (openIdx !== undefined) {
        closeMap[openIdx] = i;
      }
    }
    i++;
  }
  return closeMap;
}

/**
 * Formats and applies format-scoped pre-masking (`02` §3.1).
 * Overwrites masked spans with `U+E000` preserving exact UTF-16 length.
 */
export function preMask(
  source: string,
  format: SourceFormat,
  options?: PreMaskOptions,
): PreMaskResult {
  const n = source.length;
  const out = new Array<string>(n);
  for (let k = 0; k < n; k++) {
    out[k] = source.charAt(k);
  }

  const report = options?.report ?? createEmptyImportQualityReport();
  const tracker = new SectionTracker();
  const regions: MaskedRegion[] = [];
  const blockRegions: MaskedSpan[] = [];
  const mathRegions: MathRegionRecord[] = [];
  const proseStreams: ExtractedProseStream[] = [];
  const tables: ExtractedTable[] = [];
  const bibItems: ExtractedBibItem[] = [];
  const sectionTransitions: SectionTransition[] = [];
  const listItemStarts: number[] = [];
  const userMacros = new Map<string, string>();
  const customCiteMacros = new Set<string>();
  let frontMatter: FrontMatterMetadata = {};

  const maskSpan = (kind: MaskedRegionKind, start: number, end: number, isBlockBoundary: boolean): void => {
    for (let k = start; k < end; k++) {
      out[k] = MASK_CHAR;
    }
    regions.push({ kind, start, end, isBlockBoundary });
    if (isBlockBoundary) {
      blockRegions.push({ start, end });
    }
  };

  const envMatchCache = new Map<string, ReadonlyMap<number, number>>();
  const rawEnvMissMap = new Map<string, { failedBefore: number }>();
  const getRawEnvMiss = (endTag: string): { failedBefore: number } => {
    let entry = rawEnvMissMap.get(endTag);
    if (entry === undefined) {
      entry = { failedBefore: 0 };
      rawEnvMissMap.set(endTag, entry);
    }
    return entry;
  };
  const braceClose =
    format === "latex"
      ? buildLatexBraceCloseMap(source)
      : buildBraceCloseMap(source);
  const missDoubleBracket = { failedBefore: 0 };
  const missDoubleDollar = { failedBefore: 0 };
  const missInlineParen = { failedBefore: 0 };
  const missHtmlComment = { failedBefore: 0 };
  const missYaml = { failedBefore: 0 };
  let mdFenceIndexCache: MdFenceCloseIndex | null = null;
  const getMdFenceIndex = (): MdFenceCloseIndex => {
    if (mdFenceIndexCache === null) {
      mdFenceIndexCache = buildMdFenceIndex(source);
    }
    return mdFenceIndexCache;
  };

  let frontMatterMath = options?.frontMatterMath === true;
  let i = 0;
  let atLineStart = true;

  while (i < n) {
    const ch = source.charCodeAt(i);

    if (ch === 10 || ch === 13) {
      atLineStart = true;
      i++;
      continue;
    }

    if (format === "md") {
      // 1. YAML front matter at byte 0
      if (i === 0 && atLineStart) {
        const yaml = parseYamlFrontMatter(source, missYaml);
        if (yaml !== null) {
          frontMatter = yaml.metadata;
          if (yaml.metadata.math === true) {
            frontMatterMath = true;
          } else if (yaml.metadata.math === false) {
            frontMatterMath = false;
          }
          maskSpan("yaml_front_matter", 0, yaml.end, true);
          i = yaml.end;
          atLineStart = false;
          continue;
        }
      }

      if (atLineStart) {
        // 2. Markdown fenced code
        const fenceEnd = tryMatchMdFence(source, i, getMdFenceIndex);
        if (fenceEnd !== -1) {
          maskSpan("fenced_code", i, fenceEnd, true);
          i = fenceEnd;
          atLineStart = false;
          continue;
        }

        // 3. Markdown heading (`#` x 1..6 + space)
        let sp = 0;
        while (sp < 3 && i + sp < n && source.charCodeAt(i + sp) === 32) {
          sp++;
        }
        let hashCount = 0;
        while (hashCount < 7 && i + sp + hashCount < n && source.charCodeAt(i + sp + hashCount) === 35) {
          hashCount++;
        }
        if (
          hashCount >= 1 &&
          hashCount <= 6 &&
          i + sp + hashCount < n &&
          (source.charCodeAt(i + sp + hashCount) === 32 || source.charCodeAt(i + sp + hashCount) === 9)
        ) {
          const line = advanceLineEnd(source, i, n);
          const headingRaw = source.slice(i + sp + hashCount + 1, line.contentEnd);
          const state = tracker.pushHeading(hashCount, headingRaw);
          sectionTransitions.push({ offset: i, bodyStart: line.nextLineStart, state });
          maskSpan("md_heading", i, line.contentEnd, true);
          i = line.contentEnd;
          atLineStart = false;
          continue;
        }

        // 4. Markdown pipe tables
        let firstNonHoriz = i;
        while (firstNonHoriz < n && isHorizontalSpace(source.charCodeAt(firstNonHoriz))) {
          firstNonHoriz++;
        }
        if (firstNonHoriz < n && source.charCodeAt(firstNonHoriz) === 124) {
          const mdTable = parseMdTableBlock(source, i, tracker.current);
          if (mdTable !== null) {
            tables.push(mdTable.table);
            report.tablesParsed++;
            maskSpan("md_table", i, mdTable.end, true);
            i = mdTable.end;
            atLineStart = false;
            continue;
          }
        }
      }

      atLineStart = false;

      // 5. HTML comment
      if (ch === 60 && source.startsWith("<!--", i)) {
        const limit = Math.min(n, i + HTML_COMMENT_MAX_LEN);
        const close = findVerbatimDelimiterForward(source, "-->", i + 4, limit, missHtmlComment);
        if (close !== -1) {
          maskSpan("html_comment", i, close + 3, false);
          i = close + 3;
          continue;
        }
        i += 4;
        continue;
      }

      // 6. Inline code (`...` on single line, ≤ 400 chars)
      if (ch === 96) {
        let tickLen = 1;
        while (i + tickLen < n && source.charCodeAt(i + tickLen) === 96) {
          tickLen++;
        }
        const limit = Math.min(n, i + INLINE_CODE_MAX_LEN);
        let j = i + tickLen;
        let matchEnd = -1;
        while (j + tickLen <= limit) {
          const cj = source.charCodeAt(j);
          if (isLineBreakCode(cj)) {
            break;
          }
          if (cj === 96) {
            let run = 1;
            while (j + run < limit && source.charCodeAt(j + run) === 96) {
              run++;
            }
            if (run === tickLen) {
              matchEnd = j + run;
              break;
            }
            j += run;
            continue;
          }
          j++;
        }
        if (matchEnd !== -1) {
          maskSpan("inline_code", i, matchEnd, false);
          i = matchEnd;
          continue;
        }
        i += tickLen;
        continue;
      }

      // 7. Display math in Markdown (only when front matter has `math: true`)
      if (ch === 92 && frontMatterMath && source.startsWith("\\[", i)) {
        const limit = Math.min(n, i + DISPLAY_MATH_MAX_LEN);
        const close = findUnescapedDelimiterForward(source, "\\]", i + 2, limit, missDoubleBracket);
        if (close !== -1) {
          const end = close + 2;
          const raw = source.slice(i, end);
          const ownLine = isOnOwnLine(source, i, end);
          maskSpan("display_math", i, end, ownLine);
          mathRegions.push({ kind: "display", start: i, end, raw, text: mathText(raw) });
          report.mathRegions.display++;
          i = end;
          continue;
        }
      }

      if (ch === 92 && source.startsWith("\\begin{", i) && frontMatterMath) {
        const closeBrace = source.indexOf("}", i + 7);
        if (closeBrace !== -1 && closeBrace - (i + 7) <= 64) {
          const envName = source.slice(i + 7, closeBrace);
          const base = stripTrailingStar(envName);
          if (DISPLAY_MATH_ENVS.has(base)) {
            const limit = Math.min(n, i + DISPLAY_MATH_MAX_LEN);
            const endTag = `\\end{${envName}}`;
            const closeIdx = findVerbatimDelimiterForward(
              source,
              endTag,
              closeBrace + 1,
              limit,
              getRawEnvMiss(endTag),
            );
            if (closeIdx !== -1) {
              const end = closeIdx + endTag.length;
              const raw = source.slice(i, end);
              const ownLine = isOnOwnLine(source, i, end);
              maskSpan("display_math", i, end, ownLine);
              mathRegions.push({ kind: "display", start: i, end, raw, text: mathText(raw) });
              report.mathRegions.display++;
              i = end;
              continue;
            }
          }
        }
      }

      // 8. Escaped backslash / escaped dollar in Markdown
      if (ch === 92) {
        if (i + 1 < n && (source.charCodeAt(i + 1) === 92 || source.charCodeAt(i + 1) === 36)) {
          i += 2;
          continue;
        }
        i++;
        continue;
      }

      // 9. Double-dollar display math (`$$...$$`) in Markdown
      if (ch === 36 && i + 1 < n && source.charCodeAt(i + 1) === 36) {
        if (frontMatterMath) {
          const limit = Math.min(n, i + DISPLAY_MATH_MAX_LEN);
          const close = findUnescapedDelimiterForward(source, "$$", i + 2, limit, missDoubleDollar);
          if (close !== -1) {
            const end = close + 2;
            const raw = source.slice(i, end);
            const ownLine = isOnOwnLine(source, i, end);
            maskSpan("display_math", i, end, ownLine);
            mathRegions.push({ kind: "display", start: i, end, raw, text: mathText(raw) });
            report.mathRegions.display++;
            i = end;
            continue;
          }
        }
        i += 2;
        continue;
      }

      // 10. Pandoc inline math (`$...$`, same line ≤ 400 chars)
      if (ch === 36 && i + 1 < n && !isSpace(source.charCodeAt(i + 1)) && source.charCodeAt(i + 1) !== 36) {
        const limit = Math.min(n, i + INLINE_MATH_MAX_LEN);
        let j = i + 1;
        let matchEnd = -1;
        while (j < limit) {
          const cj = source.charCodeAt(j);
          if (isLineBreakCode(cj)) {
            break;
          }
          if (cj === 92) {
            if (j + 1 >= n || isLineBreakCode(source.charCodeAt(j + 1))) {
              break;
            }
            j += 2;
            continue;
          }
          if (cj === 36) {
            const precededByNonSpace = !isSpace(source.charCodeAt(j - 1));
            const notDoubleDollar = j + 1 >= n || source.charCodeAt(j + 1) !== 36;
            const notFollowedByDigit = j + 1 >= n || !isDigit(source.charCodeAt(j + 1));
            if (precededByNonSpace && notDoubleDollar && notFollowedByDigit) {
              matchEnd = j + 1;
            }
            break;
          }
          j++;
        }
        if (matchEnd !== -1) {
          const raw = source.slice(i, matchEnd);
          maskSpan("inline_math", i, matchEnd, false);
          mathRegions.push({ kind: "inline", start: i, end: matchEnd, raw, text: mathText(raw) });
          report.mathRegions.inline++;
          i = matchEnd;
          continue;
        }
      }

      i++;
      continue;
    }

    // ==================== LaTeX Scope ====================
    atLineStart = false;

    // 1. LaTeX `%` comment (even preceding backslashes, already guaranteed by `\\` pair skipping)
    if (ch === 37) {
      let end = i + 1;
      while (end < n && !isLineBreakCode(source.charCodeAt(end))) {
        end++;
      }
      maskSpan("latex_comment", i, end, false);
      i = end;
      continue;
    }

    // 2. Display math `$$...$$`
    if (ch === 36 && i + 1 < n && source.charCodeAt(i + 1) === 36) {
      const limit = Math.min(n, i + DISPLAY_MATH_MAX_LEN);
      const close = findUnescapedDelimiterForward(source, "$$", i + 2, limit, missDoubleDollar);
      if (close !== -1) {
        const end = close + 2;
        const raw = source.slice(i, end);
        const ownLine = isOnOwnLine(source, i, end);
        maskSpan("display_math", i, end, ownLine);
        mathRegions.push({ kind: "display", start: i, end, raw, text: mathText(raw) });
        report.mathRegions.display++;
        i = end;
        continue;
      }
      i += 2;
      continue;
    }

    // 3. Inline math `$...$` on same line ≤ 400 chars
    if (ch === 36) {
      const limit = Math.min(n, i + INLINE_MATH_MAX_LEN);
      let j = i + 1;
      let matchEnd = -1;
      while (j < limit) {
        const cj = source.charCodeAt(j);
        if (isLineBreakCode(cj)) {
          break;
        }
        if (cj === 92) {
          if (j + 1 >= n || isLineBreakCode(source.charCodeAt(j + 1))) {
            break;
          }
          j += 2;
          continue;
        }
        if (cj === 36) {
          if (j + 1 >= n || source.charCodeAt(j + 1) !== 36) {
            matchEnd = j + 1;
          }
          break;
        }
        j++;
      }
      if (matchEnd !== -1) {
        const raw = source.slice(i, matchEnd);
        maskSpan("inline_math", i, matchEnd, false);
        mathRegions.push({ kind: "inline", start: i, end: matchEnd, raw, text: mathText(raw) });
        report.mathRegions.inline++;
        i = matchEnd;
        continue;
      }
      i++;
      continue;
    }

    // 4. Backslash commands, math brackets, environments, structural commands, macros
    if (ch === 92) {
      if (i + 1 >= n) {
        i++;
        continue;
      }
      const next = source.charCodeAt(i + 1);

      // 4a. Display math `\[...\]` (≤ 20,000 chars)
      if (next === 91) {
        const limit = Math.min(n, i + DISPLAY_MATH_MAX_LEN);
        const close = findUnescapedDelimiterForward(source, "\\]", i + 2, limit, missDoubleBracket);
        if (close !== -1) {
          const end = close + 2;
          const raw = source.slice(i, end);
          const ownLine = isOnOwnLine(source, i, end);
          maskSpan("display_math", i, end, ownLine);
          mathRegions.push({ kind: "display", start: i, end, raw, text: mathText(raw) });
          report.mathRegions.display++;
          i = end;
          continue;
        }
        i += 2;
        continue;
      }

      // 4b. Inline math `\(...\)` (≤ 400 chars)
      if (next === 40) {
        const limit = Math.min(n, i + INLINE_MATH_MAX_LEN);
        const close = findUnescapedDelimiterForward(source, "\\)", i + 2, limit, missInlineParen);
        if (close !== -1) {
          const end = close + 2;
          const raw = source.slice(i, end);
          maskSpan("inline_math", i, end, false);
          mathRegions.push({ kind: "inline", start: i, end, raw, text: mathText(raw) });
          report.mathRegions.inline++;
          i = end;
          continue;
        }
        i += 2;
        continue;
      }

      // 4c. Non-letter control symbol (`\\`, `\$`, `\%`, `\{`, `\}`, etc.): skip 2
      if (!isAsciiLetter(next)) {
        i += 2;
        continue;
      }

      // 4d. ASCII-letter command `\cmd`
      let cmdEnd = i + 2;
      while (cmdEnd < n && isAsciiLetter(source.charCodeAt(cmdEnd))) {
        cmdEnd++;
      }
      const cmd = source.slice(i + 1, cmdEnd);

      // \begin{env}
      if (cmd === "begin" && cmdEnd < n && source.charCodeAt(cmdEnd) === 123) {
        const closeBrace = source.indexOf("}", cmdEnd + 1);
        if (closeBrace !== -1 && closeBrace - (cmdEnd + 1) <= 64) {
          const envName = source.slice(cmdEnd + 1, closeBrace);
          const baseEnv = stripTrailingStar(envName);
          const tagEnd = closeBrace + 1;

          // Display math env
          if (DISPLAY_MATH_ENVS.has(baseEnv)) {
            const limit = Math.min(n, i + DISPLAY_MATH_MAX_LEN);
            const endTag = `\\end{${envName}}`;
            const closeIdx = findVerbatimDelimiterForward(
              source,
              endTag,
              tagEnd,
              limit,
              getRawEnvMiss(endTag),
            );
            if (closeIdx !== -1) {
              const end = closeIdx + endTag.length;
              const raw = source.slice(i, end);
              const ownLine = isOnOwnLine(source, i, end);
              maskSpan("display_math", i, end, ownLine);
              mathRegions.push({ kind: "display", start: i, end, raw, text: mathText(raw) });
              report.mathRegions.display++;
              i = end;
              continue;
            }
            i = tagEnd;
            continue;
          }

          // Abstract env tag
          if (baseEnv === "abstract") {
            const state = tracker.enterAbstract();
            sectionTransitions.push({ offset: i, bodyStart: tagEnd, state });
            maskSpan("abstract_tag", i, tagEnd, true);
            i = tagEnd;
            continue;
          }

          // Non-prose environments
          if (NON_PROSE_ENVS.has(baseEnv)) {
            const endTag = `\\end{${envName}}`;
            let envEnd = -1;
            if (RAW_NON_PROSE_ENVS.has(baseEnv)) {
              const limit = Math.min(n, i + NON_PROSE_ENV_MAX_LEN);
              const closeIdx = findVerbatimDelimiterForward(
                source,
                endTag,
                tagEnd,
                limit,
                getRawEnvMiss(endTag),
              );
              if (closeIdx !== -1) {
                envEnd = closeIdx + endTag.length;
              }
            } else {
              let matchMap = envMatchCache.get(envName);
              if (matchMap === undefined) {
                matchMap = computeNestableEnvMatchMap(source, envName);
                envMatchCache.set(envName, matchMap);
              }
              const candidate = matchMap.get(i);
              if (candidate !== undefined && candidate - i <= NON_PROSE_ENV_MAX_LEN) {
                envEnd = candidate;
              }
            }

            if (envEnd !== -1) {
              const bodyEnd = envEnd - endTag.length;
              if (!RAW_NON_PROSE_ENVS.has(baseEnv)) {
                extractCaptionsFromLatexSlice(
                  source,
                  tagEnd,
                  bodyEnd,
                  braceClose,
                  tracker.current,
                  proseStreams,
                );
                if (TABLE_ENVS.has(baseEnv)) {
                  tables.push(
                    parseLatexTabularSlice(
                      source,
                      envName,
                      i,
                      tagEnd,
                      bodyEnd,
                      endTag.length,
                      braceClose,
                      tracker.current,
                    ),
                  );
                  report.tablesParsed++;
                } else {
                  extractNestedTablesFromNonProseEnv(
                    source,
                    tagEnd,
                    bodyEnd,
                    braceClose,
                    tracker.current,
                    envMatchCache,
                    tables,
                    report,
                  );
                }
                if (baseEnv === "thebibliography") {
                  extractBibItemsFromLatexEnv(source, tagEnd, bodyEnd, braceClose, bibItems);
                }
              }
              maskSpan("non_prose_env", i, envEnd, true);
              i = envEnd;
              continue;
            }
            i = tagEnd;
            continue;
          }

          // Other environments: mask tag only, track unknownEnvironments, keep prose body
          if (!KNOWN_PROSE_ENVS.has(baseEnv)) {
            recordDistinct(report.unknownEnvironments, baseEnv);
          }
          maskSpan("env_tag", i, tagEnd, isOnOwnLine(source, i, tagEnd));
          i = tagEnd;
          continue;
        }
      }

      // \end{env}
      if (cmd === "end" && cmdEnd < n && source.charCodeAt(cmdEnd) === 123) {
        const closeBrace = source.indexOf("}", cmdEnd + 1);
        if (closeBrace !== -1 && closeBrace - (cmdEnd + 1) <= 64) {
          const envName = source.slice(cmdEnd + 1, closeBrace);
          const baseEnv = stripTrailingStar(envName);
          const tagEnd = closeBrace + 1;
          if (baseEnv === "abstract") {
            const state = tracker.exitAbstract();
            sectionTransitions.push({ offset: i, bodyStart: tagEnd, state });
            maskSpan("abstract_tag", i, tagEnd, true);
            i = tagEnd;
            continue;
          }
          if (!NON_PROSE_ENVS.has(baseEnv) && !DISPLAY_MATH_ENVS.has(baseEnv)) {
            maskSpan("env_tag", i, tagEnd, isOnOwnLine(source, i, tagEnd));
            i = tagEnd;
            continue;
          }
        }
      }

      // Section headings
      if (SECTION_COMMANDS.has(cmd)) {
        let cur = cmdEnd;
        if (cur < n && source.charCodeAt(cur) === 42) {
          cur++;
        }
        const adj1 = skipAdjacentWhitespace(source, cur, n);
        if (!adj1.crossedBlankLine) {
          cur = adj1.pos;
          if (cur < n && source.charCodeAt(cur) === 91) {
            const closeBrk = scanBracketGroup(source, braceClose, cur, n, SECTION_TITLE_MAX_LEN);
            if (closeBrk !== -1) {
              const adj2 = skipAdjacentWhitespace(source, closeBrk + 1, n);
              cur = adj2.crossedBlankLine ? -1 : adj2.pos;
            }
          }
          if (cur >= 0 && cur < n && source.charCodeAt(cur) === 123) {
            const close = braceClose[cur] ?? -1;
            if (close !== -1 && close + 1 - cur <= SECTION_TITLE_MAX_LEN) {
              const end = close + 1;
              const rawHeading = source.slice(cur + 1, close);
              const state = tracker.pushHeading(
                LATEX_SECTION_LEVELS[cmd as LatexSectionCommand],
                rawHeading,
              );
              sectionTransitions.push({ offset: i, bodyStart: end, state });
              maskSpan("section_heading", i, end, true);
              i = end;
              continue;
            }
          }
        }
      }

      // Footnotes (`\footnote`, `\footnotetext`)
      if (FOOTNOTE_COMMANDS.has(cmd)) {
        let cur = cmdEnd;
        if (cur < n && source.charCodeAt(cur) === 42) {
          cur++;
        }
        const adj1 = skipAdjacentWhitespace(source, cur, n);
        if (!adj1.crossedBlankLine) {
          cur = adj1.pos;
          if (cur < n && source.charCodeAt(cur) === 91) {
            const closeBrk = scanBracketGroup(source, braceClose, cur, n, ARG_BRACKET_MAX_LEN);
            if (closeBrk !== -1) {
              const adj2 = skipAdjacentWhitespace(source, closeBrk + 1, n);
              cur = adj2.crossedBlankLine ? -1 : adj2.pos;
            }
          }
          if (cur >= 0 && cur < n && source.charCodeAt(cur) === 123) {
            const close = braceClose[cur] ?? -1;
            if (close !== -1 && close + 1 - cur <= FOOTNOTE_MAX_LEN) {
              const end = close + 1;
              proseStreams.push({
                kind: "footnote",
                start: i,
                end,
                rawText: source.slice(cur + 1, close),
                section: tracker.current,
              });
              report.footnotes++;
              maskSpan("footnote", i, end, false);
              i = end;
              continue;
            }
          }
        }
      }

      // Structural commands
      if (STRUCTURAL_COMMANDS.has(cmd)) {
        let cur = cmdEnd;
        if (cur < n && source.charCodeAt(cur) === 42) {
          cur++;
        }
        const args = scanArgumentSequence(source, braceClose, cur, n);
        maskSpan("structural_command", i, args.end, false);
        i = args.end;
        continue;
      }

      // Macro definitions
      if (cmd === "newcommand" || cmd === "renewcommand" || cmd === "providecommand") {
        const parsed = tryParseNewcommandMacro(source, cmdEnd, braceClose);
        if (parsed !== null) {
          if (parsed.isCiteEligible) {
            customCiteMacros.add(parsed.name);
          }
          if (parsed.expandable && parsed.body !== null) {
            if (userMacros.has(parsed.name) || userMacros.size < USER_MACRO_MAX_COUNT) {
              userMacros.set(parsed.name, parsed.body);
            } else {
              recordDistinct(report.macrosNotExpanded, parsed.name);
            }
          } else {
            recordDistinct(report.macrosNotExpanded, parsed.name);
          }
          maskSpan("macro_def", i, parsed.end, false);
          i = parsed.end;
          continue;
        }
      }

      if (cmd === "def") {
        const parsed = tryParseDefMacro(source, cmdEnd, braceClose);
        if (parsed !== null) {
          if (parsed.isCiteEligible) {
            customCiteMacros.add(parsed.name);
          }
          if (parsed.expandable && parsed.body !== null) {
            if (userMacros.has(parsed.name) || userMacros.size < USER_MACRO_MAX_COUNT) {
              userMacros.set(parsed.name, parsed.body);
            } else {
              recordDistinct(report.macrosNotExpanded, parsed.name);
            }
          } else {
            recordDistinct(report.macrosNotExpanded, parsed.name);
          }
          maskSpan("macro_def", i, parsed.end, false);
          i = parsed.end;
          continue;
        }
      }

      if (cmd === "let") {
        const parsed = tryParseLetMacro(source, cmdEnd);
        if (parsed !== null) {
          if (containsCiteAsciiCaseInsensitive(parsed.name)) {
            customCiteMacros.add(parsed.name);
          }
          if (parsed.targetName !== null) {
            const aliasedBody = userMacros.get(parsed.targetName);
            if (aliasedBody !== undefined) {
              if (userMacros.has(parsed.name) || userMacros.size < USER_MACRO_MAX_COUNT) {
                userMacros.set(parsed.name, aliasedBody);
              } else {
                recordDistinct(report.macrosNotExpanded, parsed.name);
              }
            }
          }
          maskSpan("macro_def", i, parsed.end, false);
          i = parsed.end;
          continue;
        }
      }

      if (cmd === "DeclareCiteCommand") {
        const parsed = tryParseDeclareCiteCommand(source, cmdEnd, braceClose);
        if (parsed !== null) {
          if (containsCiteAsciiCaseInsensitive(parsed.name)) {
            customCiteMacros.add(parsed.name);
          }
          maskSpan("macro_def", i, parsed.end, false);
          i = parsed.end;
          continue;
        }
      }

      // \item
      if (cmd === "item") {
        let end = cmdEnd;
        const adj = skipAdjacentWhitespace(source, cmdEnd, n);
        if (!adj.crossedBlankLine && adj.pos < n && source.charCodeAt(adj.pos) === 91) {
          const closeBrk = scanBracketGroup(source, braceClose, adj.pos, n, ARG_BRACKET_MAX_LEN);
          if (closeBrk !== -1) {
            end = closeBrk + 1;
          }
        }
        listItemStarts.push(i);
        maskSpan("list_item", i, end, true);
        i = end;
        continue;
      }

      i = cmdEnd;
      continue;
    }

    i++;
  }

  return {
    format,
    maskedText: out.join(""),
    regions,
    blockRegions,
    mathRegions,
    proseStreams,
    tables,
    bibItems,
    sectionTransitions,
    listItemStarts,
    userMacros,
    customCiteMacros,
    frontMatter,
    report,
  };
}
