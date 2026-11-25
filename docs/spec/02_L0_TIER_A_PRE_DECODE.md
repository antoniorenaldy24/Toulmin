# 02 — L0 Tier A: Pre-Decode Deterministic Engine

**Owns:** the Tier A contract; character classes and normalization; pre-masking, LaTeX substitutions and section labels; sentence segmentation; the citation-marker scanner and key resolution; the clause partitioner; the value grammar, units and metric classes; retrieval tokenization, BM25 claim-coverage selection and evidence chunking; the untrusted-evidence sanitizer.

**Load with:** `AGENTS.md` (always) and `01_DATA_REDUCER_AND_METER.md` (types and identity hashing).

**Cross-reference notation.** `[0n › Topic]` names the owning specification file `docs/spec/0n_*.md` and the topic heading inside it. A bare `§n.m` refers to this file.

**Bundled assets (identical bytes on every platform; all Tier A):**

| File | Content |
|---|---|
| `/packages/core-l0/unicode_15_1.bin` | General category and simple lowercase mapping of every code point, generated from UnicodeData.txt 15.1.0 |
| `/packages/core-l0/norm_table.json` | Sections `latin_compose`, `map`, `lower_overrides`, `latin_fold`, `compat_fold`, `confusables`, `SYMBOL_PUA_TABLE` |
| `/packages/core-l0/porter_v1.json` | The Porter stemmer step tables |
| `/packages/core-l0/wordlist_en.txt` | The 50,000-word English wordlist used for PDF dehyphenation |
| `/packages/core-l0/bm25_min_cov.json` | The DEV-calibrated value of `bm25_min_cov` (§8.3) |

The Android port loads the same files from `apps/android/core-l0/src/main/resources/`, copied byte-for-byte at build time. CI compares their SHA-256 with the originals.

---

## 1. Tier A Pre-Decode Contract, Conformance & Watchdog Rules

### 1.1 Tier A scope

**Definition.** Tier A consists of every pure, deterministic L0 module whose output changes **what an on-device model receives**: the sentence text, the claim text, the context sentence, the candidate evidence passages, their order, their sanitized form and their delimiters. It also includes the annotation sets used to measure the models (D-30).

**Tier A modules specified in this file:**

| Module | Source files (`packages/core-l0/src/`) | Section |
|---|---|---|
| Character classes, `norm()`, `normLower()`, `foldLatin()`, `sha256hex()` | `norm.ts` | §2 |
| Pre-masking, LaTeX substitutions, `mathText`, user macros, `normSentence`, section labels | `mask.ts`, `math.ts`, `latex.ts`, `sections.ts` | §3 |
| Sentence segmentation | `segment.ts` | §4 |
| Citation-marker scanner and key resolution | `citations.ts` | §5 |
| Clause partitioner and claim text | `clauses.ts` | §6 |
| Value grammar, units, unit families, metric class, key lemmas | `quantity.ts`, `units.ts`, `metricClass.ts` | §7 |
| `tokBM25`, Porter stemmer, BM25 scoring, claim coverage, `bm25_min_cov`, `gridKey`, selection | `bm25.ts`, `porter.ts`, `coverage.ts` | §8 |
| Evidence chunking and unit shaping | `chunk.ts` | §8.7 |
| Untrusted-evidence sanitizer | `sanitize.ts` | §9 |
| Bundled assets | the five files listed above | — |

The on-device prompt templates `p2.1`, their schemas and prompt assembly are also Tier A; they are specified in [04 › Exact Production Prompt Templates]. The annotation sets are specified in [07 › Datasets].

**Freeze mechanics.**
1. Every Tier A file is listed in `/freeze/tier_a.txt`.
2. `tools/freeze-hash.ts` computes `tier_a_hash` = `sha256hex` of the lines `"{path}\t{sha256hex(file bytes)}"` for every listed file (paths normalized to `/` separators, sorted ascending by UTF-8 byte order), joined by `\n` [07 › Tiered freeze rule]. CI recomputes it on every commit.
3. In **Phase 0 (Tier A Freeze, git tag `l0-freeze-a`)** the tag is cut and `tier_a_hash` is recorded. From that point every Tier A file is **read-only**. CI fails any pull request that changes a listed file unless it carries the label `tier-a-refreeze` and repeats every affected evaluation run (D-30).
4. Every client build embeds `tier_a_hash`. Every published routing table carries `freeze.tier_a_hash`. A client refuses a routing table whose `freeze.tier_a_hash` differs from its embedded value and keeps its bundled defaults (Path B, everything advisory).
5. Every evaluation run manifest records `tier_a_hash`. A run whose hash differs from the hash of `l0-freeze-a` is invalid [07 › Tiered freeze rule].
6. A `⚠ VERIFY-AT-SPIKE` marker in this file whose spike has not passed by the Tier A freeze is resolved permanently by its stated fallback (`AGENTS.md` §3.3).

### 1.2 Cross-platform parity contract

The TypeScript reference implementation (`packages/core-l0`) and the Kotlin port (`apps/android/core-l0`) MUST produce **byte-identical** results on the shared golden corpus `/conformance/l0/*.json`:
- strings, including claim texts, `normSentence` and sanitized evidence;
- UTF-16 offsets and offset maps;
- quantity tuples;
- hashes (`sentenceHash`, `claimId`, `chunkId`, `normalizedClaimHash`, `evidenceVersion`);
- states and flags.

BM25 **rankings** MUST be identical under the integer-grid comparison rule of §8.2: scores are compared as `gridKey(score) = floor(score × 1e9 + 0.5)`, which is transitive. Floating-point scores themselves may differ in the last bits between platforms; their `gridKey` values and the resulting order may not.

The golden corpus is written **by hand** from the specification cases in this file and the edge cases listed with each section. It is never generated from the output of one implementation. A case whose expected output cannot be derived from this specification is a specification defect: it is reported, never guessed.

The Swift subset in `apps/ios/ToulminCore` implements `norm` (§2) and `segment` (§4) and MUST pass `norm.json` and `segment.json`.

**Golden files owned by this specification:** `norm.json`, `segment.json`, `math.json`, `sections.json`, `citations.json`, `clauses.json`, `quantity.json`, `bm25.json`, `sanitize.json`. Their mandatory edge cases are listed at the end of each section.

### 1.3 Full-algorithm meta-test contract

`packages/core-l0/test/examples.meta.test.ts` runs the **complete algorithm** end-to-end on every normative example in this file. It then:
1. compares the final outputs (clauses, claim texts, markers and their kinds, values and tuples, selections, tiers and reasons) with the stated results;
2. recomputes every **intermediate count** that an example states (words between marker groups, numbers of claim terms, coverage values, shared stems, abbreviation classes, boundary decisions, pattern matches) and compares it with the stated count;
3. fails the build if any example contradicts its own rule.

An example whose stated result was not produced by running the algorithm MUST NOT be merged. The Kotlin port runs the same examples from the golden files.

### 1.4 L0 watchdog and pattern guardrails

**Watchdog (D-27).**
1. Every L0 job runs in a worker with a hard limit of **250 ms**. A job is one sentence, one evidence unit, or one ingestion file step.
2. On timeout the worker is terminated and restarted. The input is recorded with `l0Error = "PARSE_TIMEOUT"` (event E14 [01 › Event table]), and the rest of the document continues.
3. The ingestion of one archive is split into per-file jobs, so that one pathological file cannot block the others.
4. B5 extraction is split into per-metric-class jobs, each under the same limit.
5. The watchdog is implemented in `packages/core-l0/src/watchdog.ts` (Web workers) and by a coroutine timeout on a dedicated single-thread dispatcher in Kotlin; a Kotlin job that exceeds the limit is cancelled and its dispatcher is recreated.

**Pattern rules (normative for every L0 implementation).**
1. **No implicit classes.** L0 MUST NOT use `\w`, `\b`, `\s`, `\d`, POSIX classes, Unicode property escapes evaluated by the runtime, or any locale-dependent class or function. It uses only the explicit classes of §2.1, backed by `unicode_15_1.bin`.
2. **No nested unbounded quantifiers.** No pattern may contain a quantified group whose body can itself match a variable-length string with an unbounded quantifier (`*`, `+`, `{n,}`). Bounded repetition (`{0,40}`) is allowed. A static scan of the source rejects any quantified group that contains an unbounded quantifier.
3. **Scanners over regular expressions.** Balanced-delimiter regions, citation markers, value expressions and sentence boundaries are detected by hand-written left-to-right scanners with stated length limits, never by backtracking regular expressions.
4. **ReDoS fuzz ceiling.** Every pattern and every scanner MUST pass the ReDoS fuzz test `packages/core-l0/test/fuzz/redos.test.ts` with **≤ 5 ms per 10 KB** of input. Measurement: median of 5 runs per input, Node.js 22, PC Ryzen 7. The test targets every regular expression in `packages/core-l0` (collected by a static scan) and, as whole functions, the citation scanner, the segmenter, the masker, the value parser and the sanitizer. Its generated corpus uses the constant seed `0x544C4D4E` and contains, per target:
   - 64 inputs of exactly 10 KB built from repeated openers `(`, `[`, `{`, `\cite{`, `$` with no closers (unclosed brackets, parentheses and braces);
   - alternating near-matches of each pattern's keywords (for example `ignore ignore ignore …` for INJ-01);
   - `\cite{` followed by **64 repeated comma-separated keys**, then 10 KB of key characters with no closing brace;
   - long runs of digits, decimal points and mid-dots for the value parser;
   - 1,000 random Unicode strings mixing the character classes of §2.1.

---

## 2. Character Classes, Normalization & Hashing

### 2.1 Explicit character classes

| Class | Definition |
|---|---|
| `LETTER` | Code points of Unicode general category L (Lu, Ll, Lt, Lm, Lo), **plus** combining marks (Mn, Mc) that immediately follow a `LETTER`, so that a decomposed `u` + U+0308 stays inside one word. Category data come from the **bundled** table `/packages/core-l0/unicode_15_1.bin` (generated from UnicodeData.txt 15.1.0), **never** from runtime Unicode data, so every platform classifies every code point identically. |
| `UPPER` | General category Lu or Lt |
| `LOWER` | General category Ll |
| `DIGIT` | ASCII `0`–`9` only. Other digits are mapped by `norm_table.json` before classification. |
| `SPACE` | U+0020, U+0009, U+000A, U+000D (after normalization) |
| `PUNCT_SENT` | `.`, `?`, `!` |
| `CLOSERS` | `"`, `'`, `)`, `]`, `}` |
| `KEY_CHAR` | ASCII letters and digits and the characters `_ : . # $ % & - + ? < > ~ / '` |

Code points are processed as Unicode scalar values; offsets are UTF-16 code units [01 › Canonical Multi-Platform Data Structures]. A surrogate pair is classified by its scalar value; an unpaired surrogate is classified as general category Cs and is never a `LETTER`.

### 2.2 `norm(x) → { text, map }`

`norm(x)` returns `{ text, map }`:
- `text` is the normalized string.
- `map` is an integer array of length `text.length + 1` (UTF-16 units). `map[j]` is the UTF-16 offset in `x` of the source character that produced output unit `j`, and `map[text.length] = x.length`.
- When one source character expands to several output units, every one of those units maps to the same source offset.
- When a source character is deleted, the next output unit maps to the source offset immediately after the deleted character.
- When several source characters collapse into one output unit (composition, CRLF, space runs), the output unit maps to the offset of the first of them.

**Platform NFC and NFKC functions are prohibited.** `norm()` applies the table `/packages/core-l0/norm_table.json` (an identical file on every platform), left to right, in **three stages** applied in this order at each position:

#### 2.2.1 Stage 1 — `latin_compose`

