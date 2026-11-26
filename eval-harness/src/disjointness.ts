/**
 * Evaluation Dataset Disjointness Checker, N-Pair Topical Relatedness Guard,
 * and Dual-Annotator Independence + Cohen's Kappa Evaluator (`eval-harness/src/disjointness.ts`)
 * (`docs/spec/07_EVAL_SPIKES_AND_ACCEPTANCE.md` §2.2, §3.2, §3.4, §4.5, `AC-EVAL-01`, `AC-EVAL-02`).
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  buildBm25Corpus,
  buildBm25Query,
  chunkAbstract,
  computeClaimCoverage,
  normLower,
  normalizedClaimHash,
  sha256hex,
} from "@toulmin/core-l0";
import { gateGridKey } from "@toulmin/core-l0/gate";
import type { ProbeLetter } from "@toulmin/schemas";
import {
  SEED_B2_SUBSAMPLE,
  SEED_BOOTSTRAP,
  cohensKappa,
  percentileType7,
  wilson,
  type CohensKappaResult,
} from "./stats.js";
import { compareUtf8Bytes, inferDatasetKind, parseJsonl } from "./manifest.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEFAULT_REPO_ROOT = resolve(__dirname, "..", "..");

export type OverlapKind =
  | "DOI"
  | "REF_ID"
  | "PAPER_ID"
  | "CLAIM_HASH"
  | "TEXT";

export interface DisjointnessOverlap {
  readonly kind: OverlapKind;
  readonly value: string;
  readonly splits: readonly string[];
  readonly rowIds: readonly string[];
}

export interface NPairRelatednessViolation {
  readonly pairId: string;
  readonly topCov: number;
  readonly medianSTopCov: number;
}

export interface DisjointnessSplitInput {
  readonly splitName: string;
  readonly rows: readonly Record<string, unknown>[];
}

export interface DisjointnessResult {
  readonly ok: boolean;
  readonly splitsChecked: readonly string[];
  readonly overlaps: readonly DisjointnessOverlap[];
  readonly nPairViolations: readonly NPairRelatednessViolation[];
  readonly medianSTopCov: number | null;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function extractRowId(row: Record<string, unknown>, idx: number): string {
  for (const k of ["pairId", "itemId", "id"]) {
    const v = row[k];
    if (typeof v === "string" && v.trim().length > 0) {
      return v.trim();
    }
  }
  return `row-${idx + 1}`;
}

function addNormIdentifier(
  index: Map<string, { splits: Set<string>; rowIds: Set<string> }>,
  kind: OverlapKind,
  normValue: string,
  splitName: string,
  rowId: string
): void {
  if (normValue.length === 0) return;
  const key = `${kind}\0${normValue}`;
  let entry = index.get(key);
  if (entry === undefined) {
    entry = { splits: new Set<string>(), rowIds: new Set<string>() };
    index.set(key, entry);
  }
  entry.splits.add(splitName);
  entry.rowIds.add(`${splitName}:${rowId}`);
}

function normalizeIdToken(raw: string): string {
  return normLower(raw.trim());
}

/**
 * Checks pairwise dataset disjointness across all provided splits (unified `TEXT`
 * namespace for `sha256hex(normLower(text))` across claims, sentences, windows, and
 * abstracts, plus `CLAIM_HASH`, `DOI`, `REF_ID`, `PAPER_ID`) and verifies R1-E N-pair
 * topical relatedness against S-pair median `cov` (`AC-EVAL-01`, `07` §2.2 & §3.2).
 */
