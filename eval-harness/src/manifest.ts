/**
 * Evaluation Dataset Manifest Generator, Verifier, and Run Manifest Utilities
 * (`eval-harness/src/manifest.ts`)
 * (`docs/spec/07_EVAL_SPIKES_AND_ACCEPTANCE.md` §2.1, §2.3–§2.4, `AC-EVAL-01`, `AC-EVAL-04`).
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export type DatasetKind =
  | "DEV"
  | "R1-E"
  | "R1-E-GROUPS"
  | "PROBE"
  | "MS-B123"
  | "MS-B5"
  | "MS-O2"
  | "MS-SAN"
  | "RT-INJ"
  | "RT-INJ-F"
  | "PREPRINTS"
  | "OTHER";

export interface DatasetFileEntry {
  readonly path: string;
  readonly kind: DatasetKind;
  readonly sha256: string;
  readonly bytes: number;
  readonly rowCount: number;
  readonly strataCounts?: Readonly<Record<string, number>>;
}

export interface DatasetManifest {
  readonly schemaVersion: 1;
  readonly files: readonly DatasetFileEntry[];
  readonly manifestHash: string;
}

export type DatasetVerifyErrorCode =
  | "MANIFEST_NOT_FOUND"
  | "INVALID_MANIFEST"
  | "UNSORTED_MANIFEST"
  | "INVALID_PATH"
  | "MISSING_FILE"
  | "HASH_MISMATCH"
  | "INVALID_ROW"
  | "ROW_COUNT_MISMATCH"
  | "MANIFEST_HASH_MISMATCH";

export interface DatasetVerifyError {
  readonly code: DatasetVerifyErrorCode;
  readonly path?: string;
  readonly line?: number;
  readonly message: string;
}

export interface DatasetVerifyResult {
  readonly ok: boolean;
  readonly fileCount: number;
  readonly totalRows: number;
  readonly errors: readonly DatasetVerifyError[];
}

export interface RunManifest {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly tier_a_hash: string;
  readonly tier_b_hash: string;
  readonly cf1_baseline_hash?: string;
  readonly gitCommit: string;
  readonly datasetHashes: Readonly<Record<string, string>>;
  readonly samplingMode: "browser_default" | "generation_config";
  readonly runtimeVersion: string;
  readonly baseModelName: string;
  readonly calibratedVariant: {
    readonly schemaId: string;
    readonly reasoningCap: number;
  };
  readonly seeds: Readonly<Record<string, number>>;
}

export interface RunManifestValidationResult {
  readonly ok: boolean;
  readonly errors: readonly string[];
}

const VALID_GOLD_PROBES = new Set(["S", "C", "N"]);
const VALID_WORTH = new Set(["HIGH", "LOW"]);
const VALID_B5_CLASSES = new Set([
  "INCONSISTENT",
  "CONSISTENT_DIFFERENT_SUBSET",
  "DIFFERENT_QUANTITY",
]);

export function sha256HexBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function sha256HexUtf8(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function isBareSha256Hex(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}

export function compareUtf8Bytes(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

/**
 * Normalizes a data-directory relative path and rejects traversal / absolute / drive paths.
 */
export function normalizeRelativePath(rawPath: string): string {
  const trimmed = rawPath.trim();
  if (trimmed.length === 0) {
    throw new Error("Empty dataset path is not allowed");
  }
  for (let i = 0; i < trimmed.length; i += 1) {
    const code = trimmed.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) {
      throw new Error(`Control character in dataset path "${trimmed}"`);
    }
  }
  let norm = trimmed.replaceAll("\\", "/");
  while (norm.startsWith("./")) {
    norm = norm.slice(2);
  }
  if (
    norm.length === 0 ||
    norm.startsWith("/") ||
    norm.endsWith("/") ||
    /^[A-Za-z]:/.test(norm)
  ) {
    throw new Error(`Dataset path must be relative to dataDir: "${rawPath}"`);
  }
  const segs = norm.split("/");
  for (const s of segs) {
    if (s.length === 0 || s === "." || s === "..") {
      throw new Error(`Invalid path segment "${s}" in "${rawPath}"`);
    }
  }
  return norm;
}

