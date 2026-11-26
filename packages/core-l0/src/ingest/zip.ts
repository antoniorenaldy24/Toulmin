/**
 * Pure ZIP / Archive Safety Guards & Central Directory Reader
 * (`docs/spec/03_L0_TIER_B_VALIDATOR_B5_INGEST.md` §5.1, `06` §2.11.1, `AC-L0-11`).
 *
 * Pure TypeScript: zero Node I/O, zero `TextDecoder`/`Buffer`, zero DOM/network/clock/regexes.
 */

import { compareCodeUnits } from "../bm25.js";
import { createEmptyImportQualityReport, type ImportQualityReport } from "../sections.js";

export const MAX_ARCHIVE_BYTES = 200 * 1024 * 1024;
export const MAX_ARCHIVE_ENTRIES = 5_000;
export const MAX_ENTRY_DECOMPRESSED_BYTES = 20 * 1024 * 1024;
export const MAX_COMPRESSION_RATIO = 100;
export const MAX_TOTAL_DECOMPRESSED_BYTES = 50 * 1024 * 1024;
export const MAX_INPUT_DEPTH = 10;
export const MAX_INPUT_EXPANDED_BYTES = 2 * 1024 * 1024;

export const ALLOWED_TEXT_EXTENSIONS: readonly string[] = [".tex", ".bib", ".bbl", ".md", ".txt"];
export const DOCX_XML_ALLOWLIST: readonly string[] = ["word/document.xml", "word/footnotes.xml"];

export type IngestionErrorCode =
  | "ARCHIVE_TOO_LARGE"
  | "TOO_MANY_ENTRIES"
  | "ENTRY_TOO_LARGE"
  | "COMPRESSION_RATIO_EXCEEDED"
  | "TOTAL_TEXT_LIMIT_EXCEEDED"
  | "PATH_TRAVERSAL"
  | "NON_TEXT_ENTRY"
  | "INPUT_EXPANSION_LIMIT"
  | "NO_MAIN_FILE"
  | "UNSUPPORTED_FILE";

export const INGESTION_COPY = {
  archiveOver200Mb:
    "This archive is larger than 200 MB. Remove images or build files and try again.",
  tooManyEntries: "This archive has too many files.",
  archiveTooLargeGeneric: "This archive is too large or too compressed to import safely.",
  inputExpansionLimit:
    "The included files expand to more than 2 MB of text. Import the chapter you are working on.",
  noMainFile: "No main .tex file found (it needs \\documentclass and \\begin{document}). Pick one:",
  unsupportedFile: "Toulmin can import LaTeX projects (.zip), .tex with .bib, .md and .docx files.",
} as const;

export interface ArchiveEntryViolation {
  readonly file: string;
  readonly reason: IngestionErrorCode;
}

export interface ArchiveEntryInput {
  readonly path: string;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly isDirectory?: boolean;
  readonly readText?: () => string;
  readonly readBytes?: () => Uint8Array;
}

export interface IngestArchiveOptions {
  readonly archiveBytes: number;
  readonly entries: readonly ArchiveEntryInput[];
  readonly mode?: "latex_archive" | "docx";
  readonly report?: ImportQualityReport;
}

export interface ArchiveIngestionResult {
  readonly ok: boolean;
  readonly errorCode: IngestionErrorCode | null;
  readonly errorMessage: string | null;
  readonly files: Readonly<Record<string, string>>;
  readonly orderedPaths: readonly string[];
  readonly totalDecompressedBytes: number;
  readonly violations: readonly ArchiveEntryViolation[];
  readonly report: ImportQualityReport;
}

export interface ZipCentralDirEntry {
  readonly path: string;
  readonly compressionMethod: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly localHeaderOffset: number;
  readonly isDirectory: boolean;
  readStoredBytes(): Uint8Array | null;
}

function asciiLower(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i += 1) {
    const cu = text.charCodeAt(i);
    if (cu >= 65 && cu <= 90) {
      out += String.fromCharCode(cu + 32);
    } else {
      out += text.charAt(i);
    }
  }
  return out;
}

function cloneReport(src?: ImportQualityReport): ImportQualityReport {
  if (src === undefined) return createEmptyImportQualityReport();
  return {
    filesRead: src.filesRead,
    filesSkipped: src.filesSkipped,
    skippedFiles: src.skippedFiles.map((s) => ({ ...s })),
    unresolvedInputs: [...src.unresolvedInputs],
    macrosNotExpanded: [...src.macrosNotExpanded],
    unregisteredCommands: [...src.unregisteredCommands],
    unknownEnvironments: [...src.unknownEnvironments],
    tablesParsed: src.tablesParsed,
    mathRegions: { ...src.mathRegions },
    footnotes: src.footnotes,
    parseTimeouts: [...src.parseTimeouts],
    unresolvedKeys: [...src.unresolvedKeys],
    possibleCitations: [...src.possibleCitations],
  };
}

