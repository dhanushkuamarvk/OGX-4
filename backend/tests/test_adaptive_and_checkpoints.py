"""Tests for AdaptiveAutonomyController (L1/L2/L3, N=8 window, hysteresis, min 5 cooldown) & Checkpoints."""

from __future__ import annotations

import pytest

from backend.agent.adaptive import AdaptiveAutonomyController
from backend.agent.checkpoints import CheckpointManager, CheckpointNotFoundError
from backend.shared.db import Database
from backend.shared.schemas import Artifact, Plan, Step


def test_adaptive_gating_for_L1_L2_L3() -> None:
    ctrl = AdaptiveAutonomyController()
    high_conf = Step(id="s1", title="High", description="Clear step", confidence=0.92)
    low_conf = Step(id="s2", title="Low", description="Ambiguous TBD", confidence=0.55)

    # L1 asks before EVERY step
    l1 = ctrl.initial_state("L1")
    assert ctrl.should_pause_for_human(l1, high_conf)[0] is True
    assert ctrl.should_pause_for_human(l1, low_conf)[0] is True

    # L2 asks ONLY before low-confidence steps (< 0.70)
    l2 = ctrl.initial_state("L2")
    assert ctrl.should_pause_for_human(l2, high_conf)[0] is False
    assert ctrl.should_pause_for_human(l2, low_conf)[0] is True

    # L3 runs freely without pausing
    l3 = ctrl.initial_state("L3")
    assert ctrl.should_pause_for_human(l3, high_conf)[0] is False
    assert ctrl.should_pause_for_human(l3, low_conf)[0] is False


def test_adaptive_demotion_cooldown_hysteresis_and_full_window_promotion() -> None:
    ctrl = AdaptiveAutonomyController()
    state = ctrl.initial_state("L3")

    # 1. Override rate > 0.40 BEFORE 5 actions MUST NOT change yet (cooldown = 5)
    for kind in ("user_edit", "rollback", "rejected_step", "agent_step"):
        t = ctrl.record_action(state, kind=kind)
        assert t.changed is False
        state = t.state
    assert state.level == "L3"
    assert state.override_rate == 0.75  # 3/4 > 0.40, blocked by min 5 actions

    # 5th action: 3/5 = 0.60 > 0.40 and actions_since_last_change == 5 -> L3 -> L2
    t5 = ctrl.record_agent_step(state)
    assert t5.changed is True
    assert t5.previous_level == "L3"
    assert t5.new_level == "L2"
    assert "0.60" in t5.state.reason
    assert t5.state.actions_since_last_change == 0
    state = t5.state

    # 2. Immediately add 4 more overrides — cooldown (< 5 actions since change) blocks demotion
    for _ in range(4):
        t = ctrl.record_rollback(state)
        assert t.changed is False
        state = t.state
    assert state.level == "L2"

    # 5th action after previous change -> demotes L2 -> L1!
    t_demote = ctrl.record_user_edit(state)
    assert t_demote.changed is True
    assert t_demote.previous_level == "L2"
    assert t_demote.new_level == "L1"
    state = t_demote.state

    # 3. Hysteresis deadband: push clean steps so rate enters [0.10, 0.40] (e.g., 1/8 = 0.125)
    # 7 clean agent steps after overrides -> window has 1 override + 7 clean => rate = 1/8 = 0.125 >= 0.10
    for _ in range(7):
        t = ctrl.record_agent_step(state)
        assert t.changed is False
        state = t.state
    assert len(state.action_window) == 8
    assert state.override_rate == 0.125
    assert state.level == "L1"  # 0.125 is in deadband (not < 0.10)

    # 4. 8th consecutive clean agent step -> full window of 8 clean actions => rate = 0.0 < 0.10 -> promotes L1 -> L2!
    t_promote = ctrl.record_agent_step(state)
    assert t_promote.changed is True
    assert t_promote.previous_level == "L1"
    assert t_promote.new_level == "L2"
    assert "0.00" in t_promote.state.reason
    state = t_promote.state

    # 5. Cooldown again prevents immediate L2 -> L3 for next 4 clean actions even though window rate is 0.0
    for _ in range(4):
        t = ctrl.record_agent_step(state)
        assert t.changed is False
        state = t.state

    # 5th clean action after L1->L2 -> promotes L2 -> L3!
    t_promote2 = ctrl.record_agent_step(state)
    assert t_promote2.changed is True
    assert t_promote2.previous_level == "L2"
    assert t_promote2.new_level == "L3"