export function inferDatasetKind(relPath: string): DatasetKind {
  const lower = relPath.toLowerCase();
  const base = lower.split("/").pop() ?? lower;
  if (base.startsWith("dev")) return "DEV";
  if (base.includes("r1e_groups")) return "R1-E-GROUPS";
  if (base.startsWith("r1e")) return "R1-E";
  if (base.includes("probe_pool") || base.includes("probe_set")) return "PROBE";
  if (base.startsWith("ms_b123")) return "MS-B123";
  if (base.startsWith("ms_b5")) return "MS-B5";
  if (lower.startsWith("ms_o2") || base.startsWith("ms_o2")) return "MS-O2";
  if (base.startsWith("ms_san")) return "MS-SAN";
  if (base.startsWith("rt_inj_f")) return "RT-INJ-F";
  if (base.startsWith("rt_inj")) return "RT-INJ";
  if (base.startsWith("preprints")) return "PREPRINTS";
  return "OTHER";
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

export interface ParsedJsonlLine {
  readonly line: number;
  readonly data: Record<string, unknown>;
}

/**
 * Parses UTF-8 JSONL content line by line, rejecting malformed JSON or non-object rows.
 */
export function parseJsonl(
  rawText: string,
  relPath: string
): { readonly ok: true; readonly rows: ParsedJsonlLine[] } | { readonly ok: false; readonly error: DatasetVerifyError } {
  const lines = rawText.split(/\r?\n/);
  const rows: ParsedJsonlLine[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i]!.trim();
    if (trimmed.length === 0) {
      continue;
    }
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (!isPlainObject(parsed)) {
        return {
          ok: false,
          error: {
            code: "INVALID_ROW",
            path: relPath,
            line: i + 1,
            message: `${relPath}:${i + 1}: JSONL row must be a JSON object`,
          },
        };
      }
      rows.push({ line: i + 1, data: parsed });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        error: {
          code: "INVALID_ROW",
          path: relPath,
          line: i + 1,
          message: `${relPath}:${i + 1}: malformed JSON (${msg})`,
        },
      };
    }
  }
  return { ok: true, rows };
}

/**
 * Validates required schema fields per dataset kind (`07` §2.1, §3.1, §4.4, §4.7).
 */
