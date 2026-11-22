# 05 — Backend, Security & FinOps

**Owns:** the backend runtime stack and architecture; per-class service accounts and least-privilege IAM; the Firebase Hosting security headers, Content Security Policy and Trusted Types policies; every Cloud Function contract (`bibResolve`, `bibResolveJudge`, `oaFetch`, `oaFetchJudge`, `oaParse`, `oaParseJudge`, `redeemJudgeCode`, `quotaGuard`, `budgetBreaker`, `recaptchaBreaker`, `rwSnapshot`); the SSRF guard; quota pools, network keys and reserve-then-reconcile counters; App Check scoping and replay protection; the Firebase console configuration; spend caps, budgets and cost guardrails; the operator runbook and its two monitoring modes; the exact privacy, consent and disclosure copy; Firestore and Cloud Storage security rules and TTL policies.

**Load with:** `AGENTS.md` (always). Data shapes returned to clients are consumed by `01_DATA_REDUCER_AND_METER.md` (`BibStatus`, `RefFacts`) and by `03_L0_TIER_B_VALIDATOR_B5_INGEST.md` (ingestion); server-side chunking imports `packages/core-l0` [02 › Evidence chunking].

**Cross-reference notation.** `[0n › Topic]` names the owning specification file `docs/spec/0n_*.md` and the topic heading inside it. A bare `§n.m` refers to this file.

**Projects and hosts.**

| Item | Value |
|---|---|
| Production project | `toulmin-prod` |
| Staging project (spikes, verification, CSP reporting, R1-E-L2) | `toulmin-staging` |
| Production site (the only allowed web origin) | `https://toulmin.web.app` |
| Default Storage bucket | `toulmin-prod.firebasestorage.app` |
| Callable host | `https://us-central1-toulmin-prod.cloudfunctions.net` |

**Environment parameters** (Firebase `params`, set per project at deploy time; never literals in code, `AGENTS.md` §7.4):

| Parameter | Type | Read by | Meaning |
|---|---|---|---|
| `JUDGE_TIER_EXPIRY_EPOCH` | integer (Unix epoch seconds) | `redeemJudgeCode` (`judge-sa`) | Expiry written into judge codes and judge claims. MUST be later than the end of the official judging period |
| `MONITORING_MODE` | `STANDARD` \| `ACTIVE_JUDGING` | alerting configuration only | Selects the operator cadence of §4.4 |

---

## 1. Backend Architecture, Runtime Stack & Per-Class Service Accounts

### 1.1 Infrastructure stack

| Component | Choice |
|---|---|
| Functions | **Cloud Functions for Firebase, 2nd gen**; Node.js **22**; TypeScript; `firebase-functions` **≥ 6**; region **`us-central1`** |
| Database | **Firestore**, Native mode, location **`nam5`** |
| Object storage | **Cloud Storage for Firebase**, location **`US`**, bucket `toulmin-prod.firebasestorage.app` |
| Hosting | **Firebase Hosting** (site `toulmin`), headers of §2 |
| Secrets | **Secret Manager** through `defineSecret`, each secret bound to exactly one or two service accounts (§1.3) |
| Parameters | Firebase `params` (`defineInt`, `defineString`) for `JUDGE_TIER_EXPIRY_EPOCH` and `MONITORING_MODE` |
| Outbound HTTP (fetchers only) | **`undici`** `Agent` with a custom `connect.lookup` that pins the validated IP address (§3.2) |
| PDF parsing (`oaParse` only) | **`pdfjs-dist` ≥ 4.2.67**, legacy build, `isEvalSupported: false` |
| XML parsing (`oaParse` only) | **`fast-xml-parser` ≥ 4.5.0**, `preserveOrder: true`, `ignoreAttributes: false` |
| Chunking and sanitizing | `packages/core-l0` (pure; identical to the clients) |
| Configuration | Firebase Remote Config (server-side writes by `ops-sa` only) |
| Billing | Blaze plan, Cloud Billing budgets with Pub/Sub notifications (§3.5) |

### 1.2 End-to-end architecture

```
┌───────────────────────────────────────────── CLIENTS ─────────────────────────────────────────────┐
│  Web Chrome Workbench            Android Pocket Ledger (bundledSample)      iOS Thin Client         │
│  L0 workers · L1 Gemini Nano     L0 (Kotlin) · L1 AICore Gemini Nano        HybridModel             │
│  L2 client · Proof mode          ONLY_ON_DEVICE · zero network calls        (SystemLanguageModel →  │
│  IndexedDB (no backup)           Room (no backup)                            gemini-3.8-flash)      │
└──────┬───────────────────────────────┬──────────────────────────────────────────────┬──────────────┘
       │ App Check (reCAPTCHA Ent.)    │ (no network traffic)                         │ App Check
       │ limited-use tokens + session  │                                              │ (App Attest)
       ▼                                                                              ▼
┌──────────────────────────────── GOOGLE CLOUD / FIREBASE (project toulmin-prod) ────────────────────┐
│                                                                                                    │
│  Firebase AI Logic gateway ── App Check + replay protection · Authenticated users mode ·           │
│     30 RPM per user · spend cap US$60/month ──► Gemini Developer API (paid) · gemini-3.8-flash     │
│                                                                                                    │
│  Firebase Authentication (anonymous; App Check enforced, Preview) · custom claims tier/codeId      │
│                                                                                                    │
│  Cloud Functions 2nd gen · us-central1 · spend cap US$40/month                                     │
│   ┌────────────────────────┐  ┌────────────────────────┐  ┌───────────────────────────────┐        │
│   │ bibResolve      bib-sa │  │ oaFetch     oafetch-sa │──►│ oaParse (private, IAM)        │        │
│   │ bibResolveJudge        │  │ oaFetchJudge           │──►│ oaParseJudge  oaparse-sa      │        │
│   │ [App Check, standard]  │  │ [App Check, standard]  │  │ no roles · no secrets · no    │        │
│   └──────────┬─────────────┘  └──────────┬─────────────┘  │ HTTP client · invoker =       │        │
│              │ OpenAlex · Semantic       │ Europe PMC ·    │ oafetch-sa only               │        │
│              │ Scholar · Crossref ·      │ Unpaywall ·     └───────────────────────────────┘        │
│              │ doi.org handle API        │ arXiv OAI-PMH (pinned-IP HTTPS fetch)                    │
│   ┌────────────────────────┐  ┌────────────────────────┐                                           │
│   │ quotaGuard    quota-sa │  │ redeemJudgeCode        │                                           │
│   │ [consumed App Check]   │  │ judge-sa [consumed]    │                                           │
│   └────────────────────────┘  └────────────────────────┘                                           │
│   ┌──────────────────────────────────────────────────────────────────────────────┐                │
│   │ ops-sa:  budgetBreaker (Pub/Sub billing-alerts) · recaptchaBreaker (Pub/Sub     │                │
│   │          recaptcha-alerts) · rwSnapshot (scheduled daily)                       │                │
│   └──────────────────────────────────────────────────────────────────────────────┘                │
│                                                                                                    │
│  Firestore (nam5, client deny-all except own quota/leases reads):                                  │
│    /users/{uid}/quota/{day} · /users/{uid}/leases/{leaseId} · /judgeCodes/{hmacHex} ·               │
│    /refmeta/{refIdHash} · /netCounters/{netHash}_{day}_{s} · /global/state ·                         │
│    /global/counters/shards/{pool}_{day}_{s} · /global/arxivLock                                      │
│  Cloud Storage (US): /oa/{refIdHash}/chunks.json (function-only) · /rw/snapshot-{yyyymmdd}.json.gz   │
│                      (signed-in read)                                                               │
│  Remote Config: routing_table · cloud_model · prompt_version · kill_switch_cloud · pools mirror    │
│  Secret Manager: OPENALEX_API_KEY · S2_API_KEY · CROSSREF_MAILTO · UNPAYWALL_EMAIL ·               │
│                  NET_HASH_PEPPER · JUDGE_CODE_PEPPER (judge-sa only)                               │
│  Budgets: gross US$110 · ai-logic US$60 · uncapped US$20 · recaptcha US$10 (all gross cost)        │
└────────────────────────────────────────────────────────────────────────────────────────────────────┘
   Operator tools (never deployed): tools/issue-judge-codes.ts · tools/reset-judge-code.ts ·
                                    tools/check-iam.ts · tools/cost-model.ts
```

There is **no** public HTTP function in production. Every client-callable function is a callable protected by App Check; `oaParse` and `oaParseJudge` are reachable only through IAM.

### 1.3 Per-class service accounts and least-privilege IAM matrix

Each function runs as the service account of its class (`serviceAccount: "<name>@toulmin-prod.iam.gserviceaccount.com"`). Each secret is accessible only to the accounts listed for it. The IAM policy is declared in `/infra/iam/service-accounts.yaml`.

| Service account | Functions | Access |
|---|---|---|
| `bib-sa` | `bibResolve`, `bibResolveJudge` | Secrets `OPENALEX_API_KEY`, `S2_API_KEY`, `CROSSREF_MAILTO`, `NET_HASH_PEPPER`. Firestore read/write on `/refmeta`, `/users/*/quota`, `/netCounters`, `/global/counters/shards`, `/global/state`. Firestore read on `/judgeCodes` (judge-lane revocation check, §3.3.3) |
| `oafetch-sa` | `oaFetch`, `oaFetchJudge` | Secrets `UNPAYWALL_EMAIL`, `NET_HASH_PEPPER`. **Cloud Run Invoker on `oaParse` and `oaParseJudge` only**. Storage read/write on `/oa/**`. Firestore read/write on `/refmeta`, `/global/arxivLock` and the quota and counter paths (`/users/*/quota`, `/netCounters`, `/global/counters/shards`); read on `/global/state` and `/judgeCodes` |
| `oaparse-sa` | `oaParse`, `oaParseJudge` | **Zero IAM roles, zero secrets**; no Firestore, Storage or Secret Manager access; invoker restricted solely to `oafetch-sa` |
| `quota-sa` | `quotaGuard` | Secret `NET_HASH_PEPPER`. **Firebase App Check Token Verifier** `[F]`. Firestore read/write on `/users/*/quota`, `/users/*/leases`, `/netCounters`, `/global/counters/shards`; read on `/global/state` and `/judgeCodes` |
| `judge-sa` | `redeemJudgeCode` | **Sole reader of `JUDGE_CODE_PEPPER`**; also `NET_HASH_PEPPER` and the parameter `JUDGE_TIER_EXPIRY_EPOCH`. **Firebase Authentication Admin** (`setCustomUserClaims`). **Firebase App Check Token Verifier**. Firestore read/write on `/judgeCodes`, plus its own call-limit counters (`/users/*/quota`, `/netCounters`) |
| `ops-sa` | `budgetBreaker`, `recaptchaBreaker`, `rwSnapshot` | **Remote Config Admin**. Firestore write on `/global/state`. Storage write on `/rw/**`. **reCAPTCHA Enterprise Admin**, used only by `recaptchaBreaker` and only to disable the Web key |

