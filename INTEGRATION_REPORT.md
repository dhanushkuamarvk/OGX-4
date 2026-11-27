# Integration Report

**Verdict: `NOT READY`**

> Live-API end-to-end verification (`DEMO_MODE` unset + real `GEMINI_API_KEY` + full `agent.py` and UI walkthrough) has **not passed** because `GEMINI_API_KEY` is not available to the execution environment and the built-in browser could not attach to Chrome (`DevToolsActivePort` missing).

---

## 1. Files Inspected

| File | Role / Scope Inspected |
| :--- | :--- |
| `pages/1_Steerable.py` | Steerable Agent Streamlit UI, state wiring, confidence/rationale rendering, telemetry calls, error handling |
| `pages/2_Baseline.py` | Baseline Chat Streamlit UI, `call_llm` usage, planted-error injection, telemetry calls |
| `app.py` | Facilitator Home, parity-based counterbalancing, task selection, `session_state` initialization |
| `agent.py` | Agent state machine (`new_run`, `advance`, `pause`, `resume`, `edit_step`, `delete_step`, `add_step`, `add_constraint`, `approve`, `is_finished`) |
| `mock_agent.py` | Temporary mock agent scaffold (verified untouched against `agent.py` contract) |
| `llm.py` | Gemini API wrapper, `DEMO_MODE=1` canned responder, JSON validation and retry logic |
| `logger.py` | Thread-safe CSV event logger (`logs/events.csv`) |
| `questionnaire.py` | Post-task NASA-TLX, control/understanding/trust, and error-detection form (`logs/questionnaire.csv`) |
| `analysis.py` | Paired Wilcoxon, Cohen's $d_z$, 95% CI, Cohen's $\kappa$, $\text{ICC}(2,1)$, `--fake` synthetic data generator |
| `tasks.json` | Study task variants `A`–`D` and `planted_error` configs |
| `rubric.md` | 5-dimension 1–5 blind evaluation rubric and adjudication protocol |
| `README.md` | Setup, configuration, study procedure, and analysis commands |
| `requirements.txt` | Python package dependencies (`streamlit`, `google-generativeai`, `python-dotenv`, `pandas`, `numpy`, `scipy`, `matplotlib`) |
| `results.csv` | Existing synthetic validation output from `analysis.py --fake` |
| `logs/events.csv` | Existing event telemetry (135 lines: synthetic `--fake` rows + pre-Phase-2 `mock_agent.py` rows) |
| `logs/questionnaire.csv` | Existing synthetic questionnaire rows (`P01`–`P10`) |
| `logs/ratings.csv` | Existing synthetic 2-rater rows (`R1`, `R2` for `P01`–`P10`) |
| `.gitignore` | Confirmed `.env` is gitignored |
| `.env` *(key names only)* | Checked key names via Python (`GEMINI_API_KEY` absent; secrets not read or printed) |
| `CONTRACT.md` *(initial absence)* | Confirmed missing before Phase 2 FIX 0 |

---

## 2. Files Modified & Created (Diff Summary)

### Modified Code Files (`git diff --numstat` relative to index)
*(Note: `agent.py` also carries `7 insertions / 1 deletion` already staged in the git index prior to Phase 2. `mock_agent.py` has **0 changes**.)*

