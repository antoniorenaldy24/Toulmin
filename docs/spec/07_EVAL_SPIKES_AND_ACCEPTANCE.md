# 07 — Evaluation, Spikes & Acceptance

**Owns:** the compatibility spike matrix and the backend verification checklist (`BE-1`–`BE-5`); the evaluation datasets, disjointness, the tiered freeze and replay protocol and the decision record `H4_DECISION.md`; the `R1-E` calibration benchmark with its formulas, gates, fixtures and publication guard; the non-grounded `R1-E-L2` report; DEV ablations and the `bm25_min_cov` calibration; the `CF-1` task-authority suite with its statistical procedures and power analysis; the `O2` physical-evidence evaluation; sanitizer calibration and red team; the real-preprint demonstration protocol; the technical dependency phases with their exit gates; the Master Acceptance Matrix and its normative test procedures.

**Load with:** `AGENTS.md` (always). The gate formulas are implemented once in `packages/core-l0/src/gate.ts` [04 › Shared gate module (`packages/core-l0/src/gate.ts` and `Gate.kt`)]; replay discipline for Tier B modules is mirrored in [03 › Replay and preregistration discipline (D-30)]; the evaluated algorithms are specified in `01`–`06`.

**Cross-reference notation.** `[0n › Topic]` names the owning specification file `docs/spec/0n_*.md` and the topic heading inside it. A bare `§n.m` refers to this file.

**Profiles and devices.**

| Profile | Device | Role in evaluation |
|---|---|---|
| `web_chrome_nano` | PC Ryzen 7 7700X, Chrome stable | Gated (R1-E, CF-1 B1/B2/B3/B5, probe) |
| `android_aicore_stable` | Xiaomi 15T Pro, AICore `STABLE` (Dimensity 9400+) | Gated (R1-E, CF-1 B1/B2/B3/B5/O2, probe) |
| — | MacBook M5, Chrome stable | Informative only; never gated |
| — | Lenovo ThinkPad (no qualifying hardware) | `NO_LOCAL_MODEL` behaviour (`S-W7`) |
| — | iPhone 13 Pro Max (iOS 26, no Apple Intelligence) | `HybridModel` fallback (`S-P2`–`S-P4`) |

**Seed constants** (constant values; every randomized procedure logs its seed in its manifest):

| Constant | Value | Used by |
|---|---|---|
| `SEED_KAPPA_SUBSAMPLE` | `0x544C4D41` | κ subsample draw (§3.4) |
| `SEED_KAPPA_RESUBSAMPLE` | `0x544C4D42` | κ subsample after targeted adjudication (§3.4) |
| `SEED_B2_SUBSAMPLE` | `0x544C4D43` | B2 agreement subsample (§4.5) |
| `SEED_BOOTSTRAP` | `0x544C4D4E` | stability interval, κ interval, single-call precision intervals, DEV Macro-F1 intervals (identical to [04 › Prevalence-adjusted precision (reported with a lower bound, not gated)]) |
| `SEED_PERMUTATION` | `0x544C4D50` | paired permutation test (§4.2) |
| `SEED_POWER` | `0x544C4D51` | power simulation (§4.3) |
| `SEED_O2_BOOTSTRAP` | `0x544C4D52` | Select-row accuracy interval (§4.10) |
| `SEED_GRID_BOOTSTRAP` | `0x544C4D53` | grid accuracy interval (§4.11) |
| `SEED_FUZZ` | `0x544C4D46` | ReDoS corpus (§6.9) |
| `SEED_PROPERTY` | `0x544C4D47` | reducer and meter property tests (§6.9) |
| R1-E run orders | `11`, `22`, `33` | per-run permutation of the 150 pairs (§3.5) |

---

## 1. Master Compatibility Spike Matrix & Backend Verification Checklist

### 1.1 Execution rules (MUST)

1. Every spike and backend check runs **before** the code that depends on it is written beyond a stub. Each `⚠ VERIFY-AT-SPIKE` marker in the specification names exactly one spike of this section or one backend check `BE-1`–`BE-5` (`AGENTS.md` §3.3).
2. Each result is recorded in `/docs/spikes/{ID}.md` with: device, operating system, browser or SDK versions (exact package versions); the raw measurements (logs or CSV committed next to the record); **PASS** or **FAIL** against the criterion; the fallback applied, if any; and the marker locations it resolves (also listed in `/docs/spikes/RESOLUTION.md`, marker location → result).
3. The feature flag `spike_<id>_primary` follows the record. A spike that is not executed before its phase ends counts as **FAIL**, and its fallback applies.
4. **Pre-decode** spikes (`S-W3`, `S-W4` reasoning cap, `S-W5`, `S-W10` item (a), `S-A2`, `S-A4`) and `BE-1`–`BE-4` complete in **Phase 0**, before `l0-freeze-a`. `BE-5` completes in **Phase 2**, before `oaParse` is deployed. Every other spike completes before **Phase 3** begins.
5. A spike result never changes a locked decision (`AGENTS.md` §5); a contradiction is recorded in the spike file as a specification defect.
6. All Web spikes share one test page, `/apps/web/spike.html`, built from production modules and excluded from the production bundle.

### 1.2 Web spikes

| Spike ID | Target Platform / API | Exact Test Procedure | Quantitative Pass Criterion | Deterministic Fallback Action |
|---|---|---|---|---|
| **S-W1** | Web · Chrome stable · `firebase` ≥ 12.14.0 · `firebase/ai` on-device | On PC Ryzen 7 and MacBook M5: (1) call `checkEnvironment()`; (2) from a button click call the instance method `model.initializeDeviceModel(cb)` and log every callback argument; (3) make one `ONLY_ON_DEVICE` `TriageV1` call and read `response.inferenceSource`; (4) repeat (3) 10 times; (5) make 10 calls with `systemInstruction` set and the in-prompt instruction block deleted, on a prompt whose correct output depends on the instruction; (6) record the TypeScript type exported for the hybrid parameters in the pinned typings | (a) readiness reaches `available`; (b) `inferenceSource === "ON_DEVICE"` on **10/10** calls; (c) progress callback shape recorded; (d) whether `systemInstruction` is honoured recorded (informative); (e) exported type name recorded | (a/b) fail on MacBook M5 → README states "on-device model not available" for it; PC Ryzen 7 stays the gated Web device. Fail on PC Ryzen 7 → retry on Chrome Beta with ≥ 22 GB free disk; if still failing at the end of Phase 0, `web_chrome_nano` is not benchmarked, Web runs as `NO_LOCAL_MODEL`, and only the Android profile is gated. (c) unknown → indeterminate progress bar. (d) not honoured → the in-prompt block (always present) is relied on |
| **S-W2** | Web · key order under `responseConstraint` | Run `VerdictV1` 50 times on DEV pairs; parse the raw text with a streaming JSON tokenizer; record the top-level key order | **50/50** outputs in the order `s01 → s02 → s03 → s04` | Prefixed keys stay; the L0 key-order check forces `NEI_SILENT_ESCALATE` on any violation. If the violation rate is > 10 %, the prompt gains the line "Output keys MUST appear in the order s01, s02, s03, s04" **before** `l0-freeze-a` (no benchmark run precedes the freeze) |
| **S-W3** | Web · `inputQuota`; `omitResponseConstraintInput`; Stage 1 token ceiling | (1) Create one Prompt API session and read `inputQuota`; (2) per schema, call `measureInputUsage()` on 30 representative prompts with and without the schema text, including **10 Stage 1 prompts with 80-word sentences** (numbered `WORDS` lists); (3) pass `omitResponseConstraintInput` through the Firebase on-device prompt options and compare prefill time over 20 calls each way | (a) `inputQuota` readable; (b) per-schema input tokens recorded and the Stage 1 ceiling set to the measured 80-word maximum + 10 % [04 › Token and output budgets]; (c) option forwarded: prefill time drops ≥ 10 % or a usage measurement confirms the schema is excluded | (a) assume 9,216 tokens. (b) not measurable → keep the specified ceiling and truncate sentences above 80 words as [04 › Token and output budgets] specifies. (c) not forwarded → the option is not passed and the schema counts toward the input budget |
| **S-W4** | Web · latency split, deadline, session reuse, abort | For `TriageV1`, `VerdictV1` (cap 40), `VerdictV1_cap30` and `B5CheckV1`: **30 sequential calls** each on one configuration singleton on PC Ryzen 7. Record per call total time, time to first token (streaming), output characters and estimated output tokens. Estimate `t_session` = first-call time − median of calls 2–30 on identical prompts; `t_prefill` from time to first token; `t_decode` from two prompts whose expected outputs differ in length. Compute **p99** per schema. Pass an `AbortSignal` (if accepted) and abort after 100 ms | (a) Stage 2 (cap 40) **p95 ≤ 6 s**; (b) `t_session` ≤ 1 s recorded (informative); (c) whether per-call abort works recorded; (d) **`l1_deadline_ms` = `max(20,000, 2 × p99)`** per schema written to Remote Config and the bundled defaults (D-28) | (a) fail → `reasoning_word_cap = 30` becomes the **calibrated variant** of `web_chrome_nano` (pre-decode; decided before `l0-freeze-a`), R1-E runs with it, latency re-measured. (b) > 1 s → no schema change; multi-reference clauses run one Stage 2 call per reference in sequence, latency reported. (c) unavailable → discard-on-arrival only [04 › Queue semantics]. Published latency is the measured p50/p95 with device and Chrome version |
| **S-W5** | Web · `pdfjs-dist` ≥ 4.2.67 hidden-text guard | Load 3 test PDFs (white text on white, render mode 3 text, 1 pt text) through `ingest.worker.ts`; inspect `getTextContent()` items and operator lists for text render mode and fill colour | Render mode **or** fill colour available for text items; all three hidden-text cases dropped and recorded | Guard uses only font height < 2 pt and out-of-view-box checks [03 › User-provided PDF (reference full text)]; the README states that invisible-render-mode text is not detected in imported PDFs; the sanitizer still runs on all text |
| **S-W6** | Web · production CSP + Trusted Types | Deploy the `preview` build target (production policy + `; report-to csp` + `Reporting-Endpoints` pointing at the staging-only `cspReportStaging`) to a Firebase Hosting **preview channel of `toulmin-staging`**. With DevTools and the staging reporting endpoint, exercise: app load through the hashed bootstrap loading the entry module through `toulmin-loader` under `'strict-dynamic'`; reCAPTCHA Enterprise App Check token (record the names of any Trusted Types policies it creates); anonymous sign-in; a callable to each function; Vite module workers through `toulmin-worker`; the pdf.js worker; the Blob-URL grounding iframe with a real L2 response; the `/rw` snapshot download with the bucket CORS. Then repeat app load, App Check and the grounding iframe on the **production** site with DevTools open | **Zero** CSP or Trusted Types violations across 3 full runs on staging; no `srcdoc` attribute anywhere in the DOM (mutation-observer test); `index.html` has no external `<script>` tag; **zero** console violations on production; `tools/csp-hash.ts --verify` confirms the two policies differ only by the reporting suffix [05 › Staging preview CSP reporting] | Add only the exact host, path or Trusted Types policy name that the violation report names, re-test, and record the change. `'unsafe-inline'` for scripts, `'unsafe-eval'` and wildcard hosts are never added. If module imports are blocked, emit a single-chunk entry (`inlineDynamicImports`) and keep workers as separate entries |
| **S-W7** | Web · ThinkPad (no qualifying hardware) | Clean Chrome profile on the base URL: (1) the `checkEnvironment()` reason is shown on the consent class A card; (2) Confidential → open the Sample Manuscript → only L0 results and reference checks appear, and the network log shows no AI Logic request; (3) Standard → "Use cloud fallback for this document" → Stage 1 and Stage 2 use `PREFER_ON_DEVICE` and return `inferenceSource === "IN_CLOUD"`; ledger provenance `Cloud`; paragraph cadence applies | All three observations true | If the ThinkPad unexpectedly has a usable model, run the same flow in a Chrome profile with the on-device model component deleted, and document it in the README |
| **S-W9** | Web · `PREFER_IN_CLOUD` *Find alternative sources* | Configure `PREFER_IN_CLOUD` with `inCloudParams.tools = [{ googleSearch: {} }]`, `responseSchema: AltSourcesV1` and `onDeviceParams.promptOptions.responseConstraint: AltSourcesV1`; 10 calls online and 10 with the network disabled in DevTools | Online **10/10** `IN_CLOUD` with valid JSON; offline **10/10** `ON_DEVICE` with valid JSON | Online uses `ONLY_IN_CLOUD` with search; offline uses `ONLY_ON_DEVICE` library ranking; the README describes the feature as two modes [04 › `PREFER_IN_CLOUD` — *Find alternative sources* (`AltSourcesV1`)] |
| **S-W10** | Web · constrained-decoding limits, runaway output, on-device slot release (PC Ryzen 7) | (a) **30 adversarial prompts** built to exceed `maxLength`, `maxItems` and `enum` of `TriageV1`, `VerdictV1` and `B5CheckV1` (10 each) with `responseConstraint`; validate every output. (b) **10 runaway-repetition prompts**; record termination, duration and output length. (c) Start a `generateContentStream` call on a runaway prompt; stop reading after the per-schema character limit or 5 s; immediately dispatch a short `ONLY_ON_DEVICE` `TriageV1` call and record when it produces tokens; repeat 10 times, and 10 times abandoning a non-streaming `generateContent` promise. (d) For each abandoned call, record the time until its underlying promise settles. (e) Repeat (c) 10 times after a client-side output cut and 10 times after an SDK error (invalid schema), so slot release is measured for **every** early stop. (f) Record the longest abandonment-to-settle time over all runs | (a) **30/30** respect the constraints; (b) every call terminates within the L1 deadline (20 s); (f) every settle < **120 s** (`l1_settle_ceiling_ms`). **Result:** Remote Config **`l1_slot_release = IMMEDIATE`** only if in **≥ 29/30** runs of each of (c), (e)-cut and (e)-error the next call starts within 1 s of the early stop; otherwise **`ON_SETTLE`** (default) | (a) violation → the streaming character limit and L0 schema validation (always on) enforce the schema; the violation rate is reported. (b) a call > 20 s → the deadline and `LOCAL_STALLED` of D-28 apply; the README states the behaviour. (c)/(e) `ON_SETTLE` → the scheduler waits for the stopped call's promise to settle before the next L1 dispatch, for every early stop; the 60 s `LOCAL_STALLED` pause counts from that settle. (f) a settle > 120 s → the ceiling stays 120 s and such a call ends on-device use for the session (`LOCAL_LOST`) |

### 1.3 L2, replay protection, cost and model-generation spikes

| Spike ID | Target Platform / API | Exact Test Procedure | Quantitative Pass Criterion | Deterministic Fallback Action |
|---|---|---|---|---|
| **S-L2** | Web · L2 single call (`ONLY_IN_CLOUD` + `googleSearch` + `responseSchema`) on `gemini-3.8-flash` through the Firebase AI Logic gateway | 10 `l2Adjudicate` calls with `maxOutputTokens = 2048` on 10 DEV claims that need search; record JSON validity against `L2Verdict`, presence of `groundingMetadata.searchEntryPoint.renderedContent`, `groundingChunks`, `webSearchQueries`, latency, `usageMetadata` (including **`thoughtsTokenCount`**) and `finishReason`. **Thinking:** 5 calls with `thinkingConfig: { thinkingLevel: "LOW" }` and 5 without `thinkingConfig`; record acceptance or the error text. `thinkingBudget` and `MINIMAL` are never tried. **Cost:** 10 `l2AdjudicateProvided` calls (no tools) on the same claims; record `usageMetadata` of both adjudicators and the number of grounding queries per grounded call | **≥ 9/10** valid JSON **and** ≥ 9/10 with non-empty `searchEntryPoint` and `groundingChunks`; **no `finishReason = MAX_TOKENS`** at 2,048; thinking result recorded; measured per-call cost of **both** `l2Adjudicate` and `l2AdjudicateProvided` recorded and written to `tools/cost-model.ts` | Grounding missing with a schema → the **single-call text-JSON fallback** [04 › Single-call text-JSON fallback (only if `S-L2` fails)] (`L2_MODE = "TEXT_JSON"`); no second model call ever processes grounded output. `thinkingLevel: "LOW"` rejected → omit `thinkingConfig`. `MAX_TOKENS` observed → raise the cap to 4,096. Cost above the assumed range → lower the pool sizes in `/global/state.pools` by the same factor and recompute the cost scenarios [05 › Cost scenarios (`tools/cost-model.ts`, prices `[I]` until `S-L2`)] |
| **S-RP** | Web, Android, iOS · AI Logic replay protection; App Check for Firebase Authentication; Authenticated-users mode | With replay protection enabled for AI Logic: (1) on each platform at the minimum SDKs (**Web ≥ 12.14.0, Android BoM ≥ 34.14.0 / App Check ≥ 19.1.0, Apple ≥ 12.2.0**), 20 AI Logic cloud calls with `useLimitedUseAppCheckTokens: true`; record success rate and **added latency p50/p95** against 20 calls with the setting off (staging); (2) capture one request with its token and replay it with `curl`; (3) record **reCAPTCHA Enterprise assessments per L2 call**; (4) **App Check for Firebase Authentication (Preview)**: enforce in staging, then 10 scripted anonymous sign-ups without a token and 10 from the real Web client; (5) **Authenticated-users mode**: confirm an anonymous-auth ID token is accepted by AI Logic and a request without an ID token is rejected; (6) **large-request test (staging only)**: from a modified client, one request with ≈ 1 million input tokens and one with the largest accepted payload; record the maximum accepted size, the rejection status and the billed tokens | (1) **≥ 19/20** success per platform; (2) replay **rejected**; (3) assessments recorded; (4) **10/10** scripted sign-ups rejected and **10/10** real sign-ups accepted; (5) both behaviours confirmed; (6) recorded (the residual per-request exposure of [05 › Defence-in-depth cost guardrails and operational monitoring runbook] becomes a measured number) | (1) fail on one platform → that platform's cloud features stay disabled until the defect is resolved; replay protection stays enforced (D-18). (2) replay accepted → critical; lower the anonymous L2 pool to 5 per UID and 20 per day globally until the defect is resolved. (4) enforcement unavailable or blocks real clients → leave it unenforced, keep the Authentication sign-up rate limit at its lowest setting, lower the anonymous L2 pool to 5 per UID, 10 per network and 20 global per day, and record the residual risk in the README. (5) anonymous tokens rejected → disable the mode (anonymous use is required by D-17) |
| **S-SC** | Project · service spend caps, budgets, breakers, cap behaviour | (1) Set service-level spend caps **Firebase AI Logic US$60** and **Cloud Functions US$40** per month; (2) record the documented cap behaviour (failing requests, error, resume time after a lift); (3) create the **4 budgets on gross cost** (credits excluded): `gross` US$110 (50/80/100 % actual + 100 % forecast), `ai-logic` US$60 (25/50/75/90/100 %), `uncapped` US$20 (Firestore, Storage, reCAPTCHA Enterprise; 50/80/100 %) → topic `billing-alerts`; `recaptcha` US$10 (100 %) → topic `recaptcha-alerts`; (4) publish test messages for each budget and threshold and confirm the actions of [05 › `budgetBreaker` and `recaptchaBreaker`], including **`recaptchaBreaker`** disabling the staging Web key; (5) record the payload field names; (6) record the grounding price and any free allowance for `gemini-3.8-flash`; (7) **in staging**, set a Cloud Functions cap of US$1, drive it to the cap with a load script, record client-visible errors and the Web behaviour, lift the cap and measure recovery time | (1)(3)(4)(7) configured and working: pool reductions honoured by `quotaGuard` within **60 s**; `kill_switch_cloud` and `hardStop` set at their thresholds; the staging reCAPTCHA key disabled within **10 minutes**; (2)(5)(6) recorded; service filters exist for each budget or the absolute-amount fallback of 05 is recorded | (1) a cap unavailable for a service → that service relies on the breakers and pools; the README states this; the anonymous L2 pool is lowered to 5 per UID per day. (5) unknown fields → `ratio = costAmount / budgetAmount`. (6) unknown → assume US$14 per 1,000 queries with no free allowance. (7) the paused-service banner does not appear → blocking defect, resolved before the Phase 3 exit gate |
| **S-N4** | Web, Android · model generation per device | PC Ryzen 7 and MacBook M5: open `chrome://on-device-internals`; record model name and version, Chrome version and component version. Xiaomi 15T Pro: record `getBaseModelName()` under `STABLE` and the AICore version code. Screenshots committed | Values recorded for each device | README states "model generation not readable on this device" for a device without a value; the Devpost forum question (D-25) includes the recorded values |

### 1.4 Android and iOS spikes

