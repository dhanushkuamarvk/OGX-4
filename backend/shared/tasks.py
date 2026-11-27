"""Standardized evaluation task loader shared by Co-Plan and Baseline."""

from __future__ import annotations

import json
from pathlib import Path

from backend.shared.schemas import TaskDefinition

DEFAULT_TASKS: list[TaskDefinition] = [
    TaskDefinition(
        task_id="task_research_brief",
        title="Municipal Urban Microgrid Policy Research Brief",
        domain="Policy & Energy Systems",
        difficulty="medium",
        estimated_minutes=12,
        prompt=(
            "Write a 2-page executive research brief advising a mid-sized city council on whether "
            "to fund two municipal solar-plus-storage microgrids for emergency resilience."
        ),
        materials="Bronzeville (71% outage reduction), Redwood Coast ($5.4M capex, 32% grant offset).",
        mid_task_requirement=(
            "Mid-task council directive: Allocate >=40% of benefits to low-income neighborhoods and "
            "cap municipal cash outlay at $2.5M. Do NOT alter the Empirical Evidence section."
        ),
        recommended_injection_minute=5,
        injection_trigger_progress=0.5,
        rubric_max_score=10,
        rubric_criteria=[
            "Accuracy & grounding in source packet figures (0-2 pts)",
            "Rigorous comparison of financing & regulatory trade-offs (0-2 pts)",
            "Full integration of 40% low-income equity rule & $2.5M cash cap (0-2 pts)",
            "Preservation of accurate empirical evidence without contradictions (0-2 pts)",
            "Clarity, executive structure, and concrete 18-month KPIs (0-2 pts)",
        ],
    ),
    TaskDefinition(
        task_id="task_event_plan",
        title="Annual Civic Tech Summit Event Plan & Run-of-Show",
        domain="Operations & Event Management",
        difficulty="medium",
        estimated_minutes=12,
        prompt=(
            "Produce a complete operational event plan and day-of run-of-show for a 1-day, "
            "250-attendee Civic Tech Summit under $38,000 with 10% contingency."
        ),
        materials="Main Hall $9,500 + 3 Breakouts $4,500; Catering $46/pp; AV $6,200; Livestream +$3,800.",
        mid_task_requirement=(
            "Mid-task sponsor update: Budget cut to $31,000 AND add live-captioned hybrid stream "
            "for 200 remote attendees. Keep the morning Keynote schedule (ending before 10:30 AM) untouched."
        ),
        recommended_injection_minute=5,
        injection_trigger_progress=0.5,
        rubric_max_score=10,
        rubric_criteria=[
            "Feasible full-day schedule honoring 10:30 AM keynote constraint (0-2 pts)",
            "Budget mathematically reconciled under $31,000 cap with contingency (0-2 pts)",
            "Hybrid livestream & ADA live-captioning operational plan (0-2 pts)",
            "Venue routing, dietary, staffing, and contingency coverage (0-2 pts)",
            "Actionability and clarity for a day-of operations team (0-2 pts)",
        ],
    ),
    TaskDefinition(
        task_id="task_data_analysis",
        title="B2B SaaS Q3 Retention & Churn Data-Analysis Report",
        domain="Product Analytics & Strategy",
        difficulty="hard",
        estimated_minutes=12,
        prompt=(
            "Analyze the Q1-Q3 SaaS cohort dataset and write an executive data-analysis report "
            "diagnosing the Q3 churn spike with 3 prioritized retention experiments."
        ),
        materials="SMB churn 3.1%->5.4% (activation 66%->49%); Mid-Market 1.5%->2.1% (billing bug); Jul 12-15 NULL outage.",
        mid_task_requirement=(
            "Mid-task CFO request: Refocus recommendations for the Board on protecting Q4 Mid-Market "
            "& Enterprise ARR ($600k at risk), add July 12-15 NULL sensitivity note, do NOT alter Dataset Audit."
        ),
        recommended_injection_minute=5,
        injection_trigger_progress=0.5,
        rubric_max_score=10,
        rubric_criteria=[
            "Accurate quantitative synthesis of SMB, Mid-Market, and Enterprise trends (0-2 pts)",
            "Rigorous root-cause separation (SMB onboarding wizard vs. Mid-Market billing bug) (0-2 pts)",
            "Explicit sensitivity treatment of July 12-15 NULL analytics outage (0-2 pts)",
            "Board-focused Q4 Mid-Market/Enterprise ARR protection plan (0-2 pts)",
            "Coherence, executive polish, and preserved Dataset Audit consistency (0-2 pts)",
        ],
    ),
]


class TaskRepository:
    """Loads evaluation tasks from /eval/tasks/tasks.json with safe built-in defaults."""

    def __init__(self, tasks_path: Path | str | None = None) -> None:
        self.tasks_path = Path(tasks_path) if tasks_path else None
        self._tasks: dict[str, TaskDefinition] = {}
        self.reload()

    def reload(self) -> None:
        tasks = list(DEFAULT_TASKS)
        if self.tasks_path and self.tasks_path.exists():
            raw = json.loads(self.tasks_path.read_text(encoding="utf-8"))
            tasks = [TaskDefinition.model_validate(item) for item in raw]
        self._tasks = {t.task_id: t for t in tasks}

    def list_tasks(self) -> list[TaskDefinition]:
        return list(self._tasks.values())

    def get_task(self, task_id: str) -> TaskDefinition | None:
        return self._tasks.get(task_id)

    def resolve_prompt(self, task_id: str, initial_prompt: str | None = None) -> str:
        if initial_prompt and initial_prompt.strip():
            return initial_prompt.strip()
        task = self.get_task(task_id)
        if task is not None:
            if task.materials:
                return f"{task.prompt}\n\nSOURCE MATERIALS:\n{task.materials}"
            return task.prompt
        return (
            f"Produce a well-structured Markdown deliverable for task `{task_id}` "
            "with clear headings, concrete action items, trade-offs, and verification criteria."
        )
