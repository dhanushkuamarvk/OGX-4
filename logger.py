"""Thread-safe CSV event logger (Person 4) matching the shared contract."""

from __future__ import annotations

import csv
import threading
from datetime import datetime, timezone
from pathlib import Path

LOGS_DIR = Path(__file__).resolve().parent / "logs"
EVENTS_CSV = LOGS_DIR / "events.csv"
COLUMNS = [
    "timestamp",
    "participant_id",
    "condition",
    "task_id",
    "event_type",
    "step_id",
    "details",
]
_LOCK = threading.Lock()


def log_event(
    participant_id: str,
    condition: str,
    task_id: str,
    event_type: str,
    step_id: str = "",
    details: str = "",
) -> None:
    """Append a single event row to logs/events.csv in a thread-safe manner."""
    ts = datetime.now(timezone.utc).isoformat()
    row = [
        ts,
        str(participant_id),
        str(condition),
        str(task_id),
        str(event_type),
        str(step_id),
        str(details),
    ]
    with _LOCK:
        LOGS_DIR.mkdir(parents=True, exist_ok=True)
        write_header = not EVENTS_CSV.exists() or EVENTS_CSV.stat().st_size == 0
        with EVENTS_CSV.open("a", newline="", encoding="utf-8") as fh:
            writer = csv.writer(fh)
            if write_header:
                writer.writerow(COLUMNS)
            writer.writerow(row)
