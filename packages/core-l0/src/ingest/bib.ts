/**
 * Pure Multi-Format Bibliography Parsers & Canonical Reference Normalizer
 * (`docs/spec/03_L0_TIER_B_VALIDATOR_B5_INGEST.md` §5.2 steps 5–6; `02` §5.4).
 *
 * Supports BibTeX (`sentenceCase: false`, `@string`, `@preamble`, `@comment`,
 * verbatim DOI/SICI, LaTeX diacritic decoding, unknown commands preserved,
 * corporate & particle authors), RIS, CSL-JSON, and `\bibitem`/`.bbl`.
 *
 * Pure TypeScript: zero Node I/O, DOM, network, clock, or regex usage.
 */

import { compareCodeUnits } from "../bm25.js";
import { SURNAME_PARTICLES, type BibliographyEntry } from "../citations.js";
import { preMask } from "../mask.js";
import { norm, normLower, sha256hex } from "../norm.js";
import { isValidArxivId, isValidDoi, isValidPmcid } from "@toulmin/schemas";

export type BibSourceFormat =
  | "bibtex"
  | "ris"
  | "csl_json"
  | "bibitem"
  | "raw_text"
  | "docx_field";

export interface ParsedAuthor {
  readonly family: string;
  readonly given?: string;
  readonly literal?: string;
  readonly isCorporate?: boolean;
}

export interface IngestedBibRecord {
  readonly refId: string;
  readonly key: string;
  readonly aliases: readonly string[];
  readonly sourceFormat: BibSourceFormat;
  readonly entryType: string;
  readonly orderIndex?: number;
  readonly doi: string | null;
  readonly pmcid: string | null;
  readonly arxivId: string | null;
  readonly title: string;
  readonly authors: readonly ParsedAuthor[];
  readonly firstAuthorFamily?: string;
  readonly corporateAuthor?: string;
  readonly shortauthor?: string;
  readonly shorthand?: string;
  readonly year?: string;
  readonly venue?: string;
  readonly raw?: string;
}

export interface BibParseResult {
  readonly records: readonly IngestedBibRecord[];
  readonly skippedEntries: number;
  readonly warnings: readonly string[];
  readonly duplicateKeys: readonly string[];
}

function isAsciiDigitCode(cu: number): boolean {
  return cu >= 48 && cu <= 57;
}

function isAsciiLetterCode(cu: number): boolean {
  return (cu >= 65 && cu <= 90) || (cu >= 97 && cu <= 122);
}

function isWhitespaceCode(cu: number): boolean {
  return cu === 32 || cu === 9 || cu === 10 || cu === 13 || cu === 12 || cu === 160;
}

function asciiLower(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i += 1) {
    const cu = text.charCodeAt(i);
    if (cu >= 65 && cu <= 90) {
      out += String.fromCharCode(cu + 32);
    } else {
      out += text.charAt(i);
    }
  }
  return out;
}

function asciiUpper(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i += 1) {
    const cu = text.charCodeAt(i);
    if (cu >= 97 && cu <= 122) {
      out += String.fromCharCode(cu - 32);
    } else {
      out += text.charAt(i);
    }
  }
  return out;
}

function collapseSpaces(text: string): string {
  let out = "";
  let prevSpace = true;
  for (let i = 0; i < text.length; i += 1) {
    const cu = text.charCodeAt(i);
    if (isWhitespaceCode(cu)) {
      if (!prevSpace) {
        out += " ";
        prevSpace = true;
      }
    } else {
      out += text.charAt(i);
      prevSpace = false;
    }
  }
  if (out.endsWith(" ")) {
    return out.slice(0, out.length - 1);
  }
  return out;
}

function unwrapSingleOuterBraces(raw: string): { readonly text: string; readonly wasBraced: boolean } {
  const s = raw.trim();
  if (s.length < 2 || s.charCodeAt(0) !== 123 || s.charCodeAt(s.length - 1) !== 125) {
    return { text: s, wasBraced: false };
  }
  let depth = 0;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s.charCodeAt(i);
    if (ch === 92) {
      i += 1;
      continue;
    }
    if (ch === 123) depth += 1;
    else if (ch === 125) {
      depth -= 1;
      if (depth === 0 && i < s.length - 1) {
        return { text: s, wasBraced: false };
      }
    }
  }
  if (depth !== 0) return { text: s, wasBraced: false };
  return { text: s.slice(1, s.length - 1), wasBraced: true };
}

/**
 * Verbatim DOI extractor (`03` §5.2 step 5): trims, strips leading URL/`doi:` prefix,
 * and validates via `@toulmin/schemas` `isValidDoi` without altering SICI characters (`<`, `>`, `;`).
 */
export function normalizeDoiVerbatim(raw: string): string | null {
  let s = unwrapSingleOuterBraces(raw.trim()).text.trim();
  if (s.length === 0) return null;

  const lower = asciiLower(s);
  const prefixes = [
    "https://doi.org/",
    "http://doi.org/",
    "https://dx.doi.org/",
    "http://dx.doi.org/",
    "doi.org/",
    "dx.doi.org/",
    "doi:",
  ];
  for (const p of prefixes) {
    if (lower.startsWith(p)) {
      s = s.slice(p.length).trim();
      break;
    }
  }

  return isValidDoi(s) ? s : null;
}

export function normalizePmcid(raw: string): string | null {
  let s = unwrapSingleOuterBraces(raw.trim()).text.trim();
  if (s.length === 0) return null;
  const lower = asciiLower(s);
  const urlPrefixes = [
    "https://pmc.ncbi.nlm.nih.gov/articles/",
    "http://pmc.ncbi.nlm.nih.gov/articles/",
    "https://www.ncbi.nlm.nih.gov/pmc/articles/",
    "http://www.ncbi.nlm.nih.gov/pmc/articles/",
  ];
  for (const p of urlPrefixes) {
    if (lower.startsWith(p)) {
      s = s.slice(p.length).trim();
      break;
    }
  }
  while (s.endsWith("/")) s = s.slice(0, s.length - 1);
  if (asciiLower(s).startsWith("pmc")) {
    s = "PMC" + s.slice(3);
  }
  return isValidPmcid(s) ? s : null;
}

export function normalizeArxivId(raw: string): string | null {
  let s = unwrapSingleOuterBraces(raw.trim()).text.trim();
  if (s.length === 0) return null;
  let lower = asciiLower(s);
  const prefixes = [
    "https://arxiv.org/abs/",
    "http://arxiv.org/abs/",
    "https://arxiv.org/pdf/",
    "http://arxiv.org/pdf/",
    "arxiv:",
  ];
  for (const p of prefixes) {
    if (lower.startsWith(p)) {
      s = s.slice(p.length).trim();
      lower = asciiLower(s);
      break;
    }
  }
  if (lower.endsWith(".pdf")) {
    s = s.slice(0, s.length - 4);
  }
  return isValidArxivId(s) ? s : null;
}

