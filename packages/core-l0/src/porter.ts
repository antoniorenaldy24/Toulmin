import porterV1Data from "../porter_v1.json" with { type: "json" };
import type { PorterSuffixRule, PorterV1Table } from "../porter_v1.json.d.ts";

export type { PorterSuffixRule, PorterV1Table };

export const PORTER_V1: PorterV1Table = porterV1Data;
const porterV1: PorterV1Table = porterV1Data;

/**
 * Exact 63-word BM25 stopword list from docs/spec/02_L0_TIER_A_PRE_DECODE.md §8.1.
 * Negation terms ("not", "no", "nor", "never", "without") are intentionally excluded
 * so negation reaches retrieval and key-lemma matching.
 */
export const BM25_STOPWORDS: ReadonlySet<string> = new Set([
  "a",
  "an",
  "the",
  "of",
  "in",
  "on",
  "at",
  "to",
  "for",
  "from",
  "by",
  "with",
  "and",
  "or",
  "but",
  "as",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "this",
  "that",
  "these",
  "those",
  "it",
  "its",
  "their",
  "there",
  "which",
  "who",
  "whom",
  "than",
  "then",
  "into",
  "over",
  "under",
  "between",
  "among",
  "we",
  "our",
  "us",
  "they",
  "them",
  "he",
  "she",
  "his",
  "her",
  "also",
  "such",
  "may",
  "might",
  "can",
  "could",
  "would",
  "should",
  "will",
  "shall",
  "do",
  "does",
  "did"
]);

export function isStopword(word: string): boolean {
  return BM25_STOPWORDS.has(asciiLower(word));
}

function asciiLower(s: string): string {
  let out = "";
  let changed = false;
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code >= 65 && code <= 90) {
      if (!changed) {
        out = s.slice(0, i);
        changed = true;
      }
      out += String.fromCharCode(code + 32);
    } else if (changed) {
      out += s.charAt(i);
    }
  }
  return changed ? out : s;
}

const VOWEL_CODES: ReadonlySet<number> = new Set(
  porterV1.vowels.map((v) => v.charCodeAt(0))
);

function isConsonant(word: string, index: number): boolean {
  const code = word.charCodeAt(index);
  if (VOWEL_CODES.has(code)) {
    return false;
  }
  // 'y' is a consonant at index 0 or after a vowel, and a vowel after a consonant.
  if (code === 121) {
    return index === 0 ? true : !isConsonant(word, index - 1);
  }
  return true;
}

function measure(stem: string): number {
  const n = stem.length;
  let i = 0;
  while (i < n && isConsonant(stem, i)) {
    i++;
  }
  let m = 0;
  while (i < n) {
    while (i < n && !isConsonant(stem, i)) {
      i++;
    }
    if (i >= n) {
      break;
    }
    while (i < n && isConsonant(stem, i)) {
      i++;
    }
    m++;
  }
  return m;
}

function containsVowel(stem: string): boolean {
  for (let i = 0; i < stem.length; i++) {
    if (!isConsonant(stem, i)) {
      return true;
    }
  }
  return false;
}

function endsWithDoubleConsonant(word: string): boolean {
  const n = word.length;
  if (n < 2) {
    return false;
  }
  const last = word.charCodeAt(n - 1);
  if (last < 97 || last > 122 || last !== word.charCodeAt(n - 2)) {
    return false;
  }
  return isConsonant(word, n - 1);
}

function endsWithStarO(word: string): boolean {
  const n = word.length;
  if (n < 3) {
    return false;
  }
  if (!isConsonant(word, n - 1) || isConsonant(word, n - 2) || !isConsonant(word, n - 3)) {
    return false;
  }
  const last = word.charCodeAt(n - 1);
  return last !== 119 && last !== 120 && last !== 121;
}

