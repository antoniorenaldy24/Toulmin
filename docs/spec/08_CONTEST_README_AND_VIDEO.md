# 08 — Contest Compliance, README & Video

**Owns:** the #BuildHybridAI 2026 Stage One compliance contract and the Stage Two judging alignment; the external clarifications log; the verified problem metrics, the base-rate arithmetic and the public claim discipline; the real-preprint sentence; the competitive landscape and the defensible differentiators; the Devpost submission fields, the Devpost Testing Instructions and their OPERATOR CHECK; the README blueprint; the demonstration video storyboard (Variant A and Variant B), its recording rules, its cut order and its manual acceptance checklist.

**Load with:** `AGENTS.md` (always). Measurements quoted publicly come only from `/eval-harness/reports/H4_DECISION.md` and the reports of `07_EVAL_SPIKES_AND_ACCEPTANCE.md`; product behaviour and exact UI copy come from `01`–`06`.

**Cross-reference notation.** `[0n › Topic]` names the owning specification file `docs/spec/0n_*.md` and the topic heading inside it. A bare `§n.m` refers to this file.

**Evidence labels** (`AGENTS.md` §3.2): `[F]` primary fact; `[F2]` secondary fact, re-verified against the vendor's own page before publication; `[I]` inference with arithmetic shown; `[UNVERIFIED]` never used publicly.

---

## 1. #BuildHybridAI 2026 Compliance Contract & Judging Alignment

All requirements in this section are taken from the official contest rules `[F]`. Every Stage One item is a MUST.

### 1.1 Stage One (pass/fail)

| # | Requirement `[F]` | How Toulmin satisfies it | Acceptance check |
|---|---|---|---|
| **S1-1** | Use at least one platform: Web (Chrome) integrating Gemini Nano 4 through Firebase AI Logic; Android integrating Gemini Nano 4 through Firebase AI Logic; iOS integrating Apple Foundation Models through Firebase AI Logic. Multi-platform is preferred | **Primary submission category: Web (Chrome desktop), entered as "Best Web/Chrome".** Companion: the **Android Pocket Ledger** on the **Xiaomi 15T Pro**, which the ML Kit GenAI device table lists under **Gemini Nano 4** `[F]`, running AICore **`STABLE`**. Fallback demonstration: the **iOS Thin Client** on the **iPhone 13 Pro Max** (D-25) | README "Platforms and Observed Models" table (§4.3 section 3); AC-STAGE1-04 |
| **S1-2** | Firebase AI Logic demonstrated at runtime in the code | All four Firebase AI Logic inference modes are used where they fit (D-19): **`ONLY_ON_DEVICE`** (every local stage on capable devices, both privacy modes), **`PREFER_ON_DEVICE`** (consented cloud fallback on devices without a usable model), **`PREFER_IN_CLOUD`** (*Find alternative sources*), **`ONLY_IN_CLOUD`** (L2 adjudication with Google Search grounding); plus Apple **`HybridModel`** on iOS. `inferenceSource` telemetry is visible in Proof mode | Proof counters show `ON_DEVICE` and `IN_CLOUD` responses on the named devices; AC-STAGE1-01 |
| **S1-3** | Firebase App Check is used (required by Firebase AI Logic) | **reCAPTCHA Enterprise** (Web) and **App Attest with DeviceCheck fallback** (iOS); enforcement on for Firebase AI Logic, Firebase Authentication (Preview), Firestore, Storage and every callable; replay protection on for Firebase AI Logic with limited-use tokens. **Zero debug tokens in any distributed build, with no exception** (D-18). The **Android judge APK ships as the offline `bundledSample` flavor**: it makes **zero Firebase network calls** (so it requests no App Check token) while invoking **`Firebase.ai(...)`** with **`ONLY_ON_DEVICE`** for every check; Play Integrity is registered for the project and never invoked by that APK | AC-SEC-01, AC-SEC-03, AC-SEC-15, AC-SEC-18, AC-STAGE1-02 |
| **S1-4** | Project available free of charge and without restriction for testing until the judging period ends | Every feature on the base URL without login (anonymous Firebase Authentication at the first cloud need; D-17). Public cloud quotas are a **cost-bounded daily preview** [05 › Quota pool table and daily cost envelope]: the one-click "Check the sample in the cloud" uses a shared public pool of **20 runs per day**. **Ten judge codes** `TLMN-XXXX-XXXX`, each valid on **up to 5 browsers or devices**, select a separate judge pool and separate function lanes; a judge's sample run never depends on the public pool. Judge-code expiry is the environment parameter **`JUDGE_TIER_EXPIRY_EPOCH`**, set later than the end of the official judging period | External-network test of the base URL, the sample cloud check and a judge code; AC-STAGE1-05, AC-STAGE1-06 |
| **S1-5** | Testing Instructions MUST NOT contain production API keys, live Google Cloud project secrets, confidential commercial data or personally identifiable information; login credentials for private parts MUST be included | The Testing Instructions (§4.2) contain only the base URL, step-by-step instructions, the Android APK link and — **only after the OPERATOR CHECK confirms that the field is not publicly visible** — the 10 judge codes | OPERATOR CHECK (§4.2.2); AC-STAGE1-08 |
| **S1-6** | Public repository on GitHub or GitLab demonstrating Firebase AI Logic at runtime, with an open-source licence file detectable and shown in the About section | Public repository; **Apache-2.0** in the root `LICENSE` and shown in the GitHub About panel; README links each inference mode to its source file (§4.3 section 2) | AC-STAGE1-03 |
| **S1-7** | Video of at most 3 minutes (only the first 3 minutes may be evaluated), publicly visible on YouTube, showing the project functioning on its platforms, with no third-party advertising, slogan, logo or trademark | Storyboard of §5: duration **2:40–2:45**, English voice-over with burned-in and uploaded English captions, YouTube visibility **Public**, device logos covered, no third-party product or LaTeX-service names shown or spoken | `/docs/acceptance/VIDEO.md` (§5.7); AC-STAGE1-07 |
| **S1-8** | Projects that existed before the submission period must be developed significantly further during it and must disclose pre-existing code or work | README section "Pre-existing code and work disclosure" (§4.3 section 6) | AC-STAGE1-03 |
| **S1-9** | Select at least one platform that represents the project | "Web/Chrome" selected in the Devpost form | Devpost form review |

### 1.2 Stage Two judging criteria

Each criterion is scored 1–5 and the scores are averaged. **Ties are broken by comparing criterion scores in the listed order 1 → 2 → 3 → 4**, then by judges' vote `[F]`. A listed judge is the Firebase product manager for hybrid inference `[F]`: every hybrid behaviour MUST be genuine and observable in telemetry.

