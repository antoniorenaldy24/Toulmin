import { describe, expect, it } from "vitest";
import type { B5PairingJob } from "../src/b5pairing.js";
import {
  L0_WATCHDOG_LIMIT_MS,
  createL0Watchdog,
  type WatchdogRuntimeAdapter,
  type WatchdogTimerHandle,
  type WatchdogWorkerHandle,
} from "../src/watchdog.js";

describe("packages/core-l0/src/watchdog.ts (D-27, AC-L0-27)", () => {
  it("completes fast jobs without restarting workers or leaving active timeouts", async () => {
    let spawnCount = 0;
    let terminateCount = 0;
    let activeTimers = 0;

    const adapter: WatchdogRuntimeAdapter<{ id: string }, string> = {
      spawn(): WatchdogWorkerHandle<{ id: string }, string> {
        spawnCount += 1;
        return {
          run: async (req) => `ok:${req.id}`,
          terminate: () => {
            terminateCount += 1;
          },
        };
      },
      scheduleTimeout(): WatchdogTimerHandle {
        activeTimers += 1;
        return {
          cancel: () => {
            activeTimers -= 1;
          },
        };
      },
    };

    const watchdog = createL0Watchdog(adapter);
    expect(L0_WATCHDOG_LIMIT_MS).toBe(250);

    const results = await watchdog.runBatch(["a", "b", "c"], (id) => ({ id }));
    expect(results).toEqual([
      { ok: true, timedOut: false, value: "ok:a" },
      { ok: true, timedOut: false, value: "ok:b" },
      { ok: true, timedOut: false, value: "ok:c" },
    ]);
    expect(spawnCount).toBe(1);
    expect(terminateCount).toBe(0);
    expect(activeTimers).toBe(0);
    expect(watchdog.getStats()).toEqual({
      completedJobs: 3,
      timedOutJobs: 0,
      workerRestarts: 0,
      splitCount: 0,
    });
    watchdog.dispose();
    expect(terminateCount).toBe(1);
  });

  it("terminates and restarts worker on >250 ms timeout (PARSE_TIMEOUT) and continues remaining jobs", async () => {
    let spawnCount = 0;
    let terminateCount = 0;
    const timeoutLimits: number[] = [];
    const activeTimeouts = new Set<() => void>();

    const adapter: WatchdogRuntimeAdapter<{ id: string; hang?: boolean }, string> = {
      spawn(): WatchdogWorkerHandle<{ id: string; hang?: boolean }, string> {
        const workerId = ++spawnCount;
        return {
          run: (req) => {
            if (req.hang) {
              void Promise.resolve().then(() => {
                for (const cb of activeTimeouts) {
                  cb();
                }
              });
              return new Promise<string>(() => {});
            }
            return Promise.resolve(`w${workerId}:${req.id}`);
          },
          terminate: () => {
            terminateCount += 1;
          },
        };
      },
      scheduleTimeout(limitMs: number, onTimeout: () => void): WatchdogTimerHandle {
        timeoutLimits.push(limitMs);
        activeTimeouts.add(onTimeout);
        return {
          cancel: () => {
            activeTimeouts.delete(onTimeout);
          },
        };
      },
    };

    const watchdog = createL0Watchdog(adapter);
    const out = await watchdog.runBatch(
      [
        { id: "fast-1" },
        { id: "pathological-file", hang: true },
        { id: "fast-2" },
      ],
      (item) => item
    );

    expect(out[0]).toEqual({ ok: true, timedOut: false, value: "w1:fast-1" });
    expect(out[1]).toEqual({ ok: false, timedOut: true, error: "PARSE_TIMEOUT" });
    expect(out[2]).toEqual({ ok: true, timedOut: false, value: "w2:fast-2" });
    expect(timeoutLimits).toEqual([250, 250, 250]);
    expect(spawnCount).toBe(2);
    expect(terminateCount).toBe(1);
    expect(watchdog.getStats()).toEqual({
      completedJobs: 2,
      timedOutJobs: 1,
      workerRestarts: 1,
      splitCount: 0,
    });
  });

  it("splits timed-out multi-tuple B5 jobs in half and emits E14 L0Timeout for pathological single-tuple jobs", async () => {
    let terminateCount = 0;
    const activeTimeouts = new Set<() => void>();

    const adapter: WatchdogRuntimeAdapter<B5PairingJob, string[]> = {
      spawn(): WatchdogWorkerHandle<B5PairingJob, string[]> {
        return {
          run: (job) => {
            // Multi-tuple sample_size jobs or the pathological tuple t-bad exceed 250 ms; clean singletons complete.
            if (job.affectedTupleIds.length > 1 || job.affectedTupleIds[0] === "t-bad") {
              void Promise.resolve().then(() => {
                for (const cb of activeTimeouts) {
                  cb();
                }
              });
              return new Promise<string[]>(() => {});
            }
            return Promise.resolve([...job.affectedTupleIds]);
          },
          terminate: () => {
            terminateCount += 1;
          },
        };
      },
      scheduleTimeout(_limitMs: number, onTimeout: () => void): WatchdogTimerHandle {
        activeTimeouts.add(onTimeout);
        return {
          cancel: () => {
            activeTimeouts.delete(onTimeout);
          },
        };
      },
    };

    const claimByTuple = new Map<string, string | null>([
      ["t-good-1", "claim-1"],
      ["t-bad", "claim-bad"],
      ["t-good-2", "claim-2"],
      ["t-p1", "claim-p1"],
    ]);

    const jobs: B5PairingJob[] = [
      {
        docId: "doc-1",
        metricClass: "sample_size",
        affectedTupleIds: ["t-good-1", "t-bad", "t-good-2"],
      },
      {
        docId: "doc-1",
        metricClass: "p_value",
        affectedTupleIds: ["t-p1"],
      },
    ];

    const watchdog = createL0Watchdog(adapter);
    const res = await watchdog.runB5Jobs(jobs, (j) => j, {
      lookupClaimId: (tid) => claimByTuple.get(tid) ?? null,
    });

    expect(res.completed).toEqual([
      {
        job: { docId: "doc-1", metricClass: "sample_size", affectedTupleIds: ["t-good-1"] },
        value: ["t-good-1"],
      },
      {
        job: { docId: "doc-1", metricClass: "sample_size", affectedTupleIds: ["t-good-2"] },
        value: ["t-good-2"],
      },
      {
        job: { docId: "doc-1", metricClass: "p_value", affectedTupleIds: ["t-p1"] },
        value: ["t-p1"],
      },
    ]);
    expect(res.timedOutJobs).toEqual([
      { docId: "doc-1", metricClass: "sample_size", affectedTupleIds: ["t-bad"] },
    ]);
    expect(res.timeoutEvents).toEqual([
      { type: "L0Timeout", claimId: "claim-bad" },
    ]);
    expect(res.stats.splitCount).toBe(2);
    expect(terminateCount).toBe(3);
  });

  it("handles synchronous worker.run throws cleanly (cancels timer) and tracks non-timeout B5 failures", async () => {
    let activeTimers = 0;

    const adapter: WatchdogRuntimeAdapter<B5PairingJob, string> = {
      spawn(): WatchdogWorkerHandle<B5PairingJob, string> {
        return {
          run: (job) => {
            if (job.metricClass === "dose") {
              throw new Error("sync boom");
            }
            return Promise.resolve(`done:${job.metricClass}`);
          },
          terminate: () => {},
        };
      },
      scheduleTimeout(): WatchdogTimerHandle {
        activeTimers += 1;
        return {
          cancel: () => {
            activeTimers -= 1;
          },
        };
      },
    };

    const watchdog = createL0Watchdog(adapter);
    const single = await watchdog.runJob({
      docId: "doc-1",
      metricClass: "dose",
      affectedTupleIds: ["t1"],
    });
    expect(single).toEqual({ ok: false, timedOut: false, errorMessage: "sync boom" });
    expect(activeTimers).toBe(0);

    const batch = await watchdog.runB5Jobs(
      [
        { docId: "doc-1", metricClass: "dose", affectedTupleIds: ["t1"] },
        { docId: "doc-1", metricClass: "count", affectedTupleIds: ["t2"] },
      ],
      (j) => j
    );
    expect(batch.completed).toHaveLength(1);
    expect(batch.completed[0]?.value).toBe("done:count");
    expect(batch.failedJobs).toEqual([
      {
        job: { docId: "doc-1", metricClass: "dose", affectedTupleIds: ["t1"] },
        errorMessage: "sync boom",
      },
    ]);
    expect(activeTimers).toBe(0);
  });
});