Canonical composition restricted to Latin: a Latin base letter followed by one or more combining marks in **U+0300–U+036F** is converted to the single precomposed code point that Unicode canonical composition would produce, **when that code point lies in** Latin-1 Supplement, Latin Extended-A, Latin Extended-B or Latin Extended Additional. The output unit maps to the offset of the base letter. A sequence with no precomposed Latin form is kept unchanged. The `latin_compose` section lists every (base, mark sequence) → precomposed entry explicitly; nothing is computed at runtime.

#### 2.2.2 Stage 2 — one-code-point mapping table (`map`)

| Source code points | Output | Note |
|---|---|---|
| U+00A0, U+2002–U+200A, U+202F, U+205F, U+3000 | U+0020 | Spaces. For thousands detection (§7.1), implementations read the **source** character through `map`. |
| U+2010, U+2011, U+2012, U+2013, U+2014, U+2015, U+2212, U+FE58, U+FE63, U+FF0D | `-` | Hyphens, dashes and minus signs |
| U+00AD | (deleted) | Soft hyphen |
| U+200B, U+2060, U+FEFF; plus U+200C, U+200D unless both neighbours are in Arabic, Hebrew, Devanagari, Bengali, Tamil, Telugu, Kannada, Malayalam, Gurmukhi, Gujarati, Sinhala or Emoji ranges | (deleted) | Zero-width space, word joiner, byte-order mark, and non-script zero-width joiners. Deleted from **manuscript text and evidence text alike**, so a zero-width character pasted into a claim can neither split a word nor change a hash while script-aware joiners preserved by §9.1 remain intact; the offset map keeps every source offset recoverable. The sanitizer counts these characters on the **raw** evidence text **before** `norm()` runs (§9.1), so its `INVISIBLE_CHARS` rule sees them. |
| U+2018, U+2019, U+201A, U+201B, U+2032 | `'` | Single quotes and prime |
| U+201C, U+201D, U+201E, U+2033 | `"` | Double quotes and double prime |
| U+00B7 when the previous and next code points are `DIGIT`, **and** the following characters are not `10^` and not `10` followed by a superscript digit | `.` | Lancet-style decimal point: `18·2%` → `18.2%` |
| U+00B7 in any other position; U+22C5 | `×` | Multiplication dot: `1.2·10⁻³` → `1.2×10^-3` |
| U+00B5 (MICRO SIGN) | U+03BC (`μ`) | One canonical micro sign |
| U+2070, U+00B9, U+00B2, U+00B3, U+2074–U+2079 (superscript digits); U+207A (`⁺`); U+207B (`⁻`) | `^` followed by the ASCII digit or sign; consecutive superscript code points share one `^` | `10⁻³` → `10^-3`; `m²` → `m^2` |
| U+2080–U+2089 (subscript digits) | the ASCII digit | `CO₂` → `CO2` |
| U+2026 | `...` | Ellipsis |
| U+FB00 / U+FB01 / U+FB02 / U+FB03 / U+FB04 | `ff` / `fi` / `fl` / `ffi` / `ffl` | PDF ligatures |
| U+FF01–U+FF5E | U+0021–U+007E | Full-width ASCII (full-width digits become `DIGIT`) |
| U+2044 | `/` | Fraction slash |
| U+00BD / U+00BC / U+00BE | `1/2` / `1/4` / `3/4` | Vulgar fractions |
| U+000D U+000A | U+000A | CRLF → LF |
| U+000D | U+000A | Lone CR → LF |
| U+00B1 `±`, U+00D7 `×`, U+2264 `≤`, U+2265 `≥`, U+03BC `μ` | unchanged | Preserved as meaningful math symbols |

Every code point not listed is copied unchanged.

#### 2.2.3 Stage 3 — space collapsing

After the mapping table, every run of U+0020 and U+0009 characters is collapsed to **one U+0020**. Newlines (U+000A) are kept and are not part of a run. The collapsed output unit maps to the offset of the first character of the run. `norm()` **never trims**; callers trim explicitly.

#### 2.2.4 Golden cases (`conformance/l0/norm.json`)

At least: U+200B, U+200C, U+200D, U+2060 and U+FEFF inside manuscript words (deleted, offsets mapped); NBSP and narrow NBSP; Unicode minus `−` and en dash between digits; mid-dot decimals `0·45` and `18·2%`; `1.2·10⁻³`; ligatures `ﬁ` and `ﬂ`; full-width digits; decomposed `Mu` + U+0308 + `ller` treated as one word and composed by `latin_compose`; `İ` (U+0130) lowercased identically on all platforms; a character whose general category differs between Unicode versions, resolved from the bundled 15.1 table; CRLF and lone CR; a tab-and-space run.

### 2.3 `normLower(x)`, `foldLatin(x)` and `sha256hex(x)`

**`normLower(x)`** = `norm(x)` followed by **simple per-code-point lowercasing from the bundled table**: each code point is mapped to its Unicode 15.1 *simple* lowercase mapping (UnicodeData.txt **field 13**) from `unicode_15_1.bin`, if one exists. Runtime case functions (`toLowerCase`, `Character.toLowerCase`, `lowercaseMapping`, `lowercased()`) MUST NOT be used. Explicit overrides in `norm_table.json` section `lower_overrides`: **U+0130 (LATIN CAPITAL LETTER I WITH DOT ABOVE) is kept unchanged**, because its simple mapping differs from its full mapping and diverges between platforms. The offset map of `norm()` carries over unchanged, because simple lowercasing maps one code point to one code point.

**`foldLatin(x)`** strips diacritics from Latin letters using the `latin_fold` section of `norm_table.json`, applied after `latin_compose` so that decomposed input folds identically. Examples: `é→e`, `ü→u`, `ñ→n`, `ç→c`, `ø→o`, `ł→l`, `č→c`. It is used only for author-name matching (§5.4).

**`sha256hex(x)`** = the lowercase hexadecimal SHA-256 of the UTF-8 bytes of `x`. **Unpaired surrogates in `x` MUST be converted to U+FFFD before encoding**, on every platform.

---

## 3. Pre-Masking, LaTeX Substitutions & Hierarchical Section Labels

### 3.1 Format-scoped pre-masking

Before segmentation, the regions below are overwritten in a **working copy** by the mask character **U+E000**, repeated to keep their length, so offsets stay stable. Masked regions are not segmented and never produce claims by themselves.

Every region is detected by a left-to-right scanner with balanced-delimiter counting and the stated length limits, never by backtracking regular expressions. A region whose closing delimiter is not found within its limit is **not** a region; its opening delimiter is ordinary text.

**Scope.** `latex` applies to `.tex` sources (and to LaTeX archives); `md` applies to Markdown sources (including the internal Markdown built from `.docx`); `both` applies to both.

| Region | Scope | Detection | Treatment |
|---|---|---|---|
| YAML front matter | `md` | Text from a first line `---` to the next line `---` or `...` (≤ 20,000 chars) | Masked. Keys `bibliography`, `lang` and `math` are read. |
| LaTeX comment | `latex` | A `%` preceded by an even number (including zero) of consecutive `\` characters, up to the end of the line | Masked. |
| HTML comment | `md` | `<!--` … `-->` (≤ 100,000 chars) | Masked. |
| Display math | `latex`; `md` when front matter has `math: true` | `\[` … `\]`; `$$` … `$$`; `\begin{E}` … `\end{E}` for E ∈ {`equation`, `align`, `gather`, `multline`, `eqnarray`, `math`, `displaymath`}, optionally starred (≤ 20,000 chars) | Masked. Its `mathText` (§3.2) is attached to the sentence that contains the region and participates in `normSentence`, BM25 and B5. |
| Inline math | `latex`; `md` (Pandoc rule) | **LaTeX:** an unescaped `$` not adjacent to another `$`, up to the next unescaped `$` on the same line (≤ 400 chars); `\(` … `\)` (≤ 400 chars). **Markdown (Pandoc rule):** the opening `$` is immediately followed by a non-`SPACE` character; the closing `$` is immediately preceded by a non-`SPACE` character **and not immediately followed by a `DIGIT`** (≤ 400 chars, same line) | Masked for segmentation (never a boundary). Its `mathText` takes the region's place in the sentence's prompt text and in `normSentence`. In Markdown, `$5 per dose and $10 per visit` contains **no** math, because the second `$` is followed by a `DIGIT`. |
| Non-prose environments | `latex` | `\begin{E}` … `\end{E}` for E ∈ {`figure`, `table`, `tabular`, `tabularx`, `longtable`, `lstlisting`, `verbatim`, `minted`, `algorithm`, `tikzpicture`, `comment`, `thebibliography`}, optionally starred, balanced by environment name (≤ 200,000 chars) | Masked. `\caption{…}` contents (balanced braces, ≤ 5,000 chars) are **extracted first** as a separate prose stream with the same section label. `tabular`/`tabularx`/`longtable` cells are emitted to the B5 extractor [03 › Tuple sources (all deterministic, L0)]. `thebibliography` items are parsed as references [03 › Multi-Format Client-Side Ingestion, Editability, Batch Audit & Exports]. |
| Footnotes | `latex` | `\footnote{…}`, `\footnotetext{…}` (balanced, ≤ 5,000 chars) | Masked in the parent sentence (never a boundary). The contents become a separate prose stream with the same section label. |
| Structural commands | `latex` | `\C` for C ∈ {`documentclass`, `usepackage`, `label`, `ref`, `eqref`, `autoref`, `cref`, `Cref`, `pageref`, `includegraphics`, `bibliography`, `bibliographystyle`, `addbibresource`, `DeclareMathOperator`, `input`, `include`, `subfile`, `vspace`, `hspace`, `maketitle`, `tableofcontents`, `nocite`, `setlength`, `graphicspath`}, followed by an optional `*`, then an **argument sequence** (below) | Masked. |
| Macro definitions | `latex` | (a) `\newcommand`, `\renewcommand`, `\providecommand`, optional `*`, then the macro name as either `{\N}` or `\N`, then an optional `[n]` (n = 1–9), then an optional `[default]` (≤ 200 chars), then one balanced `{body}` (≤ 2,000 chars). (b) `\def`, then a control sequence `\N` (no braces), then a parameter text of `#1`–`#9` and literal characters up to the first `{` (≤ 40 chars), then one balanced `{body}` (≤ 2,000 chars). (c) `\let\N\M` or `\let\N=\M` | Masked. Definitions without parameters feed the user-macro table of §3.2. |
| Section headings | `latex` | `\S{…}` for S ∈ {`part`, `chapter`, `section`, `subsection`, `subsubsection`, `paragraph`}, optionally starred, with an optional `[short title]` group, balanced braces (≤ 2,000 chars); `\begin{abstract}` … `\end{abstract}` sets the label `abstract` for its contents | Heading text sets the **current section label** (§3.4); masked from prose. |
| List items | `latex` | `\item` with an optional `[…]` group (≤ 200 chars) | The command is masked and starts a new sentence. |
| Fenced code | `md` | A line starting with ```` ``` ```` or `~~~`, up to the matching fence line (≤ 200,000 chars) | Masked. |
| Inline code | `md` | `` ` `` … `` ` `` on one line (≤ 400 chars) | Masked. |
| Markdown headings | `md` | A line matching `#` × 1–6, a space, then text | Sets the current section label (§3.4); masked from prose. |
| Markdown tables | `md` | Consecutive lines that start and end with `\|` (leading and trailing spaces allowed) | Masked from prose. Cells are emitted to the B5 extractor; the first line is the header row; separator lines consisting of `-`, `:`, `\|` and spaces are ignored. |
| Citation markers | `both` | Recognized by the scanner of §5 | Not masked for segmentation; recorded with their ranges. Replaced by `⟦c⟧` in `normSentence` (§3.3). |

**Argument sequence (used by structural commands, unregistered commands and footnote-like constructs).** A scanner that accepts, in any order, up to **2** `[…]` groups (each ≤ 200 chars, no nested `[`) and up to **3** balanced `{…}` groups (each ≤ 2,000 chars), stopping at the first character that starts neither group. Groups must be **adjacent**: between two groups only spaces, tabs and at most one newline are allowed. A **blank line** (two newlines with only spaces or tabs between them) ends the argument sequence, so `\label{x}` followed by a blank line and a `{…}` paragraph never swallows the paragraph.

