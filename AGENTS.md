# AGENTS.md — Toulmin Root Router & Guardrails

This file is the lean root entry point auto-loaded by Antigravity. The complete master contract (Product Identity, Glossary, Locked Decisions `D-01`–`D-30`, Hardware Targets, SDK Minimums, and CI Guardrails) lives in **`docs/spec/00_MASTER_CONTRACT.md`**.

**MANDATORY RULE:** Before planning or writing any code, read `docs/spec/00_MASTER_CONTRACT.md` (the relevant sections) and the owning specification file(s) below using `view_file`. Never guess from memory or from existing code. When code and specification disagree, **the specification wins**.

## Specification Routing Table

| File | Owns |
|---|---|
| `docs/spec/00_MASTER_CONTRACT.md` | Identity, Glossary, Locked Decisions `D-01`–`D-30`, Hardware, SDK Minimums, Guardrails |
| `docs/spec/01_DATA_REDUCER_AND_METER.md` | Canonical TS/Kotlin/Swift types, identity hashing, pure commutative reducer (`E1`–`E16`), 8-bucket Coverage Meter (7-count header) |
| `docs/spec/02_L0_TIER_A_PRE_DECODE.md` | Frozen Tier A pre-decode L0 (`norm`, Unicode 15.1, masking, LaTeX, segmenter, citation scanner, clause partitioner, value/units, BM25 `cov`, chunking, sanitizer) |
| `docs/spec/03_L0_TIER_B_VALIDATOR_B5_INGEST.md` | Tier B post-decode L0 (anchor validator, triage baseline, B5 incremental pairing & baseline, multi-format ingestion, audit queue, exports) |
| `docs/spec/04_AI_RUNTIME_PROMPTS_AND_L3.md` | Queue, L1 deadline/settle ceiling, JSON/`@Generable` schemas, `p2.1` prompts, L2 adjudicators, Web/Android/iOS Firebase AI Logic runtimes, L3 policy, Probe, `gate.ts` |
| `docs/spec/05_BACKEND_SECURITY_AND_FINOPS.md` | Cloud Functions 2nd gen, per-class service accounts, `oaParse`/`oaParseJudge`, CSP/Trusted Types, quota pools, App Check replay protection, budgets/breakers, rules & TTL |
| `docs/spec/06_CLIENTS_UI_AND_MONOREPO.md` | Web Workbench UI, Android `bundledSample` Pocket Ledger & O2 Select-row OCR, iOS Thin Client, monorepo layout & CI boundaries |
| `docs/spec/07_EVAL_SPIKES_AND_ACCEPTANCE.md` | Spikes (`S-W1..10`, `S-L2`, `S-RP`, `S-SC`, `S-N4`, `S-A1..5`, `S-P2..4`, `BE-1..5`), `R1-E`, `R1-E-L2`, `CF-1`, `O2`, Tier B replay, Phases 0–3, 154 Acceptance Rows |
| `docs/spec/08_CONTEST_README_AND_VIDEO.md` | #BuildHybridAI compliance, verified metrics, competitor table, Testing Instructions, README blueprint, 2:45 Video Storyboard |

## Non-Negotiable Invariants
1. **Pure `packages/core-l0`:** Zero Firebase, DOM, network, Node I/O, or unseeded randomness. Byte-identical TS/Kotlin parity on `conformance/l0/*.json`.
2. **Single Firebase AI Logic Boundary:** Only `packages/firebase-client`, `apps/android/l1`, and `apps/ios/ToulminL1` may import Firebase AI Logic.
3. **Zero Nested Unbounded Regex Quantifiers & 250 ms L0 Watchdog:** All L0 patterns must pass ReDoS fuzz (`≤ 5 ms / 10 KB`).
4. **Zero Hardcoded Calendar Dates, Debug Tokens, or Secrets:** Use `JUDGE_TIER_EXPIRY_EPOCH` and `MONITORING_MODE`. Zero App Check debug providers in release artifacts.
5. **No Cross-Device Sync / No Production `cspReport`:** Local-only persistence per device (`bundledSample` Android APK makes zero Firebase network calls).
6. **Freeze Discipline:** Never edit `/freeze/tier_a.txt` files after `l0-freeze-a` or `/freeze/cf1_baselines.txt` after the first CF-1 run. Tier B edits require deterministic replay (`tools/replay.ts`).
7. **Spec Immutability:** Agents MUST NEVER edit `AGENTS.md` or `docs/spec/*` without explicit Author approval via the Spec Defect RFC protocol in `.agents/rules/toulmin-governance.md`.