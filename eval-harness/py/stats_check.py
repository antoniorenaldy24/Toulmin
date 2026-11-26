#!/usr/bin/env python3
"""
Independent Python stdlib statistical cross-check for Toulmin Phase 0 / AC-EVAL-03
(`docs/spec/07_EVAL_SPIKES_AND_ACCEPTANCE.md` §3.7, §3.8, §4.2, `AC-EVAL-03`).

Verifies `eval-harness/fixtures/stats_fixture.json`,
`eval-harness/fixtures/holm_fixture.json`, and `conformance/l0/{gate,support_gate,holm}.json`
as well as exact one-sided McNemar test values using Python standard library only.
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

Z_95 = 1.959964
TASK_ORDER: Tuple[str, ...] = ("B1", "B2", "B3", "B5", "O2")
TASK_RANK: Dict[str, int] = {task: idx for idx, task in enumerate(TASK_ORDER)}

# Path A thresholds (`04` §6.2, `07` §3.7)
PATH_A_P_HAT_MIN = 0.70
PATH_A_WILSON_LB_MIN = 0.50
PATH_A_STABILITY_MIN = 0.60
PATH_A_PP_PAIRS_MIN = 15

# Support-verdict gate thresholds (`04` §6.2, `07` §3.7)
SUPPORT_WILSON_LB_MIN = 0.80
SUPPORT_PS_PAIRS_MIN = 16

# CF-1 authority thresholds (`04` §6.2, `07` §4.2)
CF1_DELTA_MIN = 0.10
CF1_ALPHA = 0.10


def grid_key(value: float) -> int:
    """Integer comparison key `floor(x * 1e9 + 0.5)` matching `packages/core-l0/src/gate.ts`."""
    if not math.isfinite(value) or value < 0.0:
        return -1
    return math.floor(value * 1_000_000_000.0 + 0.5)


def wilson_95(k: int, n: int, z: float = Z_95) -> Optional[Tuple[float, float]]:
    """Computes the 95% Wilson score interval `(lb, ub)` or `None` when `n == 0`."""
    if n <= 0:
        return None
    if k < 0 or k > n:
        raise ValueError(f"Invalid counts k={k}, n={n}")
    p_hat = k / n
    z2 = z * z
    denom = 1.0 + z2 / n
    center = (p_hat + z2 / (2.0 * n)) / denom
    half = (z * math.sqrt((p_hat * (1.0 - p_hat)) / n + z2 / (4.0 * n * n))) / denom
    lb = max(0.0, center - half)
    ub = min(1.0, center + half)
    return (lb, ub)


def round_half_away_or_standard(val: float, decimals: int) -> float:
    """Standard decimal rounding matching finite fixture comparisons."""
    return round(val + 1e-12, decimals) if val >= 0 else round(val - 1e-12, decimals)


def prevalence_from_lr(lr_plus: float, pi: float) -> float:
    """Computes prevalence-adjusted precision `TPR*pi / (TPR*pi + FPR*(1 - pi))` via `LR+`."""
    return (lr_plus * pi) / (lr_plus * pi + (1.0 - pi))


def prevalence_lb(tp_pairs: int, fp_total: int, pi: float) -> float:
    """Computes conservative prevalence-adjusted lower bound `P_LB(pi)` (`07` §3.6)."""
    tpr_ci = wilson_95(tp_pairs, 50)
    fpr_ci = wilson_95(fp_total, 100)
    assert tpr_ci is not None and fpr_ci is not None
    tpr_lb = tpr_ci[0]
    fpr_ub = fpr_ci[1]
    denom = tpr_lb * pi + fpr_ub * (1.0 - pi)
    return (tpr_lb * pi) / denom if denom > 0.0 else 0.0


def evaluate_path_a_gate(
    p_hat: float,
    wilson_lb: Optional[float],
    stability: float,
    pp_pairs: int,
    kappa_ok: bool = True,
) -> Tuple[bool, List[str]]:
    """Reproduces `evaluateGate` (`07` §3.7)."""
    failed: List[str] = []
    if grid_key(p_hat) < grid_key(PATH_A_P_HAT_MIN):
        failed.append("P_HAT")
    if wilson_lb is None or grid_key(wilson_lb) < grid_key(PATH_A_WILSON_LB_MIN):
        failed.append("WILSON_LB")
    if grid_key(stability) < grid_key(PATH_A_STABILITY_MIN):
        failed.append("STABILITY")
    if pp_pairs < PATH_A_PP_PAIRS_MIN:
        failed.append("PP_PAIRS")
    if not kappa_ok:
        failed.append("KAPPA_OK")
    return (len(failed) == 0, failed)


def evaluate_support_gate(
    ps_pairs: int,
    wilson_lb_s: Optional[float],
    kappa_ok: bool = True,
) -> Tuple[bool, List[str]]:
    """Reproduces `evaluateSupportGate` (`07` §3.7)."""
    failed: List[str] = []
    if wilson_lb_s is None or grid_key(wilson_lb_s) < grid_key(SUPPORT_WILSON_LB_MIN):
        failed.append("WILSON_LB_S")
    if ps_pairs < SUPPORT_PS_PAIRS_MIN:
        failed.append("PS_PAIRS")
    if not kappa_ok:
        failed.append("KAPPA_OK")
    return (len(failed) == 0, failed)


def binomial_tail(n: int, min_k: int, p: float) -> float:
    """Exact binomial probability `P(X >= min_k)` for `X ~ Binomial(n, p)`."""
    total = 0.0
    for k in range(min_k, n + 1):
        total += math.comb(n, k) * (p ** k) * ((1.0 - p) ** (n - k))
    return total


def support_gate_oc_row(n: int) -> Tuple[int, float, float, float, float]:
    """Computes `(min_ts, wilson_lb, p85, p90, p95)` for a support-gate sample size `n`."""
    threshold = grid_key(SUPPORT_WILSON_LB_MIN)
    min_k: Optional[int] = None
    min_lb = 0.0
    for k in range(0, n + 1):
        ci = wilson_95(k, n)
        assert ci is not None
        if n >= SUPPORT_PS_PAIRS_MIN and grid_key(ci[0]) >= threshold:
            min_k = k
            min_lb = ci[0]
            break
    if min_k is None:
        raise ValueError(f"No passing k found for n={n}")
    return (
        min_k,
        min_lb,
        binomial_tail(n, min_k, 0.85),
        binomial_tail(n, min_k, 0.90),
        binomial_tail(n, min_k, 0.95),
    )


def holm_bonferroni(entries: Sequence[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Applies Holm-Bonferroni step-down correction with canonical tie-break order (`07` §4.2)."""
    m = len(entries)
    sorted_entries = sorted(
        entries,
        key=lambda e: (float(e["p"]), TASK_RANK[str(e["task"])]),
    )
    out: List[Dict[str, Any]] = []
    running_max = 0.0
    for idx, item in enumerate(sorted_entries):
        rank = idx + 1
        multiplier = m - idx
        raw_adj = min(1.0, float(item["p"]) * multiplier)
        running_max = max(running_max, raw_adj)
        out.append(
            {
                "task": str(item["task"]),
                "p": float(item["p"]),
                "p_holm": running_max,
                "rank": rank,
            }
        )
    return out


