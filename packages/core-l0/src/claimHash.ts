import type { SourceFormat } from "./mask.js";
import {
  codePointAtSafe,
  isBaseLetter,
  isDigit,
  isPunctuation,
  isSpace,
  sha256hex,
} from "./norm.js";
import {
  type PreparedInput,
  formatCanonicalDecimal,
  hasPercentageContext,
  isAsciiDigitCode,
  matchDateEndAt,
  parseNumberOrScientificAt,
  prepareInput,
  scaleParsedNumber,
} from "./numberParser.js";
import {
  scanLeadingPrefixCurrency,
  scanPrefixUnit,
  scanSuffixUnitFast,
} from "./units.js";

export interface ClaimNormOptions {
  readonly lang?: string;
  readonly format?: SourceFormat;
  readonly applyLatex?: boolean;
}

interface NumberReplacement {
  readonly startNorm: number;
  readonly endNorm: number;
  readonly token: string;
}

function scanNumberTokensForClaim(prep: PreparedInput): NumberReplacement[] {
  const { normText, normLowerText, isEnglish } = prep;
  const n = normText.length;
  const pctContext = hasPercentageContext(normLowerText);
  const out: NumberReplacement[] = [];
  let lastClaimTokEnd = 0;
  let i = 0;

  while (i < n) {
    const cu = normText.charCodeAt(i);
    if (cu === 46 && (i + 1 >= n || !isAsciiDigitCode(normText.charCodeAt(i + 1)))) {
      while (
        i < n &&
        normText.charCodeAt(i) === 46 &&
        (i + 1 >= n || !isAsciiDigitCode(normText.charCodeAt(i + 1)))
      ) {
        i++;
      }
      continue;
    }

    const dateEnd = isAsciiDigitCode(cu) ? matchDateEndAt(normText, i) : -1;
    if (dateEnd !== -1) {
      i = dateEnd;
      continue;
    }

    const num =
      isAsciiDigitCode(cu) || cu === 45 || cu === 43 || cu === 46
        ? parseNumberOrScientificAt(normText, prep.subText, prep.normMap, i, isEnglish, true)
        : null;
    if (num !== null) {
      if (!Number.isFinite(num.value)) {
        lastClaimTokEnd = num.endNorm;
        i = num.endNorm;
        continue;
      }
      const suf = scanSuffixUnitFast(
        normText,
        normLowerText,
        num.endNorm,
        pctContext,
        num.isYearIntCandidate,
      );
      // Prefix currency symbols (`$`, `US$`, `€`, `£`, `Rp`, etc.) become part of `⟨v:...⟩`;
      // `n =` and ratio acronyms keep outside tokens untouched (`n = ⟨v:...⟩`).
      const prefix = suf === null ? scanPrefixUnit(normText, normLowerText, i, lastClaimTokEnd) : null;
      const effPrefix =
        prefix !== null && !prefix.isSampleSizePrefix && !prefix.isRatioPrefix ? prefix : null;

      let startNorm = i;
      let endNorm = num.endNorm;
      let unitStr = "";
      let factor = 1;

      if (suf !== null) {
        endNorm = suf.endNorm;
        factor = suf.factor;
        if (suf.family === "unknown") {
          unitStr = prep.subText.slice(
            prep.normMap[suf.startNorm] ?? 0,
            prep.normMap[suf.endNorm] ?? prep.subText.length,
          );
        } else {
          unitStr = suf.unitCanon;
        }
      } else if (effPrefix !== null) {
        startNorm = effPrefix.startNorm;
        factor = effPrefix.factor;
        unitStr = effPrefix.unitCanon;
      }

      const scaled = scaleParsedNumber(num, factor);
      if (!Number.isFinite(scaled)) {
        lastClaimTokEnd = endNorm;
        i = endNorm;
        continue;
      }
      const canonVal = formatCanonicalDecimal(scaled);
      out.push({
        startNorm,
        endNorm,
        token: `\u27e8v:${canonVal}${unitStr}\u27e9`,
      });
      lastClaimTokEnd = endNorm;
      i = endNorm;
      continue;
    }

    const firstCp = cu < 0x80 ? cu : codePointAtSafe(normText, i).cp;
    if (isBaseLetter(firstCp)) {
      const leadCur = scanLeadingPrefixCurrency(normText, normLowerText, i);
      if (
        leadCur !== null &&
        leadCur.endNorm < n &&
        isAsciiDigitCode(normText.charCodeAt(leadCur.endNorm))
      ) {
        const curNum = parseNumberOrScientificAt(
          normText,
          prep.subText,
          prep.normMap,
          leadCur.endNorm,
          isEnglish,
          false,
          true,
        );
        if (curNum !== null && Number.isFinite(curNum.value)) {
          const suf = scanSuffixUnitFast(
            normText,
            normLowerText,
            curNum.endNorm,
            pctContext,
            curNum.isYearIntCandidate,
          );
          if (suf === null) {
            const canonVal = formatCanonicalDecimal(scaleParsedNumber(curNum, leadCur.factor));
            out.push({
              startNorm: leadCur.startNorm,
              endNorm: curNum.endNorm,
              token: `\u27e8v:${canonVal}${leadCur.unitCanon}\u27e9`,
            });
            lastClaimTokEnd = curNum.endNorm;
            i = curNum.endNorm;
            continue;
          }
        }
      }
      while (i < n) {
        const c = normText.charCodeAt(i);
        if (c < 0x80) {
          if (isBaseLetter(c) || isAsciiDigitCode(c)) {
            i++;
          } else {
            break;
          }
        } else {
          const u = codePointAtSafe(normText, i);
          if (isBaseLetter(u.cp) || isDigit(u.cp)) {
            i += u.len;
          } else {
            break;
          }
        }
      }
      continue;
    }

    if (isAsciiDigitCode(cu)) {
      while (i < n) {
        const chRun = normText.charCodeAt(i);
        if (isAsciiDigitCode(chRun) || chRun === 46) {
          i++;
        } else {
          break;
        }
      }
      continue;
    }

    i += cu < 0x80 ? 1 : codePointAtSafe(normText, i).len;
  }

  return out;
}