const ACCENT_TABLES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  "'": {
    A: "\u00c1", a: "\u00e1", C: "\u0106", c: "\u0107", E: "\u00c9", e: "\u00e9",
    I: "\u00cd", i: "\u00ed", L: "\u0139", l: "\u013a", N: "\u0143", n: "\u0144",
    O: "\u00d3", o: "\u00f3", R: "\u0154", r: "\u0155", S: "\u015a", s: "\u015b",
    U: "\u00da", u: "\u00fa", Y: "\u00dd", y: "\u00fd", Z: "\u0179", z: "\u017a",
    "\\i": "\u00ed",
  },
  "`": {
    A: "\u00c0", a: "\u00e0", E: "\u00c8", e: "\u00e8", I: "\u00cc", i: "\u00ec",
    O: "\u00d2", o: "\u00f2", U: "\u00d9", u: "\u00f9", "\\i": "\u00ec",
  },
  "^": {
    A: "\u00c2", a: "\u00e2", C: "\u0108", c: "\u0109", E: "\u00ca", e: "\u00ea",
    G: "\u011c", g: "\u011d", H: "\u0124", h: "\u0125", I: "\u00ce", i: "\u00ee",
    J: "\u0134", j: "\u0135", O: "\u00d4", o: "\u00f4", S: "\u015c", s: "\u015d",
    U: "\u00db", u: "\u00fb", W: "\u0174", w: "\u0175", Y: "\u0176", y: "\u0177",
    "\\i": "\u00ee", "\\j": "\u0135",
  },
  '"': {
    A: "\u00c4", a: "\u00e4", E: "\u00cb", e: "\u00eb", H: "H\u0308", h: "h\u0308",
    I: "\u00cf", i: "\u00ef", O: "\u00d6", o: "\u00f6", U: "\u00dc", u: "\u00fc",
    W: "\u1e84", w: "\u1e85", Y: "\u0178", y: "\u00ff", "\\i": "\u00ef",
  },
  "~": {
    A: "\u00c3", a: "\u00e3", I: "\u0128", i: "\u0129", N: "\u00d1", n: "\u00f1",
    O: "\u00d5", o: "\u00f5", U: "\u0168", u: "\u0169", "\\i": "\u0129",
  },
  "=": {
    A: "\u0100", a: "\u0101", E: "\u0112", e: "\u0113", I: "\u012a", i: "\u012b",
    O: "\u014c", o: "\u014d", U: "\u016a", u: "\u016b", "\\i": "\u012b",
  },
  ".": {
    C: "\u010a", c: "\u010b", E: "\u0116", e: "\u0117", G: "\u0120", g: "\u0121",
    I: "\u0130", Z: "\u017b", z: "\u017c",
  },
  c: { C: "\u00c7", c: "\u00e7", S: "\u015e", s: "\u015f", T: "\u0162", t: "\u0163" },
  v: {
    C: "\u010c", c: "\u010d", D: "\u010e", d: "\u010f", E: "\u011a", e: "\u011b",
    N: "\u0147", n: "\u0148", R: "\u0158", r: "\u0159", S: "\u0160", s: "\u0161",
    T: "\u0164", t: "\u0165", Z: "\u017d", z: "\u017e",
  },
  u: { A: "\u0102", a: "\u0103", E: "\u0114", e: "\u0115", G: "\u011e", g: "\u011f", I: "\u012c", i: "\u012d" },
  H: { O: "\u0150", o: "\u0151", U: "\u0170", u: "\u0171" },
  r: { A: "\u00c5", a: "\u00e5", U: "\u016e", u: "\u016f" },
  d: { A: "\u1ea0", a: "\u1ea1", D: "\u1e0c", d: "\u1e0d", E: "\u1eb8", e: "\u1eb9", H: "\u1e24", h: "\u1e25", S: "\u1e62", s: "\u1e63", T: "\u1e6c", t: "\u1e6d" },
  k: { A: "\u0104", a: "\u0105", E: "\u0118", e: "\u0119", I: "\u012e", i: "\u012f", U: "\u0172", u: "\u0173" },
};

const SPECIAL_MACROS: Readonly<Record<string, string>> = {
  aa: "\u00e5",
  AA: "\u00c5",
  ae: "\u00e6",
  AE: "\u00c6",
  oe: "\u0153",
  OE: "\u0152",
  o: "\u00f8",
  O: "\u00d8",
  l: "\u0142",
  L: "\u0141",
  ss: "\u00df",
  SS: "\u1e9e",
  i: "i",
  j: "j",
  textendash: "\u2013",
  textemdash: "\u2014",
  textquotedblleft: "\u201c",
  textquotedblright: "\u201d",
  textquoteleft: "\u2018",
  textquoteright: "\u2019",
};

function readBalancedBraceGroup(s: string, openIdx: number): { readonly content: string; readonly next: number } | null {
  if (openIdx >= s.length || s.charCodeAt(openIdx) !== 123) return null;
  let depth = 0;
  for (let i = openIdx; i < s.length; i += 1) {
    const cu = s.charCodeAt(i);
    if (cu === 92) {
      i += 1;
      continue;
    }
    if (cu === 123) depth += 1;
    else if (cu === 125) {
      depth -= 1;
      if (depth === 0) {
        return { content: s.slice(openIdx + 1, i), next: i + 1 };
      }
    }
  }
  return null;
}

/**
 * Pure O(n) BibTeX value decoder implementing `03` §5.2 step 5:
 * `sentenceCase: false`, `raw: false`, standard LaTeX accents & escapes decoded,
 * BibTeX case-protection braces stripped, and unknown LaTeX commands preserved verbatim.
 */