def check_authority(cf1_map: Dict[str, Dict[str, Any]], task: str) -> str:
    """Reproduces `checkAuthority` (`07` §4.2, `04` §6.2)."""
    entry = cf1_map.get(task)
    if entry is None:
        return "advisory"
    delta_ok = grid_key(float(entry["delta"])) >= grid_key(CF1_DELTA_MIN)
    p_holm_val = float(entry["p_holm"])
    holm_ok = p_holm_val >= 0.0 and grid_key(p_holm_val) <= grid_key(CF1_ALPHA)
    if not (delta_ok and holm_ok):
        return "advisory"
    if task == "B5":
        l1_prec = entry.get("inconsistent_precision_l1")
        base_prec = entry.get("inconsistent_precision_baseline")
        if l1_prec is None or base_prec is None:
            return "advisory"
        if float(l1_prec) <= 0.0 or grid_key(float(l1_prec)) < grid_key(float(base_prec)):
            return "advisory"
    return "authoritative"


def mcnemar_exact_one_sided(b: int, c: int) -> float:
    """Exact one-sided McNemar test (`07` §4.2): `sum_{k=b}^{b+c} C(N,k) * 0.5^N`."""
    n = b + c
    if n == 0:
        return 1.0
    return sum(math.comb(n, k) for k in range(b, n + 1)) * (0.5 ** n)