/**
 * Pure UTF-8 byte decoder with BOM stripping and U+FFFD replacement on malformed sequences.
 */
export function utf8Decode(bytes: Uint8Array): string {
  const n = bytes.length;
  let i = 0;
  if (n >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    i = 3;
  }
  const chunks: string[] = [];
  let acc = "";
  const flushIfLarge = (): void => {
    if (acc.length >= 4096) {
      chunks.push(acc);
      acc = "";
    }
  };

  while (i < n) {
    const b0 = bytes[i]!;
    if (b0 <= 0x7f) {
      acc += String.fromCharCode(b0);
      i += 1;
    } else if (b0 >= 0xc2 && b0 <= 0xdf && i + 1 < n) {
      const b1 = bytes[i + 1]!;
      if ((b1 & 0xc0) === 0x80) {
        const cp = ((b0 & 0x1f) << 6) | (b1 & 0x3f);
        acc += String.fromCharCode(cp);
        i += 2;
      } else {
        acc += "\ufffd";
        i += 1;
      }
    } else if (b0 >= 0xe0 && b0 <= 0xef && i + 2 < n) {
      const b1 = bytes[i + 1]!;
      const b2 = bytes[i + 2]!;
      const validLead =
        (b0 === 0xe0 ? b1 >= 0xa0 && b1 <= 0xbf : b0 === 0xed ? b1 >= 0x80 && b1 <= 0x9f : (b1 & 0xc0) === 0x80) &&
        (b2 & 0xc0) === 0x80;
      if (validLead) {
        const cp = ((b0 & 0x0f) << 12) | ((b1 & 0x3f) << 6) | (b2 & 0x3f);
        acc += String.fromCharCode(cp);
        i += 3;
      } else {
        acc += "\ufffd";
        i += 1;
      }
    } else if (b0 >= 0xf0 && b0 <= 0xf4 && i + 3 < n) {
      const b1 = bytes[i + 1]!;
      const b2 = bytes[i + 2]!;
      const b3 = bytes[i + 3]!;
      const validLead =
        (b0 === 0xf0
          ? b1 >= 0x90 && b1 <= 0xbf
          : b0 === 0xf4
            ? b1 >= 0x80 && b1 <= 0x8f
            : (b1 & 0xc0) === 0x80) &&
        (b2 & 0xc0) === 0x80 &&
        (b3 & 0xc0) === 0x80;
      if (validLead) {
        const cp = ((b0 & 0x07) << 18) | ((b1 & 0x3f) << 12) | ((b2 & 0x3f) << 6) | (b3 & 0x3f);
        const adj = cp - 0x10000;
        acc += String.fromCharCode(0xd800 + (adj >> 10), 0xdc00 + (adj & 0x3ff));
        i += 4;
      } else {
        acc += "\ufffd";
        i += 1;
      }
    } else {
      acc += "\ufffd";
      i += 1;
    }
    flushIfLarge();
  }
  if (acc.length > 0) chunks.push(acc);
  return chunks.join("");
}

/**
 * Pure UTF-8 encoded byte length of a JavaScript UTF-16 string.
 */
export function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    if (c <= 0x7f) {
      bytes += 1;
    } else if (c <= 0x7ff) {
      bytes += 2;
    } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

/**
 * Normalizes an archive path (`\` -> `/`, trims `./`) and rejects absolute paths,
 * Windows drive prefixes, control characters, empty segments, and `..` traversal (`03` §5.1).
 */
export function normalizeArchivePath(
  rawPath: string,
): { readonly ok: true; readonly path: string } | { readonly ok: false; readonly reason: "PATH_TRAVERSAL" } {
  const trimmed = rawPath.trim();
  if (trimmed.length === 0) return { ok: false, reason: "PATH_TRAVERSAL" };
  for (let i = 0; i < trimmed.length; i += 1) {
    const cu = trimmed.charCodeAt(i);
    if (cu < 0x20 || cu === 0x7f) {
      return { ok: false, reason: "PATH_TRAVERSAL" };
    }
  }

  let s = trimmed.split("\\").join("/");
  while (s.startsWith("./")) {
    s = s.slice(2);
  }
  if (s.length === 0 || s.startsWith("/") || s.endsWith("/")) {
    return { ok: false, reason: "PATH_TRAVERSAL" };
  }
  if (s.length >= 2 && s.charCodeAt(1) === 58 /* ':' */) {
    const c0 = s.charCodeAt(0);
    if ((c0 >= 65 && c0 <= 90) || (c0 >= 97 && c0 <= 122)) {
      return { ok: false, reason: "PATH_TRAVERSAL" };
    }
  }

  const segments = s.split("/");
  const clean: string[] = [];
  for (const seg of segments) {
    if (seg.length === 0 || seg === "." || seg === "..") {
      return { ok: false, reason: "PATH_TRAVERSAL" };
    }
    clean.push(seg);
  }
  return { ok: true, path: clean.join("/") };
}

