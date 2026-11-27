"""Baseline FastAPI router and standalone app entrypoint."""

from __future__ import annotations

from collections.abc import Callable

from fastapi import APIRouter, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from backend.baseline.service import (
    BaselineChatService,
    BaselineConditionMismatchError,
    BaselineSessionNotFoundError,
)
from backend.shared.config import Settings, get_settings
from backend.shared.db import Database
from backend.shared.llm_client import LLMClient
from backend.shared.schemas import (
    BaselineChatRequest,
    BaselineChatResponse,
    BaselineHistoryResponse,
    CreateSessionRequest,
    HealthResponse,
    SessionStateResponse,
    TaskDefinition,
)
from backend.shared.tasks import TaskRepository
from backend.shared.telemetry import TelemetryLogger


def create_baseline_router(
    get_service: Callable[[], BaselineChatService],
) -> APIRouter:
    """Create the Baseline REST router (`POST /chat/{session_id}` + history)."""
    router = APIRouter(tags=["baseline"])

    @router.post("/chat/{session_id}", response_model=BaselineChatResponse)
    async def baseline_chat(
        session_id: str,
        payload: BaselineChatRequest,
    ) -> BaselineChatResponse:
        service = get_service()
        try:
            return await service.send_message(session_id, payload.message)
        except BaselineSessionNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except BaselineConditionMismatchError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

    @router.get("/chat/{session_id}/history", response_model=BaselineHistoryResponse)
    async def baseline_history(session_id: str) -> BaselineHistoryResponse:
        service = get_service()
        try:
            return service.get_history(session_id)
        except BaselineSessionNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    return router


def create_baseline_app(settings: Settings | None = None) -> FastAPI:
    """Standalone Baseline FastAPI application reusing /backend/shared."""
    cfg = settings or get_settings()
    db = Database(cfg.resolved_db_path())
    llm_client = LLMClient(cfg)
    telemetry = TelemetryLogger(
        db,
        cfg.resolved_telemetry_dir(),
        llm_provider=cfg.llm_provider,
        llm_model=cfg.llm_model,
    )
    tasks = TaskRepository(cfg.resolved_tasks_path())
    service = BaselineChatService(db=db, llm_client=llm_client, telemetry=telemetry)

    from backend.agent.engine import CoPlanEngine

    session_manager = CoPlanEngine(
        db=db,
        llm_client=llm_client,
        telemetry=telemetry,
        tasks=tasks,
    )

    app = FastAPI(
        title="Co-Plan Baseline (Control) API",
        version="0.1.0",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/health", response_model=HealthResponse)
    async def health() -> HealthResponse:
        return HealthResponse(
            llm_provider=cfg.llm_provider,
            llm_model=cfg.llm_model,
            temperature=cfg.llm_temperature,
            max_tokens=cfg.llm_max_tokens,
        )

    @app.get("/tasks", response_model=list[TaskDefinition])
    async def list_tasks() -> list[TaskDefinition]:
        return tasks.list_tasks()

    @app.post("/sessions", response_model=SessionStateResponse)
    async def create_session(req: CreateSessionRequest) -> SessionStateResponse:
        return await session_manager.create_session(req, auto_start=False)

    app.include_router(create_baseline_router(lambda: service))
    return app


app = create_baseline_app()
