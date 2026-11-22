---
name: build-and-verify
description: Runs the strict Toulmin build-then-independent-validation loop using the Main Orchestrator (Implementer) and the independent spec-validator subagent, with bounded Spec Defect RFC escalation to the Author.
---

# Build and Independent Verification Loop

Execute the user's requested implementation task strictly in this order:

1. **Load Owning Specifications:** Read `docs/spec/00_MASTER_CONTRACT.md` (relevant locked decisions & guardrails) and the exact owning `docs/spec/0n_*.md` files for the target module. State the exact spec sections and `AC-*` rows in scope before editing any file.
2. **Implement & Self-Test:** Implement the code and spec-derived tests (never generate golden outputs from implementation runs). Run typecheck, lint, and unit/conformance tests locally.
3. **Invoke Independent Validator (`spec-validator`):** Call `invoke_subagent` targeting `spec-validator` with:
   - Modified/created file paths;
   - Target `docs/spec/0n_*.md` sections and `AC-*` rows;
   - Test commands to re-verify independently.
4. **Handle Validator Verdict:**
   - **`PASS`:** Report completion to the Author, attaching `spec-validator`'s raw command evidence and workspace cleanliness confirmation.
   - **`FAIL`:** Fix every blocking finding reported by `spec-validator`, re-run tests, and re-invoke `spec-validator` until `PASS`.
   - **Suspected Architectural Spec Defect:** Follow the **Spec Defect RFC Protocol** in `.agents/rules/toulmin-governance.md` (max 2 debate rounds with `spec-validator`). If validated or deadlocked, STOP and escalate the structured Author Brief to the user — never edit `docs/spec/*` without Author sign-off.