export function validateDatasetRow(
  kind: DatasetKind,
  row: Record<string, unknown>,
  relPath: string,
  lineNum: number
): string | null {
  if (kind === "DEV" || kind === "R1-E") {
    if (!nonEmptyString(row["pairId"])) return `${relPath}:${lineNum}: missing pairId`;
    if (typeof row["gold"] !== "string" || !VALID_GOLD_PROBES.has(row["gold"])) {
      return `${relPath}:${lineNum}: gold must be S, C, or N`;
    }
    if (!nonEmptyString(row["claim"])) return `${relPath}:${lineNum}: missing claim`;
    if (typeof row["abstract"] !== "string") return `${relPath}:${lineNum}: abstract must be a string`;
    const refObj = row["reference"];
    if (!isPlainObject(refObj) || typeof refObj["doi"] !== "string") {
      return `${relPath}:${lineNum}: reference.doi must be a string`;
    }
    return null;
  }

  if (kind === "MS-B123") {
    if (!nonEmptyString(row["itemId"])) return `${relPath}:${lineNum}: missing itemId`;
    if (!nonEmptyString(row["sentence"])) return `${relPath}:${lineNum}: missing sentence`;
    if (!nonEmptyString(row["section"])) return `${relPath}:${lineNum}: missing section`;
    if (!Array.isArray(row["goldAtoms"])) return `${relPath}:${lineNum}: missing goldAtoms array`;
    if (typeof row["goldCheckworthy"] !== "string" || !VALID_WORTH.has(row["goldCheckworthy"])) {
      return `${relPath}:${lineNum}: goldCheckworthy must be HIGH or LOW`;
    }
    if (typeof row["goldUncitedEmpirical"] !== "boolean") {
      return `${relPath}:${lineNum}: goldUncitedEmpirical must be boolean`;
    }
    if (typeof row["citedAbstract"] !== "string") {
      return `${relPath}:${lineNum}: citedAbstract must be string`;
    }
    if (!Array.isArray(row["goldEvidenceSentenceIdx"])) {
      return `${relPath}:${lineNum}: goldEvidenceSentenceIdx must be array`;
    }
    return null;
  }

  if (kind === "MS-B5") {
    if (!nonEmptyString(row["itemId"])) return `${relPath}:${lineNum}: missing itemId`;
    const a = row["a"];
    const b = row["b"];
    if (!isPlainObject(a) || !nonEmptyString(a["window"]) || !nonEmptyString(a["section"])) {
      return `${relPath}:${lineNum}: invalid MS-B5 a tuple`;
    }
    if (!isPlainObject(b) || !nonEmptyString(b["window"]) || !nonEmptyString(b["section"])) {
      return `${relPath}:${lineNum}: invalid MS-B5 b tuple`;
    }
    if (typeof row["gold"] !== "string" || !VALID_B5_CLASSES.has(row["gold"])) {
      return `${relPath}:${lineNum}: invalid MS-B5 gold class`;
    }
    return null;
  }

  if (kind === "MS-SAN" || kind === "RT-INJ" || kind === "RT-INJ-F") {
    const idOk = nonEmptyString(row["itemId"]) || nonEmptyString(row["id"]) || nonEmptyString(row["pairId"]);
    if (!idOk) {
      return `${relPath}:${lineNum}: missing itemId/id`;
    }
    const textOk =
      typeof row["abstract"] === "string" ||
      typeof row["text"] === "string" ||
      Array.isArray(row["units"]);
    if (!textOk) {
      return `${relPath}:${lineNum}: missing abstract, text, or units`;
    }
    return null;
  }

  return null;
}

function incrementCount(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

export function computeStrataCounts(
  kind: DatasetKind,
  rows: readonly Record<string, unknown>[]
): Record<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (kind === "DEV" || kind === "R1-E" || kind === "PROBE") {
      if (typeof row["gold"] === "string") incrementCount(counts, `gold:${row["gold"]}`);
      if (typeof row["subtype"] === "string") incrementCount(counts, `subtype:${row["subtype"]}`);
      if (typeof row["domain"] === "string") incrementCount(counts, `domain:${row["domain"]}`);
    } else if (kind === "MS-B123") {
      if (typeof row["goldCheckworthy"] === "string") {
        incrementCount(counts, `worth:${row["goldCheckworthy"]}`);
      }
      if (typeof row["goldUncitedEmpirical"] === "boolean") {
        incrementCount(counts, `uncited:${String(row["goldUncitedEmpirical"])}`);
      }
    } else if (kind === "MS-B5") {
      if (typeof row["gold"] === "string") incrementCount(counts, `gold:${row["gold"]}`);
    }
  }
  const out: Record<string, number> = {};
  for (const k of Array.from(counts.keys()).sort(compareUtf8Bytes)) {
    out[k] = counts.get(k)!;
  }
  return out;
}

function walkFilesRecursively(baseDir: string, currentDir: string, out: string[]): void {
  for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
    const abs = resolve(currentDir, entry.name);
    if (entry.isDirectory()) {
      walkFilesRecursively(baseDir, abs, out);
    } else if (entry.isFile()) {
      const rel = normalizeRelativePath(relative(baseDir, abs));
      if (rel !== "manifest.json") {
        out.push(rel);
      }
    }
  }
}