**Notes.**
- The switch and pool fields of `/global/state` (`killSwitch`, `killSwitchAt`, `hardStop`, `pools`, `rwLatest`) are mutated only by `ops-sa` and by operators. `bib-sa` uses its `/global/state` grant only for reads in code; `oafetch-sa` and `quota-sa` hold read access only.
- `JUDGE_CODE_PEPPER` is readable only by `judge-sa`. The judge-lane revocation check of the other classes reads the `codeId` stored in the caller's custom claim and compares it with `/judgeCodes` document IDs, which needs no pepper.
- `NET_HASH_PEPPER` is a separate random 32-byte secret used only for network-prefix hashing (§4.1).
- **CI IAM verification.** `tools/check-iam.ts` (run in `ci-functions.yml` against `toulmin-staging` on every change and against `toulmin-prod` before every deploy) reads the IAM policy of every function service, every secret and the project. It fails if:
  - a function runs as a service account other than the one of its class;
  - a function shares a broader service account, or an account holds a role not listed above;
  - a secret has an accessor not listed above;
  - `oaParse` or `oaParseJudge` has any invoker other than `oafetch-sa`, including `allUsers` or `allAuthenticatedUsers`;
  - `oaparse-sa` holds any role.

---

## 2. Web Hosting Security Headers, CSP & Trusted Types

### 2.1 Production `firebase.json` (MUST be exactly enforced)

The bootstrap hash `sha256-BOOTSTRAP_HASH` is computed at build time by `tools/csp-hash.ts` over the single inline bootstrap script in `index.html` and substituted into `firebase.json` by the build.

```json
{
  "hosting": {
    "site": "toulmin",
    "public": "dist",
    "headers": [
      {
        "source": "**",
        "headers": [
          { "key": "Content-Security-Policy",
            "value": "default-src 'self'; script-src 'sha256-BOOTSTRAP_HASH' 'strict-dynamic'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://www.gstatic.com https://www.google.com; connect-src 'self' https://firebasevertexai.googleapis.com https://firestore.googleapis.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://content-firebaseappcheck.googleapis.com https://firebaseremoteconfig.googleapis.com https://firebaseremoteconfigrealtime.googleapis.com https://firebaseinstallations.googleapis.com https://firebasestorage.googleapis.com https://us-central1-toulmin-prod.cloudfunctions.net https://www.google.com/recaptcha/; frame-src 'self' blob: https://www.google.com/recaptcha/ https://recaptcha.google.com/recaptcha/; worker-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; require-trusted-types-for 'script'; trusted-types default toulmin-html toulmin-worker toulmin-loader" },
          { "key": "Referrer-Policy", "value": "no-referrer" },
          { "key": "X-Content-Type-Options", "value": "nosniff" },
          { "key": "Permissions-Policy", "value": "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
          { "key": "Cross-Origin-Opener-Policy", "value": "same-origin" }
        ]
      }
    ],
    "rewrites": [{ "source": "**", "destination": "/index.html" }]
  }
}
```

- The production policy has **no** `report-to` directive and the production response has **no** `Reporting-Endpoints` header (§2.4).
- `connect-src` lists exact hosts only; no wildcard host is permitted.
- `style-src 'unsafe-inline'` is permitted because CodeMirror and the grounding content inject style elements. The residual risk (CSS injection) is accepted and recorded in `SECURITY.md`.
- Authentication is anonymous only; there is no popup or redirect sign-in flow, so no identity-provider hosts are allowed.

**Cloud Storage CORS** (`/infra/storage-cors.json`, applied with `gcloud storage buckets update gs://toulmin-prod.firebasestorage.app --cors-file=infra/storage-cors.json`; needed only for client reads of the `/rw` snapshot):

```json
[
  {
    "origin": ["https://toulmin.web.app"],
    "method": ["GET"],
    "responseHeader": ["Content-Type"],
    "maxAgeSeconds": 3600
  }
]
```

### 2.2 Script loading under `'strict-dynamic'` (normative)

With `'strict-dynamic'`, Chrome ignores host allowlists and `'self'` in `script-src`; only the hashed inline bootstrap script is trusted, and scripts it inserts programmatically inherit that trust. Therefore:
1. The Vite build sets **`build.modulePreload: false`**. The built `index.html` contains **no** external `<script src>` tag and no `<link rel="modulepreload">` tag.
2. The inline bootstrap script first creates the Trusted Types policies of §2.3. It then creates `<script type="module">`, assigns its `src` with `toulminLoader.createScriptURL("/assets/index-<hash>.js")` (the file name is injected at build time), and appends it to `<head>`. Static and dynamic imports of that module graph are trusted through `'strict-dynamic'`.
3. Web Workers are created with `new Worker(toulminWorker.createScriptURL(url), { type: "module" })`.
4. **Build check.** `tools/csp-hash.ts --verify` fails the build if `index.html` contains any external script tag or any module-preload link, if the computed bootstrap hash differs from the one in `firebase.json`, or if the production policy string differs from the staging preview string without its reporting suffix (§2.4).

### 2.3 Trusted Types policies (created in the bootstrap before any other script runs)

| Policy name | `createHTML` | `createScriptURL` | `createScript` |
|---|---|---|---|
| `default` | throws `TypeError` | Parses the input with `new URL(input)` (which resolves dot segments). Returns the **serialized parsed URL** only if `protocol = "https:"`, `username = ""`, `password = ""`, and the URL starts with `https://www.google.com/recaptcha/` or `https://www.gstatic.com/recaptcha/` (origin ∈ {`https://www.google.com`, `https://www.gstatic.com`} and `pathname` starts with `/recaptcha/`). Otherwise throws | throws |
| `toulmin-html` | returns `DOMPurify.sanitize(input, { RETURN_TRUSTED_TYPE: false })` (**DOMPurify ≥ 3.2.4**, pinned) | throws | throws |
| `toulmin-worker` | throws | returns the input **only** if `new URL(input, location.origin)` is same-origin and its `pathname` matches `^/assets/[A-Za-z0-9._-]+\.js$`; otherwise throws | throws |
| `toulmin-loader` | throws | same rule as `toulmin-worker`; used only by the bootstrap to load the application entry module | throws |

- The `default` policy exists only so that the reCAPTCHA Enterprise loader, which assigns `script.src` with a string, keeps working. It MUST NOT allow any other URL.
- `DOMParser.parseFromString` is never called on untrusted strings outside DOMPurify.
- **Grounding renderer (D-22).** The client creates `const url = URL.createObjectURL(new Blob([renderedContent], { type: "text/html" }))` and assigns `iframe.src = url` on an iframe with `sandbox="allow-popups allow-popups-to-escape-sandbox"`; it revokes the URL when the card closes. `renderedContent` is not modified and `srcdoc` is never used. A document loaded from a `blob:` URL inherits the creator's Content-Security-Policy regardless of the `sandbox` attribute `[F2]`; the sandbox without `allow-scripts` prevents script execution in the frame [04 › Grounding display and persistence (D-19, D-22)].

### 2.4 Staging preview CSP reporting

CSP violation reporting exists **only** on a Firebase Hosting **preview channel of the separate project `toulmin-staging`**, during verification (spike `S-W6`):
- The build target `preview` appends `; report-to csp` to the policy string and adds the header `Reporting-Endpoints: csp="https://us-central1-toulmin-staging.cloudfunctions.net/cspReportStaging"`.
- **`cspReportStaging`** is deployed **only in `toulmin-staging`** (`functions/src/staging/cspReportStaging.ts`, `maxInstances: 1`, excluded from the production deploy target by `firebase.json` codebase configuration). It records only `effectiveDirective`, the `blockedURL` origin and path (no query string), the `documentURL` path and a per-day count; it never records user data.
- **Policy parity.** The production policy string MUST equal the preview policy string without the `; report-to csp` suffix; `tools/csp-hash.ts --verify` asserts this equality.
- An unauthenticated public reporting endpoint in production would be an unbounded cost and abuse surface that the spend caps do not cover, so production has none. In production, operators detect CSP breakage from the Functions error-rate dashboard and the smoke tests of the runbook (§4.4), not from violation reports.

⚠ VERIFY-AT-SPIKE S-W6: (a) reCAPTCHA Enterprise loads and App Check obtains tokens under this CSP and these Trusted Types policies, and the names of any Trusted Types policies created by the reCAPTCHA loader are recorded; (b) the application entry module and its imports load through `toulmin-loader` under `'strict-dynamic'`; (c) Vite module workers and the pdf.js worker start through `toulmin-worker`; (d) the Blob-URL grounding iframe renders without CSP violations; (e) the callable host and the Storage host match the requests, and the `/rw` snapshot download succeeds with the bucket CORS configuration. All five checks run on the staging preview channel with reporting enabled, and checks (a), (b) and (d) are repeated on the production site with DevTools open → fallback: add only the exact host, path or policy name reported in the violation report (a wildcard host MUST NOT be added); if module imports are blocked, emit a single-chunk entry (`build.rollupOptions.output.inlineDynamicImports = true`) and keep workers as separate entries.

---

## 3. Cloud Functions Specifications

### 3.0 Common rules

```ts
// functions/src/common.ts
import { onCall, HttpsError, type CallableRequest } from "firebase-functions/v2/https";

// Anchored origin; the emulator configuration (functions/.env.local) adds /^http:\/\/localhost:\d+$/ and is never deployed.
export const CORS = [/^https:\/\/toulmin\.web\.app$/];

export const BASE = { region: "us-central1", enforceAppCheck: true, cors: CORS } as const;   // standard App Check
export const CONSUMING = { ...BASE, consumeAppCheckToken: true } as const;                    // replay protection [F]

/** MUST be the first statement of every handler configured with CONSUMING. */
export function rejectReplay(request: CallableRequest<unknown>): void {
  if (request.app?.alreadyConsumed) throw new HttpsError("permission-denied", "REPLAYED_TOKEN");
  if (!request.app) throw new HttpsError("failed-precondition", "APP_CHECK_REQUIRED");
}
```

1. **Region and App Check.** Every callable uses `region: "us-central1"` and `enforceAppCheck: true`.
2. **CORS.** The only allowed origin is the anchored pattern `^https://toulmin\.web\.app$`. `localhost` is allowed only in the emulator configuration.
3. **Replay rejection.** In every consuming handler (`quotaGuard`, `redeemJudgeCode`), the first line is the replay check: `if (request.app?.alreadyConsumed) throw new HttpsError("permission-denied", "REPLAYED_TOKEN")`, implemented by `rejectReplay`.
4. **No payload logging.** Functions MUST NOT log request payloads containing titles, raw reference strings, claim text or abstracts. They log only counts, hashes, latencies and error classes.
5. **Hard stop.** Every callable reads `/global/state` (60 s in-memory cache) and refuses with `unavailable: HARD_STOP` before doing any work while `hardStop = true`.
6. **Judge lanes.** `bibResolveJudge`, `oaFetchJudge` and `oaParseJudge` run the same code as their public counterparts on their own instances. The judge lanes refuse any caller whose ID token lacks a valid judge claim (`tier = "judge"`, `tierExp > now`, `codeId` naming an active `/judgeCodes` document whose `uids` contains the caller; 60 s cache) with `permission-denied`. The public functions refuse judge callers with `failed-precondition: USE_JUDGE_LANE`, so each pool's load stays on its own instances. Clients choose the lane from their current claim. Upstream rate budgets are split evenly between the two lanes.

**Per-function configuration:**

