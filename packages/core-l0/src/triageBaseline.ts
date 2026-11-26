/**
 * Deterministic Triage Baseline (`baselineTriage`) and Stage 1 Atom->Clause Mapping
 * (`docs/spec/03_L0_TIER_B_VALIDATOR_B5_INGEST.md` §3.1 & §3.4).
 *
 * Tier B locked CF-1 baseline (D-30): pure TypeScript, zero Firebase, DOM,
 * network, Node I/O, clock, unseeded randomness, or regex usage.
 */

import { extractWordSpans, scanCitations } from "./citations.js";
import type { SourceFormat } from "./mask.js";
import { normLower } from "./norm.js";
import { prepareInput, toRawSpan } from "./numberParser.js";
import { COUNT_NOUNS, extractQuantities } from "./quantity.js";
import { matchCanonicalSectionLabel, type CanonicalSectionLabel } from "./sections.js";
import type { BaselineTriage, ClaimType, Stage1Atom, TextRange, Worth } from "@toulmin/schemas";

export type { BaselineTriage, ClaimType, Stage1Atom, TextRange, Worth };
export { COUNT_NOUNS };

// ───────────────────────── Normative Cues (`03` §3.4) ─────────────────────────

export const CAUSAL_SINGLE_WORDS: ReadonlySet<string> = new Set([
  "cause",
  "causes",
  "caused",
  "causing",
  "induce",
  "induces",
  "induced",
  "mediate",
  "mediates",
  "mediated",
]);

export const CAUSAL_MULTI_WORD_PHRASES: readonly (readonly string[])[] = [
  ["leads", "to"],
  ["led", "to"],
  ["lead", "to"],
  ["resulted", "in"],
  ["results", "in"],
  ["result", "in"],
  ["because", "of"],
  ["due", "to"],
  ["attributable", "to"],
];

export const CAUSAL_CUES: ReadonlySet<string> = new Set([
  ...CAUSAL_SINGLE_WORDS,
  ...CAUSAL_MULTI_WORD_PHRASES.map((p) => p.join(" ")),
]);

export const COMPARATIVE_CUES: ReadonlySet<string> = new Set([
  "increase",
  "increased",
  "increases",
  "decrease",
  "decreased",
  "decreases",
  "reduce",
  "reduced",
  "reduces",
  "reduction",
  "improve",
  "improved",
  "improves",
  "higher",
  "lower",
  "greater",
  "fewer",
  "compared",
  "versus",
  "vs",
  "outperform",
  "outperformed",
  "superior",
  "inferior",
  "associated",
  "association",
  "correlated",
  "correlation",
  "predict",
  "predicted",
  "predicts",
]);

export const COMPARATIVE_WITH_NUMBER: ReadonlySet<string> = new Set([
  "more",
  "less",
  "than",
  "risk",
  "odds",
]);

export const EXISTENCE_CUES: ReadonlySet<string> = new Set([
  "exist",
  "exists",
  "present",
  "presence",
  "identified",
  "detected",
  "observed",
  "found",
  "reported",
  "occurs",
  "occur",
]);

export const UNCITED_SECTIONS: ReadonlySet<CanonicalSectionLabel> = new Set([
  "introduction",
  "discussion",
  "unlabeled",
]);

export const METHOD_OPENERS: readonly (readonly string[])[] = [
  ["we", "used"],
  ["we", "performed"],
  ["we", "conducted"],
  ["we", "collected"],
  ["we", "recruited"],
  ["we", "analyzed"],
  ["we", "analysed"],
  ["we", "measured"],
  ["we", "applied"],
  ["we", "followed"],
  ["data", "were"],
  ["samples", "were"],
  ["participants", "were"],
];

// ───────────────────────── Public Interfaces ─────────────────────────

export interface BaselineTriageInput {
  readonly clauseText: string;
  readonly section: string;
  readonly hasResolvedCitation: boolean;
  readonly citationSpans?: readonly TextRange[];
  readonly clauseWordRange?: TextRange;
  readonly lang?: string;
  readonly format?: SourceFormat;
}

// ───────────────────────── Helpers ─────────────────────────

function canonicalizeSection(section: string): CanonicalSectionLabel {
  const lowered = normLower(section.trim());
  if (
    lowered === "abstract" ||
    lowered === "introduction" ||
    lowered === "methods" ||
    lowered === "results" ||
    lowered === "discussion" ||
    lowered === "limitations" ||
    lowered === "conclusion" ||
    lowered === "supplementary" ||
    lowered === "references" ||
    lowered === "unlabeled"
  ) {
    return lowered;
  }
  return matchCanonicalSectionLabel(section, false) ?? "unlabeled";
}

function overlapsAnyRange(start: number, end: number, ranges: readonly TextRange[]): boolean {
  for (const r of ranges) {
    if (start < r.end && end > r.start) {
      return true;
    }
  }
  return false;
}

