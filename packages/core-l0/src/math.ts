/**
 * Pure TypeScript LaTeX math-to-text normalizer (`docs/spec/02_L0_TIER_A_PRE_DECODE.md` §3.2).
 *
 * Strictly O(n) character-code scanner using precomputed brace maps:
 * zero regular expressions, zero `.toLowerCase()`, zero `.normalize()`.
 */

import { isSpace } from "./norm.js";

const GREEK_LOWER: ReadonlyMap<string, string> = new Map([
  ["alpha", "\u03B1"],
  ["beta", "\u03B2"],
  ["gamma", "\u03B3"],
  ["delta", "\u03B4"],
  ["epsilon", "\u03B5"],
  ["varepsilon", "\u03B5"],
  ["zeta", "\u03B6"],
  ["eta", "\u03B7"],
  ["theta", "\u03B8"],
  ["vartheta", "\u03B8"],
  ["iota", "\u03B9"],
  ["kappa", "\u03BA"],
  ["lambda", "\u03BB"],
  ["mu", "\u03BC"],
  ["nu", "\u03BD"],
  ["xi", "\u03BE"],
  ["omicron", "\u03BF"],
  ["pi", "\u03C0"],
  ["varpi", "\u03C0"],
  ["rho", "\u03C1"],
  ["varrho", "\u03C1"],
  ["sigma", "\u03C3"],
  ["varsigma", "\u03C2"],
  ["tau", "\u03C4"],
  ["upsilon", "\u03C5"],
  ["phi", "\u03C6"],
  ["varphi", "\u03C6"],
  ["chi", "\u03C7"],
  ["psi", "\u03C8"],
  ["omega", "\u03C9"],
]);

const GREEK_UPPER: ReadonlyMap<string, string> = new Map([
  ["Alpha", "\u0391"],
  ["Beta", "\u0392"],
  ["Gamma", "\u0393"],
  ["Delta", "\u0394"],
  ["Epsilon", "\u0395"],
  ["Zeta", "\u0396"],
  ["Eta", "\u0397"],
  ["Theta", "\u0398"],
  ["Iota", "\u0399"],
  ["Kappa", "\u039A"],
  ["Lambda", "\u039B"],
  ["Mu", "\u039C"],
  ["Nu", "\u039D"],
  ["Xi", "\u039E"],
  ["Omicron", "\u039F"],
  ["Pi", "\u03A0"],
  ["Rho", "\u03A1"],
  ["Sigma", "\u03A3"],
  ["Tau", "\u03A4"],
  ["Upsilon", "\u03A5"],
  ["Phi", "\u03A6"],
  ["Chi", "\u03A7"],
  ["Psi", "\u03A8"],
  ["Omega", "\u03A9"],
]);

const MATH_OPERATORS: ReadonlyMap<string, string> = new Map([
  ["pm", "\u00B1"],
  ["times", "\u00D7"],
  ["cdot", "\u00D7"],
  ["le", "\u2264"],
  ["leq", "\u2264"],
  ["leqslant", "\u2264"],
  ["ge", "\u2265"],
  ["geq", "\u2265"],
  ["geqslant", "\u2265"],
  ["neq", "\u2260"],
  ["approx", "\u2248"],
  ["sim", "\u2248"],
]);

const OUTER_MATH_ENVS: ReadonlySet<string> = new Set([
  "equation",
  "equation*",
  "align",
  "align*",
  "gather",
  "gather*",
  "multline",
  "multline*",
  "eqnarray",
  "eqnarray*",
  "math",
  "math*",
  "displaymath",
  "displaymath*",
]);

