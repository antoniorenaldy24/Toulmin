/**
 * DEV `bm25_min_cov` Threshold Sweep Calibration & Report Generator
 * (`eval-harness/src/bm25Calibrate.ts`)
 * (`docs/spec/02_L0_TIER_A_PRE_DECODE.md` §8.3–§8.5; `07` §3.11, `AC-EVAL-07`).
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  BM25_MIN_COV,
  buildBm25Corpus,
  buildBm25Query,
  chunkAbstract,
  computeClaimCoverage,
  passesCoverageFilter,
  resolveBm25MinCov,
  type EvidenceUnit,
} from "@toulmin/core-l0";
import { gateGridKey } from "@toulmin/core-l0/gate";
import { parseJsonl } from "./manifest.js";
import { wilson } from "./stats.js";

/** Fixed fallback constant mandated by `07` §3.11 ("the default 0.25 is kept"). */
export const BM25_CALIBRATION_SPEC_FALLBACK = 0.25;

export type ClaimLengthStratum = "claim_len:1-4" | "claim_len:5-8" | "claim_len:>=9";
export type UnitLengthStratum = "unit_len:lt_avgdl" | "unit_len:gte_avgdl";

export interface DevPairForCalibration {
  readonly pairId: string;
  readonly claim: string;
  readonly abstract: string;
  readonly goldEvidenceSentenceIdx: readonly number[];
}

export interface DistractorAbstract {
  readonly refId: string;
  readonly abstract: string;
}

export interface Bm25CalibrationInput {
  readonly devPairs: readonly DevPairForCalibration[];
  readonly distractors?: readonly DistractorAbstract[];
  readonly corpusSizes?: readonly number[];
  readonly minRetention?: number;
}

export interface StratumRetentionRow {
  readonly stratum: string;
  readonly kept: number;
  readonly total: number;
  readonly retention: number;
  readonly wilsonLb95: number;
}

export interface Bm25CalibrationResult {
  readonly chosenTau: number;
  readonly usedDefaultFallback: boolean;
  readonly bundledValue: number;
  readonly matchesBundled: boolean;
  readonly minRetentionTarget: number;
  readonly corpusSizesEvaluated: readonly number[];
  readonly goldEvaluationsCount: number;
  readonly meanNonGoldKeptPerPair: number;
  readonly strataRows: readonly StratumRetentionRow[];
}

interface EvaluatedGoldRecord {
  readonly claimStratum: ClaimLengthStratum;
  readonly unitStratum: UnitLengthStratum;
  readonly corpusStratum: string;
  readonly cov: number;
  readonly stems: number;
}

interface EvaluatedPairUnitCov {
  readonly isGold: boolean;
  readonly cov: number;
  readonly stems: number;
}

function claimLengthStratumOf(claimTermCount: number): ClaimLengthStratum {
  if (claimTermCount <= 4) return "claim_len:1-4";
  if (claimTermCount <= 8) return "claim_len:5-8";
  return "claim_len:>=9";
}

function summarizeStratum(
  stratum: string,
  records: readonly EvaluatedGoldRecord[],
  tau: number
): StratumRetentionRow {
  const total = records.length;
  let kept = 0;
  for (const r of records) {
    if (passesCoverageFilter(r.cov, r.stems, tau)) {
      kept += 1;
    }
  }
  const retention = total > 0 ? kept / total : 1;
  const ci = wilson(kept, total);
  return {
    stratum,
    kept,
    total,
    retention,
    wilsonLb95: ci !== null ? ci[0] : 0,
  };
}

/**
 * Sweeps `tau` in `[0.05, 0.60]` (step `0.01`) on DEV pairs across corpus sizes and
 * chooses the largest `tau` keeping `>= 95%` of gold evidence units in every stratum (`07` §3.11).
 */
