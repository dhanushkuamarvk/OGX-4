"""Stage 5 tests: Latin-square counterbalancing, session assignment routing,
{participant}_{task}_{condition}.jsonl raw logs, monotonic timestamps,
export_csv.py, and comparable recovery telemetry across both conditions.
"""

from __future__ import annotations

import asyncio
import csv
import json
from collections import Counter
from datetime import datetime
from pathlib import Path

import httpx
import pytest

from backend.api.main import create_app
from backend.shared.config import Settings
from backend.shared.schemas import TELEMETRY_COLUMNS
from eval.export_csv import export_raw_logs_to_csv
from scripts.generate_counterbalancing import TASKS, build_counterbalancing_rows


def test_counterbalancing_latin_square_balance() -> None:
    csv_path = Path("eval/counterbalancing.csv")
    assert csv_path.exists()
    with csv_path.open("r", encoding="utf-8", newline="") as fh:
        rows = list(csv.DictReader(fh))

    assert len(rows) == 12
    assert len(build_counterbalancing_rows(12)) == 12

    cond_first = Counter(r["condition_order"].split("|")[0] for r in rows)
    cond_second = Counter(r["condition_order"].split("|")[1] for r in rows)
    assert cond_first == {"coplan": 6, "baseline": 6}
    assert cond_second == {"coplan": 6, "baseline": 6}

    # Every task appears exactly 4 times in slot 0, slot 1, and slot 2
    for slot in range(3):
        slot_counts = Counter(r["task_order"].split("|")[slot] for r in rows)
        assert dict(slot_counts) == {t: 4 for t in TASKS}

    # Every (condition, task) pair in round 1 & round 2 is perfectly balanced (2 each!)
    round1_pairs = Counter(
        (r["condition_order"].split("|")[0], r["task_order"].split("|")[0])
        for r in rows
    )
    round2_pairs = Counter(
        (r["condition_order"].split("|")[1], r["task_order"].split("|")[1])
        for r in rows
    )
    assert all(v == 2 for v in round1_pairs.values()) and len(round1_pairs) == 6
    assert all(v == 2 for v in round2_pairs.values()) and len(round2_pairs) == 6


