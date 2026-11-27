"""Facilitator Home (Person 4) for configuring study sessions."""

from __future__ import annotations

import json
import re
from pathlib import Path

import streamlit as st

TASKS_PATH = Path(__file__).resolve().parent / "tasks.json"


def _load_tasks() -> list[dict]:
    if not TASKS_PATH.exists():
        return []
    return json.loads(TASKS_PATH.read_text(encoding="utf-8"))


def _suggest_order(participant_id: str) -> str:
    digits = re.findall(r"\d+", participant_id)
    if digits and int(digits[-1]) % 2 == 0:
        return "baseline_first"
    return "steerable_first"


st.set_page_config(page_title="Facilitator Home", page_icon="🧪", layout="centered")
st.title("🧪 Study Facilitator Setup")
st.caption("Configure participant session parameters before handing off to the participant.")

tasks = _load_tasks()
task_map = {str(t["task_id"]): t for t in tasks}

pid = st.text_input(
    "Participant ID",
    value=str(st.session_state.get("participant_id") or "P01"),
    help="Odd IDs suggest Steerable first; even IDs suggest Baseline first.",
).strip() or "P01"

suggested = _suggest_order(pid)
order_options = ["steerable_first", "baseline_first"]
default_idx = order_options.index(suggested)

if task_map:
    task_ids = list(task_map.keys())
    cur_tid = str(st.session_state.get("task_id") or task_ids[0])
    tid_idx = task_ids.index(cur_tid) if cur_tid in task_ids else 0
    task_id = st.selectbox(
        "Task Variant",
        options=task_ids,
        index=tid_idx,
        format_func=lambda k: f"{k} — {task_map[k].get('title', '')}",
    )
else:
    task_id = st.text_input("Task ID", value=str(st.session_state.get("task_id") or "A"))

condition_order = st.radio(
    "Condition Order (auto-suggested by Participant ID parity)",
    options=order_options,
    index=default_idx,
    format_func=lambda x: "Steerable → Baseline (Odd ID)" if x == "steerable_first" else "Baseline → Steerable (Even ID)",
    horizontal=True,
)

planted_errors_enabled = st.toggle(
    "Enable planted errors (facilitator-only; hidden from participant UI)",
    value=bool(st.session_state.get("planted_errors_enabled", True)),
)

st.session_state["participant_id"] = pid
st.session_state["task_id"] = task_id
st.session_state["condition_order"] = condition_order
st.session_state["planted_errors_enabled"] = planted_errors_enabled

st.divider()
st.subheader("Launch Condition Pages (Suggested Order)")

if condition_order == "steerable_first":
    ordered = [
        ("1st: Open Steerable Agent", "pages/1_Steerable.py", "primary"),
        ("2nd: Open Baseline Chat", "pages/2_Baseline.py", "secondary"),
    ]
else:
    ordered = [
        ("1st: Open Baseline Chat", "pages/2_Baseline.py", "primary"),
        ("2nd: Open Steerable Agent", "pages/1_Steerable.py", "secondary"),
    ]

col1, col2 = st.columns(2)
for col, (label, page_path, btn_type) in zip((col1, col2), ordered):
    with col:
        if st.button(label, type=btn_type, use_container_width=True):
            st.switch_page(page_path)
