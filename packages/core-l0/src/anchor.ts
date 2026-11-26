/**
 * Post-Decode Evidence Anchor Validator (L1 & L2) and Reasoning<->Verdict Check
 * (`docs/spec/03_L0_TIER_B_VALIDATOR_B5_INGEST.md` §2, `04` §1.4 & §4.1).
 *
 * Tier B pure module: zero Firebase, DOM, network, Node I/O, clock,
 * unseeded randomness, platform case/normalization APIs, or regular expressions.
 */

import { normalizedClaim } from "./claimHash.js";
import type { MetricClass } from "./metricClass.js";
import { codePointAtSafe, isDigit, isLetter, normLower } from "./norm.js";
import { formatCanonicalDecimal, prepareInput, toRawSpan, type PreparedInput } from "./numberParser.js";
import { BM25_STOPWORDS, porterStem } from "./porter.js";
import { extractQuantitiesWithMeta, type QuantTuple } from "./quantity.js";
import { unitFamilyOf, type UnitFamily } from "./units.js";
import type {
  AnchorFailReason,
  CloudVerdict,
  EvidenceAnchor,
  EvidenceSourceKind,
  L2Verdict,
  LocalVerdict,
  PComparator,
} from "@toulmin/schemas";

export type { AnchorFailReason, EvidenceAnchor, EvidenceSourceKind, LocalVerdict };

// ───────────────────────── Normative Constants (`03` §2.3) ─────────────────────────

export const CONTAINMENT_MIN = 0.75;
export const NEG_MARGIN = 4;
export const SCOPE_LOOKBACK = 12;
export const MIN_FRAGMENT_CONTENT = 3;
export const MIN_SPAN_CONTENT = 3;
export const MIN_CLAIM_OVERLAP = 2;
export const MEASURE_REACH = 3;

export const NEGATION_CUES: ReadonlySet<string> = new Set([
  "no",
  "not",
  "without",
  "neither",
  "nor",
  "never",
  "none",
  "cannot",
  "lack",
  "lacks",
  "lacked",
  "lacking",
  "absence",
  "absent",
  "fail",
  "fails",
  "failed",
  "failure",
  "unable",
  "insignificant",
  "nonsignificant",
  "unchanged",
]);

export const SOFT_NEG: ReadonlySet<string> = new Set(["similar", "comparable"]);

export const NEGATION_PREFIX = {
  prefixes: ["non", "un", "in"] as const,
  stems: new Set<string>([
    "significant",
    "significantly",
    "effective",
    "inferior",
    "superior",
    "different",
    "changed",
  ]),
} as const;

export const NON_NEGATING_IDIOMS: readonly (readonly string[])[] = [
  ["none", "the", "less"],
  ["no", "longer", "than"],
  ["no", "less", "than"],
  ["not", "only"],
  ["no", "doubt"],
  ["not", "until"],
  ["not", "least"],
  ["not", "inconsistent"],
  ["nonetheless"],
];

const NEG_EXCL_BEFORE_FAILURE: ReadonlySet<string> = new Set([
  "heart",
  "cardiac",
  "renal",
  "kidney",
  "liver",
  "hepatic",
  "respiratory",
  "organ",
  "multiorgan",
  "treatment",
  "graft",
  "ovarian",
  "engine",
  "system",
]);

const NEG_EXCL_AFTER_FAILURE: ReadonlySet<string> = new Set([
  "rate",
  "rates",
  "time",
  "mode",
  "modes",
]);

const NEG_EXCL_AFTER_SOFT: ReadonlySet<string> = new Set([
  "method",
  "methods",
  "approach",
  "design",
  "protocol",
  "procedure",
  "to",
]);

export const STRONG_NEG: ReadonlySet<string> = new Set([
  "no",
  "not",
  "without",
  "never",
  "neither",
  "nor",
  "none",
  "cannot",
  "lack",
  "lacks",
  "lacked",
  "lacking",
  "absence",
]);

export const COMPLEMENTIZERS: ReadonlySet<string> = new Set(["that", "whether", "of", "for", "on"]);

export const CLAUSE_STOP_PUNCT: ReadonlySet<string> = new Set([",", ";", ":", "(", ")"]);

export const CLAUSE_STOP_CONJ: ReadonlySet<string> = new Set([
  "and",
  "but",
  "whereas",
  "while",
  "although",
  "though",
  "however",
  "yet",
]);

export const CONCESSIVE: ReadonlySet<string> = new Set([
  "although",
  "though",
  "but",
  "however",
  "yet",
]);

export const QTY_UP: ReadonlySet<string> = new Set([
  "increase",
  "increased",
  "increases",
  "increasing",
  "rise",
  "rose",
  "risen",
  "rising",
  "higher",
  "greater",
  "more",
  "elevated",
  "raised",
  "gain",
  "gained",
  "enhanced",
  "larger",
  "longer",
]);

export const QTY_DOWN: ReadonlySet<string> = new Set([
  "decrease",
  "decreased",
  "decreases",
  "decreasing",
  "reduce",
  "reduced",
  "reduces",
  "reduction",
  "decline",
  "declined",
  "fell",
  "fall",
  "falls",
  "lower",
  "lowered",
  "less",
  "fewer",
  "drop",
  "dropped",
  "diminished",
  "smaller",
  "shorter",
]);

export const VAL_POS: ReadonlySet<string> = new Set([
  "improve",
  "improved",
  "improves",
  "improvement",
  "better",
  "benefit",
  "benefits",
  "beneficial",
  "alleviated",
  "relieved",
  "protective",
]);

export const VAL_NEG: ReadonlySet<string> = new Set([
  "worsen",
  "worsened",
  "worse",
  "worsening",
  "impaired",
  "deteriorated",
  "deterioration",
  "harm",
  "harmful",
  "aggravated",
  "exacerbated",
]);

export const ADVERSE_MEASURES: ReadonlySet<string> = new Set([
  "mortal",
  "death",
  "pain",
  "bleed",
  "advers",
  "complic",
  "risk",
  "relaps",
]);

export const GOOD_MEASURES: ReadonlySet<string> = new Set(["surviv", "respons", "remiss"]);

// ───────────────────────── Public Interfaces ─────────────────────────

export interface AnchorEvidenceUnit {
  readonly text: string;
  readonly rawText?: string;
  readonly map?: readonly number[];
  readonly refId?: string;
  readonly sourceKind?: EvidenceSourceKind;
  readonly chunkId?: string;
}

export type AnchorEvidenceInput = string | AnchorEvidenceUnit;

export interface Stage2ValidatorInput {
  readonly s01_evidence_span: string;
  readonly s02_evidence_idx: number;
  readonly s03_micro_reasoning: string;
  readonly s04_verdict: LocalVerdict | "NEI";
}

export type AnchorLayer = "L1" | "L2";

export interface ValidateAnchorOptions {
  readonly minSpanContent?: number;
  readonly lang?: string;
}

export interface ValidateLocalOptions extends ValidateAnchorOptions {
  readonly calibratedVariant?: { readonly schemaId: string; readonly reasoningCap: number };
  readonly actualVariant?: { readonly schemaId: string; readonly reasoningCap: number };
}

export interface AnchorTrace {
  readonly spanContentCount: number;
  readonly windowStart: number;
  readonly windowEnd: number;
  readonly containment: number | null;
  readonly negSpan: number;
  readonly negWin: number;
  readonly scopeNeg: number;
  readonly qualified: boolean;
  readonly sharedStemsCount: number;
  readonly needStems: number;
  readonly kindMismatch: boolean;
  readonly valueDiff: boolean;
  readonly negDiff: boolean;
  readonly dirDiff: boolean;
  readonly sameOrder: boolean;
  readonly identical: boolean;
}

export interface AnchorValidationResult {
  readonly verdict: LocalVerdict | "NEI";
  readonly anchor: EvidenceAnchor | null;
  readonly failReason: AnchorFailReason | null;
  readonly noDifferenceNote: boolean;
  readonly trace?: AnchorTrace;
}