| File | Diff Stat (Unstaged) | Summary of Changes |
| :--- | :---: | :--- |
| **`llm.py`** | `+61 / -20` | Added `LLMError(RuntimeError)` class; enforced JSON type validation (`_expects_plan_list`, `_validate_json`) requiring dict for step execution and list or `{"steps": [...]}` for plan generation; preserved single retry; removed `_demo_response` fallback outside `DEMO_MODE=1` so failed retry raises `LLMError("invalid JSON after retry")`; wrapped missing SDK, missing `GEMINI_API_KEY`, empty non-JSON text, and Gemini API exceptions into `LLMError`. |
| **`agent.py`** | `+64 / -29` | Imported `LLMError`; added `state["error"]` initialization and clearing; validated plan dicts (`title`/`description`), step dicts (`output`/`confidence`/`why`), and non-empty final synthesis; caught `(LLMError, json.JSONDecodeError, TypeError, ValueError)` in `new_run()`, `advance()`, and `_maybe_finalize()` without crashing (leaving failed step `pending`); moved `state["planted_injected"] = False` after `paused` / `needs_approval` early returns in `advance()`; guarded `add_constraint()` to ignore blank or duplicate constraints without resetting steps or clearing `final_answer`. |
| **`pages/1_Steerable.py`** | `+53 / -20` | Switched `import mock_agent as agent` to `import agent`; changed confidence pill formatting from percent to `f"{conf}/5"`; displayed `Why:` for both `done` and `needs_approval` steps; replaced output/index planted-error heuristic with `state.get("planted_injected") is True` logged once per step; added `agent_error` logging, inline error banner, **Retry** button, and auto-advance halt on `state.get("error")`; reset `steerable_finished_ui` when mutating the plan (`add_step`, `add_constraint`, `delete_step`, `edit_step`); rendered `"running"` as a neutral badge; added visible `DEMO MODE` warning banner and `demo=true` in `session_start` details when `DEMO_MODE=1`. |
| **`mock_agent.py`** | `0 / 0` | **Untouched** (retained as original scaffold). |

### Newly Created Documentation & Reports
- **`CONTRACT.md`** — Reconstructed shared team contract (file owners, `session_state` keys, `logger`/`llm`/`agent`/`questionnaire` APIs, `tasks.json` format, with unverified original clauses explicitly marked).
- **`SUBMISSION.md`** — Topic 3 HAI submission (**SteerPlan**): concept name, one-line principle, four HAI pillars mapped to features/files, Mermaid architecture diagram, run instructions, and 2-minute demo script.
- **`EVALUATION.md`** — Topic 3 evaluation design & results: success criteria, within-subjects parity-counterbalanced protocol, planted-error trust test, metrics table with justifications/limitations, statistical plan, synthetic `--fake` pipeline validation section (marked *NOT real evidence*), empty real participant tables (`PENDING`), failure cases, and reproduction steps.
- **`INTEGRATION_REPORT.md`** — This integration verification report.

---

## 3. Integration Status

| Interface / Integration Link | Status | Details |
| :--- | :---: | :--- |
| **`pages/1_Steerable.py` ↔ `agent.py`** | **Integrated (Offline Verified)** | All 10 contract functions, state/step schemas, `f"{conf}/5"` display, `why` on `needs_approval`, `planted_injected` flag, `state["error"]`/Retry UI, and `DEMO_MODE=1` banner align and compile cleanly. |
| **`agent.py` ↔ `llm.py`** | **Integrated (Offline & Fault-Injected Verified)** | `DEMO_MODE=1` full run passes; broken/wrong-type mocked Gemini responses trigger 1 retry and raise `LLMError` without canned fallback, leaving failed steps `pending` with `state["error"]` set. Live Gemini API execution remains **unverified**. |
| **`pages/1_Steerable.py` ↔ `logger.py` & `questionnaire.py`** | **Code-Aligned (Live Browser Unverified)** | `log_event` and `render_questionnaire` signatures match; live Streamlit click-through writing a complete real-mode session (`session_start` → `plan_generated` → `step_done` → `approval_requested` → `final_answer` → `session_end`) has not run yet. |
| **`app.py` ↔ `pages/2_Baseline.py` ↔ `llm.py`** | **Partial (Minor Gap on Baseline Error Handling)** | `app.py` session state handoff and `tasks.json` loading align, but `pages/2_Baseline.py` calls `call_llm()` without `try/except LLMError` and lacks a `DEMO MODE` banner (not modified per Phase 2 scope). |
| **`analysis.py` ↔ `logs/*.csv` ↔ `rubric.md`** | **Pipeline Validated (Synthetic Only)** | Synthetic `--fake` pipeline outputs (`results.csv`, `results_chart.png`) exist and match schema; real study logs and blind rater scores are not yet collected. Note: `analysis.py` pools `planted_error_caught` across all tasks rather than isolating `A`/`C`. |
| **Live Gemini API (`llm.py` → Google Gemini)** | **Blocked / Unverified** | `GEMINI_API_KEY` is missing in `.env`, fresh shells, and Windows User/Machine environment variables; `llm.py` also uses deprecated `google.generativeai` (emits `FutureWarning`). |