function parseFileRows(
  relPath: string,
  kind: DatasetKind,
  rawText: string
):
  | { readonly ok: true; readonly rowCount: number; readonly rows: Record<string, unknown>[] }
  | { readonly ok: false; readonly error: DatasetVerifyError } {
  const lower = relPath.toLowerCase();
  if (lower.endsWith(".jsonl")) {
    const parsed = parseJsonl(rawText, relPath);
    if (!parsed.ok) {
      return { ok: false, error: parsed.error };
    }
    const objs: Record<string, unknown>[] = [];
    for (const item of parsed.rows) {
      const rowErr = validateDatasetRow(kind, item.data, relPath, item.line);
      if (rowErr !== null) {
        return {
          ok: false,
          error: {
            code: "INVALID_ROW",
            path: relPath,
            line: item.line,
            message: rowErr,
          },
        };
      }
      objs.push(item.data);
    }
    return { ok: true, rowCount: objs.length, rows: objs };
  }

  if (lower.endsWith(".json")) {
    try {
      const parsed: unknown = JSON.parse(rawText);
      if (Array.isArray(parsed)) {
        const objs: Record<string, unknown>[] = [];
        for (let i = 0; i < parsed.length; i += 1) {
          const item = parsed[i];
          if (!isPlainObject(item)) {
            return {
              ok: false,
              error: {
                code: "INVALID_ROW",
                path: relPath,
                line: i + 1,
                message: `${relPath}[${i}]: JSON array element must be an object`,
              },
            };
          }
          const rowErr = validateDatasetRow(kind, item, relPath, i + 1);
          if (rowErr !== null) {
            return {
              ok: false,
              error: { code: "INVALID_ROW", path: relPath, line: i + 1, message: rowErr },
            };
          }
          objs.push(item);
        }
        return { ok: true, rowCount: objs.length, rows: objs };
      }
      if (isPlainObject(parsed)) {
        return { ok: true, rowCount: 1, rows: [parsed] };
      }
      return {
        ok: false,
        error: {
          code: "INVALID_ROW",
          path: relPath,
          message: `${relPath}: JSON must be an array or object`,
        },
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        error: {
          code: "INVALID_ROW",
          path: relPath,
          message: `${relPath}: malformed JSON (${msg})`,
        },
      };
    }
  }

  return { ok: true, rowCount: 0, rows: [] };
}

export function computeManifestEnvelopeHash(files: readonly DatasetFileEntry[]): string {
  const payload = files.map((f) => `${f.path}\t${f.sha256}`).join("\n");
  return sha256HexUtf8(payload);
}

/**
 * Generates a deterministic dataset manifest sorted ascending by UTF-8 byte order (`AC-EVAL-01`).
 */
export function generateDatasetManifest(
  dataDir: string,
  options?: { readonly files?: readonly string[] }
): DatasetManifest {
  const absDir = resolve(dataDir);
  if (!existsSync(absDir)) {
    throw new Error(`Data directory does not exist: ${dataDir}`);
  }

  let relPaths: string[];
  if (options?.files !== undefined) {
    const seen = new Set<string>();
    relPaths = [];
    for (const raw of options.files) {
      const norm = normalizeRelativePath(raw);
      if (seen.has(norm)) {
        throw new Error(`Duplicate dataset file path "${norm}"`);
      }
      seen.add(norm);
      relPaths.push(norm);
    }
  } else {
    relPaths = [];
    walkFilesRecursively(absDir, absDir, relPaths);
  }

  relPaths.sort(compareUtf8Bytes);
  const entries: DatasetFileEntry[] = [];

  for (const relPath of relPaths) {
    const absPath = resolve(absDir, relPath);
    if (!existsSync(absPath) || !statSync(absPath).isFile()) {
      throw new Error(`Dataset file not found: ${relPath}`);
    }
    const bytes = readFileSync(absPath);
    const sha256 = sha256HexBytes(bytes);
    const kind = inferDatasetKind(relPath);
    const parsed = parseFileRows(relPath, kind, bytes.toString("utf8"));
    if (!parsed.ok) {
      throw new Error(parsed.error.message);
    }
    const strataCounts = computeStrataCounts(kind, parsed.rows);
    entries.push({
      path: relPath,
      kind,
      sha256,
      bytes: bytes.length,
      rowCount: parsed.rowCount,
      ...(Object.keys(strataCounts).length > 0 ? { strataCounts } : {}),
    });
  }

  return {
    schemaVersion: 1,
    files: entries,
    manifestHash: computeManifestEnvelopeHash(entries),
  };
}

