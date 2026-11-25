# 03 — L0 Tier B: Anchor Validator, Triage Baseline, B5 & Ingestion

**Owns:** the Tier B contract and the replay discipline; the post-decode evidence anchor validator for L1 and L2; the fast path and atom mapping; the deterministic triage baseline; the B5 manuscript self-consistency engine with its storage schemas, incremental pairing and deterministic baseline; client-side multi-format ingestion; document kinds and editability; the viewport-prioritized batch audit queue; exports.

**Load with:** `AGENTS.md` (always), `01_DATA_REDUCER_AND_METER.md` (types, events, reducer) and the sections of `02_L0_TIER_A_PRE_DECODE.md` named below (tokenizers, value grammar, sanitizer).

**Cross-reference notation.** `[0n › Topic]` names the owning specification file `docs/spec/0n_*.md` and the topic heading inside it. A bare `§n.m` refers to this file.

**Tier membership of the modules in this file.**

| Module | Source file | Tier |
|---|---|---|
| Anchor validator and reasoning↔verdict check (§2) | `packages/core-l0/src/anchor.ts` | **B** |
| Deterministic triage baseline (§3.4) | `packages/core-l0/src/triageBaseline.ts` | **B**, locked CF-1 baseline |
| B5 pairing and the deterministic B5 baseline (§4.4–§4.5) | `packages/core-l0/src/b5pairing.ts` | **B**, locked CF-1 baseline |
| Fast-path scheduling and atom mapping (§3.1–§3.2) | `packages/core-l0/src/fastpath.ts` | outside both tiers (runtime) |
| Ingestion, audit queue and exports (§5) | `packages/core-l0/src/ingest/*`, `apps/web/src/import/*`, `apps/web/src/export/*` | outside both tiers (their outputs feed Tier A modules, which are frozen) |

---

## 1. Tier B Post-Decode & Replay Discipline

### 1.1 Tier B scope

Tier B consists of every deterministic module that runs **after decoding**: it reads a model's decoded output (`rawText`) but never changes what a model receives. Its files are listed in `/freeze/tier_b.txt`, and `tools/freeze-hash.ts` computes `tier_b_hash` over them exactly as `tier_a_hash` is computed [07 › Tiered freeze rule].

| Tier B module | Specified in |
|---|---|
| JSON key-order check, JSON parsing and repair, schema validation of decoded outputs | [04 › Key-order guarantee (applies to every schema)] |
| Anchor validator, including the no-difference rule and the measure-valence lexicon; reasoning↔verdict consistency | §2 |
| Gates (`evaluateGate`, `evaluateSupportGate`), Wilson and bootstrap statistics, Holm–Bonferroni correction, `checkAuthority` | [04 › Shared gate module (`packages/core-l0/src/gate.ts` and `Gate.kt`)] |
| Deterministic CF-1 baselines: triage baseline, BM25 top-1 alignment baseline, three-class B5 baseline, Select-row matching | §3.4, §4.5, [07 › CF-1: Task Authority Test], [06 › O2: Check against a printed page] |
| Reducer and Coverage Meter | [01 › Pure Commutative Ledger Reducer (`derive`)], [01 › 8-Bucket Coverage Meter & Drawers] |
| Routing publication (`publish_routing.ts`) | [07 › Outputs and publication] |

### 1.2 Replay and preregistration discipline (D-30)

1. **CF-1 baselines are locked before CF-1 runs.** The deterministic CF-1 baselines (the triage baseline of §3.4, the BM25 top-1 alignment baseline, the three-class B5 baseline of §4.5 and Select-row matching) are listed in `/freeze/cf1_baselines.txt` and hashed as `cf1_baseline_hash` before the first CF-1 run. `cf1_baseline_hash` is recorded in every CF-1 manifest. After the first CF-1 run these files never change before judging ends; a pull request that changes one fails CI.
2. **Permitted Tier B changes after logs exist.** After the first R1-E or CF-1 run has collected `rawText` logs, a Tier B change is permitted **only** to:
   - correct an **objective specification defect**: a violation of this specification, a failing conformance or acceptance row, or a crash; or
   - apply a fix **motivated by DEV data** (the DEV set of [07 › Datasets]).

   A change motivated by R1-E, CF-1, probe or O2 outcomes is forbidden.
3. **Every permitted change is replayed.** `tools/replay.ts` reads the run logs (inputs, evidence chunk IDs, `rawText`, `inferenceSource` of every call), re-runs every Tier B module with the changed package, regenerates every report (`r1e_*.md`, `cf1_*.md`, `probe_*.md`, `o2_*.md`), and writes a diff report listing every changed verdict, metric and gate outcome. Replay makes **no model call** and runs with the network disabled.
4. **Determinism.** Two replays of the same logs with the same `tier_b_hash` produce **byte-identical** reports. CI tests this on a committed run directory.
5. **Decision record.** `H4_DECISION.md` records `tier_a_hash`, `cf1_baseline_hash`, the final `tier_b_hash`, the SHA-256 of every replay report, every gate outcome, every task authority and the published routing-table version. It **always reports first-look metrics** (computed by the Tier B package that was current when each run executed) **alongside the replayed metrics**, in adjacent columns of the same tables.
6. **After the decision record.** Once `H4_DECISION.md` is written, a Tier B change is allowed only if its replay shows every gate outcome and every task authority identical to the recorded ones. The new `tier_b_hash` and its replay report are appended to `H4_DECISION.md`. A change that would alter any outcome is deferred until after judging.
7. **Pull requests.** A pull request that changes a file of `/freeze/tier_b.txt` after the first run MUST include its committed replay report `eval-harness/reports/replay/{runId}_{tierB}.md` and state which of the two permitted reasons applies.

---

## 2. Post-Decode Evidence Anchor Validator (L1 & L2)

### 2.1 Inputs, output and layers

**Inputs:**
- `out` — the decoded Stage 2 JSON `{ s01_evidence_span, s02_evidence_idx, s03_micro_reasoning, s04_verdict }` (for L2, the adapter of §2.1.1);
- `EVIDENCE[0..n−1]` — the exact sanitized evidence strings that were sent (n ≤ 5), each with its sanitizer offset map to the raw unit text [02 › Effects];
- `claim` — the clause's claim text, normalized with the math substitutions of [02 › Normalization-time LaTeX substitutions];
- `layer` — `"L1"` (Stage 2 on-device checks and printed-source checks) or `"L2"` (cloud quotes whose origin is `PROVIDED_EVIDENCE`).

**Output:** `{ verdict, anchor | null, failReason | null, noDifferenceNote: boolean }`. `failReason` is an `AnchorFailReason` [01 › Enumerations].

The two layers differ **only** in Step 10d (no-difference handling of `CONTRADICTS`).

#### 2.1.1 L2 adapter (quotes with origin `PROVIDED_EVIDENCE`)

The same validator is applied to L2 results whose `s3_quote_origin = PROVIDED_EVIDENCE` [04 › Seven L0 post-checks on `L2Verdict` (applied in order)], with `layer = "L2"` and this adapter:

| Validator field | L2 value |
|---|---|
| `s01_evidence_span` | `s2_quote` |
| `s02_evidence_idx` | the smallest `i` for which Step 2 or Step 3 of §2.3 succeeds for `s2_quote` against `EVIDENCE[i]`; `-1` if `s2_quote = ""`; `0` if no block succeeds (the validator then fails with the reason of `EVIDENCE[0]`) |
| `s03_micro_reasoning` | `s4_reasoning` |
| `s04_verdict` | `SUPPORTED → SUPPORTED`, `CONTRADICTED → CONTRADICTS`, `PARTIAL → SUPPORTED` (for the anchor and claim↔span checks only), `NEI → NEI` |

After validation the L2 verdict is mapped back: a validated `SUPPORTED` from `PARTIAL` stays `PARTIAL`; a validated `CONTRADICTS` becomes `CONTRADICTED`; any failure becomes `NEI`.

### 2.2 `vTok(x)` — validation tokenizer

1. `t = normLower(x)` with the math substitutions of [02 › Normalization-time LaTeX substitutions]; keep the offset map.
2. Scan maximal runs of `LETTER`, `DIGIT`, `'` and `-`, where `'` and `-` count only between two `LETTER`/`DIGIT` characters.
   - Value expressions [02 › Value Grammar, Units & Metric Classes] are emitted as **single numeric tokens** carrying `{ value, isPercent, unitFamily, metricClass, metricFromUnit }`.
   - A number followed by the word `percent` or by the words `per cent` is emitted with `isPercent = true`, and those words are consumed.
3. **Contractions:** a token ending in `n't` (for example `didn't`, `wasn't`) is emitted as two tokens — the base (`did`, `was`) and `not` — both mapped to the original characters. `can't` → `ca` + `not`; `won't` → `wo` + `not`; `cannot` stays `cannot`.
4. **Hyphenated negation prefixes:** a token `non-X`, `un-X` or `in-X` is emitted as the single token `nonX`, `unX` or `inX` (hyphen deleted). Every other hyphenated token keeps its hyphen.
5. Each token records its original character range in the unit text (`origStart`, `origEnd`).

**`content(tokens)`** = the tokens that are not in the BM25 stopword list [02 › `tokBM25(x)`]. Numeric tokens are content tokens.