export interface L2AnchorValidationResult {
  readonly verdict: CloudVerdict;
  readonly quote: string | null;
  readonly quoteAnchor: EvidenceAnchor | null;
  readonly failReason: AnchorFailReason | null;
  readonly noDifferenceNote: boolean;
}

export interface VToken {
  readonly text: string;
  readonly isNumeric: boolean;
  readonly value: number | null;
  readonly canonicalValue: string | null;
  readonly unitCanon: string;
  readonly unitFamily: UnitFamily;
  readonly isPercent: boolean;
  readonly metricClass: MetricClass | null;
  readonly metricFromUnit: boolean;
  readonly pComparator: PComparator | null;
  readonly origStart: number;
  readonly origEnd: number;
}

export interface VTokenization {
  readonly rawText: string;
  readonly tokens: readonly VToken[];
  readonly gapComparators: readonly (PComparator | null)[];
}

export interface BestWindowResult {
  readonly start: number;
  readonly end: number;
  readonly matchedIdx: readonly number[];
  readonly containment: number;
  readonly matchedContentCount: number;
  readonly totalContentCount: number;
}

export interface DirectionSummary {
  readonly qty: readonly [boolean, boolean];
  readonly val: readonly [boolean, boolean];
  readonly comp: readonly [boolean, boolean];
}

// ───────────────────────── Validation Tokenizer `vTok` (`03` §2.2) ─────────────────────────

function isClauseStopPunctChar(cu: number): boolean {
  return (
    cu === 44 /* ',' */ ||
    cu === 59 /* ';' */ ||
    cu === 58 /* ':' */ ||
    cu === 40 /* '(' */ ||
    cu === 41 /* ')' */
  );
}

function isSemicolonOrPeriod(cu: number): boolean {
  return cu === 59 /* ';' */ || cu === 46 /* '.' */;
}

function scanComparatorAtGap(text: string, start: number, end: number): PComparator | null {
  let found: PComparator | null = null;
  for (let i = start; i < end; i += 1) {
    const cu = text.charCodeAt(i);
    if (cu === 60 /* '<' */) {
      if (i + 1 < end && text.charCodeAt(i + 1) === 61) {
        found = "<=";
        i += 1;
      } else if (
        i + 1 < end &&
        text.charCodeAt(i + 1) === 45 /* '-' */ &&
        !(i + 2 < end && isDigit(text.charCodeAt(i + 2)))
      ) {
        // Skip arrow tokens such as `<-`, `<--`, `<->`
        i += 1;
      } else {
        found = "<";
      }
    } else if (cu === 0x2264 /* '≤' */) {
      found = "<=";
    } else if (cu === 62 /* '>' */) {
      if (i > start && text.charCodeAt(i - 1) === 45 /* '-' */) {
        // Skip arrow tokens such as `->`, `-->`, `<->`
        continue;
      }
      if (i + 1 < end && text.charCodeAt(i + 1) === 61) {
        found = ">=";
        i += 1;
      } else {
        found = ">";
      }
    } else if (cu === 0x2265 /* '≥' */) {
      found = ">=";
    } else if (cu === 61 /* '=' */) {
      found = "=";
    }
  }
  return found;
}

function scanIntraClauseBoundaryComparator(
  rawText: string,
  start: number,
  end: number,
  side: "left" | "right",
): PComparator | null {
  if (end <= start) return null;
  if (side === "left") {
    let effStart = start;
    for (let i = end - 1; i >= start; i -= 1) {
      if (isClauseStopPunctChar(rawText.charCodeAt(i))) {
        effStart = i + 1;
        break;
      }
    }
    return scanComparatorAtGap(rawText, effStart, end);
  }
  let effEnd = end;
  for (let i = start; i < end; i += 1) {
    if (isClauseStopPunctChar(rawText.charCodeAt(i))) {
      effEnd = i;
      break;
    }
  }
  return scanComparatorAtGap(rawText, start, effEnd);
}

function normalizeHyphenNegationPrefix(word: string): string {
  for (const p of NEGATION_PREFIX.prefixes) {
    if (word.startsWith(`${p}-`) && word.length > p.length + 1) {
      return `${p}${word.slice(p.length + 1)}`;
    }
  }
  return word;
}

function expandContractionOrEmit(
  wordLower: string,
  origStart: number,
  origEnd: number,
  out: VToken[],
): void {
  if (wordLower.length >= 4 && wordLower.endsWith("n't")) {
    let base: string;
    if (wordLower === "can't") {
      base = "ca";
    } else if (wordLower === "won't") {
      base = "wo";
    } else {
      base = wordLower.slice(0, wordLower.length - 3);
    }
    out.push(makeWordToken(base, origStart, origEnd));
    out.push(makeWordToken("not", origStart, origEnd));
    return;
  }
  const normalizedWord = normalizeHyphenNegationPrefix(wordLower);
  out.push(makeWordToken(normalizedWord, origStart, origEnd));
}

function makeWordToken(text: string, origStart: number, origEnd: number): VToken {
  return {
    text,
    isNumeric: false,
    value: null,
    canonicalValue: null,
    unitCanon: "",
    unitFamily: "none",
    isPercent: false,
    metricClass: null,
    metricFromUnit: false,
    pComparator: null,
    origStart,
    origEnd,
  };
}

function makeNumericToken(
  tuple: QuantTuple,
  metricFromUnit: boolean,
  isPercentOverride: boolean,
  origStart: number,
  origEnd: number,
): VToken {
  const val = tuple.valueNorm ?? 0;
  const canonicalValue = formatCanonicalDecimal(val);
  const unitCanon = isPercentOverride ? "%" : tuple.unitCanon;
  const unitFamily = isPercentOverride ? "percent" : unitFamilyOf(unitCanon);
  const isPercent = unitCanon === "%";
  const keyText = `#${canonicalValue}|${unitCanon}|${isPercent ? "%" : ""}`;
  return {
    text: keyText,
    isNumeric: true,
    value: val,
    canonicalValue,
    unitCanon,
    unitFamily,
    isPercent,
    metricClass: tuple.metricClass,
    metricFromUnit,
    pComparator: tuple.pComparator,
    origStart,
    origEnd,
  };
}

function isJoinChar(cu: number): boolean {
  return cu === 39 /* '\'' */ || cu === 45 /* '-' */;
}

function rawOffsetAtNorm(prep: PreparedInput, normIdx: number): number {
  if (prep.isCleanIdentityMap) {
    return normIdx;
  }
  const subIdx = prep.normMap[normIdx] ?? prep.subText.length;
  if (prep.latexMap === null) {
    return subIdx;
  }
  return prep.latexMap[subIdx] ?? prep.rawText.length;
}

function findNormRangeForRawSpan(
  prep: PreparedInput,
  rawStart: number,
  rawEnd: number,
  minNorm: number,
): { readonly normStart: number; readonly normEnd: number } {
  const n = prep.normLowerText.length;
  let normStart = Math.max(0, Math.min(minNorm, n));
  while (normStart < n && rawOffsetAtNorm(prep, normStart) < rawStart) {
    normStart += 1;
  }
  let normEnd = normStart;
  while (normEnd < n && rawOffsetAtNorm(prep, normEnd) < rawEnd) {
    normEnd += 1;
  }
  return { normStart, normEnd };
}

function isAsciiAlpha(cu: number): boolean {
  return (cu >= 65 && cu <= 90) || (cu >= 97 && cu <= 122);
}

function expandLeftOverLatexCommandOpener(
  rawText: string,
  minBound: number,
  start: number,
): number {
  if (start <= minBound || rawText.charCodeAt(start - 1) !== 123 /* '{' */) {
    return start;
  }
  let pos = start - 1;
  while (pos > minBound && rawText.charCodeAt(pos - 1) === 32) {
    pos -= 1;
  }
  if (pos > minBound && rawText.charCodeAt(pos - 1) === 93 /* ']' */) {
    let opt = pos - 2;
    while (opt >= minBound && rawText.charCodeAt(opt) !== 91 /* '[' */) {
      opt -= 1;
    }
    if (opt < minBound || rawText.charCodeAt(opt) !== 91) {
      return start;
    }
    pos = opt;
  }
  const lettersEnd = pos;
  while (pos > minBound && isAsciiAlpha(rawText.charCodeAt(pos - 1))) {
    pos -= 1;
  }
  if (pos < lettersEnd && pos > minBound && rawText.charCodeAt(pos - 1) === 92 /* '\\' */) {
    return pos - 1;
  }
  return start;
}

