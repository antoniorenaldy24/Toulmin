# 06 — Clients, UI & Monorepo

**Owns:** the cross-platform UI rules and visual language (status mark table, colour tokens, glyphs, accessible labels, provenance chips, status copy); the Web Chrome Workbench (`apps/web`): client stack, layout, header components, editor marks, keyboard shortcuts, evidence inspector, cloud grounding card, Claim Ledger table, filters and drawers, batch consent sheet layout, Proof mode panel layout, empty state, Sample Manuscript, import and export screens, accessibility and performance budgets; the Android Pocket Ledger (`apps/android`): client stack, the `bundledSample` flavor, screens, the offline readiness meter, flows O1–O4 including the Select-row geometry of O2, lifecycle and storage; the iOS Thin Client (`apps/ios`) screen contract; the monorepo directory tree and the module boundary rules.

**Load with:** `AGENTS.md` (always). Clause states, meter buckets, the header format, drill-down, drawers and events are defined in `01_DATA_REDUCER_AND_METER.md`; the job queue, L1/L2 runtimes, L3 states, Proof mode fields, escalation rules and the one-click sample check in `04_AI_RUNTIME_PROMPTS_AND_L3.md`; CSP, Trusted Types, quota pools, privacy and consent copy in `05_BACKEND_SECURITY_AND_FINOPS.md`; ingestion, editability and report contents in `03_L0_TIER_B_VALIDATOR_B5_INGEST.md`.

**Cross-reference notation.** `[0n › Topic]` names the owning specification file `docs/spec/0n_*.md` and the topic heading inside it. A bare `§n.m` refers to this file.

**Devices.**

| Client | Device | Role |
|---|---|---|
| Web Chrome Workbench | PC Ryzen 7, MacBook M5, Lenovo ThinkPad (Chrome desktop) | Primary platform |
| Android Pocket Ledger | Xiaomi 15T Pro (AICore `STABLE`) | Offline mobile companion, distributed only as the `bundledSample` flavor |
| iOS Thin Client | iPhone 13 Pro Max (iOS 26, no Apple Intelligence) | `HybridModel` cloud-fallback demonstration |

There is no native macOS target; the MacBook M5 runs the Web build in Chrome (D-23).

---

## 1. Cross-Platform UI Rules & Visual Language

### 1.1 Principles (MUST)

1. **Single-object invariant.** Every visible verification state is derived by the pure reducer `derive()` from a `ClaimLedgerEntry` [01 › Pure Commutative Ledger Reducer (`derive`)]. No UI element may show a verdict, count or chip that `derive()` did not produce. The Coverage Meter, the inline marks, the Ledger table, the drawers, the inspector, the exports and the Android list read the same derived output.
2. **One meaning per mark.** Each mark of §1.2 and §1.3 has exactly one meaning on every platform. No other colour, underline or icon is used for claim status. Marks that are not status marks (selection highlight, search match, spell-check, focus ring) use styles that resemble no status mark: no red, amber, blue, green or purple underline, and no margin glyph.
3. **Colour is never the only cue.** Every status combines a distinct **colour token**, a distinct **mark style** (underline style, chip shape, margin glyph or none), a distinct **icon or glyph**, and an **ARIA label**. The Windows forced-colours media query maps every token to `CanvasText`, and the shapes and glyphs alone carry meaning.
4. **Contrast.** Every token meets WCAG 2.2 AA in the light theme (background `#FFFFFF`) and the dark theme (background `#1F1F1F`): **≥ 4.5:1** for text and chip labels, and **≥ 3:1** for non-text marks (underlines, outlines, glyphs). Ratios are computed with the WCAG 2.2 relative-luminance formula; `tokens.test.ts` recomputes them from `packages/copy/tokens.json` and fails below either threshold.
5. **No false reassurance.** Unmarked text is never described as verified; on-device results are never described as verdicts (§1.7).
6. **Provenance is always visible** in detail views as one chip (§1.5), with the raw `inferenceSource` value in its tooltip.
7. **Interruptions (D-02).** Only two kinds of results may draw attention without a user action: deterministic reference problems (an explicit DOI verified as unregistered, a retracted reference, an explicit citation key absent from the bibliography) and contradictions (as a hint or as cloud-confirmed red). Nothing else animates, pops up, plays a sound or moves the caret.
8. **Honest "Supported" (D-29).** Green appears only for a cloud-confirmed support or a printed-source result whose values **and** entailment the author confirmed. No on-device result is labelled "Supported" without the words "on this device · unconfirmed", and on-device support marks are hidden by default. An author review is never green. A lab note never produces red.
9. **Local features never wait for the cloud.** The editor, L0 and on-device L1 start without Firebase Authentication, Remote Config or network access; anonymous sign-in happens at the first cloud need [04 › Initialization (`src/firebase.ts`)].
10. **Telemetry stays in Proof mode.** Raw `inferenceSource` values, queue lengths and latencies appear only while Proof mode is on (status bar, Proof tab). The one exception is the Android result card, whose provenance chip shows the raw value in its tooltip and in its "Details" line.

### 1.2 Status mark table

This table assigns the colour tokens, marks, glyphs and accessible labels of the display mapping of [01 › Canonical display mapping]. Tokens are defined once in `packages/copy/tokens.json` and consumed by the Web CSS custom properties, the Compose theme and the SwiftUI asset catalog.

**Colour tokens:**

| Token | Light | Dark | Contrast light / dark |
|---|---|---|---|
| `--t-red` | `#B3261E` | `#F2B8B5` | 6.54 / 9.65 |
| `--t-hint` (amber-grey) | `#7A6A45` | `#C9B98F` | 5.28 / 8.49 |
| `--t-amber` | `#8A5A00` | `#F0C36A` | 5.93 / 9.98 |
| `--t-blue` | `#0B57D0` | `#A8C7FA` | 6.39 / 9.59 |
| `--t-grey` | `#5F6368` | `#BDC1C6` | 6.05 / 9.11 |
| `--t-green` | `#146C2E` | `#6DD58C` | 6.53 / 9.06 |
| `--t-purple` | `#7B3FA0` | `#D7AEFB` | 6.86 / 8.90 |

**Clause states:**

| Clause state | Token | Mark | Icon / glyph | Accessible label (exact) | Meter bucket |
|---|---|---|---|---|---|
| `REFERENCE_PROBLEM` | `--t-red` | red flag in the gutter + red **filled** chip on the citation marker; **no underline** on the claim text | ⚑ | "Reference problem: {reason}", where reason ∈ {"DOI not found", "retracted", "citation key not in your bibliography"} | `problems` |
| `CONTRADICTED` | `--t-red` | **solid** underline, 2 px (L2-confirmed only) | ✕ | "Contradicted by the source — checked in the cloud" | `problems` |
| `HINT` | `--t-hint` | subtle amber-grey **dotted** underline, 1.5 px, dot spacing 3 px; the label appears on hover and focus | ◌ | "On-device hint — unconfirmed" | `to_review` |
| `PARTLY_SUPPORTED` | `--t-amber` | amber **outline** chip "Partly supported" on the citation marker | ◐ (half-filled circle) | "Partly supported by the cited source — checked in the cloud" | `to_review` |
| `CHECK_METADATA` | `--t-amber` | amber **outline** reference chip **"Check metadata"** on that reference's citation marker; no mark on the claim text | ⓜ | "Check metadata: reference details differ from the published record" | `to_review` |
| `UNCITED_EMPIRICAL` | `--t-blue` | blue **filled** chip "Uncited empirical claim" after the clause | ⓘ | "Empirical claim without a citation" | `to_review` when `policy.b4CountsAsReview`, otherwise `unchecked` |
| `MIXED_SUPPORT` | `--t-grey` | grey **outline** chip "Supported by {k} of {n} · others not verifiable" on the citation-marker group | ✓? (check followed by a question mark; never a circle) | "Supported by {k} of {n} cited sources; the others could not be verified" | `unverifiable` |
| `SUPPORTED` | `--t-green` | **filled** check in the right margin | ✓ | "Supported — checked in the cloud" (provenance `CLOUD`) or "Supported — confirmed from a printed source" (provenance `PHYSICAL_SOURCE`) | `supported` |
| `REVIEWED_BY_AUTHOR` | `--t-grey` | "reviewed" glyph in the right margin; never green | ☑ | "Reviewed by you — not a verdict" | `reviewed` |
| `SUPPORTED_LOCAL` | `--t-grey` | **hollow** check in the right margin, shown **only** when the support gate passed for the profile **and** the author turned on "Show on-device supports" (default **off**, Remote Config `show_local_supports_default = false`); otherwise no mark | ✓ (outline) | "Supported on this device — unconfirmed" | `local` |
| `LOCAL_EVIDENCE` | — | **no inline mark**; the inspector shows the on-device evidence span under the heading "Evidence found on this device · not a verdict" | — | "Evidence found on this device · not a verdict" | `local` |
| `CHECKING` | `--t-grey` | small progress chip "Checking…" after the clause, shown only after the job has been in flight for 400 ms | ⋯ | "Checking" | `unchecked` |
| `WAITING` | — | no inline mark; listed in the drawer *Waiting for cloud check* | — | — | `waiting` |
| `SOURCE_FLAGGED` | — | no inline mark; listed in the drawer *Source flagged* | — | — | `waiting` (Standard) / `unverifiable` (Confidential) |
| `UNVERIFIABLE` | — | no inline mark; listed in the drawer *Can't verify with available sources* | — | — | `unverifiable` |
| `UNCHECKED` | — | none | — | — | `unchecked` |
| `NOT_CHECKABLE` | — | none | — | — | excluded (drill-down line "Not checkable") |

### 1.3 Independent flags and reference chips

Flags and reference chips are independent of the clause state and of the meter bucket [01 › Independent flags]. They are never counted as `problems`.

| Flag / chip | Token | Mark | Icon | Accessible label (exact) |
|---|---|---|---|---|
| B5 manuscript inconsistency | `--t-purple` | purple outline badge **"≠"** on **both** numeric spans | ≠ | "This number differs from {section} ({value})" |
| Lab-note mismatch (author-confirmed, O3, event E16) | `--t-purple` | purple outline badge **"≠ lab note"** on the manuscript span; never red; never a clause state | ≠ | "Differs from your lab note ({pageLabel})" |
| **"Check this citation"** reference chip family | `--t-grey` | grey outline chip with the single label **"Check this citation"** on the citation marker. The chip never shows the reason; the reason and its action are reached by hover (250 ms), by keyboard (`Mod-I` on the marker) and by tap in the claim inspector | ? | "Check this citation: {reason}" |
| Job in flight while a result is shown | `--t-grey` | "Checking…" badge next to the existing mark; the existing mark stays | ⋯ | "Checking again" |

**"Check this citation" reasons and actions (exact):**

