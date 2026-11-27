"""Centralized configuration loaded from .env for both Co-Plan and Baseline."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

LLMProviderName = Literal[
    "mock",
    "openai",
    "anthropic",
    "gemini",
    "openai_compatible",
]


class Settings(BaseSettings):
    """Application settings shared identically by Co-Plan and Baseline."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    llm_provider: LLMProviderName = "mock"
    llm_model: str = "mock-coplan-v1"
    llm_api_key: str = ""
    llm_base_url: str = ""

    # Generation hyperparameters — MUST remain identical across both conditions
    llm_temperature: float = 0.3
    llm_max_tokens: int = 2048
    llm_top_p: float = 1.0
    llm_timeout_seconds: float = 60.0

    # Pacing for mock streaming so human steering is observable during live runs
    coplan_step_delay_ms: int = 140
    sse_heartbeat_seconds: float = 15.0

    # Paths
    db_path: str = "./data/coplan.db"
    telemetry_dir: str = "./eval/raw_logs"
    tasks_path: str = "./eval/tasks/tasks.json"

    # Server hosts / ports
    backend_host: str = "127.0.0.1"
    backend_port: int = 8000
    baseline_port: int = 8001
    coplan_frontend_port: int = 5173
    baseline_frontend_port: int = 5174
    single_host_mode: bool = True

    def resolved_db_path(self) -> Path:
        path = Path(self.db_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        return path

    def resolved_telemetry_dir(self) -> Path:
        path = Path(self.telemetry_dir)
        path.mkdir(parents=True, exist_ok=True)
        return path

    def resolved_tasks_path(self) -> Path:
        return Path(self.tasks_path)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return cached singleton Settings instance."""
    return Settings()
