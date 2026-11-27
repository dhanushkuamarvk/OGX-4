"""End-to-end API integration tests covering state machine, interrupt during LLM call,
rollback after edit, locked/user-edited protection, SSE reconnect with Last-Event-ID replay,
adaptive autonomy transitions, baseline control app, and telemetry exports.
"""

from __future__ import annotations

import asyncio
import csv
import io
import json
import time
from collections.abc import AsyncIterator
from pathlib import Path

import httpx
import pytest

from backend.api.main import create_app
from backend.shared.config import Settings
from backend.shared.llm_client import LLMClient
from backend.shared.schemas import TELEMETRY_COLUMNS, ChatMessage, LLMStreamChunk


async def _wait_for_session_status(
    client: httpx.AsyncClient,
    session_id: str,
    target_statuses: set[str],
    timeout: float = 5.0,
) -> dict:
    deadline = asyncio.get_event_loop().time() + timeout
    last_data: dict = {}
    while asyncio.get_event_loop().time() < deadline:
        resp = await client.get(f"/sessions/{session_id}")
        assert resp.status_code == 200
        last_data = resp.json()
        if last_data["status"] in target_statuses:
            return last_data
        await asyncio.sleep(0.03)
    raise AssertionError(
        f"Timed out waiting for status in {target_statuses}; got {last_data.get('status')}"
    )


class SlowStepLLMClient(LLMClient):
    """LLM wrapper that pauses on a configurable step so we can interrupt mid-LLM call."""

    def __init__(self, settings: Settings) -> None:
        super().__init__(settings)
        self.step_stream_entered = asyncio.Event()
        self.block_streaming = True

    async def stream(
        self,
        messages: list[ChatMessage],
        system_prompt: str,
    ) -> AsyncIterator[LLMStreamChunk]:
        if self.block_streaming:
            self.step_stream_entered.set()
            yield LLMStreamChunk(delta="Partial streamed draft...", done=False)
            await asyncio.sleep(10.0)
            yield LLMStreamChunk(delta="unreachable", done=True)
            return
        async for chunk in super().stream(messages, system_prompt):
            yield chunk


@pytest.mark.asyncio
async def test_interrupt_during_inflight_llm_call_replan_and_resume(tmp_path: Path) -> None:
    cfg = Settings(
        llm_provider="mock",
        llm_model="mock-coplan-v1",
        coplan_step_delay_ms=0,
        db_path=str(tmp_path / "interrupt.db"),
        telemetry_dir=str(tmp_path / "logs"),
        tasks_path="eval/tasks/tasks.json",
    )
    app = create_app(cfg, auto_start_sessions=True)
    # Swap in our slow streaming client on the shared engine
    slow_llm = SlowStepLLMClient(cfg)
    engine = app.state.container.engine
    engine.llm_client = slow_llm
    engine.planner.llm_client = slow_llm
    engine.executor.llm_client = slow_llm

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        create_resp = await client.post(
            "/sessions",
            json={
                "task_id": "task_incident_postmortem",
                "participant_id": "P_INT",
                "condition": "coplan",
                "autonomy_level": "L3",
            },
        )
        assert create_resp.status_code == 200
        sid = create_resp.json()["session_id"]

        # Wait until executor is literally inside the in-flight LLM stream call
        await asyncio.wait_for(slow_llm.step_stream_entered.wait(), timeout=3.0)

        t0 = time.perf_counter()
        int_resp = await client.post(
            f"/sessions/{sid}/interrupt",
            json={"new_instruction": "Focus executive summary on SLA credits and latency impact."},
        )
        elapsed = time.perf_counter() - t0
        assert int_resp.status_code == 200
        assert elapsed < 1.5  # Cancelled the 10-second in-flight LLM call!

        int_data = int_resp.json()
        assert int_data["status"] == "paused"
        assert int_data["interrupted_step_id"] == "step_1"
        assert len(int_data["invalidated_step_ids"]) >= 1

        # Now allow fast execution and resume from the exact paused point
        slow_llm.block_streaming = False
        res_resp = await client.post(f"/sessions/{sid}/resume", json={})
        assert res_resp.status_code == 200
        assert res_resp.json()["status"] == "running"

        done_state = await _wait_for_session_status(client, sid, {"done"})
        assert done_state["status"] == "done"
        assert "step_1" in done_state["step_outputs"]

        await engine.shutdown()


