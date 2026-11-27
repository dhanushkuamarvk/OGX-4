"""Shared pytest fixtures for Co-Plan and Baseline tests."""

from __future__ import annotations

from pathlib import Path

import pytest

from backend.agent.engine import CoPlanEngine
from backend.api.main import create_app
from backend.shared.config import Settings
from backend.shared.db import Database
from backend.shared.llm_client import LLMClient
from backend.shared.tasks import TaskRepository
from backend.shared.telemetry import TelemetryLogger


@pytest.fixture()
def test_settings(tmp_path: Path) -> Settings:
    return Settings(
        llm_provider="mock",
        llm_model="mock-coplan-v1",
        llm_temperature=0.3,
        llm_max_tokens=2048,
        llm_top_p=1.0,
        coplan_step_delay_ms=0,
        db_path=str(tmp_path / "test_coplan.db"),
        telemetry_dir=str(tmp_path / "raw_logs"),
        tasks_path="eval/tasks/tasks.json",
    )


@pytest.fixture()
def db(test_settings: Settings) -> Database:
    return Database(test_settings.resolved_db_path())


@pytest.fixture()
def telemetry(db: Database, test_settings: Settings) -> TelemetryLogger:
    return TelemetryLogger(db, test_settings.resolved_telemetry_dir())


@pytest.fixture()
def llm_client(test_settings: Settings) -> LLMClient:
    return LLMClient(test_settings)


@pytest.fixture()
def engine(
    db: Database,
    llm_client: LLMClient,
    telemetry: TelemetryLogger,
    test_settings: Settings,
) -> CoPlanEngine:
    tasks = TaskRepository(test_settings.resolved_tasks_path())
    return CoPlanEngine(
        db=db,
        llm_client=llm_client,
        telemetry=telemetry,
        tasks=tasks,
    )


@pytest.fixture()
def app(test_settings: Settings):
    return create_app(test_settings, auto_start_sessions=True)