export function decodeLatexBibText(raw: string): string {
  const n = raw.length;
  let out = "";
  let i = 0;

  while (i < n) {
    const cu = raw.charCodeAt(i);
    if (cu === 126 /* '~' */) {
      out += " ";
      i += 1;
      continue;
    }
    if (cu === 45 /* '-' */) {
      if (raw.startsWith("---", i)) {
        out += "\u2014";
        i += 3;
        continue;
      }
      if (raw.startsWith("--", i)) {
        out += "\u2013";
        i += 2;
        continue;
      }
      out += "-";
      i += 1;
      continue;
    }
    if (cu === 123 /* '{' */) {
      i += 1;
      continue;
    }
    if (cu === 125 /* '}' */) {
      i += 1;
      continue;
    }
    if (cu !== 92 /* '\\' */) {
      out += raw.charAt(i);
      i += 1;
      continue;
    }

    if (i + 1 >= n) {
      out += "\\";
      break;
    }

    const ch1 = raw.charAt(i + 1);
    // Punctuation escapes: \& \% \$ \# \_ \{ \}
    if (
      ch1 === "&" ||
      ch1 === "%" ||
      ch1 === "$" ||
      ch1 === "#" ||
      ch1 === "_" ||
      ch1 === "{" ||
      ch1 === "}"
    ) {
      out += ch1;
      i += 2;
      continue;
    }

    // Punctuation accent commands ONLY: \' \` \^ \" \~ \= \.
    const isPunctAccentCmd =
      ch1 === "'" || ch1 === "`" || ch1 === "^" || ch1 === '"' || ch1 === "~" || ch1 === "=" || ch1 === ".";
    const punctAccent = isPunctAccentCmd ? ACCENT_TABLES[ch1] : undefined;
    if (punctAccent !== undefined) {
      let argPos = i + 2;
      while (argPos < n && raw.charCodeAt(argPos) === 32) argPos += 1;
      if (argPos < n && raw.charCodeAt(argPos) === 123) {
        const grp = readBalancedBraceGroup(raw, argPos);
        if (grp !== null) {
          const base = grp.content.trim();
          const mapped = punctAccent[base];
          if (mapped !== undefined) {
            out += mapped;
            i = grp.next;
            continue;
          }
          if (base.length > 0) {
            out += decodeLatexBibText(base);
            i = grp.next;
            continue;
          }
        }
      } else if (argPos + 1 < n && raw.charAt(argPos) === "\\") {
        const pair = raw.slice(argPos, argPos + 2);
        const mapped = punctAccent[pair];
        if (mapped !== undefined) {
          out += mapped;
          i = argPos + 2;
          continue;
        }
      } else if (argPos < n) {
        const base = raw.charAt(argPos);
        const mapped = punctAccent[base];
        if (mapped !== undefined) {
          out += mapped;
          i = argPos + 1;
          continue;
        }
      }
      i += 2;
      continue;
    }

    // Alphabetic command name
    if (isAsciiLetterCode(raw.charCodeAt(i + 1))) {
      let cmdEnd = i + 1;
      while (cmdEnd < n && isAsciiLetterCode(raw.charCodeAt(cmdEnd))) cmdEnd += 1;
      const cmd = raw.slice(i + 1, cmdEnd);

      // Letter accent commands like \c{c}, \v{s}, \r{a}, etc.
      const letterAccent = ACCENT_TABLES[cmd];
      if (letterAccent !== undefined) {
        let argPos = cmdEnd;
        while (argPos < n && raw.charCodeAt(argPos) === 32) argPos += 1;
        if (argPos < n && raw.charCodeAt(argPos) === 123) {
          const grp = readBalancedBraceGroup(raw, argPos);
          if (grp !== null) {
            const mapped = letterAccent[grp.content.trim()];
            if (mapped !== undefined) {
              out += mapped;
              i = grp.next;
              continue;
            }
          }
        } else if (cmdEnd < argPos && argPos < n && isAsciiLetterCode(raw.charCodeAt(argPos))) {
          const mapped = letterAccent[raw.charAt(argPos)];
          if (mapped !== undefined) {
            out += mapped;
            i = argPos + 1;
            continue;
          }
        }
      }

      const special = SPECIAL_MACROS[cmd];
      if (special !== undefined) {
        let nextPos = cmdEnd;
        while (nextPos < n && raw.charCodeAt(nextPos) === 32) nextPos += 1;
        if (nextPos + 1 < n && raw.charCodeAt(nextPos) === 123 && raw.charCodeAt(nextPos + 1) === 125) {
          nextPos += 2;
        }
        out += special;
        i = nextPos;
        continue;
      }

      // Unknown LaTeX command: preserve verbatim including optional space / braced argument
      let endPreserve = cmdEnd;
      if (endPreserve < n && raw.charCodeAt(endPreserve) === 123) {
        const grp = readBalancedBraceGroup(raw, endPreserve);
        if (grp !== null) {
          endPreserve = grp.next;
        }
      }
      out += raw.slice(i, endPreserve);
      i = endPreserve;
      continue;
    }

    out += raw.charAt(i + 1);
    i += 2;
  }

  return collapseSpaces(norm(out).text);
}

function splitTopLevelBibAuthors(raw: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  let i = 0;
  const n = raw.length;
  while (i < n) {
    const cu = raw.charCodeAt(i);
    if (cu === 92) {
      i += 2;
      continue;
    }
    if (cu === 123) depth += 1;
    else if (cu === 125 && depth > 0) depth -= 1;
    else if (depth === 0 && i > 0 && isWhitespaceCode(raw.charCodeAt(i - 1))) {
      // Check case-insensitive `and` followed by whitespace
      if (
        i + 3 < n &&
        (cu === 97 || cu === 65) &&
        (raw.charCodeAt(i + 1) === 110 || raw.charCodeAt(i + 1) === 78) &&
        (raw.charCodeAt(i + 2) === 100 || raw.charCodeAt(i + 2) === 68) &&
        isWhitespaceCode(raw.charCodeAt(i + 3))
      ) {
        const seg = raw.slice(start, i).trim();
        if (seg.length > 0) parts.push(seg);
        i += 4;
        while (i < n && isWhitespaceCode(raw.charCodeAt(i))) i += 1;
        start = i;
        continue;
      }
    }
    i += 1;
  }
  const tail = raw.slice(start).trim();
  if (tail.length > 0) parts.push(tail);
  return parts;
}

