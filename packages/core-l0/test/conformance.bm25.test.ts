import { describe, expect, it } from "vitest";
import vectors from "../../../conformance/l0/bm25.json" with { type: "json" };
import {
  buildBm25Corpus,
  buildBm25Query,
  computeClaimCoverage,
  rankBm25Units,
  selectEvidenceCandidates,
  tokBM25,
  type Bm25UnitInput,
  type EvidenceSourceKind,
} from "../src/index.js";

interface ExpectedScoreShape {
  readonly bm25: number;
  readonly bonus: number;
  readonly score: number;
  readonly gridScore: number;
}

interface GoldenUnitInput {
  readonly chunkId: string;
  readonly refId: string;
  readonly sourceKind: EvidenceSourceKind;
  readonly ordinal: number;
  readonly text: string;
  readonly tokens?: readonly string[];
}

interface TokBm25GoldenCase {
  readonly id: string;
  readonly op: "tokBM25";
  readonly input: string;
  readonly expected: readonly string[];
}

interface CoverageUnitExpected {
  readonly chunkId: string;
  readonly tokens: readonly string[];
  readonly expectedCov: number;
  readonly expectedCovGrid: number;
  readonly expectedStems: number;
  readonly expectedKept: boolean;
}

interface CoverageGoldenCase {
  readonly id: string;
  readonly op: "coverage";
  readonly claimWordTerms?: readonly string[];
  readonly claimText?: string;
  readonly idf: Readonly<Record<string, number>>;
  readonly bm25MinCov: number;
  readonly units: readonly CoverageUnitExpected[];
}

interface ScoreGoldenCase {
  readonly id: string;
  readonly op: "score";
  readonly claimText: string;
  readonly sentenceText?: string;
  readonly units: readonly GoldenUnitInput[];
  readonly expectedRanking: readonly string[];
  readonly expectedScores: Readonly<Record<string, ExpectedScoreShape>>;
}

interface RankTieGoldenCase {
  readonly id: string;
  readonly op: "rankTie";
  readonly claimText: string;
  readonly idfOverrides: Readonly<Record<string, number>>;
  readonly units: readonly GoldenUnitInput[];
  readonly expectedGridScore: number;
  readonly expectedRanking: readonly string[];
}

interface QuantityBonusGoldenCase {
  readonly id: string;
  readonly op: "quantityBonus";
  readonly claimText: string;
  readonly units: readonly GoldenUnitInput[];
  readonly expectedBonusByChunk: Readonly<Record<string, number>>;
  readonly expectedScoresByChunk?: Readonly<Record<string, ExpectedScoreShape>>;
  readonly expectedRanking?: readonly string[];
}

interface CorpusScaleGoldenCase {
  readonly id: string;
  readonly op: "corpusScale";
  readonly claimText: string;
  readonly targetRefId: string;
  readonly targetUnit: { readonly chunkId: string; readonly text: string };
  readonly backgroundRefCount: number;
  readonly backgroundUnitText: string;
  readonly expectedDocCount: number;
  readonly expectedTargetScore: number;
  readonly expectedTargetGridScore: number;
  readonly expectedTargetCov: number;
  readonly expectedTargetCovGrid: number;
  readonly expectedTargetKept: boolean;
  readonly expectedBgCov: number;
  readonly expectedBgCovGrid: number;
  readonly expectedBgKept: boolean;
  readonly expectedSelectedChunkIds: readonly string[];
}

interface SelectGoldenCase {
  readonly id: string;
  readonly op: "select";
  readonly claimText: string;
  readonly refId: string;
  readonly units: readonly GoldenUnitInput[];
  readonly expectedSelectedChunkIds: readonly string[];
  readonly expectedCandidates: number;
  readonly expectedSuspicious: boolean;
}

type Bm25GoldenCase =
  | TokBm25GoldenCase
  | CoverageGoldenCase
  | ScoreGoldenCase
  | RankTieGoldenCase
  | QuantityBonusGoldenCase
  | CorpusScaleGoldenCase
  | SelectGoldenCase;

