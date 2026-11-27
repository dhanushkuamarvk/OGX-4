"""Export telemetry events from SQLite into JSONL and CSV under eval/raw_logs."""

from __future__ import annotations

from pathlib import Path

from backend.shared.config import get_settings
from backend.shared.db import Database
from backend.shared.telemetry import TelemetryLogger


def main() -> None:
    cfg = get_settings()
    db = Database(cfg.resolved_db_path())
    telemetry = TelemetryLogger(db, cfg.resolved_telemetry_dir())
    out_dir = cfg.resolved_telemetry_dir()

    csv_path = telemetry.write_csv(out_dir / "telemetry_all.csv")
    jsonl_path = Path(out_dir / "telemetry_export.jsonl")
    jsonl_path.write_text(telemetry.export_jsonl(), encoding="utf-8")

    count = len(telemetry.get_events())
    print(f"Exported {count} telemetry rows:")
    print(f"  CSV:   {csv_path}")
    print(f"  JSONL: {jsonl_path}")


if __name__ == "__main__":
    main()
