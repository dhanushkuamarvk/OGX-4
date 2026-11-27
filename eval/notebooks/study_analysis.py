"""Statistical evaluation pipeline for Co-Plan vs. Baseline (Resurrect 2026, Problem 3).

Supports both real study JSONL/survey/rating logs AND a clearly labelled
`SYNTHETIC - pipeline test only` mode to verify the statistical pipeline prior
to human data collection.

HARD SAFETY GATE:
    `load_study_logs(..., fail_on_mock=True)` raises `MockLLMDataError` immediately
    if ANY telemetry row has `llm_provider == "mock"`.
"""

from __future__ import annotations

import json
import math
import random
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from statistics import mean, stdev
from typing import Any

try:
    from scipy import stats as scipy_stats  # type: ignore[import-not-found]
except ImportError:
    scipy_stats = None


class MockLLMDataError(RuntimeError):
    """Raised loudly when mock-LLM sessions are found in study analysis logs."""


def _parse_ts(ts: str) -> datetime:
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


# ---------------------------------------------------------------------------
# 1. Log Loading with Strict Mock-LLM Guard
# ---------------------------------------------------------------------------


def load_study_logs(
    raw_logs_dir: Path | str,
    *,
    fail_on_mock: bool = True,
) -> list[dict[str, Any]]:
    """Load per-run JSONL telemetry logs and fail loudly on mock-LLM sessions."""
    raw_dir = Path(raw_logs_dir)
    files = sorted(
        p
        for p in raw_dir.glob("*.jsonl")
        if p.name not in {"telemetry_all.jsonl", "telemetry_export.jsonl"}
    )
    if not files and (raw_dir / "telemetry_all.jsonl").exists():
        files = [raw_dir / "telemetry_all.jsonl"]

    rows: list[dict[str, Any]] = []
    mock_sessions: set[str] = set()

    for path in files:
        for line in path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            row = json.loads(line)
            payload = json.loads(row.get("payload_json") or "{}")
            provider = str(payload.get("llm_provider", "")).lower()
            model = str(payload.get("llm_model", "")).lower()
            if provider == "mock" or model.startswith("mock"):
                mock_sessions.add(str(row.get("session_id", path.name)))
            rows.append(row)

    if fail_on_mock and mock_sessions:
        raise MockLLMDataError(
            f"ABORTED: Found {len(mock_sessions)} mock-LLM session(s) in {raw_dir}: "
            f"{sorted(mock_sessions)[:5]}. Mock sessions MUST NOT be analyzed as study data."
        )
    return rows


