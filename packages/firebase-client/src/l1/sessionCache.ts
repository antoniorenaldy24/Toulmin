/**
 * In-memory-only session cache for transient L1 outcomes & late results (`01` §3.5, `04` §1.3).
 *
 * Never persisted to IndexedDB/Dexie/Remote Config, never satisfies deduplication,
 * enforces at most 2 retries (3 attempts total) per pair per session, and supports
 * `putLate` by `resultKey`.
 */

import type { InferenceSourceTag, SessionFacts, TransientReason } from "@toulmin/schemas";

export const MAX_TRANSIENT_ATTEMPTS = 3;

export interface TransientEntry {
  readonly reason: TransientReason;
  readonly attempts: number;
}

export interface LateResultEntry<T = unknown> {
  readonly resultKey: string;
  readonly data: T;
  readonly inferenceSource: InferenceSourceTag;
  readonly ms: number;
}

export type LateResultListener = (entry: LateResultEntry) => void;

export interface SessionCache {
  localUnavailable: boolean;
  registerInFlightKey(resultKey: string, pairKey: string): void;
  recordTransient(pairKey: string, reason: TransientReason): TransientEntry;
  getTransient(pairKey: string): TransientEntry | undefined;
  clearTransient(pairKey: string): void;
  canRetry(pairKey: string): boolean;
  isExhausted(pairKey: string): boolean;
  isDeduplicated(resultKey: string, persistedResultKeys: ReadonlySet<string>): boolean;
  putLate<T>(resultKey: string, late: Omit<LateResultEntry<T>, "resultKey">, pairKey?: string): void;
  getLate<T = unknown>(resultKey: string): LateResultEntry<T> | undefined;
  onLateResult(listener: LateResultListener): () => void;
  markSlotLost(pairKey?: string): void;
  toSessionFacts(): SessionFacts;
  clear(): void;
}

export function createSessionCache(): SessionCache {
  let localUnavailable = false;
  const transient = new Map<string, TransientEntry>();
  const lateByKey = new Map<string, LateResultEntry>();
  const resultKeyToPairKey = new Map<string, string>();
  const listeners = new Set<LateResultListener>();

  return {
    get localUnavailable(): boolean {
      return localUnavailable;
    },
    set localUnavailable(value: boolean) {
      localUnavailable = value;
    },
    registerInFlightKey(resultKey: string, pairKey: string): void {
      resultKeyToPairKey.set(resultKey, pairKey);
    },
    recordTransient(pairKey: string, reason: TransientReason): TransientEntry {
      const prev = transient.get(pairKey);
      const next: TransientEntry = {
        reason,
        attempts: (prev?.attempts ?? 0) + 1,
      };
      transient.set(pairKey, next);
      return next;
    },
    getTransient(pairKey: string): TransientEntry | undefined {
      return transient.get(pairKey);
    },
    clearTransient(pairKey: string): void {
      transient.delete(pairKey);
    },
    canRetry(pairKey: string): boolean {
      const entry = transient.get(pairKey);
      return entry === undefined || entry.attempts < MAX_TRANSIENT_ATTEMPTS;
    },
    isExhausted(pairKey: string): boolean {
      const entry = transient.get(pairKey);
      return entry !== undefined && entry.attempts >= MAX_TRANSIENT_ATTEMPTS;
    },
    isDeduplicated(resultKey: string, persistedResultKeys: ReadonlySet<string>): boolean {
      // Transient outcomes never satisfy deduplication (`01` §3.5, `04` §1.3).
      return persistedResultKeys.has(resultKey);
    },
    putLate<T>(
      resultKey: string,
      late: Omit<LateResultEntry<T>, "resultKey">,
      pairKey?: string
    ): void {
      const fullEntry: LateResultEntry<T> = {
        resultKey,
        data: late.data,
        inferenceSource: late.inferenceSource,
        ms: late.ms,
      };
      lateByKey.set(resultKey, fullEntry);
      const mappedPairKey = pairKey ?? resultKeyToPairKey.get(resultKey);
      if (mappedPairKey !== undefined) {
        transient.delete(mappedPairKey);
        resultKeyToPairKey.delete(resultKey);
      }
      for (const listener of listeners) {
        listener(fullEntry);
      }
    },
    getLate<T = unknown>(resultKey: string): LateResultEntry<T> | undefined {
      return lateByKey.get(resultKey) as LateResultEntry<T> | undefined;
    },
    onLateResult(listener: LateResultListener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    markSlotLost(pairKey?: string): void {
      localUnavailable = true;
      if (pairKey !== undefined) {
        const prev = transient.get(pairKey);
        transient.set(pairKey, {
          reason: "SLOT_LOST",
          attempts: (prev?.attempts ?? 0) + 1,
        });
      }
    },
    toSessionFacts(): SessionFacts {
      return {
        localUnavailable,
        transient: new Map(transient),
      };
    },
    clear(): void {
      localUnavailable = false;
      transient.clear();
      lateByKey.clear();
      resultKeyToPairKey.clear();
    },
  };
}

export const sessionCache: SessionCache = createSessionCache();