def main() -> int:
    repo_root = Path(__file__).resolve().parents[2]
    failures: List[str] = []

    def check(cond: bool, msg: str) -> None:
        if not cond:
            failures.append(msg)

    stats_fixture = json.loads((repo_root / "eval-harness/fixtures/stats_fixture.json").read_text(encoding="utf-8"))
    holm_fixture = json.loads((repo_root / "eval-harness/fixtures/holm_fixture.json").read_text(encoding="utf-8"))
    gate_conf = json.loads((repo_root / "conformance/l0/gate.json").read_text(encoding="utf-8"))
    support_conf = json.loads((repo_root / "conformance/l0/support_gate.json").read_text(encoding="utf-8"))
    holm_conf = json.loads((repo_root / "conformance/l0/holm.json").read_text(encoding="utf-8"))

    # 1. stats_fixture.json — Wilson fixtures (4 dp)
    wilson_rows = stats_fixture["wilsonFixtures"]
    for row in wilson_rows:
        k, n = int(row["k"]), int(row["n"])
        ci = wilson_95(k, n)
        assert ci is not None
        lb4 = round_half_away_or_standard(ci[0], 4)
        ub4 = round_half_away_or_standard(ci[1], 4)
        check(abs(lb4 - float(row["lb4"])) < 1e-9, f"wilsonFixtures({k},{n}) lb4 got {lb4}, expected {row['lb4']}")
        check(abs(ub4 - float(row["ub4"])) < 1e-9, f"wilsonFixtures({k},{n}) ub4 got {ub4}, expected {row['ub4']}")

    # 2. Prevalence point estimates & conservative LB (3 dp)
    lr_plus = float(stats_fixture["prevalencePointFromLr"]["lrPlus"])
    for pi_str, expected3 in stats_fixture["prevalencePointFromLr"]["expected3"].items():
        pi = float(pi_str)
        got3 = round_half_away_or_standard(prevalence_from_lr(lr_plus, pi), 3)
        check(abs(got3 - float(expected3)) < 1e-9, f"P({pi}) got {got3}, expected {expected3}")

    lb_ex = stats_fixture["prevalenceLbExample"]
    got_lb = prevalence_lb(int(lb_ex["tpPairs"]), int(lb_ex["fpTotal"]), float(lb_ex["pi"]))
    got_lb3 = round_half_away_or_standard(got_lb, 3)
    check(abs(got_lb3 - float(lb_ex["expectedLb3"])) < 1e-9, f"P_LB(0.12) got {got_lb3}, expected {lb_ex['expectedLb3']}")
    check(got_lb < 1.0, f"P_LB(0.12) must be < 1.0, got {got_lb}")

    # 3. 8-row Support-gate OC table (`07` §3.7, 4 dp LB and 3 dp binomial probabilities)
    oc_rows = stats_fixture["supportGateOperatingCharacteristic"]
    for row in oc_rows:
        ps = int(row["psPairs"])
        min_ts, lb, p85, p90, p95 = support_gate_oc_row(ps)
        check(min_ts == int(row["minTsPairs"]), f"OC(n={ps}) minTs got {min_ts}, expected {row['minTsPairs']}")
        check(abs(round(lb, 4) - float(row["wilsonLb4"])) < 1e-9, f"OC(n={ps}) lb got {round(lb, 4)}, expected {row['wilsonLb4']}")
        check(abs(round(p85, 3) - float(row["p85"])) < 1e-9, f"OC(n={ps}) p85 got {round(p85, 3)}, expected {row['p85']}")
        check(abs(round(p90, 3) - float(row["p90"])) < 1e-9, f"OC(n={ps}) p90 got {round(p90, 3)}, expected {row['p90']}")
        check(abs(round(p95, 3) - float(row["p95"])) < 1e-9, f"OC(n={ps}) p95 got {round(p95, 3)}, expected {row['p95']}")

    # 4. conformance/l0/gate.json (Wilson + Path A cases)
    for case in gate_conf["wilsonCases"]:
        k, n = int(case["k"]), int(case["n"])
        ci = wilson_95(k, n)
        if case.get("expectedNull"):
            check(ci is None, f"gate.json {case['id']} expected None, got {ci}")
        else:
            assert ci is not None
            check(abs(round(ci[0], 4) - float(case["expectedLb4"])) < 1e-9, f"gate.json {case['id']} lb4 mismatch")
            check(abs(round(ci[1], 4) - float(case["expectedUb4"])) < 1e-9, f"gate.json {case['id']} ub4 mismatch")

    for case in gate_conf["pathAGateCases"]:
        inp = case["input"]
        wilson_lb = float(inp["wilson_lb"])
        if "tp_pairs" in inp and "pp_pairs" in inp:
            ci = wilson_95(int(inp["tp_pairs"]), int(inp["pp_pairs"]))
            assert ci is not None
            check(abs(round(ci[0], 4) - wilson_lb) < 1e-9, f"gate.json {case['id']} derived wilson_lb mismatch")
        passed, failed = evaluate_path_a_gate(
            float(inp["p_hat"]),
            wilson_lb,
            float(inp["stability"]),
            int(inp["pp_pairs"]),
            bool(inp.get("kappa_ok", True)),
        )
        exp = case["expected"]
        check(passed == bool(exp["pathA"]), f"gate.json {case['id']} pathA got {passed}, expected {exp['pathA']}")
        check(failed == list(exp["failed"]), f"gate.json {case['id']} failed got {failed}, expected {exp['failed']}")

    # 5. conformance/l0/support_gate.json
    for case in support_conf["supportGateCases"]:
        inp = case["input"]
        ps = int(inp["ps_pairs"])
        if "ts_pairs" in inp:
            ci = wilson_95(int(inp["ts_pairs"]), ps)
            lb = ci[0] if ci is not None else None
        else:
            lb = float(inp["wilson_lb_s"])
        auth, failed = evaluate_support_gate(ps, lb, bool(inp.get("kappa_ok", True)))
        exp = case["expected"]
        check(auth == bool(exp["authoritative"]), f"support_gate.json {case['id']} got {auth}, expected {exp['authoritative']}")
        check(failed == list(exp["failed"]), f"support_gate.json {case['id']} failed got {failed}, expected {exp['failed']}")

    # 6. eval-harness/fixtures/holm_fixture.json & conformance/l0/holm.json
    holm_res = holm_bonferroni(holm_fixture["inputs"])
    check([x["task"] for x in holm_res] == list(holm_fixture["expectedSortedOrder"]), "holm_fixture sorted order mismatch")
    for idx, exp_p in enumerate(holm_fixture["expectedAdjustedP"]):
        check(abs(round(holm_res[idx]["p_holm"], 4) - float(exp_p)) < 1e-9, f"holm_fixture idx {idx} adjusted p mismatch")

    p_holm_by_task = {x["task"]: x["p_holm"] for x in holm_res}
    cf1_web: Dict[str, Dict[str, Any]] = {}
    for item in holm_fixture["inputs"]:
        t = str(item["task"])
        cf1_web[t] = {**item, "p_holm": p_holm_by_task[t]}
    for t in TASK_ORDER:
        exp_auth = str(holm_fixture["expectedAuthority"][t])
        got_auth = check_authority(cf1_web, t)
        check(got_auth == exp_auth, f"holm_fixture authority[{t}] got {got_auth}, expected {exp_auth}")

    for case in holm_conf["holmCases"]:
        got = holm_bonferroni(case["entries"])
        exp_list = case["expected"]
        check(len(got) == len(exp_list), f"holm.json {case['id']} length mismatch")
        for g_row, e_row in zip(got, exp_list):
            check(g_row["task"] == e_row["task"] and g_row["rank"] == e_row["rank"], f"holm.json {case['id']} task/rank mismatch")
            check(abs(round(g_row["p_holm"], 4) - float(e_row["p_holm"])) < 1e-9, f"holm.json {case['id']} p_holm mismatch")

    for case in holm_conf["authorityCases"]:
        got_auth = check_authority(case["cf1"], str(case["task"]))
        check(got_auth == str(case["expected"]), f"holm.json {case['id']} got {got_auth}, expected {case['expected']}")

    # 7. Exact one-sided McNemar spot checks (`07` §4.2)
    mcnemar_cases = [
        (0, 0, 1.0),
        (5, 0, 0.03125),
        (10, 2, 79 / 4096),
        (3, 3, 0.65625),
        (0, 5, 1.0),
    ]
    for b, c, expected in mcnemar_cases:
        got = mcnemar_exact_one_sided(b, c)
        check(abs(got - expected) < 1e-12, f"mcnemar({b},{c}) got {got}, expected {expected}")

    if failures:
        for msg in failures:
            print(f"FAIL: {msg}", file=sys.stderr)
        return 1

    print(
        f"AC-EVAL-03 Python cross-check PASS: "
        f"{len(wilson_rows)} wilsonFixtures, 3 prevalence points + P_LB(0.12)=0.575, "
        f"{len(oc_rows)} support-gate OC rows, {len(gate_conf['wilsonCases']) + len(gate_conf['pathAGateCases'])} gate.json cases, "
        f"{len(support_conf['supportGateCases'])} support_gate.json cases, "
        f"{len(holm_conf['holmCases']) + len(holm_conf['authorityCases']) + 1} holm/authority fixtures, "
        f"and {len(mcnemar_cases)} exact McNemar cases."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