function splitTopLevelCommas(raw: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < raw.length; i += 1) {
    const cu = raw.charCodeAt(i);
    if (cu === 92) {
      i += 1;
      continue;
    }
    if (cu === 123) depth += 1;
    else if (cu === 125 && depth > 0) depth -= 1;
    else if (cu === 44 /* ',' */ && depth === 0) {
      out.push(raw.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(raw.slice(start).trim());
  return out;
}

const BIB_PARTICLE_SET: ReadonlySet<string> = new Set(
  SURNAME_PARTICLES.map((p) => p.trim()),
);

function parseSinglePersonalAuthor(item: string): ParsedAuthor {
  const commaParts = splitTopLevelCommas(item);
  if (commaParts.length >= 2) {
    const family = decodeLatexBibText(commaParts[0] ?? "");
    const given = decodeLatexBibText(commaParts[commaParts.length - 1] ?? "");
    return given.length > 0 ? { family, given } : { family };
  }

  const decoded = decodeLatexBibText(item);
  const words = decoded.split(" ").filter((w) => w.length > 0);
  if (words.length <= 1) {
    return { family: decoded };
  }

  // Detect `von` particle boundary for `First von Last`
  let splitIdx = words.length - 1;
  for (let k = words.length - 2; k >= 1; k -= 1) {
    const wLower = normLower(words[k]!);
    const twoWord = k >= 2 ? `${normLower(words[k - 1]!)} ${wLower}` : "";
    const firstCp = words[k]!.charCodeAt(0);
    const startsLower = firstCp >= 97 && firstCp <= 122;
    if (BIB_PARTICLE_SET.has(twoWord)) {
      splitIdx = k - 1;
      break;
    }
    if (BIB_PARTICLE_SET.has(wLower) || startsLower) {
      splitIdx = k;
    } else {
      break;
    }
  }

  const given = words.slice(0, splitIdx).join(" ");
  const family = words.slice(splitIdx).join(" ");
  return given.length > 0 ? { family, given } : { family };
}

/**
 * Parses BibTeX `author` field value (after outer `{...}` / `"..."` delimiter has been unwrapped)
 * into structured authors, `firstAuthorFamily`, and optional `corporateAuthor`.
 */
export function parseBibAuthorList(rawAuthor: string): {
  readonly authors: readonly ParsedAuthor[];
  readonly firstAuthorFamily?: string;
  readonly corporateAuthor?: string;
} {
  const items = splitTopLevelBibAuthors(rawAuthor.trim());
  if (items.length === 0) return { authors: [] };

  const parsed: ParsedAuthor[] = [];
  let corporateAuthor: string | undefined;

  for (let idx = 0; idx < items.length; idx += 1) {
    const item = items[idx]!.trim();
    const unwrapped = unwrapSingleOuterBraces(item);
    // Single balanced outer brace wrapping the entire author item indicates corporate/literal author
    // (e.g. `author = {{World Health Organization}}` -> inner field item `{World Health Organization}`).
    if (unwrapped.wasBraced) {
      const lit = decodeLatexBibText(unwrapped.text);
      if (idx === 0) corporateAuthor = lit;
      parsed.push({ family: lit, literal: lit, isCorporate: true });
    } else {
      parsed.push(parseSinglePersonalAuthor(item));
    }
  }

  const first = parsed[0];
  return {
    authors: parsed,
    ...(first !== undefined && !first.isCorporate && first.family.length > 0
      ? { firstAuthorFamily: first.family }
      : {}),
    ...(corporateAuthor !== undefined && corporateAuthor.length > 0 ? { corporateAuthor } : {}),
  };
}

/**
 * Assigns a deterministic `refId` from canonical identifiers (`doi:`, `pmcid:`, `arxiv:`, `key:`, `local:`).
 */
export function assignDeterministicRefId(input: {
  readonly doi?: string | null;
  readonly pmcid?: string | null;
  readonly arxivId?: string | null;
  readonly key?: string;
  readonly raw?: string;
  readonly title?: string;
}): string {
  if (input.doi !== undefined && input.doi !== null && isValidDoi(input.doi)) {
    return `doi:${normLower(input.doi)}`;
  }
  if (input.pmcid !== undefined && input.pmcid !== null && isValidPmcid(input.pmcid)) {
    return `pmcid:${input.pmcid}`;
  }
  if (input.arxivId !== undefined && input.arxivId !== null && isValidArxivId(input.arxivId)) {
    return `arxiv:${normLower(input.arxivId)}`;
  }
  if (input.key !== undefined && input.key.trim().length > 0) {
    return `key:${input.key.trim()}`;
  }
  const basis = normLower(collapseSpaces(input.raw ?? input.title ?? ""));
  return `local:${sha256hex(basis).slice(0, 16)}`;
}

function extractFirstYearWithSuffix(rawYear: string): string | undefined {
  const s = decodeLatexBibText(rawYear);
  for (let i = 0; i + 3 < s.length; i += 1) {
    const c0 = s.charCodeAt(i);
    const c1 = s.charCodeAt(i + 1);
    const c2 = s.charCodeAt(i + 2);
    const c3 = s.charCodeAt(i + 3);
    if (
      (c0 === 49 && c1 === 57 && isAsciiDigitCode(c2) && isAsciiDigitCode(c3)) ||
      (c0 === 50 && c1 === 48 && isAsciiDigitCode(c2) && isAsciiDigitCode(c3))
    ) {
      let y = s.slice(i, i + 4);
      if (i + 4 < s.length) {
        const c4 = s.charCodeAt(i + 4);
        if (c4 >= 97 && c4 <= 122) {
          y += s.charAt(i + 4);
        }
      }
      return y;
    }
  }
  return undefined;
}

function skipWsAndComments(text: string, pos: number): number {
  let i = pos;
  const n = text.length;
  while (i < n && isWhitespaceCode(text.charCodeAt(i))) i += 1;
  return i;
}

function parseBibValueExpression(
  src: string,
  startPos: number,
  macros: ReadonlyMap<string, string>,
): { readonly value: string; readonly rawValue: string; readonly nextPos: number; readonly ok: boolean } {
  const n = src.length;
  let i = skipWsAndComments(src, startPos);
  const parts: string[] = [];
  const rawStart = i;
  let lastRawEnd = i;

  while (i < n) {
    i = skipWsAndComments(src, i);
    if (i >= n) return { value: parts.join(""), rawValue: src.slice(rawStart, lastRawEnd).trim(), nextPos: i, ok: false };
    const cu = src.charCodeAt(i);

    if (cu === 123 /* '{' */) {
      let depth = 0;
      const contentStart = i + 1;
      let j = i;
      let closed = false;
      while (j < n) {
        const ch = src.charCodeAt(j);
        if (ch === 92 && j + 1 < n) {
          j += 2;
          continue;
        }
        if (ch === 123) depth += 1;
        else if (ch === 125) {
          depth -= 1;
          if (depth === 0) {
            parts.push(src.slice(contentStart, j));
            j += 1;
            lastRawEnd = j;
            closed = true;
            break;
          }
        }
        j += 1;
      }
      if (!closed) {
        return { value: parts.join(""), rawValue: src.slice(rawStart, n).trim(), nextPos: n, ok: false };
      }
      i = j;
    } else if (cu === 34 /* '"' */) {
      let braceDepth = 0;
      const contentStart = i + 1;
      let j = i + 1;
      let closed = false;
      while (j < n) {
        const ch = src.charCodeAt(j);
        if (ch === 92 && j + 1 < n) {
          j += 2;
          continue;
        }
        if (ch === 123) braceDepth += 1;
        else if (ch === 125 && braceDepth > 0) braceDepth -= 1;
        else if (ch === 34 && braceDepth === 0) {
          parts.push(src.slice(contentStart, j));
          j += 1;
          lastRawEnd = j;
          closed = true;
          break;
        }
        j += 1;
      }
      if (!closed) {
        return { value: parts.join(""), rawValue: src.slice(rawStart, n).trim(), nextPos: n, ok: false };
      }
      i = j;
    } else {
      const tokStart = i;
      while (i < n) {
        const ch = src.charCodeAt(i);
        if (isWhitespaceCode(ch) || ch === 35 /* '#' */ || ch === 44 /* ',' */ || ch === 125 || ch === 41) {
          break;
        }
        i += 1;
      }
      if (i === tokStart) {
        return { value: parts.join(""), rawValue: src.slice(rawStart, lastRawEnd).trim(), nextPos: i, ok: parts.length > 0 };
      }
      const tok = src.slice(tokStart, i);
      lastRawEnd = i;
      const macroHit = macros.get(asciiLower(tok));
      parts.push(macroHit !== undefined ? macroHit : tok);
    }

    const afterPart = skipWsAndComments(src, i);
    if (afterPart < n && src.charCodeAt(afterPart) === 35 /* '#' */) {
      i = afterPart + 1;
      continue;
    }
    return {
      value: parts.join(""),
      rawValue: src.slice(rawStart, lastRawEnd).trim(),
      nextPos: afterPart,
      ok: true,
    };
  }

  return { value: parts.join(""), rawValue: src.slice(rawStart, lastRawEnd).trim(), nextPos: i, ok: false };
}

function readBibBodyBounds(
  src: string,
  openPos: number,
  openChar: number,
  closeChar: number,
): { readonly endPos: number; readonly closed: boolean } {
  const n = src.length;
  let depth = 1;
  let inQuote = false;
  let quoteBraceDepth = 0;
  let i = openPos + 1;
  while (i < n) {
    const cu = src.charCodeAt(i);
    if (cu === 92 && i + 1 < n) {
      i += 2;
      continue;
    }
    if (depth === 1) {
      if (inQuote) {
        if (cu === 123 /* '{' */) {
          quoteBraceDepth += 1;
        } else if (cu === 125 /* '}' */ && quoteBraceDepth > 0) {
          quoteBraceDepth -= 1;
        } else if (cu === 34 /* '"' */ && quoteBraceDepth === 0) {
          inQuote = false;
        }
        i += 1;
        continue;
      }
      if (cu === 34 /* '"' */) {
        inQuote = true;
        quoteBraceDepth = 0;
        i += 1;
        continue;
      }
    }
    if (cu === openChar || (openChar === 40 && cu === 123)) {
      depth += 1;
    } else if (cu === closeChar || (openChar === 40 && cu === 125 && depth > 1)) {
      depth -= 1;
      if (depth === 0 && cu === closeChar) {
        return { endPos: i, closed: true };
      }
    }
    i += 1;
  }
  return { endPos: n, closed: false };
}

/**
 * Pure O(n) single-pass BibTeX parser (`03` §5.2 step 5).
 * Supports `@string`, `@preamble`, `@comment`, `{...}` & `(...)` entry delimiters,
 * nested braces, `#` string concatenation, verbatim DOIs, LaTeX diacritics, and malformed entry recovery.
 */
export function parseBibTex(text: string): BibParseResult {
  const n = text.length;
  const macros = new Map<string, string>();
  const rawRecords: IngestedBibRecord[] = [];
  const warnings: string[] = [];
  let skippedEntries = 0;

  let i = 0;
  while (i < n) {
    const atPos = text.indexOf("@", i);
    if (atPos === -1) break;

    let nameStart = atPos + 1;
    while (nameStart < n && isWhitespaceCode(text.charCodeAt(nameStart))) nameStart += 1;
    let nameEnd = nameStart;
    while (nameEnd < n) {
      const cu = text.charCodeAt(nameEnd);
      if (!isAsciiLetterCode(cu) && !isAsciiDigitCode(cu) && cu !== 95 && cu !== 45) break;
      nameEnd += 1;
    }
    if (nameEnd === nameStart) {
      i = atPos + 1;
      continue;
    }

    const entryType = asciiLower(text.slice(nameStart, nameEnd));
    let openPos = nameEnd;
    while (openPos < n && isWhitespaceCode(text.charCodeAt(openPos))) openPos += 1;
    if (openPos >= n) {
      skippedEntries += 1;
      warnings.push(`Truncated @${entryType} entry at end of file`);
      break;
    }

    const openCh = text.charCodeAt(openPos);
    if (openCh !== 123 /* '{' */ && openCh !== 40 /* '(' */) {
      i = nameEnd;
      continue;
    }
    const closeCh = openCh === 123 ? 125 : 41;
    const bodyBounds = readBibBodyBounds(text, openPos, openCh, closeCh);
    if (!bodyBounds.closed) {
      skippedEntries += 1;
      warnings.push(`Unclosed @${entryType} entry starting at offset ${String(atPos)}`);
      break;
    }

    const body = text.slice(openPos + 1, bodyBounds.endPos);
    i = bodyBounds.endPos + 1;

    if (entryType === "comment" || entryType === "preamble") {
      continue;
    }

    if (entryType === "string") {
      const eqIdx = body.indexOf("=");
      if (eqIdx === -1) {
        skippedEntries += 1;
        warnings.push("Malformed @string definition without '='");
        continue;
      }
      const macroName = asciiLower(body.slice(0, eqIdx).trim());
      if (macroName.length === 0) {
        skippedEntries += 1;
        continue;
      }
      const parsedVal = parseBibValueExpression(body, eqIdx + 1, macros);
      if (parsedVal.ok) {
        macros.set(macroName, parsedVal.value);
      } else {
        skippedEntries += 1;
        warnings.push(`Malformed @string value for macro "${macroName}"`);
      }
      continue;
    }

    // Standard bibliography entry: read citation key up to first comma
    const firstComma = body.indexOf(",");
    if (firstComma === -1) {
      skippedEntries += 1;
      warnings.push(`Malformed @${entryType} entry without field separator ','`);
      continue;
    }
    const key = body.slice(0, firstComma).trim();
    if (key.length === 0) {
      skippedEntries += 1;
      warnings.push(`Malformed @${entryType} entry with empty citation key`);
      continue;
    }

    const fields = new Map<string, string>();
    const rawFields = new Map<string, string>();
    let cur = firstComma + 1;
    let entryMalformed = false;

    while (cur < body.length) {
      cur = skipWsAndComments(body, cur);
      if (cur >= body.length) break;
      if (body.charCodeAt(cur) === 44 /* ',' */) {
        cur += 1;
        continue;
      }
      const fStart = cur;
      while (cur < body.length) {
        const ch = body.charCodeAt(cur);
        if (ch === 61 /* '=' */ || isWhitespaceCode(ch)) break;
        cur += 1;
      }
      const fieldName = asciiLower(body.slice(fStart, cur).trim());
      cur = skipWsAndComments(body, cur);
      if (cur >= body.length || body.charCodeAt(cur) !== 61 /* '=' */) {
        if (fieldName.length > 0) {
          entryMalformed = true;
          warnings.push(`Malformed field "${fieldName}" in entry "${key}"`);
        }
        break;
      }
      const parsedVal = parseBibValueExpression(body, cur + 1, macros);
      if (!parsedVal.ok) {
        entryMalformed = true;
        warnings.push(`Unclosed field "${fieldName}" value in entry "${key}"`);
        break;
      }
      if (fieldName.length > 0 && !fields.has(fieldName)) {
        fields.set(fieldName, parsedVal.value);
        rawFields.set(fieldName, parsedVal.rawValue);
      }
      cur = parsedVal.nextPos;
      if (cur < body.length && body.charCodeAt(cur) === 44) {
        cur += 1;
      }
    }

    if (entryMalformed && fields.size === 0) {
      skippedEntries += 1;
      continue;
    }

    const rawDoi = fields.get("doi") ?? fields.get("url") ?? "";
    const doi = normalizeDoiVerbatim(fields.get("doi") ?? "") ?? normalizeDoiVerbatim(rawDoi);
    const pmcid = normalizePmcid(fields.get("pmcid") ?? fields.get("pmc") ?? fields.get("url") ?? "");
    const eprintType = asciiLower(fields.get("eprinttype") ?? fields.get("archiveprefix") ?? "");
    const eprintVal = fields.get("eprint") ?? "";
    const arxivId =
      eprintType === "arxiv" || eprintType.length === 0
        ? normalizeArxivId(eprintVal) ?? normalizeArxivId(fields.get("url") ?? "")
        : null;

    const rawAuthor = fields.get("author") ?? fields.get("editor") ?? "";
    const parsedAuthors = rawAuthor.length > 0 ? parseBibAuthorList(rawAuthor) : { authors: [] };

    const titleRaw = fields.get("title") ?? fields.get("booktitle") ?? "";
    const title = titleRaw.length > 0 ? decodeLatexBibText(titleRaw) : "";
    const yearRaw = fields.get("year") ?? fields.get("date") ?? "";
    const year = yearRaw.length > 0 ? extractFirstYearWithSuffix(yearRaw) : undefined;
    const venueRaw = fields.get("journal") ?? fields.get("journaltitle") ?? fields.get("booktitle") ?? fields.get("publisher") ?? "";
    const venue = venueRaw.length > 0 ? decodeLatexBibText(venueRaw) : undefined;
    const shortauthorRaw = fields.get("shortauthor");
    const shortauthor = shortauthorRaw !== undefined ? decodeLatexBibText(shortauthorRaw) : undefined;
    const shorthandRaw = fields.get("shorthand");
    const shorthand = shorthandRaw !== undefined ? decodeLatexBibText(shorthandRaw) : undefined;

    const refId = assignDeterministicRefId({ doi, pmcid, arxivId, key, title });

    rawRecords.push({
      refId,
      key,
      aliases: [key],
      sourceFormat: "bibtex",
      entryType,
      doi,
      pmcid,
      arxivId,
      title,
      authors: parsedAuthors.authors,
      ...(parsedAuthors.firstAuthorFamily !== undefined
        ? { firstAuthorFamily: parsedAuthors.firstAuthorFamily }
        : {}),
      ...(parsedAuthors.corporateAuthor !== undefined
        ? { corporateAuthor: parsedAuthors.corporateAuthor }
        : {}),
      ...(shortauthor !== undefined && shortauthor.length > 0 ? { shortauthor } : {}),
      ...(shorthand !== undefined && shorthand.length > 0 ? { shorthand } : {}),
      ...(year !== undefined ? { year } : {}),
      ...(venue !== undefined && venue.length > 0 ? { venue } : {}),
      raw: text.slice(atPos, bodyBounds.endPos + 1),
    });
  }

  const deduped = deduplicateBibRecords(rawRecords);
  return {
    records: deduped.records,
    skippedEntries,
    warnings,
    duplicateKeys: deduped.duplicateKeys,
  };
}

function splitLinesCrlf(text: string): string[] {
  const lines: string[] = [];
  let start = 0;
  const n = text.length;
  for (let i = 0; i < n; i += 1) {
    const cu = text.charCodeAt(i);
    if (cu === 10 || cu === 13) {
      lines.push(text.slice(start, i));
      if (cu === 13 && i + 1 < n && text.charCodeAt(i + 1) === 10) i += 1;
      start = i + 1;
    }
  }
  lines.push(text.slice(start));
  return lines;
}

function parseRisTagLine(line: string): { readonly tag: string; readonly value: string } | null {
  if (line.length < 6) return null;
  const c0 = line.charCodeAt(0);
  const c1 = line.charCodeAt(1);
  if (!isAsciiLetterCode(c0) || (!isAsciiLetterCode(c1) && !isAsciiDigitCode(c1))) return null;
  if (line.charCodeAt(2) !== 32 || line.charCodeAt(3) !== 32 || line.charCodeAt(4) !== 45 || line.charCodeAt(5) !== 32) {
    return null;
  }
  return {
    tag: asciiUpper(line.slice(0, 2)),
    value: line.slice(6).trim(),
  };
}

/**
 * Pure O(n) RIS parser (`TY  - ` .. `ER  - `).
 */
export function parseRis(text: string): BibParseResult {
  const lines = splitLinesCrlf(text);
  const rawRecords: IngestedBibRecord[] = [];
  const warnings: string[] = [];
  let skippedEntries = 0;

  let inRecord = false;
  let entryType = "article";
  let key = "";
  let title = "";
  let venue = "";
  let year: string | undefined;
  let doi: string | null = null;
  let pmcid: string | null = null;
  let arxivId: string | null = null;
  const authors: ParsedAuthor[] = [];
  let lastTag = "";
  let ordinal = 0;

  const flushRecord = (): void => {
    if (!inRecord) return;
    ordinal += 1;
    const assignedKey = key.length > 0 ? key : `ris_${String(ordinal)}`;
    if (title.length === 0 && doi === null && authors.length === 0) {
      skippedEntries += 1;
      warnings.push(`Skipped empty RIS record "${assignedKey}"`);
    } else {
      const refId = assignDeterministicRefId({ doi, pmcid, arxivId, key: assignedKey, title });
      const firstAuthor = authors[0];
      rawRecords.push({
        refId,
        key: assignedKey,
        aliases: [assignedKey],
        sourceFormat: "ris",
        entryType,
        orderIndex: ordinal,
        doi,
        pmcid,
        arxivId,
        title: norm(collapseSpaces(title)).text,
        authors: [...authors],
        ...(firstAuthor !== undefined && firstAuthor.family.length > 0
          ? { firstAuthorFamily: firstAuthor.family }
          : {}),
        ...(year !== undefined ? { year } : {}),
        ...(venue.length > 0 ? { venue: norm(collapseSpaces(venue)).text } : {}),
      });
    }
    inRecord = false;
    entryType = "article";
    key = "";
    title = "";
    venue = "";
    year = undefined;
    doi = null;
    pmcid = null;
    arxivId = null;
    authors.length = 0;
    lastTag = "";
  };

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (trimmed.length === 0) continue;

    const tagged = parseRisTagLine(rawLine);
    if (tagged === null) {
      if (inRecord && lastTag === "TI") {
        title = title.length > 0 ? `${title} ${trimmed}` : trimmed;
      }
      continue;
    }

    const { tag, value } = tagged;
    if (tag === "TY") {
      if (inRecord) flushRecord();
      inRecord = true;
      entryType = asciiLower(value || "article");
      lastTag = tag;
      continue;
    }
    if (!inRecord) {
      skippedEntries += 1;
      warnings.push(`Ignoring RIS tag "${tag}" outside TY..ER record`);
      continue;
    }
    if (tag === "ER") {
      flushRecord();
      continue;
    }
    lastTag = tag;

    if (tag === "ID" || tag === "AN") {
      if (key.length === 0 && value.length > 0) key = value;
      if (tag === "AN" && pmcid === null) pmcid = normalizePmcid(value);
    } else if (tag === "AU" || tag === "A1") {
      if (value.length > 0) authors.push(parseSinglePersonalAuthor(value));
    } else if (tag === "TI" || tag === "T1" || tag === "CT") {
      if (title.length === 0) title = value;
    } else if (tag === "PY" || tag === "Y1" || tag === "DA") {
      if (year === undefined) year = extractFirstYearWithSuffix(value);
    } else if (tag === "DO") {
      if (doi === null) doi = normalizeDoiVerbatim(value);
    } else if (tag === "UR") {
      if (doi === null) doi = normalizeDoiVerbatim(value);
      if (pmcid === null) pmcid = normalizePmcid(value);
      if (arxivId === null) arxivId = normalizeArxivId(value);
    } else if (tag === "JO" || tag === "JF" || tag === "T2" || tag === "JA") {
      if (venue.length === 0) venue = value;
    }
  }
  if (inRecord) {
    flushRecord();
  }

  const deduped = deduplicateBibRecords(rawRecords);
  return {
    records: deduped.records,
    skippedEntries,
    warnings,
    duplicateKeys: deduped.duplicateKeys,
  };
}

function asNonEmptyString(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

/**
 * Pure CSL-JSON parser accepting raw JSON string, array of CSL items, or `{ items: [...] }`.
 */
export function parseCslJson(textOrData: string | unknown): BibParseResult {
  let parsed: unknown = textOrData;
  if (typeof textOrData === "string") {
    try {
      parsed = JSON.parse(textOrData);
    } catch {
      return {
        records: [],
        skippedEntries: 1,
        warnings: ["Malformed CSL-JSON input"],
        duplicateKeys: [],
      };
    }
  }

  let itemsRaw: unknown[] = [];
  if (Array.isArray(parsed)) {
    itemsRaw = parsed;
  } else if (
    typeof parsed === "object" &&
    parsed !== null &&
    Array.isArray((parsed as { readonly items?: unknown }).items)
  ) {
    itemsRaw = (parsed as { readonly items: unknown[] }).items;
  } else if (typeof parsed === "object" && parsed !== null) {
    itemsRaw = [parsed];
  } else {
    return {
      records: [],
      skippedEntries: 1,
      warnings: ["CSL-JSON root must be an array or object"],
      duplicateKeys: [],
    };
  }

  const rawRecords: IngestedBibRecord[] = [];
  const warnings: string[] = [];
  let skippedEntries = 0;

  for (let idx = 0; idx < itemsRaw.length; idx += 1) {
    const item = itemsRaw[idx];
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      skippedEntries += 1;
      warnings.push(`Skipped non-object CSL-JSON item at index ${String(idx)}`);
      continue;
    }
    const obj = item as Record<string, unknown>;
    const rawId = asNonEmptyString(obj["id"]) ?? asNonEmptyString(obj["citation-key"]);
    const rawDoi = asNonEmptyString(obj["DOI"]) ?? asNonEmptyString(obj["doi"]) ?? "";
    const rawUrl = asNonEmptyString(obj["URL"]) ?? asNonEmptyString(obj["url"]) ?? "";
    const doi = normalizeDoiVerbatim(rawDoi) ?? normalizeDoiVerbatim(rawUrl);
    const pmcid = normalizePmcid(asNonEmptyString(obj["PMCID"]) ?? rawUrl);
    const arxivId = normalizeArxivId(asNonEmptyString(obj["arXiv"]) ?? rawUrl);
    const title = norm(collapseSpaces(asNonEmptyString(obj["title"]) ?? "")).text;
    const venue = asNonEmptyString(obj["container-title"]) ?? undefined;
    const entryType = asciiLower(asNonEmptyString(obj["type"]) ?? "article");

    let year: string | undefined;
    const issued = obj["issued"];
    if (typeof issued === "object" && issued !== null && !Array.isArray(issued)) {
      const issuedObj = issued as Record<string, unknown>;
      const dp = issuedObj["date-parts"];
      if (Array.isArray(dp) && Array.isArray(dp[0]) && dp[0].length > 0) {
        const yNum = dp[0][0];
        if (typeof yNum === "number" || typeof yNum === "string") {
          year = extractFirstYearWithSuffix(String(yNum));
        }
      }
      if (year === undefined) {
        const rawIssued = asNonEmptyString(issuedObj["raw"]) ?? asNonEmptyString(issuedObj["literal"]);
        if (rawIssued !== null) year = extractFirstYearWithSuffix(rawIssued);
      }
    }

    const authors: ParsedAuthor[] = [];
    let corporateAuthor: string | undefined;
    const rawAuthors = obj["author"];
    if (Array.isArray(rawAuthors)) {
      for (let aIdx = 0; aIdx < rawAuthors.length; aIdx += 1) {
        const au = rawAuthors[aIdx];
        if (typeof au !== "object" || au === null || Array.isArray(au)) continue;
        const auObj = au as Record<string, unknown>;
        const literal = asNonEmptyString(auObj["literal"]);
        if (literal !== null) {
          const normLit = norm(literal).text;
          if (aIdx === 0) corporateAuthor = normLit;
          authors.push({ family: normLit, literal: normLit, isCorporate: true });
          continue;
        }
        const particle = asNonEmptyString(auObj["non-dropping-particle"]);
        const famBase = asNonEmptyString(auObj["family"]);
        const given = asNonEmptyString(auObj["given"]) ?? undefined;
        if (famBase !== null) {
          const family = norm(particle !== null ? `${particle} ${famBase}` : famBase).text;
          authors.push(given !== undefined ? { family, given: norm(given).text } : { family });
        }
      }
    }

    const key = rawId ?? (doi !== null ? doi : `csl_${String(idx + 1)}`);
    if (title.length === 0 && doi === null && authors.length === 0 && rawId === null) {
      skippedEntries += 1;
      warnings.push(`Skipped empty CSL-JSON item at index ${String(idx)}`);
      continue;
    }

    const first = authors[0];
    const refId = assignDeterministicRefId({ doi, pmcid, arxivId, key, title });
    rawRecords.push({
      refId,
      key,
      aliases: [key],
      sourceFormat: "csl_json",
      entryType,
      orderIndex: idx + 1,
      doi,
      pmcid,
      arxivId,
      title,
      authors,
      ...(first !== undefined && !first.isCorporate && first.family.length > 0
        ? { firstAuthorFamily: first.family }
        : {}),
      ...(corporateAuthor !== undefined ? { corporateAuthor } : {}),
      ...(year !== undefined ? { year } : {}),
      ...(venue !== undefined ? { venue: norm(venue).text } : {}),
    });
  }

  const deduped = deduplicateBibRecords(rawRecords);
  return {
    records: deduped.records,
    skippedEntries,
    warnings,
    duplicateKeys: deduped.duplicateKeys,
  };
}

function scanEmbeddedDoi(text: string): string | null {
  let pos = 0;
  while (pos < text.length) {
    const idx = text.indexOf("10.", pos);
    if (idx === -1) return null;
    if (idx > 0 && isAsciiDigitCode(text.charCodeAt(idx - 1))) {
      pos = idx + 3;
      continue;
    }
    let end = idx + 3;
    while (end < text.length) {
      const cu = text.charCodeAt(end);
      if (isWhitespaceCode(cu) || cu === 34 || cu === 60 || cu === 62 || cu === 123 || cu === 125) {
        break;
      }
      end += 1;
    }
    let cand = text.slice(idx, end);
    while (
      cand.endsWith(".") ||
      cand.endsWith(",") ||
      cand.endsWith(";") ||
      cand.endsWith(")") ||
      cand.endsWith("]") ||
      cand.endsWith("}")
    ) {
      cand = cand.slice(0, cand.length - 1);
    }
    if (isValidDoi(cand)) return cand;
    pos = idx + 3;
  }
  return null;
}

/**
 * Extracts ordered `\bibitem[label]{key} text` records from `thebibliography` in LaTeX source
 * or from a standalone `.bbl` file (`03` §5.2 step 6).
 */
export function parseBibItems(source: string): BibParseResult {
  const masked = preMask(source, "latex");
  let items = masked.bibItems;

  // Fallback for standalone .bbl fragments that omit \begin{thebibliography}
  if (items.length === 0 && source.includes("\\bibitem")) {
    const wrapped = `\\begin{thebibliography}{99}\n${source}\n\\end{thebibliography}`;
    items = preMask(wrapped, "latex").bibItems;
  }

  const rawRecords: IngestedBibRecord[] = [];
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i]!;
    const cleaned = decodeLatexBibText(item.text);
    const doi = scanEmbeddedDoi(item.text) ?? scanEmbeddedDoi(cleaned);
    const year = extractFirstYearWithSuffix(cleaned);
    const refId = assignDeterministicRefId({ doi, key: item.key, raw: cleaned });
    rawRecords.push({
      refId,
      key: item.key,
      aliases: [item.key],
      sourceFormat: "bibitem",
      entryType: "bibitem",
      orderIndex: i + 1,
      doi,
      pmcid: null,
      arxivId: null,
      title: cleaned,
      authors: [],
      ...(year !== undefined ? { year } : {}),
      raw: item.text,
    });
  }

  const deduped = deduplicateBibRecords(rawRecords);
  return {
    records: deduped.records,
    skippedEntries: 0,
    warnings: [],
    duplicateKeys: deduped.duplicateKeys,
  };
}