export function checkDatasetDisjointness(
  splits: readonly DisjointnessSplitInput[]
): DisjointnessResult {
  const index = new Map<string, { splits: Set<string>; rowIds: Set<string> }>();
  const r1ePairs: Array<{
    pairId: string;
    groupKey: string;
    gold: string;
    claim: string;
    refId: string;
    units: ReturnType<typeof chunkAbstract>;
  }> = [];
  const r1eGroupDistractors: Array<{
    groupKey: string;
    refId: string;
    units: ReturnType<typeof chunkAbstract>;
  }> = [];

  for (const split of splits) {
    const splitKind = inferDatasetKind(split.splitName);

    if (splitKind === "R1-E-GROUPS") {
      for (let i = 0; i < split.rows.length; i += 1) {
        const row = split.rows[i]!;
        const groupKey = String(row["group"] ?? "default");
        const distractors = Array.isArray(row["distractors"]) ? row["distractors"] : [row];
        for (let dIdx = 0; dIdx < distractors.length; dIdx += 1) {
          const d = distractors[dIdx];
          if (!isPlainObject(d) || typeof d["abstract"] !== "string" || d["abstract"].trim().length === 0) {
            continue;
          }
          const refId = String(d["refId"] ?? d["doi"] ?? `dist:${groupKey}:${i}:${dIdx}`);
          const units = chunkAbstract(refId, d["abstract"]);
          if (units.length > 0) {
            r1eGroupDistractors.push({ groupKey, refId, units });
          }
        }
      }
      continue;
    }

    for (let i = 0; i < split.rows.length; i += 1) {
      const row = split.rows[i]!;
      const rowId = extractRowId(row, i);

      // DOIs
      if (typeof row["doi"] === "string") {
        addNormIdentifier(index, "DOI", normalizeIdToken(row["doi"]), split.splitName, rowId);
      }
      if (Array.isArray(row["dois"])) {
        for (const d of row["dois"]) {
          if (typeof d === "string") {
            addNormIdentifier(index, "DOI", normalizeIdToken(d), split.splitName, rowId);
          }
        }
      }
      const refObj = row["reference"];
      if (isPlainObject(refObj)) {
        if (typeof refObj["doi"] === "string") {
          addNormIdentifier(index, "DOI", normalizeIdToken(refObj["doi"]), split.splitName, rowId);
        }
        if (typeof refObj["refId"] === "string") {
          addNormIdentifier(index, "REF_ID", normalizeIdToken(refObj["refId"]), split.splitName, rowId);
        }
      }

      // refId / paperId
      if (typeof row["refId"] === "string") {
        addNormIdentifier(index, "REF_ID", normalizeIdToken(row["refId"]), split.splitName, rowId);
      }
      if (typeof row["paperId"] === "string") {
        addNormIdentifier(index, "PAPER_ID", normalizeIdToken(row["paperId"]), split.splitName, rowId);
      }

      // Normalized ClaimHash
      if (typeof row["claim"] === "string" && row["claim"].trim().length > 0) {
        addNormIdentifier(
          index,
          "CLAIM_HASH",
          normalizedClaimHash(row["claim"]),
          split.splitName,
          rowId
        );
      }

      // Unified TEXT namespace (`07` §2.2: sha256(normLower(text)) across claim, abstract, sentence, evidence, units)
      for (const field of ["claim", "sentence", "contextSentence", "abstract", "citedAbstract", "text"] as const) {
        const val = row[field];
        if (typeof val === "string" && val.trim().length > 0) {
          addNormIdentifier(index, "TEXT", sha256hex(normLower(val)), split.splitName, rowId);
        }
      }
      for (const arrField of ["evidence", "units"] as const) {
        const arrVal = row[arrField];
        if (Array.isArray(arrVal)) {
          for (const item of arrVal) {
            if (typeof item === "string" && item.trim().length > 0) {
              addNormIdentifier(index, "TEXT", sha256hex(normLower(item)), split.splitName, rowId);
            } else if (isPlainObject(item) && typeof item["text"] === "string" && item["text"].trim().length > 0) {
              addNormIdentifier(index, "TEXT", sha256hex(normLower(item["text"])), split.splitName, rowId);
            }
          }
        }
      }
      for (const side of ["a", "b"] as const) {
        const sideObj = row[side];
        if (isPlainObject(sideObj) && typeof sideObj["window"] === "string" && sideObj["window"].trim().length > 0) {
          addNormIdentifier(
            index,
            "TEXT",
            sha256hex(normLower(sideObj["window"])),
            split.splitName,
            rowId
          );
        }
      }

      // Collect ONLY true R1-E rows (all S, C, N pairs) for BM25 corpus & N-pair relatedness (`07` §3.2)
      if (
        splitKind === "R1-E" &&
        (row["gold"] === "S" || row["gold"] === "C" || row["gold"] === "N") &&
        typeof row["claim"] === "string" &&
        typeof row["abstract"] === "string" &&
        row["abstract"].trim().length > 0
      ) {
        const groupKey = row["group"] !== undefined ? String(row["group"]) : "default";
        const refId = `r1e:${split.splitName}:${rowId}`;
        const units = chunkAbstract(refId, row["abstract"]);
        if (units.length > 0) {
          r1ePairs.push({
            pairId: rowId,
            groupKey,
            gold: row["gold"],
            claim: row["claim"],
            refId,
            units,
          });
        }
      }
    }
  }

  const overlaps: DisjointnessOverlap[] = [];
  for (const [compoundKey, entry] of index) {
    if (entry.splits.size <= 1) continue;
    const sepIdx = compoundKey.indexOf("\0");
    const kind = compoundKey.slice(0, sepIdx) as OverlapKind;
    const value = compoundKey.slice(sepIdx + 1);
    overlaps.push({
      kind,
      value,
      splits: Array.from(entry.splits).sort(compareUtf8Bytes),
      rowIds: Array.from(entry.rowIds).sort(compareUtf8Bytes),
    });
  }
  overlaps.sort((a, b) => {
    const k = compareUtf8Bytes(a.kind, b.kind);
    return k !== 0 ? k : compareUtf8Bytes(a.value, b.value);
  });

  // Evaluate R1-E N-pair relatedness over each group corpus (all S/C/N abstracts + distractors)
  const sTopCovs: number[] = [];
  const nPairs: Array<{ pairId: string; topCov: number }> = [];

  if (r1ePairs.length > 0) {
    const pairsByGroup = new Map<string, typeof r1ePairs>();
    for (const p of r1ePairs) {
      let arr = pairsByGroup.get(p.groupKey);
      if (arr === undefined) {
        arr = [];
        pairsByGroup.set(p.groupKey, arr);
      }
      arr.push(p);
    }

    for (const [gKey, gPairs] of pairsByGroup) {
      const corpusUnits = [
        ...gPairs.flatMap((item) =>
          item.units.map((u) => ({
            chunkId: u.chunkId,
            refId: item.refId,
            sourceKind: u.sourceKind,
            ordinal: u.ordinal,
            section: u.section,
            text: u.text,
          }))
        ),
        ...r1eGroupDistractors
          .filter((d) => d.groupKey === gKey || d.groupKey === "default")
          .flatMap((d) =>
            d.units.map((u) => ({
              chunkId: u.chunkId,
              refId: d.refId,
              sourceKind: u.sourceKind,
              ordinal: u.ordinal,
              section: u.section,
              text: u.text,
            }))
          ),
      ];
      const corpus = buildBm25Corpus(corpusUnits);
      for (const item of gPairs) {
        if (item.gold === "C") continue;
        const query = buildBm25Query(item.claim);
        let bestCov = 0;
        for (const indexedUnit of corpus.units) {
          if (indexedUnit.refId !== item.refId) continue;
          const covRes = computeClaimCoverage(query.claimWordTerms, indexedUnit.tokenSet, corpus);
          if (covRes.cov > bestCov) {
            bestCov = covRes.cov;
          }
        }
        if (item.gold === "S") {
          sTopCovs.push(bestCov);
        } else {
          nPairs.push({ pairId: item.pairId, topCov: bestCov });
        }
      }
    }
  }

  let medianSTopCov: number | null = null;
  const nPairViolations: NPairRelatednessViolation[] = [];
  if (sTopCovs.length > 0 && nPairs.length > 0) {
    medianSTopCov = percentileType7(sTopCovs, 0.5);
    const medianGrid = gateGridKey(medianSTopCov);
    for (const np of nPairs) {
      if (gateGridKey(np.topCov) < medianGrid) {
        nPairViolations.push({
          pairId: np.pairId,
          topCov: np.topCov,
          medianSTopCov,
        });
      }
    }
    nPairViolations.sort((a, b) => compareUtf8Bytes(a.pairId, b.pairId));
  }

  return {
    ok: overlaps.length === 0 && nPairViolations.length === 0,
    splitsChecked: splits.map((s) => s.splitName),
    overlaps,
    nPairViolations,
    medianSTopCov,
  };
}

