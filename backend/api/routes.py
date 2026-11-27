"""Co-Plan REST and SSE routes adhering strictly to the shared contract."""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator, Callable
from typing import Literal

from fastapi import APIRouter, Header, HTTPException, Query, Request
from fastapi.responses import PlainTextResponse
from sse_starlette.sse import AppStatus, EventSourceResponse, ServerSentEvent

from backend.agent.checkpoints import CheckpointNotFoundError
from backend.agent.engine import (
    ArtifactVersionConflictError,
    CoPlanEngine,
    InvalidStateTransitionError,
    SessionNotFoundError,
)
from backend.shared.assignment import AssignmentNotFoundError, AssignmentService
from backend.shared.config import Settings
from backend.shared.schemas import (
    Checkpoint,
    CreateSessionRequest,
    HealthResponse,
    InterruptRequest,
    InterruptResponse,
    ParticipantAssignment,
    PatchArtifactRequest,
    PatchArtifactResponse,
    RequirementChangeRequest,
    RequirementChangeResponse,
    ResumeRequest,
    ResumeResponse,
    RollbackLogEntry,
    RollbackRequest,
    RollbackResponse,
    SessionStateResponse,
    SetAutonomyRequest,
    SetAutonomyResponse,
    StepExpandRequest,
    StepExpandResponse,
    StepLockResponse,
    TaskDefinition,
    UpdateStepRequest,
    UpdateStepResponse,
    utc_now_iso,
)


