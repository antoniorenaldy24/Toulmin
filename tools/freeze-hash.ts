import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export type FreezeTier = "tier_a" | "tier_b" | "cf1_baselines";

export interface FreezeFileEntry {
  readonly path: string;
  readonly sha256: string;
}

export interface FreezeHashResult {
  readonly hash: string;
  readonly fileCount: number;
  readonly files: readonly FreezeFileEntry[];
  readonly manifestPayload: string;
}

export type FreezeCheckErrorCode =
  | "MANIFEST_NOT_FOUND"
  | "EMPTY_MANIFEST"
  | "INVALID_PATH"
  | "DUPLICATE_PATH"
  | "UNSORTED_MANIFEST"
  | "MISSING_FILE"
  | "INVALID_EXPECTED_HASH"
  | "HASH_MISMATCH";

export interface FreezeCheckResult {
  readonly ok: boolean;
  readonly hash?: string;
  readonly expectedHash?: string;
  readonly fileCount: number;
  readonly errorCode?: FreezeCheckErrorCode;
  readonly message?: string;
}

export class FreezeManifestError extends Error {
  readonly code: FreezeCheckErrorCode;

  constructor(code: FreezeCheckErrorCode, message: string) {
    super(message);
    this.name = "FreezeManifestError";
    this.code = code;
  }
}

export const TIER_MANIFEST_PATHS: Readonly<Record<FreezeTier, string>> = {
  tier_a: "freeze/tier_a.txt",
  tier_b: "freeze/tier_b.txt",
  cf1_baselines: "freeze/cf1_baselines.txt",
};

const TIER_A_RAW_ASSETS = [
  "packages/core-l0/bm25_min_cov.json",
  "packages/core-l0/norm_table.json",
  "packages/core-l0/porter_v1.json",
  "packages/core-l0/unicode_15_1.bin",
  "packages/core-l0/wordlist_en.txt",
] as const;

const TIER_B_CORE_L0_EXCLUDES = new Set<string>([
  "anchor.ts",
  "b5pairing.ts",
  "triageBaseline.ts",
  "ledger.ts",
  "gate.ts",
  "fastpath.ts",
  "watchdog.ts",
]);

const TIER_B_CONFORMANCE_EXCLUDES = new Set<string>([
  "anchor.json",
  "b5pairing.json",
  "b5_baseline.json",
  "b5_incremental.json",
  "triage_baseline.json",
  "reducer.json",
  "meter.json",
  "gate.json",
  "support_gate.json",
  "holm.json",
  "ocr_rows.json",
]);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
export const DEFAULT_REPO_ROOT = resolve(__dirname, "..");

