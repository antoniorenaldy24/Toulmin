/**
 * Normalization-time LaTeX substitutions and `normSentence` / `sentenceHash`
 * (`docs/spec/02_L0_TIER_A_PRE_DECODE.md` §3.2–§3.3, `01` §3.1).
 *
 * Pure TypeScript using character-code scanners and UTF-16 offset maps:
 * zero regular expressions, zero `.toLowerCase()`, zero `.normalize()`.
 */

import { buildBraceCloseMap, collapseAndTrimAsciiSpace, mathText } from "./math.js";
import {
  FOOTNOTE_COMMANDS,
  MACRO_DEF_COMMANDS,
  MASK_CHAR,
  SECTION_COMMANDS,
  STRUCTURAL_COMMANDS,
  isAsciiLetter,
  preMask,
  scanArgumentSequence,
  scanBracketGroup,
  skipAdjacentWhitespace,
  type SourceFormat,
} from "./mask.js";
import { isSpace, normLower, sha256hex } from "./norm.js";
import type { ImportQualityReport } from "./sections.js";

export const CITE_COMMANDS: ReadonlySet<string> = new Set([
  "cite",
  "Cite",
  "citep",
  "Citep",
  "citet",
  "Citet",
  "citealp",
  "Citealp",
  "citealt",
  "Citealt",
  "citenum",
  "parencite",
  "Parencite",
  "textcite",
  "Textcite",
  "autocite",
  "Autocite",
  "footcite",
  "smartcite",
  "supercite",
  "citeauthor",
  "Citeauthor",
  "citeyear",
  "cites",
  "parencites",
  "textcites",
  "autocites",
  "footcites",
]);

export const NARRATIVE_CITE_COMMANDS: ReadonlySet<string> = new Set([
  "citet",
  "Citet",
  "textcite",
  "Textcite",
  "textcites",
  "citeauthor",
  "Citeauthor",
]);

const FORMATTING_UNWRAP_COMMANDS: ReadonlySet<string> = new Set([
  "emph",
  "textit",
  "textbf",
  "textrm",
  "textsc",
  "mathrm",
  "mathit",
  "mathbf",
  "text",
  "textsf",
  "underline",
  "hl",
]);

const COLOR_UNWRAP_COMMANDS: ReadonlySet<string> = new Set([
  "textcolor",
  "colorbox",
]);

const DRAFT_DELETE_COMMANDS: ReadonlySet<string> = new Set([
  "todo",
  "note",
  "fixme",
  "marginpar",
]);

const SI_UNIT_MACROS: ReadonlyMap<string, string> = new Map([
  ["milli", "m"],
  ["micro", "\u03BC"],
  ["nano", "n"],
  ["kilo", "k"],
  ["gram", "g"],
  ["litre", "L"],
  ["liter", "L"],
  ["metre", "m"],
  ["meter", "m"],
  ["mole", "mol"],
  ["second", "s"],
  ["minute", "min"],
  ["hour", "h"],
  ["day", "d"],
  ["percent", "%"],
  ["per", "/"],
  ["squared", "^2"],
  ["cubed", "^3"],
]);

const KNOWN_SPACE_COMMANDS: ReadonlySet<string> = new Set([
  "quad",
  "qquad",
]);

const SKIPPED_SECTION_OR_META_COMMANDS: ReadonlySet<string> = new Set([
  "begin",
  "end",
  "item",
]);

const MAX_SUBSTITUTION_DEPTH = 3;

export interface TextRangeLike {
  readonly start: number;
  readonly end: number;
}

export interface LatexSubstitutionsOptions {
  readonly userMacros?: ReadonlyMap<string, string>;
  readonly customCiteMacros?: ReadonlySet<string>;
  readonly report?: ImportQualityReport;
}

export interface LatexSubstitutionsResult {
  readonly text: string;
  readonly map: number[];
  readonly unregisteredCommands: readonly string[];
}

function lowerBoundProtectedEnd(spans: readonly TextRangeLike[], pos: number): number {
  let lo = 0;
  let hi = spans.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (spans[mid]!.end <= pos) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}