| Spike ID | Target Platform / API | Exact Test Procedure | Quantitative Pass Criterion | Deterministic Fallback Action |
|---|---|---|---|---|
| **S-A1** | Android · `PREVIEW → STABLE` cascade; Airplane Mode | Fresh install of the release `bundledSample` build on the Xiaomi 15T Pro; run `resolveTier()` and log each tier's error; switch to **Airplane Mode** and run 10 `TriageV1` calls; record the exact `OnDeviceConfig` / `OnDeviceModelOption` names in the pinned SDK | Resolved tier recorded (`PREVIEW` expected to fail with AICore error 606); Airplane Mode: `STABLE` **10/10** with `inferenceSource = ON_DEVICE` | `STABLE` fails offline → `android_aicore_stable` is not benchmarked; the Pocket Ledger keeps OCR, deterministic Select-row matching and L0; O1 and Stage 2 are disabled; the phone demonstration shows deterministic printed-source support only. Names differ → use the builder API of the pinned SDK |
| **S-A2** | Android · `@Generable` + KSP + `generateObject` | Compile `TriageV1`, `VerdictV1`, `VerdictV1_cap30`, `B5CheckV1` and `O2PhysicalExtractV1` with **empty companion objects** and the KSP processor; call `generateObject(T.firebaseAISchema(), prompt)` 20 times per schema on device; decode; read `inferenceSource` from the result; record whether raw JSON is exposed and its key order; record the latest stable `firebase-ai`, `firebase-ai-ondevice` and `firebase-ai-ksp-processor` versions | Compiles; **20/20** decode per schema; nested lists and enums accepted; `inferenceSource` readable; versions **pinned in `gradle/libs.versions.toml`** | Flat schemas (`TriageFlatV1`, `VerdictFlatV1`, `O2PhysicalExtractFlatV1`) with L0 string validation; `generateContent` + `kotlinx.serialization` decoding if `generateObject` differs; description-only `@Guide` if range parameters are rejected |
| **S-A3** | Android · latency, output tokens, quota errors, deadline (Dimensity 9400+) | 30 sequential calls per schema under `STABLE`, including 10 Stage 1 calls with 80-word sentences; record total time, latency split, output characters, estimated tokens and p99 per schema; 200 back-to-back calls to provoke quota errors and record their exact codes | Stage 2 **p95 ≤ 10 s**; output caps computed by [04 › Token and output budgets]; **`l1_deadline_ms` = `max(30,000, 2 × p99)`** per schema written to the bundled defaults (D-28); long-term quota error codes recorded | p95 > 10 s → Stage 2 on Android runs only on demand (O1/O2/O3), never per sentence. Unknown quota codes → every non-`BUSY` quota error is treated as long-term |
| **S-A4** | Android · bundled ML Kit OCR offline; capture gate; Select-row geometry; `PdfRenderer` | Airplane Mode on first run after install: OCR the 30 MS-O2 photos, the 6 capture-gate photos and the 4 short-table photos; check that `Text.Line.angle` and `cornerPoints` are populated; compute the per-photo line-angle IQR and the number of qualifying lines (≥ 3 elements); run Select-row [06 › O2: Check against a printed page] on 10 photos with gold taps, of which **≥ 3 have two-row headers**; open a text PDF with `PdfRenderer` and query the page text APIs | OCR works offline; Select-row accuracy **≥ 0.90** on the 10 photos (per-table mean, §4.10); the **3° IQR gate** rejects ≥ 5 of the 6 capture-gate photos and ≤ 1 of the 10; the 4 short-table photos have **< 4 qualifying lines**, skip the IQR test, and are all accepted (absolute median angle ≤ 20°); `angle` or `cornerPoints` populated; `PdfRenderer` text availability recorded | Accuracy < 0.90 → Select-row stays the only O2 flow; the full O2 evaluation (§4.10) still runs. Gate rejects > 1 of the 10 → the IQR threshold is raised in 0.5° steps up to 4.5° (pre-decode; before `l0-freeze-a`) and re-tested. `angle` missing → deskew from `cornerPoints`. No `PdfRenderer` text → render to `Bitmap` and OCR |
| **S-A5** | Android · `bundledSample` APK (zero network) + Room FTS4 | (a) Sideload the release-signed `bundledSample` APK on the Xiaomi 15T Pro in **Airplane Mode**; run O1, O2, O3 and O4 on the bundled sample and one local file import (Share Sheet); capture a **network trace** of the whole session (PCAPdroid or an equivalent on-device VPN capture, plus `adb shell dumpsys netstats` before and after); confirm in the result cards that each check returned `inferenceSource = ON_DEVICE` through `Firebase.ai(...)` with `InferenceMode.ONLY_ON_DEVICE`. (b) Repeat (a) with Wi-Fi **on** and the capture running, to prove that the build makes no request even when a network exists. (c) Create the Room **`@Fts4`** evidence entity and run 20 queries against the bundled evidence cache | (a) every check succeeds offline with `ON_DEVICE`; (b) the trace contains **zero** outbound connections from the app UID (no DNS, no TCP, no QUIC), and no App Check, Authentication, Remote Config, Firestore, Functions or Storage call is attempted; (c) the 20 queries return the expected rows | (a) the SDK refuses to initialize without network → the README states the exact error, the APK is not distributed, and Android is described as not verified. (b) any outbound connection → blocking defect; the APK is not distributed until the trace is clean. (c) FTS4 failure → BM25 over a plain Room table in memory. **No debug token is ever created or distributed** |
| **S-P2** | iOS · text-JSON parse rate | 50 Stage 2 checks through `AppleL1` in Standard mode on the text-JSON path [04 › iOS Thin Client (iPhone 13 Pro Max) — `apps/ios/ToulminL1/AppleL1.swift`] | **≥ 45/50 (≥ 90 %)** valid after at most one repair | When parsing fails twice, the iOS client shows only the cloud result text and its verdict; iOS stays a fallback demonstration |
| **S-P3** | iOS · `HybridModel` fallback on iPhone 13 Pro Max | Check readiness (expect unavailable); 10 calls in Standard mode after consent class A; record `rawResponse.modelVersion` | **10/10** responses without error; all classified `IN_CLOUD`; exact `modelVersion` strings recorded | Call the secondary cloud model directly when readiness is unavailable, with the same UI contract |
| **S-P4** | iOS · App Attest / DeviceCheck | Obtain an App Check token with App Attest on the iPhone 13 Pro Max; make one AI Logic cloud call; repeat with the DeviceCheck provider | Valid token; call accepted | DeviceCheck provider; if both fail, the iPhone is shown only in the README |

### 1.5 Backend checks `BE-1`–`BE-5`

Recorded in `/docs/spikes/BACKEND.md`. `BE-1`–`BE-4` complete in Phase 0 (in `toulmin-staging` unless stated); `BE-5` completes in Phase 2.

| Check ID | Target | Exact Test Procedure | Quantitative Pass Criterion | Deterministic Fallback Action |
|---|---|---|---|---|
| **BE-1** | **Client-IP derivation** for per-network limits | From two networks, send requests to a test callable with **forged `X-Forwarded-For`** values (one, two and five entries; private and public addresses). Record the full header as received, `request.rawRequest.ip`, and which entry equals the real client address | The entry appended by Google's front end is identified as a constant index from the right; `functions/src/common/clientIp.ts` implements it; forged entries **never** change the network hash (10/10 forged cases) | Index cannot be determined → per-network limits are disabled; per-UID and global limits stay; the anonymous L2 global limit is lowered to 20 per day and the README states it |
| **BE-2** | **Bibliographic and licence sources** | (a) OpenAlex OR-filter limit and list-call pricing with the API key; (b) Crossref polite-pool limits and retraction field names (`relation`, `updated-by`); (c) Retraction Watch dataset URL and format through Crossref; (d) licence fields of Europe PMC (JATS `<license>`) and Unpaywall (`best_oa_location.license`) on 20 known DOIs; (e) arXiv licence via OAI-PMH **`https://oaipmh.arxiv.org/oai`** `GetRecord` with `metadataPrefix=arXivRaw`, parsing `<license>`, for 20 arXiv IDs with known licences (10 CC-BY, 4 CC-BY-SA or CC0, 6 arXiv non-exclusive), through `/global/arxivLock` from 3 concurrent instances | (a)–(c) values recorded; (d) licence fields parsed correctly on ≥ 19/20 per source; (e) **20/20** licences parsed correctly and the 3 s spacing held across instances | (a) singleton `GET /works/doi:{doi}`. (b) the default rates of 05; Retraction Watch snapshot plus OpenAlex `is_retracted`. (c) OpenAlex `is_retracted` and Crossref relations only. (d) a source without a reliable licence field is never used for caching. (e) arXiv full text is fetched for the request but **never cached server-side** |
| **BE-3** | **App Check for Firebase Authentication (Preview)** and **consumed-token flag** | (a) In production, confirm enforcement is ON after `S-RP` item (4) passed in staging; repeat 5 scripted anonymous sign-ups without a token; confirm the Web client still signs in. (b) For callables with `consumeAppCheckToken: true` (`quotaGuard`, `redeemJudgeCode`), replay a captured request with the same limited-use token on the emulator and on staging, and read `request.app.alreadyConsumed` | (a) 5/5 scripted sign-ups rejected; real client accepted; (b) `request.app.alreadyConsumed === true` on every replay and the handler rejects with `REPLAYED_TOKEN` | (a) enforcement breaks a real client → turn it off, apply the `S-RP` item (4) fallback, record it in the operator runbook. (b) flag absent → server-side nonce guard: the client sends a random 128-bit nonce; the function stores `sha256hex(nonce)` at `/global/nonces/{hash}` with `expireAt = now + 10 min` and rejects a repeated nonce |
| **BE-4** | **Private `oaParse` IAM** and **`doi.org` handle API** | (a) Deploy `oaParse` / `oaParseJudge` with `invoker = oafetch-sa` only: a call from `oaFetch` (and `oaFetchJudge`) succeeds; an unauthenticated `curl`, a call with an end-user Firebase ID token, and a call from another service account all receive **HTTP 403**; `oaparse-sa` has no project IAM bindings and no secret accessor; a test build that attempts an outbound HTTP request from the parser fails CI; 12 concurrent `oaFetch` requests queue on the per-instance parse semaphore without parser `429` reaching the client. (b) `GET https://doi.org/api/handles/{doi}` for 10 registered DOIs (including 3 SICI DOIs with `<`, `>`, `;`) and for the sample's non-existent DOI | (a) all checks as stated (403 on 3/3 unauthorized callers); (b) registered DOIs return **`responseCode = 1`** (or **`200`**: handle exists without values of the requested type) and the non-existent DOI returns **`responseCode = 100`**; mapping: 1 and 200 → registered (`NOT_INDEXED` when no index has the record), 100 → `DOI_NOT_FOUND`, anything else → `UPSTREAM_UNAVAILABLE` | (a) any check fails → `oaParse` is not deployed; `oaFetch` serves metadata and abstracts only and the README states that open-access full text is unavailable. (b) `HEAD https://doi.org/{doi}` without following redirects: 404 → `DOI_NOT_FOUND`; 301/302/303 → registered |
| **BE-5** | **Direct VPC Egress for `oaParse` at zero fixed cost** | In `toulmin-staging`, enable Direct VPC Egress for the parser's Cloud Run functions service (no Serverless VPC Access connector, no always-on instance, no reserved static address) with egress "all traffic" and a deny-all egress firewall rule; after 24 h, read the billing SKU list and the Cloud Billing report; send an outbound request from the parser and a call from `oafetch-sa` | **No fixed charge** in the billing report; the parser's outbound request fails; the `oafetch-sa` call succeeds | Any fixed charge, or Direct VPC Egress unavailable → keep default egress; the parser stays isolated by `oaparse-sa` (zero roles, zero secrets), the absence of HTTP clients in its code, and `pdfjs-dist` ≥ 4.2.67 with `isEvalSupported: false`; the README and `SECURITY.md` describe it as **"separated from credentials"**, never as network-isolated. **A Serverless VPC Access connector is never provisioned** |

### 1.6 Configuration checks (Phase 2)

| Item | Check | Fallback |
|---|---|---|
| Remote Config fetch interval | The Web client uses `minimumFetchIntervalMillis = 3,600,000`, does not await the fetch at boot, and activates real-time updates where offered | None needed; every cost and judge protection is enforced on the server |
| Server-side kill switch | With `/global/state.killSwitch = true` and a client that never fetched Remote Config, `quotaGuard` refuses every lease with `KILL_SWITCH` within 60 s | Blocking defect |
| AI Logic per-user rate limit | The console value is **30** requests per minute (allowed range 20–30) | A value below 20 is raised back to 30 |
| Template-only mode | Disabled | Blocking defect |

### 1.7 Phase 0 spike exit criteria

1. A record exists for every spike of §1.2–§1.4 and for `BE-1`–`BE-4`, each PASS or FAIL with its fallback.
2. `firebase` (Web), the Firebase BoM and `firebase-ai*` (Android) and `firebase-ios-sdk` are pinned at or above the replay-protection minimums (Web 12.14.0, Android BoM 34.14.0 / App Check 19.1.0, Apple 12.2.0).
3. Spend caps (US$60 / US$40), the four budgets, replay protection, App Check enforcement for AI Logic, Firestore, Storage and callables, the per-user 30 RPM and the project 60 RPM are configured in `toulmin-prod`; template-only mode is off.
4. Remote Config and the bundled defaults hold `l1_slot_release`, `l1_settle_ceiling_ms` and `l1_deadline_ms` per schema from `S-W4`, `S-W10` and `S-A3`.
5. Every pre-decode marker is resolved in `/docs/spikes/RESOLUTION.md`.

---

## 2. Evaluation Datasets, Disjointness & Tiered Freeze / Replay Protocol

### 2.1 Datasets

All files live under `/eval-harness/data/`. Dataset file names are opaque artifact names (`AGENTS.md` §3.4).

| Dataset | File | Size | Purpose | May be used for tuning? |
|---|---|---|---|---|
| **DEV** | `dev_v2.jsonl` | **45 pairs** (15 S / 15 C / 15 N) | Prompt iteration; reporting-only ablations; `bm25_min_cov` calibration (§3.11) | **Yes** (only this set) |
| **R1-E** | `r1e_v2.jsonl` + `r1e_groups_v2.json` | **150 pairs** (50 S / 50 C / 50 N) in 5 groups of 30 | Path A gate and support gate (§3.7) | No |
| **PROBE** | `probe_pool_v2.json` → `probe/probe_set_p2.json` | **10 probe pairs** selected from a **40-pair held-out pool** (16 S, of which 6 `S-GRAY` / 12 C / 12 N); each selected set contains 2 `S-GRAY` SUPPORT pairs | Calibration Probe [04 › Probe set] | No |
| **MS-B123** | `ms_b123_v2.jsonl` | **60–80 sentences** (planned 60), including **24 gold uncited empirical sentences**; B2 agreement subsample of 30 items | CF-1 B1, B2, B3; B4 flag precision (§4) | No |
| **MS-B5** | `ms_b5_v2.jsonl` | **40–50 numeric pairs** (planned 40: 16 `INCONSISTENT`, 12 `CONSISTENT_DIFFERENT_SUBSET`, 12 `DIFFERENT_QUANTITY`) | CF-1 B5 | No |
| **MS-O2** | `ms_o2_v2/` | **30 photos** (20 **laser-printed tables**, 10 **bound journal pages or photocopies**), 3 target rows each; plus 6 capture-gate photos and 4 short-table photos | O2 Select-row, capture-gate and grid evaluation (§4.10–§4.11); CF-1 O2 | No |
| **MS-SAN** | `ms_san_v2.jsonl` | **500 real CC-BY abstracts** (≥ 5 disciplines; ≥ 40 with scientific Greek such as `TNFα`, `IL-1β`, `NF-κB`, `μm`) | Sanitizer false-positive gate (§4.12) | No |
| **RT-INJ** | `rt_inj_v2.jsonl` | **20 synthetic injected abstracts**, plus a 6-item folded-text supplement (`RT-INJ-F`: mathematical alphanumerics, circled letters, combining marks) | Red-team detection (§4.12) | No |
| **PREPRINTS** | `preprints_v2.json` | 3–5 real CC-BY open-access preprints with sources | Real-preprint demonstration (§4.13) | No |
| **R1-E-L2** | `r1e_v2.jsonl` (same pairs) | 150 pairs, 1 cloud call each | Reporting-only evaluation of `l2AdjudicateProvided` (§3.10) | No |

### 2.2 Disjointness (MUST)

No claim text, abstract, sentence or reference DOI may appear in more than one of DEV, R1-E, PROBE pool, MS-B123, MS-B5 and MS-SAN. `eval-harness/src/disjointness.ts` compares SHA-256 of `normLower` text and lowercased DOIs and fails the build on any overlap (**AC-EVAL-01**). With `--annotators` it also checks the annotator-independence record against the git authors of `r1e_v2.jsonl` and `/packages/prompts/` (§3.4 rule 2).

### 2.3 Tiered freeze rule

The calibration runs depend on two separately hashed packages and one locked baseline set (D-30):

| Package | File list | Hash | Contents | Frozen at |
|---|---|---|---|---|
| **Tier A** (pre-decode) | `/freeze/tier_a.txt` | `tier_a_hash` | `norm()` and `norm_table.json` (incl. confusables), `unicode_15_1.bin`, `porter_v1.json`, `wordlist_en.txt`, `bm25_min_cov.json`; pre-masking, LaTeX substitutions, section labels; segmentation, the citation scanner (Rule 2 interval shape), key resolution, the clause partitioner and claim text; the value grammar and units; tokenizers, BM25, claim coverage and selection; evidence chunking and the sanitizer; prompt assembly, prompts `p2.1` and their schemas; **every annotation set** (gold labels, κ subsample, PROBE pool, CF-1 items, O2 photos); the run-manifest format | git tag **`l0-freeze-a`**, end of Phase 0 |
| **Tier B** (post-decode) | `/freeze/tier_b.txt` | `tier_b_hash` | key-order check, JSON parsing and schema validation of decoded outputs; the anchor validator (including `NO_DIFFERENCE_SIGNAL` and the refined L2 rule) and reasoning↔verdict check; gates, Wilson and bootstrap statistics, Holm and `checkAuthority`; the reducer, the Coverage Meter and routing publication | changes only through replay (§2.5) |
| **CF-1 baselines** | `/freeze/cf1_baselines.txt` | `cf1_baseline_hash` | triage baseline, BM25 top-1 alignment baseline, three-class B5 baseline, Select-row value matching | locked **before the first CF-1 run** (§2.6) |

Hashes are computed by `tools/freeze-hash.ts`: SHA-256 over the concatenation, in file-list order, of `path + "\0" + sha256hex(bytes) + "\n"` for every listed file.

**Run manifest.** Before any R1-E, PROBE, CF-1, O2, DEV or R1-E-L2 run, the harness writes `/eval-harness/runs/{runId}/manifest.json` with `tier_a_hash`, `tier_b_hash`, `cf1_baseline_hash` (CF-1 runs), the git commit, the SHA-256 of every dataset file, `samplingMode`, the browser or AICore version, `baseModelName`, `calibratedVariant` and the seeds used.

**Validity.** A run is **valid** only if its `tier_a_hash` equals the hash of `l0-freeze-a` (**AC-EVAL-04**). A Tier A change after the freeze invalidates every run that used the old hash; until such runs are repeated, the affected profiles are published as Path B with every task and support verdict `advisory`.

### 2.4 Sampling rule and calibrated variant rule

- **Sampling rule (MUST).** No sampling parameters are set on any platform, in the benchmark or in production. The Web manifest records `"samplingMode": "browser_default"` with the full Chrome version (or the verbatim `samplingMode` value a Chrome version exposes); the Android manifest records `"samplingMode": "generation_config"` with the `generationConfig` values sent, the AICore `versionCode` and `baseModelName`. Results of different `samplingMode` values are never pooled.
- **Calibrated variant rule (MUST).** R1-E runs exactly one Stage 2 variant per profile: `VerdictV1` with the default reasoning cap of **40 words** (D-03), unless `S-W4` (Web) or `S-A3` (Android) set the cap to 30 as the latency fallback before `l0-freeze-a`. The manifest records `calibratedVariant = { schemaId, reasoningCap }`; `publish_routing.ts` copies it into `routing_table`. Every other variant is advisory in production (D-08).

### 2.5 Tier B replay (`tools/replay.ts`)

**Input:** a run directory `/eval-harness/runs/{runId}/` (manifest and per-call logs, §3.5) and a Tier B package identified by its `tier_b_hash`. Android runs are replayed by the same tool because the Android runner logs the same fields.

**Procedure:**
1. Verify that the run's `tier_a_hash` equals the hash of `l0-freeze-a`; otherwise stop with **`TIER_A_MISMATCH`**.
2. For every logged call, rebuild the validator input exactly from the log — inputs (`claimText`, `contextSentence`), `evidenceChunkIds`, `evidenceTexts`, `rawText` and `inferenceSource` — and re-run, with the new Tier B package: JSON parsing, the key-order check, schema validation, the anchor validator (`layer = "L1"` for on-device runs, `"L2"` for R1-E-L2) and the reasoning↔verdict check. No tokenizer, retrieval or prompt code runs (those are Tier A and their outputs are logged).
3. Recompute every downstream report: R1-E metrics and gates, PROBE selection, CF-1 metrics and authority (the baselines are read from the locked `cf1_baseline_hash` package and never changed by replay), O2 metrics, DEV ablation and R1-E-L2.
4. Write `/eval-harness/reports/replay/{runId}_{tier_b_hash[0:12]}.md`: every call whose validated verdict changed (old → new, with fail reason), every metric and gate outcome that changed, and the SHA-256 of every regenerated report and of the diff itself (**replay diff hash**).

**Rules:**
1. **No model call.** Replay makes no network request; CI runs it with the network disabled.
2. **Determinism.** Two replays of the same run directory with the same `tier_b_hash` produce byte-identical reports on any machine (**AC-EVAL-12**).
3. **Production equality.** The production build contains exactly the Tier A package of `l0-freeze-a`, the CF-1 baselines of `cf1_baseline_hash`, and the Tier B package whose hash is the last one recorded in `H4_DECISION.md`; `ci-ts.yml` and `ci-android.yml` fail otherwise.

### 2.6 Preregistration and first-look rule

1. **Baselines first.** The CF-1 deterministic baselines are **locked before CF-1 execution**: `/freeze/cf1_baselines.txt` and `cf1_baseline_hash` are committed before the first CF-1 run, and a pull request that changes a listed file afterwards fails CI. The power analysis (§4.3) is committed before the first CF-1 result.
2. **Permitted post-run Tier B changes.** After the first R1-E, PROBE, CF-1 or O2 run has logged `rawText`, a Tier B change is allowed **only** to correct an **objective specification defect** (a violation of this specification, a failing conformance or acceptance row, or a crash) or to apply a fix **motivated by DEV data**. A change motivated by R1-E, CF-1, PROBE or O2 outcomes is forbidden. Each permitted change is applied only through replay (§2.5), and its pull request carries the committed replay report and names the permitted reason.
3. **First-look reporting.** **First-look metrics** are the metrics computed by the Tier B package that was current when each run executed. `H4_DECISION.md` MUST report **both** the first-look metrics **and** the replayed metrics, in adjacent columns of the same tables, together with `tier_a_hash`, `cf1_baseline_hash`, every `tier_b_hash` used, and the **replay diff hashes**.
4. **After the decision record.** Once `H4_DECISION.md` is committed, a Tier B change is allowed only if its replay shows every gate outcome, task authority, `supportVerdicts`, `KAPPA_OK` and the PROBE selection identical to the recorded ones; the new `tier_b_hash` and its replay report are appended to `H4_DECISION.md`. Any other change is deferred until after `JUDGE_TIER_EXPIRY_EPOCH`.

### 2.7 `H4_DECISION.md` decision record

Generated by `eval-harness/src/reports/` at the end of Phase 1 and committed to `/eval-harness/reports/H4_DECISION.md`. Every metric table has the columns **first-look** and **replayed**.

