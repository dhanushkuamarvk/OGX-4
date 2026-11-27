"""SQLite-backed immutable checkpoint manager and rollback audit log."""

from __future__ import annotations

import uuid

from backend.shared.db import Database
from backend.shared.schemas import (
    AdaptiveState,
    Artifact,
    Checkpoint,
    CheckpointSnapshot,
    Plan,
    RollbackLogEntry,
    SessionStatus,
    utc_now_iso,
)


class CheckpointNotFoundError(KeyError):
    """Raised when a requested checkpoint_id does not exist for a session."""


class CheckpointManager:
    """Persists and restores immutable full-workspace snapshots (plan + artifact + outputs) in SQLite."""

    def __init__(self, db: Database) -> None:
        self.db = db

    def save_checkpoint(
        self,
        *,
        session_id: str,
        seq: int,
        label: str,
        plan: Plan,
        artifact: Artifact,
        step_outputs: dict[str, str],
        session_status: SessionStatus,
        requirements: list[str],
        active_instruction: str | None,
        adaptive_state: AdaptiveState,
        step_id: str | None = None,
    ) -> Checkpoint:
        checkpoint_id = f"cp_{uuid.uuid4().hex[:10]}"
        cp = Checkpoint(
            checkpoint_id=checkpoint_id,
            session_id=session_id,
            seq=seq,
            label=label,
            created_at=utc_now_iso(),
            plan_version=plan.version,
            artifact_version=artifact.version,
            autonomy_level=adaptive_state.level,
            step_id=step_id,
        )
        snapshot = CheckpointSnapshot(
            checkpoint=cp,
            plan=plan.model_copy(deep=True),
            artifact=artifact.model_copy(deep=True),
            step_outputs=dict(step_outputs),
            session_status=session_status,
            requirements=list(requirements),
            active_instruction=active_instruction,
            adaptive_state=adaptive_state.model_copy(deep=True),
        )
        self.db.insert_checkpoint(snapshot)
        return cp

    def list_checkpoints(self, session_id: str) -> list[Checkpoint]:
        return self.db.list_checkpoints(session_id)

    def load_snapshot(
        self,
        session_id: str,
        checkpoint_id: str,
    ) -> CheckpointSnapshot:
        snapshot = self.db.get_checkpoint_snapshot(session_id, checkpoint_id)
        if snapshot is None:
            raise CheckpointNotFoundError(
                f"Checkpoint '{checkpoint_id}' not found for session '{session_id}'."
            )
        return snapshot

    def record_rollback(
        self,
        *,
        session_id: str,
        target_checkpoint_id: str,
        from_plan_version: int,
        to_plan_version: int,
        from_artifact_version: int,
        to_artifact_version: int,
    ) -> RollbackLogEntry:
        entry = RollbackLogEntry(
            rollback_id=f"rb_{uuid.uuid4().hex[:10]}",
            session_id=session_id,
            target_checkpoint_id=target_checkpoint_id,
            from_plan_version=from_plan_version,
            to_plan_version=to_plan_version,
            from_artifact_version=from_artifact_version,
            to_artifact_version=to_artifact_version,
            created_at=utc_now_iso(),
        )
        self.db.insert_rollback_log(entry)
        return entry

    def list_rollback_logs(self, session_id: str) -> list[RollbackLogEntry]:
        return self.db.list_rollback_logs(session_id)