**Golden cases (`conformance/l0/math.json`).** At least: `$p<0.05$` vs `$p<0.01$` (different `normSentence`); `\(n=48\)`; display math attached to its sentence; `\$` (escaped dollar) not opening math; Markdown `$5 and $6` not math; `\def\drug{aspirin}`, `\newcommand{\N}[1]{body}` and `\newcommand\N[2][x]{body}` parsed by the per-command grammar; `\label{x}`, a blank line, then `{text}` (paragraph kept); `\textsuperscript{2}` → `^2`; `\ce{H2O}` → `H2O`; `\todo{…}` deleted; `\textcolor{red}{x}` and `\hl{x}` → `x`; `\caption{…}` extracted from a `figure`.

### 3.2 Normalization-time LaTeX substitutions

These substitutions are applied when L0 builds a sentence's **prompt text** and its `normSentence`. Every substitution is recorded in the offset map. **The editable source is never changed.**

| Construct | Substitution |
|---|---|
| Escapes `\%`, `\$`, `\&`, `\#`, `\_` | `%`, `$`, `&`, `#`, `_` |
| `~`, `\,`, `\;`, `\:`, `\ ` (backslash-space), `\quad`, `\qquad` | one space |
| `\!` | nothing |
| `--`, `---` | `-` |
| ` `` ` (two backticks) and `''` (two apostrophes) | `"` |
| `\emph{X}`, `\textit{X}`, `\textbf{X}`, `\textrm{X}`, `\textsc{X}`, `\mathrm{X}`, `\mathit{X}`, `\mathbf{X}`, `\text{X}`, `\textsf{X}`, `\underline{X}`, `\hl{X}` | `X` |
| `\textcolor{c}{X}`, `\colorbox{c}{X}` | `X` |
| `\textsuperscript{X}` | `^X` |
| `\textsubscript{X}` | `_X` |
| mhchem `\ce{X}` | `X` with `->` kept and braces deleted (`\ce{CO2}` → `CO2`) |
| Draft annotations `\todo[…]{X}`, `\note{X}`, `\fixme{X}`, `\marginpar{X}` | nothing (the whole construct is deleted) |
| siunitx `\SI{v}{u}`, `\qty{v}{u}` | `v u'`, where `u'` translates unit macros: `\milli`→`m`, `\micro`→`μ`, `\nano`→`n`, `\kilo`→`k`, `\gram`→`g`, `\litre`/`\liter`→`L`, `\metre`/`\meter`→`m`, `\mole`→`mol`, `\second`→`s`, `\minute`→`min`, `\hour`→`h`, `\day`→`d`, `\percent`→`%`, `\per`→`/`, `\squared`→`^2`, `\cubed`→`^3` |
| siunitx `\num{v}` | `v` (an `e` exponent is kept: `\num{1e-3}` → `1e-3`) |
| siunitx `\SIrange{a}{b}{u}`, `\qtyrange{a}{b}{u}` | `a-b u'` |
| **Unregistered commands** in prose: any `\N` (ASCII letters) that is not a cite command (§5.2 Rule 1), not listed in §3.1, not listed in this table, and not a user macro of the next row | If an argument sequence of balanced `{…}` groups follows (read with the adjacency rule of §3.1; `[…]` groups are skipped), the command and its arguments become the text of its **last** `{…}` group, with these substitutions applied to it recursively (**depth ≤ 3**). With no `{…}` group, the command is deleted (**0-argument commands produce nothing**). Examples: `\gls{CI}` → `CI`; `\cellcolor{gray}{12}` → `12`; `\newline` → nothing. Each distinct name is listed once in the import-quality report (§3.5). |
| **Argument-free user macros**: a definition of §3.1 *Macro definitions* with no `[n]` and no parameter text, whose body `B` is ≤ 200 chars and contains no `#` | `\N` followed by a non-letter becomes `B`. At most **200** macros are registered (in definition order); expansion depth ≤ **3**. Macros with arguments are not expanded and are listed in the import-quality report. |
| `mathText(region)` for inline and display math | `\mu`→`μ`; `\alpha` … `\omega` and `\Alpha` … `\Omega` → the Greek letters; `\pm`→`±`; `\times`, `\cdot`→`×`; `\le`, `\leq`, `\leqslant`→`≤`; `\ge`, `\geq`, `\geqslant`→`≥`; `\neq`→`≠`; `\approx`, `\sim`→`≈`; `\%`→`%`; `^{x}`→`^x`; `_{x}`→`_x`; `\frac{a}{b}`→`(a)/(b)`; `\sqrt{a}`→`sqrt(a)`; remaining braces deleted; any other `\command` deleted; whitespace collapsed |

Substitutions are applied in a single left-to-right pass; the recursion into the last group of an unregistered command and the expansion of user macros are the only nested applications, both bounded at depth 3.

### 3.3 `normSentence(s)`

`normSentence(s)` = `normLower` of the sentence after the substitutions of §3.2, with:
- every math region substituted by its `mathText`;
- every citation marker substituted by the token `⟦c⟧`;
- every other masked region deleted;
- whitespace collapsed to one U+0020 and the result trimmed.

`sentenceHash = sha256hex(normSentence(s))` [01 › Document and clause identity].

### 3.4 Hierarchical section label canonicalization

**Canonical labels.** Map the heading text (`normLower`, trimmed, leading numbering such as `2.1`, `2.1.`, `A.`, `II.` deleted) to a canonical label by the **first** matching rule:

| Canonical label | Heading text starts with |
|---|---|
| `abstract` | `abstract` (whole heading); `summary` (whole heading, only when it is the first heading of the document) |
| `introduction` | `introduction`, `background`, `related work`, `literature review`, `prior work`, `motivation` |
| `methods` | `method`, `materials and methods`, `material and methods`, `methodology`, `experimental design`, `experimental setup`, `experimental procedures`, `study design`, `study population`, `participants`, `patients and methods`, `data and methods`, `data collection`, `statistical analysis`, `statistical methods`, `measures`, `procedure` |
| `results` | `result`, `findings` |
| `discussion` | `discussion`, `general discussion` |
| `limitations` | `limitation` |
| `conclusion` | `conclusion`, `concluding remarks` |
| `supplementary` | `supplement`, `appendix`, `supporting information` |
| `references` | `references`, `bibliography`, `works cited`, `literature cited`, `reference list` |
| `unlabeled` | (no rule matched, see below) |

"Starts with" is a string-prefix comparison on the `normLower`, trimmed heading text after numbering is deleted; rows are tried in table order, so `results and discussion` maps to `results`.

**Hierarchy.** LaTeX levels are `part` < `chapter` < `section` < `subsection` < `subsubsection` < `paragraph`; Markdown levels are the number of `#` characters.
1. A heading that **matches** the table sets the current canonical label for its level and every deeper level.
2. A heading that does **not** match **inherits** the canonical label of the nearest enclosing heading of a higher level. Its raw heading text (after `norm`, trimmed) is stored in `entry.subsection`.
3. Only a top-level heading that matches nothing, or text before the first heading, yields the label `unlabeled`.
4. Example: `\section{Methods}` followed by `\subsection{Cohort and follow-up}` keeps the label `methods`, with `subsection = "Cohort and follow-up"`.

Text under `references` is never segmented into claims.

**Golden cases (`conformance/l0/sections.json`).** At least: `related work`, `statistical analysis`, `concluding remarks`, `supporting information`; a non-matching `\subsection` inheriting its parent label; Markdown `###` under `## Methods`; text before the first heading (`unlabeled`); `summary` as the first heading (→ `abstract`) and as a later heading (→ inherits or `unlabeled`); numbered headings `2.1 Results` and `II. Discussion`.

### 3.5 Import-quality report fields

Shown after every import and included in the exports [03 › Exports]:

| Field | Content |
|---|---|
| `filesRead` / `filesSkipped` | Counts, with the reason of each skip |
| `unresolvedInputs` | `\input` / `\include` / `\subfile` targets not found |
| `macrosNotExpanded` | Names of user macros with arguments, or beyond the 200-macro or depth limits |
| `unregisteredCommands` | Each distinct unregistered command name handled by the rule of §3.2 |
| `unknownEnvironments` | Names of environments not listed in §3.1 (their text is treated as prose) |
| `tablesParsed` | Number of tables emitted to B5 |
| `mathRegions` | Inline and display math counts |
| `footnotes` | Count |
| `parseTimeouts` | Inputs that hit `PARSE_TIMEOUT` |
| `unresolvedKeys` | Citation keys of explicit markers not found in any bibliography (`UNRESOLVED_KEY`) |
| `possibleCitations` | Heuristic markers that matched no reference, with the marker text (§5.4 rule 4) |

---

## 4. Rule-Based Sentence Segmentation

Platform segmenters (`Intl.Segmenter`, `BreakIterator`, `NLTokenizer`) MUST NOT be used. Segmentation runs on the masked working copy (§3.1).

### 4.1 Definitions

- A **token** is a maximal run of non-`SPACE` characters.
- A **word** is a maximal run of `LETTER`, `DIGIT` and internal `'` or `-` characters. An apostrophe or a hyphen counts only between two `LETTER`/`DIGIT` characters.
- An **attached marker** is a citation marker (§5) that starts immediately after a candidate punctuation character or its closers, with no space.

### 4.2 Candidate boundaries

A **candidate** is a position `i` where `text[i] ∈ PUNCT_SENT`. The boundary position is advanced over:
1. any `CLOSERS`;
2. any attached markers (`Effect.[1]`, `Effect.\cite{a}`, a superscript citation from a `.docx` import), followed again by any `CLOSERS`.

The candidate is valid only if the advanced position is followed by `SPACE`, the end of the text, or the start of a mask block.

**Citation after a space.** If, after the boundary and one or more spaces, the next item is a numeric bracket marker or a superscript citation marker, that marker belongs to the **preceding** sentence and the boundary moves to the end of that marker.

### 4.3 Abbreviation classes N and T

Matching is on the lowercased token that ends at `i`, including its final `.`.

**Class N — never ends a sentence** (the candidate is rejected):

| | | | | | | | | |
|---|---|---|---|---|---|---|---|---|
| `e.g.` | `i.e.` | `cf.` | `vs.` | `viz.` | `fig.` | `figs.` | `eq.` | `eqs.` |
| `ref.` | `refs.` | `no.` | `nos.` | `vol.` | `vols.` | `pp.` | `p.` | `dr.` |
| `mr.` | `mrs.` | `ms.` | `prof.` | `st.` | `jr.` | `sr.` | `dept.` | `univ.` |
| `ch.` | `tab.` | `suppl.` | `ca.` | `approx.` | `n.b.` | `op.` | `ed.` | `eds.` |

**Class T — may end a sentence.** The candidate is accepted only if the next word starts with an `UPPER` letter, has ≥ 2 letters, **and** is not a single letter followed by `.`.

| | | | | | | | |
|---|---|---|---|---|---|---|---|
| `etc.` | `al.` | `min.` | `max.` | `avg.` | `std.` | `resp.` | `inc.` |
| `ltd.` | `co.` | `corp.` | `a.m.` | `p.m.` | `u.s.` | `u.k.` | `e.u.` |
| `sec.` | `i.v.` | `i.p.` | `s.c.` | `p.o.` | `b.i.d.` | `t.i.d.` | `q.d.` |

Examples: `injected i.p. Animals were` → boundary after `i.p.`; `0.5 mg i.p. injection` → no boundary.

### 4.4 Rejection rules

A valid candidate is rejected if **any** of the following holds:

