import { describe, expect, it } from "vitest";
import { preMask, resolveCitationMarkers, scanCitations, type PdfPageInput } from "../src/index.js";
import {
  INGESTION_COPY,
  decodeBase64Utf8,
  decodeLatexBibText,
  deduplicateBibRecords,
  expandLatexProject,
  fileOffsetToGlobal,
  findMainTexFile,
  globalToFileLine,
  ingestArchiveEntries,
  ingestDocxXml,
  ingestLatexProject,
  ingestMarkdownDocument,
  ingestUserPdf,
  matchPdfToReference,
  normalizeArchivePath,
  normalizeArxivId,
  normalizePmcid,
  parseBibItems,
  parseBibTex,
  parseCslJson,
  parseRis,
  parseZipCentralDirectory,
  scanPage1ArxivId,
  scanPage1Doi,
} from "../src/ingest/index.js";

function encodeAscii(str: string): Uint8Array {
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i += 1) bytes[i] = str.charCodeAt(i) & 0xff;
  return bytes;
}

function buildMinimalStoredZip(files: readonly { readonly path: string; readonly content: string }[]): Uint8Array {
  const localParts: Uint8Array[] = [];
  const cdParts: Uint8Array[] = [];
  let offset = 0;

  for (const f of files) {
    const nameBytes = encodeAscii(f.path);
    const dataBytes = encodeAscii(f.content);
    const lh = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(lh.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(8, 0, true); // stored
    lv.setUint32(18, dataBytes.length, true);
    lv.setUint32(22, dataBytes.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lh.set(nameBytes, 30);

    const cd = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(10, 0, true);
    cv.setUint32(20, dataBytes.length, true);
    cv.setUint32(24, dataBytes.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    cd.set(nameBytes, 46);

    localParts.push(lh, dataBytes);
    cdParts.push(cd);
    offset += lh.length + dataBytes.length;
  }

  let cdSize = 0;
  for (const c of cdParts) cdSize += c.length;
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);

  const totalLen = offset + cdSize + 22;
  const out = new Uint8Array(totalLen);
  let pos = 0;
  for (const p of localParts) {
    out.set(p, pos);
    pos += p.length;
  }
  for (const c of cdParts) {
    out.set(c, pos);
    pos += c.length;
  }
  out.set(eocd, pos);
  return out;
}

describe("packages/core-l0/src/ingest/* unit & integration tests", () => {
  it("parses PKZIP central directory cleanly and reads stored text entries under §5.1 guards", () => {
    const zipBytes = buildMinimalStoredZip([
      { path: "main.tex", content: "\\documentclass{article}\\begin{document}Hi\\end{document}" },
      { path: "media/diagram.png", content: "binary" },
      { path: "../escape.tex", content: "bad" },
    ]);
    const cd = parseZipCentralDirectory(zipBytes);
    expect(cd.ok).toBe(true);
    expect(cd.entries).toHaveLength(3);

    const ingested = ingestArchiveEntries({
      archiveBytes: zipBytes.length,
      entries: cd.entries.map((e) => ({
        path: e.path,
        compressedSize: e.compressedSize,
        uncompressedSize: e.uncompressedSize,
        isDirectory: e.isDirectory,
        readBytes: () => e.readStoredBytes() ?? new Uint8Array(),
      })),
    });
    expect(ingested.ok).toBe(true);
    expect(ingested.orderedPaths).toStrictEqual(["main.tex"]);
    expect(ingested.files["main.tex"]).toContain("\\begin{document}");
    expect(ingested.violations.map((v) => v.reason)).toStrictEqual(["NON_TEXT_ENTRY", "PATH_TRAVERSAL"]);
  });

  it("rejects spoofed uncompressed sizes when actual decoded bytes exceed limits or ratio", () => {
    const res = ingestArchiveEntries({
      archiveBytes: 2000,
      entries: [
        {
          path: "spoof.tex",
          compressedSize: 5,
          uncompressedSize: 100, // lied in ZIP header
          readText: () => "x".repeat(600), // 600 / 5 = 120 > 100 ratio
        },
      ],
    });
    expect(res.ok).toBe(true);
    expect(res.orderedPaths).toStrictEqual([]);
    expect(res.violations[0]?.reason).toBe("COMPRESSION_RATIO_EXCEEDED");
    expect(normalizeArchivePath("./chapters\\sub.tex")).toStrictEqual({
      ok: true,
      path: "chapters/sub.tex",
    });
    expect(normalizeArchivePath("C:\\Users\\test.tex").ok).toBe(false);
  });

  it("handles main file tie-breaking, non-cyclic repeated includes, cycle detection, and NO_MAIN_FILE copy", () => {
    const noMain = findMainTexFile({ "sec.tex": "\\section{Intro} No documentclass." });
    expect(noMain.ok).toBe(false);
    expect(noMain.errorCode).toBe("NO_MAIN_FILE");
    expect(noMain.errorMessage).toBe(INGESTION_COPY.noMainFile);

    const tie = findMainTexFile({
      "other.tex": "\\documentclass{article}\\begin{document}" + "a".repeat(200) + "\\end{document}",
      "main.tex": "\\documentclass{article}\\begin{document}short\\end{document}",
    });
    expect(tie.mainFile).toBe("main.tex");

    const files = {
      "main.tex": "\\documentclass{article}\n\\begin{document}\n\\input{shared}\n\\input{shared}\n\\input{cyc_a}\n\\end{document}",
      "shared.tex": "Shared clause.\n",
      "cyc_a.tex": "A\\input{cyc_b}",
      "cyc_b.tex": "B\\input{cyc_a}",
    };
    const exp = expandLatexProject({ mainFile: "main.tex", files });
    expect(exp.expandedText).toContain("Shared clause.\n\nShared clause.");
    expect(exp.cyclesDetected).toStrictEqual(["cyc_a.tex"]);

    const sharedGlobals = fileOffsetToGlobal(exp.offsetMap, "shared.tex", 0);
    expect(sharedGlobals).toHaveLength(2);
    expect(globalToFileLine(exp.offsetMap, sharedGlobals[1]!)).toMatchObject({
      file: "shared.tex",
      line: 1,
      column: 1,
    });
  });

  it("decodes BibTeX accents, parentheses-delimited entries, corporate authors, PMCID/arXiv, RIS/CSL/.bbl & dedupes cleanly", () => {
    expect(decodeLatexBibText("Na\\\"ive {COVID-19} \\o{} \\ss{} \\customcmd{Keep}")).toBe(
      "Naïve COVID-19 ø ß \\customcmd{Keep}",
    );
    expect(normalizePmcid("https://pmc.ncbi.nlm.nih.gov/articles/PMC1234567/")).toBe("PMC1234567");
    expect(normalizeArxivId("https://arxiv.org/pdf/2301.12345v2.pdf")).toBe("2301.12345v2");

    const bibParen = `@article(keyA,
      author = "van der Berg, Pieter and World Health",
      title = "First",
      year = "2020",
      eprinttype = "arXiv",
      eprint = "2301.12345v1"
    )
    @article{keyA_dup,
      author = {van der Berg, Pieter},
      title = {Duplicate By RefId},
      eprint = {arXiv:2301.12345v1}
    }`;
    const parsedBib = parseBibTex(bibParen);
    expect(parsedBib.records).toHaveLength(1);
    expect(parsedBib.records[0]?.refId).toBe("arxiv:2301.12345v1");
    expect(parsedBib.records[0]?.aliases).toStrictEqual(["keyA", "keyA_dup"]);
    expect(parsedBib.duplicateKeys).toStrictEqual(["keyA_dup"]);

    const risPartial = "TY  - CONF\nAU  - Doe, Jane\nTI  - Continued title\nline two\nY1  - 2024\n";
    expect(parseRis(risPartial).records[0]?.title).toBe("Continued title line two");

    const badJson = parseCslJson("{not-json");
    expect(badJson.skippedEntries).toBe(1);
    expect(parseBibItems("\\bibitem{standalone1} Raw entry text 10.1000/s1.").records[0]?.doi).toBe(
      "10.1000/s1",
    );

    const ded = deduplicateBibRecords([...parsedBib.records, ...parsedBib.records]);
    expect(ded.duplicateCount).toBe(1);
  });

  it("extracts 5 ZOTERO_ITEM citations (AC-L0-12), Mendeley, EndNote EN.CITE.DATA, exponents, and resolves end-to-end", () => {
    const enXml =
      "<EndNote><Cite><Record><rec-number>7</rec-number><titles><title>EndNote Study</title></titles><dates><year>2019</year></dates><electronic-resource-num>10.1000/en7</electronic-resource-num><contributors><authors><author>Euler, L</author></authors></contributors></Record></Cite></EndNote>";
    // Encode ASCII to base64 manually in test (no Buffer in core-l0 tests due to eslint rule!)
    const toBase64 = (ascii: string): string => {
      const alpha = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
      let out = "";
      for (let i = 0; i < ascii.length; i += 3) {
        const b0 = ascii.charCodeAt(i);
        const has1 = i + 1 < ascii.length;
        const has2 = i + 2 < ascii.length;
        const b1 = has1 ? ascii.charCodeAt(i + 1) : 0;
        const b2 = has2 ? ascii.charCodeAt(i + 2) : 0;
        const trip = (b0 << 16) | (b1 << 8) | b2;
        out += alpha.charAt((trip >> 18) & 63);
        out += alpha.charAt((trip >> 12) & 63);
        out += has1 ? alpha.charAt((trip >> 6) & 63) : "=";
        out += has2 ? alpha.charAt(trip & 63) : "=";
      }
      return out;
    };

    const enB64 = toBase64(enXml);
    expect(decodeBase64Utf8(enB64)).toBe(enXml);

    const zItem = (n: number): string =>
      `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>ADDIN ZOTERO_ITEM CSL_CITATION {"citationItems":[{"itemData":{"id":"z${String(n)}","DOI":"10.1000/z${String(n)}","title":"Zotero Paper ${String(n)}","issued":{"date-parts":[[202${String(n)}]]}}}]}</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>[${String(n)}]</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>`;

    const docXml =
      `<w:document><w:body><w:p>` +
      `<w:r><w:t xml:space="preserve">Area 5 cm</w:t></w:r><w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:t>2</w:t></w:r>` +
      `<w:r><w:t xml:space="preserve"> showed benefits </w:t></w:r>` +
      zItem(1) + zItem(2) + zItem(3) + zItem(4) + zItem(5) +
      `<w:fldSimple w:instr="ADDIN EN.CITE.DATA ${enB64}"><w:r><w:t>(Euler, 2019)</w:t></w:r></w:fldSimple>` +
      `</w:p><w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>References</w:t></w:r></w:p>` +
      `<w:p><w:r><w:t>Fallback ref string.</w:t></w:r></w:p></w:body></w:document>`;

    const res = ingestDocxXml({ documentXml: docXml });
    expect(res.markdownText).toContain("5 cm^2 showed benefits");
    const zotCount = res.docxMarkers.filter((m) => (m.keys?.[0] ?? "").startsWith("z")).length;
    expect(zotCount).toBe(5);
    expect(res.bibRecords.some((r) => r.doi === "10.1000/en7")).toBe(true);

    // End-to-end Tier A scanCitations + resolveCitationMarkers consumption of docxMarkers
    const masked = preMask(res.markdownText, "md");
    const markers = scanCitations(masked.maskedText, { docxMarkers: res.docxMarkers });
    const resolved = resolveCitationMarkers(markers, {
      entries: res.bibliographyEntries,
    });
    expect(resolved.resolvedRefIds).toContain("doi:10.1000/z1");
    expect(resolved.resolvedRefIds).toContain("doi:10.1000/z5");
    expect(resolved.resolvedRefIds).toContain("doi:10.1000/en7");
    expect(res.rawReferences).toStrictEqual(["Fallback ref string."]);
  });

  it("integrates user PDF page-1 DOI matching, numbered Markdown fallback, and freezes inputs safely", () => {
    const bib = Object.freeze([
      Object.freeze({ refId: "doi:10.1016/j.trial.2023.04", doi: "10.1016/j.trial.2023.04" }),
    ]);
    const pages: readonly PdfPageInput[] = Object.freeze([
      Object.freeze({
        pageNumber: 1,
        width: 600,
        height: 800,
        items: Object.freeze([
          Object.freeze({ str: "Original Research DOI: 10.1016/J.TRIAL.2023.04; arXiv:2304.01234v1", x: 50, y: 740, width: 400, height: 12 }),
          Object.freeze({ str: "Methods: Patients received active treatment daily.", x: 50, y: 680, width: 400, height: 11 }),
        ]),
      }),
    ]);

    const pdfRes = ingestUserPdf({ pages, bibliography: bib });
    expect(pdfRes.page1Doi).toBe("10.1016/J.TRIAL.2023.04");
    expect(pdfRes.page1ArxivId).toBe("2304.01234v1");
    expect(pdfRes.matchedRefId).toBe("doi:10.1016/j.trial.2023.04");
    expect(scanPage1ArxivId("See arXiv:hep-th/9901001v2.")).toBe("hep-th/9901001v2");
    expect(scanPage1Doi("Short 10.123/abc")).toBeNull();
    expect(matchPdfToReference("10.1016/j.trial.2023.04", bib)).toBe("doi:10.1016/j.trial.2023.04");

    const mdRes = ingestMarkdownDocument({
      text: "# Results\n\nEffect holds [1].\n\n## References\n\n1. Doe J. Study 2021.\n",
    });
    expect(mdRes.bibRecords).toHaveLength(1);
    expect(mdRes.bibRecords[0]?.sourceFormat).toBe("raw_text");
  });

  it("handles Pass 1 adversarial regressions (2 MB tex reporting, BibTeX escapes/quotes/comma-corp/url DOI, unfielded DOCX refIds, MD YAML comments & ./ paths)", () => {
    // 1. 2 MB \input expansion stops before big2, records big2 & big3 as unexpanded, excludes big2 from includedFiles
    const capFiles: Record<string, string> = {
      "main.tex": "\\documentclass{article}\\begin{document}\\input{big1}\\input{big2}\\input{big3}\\end{document}",
      "big1.tex": "a".repeat(1_500_000),
      "big2.tex": "b".repeat(700_000),
      "big3.tex": "c".repeat(100_000),
    };
    const capRes = expandLatexProject({ mainFile: "main.tex", files: capFiles, isArchive: true });
    expect(capRes.limitReached).toBe("INPUT_EXPANSION_LIMIT");
    expect(capRes.includedFiles).toStrictEqual(["big1.tex"]);
    expect(capRes.unexpandedFiles).toStrictEqual(["big2.tex", "big3.tex"]);
    expect(capRes.report.unresolvedInputs).toStrictEqual(["big2.tex", "big3.tex"]);

    // 2. BibTeX escaped braces/backslash, braced quote inside "..." string, comma-containing corporate author, and \url{} in \bibitem
    const advBib = parseBibTex(
      `@article{k_esc, title = {Set \\{1, 2\\} and \\\\}, year = {2020}}
       @article{k_qbc, title = "Quote {"} here", year = {2021}}
       @techreport{nasem2022, author = {{National Academies of Sciences, Engineering, and Medicine}}, year = {2022}}`,
    );
    expect(advBib.skippedEntries).toBe(0);
    expect(advBib.records).toHaveLength(3);
    expect(advBib.records[0]?.year).toBe("2020");
    expect(advBib.records[1]?.year).toBe("2021");
    expect(advBib.records[2]?.corporateAuthor).toBe(
      "National Academies of Sciences, Engineering, and Medicine",
    );

    const bblUrl = parseBibItems(
      "\\begin{thebibliography}{9}\n\\bibitem{k1} Smith J. Title. \\url{https://doi.org/10.1000/bib1}\n\\end{thebibliography}",
    );
    expect(bblUrl.records[0]?.doi).toBe("10.1000/bib1");

    // 3. Unfielded .docx with superscript citation + Heading2 References -> docxNumberedRefs maps to bibRecord.refId while preserving rawReferences
    const unfieldedDocx =
      `<w:document><w:body>` +
      `<w:p><w:r><w:t>Claim</w:t></w:r><w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:t>1</w:t></w:r></w:p>` +
      `<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>References</w:t></w:r></w:p>` +
      `<w:p><w:r><w:t>1. Doe J. Study on treatments. 2021.</w:t></w:r></w:p>` +
      `</w:body></w:document>`;
    const docxUnf = ingestDocxXml({ documentXml: unfieldedDocx });
    expect(docxUnf.rawReferences).toStrictEqual(["1. Doe J. Study on treatments. 2021."]);
    expect(docxUnf.docxNumberedRefs).toStrictEqual([docxUnf.bibRecords[0]!.refId]);
    const unfieldedMasked = preMask(docxUnf.markdownText, "md");
    const unfieldedMarkers = scanCitations(unfieldedMasked.maskedText, {
      docxMarkers: docxUnf.docxMarkers,
      hasKnownNumberingOrder: true,
      numberedBibSize: docxUnf.docxNumberedRefs.length,
    });
    const unfieldedResolved = resolveCitationMarkers(unfieldedMarkers, {
      entries: docxUnf.bibliographyEntries,
      docxNumberedRefs: docxUnf.docxNumberedRefs,
    });
    expect(unfieldedResolved.resolvedRefIds).toStrictEqual([docxUnf.bibRecords[0]!.refId]);

    // 4. Pandoc Markdown YAML inline # comments and ./ bibliography path normalization
    const mdYaml = ingestMarkdownDocument({
      text: "---\nbibliography: ./refs.bib # local file\nlang: de # German\nmath: true # enable\n---\n\nInline $p<0.05$ and \\cite via [@k1].\n",
      siblingFiles: {
        "refs.bib": "@article{k1, author={Hans Muller}, title={Deutsch}, year={2022}, doi={10.1000/md1}}",
      },
    });
    expect(mdYaml.frontMatter).toMatchObject({
      bibliography: ["./refs.bib"],
      lang: "de",
      math: true,
    });
    expect(mdYaml.bibFilesUsed).toStrictEqual(["refs.bib"]);
    expect(mdYaml.bibRecords[0]?.doi).toBe("10.1000/md1");
  });

  it("maintains strictly linear O(n) latency (median <= 5 ms on 10 KB inputs across all §5 parsers, AC-L0-15)", () => {
    const oneBib =
      "@article{k_IDX_, author={Alice Smith and Bob Jones}, title={Clinical {DNA} trial with \\\"accent and \\gls{CI}}, journal={J Med}, year={2022}, doi={10.1000/test_IDX_}}\n";
    let bib10k = "";
    for (let k = 0; bib10k.length < 10_200; k += 1) {
      bib10k += oneBib.split("_IDX_").join(String(k));
    }

    let ris10k = "";
    for (let k = 0; ris10k.length < 10_200; k += 1) {
      ris10k += `TY  - JOUR\nID  - r${String(k)}\nAU  - Smith, A\nTI  - Study ${String(k)}\nPY  - 2021\nDO  - 10.1000/ris${String(k)}\nER  - \n`;
    }

    const cslItem = (k: number) => ({
      id: `c${String(k)}`,
      type: "article-journal",
      title: `Controlled cohort study number ${String(k)}`,
      DOI: `10.1000/csl${String(k)}`,
      issued: { "date-parts": [[2022]] },
      author: [{ family: "Lee", given: "Kim" }],
    });
    const cslArr: unknown[] = [];
    for (let k = 0; k < 70; k += 1) cslArr.push(cslItem(k));
    const csl10k = JSON.stringify(cslArr);
    expect(csl10k.length).toBeGreaterThanOrEqual(10_000);

    const tex10kFiles: Record<string, string> = {
      "main.tex": `\\documentclass{article}\\begin{document}\\input{part1}${
        "Clinical sentence for trial tracking. ".repeat(140)
      }\\end{document}`,
      "part1.tex": "Expanded clinical findings with cohorts and outcomes. ".repeat(100),
    };

    const oneDocxPara =
      `<w:p><w:r><w:t>Sentence with evidence and value 42 mg.</w:t></w:r></w:p>`;
    const docx10k = `<w:document><w:body>${oneDocxPara.repeat(165)}</w:body></w:document>`;
    expect(docx10k.length).toBeGreaterThanOrEqual(10_000);

    const page10k = "Abstract background sentence without DOI prefix matches. ".repeat(185) + "10.1000/final1";
    expect(page10k.length).toBeGreaterThanOrEqual(10_000);

    const medianMs = (fn: () => void): number => {
      for (let w = 0; w < 5; w += 1) fn();
      const times: number[] = [];
      for (let i = 0; i < 5; i += 1) {
        const t0 = performance.now();
        fn();
        times.push(performance.now() - t0);
      }
      times.sort((a, b) => a - b);
      return times[2]!;
    };

    expect(medianMs(() => parseBibTex(bib10k))).toBeLessThanOrEqual(5);
    expect(medianMs(() => parseRis(ris10k))).toBeLessThanOrEqual(5);
    expect(medianMs(() => parseCslJson(csl10k))).toBeLessThanOrEqual(5);
    expect(medianMs(() => ingestLatexProject({ files: tex10kFiles }))).toBeLessThanOrEqual(5);
    expect(medianMs(() => ingestDocxXml({ documentXml: docx10k }))).toBeLessThanOrEqual(5);
    expect(medianMs(() => scanPage1Doi(page10k))).toBeLessThanOrEqual(5);
  });
});
