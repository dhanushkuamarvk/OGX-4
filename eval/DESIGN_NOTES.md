# Co-Plan Design Notes

## Adaptive Behavior Layer (`/backend/agent/adaptive.py`)

### Comparison Against Specification
| Spec Requirement | Implementation in `adaptive.py` | Status / Rationale |
|---|---|---|
| Rolling window of last `N = 8` actions | `WINDOW_SIZE = 8`, FIFO truncation `window[-8:]` on `AdaptiveState.action_window` | Exact match |
| Override rate = `(user edits + rollbacks + rejected steps) / agent actions` | `overrides / len(window)` where each entry in the rolling window is either `agent_step` (`is_override=False`) or an override (`user_edit`, `rollback`, `rejected_step`; `is_override=True`) | Intentional normalization — see note below |
| Three autonomy levels (`L1`, `L2`, `L3`) | `L1`: ask before every step (`gate=1.0`); `L2`: ask before low-confidence steps (`gate=0.70`); `L3`: run freely and show summary (`gate=0.0`) | Exact match |
| Move DOWN when `rate > 0.4`, UP when `rate < 0.1` for a full window | `rate > 0.40` demotes one level; `len(window) == 8 and rate < 0.10` promotes one level | Exact match |
| Hysteresis + minimum 5 actions between changes | Wide `[0.10, 0.40]` hysteresis deadband + `min_actions_between_changes = 5` cooldown (`actions_since_last_change` resets to `0` on every level change) | Exact match |
| Emit `autonomy_changed` with human-readable reason + telemetry `autonomy_level` | `CoPlanEngine._broadcast_autonomy_if_changed` emits SSE `autonomy_changed` with exact rate/counts reason and logs telemetry with `autonomy_level = rt.adaptive_state.level` | Exact match |

### Denominator Normalization Note
If a participant edits steps or interrupts the agent *before* any agent step has completed, dividing literally by `count(agent_steps_completed)` would divide by zero or produce unbounded rates (`> 1.0`) that violate the `[0, 1]` probability scale. Instead, every action event entering the `N = 8` rolling window counts as one unit in the denominator (`len(window)`), keeping `override_rate ∈ [0.0, 1.0]` strictly well-defined:
- `0` overrides in a full window of `8` clean steps → `0 / 8 = 0.00 < 0.10` (promotes).
- `1` override in a full window of `8` actions → `1 / 8 = 0.125` (inside hysteresis deadband `[0.10, 0.40]`; holds level).
- `3` overrides in `6` actions → `3 / 6 = 0.50 > 0.40` (demotes once cooldown `>= 5` is satisfied).
- `2` overrides in `5` actions → `2 / 5 = 0.40` (not strictly `> 0.40`; holds level).

## Non-Blocking Telemetry & Contract Stability
- All 14 frozen telemetry columns (`TELEMETRY_COLUMNS`) remain unchanged.
- `llm_provider` and `llm_model` are injected automatically into `payload_json` on every telemetry row so mock sessions are auditable and rejected by study analysis scripts without modifying the frozen CSV/JSONL schema.