function scanPlainWordsInNormRange(
  prep: PreparedInput,
  startNorm: number,
  endNorm: number,
  out: VToken[],
): void {
  const normText = prep.normLowerText;
  const limit = Math.min(endNorm, normText.length);

  let i = startNorm;
  while (i < limit) {
    const u = codePointAtSafe(normText, i);
    const startsAsLetter = isLetter(u.cp, false);
    if (!startsAsLetter && !isDigit(u.cp)) {
      i += u.len;
      continue;
    }
    const tokStartNorm = i;
    i += u.len;
    let prevIsLetter = startsAsLetter;
    while (i < limit) {
      const cu = normText.charCodeAt(i);
      if (isJoinChar(cu)) {
        if (i + 1 < limit) {
          const nextU = codePointAtSafe(normText, i + 1);
          const nextStartsAsLetter = isLetter(nextU.cp, false);
          if (nextStartsAsLetter || isDigit(nextU.cp)) {
            i += 1 + nextU.len;
            prevIsLetter = nextStartsAsLetter;
            continue;
          }
        }
        break;
      }
      const curU = codePointAtSafe(normText, i);
      const curIsLetter = isLetter(curU.cp, prevIsLetter);
      if (curIsLetter || isDigit(curU.cp)) {
        i += curU.len;
        prevIsLetter = curIsLetter;
      } else {
        break;
      }
    }
    const wordLower = normText.slice(tokStartNorm, i);
    const rawSpan = toRawSpan(prep, tokStartNorm, i);
    const prevOrigEnd = out.length > 0 ? out[out.length - 1]!.origEnd : 0;
    const adjStart =
      prep.latexMap !== null
        ? expandLeftOverLatexCommandOpener(prep.rawText, prevOrigEnd, rawSpan.start)
        : rawSpan.start;
    expandContractionOrEmit(wordLower, adjStart, Math.max(adjStart, rawSpan.end), out);
  }
}

function matchFollowingPercentPhraseEnd(normLowerText: string, fromIdx: number): number {
  const n = normLowerText.length;
  let k = fromIdx;
  while (k < n && normLowerText.charCodeAt(k) === 32) k += 1;
  if (k === fromIdx && k < n && normLowerText.charCodeAt(k) !== 112 /* 'p' */) {
    return -1;
  }
  if (normLowerText.startsWith("percent", k)) {
    const after = k + 7;
    if (
      after >= n ||
      (!isLetter(codePointAtSafe(normLowerText, after).cp, false) &&
        !isDigit(codePointAtSafe(normLowerText, after).cp))
    ) {
      return after;
    }
  }
  if (normLowerText.startsWith("per cent", k)) {
    const after = k + 8;
    if (
      after >= n ||
      (!isLetter(codePointAtSafe(normLowerText, after).cp, false) &&
        !isDigit(codePointAtSafe(normLowerText, after).cp))
    ) {
      return after;
    }
  }
  return -1;
}

export function vTok(x: string, lang?: string): VTokenization {
  const prep = prepareInput(x, {
    applyLatex: true,
    ...(lang !== undefined ? { lang } : {}),
  });
  const { tuples, metricFromUnitByTupleIndex } = extractQuantitiesWithMeta(x, {
    applyLatex: true,
    citationSpans: [],
    ...(lang !== undefined ? { lang } : {}),
  });

  const tokens: VToken[] = [];
  let normCursor = 0;
  let rawCursor = 0;

  for (let idx = 0; idx < tuples.length; idx += 1) {
    const tuple = tuples[idx]!;
    const metricFromUnit = metricFromUnitByTupleIndex[idx] ?? false;
    if (tuple.span.start < rawCursor) continue;

    const { normStart: normSpanStart, normEnd: baseNormSpanEnd } = findNormRangeForRawSpan(
      prep,
      tuple.span.start,
      tuple.span.end,
      normCursor,
    );

    if (normSpanStart > normCursor) {
      scanPlainWordsInNormRange(prep, normCursor, normSpanStart, tokens);
    }

    let normValStart = normSpanStart;
    const valLower = normLower(tuple.valueRaw);
    if (valLower.length > 0 && baseNormSpanEnd > normSpanStart) {
      const rel = prep.normLowerText.slice(normSpanStart, baseNormSpanEnd).indexOf(valLower);
      if (rel !== -1) {
        normValStart = normSpanStart + rel;
      }
    }

    const tokensBeforePrefix = tokens.length;
    if (normValStart > normSpanStart) {
      scanPlainWordsInNormRange(prep, normSpanStart, normValStart, tokens);
    }
    const hasPrefixWords = tokens.length > tokensBeforePrefix;
    const prevOrigEnd = tokens.length > 0 ? tokens[tokens.length - 1]!.origEnd : 0;
    const rawNumStartBase = hasPrefixWords
      ? toRawSpan(prep, normValStart, Math.max(normValStart, baseNormSpanEnd)).start
      : tuple.span.start;
    const numOrigStart = hasPrefixWords
      ? rawNumStartBase
      : expandLeftOverLatexCommandOpener(x, prevOrigEnd, rawNumStartBase);

    let normSpanEnd = baseNormSpanEnd;
    let numOrigEnd = Math.max(numOrigStart, tuple.span.end);
    let isPercentOverride = false;
    if (tuple.unitCanon !== "%") {
      const pctEndNorm = matchFollowingPercentPhraseEnd(prep.normLowerText, baseNormSpanEnd);
      if (pctEndNorm !== -1) {
        normSpanEnd = pctEndNorm;
        numOrigEnd = Math.max(numOrigStart, toRawSpan(prep, normValStart, pctEndNorm).end);
        isPercentOverride = true;
      }
    }

    if (tuple.valueNorm !== null) {
      tokens.push(makeNumericToken(tuple, metricFromUnit, isPercentOverride, numOrigStart, numOrigEnd));
    } else {
      scanPlainWordsInNormRange(prep, normValStart, normSpanEnd, tokens);
    }
    normCursor = Math.max(normCursor, normSpanEnd);
    rawCursor = numOrigEnd;
  }

  if (normCursor < prep.normLowerText.length) {
    scanPlainWordsInNormRange(prep, normCursor, prep.normLowerText.length, tokens);
  }

  const gapComparators: (PComparator | null)[] = new Array(tokens.length + 1).fill(null);
  let prevEnd = 0;
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i]!;
    if (t.origStart > prevEnd) {
      gapComparators[i] = scanComparatorAtGap(x, prevEnd, t.origStart);
    }
    prevEnd = Math.max(prevEnd, t.origEnd);
  }
  if (prevEnd < x.length) {
    gapComparators[tokens.length] = scanComparatorAtGap(x, prevEnd, x.length);
  }

  return { rawText: x, tokens, gapComparators };
}

export function contentTokens(tokens: readonly VToken[]): VToken[] {
  const out: VToken[] = [];
  for (const t of tokens) {
    if (t.isNumeric || !BM25_STOPWORDS.has(t.text)) {
      out.push(t);
    }
  }
  return out;
}

function isNegationPrefixedWord(word: string): boolean {
  for (const p of NEGATION_PREFIX.prefixes) {
    if (word.startsWith(p) && NEGATION_PREFIX.stems.has(word.slice(p.length))) {
      return true;
    }
  }
  return false;
}

function isDirectionWord(word: string): boolean {
  return QTY_UP.has(word) || QTY_DOWN.has(word) || VAL_POS.has(word) || VAL_NEG.has(word);
}