---

## 4. Test Commands & Observed Results

| # | Check | Status | Command & Actual Output |
| :-: | :--- | :---: | :--- |
| **1** | **`py_compile` on all `.py` files** | **PASS** | Command: `.venv\Scripts\python -m py_compile agent.py analysis.py app.py llm.py logger.py mock_agent.py questionnaire.py pages/1_Steerable.py pages/2_Baseline.py; Write-Host "EXIT_CODE=$LASTEXITCODE"`<br>Output: `EXIT_CODE=0` |
| **2** | **Headless `DEMO_MODE=1` full workflow** (`new_run`, `advance` to end, `edit_step`, `approve`, `add_constraint`) | **PASS** | Command: `.venv\Scripts\python -c "import os; os.environ['DEMO_MODE']='1'; import agent; ..."` *(asserted earlier `s1` output preserved, later steps reset to `pending`, `s3` halted at `needs_approval`, `approve`, `edit_step`, `add_constraint`, `is_finished == True`)*<br>Output: `DEMO_MODE=1 PASS \| steps: ['done', 'done', 'done', 'done', 'done'] \| constraints: ['16GB RAM', 'Weight under 1.7 kg'] \| final_answer_preview: Final Recommendation for: Recommend a coding laptop under INR 65,000` |
| **3** | **Broken LLM (`DEMO_MODE` unset) raises `LLMError`, never returns canned text** | **PASS** | Command: `.venv\Scripts\python -c "import json, os, llm, agent; os.environ.pop('DEMO_MODE', None); ..."` *(mocked `_call_gemini` to return invalid JSON, `[1,2,3]`, and `{'wrong': 1}`)*<br>Output: `PASS Test 3: LLMError raised after 1 retry, missing keys caught, no canned text returned` |
| **4** | **Planted error sets `planted_injected` once** | **PASS** | Command: `.venv\Scripts\python -c "import os; os.environ['DEMO_MODE']='1'; import agent; ..."` *(verified `planted_injected=True` at `s2`, preserved when `paused`, did not re-inject on `edit_step` + re-run)*<br>Output: `PASS Test 4: planted_injected set exactly once at ['s2']` |
| **5** | **Live-API end-to-end test (`DEMO_MODE` unset, real `GEMINI_API_KEY`: `llm.py` + full `agent.py` run)** | **FAIL** | Command (unsandboxed): `.venv\Scripts\python -c "import json, os, llm, agent; os.environ.pop('DEMO_MODE', None); print('GEMINI_API_KEY_SET:', bool(os.getenv('GEMINI_API_KEY', '').strip())); raw = llm.call_llm(...); ..."`<br>Output (exit 1): `llm.LLMError: GEMINI_API_KEY is not set (set DEMO_MODE=1 for offline demo).` / `GEMINI_API_KEY_SET: False` *(verified absent from process env, `.env`, and Windows User/Machine env)* |
| **6** | **Streamlit app + built-in browser walkthrough (real mode)** | **FAIL** | Server started on `http://localhost:8521` (`.venv\Scripts\streamlit.exe run app.py --server.headless true --server.port 8521`; ports `8501`/`8502` were occupied). Browser subagent failed: `Could not find DevToolsActivePort for chrome at C:\Users\mahes\AppData\Local\Google\Chrome\User Data\DevToolsActivePort (ENOENT)`. Live real-mode UI run also blocked by missing `GEMINI_API_KEY`. Server stopped afterward. |
| **7** | **`logs/events.csv` inspection (last 20 lines)** | **FAIL** | Command: `.venv\Scripts\python -c "import csv; from pathlib import Path; ..."` (`TOTAL_LINES: 135`). Although `session_start`, `plan_generated`, `step_done`, `approval_requested`, and `session_end` all appear within the last 20 lines, they come from mixing synthetic `--fake` rows (`P10`) and an older incomplete `mock_agent.py` run (`P01`, `4 steps`, no `session_end`) — **zero** rows from a real-mode `agent.py` Steerable walkthrough exist yet. |
| **8** | **Docs consistency (`EVALUATION.md` empty real results + `SUBMISSION.md`/`EVALUATION.md` file check)** | **PASS** | Python regex + manual inspection confirmed all 18 referenced repo files exist and every result cell in `EVALUATION.md` Section 7 (`Real participant results`) is empty. |

