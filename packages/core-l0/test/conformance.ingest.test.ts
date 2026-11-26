import { describe, expect, it } from "vitest";
import ingestGolden from "../../../conformance/l0/ingest.json" with { type: "json" };
import {
  expandLatexProject,
  fileLineToGlobal,
  globalToFileLine,
  ingestArchiveEntries,
  ingestDocxXml,
  ingestLatexProject,
  ingestMarkdownDocument,
  normalizeDoiVerbatim,
  parseBibItems,
  parseBibTex,
  parseCslJson,
  parseRis,
  scanPage1Doi,
  type ArchiveEntryInput,
} from "../src/ingest/index.js";

interface ConformanceCase {
  readonly id: string;
  readonly op: string;
  readonly input: unknown;
  readonly expected: unknown;
}

const CASES = ingestGolden as readonly ConformanceCase[];

describe("conformance/l0/ingest.json", () => {
  for (const tc of CASES) {
    it(`${tc.id} (${tc.op})`, () => {
      if (tc.op === "normalizeDoiVerbatim") {
        expect(normalizeDoiVerbatim(tc.input as string)).toBe(tc.expected);
      } else if (tc.op === "parseBibTex") {
        const res = parseBibTex(tc.input as string);
        const exp = tc.expected as {
          readonly skippedEntries: number;
          readonly records: readonly Record<string, unknown>[];
        };
        expect(res.skippedEntries).toBe(exp.skippedEntries);
        expect(res.records).toHaveLength(exp.records.length);
        for (let i = 0; i < exp.records.length; i += 1) {
          expect(res.records[i]).toMatchObject(exp.records[i]!);
        }
      } else if (tc.op === "parseRis") {
        const res = parseRis(tc.input as string);
        const exp = tc.expected as {
          readonly skippedEntries: number;
          readonly records: readonly Record<string, unknown>[];
        };
        expect(res.skippedEntries).toBe(exp.skippedEntries);
        expect(res.records).toHaveLength(exp.records.length);
        for (let i = 0; i < exp.records.length; i += 1) {
          expect(res.records[i]).toMatchObject(exp.records[i]!);
        }
      } else if (tc.op === "parseCslJson") {
        const res = parseCslJson(tc.input as string);
        const exp = tc.expected as {
          readonly skippedEntries: number;
          readonly records: readonly Record<string, unknown>[];
        };
        expect(res.skippedEntries).toBe(exp.skippedEntries);
        expect(res.records).toHaveLength(exp.records.length);
        for (let i = 0; i < exp.records.length; i += 1) {
          expect(res.records[i]).toMatchObject(exp.records[i]!);
        }
      } else if (tc.op === "parseBibItems") {
        const res = parseBibItems(tc.input as string);
        const exp = tc.expected as { readonly records: readonly Record<string, unknown>[] };
        expect(res.records).toHaveLength(exp.records.length);
        for (let i = 0; i < exp.records.length; i += 1) {
          expect(res.records[i]).toMatchObject(exp.records[i]!);
        }
      } else if (tc.op === "ingestArchiveEntries") {
        const inp = tc.input as {
          readonly archiveBytes: number;
          readonly syntheticEntryCount?: number;
          readonly entries?: readonly {
            readonly path: string;
            readonly compressedSize: number;
            readonly uncompressedSize: number;
            readonly text: string;
          }[];
        };
        const decompressedPaths: string[] = [];
        const entries: ArchiveEntryInput[] =
          inp.syntheticEntryCount !== undefined
            ? Array.from({ length: inp.syntheticEntryCount }, (_, idx) => ({
                path: `f_${String(idx)}.tex`,
                compressedSize: 10,
                uncompressedSize: 10,
                readText: () => {
                  decompressedPaths.push(`f_${String(idx)}.tex`);
                  return "text";
                },
              }))
            : (inp.entries ?? []).map((e) => ({
                path: e.path,
                compressedSize: e.compressedSize,
                uncompressedSize: e.uncompressedSize,
                readText: () => {
                  decompressedPaths.push(e.path);
                  return e.text.length === 1 && e.uncompressedSize > 1024
                    ? e.text.repeat(e.uncompressedSize)
                    : e.text;
                },
              }));

        const res = ingestArchiveEntries({ archiveBytes: inp.archiveBytes, entries });
        const exp = tc.expected as Record<string, unknown>;
        expect(res.ok).toBe(exp["ok"]);
        if (exp["errorCode"] !== undefined) {
          expect(res.errorCode).toBe(exp["errorCode"]);
        }
        if (exp["orderedPaths"] !== undefined) {
          expect(res.orderedPaths).toStrictEqual(exp["orderedPaths"]);
        }
        if (exp["decompressedPaths"] !== undefined) {
          expect(decompressedPaths).toStrictEqual(exp["decompressedPaths"]);
        }
        if (exp["violationReasons"] !== undefined) {
          expect(res.violations.map((v) => v.reason)).toStrictEqual(exp["violationReasons"]);
        }
        if (exp["filesSkipped"] !== undefined) {
          expect(res.report.filesSkipped).toBe(exp["filesSkipped"]);
        }
      } else if (tc.op === "ingestLatexProject") {
        const inp = tc.input as {
          readonly isArchive: boolean;
          readonly files: Readonly<Record<string, string>>;
          readonly probeText: string;
        };
        const res = ingestLatexProject({ files: inp.files, isArchive: inp.isArchive });
        const exp = tc.expected as {
          readonly ok: boolean;
          readonly mainFile: string;
          readonly documentKind: string;
          readonly editable: boolean;
          readonly includedFiles: readonly string[];
          readonly bibFilesUsed: readonly string[];
          readonly resolvedKeys: readonly string[];
          readonly probeFileLine: { readonly file: string; readonly line: number; readonly column: number };
          readonly roundTripBackMatches: boolean;
        };
        expect(res.ok).toBe(exp.ok);
        expect(res.expansion?.mainFile).toBe(exp.mainFile);
        expect(res.expansion?.documentKind).toBe(exp.documentKind);
        expect(res.expansion?.editable).toBe(exp.editable);
        expect(res.expansion?.includedFiles).toStrictEqual(exp.includedFiles);
        expect(res.bibFilesUsed).toStrictEqual(exp.bibFilesUsed);
        expect(res.bibRecords.map((r) => r.key)).toStrictEqual(exp.resolvedKeys);

        const globalIdx = res.expansion!.expandedText.indexOf(inp.probeText);
        expect(globalIdx).toBeGreaterThanOrEqual(0);
        const mapped = globalToFileLine(res.expansion!.offsetMap, globalIdx);
        expect(mapped).toMatchObject(exp.probeFileLine);
        const back = fileLineToGlobal(
          res.expansion!.offsetMap,
          mapped!.file,
          mapped!.line,
          mapped!.column,
        );
        expect(back.includes(globalIdx)).toBe(exp.roundTripBackMatches);
      } else if (tc.op === "expandLatexProjectLimits") {
        const inp = tc.input as { readonly depthChainLength: number };
        const files: Record<string, string> = {};
        for (let d = 0; d < inp.depthChainLength; d += 1) {
          const name = d === 0 ? "main.tex" : `f${String(d)}.tex`;
          const next = d + 1 < inp.depthChainLength ? `\\input{f${String(d + 1)}}` : "Leaf";
          files[name] =
            d === 0
              ? `\\documentclass{article}\\begin{document}${next}\\end{document}`
              : next;
        }
        const depthRes = expandLatexProject({ mainFile: "main.tex", files, isArchive: true });
        const exp = tc.expected as {
          readonly maxIncludedDepth: number;
          readonly depthLimitCode: string;
          readonly expansionLimitCode: string;
        };
        expect(depthRes.includedFiles).toHaveLength(exp.maxIncludedDepth);
        expect(depthRes.limitReached).toBe(exp.depthLimitCode);

        // Over 2 MB total expansion
        const payload = "a".repeat(300_000);
        const bigFiles: Record<string, string> = {
          "main.tex":
            "\\documentclass{article}\\begin{document}" +
            "\\input{big}\\input{big}\\input{big}\\input{big}\\input{big}\\input{big}\\input{big}" +
            "\\end{document}",
          "big.tex": payload,
        };
        const sizeRes = expandLatexProject({ mainFile: "main.tex", files: bigFiles, isArchive: true });
        expect(sizeRes.limitReached).toBe(exp.expansionLimitCode);
        expect(sizeRes.expandedBytes).toBeLessThanOrEqual(2 * 1024 * 1024);
        expect(sizeRes.includedFiles).toStrictEqual(["big.tex"]);
        expect(sizeRes.unexpandedFiles).toContain("big.tex");
        expect(sizeRes.report.unresolvedInputs).toContain("big.tex");
      } else if (tc.op === "ingestMarkdownDocument") {
        const inp = tc.input as {
          readonly text: string;
          readonly siblingFiles?: Readonly<Record<string, string>>;
        };
        const res = ingestMarkdownDocument(inp);
        const exp = tc.expected as {
          readonly documentKind: string;
          readonly editable: boolean;
          readonly frontMatter: Record<string, unknown>;
          readonly bibFilesUsed: readonly string[];
          readonly bibRecordKeys: readonly string[];
        };
        expect(res.documentKind).toBe(exp.documentKind);
        expect(res.editable).toBe(exp.editable);
        expect(res.frontMatter).toMatchObject(exp.frontMatter);
        expect(res.bibFilesUsed).toStrictEqual(exp.bibFilesUsed);
        expect(res.bibRecords.map((r) => r.key)).toStrictEqual(exp.bibRecordKeys);
      } else if (tc.op === "ingestDocxXml") {
        const inp = tc.input as {
          readonly documentXml: string;
          readonly footnotesXml?: string;
        };
        const res = ingestDocxXml(inp);
        const exp = tc.expected as {
          readonly documentKind: string;
          readonly editable: boolean;
          readonly markerCount: number;
          readonly markerSubstrings: readonly string[];
          readonly bibRefIds: readonly string[];
          readonly containsText: readonly string[];
          readonly excludesText: readonly string[];
          readonly rawReferences: readonly string[];
          readonly footnoteParagraphs: readonly string[];
          readonly tablesParsed: number;
        };
        expect(res.documentKind).toBe(exp.documentKind);
        expect(res.editable).toBe(exp.editable);
        expect(res.docxMarkers).toHaveLength(exp.markerCount);
        expect(
          res.docxMarkers.map((m) => res.markdownText.slice(m.start, m.end)),
        ).toStrictEqual(exp.markerSubstrings);
        expect(res.bibRecords.map((r) => r.refId)).toStrictEqual(exp.bibRefIds);
        for (const sub of exp.containsText) {
          expect(res.markdownText).toContain(sub);
        }
        for (const sub of exp.excludesText) {
          expect(res.markdownText).not.toContain(sub);
        }
        expect(res.rawReferences).toStrictEqual(exp.rawReferences);
        expect(res.footnoteStreams[0]?.paragraphs).toStrictEqual(exp.footnoteParagraphs);
        expect(res.report.tablesParsed).toBe(exp.tablesParsed);
      } else if (tc.op === "scanPage1Doi") {
        expect(scanPage1Doi(tc.input as string)).toBe(tc.expected);
      } else {
        throw new Error(`Unsupported ingest conformance op: ${tc.op}`);
      }
    });
  }
});