1. **Abbreviation.** The token is a class N abbreviation, or a class T abbreviation whose acceptance condition fails.
2. **Single uppercase initial.** The token is one `UPPER` letter followed by `.` (for example `J.`). **Exception (accept):** the previous word, lowercased, is in `INITIAL_TERMINAL_PRECEDERS` = {`group`, `groups`, `vitamin`, `type`, `phase`, `class`, `stage`, `grade`, `arm`, `cohort`, `panel`, `figure`, `table`, `appendix`, `part`, `section`, `condition`, `site`, `strain`, `model`, `protocol`, `hepatitis`, `factor`, `version`, `plan`, `schedule`, `block`, `ward`, `zone`, `level`} **and** the next word starts with an `UPPER` letter and has ≥ 2 letters (`group B. The`, `vitamin C. Controls`).
3. **Decimal.** `text[i] = '.'` and both `text[i-1]` and `text[i+1]` are `DIGIT`.
4. **Lowercase continuation.** The next word starts with a `LOWER` letter. **Exceptions (accept the boundary)** when the next word matches any of:
   - `LOWER{1,3}` followed by an `UPPER` letter (`mRNA`, `siRNA`, `iPSC`, `pH`);
   - `LOWER{1,3}` followed by a `DIGIT` (`p53`, `t1`);
   - `LOWER{1,2}` followed by `-` and a `LETTER` or `DIGIT` (`t-test`, `p-value`, `n-3`).
5. **Inline numbered list.** The next token is `DIGIT{1,2}` followed by `)`.

### 4.5 Forced boundaries

A sentence boundary is forced at:
- a paragraph break (`\n`, optional spaces or tabs, `\n`);
- the start and the end of a masked **block** region: display math on its own line, non-prose environments, fenced code, tables, headings, front matter;
- a LaTeX `\item`;
- a Markdown list item: a line starting with `- `, `* `, `+ ` or `DIGIT{1,3}. `.

Inline math and footnote masks are **never** boundaries.

### 4.6 Per-sentence outputs and Stage 1 eligibility

Each sentence carries its `sentenceHash`, `occurrenceIndex` [01 › Document and clause identity], its section label and its subsection text.

**Eligibility for Stage 1** — all MUST hold:
- ≥ 6 words after citation markers are deleted;
- not fully masked;
- at least one word of ≥ 3 letters;
- not under the section label `references`;
- not entirely enclosed in quotation marks.

An ineligible sentence produces no clause and no ledger entry.

**Golden cases (`conformance/l0/segment.json`).** At least: `et al.`, `e.g.`, `i.e.`, `Fig. 2`, `vs.`, `p. 12`, `approx.`; `i.v.`, `i.p.`, `s.c.`, `p.o.`, `sec.` followed by a capitalized word of ≥ 3 letters (boundary) and by a lower-case word (no boundary); `group B. The` and `J. Smith`; sentence-initial `p53`, `mRNA` and `t-test`; a decimal number ending a sentence (`…was 3.5.`); a sentence ending in a citation `…[12].`; a citation after a space (`…effect. [12] The…`); an ellipsis; a quotation ending `."`; an inline numbered list `1) … 2) …`.

---

## 5. Linear-Time Citation-Marker Scanner & Key Resolution

### 5.1 Architecture (O(n))

The scanner makes **one left-to-right pass** over the masked sentence text. It uses two arrays computed in **one backward pass**:
- `nextClose[c][i]` = index of the next closing delimiter `c` ∈ {`]`, `)`, `}`} at or after `i` (or `∞`);
- `nextOpen[c][i]` = index of the next opening delimiter matching `c` at or after `i` (or `∞`).

With these arrays every candidate is decided in O(1) amortized time plus its bounded content length, so the whole scan is **O(n)**. No regular expression with nested quantifiers is used.

At each position `p`, the **first** applicable rule below fires. Marker ranges never overlap: after a marker is recognized, scanning resumes at its end.

### 5.2 Rules 1–6

**Rule 1 — LaTeX cite commands.** `text[p] = '\'`, followed by a command name (ASCII letters, optional `*`).
- The name is a cite command if it is in `CITE_COMMANDS`, **or** if it consists of letters containing `cite` (case-insensitive) **and** is defined in the document by `\newcommand`, `\DeclareCiteCommand` or `\let` (a **custom cite macro**).
- `CITE_COMMANDS` = {`cite`, `Cite`, `citep`, `Citep`, `citet`, `Citet`, `citealp`, `Citealp`, `citealt`, `Citealt`, `citenum`, `parencite`, `Parencite`, `textcite`, `Textcite`, `autocite`, `Autocite`, `footcite`, `smartcite`, `supercite`, `citeauthor`, `Citeauthor`, `citeyear`, `cites`, `parencites`, `textcites`, `autocites`, `footcites`}. `\nocite` is ignored (it is masked as a structural command).
- After the name, read up to **2** optional groups `[…]` (each ≤ 200 chars, no nested `[`), then **one** mandatory group `{…}` (≤ 2,000 chars, no nested `{`).
- For the **`…cites` family** (`cites`, `parencites`, `textcites`, `autocites`, `footcites`), repeat "≤ 2 `[…]` + one `{…}`" up to **16** times.
- **Keys** = each `{…}` content split on `,`, trimmed. Each key MUST consist only of `KEY_CHAR`; at most **64** keys per marker. A group that violates this makes the whole candidate ordinary text.
- **Narrative set:** `citet`, `Citet`, `textcite`, `Textcite`, `textcites`, `citeauthor`, `Citeauthor`.

**Rule 2 — Bracket markers.** `text[p] = '['`. Let `q = nextClose[']'][p+1]`.
- The candidate exists only if `q − p ≤ 2,000` and there is no `[` between `p+1` and `q`. Otherwise `[` is ordinary text.
- **Markdown link exclusion** (checked first): if `text[q+1] = '('` (an inline link `[text](url)`) or `text[q+1] = '['` (a reference-style link), the bracket is ordinary text.
- **Pandoc bracket:** split the content on `;` into items. Each item MUST contain exactly one `@`, optionally preceded by `-`, followed by ≥ 1 `KEY_CHAR`, with ≤ 100 chars of prefix or locator text around it. Every item must satisfy this, and there are at most 64 items. Keys = the `@`-keys. A Pandoc bracket is `EXPLICIT`.
- **Numeric bracket:** the content consists only of `DIGIT{1,4}` numbers separated by `,` or `-` with optional spaces. A range `a-b` expands to `a..b` (span ≤ 30; a larger span makes the bracket ordinary text). Let `W1` be the word immediately before `[` (ignoring spaces) and `W2` the word before `W1`. The bracket is **not** a citation if **any** of the following holds:
  1. a number contains a decimal point;
  2. the numbered bibliography size `N` is known and some expanded number exceeds `N`;
  3. **whole-word interval context:** `W1` or `W2`, compared as a **whole word** after `normLower` (never as a substring), is one of `ci`, `iqr`, `sd`, `se`, `sem`, `range`, `interval`, `ranges`, `intervals`, `cri`, `hdi`; or `W1` ends with `±`;
  4. **interval shape (bare number + trailing word):** the content is exactly two numbers `a, b` or `a-b` with `a < b`, **and** the token immediately before `[` (skipping spaces) is a **bare number** — `W1` consists only of `DIGIT`s with an optional decimal point or decimal comma, is not a 4-digit year in 1900–2099, and is not followed by a unit or `%` (that is, `W1` itself is the last token before `[`) — **and** a word or unit follows `]` (skipping spaces, the next character is a `LETTER`, `%`, `°` or `μ`).

  A percentage or a year before the bracket does **not** prevent a citation. **Normative golden strings** (`conformance/l0/citations.json`):

  | String | Citation? | Deciding rule |
  |---|---|---|
  | `reduced mortality by 30% [1]` | **Yes** | `W1` = `30` is followed by `%`, so the interval-shape rule does not apply; single number |
  | `reduced mortality by 30% [1, 2].` | **Yes** | `W1` is followed by `%`, so it is not a bare number; `]` is followed by `.`, not a word |
  | `as listed in Table 2 [3, 7].` | **Yes** | `]` is followed by `.`, not a word or unit |
  | `reported in 2019 [3]` | **Yes** | single number; `2019` is a year |
  | `in social [3] contexts` | **Yes** | `W1` = `social` is not a bare number |
  | `across species [14]` | **Yes** | `W1` = `species` contains no interval word as a whole word (`species` ≠ `se`) |
  | `95% CI [12, 45]` | **No** | whole-word interval context: `W1` = `ci` |
  | `median 5 [3, 7] days` | **No** | interval shape: `a = 3 < b = 7`, `W1` = `5` is a bare number, a word follows `]` |

  An accepted numeric bracket is `EXPLICIT` when the numbering order is known (§5.4 rule 2), otherwise `HEURISTIC`.

**Rule 3 — Pandoc narrative.** `text[p] = '@'`, preceded by the start of text or by a character that is not `LETTER`, `DIGIT`, `.` or `[`, followed by ≥ 1 `KEY_CHAR`, **and** the key exists in a loaded `.bib`. This keeps e-mail addresses from becoming markers. Narrative; `EXPLICIT`.

**Rule 4 — Author–year parenthetical.** `text[p] = '('`. Let `q = nextClose[')'][p+1]`.
- The candidate exists only if `q − p ≤ 300` with no `(` in between.
- Split the content on `;` into items. **Every** item MUST match `AUTHOR_YEAR_ITEM`, implemented as a hand-written matcher with these parts in order:
  1. optional prefix: `see `, `see also `, `e.g., `, `e.g. `, `cf. `;
  2. `SURNAME`: optional particles (`van `, `van der `, `von `, `de `, `de la `, `del `, `di `, `da `, `le `, `la `, `du `), then an `UPPER` letter followed by `LETTER`, `'` or `-` characters (≤ 40 chars).
     - A `SURNAME` candidate is **rejected** if, after `normLower`, it is in `NON_NAME_WORDS` = {`january`, `february`, `march`, `april`, `may`, `june`, `july`, `august`, `september`, `october`, `november`, `december`, `jan`, `feb`, `mar`, `apr`, `jun`, `jul`, `aug`, `sep`, `oct`, `nov`, `dec`, `spring`, `summer`, `autumn`, `fall`, `winter`, `table`, `tables`, `figure`, `figures`, `fig`, `section`, `chapter`, `appendix`, `supplement`, `eq`, `equation`, `version`, `release`, `update`, `phase`, `wave`, `cohort`, `trial`, `study`, `survey`, `census`, `report`, `year`, `fy`, `q1`, `q2`, `q3`, `q4`}.
     - An all-uppercase candidate of 2–6 letters (an **organization acronym** such as `WHO`, `CDC`) is accepted by the matcher, but can resolve only through the organization rule of §5.4;
  3. optional ` et al.`, or ` and SURNAME`, or ` & SURNAME`;
  4. optional `,`;
  5. one space;
  6. `YEAR` = `19` or `20` followed by two `DIGIT`, an optional lowercase letter, and an optional `,` + lowercase-letter list (`2020a,b`);
  7. optional **locator**: `, p. N`, `, pp. N-M`, `, ch. N`, `, fig. N` (N, M = `DIGIT{1,5}`).

**Rule 5 — Author–year narrative.** `text[p] = '('` whose content matches only `YEAR` plus an optional locator, **and** the ≤ 60 characters before `p` end with `SURNAME` (with the `NON_NAME_WORDS` rejection of Rule 4), an optional ` et al.`, ` and SURNAME` or ` & SURNAME`, followed by one space. The marker range starts at the surname. Narrative.

**Rule 6 — `.docx` field-code citations.** Ranges recorded by the `.docx` importer [03 › `.docx` importer (read-only audit source)] are **authoritative** markers carrying their item data; the scanner skips them. `EXPLICIT`.

### 5.3 `EXPLICIT` vs `HEURISTIC`

| Kind | Produced by |
|---|---|
| `EXPLICIT` | Rule 1, Rule 2 Pandoc brackets, Rule 2 numeric brackets **with** a known numbering order, Rule 3, Rule 6 |
| `HEURISTIC` | Rule 2 numeric brackets **without** a known numbering order, Rule 4, Rule 5 |