def extract_behavioral_metrics(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Compute per-(participant, condition) behavioral metrics from raw JSONL logs alone."""
    by_session: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in events:
        by_session[str(row["session_id"])].append(row)

    results: list[dict[str, Any]] = []
    for session_id, s_rows in by_session.items():
        s_rows.sort(key=lambda r: _parse_ts(str(r["ts"])))
        t0 = _parse_ts(str(s_rows[0]["ts"]))
        t1 = _parse_ts(str(s_rows[-1]["ts"]))
        completion_time_s = round((t1 - t0).total_seconds(), 3)

        condition = str(s_rows[0]["condition"])
        participant_id = str(s_rows[0]["participant_id"])
        task_id = str(s_rows[0]["task_id"])

        counts: dict[str, int] = defaultdict(int)
        invalidated_total = 0
        for r in s_rows:
            et = str(r["event_type"])
            counts[et] += 1
            payload = json.loads(r.get("payload_json") or "{}")
            if isinstance(payload.get("invalidated_step_ids"), list):
                invalidated_total += len(payload["invalidated_step_ids"])

        # Time to recover after mid-task requirement change
        sent_row = next((r for r in s_rows if r["event_type"] == "requirement_change_sent"), None)
        resp_row = next((r for r in s_rows if r["event_type"] == "first_useful_response"), None)
        ttr_ms: float | None = None
        if sent_row is not None and resp_row is not None:
            ttr_ms = round(
                (_parse_ts(str(resp_row["ts"])) - _parse_ts(str(sent_row["ts"]))).total_seconds()
                * 1000.0,
                2,
            )

        overrides = (
            counts["step_edited"]
            + counts["artifact_edited"]
            + counts["rollback"]
            + counts["interrupt"]
        )
        if condition == "coplan":
            turns_actions = (
                counts["interrupt"]
                + counts["resume"]
                + counts["step_lock"]
                + counts["step_unlock"]
                + counts["step_edited"]
                + counts["step_expand"]
                + counts["artifact_edited"]
                + counts["rollback"]
                + counts["requirement_change_sent"]
            )
            denom = max(1, counts["step_completed"] + overrides)
            override_rate = round(overrides / denom, 4)
            rework_count = counts["rollback"] + invalidated_total
            error_rate = round(counts["step_failed"] / max(1, counts["step_started"]), 4)
        else:
            turns_actions = counts["baseline_user_message"]
            override_rate = 0.0
            rework_count = max(0, counts["baseline_user_message"] - 1)
            error_rate = 0.0

        results.append(
            {
                "session_id": session_id,
                "participant_id": participant_id,
                "condition": condition,
                "task_id": task_id,
                "completion_time_s": completion_time_s,
                "turns_actions": turns_actions,
                "time_to_recover_ms": ttr_ms,
                "override_rate": override_rate,
                "rework_count": rework_count,
                "error_rate": error_rate,
                "tokens_in": sum(int(float(r.get("tokens_in") or 0)) for r in s_rows),
                "tokens_out": sum(int(float(r.get("tokens_out") or 0)) for r in s_rows),
            }
        )
    return results


# ---------------------------------------------------------------------------
# 2. Statistical Helpers (SciPy when available, pure-Python verified fallback)
# ---------------------------------------------------------------------------


def _normal_cdf(x: float) -> float:
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def _student_t_two_sided_p(t_stat: float, df: int) -> float:
    """Numerical two-sided p-value for Student's t using Simpson integration on t-PDF."""
    if scipy_stats is not None:
        return float(2.0 * scipy_stats.t.sf(abs(t_stat), df))
    if df <= 0:
        return 1.0
    t_abs = abs(t_stat)
    if t_abs == 0.0:
        return 1.0
    # Integrate t-PDF from 0 to t_abs using fine Simpson's rule
    c = math.gamma((df + 1) / 2) / (math.sqrt(df * math.pi) * math.gamma(df / 2))

    def pdf(u: float) -> float:
        return c * ((1.0 + (u * u) / df) ** (-(df + 1) / 2))

    n_steps = 400
    h = t_abs / n_steps
    total = pdf(0.0) + pdf(t_abs)
    for i in range(1, n_steps):
        total += (4.0 if i % 2 == 1 else 2.0) * pdf(i * h)
    area = total * h / 3.0
    return max(0.0, min(1.0, 1.0 - 2.0 * area))


def shapiro_normality_check(diffs: list[float]) -> tuple[float, float, str]:
    """Return (statistic, p_value, method_name) checking normality of paired diffs."""
    if len(diffs) < 3:
        return 1.0, 1.0, "insufficient_n"
    if scipy_stats is not None:
        stat, p = scipy_stats.shapiro(diffs)
        return round(float(stat), 4), round(float(p), 5), "shapiro_wilk"

    # Pure-Python fallback: Jarque-Bera normality approximation
    n = len(diffs)
    mu = mean(diffs)
    sd = stdev(diffs)
    if sd == 0:
        return 1.0, 1.0, "jarque_bera_fallback"
    skew = sum(((x - mu) / sd) ** 3 for x in diffs) / n
    kurt = sum(((x - mu) / sd) ** 4 for x in diffs) / n - 3.0
    jb = (n / 6.0) * (skew**2 + 0.25 * kurt**2)
    p = math.exp(-0.5 * jb)  # chi-squared(df=2) survival function
    return round(jb, 4), round(p, 5), "jarque_bera_fallback"


def bootstrap_ci(
    diffs: list[float],
    *,
    n_boot: int = 5000,
    alpha: float = 0.05,
    seed: int = 2026,
) -> tuple[float, float]:
    """Percentile 95% bootstrap confidence interval for the mean paired difference."""
    rng = random.Random(seed)
    n = len(diffs)
    if n == 0:
        return 0.0, 0.0
    means = sorted(
        mean(diffs[rng.randrange(n)] for _ in range(n))
        for _ in range(n_boot)
    )
    lo_idx = int((alpha / 2.0) * n_boot)
    hi_idx = min(n_boot - 1, int((1.0 - alpha / 2.0) * n_boot))
    return round(means[lo_idx], 4), round(means[hi_idx], 4)


def wilcoxon_paired_test(diffs: list[float]) -> tuple[float, float, float]:
    """Wilcoxon signed-rank test returning (W_stat, two_sided_p, rank_biserial_r)."""
    nonzero = [d for d in diffs if d != 0.0]
    n = len(nonzero)
    if n == 0:
        return 0.0, 1.0, 0.0

    # Assign average ranks to absolute values
    indexed = sorted(enumerate(nonzero), key=lambda kv: abs(kv[1]))
    ranks = [0.0] * n
    i = 0
    while i < n:
        j = i
        while j + 1 < n and abs(indexed[j + 1][1]) == abs(indexed[i][1]):
            j += 1
        avg_rank = (i + j + 2) / 2.0
        for k in range(i, j + 1):
            ranks[indexed[k][0]] = avg_rank
        i = j + 1

    w_plus = sum(r for r, d in zip(ranks, nonzero) if d > 0)
    w_minus = sum(r for r, d in zip(ranks, nonzero) if d < 0)
    w_stat = min(w_plus, w_minus)
    total_r = w_plus + w_minus
    rank_biserial = round((w_plus - w_minus) / total_r, 4) if total_r > 0 else 0.0

    if scipy_stats is not None:
        res = scipy_stats.wilcoxon(nonzero)
        return round(float(res.statistic), 4), round(float(res.pvalue), 6), rank_biserial

    # Exact two-sided p-value for n <= 16; normal approximation for larger n
    if n <= 16:
        extreme = 0
        total_masks = 1 << n
        for mask in range(total_masks):
            s_pos = sum(ranks[bit] for bit in range(n) if (mask >> bit) & 1)
            s_neg = total_r - s_pos
            if min(s_pos, s_neg) <= w_stat + 1e-9:
                extreme += 1
        p_val = min(1.0, extreme / total_masks)
    else:
        mu_w = n * (n + 1) / 4.0
        sd_w = math.sqrt(n * (n + 1) * (2 * n + 1) / 24.0)
        z = (abs(w_stat - mu_w) - 0.5) / sd_w if sd_w > 0 else 0.0
        p_val = 2.0 * (1.0 - _normal_cdf(max(0.0, z)))
    return round(w_stat, 4), round(p_val, 6), rank_biserial


def paired_hypothesis_test(
    coplan_vals: list[float],
    baseline_vals: list[float],
    *,
    alternative: str = "two-sided",
    non_inferiority_margin: float | None = None,
) -> dict[str, Any]:
    """Run Shapiro-Wilk -> paired t-test or Wilcoxon, effect size, and 95% bootstrap CI."""
    assert len(coplan_vals) == len(baseline_vals) and len(coplan_vals) >= 3
    diffs = [c - b for c, b in zip(coplan_vals, baseline_vals)]
    n = len(diffs)
    mean_d = mean(diffs)
    sd_d = stdev(diffs)
    ci_lo, ci_hi = bootstrap_ci(diffs)

    norm_stat, norm_p, norm_method = shapiro_normality_check(diffs)

    if non_inferiority_margin is not None:
        # H0: mean(coplan - baseline) <= non_inferiority_margin (e.g., -0.75)
        se = sd_d / math.sqrt(n) if sd_d > 0 else 1e-9
        t_stat = (mean_d - non_inferiority_margin) / se
        p_two = _student_t_two_sided_p(t_stat, n - 1)
        p_one = p_two / 2.0 if t_stat > 0 else 1.0 - p_two / 2.0
        dz = round(mean_d / sd_d, 4) if sd_d > 0 else 0.0
        return {
            "n": n,
            "mean_coplan": round(mean(coplan_vals), 4),
            "mean_baseline": round(mean(baseline_vals), 4),
            "mean_diff": round(mean_d, 4),
            "ci95_diff": [ci_lo, ci_hi],
            "normality_method": norm_method,
            "normality_p": norm_p,
            "test_used": f"non_inferiority_t (margin={non_inferiority_margin})",
            "statistic": round(t_stat, 4),
            "p_raw": round(p_one, 6),
            "effect_size_name": "cohens_dz",
            "effect_size": dz,
            "non_inferior_ci_pass": ci_lo > non_inferiority_margin,
        }

    if norm_p >= 0.05:
        se = sd_d / math.sqrt(n) if sd_d > 0 else 1e-9
        t_stat = mean_d / se
        p_two = _student_t_two_sided_p(t_stat, n - 1)
        if alternative == "less":
            p_raw = p_two / 2.0 if t_stat < 0 else 1.0 - p_two / 2.0
        elif alternative == "greater":
            p_raw = p_two / 2.0 if t_stat > 0 else 1.0 - p_two / 2.0
        else:
            p_raw = p_two
        dz = round(mean_d / sd_d, 4) if sd_d > 0 else 0.0
        return {
            "n": n,
            "mean_coplan": round(mean(coplan_vals), 4),
            "mean_baseline": round(mean(baseline_vals), 4),
            "mean_diff": round(mean_d, 4),
            "ci95_diff": [ci_lo, ci_hi],
            "normality_method": norm_method,
            "normality_p": norm_p,
            "test_used": "paired_t_test",
            "statistic": round(t_stat, 4),
            "p_raw": round(p_raw, 6),
            "effect_size_name": "cohens_dz",
            "effect_size": dz,
        }

    w_stat, p_two, r_rb = wilcoxon_paired_test(diffs)
    if alternative == "less":
        p_raw = p_two / 2.0 if mean_d < 0 else 1.0 - p_two / 2.0
    elif alternative == "greater":
        p_raw = p_two / 2.0 if mean_d > 0 else 1.0 - p_two / 2.0
    else:
        p_raw = p_two
    return {
        "n": n,
        "mean_coplan": round(mean(coplan_vals), 4),
        "mean_baseline": round(mean(baseline_vals), 4),
        "mean_diff": round(mean_d, 4),
        "ci95_diff": [ci_lo, ci_hi],
        "normality_method": norm_method,
        "normality_p": norm_p,
        "test_used": "wilcoxon_signed_rank",
        "statistic": w_stat,
        "p_raw": round(p_raw, 6),
        "effect_size_name": "rank_biserial_r",
        "effect_size": r_rb,
    }


def holm_bonferroni(p_values: dict[str, float]) -> dict[str, float]:
    """Apply Holm-Bonferroni step-down multiplicity correction across hypotheses."""
    m = len(p_values)
    ordered = sorted(p_values.items(), key=lambda kv: kv[1])
    adjusted: dict[str, float] = {}
    running_max = 0.0
    for idx, (label, p) in enumerate(ordered):
        corr = min(1.0, (m - idx) * p)
        running_max = max(running_max, corr)
        adjusted[label] = round(running_max, 6)
    return adjusted


def cohens_kappa(
    rater_a: list[int],
    rater_b: list[int],
    *,
    min_score: int = 0,
    max_score: int = 10,
) -> dict[str, float]:
    """Compute unweighted and quadratic-weighted Cohen's kappa for 2 blind raters."""
    assert len(rater_a) == len(rater_b) and len(rater_a) > 0
    n = len(rater_a)
    k = max_score - min_score + 1

    # Confusion matrix
    obs = [[0] * k for _ in range(k)]
    for a, b in zip(rater_a, rater_b):
        obs[a - min_score][b - min_score] += 1

    hist_a = [sum(obs[i][j] for j in range(k)) for i in range(k)]
    hist_b = [sum(obs[i][j] for i in range(k)) for j in range(k)]

    # Unweighted kappa
    p_o = sum(obs[i][i] for i in range(k)) / n
    p_e = sum(hist_a[i] * hist_b[i] for i in range(k)) / (n * n)
    unweighted = 1.0 if p_e == 1.0 else (p_o - p_e) / (1.0 - p_e)

    # Quadratic weighted kappa
    num = 0.0
    den = 0.0
    denom_scale = float((k - 1) ** 2) if k > 1 else 1.0
    for i in range(k):
        for j in range(k):
            w = ((i - j) ** 2) / denom_scale
            exp_ij = (hist_a[i] * hist_b[j]) / n
            num += w * obs[i][j]
            den += w * exp_ij
    qwk = 1.0 if den == 0.0 else 1.0 - (num / den)

    return {
        "unweighted_kappa": round(unweighted, 4),
        "quadratic_weighted_kappa": round(qwk, 4),
    }


def order_and_carryover_check(
    ab_sums: list[float],
    ba_sums: list[float],
    period1_vals: list[float],
    period2_vals: list[float],
) -> dict[str, Any]:
    """Check AB vs BA carryover effect (independent Welch t on sums) and period effect (paired t)."""
    # Carryover: compare (Y_coplan + Y_baseline) between AB and BA sequence groups
    m_ab, m_ba = mean(ab_sums), mean(ba_sums)
    v_ab = stdev(ab_sums) ** 2 if len(ab_sums) > 1 else 0.0
    v_ba = stdev(ba_sums) ** 2 if len(ba_sums) > 1 else 0.0
    se_c = math.sqrt(v_ab / len(ab_sums) + v_ba / len(ba_sums)) or 1e-9
    t_carry = (m_ab - m_ba) / se_c
    df_carry = max(1, len(ab_sums) + len(ba_sums) - 2)
    p_carry = _student_t_two_sided_p(t_carry, df_carry)

    # Period effect: paired t on Period 1 vs Period 2
    p_diffs = [a - b for a, b in zip(period1_vals, period2_vals)]
    sd_p = stdev(p_diffs) if len(p_diffs) > 1 else 0.0
    se_p = (sd_p / math.sqrt(len(p_diffs))) if sd_p > 0 else 1e-9
    t_period = mean(p_diffs) / se_p
    p_period = _student_t_two_sided_p(t_period, max(1, len(p_diffs) - 1))

    return {
        "carryover_t": round(t_carry, 4),
        "carryover_p": round(p_carry, 5),
        "carryover_warning": p_carry < 0.05,
        "period_t": round(t_period, 4),
        "period_p": round(p_period, 5),
        "period_warning": p_period < 0.05,
    }


# ---------------------------------------------------------------------------
# 3. SYNTHETIC Pipeline Test Data Generator (NEVER real participant data!)
# ---------------------------------------------------------------------------


def generate_synthetic_pipeline_test_data(
    n_participants: int = 12,
    seed: int = 2026,
) -> dict[str, Any]:
    """Generate CLEARLY LABELLED synthetic data solely to verify statistical code paths."""
    rng = random.Random(seed)
    paired_rows: list[dict[str, Any]] = []
    rater_a: list[int] = []
    rater_b: list[int] = []

    for i in range(n_participants):
        pid = f"SYNTH_P{i + 1:02d}"
        order = "AB" if i < n_participants // 2 else "BA"
        base_tlx = rng.uniform(52, 74)
        coplan_tlx = max(10.0, base_tlx - rng.uniform(8, 22))
        base_ttr = rng.uniform(22_000, 42_000)
        coplan_ttr = max(2_000.0, base_ttr * rng.uniform(0.25, 0.55))
        base_ctrl = rng.uniform(3.0, 4.6)
        coplan_ctrl = min(7.0, base_ctrl + rng.uniform(0.9, 2.0))
        base_trust = rng.uniform(3.8, 5.2)
        coplan_trust = min(7.0, base_trust + rng.uniform(0.3, 1.1))

        q_base_a = rng.randint(6, 9)
        q_base_b = max(0, min(10, q_base_a + rng.choice([-1, 0, 0, 1])))
        q_co_a = rng.randint(7, 10)
        q_co_b = max(0, min(10, q_co_a + rng.choice([-1, 0, 0, 1])))
        rater_a.extend([q_base_a, q_co_a])
        rater_b.extend([q_base_b, q_co_b])

        paired_rows.append(
            {
                "label": "SYNTHETIC - pipeline test only",
                "participant_id": pid,
                "sequence": order,
                "tlx_coplan": round(coplan_tlx, 2),
                "tlx_baseline": round(base_tlx, 2),
                "ttr_ms_coplan": round(coplan_ttr, 1),
                "ttr_ms_baseline": round(base_ttr, 1),
                "control_coplan": round(coplan_ctrl, 2),
                "control_baseline": round(base_ctrl, 2),
                "trust_coplan": round(coplan_trust, 2),
                "trust_baseline": round(base_trust, 2),
                "quality_coplan": (q_co_a + q_co_b) / 2.0,
                "quality_baseline": (q_base_a + q_base_b) / 2.0,
                "completion_s_coplan": round(rng.uniform(480, 660), 1),
                "completion_s_baseline": round(rng.uniform(540, 720), 1),
                "override_rate_coplan": round(rng.uniform(0.12, 0.35), 3),
                "rework_coplan": rng.randint(1, 3),
                "rework_baseline": rng.randint(2, 5),
                "error_rate_coplan": round(rng.uniform(0.0, 0.08), 3),
            }
        )

    return {
        "DATASET_WARNING": "SYNTHETIC - pipeline test only (NOT real participant data)",
        "paired_rows": paired_rows,
        "rater_a": rater_a,
        "rater_b": rater_b,
    }


def run_full_hypothesis_suite(
    paired_rows: list[dict[str, Any]],
    rater_a: list[int],
    rater_b: list[int],
    *,
    dataset_label: str = "SYNTHETIC - pipeline test only",
) -> dict[str, Any]:
    """Execute H1-H4 paired tests, Holm-Bonferroni correction, order/carryover, and Cohen's kappa."""
    h1 = paired_hypothesis_test(
        [r["tlx_coplan"] for r in paired_rows],
        [r["tlx_baseline"] for r in paired_rows],
        alternative="less",
    )
    h2 = paired_hypothesis_test(
        [r["ttr_ms_coplan"] for r in paired_rows],
        [r["ttr_ms_baseline"] for r in paired_rows],
        alternative="less",
    )
    h3 = paired_hypothesis_test(
        [r["control_coplan"] for r in paired_rows],
        [r["control_baseline"] for r in paired_rows],
        alternative="greater",
    )
    h4 = paired_hypothesis_test(
        [r["quality_coplan"] for r in paired_rows],
        [r["quality_baseline"] for r in paired_rows],
        non_inferiority_margin=-0.75,
    )

    holm = holm_bonferroni(
        {"H1_tlx": h1["p_raw"], "H2_ttr": h2["p_raw"], "H3_control": h3["p_raw"], "H4_quality_ni": h4["p_raw"]}
    )
    h1["p_holm"] = holm["H1_tlx"]
    h2["p_holm"] = holm["H2_ttr"]
    h3["p_holm"] = holm["H3_control"]
    h4["p_holm"] = holm["H4_quality_ni"]

    ab_rows = [r for r in paired_rows if r["sequence"] == "AB"]
    ba_rows = [r for r in paired_rows if r["sequence"] == "BA"]
    order_check = order_and_carryover_check(
        ab_sums=[r["tlx_coplan"] + r["tlx_baseline"] for r in ab_rows],
        ba_sums=[r["tlx_coplan"] + r["tlx_baseline"] for r in ba_rows],
        period1_vals=[r["tlx_coplan"] if r["sequence"] == "AB" else r["tlx_baseline"] for r in paired_rows],
        period2_vals=[r["tlx_baseline"] if r["sequence"] == "AB" else r["tlx_coplan"] for r in paired_rows],
    )
    kappa = cohens_kappa(rater_a, rater_b)

    return {
        "dataset_label": dataset_label,
        "hypotheses": {
            "H1_lower_tlx": h1,
            "H2_shorter_recovery": h2,
            "H3_higher_control": h3,
            "H4_quality_non_inferior": h4,
        },
        "order_and_carryover_tlx": order_check,
        "inter_rater_kappa": kappa,
    }


if __name__ == "__main__":
    synth = generate_synthetic_pipeline_test_data()
    report = run_full_hypothesis_suite(
        synth["paired_rows"],
        synth["rater_a"],
        synth["rater_b"],
        dataset_label=synth["DATASET_WARNING"],
    )
    print(json.dumps(report, indent=2))
