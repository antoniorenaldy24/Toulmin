export {
  GENERAL_CATEGORIES,
  NORM_TABLE,
  codePointAtSafe,
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