| Order | Criterion (official intent) | Runtime proof a judge can observe | Code and README artifacts |
|---|---|---|---|
| **1** | **Technological Implementation** — how well it is built, and how effectively it uses Firebase AI Logic hybrid inference as a core part of the solution | Proof mode counters and the raw `inferenceSource` per call; the `ON_DEVICE` → `IN_CLOUD` transition of the one-click sample check; on-device structured output on Web (`responseConstraint`) and Android (`@Generable` + `generateObject`); the measured routing table applied per device profile; App Check with replay protection | `packages/firebase-client/src/l1/models.ts`, `l1/call.ts`, `l2/adjudicate.ts`, `l2/altSources.ts`; `apps/android/l1/.../OnDeviceModels.kt`, `CallL1.kt`; `apps/ios/ToulminL1/AppleL1.swift`; `packages/core-l0/src/gate.ts`; `H4_DECISION.md`; README sections 2 and 4 |
| **2** | **Design** — a complete, coherent experience including model download, readiness and fallback behaviour | One Claim Ledger object behind every view; explicit readiness states with exact unavailability reasons (model chip, environment report); fallback as a visible choice (consent classes A and B); the seven-count Coverage Meter header; one meaning per mark with non-colour cues | `docs/spec/06_CLIENTS_UI_AND_MONOREPO.md`; `packages/copy/en.json`; `apps/web/src/header/*`, `sheets/BatchConsentSheet.tsx`; README section 1 |
| **3** | **Potential Impact** — a credible, specific case for solving a real problem for a real audience, proven by what is demonstrated | The verified problem metrics (§2.1) on the title card; one-step LaTeX project import as an audit companion; the whole-manuscript audit; offline printed-source and lab-note resolution on the phone; verified findings on 3–5 real open-access preprints, false alarms included | `/eval-harness/reports/preprints.md`; README sections 1 and 4 |
| **4** | **Quality of the Idea** — creative, non-obvious use of Firebase AI Logic | Self-calibrating routing per device profile; the on-device model never accuses without calibrated evidence and never says "supported" without a measured false-support bound; evidence-first schema with deterministic anchor validation; per-task authority decided by measurement with Holm correction | `docs/spec/04_AI_RUNTIME_PROMPTS_AND_L3.md`; `docs/spec/07_EVAL_SPIKES_AND_ACCEPTANCE.md`; README section 4 |

### 1.3 Hardware and model facts used in public material

| Device | Role | Model fact |
|---|---|---|
| PC Ryzen 7 (AMD Ryzen 7 7700X, 32 GB RAM, 6 GB VRAM GPU, Windows, Chrome desktop) | Primary Web workbench; gated Web profile; primary video device | Chrome built-in Gemini Nano. Chrome's requirements: Chrome desktop **148+**; **≥ 22 GB free disk** on the profile volume; a GPU with **more than 4 GB** of video memory, or **≥ 16 GB RAM with ≥ 4 CPU cores**; an unmetered network for the first download `[F]`. The installed model version is read manually from `chrome://on-device-internals` `[F]` |
| Xiaomi 15T Pro (MediaTek Dimensity 9400+) | Android Pocket Ledger; gated Android profile | Listed under Gemini Nano 4 in the ML Kit GenAI device table `[F]`; AICore `STABLE` works offline `[F, team measurement]`; `PREVIEW` fails on this device `[F, team measurement]`; the model generation is read with `getBaseModelName()` and recorded (`S-N4`) |
| MacBook M5 (Apple Silicon, Chrome) | Second Web workbench (informative) | Chrome built-in Gemini Nano; no native macOS target (D-23) |
| Lenovo ThinkPad | `NO_LOCAL_MODEL` demonstration | Does not meet Chrome's requirements; the environment checker states the reason |
| iPhone 13 Pro Max (iOS 26, no Apple Intelligence) | iOS Thin Client | No on-device model; `HybridModel` falls back to the cloud secondary model |

### 1.4 External clarifications log

Both inquiries are recorded in the release log with the exact question, the channel, the posting reference and the answer or its absence. Neither inquiry is directed to a channel other than the one named.

| # | Channel | Question (exact substance) | When | Where the outcome is recorded |
|---|---|---|---|---|
| **X-1** | **Devpost forum** of the hackathon (public post; linked from the README) | (a) Whether AICore **`STABLE`** on the Xiaomi 15T Pro, a device listed under **Gemini Nano 4** in the ML Kit GenAI device table, satisfies the Android platform requirement; the post includes the model generations recorded at `S-N4`. (b) Whether the Devpost **"Testing Instructions"** field is visible to the public | Posted at the end of Phase 0, once `S-N4` has recorded the model generations | README section 3 links the post; the answer, or its absence, is recorded with the OPERATOR CHECK (§4.2.2) |
| **X-2** | **Gemini API developer channels** (the Google AI developer forum and Gemini API support) — **not the hackathon organizers** | Written grounding-terms clarification: (a) whether **deterministic L0 post-checks** that downgrade a grounded model answer (for example to `NEI` when its quote cannot be anchored) are compatible with the Grounding with Google Search display requirements, given that the Search Suggestions are still shown unmodified for the grounded call; (b) whether, after a reload, showing only the stored verdict and Toulmin's own paper-anchored quote with the **neutral label** *"Checked in the cloud on {date} — re-run to see sources"* and **without Search Suggestions** (grounded text and links are never persisted, D-19) is compatible with those requirements | Sent in Phase 3 [07 › Technical Dependency Phases] | Release notes and release log; if an answer requires a behaviour change, it is applied before release or the affected display is disabled |

---

## 2. Verified Empirical Problem Metrics & Public Claim Discipline

### 2.1 Problem metrics

Only figures labelled `[F]` MAY appear in the video, README, Devpost text or UI, and only in the exact public wording below. No other problem statistic may be invented.

