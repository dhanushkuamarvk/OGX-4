"""LLM provider wrapper (Person 2) matching the shared contract."""

from __future__ import annotations

import json
import os
import re

try:
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:
    pass


class LLMError(RuntimeError):
    """Raised when an LLM call fails or returns invalid JSON outside DEMO_MODE=1."""


def _strip_fences(text: str) -> str:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
        cleaned = re.sub(r"\s*```$", "", cleaned)
    return cleaned.strip()


def _extract_line(prompt: str, prefix: str, default: str = "") -> str:
    for line in prompt.splitlines():
        if line.startswith(prefix):
            return line[len(prefix) :].strip()
    return default


def _demo_response(prompt: str, json_mode: bool) -> str:
    """Return realistic canned responses ONLY when DEMO_MODE=1."""
    if not json_mode:
        constraints = _extract_line(prompt, "Constraints:", "None")
        task = _extract_line(prompt, "Task:", "the assigned task")
        return (
            f"Final Recommendation for: {task}\n\n"
            f"Applied Constraints: {constraints}\n\n"
            "Summary: Based on the completed analysis, prioritize high-impact deliverables, "
            "incorporate the verified step findings above, and execute with explicit milestone checks."
        )

    lower = prompt.lower()
    if "create a plan" in lower or '"title"' in lower and '"description"' in lower:
        plan = [
            {"id": "s1", "title": "Define scope & criteria", "description": "Clarify objectives, stakeholders, and evaluation criteria."},
            {"id": "s2", "title": "Gather baseline data", "description": "Collect key figures, constraints, and current metrics."},
            {"id": "s3", "title": "Evaluate trade-offs", "description": "Compare candidate options and identify high-risk assumptions."},
            {"id": "s4", "title": "Draft recommendation", "description": "Formulate a concrete, constraint-compliant proposal."},
            {"id": "s5", "title": "Verify & finalize", "description": "Check consistency with constraints and summarize risks."},
        ]
        return json.dumps(plan)

    m = re.search(r"Step index:\s*(\d+)", prompt)
    idx = int(m.group(1)) if m else 0
    step_title = _extract_line(prompt, "Step title:", f"Step {idx + 1}")
    constraints = _extract_line(prompt, "Constraints:", "None")
    edited = "Status: edited" in prompt

    confidences = [4, 5, 2, 4, 5]
    conf = 4 if edited else confidences[idx % len(confidences)]
    why = (
        "Assumptions on risk trade-offs need human confirmation before proceeding."
        if conf < 3
        else f"Completed '{step_title}' using prior context and constraints ({constraints})."
    )
    return json.dumps(
        {
            "output": f"Executed '{step_title}'. Constraints considered: {constraints}. Key finding recorded for downstream synthesis.",
            "confidence": conf,
            "why": why,
        }
    )


def _expects_plan_list(prompt: str) -> bool:
    lower = prompt.lower()
    return "create a plan" in lower or "json list" in lower


def _validate_json(text: str, expect_list: bool = False) -> str:
    cleaned = _strip_fences(text)
    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError as exc:
        raise LLMError("invalid JSON") from exc

    if expect_list:
        valid = isinstance(parsed, list) or (
            isinstance(parsed, dict) and isinstance(parsed.get("steps"), list)
        )
        if not valid:
            raise LLMError(f"expected JSON list, got {type(parsed).__name__}")
    else:
        if not isinstance(parsed, dict):
            raise LLMError(f"expected JSON object, got {type(parsed).__name__}")
    return cleaned


def _call_gemini(prompt: str, json_mode: bool) -> str:
    try:
        import google.generativeai as genai
    except Exception as exc:
        raise LLMError(f"Gemini SDK unavailable: {exc}") from exc

    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key:
        raise LLMError("GEMINI_API_KEY is not set (set DEMO_MODE=1 for offline demo).")

    try:
        genai.configure(api_key=api_key)
        model_name = os.getenv("GEMINI_MODEL", "gemini-2.0-flash")
        model = genai.GenerativeModel(model_name)
        cfg = {"response_mime_type": "application/json"} if json_mode else None
        resp = model.generate_content(prompt, generation_config=cfg)
        return (resp.text or "").strip()
    except LLMError:
        raise
    except Exception as exc:
        raise LLMError(f"Gemini API error: {exc}") from exc


def call_llm(prompt: str, json_mode: bool = False) -> str:
    """Call Gemini (or canned responses ONLY when DEMO_MODE=1). Retries once on JSON failure."""
    if os.getenv("DEMO_MODE") == "1":
        return _demo_response(prompt, json_mode)

    raw = _call_gemini(prompt, json_mode)
    if not json_mode:
        if not raw:
            raise LLMError("Gemini returned an empty response.")
        return raw

    expect_list = _expects_plan_list(prompt)
    try:
        return _validate_json(raw, expect_list=expect_list)
    except LLMError:
        hint = (
            "Return ONLY a valid JSON list with no markdown or extra text."
            if expect_list
            else "Return ONLY a valid JSON object with no markdown or extra text."
        )
        retry_prompt = f"{prompt}\n\nIMPORTANT: {hint}"
        retry_raw = _call_gemini(retry_prompt, json_mode=True)
        try:
            return _validate_json(retry_raw, expect_list=expect_list)
        except LLMError as exc:
            raise LLMError("invalid JSON after retry") from exc
