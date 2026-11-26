/**
 * Pure LaTeX Multi-File Project Discovery, Memoized `\input`/`\include`/`\subfile` Expansion,
 * Bidirectional Offset Map (`(file, line, col) <-> globalOffset`), and Bibliography Discovery
 * (`docs/spec/03_L0_TIER_B_VALIDATOR_B5_INGEST.md` §5.2 steps 2–4 & 6, §5.5; `AC-L0-10`, `AC-L0-11`).
 *
 * Pure TypeScript: zero Node I/O, DOM, network, clock, or regex usage.
 */

import { compareCodeUnits } from "../bm25.js";
import { extractLatexBibStyle } from "../citations.js";
import { normLower } from "../norm.js";
import { createEmptyImportQualityReport, type ImportQualityReport } from "../sections.js";
import {
  deduplicateBibRecords,
  parseBibItems,
  parseBibTex,
  toBibliographyEntries,
  type IngestedBibRecord,
} from "./bib.js";
import {
  INGESTION_COPY,
  MAX_INPUT_DEPTH,
  MAX_INPUT_EXPANDED_BYTES,
  normalizeArchivePath,
  utf8ByteLength,
} from "./zip.js";
import type { BibliographyEntry } from "../citations.js";

const VERBATIM_LIKE_ENVS: ReadonlySet<string> = new Set([
  "verbatim",
  "verbatim*",
  "lstlisting",
  "minted",
  "comment",
  "Verbatim",
  "BVerbatim",
  "LVerbatim",
]);

interface TexDirectiveToken {
  readonly kind: "documentclass" | "begin_document" | "include" | "bibliography" | "addbibresource";
  readonly start: number;
  readonly end: number;
  readonly arg: string;
}

interface ScannedTexFile {
  readonly directives: readonly TexDirectiveToken[];
  readonly hasDocumentClass: boolean;
  readonly hasBeginDocument: boolean;
  readonly hasIncludeDirective: boolean;
}

export interface TexOffsetSegment {
  readonly globalStart: number;
  readonly globalEnd: number;
  readonly file: string;
  readonly localStart: number;
  readonly localEnd: number;
}

export interface TexOffsetMap {
  readonly segments: readonly TexOffsetSegment[];
  readonly fileLineStarts: Readonly<Record<string, readonly number[]>>;
}

export interface FileLinePosition {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly localOffset: number;
}

export interface MainTexResolution {
  readonly ok: boolean;
  readonly mainFile: string | null;
  readonly candidates: readonly string[];
  readonly errorCode: "NO_MAIN_FILE" | null;
  readonly errorMessage: string | null;
}

export interface ExpandLatexProjectInput {
  readonly mainFile: string;
  readonly files: ReadonlyMap<string, string> | Readonly<Record<string, string>>;
  readonly isArchive?: boolean;
  readonly report?: ImportQualityReport;
}

export interface ExpandLatexProjectResult {
  readonly expandedText: string;
  readonly expandedBytes: number;
  readonly mainFile: string;
  readonly includedFiles: readonly string[];
  readonly offsetMap: TexOffsetMap;
  readonly documentKind: "single_file" | "multi_file";
  readonly editable: boolean;
  readonly limitReached: "INPUT_EXPANSION_LIMIT" | "INPUT_DEPTH_LIMIT" | null;
  readonly limitMessage: string | null;
  readonly unexpandedFiles: readonly string[];
  readonly cyclesDetected: readonly string[];
  readonly report: ImportQualityReport;
}

export interface IngestLatexProjectInput {
  readonly files: ReadonlyMap<string, string> | Readonly<Record<string, string>>;
  readonly mainFile?: string;
  readonly isArchive?: boolean;
  readonly report?: ImportQualityReport;
}

export interface IngestLatexProjectResult {
  readonly ok: boolean;
  readonly errorCode: "NO_MAIN_FILE" | null;
  readonly errorMessage: string | null;
  readonly mainCandidates: readonly string[];
  readonly expansion: ExpandLatexProjectResult | null;
  readonly bibFilesUsed: readonly string[];
  readonly bibStyle?: string;
  readonly bibRecords: readonly IngestedBibRecord[];
  readonly bibliographyEntries: readonly BibliographyEntry[];
  readonly bibWarnings: readonly string[];
  readonly skippedBibEntries: number;
  readonly report: ImportQualityReport;
}

