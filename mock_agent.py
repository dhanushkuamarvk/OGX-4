"""Temporary mock agent matching the shared contract agent.py API."""

from __future__ import annotations

from typing import Any


def new_run(
    task_text: str,
    constraints: list[str] | None = None,
    planted_error: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Initialize a new run state with a 4-step mock plan."""
    short_task = (task_text or "the assigned task").strip()
    steps = [
        {
            "id": "s1",
            "title": "Analyze task & constraints",
            "description": f"Break down goals and constraints for: {short_task}",
            "status": "pending",
            "output": "",
            "confidence": None,
            "why": "Establishes scope before gathering data.",
        },
        {
            "id": "s2",
            "title": "Gather key facts",
            "description": "Collect relevant metrics, trade-offs, and evidence.",
            "status": "pending",
            "output": "",
            "confidence": None,
            "why": "Grounds the recommendation in concrete facts.",
        },
        {
            "id": "s3",
            "title": "Draft recommendation",
            "description": "Propose an actionable plan aligned with constraints.",
            "status": "pending",
            "output": "",
            "confidence": None,
            "why": "High-impact decision point requiring user sign-off.",
        },
        {
            "id": "s4",
            "title": "Finalize summary",
            "description": "Synthesize final answer and double-check constraints.",
            "status": "pending",
            "output": "",
            "confidence": None,
            "why": "Produces a clear, constraint-checked deliverable.",
        },
    ]
    return {
        "steps": steps,
        "constraints": list(constraints or []),
        "paused": False,
        "final_answer": "",
        "planted_error": planted_error,
    }


def advance(state: dict[str, Any]) -> dict[str, Any]:
    """Execute at most ONE pending/edited step and return updated state."""
    if state.get("paused"):
        return state
    if any(s["status"] == "needs_approval" for s in state["steps"]):
        return state

    constraints_note = (
        f"Active constraints applied: {', '.join(state['constraints'])}."
        if state.get("constraints")
        else "No extra constraints specified."
    )
    pe = state.get("planted_error")

    for idx, step in enumerate(state["steps"]):
        if step["status"] in ("pending", "edited", "running"):
            was_edited = step["status"] == "edited"
            output = (
                f"**Executed:** {step['description']}\n\n"
                f"- {constraints_note}\n"
                f"- Mock result for `{step['title']}`."
            )
            conf = 0.91 if was_edited else 0.86

            if pe and pe.get("step_index") == idx and pe.get("wrong_fact_text"):
                output += f"\n- Note: {pe['wrong_fact_text']}"
                conf = 0.44
                step["why"] = "Low certainty on external figure; review recommended."

            step["output"] = output
            step["confidence"] = conf
            if step["id"] == "s3" and not was_edited:
                step["status"] = "needs_approval"
                step["confidence"] = 0.68
            else:
                step["status"] = "done"
            break

    if all(s["status"] in ("done", "deleted") for s in state["steps"]):
        done_titles = [s["title"] for s in state["steps"] if s["status"] == "done"]
        state["final_answer"] = (
            f"### Final Recommendation\n\n"
            f"Completed {len(done_titles)} step(s): {', '.join(done_titles)}.\n\n"
            f"{constraints_note}\n\n"
            f"Recommended next action: proceed with the validated plan above."
        )
    return state


def pause(state: dict[str, Any]) -> dict[str, Any]:
    state["paused"] = True
    return state


def resume(state: dict[str, Any]) -> dict[str, Any]:
    state["paused"] = False
    return state


def edit_step(state: dict[str, Any], step_id: str, new_description: str) -> dict[str, Any]:
    for step in state["steps"]:
        if step["id"] == step_id:
            step["description"] = new_description
            step["status"] = "edited"
            state["final_answer"] = ""
            break
    return state


def delete_step(state: dict[str, Any], step_id: str) -> dict[str, Any]:
    for step in state["steps"]:
        if step["id"] == step_id:
            step["status"] = "deleted"
            break
    if all(s["status"] in ("done", "deleted") for s in state["steps"]) and not state["final_answer"]:
        state["final_answer"] = "Final Recommendation: remaining steps completed."
    return state


def add_step(
    state: dict[str, Any],
    title: str,
    description: str,
    after_id: str | None = None,
) -> dict[str, Any]:
    new_id = f"s{len(state['steps']) + 1}"
    new_step = {
        "id": new_id,
        "title": title,
        "description": description,
        "status": "pending",
        "output": "",
        "confidence": None,
        "why": "User-added step to refine execution.",
    }
    if after_id is None:
        state["steps"].append(new_step)
    else:
        idx = next((i + 1 for i, s in enumerate(state["steps"]) if s["id"] == after_id), len(state["steps"]))
        state["steps"].insert(idx, new_step)
    state["final_answer"] = ""
    return state


def add_constraint(state: dict[str, Any], text: str) -> dict[str, Any]:
    if text and text not in state["constraints"]:
        state["constraints"].append(text)
    return state


def approve(state: dict[str, Any], step_id: str) -> dict[str, Any]:
    for step in state["steps"]:
        if step["id"] == step_id and step["status"] == "needs_approval":
            step["status"] = "done"
            step["why"] = "Approved by user."
            break
    return state


def is_finished(state: dict[str, Any]) -> bool:
    return bool(state.get("final_answer")) and all(
        s["status"] in ("done", "deleted") for s in state.get("steps", [])
    )