@pytest.mark.asyncio
async def test_rollback_after_edit_preserves_log_and_restores_state(tmp_path: Path) -> None:
    cfg = Settings(
        llm_provider="mock",
        llm_model="mock-coplan-v1",
        coplan_step_delay_ms=0,
        db_path=str(tmp_path / "rollback.db"),
        telemetry_dir=str(tmp_path / "logs"),
        tasks_path="eval/tasks/tasks.json",
    )
    app = create_app(cfg, auto_start_sessions=True)
    transport = httpx.ASGITransport(app=app)

    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        # Run under L3 so all steps finish and save per-step checkpoints
        create_resp = await client.post(
            "/sessions",
            json={
                "task_id": "task_launch_plan",
                "participant_id": "P_RB",
                "condition": "coplan",
                "autonomy_level": "L3",
            },
        )
        sid = create_resp.json()["session_id"]
        done_state = await _wait_for_session_status(client, sid, {"done"})
        checkpoints = done_state["checkpoints"]
        # Pick checkpoint after step_1 completed (index 1: 0 is initial plan, 1 is step_1 done)
        target_cp = checkpoints[1]["checkpoint_id"]

        # Edit step_1 AND edit artifact directly
        step1_id = done_state["plan"]["steps"][0]["id"]
        edit_resp = await client.patch(
            f"/sessions/{sid}/steps/{step1_id}",
            json={"title": "Edited Title Before Rollback"},
        )
        assert edit_resp.status_code == 200

        latest = (await client.get(f"/sessions/{sid}")).json()
        art_resp = await client.patch(
            f"/sessions/{sid}/artifact",
            json={
                "content": latest["artifact"]["content"] + "\n## Temporary Bad Edit\n",
                "base_version": latest["artifact"]["version"],
            },
        )
        assert art_resp.status_code == 200
        assert "Temporary Bad Edit" in art_resp.json()["artifact"]["content"]

        # Roll back to checkpoint after step_1
        rb_resp = await client.post(
            f"/sessions/{sid}/rollback",
            json={"checkpoint_id": target_cp},
        )
        assert rb_resp.status_code == 200
        rb_data = rb_resp.json()
        assert rb_data["status"] == "rolled_back"
        assert rb_data["plan"]["steps"][0]["title"] != "Edited Title Before Rollback"
        assert "Temporary Bad Edit" not in rb_data["artifact"]["content"]
        assert "step_1" in rb_data["step_outputs"]
        assert "step_5" not in rb_data["step_outputs"]

        # Verify persistent rollback audit log in SQLite via REST
        rb_logs = (await client.get(f"/sessions/{sid}/rollbacks")).json()
        assert len(rb_logs) == 1
        assert rb_logs[0]["rollback_id"] == rb_data["rollback_id"]
        assert rb_logs[0]["target_checkpoint_id"] == target_cp

        # Verify full state persisted in SQLite survives cold reload
        persisted = app.state.container.db.get_session_state(sid)
        assert persisted is not None
        assert persisted.status == "rolled_back"
        assert "Temporary Bad Edit" not in persisted.artifact.content
        assert "step_1" in persisted.step_outputs

        await app.state.container.engine.shutdown()


