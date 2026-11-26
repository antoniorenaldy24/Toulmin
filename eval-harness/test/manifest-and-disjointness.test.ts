import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  SEED_BOOTSTRAP,
  checkDatasetDisjointness,
  compareUtf8Bytes,
  createRunManifest,
  evaluateAnnotators,
  formatAnnotationReportMarkdown,
  generateDatasetManifest,
  runDisjointnessCli,
  runManifestCli,
  validateRunManifest,
  verifyDatasetManifest,
} from "../src/index.js";

function withTempDir<T>(prefix: string, fn: (dir: string) => T): T {
  const dir = mkdtempSync(resolve(tmpdir(), prefix));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("eval-harness manifest.ts & RunManifest validation (AC-EVAL-01, AC-EVAL-04)", () => {
  it("generates and verifies canonical UTF-8 manifests and detects single-byte tamper, missing files, and malformed JSONL", () => {
    withTempDir("toulmin-manifest-", (dir) => {
      const devRows = [
        JSON.stringify({
          pairId: "dev-1",
          gold: "S",
          subtype: "S-PARAPHRASE",
          domain: "biomedical",
          claim: "Drug A reduced systolic blood pressure by 10 mmHg.",
          abstract: "In adults with hypertension, Drug A reduced systolic blood pressure by 10 mmHg across 12 weeks.",
          reference: { doi: "10.1000/dev-1", year: 2023, license: "cc-by" },
        }),
        JSON.stringify({
          pairId: "dev-2",
          gold: "C",
          subtype: "C-DIRECTION",
          domain: "other_science",
          claim: "Intervention B increased retention.",
          abstract: "Across two trials, Intervention B significantly decreased participant retention.",
          reference: { doi: "10.1000/dev-2", year: 2022, license: "cc-by" },
        }),
      ].join("\n") + "\n";

      const sanRows = [
        JSON.stringify({
          itemId: "san-1",
          abstract: "TNFα and IL-1β levels normalized at 24 hours with 10 μm sections.",
        }),
      ].join("\n") + "\n";

      writeFileSync(resolve(dir, "dev_v2.jsonl"), devRows, "utf8");
      writeFileSync(resolve(dir, "ms_san_v2.jsonl"), sanRows, "utf8");

      const manifest = generateDatasetManifest(dir);
      expect(manifest.files.map((f) => f.path)).toEqual(["dev_v2.jsonl", "ms_san_v2.jsonl"]);
      expect(compareUtf8Bytes(manifest.files[0]!.path, manifest.files[1]!.path)).toBeLessThan(0);
      expect(manifest.files[0]!.rowCount).toBe(2);
      expect(manifest.files[0]!.strataCounts).toMatchObject({
        "gold:C": 1,
        "gold:S": 1,
      });

      const okCheck = verifyDatasetManifest(dir, manifest);
      expect(okCheck.ok).toBe(true);
      expect(okCheck.fileCount).toBe(2);
      expect(okCheck.totalRows).toBe(3);

      // CLI generate + verify
      const manifestOut = resolve(dir, "manifest.json");
      expect(runManifestCli(["--generate", "--data-dir", dir, "--out", manifestOut])).toBe(0);
      expect(runManifestCli(["--verify", "--data-dir", dir, "--manifest", manifestOut])).toBe(0);

      // Corrupted bytes metadata fails with INVALID_MANIFEST
      const badBytesManifest = {
        ...manifest,
        files: manifest.files.map((f, idx) => (idx === 0 ? { ...f, bytes: f.bytes + 1 } : f)),
      };
      const badBytesCheck = verifyDatasetManifest(dir, badBytesManifest);
      expect(badBytesCheck.ok).toBe(false);
      expect(badBytesCheck.errors[0]!.code).toBe("INVALID_MANIFEST");

      // Single-byte tamper fails with HASH_MISMATCH and non-zero CLI exit
      writeFileSync(resolve(dir, "dev_v2.jsonl"), devRows.replace("10 mmHg", "11 mmHg"), "utf8");
      const tamperCheck = verifyDatasetManifest(dir, manifest);
      expect(tamperCheck.ok).toBe(false);
      expect(tamperCheck.errors[0]!.code).toBe("HASH_MISMATCH");
      expect(runManifestCli(["--verify", "--data-dir", dir, "--manifest", manifestOut])).toBe(1);

      // Missing file fails cleanly
      rmSync(resolve(dir, "ms_san_v2.jsonl"));
      const missingCheck = verifyDatasetManifest(dir, manifest);
      expect(missingCheck.ok).toBe(false);
      expect(missingCheck.errors.some((e) => e.code === "MISSING_FILE")).toBe(true);
    });

    // Malformed JSONL row rejects during manifest generation
    withTempDir("toulmin-badjsonl-", (dir) => {
      writeFileSync(resolve(dir, "dev_v2.jsonl"), "{not-valid-json}\n", "utf8");
      expect(() => generateDatasetManifest(dir)).toThrow(/malformed JSON/i);
    });
  });

  it("validates RunManifest hashes and samplingMode contracts (07 §2.3–§2.4)", () => {
    const valid = createRunManifest({
      runId: "r1e-web-test",
      tier_a_hash: "a".repeat(64),
      tier_b_hash: "b".repeat(64),
      cf1_baseline_hash: "c".repeat(64),
      gitCommit: "8a348c6",
      datasetHashes: { "r1e_v2.jsonl": "d".repeat(64) },
      samplingMode: "browser_default",
      runtimeVersion: "Chrome/151.0.0.0",
      baseModelName: "gemini-nano",
      calibratedVariant: { schemaId: "VerdictV1", reasoningCap: 40 },
      seeds: { SEED_BOOTSTRAP },
    });
    expect(validateRunManifest(valid)).toEqual({ ok: true, errors: [] });
    expect(validateRunManifest({ ...valid, tier_a_hash: "short" }).ok).toBe(false);
    expect(validateRunManifest({ ...valid, seeds: { BAD: Number.NaN } }).ok).toBe(false);
    expect(
      validateRunManifest({
        ...valid,
        calibratedVariant: { schemaId: "VerdictV1", reasoningCap: 0 },
      }).ok
    ).toBe(false);
  });
});

describe("eval-harness disjointness.ts cross-split checks, N-pair relatedness, and --annotators (AC-EVAL-01, AC-EVAL-02)", () => {
  it("passes cleanly on disjoint splits and rejects overlapping DOIs, refIds, normalizedClaimHash, and low-cov N pairs", () => {
    const clean = checkDatasetDisjointness([
      {
        splitName: "dev_v2.jsonl",
        rows: [
          {
            pairId: "dev-1",
            gold: "S",
            claim: "Aspirin reduced stroke incidence by 20 percent in elderly patients.",
            abstract: "Daily aspirin lowered first stroke incidence by twenty percent.",
            reference: { doi: "10.1000/dev-1", refId: "ref-dev-1" },
          },
        ],
      },
      {
        splitName: "r1e_v2.jsonl",
        rows: [
          {
            pairId: "r1e-1",
            gold: "S",
            subtype: "S-PARAPHRASE",
            claim: "Metformin improved glycemic control among diabetic cohorts.",
            abstract: "Metformin significantly improved glycemic control among adult diabetic cohorts. Side effects were mild.",
            reference: { doi: "10.1000/r1e-1", refId: "ref-r1e-1" },
          },
          {
            pairId: "r1e-2",
            gold: "N",
            subtype: "N-RELATED-OUTCOME",
            claim: "Metformin improved glycemic control in geriatric cohorts.",
            abstract: "Metformin significantly improved glycemic control in geriatric cohorts without weight gain.",
            reference: { doi: "10.1000/r1e-2", refId: "ref-r1e-2" },
          },
        ],
      },
    ]);
    expect(clean.ok).toBe(true);
    expect(clean.overlaps).toEqual([]);
    expect(clean.nPairViolations).toEqual([]);

    // Overlapping DOI + cross-field claim vs sentence TEXT + DEV subtype isolation + unrelated N pair
    const dirty = checkDatasetDisjointness([
      {
        splitName: "dev_v2.jsonl",
        rows: [
          {
            pairId: "dev-1",
            gold: "S",
            subtype: "S-PARAPHRASE",
            claim: "Drug X lowered mortality by 30%.",
            abstract: "Drug X lowered mortality substantially.",
            reference: { doi: "10.1000/SHARED-DOI", refId: "ref-shared" },
          },
          {
            pairId: "dev-2",
            gold: "S",
            claim: "Aspirin reduced stroke by 17 percent.",
            abstract: "Aspirin reduced first stroke by seventeen percent.",
            reference: { doi: "10.1000/dev-2" },
          },
        ],
      },
      {
        splitName: "ms_b123_v2.jsonl",
        rows: [
          {
            itemId: "b123-1",
            // Cross-field leak: matches dev-2.claim identically under normLower
            sentence: "Aspirin reduced stroke by 17 percent.",
            citedAbstract: "Unrelated abstract text.",
          },
        ],
      },
      {
        splitName: "r1e_v2.jsonl",
        rows: [
          {
            pairId: "r1e-s1",
            gold: "S",
            subtype: "S-PARAPHRASE",
            // Same normalized claim value structure, uppercase DOI
            claim: "Drug X lowered mortality by 30 percent.",
            abstract: "Drug X lowered mortality by thirty percent across cohorts.",
            reference: { doi: "10.1000/shared-doi", refId: "REF-SHARED" },
          },
          {
            pairId: "r1e-n1",
            gold: "N",
            subtype: "N-RELATED-OUTCOME",
            claim: "Quantum entanglement stabilized superconductor qubits.",
            abstract: "Cardiology patients showed improved ejection fraction after exercise.",
            reference: { doi: "10.1000/n1" },
          },
        ],
      },
    ]);
    expect(dirty.ok).toBe(false);
    expect(dirty.overlaps.some((o) => o.kind === "DOI")).toBe(true);
    expect(dirty.overlaps.some((o) => o.kind === "REF_ID")).toBe(true);
    expect(dirty.overlaps.some((o) => o.kind === "TEXT" && o.splits.includes("ms_b123_v2.jsonl"))).toBe(true);
    expect(dirty.nPairViolations.map((v) => v.pairId)).toEqual(["r1e-n1"]);
    // Ensure DEV S-PARAPHRASE pair did NOT pollute R1-E median S cov (only r1e-s1's cov counts)
    const r1eOnly = checkDatasetDisjointness([
      {
        splitName: "dev_v2.jsonl",
        rows: [
          {
            pairId: "dev-perfect",
            gold: "S",
            subtype: "S-PARAPHRASE",
            claim: "Exact match sentence.",
            abstract: "Exact match sentence.",
            reference: { doi: "10.1000/dev-p" },
          },
        ],
      },
      {
        splitName: "r1e_v2.jsonl",
        rows: [
          {
            pairId: "r1e-s",
            gold: "S",
            subtype: "S-PARAPHRASE",
            claim: "Exercise reduced resting heart rate and improved cardiac output.",
            abstract: "Exercise reduced resting heart rate in healthy adults. Sleep stayed unchanged.",
            reference: { doi: "10.1000/r1es" },
          },
          {
            pairId: "r1e-n",
            gold: "N",
            subtype: "N-RELATED-OUTCOME",
            claim: "Exercise reduced resting heart rate significantly in athletes.",
            abstract: "Exercise reduced resting heart rate in athletes cleanly. Appetite was stable.",
            reference: { doi: "10.1000/r1en" },
          },
        ],
      },
    ]);
    expect(r1eOnly.ok).toBe(true);

    // Verify zero Math.random usage in disjointness / stats
    const srcDisjoint = readFileSync(resolve(__dirname, "../src/disjointness.ts"), "utf8");
    expect(srcDisjoint).not.toContain("Math.random");
  });

  it("enforces annotator independence, kappa >= 0.70 gate, S-GRAY bounds, and targeted adjudication (--annotators)", () => {
    const highAgreementPairs = Array.from({ length: 15 }, (_, idx) => {
      const label = (idx % 3 === 0 ? "S" : idx % 3 === 1 ? "C" : "N") as "S" | "C" | "N";
      return {
        pairId: `p-${idx + 1}`,
        subtype: label === "C" ? "C-DIRECTION" : "S-PARAPHRASE",
        a1: label,
        a2: label,
      };
    });

    const passRes = evaluateAnnotators({
      annotators: { a1: "Alice", a2: "Bob", a3: "Carol" },
      pairAuthors: ["Dave"],
      promptAuthors: ["Eve"],
      round1Subsample: highAgreementPairs,
      sGrayPairs: Array.from({ length: 10 }, (_, idx) => ({
        pairId: `gray-${idx + 1}`,
        subtype: idx < 3 ? "S-GRAY-ROUNDING" : idx < 6 ? "S-GRAY-REL-ABS" : idx < 8 ? "S-GRAY-HALVED" : "S-GRAY-HEDGED",
        a1: "S" as const,
        a2: "S" as const,
        isSGray: true,
        majorityVerdict: "S" as const,
      })),
      bootstrapIterations: 200,
    });
    expect(passRes.ok).toBe(true);
    expect(passRes.kappaOk).toBe(true);
    expect(passRes.status).toBe("PASS");
    expect(passRes.round1Kappa.kappa).toBeCloseTo(1.0, 4);
    expect(passRes.sGrayOverall?.wilsonUb95).toBeCloseTo(0.2775, 4);
    const md = formatAnnotationReportMarkdown(passRes);
    expect(md).toContain("`KAPPA_OK`: `true`");
    expect(md).toContain("A1 = `Alice`, A2 = `Bob`, A3 = `Carol`");
    expect(md).toContain("Files Touched");
    expect(md).toContain("S-GRAY");

    // Non-independent annotator declared explicitly
    const nonIndependent = evaluateAnnotators({
      annotators: { a1: "Alice", a2: "Dave", a3: "Carol" },
      pairAuthors: ["dave"],
      promptAuthors: ["Eve"],
      round1Subsample: highAgreementPairs,
      bootstrapIterations: 100,
    });
    expect(nonIndependent.ok).toBe(false);
    expect(nonIndependent.independenceOk).toBe(false);
    expect(nonIndependent.status).toBe("INDEPENDENCE_FAILED");

    // Non-independent annotator caught automatically from real git history of packages/prompts/ even when promptAuthors: []
    const gitCaught = evaluateAnnotators({
      annotators: { a1: "antoniorenaldy24", a2: "Bob", a3: "Carol" },
      pairAuthors: [],
      promptAuthors: [],
      round1Subsample: highAgreementPairs,
      bootstrapIterations: 100,
    });
    expect(gitCaught.ok).toBe(false);
    expect(gitCaught.independenceOk).toBe(false);
    expect(gitCaught.status).toBe("INDEPENDENCE_FAILED");

    // Low round-1 kappa -> targeted adjudication -> round-2 failure sets KAPPA_OK = false
    const disagreedRound1 = [
      { pairId: "p-1", subtype: "C-SUBJECT-SWAP", a1: "C" as const, a2: "N" as const },
      { pairId: "p-2", subtype: "C-DIRECTION", a1: "S" as const, a2: "C" as const },
      { pairId: "p-3", subtype: "N-SCOPE", a1: "N" as const, a2: "S" as const },
      { pairId: "p-4", subtype: "S-PARAPHRASE", a1: "S" as const, a2: "S" as const },
    ];
    const needsAdj = evaluateAnnotators({
      annotators: { a1: "Alice", a2: "Bob", a3: "Carol" },
      pairAuthors: ["Dave"],
      promptAuthors: ["Eve"],
      round1Subsample: disagreedRound1,
      allR1ePairs: [
        { pairId: "p-99", subtype: "C-SUBJECT-SWAP" },
        { pairId: "p-100", subtype: "S-SUMMARY" },
      ],
      bootstrapIterations: 100,
    });
    expect(needsAdj.status).toBe("NEEDS_TARGETED_ADJUDICATION");
    expect(needsAdj.kappaOk).toBe(false);
    expect(needsAdj.targetPairIds).toContain("p-99");
    expect(needsAdj.targetPairIds).not.toContain("p-100");

    const finalFail = evaluateAnnotators({
      annotators: { a1: "Alice", a2: "Bob", a3: "Carol" },
      pairAuthors: ["Dave"],
      promptAuthors: ["Eve"],
      round1Subsample: disagreedRound1,
      round2Resubsample: disagreedRound1,
      bootstrapIterations: 100,
    });
    expect(finalFail.status).toBe("BELOW_TARGET_FINAL");
    expect(finalFail.kappaOk).toBe(false);
    expect(formatAnnotationReportMarkdown(finalFail)).toContain("KAPPA_OK = false");

    // CLI --annotators check
    withTempDir("toulmin-ann-cli-", (dir) => {
      mkdirSync(dir, { recursive: true });
      const inPath = resolve(dir, "annotators.json");
      const outMd = resolve(dir, "r1e_annotation.md");
      writeFileSync(
        inPath,
        JSON.stringify({
          annotators: { a1: "Alice", a2: "Bob", a3: "Carol" },
          pairAuthors: ["Dave"],
          promptAuthors: ["Eve"],
          round1Subsample: highAgreementPairs,
          bootstrapIterations: 100,
        }),
        "utf8"
      );
      expect(runDisjointnessCli(["--annotators", "--input", inPath, "--out", outMd])).toBe(0);
      expect(readFileSync(outMd, "utf8")).toContain("`KAPPA_OK`: `true`");
    });
  });
});
