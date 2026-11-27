import { createHmac } from "node:crypto";
import {
  documentIdField,
  prefixRangeUpperBound,
  type FirestoreLike,
} from "../common/counters.js";
import type { CallerAuthContext, JudgeLaneValidator } from "../common/lanes.js";

export const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CROCKFORD_SET = new Set<string>(CROCKFORD_ALPHABET.split(""));
const CODE_PREFIX = "TLMN";
const PAYLOAD_LENGTH = 8;

/**
 * Canonicalizes a judge code (`05` §3.3.1):
 * - uppercase; strip spaces and `-`;
 * - validate `TLMN` prefix and 8-char payload length BEFORE Crockford character mapping
 *   (so `L` in `TLMN` is never rewritten to `1`);
 * - map `O -> 0`, `I -> 1`, `L -> 1` in the 8-char payload;
 * - require every mapped payload character to belong to Crockford Base32 (rejects `U`).
 */
export function canonical(rawCode: string): string | null {
  if (typeof rawCode !== "string") return null;
  const compact = rawCode.toUpperCase().replace(/[\s-]+/g, "");
  if (compact.length !== CODE_PREFIX.length + PAYLOAD_LENGTH) {
    return null;
  }
  if (!compact.startsWith(CODE_PREFIX)) {
    return null;
  }

  const rawPayload = compact.slice(CODE_PREFIX.length);
  let mapped = "";
  for (let i = 0; i < rawPayload.length; i += 1) {
    let ch = rawPayload.charAt(i);
    if (ch === "O") ch = "0";
    else if (ch === "I" || ch === "L") ch = "1";
    if (!CROCKFORD_SET.has(ch)) {
      return null;
    }
    mapped += ch;
  }
  return `${CODE_PREFIX}${mapped}`;
}

/**
 * Computes lowercase HMAC-SHA256 hex digest of a canonical judge code (`05` §3.3.1).
 */
export function hmacHex(pepper: string, canonicalCode: string): string {
  return createHmac("sha256", pepper).update(canonicalCode, "utf8").digest("hex");
}

function isValidCodeIdPrefix(value: unknown): value is string {
  if (typeof value !== "string" || value.length !== 32) {
    return false;
  }
  for (let i = 0; i < value.length; i += 1) {
    const c = value.charCodeAt(i);
    const isDigit = c >= 0x30 && c <= 0x39;
    const isLowerHex = c >= 0x61 && c <= 0x66;
    if (!isDigit && !isLowerHex) {
      return false;
    }
  }
  return true;
}

interface CachedJudgeDoc {
  readonly exists: boolean;
  readonly disabled: boolean;
  readonly exp: number;
  readonly uids: readonly string[];
  readonly fetchedAt: number;
}

/**
 * 60 s in-memory revocation & expiry validator for judge claims (`05` §3.3.3, AC-SEC-16).
 * Compares custom claim `codeId` (32-hex prefix) against `/judgeCodes` document IDs; requires zero pepper.
 */
export class JudgeValidityCache implements JudgeLaneValidator {
  private readonly db: FirestoreLike;
  private readonly now: () => number;
  private readonly ttlMs: number;
  private readonly cache = new Map<string, CachedJudgeDoc>();

  constructor(
    db: FirestoreLike,
    options?: { readonly now?: () => number; readonly ttlMs?: number }
  ) {
    this.db = db;
    this.now = options?.now ?? (() => Date.now());
    this.ttlMs = options?.ttlMs ?? 60_000;
  }

  invalidate(codeId?: string): void {
    if (codeId !== undefined) {
      this.cache.delete(codeId);
    } else {
      this.cache.clear();
    }
  }

  private async loadByCodeIdPrefix(codeId: string): Promise<CachedJudgeDoc> {
    const currentNow = this.now();
    const cached = this.cache.get(codeId);
    if (cached && currentNow - cached.fetchedAt < this.ttlMs) {
      return cached;
    }

    const snap = await this.db
      .collection("judgeCodes")
      .where(documentIdField(), ">=", codeId)
      .where(documentIdField(), "<", prefixRangeUpperBound(codeId))
      .limit(2)
      .get();

    let entry: CachedJudgeDoc;
    const doc = snap.docs[0];
    if (snap.empty || !doc || snap.docs.length !== 1) {
      entry = {
        exists: false,
        disabled: true,
        exp: 0,
        uids: [],
        fetchedAt: currentNow,
      };
    } else {
      const data = doc.data() ?? {};
      const disabled = data["disabled"] === true;
      const exp = typeof data["exp"] === "number" ? data["exp"] : 0;
      const rawUids = data["uids"];
      const uids = Array.isArray(rawUids)
        ? rawUids.filter((u): u is string => typeof u === "string")
        : [];
      entry = {
        exists: true,
        disabled,
        exp,
        uids,
        fetchedAt: currentNow,
      };
    }

    this.cache.set(codeId, entry);
    return entry;
  }

  async isActiveJudge(auth: CallerAuthContext | undefined): Promise<boolean> {
    if (!auth || !auth.uid) return false;
    const token = auth.token;
    if (token["tier"] !== "judge") return false;

    const nowSec = Math.floor(this.now() / 1000);
    const tierExp = token["tierExp"];
    if (typeof tierExp !== "number" || !Number.isFinite(tierExp) || nowSec >= tierExp) {
      return false;
    }

    const codeId = token["codeId"];
    if (!isValidCodeIdPrefix(codeId)) {
      return false;
    }

    const record = await this.loadByCodeIdPrefix(codeId);
    if (!record.exists || record.disabled || nowSec > record.exp) {
      return false;
    }
    return record.uids.includes(auth.uid);
  }
}
