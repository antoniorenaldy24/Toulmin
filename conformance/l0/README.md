# Cross-Platform L0 Conformance Corpus (`conformance/l0/`)

Shared golden test vectors for TypeScript (`packages/core-l0`), Kotlin (`apps/android/core-l0`), and the Swift subset (`apps/ios/ToulminCore`), per `docs/spec/06_CLIENTS_UI_AND_MONOREPO.md` §5.2–§5.3 and `docs/spec/07_EVAL_SPIKES_AND_ACCEPTANCE.md` §6.9 Procedure 4.

Every golden file is hand-authored directly from the specification rules and normative examples — never generated from an implementation's output.

Format:
```json
[
  {
    "id": "...",
    "op": "...",
    "input": "...",
    "expected": "..."
  }
]
```
