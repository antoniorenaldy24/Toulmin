/**
 * IDF-weighted claim coverage `cov(c, d)`, `bm25_min_cov` threshold resolution & filtering,
 * and Top-5 per-(clause, reference) candidate selection (`02` §8.3–§8.5).
 *
 * Pure Tier A L0 module: zero Firebase, DOM, network, Node I/O, clock, or regex usage.
 */

import bm25MinCovData from "../bm25_min_cov.json" with { type: "json" };
import type { Bm25MinCovConfig } from "../bm25_min_cov.json.d.ts";
import {
  compareBm25Candidates,
  compareCodeUnits,
  getCorpusIdf,
  gridKey,
  isWordBm25Token,
  scoreBm25Unit,
  type Bm25Corpus,
  type Bm25IndexedUnit,
  type Bm25Query,
  type Bm25ScoredUnit,
} from "./bm25.js";

export type { Bm25MinCovConfig };

export const BM25_MIN_COV_CONFIG: Bm25MinCovConfig = bm25MinCovData;
export const DEFAULT_BM25_MIN_COV: number = bm25MinCovData.bm25_min_cov;
export const BM25_MIN_COV: number = bm25MinCovData.bm25_min_cov;

export const MAX_EVIDENCE_CANDIDATES = 5;
export const MAX_ABSTRACT_CANDIDATES = 3;
export const MAX_FULLTEXT_CANDIDATES = 2;

export type IdfLookup =
  | Bm25Corpus
  | ReadonlyMap<string, number>
  | ((term: string) => number);

export interface Bm25MinCovResolution {
  readonly value: number;
  readonly mismatch: boolean;
  readonly code: "BM25_MIN_COV_MISMATCH" | null;
}

export interface ClaimCoverageResult {
  readonly cov: number;
  readonly covGrid: number;
  readonly stems: number;
  readonly sharedStems: readonly string[];
  readonly claimTermCount: number;
  readonly kept: boolean;
  readonly minCovUsed: number;
  readonly minCovGrid: number;
}

export interface EvaluatedCandidate extends Bm25ScoredUnit {
  readonly coverage: ClaimCoverageResult;
}

export interface SelectEvidenceOptions {
  readonly minCov?: number;
  readonly isUnitBlocked?: (unit: Bm25IndexedUnit) => boolean;
}

export interface EvidenceSelectionResult {
  readonly selected: readonly EvaluatedCandidate[];
  readonly allScored: readonly EvaluatedCandidate[];
  readonly candidates: number;
  readonly suspicious: boolean;
  readonly minCovUsed: number;
}

/**
 * Resolves `bm25_min_cov`: clients always use the bundled Tier A threshold (`02` §8.3)
 * and flag `BM25_MIN_COV_MISMATCH` if Remote Config supplies a differing value.
 */
export function resolveBm25MinCov(remoteConfigValue?: number): Bm25MinCovResolution {
  const mismatch =
    remoteConfigValue !== undefined &&
    (!Number.isFinite(remoteConfigValue) ||
      gridKey(remoteConfigValue) !== gridKey(BM25_MIN_COV));
  return {
    value: BM25_MIN_COV,
    mismatch,
    code: mismatch ? "BM25_MIN_COV_MISMATCH" : null,
  };
}

/**
 * Filter keep predicate (`02` §8.3): a candidate unit `d` is discarded ONLY IF
 * `gridKey(cov(c, d)) < gridKey(bm25_min_cov)` AND `stems(c, d) < 2`.
 */
export function passesCoverageFilter(
  cov: number,
  stems: number,
  minCov: number = BM25_MIN_COV,
): boolean {
  return stems >= 2 || gridKey(cov) >= gridKey(minCov);
}

function resolveIdf(idfSource: IdfLookup, term: string): number {
  if (typeof idfSource === "function") {
    return idfSource(term);
  }
  if (idfSource instanceof Map) {
    return idfSource.get(term) ?? 0;
  }
  if ("get" in idfSource && typeof idfSource.get === "function") {
    return idfSource.get(term) ?? 0;
  }
  return getCorpusIdf(idfSource as Bm25Corpus, term);
}

/**
 * Computes IDF-weighted claim coverage `cov(c, d)` over the claim's own word terms `C(c)`
 * (`02` §8.3): excludes context terms and numeric `#...` tokens; returns `cov = 1.0` when
 * `C(c)` is empty.
 */