export function sha256HexBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function sha256HexUtf8(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function isBareSha256Hex(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}

/**
 * Deterministic ascending UTF-8 byte-order comparator (`Buffer.compare`).
 */
export function compareUtf8Bytes(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

/**
 * Normalizes a manifest path to `/` separators and rejects unsafe, absolute, or non-canonical entries.
 */
export function normalizeManifestPath(rawPath: string): string {
  const trimmed = rawPath.trim();
  if (trimmed.length === 0) {
    throw new FreezeManifestError("INVALID_PATH", "Empty manifest path is not allowed");
  }
  for (let i = 0; i < trimmed.length; i += 1) {
    const code = trimmed.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) {
      throw new FreezeManifestError(
        "INVALID_PATH",
        `Control character in manifest path "${trimmed}"`
      );
    }
  }
  let normalized = trimmed.replaceAll("\\", "/");
  while (normalized.startsWith("./")) {
    normalized = normalized.slice(2);
  }
  if (
    normalized.length === 0 ||
    normalized.startsWith("/") ||
    normalized.endsWith("/") ||
    /^[A-Za-z]:/.test(normalized)
  ) {
    throw new FreezeManifestError(
      "INVALID_PATH",
      `Manifest path must be relative to repo root: "${rawPath}"`
    );
  }
  const segments = normalized.split("/");
  for (const seg of segments) {
    if (seg.length === 0 || seg === "." || seg === "..") {
      throw new FreezeManifestError(
        "INVALID_PATH",
        `Invalid path segment "${seg}" in "${rawPath}"`
      );
    }
  }
  return normalized;
}

/**
 * Parses a freeze manifest (`\r?\n`, ignoring blank lines and `#` comments).
 * When `requireCanonicalOrder` is true, enforces `/` separators, no `./` prefix,
 * ascending UTF-8 byte sort order, and uniqueness.
 */
export function parseManifestText(
  text: string,
  options?: { readonly requireCanonicalOrder?: boolean }
): string[] {
  const requireCanonical = options?.requireCanonicalOrder ?? false;
  const lines = text.split(/\r?\n/);
  const parsed: string[] = [];
  const seen = new Set<string>();

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      continue;
    }
    const normalized = normalizeManifestPath(rawLine);
    if (requireCanonical && rawLine !== normalized) {
      throw new FreezeManifestError(
        "INVALID_PATH",
        `Non-canonical manifest path entry "${rawLine}" (expected "${normalized}")`
      );
    }
    if (seen.has(normalized)) {
      throw new FreezeManifestError("DUPLICATE_PATH", `Duplicate manifest path "${normalized}"`);
    }
    seen.add(normalized);
    parsed.push(normalized);
  }

  if (parsed.length === 0) {
    throw new FreezeManifestError("EMPTY_MANIFEST", "Freeze manifest contains zero file entries");
  }

  if (requireCanonical) {
    for (let i = 1; i < parsed.length; i += 1) {
      const prev = parsed[i - 1]!;
      const curr = parsed[i]!;
      if (compareUtf8Bytes(prev, curr) >= 0) {
        throw new FreezeManifestError(
          "UNSORTED_MANIFEST",
          `Manifest is not strictly sorted ascending by UTF-8 byte order ("${prev}" before "${curr}")`
        );
      }
    }
  }

  return parsed;
}

/**
 * Formats paths as a canonical LF-delimited, ascending UTF-8-sorted freeze manifest.
 */
export function formatManifestText(paths: readonly string[]): string {
  const normalizedSet = new Set<string>();
  const out: string[] = [];
  for (const raw of paths) {
    const norm = normalizeManifestPath(raw);
    if (normalizedSet.has(norm)) {
      throw new FreezeManifestError("DUPLICATE_PATH", `Duplicate manifest path "${norm}"`);
    }
    normalizedSet.add(norm);
    out.push(norm);
  }
  if (out.length === 0) {
    throw new FreezeManifestError("EMPTY_MANIFEST", "Cannot format an empty freeze manifest");
  }
  out.sort(compareUtf8Bytes);
  return out.join("\n") + "\n";
}

/**
 * Collects the current TypeScript Tier A file scope (`packages/core-l0/src/*.ts`,
 * 5 raw Tier A assets, Tier A `conformance/l0/*.json`, and 10 on-device `packages/schemas/*.schema.json`).
 */