| # | Finding | Exact figure | Source | Label | Exact public wording (README, video, Devpost) |
|---|---|---|---|---|---|
| **M-1** | Quotation errors in medical literature (meta-analysis of 46 studies, about 32,000 quotations) | **16.9 %** overall (18.7 % after trim-and-fill correction); **8.0 %** major errors; no improvement over 40 years | Baethge & Jergas, 2025 | `[F]` | "About 1 in 6 quotations in medical journals misstates its source (Baethge & Jergas, 2025)." — the only statistic used in the video |
| **M-2** | Citation accuracy in highly cited biomedical articles (3,063 citation instances) | **39.18 %** error rate (**18.02 %** major) | Sarol et al., 2024 | `[F]` | "In highly cited biomedical articles, 39.18 % of citations contained an error, 18.02 % a major one (Sarol et al., 2024)." |
| **M-3** | Fabricated references in published biomedical papers (audit of about 2.5 million papers) | **1 in 277** papers in early 2026 (1 in 2,828 in 2023; 1 in 458 in 2025); 4,046 fabricated references across 2,810 papers; > 98 % of flagged papers uncorrected | Topaz et al., *The Lancet*, May 2026 | `[F]` | "1 in 277 recent papers **in the PubMed Central open-access sample** contained a fabricated reference (Topaz et al., The Lancet, 2026)." — the phrase *"in the PubMed Central open-access sample"* is MANDATORY |
| **M-4** | Ungrounded local LLMs generating bibliographies (9 LLMs, 74,196 BibTeX entries) | **100 %** of locally generated entries hallucinated | Picazo-Sanchez & Ortiz-Martin, 2026 | `[F]` | "In one study, every bibliography entry generated by ungrounded local language models was hallucinated (Picazo-Sanchez & Ortiz-Martin, 2026)." |
| **M-5** | Abstract-only verification ceiling | **33.0 %** of real citations need full-text details beyond the abstract (n = 91) | DEEPSCIVERIFY, 2026 | `[F]` (small sample) | "In a sample of 91 citations, 33.0 % needed full-text details beyond the abstract (DEEPSCIVERIFY, 2026)." — always with "a sample of 91" |
| **M-6** | Naive abstract-only checker | **86.3 %** of valid citations mislabelled as problematic from title and abstract only (n = 250) | Zhang & Abernethy, 2026 | `[F]` | "Given only titles and abstracts, a general-purpose model flagged 86.3 % of valid citations as problematic (n = 250; Zhang & Abernethy, 2026)." |
| M-7 | Small-model contradiction blindness (split vs joint calls) | 0/54 detected with split calls, 22–33 % with joint calls | Reported as "Xu, NeurIPS 2026"; primary source not located | **`[UNVERIFIED]`** | **FORBIDDEN** in the video, README, Devpost text and UI |
| M-8 | Penalty of removing reasoning | Reported as a 14.9-point balanced-accuracy drop; the located version reports different figures for a fine-tuned 4B model | HalluGuard, ACL 2026 Findings | **`[UNVERIFIED]`** | **FORBIDDEN** in the video, README, Devpost text and UI |
| **M-9** | Value of a separated hybrid pipeline | **F1 0.89** vs 0.19 for LLM-only on REALCITATIONERRORS-500 | CITEGUARD, 2026 | `[F]`; different task, so only the architectural pattern transfers `[I]` | "Separating deterministic checks from model judgement is an established pattern (CITEGUARD, 2026)." — the 0.89 figure is never presented as Toulmin's or as transferable |
| **M-10** | Open-abstract coverage gap | Abstract availability per source: OpenAlex 63.8–72 %, Semantic Scholar 54.5 %, Crossref 13.7 %; **17.4–36.2 %** of DOIs lack an open abstract after cascading | Delgado-Quirós & Ortega, 2024; domain cascade study, 2026 | `[F]` | "Between 17.4 % and 36.2 % of DOIs have no open abstract available (Delgado-Quirós & Ortega, 2024)." — used to motivate printed-source checks |
| **M-11** | Privacy concern vs behaviour | 58–72.9 % of researchers report privacy concerns, yet more than half still use cloud AI for peer review | Survey literature | `[F]`; a supporting value, not the lead pitch `[I]` | "Most researchers report privacy concerns about cloud AI." — README privacy section only |

**Consequence of M-7 and M-8.** The evidence-first joint schema (D-03) is an **untested design choice**; it has not been compared with split-call or verdict-first alternatives, and no public text claims that it outperforms them.

### 2.2 Base-rate arithmetic `[I]`

For a local classifier with true-positive rate TPR and false-positive rate FPR on CONTRADICT, on a benchmark with prevalence π₀, precision P₀ satisfies:

```
P₀ / (1 − P₀) = (TPR / FPR) × π₀ / (1 − π₀)
```

At field prevalence π the same classifier has precision P with:

```
P / (1 − P) = (P₀ / (1 − P₀)) × [π / (1 − π)] / [π₀ / (1 − π₀)]
```

R1-E has **π₀ = 1/3** (odds 0.5). With **P₀ = 0.70** (odds 2.333), the likelihood ratio TPR / FPR = 4.667, independent of recall:

| Field prevalence π | Field odds π / (1 − π) | Field odds of precision = 2.333 × odds / 0.5 | Field precision P |
|---|---|---|---|
| **0.08** | 0.0870 | 0.4058 | **0.289** |
| **0.12** | 0.1364 | 0.6364 | **0.389** |
| **0.18** | 0.2195 | 1.0244 | **0.506** |

**Consequences (normative):** a local `CONTRADICTS` is never red without L2 confirmation; an unconfirmed hint uses the subtle dotted style and the label "On-device hint · unconfirmed"; NEI is never a warning; Proof mode and the README report `P(π)` **and** its conservative lower bound `P_LB(π)` at π ∈ {0.08, 0.12, 0.18} next to P̂ [07 › R1-E Metrics].

### 2.3 Public claim guardrails (MUST)

Every public surface — video, README, Devpost text, UI copy — follows these rules. `tools/claims-lint.ts` scans the README and the Devpost text file `/docs/devpost.md` for the forbidden words of rule 3.

1. **Evidence-first schema:** described as an **untested design choice**; never claimed superior to split-call or verdict-first alternatives.
2. **Latency and throughput:** cited only as measured p50/p95 on the named device and Chrome or AICore version (`S-W4`, `S-A3`); audit throughput only as measured.
3. **Forbidden words for on-device outputs:** never **"sub-second"**, **"no false alarms"**, **"verified"** or **"guaranteed"**; an on-device result is never called "supported" unless D-29 (1) or (2) holds.
4. **On-device role:** described exactly as *"reads the candidate passages from the cited paper and decides which one answers the claim"* (D-03); never "finds the evidence".
5. **`R1-E-L2`:** every mention states that it measures the **non-grounded, provided-evidence variant `l2AdjudicateProvided`** and **cannot be attributed to the grounded production adjudicator `l2Adjudicate`** — exact README sentence: *"These figures were measured without web search on our 150-pair test set, using the provided-evidence variant of the cloud check; they do not describe the web-grounded check used in the product."*
6. **`bm25_min_cov`:** every mention states that its calibration is **descriptive on DEV** (45 pairs, per-stratum Wilson lower bounds), not a population guarantee.
7. **Task authority:** never imply that B5 badges or O2 extractions are decided by the on-device model unless `H4_DECISION.md` records `authoritative` for that task and profile; with Holm correction both are expected to remain `advisory`.
8. **Precision figures:** `P_LB(π)` always next to `P(π)`; contradiction recall is phrased "Found {TP_pairs} of 50 contradictions in our test set"; no precision of 1.00 is reported from zero observed false positives.
9. **Support gate:** described as expected to fail and as the safe outcome; on-device supports are advisory unless the gate passed.
10. **Cloud quota:** described as a **cost-bounded daily preview**; never "unlimited".
11. **Android APK:** described as an **offline demonstration build on the bundled sample** (`bundledSample`) that runs Firebase AI Logic on-device inference; the words **"makes no network calls"** appear only after the `S-A5` network capture recorded zero traffic (AC-SEC-18).
12. **Parser isolation:** described as **"separated from credentials"**; "network-isolated" only if `BE-5` passed.
13. **Competition:** never claim that no other tool verifies claims against full text (SemanticCite does, in batch) or that no other tool assesses citations with an LLM (Google Deep Review and the scite connector do, in the cloud).

