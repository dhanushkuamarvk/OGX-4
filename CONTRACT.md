# Shared Team Contract (Reconstructed)

> **Note:** The original `CONTRACT.md` was not present in the repository. This document is reconstructed directly from the actual signatures, schemas, and call sites in the codebase. Items that could not be confirmed from the code alone are explicitly marked **unverified**.

---

## 1. File Owners

| File | Owner | Source |
| :--- | :--- | :--- |
| `pages/1_Steerable.py` | Person 1 | Module docstring |
| `agent.py` | Person 2 | Module docstring |
| `llm.py` | Person 2 | Module docstring |
| `questionnaire.py` | Person 3 | Module docstring |
| `analysis.py` | Person 3 | Module docstring |
| `app.py` | Person 4 | Module docstring |
| `pages/2_Baseline.py` | Person 4 | Module docstring |
| `logger.py` | Person 4 | Module docstring |
| `mock_agent.py` | **unverified** (temporary mock scaffold) | No owner in docstring |
| `tasks.json`, `rubric.md`, `README.md`, `requirements.txt` | **unverified** | No owner specified |

---

## 2. Streamlit `st.session_state` Keys

### Shared Facilitator / Study Keys
Set by `app.py`, read by `pages/1_Steerable.py` and `pages/2_Baseline.py`:

| Key | Type | Values / Default |
| :--- | :--- | :--- |
| `participant_id` | `str` | e.g. `"P01"` (default `"P01"`) |
| `task_id` | `str` | Task ID from `tasks.json` (`"A"`–`"D"`; `app.py` defaults to first task / `"A"`, `2_Baseline.py` defaults to `"A"`, `1_Steerable.py` defaults to `"T1"` fallback) |
| `condition_order` | `str` | `"steerable_first"` (odd ID) or `"baseline_first"` (even ID) |
| `planted_errors_enabled` | `bool` | Facilitator toggle (`app.py` defaults `True`; pages default `False` if unset) |

### Page- & Component-Scoped Keys
- **Steerable (`pages/1_Steerable.py`)**:
  - `steerable_run_key: tuple[str, str, bool]` — `(participant_id, task_id, planted_errors_enabled)`
  - `steerable_state: dict[str, Any]` — active agent state dict
  - `steerable_edit_id: str | None` — step ID currently open for inline editing
  - `steerable_pe_logged: set[str]` — step IDs for which `planted_error_injected` was logged
  - `steerable_finished_ui: bool` — whether the participant clicked **Finish task**
  - `steerable_stub_logs: list[tuple]` — fallback log buffer used only if `logger` import fails
  - Widget keys: `add_step_title`, `add_step_desc`, `c_input`, `txt_{sid}`, `app_{sid}`, `edr_{sid}`, `ed_{sid}`, `del_{sid}`, `sav_{sid}`, `can_{sid}`
- **Baseline (`pages/2_Baseline.py`)**:
  - `baseline_run_key: tuple[str, str, bool]`
  - `baseline_answer: str`
  - `baseline_finished_ui: bool`
  - Widget key: `baseline_prompt_input`
- **Questionnaire (`questionnaire.py`)**:
  - `q_done_{participant_id}_{condition}_{task_id}: bool`
  - Form key: `q_form_{participant_id}_{condition}_{task_id}`

---

## 3. Logger API (`logger.py`)

```python
def log_event(
    participant_id: str,
    condition: str,
    task_id: str,
    event_type: str,
    step_id: str = "",
    details: str = "",
) -> None
```

- Thread-safe append (`threading.Lock`) to `logs/events.csv`.
- **CSV Columns:** `timestamp, participant_id, condition, task_id, event_type, step_id, details` (`timestamp` is UTC ISO-8601).
- **`condition` values:** `"steerable"` or `"baseline"`.
- **Observed `event_type` values:** `session_start`, `plan_generated`, `step_started`, `step_done`, `approval_requested`, `approved`, `planted_error_injected`, `pause`, `resume`, `edit_step`, `delete_step`, `add_step`, `add_constraint`, `final_answer`, `session_end` (note: `analysis.py` also recognizes short intervention aliases `edit`, `delete`, `add`, `constraint`; whether additional event types were originally specified is **unverified**).

---

## 4. LLM API (`llm.py`)

```python
def call_llm(prompt: str, json_mode: bool = False) -> str
```

- **Environment variables:**
  - `DEMO_MODE`: `"1"` enables offline canned responses (loaded via `python-dotenv` if installed).
  - `GEMINI_API_KEY`: Gemini API key used when `DEMO_MODE != "1"`.
  - `GEMINI_MODEL`: Gemini model name (default `"gemini-2.0-flash"`).
