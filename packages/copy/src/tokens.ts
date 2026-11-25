/**
 * Canonical color tokens, status glyph inventory, and WCAG 2.2 relative-luminance
 * contrast helpers (`docs/spec/06_CLIENTS_UI_AND_MONOREPO.md` §1.2, §1.4).
 *
 * Pure module: zero Firebase, DOM, network, Node I/O, clock, or regex usage.
 */

import type { ClauseState } from "@toulmin/schemas";
import rawGlyphs from "../glyphs.json" with { type: "json" };
import rawTokens from "../tokens.json" with { type: "json" };

export type ColorTokenName =
  | "--t-red"
  | "--t-hint"
  | "--t-amber"
  | "--t-blue"
  | "--t-grey"
  | "--t-green"
  | "--t-purple";

export interface ColorTokenEntry {
  readonly light: string;
  readonly dark: string;
  readonly specContrastLight: number;
  readonly specContrastDark: number;
}

export interface ClauseMarkSpec {
  readonly token: ColorTokenName | null;
  readonly mark: string;
  readonly glyph: string | null;
}

export interface TokensAsset {
  readonly backgrounds: {
    readonly light: string;
    readonly dark: string;
  };
  readonly contrastTargets: {
    readonly textMin: number;
    readonly nonTextMin: number;
  };
  readonly tokens: Readonly<Record<ColorTokenName, ColorTokenEntry>>;
  readonly clauseStateMarks: Readonly<Record<ClauseState, ClauseMarkSpec>>;
  readonly flagMarks: Readonly<
    Record<
      "B5_MISMATCH" | "LAB_NOTE_MISMATCH" | "CHECK_CITATION" | "JOB_IN_FLIGHT",
      { readonly token: ColorTokenName; readonly mark: string; readonly glyph: string }
    >
  >;
}

export interface GlyphDefinition {
  readonly symbol: string;
  readonly codepoints: readonly string[];
  readonly role: string;
}

export interface GlyphsAsset {
  readonly fontFamily: string;
  readonly glyphs: Readonly<Record<string, GlyphDefinition>>;
}

export const TOKENS_CONFIG: TokensAsset = rawTokens as unknown as TokensAsset;
export const COLOR_TOKENS = TOKENS_CONFIG.tokens;
export const THEME_BACKGROUNDS = TOKENS_CONFIG.backgrounds;
export const CONTRAST_TARGETS = TOKENS_CONFIG.contrastTargets;
export const CLAUSE_STATE_MARKS = TOKENS_CONFIG.clauseStateMarks;
export const FLAG_MARKS = TOKENS_CONFIG.flagMarks;
export const GLYPHS_CONFIG: GlyphsAsset = rawGlyphs as unknown as GlyphsAsset;
export const GLYPHS = GLYPHS_CONFIG.glyphs;

function hexByte(hex: string, offset: number): number {
  const parsed = Number.parseInt(hex.slice(offset, offset + 2), 16);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid hex color byte in "${hex}"`);
  }
  return parsed;
}

export function parseHexRgb(hex: string): readonly [number, number, number] {
  if (!hex.startsWith("#") || hex.length !== 7) {
    throw new Error(`Expected #RRGGBB hex color, got "${hex}"`);
  }
  return [hexByte(hex, 1), hexByte(hex, 3), hexByte(hex, 5)];
}

function linearizeChannel(byteVal: number): number {
  const srgb = byteVal / 255;
  return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
}

/**
 * WCAG 2.2 relative luminance `L` in `[0, 1]`.
 */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHexRgb(hex);
  return (
    0.2126 * linearizeChannel(r) +
    0.7152 * linearizeChannel(g) +
    0.0722 * linearizeChannel(b)
  );
}

/**
 * WCAG 2.2 contrast ratio `(L1 + 0.05) / (L2 + 0.05)` where `L1 >= L2`.
 */
export function contrastRatio(foregroundHex: string, backgroundHex: string): number {
  const l1 = relativeLuminance(foregroundHex);
  const l2 = relativeLuminance(backgroundHex);
  const lighter = l1 >= l2 ? l1 : l2;
  const darker = l1 >= l2 ? l2 : l1;
  return (lighter + 0.05) / (darker + 0.05);
}
