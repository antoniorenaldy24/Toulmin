/**
 * Canonical types for the Phase 0 Web & Backend compatibility spike harness (`07` §1.1–§1.7).
 */

import type {
  EnvReport,
  FirebaseRuntime,
  FirebaseRuntimeConfig,
  TelemetrySnapshot,
} from "@toulmin/firebase-client";

export type WebSpikeId =
  | "S-W1"
  | "S-W2"
  | "S-W3"
  | "S-W4"
  | "S-W5"
  | "S-W6"
  | "S-W7"
  | "S-W9"
  | "S-W10";

export type SharedOrBackendSpikeId =
  | "S-L2"
  | "S-RP"
  | "S-SC"
  | "S-N4"
  | "BE-1"
  | "BE-2"
  | "BE-3"
  | "BE-4";

export type Phase0SpikeId = WebSpikeId | SharedOrBackendSpikeId;

export type SpikeCategory = "web-l1" | "web-platform" | "cloud-l2" | "backend";

export type ExecutionMode = "LIVE_BROWSER" | "MOCKED_CONTRACT_TEST";

export type SpikeStatus =
  | "PASS"
  | "FAIL"
  | "UNAVAILABLE"
  | "SKIPPED"
  | "MANUAL_REQUIRED";

export type SpikeFlagName =
  | "spike_s_w1_primary"
  | "spike_s_w2_primary"
  | "spike_s_w3_primary"
  | "spike_s_w4_primary"
  | "spike_s_w5_primary"
  | "spike_s_w6_primary"
  | "spike_s_w7_primary"
  | "spike_s_w9_primary"
  | "spike_s_w10_primary"
  | "spike_s_l2_primary"
  | "spike_s_rp_primary"
  | "spike_s_sc_primary"
  | "spike_s_n4_primary"
  | "spike_be_1_primary"
  | "spike_be_2_primary"
  | "spike_be_3_primary"
  | "spike_be_4_primary";

export interface RuntimeCapabilityReport {
  readonly promptApiAvailable: boolean;
  readonly promptApiMeasureInputUsage: boolean;
  readonly trustedTypesAvailable: boolean;
  readonly workerAvailable: boolean;
  readonly firebaseConfigPresent: boolean;
  readonly recaptchaSiteKeyPresent: boolean;
  readonly missingCloudFields: readonly string[];
}

export interface BrowserEnvironmentMetadata {
  readonly executionMode: ExecutionMode;
  readonly platform: string;
  readonly userAgent: string;
  readonly chromeMajor: number | null;
  readonly readiness: EnvReport["readiness"] | "unknown";
  readonly envReasons: EnvReport["reasons"];
  readonly capabilities: RuntimeCapabilityReport;
  readonly firebaseSdkVersion: string;
  readonly pdfJsVersion: string;
  readonly domPurifyVersion: string;
  readonly collectedAtIso: string;
}

export interface SpikeManualInputs {
  readonly internalsModelName?: string;
  readonly internalsComponentVersion?: string;
  readonly internalsNotes?: string;
  readonly judgeCode?: string;
  readonly sampleClaimHash?: string;
  readonly groundingPreviewContainer?: HTMLElement | null;
  readonly onDisposeGroundingPreview?: (dispose: () => void) => void;
  readonly enableDownloadGesture?: boolean;
}

export interface SpikeRunOptions {
  readonly executionMode?: ExecutionMode;
  readonly maxIterations?: number;
  readonly manualInputs?: SpikeManualInputs;
  readonly onlineOverride?: boolean;
}

export interface SpikeManualStepItem {
  readonly id: string;
  readonly description: string;
  readonly completed: boolean;
  readonly notes?: string;
}

export interface SpikeRunRecord {
  readonly spikeId: Phase0SpikeId;
  readonly title: string;
  readonly category: SpikeCategory;
  readonly targetDoc: string;
  readonly flagName: SpikeFlagName;
  readonly primaryRecommended: boolean;
  readonly executionMode: ExecutionMode;
  readonly status: SpikeStatus;
  readonly summary: string;
  readonly passCriterion: string;
  readonly fallbackAction: string;
  readonly markerLocations: readonly string[];
  readonly missingPrerequisites: readonly string[];
  readonly environment: BrowserEnvironmentMetadata;
  readonly metrics: Readonly<Record<string, number | string | boolean | null>>;
  readonly rawSamples: readonly Readonly<Record<string, unknown>>[];
  readonly manualChecklist: readonly SpikeManualStepItem[];
  readonly telemetrySnapshot: TelemetrySnapshot | null;
  readonly startedAtMs: number;
  readonly finishedAtMs: number;
}

export interface PromptSessionLike {
  readonly inputQuota?: number;
  measureInputUsage?(prompt: string, options?: Readonly<Record<string, unknown>>): Promise<number>;
  prompt?(input: string, options?: Readonly<Record<string, unknown>>): Promise<string>;
  destroy?(): void;
}

export interface BrowserHostAdapters {
  readonly navigatorLike: {
    readonly platform?: string;
    readonly userAgent?: string;
    readonly onLine?: boolean;
    readonly userAgentData?: {
      readonly brands: ReadonlyArray<{ readonly brand: string; readonly version: string }>;
    };
  };
  readonly locationOrigin: string;
  readonly languageModel?: {
    availability(opts: object): Promise<string>;
    create?(opts?: object): Promise<PromptSessionLike>;
  };
  readonly trustedTypes?: {
    createPolicy(name: string, policy: Record<string, unknown>): unknown;
  };
  readonly workerCtor?: new (url: string | URL, opts?: { type?: string }) => unknown;
  readonly documentLike?: {
    querySelectorAll(selector: string): ArrayLike<{ getAttribute(name: string): string | null }>;
    createElement(tagName: string): unknown;
    body?: { appendChild(node: unknown): unknown } | null;
  };
  readonly createMutationObserver?: (
    cb: (mutations: ReadonlyArray<{ attributeName?: string | null }>) => void
  ) => { observe(target: unknown, opts: object): void; disconnect(): void };
  readonly createObjectURL?: (blob: Blob) => string;
  readonly revokeObjectURL?: (url: string) => void;
  readonly nowMs: () => number;
  readonly nowPerfMs: () => number;
}

export interface SpikeRuntimeContext {
  readonly executionMode: ExecutionMode;
  readonly host: BrowserHostAdapters;
  readonly runtimeConfig: FirebaseRuntimeConfig;
  readonly getFirebaseRuntime: () => FirebaseRuntime | null;
  readonly getEnvironmentReport: () => Promise<EnvReport>;
  readonly inspectEnvironment: () => Promise<BrowserEnvironmentMetadata>;
}

export interface SpikeDefinition {
  readonly spikeId: Phase0SpikeId;
  readonly title: string;
  readonly category: SpikeCategory;
  readonly targetDoc: string;
  readonly flagName: SpikeFlagName;
  readonly passCriterion: string;
  readonly fallbackAction: string;
  readonly markerLocations: readonly string[];
  readonly run: (ctx: SpikeRuntimeContext, options?: SpikeRunOptions) => Promise<SpikeRunRecord>;
}