describe("conformance/l0/bm25.json", () => {
  const cases = vectors as unknown as readonly Bm25GoldenCase[];

  for (const tc of cases) {
    it(`${tc.id}`, () => {
      switch (tc.op) {
        case "tokBM25": {
          expect(tokBM25(tc.input)).toEqual(tc.expected);
          break;
        }
        case "coverage": {
          const idfMap = new Map<string, number>(Object.entries(tc.idf));
          const claimWords =
            tc.claimWordTerms !== undefined
              ? tc.claimWordTerms
              : buildBm25Query(tc.claimText ?? "").claimWordTerms;
          for (const u of tc.units) {
            const res = computeClaimCoverage(claimWords, u.tokens, idfMap, tc.bm25MinCov);
            expect(Math.abs(res.cov - u.expectedCov)).toBeLessThanOrEqual(1e-9);
            expect(res.covGrid).toBe(u.expectedCovGrid);
            expect(res.stems).toBe(u.expectedStems);
            expect(res.kept).toBe(u.expectedKept);
          }
          break;
        }
        case "score": {
          const corpus = buildBm25Corpus(tc.units);
          const query = buildBm25Query(tc.claimText, tc.sentenceText);
          const ranked = rankBm25Units(corpus, query);
          expect(ranked.map((r) => r.unit.chunkId)).toEqual(tc.expectedRanking);
          for (const r of ranked) {
            const exp = tc.expectedScores[r.unit.chunkId]!;
            expect(Math.abs(r.bm25 - exp.bm25)).toBeLessThanOrEqual(1e-9);
            expect(r.bonus).toBe(exp.bonus);
            expect(Math.abs(r.score - exp.score)).toBeLessThanOrEqual(1e-9);
            expect(r.gridScore).toBe(exp.gridScore);
          }
          break;
        }
        case "rankTie": {
          const idfOverrides = new Map<string, number>(Object.entries(tc.idfOverrides));
          const corpus = buildBm25Corpus(tc.units, { idfOverrides });
          const query = buildBm25Query(tc.claimText);
          const ranked = rankBm25Units(corpus, query);
          expect(ranked.map((r) => r.unit.chunkId)).toEqual(tc.expectedRanking);
          for (const r of ranked) {
            expect(r.gridScore).toBe(tc.expectedGridScore);
          }
          break;
        }
        case "quantityBonus": {
          const corpus = buildBm25Corpus(tc.units);
          const query = buildBm25Query(tc.claimText);
          const ranked = rankBm25Units(corpus, query);
          for (const r of ranked) {
            expect(r.bonus).toBe(tc.expectedBonusByChunk[r.unit.chunkId]);
            if (tc.expectedScoresByChunk !== undefined) {
              const exp = tc.expectedScoresByChunk[r.unit.chunkId]!;
              expect(Math.abs(r.bm25 - exp.bm25)).toBeLessThanOrEqual(1e-9);
              expect(Math.abs(r.score - exp.score)).toBeLessThanOrEqual(1e-9);
              expect(r.gridScore).toBe(exp.gridScore);
            }
          }
          if (tc.expectedRanking !== undefined) {
            expect(ranked.map((r) => r.unit.chunkId)).toEqual(tc.expectedRanking);
          }
          break;
        }
        case "corpusScale": {
          const inputs: Bm25UnitInput[] = [
            {
              chunkId: tc.targetUnit.chunkId,
              refId: tc.targetRefId,
              sourceKind: "ABSTRACT",
              ordinal: 0,
              text: tc.targetUnit.text,
            },
          ];
          for (let i = 1; i <= tc.backgroundRefCount; i++) {
            inputs.push({
              chunkId: `bg-${i}`,
              refId: `r-bg-${i}`,
              sourceKind: "ABSTRACT",
              ordinal: 0,
              text: tc.backgroundUnitText,
            });
          }
          const corpus = buildBm25Corpus(inputs);
          expect(corpus.docCount).toBe(tc.expectedDocCount);
          const query = buildBm25Query(tc.claimText);
          const ranked = rankBm25Units(corpus, query);
          const targetRow = ranked.find((r) => r.unit.chunkId === tc.targetUnit.chunkId)!;
          expect(Math.abs(targetRow.score - tc.expectedTargetScore)).toBeLessThanOrEqual(1e-9);
          expect(targetRow.gridScore).toBe(tc.expectedTargetGridScore);

          const targetCov = computeClaimCoverage(
            query.claimWordTerms,
            targetRow.unit.tokenSet,
            corpus,
          );
          expect(Math.abs(targetCov.cov - tc.expectedTargetCov)).toBeLessThanOrEqual(1e-9);
          expect(targetCov.covGrid).toBe(tc.expectedTargetCovGrid);
          expect(targetCov.kept).toBe(tc.expectedTargetKept);

          const bgRow = ranked.find((r) => r.unit.chunkId === "bg-1")!;
          const bgCov = computeClaimCoverage(query.claimWordTerms, bgRow.unit.tokenSet, corpus);
          expect(Math.abs(bgCov.cov - tc.expectedBgCov)).toBeLessThanOrEqual(1e-9);
          expect(bgCov.covGrid).toBe(tc.expectedBgCovGrid);
          expect(bgCov.kept).toBe(tc.expectedBgKept);

          const sel = selectEvidenceCandidates(corpus, tc.targetRefId, query);
          expect(sel.selected.map((s) => s.unit.chunkId)).toEqual(tc.expectedSelectedChunkIds);
          break;
        }
        case "select": {
          const corpus = buildBm25Corpus(tc.units);
          const query = buildBm25Query(tc.claimText);
          const sel = selectEvidenceCandidates(corpus, tc.refId, query);
          expect(sel.selected.map((s) => s.unit.chunkId)).toEqual(tc.expectedSelectedChunkIds);
          expect(sel.candidates).toBe(tc.expectedCandidates);
          expect(sel.suspicious).toBe(tc.expectedSuspicious);
          break;
        }
      }
    });
  }
});
