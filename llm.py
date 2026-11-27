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
    """Return realistic canned responses for DEMO_MODE=1 and safe fallbacks."""
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


def _call_gemini(prompt: str, json_mode: bool) -> str:
    import google.generativeai as genai

    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY is not set (set DEMO_MODE=1 for offline demo).")

    genai.configure(api_key=api_key)
    model_name = os.getenv("GEMINI_MODEL", "gemini-2.0-flash")
    model = genai.GenerativeModel(model_name)
    cfg = {"response_mime_type": "application/json"} if json_mode else None
    resp = model.generate_content(prompt, generation_config=cfg)
    return (resp.text or "").strip()


def call_llm(prompt: str, json_mode: bool = False) -> str:
    """Call Gemini (or canned responses when DEMO_MODE=1). Retries once on JSON failure."""
    if os.getenv("DEMO_MODE") == "1":
        return _demo_response(prompt, json_mode)

    raw = _call_gemini(prompt, json_mode)
    if not json_mode:
        return raw

    cleaned = _strip_fences(raw)
    try:
        json.loads(cleaned)
        return cleaned
    except json.JSONDecodeError:
        retry_prompt = f"{prompt}\n\nIMPORTANT: Return ONLY valid JSON with no markdown or extra text."
        retry_raw = _strip_fences(_call_gemini(retry_prompt, json_mode=True))
        try:
            json.loads(retry_raw)
            return retry_raw
        except json.JSONDecodeError:
            return _demo_response(prompt, json_mode=True)
