/**
 * Browser host abstraction and graceful capability detection (`07` §1.1–§1.5).
 *
 * Isolates all DOM/browser globals behind `BrowserHostAdapters` so spike orchestration
 * runs identically in live Chrome and in Node Vitest contract tests, and degrades cleanly
 * with `status: "UNAVAILABLE"` when browser APIs or Firebase runtime configuration are missing.
 */

import DOMPurify from "dompurify";
import { version as PDFJS_VERSION } from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  checkEnvironment,
  createFirebaseRuntime,
  resolveRuntimeConfig,
  type CreateFirebaseRuntimeOptions,
  type EnvReport,
  type FirebaseRuntime,
  type FirebaseRuntimeConfig,
} from "@toulmin/firebase-client";
import type {
  BrowserEnvironmentMetadata,
  BrowserHostAdapters,
  ExecutionMode,
  PromptSessionLike,
  RuntimeCapabilityReport,
  SpikeDefinition,
  SpikeRunRecord,
  SpikeRuntimeContext,
  SpikeStatus,
} from "./types.js";

const PINNED_FIREBASE_SDK_MIN = ">=12.14.0 (firebase/package.json ^12.14.0)";

export function createDefaultBrowserHost(): BrowserHostAdapters {
  const nav =
    typeof globalThis.navigator !== "undefined"
      ? (globalThis.navigator as unknown as BrowserHostAdapters["navigatorLike"])
      : { platform: "node", userAgent: "node", onLine: false };

  const g = globalThis as unknown as {
    LanguageModel?: {
      availability(opts: object): Promise<string>;
      create?(opts?: object): Promise<PromptSessionLike>;
    };
    trustedTypes?: BrowserHostAdapters["trustedTypes"];
    Worker?: BrowserHostAdapters["workerCtor"];
    document?: BrowserHostAdapters["documentLike"];
    location?: { origin?: string };
    MutationObserver?: new (
      cb: (mutations: ReadonlyArray<{ attributeName?: string | null }>) => void
    ) => { observe(target: unknown, opts: object): void; disconnect(): void };
    URL?: {
      createObjectURL?(blob: Blob): string;
      revokeObjectURL?(url: string): void;
    };
    performance?: { now(): number };
  };

  return {
    navigatorLike: nav,
    locationOrigin: g.location?.origin ?? "https://localhost",
    ...(g.LanguageModel ? { languageModel: g.LanguageModel } : {}),
    ...(g.trustedTypes ? { trustedTypes: g.trustedTypes } : {}),
    ...(g.Worker ? { workerCtor: g.Worker } : {}),
    ...(g.document ? { documentLike: g.document } : {}),
    ...(g.MutationObserver
      ? { createMutationObserver: (cb) => new g.MutationObserver!(cb) }
      : {}),
    ...(g.URL?.createObjectURL
      ? { createObjectURL: (blob: Blob) => g.URL!.createObjectURL!(blob) }
      : {}),
    ...(g.URL?.revokeObjectURL
      ? { revokeObjectURL: (url: string) => g.URL!.revokeObjectURL!(url) }
      : {}),
    nowMs: () => Date.now(),
    nowPerfMs: () => (g.performance ? g.performance.now() : Date.now()),
  };
}

export function detectRuntimeCapabilities(
  host: BrowserHostAdapters,
  runtimeConfig: FirebaseRuntimeConfig
): RuntimeCapabilityReport {
  const missingCloudFields: string[] = [];
  if (!runtimeConfig.firebaseConfig.apiKey) missingCloudFields.push("VITE_FIREBASE_API_KEY");
  if (!runtimeConfig.firebaseConfig.appId) missingCloudFields.push("VITE_FIREBASE_APP_ID");
  if (!runtimeConfig.firebaseConfig.messagingSenderId) {
    missingCloudFields.push("VITE_FIREBASE_MESSAGING_SENDER_ID");
  }
  if (!runtimeConfig.recaptchaEnterpriseSiteKey) {
    missingCloudFields.push("VITE_RECAPTCHA_ENTERPRISE_SITE_KEY");
  }

  return {
    promptApiAvailable: typeof host.languageModel?.availability === "function",
    promptApiMeasureInputUsage: typeof host.languageModel?.create === "function",
    trustedTypesAvailable: typeof host.trustedTypes?.createPolicy === "function",
    workerAvailable: typeof host.workerCtor === "function",
    firebaseConfigPresent:
      Boolean(runtimeConfig.firebaseConfig.apiKey) && Boolean(runtimeConfig.firebaseConfig.appId),
    recaptchaSiteKeyPresent: Boolean(runtimeConfig.recaptchaEnterpriseSiteKey),
    missingCloudFields,
  };
}