| Function | App Check | `maxInstances` | `concurrency` | Memory / CPU | Timeout | Service account |
|---|---|---|---|---|---|---|
| `bibResolve` (anonymous pool) | standard | 1 | 20 | 512 MiB / 1 | 120 s | `bib-sa` |
| `bibResolveJudge` (judge pool only) | standard | 1 | 20 | 512 MiB / 1 | 120 s | `bib-sa` |
| `oaFetch` (anonymous pool; fetch, licence, identity, cache; no parsing) | standard | 3 | 4 | 512 MiB / 1 | **60 s** | `oafetch-sa` |
| `oaFetchJudge` (judge pool only) | standard | 2 | 4 | 512 MiB / 1 | 60 s | `oafetch-sa` |
| `oaParse` (**private** HTTP function for `oaFetch`) | none (IAM only) | **10** | **1** | 2 GiB / 1 | 60 s | `oaparse-sa` |
| `oaParseJudge` (**private** HTTP function for `oaFetchJudge`) | none (IAM only) | **4** | **1** | 2 GiB / 1 | 60 s | `oaparse-sa` |
| `quotaGuard` | consuming | **3** | 40 | 256 MiB / 1 | 30 s | `quota-sa` |
| `redeemJudgeCode` | consuming | **3** | 10 | 256 MiB / 1 | 30 s | `judge-sa` |
| `budgetBreaker`, `recaptchaBreaker` (Pub/Sub), `rwSnapshot` (scheduled) | n/a | 1 | 1 | 512 MiB / 1 | 300 s | `ops-sa` |

**Client side.** Only callables configured with `CONSUMING` are invoked with limited-use tokens:

```ts
const quotaGuard = httpsCallable(getFunctions(app, "us-central1"), "quotaGuard", { limitedUseAppCheckTokens: true });
const redeemJudgeCode = httpsCallable(getFunctions(app, "us-central1"), "redeemJudgeCode", { limitedUseAppCheckTokens: true });
const bibResolve = httpsCallable(getFunctions(app, "us-central1"), isJudge() ? "bibResolveJudge" : "bibResolve");   // standard token
const oaFetch = httpsCallable(getFunctions(app, "us-central1"), isJudge() ? "oaFetchJudge" : "oaFetch");             // standard token
```

**Input validation (all functions, before any upstream call):**

| Field | Rule |
|---|---|
| DOI | From a `.bib` field or a resolved record: taken verbatim [03 › LaTeX archive, `.tex` + `.bib`, `.md`], trimmed, lowercased; MUST match `10.` + 4–9 `DIGIT` + `/` + 1–300 characters that are not whitespace or control characters (SICI DOIs with `<`, `>`, `;`, `(`, `)`, `[`, `]` are valid). From free text only: the page-1 DOI scanner [03 › User-provided PDF (reference full text)] |
| PMCID | `PMC` followed by 1–10 `DIGIT` |
| arXiv ID | `DDDD.DDDDD` with optional `vN`, or the old style `archive(.XX)?/DDDDDDD` with optional `vN` |
| Title | ≤ 500 characters after `norm()` |
| Raw reference string | ≤ 1,000 characters after `norm()` |
| `refId` | `doi:` + a valid DOI, or `oa:` + an OpenAlex work ID `W` + 1–12 `DIGIT` |

**Per-item encoding.** Every value placed in an upstream URL is encoded with `encodeURIComponent`. A DOI containing `|`, `,` or `&` is never placed in an OpenAlex OR-filter; it is queried singly with `GET /works/doi:{encoded}`.

### 3.1 `bibResolve` and `bibResolveJudge`

| Item | Specification |
|---|---|
| Request | `{ items: Array<{ key: string; doi?: string; title?: string; authors?: string[]; year?: number; raw?: string }>; doiOnly?: boolean }`, 1–100 items, at most 50 with `raw`. The client batches larger bibliographies |
| Response | `{ results: Array<BibResult> }` |
| Limits | Items per tier in §4.1 |
| Quota | Reserved **before** any upstream call (reserve-then-reconcile, §4.2) for the item count; unused reservations and items that end `UPSTREAM_UNAVAILABLE` or `RATE_LIMITED` are **refunded** at the end of the call |

```ts
interface BibResult {
  key: string;
  status: "RESOLVED" | "DOI_NOT_FOUND" | "NOT_INDEXED" | "AMBIGUOUS" | "METADATA_MISMATCH" | "UPSTREAM_UNAVAILABLE"
        | "RATE_LIMITED" | "PENDING";
  refId: string | null;                  // "doi:" + lowercase DOI, else "oa:" + OpenAlex work ID, else null
  doi: string | null; openalexId: string | null; s2PaperId: string | null;
  title: string | null; authors: Array<{ family: string; given?: string }>; authorCount: number;
  year: number | null; venue: string | null; isPreprint: boolean;
  isRetracted: boolean; retraction: { source: "OPENALEX" | "CROSSREF" | "RW_SNAPSHOT"; date?: string; noticeDoi?: string } | null;
  mismatch: Array<"TITLE" | "YEAR" | "FIRST_AUTHOR"> | null;   // for METADATA_MISMATCH
  oaAvailable: boolean;                  // server-derived; the client never receives or sends URLs or licences
  abstract: string | null;               // returned to the client; NEVER persisted server-side (D-11); JATS/HTML tags stripped
  abstractSource: "OPENALEX" | "S2" | "CROSSREF" | null;
  candidates?: Array<{ doi: string; title: string; year: number }>;  // AMBIGUOUS (≤ 3)
}
```

**Algorithm:**

1. **Normalize DOIs:** strip `https://doi.org/`, `http://dx.doi.org/` and `doi:`; lowercase; trim whitespace. A DOI from a `.bib` field is never re-scanned.
2. **Rate limiting.** Each lane has `maxInstances: 1`, so its in-memory token buckets are authoritative for that lane. Upstream budgets are split evenly between the lanes:
   - OpenAlex: 5 req/s per lane (10 req/s total);
   - Semantic Scholar: 0.5 req/s per lane (**1 req/s total, coordinated**);
   - Crossref: 2.5 req/s single and 0.5 req/s for queries, per lane. ⚠ VERIFY-AT-SPIKE BE-2: current Crossref polite-pool limits → fallback: these defaults;
   - `doi.org` handle API: 2 req/s per lane.

   When elapsed time exceeds 100 s, the remaining items are returned with `PENDING`, and the client retries them in a new call.
3. **OpenAlex** (primary; requests carry `api_key={OPENALEX_API_KEY}` `[F2]`):
   - **DOIs** in chunks of 50: `GET https://api.openalex.org/works?filter=doi:{d1}|{d2}|…&per-page=50&select=id,doi,display_name,publication_year,authorships,primary_location,best_oa_location,open_access,abstract_inverted_index,is_retracted,ids,type&api_key={OPENALEX_API_KEY}`.
   - **Titles without DOI** (skipped when `doiOnly: true`): `GET /works?search={encoded title}&filter=publication_year:{year-1}-{year+1}&per-page=3&select=…`. A hit is accepted if the title similarity (step 7) is ≥ 0.90 **and** the first authors match. Two or more acceptable hits → `AMBIGUOUS`.
   - **Abstract** = the reconstruction of `abstract_inverted_index` (each word placed at each of its positions, joined with spaces).
   - `isPreprint` = `type` is `preprint`, or the venue is arXiv, bioRxiv, medRxiv, SSRN or Research Square.
   - ⚠ VERIFY-AT-SPIKE BE-2: the OpenAlex OR-filter limit and pricing for list calls → fallback: singleton `GET /works/doi:{doi}`.
4. **Semantic Scholar batch** (gaps: missing abstract): `POST https://api.semanticscholar.org/graph/v1/paper/batch?fields=title,abstract,year,authors,externalIds,isOpenAccess,openAccessPdf,journal,publicationTypes` with body `{ "ids": ["DOI:10.…", …] }` (≤ 500 ids), header `x-api-key: {S2_API_KEY}`, at most **1 request per second** across both lanes.
5. **Crossref polite pool** (remaining gaps, raw strings, retraction relations):
   - **DOI:** `GET https://api.crossref.org/works/{encoded doi}?mailto={CROSSREF_MAILTO}`.
   - **Raw string** (skipped when `doiOnly`): `GET https://api.crossref.org/works?query.bibliographic={encoded raw}&rows=3&mailto={CROSSREF_MAILTO}`. The top hit is accepted if `score ≥ 60` and the title similarity with the raw string's longest quoted or sentence-cased segment is ≥ 0.6; otherwise `NOT_INDEXED`.
   - **Retraction:** entries of `message.relation` or `message["updated-by"]` with `type = retraction` → `isRetracted = true`. ⚠ VERIFY-AT-SPIKE BE-2: exact field names → fallback: the Retraction Watch snapshot and OpenAlex `is_retracted` only.
   - **JATS strip:** abstracts from Crossref are JATS; tags are stripped and character entities decoded before return.
6. **Status rules:**
   - **Explicit DOI that no index matched:** query the DOI handle registry `GET https://doi.org/api/handles/{encoded doi}`.
     - `responseCode = 100` (handle not found) → **`DOI_NOT_FOUND`** (red, D-02).
     - `responseCode = 1` (success) **or** `responseCode = 200` (the handle exists but has no values of the requested type) → the DOI is registered → **`NOT_INDEXED`** (never red).
     - Any other code, or any error → `UPSTREAM_UNAVAILABLE`. `[F2]`
     - ⚠ VERIFY-AT-SPIKE BE-4: the response codes of the handle API → fallback: `HEAD https://doi.org/{encoded doi}` without following redirects; 404 → `DOI_NOT_FOUND`; 301/302/303 → `NOT_INDEXED`.
   - **Reference without a DOI that no index matched** (book, report, thesis, conference paper, non-English literature) → `NOT_INDEXED` (grey "Check this citation"; never red).
   - `DOI_NOT_FOUND` and `NOT_INDEXED` are returned only when every applicable upstream answered successfully (HTTP 200 or 404).
   - Any upstream 429 → `RATE_LIMITED`; any 5xx, timeout or network error → `UPSTREAM_UNAVAILABLE`. Both transient statuses are never red (D-04); the client retries with exponential backoff starting at 30 s.
7. **Tolerant metadata mismatch:**
   - **Title similarity:** `titleSim(a, b) = max(Jaccard(tokens(a'), tokens(b')), containment(shorter, longer))`, where `a'`, `b'` are `foldLatin(normLower(·))` with stopwords deleted, and with everything after the first `:` deleted **when the other title has no `:`**.
   - **Rules:**
     - `TITLE` if `titleSim < 0.5`;
     - `YEAR` if `|Δyear| > 1` **and** neither record is a preprint (a preprint and its published version may differ by more than a year);
     - `FIRST_AUTHOR` if the family names differ after deleting name particles (`van`, `van der`, `von`, `de`, `de la`, `del`, `di`, `da`, `le`, `la`, `du`) and diacritics, trying both `Last, First` and `First Last` parses of the `.bib` author. The author check is skipped when the `.bib` first author contains `group`, `consortium`, `collaboration`, `investigators`, `committee`, `network` or `study`.
   - Any rule → `METADATA_MISMATCH` (amber "Check metadata" on the reference marker; never red).