function mergeRecordFields(existing: IngestedBibRecord, incoming: IngestedBibRecord): IngestedBibRecord {
  const aliases = [...existing.aliases];
  for (const a of incoming.aliases) {
    if (!aliases.includes(a)) aliases.push(a);
  }
  return {
    ...existing,
    aliases,
    doi: existing.doi ?? incoming.doi,
    pmcid: existing.pmcid ?? incoming.pmcid,
    arxivId: existing.arxivId ?? incoming.arxivId,
    title: existing.title.length > 0 ? existing.title : incoming.title,
    authors: existing.authors.length > 0 ? existing.authors : incoming.authors,
    ...(existing.firstAuthorFamily !== undefined || incoming.firstAuthorFamily !== undefined
      ? { firstAuthorFamily: existing.firstAuthorFamily ?? incoming.firstAuthorFamily }
      : {}),
    ...(existing.corporateAuthor !== undefined || incoming.corporateAuthor !== undefined
      ? { corporateAuthor: existing.corporateAuthor ?? incoming.corporateAuthor }
      : {}),
    ...(existing.shortauthor !== undefined || incoming.shortauthor !== undefined
      ? { shortauthor: existing.shortauthor ?? incoming.shortauthor }
      : {}),
    ...(existing.shorthand !== undefined || incoming.shorthand !== undefined
      ? { shorthand: existing.shorthand ?? incoming.shorthand }
      : {}),
    ...(existing.year !== undefined || incoming.year !== undefined
      ? { year: existing.year ?? incoming.year }
      : {}),
    ...(existing.venue !== undefined || incoming.venue !== undefined
      ? { venue: existing.venue ?? incoming.venue }
      : {}),
    ...(existing.orderIndex !== undefined || incoming.orderIndex !== undefined
      ? { orderIndex: existing.orderIndex ?? incoming.orderIndex }
      : {}),
    ...(existing.raw !== undefined || incoming.raw !== undefined
      ? { raw: existing.raw ?? incoming.raw }
      : {}),
  };
}

