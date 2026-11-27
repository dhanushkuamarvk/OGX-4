"""Tests for shared Pydantic schemas and 14-column telemetry JSONL + CSV exports."""

from __future__ import annotations

import csv
import io
import json
from typing import get_args

import pytest
from pydantic import ValidationError

from backend.shared.schemas import (
    TELEMETRY_COLUMNS,
    Artifact,
    AutonomyLevel,
    Plan,
    SessionStatus,
    SSEEventType,
    Step,
    TelemetryEvent,
)
from backend.shared.telemetry import TelemetryLogger


def test_shared_contract_models() -> None:
    step = Step(
        id="step_1",
        parent_id=None,
        title="Analyze Failure",
        description="Trace root cause.",
        status="pending",
        confidence=0.82,
        locked=False,
        user_edited=False,
        output_ref=None,
    )
    plan = Plan(plan_id="plan_1", version=1, steps=[step])
    artifact = Artifact(
        artifact_id="art_1",
        version=1,
        content="# Postmortem\n",
        last_editor="agent",
    )

    assert plan.steps[0].id == "step_1"
    assert artifact.last_editor == "agent"
    assert set(get_args(AutonomyLevel)) == {"L1", "L2", "L3"}
    assert {"idle", "planning", "running", "paused", "rolled_back", "done"}.issubset(
        set(get_args(SessionStatus))
    )

    with pytest.raises(ValidationError):
        Step(
            id="bad",
            title="Bad confidence",
            description="Out of range",
            confidence=1.5,
        )


def test_sse_event_types_match_contract() -> None:
    expected = {
        "plan_created",
        "plan_patch",
        "step_started",
        "step_progress",
        "step_completed",
        "step_failed",
        "artifact_patch",
        "confidence_update",
        "interrupt_ack",
        "checkpoint_saved",
        "rollback_done",
        "autonomy_changed",
        "requirement_changed",
        "done",
    }
    assert set(get_args(SSEEventType)) == expected


def test_telemetry_jsonl_and_csv_schema(telemetry: TelemetryLogger) -> None:
    telemetry.record(
        session_id="sess_1",
        participant_id="P01",
        condition="coplan",
        task_id="task_incident_postmortem",
        actor="user",
        event_type="step_lock",
        step_id="step_2",
        payload={"locked": True},
        latency_ms=12.5,
        tokens_in=100,
        tokens_out=40,
        autonomy_level="L2",
        checkpoint_id="cp_abc",
    )
    telemetry.record(
        session_id="sess_2",
        participant_id="P01",
        condition="baseline",
        task_id="task_launch_plan",
        actor="agent",
        event_type="baseline_assistant_response",
        payload={"turn_index": 2},
        latency_ms=340.0,
        tokens_in=500,
        tokens_out=620,
        autonomy_level="L2",
    )

    jsonl_text = telemetry.export_jsonl()
    lines = [line for line in jsonl_text.splitlines() if line.strip()]
    assert len(lines) == 2
    first = json.loads(lines[0])
    assert set(first.keys()) == set(TELEMETRY_COLUMNS)
    assert TelemetryEvent.model_validate(first).step_id == "step_2"

    csv_text = telemetry.export_csv()
    reader = csv.reader(io.StringIO(csv_text))
    rows = list(reader)
    assert tuple(rows[0]) == TELEMETRY_COLUMNS
    assert len(rows) == 3
    assert rows[1][1] == "sess_1"
    assert rows[1][12] == "L2"
    assert rows[2][3] == "baseline"
