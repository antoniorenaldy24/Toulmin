/**
 * Canonical Cloud Functions callable request/response contracts, Pub/Sub budget alert schema,
 * and linear-time input validation helpers (`docs/spec/05_BACKEND_SECURITY_AND_FINOPS.md` §3).
 *
 * Pure module: zero Firebase, DOM, network, Node I/O, clock, or regex usage.
 */

export interface BibResolveItem {
  key: string;
  doi?: string;
  title?: string;
  authors?: string[];
  year?: number;
  raw?: string;
}

export interface BibResolveRequest {
  items: BibResolveItem[];
  doiOnly?: boolean;
}

export type BibResultStatus =
  | "RESOLVED"
  | "DOI_NOT_FOUND"
  | "NOT_INDEXED"
  | "AMBIGUOUS"
  | "METADATA_MISMATCH"
  | "UPSTREAM_UNAVAILABLE"
  | "RATE_LIMITED"
  | "PENDING";

export interface BibResult {
  key: string;
  status: BibResultStatus;
  refId: string | null;
  doi: string | null;
  openalexId: string | null;
  s2PaperId: string | null;
  title: string | null;
  authors: Array<{ family: string; given?: string }>;
  authorCount: number;
  year: number | null;
  venue: string | null;
  isPreprint: boolean;
  isRetracted: boolean;
  retraction: {
    source: "OPENALEX" | "CROSSREF" | "RW_SNAPSHOT";
    date?: string;
    noticeDoi?: string;
  } | null;
  mismatch: Array<"TITLE" | "YEAR" | "FIRST_AUTHOR"> | null;
  oaAvailable: boolean;
  abstract: string | null;
  abstractSource: "OPENALEX" | "S2" | "CROSSREF" | null;
  candidates?: Array<{ doi: string; title: string; year: number }>;
}

export interface BibResolveResponse {
  results: BibResult[];
}

export interface OaFetchRequest {
  refId: string;
}

export type OaSourceKind = "JATS" | "PDF" | "ARXIV" | "NONE";
export type OaFailureReason =
  | "NO_OA"
  | "IDENTITY_MISMATCH"
  | "PARSER_BUSY"
  | "FETCH_FAILED"
  | "LICENSE_UNKNOWN";

export interface OaFetchUnit {
  chunkId: string;
  text: string;
  tier: "clean" | "logged" | "blocked";
  reasons: string[];
}

export interface OaFetchSection {
  label: string;
  units: OaFetchUnit[];
}

export interface OaFetchResponse {
  refId: string;
  source: OaSourceKind;
  reason?: OaFailureReason;
  license: string | null;
  cached: boolean;
  sections: OaFetchSection[];
  fetchedAt: number;
}

export interface OaParseResponse {
  kind: "PDF" | "JATS";
  units: Array<{ section: string; text: string }>;
  identity: {
    doiOnPage1to2: string | null;
    firstPageTitle: string | null;
    arxivIdOnPage1: string | null;
    jatsDoi: string | null;
  };
  hiddenTextDropped: number;
}

export interface RedeemJudgeCodeRequest {
  code: string;
}

export interface RedeemJudgeCodeResponse {
  ok: true;
  pool: "judge";
  tierExp: number;
}

export const QUOTA_GUARD_KINDS = ["L2", "ALT", "SAMPLE"] as const;
export type QuotaGuardKind = (typeof QUOTA_GUARD_KINDS)[number];

export interface QuotaGuardRequest {
  claimHashes: string[];
  kind: QuotaGuardKind;
}

export interface QuotaGuardLease {
  claimHash: string;
  leaseId: string;
  exp: number;
}

export interface QuotaGuardSuccessResponse {
  ok: true;
  pool: "anon" | "judge" | "sample";
  leaseId: string;
  leases: QuotaGuardLease[];
  exp: number;
  remainingToday: number;
  resetsAt: number;
}

export const QUOTA_DENIED_REASONS = [
  "KILL_SWITCH",
  "HARD_STOP",
  "POOL_EXHAUSTED",
  "QUOTA_EXCEEDED",
  "NET_LIMIT",
] as const;
export type QuotaDeniedReason = (typeof QUOTA_DENIED_REASONS)[number];

export interface QuotaGuardDeniedResponse {
  ok: false;
  reason: QuotaDeniedReason;
  resetsAt: number;
}

export type QuotaGuardResponse = QuotaGuardSuccessResponse | QuotaGuardDeniedResponse;

export interface BudgetMessage {
  budgetDisplayName: string;
  costAmount: number;
  budgetAmount: number;
  alertThresholdExceeded?: number;
}