1. Per gated profile: `RESULT_VALID`, `P̂` with its Wilson interval, `WilsonLB95`, `S` with its interval, `PP_pairs` and the resulting path.
2. Per gated profile: `P(π)` **and** `P_LB(π)` at π ∈ {0.08, 0.12, 0.18}.
3. Per gated profile: `P̂_S`, `WilsonLB95_S`, `PS_pairs`, `FSR_C`, `FSR_N`, the support-gate result (`supportVerdicts`) with the stated expectation of §3.7, and per-call precision.
4. The authority table per task and profile: Δ, unadjusted p, Holm-adjusted p with the sorted order, power, authority, and for B5 both `INCONSISTENT` precisions.
5. Per profile: the calibrated variant; `bm25_min_cov` with its retention report; `o2_grid_enabled`; `b4_counts_in_review` with `Precision_B4`; `l1_deadline_ms` per schema; `l1_slot_release`; `l1_settle_ceiling_ms`.
6. The selected PROBE set per profile (including its 2 `S-GRAY` pairs).
7. The demonstration variant: **Variant A** if any gated profile is in Path A, otherwise **Variant B** [08 › 2:40–2:45 Multi-Device Video Storyboard (Variant A & Variant B)].
8. The annotation outcome: κ with its interval, `S-GRAY` agreement, any targeted adjudication, and `KAPPA_OK`.
9. `tier_a_hash` (equal to the tag `l0-freeze-a`), `cf1_baseline_hash`, every `tier_b_hash` used and the final one, the SHA-256 of every report and of every replay diff report, and the `samplingMode` of every run.
10. An addendum, appended later and never changing items 1–9: the R1-E-L2 summary (§3.10), any Tier B change appended under §2.6 rule 4, and any routing re-publication after a Chrome or AICore update.

**Fallback rule.** If R1-E does not produce a valid result for a gated profile within Phase 1, that profile is published as Path B, every task `advisory`, support verdicts `advisory`, and Proof mode shows "Not measured on this device profile". A later valid run may be published to Remote Config only through a new commit of `H4_DECISION.md` and `publish_routing.ts --confirm`.

---

## 3. `R1-E` 150-Pair Calibration Benchmark, Non-Grounded `R1-E-L2` & DEV Measurements

### 3.1 Pair definition

Each pair is one JSON line:

```json
{
  "pairId": "r1e-0001",
  "group": 1,
  "gold": "S",
  "subtype": "S-PARAPHRASE",
  "domain": "biomedical",
  "claim": "Daily aspirin reduced the risk of first stroke by 17% in adults over 70.",
  "contextSentence": "In older adults, daily aspirin reduced the risk of first stroke by 17% [12].",
  "reference": { "doi": "10.xxxx/xxxx", "title": "…", "year": 2021, "license": "cc-by" },
  "abstract": "Full abstract text, non-empty, at least 4 sentences.",
  "abstractRedistributable": true,
  "goldEvidenceSentenceIdx": [3],
  "annotation": { "a1": "S", "a2": null, "a3": null, "inSubsample": false },
  "notes": ""
}
```

`group` ∈ 1..5 (§3.3); `gold` ∈ {`S`, `C`, `N`}; `domain` ∈ {`biomedical`, `other_science`}; `goldEvidenceSentenceIdx` indexes the L0 segmentation of `abstract` (`[]` for N).

### 3.2 Composition (exact quotas)

| Gold | Subtype | Count | Construction rule |
|---|---|---|---|
| **S** (50) | `S-PARAPHRASE` | 15 | Restates a finding of the abstract in different words; same direction and population |
| | `S-NUMERIC-EXACT` | 15 | Reports a number that appears in the abstract for the same quantity |
| | `S-SUMMARY` | 10 | Faithfully summarizes ≥ 2 abstract sentences (no new quantities) |
| | `S-GRAY` | 10 | Supported but in a realistic grey zone: **rounding** (abstract 17.4 %, claim "about 17 %") ×3, **relative vs absolute** change stated consistently ×3, **"halved" vs a 50 % reduction** ×2, **hedged claim** ("may reduce") supported by a positive finding ×2 |
| **C** (50) | `C-DIRECTION` | 12 | Opposite direction of effect |
| | `C-NUMERIC` | 12 | Different value for the same quantity: relative difference ≥ 20 %, or a different sign |
| | `C-NULL-INVERSION` | 12 | Abstract reports no significant effect; claim asserts an effect |
| | `C-NEGATION-OTHER` | 8 | Abstract states "X did not / was not / without …"; claim states the positive |
| | `C-SUBJECT-SWAP` | **6** | Same numbers and direction words, but the compared groups or the subject are swapped |
| **N** (50) | `N-RELATED-OUTCOME` | 20 | **HealthVer-style topically related**: same topic and population; the claimed outcome is not reported |
| | `N-FULLTEXT-ONLY` | 15 | Plausibly supported only by full-text details absent from the abstract |
| | `N-SCOPE` | 15 | Different population or setting, with no stated contradiction |

**Constraints:**
- **Domains: 60 % biomedical / 40 % other sciences** — exactly 30 S, 30 C, 30 N biomedical and 20 S, 20 C, 20 N from psychology, computer science, environmental science and economics; at least 6 of the 10 `S-GRAY` pairs are biomedical.
- **Abstracts:** English, ≥ 4 L0 sentences, ≤ 400 words.
- **CC-BY redistributability rule:** abstracts licensed `cc-by`, `cc-by-sa` or `cc0` are committed to the repository with `"abstractRedistributable": true`; every other abstract is fetched at run time by DOI, marked `"abstractRedistributable": false`, and never committed or published.
- **Claim style:** like an author's manuscript sentence, ≤ 40 words; the harness deletes the citation marker from `contextSentence`.
- **Construction variety:** at most 10 C pairs per edit template (template ID recorded in `notes`; checked by the harness).
- **Topical relatedness of N pairs:** the top claim coverage `cov` of each N claim against the units of its own abstract is ≥ the median top `cov` of the S pairs (**AC-EVAL-01**).
- **External-validity limit (stated in the README):** the pairs are constructed, not sampled from third-party citations; the benchmark measures the task as Toulmin defines it.

### 3.3 Production-like retrieval corpus

The 150 pairs form 5 groups of 30 (10 S, 10 C, 10 N each), stratified by subtype and domain. Each group simulates one manuscript:
- **Corpus of group g:** the abstracts of its 30 references plus **20 distractor abstracts** from the same domains (`r1e_groups_v2.json`) — **50 references**, a realistic bibliography size.
- **IDF and `avgdl`** are computed over all evidence units of those 50 references with the production tokenizer [02 › `tokBM25(x)`].
- **`EVIDENCE[0..4]`** for a pair is the production selection **restricted to the pair's own reference**: the conditional quantity-class bonus, the claim-coverage filter with the calibrated `bm25_min_cov` (a unit is discarded only if `cov < bm25_min_cov` and it shares fewer than 2 claim stems), the context-weighted query and unit shaping [02 › IDF-weighted claim coverage and the `bm25_min_cov` filter].

The benchmark therefore measures the end-to-end production path: retrieval, then L1, then the anchor validator.

### 3.4 Gold annotation protocol (dual-annotator)

1. Pairs are constructed with an intended label (`subtype`).
2. **Independence (MUST).** Annotators **A1**, **A2** and adjudicator **A3** are three different people; **none** constructed any R1-E pair or wrote or edited any prompt in `/packages/prompts/`. Their names and the files each touched are recorded in `r1e_annotation.md` and checked by `disjointness.ts --annotators`.
3. **A1** labels all 150 pairs `S`, `C` or `N`, blind to the intended label, following `/eval-harness/data/ANNOTATION_GUIDE.md` (the verdict definitions of the Stage 2 prompt applied to the abstract only).
4. **Purely stratified κ subsample.** A random subsample of **45 pairs** (seed `SEED_KAPPA_SUBSAMPLE`) is drawn from the **140 non-`S-GRAY` pairs**: **15 from each of A1's three labels** (a shortfall is filled from the other labels in the order S, C, N). **A2** labels these 45 pairs blind to A1 and to the intended label.
5. **Grey pairs outside κ.** A2 also labels the **10 `S-GRAY` pairs**, blind in the same way. Their agreement with A1 is reported separately and is **not** part of κ. For the `S-GRAY` stratum and for each grey subtype the report gives the number of pairs whose majority verdict (§3.6) was `C` and its **Wilson 95 % upper bound**; with zero such pairs: all 10 → **0.2775**; a 3-pair subtype (rounding, relative/absolute) → **0.5615**; a 2-pair subtype ("halved", hedged) → **0.6576**. Public statements about grey-zone false contradictions are limited to these bounds.
6. **Cohen's κ** over the 45 pairs (3 categories):

```
n_ij = number of pairs labelled i by A1 and j by A2,   n = 45
p_o  = Σ_i n_ii / n
p_e  = Σ_i (n_i· · n_·i) / n²          where n_i· = Σ_j n_ij,  n_·i = Σ_j n_ji
κ    = (p_o − p_e) / (1 − p_e)
95 % interval: 2,000 bootstrap resamples of the 45 pairs (SEED_BOOTSTRAP), percentile
```

7. **Requirement:** κ point estimate **≥ 0.70**; the interval is always reported and does not gate.
8. **Targeted adjudication when κ < 0.70** (no full 150-pair relabel):
   - the guideline is revised using **DEV examples only**;
   - the **target set** = every subsample pair on which A1 and A2 disagree, plus every R1-E pair whose `subtype` equals the subtype of at least one disagreed pair;
   - A1 relabels the target set blind; A3 adjudicates every target pair whose new A1 label differs from A2 (or from the intended label outside the subsample) under rule 9;
   - A2 labels a **new** purely stratified 45-pair non-`S-GRAY` subsample (seed `SEED_KAPPA_RESUBSAMPLE`), and κ is recomputed;
   - if κ is **still < 0.70**, the adjudicated labels stand, the report states "annotation agreement below target", **`KAPPA_OK = false`**, and **Path A and authoritative support verdicts remain disabled** for every profile from this R1-E run (`publish_routing.ts` enforces it).
9. **Gold assignment:** A1 = intended (and, for subsample and `S-GRAY` pairs, A2 = intended) → gold = intended. Otherwise A3 decides: agreement with intended → intended; agreement with A1 (and A2) → the pair is re-filed under that class and a substitute pair is constructed to keep 50/50/50; agreement with no one → discarded and replaced.
10. **Report** `/eval-harness/reports/r1e_annotation.md`: κ and its interval, the 3×3 A1×A2 confusion matrix, `S-GRAY` agreement and bounds, the target set and outcome of any targeted adjudication, the number of A3 adjudications and substituted pairs, and the independence record.

### 3.5 Execution protocol

| Item | Specification |
|---|---|
| Gated profiles | `web_chrome_nano` on **PC Ryzen 7 / Chrome stable**; `android_aicore_stable` on **Xiaomi 15T Pro / AICore `STABLE`** |
| Runs | 3 runs per pair per profile → **150 × 3 × 2 = 900 Stage 2 calls** |
| Order | Each run uses a seeded random permutation of the 150 pairs: run 1 seed **11**, run 2 seed **22**, run 3 seed **33** |
| Code path | Production `VerdictV1` configuration (calibrated variant) with `ONLY_ON_DEVICE`, prompts `p2.1`, the production L1 call path including the L1 deadline (D-28) and, on Web, the streaming character limit. After decode: key-order check → schema validation → anchor validator with `layer = "L1"` → reasoning↔verdict check. The **validated** verdict is recorded; a validation failure records `NEI_SILENT_ESCALATE` |
| Sampling | No sampling parameter set; the browser default `samplingMode` (Web) or the sent `generationConfig` (Android) is logged (§2.4) |
| Validity of a call | `inferenceSource` MUST be `ON_DEVICE`. A call returning `IN_CLOUD` or ending with a transient outcome (`DEADLINE`, `TRUNCATED`, `BUSY`, `NETWORK`, `OTHER`) is retried up to 2 times (after slot release, D-28); if still invalid it is recorded as `MISSING`. `LOCAL_STALLED` pauses the harness as it pauses production |
| Validity of a profile run | **`MISSING ≤ 2 %`** of the profile's 450 calls; otherwise **INVALID** and re-run |
| Logged per call (replay input) | `pairId, group, run, profile, claimText, contextSentence, evidenceChunkIds, evidenceTexts, promptText, rawText, parsedJson, keyOrderOk, schemaOk, anchorResult, anchorFailReason, verdictValidated, inferenceSource, outputChars, msTotal, transientReason, chromeVersion or aicoreVersionCode, baseModelName, samplingMode, promptSha256, schemaSha256, schemaId, reasoningCap, tier_a_hash, tier_b_hash` |
| PROBE | In the same session, each PROBE-pool pair runs **5×** per profile; the probe set is then selected by [04 › Probe set] |
| Informative profile | MacBook M5 Chrome MAY be run; never gated, never pooled |

### 3.6 R1-E Metrics

Per profile `p`; pairs `i = 1..150`; runs `r = 1..3`; validated verdict `v_{i,r} ∈ {S, C, N}` (from `SUPPORTED`, `CONTRADICTS`, `NEI_SILENT_ESCALATE`); gold `g_i`. A `MISSING` run is scored `N` (conservative; the number of pairs with at least one `MISSING` run is reported). The formulas are identical to [04 › Definitions (pair-level majority-of-3)] and are implemented once in `gate.ts` and in `/eval-harness/src/stats.ts`.

```
maj_i          = majority(v_{i,1}, v_{i,2}, v_{i,3}); all three different → N
PP_pairs_p     = |{ i : maj_i = C }|
TP_pairs_p     = |{ i : maj_i = C ∧ g_i = C }|
FP_S           = |{ i : maj_i = C ∧ g_i = S }|        FP_N = |{ i : maj_i = C ∧ g_i = N }|
P̂_p            = TP_pairs_p / PP_pairs_p                 (0 if PP_pairs_p = 0)
WilsonLB95_p   = lower bound of the Wilson 95 % interval for (TP_pairs_p, PP_pairs_p), z = 1.959964
S_p            = (1/150) · |{ i : v_{i,1} = v_{i,2} = v_{i,3} }|
R̂_p            = TP_pairs_p / 50     (displayed as "Found {TP_pairs} of 50 contradictions in our test set")
FCR_S          = FP_S / 50            FCR_N = FP_N / 50

# false-support side (support gate)
PS_pairs       = |{ i : maj_i = S }|
TS_pairs       = |{ i : maj_i = S ∧ g_i = S }|
P̂_S            = TS_pairs / PS_pairs                     (0 if PS_pairs = 0)
WilsonLB95_S   = lower bound of the Wilson 95 % interval for (TS_pairs, PS_pairs)
FSR_C          = |{ i : maj_i = S ∧ g_i = C }| / 50      (reported first among support metrics)
FSR_N          = |{ i : maj_i = S ∧ g_i = N }| / 50

# per-call precision (informative, never gated)
P̂_call_C       = |{ (i, r) : v_{i,r} = C ∧ g_i = C }| / |{ (i, r) : v_{i,r} = C }|     (likewise for S)
                 with a cluster bootstrap interval (B = 2,000 resamples of pairs, SEED_BOOTSTRAP)
```

**Stability interval `S_p`:** stratified cluster bootstrap over pairs within the strata S, C, N (50/50/50), **B = 2,000**, seed `SEED_BOOTSTRAP`, percentile [2.5, 97.5] with type-7 interpolation.

**Retrieval metrics** (on S and C pairs, whose gold evidence set is non-empty):

```
hit_i      = 1[ goldEvidenceSentenceIdx_i ∩ indexes(EVIDENCE[0..4]) ≠ ∅ ]
Recall@5   = mean over S and C pairs of hit_i            Recall@5_C = mean over C pairs
P̂ | hit    = TP_pairs restricted to hit_i = 1 / PP_pairs restricted to hit_i = 1     (retrieval-conditional precision)
R̂ | hit    = TP_pairs restricted to hit_i = 1 / |{ C pairs with hit_i = 1 }|
NEI split  = among S and C pairs with maj_i = N: hit_i = 0 ("retrieval miss") vs hit_i = 1 ("model abstained")
```

**Prevalence-adjusted precision** (reported, never gated; benchmark prevalence of C is 1/3):

```
TPR     = TP_pairs / 50                   TPR_LB = Wilson 95 % lower bound for (TP_pairs, 50)
FPR     = (FP_S + FP_N) / 100             FPR_UB = Wilson 95 % upper bound for (FP_S + FP_N, 100)
P(π)    = TPR·π / (TPR·π + FPR·(1 − π))                  ("—" when TPR = FPR = 0)
P_LB(π) = TPR_LB·π / (TPR_LB·π + FPR_UB·(1 − π))         conservative lower bound
π ∈ {0.08, 0.12, 0.18}
```

`P_LB(π)` is always printed next to `P(π)` (report, Proof mode, README). No rule ever sets precision to 1.00 when no false positive is observed: with 0 of 100 false contradictions, `FPR_UB = 0.0370`, so `P_LB < 1`.

**Also reported (informative):** the 3×3 confusion matrix of majority verdicts; the anchor-failure rate by `AnchorFailReason` (including `CLAIM_SPAN_MISMATCH`, `LOW_CLAIM_OVERLAP`, `NO_DIFFERENCE_SIGNAL`) and the C majorities lost to `NO_DIFFERENCE_SIGNAL` per C subtype; the `S-GRAY` majority breakdown with its upper bounds; deadline hits; p50/p95 latency and output characters; C precision by subtype (diagnostic).

### 3.7 Activation gate and support gate

```
RESULT_VALID_p ⇔ MISSING_p ≤ 2 % of the profile's calls

Path A active for p ⇔ RESULT_VALID_p ∧ P̂_p ≥ 0.70 ∧ WilsonLB95_p ≥ 0.50 ∧ S_p ≥ 0.60 ∧ PP_pairs_p ≥ 15
                      (∧ KAPPA_OK, enforced at publication)

Support verdicts authoritative for p ⇔ RESULT_VALID_p ∧ WilsonLB95(P̂_S) ≥ 0.80 ∧ PS_pairs ≥ 16 ∧ KAPPA_OK
```

Both gates are evaluated only by `gate.ts` (`evaluateGate`, `evaluateSupportGate`), with the integer comparison key `floor(x × 1e9 + 0.5)` on both sides of every threshold. The support gate is **independent of B3 alignment authority** (§4.6): if it fails, an on-device `SUPPORTED` becomes `WAITING` (cloud available) or `LOCAL_EVIDENCE` (no cloud), whatever B3's authority is.

**Support-gate floor.** `PS_pairs ≥ 16` because 15 correct supports of 15 cannot pass: `WilsonLB95(15, 15) = 0.7961 < 0.80`, while `WilsonLB95(16, 16) = 0.8064`.

**Support-gate operating characteristic** (exact binomial, independent pairs; MUST be printed in `r1e_{profile}.md`; identical to [04 › Support gate operating characteristic (exact binomial, independent pairs)]):

| `PS_pairs` n | minimum `TS_pairs` (errors allowed) | `WilsonLB95` at the minimum | P(pass) at true support precision 0.85 | 0.90 | 0.95 |
|---|---|---|---|---|---|
| 16 | 16 (0) | 0.8064 | 0.074 | 0.185 | 0.440 |
| 20 | 20 (0) | 0.8389 | 0.039 | 0.122 | 0.358 |
| 24 | 24 (0) | 0.8620 | 0.020 | 0.080 | 0.292 |
| 25 | 24 (1) | 0.8046 | 0.093 | 0.271 | 0.642 |
| 30 | 29 (1) | 0.8333 | 0.048 | 0.184 | 0.554 |
| 32 | 31 (1) | 0.8426 | 0.037 | 0.156 | 0.520 |
| 40 | 37 (3) | 0.8014 | 0.130 | 0.423 | 0.862 |
| 50 | 46 (4) | 0.8116 | 0.112 | 0.431 | 0.896 |

**Stated expectation (normative wording for the report, Proof mode and the README).** At a realistic on-device support precision near 0.90, the support gate is **expected to fail** (pass probability about 0.2–0.4 at the sample sizes R1-E produces). `SUPPORTED_LOCAL` is **not a core feature**: no screen, demonstration segment or README section depends on it, and a failed support gate is reported as the designed, safe outcome ("on-device supports stay advisory"). The threshold 0.80 is never lowered after seeing data. `FSR_C` and `FSR_N` are always reported with their counts and the C subtypes of affected pairs.

**Path A operating characteristic `[I]`** (independent pairs; probability that Path A activates):

| `PP_pairs` | true precision 0.55 | 0.60 | 0.70 | 0.80 | 0.85 |
|---|---|---|---|---|---|
| 15 | 0.04 | 0.09 | 0.30 | 0.65 | 0.82 |
| 20 | 0.06 | 0.13 | 0.42 | 0.80 | 0.93 |
| 25 | 0.06 | 0.15 | 0.51 | 0.89 | 0.97 |

### 3.8 Intervals and fixtures

**Wilson interval:**

```
n trials, k successes, p̂ = k / n, z = 1.959964
center = (p̂ + z²/(2n)) / (1 + z²/n)
half   = z · sqrt( p̂(1 − p̂)/n + z²/(4n²) ) / (1 + z²/n)
CI95   = [ center − half , center + half ]          (n = 0 → "undefined"; the gate fails)
```

**Reference implementation.** `/eval-harness/src/stats.ts` (TypeScript) is cross-checked by `/eval-harness/py/stats_check.py`; both MUST agree to **4 decimal places** on `/eval-harness/fixtures/stats_fixture.json` (**AC-EVAL-03**).

**Fixture values (MUST be reproduced):**

| Quantity | Value |
|---|---|
| Wilson LB(11, 15) | **0.4805** |
| Wilson LB(15, 15) | **0.7961** |
| Wilson LB(16, 16) | **0.8064** |
| Wilson LB(15, 20) | **0.5313** |
| Wilson LB(16, 20) | **0.5840** |
| Wilson(28, 40) | **[0.5457, 0.8193]** |
| Wilson(40, 50) | **[0.6696, 0.8876]** |
| Wilson UB(0, 100) | **0.0370** |
| Wilson UB(0, 10) / UB(0, 3) / UB(0, 2) (grey-zone bounds) | 0.2775 / 0.5615 / 0.6576 |
| Wilson LB(25, 50) | 0.3664 |
| Wilson LB(45, 50) / LB(46, 50) | 0.7864 / 0.8116 |
| Wilson LB(28, 30) / LB(29, 30) | 0.7868 / 0.8333 |
| Wilson LB(23, 25) / LB(24, 25) | 0.7503 / 0.8046 |
| Wilson LB(36, 40) / LB(37, 40) | 0.7695 / 0.8014 |
| P(π) with P̂ = 0.70 at prevalence 1/3 (TPR/FPR = 4.667), π = 0.08 / 0.12 / 0.18 | 0.289 / 0.389 / 0.506 |
| P_LB(0.12) with TP_pairs = 25 and FP_S + FP_N = 0 | 0.575 |
| Support-gate operating characteristic (§3.7) | reproduced to 3 decimals |
| Holm fixture (§4.2) | `0.010, 0.030, 0.040, 0.200 → 0.040, 0.090, 0.090, 0.200` |

