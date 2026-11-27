import { randomInt as cryptoRandomInt } from "node:crypto";
import { FieldPath, FieldValue, type Firestore } from "firebase-admin/firestore";
import { addDays, yyyymmdd, JAKARTA_TIME_ZONE } from "./config.js";
import {
  resolvePoolLimits,
  type PoolField,
  type PoolName,
  type PoolOverrides,
} from "../quota/pools.js";

export interface DocSnapshotLike {
  readonly id: string;
  readonly exists: boolean;
  data(): Record<string, unknown> | undefined;
  get(field: string): unknown;
}

export interface DocRefLike {
  readonly id: string;
  readonly path: string;
  get(): Promise<DocSnapshotLike>;
}

export interface QuerySnapshotLike {
  readonly empty: boolean;
  readonly docs: readonly DocSnapshotLike[];
}

export interface QueryLike {
  where(field: string | FieldPath, op: "==" | ">=" | "<", value: unknown): QueryLike;
  limit(n: number): QueryLike;
  get(): Promise<QuerySnapshotLike>;
}

export interface CollectionRefLike {
  doc(id: string): DocRefLike;
  where(field: string | FieldPath, op: "==" | ">=" | "<", value: unknown): QueryLike;
}

export interface TransactionLike {
  get(ref: DocRefLike): Promise<DocSnapshotLike>;
  set(ref: DocRefLike, data: Record<string, unknown>, options?: { merge?: boolean }): void;
  update(ref: DocRefLike, data: Record<string, unknown>): void;
}

export interface FirestoreLike {
  doc(path: string): DocRefLike;
  collection(path: string): CollectionRefLike;
  runTransaction<T>(fn: (tx: TransactionLike) => Promise<T>): Promise<T>;
  increment(delta: number): unknown;
}

/**
 * Wraps an `firebase-admin/firestore` `Firestore` instance into `FirestoreLike`.
 */
export function wrapAdminFirestore(db: Firestore): FirestoreLike {
  return {
    doc: (path: string) => db.doc(path) as unknown as DocRefLike,
    collection: (path: string) => db.collection(path) as unknown as CollectionRefLike,
    runTransaction: <T>(fn: (tx: TransactionLike) => Promise<T>) =>
      db.runTransaction((tx) => fn(tx as unknown as TransactionLike)),
    increment: (delta: number) => FieldValue.increment(delta),
  };
}

export function prefixRangeUpperBound(prefix: string): string {
  return `${prefix}\uf8ff`;
}

export function documentIdField(): FieldPath {
  return FieldPath.documentId();
}

export interface GlobalState {
  readonly hardStop: boolean;
  readonly killSwitch: boolean;
  readonly killSwitchAt?: number | null;
  readonly pools?: PoolOverrides;
  readonly rwLatest?: string | null;
}

const DEFAULT_GLOBAL_STATE: GlobalState = {
  hardStop: false,
  killSwitch: false,
};

function parseGlobalState(data: Record<string, unknown> | undefined): GlobalState {
  if (!data) return DEFAULT_GLOBAL_STATE;
  const hardStop = data["hardStop"] === true;
  const killSwitch = data["killSwitch"] === true;
  const killSwitchAt = typeof data["killSwitchAt"] === "number" ? data["killSwitchAt"] : null;
  const rwLatest = typeof data["rwLatest"] === "string" ? data["rwLatest"] : null;
  const rawPools = data["pools"];
  const pools =
    typeof rawPools === "object" && rawPools !== null && !Array.isArray(rawPools)
      ? (rawPools as PoolOverrides)
      : undefined;

  return {
    hardStop,
    killSwitch,
    killSwitchAt,
    rwLatest,
    ...(pools !== undefined ? { pools } : {}),
  };
}

/**
 * 60 s in-memory cache over `/global/state` (`05` §3.0 rule 5, §3.4 step 2).
 */
export class GlobalStateCache {
  private readonly db: FirestoreLike;
  private readonly now: () => number;
  private readonly ttlMs: number;
  private cached: GlobalState | null = null;
  private fetchedAt = -1;