Only `EXPLICIT` markers can produce `UNRESOLVED_KEY` (red, D-02).

### 5.4 Key resolution to `refId`

1. **LaTeX and Pandoc keys** (`EXPLICIT`) → the BibTeX entry key, exact and case-sensitive; fallback: case-insensitive match. No match → `UNRESOLVED_KEY` (red, D-02).
2. **Numeric markers** → the n-th entry in bibliography order, taken from the first available source:
   - `thebibliography` / `.bbl` `\bibitem` order;
   - the numbered reference list of an imported `.docx`;
   - in Markdown, a numbered list (`1.` or `[1]` at line start) under a heading canonicalized to `references`;
   - the order of first citation, when the bibliography style name contains `unsrt`, `ieee`, `vancouver`, `nature` or `ama`.

   When one of these sources exists, the marker is `EXPLICIT`, and an unmatched number → `UNRESOLVED_KEY`. When none exists, the marker is `HEURISTIC` and is handled by rule 4.
3. **Author–year** (`HEURISTIC`) → the entries whose first-author family name (`foldLatin(normLower(·))`, particles deleted on both sides) equals the surname and whose year (with letter suffix) equals the year.
   - **Organization rule:** an all-uppercase surname candidate matches an entry whose first author is a braced corporate name (for example `author = {{World Health Organization}}`) when the candidate equals the **initials** of the corporate name's capitalized words, or equals its `shortauthor` or `shorthand` field.
   - Exactly one match → resolved. Several matches → `AMBIGUOUS` (the ledger shows the "Check this citation" chip and a reference picker [01 › Independent flags]).
4. **Unmatched heuristic markers** never produce `UNRESOLVED_KEY`, never create a reference, and never produce a red mark. Their ranges are stored in `entry.possibleCitations` and shown as the grey "Check this citation" chip with the reason "Possible citation — it matches no reference in your bibliography". The import-quality report lists them with the marker text.

**Golden cases (`conformance/l0/citations.json`).** At least: `\cite{a,b}`, `\citep[p.~3]{a}`, `\citet*{a}`, `\parencite{a}`, `\textcites{a}{b}`, a custom `\mycite` defined by `\newcommand`; Pandoc `[@a; @b, p. 3]` and `[-@a]`; numeric `[1–3, 5]`; author–year `(Smith et al., 2020a)`, `(see Smith & Lee, 2019; Jones, 2021, p. 4)`; narrative `Smith and Lee (2019)`; the eight strings of the table in §5.2; `[2](url)` (Markdown link, not a citation); `(March 2020)` and `(Table 2020)` rejected by `NON_NAME_WORDS` (0 markers); `WHO (2020)`, `(Smith 2020)` and `(Jones et al., 2021)` without a match (`POSSIBLE_CITATION`, `HEURISTIC`); `WHO (2020)` with an entry `{{World Health Organization}}` (resolved by the organization rule); a numbered list under `## References` in `.md` giving the order; `\cite{missingKey}` (`UNRESOLVED_KEY`); an unclosed `\cite{` with 64 keys (no marker; linear time); an e-mail address `name@example.org` (no marker).

---

## 6. Non-Overlapping Clause Partitioner

### 6.1 Input and output

**Input:** an eligible sentence `S = [s0, s1)` with its markers. Adjacent markers separated only by spaces, `,` or `;` form one **marker group**. A group is **narrative** iff its first marker is narrative.

**Output:** a list of clauses whose spans are **disjoint** and ordered. Each marker group belongs to exactly one clause. Each clause carries its `claimText`, its `span`, its marker groups, and the flag `uncited` (no marker group).

### 6.2 Normative pseudocode

```
STRONG_BOUNDARIES = [";", ", but ", ", whereas ", ", while ", ", although ", ", though ", ", however, ", ", yet ",
                     " but ", " whereas "]                       # matched on normLower, outside markers and masks
                     # exception: " but " and ", but " are NOT boundaries when immediately followed by "also" and the
                     # same span contains "not only" earlier ("not only X but also Y" is one clause)
RELATIVIZERS      = ["which", "who", "whom", "whose", "that", "as", "where", "when"]
INNER_SPLITS      = [", and ", ", but ", ", while ", ", whereas ", ", although ", " and "]
REPORTING_FRAMES  = ["as shown by", "as shown in", "as reported by", "as reported in", "as demonstrated by",
                     "as described by", "as described in", "as noted by", "according to", "as found by", "see", "in"]
LEADING_FRAMES    = ["as shown previously", "as reported previously", "as previously shown", "as previously reported",
                     "as shown before", "as described previously", "as described elsewhere", "consistent with prior work",
                     "consistent with previous work", "in line with previous studies", "previous studies have shown that",
                     "it has been shown that", "it has been reported that"]
LEAD_CONNECTORS   = ["and", "but", "while", "whereas", "although", "though", "however", "moreover", "furthermore",
                     "also", "yet", "thus", "therefore", "in addition", "additionally", "which", "that", "as", "with"]
TRAIL_CONNECTORS  = ["and", "but", "or", "while", "whereas", "although", "though", "yet", "however"]

function partition(S, groups):
  # Step 1: split S at strong boundaries into spans P_1..P_m
  #         (the boundary text belongs to the LEFT span and is trimmed in Step 4)
  spans = splitAtStrongBoundaries(S)
  clauses = []
  for P in spans:
      G = [g in groups if P.start <= g.start < P.end]
      if G is empty:
          clauses.append(Clause(range=P, groups=[], uncited=true)); continue
      # Step 2: within a span, split between consecutive NON-narrative groups when the text between them has >= 4 words
      pieces = [ open piece at P.start ]
      for j in 1..len(G)-1:
          a = G[j-1]; b = G[j]
          between = text(a.end, b.start)
          if not a.narrative and not b.narrative and wordCount(between) >= 4:
              x = a.end
              # a relative clause right after a marker group belongs to the LEFT clause
              if firstWord(stripLeading(between, ", ")) in RELATIVIZERS:
                  k = first occurrence of any INNER_SPLITS in between, at word index >= 2 of between
                  if k exists: x = a.end + k
              close current piece at x; open a new piece at x
      close last piece at P.end
      for piece in pieces:
          clauses.append(Clause(range=piece, groups=[g in G inside piece], uncited=false))
  # Step 3: merge short uncited clauses (< 4 words after cleaning) into the previous clause, else into the next one
  mergeShortUncited(clauses)
  # Step 4: build the claim text of each clause
  for c in clauses:
      t = text(c.range)
      delete every marker group of c from t; when a NARRATIVE group is deleted, also delete an adjacent preceding
         REPORTING_FRAME (case-insensitive, whole words)
      cleanup, applied in this order, each over the whole of t:
         (a) delete the spaces immediately before the position of each deleted marker group
         (b) if the deletion leaves ", ," or a pair of commas enclosing only spaces, delete both commas
         (c) delete every space immediately before ",", ";", ":" or "."
         (d) delete leading characters in SPACE ∪ {",", ";", ":"}
      strip a LEADING_FRAME at the start (case-insensitive, whole words), followed by an optional ","; then repeat (d)
      repeat at most 3 times: strip one LEAD_CONNECTOR at the start, followed by an optional ","; then repeat (d)
      repeat at most 2 times: trim trailing SPACE and characters in ",;:.", then strip one TRAIL_CONNECTOR at the end (whole word); then trim trailing SPACE and characters in ",;:."
      collapse whitespace; trim
      c.claimText = t
      c.span = smallest source range covering every character of S that contributed to t (markers inside it are allowed)
  return clauses
```

All list matches are on `normLower` text and whole words. `wordCount` counts words (§4.1) and ignores masks and markers.

### 6.3 Context and claim text integrity

The Stage 2 prompt also receives the whole sentence with markers deleted (`CONTEXT_SENTENCE` [04 › Stage 2 prompt (`VerdictV1`, `stage2.txt`)]), so a clause such as `decreased B in older adults` keeps its grammatical subject in context. The BM25 query for a clause adds the other content tokens of its sentence at weight 0.5 (§8.2), so retrieval also sees the subject. **The claim text itself is never rewritten** (D-09).

### 6.4 Normative conformance examples (all 15; `conformance/l0/clauses.json`)

| # | Sentence | Clauses → markers |
|---|---|---|
| 1 | `Drug X reduced mortality by 30% [1] but increased bleeding [2].` | `Drug X reduced mortality by 30%` → [1]; `increased bleeding` → [2] |
| 2 | `Smith et al. (2020) found no effect of X on Y.` | `found no effect of X on Y` → (Smith, 2020) |
| 3 | `X improves Y \cite{a,b}.` | `X improves Y` → [a, b] |
| 4 | `As shown previously [3], X improves Y.` | `X improves Y` → [3] |
| 5 | `Smith et al. (2020) found X reduces Y [3].` | `found X reduces Y` → (Smith, 2020), [3] (one clause; no duplicate spans) |
| 6 | `Drug X, as shown by Smith (2020), reduced Y.` | `Drug X reduced Y` → (Smith, 2020) |
| 7 | `Smith (2020) found X [3], but Jones (2021) found not-X.` | `found X` → (Smith, 2020), [3]; `found not-X` → (Jones, 2021) |
| 8 | `X increased A [1] and decreased B in older adults [2].` | `X increased A` → [1]; `decreased B in older adults` → [2] |
| 9 | `The effect was large [4], which was unexpected.` | `The effect was large, which was unexpected` → [4] (text after the only marker group of a span stays in that clause) |
| 10 | `Prior work [@k0; @k1; @k2` (unclosed bracket, author still typing) | no marker; the text is an uncited clause candidate; scan time is linear |
| 11 | `The effect was large [4], which was unexpected, and the control was small [5].` | `The effect was large, which was unexpected` → [4]; `the control was small` → [5] |
| 12 | `X not only reduced pain but also improved sleep [6].` | one clause `X not only reduced pain but also improved sleep` → [6] |
| 13 | `Mortality fell by 30% [1] in 2019 [2].` | The text between the two marker groups (`in 2019`) has 2 words (< 4), so Step 2 does not split: one clause `Mortality fell by 30% in 2019` → [1], [2] |
| 14 | `X improves Y [3] , and Z [4].` | The text between the groups (`, and Z`) has 2 words (< 4), so Step 2 does not split: one clause with claim text `X improves Y, and Z` → [3], [4]; cleanup (a) deletes the space before each marker and (c) the space before the comma |
| 15 | `However, [2] reported that X reduces Y.` | `reported that X reduces Y` → [2]: the marker is deleted together with the space before it (cleanup (a)); `However,` is stripped as a `LEAD_CONNECTOR` with its comma; cleanup (d) deletes the remaining leading space |

Additional golden cases: `but`, `whereas`, `while`, semicolons; a list of three findings each with its own citation; `which was unexpected` between two marker groups (belongs to the left clause); claim frames `in`/`see`/`that`/`as`/`with` stripped only at clause start.

---

## 7. Value Grammar, Units & Metric Classes

Value expressions are recognized in a sentence's prompt text (after §3.2), in evidence units, in table cells and in confirmed OCR text. The grammar is implemented as a scanner, never as a regular expression with nested quantifiers.

### 7.1 Sign rule and number grammar

**Sign rule.** A `-` or `+` immediately before a `DIGIT` is a sign **only if** the preceding character is not `LETTER`, `DIGIT`, `)` or `]`. Therefore `COVID-19` → `19`, `IL-6` → `6`, and `2018-2020` is a range. After `norm()`, U+2212 has become `-`.

