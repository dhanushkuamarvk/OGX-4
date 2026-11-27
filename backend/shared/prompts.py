"""Shared system prompts and deterministic tools used by BOTH Co-Plan and Baseline.

Experimental control invariant:
Both conditions (coplan and baseline) MUST use the exact same SHARED_SYSTEM_PROMPT
and the exact same SHARED_TOOLS so the only independent variable is the
interaction model.
"""

from __future__ import annotations

import re
from typing import Any

from backend.shared.schemas import Artifact, Plan, Step, ToolAuditResult

SHARED_SYSTEM_PROMPT: str = """You are an expert collaborative engineering and strategy assistant working with a human partner to produce high-rigor, actionable technical documents.

Core quality standards:
1. Structure outputs cleanly in Markdown with clear headings, concrete specifics, owners, timelines, trade-offs, and measurable acceptance criteria.
2. Strictly honor every user constraint, mid-task requirement change, and protected/locked section without silently dropping earlier requirements.
3. Explicitly flag assumptions, risks, and areas of lower certainty instead of hiding uncertainty.
4. Keep prose crisp, dense with signal, and directly ready for stakeholder review.
"""


# ---------------------------------------------------------------------------
# Shared lightweight tools (available identically to both apps)
# ---------------------------------------------------------------------------


def extract_markdown_headings(markdown: str) -> list[str]:
    """Tool: extract all Markdown section headings from an artifact."""
    return [
        line.lstrip("#").strip()
        for line in markdown.splitlines()
        if line.strip().startswith("#")
    ]