export function computeClaimCoverage(
  claimWordTerms: readonly string[],
  unitTokens: ReadonlySet<string> | readonly string[],
  idfSource: IdfLookup,
  minCov: number = BM25_MIN_COV,
): ClaimCoverageResult {
  const distinctClaimWords = new Set<string>();
  for (let i = 0; i < claimWordTerms.length; i++) {
    const tok = claimWordTerms[i]!;
    if (isWordBm25Token(tok)) {
      distinctClaimWords.add(tok);
    }
  }

  const sortedClaimWords = Array.from(distinctClaimWords).sort(compareCodeUnits);
  const minCovGrid = gridKey(minCov);

  if (sortedClaimWords.length === 0) {
    const cov = 1.0;
    const covGrid = gridKey(cov);
    return {
      cov,
      covGrid,
      stems: 0,
      sharedStems: [],
      claimTermCount: 0,
      kept: true,
      minCovUsed: minCov,
      minCovGrid,
    };
  }

  const unitSet: ReadonlySet<string> =
    unitTokens instanceof Set ? unitTokens : new Set(unitTokens);

  let totalIdf = 0;
  let matchedIdf = 0;
  const sharedStems: string[] = [];

  for (let i = 0; i < sortedClaimWords.length; i++) {
    const term = sortedClaimWords[i]!;
    const idf = resolveIdf(idfSource, term);
    totalIdf += idf;
    if (unitSet.has(term)) {
      matchedIdf += idf;
      sharedStems.push(term);
    }
  }

  const cov = totalIdf > 0 ? matchedIdf / totalIdf : 0;
  const covGrid = gridKey(cov);
  const stems = sharedStems.length;

  return {
    cov,
    covGrid,
    stems,
    sharedStems,
    claimTermCount: sortedClaimWords.length,
    kept: passesCoverageFilter(cov, stems, minCov),
    minCovUsed: minCov,
    minCovGrid,
  };
}

/**
 * Selects up to 5 evidence candidates for one `(clause, reference)` pair (`02` §8.5):
 * 1. Top 3 `ABSTRACT` units passing the coverage filter;
 * 2. Top 2 full-text (`FULLTEXT` or `USER_PDF`) units passing the coverage filter;
 * 3. Fill remaining slots (up to 5) from remaining kept units (including physical kinds);
 * 4. Order picked candidates by `compareBm25Candidates`;
 * 5. Filter out sanitizer-blocked candidates if `isUnitBlocked` is supplied, tracking `suspicious`.
 */
export function selectEvidenceCandidates(
  corpus: Bm25Corpus,
  refId: string,
  query: Bm25Query,
  options?: SelectEvidenceOptions,
): EvidenceSelectionResult {
  const minCov = options?.minCov ?? BM25_MIN_COV;
  const evaluated: EvaluatedCandidate[] = [];

  for (let i = 0; i < corpus.units.length; i++) {
    const unit = corpus.units[i]!;
    if (unit.refId !== refId) {
      continue;
    }
    const breakdown = scoreBm25Unit(corpus, query, unit);
    const coverage = computeClaimCoverage(
      query.claimWordTerms,
      unit.tokenSet,
      corpus,
      minCov,
    );
    evaluated.push({
      unit,
      ...breakdown,
      coverage,
    });
  }

  evaluated.sort(compareBm25Candidates);

  const keptAbstract: EvaluatedCandidate[] = [];
  const keptFulltext: EvaluatedCandidate[] = [];
  const keptRemaining: EvaluatedCandidate[] = [];

  for (let i = 0; i < evaluated.length; i++) {
    const item = evaluated[i]!;
    if (!item.coverage.kept) {
      continue;
    }
    const kind = item.unit.sourceKind;
    if (kind === "ABSTRACT") {
      if (keptAbstract.length < MAX_ABSTRACT_CANDIDATES) {
        keptAbstract.push(item);
      } else {
        keptRemaining.push(item);
      }
    } else if (kind === "FULLTEXT" || kind === "USER_PDF") {
      if (keptFulltext.length < MAX_FULLTEXT_CANDIDATES) {
        keptFulltext.push(item);
      } else {
        keptRemaining.push(item);
      }
    } else {
      keptRemaining.push(item);
    }
  }

  const picked: EvaluatedCandidate[] = [...keptAbstract, ...keptFulltext];
  for (let i = 0; i < keptRemaining.length && picked.length < MAX_EVIDENCE_CANDIDATES; i++) {
    picked.push(keptRemaining[i]!);
  }

  picked.sort(compareBm25Candidates);

  let suspicious = false;
  const finalSelected: EvaluatedCandidate[] = [];
  const blocker = options?.isUnitBlocked;
  if (blocker !== undefined) {
    for (let i = 0; i < picked.length; i++) {
      const cand = picked[i]!;
      if (blocker(cand.unit)) {
        suspicious = true;
      } else {
        finalSelected.push(cand);
      }
    }
  } else {
    for (let i = 0; i < picked.length; i++) {
      finalSelected.push(picked[i]!);
    }
  }

  return {
    selected: finalSelected,
    allScored: evaluated,
    candidates: finalSelected.length,
    suspicious,
    minCovUsed: minCov,
  };
}