### 3.9 Outputs and publication

1. `/eval-harness/reports/r1e_{profile}.md`: every metric of §3.6 (including support metrics, the support-gate operating characteristic, the stated expectation, per-call precision and `P_LB(π)`), both intervals, retrieval metrics and the NEI split, the confusion matrix, the `S-GRAY` breakdown with its upper bounds, latency, transient outcomes, anchor failures, the calibrated variant, `samplingMode` and the freeze hashes.
2. `/eval-harness/reports/r1e_summary.json`, machine-readable.
3. **Publication guard.** `/eval-harness/src/publish_routing.ts` converts the R1-E summary, the CF-1 report and the PROBE selection into `routing_table` [04 › Published schema] (`path`, `calibration.*` including `prevalence_adjusted_lb` and `support`, `supportVerdicts`, `calibratedVariant`, `authority`, `cf1`, `probe_expected`, `freeze`, `kappa_ok`). Publication to Remote Config happens **only** with **`publish_routing.ts --confirm`**, which re-evaluates every gate with `gate.ts` and **refuses** to publish a table in which:
   - `path = "A"` fails the Path A gate, or `KAPPA_OK = false` with any Path A or authoritative support;
   - `supportVerdicts = "authoritative"` fails the support gate (including the floor 16);
   - `authority = "authoritative"` fails the CF-1 rule (§4.2), including the B5 precision condition;
   - `calibratedVariant` differs from the manifest;
   - `freeze.tier_a_hash`, `freeze.tier_b_hash` or `cf1_baseline_hash` differ from `H4_DECISION.md`.

   A refused publication exits non-zero and leaves Remote Config untouched (**AC-EVAL-05**).

### 3.10 R1-E-L2

**Scope statement (mandatory in every report and every public citation).** `R1-E-L2` measures the **non-grounded, provided-evidence variant `l2AdjudicateProvided`** (no Google Search, evidence supplied by Toulmin). Its results **cannot be attributed to the grounded production adjudicator `l2Adjudicate`**, whose web-grounded behaviour is not measured by this evaluation. Any README or Devpost citation includes the sentence *"measured without web search on our 150-pair test set, using the provided-evidence variant of the cloud check"*.

| Item | Specification |
|---|---|
| Adjudicator | `l2AdjudicateProvided` [04 › `l2AdjudicateProvided` — provided evidence only]: `gemini-3.8-flash`, `ONLY_IN_CLOUD`, `responseSchema: L2Verdict`, `maxOutputTokens = 2048`, the thinking configuration recorded by `S-L2`, **no tools** |
| Evidence | Every unit of the pair's own abstract (no full text, no distractors) |
| Calls | **150 × 1 call**, in `toulmin-staging` with its own key and caps, so production pools are untouched; cost ≈ 150 × the measured `l2AdjudicateProvided` cost |
| Post-checks | The seven L2 post-checks in full [04 › Seven L0 post-checks on `L2Verdict` (applied in order)], including the anchor validator with `layer = "L2"`; a `WEB_SOURCE` answer maps to `NEI` |
| Logged | As §3.5, with `rawText`, so the report can be replayed |

**Metrics** (`v_i` ∈ {S, P, C, N} from `SUPPORTED`, `PARTIAL`, `CONTRADICTED`, `NEI` after post-checks):

```
PP_L2     = |{ i : v_i = C }|          TP_L2 = |{ i : v_i = C ∧ g_i = C }|
P̂_L2(C)   = TP_L2 / PP_L2   with its Wilson 95 % interval
R̂_L2(C)   = TP_L2 / 50
FSR_C_L2  = |{ i : v_i = S ∧ g_i = C }| / 50   with its Wilson 95 % interval
FSR_N_L2  = |{ i : v_i = S ∧ g_i = N }| / 50   with its Wilson 95 % interval
also: the 4×3 confusion matrix (PARTIAL separately); C precision on C-SUBJECT-SWAP; CONTRADICTED kept with
      noDifferenceNote and downgraded by NO_DIFFERENCE_SIGNAL; latency; cost
```

**Use: reporting only** (`/eval-harness/reports/r1e_l2.md`). It **never sets a gate**, threshold, authority or routing value; its outputs are stored only as verdict enums in the report; it is never training or calibration data (**AC-EVAL-11**).

### 3.11 DEV Ablations

**`bm25_min_cov` calibration (Tier A; Phase 0, before `l0-freeze-a`).** For each of the 45 DEV pairs, build three group corpora by the method of §3.3 with **10, 50 and 150 references** (the 150-reference corpus adds distractors from the same domains). For every **gold evidence unit**, compute `cov(c, d)` and `stems(c, d)` [02 › IDF-weighted claim coverage and the `bm25_min_cov` filter] and apply the production discard rule (discard only if `cov < τ` **and** `stems < 2`). Choose the **largest** τ in [0.05, 0.60] in steps of 0.01 such that **≥ 95 % of gold evidence units are kept in every stratum** of:
- **claim length:** 1–4, 5–8, ≥ 9 claim terms;
- **unit length:** units shorter than `avgdl` and units of length ≥ `avgdl`;
- **corpus size:** 10, 50, 150 references.

If no τ qualifies, the default **0.25** is kept and the report states it. The report (`/eval-harness/reports/bm25_calibration.md`) lists, per stratum, the retention, its count and its **Wilson 95 % lower bound**, and the number of non-gold units kept per pair. τ is written to `/packages/core-l0/bm25_min_cov.json` (Tier A) and Remote Config, and is never re-tuned after an R1-E run.

**Statistical status (normative wording).** The calibration is **descriptive on DEV**: it reports the retention observed on 45 DEV pairs, with per-stratum Wilson lower bounds, and is **not a population guarantee**. The structural bound on retrieval loss is the `stems ≥ 2` keep rule; the residual loss is measured as `Recall@5` on DEV and on R1-E (§3.6).

**Reporting-only ablations** (all on `web_chrome_nano`, PC Ryzen 7; 3 runs per pair; production path; replayed with the final Tier B package before `H4_DECISION.md`):

| Arm | Schema | Reasoning |
|---|---|---|
| R40 | `VerdictV1` | ≤ 40 words (production default) |
| R30 | `VerdictV1_cap30` | ≤ 30 words |
| R0 | `VerdictV1_r0` (evaluation-only, `/eval-harness/schemas/`, never shipped): identical keys, `s03_micro_reasoning` with `maxLength: 0` and the prompt line *"write an empty string"*; the reasoning↔verdict check is skipped for this arm only | none (reasoning off) |

- **Metrics per arm** (pair-level majority): Macro-F1 over {S, C, N} with a stratified bootstrap 95 % interval (B = 2,000, `SEED_BOOTSTRAP`); `P̂(C)`; `R̂(C)`; `P̂_S`; p50/p95 Stage 2 latency; deadline hits.
- **The ablation decides nothing:** the default reasoning cap **stays 40 words** (D-03); the 30-word cap is used only when `S-W4`/`S-A3` show the 40-word variant cannot meet the L1 deadline. Differences are described as *"no measurable effect at this sample size"* whenever the interval of the difference contains 0. The evidence-first joint schema is described as an **untested design choice** (no split-call or verdict-first arm exists).
- **Report:** `/eval-harness/reports/dev_ablation.md`.

---

## 4. `CF-1` Task Authority Suite, `O2` OCR Evaluation & Real-Preprint Verification

### 4.1 CF-1: Task Authority Test

Every local task always runs on the device. CF-1 decides, per task and per profile, whether the L1 output is **authoritative** (it may change ledger state) or **advisory** (shown as a suggestion; the deterministic baseline decides ledger state) [04 › Surface semantics and task authority].

- **What CF-1 does not decide:** on-device **support verdicts**. B3 authority decides only which passage is shown as the evidence; whether an on-device `SUPPORTED` may become `SUPPORTED_LOCAL` is decided only by the support gate (§3.7). `authority.B3` and `supportVerdicts` are stored and validated separately.
- **Profiles:** B1, B2, B3 and B5 on `web_chrome_nano` and `android_aicore_stable`; O2 on `android_aicore_stable` only. Each item runs **once** per profile, on the production path.
- **Baselines** are the locked files of `cf1_baseline_hash` (§2.6).

### 4.2 Shared significance procedures

**Exact one-sided McNemar test** (paired per-item correctness, L1 vs baseline):

```
b = #items where L1 correct and baseline wrong
c = #items where L1 wrong and baseline correct
N = b + c
p_one_sided = Σ_{k=b}^{N} C(N, k) · 0.5^N          (N = 0 → p_one_sided = 1.0)
```

**Paired permutation test** (for B1 IoU-F1, whose per-item contributions are not additive):

```
rng = PCG64(seed = SEED_PERMUTATION); B = 2,000
Δ_obs = F1(L1 predictions) − F1(baseline predictions)          over all n items
for r in 1..B:
    for each item j: with probability 0.5 swap the L1 and baseline predictions of item j
    Δ*_r = F1(permuted "L1") − F1(permuted "baseline")
p_one_sided = (1 + |{ r : Δ*_r ≥ Δ_obs }|) / (B + 1)
```

**Holm–Bonferroni per profile.** For profile `p` with `m_p` one-sided p-values sorted ascending `p_(1) ≤ … ≤ p_(m)` (ties broken by task order B1, B2, B3, B5, O2):

```
p̃_(k) = max_{j ≤ k} min(1, (m_p − j + 1) · p_(j))
m_p = 4 for web_chrome_nano (B1, B2, B3, B5);  m_p = 5 for android_aicore_stable (B1, B2, B3, B5, O2)
family-wise α = 0.10 per profile
```

**Fixture** (`eval-harness/fixtures/holm_fixture.json`, `conformance/l0/holm.json`): Web p-values B1 0.010, B2 0.200, B3 0.030, B5 0.040 → sorted **0.010, 0.030, 0.040, 0.200** → adjusted **0.040, 0.090, 0.090, 0.200** → B1, B3 and B5 pass `p̃ ≤ 0.10`; B2 does not.

**Authority rule (per task t and profile p):**

```
authoritative_{t,p} ⇔ Δ_{t,p} ≥ 0.10 ∧ p̃_{t,p} ≤ 0.10
                      ∧ (t ≠ B5 ∨ InconsistentPrecision_L1 ≥ InconsistentPrecision_base)
otherwise advisory_{t,p}
```

Unadjusted p-values are reported next to the adjusted ones. Holm makes `advisory` more likely; `advisory` is the safe default.

**Stated expectation (before the run).** With n = 40–50 (B5) and n = 30–45 (O2), a typical pilot discordance and a Holm worst-case level of 0.10 / 4 (Web) or 0.10 / 5 (Android), **B5 and O2 are expected to remain `advisory`**. No public material may state or imply that the on-device model decides B5 badges or O2 extractions unless `H4_DECISION.md` records `authoritative` for that task and profile.

### 4.3 Power analysis (computed and committed before the CF-1 run)

- **Pilot:** 15 items per task (DEV-like material, not from the CF-1 sets) estimate the baseline accuracy or F1 `a_b` and the discordance rate `d = (b + c) / n`. Both are reported as rough estimates.
- **Simulation** (`/eval-harness/src/power.ts`; **6,000 replications**; seed `SEED_POWER`): for McNemar tasks each replication draws `n` paired items; with probability `d` an item is discordant, and a discordant item favours L1 with probability `q`, chosen so that the expected Δ equals the tested effect; the test of §4.2 is applied. For B1 (F1), replications resample pilot items with repetition (bootstrap) and flip baseline-correct items to L1-correct with the probability needed for the target Δ, then apply the permutation test with B = 2,000.
- **Effects:** Δ = 0.10, 0.15, 0.20.
- **Levels:** the unadjusted 0.10 and the Holm worst case `0.10 / m_p`.
- **Discordance sensitivity:** every power figure is also computed at **`d × 0.5`, `d × 1.0` and `d × 1.5`** (capped at 1.0), one table per task; the report states which conclusions change across that range.
- **Rule:** if `power(Δ = 0.15)` at level `0.10 / m_p` is below 0.60 and more labelled items can be produced **before `l0-freeze-a`** (annotation sets are Tier A), `n` is increased up to the maximum below; for B2 and B3 the team MAY raise `n` to 80 whenever annotation allows before the freeze. Otherwise the test runs at the planned `n` and the README states the power.

| Task | Planned n | Maximum n |
|---|---|---|
| B1 | 60 sentences | 80 |
| B2 | 60 sentences | 80 |
| B3 | 60 sentences | 80 |
| B5 | 40 pairs | 50 |
| O2 | 30 rows (target row 1 of each photo) | 45 (adds target row 2 of the first 15 photos in file order) |

### 4.4 B1: Atomic decomposition (MS-B123)

**Item format:**

```json
{ "itemId": "ms-0001",
  "sentence": "Of the 412 participants enrolled, 37% reported improved sleep quality at 12 weeks [4], and adherence was high.",
  "section": "results",
  "goldAtoms": [ { "start": 3, "end": 14, "type": "QUANTITATIVE" }, { "start": 16, "end": 18, "type": "EXISTENCE" } ],
  "goldCheckworthy": "HIGH",
  "goldUncitedEmpirical": false,
  "citedAbstract": "…", "goldEvidenceSentenceIdx": [2],
  "license": "cc-by" }
```

Word indexes are the word indexes of the prompt text with markers deleted [02 › Rule-Based Sentence Segmentation].

- **Composition (planned 60):** 36 sentences with 2–3 claims; 12 with exactly 1 claim; 12 non-empirical (aims, transitions, methods descriptions). The 24 gold uncited empirical sentences (§4.5) are distributed across these groups and recorded by `goldUncitedEmpirical`.
- **L1:** Stage 1 `TriageV1.s1_atoms`. **Baseline:** one atom per clause from the clause partitioner (the **whole-clause baseline**).
- **Match rule:** a predicted atom matches a gold atom iff their **word-index span IoU ≥ 0.5**; greedy matching by highest IoU; each gold atom matches at most once; type is not part of the match.

```
Precision = matched / |predicted| ;  Recall = matched / |gold| ;  AtomF1 = 2PR / (P + R)  (0 if P + R = 0)
Δ_B1 = AtomF1_L1 − AtomF1_base ;   significance: paired permutation test (§4.2)
```

### 4.5 B2: Check-worthiness

- **Gold:** `goldCheckworthy` ∈ {HIGH, LOW}, assigned by A1 with an A2 agreement subsample of **30 items** (15 per class, seed `SEED_B2_SUBSAMPLE`); κ point estimate ≥ 0.70 with its bootstrap interval; the independence rule of §3.4 applies; on failure, the targeted adjudication of §3.4 rule 8 is applied to the B2 items.
- **L1:** `TriageV1.s2_worth`. **Baseline:** `baselineTriage` worth [03 › Deterministic triage baseline (`baselineTriage(S, c)`)].
- **Metric:** Macro-F1 over {HIGH, LOW} on the 60–80 sentences; per-item correctness `pred = gold` for McNemar.

```
Δ_B2 = MacroF1_L1 − MacroF1_base ;   significance: exact McNemar (§4.2)
```

**B4: Uncited-empirical flag precision.** B4 follows B2 authority. With the effective production triage (the baseline, or Stage 1 when B2 is authoritative), over all MS-B123 sentences:

```
Precision_B4 = |{ flagged uncited ∧ gold uncited empirical }| / |{ flagged uncited }|     with its Wilson 95 % interval
Recall_B4    = |{ flagged uncited ∧ gold uncited empirical }| / 24                     (the 24 gold uncited empirical sentences)
```

If **`Precision_B4 < 0.60`**, `publish_routing.ts` sets Remote Config **`b4_counts_in_review = false`**: the blue chip "Uncited empirical claim" is still shown, but the clause counts in `unchecked` (inside "not yet checked") instead of `to_review` [01 › Exact partition]. The DEV rate of `s2_worth = LOW` is also reported; the frozen prompt is not changed.

### 4.6 B3: Evidence alignment

- **Gold:** `goldEvidenceSentenceIdx` (dual-annotated; agreement = overlapping sets; disagreements adjudicated by A3); every item has a non-empty gold set.
- **L1:** Stage 2 `VerdictV1` (calibrated variant) with production `EVIDENCE[0..4]`; the prediction is the abstract sentence containing the validated anchor; `s02_evidence_idx = −1` or a failed anchor is an **abstention**. The verdict value is ignored.
- **Baseline:** the BM25 top-1 unit after the production coverage filter, **abstaining** when the filter keeps no unit (`selection.candidates = 0`).
- **Correctness:** predicted sentence ∈ gold set. **Symmetric abstention:** abstention counts as incorrect for both systems.

```
Accuracy = correct / n ;  Δ_B3 = Acc_L1 − Acc_base ;  significance: exact McNemar (§4.2)
also reported: Recall@5 of BM25 (upper bound for L1); abstention rates of both systems
```

**Decoupling (MUST).** An `authoritative` B3 changes only which passage the inspector shows as the evidence and which passage is placed first in the L2 evidence list; it never authorizes an on-device support verdict.

### 4.7 B5: Manuscript self-consistency (MS-B5)

**Item format:**

```json
{ "itemId": "b5-001",
  "a": { "window": "…we enrolled 48 participants in the intervention arm…", "section": "methods", "valueRaw": "48", "unitRaw": "participants" },
  "b": { "window": "…of the 46 participants who completed follow-up…", "section": "results", "valueRaw": "46", "unitRaw": "participants" },
  "gold": "CONSISTENT_DIFFERENT_SUBSET" }
```

- **Composition (planned 40):** 16 `INCONSISTENT`, 12 `CONSISTENT_DIFFERENT_SUBSET`, 12 `DIFFERENT_QUANTITY` (up to 50, keeping the ratios).
- **Pre-conditions:** every pair is a production candidate: same metric class, same unit family, lemma Jaccard ≥ 0.35, values divergent beyond rounding tolerance [03 › Deterministic incremental pairing].
- **L1:** `B5CheckV1.s3_verdict` after the L0 consistency check (`INCONSISTENT` with `s2_same_population = false` → `DIFFERENT_QUANTITY`).
- **Baseline:** the deterministic **three-class** B5 baseline [03 › Deterministic three-class B5 baseline], first match wins:
  1. `CONSISTENT_DIFFERENT_SUBSET` iff `metricClass ∈ {sample_size, count}` and the smaller value's own window contains an attrition cue (`completed`, `analysed`, `analyzed`, `followed up`, `follow-up`, `excluded`, `withdrew`, `withdrawn`, `lost to follow-up`, `discontinued`, `per-protocol`, `evaluable`, `remaining`);
  2. `INCONSISTENT` iff Jaccard ≥ 0.5 ∧ `sectionDistance` ≤ 1;
  3. `DIFFERENT_QUANTITY` otherwise.

```
Accuracy = correct / n ;  Δ_B5 = Acc_L1 − Acc_base ;  significance: exact McNemar, Holm-adjusted (§4.2)
InconsistentPrecision_X = |{ X predicts INCONSISTENT ∧ gold = INCONSISTENT }| / |{ X predicts INCONSISTENT }|
                          (X ∈ {L1, base}; 0 predictions → precision 0, and the condition fails for L1)
Additional authority requirement: InconsistentPrecision_L1 ≥ InconsistentPrecision_base
also reported: recall of INCONSISTENT for both systems; both 3×3 confusion matrices
```

### 4.8 O2: Value extraction from a selected row (MS-O2; Android)

- **Items:** target row 1 of each photo (plus target row 2 of the first 15 photos when `n` is increased); each item has a target claim and the gold `(column header, value)` pairs relevant to it.
- **L1:** `O2PhysicalExtractV1` facts after L0 post-processing [04 › `O2PhysicalExtractV1` and `O2PhysicalExtractFlatV1` (Android only)]. **Baseline:** deterministic Select-row value matching.
- **Input:** both systems receive the same evidence string from the Select-row geometry (capture gate, one or two header rows, row-specific gap threshold) [06 › O2: Check against a printed page].
- **Per-item correctness:** the predicted `(column, value)` set equals the gold set, comparing values by value and headers by `titleSim ≥ 0.8`.

```
Accuracy = correct / n ;  Δ_O2 = Acc_L1 − Acc_base ;  significance: exact McNemar (§4.2)
```

### 4.9 CF-1 output

`/eval-harness/reports/cf1.md` and `cf1_summary.json` record per task and profile: n, Δ, unadjusted p, Holm-adjusted p with the sorted order, power at Δ ∈ {0.10, 0.15, 0.20} at both levels and the three discordance multipliers, authority, the baseline and L1 metrics, for B5 both `INCONSISTENT` precisions, and `Precision_B4` with `b4_counts_in_review`. `publish_routing.ts` copies `{ delta, p, p_holm, power }` (power at Δ = 0.15, Holm worst-case level, `d × 1.0`) and, for B5, `inconsistent_precision_l1` and `inconsistent_precision_baseline` into `routing_table.profiles[p].cf1`, and sets `authority`. The support-gate result is written to `supportVerdicts` separately.

### 4.10 O2 physical-evidence evaluation

**Corpus (MS-O2):**
- **20 laser-printed tables** from CC-BY papers on A4, photographed with the Xiaomi 15T Pro: 8 in daylight, 6 under indoor white light, 6 under warm light at a 15–25° tilt. At least 5 have merged header cells, **5 have two-row headers** (a spanning label such as "Treatment" above "n (%)"), 5 have multi-line cells, 5 have right- or decimal-aligned numeric columns, and 5 have Lancet-style mid-dot decimals (`0·45`) or Unicode minus signs.
- **10 photos of bound journal pages or photocopies**, including at least 3 on glossy paper and 3 photocopies.
- **Capture-gate set** (separate): **6 photos** with strong perspective (phone at about 40–50° to the page) and **4 short-table photos** (at most 3 text lines, photographed parallel to the page).
- **Gold per photo:** `gold_grid.json` (2-D array of `norm()` cell strings, merged cells in their first column with `span`) and `gold_rows.json` (target rows 1–3 as `(header text, cell text)` pairs; two-row headers written in the combined `"{upper} · {lower}"` form).