@pytest.mark.asyncio
async def test_locked_and_user_edited_protection_and_sse_reconnect_replay(tmp_path: Path) -> None:
    cfg = Settings(
        llm_provider="mock",
        llm_model="mock-coplan-v1",
        coplan_step_delay_ms=0,
        sse_heartbeat_seconds=1.0,
        db_path=str(tmp_path / "replay.db"),
        telemetry_dir=str(tmp_path / "logs"),
        tasks_path="eval/tasks/tasks.json",
    )
    app = create_app(cfg, auto_start_sessions=True)
    transport = httpx.ASGITransport(app=app)

    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        # Start under L2 (pauses at low-confidence step_4)
        create_resp = await client.post(
            "/sessions",
            json={
                "task_id": "task_incident_postmortem",
                "participant_id": "P_SSE",
                "condition": "coplan",
                "autonomy_level": "L2",
            },
        )
        sid = create_resp.json()["session_id"]
        paused_state = await _wait_for_session_status(client, sid, {"paused", "done"})
        assert paused_state["status"] == "paused"  # Paused on L2 low-confidence gate for step_4!

        # Lock step_2 (Timeline) and user-edit step_1
        step1_id = paused_state["plan"]["steps"][0]["id"]
        step2_id = paused_state["plan"]["steps"][1]["id"]
        assert (await client.post(f"/sessions/{sid}/steps/{step2_id}/lock")).status_code == 200
        assert (
            await client.patch(
                f"/sessions/{sid}/steps/{step1_id}",
                json={"title": "Human-Owned Executive Summary"},
            )
        ).status_code == 200

        # Editing locked step_2 must fail with 409
        assert (
            await client.patch(
                f"/sessions/{sid}/steps/{step2_id}",
                json={"title": "Forbidden"},
            )
        ).status_code == 409

        # Inject requirement change -> BOTH locked step_2 and user-edited step_1 are preserved!
        req_resp = await client.post(
            f"/sessions/{sid}/requirement",
            json={"text": "Add SOC-2 audit controls and zero-downtime migration constraint."},
        )
        assert req_resp.status_code == 200
        req_data = req_resp.json()
        assert step2_id in req_data["preserved_locked_step_ids"]
        assert step1_id in req_data["preserved_edited_step_ids"]
        assert step2_id not in req_data["invalidated_step_ids"]
        assert step1_id not in req_data["invalidated_step_ids"]

        # Switch to L3 and finish session
        await client.post(f"/sessions/{sid}/autonomy", json={"level": "L3"})
        await client.post(f"/sessions/{sid}/resume", json={})
        done_state = await _wait_for_session_status(client, sid, {"done"})
        assert done_state["status"] == "done"

        # 1st SSE connection: read first 5 events then disconnect
        batch1: list[tuple[str, dict]] = []
        async with client.stream("GET", f"/sessions/{sid}/stream?max_events=5") as sse1:
            assert sse1.status_code == 200
            current_evt = ""
            async for line in sse1.aiter_lines():
                if line.startswith("event:"):
                    current_evt = line.split(":", 1)[1].strip()
                elif line.startswith("data:"):
                    batch1.append((current_evt, json.loads(line.split(":", 1)[1].strip())))
        assert len(batch1) == 5
        last_seq_batch1 = batch1[-1][1]["seq"]

        # 2nd SSE connection: reconnect with Last-Event-ID header and read rest until done!
        batch2: list[tuple[str, dict]] = []
        async with client.stream(
            "GET",
            f"/sessions/{sid}/stream?close_on_done=true",
            headers={"Last-Event-ID": str(last_seq_batch1)},
        ) as sse2:
            assert sse2.status_code == 200
            current_evt = ""
            async for line in sse2.aiter_lines():
                if line.startswith("event:"):
                    current_evt = line.split(":", 1)[1].strip()
                elif line.startswith("data:"):
                    batch2.append((current_evt, json.loads(line.split(":", 1)[1].strip())))

        all_events = batch1 + batch2
        seqs = [payload["seq"] for _, payload in all_events]
        # Strictly monotonic, zero gaps, zero duplicates!
        assert seqs == sorted(seqs)
        assert len(seqs) == len(set(seqs))
        assert batch2[0][1]["seq"] > last_seq_batch1
        assert all_events[-1][0] == "done"

        emitted_types = {evt for evt, _ in all_events}
        assert {
            "plan_created",
            "plan_patch",
            "step_started",
            "step_completed",
            "artifact_patch",
            "confidence_update",
            "checkpoint_saved",
            "requirement_changed",
            "autonomy_changed",
            "done",
        }.issubset(emitted_types)

        # Verify telemetry CSV schema & completeness
        csv_resp = await client.get(f"/sessions/{sid}/telemetry?format=csv")
        assert csv_resp.status_code == 200
        rows = list(csv.reader(io.StringIO(csv_resp.text)))
        assert tuple(rows[0]) == TELEMETRY_COLUMNS
        assert len(rows) > 10

        await app.state.container.engine.shutdown()


