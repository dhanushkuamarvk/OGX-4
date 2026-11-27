"""SQLite storage layer for sessions, checkpoints, rollback logs, SSE replay, baseline chat, and telemetry."""

from __future__ import annotations

import json
import sqlite3
import threading
from pathlib import Path
from typing import Any

from backend.shared.schemas import (
    AdaptiveState,
    Artifact,
    BaselineMessage,
    Checkpoint,
    CheckpointSnapshot,
    Condition,
    Plan,
    RollbackLogEntry,
    SessionStateResponse,
    SessionStatus,
    SSEEnvelope,
    TelemetryEvent,
    utc_now_iso,
)


class Database:
    """Thread-safe SQLite database wrapper using WAL mode."""

    def __init__(self, db_path: Path | str) -> None:
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._init_schema()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self.db_path), check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA foreign_keys=ON;")
        return conn

    def _init_schema(self) -> None:
        with self._lock, self._connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS sessions (
                    session_id TEXT PRIMARY KEY,
                    task_id TEXT NOT NULL,
                    participant_id TEXT NOT NULL,
                    condition TEXT NOT NULL,
                    status TEXT NOT NULL,
                    autonomy_level TEXT NOT NULL,
                    adaptive_state_json TEXT NOT NULL,
                    plan_json TEXT NOT NULL,
                    artifact_json TEXT NOT NULL,
                    step_outputs_json TEXT NOT NULL DEFAULT '{}',
                    requirements_json TEXT NOT NULL,
                    active_instruction TEXT,
                    task_prompt TEXT NOT NULL,
                    seq INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS checkpoints (
                    checkpoint_id TEXT PRIMARY KEY,
                    session_id TEXT NOT NULL,
                    seq INTEGER NOT NULL,
                    label TEXT NOT NULL,
                    plan_version INTEGER NOT NULL,
                    artifact_version INTEGER NOT NULL,
                    autonomy_level TEXT NOT NULL,
                    step_id TEXT,
                    snapshot_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
                );

                CREATE INDEX IF NOT EXISTS idx_checkpoints_session
                ON checkpoints(session_id, created_at);

                CREATE TABLE IF NOT EXISTS rollback_logs (
                    rollback_id TEXT PRIMARY KEY,
                    session_id TEXT NOT NULL,
                    target_checkpoint_id TEXT NOT NULL,
                    from_plan_version INTEGER NOT NULL,
                    to_plan_version INTEGER NOT NULL,
                    from_artifact_version INTEGER NOT NULL,
                    to_artifact_version INTEGER NOT NULL,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
                );

                CREATE INDEX IF NOT EXISTS idx_rollback_logs_session
                ON rollback_logs(session_id, created_at);

                CREATE TABLE IF NOT EXISTS sse_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    session_id TEXT NOT NULL,
                    seq INTEGER NOT NULL,
                    event_type TEXT NOT NULL,
                    data_json TEXT NOT NULL,
                    ts TEXT NOT NULL,
                    FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
                );

                CREATE UNIQUE INDEX IF NOT EXISTS idx_sse_events_session_seq
                ON sse_events(session_id, seq);

                CREATE TABLE IF NOT EXISTS baseline_messages (
                    message_id TEXT PRIMARY KEY,
                    session_id TEXT NOT NULL,
                    turn_index INTEGER NOT NULL,
                    role TEXT NOT NULL,
                    content TEXT NOT NULL,
                    latency_ms REAL NOT NULL DEFAULT 0.0,
                    tokens_in INTEGER NOT NULL DEFAULT 0,
                    tokens_out INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
                );

                CREATE INDEX IF NOT EXISTS idx_baseline_messages_session
                ON baseline_messages(session_id, turn_index);

                CREATE TABLE IF NOT EXISTS telemetry_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    ts TEXT NOT NULL,
                    session_id TEXT NOT NULL,
                    participant_id TEXT NOT NULL,
                    condition TEXT NOT NULL,
                    task_id TEXT NOT NULL,
                    actor TEXT NOT NULL,
                    event_type TEXT NOT NULL,
                    step_id TEXT,
                    payload_json TEXT NOT NULL,
                    latency_ms REAL NOT NULL DEFAULT 0.0,
                    tokens_in INTEGER NOT NULL DEFAULT 0,
                    tokens_out INTEGER NOT NULL DEFAULT 0,
                    autonomy_level TEXT NOT NULL,
                    checkpoint_id TEXT
                );

                CREATE INDEX IF NOT EXISTS idx_telemetry_session
                ON telemetry_events(session_id, id);
                """
            )
            # Lightweight forward-migration if an existing DB predates step_outputs_json
            cols = {
                row["name"]
                for row in conn.execute("PRAGMA table_info(sessions)").fetchall()
            }
            if "step_outputs_json" not in cols:
                conn.execute(
                    "ALTER TABLE sessions ADD COLUMN step_outputs_json TEXT NOT NULL DEFAULT '{}'"
                )

    # ------------------------------------------------------------------
    # Sessions
    # ------------------------------------------------------------------

    def upsert_session(
        self,
        *,
        session_id: str,
        task_id: str,
        participant_id: str,
        condition: Condition,
        status: SessionStatus,
        adaptive_state: AdaptiveState,
        plan: Plan,
        artifact: Artifact,
        step_outputs: dict[str, str] | None = None,
        requirements: list[str],
        active_instruction: str | None,
        task_prompt: str,
        seq: int,
        created_at: str | None = None,
    ) -> str:
        now = utc_now_iso()
        created = created_at or now
        outputs_json = json.dumps(step_outputs or {}, ensure_ascii=False)
        with self._lock, self._connect() as conn:
            conn.execute(
                """
                INSERT INTO sessions (
                    session_id, task_id, participant_id, condition, status,
                    autonomy_level, adaptive_state_json, plan_json, artifact_json,
                    step_outputs_json, requirements_json, active_instruction,
                    task_prompt, seq, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(session_id) DO UPDATE SET
                    status = excluded.status,
                    autonomy_level = excluded.autonomy_level,
                    adaptive_state_json = excluded.adaptive_state_json,
                    plan_json = excluded.plan_json,
                    artifact_json = excluded.artifact_json,
                    step_outputs_json = excluded.step_outputs_json,
                    requirements_json = excluded.requirements_json,
                    active_instruction = excluded.active_instruction,
                    task_prompt = excluded.task_prompt,
                    seq = excluded.seq,
                    updated_at = excluded.updated_at
                """,
                (
                    session_id,
                    task_id,
                    participant_id,
                    condition,
                    status,
                    adaptive_state.level,
                    adaptive_state.model_dump_json(),
                    plan.model_dump_json(),
                    artifact.model_dump_json(),
                    outputs_json,
                    json.dumps(requirements),
                    active_instruction,
                    task_prompt,
                    seq,
                    created,
                    now,
                ),
            )
        return now

    def get_session_row(self, session_id: str) -> dict[str, Any] | None:
        with self._lock, self._connect() as conn:
            row = conn.execute(
                "SELECT * FROM sessions WHERE session_id = ?",
                (session_id,),
            ).fetchone()
        return dict(row) if row is not None else None

    def list_sessions(self) -> list[SessionStateResponse]:
        with self._lock, self._connect() as conn:
            rows = conn.execute(
                "SELECT * FROM sessions ORDER BY created_at DESC"
            ).fetchall()
        return [self._row_to_session_state(dict(row)) for row in rows]

    def get_session_state(self, session_id: str) -> SessionStateResponse | None:
        row = self.get_session_row(session_id)
        if row is None:
            return None
        return self._row_to_session_state(row)

    def _row_to_session_state(self, row: dict[str, Any]) -> SessionStateResponse:
        checkpoints = self.list_checkpoints(row["session_id"])
        rollback_logs = self.list_rollback_logs(row["session_id"])
        adaptive = AdaptiveState.model_validate_json(row["adaptive_state_json"])
        plan = Plan.model_validate_json(row["plan_json"])
        artifact = Artifact.model_validate_json(row["artifact_json"])
        step_outputs: dict[str, str] = json.loads(row.get("step_outputs_json") or "{}")
        requirements: list[str] = json.loads(row["requirements_json"])
        return SessionStateResponse(
            session_id=row["session_id"],
            task_id=row["task_id"],
            participant_id=row["participant_id"],
            condition=row["condition"],
            status=row["status"],
            autonomy_level=row["autonomy_level"],
            adaptive_state=adaptive,
            plan=plan,
            artifact=artifact,
            step_outputs=step_outputs,
            checkpoints=checkpoints,
            rollback_logs=rollback_logs,
            requirements=requirements,
            active_instruction=row["active_instruction"],
            seq=row["seq"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )

    # ------------------------------------------------------------------
    # Checkpoints & Rollback Log
    # ------------------------------------------------------------------

    def insert_checkpoint(self, snapshot: CheckpointSnapshot) -> None:
        cp = snapshot.checkpoint
        with self._lock, self._connect() as conn:
            conn.execute(
                """
                INSERT INTO checkpoints (
                    checkpoint_id, session_id, seq, label,
                    plan_version, artifact_version, autonomy_level,
                    step_id, snapshot_json, created_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    cp.checkpoint_id,
                    cp.session_id,
                    cp.seq,
                    cp.label,
                    cp.plan_version,
                    cp.artifact_version,
                    cp.autonomy_level,
                    cp.step_id,
                    snapshot.model_dump_json(),
                    cp.created_at,
                ),
            )

    def list_checkpoints(self, session_id: str) -> list[Checkpoint]:
        with self._lock, self._connect() as conn:
            rows = conn.execute(
                """
                SELECT checkpoint_id, session_id, seq, label, created_at,
                       plan_version, artifact_version, autonomy_level, step_id
                FROM checkpoints
                WHERE session_id = ?
                ORDER BY created_at ASC, seq ASC
                """,
                (session_id,),
            ).fetchall()
        return [
            Checkpoint(
                checkpoint_id=r["checkpoint_id"],
                session_id=r["session_id"],
                seq=r["seq"],
                label=r["label"],
                created_at=r["created_at"],
                plan_version=r["plan_version"],
                artifact_version=r["artifact_version"],
                autonomy_level=r["autonomy_level"],
                step_id=r["step_id"],
            )
            for r in rows
        ]

    def get_checkpoint_snapshot(
        self,
        session_id: str,
        checkpoint_id: str,
    ) -> CheckpointSnapshot | None:
        with self._lock, self._connect() as conn:
            row = conn.execute(
                """
                SELECT snapshot_json FROM checkpoints
                WHERE session_id = ? AND checkpoint_id = ?
                """,
                (session_id, checkpoint_id),
            ).fetchone()
        if row is None:
            return None
        return CheckpointSnapshot.model_validate_json(row["snapshot_json"])

    def insert_rollback_log(self, entry: RollbackLogEntry) -> None:
        with self._lock, self._connect() as conn:
            conn.execute(
                """
                INSERT INTO rollback_logs (
                    rollback_id, session_id, target_checkpoint_id,
                    from_plan_version, to_plan_version,
                    from_artifact_version, to_artifact_version, created_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    entry.rollback_id,
                    entry.session_id,
                    entry.target_checkpoint_id,
                    entry.from_plan_version,
                    entry.to_plan_version,
                    entry.from_artifact_version,
                    entry.to_artifact_version,
                    entry.created_at,
                ),
            )

    def list_rollback_logs(self, session_id: str) -> list[RollbackLogEntry]:
        with self._lock, self._connect() as conn:
            rows = conn.execute(
                """
                SELECT * FROM rollback_logs
                WHERE session_id = ?
                ORDER BY created_at ASC
                """,
                (session_id,),
            ).fetchall()
        return [
            RollbackLogEntry(
                rollback_id=r["rollback_id"],
                session_id=r["session_id"],
                target_checkpoint_id=r["target_checkpoint_id"],
                from_plan_version=r["from_plan_version"],
                to_plan_version=r["to_plan_version"],
                from_artifact_version=r["from_artifact_version"],
                to_artifact_version=r["to_artifact_version"],
                created_at=r["created_at"],
            )
            for r in rows
        ]

    # ------------------------------------------------------------------
    # Persistent SSE Event Log (for Last-Event-ID replay across reconnects)
    # ------------------------------------------------------------------

    def insert_sse_event(self, session_id: str, envelope: SSEEnvelope) -> None:
        seq = int(envelope.data.get("seq", 0))
        ts = str(envelope.data.get("ts") or utc_now_iso())
        data_json = json.dumps(envelope.data, ensure_ascii=False)
        with self._lock, self._connect() as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO sse_events (
                    session_id, seq, event_type, data_json, ts
                )
                VALUES (?, ?, ?, ?, ?)
                """,
                (session_id, seq, envelope.event, data_json, ts),
            )

    def list_sse_events(
        self,
        session_id: str,
        after_seq: int = 0,
    ) -> list[SSEEnvelope]:
        with self._lock, self._connect() as conn:
            rows = conn.execute(
                """
                SELECT event_type, data_json
                FROM sse_events
                WHERE session_id = ? AND seq > ?
                ORDER BY seq ASC
                """,
                (session_id, after_seq),
            ).fetchall()
        return [
            SSEEnvelope(
                event=r["event_type"],
                data=json.loads(r["data_json"]),
            )
            for r in rows
        ]

    # ------------------------------------------------------------------
    # Baseline Messages
    # ------------------------------------------------------------------

    def insert_baseline_message(self, msg: BaselineMessage) -> None:
        with self._lock, self._connect() as conn:
            conn.execute(
                """
                INSERT INTO baseline_messages (
                    message_id, session_id, turn_index, role, content,
                    latency_ms, tokens_in, tokens_out, created_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    msg.message_id,
                    msg.session_id,
                    msg.turn_index,
                    msg.role,
                    msg.content,
                    msg.latency_ms,
                    msg.tokens_in,
                    msg.tokens_out,
                    msg.created_at,
                ),
            )

    def list_baseline_messages(self, session_id: str) -> list[BaselineMessage]:
        with self._lock, self._connect() as conn:
            rows = conn.execute(
                """
                SELECT * FROM baseline_messages
                WHERE session_id = ?
                ORDER BY turn_index ASC, created_at ASC
                """,
                (session_id,),
            ).fetchall()
        return [
            BaselineMessage(
                message_id=r["message_id"],
                session_id=r["session_id"],
                turn_index=r["turn_index"],
                role=r["role"],
                content=r["content"],
                latency_ms=r["latency_ms"],
                tokens_in=r["tokens_in"],
                tokens_out=r["tokens_out"],
                created_at=r["created_at"],
            )
            for r in rows
        ]

    # ------------------------------------------------------------------
    # Telemetry
    # ------------------------------------------------------------------

    def insert_telemetry_event(self, event: TelemetryEvent) -> None:
        with self._lock, self._connect() as conn:
            conn.execute(
                """
                INSERT INTO telemetry_events (
                    ts, session_id, participant_id, condition, task_id,
                    actor, event_type, step_id, payload_json,
                    latency_ms, tokens_in, tokens_out, autonomy_level, checkpoint_id
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    event.ts,
                    event.session_id,
                    event.participant_id,
                    event.condition,
                    event.task_id,
                    event.actor,
                    event.event_type,
                    event.step_id,
                    event.payload_json,
                    event.latency_ms,
                    event.tokens_in,
                    event.tokens_out,
                    event.autonomy_level,
                    event.checkpoint_id,
                ),
            )

    def list_telemetry_events(
        self,
        session_id: str | None = None,
    ) -> list[TelemetryEvent]:
        with self._lock, self._connect() as conn:
            if session_id is not None:
                rows = conn.execute(
                    """
                    SELECT ts, session_id, participant_id, condition, task_id,
                           actor, event_type, step_id, payload_json,
                           latency_ms, tokens_in, tokens_out, autonomy_level, checkpoint_id
                    FROM telemetry_events
                    WHERE session_id = ?
                    ORDER BY id ASC
                    """,
                    (session_id,),
                ).fetchall()
            else:
                rows = conn.execute(
                    """
                    SELECT ts, session_id, participant_id, condition, task_id,
                           actor, event_type, step_id, payload_json,
                           latency_ms, tokens_in, tokens_out, autonomy_level, checkpoint_id
                    FROM telemetry_events
                    ORDER BY id ASC
                    """
                ).fetchall()
        return [
            TelemetryEvent(
                ts=r["ts"],
                session_id=r["session_id"],
                participant_id=r["participant_id"],
                condition=r["condition"],
                task_id=r["task_id"],
                actor=r["actor"],
                event_type=r["event_type"],
                step_id=r["step_id"],
                payload_json=r["payload_json"],
                latency_ms=r["latency_ms"],
                tokens_in=r["tokens_in"],
                tokens_out=r["tokens_out"],
                autonomy_level=r["autonomy_level"],
                checkpoint_id=r["checkpoint_id"],
            )
            for r in rows
        ]
