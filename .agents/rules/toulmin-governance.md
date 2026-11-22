---
trigger: always_on
---

# Toulmin Engineering Governance & Builder–Validator Protocol

## 1. Specification Supremacy & Read-Only Spec Boundary
- `docs/spec/00_MASTER_CONTRACT.md` and `docs/spec/01`–`08` are the single source of truth.
- You are strictly **FORBIDDEN** from modifying `AGENTS.md` or any file in `docs/spec/` on your own initiative.
- Golden files in `conformance/l0/*.json` MUST be authored strictly from the specification's rules and normative examples — NEVER generated from the output of your own implementation.

## 2. Mandatory Independent Verification Gate
- You MUST NOT report any task, milestone, or fix as complete until you have invoked the independent **`spec-validator`** subagent via `invoke_subagent` with:
  1. The task scope and exact list of modified/created files;
  2. The owning `docs/spec/*.md` sections implemented;
  3. The acceptance rows (`AC-*`) and test commands expected to pass.
- If `spec-validator` returns **`FAIL`**, you MUST fix every reported defect in the code/tests and re-invoke `spec-validator` until it returns **`PASS`**.

## 3. Spec Defect RFC Protocol (If and Only If an Architectural Defect Exists)
- **Default Assumption:** Whenever a test fails, an edge case breaks, or an SDK call errors, assume your **implementation** is wrong first.
- You MAY propose a specification change **IF AND ONLY IF** you prove at least one of these objective conditions with exact file and section quotes:
  1. **Internal Contradiction:** Two passages in `docs/spec/*.md` directly contradict each other.
  2. **Empirical Platform Impossibility:** A real runtime/SDK/API spike (`VERIFY-AT-SPIKE`) proves a specified behavior is impossible or unavailable on the target hardware/SDK.
  3. **Mathematical/Algorithmic Unsatisfiability:** A normative example or acceptance criterion cannot be derived from its own specified algorithm.
- **Debate Procedure (Maximum 2 Rounds):**
  1. Write a structured **Spec Defect RFC** (Claimed Defect, Exact Spec Quotes, Reproduction Command & Raw Output, Proposed Minimal Change, Freeze-Tier Impact on `tier_a`/`tier_b`/`cf1_baselines`).
  2. Send the RFC to `spec-validator` via `invoke_subagent`. `spec-validator` will attempt to refute it and check whether an existing owning rule or spike fallback already covers the case.
  3. If `spec-validator` refutes the RFC with spec citations, accept the ruling and fix the code. You may submit at most **1 rebuttal (Round 2)** with new empirical/logical evidence.
  4. If `spec-validator` validates the defect — OR if both agents remain deadlocked after Round 2 — **STOP modifying the affected code** and present the concise **Author Escalation Brief** (both positions + exact spec quotes + freeze-tier impact) to the **Author (user)** for the final decision.

## 4. Communication Language Policy
- **Chat Responses:** Always write all conversational explanations, plans, progress updates, RFC discussions, and Author Escalation Briefs in **Bahasa Indonesia** (technical identifiers, file paths, symbol names, and exact spec quotes remain in English).
- **Repository Artifacts (Strictly English):** All code, code comments, commit messages, tests, golden files, `packages/copy/en.json`, `packages/prompts/p2.1/*`, `README.md`, and `/docs/{spikes,acceptance}/*.md` MUST remain strictly in **English** per the specification.

## 5. Windows PowerShell CLI Hygiene (Anti-Hang)
- NEVER invoke `npx tsx -e`, `pnpm exec tsx -e`, or multi-line `-e` arguments in Windows PowerShell (Windows `.cmd` wrappers truncate `\n` and hang `tsx` on open stdin).
- For any ad-hoc TypeScript verification script via `run_command`, always pipe a single-quoted PowerShell here-string (`@' ... '@`) in plain ESM JS syntax directly into `.\node_modules\.bin\tsx.CMD -`, or run a real Vitest test command (`pnpm test` / `pnpm exec vitest run <file>`).