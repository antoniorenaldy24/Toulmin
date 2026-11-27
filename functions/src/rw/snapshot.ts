import { gzipSync } from "node:zlib";
import { getApp, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { normalizeDoi } from "../bib/mismatch.js";
import { REGION, SERVICE_ACCOUNTS, yyyymmdd } from "../common/config.js";
import { wrapAdminFirestore, type FirestoreLike } from "../common/counters.js";
import { defaultLogger, type SafeLogger } from "../common/log.js";

export interface RwSnapshotEntry {
  readonly nature: string;
  readonly date: string;
  readonly noticeDoi?: string;
}

export type RwSnapshotMap = Record<string, RwSnapshotEntry>;

export interface RwRawRecord {
  readonly doi: string;
  readonly nature: string;
  readonly date: string;
  readonly noticeDoi?: string;
}

export interface RwStorageWriter {
  writeGzippedSnapshot(objectPath: string, gzipped: Uint8Array): Promise<void>;
}

export interface RwSnapshotDeps {
  readonly db: FirestoreLike;
  readonly storage: RwStorageWriter;
  readonly fetchRetractionWatchRecords: () => Promise<readonly RwRawRecord[]>;
  /** `VERIFY-AT-SPIKE BE-2`: primary dataset fetch (`true`) vs empty-dataset fallback (`false`, default). */
  readonly spike_be_2_primary?: boolean;
  readonly now?: () => number;
  readonly logger?: SafeLogger;
}

/**
 * Builds the canonical `{ "<doi lowercase>": { nature, date, noticeDoi? } }` map (`05` §3.6).
 */
export function buildRetractionMap(records: readonly RwRawRecord[]): RwSnapshotMap {
  const map: RwSnapshotMap = {};
  for (const rec of records) {
    const doi = normalizeDoi(rec.doi);
    if (!doi) continue;
    const noticeDoi = rec.noticeDoi ? normalizeDoi(rec.noticeDoi) : undefined;
    map[doi] = {
      nature: rec.nature.trim(),
      date: rec.date.trim(),
      ...(noticeDoi ? { noticeDoi } : {}),
    };
  }
  return map;
}

function createDefaultStorageWriter(): RwStorageWriter {
  const bucket = getStorage().bucket();
  return {
    async writeGzippedSnapshot(objectPath, gzipped) {
      await bucket.file(objectPath).save(Buffer.from(gzipped), {
        contentType: "application/json",
        metadata: {
          contentEncoding: "gzip",
        },
        resumable: false,
      });
    },
  };
}

export function createRwSnapshotHandler(
  deps: RwSnapshotDeps
): () => Promise<{ readonly objectPath: string; readonly count: number }> {
  const now = deps.now ?? (() => Date.now());
  const logger = deps.logger ?? defaultLogger;

  return async () => {
    const startMs = now();
    const utcDay = yyyymmdd(startMs, "Etc/UTC");
    const objectPath = `rw/snapshot-${utcDay}.json.gz`;

    const records = await deps.fetchRetractionWatchRecords();
    const map = buildRetractionMap(records);
    const jsonBytes = Buffer.from(JSON.stringify(map), "utf8");
    const gzipped = gzipSync(jsonBytes);

    await deps.storage.writeGzippedSnapshot(objectPath, gzipped);

    await deps.db.runTransaction(async (tx) => {
      tx.set(
        deps.db.doc("global/state"),
        { rwLatest: objectPath },
        { merge: true }
      );
    });

    const count = Object.keys(map).length;
    logger.info("rwSnapshot.completed", {
      objectPath,
      count,
      gzippedBytes: gzipped.byteLength,
      latencyMs: Math.max(0, now() - startMs),
    });

    return { objectPath, count };
  };
}

let cachedDefaultHandler:
  | (() => Promise<{ readonly objectPath: string; readonly count: number }>)
  | null = null;

function getDefaultHandler(): () => Promise<{ readonly objectPath: string; readonly count: number }> {
  if (cachedDefaultHandler) return cachedDefaultHandler;
  const app = getApps().length > 0 ? getApp() : initializeApp();
  const db = wrapAdminFirestore(getFirestore(app));
  const usePrimary = process.env["SPIKE_BE_2_PRIMARY"] === "true";
  const datasetUrl = process.env["RW_SNAPSHOT_SOURCE_URL"]?.trim() ?? "";

  cachedDefaultHandler = createRwSnapshotHandler({
    db,
    storage: createDefaultStorageWriter(),
    spike_be_2_primary: usePrimary,
    // VERIFY-AT-SPIKE BE-2: primary dataset URL/format behind SPIKE_BE_2_PRIMARY; defaults to empty dataset fallback.
    fetchRetractionWatchRecords: async () => {
      if (!usePrimary || !datasetUrl.startsWith("https://")) {
        return [];
      }
      const res = await fetch(datasetUrl, { method: "GET" });
      if (!res.ok) {
        throw new Error(`Retraction Watch fetch failed with HTTP ${res.status}`);
      }
      const rawJson = (await res.json()) as unknown;
      if (!Array.isArray(rawJson)) {
        return [];
      }
      const out: RwRawRecord[] = [];
      for (const row of rawJson) {
        if (typeof row !== "object" || row === null) continue;
        const rec = row as Record<string, unknown>;
        if (typeof rec["doi"] !== "string" || typeof rec["nature"] !== "string" || typeof rec["date"] !== "string") {
          continue;
        }
        out.push({
          doi: rec["doi"],
          nature: rec["nature"],
          date: rec["date"],
          ...(typeof rec["noticeDoi"] === "string" ? { noticeDoi: rec["noticeDoi"] } : {}),
        });
      }
      return out;
    },
  });
  return cachedDefaultHandler;
}

export const rwSnapshot = onSchedule(
  {
    schedule: "every day 03:00",
    timeZone: "Etc/UTC",
    region: REGION,
    maxInstances: 1,
    concurrency: 1,
    memory: "512MiB",
    cpu: 1,
    timeoutSeconds: 300,
    serviceAccount: SERVICE_ACCOUNTS.ops,
  },
  async () => {
    await getDefaultHandler()();
  }
);
