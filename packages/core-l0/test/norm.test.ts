import { describe, expect, it } from "vitest";
import {
  NORM_TABLE,
  codePointAtSafe,
  foldLatin,
  generalCategory,
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
  sha256hex,
  sha256hexBytes,
  simpleLowerCodePoint,
  utf8Encode
} from "../src/index.js";

function assertOffsetInvariants(input: string, res: { text: string; map: number[] }): void {
  expect(res.map.length).toBe(res.text.length + 1);
  expect(res.map[res.text.length]).toBe(input.length);
  let badIndex = -1;
  for (let i = 0; i < res.map.length; i += 1) {
    const val = res.map[i]!;
    if (!Number.isInteger(val) || val < 0 || val > input.length) {
      badIndex = i;
      break;
    }
    if (i > 0 && val < res.map[i - 1]!) {
      badIndex = i;
      break;
    }
  }
  expect(badIndex).toBe(-1);
}

describe("explicit character classes (02 §2.1)", () => {
  it("classifies LETTER including trailing Mn/Mc marks and rejects orphaned marks or surrogates", () => {
    // Leading combining mark has no preceding letter
    expect(isLetterAt("\u0308a", 0)).toBe(false);
    expect(isLetterAt("\u0308a", 1)).toBe(true);

    // Base letter followed by Mn + Mc marks
    const dev = "\u0915\u093e\u0902"; // Devanagari ka + vowel sign aa (Mc) + anusvara (Mn)
    expect(isBaseLetter(0x0915)).toBe(true);
    expect(generalCategory(0x093e)).toBe("Mc");
    expect(generalCategory(0x0902)).toBe("Mn");
    expect(isCombiningMark(0x093e)).toBe(true);
    expect(isCombiningMark(0x0902)).toBe(true);
    expect(isLetterAt(dev, 0)).toBe(true);
    expect(isLetterAt(dev, 1)).toBe(true);
    expect(isLetterAt(dev, 2)).toBe(true);

    // Supplementary letter followed by supplementary Mn (U+10EFD Arabic mark from 15.0)
    const supp = "\ud87a\udff0\ud803\udefd"; // U+2EBF0 (Lo) + U+10EFD (Mn)
    expect(isLetterAt(supp, 0)).toBe(true);
    expect(isLetterAt(supp, 2)).toBe(true);

    // Unpaired surrogates classify as Cs and never as LETTER
    const loneHigh = String.fromCharCode(0xd800);
    const loneLow = String.fromCharCode(0xdc00);
    expect(generalCategory(0xd800)).toBe("Cs");
    expect(generalCategory(0xdc00)).toBe("Cs");
    expect(isLetter(0xd800, true)).toBe(false);
    expect(isLetterAt(loneHigh + "\u0308", 0)).toBe(false);
    expect(isLetterAt(loneHigh + "\u0308", 1)).toBe(false);
    expect(isLetterAt(loneLow + "a", 0)).toBe(false);
    expect(isLetterAt(loneLow + "a", 1)).toBe(true);
  });

  it("classifies UPPER (Lu, Lt) and LOWER (Ll) accurately from Unicode 15.1.0", () => {
    expect(isUpper(0x0041)).toBe(true); // 'A' Lu
    expect(isUpper(0x01c5)).toBe(true); // 'ǅ' Lt (Titlecase Letter)
    expect(isLower(0x01c5)).toBe(false);
    expect(isBaseLetter(0x01c5)).toBe(true);
    expect(isLower(0x0061)).toBe(true); // 'a' Ll
    expect(isUpper(0x02b0)).toBe(false); // Lm modifier letter
    expect(isLower(0x02b0)).toBe(false);
    expect(isBaseLetter(0x02b0)).toBe(true);
    expect(isUpper(0x1c89)).toBe(false); // Cn in 15.1, Lu in 16.0
    expect(simpleLowerCodePoint(0x0130)).toBe(0x0069); // raw bin keeps UCD field 13
  });

  it("classifies DIGIT (ASCII 0-9 only), SPACE, PUNCT_SENT, CLOSERS, and KEY_CHAR", () => {
    for (let cp = 0x30; cp <= 0x39; cp += 1) {
      expect(isDigit(cp)).toBe(true);
    }
    expect(isDigit(0xff10)).toBe(false); // full-width zero before norm()
    expect(isDigit(0x0660)).toBe(false); // Arabic-Indic digit zero

    expect(isSpace(0x20)).toBe(true);
    expect(isSpace(0x09)).toBe(true);
    expect(isSpace(0x0a)).toBe(true);
    expect(isSpace(0x0d)).toBe(true);
    expect(isSpace(0x00a0)).toBe(false);
    expect(isSpace(0x000b)).toBe(false);

    expect(isPunctSent(0x2e)).toBe(true);
    expect(isPunctSent(0x3f)).toBe(true);
    expect(isPunctSent(0x21)).toBe(true);
    expect(isPunctSent(0x3b)).toBe(false);

    for (const ch of ['"', "'", ")", "]", "}"]) {
      expect(isCloser(ch.charCodeAt(0))).toBe(true);
    }
    expect(isCloser("(".charCodeAt(0))).toBe(false);

    const allowedKeyPunct = "_:.#$%&-+?<>~/'";
    for (const ch of allowedKeyPunct) {
      expect(isKeyChar(ch.charCodeAt(0))).toBe(true);
    }
    expect(isKeyChar("A".charCodeAt(0))).toBe(true);
    expect(isKeyChar("z".charCodeAt(0))).toBe(true);
    expect(isKeyChar("0".charCodeAt(0))).toBe(true);
    expect(isKeyChar(",".charCodeAt(0))).toBe(false);
    expect(isKeyChar(";".charCodeAt(0))).toBe(false);
    expect(isKeyChar(" ".charCodeAt(0))).toBe(false);
    expect(isKeyChar("{".charCodeAt(0))).toBe(false);
    expect(isKeyChar("@".charCodeAt(0))).toBe(false);

    expect(isPunctuation(0x2c)).toBe(true); // Po
    expect(isMarkMnOrMe(0x0308)).toBe(true); // Mn
    expect(isMarkMnOrMe(0x20dd)).toBe(true); // Me
  });
});

