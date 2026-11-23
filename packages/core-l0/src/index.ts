export {
  GENERAL_CATEGORIES,
  NORM_TABLE,
  codePointAtSafe,
  createSha256PrefixHasher,
  foldLatin,
  generalCategory,
  getUnicode151BinBytes,
  isBaseLetter,
  isCloser,
  isCombiningMark,
  isDigit,
  isJoinerPreservedScript,
  isKeyChar,
  isLetter,
  isLetterAt,
  isLower,
  isMarkMnOrMe,
  isPunctSent,
  isPunctuation,
  isSpace,
  isUpper,
  lowercaseNormalized,
  norm,
  normLower,
  normLowerWithMap,
  parseUnicode151Bin,
  sha256hex,
  sha256hexBytes,
  simpleLowerCodePoint,
  utf8Encode
} from "./norm.js";
export type {
  CodePointUnit,
  GeneralCategory,
  NormResult,
  NormTable,
  Sha256PrefixHasher,
  Unicode151Table
} from "./norm.js";

export {
  buildBraceCloseMap,
  collapseAndTrimAsciiSpace,
  mathText,
} from "./math.js";

export {
  LATEX_SECTION_LEVELS,
  SectionTracker,
  createEmptyImportQualityReport,
  matchCanonicalSectionLabel,
  resolveHeadingSequence,
  stripLeadingSectionNumbering,
  trimSpace,
} from "./sections.js";
export type {
  CanonicalSectionLabel,
  HeadingInput,
  ImportQualityReport,
  LatexSectionCommand,
  SectionState,
  SkippedFileRecord,
} from "./sections.js";

export {
  ARG_BRACE_MAX_LEN,
  ARG_BRACKET_MAX_LEN,
  ARG_MAX_BRACES,
  ARG_MAX_BRACKETS,
  CAPTION_MAX_LEN,
  DISPLAY_MATH_ENVS,
  DISPLAY_MATH_MAX_LEN,
  FENCED_CODE_MAX_LEN,
  FOOTNOTE_COMMANDS,
  FOOTNOTE_MAX_LEN,
  HTML_COMMENT_MAX_LEN,
  INLINE_CODE_MAX_LEN,
  INLINE_MATH_MAX_LEN,
  KNOWN_PROSE_ENVS,
  MACRO_BODY_MAX_LEN,
  MACRO_DEF_COMMANDS,
  MACRO_PARAM_MAX_LEN,
  MASK_CHAR,
  NON_PROSE_ENVS,
  NON_PROSE_ENV_MAX_LEN,
  RAW_NON_PROSE_ENVS,
  SECTION_COMMANDS,
  SECTION_TITLE_MAX_LEN,
  STRUCTURAL_COMMANDS,
  TABLE_ENVS,
  USER_MACRO_MAX_BODY_LEN,
  USER_MACRO_MAX_COUNT,
  YAML_FRONT_MATTER_MAX_LEN,
  countPrecedingBackslashes,
  preMask,
  scanArgumentSequence,
  scanBracketGroup,
  skipAdjacentWhitespace,
} from "./mask.js";
export type {
  ArgumentSequenceResult,
  ExtractedBibItem,
  ExtractedProseStream,
  ExtractedTable,
  FrontMatterMetadata,
  MaskedRegion,
  MaskedRegionKind,
  MaskedSpan,
  MathRegionRecord,
  PreMaskOptions,
  PreMaskResult,
  SectionTransition,
  SourceFormat,
} from "./mask.js";

export {
  CITE_COMMANDS,
  NARRATIVE_CITE_COMMANDS,
  applyLatexSubstitutions,
  normSentence,
  sentenceHash,
} from "./latex.js";
export type {
  LatexSubstitutionsOptions,
  LatexSubstitutionsResult,
  MathSpanInput,
  NormSentenceOptions,
  TextRangeLike,
} from "./latex.js";

export {
  AUTHOR_YEAR_PREFIXES,
  FIRST_CITATION_ORDER_STYLES,
  INTERVAL_CONTEXT_WORDS,
  MULTICITE_COMMANDS,
  NON_NAME_WORDS,
  SURNAME_PARTICLES,
  countWords,
  extractCorporateInitials,
  extractLatexBibStyle,
  extractMarkdownNumberedReferences,
  extractWordSpans,
  resolveCitationMarkers,
  scanCitations,
} from "./citations.js";
export type {
  AuthorYearQuery,
  AuthoritativeDocxMarker,
  BibStatus,
  BibliographyEntry,
  CitationMarker,
  CitationResolutionResult,
  CitationRuleKind,
  MarkdownNumberedRef,
  MarkerKind,
  MarkerResolutionStatus,
  ResolveCitationsOptions,
  ResolvedCitationMarker,
  ScanCitationsOptions,
  WordSpan,
} from "./citations.js";

export {
  CLASS_N_ABBREVS,
  CLASS_T_ABBREVS,
  INITIAL_TERMINAL_PRECEDERS,
  checkStage1Eligibility,
  computeClaimId,
  segmentDocument,
} from "./segment.js";
export type {
  SegmentDocumentResult,
  SegmentOptions,
  SegmentedSentence,
} from "./segment.js";

