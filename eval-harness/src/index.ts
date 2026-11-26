export {
  Pcg64Rng,
  POWER_SENSITIVITY_MULTIPLIERS,
  PREVALENCE_RATES,
  SEED_B2_SUBSAMPLE,
  SEED_BOOTSTRAP,
  SEED_FUZZ,
  SEED_GRID_BOOTSTRAP,
  SEED_KAPPA_RESUBSAMPLE,
  SEED_KAPPA_SUBSAMPLE,
  SEED_O2_BOOTSTRAP,
  SEED_PERMUTATION,
  SEED_POWER,
  SEED_PROPERTY,
  SUPPORT_OC_PRECISIONS,
  SUPPORT_OC_SAMPLE_SIZES,
  WILSON_Z_95,
  binomialPmf,
  buildRoutingCalibration,
  clusterBootstrapPerCallPrecisionCI,
  cohensKappa,
  computePrevalenceSummary,
  computeR1EMetrics,
  exactBinomialTail,
  exactOneSidedMcNemar,
  gateGridKey,
  majorityOf3,
  minimumPassingSupportCount,
  normalizeRunVerdict,
  pairedPermutationTest,
  percentileType7,
  prevalenceAdjustedFromRates,
  prevalencePrecisionFromLikelihoodRatio,
  simulateMcNemarPower,
  stratifiedBootstrapStabilityCI,
  supportGateOperatingCharacteristic,
  wilson,
} from "./stats.js";
export type {
  CohensKappaResult,
  PairedPermutationResult,
  PairedSystemItem,
  PrevalenceAdjustedValue,
  PrevalenceRate,
  PrevalenceSummary,
  R1EMetricsSummary,
  R1EPairObservation,
  RunVerdict,
  SupportGateOcRow,
} from "./stats.js";

export {
  CF1_DELTA_MIN,
  CF1_HOLM_ALPHA,
  PROFILE_CF1_TASKS,
  TASK_TIE_ORDER,
  checkAuthority,
  computeHolmAdjusted,
  evaluateCf1ProfileHolm,
} from "./holm.js";
export type {
  Cf1ProfileEvaluation,
  Cf1TaskInput,
  HolmAdjustedEntry,
  HolmInputEntry,
} from "./holm.js";

export {
  assembleRoutingTable,
  computeB4CountsInReview,
  runPublishRoutingCli,
  verifyPublishableRoutingTable,
} from "./publish_routing.js";
export type {
  AssembleProfileInput,
  AssembleRoutingTableInput,
  ExpectedH4Hashes,
  PublishCliIo,
  PublishRoutingValidationInput,
  PublishRoutingValidationResult,
} from "./publish_routing.js";

export {
  compareUtf8Bytes,
  computeManifestEnvelopeHash,
  computeStrataCounts,
  createRunManifest,
  generateDatasetManifest,
  inferDatasetKind,
  isBareSha256Hex,
  normalizeRelativePath,
  parseJsonl,
  runManifestCli,
  sha256HexBytes,
  sha256HexUtf8,
  validateDatasetRow,
  validateRunManifest,
  verifyDatasetManifest,
} from "./manifest.js";
export type {
  DatasetFileEntry,
  DatasetKind,
  DatasetManifest,
  DatasetVerifyError,
  DatasetVerifyErrorCode,
  DatasetVerifyResult,
  ParsedJsonlLine,
  RunManifest,
  RunManifestValidationResult,
} from "./manifest.js";

export {
  KAPPA_TARGET_MIN,
  checkDatasetDisjointness,
  evaluateAnnotators,
  formatAnnotationReportMarkdown,
  runDisjointnessCli,
} from "./disjointness.js";
export type {
  AnnotationStatus,
  AnnotatorEvaluationInput,
  AnnotatorEvaluationResult,
  AnnotatorPairLabel,
  B2AnnotatorPairLabel,
  DisjointnessOverlap,
  DisjointnessResult,
  DisjointnessSplitInput,
  GitAuthorRecord,
  NPairRelatednessViolation,
  OverlapKind,
  SGrayBoundSummary,
} from "./disjointness.js";

export {
  calibrateBm25MinCov,
  formatBm25CalibrationMarkdown,
  runBm25CalibrateCli,
} from "./bm25Calibrate.js";
export type {
  Bm25CalibrationInput,
  Bm25CalibrationResult,
  ClaimLengthStratum,
  DevPairForCalibration,
  DistractorAbstract,
  StratumRetentionRow,
  UnitLengthStratum,
} from "./bm25Calibrate.js";

export {
  MS_SAN_OVERALL_FP_MAX,
  MS_SAN_PER_PATTERN_FP_MAX,
  evaluateSanitizerMsSan,
  evaluateSanitizerRedTeam,
  formatSanitizerReportMarkdown,
  runSanitizerEvalCli,
} from "./sanitizerEval.js";
export type {
  BlockedUnitSample,
  MsSanEvalResult,
  RedTeamEvalResult,
  SanitizerCorpusItem,
  SanitizerPatternStat,
} from "./sanitizerEval.js";

export {
  PLANNED_CF1_SAMPLE_SIZES,
  POWER_TARGET_DELTAS,
  analyzeCf1Power,
  computePilotStats,
  formatPowerReportMarkdown,
  runPowerCli,
  simulateB1PermutationPower,
  solveB1FlipProbabilities,
} from "./power.js";
export type {
  B1PilotF1Item,
  PilotOutcomePair,
  PilotStats,
  PowerAnalysisReport,
  PowerMatrixCell,
  TaskPowerInput,
  TaskPowerMethod,
  TaskPowerSummary,
} from "./power.js";