@pytest.mark.asyncio
async def test_adaptive_autonomy_transitions_over_api(tmp_path: Path) -> None:
    """Trigger real adaptive demotion (L3 -> L2) via API overrides and verify autonomy_changed SSE."""
    cfg = Settings(
        llm_provider="mock",
        llm_model="mock-coplan-v1",
        coplan_step_delay_ms=0,
        db_path=str(tmp_path / "adaptive_api.db"),
        telemetry_dir=str(tmp_path / "logs"),
        tasks_path="eval/tasks/tasks.json",
    )
    app = create_app(cfg, auto_start_sessions=True)
    transport = httpx.ASGITransport(app=app)

    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        create_resp = await client.post(
            "/sessions",
            json={
                "task_id": "task_launch_plan",
                "participant_id": "P_ADAPT",
                "condition": "coplan",
                "autonomy_level": "L3",
            },
        )
        sid = create_resp.json()["session_id"]
        state = await _wait_for_session_status(client, sid, {"done"})
        assert state["autonomy_level"] == "L3"

        # 5 completed agent steps already in window ([F,F,F,F,F]), actions_since_last_change == 5
        # Perform 4 overrides (user edits + rollbacks) so override rate in N=8 window > 0.40 (4/8 = 0.50)
        for i in range(4):
            cur = (await client.get(f"/sessions/{sid}")).json()
            resp = await client.patch(
                f"/sessions/{sid}/artifact",
                json={
                    "content": cur["artifact"]["content"] + f"\nEdit #{i}\n",
                    "base_version": cur["artifact"]["version"],
                },
            )
            assert resp.status_code == 200

        after = (await client.get(f"/sessions/{sid}")).json()
        assert after["autonomy_level"] == "L2"
        assert after["adaptive_state"]["override_rate"] > 0.4
        assert "L3 to L2" in after["adaptive_state"]["reason"]

        # Confirm autonomy_changed SSE event was persisted in SQLite SSE replay log
        sse_log = app.state.container.db.list_sse_events(sid, after_seq=0)
        autonomy_events = [e for e in sse_log if e.event == "autonomy_changed"]
        assert len(autonomy_events) >= 1
        assert autonomy_events[-1].data["previous_level"] == "L3"
        assert autonomy_events[-1].data["new_level"] == "L2"
        assert "override rate" in autonomy_events[-1].data["reason"].lower()

        await app.state.container.engine.shutdown()


@pytest.mark.asyncio
async def test_baseline_prompt_and_wait_and_standalone_app(tmp_path: Path) -> None:
    from backend.baseline.app import create_baseline_app
    from eval.notebooks.analyze_telemetry import load_events, summarize_sessions

    cfg = Settings(
        llm_provider="mock",
        llm_model="mock-coplan-v1",
        coplan_step_delay_ms=0,
        db_path=str(tmp_path / "baseline.db"),
        telemetry_dir=str(tmp_path / "logs"),
        tasks_path="eval/tasks/tasks.json",
    )
    app = create_app(cfg, auto_start_sessions=True)
    transport = httpx.ASGITransport(app=app)

    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        container = app.state.container
        assert container.engine.llm_client is container.baseline_service.llm_client

        sess_resp = await client.post(
            "/sessions",
            json={
                "task_id": "task_launch_plan",
                "participant_id": "P99",
                "condition": "baseline",
            },
        )
        assert sess_resp.status_code == 200
        sid = sess_resp.json()["session_id"]

        chat_resp = await client.post(
            f"/chat/{sid}",
            json={"message": "Draft the Enterprise AI Copilot launch & risk mitigation plan."},
        )
        assert chat_resp.status_code == 200
        body = chat_resp.json()
        assert body["role"] == "assistant"
        assert body["tokens_in"] > 0 and body["tokens_out"] > 0

        hist_resp = await client.get(f"/chat/{sid}/history")
        assert hist_resp.status_code == 200
        assert len(hist_resp.json()["messages"]) == 2
        await container.engine.shutdown()

    # Standalone baseline app + eval telemetry analyzer smoke check
    standalone_app = create_baseline_app(cfg)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=standalone_app),
        base_url="http://baseline-standalone",
    ) as client:
        s2 = (
            await client.post(
                "/sessions",
                json={
                    "task_id": "task_arch_migration",
                    "participant_id": "P77",
                    "condition": "baseline",
                },
            )
        ).json()["session_id"]
        c2 = await client.post(f"/chat/{s2}", json={"message": "Write ADR for event-driven migration."})
        assert c2.status_code == 200

    events = load_events(tmp_path / "logs")
    summaries = summarize_sessions(events)
    assert len(summaries) == 2
    assert all(s["condition"] == "baseline" for s in summaries)