function isAsciiLetter(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

/**
 * Collapses runs of ASCII whitespace (`U+0020`, `U+0009`, `U+000A`, `U+000D`)
 * to a single `U+0020` and trims leading/trailing whitespace.
 */
export function collapseAndTrimAsciiSpace(input: string): string {
  const n = input.length;
  let start = 0;
  while (start < n && isSpace(input.charCodeAt(start))) {
    start++;
  }
  let end = n;
  while (end > start && isSpace(input.charCodeAt(end - 1))) {
    end--;
  }
  if (start >= end) {
    return "";
  }
  const parts: string[] = [];
  let runStart = start;
  let i = start;
  while (i < end) {
    if (isSpace(input.charCodeAt(i))) {
      if (i > runStart) {
        parts.push(input.slice(runStart, i));
      }
      parts.push(" ");
      i++;
      while (i < end && isSpace(input.charCodeAt(i))) {
        i++;
      }
      runStart = i;
    } else {
      i++;
    }
  }
  if (end > runStart) {
    parts.push(input.slice(runStart, end));
  }
  return parts.join("");
}

/**
 * Precomputes matching closing `}` UTF-16 indices in a single O(n) pass.
 * Entry `braceClose[i]` holds the index of the matching `}` for an unescaped `{`
 * at `i`, or `-1` otherwise. Backslash escapes (`\{`, `\}`, `\\`) are skipped as pairs.
 */
export function buildBraceCloseMap(input: string): Int32Array {
  const n = input.length;
  const closeMap = new Int32Array(n);
  closeMap.fill(-1);
  const stack: number[] = [];
  let i = 0;
  while (i < n) {
    const code = input.charCodeAt(i);
    if (code === 92) {
      i += 2;
      continue;
    }
    if (code === 123) {
      stack.push(i);
    } else if (code === 125) {
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
 * Strips one layer of outer math delimiters (`$$...$$`, `$...$`, `\[...\]`,
 * `\(...\)`, or `\begin{E}...\end{E}` for math environments) when present.
 */
function stripOuterMathDelimiters(region: string): {
  readonly inner: string;
  readonly startOffset: number;
  readonly endOffset: number;
} {
  const n = region.length;
  let left = 0;
  let right = n;
  while (left < right && isSpace(region.charCodeAt(left))) {
    left++;
  }
  while (right > left && isSpace(region.charCodeAt(right - 1))) {
    right--;
  }
  const len = right - left;

  if (len >= 4 && region.startsWith("$$", left) && region.slice(right - 2, right) === "$$") {
    return { inner: region.slice(left + 2, right - 2), startOffset: left + 2, endOffset: right - 2 };
  }
  if (len >= 4 && region.startsWith("\\[", left) && region.slice(right - 2, right) === "\\]") {
    return { inner: region.slice(left + 2, right - 2), startOffset: left + 2, endOffset: right - 2 };
  }
  if (len >= 4 && region.startsWith("\\(", left) && region.slice(right - 2, right) === "\\)") {
    return { inner: region.slice(left + 2, right - 2), startOffset: left + 2, endOffset: right - 2 };
  }
  if (len >= 2 && region.charCodeAt(left) === 36 && region.charCodeAt(right - 1) === 36) {
    if (!(len >= 3 && region.charCodeAt(left + 1) === 36) && !(len >= 3 && region.charCodeAt(right - 2) === 36)) {
      return { inner: region.slice(left + 1, right - 1), startOffset: left + 1, endOffset: right - 1 };
    }
  }
  if (len >= 13 && region.startsWith("\\begin{", left)) {
    const openBrace = left + 6;
    const closeBrace = region.indexOf("}", openBrace + 1);
    if (closeBrace !== -1 && closeBrace < right) {
      const envName = region.slice(openBrace + 1, closeBrace);
      const expectedEnd = `\\end{${envName}}`;
      if (
        OUTER_MATH_ENVS.has(envName) &&
        right - expectedEnd.length >= closeBrace + 1 &&
        region.slice(right - expectedEnd.length, right) === expectedEnd
      ) {
        return {
          inner: region.slice(closeBrace + 1, right - expectedEnd.length),
          startOffset: closeBrace + 1,
          endOffset: right - expectedEnd.length,
        };
      }
    }
  }
  return { inner: region, startOffset: 0, endOffset: n };
}

function skipSpaces(input: string, start: number, end: number): number {
  let i = start;
  while (i < end && isSpace(input.charCodeAt(i))) {
    i++;
  }
  return i;
}

/**
 * Finds the matching `]` for `[` at `openIdx` without nesting brackets inside brackets,
 * ignoring backslash escapes (`\\`, `\[`, `\]`) and `{...}` braced subexpressions.
 */
function findMatchingBracket(
  input: string,
  braceClose: Int32Array,
  openIdx: number,
  end: number,
): number {
  let i = openIdx + 1;
  while (i < end) {
    const code = input.charCodeAt(i);
    if (code === 92) {
      i += 2;
      continue;
    }
    if (code === 123) {
      const close = braceClose[i] ?? -1;
      if (close !== -1 && close < end) {
        i = close + 1;
        continue;
      }
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

function convertMathSlice(
  input: string,
  braceClose: Int32Array,
  start: number,
  end: number,
  depth: number,
): string {
  const parts: string[] = [];
  let i = start;

  while (i < end) {
    const code = input.charCodeAt(i);

    if (code === 92) {
      if (i + 1 >= end) {
        i++;
        continue;
      }
      const nextCode = input.charCodeAt(i + 1);
      if (isAsciiLetter(nextCode)) {
        let nameEnd = i + 2;
        while (nameEnd < end && isAsciiLetter(input.charCodeAt(nameEnd))) {
          nameEnd++;
        }
        const name = input.slice(i + 1, nameEnd);

        if (name === "frac" && depth < 64) {
          const arg1Open = skipSpaces(input, nameEnd, end);
          const arg1Close = arg1Open < end && input.charCodeAt(arg1Open) === 123 ? (braceClose[arg1Open] ?? -1) : -1;
          if (arg1Close !== -1 && arg1Close < end) {
            const arg2Open = skipSpaces(input, arg1Close + 1, end);
            const arg2Close = arg2Open < end && input.charCodeAt(arg2Open) === 123 ? (braceClose[arg2Open] ?? -1) : -1;
            if (arg2Close !== -1 && arg2Close < end) {
              const num = collapseAndTrimAsciiSpace(
                convertMathSlice(input, braceClose, arg1Open + 1, arg1Close, depth + 1),
              );
              const den = collapseAndTrimAsciiSpace(
                convertMathSlice(input, braceClose, arg2Open + 1, arg2Close, depth + 1),
              );
              parts.push(`(${num})/(${den})`);
              i = arg2Close + 1;
              continue;
            }
          }
          i = nameEnd;
          continue;
        }

        if (name === "sqrt" && depth < 64) {
          let cursor = skipSpaces(input, nameEnd, end);
          if (cursor < end && input.charCodeAt(cursor) === 91) {
            const bracketClose = findMatchingBracket(input, braceClose, cursor, end);
            if (bracketClose !== -1) {
              cursor = skipSpaces(input, bracketClose + 1, end);
            }
          }
          const argClose = cursor < end && input.charCodeAt(cursor) === 123 ? (braceClose[cursor] ?? -1) : -1;
          if (argClose !== -1 && argClose < end) {
            const radicand = collapseAndTrimAsciiSpace(
              convertMathSlice(input, braceClose, cursor + 1, argClose, depth + 1),
            );
            parts.push(`sqrt(${radicand})`);
            i = argClose + 1;
            continue;
          }
          i = nameEnd;
          continue;
        }

        const greekLower = GREEK_LOWER.get(name);
        if (greekLower !== undefined) {
          parts.push(greekLower);
          i = nameEnd;
          continue;
        }
        const greekUpper = GREEK_UPPER.get(name);
        if (greekUpper !== undefined) {
          parts.push(greekUpper);
          i = nameEnd;
          continue;
        }
        const op = MATH_OPERATORS.get(name);
        if (op !== undefined) {
          parts.push(op);
          i = nameEnd;
          continue;
        }

        i = nameEnd;
        continue;
      }

      if (nextCode === 37) {
        parts.push("%");
      }
      i += 2;
      continue;
    }

    if ((code === 94 || code === 95) && i + 1 < end && input.charCodeAt(i + 1) === 123) {
      const openIdx = i + 1;
      const closeIdx = braceClose[openIdx] ?? -1;
      if (closeIdx !== -1 && closeIdx < end && depth < 64) {
        const scriptChar = code === 94 ? "^" : "_";
        const inner = collapseAndTrimAsciiSpace(
          convertMathSlice(input, braceClose, openIdx + 1, closeIdx, depth + 1),
        );
        parts.push(`${scriptChar}${inner}`);
        i = closeIdx + 1;
        continue;
      }
    }

    if (code === 123 || code === 125) {
      i++;
      continue;
    }

    if (isSpace(code)) {
      parts.push(" ");
      i++;
      continue;
    }

    let plainEnd = i + 1;
    while (plainEnd < end) {
      const next = input.charCodeAt(plainEnd);
      if (next === 92 || next === 123 || next === 125 || next === 94 || next === 95 || isSpace(next)) {
        break;
      }
      plainEnd++;
    }
    parts.push(input.slice(i, plainEnd));
    i = plainEnd;
  }

  return parts.join("");
}

/**
 * Converts a LaTeX math region (`$...$`, `$$...$$`, `\(...\)`, `\[...\]`,
 * `\begin{equation}...\end{equation}`, or already-unwrapped body) into compact,
 * deterministic Unicode/ASCII math text suitable for sentence identity (`normSentence`).
 */
export function mathText(region: string): string {
  const { inner } = stripOuterMathDelimiters(region);
  const braceClose = buildBraceCloseMap(inner);
  const raw = convertMathSlice(inner, braceClose, 0, inner.length, 0);
  return collapseAndTrimAsciiSpace(raw);
}