export interface BackendValidationResult<T> {
  readonly ok: boolean;
  readonly value?: T;
  readonly errors: readonly string[];
}

function isAsciiDigit(code: number): boolean {
  return code >= 0x30 && code <= 0x39;
}

function isAsciiLowerAlpha(code: number): boolean {
  return code >= 0x61 && code <= 0x7a;
}

function isAsciiAlpha(code: number): boolean {
  return (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a);
}

/**
 * Validates bare 64-character lowercase SHA-256 hex digest.
 */
export function isValidSha256Hex(value: unknown): value is string {
  if (typeof value !== "string" || value.length !== 64) {
    return false;
  }
  for (let i = 0; i < 64; i += 1) {
    const c = value.charCodeAt(i);
    if (!isAsciiDigit(c) && !(c >= 0x61 && c <= 0x66)) {
      return false;
    }
  }
  return true;
}

function isDisallowedDoiCodeUnit(c: number): boolean {
  if (c <= 0x20 || (c >= 0x7f && c <= 0x9f)) {
    return true;
  }
  if (
    c === 0x00a0 ||
    c === 0x1680 ||
    (c >= 0x2000 && c <= 0x200a) ||
    c === 0x2028 ||
    c === 0x2029 ||
    c === 0x202f ||
    c === 0x205f ||
    c === 0x3000 ||
    c === 0xfeff
  ) {
    return true;
  }
  return false;
}

/**
 * Validates normalized DOI per `05` §3: `10.` + 4–9 `DIGIT` + `/` + 1–300 non-whitespace, non-control chars.
 */
export function isValidDoi(value: string): boolean {
  if (!value.startsWith("10.")) {
    return false;
  }
  const slashIdx = value.indexOf("/", 3);
  if (slashIdx === -1) {
    return false;
  }
  const registrantLen = slashIdx - 3;
  if (registrantLen < 4 || registrantLen > 9) {
    return false;
  }
  for (let i = 3; i < slashIdx; i += 1) {
    if (!isAsciiDigit(value.charCodeAt(i))) {
      return false;
    }
  }
  const suffix = value.slice(slashIdx + 1);
  if (suffix.length < 1 || suffix.length > 300) {
    return false;
  }
  for (let i = 0; i < suffix.length; i += 1) {
    const c = suffix.charCodeAt(i);
    if (isDisallowedDoiCodeUnit(c)) {
      return false;
    }
    if (c >= 0xd800 && c <= 0xdbff) {
      if (i + 1 >= suffix.length) {
        return false;
      }
      const next = suffix.charCodeAt(i + 1);
      if (next < 0xdc00 || next > 0xdfff) {
        return false;
      }
      i += 1;
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      return false;
    }
  }
  return true;
}

/**
 * Validates `PMC` followed by 1–10 ASCII digits (`05` §3).
 */
export function isValidPmcid(value: string): boolean {
  if (!value.startsWith("PMC")) {
    return false;
  }
  const digits = value.slice(3);
  if (digits.length < 1 || digits.length > 10) {
    return false;
  }
  for (let i = 0; i < digits.length; i += 1) {
    if (!isAsciiDigit(digits.charCodeAt(i))) {
      return false;
    }
  }
  return true;
}

function parseOptionalVersionSuffix(s: string): number {
  const vIdx = s.lastIndexOf("v");
  if (vIdx === -1) {
    return s.length;
  }
  if (vIdx === s.length - 1) {
    return -1;
  }
  for (let i = vIdx + 1; i < s.length; i += 1) {
    if (!isAsciiDigit(s.charCodeAt(i))) {
      return -1;
    }
  }
  return vIdx;
}

/**
 * Validates `DDDD.DDDDD(vN)?` or legacy `archive(.XX)?/DDDDDDD(vN)?` (`05` §3).
 */