function buildBraceCloseMapSkippingProtected(
  input: string,
  protectedSpans: readonly TextRangeLike[],
): Int32Array {
  if (protectedSpans.length === 0) {
    return buildBraceCloseMap(input);
  }
  const n = input.length;
  const closeMap = new Int32Array(n);
  closeMap.fill(-1);
  const stack: number[] = [];
  let protIdx = 0;
  let i = 0;

  while (i < n) {
    const prot = protectedSpans[protIdx];
    if (prot !== undefined && i >= prot.start) {
      if (i < prot.end) {
        i = prot.end;
      }
      protIdx++;
      continue;
    }
    const ch = input.charCodeAt(i);
    if (ch === 92) {
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

interface OutBuffer {
  readonly chars: string[];
  readonly map: number[] | null;
}

function pushOutChar(buf: OutBuffer, ch: string, orig: number): void {
  buf.chars.push(ch);
  if (buf.map !== null) {
    buf.map.push(orig);
  }
}

function pushMappedPieces(
  buf: OutBuffer,
  pieces: readonly { readonly ch: string; readonly orig: number }[],
): void {
  if (buf.map === null) {
    for (const piece of pieces) {
      buf.chars.push(piece.ch);
    }
    return;
  }
  for (const piece of pieces) {
    buf.chars.push(piece.ch);
    buf.map.push(piece.orig);
  }
}

function recordDistinctCmd(list: string[], report: ImportQualityReport | undefined, name: string): void {
  if (!list.includes(name)) {
    list.push(name);
  }
  if (report !== undefined && !report.unregisteredCommands.includes(name)) {
    report.unregisteredCommands.push(name);
  }
}

function recordDistinctMacroOverflow(report: ImportQualityReport | undefined, name: string): void {
  if (report !== undefined && !report.macrosNotExpanded.includes(name)) {
    report.macrosNotExpanded.push(name);
  }
}

/**
 * Translates an siunitx unit group body `input.slice(start, end)` using the 18 unit
 * macros of `02` §3.2, preserving exact source UTF-16 offsets (or fixed origin).
 */
function translateSiUnitWithOffsets(
  input: string,
  start: number,
  end: number,
  fixedOrigin: number | null,
): readonly { readonly ch: string; readonly orig: number }[] {
  const pieces: { readonly ch: string; readonly orig: number }[] = [];
  let i = start;

  while (i < end) {
    const ch = input.charCodeAt(i);
    if (ch === 92) {
      if (i + 1 >= end) {
        i++;
        continue;
      }
      const next = input.charCodeAt(i + 1);
      if (isAsciiLetter(next)) {
        let nameEnd = i + 2;
        while (nameEnd < end && isAsciiLetter(input.charCodeAt(nameEnd))) {
          nameEnd++;
        }
        const unitCmd = input.slice(i + 1, nameEnd);
        const mapped = SI_UNIT_MACROS.get(unitCmd);
        const orig = fixedOrigin ?? i;
        if (mapped !== undefined) {
          for (let k = 0; k < mapped.length; k++) {
            pieces.push({ ch: mapped.charAt(k), orig });
          }
        }
        // TeX swallows horizontal spaces following an alphabetic control word inside unit groups
        let after = nameEnd;
        while (after < end && (input.charCodeAt(after) === 32 || input.charCodeAt(after) === 9)) {
          after++;
        }
        i = after;
        continue;
      }
      if (next === 37) {
        pieces.push({ ch: "%", orig: fixedOrigin ?? i });
      }
      i += 2;
      continue;
    }
    if (ch === 123 || ch === 125) {
      i++;
      continue;
    }
    if (isSpace(ch)) {
      if (pieces.length > 0 && pieces[pieces.length - 1]?.ch !== " ") {
        pieces.push({ ch: " ", orig: fixedOrigin ?? i });
      }
      i++;
      continue;
    }
    pieces.push({ ch: input.charAt(i), orig: fixedOrigin ?? i });
    i++;
  }

  // Trim leading/trailing ASCII space
  let left = 0;
  while (left < pieces.length && pieces[left]?.ch === " ") {
    left++;
  }
  let right = pieces.length;
  while (right > left && pieces[right - 1]?.ch === " ") {
    right--;
  }
  return pieces.slice(left, right);
}

/**
 * Extracts mhchem `\ce{X}` content keeping `->` intact, converting `\text{...}`/`\,`,
 * and deleting unescaped braces `{`/`}` while preserving monotonic offsets.
 */
function translateCeBodyWithOffsets(
  input: string,
  start: number,
  end: number,
  fixedOrigin: number | null,
): readonly { readonly ch: string; readonly orig: number }[] {
  const pieces: { readonly ch: string; readonly orig: number }[] = [];
  let i = start;
  while (i < end) {
    const ch = input.charCodeAt(i);
    if (ch === 92 && i + 1 < end) {
      const next = input.charCodeAt(i + 1);
      if (next === 123 || next === 125 || next === 37 || next === 36 || next === 38 || next === 35 || next === 95) {
        pieces.push({ ch: input.charAt(i + 1), orig: fixedOrigin ?? i });
        i += 2;
        continue;
      }
      if (next === 44 || next === 59 || next === 58 || next === 32) {
        pieces.push({ ch: " ", orig: fixedOrigin ?? i });
        i += 2;
        continue;
      }
      if (next === 33) {
        i += 2;
        continue;
      }
      if (isAsciiLetter(next)) {
        let nameEnd = i + 2;
        while (nameEnd < end && isAsciiLetter(input.charCodeAt(nameEnd))) {
          nameEnd++;
        }
        i = nameEnd;
        continue;
      }
      i += 2;
      continue;
    }
    if (ch === 123 || ch === 125) {
      i++;
      continue;
    }
    pieces.push({ ch: input.charAt(i), orig: fixedOrigin ?? i });
    i++;
  }
  return pieces;
}

function isSimpleOneArgBracedMacro(
  input: string,
  braceClose: Int32Array,
  cmdEnd: number,
  end: number,
): { readonly innerStart: number; readonly innerEnd: number; readonly after: number } | null {
  const adj = skipAdjacentWhitespace(input, cmdEnd, end);
  if (adj.crossedBlankLine || adj.pos >= end || input.charCodeAt(adj.pos) !== 123) {
    return null;
  }
  const close = braceClose[adj.pos] ?? -1;
  if (close === -1 || close >= end) {
    return null;
  }
  return { innerStart: adj.pos + 1, innerEnd: close, after: close + 1 };
}

function scanOptBracketAndRequiredBraces(
  input: string,
  braceClose: Int32Array,
  cmdEnd: number,
  end: number,
  requiredBraces: number,
): { readonly braces: readonly { readonly open: number; readonly close: number }[]; readonly after: number } | null {
  let cur = cmdEnd;
  if (cur < end && input.charCodeAt(cur) === 42) {
    cur++;
  }
  let adj = skipAdjacentWhitespace(input, cur, end);
  if (adj.crossedBlankLine) {
    return null;
  }
  cur = adj.pos;
  if (cur < end && input.charCodeAt(cur) === 91) {
    const closeBrk = scanBracketGroup(input, braceClose, cur, end, 200);
    if (closeBrk !== -1) {
      adj = skipAdjacentWhitespace(input, closeBrk + 1, end);
      if (adj.crossedBlankLine) {
        return null;
      }
      cur = adj.pos;
    }
  }
  const braces: { readonly open: number; readonly close: number }[] = [];
  for (let b = 0; b < requiredBraces; b++) {
    if (b > 0) {
      adj = skipAdjacentWhitespace(input, cur, end);
      if (adj.crossedBlankLine) {
        return null;
      }
      cur = adj.pos;
    }
    if (cur >= end || input.charCodeAt(cur) !== 123) {
      return null;
    }
    const close = braceClose[cur] ?? -1;
    if (close === -1 || close >= end) {
      return null;
    }
    braces.push({ open: cur, close });
    cur = close + 1;
  }
  return { braces, after: cur };
}

function substituteSlice(
  input: string,
  braceClose: Int32Array,
  start: number,
  end: number,
  macroDepth: number,
  unregDepth: number,
  fixedOrigin: number | null,
  options: LatexSubstitutionsOptions | undefined,
  protectedSpans: readonly TextRangeLike[] | undefined,
  unregList: string[],
  out: OutBuffer,
): void {
  const userMacros = options?.userMacros;
  const customCiteMacros = options?.customCiteMacros;
  const report = options?.report;
  const activeProtected = fixedOrigin === null ? protectedSpans : undefined;
  let protIdx =
    activeProtected !== undefined && activeProtected.length > 0
      ? lowerBoundProtectedEnd(activeProtected, start)
      : 0;
  let i = start;

  while (i < end) {
    let nextProt: TextRangeLike | undefined;
    if (activeProtected !== undefined) {
      while (protIdx < activeProtected.length && activeProtected[protIdx]!.end <= i) {
        protIdx++;
      }
      nextProt = activeProtected[protIdx];
      if (nextProt !== undefined && i >= nextProt.start) {
        const stop = Math.min(end, nextProt.end);
        if (out.map === null) {
          out.chars.push(input.slice(i, stop));
        } else {
          for (let k = i; k < stop; k++) {
            out.chars.push(input.charAt(k));
            out.map.push(k);
          }
        }
        i = stop;
        continue;
      }
    }

    const ch = input.charCodeAt(i);
    const originHere = fixedOrigin ?? i;

    // 1. Tie space `~` -> one space
    if (ch === 126) {
      pushOutChar(out, " ", originHere);
      i++;
      continue;
    }

    // 2. Em-dash `---` and En-dash `--` -> `-`
    if (ch === 45) {
      if (i + 2 < end && input.charCodeAt(i + 1) === 45 && input.charCodeAt(i + 2) === 45) {
        pushOutChar(out, "-", originHere);
        i += 3;
        continue;
      }
      if (i + 1 < end && input.charCodeAt(i + 1) === 45) {
        pushOutChar(out, "-", originHere);
        i += 2;
        continue;
      }
    }

    // 3. `` (two backticks) -> "
    if (ch === 96 && i + 1 < end && input.charCodeAt(i + 1) === 96) {
      pushOutChar(out, '"', originHere);
      i += 2;
      continue;
    }

    // 4. '' (two apostrophes) -> "
    if (ch === 39 && i + 1 < end && input.charCodeAt(i + 1) === 39) {
      pushOutChar(out, '"', originHere);
      i += 2;
      continue;
    }

    // 5. Backslash escapes & macros
    if (ch === 92) {
      if (i + 1 >= end) {
        pushOutChar(out, "\\", originHere);
        i++;
        continue;
      }
      const next = input.charCodeAt(i + 1);

      // Single-char escapes `\%`, `\$`, `\&`, `\#`, `\_`
      if (next === 37 || next === 36 || next === 38 || next === 35 || next === 95) {
        pushOutChar(out, input.charAt(i + 1), originHere);
        i += 2;
        continue;
      }

      // Spacing symbols `\,`, `\;`, `\:`, `\ ` -> one space
      if (next === 44 || next === 59 || next === 58 || next === 32) {
        pushOutChar(out, " ", originHere);
        i += 2;
        continue;
      }

      // Thin negative space `\!` -> nothing
      if (next === 33) {
        i += 2;
        continue;
      }

      // Other non-letter control symbol (`\\`, `\{`, `\}`, etc.) -> emit verbatim pair
      if (!isAsciiLetter(next)) {
        pushOutChar(out, "\\", originHere);
        pushOutChar(out, input.charAt(i + 1), fixedOrigin ?? i + 1);
        i += 2;
        continue;
      }

      // ASCII-letter command `\cmd`
      let cmdEnd = i + 2;
      while (cmdEnd < end && isAsciiLetter(input.charCodeAt(cmdEnd))) {
        cmdEnd++;
      }
      const cmd = input.slice(i + 1, cmdEnd);

      // Cite commands or §3.1 commands left untouched
      if (
        CITE_COMMANDS.has(cmd) ||
        customCiteMacros?.has(cmd) ||
        STRUCTURAL_COMMANDS.has(cmd) ||
        SECTION_COMMANDS.has(cmd) ||
        FOOTNOTE_COMMANDS.has(cmd) ||
        MACRO_DEF_COMMANDS.has(cmd) ||
        SKIPPED_SECTION_OR_META_COMMANDS.has(cmd)
      ) {
        if (out.map === null) {
          out.chars.push(input.slice(i, cmdEnd));
        } else {
          for (let k = i; k < cmdEnd; k++) {
            out.chars.push(input.charAt(k));
            out.map.push(fixedOrigin ?? k);
          }
        }
        i = cmdEnd;
        continue;
      }

      // Spacing words `\quad`, `\qquad` -> one space
      if (KNOWN_SPACE_COMMANDS.has(cmd)) {
        pushOutChar(out, " ", originHere);
        i = cmdEnd;
        continue;
      }

      // Formatting unwrap `\emph{X}`, ...
      if (FORMATTING_UNWRAP_COMMANDS.has(cmd)) {
        const arg = isSimpleOneArgBracedMacro(input, braceClose, cmdEnd, end);
        if (arg !== null) {
          substituteSlice(
            input,
            braceClose,
            arg.innerStart,
            arg.innerEnd,
            macroDepth,
            unregDepth,
            fixedOrigin,
            options,
            activeProtected,
            unregList,
            out,
          );
          i = arg.after;
          continue;
        }
        i = cmdEnd;
        continue;
      }

      // Color unwrap `\textcolor{c}{X}`, `\colorbox{c}{X}` -> X
      if (COLOR_UNWRAP_COMMANDS.has(cmd)) {
        const parsed = scanOptBracketAndRequiredBraces(input, braceClose, cmdEnd, end, 2);
        const target = parsed?.braces[1];
        if (parsed !== null && target !== undefined) {
          substituteSlice(
            input,
            braceClose,
            target.open + 1,
            target.close,
            macroDepth,
            unregDepth,
            fixedOrigin,
            options,
            activeProtected,
            unregList,
            out,
          );
          i = parsed.after;
          continue;
        }
        const parsedColorOnly = scanOptBracketAndRequiredBraces(input, braceClose, cmdEnd, end, 1);
        i = parsedColorOnly !== null ? parsedColorOnly.after : cmdEnd;
        continue;
      }

      // `\textsuperscript{X}` -> `^X`, `\textsubscript{X}` -> `_X`
      if (cmd === "textsuperscript" || cmd === "textsubscript") {
        const arg = isSimpleOneArgBracedMacro(input, braceClose, cmdEnd, end);
        if (arg !== null) {
          pushOutChar(out, cmd === "textsuperscript" ? "^" : "_", originHere);
          substituteSlice(
            input,
            braceClose,
            arg.innerStart,
            arg.innerEnd,
            macroDepth,
            unregDepth,
            fixedOrigin,
            options,
            activeProtected,
            unregList,
            out,
          );
          i = arg.after;
          continue;
        }
        i = cmdEnd;
        continue;
      }

      // mhchem `\ce{X}` -> X with `->` kept and braces deleted
      if (cmd === "ce") {
        const arg = isSimpleOneArgBracedMacro(input, braceClose, cmdEnd, end);
        if (arg !== null) {
          const pieces = translateCeBodyWithOffsets(
            input,
            arg.innerStart,
            arg.innerEnd,
            fixedOrigin,
          );
          pushMappedPieces(out, pieces);
          i = arg.after;
          continue;
        }
        i = cmdEnd;
        continue;
      }

      // Draft annotations `\todo[...]{X}`, `\note{X}`, `\fixme{X}`, `\marginpar{X}` -> nothing
      if (DRAFT_DELETE_COMMANDS.has(cmd)) {
        const seq = scanArgumentSequence(input, braceClose, cmdEnd, end);
        if (seq.braces.length > 0 || seq.brackets.length > 0) {
          i = seq.end;
          continue;
        }
        // Zero-arg draft command also deleted
        i = cmdEnd;
        continue;
      }

      // siunitx `\SI{v}{u}`, `\qty{v}{u}` -> `v u'`
      if (cmd === "SI" || cmd === "qty") {
        const parsed = scanOptBracketAndRequiredBraces(input, braceClose, cmdEnd, end, 2);
        const valArg = parsed?.braces[0];
        const unitArg = parsed?.braces[1];
        if (parsed !== null && valArg !== undefined && unitArg !== undefined) {
          substituteSlice(
            input,
            braceClose,
            valArg.open + 1,
            valArg.close,
            macroDepth,
            unregDepth,
            fixedOrigin,
            options,
            activeProtected,
            unregList,
            out,
          );
          const unitPieces = translateSiUnitWithOffsets(
            input,
            unitArg.open + 1,
            unitArg.close,
            fixedOrigin,
          );
          if (unitPieces.length > 0) {
            pushOutChar(out, " ", fixedOrigin ?? unitArg.open);
            pushMappedPieces(out, unitPieces);
          }
          i = parsed.after;
          continue;
        }
        const parsedValOnly = scanOptBracketAndRequiredBraces(input, braceClose, cmdEnd, end, 1);
        const partialVal = parsedValOnly?.braces[0];
        if (parsedValOnly !== null && partialVal !== undefined) {
          substituteSlice(
            input,
            braceClose,
            partialVal.open + 1,
            partialVal.close,
            macroDepth,
            unregDepth,
            fixedOrigin,
            options,
            activeProtected,
            unregList,
            out,
          );
          i = parsedValOnly.after;
          continue;
        }
        i = cmdEnd;
        continue;
      }

      // siunitx `\num{v}` -> `v`
      if (cmd === "num") {
        const parsed = scanOptBracketAndRequiredBraces(input, braceClose, cmdEnd, end, 1);
        const valArg = parsed?.braces[0];
        if (parsed !== null && valArg !== undefined) {
          for (let k = valArg.open + 1; k < valArg.close; k++) {
            const c = input.charCodeAt(k);
            if (c !== 123 && c !== 125) {
              pushOutChar(out, input.charAt(k), fixedOrigin ?? k);
            }
          }
          i = parsed.after;
          continue;
        }
        i = cmdEnd;
        continue;
      }

      // siunitx `\SIrange{a}{b}{u}`, `\qtyrange{a}{b}{u}` -> `a-b u'`
      if (cmd === "SIrange" || cmd === "qtyrange") {
        const parsed = scanOptBracketAndRequiredBraces(input, braceClose, cmdEnd, end, 3);
        const aArg = parsed?.braces[0];
        const bArg = parsed?.braces[1];
        const uArg = parsed?.braces[2];
        if (parsed !== null && aArg !== undefined && bArg !== undefined && uArg !== undefined) {
          substituteSlice(
            input,
            braceClose,
            aArg.open + 1,
            aArg.close,
            macroDepth,
            unregDepth,
            fixedOrigin,
            options,
            activeProtected,
            unregList,
            out,
          );
          pushOutChar(out, "-", fixedOrigin ?? aArg.close);
          substituteSlice(
            input,
            braceClose,
            bArg.open + 1,
            bArg.close,
            macroDepth,
            unregDepth,
            fixedOrigin,
            options,
            activeProtected,
            unregList,
            out,
          );
          const unitPieces = translateSiUnitWithOffsets(
            input,
            uArg.open + 1,
            uArg.close,
            fixedOrigin,
          );
          if (unitPieces.length > 0) {
            pushOutChar(out, " ", fixedOrigin ?? uArg.open);
            pushMappedPieces(out, unitPieces);
          }
          i = parsed.after;
          continue;
        }
        i = cmdEnd;
        continue;
      }

      // Argument-free user macros (depth <= 3)
      const macroBody = userMacros?.get(cmd);
      if (macroBody !== undefined) {
        if (macroDepth < MAX_SUBSTITUTION_DEPTH) {
          const macroBraceClose = buildBraceCloseMap(macroBody);
          substituteSlice(
            macroBody,
            macroBraceClose,
            0,
            macroBody.length,
            macroDepth + 1,
            unregDepth,
            originHere,
            options,
            undefined,
            unregList,
            out,
          );
        } else {
          recordDistinctMacroOverflow(report, cmd);
        }
        i = cmdEnd;
        continue;
      }

      // Unregistered commands (`\N`, optional `*` before args, arg sequence -> last `{...}` depth <= 3, or 0-arg deleted)
      recordDistinctCmd(unregList, report, cmd);
      let afterName = cmdEnd;
      if (afterName < end && input.charCodeAt(afterName) === 42) {
        const starAdj = skipAdjacentWhitespace(input, afterName + 1, end);
        const chAfterStar = starAdj.pos < end ? input.charCodeAt(starAdj.pos) : -1;
        if (!starAdj.crossedBlankLine && (chAfterStar === 91 || chAfterStar === 123)) {
          afterName++;
        }
      }
      const seq = scanArgumentSequence(input, braceClose, afterName, end);
      const lastBrace = seq.braces.length > 0 ? seq.braces[seq.braces.length - 1] : undefined;
      if (lastBrace !== undefined) {
        if (unregDepth < MAX_SUBSTITUTION_DEPTH) {
          substituteSlice(
            input,
            braceClose,
            lastBrace.start + 1,
            lastBrace.end - 1,
            macroDepth,
            unregDepth + 1,
            fixedOrigin,
            options,
            activeProtected,
            unregList,
            out,
          );
        } else {
          if (out.map === null) {
            out.chars.push(input.slice(lastBrace.start + 1, lastBrace.end - 1));
          } else {
            for (let k = lastBrace.start + 1; k < lastBrace.end - 1; k++) {
              out.chars.push(input.charAt(k));
              out.map.push(fixedOrigin ?? k);
            }
          }
        }
        i = seq.end;
        continue;
      }
      i = cmdEnd;
      continue;
    }

    // Ordinary character
    if (out.map === null) {
      let runLimit = end;
      if (nextProt !== undefined && nextProt.start < runLimit) {
        runLimit = nextProt.start;
      }
      let runEnd = i + 1;
      while (runEnd < runLimit) {
        const c = input.charCodeAt(runEnd);
        if (c === 126 || c === 45 || c === 96 || c === 39 || c === 92) {
          break;
        }
        runEnd++;
      }
      out.chars.push(input.slice(i, runEnd));
      i = runEnd;
      continue;
    }

    out.chars.push(input.charAt(i));
    out.map.push(originHere);
    i++;
  }
}

function applyLatexSubstitutionsWithProtected(
  input: string,
  options: LatexSubstitutionsOptions | undefined,
  protectedSpans: readonly TextRangeLike[],
  collectMap: boolean = true,
): LatexSubstitutionsResult {
  const braceClose = buildBraceCloseMapSkippingProtected(input, protectedSpans);
  const out: OutBuffer = { chars: [], map: collectMap ? [] : null };
  const unregList: string[] = [];

  substituteSlice(
    input,
    braceClose,
    0,
    input.length,
    0,
    0,
    null,
    options,
    protectedSpans,
    unregList,
    out,
  );
  if (out.map !== null) {
    out.map.push(input.length);
  }

  return {
    text: out.chars.join(""),
    map: out.map ?? [],
    unregisteredCommands: unregList,
  };
}

/**
 * Applies single-pass normalization-time LaTeX substitutions (`02` §3.2),
 * returning substituted text, exact UTF-16 offset map, and distinct unregistered command names.
 */
export function applyLatexSubstitutions(
  input: string,
  options?: LatexSubstitutionsOptions,
): LatexSubstitutionsResult {
  return applyLatexSubstitutionsWithProtected(input, options, []);
}

export interface MathSpanInput extends TextRangeLike {
  readonly text?: string;
}

export interface NormSentenceOptions {
  readonly format?: SourceFormat;
  readonly frontMatterMath?: boolean;
  readonly markerRanges?: readonly TextRangeLike[];
  readonly mathRegions?: readonly MathSpanInput[];
  readonly maskedRegions?: readonly TextRangeLike[];
  readonly userMacros?: ReadonlyMap<string, string>;
  readonly customCiteMacros?: ReadonlySet<string>;
}

interface ReplacementSegment {
  readonly start: number;
  readonly end: number;
  readonly kind: "cite" | "math" | "masked";
  readonly replacement: string;
}

function appendRawProseWithoutMasks(
  slice: string,
  parts: string[],
  currentLength: number,
): number {
  let len = currentLength;
  let segStart = 0;
  while (segStart < slice.length) {
    const maskIdx = slice.indexOf(MASK_CHAR, segStart);
    if (maskIdx === -1) {
      parts.push(segStart === 0 ? slice : slice.slice(segStart));
      len += slice.length - segStart;
      break;
    }
    if (maskIdx > segStart) {
      parts.push(slice.slice(segStart, maskIdx));
      len += maskIdx - segStart;
    }
    segStart = maskIdx + 1;
  }
  return len;
}

/**
 * Computes canonical normalized sentence representation (`02` §3.3, `01` §3.1):
 * replaces math regions with `mathText`, citation marker ranges with `⟦c⟧`,
 * deletes other masked regions / `U+E000`, applies LaTeX §3.2 substitutions across
 * the assembled prose (protecting verbatim math/citation tokens), applies `normLower()`,
 * collapses whitespace to one `U+0020`, and trims.
 */
export function normSentence(s: string, options?: NormSentenceOptions): string {
  const format: SourceFormat = options?.format ?? "latex";

  let mathSpans: readonly MathSpanInput[];
  let maskedSpans: readonly TextRangeLike[];
  let effectiveUserMacros = options?.userMacros;
  let effectiveCustomCiteMacros = options?.customCiteMacros;

  if (options?.mathRegions !== undefined || options?.maskedRegions !== undefined) {
    mathSpans = options.mathRegions ?? [];
    maskedSpans = options.maskedRegions ?? [];
  } else {
    const maskRes = preMask(
      s,
      format,
      options?.frontMatterMath !== undefined
        ? { frontMatterMath: options.frontMatterMath }
        : undefined,
    );
    mathSpans = maskRes.mathRegions;
    maskedSpans = maskRes.regions.filter(
      (r) => r.kind !== "inline_math" && r.kind !== "display_math",
    );
    if (effectiveUserMacros === undefined && maskRes.userMacros.size > 0) {
      effectiveUserMacros = maskRes.userMacros;
    }
    if (effectiveCustomCiteMacros === undefined && maskRes.customCiteMacros.size > 0) {
      effectiveCustomCiteMacros = maskRes.customCiteMacros;
    }
  }

  const segments: ReplacementSegment[] = [];
  if (options?.markerRanges !== undefined) {
    for (const r of options.markerRanges) {
      if (r.start >= 0 && r.end > r.start && r.end <= s.length) {
        segments.push({ start: r.start, end: r.end, kind: "cite", replacement: "\u27E6c\u27E7" });
      }
    }
  }
  for (const m of mathSpans) {
    if (m.start >= 0 && m.end > m.start && m.end <= s.length) {
      segments.push({
        start: m.start,
        end: m.end,
        kind: "math",
        replacement: m.text !== undefined ? m.text : mathText(s.slice(m.start, m.end)),
      });
    }
  }
  for (const r of maskedSpans) {
    if (r.start >= 0 && r.end > r.start && r.end <= s.length) {
      segments.push({ start: r.start, end: r.end, kind: "masked", replacement: "" });
    }
  }

  // Sort by start asc; citation > math > masked on equal start; wider end first
  const priority = (kind: ReplacementSegment["kind"]): number =>
    kind === "cite" ? 0 : kind === "math" ? 1 : 2;
  segments.sort((a, b) => {
    if (a.start !== b.start) {
      return a.start - b.start;
    }
    const pa = priority(a.kind);
    const pb = priority(b.kind);
    if (pa !== pb) {
      return pa - pb;
    }
    return b.end - a.end;
  });

  const parts: string[] = [];
  const protectedSpans: TextRangeLike[] = [];
  let assembledLen = 0;
  let cursor = 0;

  for (const seg of segments) {
    if (seg.start < cursor) {
      continue;
    }
    if (seg.start > cursor) {
      assembledLen = appendRawProseWithoutMasks(s.slice(cursor, seg.start), parts, assembledLen);
    }
    if (seg.replacement.length > 0) {
      const pStart = assembledLen;
      parts.push(seg.replacement);
      assembledLen += seg.replacement.length;
      if (seg.kind === "cite" || seg.kind === "math") {
        protectedSpans.push({ start: pStart, end: assembledLen });
      }
    }
    cursor = seg.end;
  }
  if (cursor < s.length) {
    assembledLen = appendRawProseWithoutMasks(s.slice(cursor), parts, assembledLen);
  }

  const assembled = parts.join("");
  const substituted =
    format === "latex"
      ? applyLatexSubstitutionsWithProtected(
          assembled,
          {
            ...(effectiveUserMacros !== undefined ? { userMacros: effectiveUserMacros } : {}),
            ...(effectiveCustomCiteMacros !== undefined ? { customCiteMacros: effectiveCustomCiteMacros } : {}),
          },
          protectedSpans,
          false,
        ).text
      : assembled;

  return collapseAndTrimAsciiSpace(normLower(substituted));
}

/**
 * Computes `sentenceHash = sha256hex(normSentence(s, options))` (`01` §3.1).
 */
export function sentenceHash(s: string, options?: NormSentenceOptions): string {
  return sha256hex(normSentence(s, options));
}
