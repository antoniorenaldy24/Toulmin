import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");
const CORE_L0_DIR = resolve(REPO_ROOT, "packages", "core-l0");

const TARGET_WORD_COUNT = 50_000;

const WORDLIST_SOURCE_URLS = {
  google20k: "https://raw.githubusercontent.com/first20hours/google-10000-english/master/20k.txt",
  wordsAlpha: "https://raw.githubusercontent.com/dwyl/english-words/master/words_alpha.txt",
} as const;

const HYPHENATED_COMPOUNDS: readonly string[] = [
  "age-adjusted",
  "all-cause",
  "alpha-blocker",
  "anti-inflammatory",
  "beta-blocker",
  "case-control",
  "check-worthy",
  "cloud-based",
  "co-author",
  "community-based",
  "cost-effective",
  "cost-effectiveness",
  "cross-sectional",
  "day-to-day",
  "dose-dependent",
  "dose-response",
  "double-blind",
  "drug-induced",
  "end-to-end",
  "evidence-based",
  "face-to-face",
  "first-line",
  "follow-up",
  "full-text",
  "half-life",
  "head-to-head",
  "high-dose",
  "high-risk",
  "hospital-based",
  "immune-mediated",
  "in-cloud",
  "in-vitro",
  "in-vivo",
  "insulin-dependent",
  "intention-to-treat",
  "large-scale",
  "long-standing",
  "long-term",
  "low-dose",
  "low-risk",
  "meta-analyses",
  "meta-analysis",
  "mid-dot",
  "multi-center",
  "multi-centre",
  "multi-file",
  "non-diabetic",
  "non-empirical",
  "non-inferiority",
  "non-parametric",
  "non-significant",
  "on-device",
  "one-sided",
  "open-access",
  "p-value",
  "peer-reviewed",
  "per-protocol",
  "placebo-controlled",
  "population-based",
  "post-hoc",
  "post-operative",
  "pre-existing",
  "pre-operative",
  "re-check",
  "re-import",
  "read-only",
  "real-time",
  "risk-adjusted",
  "rule-based",
  "second-line",
  "self-consistency",
  "self-reported",
  "sex-adjusted",
  "short-lived",
  "short-term",
  "single-blind",
  "single-file",
  "small-scale",
  "state-of-the-art",
  "step-by-step",
  "t-test",
  "time-consuming",
  "triple-blind",
  "two-sided",
  "up-to-date",
  "web-based",
  "well-established",
  "well-known",
  "wide-ranging",
  "x-ray",
  "zero-width",
];

const CORE_ACADEMIC_WORDS: readonly string[] = [
  "abstract",
  "accuracy",
  "acknowledgements",
  "acknowledgments",
  "adherence",
  "administered",
  "administration",
  "analysed",
  "analyzed",
  "appendix",
  "background",
  "bibliography",
  "biomarker",
  "biomarkers",
  "bleeding",
  "cardiovascular",
  "citation",
  "citations",
  "classification",
  "cohort",
  "cohorts",
  "complications",
  "concentration",
  "concentrations",
  "conclusion",
  "conclusions",
  "controls",
  "dehyphenation",
  "deterministic",
  "development",
  "discontinued",
  "discussion",
  "distribution",
  "dosage",
  "enrolled",
  "environment",
  "evaluable",
  "evaluation",
  "evidence",
  "excluded",
  "experiment",
  "experiments",
  "findings",
  "implementation",
  "incidence",
  "included",
  "inflammation",
  "information",
  "intervention",
  "interventions",
  "introduction",
  "limitations",
  "manuscript",
  "measurement",
  "methodology",
  "methods",
  "mortality",
  "participant",
  "participants",
  "patient",
  "patients",
  "pharmacokinetics",
  "placebo",
  "prevalence",
  "randomised",
  "randomized",
  "recruited",
  "reference",
  "references",
  "relationship",
  "remaining",
  "remission",
  "representation",
  "results",
  "sensitivity",
  "significant",
  "significantly",
  "specificity",
  "statistical",
  "statistically",
  "subjects",
  "supplementary",
  "survival",
  "temperature",
  "treatment",
  "treatments",
  "withdrawn",
  "withdrew",
];

const EXCLUDED_FUSED_WORDS: ReadonlySet<string> = new Set([
  ...HYPHENATED_COMPOUNDS.map((c) => c.replace(/-/g, "")),
  "postoperative",
  "preoperative",
]);