- **Behavior:**
  - When `json_mode=True`, strips markdown code fences and retries once on invalid JSON.
  - Original contract's exact exception class / failure handling policy when `DEMO_MODE != "1"` is **unverified** (current `llm.py` falls back to `_demo_response` on second `JSONDecodeError` and raises `RuntimeError` when `GEMINI_API_KEY` is unset).

---

## 5. Agent API (`agent.py` & `mock_agent.py`)

```python
def new_run(
    task_text: str,
    constraints: list[str] | None = None,
    planted_error: dict[str, Any] | None = None,
) -> dict[str, Any]

def advance(state: dict[str, Any]) -> dict[str, Any]
def pause(state: dict[str, Any]) -> dict[str, Any]
def resume(state: dict[str, Any]) -> dict[str, Any]
def edit_step(state: dict[str, Any], step_id: str, new_description: str) -> dict[str, Any]
def delete_step(state: dict[str, Any], step_id: str) -> dict[str, Any]
def add_step(
    state: dict[str, Any],
    title: str,
    description: str,
    after_id: str | None = None,
) -> dict[str, Any]
def add_constraint(state: dict[str, Any], text: str) -> dict[str, Any]
def approve(state: dict[str, Any], step_id: str) -> dict[str, Any]
def is_finished(state: dict[str, Any]) -> bool
```

### State Dictionary Structure
| Field | Type | Notes |
| :--- | :--- | :--- |
| `task_text` | `str` | Present in `agent.py`; omitted in `mock_agent.py` |
| `steps` | `list[dict[str, Any]]` | Ordered list of step dicts (5–6 steps generated by `agent.new_run`) |
| `constraints` | `list[str]` | Active user/task constraints |
| `paused` | `bool` | When `True`, `advance()` does not run steps |
| `final_answer` | `str` | Empty string until synthesized after all non-deleted steps are `done` |
| `planted_error` | `dict[str, Any] \| None` | `{"step_index": int, "wrong_fact_text": str}` or `None` |
| `planted_injected` | `bool` | Present in `agent.py` (`True` on the `advance()` that injects the error); omitted in `mock_agent.py` |
| `_planted_done` | `bool` | Internal flag set by `agent.py` after one-time injection (**unverified** whether part of original contract) |

### Step Dictionary Structure
| Field | Type | Notes |
| :--- | :--- | :--- |
| `id` | `str` | Unique step identifier (e.g. `"s1"`, `"s2"`, ...) |
| `title` | `str` | Short step title |
| `description` | `str` | Step instructions |
| `status` | `str` | `"pending"`, `"running"`, `"done"`, `"needs_approval"`, `"edited"`, `"deleted"` (exact transition semantics for `"running"` are **unverified**; neither `agent.py` nor `mock_agent.py` sets `"running"`) |
| `output` | `str` | Step execution output text |
| `confidence` | `int \| None` | Integer `1`–`5` in `agent.py` (`< 3` triggers `needs_approval`); `mock_agent.py` used `0.0`–`1.0` floats |
| `why` | `str` | Short rationale / explanation |

### Behavioral Guarantees (Observed in `agent.py`)
- `advance()` executes at most one step per call, never loops over multiple steps, and returns early while `paused` or any step has `status == "needs_approval"`.
- `confidence < 3` sets `status = "needs_approval"` and halts further steps until `approve(state, step_id)` (or edit-and-rerun).
- `edit_step`, `delete_step`, `add_step`, and `add_constraint` preserve earlier outputs, reset affected/subsequent non-deleted steps, skip `deleted` steps, and clear `final_answer`.

---

## 6. Questionnaire API (`questionnaire.py`)

```python
def render_questionnaire(participant_id: str, condition: str, task_id: str) -> None
```

- Renders post-task form (1–7 scales for NASA-TLX + subjective ratings, plus planted-error detection radio & free text) and appends to `logs/questionnaire.csv`.
- **CSV Columns:** `participant_id, condition, task_id, mental_demand, effort, frustration, control, understood, trust, noticed_error, error_description, timestamp`.
- **Blind Ratings CSV (`logs/ratings.csv`, consumed by `analysis.py`):** `participant_id, condition, rater, quality_score` (1–5 scale per `rubric.md`).

---

## 7. `tasks.json` Format

Top-level JSON array of task objects:

```json
[
  {
    "task_id": "A",
    "title": "Short task title",
    "prompt": "Full task instructions and constraints.",
    "planted_error": {
      "step_index": 1,
      "wrong_fact_text": "Incorrect fact injected at step_index."
    }
  }
]
```

- `task_id`: string identifier (currently `"A"`, `"B"`, `"C"`, `"D"`).
- `title`: display title string.
- `prompt`: prompt string passed to `agent.new_run` or baseline chat.
- `planted_error`: either `null` or `{"step_index": <0-based int>, "wrong_fact_text": <str>}`.
- Note: Whether additional optional keys (e.g., per-task default `constraints` list) were part of the original contract is **unverified** (current `tasks.json` has only the 4 keys above).
