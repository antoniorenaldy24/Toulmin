import { describe, expect, it } from "vitest";
import { CLAUSE_STATES } from "@toulmin/schemas";
import {
  CLAUSE_STATE_MARKS,
  COLOR_TOKENS,
  CONTRAST_TARGETS,
  FLAG_MARKS,
  GLYPHS,
  THEME_BACKGROUNDS,
  contrastRatio,
  type ColorTokenName,
} from "../src/index.js";

describe("@toulmin/copy color tokens & glyph invariants (06 §1.2, §1.4)", () => {
  it("meets WCAG 2.2 >= 4.5:1 text and >= 3.0:1 non-text contrast in light and dark themes", () => {
    const tokenNames = Object.keys(COLOR_TOKENS) as ColorTokenName[];
    expect(tokenNames).toHaveLength(7);

    for (const name of tokenNames) {
      const entry = COLOR_TOKENS[name];
      const lightRatio = contrastRatio(entry.light, THEME_BACKGROUNDS.light);
      const darkRatio = contrastRatio(entry.dark, THEME_BACKGROUNDS.dark);

      expect(lightRatio).toBeGreaterThanOrEqual(CONTRAST_TARGETS.textMin);
      expect(lightRatio).toBeGreaterThanOrEqual(CONTRAST_TARGETS.nonTextMin);
      expect(darkRatio).toBeGreaterThanOrEqual(CONTRAST_TARGETS.textMin);
      expect(darkRatio).toBeGreaterThanOrEqual(CONTRAST_TARGETS.nonTextMin);

      expect(Math.abs(lightRatio - entry.specContrastLight)).toBeLessThan(0.02);
      expect(Math.abs(darkRatio - entry.specContrastDark)).toBeLessThan(0.02);
    }
  });

  it("enforces distinctness rules and full glyph/state coverage", () => {
    for (const state of CLAUSE_STATES) {
      expect(CLAUSE_STATE_MARKS[state]).toBeDefined();
    }

    // Distinctness rules (06 §1.2–§1.3): HINT never red; REVIEWED_BY_AUTHOR never green
    expect(CLAUSE_STATE_MARKS.HINT.token).toBe("--t-hint");
    expect(CLAUSE_STATE_MARKS.HINT.token).not.toBe("--t-red");
    expect(CLAUSE_STATE_MARKS.REVIEWED_BY_AUTHOR.token).toBe("--t-grey");
    expect(CLAUSE_STATE_MARKS.REVIEWED_BY_AUTHOR.token).not.toBe("--t-green");
    expect(CLAUSE_STATE_MARKS.PARTLY_SUPPORTED.glyph).not.toBe(
      CLAUSE_STATE_MARKS.MIXED_SUPPORT.glyph
    );
    expect(FLAG_MARKS.B5_MISMATCH.token).toBe("--t-purple");
    expect(FLAG_MARKS.LAB_NOTE_MISMATCH.token).toBe("--t-purple");

    const symbols = Object.values(GLYPHS).map((g) => g.symbol);
    for (const required of ["⚑", "✕", "◌", "◐", "ⓜ", "ⓘ", "✓?", "✓", "☑", "≠", "?", "⋯"]) {
      expect(symbols).toContain(required);
    }
  });
});
