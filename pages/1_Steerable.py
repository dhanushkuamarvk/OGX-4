"""Steerable Agent UI (Person 1) conforming to the shared team contract."""

from __future__ import annotations

import html
import json
import sys
import time
from pathlib import Path

import streamlit as st

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import mock_agent as agent  # Swap to `import agent` when agent.py is ready

try:
    from logger import log_event
except ImportError:
    def log_event(participant_id, condition, task_id, event_type, step_id="", details=""):
        st.session_state.setdefault("steerable_stub_logs", []).append(
            (participant_id, condition, task_id, event_type, step_id, details)
        )

try:
    from questionnaire import render_questionnaire
except ImportError:
    def render_questionnaire(participant_id, condition, task_id):
        st.info(f"Questionnaire stub for `{participant_id}` · `{condition}` · `{task_id}` (add `questionnaire.py`).")

STATUS_COLORS = {
    "pending": ("#E2E8F0", "#334155"),
    "running": ("#DBEAFE", "#1D4ED8"),
    "done": ("#DCFCE7", "#166534"),
    "needs_approval": ("#FEF3C7", "#92400E"),
    "edited": ("#EDE9FE", "#5B21B6"),
    "deleted": ("#FEE2E2", "#991B1B"),
}
FALLBACK_TASK = {
    "task_id": "T1",
    "title": "Sample Budget Allocation",
    "prompt": "Recommend how to allocate a $100k Q4 budget across Engineering, Marketing, and Support.",
    "planted_error": {"step_index": 1, "wrong_fact_text": "Support team has 400 agents."},
}


def _pill(text: str, bg: str, fg: str = "#111827") -> str:
    safe = html.escape(text)
    return (
        f"<span style='display:inline-block;padding:2px 9px;border-radius:999px;"
        f"font-size:0.78rem;font-weight:600;background:{bg};color:{fg};margin-right:6px'>{safe}</span>"
    )


def _load_task(task_id: str) -> dict:
    tasks_file = ROOT / "tasks.json"
    if tasks_file.exists():
        tasks = json.loads(tasks_file.read_text(encoding="utf-8"))
        match = next((t for t in tasks if str(t.get("task_id")) == str(task_id)), None)
        if match:
            return match
        if tasks:
            return tasks[0]
    return FALLBACK_TASK


def _log(pid: str, tid: str, event_type: str, step_id: str = "", details: str = "") -> None:
    log_event(pid, "steerable", tid, event_type, step_id=step_id, details=details)


def _advance_once(state: dict, pid: str, tid: str) -> dict:
    prev = {s["id"]: s["status"] for s in state["steps"]}
    nxt = next((s for s in state["steps"] if s["status"] in ("running", "pending", "edited")), None)
    if nxt:
        _log(pid, tid, "step_started", step_id=nxt["id"], details=nxt["title"])
    state = agent.advance(state) or state
    pe = state.get("planted_error") or {}
    logged_pe = st.session_state.setdefault("steerable_pe_logged", set())
    for idx, s in enumerate(state["steps"]):
        if s["status"] != prev.get(s["id"]):
            if s["status"] == "done":
                _log(pid, tid, "step_done", step_id=s["id"], details=s["title"])
            elif s["status"] == "needs_approval":
                _log(pid, tid, "approval_requested", step_id=s["id"], details=s.get("why", ""))
            wrong = str(pe.get("wrong_fact_text") or "")
            if pe and s["id"] not in logged_pe and s["status"] in ("done", "needs_approval"):
                if (wrong and wrong.lower() in str(s.get("output", "")).lower()) or pe.get("step_index") == idx:
                    _log(pid, tid, "planted_error_injected", step_id=s["id"], details=wrong)
                    logged_pe.add(s["id"])
    return state


st.set_page_config(page_title="Steerable Agent", layout="wide")
pid = str(st.session_state.get("participant_id") or "P01")
tid = str(st.session_state.get("task_id") or "T1")
planted_on = bool(st.session_state.get("planted_errors_enabled", False))
task = _load_task(tid)
run_key = (pid, str(task["task_id"]), planted_on)

if st.session_state.get("steerable_run_key") != run_key or "steerable_state" not in st.session_state:
    pe_cfg = task.get("planted_error") if planted_on else None
    _log(pid, str(task["task_id"]), "session_start", details=f"planted_errors={planted_on}")
    init_state = agent.new_run(task["prompt"], constraints=[], planted_error=pe_cfg)
    _log(pid, str(task["task_id"]), "plan_generated", details=f"{len(init_state['steps'])} steps")
    st.session_state.update({
        "steerable_run_key": run_key,
        "steerable_state": init_state,
        "steerable_edit_id": None,
        "steerable_pe_logged": set(),
        "steerable_finished_ui": False,
    })

state = st.session_state["steerable_state"]
tid = str(task["task_id"])
waiting_approval = any(s["status"] == "needs_approval" for s in state["steps"])
finished = agent.is_finished(state)

st.title("Steerable Agent")
st.caption(f"Participant: `{pid}` · Task: **{task.get('title', tid)}** (`{tid}`) · Planted errors: `{planted_on}`")

# Top bar: Pause/Resume, Add step, Add constraint + constraint chips
bar1, bar2, bar3, bar4 = st.columns([1.0, 1.2, 2.2, 0.8])
with bar1:
    if state["paused"]:
        if st.button("▶ Resume", use_container_width=True, disabled=finished):
            state = agent.resume(state) or state
            _log(pid, tid, "resume")
            st.session_state["steerable_state"] = state
            st.rerun()
    else:
        if st.button("⏸ Pause", use_container_width=True, disabled=finished):
            state = agent.pause(state) or state
            _log(pid, tid, "pause")
            st.session_state["steerable_state"] = state
            st.rerun()