function isAsciiLetterCode(cu: number): boolean {
  return (cu >= 65 && cu <= 90) || (cu >= 97 && cu <= 122);
}

function isWhitespaceCode(cu: number): boolean {
  return cu === 32 || cu === 9 || cu === 10 || cu === 13;
}

function asciiLower(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i += 1) {
    const cu = text.charCodeAt(i);
    out += cu >= 65 && cu <= 90 ? String.fromCharCode(cu + 32) : text.charAt(i);
  }
  return out;
}

function toFileMap(
  input: ReadonlyMap<string, string> | Readonly<Record<string, string>>,
): Map<string, string> {
  const out = new Map<string, string>();
  if (input instanceof Map) {
    for (const [k, v] of input.entries()) {
      const normP = normalizeArchivePath(k);
      out.set(normP.ok ? normP.path : k, v);
    }
  } else {
    const rec = input as Readonly<Record<string, string>>;
    for (const k of Object.keys(rec)) {
      const normP = normalizeArchivePath(k);
      out.set(normP.ok ? normP.path : k, rec[k]!);
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

function isCommentPercent(src: string, pos: number): boolean {
  if (src.charCodeAt(pos) !== 37 /* '%' */) return false;
  let bs = 0;
  let k = pos - 1;
  while (k >= 0 && src.charCodeAt(k) === 92 /* '\\' */) {
    bs += 1;
    k -= 1;
  }
  return bs % 2 === 0;
}

function skipLatexLineComment(src: string, percentPos: number): number {
  let p = percentPos + 1;
  while (p < src.length && src.charCodeAt(p) !== 10 && src.charCodeAt(p) !== 13) {
    p += 1;
  }
  return p;
}

function skipOptionalBrackets(src: string, pos: number): number {
  let i = pos;
  const n = src.length;
  while (i < n && isWhitespaceCode(src.charCodeAt(i))) i += 1;
  while (i < n && src.charCodeAt(i) === 91 /* '[' */) {
    let depth = 1;
    i += 1;
    while (i < n && depth > 0) {
      const cu = src.charCodeAt(i);
      if (cu === 92) {
        i += 2;
        continue;
      }
      if (cu === 91) depth += 1;
      else if (cu === 93) depth -= 1;
      i += 1;
    }
    while (i < n && isWhitespaceCode(src.charCodeAt(i))) i += 1;
  }
  return i;
}

function readBracedArg(
  src: string,
  pos: number,
): { readonly arg: string; readonly end: number } | null {
  let i = pos;
  const n = src.length;
  while (i < n && isWhitespaceCode(src.charCodeAt(i))) i += 1;
  if (i >= n || src.charCodeAt(i) !== 123 /* '{' */) return null;
  let depth = 0;
  const startInner = i + 1;
  while (i < n) {
    const cu = src.charCodeAt(i);
    if (cu === 92) {
      i += 2;
      continue;
    }
    if (cu === 123) depth += 1;
    else if (cu === 125) {
      depth -= 1;
      if (depth === 0) {
        return { arg: src.slice(startInner, i).trim(), end: i + 1 };
      }
    }
    i += 1;
  }
  return null;
}

function isIfStarter(cmd: string): boolean {
  if (!cmd.startsWith("if") || cmd.length < 3) return false;
  if (cmd === "iff") return false;
  return true;
}

/**
 * Single-pass O(n) scanner for LaTeX structural inclusion and bibliography directives
 * skipping `%` comments, `verbatim`-like environments, and `\iffalse...\fi` blocks (`03` §5.2 steps 2–4).
 */
function scanTexFileDirectives(source: string): ScannedTexFile {
  const directives: TexDirectiveToken[] = [];
  let hasDocumentClass = false;
  let hasBeginDocument = false;
  let hasIncludeDirective = false;

  const n = source.length;
  let i = 0;
  let ifFalseDepth = 0;
  let activeVerbatimEnv: string | null = null;

  while (i < n) {
    const cu = source.charCodeAt(i);
    if (cu === 37 && isCommentPercent(source, i)) {
      i = skipLatexLineComment(source, i);
      continue;
    }
    if (cu !== 92 /* '\\' */) {
      i += 1;
      continue;
    }

    if (i + 1 >= n) break;
    if (!isAsciiLetterCode(source.charCodeAt(i + 1))) {
      i += 2;
      continue;
    }

    let cmdEnd = i + 1;
    while (cmdEnd < n && isAsciiLetterCode(source.charCodeAt(cmdEnd))) cmdEnd += 1;
    const cmd = source.slice(i + 1, cmdEnd);

    if (activeVerbatimEnv !== null) {
      if (cmd === "end") {
        const grp = readBracedArg(source, cmdEnd);
        if (grp !== null && grp.arg === activeVerbatimEnv) {
          activeVerbatimEnv = null;
          i = grp.end;
          continue;
        }
      }
      i = cmdEnd;
      continue;
    }

    if (ifFalseDepth > 0) {
      if (cmd === "fi") {
        ifFalseDepth -= 1;
      } else if (isIfStarter(cmd)) {
        ifFalseDepth += 1;
      }
      i = cmdEnd;
      continue;
    }

    if (cmd === "iffalse") {
      ifFalseDepth = 1;
      i = cmdEnd;
      continue;
    }

    if (cmd === "begin") {
      const grp = readBracedArg(source, cmdEnd);
      if (grp !== null) {
        if (grp.arg === "document") {
          hasBeginDocument = true;
          directives.push({ kind: "begin_document", start: i, end: grp.end, arg: "document" });
        } else if (VERBATIM_LIKE_ENVS.has(grp.arg)) {
          activeVerbatimEnv = grp.arg;
        }
        i = grp.end;
        continue;
      }
    } else if (cmd === "documentclass") {
      const afterOpt = skipOptionalBrackets(source, cmdEnd);
      const grp = readBracedArg(source, afterOpt);
      hasDocumentClass = true;
      directives.push({
        kind: "documentclass",
        start: i,
        end: grp !== null ? grp.end : cmdEnd,
        arg: grp !== null ? grp.arg : "",
      });
      i = grp !== null ? grp.end : cmdEnd;
      continue;
    } else if (cmd === "input" || cmd === "include" || cmd === "subfile") {
      const grp = readBracedArg(source, cmdEnd);
      if (grp !== null && grp.arg.length > 0) {
        hasIncludeDirective = true;
        directives.push({ kind: "include", start: i, end: grp.end, arg: grp.arg });
        i = grp.end;
        continue;
      }
      // Also support unbraced `\input filename` (plain TeX form)
      let p = cmdEnd;
      while (p < n && (source.charCodeAt(p) === 32 || source.charCodeAt(p) === 9)) p += 1;
      if (p < n && source.charCodeAt(p) !== 123 && !isWhitespaceCode(source.charCodeAt(p))) {
        const argStart = p;
        while (p < n && !isWhitespaceCode(source.charCodeAt(p)) && source.charCodeAt(p) !== 37) {
          p += 1;
        }
        const rawArg = source.slice(argStart, p).trim();
        if (rawArg.length > 0) {
          hasIncludeDirective = true;
          directives.push({ kind: "include", start: i, end: p, arg: rawArg });
          i = p;
          continue;
        }
      }
    } else if (cmd === "bibliography" || cmd === "addbibresource") {
      const afterOpt = skipOptionalBrackets(source, cmdEnd);
      const grp = readBracedArg(source, afterOpt);
      if (grp !== null && grp.arg.length > 0) {
        directives.push({
          kind: cmd === "bibliography" ? "bibliography" : "addbibresource",
          start: i,
          end: grp.end,
          arg: grp.arg,
        });
        i = grp.end;
        continue;
      }
    }

    i = cmdEnd;
  }

  return {
    directives,
    hasDocumentClass,
    hasBeginDocument,
    hasIncludeDirective,
  };
}

function isTexFilePath(path: string): boolean {
  return asciiLower(path).endsWith(".tex");
}

/**
 * Selects the main `.tex` file containing both `\documentclass` and `\begin{document}`
 * outside comments, `verbatim`-like environments, and `\iffalse...\fi` (`03` §5.2 step 2).
 */
export function findMainTexFile(
  filesInput: ReadonlyMap<string, string> | Readonly<Record<string, string>>,
): MainTexResolution {
  const files = toFileMap(filesInput);
  const candidates: string[] = [];

  for (const [path, content] of files.entries()) {
    if (!isTexFilePath(path)) continue;
    const scanned = scanTexFileDirectives(content);
    if (scanned.hasDocumentClass && scanned.hasBeginDocument) {
      candidates.push(path);
    }
  }

  candidates.sort((a, b) => {
    const aLower = asciiLower(a);
    const bLower = asciiLower(b);
    const aRootMain = aLower === "main.tex" ? 0 : aLower.endsWith("/main.tex") ? 1 : 2;
    const bRootMain = bLower === "main.tex" ? 0 : bLower.endsWith("/main.tex") ? 1 : 2;
    if (aRootMain !== bRootMain) return aRootMain - bRootMain;
    const lenDiff = (files.get(b)?.length ?? 0) - (files.get(a)?.length ?? 0);
    if (lenDiff !== 0) return lenDiff;
    return compareCodeUnits(a, b);
  });

  if (candidates.length === 0) {
    return {
      ok: false,
      mainFile: null,
      candidates: [],
      errorCode: "NO_MAIN_FILE",
      errorMessage: INGESTION_COPY.noMainFile,
    };
  }

  return {
    ok: true,
    mainFile: candidates[0]!,
    candidates,
    errorCode: null,
    errorMessage: null,
  };
}

function computeLineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10 /* '\n' */) {
      starts.push(i + 1);
    }
  }
  return starts;
}