export function isValidArxivId(value: string): boolean {
  const slashIdx = value.indexOf("/");
  if (slashIdx === -1) {
    // New style: DDDD.DDDDD(vN)?
    const baseEnd = parseOptionalVersionSuffix(value);
    if (baseEnd <= 0) {
      return false;
    }
    const base = value.slice(0, baseEnd);
    if (base.length !== 10 || base.charAt(4) !== ".") {
      return false;
    }
    for (let i = 0; i < 10; i += 1) {
      if (i === 4) continue;
      if (!isAsciiDigit(base.charCodeAt(i))) {
        return false;
      }
    }
    return true;
  }
  // Old style: archive(.XX)?/DDDDDDD(vN)? (strip vN only on the numeric ID part after '/')
  const archivePart = value.slice(0, slashIdx);
  const idAndVer = value.slice(slashIdx + 1);
  const numEnd = parseOptionalVersionSuffix(idAndVer);
  if (numEnd !== 7) {
    return false;
  }
  const numPart = idAndVer.slice(0, numEnd);
  for (let i = 0; i < 7; i += 1) {
    if (!isAsciiDigit(numPart.charCodeAt(i))) {
      return false;
    }
  }
  const dotIdx = archivePart.indexOf(".");
  if (dotIdx === -1) {
    if (archivePart.length < 1) return false;
    for (let i = 0; i < archivePart.length; i += 1) {
      const c = archivePart.charCodeAt(i);
      if (!isAsciiLowerAlpha(c) && c !== 0x2d /* - */) {
        return false;
      }
    }
    return true;
  }
  const main = archivePart.slice(0, dotIdx);
  const sub = archivePart.slice(dotIdx + 1);
  if (main.length < 1 || sub.length !== 2) {
    return false;
  }
  for (let i = 0; i < main.length; i += 1) {
    const c = main.charCodeAt(i);
    if (!isAsciiLowerAlpha(c) && c !== 0x2d) {
      return false;
    }
  }
  return isAsciiAlpha(sub.charCodeAt(0)) && isAsciiAlpha(sub.charCodeAt(1));
}

/**
 * Validates `refId` per `05` §3: `doi:` + valid DOI, or `oa:W` + 1–12 ASCII digits.
 */