### 2.4 Real-preprint sentence

Shown in the video (segment 2:20–2:35, about 10 seconds of on-screen text) and in README section 4, **only** from the verified counts of `/eval-harness/reports/preprints.md` [07 › Real-preprint demonstration protocol]:

> *"On {n} recent open-access preprints, Toulmin flagged {k} items; after manual checking, {k_true} were real problems an author would want to fix and {k_false} were false alarms."*

All four numbers are always shown, including `k_false` when it is 0. If no verified run exists when the video is recorded or the README is finalized, the sentence is omitted (never estimated) and the video uses the fallback narration of §5.4 and §5.5.

---

## 3. Competitive Landscape & Defensible Differentiators

### 3.1 Comparison table

Column legend: **Auth/meta** = checks that a reference exists and its metadata is correct; **Retr.** = retraction check; **Claim→source** = judges whether the cited source supports the author's sentence; **Writing-time** = runs while the author writes; **On-device/offline** = semantic checks run locally and work without a network; **Full text** = uses full text beyond the abstract.

Every row labelled `[F2]` MUST be re-verified against the vendor's own page when the README is written. A row that cannot be verified is deleted from the README, never paraphrased.

| Tool | Execution | Auth/meta | Retr. | Claim→source | Writing-time | On-device/offline | Full text | Notes | Label |
|---|---|---|---|---|---|---|---|---|---|
| scite.ai (Reference Check) | Cloud; manuscript PDF upload | Partial | Yes | No (measures how later papers cite the reference) | No | No | n/a | Paid tiers | `[F2]` |
| scite MCP connector (ChatGPT, Claude, Microsoft 365 Copilot) | Cloud; hosted MCP server inside a chat assistant | Partial (DOI lookup) | Not stated | Indirect: returns citation statements classified as supporting, contrasting or mentioning, which the chat model interprets | No (chat) | No | Citation statements from full text | Paid scite subscription | `[F2]` |
| Google Deep Review | Cloud agentic reviewer (Gemini); document upload | Searches related research to assess citations | Not stated | Assesses claims and citations against related research as part of a whole-document technical review | No (pre-submission batch) | No | Searches the literature | Limited free reviews per week; API with a Gemini API key | `[F2]` |
| Writefull Cite | Cloud | No | No | No (flags sentences that need a citation and suggests additions) | Yes (flags) | No | n/a | | `[F2]` |
| Overleaf AI assistant (citation reviewer) | Cloud (third-party model; project content sent to the model provider) | Suggests publications for uncited claims | Via integrations | No | Yes (suggestions) | No | n/a | Overlaps B4 and O4 | `[F2]` |
| Paperpal (citation integrity check) | Cloud | Yes | Yes | No | Partial | No | n/a | Word, Google Docs, Overleaf, web | `[F2]` |
| OpenAI Prism | Cloud LaTeX editor | Reference scanning for errors and inconsistencies | Not stated | Not stated | Yes | No | Not stated | Integrates with Zotero | `[F2]` |
| CiteStamp | Overleaf / Word / Zotero extension | Yes | Not stated | Not stated | Continuous checks on a paid tier | No | Not stated | Scope of checks not confirmed | `[F2]` |
| Zotero + FullVahti (community plugin) | Local | No | Yes (retraction warnings when citing) | No | Word-processor plugin | Yes | n/a | Free | `[F2]` |
| Elicit / Consensus | Cloud | Search | Partial | Not a writing assistant | No | No | Extraction | | `[F2]` |
| sciwrite-lint | Local (vLLM, dedicated GPU, container runtime) | Yes | Yes | Yes, plus cross-section consistency (sample-size tracking, abstract–body alignment) | Between revisions (long first run; minutes on cached reruns) | Yes | Yes | Free, open source; requires GPU drivers | `[F2]` |
| SemanticCite | Local web UI + external LLM API keys | n/a | n/a | Yes (Supported / Partially Supported / Unsupported / Uncertain) | No (batch) | Depends on API | Yes | Open source | `[F2]` |
| CiteTrue / AccuraCite / Evidentia | Mac / web / CLI | Yes (fabrication detection) | n/a | Limited | No | Partial | n/a | | `[F2]` |
| **Toulmin** | **Hybrid**: Firebase AI Logic on device + cloud | Yes (L0) | Yes (L0) | **Yes, by the cloud check, or on calibrated devices**: evidence-first, anchor-validated, per reference; an on-device support verdict is shown only if the profile passes the support gate (D-08) | **Yes** for single-file documents; read-only audit companion for multi-file projects | **Conditional**: Web on computers meeting Chrome's on-device model requirements (Chrome 148+, 22 GB free disk, a GPU with more than 4 GB of memory or 16 GB RAM and 4 CPU cores); Android on devices with Gemini Nano; otherwise reference checks only, or cloud checks with consent | Yes (quiet escalation, server-verified open-access text, printed sources) | Runs in Chrome, no install, free; **cloud checks are a cost-bounded daily preview** | design |

### 3.2 Not defensible as a lead differentiator

The following MUST NOT be presented as Toulmin's moat, because other tools already offer each of them:
- missing-citation suggestions (B4, O4);
- cross-section number consistency (B5);
- DOI resolution and retraction checks;
- "on-device" by itself.

### 3.3 Defensible differentiators (lead with these, in this order)

1. **Claim-to-full-text verification with an anchored quote while writing.** Each verdict carries a verbatim evidence span that L0 validates and highlights in the source — live for **single-file documents**, and as a **read-only audit companion** for multi-file projects that the author re-imports to refresh.
2. **No install, free, and local where the hardware allows.** It runs in Chrome on the author's own computer. Public wording MUST state next to this claim that on-device checks need **Chrome 148+, 22 GB free disk, and a GPU with more than 4 GB of memory or 16 GB of RAM and 4 CPU cores**, that other computers get reference checks or cloud checks with consent, and that **cloud checks are a cost-bounded daily preview**. The local layer costs nothing per call, which makes a permanent free tier sustainable `[I]`.
3. **Inspectable self-calibration per device profile.** Toulmin measures, per device profile, whether its on-device model may raise hints (Path A or Path B), whether on-device supports may be shown (support gate), and which local tasks are authoritative (CF-1 with Holm correction), and shows these measurements in Proof mode.
4. **Offline physical-evidence resolution.** A photographed printed table row (O2, Select-row) or a typed or printed lab note (O3) becomes evidence with provenance (photo hash plus an author-confirmed crop). This addresses part of the 17.4–36.2 % open-abstract gap (M-10).

**Adoption bridge** (supporting, not differentiating): one-step import of a LaTeX project archive, `.tex` + `.bib`, or `.docx` as a read-only audit copy refreshed by re-import (results kept by `resultKey`); a whole-manuscript audit prioritized by viewport; an action-ordered integrity report and a corrected `.bib` with `file:line` links.