export function collectTierATsFiles(repoRoot: string = DEFAULT_REPO_ROOT): string[] {
  const collected: string[] = [];

  const coreSrcDir = resolve(repoRoot, "packages", "core-l0", "src");
  if (existsSync(coreSrcDir)) {
    for (const entry of readdirSync(coreSrcDir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".ts") && !TIER_B_CORE_L0_EXCLUDES.has(entry.name)) {
        collected.push(
          normalizeManifestPath(relative(repoRoot, resolve(coreSrcDir, entry.name)))
        );
      }
    }
  }

  for (const assetRel of TIER_A_RAW_ASSETS) {
    if (existsSync(resolve(repoRoot, assetRel))) {
      collected.push(normalizeManifestPath(assetRel));
    }
  }

  const confDir = resolve(repoRoot, "conformance", "l0");
  if (existsSync(confDir)) {
    for (const entry of readdirSync(confDir, { withFileTypes: true })) {
      if (
        entry.isFile() &&
        entry.name.endsWith(".json") &&
        !TIER_B_CONFORMANCE_EXCLUDES.has(entry.name)
      ) {
        collected.push(normalizeManifestPath(relative(repoRoot, resolve(confDir, entry.name))));
      }
    }
  }

  const schemasDir = resolve(repoRoot, "packages", "schemas");
  if (existsSync(schemasDir)) {
    for (const entry of readdirSync(schemasDir, { withFileTypes: true })) {
      if (
        entry.isFile() &&
        entry.name.endsWith(".schema.json") &&
        entry.name !== "L2Verdict.schema.json"
      ) {
        collected.push(normalizeManifestPath(relative(repoRoot, resolve(schemasDir, entry.name))));
      }
    }
  }

  const promptsTxtDir = resolve(repoRoot, "packages", "prompts", "p2.1");
  if (existsSync(promptsTxtDir)) {
    for (const entry of readdirSync(promptsTxtDir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".txt") && entry.name !== "l2.txt") {
        collected.push(normalizeManifestPath(relative(repoRoot, resolve(promptsTxtDir, entry.name))));
      }
    }
  }

  const promptsSrcDir = resolve(repoRoot, "packages", "prompts", "src");
  if (existsSync(promptsSrcDir)) {
    for (const entry of readdirSync(promptsSrcDir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".ts")) {
        collected.push(normalizeManifestPath(relative(repoRoot, resolve(promptsSrcDir, entry.name))));
      }
    }
  }

  collected.sort(compareUtf8Bytes);
  return collected;
}

/**
 * Computes the canonical freeze hash (`07` §2.3):
 * `sha256hex` over `"{path}\t{sha256hex(file bytes)}"` lines, sorted ascending by UTF-8 byte order
 * and joined by `"\n"` (no trailing newline).
 */
export function computeFreezeHash(rootDir: string, paths: readonly string[]): FreezeHashResult {
  const seen = new Set<string>();
  const normalizedPaths: string[] = [];
  for (const raw of paths) {
    const norm = normalizeManifestPath(raw);
    if (seen.has(norm)) {
      throw new FreezeManifestError("DUPLICATE_PATH", `Duplicate path "${norm}"`);
    }
    seen.add(norm);
    normalizedPaths.push(norm);
  }
  if (normalizedPaths.length === 0) {
    throw new FreezeManifestError("EMPTY_MANIFEST", "Cannot compute freeze hash for empty file list");
  }
  normalizedPaths.sort(compareUtf8Bytes);

  const absRoot = resolve(rootDir);
  const files: FreezeFileEntry[] = [];
  const lines: string[] = [];

  for (const relPath of normalizedPaths) {
    const absPath = resolve(absRoot, relPath);
    if (!existsSync(absPath)) {
      throw new FreezeManifestError("MISSING_FILE", `Listed freeze file does not exist: ${relPath}`);
    }
    const st = statSync(absPath);
    if (!st.isFile()) {
      throw new FreezeManifestError("MISSING_FILE", `Listed freeze entry is not a regular file: ${relPath}`);
    }
    const bytes = readFileSync(absPath);
    const fileSha = sha256HexBytes(bytes);
    files.push({ path: relPath, sha256: fileSha });
    lines.push(`${relPath}\t${fileSha}`);
  }

  const manifestPayload = lines.join("\n");
  const hash = sha256HexUtf8(manifestPayload);
  return {
    hash,
    fileCount: files.length,
    files,
    manifestPayload,
  };
}

export function writeFreezeManifest(options: {
  readonly rootDir: string;
  readonly manifestPath: string;
  readonly paths: readonly string[];
  readonly hashOutPath?: string;
}): FreezeHashResult {
  const result = computeFreezeHash(options.rootDir, options.paths);
  const absManifest = resolve(options.rootDir, options.manifestPath);
  mkdirSync(dirname(absManifest), { recursive: true });
  writeFileSync(absManifest, formatManifestText(result.files.map((f) => f.path)), "utf8");

  if (options.hashOutPath !== undefined) {
    const absHash = resolve(options.rootDir, options.hashOutPath);
    mkdirSync(dirname(absHash), { recursive: true });
    writeFileSync(absHash, `${result.hash}\n`, "utf8");
  }

  return result;
}

