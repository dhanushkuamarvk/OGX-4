"""Unified FastAPI application serving BOTH Co-Plan (treatment) and Baseline (control)."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles

from backend.agent.engine import CoPlanEngine
from backend.api.routes import create_coplan_router
from backend.baseline.app import create_baseline_router
from backend.baseline.service import BaselineChatService
from backend.shared.assignment import AssignmentService
from backend.shared.config import Settings, get_settings
from backend.shared.db import Database
from backend.shared.llm_client import LLMClient
from backend.shared.tasks import TaskRepository
from backend.shared.telemetry import TelemetryLogger


class AppContainer:
    """Dependency container holding the single shared backend core."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.db = Database(settings.resolved_db_path())
        self.llm_client = LLMClient(settings)
        self.telemetry = TelemetryLogger(
            self.db,
            settings.resolved_telemetry_dir(),
            llm_provider=settings.llm_provider,
            llm_model=settings.llm_model,
        )
        self.tasks = TaskRepository(settings.resolved_tasks_path())
        self.engine = CoPlanEngine(
            db=self.db,
            llm_client=self.llm_client,
            telemetry=self.telemetry,
            tasks=self.tasks,
        )
        self.baseline_service = BaselineChatService(
            db=self.db,
            llm_client=self.llm_client,
            telemetry=self.telemetry,
        )
        self.assignments = AssignmentService(
            db=self.db,
            settings=settings,
        )


def create_app(
    settings: Settings | None = None,
    *,
    auto_start_sessions: bool = True,
) -> FastAPI:
    """Build the unified FastAPI app with one shared LLMClient, DB, and Telemetry core."""
    cfg = settings or get_settings()
    container = AppContainer(cfg)

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        try:
            yield
        finally:
            await container.engine.shutdown()

    app = FastAPI(
        title="Co-Plan & Baseline Unified Backend",
        description="Resurrect 2026 Problem 3 — Human-Agent Interaction Shared Workspace Backend",
        version="0.1.0",
        lifespan=lifespan,
    )
    app.state.container = container

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(
        create_coplan_router(
            get_engine=lambda: container.engine,
            get_settings_fn=lambda: container.settings,
            get_assignments_fn=lambda: container.assignments,
            auto_start_sessions=auto_start_sessions,
        )
    )
    app.include_router(
        create_baseline_router(lambda: container.baseline_service)
    )

    frontend_dist = (
        Path(__file__).resolve().parent.parent.parent / "frontend" / "coplan" / "dist"
    )
    assets_dir = frontend_dist / "assets"
    if assets_dir.is_dir():
        app.mount(
            "/assets",
            StaticFiles(directory=str(assets_dir)),
            name="frontend-assets",
        )

    @app.get("/", include_in_schema=False, response_model=None)
    async def serve_frontend() -> Response:
        index_html = frontend_dist / "index.html"
        if index_html.is_file():
            return FileResponse(
                index_html,
                headers={"Cache-Control": "no-cache"},
            )
        return HTMLResponse(
            content=(
                "<html><body><h2>Frontend build not found</h2>"
                "<p>Run <code>npm run build</code> inside <code>frontend/coplan</code> "
                "and reload.</p></body></html>"
            ),
            status_code=200,
        )

    return app


app = create_app()