### 3.4 Moat risk `[I]`

Large editor vendors own every component needed to add cloud claim-to-reference checking, and **Google Deep Review** already performs cloud citation assessment as part of whole-document review. Toulmin's defensibility therefore rests on differentiators 1–4, which depend on on-device inference, deterministic anchoring and measured calibration — not on claim checking alone. The README states this risk plainly.

---

## 4. Devpost Submission Fields, Testing Instructions & README Blueprint

### 4.1 Devpost form fields

| Field | Value |
|---|---|
| Project name | Toulmin — The Self-Calibrating Claim Ledger |
| Tagline | Know which of your claims your sources actually support — while you write. |
| **"Try it out" URL** | **`https://toulmin.web.app/`** (the base URL; never a URL with a code or parameter) |
| Public repository URL | `https://github.com/{org}/toulmin` (Apache-2.0 visible in the About panel) |
| Video URL | The public YouTube video of §5 |
| Platform (S1-9) | Web/Chrome |
| Built with | Firebase AI Logic, Gemini Nano (Chrome built-in AI; Android AICore), Gemini API (`gemini-3.8-flash`), Firebase App Check, Firebase Authentication, Cloud Functions for Firebase, Cloud Firestore, Cloud Storage for Firebase, Firebase Hosting, Firebase Remote Config, ML Kit Text Recognition, TypeScript, Kotlin, Swift |
| Description | Built from `/docs/devpost.md`, which follows the README structure of §4.3 and passes `tools/claims-lint.ts` |
| Testing Instructions | Exactly the text of §4.2.1, filled only after the OPERATOR CHECK of §4.2.2 |

### 4.2 Devpost Testing Instructions

#### 4.2.1 Verbatim template

The text is stored in `packages/copy/en.json` (key `devpost.testingInstructions`); `copy.test.ts` checks that the Devpost field equals it (AC-STAGE1-08). Placeholders in braces are filled at submission; nothing else changes.

1. *"Open https://toulmin.web.app/ in Chrome on a desktop computer and click 'Try a sample manuscript'. Every feature works without signing in. The sample is editable: type a new claim and watch it being checked. Imported multi-file projects (.zip, .docx) open as read-only audit copies."*
2. *"In Standard mode, click 'Check the sample in the cloud' to send the sample's five predefined claims to the cloud check in one click. Public cloud checks are a cost-bounded daily preview: this sample check is shared by all visitors for up to 20 runs a day. With a judge code, the sample check and every other cloud check use the reserved judge quota instead."*
3. *"To see whether each check ran on this device or in the cloud, open Proof mode from the ⋯ menu in the header (⋯ → Proof mode). It turns on automatically after you enter a judge code."*
4. *"To use the reserved judge quota, open the ⋯ menu, choose 'Judge access' and enter one of these codes. Each code works on up to 5 browsers or devices: {CODE_1}, {CODE_2}, {CODE_3}, {CODE_4}, {CODE_5}, {CODE_6}, {CODE_7}, {CODE_8}, {CODE_9}, {CODE_10}. If a code does not work, contact us through the Devpost judging contact and we will send a replacement."*
5. *"On-device checking needs Chrome 148 or later on a computer with 22 GB of free disk space and either a graphics card with more than 4 GB of memory or 16 GB of RAM and 4 CPU cores. On other computers Toulmin explains why the on-device model is unavailable: choose Confidential for reference checks only, or Standard and 'Use cloud fallback for this document' to see the cloud fallback."*
6. *"Android: install the APK from {APK_URL} (allow installs from this source, then open Toulmin). This APK is an offline demonstration of the Pocket Ledger on the bundled sample manuscript: it runs Firebase AI Logic on-device inference on the phone, including checks against a printed table or a typed lab note you photograph (printable pages: {PRINT_PAGES_URL}). It needs a phone with Gemini Nano through AICore."* — followed by the sentence *"It makes no network calls."* **only if** `/docs/spikes/S-A5.md` records a clean network capture (zero outbound connections) for the release APK; otherwise that sentence is omitted.

The field contains no production API key, project secret, service-account data, email address or other personal data (S1-5).

#### 4.2.2 OPERATOR CHECK (mandatory; recorded in the release log)

Before the submission is finalized, the operator MUST:
1. open the Devpost submission preview while **signed out**, and the public project page, and confirm that the **"Testing Instructions" field is not shown publicly**;
2. record the answer to the Devpost forum question X-1(b) (§1.4), or its absence;
3. confirm with `tools/claims-lint.ts --testing-instructions` that the text contains no key, secret or personal data and that item 6 includes "It makes no network calls." only if `S-A5` passed.

**Outcome:**
- **Field confirmed private** → item 4 is filled with the 10 codes.
- **Field public, or visibility unknown** → item 4 reads instead *"Judge access codes are in the private message sent to the judging contact through Devpost."*, and the codes are sent through the organizer's private channel.

A leaked code is disabled with `tools/reset-judge-code.ts --disable` (effective within 60 s) and a new code is sent privately (lever L-7 [05 › Server-side levers (strongest effect first)]).

### 4.3 Required `README.md` sections

The README is written in Phase 3 from `H4_DECISION.md` and the reports of `07`; every number is copied from a report, never typed by hand. Required sections, in this order:

1. **Promise, scope and fit.**
   - The single promise, verbatim: *"Know which of your claims your sources actually support — while you write."*
   - Next to it, the scope: live checking while writing applies to **editable single-file documents** (a blank document, one `.md`, one `.tex` without includes, and the built-in Sample Manuscript); **imported multi-file projects** (`.zip`, `.docx`) are **read-only audit copies** — *"Multi-file projects open as a read-only audit copy: keep editing in your own editor and re-import to refresh."*
   - Problem metrics from §2.1 in their exact public wording; the comparison table of §3.1 (re-verified), the differentiators of §3.3 with the hardware requirement and the cost-bounded daily preview stated next to differentiator 2, and the moat risk of §3.4.
   - The positioning line [05 › Positioning line (footer, README, onboarding)].