8. **Retraction Watch snapshot:** DOI lookup in the latest `rwSnapshot` (§3.6).
9. **`/refmeta` cache:** `/refmeta/{sha256hex(refId)}` stores public fields only: `doi`, `openalexId`, `title`, the first 3 authors and the author count, `year`, `venue`, `isPreprint`, `isRetracted`, `retraction`, `retractionCheckedAt`, and the server-side open-access data `oa: { pmcid, arxivId, pdfUrl, license, licenseSource }` used by `oaFetch`.
   - **No abstract** is ever stored.
   - Document TTL: **30 days** (`expireAt`).
   - **7-day retraction re-check:** a cache hit whose `retractionCheckedAt` is older than 7 days re-runs the retraction checks (OpenAlex `is_retracted`, Crossref relations, the latest snapshot) before it is returned.
   - Clients cannot read this collection (§6.1).
10. **Abstract coalescing:** a per-instance in-memory LRU (2,000 entries, 10-minute TTL) coalesces concurrent identical requests; it is never written to disk.

### 3.2 `oaFetch`, `oaFetchJudge`, `oaParse` and `oaParseJudge`

#### 3.2.1 Contract

| Item | Specification |
|---|---|
| Request | `{ refId: string }` — **nothing else is accepted**; unknown fields → `invalid-argument` |
| Response | `{ refId; source: "JATS" \| "PDF" \| "ARXIV" \| "NONE"; reason?: "NO_OA" \| "IDENTITY_MISMATCH" \| "PARSER_BUSY" \| "FETCH_FAILED" \| "LICENSE_UNKNOWN"; license: string \| null; cached: boolean; sections: Array<{ label: string; units: Array<{ chunkId: string; text: string; tier: "clean" \| "logged" \| "blocked"; reasons: string[] }> }>; fetchedAt: number }` |
| Limits | Anonymous: 30 per UID / 100 per network / **200 per day globally**; judge: 200 per judge / 2,000 per day (§4.1) |
| Timeout | **60 s** per call |
| Quota | Reserved before work; **refunded** when the call ends with `source: "NONE"` or times out |

#### 3.2.2 Server-derived locations (never from the client)

`oaFetch` reads `/refmeta/{sha256hex(refId)}`; if it is absent, it runs the `bibResolve` resolution for that `refId` internally. Candidate sources are built **only** from server-side metadata, in this order:
1. **Europe PMC JATS** when a `pmcid` is known: `GET https://www.ebi.ac.uk/europepmc/webservices/rest/{pmcid}/fullTextXML`. Licence from the JATS `<license>` element (`xlink:href` or `license-type`).
2. **OpenAlex `best_oa_location.pdf_url`**, with the licence from the same location object, confirmed by **Unpaywall** `GET https://api.unpaywall.org/v2/{encoded doi}?email={UNPAYWALL_EMAIL}` (`best_oa_location.license`). If the two disagree, the more restrictive licence is used.
3. **arXiv** `https://arxiv.org/pdf/{arxivId}`. Licence from the OAI-PMH record `GET https://oaipmh.arxiv.org/oai?verb=GetRecord&identifier=oai:arXiv.org:{arxivId}&metadataPrefix=arXivRaw` (element `<license>`, a licence URL normalized to `cc-by`, `cc-by-sa`, `cc0`, … or `null`).
   - **Serialization:** all arXiv requests from all instances are serialized through the Firestore document **`/global/arxivLock`**: a transaction reserves `nextAllowedAt = max(now, nextAllowedAt) + 3 s`, which enforces arXiv's limit of one request every **3 seconds** across the deployment. If the reservation would wait more than 20 s, the arXiv candidate is skipped for this call.
   - ⚠ VERIFY-AT-SPIKE BE-2: `arXivRaw` exposes `<license>` → fallback: arXiv full text is fetched but never cached server-side (`reason: "LICENSE_UNKNOWN"` for the cache decision only).

**Cache hit:** if `/oa/{sha256hex(refId)}/chunks.json` exists and is less than 90 days old, it is read, the **sanitizer is re-run** on every unit (stored text is untrusted), and it is returned with `cached: true`.

#### 3.2.3 SSRF protection (fetch safety)

1. **Scheme and host:** `https:` only. The host MUST NOT be `metadata.google.internal` or `metadata`, and MUST NOT end in `.internal`, `.local` or `.localhost`.
2. **DNS validation:** resolve A and AAAA records and reject the request if **any** address is in a forbidden range (RFC 6890 special-purpose registries plus the transition ranges below):
   - **IPv4:** `0.0.0.0/8`, `10.0.0.0/8`, `100.64.0.0/10`, `127.0.0.0/8`, `169.254.0.0/16`, `172.16.0.0/12`, `192.0.0.0/24`, `192.0.2.0/24`, `192.88.99.0/24`, `192.168.0.0/16`, `198.18.0.0/15`, `198.51.100.0/24`, `203.0.113.0/24`, `224.0.0.0/4` (multicast), `240.0.0.0/4`, `255.255.255.255/32`;
   - **IPv6:** `::/128`, `::1/128`, `::ffff:0:0/96` (IPv4-mapped; the embedded IPv4 is also checked), `64:ff9b::/96` and `64:ff9b:1::/48` (NAT64; the embedded IPv4 is also checked), `100::/64`, `2001::/32` (Teredo), `2001:db8::/32`, `2002::/16` (6to4; the embedded IPv4 is also checked), `fc00::/7`, `fe80::/10`, `fec0::/10`, `ff00::/8` (multicast).
3. **IP pinning:** the connection uses an `undici` `Agent` whose custom `connect.lookup` returns **only the validated address**. There is no second resolution.
4. **Redirects:** at most **3**, each re-validated and re-pinned by steps 1–3.
5. **Request headers:** only `Accept` and `User-Agent: ToulminBot (mailto:{UNPAYWALL_EMAIL})`.
6. **Type detection by magic bytes:** `Content-Type` is ignored. `%PDF-` → PDF; `<?xml` or `<article` within the first 1 KB → XML; anything else → rejected (`FETCH_FAILED`).
7. **Size and time:** the body is streamed with a byte counter and capped at **25 MB**; total fetch timeout **30 s**.

#### 3.2.4 Parsing in the private functions `oaParse` and `oaParseJudge`

`oaFetch` never parses PDF or XML itself. It sends the fetched bytes (≤ 25 MB) to the parser over HTTPS with a Google-signed ID token for the audience of the parser service.

```ts
// functions/src/oaparse/index.ts
import { onRequest } from "firebase-functions/v2/https";
const PARSER = {
  region: "us-central1",
  invoker: ["oafetch-sa@toulmin-prod.iam.gserviceaccount.com"],        // IAM only; no allUsers / allAuthenticatedUsers
  serviceAccount: "oaparse-sa@toulmin-prod.iam.gserviceaccount.com",    // zero roles, zero secrets
  memory: "2GiB", cpu: 1, concurrency: 1, timeoutSeconds: 60
} as const;
export const oaParse      = onRequest({ ...PARSER, maxInstances: 10 }, handleParse);
export const oaParseJudge = onRequest({ ...PARSER, maxInstances: 4 },  handleParse);
// Runtime option maxOldGenerationSizeMb: 1024, applied as NODE_OPTIONS=--max-old-space-size=1024 in the service
// environment, leaving at least 1 GiB of the 2 GiB for PDF buffers and native memory.
```

- **Routing:** `oaFetch` calls only `oaParse`; `oaFetchJudge` calls only `oaParseJudge`, so anonymous parsing load can never occupy the judges' parser instances.
- **Per-instance parse semaphore:** each `oaFetch` instance holds a semaphore of **3** concurrent parse calls (3 instances × 3 = 9 ≤ 10 parser instances); each `oaFetchJudge` instance holds a semaphore of **2** (2 × 2 = 4). A fetch that waits more than 20 s for a semaphore slot returns `source: "NONE"` with reason `PARSER_BUSY`, and its quota reservation is refunded. A `429` or `503` from the parser is retried once after 2 s inside the same wait budget.
- **Credentials:** `oaparse-sa` has **no IAM roles**, no secrets are mounted, and the parser performs **no outbound network requests**: its code imports no HTTP client, Secret Manager client or Firebase Admin SDK, and CI rejects such imports in `functions/src/oaparse/**` (`AGENTS.md` §7.2).
- **Work:** PDF with `pdfjs-dist` ≥ 4.2.67 (legacy build, `isEvalSupported: false`) and the PDF reconstruction of [02 › Evidence chunking]; JATS with `fast-xml-parser` ≥ 4.5.0 (`preserveOrder: true`) and the JATS rules of the same section.
- **Response:** `{ kind: "PDF" | "JATS", units: Array<{ section, text }>, identity: { doiOnPage1to2: string | null, firstPageTitle: string | null, arxivIdOnPage1: string | null, jatsDoi: string | null }, hiddenTextDropped: number }`.
- **Egress.** **No Serverless VPC Access connector is ever provisioned** (it is a billable always-on resource outside the spend caps). Backend check **BE-5** decides whether **Direct VPC Egress** can be enabled for the parser with **zero fixed cost**:
  - **BE-5 check** (in `toulmin-staging`, before `oaParse` is deployed): enable Direct VPC Egress for a Cloud Run functions service (no connector, no always-on instance, no reserved static address) with egress "all traffic" and a deny-all firewall rule; confirm from the billing SKU list and the Cloud Billing report after 24 h that the configuration produces **no fixed charge**, and that an outbound request from the parser fails while a call from `oafetch-sa` succeeds.
  - **If BE-5 passes:** the parser's egress is "all traffic through the VPC" with the deny-all egress firewall rule.
  - **Otherwise:** the parser keeps the default egress, and its isolation consists of `oaparse-sa` (zero roles, zero secrets), the absence of HTTP clients in its code, and `pdfjs-dist` ≥ 4.2.67 with `isEvalSupported: false`.
- **Wording.** This separation reduces, but does not eliminate, the impact of a parser exploit: injected code would run without credentials or secrets. The README and `SECURITY.md` describe the parser as **"separated from credentials"**, never as a sandbox, and — unless BE-5 enabled Direct VPC Egress — never as network-isolated.

#### 3.2.5 Identity check, sanitization and server persistence

1. **Page-1 DOI-in-document match (identity):**
   - JATS: `<article-id pub-id-type="doi">` must equal the reference DOI (case-insensitive).
   - PDF: the first DOI found on pages 1–2 must equal it. If no DOI is printed, the first-page title (largest-font line group) must have `titleSim ≥ 0.8` with `/refmeta.title`.
   - arXiv: the ID printed on page 1 must match.
   - Failure → `source: "NONE"` with reason `IDENTITY_MISMATCH`; nothing is cached; the quota reservation is refunded.
2. **Segmentation and sanitization** of every unit with `packages/core-l0` [02 › Rule-Based Sentence Segmentation], [02 › Untrusted Evidence Sanitizer].
3. **Server persistence only for server-verified open licences (D-11).** If the server-derived normalized licence ∈ {`cc-by`, `cc-by-sa`, `cc0`, `public-domain`, `pd`}, write `chunks.json` plus `{ license, licenseSource, sourceSha256, fetchedAt }` to **`/oa/{sha256hex(refId)}/chunks.json`** (bucket lifecycle: delete after 90 days). Otherwise return the units with `cached: false` and persist nothing. The objects are readable only through Cloud Functions (§6.2). The client stores what it receives on its own device.