export function createSpikeRuntimeContext(options?: {
  readonly executionMode?: ExecutionMode;
  readonly host?: Partial<BrowserHostAdapters>;
  readonly runtimeOptions?: CreateFirebaseRuntimeOptions;
  readonly injectedFirebaseRuntime?: FirebaseRuntime | null;
  readonly envReportOverride?: () => Promise<EnvReport>;
}): SpikeRuntimeContext {
  const baseHost = createDefaultBrowserHost();
  const host: BrowserHostAdapters = {
    ...baseHost,
    ...(options?.host ?? {}),
  };
  const runtimeConfig = resolveRuntimeConfig(options?.runtimeOptions?.config);
  const capabilities = detectRuntimeCapabilities(host, runtimeConfig);
  const executionMode: ExecutionMode =
    options?.executionMode ??
    (typeof globalThis.window !== "undefined" ? "LIVE_BROWSER" : "MOCKED_CONTRACT_TEST");

  let lazyFirebaseRuntime: FirebaseRuntime | null | undefined = options?.injectedFirebaseRuntime;
  const getFirebaseRuntime = (): FirebaseRuntime | null => {
    if (lazyFirebaseRuntime !== undefined) {
      return lazyFirebaseRuntime;
    }
    if (!capabilities.firebaseConfigPresent) {
      lazyFirebaseRuntime = null;
      return null;
    }
    try {
      lazyFirebaseRuntime = createFirebaseRuntime(options?.runtimeOptions);
      return lazyFirebaseRuntime;
    } catch {
      lazyFirebaseRuntime = null;
      return null;
    }
  };

  const getEnvironmentReport = async (): Promise<EnvReport> => {
    if (options?.envReportOverride) {
      return options.envReportOverride();
    }
    return checkEnvironment({
      navigator: host.navigatorLike,
      ...(host.languageModel ? { languageModel: host.languageModel } : {}),
    });
  };

  const inspectEnvironment = async (): Promise<BrowserEnvironmentMetadata> => {
    const env = await getEnvironmentReport().catch(
      (): EnvReport => ({ readiness: "unsupported", chromeMajor: null, reasons: ["API_MISSING"] })
    );
    return {
      executionMode,
      platform: host.navigatorLike.platform ?? "unknown",
      userAgent: host.navigatorLike.userAgent ?? "unknown",
      chromeMajor: env.chromeMajor,
      readiness: env.readiness,
      envReasons: env.reasons,
      capabilities: detectRuntimeCapabilities(host, runtimeConfig),
      firebaseSdkVersion: PINNED_FIREBASE_SDK_MIN,
      pdfJsVersion: PDFJS_VERSION,
      domPurifyVersion: DOMPurify.version ?? "unknown",
      collectedAtIso: new Date(host.nowMs()).toISOString(),
    };
  };

  return {
    executionMode,
    host,
    runtimeConfig,
    getFirebaseRuntime,
    getEnvironmentReport,
    inspectEnvironment,
  };
}

export function buildSpikeResultRecord(params: {
  readonly def: Pick<
    SpikeDefinition,
    "spikeId" | "title" | "category" | "targetDoc" | "flagName" | "passCriterion" | "fallbackAction" | "markerLocations"
  >;
  readonly executionMode: ExecutionMode;
  readonly environment: BrowserEnvironmentMetadata;
  readonly status: SpikeStatus;
  readonly primaryRecommended: boolean;
  readonly summary: string;
  readonly missingPrerequisites?: readonly string[];
  readonly metrics?: Readonly<Record<string, number | string | boolean | null>>;
  readonly rawSamples?: readonly Readonly<Record<string, unknown>>[];
  readonly manualChecklist?: SpikeRunRecord["manualChecklist"];
  readonly telemetrySnapshot?: SpikeRunRecord["telemetrySnapshot"];
  readonly startedAtMs: number;
  readonly finishedAtMs: number;
}): SpikeRunRecord {
  return {
    spikeId: params.def.spikeId,
    title: params.def.title,
    category: params.def.category,
    targetDoc: params.def.targetDoc,
    flagName: params.def.flagName,
    primaryRecommended: params.primaryRecommended,
    executionMode: params.executionMode,
    status: params.status,
    summary: params.summary,
    passCriterion: params.def.passCriterion,
    fallbackAction: params.def.fallbackAction,
    markerLocations: params.def.markerLocations,
    missingPrerequisites: params.missingPrerequisites ?? [],
    environment: params.environment,
    metrics: params.metrics ?? {},
    rawSamples: params.rawSamples ?? [],
    manualChecklist: params.manualChecklist ?? [],
    telemetrySnapshot: params.telemetrySnapshot ?? null,
    startedAtMs: params.startedAtMs,
    finishedAtMs: params.finishedAtMs,
  };
}
