/**
 * Pure Pandoc Markdown Document & Front Matter Ingestion (`03` §5.2 step 7, §5.5).
 *
 * Pure TypeScript: zero Node I/O, DOM, network, clock, or regex usage.
 */

import { compareCodeUnits } from "../bm25.js";
import {
  extractMarkdownNumberedReferences,
  type BibliographyEntry,
  type MarkdownNumberedRef,
} from "../citations.js";
import { preMask, type PreMaskResult } from "../mask.js";
import { normLower } from "../norm.js";
import { createEmptyImportQualityReport, type ImportQualityReport } from "../sections.js";
import {
  assignDeterministicRefId,
  deduplicateBibRecords,
  parseBibTex,
  parseCslJson,
  parseRis,
  toBibliographyEntries,
  type IngestedBibRecord,
} from "./bib.js";
import { normalizeArchivePath } from "./zip.js";

export interface PandocFrontMatter {
  readonly bibliography: readonly string[];
  readonly lang?: string;
  readonly math?: boolean;
  readonly csl?: string;
}

export interface IngestMarkdownInput {
  readonly fileName?: string;
  readonly text: string;
  readonly siblingFiles?: ReadonlyMap<string, string> | Readonly<Record<string, string>>;
  readonly report?: ImportQualityReport;
}

export interface IngestMarkdownResult {
  readonly text: string;
  readonly documentKind: "single_file";
  readonly editable: true;
  readonly frontMatter: PandocFrontMatter;
  readonly preMaskResult: PreMaskResult;
  readonly bibFilesUsed: readonly string[];
  readonly bibRecords: readonly IngestedBibRecord[];
  readonly bibliographyEntries: readonly BibliographyEntry[];
  readonly markdownNumberedRefs: readonly MarkdownNumberedRef[];
  readonly report: ImportQualityReport;
}

function asciiLower(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i += 1) {
    const cu = text.charCodeAt(i);
    out += cu >= 65 && cu <= 90 ? String.fromCharCode(cu + 32) : text.charAt(i);
  }
  return out;
}

function stripYamlQuotes(raw: string): string {
  const s = raw.trim();
  if (s.length >= 2) {
    const c0 = s.charCodeAt(0);
    const c1 = s.charCodeAt(s.length - 1);
    if ((c0 === 34 && c1 === 34) || (c0 === 39 && c1 === 39)) {
      return s.slice(1, s.length - 1).trim();
    }
  }
  return s;
}

function splitLines(text: string): string[] {
  const lines: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const cu = text.charCodeAt(i);
    if (cu === 10 || cu === 13) {
      lines.push(text.slice(start, i));
      if (cu === 13 && i + 1 < text.length && text.charCodeAt(i + 1) === 10) i += 1;
      start = i + 1;
    }
  }
  lines.push(text.slice(start));
  return lines;
}

function stripYamlInlineComment(raw: string): string {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < raw.length; i += 1) {
    const cu = raw.charCodeAt(i);
    if (inDouble && cu === 92 /* '\\' */) {
      i += 1;
      continue;
    }
    if (cu === 39 /* '\'' */ && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (cu === 34 /* '"' */ && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    if (cu === 35 /* '#' */ && !inSingle && !inDouble) {
      if (i === 0) return "";
      const prev = raw.charCodeAt(i - 1);
      if (prev === 32 || prev === 9) {
        return raw.slice(0, i).trim();
      }
    }
  }
  return raw.trim();
}

/**
 * Pure O(n) parser for Pandoc YAML front matter keys `bibliography:`, `lang:`, `math:`, `csl:` (`03` §5.2 step 7).
 */
export function parsePandocFrontMatter(markdownText: string): PandocFrontMatter {
  const lines = splitLines(markdownText);
  if (lines.length === 0 || lines[0]!.trim() !== "---") {
    return { bibliography: [] };
  }

  const bibliography: string[] = [];
  let lang: string | undefined;
  let math: boolean | undefined;
  let csl: string | undefined;
  let inBibList = false;

  for (let idx = 1; idx < lines.length; idx += 1) {
    const rawLine = lines[idx]!;
    const trimmed = rawLine.trim();
    if (trimmed === "---" || trimmed === "...") {
      break;
    }
    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      continue;
    }

    if (inBibList) {
      if (trimmed.startsWith("-")) {
        const item = stripYamlQuotes(stripYamlInlineComment(trimmed.slice(1)));
        if (item.length > 0 && !bibliography.includes(item)) {
          bibliography.push(item);
        }
        continue;
      }
      if (!rawLine.startsWith(" ") && !rawLine.startsWith("\t")) {
        inBibList = false;
      } else {
        continue;
      }
    }

    const colon = trimmed.indexOf(":");
    if (colon === -1) continue;
    const key = asciiLower(trimmed.slice(0, colon).trim());
    const valRaw = stripYamlInlineComment(trimmed.slice(colon + 1));

    if (key === "bibliography") {
      if (valRaw.length === 0) {
        inBibList = true;
      } else if (valRaw.startsWith("[") && valRaw.endsWith("]")) {
        const inner = valRaw.slice(1, valRaw.length - 1);
        for (const p of inner.split(",")) {
          const item = stripYamlQuotes(stripYamlInlineComment(p));
          if (item.length > 0 && !bibliography.includes(item)) bibliography.push(item);
        }
      } else {
        const item = stripYamlQuotes(valRaw);
        if (item.length > 0 && !bibliography.includes(item)) bibliography.push(item);
      }
    } else if (key === "lang") {
      const v = stripYamlQuotes(valRaw);
      if (v.length > 0) lang = v;
    } else if (key === "math") {
      const lower = asciiLower(stripYamlQuotes(valRaw));
      if (lower === "true") math = true;
      else if (lower === "false") math = false;
    } else if (key === "csl") {
      const v = stripYamlQuotes(valRaw);
      if (v.length > 0) csl = v;
    }
  }

  return {
    bibliography,
    ...(lang !== undefined ? { lang } : {}),
    ...(math !== undefined ? { math } : {}),
    ...(csl !== undefined ? { csl } : {}),
  };
}