function resolveRelativePath(baseFile: string, targetRaw: string, defaultExt: string): string | null {
  let cleanTarget = targetRaw.trim().split("\\").join("/");
  if (cleanTarget.length === 0) return null;
  while (cleanTarget.startsWith("./")) cleanTarget = cleanTarget.slice(2);
  if (cleanTarget.startsWith("/")) return null;
  if (cleanTarget.length >= 2 && cleanTarget.charCodeAt(1) === 58) return null;

  const hasExt = cleanTarget.includes(".") && cleanTarget.lastIndexOf(".") > cleanTarget.lastIndexOf("/");
  const withExt = hasExt ? cleanTarget : `${cleanTarget}${defaultExt}`;

  const lastSlash = baseFile.lastIndexOf("/");
  const baseDirParts = lastSlash >= 0 ? baseFile.slice(0, lastSlash).split("/").filter((s) => s.length > 0) : [];
  const targetParts = withExt.split("/");
  const combined = [...baseDirParts];
  for (const part of targetParts) {
    if (part.length === 0 || part === ".") continue;
    if (part === "..") {
      if (combined.length === 0) return null;
      combined.pop();
    } else {
      combined.push(part);
    }
  }
  return combined.length > 0 ? combined.join("/") : null;
}

function resolveIncludeCandidate(
  files: ReadonlyMap<string, string>,
  currentFile: string,
  targetRaw: string,
): string | null {
  const withExt = asciiLower(targetRaw.trim()).endsWith(".tex")
    ? targetRaw.trim()
    : `${targetRaw.trim()}.tex`;
  const rel = resolveRelativePath(currentFile, targetRaw, ".tex");
  if (rel !== null && files.has(rel)) return rel;
  const rootRel = normalizeArchivePath(withExt);
  if (rootRel.ok && files.has(rootRel.path)) return rootRel.path;
  return null;
}