def create_coplan_router(
    *,
    get_engine: Callable[[], CoPlanEngine],
    get_settings_fn: Callable[[], Settings],
    get_assignments_fn: Callable[[], AssignmentService] | None = None,
    auto_start_sessions: bool = True,
) -> APIRouter:
    """Create the Co-Plan REST & SSE API router."""
    router = APIRouter(tags=["coplan"])

    @router.get("/health", response_model=HealthResponse)
    async def health() -> HealthResponse:
        cfg = get_settings_fn()
        return HealthResponse(
            llm_provider=cfg.llm_provider,
            llm_model=cfg.llm_model,
            temperature=cfg.llm_temperature,
            max_tokens=cfg.llm_max_tokens,
        )

    @router.get("/tasks", response_model=list[TaskDefinition])
    async def list_tasks() -> list[TaskDefinition]:
        return get_engine().tasks.list_tasks()

    @router.get("/assignments", response_model=list[ParticipantAssignment])
    async def list_assignments() -> list[ParticipantAssignment]:
        if get_assignments_fn is None:
            return []
        return get_assignments_fn().list_assignments()

    @router.get("/assignment/{participant_id}", response_model=ParticipantAssignment)
    async def get_participant_assignment(participant_id: str) -> ParticipantAssignment:
        if get_assignments_fn is None:
            raise HTTPException(status_code=404, detail="Assignment service not configured.")
        try:
            return get_assignments_fn().get_assignment(participant_id)
        except AssignmentNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    # ------------------------------------------------------------------
    # Shared Contract Endpoints
    # ------------------------------------------------------------------

    @router.post("/sessions", response_model=SessionStateResponse)
    async def create_session(payload: CreateSessionRequest) -> SessionStateResponse:
        engine = get_engine()
        return await engine.create_session(payload, auto_start=auto_start_sessions)

    @router.get("/sessions", response_model=list[SessionStateResponse])
    async def list_sessions() -> list[SessionStateResponse]:
        return get_engine().list_sessions()

    @router.get("/sessions/{session_id}", response_model=SessionStateResponse)
    async def get_session(session_id: str) -> SessionStateResponse:
        try:
            return get_engine().get_session(session_id)
        except SessionNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except InvalidStateTransitionError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc

    @router.get("/sessions/{session_id}/stream")
    async def stream_session(
        session_id: str,
        request: Request,
        last_seq: int = Query(default=0, ge=0),
        close_on_done: bool = Query(default=False),
        max_events: int | None = Query(default=None, ge=1),
        last_event_id: str | None = Header(default=None, alias="Last-Event-ID"),
    ) -> EventSourceResponse:
        engine = get_engine()
        try:
            engine.get_session(session_id)
        except SessionNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except InvalidStateTransitionError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc

        effective_last_seq = last_seq
        if last_event_id and last_event_id.isdigit():
            effective_last_seq = max(effective_last_seq, int(last_event_id))

        ping_seconds = max(1, int(round(get_settings_fn().sse_heartbeat_seconds)))

        async def event_generator() -> AsyncIterator[dict[str, str]]:
            sent = 0
            async for envelope in engine.subscribe(session_id, last_seq=effective_last_seq):
                if await request.is_disconnected():
                    break
                seq = str(envelope.data.get("seq", ""))
                yield {
                    "id": seq,
                    "event": envelope.event,
                    "data": json.dumps(envelope.data, ensure_ascii=False),
                }
                sent += 1
                if max_events is not None and sent >= max_events:
                    break
                if (
                    close_on_done
                    and envelope.event == "done"
                    and int(envelope.data.get("seq", 0)) >= engine.get_session(session_id).seq
                ):
                    break

        # Guard against sse-starlette caching AppStatus.should_exit_event on a stale loop
        existing_evt = getattr(AppStatus, "should_exit_event", None)
        if existing_evt is not None:
            inner_evt = getattr(existing_evt, "_event", existing_evt)
            bound_loop = getattr(inner_evt, "_loop", None)
            if bound_loop is not None and bound_loop is not asyncio.get_running_loop():
                AppStatus.should_exit_event = None

        return EventSourceResponse(
            event_generator(),
            ping=ping_seconds,
            ping_message_factory=lambda: ServerSentEvent(
                comment=f"heartbeat {utc_now_iso()}"
            ),
        )

    @router.post("/sessions/{session_id}/interrupt", response_model=InterruptResponse)
    async def interrupt_session(
        session_id: str,
        payload: InterruptRequest | None = None,
    ) -> InterruptResponse:
        body = payload or InterruptRequest()
        try:
            return await get_engine().interrupt(
                session_id,
                new_instruction=body.new_instruction,
            )
        except SessionNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except InvalidStateTransitionError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc

    @router.post("/sessions/{session_id}/resume", response_model=ResumeResponse)
    async def resume_session(
        session_id: str,
        payload: ResumeRequest | None = None,
    ) -> ResumeResponse:
        body = payload or ResumeRequest()
        try:
            return await get_engine().resume(
                session_id,
                instruction=body.instruction,
            )
        except SessionNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except InvalidStateTransitionError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc

    @router.post("/sessions/{session_id}/steps/{step_id}/lock", response_model=StepLockResponse)
    async def lock_step(session_id: str, step_id: str) -> StepLockResponse:
        try:
            return await get_engine().set_step_lock(session_id, step_id, locked=True)
        except SessionNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except InvalidStateTransitionError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        except KeyError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @router.post("/sessions/{session_id}/steps/{step_id}/unlock", response_model=StepLockResponse)
    async def unlock_step(session_id: str, step_id: str) -> StepLockResponse:
        try:
            return await get_engine().set_step_lock(session_id, step_id, locked=False)
        except SessionNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except InvalidStateTransitionError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        except KeyError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @router.post("/sessions/{session_id}/steps/{step_id}/expand", response_model=StepExpandResponse)
    async def expand_step(
        session_id: str,
        step_id: str,
        payload: StepExpandRequest | None = None,
    ) -> StepExpandResponse:
        body = payload or StepExpandRequest()
        try:
            return await get_engine().expand_step(
                session_id,
                step_id,
                instruction=body.instruction,
            )
        except SessionNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except InvalidStateTransitionError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        except KeyError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @router.patch("/sessions/{session_id}/steps/{step_id}", response_model=UpdateStepResponse)
    async def update_step(
        session_id: str,
        step_id: str,
        payload: UpdateStepRequest,
    ) -> UpdateStepResponse:
        try:
            return await get_engine().edit_step(
                session_id,
                step_id,
                title=payload.title,
                description=payload.description,
            )
        except SessionNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except InvalidStateTransitionError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        except KeyError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except PermissionError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc

    @router.patch("/sessions/{session_id}/artifact", response_model=PatchArtifactResponse)
    async def patch_artifact(
        session_id: str,
        payload: PatchArtifactRequest,
    ) -> PatchArtifactResponse:
        try:
            return await get_engine().patch_artifact(
                session_id,
                content=payload.content,
                base_version=payload.base_version,
            )
        except SessionNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except InvalidStateTransitionError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        except ArtifactVersionConflictError as exc:
            raise HTTPException(
                status_code=409,
                detail=exc.detail.model_dump(mode="json"),
            ) from exc

    @router.post("/sessions/{session_id}/rollback", response_model=RollbackResponse)
    async def rollback_session(
        session_id: str,
        payload: RollbackRequest,
    ) -> RollbackResponse:
        try:
            return await get_engine().rollback(session_id, payload.checkpoint_id)
        except SessionNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except InvalidStateTransitionError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        except CheckpointNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @router.post("/sessions/{session_id}/requirement", response_model=RequirementChangeResponse)
    async def inject_requirement(
        session_id: str,
        payload: RequirementChangeRequest,
    ) -> RequirementChangeResponse:
        try:
            return await get_engine().apply_requirement_change(session_id, payload.text)
        except SessionNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        except InvalidStateTransitionError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc

    # ------------------------------------------------------------------
    # Supporting Endpoints (Autonomy Override, Checkpoints, Telemetry Export)
    # ------------------------------------------------------------------

    @router.post("/sessions/{session_id}/autonomy", response_model=SetAutonomyResponse)
    async def set_autonomy(
        session_id: str,
        payload: SetAutonomyRequest,
    ) -> SetAutonomyResponse:
        try:
            return await get_engine().set_autonomy_level(
                session_id,
                level=payload.level,
                reason=payload.reason,
            )
        except SessionNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except InvalidStateTransitionError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc

    @router.get("/sessions/{session_id}/checkpoints", response_model=list[Checkpoint])
    async def list_checkpoints(session_id: str) -> list[Checkpoint]:
        engine = get_engine()
        try:
            engine.get_session(session_id)
        except SessionNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except InvalidStateTransitionError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        return engine.checkpoints.list_checkpoints(session_id)

    @router.get("/sessions/{session_id}/rollbacks", response_model=list[RollbackLogEntry])
    async def list_rollback_logs(session_id: str) -> list[RollbackLogEntry]:
        engine = get_engine()
        try:
            engine.get_session(session_id)
        except SessionNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except InvalidStateTransitionError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        return engine.checkpoints.list_rollback_logs(session_id)

    @router.get("/sessions/{session_id}/telemetry")
    async def export_session_telemetry(
        session_id: str,
        format: Literal["jsonl", "csv"] = Query(default="jsonl"),
    ) -> PlainTextResponse:
        engine = get_engine()
        try:
            engine.get_session(session_id)
        except SessionNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except InvalidStateTransitionError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc

        if format == "csv":
            return PlainTextResponse(
                content=engine.telemetry.export_csv(session_id=session_id),
                media_type="text/csv",
                headers={
                    "Content-Disposition": f'attachment; filename="telemetry_{session_id}.csv"'
                },
            )
        return PlainTextResponse(
            content=engine.telemetry.export_jsonl(session_id=session_id),
            media_type="application/x-ndjson",
            headers={
                "Content-Disposition": f'attachment; filename="telemetry_{session_id}.jsonl"'
            },
        )

    @router.get("/telemetry/export")
    async def export_all_telemetry(
        format: Literal["jsonl", "csv"] = Query(default="csv"),
    ) -> PlainTextResponse:
        telemetry = get_engine().telemetry
        if format == "csv":
            return PlainTextResponse(
                content=telemetry.export_csv(),
                media_type="text/csv",
                headers={
                    "Content-Disposition": 'attachment; filename="coplan_telemetry_all.csv"'
                },
            )
        return PlainTextResponse(
            content=telemetry.export_jsonl(),
            media_type="application/x-ndjson",
            headers={
                "Content-Disposition": 'attachment; filename="coplan_telemetry_all.jsonl"'
            },
        )

    return router