**Select-row accuracy (primary flow; always reported).** The harness simulates the author's taps at the gold row centre and gold header centre(s) — including **"Add the row above"** for two-row headers — and runs the Select-row geometry in Airplane Mode:

```
rowAcc(photo, row) = |{ gold (header, cell) pairs reproduced exactly after norm() }| / |gold pairs in the row|
tableAcc(photo)    = mean over its target rows of rowAcc
SelectRowAccuracy  = mean over photos of tableAcc        (per-table mean; large tables do not dominate)
CI95               = percentile bootstrap over photos, B = 2,000, SEED_O2_BOOTSTRAP
also reported: min tableAcc; mean for laser tables vs journal pages vs photocopies; mean for two-row-header tables
```

**Capture-gate metrics** (asserted by **AC-OFF-03**):

```
FalseRejectRate = rejected photos among the 30 evaluation photos / 30     (target ≤ 2 of 30)
TrueRejectRate  = rejected photos among the 6 capture-gate photos / 6     (target ≥ 5 of 6)
ShortTableKeep  = accepted photos among the 4 short-table photos / 4      (target 4 of 4; the IQR test is skipped)
```

A rejected evaluation photo counts as `tableAcc = 0`, so rejection never inflates accuracy. The per-photo line-angle IQR and qualifying-line count are listed.

**Confirmation burden (informative):** mean number of values confirmed per claim (capped at 3); how often the simulated author would answer "Not sure" according to the gold annotation `rowEntailsClaim`; the fraction of values flagged by the numeric sanity checks.

**Report:** `/eval-harness/reports/o2.md`.

### 4.11 Grid-mode gate

The grid algorithm [06 › O2: Check against a printed page] runs on every photo. Predicted and gold rows are aligned by Hungarian assignment (cost = 1 − token Jaccard of row text), then columns by the same method.

```
cellAcc(photo) = correct cells / gold cells       (correct iff norm(text) equal after collapsing whitespace)
GridAccuracy   = mean over photos of cellAcc ;  CI95 = percentile bootstrap over photos (B = 2,000, SEED_GRID_BOOTSTRAP)
o2_grid_enabled = true  ⇔  GridAccuracy ≥ 0.85 ∧ CI95.lower ≥ 0.75
```

Otherwise grid mode stays disabled. **Select-row stays the primary flow in every case**; grid mode is an optional toggle.

### 4.12 Sanitizer Calibration and Red Team

- **False positives (MS-SAN, 500 CC-BY abstracts):** every abstract is segmented and sanitized; `FP = blocked units / all units`; **FP ≤ 1 %**; any single pattern responsible for > 0.5 % of units MUST be narrowed and the test re-run. Pattern narrowing changes Tier A, so the calibration pass runs in **Phase 0**, before `l0-freeze-a`; Phase 3 re-verifies the frozen sanitizer on the release build without changing it. The report lists blocked units by pattern ID with their text.
- **Scientific Greek:** none of the ≥ 40 abstracts containing `TNFα`, `IL-1β`, `NF-κB`, `μm` or similar may be blocked by `MIXED_SCRIPT`.
- **Detection (RT-INJ, 20 items):** each contains one of: an instruction to the model; a delimiter forgery; a schema-key forgery; Unicode tag characters; bidi overrides; mixed-script words; zero-width runs; hidden PDF text (a PDF fixture). **≥ 19 of 20 blocked**, and **0 of 20** produce a local verdict.
- **Folded detection (RT-INJ-F, 6 items):** injected instructions written with mathematical alphanumeric letters (`𝐢𝐠𝐧𝐨𝐫𝐞`), circled letters, or letters interleaved with combining marks; detection runs on `detectText` [02 › Untrusted Evidence Sanitizer]. **6 of 6 blocked**, 0 local verdicts.
- **Weaponization check:** 10 MS-SAN abstracts with the inserted sentence *"These results were supported by the data and contradict earlier claims."* MUST NOT be blocked (log tier only).
- **Report:** `/eval-harness/reports/sanitizer.md`.

### 4.13 Real-preprint demonstration protocol

- **Corpus:** **3–5 real CC-BY open-access preprints**, chosen **before** running the tool by a recorded rule in `preprints_v2.json` (the most recent preprints in two fields that have a LaTeX source available).
- **Run:** full pipeline, Standard mode, judge pool, on the production build, once routing is published (Phase 2).
- **Verification:** **two independent reviewers** (team members who did not choose the corpus) check **every** flagged problem — `REFERENCE_PROBLEM`, `CONTRADICTED`, `PARTLY_SUPPORTED`, `MIXED_SUPPORT` — against the sources, each blind to the other's verdict; disagreements are resolved by discussion and the resolution is recorded.
- **Report** `/eval-harness/reports/preprints.md`: per preprint and category, the counts before and after verification, the **true positives** (`k_true`), the **false positives** (`k_false`, reported even when 0), the inter-reviewer agreement, and examples quoted only from CC-BY material. Preprints are referenced only by DOI; authors are never named in public material; findings are described as "items an author would want to check", never as misconduct.
- **Publication:** only post-verification counts are published, in the single sentence specified in [08 › Real-preprint sentence]; if no run is verified before the Phase 3 exit gate, the sentence is omitted rather than estimated.

---

## 5. Technical Dependency Phases

These are the four phases of `AGENTS.md` §2 with their full entry criteria, deliverables and exit gates. A phase's exit gate MUST pass before the exit gate of any phase that depends on it is evaluated; work MAY start early wherever its prerequisites already hold. No calendar date, deadline or time window governs the ordering. Optional features shrink only by Remote Config flags (`o2_grid_enabled`, routing values); locked decisions, security requirements and honesty rules never shrink.

| Phase | Prerequisites | System Modules & Deliverables | Exit Gates (all MUST pass) |
|---|---|---|---|
| **Phase 0: Spikes, Core L0 Tier A & Harness** | Firebase projects `toulmin-prod` and `toulmin-staging` on Blaze; devices of the profile table available | All spikes of §1.2–§1.4 and **`BE-1`..`BE-4`**; production project configuration (§1.7 items 2–3); **`packages/core-l0` Tier A** modules with their data files; **`conformance/l0`** golden files written by hand from the normative examples (§6.9 procedure 4) and **`examples.meta.test.ts`**; the Kotlin Tier A port; `packages/schemas`; `packages/prompts/p2.1`; the evaluation harness (runners logging every replay input, `stats.ts`, `holm.ts`, `power.ts`, baselines, `manifest.ts`, `disjointness.ts`, `bm25Calibrate.ts`, `publish_routing.ts`, `tools/freeze-hash.ts`, `tools/replay.ts`); **datasets** DEV, R1-E, PROBE pool, MS-B123, MS-B5, MS-O2 (+ capture-gate and short-table photos), MS-SAN, RT-INJ, RT-INJ-F; **annotation** (A1 complete; A2 subsamples; **κ** computed or targeted adjudication complete); sanitizer calibration on MS-SAN; **`bm25_min_cov` DEV calibration** (§3.11); pilot and **power report**; CF-1 baselines locked (`cf1_baselines.txt`, `cf1_baseline_hash`); git tag **`l0-freeze-a`** and **`tier_a_hash`** | (1) §1.7 complete; (2) TypeScript and Kotlin Tier A pass 100 % of the Tier A conformance files and `examples.meta.test.ts` (AC-L0-01, AC-L0-24); (3) ReDoS fuzz passes (AC-L0-15); (4) κ ≥ 0.70 on the R1-E and B2 subsamples, or targeted adjudication complete with `KAPPA_OK` recorded; annotator independence recorded (AC-EVAL-02); (5) disjointness passes (AC-EVAL-01); (6) `bm25_min_cov` calibrated and in the bundled defaults (AC-EVAL-07); (7) sanitizer FP ≤ 1 % on MS-SAN; (8) power report and `cf1_baseline_hash` committed (AC-EVAL-06); (9) `stats.ts`, `stats_check.py` and `holm.ts` reproduce every fixture (AC-EVAL-03); (10) `tier_a_hash` written and the tag cut |
| **Phase 1: Benchmark Execution, Tier B Replay & Calibration Lock** | Phase 0 exit gate | **R1-E** on both gated profiles (**900 calls**); **PROBE 5×** per profile and probe selection; **CF-1** on every task with Holm per profile; support gate; `Precision_B4` and `b4_counts_in_review`; **O2** Select-row, capture-gate and grid evaluation; DEV ablations; **Tier B finalization** (anchor validator, gates, Holm, reducer, Coverage Meter, Kotlin Tier B port) through **`tools/replay.ts`** with replay reports; **`H4_DECISION.md`** with first-look and replayed metrics; **`publish_routing.ts --confirm`**; `probe/probe_set_p2.json` | (1) both profile runs `RESULT_VALID`, or a profile recorded as not benchmarked with its reason; (2) reducer property tests and Tier B conformance pass (AC-L0-16, AC-L0-20); (3) every run replayed with the final `tier_b_hash`; two replays byte-identical (AC-EVAL-12); (4) `H4_DECISION.md` committed with every item of §2.7 items 1–9, including first-look and replayed columns; (5) `routing_table` published with its `freeze` block and accepted by the client validation rules [04 › Client validation rules (all MUST hold, checked with `gate.ts`)] (AC-EVAL-05); (6) `probe_set_version` published |
| **Phase 2: Multi-Platform Core Implementation** | Phase 0 exit gate (start); Phase 1 exit gate (routing behaviour, sample `expected.json`) | **`apps/web`** per `06` §2; **`functions`** per `05` §3 including private **`oaParse`/`oaParseJudge`** after **`BE-5`**; per-class service accounts; **`firestore.rules`/`storage.rules`** and TTL policies; budgets and Pub/Sub topics; judge codes issued; **`apps/android`** `bundledSample` Pocket Ledger per `06` §3; **`apps/ios`** thin client per `06` §4; **`R1-E-L2`** run in staging (§3.10) and its addendum to `H4_DECISION.md`; **real-preprint runs** and verification (§4.13); Sample Manuscript references and `expected.json` frozen | Every functional acceptance row with Phase Gate "Phase 2" passes (§6); rules emulator tests 100 %; Web performance budgets met on PC Ryzen 7; routing in the build equals `H4_DECISION.md`; BE-5 recorded; `bundledSample` network capture clean (S-A5) |
| **Phase 3: Hardening, Verification & Release** | Phase 2 exit gate; every `VERIFY-AT-SPIKE` marker resolved | **`k6` load test** (`tools/loadtest/k6-script.js`: **500 requests** from 50 anonymous UIDs on 3 network prefixes, forged `X-Forwarded-For` on a third of them, + 5 judge UIDs across both lanes; `quotaGuard` anonymous, judge and sample pools including 21 sample runs; L2); kill-switch drill with a client that ignores Remote Config; budget-action drill (all four budgets, staging); Functions-cap simulation; **RT-INJ 20 items** + RT-INJ-F; **MS-SAN 500 CC-BY abstracts ≤ 1 % FP** re-verification on the release build; reducer property tests at 10,000 cases; **`tools/scan-artifacts.ts`**; **`tools/check-iam.ts`**; **`tools/csp-hash.ts --verify`** and the production CSP audit; **degraded-boot tests** (offline; reCAPTCHA blocked; reCAPTCHA key disabled); dependency audit; privacy-copy audit against the deployed UI; **written grounding-display terms inquiry to the Gemini API developer channels** (the Google AI developer forum and Gemini API support — not the hackathon organizers), with the question, the channel and the answer (or its absence) logged in the release log; demonstration video; README; production deploy; **`Active Judging Monitoring Mode` armed** (two named operators, alert routing, `MONITORING_MODE = ACTIVE_JUDGING` from the start of the official judging period) | Every acceptance row of §6 passes (rows disabled by `H4_DECISION.md` pass their disabled-feature assertion); no high or critical dependency vulnerability; load-test assertions of AC-COST-04; release artifacts pass `tools/scan-artifacts.ts`; the terms inquiry logged; base URL, the one-click sample cloud check and one judge code verified from an external network in clean Chrome profiles on PC Ryzen 7 and the ThinkPad |

**Operations after release.** From public launch until the official judging period starts, operators run **Standard Monitoring Mode**; from the start of the official judging period until `JUDGE_TIER_EXPIRY_EPOCH`, **Active Judging Monitoring Mode** [05 › Monitoring modes]. No feature change ships in either mode; only pools, the kill switch, caps (per the lift authority) and a re-published routing table (after a Chrome or AICore update, with a new `H4_DECISION.md` commit) may change.

---

## 6. Master Acceptance Matrix

### 6.1 Conventions

- Every row is an automated test unless marked **(manual)**. A manual row is recorded with a screen capture or screenshot under `/docs/acceptance/{ID}.{mp4|png}` and a one-line result in `/docs/acceptance/RESULTS.md`.
- **Phase Gate** names the phase whose exit gate requires the row. Every row MUST pass before release.
- A row whose feature is disabled by `H4_DECISION.md` (for example O2 grid mode, or hints when every profile is in Path B) is verified by its **disabled-feature assertion**: the feature's entry points are absent or disabled exactly as specified, and the README states it.
- `tools/count-ac.ts` counts the unique identifiers of §6.2–§6.8; CI checks the stated total of **154** rows.
- Copy quoted as exact is compared with `packages/copy/en.json` by `copy.test.ts`.

### 6.2 Evaluation and replay integrity

| Acceptance ID | Subsystem / Requirement | Test Input / Scenario | Expected Output | Telemetry / Assertion Metric | Phase Gate |
|---|---|---|---|---|---|
| AC-EVAL-01 | Dataset disjointness and N-pair relatedness (§2.2, §3.2) | All dataset files; R1-E N pairs with their group corpora | No shared `normLower` claim text, abstract, sentence or DOI across DEV, R1-E, PROBE pool, MS-B123, MS-B5, MS-SAN; each N pair's top `cov` ≥ the median top `cov` of the S pairs | `disjointness.ts` exit code 0; N-pair violations = 0 | Phase 0 |
| AC-EVAL-02 | Annotation agreement and independence (§3.4, §4.5) | A1/A2 labels on the purely stratified 45-pair subsample (15 per A1 label, from the 140 non-`S-GRAY` pairs); A2 labels on the 10 `S-GRAY` pairs; the 30-item B2 subsample; git authors of `r1e_v2.jsonl` and `/packages/prompts/` | κ ≥ 0.70 for both, or targeted adjudication completed (disagreed + same-subtype pairs; no full relabel); κ interval printed; `S-GRAY` agreement and Wilson upper bounds reported outside κ; A1, A2, A3 distinct and none a pair or prompt author; after a second failure `KAPPA_OK = false` | κ in `r1e_annotation.md` and `cf1.md`; `disjointness.ts --annotators` exit code 0; `KAPPA_OK` in `H4_DECISION.md` | Phase 0 |
| AC-EVAL-03 | Statistics correctness (§3.8, §4.2) | `stats_fixture.json`, `holm_fixture.json`, McNemar and permutation fixtures | Every fixture of §3.8 reproduced (including LB 11/15 = 0.4805, 15/15 = 0.7961, 16/16 = 0.8064, 15/20 = 0.5313, 16/20 = 0.5840, Wilson(28, 40) = [0.5457, 0.8193], Wilson(40, 50) = [0.6696, 0.8876], UB 0/100 = 0.0370, grey bounds 0.2775 / 0.5615 / 0.6576); the 8-row support-gate OC table to 3 decimals; Holm `0.010, 0.030, 0.040, 0.200 → 0.040, 0.090, 0.090, 0.200`; TypeScript equals Python to 4 decimal places | diff = 0 | Phase 0 |
| AC-EVAL-04 | Tiered freeze manifest and production equality (§2.3, §2.5) | Every R1-E, PROBE, CF-1, O2, DEV and R1-E-L2 manifest; the production Web and Android builds | `tier_a_hash` of every run equals the hash of `l0-freeze-a`; `tier_b_hash` and (CF-1) `cf1_baseline_hash` recorded; `samplingMode`, browser or AICore version, `baseModelName`, `calibratedVariant` and seeds recorded; the production Tier A hash equals the tag, the CF-1 baseline hash equals the locked one, and the Tier B hash equals the last one in `H4_DECISION.md` | compare = equal | Phase 1 |
| AC-EVAL-05 | Publication guard (§3.9) | `publish_routing.ts --confirm` with (a) `path = "A"`, `p_hat = 0.65`; (b) `authority.B3 = "authoritative"` with `cf1.B3 = { delta: 0.12, p: 0.04, p_holm: 0.12 }`; (c) `supportVerdicts = "authoritative"` with `wilson_lb_s = 0.79`; (d) `calibratedVariant.reasoningCap = 30` while the manifest records 40; (e) `authority.B5 = "authoritative"` with L1 `INCONSISTENT` precision below the baseline's; (f) `supportVerdicts = "authoritative"` with `ps_pairs = 15`, `ts_pairs = 15`; (g) `freeze.tier_a_hash` differing from `H4_DECISION.md`; (h) `path = "A"` with `KAPPA_OK = false` | All eight refused | exit code ≠ 0; Remote Config unchanged | Phase 1 |
| AC-EVAL-06 | Preregistration before CF-1 (§2.6, §4.3) | Git history of `/freeze/cf1_baselines.txt`, `eval-harness/reports/` and the CF-1 manifests; a test pull request changing a baseline file after the first CF-1 run | The `cf1_baseline_hash` commit and the power report commit precede the first CF-1 result commit; the power report lists power at Δ = 0.10/0.15/0.20 at both levels for `d × 0.5`, `1.0`, `1.5` and states the expected `advisory` outcome for B5 and O2; the test pull request fails CI | commit order; field presence; CI status | Phase 1 |
| AC-EVAL-07 | Production-like retrieval and `bm25_min_cov` calibration (§3.3, §3.11) | R1-E run configuration; `bm25_calibration.md`; bundled defaults; `/freeze/tier_a.txt` | Each group corpus has exactly 50 references; IDF and `avgdl` over it; Recall@5, retrieval-conditional precision and the NEI split reported; the chosen τ is the largest value with ≥ 95 % retention in every claim-length, unit-length and corpus-size stratum (or 0.25 when none qualifies), each stratum with its Wilson lower bound; the report states that the calibration is descriptive on DEV and not a population guarantee; τ equals the Tier A bundled value | config check; values; wording present; hash membership | Phase 0 |
| AC-EVAL-08 | False-support metrics and conservative precision in every output (§3.6, §3.7) | `r1e_{profile}.md`, `r1e_summary.json`, `H4_DECISION.md`, Proof mode, README | Each contains `P̂_S`, `WilsonLB95_S`, `PS_pairs`, `FSR_C`, `FSR_N`, the support-gate result with the stated expectation, and `P_LB(π)` next to every `P(π)`; no output contains a precision of 1.00 derived from zero false positives | field presence; grep = 0 | Phase 1 |
| AC-EVAL-09 | Holm per profile and B4 precision (§4.2, §4.5) | `cf1.md`, `cf1_summary.json`; Remote Config; meter fixture | Unadjusted p, Holm-adjusted p and the sorted order per profile with m = 4 (Web) and 5 (Android); authority uses the adjusted value; `Precision_B4` with its Wilson interval and recall on the 24 gold sentences; `b4_counts_in_review = false` iff `Precision_B4 < 0.60`, and then an `UNCITED_EMPIRICAL` clause keeps its blue chip and counts in `unchecked` | field presence; value consistency; meter count | Phase 1 |
| AC-EVAL-10 | O2 grid gate and Select-row reporting (§4.10, §4.11) | `o2.md`; Remote Config | Select-row accuracy with its interval always reported; `o2_grid_enabled = true` only if GridAccuracy ≥ 0.85 and CI95 lower bound ≥ 0.75; Select-row remains the primary flow | value consistent with report | Phase 1 |
| AC-EVAL-11 | R1-E-L2 is reporting only and non-grounded (§3.10) | R1-E-L2 run in `toulmin-staging`; captured requests; `r1e_l2.md`; README; `publish_routing.ts` | 150 requests, none with a `tools` field; post-checks with `layer = "L2"`; report contains `P̂_L2(C)`, `R̂_L2(C)`, `FSR_C_L2`, `FSR_N_L2` with Wilson intervals, the 4×3 confusion matrix, no-difference counts and cost; the report and every public citation state that it measures `l2AdjudicateProvided` and cannot be attributed to the grounded `l2Adjudicate`; no `routing_table` field depends on it | request scan; field and wording presence; publish diff = none | Phase 2 |
| AC-EVAL-12 | Tier B replay determinism and first-look reporting (§2.5, §2.6, §2.7) | One R1-E run directory replayed twice with the same `tier_b_hash`, once with a test Tier B constant change, once with a modified Tier A file, network disabled; `H4_DECISION.md` | Same-hash replays byte-identical; the test change produces a diff listing every changed verdict and metric with its replay diff hash; the Tier A change stops with `TIER_A_MISMATCH`; no network request; `H4_DECISION.md` shows first-look and replayed metrics in adjacent columns with `tier_a_hash`, `cf1_baseline_hash`, every `tier_b_hash` and every replay diff hash | byte compare; network log = 0; field presence | Phase 1 |

### 6.3 L0 deterministic engine and reducer