/**
 * Recursively expands `\input`, `\include`, and `\subfile` with memoized per-file scanning,
 * depth <= 10, cycle guard, 2 MB total expansion cap, and bidirectional offset map (`03` §5.2 step 3).
 */
export function expandLatexProject(input: ExpandLatexProjectInput): ExpandLatexProjectResult {
  const files = toFileMap(input.files);
  const report = cloneReport(input.report);
  const scanCache = new Map<string, ScannedTexFile>();
  const lineStartsCache: Record<string, number[]> = {};

  const getScanned = (file: string, content: string): ScannedTexFile => {
    let hit = scanCache.get(file);
    if (hit === undefined) {
      hit = scanTexFileDirectives(content);
      scanCache.set(file, hit);
      lineStartsCache[file] = computeLineStarts(content);
    }
    return hit;
  };

  const segments: TexOffsetSegment[] = [];
  const chunks: string[] = [];
  const includedFiles: string[] = [];
  const unexpandedFiles: string[] = [];
  const cyclesDetected: string[] = [];
  const activeStack = new Set<string>();
  let globalCursor = 0;
  let totalExpandedBytes = 0;
  let limitReached: "INPUT_EXPANSION_LIMIT" | "INPUT_DEPTH_LIMIT" | null = null;
  let anyIncludeDirective = false;

  const recordUnexpanded = (name: string): void => {
    if (!unexpandedFiles.includes(name)) unexpandedFiles.push(name);
    if (!report.unresolvedInputs.includes(name)) report.unresolvedInputs.push(name);
  };

  const appendSegment = (
    file: string,
    content: string,
    start: number,
    end: number,
    onBytesEmitted?: () => void,
  ): boolean => {
    if (end <= start) return true;
    const slice = content.slice(start, end);
    const sliceBytes = utf8ByteLength(slice);
    if (totalExpandedBytes + sliceBytes > MAX_INPUT_EXPANDED_BYTES) {
      limitReached = "INPUT_EXPANSION_LIMIT";
      return false;
    }
    chunks.push(slice);
    segments.push({
      globalStart: globalCursor,
      globalEnd: globalCursor + slice.length,
      file,
      localStart: start,
      localEnd: end,
    });
    globalCursor += slice.length;
    totalExpandedBytes += sliceBytes;
    if (onBytesEmitted !== undefined) onBytesEmitted();
    return true;
  };

  const expandFile = (file: string, depth: number, insertAt?: number): boolean => {
    const content = files.get(file);
    if (content === undefined) return true;
    const scanned = getScanned(file, content);
    if (scanned.hasIncludeDirective) anyIncludeDirective = true;
    let expandedAnyBytes = false;
    const markEmitted = (): void => {
      expandedAnyBytes = true;
    };
    const recordIncludedIfReached = (succeeded: boolean): void => {
      if (file === input.mainFile || (!succeeded && !expandedAnyBytes)) return;
      if (!includedFiles.includes(file)) {
        const idx = insertAt !== undefined && insertAt <= includedFiles.length ? insertAt : includedFiles.length;
        includedFiles.splice(idx, 0, file);
      }
    };

    const recordRemainingIncludes = (startIdx: number): void => {
      for (let r = startIdx; r < scanned.directives.length; r += 1) {
        const rem = scanned.directives[r]!;
        if (rem.kind !== "include") continue;
        recordUnexpanded(resolveIncludeCandidate(files, file, rem.arg) ?? rem.arg);
      }
    };

    activeStack.add(file);
    let localPos = 0;

    for (let idx = 0; idx < scanned.directives.length; idx += 1) {
      const dir = scanned.directives[idx]!;
      if (dir.kind !== "include") continue;
      if (!appendSegment(file, content, localPos, dir.start, markEmitted)) {
        recordRemainingIncludes(idx);
        recordIncludedIfReached(false);
        activeStack.delete(file);
        return false;
      }
      localPos = dir.end;

      const resolved = resolveIncludeCandidate(files, file, dir.arg);
      if (resolved === null) {
        recordUnexpanded(dir.arg);
        continue;
      }
      if (activeStack.has(resolved)) {
        if (!cyclesDetected.includes(resolved)) cyclesDetected.push(resolved);
        if (!report.unresolvedInputs.includes(resolved)) report.unresolvedInputs.push(resolved);
        continue;
      }
      if (depth + 1 > MAX_INPUT_DEPTH) {
        if (limitReached === null) limitReached = "INPUT_DEPTH_LIMIT";
        recordUnexpanded(resolved);
        continue;
      }

      const childInsertAt = includedFiles.length;
      const cont = expandFile(resolved, depth + 1, childInsertAt);
      if (!cont) {
        recordUnexpanded(resolved);
        recordRemainingIncludes(idx + 1);
        recordIncludedIfReached(false);
        activeStack.delete(file);
        return false;
      }
    }

    const tailOk = appendSegment(file, content, localPos, content.length, markEmitted);
    recordIncludedIfReached(tailOk);
    activeStack.delete(file);
    return tailOk;
  };

  const mainContent = files.get(input.mainFile);
  if (mainContent !== undefined) {
    expandFile(input.mainFile, 0);
  }

  const isMultiFile =
    (input.isArchive ?? false) || includedFiles.length > 0 || anyIncludeDirective;

  return {
    expandedText: chunks.join(""),
    expandedBytes: totalExpandedBytes,
    mainFile: input.mainFile,
    includedFiles,
    offsetMap: {
      segments,
      fileLineStarts: lineStartsCache,
    },
    documentKind: isMultiFile ? "multi_file" : "single_file",
    editable: !isMultiFile,
    limitReached,
    limitMessage:
      limitReached === "INPUT_EXPANSION_LIMIT" ? INGESTION_COPY.inputExpansionLimit : null,
    unexpandedFiles,
    cyclesDetected,
    report,
  };
}