function extractClauseWordsLower(
  clauseText: string,
  citationSpans: readonly TextRange[],
  lang?: string,
  format?: SourceFormat,
): string[] {
  const prep = prepareInput(clauseText, {
    applyLatex: true,
    ...(lang !== undefined ? { lang } : {}),
    ...(format !== undefined ? { format } : {}),
  });
  const spans = extractWordSpans(prep.normLowerText);
  const words: string[] = [];
  for (const ws of spans) {
    const rawSpan = toRawSpan(prep, ws.start, ws.end);
    if (overlapsAnyRange(rawSpan.start, rawSpan.end, citationSpans)) {
      continue;
    }
    words.push(ws.text);
  }
  return words;
}

function matchesPhraseAt(words: readonly string[], startIdx: number, phrase: readonly string[]): boolean {
  if (startIdx + phrase.length > words.length) return false;
  for (let i = 0; i < phrase.length; i += 1) {
    if (words[startIdx + i] !== phrase[i]) return false;
  }
  return true;
}

function containsCausalCue(words: readonly string[]): boolean {
  for (let i = 0; i < words.length; i += 1) {
    if (CAUSAL_SINGLE_WORDS.has(words[i]!)) {
      return true;
    }
    for (const phrase of CAUSAL_MULTI_WORD_PHRASES) {
      if (matchesPhraseAt(words, i, phrase)) {
        return true;
      }
    }
  }
  return false;
}

function startsWithMethodOpener(words: readonly string[]): boolean {
  for (const opener of METHOD_OPENERS) {
    if (matchesPhraseAt(words, 0, opener)) {
      return true;
    }
  }
  return false;
}

function clampWordIndex(idx: number): number {
  if (idx < 0) return 0;
  if (idx > 79) return 79;
  return idx;
}

// ───────────────────────── Baseline & Atom Mapping (`03` §3.1, §3.4) ─────────────────────────

export function baselineTriage(input: BaselineTriageInput): BaselineTriage {
  const citationSpans: readonly TextRange[] =
    input.citationSpans ??
    scanCitations(input.clauseText).map((m) => ({ start: m.start, end: m.end }));

  const nums = extractQuantities(input.clauseText, {
    citationSpans,
    ...(input.lang !== undefined ? { lang: input.lang } : {}),
    ...(input.format !== undefined ? { format: input.format } : {}),
  });

  const words = extractClauseWordsLower(input.clauseText, citationSpans, input.lang, input.format);
  const sec = canonicalizeSection(input.section);

  let claimType: ClaimType;
  if (nums.length > 0) {
    claimType = "QUANTITATIVE";
  } else if (containsCausalCue(words)) {
    claimType = "CAUSAL";
  } else if (
    words.some((w) => COMPARATIVE_CUES.has(w)) ||
    (nums.length > 0 && words.some((w) => COMPARATIVE_WITH_NUMBER.has(w)))
  ) {
    claimType = "COMPARATIVE";
  } else if (words.some((w) => EXISTENCE_CUES.has(w))) {
    claimType = "EXISTENCE";
  } else if (sec === "methods" || startsWithMethodOpener(words)) {
    claimType = "METHODOLOGICAL";
  } else {
    claimType = "NON_EMPIRICAL";
  }

  const worth: Worth =
    claimType === "QUANTITATIVE" ||
    claimType === "CAUSAL" ||
    claimType === "COMPARATIVE" ||
    (claimType === "EXISTENCE" && input.hasResolvedCitation)
      ? "HIGH"
      : "LOW";

  const uncited =
    !input.hasResolvedCitation &&
    worth === "HIGH" &&
    claimType !== "METHODOLOGICAL" &&
    UNCITED_SECTIONS.has(sec);

  const rawStart = input.clauseWordRange?.start ?? 0;
  const rawEnd = input.clauseWordRange?.end ?? Math.max(0, words.length - 1);
  const atomStart = clampWordIndex(rawStart);
  const atomEnd = Math.max(atomStart, clampWordIndex(rawEnd));

  return {
    atoms: [{ start: atomStart, end: atomEnd, claimType }],
    worth,
    claimType,
    uncited,
  };
}

/**
 * Assigns each Stage 1 atom to the clause containing the majority of its words;
 * ties go to the earlier clause; atoms overlapping no clause are dropped (`03` §3.1).
 */
export function mapAtomsToClauses(
  atoms: readonly Stage1Atom[],
  clauseWordRanges: readonly TextRange[],
): Stage1Atom[][] {
  const perClause: Stage1Atom[][] = clauseWordRanges.map(() => []);
  for (const atom of atoms) {
    if (atom.end < atom.start) continue;
    let bestClauseIdx = -1;
    let bestOverlap = 0;

    for (let cIdx = 0; cIdx < clauseWordRanges.length; cIdx += 1) {
      const cr = clauseWordRanges[cIdx]!;
      const ovStart = Math.max(atom.start, cr.start);
      const ovEnd = Math.min(atom.end, cr.end);
      const overlap = ovEnd >= ovStart ? ovEnd - ovStart + 1 : 0;
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestClauseIdx = cIdx;
      }
    }

    if (bestClauseIdx !== -1 && bestOverlap > 0) {
      perClause[bestClauseIdx]!.push({
        start: atom.start,
        end: atom.end,
        claimType: atom.claimType,
      });
    }
  }
  return perClause;
}
