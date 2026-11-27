"""Steerable agent engine (Person 2) matching the shared contract."""

from __future__ import annotations

import json
import os
from typing import Any

from llm import LLMError, call_llm


def _make_step(step_id: str, title: str, description: str) -> dict[str, Any]:
    return {
        "id": step_id,
        "title": title,
        "description": description,
        "status": "pending",
        "output": "",
        "confidence": None,
        "why": "",
    }


def _reset_from(steps: list[dict[str, Any]], start_idx: int) -> None:
    """Mark steps from start_idx onward as pending and clear their outputs."""
    for step in steps[start_idx:]:
        if step["status"] != "deleted":
            step["status"] = "pending"
            step["output"] = ""
            step["confidence"] = None
            step["why"] = ""


def _maybe_finalize(state: dict[str, Any]) -> None:
    """Generate final_answer once all non-deleted steps are done."""
    steps = state.get("steps", [])
    if state.get("final_answer"):
        return
    if steps and all(s["status"] in ("done", "deleted") for s in steps):
        outputs = "\n".join(
            f"- {s['title']}: {s['output']}" for s in steps if s["status"] == "done"
        )
        constraints = ", ".join(state.get("constraints", [])) or "None"
        prompt = (
            f"Synthesize a clear final recommendation.\n"
            f"Task: {state.get('task_text', '')}\n"
            f"Constraints: {constraints}\n"
            f"Completed step outputs:\n{outputs}"
        )
        try:
            answer = call_llm(prompt, json_mode=False)
            if not isinstance(answer, str) or not answer.strip():
                raise LLMError("Final answer response was empty.")
            state["final_answer"] = answer.strip()
            state["error"] = ""
        except LLMError as exc:
            state["error"] = str(exc)