function isNegationVocabularyWord(word: string): boolean {
  return (
    NEGATION_CUES.has(word) ||
    STRONG_NEG.has(word) ||
    SOFT_NEG.has(word) ||
    isNegationPrefixedWord(word)
  );
}

export function contentStems(tokens: readonly VToken[]): Set<string> {
  const out = new Set<string>();
  for (const t of tokens) {
    if (t.isNumeric) continue;
    if (BM25_STOPWORDS.has(t.text)) continue;
    if (isNegationVocabularyWord(t.text)) continue;
    if (isDirectionWord(t.text)) continue;
    out.add(porterStem(t.text));
  }
  return out;
}

// ───────────────────────── Negation, Direction, Measure Valence & Kind (`03` §2.3) ─────────────────────────

function sliceHasClauseStopPunct(text: string, start: number, end: number): boolean {
  for (let i = start; i < end; i += 1) {
    if (isClauseStopPunctChar(text.charCodeAt(i))) {
      return true;
    }
  }
  return false;
}

function sliceHasSemicolonOrPeriod(text: string, start: number, end: number): boolean {
  for (let i = start; i < end; i += 1) {
    if (isSemicolonOrPeriod(text.charCodeAt(i))) {
      return true;
    }
  }
  return false;
}

export function clauseStopBefore(rawText: string, toks: readonly VToken[], i: number): boolean {
  if (i <= 0 || i >= toks.length) return true;
  const prev = toks[i - 1]!;
  const curr = toks[i]!;
  if (CLAUSE_STOP_CONJ.has(prev.text)) return true;
  return sliceHasClauseStopPunct(rawText, prev.origEnd, curr.origStart);
}

export function clauseStopAfter(rawText: string, toks: readonly VToken[], i: number): boolean {
  if (i < 0 || i >= toks.length - 1) return true;
  const curr = toks[i]!;
  const next = toks[i + 1]!;
  if (CLAUSE_STOP_CONJ.has(next.text)) return true;
  return sliceHasClauseStopPunct(rawText, curr.origEnd, next.origStart);
}

function isExcludedBigram(prevText: string | undefined, curText: string, nextText: string | undefined): boolean {
  if (curText === "failure") {
    if (prevText !== undefined && NEG_EXCL_BEFORE_FAILURE.has(prevText)) return true;
    if (nextText !== undefined && NEG_EXCL_AFTER_FAILURE.has(nextText)) return true;
  }
  if (SOFT_NEG.has(curText) && nextText !== undefined && NEG_EXCL_AFTER_SOFT.has(nextText)) {
    return true;
  }
  return false;
}

export function isNeg(toks: readonly VToken[], i: number): boolean {
  if (i < 0 || i >= toks.length) return false;
  const cur = toks[i]!;
  if (cur.isNumeric) return false;
  const prevText = i > 0 && !toks[i - 1]!.isNumeric ? toks[i - 1]!.text : undefined;
  const nextText = i + 1 < toks.length && !toks[i + 1]!.isNumeric ? toks[i + 1]!.text : undefined;
  if (isExcludedBigram(prevText, cur.text, nextText)) {
    return false;
  }
  if (NEGATION_CUES.has(cur.text)) {
    return true;
  }
  return isNegationPrefixedWord(cur.text);
}

function stripNonNegatingIdioms(toks: readonly VToken[]): VToken[] {
  const out: VToken[] = [];
  let i = 0;
  while (i < toks.length) {
    let matchedLen = 0;
    for (const idiom of NON_NEGATING_IDIOMS) {
      if (i + idiom.length <= toks.length) {
        let ok = true;
        for (let j = 0; j < idiom.length; j += 1) {
          if (toks[i + j]!.isNumeric || toks[i + j]!.text !== idiom[j]) {
            ok = false;
            break;
          }
        }
        if (ok) {
          matchedLen = idiom.length;
          break;
        }
      }
    }
    if (matchedLen > 0) {
      i += matchedLen;
    } else {
      out.push(toks[i]!);
      i += 1;
    }
  }
  return out;
}

export function countNeg(toks: readonly VToken[], softActive: boolean): number {
  const cleaned = stripNonNegatingIdioms(toks);
  let count = 0;
  for (let i = 0; i < cleaned.length; i += 1) {
    if (isNeg(cleaned, i)) {
      count += 1;
    } else if (softActive && !cleaned[i]!.isNumeric && SOFT_NEG.has(cleaned[i]!.text)) {
      const prevText = i > 0 && !cleaned[i - 1]!.isNumeric ? cleaned[i - 1]!.text : undefined;
      const nextText =
        i + 1 < cleaned.length && !cleaned[i + 1]!.isNumeric ? cleaned[i + 1]!.text : undefined;
      if (!isExcludedBigram(prevText, cleaned[i]!.text, nextText)) {
        count += 1;
      }
    }
  }
  return count;
}

export function softFor(other: readonly VToken[]): boolean {
  for (let i = 0; i < other.length; i += 1) {
    const t = other[i]!;
    if (t.isNumeric) continue;
    if (STRONG_NEG.has(t.text)) return true;
    if (i + 1 < other.length && !other[i + 1]!.isNumeric) {
      const next = other[i + 1]!.text;
      if ((t.text === "no" && next === "difference") || (t.text === "not" && next === "differ")) {
        return true;
      }
    }
  }
  return false;
}

export function measureOf(
  rawText: string,
  toks: readonly VToken[],
  i: number,
): "ADVERSE" | "GOOD" | "NONE" {
  const near = new Set<string>();

  // Left up to MEASURE_REACH content tokens within the same clause
  let k = 0;
  let j = i - 1;
  while (j >= 0 && k < MEASURE_REACH && !clauseStopBefore(rawText, toks, j + 1)) {
    const tok = toks[j]!;
    if (tok.isNumeric || !BM25_STOPWORDS.has(tok.text)) {
      if (!tok.isNumeric) {
        near.add(porterStem(tok.text));
      }
      k += 1;
    }
    j -= 1;
  }

  // Right up to MEASURE_REACH content tokens within the same clause
  k = 0;
  j = i + 1;
  while (j < toks.length && k < MEASURE_REACH && !clauseStopAfter(rawText, toks, j - 1)) {
    const tok = toks[j]!;
    if (tok.isNumeric || !BM25_STOPWORDS.has(tok.text)) {
      if (!tok.isNumeric) {
        near.add(porterStem(tok.text));
      }
      k += 1;
    }
    j += 1;
  }

  let hasAdverse = false;
  let hasGood = false;
  for (const s of near) {
    if (ADVERSE_MEASURES.has(s)) hasAdverse = true;
    if (GOOD_MEASURES.has(s)) hasGood = true;
  }
  if (hasAdverse && !hasGood) return "ADVERSE";
  if (hasGood && !hasAdverse) return "GOOD";
  return "NONE";
}