/**
 * Verifies a dataset manifest on disk: schema, canonical UTF-8 sort order, SHA-256 byte
 * equality, JSONL row schema, row counts, and envelope hash (`AC-EVAL-01`).
 */
export function verifyDatasetManifest(
  dataDir: string,
  manifest: unknown
): DatasetVerifyResult {
  const errors: DatasetVerifyError[] = [];
  if (!isPlainObject(manifest) || manifest["schemaVersion"] !== 1 || !Array.isArray(manifest["files"])) {
    return {
      ok: false,
      fileCount: 0,
      totalRows: 0,
      errors: [{ code: "INVALID_MANIFEST", message: "Manifest must be schemaVersion 1 with files[]" }],
    };
  }

  const rawFiles = manifest["files"] as unknown[];
  const absDir = resolve(dataDir);
  const verifiedEntries: DatasetFileEntry[] = [];
  const seenPaths = new Set<string>();
  let totalRows = 0;

  for (let i = 0; i < rawFiles.length; i += 1) {
    const item = rawFiles[i];
    if (!isPlainObject(item) || typeof item["path"] !== "string" || typeof item["sha256"] !== "string") {
      errors.push({ code: "INVALID_MANIFEST", message: `files[${i}] missing path or sha256` });
      continue;
    }
    let normPath: string;
    try {
      normPath = normalizeRelativePath(item["path"]);
    } catch (err) {
      errors.push({
        code: "INVALID_PATH",
        path: item["path"],
        message: err instanceof Error ? err.message : String(err),
      });
      continue;
    }
    if (normPath !== item["path"]) {
      errors.push({
        code: "INVALID_PATH",
        path: item["path"],
        message: `Non-canonical path "${item["path"]}" (expected "${normPath}")`,
      });
      continue;
    }
    if (seenPaths.has(normPath)) {
      errors.push({
        code: "INVALID_MANIFEST",
        path: normPath,
        message: `Duplicate manifest entry "${normPath}"`,
      });
      continue;
    }
    if (i > 0) {
      const prevEntry = rawFiles[i - 1];
      if (isPlainObject(prevEntry) && typeof prevEntry["path"] === "string") {
        if (compareUtf8Bytes(prevEntry["path"], normPath) >= 0) {
          errors.push({
            code: "UNSORTED_MANIFEST",
            path: normPath,
            message: `Manifest entries are not strictly sorted ascending by UTF-8 byte order ("${prevEntry["path"]}" before "${normPath}")`,
          });
        }
      }
    }
    seenPaths.add(normPath);

    const expectedSha = item["sha256"];
    if (!isBareSha256Hex(expectedSha)) {
      errors.push({
        code: "INVALID_MANIFEST",
        path: normPath,
        message: `${normPath}: sha256 must be a bare 64-char lowercase hex string`,
      });
      continue;
    }

    const absPath = resolve(absDir, normPath);
    if (!existsSync(absPath) || !statSync(absPath).isFile()) {
      errors.push({
        code: "MISSING_FILE",
        path: normPath,
        message: `Dataset file missing: ${normPath}`,
      });
      continue;
    }

    const bytes = readFileSync(absPath);
    const actualSha = sha256HexBytes(bytes);
    if (actualSha !== expectedSha) {
      errors.push({
        code: "HASH_MISMATCH",
        path: normPath,
        message: `${normPath}: SHA-256 mismatch (expected ${expectedSha}, got ${actualSha})`,
      });
      continue;
    }

    const kind =
      typeof item["kind"] === "string"
        ? (item["kind"] as DatasetKind)
        : inferDatasetKind(normPath);
    const parsed = parseFileRows(normPath, kind, bytes.toString("utf8"));
    if (!parsed.ok) {
      errors.push(parsed.error);
      continue;
    }
    if (typeof item["bytes"] !== "number" || item["bytes"] !== bytes.length) {
      errors.push({
        code: "INVALID_MANIFEST",
        path: normPath,
        message: `${normPath}: bytes mismatch (expected ${String(item["bytes"])}, got ${bytes.length})`,
      });
      continue;
    }
    if (typeof item["rowCount"] !== "number" || item["rowCount"] !== parsed.rowCount) {
      errors.push({
        code: "ROW_COUNT_MISMATCH",
        path: normPath,
        message: `${normPath}: rowCount mismatch (expected ${String(item["rowCount"])}, got ${parsed.rowCount})`,
      });
      continue;
    }

    totalRows += parsed.rowCount;
    verifiedEntries.push({
      path: normPath,
      kind,
      sha256: actualSha,
      bytes: bytes.length,
      rowCount: parsed.rowCount,
    });
  }

  if (typeof manifest["manifestHash"] !== "string" || !isBareSha256Hex(manifest["manifestHash"])) {
    errors.push({
      code: "INVALID_MANIFEST",
      message: "manifestHash must be a bare 64-char lowercase hex string",
    });
  } else if (errors.length === 0) {
    const computedEnvelope = computeManifestEnvelopeHash(verifiedEntries);
    if (computedEnvelope !== manifest["manifestHash"]) {
      errors.push({
        code: "MANIFEST_HASH_MISMATCH",
        message: `manifestHash mismatch (expected ${manifest["manifestHash"]}, got ${computedEnvelope})`,
      });
    }
  }

  return {
    ok: errors.length === 0,
    fileCount: verifiedEntries.length,
    totalRows,
    errors,
  };
}

