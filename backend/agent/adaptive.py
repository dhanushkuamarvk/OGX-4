"""Adaptive behavior layer governing autonomy levels L1, L2, and L3.

Formula:
    override_rate = (user edits + rollbacks + rejected steps) / window_actions
    over a rolling window of the last N = 8 actions.

Autonomy levels:
    L1: Ask before every step.
    L2: Ask before low-confidence steps (confidence < 0.70).
    L3: Run freely and show a summary on completion.

Transitions (with hysteresis band [0.10, 0.40] and cooldown of 5 actions):
    - Move DOWN one level when override_rate > 0.40 and actions_since_last_change >= 5.
    - Move UP one level when override_rate < 0.10 over a full window (len == 8)
      and actions_since_last_change >= 5.
"""

from __future__ import annotations

from dataclasses import dataclass

from backend.shared.schemas import (
    AdaptiveActionKind,
    AdaptiveActionRecord,
    AdaptiveState,
    AutonomyLevel,
    Step,
)

WINDOW_SIZE: int = 8
MIN_ACTIONS_BETWEEN_CHANGES: int = 5
DEMOTE_THRESHOLD: float = 0.40
PROMOTE_THRESHOLD: float = 0.10

CONFIDENCE_GATES: dict[AutonomyLevel, float] = {
    "L1": 1.00,  # Ask before every step
    "L2": 0.70,  # Ask before low-confidence steps
    "L3": 0.00,  # Run freely and show a summary
}

LEVEL_ORDER: tuple[AutonomyLevel, ...] = ("L1", "L2", "L3")

LEVEL_DESCRIPTIONS: dict[AutonomyLevel, str] = {
    "L1": "ask before every step",
    "L2": "ask before low-confidence steps",
    "L3": "run freely and show a summary",
}


@dataclass(frozen=True)
class AutonomyTransition:
    changed: bool
    previous_level: AutonomyLevel
    new_level: AutonomyLevel
    state: AdaptiveState


