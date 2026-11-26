/**
 * Pure 250 ms L0 Watchdog Controller and B5 Split-in-Half Retry Orchestrator
 * (`docs/spec/00_MASTER_CONTRACT.md` D-27, §7.3; `02` §1.4; `03` §4.4; `AC-L0-27`).
 *
 * Strictly pure (`packages/core-l0/src/`): zero global timers, clocks, DOM, or I/O.
 * Hosts (`apps/web/src/workers/`, Node tests) supply a `WatchdogRuntimeAdapter`.
 */

import type { L0Error, LedgerEvent } from "@toulmin/schemas";
import { splitB5JobInHalf, type B5PairingJob } from "./b5pairing.js";

export const L0_WATCHDOG_LIMIT_MS = 250;

export interface WatchdogTimerHandle {
  cancel(): void;
}

export interface WatchdogWorkerHandle<Req, Res> {
  run(payload: Req): Promise<Res>;
  terminate(): void | Promise<void>;
}

export interface WatchdogRuntimeAdapter<Req, Res> {
  spawn(): WatchdogWorkerHandle<Req, Res>;
  scheduleTimeout(limitMs: number, onTimeout: () => void): WatchdogTimerHandle;
}

export type WatchdogJobResult<Res> =
  | { readonly ok: true; readonly timedOut: false; readonly value: Res }
  | { readonly ok: false; readonly timedOut: true; readonly error: Extract<L0Error, "PARSE_TIMEOUT"> }
  | { readonly ok: false; readonly timedOut: false; readonly errorMessage: string };

export interface WatchdogStats {
  readonly completedJobs: number;
  readonly timedOutJobs: number;
  readonly workerRestarts: number;
  readonly splitCount: number;
}

export type L0TimeoutEvent = Extract<LedgerEvent, { readonly type: "L0Timeout" }>;

export interface B5WatchdogOptions {
  readonly lookupClaimId?: (tupleId: string) => string | null;
}

export interface B5WatchdogFailedJob {
  readonly job: B5PairingJob;
  readonly errorMessage: string;
}

export interface B5WatchdogResult<Res> {
  readonly completed: ReadonlyArray<{ readonly job: B5PairingJob; readonly value: Res }>;
  readonly failedJobs: readonly B5WatchdogFailedJob[];
  readonly timedOutJobs: readonly B5PairingJob[];
  readonly timeoutEvents: readonly L0TimeoutEvent[];
  readonly stats: WatchdogStats;
}

export interface L0WatchdogController<Req, Res> {
  runJob(payload: Req): Promise<WatchdogJobResult<Res>>;
  runBatch<Item>(
    items: readonly Item[],
    toPayload: (item: Item) => Req
  ): Promise<ReadonlyArray<WatchdogJobResult<Res>>>;
  runB5Jobs(
    jobs: readonly B5PairingJob[],
    toPayload: (job: B5PairingJob) => Req,
    options?: B5WatchdogOptions
  ): Promise<B5WatchdogResult<Res>>;
  getStats(): WatchdogStats;
  dispose(): void;
}

/**
 * Creates a pure watchdog controller enforcing the hard 250 ms L0 job ceiling.
 * On timeout, terminates the worker cleanly so a fresh worker is spawned on restart,
 * marks the job `PARSE_TIMEOUT`, and continues remaining jobs.
 */
