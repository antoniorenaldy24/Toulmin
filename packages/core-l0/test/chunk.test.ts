import { describe, expect, it } from "vitest";
import {
  NEIGHBOUR_EXTENSION_MAX_WORDS,
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
  isInWordlistEn,
  parseXmlOrdered,
  shapeEvidenceWindow,
  stripJatsAndHtmlTags,
  type OrderedXmlNode,
  type PdfPageInput,
} from "../src/index.js";

function medianMs(fn: () => void, warmup: number = 6, trials: number = 7): number {
  for (let w = 0; w < warmup; w++) {
    fn();
  }
  const times: number[] = [];
  for (let t = 0; t < trials; t++) {
    const start = performance.now();
    fn();
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  return times[Math.floor(times.length / 2)]!;
}

describe("wordlist_en runtime dictionary & PDF dehyphenation (02 §8.7 step 2)", () => {
  it("exposes 50,000 English words cleanly with zero I/O and protects hyphenated compounds", () => {
    const set = getWordlistEnSet();
    expect(set.size).toBe(50_000);
    expect(isInWordlistEn("mortality")).toBe(true);
    expect(isInWordlistEn("Mortality")).toBe(true);
    expect(isInWordlistEn("treatment")).toBe(true);
    expect(isInWordlistEn("long-term")).toBe(true);
    expect(isInWordlistEn("longterm")).toBe(false);

    expect(dehyphenatePdfLines(["long-", "term outcomes and mor-", "tality rates."])).toBe(
      "long-term outcomes and mortality rates.",
    );
    expect(dehyphenatePdfLines(["COVID-", "19 reduced follow-", "up rates."])).toBe(
      "COVID- 19 reduced follow-up rates.",
    );
    expect(dehyphenatePdfLines(["Non-word-", "Lowercase remains."])).toBe(
      "Non-word- Lowercase remains.",
    );
  });
});

describe("chunkId, evidenceVersion, XML entities & tag stripping", () => {
  it("decodes XML/HTML named (case-sensitive Greek), decimal, and hex entities safely and rejects invalid code points", () => {
    expect(decodeXmlEntities("&amp;&lt;&gt;&quot;&apos;&micro;&#945;&#x03b2;")).toBe(
      "&<>\"'\u03bc\u03b1\u03b2",
    );
    expect(decodeXmlEntities("&Delta;HbA1c vs &delta;-cell &Alpha;&Omega;")).toBe(
      "\u0394HbA1c vs \u03b4-cell \u0391\u03a9",
    );
    expect(decodeXmlEntities("bad &#xD800; &#x110000; &unknown;")).toBe(
      "bad &#xD800; &#x110000; &unknown;",
    );
    expect(
      stripJatsAndHtmlTags(
        "<jats:p>Group A (p &lt; 0.05) vs <italic>control</italic> ($5) with p < 0.01.</jats:p>",
      ),
    ).toBe("Group A (p < 0.05) vs control ($5) with p < 0.01.");
  });

  it("produces deterministic evidenceVersion sorted by UTF-8 bytes", () => {
    const ids = [
      computeChunkId("r1", "ABSTRACT", "abstract", 0, "Alpha."),
      computeChunkId("r1", "ABSTRACT", "abstract", 1, "Beta."),
    ];
    expect(computeEvidenceVersion(ids)).toBe(computeEvidenceVersion([ids[1]!, ids[0]!]));
  });
});

describe("Unit shaping: neighbour extension (<= 12 words) & window shaping (> 60 words)", () => {
  it("extends units <= 12 words using original unextended neighbours and keeps 13+ word units intact", () => {
    expect(NEIGHBOUR_EXTENSION_MAX_WORDS).toBe(12);
    const twelveWords = "One two three four five six seven eight nine ten eleven twelve.";
    const thirteenWords = "One two three four five six seven eight nine ten eleven twelve thirteen.";
    const shortEnd = "Short tail sentence.";

    const extended = applyNeighbourExtension([twelveWords, thirteenWords, shortEnd]);
    expect(extended[0]).toBe(`${twelveWords} ${thirteenWords}`);
    expect(extended[1]).toBe(thirteenWords);
    expect(extended[2]).toBe(`${thirteenWords} ${shortEnd}`);
  });

  it("retains units <= 60 words verbatim and shapes > 60 words with earliest tie-break & numeric matches", () => {
    expect(WINDOW_SHAPING_MAX_WORDS).toBe(60);
    const sixtyWords = Array.from({ length: 60 }, (_, i) => `w${i}`).join(" ");
    const res60 = shapeEvidenceWindow(sixtyWords, "w10");
    expect(res60.text).toBe(sixtyWords);
    expect(res60.wordCount).toBe(60);

    const words70 = Array.from({ length: 70 }, (_, i) => `pad${i}`);
    words70[64] = "30%";
    words70[65] = "mortality";
    const shaped = shapeEvidenceWindow(words70.join(" "), "mortality fell 30%");
    expect(shaped.wordCount).toBe(60);
    expect(shaped.matchCount).toBe(2);
    expect(shaped.startWordIndex).toBe(6);
    expect(shaped.text.endsWith("30% mortality")).toBe(true);

    // Multi-span decimals ("0.045") and multi-word quantities ("30 percent") must never double-count
    const decimalTieWords = Array.from({ length: 70 }, (_, i) => `w${i}`);
    decimalTieWords[2] = "mortality";
    decimalTieWords[67] = "0.045";
    const decTie = shapeEvidenceWindow(decimalTieWords.join(" "), "mortality 0.045");
    expect(decTie.matchCount).toBe(1);
    expect(decTie.startWordIndex).toBe(0);

    const percentWords = Array.from({ length: 70 }, (_, i) => `p${i}`);
    percentWords[2] = "mortality";
    percentWords[64] = "30";
    percentWords[65] = "percent";
    const pctTie = shapeEvidenceWindow(percentWords.join(" "), "mortality 30%");
    expect(pctTie.matchCount).toBe(1);
    expect(pctTie.startWordIndex).toBe(0);

    const rangeWords = Array.from({ length: 70 }, (_, i) => `r${i}`);
    rangeWords[64] = "1.2";
    rangeWords[65] = "to";
    rangeWords[66] = "3.4";
    expect(shapeEvidenceWindow(rangeWords.join(" "), "2.3").matchCount).toBe(0);
    expect(shapeEvidenceWindow(rangeWords.join(" "), "1.2").startWordIndex).toBe(7);
  });
});

describe("PDF chunking edge cases: S-W5 flag, < 60% references cut, and top-down coordinates", () => {
  it("honours spike_s_w5_primary flag and drops only references when < 60% of chars", () => {
    const pages: PdfPageInput[] = [
      {
        pageNumber: 1,
        width: 600,
        height: 800,
        backgroundColor: "#FFFFFF",
        items: [
          { str: "References", x: 50, y: 740, width: 80, height: 14 },
          { str: "1. Early citation block ignored completely.", x: 50, y: 720, width: 250, height: 10 },
          { str: "Results", x: 50, y: 690, width: 60, height: 14 },
          {
            str: "Primary randomized outcomes demonstrated statistically significant benefits across every treated clinical patient group.",
            x: 50,
            y: 670,
            width: 450,
            height: 10,
          },
          {
            str: "Secondary hidden white injection text ignored only under S-W5",
            x: 50,
            y: 640,
            width: 300,
            height: 10,
            renderMode: 3,
            fillColor: "#ffffff",
          },
        ],
      },
    ];

    const fallbackRes = chunkPdfPages("r-pdf", pages, { spike_s_w5_primary: false });
    expect(fallbackRes.hiddenTextPages).toEqual([]);
    expect(fallbackRes.units.some((u) => u.section === "references")).toBe(false);
    expect(fallbackRes.units.some((u) => u.section === "results")).toBe(true);
    expect(fallbackRes.units.some((u) => u.text.includes("Secondary hidden"))).toBe(true);

    const sw5Res = chunkPdfPages("r-pdf", pages, {
      spike_s_w5_primary: true,
      sourceKind: "USER_PDF",
    });
    expect(sw5Res.hiddenTextPages).toEqual([1]);
    expect(sw5Res.units.every((u) => u.sourceKind === "USER_PDF")).toBe(true);
    expect(sw5Res.units.some((u) => u.text.includes("Secondary hidden"))).toBe(false);
  });

  it("supports top-down y coordinates and wide spanning headers above two columns", () => {
    const topDownPage: PdfPageInput = {
      pageNumber: 1,
      width: 600,
      height: 800,
      items: [
        { str: "Discussion", x: 100, y: 40, width: 400, height: 14 },
        {
          str: "Left top column describes primary clinical findings across twelve participating regional research medical centers.",
          x: 40,
          y: 100,
          width: 200,
          height: 10,
        },
        {
          str: "Right top column describes secondary adverse safety outcomes across twelve participating regional medical centers.",
          x: 340,
          y: 100,
          width: 200,
          height: 10,
        },
        { str: "H", x: 40, y: 140, width: 10, height: 10 },
        { str: "2", x: 50.5, y: 143, width: 6, height: 6 },
        {
          str: "O levels were also carefully monitored across twelve participating regional research medical study centers.",
          x: 57,
          y: 140,
          width: 180,
          height: 10,
        },
        {
          str: "Right bottom column confirms secondary adverse safety findings across twelve participating regional medical centers.",
          x: 340,
          y: 140,
          width: 200,
          height: 10,
        },
      ],
    };

    const res = chunkPdfPages("r-td", [topDownPage], { yDirection: "top-down" });
    expect(res.units).toHaveLength(4);
    expect(res.units[0]!.section).toBe("discussion");
    expect(res.units[0]!.text).toContain("Left top column");
    expect(res.units[1]!.text.startsWith("H_2O levels")).toBe(true);
    expect(res.units[2]!.text).toContain("Right top column");
    expect(res.units[3]!.text).toContain("Right bottom column");
  });

  it("preserves pdf.js trailing/separate spaces, separates 14pt headings near 10pt lines, and dehyphenates ligatures", () => {
    const page: PdfPageInput = {
      pageNumber: 1,
      width: 600,
      height: 800,
      items: [
        { str: "Methods", x: 50, y: 720, width: 80, height: 14 },
        { str: "Mortality ", x: 50, y: 713.5, width: 48, height: 10 },
        { str: "fell ", x: 98, y: 713.5, width: 20, height: 10 },
        { str: " ", x: 118, y: 713.5, width: 1, height: 10 },
        {
          str: "across all twelve participating hospital clinical research units after ﬁn-",
          x: 119,
          y: 713.5,
          width: 260,
          height: 10,
        },
        {
          str: "ally adjusting clinical dosing protocols cleanly.",
          x: 50,
          y: 699,
          width: 220,
          height: 10,
        },
      ],
    };

    const res = chunkPdfPages("r-pdf-edge", [page]);
    expect(res.units).toHaveLength(1);
    expect(res.units[0]!.section).toBe("methods");
    expect(res.units[0]!.text).toContain("Mortality fell across");
    expect(res.units[0]!.text).toContain("finally adjusting");
  });
});

describe("JATS XML parser & fast-xml-parser node parity", () => {
  it("produces identical units and chunkIds from raw XML and pre-parsed ordered nodes (client vs oaParse)", () => {
    const xml = `
      <?xml version="1.0" encoding="UTF-8"?>
      <article>
        <front>
          <article-meta>
            <article-id pub-id-type="doi">10.5555/test-doi</article-id>
            <abstract>
              <p>Abstract text reports a $5 cost and p &lt; 0.05 across all participating adult subjects without masking.</p>
            </abstract>
          </article-meta>
        </front>
        <body>
          <sec>
            <title>Methods</title>
            <p>All forty adult study participants completed treatment across <italic>three</italic> hospital centers without dropping out.</p>
            <table-wrap>
              <caption><title>Baseline cohorts</title><p>Demographic summary collected at baseline across all participating study recruitment clinical hospital sites.</p></caption>
              <table>
                <thead>
                  <tr><th rowspan="2">Arm</th><th colspan="2">Follow-up</th></tr>
                  <tr><th>n</th><th>Mortality</th></tr>
                </thead>
                <tbody>
                  <tr><td>Drug X</td><td>48</td><td>12%</td></tr>
                </tbody>
              </table>
            </table-wrap>
          </sec>
        </body>
      </article>
    `;

    const fromXml = chunkJatsXml("ref-parity", xml);
    // Simulate fast-xml-parser preserveOrder: true output matching exact OrderedXmlNode shape
    const preParsed: OrderedXmlNode[] = parseXmlOrdered(xml);
    const fromNodes = chunkJatsOrderedNodes("ref-parity", preParsed);

    expect(fromXml).toEqual(fromNodes);
    expect(fromXml.doi).toBe("10.5555/test-doi");
    expect(fromXml.units.find((u) => u.section === "table")?.text).toBe(
      "Arm: Drug X; Follow-up \u00b7 n: 48; Follow-up \u00b7 Mortality: 12%",
    );
    expect(fromXml.units.find((u) => u.section === "abstract")?.text).toContain("$5");

    const tbodyThXml =
      "<article><body><table><tbody><tr><th>Metric</th><th>Val</th></tr><tr><td>Mortality</td><td>12%</td></tr></tbody></table></body></article>";
    expect(chunkJatsXml("r-th", tbodyThXml).units.map((u) => u.text)).toEqual([
      "Metric: Mortality; Val: 12%",
    ]);
  });

  it("formats physical printed text & Select-row units deterministically", () => {
    expect(formatSelectRowText([{ header: "Rate", cell: "12%" }])).toBe("Rate: 12%");
    const tbl = chunkPhysicalTableRow("r1", "0123456789abcdef0123", [
      { upperHeader: "Drug X", header: "n (%)", cell: "48 (30%)" },
    ]);
    const txt = chunkPhysicalText("r1", "0123456789abcdef0123", "Printed\u00b7page 0\u00b745.");
    expect(tbl.sourceKind).toBe("PHYSICAL_TABLE");
    expect(tbl.section).toBe("print:0123456789ab");
    expect(txt.sourceKind).toBe("PHYSICAL_TEXT");
    expect(txt.text).toBe("Printed\u00d7page 0.45.");
  });
});

describe("AC-L0-15 linear-time latency on 10 KB adversarial inputs", () => {
  it("completes tag stripping, XML parsing, chunking, dehyphenation, and shaping within <= 5 ms median", () => {
    const unclosedTags = "<p ".repeat(3_500);
    const unclosedQuotedAttrs = '<p a="'.repeat(1_600);
    const openComments = "<!--".repeat(2_500);
    const nestedXml = "<sec>".repeat(2_500);
    const unmatchedCloseXml = `${"<a>".repeat(1_700)}${"</b>".repeat(1_200)}`;
    const repeatedAmps = "&".repeat(10_240);
    const abstract10k = "Drug X reduced mortality by 30% in adult patients. ".repeat(195);
    const jats10k = `<article><body><sec><title>Results</title>${"<p>Drug X reduced mortality by 30% in adult patients.</p>".repeat(175)}</sec></body></article>`;
    const dehyLines10k = Array.from({ length: 400 }, () => "The randomized clinical mor-");
    const longShaping10k = "padword ".repeat(1_250);

    expect(medianMs(() => decodeXmlEntities(repeatedAmps))).toBeLessThanOrEqual(5);
    expect(medianMs(() => stripJatsAndHtmlTags(unclosedTags))).toBeLessThanOrEqual(5);
    expect(medianMs(() => stripJatsAndHtmlTags(unclosedQuotedAttrs))).toBeLessThanOrEqual(5);
    expect(medianMs(() => stripJatsAndHtmlTags(openComments))).toBeLessThanOrEqual(5);
    expect(medianMs(() => parseXmlOrdered(nestedXml))).toBeLessThanOrEqual(5);
    expect(medianMs(() => parseXmlOrdered(unmatchedCloseXml))).toBeLessThanOrEqual(5);
    expect(medianMs(() => parseXmlOrdered(openComments))).toBeLessThanOrEqual(5);
    expect(medianMs(() => chunkAbstract("r1", abstract10k))).toBeLessThanOrEqual(5);
    expect(medianMs(() => chunkJatsXml("r1", jats10k))).toBeLessThanOrEqual(5);
    expect(medianMs(() => dehyphenatePdfLines(dehyLines10k))).toBeLessThanOrEqual(5);
    expect(medianMs(() => shapeEvidenceWindow(longShaping10k, "mortality"))).toBeLessThanOrEqual(5);
  });
});