/**
 * Deduplicates ingested records by canonical `refId` first, then by exact citation `key`.
 */
export function deduplicateBibRecords(records: readonly IngestedBibRecord[]): {
  readonly records: readonly IngestedBibRecord[];
  readonly duplicateCount: number;
  readonly duplicateKeys: readonly string[];
} {
  const out: IngestedBibRecord[] = [];
  const byRefId = new Map<string, number>();
  const byKey = new Map<string, number>();
  const duplicateKeys: string[] = [];
  let duplicateCount = 0;

  for (const rec of records) {
    const refHit = byRefId.get(rec.refId);
    const keyHit = byKey.get(rec.key);
    const hitIdx = refHit ?? keyHit;
    if (hitIdx !== undefined) {
      out[hitIdx] = mergeRecordFields(out[hitIdx]!, rec);
      duplicateCount += 1;
      if (!duplicateKeys.includes(rec.key)) duplicateKeys.push(rec.key);
      if (!byKey.has(rec.key)) byKey.set(rec.key, hitIdx);
      if (!byRefId.has(rec.refId)) byRefId.set(rec.refId, hitIdx);
    } else {
      const idx = out.length;
      out.push(rec);
      byRefId.set(rec.refId, idx);
      byKey.set(rec.key, idx);
    }
  }

  return { records: out, duplicateCount, duplicateKeys };
}

