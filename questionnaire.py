"""Post-task questionnaire component (Person 3) per shared contract."""

from __future__ import annotations

import csv
from datetime import datetime, timezone
from pathlib import Path

import streamlit as st

LOGS_DIR = Path(__file__).resolve().parent / "logs"
QUESTIONNAIRE_CSV = LOGS_DIR / "questionnaire.csv"
COLUMNS = [
    "participant_id",
    "condition",
    "task_id",
    "mental_demand",
    "effort",
    "frustration",
    "control",
    "understood",
    "trust",
    "noticed_error",
    "error_description",
    "timestamp",
]


def _save_response(row: list[object]) -> None:
    LOGS_DIR.mkdir(parents=True, exist_ok=True)
    write_header = not QUESTIONNAIRE_CSV.exists() or QUESTIONNAIRE_CSV.stat().st_size == 0
    with QUESTIONNAIRE_CSV.open("a", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        if write_header:
            writer.writerow(COLUMNS)
        writer.writerow(row)


def render_questionnaire(participant_id: str, condition: str, task_id: str) -> None:
    """Render post-task NASA-TLX / trust / error-detection form and append to logs/questionnaire.csv."""
    submitted_key = f"q_done_{participant_id}_{condition}_{task_id}"
    if st.session_state.get(submitted_key):
        st.success("Thank you! Your questionnaire response has been recorded.")
        return

    st.markdown("### Post-Task Questionnaire")
    st.caption("Rate each item from **1 (Very Low / Strongly Disagree)** to **7 (Very High / Strongly Agree)**.")

    with st.form(key=f"q_form_{participant_id}_{condition}_{task_id}"):
        mental_demand = st.slider("Mental demand (How mentally demanding was the task?)", 1, 7, 4)
        effort = st.slider("Effort (How hard did you have to work to accomplish your level of performance?)", 1, 7, 4)
        frustration = st.slider("Frustration (How irritated, stressed, or annoyed did you feel?)", 1, 7, 3)

        st.divider()
        control = st.slider("I felt in control of the AI", 1, 7, 4)
        understood = st.slider("I understood why the AI did what it did", 1, 7, 4)
        trust = st.slider("I trust the final recommendation", 1, 7, 4)

        st.divider()
        noticed_error = st.radio(
            "Did you notice any incorrect information?",
            options=["No", "Yes"],
            horizontal=True,
        )
        error_description = st.text_area(
            "What was it? (Leave blank if none)",
            placeholder="Describe any incorrect or suspicious spec, price, or claim you noticed...",
            height=80,
        )

        if st.form_submit_button("Submit Questionnaire", type="primary", use_container_width=True):
            timestamp = datetime.now(timezone.utc).isoformat()
            _save_response(
                [
                    participant_id,
                    condition,
                    task_id,
                    mental_demand,
                    effort,
                    frustration,
                    control,
                    understood,
                    trust,
                    noticed_error,
                    error_description.strip(),
                    timestamp,
                ]
            )
            st.session_state[submitted_key] = True
            st.rerun()