// ───────────────────────── Annotator Independence & Cohen's Kappa (`AC-EVAL-02`) ─────────────────────────

export const KAPPA_TARGET_MIN = 0.70;

export interface AnnotatorPairLabel {
  readonly pairId: string;
  readonly subtype?: string;
  readonly a1: ProbeLetter;
  readonly a2: ProbeLetter;
  readonly isSGray?: boolean;
  readonly majorityVerdict?: ProbeLetter;
}

export interface B2AnnotatorPairLabel {
  readonly itemId: string;
  readonly a1: "HIGH" | "LOW";
  readonly a2: "HIGH" | "LOW";
}

export interface AnnotatorEvaluationInput {
  readonly annotators: {
    readonly a1: string;
    readonly a2: string;
    readonly a3: string;
  };
  readonly pairAuthors: readonly string[];
  readonly promptAuthors: readonly string[];
  readonly repoRoot?: string;
  readonly checkGit?: boolean;
  readonly authorFilesTouched?: Readonly<Record<string, readonly string[]>>;
  readonly round1Subsample: readonly AnnotatorPairLabel[];
  readonly allR1ePairs?: readonly { readonly pairId: string; readonly subtype: string }[];
  readonly sGrayPairs?: readonly AnnotatorPairLabel[];
  readonly round2Resubsample?: readonly AnnotatorPairLabel[];
  readonly b2Subsample?: readonly B2AnnotatorPairLabel[];
  readonly a3AdjudicationCount?: number;
  readonly substitutedPairsCount?: number;
  readonly bootstrapIterations?: number;
}

