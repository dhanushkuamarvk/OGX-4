"""Co-Plan Engine: explicit state machine, SSE replay bus, mid-flight control, checkpoints, and adaptive autonomy.

Session State Machine:
    idle -> planning -> running -> paused -> (running | rolled_back) -> done
"""

from __future__ import annotations

import asyncio
import contextlib
import time
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any

from backend.agent.adaptive import AdaptiveAutonomyController
from backend.agent.checkpoints import CheckpointManager
from backend.agent.executor import (
    StepExecutor,
    merge_non_overlapping_artifact_edit,
    upsert_artifact_section,
)
from backend.agent.planner import Planner
from backend.shared.db import Database
from backend.shared.llm_client import LLMClient
from backend.shared.schemas import (
    Actor,
    AdaptiveState,
    Artifact,
    ArtifactConflictDetail,
    ArtifactPatchPayload,
    AutonomyChangedPayload,
    AutonomyLevel,
    Checkpoint,
    CheckpointSavedPayload,
    Condition,
    ConfidenceUpdatePayload,
    CreateSessionRequest,
    DonePayload,
    InterruptAckPayload,
    InterruptResponse,
    PatchArtifactResponse,
    Plan,
    PlanCreatedPayload,
    PlanPatchPayload,
    RequirementChangedPayload,
    RequirementChangeResponse,
    ResumeResponse,
    RollbackDonePayload,
    RollbackResponse,
    SessionStateResponse,
    SessionStatus,
    SetAutonomyResponse,
    SSEEnvelope,
    SSEEventType,
    Step,
    StepCompletedPayload,
    StepExpandResponse,
    StepFailedPayload,
    StepLockResponse,
    StepProgressPayload,
    StepStartedPayload,
    UpdateStepResponse,
    utc_now_iso,
)
from backend.shared.tasks import TaskRepository
from backend.shared.telemetry import TelemetryLogger

# Explicit Session State Machine transition table
VALID_STATE_TRANSITIONS: dict[SessionStatus, set[SessionStatus]] = {
    "idle": {"idle", "planning", "running", "paused", "failed"},
    "planning": {"planning", "running", "paused", "failed"},
    "running": {"running", "paused", "rolled_back", "done", "failed"},
    "paused": {"paused", "running", "rolled_back", "done", "failed"},
    "rolled_back": {"rolled_back", "running", "paused", "done", "failed"},
    "done": {"done", "paused", "running", "rolled_back"},
    "failed": {"failed", "paused", "running", "rolled_back"},
}


class SessionNotFoundError(KeyError):
    """Raised when a session_id does not exist."""


class InvalidStateTransitionError(RuntimeError):
    """Raised on an illegal session state machine transition."""


class ArtifactVersionConflictError(Exception):
    """Raised when a user artifact edit conflicts with newer agent edits."""

    def __init__(self, detail: ArtifactConflictDetail) -> None:
        super().__init__(detail.message)
        self.detail = detail


@dataclass
class SessionRuntime:
    """In-memory live runtime state for an active session."""

    session_id: str
    task_id: str
    participant_id: str
    condition: Condition
    task_prompt: str
    status: SessionStatus
    adaptive_state: AdaptiveState
    plan: Plan
    artifact: Artifact
    step_outputs: dict[str, str] = field(default_factory=dict)
    requirements: list[str] = field(default_factory=list)
    active_instruction: str | None = None
    seq: int = 0
    created_at: str = field(default_factory=utc_now_iso)
    updated_at: str = field(default_factory=utc_now_iso)

    # Artifact version history (version -> content) for 3-way optimistic merge
    artifact_history: dict[int, str] = field(default_factory=dict)

    # Concurrency & SSE fan-out
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    interrupt_event: asyncio.Event = field(default_factory=asyncio.Event)
    runner_task: asyncio.Task[None] | None = None
    current_step_id: str | None = None
    event_log: list[SSEEnvelope] = field(default_factory=list)
    subscribers: set[asyncio.Queue[SSEEnvelope]] = field(default_factory=set)
    approved_step_ids: set[str] = field(default_factory=set)


