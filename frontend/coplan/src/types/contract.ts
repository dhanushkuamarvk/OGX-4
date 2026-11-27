export type Condition = "coplan" | "baseline";
export type StepStatus =
  | "pending"
  | "running"
  | "done"
  | "failed"
  | "skipped"
  | "invalidated";
export type Editor = "user" | "agent";
export type AutonomyLevel = "L1" | "L2" | "L3";
export type SessionStatus =
  | "idle"
  | "planning"
  | "running"
  | "paused"
  | "rolled_back"
  | "done"
  | "failed";

export type SSEEventType =
  | "plan_created"
  | "plan_patch"
  | "step_started"
  | "step_progress"
  | "step_completed"
  | "step_failed"
  | "artifact_patch"
  | "confidence_update"
  | "interrupt_ack"
  | "checkpoint_saved"
  | "rollback_done"
  | "autonomy_changed"
  | "requirement_changed"
  | "done";

export interface Step {
  id: string;
  parent_id: string | null;
  title: string;
  description: string;
  status: StepStatus;
  confidence: number;
  locked: boolean;
  user_edited: boolean;
  output_ref: string | null;
}

export interface Plan {
  plan_id: string;
  version: number;
  steps: Step[];
}

export interface Artifact {
  artifact_id: string;
  version: number;
  content: string;
  last_editor: Editor;
}

export interface AdaptiveState {
  level: AutonomyLevel;
  window_size: number;
  min_actions_between_changes: number;
  actions_since_last_change: number;
  override_rate: number;
  confidence_gate: number;
  reason: string;
}

export interface RollbackLogEntry {
  rollback_id: string;
  session_id: string;
  target_checkpoint_id: string;
  from_plan_version: number;
  to_plan_version: number;
  from_artifact_version: number;
  to_artifact_version: number;
  created_at: string;
}

export interface Checkpoint {
  checkpoint_id: string;
  session_id: string;
  seq: number;
  label: string;
  created_at: string;
  plan_version: number;
  artifact_version: number;
  autonomy_level: AutonomyLevel;
  step_id: string | null;
}

export interface TaskDefinition {
  task_id: string;
  title: string;
  domain: string;
  difficulty: "medium" | "hard";
  estimated_minutes: number;
  prompt: string;
  materials?: string;
  mid_task_requirement: string;
  recommended_injection_minute: number;
  rubric_max_score?: number;
  rubric_criteria: string[];
}

export interface HealthInfo {
  status: "ok";
  llm_provider: string;
  llm_model: string;
  temperature: number;
  max_tokens: number;
}

export interface ParticipantAssignment {
  participant_id: string;
  condition_order: Condition[];
  task_order: string[];
  completed_rounds: number;
  next_round_index: number | null;
  next_condition: Condition | null;
  next_task_id: string | null;
  next_app_url: string | null;
  all_completed: boolean;
}

export interface SessionState {
  session_id: string;
  task_id: string;
  participant_id: string;
  condition: Condition;
  status: SessionStatus;
  autonomy_level: AutonomyLevel;
  adaptive_state: AdaptiveState;
  plan: Plan;
  artifact: Artifact;
  checkpoints: Checkpoint[];
  requirements: string[];
  active_instruction: string | null;
  seq: number;
  created_at: string;
  updated_at: string;
}

export interface ArtifactConflict {
  message: string;
  base_version: number;
  current_version: number;
  current_artifact: Artifact;
}

export interface ActivityLogItem {
  id: string;
  seq: number;
  ts: string;
  event: SSEEventType;
  summary: string;
}