function findLineAndColumn(lineStarts: readonly number[], localOffset: number): {
  readonly line: number;
  readonly column: number;
} {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lineStarts[mid]! <= localOffset) {
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  const lineIdx = Math.max(0, hi);
  return {
    line: lineIdx + 1,
    column: localOffset - lineStarts[lineIdx]! + 1,
  };
}

/**
 * Maps a character offset in `expandedText` back to `(file, 1-based line, 1-based column, localOffset)`
 * via O(log k) binary search over offset segments (`03` §5.2 step 3, `AC-L0-10`).
 */
export function globalToFileLine(
  map: TexOffsetMap,
  globalOffset: number,
): FileLinePosition | null {
  const segs = map.segments;
  if (segs.length === 0 || globalOffset < 0) return null;

  let lo = 0;
  let hi = segs.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const seg = segs[mid]!;
    if (globalOffset < seg.globalStart) {
      hi = mid - 1;
    } else if (globalOffset >= seg.globalEnd) {
      lo = mid + 1;
    } else {
      const localOffset = seg.localStart + (globalOffset - seg.globalStart);
      const starts = map.fileLineStarts[seg.file] ?? [0];
      const lc = findLineAndColumn(starts, localOffset);
      return {
        file: seg.file,
        line: lc.line,
        column: lc.column,
        localOffset,
      };
    }
  }

  // Handle exact end-of-document boundary
  const last = segs[segs.length - 1]!;
  if (globalOffset === last.globalEnd) {
    const localOffset = last.localEnd;
    const starts = map.fileLineStarts[last.file] ?? [0];
    const lc = findLineAndColumn(starts, localOffset);
    return {
      file: last.file,
      line: lc.line,
      column: lc.column,
      localOffset,
    };
  }
  return null;
}