**Number grammar:**
1. digits with an optional `.` decimal part;
2. **comma thousands** groups of exactly 3 digits (`12,345`);
3. **thin-space thousands** groups of exactly 3 digits, where the source character read through `map` is U+2009 or U+202F (`12 345`);
4. a **decimal comma** (`0,45`) only when the document language is not English. The document language comes from Pandoc `lang`, the LaTeX `babel` main language, or the `.docx` `w:lang`;
5. a **dot thousands separator** only when the document language is not English: `.` followed by exactly 3 digits and then a non-digit, after an integer part of 1–3 digits that does not start with `0`. So `12.345` → 12345 and `1.234.567` → 1234567, while `0.045`, `1.5` and `12.3456` stay decimals. In English documents, and when the language is unknown, a dot is always a decimal point;
6. a **leading `.` decimal** (`.045` = 0.045).

### 7.2 Value rules 1–9 (first match at a position wins, in this order)

| # | Kind | Forms | Result |
|---|---|---|---|
| 1 | Scientific | `a × 10^b`, `a x 10^b`, `a × 10^-b`, `a·10^b` (after `norm`: `×`), `aE±b`, `ae±b` | `valueNorm = a·10^b` |
| 2 | Point + interval | `a (95% CI b-c)`, `a (95% CI: b to c)`, `a, 95% CI b-c`, `a (IQR b-c)`, `a (range b-c)`; and the bare forms `a (b-c)`, `a [b, c]`, `a (b, c)` **only if** an interval cue (`mean`, `median`, `average`, `estimate`, `or`, `hr`, `rr`, `irr`, `ratio`, `difference`, `effect`, `ci`, `iqr`) occurs within the 4 words before `a`, **or** `b ≤ a ≤ c` | `valueNorm = a`, `valueLo = b`, `valueHi = c`. Otherwise a bare form is a single number `a` followed by an independent expression (`aged 30 (12-18) years` → `30`, and the range `12-18`) |
| 2b | Mean (SD) | `a (b)` with `b < a` and a cue `mean`, `sd`, `s.d.`, `standard deviation`, or a column header `M (SD)` / `mean (SD)`, within the ±6-word window | one tuple: `valueNorm = valueLo = valueHi = a`; `b` is **not** emitted as a tuple |
| 3 | Mean ± SD/SE | `a ± b`, `a +/- b` | `valueNorm = a`, `valueLo = a − b`, `valueHi = a + b` |
| 4 | p-value | `p` or `P` (optionally followed by `-value` or `value of`), then `<`, `≤`, `<=`, `=`, `>`, `≥`, `>=`, then a number | `valueNorm` = the number, `pComparator` stored, `metricClass = p_value` |
| 5 | Date (skipped) | `YYYY-MM-DD`, `DD/MM/YYYY`, `MM/DD/YYYY`, `YYYY/MM/DD` | not a tuple |
| 6 | Transition | `from a to b` | two point tuples `a` and `b` |
| 7 | Range | `a-b`, `a to b`, `between a and b` (same unit) | `valueLo = a`, `valueHi = b`, `valueNorm = (a + b) / 2` |
| 8 | Single number | a number | `valueNorm = valueLo = valueHi` = the number |
| 9 | Word numbers | `zero` … `nineteen`, `twenty` … `ninety`, `hundred`, `thousand`, and compounds such as `forty-eight` — **only** when the next word is a unit (§7.3) or a `COUNT_NOUNS` word. `one of`, `no one`, `one can`, `one or more`, `one another`, `one hand` and `one way` **never** produce a value | integer |

`COUNT_NOUNS` = {`patients`, `participants`, `subjects`, `people`, `persons`, `individuals`, `cases`, `controls`, `studies`, `trials`, `samples`, `cohorts`, `groups`, `sites`, `centres`, `centers`, `countries`, `hospitals`, `schools`, `children`, `adults`, `women`, `men`, `mice`, `rats`, `animals`, `cells`, `years`, `months`, `weeks`, `days`, `hours`, `times`, `doses`, `events`, `deaths`, `items`, `questions`, `respondents`, `experiments`, `models`, `datasets`}. The deterministic triage baseline uses the same set [03 › Deterministic triage baseline (`baselineTriage(S, c)`)].

**Exclusions.** Year-like integers 1900–2099 with no unit, and numbers inside citation markers, are not tuples.

**`sigDigits`** = the number of significant digits of the main number as written: `48.0` → 3; `0.045` → 2; `1,200` → 2; `48` → 2; `1.20` → 3.

### 7.3 Unit families and canonical conversion table

Units are read immediately after the number (or before it for `$`, `€`, `£`, `Rp`, and for `n =`, `N =`), on `normLower`, with `μ` = U+03BC.

| Family | Canonical unit | Raw variants (× factor to canonical) |
|---|---|---|
| percent | `%` | `%`, `percent`, `per cent`, `pct` |
| percentage points | `pp` | `pp`, `percentage point`, `percentage points`, `points` after a percentage context — **never pairs with `%`** |
| count | `count` | `participants`, `patients`, `subjects`, `people`, `individuals`, `respondents`, `children`, `adults`, `women`, `men`, `infants`, `students`, `cases`, `animals`, `mice`, `rats`, `samples`, `eyes`; the prefix `n =`, `N =` |
| mass | `mg` | `mg` ×1; `g` ×1000; `kg` ×1e6; `μg`, `ug`, `mcg` ×0.001; `ng` ×1e-6 |
| mass concentration | `mg/L` | `mg/l` ×1; `mg/ml` ×1000; `g/l` ×1000; `g/dl` ×10000; `mg/dl` ×10; `μg/ml` ×1; `μg/l` ×0.001; `ng/ml` ×0.001 |
| molar concentration | `mmol/L` | `mmol/l` ×1; `mol/l` ×1000; `μmol/l` ×0.001; `nmol/l` ×1e-6 |
| dose per body mass | `mg/kg` | `mg/kg` ×1; `μg/kg` ×0.001; `g/kg` ×1000 |
| time (short) | `s` | `ms` ×0.001; `s`, `sec`, `second`, `seconds` ×1; `min`, `minute`, `minutes` ×60; `h`, `hr`, `hrs`, `hour`, `hours` ×3600; `d`, `day`, `days` ×86400; `wk`, `week`, `weeks` ×604800 |
| time (long) | `month` | `month`, `months`, `mo` ×1; `year`, `years`, `yr`, `yrs`, `y` ×12 — **never converted to or from the short-time family** |
| currency (four separate families) | `usd`, `eur`, `gbp`, `idr` | `$`, `us$`, `usd`, `dollars` → `usd`; `€`, `eur`, `euros` → `eur`; `£`, `gbp` → `gbp`; `rp`, `idr` → `idr` |
| ratio (four separate families) | `ratio:or`, `ratio:hr`, `ratio:rr`, `ratio:irr` | the metric label **before** the number: `OR`, `odds ratio`; `HR`, `hazard ratio`; `RR`, `risk ratio`, `relative risk`; `IRR`. An `h`, `hr` or `hour` **after** a number is time |
| none | `""` | no unit; pairs only with unitless tuples of the same metric class |
| unknown | `unknown:<raw>` | any other unit-like token (a `LETTER` run of ≤ 12 chars directly after the number that is not a stopword); **never pairs** |

`valueNorm`, `valueLo` and `valueHi` are converted to the canonical unit by the stated factor. `unitCanon` stores the canonical unit; `unitRaw` stores the exact source substring.

### 7.4 Metric class rules

First match on the ±6-token window plus unit:

| Class | Rule |
|---|---|
| `p_value` | value rule 4 (§7.2) |
| `effect_size` | ratio family, or the window contains `cohen's d`, `effect size`, `beta`, `β`, `correlation`, `r =`, `r^2`, `auc`, `smd`, `md` |
| `sample_size` | count family with `n =`, or (not percent family and the window contains `sample size`, `enrolled`, `recruited`, `randomized`, `randomised`, `included`, `total`, `cohort`) |
| `percentage` | percent family, or the window contains `rate`, `proportion`, `prevalence`, `incidence`, `percentage`, `accuracy`, `sensitivity`, `specificity` with a percent unit |
| `duration` | a time family |
| `dose` | mass or dose-per-body family with `dose`, `dosage`, `administered` or `given` in the window |
| `concentration` | mass or molar concentration family |
| `currency` | a currency family |
| `count` | count family otherwise |
| `ratio` | ratio family without effect-size context |
| `other` | otherwise — **never pairs** |

### 7.5 No percentage reconciliation (normative)

A unitless proportion (`0.37`) and a percentage (`37%`) are different families (`none` vs `percent`) and **never pair**: `sameFamily("%", "") === false`. This prevents false pairing of proportions with unrelated percentages; the price (a missed `37%` vs `0.37` inconsistency) is accepted. `pp` and `%` are also different families.

### 7.6 Key lemmas

`keyLemmas` = the Porter stems (`porter_v1.json`, §8.1) of the content words in the ±6-word window around the value, excluding numbers, unit words, stopwords (§8.1) and the citation placeholder `⟦c⟧`, deduplicated and sorted ascending. For table tuples, the window is the column header plus the row label. Key lemmas are used by the BM25 quantity bonus (§8.2) and by B5 pairing [03 › Deterministic incremental pairing].

**Golden cases (`conformance/l0/quantity.json`).** At least: `48`, `48.0`, `37%` and `0.37` (different families); `1.2–3.4`; `95% CI 1.1 to 2.3`; `aged 30 (12-18) years` (no interval: `30` and the range `12-18`); `OR 1.8 (1.2-2.6)` (interval by cue); `p = .03` and `P<0.001`; `−0.2`; `COVID-19` and `IL-6`; `1,234`; `12 345` with U+2009; `12.345` with `lang: de` (12345) and with `lang: en` (12.345); `0.045` and `1.5` with `lang: de` (decimals); `0,45` with `lang: de`; `twelve patients` (12) and `one of`, `no one`, `one can` (no value); `12.5 (3.1)` under `mean (SD)` (one tuple); `from 12% to 8%` (two tuples); `between 5 and 10 mg` (range); `2.5 × 10^-3`; `1e-3`; siunitx `\SI{5}{\milli\gram}` and `\num{1e-3}`; `HR 0.7` vs `3 h`; a year `2019` without a unit (no tuple); `12 pp` vs `12%` (different families).

---

## 8. Retrieval Tokenization, BM25 Claim-Coverage Selector & Evidence Chunking

### 8.1 `tokBM25(x)`

1. `t = normLower(x)` with the math substitutions of §3.2 applied and citation markers deleted.
2. **Numeric tokens.** Value expressions recognized by the scanner of §7 each emit one token `#<canonical>`, where `<canonical>` is the shortest decimal representation of the value (`0.045` and `.045` → `#0.045`; `30.0` → `#30`), followed by `%` if the value carries a percent unit (`#30%`). A sign is attached only under the sign rule of §7.1, so `COVID-19` yields the word `covid` and `#19`, and `IL-6` yields `il` and `#6`. Ranges and intervals emit both endpoints.
3. **Words.** The remaining text is split into maximal runs of `LETTER`/`DIGIT`. A run containing at least one letter is a word.
4. **Stopwords** (constant list, deleted): `a, an, the, of, in, on, at, to, for, from, by, with, and, or, but, as, is, are, was, were, be, been, being, this, that, these, those, it, its, their, there, which, who, whom, than, then, into, over, under, between, among, we, our, us, they, them, he, she, his, her, also, such, may, might, can, could, would, should, will, shall, do, does, did`. The words **`not`, `no`, `nor`, `never` and `without` are not stopwords**: negation must reach retrieval.
5. **Stemming.** The Porter stemmer exactly as specified in `/packages/core-l0/porter_v1.json` (the original 1980 rule set, with every step table listed explicitly in that file). Implementations MUST follow the file, never a library. Numeric tokens are not stemmed.

### 8.2 BM25 scoring and the transitive grid comparator

**Corpus.** The evidence units (§8.7) of all references of the active document that are available on this device. IDF and `avgdl` are recomputed when the corpus changes. Corpus statistics are **not** part of `evidenceVersion` [01 › `normalizedClaim`, `normalizedClaimHash` and `evidenceVersion`]: a ranking change caused only by another reference's evidence does not invalidate stored results.