**`stems(tokens)`** = the set of Porter stems (`porter_v1.json`) of the content tokens that are **not** numeric, **not** negation cues (`NEGATION_CUES`, `STRONG_NEG`, `SOFT_NEG`, negation-prefixed tokens) and **not** in any direction lexicon (§2.3). It measures what a text is *about*, independent of its polarity and values.

### 2.3 `validate(out, EVIDENCE, claim, layer)` — normative pseudocode

```
const CONTAINMENT_MIN      = 0.75
const NEG_MARGIN           = 4                 # tokens on EACH side, within the same clause
const SCOPE_LOOKBACK       = 12
const MIN_FRAGMENT_CONTENT = 3
const MIN_SPAN_CONTENT     = 3
const MIN_CLAIM_OVERLAP    = 2                 # shared non-numeric content stems between claim and evidence clause
const NEGATION_CUES  = {"no","not","without","neither","nor","never","none","cannot","lack","lacks","lacked","lacking",
                        "absence","absent","fail","fails","failed","failure","unable","insignificant","nonsignificant",
                        "unchanged"}
const SOFT_NEG       = {"similar","comparable"}   # counted only under the SOFT_NEG rule (softFor)
const NEGATION_PREFIX = { prefixes: ["non","un","in"],
                          stems: ["significant","significantly","effective","inferior","superior","different","changed"] }
const NON_NEGATING_IDIOMS = [["not","only"],["no","doubt"],["nonetheless"],["none","the","less"],["not","until"],
                             ["no","longer","than"],["no","less","than"],["not","least"],["not","inconsistent"]]
const NEG_EXCLUSIONS = # a cue token inside one of these bigrams is not a negation cue
      { (X, "failure") for X in {"heart","cardiac","renal","kidney","liver","hepatic","respiratory","organ","multiorgan",
                                  "treatment","graft","ovarian","engine","system"} }
    ∪ { ("failure", Y) for Y in {"rate","rates","time","mode","modes"} }
    ∪ { (S, Y) for S in SOFT_NEG, Y in {"method","methods","approach","design","protocol","procedure","to"} }
const STRONG_NEG   = {"no","not","without","never","neither","nor","none","cannot","lack","lacks","lacked","lacking","absence"}
const COMPLEMENTIZERS = {"that","whether","of","for","on"}
const CLAUSE_STOP_PUNCT = {",", ";", ":", "(", ")"}          # NOT "-"
const CLAUSE_STOP_CONJ  = {"and","but","whereas","while","although","though","however","yet"}
const CONCESSIVE   = {"although","though","but","however","yet"}
# Direction lexicons: two independent classes; parity is tested only WITHIN a class.
const QTY_UP   = {"increase","increased","increases","increasing","rise","rose","risen","rising","higher","greater","more",
                  "elevated","raised","gain","gained","enhanced","larger","longer"}
const QTY_DOWN = {"decrease","decreased","decreases","decreasing","reduce","reduced","reduces","reduction","decline",
                  "declined","fell","fall","falls","lower","lowered","less","fewer","drop","dropped","diminished",
                  "smaller","shorter"}
const VAL_POS  = {"improve","improved","improves","improvement","better","benefit","benefits","beneficial","alleviated",
                  "relieved","protective"}
const VAL_NEG  = {"worsen","worsened","worse","worsening","impaired","deteriorated","deterioration","harm","harmful",
                  "aggravated","exacerbated"}
# Measure valence (Porter stems). A quantity change of an ADVERSE measure is also a valence change, and vice versa.
const ADVERSE_MEASURES = {"mortal","death","pain","bleed","advers","complic","risk","relaps"}
const GOOD_MEASURES    = {"surviv","respons","remiss"}
const MEASURE_REACH    = 3                      # content tokens before or after the direction token, same clause

function isNeg(toks, i):
  t = toks[i]
  if (toks[i-1], t) in NEG_EXCLUSIONS or (t, toks[i+1]) in NEG_EXCLUSIONS: return false   # out-of-range → no bigram
  if t in NEGATION_CUES: return true
  for p in NEGATION_PREFIX.prefixes:
      if t starts with p and t[len(p):] in NEGATION_PREFIX.stems: return true
  return false

function countNeg(toks, softActive):            # toks: list of tokens
  delete NON_NEGATING_IDIOMS occurrences (token sequences) first
  n = number of i with isNeg(toks, i)
  if softActive: n += number of i with toks[i] in SOFT_NEG and not excluded by NEG_EXCLUSIONS
  return n

# SOFT_NEG rule: "similar"/"comparable" count as negation in a comparison A-vs-B only when the OTHER side of that
# comparison contains a STRONG_NEG token or the phrase "no difference" / "did not differ" / "not differ".
function softFor(other):
  return other contains a STRONG_NEG token or the token sequence ("no","difference") or ("not","differ")

function measureOf(toks, i):                    # valence of the measure that the direction token toks[i] changes
  near = stems of the content tokens within MEASURE_REACH positions of i (both sides), stopping at clause stops
  a = near ∩ ADVERSE_MEASURES ≠ ∅;  g = near ∩ GOOD_MEASURES ≠ ∅
  return a and not g ? ADVERSE : (g and not a ? GOOD : NONE)

function direction(toks):
  up = any t in QTY_UP; down = any t in QTY_DOWN
  pos = any t in VAL_POS; neg = any t in VAL_NEG
  for each i with toks[i] in QTY_UP ∪ QTY_DOWN:     # measure valence: "increased mortality" ≡ worse
      m = measureOf(toks, i); isUp = toks[i] in QTY_UP
      if m == ADVERSE: (isUp ? neg : pos) = true
      if m == GOOD:    (isUp ? pos : neg) = true
  return { qty: (up, down), val: (pos, neg) }

function opposite(d1, d2):                       # true iff, in SOME class, one side is only-up and the other only-down
  for c in {qty, val}:
      (u1, n1) = d1[c]; (u2, n2) = d2[c]
      if (u1 and not n1 and n2 and not u2) or (n1 and not u1 and u2 and not n2): return true
  return false

function sameKind(x, y):                         # x, y: numeric tokens
  return x.unitFamily = y.unitFamily and x.isPercent = y.isPercent
         and (not (x.metricFromUnit and y.metricFromUnit) or x.metricClass = y.metricClass)

function key(t):                                 # identity key of a content token for order comparison
  return t is numeric ? (canonical value + unitCanon + isPercent) : Porter stem of t

function sharedSeq(a, b):
  return [ key(t) for t in content(a) that are not negation cues and not direction-lexicon words,
           in order of first occurrence, restricted to keys that also occur among the keys of content(b) ]

function validate(out, EVIDENCE, claim, layer, minSpanContent = MIN_SPAN_CONTENT):
  v = out.s04_verdict
  # Step 1: index and emptiness
  idx = out.s02_evidence_idx
  if v == NEI and idx == -1 and trim(out.s01_evidence_span) == "":  return { verdict: NEI, anchor: null,
                                                                             failReason: null, noDifferenceNote: false }
  if idx < 0 or idx >= len(EVIDENCE):        return fail(IDX_OUT_OF_BOUNDS)
  if trim(out.s01_evidence_span) == "":      return v == NEI ? { verdict: NEI, anchor: null, failReason: null,
                                                                 noDifferenceNote: false } : fail(EMPTY_SPAN)
  ev    = EVIDENCE[idx]
  evTok = vTok(ev)
  spTok = vTok(out.s01_evidence_span)
  if len(content(spTok)) < minSpanContent and v != NEI:     return fail(FRAGMENT_TOO_SHORT)

  # Step 2: token-bounded verbatim match
  window = verbatimTokenWindow(evTok, spTok)  # contiguous equal token sequence, first occurrence; null if none
  if window == null:
      # Step 3: ordered fragments split on "...", "…", "[...]"
      fragments = splitFragments(out.s01_evidence_span)          # each fragment tokenized with vTok
      cursor = 0; matched = []
      for f in fragments:
          if len(content(f)) < min(MIN_FRAGMENT_CONTENT, minSpanContent): return fail(FRAGMENT_TOO_SHORT)
          after = bestWindow(evTok, f, from=cursor)              # §2.4
          if after.containment < CONTAINMENT_MIN:
              whole = bestWindow(evTok, f, from=0)
              return fail(whole.containment >= CONTAINMENT_MIN ? FRAGMENT_ORDER_VIOLATION : CONTAINMENT_BELOW_THRESHOLD)
          matched += after.matchedIdx; cursor = after.end + 1
      window = [min(matched), max(matched)]
      if (window.end − window.start + 1) > ceil(1.5 × len(spTok)) + 2:    return fail(WINDOW_TOO_WIDE)

  # Step 4: numeric parity, value-based (span vs window)
  spanVals = numericValues(spTok); winVals = numericValues(evTok[window])
  for x in spanVals: if no y in winVals with equalValue(x, y): return fail(NUMERIC_PARITY)
     # equalValue: exact decimal equality after canonicalization AND equal isPercent flags

  # Step 5: negation parity on a symmetric margin within the same clause
  L = window.start; k = 0
  while k < NEG_MARGIN and L − 1 >= 0 and not clauseStopBefore(evTok, L): L -= 1; k += 1
  R = window.end;   k = 0
  while k < NEG_MARGIN and R + 1 < len(evTok) and not clauseStopAfter(evTok, R): R += 1; k += 1
  margin = evTok[L..R]
  negWin = countNeg(margin, softFor(spTok))
  # scope negation: "no evidence that ...", "did not show whether ..." further to the left in the same clause
  scopeNeg = 0
  j = window.start − 1; seenComp = false; steps = 0
  while j >= 0 and steps < SCOPE_LOOKBACK and not clauseStopBefore(evTok, j + 1):
      if evTok[j] in COMPLEMENTIZERS: seenComp = true
      if evTok[j] in STRONG_NEG and seenComp and j < L: scopeNeg = 1; break
      j -= 1; steps += 1
  negWin += scopeNeg
  if (countNeg(spTok, softFor(margin)) mod 2) != (negWin mod 2): return fail(NEGATION_PARITY)
  # elliptical concessive qualifier right after the window: ", although not significant", "but not significantly"
  qualified = exists q in (window.end, window.end + 3] with evTok[q] in CONCESSIVE
              and (isNeg(evTok, q+1) or isNeg(evTok, q+2))
              and no ";" or "." between window.end and q

  # Step 6: direction parity (span vs window margin), within each lexicon class
  if opposite(direction(spTok), direction(margin)): return fail(DIRECTION_PARITY)

  # Step 7: snap to the exact original substring (raw unit coordinates through the sanitizer map)
  anchor = snap(ev, evTok[window.start].origStart, evTok[window.end].origEnd)

  # Step 8: claim↔evidence-clause parity
  [CL, CR] = window extended left and right to the nearest clause stop (clauseStopBefore / clauseStopAfter), no limit
  evClause = evTok[CL..CR]
  clTok = vTok(claim)
  # 8a topical overlap (same entity/outcome): shared non-numeric content stems
  need = min(MIN_CLAIM_OVERLAP, |stems(clTok)|)
  lowOverlap = | stems(clTok) ∩ stems(evClause) | < need
  # 8b quantity KIND mismatch: the claim reports a kind of quantity that the evidence clause does not report
  claimVals = numericValues(clTok); evVals = numericValues(evClause)
  kindMismatch = claimVals non-empty and evVals non-empty
                 and exists x in claimVals with no y in evVals having sameKind(x, y)
  # 8c VALUE / negation / direction differences (the signature of a real contradiction).
  #    The evidence-side negation count is recomputed with the SOFT_NEG rule activated by the CLAIM (not by the span),
  #    because here the comparison partner of the evidence is the claim.
  negWinCl  = countNeg(margin, softFor(clTok)) + scopeNeg        # scopeNeg = the 0/1 scope term of Step 5
  valueDiff = claimVals non-empty and exists x in claimVals with no y in evVals with equalValue(x, y)
  negDiff   = (countNeg(clTok, softFor(margin)) mod 2) != (negWinCl mod 2)
  dirDiff   = opposite(direction(clTok), direction(margin))
  anyDiff   = valueDiff or negDiff or dirDiff
  # 8d ORDER of shared content keys (subject/object and value swap detector, used by layer L2 only)
  sameOrder = sharedSeq(clTok, evClause) = sharedSeq(evClause, clTok)
  identical = normalizedClaim(claim) = normalizedClaim(text of evClause)      # [01 › `normalizedClaim`, `normalizedClaimHash` and `evidenceVersion`]

  # Step 9: reasoning↔verdict consistency (§2.5)
  conflict = reasoningConflict(out.s03_micro_reasoning, v)

  # Step 10: final verdict
  if conflict:                         return { verdict: NEI, anchor, failReason: REASONING_VERDICT_CONFLICT,
                                                noDifferenceNote: false }
  if v != NEI and lowOverlap:          return { verdict: NEI, anchor, failReason: LOW_CLAIM_OVERLAP,
                                                noDifferenceNote: false }
  if v != NEI and kindMismatch:        return { verdict: NEI, anchor, failReason: CLAIM_SPAN_MISMATCH,
                                                noDifferenceNote: false }
  if v == SUPPORTED and anyDiff:       return { verdict: NEI, anchor, failReason: CLAIM_SPAN_MISMATCH,
                                                noDifferenceNote: false }
  if v == SUPPORTED and qualified:     return { verdict: NEI, anchor, failReason: NEGATION_PARITY,
                                                noDifferenceNote: false }
  # 10d no-difference handling of CONTRADICTS
  if v == CONTRADICTS and not anyDiff:
      if layer == "L1":                return { verdict: NEI, anchor, failReason: NO_DIFFERENCE_SIGNAL,
                                                noDifferenceNote: false }
      # layer L2: downgrade only when there is provably nothing to contradict
      if identical:                    return { verdict: NEI, anchor, failReason: NO_DIFFERENCE_SIGNAL,
                                                noDifferenceNote: false }
      if claimVals non-empty and not kindMismatch and sameOrder:
                                       return { verdict: NEI, anchor, failReason: NO_DIFFERENCE_SIGNAL,
                                                noDifferenceNote: false }
      return { verdict: v, anchor, failReason: null, noDifferenceNote: true }
  return { verdict: v, anchor, failReason: null, noDifferenceNote: false }

function fail(reason): return { verdict: NEI, anchor: null, failReason: reason, noDifferenceNote: false }
```