export type AnnotationStatus =
  | "PASS"
  | "NEEDS_TARGETED_ADJUDICATION"
  | "PASS_AFTER_ADJUDICATION"
  | "BELOW_TARGET_FINAL"
  | "INDEPENDENCE_FAILED";

export interface SGrayBoundSummary {
  readonly subtype: string;
  readonly count: number;
  readonly agreedCount: number;
  readonly falseContradictions: number;
  readonly wilsonUb95: number;
}

export interface GitAuthorRecord {
  readonly author: string;
  readonly filesTouched: readonly string[];
}

export interface AnnotatorEvaluationResult {
  readonly ok: boolean;
  readonly independenceOk: boolean;
  readonly independenceErrors: readonly string[];
  readonly annotators: {
    readonly a1: string;
    readonly a2: string;
    readonly a3: string;
  };
  readonly pairAuthors: readonly string[];
  readonly promptAuthors: readonly string[];
  readonly gitAuthorRecords: readonly GitAuthorRecord[];
  readonly status: AnnotationStatus;
  readonly kappaOk: boolean;
  readonly round1Kappa: CohensKappaResult;
  readonly round1ConfusionMatrix: Readonly<Record<ProbeLetter, Readonly<Record<ProbeLetter, number>>>>;
  readonly round2Kappa: CohensKappaResult | null;
  readonly targetSubtypes: readonly string[];
  readonly targetPairIds: readonly string[];
  readonly sGrayOverall: SGrayBoundSummary | null;
  readonly sGrayBySubtype: readonly SGrayBoundSummary[];
  readonly b2Kappa: CohensKappaResult | null;
  readonly b2Ok: boolean;
  readonly a3AdjudicationCount: number;
  readonly substitutedPairsCount: number;
  readonly metadata: {
    readonly seedsUsed: {
      readonly bootstrap: number;
      readonly b2Subsample: number;
    };
  };
}

function collectGitAuthorRecords(
  repoRoot: string,
  relPaths: readonly string[]
): Map<string, Set<string>> {
  const authorFiles = new Map<string, Set<string>>();
  if (!existsSync(resolve(repoRoot, ".git"))) {
    return authorFiles;
  }

  for (const rel of relPaths) {
    try {
      const stdout = execFileSync(
        "git",
        ["log", "--name-only", "--format=@@AUTHOR@@%an%n@@EMAIL@@%ae", "--", rel],
        { cwd: repoRoot, encoding: "utf8" }
      );
      let curAuthor = "";
      let curEmail = "";
      for (const rawLine of stdout.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (line.length === 0) continue;
        if (line.startsWith("@@AUTHOR@@")) {
          curAuthor = normalizeIdToken(line.slice("@@AUTHOR@@".length));
          if (curAuthor.length > 0 && !authorFiles.has(curAuthor)) {
            authorFiles.set(curAuthor, new Set<string>());
          }
        } else if (line.startsWith("@@EMAIL@@")) {
          curEmail = normalizeIdToken(line.slice("@@EMAIL@@".length));
          if (curEmail.length > 0 && !authorFiles.has(curEmail)) {
            authorFiles.set(curEmail, new Set<string>());
          }
        } else {
          if (curAuthor.length > 0) authorFiles.get(curAuthor)!.add(line);
          if (curEmail.length > 0) authorFiles.get(curEmail)!.add(line);
        }
      }
    } catch {
      // Target path may not exist or have commits yet; ignore gracefully
    }
  }
  return authorFiles;
}

function build3x3ConfusionMatrix(
  items: readonly AnnotatorPairLabel[]
): Record<ProbeLetter, Record<ProbeLetter, number>> {
  const mat: Record<ProbeLetter, Record<ProbeLetter, number>> = {
    S: { S: 0, C: 0, N: 0 },
    C: { S: 0, C: 0, N: 0 },
    N: { S: 0, C: 0, N: 0 },
  };
  for (const item of items) {
    mat[item.a1][item.a2] += 1;
  }
  return mat;
}

function summarizeSGrayGroup(subtype: string, items: readonly AnnotatorPairLabel[]): SGrayBoundSummary {
  let agreed = 0;
  let falseContra = 0;
  for (const item of items) {
    if (item.a1 === item.a2) agreed += 1;
    if (item.majorityVerdict === "C") falseContra += 1;
  }
  const ub = items.length > 0 ? (wilson(falseContra, items.length)?.[1] ?? 1) : 1;
  return {
    subtype,
    count: items.length,
    agreedCount: agreed,
    falseContradictions: falseContra,
    wilsonUb95: ub,
  };
}

