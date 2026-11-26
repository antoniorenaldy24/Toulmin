/**
 * Pure `.docx` WordprocessingML Importer (`word/document.xml` + `word/footnotes.xml`)
 * (`docs/spec/03_L0_TIER_B_VALIDATOR_B5_INGEST.md` §5.3, §5.5; `AC-L0-12`).
 *
 * Reads `parseXmlOrdered` ordered AST directly (no `mammoth` or `turndown`):
 * - headings (`Title`, `Heading1`..`Heading9`), paragraphs, runs, tabs, breaks, tables, OMML math, footnotes
 * - Zotero/Mendeley (`ADDIN ZOTERO_ITEM CSL_CITATION `, `ADDIN CSL_CITATION `), EndNote (`ADDIN EN.CITE` + base64 `EN.CITE.DATA`)
 * - Bibliography fields (`ADDIN ZOTERO_BIBL`, `ADDIN EN.REFLIST`, `ADDIN Mendeley Bibliography CSL_BIBLIOGRAPHY`)
 * - Unfielded `References` section raw reference extraction
 * - Superscript heuristic (`^digits` after digit or `DOCX_UNIT_TOKENS`, otherwise `[digits]`)
 *
 * Pure TypeScript: zero Node I/O, zero `atob`/`Buffer`, zero DOM/network/clock/regexes.
 */

import { parseXmlOrdered, type OrderedXmlNode } from "../chunk.js";
import type { AuthoritativeDocxMarker, BibliographyEntry } from "../citations.js";
import { norm, normLower } from "../norm.js";
import {
  createEmptyImportQualityReport,
  matchCanonicalSectionLabel,
  type ImportQualityReport,
} from "../sections.js";
import {
  assignDeterministicRefId,
  deduplicateBibRecords,
  normalizeArxivId,
  normalizeDoiVerbatim,
  normalizePmcid,
  toBibliographyEntries,
  type IngestedBibRecord,
  type ParsedAuthor,
} from "./bib.js";
import { utf8Decode } from "./zip.js";

export const DOCX_UNIT_TOKENS: ReadonlySet<string> = new Set([
  "m",
  "cm",
  "mm",
  "km",
  "g",
  "kg",
  "s",
  "L",
  "mL",
  "mol",
  "dm",
  "\u03bcm",
  "\u00b5m",
  "nm",
  "m2",
  "cm2",
  "10",
]);

export const DOCX_READONLY_BANNER =
  "This is a read-only audit copy of your Word file. Fix the original, then choose Re-import.";

export interface DocxFootnoteStream {
  readonly id: string;
  readonly paragraphs: readonly string[];
  readonly anchorOffset: number;
}

export interface IngestDocxXmlInput {
  readonly documentXml: string | readonly OrderedXmlNode[];
  readonly footnotesXml?: string | readonly OrderedXmlNode[];
  readonly report?: ImportQualityReport;
}

