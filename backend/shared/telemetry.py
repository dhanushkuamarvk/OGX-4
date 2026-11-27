"""Unified thread-safe, non-blocking telemetry logger emitting 14-column JSONL, SQLite, and CSV exports."""

from __future__ import annotations

import csv
import io
import json
import queue
import re
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from backend.shared.db import Database
from backend.shared.schemas import (
    TELEMETRY_COLUMNS,
    Actor,
    AutonomyLevel,
    Condition,
    TelemetryEvent,
)


def _safe_filename_part(value: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9._-]+", "_", value.strip())
    return cleaned or "unknown"


class TelemetryLogger:
    """Persists every state-changing action in Co-Plan and Baseline.

    - Strictly obeys the frozen 14-column TELEMETRY_COLUMNS schema.
    - Stamps `llm_provider` and `llm_model` inside `payload_json` so mock
      sessions can never be confused with live study data.
    - Guarantees strictly monotonic ISO-8601 UTC timestamps per session.
    - Writes to `/eval/raw_logs/{participant}_{task}_{condition}.jsonl`
      (and aggregate `telemetry_all.jsonl`) via a thread-safe background writer
      so disk I/O never blocks the async request loop.
    """

    def __init__(
        self,
        db: Database,
        telemetry_dir: Path | str,
        *,
        llm_provider: str = "mock",
        llm_model: str = "mock-coplan-v1",
    ) -> None:
        self.db = db
        self.telemetry_dir = Path(telemetry_dir)
        self.telemetry_dir.mkdir(parents=True, exist_ok=True)
        self.llm_provider = llm_provider
        self.llm_model = llm_model

        self._lock = threading.RLock()
        self._last_ts_by_session: dict[str, datetime] = {}
        self._write_queue: queue.Queue[tuple[Path, str] | None] = queue.Queue()
        self._worker = threading.Thread(
            target=self._writer_loop,
            name="coplan-telemetry-writer",
            daemon=True,
        )
        self._worker.start()

    def _next_monotonic_ts(self, session_id: str, provided_ts: str | None = None) -> str:
        with self._lock:
            now = (
                datetime.fromisoformat(provided_ts.replace("Z", "+00:00"))
                if provided_ts
                else datetime.now(timezone.utc)
            )
            prev = self._last_ts_by_session.get(session_id)
            if prev is not None and now <= prev:
                now = prev + timedelta(microseconds=1)
            self._last_ts_by_session[session_id] = now
            return now.isoformat()

    def _writer_loop(self) -> None:
        while True:
            item = self._write_queue.get()
            try:
                if item is None:
                    return
                path, line = item
                path.parent.mkdir(parents=True, exist_ok=True)
                with path.open("a", encoding="utf-8") as fh:
                    fh.write(line)
            finally:
                self._write_queue.task_done()

    def flush(self) -> None:
        """Wait for all queued JSONL writes to finish flushing to disk."""
        self._write_queue.join()

    def raw_log_path(
        self,
        *,
        participant_id: str,
        task_id: str,
        condition: Condition,
    ) -> Path:
        p = _safe_filename_part(participant_id)
        t = _safe_filename_part(task_id)
        c = _safe_filename_part(condition)
        return self.telemetry_dir / f"{p}_{t}_{c}.jsonl"

    def record(
        self,
        *,
        session_id: str,
        participant_id: str,
        condition: Condition,
        task_id: str,
        actor: Actor,
        event_type: str,
        step_id: str | None = None,
        payload: dict[str, Any] | None = None,
        latency_ms: float = 0.0,
        tokens_in: int = 0,
        tokens_out: int = 0,
        autonomy_level: AutonomyLevel = "L2",
        checkpoint_id: str | None = None,
        ts: str | None = None,
    ) -> TelemetryEvent:
        """Create, validate, persist, and queue-write a 14-column TelemetryEvent."""
        enriched_payload: dict[str, Any] = {
            "llm_provider": self.llm_provider,
            "llm_model": self.llm_model,
            **(payload or {}),
        }
        payload_json = json.dumps(
            enriched_payload,
            ensure_ascii=False,
            separators=(",", ":"),
        )
        monotonic_ts = self._next_monotonic_ts(session_id, ts)
        event = TelemetryEvent(
            ts=monotonic_ts,
            session_id=session_id,
            participant_id=participant_id,
            condition=condition,
            task_id=task_id,
            actor=actor,
            event_type=event_type,
            step_id=step_id,
            payload_json=payload_json,
            latency_ms=round(float(latency_ms), 3),
            tokens_in=int(tokens_in),
            tokens_out=int(tokens_out),
            autonomy_level=autonomy_level,
            checkpoint_id=checkpoint_id,
        )
        self.db.insert_telemetry_event(event)
        line = event.model_dump_json() + "\n"
        per_run_file = self.raw_log_path(
            participant_id=participant_id,
            task_id=task_id,
            condition=condition,
        )
        all_file = self.telemetry_dir / "telemetry_all.jsonl"
        self._write_queue.put((per_run_file, line))
        self._write_queue.put((all_file, line))
        return event

    def get_events(self, session_id: str | None = None) -> list[TelemetryEvent]:
        return self.db.list_telemetry_events(session_id=session_id)

    def export_jsonl(self, session_id: str | None = None) -> str:
        events = self.get_events(session_id=session_id)
        return "\n".join(event.model_dump_json() for event in events) + (
            "\n" if events else ""
        )

    def export_csv(self, session_id: str | None = None) -> str:
        events = self.get_events(session_id=session_id)
        buffer = io.StringIO()
        writer = csv.DictWriter(buffer, fieldnames=list(TELEMETRY_COLUMNS))
        writer.writeheader()
        for event in events:
            writer.writerow(event.to_csv_row())
        return buffer.getvalue()

    def write_csv(self, output_path: Path | str, session_id: str | None = None) -> Path:
        path = Path(output_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(self.export_csv(session_id=session_id), encoding="utf-8")
        return path