function compareCodeUnits(a: string, b: string): number {
  const minLen = a.length < b.length ? a.length : b.length;
  for (let i = 0; i < minLen; i += 1) {
    const diff = a.charCodeAt(i) - b.charCodeAt(i);
    if (diff !== 0) return diff;
  }
  return a.length - b.length;
}

function parseCliArgs(argv: string[]): { sourceDir: string | null; fromExisting: boolean } {
  let sourceDir: string | null = null;
  let fromExisting = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--source-dir" && i + 1 < argv.length) {
      sourceDir = argv[i + 1] ?? null;
      i += 1;
    } else if (argv[i] === "--from-existing") {
      fromExisting = true;
    }
  }
  return { sourceDir, fromExisting };
}

async function loadSource(localDir: string | null, fileName: string, url: string): Promise<string> {
  if (localDir !== null) {
    return readFileSync(resolve(localDir, fileName), "utf8");
  }
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${resp.status} ${resp.statusText}`);
  }
  return await resp.text();
}

function encodeFrontCoded(sortedWords: readonly string[]): string {
  const encoded: string[] = new Array<string>(sortedWords.length);
  let prev = "";
  for (let i = 0; i < sortedWords.length; i += 1) {
    const word = sortedWords[i]!;
    const maxShared = Math.min(35, prev.length, word.length);
    let shared = 0;
    while (shared < maxShared && prev.charCodeAt(shared) === word.charCodeAt(shared)) {
      shared += 1;
    }
    encoded[i] = shared.toString(36) + word.slice(shared);
    prev = word;
  }
  return encoded.join(",");
}

function decodeFrontCoded(packed: string): string[] {
  const entries = packed.split(",");
  const words: string[] = new Array<string>(entries.length);
  let prev = "";
  for (let i = 0; i < entries.length; i += 1) {
    const item = entries[i]!;
    const shared = Number.parseInt(item.charAt(0), 36);
    const word = prev.slice(0, shared) + item.slice(1);
    words[i] = word;
    prev = word;
  }
  return words;
}

function formatWordlistGeneratedTs(sortedWords: readonly string[]): string {
  const packed = encodeFrontCoded(sortedWords);
  const decodedCheck = decodeFrontCoded(packed);
  if (
    decodedCheck.length !== sortedWords.length ||
    decodedCheck.some((w, idx) => w !== sortedWords[idx])
  ) {
    throw new Error("Front-coding round-trip verification failed!");
  }

  return [
    "// GENERATED FILE — DO NOT EDIT BY HAND.",
    "// Regenerate via: pnpm generate:wordlist",
    "// Sources: google-10000-english/20k.txt (MIT) + dwyl/english-words/words_alpha.txt (Unlicense).",
    "",
    `export const WORDLIST_EN_COUNT = ${sortedWords.length};`,
    "",
    `export const WORDLIST_EN_FRONT_CODED: string = "${packed}";`,
    "",
  ].join("\n");
}

function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

const COMMON_INFLECTION_SUFFIXES: readonly string[] = [
  "ations",
  "ation",
  "ments",
  "ment",
  "ness",
  "ities",
  "ity",
  "able",
  "ible",
  "ized",
  "ised",
  "izes",
  "ises",
  "izing",
  "ising",
  "ings",
  "ing",
  "ers",
  "ed",
  "es",
  "ly",
  "al",
  "ic",
  "ous",
  "ive",
  "s",
];

function hasStemInSeedSet(word: string, seedWords: ReadonlySet<string>): boolean {
  for (const suf of COMMON_INFLECTION_SUFFIXES) {
    if (word.length > suf.length + 2 && word.endsWith(suf)) {
      const base = word.slice(0, word.length - suf.length);
      if (seedWords.has(base) || seedWords.has(base + "e")) {
        return true;
      }
      if (suf === "ied" || suf === "ies") {
        if (seedWords.has(base + "y")) return true;
      }
    }
  }
  return false;
}

async function buildSortedWordlist(sourceDir: string | null): Promise<string[]> {
  const [google20kRaw, wordsAlphaRaw] = await Promise.all([
    loadSource(sourceDir, "20k.txt", WORDLIST_SOURCE_URLS.google20k),
    loadSource(sourceDir, "words_alpha.txt", WORDLIST_SOURCE_URLS.wordsAlpha),
  ]);

  const alphaSet = new Set<string>();
  const alphaList: string[] = [];
  for (const rawLine of wordsAlphaRaw.split(/\r?\n/)) {
    const w = rawLine.trim();
    if (/^[a-z]{2,24}$/.test(w) && !EXCLUDED_FUSED_WORDS.has(w)) {
      if (!alphaSet.has(w)) {
        alphaSet.add(w);
        alphaList.push(w);
      }
    }
  }

  const selected = new Set<string>();
  for (const w of HYPHENATED_COMPOUNDS) {
    selected.add(w);
  }
  for (const w of CORE_ACADEMIC_WORDS) {
    if (!EXCLUDED_FUSED_WORDS.has(w)) {
      selected.add(w);
    }
  }

  for (const rawLine of google20kRaw.split(/\r?\n/)) {
    if (selected.size >= TARGET_WORD_COUNT) break;
    const w = rawLine.trim();
    if (/^[a-z]{2,20}$/.test(w) && alphaSet.has(w) && !EXCLUDED_FUSED_WORDS.has(w)) {
      selected.add(w);
    }
  }

  // Pass 2: include valid inflections/derivations across a..z whose base appears in seed set
  const seedSnapshot = new Set<string>(selected);
  for (const w of alphaList) {
    if (selected.size >= TARGET_WORD_COUNT) break;
    if (w.length >= 4 && w.length <= 18 && hasStemInSeedSet(w, seedSnapshot)) {
      selected.add(w);
    }
  }

  // Pass 3: balanced alphabetical top-up across all letters a..z to hit exact TARGET_WORD_COUNT
  if (selected.size < TARGET_WORD_COUNT) {
    const remainingCount = TARGET_WORD_COUNT - selected.size;
    const stride = Math.max(1, Math.floor(alphaList.length / remainingCount));
    for (let offset = 0; offset < stride && selected.size < TARGET_WORD_COUNT; offset += 1) {
      for (let i = offset; i < alphaList.length && selected.size < TARGET_WORD_COUNT; i += stride) {
        const w = alphaList[i]!;
        if (w.length >= 3 && w.length <= 16) {
          selected.add(w);
        }
      }
    }
  }

  for (const w of alphaList) {
    if (selected.size >= TARGET_WORD_COUNT) break;
    selected.add(w);
  }

  if (selected.size !== TARGET_WORD_COUNT) {
    throw new Error(`Expected ${TARGET_WORD_COUNT} words, got ${selected.size}`);
  }

  return Array.from(selected).sort(compareCodeUnits);
}

async function main(): Promise<void> {
  const { sourceDir, fromExisting } = parseCliArgs(process.argv.slice(2));
  const txtPath = resolve(CORE_L0_DIR, "wordlist_en.txt");
  const tsPath = resolve(CORE_L0_DIR, "src", "wordlist_en.generated.ts");

  let sortedWords: string[];
  if (fromExisting) {
    const existingRaw = readFileSync(txtPath, "utf8");
    sortedWords = existingRaw
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    if (sortedWords.length !== TARGET_WORD_COUNT) {
      throw new Error(`Expected ${TARGET_WORD_COUNT} words in ${txtPath}, found ${sortedWords.length}`);
    }
    sortedWords.sort(compareCodeUnits);
  } else {
    sortedWords = await buildSortedWordlist(sourceDir);
    mkdirSync(CORE_L0_DIR, { recursive: true });
    const txtContent = sortedWords.join("\n") + "\n";
    writeFileSync(txtPath, txtContent, "utf8");
  }

  mkdirSync(resolve(CORE_L0_DIR, "src"), { recursive: true });
  const tsContent = formatWordlistGeneratedTs(sortedWords);
  writeFileSync(tsPath, tsContent, "utf8");

  const txtBytes = readFileSync(txtPath);
  console.log("Generated Tier A wordlist_en assets:");
  console.log(`  wordlist_en.txt          ${txtBytes.length} bytes  words=${sortedWords.length}  sha256=${sha256Hex(txtBytes)}`);
  console.log(`  wordlist_en.generated.ts ${Buffer.byteLength(tsContent, "utf8")} bytes  sha256=${sha256Hex(tsContent)}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
