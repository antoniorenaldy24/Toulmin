import { describe, expect, it } from "vitest";
import {
  BM25_STOPWORDS,
  COUNT_NOUNS,
  PORTER_V1,
  classifyMetricClass,
  computeSigDigits,
  computeTupleId,
  createSha256PrefixHasher,
  extractQuantities,
  extractQuantitiesWithMeta,
  formatCanonicalDecimal,
  isMetricFromUnitClass,
  isStopword,
  normalizedClaim,
  normalizedClaimHash,
  porterStem,
  sameFamily,
  sha256hex,
  unitFamilyOf,
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

describe("porter.ts & porter_v1.json (02 §8.1)", () => {
  it("keeps exact 63 stopwords and never treats negation words as stopwords", () => {
    expect(BM25_STOPWORDS.size).toBe(63);
    for (const neg of ["not", "no", "nor", "never", "without"]) {
      expect(BM25_STOPWORDS.has(neg)).toBe(false);
      expect(isStopword(neg)).toBe(false);
    }
    expect(isStopword("THE")).toBe(true);
    expect(isStopword("between")).toBe(true);
  });

  it("matches canonical 1980 Porter algorithm stems & all 03 §2.3/§2.6 normative stems", () => {
    expect(PORTER_V1.step2.length).toBe(20);
    expect(PORTER_V1.step3.length).toBe(7);
    expect(PORTER_V1.step4.length).toBe(19);

    const expectedPairs: readonly (readonly [string, string])[] = [
      ["caresses", "caress"],
      ["ponies", "poni"],
      ["ties", "ti"],
      ["cats", "cat"],
      ["feed", "feed"],
      ["agreed", "agre"],
      ["plastered", "plaster"],
      ["bled", "bled"],
      ["motoring", "motor"],
      ["sing", "sing"],
      ["conflated", "conflat"],
      ["troubled", "troubl"],
      ["sized", "size"],
      ["hopping", "hop"],
      ["falling", "fall"],
      ["hissing", "hiss"],
      ["fizzed", "fizz"],
      ["failing", "fail"],
      ["filing", "file"],
      ["happy", "happi"],
      ["sky", "sky"],
      ["relational", "relat"],
      ["conditional", "condit"],
      ["rational", "ration"],
      ["generalizations", "gener"],
      ["triplicate", "triplic"],
      ["formative", "form"],
      ["formalize", "formal"],
      ["electricity", "electr"],
      ["electrical", "electr"],
      ["hopeful", "hope"],
      ["goodness", "good"],
      ["revival", "reviv"],
      ["allowance", "allow"],
      ["inference", "infer"],
      ["adjustment", "adjust"],
      ["agreement", "agreement"],
      ["probate", "probat"],
      ["rate", "rate"],
      ["controll", "control"],
      ["roll", "roll"],
      // Spec normative words (`03` §2.3, §2.6):
      ["significant", "signific"],
      ["difference", "differ"],
      ["mortality", "mortal"],
      ["treatment", "treatment"],
      ["anxiety", "anxieti"],
      ["scores", "score"],
      ["pressure", "pressur"],
      ["large", "larg"],
      ["durable", "durabl"],
      ["rates", "rate"],
      ["groups", "group"],
      ["bleeding", "bleed"],
      ["adverse", "advers"],
      ["complications", "complic"],
      ["relapse", "relaps"],
      ["survival", "surviv"],
      ["response", "respons"],
      ["remission", "remiss"],
    ];

    for (const [word, stem] of expectedPairs) {
      expect(porterStem(word)).toBe(stem);
    }
  });
});

describe("units.ts & sameFamily (02 §7.3, §7.5)", () => {
  it("enforces sameFamily invariants across all 13 rows", () => {
    expect(sameFamily("%", "")).toBe(false);
    expect(sameFamily("pp", "%")).toBe(false);
    expect(sameFamily("s", "month")).toBe(false);
    expect(sameFamily("usd", "eur")).toBe(false);
    expect(sameFamily("eur", "gbp")).toBe(false);
    expect(sameFamily("gbp", "idr")).toBe(false);
    expect(sameFamily("ratio:or", "ratio:hr")).toBe(false);
    expect(sameFamily("ratio:rr", "ratio:irr")).toBe(false);
    expect(sameFamily("mg", "mg/L")).toBe(false);
    expect(sameFamily("mg/L", "mmol/L")).toBe(false);
    expect(sameFamily("mg", "mg/kg")).toBe(false);
    expect(sameFamily("unknown:cm", "unknown:cm")).toBe(false);
    expect(sameFamily("unknown:mmhg", "mg")).toBe(false);

    expect(sameFamily("mg", "g")).toBe(true);
    expect(sameFamily("mg/L", "mg/dl")).toBe(true);
    expect(sameFamily("s", "hours")).toBe(true);
    expect(sameFamily("months", "years")).toBe(true);
    expect(sameFamily("", "")).toBe(true);
    expect(unitFamilyOf("HR")).toBe("ratio_hr");
    expect(unitFamilyOf("hr")).toBe("time_short");
    expect(unitFamilyOf("Hazard Ratio")).toBe("ratio_hr");
  });

  it("converts units to canonical scales for mass, concentration, dose, and time", () => {
    const qMass = extractQuantities("1 kg and 500 μg and 2 ng");
    expect(qMass.map((t) => [t.unitCanon, t.valueNorm])).toEqual([
      ["mg", 1e6],
      ["mg", 0.5],
      ["mg", 2e-6],
    ]);

    const qConc = extractQuantities("2 mg/mL, 5 g/dL, and 3 mmol/L, 500 nmol/L");
    expect(qConc.map((t) => [t.unitCanon, t.metricClass, t.valueNorm])).toEqual([
      ["mg/L", "concentration", 2000],
      ["mg/L", "concentration", 50000],
      ["mmol/L", "concentration", 3],
      ["mmol/L", "concentration", 0.0005],
    ]);

    const qDose = extractQuantities("500 μg/kg administered vs 2 g/kg dose");
    expect(qDose.map((t) => [t.unitCanon, t.metricClass, t.valueNorm])).toEqual([
      ["mg/kg", "dose", 0.5],
      ["mg/kg", "dose", 2000],
    ]);

    const qTime = extractQuantities("500 ms, 2 wk, 3 mo, and 2 yrs");
    expect(qTime.map((t) => [t.unitCanon, t.metricClass, t.valueNorm])).toEqual([
      ["s", "duration", 0.5],
      ["s", "duration", 1209600],
      ["month", "duration", 3],
      ["month", "duration", 24],
    ]);
  });

  it("parses prefix/suffix currencies and n = sample sizes", () => {
    const qCur = extractQuantities("$50, US$100, €40, £25, Rp 50000");
    expect(qCur.map((t) => [t.unitCanon, t.metricClass, t.valueNorm])).toEqual([
      ["usd", "currency", 50],
      ["usd", "currency", 100],
      ["eur", "currency", 40],
      ["gbp", "currency", 25],
      ["idr", "currency", 50000],
    ]);

    const qN = extractQuantities("Cohort (n = 48) and N=120");
    expect(qN.map((t) => [t.unitCanon, t.unitRaw, t.metricClass, t.valueNorm])).toEqual([
      ["count", "n =", "sample_size", 48],
      ["count", "N=", "sample_size", 120],
    ]);
  });

  it("handles unknown units directly attached vs stopwords vs °C", () => {
    const q = extractQuantities("500mmHg, 10a, and −5 °C");
    expect(q.map((t) => [t.valueNorm, t.unitRaw, t.unitCanon])).toEqual([
      [500, "mmHg", "unknown:mmhg"],
      [10, "", ""],
      [-5, "°C", "unknown:°c"],
    ]);
    expect(sameFamily(q[0]!.unitCanon, q[0]!.unitCanon)).toBe(false);
  });
});

describe("metricClass & metricFromUnit (02 §7.4, 03 §2.3)", () => {
  it("classifies all cue-driven and unit-driven rules in priority order", () => {
    const c1 = classifyMetricClass({
      unitFamily: "none",
      isRule4PValue: false,
      isSampleSizePrefix: false,
      windowWordsLower: ["cohen", "d", "effect"],
      windowTextLower: "cohen's d = 0.8",
    });
    expect(c1).toEqual({ metricClass: "effect_size", metricFromUnit: false });

    const c2 = classifyMetricClass({
      unitFamily: "ratio_rr",
      isRule4PValue: false,
      isSampleSizePrefix: false,
      windowWordsLower: [],
      windowTextLower: "rr 1.4",
    });
    expect(c2).toEqual({ metricClass: "effect_size", metricFromUnit: true });

    const c3 = classifyMetricClass({
      unitFamily: "percent",
      isRule4PValue: false,
      isSampleSizePrefix: false,
      windowWordsLower: ["enrolled", "total"],
      windowTextLower: "enrolled total 12%",
    });
    expect(c3).toEqual({ metricClass: "percentage", metricFromUnit: false });

    const samples: readonly (readonly [string, string, boolean])[] = [
      ["Significance p < 0.01.", "p_value", true],
      ["We estimated OR 1.5 overall.", "effect_size", true],
      ["Predictive AUC was 0.85 overall.", "effect_size", false],
      ["Sample size was n = 50 subjects.", "sample_size", false],
      ["Mortality rate was 12% overall.", "percentage", false],
      ["Follow-up lasted 30 days.", "duration", true],
      ["Treatment used 10 mg dose.", "dose", false],
      ["Cost averaged $50 per visit.", "currency", true],
      ["We counted 12 mice overall.", "count", false],
    ];
    expect(
      samples.map(([text]) => {
        const meta = extractQuantitiesWithMeta(text);
        return [meta.tuples[0]!.metricClass, meta.metricFromUnitByTupleIndex[0]!];
      }),
    ).toEqual(samples.map(([, cls, mfu]) => [cls, mfu]));
    expect(isMetricFromUnitClass("concentration")).toBe(true);
    expect(isMetricFromUnitClass("ratio")).toBe(true);
    expect(isMetricFromUnitClass("other")).toBe(false);
  });
});

describe("quantity.ts helpers & AC-L0-25 edge cases", () => {
  it("has exact 42 COUNT_NOUNS and deterministically hashes tupleId", () => {
    expect(COUNT_NOUNS.size).toBe(42);
    expect(computeSigDigits("48.0")).toBe(3);
    expect(computeSigDigits("0.045")).toBe(2);
    expect(computeSigDigits("1200")).toBe(2);
    expect(computeSigDigits("48")).toBe(2);
    expect(computeSigDigits("1.20")).toBe(3);
    expect(formatCanonicalDecimal(-0)).toBe("0");

    const id1 = computeTupleId("doc-1", "a".repeat(64), 0, 0, "percentage", "37");
    const id2 = computeTupleId("doc-1", "a".repeat(64), 0, 0, "percentage", "37");
    const id3 = computeTupleId("doc-1", "a".repeat(64), 0, 1, "percentage", "37");
    expect(id1).toBe(id2);
    expect(id1).toHaveLength(32);
    expect(id1).not.toBe(id3);

    // AC-L0-25
    expect(extractQuantities("One of the main causes of delay is staffing.")).toEqual([]);
    expect(extractQuantities("Twelve patients improved.")[0]!.valueNorm).toBe(12);
    expect(extractQuantities("12.345", { lang: "de" })[0]!.valueNorm).toBe(12345);
    expect(extractQuantities("12.345", { lang: "en" })[0]!.valueNorm).toBe(12.345);
    expect(extractQuantities("In the 1990s mortality fell.")).toEqual([]);
    expect(extractQuantities("TP53 and p53 levels rose.")).toEqual([]);
    expect(normalizedClaimHash("2.50")).toBe(normalizedClaimHash("2.5"));
    expect(normalizedClaim(".5%")).toBe("\u27e8v:0.5%\u27e9");
  });

  it("stays strictly linear (median <= 5 ms on 10 KB adversarial inputs, AC-L0-15)", () => {
    const inputs: readonly string[] = [
      "9".repeat(10_000),
      ".".repeat(10_000),
      "1.".repeat(5_000),
      "1\u00b7".repeat(5_000),
      "(".repeat(10_000),
      "from 95% CI ".repeat(833),
      "95% CI ".repeat(1_428),
      "from 1 ".repeat(1_666),
      "1 ".repeat(5_000),
      "p<1 ".repeat(2_500),
      "12,345 ".repeat(1_429),
      "123," + "456,".repeat(2_500),
      "123\u2009" + "456\u2009".repeat(2_500),
      "000," + "000,".repeat(2_500),
    ];

    for (const s of inputs) {
      const qMs = medianMs(() => {
        extractQuantities(s);
      });
      const hMs = medianMs(() => {
        normalizedClaim(s);
      });
      expect(qMs).toBeLessThanOrEqual(5);
      expect(hMs).toBeLessThanOrEqual(5);
    }

    const deDots10k = "123." + "456.".repeat(2_500);
    expect(medianMs(() => extractQuantities(deDots10k, { lang: "de" }))).toBeLessThanOrEqual(5);
    expect(medianMs(() => normalizedClaim(deDots10k, { lang: "de" }))).toBeLessThanOrEqual(5);

    const h10Ms = medianMs(() => {
      normalizedClaim("1 ".repeat(5_000));
    });
    const h20Ms = medianMs(() => {
      normalizedClaim("1 ".repeat(10_000));
    });
    expect(h10Ms).toBeLessThanOrEqual(5);
    expect(h20Ms).toBeLessThan(Math.max(h10Ms * 3.0, 6.0));
  });

  it("handles zero-width + decomposed Latin without shifting normText vs normLowerText", () => {
    const zw = extractQuantities("Mu\u200b\u0308ller 5 mg");
    const ctrl = extractQuantities("M\u00fcller 5 mg");
    expect(zw).toHaveLength(1);
    expect(ctrl).toHaveLength(1);
    expect(zw[0]!.unitRaw).toBe("mg");
    expect(zw[0]!.unitCanon).toBe("mg");
    expect(zw[0]!.valueNorm).toBe(5);
    expect(zw[0]!.valueNorm).toBe(ctrl[0]!.valueNorm);
  });

  it("never absorbs numeric citation markers as Rule 2 intervals", () => {
    const c1 = extractQuantities("The effect was 2% [1, 3].");
    expect(c1).toHaveLength(1);
    expect(c1[0]!.valueNorm).toBe(2);
    expect(c1[0]!.valueLo).toBe(2);
    expect(c1[0]!.valueHi).toBe(2);

    const c2 = extractQuantities("Mean mortality was 30% [1, 2].");
    expect(c2).toHaveLength(1);
    expect(c2[0]!.valueNorm).toBe(30);
    expect(c2[0]!.valueLo).toBe(30);
    expect(c2[0]!.valueHi).toBe(30);
  });

  it("scales power-of-10 metric units without IEEE-754 multiplication drift", () => {
    for (const [micro, milli] of [
      ["9 \u03bcg", "0.009 mg"],
      ["13 \u03bcg", "0.013 mg"],
      ["71 \u03bcg", "0.071 mg"],
    ] as const) {
      const qMicro = extractQuantities(micro);
      const qMilli = extractQuantities(milli);
      expect(qMicro).toHaveLength(1);
      expect(qMilli).toHaveLength(1);
      expect(qMicro[0]!.valueNorm).toBe(qMilli[0]!.valueNorm);
      expect(normalizedClaim(micro)).toBe(normalizedClaim(milli));
      expect(normalizedClaimHash(micro)).toBe(normalizedClaimHash(milli));
    }
  });

  it("recognizes prefix interval cues (OR, HR) in Rule 2 even when point falls outside interval", () => {
    const orRes = extractQuantities("OR 0.8 (1.2-2.6)");
    expect(orRes).toHaveLength(1);
    expect(orRes[0]!.unitCanon).toBe("ratio:or");
    expect(orRes[0]!.valueNorm).toBe(0.8);
    expect(orRes[0]!.valueLo).toBe(1.2);
    expect(orRes[0]!.valueHi).toBe(2.6);

    const hrRes = extractQuantities("HR 0.8 (0.9-1.2)");
    expect(hrRes).toHaveLength(1);
    expect(hrRes[0]!.unitCanon).toBe("ratio:hr");
    expect(hrRes[0]!.valueNorm).toBe(0.8);
    expect(hrRes[0]!.valueLo).toBe(0.9);
    expect(hrRes[0]!.valueHi).toBe(1.2);
  });

  it("scales each bound individually and validates compatibility in standalone 95% CI", () => {
    const mixed = extractQuantities("95% CI 500 \u03bcg to 1.5 mg");
    expect(mixed).toHaveLength(1);
    expect(mixed[0]!.unitCanon).toBe("mg");
    expect(mixed[0]!.valueLo).toBe(0.5);
    expect(mixed[0]!.valueHi).toBe(1.5);
    expect(mixed[0]!.valueNorm).toBe(1);

    const incompat = extractQuantities("95% CI 5 mg to 10%");
    expect(incompat.length).toBe(3);
    expect(incompat.map((t) => [t.valueRaw, t.unitCanon])).toEqual([
      ["95", "%"],
      ["5", "mg"],
      ["10", "%"],
    ]);
    for (const t of incompat) {
      expect(t.valueLo).toBe(t.valueNorm);
      expect(t.valueHi).toBe(t.valueNorm);
    }
  });

  it("excludes slash-liter unit denominators and digit+unit tokens from keyLemmas while retaining standalone letter L", () => {
    const conc = extractQuantities("We compared 5 g/L with 10 mg/L overall.");
    expect(conc).toHaveLength(2);
    expect(conc[0]!.keyLemmas).toEqual(["compar", "overal"]);
    expect(conc[1]!.keyLemmas).toEqual(["compar", "overal"]);

    const grp = extractQuantities("Group L showed 5% gain.");
    expect(grp).toHaveLength(1);
    expect(grp[0]!.keyLemmas).toContain("l");

    const tight = extractQuantities("We gave 50mg and 100mg overall.");
    expect(tight).toHaveLength(2);
    expect(tight[0]!.keyLemmas).toEqual(["gave", "overal"]);
    expect(tight[1]!.keyLemmas).toEqual(["gave", "overal"]);

    const tightSlash = extractQuantities("We compared 5g/L with 10mg/L overall.");
    expect(tightSlash).toHaveLength(2);
    for (const t of tightSlash) {
      expect(t.keyLemmas).not.toContain("5g");
      expect(t.keyLemmas).not.toContain("10mg");
      expect(t.keyLemmas).not.toContain("l");
    }
  });

  it("rejects Rule 7 range merging when only a carries a trailing unit (5 mg - 10)", () => {
    const a = extractQuantities("5 mg - 10");
    expect(a).toHaveLength(2);
    expect(a[0]!.valueRaw).toBe("5");
    expect(a[0]!.unitCanon).toBe("mg");
    expect(a[1]!.valueRaw).toBe("10");

    const b = extractQuantities("5 mg - 10 participants");
    expect(b).toHaveLength(2);
    expect(b[0]!.unitCanon).toBe("mg");
    expect(b[1]!.unitCanon).toBe("count");
  });

  it("recognizes Cohen's d end-to-end without '=' cue", () => {
    for (const sample of ["Cohen's d was 0.8 overall.", "Cohen\u2019s d of 0.8 overall."]) {
      const meta = extractQuantitiesWithMeta(sample);
      expect(meta.tuples).toHaveLength(1);
      expect(meta.tuples[0]!.metricClass).toBe("effect_size");
      expect(meta.metricFromUnitByTupleIndex[0]).toBe(false);
    }
  });

  it("validates point-vs-interval unit compatibility and compares scaled values in Rule 2", () => {
    const pctVsMg = extractQuantities("Dose was 5 mg (2-10%).");
    expect(pctVsMg).toHaveLength(2);
    expect(pctVsMg[0]!.unitCanon).toBe("mg");
    expect(pctVsMg[0]!.valueHi).toBe(5);
    expect(pctVsMg[1]!.unitCanon).toBe("%");

    const ciPctVsMg = extractQuantities("Effect was 5 mg (95% CI 2-10%).");
    expect(ciPctVsMg.every((t) => t.unitCanon !== "mg" || t.valueHi === 5)).toBe(true);

    const daysVsMg = extractQuantities("Dose was 5 mg (95% CI 3 to 7 days).");
    expect(daysVsMg).toHaveLength(2);
    expect(daysVsMg[0]!.unitCanon).toBe("mg");
    expect(daysVsMg[0]!.valueHi).toBe(5);
    expect(daysVsMg[1]!.unitCanon).toBe("s");
    expect(daysVsMg[1]!.valueLo).toBe(259200);
    expect(daysVsMg[1]!.valueHi).toBe(604800);

    const mixedMass = extractQuantities("5 g (1000 mg - 7000 mg)");
    expect(mixedMass).toHaveLength(1);
    expect(mixedMass[0]!.valueRaw).toBe("5");
    expect(mixedMass[0]!.unitRaw).toBe("g");
    expect(mixedMass[0]!.unitCanon).toBe("mg");
    expect(mixedMass[0]!.valueNorm).toBe(5000);
    expect(mixedMass[0]!.valueLo).toBe(1000);
    expect(mixedMass[0]!.valueHi).toBe(7000);
  });

  it("does not emit spurious exponent tuples on R^2 or R² and skips non-finite scaled overflow", () => {
    const rCaret = extractQuantitiesWithMeta("R^2 was 0.64 overall.");
    expect(rCaret.tuples).toHaveLength(1);
    expect(rCaret.tuples[0]!.valueRaw).toBe("0.64");
    expect(rCaret.tuples[0]!.metricClass).toBe("effect_size");

    const rSup = extractQuantitiesWithMeta("R\u00b2 was 0.64 overall.");
    expect(rSup.tuples).toHaveLength(1);
    expect(rSup.tuples[0]!.valueRaw).toBe("0.64");
    expect(rSup.tuples[0]!.metricClass).toBe("effect_size");

    expect(normalizedClaim("R^2 = 0.64")).toBe("r^2 = \u27e8v:0.64\u27e9");

    const overflow = extractQuantities("1e305 kg");
    expect(overflow).toHaveLength(0);
    expect(normalizedClaim("1e305 kg")).not.toContain("Infinity");
  });

  it("matches sha256hex exactly in createSha256PrefixHasher across boundaries and UTF-8", () => {
    const prefixes = ["", "abc|", "x".repeat(64), "|" + "a".repeat(64) + "|0|", "αβγ|\uD800|"];
    const suffixes = ["", "0|other|1", "z".repeat(260), "−5|mg|μg\uDFFF"];
    for (const p of prefixes) {
      const h = createSha256PrefixHasher(p);
      for (const s of suffixes) {
        const expected = sha256hex(p + s);
        expect(h.digestHex(s)).toBe(expected);
        expect(h.digestHex32(s)).toBe(expected.slice(0, 32));
      }
    }
  });

  it("handles overflow thousands chains and overflowing scientific literals in O(n) without partial fallbacks", () => {
    const commaOverflow = "123," + "456,".repeat(104);
    expect(extractQuantities(commaOverflow)).toEqual([]);
    expect(normalizedClaim(commaOverflow)).not.toContain("Infinity");

    const thinOverflow = "123\u2009" + "456\u2009".repeat(104);
    expect(extractQuantities(thinOverflow)).toEqual([]);

    const leadZeroMany = "0," + "000,".repeat(200) + "001";
    const lzTuples = extractQuantities(leadZeroMany);
    expect(lzTuples).toHaveLength(1);
    expect(lzTuples[0]!.valueNorm).toBe(1);

    for (const sciOver of ["1e310", "1e310 kg", "2.5 \u00d7 10^400 mg", "-1e310"]) {
      expect(extractQuantities(sciOver)).toEqual([]);
    }
    expect(normalizedClaim("1e310 kg")).toBe("1e310 kg");
  });

  it("respects explicit applyLatex: false even when backslashes are present", () => {
    const tex = "\\SI{5}{\\milli\\gram}";
    const withDefaultLatex = extractQuantities(tex);
    expect(withDefaultLatex).toHaveLength(1);
    expect(withDefaultLatex[0]!.unitCanon).toBe("mg");
    expect(normalizedClaim(tex)).toBe("\u27e8v:5mg\u27e9");

    const disabledQ = extractQuantities(tex, { applyLatex: false });
    expect(disabledQ).toHaveLength(1);
    expect(disabledQ[0]!.valueNorm).toBe(5);
    expect(disabledQ[0]!.unitCanon).toBe("");

    const disabledClaim = normalizedClaim(tex, { applyLatex: false });
    expect(disabledClaim).not.toBe("\u27e8v:5mg\u27e9");
    expect(disabledClaim).toContain("\u27e8v:5\u27e9");
  });

  it("handles huge >=309-digit exponents safely without mantissa fallback", () => {
    const bigDigits = "9".repeat(310);
    const bigSups = "\u2079".repeat(310);
    for (const hugeOver of [
      `1e${bigDigits}`,
      `1 \u00d7 10^${bigDigits}`,
      `1 \u00d7 10^{${bigDigits}}`,
      `1 \u00d7 10${bigSups}`,
    ]) {
      expect(extractQuantities(hugeOver)).toEqual([]);
      expect(normalizedClaim(hugeOver)).not.toContain("\u27e8v:1\u27e9");
    }

    for (const hugeUnder of [`1e-${bigDigits}`, `-1e-${bigDigits}`]) {
      const q = extractQuantities(hugeUnder);
      expect(q).toHaveLength(1);
      expect(Object.is(q[0]!.valueNorm, 0)).toBe(true);
      expect(normalizedClaim(hugeUnder)).toBe("\u27e8v:0\u27e9");
    }

    const zeroExp = extractQuantities(`0e${bigDigits}`);
    expect(zeroExp).toHaveLength(1);
    expect(Object.is(zeroExp[0]!.valueNorm, 0)).toBe(true);

    const huge10k = "1e" + "9".repeat(9_998);
    expect(medianMs(() => extractQuantities(huge10k))).toBeLessThanOrEqual(5);
    expect(medianMs(() => normalizedClaim(huge10k))).toBeLessThanOrEqual(5);
  });

  it("normalizes -0 to +0 in Rule 4 p-values", () => {
    for (const pNegZero of ["p = -0.0", "p = -0"]) {
      const res = extractQuantities(pNegZero);
      expect(res).toHaveLength(1);
      expect(res[0]!.metricClass).toBe("p_value");
      expect(res[0]!.pComparator).toBe("=");
      expect(Object.is(res[0]!.valueNorm, 0)).toBe(true);
      expect(Object.is(res[0]!.valueLo, 0)).toBe(true);
      expect(Object.is(res[0]!.valueHi, 0)).toBe(true);
    }
  });

  it("applies identical percentage-context detection across extractQuantities and normalizedClaim", () => {
    for (const sample of [
      "A 2 points drop from 5 per cent.",
      "A 2 points drop from 5 pct.",
    ]) {
      const q = extractQuantities(sample);
      expect(q).toHaveLength(2);
      expect(q[0]!.unitCanon).toBe("pp");
      expect(q[0]!.valueNorm).toBe(2);
      expect(q[1]!.unitCanon).toBe("%");
      expect(q[1]!.valueNorm).toBe(5);
      expect(normalizedClaim(sample)).toBe("a \u27e8v:2pp\u27e9 drop from \u27e8v:5%\u27e9");
    }

    for (const negSample of [
      "A 2 points drop per century.",
      "A 2 points drop on the score.",
    ]) {
      const q = extractQuantities(negSample);
      expect(q).toHaveLength(1);
      expect(q[0]!.unitCanon).toBe("");
      expect(normalizedClaim(negSample)).not.toContain("\u27e8v:2pp\u27e9");
    }
  });
});
