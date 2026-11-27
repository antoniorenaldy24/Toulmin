/**
 * Backend verification checks `BE-1`–`BE-4` (`07` §1.5), invoked through
 * `@toulmin/firebase-client` callables (`callBibResolve`, `callOaFetch`, `callQuotaGuard`, `callRedeemJudgeCode`).
 */

import { sha256hex } from "@toulmin/core-l0";
import {
  callBibResolve,
  callOaFetch,
  callQuotaGuard,
  callRedeemJudgeCode,
} from "@toulmin/firebase-client";
import { buildSpikeResultRecord } from "../runtime.js";
import type {
  SpikeDefinition,
  SpikeManualStepItem,
  SpikeRunOptions,
  SpikeRunRecord,
  SpikeRuntimeContext,
} from "../types.js";

function backendUnavailableRecord(
  def: SpikeDefinition,
  ctx: SpikeRuntimeContext,
  startedAtMs: number,
  envMeta: Awaited<ReturnType<SpikeRuntimeContext["inspectEnvironment"]>>
): SpikeRunRecord {
  return buildSpikeResultRecord({
    def,
    executionMode: ctx.executionMode,
    environment: envMeta,
    status: "UNAVAILABLE",
    primaryRecommended: false,
    summary: `${def.spikeId} cannot run against Firebase Functions without client config & anonymous Auth.`,
    missingPrerequisites:
      envMeta.capabilities.missingCloudFields.length > 0
        ? envMeta.capabilities.missingCloudFields
        : ["FirebaseRuntime"],
    startedAtMs,
    finishedAtMs: ctx.host.nowMs(),
  });
}

async function runBE1(ctx: SpikeRuntimeContext): Promise<SpikeRunRecord> {
  const startedAtMs = ctx.host.nowMs();
  const envMeta = await ctx.inspectEnvironment();
  const rt = ctx.getFirebaseRuntime();

  let callableResponded = false;
  let resultSummary = "offline";
  if (rt && (await rt.ensureAuth())) {
    try {
      const res = await callQuotaGuard(
        { claimHashes: [sha256hex("be1-ip-probe")], kind: "L2" },
        { runtime: rt }
      );
      callableResponded = true;
      resultSummary = res.ok ? `ok:${res.pool}` : `denied:${res.reason}`;
    } catch (e) {
      resultSummary = e instanceof Error ? e.message : "error";
    }
  }

  const manualChecklist: SpikeManualStepItem[] = [
    {
      id: "be1-forged-xff",
      description:
        "From two distinct networks, send 10 requests with forged X-Forwarded-For left-most entries (1, 2, 5 entries; private & public IPs) to quotaGuard on toulmin-staging and verify netHash stays constant.",
      completed: false,
    },
    {
      id: "be1-trusted-hops",
      description: "Verify Google frontend appended entry index from the right matches clientIp.ts.",
      completed: false,
    },
  ];

  return buildSpikeResultRecord({
    def: BE_1_DEF,
    executionMode: ctx.executionMode,
    environment: envMeta,
    status: rt ? "MANUAL_REQUIRED" : "UNAVAILABLE",
    primaryRecommended: false,
    missingPrerequisites: rt ? [] : envMeta.capabilities.missingCloudFields,
    summary: `BE-1 baseline callable probe=${resultSummary}; forged X-Forwarded-For header curl drill required across two networks.`,
    metrics: {
      callableResponded,
      quotaProbeResult: resultSummary,
    },
    manualChecklist,
    startedAtMs,
    finishedAtMs: ctx.host.nowMs(),
  });
}