export function checkFreezeManifest(options: {
  readonly rootDir: string;
  readonly manifestPath: string;
  readonly expectedHash?: string;
  readonly hashFilePath?: string;
}): FreezeCheckResult {
  const absManifest = resolve(options.rootDir, options.manifestPath);
  if (!existsSync(absManifest)) {
    return {
      ok: false,
      fileCount: 0,
      errorCode: "MANIFEST_NOT_FOUND",
      message: `Manifest file not found: ${options.manifestPath}`,
    };
  }

  let expectedHash = options.expectedHash?.trim();
  if (expectedHash === undefined && options.hashFilePath !== undefined) {
    const absHashFile = resolve(options.rootDir, options.hashFilePath);
    if (!existsSync(absHashFile)) {
      return {
        ok: false,
        fileCount: 0,
        errorCode: "INVALID_EXPECTED_HASH",
        message: `Expected hash file not found: ${options.hashFilePath}`,
      };
    }
    expectedHash = readFileSync(absHashFile, "utf8").trim();
  }

  if (expectedHash !== undefined && !isBareSha256Hex(expectedHash)) {
    return {
      ok: false,
      expectedHash,
      fileCount: 0,
      errorCode: "INVALID_EXPECTED_HASH",
      message: `Expected hash must be a bare 64-char lowercase hex SHA-256, received "${expectedHash}"`,
    };
  }

  try {
    const rawManifest = readFileSync(absManifest, "utf8");
    const paths = parseManifestText(rawManifest, { requireCanonicalOrder: true });
    const computed = computeFreezeHash(options.rootDir, paths);

    if (expectedHash !== undefined && computed.hash !== expectedHash) {
      return {
        ok: false,
        hash: computed.hash,
        expectedHash,
        fileCount: computed.fileCount,
        errorCode: "HASH_MISMATCH",
        message: `Freeze hash mismatch: expected ${expectedHash}, computed ${computed.hash}`,
      };
    }

    return {
      ok: true,
      hash: computed.hash,
      ...(expectedHash !== undefined ? { expectedHash } : {}),
      fileCount: computed.fileCount,
    };
  } catch (err) {
    if (err instanceof FreezeManifestError) {
      return {
        ok: false,
        ...(expectedHash !== undefined ? { expectedHash } : {}),
        fileCount: 0,
        errorCode: err.code,
        message: err.message,
      };
    }
    throw err;
  }
}

interface ParsedCliArgs {
  mode: "hash" | "write" | "check";
  rootDir: string;
  manifestPath?: string;
  tier?: FreezeTier;
  scope?: "tier_a_ts";
  hashOutPath?: string;
  expectedHash?: string;
  hashFilePath?: string;
  json: boolean;
  positionalPaths: string[];
}