export function createL0Watchdog<Req, Res>(
  adapter: WatchdogRuntimeAdapter<Req, Res>,
  options?: { readonly limitMs?: number }
): L0WatchdogController<Req, Res> {
  const limitMs =
    options?.limitMs !== undefined && Number.isFinite(options.limitMs) && options.limitMs > 0
      ? options.limitMs
      : L0_WATCHDOG_LIMIT_MS;

  let activeWorker: WatchdogWorkerHandle<Req, Res> | null = null;
  let completedJobs = 0;
  let timedOutJobs = 0;
  let workerRestarts = 0;
  let splitCount = 0;

  function ensureWorker(): WatchdogWorkerHandle<Req, Res> {
    if (activeWorker === null) {
      activeWorker = adapter.spawn();
    }
    return activeWorker;
  }

  function terminateActiveWorker(): void {
    if (activeWorker !== null) {
      const target = activeWorker;
      activeWorker = null;
      try {
        void target.terminate();
      } catch {
        // Best-effort worker termination after timeout.
      }
    }
  }

  async function runJob(payload: Req): Promise<WatchdogJobResult<Res>> {
    const worker = ensureWorker();

    return new Promise<WatchdogJobResult<Res>>((resolve) => {
      let settled = false;

      const timer = adapter.scheduleTimeout(limitMs, () => {
        if (settled) {
          return;
        }
        settled = true;
        timedOutJobs += 1;
        workerRestarts += 1;
        terminateActiveWorker();
        resolve({
          ok: false,
          timedOut: true,
          error: "PARSE_TIMEOUT",
        });
      });

      let runPromise: Promise<Res>;
      try {
        runPromise = Promise.resolve(worker.run(payload));
      } catch (err: unknown) {
        if (!settled) {
          settled = true;
          timer.cancel();
          const msg = err instanceof Error ? err.message : String(err);
          resolve({
            ok: false,
            timedOut: false,
            errorMessage: msg,
          });
        }
        return;
      }

      runPromise.then(
        (value) => {
          if (settled) {
            return;
          }
          settled = true;
          timer.cancel();
          completedJobs += 1;
          resolve({
            ok: true,
            timedOut: false,
            value,
          });
        },
        (err: unknown) => {
          if (settled) {
            return;
          }
          settled = true;
          timer.cancel();
          const msg = err instanceof Error ? err.message : String(err);
          resolve({
            ok: false,
            timedOut: false,
            errorMessage: msg,
          });
        }
      );
    });
  }

  async function runBatch<Item>(
    items: readonly Item[],
    toPayload: (item: Item) => Req
  ): Promise<ReadonlyArray<WatchdogJobResult<Res>>> {
    const results: WatchdogJobResult<Res>[] = [];
    for (const item of items) {
      const res = await runJob(toPayload(item));
      results.push(res);
    }
    return results;
  }

  async function runB5Jobs(
    jobs: readonly B5PairingJob[],
    toPayload: (job: B5PairingJob) => Req,
    b5Options?: B5WatchdogOptions
  ): Promise<B5WatchdogResult<Res>> {
    const queue: B5PairingJob[] = [...jobs];
    const completed: Array<{ readonly job: B5PairingJob; readonly value: Res }> = [];
    const failedJobs: B5WatchdogFailedJob[] = [];
    const timedOutLeaves: B5PairingJob[] = [];
    const timeoutEvents: L0TimeoutEvent[] = [];
    const emittedClaimIds = new Set<string>();

    while (queue.length > 0) {
      const job = queue.shift()!;
      const res = await runJob(toPayload(job));
      if (res.ok) {
        completed.push({ job, value: res.value });
        continue;
      }

      if (res.timedOut) {
        const halves = splitB5JobInHalf(job);
        if (halves !== null) {
          splitCount += 1;
          // Process left half then right half cleanly before moving to later metric classes.
          queue.unshift(halves[0], halves[1]);
        } else {
          timedOutLeaves.push(job);
          if (b5Options?.lookupClaimId) {
            for (const tid of job.affectedTupleIds) {
              const cid = b5Options.lookupClaimId(tid);
              if (cid !== null && cid.length > 0 && !emittedClaimIds.has(cid)) {
                emittedClaimIds.add(cid);
                timeoutEvents.push({
                  type: "L0Timeout",
                  claimId: cid,
                });
              }
            }
          }
        }
      } else {
        failedJobs.push({ job, errorMessage: res.errorMessage });
      }
    }

    return {
      completed,
      failedJobs,
      timedOutJobs: timedOutLeaves,
      timeoutEvents,
      stats: getStats(),
    };
  }

  function getStats(): WatchdogStats {
    return {
      completedJobs,
      timedOutJobs,
      workerRestarts,
      splitCount,
    };
  }

  function dispose(): void {
    terminateActiveWorker();
  }

  return {
    runJob,
    runBatch,
    runB5Jobs,
    getStats,
    dispose,
  };
}