**Reading of Step 10.** A `CONTRADICTS` verdict is kept only when the claim and the evidence clause talk about the same thing (overlap and same quantity kind). On device it also needs a visible value, negation or direction difference. In the cloud, a contradiction without such a signal (a subject/object swap, a qualitative contradiction) is kept with an inspector note, unless the claim is identical to the quoted clause, or both carry the same quantity kind with identical values, negation and direction **and** the shared keys appear in the same order.

**Helper definitions.**
- **`clauseStopBefore(toks, i)`** is true when the source text between `toks[i−1]` and `toks[i]` contains a character in `CLAUSE_STOP_PUNCT`, or `toks[i−1]` is in `CLAUSE_STOP_CONJ`. **`clauseStopAfter(toks, i)`** is the mirror condition between `toks[i]` and `toks[i+1]`.
- **`metricFromUnit`** is true for a numeric token whose metric class was decided by its unit family or by the p-value rule alone: `p_value`, `duration`, `concentration`, `currency`, `ratio`, and `effect_size` assigned through the ratio family. It is false when the class was decided by a cue word in the window: `sample_size`, `percentage` by cue, `dose`, `count`, `effect_size` by cue, `other`. Two values of the same unit family whose classes come from different cue words (for example `12%` labelled `percentage` by `rate` and `12%` labelled `other`) are therefore the same kind.
- **`numericValues(toks)`** = the numeric tokens of `toks`, in order. **`equalValue(x, y)`** = exact decimal equality of the canonical values **and** equal `isPercent` flags.
- **`verbatimTokenWindow(evTok, spTok)`** = the first index range `[s, s + len(spTok) − 1]` of `evTok` whose token strings equal those of `spTok` one by one; `null` if none.
- **`splitFragments(span)`** splits on `...`, `…` and `[...]`, trims each fragment, and drops empty fragments.
- **`snap(ev, a, b)`** maps the sanitized offsets `a`, `b` through the sanitizer and `norm()` offset maps to raw unit coordinates and returns `EvidenceAnchor { snapped: [rawA, rawB), snippet: raw substring (≤ 400 chars) }`.

**Why the layers differ (D-15).** On device, a `CONTRADICTS` without any lexical difference is most often a model error, and downgrading it costs little because the pair escalates quietly (`NEI_SILENT_ESCALATE`, rule R12 [01 › Per-reference rules `R1`–`R14` (first matching rule wins)]) to the cloud check. In the cloud there is no further layer, so a blind downgrade would make subject/object swaps (`A outperformed B` vs `B outperformed A`) and qualitative contradictions unreachable. L2 therefore downgrades only the two provably empty cases, and the order condition (over stems **and** values) keeps numeric swaps (`mortality 12% with X and 18% with Y` vs `mortality 18% with X and 12% with Y`) as contradictions.

### 2.4 `bestWindow(evTok, f, from)` (exact)

1. Consider every window `[s, t]` of `evTok` with `from ≤ s ≤ t` and `t − s + 1 ≤ ceil(1.5 × len(f)) + 2`.
2. For each window, compute the **weighted longest common subsequence** between the token strings of `f` and of `evTok[s..t]` by dynamic programming. The weight is **1.0** for content tokens and **0.01** for stopwords. Tokens are equal iff their strings are equal (numeric tokens: equal canonical value, unit and percent flag).
3. Choose the window with the largest weight, compared with the integer key `floor(weight × 100 + 0.5)`. Ties: smallest width, then smallest `s`.
4. `matchedIdx` = the **global** `evTok` indices of the matched tokens, recovered by backtracking (prefer diagonal moves, then moves that decrease `t`).
5. `containment` = matched content tokens / content tokens of `f`. `end` = the largest index in `matchedIdx`.

Units are capped at 60 words [02 › Evidence chunking] and Stage 2 spans at 25 words, so the cost is bounded (< 3 million cell updates per fragment). L2 quotes (≤ 60 words) are bounded by the same DP within the 250 ms watchdog.

### 2.5 Reasoning↔verdict consistency

On `normLower` of the reasoning field — `s03_micro_reasoning` for Stage 2, `s4_reasoning` for L2 — with **whole-word** matching, after deleting the idioms `not inconsistent`, `not contradict`, `not contradicted`, `does not contradict`, `do not contradict`:

| Verdict | Conflict if the reasoning contains |
|---|---|
| `SUPPORTED` (L2 `SUPPORTED`, `PARTIAL`) | `contradict`, `contradicts`, `contradicted`, `opposite`, `conflicts`, `inconsistent`, `refutes`, `does not support`, `do not support`, `not supported` |
| `CONTRADICTS` (L2 `CONTRADICTED`) | `supports`, `consistent with`, `confirms`, `matches` — each **not** preceded within 3 tokens by a negation cue (`isNeg`) |
| `SUPPORTED` or `CONTRADICTS` (and every non-NEI L2 verdict) | `not enough`, `insufficient`, `unclear`, `cannot determine`, `no information`, `does not mention`, `not mentioned` |

`reasoningConflict(r, v)` is true iff a row whose verdict includes `v` matches. An `NEI` verdict never conflicts.

### 2.6 Normative conformance examples (`conformance/l0/anchor.json`)

Content-token counts are stated where a threshold decides the result. The meta-test `anchor.meta.test.ts` runs the complete algorithm and recomputes every stated count.

| # | Evidence unit `EVIDENCE[idx]` | Span | Claim | Decoded | Result |
|---|---|---|---|---|---|
| 1 | `We found no significant difference in 30-day mortality (12.1% vs 12.4%).` | `significant difference in 30-day mortality` | `X lowered 30-day mortality` | SUPPORTED (L1) | Verbatim; the left margin contains `no` → span 0 vs window 1 → **NEI (NEGATION_PARITY)** |
| 2 | same | `no significant difference in 30-day mortality` | `There was no significant difference in 30-day mortality with X` | SUPPORTED (L1) | Verbatim; parity 1 = 1; claim negation 1 = window 1; overlap ⊇ {signific, differ, mortal} ≥ 2 → **SUPPORTED** |
| 3 | `Mortality fell from 18·2% to 12·7% (p = 0·01).` | `Mortality fell from 18.2% to 12.7%` | `Mortality fell from 18.2% to 12.7%` | SUPPORTED (L1) | `·` → `.`; verbatim → **SUPPORTED** |
| 4 | `In non-diabetic patients, the intervention reduced HbA1c by 0.4%.` | `the intervention reduced HbA1c by 0.4%` | `the intervention reduced HbA1c by 0.4%` | SUPPORTED (L1) | The left margin stops at `,`; `nondiabetic` is not a negation cue → **SUPPORTED** |
| 5 | `The treatment reduced pain scores by 30% at 12 weeks.` | `treatment reduced pain ... by 40%` | — | SUPPORTED (L1) | Fragment 2 (`by 40%`) has 1 content token < 3 → **NEI (FRAGMENT_TOO_SHORT)** |
| 6 | `The treatment reduced pain scores by 30% at 12 weeks.` | `The treatment reduced pain scores by 30%` | `The treatment reduced pain scores by 40%` | SUPPORTED (L1) | Anchor passes; same quantity kind (percentage); value 40 ≠ 30 → **NEI (CLAIM_SPAN_MISMATCH)** |
| 7 | same | same | same | CONTRADICTS (L1) | Anchor passes; overlap {treatment, pain, score} = 3; same quantity kind; the value difference is the contradiction → **CONTRADICTS kept** |
| 7b | `The treatment reduced pain scores within 30 days.` | `The treatment reduced pain scores within 30 days` | `The treatment reduced pain scores by 40%` | CONTRADICTS (L1) | The claim reports a percentage; the evidence clause reports only a duration → quantity kind mismatch → **NEI (CLAIM_SPAN_MISMATCH)** |
| 7c | `The treatment reduced anxiety scores by 30%.` | `The treatment reduced anxiety scores by 30%` | `The drug lowered blood pressure by 40%` | CONTRADICTS (L1) | Shared non-numeric stems with the claim: none (`treatment` ≠ `drug`; `anxieti`, `score` vs `blood`, `pressur`) → overlap 0 < 2 → **NEI (LOW_CLAIM_OVERLAP)** |
| 8 | `There was no convincing evidence in this trial that the new intervention substantially reduced mortality.` | `the new intervention substantially reduced mortality` | `the intervention reduced mortality` | SUPPORTED (L1) | `no` lies outside the 4-token margin; scope negation (`no` … `that`) adds 1 → **NEI (NEGATION_PARITY)** |
| 9 | `The intervention reduced mortality, although not significantly (p = 0.2).` | `The intervention reduced mortality` (content tokens: intervention, reduced, mortality = 3 ≥ 3) | `The intervention reduced mortality` | SUPPORTED (L1) | Elliptical concessive `although not` right after the window → **NEI (NEGATION_PARITY)** |
| 9b | `The intervention reduced pain, but there were no serious adverse events.` | `The intervention reduced pain` (3 content tokens) | `The intervention reduced pain` | SUPPORTED (L1) | `but` is followed by `there were no` (the negation is 3 tokens after `but`, not elliptical) → not qualified → **SUPPORTED** |
| 10 | `Differences were non-significant in both arms.` | `Differences were significant in both arms` | — | SUPPORTED (L1) | Verbatim fails; fuzzy containment passes; `nonsignificant` counted → **NEI (NEGATION_PARITY)** |
| 11 | `Adherence was 12.1% in the control arm.` | `Adherence was 2.1% in the control arm` | — | SUPPORTED (L1) | No token-bounded verbatim match (`#12.1%` ≠ `#2.1%`); containment 3/4 passes; numeric parity fails → **NEI (NUMERIC_PARITY)** |
| 12 | `Symptoms worsened by 30% in the treated group.` | `Symptoms improved by 30% in the treated group` | — | SUPPORTED (L1) | Containment 4/5 content tokens passes; valence class POS vs NEG → **NEI (DIRECTION_PARITY)** |
| 12b | `Pain decreased by 30% in the treated group.` | `Pain decreased by 30% in the treated group` | `Pain improved by 30% in the treated group` | SUPPORTED (L1) | `decreased` is in the quantity class, `improved` in the valence class. Parity is not tested across classes, and `measureOf(decreased)` = ADVERSE (`pain`), so the evidence side also carries valence POS, the same as the claim → **SUPPORTED** |
| 13 | `The odds ratio was .045 lower.` | `The odds ratio was 0.045 lower` | `The odds ratio was 0.045 lower` | SUPPORTED (L1) | `.045` = `0.045` by value → **SUPPORTED** |
| 14 | `The effect was not only large but also durable.` | `The effect was not only large but also durable` (content tokens: effect, not, only, large, durable = 5) | `the effect was large and durable` | SUPPORTED (L1) | The idiom `not only` is deleted → negation 0 = 0; verbatim; overlap {effect, larg, durabl} = 3 → **SUPPORTED** |
| 15 | `Rates were similar between groups.` | `Rates were similar between groups` (content tokens: rates, similar, groups = 3) | `Rates were similar between groups` | SUPPORTED (L1) | No strong negation on either side, so `similar` is not counted (SOFT_NEG rule): 0 = 0 → **SUPPORTED** |
| 15b | same | same | `Rates did not differ between groups` | SUPPORTED (L1) | Step 5: span and window are identical (0 = 0). Step 8c: the claim contains `not` and (`not`, `differ`), so `softFor(clTok)` is true and `similar` counts on the evidence side: `negWinCl` = 1 = claim 1; overlap {rate, group} = 2 → **SUPPORTED** |
| 15c | `Mortality was lower in patients with heart failure.` | `Mortality was lower in patients with heart failure` | `Mortality was lower in patients with heart failure` | SUPPORTED (L1) | `failure` in the bigram (`heart`, `failure`) is not a negation cue → **SUPPORTED** |
| 16 | any | `not enough information` | — | SUPPORTED with reasoning `the abstract does not mention dose` (L1) | **NEI (REASONING_VERDICT_CONFLICT)** |
| 17 | `Readmission was 30% in both arms.` | `Readmission was 30% in both arms` | `Readmission was 30 days in both arms` | SUPPORTED (L1) | `30%` vs `30` (days): `isPercent` differs → quantity kind mismatch → **NEI (CLAIM_SPAN_MISMATCH)** |
| 18 | `The drug reduced blood pressure in older adults.` | `The drug reduced blood pressure in older adults` | `The drug reduced blood pressure in older adults` | CONTRADICTS (L1) | Claim = span = evidence clause; no value, negation or direction difference → **NEI (NO_DIFFERENCE_SIGNAL)**; the pair escalates quietly to the cloud check |
| 18b | same | same | same | CONTRADICTED (L2, provided quote) | `identical` is true → **NEI (NO_DIFFERENCE_SIGNAL)** |
| 19 | `Drug Y outperformed drug X in remission rates.` | `Drug Y outperformed drug X in remission rates` | `Drug X outperformed drug Y in remission rates` | CONTRADICTS (L1) | No value, negation or direction difference → **NEI (NO_DIFFERENCE_SIGNAL)** (escalates to L2) |
| 19b | same | same | same | CONTRADICTED (L2, provided quote) | Not identical; no values, so the quantity condition does not apply → **CONTRADICTED kept**, `noDifferenceNote = true` (inspector: *"No difference in numbers, negation or direction was found; the cloud judged the meaning."*) |
| 19c | `Mortality was 12% with X and 18% with Y.` | same as the evidence | `Mortality was 18% with X and 12% with Y` | CONTRADICTED (L2, provided quote) | Same values {12 %, 18 %}, same kind, same negation and direction, so `anyDiff` is false; but the shared keys appear in a different order (claim `mortal, 18%, x, 12%, y` vs evidence `mortal, 12%, x, 18%, y`) → `sameOrder` false → **CONTRADICTED kept**, `noDifferenceNote = true` |
| 20 | `The drug increased pain scores in older adults.` | `The drug increased pain scores in older adults` | `The drug improved pain scores in older adults` | SUPPORTED (L1) | `increased` changes the adverse measure `pain` → valence NEG; the claim's `improved` → valence POS; `dirDiff` → **NEI (CLAIM_SPAN_MISMATCH)**. With decoded CONTRADICTS the same pair is kept, because `dirDiff` is a difference signal |

