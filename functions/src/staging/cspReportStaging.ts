import { getApp, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { onRequest } from "firebase-functions/v2/https";
import { REGION, yyyymmdd } from "../common/config.js";
import { wrapAdminFirestore, type FirestoreLike } from "../common/counters.js";

export interface SanitizedCspReport {
  readonly effectiveDirective: string;
  readonly blockedOriginAndPath: string;
  readonly documentPath: string;
  readonly day: string;
}

function stripOriginAndPath(rawUrl: unknown): string {
  if (typeof rawUrl !== "string" || !rawUrl.trim()) return "";
  const s = rawUrl.trim();
  if (s === "inline" || s === "eval" || s === "self" || s === "data" || s === "blob") {
    return s;
  }
  try {
    const u = new URL(s);
    if (u.protocol === "http:" || u.protocol === "https:") {
      return `${u.origin}${u.pathname}`;
    }
    return `${u.protocol}//${u.pathname}`;
  } catch {
    const qIdx = s.indexOf("?");
    const hIdx = s.indexOf("#");
    const cut = qIdx === -1 ? hIdx : hIdx === -1 ? qIdx : Math.min(qIdx, hIdx);
    return cut === -1 ? s : s.slice(0, cut);
  }
}

function stripPathOnly(rawUrl: unknown): string {
  if (typeof rawUrl !== "string" || !rawUrl.trim()) return "";
  try {
    const u = new URL(rawUrl.trim());
    return u.pathname;
  } catch {
    const s = rawUrl.trim();
    const qIdx = s.indexOf("?");
    const hIdx = s.indexOf("#");
    const cut = qIdx === -1 ? hIdx : hIdx === -1 ? qIdx : Math.min(qIdx, hIdx);
    return cut === -1 ? s : s.slice(0, cut);
  }
}

/**
 * Extracts ONLY `effectiveDirective`, `blockedURL` origin+path (no query string),
 * and `documentURL` path (`05` §2.4). Never records user data, IP, or query strings.
 */
export function sanitizeCspReportPayload(
  rawBody: unknown,
  nowMs: number = Date.now()
): SanitizedCspReport | null {
  const record = Array.isArray(rawBody) ? rawBody[0] : rawBody;
  if (typeof record !== "object" || record === null) return null;
  const obj = record as Record<string, unknown>;

  const report =
    typeof obj["csp-report"] === "object" && obj["csp-report"] !== null
      ? (obj["csp-report"] as Record<string, unknown>)
      : typeof obj["body"] === "object" && obj["body"] !== null
        ? (obj["body"] as Record<string, unknown>)
        : obj;

  const effectiveDirectiveRaw =
    report["effective-directive"] ?? report["effectiveDirective"] ?? report["violated-directive"];
  const effectiveDirective =
    typeof effectiveDirectiveRaw === "string" ? effectiveDirectiveRaw.trim().slice(0, 64) : "";
  if (!effectiveDirective) return null;

  const blockedUrlRaw = report["blocked-uri"] ?? report["blockedURL"];
  const documentUrlRaw = report["document-uri"] ?? report["documentURL"];

  return {
    effectiveDirective,
    blockedOriginAndPath: stripOriginAndPath(blockedUrlRaw),
    documentPath: stripPathOnly(documentUrlRaw),
    day: yyyymmdd(nowMs),
  };
}

export function createCspReportStagingHandler(deps: {
  readonly db: FirestoreLike;
  readonly now?: () => number;
}): (req: { method?: string; body?: unknown }) => Promise<{ status: number; recorded: boolean }> {
  const now = deps.now ?? (() => Date.now());
  return async (req) => {
    if (req.method !== "POST") {
      return { status: 405, recorded: false };
    }
    const sanitized = sanitizeCspReportPayload(req.body, now());
    if (!sanitized) {
      return { status: 400, recorded: false };
    }
    const key = Buffer.from(
      `${sanitized.day}|${sanitized.effectiveDirective}|${sanitized.blockedOriginAndPath}|${sanitized.documentPath}`,
      "utf8"
    )
      .toString("base64url")
      .slice(0, 120);

    await deps.db.runTransaction(async (tx) => {
      tx.set(
        deps.db.doc(`stagingCspReports/${key}`),
        {
          day: sanitized.day,
          effectiveDirective: sanitized.effectiveDirective,
          blockedOriginAndPath: sanitized.blockedOriginAndPath,
          documentPath: sanitized.documentPath,
          count: deps.db.increment(1),
        },
        { merge: true }
      );
    });
    return { status: 204, recorded: true };
  };
}

let cachedDefaultHandler:
  | ((req: { method?: string; body?: unknown }) => Promise<{ status: number; recorded: boolean }>)
  | null = null;

function getDefaultHandler() {
  if (cachedDefaultHandler) return cachedDefaultHandler;
  const app = getApps().length > 0 ? getApp() : initializeApp();
  const db = wrapAdminFirestore(getFirestore(app));
  cachedDefaultHandler = createCspReportStagingHandler({ db });
  return cachedDefaultHandler;
}

/**
 * Deployed ONLY in `toulmin-staging` via codebase configuration (`05` §2.4, AC-SEC-13).
 * NEVER imported or exported by `functions/src/index.ts`.
 */
export const cspReportStaging = onRequest(
  {
    region: REGION,
    maxInstances: 1,
    concurrency: 10,
    memory: "256MiB",
    cpu: 1,
    timeoutSeconds: 30,
  },
  async (request, response) => {
    const out = await getDefaultHandler()({
      method: request.method,
      body: request.body,
    });
    response.status(out.status).end();
  }
);
