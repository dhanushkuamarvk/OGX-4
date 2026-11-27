"""Generate a balanced 12-row Latin-square counterbalancing table for Co-Plan vs Baseline."""

from __future__ import annotations

import csv
from pathlib import Path

TASKS: tuple[str, str, str] = (
    "task_research_brief",
    "task_event_plan",
    "task_data_analysis",
)

# All 6 permutations of the 3 tasks (two balanced Latin squares) x 2 condition orders = 12 rows
TASK_PERMUTATIONS: tuple[tuple[str, str, str], ...] = (
    ("task_research_brief", "task_event_plan", "task_data_analysis"),
    ("task_event_plan", "task_data_analysis", "task_research_brief"),
    ("task_data_analysis", "task_research_brief", "task_event_plan"),
    ("task_research_brief", "task_data_analysis", "task_event_plan"),
    ("task_event_plan", "task_research_brief", "task_data_analysis"),
    ("task_data_analysis", "task_event_plan", "task_research_brief"),
)

CONDITION_ORDERS: tuple[tuple[str, str], ...] = (
    ("coplan", "baseline"),
    ("baseline", "coplan"),
)


def build_counterbalancing_rows(n_participants: int = 12) -> list[dict[str, str]]:
    """Build balanced Latin-square assignment rows (participant_id, condition_order, task_order)."""
    rows: list[dict[str, str]] = []
    # Pair every task permutation with both condition orders for exact balance across 12 rows
    combos: list[tuple[tuple[str, str], tuple[str, str, str]]] = []
    for cond_order in CONDITION_ORDERS:
        for perm in TASK_PERMUTATIONS:
            combos.append((cond_order, perm))

    for idx in range(n_participants):
        cond_order, task_perm = combos[idx % len(combos)]
        rows.append(
            {
                "participant_id": f"P{idx + 1:02d}",
                "condition_order": "|".join(cond_order),
                "task_order": "|".join(task_perm),
            }
        )
    return rows


def write_counterbalancing_csv(output_path: Path | str, n_participants: int = 12) -> Path:
    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    rows = build_counterbalancing_rows(n_participants)
    with path.open("w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(
            fh,
            fieldnames=["participant_id", "condition_order", "task_order"],
        )
        writer.writeheader()
        writer.writerows(rows)
    return path


def main() -> None:
    out = write_counterbalancing_csv(Path("eval/counterbalancing.csv"), n_participants=12)
    print(f"Wrote balanced 12-row Latin square to {out.resolve()}")


if __name__ == "__main__":
    main()