---

## 5. Remaining Dependencies

1. **API Key & Runtime Environment:**
   - A valid `GEMINI_API_KEY` accessible to the app process (e.g., added to the gitignored `.env` file or persisted in Windows User environment variables, since process-local terminal variables are not inherited across separate shells/processes).
   - Chrome remote debugging enabled (`chrome://inspect/#remote-debugging` / `DevToolsActivePort`) if automated built-in browser verification is used.
   - *(Optional / Recommended)* Migrate `llm.py` from deprecated `google.generativeai` to `google.genai`, and add `LLMError` handling in `pages/2_Baseline.py`.
2. **Human Participants ($N = 8\text{–}10$):**
   - Clear or archive synthetic/legacy rows in `logs/events.csv`, `logs/questionnaire.csv`, and `logs/ratings.csv` before collecting real data.
   - Run counterbalanced within-subjects sessions (`Steerable` vs. `Baseline` across distinct task pairs from `tasks.json`), capturing full event logs and post-task questionnaires.
3. **Blind Rater Scores (`logs/ratings.csv`):**
   - Export blinded `(participant_id, blinded_session_id, task_id, final_answer)` outputs (stripping condition labels and UI logs).
   - Collect independent 1–5 scores from 2 blind raters (`R1`, `R2`) per `rubric.md`, adjudicate $\ge 2$-point differences, achieve target agreement ($\kappa \ge 0.70$ or $\text{ICC}(2,1) \ge 0.75$), and re-run `.venv\Scripts\python analysis.py` (without `--fake`) to populate `EVALUATION.md` Section 7.

---

## 6. Verdict & Missing-Items Checklist

### Verdict: **`NOT READY`**

- [ ] **Provide `GEMINI_API_KEY`** in `.env` (or persistent environment) and confirm `DEMO_MODE` is unset.
- [ ] **Pass live-API end-to-end headless test**: one `llm.call_llm(..., json_mode=True)` call and one full real-mode `agent.py` run (`new_run` → `advance` → `approve` if confidence `< 3` → `final_answer` without `LLMError`).
- [ ] **Pass live-API browser UI walkthrough** on `app.py` → `pages/1_Steerable.py` (verify no `DEMO MODE` banner, `N/5` confidence pills, approval pause/resume, and final answer rendered).
- [ ] **Reset logs and verify clean real telemetry** in `logs/events.csv` (one uninterrupted Steerable session containing `session_start`, `plan_generated`, `step_done`, `approval_requested` when triggered, `final_answer`, and `session_end`).
- [ ] **Collect real participant sessions ($N = 8\text{–}10$)** across both Steerable and Baseline conditions (`logs/events.csv`, `logs/questionnaire.csv`).
- [ ] **Complete blind 2-rater scoring (`logs/ratings.csv`)** and run `analysis.py` to populate `EVALUATION.md` Section 7.