describe("3-stage norm, offset map invariants, and edge cases (02 §2.2)", () => {
  it("handles empty and all-deleted strings while preserving map invariants", () => {
    const empty = norm("");
    expect(empty).toStrictEqual({ text: "", map: [0] });
    assertOffsetInvariants("", empty);

    const allDeleted = norm("\u200b\u200c\u200d\u2060\ufeff\u00ad");
    expect(allDeleted).toStrictEqual({ text: "", map: [6] });
    assertOffsetInvariants("\u200b\u200c\u200d\u2060\ufeff\u00ad", allDeleted);
  });

  it("handles Lancet mid-dot contextual distinction including full-width digits", () => {
    expect(norm("0\u00b745").text).toBe("0.45");
    expect(norm("\uff10\u00b7\uff14\uff15").text).toBe("0.45");
    expect(norm("1.2\u00b710\u207b\u00b3").text).toBe("1.2\u00d710^-3");
    expect(norm("1.2\u00b710\u00b3").text).toBe("1.2\u00d710^3");
    expect(norm("\uff11.\uff12\u00b7\uff11\uff10\u207b\u00b3").text).toBe("1.2\u00d710^-3");
    expect(norm("a\u00b7b").text).toBe("a\u00d7b");
    expect(norm("3\u00b7a").text).toBe("3\u00d7a");
    expect(norm("1\u00b7105").text).toBe("1.105");
  });

  it("recovers exact source substrings via map across composed, expanded, and deleted spans", () => {
    const src = "The \ufb01nding in Mu\u0308ller\u2019s\u00a0\tstudy (0\u00b745\u20261\u00bd\u207a\u2074) held.";
    const res = norm(src);
    assertOffsetInvariants(src, res);

    const mullerIdx = res.text.indexOf("M\u00fcller");
    expect(mullerIdx).toBeGreaterThanOrEqual(0);
    const mullerEnd = mullerIdx + "M\u00fcller".length;
    expect(src.slice(res.map[mullerIdx], res.map[mullerEnd])).toBe("Mu\u0308ller");

    const low = normLowerWithMap(src);
    expect(low.map).toStrictEqual(res.map);
    assertOffsetInvariants(src, low);
  });

  it("preserves script-aware joiners across Indic, Semitic, and Emoji ranges and rejects ASCII/edges", () => {
    expect(isJoinerPreservedScript(0x0915)).toBe(true); // Devanagari
    expect(isJoinerPreservedScript(0x0951)).toBe(true); // Devanagari stress mark
    expect(isJoinerPreservedScript(0x0628)).toBe(true); // Arabic
    expect(isJoinerPreservedScript(0x0640)).toBe(true); // Arabic tatweel
    expect(isJoinerPreservedScript(0x0651)).toBe(true); // Arabic shadda
    expect(isJoinerPreservedScript(0x05d0)).toBe(true); // Hebrew
    expect(isJoinerPreservedScript(0x09cd)).toBe(true); // Bengali
    expect(isJoinerPreservedScript(0x0bcd)).toBe(true); // Tamil
    expect(isJoinerPreservedScript(0x0c4d)).toBe(true); // Telugu
    expect(isJoinerPreservedScript(0x0ccd)).toBe(true); // Kannada
    expect(isJoinerPreservedScript(0x0d4d)).toBe(true); // Malayalam
    expect(isJoinerPreservedScript(0x0a4d)).toBe(true); // Gurmukhi
    expect(isJoinerPreservedScript(0x0acd)).toBe(true); // Gujarati
    expect(isJoinerPreservedScript(0x0dca)).toBe(true); // Sinhala
    expect(isJoinerPreservedScript(0x1f469)).toBe(true); // Emoji
    expect(isJoinerPreservedScript(0xfe0f)).toBe(true); // VS16

    expect(isJoinerPreservedScript(0x200c)).toBe(false);
    expect(isJoinerPreservedScript(0x200d)).toBe(false);
    expect(isJoinerPreservedScript(0x061c)).toBe(false);
    expect(isJoinerPreservedScript(0xfeff)).toBe(false);
    expect(isJoinerPreservedScript(0x0023)).toBe(false); // '#'
    expect(isJoinerPreservedScript(0x0031)).toBe(false); // '1'
    expect(isJoinerPreservedScript(0x0061)).toBe(false); // 'a'

    // Leading/trailing joiner next to Devanagari still has no left/right neighbour
    expect(norm("\u200c\u0915\u200d").text).toBe("\u0915");
    // Keycap emoji sequence '#' + U+FE0F + U+20E3 does not have ASCII '#' treated as Emoji script
    expect(norm("1\u200d2").text).toBe("12");
  });

  it("handles unpaired surrogates safely in norm, normLower, foldLatin, and sha256hex", () => {
    const weird = "x" + String.fromCharCode(0xd800) + "y" + String.fromCharCode(0xdfff) + "z";
    const n = norm(weird);
    expect(n.text).toBe(weird);
    assertOffsetInvariants(weird, n);
    expect(normLower(weird)).toBe(weird);
    expect(foldLatin(weird)).toBe(weird);

    const bytes = utf8Encode(String.fromCharCode(0xd800));
    expect(Array.from(bytes)).toStrictEqual([0xef, 0xbf, 0xbd]);
    expect(sha256hex(String.fromCharCode(0xd800))).toBe(sha256hex("\ufffd"));
    expect(sha256hexBytes(new Uint8Array([0x61, 0x62, 0x63]))).toBe(sha256hex("abc"));
    expect(codePointAtSafe(weird, 1)).toStrictEqual({
      cp: 0xd800,
      len: 1,
      isUnpairedSurrogate: true
    });
    expect(() => codePointAtSafe(weird, -1)).toThrow(RangeError);
    expect(() => codePointAtSafe(weird, weird.length)).toThrow(RangeError);
  });

  it("contains complete non-stubbed norm_table.json sections matching 02 §2 and §9", () => {
    expect(Object.keys(NORM_TABLE.latin_compose).length).toBe(849);
    // Verify canonical combining mark equivalences (U+0340, U+0341, U+0344) inside U+0300..U+036F
    expect(norm("A\u0340").text).toBe("\u00c0");
    expect(norm("A\u0341").text).toBe("\u00c1");
    expect(norm("I\u0344").text).toBe("\u1e2e");
    expect(norm("u\u0344").text).toBe("\u01d8");
    expect(norm("U\u0308\u0341").text).toBe("\u01d7");
    expect(norm("\u00dc\u0341").text).toBe("\u01d7");
    for (const target of Object.values(NORM_TABLE.latin_compose)) {
      const cp = target.codePointAt(0)!;
      const inTargetBlocks =
        (cp >= 0x0080 && cp <= 0x024f) || (cp >= 0x1e00 && cp <= 0x1eff);
      expect(inTargetBlocks).toBe(true);
    }
    expect(Object.keys(NORM_TABLE.map).length).toBeGreaterThanOrEqual(160);
    expect(NORM_TABLE.lower_overrides["\u0130"]).toBe("\u0130");
    expect(Object.keys(NORM_TABLE.latin_fold).length).toBeGreaterThanOrEqual(500);
    expect(Object.keys(NORM_TABLE.compat_fold).length).toBeGreaterThanOrEqual(2300);
    expect(Object.keys(NORM_TABLE.confusables).length).toBeGreaterThanOrEqual(75);
    expect(Object.keys(NORM_TABLE.SYMBOL_PUA_TABLE).length).toBeGreaterThanOrEqual(150);

    // Verify specific compat_fold, confusable, and Symbol PUA entries from 02 §9
    expect(NORM_TABLE.compat_fold["\ud835\udc22"]).toBe("i"); // bold '𝐢'
    expect(NORM_TABLE.compat_fold["\ud835\udc08"]).toBe("i"); // bold '𝐈'
    expect(NORM_TABLE.compat_fold["\u24b6"]).toBe("a"); // circled 'Ⓐ'
    expect(NORM_TABLE.compat_fold["\u1d00"]).toBe("a"); // small cap 'ᴀ'
    expect(NORM_TABLE.confusables["\u0430"]).toBe("a"); // Cyrillic 'а'
    expect(NORM_TABLE.confusables["\u0440"]).toBe("p"); // Cyrillic 'р'
    expect(NORM_TABLE.confusables["\u03bf"]).toBe("o"); // Greek 'ο'
    expect(NORM_TABLE.confusables["\u03bd"]).toBe("v"); // Greek 'ν'
    expect(NORM_TABLE.confusables["\u03bc"]).toBeUndefined(); // Greek 'μ' NOT confusable
    expect(NORM_TABLE.confusables["\u03b2"]).toBeUndefined(); // Greek 'β' NOT confusable
    expect(NORM_TABLE.confusables["\u03ba"]).toBeUndefined(); // Greek 'κ' NOT confusable
    expect(NORM_TABLE.SYMBOL_PUA_TABLE["\uf0b1"]).toBe("\u00b1");
    expect(NORM_TABLE.SYMBOL_PUA_TABLE["\uf0a3"]).toBe("\u2264");
    expect(NORM_TABLE.SYMBOL_PUA_TABLE["\uf0b3"]).toBe("\u2265");
    expect(NORM_TABLE.SYMBOL_PUA_TABLE["\uf0b4"]).toBe("\u00d7");
    expect(NORM_TABLE.SYMBOL_PUA_TABLE["\uf0b0"]).toBe("\u00b0");
    expect(NORM_TABLE.SYMBOL_PUA_TABLE["\uf061"]).toBe("\u03b1");
    expect(NORM_TABLE.SYMBOL_PUA_TABLE["\uf06d"]).toBe("\u03bc");
    expect(NORM_TABLE.SYMBOL_PUA_TABLE["\uf07a"]).toBe("\u03b6");
  });

  it("runs norm and normLower in linear time (<= 5 ms median per 10 KB adversarial input)", () => {
    const adversarialInputs = [
      "(".repeat(10_240),
      "u" + "\u0308".repeat(10_239),
      ("u" + "\u0308".repeat(64)).repeat(160).slice(0, 10_240),
      ("1\u00b7" + "0".repeat(15) + "\u207b\u00b3").repeat(540).slice(0, 10_240),
      "\u200b\u200c\u200d\u2060\ufeff".repeat(2048)
    ];
    for (const input of adversarialInputs) {
      const durations: number[] = [];
      let lastRes: { text: string; map: number[] } = { text: "", map: [0] };
      for (let run = 0; run < 5; run += 1) {
        const start = Date.now();
        lastRes = normLowerWithMap(input);
        durations.push(Date.now() - start);
      }
      durations.sort((a, b) => a - b);
      expect(durations[2]!).toBeLessThanOrEqual(5);
      assertOffsetInvariants(input, lastRes);
    }
  });
});
