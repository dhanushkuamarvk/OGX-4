"""Baseline plain-chat interface (Person 4) matching the shared contract."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import streamlit as st

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from llm import call_llm
from logger import log_event

try:
    from questionnaire import render_questionnaire
except ImportError:
    def render_questionnaire(participant_id, condition, task_id):
        st.info(f"Questionnaire stub for `{participant_id}` · `{condition}` · `{task_id}`.")


def _load_task(task_id: str) -> dict:
    tasks_path = ROOT / "tasks.json"
    if tasks_path.exists():
        tasks = json.loads(tasks_path.read_text(encoding="utf-8"))
        match = next((t for t in tasks if str(t.get("task_id")) == str(task_id)), None)
        if match:
            return match
        if tasks:
            return tasks[0]
    return {
        "task_id": task_id,
        "title": "Research Task",
        "prompt": "Research the assigned topic under constraints and provide a recommendation.",
        "planted_error": None,
    }


st.set_page_config(page_title="Baseline Chat", page_icon="💬", layout="centered")
pid = str(st.session_state.get("participant_id") or "P01")
tid = str(st.session_state.get("task_id") or "A")
planted_on = bool(st.session_state.get("planted_errors_enabled", False))
task = _load_task(tid)
tid = str(task["task_id"])
run_key = (pid, tid, planted_on)

if st.session_state.get("baseline_run_key") != run_key:
    log_event(pid, "baseline", tid, "session_start")
    st.session_state.update(
        {
            "baseline_run_key": run_key,
            "baseline_answer": "",
            "baseline_finished_ui": False,
        }
    )

st.title("💬 AI Assistant")
st.caption(f"Participant: `{pid}` · Task: **{task.get('title', tid)}** (`{tid}`)")

with st.container(border=True):
    st.markdown("**Task Instructions**")
    st.write(task.get("prompt", ""))

user_prompt = st.text_area(
    "Your prompt",
    placeholder="Write your prompt for the AI assistant...",
    height=130,
    key="baseline_prompt_input",
)

if st.button("Send", type="primary", use_container_width=True):
    if not user_prompt.strip():
        st.warning("Please enter a prompt before sending.")
    else:
        with st.spinner("Generating response..."):
            full_prompt = f"Task: {task.get('prompt', '')}\n\nUser request:\n{user_prompt.strip()}"
            answer = call_llm(full_prompt, json_mode=False)

        pe = task.get("planted_error")
        if planted_on and isinstance(pe, dict) and pe.get("wrong_fact_text"):
            wrong_fact = str(pe["wrong_fact_text"]).strip()
            if wrong_fact and wrong_fact not in answer:
                answer = f"{answer}\n\n{wrong_fact}"
            log_event(pid, "baseline", tid, "planted_error_injected", details=wrong_fact)

        st.session_state["baseline_answer"] = answer
        log_event(pid, "baseline", tid, "final_answer", details=answer)

answer = st.session_state.get("baseline_answer", "")
if answer:
    st.subheader("Response")
    with st.container(border=True):
        st.markdown(answer)

    if not st.session_state.get("baseline_finished_ui"):
        if st.button("Finish task", type="primary", use_container_width=True):
            log_event(pid, "baseline", tid, "session_end")
            st.session_state["baseline_finished_ui"] = True
            st.rerun()
    else:
        st.divider()
        render_questionnaire(pid, "baseline", tid)