function toFileMap(
  input?: ReadonlyMap<string, string> | Readonly<Record<string, string>>,
): Map<string, string> {
  const out = new Map<string, string>();
  if (input === undefined) return out;
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

function parseBibByExtension(path: string, content: string): readonly IngestedBibRecord[] {
  const lower = asciiLower(path);
  if (lower.endsWith(".ris")) return parseRis(content).records;
  if (lower.endsWith(".json") || lower.endsWith(".csljson")) return parseCslJson(content).records;
  return parseBibTex(content).records;
}

/**
 * Pure Pandoc Markdown ingestion (`03` §5.2 step 7, §5.5).
 */
export function ingestMarkdownDocument(input: IngestMarkdownInput): IngestMarkdownResult {
  const report = cloneReport(input.report);
  const siblings = toFileMap(input.siblingFiles);
  if (report.filesRead === 0) {
    report.filesRead = 1 + siblings.size;
  }

  const frontMatter = parsePandocFrontMatter(input.text);
  const preMaskResult = preMask(input.text, "md", {
    ...(frontMatter.math !== undefined ? { frontMatterMath: frontMatter.math } : {}),
    report,
  });
  const markdownNumberedRefs = extractMarkdownNumberedReferences(input.text, preMaskResult);

  const siblingKeys = [...siblings.keys()].sort(compareCodeUnits);
  const bibFilesUsed: string[] = [];
  const rawRecords: IngestedBibRecord[] = [];

  if (frontMatter.bibliography.length > 0) {
    for (const rawDecl of frontMatter.bibliography) {
      const normRes = normalizeArchivePath(rawDecl);
      const decl = normRes.ok ? normRes.path : rawDecl.trim();
      const candidates = [decl];
      const declLowerPre = asciiLower(decl);
      if (
        !declLowerPre.endsWith(".bib") &&
        !declLowerPre.endsWith(".ris") &&
        !declLowerPre.endsWith(".json")
      ) {
        candidates.push(`${decl}.bib`);
      }
      let hit: string | undefined;
      for (const cand of candidates) {
        const candLower = normLower(cand);
        hit = siblingKeys.find(
          (k) => k === cand || normLower(k) === candLower || normLower(k).endsWith(`/${candLower}`),
        );
        if (hit !== undefined) break;
      }
      if (hit !== undefined && !bibFilesUsed.includes(hit)) {
        bibFilesUsed.push(hit);
      }
    }
  } else {
    for (const k of siblingKeys) {
      const l = asciiLower(k);
      if (l.endsWith(".bib") || l.endsWith(".ris") || l.endsWith(".json")) {
        bibFilesUsed.push(k);
      }
    }
  }

  for (const bibPath of bibFilesUsed) {
    const content = siblings.get(bibPath);
    if (content === undefined) continue;
    rawRecords.push(...parseBibByExtension(bibPath, content));
  }

  if (rawRecords.length === 0 && markdownNumberedRefs.length > 0) {
    for (const nr of markdownNumberedRefs) {
      const key = String(nr.index);
      rawRecords.push({
        refId: assignDeterministicRefId({ raw: nr.text, key }),
        key,
        aliases: [key],
        sourceFormat: "raw_text",
        entryType: "raw",
        orderIndex: nr.index,
        doi: null,
        pmcid: null,
        arxivId: null,
        title: nr.text,
        authors: [],
        raw: nr.text,
      });
    }
  }

  const deduped = deduplicateBibRecords(rawRecords);
  return {
    text: input.text,
    documentKind: "single_file",
    editable: true,
    frontMatter,
    preMaskResult,
    bibFilesUsed,
    bibRecords: deduped.records,
    bibliographyEntries: toBibliographyEntries(deduped.records),
    markdownNumberedRefs,
    report: preMaskResult.report,
  };
}