Further mandatory cases in `anchor.json`: each `AnchorFailReason` at least once (including `UNCALIBRATED_VARIANT`, produced by the calibrated-variant rule of [04 › Token and output budgets]); negation to the right of the window; hyphenated `non-significant`; the contraction `didn't`; the direction pair `increased`/`decreased`; comparator mismatch `>` vs `<`; the negation exclusions `heart failure`, `renal failure`, `treatment failure`, `similar methods`, `not inconsistent`; a claim number checked against the evidence clause, not the whole unit; `kindMismatch` with equal `(unitFamily, isPercent)` but cue-derived metric classes (no mismatch); measure valence (`increased survival` vs `improved survival`, same valence).

---

## 3. Fast Path, Atom Mapping & Deterministic Triage Baseline

### 3.1 Stage 1 word numbering and atom mapping

**Word numbering.** Stage 1 receives the sentence's prompt text split into **words** [02 › Rule-Based Sentence Segmentation], numbered `0..n−1`. At most **80** words are sent; a longer sentence is truncated after word 79 and the truncation is recorded in telemetry (`stage1_truncated`, count only). Stage 1 atoms are word-index ranges `[start, end]` (inclusive) [04 › `TriageV1` and `TriageFlatV1` (Stage 1)].

**Atom → clause mapping.** Each atom is assigned to the clause that contains the **majority of its words**; ties go to the earlier clause. The atom's range is stored, as word indices of the sentence, in the `atoms` of the effective triage of that clause [01 › Effective triage]. An atom outside every clause (only possible after truncation) is dropped.

### 3.2 Fast-path scheduling (D-14)

```
for each eligible sentence S:
    compute the deterministic baseline triage for S (§3.4)                   # always, synchronous in L0
    if any clause of S has ≥ 1 resolved refId:
        for each such clause c and each ref r of c: enqueue Stage2(c, r) at P0
        enqueue Stage1(S) at P1_BACKGROUND
    else:
        enqueue Stage1(S) at P1

on Stage2 result for (c, r) from the fast path:
    store the result (event E5)
    if result.verdict == NEI_SILENT_ESCALATE and Stage1(S) has not completed:
        emit E11(c, { since: now }, nextSeq(c))                             # versioned; derived state = CHECKING

on the first of: Stage1 result for S; Stage1 failing twice; 60 s after heldNei.since:
    apply event E4 (or keep the baseline values on failure or timeout)
    emit E11(c, null, nextSeq(c)) for every clause c of S                    # versioned clear
    # The reducer then decides visibility: a cited clause whose effective claim type is METHODOLOGICAL and has no
    # support, contradiction or reference problem is NOT_CHECKABLE (rule C4b); otherwise an NEI result is WAITING
    # or UNVERIFIABLE by rule R12.

for each clause c without any Stage 1 atom and with ≥ 1 resolved refId:
    Stage 2 runs (already enqueued by the fast path); its check-worthiness comes from the baseline (§3.4)
```

- `now` is the epoch-ms clock reading of the scheduler (the reducer never reads a clock).
- **Queue rules** [04 › Queue semantics]: `P1_BACKGROUND` jobs age by one priority level every 20 s while waiting, so they cannot starve while the author types. A held NEI never waits longer than **60 s**.
- Only clauses in `WAITING` enter the cloud queue, and only through the batch consent sheet (consent class B, D-09) or the one-click sample check (D-26).

### 3.3 Multi-reference aggregation

Multi-reference aggregation is defined **only** by the reducer [01 › Per-reference rules `R1`–`R14` (first matching rule wins)], [01 › Clause rules `C0`–`C16` (first matching rule wins)]. In summary:
- a clause cited to several sources is `SUPPORTED` only if every cited source supports it with confirmation;
- it is `MIXED_SUPPORT` if at least one source supports it and at least one other cannot be verified (a coverage gap, counted as `unverifiable`);
- it is `CONTRADICTED` or `HINT` if any source contradicts it.

The claim inspector always lists the per-reference states.

### 3.4 Deterministic triage baseline (`baselineTriage(S, c)`)

The baseline always runs. It decides the effective triage for every task whose authority is `advisory` [01 › Effective triage], and it is the locked comparison baseline of CF-1 (§1.2).

```
CAUSAL_CUES      = {cause, causes, caused, causing, leads to, led to, lead to, resulted in, results in, result in, induce,
                    induces, induced, because of, due to, mediate, mediates, mediated, attributable to}
                    # multi-word cues match as consecutive normLower words
COMPARATIVE_CUES = {increase, increased, increases, decrease, decreased, decreases, reduce, reduced, reduces, reduction,
                    improve, improved, improves, higher, lower, greater, fewer, compared, versus, vs, outperform,
                    outperformed, superior, inferior, associated, association, correlated, correlation, predict,
                    predicted, predicts}
COMPARATIVE_WITH_NUMBER = {more, less, than, risk, odds}         # counted only when the clause also has a value
EXISTENCE_CUES   = {exist, exists, present, presence, identified, detected, observed, found, reported, occurs, occur}
COUNT_NOUNS      = {patients, participants, subjects, people, persons, individuals, cases, controls, studies, trials,
                    samples, cohorts, groups, sites, centres, centers, countries, hospitals, schools, children, adults,
                    women, men, mice, rats, animals, cells, years, months, weeks, days, hours, times, doses, events,
                    deaths, items, questions, respondents, experiments, models, datasets}
                    # identical to COUNT_NOUNS of [02 › Value rules 1–9 (first match at a position wins, in this order)]
UNCITED_SECTIONS = {introduction, discussion, unlabeled}          # "background" maps to introduction
METHOD_OPENERS   = {"we used", "we performed", "we conducted", "we collected", "we recruited", "we analyzed",
                    "we analysed", "we measured", "we applied", "we followed", "data were", "samples were",
                    "participants were"}

baselineTriage(S, clause c):
  nums  = value expressions in c [02 › Value Grammar, Units & Metric Classes], excluding numbers inside citation
          markers and excluding bare integers 1900–2099 that have no unit and no metric-class cue (a year is not a
          quantity). A number word counts only when the next word is a unit or a COUNT_NOUN; "one of", "no one",
          "one can", "one or more", "one another", "one hand" and "one way" never count
  words = normLower words of c
  type  = QUANTITATIVE   if nums non-empty
        = CAUSAL         elif c contains a CAUSAL_CUES entry
        = COMPARATIVE    elif words ∩ COMPARATIVE_CUES ≠ ∅ or (nums non-empty and words ∩ COMPARATIVE_WITH_NUMBER ≠ ∅)
        = EXISTENCE      elif words ∩ EXISTENCE_CUES ≠ ∅
        = METHODOLOGICAL elif section(S) = methods or c starts with a METHOD_OPENER
        = NON_EMPIRICAL  otherwise
  worth = HIGH if type ∈ {QUANTITATIVE, CAUSAL, COMPARATIVE} or (type = EXISTENCE and c has a citation) else LOW
  uncited = (c has no resolved markers) and worth = HIGH and type ≠ METHODOLOGICAL
            and section(S) ∈ UNCITED_SECTIONS            # never in abstract, methods, results, limitations,
                                                         # conclusion, supplementary
  atoms = [ whole clause as one atom ]
  return { atoms, worth, claimType: type, uncited }
```

The baseline is a pure function of the clause, its sentence and its section label. It is recomputed on every E1 [01 › Event table]. A clause without resolved markers that is not flagged `uncited` derives `NOT_CHECKABLE` (rule C0); it is never left `UNCHECKED`.

**Normative examples (`conformance/l0/triage_baseline.json`):**