export function direction(
  rawText: string,
  toks: readonly VToken[],
  gapComparators?: readonly (PComparator | null)[],
  sliceOffset: number = 0,
  allToks?: readonly VToken[],
): DirectionSummary {
  let up = false;
  let down = false;
  let pos = false;
  let neg = false;
  let gt = false;
  let lt = false;

  for (let i = 0; i < toks.length; i += 1) {
    const t = toks[i]!;
    if (t.isNumeric) {
      if (t.pComparator === ">" || t.pComparator === ">=") gt = true;
      if (t.pComparator === "<" || t.pComparator === "<=") lt = true;
    } else {
      if (QTY_UP.has(t.text)) up = true;
      if (QTY_DOWN.has(t.text)) down = true;
      if (VAL_POS.has(t.text)) pos = true;
      if (VAL_NEG.has(t.text)) neg = true;

      if (QTY_UP.has(t.text) || QTY_DOWN.has(t.text)) {
        const m = measureOf(rawText, toks, i);
        const isUp = QTY_UP.has(t.text);
        if (m === "ADVERSE") {
          if (isUp) neg = true;
          else pos = true;
        } else if (m === "GOOD") {
          if (isUp) pos = true;
          else neg = true;
        }
      }
    }
  }

  const recordComp = (comp: PComparator | null | undefined): void => {
    if (comp === ">" || comp === ">=") gt = true;
    if (comp === "<" || comp === "<=") lt = true;
  };

  if (gapComparators !== undefined) {
    if (toks.length === 0) {
      const endGap = Math.min(gapComparators.length - 1, sliceOffset);
      recordComp(gapComparators[endGap]);
    } else {
      const firstOrigStart = toks[0]!.origStart;
      const leadStart =
        sliceOffset > 0
          ? allToks !== undefined
            ? allToks[sliceOffset - 1]!.origEnd
            : 0
          : 0;
      if (allToks !== undefined || sliceOffset === 0) {
        recordComp(scanIntraClauseBoundaryComparator(rawText, leadStart, firstOrigStart, "left"));
      } else {
        // Clamp leading boundary without cross-clause punct/token leakage when allToks is omitted.
        let effStart = firstOrigStart;
        while (effStart > 0) {
          const prev = codePointAtSafe(rawText, effStart - 1);
          if (
            isClauseStopPunctChar(rawText.charCodeAt(effStart - 1)) ||
            isLetter(prev.cp, false) ||
            isDigit(prev.cp)
          ) {
            break;
          }
          effStart -= 1;
        }
        recordComp(scanComparatorAtGap(rawText, effStart, firstOrigStart));
      }

      const lastInternalGap = Math.min(gapComparators.length - 1, sliceOffset + toks.length - 1);
      for (let g = sliceOffset + 1; g <= lastInternalGap; g += 1) {
        recordComp(gapComparators[g]);
      }

      const trailGapIdx = sliceOffset + toks.length;
      const lastOrigEnd = toks[toks.length - 1]!.origEnd;
      if (allToks !== undefined) {
        const trailEnd = trailGapIdx < allToks.length ? allToks[trailGapIdx]!.origStart : rawText.length;
        recordComp(scanIntraClauseBoundaryComparator(rawText, lastOrigEnd, trailEnd, "right"));
      } else if (trailGapIdx < gapComparators.length) {
        let effEnd = lastOrigEnd;
        while (effEnd < rawText.length) {
          const cur = codePointAtSafe(rawText, effEnd);
          if (
            isClauseStopPunctChar(rawText.charCodeAt(effEnd)) ||
            isLetter(cur.cp, false) ||
            isDigit(cur.cp)
          ) {
            break;
          }
          effEnd += cur.len;
        }
        recordComp(scanComparatorAtGap(rawText, lastOrigEnd, effEnd));
      }
    }
  }

  return {
    qty: [up, down],
    val: [pos, neg],
    comp: [gt, lt],
  };
}

export function opposite(d1: DirectionSummary, d2: DirectionSummary): boolean {
  const axes: readonly (keyof DirectionSummary)[] = ["qty", "val", "comp"];
  for (const ax of axes) {
    const [u1, n1] = d1[ax];
    const [u2, n2] = d2[ax];
    if ((u1 && !n1 && n2 && !u2) || (n1 && !u1 && u2 && !n2)) {
      return true;
    }
  }
  return false;
}

export function equalValue(x: VToken, y: VToken): boolean {
  return x.isNumeric && y.isNumeric && x.canonicalValue === y.canonicalValue && x.isPercent === y.isPercent;
}

export function sameKind(x: VToken, y: VToken): boolean {
  if (!x.isNumeric || !y.isNumeric) return false;
  return (
    x.unitFamily === y.unitFamily &&
    x.isPercent === y.isPercent &&
    (!(x.metricFromUnit && y.metricFromUnit) || x.metricClass === y.metricClass)
  );
}

function tokenIdentityKey(t: VToken): string {
  if (t.isNumeric) {
    return `#${t.canonicalValue}|${t.unitCanon}|${t.isPercent}`;
  }
  return porterStem(t.text);
}

export function sharedSeq(a: readonly VToken[], b: readonly VToken[]): string[] {
  const bKeys = new Set<string>();
  for (const t of contentTokens(b)) {
    bKeys.add(tokenIdentityKey(t));
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of contentTokens(a)) {
    if (!t.isNumeric && (isNegationVocabularyWord(t.text) || isDirectionWord(t.text))) {
      continue;
    }
    const k = tokenIdentityKey(t);
    if (bKeys.has(k) && !seen.has(k)) {
      seen.add(k);
      out.push(k);
    }
  }
  return out;
}

// ───────────────────────── Matching & `bestWindow` (`03` §2.3–§2.4) ─────────────────────────

export function verbatimTokenWindow(
  evTok: readonly VToken[],
  spTok: readonly VToken[],
): { readonly start: number; readonly end: number } | null {
  if (spTok.length === 0 || spTok.length > evTok.length) return null;
  const limit = evTok.length - spTok.length;
  for (let s = 0; s <= limit; s += 1) {
    let ok = true;
    for (let j = 0; j < spTok.length; j += 1) {
      if (evTok[s + j]!.text !== spTok[j]!.text) {
        ok = false;
        break;
      }
    }
    if (ok) {
      return { start: s, end: s + spTok.length - 1 };
    }
  }
  return null;
}

export function splitFragments(span: string): string[] {
  const out: string[] = [];
  let cursor = 0;
  let i = 0;
  const n = span.length;
  while (i < n) {
    let delimLen = 0;
    if (span.startsWith("[...]", i)) {
      delimLen = 5;
    } else if (span.startsWith("...", i)) {
      delimLen = 3;
    } else if (span.charCodeAt(i) === 0x2026 /* '…' */) {
      delimLen = 1;
    }
    if (delimLen > 0) {
      const part = span.slice(cursor, i).trim();
      if (part.length > 0) out.push(part);
      i += delimLen;
      cursor = i;
    } else {
      i += 1;
    }
  }
  const tail = span.slice(cursor).trim();
  if (tail.length > 0) out.push(tail);
  return out;
}