/**
 * Creates & validates a Phase 1 RunManifest (`07` §2.3–§2.4, `AC-EVAL-04`).
 */
export function createRunManifest(input: Omit<RunManifest, "schemaVersion">): RunManifest {
  const sortedDatasets: Record<string, string> = {};
  for (const k of Object.keys(input.datasetHashes).sort(compareUtf8Bytes)) {
    sortedDatasets[k] = input.datasetHashes[k]!;
  }
  const sortedSeeds: Record<string, number> = {};
  for (const k of Object.keys(input.seeds).sort(compareUtf8Bytes)) {
    sortedSeeds[k] = input.seeds[k]!;
  }
  const manifest: RunManifest = {
    schemaVersion: 1,
    ...input,
    datasetHashes: sortedDatasets,
    seeds: sortedSeeds,
  };
  const check = validateRunManifest(manifest);
  if (!check.ok) {
    throw new Error(`Invalid RunManifest: ${check.errors.join("; ")}`);
  }
  return manifest;
}

export function validateRunManifest(raw: unknown): RunManifestValidationResult {
  const errors: string[] = [];
  if (!isPlainObject(raw) || raw["schemaVersion"] !== 1) {
    return { ok: false, errors: ["RunManifest must be schemaVersion 1"] };
  }
  if (!nonEmptyString(raw["runId"])) errors.push("runId is required");
  if (typeof raw["tier_a_hash"] !== "string" || !isBareSha256Hex(raw["tier_a_hash"])) {
    errors.push("tier_a_hash must be bare 64-char lowercase hex");
  }
  if (typeof raw["tier_b_hash"] !== "string" || !isBareSha256Hex(raw["tier_b_hash"])) {
    errors.push("tier_b_hash must be bare 64-char lowercase hex");
  }
  if (
    raw["cf1_baseline_hash"] !== undefined &&
    (typeof raw["cf1_baseline_hash"] !== "string" || !isBareSha256Hex(raw["cf1_baseline_hash"]))
  ) {
    errors.push("cf1_baseline_hash must be bare 64-char lowercase hex");
  }
  if (!nonEmptyString(raw["gitCommit"])) errors.push("gitCommit is required");
  if (raw["samplingMode"] !== "browser_default" && raw["samplingMode"] !== "generation_config") {
    errors.push('samplingMode must be "browser_default" or "generation_config"');
  }
  if (!nonEmptyString(raw["runtimeVersion"])) errors.push("runtimeVersion is required");
  if (!nonEmptyString(raw["baseModelName"])) errors.push("baseModelName is required");
  if (!isPlainObject(raw["datasetHashes"])) {
    errors.push("datasetHashes must be an object");
  } else {
    for (const [k, v] of Object.entries(raw["datasetHashes"])) {
      if (typeof v !== "string" || !isBareSha256Hex(v)) {
        errors.push(`datasetHashes["${k}"] must be bare 64-char lowercase hex`);
      }
    }
  }
  if (
    !isPlainObject(raw["calibratedVariant"]) ||
    !nonEmptyString(raw["calibratedVariant"]["schemaId"]) ||
    typeof raw["calibratedVariant"]["reasoningCap"] !== "number" ||
    !Number.isInteger(raw["calibratedVariant"]["reasoningCap"]) ||
    raw["calibratedVariant"]["reasoningCap"] <= 0
  ) {
    errors.push("calibratedVariant.{schemaId, positive integer reasoningCap} is required");
  }
  if (!isPlainObject(raw["seeds"])) {
    errors.push("seeds must be an object");
  } else {
    for (const [k, v] of Object.entries(raw["seeds"])) {
      if (typeof v !== "number" || !Number.isFinite(v)) {
        errors.push(`seeds["${k}"] must be a finite number`);
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

export function runManifestCli(argv: readonly string[]): number {
  let mode: "generate" | "verify" = "generate";
  let dataDir: string | undefined;
  let manifestFile: string | undefined;
  let outFile: string | undefined;
  let jsonFlag = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === "--generate") {
      mode = "generate";
    } else if (arg === "--verify") {
      mode = "verify";
    } else if (arg === "--json") {
      jsonFlag = true;
    } else if (arg === "--data-dir" && i + 1 < argv.length) {
      dataDir = argv[++i]!;
    } else if (arg === "--manifest" && i + 1 < argv.length) {
      manifestFile = argv[++i]!;
    } else if (arg === "--out" && i + 1 < argv.length) {
      outFile = argv[++i]!;
    } else {
      console.error(`Unknown or incomplete flag: ${arg}`);
      return 2;
    }
  }

  if (dataDir === undefined) {
    console.error("--data-dir <dir> is required");
    return 2;
  }

  if (mode === "verify") {
    const mPath = resolve(manifestFile ?? resolve(dataDir, "manifest.json"));
    if (!existsSync(mPath)) {
      const res: DatasetVerifyResult = {
        ok: false,
        fileCount: 0,
        totalRows: 0,
        errors: [{ code: "MANIFEST_NOT_FOUND", path: mPath, message: `Manifest not found: ${mPath}` }],
      };
      if (jsonFlag) console.log(JSON.stringify(res));
      else console.error(res.errors[0]!.message);
      return 1;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(mPath, "utf8"));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const res: DatasetVerifyResult = {
        ok: false,
        fileCount: 0,
        totalRows: 0,
        errors: [{ code: "INVALID_MANIFEST", path: mPath, message: `Malformed manifest JSON: ${msg}` }],
      };
      if (jsonFlag) console.log(JSON.stringify(res));
      else console.error(res.errors[0]!.message);
      return 1;
    }
    const res = verifyDatasetManifest(dataDir, parsed);
    if (jsonFlag) {
      console.log(JSON.stringify(res));
    } else if (res.ok) {
      console.log(`Manifest verified: ${res.fileCount} files, ${res.totalRows} rows.`);
    } else {
      for (const e of res.errors) {
        console.error(`${e.code}: ${e.message}`);
      }
    }
    return res.ok ? 0 : 1;
  }

  try {
    const manifest = generateDatasetManifest(dataDir);
    const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
    if (outFile !== undefined) {
      const absOut = resolve(outFile);
      mkdirSync(dirname(absOut), { recursive: true });
      writeFileSync(absOut, serialized, "utf8");
    }
    if (jsonFlag) {
      console.log(JSON.stringify(manifest));
    } else {
      console.log(`Generated manifest for ${manifest.files.length} files (${manifest.manifestHash}).`);
    }
    return 0;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (jsonFlag) console.log(JSON.stringify({ ok: false, message: msg }));
    else console.error(msg);
    return 1;
  }
}

const entryArg = process.argv[1];
if (entryArg !== undefined && pathToFileURL(resolve(entryArg)).href === import.meta.url) {
  process.exit(runManifestCli(process.argv.slice(2)));
}