  constructor(
    db: FirestoreLike,
    options?: { readonly now?: () => number; readonly ttlMs?: number }
  ) {
    this.db = db;
    this.now = options?.now ?? (() => Date.now());
    this.ttlMs = options?.ttlMs ?? 60_000;
  }

  async get(forceRefresh = false): Promise<GlobalState> {
    const currentNow = this.now();
    if (!forceRefresh && this.cached !== null && currentNow - this.fetchedAt < this.ttlMs) {
      return this.cached;
    }
    const snap = await this.db.doc("global/state").get();
    this.cached = parseGlobalState(snap.exists ? snap.data() : undefined);
    this.fetchedAt = currentNow;
    return this.cached;
  }

  invalidate(): void {
    this.cached = null;
    this.fetchedAt = -1;
  }
}

export type CounterDeniedReason = "POOL_EXHAUSTED" | "QUOTA_EXCEEDED" | "NET_LIMIT";

export interface ReserveRequest {
  readonly uid: string;
  readonly pool: PoolName;
  readonly field: PoolField;
  readonly n: number;
  readonly netHash: string | null;
  readonly atomic?: boolean;
}

export interface ReserveResult {
  readonly granted: number;
  readonly remainingToday: number;
  readonly day: string;
  readonly deniedReason?: CounterDeniedReason;
}

export interface RefundRequest {
  readonly uid: string;
  readonly pool: PoolName;
  readonly field: PoolField;
  readonly count: number;
  readonly netHash: string | null;
  readonly day?: string;
}

function readCounterField(snap: DocSnapshotLike, field: string): number {
  if (!snap.exists) return 0;
  const val = snap.get(field);
  return typeof val === "number" && Number.isFinite(val) ? val : 0;
}

/**
 * Reserve-then-reconcile sharded quota counter engine (`05` §4.2).
 * - Per-UID: `/users/{uid}/quota/{day}` (TTL 3 d)
 * - Per-network: 4 shards `/netCounters/{netHash}_{day}_{0..3}` (TTL 3 d)
 * - Global: 10 shards `/global/counters/shards/{pool}_{day}_{0..9}` (TTL 30 d)
 */
export class CounterEngine {
  private readonly db: FirestoreLike;
  private readonly stateCache: GlobalStateCache;
  private readonly now: () => number;
  private readonly randomInt: (max: number) => number;

  constructor(
    db: FirestoreLike,
    stateCache: GlobalStateCache,
    options?: {
      readonly now?: () => number;
      readonly randomInt?: (max: number) => number;
    }
  ) {
    this.db = db;
    this.stateCache = stateCache;
    this.now = options?.now ?? (() => Date.now());
    this.randomInt = options?.randomInt ?? ((max) => cryptoRandomInt(0, max));
  }

