import { describe, expect, it } from "vitest";
import {
  applyLatexSubstitutions,
  chunkAbstract,
  chunkJatsXml,
  chunkPdfPages,
  dehyphenatePdfLines,
  extractQuantities,
  norm,
  normSentence,
  normalizedClaim,
  partitionClauses,
  preMask,
  sanitizeText,
  scanCitations,
  segmentDocument,
  shapeEvidenceWindow,
  tokBM25,
  wrapEvidenceBlock,
} from "../../src/index.js";

/**
 * Adversarial ReDoS & worst-case O(n) latency fuzz suite (`AC-L0-15`, `02` §1.4, `07` §6.9 Procedure 1).
 *
 * Pure test module (zero Node I/O, zero Math.random): uses constant seed
 * `SEED_FUZZ = 0x544C4D46` (plus secondary check with `0x544C4D4E`) and asserts
 * median <= 5 ms per 10 KB across all Tier A scanners and entry points.
 */

const SEED_FUZZ = 0x544c4d46;
const SEED_FUZZ_ALT = 0x544c4d4e;
const TEN_KB = 10_240;
const MAX_MEDIAN_MS = 5;

function createPrng(seed: number): () => number {
  let state = seed >>> 0;
  return (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function exactLength(pattern: string, len: number = TEN_KB): string {
  const reps = Math.ceil(len / pattern.length);
  return pattern.repeat(reps).slice(0, len);
}

function medianMs(fn: () => void, runs: number = 5): number {
  fn(); // warm-up once per input before timing
  const timings: number[] = new Array<number>(runs);
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    fn();
    timings[i] = performance.now() - start;
  }
  timings.sort((a, b) => a - b);
  return timings[runs >> 1]!;
}

function warmUpEntryPoint(
  name: string,
  run: (input: string) => void,
  samples: readonly string[],
  warmedUp: Set<string>,
): void {
  if (warmedUp.has(name)) return;
  warmedUp.add(name);
  for (let pass = 0; pass < 4; pass++) {
    for (let i = 0; i < samples.length; i++) {
      run(samples[i]!);
    }
  }
}

function build64OpenerCorpus(seed: number): string[] {
  const rng = createPrng(seed);
  const openers = [
    "(",
    "[",
    "{",
    "\\cite{",
    "$",
    "$$",
    "\\(",
    "\\[",
    "<",
    "<!--",
    "\\textbf{",
    "\\frac{",
    "\\SI{",
    "\\section{",
    "<p ",
    "<sec>",
  ];
  const inputs: string[] = [];
  for (let i = 0; i < 64; i++) {
    if (i < openers.length) {
      inputs.push(exactLength(openers[i]!));
    } else {
      // Seeded combinations of 2–3 unclosed openers padded to exact 10 KB
      const a = openers[Math.floor(rng() * openers.length)]!;
      const b = openers[Math.floor(rng() * openers.length)]!;
      const pad = i % 2 === 0 ? "x " : "";
      inputs.push(exactLength(`${a}${b}${pad}`));
    }
  }
  return inputs;
}

function buildNearMatchCorpus(): string[] {
  const nearPatterns = [
    "ignore override disregard forget ",
    "previous prior above earlier all any ",
    "system developer assistant user evidence ",
    "you are now a language model ",
    "respond reply answer output return print ",
    "new revised real actual hidden task ",
    "< <system </ <evidence <instruction ",
    "[inst </inst <<sys <<evidence ",
    "## ### instruction system task prompt ",
    "the correct right true verdict answer ",
    "do not follow obey your previous ",
    "begin end of system instructions prompt ",
    "http:// https:// example.org/p?a=1 ",
    '"verdict" s01_ s02_ nei_silent ',
    "et al. e.g. i.e. Fig. 2 vs. approx. i.v. ",
    "A. ",
    "95% CI IQR median range from between ",
    "95% CI [12, 45] median 5 [3, 7] days ",
  ];
  return nearPatterns.map((p) => exactLength(p));
}

function buildUnclosedCiteAndNumericCorpus(): {
  readonly cite64Keys10k: string;
  readonly pandoc10k: string;
  readonly numericRuns: readonly string[];
} {
  const keys = Array.from({ length: 64 }, (_, i) => `ref_key_${i}`).join(",");
  const citePrefix = `\\cite{${keys},`;
  const citeTail = exactLength("key_char:0123_abc-def.", TEN_KB - citePrefix.length);
  const cite64Keys10k = `${citePrefix}${citeTail}`;

  const pandocPrefix = `[@${Array.from({ length: 64 }, (_, i) => `k${i}`).join("; @")}; `;
  const pandoc10k = `${pandocPrefix}${exactLength("smith2020_", TEN_KB - pandocPrefix.length)}`;

  const numericRuns = [
    exactLength("1234567890"),
    exactLength("1.2.3.4.5.6.7.8.9."),
    exactLength("1\u00b72\u00b73\u00b74\u00b7"),
    exactLength("1,234,567,890 "),
    exactLength("0.001 -1.23 95% 1.2-3.4 "),
  ];

  return { cite64Keys10k, pandoc10k, numericRuns };
}

const UNICODE_MIX_POOL: readonly string[] = [
  "a",
  "Z",
  "M\u00fc",
  "u\u0308",
  "\u0130",
  "\u03b1",
  "\u03bf",
  "\u0430",
  "\u0440",
  "\ud835\udc22",
  "\u24d8",
  "\uf0b1",
  "\ue123",
  "\u092a",
  "\u200d",
  "\u200b",
  "\u202e",
  "\udb40\udc69",
  "0",
  "5",
  " ",
  "\t",
  "\n",
  ".",
  "?",
  "!",
  "(",
  ")",
  "[",
  "]",
  "{",
  "}",
  "<",
  ">",
  "$",
  "\\",
  "_",
  ":",
  "-",
  "+",
  "%",
  "\u00b7",
  "#",
  "&",
  '"',
  "'",
];

const COMMON_LATIN_FILLERS: readonly string[] = [
  "a", "b", "c", "d", "e", "f", "g", "h", "i", "l", "m", "n", "o", "p", "r", "s", "t", "u",
  " ", " ", " ", " ", " ",
];

const UNICODE_REALISTIC_MIX_POOL: readonly string[] = [
  ...COMMON_LATIN_FILLERS,
  ...COMMON_LATIN_FILLERS,
  ...COMMON_LATIN_FILLERS,
  ...COMMON_LATIN_FILLERS,
  ...COMMON_LATIN_FILLERS,
  ...UNICODE_MIX_POOL.filter((ch) => ch !== "\\" && ch !== "$"),
];

function buildRandomUnicodeStrings(
  seed: number,
  count: number,
  minLen: number,
  maxLen: number,
  pool: readonly string[] = UNICODE_MIX_POOL,
): string[] {
  const rng = createPrng(seed);
  const out = new Array<string>(count);
  for (let i = 0; i < count; i++) {
    const targetLen = minLen + Math.floor(rng() * (maxLen - minLen + 1));
    const parts: string[] = [];
    for (let j = 0; j < targetLen; j++) {
      parts.push(pool[Math.floor(rng() * pool.length)]!);
    }
    out[i] = parts.join("");
  }
  return out;
}

describe("packages/core-l0/test/fuzz/redos.test.ts — ReDoS & AC-L0-15 <= 5 ms / 10 KB", () => {
  const openers10k = build64OpenerCorpus(SEED_FUZZ);
  const openersAlt10k = build64OpenerCorpus(SEED_FUZZ_ALT);
  const nearMatches10k = buildNearMatchCorpus();
  const { cite64Keys10k, pandoc10k, numericRuns } = buildUnclosedCiteAndNumericCorpus();

  const tierAEntryPoints: ReadonlyArray<{
    readonly name: string;
    readonly run: (input: string) => void;
  }> = [
    { name: "norm", run: (s) => { norm(s); } },
    { name: "preMask(latex)", run: (s) => { preMask(s, "latex"); } },
    { name: "preMask(md)", run: (s) => { preMask(s, "md"); } },
    { name: "applyLatexSubstitutions", run: (s) => { applyLatexSubstitutions(s); } },
    { name: "normSentence", run: (s) => { normSentence(s, { format: "md" }); } },
    { name: "segmentDocument(latex)", run: (s) => { segmentDocument(s, "latex"); } },
    { name: "segmentDocument(md)", run: (s) => { segmentDocument(s, "md"); } },
    { name: "scanCitations", run: (s) => { scanCitations(s); } },
    { name: "partitionClauses", run: (s) => { partitionClauses(s, []); } },
    { name: "extractQuantities", run: (s) => { extractQuantities(s); } },
    { name: "normalizedClaim", run: (s) => { normalizedClaim(s); } },
    { name: "tokBM25", run: (s) => { tokBM25(s); } },
    { name: "chunkAbstract", run: (s) => { chunkAbstract("r-fuzz", s); } },
    { name: "chunkJatsXml", run: (s) => { chunkJatsXml("r-fuzz", s); } },
    { name: "shapeEvidenceWindow", run: (s) => { shapeEvidenceWindow(s, "mortality ignore"); } },
    { name: "sanitizeText", run: (s) => { sanitizeText(s); } },
    { name: "wrapEvidenceBlock", run: (s) => { wrapEvidenceBlock(0, s); } },
  ];

  const warmedUp = new Set<string>();
  const warmupCorpus10k: readonly string[] = [
    openers10k[0]!,
    openers10k[17]!,
    nearMatches10k[14]!,
    nearMatches10k[15]!,
    nearMatches10k[17]!,
    cite64Keys10k,
    numericRuns[4]!,
    buildRandomUnicodeStrings(
      SEED_FUZZ + 7,
      1,
      TEN_KB,
      TEN_KB,
      UNICODE_REALISTIC_MIX_POOL,
    )[0]!.slice(0, TEN_KB),
  ];

  it("handles all 64 10 KB repeated-opener adversarial inputs in <= 5 ms median per Tier A entry point", () => {
    for (const ep of tierAEntryPoints) {
      warmUpEntryPoint(ep.name, ep.run, warmupCorpus10k, warmedUp);
      let worstMs = 0;
      let worstIdx = -1;
      for (let i = 0; i < openers10k.length; i++) {
        const input = openers10k[i]!;
        const ms = medianMs(() => ep.run(input));
        if (ms > worstMs) {
          worstMs = ms;
          worstIdx = i;
        }
      }
      expect(worstMs, `${ep.name} failed on opener[${worstIdx}] (${worstMs.toFixed(3)} ms)`).toBeLessThanOrEqual(
        MAX_MEDIAN_MS,
      );
    }

    // Secondary seed spot-check (02 §1.4 SEED 0x544C4D4E)
    for (const ep of tierAEntryPoints) {
      for (let i = 16; i < 24; i++) {
        const ms = medianMs(() => ep.run(openersAlt10k[i]!));
        expect(ms, `${ep.name} alt-seed[${i}] exceeded 5 ms`).toBeLessThanOrEqual(MAX_MEDIAN_MS);
      }
    }
  }, 30_000);

  it("handles 10 KB alternating keyword near-matches, 64-key unclosed citations, and digit/mid-dot runs in <= 5 ms median", () => {
    for (const ep of tierAEntryPoints) {
      warmUpEntryPoint(ep.name, ep.run, warmupCorpus10k, warmedUp);
      for (let i = 0; i < nearMatches10k.length; i++) {
        const input = nearMatches10k[i]!;
        const ms = medianMs(() => ep.run(input));
        expect(ms, `${ep.name} nearMatch[${i}] (${ms.toFixed(3)} ms)`).toBeLessThanOrEqual(
          MAX_MEDIAN_MS,
        );
      }
      expect(medianMs(() => ep.run(cite64Keys10k)), `${ep.name} cite64Keys10k`).toBeLessThanOrEqual(
        MAX_MEDIAN_MS,
      );
      expect(medianMs(() => ep.run(pandoc10k)), `${ep.name} pandoc10k`).toBeLessThanOrEqual(
        MAX_MEDIAN_MS,
      );
      for (let r = 0; r < numericRuns.length; r++) {
        expect(
          medianMs(() => ep.run(numericRuns[r]!)),
          `${ep.name} numericRun[${r}]`,
        ).toBeLessThanOrEqual(MAX_MEDIAN_MS);
      }
    }

    // PDF-specific chunking functions on 10 KB inputs
    const pdfLines = Array.from({ length: 400 }, () => "Randomized treatment mor-");
    for (let w = 0; w < 5; w++) {
      dehyphenatePdfLines(pdfLines);
    }
    expect(medianMs(() => dehyphenatePdfLines(pdfLines))).toBeLessThanOrEqual(MAX_MEDIAN_MS);

    const pdfItems = Array.from({ length: 200 }, (_, i) => ({
      str: "Mortality declined cleanly after therapy.",
      x: 50 + (i % 2) * 280,
      y: 740 - Math.floor(i / 2) * 6,
      width: 200,
      height: 10,
    }));
    for (let w = 0; w < 5; w++) {
      chunkPdfPages("r-pdf-fuzz", [{ pageNumber: 1, width: 600, height: 800, items: pdfItems }]);
    }
    expect(
      medianMs(() => chunkPdfPages("r-pdf-fuzz", [{ pageNumber: 1, width: 600, height: 800, items: pdfItems }])),
    ).toBeLessThanOrEqual(MAX_MEDIAN_MS);

    // Clause partitioner with dense parsed citation markers on 10 KB input
    const denseCite10k = exactLength("Drug [1] ");
    const denseCiteMarkers = scanCitations(denseCite10k);
    for (let w = 0; w < 5; w++) {
      partitionClauses(denseCite10k, denseCiteMarkers);
    }
    expect(
      medianMs(() => partitionClauses(denseCite10k, denseCiteMarkers)),
    ).toBeLessThanOrEqual(MAX_MEDIAN_MS);
  }, 30_000);

  it("fuzzes 1,000 deterministic random Unicode class-mixed strings + 10 KB random Unicode inputs without errors or > 5 ms stalls", () => {
    const unicode1000 = buildRandomUnicodeStrings(SEED_FUZZ + 1, 1_000, 32, 160);

    for (let i = 0; i < unicode1000.length; i++) {
      const sample = unicode1000[i]!;
      const nRes = norm(sample);
      expect(nRes.map.length).toBe(nRes.text.length + 1);
      expect(nRes.map[nRes.text.length]).toBe(sample.length);

      const sRes = sanitizeText(sample);
      expect(sRes.map.length).toBe(sRes.text.length + 1);
      expect(sRes.map[sRes.text.length]).toBe(sample.length);

      preMask(sample, "latex");
      applyLatexSubstitutions(sample);
      normSentence(sample, { format: "latex" });
      segmentDocument(sample, "md");
      scanCitations(sample);
      partitionClauses(sample, []);
      extractQuantities(sample);
      normalizedClaim(sample);
      tokBM25(sample);
      chunkAbstract("r-u", sample);
      chunkJatsXml("r-u", sample);
      shapeEvidenceWindow(sample, "mortality");
      wrapEvidenceBlock(0, sRes.text);
    }

    // Also measure exact 10 KB weighted mixed Unicode inputs across every entry point
    const mixed10kSamples = buildRandomUnicodeStrings(
      SEED_FUZZ + 99,
      8,
      TEN_KB,
      TEN_KB,
      UNICODE_REALISTIC_MIX_POOL,
    ).map((s) => s.slice(0, TEN_KB));
    for (const ep of tierAEntryPoints) {
      warmUpEntryPoint(ep.name, ep.run, warmupCorpus10k, warmedUp);
      for (let i = 0; i < mixed10kSamples.length; i++) {
        const ms = medianMs(() => ep.run(mixed10kSamples[i]!));
        expect(ms, `${ep.name} mixed10k[${i}] (${ms.toFixed(3)} ms)`).toBeLessThanOrEqual(
          MAX_MEDIAN_MS,
        );
      }
    }
  }, 30_000);
});
