"""Tests for Stage 7 study analysis pipeline: mock-LLM hard-fail gate, Holm-Bonferroni,
Cohen's kappa, order/carryover checks, and SYNTHETIC pipeline self-test.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from eval.notebooks.study_analysis import (
    MockLLMDataError,
    cohens_kappa,
    generate_synthetic_pipeline_test_data,
    holm_bonferroni,
    load_study_logs,
    run_full_hypothesis_suite,
)


def test_analysis_fails_loudly_on_mock_llm_logs(tmp_path: Path) -> None:
    mock_log = tmp_path / "P01_task_research_brief_coplan.jsonl"
    row = {
        "ts": "2026-11-27T10:00:00+00:00",
        "session_id": "sess_mock_1",
        "participant_id": "P01",
        "condition": "coplan",
        "task_id": "task_research_brief",
        "actor": "user",
        "event_type": "session_created",
        "step_id": None,
        "payload_json": json.dumps({"llm_provider": "mock", "llm_model": "mock-coplan-v1"}),
        "latency_ms": 0.0,
        "tokens_in": 0,
        "tokens_out": 0,
        "autonomy_level": "L2",
        "checkpoint_id": None,
    }
    mock_log.write_text(json.dumps(row) + "\n", encoding="utf-8")

    with pytest.raises(MockLLMDataError, match="mock-LLM"):
        load_study_logs(tmp_path, fail_on_mock=True)


def test_synthetic_pipeline_executes_h1_through_h4_kappa_holm_and_order_checks() -> None:
    synth = generate_synthetic_pipeline_test_data(n_participants=12, seed=2026)
    assert "SYNTHETIC - pipeline test only" in synth["DATASET_WARNING"]

    report = run_full_hypothesis_suite(
        synth["paired_rows"],
        synth["rater_a"],
        synth["rater_b"],
        dataset_label=synth["DATASET_WARNING"],
    )
    assert "SYNTHETIC - pipeline test only" in report["dataset_label"]

    hyps = report["hypotheses"]
    assert set(hyps.keys()) == {
        "H1_lower_tlx",
        "H2_shorter_recovery",
        "H3_higher_control",
        "H4_quality_non_inferior",
    }
    for h in hyps.values():
        assert "p_raw" in h and "p_holm" in h
        assert h["p_holm"] >= h["p_raw"]
        assert len(h["ci95_diff"]) == 2
        assert h["effect_size_name"] in {"cohens_dz", "rank_biserial_r"}

    kappa = report["inter_rater_kappa"]
    assert -1.0 <= kappa["unweighted_kappa"] <= 1.0
    assert -1.0 <= kappa["quadratic_weighted_kappa"] <= 1.0

    # Verify exact kappa on perfect agreement
    perfect = cohens_kappa([5, 7, 8, 9], [5, 7, 8, 9])
    assert perfect["unweighted_kappa"] == 1.0
    assert perfect["quadratic_weighted_kappa"] == 1.0

    # Verify Holm-Bonferroni monotonicity
    adj = holm_bonferroni({"a": 0.01, "b": 0.04, "c": 0.03, "d": 0.20})
    assert adj["a"] == 0.04
    assert adj["c"] == 0.09
    assert adj["b"] == 0.09
    assert adj["d"] == 0.20