function matchesStemEnding(stem: string, rule: PorterSuffixRule): boolean {
  if (rule.stemEndsWithAny !== undefined) {
    if (stem.length === 0) {
      return false;
    }
    const lastChar = stem.charAt(stem.length - 1);
    if (!rule.stemEndsWithAny.includes(lastChar)) {
      return false;
    }
  }
  if (rule.requiresVowel === true && !containsVowel(stem)) {
    return false;
  }
  if (rule.minMeasure !== undefined && measure(stem) < rule.minMeasure) {
    return false;
  }
  return true;
}

function applyFirstSuffixStep(word: string, rules: readonly PorterSuffixRule[]): string {
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i]!;
    if (word.endsWith(rule.suffix)) {
      const stem = word.slice(0, word.length - rule.suffix.length);
      if (matchesStemEnding(stem, rule)) {
        return stem + rule.replacement;
      }
      // In Porter 1980, only the first matching suffix rule is considered per step.
      return word;
    }
  }
  return word;
}

function applyStep1b(word: string): string {
  const { eed, pastOrProg, cleanupAppendE, doubleConsonantKeep, appendEOnMeasure1AndStarO } =
    porterV1.step1b;

  if (word.endsWith(eed.suffix)) {
    const stem = word.slice(0, word.length - eed.suffix.length);
    if (measure(stem) >= (eed.minMeasure ?? 1)) {
      return stem + eed.replacement;
    }
    return word;
  }

  let stemAfterPastOrProg: string | null = null;
  for (let i = 0; i < pastOrProg.length; i++) {
    const rule = pastOrProg[i]!;
    if (word.endsWith(rule.suffix)) {
      const stem = word.slice(0, word.length - rule.suffix.length);
      if (matchesStemEnding(stem, rule)) {
        stemAfterPastOrProg = stem + rule.replacement;
      }
      break;
    }
  }

  if (stemAfterPastOrProg === null) {
    return word;
  }

  const w = stemAfterPastOrProg;
  for (let i = 0; i < cleanupAppendE.length; i++) {
    if (w.endsWith(cleanupAppendE[i]!)) {
      return w + "e";
    }
  }

  if (endsWithDoubleConsonant(w)) {
    const lastChar = w.charAt(w.length - 1);
    if (!doubleConsonantKeep.includes(lastChar)) {
      return w.slice(0, w.length - 1);
    }
    return w;
  }

  if (appendEOnMeasure1AndStarO && measure(w) === 1 && endsWithStarO(w)) {
    return w + "e";
  }

  return w;
}

/**
 * Pure 1980 Porter stemmer strictly driven by `/packages/core-l0/porter_v1.json`.
 */
export function porterStem(input: string): string {
  let w = asciiLower(input);
  if (w.length <= 2) {
    return w;
  }

  // Step 1a
  w = applyFirstSuffixStep(w, porterV1.step1a);

  // Step 1b
  w = applyStep1b(w);

  // Step 1c
  w = applyFirstSuffixStep(w, porterV1.step1c);

  // Step 2
  w = applyFirstSuffixStep(w, porterV1.step2);

  // Step 3
  w = applyFirstSuffixStep(w, porterV1.step3);

  // Step 4
  w = applyFirstSuffixStep(w, porterV1.step4);

  // Step 5a
  const { step5a, step5b } = porterV1;
  if (w.endsWith(step5a.suffix)) {
    const stem = w.slice(0, w.length - step5a.suffix.length);
    const m = measure(stem);
    if (
      m > step5a.removeIfMeasureGt ||
      (m === step5a.removeIfMeasureEqAndNotStarO && !endsWithStarO(stem))
    ) {
      w = stem;
    }
  }

  // Step 5b
  if (
    w.endsWith(step5b.suffix) &&
    (!step5b.requiresDoubleConsonant || endsWithDoubleConsonant(w)) &&
    measure(w) >= step5b.minMeasure
  ) {
    w = w.slice(0, w.length - step5b.suffix.length);
  }

  return w;
}
