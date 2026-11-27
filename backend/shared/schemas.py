"""Shared Pydantic v2 schemas implementing the Co-Plan & Baseline contract."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

# ---------------------------------------------------------------------------
# Enumerations / Literal types
# ---------------------------------------------------------------------------

Condition = Literal["coplan", "baseline"]
StepStatus = Literal["pending", "running", "done", "failed", "skipped", "invalidated"]
Actor = Literal["user", "agent", "system"]
Editor = Literal["user", "agent"]

# Adaptive autonomy levels:
#   L1: ask before every step
#   L2: ask before low-confidence steps
#   L3: run freely and show a summary
AutonomyLevel = Literal["L1", "L2", "L3"]

# Explicit Session State Machine:
#   idle -> planning -> running -> paused -> (running | rolled_back) -> done
SessionStatus = Literal[
    "idle",
    "planning",
    "running",
    "paused",
    "rolled_back",
    "done",
    "failed",
]

SSEEventType = Literal[
    "plan_created",
    "plan_patch",
    "step_started",
    "step_progress",
    "step_completed",
    "step_failed",
    "artifact_patch",
    "confidence_update",
    "interrupt_ack",
    "checkpoint_saved",
    "rollback_done",
    "autonomy_changed",
    "requirement_changed",
    "done",
]


def utc_now_iso() -> str:
    """Return an ISO-8601 UTC timestamp string."""
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# Core Shared Contract Models
# ---------------------------------------------------------------------------


class Step(BaseModel):
    """A single step (or substep) in the hierarchical Co-Plan execution tree."""

    id: str
    parent_id: str | None = None
    title: str
    description: str
    status: StepStatus = "pending"
    confidence: float = Field(default=0.75, ge=0.0, le=1.0)
    locked: bool = False
    user_edited: bool = False
    output_ref: str | None = None


class Plan(BaseModel):
    """Versioned hierarchical plan shared between human and agent."""

    plan_id: str
    version: int = Field(default=1, ge=1)
    steps: list[Step] = Field(default_factory=list)


class Artifact(BaseModel):
    """Versioned Markdown workspace artifact co-authored by human and agent."""

    artifact_id: str
    version: int = Field(default=1, ge=1)
    content: str = ""
    last_editor: Editor = "agent"


# ---------------------------------------------------------------------------
# Adaptive Autonomy & Checkpoints
# ---------------------------------------------------------------------------


AdaptiveActionKind = Literal[
    "agent_step",
    "user_edit",
    "rollback",
    "rejected_step",
]


class AdaptiveActionRecord(BaseModel):
    """Single action tracked inside the rolling N=8 autonomy window."""

    kind: AdaptiveActionKind
    is_override: bool
    ts: str = Field(default_factory=utc_now_iso)


class AdaptiveState(BaseModel):
    """Rolling-window state of the adaptive behavior layer (L1 / L2 / L3)."""

    level: AutonomyLevel = "L2"
    window_size: int = Field(default=8, ge=1)
    min_actions_between_changes: int = Field(default=5, ge=1)
    actions_since_last_change: int = Field(default=0, ge=0)
    action_window: list[AdaptiveActionRecord] = Field(default_factory=list)
    override_rate: float = Field(default=0.0, ge=0.0, le=1.0)
    confidence_gate: float = Field(default=0.70, ge=0.0, le=1.0)
    reason: str = "Initialized at L2 (ask before low-confidence steps)."


class Checkpoint(BaseModel):
    """Metadata summary of an immutable session checkpoint."""

    checkpoint_id: str
    session_id: str
    seq: int = Field(ge=0)
    label: str
    created_at: str = Field(default_factory=utc_now_iso)
    plan_version: int = Field(ge=1)
    artifact_version: int = Field(ge=1)
    autonomy_level: AutonomyLevel = "L2"
    step_id: str | None = None


class CheckpointSnapshot(BaseModel):
    """Full restorable state snapshot (plan + artifact + step outputs) persisted in SQLite."""

    checkpoint: Checkpoint
    plan: Plan
    artifact: Artifact
    step_outputs: dict[str, str] = Field(default_factory=dict)
    session_status: SessionStatus
    requirements: list[str] = Field(default_factory=list)
    active_instruction: str | None = None
    adaptive_state: AdaptiveState = Field(default_factory=AdaptiveState)


class RollbackLogEntry(BaseModel):
    """Audit record preserved in SQLite whenever a checkpoint rollback occurs."""

    rollback_id: str
    session_id: str
    target_checkpoint_id: str
    from_plan_version: int
    to_plan_version: int
    from_artifact_version: int
    to_artifact_version: int
    created_at: str = Field(default_factory=utc_now_iso)


# ---------------------------------------------------------------------------
# Evaluation Tasks
# ---------------------------------------------------------------------------


class TaskDefinition(BaseModel):
    """Standardized evaluation task shared by both experimental conditions."""

    task_id: str
    title: str
    domain: str
    difficulty: Literal["medium", "hard"] = "medium"
    estimated_minutes: int = 10
    prompt: str
    materials: str = ""
    mid_task_requirement: str
    recommended_injection_minute: int = 4
    injection_trigger_progress: float = 0.5
    rubric_max_score: int = 10
    rubric_criteria: list[str] = Field(default_factory=list)


class ParticipantAssignment(BaseModel):
    """Counterbalanced session assignment for a participant from /eval/counterbalancing.csv."""

    participant_id: str
    condition_order: list[Condition]
    task_order: list[str]
    completed_rounds: int
    next_round_index: int | None = None
    next_condition: Condition | None = None
    next_task_id: str | None = None
    next_app_url: str | None = None
    all_completed: bool = False


# ---------------------------------------------------------------------------
# Typed SSE Payloads (every event payload includes session_id, seq, ts)
# ---------------------------------------------------------------------------


class SSEPayloadBase(BaseModel):
    """Base fields required on every SSE JSON payload."""

    session_id: str
    seq: int = Field(ge=1)
    ts: str = Field(default_factory=utc_now_iso)


class PlanCreatedPayload(SSEPayloadBase):
    plan: Plan


class PlanPatchPayload(SSEPayloadBase):
    plan: Plan
    reason: str = "plan_updated"
    changed_step_ids: list[str] = Field(default_factory=list)


class StepStartedPayload(SSEPayloadBase):
    step_id: str
    title: str
    confidence: float = Field(ge=0.0, le=1.0)


class StepProgressPayload(SSEPayloadBase):
    step_id: str
    chunk: str
    progress_pct: float = Field(ge=0.0, le=100.0)


class StepCompletedPayload(SSEPayloadBase):
    step: Step
    latency_ms: float = 0.0
    tokens_in: int = 0
    tokens_out: int = 0


class StepFailedPayload(SSEPayloadBase):
    step_id: str
    error: str
    recoverable: bool = True


class ArtifactPatchPayload(SSEPayloadBase):
    artifact: Artifact
    step_id: str | None = None
    section_heading: str | None = None
    summary: str = "artifact_updated"


class ConfidenceUpdatePayload(SSEPayloadBase):
    step_id: str
    confidence: float = Field(ge=0.0, le=1.0)
    previous_confidence: float | None = Field(default=None, ge=0.0, le=1.0)
    requires_approval: bool = False
    reason: str = ""


class InterruptAckPayload(SSEPayloadBase):
    interrupt_id: str
    new_instruction: str | None = None
    interrupted_step_id: str | None = None
    invalidated_step_ids: list[str] = Field(default_factory=list)
    preserved_step_ids: list[str] = Field(default_factory=list)
    status: SessionStatus = "paused"


class CheckpointSavedPayload(SSEPayloadBase):
    checkpoint: Checkpoint


class RollbackDonePayload(SSEPayloadBase):
    rollback_id: str
    checkpoint_id: str
    plan: Plan
    artifact: Artifact
    step_outputs: dict[str, str] = Field(default_factory=dict)
    autonomy_level: AutonomyLevel
    status: SessionStatus = "rolled_back"


class AutonomyChangedPayload(SSEPayloadBase):
    previous_level: AutonomyLevel
    new_level: AutonomyLevel
    override_rate: float = Field(ge=0.0, le=1.0)
    window_count: int = Field(ge=0)
    confidence_gate: float = Field(ge=0.0, le=1.0)
    reason: str


class RequirementChangedPayload(SSEPayloadBase):
    requirement: str
    plan: Plan
    invalidated_step_ids: list[str] = Field(default_factory=list)
    preserved_locked_step_ids: list[str] = Field(default_factory=list)
    preserved_edited_step_ids: list[str] = Field(default_factory=list)


class DonePayload(SSEPayloadBase):
    status: SessionStatus = "done"
    summary: str
    plan_version: int
    artifact_version: int
    autonomy_level: AutonomyLevel = "L2"


class SSEEnvelope(BaseModel):
    """Internal representation of an SSE event before wire serialization."""

    event: SSEEventType
    data: dict[str, Any]


# ---------------------------------------------------------------------------
# REST Request / Response Payloads (Co-Plan + Baseline)
# ---------------------------------------------------------------------------


class CreateSessionRequest(BaseModel):
    task_id: str
    participant_id: str
    condition: Condition
    initial_prompt: str | None = None
    autonomy_level: AutonomyLevel | None = None


class SessionStateResponse(BaseModel):
    session_id: str
    task_id: str
    participant_id: str
    condition: Condition
    status: SessionStatus
    autonomy_level: AutonomyLevel
    adaptive_state: AdaptiveState
    plan: Plan
    artifact: Artifact
    step_outputs: dict[str, str] = Field(default_factory=dict)
    checkpoints: list[Checkpoint] = Field(default_factory=list)
    rollback_logs: list[RollbackLogEntry] = Field(default_factory=list)
    requirements: list[str] = Field(default_factory=list)
    active_instruction: str | None = None
    seq: int = 0
    created_at: str
    updated_at: str


class InterruptRequest(BaseModel):
    new_instruction: str | None = None


class InterruptResponse(BaseModel):
    session_id: str
    interrupt_id: str
    status: SessionStatus
    new_instruction: str | None = None
    interrupted_step_id: str | None = None
    invalidated_step_ids: list[str] = Field(default_factory=list)
    preserved_step_ids: list[str] = Field(default_factory=list)
    plan: Plan
    checkpoint_id: str


class ResumeRequest(BaseModel):
    instruction: str | None = None


class ResumeResponse(BaseModel):
    session_id: str
    status: SessionStatus
    next_step_id: str | None = None


class StepLockResponse(BaseModel):
    session_id: str
    step: Step
    plan_version: int
    checkpoint_id: str


class StepExpandRequest(BaseModel):
    instruction: str | None = None


class StepExpandResponse(BaseModel):
    session_id: str
    parent_step_id: str
    substeps: list[Step]
    plan: Plan
    checkpoint_id: str


class UpdateStepRequest(BaseModel):
    title: str | None = None
    description: str | None = None


class UpdateStepResponse(BaseModel):
    session_id: str
    step: Step
    plan: Plan
    invalidated_step_ids: list[str] = Field(default_factory=list)
    checkpoint_id: str


class PatchArtifactRequest(BaseModel):
    content: str
    base_version: int = Field(ge=1)


class PatchArtifactResponse(BaseModel):
    session_id: str
    artifact: Artifact
    merged: bool = False
    conflict: bool = False
    checkpoint_id: str


class ArtifactConflictDetail(BaseModel):
    message: str
    base_version: int
    current_version: int
    current_artifact: Artifact


class RollbackRequest(BaseModel):
    checkpoint_id: str


class RollbackResponse(BaseModel):
    session_id: str
    rollback_id: str
    checkpoint_id: str
    plan: Plan
    artifact: Artifact
    step_outputs: dict[str, str] = Field(default_factory=dict)
    autonomy_level: AutonomyLevel
    adaptive_state: AdaptiveState
    status: SessionStatus


class RequirementChangeRequest(BaseModel):
    text: str = Field(min_length=1)


class RequirementChangeResponse(BaseModel):
    session_id: str
    requirement: str
    plan: Plan
    invalidated_step_ids: list[str] = Field(default_factory=list)
    preserved_locked_step_ids: list[str] = Field(default_factory=list)
    preserved_edited_step_ids: list[str] = Field(default_factory=list)
    autonomy_level: AutonomyLevel
    status: SessionStatus
    checkpoint_id: str


class SetAutonomyRequest(BaseModel):
    level: AutonomyLevel
    reason: str = "User manually adjusted autonomy level."


class SetAutonomyResponse(BaseModel):
    session_id: str
    adaptive_state: AdaptiveState


# Baseline REST payloads
class BaselineChatRequest(BaseModel):
    message: str = Field(min_length=1)


class BaselineMessage(BaseModel):
    message_id: str
    session_id: str
    turn_index: int
    role: Literal["user", "assistant"]
    content: str
    latency_ms: float = 0.0
    tokens_in: int = 0
    tokens_out: int = 0
    created_at: str = Field(default_factory=utc_now_iso)


class BaselineChatResponse(BaseModel):
    session_id: str
    message_id: str
    role: Literal["assistant"] = "assistant"
    content: str
    turn_index: int
    latency_ms: float
    tokens_in: int
    tokens_out: int
    artifact: Artifact


class BaselineHistoryResponse(BaseModel):
    session_id: str
    messages: list[BaselineMessage]
    artifact: Artifact


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"
    llm_provider: str
    llm_model: str
    temperature: float
    max_tokens: int


# ---------------------------------------------------------------------------
# Telemetry Schema (EXACT 14 columns)
# ---------------------------------------------------------------------------


TELEMETRY_COLUMNS: tuple[str, ...] = (
    "ts",
    "session_id",
    "participant_id",
    "condition",
    "task_id",
    "actor",
    "event_type",
    "step_id",
    "payload_json",
    "latency_ms",
    "tokens_in",
    "tokens_out",
    "autonomy_level",
    "checkpoint_id",
)


class TelemetryEvent(BaseModel):
    """Single telemetry row matching the exact study schema."""

    model_config = ConfigDict(extra="forbid")

    ts: str = Field(default_factory=utc_now_iso)
    session_id: str
    participant_id: str
    condition: Condition
    task_id: str
    actor: Actor
    event_type: str
    step_id: str | None = None
    payload_json: str = "{}"
    latency_ms: float = 0.0
    tokens_in: int = 0
    tokens_out: int = 0
    autonomy_level: AutonomyLevel = "L2"
    checkpoint_id: str | None = None

    def to_csv_row(self) -> dict[str, Any]:
        """Serialize into an ordered dict matching TELEMETRY_COLUMNS."""
        return {
            "ts": self.ts,
            "session_id": self.session_id,
            "participant_id": self.participant_id,
            "condition": self.condition,
            "task_id": self.task_id,
            "actor": self.actor,
            "event_type": self.event_type,
            "step_id": "" if self.step_id is None else self.step_id,
            "payload_json": self.payload_json,
            "latency_ms": round(self.latency_ms, 3),
            "tokens_in": self.tokens_in,
            "tokens_out": self.tokens_out,
            "autonomy_level": self.autonomy_level,
            "checkpoint_id": "" if self.checkpoint_id is None else self.checkpoint_id,
        }


# ---------------------------------------------------------------------------
# LLM Client Internal Models
# ---------------------------------------------------------------------------


class ChatMessage(BaseModel):
    role: Literal["system", "user", "assistant"]
    content: str


class ToolAuditResult(BaseModel):
    word_count: int
    heading_count: int
    headings: list[str]
    matched_constraints: list[str]
    missing_constraints: list[str]
    coverage_score: float = Field(ge=0.0, le=1.0)


class LLMResponse(BaseModel):
    content: str
    tokens_in: int = 0
    tokens_out: int = 0
    latency_ms: float = 0.0
    model: str
    provider: str


class LLMStreamChunk(BaseModel):
    delta: str
    done: bool = False
    tokens_in: int = 0
    tokens_out: int = 0
    latency_ms: float = 0.0