### 3.3 `redeemJudgeCode`

| Item | Specification |
|---|---|
| Request | `{ code: string }` |
| Response | `{ ok: true; pool: "judge"; tierExp: number }` (`tierExp = JUDGE_TIER_EXPIRY_EPOCH`), or `HttpsError("permission-denied", "INVALID_CODE")` |
| Limits | ≤ 10 calls per UID per day; ≤ 30 per hashed network prefix per day (§4.2); `maxInstances: 3` |
| Error message | Generic; never reveals which check failed (§3.3.3) |

#### 3.3.1 Codes

- **Ten codes** of the form `TLMN-XXXX-XXXX`, where each `X` is from the **Crockford Base32** alphabet `0123456789ABCDEFGHJKMNPQRSTVWXYZ` (40 bits per code).
- Generated by `tools/issue-judge-codes.ts` with a cryptographic RNG and printed once. Only their HMAC document IDs are uploaded; codes are never committed.
- Each code is stored as `/judgeCodes/{hex(HMAC-SHA256(JUDGE_CODE_PEPPER, canonical(code)))}` = `{ uids: [], maxUids: 5, exp: JUDGE_TIER_EXPIRY_EPOCH, disabled: false }`.
- **`canonical(code)`:** uppercase; delete spaces and `-`; map `O` → `0`, and `I` and `L` → `1`; then require the form `TLMN` followed by 8 characters of the Crockford alphabet (a `U` makes the code invalid).

#### 3.3.2 Handler

```ts
// functions/src/judge/redeemJudgeCode.ts
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret, defineInt } from "firebase-functions/params";
import { getAuth } from "firebase-admin/auth";
import { CONSUMING, rejectReplay } from "../common";

const JUDGE_CODE_PEPPER = defineSecret("JUDGE_CODE_PEPPER");
const NET_HASH_PEPPER = defineSecret("NET_HASH_PEPPER");
const JUDGE_TIER_EXPIRY_EPOCH = defineInt("JUDGE_TIER_EXPIRY_EPOCH");

export const redeemJudgeCode = onCall({ ...CONSUMING, maxInstances: 3, concurrency: 10,
                                       serviceAccount: "judge-sa@toulmin-prod.iam.gserviceaccount.com",
                                       secrets: [JUDGE_CODE_PEPPER, NET_HASH_PEPPER] }, async (request) => {
  rejectReplay(request);                                                  // first statement
  if (!request.auth) throw new HttpsError("unauthenticated", "AUTH_REQUIRED");
  await enforceCallLimits(request, "redeem", { perUid: 10, perNet: 30 });
  const c = canonical(String(request.data?.code ?? ""));
  if (!c) throw new HttpsError("permission-denied", "INVALID_CODE");
  const id = hmacHex(JUDGE_CODE_PEPPER.value(), c);
  const ref = db.doc(`judgeCodes/${id}`);
  const tierExp = JUDGE_TIER_EXPIRY_EPOCH.value();
  await db.runTransaction(async tx => {
    const d = await tx.get(ref);
    const now = Math.floor(Date.now() / 1000);
    if (!d.exists || d.get("disabled") === true || now > d.get("exp")) throw new HttpsError("permission-denied", "INVALID_CODE");
    const uids: string[] = d.get("uids");
    if (!uids.includes(request.auth!.uid)) {
      if (uids.length >= d.get("maxUids")) throw new HttpsError("permission-denied", "INVALID_CODE");
      tx.update(ref, { uids: [...uids, request.auth!.uid] });
    }
  });
  await getAuth().setCustomUserClaims(request.auth.uid, { tier: "judge", codeId: id.slice(0, 32), tierExp });
  return { ok: true, pool: "judge", tierExp };
});
```

CI checks that `JUDGE_TIER_EXPIRY_EPOCH` is set in the production parameter file and is greater than the deploy time.

#### 3.3.3 Revocation, recovery and client rules

- **Revocation is effective within 60 s.** `quotaGuard`, `bibResolveJudge` and `oaFetchJudge` treat a caller as a judge only if the claim `codeId` names a `/judgeCodes` document (prefix match on the document ID, through a 60 s in-memory cache; no pepper is needed) that exists, is not `disabled`, and whose `uids` still contains the caller's UID. Disabling a code or clearing its UIDs therefore ends judge access from UIDs that already redeemed it, without waiting for token expiry.
- **Operator CLI `tools/reset-judge-code.ts`** (firebase-admin, run by an operator; never deployed): `--code <code> --clear-uids` empties `uids` (for a judge whose browsers used up the 5 slots); `--disable` sets `disabled = true`; `--enable` clears it. Every action is logged with the code's HMAC prefix only.
- **Client dialog.** "Judge access" is an item of the header's ⋯ menu; it opens a dialog with one input. On `INVALID_CODE` the dialog shows exactly: *"This code isn't valid on this browser. Check the code, or contact the Toulmin team through the Devpost judging contact for a replacement."*
- Codes are accepted **only** through that dialog: there is no `?code=` URL parameter, so a code never appears in a URL, the browser history or a referrer. The code is never written to storage, logs or analytics.
- After success, the client calls `getIdToken(true)` and turns Proof mode on. The Proof mode toggle "Preview as anonymous visitor" switches the displayed pool and policy locally; the claim stays on the account.

### 3.4 `quotaGuard`

| Item | Specification |
|---|---|
| Request | `{ claimHashes: string[] /* 1–25 sha256 hex of exact approved texts */; kind: "L2" \| "ALT" \| "SAMPLE" }`. `kind = "SAMPLE"` is valid only with the claim hashes of the built-in sample (`/apps/web/public/sample/expected.json`, compiled into the function as an allow-list) |
| Response | `{ ok: true; pool: "anon" \| "judge" \| "sample"; leaseId: string; leases: Array<{ claimHash: string; leaseId: string; exp: number }>; exp: number; remainingToday: number; resetsAt: number }` or `{ ok: false; reason: "KILL_SWITCH" \| "HARD_STOP" \| "POOL_EXHAUSTED" \| "QUOTA_EXCEEDED" \| "NET_LIMIT"; resetsAt: number }`. `leaseId` and `exp` are those of the first granted lease; `resetsAt` is the next 00:00 Asia/Jakarta (epoch ms), shown by clients in local time |
| Configuration | `{ ...CONSUMING, maxInstances: 3, concurrency: 40, serviceAccount: "quota-sa@…", secrets: [NET_HASH_PEPPER] }` |

**Algorithm:**
1. `rejectReplay(request)` (first statement); require `request.auth`.
2. **Server-side switches.** Read `/global/state` (60 s in-memory cache): `hardStop` → `HARD_STOP`; `killSwitch` → `KILL_SWITCH`. This is the **server-side enforcement of `kill_switch_cloud`**: a client that ignores Remote Config still receives no lease. The current pool sizes `/global/state.pools` (written by `budgetBreaker`, §3.5) are read in the same step and override the defaults of §4.1.
3. **Pool selection:**
   - `judge` if `request.auth.token.tier == "judge"`, `request.auth.token.tierExp > now`, and the judge code is still active for this UID (§3.3.3) — for **every** `kind`, including `SAMPLE`: a judge's sample run draws 5 leases from the **judge** pool, never from the public sample pool;
   - otherwise `sample` if `kind = "SAMPLE"`;
   - otherwise `anon`.
4. **Reserve** `n = claimHashes.length` leases in one transaction (§4.2) against the per-UID counter, the per-network counter (anonymous and sample pools only) and the pool's 10-shard global counter.
   - **Atomic sample run:** for `kind = "SAMPLE"` from the sample pool, one **run** (all 5 one-click claims) is reserved as a unit: either the whole run is granted or none of it.
   - If only `m < n` remain (L2 and ALT), grant `m` leases for the first `m` claims and report `remainingToday = 0`.
   - If `m = 0`, return `POOL_EXHAUSTED`, `QUOTA_EXCEEDED` or `NET_LIMIT`.
5. **Write leases:** `/users/{uid}/leases/{leaseId} = { claimHash, pool, kind, createdAt, exp: now + 300 s, expireAt: now + 24 h }` for each granted lease. A Firestore TTL policy on `expireAt` deletes the lease, including its `claimHash`, after 24 hours (§6.3).
6. Return `{ ok: true, pool, leaseId, leases, exp, remainingToday, resetsAt }`.