export function calibrateBm25MinCov(input: Bm25CalibrationInput): Bm25CalibrationResult {
  const minRetention = input.minRetention ?? 0.95;
  const minRetentionGrid = gateGridKey(minRetention);
  const requestedSizes = input.corpusSizes ?? [10, 50, 150];
  const distractors = input.distractors ?? [];

  const devUnitsByPair = new Map<string, readonly EvidenceUnit[]>();
  for (const p of input.devPairs) {
    devUnitsByPair.set(p.pairId, chunkAbstract(`dev:${p.pairId}`, p.abstract));
  }
  const distractorUnits: Array<{ refId: string; units: readonly EvidenceUnit[] }> = distractors.map((d) => ({
    refId: d.refId,
    units: chunkAbstract(d.refId, d.abstract),
  }));

  const allGoldRecords: EvaluatedGoldRecord[] = [];
  const allNonGoldBySize = new Map<number, EvaluatedPairUnitCov[]>();
  const evaluatedSizes: number[] = [];
  let totalPairEvaluations = 0;

  for (const targetSize of requestedSizes) {
    if (!Number.isInteger(targetSize) || targetSize <= 0) {
      throw new Error(`Invalid corpusSize "${String(targetSize)}": must be a positive integer`);
    }
    if (input.devPairs.length === 0) continue;
    evaluatedSizes.push(targetSize);
    const nonGoldList: EvaluatedPairUnitCov[] = [];
    allNonGoldBySize.set(targetSize, nonGoldList);

    // Partition ALL DEV pairs into groups of <= targetSize, filling remaining slots with distractors (`07` §3.11)
    for (let groupStart = 0; groupStart < input.devPairs.length; groupStart += targetSize) {
      const devGroup = input.devPairs.slice(groupStart, groupStart + targetSize);
      const neededDistractors = Math.max(0, targetSize - devGroup.length);

      const corpusInputs: Array<{
        chunkId: string;
        refId: string;
        sourceKind: "ABSTRACT";
        ordinal: number;
        section: string;
        text: string;
      }> = [];
      for (const p of devGroup) {
        const refId = `dev:${p.pairId}`;
        for (const u of devUnitsByPair.get(p.pairId) ?? []) {
          corpusInputs.push({
            chunkId: u.chunkId,
            refId,
            sourceKind: "ABSTRACT",
            ordinal: u.ordinal,
            section: u.section,
            text: u.text,
          });
        }
      }
      if (distractorUnits.length > 0) {
        for (let dOffset = 0; dOffset < neededDistractors && dOffset < distractorUnits.length; dOffset += 1) {
          const d = distractorUnits[dOffset]!;
          for (const u of d.units) {
            corpusInputs.push({
              chunkId: u.chunkId,
              refId: d.refId,
              sourceKind: "ABSTRACT",
              ordinal: u.ordinal,
              section: u.section,
              text: u.text,
            });
          }
        }
      }

      const corpus = buildBm25Corpus(corpusInputs);
      const avgdl = corpus.avgdl;

      for (const p of devGroup) {
        totalPairEvaluations += 1;
        const refId = `dev:${p.pairId}`;
        const query = buildBm25Query(p.claim);
        const claimStratum = claimLengthStratumOf(query.claimWordTerms.length);
        const goldSet = new Set(p.goldEvidenceSentenceIdx);

        for (const unit of corpus.units) {
          if (unit.refId !== refId) continue;
          const covRes = computeClaimCoverage(query.claimWordTerms, unit.tokenSet, corpus);
          const unitStratum: UnitLengthStratum =
            unit.length < avgdl ? "unit_len:lt_avgdl" : "unit_len:gte_avgdl";
          if (goldSet.has(unit.ordinal)) {
            allGoldRecords.push({
              claimStratum,
              unitStratum,
              corpusStratum: `corpus_size:${targetSize}`,
              cov: covRes.cov,
              stems: covRes.stems,
            });
          } else {
            nonGoldList.push({
              isGold: false,
              cov: covRes.cov,
              stems: covRes.stems,
            });
          }
        }
      }
    }
  }

  // Group records by every stratum for fast threshold sweep
  const strataMap = new Map<string, EvaluatedGoldRecord[]>();
  const addToStratum = (key: string, rec: EvaluatedGoldRecord): void => {
    let arr = strataMap.get(key);
    if (arr === undefined) {
      arr = [];
      strataMap.set(key, arr);
    }
    arr.push(rec);
  };

  for (const rec of allGoldRecords) {
    addToStratum(rec.claimStratum, rec);
    addToStratum(rec.unitStratum, rec);
    addToStratum(rec.corpusStratum, rec);
  }

  let chosenTau: number | null = null;
  for (let step = 60; step >= 5; step -= 1) {
    const tau = Number((step / 100).toFixed(2));
    let allStrataPass = strataMap.size > 0;
    for (const [, recs] of strataMap) {
      const row = summarizeStratum("check", recs, tau);
      if (gateGridKey(row.retention) < minRetentionGrid) {
        allStrataPass = false;
        break;
      }
    }
    if (allStrataPass) {
      chosenTau = tau;
      break;
    }
  }

  const usedDefaultFallback = chosenTau === null;
  const finalTau = chosenTau ?? BM25_CALIBRATION_SPEC_FALLBACK;

  const strataOrder = [
    "claim_len:1-4",
    "claim_len:5-8",
    "claim_len:>=9",
    "unit_len:lt_avgdl",
    "unit_len:gte_avgdl",
    ...requestedSizes.map((s) => `corpus_size:${s}`),
  ];

  const strataRows: StratumRetentionRow[] = [];
  for (const sName of strataOrder) {
    const recs = strataMap.get(sName);
    if (recs !== undefined && recs.length > 0) {
      strataRows.push(summarizeStratum(sName, recs, finalTau));
    }
  }

  // Non-gold kept per pair (reported across evaluated non-gold candidates)
  let totalNonGoldKept = 0;
  for (const [, list] of allNonGoldBySize) {
    for (const item of list) {
      if (passesCoverageFilter(item.cov, item.stems, finalTau)) {
        totalNonGoldKept += 1;
      }
    }
  }
  const pairEvalDenominator = Math.max(1, totalPairEvaluations);
  const meanNonGoldKeptPerPair = totalNonGoldKept / pairEvalDenominator;

  const bundledCheck = resolveBm25MinCov(finalTau);

  return {
    chosenTau: finalTau,
    usedDefaultFallback,
    bundledValue: BM25_MIN_COV,
    matchesBundled: !bundledCheck.mismatch,
    minRetentionTarget: minRetention,
    corpusSizesEvaluated: evaluatedSizes,
    goldEvaluationsCount: allGoldRecords.length,
    meanNonGoldKeptPerPair,
    strataRows,
  };
}