export function isValidRefId(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  if (value.startsWith("doi:")) {
    return isValidDoi(value.slice(4));
  }
  if (value.startsWith("oa:W")) {
    const digits = value.slice(4);
    if (digits.length < 1 || digits.length > 12) {
      return false;
    }
    for (let i = 0; i < digits.length; i += 1) {
      if (!isAsciiDigit(digits.charCodeAt(i))) {
        return false;
      }
    }
    return true;
  }
  return false;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function checkAllowedKeys(
  obj: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  path: string,
  errors: string[]
): void {
  const allowed = new Set<string>([...required, ...optional]);
  for (const r of required) {
    if (!Object.prototype.hasOwnProperty.call(obj, r) || obj[r] === undefined) {
      errors.push(`${path}.${r}: missing required property`);
    }
  }
  for (const k of Object.keys(obj)) {
    if (!allowed.has(k)) {
      errors.push(`${path}.${k}: unknown property`);
    }
  }
}

export function validateBibResolveRequest(v: unknown): BackendValidationResult<BibResolveRequest> {
  const errors: string[] = [];
  if (!isRecord(v)) {
    return { ok: false, errors: ["$: expected BibResolveRequest object"] };
  }
  checkAllowedKeys(v, ["items"], ["doiOnly"], "$", errors);
  if (v["doiOnly"] !== undefined && typeof v["doiOnly"] !== "boolean") {
    errors.push("$.doiOnly: expected boolean");
  }
  if (!Array.isArray(v["items"])) {
    errors.push("$.items: expected array");
    return { ok: false, errors };
  }
  if (v["items"].length < 1 || v["items"].length > 100) {
    errors.push(`$.items: expected 1..100 items, received ${v["items"].length}`);
  }

  let rawCount = 0;
  for (let i = 0; i < v["items"].length; i += 1) {
    const item = v["items"][i];
    const p = `$.items[${i}]`;
    if (!isRecord(item)) {
      errors.push(`${p}: expected object`);
      continue;
    }
    checkAllowedKeys(item, ["key"], ["doi", "title", "authors", "year", "raw"], p, errors);
    if (typeof item["key"] !== "string" || item["key"].length === 0) {
      errors.push(`${p}.key: expected non-empty string`);
    }
    if (item["doi"] !== undefined) {
      if (typeof item["doi"] !== "string" || !isValidDoi(item["doi"])) {
        errors.push(`${p}.doi: invalid DOI`);
      }
    }
    if (item["title"] !== undefined) {
      if (typeof item["title"] !== "string" || item["title"].length > 500) {
        errors.push(`${p}.title: expected string <= 500 chars`);
      }
    }
    if (item["authors"] !== undefined) {
      if (
        !Array.isArray(item["authors"]) ||
        !item["authors"].every((a) => typeof a === "string")
      ) {
        errors.push(`${p}.authors: expected string[]`);
      }
    }
    if (item["year"] !== undefined) {
      if (typeof item["year"] !== "number" || !Number.isInteger(item["year"])) {
        errors.push(`${p}.year: expected integer`);
      }
    }
    if (item["raw"] !== undefined) {
      rawCount += 1;
      if (typeof item["raw"] !== "string" || item["raw"].length > 1000) {
        errors.push(`${p}.raw: expected string <= 1000 chars`);
      }
    }
  }
  if (rawCount > 50) {
    errors.push(`$.items: at most 50 items may carry raw strings, received ${rawCount}`);
  }

  return errors.length === 0
    ? { ok: true, value: v as unknown as BibResolveRequest, errors: [] }
    : { ok: false, errors };
}

/**
 * Strictly validates `oaFetch` / `oaFetchJudge` request (`05` §3.2.1, AC-FN-05):
 * accepts ONLY `{ refId: string }`; any unknown field (e.g. `url`, `license`) is rejected.
 */
export function validateOaFetchRequest(v: unknown): BackendValidationResult<OaFetchRequest> {
  const errors: string[] = [];
  if (!isRecord(v)) {
    return { ok: false, errors: ["$: expected OaFetchRequest object"] };
  }
  checkAllowedKeys(v, ["refId"], [], "$", errors);
  if (!isValidRefId(v["refId"])) {
    errors.push("$.refId: invalid refId (expected doi:<DOI> or oa:W<digits>)");
  }
  return errors.length === 0
    ? { ok: true, value: v as unknown as OaFetchRequest, errors: [] }
    : { ok: false, errors };
}

export function validateRedeemJudgeCodeRequest(
  v: unknown
): BackendValidationResult<RedeemJudgeCodeRequest> {
  const errors: string[] = [];
  if (!isRecord(v)) {
    return { ok: false, errors: ["$: expected RedeemJudgeCodeRequest object"] };
  }
  checkAllowedKeys(v, ["code"], [], "$", errors);
  if (typeof v["code"] !== "string" || v["code"].trim().length === 0 || v["code"].length > 64) {
    errors.push("$.code: expected non-empty string <= 64 chars");
  }
  return errors.length === 0
    ? { ok: true, value: v as unknown as RedeemJudgeCodeRequest, errors: [] }
    : { ok: false, errors };
}

export function validateQuotaGuardRequest(v: unknown): BackendValidationResult<QuotaGuardRequest> {
  const errors: string[] = [];
  if (!isRecord(v)) {
    return { ok: false, errors: ["$: expected QuotaGuardRequest object"] };
  }
  checkAllowedKeys(v, ["claimHashes", "kind"], [], "$", errors);
  if (!QUOTA_GUARD_KINDS.includes(v["kind"] as QuotaGuardKind)) {
    errors.push("$.kind: expected L2 | ALT | SAMPLE");
  }
  if (!Array.isArray(v["claimHashes"])) {
    errors.push("$.claimHashes: expected string[]");
  } else {
    if (v["claimHashes"].length < 1 || v["claimHashes"].length > 25) {
      errors.push(`$.claimHashes: expected 1..25 hashes, received ${v["claimHashes"].length}`);
    }
    for (let i = 0; i < v["claimHashes"].length; i += 1) {
      if (!isValidSha256Hex(v["claimHashes"][i])) {
        errors.push(`$.claimHashes[${i}]: expected bare 64-char lowercase hex SHA-256`);
      }
    }
  }
  return errors.length === 0
    ? { ok: true, value: v as unknown as QuotaGuardRequest, errors: [] }
    : { ok: false, errors };
}

/**
 * Validates a Google Cloud Billing Pub/Sub budget notification payload (`05` §3.5).
 * Allows standard GCP metadata fields (`costIntervalStart`, `currencyCode`, `schemaVersion`, etc.).
 */
export function validateBudgetMessage(v: unknown): BackendValidationResult<BudgetMessage> {
  const errors: string[] = [];
  if (!isRecord(v)) {
    return { ok: false, errors: ["$: expected BudgetMessage object"] };
  }
  if (typeof v["budgetDisplayName"] !== "string" || v["budgetDisplayName"].length === 0) {
    errors.push("$.budgetDisplayName: expected non-empty string");
  }
  if (typeof v["costAmount"] !== "number" || !Number.isFinite(v["costAmount"]) || v["costAmount"] < 0) {
    errors.push("$.costAmount: expected non-negative finite number");
  }
  if (
    typeof v["budgetAmount"] !== "number" ||
    !Number.isFinite(v["budgetAmount"]) ||
    v["budgetAmount"] <= 0
  ) {
    errors.push("$.budgetAmount: expected positive finite number");
  }
  if (
    v["alertThresholdExceeded"] !== undefined &&
    (typeof v["alertThresholdExceeded"] !== "number" ||
      !Number.isFinite(v["alertThresholdExceeded"]))
  ) {
    errors.push("$.alertThresholdExceeded: expected finite number");
  }
  return errors.length === 0
    ? { ok: true, value: v as unknown as BudgetMessage, errors: [] }
    : { ok: false, errors };
}