function hasUnsafePathToken(rawPath: string): boolean {
  const s = rawPath.split("\\").join("/");
  if (s.startsWith("/")) return true;
  const segments = s.split("/");
  for (const seg of segments) {
    if (seg === "..") return true;
  }
  return false;
}

export function isAllowedTextSourcePath(normalizedPath: string): boolean {
  const lower = asciiLower(normalizedPath);
  for (const ext of ALLOWED_TEXT_EXTENSIONS) {
    if (lower.endsWith(ext) && lower.length > ext.length) {
      return true;
    }
  }
  return false;
}

export function isAllowedDocxXmlPath(normalizedPath: string): boolean {
  const lower = asciiLower(normalizedPath);
  return DOCX_XML_ALLOWLIST.includes(lower);
}

function compressionRatioExceeds(uncompressedSize: number, compressedSize: number): boolean {
  if (uncompressedSize < 0 || compressedSize < 0) return true;
  if (uncompressedSize === 0) return false;
  if (compressedSize === 0) return true;
  return uncompressedSize / compressedSize > MAX_COMPRESSION_RATIO;
}

/**
 * Enforces every safety guard in `03` §5.1 before calling any entry's decompressor (`readText`/`readBytes`).
 */
export function ingestArchiveEntries(input: IngestArchiveOptions): ArchiveIngestionResult {
  const report = cloneReport(input.report);
  const mode = input.mode ?? "latex_archive";
  const files: Record<string, string> = {};
  const orderedPaths: string[] = [];
  const violations: ArchiveEntryViolation[] = [];

  if (input.archiveBytes > MAX_ARCHIVE_BYTES) {
    return {
      ok: false,
      errorCode: "ARCHIVE_TOO_LARGE",
      errorMessage: INGESTION_COPY.archiveOver200Mb,
      files,
      orderedPaths,
      totalDecompressedBytes: 0,
      violations: [{ file: "<archive>", reason: "ARCHIVE_TOO_LARGE" }],
      report,
    };
  }

  if (input.entries.length > MAX_ARCHIVE_ENTRIES) {
    return {
      ok: false,
      errorCode: "TOO_MANY_ENTRIES",
      errorMessage: INGESTION_COPY.tooManyEntries,
      files,
      orderedPaths,
      totalDecompressedBytes: 0,
      violations: [{ file: "<archive>", reason: "TOO_MANY_ENTRIES" }],
      report,
    };
  }

  let totalDecompressedBytes = 0;

  for (const entry of input.entries) {
    const rawTrimmed = entry.path.trim();
    if (hasUnsafePathToken(rawTrimmed)) {
      violations.push({ file: entry.path, reason: "PATH_TRAVERSAL" });
      report.filesSkipped += 1;
      report.skippedFiles.push({ file: entry.path, reason: "PATH_TRAVERSAL" });
      continue;
    }
    if (
      entry.isDirectory === true ||
      rawTrimmed.endsWith("/") ||
      rawTrimmed.endsWith("\\")
    ) {
      continue;
    }

    const normPath = normalizeArchivePath(entry.path);
    if (!normPath.ok) {
      violations.push({ file: entry.path, reason: "PATH_TRAVERSAL" });
      report.filesSkipped += 1;
      report.skippedFiles.push({ file: entry.path, reason: "PATH_TRAVERSAL" });
      continue;
    }

    const cleanPath = normPath.path;
    const allowed =
      mode === "docx" ? isAllowedDocxXmlPath(cleanPath) : isAllowedTextSourcePath(cleanPath);
    if (!allowed) {
      violations.push({ file: cleanPath, reason: "NON_TEXT_ENTRY" });
      report.filesSkipped += 1;
      report.skippedFiles.push({ file: cleanPath, reason: "NON_TEXT_ENTRY" });
      continue;
    }

    if (entry.uncompressedSize > MAX_ENTRY_DECOMPRESSED_BYTES) {
      violations.push({ file: cleanPath, reason: "ENTRY_TOO_LARGE" });
      report.filesSkipped += 1;
      report.skippedFiles.push({ file: cleanPath, reason: "ENTRY_TOO_LARGE" });
      continue;
    }

    if (compressionRatioExceeds(entry.uncompressedSize, entry.compressedSize)) {
      violations.push({ file: cleanPath, reason: "COMPRESSION_RATIO_EXCEEDED" });
      report.filesSkipped += 1;
      report.skippedFiles.push({ file: cleanPath, reason: "COMPRESSION_RATIO_EXCEEDED" });
      continue;
    }

    if (totalDecompressedBytes + entry.uncompressedSize > MAX_TOTAL_DECOMPRESSED_BYTES) {
      violations.push({ file: cleanPath, reason: "TOTAL_TEXT_LIMIT_EXCEEDED" });
      report.filesSkipped += 1;
      report.skippedFiles.push({ file: cleanPath, reason: "TOTAL_TEXT_LIMIT_EXCEEDED" });
      return {
        ok: false,
        errorCode: "TOTAL_TEXT_LIMIT_EXCEEDED",
        errorMessage: INGESTION_COPY.archiveTooLargeGeneric,
        files,
        orderedPaths: [...orderedPaths].sort(compareCodeUnits),
        totalDecompressedBytes,
        violations,
        report,
      };
    }

    let text: string | null = null;
    let actualByteLen = entry.uncompressedSize;
    if (entry.readBytes !== undefined) {
      const rawBytes = entry.readBytes();
      actualByteLen = rawBytes.length;
      if (actualByteLen > MAX_ENTRY_DECOMPRESSED_BYTES) {
        violations.push({ file: cleanPath, reason: "ENTRY_TOO_LARGE" });
        report.filesSkipped += 1;
        report.skippedFiles.push({ file: cleanPath, reason: "ENTRY_TOO_LARGE" });
        continue;
      }
      if (compressionRatioExceeds(actualByteLen, entry.compressedSize)) {
        violations.push({ file: cleanPath, reason: "COMPRESSION_RATIO_EXCEEDED" });
        report.filesSkipped += 1;
        report.skippedFiles.push({ file: cleanPath, reason: "COMPRESSION_RATIO_EXCEEDED" });
        continue;
      }
      if (totalDecompressedBytes + actualByteLen > MAX_TOTAL_DECOMPRESSED_BYTES) {
        violations.push({ file: cleanPath, reason: "TOTAL_TEXT_LIMIT_EXCEEDED" });
        report.filesSkipped += 1;
        report.skippedFiles.push({ file: cleanPath, reason: "TOTAL_TEXT_LIMIT_EXCEEDED" });
        return {
          ok: false,
          errorCode: "TOTAL_TEXT_LIMIT_EXCEEDED",
          errorMessage: INGESTION_COPY.archiveTooLargeGeneric,
          files,
          orderedPaths: [...orderedPaths].sort(compareCodeUnits),
          totalDecompressedBytes,
          violations,
          report,
        };
      }
      text = utf8Decode(rawBytes);
    } else if (entry.readText !== undefined) {
      text = entry.readText();
      actualByteLen = utf8ByteLength(text);
      if (actualByteLen > MAX_ENTRY_DECOMPRESSED_BYTES) {
        violations.push({ file: cleanPath, reason: "ENTRY_TOO_LARGE" });
        report.filesSkipped += 1;
        report.skippedFiles.push({ file: cleanPath, reason: "ENTRY_TOO_LARGE" });
        continue;
      }
      if (compressionRatioExceeds(actualByteLen, entry.compressedSize)) {
        violations.push({ file: cleanPath, reason: "COMPRESSION_RATIO_EXCEEDED" });
        report.filesSkipped += 1;
        report.skippedFiles.push({ file: cleanPath, reason: "COMPRESSION_RATIO_EXCEEDED" });
        continue;
      }
      if (totalDecompressedBytes + actualByteLen > MAX_TOTAL_DECOMPRESSED_BYTES) {
        violations.push({ file: cleanPath, reason: "TOTAL_TEXT_LIMIT_EXCEEDED" });
        report.filesSkipped += 1;
        report.skippedFiles.push({ file: cleanPath, reason: "TOTAL_TEXT_LIMIT_EXCEEDED" });
        return {
          ok: false,
          errorCode: "TOTAL_TEXT_LIMIT_EXCEEDED",
          errorMessage: INGESTION_COPY.archiveTooLargeGeneric,
          files,
          orderedPaths: [...orderedPaths].sort(compareCodeUnits),
          totalDecompressedBytes,
          violations,
          report,
        };
      }
    }

    if (text === null) {
      violations.push({ file: cleanPath, reason: "UNSUPPORTED_FILE" });
      report.filesSkipped += 1;
      report.skippedFiles.push({ file: cleanPath, reason: "UNSUPPORTED_FILE" });
      continue;
    }

    if (!Object.prototype.hasOwnProperty.call(files, cleanPath)) {
      orderedPaths.push(cleanPath);
      report.filesRead += 1;
    }
    files[cleanPath] = text;
    totalDecompressedBytes += actualByteLen;
  }

  orderedPaths.sort(compareCodeUnits);

  return {
    ok: true,
    errorCode: null,
    errorMessage: null,
    files,
    orderedPaths,
    totalDecompressedBytes,
    violations,
    report,
  };
}