/**
 * Renders `bm25_calibration.md` with the normative wording required by `07` §3.11 and `AC-EVAL-07`.
 */
export function formatBm25CalibrationMarkdown(res: Bm25CalibrationResult): string {
  const lines: string[] = [
    "# BM25 `bm25_min_cov` Calibration Report (`bm25_calibration.md`)",
    "",
    `- Chosen threshold \`bm25_min_cov\` = **${res.chosenTau.toFixed(2)}**${res.usedDefaultFallback ? " (default fallback 0.25 applied because no tau >= 0.05 qualified in all strata)" : ""}`,
    `- Bundled Tier A value = \`${res.bundledValue.toFixed(2)}\` (matches bundled: \`${String(res.matchesBundled)}\`)`,
    `- Target retention per stratum >= ${(res.minRetentionTarget * 100).toFixed(0)}%`,
    `- Mean non-gold units kept per pair = ${res.meanNonGoldKeptPerPair.toFixed(3)}`,
    "",
    "## Per-Stratum Gold Retention",
    "",
    "| Stratum | Kept / Total | Retention | Wilson 95% LB |",
    "|---|---:|---:|---:|",
  ];

  for (const row of res.strataRows) {
    lines.push(
      `| \`${row.stratum}\` | ${row.kept} / ${row.total} | ${(row.retention * 100).toFixed(1)}% | ${row.wilsonLb95.toFixed(4)} |`
    );
  }

  lines.push(
    "",
    "## Statistical Status",
    "",
    "The calibration above is **descriptive on DEV** (45 DEV pairs across corpus sizes): it reports observed retention with per-stratum Wilson 95% lower bounds and is **not a population guarantee**. Structural bounded retrieval loss is enforced by the `stems >= 2` keep rule; residual loss is measured as `Recall@5` on DEV and R1-E.",
    ""
  );
  return `${lines.join("\n")}\n`;
}