with bar2:
    with st.popover("➕ Add step", use_container_width=True):
        s_title = st.text_input("Step title", key="add_step_title")
        s_desc = st.text_area("Step description", key="add_step_desc", height=70)
        opts = [None] + [s["id"] for s in state["steps"] if s["status"] != "deleted"]
        after_id = st.selectbox("After step", opts, format_func=lambda x: "End of plan" if x is None else x)
        if st.button("Insert step", type="primary", use_container_width=True) and s_title.strip() and s_desc.strip():
            before_ids = {s["id"] for s in state["steps"]}
            state = agent.add_step(state, s_title.strip(), s_desc.strip(), after_id=after_id) or state
            new_id = next((s["id"] for s in state["steps"] if s["id"] not in before_ids), "")
            _log(pid, tid, "add_step", step_id=new_id, details=s_title.strip())
            st.session_state["steerable_state"] = state
            st.rerun()
with bar3:
    c_text = st.text_input("Add constraint", placeholder="Add constraint...", label_visibility="collapsed", key="c_input")
with bar4:
    if st.button("Add", use_container_width=True) and c_text.strip():
        state = agent.add_constraint(state, c_text.strip()) or state
        _log(pid, tid, "add_constraint", details=c_text.strip())
        st.session_state["steerable_state"] = state
        st.rerun()

if state["constraints"]:
    chips = "".join(_pill(c, "#E0F2FE", "#075985") for c in state["constraints"])
    st.markdown(f"**Constraints:** {chips}", unsafe_allow_html=True)

left_col, right_col = st.columns([1.25, 1.0], gap="large")

with left_col:
    st.subheader("Live Plan")
    for idx, step in enumerate(state["steps"]):
        sid, status = step["id"], step["status"]
        bg, fg = STATUS_COLORS.get(status, ("#E2E8F0", "#1E293B"))
        conf = step.get("confidence")
        conf_html = _pill(f"{conf:.0%}" if isinstance(conf, (int, float)) and conf <= 1 else str(conf), "#F1F5F9", "#334155") if conf is not None else ""
        with st.container(border=True):
            if status == "needs_approval":
                st.warning(f"⚠️ **Approval Needed — {idx + 1}. {step['title']}**")
            st.markdown(f"**{idx + 1}. {step['title']}** &nbsp;{_pill(status, bg, fg)}{conf_html}", unsafe_allow_html=True)
            st.write(step["description"])
            if status == "done" and step.get("why"):
                st.caption(f"Why: {step['why']}")

            if status == "needs_approval":
                a1, a2 = st.columns(2)
                if a1.button("✅ Approve", key=f"app_{sid}", type="primary", use_container_width=True):
                    state = agent.approve(state, sid) or state
                    _log(pid, tid, "approved", step_id=sid)
                    st.session_state["steerable_state"] = state
                    st.rerun()
                if a2.button("✏️ Edit-and-rerun", key=f"edr_{sid}", use_container_width=True):
                    st.session_state["steerable_edit_id"] = sid
                    st.rerun()
            elif status != "deleted":
                b1, b2 = st.columns(2)
                if b1.button("Edit", key=f"ed_{sid}", use_container_width=True):
                    st.session_state["steerable_edit_id"] = None if st.session_state["steerable_edit_id"] == sid else sid
                    st.rerun()
                if b2.button("Delete", key=f"del_{sid}", use_container_width=True):
                    state = agent.delete_step(state, sid) or state
                    _log(pid, tid, "delete_step", step_id=sid)
                    st.session_state["steerable_state"] = state
                    st.rerun()

            if st.session_state.get("steerable_edit_id") == sid:
                new_desc = st.text_area("Edit description", value=step["description"], key=f"txt_{sid}", height=80)
                s1, s2 = st.columns(2)
                if s1.button("Save & Apply", key=f"sav_{sid}", type="primary", use_container_width=True) and new_desc.strip():
                    state = agent.edit_step(state, sid, new_desc.strip()) or state
                    if state["paused"]:
                        state = agent.resume(state) or state
                    _log(pid, tid, "edit_step", step_id=sid, details=new_desc.strip())
                    st.session_state.update({"steerable_state": state, "steerable_edit_id": None})
                    st.rerun()
                if s2.button("Cancel", key=f"can_{sid}", use_container_width=True):
                    st.session_state["steerable_edit_id"] = None
                    st.rerun()

with right_col:
    st.subheader("Step Output & Result")
    latest = next((s for s in reversed(state["steps"]) if s.get("output") and s["status"] != "deleted"), None)
    if latest:
        with st.container(border=True):
            st.caption(f"Latest output — **{latest['title']}** (`{latest['status']}`)")
            st.markdown(latest["output"])
    else:
        st.info("Waiting for first step output...")

    if finished:
        st.success("Plan completed")
        with st.container(border=True):
            st.markdown(state["final_answer"])
        if not st.session_state.get("steerable_finished_ui"):
            if st.button("Finish task", type="primary", use_container_width=True):
                _log(pid, tid, "final_answer", details=str(state.get("final_answer") or ""))
                _log(pid, tid, "session_end")
                st.session_state["steerable_finished_ui"] = True
                st.rerun()
        else:
            render_questionnaire(pid, "steerable", tid)

if not state["paused"] and not waiting_approval and not finished:
    st.session_state["steerable_state"] = _advance_once(state, pid, tid)
    time.sleep(0.35)
    st.rerun()
