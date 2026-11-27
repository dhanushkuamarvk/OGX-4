# Telemetry Data Dictionary (`/eval/raw_logs`)

Every session in both **Co-Plan (treatment)** and **Baseline (control)** appends validated JSONL rows to:
- `/eval/raw_logs/{participant_id}_{task_id}_{condition}.jsonl`
- `/eval/raw_logs/telemetry_all.jsonl`

Use `python eval/export_csv.py` (or `make export-telemetry`) to compile all per-run JSONL files into a flat 14-column CSV.

## Frozen 14-Column Schema (`TELEMETRY_COLUMNS`)

| # | Column | Type | Nullable | Description |
|---|---|---|---|---|
| 1 | `ts` | ISO-8601 UTC string | No | Strictly monotonic per-session event timestamp |
| 2 | `session_id` | string (`sess_*`) | No | Unique session identifier |
| 3 | `participant_id` | string (`P01`..`P12`) | No | Counterbalanced participant code |
| 4 | `condition` | enum (`coplan` \| `baseline`) | No | Experimental condition |
| 5 | `task_id` | string | No | Task identifier (`task_research_brief`, `task_event_plan`, `task_data_analysis`) |
| 6 | `actor` | enum (`user` \| `agent` \| `system`) | No | Entity initiating the state transition |
| 7 | `event_type` | string | No | Standardized event name (see table below) |
| 8 | `step_id` | string \| empty | Yes | Target step ID (`step_1`, `step_3_1`, `planner`) when applicable |
| 9 | `payload_json` | JSON object string | No | Structured event metadata; **always** contains `llm_provider` and `llm_model` |
| 10 | `latency_ms` | float (ms) | No | Operation or LLM latency in milliseconds (`0.0` for instantaneous UI actions) |
| 11 | `tokens_in` | int | No | Prompt/input token count for LLM-backed events (`0` otherwise) |
| 12 | `tokens_out` | int | No | Completion/output token count for LLM-backed events (`0` otherwise) |
| 13 | `autonomy_level` | enum (`L1` \| `L2` \| `L3`) | No | Active autonomy level at the time of the event |
| 14 | `checkpoint_id` | string (`cp_*`) \| empty | Yes | Associated checkpoint ID if saved or restored |

## Core `event_type` Values

| `event_type` | Condition(s) | Actor | Semantics |
|---|---|---|---|
| `session_created` | Both | `user` | Session initialized with assigned task & condition |
| `plan_created` | Co-Plan | `agent` | Hierarchical plan generated with calibrated confidence scores |
| `step_started` | Co-Plan | `agent` | Executor began a step |
| `step_completed` | Co-Plan | `agent` | Step finished; output written to artifact & SQLite |
| `step_failed` | Co-Plan | `agent` | Step or planner JSON repair failure (recoverable) |
| `artifact_patch` | Co-Plan | `agent` | Agent updated a section of the shared Markdown artifact |
| `artifact_edited` | Co-Plan | `user` | Human directly edited the Markdown artifact |
| `step_lock` / `step_unlock` | Co-Plan | `user` | Human toggled lock protection on a step |
| `step_edited` | Co-Plan | `user` | Human edited step title/description (invalidating unlocked downstream steps) |
| `step_expand` | Co-Plan | `user` | Human expanded a step into substeps |
| `interrupt` | Co-Plan | `user` | Human paused agent mid-flight (with optional steering instruction) |
| `resume` | Co-Plan | `user` | Human resumed paused or rolled-back execution |
| `checkpoint_saved` | Co-Plan | `agent`/`user`/`system` | Immutable `plan + artifact + step_outputs` snapshot persisted |
| `rollback` | Co-Plan | `user` | Restored earlier checkpoint (`rollback_id` in `payload_json`) |
| `autonomy_changed` | Co-Plan | `system`/`user` | Autonomy changed (`L1`/`L2`/`L3`); `autonomy_level` holds new level, `payload_json` holds `previous_level`, `new_level`, `override_rate`, `reason` |
| `requirement_change_sent` | **Both** | `user` | Timestamp when the mid-task requirement change was submitted |
| `requirement_changed` | Co-Plan | `user` | Co-Plan minimal replan completed (`invalidated_step_ids`, `preserved_locked_step_ids`, `preserved_edited_step_ids`) |
| `first_useful_response` | **Both** | `agent` | First actionable recovery output after `requirement_change_sent` (Co-Plan: first `plan_patch` or `step_started`; Baseline: next assistant response) |
| `baseline_user_message` | Baseline | `user` | User prompt sent via `POST /chat/{session_id}` |
| `baseline_assistant_response` | Baseline | `agent` | Full non-streaming assistant reply returned |
| `done` | Co-Plan | `agent` | All plan steps completed with final summary |

## Derived Study Metrics (Computable From Logs Alone)
- **`time_to_recover_ms`**: `(ts(first_useful_response) - ts(requirement_change_sent)) * 1000` (also mirrored in `first_useful_response.latency_ms`).
- **`completion_time_s`**: `ts(last_event) - ts(session_created)`.
- **`override_rate`**: `(count(step_edited) + count(artifact_edited) + count(rollback) + count(interrupt)) / max(1, count(step_completed) + overrides)`.
- **`rework_count`**: `count(rollback) + sum(len(invalidated_step_ids))` in Co-Plan; follow-up revision turns after the first response in Baseline.
- **`error_rate`**: `count(step_failed) / max(1, count(step_started))`.
- **Mock-data safety gate**: Any row where `json.loads(payload_json)["llm_provider"] == "mock"` causes study analysis scripts to abort loudly so demo logs cannot contaminate real participant datasets.