**Network key.** "Per network" = the client IP's IPv4 /24 or IPv6 /48 prefix. The client IP is the **entry appended by Google's front end** to the `X-Forwarded-For` header (the right-most entry that Google's load balancer adds), **never the left-most entry**, which the client controls. The exact entry index is determined by backend check BE-1, tested with forged `X-Forwarded-For` headers; `request.rawRequest.ip` is used only if BE-1 shows it equals that entry. The prefix is stored only as `netHash = sha256hex(day + "|" + prefix + "|" + NET_HASH_PEPPER)` in the **4 shard documents** `/netCounters/{netHash}_{day}_{s}` (`s = 0..3`), so a busy network (a university NAT) cannot exceed Firestore's per-document write rate.

**Honest enforcement boundary (auditors MUST note this).**
- The Firebase AI Logic gateway does **not** verify leases. A modified client can call Firebase AI Logic without a lease.
- Leases and pools are **accounting and user-experience controls** that protect judges from anonymous exhaustion of shared counters; they bind honest clients only.
- The controls that do **not** depend on client honesty are:
  1. the service-level spend caps (Firebase AI Logic US$60/month; Cloud Functions US$40/month), enforced by Cloud Billing;
  2. Firebase AI Logic replay protection with limited-use App Check tokens (each request needs a fresh attestation from a genuine app instance);
  3. **App Check enforcement for Firebase Authentication** (Preview), so that new anonymous UIDs cannot be minted by a script without a fresh reCAPTCHA Enterprise or App Attest attestation;
  4. the Firebase AI Logic per-user limit of **30 requests per minute**;
  5. the project-level Gemini API quota of **60 requests per minute**;
  6. the server-side `kill_switch_cloud` and `hardStop` checks of step 2, which bind every client that needs a lease, and the pool sizes in `/global/state.pools`.
- **Authenticated-users mode** of Firebase AI Logic is enabled, but it **accepts anonymous-auth UIDs**: it rejects requests without any Firebase Auth credential and does not by itself stop automated anonymous sign-up. That protection comes from control 3 (verified in spike `S-RP`).
- Server prompt templates with **template-only mode are not used**: template-only mode is project-wide and would block the `PREFER_ON_DEVICE` and `PREFER_IN_CLOUD` hybrid requests (D-19) `[F]`.

### 3.5 `budgetBreaker` and `recaptchaBreaker`

**Budgets.** Four Cloud Billing budgets, all on **gross cost** (every credit option unchecked, so credits and promotions do not reduce the measured cost; service-level spend caps are computed on gross cost as well `[F]`):

| Budget (`budgetDisplayName`) | Scope | Amount per month | Thresholds | Topic |
|---|---|---|---|---|
| `gross` | whole project | **US$110** | 50 %, 80 %, 100 % actual; 100 % forecast | `billing-alerts` |
| `ai-logic` | services billed for Firebase AI Logic requests (Gemini Developer API and grounding SKUs) | **US$60** | 25 %, 50 %, 75 %, 90 %, 100 % | `billing-alerts` |
| `uncapped` | Cloud Firestore, Cloud Storage, reCAPTCHA Enterprise | **US$20** | 50 %, 80 %, 100 % | `billing-alerts` |
| `recaptcha` | reCAPTCHA Enterprise SKUs only | **US$10** | 100 % | `recaptcha-alerts` |

**Message.** JSON with `budgetDisplayName`, `costAmount`, `budgetAmount`, `alertThresholdExceeded` `[F2]`. ⚠ VERIFY-AT-SPIKE S-SC: the field names, and that a budget can be filtered to the AI Logic, Firestore, Storage and reCAPTCHA SKUs → fallback: compute `ratio = costAmount / budgetAmount`; if a service filter is unavailable, apply the `ai-logic` thresholds to the `gross` budget at the same absolute amounts (US$15, US$30, US$45, US$54).

**`budgetBreaker`** (`onMessagePublished("billing-alerts")`; idempotent; `ratio = costAmount / budgetAmount`, keyed by `budgetDisplayName`):

| Budget | Ratio | Action |
|---|---|---|
| `gross` | ≥ 0.50 | Alert: page the on-call operator |
| `gross` | ≥ 0.80 | Set Remote Config `kill_switch_cloud = "true"` (template ETag, retry ×3 on conflict) and `/global/state.killSwitch = true`, `killSwitchAt = now`; `quotaGuard` refuses every lease |
| `gross` | ≥ 1.00 | Additionally `/global/state.hardStop = true`; every callable refuses before doing work |
| `ai-logic` | ≥ 0.25 | **Public pools halved:** anonymous L2 global 40 → 20; anonymous *Find alternative sources* global 20 → 10; sample pool stays at 20 runs. Page the on-call operator |
| `ai-logic` | ≥ 0.50 | **Public pools zeroed:** anonymous L2 → 0, anonymous *Find alternative sources* → 0; **sample pool halved** 20 → 10 runs |
| `ai-logic` | ≥ 0.75 | **Sample pool zeroed** (the one-click button then shows its "used up" tooltip [04 › One-click sample check (D-26)]); **judge pool preserved** (600); page both operators |
| `ai-logic` | ≥ 0.90 | **Judge pool halved** (600 → 300) **and** `kill_switch_cloud = true` (Remote Config and `/global/state.killSwitch`). Cloud checks pause for everyone until an operator clears the kill switch (lever L-2/L-4 of §4.4); the halved judge pool applies after that |
| `uncapped` | ≥ 0.50, ≥ 0.80 | Alert: page the on-call operator |
| `uncapped` | ≥ 1.00 | `/global/state.hardStop = true` |

Pool changes are written to `/global/state.pools` (read by `quotaGuard`, `bibResolve` and `oaFetch` within 60 s) and mirrored to Remote Config `sample_pool_global` for the user interface. Each action is logged with the budget name and the ratio rounded to two decimals. The order of the actions protects judges: public pools are reduced first, the sample pool (the base-URL path for a judge without a code) next, and the judge pool last. **Reset is manual:** an operator restores the pool sizes, clears the flags and republishes Remote Config.

**`recaptchaBreaker`** (`onMessagePublished("recaptcha-alerts")`): at ratio ≥ 1.0 it **disables the Web reCAPTCHA Enterprise key** through the reCAPTCHA Enterprise API (`ops-sa`, reCAPTCHA Enterprise Admin).
- App Check on the Web can then no longer obtain tokens, so every Web cloud feature stops. The Web **degrades gracefully**: L0, Confidential mode and `ONLY_ON_DEVICE` L1 keep working, and the header shows the degraded chip *"Cloud features aren't available in this browser"* [04 › Initialization (`src/firebase.ts`)].
- This bounds the cost of an attestation-farming attack, which would otherwise reach ≈ US$764–864 per day in assessments `[I]`.
- **Residual billing lag:** assessments made between the threshold crossing and the key disable are still billed (§4.4, billing lag).
- **Operator key recovery:** re-enabling the key is a manual operator decision (lever L-6, both operators), recorded in the release log, after the abuse source has been blocked.

The spend caps (D-12) are the primary cost control; these breakers are secondary controls that also cover services without a spend cap (Firestore, Storage, reCAPTCHA Enterprise).

### 3.6 `rwSnapshot`

- **Schedule:** `onSchedule({ schedule: "every day 03:00", timeZone: "Etc/UTC" })`, `ops-sa`.
- **Source:** the Retraction Watch dataset distributed openly through Crossref. ⚠ VERIFY-AT-SPIKE BE-2: dataset URL and format → fallback: OpenAlex `is_retracted` and Crossref relations only.
- **Build:** a map `{ "<doi lowercase>": { "nature": string, "date": "YYYY-MM-DD", "noticeDoi"?: string } }`, gzipped to **`/rw/snapshot-{yyyymmdd}.json.gz`** (`{yyyymmdd}` = the UTC run day); then update `/global/state.rwLatest`.
- **Clients** download the latest snapshot when online (Web: IndexedDB). It is a whole public dataset, so reading it reveals nothing about any user. The Android `bundledSample` build carries the snapshot used for the sample and shows its date in the readiness meter.

---

## 4. Quota Pools, Cost Sizing, App Check & Firebase Console Configuration

### 4.1 Quota pool table and daily cost envelope

**Public cloud quota is a cost-bounded daily preview.** The anonymous and sample pools are sized against the **US$60/month Firebase AI Logic spend cap** (CG-1), so that the base URL works for every visitor while total spend stays bounded. The UI presents them transparently as a shared daily preview (*"Cloud checks left today: {remaining} (shared preview)"*).

| Resource | Anonymous pool: per UID / per network / global per day | Judge pool: per judge UID / global per day |
|---|---|---|
| `bibResolve` items | 300 / 1,000 / 20,000 | 2,000 / 30,000 |
| `oaFetch` calls | 30 / 100 / **200** | 200 / 2,000 |
| L2 leases (`kind = "L2"`) | 10 / 20 / **40** | 200 / **600** (judge sample runs included) |
| *Find alternative sources* leases (`kind = "ALT"`) | 3 / 6 / **20** | 20 / **100** |
| `redeemJudgeCode` calls | 10 / 30 / — | — |

**Sample pool** (one-click sample check, D-26; `quotaGuard` with `kind = "SAMPLE"`): **1 run per UID per day**, **2 runs per network per day**, **20 runs per day globally** (`sample_pool_global`). A run is the five one-click claims of the compiled allow-list: the **2 grounded contradiction claims** (`l2Adjudicate`) and the **3 provided-evidence clean claims** (`l2AdjudicateProvided`). The sample pool is separate from the anonymous pool; exhausting either never affects the other. A caller with a valid judge claim never draws on the sample pool: a judge's sample run draws 5 leases from the judge L2 pool, so judges keep the one-click check after the public sample pool is used up.

Day boundaries use the **Asia/Jakarta calendar day**.

**Per-call cost assumptions `[I]`** (verified and set at spikes `S-L2` and `S-SC`; `tools/cost-model.ts` holds the current values):

| Call | Cost per call |
|---|---|
| Grounded L2 (`l2Adjudicate`): tokens ≈ US$0.005–0.011 plus up to 3 grounding queries | **≈ US$0.019–0.053** |
| Provided-evidence L2 (`l2AdjudicateProvided`) | **≈ US$0.005–0.011** |
| Grounding queries when no free allowance applies | US$14 per 1,000 queries (upper-bound assumption) |

**Daily cost envelope at 100 % saturation of every pool every day:**

| Pool | Max per day | Cost per day |
|---|---|---|
| Anonymous L2 (40 grounded) | 40 calls | US$0.76–2.12 |
| Sample (20 runs × (2 grounded + 3 provided)) | 100 calls | **US$1.06–2.78** |
| Anonymous *Find alternative sources* (20 grounded) | 20 calls | US$0.38–1.06 |
| **Public total** | 160 calls | **US$2.20–5.96** |
| Judge L2 (600 grounded) | 600 calls | US$11.40–31.80 |

**Planning window.** US$60 spread over a 17-day public-access window (public launch to `JUDGE_TIER_EXPIRY_EPOCH`) is **US$3.53 per day**. The public maximum can exceed that at the upper price, so the `ai-logic` budget actions of §3.5 are **required**, not optional: they reduce the public pools first and the judge pool last. Realistic judge use (10 judges × 50 checks ≈ 500 grounded calls, plus at most 10 judge sample runs) costs ≈ **US$10–27** for the whole judging period.

**`oaFetch` bound.** The anonymous `oaFetch` global cap is 200 calls per day and the function timeout is 60 s, so the maximum anonymous `oaFetch` compute per day is bounded (200 × 60 s of `oaFetch` plus at most 200 `oaParse` invocations of ≤ 60 s each). The judge lane has its own cap, instances and parser.

### 4.2 Reserve-then-reconcile counters (all metered callables)

```ts
// functions/src/quota/reserve.ts
async function reserve(uid: string, pool: "anon" | "judge" | "sample", field: string, n: number,
                       netHash: string | null): Promise<number> {
  const day = yyyymmdd(Date.now(), "Asia/Jakarta");
  const shards = Array.from({ length: 10 }, (_, s) => db.doc(`global/counters/shards/${pool}_${day}_${s}`));
  const uRef = db.doc(`users/${uid}/quota/${day}`);
  const nRefs = netHash ? Array.from({ length: 4 }, (_, s) => db.doc(`netCounters/${netHash}_${day}_${s}`)) : [];
  return db.runTransaction(async tx => {
    const reads = await Promise.all([tx.get(uRef), ...nRefs.map(r => tx.get(r)), ...shards.map(r => tx.get(r))]);
    const u = reads[0], nDocs = reads.slice(1, 1 + nRefs.length), sh = reads.slice(1 + nRefs.length);
    const sum = (ds: typeof reads) => ds.reduce((a, d) => a + (d.get(field) ?? 0), 0);
    const used = { u: u.get(field) ?? 0, n: sum(nDocs), g: sum(sh) };
    const lim = await currentLimits(pool, field);            // /global/state.pools overrides the §4.1 defaults, 60 s cache
    const m = Math.max(0, Math.min(n, lim.perUid - used.u, nRefs.length ? lim.perNet - used.n : n, lim.global - used.g));
    if (m === 0) return 0;
    const g = shards[Math.floor(Math.random() * 10)];
    tx.set(uRef, { [field]: used.u + m, expireAt: addDays(day, 3) }, { merge: true });
    if (nRefs.length) tx.set(nRefs[Math.floor(Math.random() * 4)], { [field]: FieldValue.increment(m), expireAt: addDays(day, 3) },
                             { merge: true });
    tx.set(g, { [field]: FieldValue.increment(m), expireAt: addDays(day, 30) }, { merge: true });
    return m;
  });
}
// After the work: refund(uid, pool, field, reserved − actuallyUsed, netHash) applies negative increments the same way.
```

- `yyyymmdd(t, "Asia/Jakarta")` formats the Asia/Jakarta calendar day of `t`; `addDays(day, k)` returns the epoch timestamp `k` days after that day's start.
- For an atomic sample run, `reserve` is called with `n = 1` on field `sampleRuns` and `n = 5` is granted only if it returns 1.
- **Load test** (Phase 3 gate before judge access opens): 500 requests from 50 anonymous UIDs (from 3 network prefixes) plus 5 judge UIDs. Expected:
  - the anonymous pool stops at its per-UID, per-network and global limits;
  - judge leases are still granted after the anonymous pool is exhausted;
  - requests without App Check are rejected;
  - a replayed limited-use token is rejected by `quotaGuard` and by Firebase AI Logic;
  - 20 sample runs exhaust the public sample pool, and a judge's sample run still succeeds from the judge pool;
  - writing reduced pools to `/global/state.pools` takes effect in `quotaGuard` within 60 s.

### 4.3 App Check scoping and Firebase console configuration

#### 4.3.1 App Check scoping (D-18)

| Surface | Provider | Token type | Replay protection |
|---|---|---|---|
| Firebase AI Logic (Web, iOS) | Web: reCAPTCHA Enterprise; iOS: App Attest (DeviceCheck fallback) | **Limited-use** (`useLimitedUseAppCheckTokens: true`; minimum SDKs Web `firebase` 12.14.0, Apple 12.2.0) | **Enforced** (console) |
| Firebase Authentication (anonymous sign-up and token refresh) | same | session tokens | App Check for Firebase Authentication **enforced** (Preview). ⚠ VERIFY-AT-SPIKE S-RP: enforcement works with reCAPTCHA Enterprise on the Web and blocks anonymous sign-up without a valid attestation → fallback: keep the Authentication sign-up rate limit at its lowest setting and lower the anonymous L2 pool to 5 per UID, 10 per network and 20 global per day |
| Firestore (client reads of own quota and leases), Cloud Storage (`/rw` reads) | same | session tokens | n/a |
| `bibResolve`, `bibResolveJudge`, `oaFetch`, `oaFetchJudge` | same | session tokens | not consumed (standard App Check) |
| `quotaGuard`, `redeemJudgeCode` | same | **Limited-use** (`limitedUseAppCheckTokens: true`) | **Consumed** (`consumeAppCheckToken: true`) **+ explicit `alreadyConsumed` rejection** |
| `oaParse`, `oaParseJudge` | none | IAM identity token of `oafetch-sa` | not reachable by clients (IAM only) |
| Android Pocket Ledger (`bundledSample`) | Play Integrity registered for the project; never invoked | none | The build makes no network call |

**Zero debug tokens.** Debug providers are used only in local development and in CI emulators. **No debug token exists in any distributed build — Web, Android or iOS — with no exception.** `tools/scan-artifacts.ts` fails the release if a build output contains the string `debugToken`, the debug provider class names (`DebugAppCheckProviderFactory`, `FIREBASE_APPCHECK_DEBUG_TOKEN`, a `ReCaptchaEnterpriseProvider` configured in debug mode) or any registered debug-token value. **The Android judge APK is always the offline `bundledSample` flavor** [04 › `bundledSample` flavor contract (D-18)]: it needs no attestation, so sideloading cannot break it, and no debug token exists in it.

#### 4.3.2 Console configuration checklist (MUST be applied to `toulmin-prod`; re-checked in Phase 3)

| Setting | Value |
|---|---|
| Plan | **Blaze**, Cloud Billing active; Gemini Developer API used as **Paid Services** (D-12) |
| App Check enforcement for Firebase AI Logic | **Enforced** `[F]` |
| Replay protection for Firebase AI Logic | **Enforced**; every client sets `useLimitedUseAppCheckTokens: true`. ⚠ VERIFY-AT-SPIKE S-RP: success rate, added latency and reCAPTCHA Enterprise assessment volume → fallback: keep it enforced and lower the anonymous pools |
| App Check enforcement for **Firebase Authentication** | **Enforced** (Preview) |
| Firebase AI Logic **Authenticated users** mode | **Enabled**. It accepts anonymous-auth UIDs and rejects only requests without a Firebase Auth credential; scripted anonymous sign-up is stopped by App Check for Authentication, not by this mode |
| Firebase AI Logic per-user rate limit | **30 requests per minute** (kept within 20–30; never lower, because lower values cause `429` errors during consented fallback and sample bursts) |
| Gemini API project quota | **60 requests per minute** (Google Cloud console quotas) |
| Template-only mode | **Disabled** (project-wide; it would block hybrid `PREFER_*` requests `[F]`) |
| Service-level spend caps | Firebase AI Logic **US$60/month**; Cloud Functions **US$40/month** (`S-SC`) |
| Cloud Billing budgets | `gross` US$110, `ai-logic` US$60, `uncapped` US$20, `recaptcha` US$10 per month; gross cost; Pub/Sub notifications (§3.5) |
| AI monitoring | Enabled in the Firebase console, with no prompt or response logging beyond the console's defaults |
| Firebase API key restrictions | Web key: HTTP referrer `https://toulmin.web.app/*`; Android key: package name `app.toulmin` + SHA-256 signing certificate; iOS key: bundle ID. API restrictions: only the APIs used |
| Anonymous authentication | Enabled; automatic clean-up of anonymous accounts disabled until after `JUDGE_TIER_EXPIRY_EPOCH` |
| Debug tokens | None registered for the production apps |
| reCAPTCHA Enterprise usage | Monitored against the free tier of **10,000 assessments per month**; the `recaptcha` budget bounds the excess |
| Play Integrity usage | Monitored against the standard limit of **10,000 requests per day** (the `bundledSample` APK makes none) |

### 4.4 Defence-in-depth cost guardrails and operational monitoring runbook

#### 4.4.1 Cost guardrails `CG-1` – `CG-13` (strongest first)

| # | Guardrail | Enforced by | Limit | Effect |
|---|---|---|---|---|
| CG-1 | Service-level spend cap, Firebase AI Logic | Cloud Billing | **US$60 per month** | Firebase AI Logic requests pause until the cap is lifted or the month ends |
| CG-2 | Service-level spend cap, Cloud Functions | Cloud Billing | **US$40 per month** | Functions pause (all callables, both lanes) |
| CG-3 | Replay protection (AI Logic and consuming callables) | Firebase AI Logic gateway; `rejectReplay` | one request per limited-use token | Harvested tokens cannot be replayed |
| CG-4 | App Check for Firebase Authentication + **Authenticated users** mode | Firebase Authentication; Firebase AI Logic | §4.3.2 | Scripted anonymous sign-up without a valid attestation is rejected; AI Logic rejects unauthenticated calls. Anonymous UIDs remain valid credentials, so CG-4 depends on App Check for Authentication |
| CG-5 | Per-user rate limit | Firebase AI Logic | 30 requests per minute per user | Burst limit |
| CG-6 | Project Gemini API quota | Google Cloud quotas | 60 requests per minute | Project-wide burst limit |
| CG-7 | Quota pools (anonymous, sample, judge) | Cloud Functions + Firestore | §4.1 | Honest clients stop; judges protected from anonymous exhaustion |
| CG-8 | Judge lanes | Separate functions and instances (§3.0) | `maxInstances` per lane; upstream rate budgets split | Anonymous load cannot occupy judge instances or the judges' upstream share |
| CG-9 | Gross budget + `budgetBreaker` | Pub/Sub → Function | **US$110 per month** (alerts 50 % / 80 % / 100 %) | 80 %: `kill_switch_cloud`, enforced by `quotaGuard` (no leases; L0 and on-device L1 continue); 100 %: hard stop of all metered callables |
| CG-10 | AI Logic budget + `budgetBreaker` | Pub/Sub → Function → `/global/state.pools` | **US$60 per month**, actions at **25 % / 50 % / 75 % / 90 %** | Public pools halved, then zeroed and the sample pool halved; then the sample pool zeroed with the judge pool preserved; at 90 % the judge pool halved and the kill switch set (§3.5) |
| CG-11 | Uncapped-services budget | Pub/Sub → Function | **US$20 per month** (Firestore, Storage, reCAPTCHA Enterprise) | Alerts at 50 % and 80 %; hard stop at 100 % |
| CG-12 | reCAPTCHA SKU budget + `recaptchaBreaker` | Pub/Sub → Function → reCAPTCHA Enterprise API | **US$10 per month** | The Web reCAPTCHA Enterprise key is disabled; Web cloud features stop until an operator re-enables it |
| CG-13 | Bounded compute and client cadence | Functions configuration; client | `maxInstances` and timeouts of §3.0; paragraph cadence and explicit cloud audit on no-model devices [04 › Choice of `LocalInference`] | Bounds concurrency, per-call compute and consent-A volume |

**Billing lag.** Billing data can lag behind usage, so charges can exceed a cap or a budget threshold before it is acted on `[F2]`. The accepted maximum exposure is US$60 + US$40 + US$20 + US$10 plus the lag overage measured in spike `S-SC`. The per-request exposure of a modified client that sends very large requests is bounded by the gateway's maximum request size measured in the `S-RP` large-request test.

**Residual risk (accepted and documented in the README threat model).** An attacker operating genuine browsers with valid attestations can still consume the Firebase AI Logic or Cloud Functions spend cap. When a cap is reached, that service pauses for **every** user, judges included, until an operator lifts the cap; L0 and on-device L1 keep working, and the Android `bundledSample` build is unaffected. One cap applies per service per project, so judges cannot be isolated by caps; they are isolated by pools and lanes up to the cap.

#### 4.4.2 Monitoring modes

The runbook is kept in `/docs/operator-runbook.md` with the same content as this section. `MONITORING_MODE` selects the alert routing.

| Mode | When | Cadence | Who |
|---|---|---|---|
| **Standard Monitoring Mode** | From public launch until the official judging period starts | **One check per day**: budget review and smoke test | One operator |
| **Active Judging Monitoring Mode** | From the start of the official judging period until `JUDGE_TIER_EXPIRY_EPOCH` | **A check at least every 2 hours** while on call, with a smoke test each time | **Two named operators per day** (primary and backup) with Owner or Billing Account Administrator rights, listed in the internal release log (never in a public document) |
| Both modes | Always | Phone alerts from every budget notification, from `budgetBreaker` and `recaptchaBreaker` executions, and from the Functions error-rate alert | The operator on call |

**Each check** (logged in `/docs/ops/costlog.md`, and in Active Judging Monitoring Mode also in `/docs/ops/oncall.md`):
1. spend per budget (`gross`, `ai-logic`, `uncapped`, `recaptcha`) from the Cloud Billing report, compared with the projection of `tools/cost-model.ts`;
2. the per-pool counters in `/global/counters/shards`;
3. `/global/state` (`killSwitch`, `hardStop`, `pools`);
4. the Functions error rates;
5. the reCAPTCHA Enterprise assessment count;
6. **smoke test** from a clean Chrome profile: the base URL loads, the sample opens, one `bibResolve` call succeeds, and — in Active Judging Monitoring Mode — one judge-code sample run succeeds from the judge pool.

#### 4.4.3 Cost scenarios (`tools/cost-model.ts`, prices `[I]` until `S-L2`)

Simulated with the automated actions of §3.5, counted in days from public launch over the 17-day planning window:

| Scenario | 25 % reached | 50 % reached | 75 % reached | Cap reached |
|---|---|---|---|---|
| Upper prices, public pools saturated every day, no judge use | day 3 | day 6 | day 17 | not reached (US$45 at day 17) |
| Upper prices, saturated public pools, judges spend US$10 during judging | day 3 | day 6 | day 13 | not reached (≈ US$50) |
| Upper prices, saturated public pools, judges spend US$27 (upper bound of 500 grounded calls) | day 3 | day 6 | day 12 | **≈ day 15** |
| Lower prices, saturated public pools, judges spend US$10 | day 7 | day 13 | not reached | not reached (≈ US$37) |

The third row is the only scenario in which the AI Logic cap could pause cloud checks during judging. It requires every public pool to be exhausted every day **and** the upper price **and** heavy judge use. Lever L-4 handles it.

#### 4.4.4 Server-side levers (strongest effect first)

Every lever is enforced on the server, so it does not depend on clients fetching Remote Config (whose fetch interval is 1 hour).

| # | Lever | How | Authority |
|---|---|---|---|
| L-1 | Reduce or zero any pool | Write `/global/state.pools` (read by `quotaGuard`, `bibResolve` and `oaFetch` within 60 s); mirror `sample_pool_global` to Remote Config for the UI | Primary operator |
| L-2 | Kill switch on or off | `/global/state.killSwitch` (+ Remote Config `kill_switch_cloud`); while on, `quotaGuard` grants no lease | Primary operator |
| L-3 | **Lift a paused cap** | Firebase console, when gross spend for the month is ≤ US$110 and the traffic is judge-pool or sample-pool traffic. If the pause was caused by anonymous abuse, first apply L-1 to the anonymous pools, then lift | Primary operator (**cap-lift authority**) |
| L-4 | Raise a cap | Firebase AI Logic above US$60 or Cloud Functions above US$40, for example when the third scenario of §4.4.3 is projected during judging | **Both operators**, recorded in the release log |
| L-5 | Restore reduced pools | When the remaining AI Logic budget covers the remaining days at the observed rate | Primary operator |
| L-6 | Disable or re-enable the reCAPTCHA key (**reCAPTCHA recovery**) | reCAPTCHA Enterprise console; `recaptchaBreaker` disables automatically at US$10 | Both operators to re-enable |
| L-7 | **Judge-code reset** | `tools/reset-judge-code.ts --disable` (effective within 60 s) for a leaked code, then send a replacement through the organizer's private channel; `--clear-uids` for a judge whose browsers used up the 5 slots | Primary operator |
| L-8 | Firebase AI Logic per-user limit | Kept between **20 and 30** requests per minute (configured: 30). It is not a cost lever: lowering it causes `429` errors in consented fallback and sample bursts in front of judges | Not changed |

**Functions-cap procedure.** When the Cloud Functions cap pauses Functions:
1. post the banner *"Cloud features are paused for a short time. On-device checks still work."* through Remote Config (Remote Config is not part of the Functions service);
2. identify the source from the per-pool counters;
3. lower the anonymous limits (L-1) or zero the anonymous lane;
4. lift the cap (L-3);
5. confirm with a judge-lane smoke test (one `bibResolveJudge` call and one judge-code sample run) that service resumed; resuming can take up to one hour.

---

## 5. Exact Privacy, Consent & Disclosure Copy

All strings below MUST appear exactly as written. They are stored once in `packages/copy/en.json` and checked by `copy.test.ts`.

### 5.1 Standard mode banner

Shown **in full once at mode selection**. Before the first cloud action of each later session, a **one-line reminder** is shown instead: *"Cloud checks send the exact claims you approve to Google Gemini with Google Search. Details"* (the link opens the full banner).

> **Standard mode.** Toulmin checks claims on this device when it can. You choose which claims to send to Google Gemini in the cloud (a paid service, through Firebase); you see the exact text first. Each claim is sent with the evidence Toulmin found for it: abstracts, openly licensed full text, and — only if you allow it — text from PDFs you added. Cloud checks use Google Search: Google keeps those prompts and search results for 30 days to provide grounded answers, and does not use them to train its models. Reference titles and DOIs are sent to Toulmin's servers and to OpenAlex, Semantic Scholar and Crossref to look up your references. The built-in sample manuscript can be checked in the cloud with one click, because it contains no text of yours.
> To protect the service from abuse, Toulmin uses Google reCAPTCHA Enterprise, which sends signals about your browser and device to Google.
> Buttons: **Use Standard mode** / **Stay in Confidential mode**

### 5.2 Confidential mode notice

> **Confidential mode.** Confidential keeps your manuscript text on this device: claim checking runs only here. Reference titles and DOIs are still looked up — they are sent to Toulmin's servers and to OpenAlex, Semantic Scholar and Crossref — unless you turn on **DOI-only lookup** (references without a DOI then can't be checked). To protect the service from abuse, Toulmin uses Google reCAPTCHA Enterprise, which sends signals about your browser and device to Google.

