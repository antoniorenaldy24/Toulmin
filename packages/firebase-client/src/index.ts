export {
  DEFAULT_FUNCTIONS_REGION,
  FIREBASE_CONFIG,
  RECAPTCHA_ENTERPRISE_SITE_KEY,
  resolveRuntimeConfig,
} from "./config.js";
export type { FirebaseClientConfig, FirebaseRuntimeConfig } from "./config.js";

export { BUILD_FLAGS } from "./buildFlags.js";
export type { BuildFlags, L2Mode, L2ThinkingConfig } from "./buildFlags.js";

export {
  BUNDLED_RC_DEFAULTS,
  DEFAULT_ANDROID_DEADLINE_MS,
  DEFAULT_CLOUD_MODEL,
  DEFAULT_SETTLE_CEILING_MS,
  DEFAULT_WEB_DEADLINE_MS,
  createMemoryRcReader,
  parseWebDeadlineMs,
} from "./rcDefaults.js";
export type { RemoteConfigKey, RemoteConfigReader } from "./rcDefaults.js";

export { classify, createTelemetry, telemetry } from "./telemetry.js";
export type {
  DefectCode,
  ErrorClass,
  TelemetryEvent,
  TelemetrySink,
  TelemetrySnapshot,
} from "./telemetry.js";

export { createDegradedState, degraded } from "./degraded.js";
export type { DegradedListener, DegradedStateController } from "./degraded.js";

export { toFirebaseSchema } from "./schemas/toFirebaseSchema.js";

export {
  createFirebaseRuntime,
  ensureAuth,
  getDefaultRuntime,
  setDefaultRuntimeForTest,
} from "./firebase.js";
export type {
  CreateFirebaseRuntimeOptions,
  FirebaseRuntime,
  FirebaseSdkAdapters,
} from "./firebase.js";

export { checkEnvironment, formatEnvironmentReasons } from "./l1/readiness.js";
export type {
  EnvReason,
  EnvReport,
  EnvironmentCheckDeps,
  LanguageModelLike,
  NavigatorLike,
  Readiness,
  UserAgentBrandLike,
} from "./l1/readiness.js";

export {
  MAX_OUT_CLOUD,
  localModel,
  memo,
  reasoningCapForSchema,
} from "./l1/models.js";
export type { LocalInference } from "./l1/models.js";

export { startModelDownload } from "./l1/download.js";

export { getTruncationFallback, looksTruncated } from "./l1/truncation.js";
export type { TruncationStep } from "./l1/truncation.js";

export { raceWithDeadline } from "./l1/deadline.js";

export { waitForSlotRelease } from "./l1/settle.js";
export type {
  SlotReleaseMode,
  SlotStatus,
  WaitForSlotReleaseParams,
} from "./l1/settle.js";

export {
  MAX_TRANSIENT_ATTEMPTS,
  createSessionCache,
  sessionCache,
} from "./l1/sessionCache.js";
export type {
  LateResultEntry,
  LateResultListener,
  SessionCache,
  TransientEntry,
} from "./l1/sessionCache.js";

export {
  assertPromptHashesReady,
  callL1,
  filterSanitizerBlockedEvidence,
  getStreamCharLimit,
  isTransient,
  normalizeInferenceSource,
  validateB5RawOutput,
  validateStage1RawOutput,
  validateStage2RawOutput,
} from "./l1/call.js";
export type {
  CallL1Options,
  CallL1Output,
  L1ErrorCode,
  L1Result,
  SanitizerFilterResult,
  Stage2SchemaId,
  Stage2ValidationOutcome,
  TransientReason,
  ValidatedStage1Output,
} from "./l1/call.js";

export {
  GROUNDING_IFRAME_SANDBOX,
  createGroundingIframe,
  filterGroundingSources,
  formatCloudReloadLabelFromTimestamp,
  isSafeHttpsUri,
  isThisPaperGroundingUri,
  renderGroundingSourcesList,
} from "./l2/grounding.js";
export type {
  DomElementLike,
  GroundingChunk,
  GroundingDisplaySource,
  GroundingDomDeps,
  GroundingIframeHandle,
  IframeElementLike,
} from "./l2/grounding.js";

export {
  L2_MODE,
  adjudicateClaimL2,
  l2Adjudicate,
  l2AdjudicateProvided,
  parseTextJsonL2,
} from "./l2/adjudicate.js";
export type {
  AdjudicateClaimL2Deps,
  AdjudicateClaimL2Input,
  AdjudicateClaimL2Output,
  DoiResolverHook,
  L2ModelOptions,
  L2SessionDisplay,
  ParseTextJsonL2Result,
  ResolvedAlternativeDoi,
} from "./l2/adjudicate.js";

export { altSources, findAlternativeSources } from "./l2/altSources.js";
export type {
  AltSourcesModelOptions,
  FindAltSourcesDeps,
  FindAltSourcesInput,
  FindAltSourcesResult,
} from "./l2/altSources.js";

export { callBibResolve, createBibResolveDoiResolver } from "./callables/bibResolve.js";
export type { BibResolveCallDeps, HttpsCallableFactory } from "./callables/bibResolve.js";

export { callOaFetch } from "./callables/oaFetch.js";
export type { OaFetchCallDeps } from "./callables/oaFetch.js";

export { callQuotaGuard } from "./callables/quotaGuard.js";
export type { QuotaGuardCallDeps } from "./callables/quotaGuard.js";

export { callRedeemJudgeCode } from "./callables/redeemJudgeCode.js";
export type { RedeemJudgeCodeCallDeps } from "./callables/redeemJudgeCode.js";
