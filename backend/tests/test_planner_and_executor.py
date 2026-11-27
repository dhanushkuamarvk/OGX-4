"""Tests for hierarchical Planner, ambiguity calibration, locked/user-edited protection, and cancellable Executor."""

from __future__ import annotations

import asyncio
import time
from collections.abc import AsyncIterator

import pytest

from backend.agent.executor import (
    StepExecutor,
    merge_non_overlapping_artifact_edit,
    upsert_artifact_section,
)
from backend.agent.planner import Planner, calibrate_step_confidence
from backend.shared.config import Settings
from backend.shared.llm_client import LLMClient
from backend.shared.schemas import Artifact, ChatMessage, LLMStreamChunk


class SlowBlockingLLMClient(LLMClient):
    """Test double that blocks mid-stream inside an LLM call until cancelled."""

    def __init__(self, settings: Settings) -> None:
        super().__init__(settings)
        self.stream_started = asyncio.Event()
        self.stream_cancelled = False

    async def stream(
        self,
        messages: list[ChatMessage],
        system_prompt: str,
    ) -> AsyncIterator[LLMStreamChunk]:
        self.stream_started.set()
        yield LLMStreamChunk(delta="First partial chunk ", done=False)
        try:
            # Simulate a stalled/slow remote LLM call
            await asyncio.sleep(10.0)
            yield LLMStreamChunk(delta="Should never arrive", done=True)
        except asyncio.CancelledError:
            self.stream_cancelled = True
            raise


def test_confidence_calibration_penalizes_ambiguous_inputs() -> None:
    clear_conf = calibrate_step_confidence(
        title="Incident Timeline & UTC Detection Signals",
        description="Document exact UTC timestamps, p99 latency thresholds, owner SLAs, and checklist.",
        llm_confidence=0.85,
        task_prompt="Draft an engineering postmortem for a 47-minute checkout outage with clear SLAs and UTC timeline.",
        requirements=[],
    )
    ambiguous_conf = calibrate_step_confidence(
        title="Maybe Option TBD?",
        description="Unclear trade-off depending on unknown assumptions?",
        llm_confidence=0.85,
        task_prompt="Fix stuff?",
        requirements=["Add SOC-2 compliance"],
    )
    assert ambiguous_conf < clear_conf - 0.20


@pytest.mark.asyncio
async def test_planner_hierarchical_and_protects_locked_and_user_edited_steps(
    llm_client: LLMClient,
) -> None:
    planner = Planner(llm_client)
    res = await planner.create_plan(
        "Draft an engineering postmortem for a 47-minute checkout API outage.",
        requirements=[],
    )
    plan = res.plan
    # Verify hierarchical plan contains child substeps with parent_id
    assert any(s.parent_id is not None for s in plan.steps)

    # Mark all done; lock step_2 AND mark step_3_1 user_edited
    for s in plan.steps:
        s.status = "done"
    step_locked = plan.steps[1]
    step_locked.locked = True
    step_edited_target = plan.steps[3]

    # Editing locked step raises PermissionError
    with pytest.raises(PermissionError):
        planner.apply_user_step_edit(plan=plan, step_id=step_locked.id, title="Illegal")

    # User edits step_3_1 -> marks user_edited=True, invalidates unlocked downstream steps
    plan2, edited, invalidated = planner.apply_user_step_edit(
        plan=plan,
        step_id=step_edited_target.id,
        title="Custom User-Authored Diagnostic",
        description="Preserve my exact phrasing here.",
    )
    assert edited.user_edited is True
    assert step_locked.id not in invalidated

    # Mark edited step done so we verify replanning never overwrites OR invalidates it
    edited_in_plan2 = next(s for s in plan2.steps if s.id == edited.id)
    edited_in_plan2.status = "done"

    # 1. Mid-flight interrupt replan with new_instruction MUST NOT touch locked OR user_edited steps
    int_replan = await planner.replan_for_instruction(
        task_prompt="Postmortem outage",
        plan=plan2,
        new_instruction="Rewrite remediation and diagnostics to focus on PgBouncer.",
        interrupted_step_id=plan2.steps[4].id,
    )
    s_locked_after = next(s for s in int_replan.plan.steps if s.id == step_locked.id)
    s_edited_after = next(s for s in int_replan.plan.steps if s.id == edited.id)
    assert s_locked_after.status == "done" and s_locked_after.locked is True
    assert s_edited_after.status == "done" and s_edited_after.title == "Custom User-Authored Diagnostic"
    assert step_locked.id not in int_replan.invalidated_step_ids
    assert edited.id not in int_replan.invalidated_step_ids
    assert len(int_replan.invalidated_step_ids) >= 1

    # 2. Requirement change replan MUST ALSO preserve both locked and user-edited steps
    req_replan = await planner.replan_for_requirement(
        task_prompt="Postmortem outage",
        plan=plan2,
        requirement_text="Add SOC-2 audit evidence controls and zero-downtime migration.",
    )
    assert step_locked.id in req_replan.preserved_locked_step_ids
    assert edited.id in req_replan.preserved_edited_step_ids
    assert step_locked.id not in req_replan.invalidated_step_ids
    assert edited.id not in req_replan.invalidated_step_ids