@pytest.mark.asyncio
async def test_assignment_routing_raw_log_naming_and_comparable_recovery_time(
    tmp_path: Path,
) -> None:
    cfg = Settings(
        llm_provider="mock",
        llm_model="mock-coplan-v1",
        coplan_step_delay_ms=0,
        db_path=str(tmp_path / "study.db"),
        telemetry_dir=str(tmp_path / "raw_logs"),
        tasks_path="eval/tasks/tasks.json",
    )
    app = create_app(cfg, auto_start_sessions=True)
    transport = httpx.ASGITransport(app=app)

    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Lookup assignment for P01 -> Round 1 is coplan + task_research_brief on single unified host
        a1 = (await client.get("/assignment/P01")).json()
        assert a1["next_round_index"] == 0
        assert a1["next_condition"] == "coplan"
        assert a1["next_task_id"] == "task_research_brief"
        assert a1["next_app_url"] == "http://127.0.0.1:8000"

        # Run Round 1 (Co-Plan) with mid-task requirement change
        s1 = (
            await client.post(
                "/sessions",
                json={
                    "task_id": a1["next_task_id"],
                    "participant_id": "P01",
                    "condition": "coplan",
                    "autonomy_level": "L3",
                },
            )
        ).json()
        sid1 = s1["session_id"]
        for _ in range(100):
            cur = (await client.get(f"/sessions/{sid1}")).json()
            if cur["status"] == "done":
                break
            await asyncio.sleep(0.02)

        req1 = await client.post(
            f"/sessions/{sid1}/requirement",
            json={
                "text": "Mid-task council directive: 40% low-income benefit allocation and $2.5M cash cap."
            },
        )
        assert req1.status_code == 200

        # 2. Lookup P01 again -> advances to Round 2 (baseline + task_event_plan on same single host!)
        a2 = (await client.get("/assignment/P01")).json()
        assert a2["completed_rounds"] == 1
        assert a2["next_round_index"] == 1
        assert a2["next_condition"] == "baseline"
        assert a2["next_task_id"] == "task_event_plan"
        assert a2["next_app_url"] == "http://127.0.0.1:8000"

        # Run Round 2 (Baseline) including initial draft + mid-task requirement change turn
        s2 = (
            await client.post(
                "/sessions",
                json={
                    "task_id": a2["next_task_id"],
                    "participant_id": "P01",
                    "condition": "baseline",
                },
            )
        ).json()
        sid2 = s2["session_id"]
        r_init = await client.post(
            f"/chat/{sid2}",
            json={"message": "Produce the complete Civic Tech Summit event plan under $38,000."},
        )
        assert r_init.status_code == 200
        r_req = await client.post(
            f"/chat/{sid2}",
            json={
                "message": "Mid-task sponsor update: Budget is cut to $31,000 and add live captioned hybrid stream."
            },
        )
        assert r_req.status_code == 200

        # 3. Lookup P01 again -> all rounds completed!
        a3 = (await client.get("/assignment/P01")).json()
        assert a3["all_completed"] is True
        assert a3["completed_rounds"] == 2

        app.state.container.telemetry.flush()
        await app.state.container.engine.shutdown()

    # 4. Verify exact per-run filenames {participant}_{task}_{condition}.jsonl
    coplan_log = tmp_path / "raw_logs" / "P01_task_research_brief_coplan.jsonl"
    baseline_log = tmp_path / "raw_logs" / "P01_task_event_plan_baseline.jsonl"
    assert coplan_log.exists()
    assert baseline_log.exists()

    # 5. Verify 14-column schema, strictly monotonic timestamps, AND computable time-to-recover in BOTH!
    for log_path in (coplan_log, baseline_log):
        rows = [
            json.loads(line)
            for line in log_path.read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]
        assert len(rows) >= 4
        parsed_ts = [datetime.fromisoformat(r["ts"]) for r in rows]
        for prev_t, cur_t in zip(parsed_ts, parsed_ts[1:]):
            assert cur_t > prev_t, f"Non-monotonic timestamps in {log_path.name}"
        for r in rows:
            assert set(r.keys()) == set(TELEMETRY_COLUMNS)

        sent = next(r for r in rows if r["event_type"] == "requirement_change_sent")
        resp = next(r for r in rows if r["event_type"] == "first_useful_response")
        ttr_ms = (
            datetime.fromisoformat(resp["ts"]) - datetime.fromisoformat(sent["ts"])
        ).total_seconds() * 1000.0
        assert ttr_ms >= 0.0

    # 6. Verify eval/export_csv.py produces valid 14-column combined CSV
    out_csv, count = export_raw_logs_to_csv(
        tmp_path / "raw_logs",
        tmp_path / "combined.csv",
    )
    assert count >= 8
    with out_csv.open("r", encoding="utf-8", newline="") as fh:
        csv_rows = list(csv.reader(fh))
    assert tuple(csv_rows[0]) == TELEMETRY_COLUMNS
    assert len(csv_rows) == count + 1


@pytest.mark.asyncio
async def test_single_host_serves_unified_frontend_and_api(tmp_path: Path) -> None:
    cfg = Settings(
        llm_provider="mock",
        llm_model="mock-coplan-v1",
        coplan_step_delay_ms=0,
        db_path=str(tmp_path / "host.db"),
        telemetry_dir=str(tmp_path / "raw_logs"),
        tasks_path="eval/tasks/tasks.json",
    )
    app = create_app(cfg, auto_start_sessions=True)
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        root_res = await client.get("/")
        assert root_res.status_code == 200
        assert "text/html" in root_res.headers.get("content-type", "")
        health_res = await client.get("/health")
        assert health_res.status_code == 200
    await app.state.container.engine.shutdown()