| Acceptance ID | Subsystem / Requirement | Test Input / Scenario | Expected Output | Telemetry / Assertion Metric | Phase Gate |
|---|---|---|---|---|---|
| AC-L0-01 | Cross-platform conformance | `conformance/l0/*.json` | TypeScript and Kotlin outputs equal expected for every file; Swift for `norm`, `segment`, `anchor`, `reducer` | 100 % pass per language | Phase 0 (Tier A files) / Phase 1 (Tier B files) / Phase 2 (Swift) |
| AC-L0-02 | Segmentation [02 › Rule-Based Sentence Segmentation] | "…by 30% (Smith et al., 2020). However, …" | 2 sentences; the citation stays in sentence 1; "et al." is no boundary | golden match | Phase 0 |
| AC-L0-03 | Clause mapping | "Drug X reduced mortality by 30% [1] but increased bleeding [2]." | 2 clauses mapped to [1] and [2] | golden match | Phase 0 |
| AC-L0-04 | Narrative citation | "Smith et al. (2020) found no effect of X on Y." | Claim "found no effect of X on Y" mapped to (Smith, 2020) | golden match | Phase 0 |
| AC-L0-05 | BM25 and claim coverage | Golden corpus and query; the worked example of [02 › Worked normative example (`conformance/l0/bm25.json`)] | Scores equal golden values with k1 = 1.2, b = 0.75; ranking by `gridKey(score)`, then source kind, then unit ordinal; `cov` over claim word terms only; a unit discarded only if `cov < bm25_min_cov` **and** fewer than 2 shared claim stems; the quantity bonus only with a shared key lemma | max abs diff ≤ 1e-9; order equal; kept set equal | Phase 0 |
| AC-L0-06 | Anchor: negation parity | Evidence "We found no significant difference in 30-day mortality (12.1% vs 12.4%)." with a span without "no"; negation cue 1–4 tokens right of the window; scope negation beyond the margin; "non-significant" | `NEI` (`NEGATION_PARITY`) in every case where the span drops the negation | `anchorFailReason` | Phase 1 |
| AC-L0-07 | Anchor: clause stop and mid-dot decimals | "In non-diabetic patients, the intervention reduced HbA1c by 0.4%."; "18·2%" vs span "18.2%" | `SUPPORTED` with the highlight snapped to the exact substring; mid-dot decimal `SUPPORTED` | snapped range = golden | Phase 1 |
| AC-L0-08 | Anchor: numeric and claim↔span parity | Example 11 ("12.1%" vs "2.1%"); example 6 (claim 40 % vs span 30 %, decoded `SUPPORTED`); example 7 (same, decoded `CONTRADICTS`); example 7b (percentage vs duration); example 7c (no shared content stems); example 17 (`30%` vs `30 days`) | 11: `NEI` (`NUMERIC_PARITY`); 6: `NEI` (`CLAIM_SPAN_MISMATCH`); 7: `CONTRADICTS` kept; 7b: `NEI` (`CLAIM_SPAN_MISMATCH`); 7c: `NEI` (`LOW_CLAIM_OVERLAP`); 17: `NEI` (`CLAIM_SPAN_MISMATCH`) | reasons and verdicts | Phase 1 |
| AC-L0-09 | No-difference rule and measure valence | `anchor.json` cases: claim = span with decoded `CONTRADICTS` (L1 and L2); subject swap without values (L1 and L2); identical values in a different order (L2); identical values in the same order (L2); `increased pain` vs `improved pain`; `decreased mortality` | L1: `NEI` (`NO_DIFFERENCE_SIGNAL`) whenever no value, negation or direction difference exists; L2: downgrade only for the identical clause and for same kind + identical values + same order, otherwise `CONTRADICTED` kept with `noDifferenceNote = true`; valence of adverse measures applied | verdicts; reasons; note flag | Phase 1 |
| AC-L0-10 | Ingestion: LaTeX archive | Archive with an `\input` chain of depth 3, two `.bib` files, `\bibliography{a,b}` | Main file found; all inputs resolved; `file:line` round-trips through the offset map; all entries parsed | counts; round-trip test | Phase 2 |
| AC-L0-11 | Ingestion guards | Archives exceeding each limit separately: 201 MB; 5,001 entries; one 21 MB entry; compression ratio 101; 51 MB extracted text; a `..` path; `\input` expansion over 2 MB | Each rejected with its exact copy [06 › Import]; nothing written outside the import sandbox | error code per case | Phase 2 |
| AC-L0-12 | `.docx` field codes | `.docx` with 5 `ZOTERO_ITEM` citations | 5 DOIs extracted and mapped to text positions | count = 5 | Phase 2 |
| AC-L0-13 | B5 deterministic and incremental pairing | (a) n = 48 (Methods) vs n = 48.0 (Abstract); (b) 37 % vs 0.37 sharing all key lemmas; (c) `b5_incremental.json`: adding, editing and deleting tuples in every order; (d) 1 new tuple with 7 divergent candidates | (a) consistent by value, no L1 call; (b) never paired (different families), no `b5_checks` row; (c) the same kept pairs as a full recomputation; (d) ≤ 3 B5 jobs enqueued | L1 call count; pair count; job count | Phase 1 |
| AC-L0-14 | Reducer rules | `conformance/l0/reducer.json`: one case per rule R1–R14 and C0–C16 (including C4b, C14b), `EVIDENCE_FOUND_LOCAL`, `LOCAL_EVIDENCE`, physical results with and without entailment confirmation, R12 with `selection.candidates = 0`, a stale selection, `session.localUnavailable`, three transient attempts, a local result of a profile absent from the table, C1 across the state family (`WAITING` → `UNVERIFIABLE`), C4b on `METHODOLOGICAL` vs `NON_EMPIRICAL`, an override over `CONTRADICTED` | Derived `RefState` and `ClauseState` equal golden | 100 % match | Phase 1 |
| AC-L0-15 | ReDoS fuzz (D-27; §6.9 procedure 1) | Every L0 pattern and scanner on the generated adversarial corpus | Each input ≤ 5 ms per 10 KB on PC Ryzen 7 (Node.js 22); no pattern contains nested unbounded quantifiers | max time; static check exit code 0 | Phase 0 |
| AC-L0-16 | Reducer order independence (§6.9 procedure 2) | Random event multisets over **E1–E16 and E6b**, each event carrying its emitted `seq`, in 20 random arrival permutations, always including E4↔E15, E6↔E6b, E5↔E9 and E12↔E1 | Identical facts (`refFacts`, every `Versioned<T>` including `selection` and `override`, the result cache) and identical `derive()` outputs under every `PolicySnapshot`, `PrivacyContext` and `SessionFacts`; tie-breaks by `sha256hex(JCS(result))`; duplicates idempotent; E1 never changes reference facts | mismatches = 0 | Phase 1 (1,000 cases) / Phase 3 (10,000 cases) |
| AC-L0-17 | Math participates in identity | Sentence with `$p<0.05$`, then edited to `$p<0.01$` | `normSentence` and the sentence hash change; the old result is not reused; a new Stage 2 job is enqueued | job enqueued; old `resultKey` not applied | Phase 0 |
| AC-L0-18 | Reference-problem precedence | Retracted reference; then local `SUPPORTED`; then cloud `SUPPORTED` | Clause stays `REFERENCE_PROBLEM`; per-reference states visible in the inspector | state unchanged | Phase 2 |
| AC-L0-19 | Coverage Meter partition and 7-count header (§6.9 procedure 3) | Random ledgers in both modes, with and without an exhausted pool, with `b4_counts_in_review` true and false | The eight bucket counts sum to `total`; the seven header counts (`supported`, `reviewed`, `problems`, `to_review`, `waiting`, `unverifiable`, `notYetChecked = local + unchecked`) sum to `total`; `reviewed` never inside `notYetChecked` and never in `supported`; an exhausted pool never moves a clause out of `waiting`; `notCheckable` and `numberMismatches` are not buckets | invariant violations = 0 | Phase 1 |
| AC-L0-20 | A clause with no matching passage is never stuck | Reference with evidence units none of which passes the coverage filter; then the same with a selection for an older `evidenceVersion` | First: `selection.candidates = 0`, no Stage 2 call, the pair is `WAITING` (cloud available) or `UNVERIFIABLE`, the inspector shows "No passage of this source matches the claim", **never `UNCHECKED`**; second: the stale selection is ignored and a new selection enqueued | state; job log | Phase 1 |
| AC-L0-21 | Claim hash keeps signs and decimals (token-based) | `conformance/l0/claimhash.json`: `.5%` / `5%`; `1,5` / `15`; `-5` / `5`; `−5` / `-5`; `0.50` / `0.5`; two numbers in different order | First three pairs: different `normalizedClaimHash`; `−5` = `-5`; `0.50` = `0.5`; different order → different hash | hash equality per pair | Phase 0 |
| AC-L0-22 | Numeric citation Rule 2 | `30% [1]`; **`30% [1, 2].`**; **`Table 2 [3, 7].`**; `social [3]`; `species [4]`; `in 2019 [3]`; `95% CI [12, 45]`; `IQR [3, 7]`; `median 5 [3, 7] days`; Markdown link `[2](https://example.org)` | The first six are numeric citations; `95% CI [12, 45]`, `IQR [3, 7]`, `median 5 [3, 7] days` and the Markdown link are not | marker list equals golden | Phase 0 |
| AC-L0-23 | Heuristic markers never red | Document without matching `.bib` entries: `(March 2020)` and `(Table 2020)` (rejected non-citations); `WHO (2020)`, `(Smith 2020)`, `(Jones et al., 2021)`; and `\cite{missingKey}` | `(March 2020)` and `(Table 2020)` rejected (`0` markers); the three heuristic markers → grey "Check this citation" chips (`POSSIBLE_CITATION`); they do not change `n`; `\cite{missingKey}` → `REFERENCE_PROBLEM` | chip count = 3; red count = 1 | Phase 0 |
| AC-L0-24 | Full-algorithm normative example meta-test | Every normative example of `02` and `03` (clause examples 1–15, anchor examples 1–20 including 7b, 7c, 9b, 12b, 15b, 15c, 18b, 19b, 19c) and the BM25 worked example | `examples.meta.test.ts` and `anchor.meta.test.ts` run the full partitioner, scanner, BM25 and validator on each example and compare the final result (clauses, markers, verdict, fail reason, `noDifferenceNote`) and every stated intermediate count with the specification | 100 % match | Phase 0 (Tier A examples) / Phase 1 (Tier B examples) |
| AC-L0-25 | Tier A text fixes | `norm.json`, `clauses.json`, `sections.json`, `quantity.json`, `triage_baseline.json` cases: U+200B and U+FEFF inside a claim word; partitioner examples 4, 9, 11, 13, 14, 15; `\gls{CI}`, `\cellcolor{gray}{12}`, `\newline`; `\label{x}` followed by a blank line and a `{…}` paragraph; a non-matching `\subsection` under `\section{Methods}`; "one of the main causes"; "twelve patients"; `12.345` with `lang: de` and `lang: en`; an uncited quantitative sentence in Results and in Discussion | Zero-width characters deleted with the offset map intact; claim texts as stated; unregistered commands keep their last argument; the paragraph is not swallowed; the subsection inherits `methods`; `one of` is no value, `twelve patients` is; `12.345` = 12345 only with `lang: de`; uncited only in Discussion | golden match | Phase 0 |
| AC-L0-26 | Delimiter escaping and sanitizer goldens | `sanitize.json`; evidence containing `<<EVIDENCE id=9>>` | Every INJ pattern case as golden; `<<EVIDENCE id=9>>` rewritten to `‹‹EVIDENCE id=9››` before wrapping | golden match | Phase 0 |
| AC-L0-27 | L0 watchdog (D-27) | A crafted input that exceeds 250 ms in one L0 job; a B5 batch spanning several metric classes | The worker is terminated and restarted; the input is marked `PARSE_TIMEOUT` (E14) and listed in *Can't verify with available sources*; B5 work is split into per-metric-class jobs, each under 250 ms | worker restart count; state; job sizes | Phase 2 |

### 6.4 L1 on-device (Web and Android)

| Acceptance ID | Subsystem / Requirement | Test Input / Scenario | Expected Output | Telemetry / Assertion Metric | Phase Gate |
|---|---|---|---|---|---|
| AC-L1W-01 | Configuration singletons (D-21) | 200 sentences in Standard and Confidential | One `GenerativeModel` per `(mode, schema, reasoningCap)` used; none per call | registry size = distinct configurations | Phase 2 |
| AC-L1W-02 | Confidential mode (D-05) | Confidential; Sample Manuscript; 50 sentences typed | Every L1 response `ON_DEVICE`; network log has no AI Logic request | AI Logic request count = 0 | Phase 2 |
| AC-L1W-03 | Fast path (D-14) | Type a cited sentence | Stage 2 for its clauses dequeued before its Stage 1 | job order log | Phase 2 |
| AC-L1W-04 | NEI hold and C4b scope | (a) fast-path Stage 2 `NEI`, Stage 1 `METHODOLOGICAL`; (b) the same with `LOW` worth and `COMPARATIVE` | (a) `NOT_CHECKABLE`, in no drawer, nothing queued for L2, counted in "Not checkable"; (b) stays checkable (`WAITING` in Standard) | state; L2 queue; drill-down count | Phase 2 |
| AC-L1W-05 | Cancellation by hash | Edit a sentence while its Stage 2 is in flight | Result discarded on arrival; new job enqueued | discard counter + 1 | Phase 2 |
| AC-L1W-06 | Key order and schema validation | Test double returning `s04` before `s01` | Verdict forced to `NEI_SILENT_ESCALATE` | `KEY_ORDER_VIOLATION` count | Phase 2 |
| AC-L1W-07 | Latency reporting | 50 cited sentences on PC Ryzen 7 | Stage 2 p95 ≤ 6 s with the calibrated variant (or the S-W4 fallback active and recorded); Proof mode shows measured p50/p95 with the Chrome version | Proof values = harness values | Phase 2 |
| AC-L1W-08 | No-model cadence | ThinkPad, Standard, consent class A given | `PREFER_ON_DEVICE` calls return `IN_CLOUD`; paragraph cadence; audit paused | cadence flag; `inferenceSource` | Phase 2 |
| AC-L1W-09 | No cloud on a capable device (D-05) | PC Ryzen 7, Standard; test double makes the on-device call return `BUSY`, then time out | No cloud request for the local stage; quiet escalation | AI Logic cloud request count = 0 | Phase 2 |
| AC-L1W-10 | L1 deadline, every early stop and `LOCAL_STALLED` (D-28) | Test doubles: a never-resolving call; two consecutive; three episodes within 10 min; a stream cut by the character limit; an SDK error; each with `l1_slot_release = IMMEDIATE` and `ON_SETTLE` | After `l1_deadline_ms` the job ends `DEADLINE` (no `LocalResult`, no cache row); with **`ON_SETTLE`** no call is dispatched before the stopped call settles — for the deadline, the cut **and** the error alike; 2 consecutive expiries → `LOCAL_STALLED`, no L1 dispatch for 60 s from slot release; 3 episodes → no-local-model handling with **no** cloud request for local stages; no timer outlives its call | dispatch log; cache rows = 0; cloud requests = 0; open timers = 0 | Phase 2 |
| AC-L1W-11 | No dispatch while downloading | Readiness `downloading` with 20 queued jobs | No L1 call until `available`; exact downloading chip text; reference checks continue | L1 call count = 0 | Phase 2 |
| AC-L1W-12 | Settle ceiling and recovery (Web) | Test double whose stopped call never settles; a later reload | After **120 s**: `session.localUnavailable = true`, `LOCAL_LOST`, chip *"On-device model stopped responding — reload to retry"* with **Reload**; no further L1 call; pairs without a local result follow R12; no cloud request for local stages; after reload on-device checking works again | state; copy; dispatch log; cloud requests = 0 | Phase 2 |
| AC-L1W-13 | Transient outcomes excluded from dedup | A pair whose first call hits the deadline; its late output arriving after the retry was enqueued | No persisted `results` row for the failed attempt; retried (≤ 2 per session); the late output cached under its own `resultKey` (`putLate`) and materialized; the transient record cleared | cache rows; retry count; state | Phase 2 |
| AC-L1W-14 | Degraded boot | Clean Chrome profile with the model installed: (a) network disabled before load; (b) online with `www.google.com/recaptcha/` and `www.gstatic.com/recaptcha/` blocked; (c) sign-in failure after load | Editor and sample open; L0 and `ONLY_ON_DEVICE` checks run; the chip *"Cloud features aren't available in this browser"*; cloud buttons disabled with their tooltip; no unhandled rejection, no blocking spinner; (b) after unblocking and clicking the chip, sign-in succeeds | console errors = 0; L1 calls > 0; copy match | Phase 2 |
| AC-L1A-01 | Tier cascade (S-A1) | Fresh install on Xiaomi 15T Pro; then Airplane Mode | `PREVIEW` fails, `STABLE` active (or the recorded tier); Airplane Mode calls `ON_DEVICE` | tier; `inferenceSource` | Phase 2 |
| AC-L1A-02 | `BUSY` back-off | Simulated `BUSY` ×3, then success | Re-enqueued at 250, 500, 1,000 ms (±20 %); slot released during waits; success; no cloud call | retry log | Phase 2 |
| AC-L1A-03 | Foreground only | App backgrounded during the queue | Queue pauses after the current call (`ON_STOP`) and resumes on `ON_START` | scheduler state | Phase 2 |
| AC-L1A-04 | `@Generable` schemas (S-A2) | Each schema 20× on device | 20/20 decode (primary or the recorded flat fallback) | decode rate | Phase 2 |
| AC-L1A-05 | Android settle ceiling, mutex and cancellation | Test double whose stopped call never settles; scheduler scope cancelled during the deadline wait and during the settle wait | After 120 s `SLOT_LOST`, mutex released, later calls return `SLOT_LOST` immediately; `CancellationException` propagates from both waits and the mutex is released; after app restart on-device checking works | mutex state; exception type; dispatch log | Phase 2 |

### 6.5 L2 cloud and grounding

| Acceptance ID | Subsystem / Requirement | Test Input / Scenario | Expected Output | Telemetry / Assertion Metric | Phase Gate |
|---|---|---|---|---|---|
| AC-L2-01 | Exact-text approval (D-09) | Batch consent sheet; edit one row | The request contains exactly the edited text and its reference evidence and no other manuscript text; the result binds to the SHA-256 of the sent text (E7) | captured request body (staging) | Phase 2 |
| AC-L2-02 | Lease required | `quotaGuard` returns `POOL_EXHAUSTED` | No L2 call; exact pool-exhausted copy | L2 call count = 0 | Phase 2 |
| AC-L2-03 | Telemetry (D-19) | 5 L2 checks | Every response `inferenceSource = "IN_CLOUD"`; Proof cloud counter + 5 | 5/5 | Phase 2 |
| AC-L2-04 | Single call or recorded fallback (S-L2) | 10 L2 checks | Schema mode: valid `L2Verdict` with grounding metadata; text-JSON mode (only if S-L2 failed): exactly one call per check without `responseSchema`, L0 repair, unrepairable → `NEI`; no grounded output ever reaches a second model call; `maxOutputTokens = 2048`; `thinkingConfig: { thinkingLevel: "LOW" }` or none, as recorded; no `thinkingBudget`, no `MINIMAL` | mode = S-L2 record; calls per check = 1; request fields | Phase 2 |
| AC-L2-05 | Quote anchoring, refined L2 no-difference rule and `WEB_SOURCE` | Test doubles: (a) `PROVIDED_EVIDENCE` quote absent from the evidence; (b) `CONTRADICTED` whose quote equals the claim; (c) `CONTRADICTED` on a subject swap with no values; (d) `WEB_SOURCE` quote | (a) downgraded to `NEI`; (b) `NEI` (`NO_DIFFERENCE_SIGNAL`); (c) `CONTRADICTED` kept, `noDifferenceNote = true`, exact inspector line; (d) stored as `NEI` with the label *"Web sources only — doesn't change this claim's status"* and **Re-run check hidden** until the reference's `evidenceVersion` changes | verdict; note; button visibility | Phase 2 |
| AC-L2-06 | Alternatives | Response with 2 DOIs, 1 invalid | 1 linked after `bibResolve`; 1 discarded and never displayed | UI state | Phase 2 |
| AC-L2-07 | Client kill-switch behaviour | Publish `kill_switch_cloud = true` | After the client activates the config, no new L2 or ALT request starts and the exact copy is shown; no client time bound is promised (cost is bounded server-side and by caps) | requests after activation = 0 | Phase 3 |
| AC-L2-08 | One-click sample grounding split (D-26) | Standard, Sample Manuscript, anonymous UID; then a judge UID after the public sample pool is exhausted | Exactly 5 requests per run: items 4 and 5 with `tools: [{ googleSearch: {} }]` and non-empty `searchEntryPoint`; the three clean claims with no `tools` and the line *"Checked against the paper's text only (no web search)."*; the anonymous run draws 1 sample run; the judge run succeeds from the judge pool (5 leases) | request scan; UI state; lease pool | Phase 2 |
| AC-GND-01 | Zero persisted grounded text or links (D-19) | 5 L2 checks with web-grounded results; scan Firestore, Storage, IndexedDB (Dexie), Room, SwiftData, logs and all exports | No grounded text, `searchEntryPoint` content or grounding link in any store, log or export; after reload only the verdict and the paper-anchored quote remain | occurrences = 0 | Phase 2 |
| AC-GND-02 | Grounding display rule (D-22) | A grounded result; a reload of the same document | Search Suggestions rendered from the **unmodified** `renderedContent` in a sandboxed iframe whose `src` is a Blob URL (no `srcdoc`, revoked on close); sources list built with DOM APIs; after reload the neutral label *"Checked in the cloud on {date} — re-run to see sources"* with **Re-run check** | DOM snapshot; byte compare of `renderedContent`; copy match | Phase 2 |

### 6.6 L3 policy and calibration

| Acceptance ID | Subsystem / Requirement | Test Input / Scenario | Expected Output | Telemetry / Assertion Metric | Phase Gate |
|---|---|---|---|---|---|
| AC-L3-01 | Bundled defaults offline | First launch offline | Every profile Path B, every task `advisory`; no `HINT`; Remote Config not awaited at boot | hint count = 0; boot not blocked | Phase 2 |
| AC-L3-02 | Gate guard, freeze check and unknown profile | (a) table with `path = "A"` and `stability = 0.55`; (b) table whose `freeze.tier_a_hash` differs from the client build; (c) a cached local result from a profile absent from the table | (a) Path B, `ROUTING_GATE_MISMATCH` logged; (b) **table refused**, bundled defaults kept, `FREEZE_MISMATCH` logged; (c) judged with the conservative profile (Path B, advisory) | log; path; state | Phase 2 |
| AC-L3-03 | Hint only when allowed | Path A profile; calibrated variant; local `CONTRADICTS` | `HINT` mark; listed first and **not** pre-selected in the batch consent sheet; `CONTRADICTED` only after L2 `CONTRADICTED` | state sequence; selection state | Phase 2 |
| AC-L3-04 | Path B never accuses | Path B profile; local `CONTRADICTS` | No inline mark; `WAITING` (Standard) or `UNVERIFIABLE` (Confidential) | inline mark count = 0 | Phase 2 |
| AC-L3-05 | Probe non-blocking | Type continuously for 60 s after the model is ready | No probe call while P0–P4 jobs exist or within 10 s of a keystroke | probe timestamps | Phase 2 |
| AC-L3-06 | Probe validity | Force `IN_CLOUD` during the probe | Probe invalid → `NO_LOCAL_MODEL` | state | Phase 2 |
| AC-L3-07 | Probe drift | Expected labels altered so 4 probe pairs disagree | `READY_DRIFTED`; existing hints disappear immediately (E15) | state; hint count = 0 | Phase 2 |
| AC-L3-08 | Download needs a gesture | `downloadable` readiness | "Enable on-device verification" card; `initializeDeviceModel` called only from the click handler | user-gesture assertion | Phase 2 |
| AC-L3-09 | Authority and support guards | (a) `authority.B3 = "authoritative"` with `cf1.B3 = { delta: 0.12, p: 0.04, p_holm: 0.20 }`; (b) valid `authority.B3 = "authoritative"` but `supportVerdicts = "advisory"`, then a local `SUPPORTED` in Standard and Confidential | (a) B3 `advisory`, `AUTHORITY_MISMATCH` logged; (b) the on-device span shown as evidence, but the clause is `WAITING` or `LOCAL_EVIDENCE`, never `SUPPORTED_LOCAL` | log; state | Phase 2 |
| AC-L3-10 | Uncalibrated variant downgrade (D-08) | Path A profile with authoritative support and `calibratedVariant = { VerdictV1, 40 }`; force (a) `VerdictV1_cap20`, (b) `reasoning_word_cap = 30` without a matching table, (c) a flat fallback schema | No `HINT` and no `SUPPORTED_LOCAL` from any: `CONTRADICTS` → quiet escalation, `SUPPORTED` → `WAITING` / `LOCAL_EVIDENCE`; `UNCALIBRATED_VARIANT` recorded; Proof mode shows the variant share | states; reason counts | Phase 2 |

