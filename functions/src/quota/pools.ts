/**
 * Default quota pool limits (`05` §4.1) and dynamic override resolution from `/global/state.pools`.
 */

export type PoolName = "anon" | "sample" | "judge";
export type PoolField = "l2" | "alt" | "oaFetch" | "bibResolve" | "redeem" | "sampleRuns";

export interface PoolLimit {
  readonly perUid: number;
  readonly perNet: number | null;
  readonly global: number | null;
}

export type PoolOverrideEntry = Partial<Record<PoolField, Partial<PoolLimit>>>;
export type PoolOverrides = Partial<Record<PoolName, PoolOverrideEntry>>;

export const DEFAULT_POOL_LIMITS: Record<PoolName, Partial<Record<PoolField, PoolLimit>>> = {
  anon: {
    l2: { perUid: 10, perNet: 20, global: 40 },
    alt: { perUid: 3, perNet: 6, global: 20 },
    oaFetch: { perUid: 30, perNet: 100, global: 200 },
    bibResolve: { perUid: 300, perNet: 1000, global: 20_000 },
    redeem: { perUid: 10, perNet: 30, global: null },
  },
  sample: {
    sampleRuns: { perUid: 1, perNet: 2, global: 20 },
  },
  judge: {
    l2: { perUid: 200, perNet: null, global: 600 },
    alt: { perUid: 20, perNet: null, global: 100 },
    oaFetch: { perUid: 200, perNet: null, global: 2_000 },
    bibResolve: { perUid: 2_000, perNet: null, global: 30_000 },
  },
};

function sanitizeNonNegInt(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }
  return fallback;
}

function sanitizeNullableNonNegInt(value: unknown, fallback: number | null): number | null {
  if (value === null) return null;
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }
  return fallback;
}

export function resolvePoolLimits(
  pool: PoolName,
  field: PoolField,
  overrides?: PoolOverrides
): PoolLimit {
  const base = DEFAULT_POOL_LIMITS[pool][field];
  if (!base) {
    throw new Error(`Unsupported quota pool/field combination: ${pool}.${field}`);
  }
  const override = overrides?.[pool]?.[field];
  if (!override) {
    return base;
  }
  return {
    perUid: sanitizeNonNegInt(override.perUid, base.perUid),
    perNet: base.perNet === null ? null : sanitizeNullableNonNegInt(override.perNet, base.perNet),
    global: base.global === null ? null : sanitizeNullableNonNegInt(override.global, base.global),
  };
}