### 5.3 Consent class A card (devices without a usable model)

> **This device can't run the on-device model.** {environment checker reason}
> **Confidential** — reference checks only; your manuscript text stays on this device.
> **Standard with cloud fallback** — each passage you check is sent to Gemini in the cloud through Firebase, with the evidence from its cited sources. Google keeps the requests for a limited time for abuse detection and does not use them to train its models.
> Buttons: **Use Confidential** / **Use cloud fallback for this document**

`{environment checker reason}` is one message of [04 › Environment checker and readiness (`src/l1/readiness.ts`, D-26)]. The iOS Thin Client shows the same card with the reason *"This iPhone can't run Apple's on-device model."*

### 5.4 Batch consent sheet (consent class B)

> **Send {k} claims to cloud check?**
> Each selected claim is sent to Gemini in the cloud with Google Search, together with its cited reference and the evidence Toulmin found for it (abstracts and openly licensed full text). Google keeps prompts and search results for 30 days to provide grounded answers. The rest of your manuscript is not sent.
> ☐ **Include text from my PDFs** (default off; shown only when at least one selected claim has evidence from a PDF you added)
> {rows: checkbox · editable exact claim text · reference · evidence kinds ("abstract", "open-access full text", "your PDF") · label "Source contains instruction-like text." where it applies}
> Cloud checks left today: {remaining} ({pool})
> Buttons: **Send {k} claims** / **Cancel**

