"""Analyze Co-Plan vs Baseline telemetry logs from /eval/raw_logs."""

from __future__ import annotations

import csv
import json
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from statistics import mean
from typing import Any


def parse_iso(ts: str) -> datetime:
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


def load_events(raw_logs_dir: Path) -> list[dict[str, Any]]:
    jsonl_all = raw_logs_dir / "telemetry_all.jsonl"
    if jsonl_all.exists():
        return [
            json.loads(line)
            for line in jsonl_all.read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]
    csv_files = sorted(raw_logs_dir.glob("*.csv"))
    if csv_files:
        rows: list[dict[str, Any]] = []
        for path in csv_files:
            with path.open("r", encoding="utf-8", newline="") as fh:
                rows.extend(csv.DictReader(fh))
        return rows
    return []


def summarize_sessions(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_session: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in events:
        by_session[str(row["session_id"])].append(row)

    summaries: list[dict[str, Any]] = []
    for session_id, rows in by_session.items():
        rows.sort(key=lambda r: parse_iso(str(r["ts"])))
        t0 = parse_iso(str(rows[0]["ts"]))
        t1 = parse_iso(str(rows[-1]["ts"]))
        duration_sec = round((t1 - t0).total_seconds(), 2)

        tokens_in = sum(int(float(r.get("tokens_in") or 0)) for r in rows)
        tokens_out = sum(int(float(r.get("tokens_out") or 0)) for r in rows)
        latencies = [float(r.get("latency_ms") or 0) for r in rows if float(r.get("latency_ms") or 0) > 0]

        event_counts: dict[str, int] = defaultdict(int)
        for r in rows:
            event_counts[str(r["event_type"])] += 1

        summaries.append(
            {
                "session_id": session_id,
                "participant_id": rows[0]["participant_id"],
                "condition": rows[0]["condition"],
                "task_id": rows[0]["task_id"],
                "events": len(rows),
                "duration_sec": duration_sec,
                "tokens_in": tokens_in,
                "tokens_out": tokens_out,
                "mean_latency_ms": round(mean(latencies), 1) if latencies else 0.0,
                "interrupts": event_counts["interrupt"],
                "locks": event_counts["step_lock"],
                "step_edits": event_counts["step_edited"],
                "artifact_edits": event_counts["artifact_edited"],
                "rollbacks": event_counts["rollback"],
                "requirement_changes": event_counts["requirement_changed"],
                "autonomy_changes": event_counts["autonomy_changed"],
            }
        )
    return summaries


def main() -> None:
    raw_dir = Path("eval/raw_logs")
    events = load_events(raw_dir)
    if not events:
        print(f"No telemetry logs found in {raw_dir.resolve()}.")
        return

    summaries = summarize_sessions(events)
    print(f"Loaded {len(events)} telemetry events across {len(summaries)} sessions.\n")

    by_condition: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for s in summaries:
        by_condition[str(s["condition"])].append(s)

    for condition, group in sorted(by_condition.items()):
        print(f"=== Condition: {condition.upper()} (n={len(group)}) ===")
        print(f"  Mean duration (s):     {mean(x['duration_sec'] for x in group):.2f}")
        print(f"  Mean tokens in/out:    {mean(x['tokens_in'] for x in group):.0f} / {mean(x['tokens_out'] for x in group):.0f}")
        print(f"  Mean LLM latency (ms): {mean(x['mean_latency_ms'] for x in group):.1f}")
        print(f"  Mean interrupts:       {mean(x['interrupts'] for x in group):.2f}")
        print(f"  Mean locks:            {mean(x['locks'] for x in group):.2f}")
        print(f"  Mean rollbacks:        {mean(x['rollbacks'] for x in group):.2f}")
        print()


if __name__ == "__main__":
    main()