/**
 * Maps `(file, localOffset)` back to every matching `globalOffset` in `expandedText`
 * (supports files included more than once cleanly).
 */
export function fileOffsetToGlobal(
  map: TexOffsetMap,
  file: string,
  localOffset: number,
): number[] {
  const out: number[] = [];
  for (const seg of map.segments) {
    if (seg.file === file && localOffset >= seg.localStart && localOffset < seg.localEnd) {
      out.push(seg.globalStart + (localOffset - seg.localStart));
    }
  }
  return out;
}

export function fileLineToGlobal(
  map: TexOffsetMap,
  file: string,
  line: number,
  column = 1,
): number[] {
  const starts = map.fileLineStarts[file];
  if (starts === undefined || line < 1 || line > starts.length) return [];
  const lineStart = starts[line - 1]!;
  const localOffset = lineStart + Math.max(0, column - 1);
  return fileOffsetToGlobal(map, file, localOffset);
}

/**
 * Resolves declared bibliography files from `\bibliography{a,b}` and `\addbibresource{x.bib}`
 * outside comments/verbatim/`\iffalse`; falls back to all `.bib` files when none are declared (`03` §5.2 step 4).
 */
export function discoverBibFiles(
  expandedText: string,
  availableFiles: readonly string[],
  mainFile?: string,
): string[] {
  const scanned = scanTexFileDirectives(expandedText);
  const declaredNames: string[] = [];

  for (const dir of scanned.directives) {
    if (dir.kind === "bibliography") {
      const parts = dir.arg.split(",");
      for (const p of parts) {
        const trimmed = p.trim();
        if (trimmed.length === 0) continue;
        const withExt = asciiLower(trimmed).endsWith(".bib") ? trimmed : `${trimmed}.bib`;
        if (!declaredNames.includes(withExt)) declaredNames.push(withExt);
      }
    } else if (dir.kind === "addbibresource") {
      const trimmed = dir.arg.trim();
      if (trimmed.length > 0) {
        const withExt = asciiLower(trimmed).endsWith(".bib") ? trimmed : `${trimmed}.bib`;
        if (!declaredNames.includes(withExt)) declaredNames.push(withExt);
      }
    }
  }

  const allBibs = availableFiles
    .filter((f) => asciiLower(f).endsWith(".bib"))
    .sort(compareCodeUnits);

  if (declaredNames.length === 0) {
    return allBibs;
  }

  const matched: string[] = [];
  for (const decl of declaredNames) {
    const declNorm = mainFile !== undefined ? resolveRelativePath(mainFile, decl, ".bib") : null;
    const declLower = normLower(decl);
    let found: string | undefined;
    if (declNorm !== null) {
      found = allBibs.find((f) => f === declNorm || normLower(f) === normLower(declNorm));
    }
    if (found === undefined) {
      found = allBibs.find(
        (f) => f === decl || normLower(f) === declLower || normLower(f).endsWith(`/${declLower}`),
      );
    }
    if (found !== undefined && !matched.includes(found)) {
      matched.push(found);
    }
  }
  return matched;
}