2. **Architecture and hybrid inference.**
   - The L0–L3 architecture diagram and the Claim Ledger data flow.
   - **"Why Standard mode uses `ONLY_ON_DEVICE` on capable devices"**: on a device with a usable model, local stages never fall back silently to the cloud — a transient on-device failure escalates quietly to the consented cloud check instead, so manuscript text reaches the cloud only through an explicit consent (classes A and B) [04 › Choice of `LocalInference`].
   - Direct links to the files that prove each mode at runtime:

     | Mode | Use | Source files |
     |---|---|---|
     | `ONLY_ON_DEVICE` | Every local stage on capable devices (Web, Android) | `packages/firebase-client/src/l1/models.ts`, `packages/firebase-client/src/l1/call.ts`, `apps/android/l1/src/main/kotlin/app/toulmin/l1/OnDeviceModels.kt`, `apps/android/l1/src/main/kotlin/app/toulmin/l1/CallL1.kt` |
     | `PREFER_ON_DEVICE` | Consented cloud fallback on devices without a usable model (consent class A) | `packages/firebase-client/src/l1/models.ts` |
     | `PREFER_IN_CLOUD` | *Find alternative sources* (cloud with Google Search online; cached library on device offline) | `packages/firebase-client/src/l2/altSources.ts` |
     | `ONLY_IN_CLOUD` | L2 adjudication with Google Search grounding and the provided-evidence variant | `packages/firebase-client/src/l2/adjudicate.ts`, `packages/firebase-client/src/l2/grounding.ts` |
     | Apple `HybridModel` | iOS Thin Client cloud fallback | `apps/ios/ToulminL1/AppleL1.swift` |

   - App Check and replay protection; the Android `bundledSample` build described per guardrail 11 of §2.3.
3. **Platforms and Observed Models.**
   - One row per device of §1.3: platform, role, observed availability, observed model generation (Chrome: the values read from `chrome://on-device-internals`; Android: `getBaseModelName()`; "model generation not readable on this device" where `S-N4` recorded none), Chrome or AICore version, and the measured p50/p95 latency per schema.
   - The hardware requirement of Chrome's on-device model next to any "no install" claim.
   - The link to the Devpost forum inquiry X-1.
4. **Calibration and evaluation.**
   - From `H4_DECISION.md`, per gated profile: `P̂` with its Wilson interval, `WilsonLB95`, `S` with its bootstrap interval, `PP_pairs`, the resulting path, "Found {TP_pairs} of 50 contradictions in our test set", `P(π)` **with** `P_LB(π)` at 8 %, 12 % and 18 %.
   - **Support-gate status** (`P̂_S`, `WilsonLB95_S`, `PS_pairs`, `FSR_C`, `FSR_N`) with the statement that the gate was expected to fail and that on-device supports stay advisory unless it passed.
   - The **CF-1 Holm table** per profile (Δ, unadjusted p, Holm-adjusted p, power, authority) with the stated expectation for B5 and O2.
   - The `R1-E-L2` summary with the **provided-evidence caveat** of guardrail 5.
   - The `bm25_min_cov` value with the **descriptive-on-DEV** note of guardrail 6 and Recall@5.
   - The real-preprint sentence of §2.4 with the **verified counts including `k_false`**, and a link to `preprints.md`.
   - First-look and replayed metrics are both linked (`H4_DECISION.md`); the evidence-first schema is described as an untested design choice.
5. **Privacy, paid services and risk.**
   - The Standard and Confidential copy [05 › Standard mode banner], [05 › Confidential mode notice]; the local storage and backup notice; no cross-device sync.
   - **Paid Services:** cloud checks use the Gemini Developer API as a paid service through Firebase AI Logic; prompts are not used to train Google's models.
   - **Grounding retention:** Google keeps prompts and search results of grounded checks for **30 days** to provide grounded answers; Toulmin never stores grounded text or links.
   - **reCAPTCHA Enterprise disclosure:** signals about the browser and device are sent to Google to protect the service from abuse.
   - **Residual cost and abuse risk:** the spend caps (AI Logic US$60, Cloud Functions US$40 per month) can be consumed by an attacker operating genuine attested browsers, which pauses cloud features for everyone until an operator lifts the cap; `recaptchaBreaker` disables the Web reCAPTCHA key at US$10 of assessments, after which Web cloud features stop until an operator re-enables it, while on-device checks keep working; billing lag can exceed a threshold before it is acted on.
   - The parser described per guardrail 12; the threat model summary (`SECURITY.md`).
6. **Pre-existing code and work disclosure.** Every dependency with its licence; any code, data or design written before the contest submission period, with what it was and what was built during the contest; the CC-BY sources of the Sample Manuscript and of the evaluation data.
7. **Operational monitoring.**
   - **Standard Monitoring Mode** (from public launch until the official judging period starts: one daily check by one operator) and **Active Judging Monitoring Mode** (from the start of the official judging period until `JUDGE_TIER_EXPIRY_EPOCH`: two named operators, a check at least every 2 hours with a smoke test) [05 › Monitoring modes].
   - **Cap-lift authority** (primary operator; raising a cap needs both operators), the **reCAPTCHA recovery key** procedure (re-enabling the Web key needs both operators after the abuse source is blocked), and the **judge-code reset** (`tools/reset-judge-code.ts --disable`, `--clear-uids`).
   - Operator names are never published.

---

## 5. 2:40–2:45 Multi-Device Video Storyboard (Variant A & Variant B)

### 5.1 Recording rules (normative)

1. **Real screens only.** Every frame is a screen recording of the production build on the named device, or a camera shot of the named phone's screen. No mock-ups, no simulated telemetry, no speed-ups of model output. Waiting time is cut only at a visible **hard cut** (for example across the camera and OCR wait on the phone).
2. **Authentic hybrid telemetry in the first 35 seconds.** Proof mode is turned on from ⋯ → Proof mode before recording (the status bar exists only in Proof mode). Between 0:10 and 0:35 the viewer sees the model chip "On-device · measured on this device", the raw `ON_DEVICE` value in the status bar, the counter "On-device {n}" rising while the author types, and a **2-second cut of `chrome://on-device-internals`** on the same computer (page content only).
3. **Zero secrets.** No judge code, API key, email address or personal data on screen; the "Judge access" dialog is never opened on camera. No cross-device transfer of any kind is shown: the phone segment uses the `bundledSample` build, whose sample ledger is already on the phone.
4. **Zero third-party logos or trademarks.** Device logos are covered with matte tape; browser chrome is cropped to the page content; no LaTeX-service or editor vendor names are shown or spoken ("LaTeX project" only). The Google Search Suggestions block appears exactly as rendered by the API and is not zoomed or highlighted.
5. **Verified statistics only.** The only problem statistic is M-1 in its exact wording; the only measured numbers are those of `H4_DECISION.md` and `preprints.md`. The voice-over never says "precision", "recall", "confidence interval", "Wilson", "kappa", "p-value", "bootstrap", "prevalence" or "calibration" and never speaks a formula; on-screen Proof-mode numbers may carry their labels.
6. **Narration aligned with D-03.** In **both variants** the on-device role is narrated exactly as the model *"reads the candidate passages from the cited paper and decides which one answers the claim"*; the narration never says the model "finds the evidence", and never uses the forbidden words of §2.3 rule 3.
7. **Consent is shown where it happens.** The sample segment (0:35–1:05) never speaks of approving: the public sample is sent with one click and no consent sheet. The word **"approve"** is spoken and shown only in the ThinkPad segment (1:55–2:20), where consent class A is on screen.
8. **Grounding stays visible.** Items 4 and 5 of the one-click sample are grounded with Google Search, so the Search Suggestions block of item 4 appears on screen in both variants.
9. **English voice-over recorded first**, with **burned-in English captions** of the exact text and the same captions uploaded to YouTube. Video segments are cut to the recorded narration; the narration is never sped up.
10. **Duration 2:40–2:45**, strictly under 3:00; YouTube visibility **Public**; title "Toulmin — know which of your claims your sources actually support".
11. **At most five core concepts:** (1) on-device checking while writing, with its measured proof (segment 2:20–2:35 belongs to this concept); (2) the one-click cloud check of the public sample; (3) deterministic reference problems; (4) offline proof from a printed page; (5) fallback as a choice on computers without the model, with the author's approval. `PREFER_IN_CLOUD` (*Find alternative sources*) is described in the README, not in the video.
12. **Variant choice.** **Variant A** if at least one gated profile is in Path A in `H4_DECISION.md`; otherwise **Variant B**. The variant is re-checked against the published `routing_table` immediately before recording.
13. **Single promise:** shown as on-screen text from 0:05 to 0:10 and spoken on the end card, on the editable Sample Manuscript (a single-file document), which is exactly the scope in which it holds.

