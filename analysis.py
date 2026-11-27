"""Statistical analysis pipeline (Person 3) for the Human-Agent Interaction study."""

from __future__ import annotations

import argparse
import csv
import math
from datetime import datetime, timedelta, timezone
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from scipy import stats

ROOT = Path(__file__).resolve().parent
LOGS_DIR = ROOT / "logs"
EVENTS_CSV = LOGS_DIR / "events.csv"
QUESTIONNAIRE_CSV = LOGS_DIR / "questionnaire.csv"
RATINGS_CSV = LOGS_DIR / "ratings.csv"
RESULTS_CSV = ROOT / "results.csv"
CHART_PNG = ROOT / "results_chart.png"

INTERVENTION_EVENTS = {
    "edit_step",
    "delete_step",
    "add_step",
    "add_constraint",
    "pause",
    "edit",
    "delete",
    "add",
    "constraint",
}
QUESTIONNAIRE_METRICS = [
    "mental_demand",
    "effort",
    "frustration",
    "control",
    "understood",
    "trust",
]


def generate_fake_data(n_participants: int = 10, seed: int = 42) -> None:
    """Create 10 fake participants across steerable & baseline in logs/*.csv."""
    rng = np.random.default_rng(seed)
    LOGS_DIR.mkdir(parents=True, exist_ok=True)

    events_rows: list[list[object]] = []
    q_rows: list[list[object]] = []
    rating_rows: list[list[object]] = []
    base_time = datetime(2026, 11, 27, 10, 0, 0, tzinfo=timezone.utc)

    for i in range(1, n_participants + 1):
        pid = f"P{i:02d}"
        task_pair = ("A", "D") if i % 2 == 1 else ("C", "B")
        conds = ["steerable", "baseline"] if i % 2 == 1 else ["baseline", "steerable"]

        for c_idx, cond in enumerate(conds):
            tid = task_pair[c_idx]
            has_pe = tid in ("A", "C")
            t0 = base_time + timedelta(minutes=(i * 40 + c_idx * 15))
            dur_sec = int(rng.normal(245 if cond == "steerable" else 190, 35))
            dur_sec = max(90, dur_sec)
            t_end = t0 + timedelta(seconds=dur_sec)

            events_rows.append([t0.isoformat(), pid, cond, tid, "session_start", "", f"order={conds[0]}"])
            if cond == "steerable":
                events_rows.append([(t0 + timedelta(seconds=8)).isoformat(), pid, cond, tid, "plan_generated", "", "5 steps"])
                if has_pe:
                    events_rows.append([(t0 + timedelta(seconds=45)).isoformat(), pid, cond, tid, "planted_error_injected", "s2", "wrong fact"])
                n_interv = int(rng.integers(2, 6))
                interv_pool = ["edit_step", "delete_step", "add_step", "add_constraint", "pause"]
                for k in range(n_interv):
                    ev = interv_pool[k % len(interv_pool)]
                    events_rows.append([(t0 + timedelta(seconds=60 + k * 20)).isoformat(), pid, cond, tid, ev, f"s{(k % 4) + 1}", "user action"])
                events_rows.append([(t0 + timedelta(seconds=130)).isoformat(), pid, cond, tid, "approved", "s3", "approved"])
            else:
                if has_pe:
                    events_rows.append([(t0 + timedelta(seconds=30)).isoformat(), pid, cond, tid, "planted_error_injected", "", "wrong fact"])

            events_rows.append([(t_end - timedelta(seconds=5)).isoformat(), pid, cond, tid, "final_answer", "", "chars=420"])
            events_rows.append([t_end.isoformat(), pid, cond, tid, "session_end", "", ""])

            if cond == "steerable":
                md = int(np.clip(rng.normal(3.3, 0.8), 1, 7))
                ef = int(np.clip(rng.normal(3.6, 0.9), 1, 7))
                fr = int(np.clip(rng.normal(2.2, 0.8), 1, 7))
                ct = int(np.clip(rng.normal(5.8, 0.7), 1, 7))
                un = int(np.clip(rng.normal(5.6, 0.8), 1, 7))
                tr = int(np.clip(rng.normal(5.4, 0.8), 1, 7))
                caught = "Yes" if (has_pe and rng.random() < 0.85) else "No"
                q_base = 4.2 if caught == "Yes" or not has_pe else 3.4
            else:
                md = int(np.clip(rng.normal(4.3, 0.9), 1, 7))
                ef = int(np.clip(rng.normal(4.4, 0.9), 1, 7))
                fr = int(np.clip(rng.normal(4.1, 1.0), 1, 7))
                ct = int(np.clip(rng.normal(2.9, 0.9), 1, 7))
                un = int(np.clip(rng.normal(3.3, 0.9), 1, 7))
                tr = int(np.clip(rng.normal(3.8, 1.0), 1, 7))
                caught = "Yes" if (has_pe and rng.random() < 0.25) else "No"
                q_base = 3.0 if has_pe and caught == "No" else 3.4

            err_txt = "Noticed wrong spec/price figure" if caught == "Yes" else ""
            q_rows.append([pid, cond, tid, md, ef, fr, ct, un, tr, caught, err_txt, t_end.isoformat()])

            true_q = int(np.clip(round(rng.normal(q_base, 0.6)), 1, 5))
            r1 = int(np.clip(true_q + rng.choice([0, 0, 0, 1, -1]), 1, 5))
            r2 = int(np.clip(true_q + rng.choice([0, 0, 0, 1, -1]), 1, 5))
            rating_rows.append([pid, cond, "R1", r1])
            rating_rows.append([pid, cond, "R2", r2])

    with EVENTS_CSV.open("w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["timestamp", "participant_id", "condition", "task_id", "event_type", "step_id", "details"])
        w.writerows(events_rows)

    with QUESTIONNAIRE_CSV.open("w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["participant_id", "condition", "task_id", "mental_demand", "effort", "frustration", "control", "understood", "trust", "noticed_error", "error_description", "timestamp"])
        w.writerows(q_rows)

    with RATINGS_CSV.open("w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["participant_id", "condition", "rater", "quality_score"])
        w.writerows(rating_rows)


def _compute_session_metrics() -> pd.DataFrame:
    events = pd.read_csv(EVENTS_CSV)
    events["timestamp"] = pd.to_datetime(events["timestamp"], utc=True, format="ISO8601")

    ev_rows = []
    for (pid, cond), grp in events.groupby(["participant_id", "condition"]):
        starts = grp.loc[grp["event_type"] == "session_start", "timestamp"]
        ends = grp.loc[grp["event_type"] == "session_end", "timestamp"]
        if not starts.empty and not ends.empty:
            time_sec = (ends.max() - starts.min()).total_seconds()
        else:
            time_sec = (grp["timestamp"].max() - grp["timestamp"].min()).total_seconds()
        interventions = int(grp["event_type"].isin(INTERVENTION_EVENTS).sum())
        ev_rows.append({"participant_id": pid, "condition": cond, "time_on_task_sec": time_sec, "interventions": interventions})
    ev_df = pd.DataFrame(ev_rows)

    q_df = pd.read_csv(QUESTIONNAIRE_CSV)
    q_df["planted_error_caught"] = q_df["noticed_error"].astype(str).str.strip().str.lower().isin({"yes", "true", "1"}).astype(int)
    q_cols = ["participant_id", "condition", *QUESTIONNAIRE_METRICS, "planted_error_caught"]
    q_agg = q_df[q_cols].groupby(["participant_id", "condition"], as_index=False).mean(numeric_only=True)

    merged = pd.merge(ev_df, q_agg, on=["participant_id", "condition"], how="outer")

    if RATINGS_CSV.exists():
        r_df = pd.read_csv(RATINGS_CSV)
        r_agg = r_df.groupby(["participant_id", "condition"], as_index=False)["quality_score"].mean()
        merged = pd.merge(merged, r_agg, on=["participant_id", "condition"], how="left")

    return merged


def _cohens_kappa_and_icc() -> dict[str, float] | None:
    if not RATINGS_CSV.exists():
        return None
    r_df = pd.read_csv(RATINGS_CSV)
    piv = r_df.pivot_table(index=["participant_id", "condition"], columns="rater", values="quality_score", aggfunc="mean").dropna()
    if piv.shape[0] < 2 or piv.shape[1] < 2:
        return None

    r1 = piv.iloc[:, 0].round().astype(int).to_numpy()
    r2 = piv.iloc[:, 1].round().astype(int).to_numpy()
    n = len(r1)
    labels = sorted(set(r1) | set(r2))
    po = float(np.mean(r1 == r2))
    pe = sum(float(np.mean(r1 == k)) * float(np.mean(r2 == k)) for k in labels)
    kappa = (po - pe) / (1.0 - pe) if pe < 1.0 else 1.0

    # ICC(2,1): two-way random, single measures, absolute agreement
    Y = piv.iloc[:, :2].to_numpy(dtype=float)
    n_subj, k_raters = Y.shape
    mean_subj = Y.mean(axis=1, keepdims=True)
    mean_rater = Y.mean(axis=0, keepdims=True)
    grand = Y.mean()
    ss_total = float(np.sum((Y - grand) ** 2))
    ss_subj = float(k_raters * np.sum((mean_subj - grand) ** 2))
    ss_rater = float(n_subj * np.sum((mean_rater - grand) ** 2))
    ss_err = max(0.0, ss_total - ss_subj - ss_rater)
    ms_subj = ss_subj / max(1, n_subj - 1)
    ms_rater = ss_rater / max(1, k_raters - 1)
    ms_err = ss_err / max(1, (n_subj - 1) * (k_raters - 1))
    denom = ms_subj + (k_raters - 1) * ms_err + (k_raters / n_subj) * (ms_rater - ms_err)
    icc = (ms_subj - ms_err) / denom if denom > 0 else 1.0
    return {"n_rated": float(n), "cohens_kappa": kappa, "icc_2_1": icc}


def _paired_stats(df: pd.DataFrame) -> pd.DataFrame:
    metrics = ["time_on_task_sec", "interventions", *QUESTIONNAIRE_METRICS, "planted_error_caught"]
    if "quality_score" in df.columns and df["quality_score"].notna().any():
        metrics.append("quality_score")

    rows = []
    for m in metrics:
        piv = df.pivot(index="participant_id", columns="condition", values=m)
        if not {"steerable", "baseline"}.issubset(piv.columns):
            continue
        paired = piv[["steerable", "baseline"]].dropna()
        n = len(paired)
        if n == 0:
            continue

        s_vals = paired["steerable"].to_numpy(dtype=float)
        b_vals = paired["baseline"].to_numpy(dtype=float)
        diffs = s_vals - b_vals
        mean_diff = float(np.mean(diffs))
        sd_diff = float(np.std(diffs, ddof=1)) if n > 1 else 0.0

        if np.allclose(diffs, 0.0):
            w_stat, p_val = 0.0, 1.0
        else:
            res = stats.wilcoxon(s_vals, b_vals, zero_method="wilcox")
            w_stat, p_val = float(res.statistic), float(res.pvalue)

        if sd_diff > 0 and n > 1:
            dz = mean_diff / sd_diff
            se_dz = math.sqrt(1.0 / n + (dz ** 2) / (2.0 * n))
            t_crit = float(stats.t.ppf(0.975, df=n - 1))
            ci_low, ci_high = dz - t_crit * se_dz, dz + t_crit * se_dz
        else:
            dz = 0.0 if mean_diff == 0 else float("nan")
            ci_low, ci_high = float("nan"), float("nan")

        rows.append(
            {
                "metric": m,
                "n_pairs": n,
                "steerable_mean": round(float(np.mean(s_vals)), 4),
                "steerable_sd": round(float(np.std(s_vals, ddof=1)) if n > 1 else 0.0, 4),
                "baseline_mean": round(float(np.mean(b_vals)), 4),
                "baseline_sd": round(float(np.std(b_vals, ddof=1)) if n > 1 else 0.0, 4),
                "mean_diff": round(mean_diff, 4),
                "wilcoxon_stat": round(w_stat, 4),
                "p_value": round(p_val, 5),
                "cohens_dz": round(dz, 4) if not math.isnan(dz) else float("nan"),
                "ci_95_low": round(ci_low, 4) if not math.isnan(ci_low) else float("nan"),
                "ci_95_high": round(ci_high, 4) if not math.isnan(ci_high) else float("nan"),
            }
        )
    return pd.DataFrame(rows)


def _plot_results(results_df: pd.DataFrame) -> None:
    scale_metrics = [m for m in [*QUESTIONNAIRE_METRICS, "quality_score"] if m in set(results_df["metric"])]
    sub = results_df[results_df["metric"].isin(scale_metrics)].copy()
    if sub.empty:
        sub = results_df.copy()

    x = np.arange(len(sub))
    width = 0.36
    fig, ax = plt.subplots(figsize=(10, 5.2))
    s_se = sub["steerable_sd"] / np.sqrt(sub["n_pairs"].clip(lower=1))
    b_se = sub["baseline_sd"] / np.sqrt(sub["n_pairs"].clip(lower=1))

    ax.bar(x - width / 2, sub["steerable_mean"], width, yerr=s_se, capsize=4, label="Steerable", color="#2563EB")
    ax.bar(x + width / 2, sub["baseline_mean"], width, yerr=b_se, capsize=4, label="Baseline", color="#94A3B8")

    ax.set_xticks(x)
    ax.set_xticklabels([m.replace("_", "\n") for m in sub["metric"]], fontsize=9)
    ax.set_ylabel("Mean Score (± SE)")
    ax.set_title("Steerable vs. Baseline: Subjective Ratings & Output Quality")
    ax.set_ylim(0, 7.5)
    ax.legend(frameon=False)
    ax.grid(axis="y", linestyle="--", alpha=0.35)

    for idx, row in enumerate(sub.itertuples()):
        top = max(row.steerable_mean, row.baseline_mean) + 0.45
        p_txt = f"p={row.p_value:.3f}" if row.p_value >= 0.001 else "p<.001"
        ax.text(idx, min(top, 7.15), p_txt, ha="center", va="bottom", fontsize=8, color="#334155")

    fig.tight_layout()
    fig.savefig(CHART_PNG, dpi=180)
    plt.close(fig)


def run_analysis() -> tuple[pd.DataFrame, dict[str, float] | None]:
    session_df = _compute_session_metrics()
    results_df = _paired_stats(session_df)
    results_df.to_csv(RESULTS_CSV, index=False)
    _plot_results(results_df)
    agreement = _cohens_kappa_and_icc()

    print("=== Paired Wilcoxon & Effect Sizes (Steerable - Baseline) ===")
    print(results_df.to_string(index=False))
    if agreement:
        print(
            f"\n=== Inter-Rater Agreement (n={int(agreement['n_rated'])}) ===\n"
            f"Cohen's kappa: {agreement['cohens_kappa']:.4f} | ICC(2,1): {agreement['icc_2_1']:.4f}"
        )
    else:
        print("\n=== Inter-Rater Agreement ===\nNo multi-rater ratings.csv found.")
    print(f"\nSaved: {RESULTS_CSV.name}, {CHART_PNG.name}")
    return results_df, agreement


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Analyze HAI study logs.")
    parser.add_argument("--fake", action="store_true", help="Generate 10 fake participants before analyzing.")
    args = parser.parse_args()

    if args.fake or not EVENTS_CSV.exists() or not QUESTIONNAIRE_CSV.exists():
        generate_fake_data(10)
    run_analysis()