export function bestWindow(
  evTok: readonly VToken[],
  fTok: readonly VToken[],
  from: number,
): BestWindowResult {
  const totalContentCount = contentTokens(fTok).length;
  if (fTok.length === 0 || from >= evTok.length) {
    return {
      start: from,
      end: from,
      matchedIdx: [],
      containment: 0,
      matchedContentCount: 0,
      totalContentCount,
    };
  }

  const m = fTok.length;
  const maxW = Math.ceil(1.5 * m) + 2;
  const fWeights = new Int32Array(m);
  const fIsContent = new Uint8Array(m);
  const fSet = new Set<string>();
  for (let i = 0; i < m; i += 1) {
    const t = fTok[i]!;
    const isContent = t.isNumeric || !BM25_STOPWORDS.has(t.text);
    fIsContent[i] = isContent ? 1 : 0;
    fWeights[i] = isContent ? 100 : 1;
    fSet.add(t.text);
  }

  let bestScore = 0;
  let bestWidth = Number.MAX_SAFE_INTEGER;
  let bestS = from;
  let bestT = from;

  // Incremental DP per start `s`: scores every end `t = s + k - 1` (`k <= maxW`) in one pass.
  let prevCol = new Int32Array(m + 1);
  let curCol = new Int32Array(m + 1);

  for (let s = from; s < evTok.length; s += 1) {
    if (!fSet.has(evTok[s]!.text)) continue;
    const availW = Math.min(maxW, evTok.length - s);
    prevCol.fill(0);

    for (let k = 1; k <= availW; k += 1) {
      const evStr = evTok[s + k - 1]!.text;
      curCol[0] = 0;
      for (let i = 1; i <= m; i += 1) {
        const up = curCol[i - 1]!;
        const left = prevCol[i]!;
        let best = up >= left ? up : left;
        if (fTok[i - 1]!.text === evStr) {
          const diag = prevCol[i - 1]! + fWeights[i - 1]!;
          if (diag > best) best = diag;
        }
        curCol[i] = best;
      }
      const score = curCol[m]!;
      if (
        score > bestScore ||
        (score > 0 && score === bestScore && (k < bestWidth || (k === bestWidth && s < bestS)))
      ) {
        bestScore = score;
        bestWidth = k;
        bestS = s;
        bestT = s + k - 1;
      }
      const tmp = prevCol;
      prevCol = curCol;
      curCol = tmp;
    }
  }

  if (bestScore === 0) {
    return {
      start: from,
      end: from,
      matchedIdx: [],
      containment: 0,
      matchedContentCount: 0,
      totalContentCount,
    };
  }

  // Exact DP + backtracking on the single winning [bestS, bestT] window (`03` §2.4 step 4).
  const wLen = bestT - bestS + 1;
  const cols = wLen + 1;
  const dp = new Int32Array((m + 1) * cols);

  for (let i = 1; i <= m; i += 1) {
    const fStr = fTok[i - 1]!.text;
    const fW = fWeights[i - 1]!;
    const rowOff = i * cols;
    const prevRowOff = (i - 1) * cols;
    for (let j = 1; j <= wLen; j += 1) {
      const up = dp[prevRowOff + j]!;
      const left = dp[rowOff + j - 1]!;
      let best = up >= left ? up : left;
      if (fStr === evTok[bestS + j - 1]!.text) {
        const diag = dp[prevRowOff + j - 1]! + fW;
        if (diag > best) best = diag;
      }
      dp[rowOff + j] = best;
    }
  }

  const matchedIdxRev: number[] = [];
  let matchedContentCount = 0;
  let bi = m;
  let bj = wLen;
  while (bi > 0 && bj > 0) {
    const curVal = dp[bi * cols + bj]!;
    if (fTok[bi - 1]!.text === evTok[bestS + bj - 1]!.text) {
      const diag = dp[(bi - 1) * cols + (bj - 1)]! + fWeights[bi - 1]!;
      if (diag === curVal) {
        matchedIdxRev.push(bestS + bj - 1);
        if (fIsContent[bi - 1] === 1) {
          matchedContentCount += 1;
        }
        bi -= 1;
        bj -= 1;
        continue;
      }
    }
    const leftVal = dp[bi * cols + (bj - 1)]!;
    if (leftVal === curVal) {
      bj -= 1;
    } else {
      bi -= 1;
    }
  }

  const matchedIdx = matchedIdxRev.reverse();
  const containment = totalContentCount > 0 ? matchedContentCount / totalContentCount : 0;
  const end = matchedIdx.length > 0 ? matchedIdx[matchedIdx.length - 1]! : bestS;

  return {
    start: bestS,
    end,
    matchedIdx,
    containment,
    matchedContentCount,
    totalContentCount,
  };
}

// ───────────────────────── Reasoning<->Verdict Check (`03` §2.5) ─────────────────────────

const REASONING_DELETE_IDIOMS: readonly (readonly string[])[] = [
  ["does", "not", "contradict"],
  ["do", "not", "contradict"],
  ["not", "contradicted"],
  ["not", "inconsistent"],
  ["not", "contradict"],
];

const REASONING_SUPPORT_CONFLICT_PHRASES: readonly (readonly string[])[] = [
  ["does", "not", "support"],
  ["do", "not", "support"],
  ["not", "supported"],
  ["contradict"],
  ["contradicts"],
  ["contradicted"],
  ["opposite"],
  ["conflicts"],
  ["inconsistent"],
  ["refutes"],
];

const REASONING_CONTRADICT_CONFLICT_PHRASES: readonly (readonly string[])[] = [
  ["consistent", "with"],
  ["supports"],
  ["confirms"],
  ["matches"],
];

const REASONING_NEI_CONFLICT_PHRASES: readonly (readonly string[])[] = [
  ["not", "enough"],
  ["cannot", "determine"],
  ["no", "information"],
  ["does", "not", "mention"],
  ["not", "mentioned"],
  ["insufficient"],
  ["unclear"],
];

function stripReasoningIdioms(toks: readonly VToken[]): VToken[] {
  const out: VToken[] = [];
  let i = 0;
  while (i < toks.length) {
    let matchedLen = 0;
    for (const idiom of REASONING_DELETE_IDIOMS) {
      if (i + idiom.length <= toks.length) {
        let ok = true;
        for (let j = 0; j < idiom.length; j += 1) {
          if (toks[i + j]!.isNumeric || toks[i + j]!.text !== idiom[j]) {
            ok = false;
            break;
          }
        }
        if (ok) {
          matchedLen = idiom.length;
          break;
        }
      }
    }
    if (matchedLen > 0) {
      i += matchedLen;
    } else {
      out.push(toks[i]!);
      i += 1;
    }
  }
  return out;
}

function matchPhraseAt(toks: readonly VToken[], idx: number, phrase: readonly string[]): boolean {
  if (idx + phrase.length > toks.length) return false;
  for (let j = 0; j < phrase.length; j += 1) {
    const t = toks[idx + j]!;
    if (t.isNumeric || t.text !== phrase[j]) return false;
  }
  return true;
}

function containsAnyPhrase(toks: readonly VToken[], phrases: readonly (readonly string[])[]): boolean {
  for (let i = 0; i < toks.length; i += 1) {
    for (const p of phrases) {
      if (matchPhraseAt(toks, i, p)) return true;
    }
  }
  return false;
}

export function reasoningConflict(
  reasoning: string,
  verdict: LocalVerdict | CloudVerdict | "NEI",
): boolean {
  if (verdict === "NEI" || verdict === "NEI_SILENT_ESCALATE") {
    return false;
  }
  const rawToks = vTok(reasoning).tokens;
  const toks = stripReasoningIdioms(rawToks);

  if (containsAnyPhrase(toks, REASONING_NEI_CONFLICT_PHRASES)) {
    return true;
  }

  if (verdict === "SUPPORTED" || verdict === "PARTIAL") {
    return containsAnyPhrase(toks, REASONING_SUPPORT_CONFLICT_PHRASES);
  }

  // CONTRADICTS or CONTRADICTED
  for (let i = 0; i < toks.length; i += 1) {
    for (const p of REASONING_CONTRADICT_CONFLICT_PHRASES) {
      if (matchPhraseAt(toks, i, p)) {
        let negated = false;
        const startCheck = Math.max(0, i - 3);
        for (let k = startCheck; k < i; k += 1) {
          if (isNeg(toks, k)) {
            negated = true;
            break;
          }
        }
        if (!negated) return true;
      }
    }
  }
  return false;
}

// ───────────────────────── Main Validator (`03` §2.3) ─────────────────────────

function failResult(
  reason: AnchorFailReason,
  anchor: EvidenceAnchor | null = null,
  trace?: AnchorTrace,
): AnchorValidationResult {
  return {
    verdict: "NEI_SILENT_ESCALATE",
    anchor,
    failReason: reason,
    noDifferenceNote: false,
    ...(trace !== undefined ? { trace } : {}),
  };
}

function normalizeEvidenceUnit(unit: AnchorEvidenceInput, idx: number): AnchorEvidenceUnit {
  if (typeof unit === "string") {
    return {
      text: unit,
      rawText: unit,
      refId: "",
      sourceKind: "ABSTRACT",
      chunkId: `evidence-${idx}`,
    };
  }
  return unit;
}

function snapAnchor(unit: AnchorEvidenceUnit, idx: number, startSan: number, endSan: number): EvidenceAnchor {
  const rawText = unit.rawText ?? unit.text;
  const rawStart = unit.map !== undefined ? (unit.map[startSan] ?? startSan) : startSan;
  const rawEnd = unit.map !== undefined ? (unit.map[endSan] ?? endSan) : endSan;
  const safeStart = Math.max(0, Math.min(rawStart, rawText.length));
  const safeEnd = Math.max(safeStart, Math.min(rawEnd, rawText.length));
  const snippet = rawText.slice(safeStart, safeEnd).slice(0, 400);
  return {
    refId: unit.refId ?? "",
    sourceKind: unit.sourceKind ?? "ABSTRACT",
    chunkId: unit.chunkId ?? `evidence-${idx}`,
    evidenceIdx: idx,
    snapped: { start: safeStart, end: safeEnd },
    snippet,
  };
}