| Cause | Reason | Action in the hover card and inspector |
|---|---|---|
| `POSSIBLE_CITATION` (heuristic marker matching no reference) | "Possible citation — it matches no reference in your bibliography" | **Link to a reference** (opens the reference picker) · **Not a citation** (dismisses the chip for this marker) |
| `NOT_INDEXED` | "No DOI, and not found in the bibliographic indexes" | **Add a DOI** (edits the `.bib` entry of a single-file document; for an audit copy it names the entry key to fix in the author's own `.bib`) |
| `AMBIGUOUS` | "This citation matches more than one reference" | **Choose the reference** (opens the reference picker) |

`CHECK_METADATA` is **not** part of this family: it uses the amber reference chip "Check metadata" (ⓜ) with the action **Show differences** (title, year or first author side by side with the published record).

**Distinctness rules (MUST):**
- `HINT` and `CONTRADICTED` are distinguishable without colour (dotted 1.5 px vs solid 2 px; ◌ vs ✕) and by label. `HINT` never uses red; red appears only when the reducer derives `CONTRADICTED`, which requires L2 confirmation.
- `PARTLY_SUPPORTED` (◐, amber) and `MIXED_SUPPORT` (✓?, grey) differ in glyph, colour and label.
- `SUPPORTED` (filled green ✓) and `REVIEWED_BY_AUTHOR` (grey ☑) differ in glyph, colour and label; a review is never counted or drawn as support.
- Amber is used only as an **outline chip** on citation markers, never as an underline. `CHECK_METADATA` is a reference chip, never a mark on claim text.
- Grey outline chips (`MIXED_SUPPORT`, "Check this citation") never use red or amber and never interrupt.
- A filled red chip and a red underline never appear on the same clause: `REFERENCE_PROBLEM` takes precedence [01 › Precedence rules, "No dead drawers" invariant and provenance].

### 1.4 Glyph assets

Glyphs are rendered from one icon font subset (`packages/copy/glyphs.woff2`, generated from `glyphs.json`) on Web and as vector drawables / SF-style templates on Android and iOS, so that ◐, ✓?, ☑, ⓜ, ◌, ⚑, ✕, ⓘ, ≠, ? and ⋯ look identical on every platform. A glyph is never drawn from a system font fallback.

### 1.5 Provenance chips (detail views only)

| Chip | Source of the deciding result |
|---|---|
| `Deterministic` | L0 or bibliographic resolution |
| `On-device` | `inferenceSource = ON_DEVICE` |
| `Cloud` | `inferenceSource = IN_CLOUD` (including `PREFER_ON_DEVICE` fallback after consent class A) |
| `Printed source` | a confirmed `PHYSICAL_TABLE` or `PHYSICAL_TEXT` capture |
| `Printed source · Author` | a printed-source result whose entailment the author confirmed, or an author override with `basis = PRINTED_SOURCE` |
| `Lab note` | a confirmed `LAB_NOTE` capture ("Matches your lab note" evidence and the purple mismatch flag only) |
| `Author` | an author override with `basis = REVIEW` |

### 1.6 Cross-platform status copy (exact; identical on Web, Android and iOS)

| Clause state | List and card label |
|---|---|
| `REFERENCE_PROBLEM` | "Reference problem" |
| `CONTRADICTED` | "Conflicts with source" |
| `HINT` | "On-device hint · unconfirmed" |
| `PARTLY_SUPPORTED` | "Partly supported" |
| `MIXED_SUPPORT` | "Supported by {k} of {n} · others not verifiable" |
| `UNCITED_EMPIRICAL` | "Uncited empirical claim" |
| `CHECK_METADATA` | "Check metadata" |
| `WAITING` | "Waiting for cloud check" ("Waiting · no cloud checks left today" while the pool is exhausted; the clause stays in `waiting`) |
| `SOURCE_FLAGGED` | "Source flagged" |
| `UNVERIFIABLE` | "Can't verify with available sources" |
| `LOCAL_EVIDENCE` | "Evidence found on this device · not a verdict" |
| `SUPPORTED_LOCAL` | "Supported on this device · unconfirmed" |
| `SUPPORTED` | "Supported" (+ " (printed source)" when the deciding result is an author-confirmed printed source) |
| `REVIEWED_BY_AUTHOR` | "Reviewed by you · not a verdict" |
| `CHECKING` | "Checking…" |
| `UNCHECKED` | "Not checked yet" |

Flag and chip labels: "≠ {section}" (B5), "≠ lab note", "Check this citation", "Check metadata", "Changed since last import". Session labels: "On-device model stopped responding — reload to retry", "Cloud features aren't available in this browser", "No passage of this source matches the claim".

### 1.7 No false reassurance and copy centralization

- The two disclaimers are exact and appear together:
  - **"On-device results are not verdicts."**
  - **"Unmarked text has not been verified."**

  They appear in the Coverage Meter drill-down [01 › Drill-down], in the Proof tab, in the header of every exported report, and on the Android Home screen under the meter. The second sentence also appears in the README.
- **Copy centralization.** Every user-facing string of every client, including all strings marked "exact" in `01`, `04`, `05` and this file, lives in **`packages/copy/en.json`**. Web imports it at build time; the Android and iOS builds copy it into their string resources with its SHA-256. `copy.test.ts` (in `ci-ts.yml`) extracts every string marked "exact" from `docs/spec/*.md` and fails if it is missing from `en.json` or differs from it by a single character. No client contains a user-facing string literal outside `en.json` (lint rule `no-literal-ui-strings` on Web; Android lint `HardcodedText` as an error; SwiftLint custom rule on iOS).

---

## 2. Web Chrome Workbench (`apps/web`)

### 2.1 Client stack

| Concern | Selected | Justification |
|---|---|---|
| Language and build | **TypeScript 5.x + Vite 6**, `build.modulePreload: false` | Static single-page app on Firebase Hosting; native ES modules and worker bundling. `modulePreload: false` keeps `index.html` free of preload links, as the `'strict-dynamic'` CSP requires [05 › Web Hosting Security Headers, CSP & Trusted Types] |
| UI shell | **Preact 10 + `@preact/signals`** | About 4 KB gzip. Signals update only subscribed nodes while results stream into the ledger. CodeMirror owns the editor DOM, so the shell stays small |
| Editor | **CodeMirror 6** with `@codemirror/legacy-modes/mode/stex` (LaTeX) and `@codemirror/lang-markdown` (Markdown) | Viewport-only rendering keeps the DOM small for long manuscripts; plain-text editing with exact offsets maps 1:1 to `.tex`/`.md` sources; `StateField<DecorationSet>` gives range-anchored marks that move through edits |
| `.docx` import | **JSZip + `fast-xml-parser`** with `preserveOrder: true`, reading `word/document.xml` directly | Keeps reference-manager field codes as authoritative citation tokens with exact offsets [03 › `.docx` importer (read-only audit source)] |
| `.zip` / `.tex` / `.bib` | **JSZip** + the `\input`/`\include` resolver + **`@retorquere/bibtex-parser`** | Client-side ingestion keeps Confidential manuscripts on the device; the parser handles JabRef and Better BibTeX dialects |
| PDF text | **`pdfjs-dist` ≥ 4.2.67** in a **dedicated Worker**, lazily loaded, `isEvalSupported: false` | The version floor and the option are both mandatory (arbitrary script execution from a crafted PDF in earlier versions) |
| Local persistence | **Dexie 4 over IndexedDB** | Small, no WASM payload, works in workers and on the main thread, compound and multi-entry indexes [03 › Web (Dexie)] |
| Worker RPC | **Comlink** | Typed async proxies over `postMessage` |
| HTML sanitization | **DOMPurify ≥ 3.2.4**, reached only through the Trusted Types policy `toulmin-html` | The only path from strings to HTML |
| Firebase | **`firebase` ≥ 12.14.0** modules `app`, `ai`, `app-check`, `auth` (anonymous only), `firestore`, `functions`, `remote-config`, `storage`; `firebase/ai` is imported only inside `packages/firebase-client` (§5.2) | 12.14.0 is the minimum Web version for Firebase AI Logic replay protection with limited-use App Check tokens |
| Testing | **Vitest** (unit, L0 conformance, reducer property tests, copy and keymap tests) and **Playwright** (end-to-end on Chrome stable) | Native Vite integration |

### 2.2 Layout and responsive rules

```
┌─────────────────────────────────────────────────── Header ────────────────────────────────────────────────────┐
│ Toulmin ▸ {document title} [{document badge}]  [Mode: Standard ▾] [Model chip] [Cloud checks left today: n (pool)]│
│ [Check the sample in the cloud]*  [Download source | Re-import]†  [Export ▾]  [⋯]                                 │
│ {supported} supported · {reviewed} reviewed · {problems} problems · {to_review} to review · {waiting} waiting ·  │
│   {unverifiable} can't verify · {notYetChecked} not yet checked — of {total} claims   (one line in the product)   │
├──────────────┬──────────────────────────────────────────────────┬───────────────────────────────────────────────┤
│ Outline      │ Editor (CodeMirror 6)                            │ Right panel tabs:                             │
│ sections with│ .tex / .md source with status marks (§1.2, §1.3) │ [Ledger] [Evidence] [Proof]                   │
│ per-section  │ read-only for audit copies                       │ ([Proof] exists only while Proof mode is on)  │
│ problem and  │                                                  │                                               │
│ to-review    │                                                  │                                               │
│ counts       │                                                  │                                               │
├──────────────┴──────────────────────────────────────────────────┴───────────────────────────────────────────────┤
│ Status bar (Proof mode only): on-device {state} · queue {n} · cloud {inFlight}/2 · last call {ms} ms               │
│   ({ON_DEVICE|IN_CLOUD}) · {Online|Offline}                                                                       │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
 * only in Standard mode while the built-in Sample Manuscript is open (§2.3.3)
 † "Download source" for single-file documents; "Re-import" for audit copies (§2.11)
```

- **Document badge:** none for single-file documents; *"Audit copy · read-only"* (exact) for imported multi-file projects; *"Sample"* (exact) for the Sample Manuscript.
- **Outline** (sections with per-section `problems` and `to_review` counts; click scrolls the editor) collapses into a left drawer opened by a button below **1,200 px** viewport width.
- **Right panel** becomes a **bottom sheet** (drag handle, three detents: 25 %, 60 %, 90 % of the viewport height) below **900 px**.
- **Status bar** is shown **only while Proof mode is on**. Its `ON_DEVICE` / `IN_CLOUD` text is the raw `inferenceSource` of the last L1 or L2 call.
- **Mobile browsers** (User-Agent Client Hints `mobile = true`, or a coarse pointer with viewport width below 600 px): the app shows *"Toulmin's workbench needs Chrome on a desktop computer. Use the Android app for offline review."* (exact) and offers "Try a sample manuscript" in a read-only view.

### 2.3 Header components

#### 2.3.1 Mode switcher

- Values **`Confidential`** / **`Standard`**, both available to every visitor (D-17). Mode selection is explicit on first run; the default highlight is Standard while a judge code is active, otherwise Confidential [04 › State machine (Web; Android and iOS equivalents noted)].
- **Switching to Standard** shows the full Standard banner [05 › Standard mode banner] **once, at mode selection**; Standard takes effect only after **Use Standard mode**. Before the first cloud action of each later session, the **one-line reminder** of the same section is shown instead (non-modal, with the link "Details", which opens the full banner).
- **Switching to Confidential** takes effect immediately: queued cloud jobs are cancelled and not sent; the Confidential notice [05 › Confidential mode notice] is shown once per session.

#### 2.3.2 Quota indicator

- Visible in Standard mode **from the initial load** (before any cloud action), hidden in Confidential mode.
- Text (exact): *"Cloud checks left today: {remaining} ({pool})"*, where `{remaining}` is the caller's remaining leases (from `quotaGuard.remainingToday`; before the first lease, read `/users/{uid}/quota/{day}` only when `auth.currentUser` is already signed in, otherwise display the initial anonymous allowance `10` without calling `ensureAuth()`) and `{pool}` is "shared preview" or "judge access". The sample pool is shown only on the sample button (§2.3.3).
- Tooltip (exact): *"Resets at {local time}"*. `{local time}` is the daily reset instant `quotaGuard.resetsAt` (the next 00:00 Asia/Jakarta, as epoch milliseconds) formatted in the **browser's time zone** with `Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" })`, prefixed by the weekday when it falls on a different local calendar day.
- **Exhausted:** the indicator reads *"No cloud checks left today — resets at {local time}"* (exact). Its tooltip adds, for callers without a judge claim, *"Judges: open ⋯ → Judge access to use the reserved judge quota."* (exact). Clauses that would be sent stay in `waiting`; quota never moves a clause to `unverifiable` [01 › Drawers].
- **Kill switch on:** *"Cloud checks paused"* (exact).
- **Degraded:** when anonymous sign-in or App Check cannot complete (offline, reCAPTCHA blocked, reCAPTCHA key disabled), the grey **degraded chip** *"Cloud features aren't available in this browser"* (exact) takes the indicator's place; its tooltip lists what still works (editor, on-device checks, reference checks already cached, local evidence) and a click retries sign-in once.
- After a successful judge-code redemption, a small chip "Judge access" appears next to the indicator.

#### 2.3.3 One-click sample check button

- Shown **only in Standard mode while the built-in Sample Manuscript is open**. Label (exact): **"Check the sample in the cloud"**.
- One click sends the **five** predefined one-click claims of `/apps/web/public/sample/expected.json` (`"oneClick": true`) **without** the batch consent sheet [04 › One-click sample check (D-26)]: the **2 grounded contradiction claims** (items 4 and 5 of §2.10.3) through `l2Adjudicate` with Google Search grounding, and the **3 provided-evidence clean claims** through `l2AdjudicateProvided`. One `quotaGuard` call with `kind = "SAMPLE"` reserves the whole run atomically [05 › `quotaGuard`].
- Progress chips appear on the five claims; the button then reads *"Sample checked in the cloud"* (exact, disabled).
- **Sample pool exhausted** (callers without a judge claim): the button is disabled with the tooltip *"Today's sample checks are used up — the on-device results are shown. Judges: use your judge access code."* (exact). A caller with a valid judge claim draws the 5 leases from the judge pool, so the button keeps working for judges.
- **Confidential mode:** shown disabled with the tooltip *"Switch to Standard mode to use cloud checks."* (exact). **Degraded mode:** disabled with the degraded-chip tooltip.
- **Edits:** a sample claim whose text the author edits leaves the one-click set; it can still be sent through the batch consent sheet.

#### 2.3.4 Model chip

The chip shows the exact chip copy of the current L3 readiness state [04 › State machine (Web; Android and iOS equivalents noted)]:

| State | Chip behaviour |
|---|---|
| `PROBE_ENV` | "Checking on-device model…" |
| `OFFER_DOWNLOAD` | chip "On-device model available" + the card **"Enable on-device verification"** (download only from its button click) |
| `DOWNLOADING` | progress text "Downloading the on-device model ({pct}%). Reference checks are running; claim checks start when the download finishes." |
| `WARM_PROBING` | "Calibrating on-device model… (runs when you pause typing)" |
| `READY_CALIBRATED` | "On-device · measured on this device" |
| `READY_DRIFTED` | chip "On-device hints paused" + the banner and **Re-measure now** button of that state |
| `LOCAL_STALLED` | "On-device model is busy — retrying shortly." |
| `LOCAL_LOST` | "On-device model stopped responding — reload to retry" with a **Reload** button |
| `NO_LOCAL_MODEL` | Confidential: "No on-device model — reference checks only"; Standard after consent class A: "Cloud fallback for this document" |

When the cloud stack cannot initialize, the degraded chip *"Cloud features aren't available in this browser"* is shown beside the model chip (§2.3.2). Clicking the model chip opens the environment report: Chrome major version, readiness and its reasons [04 › Environment checker and readiness (`src/l1/readiness.ts`, D-26)], the hardware requirement, and the link "How to check the model version" (instructions for `chrome://on-device-internals`). While Proof mode is on, the counter strip **On-device {n} · Cloud {m}** is shown next to the chip.

#### 2.3.5 `⋯` overflow menu

Items (exact labels, in this order):

| Item | Behaviour |
|---|---|
| **"Judge access"** | Dialog with one input accepting `TLMN-XXXX-XXXX` (case-insensitive, hyphens optional) → `redeemJudgeCode` [05 › `redeemJudgeCode`]. Codes are accepted only here; there is no URL parameter. Success (exact): *"Judge access active until {local date}. Your checks now use the reserved judge quota."*, where `{local date}` is the returned `tierExp` (`JUDGE_TIER_EXPIRY_EPOCH`) formatted with `Intl.DateTimeFormat(undefined, { dateStyle: "long" })`. Error (exact): *"This code isn't valid on this browser. Check the code, or contact the Toulmin team through the Devpost judging contact for a replacement."* After success the client calls `getIdToken(true)` and turns Proof mode on |
| **"Proof mode"** (checkbox item) | Default on while a judge claim is active, off otherwise. Adds the Proof tab (§2.9), the status bar and the counter strip. It never changes routing, quotas or results |
| **"Show on-device supports"** (checkbox item) | Default from Remote Config `show_local_supports_default` (`false`). Has a visible effect only when support verdicts are authoritative for the profile |
| **"Keyboard shortcuts"** | Opens the shortcut list (§2.4.3) |
| **"Delete local data"** | Confirmation (exact): *"Delete every document, ledger and cached source Toulmin stored in this browser? Download the source of any document you want to keep first."* Buttons **Delete everything** / **Cancel**. Deletes the whole Dexie database (every store [03 › Web (Dexie)]) and Cache Storage, clears the in-memory session cache, then reloads to the empty state |
| **"About and licences"** | Version, licence (Apache-2.0), third-party notices, the positioning line [05 › Positioning line (footer, README, onboarding)] |

#### 2.3.6 Coverage Meter header

- Exact format with **seven counts summing to `{total}`** [01 › Header (exact format)]:

  `"{supported} supported · {reviewed} reviewed · {problems} problems · {to_review} to review · {waiting} waiting · {unverifiable} can't verify · {notYetChecked} not yet checked — of {total} claims"`

  with `{notYetChecked}` = `local + unchecked`; `{reviewed}` is never part of `{notYetChecked}`.
- While the pool is exhausted the header appends *" · cloud checks resume at {local time}"* (exact).
- Recomputed after every reducer run; each count is a link that filters the Ledger table to its bucket or union (§2.7.2).
- Clicking the header text, or pressing Enter on it, opens the **drill-down** [01 › Drill-down]: the eight bucket counts with "Not yet checked: {notYetChecked}" itemized as **On this device** (`local`) and **Not checked yet** (`unchecked`); the lines **Number mismatches: {numberMismatches}** and **Not checkable (method statements and sentences without citations): {notCheckable}**; the provenance counts; and the two disclaimers of §1.7.
- Accessible name: the header text followed by "Press Enter for details".

**Unsaved-changes protection (single-file documents).** On the first edit the client calls `navigator.storage.persist()`. If it returns `false`, the header shows once per session *"Your browser may clear this document when storage is low. Download source regularly."* (exact) [03 › Document kinds and editability (D-26)]. Closing or reloading the tab with changes made since the last **Download source** triggers the browser's `beforeunload` confirmation.

### 2.4 Editor, inline decorations and keyboard shortcuts

#### 2.4.1 Decorations

- A CodeMirror 6 **`StateField<DecorationSet>`** holds one `Decoration.mark` (claim-text marks) or gutter/margin marker per derived clause, styled only from §1.2 and §1.3.
- Decorations are mapped through every transaction with **`tr.changes.mapPos`**, so marks move with surrounding edits without a reducer run.
- An edit inside a clause emits **E9** `ClauseEdited` [01 › Event table]; the affected marks are dropped in the same transaction. After re-segmentation the field is **rebuilt** from the derived entries of the edited block; results return through `resultKey` when the text returns [01 › Persisted result cache].
- **Audit copies** are opened with `EditorState.readOnly.of(true)` and `EditorView.editable.of(false)`; typing shows the non-modal hint *"This is a read-only audit copy. Edit your project in your own editor, then use Re-import."* (exact) at most once per session.
- **`HINT` focus rule.** When the caret enters a `HINT` clause, the label "On-device hint · unconfirmed" appears below the line for 4 s as an absolute overlay (no text moves).
- **`PARSE_TIMEOUT`** (D-27): the clause gets no mark and is listed in the drawer *Can't verify with available sources* with the reason "This sentence could not be analysed (too complex)".
- Marks expose their accessible label through `aria-describedby` on the clause range.

#### 2.4.2 Hover, focus and tap card

Opened after a **250 ms** hover delay on a marked clause or citation marker, on keyboard focus with **`Mod-I`**, and on tap (touch screens). It is a non-modal, focusable `role="dialog"` with `aria-labelledby` on its status label; `Escape` closes it and returns focus.

Contents:
- status label (§1.2) and provenance chip (§1.5);
- per-reference states, one line per reference (`FirstAuthor Year`: label), including any reference chip with its reason and action (§1.3);
- the anchored evidence span (at most 240 characters, snapped substring highlighted, from the cache; no model call);
- buttons: **Open in inspector**, **Add to cloud check** (Standard; adds the clause to the batch consent sheet selection), **Mark reviewed** (author override, E12).

#### 2.4.3 Keyboard shortcuts

`Mod` = `Cmd` on macOS and `Ctrl` elsewhere. Shortcuts act while the editor or the right panel has focus; every action is also reachable with the mouse.

| Shortcut | Action |
|---|---|
| `Mod-Shift-.` | Move the caret to the **next** marked clause in the buckets `problems` or `to_review`, in document order |
| `Mod-Shift-,` | Move the caret to the **previous** such clause |
| `Mod-Enter` | **Primary action** of the focused element: on a drawer row or hover-card button, that action; in the editor, open the clause at the caret in the **Evidence** tab (§2.5) |
| `Mod-Shift-V` | **Verify in cloud:** add the clause at the caret to the selection and open the batch consent sheet (§2.8). Standard mode only; in Confidential mode it shows *"Cloud checks are off in Confidential mode."* (exact). Inside the editor this binding takes precedence over Chrome's "paste as plain text"; the editor holds plain source text, so `Mod-V` already pastes plain text |
| `Mod-Shift-Enter` | **Mark reviewed** (author override, E12) for the clause at the caret |
| `Mod-I` | **Inspect:** open the hover card of the clause or citation marker at the caret |
| `Mod-/` | Show the shortcut list |
| `Escape` | Close the card, sheet or dialog that has focus |

**Reserved browser shortcuts (MUST NOT be bound):** `Alt` alone, `Mod-S`, `Mod-P`, `Mod-F`, `Mod-T`, `Mod-W`, `Mod-L`, `Mod-R`, `Mod-Shift-R` (hard reload), `Mod-Shift-I` and `Mod-Alt-I` (DevTools), `Mod-Shift-T`, `Mod-Shift-N`. `keymap.test.ts` fails if `apps/web/src/editor/keymap.ts` binds any reserved combination.

### 2.5 Evidence inspector (right panel → Evidence tab)

```
┌──── Your claim ──────────────────────────┐  ┌──── Evidence ({sourceKind}) — {FirstAuthor Year}, {section} ───────┐
│ "{clause text}"                          │  │ … {sentence before} [[{snapped evidence span}]] {sentence after} … │
│ {file}:{line} · Section: {section}       │  │ Reference: {title} · DOI {doi} · licence {license}                 │
│ Atoms: • … • …  (labelled "Suggested by   │  │ Retraction: none | Retracted {date}                                │
│ the on-device model" when B1 is advisory)│  │                                                                    │
└──────────────────────────────────────────┘  └────────────────────────────────────────────────────────────────────┘
Per reference: {FirstAuthor Year} — {RefState label} · {provenance chip} · {reference chip and reason, if any}
Warrant ({provenance}): "{s03_micro_reasoning}"
On-device alignment (when B3 is advisory): "{span}" — "Shown for orientation; not a verdict."
Evidence found on this device · not a verdict (for LOCAL_EVIDENCE): "{span}"
No passage of this source matches the claim (when selection.candidates = 0)
On-device model stopped responding — reload to retry (after the settle ceiling, for pairs without a local result)
[Add to cloud check]  [Use full text]  [Pick other evidence ▾]  [Find alternative sources]  [Mark reviewed]
Cloud grounding card (when a cloud result exists): §2.6
```

- **`{sourceKind}`** ∈ {"abstract", "open-access full text", "your PDF", "printed source", "lab note"}.
- **Which passage is shown.** When B3 is `authoritative`, the on-device anchored span is the evidence in the right card; when B3 is `advisory`, the BM25 top-1 unit is shown there and the on-device span appears in the "On-device alignment" line. The choice never changes the verdict wording.
- **Per-reference status breakdown:** one line per mapped reference with its `RefState` label, provenance chip and any "Check this citation" or "Check metadata" chip with its reason.
- **Use full text:** available when open-access full text is cached for the reference; runs Stage 2 over full-text units on this device.
- **Pick other evidence ▾:** a menu of the candidates `EVIDENCE[0..4]` of the pair's selection (rank, section, first 80 characters). Choosing one re-runs Stage 2 with that candidate first; the result enters through E5 under its own `resultKey`.
- **Find alternative sources:** `PREFER_IN_CLOUD` with `AltSourcesV1` [04 › `PREFER_IN_CLOUD` — *Find alternative sources* (`AltSourcesV1`)]. Online in Standard mode it uses the cloud with Google Search (lease `kind = "ALT"`); offline or in Confidential mode it ranks the cached library on this device. The result list shows which source answered ("Cloud" or "On-device") from `inferenceSource`.
- **Mark reviewed:** stores a durable `AuthorOverride` (`basis = REVIEW`) through E12; it persists in the `overrides` store keyed by `(docId, normalizedClaimHash, refIdsKey)`, so it survives trivial edits [01 › Event table].
- **Deep link:** `{file}:{line}` is a button that moves the editor to that line of the concatenated source.

### 2.6 Cloud grounding card

Rendered under the inspector for a clause with an L2 result:
- verdict (`SUPPORTED`, `PARTIAL`, `CONTRADICTED`, `NEI`) with its mark from §1.2;
- the quote with its origin label "From the cited paper" (anchored by L0 against provided evidence) or "From a web source". A **`WEB_SOURCE`** result carries the label *"Web sources only — doesn't change this claim's status"* (exact), and its **Re-run check** button is **hidden until the reference's `evidenceVersion` changes** (new abstract, full text, PDF or printed source);
- for a `CONTRADICTED` kept with a no-difference note: *"No difference in numbers, negation or direction was found; the cloud judged the meaning."* (exact);
- for a provided-evidence call (`l2AdjudicateProvided`): *"Checked against the paper's text only (no web search)."* (exact), and no Search Suggestions;
- the reasoning; the alternatives (only resolved DOIs as links; unresolved DOIs are discarded and never displayed);
- the **Search Suggestions** block: the unmodified `renderedContent` in an iframe with `sandbox="allow-popups allow-popups-to-escape-sandbox"` whose `src` is a **Blob URL** (never `srcdoc`), revoked when the card closes [04 › Grounding display and persistence (D-19, D-22)];
- the sources list built with DOM APIs from `groundingChunks`;
- a suspicious source shows the top line *"Source contains instruction-like text."* (exact).

**After a reload** the card shows the stored verdict, the anchored quote from Toulmin's own evidence (if any) and the neutral label *"Checked in the cloud on {date} — re-run to see sources"* (exact), where `{date}` is the stored result timestamp formatted in the user's locale, with **Re-run check** (hidden for web-source-only results until the evidence changes). Grounded web text and links are never persisted or exported (D-19).

### 2.7 Claim Ledger table, filters and drawers

#### 2.7.1 Table

| Column | Content | Sortable |
|---|---|---|
| # | Document order | yes |
| Location | `{file}:{line}` (deep link) | yes |
| Claim | First 80 characters of the clause | — |
| References | Short labels; ⚑ on references in `REF_PROBLEM`; reference chips | — |
| Status | Glyph + label (§1.2, §1.6) | yes |
| Provenance | Chip (§1.5) | yes |
| Last change | Relative time of the deciding fact | yes |

- **Virtualized:** at most **60 DOM rows** are rendered for ≥ 1,000 entries; row height is constant (36 px) and the scroll container keeps the full scroll height.
- ARIA grid semantics (`role="grid"`, `aria-rowcount` = filtered entry count, `aria-rowindex` on rendered rows).
- The badge **"Changed since last import"** (exact) marks rows whose `normalizedClaimHash` changed in the last Re-import.

#### 2.7.2 Filters (exactly six chips)

Exact labels, in this order, single-select:

| Chip | Entries shown |
|---|---|
| `All` | every non-archived entry (default) |
| `Problems` | bucket `problems` |
| `To review` | bucket `to_review` |
| `Waiting` | bucket `waiting` |
| `Can't verify` | bucket `unverifiable` |
| `Not yet checked` | `local ∪ unchecked` (equal to the header's `{notYetChecked}`) |

**Supported** and **Reviewed** have no chip: their header counts (`{supported} supported`, `{reviewed} reviewed`) are links that set the table to a bucket view of `supported` or `reviewed` (shown as a dismissible pill "Supported" / "Reviewed by you" in place of the chip row's selection), and `reviewed` is also listed by the drawer *Reviewed by you*. Every header count links the same way, so each of the seven header segments reaches its entries. The three drill-down lists **On this device**, **Not checked yet**, **Number mismatches** and the not-checkable list are reached from the drill-down links.

#### 2.7.3 Drawers

The four drawers of [01 › Drawers] are reached from the drill-down and from a drawer strip above the table. Each shows a count, the clause list (document order) and exactly one primary action:

| Drawer (exact title) | Clause states | Primary action (exact) | Empty-state text (exact) |
|---|---|---|---|
| *Waiting for cloud check* | `WAITING` | "Send N claims to cloud check" (opens §2.8 with the listed rows selected). In Confidential mode the drawer cannot contain clauses. While the pool is exhausted the action gives way to the label **"No cloud checks left today — resets at {local time}"**; while the kill switch is on, to *"Cloud checks paused"* | "Nothing is waiting." |
| *Can't verify with available sources* | `UNVERIFIABLE` (including `PARSE_TIMEOUT`) and `MIXED_SUPPORT` | "Add a source" (attach a PDF of the cited source) · secondary "Mark reviewed"; for a row whose reference is `AMBIGUOUS`: "Choose the reference" | "Every checked claim had usable sources." |
| *Source flagged* | `SOURCE_FLAGGED` | "View warning" (sanitizer pattern IDs and the flagged excerpt) | "No sources were flagged." |
| *Reviewed by you* | `REVIEWED_BY_AUTHOR` | "Undo review" (E12 with `value = null`) | "You haven't marked any claim as reviewed." |

While the pool is exhausted, *Waiting for cloud check* keeps its title and its clauses stay in `waiting`; the reset-time label satisfies the "no dead drawers" invariant [01 › Precedence rules, "No dead drawers" invariant and provenance].

### 2.8 Batch consent sheet (consent class B)

Opened from the drawer action "Send N claims to cloud check", from the hover card (**Add to cloud check**) or with `Mod-Shift-V`. The copy is exact [05 › Batch consent sheet (consent class B)]; eligibility follows [04 › Escalation and the batch consent sheet (consent class B)].

| Rule | Specification |
|---|---|
| Rows | At most **25** rows per send (the `quotaGuard` batch limit). With more eligible clauses, the first 25 in the order below are shown with the line "{rest} more will be offered after this batch" (exact) |
| Order (by expected value) | (1) clauses badged **"Changed since last import"**; (2) `HINT` clauses; (3) clauses with a value or a direction word whose local result was `NEI` (`NEI_SILENT_ESCALATE`, including `NO_DIFFERENCE_SIGNAL`); (4) clauses whose reference has `checkMetadata` or is a preprint; (5) the other `WAITING` and `SOURCE_FLAGGED` clauses in **document order** |
| Pre-selection | No row is pre-selected, except when the sheet is opened from "Send N claims to cloud check", which selects every listed row |
| Row content | checkbox · **editable** exact atomic claim text · reference label · **evidence kind indicator** · reason ("On-device hint", "No evidence on this device", "Full text needed", "Changed since last import") · the label "Source contains instruction-like text." where it applies |
| Evidence kind indicator | Chips "abstract", "open-access full text" and "your PDF" for the evidence that **will be sent**, and a grey chip **"no abstract or full text available"** when the reference has neither, so the author can spend leases on rows the cloud can actually check. "your PDF" is struck through while "Include text from my PDFs" is off |
| PDF opt-in | Sheet-level checkbox **"Include text from my PDFs"** (exact), **default off**, shown only when at least one listed row has `USER_PDF` evidence |
| Editing | An edited row is sent exactly as edited; its SHA-256 becomes `approvedTextSha256` and the result binds to it (E7) |
| Quota line | *"Cloud checks left today: {remaining} ({pool})"* with `{pool}` ∈ {"shared preview", "judge access"} |
| Send | **"Send {k} claims"** → one `quotaGuard` request for `k` claim hashes, then L2 calls with at most 2 in flight. Progress per row; a row that fails shows "Not checked — {reason}" and stays `WAITING` |
| Pool runs out during a send | Unsent rows stay `WAITING`; the sheet shows (exact) *"Today's shared cloud checks are used up. On-device checks and reference checks keep working. Judges can use their judge code (⋯ → Judge access) for reserved quota."* |
| Kill switch | *"Cloud checks are paused right now. On-device checks and reference checks keep working."* (exact); **Send** disabled |
| Accessibility | Focus is trapped in the sheet and restored on close; rows are a listbox with checkbox items |

### 2.9 Proof mode HUD (Proof tab)

Proof mode is a view, never a policy switch. The fields are exactly those of [04 › Proof mode HUD (exact fields)], arranged in these cards, in this order:

1. **Profile:** profile ID, L3 state, path (A or B).
2. **"Measured on this device" (contradictions):** `P̂` with its Wilson 95 % interval and `WilsonLB95`; per-call precision (labelled "reported, not gated"); `S` with its bootstrap interval; `PP_pairs`, `TP_pairs`; the plain-language line *"Found {TP_pairs} of 50 contradictions in our test set"* (exact; never the word "recall"); false-contradiction counts on SUPPORT and NEI pairs; prevalence-adjusted precision at **8 %, 12 % and 18 %**, labelled "If 8 % / 12 % / 18 % of cited claims were wrong" and each shown as `{P(π)} (at least {P_LB(π)})`.
3. **"On-device supports" (support gate):** `P̂_S` with `WilsonLB95_S`, `PS_pairs`, `FSR_C` and `FSR_N` as counts of 50, the per-call precision for supports, and the line *"On-device supports are shown: {yes|no} (needs at least 16 on-device supports and a lower bound of at least 0.80; expected to stay off)"* (exact).
4. **Task authority (CF-1) table:** rows B1, B2, B3, B5, O2; columns authority, Δ, p, Holm-adjusted p, power; for B5 the two `INCONSISTENT` precisions; the note *"B3 decides which passage is shown as evidence; it does not decide whether a claim is supported."* (exact).
5. **Calibration run:** the calibrated variant (schema and reasoning cap), the share of this device's Stage 2 calls per schema variant (calibrated vs uncalibrated), the run manifest's `samplingMode`, and `tier_a_hash` and `tier_b_hash` of the active `routing_table`.
6. **Sanity check:** probe `A` and timestamp, with *"The sanity check catches large changes in the on-device model; it is not a calibration."* (exact).
7. **Hybrid counters:** L1 and L2 calls by `inferenceSource` (session and lifetime) as **On-device {n} · Cloud {m}**; the raw `inferenceSource` of the last call; p50/p95 latency per schema; transient outcomes by reason; `LOCAL_STALLED` episodes; whether `LOCAL_LOST` was reached this session.
8. **Model version:** Chrome major version and the manually recorded model version.
9. **Coverage Meter drill-down** [01 › Drill-down].
10. *"Unmarked text has not been verified."*

- **Not calibrated:** with `calibration = null`, card 2 reads *"Not measured on this device profile — on-device hints are off."* (exact).
- **Toggles:** "Show on-device supports" (mirror of the ⋯ item) and, with a judge claim, "Preview as anonymous visitor" (switches the displayed pool and policy locally; the claim stays on the account).
- **Copy measurements:** copies cards 1–6 as Markdown; the copied text always includes `P_LB(π)` next to `P(π)`.

### 2.10 Empty state, first run and Sample Manuscript

#### 2.10.1 Empty state

Centred card when no document is open:

> **Check your manuscript's claims against its sources.**
> [**Try a sample manuscript**] (primary) · [**Start a blank document**] · drop zone *"Drop a LaTeX project (.zip), .tex + .bib, .md or .docx here"*
> Footer: the positioning line [05 › Positioning line (footer, README, onboarding)].

**Start a blank document** opens an empty editable single-file Markdown document titled "Untitled".

#### 2.10.2 First-run order (one click on "Try a sample manuscript")

1. The bundled sample (`/apps/web/public/sample/sample.tex` + `sample.bib`, same origin) opens as an **editable single-file document** with the badge "Sample". **Download source** is available.
2. The mode card appears once (§2.3.1). Without a judge code Confidential is highlighted; the card states that Standard is needed for cloud checks and that the sample can then be checked in the cloud with one click.
3. In parallel, `checkEnvironment()` runs: `available` → probing; `downloadable` → the "Enable on-device verification" card; `unavailable`/`unsupported` → the consent class A card [05 › Consent class A card (devices without a usable model)].
4. Reference resolution of `sample.bib` starts immediately (the first cloud need: anonymous sign-in, then `bibResolve`). Steps 1–3 never wait for sign-in. If sign-in fails, the degraded chip appears and the deterministic results that need no network (missing explicit keys, B5, uncited claims) still appear.

#### 2.10.3 Sample Manuscript content (normative)

`sample.tex` is a **synthetic** single-file manuscript of about 900 words in 5 sections with **7 embedded problems and 1 clean paragraph**. Every cited reference is a real CC-BY open-access paper whose abstract or full text supports the stated expectation. The references are selected during Phase 2: Core Implementation, and the expectations are frozen in `/apps/web/public/sample/expected.json`, which `sample.e2e.ts` checks.

| # | Embedded item | One-click set | Expected state before any cloud check (Standard, cloud available) | Expected state after "Check the sample in the cloud" |
|---|---|---|---|---|
| 1 | Citation whose `.bib` DOI is `10.5555/toulmin-sample-nonexistent-0001` (`ci-sample.yml` verifies daily that it stays unregistered: handle API `responseCode = 100`) | no | `REFERENCE_PROBLEM` ("DOI not found") | same |
| 2 | Citation of a CC-BY paper that is retracted in the Retraction Watch snapshot | no | `REFERENCE_PROBLEM` ("retracted") | same |
| 3 | `\cite{smith2020missing}` (explicit marker) with no such key in `sample.bib` | no | `REFERENCE_PROBLEM` ("citation key not in your bibliography") | same |
| 4 | Claim stating 37 % where the cited abstract reports 23 % for the same outcome | yes (grounded) | Path A: `HINT`; Path B: `WAITING` | `CONTRADICTED`, with Search Suggestions |
| 5 | Claim stating an increase where the cited abstract reports a decrease | yes (grounded) | Path A: `HINT`; Path B: `WAITING` | `CONTRADICTED`, with Search Suggestions |
| 6 | Empirical sentence with a number and no citation | no | `UNCITED_EMPIRICAL` | same |
| 7 | Methods section reports 48 participants; Results reports 46 for the same group at the same timepoint (no attrition cue) | no | purple B5 badge "≠" on both spans | same (B5 is local) |
| clean | One paragraph of three claims, each paraphrasing its cited abstract | yes (3 claims; provided evidence) | `SUPPORTED_LOCAL` (hidden unless "Show on-device supports" is on) when the support gate passes for the profile; otherwise `WAITING` | `SUPPORTED` (green) |

- **Offline-flow claims.** Besides the 7 embedded problems and the clean paragraph, the manuscript contains three ordinary claims used by the Android `bundledSample` ledger and the video [08 › Demo manuscript composition]: a **full-text-only claim** (supported only by a detail of its reference's cached open-access full text; O1), a **printed-table claim** (its value appears only in a printed table of the cited paper; printable page `/docs/demo/printed_table.pdf`; O2), and a **lab-note value** (also present in a typed lab note; printable page `/docs/demo/lab_note.pdf`; O3). On the Web they are `WAITING` (Standard) or `UNVERIFIABLE`/`LOCAL_EVIDENCE` (Confidential) and are not part of the one-click set.
- The one-click set has exactly 5 claims: 2 grounded and 3 provided-evidence calls per run.
- Items 4 and 5 MUST each carry a value or direction difference, so that no no-difference rule can apply to them.
- **Confidential mode:** the "before" column applies with `WAITING` read as `LOCAL_EVIDENCE` for the clean claims and as `UNVERIFIABLE` for items 4–5 under Path B.
- Item 7 is deterministic when B5 is `advisory`; when B5 is `authoritative`, `expected.json` stores the L1 outcome measured on the reference device.

### 2.11 Import and export

#### 2.11.1 Import

- **Entry points:** the empty-state drop zone and *File → Import…*. Accepted: `.zip` (LaTeX project source archive), `.tex` + `.bib` (multi-select), `.md` (+ `.bib`), `.docx`, and `.pdf` (attached to a reference as full text [03 › User-provided PDF (reference full text)]).
- **Scope sentence (exact), shown above the drop zone:** *"Multi-file projects open as a read-only audit copy: keep editing in your own editor and re-import to refresh."* It is preceded by the line *"Single files (.tex without includes, .md) open as editable documents and are checked while you write."* (exact).
- **Progress (7 steps, each with ✓ or an error):**
  1. "Reading files";
  2. "Finding main document";
  3. "Parsing bibliography ({n} entries)";
  4. "Resolving references ({resolved}/{n})";
  5. "Fetching open-access full text ({k})" (background; does not block step 7);
  6. "Building evidence index";
  7. "Ready: {sentences} sentences, {claims} claims to check".
- **Document kind** is decided at import [03 › Document kinds and editability (D-26)]. A multi-file project shows the badge "Audit copy · read-only", the **Re-import** button, and the editor banner *"This is a read-only audit copy. Edit your project in your own editor, then choose Re-import. Toulmin keeps your results."* (exact; `.docx` uses the banner of [03 › `.docx` importer (read-only audit source)]).
- **Import summary card:** `{resolved} resolved · {doiNotFound} DOI not found · {notIndexed} not found in indexes · {mismatch} check metadata · {retracted} retracted · {unresolvedKeys} missing citation keys · {possible} possible citations · {ambiguous} ambiguous citations`. In Standard mode it adds the **quota expectation** *"{n} claims will need a cloud check; {m} available today"* (exact), where `n` is the number of clauses with at least one resolved reference that the baseline triage does not mark `NOT_CHECKABLE`, and `m` is `remainingToday` of the caller's pool (status read, no lease). With `n > m` it adds *"The rest stay in Waiting and can be sent on later days."* (exact).
- **Import-quality report** (expandable section of the summary card): main file chosen, included files and their sizes, `\input` expansion size, bibliography entries parsed and skipped (with keys), citation markers by kind (`EXPLICIT`, `HEURISTIC`), sentences segmented, clauses created, clauses `NOT_CHECKABLE`, and any ingestion limit reached [03 › Ingestion safety limits (all inputs)].
- **Primary CTA:** **"Start audit"** (whole manuscript, viewport first [03 › Viewport-prioritized batch audit queue]) for every document kind. Secondary: **"Start writing"** (single-file) or **"Open audit copy"** (multi-file).
- **Errors (exact copy):**

| Condition | Copy |
|---|---|
| Archive > 200 MB, > 5,000 entries, an entry > 20 MB, compression ratio > 100, or total extracted text > 50 MB | *"This archive is too large or too compressed to import safely."* |
| Total `\input` expansion > 2 MB | *"The included files expand to more than 2 MB of text. Import the chapter you are working on."* |
| No main file | *"No main .tex file found (it needs \documentclass and \begin{document}). Pick one:"* + file picker |
| Unsupported file | *"Toulmin can import LaTeX projects (.zip), .tex with .bib, .md and .docx files."* |

#### 2.11.2 Keeping the author's text

- **Single-file documents:** **"Download source"** downloads the exact editor content as `{title}.tex` or `{title}.md` (UTF-8, the exact bytes); the unsaved-changes marker then clears. `navigator.storage.persist()` and the `beforeunload` warning protect unsaved work (§2.3.6).
- **Multi-file audit copies:** **"Re-import"** opens the file picker for **any multi-file kind** (`.zip`, a `.tex` with includes, or `.docx`): results are keyed by content, not by file type. The new files take the place of the audit copy under the **same `docId`**; ingestion re-runs; every clause whose text is the same restores its results by `resultKey`; changed clauses are queued first (P2) and carry the badge **"Changed since last import"** in the Ledger table, the drawer and the batch consent sheet (order group 1). Toast (exact): *"Re-imported: {kept} claims kept their results, {changed} changed and will be re-checked, {gone} are no longer in the document."* Overrides on clauses no longer in the document are archived.

#### 2.11.3 Export menu (`Export ▾`)

| Item (exact) | Output |
|---|---|
| **Integrity report (.md)** | `integrity-report.md` [03 › `integrity-report.md` and `integrity-report.pdf`] |
| **Integrity report (PDF)** | the browser print of the same HTML with the print stylesheet |
| **Corrected bibliography (.bib)** | `references.corrected.bib` [03 › `references.corrected.bib`]; the original `.bib` is never modified |

Every report header contains *"Unmarked text has not been verified."*; on-device results are exported only under *"On this device (not confirmed)"*; grounded web text, grounding links and Search Suggestions are never exported.

### 2.12 Accessibility (Web)

- Every interactive element is reachable by keyboard in a logical order; focus is always visible (2 px outline, `--t-blue`).
- Cloud results are announced with the words **"checked in the cloud"**; printed-source supports with **"confirmed from a printed source"** [01 › Accessibility labels (exact)].
- Sheets and dialogs trap focus and restore it on close; live result arrivals are announced through one polite `aria-live` region, at most once per 2 s, summarizing counts.
- No information is conveyed by animation; `prefers-reduced-motion` disables the progress shimmer.
- Target: zero WCAG 2.2 AA violations in `axe-core` on the empty state, the Sample Manuscript, the inspector, the batch consent sheet and the Proof tab, in light and dark themes.

### 2.13 Web performance budgets (acceptance targets)

| Metric | Budget |
|---|---|
| Initial JS (gzip), excluding lazy chunks | **≤ 350 KB** |
| Time to interactive, cold load (PC Ryzen 7, CDN cached) | **≤ 2.5 s** |
| Editor keystroke-to-paint while L1 jobs run | **p95 ≤ 16 ms** |
| JS heap with a 300-sentence manuscript and 60 references | **≤ 150 MB** |
| Import of a 1 MB LaTeX project archive to the "Ready" step (excluding network) | **≤ 5 s** |
| Sample Manuscript click to first reference problem shown (online) | ≤ 5 s |
| L0 job time | ≤ 250 ms hard limit (D-27) |

---

## 3. Android Pocket Ledger (`apps/android`, Xiaomi 15T Pro)

### 3.1 Client stack and build flavor

| Concern | Selected | Justification |
|---|---|---|
| Language and UI | **Kotlin 2.x + Jetpack Compose (Material 3)** | Native camera and ML Kit integration; Compose state maps onto ledger flows |
| Camera | **CameraX** (`ImageCapture`, maximum resolution, tap-to-focus) | Stable high-resolution capture for OCR |
| OCR | **ML Kit Text Recognition v2, bundled Latin model** (`com.google.mlkit:text-recognition`) | Offline from the first run; returns blocks, lines and elements with bounding boxes, corner points and angles for the Select-row geometry (§3.8) |
| Local database | **Room 2.7+** with `androidx.sqlite:sqlite-bundled` (`BundledSQLiteDriver`) and a Room **`@Fts4`** entity for evidence search [03 › Android (Room)] | Identical SQLite behaviour on every device; FTS4 is supported by stable Room |
| Concurrency | Kotlin coroutines + `Flow`; one `Mutex`-guarded on-device inference dispatcher | On-device inference is foreground-only and serialized |
| Backup exclusion | `android:allowBackup="false"` and `android:dataExtractionRules` excluding every domain for cloud backup and device transfer | The ledger, evidence cache and photos never leave the device through OS backup (D-10) |
| PDF (local files) | `android.graphics.pdf.PdfRenderer` text extraction (API 35+). ⚠ VERIFY-AT-SPIKE S-A4: page text APIs available on the device → fallback: render pages to `Bitmap` and run ML Kit OCR | Local PDFs attached as `USER_PDF` evidence |
| Firebase | **Firebase BoM ≥ 34.14.0**; **`firebase-ai`** and **`firebase-ai-ondevice`** (+ `firebase-ai-ksp-processor`), versions pinned at spike **S-A2** in `gradle/libs.versions.toml`; `kotlinx-serialization-json` | Firebase AI Logic on-device inference through `Firebase.ai(...)` with `InferenceMode.ONLY_ON_DEVICE` [04 › Model tiers and configuration singletons (`OnDeviceModels.kt`)] |

**Build flavor.** The Gradle build defines **one product flavor, `bundledSample`**, and every APK — the distributed judge APK and the team's local builds — is built from it. There is no networked flavor. `ci-android.yml` fails if the release dependency graph contains `firebase-firestore`, `firebase-functions`, `firebase-auth`, `firebase-appcheck*`, `firebase-config` (fetch), `firebase-storage` or `play-integrity`, or if `tools/scan-artifacts.ts` finds any App Check debug provider class or debug-token string in the APK.

### 3.2 `bundledSample` distribution flavor

- **Bundled data (read-only assets):** the pre-cached Sample Manuscript ledger, the abstracts of its references, their licence-verified open-access full-text chunks, the retraction snapshot used for the sample, and the bundled Remote Config defaults (`routing_table` in its bundled conservative form, unless a published table with matching `freeze.tier_a_hash` was embedded at build time) [04 › `bundledSample` flavor contract (D-18)].
- **Zero Firebase network calls:** no Firestore, no Cloud Functions, no Firebase Authentication, no App Check or Play Integrity token requests, no Remote Config fetch, no Cloud Storage. A network capture of a full session (O1–O4 plus a local file import) shows **zero** requests.
- **On-device inference:** every check calls `Firebase.ai(...).generativeModel(...)` with **`InferenceMode.ONLY_ON_DEVICE`**, offline; result cards show `inferenceSource = ON_DEVICE` from the SDK.
- **Privacy context:** constant and Confidential-equivalent [01 › Signature, inputs and helpers]; `mode.cloudAvailable` is always false, so the `{waiting}` count is always `0` and is still shown.
- **Optional local import:** through the Android **Share Sheet** (`ACTION_SEND` / `ACTION_SEND_MULTIPLE`) or the **document picker** (`ACTION_OPEN_DOCUMENT`): a single `.md` or `.tex` file (without includes) with an optional `.bib`, plain text (`text/plain`, opened as `.md`), and PDFs attached as `USER_PDF` evidence to a reference of the open ledger [03 › User-provided PDF (reference full text)]. Imported data is stored only in the app's private no-backup storage. References that are not in the bundled cache keep `bibStatus = UPSTREAM_UNAVAILABLE` [01 › Enumerations]; their claims can still be checked with O2, O3 or an attached PDF.
- **Features that need a network** (bibliographic lookup, open-access fetch, cloud checks, *Find alternative sources* in the cloud) are not present. Where such an action would appear, the screen shows *"Not available in this build. Use the web app for cloud features."* (exact).

### 3.3 Screens and navigation

```
First launch → Model check (tier resolution [04 › Model tiers and configuration singletons (`OnDeviceModels.kt`)]) → Home
Home (Offline Readiness Meter + Coverage Meter header + Ledger list)
  ├─ Claim Detail (§3.6) → { O1 Re-check with full text | O2 Check against a printed page |
  │                          O3 Check against a lab note | O4 Suggest a citation | Mark reviewed }
  ├─ Open a file (document picker) · incoming Share Sheet intents → Import summary → Home
  └─ Settings
```

**Settings** (exact item labels, in this order):
- **"Privacy mode"** — read-only line *"Confidential — this build makes no network calls."* (exact) — an APK is distributed only after the `S-A5` network capture and AC-SEC-18 confirm zero traffic, so this line is always true in a distributed build;
- **"Show on-device supports"** — switch, default off;
- **"On-device model"** — the observed `baseModelName` (`getBaseModelName()`), the active tier (`Stable`, `Preview` or `none`), the AICore package version, and the last tier-resolution time;
- **"Delete local data"** — §3.11;
- **"About and licences"** — version, Apache-2.0, third-party notices, the positioning line.

### 3.4 Offline Readiness Meter (Home header, exact format)

`"Offline ready: {nAbs}/{nRefs} references with abstract · {nFt}/{nRefs} with full text · retraction snapshot {yyyy-mm-dd} · model: {tier} ({baseModelName})"`

- `{nRefs}` = references of the open ledger; `{nAbs}` and `{nFt}` = those with a cached abstract or full text; `{yyyy-mm-dd}` = the UTC day of the bundled snapshot; `{tier}` ∈ {`Stable`, `Preview`, `none`}.
- Below it, the seven-count Coverage Meter header of §2.3.6 (same format and labels) and the two disclaimers of §1.7. Tapping the header opens the drill-down.

### 3.5 Ledger list

- **Filters** (exact chips, in this order, single-select): `Waiting`, `Possible conflicts`, `Unresolved`, `All` (default).

  | Chip | Entries shown |
  |---|---|
  | `Waiting` | buckets `waiting ∪ unchecked` — claims not yet checked on this phone (including `CHECKING`); `waiting` is empty in this build |
  | `Possible conflicts` | bucket `problems`, state `HINT`, and every entry with a B5 or lab-note flag (`numberMismatches`) |
  | `Unresolved` | states `PARTLY_SUPPORTED`, `CHECK_METADATA`, `UNCITED_EMPIRICAL`, and buckets `unverifiable` and `local` |
  | `All` | every non-archived entry |

- **Row:** status glyph (§1.2), clause excerpt, reference label, provenance chip, and the badge **"Can check offline"** (exact) when cached evidence exists for a mapped reference or a capture flow (O2/O3) applies.
- `SUPPORTED_LOCAL` rows show no check unless "Show on-device supports" is on.
- Tapping a row opens **Claim Detail**.

### 3.6 Claim Detail screen

One scrolling screen per clause, top to bottom:
1. **Claim:** the clause text, its section and `{file}:{line}`; the atoms when B1 is authoritative.
2. **Per-reference chips:** one card per mapped reference: `FirstAuthor Year` · state label (§1.6) · reference chip ("Check this citation" with its reason on tap, or "Check metadata").
3. **Anchored evidence snippet** (collapsible; collapsed to 3 lines by default): the snapped span with one sentence of context and the evidence kind ("abstract", "open-access full text", "your PDF", "printed source", "lab note"); for printed sources, the verified row crop.
4. **Warrant:** `s03_micro_reasoning` with its provenance.
5. **Provenance chip** (§1.5) with the **`ON_DEVICE` badge** for on-device results; a long press and the "Details" line show the raw `inferenceSource` and the `baseModelName`.
6. **Actions** (only those that apply; each a full-width button): **Re-check with full text** (O1), **Check against a printed page** (O2), **Check against a lab note** (O3), **Suggest a citation** (O4), **Mark reviewed** (author override, E12; **Undo review** when already reviewed).

### 3.7 O1: Re-check with cached full text

1. **Eligible:** clause state `UNVERIFIABLE`, `LOCAL_EVIDENCE`, `HINT` or `UNCHECKED`, with cached full-text units for a mapped reference.
2. **Run:** BM25 over that reference's full-text units (top 5, conditional quantity-class bonus, claim-coverage filter `bm25_min_cov`) [02 › BM25 scoring and the transitive grid comparator] → Stage 2 `VerdictV1` (calibrated variant) **`ONLY_ON_DEVICE`** under the L1 deadline and settle ceiling (D-28) → the anchor validator with `layer = "L1"` [03 › Post-Decode Evidence Anchor Validator (L1 & L2)]. The result enters the reducer as E5.
3. **While running:** the activity sets `FLAG_KEEP_SCREEN_ON` and shows *"Keep this screen open while checking."* (exact); the flag is cleared when the run ends or the screen stops.
4. **Display:** the derived state, the anchored span, and *"Checked on this phone (unconfirmed)"* (exact), with the provenance chip "On-device". A local `CONTRADICTS` is shown as `HINT` only when the routing table puts `android_aicore_stable` in Path A. A local `SUPPORTED` is shown as "Supported on this device · unconfirmed" only when support verdicts are authoritative for the profile; otherwise as "Evidence found on this device · not a verdict".

### 3.8 O2: Check against a printed page

Resolve a claim from a photographed printed table row or text passage. **Select-row** is the primary flow; its geometry is deterministic.

1. **Choose the reference, or find its DOI.** A list of the clause's references and the library, or **"Find the DOI on the page"** (the page-1 DOI scanner applied to the OCR text after capture [03 › User-provided PDF (reference full text)]).
2. **Capture.** CameraX `ImageCapture` at maximum resolution; overlay rectangle with *"Fit the table inside the frame and hold the phone parallel to the page"* (exact); tap-to-focus; flash toggle. The JPEG is stored in app-private storage; `photoSha256` is computed over its bytes.
3. **OCR** with the bundled ML Kit Text Recognition model (offline). Spinner: *"Reading the page on this phone…"* (exact).
4. **Capture quality gate.** Compute the angle of every **line with ≥ 3 elements** ("qualifying lines").
   - With **fewer than 4** qualifying lines, the interquartile-range test is **skipped**; the photo is rejected only if the absolute median angle `|θ|` of the qualifying lines (`θ = 0` when none qualifies) exceeds **20°**.
   - With **at least 4** qualifying lines, the photo is rejected if the **interquartile range** of their angles exceeds **3°**.
   - Rejection message (exact): *"The page is tilted. Hold the phone parallel to the page and try again."*; the camera reopens. No perspective correction is attempted.
5. **Deskew.** `θ` = median of `Text.Line.angle` over the qualifying lines. ⚠ VERIFY-AT-SPIKE S-A4: `angle` is populated for lines → fallback: estimate `θ` from each line's `cornerPoints` (slope between the top-left and top-right corners). All boxes are rotated by `−θ` around the image centre.
6. **Select the row.** The deskewed photo shows line boxes with *"Tap the row with the number you cited."* (exact). The row = all lines whose deskewed centre-Y is within **0.6 × the median line height** of the tapped line's centre-Y; it is outlined in `--t-blue`.
7. **Confirm the header (one or two rows).** The app proposes the nearest line group above the row in which ≥ 50 % of tokens are non-numeric, outlined in `--t-grey`, with *"Is this the column header?"* (exact) and the buttons **Yes**, **Pick another row** and **"Add the row above"** (exact). **Add the row above** may be used once, for a two-row header; each lower header cell is then named **`"{upper} · {lower}"`**, where `{upper}` is the upper-row cell with the largest horizontal overlap, and both header rows are outlined.
8. **Cell assignment and evidence string.** Within each header row and the selected row:
   - sort the row's inter-element gaps ascending (`g[i] ≥ 1 px`), find the **largest ratio jump** `g[i+1] / g[i]`, and set the row-specific threshold `G = (g[i] + g[i+1]) / 2` at that position;
   - `G` is at least **1.0 ×** the median character width (element width / character count);
   - if no ratio exceeds **1.8**, the row has single-space gaps only and `G = 1.5 ×` the median character width;
   - elements are split into cells wherever a gap exceeds `G`;
   - each row cell is assigned to the header cell with the **largest horizontal overlap** after deskew (with no overlap, to the header cell with the nearest centre), which handles right-aligned and decimal-aligned columns;
   - the evidence string is `"{header₁}: {cell₁}; {header₂}: {cell₂}; …"` [02 › Evidence chunking].
9. **Extraction, sanity checks and value confirmation.**
   - **Extraction:** `O2PhysicalExtractV1` (when O2 is `authoritative`) or the deterministic Select-row value matching (when `advisory`): the claim's numbers are matched by value against the row cells, each match becoming a fact with `f2_column` = its header; when advisory, L1 facts are shown as "Suggested by the on-device model".
   - **Numeric sanity checks:** percentage in [0, 100]; sample size a positive integer; CI lower ≤ point ≤ upper; p in [0, 1]; normalised `·` and `−`. A failing value shows ⚠ *"Check this value against the photo."* (exact).
   - **Value confirmation (mandatory, one tap per value, at most 3 values):** a **composite image** of the header strip(s) above the row strip, with the selected cell outlined in both, and the extracted header and value as text. Buttons **"Matches the photo"** / **"Edit"** (exact). An edit marks the value `author-edited`. The composite's SHA-256 is stored as **`rowCropSha256`**; confirmation sets `confirmedByAuthorAt`.
10. **Stage 2 verdict and entailment confirmation.** Stage 2 runs `ONLY_ON_DEVICE` on the evidence string with the anchor validator (`layer = "L1"`); the result enters as E8 `PhysicalResultArrived`. Then:
    - **`SUPPORTED`:** the screen shows the claim above the confirmed row crop and asks *"Does this row support your claim?"* (exact) with **"This row supports my claim"** and **"Not sure"** (exact). **This row supports my claim** sets `entailmentConfirmedByAuthorAt` (E8 re-emitted with the confirmed capture; idempotent by `captureId`) → `SUPPORTED_CONFIRMED` (rule R4) → green **"Supported (printed source)"** with provenance **`Printed source · Author`**. **Not sure** leaves an on-device support (`SUPPORTED_LOCAL` or `LOCAL_EVIDENCE`); never green.
    - **`NEI`:** *"This row doesn't settle the claim. Try another row or page."* (exact), **and** the button **"This row supports my claim"** remains available. Tapping it creates an `AuthorOverride` with **`basis = PRINTED_SOURCE`**, this `captureId` and `dismissedState` = the current state (E12). The clause becomes `REVIEWED_BY_AUTHOR`: grey "reviewed" glyph, label **"Reviewed by you"**, provenance `Printed source · Author` — **never green**, because no model agreed that the row supports the claim.
    - **`CONTRADICTS`:** no entailment tap; the result is a **`HINT`** under Path A, otherwise **`UNVERIFIABLE`** in this build (no cloud is available). Never red.
    - **Provenance record:** `PhysicalSource { captureId, photoSha256, kind: PHYSICAL_TABLE | PHYSICAL_TEXT, linkedRefId, pageLabel, rowCropSha256, confirmedByAuthorAt, entailmentConfirmedByAuthorAt }`; the author enters `pageLabel` (for example "p. 412, Table 2"). Photos never leave the phone.

**Grid mode (gated).** The toggle **"Read the whole table"** appears only when Remote Config `o2_grid_enabled = true`, which is set (in the bundled defaults at build time) only if the O2 evaluation reaches **≥ 0.85 cell accuracy** with its confidence interval reported [07 › Grid-mode gate]. Grid mode deskews as in step 5; clusters **lines** into rows by deskewed centre-Y with tolerance 0.6 × median line height; finds column gaps as horizontal intervals with zero coverage in the projection of all element boxes, keeping gaps wider than 1.5 × the median character width; assigns cells by projection overlap; merges a row into the previous one only when its first cell is empty and its other cells are non-numeric. Grid mode still ends with steps 9 and 10 for each used value.

### 3.9 O3: Check against a lab note

- **Scope:** **typed or printed** lab notes only; handwriting is out of scope. The capture screen states *"Typed or printed notes only."* (exact).
- **Flow:** steps 2–9 of O2 (including the capture quality gate) with `kind = LAB_NOTE` and no reference link; `pageLabel` such as "Logbook 3, p. 27". OCR → `O2PhysicalExtractV1` with `s1_kind = LAB_NOTE` → anchored facts → tuples (`source = "lab_note"`, `section = "lab:" + photoSha256[0:12]`).
- **Pairing:** the tuples enter **B5 pairing** against the manuscript tuples [03 › Deterministic incremental pairing]:
  - a divergent pair shows *"Your manuscript differs from your lab note ({pageLabel})."* (exact) with the crop, the manuscript span and only the purple badge **"≠ lab note"**;
  - an equal pair shows *"Matches your lab note ({pageLabel})."* (exact) and attaches the capture as `Lab note` evidence (informative; it never makes a clause green).
- **Confirmation:** **"I confirm this difference"** (exact) records the lab-note mismatch flag through **event E16**; the purple badge stays and the item counts in the drill-down line "Number mismatches". It **never** produces `CONTRADICTED`, a red mark or a `problems` count (D-29).

### 3.10 O4: Suggest a citation (offline)

- **Eligible:** `UNCITED_EMPIRICAL`.
- **Flow:** BM25 over the cached library's titles and abstracts (top 5) → Stage 1/2 `ONLY_ON_DEVICE` against each candidate's cached evidence → candidates ordered `SUPPORTED`, then `NEI_SILENT_ESCALATE`, then `CONTRADICTS`, each with its anchored span and local verdict label (§1.6).
- **Action:** **"Copy citation"** copies the citation for the candidate (`\cite{key}` for `.tex`, `[@key]` for `.md`) to the clipboard. The phone never edits manuscript text.
- **Honesty line (exact):** *"Suggestions come only from references already on this phone. Finding new sources needs a connection."*

### 3.11 Lifecycle and storage

- **Foreground-only inference.** A `ProcessLifecycleOwner` observer calls `Scheduler.pause()` on `ON_STOP` (the current call keeps its L1 deadline) and `Scheduler.resume()` on `ON_START`.
- **Storage budgets:** cached evidence **≤ 200 MB** (LRU by reference last use; bundled sample assets are exempt); photos and crops **≤ 500 MB** (when the limit would be exceeded, the app lists the oldest captures and the author confirms their deletion).
- **Settings → Delete local data** deletes the Room database (ledger, `refFacts`, results, overrides, evidence cache), photos and crops after the confirmation *"Delete everything Toulmin stored on this phone?"* (exact); the bundled sample is then restored from the read-only assets.

---

## 4. iOS Thin Client (`apps/ios`, iPhone 13 Pro Max)

| Concern | Selected |
|---|---|
| Language and UI | **Swift 6 + SwiftUI**, deployment target **iOS 26** |
| Firebase | **`firebase-ios-sdk` ≥ 12.13.0 via Swift Package Manager**: `FirebaseAILogic`, `FirebaseAppCheck` (App Attest, DeviceCheck fallback), `FirebaseAuth` (anonymous), `FirebaseFunctions`, `FirebaseRemoteConfig` |
| AI runtime | `apps/ios/ToulminL1` [04 › iOS Thin Client (iPhone 13 Pro Max) — `apps/ios/ToulminL1/AppleL1.swift`] |
| Persistence | In memory, plus the **last 20** `ThinCheckResult` records in a SwiftData store whose directory is marked **`isExcludedFromBackup = true`** [01 › Swift — `apps/ios/ToulminCore/Ledger.swift` (thin-client subset)] |

**Single-screen UI contract ("Check this claim"):**
- **Inputs:** a multi-line field for the claim (paste or type); up to **5** evidence sentence fields ("Evidence sentence {i}", added with **+**); an optional **Reference DOI** field resolved with `bibResolve` and shown as a reference chip (§1.3).
- **Mode switcher:** `Confidential` / `Standard` (segmented control).
- **Model chip** (exact): *"Cloud (this iPhone can't run the on-device model)"*, derived from `SystemLanguageModel.default.availability`; its tooltip (popover) shows the `availability` reason verbatim.
- **Confidential mode:** **Check this claim** is disabled with *"This iPhone has no on-device model. In Confidential mode only reference checks are available."* (exact); the DOI field still resolves the reference.
- **Standard mode:** the consent class A card [05 › Consent class A card (devices without a usable model)] is shown once per install with the reason *"This iPhone can't run Apple's on-device model."*; after consent, **Check this claim** runs `HybridModel(primary: SystemLanguageModel.default, secondary: Gemini)`, the SDK answers from the secondary cloud model, and the result card shows the verdict, the anchored quote, provenance `Cloud`, and *"Answered by the cloud model because this device isn't eligible"* (exact).
- **Telemetry:** `rawResponse.modelVersion` is recorded verbatim in each result and shown in a **Details** disclosure, together with the derived `inferenceSource`.
- **History:** the last 20 results in a list below the result card; **Delete local data** in the toolbar menu deletes the SwiftData store.

---

## 5. Monorepo Directory Structure & Strict Module Boundaries

### 5.1 Repository and toolchains

- Repository `github.com/{org}/toulmin`, public, licence **Apache-2.0** (shown in the GitHub "About" panel).
- **pnpm workspaces** (TypeScript: `packages/*`, `apps/web`, `functions`, `eval-harness`, `tools`); **Gradle** (`apps/android`); **Xcode + Swift Package Manager** (`apps/ios`).

### 5.2 Directory tree

```
toulmin/
├── AGENTS.md                                 # agent entry point and routing table
├── LICENSE                                   # Apache-2.0
├── NOTICE                                    # third-party notices; pre-existing code disclosure pointer
├── README.md                                 # base URL, devices and observed model generations, measurements, privacy,
│                                             #   pre-existing code disclosure
├── SECURITY.md                               # threat model summary, parser "separated from credentials", reporting address
├── package.json  pnpm-workspace.yaml  tsconfig.base.json  .editorconfig  .nvmrc (22)
├── firebase.json                             # Hosting headers, CSP and Trusted Types [05]; codebases: default (production
│                                             #   functions) and staging (cspReportStaging, deployed only to toulmin-staging)
├── .firebaserc  firestore.rules  firestore.indexes.json  storage.rules  remoteconfig.template.json
├── freeze/
│   ├── tier_a.txt                            # Tier A file list (git tag l0-freeze-a)
│   ├── tier_b.txt                            # Tier B file list
│   └── cf1_baselines.txt                     # CF-1 deterministic baseline file list (cf1_baseline_hash)
├── .github/workflows/
│   ├── ci-ts.yml                             # lint, typecheck, unit, L0 conformance (TS), ReDoS fuzz, reducer properties,
│   │                                         #   copy, tokens and keymap tests, schema/prompt hash check, csp-hash --verify,
│   │                                         #   normative-example meta-test, Holm fixture, freeze-hash check, replay
│   │                                         #   determinism (network disabled), import-boundary lint
│   ├── ci-android.yml                        # ktlint, unit, L0 conformance (Kotlin), assembleRelease, dependency-graph check
│   │                                         #   (no Firebase network artifacts), scan-artifacts (debug providers/tokens)
│   ├── ci-ios.yml                            # swift test (conformance subset), xcodebuild iOS, scan-artifacts
│   ├── ci-rules.yml                          # Firestore and Storage rules tests on the emulator
│   ├── ci-functions.yml                      # unit + emulator integration (replay, quotas, pools, judge lanes, oaFetch →
│   │                                         #   oaParse IAM, forged X-Forwarded-For), tools/check-iam.ts, oaparse import check
│   └── ci-sample.yml                         # daily: sample DOI still unregistered; sample.e2e.ts against production
├── packages/
│   ├── core-l0/                              # pure TypeScript reference implementation of every L0 algorithm
│   │   ├── norm_table.json  unicode_15_1.bin  porter_v1.json  wordlist_en.txt  bm25_min_cov.json
│   │   ├── src/norm.ts  segment.ts  mask.ts  math.ts  latex.ts  sections.ts  citations.ts  clauses.ts  bm25.ts
│   │   │   coverage.ts  porter.ts  chunk.ts  sanitize.ts  quantity.ts  units.ts  metricClass.ts      # Tier A
│   │   ├── src/anchor.ts  b5pairing.ts  triageBaseline.ts                                         # Tier B
│   │   ├── src/ingest/{zip.ts, tex.ts, bib.ts, docx.ts, md.ts, pdf.ts}                            # outside both tiers
│   │   ├── src/ledger.ts                     # Tier B: types, refFacts, Selection, Versioned<T>, SessionFacts, derive(), meter
│   │   ├── src/gate.ts                       # Tier B: evaluateGate, evaluateSupportGate (floor 16), checkAuthority (Holm)
│   │   ├── src/watchdog.ts                   # 250 ms worker watchdog (D-27)
│   │   └── test/                             # unit, conformance runner, fuzz/redos.test.ts, prop/reducer.prop.test.ts
│   ├── schemas/
│   │   ├── *.schema.json                     # TriageV1, TriageFlatV1, VerdictV1, VerdictV1_cap30, VerdictV1_cap20,
│   │   │                                     #   VerdictFlatV1, B5CheckV1, O2PhysicalExtractV1, O2PhysicalExtractFlatV1,
│   │   │                                     #   L2Verdict, AltSourcesV1
│   │   └── tools/check-kotlin-mirror.ts      # Kotlin @Generable property names and order equal the JSON Schemas
│   ├── prompts/
│   │   └── p2.1/{stage1.txt, stage2.txt, b5.txt, o2.txt, l2.txt, alt_sources.txt}
│   ├── copy/
│   │   ├── en.json                           # every user-facing string, including all "exact" copy
│   │   ├── tokens.json                       # colour tokens (light/dark) and contrast targets
│   │   ├── glyphs.json  glyphs.woff2         # status glyph set
│   │   └── test/{copy.test.ts, tokens.test.ts}
│   └── firebase-client/                      # the ONLY Web module that imports firebase/ai
│       └── src/
│           ├── firebase.ts                   # initializeApp, App Check (reCAPTCHA Enterprise), ensureAuth, Remote Config
│           ├── config.ts  rcDefaults.ts  telemetry.ts  degraded.ts
│           ├── l1/{readiness.ts, download.ts, models.ts, call.ts, deadline.ts, settle.ts, sessionCache.ts}
│           ├── l2/{adjudicate.ts, altSources.ts, grounding.ts}
│           └── callables/{bibResolve.ts, oaFetch.ts, quotaGuard.ts, redeemJudgeCode.ts}   # lane selection
├── conformance/
│   └── l0/                                   # golden files shared by TypeScript, Kotlin and Swift
│       ├── norm.json  segment.json  math.json  sections.json  citations.json  clauses.json  bm25.json  chunk.json
│       ├── anchor.json  sanitize.json  quantity.json  b5pairing.json  triage_baseline.json  reducer.json  meter.json
│       ├── gate.json  claimhash.json  holm.json  support_gate.json  b5_baseline.json  b5_incremental.json  ocr_rows.json
│       └── README.md                         # format: [{ "input": …, "expected": … }]
├── probe/
│   └── probe_set_p2.json                     # probe pairs per profile
├── apps/
│   ├── web/                                  # Vite + Preact + CodeMirror 6
│   │   ├── index.html  vite.config.ts        # index.html: hashed inline bootstrap only (no external script tags)
│   │   ├── public/sample/{sample.tex, sample.bib, expected.json}
│   │   └── src/
│   │       ├── main.tsx  router.tsx  bootstrap.inline.js   # bootstrap creates Trusted Types policies default,
│   │       │                                               #   toulmin-html, toulmin-worker, toulmin-loader
│   │       ├── l3/{stateMachine.ts, probe.ts, routingTable.ts, scheduler.ts, stalled.ts}
│   │       ├── editor/{extensions.ts, marks.ts, hoverCard.tsx, keymap.ts}
│   │       ├── panels/{LedgerTable.tsx, Filters.tsx, Drawers.tsx, EvidenceInspector.tsx, CloudCard.tsx,
│   │       │          ProofTab.tsx, StatusBar.tsx}
│   │       ├── header/{ModeSwitch.tsx, ModelChip.tsx, QuotaIndicator.tsx, DegradedChip.tsx, SampleCloudCheck.tsx,
│   │       │          DownloadSource.tsx, Reimport.tsx, ExportMenu.tsx, OverflowMenu.tsx, JudgeAccess.tsx,
│   │       │          CoverageMeter.tsx}
│   │       ├── sheets/BatchConsentSheet.tsx
│   │       ├── onboarding/{EmptyState.tsx, ModeCard.tsx, EnvironmentCard.tsx, ConsentACard.tsx}
│   │       ├── import/{ImportDialog.tsx, ImportProgress.tsx, ImportSummary.tsx, QualityReport.tsx}
│   │       ├── export/{report.ts, bibExport.ts, print.css}
│   │       ├── storage/{dexie.ts, persist.ts, deleteLocalData.ts}
│   │       ├── workers/{l0.worker.ts, ingest.worker.ts, pdf.worker.ts}
│   │       └── test/{keymap.test.ts, sample.e2e.ts, a11y.e2e.ts, perf.e2e.ts}
│   ├── android/                              # Gradle multi-module; single product flavor bundledSample
│   │   ├── settings.gradle.kts  build.gradle.kts  gradle/libs.versions.toml
│   │   ├── app/                              # Compose UI: Home, Claim Detail, O1–O4, Import summary, Settings;
│   │   │   └── src/bundledSample/assets/     #   sample ledger, evidence cache, retraction snapshot, RC defaults, copy
│   │   ├── core-l0/                          # Kotlin port of packages/core-l0, including Ledger.kt and Gate.kt
│   │   ├── l1/                               # the ONLY Android module that imports com.google.firebase.ai:
│   │   │                                     #   OnDeviceModels (tier cascade), CallL1, @Generable schemas, prompt loader
│   │   ├── ocr/                              # CameraX, ML Kit OCR, capture gate, Select-row geometry, grid mode,
│   │   │                                     #   composite crops, sanity checks
│   │   └── data/                             # Room (BundledSQLiteDriver, @Fts4), DAOs, evidence cache, local import
│   └── ios/
│       ├── Toulmin.xcodeproj
│       ├── Package.swift                     # targets ToulminCore, ToulminL1, ToulminApp
│       ├── ToulminCore/                      # Ledger.swift, JSON repair, conformance subset (norm, segment, anchor, reducer)
│       ├── ToulminL1/                        # the ONLY iOS target that imports FirebaseAILogic: AppleL1, HybridModel session
│       └── ToulminApp/                       # SwiftUI "Check this claim"
├── functions/                                # Cloud Functions 2nd gen, Node.js 22, TypeScript
│   ├── package.json  tsconfig.json
│   ├── src/
│   │   ├── index.ts                          # bibResolve, bibResolveJudge, oaFetch, oaFetchJudge, oaParse, oaParseJudge,
│   │   │                                     #   quotaGuard, redeemJudgeCode, budgetBreaker, recaptchaBreaker, rwSnapshot
│   │   ├── common/{config.ts, appcheck.ts (rejectReplay), validate.ts, log.ts, counters.ts (reserve/refund, shards),
│   │   │          lanes.ts, clientIp.ts}
│   │   ├── net/{safeFetch.ts (pinned-IP undici, forbidden ranges), magic.ts}
│   │   ├── bib/{openalex.ts, s2.ts, crossref.ts, doiHandle.ts, mismatch.ts}
│   │   ├── oa/{locate.ts, arxivOai.ts, identity.ts, chunk.ts}   # chunk.ts: pure wrapper over packages/core-l0
│   │   ├── oaparse/{handler.ts, jats.ts, pdf.ts, index.ts}      # deployed as oaParse and oaParseJudge
│   │   ├── quota/{quotaGuard.ts, pools.ts, netHash.ts}
│   │   ├── judge/{redeemJudgeCode.ts, validity.ts}
│   │   ├── budget/{budgetBreaker.ts, recaptchaBreaker.ts}
│   │   ├── rw/snapshot.ts
│   │   └── staging/cspReportStaging.ts       # staging codebase only; never part of the production deploy target
│   └── test/                                 # unit + emulator tests
├── eval-harness/
│   ├── data/                                 # dev, r1e (+ groups, incl. S-GRAY), probe_pool, ms_b123, ms_b5, ms_o2
│   │                                         #   (+ capture_gate), ms_san, rt_inj, preprints, ANNOTATION_GUIDE.md
│   ├── schemas/VerdictV1_r0.schema.json      # evaluation-only
│   ├── src/
│   │   ├── runner-web.ts                     # Playwright-driven Chrome stable; imports packages/firebase-client
│   │   ├── stats.ts  holm.ts  power.ts  kappa.ts  disjointness.ts  manifest.ts  publish_routing.ts
│   │   │   bm25Calibrate.ts  r1eL2.ts  o2eval.ts  sanitizerEval.ts
│   │   ├── baselines/{clauseAtoms.ts, triageBaseline.ts, bm25Top1.ts, b5Deterministic3.ts, selectRowMatch.ts}
│   │   └── reports/                          # generators, including H4_DECISION.md
│   ├── android-runner/                       # instrumented tests running the same datasets on the Xiaomi 15T Pro
│   ├── py/stats_check.py                     # independent cross-check (4 decimal places)
│   ├── fixtures/{stats_fixture.json, holm_fixture.json}
│   ├── reports/                              # committed reports, including replay/{runId}_{tierB}.md
│   └── runs/{runId}/manifest.json            # generated
├── tools/
│   ├── issue-judge-codes.ts                  # 10 codes (maxUids 5); uploads HMAC document IDs only
│   ├── reset-judge-code.ts                   # operator CLI, never deployed: --disable | --enable | --clear-uids
│   ├── check-iam.ts                          # per-class service accounts, secret accessors, oaParse invoker
│   ├── scan-artifacts.ts                     # fails on debug providers/tokens or secrets in any release artifact
│   ├── csp-hash.ts                           # bootstrap hash; --verify: no external script, policy parity with preview
│   ├── freeze-hash.ts                        # tier_a_hash, tier_b_hash, cf1_baseline_hash
│   ├── replay.ts                             # Tier B replay over run logs, no network
│   ├── cost-model.ts                         # pool-vs-cap arithmetic and budget-action simulation
│   ├── claims-lint.ts                        # scans README, Devpost copy and Testing Instructions for forbidden words/secrets
│   ├── video-words.ts                        # recomputes narration word counts and WPM
│   ├── count-ac.ts                           # verifies the exact unique acceptance row count (154)
│   └── loadtest/k6-script.js                 # quota and lane load test
├── infra/
│   ├── iam/service-accounts.yaml             # one service account per function class and its secrets
│   └── storage-cors.json                     # GET-only CORS for /rw from https://toulmin.web.app
└── docs/
    ├── spec/                                 # 01_DATA_REDUCER_AND_METER.md … 08_CONTEST_README_AND_VIDEO.md
    ├── spikes/                               # one record per spike: /docs/spikes/<ID>.md
    ├── ops/{costlog.md, oncall.md}
    ├── architecture.md  privacy.md
    └── operator-runbook.md                   # Standard and Active Judging Monitoring Modes, levers, recovery
```

**Not present in the tree (MUST NOT be added):** any device-pairing, QR or cross-device transfer module or dependency (no `qrcode`, no ML Kit Barcode Scanning); any production CSP reporting function; any native macOS target; any App Check debug provider or token in a release configuration; any long-term key or JWT code; any `?code=` URL handling; any Serverless VPC Access connector configuration.

### 5.3 Module boundary rules (MUST; each enforced in CI)

1. **Pure `core-l0`.** `packages/core-l0` contains pure functions only: no Firebase, no DOM API, no network API, no Node I/O, no scheduling timers, no random source other than an injected seed. Its outputs depend only on its inputs and its frozen data files. The Kotlin port (`apps/android/core-l0`) and the Swift subset (`apps/ios/ToulminCore`) follow the same rule. [`ci-ts.yml`: `no-restricted-imports` and `no-restricted-globals` on `packages/core-l0/**`; `ci-android.yml` and `ci-ios.yml` module dependency checks]
2. **Single Firebase AI Logic import boundary.** Only `packages/firebase-client` (Web and the Web evaluation runner), `apps/android/l1` and `apps/ios/ToulminL1` may import Firebase AI Logic (`firebase/ai`, `com.google.firebase.ai.*`, `FirebaseAILogic`). `apps/web`, `apps/android/app` and `apps/ios/ToulminApp` use these modules only through their exported interfaces; UI code never constructs a `GenerativeModel`. [`ci-ts.yml`: `no-restricted-imports` on `firebase/ai` outside `packages/firebase-client/**`; Gradle module visibility; SwiftPM target dependencies]
3. **Single prompt and schema source with runtime hash verification.** Prompts are read only from `packages/prompts/p2.1` and schemas only from `packages/schemas`. Builds copy them into each app's assets together with their SHA-256. At runtime each app compares the asset hash with Remote Config `prompt_version` (on Android, with the bundled default) and refuses to run L1 on a mismatch (`PROMPT_HASH_MISMATCH`). Kotlin `@Generable` property names and order equal the JSON Schemas. [`ci-ts.yml` schema/prompt hash check; `schemas/tools/check-kotlin-mirror.ts`]
4. **Cross-language conformance oracle.** `conformance/l0/*.json` is the shared oracle. TypeScript and Kotlin produce identical outputs on every file; Swift on the subset it implements (`norm`, `segment`, `anchor`, `reducer`). The gate decisions (Path A, support-verdict authority, task authority) come only from `gate.ts` and `Gate.kt`, verified by `gate.json`, `support_gate.json` and `holm.json`. A failure blocks merge. [`ci-ts.yml`, `ci-android.yml`, `ci-ios.yml`]
5. **Shared `core-l0` bundling in `oaParse`.** Server-side chunking and sanitizing use the same `packages/core-l0` code as the clients: `functions/src/oa/chunk.ts` is a pure wrapper over it, and the `oaParse` / `oaParseJudge` bundle (`functions/src/oaparse/**`) imports `core-l0` only through that wrapper, so client and server chunks are byte-identical (`conformance/l0/chunk.json` runs against the built function bundle). The transitive import graph of the parser bundle MUST NOT contain any HTTP client, Secret Manager client or Firebase Admin SDK. [`ci-functions.yml` bundle import check; `conformance/l0/chunk.json`]

The freeze-tier rules for `/freeze/tier_a.txt`, `/freeze/tier_b.txt` and `/freeze/cf1_baselines.txt` and the remaining guardrails are listed in `AGENTS.md` §7.
