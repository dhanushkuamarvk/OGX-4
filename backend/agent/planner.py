"""Hierarchical planner with confidence calibration and minimal surgical replanning."""

from __future__ import annotations

import json
import re
import uuid
from dataclasses import dataclass

from backend.shared.llm_client import LLMClient
from backend.shared.prompts import (
    SHARED_SYSTEM_PROMPT,
    build_expand_step_prompt,
    build_interrupt_replan_prompt,
    build_planner_prompt,
    build_replan_prompt,
)
from backend.shared.schemas import ChatMessage, Plan, Step

AMBIGUITY_MARKERS: tuple[str, ...] = (
    "tbd",
    "unclear",
    "maybe",
    "possibly",
    "depending on",
    "trade-off",
    "tradeoff",
    "option",
    "estimate",
    "unknown",
    "assumption",
    "?",
)

CONCRETE_MARKERS: tuple[str, ...] = (
    "sla",
    "utc",
    "timeline",
    "p99",
    "rest",
    "checklist",
    "metric",
    "threshold",
    "owner",
)


@dataclass(frozen=True)
class PlanGenerationResult:
    plan: Plan
    tokens_in: int
    tokens_out: int
    latency_ms: float
    repair_attempted: bool = False
    parse_failed: bool = False
    parse_error: str | None = None


@dataclass(frozen=True)
class StepExpansionResult:
    substeps: list[Step]
    plan: Plan
    tokens_in: int
    tokens_out: int
    latency_ms: float


@dataclass(frozen=True)
class ReplanResult:
    plan: Plan
    invalidated_step_ids: list[str]
    preserved_locked_step_ids: list[str]
    preserved_edited_step_ids: list[str]
    added_step_ids: list[str]
    tokens_in: int
    tokens_out: int
    latency_ms: float


def _extract_json_object(raw: str) -> dict[str, object]:
    """Extract a JSON object even if wrapped in markdown code fences."""
    cleaned = raw.strip()
    fence_match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", cleaned, re.S)
    if fence_match:
        cleaned = fence_match.group(1)
    else:
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start != -1 and end != -1 and end > start:
            cleaned = cleaned[start : end + 1]
    parsed = json.loads(cleaned)
    if not isinstance(parsed, dict):
        raise ValueError("Expected JSON object from LLM planner.")
    return parsed


def _clamp_confidence(value: object, default: float = 0.75) -> float:
    try:
        numeric = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return default
    return round(max(0.05, min(0.99, numeric)), 3)


def calibrate_step_confidence(
    *,
    title: str,
    description: str,
    llm_confidence: float,
    task_prompt: str,
    requirements: list[str],
    user_edited: bool = False,
) -> float:
    """Calibrate LLM self-rated confidence with a transparent ambiguity heuristic.

    - Penalizes ambiguous / underspecified task inputs or step descriptions.
    - Gives a small boost for concrete specifications or direct user edits.
    """
    score = float(llm_confidence)
    combined = f"{title} {description}".lower()
    prompt_lower = task_prompt.lower()

    # Underspecified / vague overall prompt lowers confidence across steps
    if len(task_prompt.strip()) < 45:
        score -= 0.14
    elif "?" in prompt_lower or "tbd" in prompt_lower or "unclear" in prompt_lower:
        score -= 0.08

    # Ambiguity cues inside the step itself
    ambiguity_hits = sum(1 for cue in AMBIGUITY_MARKERS if cue in combined)
    score -= min(0.18, ambiguity_hits * 0.05)

    # Very terse description indicates higher uncertainty
    if len(description.strip()) < 28:
        score -= 0.08

    # Concrete operational details slightly raise confidence
    concrete_hits = sum(1 for cue in CONCRETE_MARKERS if cue in combined)
    score += min(0.06, concrete_hits * 0.02)

    # Extra unaddressed requirements introduce slight coordination uncertainty
    if requirements and not any(
        tok in combined
        for req in requirements
        for tok in re.findall(r"[a-z0-9_-]{5,}", req.lower())
    ):
        score -= 0.03

    if user_edited:
        score = max(score, 0.82)

    return _clamp_confidence(score)