function isVerdictNei(v: LocalVerdict | "NEI"): boolean {
  return v === "NEI" || v === "NEI_SILENT_ESCALATE";
}

function isVerdictContradicts(v: LocalVerdict | "NEI"): boolean {
  return v === "CONTRADICTS";
}

export function validateAnchor(
  out: Stage2ValidatorInput,
  evidence: readonly AnchorEvidenceInput[],
  claim: string,
  layer: AnchorLayer,
  options?: ValidateAnchorOptions,
): AnchorValidationResult {
  const minSpanContent = options?.minSpanContent ?? MIN_SPAN_CONTENT;
  const lang = options?.lang;
  const v = out.s04_verdict;
  const vIsNei = isVerdictNei(v);
  const idx = out.s02_evidence_idx;
  const spanTrimmed = out.s01_evidence_span.trim();

  // Step 1: index and emptiness
  if (vIsNei && idx === -1 && spanTrimmed.length === 0) {
    return { verdict: "NEI_SILENT_ESCALATE", anchor: null, failReason: null, noDifferenceNote: false };
  }
  if (idx < 0 || idx >= evidence.length) {
    return failResult("IDX_OUT_OF_BOUNDS");
  }
  if (spanTrimmed.length === 0) {
    return vIsNei
      ? { verdict: "NEI_SILENT_ESCALATE", anchor: null, failReason: null, noDifferenceNote: false }
      : failResult("EMPTY_SPAN");
  }

  const unit = normalizeEvidenceUnit(evidence[idx]!, idx);
  const evText = unit.text;
  const evTokRes = vTok(evText, lang);
  const evTok = evTokRes.tokens;
  const spTokRes = vTok(out.s01_evidence_span, lang);
  const spTok = spTokRes.tokens;
  const spanContentCount = contentTokens(spTok).length;

  if (spanContentCount < minSpanContent && !vIsNei) {
    return failResult("FRAGMENT_TOO_SHORT");
  }

  // Step 2: token-bounded verbatim match
  const verbatim = verbatimTokenWindow(evTok, spTok);
  let windowStart: number;
  let windowEnd: number;
  let containment: number | null = null;

  if (verbatim !== null) {
    windowStart = verbatim.start;
    windowEnd = verbatim.end;
  } else {
    // Step 3: ordered fragments split on "...", "…", "[...]"
    const fragments = splitFragments(out.s01_evidence_span);
    if (fragments.length === 0) {
      return failResult("FRAGMENT_TOO_SHORT");
    }
    let cursor = 0;
    const matchedAll: number[] = [];
    let minContainment = 1;
    const minFragContent = Math.min(MIN_FRAGMENT_CONTENT, minSpanContent);

    for (const frag of fragments) {
      const fragTok = vTok(frag, lang).tokens;
      if (contentTokens(fragTok).length < minFragContent) {
        return failResult("FRAGMENT_TOO_SHORT");
      }
      const after = bestWindow(evTok, fragTok, cursor);
      if (after.containment < minContainment) {
        minContainment = after.containment;
      }
      if (after.containment < CONTAINMENT_MIN) {
        const whole = bestWindow(evTok, fragTok, 0);
        return failResult(
          whole.containment >= CONTAINMENT_MIN
            ? "FRAGMENT_ORDER_VIOLATION"
            : "CONTAINMENT_BELOW_THRESHOLD",
        );
      }
      for (const mIdx of after.matchedIdx) {
        matchedAll.push(mIdx);
      }
      cursor = after.end + 1;
    }

    containment = minContainment;
    let minM = matchedAll[0]!;
    let maxM = matchedAll[0]!;
    for (const mIdx of matchedAll) {
      if (mIdx < minM) minM = mIdx;
      if (mIdx > maxM) maxM = mIdx;
    }
    windowStart = minM;
    windowEnd = maxM;
    if (windowEnd - windowStart + 1 > Math.ceil(1.5 * spTok.length) + 2) {
      return failResult("WINDOW_TOO_WIDE");
    }
  }

  // Step 4: numeric parity, value-based (span vs window)
  const spanVals = spTok.filter((t) => t.isNumeric);
  const winSlice = evTok.slice(windowStart, windowEnd + 1);
  const winVals = winSlice.filter((t) => t.isNumeric);
  for (const x of spanVals) {
    if (!winVals.some((y) => equalValue(x, y))) {
      return failResult("NUMERIC_PARITY");
    }
  }

  // Step 5: negation parity on a symmetric margin within the same clause
  let L = windowStart;
  let k = 0;
  while (k < NEG_MARGIN && L - 1 >= 0 && !clauseStopBefore(evText, evTok, L)) {
    L -= 1;
    k += 1;
  }
  let R = windowEnd;
  k = 0;
  while (k < NEG_MARGIN && R + 1 < evTok.length && !clauseStopAfter(evText, evTok, R)) {
    R += 1;
    k += 1;
  }

  const margin = evTok.slice(L, R + 1);
  let scopeNeg = 0;
  let j = windowStart - 1;
  let seenComp = false;
  let steps = 0;
  while (j >= 0 && steps < SCOPE_LOOKBACK && !clauseStopBefore(evText, evTok, j + 1)) {
    const tj = evTok[j]!;
    if (!tj.isNumeric && COMPLEMENTIZERS.has(tj.text)) {
      seenComp = true;
    }
    if (!tj.isNumeric && STRONG_NEG.has(tj.text) && seenComp && j < L) {
      scopeNeg = 1;
      break;
    }
    j -= 1;
    steps += 1;
  }

  const negSpan = countNeg(spTok, softFor(margin));
  const negWin = countNeg(margin, softFor(spTok)) + scopeNeg;
  if (negSpan % 2 !== negWin % 2) {
    return failResult("NEGATION_PARITY");
  }

  // Elliptical concessive qualifier right after the window
  let qualified = false;
  const qMax = Math.min(evTok.length - 1, windowEnd + 3);
  for (let q = windowEnd + 1; q <= qMax; q += 1) {
    const tq = evTok[q]!;
    if (
      !tq.isNumeric &&
      CONCESSIVE.has(tq.text) &&
      (isNeg(evTok, q + 1) || isNeg(evTok, q + 2)) &&
      !sliceHasSemicolonOrPeriod(evText, evTok[windowEnd]!.origEnd, tq.origStart)
    ) {
      qualified = true;
      break;
    }
  }

  // Step 6: direction parity (span vs window margin), within each lexicon class
  const dirSpan = direction(out.s01_evidence_span, spTok, spTokRes.gapComparators, 0, spTok);
  const dirMargin = direction(evText, margin, evTokRes.gapComparators, L, evTok);
  if (opposite(dirSpan, dirMargin)) {
    return failResult("DIRECTION_PARITY");
  }

  // Step 7: snap to exact original substring
  const anchor = snapAnchor(unit, idx, evTok[windowStart]!.origStart, evTok[windowEnd]!.origEnd);

  // Step 8: claim<->evidence-clause parity
  let CL = windowStart;
  while (CL - 1 >= 0 && !clauseStopBefore(evText, evTok, CL)) {
    CL -= 1;
  }
  let CR = windowEnd;
  while (CR + 1 < evTok.length && !clauseStopAfter(evText, evTok, CR)) {
    CR += 1;
  }
  const evClause = evTok.slice(CL, CR + 1);
  const clTokRes = vTok(claim, lang);
  const clTok = clTokRes.tokens;

  // 8a topical overlap
  const clStems = contentStems(clTok);
  const evStems = contentStems(evClause);
  let sharedStemsCount = 0;
  for (const s of clStems) {
    if (evStems.has(s)) sharedStemsCount += 1;
  }
  const needStems = Math.min(MIN_CLAIM_OVERLAP, clStems.size);
  const lowOverlap = sharedStemsCount < needStems;

  // 8b quantity KIND mismatch
  const claimVals = clTok.filter((t) => t.isNumeric);
  const evVals = evClause.filter((t) => t.isNumeric);
  const kindMismatch =
    claimVals.length > 0 &&
    evVals.length > 0 &&
    claimVals.some((x) => !evVals.some((y) => sameKind(x, y)));

  // 8c VALUE / negation / direction differences
  const negWinCl = countNeg(margin, softFor(clTok)) + scopeNeg;
  const negClaim = countNeg(clTok, softFor(margin));
  const valueDiff = claimVals.length > 0 && claimVals.some((x) => !evVals.some((y) => equalValue(x, y)));
  const negDiff = negClaim % 2 !== negWinCl % 2;
  const dirClaim = direction(claim, clTok, clTokRes.gapComparators, 0, clTok);
  const dirDiff = opposite(dirClaim, dirMargin);
  const anyDiff = valueDiff || negDiff || dirDiff;

  // 8d ORDER of shared content keys
  const seqA = sharedSeq(clTok, evClause);
  const seqB = sharedSeq(evClause, clTok);
  let sameOrder = seqA.length === seqB.length;
  if (sameOrder) {
    for (let sIdx = 0; sIdx < seqA.length; sIdx += 1) {
      if (seqA[sIdx] !== seqB[sIdx]) {
        sameOrder = false;
        break;
      }
    }
  }
  const evClauseText =
    evClause.length > 0
      ? evText.slice(evClause[0]!.origStart, evClause[evClause.length - 1]!.origEnd)
      : "";
  const identical =
    normalizedClaim(claim, lang !== undefined ? { lang } : undefined) ===
    normalizedClaim(evClauseText, lang !== undefined ? { lang } : undefined);

  const trace: AnchorTrace = {
    spanContentCount,
    windowStart,
    windowEnd,
    containment,
    negSpan,
    negWin,
    scopeNeg,
    qualified,
    sharedStemsCount,
    needStems,
    kindMismatch,
    valueDiff,
    negDiff,
    dirDiff,
    sameOrder,
    identical,
  };

  // Step 9: reasoning<->verdict consistency
  const conflict = reasoningConflict(out.s03_micro_reasoning, v);

  // Step 10: final verdict
  if (conflict) {
    return failResult("REASONING_VERDICT_CONFLICT", anchor, trace);
  }
  if (!vIsNei && lowOverlap) {
    return failResult("LOW_CLAIM_OVERLAP", anchor, trace);
  }
  if (!vIsNei && kindMismatch) {
    return failResult("CLAIM_SPAN_MISMATCH", anchor, trace);
  }
  if (v === "SUPPORTED" && anyDiff) {
    return failResult("CLAIM_SPAN_MISMATCH", anchor, trace);
  }
  if (v === "SUPPORTED" && qualified) {
    return failResult("NEGATION_PARITY", anchor, trace);
  }
  if (isVerdictContradicts(v) && !anyDiff) {
    if (layer === "L1") {
      return failResult("NO_DIFFERENCE_SIGNAL", anchor, trace);
    }
    if (identical) {
      return failResult("NO_DIFFERENCE_SIGNAL", anchor, trace);
    }
    if (claimVals.length > 0 && !kindMismatch && sameOrder) {
      return failResult("NO_DIFFERENCE_SIGNAL", anchor, trace);
    }
    return {
      verdict: v,
      anchor,
      failReason: null,
      noDifferenceNote: true,
      trace,
    };
  }

  return {
    verdict: vIsNei ? "NEI_SILENT_ESCALATE" : v,
    anchor,
    failReason: null,
    noDifferenceNote: false,
    trace,
  };
}