async function runBE2(ctx: SpikeRuntimeContext): Promise<SpikeRunRecord> {
  const startedAtMs = ctx.host.nowMs();
  const envMeta = await ctx.inspectEnvironment();
  const rt = ctx.getFirebaseRuntime();
  if (!rt) {
    return backendUnavailableRecord(BE_2_DEF, ctx, startedAtMs, envMeta);
  }
  if (!(await rt.ensureAuth())) {
    return backendUnavailableRecord(BE_2_DEF, ctx, startedAtMs, envMeta);
  }

  const probeDois = [
    "10.1371/journal.pone.0200001",
    "10.1002/(sici)1097-0142(1996)77:1<10::aid-cncr3>3.0.co;2-p",
  ];
  const bibRes = await callBibResolve(
    {
      items: probeDois.map((doi, idx) => ({ key: `be2_${idx}`, doi })),
      doiOnly: true,
    },
    { runtime: rt }
  );

  const firstRefId = bibRes.results.find((r) => r.refId !== null)?.refId ?? null;
  let oaSource: string | null = null;
  let oaLicense: string | null = null;
  if (firstRefId) {
    const oaRes = await callOaFetch({ refId: firstRefId }, { runtime: rt });
    oaSource = oaRes.source;
    oaLicense = oaRes.license;
  }

  const manualChecklist: SpikeManualStepItem[] = [
    {
      id: "be2-arxiv-oai",
      description:
        "Verify arXiv OAI-PMH GetRecord metadataPrefix=arXivRaw <license> parsing across 20 arXiv IDs through /global/arxivLock.",
      completed: false,
    },
    {
      id: "be2-rw-snapshot",
      description: "Verify Crossref Retraction Watch dataset URL/format for rwSnapshot.",
      completed: false,
    },
  ];

  const resolvedCount = bibRes.results.filter((r) => r.status === "RESOLVED").length;
  const passed = resolvedCount > 0 && oaSource !== null;
  return buildSpikeResultRecord({
    def: BE_2_DEF,
    executionMode: ctx.executionMode,
    environment: envMeta,
    status: passed ? (ctx.executionMode === "LIVE_BROWSER" ? "MANUAL_REQUIRED" : "PASS") : "FAIL",
    primaryRecommended: passed,
    summary: `BE-2 resolved ${resolvedCount}/${probeDois.length} bibResolve probes and oaFetch returned source=${oaSource ?? "none"} (license=${oaLicense ?? "null"}).`,
    metrics: {
      resolvedCount,
      oaSource,
      oaLicense,
    },
    rawSamples: bibRes.results.map((r) => ({
      key: r.key,
      status: r.status,
      isRetracted: r.isRetracted,
      oaAvailable: r.oaAvailable,
    })),
    manualChecklist,
    startedAtMs,
    finishedAtMs: ctx.host.nowMs(),
  });
}

async function runBE3(ctx: SpikeRuntimeContext, options?: SpikeRunOptions): Promise<SpikeRunRecord> {
  const startedAtMs = ctx.host.nowMs();
  const envMeta = await ctx.inspectEnvironment();
  const rt = ctx.getFirebaseRuntime();
  if (!rt) {
    return backendUnavailableRecord(BE_3_DEF, ctx, startedAtMs, envMeta);
  }
  if (!(await rt.ensureAuth())) {
    return backendUnavailableRecord(BE_3_DEF, ctx, startedAtMs, envMeta);
  }

  const qRes = await callQuotaGuard(
    { claimHashes: [sha256hex(`be3-${startedAtMs}`)], kind: "L2" },
    { runtime: rt }
  );

  let redeemOutcome = "skipped_no_code";
  const code = options?.manualInputs?.judgeCode?.trim();
  if (code) {
    try {
      const r = await callRedeemJudgeCode({ code }, { runtime: rt });
      redeemOutcome = `ok:tierExp=${r.tierExp}`;
    } catch (e) {
      redeemOutcome = e instanceof Error ? e.message : "rejected";
    }
  }

  const manualChecklist: SpikeManualStepItem[] = [
    {
      id: "be3-replay-token",
      description:
        "Replay the same limited-use App Check token on quotaGuard & redeemJudgeCode; verify request.app.alreadyConsumed === true -> REPLAYED_TOKEN.",
      completed: false,
    },
    {
      id: "be3-auth-scripted",
      description: "Verify 5/5 tokenless anonymous sign-ups rejected after Firebase Auth App Check enforcement.",
      completed: false,
    },
  ];

  const primaryOk = qRes.ok || qRes.reason === "POOL_EXHAUSTED" || qRes.reason === "QUOTA_EXCEEDED";
  return buildSpikeResultRecord({
    def: BE_3_DEF,
    executionMode: ctx.executionMode,
    environment: envMeta,
    status: ctx.executionMode === "LIVE_BROWSER" ? "MANUAL_REQUIRED" : primaryOk ? "PASS" : "FAIL",
    primaryRecommended: primaryOk,
    summary: `BE-3 fresh limited-use quotaGuard=${qRes.ok ? "ok" : qRes.reason}, redeemJudgeCode=${redeemOutcome}; replay probe required via HTTP capture.`,
    metrics: {
      freshQuotaGuardOk: primaryOk,
      redeemOutcome,
    },
    manualChecklist,
    startedAtMs,
    finishedAtMs: ctx.host.nowMs(),
  });
}