class AdaptiveAutonomyController:
    """Deterministic rolling-window adaptive autonomy state machine."""

    def __init__(
        self,
        *,
        window_size: int = WINDOW_SIZE,
        min_actions_between_changes: int = MIN_ACTIONS_BETWEEN_CHANGES,
        demote_threshold: float = DEMOTE_THRESHOLD,
        promote_threshold: float = PROMOTE_THRESHOLD,
    ) -> None:
        self.window_size = window_size
        self.min_actions_between_changes = min_actions_between_changes
        self.demote_threshold = demote_threshold
        self.promote_threshold = promote_threshold

    def initial_state(self, level: AutonomyLevel | None = None) -> AdaptiveState:
        chosen: AutonomyLevel = level or "L2"
        return AdaptiveState(
            level=chosen,
            window_size=self.window_size,
            min_actions_between_changes=self.min_actions_between_changes,
            actions_since_last_change=0,
            action_window=[],
            override_rate=0.0,
            confidence_gate=CONFIDENCE_GATES[chosen],
            reason=f"Initialized at {chosen} ({LEVEL_DESCRIPTIONS[chosen]}).",
        )

    @staticmethod
    def _step_down(level: AutonomyLevel) -> AutonomyLevel:
        idx = LEVEL_ORDER.index(level)
        return LEVEL_ORDER[max(0, idx - 1)]

    @staticmethod
    def _step_up(level: AutonomyLevel) -> AutonomyLevel:
        idx = LEVEL_ORDER.index(level)
        return LEVEL_ORDER[min(len(LEVEL_ORDER) - 1, idx + 1)]

    @staticmethod
    def compute_override_rate(window: list[AdaptiveActionRecord]) -> float:
        """Compute (user edits + rollbacks + rejected steps) / actions in rolling window."""
        if not window:
            return 0.0
        overrides = sum(1 for item in window if item.is_override)
        return round(overrides / len(window), 4)

    def should_pause_for_human(
        self,
        state: AdaptiveState,
        step: Step,
    ) -> tuple[bool, str]:
        """Determine whether execution must pause before running `step`."""
        if state.level == "L1":
            return (
                True,
                f"Autonomy L1 (ask before every step): awaiting approval to run '{step.title}'.",
            )
        if state.level == "L2" and step.confidence < state.confidence_gate:
            return (
                True,
                (
                    f"Autonomy L2: step '{step.title}' confidence ({step.confidence:.2f}) "
                    f"is below threshold ({state.confidence_gate:.2f})."
                ),
            )
        return False, ""

    def record_action(
        self,
        state: AdaptiveState,
        *,
        kind: AdaptiveActionKind,
    ) -> AutonomyTransition:
        """Append an action to the N=8 rolling window and evaluate hysteresis transitions."""
        is_override = kind in {"user_edit", "rollback", "rejected_step"}
        window = [*state.action_window, AdaptiveActionRecord(kind=kind, is_override=is_override)]
        if len(window) > self.window_size:
            window = window[-self.window_size :]

        actions_since = state.actions_since_last_change + 1
        override_count = sum(1 for r in window if r.is_override)
        rate = self.compute_override_rate(window)

        prev = state.level
        new_level = prev
        reason = state.reason

        if actions_since >= self.min_actions_between_changes:
            if rate > self.demote_threshold and prev != "L1":
                new_level = self._step_down(prev)
                actions_since = 0
                reason = (
                    f"Lowered autonomy from {prev} to {new_level} ({LEVEL_DESCRIPTIONS[new_level]}): "
                    f"override rate {rate:.2f} ({override_count}/{len(window)} recent actions) "
                    f"exceeded {self.demote_threshold:.2f} threshold."
                )
            elif (
                len(window) == self.window_size
                and rate < self.promote_threshold
                and prev != "L3"
            ):
                new_level = self._step_up(prev)
                actions_since = 0
                reason = (
                    f"Raised autonomy from {prev} to {new_level} ({LEVEL_DESCRIPTIONS[new_level]}): "
                    f"override rate {rate:.2f} ({override_count}/{len(window)} full window) "
                    f"stayed below {self.promote_threshold:.2f} threshold."
                )

        next_state = AdaptiveState(
            level=new_level,
            window_size=self.window_size,
            min_actions_between_changes=self.min_actions_between_changes,
            actions_since_last_change=actions_since,
            action_window=window,
            override_rate=rate,
            confidence_gate=CONFIDENCE_GATES[new_level],
            reason=reason,
        )
        return AutonomyTransition(
            changed=new_level != prev,
            previous_level=prev,
            new_level=new_level,
            state=next_state,
        )

    def record_agent_step(self, state: AdaptiveState) -> AutonomyTransition:
        return self.record_action(state, kind="agent_step")

    def record_user_edit(self, state: AdaptiveState) -> AutonomyTransition:
        return self.record_action(state, kind="user_edit")

    def record_rollback(self, state: AdaptiveState) -> AutonomyTransition:
        return self.record_action(state, kind="rollback")

    def record_rejected_step(self, state: AdaptiveState) -> AutonomyTransition:
        return self.record_action(state, kind="rejected_step")

    def set_manual_level(
        self,
        state: AdaptiveState,
        level: AutonomyLevel,
        reason: str,
    ) -> AutonomyTransition:
        """Explicit user override of autonomy level (resets cooldown counter)."""
        prev = state.level
        next_state = AdaptiveState(
            level=level,
            window_size=self.window_size,
            min_actions_between_changes=self.min_actions_between_changes,
            actions_since_last_change=0,
            action_window=list(state.action_window),
            override_rate=state.override_rate,
            confidence_gate=CONFIDENCE_GATES[level],
            reason=reason,
        )
        return AutonomyTransition(
            changed=level != prev,
            previous_level=prev,
            new_level=level,
            state=next_state,
        )