function parseCliArgs(argv: readonly string[]): ParsedCliArgs {
  const out: ParsedCliArgs = {
    mode: "hash",
    rootDir: DEFAULT_REPO_ROOT,
    json: false,
    positionalPaths: [],
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === "--write") {
      out.mode = "write";
    } else if (arg === "--check") {
      out.mode = "check";
    } else if (arg === "--json") {
      out.json = true;
    } else if (arg === "--root" && i + 1 < argv.length) {
      out.rootDir = resolve(argv[++i]!);
    } else if (arg === "--manifest" && i + 1 < argv.length) {
      out.manifestPath = argv[++i]!;
    } else if (arg === "--tier" && i + 1 < argv.length) {
      const tier = argv[++i]!;
      if (tier !== "tier_a" && tier !== "tier_b" && tier !== "cf1_baselines") {
        throw new Error(`Invalid --tier value "${tier}"`);
      }
      out.tier = tier;
    } else if (arg === "--scope" && i + 1 < argv.length) {
      const scope = argv[++i]!;
      if (scope !== "tier_a_ts") {
        throw new Error(`Invalid --scope value "${scope}"`);
      }
      out.scope = scope;
    } else if (arg === "--hash-out" && i + 1 < argv.length) {
      out.hashOutPath = argv[++i]!;
    } else if (arg === "--expected" && i + 1 < argv.length) {
      out.expectedHash = argv[++i]!;
    } else if (arg === "--hash-file" && i + 1 < argv.length) {
      out.hashFilePath = argv[++i]!;
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown CLI flag "${arg}"`);
    } else {
      out.positionalPaths.push(arg);
    }
  }

  return out;
}

export function runFreezeHashCli(argv: readonly string[]): number {
  let args: ParsedCliArgs;
  try {
    args = parseCliArgs(argv);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(msg);
    return 2;
  }

  const manifestPath =
    args.manifestPath ?? (args.tier !== undefined ? TIER_MANIFEST_PATHS[args.tier] : undefined);

  if (args.mode === "write") {
    if (manifestPath === undefined) {
      console.error("--write requires --manifest <path> or --tier <tier_a|tier_b|cf1_baselines>");
      return 2;
    }
    const paths =
      args.scope === "tier_a_ts"
        ? [...collectTierATsFiles(args.rootDir), ...args.positionalPaths]
        : args.positionalPaths;
    try {
      const res = writeFreezeManifest({
        rootDir: args.rootDir,
        manifestPath,
        paths,
        ...(args.hashOutPath !== undefined ? { hashOutPath: args.hashOutPath } : {}),
      });
      if (args.json) {
        console.log(JSON.stringify({ ok: true, hash: res.hash, fileCount: res.fileCount }));
      } else {
        console.log(res.hash);
      }
      return 0;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (args.json) {
        console.log(JSON.stringify({ ok: false, message: msg }));
      } else {
        console.error(msg);
      }
      return 1;
    }
  }

  if (args.mode === "check") {
    if (manifestPath === undefined) {
      console.error("--check requires --manifest <path> or --tier <tier_a|tier_b|cf1_baselines>");
      return 2;
    }
    const res = checkFreezeManifest({
      rootDir: args.rootDir,
      manifestPath,
      ...(args.expectedHash !== undefined ? { expectedHash: args.expectedHash } : {}),
      ...(args.hashFilePath !== undefined ? { hashFilePath: args.hashFilePath } : {}),
    });
    if (args.json) {
      console.log(JSON.stringify(res));
    } else if (res.ok) {
      console.log(res.hash);
    } else {
      console.error(res.message ?? res.errorCode ?? "Freeze check failed");
    }
    return res.ok ? 0 : 1;
  }

  // Default mode: compute and print hash from --scope tier_a_ts, --manifest/--tier, or positional paths
  try {
    let targetPaths: string[];
    if (args.scope === "tier_a_ts") {
      targetPaths = collectTierATsFiles(args.rootDir);
    } else if (manifestPath !== undefined) {
      const raw = readFileSync(resolve(args.rootDir, manifestPath), "utf8");
      targetPaths = parseManifestText(raw, { requireCanonicalOrder: true });
    } else {
      targetPaths = args.positionalPaths;
    }
    const res = computeFreezeHash(args.rootDir, targetPaths);
    if (args.json) {
      console.log(JSON.stringify({ ok: true, hash: res.hash, fileCount: res.fileCount, files: res.files }));
    } else {
      console.log(res.hash);
    }
    return 0;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (args.json) {
      console.log(JSON.stringify({ ok: false, message: msg }));
    } else {
      console.error(msg);
    }
    return 1;
  }
}

const entryArg = process.argv[1];
if (entryArg !== undefined && pathToFileURL(resolve(entryArg)).href === import.meta.url) {
  process.exit(runFreezeHashCli(process.argv.slice(2)));
}