The row behaviour (ordering, selection, editing) is specified in [04 › Escalation and the batch consent sheet (consent class B)].

### 5.5 Local storage and backup notice

> Your ledger is stored only on this device. It is excluded from phone and computer backups and is never synced to other devices or to Toulmin's servers. **Delete local data** (in the ⋯ menu, on the web and on Android) deletes every document, ledger and cached source from this device.

On the Web, the notice adds: *"Your browser may clear stored data when the computer is low on storage. For documents you edit here, use 'Download source' regularly."* It is shown when `navigator.storage.persist()` returned `false` [03 › Document kinds and editability (D-26)].

### 5.6 Positioning line (footer, README, onboarding)

> Toulmin is for checking **your own** manuscripts. Do not use it to process confidential manuscripts you are reviewing for others.

---

## 6. Firestore & Cloud Storage Security Rules + TTL Policies

### 6.1 `firestore.rules` (complete)

```
rules_version = '2';
service cloud.firestore {
  match /databases/{db}/documents {

    function signedIn() { return request.auth != null; }
    function isOwner(uid) { return signedIn() && request.auth.uid == uid; }

    match /users/{uid} {
      allow read, write: if false;
      match /quota/{day}      { allow read: if isOwner(uid); allow write: if false; }   // written by Cloud Functions only
      match /leases/{leaseId} { allow read: if isOwner(uid); allow write: if false; }   // written by Cloud Functions only
    }

    match /refmeta/{h}      { allow read, write: if false; }   // Cloud Functions only: no enumeration, no membership oracle
    match /judgeCodes/{h}   { allow read, write: if false; }   // Cloud Functions only
    match /netCounters/{k}  { allow read, write: if false; }   // Cloud Functions only
    match /global/{doc=**}  { allow read, write: if false; }   // state, counters, arxivLock: Cloud Functions only

    match /{document=**}    { allow read, write: if false; }   // default deny
  }
}
```

- **Clients never write to Firestore.** There is no client-writable collection, so unbounded writes and counter manipulation are impossible by construction. The only client reads are a user's own `/users/{uid}/quota/{day}` and `/users/{uid}/leases/{leaseId}`.
- **Function-only documents under `/global`** (covered by the `/global/{doc=**}` deny rule):
  - `/global/state` — `killSwitch`, `killSwitchAt`, `hardStop`, `rwLatest` and the current pool sizes `pools`;
  - `/global/counters/shards/{pool}_{day}_{shard}` — the 10-shard pool counters (§4.2);
  - `/global/arxivLock` — the 3-second spacing lock for arXiv requests (§3.2.2).
- Network counters are the four shards `/netCounters/{netHash}_{day}_{s}` per network and day.
- Rules are tested on the emulator in `ci-rules.yml` (`firestore.rules.test.ts`): every path is denied to clients except the two owner reads, and an owner cannot read another UID's documents.

### 6.2 `storage.rules` (complete)

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /rw/{file}       { allow read: if request.auth != null; allow write: if false; }   // retraction snapshot; any signed-in (including anonymous) user may read
    match /{allPaths=**}   { allow read, write: if false; }   // /oa/** is read and written by oaFetch (oafetch-sa) only
  }
}
```

- `/oa/**` is function-only: Cloud Functions access it with their service-account credentials, which bypass these rules; clients can neither read nor write it.
- `/rw/**` is readable by any signed-in user and never writable by clients; `rwSnapshot` writes it as `ops-sa`.
- **Bucket lifecycle:** objects under `/oa/` are deleted 90 days after creation; objects under `/rw/` older than 30 days are deleted (the latest snapshot is always newer).
- **Storage growth alarm:** a Cloud Monitoring alert fires when the bucket exceeds 5 GB; the `uncapped` and `gross` budgets include Cloud Storage.
- **Per-device copyright rule (D-11).** Abstracts and full-text units without a verified open licence exist **only** in each device's local store (IndexedDB, Room). No rule or function writes them anywhere server-side.

### 6.3 Firestore TTL policies (MUST be configured; deletion typically happens within 24 hours after expiry)

| Collection group | TTL field | Value written | Effective retention |
|---|---|---|---|
| `leases` (`/users/{uid}/leases`) | `expireAt` | lease creation + 24 h | **24 hours** (the lease, including its `claimHash`, is deleted) |
| `quota` (`/users/{uid}/quota`) | `expireAt` | day + 3 days | **3 days** |
| `netCounters` | `expireAt` | day + 3 days | **3 days** |
| `refmeta` | `expireAt` | write time + 30 days | **30 days** (retraction fields re-checked after 7 days) |
| `shards` (`/global/counters/shards`) | `expireAt` | day + 30 days | **30 days** |
| `nonces` (`/global/nonces`; only while the `BE-3` nonce fallback is active) | `expireAt` | write time + 10 minutes | **10 minutes** |

`/judgeCodes` documents carry no TTL; they stop granting access at `exp = JUDGE_TIER_EXPIRY_EPOCH` and are deleted by an operator after that time.