export interface IngestDocxResult {
  readonly markdownText: string;
  readonly footnoteStreams: readonly DocxFootnoteStream[];
  readonly docxMarkers: readonly AuthoritativeDocxMarker[];
  readonly bibRecords: readonly IngestedBibRecord[];
  readonly bibliographyEntries: readonly BibliographyEntry[];
  readonly rawReferences: readonly string[];
  readonly docxNumberedRefs: readonly string[];
  readonly documentKind: "multi_file";
  readonly editable: false;
  readonly bannerCopy: string;
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

function isDigitCode(cu: number): boolean {
  return cu >= 48 && cu <= 57;
}

function getTagAndChildren(node: OrderedXmlNode): {
  readonly rawTag: string;
  readonly children: readonly OrderedXmlNode[];
} | null {
  for (const key of Object.keys(node)) {
    if (key === ":@" || key === "#text") continue;
    const val = node[key];
    if (Array.isArray(val)) {
      return { rawTag: key, children: val as readonly OrderedXmlNode[] };
    }
  }
  return null;
}

function getAttr(node: OrderedXmlNode, name: string): string | null {
  const attrs = node[":@"];
  if (attrs === undefined) return null;
  const direct = attrs[`@_${name}`];
  if (typeof direct === "string") return direct;
  const colonIdx = name.indexOf(":");
  if (colonIdx !== -1) {
    const localOnly = name.slice(colonIdx + 1);
    for (const k of Object.keys(attrs)) {
      if (k === `@_${localOnly}` || k.endsWith(`:${localOnly}`)) {
        const v = attrs[k];
        if (typeof v === "string") return v;
      }
    }
  }
  return null;
}

function findFirstChild(children: readonly OrderedXmlNode[], tag: string): OrderedXmlNode | null {
  for (const ch of children) {
    const info = getTagAndChildren(ch);
    if (info !== null && info.rawTag === tag) return ch;
  }
  return null;
}

function collectNodeText(nodes: readonly OrderedXmlNode[], tagFilter?: string): string {
  const parts: string[] = [];
  const walk = (list: readonly OrderedXmlNode[], insideTarget: boolean): void => {
    for (const node of list) {
      const textVal = node["#text"];
      if (typeof textVal === "string" || typeof textVal === "number" || typeof textVal === "boolean") {
        if (insideTarget) parts.push(String(textVal));
        continue;
      }
      const info = getTagAndChildren(node);
      if (info === null) continue;
      const nextInside = tagFilter === undefined ? true : insideTarget || info.rawTag === tagFilter;
      walk(info.children, nextInside);
    }
  };
  walk(nodes, tagFilter === undefined);
  return parts.join("");
}

function base64CharValue(cu: number): number {
  if (cu >= 65 && cu <= 90) return cu - 65;
  if (cu >= 97 && cu <= 122) return cu - 71;
  if (cu >= 48 && cu <= 57) return cu + 4;
  if (cu === 43) return 62;
  if (cu === 47) return 63;
  return -1;
}

/**
 * Pure Base64 -> UTF-8 decoder (zero `atob`/`Buffer`, ignores whitespace).
 */
export function decodeBase64Utf8(b64: string): string {
  const vals: number[] = [];
  let padCount = 0;
  for (let i = 0; i < b64.length; i += 1) {
    const cu = b64.charCodeAt(i);
    if (cu === 61 /* '=' */) {
      padCount += 1;
      continue;
    }
    const v = base64CharValue(cu);
    if (v >= 0) vals.push(v);
  }
  const bytes: number[] = [];
  for (let i = 0; i + 3 < vals.length; i += 4) {
    const n = (vals[i]! << 18) | (vals[i + 1]! << 12) | (vals[i + 2]! << 6) | vals[i + 3]!;
    bytes.push((n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff);
  }
  const rem = vals.length % 4;
  const baseIdx = vals.length - rem;
  if (rem === 2) {
    const n = (vals[baseIdx]! << 18) | (vals[baseIdx + 1]! << 12);
    bytes.push((n >> 16) & 0xff);
  } else if (rem === 3) {
    const n = (vals[baseIdx]! << 18) | (vals[baseIdx + 1]! << 12) | (vals[baseIdx + 2]! << 6);
    bytes.push((n >> 16) & 0xff, (n >> 8) & 0xff);
  } else if (padCount > 0 && bytes.length >= padCount) {
    bytes.length -= Math.min(padCount, 2);
  }
  return utf8Decode(new Uint8Array(bytes));
}

function headingHashesForStyle(styleVal: string | null): number {
  if (styleVal === null) return 0;
  const lower = normLower(styleVal.trim());
  if (lower === "title") return 1;
  if (lower.startsWith("heading")) {
    const tail = lower.slice(7).trim();
    const num = Number(tail);
    if (Number.isInteger(num) && num >= 1 && num <= 9) {
      return num;
    }
  }
  return 0;
}

function stripLeadingMarkdownHashes(line: string): string {
  let i = 0;
  while (i < line.length && line.charCodeAt(i) === 35 /* '#' */) {
    i += 1;
  }
  return line.slice(i).trim();
}

function isSuperscriptOnlyDigitsAndPunct(text: string): boolean {
  let hasDigit = false;
  for (let i = 0; i < text.length; i += 1) {
    const cu = text.charCodeAt(i);
    if (isDigitCode(cu)) {
      hasDigit = true;
    } else if (cu !== 44 && cu !== 45 && cu !== 8211 && cu !== 32) {
      return false;
    }
  }
  return hasDigit;
}

function readTrailingTokenBeforeOffset(text: string): {
  readonly prevChar: string;
  readonly token: string;
} {
  if (text.length === 0) return { prevChar: "", token: "" };
  const prevChar = text.charAt(text.length - 1);
  let start = text.length;
  while (start > 0) {
    const cu = text.charCodeAt(start - 1);
    if (cu === 32 || cu === 9 || cu === 10 || cu === 13 || cu === 40 || cu === 91) break;
    start -= 1;
  }
  return { prevChar, token: text.slice(start) };
}

function isExponentSuperscript(precedingText: string): boolean {
  const { prevChar, token } = readTrailingTokenBeforeOffset(precedingText);
  if (prevChar.length > 0 && isDigitCode(prevChar.charCodeAt(0))) {
    return true;
  }
  return DOCX_UNIT_TOKENS.has(token);
}

interface ParsedFieldOutput {
  readonly records: readonly IngestedBibRecord[];
  readonly markerRefIds: readonly string[];
  readonly markerKeys: readonly string[];
  readonly isBibliographyField: boolean;
}

function extractCslItemsFromJson(jsonText: string): ParsedFieldOutput {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return { records: [], markerRefIds: [], markerKeys: [], isBibliographyField: false };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { records: [], markerRefIds: [], markerKeys: [], isBibliographyField: false };
  }
  const citationItems = (parsed as { readonly citationItems?: unknown }).citationItems;
  if (!Array.isArray(citationItems)) {
    return { records: [], markerRefIds: [], markerKeys: [], isBibliographyField: false };
  }

  const records: IngestedBibRecord[] = [];
  const markerRefIds: string[] = [];
  const markerKeys: string[] = [];

  for (let i = 0; i < citationItems.length; i += 1) {
    const ci = citationItems[i];
    if (typeof ci !== "object" || ci === null || Array.isArray(ci)) continue;
    const ciObj = ci as Record<string, unknown>;
    const itemData =
      typeof ciObj["itemData"] === "object" && ciObj["itemData"] !== null && !Array.isArray(ciObj["itemData"])
        ? (ciObj["itemData"] as Record<string, unknown>)
        : null;
    if (itemData === null) continue;

    const rawDoi =
      typeof itemData["DOI"] === "string"
        ? itemData["DOI"]
        : typeof itemData["doi"] === "string"
          ? itemData["doi"]
          : "";
    const doi = normalizeDoiVerbatim(rawDoi);
    const pmcid = normalizePmcid(typeof itemData["PMCID"] === "string" ? itemData["PMCID"] : "");
    const arxivId = normalizeArxivId(typeof itemData["arXiv"] === "string" ? itemData["arXiv"] : "");
    const title = typeof itemData["title"] === "string" ? norm(itemData["title"].trim()).text : "";
    const rawKey =
      typeof itemData["id"] === "string" || typeof itemData["id"] === "number"
        ? String(itemData["id"])
        : doi ?? `docx_csl_${String(i + 1)}`;

    let year: string | undefined;
    const issued = itemData["issued"];
    if (typeof issued === "object" && issued !== null && !Array.isArray(issued)) {
      const dp = (issued as { readonly "date-parts"?: unknown })["date-parts"];
      if (Array.isArray(dp) && Array.isArray(dp[0]) && dp[0].length > 0) {
        year = String(dp[0][0]);
      }
    }

    const authors: ParsedAuthor[] = [];
    if (Array.isArray(itemData["author"])) {
      for (const a of itemData["author"] as unknown[]) {
        if (typeof a !== "object" || a === null || Array.isArray(a)) continue;
        const ao = a as Record<string, unknown>;
        if (typeof ao["literal"] === "string" && ao["literal"].trim().length > 0) {
          const lit = norm(ao["literal"].trim()).text;
          authors.push({ family: lit, literal: lit, isCorporate: true });
        } else if (typeof ao["family"] === "string" && ao["family"].trim().length > 0) {
          const fam = norm(ao["family"].trim()).text;
          const giv = typeof ao["given"] === "string" ? norm(ao["given"].trim()).text : undefined;
          authors.push(giv !== undefined && giv.length > 0 ? { family: fam, given: giv } : { family: fam });
        }
      }
    }

    const refId = assignDeterministicRefId({ doi, pmcid, arxivId, key: rawKey, title });
    const first = authors[0];
    records.push({
      refId,
      key: rawKey,
      aliases: [rawKey],
      sourceFormat: "docx_field",
      entryType: typeof itemData["type"] === "string" ? itemData["type"] : "article",
      doi,
      pmcid,
      arxivId,
      title,
      authors,
      ...(first !== undefined && !first.isCorporate ? { firstAuthorFamily: first.family } : {}),
      ...(first !== undefined && first.isCorporate ? { corporateAuthor: first.family } : {}),
      ...(year !== undefined ? { year } : {}),
    });
    if (!markerRefIds.includes(refId)) markerRefIds.push(refId);
    if (!markerKeys.includes(rawKey)) markerKeys.push(rawKey);
  }

  return { records, markerRefIds, markerKeys, isBibliographyField: false };
}

function collectNodesByTag(nodes: readonly OrderedXmlNode[], tagName: string): OrderedXmlNode[] {
  const out: OrderedXmlNode[] = [];
  const targetLower = asciiLower(tagName);
  const walk = (list: readonly OrderedXmlNode[]): void => {
    for (const node of list) {
      const info = getTagAndChildren(node);
      if (info === null) continue;
      if (asciiLower(info.rawTag) === targetLower) out.push(node);
      walk(info.children);
    }
  };
  walk(nodes);
  return out;
}

function extractEndNoteRecords(xmlPayload: string): ParsedFieldOutput {
  const nodes = parseXmlOrdered(xmlPayload);
  const recordNodes = collectNodesByTag(nodes, "record");
  const records: IngestedBibRecord[] = [];
  const markerRefIds: string[] = [];
  const markerKeys: string[] = [];

  for (let i = 0; i < recordNodes.length; i += 1) {
    const recNode = recordNodes[i]!;
    const info = getTagAndChildren(recNode);
    if (info === null) continue;
    const recChildren = info.children;
    const recNum = collectNodesByTag(recChildren, "rec-number")
      .map((n) => collectNodeText([n]))
      .join("")
      .trim();
    const doiRaw = [
      ...collectNodesByTag(recChildren, "electronic-resource-num"),
      ...collectNodesByTag(recChildren, "doi"),
    ]
      .map((n) => collectNodeText([n]))
      .find((s) => s.trim().length > 0);
    const doi = doiRaw !== undefined ? normalizeDoiVerbatim(doiRaw) : null;
    const title = norm(
      collectNodesByTag(recChildren, "title")
        .map((n) => collectNodeText([n]))
        .join(" ")
        .trim(),
    ).text;
    const year = collectNodesByTag(recChildren, "year")
      .map((n) => collectNodeText([n]))
      .join("")
      .trim();
    const authors: ParsedAuthor[] = collectNodesByTag(recChildren, "author")
      .map((n) => norm(collectNodeText([n]).trim()).text)
      .filter((s) => s.length > 0)
      .map((s) => {
        const comma = s.indexOf(",");
        if (comma !== -1) {
          return { family: s.slice(0, comma).trim(), given: s.slice(comma + 1).trim() };
        }
        const parts = s.split(" ").filter((p) => p.length > 0);
        return parts.length > 1
          ? { family: parts[parts.length - 1]!, given: parts.slice(0, parts.length - 1).join(" ") }
          : { family: s };
      });
    const key = recNum.length > 0 ? `en_${recNum}` : doi ?? `en_${String(i + 1)}`;
    const refId = assignDeterministicRefId({ doi, key, title });
    const first = authors[0];

    records.push({
      refId,
      key,
      aliases: [key],
      sourceFormat: "docx_field",
      entryType: "article",
      doi,
      pmcid: null,
      arxivId: null,
      title,
      authors,
      ...(first !== undefined ? { firstAuthorFamily: first.family } : {}),
      ...(year.length > 0 ? { year } : {}),
    });
    if (!markerRefIds.includes(refId)) markerRefIds.push(refId);
    if (!markerKeys.includes(key)) markerKeys.push(key);
  }

  return { records, markerRefIds, markerKeys, isBibliographyField: false };
}

function parseDocxFieldInstruction(rawInstr: string): ParsedFieldOutput {
  const instr = rawInstr.trim();
  const zoteroPrefix = "ADDIN ZOTERO_ITEM CSL_CITATION ";
  const mendeleyPrefix = "ADDIN CSL_CITATION ";

  if (instr.startsWith("ADDIN ZOTERO_BIBL") || instr.startsWith("ADDIN EN.REFLIST") || instr.startsWith("ADDIN Mendeley Bibliography CSL_BIBLIOGRAPHY")) {
    return { records: [], markerRefIds: [], markerKeys: [], isBibliographyField: true };
  }
  if (instr.startsWith(zoteroPrefix)) {
    return extractCslItemsFromJson(instr.slice(zoteroPrefix.length).trim());
  }
  if (instr.startsWith(mendeleyPrefix)) {
    return extractCslItemsFromJson(instr.slice(mendeleyPrefix.length).trim());
  }
  if (instr.startsWith("ADDIN EN.CITE.DATA ")) {
    const b64 = instr.slice("ADDIN EN.CITE.DATA ".length).trim();
    const decodedXml = decodeBase64Utf8(b64);
    return extractEndNoteRecords(decodedXml);
  }
  if (instr.startsWith("ADDIN EN.CITE")) {
    const payload = instr.slice("ADDIN EN.CITE".length).trim();
    if (payload.startsWith("<")) {
      return extractEndNoteRecords(payload);
    }
    const decodedXml = decodeBase64Utf8(payload);
    if (decodedXml.includes("<")) {
      return extractEndNoteRecords(decodedXml);
    }
  }
  return { records: [], markerRefIds: [], markerKeys: [], isBibliographyField: false };
}

function buildFootnotesMap(footnotesXml?: string | readonly OrderedXmlNode[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  if (footnotesXml === undefined) return map;
  const nodes = typeof footnotesXml === "string" ? parseXmlOrdered(footnotesXml) : footnotesXml;
  const fnNodes = collectNodesByTag(nodes, "w:footnote");
  for (const fn of fnNodes) {
    const id = getAttr(fn, "w:id");
    if (id === null || id === "-1" || id === "0") continue;
    const info = getTagAndChildren(fn);
    if (info === null) continue;
    const paras: string[] = [];
    for (const ch of info.children) {
      const chInfo = getTagAndChildren(ch);
      if (chInfo !== null && chInfo.rawTag === "w:p") {
        const txt = collectNodeText(chInfo.children, "w:t").trim();
        if (txt.length > 0) paras.push(txt);
      }
    }
    if (paras.length > 0) map.set(id, paras);
  }
  return map;
}

interface FieldFrame {
  phase: "instr" | "result";
  instr: string;
  resultText: string;
  startOffsetInPara: number;
}

function renderRunText(runNode: OrderedXmlNode): {
  readonly text: string;
  readonly isSuperscript: boolean;
  readonly footnoteRefs: readonly string[];
  readonly instrText: string;
  readonly fldCharType: string | null;
} {
  const info = getTagAndChildren(runNode);
  if (info === null) {
    return { text: "", isSuperscript: false, footnoteRefs: [], instrText: "", fldCharType: null };
  }
  let isSuperscript = false;
  let text = "";
  let instrText = "";
  let fldCharType: string | null = null;
  const footnoteRefs: string[] = [];

  for (const ch of info.children) {
    const chInfo = getTagAndChildren(ch);
    if (chInfo === null) continue;
    if (chInfo.rawTag === "w:rPr") {
      const va = findFirstChild(chInfo.children, "w:vertAlign");
      if (va !== null && getAttr(va, "w:val") === "superscript") {
        isSuperscript = true;
      }
    } else if (chInfo.rawTag === "w:t") {
      text += collectNodeText(chInfo.children);
    } else if (chInfo.rawTag === "w:tab") {
      text += "\t";
    } else if (chInfo.rawTag === "w:br") {
      text += "\n";
    } else if (chInfo.rawTag === "w:instrText") {
      instrText += collectNodeText(chInfo.children);
    } else if (chInfo.rawTag === "w:fldChar") {
      fldCharType = getAttr(ch, "w:fldCharType");
    } else if (chInfo.rawTag === "w:footnoteReference") {
      const id = getAttr(ch, "w:id");
      if (id !== null) footnoteRefs.push(id);
    }
  }

  return { text, isSuperscript, footnoteRefs, instrText, fldCharType };
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
 * Pure WordprocessingML `.docx` importer (`03` §5.3, `AC-L0-12`).
 */
export function ingestDocxXml(input: IngestDocxXmlInput): IngestDocxResult {
  const report = cloneReport(input.report);
  const docNodes =
    typeof input.documentXml === "string" ? parseXmlOrdered(input.documentXml) : input.documentXml;
  const footnotesMap = buildFootnotesMap(input.footnotesXml);

  const documentNode = findFirstChild(docNodes, "w:document");
  const docChildren = documentNode !== null ? getTagAndChildren(documentNode)?.children ?? [] : docNodes;
  const bodyNode = findFirstChild(docChildren, "w:body");
  const bodyChildren = bodyNode !== null ? getTagAndChildren(bodyNode)?.children ?? [] : docChildren;

  const docChunks: string[] = [];
  let docLength = 0;
  const footnoteStreams: DocxFootnoteStream[] = [];
  const docxMarkers: AuthoritativeDocxMarker[] = [];
  const rawBibRecords: IngestedBibRecord[] = [];
  const rawReferences: string[] = [];
  let inReferencesSection = false;
  let seenFirstHeading = false;
  let activeBibField = false;

  const appendBlockText = (blockText: string): number => {
    const startOffset = docLength > 0 ? docLength + 2 : 0;
    if (docLength > 0) {
      docChunks.push("\n\n");
      docLength += 2;
    }
    docChunks.push(blockText);
    docLength += blockText.length;
    return startOffset;
  };

  const fieldStack: FieldFrame[] = [];

  const renderParagraph = (
    pChildren: readonly OrderedXmlNode[],
    allowMarkdownHeading: boolean,
  ): {
    readonly text: string;
    readonly headingLevel: number;
    readonly footnoteIds: readonly string[];
    readonly paraMarkers: readonly AuthoritativeDocxMarker[];
    readonly isBibliographyPara: boolean;
  } => {
    let headingLevel = 0;
    if (allowMarkdownHeading) {
      const pPr = findFirstChild(pChildren, "w:pPr");
      if (pPr !== null) {
        const pPrCh = getTagAndChildren(pPr)?.children ?? [];
        const pStyle = findFirstChild(pPrCh, "w:pStyle");
        if (pStyle !== null) {
          headingLevel = headingHashesForStyle(getAttr(pStyle, "w:val"));
        }
      }
    }

    let paraBody = "";
    const footnoteIds: string[] = [];
    const paraMarkers: AuthoritativeDocxMarker[] = [];
    let isBibliographyPara = false;

    const processRun = (rNode: OrderedXmlNode): void => {
      const r = renderRunText(rNode);
      for (const fnId of r.footnoteRefs) {
        if (!footnoteIds.includes(fnId)) footnoteIds.push(fnId);
      }

      if (r.fldCharType === "begin") {
        fieldStack.push({ phase: "instr", instr: "", resultText: "", startOffsetInPara: paraBody.length });
        return;
      }
      if (r.fldCharType === "separate") {
        const top = fieldStack[fieldStack.length - 1];
        if (top !== undefined) {
          top.phase = "result";
          top.startOffsetInPara = paraBody.length;
        }
        return;
      }
      if (r.fldCharType === "end") {
        const top = fieldStack.pop();
        if (top !== undefined) {
          const parsedField = parseDocxFieldInstruction(top.instr);
          if (parsedField.isBibliographyField) {
            isBibliographyPara = true;
            activeBibField = false;
          } else if (parsedField.records.length > 0 && top.resultText.length > 0) {
            rawBibRecords.push(...parsedField.records);
            paraMarkers.push({
              start: top.startOffsetInPara,
              end: top.startOffsetInPara + top.resultText.length,
              kind: "docx_field",
              keys: parsedField.markerKeys,
              refIds: parsedField.markerRefIds,
            });
          }
        }
        return;
      }

      const topField = fieldStack[fieldStack.length - 1];
      if (topField !== undefined && topField.phase === "instr") {
        if (r.instrText.length > 0) {
          topField.instr += r.instrText;
          const instrTrim = topField.instr.trim();
          if (
            instrTrim.startsWith("ADDIN ZOTERO_BIBL") ||
            instrTrim.startsWith("ADDIN EN.REFLIST") ||
            instrTrim.startsWith("ADDIN Mendeley Bibliography CSL_BIBLIOGRAPHY")
          ) {
            isBibliographyPara = true;
            activeBibField = true;
          }
        }
        return;
      }
      if (topField !== undefined && topField.phase === "result") {
        topField.resultText += r.text;
        paraBody += r.text;
        return;
      }

      if (r.text.length > 0) {
        if (r.isSuperscript && isSuperscriptOnlyDigitsAndPunct(r.text)) {
          const trimmedSup = r.text.trim();
          if (isExponentSuperscript(paraBody)) {
            paraBody += `^${trimmedSup}`;
          } else {
            paraBody += `[${trimmedSup}]`;
          }
        } else {
          paraBody += r.text;
        }
      }
    };

    const walkParaChildren = (nodes: readonly OrderedXmlNode[]): void => {
      for (const ch of nodes) {
        const info = getTagAndChildren(ch);
        if (info === null) continue;
        if (info.rawTag === "w:r") {
          processRun(ch);
        } else if (info.rawTag === "w:fldSimple") {
          const instr = getAttr(ch, "w:instr") ?? "";
          const parsedField = parseDocxFieldInstruction(instr);
          const resultText = collectNodeText(info.children, "w:t");
          if (parsedField.isBibliographyField) {
            isBibliographyPara = true;
          } else {
            const startInPara = paraBody.length;
            paraBody += resultText;
            if (parsedField.records.length > 0 && resultText.length > 0) {
              rawBibRecords.push(...parsedField.records);
              paraMarkers.push({
                start: startInPara,
                end: startInPara + resultText.length,
                kind: "docx_field",
                keys: parsedField.markerKeys,
                refIds: parsedField.markerRefIds,
              });
            }
          }
        } else if (info.rawTag === "m:oMathPara") {
          const mathInner = collectNodeText(info.children, "m:t");
          paraBody += `$${mathInner}$`;
          report.mathRegions.display += 1;
        } else if (info.rawTag === "m:oMath") {
          const mathInner = collectNodeText(info.children, "m:t");
          paraBody += `$${mathInner}$`;
          report.mathRegions.inline += 1;
        } else if (info.rawTag === "w:hyperlink" || info.rawTag === "w:sdt" || info.rawTag === "w:sdtContent") {
          walkParaChildren(info.children);
        }
      }
    };

    walkParaChildren(pChildren);

    if (headingLevel > 0) {
      const prefix = `${"#".repeat(headingLevel)} `;
      const shifted = paraMarkers.map((m) => ({
        ...m,
        start: m.start + prefix.length,
        end: m.end + prefix.length,
      }));
      return {
        text: `${prefix}${paraBody.trim()}`,
        headingLevel,
        footnoteIds,
        paraMarkers: shifted,
        isBibliographyPara,
      };
    }

    return {
      text: paraBody,
      headingLevel: 0,
      footnoteIds,
      paraMarkers,
      isBibliographyPara,
    };
  };

  for (const child of bodyChildren) {
    const info = getTagAndChildren(child);
    if (info === null) continue;

    if (info.rawTag === "w:p") {
      const rendered = renderParagraph(info.children, true);
      if (rendered.headingLevel > 0) {
        const headingLabel = matchCanonicalSectionLabel(
          stripLeadingMarkdownHashes(rendered.text),
          !seenFirstHeading,
        );
        seenFirstHeading = true;
        inReferencesSection = headingLabel === "references";
      }

      if (rendered.isBibliographyPara || activeBibField) {
        const refLine = rendered.text.trim();
        if (refLine.length > 0) rawReferences.push(refLine);
        continue;
      }

      if (inReferencesSection && rendered.headingLevel === 0) {
        const refLine = rendered.text.trim();
        if (refLine.length > 0) rawReferences.push(refLine);
        continue;
      }

      const trimmedCheck = rendered.text.trim();
      if (trimmedCheck.length === 0 && rendered.paraMarkers.length === 0) continue;

      const blockStart = appendBlockText(rendered.text);
      for (const pm of rendered.paraMarkers) {
        docxMarkers.push({
          ...pm,
          start: blockStart + pm.start,
          end: blockStart + pm.end,
        });
      }

      for (const fnId of rendered.footnoteIds) {
        const fnParas = footnotesMap.get(fnId);
        if (fnParas !== undefined) {
          report.footnotes += 1;
          footnoteStreams.push({
            id: fnId,
            paragraphs: fnParas,
            anchorOffset: blockStart + rendered.text.length,
          });
        }
      }
    } else if (info.rawTag === "w:tbl") {
      const rows: string[][] = [];
      for (const tr of info.children) {
        const trInfo = getTagAndChildren(tr);
        if (trInfo === null || trInfo.rawTag !== "w:tr") continue;
        const cells: string[] = [];
        for (const tc of trInfo.children) {
          const tcInfo = getTagAndChildren(tc);
          if (tcInfo === null || tcInfo.rawTag !== "w:tc") continue;
          const cellParts: string[] = [];
          for (const cp of tcInfo.children) {
            const cpInfo = getTagAndChildren(cp);
            if (cpInfo !== null && cpInfo.rawTag === "w:p") {
              const pr = renderParagraph(cpInfo.children, false);
              if (pr.text.trim().length > 0) cellParts.push(pr.text.trim());
            }
          }
          cells.push(cellParts.join(" "));
        }
        if (cells.length > 0) rows.push(cells);
      }

      if (rows.length > 0) {
        report.tablesParsed += 1;
        const header = rows[0]!;
        const sep = header.map(() => "---");
        const lines: string[] = [
          `| ${header.join(" | ")} |`,
          `| ${sep.join(" | ")} |`,
        ];
        for (let r = 1; r < rows.length; r += 1) {
          lines.push(`| ${rows[r]!.join(" | ")} |`);
        }
        appendBlockText(lines.join("\n"));
      }
    }
  }

  const deduped = deduplicateBibRecords(rawBibRecords);
  const finalRecords =
    deduped.records.length > 0
      ? deduped.records
      : rawReferences.map((rawRef, idx) => {
          const key = String(idx + 1);
          return {
            refId: assignDeterministicRefId({ raw: rawRef, key }),
            key,
            aliases: [key],
            sourceFormat: "raw_text" as const,
            entryType: "raw",
            orderIndex: idx + 1,
            doi: null,
            pmcid: null,
            arxivId: null,
            title: rawRef,
            authors: [],
            raw: rawRef,
          };
        });

  return {
    markdownText: docChunks.join(""),
    footnoteStreams,
    docxMarkers,
    bibRecords: finalRecords,
    bibliographyEntries: toBibliographyEntries(finalRecords),
    rawReferences,
    docxNumberedRefs: rawReferences.length > 0 ? finalRecords.map((r) => r.refId) : [],
    documentKind: "multi_file",
    editable: false,
    bannerCopy: DOCX_READONLY_BANNER,
    report,
  };
}