/**
 * Converts ingested bibliography records into Tier A `BibliographyEntry[]` compatible
 * with `resolveCitationMarkers` (`02` §5.4).
 */
export function toBibliographyEntries(records: readonly IngestedBibRecord[]): BibliographyEntry[] {
  const out: BibliographyEntry[] = [];
  for (const rec of records) {
    const entryKeys = rec.aliases.length > 0 ? rec.aliases : [rec.key];
    for (const k of entryKeys) {
      out.push({
        refId: rec.refId,
        key: k,
        ...(rec.orderIndex !== undefined ? { orderIndex: rec.orderIndex } : {}),
        ...(rec.firstAuthorFamily !== undefined ? { firstAuthorFamily: rec.firstAuthorFamily } : {}),
        ...(rec.corporateAuthor !== undefined ? { corporateAuthor: rec.corporateAuthor } : {}),
        ...(rec.shortauthor !== undefined ? { shortauthor: rec.shortauthor } : {}),
        ...(rec.shorthand !== undefined ? { shorthand: rec.shorthand } : {}),
        ...(rec.year !== undefined ? { year: rec.year } : {}),
      });
    }
  }
  return out;
}

export function sortBibRecordsByRefId(records: readonly IngestedBibRecord[]): IngestedBibRecord[] {
  return [...records].sort((a, b) => compareCodeUnits(a.refId, b.refId));
}