### 5.2 Demo manuscript composition

The video uses the built-in **Sample Manuscript** [06 › Sample Manuscript content (normative)] on the Web and the same manuscript's pre-cached ledger in the Android `bundledSample` build. It is a **synthetic, author-owned paper** whose every cited reference is a real CC-BY open-access paper. The items used by the video:

| Item | Content | Where it is shown | Expected result on screen |
|---|---|---|---|
| Fabricated DOI | Item 1: `.bib` DOI `10.5555/toulmin-sample-nonexistent-0001` | PC Ryzen 7, 1:05–1:20 | Red "DOI not found" (`DOI_NOT_FOUND`) |
| Retracted reference | Item 2: a CC-BY paper retracted in the Retraction Watch snapshot | PC Ryzen 7, 1:05–1:20 | Red "retracted" |
| Contradicting claim (number) | Item 4: 37 % in the claim vs 23 % in the abstract; grounded | PC Ryzen 7, 0:35–1:05 | Variant A: dotted hint, then red with quote and Search Suggestions; Variant B: waiting, then red |
| Contradicting claim (direction) | Item 5: increase vs decrease; grounded | PC Ryzen 7 (sent in the same one-click run; its card is not opened) | Red after the cloud check |
| Full-text-only claim | A claim supported only by a detail of the cited paper's open-access full text | Phone ledger (available for O1; not narrated) | "Checked on this phone (unconfirmed)" after O1 |
| B5 sample-size mismatch | Item 7: 48 participants in Methods vs 46 in Results | PC Ryzen 7, visible in the editor during 1:05–1:20 (not narrated) | Purple "≠" badges |
| Printed-table claim | A claim whose value appears only in a printed table of the cited paper (printable page in `/docs/demo/printed_table.pdf`) | Xiaomi 15T Pro, 1:20–1:55 | Green "Supported (printed source)" after both confirmations |
| Lab-note value | A value that also appears in a typed lab note (printable page in `/docs/demo/lab_note.pdf`) | Phone ledger (available for O3; not narrated) | "Matches your lab note ({pageLabel})." |
| Clean paragraph | Three claims paraphrasing their cited abstracts | PC Ryzen 7 (sent in the one-click run; not opened) | Green after the cloud check |

### 5.3 Shared segments (both variants)

| Time | Device / screen | On-screen action (exact) | Voice-over (exact) |
|---|---|---|---|
| **0:00–0:10** | Black title card, white text: **"About 1 in 6 quotations in medical journals misstates its source."** Small caption: **"Baethge & Jergas, 2025"**. At 0:05 the single promise fades in below it | Static | "About one in six quotations in medical journals misstates its source. Toulmin helps you catch that while you write." |
| **0:10–0:35** | PC Ryzen 7, Chrome, Standard mode, Proof mode on | Click **"Try a sample manuscript"**; the sample opens (badge "Sample"). Model chip "On-device · measured on this device"; status bar `ON_DEVICE`. **Hard cut, 2 s:** `chrome://on-device-internals` with the on-device model entry. **Hard cut back:** type the sentence "Daily walking reduced resting heart rate by 12% [3]."; the counter "On-device {n}" rises with each sentence | "This is a manuscript on my own computer. As I type, Chrome's built-in Gemini Nano reads the candidate passages from the cited paper and decides which one answers the claim — right here, on this device." |
| **1:05–1:20** (**protected**) | Same | Scroll to the red flags: "DOI not found" on item 1, "retracted" on item 2; open the integrity report preview showing "Fix references" first with `sample.tex:{line}` | "Some problems need no model: a reference that doesn't exist, or a retracted paper. Toulmin flags those instantly and lists them first in your report, with the exact line." |
| **1:20–1:55** | **Xiaomi 15T Pro in Airplane Mode** (airplane icon visible), `bundledSample` APK | **Start directly on the Claim Detail screen** of the printed-table claim → **"Check against a printed page"** → photograph the printed table (**hard cut** across the camera and OCR wait) → tap the row → **Yes** on the header → the composite crop shows the header and row with the cell outlined → tap **"Matches the photo"** → the result card shows the **`ON_DEVICE`** badge on its provenance chip → the screen asks "Does this row support your claim?" → tap **"This row supports my claim"** → green **"Supported (printed source)"** with provenance "Printed source · Author" | "Now I'm offline, in the library, with the printed paper. The phone's own Gemini Nano does the checking. I photograph the table, tap the row, and confirm the number against the crop. Then I confirm the row really supports my claim. Supported — by the printed source." |
| **1:55–2:20** | Lenovo ThinkPad, Chrome (`NO_LOCAL_MODEL`) | Open the base URL; click "Try a sample manuscript". The card **"This device can't run the on-device model."** with its exact reason. Click **"Use Confidential"**: reference flags appear, no claim checks. Then choose Standard and click **"Use cloud fallback for this document"** (**consent class A**, the only approval shown in the video): the next checked claim carries the provenance chip "Cloud"; in the status bar, a `PREFER_ON_DEVICE` call returns `IN_CLOUD`. **Optional (≤ 3 s, no added voice-over):** iPhone 13 Pro Max showing the chip "Cloud (this iPhone can't run the on-device model)" and a `HybridModel` answer | "On a laptop that can't run the model, Toulmin says exactly why and lets you choose. Confidential keeps everything on the laptop and still checks references. Or I approve cloud fallback for this document, and the same checks run in the cloud. Fallback is a choice, never a surprise." |
| **2:35–2:45** | End card | **"Toulmin — The Self-Calibrating Claim Ledger"** · "Know which of your claims your sources actually support — while you write." · **"Open source (Apache-2.0)"** · base URL `toulmin.web.app` · repository URL · small line, exact: **"On-device checks need a supported computer · cloud checks limited daily"** | "Toulmin. Know which of your claims your sources actually support — while you write. Try it free at toulmin dot web dot app." |