def audit_artifact_constraints(
    content: str,
    constraints: list[str],
) -> ToolAuditResult:
    """Tool: audit a Markdown artifact for word count, headings, and constraint coverage."""
    words = re.findall(r"\b\w+\b", content)
    headings = extract_markdown_headings(content)
    lowered = content.lower()

    matched: list[str] = []
    missing: list[str] = []

    for constraint in constraints:
        keywords = [
            token
            for token in re.findall(r"[a-zA-Z0-9_-]{4,}", constraint.lower())
            if token not in {"that", "with", "from", "this", "must", "should", "have", "into", "only", "make"}
        ]
        if not keywords:
            matched.append(constraint)
            continue
        hits = sum(1 for kw in keywords if kw in lowered)
        if hits >= max(1, len(keywords) // 3):
            matched.append(constraint)
        else:
            missing.append(constraint)

    coverage = 1.0 if not constraints else round(len(matched) / len(constraints), 3)
    return ToolAuditResult(
        word_count=len(words),
        heading_count=len(headings),
        headings=headings,
        matched_constraints=matched,
        missing_constraints=missing,
        coverage_score=coverage,
    )


SHARED_TOOL_REGISTRY: dict[str, dict[str, Any]] = {
    "extract_markdown_headings": {
        "name": "extract_markdown_headings",
        "description": "Extract Markdown headings from the working document.",
        "callable": extract_markdown_headings,
    },
    "audit_artifact_constraints": {
        "name": "audit_artifact_constraints",
        "description": "Audit word count, headings, and requirement coverage in the working document.",
        "callable": audit_artifact_constraints,
    },
}


# ---------------------------------------------------------------------------
# Interaction-specific prompt builders (all inherit SHARED_SYSTEM_PROMPT)
# ---------------------------------------------------------------------------


def build_planner_prompt(task_prompt: str, requirements: list[str]) -> str:
    req_block = (
        "\n".join(f"- {r}" for r in requirements)
        if requirements
        else "(none yet)"
    )
    return (
        "TASK:\n"
        f"{task_prompt}\n\n"
        "ADDITIONAL REQUIREMENTS:\n"
        f"{req_block}\n\n"
        "Create a concise hierarchical execution plan (4-6 steps, optionally with child substeps via `parent_id`) "
        "to build the Markdown deliverable. "
        "Return ONLY valid JSON with key `steps`, where each item has:\n"
        '  {"id": "step_1", "parent_id": null, "title": "...", "description": "...", "confidence": 0.0-1.0}\n'
        "Assign realistic calibrated confidence scores (lower if requirements have ambiguity or risk)."
    )


def build_expand_step_prompt(
    task_prompt: str,
    step: Step,
    instruction: str | None = None,
) -> str:
    extra = f"\nUSER EXPANSION GUIDANCE:\n{instruction}\n" if instruction else ""
    return (
        f"TASK CONTEXT:\n{task_prompt}\n\n"
        f"STEP TO EXPAND:\n"
        f"- ID: {step.id}\n"
        f"- Title: {step.title}\n"
        f"- Description: {step.description}\n"
        f"{extra}\n"
        "Decompose this step into 2 to 3 concrete, actionable substeps. "
        "Return ONLY valid JSON with key `substeps`, where each item has:\n"
        '  {"title": "...", "description": "...", "confidence": 0.0-1.0}'
    )


def build_replan_prompt(
    task_prompt: str,
    plan: Plan,
    requirement_text: str,
) -> str:
    steps_summary = "\n".join(
        f"- [{s.id}] ({s.status}, locked={s.locked}, user_edited={s.user_edited}, conf={s.confidence:.2f}) {s.title}: {s.description}"
        for s in plan.steps
    )
    return (
        f"TASK CONTEXT:\n{task_prompt}\n\n"
        f"CURRENT PLAN (v{plan.version}):\n{steps_summary}\n\n"
        f"NEW MID-TASK REQUIREMENT CHANGE:\n{requirement_text}\n\n"
        "Rules:\n"
        "1. NEVER modify or invalidate any step where locked=True OR user_edited=True.\n"
        "2. Perform a MINIMAL re-plan: invalidate ONLY unlocked, unedited steps impacted by the change.\n"
        "Return ONLY valid JSON:\n"
        '{"invalidated_step_ids": ["..."], "updated_steps": [{"id": "...", "title": "...", "description": "...", "confidence": 0.7}], "new_steps": [{"title": "...", "description": "...", "confidence": 0.65}]}'
    )


def build_interrupt_replan_prompt(
    task_prompt: str,
    plan: Plan,
    new_instruction: str,
    interrupted_step_id: str | None = None,
) -> str:
    steps_summary = "\n".join(
        f"- [{s.id}] ({s.status}, locked={s.locked}, user_edited={s.user_edited}, conf={s.confidence:.2f}) {s.title}: {s.description}"
        for s in plan.steps
    )
    focus = f"\nINTERRUPTED STEP: {interrupted_step_id}\n" if interrupted_step_id else ""
    return (
        f"TASK CONTEXT:\n{task_prompt}\n\n"
        f"CURRENT PLAN (v{plan.version}):\n{steps_summary}\n"
        f"{focus}\n"
        f"MID-FLIGHT HUMAN STEERING INSTRUCTION:\n{new_instruction}\n\n"
        "Rules:\n"
        "1. NEVER overwrite or invalidate any step where locked=True OR user_edited=True.\n"
        "2. Re-plan ONLY the affected unlocked, unedited steps and mark downstream dependent steps invalidated.\n"
        "Return ONLY valid JSON:\n"
        '{"invalidated_step_ids": ["..."], "updated_steps": [{"id": "...", "title": "...", "description": "...", "confidence": 0.72}]}'
    )


def build_step_execution_prompt(
    task_prompt: str,
    step: Step,
    plan: Plan,
    artifact: Artifact,
    requirements: list[str],
    active_instruction: str | None = None,
) -> str:
    req_block = "\n".join(f"- {r}" for r in requirements) if requirements else "(none)"
    steer_block = (
        f"\nUSER STEERING INSTRUCTION:\n{active_instruction}\n"
        if active_instruction
        else ""
    )
    locked_titles = [s.title for s in plan.steps if s.locked]
    locked_block = ", ".join(locked_titles) if locked_titles else "none"
    existing_preview = artifact.content[-1800:] if artifact.content else "(empty document)"

    return (
        f"OVERALL TASK:\n{task_prompt}\n\n"
        f"CURRENT STEP TO EXECUTE:\n"
        f"- Step ID: {step.id}\n"
        f"- Title: {step.title}\n"
        f"- Description: {step.description}\n\n"
        f"ACTIVE REQUIREMENTS:\n{req_block}\n"
        f"LOCKED SECTIONS (DO NOT CONTRADICT OR ALTER): {locked_block}\n"
        f"{steer_block}\n"
        f"EXISTING ARTIFACT CONTEXT (tail):\n{existing_preview}\n\n"
        f"Write ONLY the Markdown body for the section `## {step.title}`. "
        "Include concrete bullet points, tables or checklists where useful, and explicit risk/assumption callouts."
    )


def build_baseline_user_prompt(
    task_prompt: str,
    user_message: str,
    requirements: list[str],
) -> str:
    """Format a baseline turn while preserving the exact shared system prompt."""
    req_block = (
        "\nActive constraints:\n" + "\n".join(f"- {r}" for r in requirements)
        if requirements
        else ""
    )
    return (
        f"Task brief:\n{task_prompt}\n"
        f"{req_block}\n\n"
        f"User message:\n{user_message}"
    )