| Sentence (section) | Type | Worth | Uncited | Derived state |
|---|---|---|---|---|
| `We enrolled 120 patients.` (methods) | `QUANTITATIVE` | `HIGH` | no (methods) | `NOT_CHECKABLE` (C0) |
| `Mortality was 12% in the treated group.` (results) | `QUANTITATIVE` | `HIGH` | no (the author's own result) | `NOT_CHECKABLE` (C0) |
| `Mortality was 12% in the treated group.` (discussion) | `QUANTITATIVE` | `HIGH` | **yes** | `UNCITED_EMPIRICAL` (C5) |
| `One of the main causes of delay is staffing.` (introduction) | `CAUSAL` (`one` is not a number) | `HIGH` | **yes** | `UNCITED_EMPIRICAL` (C5) |
| `We followed the protocol of [3].` (methods) | `METHODOLOGICAL` | `LOW` | no | `NOT_CHECKABLE` (C4b, cited) |
| `This study aims to describe staffing.` (introduction) | `NON_EMPIRICAL` | `LOW` | no | `NOT_CHECKABLE` (C0) |
| `More patients were treated.` (discussion) | `NON_EMPIRICAL` (`more` without a value is not a cue) | `LOW` | no | `NOT_CHECKABLE` (C0) |
| `The delay resulted in longer stays.` (discussion) | `CAUSAL` (`resulted in`) | `HIGH` | **yes** | `UNCITED_EMPIRICAL` (C5) |
| `The results are shown below.` (results) | `NON_EMPIRICAL` (`results` as a noun is not a cue) | `LOW` | no | `NOT_CHECKABLE` (C0) |

---

## 4. B5 Manuscript Self-Consistency Engine

### 4.1 Tuple sources (all deterministic, L0)

1. **Manuscript prose:** value expressions [02 › Value Grammar, Units & Metric Classes] in each sentence's prompt text, including normalized inline math (`$n=48$` → `n=48`) and siunitx macros [02 › Normalization-time LaTeX substitutions].
2. **Tables:**
   - Markdown pipe tables;
   - LaTeX `tabular`/`tabularx`/`longtable` cells: `&` is the cell separator and `\\` the row separator; `\hline`, `\toprule`, `\midrule`, `\bottomrule` and `\cline{…}` are deleted; `\multicolumn{k}{·}{X}` → `X` repeated over `k` columns;
   - `.docx` tables (§5.3).

   The cell's column header (first row) and row label (first column) form the tuple's context window.
3. **O3 lab notes:** value expressions in the author-confirmed OCR text of a typed or printed lab note, with `source = "lab_note"` and section `"lab:" + photoSha256.slice(0, 12)`. **Handwriting is out of scope**: the O3 capture screen states *"Typed or printed notes only."*, and values the author cannot confirm against the OCR text are never used.

Year-like integers 1900–2099 with no unit, and numbers inside citation markers, are not tuples.

### 4.2 Key lemmas

`keyLemmas` = the Porter stems (`porter_v1.json`) of the content words in the **±6-word window** around the value, excluding numbers, unit words, stopwords and the citation placeholder `⟦c⟧`, deduplicated and sorted ascending. For table tuples, the window is the **column header plus the row label**. This definition is identical to [02 › Key lemmas], which owns it.

### 4.3 Local storage schemas

#### 4.3.1 Android (Room)

```sql
CREATE TABLE IF NOT EXISTS quant_tuples (
  tuple_id      TEXT PRIMARY KEY NOT NULL,
  doc_id        TEXT NOT NULL,
  claim_id      TEXT,                         -- null for table and lab-note tuples
  sentence_hash TEXT NOT NULL,
  occurrence    INTEGER NOT NULL,
  section       TEXT NOT NULL,
  metric_class  TEXT NOT NULL,
  key_lemmas    TEXT NOT NULL,                -- space-separated, sorted ascending
  value_raw     TEXT NOT NULL,
  value_norm    REAL,
  value_lo      REAL,
  value_hi      REAL,
  sig_digits    INTEGER NOT NULL,
  p_comparator  TEXT CHECK (p_comparator IN ('<','<=','=','>','>=') OR p_comparator IS NULL),
  unit_canon    TEXT NOT NULL,
  source        TEXT NOT NULL CHECK (source IN ('manuscript','lab_note','print_page')),
  span_start    INTEGER NOT NULL,
  span_end      INTEGER NOT NULL,
  window_text   TEXT NOT NULL,                -- ±20 words around the span (B5 prompt)
  updated_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_qt_doc_class ON quant_tuples(doc_id, metric_class);
CREATE INDEX IF NOT EXISTS ix_qt_sentence ON quant_tuples(doc_id, sentence_hash, occurrence);

-- Full-text index over key lemmas for candidate lookup.
-- Room entity: @Fts4(contentEntity = QuantTupleEntity::class) data class QuantTupleFts(@ColumnInfo(name = "key_lemmas") val keyLemmas: String)
CREATE VIRTUAL TABLE IF NOT EXISTS quant_tuples_fts USING fts4(content=`quant_tuples`, key_lemmas);

CREATE TABLE IF NOT EXISTS b5_checks (
  pair_key     TEXT PRIMARY KEY NOT NULL,     -- sha256hex(min(tupleIdA,tupleIdB) + "|" + max(tupleIdA,tupleIdB))
  tuple_a      TEXT NOT NULL,                 -- min(tupleIdA, tupleIdB)
  tuple_b      TEXT NOT NULL,                 -- max(tupleIdA, tupleIdB)
  verdict      TEXT NOT NULL CHECK (verdict IN ('DETERMINISTIC_CONSISTENT','INCONSISTENT',
                                                'CONSISTENT_DIFFERENT_SUBSET','DIFFERENT_QUANTITY')),
  provenance   TEXT NOT NULL CHECK (provenance IN ('DETERMINISTIC','ON_DEVICE')),
  checked_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_b5_a ON b5_checks(tuple_a);
CREATE INDEX IF NOT EXISTS ix_b5_b ON b5_checks(tuple_b);

CREATE TABLE IF NOT EXISTS results (
  result_key            TEXT PRIMARY KEY NOT NULL,
  kind                  TEXT NOT NULL CHECK (kind IN ('L','C','P','S1')),
  normalized_claim_hash TEXT,                 -- null for S1
  ref_id                TEXT,                 -- null for S1 and LAB_NOTE physical results
  decided_at            INTEGER NOT NULL,
  json                  TEXT NOT NULL         -- JCS (RFC 8785) serialization of the result
);
CREATE INDEX IF NOT EXISTS ix_results_lookup ON results(kind, normalized_claim_hash, ref_id);
```

The database file lives in the app's no-backup storage (`android:allowBackup="false"` and `dataExtractionRules` excluding every domain; D-10).

#### 4.3.2 Web (Dexie)

```ts
// apps/web/src/storage/dexie.ts
db.version(1).stores({
  documents:    "docId, kind, updatedAt",
  entries:      "claimId, docId, [docId+sentenceHash], normalizedClaimHash, archived",
  refFacts:     "[docId+refId], docId",
  evidence:     "chunkId, [refId+kind], refId",
  quant_tuples: "tupleId, docId, [docId+metricClass], sentenceHash, claimId, source, *keyLemmas, updatedAt",
  b5_checks:    "pairKey, tupleA, tupleB, checkedAt",
  results:      "resultKey, kind, [kind+normalizedClaimHash+refId], decidedAt",
  overrides:    "[docId+normalizedClaimHash+refIdsKey]"
});
```

- The multi-entry index `*keyLemmas` serves candidate lookup directly, so tuple updates need no read-modify-write of a separate lemma index.
- `overrides` persists each entry's `override` (`Versioned<AuthorOverride | null>`) under `(docId, normalizedClaimHash, refIdsKey)`. When E1 inserts a new entry, its `override` is initialized from this store with its stored `seq`; this is how an override survives a trivial edit that creates a new `claimId` [01 › Clause rules `C0`–`C16` (first matching rule wins)].
- The `results` compound index is the lookup used to materialize cloud and physical results [01 › Persisted result cache].
- "Delete local data" deletes the whole database [06 › Lifecycle and storage].

### 4.4 Deterministic incremental pairing

**Trigger.** Pairing runs **1 s** (debounced) after any tuple change.

**Candidates from the index, never from all pairs.** For each changed tuple `T`, the candidates are the tuples `X` of the same `docId` and `metricClass` that share at least one key lemma with `T`, found through the multi-entry index `*keyLemmas` (Web) or `quant_tuples_fts` (Android).

**Watchdog splitting.** The batch is split into one L0 job per metric class; each job runs under the **250 ms** watchdog (D-27). A job that times out is split in half and retried. A single-tuple job that times out marks that tuple's clause with `PARSE_TIMEOUT` (event E14). The result does not depend on insertion order.

**Orphan cleanup.** Rows of `b5_checks` whose tuples no longer exist are deleted in the same job.

```
for each candidate pair (T, X) of tuples of the same document with
      T.metricClass = X.metricClass ≠ other
      AND sameFamily(T.unitCanon, X.unitCanon)                  # unknown:* never pairs; "%" never pairs with ""
      AND (T.sentenceHash, T.occurrence, T.source) ≠ (X.sentenceHash, X.occurrence, X.source)
      AND jaccard(set(T.keyLemmas), set(X.keyLemmas)) ≥ 0.35
      AND T.valueNorm ≠ null AND X.valueNorm ≠ null:
    a = canonical(T); b = canonical(X)                          # unit conversion to the family's canonical unit
    if consistent(a, b): record b5_checks(pair_key, DETERMINISTIC_CONSISTENT, DETERMINISTIC); continue
    divergent.add((T, X))

consistent(a, b):
    if metricClass = p_value: return pCompatible(a, b)
    tolA = 0.5 × 10^(−decimals(a.valueRaw)) × unitFactor(a)     # unitFactor(t): factor from t's raw unit to canonical
    tolB = 0.5 × 10^(−decimals(b.valueRaw)) × unitFactor(b)
    tol  = max(tolA, tolB)                                      # symmetric: independent of the order of T and X
    return |a.valueNorm − b.valueNorm| ≤ tol                    # point estimates compared; CI overlap is NOT used

pCompatible(a, b):                                              # each side is an interval of possible p values
    I(t) = (t.pComparator, t.valueNorm) mapped to: "<" → [0, v), "<=" → [0, v], "=" → [v − tol(t), v + tol(t)],
           ">" → (v, 1], ">=" → [v, 1]       with tol(t) = 0.5 × 10^(−decimals(t.valueRaw))
    return I(a) ∩ I(b) ≠ ∅
    # "p<0.05" vs "p=0.03" → true; "p<0.05" vs "p=0.08" → false; "p=0.04" vs "p=0.041" → false

for each tuple T in AFFECTED: keep its top 3 divergent partners ranked by
    (jaccard desc, sectionDistance asc, min(tupleId) asc, max(tupleId) asc)
    # AFFECTED = the changed tuples Δ  ∪  every tuple that is a candidate partner of a tuple in Δ (BOTH sides).
    # Recomputing the partner side too makes the incremental result equal to a full recomputation: a new tuple can
    # push an old pair out of its partner's top 3, and a deleted tuple can let another pair in.
candidates = union of kept pairs over all tuples (unchanged tuples keep their stored lists)
for each candidate pair without a b5_checks row: enqueue B5Check(T, X) at P3
emit E13(claimIds of both sides of every pair whose kept status or verdict changed)

sectionDistance = 0 if same section; 1 if the pair is {abstract, results} or {abstract, conclusion}; 2 otherwise
decimals(valueRaw) = number of digits after the decimal separator in valueRaw (0 if none)
jaccard(A, B) = |A ∩ B| / |A ∪ B|, compared as floor(j × 1e9 + 0.5) against floor(0.35 × 1e9 + 0.5)
```

`tupleId` includes `sentenceHash` and `valueRaw` [01 › Document and clause identity], so editing either side produces new identifiers.

**Two-way flags.** Event E13 recomputes `b5.inconsistentWith` for **both** claims of a pair, so a stale flag never survives an edit. `inconsistentWith` holds the claimIds of partners whose effective outcome (§4.6) shows the purple badge.

**Conformance.** `conformance/l0/b5_incremental.json` checks that adding, editing and deleting tuples in every order yields the same kept pairs as a full recomputation, including a new tuple that pushes an old pair out of its partner's top 3. `conformance/l0/b5pairing.json` checks: the same value within `max(tolA, tolB)` in both argument orders; different unit families never paired; lemma Jaccard just below and just above 0.35; the cap of 3 partners; candidates only from the key-lemma index; per-metric-class jobs; orphan `b5_checks` rows deleted.

### 4.5 Deterministic three-class B5 baseline

Used as the CF-1 comparison and as the decision when B5 is `advisory`. It predicts all three classes; the first match wins:

1. **`CONSISTENT_DIFFERENT_SUBSET`** iff the pair is divergent, `metricClass ∈ {sample_size, count}`, the smaller value's window contains an **attrition cue** (`completed`, `analysed`, `analyzed`, `followed up`, `follow-up`, `excluded`, `withdrew`, `withdrawn`, `lost to follow-up`, `discontinued`, `per-protocol`, `evaluable`, `remaining`), and the smaller value belongs to the tuple whose window has the cue;
2. **`INCONSISTENT`** iff the pair is divergent ∧ `jaccard ≥ 0.5` ∧ `sectionDistance ≤ 1`;
3. **`DIFFERENT_QUANTITY`** otherwise.

**Golden cases (`conformance/l0/b5_baseline.json`):** an attrition cue in the smaller value's window (`CONSISTENT_DIFFERENT_SUBSET`); a cue in the larger value's window (not a subset); Jaccard ≥ 0.5 with section distance ≤ 1 (`INCONSISTENT`); otherwise `DIFFERENT_QUANTITY`; an L1 `INCONSISTENT` with `s2_same_population = false` turned into `DIFFERENT_QUANTITY`.

### 4.6 L1 B5 contract and outcomes

**L1 input** (`B5CheckV1` [04 › `B5CheckV1`]): the two tuples' `window_text` (±20 words each), their raw values, their sections and their canonical values.
- The **variable part** (both windows, values and sections) is **≤ 260 tokens**.
- The whole prompt, including the constant instructions and the schema, is **≤ 420 tokens** (D-13).
- L1 decides only whether the two tuples describe the same population and timepoint.

**Consistency check (L0, Tier B).** A decoded `s3_verdict = INCONSISTENT` with `s2_same_population = false` becomes `DIFFERENT_QUANTITY`. The checked outcome is stored in `b5_checks` with `provenance = ON_DEVICE`.

**Outcome → UI** (authority of task B5 for the device profile [01 › Effective triage]):
- **`authoritative`:**
  - L1 `INCONSISTENT` → **purple** badge on both spans: *"Numbers differ between {sectionA} and {sectionB} of your manuscript."*
  - `CONSISTENT_DIFFERENT_SUBSET` → no badge; the detail view shows *"different subgroup or timepoint"*.
  - `DIFFERENT_QUANTITY` → no badge.
- **`advisory`:** the badge appears only when the deterministic baseline (§4.5) says `INCONSISTENT`; the L1 decision is shown in the detail view as *"On-device assessment: {outcome}"*.

The UI MUST NOT auto-correct either value. A B5 flag never changes a clause state or a meter bucket; it is counted only in the drill-down line "Number mismatches" [01 › Independent flags].

**O3 lab-note integration (Android).** A lab-note tuple pairs exactly like a manuscript tuple. An inconsistency shows the purple flag *"Your manuscript differs from your lab note ({pageLabel})"* with the row crop. When the author confirms it, event E16 records the lab-note mismatch flag [01 › Event table]. A lab-note result **never** produces `CONTRADICTED`, `HINT` or any red mark (D-29).

---

## 5. Multi-Format Client-Side Ingestion, Editability, Batch Audit & Exports

All ingestion runs on the client, in Workers (`apps/web/src/workers/ingest.worker.ts`, `pdf.worker.ts`), under the 250 ms per-step watchdog. Manuscript files are never uploaded. Only reference identifiers and titles leave the device, through `bibResolve` [05 › `bibResolve` and `bibResolveJudge`]; with "DOI-only lookup" on, only DOIs leave the device.

### 5.1 Ingestion safety limits (all inputs)

| Limit | Value | On violation |
|---|---|---|
| Archive file size | ≤ **200 MB** | Rejected: *"This archive is larger than 200 MB. Remove images or build files and try again."* |
| Entries listed in the archive | ≤ **5,000** | Rejected: *"This archive has too many files."* |
| Entries decompressed | **Text sources only**: `.tex`, `.bib`, `.bbl`, `.md`, `.txt`; images, PDFs and binaries are never decompressed | Skipped and counted in the import-quality report |
| Decompressed size per entry | ≤ **20 MB**, and compression ratio ≤ **100** | Entry skipped and reported |
| Total decompressed text | ≤ **50 MB** | Import stops; the report shows the files read |
| Paths | No absolute paths; no `..` segments after normalization (path traversal rejected) | Entry skipped and reported |
| `\input` expansion | Depth ≤ **10**; cycle guard by normalized path; total expanded text ≤ **2 MB** | Expansion stops at the limit; the report lists the files not expanded |

The same per-entry and ratio limits apply to `.docx` files, which are ZIP containers.

### 5.2 LaTeX archive, `.tex` + `.bib`, `.md`

| Step | Procedure |
|---|---|
| 1 | Unzip with JSZip in a Worker under the limits of §5.1. |
| 2 | **Main file** = the `.tex` file that contains both `\documentclass` and `\begin{document}` outside comments. If several qualify, prefer `main.tex`, then the largest. |
| 3 | Resolve `\input{f}`, `\include{f}` and `\subfile{f}` recursively, appending `.tex` if missing. The search for these commands **skips comments, `verbatim`-like environments and `\iffalse … \fi` blocks**. Each file's own text is read once (**memoized**); including the same file twice expands it twice, within the 2 MB total limit. Keep a **bidirectional** offset map `(fileName, localOffset) ↔ globalOffset`. A multi-file project opens as a **read-only audit copy** (§5.5); each claim carries `file:line` for deep links in reports. |
| 4 | **Bibliography files:** the arguments of `\bibliography{a,b}` (`.bib` appended) and `\addbibresource{x.bib}`; if none are given, all `.bib` files in the archive. |
| 5 | Parse `.bib` with `@retorquere/bibtex-parser` (`sentenceCase: false`, `raw: false`, unknown commands preserved). A `doi` field is taken **verbatim**: trimmed, with a leading `https://doi.org/`, `http://dx.doi.org/` or `doi:` stripped; it is never re-scanned, so SICI DOIs containing `<`, `>` or `;` stay intact. |
| 6 | If no `.bib` exists: parse `\bibitem[label]{key} text` from `thebibliography` in the main source, or from a `.bbl` file in the archive, into raw reference strings (numbered in order). |
| 7 | `.md` (Pandoc): read the YAML front matter keys `bibliography:` (and load that `.bib` if it is in the same drop), `lang:` and `math:`. |

### 5.3 `.docx` importer (read-only audit source)

`mammoth` and `turndown` MUST NOT be used. The importer reads the package directly:

1. **Unzip** with JSZip under the limits. Read `word/document.xml`, and `word/footnotes.xml` if present, with `fast-xml-parser` (`preserveOrder: true`, `ignoreAttributes: false`).
2. **Walk** the children of `w:body` in document order and build an internal Markdown text:
   - `w:p` → one paragraph. A `w:pStyle w:val` of `Title` or `Heading1` … `Heading9` → a Markdown heading line with the corresponding number of `#` (`Title` → 1).
   - `w:r` → its `w:t` text (respecting `xml:space="preserve"`); `w:tab` → tab; `w:br` → newline.
   - Run property `w:vertAlign w:val="superscript"` → a **superscript run** (step 4).
   - `w:tbl` → a Markdown pipe table (one line per `w:tr`; cells = the concatenated paragraph text of each `w:tc`).
   - `m:oMath` / `m:oMathPara` → `$` + concatenated `m:t` text + `$`, treated as inline math under the Pandoc rule.
   - `w:footnoteReference w:id=k` → the footnote's paragraphs are emitted as a separate prose stream after the paragraph.
3. **Fields.**
   - A complex field is `w:fldChar w:fldCharType="begin"` → `w:instrText` runs (concatenated) → `w:fldChar w:fldCharType="separate"` → result runs → `w:fldChar w:fldCharType="end"`.
   - A simple field is `w:fldSimple w:instr="…"` with result runs as children.
   - **Zotero and Mendeley:** for each field whose instruction starts with `ADDIN ZOTERO_ITEM CSL_CITATION ` (Zotero) or `ADDIN CSL_CITATION ` (Mendeley), parse the following JSON and read `citationItems[].itemData` (DOI, title, authors, year). The field's **result text** (for example `[1]` or `(Smith, 2020)`) is emitted unchanged, and its output range is recorded as an authoritative citation marker carrying those items [02 › Linear-Time Citation-Marker Scanner & Key Resolution] (Rule 6).
   - **EndNote:** for `ADDIN EN.CITE`, parse the XML in the instruction for `DOI`, `title`, `author`, `year`. When the data is in a separate base64 `EN.CITE.DATA` field, decode it and parse it as XML.
   - **Bibliography fields** `ADDIN ZOTERO_BIBL`, `ADDIN EN.REFLIST` and `ADDIN Mendeley Bibliography CSL_BIBLIOGRAPHY` mark the bibliography: their paragraphs are masked from prose and parsed as raw reference strings.
4. **Superscript runs outside fields.**
   - A superscript run of digits, `,` and `-` is an **exponent** if the preceding character is a `DIGIT`, or the preceding token is a unit in `UNIT_TOKENS` = {`m`, `cm`, `mm`, `km`, `g`, `kg`, `s`, `L`, `mL`, `mol`, `dm`, `μm`, `nm`, `m2`, `cm2`, `10`}. An exponent is emitted as `^` + digits.
   - Otherwise it is a numeric citation candidate and is emitted as `[digits]`, so Rule 2 of the citation scanner (including the bibliography-size check) decides.
5. **Reference list without fields:** paragraphs under a heading whose canonical label is `references` become raw reference strings.
6. The result is a **read-only audit copy** (§5.5). The UI shows the banner *"This is a read-only audit copy of your Word file. Fix the original, then choose Re-import."*

### 5.4 User-provided PDF (reference full text)

- `pdfjs-dist` **≥ 4.2.67** with `isEvalSupported: false`, in a Worker → section-aware chunks [02 › Evidence chunking] with `sourceKind = USER_PDF` → stored per device in the `evidence` store.
- `USER_PDF` text is used for on-device checks. It is sent to the cloud only when the author ticks "Include text from my PDFs" in the batch consent sheet (D-09).
- **Page-1 DOI scanner:** the PDF is associated with a reference by the first DOI found on page 1, matched by the scanner `10.` + 4–9 `DIGIT` + `/` + 1–300 characters that are not `SPACE`, `"`, `<` or `>`, with trailing `.`, `,`, `;` and `)` stripped, compared case-insensitively against resolved DOIs. Otherwise the author picks the reference manually.
- Raw reference strings are resolved by `bibResolve` with the Crossref bibliographic query [05 › `bibResolve` and `bibResolveJudge`], unless "DOI-only lookup" is enabled.

**Android local files.** The Pocket Ledger accepts local files chosen through the operating-system file picker or share sheet: a single `.md` or `.tex` file (without includes) with an optional `.bib`, and PDFs attached as `USER_PDF` evidence to a reference of the open ledger. They are processed entirely on the device by the Kotlin L0 port under the limits of §5.1. Because the build makes no network calls, references of an imported file that are not in the bundled cache keep `bibStatus = UPSTREAM_UNAVAILABLE` [01 › Enumerations].

### 5.5 Document kinds and editability (D-26)

| Document kind | Editable in Toulmin? | How the author's text leaves Toulmin |
|---|---|---|
| **Single-file document**: a blank document, one `.md`, one `.tex` without `\input`/`\include`/`\subfile`, and the built-in **Sample Manuscript** | **Yes** | **Download source** (`.md` or `.tex`, the exact bytes of the editor content, UTF-8). On the first edit the client calls `navigator.storage.persist()`; if it returns `false`, the UI shows *"Your browser may clear this document when storage is low. Download source regularly."* When the tab is closed with changes made since the last download, the browser's `beforeunload` confirmation is triggered. |
| **Multi-file project**: a `.zip` LaTeX project, a `.tex` that includes other files, or a `.docx` | **No** — read-only audit copy | The author edits the original in their own editor and chooses **Re-import** (same `docId`). Re-import is **format-agnostic**: it accepts any multi-file kind (for example a `.docx` exported from the same LaTeX project), because results are keyed by content (`resultKey`), not by file type. Re-import re-runs ingestion; every unchanged clause restores its verdicts by `resultKey` [01 › Persisted result cache]; clauses whose `normalizedClaimHash` changed are queued first; `file:line` deep links point at the new files. |

The Sample Manuscript always opens as an editable single-file document, so live typing works in judge sessions and in the video. The import screen states the scope in one sentence: *"Multi-file projects open as a read-only audit copy: keep editing in your own editor and re-import to refresh."*

### 5.6 Viewport-prioritized batch audit queue

**Trigger:** an import of a manuscript with existing text, a paste of more than 5 sentences, or the "Audit whole manuscript" button.

**Ordering key** (ascending): `(band, distance, ordinal)`.
- `band = 0` if the sentence intersects the editor viewport; `1` if it is within ±2 viewport heights; `2` otherwise.
- `distance` = the absolute line distance to the viewport centre.
- `ordinal` = document order.

**Re-prioritization.** On scroll (debounced **300 ms**), all pending audit jobs are re-keyed. Audit jobs run at **P4** and are preempted by P0–P3 [04 › Queue semantics]. Imported sentences enter as P4 audit jobs, never as P0, even when they contain resolved citations.

**Progress UI:** *"Auditing {done}/{total} sentences · about {remainingMinutes} min left"*, where `remainingMinutes = ceil(remaining × p50(observed Stage 1 + Stage 2 durations on this device) / 60)`. No estimate is shown until **10** sentences have completed. Android has no whole-manuscript audit; it uses ledger review (O1).

### 5.7 Exports

#### 5.7.1 `integrity-report.md` and `integrity-report.pdf`

The PDF is the browser print of the same HTML. Items are ordered by action, in six sections:

1. ***Fix references*** — `REFERENCE_PROBLEM`, `CHECK_METADATA`, then (as information) possible citations not matched and references not found in indexes;
2. ***Rewrite or re-check claims*** — `CONTRADICTED`, `HINT`, `PARTLY_SUPPORTED`, and number mismatches;
3. ***Add sources*** — `UNCITED_EMPIRICAL`, `UNVERIFIABLE`, `MIXED_SUPPORT`;
4. ***Waiting*** — `WAITING`, `SOURCE_FLAGGED`;
5. ***Reviewed by author*** — `REVIEWED_BY_AUTHOR`;
6. ***Supported*** — `SUPPORTED`.

Each item lists `file:line`, the claim text, the per-reference states, the **anchored evidence quote from the source paper only**, the DOI, and the provenance. **Grounded web text and grounding links are never exported** (D-19). `SUPPORTED_LOCAL` and `LOCAL_EVIDENCE` items appear under *Waiting* when the cloud is available and under *Add sources* otherwise, always labelled "On this device · not a verdict".

The report header contains:
- the Coverage Meter header line [01 › Header (exact format)];
- the **calibration summary**: per profile, the path (A or B), the task authorities, and — only where measured — the prevalence-adjusted precision **always together with its conservative lower bound `P_LB(π)`** (D-07);
- the exact sentence *"Unmarked text has not been verified."*

The report contains no manuscript text other than the listed claim texts, and no personal data.

#### 5.7.2 `references.corrected.bib`

- Resolved DOIs are added as `doi` fields where missing.
- Each problem entry gets a custom field `x-toulmin-status = {retracted | doi-not-found | not-indexed | metadata-mismatch}` and a comment line `% Toulmin: <status> (<export date, ISO 8601>)` immediately above it. Unresolved keys have no entry, so they are listed in the comment block at the top of the file.
- Entries are never deleted, and the `note` field is never modified.
- The export dialog warns: *"If Zotero Better BibTeX auto-export writes this .bib file, your next Zotero export will overwrite these annotations."*