### 5.4 Variant A segments (at least one gated profile in Path A; `web_chrome_nano` in Path A for the recorded computer)

| Time | Device / screen | On-screen action (exact) | Voice-over (exact) |
|---|---|---|---|
| **0:35–1:05** | PC Ryzen 7 | (1) A subtle amber-grey dotted underline (`HINT`) appears on item 4 (37 % vs 23 %). (2) Hover shows "On-device hint · unconfirmed" and the evidence passage. (3) Click **"Check the sample in the cloud"** in the header (one click, no sheet). (4) In one frame the status bar changes from `ON_DEVICE` to `IN_CLOUD`; the counter "Cloud 5" appears. (5) The hint becomes a solid red underline. (6) The inspector shows the anchored quote from the paper and the **Search Suggestions** block of the grounded check | "When the on-device model sees a possible conflict, it only hints — quietly. The public sample goes to the cloud in one click. Gemini in the cloud reads the paper with Google Search: twenty-three percent, not thirty-seven. Now it's red — with the quote." |
| **2:20–2:35** | PC Ryzen 7, Proof tab | **3 s:** the **"Measured on this device"** card ("Found {TP_pairs} of 50 contradictions in our test set", field figures shown with "at least") with the On-device and Cloud counters. **About 10 s:** the real-preprint sentence of §2.4 as on-screen text with its four verified numbers | "Toulmin measured its own on-device model on this computer. And on real preprints, we checked every flag by hand — false alarms included." **No verified preprint run:** the on-screen sentence is omitted and the voice-over is "Toulmin measured its own on-device model on this computer, and Proof mode shows exactly what was measured." |

### 5.5 Variant B segments (every gated profile in Path B)

Variant B uses every segment of §5.3 and these two segments in place of §5.4. The phrase "it only hints — quietly" never appears, no dotted underline is shown anywhere, and Path B is never presented as a failure.

| Time | Device / screen | On-screen action (exact) | Voice-over (exact) |
|---|---|---|---|
| **0:35–1:05** | PC Ryzen 7 | (1) No inline mark appears on item 4. (2) Open the Coverage Meter: "{waiting} waiting"; the drawer *Waiting for cloud check* lists items 4 and 5 with their "On-device alignment" passages. (3) Click **"Check the sample in the cloud"** in the header (one click, no sheet). (4) In one frame the status bar changes from `ON_DEVICE` to `IN_CLOUD`; counter "Cloud 5". (5) Item 4 becomes a solid red underline. (6) The inspector shows the anchored quote and the **Search Suggestions** block of the grounded check | "Here the on-device model reads the candidate passages from the cited paper and decides which one answers the claim, but it doesn't accuse: what it can't settle waits quietly. The public sample goes to the cloud in one click. Gemini, with Google Search: twenty-three percent, not thirty-seven. Now it's red — with the quote." |
| **2:20–2:35** | PC Ryzen 7, Proof tab | **3 s:** the **"Measured on this device"** card, the path "B" and the counters. **About 10 s:** the real-preprint sentence of §2.4 as on-screen text | "The model reads and explains the evidence; the cloud makes the call — so nothing is flagged that wasn't checked. And we checked every preprint flag by hand." **No verified preprint run:** the on-screen sentence is omitted and the voice-over is "Toulmin measured its own model on this computer. The model reads and explains the evidence; the cloud makes the call — so nothing is flagged that wasn't checked." |

### 5.6 Timing check

Word counts exclude punctuation-only tokens such as "—"; they are recomputed by `tools/video-words.ts` from `/docs/video/narration_{A,B}.txt`.

| Segment | Duration | Words (Variant A) | Words per minute (A) | Words (Variant B) | Words per minute (B) |
|---|---|---|---|---|---|
| 0:00–0:10 | 10 s | 19 | 114 | 19 | 114 |
| 0:10–0:35 | 25 s | 35 | 84 | 35 | 84 |
| 0:35–1:05 | 30 s | 42 | 84 | 53 | 106 |
| 1:05–1:20 | 15 s | 29 | 116 | 29 | 116 |
| 1:20–1:55 | 35 s | 46 | 79 | 46 | 79 |
| 1:55–2:20 | 25 s | 49 | 118 | 49 | 118 |
| 2:20–2:35 | 15 s | 22 (17 without preprint run) | 88 | 27 (27 without preprint run) | 108 |
| 2:35–2:45 | 10 s | 22 | 132 | 22 | 132 |
| **Total** | **2:45** | **264** | **≈ 96** | **280** | **≈ 102** |

### 5.7 Deterministic cut order and manual video acceptance checklist

**Cut order (applied only if the final cut exceeds 2:45):**
1. shorten **2:20–2:35** first: drop the Proof card and keep only the preprint sentence (or, without a preprint run, the Proof card alone); minimum 8 s;
2. then shorten **1:55–2:20**: drop the Confidential click and keep the reason card and the approved cloud fallback; minimum 15 s;
3. if both are at their minimums and the cut still exceeds 2:45, delete the optional iPhone shot;
4. **never cut 1:05–1:20** (deterministic reference problems; protected), and never speed up the narration.

**Manual sign-off checklist** (`/docs/acceptance/VIDEO.md`; each item signed by two team members with the export file's SHA-256; AC-STAGE1-07):

| # | Check | Pass condition |
|---|---|---|
| 1 | Duration, visibility and captions | Exported duration between 2:40 and 2:45; YouTube visibility Public; English burned-in captions equal the uploaded captions and the narration file |
| 2 | Secrets, codes and trademarks | No judge code, API key, email or personal data in any frame; "Judge access" never opened; device logos covered; browser chrome cropped; no third-party logo, trademark or LaTeX-service name shown or spoken; no cross-device transfer shown |
| 3 | Claims and variant | The variant matches `H4_DECISION.md` and the published `routing_table`; the D-03 wording is spoken in both 0:10–0:35 and (Variant B) 0:35–1:05; none of "sub-second", "no false alarms", "verified", "guaranteed"; no statistical jargon spoken; every on-screen number traceable to `H4_DECISION.md` or `preprints.md` |
| 4 | Authentic telemetry | `ON_DEVICE` chip and rising counter in 0:10–0:35; the 2-second `chrome://on-device-internals` shot; the one-frame `ON_DEVICE` → `IN_CLOUD` transition in 0:35–1:05; the phone's `ON_DEVICE` badge with the airplane icon visible in 1:20–1:55; no speed-up of model output; every time skip is a hard cut |
| 5 | Consent | 0:35–1:05 uses one click without any spoken or shown approval; "approve" is spoken and consent class A is shown only in 1:55–2:20 on the ThinkPad |
| 6 | Statistics and closing card | The title card shows M-1 exactly as in §2.1 with its caption; the preprint sentence shows all four verified numbers including `k_false`, or is omitted with the fallback narration; the end card shows the title, "Open source (Apache-2.0)", the repository URL and "On-device checks need a supported computer · cloud checks limited daily" |