class CoPlanEngine:
    """Central stateful orchestration engine for Co-Plan sessions."""

    def __init__(
        self,
        *,
        db: Database,
        llm_client: LLMClient,
        telemetry: TelemetryLogger,
        tasks: TaskRepository,
    ) -> None:
        self.db = db
        self.llm_client = llm_client
        self.telemetry = telemetry
        self.tasks = tasks
        self.checkpoints = CheckpointManager(db)
        self.adaptive = AdaptiveAutonomyController()
        self.planner = Planner(llm_client)
        self.executor = StepExecutor(llm_client)
        self._sessions: dict[str, SessionRuntime] = {}

    # ------------------------------------------------------------------
    # State Machine & Persistence Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _transition_status(rt: SessionRuntime, target: SessionStatus) -> None:
        allowed = VALID_STATE_TRANSITIONS[rt.status]
        if target not in allowed:
            raise InvalidStateTransitionError(
                f"Illegal session transition {rt.status!r} -> {target!r} for session '{rt.session_id}'."
            )
        rt.status = target

    def _persist(self, rt: SessionRuntime) -> None:
        rt.updated_at = self.db.upsert_session(
            session_id=rt.session_id,
            task_id=rt.task_id,
            participant_id=rt.participant_id,
            condition=rt.condition,
            status=rt.status,
            adaptive_state=rt.adaptive_state,
            plan=rt.plan,
            artifact=rt.artifact,
            step_outputs=rt.step_outputs,
            requirements=rt.requirements,
            active_instruction=rt.active_instruction,
            task_prompt=rt.task_prompt,
            seq=rt.seq,
            created_at=rt.created_at,
        )

    def _get_or_load_runtime(self, session_id: str) -> SessionRuntime:
        rt = self._sessions.get(session_id)
        if rt is not None:
            return rt
        row = self.db.get_session_row(session_id)
        if row is None:
            raise SessionNotFoundError(f"Session '{session_id}' not found.")
        state = self.db.get_session_state(session_id)
        assert state is not None
        persisted_events = self.db.list_sse_events(session_id, after_seq=0)
        rt = SessionRuntime(
            session_id=state.session_id,
            task_id=state.task_id,
            participant_id=state.participant_id,
            condition=state.condition,
            task_prompt=row["task_prompt"],
            status=state.status,
            adaptive_state=state.adaptive_state,
            plan=state.plan,
            artifact=state.artifact,
            step_outputs=dict(state.step_outputs),
            requirements=state.requirements,
            active_instruction=state.active_instruction,
            seq=state.seq,
            created_at=state.created_at,
            updated_at=state.updated_at,
            artifact_history={state.artifact.version: state.artifact.content},
            event_log=persisted_events,
        )
        self._sessions[session_id] = rt
        return rt

    def _next_seq(self, rt: SessionRuntime) -> int:
        rt.seq += 1
        return rt.seq

    def _emit_sse(
        self,
        rt: SessionRuntime,
        event_type: SSEEventType,
        payload_model: Any,
    ) -> SSEEnvelope:
        envelope = SSEEnvelope(
            event=event_type,
            data=payload_model.model_dump(mode="json"),
        )
        rt.event_log.append(envelope)
        self.db.insert_sse_event(rt.session_id, envelope)
        for queue in list(rt.subscribers):
            with contextlib.suppress(asyncio.QueueFull):
                queue.put_nowait(envelope)
        return envelope

    def _log_telemetry(
        self,
        rt: SessionRuntime,
        *,
        actor: Actor,
        event_type: str,
        step_id: str | None = None,
        payload: dict[str, Any] | None = None,
        latency_ms: float = 0.0,
        tokens_in: int = 0,
        tokens_out: int = 0,
        checkpoint_id: str | None = None,
    ) -> None:
        self.telemetry.record(
            session_id=rt.session_id,
            participant_id=rt.participant_id,
            condition=rt.condition,
            task_id=rt.task_id,
            actor=actor,
            event_type=event_type,
            step_id=step_id,
            payload=payload,
            latency_ms=latency_ms,
            tokens_in=tokens_in,
            tokens_out=tokens_out,
            autonomy_level=rt.adaptive_state.level,
            checkpoint_id=checkpoint_id,
        )

    def _save_and_broadcast_checkpoint(
        self,
        rt: SessionRuntime,
        *,
        label: str,
        actor: Actor = "system",
        step_id: str | None = None,
    ) -> Checkpoint:
        cp = self.checkpoints.save_checkpoint(
            session_id=rt.session_id,
            seq=rt.seq,
            label=label,
            plan=rt.plan,
            artifact=rt.artifact,
            step_outputs=rt.step_outputs,
            session_status=rt.status,
            requirements=rt.requirements,
            active_instruction=rt.active_instruction,
            adaptive_state=rt.adaptive_state,
            step_id=step_id,
        )
        seq = self._next_seq(rt)
        payload = CheckpointSavedPayload(
            session_id=rt.session_id,
            seq=seq,
            checkpoint=cp,
        )
        self._emit_sse(rt, "checkpoint_saved", payload)
        self._log_telemetry(
            rt,
            actor=actor,
            event_type="checkpoint_saved",
            step_id=step_id,
            payload={
                "label": label,
                "plan_version": cp.plan_version,
                "artifact_version": cp.artifact_version,
            },
            checkpoint_id=cp.checkpoint_id,
        )
        return cp

    def _broadcast_autonomy_if_changed(
        self,
        rt: SessionRuntime,
        *,
        changed: bool,
        previous_level: AutonomyLevel,
        actor: Actor = "system",
    ) -> None:
        if not changed:
            return
        seq = self._next_seq(rt)
        payload = AutonomyChangedPayload(
            session_id=rt.session_id,
            seq=seq,
            previous_level=previous_level,
            new_level=rt.adaptive_state.level,
            override_rate=rt.adaptive_state.override_rate,
            window_count=len(rt.adaptive_state.action_window),
            confidence_gate=rt.adaptive_state.confidence_gate,
            reason=rt.adaptive_state.reason,
        )
        self._emit_sse(rt, "autonomy_changed", payload)
        self._log_telemetry(
            rt,
            actor=actor,
            event_type="autonomy_changed",
            payload={
                "previous_level": previous_level,
                "new_level": rt.adaptive_state.level,
                "override_rate": rt.adaptive_state.override_rate,
                "window_count": len(rt.adaptive_state.action_window),
                "reason": rt.adaptive_state.reason,
            },
        )

    def _to_response(self, rt: SessionRuntime) -> SessionStateResponse:
        return SessionStateResponse(
            session_id=rt.session_id,
            task_id=rt.task_id,
            participant_id=rt.participant_id,
            condition=rt.condition,
            status=rt.status,
            autonomy_level=rt.adaptive_state.level,
            adaptive_state=rt.adaptive_state.model_copy(deep=True),
            plan=rt.plan.model_copy(deep=True),
            artifact=rt.artifact.model_copy(deep=True),
            step_outputs=dict(rt.step_outputs),
            checkpoints=self.checkpoints.list_checkpoints(rt.session_id),
            rollback_logs=self.checkpoints.list_rollback_logs(rt.session_id),
            requirements=list(rt.requirements),
            active_instruction=rt.active_instruction,
            seq=rt.seq,
            created_at=rt.created_at,
            updated_at=rt.updated_at,
        )

    # ------------------------------------------------------------------
    # Public API Operations
    # ------------------------------------------------------------------

    async def create_session(
        self,
        request: CreateSessionRequest,
        *,
        auto_start: bool = True,
    ) -> SessionStateResponse:
        session_id = f"sess_{uuid.uuid4().hex[:12]}"
        task_prompt = self.tasks.resolve_prompt(request.task_id, request.initial_prompt)
        adaptive_state = self.adaptive.initial_state(request.autonomy_level)

        plan = Plan(plan_id=f"plan_{uuid.uuid4().hex[:10]}", version=1, steps=[])
        artifact = Artifact(
            artifact_id=f"art_{uuid.uuid4().hex[:10]}",
            version=1,
            content="",
            last_editor="agent",
        )
        rt = SessionRuntime(
            session_id=session_id,
            task_id=request.task_id,
            participant_id=request.participant_id,
            condition=request.condition,
            task_prompt=task_prompt,
            status="idle",
            adaptive_state=adaptive_state,
            plan=plan,
            artifact=artifact,
            step_outputs={},
            artifact_history={1: ""},
        )
        self._sessions[session_id] = rt
        self._persist(rt)
        self._log_telemetry(
            rt,
            actor="user",
            event_type="session_created",
            payload={
                "task_id": request.task_id,
                "condition": request.condition,
                "autonomy_level": adaptive_state.level,
            },
        )

        if request.condition == "coplan" and auto_start:
            self._start_runner(rt)

        return self._to_response(rt)

    def get_session(self, session_id: str) -> SessionStateResponse:
        rt = self._get_or_load_runtime(session_id)
        return self._to_response(rt)

    def list_sessions(self) -> list[SessionStateResponse]:
        return self.db.list_sessions()

    def get_session_prompt(self, session_id: str) -> str:
        rt = self._get_or_load_runtime(session_id)
        return rt.task_prompt

    async def subscribe(
        self,
        session_id: str,
        last_seq: int = 0,
    ) -> AsyncIterator[SSEEnvelope]:
        """Stream SSE events with monotonic seq and gap-free Last-Event-ID replay."""
        rt = self._get_or_load_runtime(session_id)
        queue: asyncio.Queue[SSEEnvelope] = asyncio.Queue(maxsize=1000)
        rt.subscribers.add(queue)
        try:
            seen_seq = last_seq
            # Replay from SQLite + memory so even reloaded sessions never lose events
            replay_events = (
                rt.event_log
                if rt.event_log
                else self.db.list_sse_events(session_id, after_seq=last_seq)
            )
            for envelope in list(replay_events):
                seq = int(envelope.data.get("seq", 0))
                if seq > seen_seq:
                    seen_seq = seq
                    yield envelope

            while True:
                envelope = await queue.get()
                seq = int(envelope.data.get("seq", 0))
                if seq > seen_seq:
                    seen_seq = seq
                    yield envelope
        finally:
            rt.subscribers.discard(queue)

    # ------------------------------------------------------------------
    # Background Execution Runner
    # ------------------------------------------------------------------

    def _start_runner(self, rt: SessionRuntime) -> None:
        if rt.runner_task is not None and not rt.runner_task.done():
            return
        rt.interrupt_event.clear()
        rt.runner_task = asyncio.create_task(
            self._run_session_loop(rt),
            name=f"coplan-runner-{rt.session_id}",
        )

    async def _stop_runner(self, rt: SessionRuntime) -> str | None:
        """Cancel/stop any in-flight step execution immediately at the next safe boundary."""
        interrupted_step = rt.current_step_id
        rt.interrupt_event.set()
        task = rt.runner_task
        if task is not None and not task.done():
            try:
                await asyncio.wait_for(asyncio.shield(task), timeout=2.0)
            except asyncio.TimeoutError:
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await task
        rt.runner_task = None
        rt.current_step_id = None
        return interrupted_step

    def _select_next_executable_step(self, plan: Plan) -> Step | None:
        """Select the next dependency-ordered runnable leaf step (respecting hierarchy & locks)."""
        parent_ids_with_children = {
            s.parent_id for s in plan.steps if s.parent_id is not None
        }
        for step in plan.steps:
            if step.id in parent_ids_with_children:
                continue
            if step.locked and step.status == "done":
                continue
            if step.status in {"pending", "invalidated"}:
                return step
        return None

    def _sync_parent_step_statuses(self, plan: Plan) -> list[str]:
        """Mark parent steps `done` once all child substeps are completed/skipped."""
        changed: list[str] = []
        children_by_parent: dict[str, list[Step]] = {}
        for s in plan.steps:
            if s.parent_id is not None:
                children_by_parent.setdefault(s.parent_id, []).append(s)

        for step in plan.steps:
            kids = children_by_parent.get(step.id)
            if not kids:
                continue
            if all(k.status in {"done", "skipped"} for k in kids) and step.status != "done":
                step.status = "done"
                step.output_ref = f"artifact:v{plan.version}#{step.id}"
                changed.append(step.id)
            elif any(k.status in {"pending", "invalidated", "running"} for k in kids) and step.status == "done" and not step.locked:
                step.status = "pending"
                changed.append(step.id)
        return changed

    async def _run_session_loop(self, rt: SessionRuntime) -> None:
        try:
            # 1. Planning phase: idle -> planning -> running
            if not rt.plan.steps:
                async with rt.lock:
                    self._transition_status(rt, "planning")
                    self._persist(rt)

                plan_task = asyncio.create_task(
                    self.planner.create_plan(
                        task_prompt=rt.task_prompt,
                        requirements=rt.requirements,
                    )
                )
                interrupt_waiter = asyncio.create_task(rt.interrupt_event.wait())
                done_tasks, _ = await asyncio.wait(
                    {plan_task, interrupt_waiter},
                    return_when=asyncio.FIRST_COMPLETED,
                )
                if interrupt_waiter in done_tasks:
                    if not plan_task.done():
                        plan_task.cancel()
                        with contextlib.suppress(asyncio.CancelledError):
                            await plan_task
                    async with rt.lock:
                        self._transition_status(rt, "paused")
                        self._persist(rt)
                    return
                interrupt_waiter.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await interrupt_waiter
                try:
                    plan_result = plan_task.result()
                except Exception as exc:
                    async with rt.lock:
                        self._transition_status(rt, "failed")
                        seq_f = self._next_seq(rt)
                        self._emit_sse(
                            rt,
                            "step_failed",
                            StepFailedPayload(
                                session_id=rt.session_id,
                                seq=seq_f,
                                step_id="planner",
                                error=str(exc),
                                recoverable=True,
                            ),
                        )
                        self._log_telemetry(
                            rt,
                            actor="agent",
                            event_type="step_failed",
                            step_id="planner",
                            payload={"error": str(exc)},
                        )
                        self._persist(rt)
                    return

                async with rt.lock:
                    if plan_result.parse_failed:
                        seq_f = self._next_seq(rt)
                        self._emit_sse(
                            rt,
                            "step_failed",
                            StepFailedPayload(
                                session_id=rt.session_id,
                                seq=seq_f,
                                step_id="planner",
                                error=plan_result.parse_error or "Malformed planner JSON output.",
                                recoverable=True,
                            ),
                        )
                        self._log_telemetry(
                            rt,
                            actor="agent",
                            event_type="step_failed",
                            step_id="planner",
                            payload={
                                "error": plan_result.parse_error,
                                "repair_attempted": plan_result.repair_attempted,
                                "fallback_used": True,
                            },
                        )

                    rt.plan = plan_result.plan
                    self._transition_status(rt, "running")
                    seq = self._next_seq(rt)
                    self._emit_sse(
                        rt,
                        "plan_created",
                        PlanCreatedPayload(
                            session_id=rt.session_id,
                            seq=seq,
                            plan=rt.plan.model_copy(deep=True),
                        ),
                    )
                    self._log_telemetry(
                        rt,
                        actor="agent",
                        event_type="plan_created",
                        payload={"plan_id": rt.plan.plan_id, "step_count": len(rt.plan.steps)},
                        latency_ms=plan_result.latency_ms,
                        tokens_in=plan_result.tokens_in,
                        tokens_out=plan_result.tokens_out,
                    )
                    self._save_and_broadcast_checkpoint(
                        rt,
                        label="Initial plan created",
                        actor="agent",
                    )
                    self._persist(rt)

            # 2. Dependency-ordered step execution loop
            while not rt.interrupt_event.is_set():
                async with rt.lock:
                    parent_updates = self._sync_parent_step_statuses(rt.plan)
                    if parent_updates:
                        rt.plan.version += 1
                        seq = self._next_seq(rt)
                        self._emit_sse(
                            rt,
                            "plan_patch",
                            PlanPatchPayload(
                                session_id=rt.session_id,
                                seq=seq,
                                plan=rt.plan.model_copy(deep=True),
                                reason="parent_steps_completed",
                                changed_step_ids=parent_updates,
                            ),
                        )

                    next_step = self._select_next_executable_step(rt.plan)
                    if next_step is None:
                        self._transition_status(rt, "done")
                        rt.current_step_id = None
                        self._persist(rt)
                        cp = self._save_and_broadcast_checkpoint(
                            rt,
                            label="Session done",
                            actor="agent",
                        )
                        completed_titles = [s.title for s in rt.plan.steps if s.status == "done"]
                        summary = (
                            f"[{rt.adaptive_state.level} summary] Completed {len(completed_titles)} steps "
                            f"(artifact v{rt.artifact.version}, {len(rt.artifact.content.split())} words): "
                            + "; ".join(completed_titles[:5])
                        )
                        seq = self._next_seq(rt)
                        self._emit_sse(
                            rt,
                            "done",
                            DonePayload(
                                session_id=rt.session_id,
                                seq=seq,
                                status="done",
                                summary=summary,
                                plan_version=rt.plan.version,
                                artifact_version=rt.artifact.version,
                                autonomy_level=rt.adaptive_state.level,
                            ),
                        )
                        self._log_telemetry(
                            rt,
                            actor="agent",
                            event_type="done",
                            payload={
                                "plan_version": rt.plan.version,
                                "artifact_version": rt.artifact.version,
                                "completed_steps": len(completed_titles),
                                "summary": summary,
                            },
                            checkpoint_id=cp.checkpoint_id,
                        )
                        return

                    # Adaptive autonomy gate (L1 asks before every step, L2 before low-confidence steps, L3 runs freely)
                    if next_step.id not in rt.approved_step_ids:
                        should_pause, pause_reason = self.adaptive.should_pause_for_human(
                            rt.adaptive_state,
                            next_step,
                        )
                        if should_pause:
                            self._transition_status(rt, "paused")
                            rt.current_step_id = None
                            seq = self._next_seq(rt)
                            self._emit_sse(
                                rt,
                                "confidence_update",
                                ConfidenceUpdatePayload(
                                    session_id=rt.session_id,
                                    seq=seq,
                                    step_id=next_step.id,
                                    confidence=next_step.confidence,
                                    previous_confidence=next_step.confidence,
                                    requires_approval=True,
                                    reason=pause_reason,
                                ),
                            )
                            self._log_telemetry(
                                rt,
                                actor="system",
                                event_type="confidence_gate_pause",
                                step_id=next_step.id,
                                payload={
                                    "confidence": next_step.confidence,
                                    "gate": rt.adaptive_state.confidence_gate,
                                    "reason": pause_reason,
                                },
                            )
                            self._persist(rt)
                            return

                    next_step.status = "running"
                    self._transition_status(rt, "running")
                    rt.current_step_id = next_step.id
                    step_snapshot = next_step.model_copy(deep=True)
                    plan_snapshot = rt.plan.model_copy(deep=True)
                    artifact_snapshot = rt.artifact.model_copy(deep=True)
                    reqs_snapshot = list(rt.requirements)
                    instr_snapshot = rt.active_instruction

                    seq = self._next_seq(rt)
                    self._emit_sse(
                        rt,
                        "step_started",
                        StepStartedPayload(
                            session_id=rt.session_id,
                            seq=seq,
                            step_id=next_step.id,
                            title=next_step.title,
                            confidence=next_step.confidence,
                        ),
                    )
                    self._log_telemetry(
                        rt,
                        actor="agent",
                        event_type="step_started",
                        step_id=next_step.id,
                        payload={"title": next_step.title, "confidence": next_step.confidence},
                    )
                    self._persist(rt)

                # Execute outside rt.lock so human interrupts / edits never block
                async def _on_progress(chunk: str, pct: float) -> None:
                    seq_p = self._next_seq(rt)
                    self._emit_sse(
                        rt,
                        "step_progress",
                        StepProgressPayload(
                            session_id=rt.session_id,
                            seq=seq_p,
                            step_id=step_snapshot.id,
                            chunk=chunk,
                            progress_pct=pct,
                        ),
                    )

                try:
                    exec_result = await self.executor.execute_step(
                        task_prompt=rt.task_prompt,
                        step=step_snapshot,
                        plan=plan_snapshot,
                        artifact=artifact_snapshot,
                        requirements=reqs_snapshot,
                        active_instruction=instr_snapshot,
                        interrupt_event=rt.interrupt_event,
                        on_progress=_on_progress,
                    )
                except Exception as exc:
                    async with rt.lock:
                        live_step = next((s for s in rt.plan.steps if s.id == step_snapshot.id), None)
                        if live_step is not None:
                            live_step.status = "failed"
                        self._transition_status(rt, "failed")
                        rt.current_step_id = None
                        seq_f = self._next_seq(rt)
                        self._emit_sse(
                            rt,
                            "step_failed",
                            StepFailedPayload(
                                session_id=rt.session_id,
                                seq=seq_f,
                                step_id=step_snapshot.id,
                                error=str(exc),
                                recoverable=True,
                            ),
                        )
                        self._log_telemetry(
                            rt,
                            actor="agent",
                            event_type="step_failed",
                            step_id=step_snapshot.id,
                            payload={"error": str(exc)},
                        )
                        self._persist(rt)
                    return

                async with rt.lock:
                    live_step = next((s for s in rt.plan.steps if s.id == step_snapshot.id), None)
                    rt.current_step_id = None

                    if exec_result.interrupted or rt.interrupt_event.is_set():
                        if live_step is not None and live_step.status == "running":
                            live_step.status = "pending"
                        self._transition_status(rt, "paused")
                        self._persist(rt)
                        return

                    if live_step is None:
                        continue

                    merged_content, heading = upsert_artifact_section(
                        rt.artifact.content,
                        step_id=live_step.id,
                        title=live_step.title,
                        body=exec_result.section_body,
                        is_substep=live_step.parent_id is not None,
                    )
                    rt.artifact = Artifact(
                        artifact_id=rt.artifact.artifact_id,
                        version=rt.artifact.version + 1,
                        content=merged_content,
                        last_editor="agent",
                    )
                    rt.artifact_history[rt.artifact.version] = rt.artifact.content
                    rt.step_outputs[live_step.id] = exec_result.section_body

                    prev_conf = live_step.confidence
                    live_step.confidence = exec_result.updated_confidence
                    live_step.status = "done"
                    live_step.output_ref = f"artifact:v{rt.artifact.version}#{live_step.id}"
                    rt.approved_step_ids.discard(live_step.id)

                    seq_a = self._next_seq(rt)
                    self._emit_sse(
                        rt,
                        "artifact_patch",
                        ArtifactPatchPayload(
                            session_id=rt.session_id,
                            seq=seq_a,
                            artifact=rt.artifact.model_copy(deep=True),
                            step_id=live_step.id,
                            section_heading=heading,
                            summary=f"Agent updated section '{live_step.title}'.",
                        ),
                    )
                    self._log_telemetry(
                        rt,
                        actor="agent",
                        event_type="artifact_patch",
                        step_id=live_step.id,
                        payload={"artifact_version": rt.artifact.version, "section": heading},
                    )

                    seq_c = self._next_seq(rt)
                    self._emit_sse(
                        rt,
                        "confidence_update",
                        ConfidenceUpdatePayload(
                            session_id=rt.session_id,
                            seq=seq_c,
                            step_id=live_step.id,
                            confidence=live_step.confidence,
                            previous_confidence=prev_conf,
                            requires_approval=False,
                            reason="Post-execution constraint audit calibration.",
                        ),
                    )

                    seq_s = self._next_seq(rt)
                    self._emit_sse(
                        rt,
                        "step_completed",
                        StepCompletedPayload(
                            session_id=rt.session_id,
                            seq=seq_s,
                            step=live_step.model_copy(deep=True),
                            latency_ms=exec_result.latency_ms,
                            tokens_in=exec_result.tokens_in,
                            tokens_out=exec_result.tokens_out,
                        ),
                    )
                    self._log_telemetry(
                        rt,
                        actor="agent",
                        event_type="step_completed",
                        step_id=live_step.id,
                        payload={"confidence": live_step.confidence, "output_ref": live_step.output_ref},
                        latency_ms=exec_result.latency_ms,
                        tokens_in=exec_result.tokens_in,
                        tokens_out=exec_result.tokens_out,
                    )

                    # Save full checkpoint (plan + artifact + step outputs) after each completed step
                    self._save_and_broadcast_checkpoint(
                        rt,
                        label=f"Completed: {live_step.title}",
                        actor="agent",
                        step_id=live_step.id,
                    )

                    # Record accepted agent action in adaptive autonomy window
                    transition = self.adaptive.record_agent_step(rt.adaptive_state)
                    rt.adaptive_state = transition.state
                    self._broadcast_autonomy_if_changed(
                        rt,
                        changed=transition.changed,
                        previous_level=transition.previous_level,
                        actor="system",
                    )

                    # Persist full state in SQLite after every step
                    self._persist(rt)
        except asyncio.CancelledError:
            async with rt.lock:
                self._transition_status(rt, "paused")
                rt.current_step_id = None
                self._persist(rt)
            raise

    # ------------------------------------------------------------------
    # Human Mid-Flight Control Operations
    # ------------------------------------------------------------------

    async def interrupt(
        self,
        session_id: str,
        new_instruction: str | None = None,
    ) -> InterruptResponse:
        rt = self._get_or_load_runtime(session_id)
        interrupted_step_id = await self._stop_runner(rt)

        cleaned_instruction = (
            new_instruction.strip()
            if new_instruction is not None and new_instruction.strip()
            else None
        )

        # Snapshot before optional targeted replanning
        async with rt.lock:
            if interrupted_step_id:
                step = next((s for s in rt.plan.steps if s.id == interrupted_step_id), None)
                if step is not None and step.status == "running":
                    step.status = "pending"
            self._transition_status(rt, "paused")
            plan_snapshot = rt.plan.model_copy(deep=True)
            task_prompt = rt.task_prompt

        replan_result = None
        if cleaned_instruction and plan_snapshot.steps:
            replan_result = await self.planner.replan_for_instruction(
                task_prompt=task_prompt,
                plan=plan_snapshot,
                new_instruction=cleaned_instruction,
                interrupted_step_id=interrupted_step_id,
            )

        async with rt.lock:
            invalidated_ids: list[str] = []
            preserved_ids: list[str] = []

            if cleaned_instruction is not None:
                rt.active_instruction = cleaned_instruction

            if replan_result is not None:
                rt.plan = replan_result.plan
                invalidated_ids = replan_result.invalidated_step_ids
                preserved_ids = list(
                    dict.fromkeys(
                        [
                            *replan_result.preserved_locked_step_ids,
                            *replan_result.preserved_edited_step_ids,
                        ]
                    )
                )
                seq_p = self._next_seq(rt)
                self._emit_sse(
                    rt,
                    "plan_patch",
                    PlanPatchPayload(
                        session_id=rt.session_id,
                        seq=seq_p,
                        plan=rt.plan.model_copy(deep=True),
                        reason="interrupt_replan",
                        changed_step_ids=invalidated_ids,
                    ),
                )

            interrupt_id = f"int_{uuid.uuid4().hex[:8]}"
            cp = self._save_and_broadcast_checkpoint(
                rt,
                label="Paused by human interrupt",
                actor="user",
                step_id=interrupted_step_id,
            )

            seq = self._next_seq(rt)
            self._emit_sse(
                rt,
                "interrupt_ack",
                InterruptAckPayload(
                    session_id=rt.session_id,
                    seq=seq,
                    interrupt_id=interrupt_id,
                    new_instruction=rt.active_instruction,
                    interrupted_step_id=interrupted_step_id,
                    invalidated_step_ids=invalidated_ids,
                    preserved_step_ids=preserved_ids,
                    status=rt.status,
                ),
            )
            self._log_telemetry(
                rt,
                actor="user",
                event_type="interrupt",
                step_id=interrupted_step_id,
                payload={
                    "interrupt_id": interrupt_id,
                    "new_instruction": rt.active_instruction,
                    "invalidated_step_ids": invalidated_ids,
                    "preserved_step_ids": preserved_ids,
                },
                latency_ms=replan_result.latency_ms if replan_result else 0.0,
                tokens_in=replan_result.tokens_in if replan_result else 0,
                tokens_out=replan_result.tokens_out if replan_result else 0,
                checkpoint_id=cp.checkpoint_id,
            )

            # Mid-flight interrupt counts as a rejected/overridden step in adaptive autonomy
            transition = self.adaptive.record_rejected_step(rt.adaptive_state)
            rt.adaptive_state = transition.state
            self._broadcast_autonomy_if_changed(
                rt,
                changed=transition.changed,
                previous_level=transition.previous_level,
                actor="system",
            )
            self._persist(rt)

            return InterruptResponse(
                session_id=rt.session_id,
                interrupt_id=interrupt_id,
                status=rt.status,
                new_instruction=rt.active_instruction,
                interrupted_step_id=interrupted_step_id,
                invalidated_step_ids=invalidated_ids,
                preserved_step_ids=preserved_ids,
                plan=rt.plan.model_copy(deep=True),
                checkpoint_id=cp.checkpoint_id,
            )

    async def resume(
        self,
        session_id: str,
        instruction: str | None = None,
    ) -> ResumeResponse:
        rt = self._get_or_load_runtime(session_id)

        async with rt.lock:
            if instruction is not None and instruction.strip():
                rt.active_instruction = instruction.strip()

            next_step = self._select_next_executable_step(rt.plan)
            if next_step is not None:
                rt.approved_step_ids.add(next_step.id)

            self._transition_status(rt, "running")
            self._log_telemetry(
                rt,
                actor="user",
                event_type="resume",
                step_id=next_step.id if next_step else None,
                payload={"instruction": rt.active_instruction},
            )
            self._persist(rt)

        self._start_runner(rt)
        return ResumeResponse(
            session_id=rt.session_id,
            status=rt.status,
            next_step_id=next_step.id if next_step else None,
        )

    async def set_step_lock(
        self,
        session_id: str,
        step_id: str,
        *,
        locked: bool,
    ) -> StepLockResponse:
        rt = self._get_or_load_runtime(session_id)
        async with rt.lock:
            step = next((s for s in rt.plan.steps if s.id == step_id), None)
            if step is None:
                raise KeyError(f"Step '{step_id}' not found.")

            step.locked = locked
            rt.plan.version += 1

            seq = self._next_seq(rt)
            self._emit_sse(
                rt,
                "plan_patch",
                PlanPatchPayload(
                    session_id=rt.session_id,
                    seq=seq,
                    plan=rt.plan.model_copy(deep=True),
                    reason="step_locked" if locked else "step_unlocked",
                    changed_step_ids=[step_id],
                ),
            )
            cp = self._save_and_broadcast_checkpoint(
                rt,
                label=f"{'Locked' if locked else 'Unlocked'}: {step.title}",
                actor="user",
                step_id=step_id,
            )
            self._log_telemetry(
                rt,
                actor="user",
                event_type="step_lock" if locked else "step_unlock",
                step_id=step_id,
                payload={"locked": locked, "plan_version": rt.plan.version},
                checkpoint_id=cp.checkpoint_id,
            )
            self._persist(rt)

            return StepLockResponse(
                session_id=rt.session_id,
                step=step.model_copy(deep=True),
                plan_version=rt.plan.version,
                checkpoint_id=cp.checkpoint_id,
            )

    async def expand_step(
        self,
        session_id: str,
        step_id: str,
        instruction: str | None = None,
    ) -> StepExpandResponse:
        rt = self._get_or_load_runtime(session_id)
        async with rt.lock:
            plan_snapshot = rt.plan.model_copy(deep=True)
            prompt = rt.task_prompt

        expansion = await self.planner.expand_step(
            task_prompt=prompt,
            plan=plan_snapshot,
            step_id=step_id,
            instruction=instruction,
        )

        async with rt.lock:
            rt.plan = expansion.plan
            seq = self._next_seq(rt)
            self._emit_sse(
                rt,
                "plan_patch",
                PlanPatchPayload(
                    session_id=rt.session_id,
                    seq=seq,
                    plan=rt.plan.model_copy(deep=True),
                    reason="step_expanded",
                    changed_step_ids=[step_id, *[s.id for s in expansion.substeps]],
                ),
            )
            cp = self._save_and_broadcast_checkpoint(
                rt,
                label=f"Expanded step: {step_id}",
                actor="user",
                step_id=step_id,
            )
            self._log_telemetry(
                rt,
                actor="user",
                event_type="step_expand",
                step_id=step_id,
                payload={
                    "substep_ids": [s.id for s in expansion.substeps],
                    "instruction": instruction,
                },
                latency_ms=expansion.latency_ms,
                tokens_in=expansion.tokens_in,
                tokens_out=expansion.tokens_out,
                checkpoint_id=cp.checkpoint_id,
            )
            self._persist(rt)

            return StepExpandResponse(
                session_id=rt.session_id,
                parent_step_id=step_id,
                substeps=expansion.substeps,
                plan=rt.plan.model_copy(deep=True),
                checkpoint_id=cp.checkpoint_id,
            )

    async def edit_step(
        self,
        session_id: str,
        step_id: str,
        *,
        title: str | None = None,
        description: str | None = None,
    ) -> UpdateStepResponse:
        rt = self._get_or_load_runtime(session_id)
        if rt.current_step_id == step_id:
            await self._stop_runner(rt)

        async with rt.lock:
            updated_plan, edited_step, invalidated_ids = self.planner.apply_user_step_edit(
                plan=rt.plan,
                step_id=step_id,
                title=title,
                description=description,
            )
            rt.plan = updated_plan
            if rt.status == "done":
                self._transition_status(rt, "paused")

            seq = self._next_seq(rt)
            self._emit_sse(
                rt,
                "plan_patch",
                PlanPatchPayload(
                    session_id=rt.session_id,
                    seq=seq,
                    plan=rt.plan.model_copy(deep=True),
                    reason="step_edited",
                    changed_step_ids=[step_id, *invalidated_ids],
                ),
            )
            cp = self._save_and_broadcast_checkpoint(
                rt,
                label=f"User edited: {edited_step.title}",
                actor="user",
                step_id=step_id,
            )
            self._log_telemetry(
                rt,
                actor="user",
                event_type="step_edited",
                step_id=step_id,
                payload={
                    "title": edited_step.title,
                    "invalidated_step_ids": invalidated_ids,
                },
                checkpoint_id=cp.checkpoint_id,
            )

            transition = self.adaptive.record_user_edit(rt.adaptive_state)
            rt.adaptive_state = transition.state
            self._broadcast_autonomy_if_changed(
                rt,
                changed=transition.changed,
                previous_level=transition.previous_level,
                actor="system",
            )
            self._persist(rt)

            return UpdateStepResponse(
                session_id=rt.session_id,
                step=edited_step.model_copy(deep=True),
                plan=rt.plan.model_copy(deep=True),
                invalidated_step_ids=invalidated_ids,
                checkpoint_id=cp.checkpoint_id,
            )

    async def patch_artifact(
        self,
        session_id: str,
        *,
        content: str,
        base_version: int,
    ) -> PatchArtifactResponse:
        rt = self._get_or_load_runtime(session_id)
        async with rt.lock:
            merged = False
            final_content = content

            if base_version != rt.artifact.version:
                base_content = rt.artifact_history.get(base_version)
                if base_content is not None and base_version < rt.artifact.version:
                    ok, merged_content = merge_non_overlapping_artifact_edit(
                        base_content=base_content,
                        server_content=rt.artifact.content,
                        user_content=content,
                    )
                    if ok:
                        final_content = merged_content
                        merged = True
                    else:
                        raise ArtifactVersionConflictError(
                            ArtifactConflictDetail(
                                message=(
                                    f"Artifact conflict: your base_version ({base_version}) overlaps "
                                    f"with newer server changes (v{rt.artifact.version})."
                                ),
                                base_version=base_version,
                                current_version=rt.artifact.version,
                                current_artifact=rt.artifact.model_copy(deep=True),
                            )
                        )
                else:
                    raise ArtifactVersionConflictError(
                        ArtifactConflictDetail(
                            message=(
                                f"Artifact version mismatch: expected v{rt.artifact.version}, "
                                f"got base_version={base_version}."
                            ),
                            base_version=base_version,
                            current_version=rt.artifact.version,
                            current_artifact=rt.artifact.model_copy(deep=True),
                        )
                    )

            rt.artifact = Artifact(
                artifact_id=rt.artifact.artifact_id,
                version=rt.artifact.version + 1,
                content=final_content,
                last_editor="user",
            )
            rt.artifact_history[rt.artifact.version] = rt.artifact.content

            seq = self._next_seq(rt)
            self._emit_sse(
                rt,
                "artifact_patch",
                ArtifactPatchPayload(
                    session_id=rt.session_id,
                    seq=seq,
                    artifact=rt.artifact.model_copy(deep=True),
                    summary="Human edited shared artifact" + (" (auto-merged)" if merged else ""),
                ),
            )
            cp = self._save_and_broadcast_checkpoint(
                rt,
                label=f"Human artifact edit (v{rt.artifact.version})",
                actor="user",
            )
            self._log_telemetry(
                rt,
                actor="user",
                event_type="artifact_edited",
                payload={
                    "base_version": base_version,
                    "new_version": rt.artifact.version,
                    "merged": merged,
                    "char_count": len(final_content),
                },
                checkpoint_id=cp.checkpoint_id,
            )

            transition = self.adaptive.record_user_edit(rt.adaptive_state)
            rt.adaptive_state = transition.state
            self._broadcast_autonomy_if_changed(
                rt,
                changed=transition.changed,
                previous_level=transition.previous_level,
                actor="system",
            )
            self._persist(rt)

            return PatchArtifactResponse(
                session_id=rt.session_id,
                artifact=rt.artifact.model_copy(deep=True),
                merged=merged,
                conflict=False,
                checkpoint_id=cp.checkpoint_id,
            )

    async def rollback(
        self,
        session_id: str,
        checkpoint_id: str,
    ) -> RollbackResponse:
        rt = self._get_or_load_runtime(session_id)
        await self._stop_runner(rt)

        snapshot = self.checkpoints.load_snapshot(session_id, checkpoint_id)

        async with rt.lock:
            from_plan_ver = rt.plan.version
            from_art_ver = rt.artifact.version

            rt.plan = snapshot.plan.model_copy(deep=True)
            rt.artifact = snapshot.artifact.model_copy(deep=True)
            rt.step_outputs = dict(snapshot.step_outputs)
            rt.artifact_history[rt.artifact.version] = rt.artifact.content
            rt.requirements = list(snapshot.requirements)
            rt.active_instruction = snapshot.active_instruction
            rt.approved_step_ids.clear()
            self._transition_status(rt, "rolled_back")

            # Preserve permanent rollback audit entry in SQLite
            rb_entry = self.checkpoints.record_rollback(
                session_id=rt.session_id,
                target_checkpoint_id=checkpoint_id,
                from_plan_version=from_plan_ver,
                to_plan_version=rt.plan.version,
                from_artifact_version=from_art_ver,
                to_artifact_version=rt.artifact.version,
            )

            # Record rollback override in adaptive autonomy layer
            transition = self.adaptive.record_rollback(rt.adaptive_state)
            rt.adaptive_state = transition.state

            seq_r = self._next_seq(rt)
            self._emit_sse(
                rt,
                "rollback_done",
                RollbackDonePayload(
                    session_id=rt.session_id,
                    seq=seq_r,
                    rollback_id=rb_entry.rollback_id,
                    checkpoint_id=checkpoint_id,
                    plan=rt.plan.model_copy(deep=True),
                    artifact=rt.artifact.model_copy(deep=True),
                    step_outputs=dict(rt.step_outputs),
                    autonomy_level=rt.adaptive_state.level,
                    status=rt.status,
                ),
            )
            seq_p = self._next_seq(rt)
            self._emit_sse(
                rt,
                "plan_patch",
                PlanPatchPayload(
                    session_id=rt.session_id,
                    seq=seq_p,
                    plan=rt.plan.model_copy(deep=True),
                    reason=f"rollback:{checkpoint_id}",
                ),
            )
            seq_a = self._next_seq(rt)
            self._emit_sse(
                rt,
                "artifact_patch",
                ArtifactPatchPayload(
                    session_id=rt.session_id,
                    seq=seq_a,
                    artifact=rt.artifact.model_copy(deep=True),
                    summary=f"Rolled back to checkpoint {checkpoint_id}",
                ),
            )
            self._broadcast_autonomy_if_changed(
                rt,
                changed=transition.changed,
                previous_level=transition.previous_level,
                actor="system",
            )
            self._log_telemetry(
                rt,
                actor="user",
                event_type="rollback",
                payload={
                    "rollback_id": rb_entry.rollback_id,
                    "target_checkpoint_id": checkpoint_id,
                    "from_plan_version": from_plan_ver,
                    "restored_plan_version": rt.plan.version,
                    "from_artifact_version": from_art_ver,
                    "restored_artifact_version": rt.artifact.version,
                },
                checkpoint_id=checkpoint_id,
            )
            self._persist(rt)

            return RollbackResponse(
                session_id=rt.session_id,
                rollback_id=rb_entry.rollback_id,
                checkpoint_id=checkpoint_id,
                plan=rt.plan.model_copy(deep=True),
                artifact=rt.artifact.model_copy(deep=True),
                step_outputs=dict(rt.step_outputs),
                autonomy_level=rt.adaptive_state.level,
                adaptive_state=rt.adaptive_state.model_copy(deep=True),
                status=rt.status,
            )

    async def apply_requirement_change(
        self,
        session_id: str,
        requirement_text: str,
    ) -> RequirementChangeResponse:
        rt = self._get_or_load_runtime(session_id)
        t_req_start = time.perf_counter()
        cleaned_req = requirement_text.strip()
        if not cleaned_req:
            raise ValueError("Requirement text must not be empty.")

        # Emit comparable start event for time-to-recover calculation across both conditions
        self._log_telemetry(
            rt,
            actor="user",
            event_type="requirement_change_sent",
            payload={"requirement": cleaned_req},
        )

        # If called on a baseline session, store requirement and persist without Co-Plan replan
        if rt.condition == "baseline":
            async with rt.lock:
                rt.requirements.append(cleaned_req)
                cp = self._save_and_broadcast_checkpoint(
                    rt,
                    label="Baseline requirement injected",
                    actor="user",
                )
                self._persist(rt)
                return RequirementChangeResponse(
                    session_id=rt.session_id,
                    requirement=cleaned_req,
                    plan=rt.plan.model_copy(deep=True),
                    invalidated_step_ids=[],
                    preserved_locked_step_ids=[],
                    preserved_edited_step_ids=[],
                    autonomy_level=rt.adaptive_state.level,
                    status=rt.status,
                    checkpoint_id=cp.checkpoint_id,
                )

        was_running = rt.runner_task is not None and not rt.runner_task.done()
        await self._stop_runner(rt)

        async with rt.lock:
            self._save_and_broadcast_checkpoint(
                rt,
                label="Before requirement change",
                actor="system",
            )
            plan_snapshot = rt.plan.model_copy(deep=True)
            task_prompt = rt.task_prompt

        replan = await self.planner.replan_for_requirement(
            task_prompt=task_prompt,
            plan=plan_snapshot,
            requirement_text=cleaned_req,
        )

        async with rt.lock:
            rt.requirements.append(cleaned_req)
            rt.plan = replan.plan
            self._transition_status(rt, "paused")

            seq_req = self._next_seq(rt)
            self._emit_sse(
                rt,
                "requirement_changed",
                RequirementChangedPayload(
                    session_id=rt.session_id,
                    seq=seq_req,
                    requirement=cleaned_req,
                    plan=rt.plan.model_copy(deep=True),
                    invalidated_step_ids=replan.invalidated_step_ids,
                    preserved_locked_step_ids=replan.preserved_locked_step_ids,
                    preserved_edited_step_ids=replan.preserved_edited_step_ids,
                ),
            )
            seq_plan = self._next_seq(rt)
            self._emit_sse(
                rt,
                "plan_patch",
                PlanPatchPayload(
                    session_id=rt.session_id,
                    seq=seq_plan,
                    plan=rt.plan.model_copy(deep=True),
                    reason="requirement_changed",
                    changed_step_ids=[*replan.invalidated_step_ids, *replan.added_step_ids],
                ),
            )
            recovery_ms = round((time.perf_counter() - t_req_start) * 1000.0, 2)
            # Comparable recovery end event (first plan_patch after requirement_changed)
            self._log_telemetry(
                rt,
                actor="agent",
                event_type="first_useful_response",
                payload={
                    "trigger": "plan_patch",
                    "invalidated_step_ids": replan.invalidated_step_ids,
                    "preserved_locked_step_ids": replan.preserved_locked_step_ids,
                },
                latency_ms=recovery_ms,
                tokens_in=replan.tokens_in,
                tokens_out=replan.tokens_out,
            )
            cp = self._save_and_broadcast_checkpoint(
                rt,
                label="Replanned for requirement change",
                actor="user",
            )
            self._log_telemetry(
                rt,
                actor="user",
                event_type="requirement_changed",
                payload={
                    "requirement": cleaned_req,
                    "invalidated_step_ids": replan.invalidated_step_ids,
                    "preserved_locked_step_ids": replan.preserved_locked_step_ids,
                    "preserved_edited_step_ids": replan.preserved_edited_step_ids,
                    "added_step_ids": replan.added_step_ids,
                    "was_running": was_running,
                },
                latency_ms=replan.latency_ms,
                tokens_in=replan.tokens_in,
                tokens_out=replan.tokens_out,
                checkpoint_id=cp.checkpoint_id,
            )
            self._persist(rt)

            return RequirementChangeResponse(
                session_id=rt.session_id,
                requirement=cleaned_req,
                plan=rt.plan.model_copy(deep=True),
                invalidated_step_ids=replan.invalidated_step_ids,
                preserved_locked_step_ids=replan.preserved_locked_step_ids,
                preserved_edited_step_ids=replan.preserved_edited_step_ids,
                autonomy_level=rt.adaptive_state.level,
                status=rt.status,
                checkpoint_id=cp.checkpoint_id,
            )

    async def set_autonomy_level(
        self,
        session_id: str,
        *,
        level: AutonomyLevel,
        reason: str,
    ) -> SetAutonomyResponse:
        rt = self._get_or_load_runtime(session_id)
        async with rt.lock:
            transition = self.adaptive.set_manual_level(rt.adaptive_state, level, reason)
            rt.adaptive_state = transition.state
            self._broadcast_autonomy_if_changed(
                rt,
                changed=transition.changed,
                previous_level=transition.previous_level,
                actor="user",
            )
            if not transition.changed:
                self._log_telemetry(
                    rt,
                    actor="user",
                    event_type="autonomy_confirmed",
                    payload={"level": level, "reason": reason},
                )
            self._persist(rt)
            return SetAutonomyResponse(
                session_id=rt.session_id,
                adaptive_state=rt.adaptive_state.model_copy(deep=True),
            )

    async def shutdown(self) -> None:
        """Gracefully cancel background runners on server shutdown."""
        for rt in list(self._sessions.values()):
            await self._stop_runner(rt)