async function runBE4(ctx: SpikeRuntimeContext): Promise<SpikeRunRecord> {
  const startedAtMs = ctx.host.nowMs();
  const envMeta = await ctx.inspectEnvironment();
  const rt = ctx.getFirebaseRuntime();
  if (!rt) {
    return backendUnavailableRecord(BE_4_DEF, ctx, startedAtMs, envMeta);
  }
  if (!(await rt.ensureAuth())) {
    return backendUnavailableRecord(BE_4_DEF, ctx, startedAtMs, envMeta);
  }

  const sampleNonexistentDoi = "10.5555/toulmin-sample-nonexistent-0001";
  const res = await callBibResolve(
    {
      items: [{ key: "sample_nonexistent", doi: sampleNonexistentDoi }],
      doiOnly: true,
    },
    { runtime: rt }
  );

  const nonExistentStatus = res.results[0]?.status ?? "MISSING";
  const passedHandleNonexistent = nonExistentStatus === "DOI_NOT_FOUND";

  const manualChecklist: SpikeManualStepItem[] = [
    {
      id: "be4-oaparse-403",
      description:
        "Verify unauthenticated curl, end-user Firebase ID token, and non-oafetch service account all get HTTP 403 calling oaParse / oaParseJudge.",
      completed: false,
    },
    {
      id: "be4-iam-audit",
      description: "Run tools/check-iam.ts confirming oaparse-sa has zero roles & zero secrets.",
      completed: false,
    },
  ];

  return buildSpikeResultRecord({
    def: BE_4_DEF,
    executionMode: ctx.executionMode,
    environment: envMeta,
    status: !passedHandleNonexistent
      ? "FAIL"
      : ctx.executionMode === "LIVE_BROWSER"
        ? "MANUAL_REQUIRED"
        : "PASS",
    primaryRecommended: passedHandleNonexistent,
    summary: `BE-4 nonexistent sample DOI status=${nonExistentStatus} (expected DOI_NOT_FOUND); private oaParse 403 IAM check requires curl verification.`,
    metrics: {
      sampleNonexistentDoiStatus: nonExistentStatus,
      passedHandleNonexistent,
    },
    rawSamples: res.results as unknown as Array<Record<string, unknown>>,
    manualChecklist,
    startedAtMs,
    finishedAtMs: ctx.host.nowMs(),
  });
}

export const BE_1_DEF: SpikeDefinition = {
  spikeId: "BE-1",
  title: "Client-IP Derivation & Forged X-Forwarded-For Resistance",
  category: "backend",
  targetDoc: "docs/spikes/BACKEND.md",
  flagName: "spike_be_1_primary",
  passCriterion: "10/10 forged X-Forwarded-For cases keep constant netHash from right-appended Google frontend IP",
  fallbackAction: "Disable per-network limits and lower anonymous L2 global pool to 20/day",
  markerLocations: ["05 §4.2", "07 AC-SEC-09"],
  run: runBE1,
};

export const BE_2_DEF: SpikeDefinition = {
  spikeId: "BE-2",
  title: "Bibliographic Sources, Retraction Watch & OA Licence Verification",
  category: "backend",
  targetDoc: "docs/spikes/BACKEND.md",
  flagName: "spike_be_2_primary",
  passCriterion: ">=19/20 licence fields parsed for Europe PMC/Unpaywall; 20/20 arXiv OAI-PMH arXivRaw + 3s /global/arxivLock",
  fallbackAction: "OpenAlex singleton /works/doi:{doi}; OpenAlex+Crossref retractions only; never cache arXiv server-side",
  markerLocations: ["05 §3.1 step 3,5", "05 §3.2.2", "05 §3.6"],
  run: runBE2,
};

export const BE_3_DEF: SpikeDefinition = {
  spikeId: "BE-3",
  title: "App Check Auth Enforcement (Preview) & Consumed Token Replay Rejection",
  category: "backend",
  targetDoc: "docs/spikes/BACKEND.md",
  flagName: "spike_be_3_primary",
  passCriterion: "5/5 tokenless sign-ups rejected; request.app.alreadyConsumed === true rejects replays with REPLAYED_TOKEN",
  fallbackAction: "Server-side 128-bit nonce guard at /global/nonces/{hash} (10-min TTL) + Auth sign-up throttle",
  markerLocations: ["05 §3.0 rule 3", "00 D-18"],
  run: runBE3,
};

export const BE_4_DEF: SpikeDefinition = {
  spikeId: "BE-4",
  title: "Private oaParse IAM Isolation & doi.org Handle API",
  category: "backend",
  targetDoc: "docs/spikes/BACKEND.md",
  flagName: "spike_be_4_primary",
  passCriterion: "3/3 unauthorized callers receive HTTP 403 on oaParse; handle API responseCode 1/200 -> NOT_INDEXED, 100 -> DOI_NOT_FOUND",
  fallbackAction: "HEAD https://doi.org/{doi} with redirect:'manual'; do not deploy oaParse if IAM isolation fails",
  markerLocations: ["05 §3.1 step 6", "05 §3.2.4"],
  run: runBE4,
};

export const BACKEND_SPIKES: readonly SpikeDefinition[] = [
  BE_1_DEF,
  BE_2_DEF,
  BE_3_DEF,
  BE_4_DEF,
];