// ───────────────────────── L1 & L2 Wrappers (`03` §2.1.1, `04` §1.4 & §4.1) ─────────────────────────

export function validateLocalVerdict(
  out: Stage2ValidatorInput,
  evidence: readonly AnchorEvidenceInput[],
  claim: string,
  options?: ValidateLocalOptions,
): AnchorValidationResult {
  const res = validateAnchor(out, evidence, claim, "L1", options);
  if (
    res.verdict === "CONTRADICTS" &&
    options?.calibratedVariant !== undefined &&
    options?.actualVariant !== undefined &&
    (options.calibratedVariant.schemaId !== options.actualVariant.schemaId ||
      options.calibratedVariant.reasoningCap !== options.actualVariant.reasoningCap)
  ) {
    return {
      verdict: "NEI_SILENT_ESCALATE",
      anchor: res.anchor,
      failReason: "UNCALIBRATED_VARIANT",
      noDifferenceNote: false,
      ...(res.trace !== undefined ? { trace: res.trace } : {}),
    };
  }
  return res;
}

function findBestL2EvidenceIdx(
  quote: string,
  evidence: readonly AnchorEvidenceInput[],
  lang?: string,
): number {
  if (quote.trim().length === 0) return -1;
  const spTok = vTok(quote, lang).tokens;
  const fragments = splitFragments(quote);

  for (let i = 0; i < evidence.length; i += 1) {
    const unit = normalizeEvidenceUnit(evidence[i]!, i);
    const evTok = vTok(unit.text, lang).tokens;
    if (verbatimTokenWindow(evTok, spTok) !== null) {
      return i;
    }
    if (fragments.length > 0) {
      let cursor = 0;
      let allMatched = true;
      const matchedAll: number[] = [];
      for (const frag of fragments) {
        const fragTok = vTok(frag, lang).tokens;
        if (contentTokens(fragTok).length < MIN_FRAGMENT_CONTENT) {
          allMatched = false;
          break;
        }
        const after = bestWindow(evTok, fragTok, cursor);
        if (after.containment < CONTAINMENT_MIN) {
          allMatched = false;
          break;
        }
        for (const mIdx of after.matchedIdx) matchedAll.push(mIdx);
        cursor = after.end + 1;
      }
      if (allMatched && matchedAll.length > 0) {
        const minM = matchedAll[0]!;
        const maxM = matchedAll[matchedAll.length - 1]!;
        if (maxM - minM + 1 <= Math.ceil(1.5 * spTok.length) + 2) {
          return i;
        }
      }
    }
  }
  return 0;
}

export function validateL2Verdict(
  l2Out: L2Verdict,
  evidence: readonly AnchorEvidenceInput[],
  claim: string,
  options?: ValidateAnchorOptions,
): L2AnchorValidationResult {
  if (
    l2Out.s1_source_identified === "NOT_IDENTIFIED" ||
    l2Out.s3_quote_origin === "WEB_SOURCE" ||
    l2Out.s3_quote_origin === "NONE" ||
    l2Out.s5_verdict === "NEI"
  ) {
    return {
      verdict: "NEI",
      quote: null,
      quoteAnchor: null,
      failReason: null,
      noDifferenceNote: false,
    };
  }

  const adaptedVerdict: LocalVerdict | "NEI" =
    l2Out.s5_verdict === "CONTRADICTED" ? "CONTRADICTS" : "SUPPORTED";
  const matchedIdx = findBestL2EvidenceIdx(l2Out.s2_quote, evidence, options?.lang);

  const adaptedInput: Stage2ValidatorInput = {
    s01_evidence_span: l2Out.s2_quote,
    s02_evidence_idx: matchedIdx,
    s03_micro_reasoning: l2Out.s4_reasoning,
    s04_verdict: adaptedVerdict,
  };

  const res = validateAnchor(adaptedInput, evidence, claim, "L2", options);
  if (res.failReason !== null || isVerdictNei(res.verdict) || res.anchor === null) {
    return {
      verdict: "NEI",
      quote: null,
      quoteAnchor: null,
      failReason: res.failReason,
      noDifferenceNote: false,
    };
  }

  const finalVerdict: CloudVerdict =
    l2Out.s5_verdict === "PARTIAL"
      ? "PARTIAL"
      : res.verdict === "CONTRADICTS"
        ? "CONTRADICTED"
        : "SUPPORTED";

  return {
    verdict: finalVerdict,
    quote: res.anchor.snippet,
    quoteAnchor: res.anchor,
    failReason: null,
    noDifferenceNote: res.noDifferenceNote,
  };
}
