import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");
const CORE_L0_DIR = resolve(REPO_ROOT, "packages", "core-l0");

const UNICODE_15_1_URLS = {
  unicodeData: "https://www.unicode.org/Public/15.1.0/ucd/UnicodeData.txt",
  compositionExclusions: "https://www.unicode.org/Public/15.1.0/ucd/CompositionExclusions.txt",
  scripts: "https://www.unicode.org/Public/15.1.0/ucd/Scripts.txt",
  emojiData: "https://www.unicode.org/Public/15.1.0/ucd/emoji/emoji-data.txt",
  confusables: "https://www.unicode.org/Public/security/15.1.0/confusables.txt",
  adobeSymbol: "https://www.unicode.org/Public/MAPPINGS/VENDORS/ADOBE/symbol.txt"
} as const;

const GENERAL_CATEGORIES = [
  "Cn", "Lu", "Ll", "Lt", "Lm", "Lo",
  "Mn", "Mc", "Me",
  "Nd", "Nl", "No",
  "Pc", "Pd", "Ps", "Pe", "Pi", "Pf", "Po",
  "Sm", "Sc", "Sk", "So",
  "Zs", "Zl", "Zp",
  "Cc", "Cf", "Cs", "Co"
] as const;

type GeneralCategory = (typeof GENERAL_CATEGORIES)[number];

const CAT_TO_CODE = new Map<GeneralCategory, number>(
  GENERAL_CATEGORIES.map((cat, idx) => [cat, idx])
);

const MAX_CODE_POINT = 0x10ffff;

interface UcdEntry {
  cat: GeneralCategory;
  ccc: number;
  decompTag: string | null;
  decompCps: number[];
  simpleLower: number | null;
  name: string;
}

function parseCliArgs(argv: string[]): { ucdDir: string | null } {
  let ucdDir: string | null = null;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--ucd-dir" && i + 1 < argv.length) {
      ucdDir = argv[i + 1] ?? null;
      i += 1;
    }
  }
  return { ucdDir };
}