  async reserve(req: ReserveRequest): Promise<ReserveResult> {
    if (!Number.isInteger(req.n) || req.n <= 0) {
      throw new Error(`Counter reserve count must be a positive integer, received ${req.n}`);
    }

    const day = yyyymmdd(this.now(), JAKARTA_TIME_ZONE);
    const state = await this.stateCache.get();
    const limits = resolvePoolLimits(req.pool, req.field, state.pools);

    const uRef = this.db.doc(`users/${req.uid}/quota/${day}`);
    const nRefs =
      req.netHash !== null && limits.perNet !== null
        ? Array.from({ length: 4 }, (_, s) => this.db.doc(`netCounters/${req.netHash}_${day}_${s}`))
        : [];
    const gRefs =
      limits.global !== null
        ? Array.from({ length: 10 }, (_, s) =>
            this.db.doc(`global/counters/shards/${req.pool}_${day}_${s}`)
          )
        : [];

    const txOutcome = await this.db.runTransaction(async (tx) => {
      const reads = await Promise.all([
        tx.get(uRef),
        ...nRefs.map((r) => tx.get(r)),
        ...gRefs.map((r) => tx.get(r)),
      ]);
      const uSnap = reads[0]!;
      const nSnaps = reads.slice(1, 1 + nRefs.length);
      const gSnaps = reads.slice(1 + nRefs.length);

      const usedUid = readCounterField(uSnap, req.field);
      const usedNet = nSnaps.reduce((acc, s) => acc + readCounterField(s, req.field), 0);
      const usedGlobal = gSnaps.reduce((acc, s) => acc + readCounterField(s, req.field), 0);

      const uidRem = Math.max(0, limits.perUid - usedUid);
      const netRem = limits.perNet !== null ? Math.max(0, limits.perNet - usedNet) : req.n;
      const globalRem = limits.global !== null ? Math.max(0, limits.global - usedGlobal) : req.n;

      const available = Math.min(req.n, uidRem, netRem, globalRem);
      const granted = req.atomic ? (available === req.n ? req.n : 0) : available;

      if (granted === 0) {
        let deniedReason: CounterDeniedReason;
        if (limits.global !== null && globalRem < (req.atomic ? req.n : 1)) {
          deniedReason = "POOL_EXHAUSTED";
        } else if (uidRem < (req.atomic ? req.n : 1)) {
          deniedReason = "QUOTA_EXCEEDED";
        } else {
          deniedReason = "NET_LIMIT";
        }
        return {
          granted: 0,
          remainingToday: Math.max(0, Math.min(uidRem, limits.perNet !== null ? netRem : uidRem, limits.global !== null ? globalRem : uidRem)),
          day,
          deniedReason,
        } satisfies ReserveResult;
      }

      const expire3d = addDays(day, 3);
      tx.set(uRef, { [req.field]: usedUid + granted, expireAt: expire3d }, { merge: true });

      if (nRefs.length > 0) {
        const netShard = nRefs[this.randomInt(nRefs.length)]!;
        tx.set(
          netShard,
          { [req.field]: this.db.increment(granted), expireAt: expire3d },
          { merge: true }
        );
      }

      if (gRefs.length > 0) {
        const globalShard = gRefs[this.randomInt(gRefs.length)]!;
        tx.set(
          globalShard,
          { [req.field]: this.db.increment(granted), expireAt: addDays(day, 30) },
          { merge: true }
        );
      }

      const newUidRem = Math.max(0, uidRem - granted);
      const newNetRem = limits.perNet !== null ? Math.max(0, netRem - granted) : newUidRem;
      const newGlobalRem = limits.global !== null ? Math.max(0, globalRem - granted) : newUidRem;

      return {
        granted,
        remainingToday: Math.min(newUidRem, newNetRem, newGlobalRem),
        day,
      } satisfies ReserveResult;
    });

    return txOutcome;
  }

  async refund(req: RefundRequest): Promise<void> {
    if (!Number.isInteger(req.count) || req.count <= 0) {
      return;
    }

    const day = req.day ?? yyyymmdd(this.now(), JAKARTA_TIME_ZONE);
    const limits = resolvePoolLimits(req.pool, req.field);

    const uRef = this.db.doc(`users/${req.uid}/quota/${day}`);
    const nRefs =
      req.netHash !== null && limits.perNet !== null
        ? Array.from({ length: 4 }, (_, s) => this.db.doc(`netCounters/${req.netHash}_${day}_${s}`))
        : [];
    const gRefs =
      limits.global !== null
        ? Array.from({ length: 10 }, (_, s) =>
            this.db.doc(`global/counters/shards/${req.pool}_${day}_${s}`)
          )
        : [];

    await this.db.runTransaction(async (tx) => {
      const reads = await Promise.all([
        tx.get(uRef),
        ...nRefs.map((r) => tx.get(r)),
        ...gRefs.map((r) => tx.get(r)),
      ]);
      const uSnap = reads[0]!;
      const usedUid = readCounterField(uSnap, req.field);
      const nextUid = Math.max(0, usedUid - req.count);
      const expire3d = addDays(day, 3);
      tx.set(uRef, { [req.field]: nextUid, expireAt: expire3d }, { merge: true });

      if (nRefs.length > 0) {
        const netShard = nRefs[this.randomInt(nRefs.length)]!;
        tx.set(
          netShard,
          { [req.field]: this.db.increment(-req.count), expireAt: expire3d },
          { merge: true }
        );
      }
      if (gRefs.length > 0) {
        const globalShard = gRefs[this.randomInt(gRefs.length)]!;
        tx.set(
          globalShard,
          { [req.field]: this.db.increment(-req.count), expireAt: addDays(day, 30) },
          { merge: true }
        );
      }
    });
  }
}