def new_run(
    task_text: str,
    constraints: list[str] | None = None,
    planted_error: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Generate a 5-6 step plan as JSON and return initial state."""
    c_list = list(constraints or [])
    state: dict[str, Any] = {
        "task_text": task_text,
        "steps": [],
        "constraints": c_list,
        "paused": False,
        "final_answer": "",
        "planted_error": planted_error,
        "planted_injected": False,
        "error": "",
    }
    prompt = (
        "Create a plan of 5-6 steps as a JSON list of objects with keys "
        '"id", "title", "description".\n'
        f"Task: {task_text}\n"
        f"Constraints: {', '.join(c_list) or 'None'}"
    )
    try:
        raw = json.loads(call_llm(prompt, json_mode=True))
        items = raw.get("steps") if isinstance(raw, dict) else raw
        if not isinstance(items, list) or not items:
            raise LLMError("Plan response must be a non-empty JSON list.")

        steps: list[dict[str, Any]] = []
        for i, it in enumerate(items[:6]):
            if not isinstance(it, dict):
                raise LLMError("Each plan step must be a JSON object.")
            title = str(it.get("title") or "").strip()
            description = str(it.get("description") or "").strip()
            if not title or not description:
                raise LLMError("Each plan step must include non-empty title and description.")
            step_id = str(it.get("id") or f"s{i + 1}").strip() or f"s{i + 1}"
            steps.append(_make_step(step_id, title, description))
        state["steps"] = steps
    except (LLMError, json.JSONDecodeError, TypeError, ValueError) as exc:
        state["error"] = str(exc)
    return state


def advance(state: dict[str, Any]) -> dict[str, Any]:
    """Execute at most ONE pending/edited step and return updated state."""
    if state.get("paused"):
        return state
    if any(s["status"] == "needs_approval" for s in state["steps"]):
        return state
    state["planted_injected"] = False
    state["error"] = ""

    next_pair = next(
        ((i, s) for i, s in enumerate(state["steps"]) if s["status"] in ("pending", "edited")),
        None,
    )
    if next_pair is None:
        _maybe_finalize(state)
        return state

    idx, step = next_pair
    prev_outputs = "\n".join(
        f"- {s['title']}: {s['output']}"
        for s in state["steps"][:idx]
        if s["status"] == "done" and s.get("output")
    )
    constraints = ", ".join(state.get("constraints", [])) or "None"
    prompt = (
        'Execute this single step and return JSON {"output": str, "confidence": int 1-5, "why": str}.\n'
        f"Task: {state.get('task_text', '')}\n"
        f"Constraints: {constraints}\n"
        f"Step index: {idx}\n"
        f"Step title: {step['title']}\n"
        f"Step description: {step['description']}\n"
        f"Status: {step['status']}\n"
        f"Previous step outputs:\n{prev_outputs or 'None'}"
    )
    try:
        parsed = json.loads(call_llm(prompt, json_mode=True))
        if not isinstance(parsed, dict):
            raise LLMError("Step response must be a JSON object.")
        missing = [k for k in ("output", "confidence", "why") if k not in parsed]
        if missing:
            raise LLMError(f"Step response missing keys: {', '.join(missing)}")
        output = str(parsed["output"] or "").strip()
        if not output:
            raise LLMError("Step response has empty output.")
        try:
            conf = max(1, min(5, int(parsed["confidence"])))
        except (TypeError, ValueError) as exc:
            raise LLMError(f"Invalid confidence value: {parsed['confidence']!r}") from exc
        why = str(parsed["why"] or "").strip()
    except (LLMError, json.JSONDecodeError, TypeError, ValueError) as exc:
        step["status"] = "pending"
        state["error"] = str(exc)
        return state

    pe = state.get("planted_error")
    if (
        isinstance(pe, dict)
        and pe.get("step_index") == idx
        and pe.get("wrong_fact_text")
        and not state.get("_planted_done")
    ):
        fact = str(pe["wrong_fact_text"]).strip()
        if fact and fact not in output:
            output = f"{output} {fact}".strip()
        state["planted_injected"] = True
        state["_planted_done"] = True

    step["output"] = output
    step["confidence"] = conf
    step["why"] = why
    step["status"] = "needs_approval" if conf < 3 else "done"

    _maybe_finalize(state)
    return state


def pause(state: dict[str, Any]) -> dict[str, Any]:
    state["paused"] = True
    return state


def resume(state: dict[str, Any]) -> dict[str, Any]:
    state["paused"] = False
    return state


def edit_step(state: dict[str, Any], step_id: str, new_description: str) -> dict[str, Any]:
    steps = state["steps"]
    for i, step in enumerate(steps):
        if step["id"] == step_id:
            step["description"] = new_description
            step["status"] = "edited"
            step["output"] = ""
            step["confidence"] = None
            step["why"] = ""
            _reset_from(steps, i + 1)
            state["final_answer"] = ""
            break
    return state


def delete_step(state: dict[str, Any], step_id: str) -> dict[str, Any]:
    steps = state["steps"]
    for i, step in enumerate(steps):
        if step["id"] == step_id:
            step["status"] = "deleted"
            _reset_from(steps, i + 1)
            state["final_answer"] = ""
            state["error"] = ""
            _maybe_finalize(state)
            break
    return state


def add_step(
    state: dict[str, Any],
    title: str,
    description: str,
    after_id: str | None = None,
) -> dict[str, Any]:
    steps = state["steps"]
    existing = {s["id"] for s in steps}
    n = len(steps) + 1
    while f"s{n}" in existing:
        n += 1
    new_step = _make_step(f"s{n}", title, description)

    if after_id is None:
        insert_idx = len(steps)
    else:
        insert_idx = next((i + 1 for i, s in enumerate(steps) if s["id"] == after_id), len(steps))
    steps.insert(insert_idx, new_step)
    _reset_from(steps, insert_idx + 1)
    state["final_answer"] = ""
    return state


def add_constraint(state: dict[str, Any], text: str) -> dict[str, Any]:
    cleaned = (text or "").strip()
    if not cleaned or cleaned in state["constraints"]:
        return state
    state["constraints"].append(cleaned)
    steps = state["steps"]
    first_incomplete = next((i for i, s in enumerate(steps) if s["status"] not in ("done", "deleted")), None)
    if first_incomplete is not None:
        _reset_from(steps, first_incomplete)
    else:
        last_done = next((i for i in range(len(steps) - 1, -1, -1) if steps[i]["status"] == "done"), None)
        if last_done is not None:
            _reset_from(steps, last_done)
    state["final_answer"] = ""
    return state


def approve(state: dict[str, Any], step_id: str) -> dict[str, Any]:
    for step in state["steps"]:
        if step["id"] == step_id and step["status"] == "needs_approval":
            step["status"] = "done"
            break
    state["error"] = ""
    _maybe_finalize(state)
    return state


def is_finished(state: dict[str, Any]) -> bool:
    steps = state.get("steps", [])
    return bool(state.get("final_answer")) and all(s["status"] in ("done", "deleted") for s in steps)


if __name__ == "__main__":
    os.environ["DEMO_MODE"] = "1"
    state = new_run(
        "Recommend a Q4 cloud cost reduction plan.",
        constraints=["No downtime"],
        planted_error={"step_index": 1, "wrong_fact_text": "Idle GPUs cost $999,000/month."},
    )
    print(f"Plan generated: {[s['id'] + ':' + s['status'] for s in state['steps']]}")

    edited_once = False
    while not is_finished(state):
        state = advance(state)
        if state["planted_injected"]:
            print("-> planted_error_injected on step_index=1")
        if not edited_once and state["steps"][0]["status"] == "done" and state["steps"][1]["status"] == "done":
            edit_step(state, "s2", "Re-verify cloud metrics excluding idle GPU rumors.")
            edited_once = True
            print("-> edited s2; s2 status:", state["steps"][1]["status"], "s3 status:", state["steps"][2]["status"])
        for s in state["steps"]:
            if s["status"] == "needs_approval":
                print(f"-> needs_approval on {s['id']} (conf={s['confidence']}); approving...")
                approve(state, s["id"])

    print("Finished! Final answer:\n", state["final_answer"])
