export {
  ALLOWED_TEXT_EXTENSIONS,
  DOCX_XML_ALLOWLIST,
  INGESTION_COPY,
  MAX_ARCHIVE_BYTES,
  MAX_ARCHIVE_ENTRIES,
  MAX_COMPRESSION_RATIO,
  MAX_ENTRY_DECOMPRESSED_BYTES,
  MAX_INPUT_DEPTH,
  MAX_INPUT_EXPANDED_BYTES,
  MAX_TOTAL_DECOMPRESSED_BYTES,
  ingestArchiveEntries,
  isAllowedDocxXmlPath,
  isAllowedTextSourcePath,
  normalizeArchivePath,
  parseZipCentralDirectory,
  utf8ByteLength,
  utf8Decode,
} from "./zip.js";
export type {
  ArchiveEntryInput,
  ArchiveEntryViolation,
  ArchiveIngestionResult,
  IngestArchiveOptions,
  IngestionErrorCode,
  ZipCentralDirEntry,
} from "./zip.js";

export {
  assignDeterministicRefId,
  decodeLatexBibText,
  deduplicateBibRecords,
  normalizeArxivId,
  normalizeDoiVerbatim,
  normalizePmcid,
  parseBibAuthorList,
  parseBibItems,
  parseBibTex,
  parseCslJson,
  parseRis,
  sortBibRecordsByRefId,
  toBibliographyEntries,
} from "./bib.js";
export type {
  BibParseResult,
  BibSourceFormat,
  IngestedBibRecord,
  ParsedAuthor,
} from "./bib.js";

export {
  discoverBibFiles,
  expandLatexProject,
  fileLineToGlobal,
  fileOffsetToGlobal,
  findMainTexFile,
  globalToFileLine,
  ingestLatexProject,
} from "./tex.js";
export type {
  ExpandLatexProjectInput,
  ExpandLatexProjectResult,
  FileLinePosition,
  IngestLatexProjectInput,
  IngestLatexProjectResult,
  MainTexResolution,
  TexOffsetMap,
  TexOffsetSegment,
} from "./tex.js";

export {
  ingestMarkdownDocument,
  parsePandocFrontMatter,
} from "./md.js";
export type {
  IngestMarkdownInput,
  IngestMarkdownResult,
  PandocFrontMatter,
} from "./md.js";

export {
  DOCX_READONLY_BANNER,
  DOCX_UNIT_TOKENS,
  decodeBase64Utf8,
  ingestDocxXml,
} from "./docx.js";
export type {
  DocxFootnoteStream,
  IngestDocxResult,
  IngestDocxXmlInput,
} from "./docx.js";

export {
  ingestUserPdf,
  matchPdfToReference,
  scanPage1ArxivId,
  scanPage1Doi,
} from "./pdf.js";
export type {
  IngestUserPdfInput,
  IngestUserPdfResult,
} from "./pdf.js";
