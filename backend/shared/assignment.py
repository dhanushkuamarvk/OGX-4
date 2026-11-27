"""Session-assignment service backed by /eval/counterbalancing.csv."""

from __future__ import annotations

import csv
from pathlib import Path

from backend.shared.config import Settings
from backend.shared.db import Database
from backend.shared.schemas import Condition, ParticipantAssignment


class AssignmentNotFoundError(KeyError):
    """Raised when a participant_id is not listed in counterbalancing.csv."""


class AssignmentService:
    """Routes each participant to their counterbalanced app (condition) and task."""

    def __init__(
        self,
        *,
        db: Database,
        settings: Settings,
        csv_path: Path | str = "eval/counterbalancing.csv",
    ) -> None:
        self.db = db
        self.settings = settings
        self.csv_path = Path(csv_path)
        self._table: dict[str, tuple[list[Condition], list[str]]] = {}
        self.reload()

    def reload(self) -> None:
        self._table.clear()
        if not self.csv_path.exists():
            return
        with self.csv_path.open("r", encoding="utf-8", newline="") as fh:
            for row in csv.DictReader(fh):
                pid = row["participant_id"].strip().upper()
                conds = [
                    c.strip()
                    for c in row["condition_order"].split("|")
                    if c.strip() in {"coplan", "baseline"}
                ]
                tasks = [t.strip() for t in row["task_order"].split("|") if t.strip()]
                self._table[pid] = (conds, tasks)  # type: ignore[assignment]

    def _app_url_for(self, condition: Condition) -> str:
        if self.settings.single_host_mode:
            return f"http://{self.settings.backend_host}:{self.settings.backend_port}"
        port = (
            self.settings.coplan_frontend_port
            if condition == "coplan"
            else self.settings.baseline_frontend_port
        )
        return f"http://127.0.0.1:{port}"

    def list_assignments(self) -> list[ParticipantAssignment]:
        return [self.get_assignment(pid) for pid in sorted(self._table.keys())]

    def get_assignment(self, participant_id: str) -> ParticipantAssignment:
        pid = participant_id.strip().upper()
        if pid not in self._table:
            self.reload()
        if pid not in self._table:
            raise AssignmentNotFoundError(
                f"Participant '{participant_id}' not found in {self.csv_path}."
            )

        cond_order, task_order = self._table[pid]
        existing_sessions = [
            s
            for s in self.db.list_sessions()
            if s.participant_id.strip().upper() == pid
        ]
        completed_pairs = {
            (s.condition, s.task_id)
            for s in existing_sessions
            if s.status in {"done", "running", "paused", "rolled_back"}
        }

        total_rounds = min(len(cond_order), len(task_order))
        completed_rounds = 0
        next_idx: int | None = None
        for idx in range(total_rounds):
            pair = (cond_order[idx], task_order[idx])
            if pair in completed_pairs:
                completed_rounds += 1
            elif next_idx is None:
                next_idx = idx

        if next_idx is None:
            return ParticipantAssignment(
                participant_id=pid,
                condition_order=list(cond_order),
                task_order=list(task_order),
                completed_rounds=completed_rounds,
                next_round_index=None,
                next_condition=None,
                next_task_id=None,
                next_app_url=None,
                all_completed=True,
            )

        next_cond = cond_order[next_idx]
        next_task = task_order[next_idx]
        return ParticipantAssignment(
            participant_id=pid,
            condition_order=list(cond_order),
            task_order=list(task_order),
            completed_rounds=completed_rounds,
            next_round_index=next_idx,
            next_condition=next_cond,
            next_task_id=next_task,
            next_app_url=self._app_url_for(next_cond),
            all_completed=False,
        )