/**
 * Evaluates annotator independence (including git authors of `eval-harness/data/r1e_v2.jsonl`
 * and `packages/prompts/`), Round-1/Round-2 Cohen's κ against 0.70, `S-GRAY` bounds outside κ,
 * B2 subsample agreement, and targeted adjudication (`07` §3.4, `AC-EVAL-02`).
 */
export function evaluateAnnotators(
  input: AnnotatorEvaluationInput
): AnnotatorEvaluationResult {
  const independenceErrors: string[] = [];
  const a1Norm = normalizeIdToken(input.annotators.a1);
  const a2Norm = normalizeIdToken(input.annotators.a2);
  const a3Norm = normalizeIdToken(input.annotators.a3);

  if (a1Norm.length === 0 || a2Norm.length === 0 || a3Norm.length === 0) {
    independenceErrors.push("Annotators a1, a2, a3 must all be non-empty.");
  }
  if (a1Norm === a2Norm || a1Norm === a3Norm || a2Norm === a3Norm) {
    independenceErrors.push("Annotators a1, a2, and a3 must be three distinct people.");
  }

  const authorFilesMap = new Map<string, Set<string>>();
  const ensureAuthorFiles = (author: string): Set<string> => {
    const key = normalizeIdToken(author);
    let set = authorFilesMap.get(key);
    if (set === undefined) {
      set = new Set<string>();
      authorFilesMap.set(key, set);
    }
    return set;
  };

  for (const p of input.pairAuthors) {
    if (p.trim().length > 0) {
      const files = ensureAuthorFiles(p);
      files.add("eval-harness/data/r1e_v2.jsonl");
    }
  }
  for (const p of input.promptAuthors) {
    if (p.trim().length > 0) {
      const files = ensureAuthorFiles(p);
      files.add("packages/prompts/");
    }
  }
  if (input.authorFilesTouched !== undefined) {
    for (const [author, touched] of Object.entries(input.authorFilesTouched)) {
      const set = ensureAuthorFiles(author);
      for (const f of touched) set.add(f);
    }
  }

  if (input.checkGit !== false) {
    const gitRoot = input.repoRoot ?? DEFAULT_REPO_ROOT;
    const gitDiscovered = collectGitAuthorRecords(gitRoot, [
      "eval-harness/data/r1e_v2.jsonl",
      "packages/prompts",
    ]);
    for (const [author, touched] of gitDiscovered) {
      const set = ensureAuthorFiles(author);
      for (const f of touched) set.add(f);
    }
  }

  const gitAuthorRecords: GitAuthorRecord[] = [];
  for (const author of Array.from(authorFilesMap.keys()).sort(compareUtf8Bytes)) {
    gitAuthorRecords.push({
      author,
      filesTouched: Array.from(authorFilesMap.get(author)!).sort(compareUtf8Bytes),
    });
  }

  for (const [role, id] of [
    ["A1", a1Norm],
    ["A2", a2Norm],
    ["A3", a3Norm],
  ] as const) {
    const touched = authorFilesMap.get(id);
    if (touched !== undefined) {
      const touchedList = Array.from(touched).sort(compareUtf8Bytes).join(", ");
      independenceErrors.push(
        `${role} ("${id}") authored R1-E pairs or /packages/prompts/ (${touchedList}; forbidden by 07 §3.4).`
      );
    }
  }
  const independenceOk = independenceErrors.length === 0;

  const nonGrayRound1 = input.round1Subsample.filter((x) => x.isSGray !== true && x.subtype !== "S-GRAY");
  const bootIter = input.bootstrapIterations ?? 2000;
  const round1Kappa = cohensKappa(
    nonGrayRound1.map((x) => x.a1),
    nonGrayRound1.map((x) => x.a2),
    { bootstrapIterations: bootIter, seed: SEED_BOOTSTRAP }
  );
  const round1ConfusionMatrix = build3x3ConfusionMatrix(nonGrayRound1);

  const disagreed = nonGrayRound1.filter((x) => x.a1 !== x.a2);
  const targetSubtypeSet = new Set<string>();
  const targetPairIdSet = new Set<string>();
  for (const d of disagreed) {
    targetPairIdSet.add(d.pairId);
    if (d.subtype !== undefined && d.subtype.trim().length > 0) {
      targetSubtypeSet.add(d.subtype);
    }
  }
  if (input.allR1ePairs !== undefined) {
    for (const row of input.allR1ePairs) {
      if (targetSubtypeSet.has(row.subtype)) {
        targetPairIdSet.add(row.pairId);
      }
    }
  }

  const r1Pass =
    nonGrayRound1.length > 0 && gateGridKey(round1Kappa.kappa) >= gateGridKey(KAPPA_TARGET_MIN);

  let round2Kappa: CohensKappaResult | null = null;
  let status: AnnotationStatus;
  let kappaOk: boolean;

  if (!independenceOk) {
    status = "INDEPENDENCE_FAILED";
    kappaOk = false;
  } else if (r1Pass) {
    status = "PASS";
    kappaOk = true;
  } else if (input.round2Resubsample !== undefined && input.round2Resubsample.length > 0) {
    const nonGrayRound2 = input.round2Resubsample.filter(
      (x) => x.isSGray !== true && x.subtype !== "S-GRAY"
    );
    round2Kappa = cohensKappa(
      nonGrayRound2.map((x) => x.a1),
      nonGrayRound2.map((x) => x.a2),
      { bootstrapIterations: bootIter, seed: SEED_BOOTSTRAP }
    );
    if (gateGridKey(round2Kappa.kappa) >= gateGridKey(KAPPA_TARGET_MIN)) {
      status = "PASS_AFTER_ADJUDICATION";
      kappaOk = true;
    } else {
      status = "BELOW_TARGET_FINAL";
      kappaOk = false;
    }
  } else {
    status = "NEEDS_TARGETED_ADJUDICATION";
    kappaOk = false;
  }

  const sGrayItems = input.sGrayPairs ?? input.round1Subsample.filter((x) => x.isSGray === true || x.subtype === "S-GRAY");
  const sGrayOverall = sGrayItems.length > 0 ? summarizeSGrayGroup("S-GRAY_ALL", sGrayItems) : null;
  const bySubtype = new Map<string, AnnotatorPairLabel[]>();
  for (const item of sGrayItems) {
    const sub = item.subtype ?? "S-GRAY";
    let list = bySubtype.get(sub);
    if (list === undefined) {
      list = [];
      bySubtype.set(sub, list);
    }
    list.push(item);
  }
  const sGrayBySubtype: SGrayBoundSummary[] = [];
  for (const sub of Array.from(bySubtype.keys()).sort(compareUtf8Bytes)) {
    sGrayBySubtype.push(summarizeSGrayGroup(sub, bySubtype.get(sub)!));
  }

  let b2Kappa: CohensKappaResult | null = null;
  let b2Ok = true;
  if (input.b2Subsample !== undefined && input.b2Subsample.length > 0) {
    b2Kappa = cohensKappa(
      input.b2Subsample.map((x) => x.a1),
      input.b2Subsample.map((x) => x.a2),
      { bootstrapIterations: bootIter, seed: SEED_BOOTSTRAP }
    );
    b2Ok = gateGridKey(b2Kappa.kappa) >= gateGridKey(KAPPA_TARGET_MIN);
  }

  const ok =
    independenceOk &&
    b2Ok &&
    (status === "PASS" || status === "PASS_AFTER_ADJUDICATION");

  return {
    ok,
    independenceOk,
    independenceErrors,
    annotators: {
      a1: input.annotators.a1,
      a2: input.annotators.a2,
      a3: input.annotators.a3,
    },
    pairAuthors: [...input.pairAuthors],
    promptAuthors: [...input.promptAuthors],
    gitAuthorRecords,
    status,
    kappaOk,
    round1Kappa,
    round1ConfusionMatrix,
    round2Kappa,
    targetSubtypes: Array.from(targetSubtypeSet).sort(compareUtf8Bytes),
    targetPairIds: Array.from(targetPairIdSet).sort(compareUtf8Bytes),
    sGrayOverall,
    sGrayBySubtype,
    b2Kappa,
    b2Ok,
    a3AdjudicationCount: input.a3AdjudicationCount ?? 0,
    substitutedPairsCount: input.substitutedPairsCount ?? 0,
    metadata: {
      seedsUsed: {
        bootstrap: SEED_BOOTSTRAP,
        b2Subsample: SEED_B2_SUBSAMPLE,
      },
    },
  };
}