export {
  INNER_SPLITS,
  LEADING_FRAMES,
  LEAD_CONNECTORS,
  RELATIVIZERS,
  REPORTING_FRAMES,
  STRONG_BOUNDARIES,
  TRAIL_CONNECTORS,
  groupMarkers,
  partitionClauses,
  partitionClausesWithTrace,
} from "./clauses.js";
export type {
  ClauseSplitTrace,
  MarkerGroup,
  PartitionClausesWithTraceResult,
  PartitionedClause,
} from "./clauses.js";

export {
  BM25_STOPWORDS,
  PORTER_V1,
  isStopword,
  porterStem,
} from "./porter.js";

export {
  UNIT_WORDS,
  isKnownSuffixWordUnit,
  sameFamily,
  scanPrefixUnit,
  scanSuffixUnit,
  unitFamilyOf,
} from "./units.js";
export type {
  SuffixScanOptions,
  UnitFamily,
  UnitMatch,
} from "./units.js";

export {
  classifyMetricClass,
  isMetricFromUnitClass,
} from "./metricClass.js";
export type {
  MetricClass,
  MetricClassInput,
  MetricClassification,
} from "./metricClass.js";

export {
  computeSigDigits,
  formatCanonicalDecimal,
  isEnglishLocale,
} from "./numberParser.js";
export type { TextRange } from "./numberParser.js";

export {
  COUNT_NOUNS,
  computeTupleId,
  extractQuantities,
  extractQuantitiesWithMeta,
} from "./quantity.js";
export type {
  ExtractQuantitiesOptions,
  PComparator,
  QuantExtractionMeta,
  QuantTuple,
  TupleSource,
} from "./quantity.js";

export {
  normalizedClaim,
  normalizedClaimHash,
} from "./claimHash.js";
export type { ClaimNormOptions } from "./claimHash.js";

export {
  BM25_B,
  BM25_CLAUSE_WEIGHT,
  BM25_CONTEXT_WEIGHT,
  BM25_K1,
  BM25_QUANTITY_BONUS,
  GRID_KEY_SCALE,
  buildB4Query,
  buildBm25Corpus,
  buildBm25Query,
  compareBm25Candidates,
  compareCodeUnits,
  computeIdf,
  computeQuantityBonus,
  getCorpusIdf,
  gridKey,
  isNumericBm25Token,
  isWordBm25Token,
  rankBm25Units,
  scoreBm25Unit,
  sourceKindRank,
  tokBM25,
} from "./bm25.js";
export type {
  Bm25Corpus,
  Bm25IndexedUnit,
  Bm25Query,
  Bm25ScoreBreakdown,
  Bm25ScoredUnit,
  Bm25UnitInput,
  BuildBm25CorpusOptions,
  BuildBm25QueryOptions,
  EvidenceSourceKind,
  TokBM25Options,
} from "./bm25.js";

export {
  BM25_MIN_COV,
  BM25_MIN_COV_CONFIG,
  DEFAULT_BM25_MIN_COV,
  MAX_ABSTRACT_CANDIDATES,
  MAX_EVIDENCE_CANDIDATES,
  MAX_FULLTEXT_CANDIDATES,
  computeClaimCoverage,
  passesCoverageFilter,
  resolveBm25MinCov,
  selectEvidenceCandidates,
} from "./coverage.js";
export type {
  Bm25MinCovConfig,
  Bm25MinCovResolution,
  ClaimCoverageResult,
  EvaluatedCandidate,
  IdfLookup,
  SelectEvidenceOptions,
} from "./coverage.js";
export type { EvidenceSelectionResult } from "./coverage.js";

export {
  NEIGHBOUR_EXTENSION_MAX_WORDS,
  PDF_COLUMN_GAP_RATIO,
  PDF_HEADING_MAX_WORDS,
  PDF_HIDDEN_FONT_HEIGHT_MIN,
  PDF_HIDDEN_TEXT_MIN_ALPHA_WORDS,
  PDF_LINE_BASELINE_TOLERANCE_FACTOR,
  PDF_MIN_LINE_ALPHA_CHARS,
  PDF_REFERENCES_CUT_RATIO,
  PDF_RUNNING_HF_MIN_PAGES,
  PDF_RUNNING_HF_PAGE_RATIO,
  PDF_SUBSUP_MAX_HEIGHT_RATIO,
  PDF_SUBSUP_MAX_OFFSET_EM,
  PDF_SUBSUP_MIN_OFFSET_EM,
  PDF_WORD_GAP_FACTOR,
  WINDOW_SHAPING_MAX_WORDS,
  applyNeighbourExtension,
  chunkAbstract,
  chunkJatsOrderedNodes,
  chunkJatsXml,
  chunkPdfPages,
  chunkPhysicalTableRow,
  chunkPhysicalText,
  computeChunkId,
  computeEvidenceVersion,
  decodeXmlEntities,
  dehyphenatePdfLines,
  formatSelectRowText,
  getWordlistEnSet,
  getWordlistEnText,
  isInWordlistEn,
  parseXmlOrdered,
  shapeEvidenceWindow,
  stripJatsAndHtmlTags,
} from "./chunk.js";
export type {
  ChunkAbstractOptions,
  ChunkJatsOptions,
  ChunkJatsResult,
  ChunkPdfOptions,
  ChunkPdfResult,
  EvidenceUnit,
  OrderedXmlNode,
  PdfHiddenItemRecord,
  PdfPageInput,
  PdfTextItem,
  SelectRowCellInput,
  ShapedWindowResult,
} from "./chunk.js";