class Planner:
    """Produces and maintains hierarchical Co-Plan step trees with lock & edit protection."""

    def __init__(self, llm_client: LLMClient) -> None:
        self.llm_client = llm_client

    def _parse_steps_from_json(
        self,
        raw_content: str,
        *,
        task_prompt: str,
        requirements: list[str],
    ) -> list[Step]:
        data = _extract_json_object(raw_content)
        raw_steps = data.get("steps")
        if not isinstance(raw_steps, list) or not raw_steps:
            raise ValueError("Planner JSON missing non-empty 'steps' array.")

        steps: list[Step] = []
        seen_ids: set[str] = set()
        for idx, item in enumerate(raw_steps, start=1):
            if not isinstance(item, dict):
                raise ValueError(f"Step entry #{idx} is not a JSON object.")
            step_id = str(item.get("id") or f"step_{idx}")
            if step_id in seen_ids:
                step_id = f"step_{idx}_{uuid.uuid4().hex[:4]}"
            seen_ids.add(step_id)
            raw_parent = item.get("parent_id")
            parent_id = str(raw_parent) if raw_parent else None
            title = str(item.get("title") or f"Step {idx}").strip()
            description = str(item.get("description") or title).strip()
            raw_conf = _clamp_confidence(item.get("confidence"), 0.78)
            calibrated = calibrate_step_confidence(
                title=title,
                description=description,
                llm_confidence=raw_conf,
                task_prompt=task_prompt,
                requirements=requirements,
            )
            steps.append(
                Step(
                    id=step_id,
                    parent_id=parent_id if parent_id in seen_ids else None,
                    title=title,
                    description=description,
                    status="pending",
                    confidence=calibrated,
                    locked=False,
                    user_edited=False,
                    output_ref=None,
                )
            )
        return steps

    async def create_plan(
        self,
        task_prompt: str,
        requirements: list[str],
    ) -> PlanGenerationResult:
        prompt = build_planner_prompt(task_prompt, requirements)
        response = await self.llm_client.complete(
            messages=[ChatMessage(role="user", content=prompt)],
            system_prompt=SHARED_SYSTEM_PROMPT,
            json_mode=True,
        )
        total_in = response.tokens_in
        total_out = response.tokens_out
        total_ms = response.latency_ms
        repair_attempted = False
        parse_failed = False
        parse_error: str | None = None

        steps: list[Step] = []
        try:
            steps = self._parse_steps_from_json(
                response.content,
                task_prompt=task_prompt,
                requirements=requirements,
            )
        except Exception as first_exc:
            # Repair ONCE on malformed or non-JSON planner output
            repair_attempted = True
            repair_prompt = (
                "Your previous planner response could not be parsed as valid JSON.\n"
                f"Parse error: {first_exc}\n"
                f"Previous output:\n{response.content[:1200]}\n\n"
                'Return ONLY a valid JSON object matching: {"steps": [{"id": "step_1", "parent_id": null, '
                '"title": "...", "description": "...", "confidence": 0.75}]}'
            )
            repair_resp = await self.llm_client.complete(
                messages=[ChatMessage(role="user", content=repair_prompt)],
                system_prompt=SHARED_SYSTEM_PROMPT,
                json_mode=True,
            )
            total_in += repair_resp.tokens_in
            total_out += repair_resp.tokens_out
            total_ms = round(total_ms + repair_resp.latency_ms, 2)
            try:
                steps = self._parse_steps_from_json(
                    repair_resp.content,
                    task_prompt=task_prompt,
                    requirements=requirements,
                )
            except Exception as second_exc:
                parse_failed = True
                parse_error = f"Malformed planner JSON after repair attempt: {second_exc}"

        if not steps:
            fallback_specs = [
                ("step_1", None, "Scope & Core Requirements", "Establish problem framing, assumptions, and goals.", 0.85),
                ("step_2", None, "Detailed Design & Analysis", "Draft the primary technical architecture and key trade-offs.", 0.72),
                ("step_3", None, "Implementation & Verification Plan", "Define milestones, owners, guardrails, and acceptance checks.", 0.79),
            ]
            steps = [
                Step(
                    id=sid,
                    parent_id=pid,
                    title=title,
                    description=desc,
                    confidence=calibrate_step_confidence(
                        title=title,
                        description=desc,
                        llm_confidence=conf,
                        task_prompt=task_prompt,
                        requirements=requirements,
                    ),
                )
                for sid, pid, title, desc, conf in fallback_specs
            ]

        plan = Plan(
            plan_id=f"plan_{uuid.uuid4().hex[:10]}",
            version=1,
            steps=steps,
        )
        return PlanGenerationResult(
            plan=plan,
            tokens_in=total_in,
            tokens_out=total_out,
            latency_ms=total_ms,
            repair_attempted=repair_attempted,
            parse_failed=parse_failed,
            parse_error=parse_error,
        )

    async def expand_step(
        self,
        *,
        task_prompt: str,
        plan: Plan,
        step_id: str,
        instruction: str | None = None,
    ) -> StepExpansionResult:
        target_index = next(
            (i for i, s in enumerate(plan.steps) if s.id == step_id),
            None,
        )
        if target_index is None:
            raise KeyError(f"Step '{step_id}' not found in plan '{plan.plan_id}'.")

        parent = plan.steps[target_index]
        prompt = build_expand_step_prompt(task_prompt, parent, instruction=instruction)
        response = await self.llm_client.complete(
            messages=[ChatMessage(role="user", content=prompt)],
            system_prompt=SHARED_SYSTEM_PROMPT,
            json_mode=True,
        )

        existing_ids = {s.id for s in plan.steps}
        existing_children = [s for s in plan.steps if s.parent_id == parent.id]
        next_child_num = len(existing_children) + 1

        substeps: list[Step] = []
        try:
            data = _extract_json_object(response.content)
            raw_substeps = data.get("substeps", [])
            if isinstance(raw_substeps, list):
                for item in raw_substeps[:4]:
                    if not isinstance(item, dict):
                        continue
                    candidate_id = f"{parent.id}_{next_child_num}"
                    while candidate_id in existing_ids:
                        next_child_num += 1
                        candidate_id = f"{parent.id}_{next_child_num}"
                    existing_ids.add(candidate_id)
                    next_child_num += 1
                    title = str(item.get("title") or f"{parent.title} — Part {next_child_num - 1}").strip()
                    desc = str(item.get("description") or parent.description).strip()
                    substeps.append(
                        Step(
                            id=candidate_id,
                            parent_id=parent.id,
                            title=title,
                            description=desc,
                            status="pending",
                            confidence=calibrate_step_confidence(
                                title=title,
                                description=desc,
                                llm_confidence=_clamp_confidence(item.get("confidence"), 0.78),
                                task_prompt=task_prompt,
                                requirements=[],
                            ),
                            locked=False,
                            user_edited=False,
                            output_ref=None,
                        )
                    )
        except Exception:
            substeps = []

        if not substeps:
            substeps = [
                Step(
                    id=f"{parent.id}_{next_child_num}",
                    parent_id=parent.id,
                    title=f"{parent.title}: Analysis",
                    description=f"Analyze constraints and options for {parent.title}.",
                    confidence=0.80,
                ),
                Step(
                    id=f"{parent.id}_{next_child_num + 1}",
                    parent_id=parent.id,
                    title=f"{parent.title}: Specification",
                    description=f"Draft concrete deliverables and verification criteria for {parent.title}.",
                    confidence=0.77,
                ),
            ]

        updated_steps = [s.model_copy(deep=True) for s in plan.steps]
        insert_at = target_index + 1
        while insert_at < len(updated_steps) and updated_steps[insert_at].parent_id == parent.id:
            insert_at += 1
        updated_steps[insert_at:insert_at] = substeps

        updated_plan = Plan(
            plan_id=plan.plan_id,
            version=plan.version + 1,
            steps=updated_steps,
        )
        return StepExpansionResult(
            substeps=substeps,
            plan=updated_plan,
            tokens_in=response.tokens_in,
            tokens_out=response.tokens_out,
            latency_ms=response.latency_ms,
        )

    def apply_user_step_edit(
        self,
        *,
        plan: Plan,
        step_id: str,
        title: str | None = None,
        description: str | None = None,
    ) -> tuple[Plan, Step, list[str]]:
        """Edit a step and mark unlocked, non-user-edited downstream steps as invalidated."""
        steps = [s.model_copy(deep=True) for s in plan.steps]
        idx = next((i for i, s in enumerate(steps) if s.id == step_id), None)
        if idx is None:
            raise KeyError(f"Step '{step_id}' not found in plan '{plan.plan_id}'.")

        target = steps[idx]
        if target.locked:
            raise PermissionError(f"Step '{step_id}' is locked. Unlock it before editing.")

        if title is not None and title.strip():
            target.title = title.strip()
        if description is not None and description.strip():
            target.description = description.strip()

        target.user_edited = True
        if target.status in {"done", "failed", "invalidated", "running"}:
            target.status = "pending"
        target.confidence = round(min(0.95, max(target.confidence, 0.82)), 3)

        invalidated: list[str] = []
        for downstream in steps[idx + 1 :]:
            # Locked and user-edited steps are NEVER overwritten or invalidated
            if downstream.locked or downstream.user_edited:
                continue
            if downstream.status in {"done", "running"}:
                downstream.status = "invalidated"
                invalidated.append(downstream.id)

        updated_plan = Plan(
            plan_id=plan.plan_id,
            version=plan.version + 1,
            steps=steps,
        )
        return updated_plan, target, invalidated

    def _apply_surgical_replan_payload(
        self,
        *,
        plan: Plan,
        data: dict[str, object],
        change_text: str,
        allow_new_steps: bool,
        cascade_downstream: bool = True,
        interrupted_step_id: str | None = None,
    ) -> tuple[Plan, list[str], list[str], list[str], list[str]]:
        """Apply LLM replan JSON while enforcing hard protection of locked & user-edited steps."""
        steps = [s.model_copy(deep=True) for s in plan.steps]
        step_by_id = {s.id: s for s in steps}
        preserved_locked = [s.id for s in steps if s.locked]
        preserved_edited = [s.id for s in steps if s.user_edited]

        def is_protected(step: Step) -> bool:
            return step.locked or step.user_edited

        invalidated_ids: list[str] = []
        added_ids: list[str] = []

        raw_invalidated = data.get("invalidated_step_ids", [])
        if isinstance(raw_invalidated, list):
            for sid in raw_invalidated:
                step = step_by_id.get(str(sid))
                if step is None or is_protected(step):
                    continue
                if step.status in {"done", "running", "pending"}:
                    step.status = "invalidated"
                    if step.id not in invalidated_ids:
                        invalidated_ids.append(step.id)

        raw_updated = data.get("updated_steps", [])
        if isinstance(raw_updated, list):
            for item in raw_updated:
                if not isinstance(item, dict):
                    continue
                sid = str(item.get("id", ""))
                step = step_by_id.get(sid)
                if step is None or is_protected(step):
                    continue
                if item.get("title"):
                    step.title = str(item["title"]).strip()
                if item.get("description"):
                    step.description = str(item["description"]).strip()
                if item.get("confidence") is not None:
                    step.confidence = _clamp_confidence(item.get("confidence"), 0.64)
                if step.status in {"done", "running", "pending"}:
                    step.status = "invalidated"
                if step.id not in invalidated_ids:
                    invalidated_ids.append(step.id)

        # Fallback if nothing mutable was flagged
        if not invalidated_ids:
            if interrupted_step_id and interrupted_step_id in step_by_id:
                cand = step_by_id[interrupted_step_id]
                if not is_protected(cand):
                    cand.status = "invalidated"
                    cand.description = f"{cand.description} [Steered: {change_text[:100]}]"
                    invalidated_ids.append(cand.id)
            if not invalidated_ids:
                for step in reversed(steps):
                    if not is_protected(step) and step.status != "skipped":
                        step.status = "invalidated"
                        step.description = f"{step.description} [Updated: {change_text[:100]}]"
                        step.confidence = min(step.confidence, 0.64)
                        invalidated_ids.append(step.id)
                        break

        # Mark unlocked, non-user-edited downstream steps affected by an invalidated step
        if cascade_downstream and invalidated_ids:
            first_idx = min(
                i for i, s in enumerate(steps) if s.id in set(invalidated_ids)
            )
            for downstream in steps[first_idx + 1 :]:
                if is_protected(downstream):
                    continue
                if downstream.status in {"done", "running"} and downstream.id not in invalidated_ids:
                    downstream.status = "invalidated"
                    invalidated_ids.append(downstream.id)

        if allow_new_steps:
            existing_ids = {s.id for s in steps}
            raw_new = data.get("new_steps", [])
            if isinstance(raw_new, list):
                for item in raw_new[:2]:
                    if not isinstance(item, dict):
                        continue
                    idx = len(steps) + 1
                    new_id = f"step_req_{idx}"
                    while new_id in existing_ids:
                        idx += 1
                        new_id = f"step_req_{idx}"
                    existing_ids.add(new_id)
                    steps.append(
                        Step(
                            id=new_id,
                            parent_id=None,
                            title=str(item.get("title") or "Mid-Task Requirement Alignment").strip(),
                            description=str(item.get("description") or change_text).strip(),
                            status="pending",
                            confidence=_clamp_confidence(item.get("confidence"), 0.62),
                            locked=False,
                            user_edited=False,
                            output_ref=None,
                        )
                    )
                    added_ids.append(new_id)

        updated_plan = Plan(
            plan_id=plan.plan_id,
            version=plan.version + 1,
            steps=steps,
        )
        return (
            updated_plan,
            invalidated_ids,
            preserved_locked,
            preserved_edited,
            added_ids,
        )

    async def replan_for_instruction(
        self,
        *,
        task_prompt: str,
        plan: Plan,
        new_instruction: str,
        interrupted_step_id: str | None = None,
    ) -> ReplanResult:
        """Re-plan ONLY affected steps for a mid-flight interrupt instruction."""
        prompt = build_interrupt_replan_prompt(
            task_prompt,
            plan,
            new_instruction,
            interrupted_step_id=interrupted_step_id,
        )
        response = await self.llm_client.complete(
            messages=[ChatMessage(role="user", content=prompt)],
            system_prompt=SHARED_SYSTEM_PROMPT,
            json_mode=True,
        )
        try:
            data = _extract_json_object(response.content)
        except Exception:
            data = {}

        (
            updated_plan,
            invalidated_ids,
            preserved_locked,
            preserved_edited,
            added_ids,
        ) = self._apply_surgical_replan_payload(
            plan=plan,
            data=data,
            change_text=new_instruction,
            allow_new_steps=False,
            cascade_downstream=True,
            interrupted_step_id=interrupted_step_id,
        )
        return ReplanResult(
            plan=updated_plan,
            invalidated_step_ids=invalidated_ids,
            preserved_locked_step_ids=preserved_locked,
            preserved_edited_step_ids=preserved_edited,
            added_step_ids=added_ids,
            tokens_in=response.tokens_in,
            tokens_out=response.tokens_out,
            latency_ms=response.latency_ms,
        )

    async def replan_for_requirement(
        self,
        *,
        task_prompt: str,
        plan: Plan,
        requirement_text: str,
    ) -> ReplanResult:
        """Minimal re-plan for a mid-task requirement change, preserving locked & user-edited steps."""
        prompt = build_replan_prompt(task_prompt, plan, requirement_text)
        response = await self.llm_client.complete(
            messages=[ChatMessage(role="user", content=prompt)],
            system_prompt=SHARED_SYSTEM_PROMPT,
            json_mode=True,
        )
        try:
            data = _extract_json_object(response.content)
        except Exception:
            data = {}

        (
            updated_plan,
            invalidated_ids,
            preserved_locked,
            preserved_edited,
            added_ids,
        ) = self._apply_surgical_replan_payload(
            plan=plan,
            data=data,
            change_text=requirement_text,
            allow_new_steps=True,
            cascade_downstream=True,
        )
        return ReplanResult(
            plan=updated_plan,
            invalidated_step_ids=invalidated_ids,
            preserved_locked_step_ids=preserved_locked,
            preserved_edited_step_ids=preserved_edited,
            added_step_ids=added_ids,
            tokens_in=response.tokens_in,
            tokens_out=response.tokens_out,
            latency_ms=response.latency_ms,
        )