@pytest.mark.asyncio
async def test_executor_cancels_inflight_llm_call_immediately() -> None:
    cfg = Settings(llm_provider="mock", llm_model="mock-coplan-v1", coplan_step_delay_ms=0)
    slow_client = SlowBlockingLLMClient(cfg)
    planner = Planner(slow_client)
    executor = StepExecutor(slow_client)

    plan = (await planner.create_plan("Postmortem outage", [])).plan
    artifact = Artifact(artifact_id="art_1", version=1, content="", last_editor="agent")
    interrupt_event = asyncio.Event()
    chunks_seen: list[str] = []

    async def on_progress(chunk: str, _pct: float) -> None:
        chunks_seen.append(chunk)

    t0 = time.perf_counter()
    exec_task = asyncio.create_task(
        executor.execute_step(
            task_prompt="Postmortem outage",
            step=plan.steps[0],
            plan=plan,
            artifact=artifact,
            requirements=[],
            active_instruction=None,
            interrupt_event=interrupt_event,
            on_progress=on_progress,
        )
    )
    await asyncio.wait_for(slow_client.stream_started.wait(), timeout=2.0)
    await asyncio.sleep(0.05)  # Now blocked inside `await asyncio.sleep(10.0)`
    interrupt_event.set()

    result = await asyncio.wait_for(exec_task, timeout=1.0)
    elapsed = time.perf_counter() - t0

    assert result.interrupted is True
    assert elapsed < 1.0  # Cancelled the 10-second in-flight LLM call immediately!
    assert len(chunks_seen) == 1


def test_artifact_section_upsert_and_three_way_merge() -> None:
    base, _ = upsert_artifact_section("", step_id="step_1", title="Intro", body="Base intro")
    base, _ = upsert_artifact_section(base, step_id="step_2", title="Plan", body="Base plan")

    server, _ = upsert_artifact_section(base, step_id="step_2", title="Plan", body="Agent updated plan")
    user, _ = upsert_artifact_section(base, step_id="step_1", title="Intro", body="Human revised intro")

    ok, merged = merge_non_overlapping_artifact_edit(
        base_content=base,
        server_content=server,
        user_content=user,
    )
    assert ok is True
    assert "Human revised intro" in merged
    assert "Agent updated plan" in merged

    user_conflict, _ = upsert_artifact_section(base, step_id="step_2", title="Plan", body="Human changed plan")
    ok_conflict, _ = merge_non_overlapping_artifact_edit(
        base_content=base,
        server_content=server,
        user_content=user_conflict,
    )
    assert ok_conflict is False
