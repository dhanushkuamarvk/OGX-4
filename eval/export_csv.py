"""Export all JSONL raw logs under /eval/raw_logs into a single 14-column CSV."""

from __future__ import annotations

import csv
import json
import sys
from pathlib import Path

from backend.shared.schemas import TELEMETRY_COLUMNS, TelemetryEvent


def export_raw_logs_to_csv(
    raw_logs_dir: Path | str = "eval/raw_logs",
    output_csv: Path | str = "eval/raw_logs/telemetry_export.csv",
) -> tuple[Path, int]:
    raw_dir = Path(raw_logs_dir)
    out_path = Path(output_csv)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    # Read per-run {participant}_{task}_{condition}.jsonl files (avoiding double-counting telemetry_all.jsonl)
    files = sorted(
        p
        for p in raw_dir.glob("*.jsonl")
        if p.name not in {"telemetry_all.jsonl", "telemetry_export.jsonl"}
    )
    if not files and (raw_dir / "telemetry_all.jsonl").exists():
        files = [raw_dir / "telemetry_all.jsonl"]

    events: list[TelemetryEvent] = []
    for path in files:
        for line in path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            events.append(TelemetryEvent.model_validate(json.loads(line)))

    events.sort(key=lambda e: (e.ts, e.session_id))
    with out_path.open("w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=list(TELEMETRY_COLUMNS))
        writer.writeheader()
        for ev in events:
            writer.writerow(ev.to_csv_row())

    return out_path, len(events)


def main() -> int:
    raw_dir = sys.argv[1] if len(sys.argv) > 1 else "eval/raw_logs"
    out_csv = sys.argv[2] if len(sys.argv) > 2 else "eval/raw_logs/telemetry_export.csv"
    out_path, count = export_raw_logs_to_csv(raw_dir, out_csv)
    print(f"Exported {count} telemetry rows to {out_path.resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