/**
 * End-to-end pure LaTeX project ingestion (`03` §5.2 steps 2–6).
 */
export function ingestLatexProject(input: IngestLatexProjectInput): IngestLatexProjectResult {
  const files = toFileMap(input.files);
  const baseReport = cloneReport(input.report);
  if (baseReport.filesRead === 0) {
    baseReport.filesRead = files.size;
  }

  let mainFile = input.mainFile ?? null;
  let mainCandidates: readonly string[] = [];
  if (mainFile === null) {
    const resolvedMain = findMainTexFile(files);
    if (!resolvedMain.ok || resolvedMain.mainFile === null) {
      return {
        ok: false,
        errorCode: "NO_MAIN_FILE",
        errorMessage: resolvedMain.errorMessage ?? INGESTION_COPY.noMainFile,
        mainCandidates: resolvedMain.candidates,
        expansion: null,
        bibFilesUsed: [],
        bibRecords: [],
        bibliographyEntries: [],
        bibWarnings: [],
        skippedBibEntries: 0,
        report: baseReport,
      };
    }
    mainFile = resolvedMain.mainFile;
    mainCandidates = resolvedMain.candidates;
  } else {
    mainCandidates = [mainFile];
  }

  const expansion = expandLatexProject({
    mainFile,
    files,
    ...(input.isArchive !== undefined ? { isArchive: input.isArchive } : {}),
    report: baseReport,
  });

  const availablePaths = [...files.keys()].sort(compareCodeUnits);
  const bibFilesUsed = discoverBibFiles(expansion.expandedText, availablePaths, mainFile);
  const rawRecords: IngestedBibRecord[] = [];
  const bibWarnings: string[] = [];
  let skippedBibEntries = 0;

  if (bibFilesUsed.length > 0) {
    for (const bibPath of bibFilesUsed) {
      const bibText = files.get(bibPath);
      if (bibText === undefined) continue;
      const parsed = parseBibTex(bibText);
      rawRecords.push(...parsed.records);
      bibWarnings.push(...parsed.warnings);
      skippedBibEntries += parsed.skippedEntries;
    }
  } else {
    // Fallback to \bibitem / .bbl (`03` §5.2 step 6)
    const fromExpanded = parseBibItems(expansion.expandedText);
    if (fromExpanded.records.length > 0) {
      rawRecords.push(...fromExpanded.records);
      bibWarnings.push(...fromExpanded.warnings);
      skippedBibEntries += fromExpanded.skippedEntries;
    } else {
      const bblPaths = availablePaths.filter((p) => asciiLower(p).endsWith(".bbl"));
      for (const bblPath of bblPaths) {
        const bblText = files.get(bblPath);
        if (bblText === undefined) continue;
        const parsedBbl = parseBibItems(bblText);
        rawRecords.push(...parsedBbl.records);
        bibWarnings.push(...parsedBbl.warnings);
        skippedBibEntries += parsedBbl.skippedEntries;
      }
    }
  }

  const deduped = deduplicateBibRecords(rawRecords);
  const bibStyle = extractLatexBibStyle(expansion.expandedText);

  return {
    ok: true,
    errorCode: null,
    errorMessage: null,
    mainCandidates,
    expansion,
    bibFilesUsed,
    ...(bibStyle !== undefined ? { bibStyle } : {}),
    bibRecords: deduped.records,
    bibliographyEntries: toBibliographyEntries(deduped.records),
    bibWarnings,
    skippedBibEntries,
    report: expansion.report,
  };
}