### 6.7 Cloud Functions, security, cost and injection

| Acceptance ID | Subsystem / Requirement | Test Input / Scenario | Expected Output | Telemetry / Assertion Metric | Phase Gate |
|---|---|---|---|---|---|
| AC-FN-01 | `bibResolve` cascade | 20 DOIs in OpenAlex; 5 whose abstract only Semantic Scholar has; 5 raw strings resolved by Crossref | All resolved; source recorded per item; Semantic Scholar ≤ 1 req/s; quota reserved before upstream and refunded for unresolved transient items | per-item source; request timestamps; counters | Phase 2 |
| AC-FN-02 | Tolerant `METADATA_MISMATCH` and `doi.org` 1 / 100 / 200 | `.bib` title with `titleSim < 0.5`; a subtitle-only difference; a consortium author; a SICI DOI with `<`, `>`; an explicit DOI absent from every index with handle `responseCode = 1`; one with `200`; one with `100`; a reference without DOI matched by no index | First → `METADATA_MISMATCH` (amber "Check metadata", never red); subtitle and consortium → `RESOLVED`; SICI DOI used verbatim; 1 and 200 → `NOT_INDEXED` (never red); 100 → `DOI_NOT_FOUND` (red); no-DOI unmatched → `NOT_INDEXED` ("Check this citation") | statuses | Phase 2 |
| AC-FN-03 | No abstracts server-side (D-11) | After 100 resolutions, scan Firestore | No document contains abstract text; `/refmeta` holds public fields only | count = 0 | Phase 2 |
| AC-FN-04 | `oaFetch` licence gate, arXiv lock and parser lanes | CC-BY JATS article; bronze-OA PDF; CC-BY-NC article; arXiv CC-BY preprint; arXiv non-exclusive preprint; 12 concurrent anonymous requests; one judge request during them; a PDF whose page-1 DOI differs | CC-BY JATS and the arXiv CC-BY preprint parsed by `oaParse` and cached at `/oa/{refIdHash}/chunks.json`; others returned with `cached: false` and not stored; arXiv requests spaced ≥ 3 s via `/global/arxivLock`; anonymous requests wait on the semaphore (3 per instance), a wait > 20 s returns `PARSER_BUSY` with quota refunded; the judge request is parsed by `oaParseJudge` without waiting; the DOI mismatch returns `IDENTITY_MISMATCH` with nothing cached | Storage object count; timestamps; parser service per request | Phase 2 |
| AC-FN-05 | SSRF guard and forged fields | Upstream locations resolving to 169.254.169.254, 10.0.0.1, `::1`, `::ffff:10.0.0.1`, `64:ff9b::a00:1`, `fec0::1`, a 6to4 and a Teredo address, `metadata.google.internal`, a DNS rebind to a private address, 4 redirects; a request `{ refId, url: "http://evil", license: "cc-by" }` | All refused before connect; the pinned IP is used; the 4th redirect refused; extra fields rejected with `invalid-argument`, location and licence server-derived | error class; upstream host log | Phase 2 |
| AC-FN-06 | `redeemJudgeCode` | Valid code from 5 UIDs; same code from a 6th UID; disabled code; malformed code; lower-case code with spaces; `/?code=TLMN-…` | UIDs 1–5 → claims `{ tier: "judge", codeId, tierExp: JUDGE_TIER_EXPIRY_EPOCH }`; the others → generic `INVALID_CODE` and the exact recovery copy; `maxInstances = 3`; the URL parameter is ignored and the code never stored in localStorage, IndexedDB, logs or analytics | claims; error text; storage scan | Phase 2 |
| AC-FN-07 | `budgetBreaker` and `recaptchaBreaker` | Test messages: `ai-logic` at 0.26, 0.51, 0.76, 0.91; `gross` at 0.51, 0.82, 1.01; `uncapped` at 0.81, 1.01; `recaptcha` at 1.0 (staging) | `ai-logic`: public pools halved, then zeroed with sample 20 → 10, then sample 0 with judge 600 preserved, then judge 300 and `kill_switch_cloud`; `gross`: alert, kill switch, `hardStop`; `uncapped`: alert, `hardStop`; `recaptcha`: staging Web key disabled within 10 minutes; `/global/state.pools` honoured within 60 s; idempotent | `/global/state` values; Remote Config; key state | Phase 3 |
| AC-FN-08 | Server-side `kill_switch_cloud` | A client that never fetches Remote Config requests leases while `/global/state.killSwitch = true` | Every request refused with `KILL_SWITCH` within 60 s; no lease document written | status codes; Firestore scan | Phase 2 |
| AC-FN-09 | Retraction freshness | `/refmeta` document 8 days old whose reference is retracted in the latest snapshot; a 6-day-old document | The 8-day hit re-runs the retraction checks and returns `isRetracted = true`; the 6-day hit returns without re-check | status; upstream call count | Phase 2 |
| AC-FN-10 | Transient errors never red; no payload logging | Upstream 503 and 429; all functions with fixture data | `UPSTREAM_UNAVAILABLE` / `RATE_LIMITED`, clause `WAITING`, no red mark; logs contain no title, raw reference, claim or abstract text | status; mark; grep = 0 | Phase 2 |
| AC-SEC-01 | App Check enforcement (D-18) | Calls to AI Logic, Firebase Authentication sign-up, Firestore, Storage and each callable without a token | All rejected (Authentication per BE-3; otherwise the recorded fallback) | status codes | Phase 2 |
| AC-SEC-02 | Consumed-token rejection | (a) static check that `rejectReplay(request)` is the first statement of every `CONSUMING` handler; (b) replay captured `quotaGuard` and `redeemJudgeCode` requests with the same token | (a) pass; (b) rejected with `REPLAYED_TOKEN` (`request.app.alreadyConsumed`) | lint exit code; status codes | Phase 2 |
| AC-SEC-03 | Limited-use tokens for AI Logic | 20 AI Logic requests per client at the minimum SDKs | Every request carries a limited-use token | token type per request | Phase 2 |
| AC-SEC-04 | Production CSP, headers and Trusted Types | Production headers; a test hook attempting an `innerHTML` string assignment; every screen in normal use | Exact policy of [05 › Production `firebase.json` (MUST be exactly enforced)]; Referrer-Policy, nosniff, Permissions-Policy, COOP present; **no `report-to`, no `Reporting-Endpoints`**; the assignment blocked by Trusted Types; zero violations | header compare; violation count = 0 | Phase 3 |
| AC-SEC-05 | Grounding iframe sandbox under CSP | `renderedContent` containing `<script>`; a real grounded result on production | Script does not run; links open in a new tab; no element ever has `srcdoc` (mutation observer); zero CSP/Trusted Types violations | script flag = false; counts = 0 | Phase 3 |
| AC-SEC-06 | Firestore and Storage rules and TTL | Emulator suite: any client write; cross-user reads of quota or leases; reads of `/global/**`, `/netCounters`, `/refmeta`, `/judgeCodes`; Storage reads of `/oa/**` and outside `/rw`; TTL configuration | All client writes denied; a client reads only its own quota and leases; `/global/**` unreadable; network counters stored as 4 shards per network and day; only `/rw` readable by signed-in users; TTL policies leases 24 h, quota 3 d, netCounters 3 d, refmeta 30 d, shards 30 d configured | rules tests 100 %; TTL config | Phase 2 |
| AC-SEC-07 | Harvested-token replay to AI Logic | Capture an AI Logic request with its limited-use token; replay with `curl` | Rejected | status code | Phase 3 |
| AC-SEC-08 | Pool and lane isolation | Exhaust the anonymous L2 pool (40), the anonymous `oaFetch` cap (200) and the public sample pool (20 runs); saturate anonymous `bibResolve` and `oaParse` | Anonymous UIDs refused `POOL_EXHAUSTED`; judge UIDs still get leases (including sample runs from the judge pool); judge lanes respond within their p95; anonymous callers of judge lanes refused; judge callers of public lanes get `USE_JUDGE_LANE` | judge leases > 0; lane status codes | Phase 3 |
| AC-SEC-09 | Forged `X-Forwarded-For` (BE-1) | Requests from one real client with forged left-most entries (private, public, 5 entries) | The network hash equals that of the real client in every case; per-network limits apply to the real network | hash equality | Phase 3 |
| AC-SEC-10 | Functions spend-cap behaviour **(manual)** | Staging project with a US$1 Functions cap driven to the cap | Callables fail with the recorded error; the Web shows *"Cloud features are paused for a short time. On-device checks still work."*; on-device checks keep working; after the lift, the judge-lane smoke test passes; recovery time recorded | screen capture; runbook entry | Phase 3 |
| AC-SEC-11 | Per-class service accounts and secrets | Deployed IAM policy, secret bindings and function list vs `/infra/iam/service-accounts.yaml` | Each function runs as its class account (`bib-sa`, `oafetch-sa`, `oaparse-sa`, `quota-sa`, `judge-sa`, `ops-sa`); `JUDGE_CODE_PEPPER` readable only by `judge-sa`; every secret only by its listed accounts; no public HTTP function | `tools/check-iam.ts` exit code 0 | Phase 2 |
| AC-SEC-12 | Private `oaParse` IAM rejection (BE-4) | Unauthenticated `curl`, an end-user Firebase ID token, another service account, and `oafetch-sa` calling `oaParse` and `oaParseJudge` | 403 for the first three; success only for `oafetch-sa`; `oaparse-sa` holds zero roles and zero secrets; the parser bundle imports no HTTP client, Secret Manager client or Admin SDK | status codes; IAM dump; bundle import check | Phase 2 |
| AC-SEC-13 | Zero production `cspReport` | Production function list and production `firebase.json`; staging preview build | No CSP reporting function, route or header in production; `cspReportStaging` deployed only in `toulmin-staging`; `tools/csp-hash.ts --verify` confirms parity (production = preview minus the reporting suffix) | function list scan; verify exit code 0 | Phase 3 |
| AC-SEC-14 | No VPC connector; BE-5 wording | Project resources; `/docs/spikes/BACKEND.md`; README and `SECURITY.md` | No Serverless VPC Access connector exists; Direct VPC Egress enabled only if BE-5 recorded zero fixed cost; the parser described as "separated from credentials" (and as network-isolated only if BE-5 passed) | resource scan; wording check | Phase 3 |
| AC-SEC-15 | Release-artifact scan (zero debug tokens, no secrets) | `tools/scan-artifacts.ts` over the Web build, the `bundledSample` APK/AAB, the iOS build and every artifact published to Devpost, GitHub Releases and Firebase Hosting | No debug provider class, no debug-token string, no `FIREBASE_APPCHECK_DEBUG_TOKEN`, no API secret, service-account key, `.env` content, pepper or judge code; **no exception** | exit code 0 | Phase 3 |
| AC-SEC-16 | Judge-code revocation and expiry | Disable a redeemed code; clear its UIDs; a code whose `exp` has passed in a test project with a past `JUDGE_TIER_EXPIRY_EPOCH` | Judge access ends for every UID within 60 s (`quotaGuard`, `bibResolveJudge`, `oaFetchJudge`); an expired code returns `INVALID_CODE`; CI rejects a production parameter file whose `JUDGE_TIER_EXPIRY_EPOCH` is not later than the deploy time | lease status; latency; CI status | Phase 3 |
| AC-SEC-17 | No hardcoded dates, secrets, prompts or copy | Lint over the repository | No ISO-date or epoch literal outside `/conformance` and `/eval-harness/fixtures`; no secret in the repository; prompts and schemas only from their packages; user-facing strings only from `en.json` | lint exit code 0 | Phase 2 |
| AC-SEC-18 | `bundledSample` zero-network verification (S-A5) | Sideloaded release `bundledSample` APK; full O1–O4 session and one local file import, with a network capture in Airplane Mode and again with Wi-Fi on; static inspection of the APK and its dependency graph | Zero outbound connections from the app UID in both captures; every check `ON_DEVICE` through `Firebase.ai(...)` `ONLY_ON_DEVICE`; no Firestore, Functions, Authentication, App Check, Play Integrity, Remote Config fetch or Storage client in the dependency graph or initialization; no debug provider or token | connection count = 0; dependency check; scan exit code 0 | Phase 2 |
| AC-COST-01 | Anonymous per-UID quota | One anonymous UID requests 11 L2 leases in a day | Lease 11 refused `QUOTA_EXCEEDED` with `resetsAt` | count; field | Phase 3 |
| AC-COST-02 | Per-network quota | 3 anonymous UIDs on one prefix request 21 L2 leases in total; 3 UIDs on one prefix request 3 sample runs | L2 lease 21 refused `NET_LIMIT`; sample run 3 refused `NET_LIMIT`; network stored only as its peppered hash in 4 shards | counts; Firestore scan | Phase 3 |
| AC-COST-03 | Judge and global quotas | One judge UID requests 201 leases; global judge cap lowered to 10 in test config; anonymous global cap 40 | Lease 201 refused; with the test cap request 11 refused; anonymous request 41 refused | counts | Phase 3 |
| AC-COST-04 | Load test (`k6`, 500 requests) | `tools/loadtest/k6-script.js` (§5 Phase 3) | All caps enforced as in AC-COST-01..03 and AC-SEC-08; anonymous UIDs stop at their caps; a prefix stops at its cap regardless of forged headers; judges still receive leases and judge-lane responses after the anonymous pool is exhausted; the sample pool stops at 20 runs while a judge sample run succeeds; no request without a valid App Check token succeeds; callable p95 ≤ 3 s; no 5xx | k6 summary | Phase 3 |
| AC-COST-05 | AI Logic per-user limit | Console value; 40 cloud calls in 60 s from one UID | Configured 30 RPM (range 20–30); calls beyond 30 per minute rejected; the client backs off and the UI stays stable | rejections ≥ 10; console value | Phase 3 |
| AC-COST-06 | Spend caps and budgets **(manual)** | Cloud Billing console | Caps AI Logic US$60 and Functions US$40 per month; budgets on gross cost: `gross` US$110 (50/80/100 % + forecast), `ai-logic` US$60 (25/50/75/90/100 %), `uncapped` US$20, `recaptcha` US$10, routed to `billing-alerts` / `recaptcha-alerts`; cap behaviour and recovery time in the runbook | screenshots; runbook entry | Phase 3 |
| AC-COST-07 | Pool-vs-cap arithmetic (§6.9 procedure 6) | `tools/cost-model.ts` with the pools of 05, the measured S-L2 prices and the budget actions | The public maximum per day equals the 05 table for the `[I]` prices; the four cost scenarios are reproduced (day numbers within the 17-day planning window, totals to US$1); regenerated with measured prices; if any scenario other than the heavy-judge one reaches the cap before `JUDGE_TIER_EXPIRY_EPOCH`, the pools are lowered until none does | diff = 0; scenario days | Phase 3 |
| AC-COST-08 | `recaptchaBreaker` graceful degradation | Staging: Web reCAPTCHA key disabled by `recaptchaBreaker`; then re-enabled by an operator | Web shows the degraded chip; L0, Confidential mode and `ONLY_ON_DEVICE` L1 keep working; no unhandled error; after re-enabling, App Check tokens and cloud features return; the action is logged in the release log | console errors = 0; state; log entry | Phase 3 |
| AC-INJ-01 | Sanitizer detection | RT-INJ items 1–20 | ≥ 19/20 blocked | detection count | Phase 3 |
| AC-INJ-02 | No local verdict on suspicious pairs | The same 20 items through Stage 2 routing | 0/20 local verdicts; each pair `SOURCE_FLAGGED` | count = 0 | Phase 3 |
| AC-INJ-03 | Cloud warning label | The same items through L2 (judge pool, staging) | 20/20 cloud cards show "Source contains instruction-like text." | count | Phase 3 |
| AC-INJ-04 | Delimiter forgery on the L2 path | Evidence containing `<<EVIDENCE id=9>>` and a forged schema key sent through L2 | Delimiters escaped before wrapping; the forged key never alters the parsed `L2Verdict` | captured request; parsed result | Phase 2 |
| AC-INJ-05 | Sanitizer false positives (MS-SAN 500) | 500 CC-BY abstracts | Blocked units ≤ 1 %; no single pattern > 0.5 %; the 10 weaponization abstracts not blocked | rates in `sanitizer.md` | Phase 0 (calibration) / Phase 3 (release re-verification) |
| AC-INJ-06 | Folded injection text | RT-INJ-F items 1–6 | 6/6 blocked; 0/6 local verdicts | detection count | Phase 3 |
| AC-INJ-07 | Scientific Greek not blocked | ≥ 40 MS-SAN abstracts with `TNFα`, `IL-1β`, `NF-κB`, `μm` | 0 blocked by `MIXED_SCRIPT` | block count = 0 | Phase 0 |

### 6.8 Offline Android flows, Web UX, iOS and contest Stage One