async function loadTextSource(
  localDir: string | null,
  fileName: string,
  url: string
): Promise<string> {
  if (localDir !== null) {
    return readFileSync(resolve(localDir, fileName), "utf8");
  }
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${resp.status} ${resp.statusText}`);
  }
  return await resp.text();
}

function parseUnicodeData(raw: string): UcdEntry[] {
  const table: UcdEntry[] = new Array<UcdEntry>(MAX_CODE_POINT + 1);
  const defaultEntry: UcdEntry = {
    cat: "Cn",
    ccc: 0,
    decompTag: null,
    decompCps: [],
    simpleLower: null,
    name: ""
  };
  for (let cp = 0; cp <= MAX_CODE_POINT; cp += 1) {
    table[cp] = defaultEntry;
  }

  const lines = raw.split(/\r?\n/);
  const parsedLines: Array<{ cp: number; fields: string[] }> = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const fields = line.split(";");
    if (fields.length < 15) continue;
    const cp = Number.parseInt(fields[0] ?? "", 16);
    if (!Number.isFinite(cp)) continue;
    parsedLines.push({ cp, fields });
  }

  for (let i = 0; i < parsedLines.length; i += 1) {
    const cur = parsedLines[i]!;
    const cp = cur.cp;
    const f = cur.fields;
    const name = f[1] ?? "";
    const cat = (f[2] ?? "Cn") as GeneralCategory;
    if (!CAT_TO_CODE.has(cat)) {
      throw new Error(`Unknown Unicode general category "${cat}" at U+${cp.toString(16)}`);
    }
    const ccc = Number.parseInt(f[3] ?? "0", 10) || 0;
    const decompField = (f[5] ?? "").trim();
    let decompTag: string | null = null;
    const decompCps: number[] = [];
    if (decompField.length > 0) {
      const parts = decompField.split(/\s+/);
      for (const part of parts) {
        if (part.startsWith("<") && part.endsWith(">")) {
          decompTag = part;
        } else if (part.length > 0) {
          decompCps.push(Number.parseInt(part, 16));
        }
      }
    }
    const lowerHex = (f[13] ?? "").trim();
    const simpleLower = lowerHex.length > 0 ? Number.parseInt(lowerHex, 16) : null;

    if (name.endsWith(", First>")) {
      const next = parsedLines[i + 1];
      if (!next || !(next.fields[1] ?? "").endsWith(", Last>")) {
        throw new Error(`Unmatched range start at U+${cp.toString(16)} (${name})`);
      }
      const endCp = next.cp;
      const rangeEntry: UcdEntry = {
        cat,
        ccc,
        decompTag: null,
        decompCps: [],
        simpleLower: null,
        name
      };
      for (let c = cp; c <= endCp; c += 1) {
        table[c] = rangeEntry;
      }
      i += 1;
    } else {
      table[cp] = {
        cat,
        ccc,
        decompTag,
        decompCps,
        simpleLower,
        name
      };
    }
  }

  return table;
}

function parseCompositionExclusions(raw: string): Set<number> {
  const excluded = new Set<number>();
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.split("#")[0]?.trim() ?? "";
    if (!line) continue;
    const cp = Number.parseInt(line, 16);
    if (Number.isFinite(cp)) {
      excluded.add(cp);
    }
  }
  return excluded;
}

function buildUnicode151Bin(ucd: UcdEntry[]): Buffer {
  const catRuns: Array<{ start: number; end: number; catCode: number }> = [];
  let runStart = -1;
  let runCatCode = 0;

  for (let cp = 0; cp <= MAX_CODE_POINT; cp += 1) {
    const catCode = CAT_TO_CODE.get(ucd[cp]!.cat) ?? 0;
    if (catCode !== 0) {
      if (runStart === -1) {
        runStart = cp;
        runCatCode = catCode;
      } else if (catCode !== runCatCode) {
        catRuns.push({ start: runStart, end: cp - 1, catCode: runCatCode });
        runStart = cp;
        runCatCode = catCode;
      }
    } else if (runStart !== -1) {
      catRuns.push({ start: runStart, end: cp - 1, catCode: runCatCode });
      runStart = -1;
      runCatCode = 0;
    }
  }
  if (runStart !== -1) {
    catRuns.push({ start: runStart, end: MAX_CODE_POINT, catCode: runCatCode });
  }

  const lowerPairs: Array<{ src: number; dst: number }> = [];
  for (let cp = 0; cp <= MAX_CODE_POINT; cp += 1) {
    const low = ucd[cp]!.simpleLower;
    if (low !== null && low !== cp) {
      lowerPairs.push({ src: cp, dst: low });
    }
  }

  const totalBytes = 16 + catRuns.length * 8 + lowerPairs.length * 8;
  const buf = Buffer.alloc(totalBytes);
  // Magic "U151"
  buf.write("U151", 0, 4, "ascii");
  buf.writeUInt16LE(1, 4); // version = 1
  buf.writeUInt16LE(0, 6); // reserved = 0
  buf.writeUInt32LE(catRuns.length, 8);
  buf.writeUInt32LE(lowerPairs.length, 12);

  let offset = 16;
  for (const run of catRuns) {
    const word0 = ((run.start & 0x1fffff) | (run.catCode << 24)) >>> 0;
    buf.writeUInt32LE(word0, offset);
    buf.writeUInt32LE(run.end >>> 0, offset + 4);
    offset += 8;
  }

  for (const pair of lowerPairs) {
    buf.writeUInt32LE(pair.src >>> 0, offset);
    buf.writeUInt32LE(pair.dst >>> 0, offset + 4);
    offset += 8;
  }

  return buf;
}

function canonicalDecompose(cp: number, ucd: UcdEntry[]): number[] {
  const entry = ucd[cp]!;
  if (entry.decompTag === null && entry.decompCps.length > 0) {
    const out: number[] = [];
    for (const sub of entry.decompCps) {
      out.push(...canonicalDecompose(sub, ucd));
    }
    return out;
  }
  return [cp];
}

function canonicalReorder(cps: number[], ucd: UcdEntry[]): number[] {
  const arr = [...cps];
  let swapped = true;
  while (swapped) {
    swapped = false;
    for (let i = 0; i + 1 < arr.length; i += 1) {
      const cccA = ucd[arr[i]!]!.ccc;
      const cccB = ucd[arr[i + 1]!]!.ccc;
      if (cccB !== 0 && cccA > cccB) {
        const tmp = arr[i]!;
        arr[i] = arr[i + 1]!;
        arr[i + 1] = tmp;
        swapped = true;
      }
    }
  }
  return arr;
}

function buildCanonicalPairMap(
  ucd: UcdEntry[],
  exclusions: Set<number>
): Map<string, number> {
  const pairs = new Map<string, number>();
  for (let cp = 0; cp <= MAX_CODE_POINT; cp += 1) {
    const e = ucd[cp]!;
    if (e.decompTag === null && e.decompCps.length === 2 && !exclusions.has(cp)) {
      const starter = e.decompCps[0]!;
      const combiner = e.decompCps[1]!;
      if (ucd[starter]!.ccc === 0) {
        pairs.set(`${starter},${combiner}`, cp);
      }
    }
  }
  return pairs;
}

function canonicalComposeSequence(
  cps: number[],
  ucd: UcdEntry[],
  pairMap: Map<string, number>
): number[] {
  const decomposed: number[] = [];
  for (const cp of cps) {
    decomposed.push(...canonicalDecompose(cp, ucd));
  }
  const reordered = canonicalReorder(decomposed, ucd);
  if (reordered.length === 0) return [];
  const out: number[] = [reordered[0]!];
  let starterIdx = 0;
  let lastClass = ucd[reordered[0]!]!.ccc === 0 ? 0 : 256;

  for (let i = 1; i < reordered.length; i += 1) {
    const ch = reordered[i]!;
    const chClass = ucd[ch]!.ccc;
    const starter = out[starterIdx]!;
    const composed =
      ucd[starter]!.ccc === 0 && (lastClass < chClass || lastClass === 0)
        ? pairMap.get(`${starter},${ch}`)
        : undefined;
    if (composed !== undefined) {
      out[starterIdx] = composed;
    } else {
      if (chClass === 0) {
        starterIdx = out.length;
      }
      lastClass = chClass;
      out.push(ch);
    }
  }
  return out;
}

function cpsToString(cps: number[]): string {
  return String.fromCodePoint(...cps);
}

function buildLatinComposeTable(
  ucd: UcdEntry[],
  exclusions: Set<number>
): Record<string, string> {
  const pairMap = buildCanonicalPairMap(ucd, exclusions);
  const latinRanges: Array<[number, number]> = [
    [0x0080, 0x00ff], // Latin-1 Supplement
    [0x0100, 0x017f], // Latin Extended-A
    [0x0180, 0x024f], // Latin Extended-B
    [0x1e00, 0x1eff]  // Latin Extended Additional
  ];
  const isInTargetLatinBlocks = (cp: number): boolean =>
    latinRanges.some(([start, end]) => cp >= start && cp <= end);

  // Collect all Latin base letters and all marks in U+0300..U+036F participating in
  // canonical Latin compositions (including U+0340, U+0341, U+0344 mark decompositions).
  const usefulMarksSet = new Set<number>();
  const latinBasesSet = new Set<number>();
  for (let cp = 0x41; cp <= 0x5a; cp += 1) latinBasesSet.add(cp);
  for (let cp = 0x61; cp <= 0x7a; cp += 1) latinBasesSet.add(cp);

  for (const [start, end] of latinRanges) {
    for (let cp = start; cp <= end; cp += 1) {
      if (ucd[cp]!.cat.startsWith("L")) {
        latinBasesSet.add(cp);
      }
      const e = ucd[cp]!;
      if (e.decompTag !== null || e.decompCps.length === 0) continue;
      const nfd = canonicalReorder(canonicalDecompose(cp, ucd), ucd);
      if (nfd.length < 2) continue;

      const composed = canonicalComposeSequence(nfd, ucd, pairMap);
      if (composed.length !== 1 || composed[0] !== cp) continue;

      const base = nfd[0]!;
      const marks = nfd.slice(1);
      if (!marks.every((m) => m >= 0x0300 && m <= 0x036f)) continue;
      if (ucd[base]!.cat.startsWith("L")) {
        latinBasesSet.add(base);
      }
      for (const m of marks) {
        usefulMarksSet.add(m);
      }
    }
  }

  for (let m = 0x0300; m <= 0x036f; m += 1) {
    const decomp = canonicalDecompose(m, ucd);
    if (decomp.length > 0 && decomp.every((c) => usefulMarksSet.has(c))) {
      usefulMarksSet.add(m);
    }
  }

  const usefulMarks = Array.from(usefulMarksSet).sort((a, b) => a - b);
  const latinBases = Array.from(latinBasesSet).sort((a, b) => a - b);
  const entries = new Map<string, string>();

  for (const base of latinBases) {
    for (const m1 of usefulMarks) {
      const seq1 = [base, m1];
      const c1 = canonicalComposeSequence(seq1, ucd, pairMap);
      if (c1.length === 1 && isInTargetLatinBlocks(c1[0]!)) {
        entries.set(cpsToString(seq1), String.fromCodePoint(c1[0]!));
      }
      for (const m2 of usefulMarks) {
        const seq2 = [base, m1, m2];
        const c2 = canonicalComposeSequence(seq2, ucd, pairMap);
        if (c2.length === 1 && isInTargetLatinBlocks(c2[0]!)) {
          entries.set(cpsToString(seq2), String.fromCodePoint(c2[0]!));
        }
      }
    }
  }

  return sortRecordByKeys(entries);
}

function buildStage2Map(): Record<string, string> {
  const entries = new Map<string, string>();

  // Spaces -> U+0020 (02 §2.2.2)
  const spaceCps = [
    0x00a0,
    0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a,
    0x202f, 0x205f, 0x3000
  ];
  for (const cp of spaceCps) {
    entries.set(String.fromCodePoint(cp), " ");
  }

  // Hyphens, dashes and minus signs -> "-"
  const dashCps = [
    0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2015,
    0x2212, 0xfe58, 0xfe63, 0xff0d
  ];
  for (const cp of dashCps) {
    entries.set(String.fromCodePoint(cp), "-");
  }

  // Soft hyphen & unconditional zero-width / BOM deletions
  for (const cp of [0x00ad, 0x200b, 0x2060, 0xfeff]) {
    entries.set(String.fromCodePoint(cp), "");
  }

  // Single quotes and prime -> "'"
  for (const cp of [0x2018, 0x2019, 0x201a, 0x201b, 0x2032]) {
    entries.set(String.fromCodePoint(cp), "'");
  }

  // Double quotes and double prime -> '"'
  for (const cp of [0x201c, 0x201d, 0x201e, 0x2033]) {
    entries.set(String.fromCodePoint(cp), '"');
  }

  // Multiplication dots (U+00B7 decimal vs × context is applied in norm(); U+00B7 default is ×)
  entries.set("\u00b7", "×");
  entries.set("\u22c5", "×");

  // Micro sign -> Greek small letter mu (U+03BC)
  entries.set("\u00b5", "\u03bc");

  // Superscripts -> "^" + ASCII digit/sign
  const superMap: Array<[number, string]> = [
    [0x2070, "^0"],
    [0x00b9, "^1"],
    [0x00b2, "^2"],
    [0x00b3, "^3"],
    [0x2074, "^4"],
    [0x2075, "^5"],
    [0x2076, "^6"],
    [0x2077, "^7"],
    [0x2078, "^8"],
    [0x2079, "^9"],
    [0x207a, "^+"],
    [0x207b, "^-"]
  ];
  for (const [cp, target] of superMap) {
    entries.set(String.fromCodePoint(cp), target);
  }

  // Subscript digits -> ASCII digit
  for (let d = 0; d <= 9; d += 1) {
    entries.set(String.fromCodePoint(0x2080 + d), String(d));
  }

  // Ellipsis
  entries.set("\u2026", "...");

  // PDF ligatures
  entries.set("\ufb00", "ff");
  entries.set("\ufb01", "fi");
  entries.set("\ufb02", "fl");
  entries.set("\ufb03", "ffi");
  entries.set("\ufb04", "ffl");

  // Full-width ASCII U+FF01..U+FF5E -> U+0021..U+007E
  for (let cp = 0xff01; cp <= 0xff5e; cp += 1) {
    entries.set(String.fromCodePoint(cp), String.fromCodePoint(cp - 0xfee0));
  }

  // Fraction slash & vulgar fractions
  entries.set("\u2044", "/");
  entries.set("\u00bd", "1/2");
  entries.set("\u00bc", "1/4");
  entries.set("\u00be", "3/4");

  // Lone CR -> LF (CRLF handled before single-code-point map)
  entries.set("\r", "\n");

  return sortRecordByKeys(entries);
}

function isAsciiLetterCp(cp: number): boolean {
  return (cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a);
}

function buildLatinFoldTable(ucd: UcdEntry[]): Record<string, string> {
  const entries = new Map<string, string>();
  const latinRanges: Array<[number, number]> = [
    [0x00c0, 0x00ff],
    [0x0100, 0x017f],
    [0x0180, 0x024f],
    [0x1e00, 0x1eff],
    [0x2c60, 0x2c7f],
    [0xa720, 0xa7ff],
    [0xab30, 0xab6f]
  ];

  for (const [start, end] of latinRanges) {
    for (let cp = start; cp <= end; cp += 1) {
      const cat = ucd[cp]!.cat;
      if (!cat.startsWith("L")) continue;
      const nfd = canonicalDecompose(cp, ucd);
      if (nfd.length > 0 && isAsciiLetterCp(nfd[0]!)) {
        const restAllMarks = nfd.slice(1).every((c) => {
          const cCat = ucd[c]!.cat;
          return cCat === "Mn" || cCat === "Mc" || cCat === "Me";
        });
        if (restAllMarks && nfd[0] !== cp) {
          entries.set(String.fromCodePoint(cp), String.fromCodePoint(nfd[0]!));
        }
      }
    }
  }

  // Non-decomposable stroked, hooked, and ligature Latin letters (preserving case)
  const explicitPairs: Array<[number, string]> = [
    [0x00c6, "AE"], [0x00e6, "ae"],
    [0x00d0, "D"],  [0x00f0, "d"],
    [0x00d8, "O"],  [0x00f8, "o"],
    [0x00de, "Th"], [0x00fe, "th"],
    [0x00df, "ss"], [0x1e9e, "SS"],
    [0x0110, "D"],  [0x0111, "d"],
    [0x0126, "H"],  [0x0127, "h"],
    [0x0131, "i"],
    [0x0132, "IJ"], [0x0133, "ij"],
    [0x0138, "k"],
    [0x013f, "L"],  [0x0140, "l"],
    [0x0141, "L"],  [0x0142, "l"],
    [0x0149, "n"],
    [0x014a, "N"],  [0x014b, "n"],
    [0x0152, "OE"], [0x0153, "oe"],
    [0x0166, "T"],  [0x0167, "t"],
    [0x017f, "s"],
    [0x0180, "b"],  [0x0181, "B"],
    [0x0187, "C"],  [0x0188, "c"],
    [0x0189, "D"],  [0x018a, "D"],
    [0x0191, "F"],  [0x0192, "f"],
    [0x0193, "G"],  [0x0197, "I"],
    [0x0198, "K"],  [0x0199, "k"],
    [0x019a, "l"],
    [0x019d, "N"],  [0x019e, "n"],
    [0x019f, "O"],
    [0x01a4, "P"],  [0x01a5, "p"],
    [0x01ab, "t"],
    [0x01ac, "T"],  [0x01ad, "t"],
    [0x01ae, "T"],
    [0x01b2, "V"],
    [0x01b3, "Y"],  [0x01b4, "y"],
    [0x01b5, "Z"],  [0x01b6, "z"],
    [0x01e4, "G"],  [0x01e5, "g"],
    [0x01fc, "AE"], [0x01fd, "ae"],
    [0x01fe, "O"],  [0x01ff, "o"],
    [0x0237, "j"],
    [0x023a, "A"],  [0x2c65, "a"],
    [0x023b, "C"],  [0x023c, "c"],
    [0x023d, "L"],  [0x019a, "l"],
    [0x023e, "T"],  [0x2c66, "t"],
    [0x0246, "E"],  [0x0247, "e"],
    [0x0248, "J"],  [0x0249, "j"],
    [0x024a, "Q"],  [0x024b, "q"],
    [0x024c, "R"],  [0x024d, "r"],
    [0x024e, "Y"],  [0x024f, "y"]
  ];
  for (const [cp, target] of explicitPairs) {
    entries.set(String.fromCodePoint(cp), target);
  }

  return sortRecordByKeys(entries);
}

function buildCompatFoldTable(ucd: UcdEntry[]): Record<string, string> {
  const allowedTags = new Set([
    "<font>",
    "<circle>",
    "<square>",
    "<super>",
    "<sub>",
    "<small>",
    "<wide>",
    "<narrow>"
  ]);

  function expandTagDecomp(cp: number, seen = new Set<number>()): number[] {
    if (seen.has(cp)) return [cp];
    const e = ucd[cp]!;
    if (e.decompCps.length > 0 && (e.decompTag === null || allowedTags.has(e.decompTag))) {
      seen.add(cp);
      const out: number[] = [];
      for (const sub of e.decompCps) {
        out.push(...expandTagDecomp(sub, new Set(seen)));
      }
      return out;
    }
    return [cp];
  }

  function applySimpleLowerAndStripMarks(cps: number[]): number[] {
    const out: number[] = [];
    for (const c of cps) {
      const low = ucd[c]!.simpleLower ?? c;
      const cat = ucd[low]!.cat;
      if (cat === "Mn" || cat === "Me") continue;
      out.push(low);
    }
    return out;
  }

  const entries = new Map<string, string>();
  for (let cp = 0; cp <= MAX_CODE_POINT; cp += 1) {
    const e = ucd[cp]!;
    if (e.decompTag !== null && allowedTags.has(e.decompTag)) {
      const expanded = applySimpleLowerAndStripMarks(expandTagDecomp(cp));
      const target = cpsToString(expanded);
      entries.set(String.fromCodePoint(cp), target);
    }
  }

  // Small capitals U+1D00..U+1D2B and IPA / negative enclosed alphanumerics lacking UnicodeData decomp tags
  const extraCompat: Array<[number, string]> = [
    [0x1d00, "a"], [0x1d01, "ae"], [0x1d03, "b"], [0x1d04, "c"], [0x1d05, "d"],
    [0x1d06, "ð"], [0x1d07, "e"],  [0x1d0a, "j"], [0x1d0b, "k"], [0x1d0c, "ł"],
    [0x1d0d, "m"], [0x1d0e, "n"],  [0x1d0f, "o"], [0x1d18, "p"], [0x1d19, "r"],
    [0x1d1a, "r"], [0x1d1b, "t"],  [0x1d1c, "u"], [0x1d20, "v"], [0x1d21, "w"],
    [0x1d22, "z"], [0x1d23, "ʒ"],
    [0x1d26, "γ"], [0x1d27, "λ"],  [0x1d28, "π"], [0x1d29, "ρ"], [0x1d2a, "ψ"],
    [0x1d2b, "л"],
    [0x0262, "g"], [0x026a, "i"],  [0x0274, "n"], [0x0280, "r"], [0x028f, "y"],
    [0x0299, "b"], [0x029c, "h"],  [0x029f, "l"], [0xa730, "f"], [0xa731, "s"],
    [0xa7af, "q"]
  ];
  for (const [cp, target] of extraCompat) {
    entries.set(String.fromCodePoint(cp), target);
  }

  // Negative circled (U+1F150..U+1F169) and negative squared (U+1F170..U+1F189) Latin letters -> a..z
  for (let i = 0; i < 26; i += 1) {
    const ch = String.fromCodePoint(0x61 + i);
    entries.set(String.fromCodePoint(0x1f150 + i), ch);
    entries.set(String.fromCodePoint(0x1f170 + i), ch);
  }

  return sortRecordByKeys(entries);
}

function buildConfusablesTable(raw: string, ucd: UcdEntry[]): Record<string, string> {
  const entries = new Map<string, string>();
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.split("#")[0]?.trim() ?? "";
    if (!line) continue;
    const parts = line.split(";").map((p) => p.trim());
    if (parts.length < 2) continue;
    const srcCp = Number.parseInt(parts[0] ?? "", 16);
    if (!Number.isFinite(srcCp) || srcCp >= 0x1d200) continue; // exclude Greek vocal/instrumental notation symbols

    const dstHexes = (parts[1] ?? "").split(/\s+/).filter(Boolean);
    const dstCps = dstHexes.map((h) => Number.parseInt(h, 16));
    if (dstCps.length === 0 || !dstCps.every((c) => isAsciiLetterCp(c))) continue;

    const srcEntry = ucd[srcCp]!;
    if (!srcEntry.cat.startsWith("L")) continue;
    const name = srcEntry.name;
    if (!name.includes("CYRILLIC") && !name.includes("GREEK")) continue;

    // Lowercase ASCII skeleton for detectText (runs after normLower)
    const lowerTarget = cpsToString(dstCps.map((c) => (c >= 0x41 && c <= 0x5a ? c + 32 : c)));
    entries.set(String.fromCodePoint(srcCp), lowerTarget);
  }
  return sortRecordByKeys(entries);
}

function buildSymbolPuaTable(raw: string): Record<string, string> {
  const entries = new Map<string, string>();
  // Prefer canonical Greek Unicode code points over legacy compatibility duplicates in symbol.txt
  const preferredTargets = new Map<number, number>([
    [0xf044, 0x0394], // GREEK CAPITAL LETTER DELTA over U+2206 INCREMENT
    [0xf057, 0x03a9], // GREEK CAPITAL LETTER OMEGA over U+2126 OHM SIGN
    [0xf06d, 0x03bc]  // GREEK SMALL LETTER MU over U+00B5 MICRO SIGN
  ]);

  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.split("#")[0]?.trim() ?? "";
    if (!line) continue;
    const parts = line.split("\t");
    if (parts.length < 2) continue;
    const unicodeCp = Number.parseInt(parts[0] ?? "", 16);
    const symbolByte = Number.parseInt(parts[1] ?? "", 16);
    if (!Number.isFinite(unicodeCp) || !Number.isFinite(symbolByte)) continue;
    if (unicodeCp >= 0xe000 && unicodeCp <= 0xf8ff) continue; // skip corporate PUA glyphs

    const puaCp = 0xf000 + symbolByte;
    if (preferredTargets.has(puaCp)) {
      entries.set(String.fromCodePoint(puaCp), String.fromCodePoint(preferredTargets.get(puaCp)!));
    } else if (!entries.has(String.fromCodePoint(puaCp))) {
      entries.set(String.fromCodePoint(puaCp), String.fromCodePoint(unicodeCp));
    }
  }
  return sortRecordByKeys(entries);
}

function buildJoinerScriptRanges(scriptsRaw: string, emojiRaw: string): Array<[number, number]> {
  const targetScripts = new Set([
    "Arabic",
    "Hebrew",
    "Devanagari",
    "Bengali",
    "Tamil",
    "Telugu",
    "Kannada",
    "Malayalam",
    "Gurmukhi",
    "Gujarati",
    "Sinhala"
  ]);
  const rawRanges: Array<[number, number]> = [
    // Explicit Unicode 15.1.0 script blocks (covers Script=Inherited Arabic/Devanagari marks like 0640, 064B..0655, 0951..0952)
    [0x0590, 0x05ff], [0xfb1d, 0xfb4f], // Hebrew
    [0x0600, 0x061b], [0x061d, 0x06ff], [0x0750, 0x077f], [0x0870, 0x08ff],
    [0xfb50, 0xfdff], [0xfe70, 0xfefe], [0x10ec0, 0x10eff], [0x1ee00, 0x1eeff], // Arabic (excl. U+061C, U+FEFF)
    [0x0900, 0x097f], [0xa8e0, 0xa8ff], [0x11b00, 0x11b5f], // Devanagari
    [0x0980, 0x09ff], // Bengali
    [0x0a00, 0x0a7f], // Gurmukhi
    [0x0a80, 0x0aff], // Gujarati
    [0x0b80, 0x0bff], [0x11fc0, 0x11fff], // Tamil
    [0x0c00, 0x0c7f], // Telugu
    [0x0c80, 0x0cff], // Kannada
    [0x0d00, 0x0d7f], // Malayalam
    [0x0d80, 0x0dff], [0x111e0, 0x111ff] // Sinhala
  ];

  for (const rawLine of scriptsRaw.split(/\r?\n/)) {
    const line = rawLine.split("#")[0]?.trim() ?? "";
    if (!line) continue;
    const parts = line.split(";").map((p) => p.trim());
    if (parts.length < 2) continue;
    const scriptName = parts[1]!;
    if (!targetScripts.has(scriptName)) continue;
    const rng = parts[0]!;
    const [aStr, bStr] = rng.includes("..") ? rng.split("..") : [rng, rng];
    let a = Number.parseInt(aStr!, 16);
    const b = Number.parseInt(bStr!, 16);
    // Exclude U+061C (Arabic Letter Mark) and U+200C/U+200D
    if (a <= 0x061c && 0x061c <= b) {
      if (a < 0x061c) rawRanges.push([a, 0x061b]);
      a = 0x061d;
    }
    if (a <= b) rawRanges.push([a, b]);
  }

  for (const rawLine of emojiRaw.split(/\r?\n/)) {
    const line = rawLine.split("#")[0]?.trim() ?? "";
    if (!line) continue;
    const parts = line.split(";").map((p) => p.trim());
    if (parts.length < 2) continue;
    const prop = parts[1]!;
    if (prop !== "Emoji" && prop !== "Extended_Pictographic") continue;
    const rng = parts[0]!;
    const [aStr, bStr] = rng.includes("..") ? rng.split("..") : [rng, rng];
    let a = Number.parseInt(aStr!, 16);
    const b = Number.parseInt(bStr!, 16);
    // Exclude ASCII (#, *, 0-9) and Latin-1 (copyright/registered) below U+2000
    if (b < 0x2000) continue;
    if (a < 0x2000) a = 0x2000;
    rawRanges.push([a, b]);
  }

  // Keycap combining mark (U+20E3) and Emoji Variation Selector-16 (U+FE0F)
  rawRanges.push([0x20e3, 0x20e3], [0xfe0f, 0xfe0f]);

  rawRanges.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  const merged: Array<[number, number]> = [];
  for (const [a, b] of rawRanges) {
    const last = merged[merged.length - 1];
    if (last && a <= last[1] + 1) {
      if (b > last[1]) last[1] = b;
    } else {
      merged.push([a, b]);
    }
  }
  return merged;
}

function sortRecordByKeys(map: Map<string, string>): Record<string, string> {
  const keys = Array.from(map.keys()).sort((a, b) => {
    const minLen = Math.min(a.length, b.length);
    for (let i = 0; i < minLen; i += 1) {
      const diff = a.charCodeAt(i) - b.charCodeAt(i);
      if (diff !== 0) return diff;
    }
    return a.length - b.length;
  });
  const out: Record<string, string> = {};
  for (const k of keys) {
    out[k] = map.get(k)!;
  }
  return out;
}

function formatGeneratedTs(binBytes: Buffer, joinerRanges: Array<[number, number]>): string {
  const b64 = binBytes.toString("base64");
  const chunks: string[] = [];
  for (let i = 0; i < b64.length; i += 100) {
    chunks.push(`  "${b64.slice(i, i + 100)}"`);
  }
  const rangeLines = joinerRanges.map(
    ([a, b]) => `  [0x${a.toString(16).toUpperCase().padStart(4, "0")}, 0x${b.toString(16).toUpperCase().padStart(4, "0")}]`
  );

  return [
    "// GENERATED FILE — DO NOT EDIT BY HAND.",
    "// Regenerate via: pnpm generate:l0-data",
    "// Source: Unicode Character Database 15.1.0.",
    "",
    "export const UNICODE_15_1_BIN_BASE64: string = [",
    chunks.join(",\n"),
    '].join("");',
    "",
    "export const JOINER_SCRIPT_RANGES: readonly (readonly [number, number])[] = [",
    rangeLines.join(",\n"),
    "];",
    ""
  ].join("\n");
}

function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

async function main(): Promise<void> {
  const { ucdDir } = parseCliArgs(process.argv.slice(2));
  const [
    unicodeDataRaw,
    exclusionsRaw,
    scriptsRaw,
    emojiRaw,
    confusablesRaw,
    adobeSymbolRaw
  ] = await Promise.all([
    loadTextSource(ucdDir, "UnicodeData.txt", UNICODE_15_1_URLS.unicodeData),
    loadTextSource(ucdDir, "CompositionExclusions.txt", UNICODE_15_1_URLS.compositionExclusions),
    loadTextSource(ucdDir, "Scripts.txt", UNICODE_15_1_URLS.scripts),
    loadTextSource(ucdDir, "emoji-data.txt", UNICODE_15_1_URLS.emojiData),
    loadTextSource(ucdDir, "confusables.txt", UNICODE_15_1_URLS.confusables),
    loadTextSource(ucdDir, "symbol.txt", UNICODE_15_1_URLS.adobeSymbol)
  ]);

  const ucd = parseUnicodeData(unicodeDataRaw);
  const exclusions = parseCompositionExclusions(exclusionsRaw);

  const unicodeBin = buildUnicode151Bin(ucd);
  const joinerRanges = buildJoinerScriptRanges(scriptsRaw, emojiRaw);

  const normTable = {
    latin_compose: buildLatinComposeTable(ucd, exclusions),
    map: buildStage2Map(),
    lower_overrides: {
      "\u0130": "\u0130"
    },
    latin_fold: buildLatinFoldTable(ucd),
    compat_fold: buildCompatFoldTable(ucd),
    confusables: buildConfusablesTable(confusablesRaw, ucd),
    SYMBOL_PUA_TABLE: buildSymbolPuaTable(adobeSymbolRaw)
  };

  mkdirSync(resolve(CORE_L0_DIR, "src"), { recursive: true });

  const binPath = resolve(CORE_L0_DIR, "unicode_15_1.bin");
  const jsonPath = resolve(CORE_L0_DIR, "norm_table.json");
  const generatedTsPath = resolve(CORE_L0_DIR, "src", "unicode_15_1.generated.ts");

  const jsonContent = JSON.stringify(normTable, null, 2) + "\n";
  const tsContent = formatGeneratedTs(unicodeBin, joinerRanges);

  writeFileSync(binPath, unicodeBin);
  writeFileSync(jsonPath, jsonContent, "utf8");
  writeFileSync(generatedTsPath, tsContent, "utf8");

  console.log("Generated Tier A L0 assets:");
  console.log(`  unicode_15_1.bin         ${unicodeBin.length} bytes  sha256=${sha256Hex(unicodeBin)}`);
  console.log(`  norm_table.json          ${Buffer.byteLength(jsonContent, "utf8")} bytes  sha256=${sha256Hex(jsonContent)}`);
  console.log(`  unicode_15_1.generated   ${Buffer.byteLength(tsContent, "utf8")} bytes  sha256=${sha256Hex(tsContent)}`);
  console.log(`  latin_compose=${Object.keys(normTable.latin_compose).length}, map=${Object.keys(normTable.map).length}, lower_overrides=${Object.keys(normTable.lower_overrides).length}, latin_fold=${Object.keys(normTable.latin_fold).length}, compat_fold=${Object.keys(normTable.compat_fold).length}, confusables=${Object.keys(normTable.confusables).length}, SYMBOL_PUA_TABLE=${Object.keys(normTable.SYMBOL_PUA_TABLE).length}, joinerRanges=${joinerRanges.length}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