**Parameters (constant):** `k1 = 1.2`, `b = 0.75`.

```
IDF(t)      = ln( 1 + (N − n_t + 0.5) / (n_t + 0.5) )         N = #units in the corpus, n_t = #units containing t
w(t)        = 1.0 if t occurs in the clause's claim text (clause weight)
              0.5 if t occurs only in the rest of its sentence (context weight)
bm25(q, d)  = Σ over t in sortedAscending(set(q)) of  w(t) · IDF(t) · f(t,d)·(k1+1) / ( f(t,d) + k1·(1 − b + b·|d|/avgdl) )
bonus(q, d) = +1.0 if some quantity tuple of the query clause and some tuple extracted from d (§7) share
              metricClass ≠ other AND the same unit family — regardless of their values — AND the two tuples share
              at least one key lemma (§7.6) other than unit words; otherwise 0
score(q, d) = bm25(q, d) + bonus(q, d)
gridKey(x)  = floor(x · 1e9 + 0.5)  as a 64-bit integer          # x ≥ 0
```

`f(t,d)` is the count of token `t` in unit `d`; `|d|` is the number of tokens of `d`. Summation runs over the query's distinct tokens in ascending code-unit order, so every platform adds the same terms in the same order.

The quantity bonus favours units that report **the same kind of quantity about the same outcome** as the claim (for example both report a mortality percentage). A unit reporting a contradictory value is therefore not penalized, and a unit that merely contains some percentage is not promoted.

**Comparison rule.** Scores are compared by `gridKey(score)` (integers), never by an ε-tolerance, so equality is transitive and every platform sorts identically. **Ranking order:** `gridKey(score)` descending, then source kind (`ABSTRACT` before `FULLTEXT` before `USER_PDF` before physical kinds), then unit ordinal ascending.

**Query.**
- For Stage 2: `tokBM25` of the clause's claim text at weight 1.0, plus the other tokens of its sentence's prompt text at weight 0.5.
- For B4 suggestions: the sentence's prompt text at weight 1.0.
- Citation markers are excluded; normalized math is included.

### 8.3 IDF-weighted claim coverage and the `bm25_min_cov` filter

```
C(c)        = the set of WORD tokens of tokBM25(claimText of c)     # claim terms only: no context terms, no numeric tokens
cov(c, d)   = Σ over t in C(c) ∩ d of IDF(t)  /  Σ over t in C(c) of IDF(t)        # 1.0 when C(c) is empty
stems(c, d) = |C(c) ∩ d|                                                            # number of shared claim stems
```

**Filter.** A candidate unit `d` is **discarded only if** `gridKey(cov(c, d)) < gridKey(bm25_min_cov)` **and** `stems(c, d) < 2`. A unit that shares two or more claim stems is always kept.

`cov` depends only on which claim terms the unit contains and on their IDF weights. It does not shrink as the claim gets longer, and it does not depend on the context terms of the sentence.

**Value.** `bm25_min_cov` defaults to **0.25**. Its calibrated value is computed in Phase 0 on DEV and written to `/packages/core-l0/bm25_min_cov.json`, a Tier A file frozen at `l0-freeze-a`. The Remote Config parameter `bm25_min_cov` MUST equal that value. A client always uses the bundled value; when Remote Config differs, it logs `BM25_MIN_COV_MISMATCH` and ignores the Remote Config value.

**Calibration procedure** [07 › DEV Ablations]: `bm25_min_cov` = the largest τ in [0.05, 0.60] (step 0.01) that keeps:
- **≥ 95 %** of gold evidence units in **every** stratum of corpus size (10, 50 and 150 references), claim length (1–4, 5–8 and ≥ 9 claim terms) and unit length (shorter and longer than `avgdl`), each reported with its Wilson 95 % lower bound; if no τ qualifies, the default 0.25 is kept.

**Statistical status (normative wording).** The calibration is **descriptive of the DEV set**: it states the retention observed on DEV in each stratum, and it is **not** a statistical guarantee for the population of manuscripts. What bounds retrieval loss in production is structural: the `stems ≥ 2` keep-rule means that no unit sharing two or more claim stems is ever discarded. The remaining retrieval loss is measured and reported as **Recall@5** of gold evidence units on DEV and on R1-E [07 › R1-E Metrics]. Public material describes the threshold in these terms only.

Because the threshold decides which evidence the model sees, it is a **Tier A** value: it is calibrated before the Tier A freeze, frozen with it, and never re-tuned after an R1-E run.

### 8.4 Worked normative example (`conformance/l0/bm25.json`)

A claim `c` has 4 claim terms (after `tokBM25`): `a`, `b`, `x`, `y`, with `IDF(a) = IDF(b) = 4.0` and `IDF(x) = IDF(y) = 0.5`. So `Σ IDF = 9.0`, and `τ = bm25_min_cov = 0.25`. Its sentence adds 6 context terms that occur in every unit below.

| Unit | Claim terms contained | `cov(c, d)` | `stems(c, d)` | `gridKey(cov) ≥ gridKey(0.25)`? | Decision |
|---|---|---|---|---|---|
| `d1` | `a` | 4.0 / 9.0 = 0.4444 | 1 | yes | **kept** (coverage) |
| `d2` | `x`, `y` | 1.0 / 9.0 = 0.1111 | 2 | no | **kept** (two shared stems) |
| `d3` | `x` | 0.5 / 9.0 = 0.0556 | 1 | no | **discarded** |
| `d4` | `a`, `b`, `x`, `y` | 9.0 / 9.0 = 1.0 | 4 | yes | **kept** |
| `d5` | none (only the 6 context terms) | 0.0 | 0 | no | **discarded** |

Unit `d5` shows that context terms never contribute to coverage, however many the sentence has. Second case in the same file: a claim with 8 claim terms of equal IDF and a unit containing 4 of them has `cov = 0.50` and is kept. A claim with no word terms has `cov = 1.0` for every unit.

Further mandatory cases in `bm25.json`: scores differing by less than 1e-9 compared on `gridKey` (transitive tie order); the quantity bonus withheld when no key lemma is shared and applied when one is; the same query against corpora of 10, 50 and 150 references; a reference with only full-text units; a selection with `candidates = 0`.

### 8.5 Top-5 selection and the per-pair `Selection` fact

For each (clause, reference) pair, selection produces `EVIDENCE[0..4]` and the fact `Selection` [01 › Canonical Multi-Platform Data Structures]:

1. take the top **3 abstract** units of that reference by the ranking order, after the coverage filter;
2. take the top **2 full-text** units of that reference (open-access full text or `USER_PDF`), if any are cached, after the coverage filter;
3. if fewer than 5 candidates exist, fill from whichever pool has remaining units that pass the filter (physical units of that reference are included in the fill pool);
4. order the candidates by the ranking order;
5. run the sanitizer (§9) on each candidate; blocked candidates are excluded from `EVIDENCE`;
6. emit `selection = { evidenceVersion: refFacts[refId].evidenceVersion, candidates, suspicious, seq }` as event **E6b** (`SelectionComputed`), where:
   - `candidates` = the number of kept units that are not blocked by the sanitizer (0..5);
   - `suspicious` = at least one of the kept top-5 units has sanitizer tier `blocked` (§9.5);
   - `seq` = the next Lamport value for the clause.

If `candidates = 0`, Stage 2 is not run for the pair (rule R12 [01 › Per-reference rules `R1`–`R14` (first matching rule wins)]). **Selection never changes `RefFacts.hasEvidence`**, which records whether the **reference** has any evidence unit at all.

Selection is recomputed whenever the reference's `evidenceVersion` changes, the clause's claim text changes, or the corpus changes. A selection computed for an older `evidenceVersion` is ignored by the reducer [01 › Per-pair selection validity].

### 8.6 B4 library suggestions

`CANDIDATE_REFERENCES[0..4]` for Stage 1 [04 › Stage 1 prompt (`TriageV1`, `stage1.txt`)]: BM25 over each reference's title plus abstract across the whole local library; query = the sentence's prompt text at weight 1.0; top 5 by the ranking order; no coverage filter; each title passes through the sanitizer (§9.5). The same computation produces `entry.suggestedRefIds` for O4 on Android.

### 8.7 Evidence chunking

**`chunkId`** = `sha256hex(refId + "|" + kind + "|" + section + "|" + ordinal + "|" + sha256hex(text).slice(0, 8)).slice(0, 24)`. The 8-character content hash makes a re-fetched text with different content produce a different `chunkId`, so old anchors never point at changed text. `kind` ∈ `EvidenceSourceKind`; `ordinal` is the 0-based unit index within (reference, kind, section).

**Abstract.** Strip JATS and HTML tags from the abstract string (Crossref abstracts are JATS; tags are deleted, character entities decoded), then segment with §4 (no math masking). Each sentence is an evidence unit `{ chunkId, sourceKind: ABSTRACT, section: "abstract", text }`.

**Full text from PDF** (pdf.js on Web and in the server parser; `PdfRenderer` text on Android when available):
1. **Line reconstruction.** Group text items by page, then by baseline `y` with tolerance 0.5 × the item's font height. An item whose font height is ≤ 0.8 × the line's median font height and whose baseline is offset by 0.2–0.6 em above or below the line baseline is a **superscript or subscript**: it joins its line and is emitted as `^…` or `_…`. Sort the items of a line by `x`. Join two items with one space when the gap is > 0.15 × font height.
2. **Dehyphenation.** A line-final `-` followed by a line starting with a lowercase letter is deleted and the parts are joined **only if** the joined word is in `/packages/core-l0/wordlist_en.txt` **and** the hyphenated form is not. Otherwise the hyphen is kept (`long-term` stays `long-term`).
3. **Columns.** If a page's text-item `x` centres are **bimodal** (two clusters with a gap > 15 % of the page width), the left column is processed fully before the right column.
4. **Heading detection.** A line is a heading if it has ≤ 8 words **and** either its font height is ≥ the page median + 1 pt, or it matches, case-insensitively, optional numbering `N(.N)*.` followed by exactly one of `abstract`, `introduction`, `background`, `methods`, `method`, `materials and methods`, `results`, `discussion`, `conclusion`, `conclusions`, `limitations`, `references`, `acknowledgements`, `acknowledgments`, with nothing else on the line. Headings map to canonical labels by §3.4.
5. **References cut.** The `references` section and everything after it are dropped **only if** that heading starts after ≥ **60 %** of the document's characters; otherwise only the `references` section itself is dropped.
6. **Running headers and footers.** For documents with ≥ **3 pages**, identical line text that appears on ≥ 50 % of pages is dropped. Lines with fewer than 3 alphabetic characters are also dropped.
7. **Hidden-text guard** (feeds §9.3 `HIDDEN_PDF_TEXT`): drop and record text items with font height < 2 pt, items whose bounding box lies outside the page view box, and — when the extractor exposes them — items with text render mode 3 (invisible) or a fill colour equal to the page background. ⚠ VERIFY-AT-SPIKE S-W5: pdf.js exposes the text render mode or the fill colour of text items → fallback: only the font-size and view-box rules apply, and the README threat model states this limitation.
8. **Segmentation.** Each section is segmented with §4 → evidence units `{ chunkId, sourceKind: FULLTEXT or USER_PDF, section, text }`.

**Full text from JATS XML** (delivered by `oaFetch` [05 › `oaFetch`, `oaFetchJudge`, `oaParse` and `oaParseJudge`]). The XML is parsed with `fast-xml-parser` (`preserveOrder: true`, `ignoreAttributes: false`). `<sec>` titles give sections and `<p>` text gives paragraphs, in document order; inline elements such as `<italic>` and `<xref>` are flattened in place. `<table-wrap>` captions become prose units. **Each `<tr>` of a `<table>` becomes one evidence unit** in section `table`, with text `"{header₁}: {cell₁}; {header₂}: {cell₂}; …"`. `<ref-list>` is dropped. Then each section is segmented with §4.