/**
 * Pure PKZIP Central Directory reader (supports EOCD scan, size/count bounds, and stored method-0 entries)
 * with zero Node/DOM dependencies so workers and tests can inspect `.zip` bytes before decompression.
 */
export function parseZipCentralDirectory(bytes: Uint8Array): {
  readonly ok: boolean;
  readonly entries: readonly ZipCentralDirEntry[];
  readonly errorCode: IngestionErrorCode | null;
} {
  if (bytes.length > MAX_ARCHIVE_BYTES) {
    return { ok: false, entries: [], errorCode: "ARCHIVE_TOO_LARGE" };
  }
  if (bytes.length < 22) {
    return { ok: false, entries: [], errorCode: "UNSUPPORTED_FILE" };
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const minOffset = Math.max(0, bytes.length - 65_557);
  let eocdOffset = -1;
  for (let off = bytes.length - 22; off >= minOffset; off -= 1) {
    if (view.getUint32(off, true) === 0x06054b50) {
      const commentLen = view.getUint16(off + 20, true);
      if (off + 22 + commentLen === bytes.length) {
        eocdOffset = off;
        break;
      }
    }
  }
  if (eocdOffset === -1) {
    return { ok: false, entries: [], errorCode: "UNSUPPORTED_FILE" };
  }

  const totalEntries = view.getUint16(eocdOffset + 10, true);
  const cdSize = view.getUint32(eocdOffset + 12, true);
  const cdOffset = view.getUint32(eocdOffset + 16, true);
  if (totalEntries > MAX_ARCHIVE_ENTRIES) {
    return { ok: false, entries: [], errorCode: "TOO_MANY_ENTRIES" };
  }
  if (cdOffset + cdSize > eocdOffset) {
    return { ok: false, entries: [], errorCode: "UNSUPPORTED_FILE" };
  }

  const entries: ZipCentralDirEntry[] = [];
  let cursor = cdOffset;
  const cdEnd = cdOffset + cdSize;
  while (cursor + 46 <= cdEnd && entries.length < totalEntries) {
    if (view.getUint32(cursor, true) !== 0x02014b50) {
      return { ok: false, entries: [], errorCode: "UNSUPPORTED_FILE" };
    }
    const method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const nameLen = view.getUint16(cursor + 28, true);
    const extraLen = view.getUint16(cursor + 30, true);
    const commentLen = view.getUint16(cursor + 32, true);
    const externalAttrs = view.getUint32(cursor + 38, true);
    const localHeaderOffset = view.getUint32(cursor + 42, true);

    const nameStart = cursor + 46;
    const recordEnd = nameStart + nameLen + extraLen + commentLen;
    if (recordEnd > cdEnd) {
      return { ok: false, entries: [], errorCode: "UNSUPPORTED_FILE" };
    }
    const rawName = utf8Decode(bytes.subarray(nameStart, nameStart + nameLen));
    const isDir = rawName.endsWith("/") || (externalAttrs & 0x10) !== 0;

    entries.push({
      path: rawName,
      compressionMethod: method,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
      isDirectory: isDir,
      readStoredBytes: () => {
        if (method !== 0) return null;
        if (localHeaderOffset + 30 > bytes.length) return null;
        if (view.getUint32(localHeaderOffset, true) !== 0x04034b50) return null;
        const lfNameLen = view.getUint16(localHeaderOffset + 26, true);
        const lfExtraLen = view.getUint16(localHeaderOffset + 28, true);
        const dataStart = localHeaderOffset + 30 + lfNameLen + lfExtraLen;
        const dataEnd = dataStart + compressedSize;
        if (dataEnd > bytes.length) return null;
        return bytes.slice(dataStart, dataEnd);
      },
    });
    cursor = recordEnd;
  }

  return { ok: true, entries, errorCode: null };
}