def test_adaptive_full_window_required_for_promotion_and_exact_boundary_hysteresis() -> None:
    ctrl = AdaptiveAutonomyController()
    state = ctrl.initial_state("L1")

    # 5, 6, 7 clean steps have override_rate = 0.0 < 0.10 AND actions_since >= 5,
    # but window is NOT full (len < 8) -> MUST NOT promote yet!
    for step_num in range(1, 8):
        t = ctrl.record_agent_step(state)
        assert t.changed is False, f"Unexpected promotion at action {step_num} before full N=8 window"
        state = t.state
    assert len(state.action_window) == 7
    assert state.level == "L1"

    # 8th clean step completes the full N=8 window -> promotes L1 -> L2!
    t8 = ctrl.record_agent_step(state)
    assert t8.changed is True
    assert t8.new_level == "L2"

    # Exact boundary test: 2/5 = 0.40 is NOT strictly > 0.40 -> hysteresis holds L2
    b_state = ctrl.initial_state("L2")
    for kind in ("agent_step", "agent_step", "agent_step", "user_edit", "rollback"):
        t = ctrl.record_action(b_state, kind=kind)
        b_state = t.state
    assert b_state.override_rate == 0.4
    assert b_state.level == "L2"

    # Adding 1 more override makes 3/6 = 0.50 > 0.40 -> demotes L2 -> L1
    t6 = ctrl.record_rejected_step(b_state)
    assert t6.changed is True
    assert t6.new_level == "L1"
    assert "0.50" in t6.state.reason


def test_checkpoint_save_restore_outputs_and_rollback_log(db: Database) -> None:
    ctrl = AdaptiveAutonomyController()
    adaptive_v1 = ctrl.initial_state("L2")
    plan_v1 = Plan(
        plan_id="plan_cp",
        version=1,
        steps=[Step(id="step_1", title="Draft Intro", description="Write intro", status="done")],
    )
    art_v1 = Artifact(artifact_id="art_cp", version=1, content="# V1\n", last_editor="agent")
    outputs_v1 = {"step_1": "Initial output v1"}

    db.upsert_session(
        session_id="sess_cp",
        task_id="task_incident_postmortem",
        participant_id="P01",
        condition="coplan",
        status="running",
        adaptive_state=adaptive_v1,
        plan=plan_v1,
        artifact=art_v1,
        step_outputs=outputs_v1,
        requirements=[],
        active_instruction=None,
        task_prompt="Test prompt",
        seq=1,
    )

    mgr = CheckpointManager(db)
    cp1 = mgr.save_checkpoint(
        session_id="sess_cp",
        seq=1,
        label="After step 1",
        plan=plan_v1,
        artifact=art_v1,
        step_outputs=outputs_v1,
        session_status="running",
        requirements=[],
        active_instruction=None,
        adaptive_state=adaptive_v1,
        step_id="step_1",
    )

    plan_v2 = plan_v1.model_copy(deep=True)
    plan_v2.version = 2
    plan_v2.steps[0].title = "Mutated Intro"
    art_v2 = Artifact(artifact_id="art_cp", version=2, content="# V2 mutated\n", last_editor="user")
    outputs_v2 = {"step_1": "Mutated output v2"}

    cp2 = mgr.save_checkpoint(
        session_id="sess_cp",
        seq=2,
        label="After edit",
        plan=plan_v2,
        artifact=art_v2,
        step_outputs=outputs_v2,
        session_status="paused",
        requirements=["SOC-2"],
        active_instruction="Keep concise",
        adaptive_state=ctrl.initial_state("L1"),
    )

    listed = mgr.list_checkpoints("sess_cp")
    assert [c.checkpoint_id for c in listed] == [cp1.checkpoint_id, cp2.checkpoint_id]

    snap1 = mgr.load_snapshot("sess_cp", cp1.checkpoint_id)
    assert snap1.plan.version == 1
    assert snap1.plan.steps[0].title == "Draft Intro"
    assert snap1.artifact.content == "# V1\n"
    assert snap1.step_outputs == {"step_1": "Initial output v1"}

    rb_log = mgr.record_rollback(
        session_id="sess_cp",
        target_checkpoint_id=cp1.checkpoint_id,
        from_plan_version=2,
        to_plan_version=1,
        from_artifact_version=2,
        to_artifact_version=1,
    )
    logs = mgr.list_rollback_logs("sess_cp")
    assert len(logs) == 1
    assert logs[0].rollback_id == rb_log.rollback_id
    assert logs[0].target_checkpoint_id == cp1.checkpoint_id

    with pytest.raises(CheckpointNotFoundError):
        mgr.load_snapshot("sess_cp", "cp_missing")
