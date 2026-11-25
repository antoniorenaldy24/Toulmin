import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_REPO_ROOT,
  checkFreezeManifest,
  collectTierATsFiles,
  compareUtf8Bytes,
  computeFreezeHash,
  formatManifestText,
  isBareSha256Hex,
  normalizeManifestPath,
  parseManifestText,
  runFreezeHashCli,
  writeFreezeManifest,
} from "../freeze-hash.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..", "..");

function makeTempDir(prefix: string): string {
  return mkdtempSync(resolve(tmpdir(), prefix));
}

function writeRelFile(rootDir: string, relPath: string, content: string): void {
  const full = resolve(rootDir, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content, "utf8");
}

describe("tools/freeze-hash.ts deterministic manifest & hash verification", () => {
  it("computes exact bare 64-hex SHA-256 over sorted '{path}\\t{sha256hex(bytes)}' joined by '\\n' (no trailing newline)", () => {
    const dir = makeTempDir("toulmin-freeze-exact-");
    try {
      writeRelFile(dir, "b/fileB.txt", "beta\n");
      writeRelFile(dir, "a/fileA.txt", "alpha\n");

      const hA = createHash("sha256").update("alpha\n", "utf8").digest("hex");
      const hB = createHash("sha256").update("beta\n", "utf8").digest("hex");
      const expectedPayload = `a/fileA.txt\t${hA}\nb/fileB.txt\t${hB}`;
      const expectedHash = createHash("sha256").update(expectedPayload, "utf8").digest("hex");

      const res = computeFreezeHash(dir, ["b\\fileB.txt", "./a/fileA.txt"]);
      expect(res.manifestPayload).toBe(expectedPayload);
      expect(res.hash).toBe(expectedHash);
      expect(isBareSha256Hex(res.hash)).toBe(true);
      expect(res.fileCount).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("produces identical hashes across shuffled input lists and Windows/POSIX path separators", () => {
    const dir = makeTempDir("toulmin-freeze-repeat-");
    try {
      writeRelFile(dir, "z/last.ts", "export const z = 1;\n");
      writeRelFile(dir, "a/first.ts", "export const a = 2;\n");
      writeRelFile(dir, "m/mid.json", "{\"k\":true}\n");

      const r1 = computeFreezeHash(dir, ["z/last.ts", "a/first.ts", "m/mid.json"]);
      const r2 = computeFreezeHash(dir, ["m\\mid.json", ".\\z\\last.ts", "a/first.ts"]);
      const r3 = computeFreezeHash(dir, ["a/first.ts", "m/mid.json", "z/last.ts"]);

      expect(r1.hash).toBe(r2.hash);
      expect(r1.hash).toBe(r3.hash);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects path traversal, absolute paths, duplicates, unsorted manifests, missing files, and byte tampering", () => {
    expect(() => normalizeManifestPath("../secret.txt")).toThrow();
    expect(() => normalizeManifestPath("/etc/passwd")).toThrow();
    expect(() => normalizeManifestPath("C:\\Windows\\win.ini")).toThrow();
    expect(() => normalizeManifestPath("")).toThrow();
    expect(() => normalizeManifestPath("a/")).toThrow();
    expect(() => formatManifestText(["a.txt", "a.txt"])).toThrow();

    expect(() =>
      parseManifestText("b.txt\na.txt\n", { requireCanonicalOrder: true })
    ).toThrow(/UNSORTED|sorted/i);
    expect(() =>
      parseManifestText("a\\b.txt\n", { requireCanonicalOrder: true })
    ).toThrow();

    const dir = makeTempDir("toulmin-freeze-tamper-");
    try {
      writeRelFile(dir, "one.txt", "original");
      writeRelFile(dir, "two.txt", "untouched");

      const manifestRel = "freeze/test_manifest.txt";
      const hashRel = "freeze/test_manifest.sha256";
      const written = writeFreezeManifest({
        rootDir: dir,
        manifestPath: manifestRel,
        paths: ["two.txt", "one.txt"],
        hashOutPath: hashRel,
      });

      const okCheck = checkFreezeManifest({
        rootDir: dir,
        manifestPath: manifestRel,
        hashFilePath: hashRel,
      });
      expect(okCheck.ok).toBe(true);
      expect(okCheck.hash).toBe(written.hash);

      // Single-byte tamper detection
      writeRelFile(dir, "one.txt", "originel");
      const tamperCheck = checkFreezeManifest({
        rootDir: dir,
        manifestPath: manifestRel,
        expectedHash: written.hash,
      });
      expect(tamperCheck.ok).toBe(false);
      expect(tamperCheck.errorCode).toBe("HASH_MISMATCH");

      // Missing file failure
      rmSync(resolve(dir, "two.txt"));
      const missingCheck = checkFreezeManifest({
        rootDir: dir,
        manifestPath: manifestRel,
        expectedHash: written.hash,
      });
      expect(missingCheck.ok).toBe(false);
      expect(missingCheck.errorCode).toBe("MISSING_FILE");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("supports CLI --write and --check end-to-end in isolated temp directories", () => {
    const dir = makeTempDir("toulmin-freeze-cli-");
    try {
      writeRelFile(dir, "src/b.ts", "export const b = 1;\n");
      writeRelFile(dir, "src/a.ts", "export const a = 2;\n");

      const writeExit = runFreezeHashCli([
        "--root",
        dir,
        "--manifest",
        "freeze/tier_a.txt",
        "--hash-out",
        "freeze/tier_a.sha256",
        "--write",
        "src/b.ts",
        "src/a.ts",
      ]);
      expect(writeExit).toBe(0);

      const checkOkExit = runFreezeHashCli([
        "--root",
        dir,
        "--manifest",
        "freeze/tier_a.txt",
        "--hash-file",
        "freeze/tier_a.sha256",
        "--check",
      ]);
      expect(checkOkExit).toBe(0);

      // Tamper a file -> CLI --check exits non-zero
      writeRelFile(dir, "src/a.ts", "export const a = 999;\n");
      const checkFailExit = runFreezeHashCli([
        "--root",
        dir,
        "--manifest",
        "freeze/tier_a.txt",
        "--hash-file",
        "freeze/tier_a.sha256",
        "--check",
      ]);
      expect(checkFailExit).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("covers all current Tier A TS sources, raw assets, conformance goldens, and 10 on-device schemas cleanly without touching freeze/", () => {
    expect(REPO_ROOT).toBe(DEFAULT_REPO_ROOT);
    const tierAFiles = collectTierATsFiles(REPO_ROOT);

    // Verify all required Tier A categories are present
    expect(tierAFiles).toContain("packages/core-l0/src/unicode_15_1.generated.ts");
    expect(tierAFiles).toContain("packages/core-l0/src/wordlist_en.generated.ts");
    expect(tierAFiles).toContain("packages/core-l0/unicode_15_1.bin");
    expect(tierAFiles).toContain("packages/core-l0/norm_table.json");
    expect(tierAFiles).toContain("packages/core-l0/porter_v1.json");
    expect(tierAFiles).toContain("packages/core-l0/bm25_min_cov.json");
    expect(tierAFiles).toContain("packages/core-l0/wordlist_en.txt");
    expect(tierAFiles).toContain("conformance/l0/norm.json");
    expect(tierAFiles).toContain("conformance/l0/bm25.json");
    expect(tierAFiles).toContain("packages/schemas/VerdictV1.schema.json");
    expect(tierAFiles).not.toContain("packages/schemas/L2Verdict.schema.json");

    // Verify ascending UTF-8 byte order
    for (let i = 1; i < tierAFiles.length; i += 1) {
      expect(compareUtf8Bytes(tierAFiles[i - 1]!, tierAFiles[i]!)).toBeLessThan(0);
    }

    const res1 = computeFreezeHash(REPO_ROOT, tierAFiles);
    const res2 = computeFreezeHash(REPO_ROOT, [...tierAFiles].reverse());
    expect(res1.hash).toBe(res2.hash);
    expect(isBareSha256Hex(res1.hash)).toBe(true);
    expect(res1.fileCount).toBe(tierAFiles.length);

    // Guardrail: freeze/ stays untouched (only .gitkeep) and no fake apps/android/core-l0 stubs exist
    const freezeEntries = readdirSync(resolve(REPO_ROOT, "freeze"));
    expect(freezeEntries).toEqual([".gitkeep"]);
    expect(existsSync(resolve(REPO_ROOT, "apps", "android", "core-l0"))).toBe(false);
  });
});