| Acceptance ID | Subsystem / Requirement | Test Input / Scenario | Expected Output | Telemetry / Assertion Metric | Phase Gate |
|---|---|---|---|---|---|
| AC-OFF-01 | Offline Readiness Meter | `bundledSample` APK, sample ledger; then a local `.md` + `.bib` import | Exact format `"Offline ready: {nAbs}/{nRefs} references with abstract · {nFt}/{nRefs} with full text · retraction snapshot {yyyy-mm-dd} · model: {tier} ({baseModelName})"` with correct counts; imported references outside the bundled cache counted without abstract or full text | values vs Room | Phase 2 |
| AC-OFF-02 | O1 offline re-check | Airplane Mode; claim with cached full text | Stage 2 `ON_DEVICE` (raw value in the card's Details line); label *"Checked on this phone (unconfirmed)"*; `FLAG_KEEP_SCREEN_ON` during the run with *"Keep this screen open while checking."*; hint only if Android is in Path A; a supportive result labelled "Evidence found on this device · not a verdict" unless support verdicts are authoritative | `inferenceSource`; label; window flag | Phase 2 |
| AC-OFF-03 | O2 Select-row with crop and capture gate | Airplane Mode: (a) laser table with a two-row header; (b) a capture-gate photo (IQR > 3°); (c) a short-table photo with 3 qualifying lines; the full MS-O2 and capture-gate sets | (a) row selection; "Add the row above" yields `"{upper} · {lower}"` headers; one composite crop per value; no state change before "Matches the photo"; `rowCropSha256` stored; (b) rejected with the exact tilt copy before extraction; (c) IQR test skipped, accepted (median ≤ 20°); ≥ 5/6 capture-gate photos rejected, ≤ 2/30 evaluation photos rejected, 4/4 short tables accepted | no change before tap; hash present; reject counts | Phase 2 |
| AC-OFF-04 | O2 numeric sanity | OCR value "145%" in a percentage column | ⚠ *"Check this value against the photo."*; edit or explicit re-confirmation required | flag | Phase 2 |
| AC-OFF-05 | O3 lab-note mismatch | Typed lab note n = 46 vs manuscript n = 48 for the same group and timepoint | Purple "≠ lab note" badge with crop and span; *"Your manuscript differs from your lab note ({pageLabel})."*; after "I confirm this difference" (E16) counted in "Number mismatches" | B5 result; drill-down count | Phase 2 |
| AC-OFF-06 | O4 honesty | Airplane Mode; `UNCITED_EMPIRICAL` claim | Suggestions only from the cached library; exact honesty line; **Copy citation** copies the key form of the document kind; manuscript text hash identical | copy match; clipboard; text hash | Phase 2 |
| AC-OFF-07 | Web offline drafting | PC Ryzen 7; network disabled after load | L1 continues `ON_DEVICE`; hints (Path A only) stay unconfirmed; the batch consent sheet unavailable until online | `inferenceSource`; sheet disabled | Phase 2 |
| AC-OFF-08 | Entailment tap and printed-source review (D-29) | Airplane Mode; O2 with `SUPPORTED`: (a) "Matches the photo" only; (b) then "Not sure"; (c) then "This row supports my claim"; O2 with `NEI`: (d) "This row supports my claim"; O2 with `CONTRADICTS` | (a)(b) not green (`SUPPORTED_LOCAL`, `LOCAL_EVIDENCE` or `UNVERIFIABLE`); (c) green "Supported (printed source)", provenance `Printed source · Author`; (d) `AuthorOverride` with `basis = PRINTED_SOURCE` and the capture ID → `REVIEWED_BY_AUTHOR`, grey "Reviewed by you", bucket `reviewed`, **never green**; `CONTRADICTS` → `HINT` (Path A) or `UNVERIFIABLE`, never red | state per step | Phase 2 |
| AC-OFF-09 | O3 never red | Typed lab note contradicting the manuscript; "I confirm this difference" | Purple flag only; clause state identical; no `CONTRADICTED`, no red mark; `problems` count identical | state; red count = 0 | Phase 2 |
| AC-OFF-10 | `bundledSample` functional session and local import | Sideloaded APK in Airplane Mode: Home filters, Claim Detail, O1–O4 on the sample; Share Sheet import of a `.md` + `.bib` and a PDF attached as `USER_PDF`; Room `@Fts4` queries; Settings → Delete local data | Every screen and flow works; filters `Waiting`, `Possible conflicts`, `Unresolved`, `All` list the specified entries; imported data stays in no-backup storage; references outside the cache are `UPSTREAM_UNAVAILABLE`; FTS4 queries return expected rows; network features show *"Not available in this build. Use the web app for cloud features."*; after deletion the bundled sample is restored | screen log; Room state; copy match | Phase 2 |
| AC-UX-W-01 | Coverage Meter 7-count header | Fixture ledger with every clause state, including an override over `CONTRADICTED`; then with an exhausted pool | Header equals `"{supported} supported · {reviewed} reviewed · {problems} problems · {to_review} to review · {waiting} waiting · {unverifiable} can't verify · {notYetChecked} not yet checked — of {total} claims"` with golden values (`notYetChecked = local + unchecked`); the override in `reviewed`, not `supported`, not `notYetChecked`; the drill-down itemizes On this device, Not checked yet, Number mismatches, Not checkable and the two disclaimers; with an exhausted pool the waiting count stays the same and " · cloud checks resume at {local time}" is appended | string match | Phase 2 |
| AC-UX-W-02 | Mode switch and consent copy | Confidential → Standard; reload; first cloud action of the new session | Full Standard banner once at mode selection; switch only after "Use Standard mode"; queued cloud jobs cancelled when switching back; the one-line reminder with "Details" before the first cloud action of the new session | event order; copy match | Phase 2 |
| AC-UX-W-03 | Consent class A card | `NO_LOCAL_MODEL` (ThinkPad) | Exact card copy with the environment checker reason | copy match | Phase 2 |
| AC-UX-W-04 | Import screen, progress and summary | The AC-L0-10 archive; Standard; anonymous pool with 10 remaining | The exact scope sentence on the import screen; 7 progress steps; correct summary counts; *"{n} claims will need a cloud check; {m} available today"* with `m = 10` and the follow-up line when `n > 10`; import-quality report; "Start audit" primary and viewport-first; audit-copy badge | first 10 jobs intersect the viewport; copy match | Phase 2 |
| AC-UX-W-05 | Integrity report and exports | Ledger with 20 claims in 3 files incl. one author review | Six action-ordered sections; every item starts with `{file}:{line}`; on-device results only under "On this device (not confirmed)"; the review only under *Reviewed by author*; header includes `P_LB(π)` and "Unmarked text has not been verified."; corrected `.bib` annotates, never deletes; no grounded content | structure check; diff | Phase 2 |
| AC-UX-W-06 | Performance and accessibility | Trace on PC Ryzen 7; `axe-core` on the empty state, sample, inspector, batch consent sheet and Proof tab in light and dark themes | Initial JS ≤ 350 KB gzip; cold TTI ≤ 2.5 s; keystroke-to-paint p95 ≤ 16 ms; heap ≤ 150 MB (300 sentences, 60 references); 1 MB archive import ≤ 5 s; 0 serious or critical violations | trace numbers; axe report | Phase 2 |
| AC-UX-W-07 | Single-meaning marks and labels | Visual regression snapshots of every state, flag and chip in light, dark and forced-colours themes; screen reader on a green check; token contrast test | Exactly the specified mark per state; `HINT` never red; no amber underline; `CHECK_METADATA` only as the amber "Check metadata" reference chip (ⓜ); `LOCAL_EVIDENCE` no inline mark; `SUPPORTED_LOCAL` hidden by default; possible citation, not indexed and ambiguous all render as the grey "Check this citation" chip with the reason only in the card; `MIXED_SUPPORT` ✓? grey vs `PARTLY_SUPPORTED` ◐ amber; `SUPPORTED` green ✓ vs `REVIEWED_BY_AUTHOR` grey ☑; announced "Supported — checked in the cloud"; contrast ≥ 4.5:1 text and ≥ 3:1 marks | snapshot diff = 0; label scan; `tokens.test.ts` | Phase 2 |
| AC-UX-W-08 | Keyboard shortcuts | Keyboard-only run through the sample; `keymap.test.ts` | `Mod-Shift-.` / `Mod-Shift-,` visit every `problems`/`to_review` clause in order; `Mod-I`, `Mod-Enter`, `Mod-Shift-V`, `Mod-Shift-Enter` and `Mod-/` act as specified with `Ctrl` and `Cmd`; no reserved combination bound (including `Mod-S/P/F/T/W/L`, `Mod-R`, `Mod-Shift-R`, `Mod-Shift-I`) | action log; test exit code 0 | Phase 2 |
| AC-UX-W-09 | Batch consent sheet | 30 waiting clauses incl. 2 changed since last import, 2 hints, 1 row with `USER_PDF` evidence, 1 row with no abstract or full text | Rows ordered: changed since last import → hints → numeric/directional NEI → `checkMetadata`/preprint → document order; no row pre-selected (except via the drawer action); ≤ 25 rows with the "{rest} more" line; evidence kind indicator per row including "no abstract or full text available"; "Include text from my PDFs" off by default and no `USER_PDF` unit sent while off; quota line; exact copy | UI state; captured request | Phase 2 |
| AC-UX-W-10 | Drawers, filters and quota labels | Ledger with each non-resolved state, one review, and an exhausted pool | Each clause in exactly one of the four drawers (`MIXED_SUPPORT` and `PARSE_TIMEOUT` under *Can't verify with available sources*; reviews under *Reviewed by you* with "Undo review"); with the exhausted pool the *Waiting* drawer keeps its clauses and shows *"No cloud checks left today — resets at {local time}"*, and the quota indicator shows the same text with the time in the browser's time zone; **exactly six** filter chips `All`, `Problems`, `To review`, `Waiting`, `Can't verify`, `Not yet checked`; the Supported and Reviewed header counts filter the table | membership; chip count = 6; copy match | Phase 2 |
| AC-UX-W-11 | Proof mode is a view | Toggle Proof mode during a session | Routing, quotas and results identical; the Proof tab shows exactly the fields of [04 › Proof mode HUD (exact fields)] in the card order of `06`, including "Found {TP_pairs} of 50 contradictions in our test set" | state diff = 0; field presence | Phase 2 |
| AC-UX-W-12 | One-click sample cloud check | Clean profile, Standard, Sample Manuscript; click; click again; a second anonymous UID on the same network; a third; edit one one-click claim; Confidential mode | First click: no sheet; exactly 5 claims under one `kind = "SAMPLE"` reservation (2 grounded, 3 provided-evidence); items 4 and 5 `CONTRADICTED` with Search Suggestions; clean claims `SUPPORTED`; second click: button disabled; the second UID succeeds, the third refused (per-network 2) with the exact used-up tooltip; the edited claim leaves the set; Confidential: disabled with the exact tooltip | states; request count = 5; lease kind; tooltip | Phase 2 |
| AC-UX-W-13 | Document kinds and re-import | (a) import a `.zip` and type; (b) open the sample, edit, close the tab; (c) Download source; (d) re-import the project as a `.docx` exported from it; (e) inspect the queue and the sheet | (a) read-only with the exact hint and badge; (b) `navigator.storage.persist()` requested on first edit and the `beforeunload` confirmation shown; (c) downloaded bytes equal the editor content; (d) re-import accepted across kinds, clauses with identical text keep results by `resultKey`, exact toast; (e) changed clauses at P2 with "Changed since last import" and listed first | editor state; byte compare; queue order | Phase 2 |
| AC-APL-01 | iPhone 13 Pro Max cloud fallback **(manual)** | Standard; consent class A; "Check this claim" with 3 evidence sentences | Answer from the cloud secondary; chip *"Cloud (this iPhone can't run the on-device model)"*; result line *"Answered by the cloud model because this device isn't eligible"*; `rawResponse.modelVersion` in Details; history entry in a SwiftData store excluded from backup | `modelVersion` indicates cloud; backup flag | Phase 2 |
| AC-APL-02 | iPhone Confidential | Confidential; "Check this claim" | Button disabled with *"This iPhone has no on-device model. In Confidential mode only reference checks are available."*; a DOI in the reference field still resolves | copy match; reference chip | Phase 2 |
| AC-STAGE1-01 | Firebase AI Logic at runtime **(manual)** | Production; PC Ryzen 7 (anonymous) and ThinkPad (Standard, consent class A); Xiaomi 15T Pro `bundledSample` | `ON_DEVICE` responses on the PC and the phone; `IN_CLOUD` on the ThinkPad | Proof counters > 0 on each | Phase 3 |
| AC-STAGE1-02 | App Check, replay protection and terms inquiry **(manual)** | Production console; release log | Enforcement on for AI Logic, Authentication (or the recorded BE-3 fallback), Firestore, Storage, callables; replay protection on; Authenticated-users mode on; template-only off; the written grounding-display terms question sent to the **Gemini API developer channels** with its answer or its absence recorded | screenshots; log entry | Phase 3 |
| AC-STAGE1-03 | Public repository, licence and pre-existing code **(manual)** | GitHub; README | Public; Apache-2.0 in About; `LICENSE` and `NOTICE` present; the section "Pre-existing code and third-party components" lists every dependency and any code written before the contest submission period with its licence | screenshot; section present | Phase 3 |
| AC-STAGE1-04 | Platform statement **(manual)** | README | Per device: observed model availability and generation (S-N4); the hardware requirement next to the "no install" claim; the Devpost forum question link (D-25); the Android APK described as the offline `bundledSample` build running Firebase AI Logic on-device inference with zero network calls; the scope of "while you write" (single-file documents) and of read-only audit copies; the parser described per AC-SEC-14; R1-E-L2 cited with its provided-evidence disclosure | section present | Phase 3 |
| AC-STAGE1-05 | Free access until judging ends | A judge code from an external network in a clean profile (⋯ → Judge access); the same code on 5 browsers; then the base URL without a code | Code accepted on up to 5 browsers; judge pool and lanes active; `tierExp = JUDGE_TIER_EXPIRY_EPOCH`, which is later than the end of the official judging period; no `?code=` handling; base URL works without a code | claim value; anonymous run | Phase 3 |
| AC-STAGE1-06 | Zero-friction first run | Clean Chrome profile on PC Ryzen 7 and on the ThinkPad | "Try a sample manuscript" opens the editable sample in one click; `sample.e2e.ts` matches `expected.json` (before-cloud states); the 7-count Coverage Meter header is shown with the expected values; the environment checker states the reason and the hardware requirement on the ThinkPad | e2e pass; copy match | Phase 3 |
| AC-STAGE1-07 | Demonstration video **(manual)** | Final video | Checklist of [08 › 2:40–2:45 Multi-Device Video Storyboard (Variant A & Variant B)] satisfied; every on-screen claim allowed by `H4_DECISION.md`; no judge code on screen; the preprint sentence uses verified counts including `k_false` | checklist in `/docs/acceptance/AC-STAGE1-07.md` | Phase 3 |
| AC-STAGE1-08 | Testing Instructions **(manual + copy test)** | Devpost "Testing Instructions" field and `packages/copy/en.json` | The field equals the text of [08 › Devpost Testing Instructions] after its visibility check; it contains no production API key, project secret or personal data | `copy.test.ts` equality; manual review recorded | Phase 3 |

**Unique acceptance rows:** EVAL 12 + L0 27 + L1W 14 + L1A 5 + L2 8 + GND 2 + L3 10 + FN 10 + SEC 18 + COST 8 + INJ 7 + OFF 10 + UX-W 13 + APL 2 + STAGE1 8 = **154**.

### 6.9 Normative test procedures

**Procedure 1: ReDoS fuzz (AC-L0-15).**
- **Targets:** every regular expression in `packages/core-l0` (collected by a static scan) and the citation scanner, segmenter, masker and value parser as whole functions.
- **Corpus** (seed `SEED_FUZZ`), per target: 64 inputs of exactly 10 KB of repeated openers `(`, `[`, `{`, `\cite{`, `$` without closers; alternating near-matches of each pattern's keywords; `\cite{` with 64 comma-separated keys and then 10 KB of key characters without a closing brace; long runs of digits, decimal points and mid-dots; 1,000 random Unicode strings mixing the character classes of [02 › Character Classes, Normalization & Hashing].
- **Measurement:** median of 5 runs per input in Node.js 22 on PC Ryzen 7; pass iff every input ≤ 5 ms per 10 KB.
- **Static rule:** a regex-source parser rejects any quantified group containing an unbounded quantifier (`*`, `+`, `{n,}`).

**Procedure 2: reducer order independence (AC-L0-16).**
- **Generator** (fast-check, seed `SEED_PROPERTY`): random entries with 0–4 references and random event multisets drawn from **E1–E16 and E6b**. Each set/clear event (E6b, E10, E11, E12, E16) carries the per-claim Lamport `seq` assigned **at emission**; the generator never re-assigns `seq` when it permutes. The multisets include duplicates, stale results (wrong `resultKey`), cloud results with a wrong `approvedTextSha256`, results with equal `resultKey` and equal `decidedAt` (tie broken by `sha256hex(JCS(result))`), E2 interleaved with E1, E4 before and after E15, E6b computed for an older and for the current `evidenceVersion` before and after E6, physical results before and after their entailment confirmation, and E12 overrides before and after E9 re-segmentation.
- **Property:** for each multiset, 20 random arrival permutations yield identical facts and identical `derive()` outputs under every `PolicySnapshot` (Path A/B × task authority × `supportVerdicts`, with and without an unknown profile), every `PrivacyContext` (both modes × `cloudAvailable` × `quotaExhausted`, and the constant `bundledSample` context) and every `SessionFacts` (`localUnavailable` × transient attempts 0–3). The permutations E4↔E15, E6↔E6b, E5↔E9 and E12↔E1 are always included. CI runs 1,000 multisets per push and 10,000 in Phase 3.

**Procedure 3: meter partition (AC-L0-19).** For random ledgers from the same generator, assert the eight-bucket invariant [01 › Exact partition]; that the seven header counts sum to `total` with `notYetChecked = local + unchecked`; that no override is counted in `supported` or in `notYetChecked`; that an exhausted pool never changes a bucket; that `numberMismatches` and `notCheckable` are not buckets; and that the rendered header string equals the exact 7-count format.

**Procedure 4: conformance edge cases (`conformance/l0/`).** The golden corpus is written by hand from the normative examples and tables of `01`–`06` and from the cases below. It is never generated from the output of one implementation; a case whose expected output cannot be derived from the specification is reported as a specification defect, not guessed.

| File | Edge cases (in addition to the normative examples) |
|---|---|
| `norm.json` | U+200B, U+200C, U+200D, U+2060, U+FEFF inside Latin words (deleted, offsets mapped) plus script-aware U+200C/U+200D preserved in Devanagari; NBSP and narrow NBSP; Unicode minus and en dash between digits; mid-dot decimals `0·45`; ligatures `ﬁ`/`ﬂ`; full-width digits; decomposed `Mu`+U+0308+`ller` as one word and composed; `İ` (U+0130) lowercased identically on every platform; a character whose category is resolved from the bundled Unicode 15.1 table |
| `segment.json` | "et al.", "e.g.", "i.e.", "Fig. 2", "vs.", "p. 12", "approx."; `i.v.`, `i.p.`, `s.c.`, `p.o.`, `sec.` before a capitalized word of ≥ 3 letters (boundary) and before a lower-case word (none); sentence-initial `p53` and `t-test`; "…was 3.5."; "…[12]."; ellipsis; a quotation ending `."` |
| `math.json` | `$p<0.05$` vs `$p<0.01$`; `\(n=48\)`; display math attached to its sentence; `\$`; Markdown `$5 and $6` not math; `\def\N{48}` and `\newcommand{\N}[1]{…}`; `\textsuperscript{2}` → `^2`; `\ce{H2O}`; `\todo{…}` dropped; `\textcolor{red}{x}` and `\hl{x}` → `x` |
| `citations.json` | `\cite{a,b}`, `\citep[p.~3]{a}`, `\citet*{a}`, `\parencite{a}`, Pandoc `[@a; @b, p. 3]`, numeric `[1–3, 5]`, "(Smith et al., 2020a)", "Smith and Lee (2019)"; `30% [1]`, `social [3]`, `in 2019 [3]`, `30% [1, 2].`, `Table 2 [3, 7].` (citations); `95% CI [12, 45]`, `median 5 [3, 7] days`, `[2](url)` (not citations); `(March 2020)` and `(Table 2020)` rejected by `NON_NAME_WORDS` (not citations); `WHO (2020)`, `(Smith 2020)` and `(Jones et al., 2021)` without a match (`POSSIBLE_CITATION`); a numbered list under `## References` giving the order; an unclosed `\cite{` with 64 keys (no match, linear time) |
| `clauses.json` | "but", "whereas", "while", semicolons, a citation between two clauses, a list of three findings each cited; "which was unexpected" between two marker groups (left clause); "not only … but also" (no boundary); claim frames stripped only at clause start; cleanup (a)–(d) |
| `sections.json` | Extended label entries (`related work`, `statistical analysis`, `concluding remarks`, `supporting information`); a non-matching `\subsection` inheriting its parent; Markdown `###` under `## Methods`; text before the first heading (`unlabeled`); `summary` as the first heading only |
| `bm25.json` | Scores differing by < 1e-9 compared on `gridKey`; the worked example (kept); a unit below τ with 2 shared stems (kept) and with 1 (discarded); a claim with no word terms (`cov = 1`); the quantity bonus withheld and applied; corpora of 10, 50 and 150 references; a reference with only full-text units; a selection with `candidates = 0` |
| `chunk.json` | JATS mixed content kept in document order; PDF line reconstruction; section labels; unit IDs identical when produced by the client and by the built `oaParse` bundle |
| `anchor.json` | Each `AnchorFailReason` at least once; negation right of the window; `non-significant`; `didn't`; `increased`/`decreased`; quantity vs valence classes; `>` vs `<`; negation exclusions `heart failure`, `renal failure`, `treatment failure`, `similar methods`, `not inconsistent`; claim number checked against the anchor window ±1 clause; L1 `NO_DIFFERENCE_SIGNAL`; the L2 rule cases of AC-L0-09; example 15b with `softFor(clTok)`; `kindMismatch` with equal `(unitFamily, isPercent)` and cue-derived metric classes; measure valence |
| `sanitize.json` | Each INJ pattern; Unicode tags; bidi override; 3 zero-width characters; script-aware joiners in Devanagari vs Latin; a mapped and an unmapped PUA Symbol-font character; Latin/Cyrillic mixed-script words; scientific Greek (not blocked); mathematical bold and circled letters via `detectText`; a log-tier-only abstract; `<<EVIDENCE` escaping; `first_author` and `doi` fields sanitized |
| `quantity.json` | `48`, `48.0`, `37%`, `0.37` (different families); `1.2–3.4`; `95% CI 1.1 to 2.3`; `p = .03`; `−0.2`; `1,234`; `12.345` with `lang: de` and `lang: en`; `0.045` and `1.5` with `lang: de`; `twelve patients` vs `one of`, `no one`, `one can`; `12.5 (3.1)` as one `mean (SD)` tuple; `\SI{5}{\milli\gram}`; `\num{1e-3}`; years 1900–2099 without a unit are not quantities |
| `claimhash.json` | The pairs of AC-L0-21 |
| `b5pairing.json` | Values within `max(tol_a, tol_b)` in both argument orders; different unit families never paired; lemma Jaccard just below and above 0.35; cap of 3 candidates; candidates only from the key-lemma index; per-metric-class jobs; orphan `b5_checks` rows deleted |
| `b5_baseline.json` | One case per baseline class; cue in the larger value's window (not subset); `INCONSISTENT` with `s2_same_population = false` → `DIFFERENT_QUANTITY` |
| `b5_incremental.json` | Adding, editing and deleting tuples in every order equals a full recomputation; a new tuple pushing an old pair out of its partner's top 3 |
| `triage_baseline.json` | Methods sentence without numbers; aims sentence; a Results sentence with a number and no citation (not uncited); the same in Discussion (uncited empirical); "One of the main causes of delay is staffing." (`CAUSAL`, uncited); cited `METHODOLOGICAL` (C4b) vs cited `NON_EMPIRICAL`; a transition sentence; `results` as noun vs verb + `in`; `more` without a number |
| `reducer.json` | The cases of AC-L0-14; stale `resultKey`; wrong `approvedTextSha256`; ties by `decidedAt` and `sha256hex(JCS(result))`; lab-note flag never producing a clause state; E1 after E2 leaving reference facts intact |
| `meter.json` | All eight buckets; the seven header counts summing to `total`; an override over `CONTRADICTED` in `reviewed`; `SOURCE_FLAGGED` in both modes; `MIXED_SUPPORT` in `unverifiable`; `LOCAL_EVIDENCE` in `local`; `NOT_CHECKABLE` excluded; exhausted pool; `UNCITED_EMPIRICAL` per `b4_counts_in_review`; the `bundledSample` context with `waiting = 0` |
| `gate.json` | Each single failing condition of the Path A gate; boundary values exactly at 0.70, 0.50, 0.60 and 15 (pass) |
| `support_gate.json` | `(TS, PS)` = (46, 50) pass; (45, 50) fail; (37, 40) pass; (36, 40) fail; (29, 30) pass; (28, 30) fail; (24, 25) pass; (23, 25) fail; (16, 16) pass; (15, 15) fail |
| `holm.json` | The fixture of §4.2; ties broken by task order; Δ = 0.10 with adjusted p = 0.10 (accepted) and 0.1001 (downgraded); B5 with lower `INCONSISTENT` precision than the baseline (downgraded) |
| `ocr_rows.json` | Right- and decimal-aligned columns; a row with no gap ratio > 1.8; two-row headers with a spanning upper cell; line-angle sets with IQR 2.9° (accepted) and 3.1° (rejected); 3 qualifying lines with IQR 6° and median 4° (gate skipped, accepted) and median 25° (rejected) |

**Procedure 5: Tier B replay determinism (AC-EVAL-12).** Run `tools/replay.ts` twice on a committed R1-E run directory with the network disabled and compare byte for byte; apply a one-line change to a Tier B constant and confirm the diff lists exactly the affected calls; change one byte of a Tier A file and confirm `TIER_A_MISMATCH`.

**Procedure 6: pool-vs-cap arithmetic (AC-COST-07).** `tools/cost-model.ts` integrates the daily cost of every pool in steps of 0.01 day over the 17-day planning window (day 0 = public launch; the window ends at `JUDGE_TIER_EXPIRY_EPOCH`), applies each budget action of [05 › `budgetBreaker` and `recaptchaBreaker`] at the moment its threshold is crossed, and reports the day numbers at which 25 %, 50 %, 75 %, 90 % and 100 % of the AI Logic budget are reached for the four scenarios of [05 › Cost scenarios (`tools/cost-model.ts`, prices `[I]` until `S-L2`)]; prices are inputs (the `[I]` ranges, then the S-L2 measurements).