export function runBm25CalibrateCli(argv: readonly string[]): number {
  let devFile: string | undefined;
  let distractorsFile: string | undefined;
  let corpusSizes: number[] = [10, 50, 150];
  let outFile: string | undefined;
  let checkBundled = false;
  let jsonFlag = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === "--json") {
      jsonFlag = true;
    } else if (arg === "--check-bundled") {
      checkBundled = true;
    } else if (arg === "--dev" && i + 1 < argv.length) {
      devFile = argv[++i]!;
    } else if (arg === "--distractors" && i + 1 < argv.length) {
      distractorsFile = argv[++i]!;
    } else if (arg === "--corpus-sizes" && i + 1 < argv.length) {
      const rawTokens = argv[++i]!
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      if (rawTokens.length === 0) {
        console.error("--corpus-sizes requires at least one positive integer");
        return 2;
      }
      corpusSizes = rawTokens.map((s) => Number(s));
      if (corpusSizes.some((n) => !Number.isInteger(n) || n <= 0)) {
        console.error(`Invalid --corpus-sizes value: every size must be a positive integer`);
        return 2;
      }
    } else if (arg === "--out" && i + 1 < argv.length) {
      outFile = argv[++i]!;
    } else {
      console.error(`Unknown or incomplete flag: ${arg}`);
      return 2;
    }
  }

  if (devFile === undefined) {
    console.error("--dev <dev_v2.jsonl> is required");
    return 2;
  }

  const parsedDev = parseJsonl(readFileSync(resolve(devFile), "utf8"), devFile);
  if (!parsedDev.ok) {
    console.error(parsedDev.error.message);
    return 1;
  }
  const devPairs: DevPairForCalibration[] = parsedDev.rows.map((r) => ({
    pairId: String(r.data["pairId"] ?? r.line),
    claim: String(r.data["claim"] ?? ""),
    abstract: String(r.data["abstract"] ?? ""),
    goldEvidenceSentenceIdx: Array.isArray(r.data["goldEvidenceSentenceIdx"])
      ? (r.data["goldEvidenceSentenceIdx"] as number[])
      : [],
  }));

  const distractors: DistractorAbstract[] = [];
  if (distractorsFile !== undefined) {
    const parsedDist = parseJsonl(readFileSync(resolve(distractorsFile), "utf8"), distractorsFile);
    if (!parsedDist.ok) {
      console.error(parsedDist.error.message);
      return 1;
    }
    for (const r of parsedDist.rows) {
      distractors.push({
        refId: String(r.data["refId"] ?? r.data["pairId"] ?? `dist-${r.line}`),
        abstract: String(r.data["abstract"] ?? ""),
      });
    }
  }

  const result = calibrateBm25MinCov({
    devPairs,
    distractors,
    corpusSizes,
  });
  const md = formatBm25CalibrationMarkdown(result);
  if (outFile !== undefined) {
    const absOut = resolve(outFile);
    mkdirSync(dirname(absOut), { recursive: true });
    writeFileSync(absOut, md, "utf8");
  }
  if (jsonFlag) {
    console.log(JSON.stringify(result));
  } else {
    console.log(md);
  }
  if (checkBundled && !result.matchesBundled) {
    return 1;
  }
  return 0;
}

const entryArg = process.argv[1];
if (entryArg !== undefined && pathToFileURL(resolve(entryArg)).href === import.meta.url) {
  process.exit(runBm25CalibrateCli(process.argv.slice(2)));
}