/**
 * Token-based claim canonicalization (`01` §3.2):
 * 1. Replaces every recognized number (plus optional attached/prefix unit) by `⟨v:<canon><unit>⟩`;
 * 2. Lowercases remaining text with `normLower`;
 * 3. Keeps `<`, `≤`, `>`, `≥`, `=`, `±` as separate tokens (`<=` -> `≤`, `>=` -> `≥`);
 * 4. Deletes all other Unicode category `P` punctuation outside atomic `⟨v:…⟩` tokens;
 * 5. Collapses whitespace runs to one U+0020 space and trims.
 */
export function normalizedClaim(claimText: string, options?: ClaimNormOptions): string {
  const prep = prepareInput(claimText, options);
  const normLowerText = prep.normLowerText;
  const n = normLowerText.length;
  const replacements = scanNumberTokensForClaim(prep);

  const outParts: string[] = [];
  let hasEmitted = false;
  let needSpace = false;

  const appendCleanedRange = (startIdx: number, endIdx: number): void => {
    let idx = startIdx;
    while (idx < endIdx) {
      const cu = normLowerText.charCodeAt(idx);
      if (cu < 0x80) {
        if ((cu >= 97 && cu <= 122) || (cu >= 48 && cu <= 57)) {
          const runStart = idx;
          idx += 1;
          while (idx < endIdx) {
            const c = normLowerText.charCodeAt(idx);
            if ((c >= 97 && c <= 122) || (c >= 48 && c <= 57)) {
              idx += 1;
            } else {
              break;
            }
          }
          if (needSpace && hasEmitted) {
            outParts.push(" ");
          }
          outParts.push(normLowerText.slice(runStart, idx));
          hasEmitted = true;
          needSpace = false;
          continue;
        }
        if (cu === 32 || cu === 10 || cu === 9 || cu === 13) {
          if (hasEmitted) {
            needSpace = true;
          }
          idx += 1;
          continue;
        }
        if (cu === 60 /* '<' */) {
          if (idx + 1 < endIdx && normLowerText.charCodeAt(idx + 1) === 61 /* '=' */) {
            outParts.push(hasEmitted ? " \u2264" : "\u2264");
            idx += 2;
          } else {
            outParts.push(hasEmitted ? " <" : "<");
            idx += 1;
          }
          hasEmitted = true;
          needSpace = true;
          continue;
        }
        if (cu === 62 /* '>' */) {
          if (idx + 1 < endIdx && normLowerText.charCodeAt(idx + 1) === 61 /* '=' */) {
            outParts.push(hasEmitted ? " \u2265" : "\u2265");
            idx += 2;
          } else {
            outParts.push(hasEmitted ? " >" : ">");
            idx += 1;
          }
          hasEmitted = true;
          needSpace = true;
          continue;
        }
        if (cu === 61 /* '=' */) {
          outParts.push(hasEmitted ? " =" : "=");
          hasEmitted = true;
          needSpace = true;
          idx += 1;
          continue;
        }
        if (!isPunctuation(cu)) {
          if (isSpace(cu)) {
            if (hasEmitted) {
              needSpace = true;
            }
          } else {
            if (needSpace && hasEmitted) {
              outParts.push(" ");
            }
            outParts.push(normLowerText.charAt(idx));
            hasEmitted = true;
            needSpace = false;
          }
        }
        idx += 1;
        continue;
      }

      if (cu === 0x2264 || cu === 0x2265 || cu === 0x00b1 /* '±' */) {
        outParts.push(hasEmitted ? ` ${normLowerText.charAt(idx)}` : normLowerText.charAt(idx));
        hasEmitted = true;
        needSpace = true;
        idx += 1;
        continue;
      }

      const u = codePointAtSafe(normLowerText, idx);
      if (!isPunctuation(u.cp)) {
        if (isSpace(u.cp)) {
          if (hasEmitted) {
            needSpace = true;
          }
        } else {
          if (needSpace && hasEmitted) {
            outParts.push(" ");
          }
          outParts.push(normLowerText.slice(idx, idx + u.len));
          hasEmitted = true;
          needSpace = false;
        }
      }
      idx += u.len;
    }
  };

  let cursor = 0;
  for (let r = 0; r < replacements.length; r++) {
    const rep = replacements[r]!;
    if (rep.startNorm > cursor) {
      appendCleanedRange(cursor, rep.startNorm);
    }
    if (needSpace && hasEmitted) {
      outParts.push(" ");
    }
    outParts.push(rep.token);
    hasEmitted = true;
    needSpace = false;
    cursor = rep.endNorm;
  }
  if (cursor < n) {
    appendCleanedRange(cursor, n);
  }

  return outParts.join("");
}

export function normalizedClaimHash(claimText: string, options?: ClaimNormOptions): string {
  return sha256hex(normalizedClaim(claimText, options));
}