/**
 * Formats deterministic `r1e_annotation.md` Markdown report (`07` §3.4 rules 2 & 10).
 */
export function formatAnnotationReportMarkdown(res: AnnotatorEvaluationResult): string {
  const lines: string[] = [
    "# R1-E Dual-Annotator Agreement Report (`r1e_annotation.md`)",
    "",
    `- Status: **${res.status}**`,
    `- \`KAPPA_OK\`: \`${String(res.kappaOk)}\``,
    `- Annotator independence: \`${res.independenceOk ? "PASS" : "FAIL"}\``,
    `- A3 adjudications: ${res.a3AdjudicationCount}`,
    `- Substituted pairs: ${res.substitutedPairsCount}`,
    "",
    "## Independence Record (`07` §3.4 Rule 2)",
    "",
    `- Annotators: A1 = \`${res.annotators.a1}\`, A2 = \`${res.annotators.a2}\`, A3 = \`${res.annotators.a3}\``,
    `- Declared pair authors: ${res.pairAuthors.length > 0 ? res.pairAuthors.map((a) => `\`${a}\``).join(", ") : "(none)"}`,
    `- Declared prompt authors: ${res.promptAuthors.length > 0 ? res.promptAuthors.map((a) => `\`${a}\``).join(", ") : "(none)"}`,
    "",
    "| Author / Committer | Files Touched |",
    "|---|---|",
  ];

  if (res.gitAuthorRecords.length === 0) {
    lines.push("| (none recorded) | (none) |");
  } else {
    for (const rec of res.gitAuthorRecords) {
      const filesList = rec.filesTouched.map((f) => `\`${f}\``).join(", ");
      lines.push(`| \`${rec.author}\` | ${filesList || "(none)"} |`);
    }
  }
  lines.push("");

  if (res.independenceErrors.length > 0) {
    lines.push("## Independence Violations", "");
    for (const err of res.independenceErrors) {
      lines.push(`- ${err}`);
    }
    lines.push("");
  }

  lines.push(
    "## Round 1 Kappa (Non-`S-GRAY` Subsample)",
    "",
    `- n = ${res.round1Kappa.n}`,
    `- Cohen's kappa = ${res.round1Kappa.kappa.toFixed(4)} (95% bootstrap CI [${res.round1Kappa.ci95[0].toFixed(4)}, ${res.round1Kappa.ci95[1].toFixed(4)}])`,
    `- Observed agreement p_o = ${res.round1Kappa.observedAgreement.toFixed(4)}, chance agreement p_e = ${res.round1Kappa.chanceAgreement.toFixed(4)}`,
    "",
    "### A1 x A2 Confusion Matrix",
    "",
    "| A1 \\\\ A2 | S | C | N |",
    "|---|---:|---:|---:|",
    `| **S** | ${res.round1ConfusionMatrix.S.S} | ${res.round1ConfusionMatrix.S.C} | ${res.round1ConfusionMatrix.S.N} |`,
    `| **C** | ${res.round1ConfusionMatrix.C.S} | ${res.round1ConfusionMatrix.C.C} | ${res.round1ConfusionMatrix.C.N} |`,
    `| **N** | ${res.round1ConfusionMatrix.N.S} | ${res.round1ConfusionMatrix.N.C} | ${res.round1ConfusionMatrix.N.N} |`,
    ""
  );

  if (res.targetPairIds.length > 0 || res.round2Kappa !== null) {
    lines.push("## Targeted Adjudication (`07` §3.4 Rule 8)", "");
    lines.push(`- Target subtypes: ${res.targetSubtypes.length > 0 ? res.targetSubtypes.join(", ") : "(none)"}`);
    lines.push(`- Target pair IDs (${res.targetPairIds.length}): ${res.targetPairIds.join(", ") || "(none)"}`);
    if (res.round2Kappa !== null) {
      lines.push(
        `- Round 2 Cohen's kappa = ${res.round2Kappa.kappa.toFixed(4)} (95% bootstrap CI [${res.round2Kappa.ci95[0].toFixed(4)}, ${res.round2Kappa.ci95[1].toFixed(4)}])`
      );
      if (!res.kappaOk) {
        lines.push("- **Outcome:** annotation agreement below target (`KAPPA_OK = false`).");
      }
    }
    lines.push("");
  }

  if (res.sGrayOverall !== null) {
    lines.push("## `S-GRAY` Agreement Outside Kappa", "");
    lines.push(
      `- Overall (${res.sGrayOverall.count} pairs): agreed ${res.sGrayOverall.agreedCount}/${res.sGrayOverall.count}, false contradictions = ${res.sGrayOverall.falseContradictions}, Wilson 95% UB = ${res.sGrayOverall.wilsonUb95.toFixed(4)}`
    );
    for (const sub of res.sGrayBySubtype) {
      lines.push(
        `  - \`${sub.subtype}\` (${sub.count}): agreed ${sub.agreedCount}/${sub.count}, false contradictions = ${sub.falseContradictions}, Wilson 95% UB = ${sub.wilsonUb95.toFixed(4)}`
      );
    }
    lines.push("");
  }

  if (res.b2Kappa !== null) {
    lines.push("## B2 Agreement Subsample", "");
    lines.push(
      `- n = ${res.b2Kappa.n}, kappa = ${res.b2Kappa.kappa.toFixed(4)} (95% CI [${res.b2Kappa.ci95[0].toFixed(4)}, ${res.b2Kappa.ci95[1].toFixed(4)}]), target >= 0.70: ${res.b2Ok ? "PASS" : "FAIL"}`
    );
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

function loadSplitsFromDataDir(dataDir: string): DisjointnessSplitInput[] {
  const absDir = resolve(dataDir);
  const splits: DisjointnessSplitInput[] = [];
  const entries = readdirSync(absDir, { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .sort(compareUtf8Bytes);

  for (const name of entries) {
    if (name === "manifest.json" || name === "ANNOTATION_GUIDE.md") continue;
    const kind = inferDatasetKind(name);
    if (kind === "PREPRINTS" || kind === "OTHER") continue;
    const raw = readFileSync(resolve(absDir, name), "utf8");
    if (name.endsWith(".jsonl")) {
      const parsed = parseJsonl(raw, name);
      if (!parsed.ok) throw new Error(parsed.error.message);
      splits.push({ splitName: name, rows: parsed.rows.map((r) => r.data) });
    } else if (name.endsWith(".json")) {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        splits.push({
          splitName: name,
          rows: parsed.filter(isPlainObject),
        });
      } else if (isPlainObject(parsed)) {
        let wrappedRows: Record<string, unknown>[] | null = null;
        for (const key of ["rows", "items", "pairs", "groups", "records", "data", "examples"] as const) {
          const candidate = parsed[key];
          if (Array.isArray(candidate)) {
            wrappedRows = candidate.filter(isPlainObject);
            break;
          }
        }
        splits.push({
          splitName: name,
          rows: wrappedRows ?? [parsed],
        });
      }
    }
  }
  return splits;
}

export function runDisjointnessCli(argv: readonly string[]): number {
  let annotatorsMode = false;
  let dataDir: string | undefined;
  let inputFile: string | undefined;
  let outFile: string | undefined;
  let repoRoot: string | undefined;
  let jsonFlag = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === "--annotators") {
      annotatorsMode = true;
    } else if (arg === "--json") {
      jsonFlag = true;
    } else if (arg === "--data-dir" && i + 1 < argv.length) {
      dataDir = argv[++i]!;
    } else if (arg === "--input" && i + 1 < argv.length) {
      inputFile = argv[++i]!;
    } else if (arg === "--out" && i + 1 < argv.length) {
      outFile = argv[++i]!;
    } else if (arg === "--repo-root" && i + 1 < argv.length) {
      repoRoot = resolve(argv[++i]!);
    } else {
      console.error(`Unknown or incomplete flag: ${arg}`);
      return 2;
    }
  }

  if (annotatorsMode) {
    if (inputFile === undefined) {
      console.error("--annotators requires --input <file.json>");
      return 2;
    }
    const raw: unknown = JSON.parse(readFileSync(resolve(inputFile), "utf8"));
    const inputObj = raw as AnnotatorEvaluationInput;
    const res = evaluateAnnotators({
      ...inputObj,
      repoRoot: repoRoot ?? DEFAULT_REPO_ROOT,
      // Enforce git author verification on CLI runs (`07` §2.2 & §3.4 Rule 2)
      checkGit: true,
    });
    const md = formatAnnotationReportMarkdown(res);
    if (outFile !== undefined) {
      const absOut = resolve(outFile);
      mkdirSync(dirname(absOut), { recursive: true });
      writeFileSync(absOut, md, "utf8");
    }
    if (jsonFlag) {
      console.log(JSON.stringify(res));
    } else {
      console.log(md);
    }
    if (!res.independenceOk || !res.b2Ok) return 1;
    if (res.status === "NEEDS_TARGETED_ADJUDICATION") return 1;
    return 0;
  }

  if (dataDir === undefined) {
    console.error("--data-dir <dir> is required (or pass --annotators --input <file.json>)");
    return 2;
  }
  if (!existsSync(resolve(dataDir))) {
    console.error(`Data directory does not exist: ${dataDir}`);
    return 1;
  }

  try {
    const splits = loadSplitsFromDataDir(dataDir);
    const res = checkDatasetDisjointness(splits);
    if (jsonFlag) {
      console.log(JSON.stringify(res));
    } else if (res.ok) {
      console.log(`Disjointness PASS across ${res.splitsChecked.length} splits.`);
    } else {
      console.error(
        `Disjointness FAIL: ${res.overlaps.length} overlaps, ${res.nPairViolations.length} N-pair cov violations.`
      );
    }
    return res.ok ? 0 : 1;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (jsonFlag) console.log(JSON.stringify({ ok: false, message: msg }));
    else console.error(msg);
    return 1;
  }
}

const entryArg = process.argv[1];
if (entryArg !== undefined && pathToFileURL(resolve(entryArg)).href === import.meta.url) {
  process.exit(runDisjointnessCli(process.argv.slice(2)));
}