**Unit shaping (all sources).**
- **Neighbour extension:** a unit of **≤ 12 words** is extended with the previous and the next unit of the same section, joined by one space. The extended text is the evidence text; anchors may fall anywhere inside it.
- **Window shaping:** a unit longer than **60 words** is reduced to the 60-word window with the most query-term matches (ties → the earliest window). The window is computed per query at selection time; the stored unit keeps its full text.

**Physical Select-row units (Android O2/O3).** The evidence unit of a Select-row capture is the deterministic string `"{columnHeader₁}: {cell₁}; {columnHeader₂}: {cell₂}; …"`, built from the OCR of the selected row and its header strip (headers of two merged header rows are written `"{upper} · {lower}"`). `sourceKind` = `PHYSICAL_TABLE`; section = `"print:" + photoSha256.slice(0, 12)`. A captured printed text block (O2 page mode) is one unit with `sourceKind = PHYSICAL_TEXT`. Each value the author confirms is anchored against the OCR text with the anchor validator [03 › Post-Decode Evidence Anchor Validator (L1 & L2)]. The OCR geometry is specified in [06 › O2: Check against a printed page].

---

## 9. Untrusted Evidence Sanitizer

**Input:** each evidence unit; each reference `title`, `venue`, `first_author` and `doi` string; each OCR text block — before it is placed in any prompt.

**Output:** the sanitized text, an offset map to the raw text, `tier ∈ {clean, logged, blocked}`, and `reasons[]`.

**Order of operations:** (1) count invisible characters on the raw text; (2) character-level cleaning (§9.1); (3) `norm()` (§2.2); (4) build `detectText` (§9.2); (5) evaluate the mixed-script rule and the tiers (§9.3); (6) apply the effects (§9.5).

### 9.1 Character-level cleaning (always applied)

| Category | Code points | Action | Tier effect |
|---|---|---|---|
| C0/C1 controls except `\t`, `\n`, `\r` | U+0000–U+0008, U+000B, U+000C, U+000E–U+001F, U+007F–U+009F | deleted | none |
| Unicode tag characters | U+E0000–U+E007F | deleted | **blocked** on any occurrence (`TAG_CHARS`) |
| Bidi embedding, override and isolate controls | U+202A–U+202E, U+2066–U+2069 | deleted | **blocked** on any occurrence (`BIDI_OVERRIDE`) |
| Directional marks | U+200E, U+200F, U+061C | deleted | none |
| Zero-width and invisible | U+200B, U+2060–U+2064, U+FEFF, U+034F, U+FE00–U+FE0F, U+3164, U+FFA0, U+115F, U+1160, U+180E | deleted; **counted on the raw text before `norm()`** | **blocked** if ≥ 3 occurrences in one unit (`INVISIBLE_CHARS`) |
| Joiners (script-aware) | U+200C, U+200D | **kept** when both neighbours are in the Arabic, Hebrew, Devanagari, Bengali, Tamil, Telugu, Kannada, Malayalam, Gurmukhi, Gujarati, Sinhala or Emoji ranges; otherwise deleted and counted with the previous row | as the previous row |
| Private Use Area | U+E000–U+F8FF | mapped by `SYMBOL_PUA_TABLE` in `norm_table.json` (Symbol-font codes: U+F0B1 → `±`, U+F0A3 → `≤`, U+F0B3 → `≥`, U+F0B4 → `×`, U+F0B0 → `°`, U+F061–U+F07A → Greek `α`–`ω` in Symbol-font order); unmapped code points deleted | **logged** (`PUA_UNMAPPED`) |

The manuscript mask character U+E000 never reaches the sanitizer: the sanitizer runs on evidence and metadata only.

### 9.2 `detectText` pipeline

Detection runs on a separate **detection text**. The evidence text sent to models is always the cleaned, normalized text; the detection text is used only for matching and needs no offset map. **Offsets are never taken from `detectText`.**

```
detectText = foldConfusables( stripMarks( compatFold( normLower(cleanedText) ) ) )
```

- **`compatFold`** applies the `compat_fold` section of `norm_table.json`, generated from the Unicode 15.1 compatibility decompositions with the tags `<font>`, `<circle>`, `<square>`, `<super>`, `<sub>`, `<small>`, `<wide>` and `<narrow>`. It covers at least: Mathematical Alphanumeric Symbols U+1D400–U+1D7FF; Enclosed Alphanumerics U+2460–U+24FF; Letterlike Symbols U+2100–U+214F; small capitals U+1D00–U+1D2B; modifier letters U+02B0–U+02FF; Halfwidth and Fullwidth Forms U+FF00–U+FFEF.
- **`stripMarks`** deletes every code point of general category Mn or Me (combining marks).
- **`foldConfusables`** maps Cyrillic and Greek look-alikes to Latin using the `confusables` section of `norm_table.json` (for example `а→a`, `е→e`, `о→o`, `р→p`, `с→c`, `у→y`, `х→x`, `і→i`, `ј→j`, `ѕ→s`, `ԁ→d`, `ο→o`, `ν→v`).

### 9.3 Mixed-script rule and tiers

**Mixed-script words** are computed on `normLower(cleanedText)`, **before** folding. A word is mixed-script **only if** it contains **no** `DIGIT` and **no** `-`, **and** either:
- (a) it contains ≥ 2 Latin letters and ≥ 1 Cyrillic letter; or
- (b) it contains a Greek letter listed in the `confusables` section **between two Latin letters**.

Scientific notation such as `TNFα`, `IL-1β`, `NF-κB`, `β-catenin`, `μm` and `αβ T cells` is therefore **never** mixed-script. **≥ 2 mixed-script words in one unit → blocked** (`MIXED_SCRIPT`).

**Block tier** (any match → `blocked`; patterns are matched on `detectText`, word-delimited by the classes of §2.1, with bounded repetition only):

| ID | Pattern |
|---|---|
| `INJ-01` | `(ignore\|disregard\|forget\|override)`, then within ≤ 8 words `(previous\|prior\|above\|earlier\|all\|any)`, then within ≤ 4 words `(instruction\|instructions\|prompt\|prompts\|rules\|directions)` |
| `INJ-02` | `(system\|developer\|assistant) (prompt\|message\|instruction\|instructions)` |
| `INJ-03` | `you are (now )?(an? \|the \|my )?(ai\|assistant\|language model\|model\|chatbot\|llm\|gpt)` |
| `INJ-04` | `(respond\|reply\|answer\|output\|return\|print) (only )?(with\|as\|in) (json\|the following\|yes\|no\|true\|false\|supported\|contradicts\|a verdict)` |
| `INJ-05` | `(new\|revised\|real\|actual\|hidden) (instruction\|instructions\|task\|rules)` followed within ≤ 3 words by `:` |
| `INJ-06` | `<`, optional spaces, optional `/`, then `(system\|assistant\|user\|evidence\|instruction\|im_start\|im_end)` as a whole word |
| `INJ-07` | `[inst]`, `[/inst]`, `<<sys>>`, `<</sys>>`, `<<evidence`, `<</evidence` |
| `INJ-08` | a line starting with ≥ 2 `#`, then `(instruction\|instructions\|system\|task\|prompt)` |
| `INJ-09` | `(the )?(correct\|right\|true) (verdict\|answer\|label) (is\|=)` |
| `INJ-10` | `do not (follow\|obey) (the \|your \|any \|previous )?(instruction\|instructions\|rules\|system)` |
| `INJ-11` | `(begin\|end) (of )?(system\|instructions\|prompt)` |
| `INJ-12` | an `http://` or `https://` URL (≤ 200 chars) containing a query parameter named `prompt`, `instruction` or `q` |
| `INJ-13` | schema vocabulary: `s0` + a digit 1–4 + `_` + lowercase letters or underscores; `nei_silent_escalate`; `"verdict"` followed by optional spaces and `:` |
| `HIDDEN_PDF_TEXT` | a hidden item dropped by the hidden-text guard (§8.7 step 7) contains ≥ 4 alphabetic words; applies to every unit of that page |
| `TAG_CHARS`, `BIDI_OVERRIDE`, `INVISIBLE_CHARS`, `MIXED_SCRIPT` | character rules of §9.1 and the mixed-script rule above |

**Log tier** (recorded in telemetry; never blocks): the bare words `supported`, `contradicts`, `contradicted`; `act as`, `behave as`, `pretend`; `label:`, `classification:`, `verdict:` without quotes; `PUA_UNMAPPED`. A unit with only log-tier reasons has tier `logged` and is used normally.

### 9.4 False-positive gate

On **500 real CC-BY abstracts** (MS-SAN, ≥ 5 disciplines, ≥ 40 containing Greek scientific symbols), **at most 1 %** of units may be `blocked` (D-16). Any single pattern that blocks more than 0.5 % of MS-SAN units on its own MUST be narrowed before the Tier A freeze. The red-team set RT-INJ (26 synthetic injected abstracts, including mathematical alphanumerics, circled letters and combining marks) measures detection [07 › Sanitizer Calibration and Red Team].

### 9.5 Effects

**(Clause, reference) pairs — effect on `Selection`.**
- Blocked units are excluded from `EVIDENCE`.
- If **any** of the kept top-5 candidates was blocked, the pair gets **no local verdict**. The selection fact (event E6b) has `suspicious = true`, which yields rule R7 (`SOURCE_FLAGGED`) [01 › Per-reference rules `R1`–`R14` (first matching rule wins)]. In Standard mode the pair is offered to L2 through the batch consent sheet with the visible label *"Source contains instruction-like text."*
- If every candidate was blocked, `selection.candidates = 0` as well; R7 still decides the state because it precedes R12.
- `RefFacts.hasEvidence` (a per-reference fact) is never changed by the sanitizer.

**Metadata withholding.** A blocked `title`, `venue` or `first_author` string is shown in prompts as `[title withheld]`, `[venue withheld]` or `[author withheld]`. A `doi` is placed in prompts only if it matches `10.` + 4–9 `DIGIT` + `/` + 1–300 characters of `KEY_CHAR`, `(`, `)`, `;`, `<`, `>`, `[`, `]`; otherwise `[doi withheld]`. Bibliographic resolution continues unaffected.

**OCR text filtering.** Blocked OCR blocks are excluded from O2/O3 prompts and shown to the author with the reason; the author may still confirm values by hand.

**Delimiters.** Every evidence string in any prompt is wrapped exactly as:

```
<<EVIDENCE id=0>>
{sanitized text}
<</EVIDENCE>>
```

`id` is the 0-based index in `EVIDENCE[]`. Before wrapping, the literal sequences `<<` and `>>` inside the evidence text are mapped to `‹‹` (U+2039 U+2039) and `››` (U+203A U+203A), so evidence can never forge a delimiter.

**Coordinates.** Anchors are stored in **raw-unit coordinates**, obtained by composing the sanitizer's offset map with the `norm()` map. `EvidenceAnchor.snapped` therefore always refers to the raw (unsanitized) chunk text [01 › Canonical Multi-Platform Data Structures].

**Telemetry.** Counts per reason and per reference, never text.

**Golden cases (`conformance/l0/sanitize.json`).** At least: each `INJ` pattern; Unicode tags; a bidi override; exactly 2 and exactly 3 zero-width characters (clean vs blocked); script-aware joiners in Devanagari (kept) and between Latin letters (deleted and counted); Latin-confusable mixed-script words (Latin letters mixed with Cyrillic `р` and `а`); scientific Greek `TNFα`, `IL-1β`, `NF-κB`, `μm`, `β-catenin` (not blocked); mathematical bold and circled letters detected through `detectText`; a mapped and an unmapped PUA code point; a log-tier-only abstract (`logged`, used); `<<EVIDENCE` and `>>` escaping; `first_author` and `doi` fields sanitized and withheld.
