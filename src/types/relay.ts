// ============================================================================
// RELAY AI — Core Domain Types
// ============================================================================

export type AgentSlug = "research-agent" | "planning-agent" | "execution-agent";

export type AgentStatus =
  | "online"
  | "working"
  | "paused"
  | "waiting_approval"
  | "offline";

export type TaskStatus =
  | "pending"
  | "planning"
  | "awaiting_plan_approval"
  | "running"
  | "waiting_for_approval"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

export type StepStatus =
  | "pending"
  | "planning"
  | "running"
  | "waiting_for_approval"
  | "completed"
  | "failed"
  | "skipped";

export type StepPriority = "high" | "medium" | "low";

export type ApprovalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "edited_and_approved";

export type ActivityCategory =
  | "plan"
  | "research"
  | "execution"
  | "approval"
  | "human_edit"
  | "state_change"
  | "workflow"
  | "evaluation";

export interface AgentProfile {
  id: string;
  slug: AgentSlug;
  name: string;
  roleTitle: string;
  description: string;
  capabilities: string[];
  status: AgentStatus;
  autonomyLevel: number; // 0..1 adaptive autonomy score
  overrideCount: number;
  totalDecisions: number;
  tasksCompleted: number;
  avgConfidence: number; // 0..1
  currentTaskLabel: string | null;
  lastActiveAt: string;
}

export interface TaskStep {
  id: string;
  order: number;
  title: string;
  description: string;
  assignedAgent: AgentSlug;
  priority: StepPriority;
  status: StepStatus;
  requiresApproval: boolean;
  isLocked: boolean;
  editedByHuman: boolean;
  confidence: number | null; // null when uncalibrated/unavailable; NEVER used as sole approval probability
  dependencies: string[];
  output?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface TaskCheckpoint {
  id: string;
  label: string;
  createdAt: string;
  taskStatus: TaskStatus;
  feedbackStage: number;
  stepsSnapshot: TaskStep[];
}

export interface AlternativeSuggestion {
  id: string;
  title: string;
  description: string;
  tradeoff: string;
  estimatedSteps?: number;
  approvalPoints?: number;
  bestFor?: string;
}

export interface AgentHandoff {
  id: string;
  fromAgent: AgentSlug | "human";
  toAgent: AgentSlug | "human";
  stepId?: string;
  stepTitle: string;
  summary: string;
  keyFindings: string[];
  sources: string[];
  humanConstraints: string[];
  createdAt: string;
}

export interface SharedTaskContext {
  objective: string;
  humanConstraints: string[];
  collectedSources: string[];
  handoffs: AgentHandoff[];
  recentConversationSummary: string;
  evaluationMeta?: {
    participantCode: string;
    taskTemplateId: string;
    midTaskChangePrompt: string;
    midTaskChangeInjected: boolean;
  };
}

export interface RequirementChangeSummary {
  id: string;
  changeText: string;
  affectedStepTitles: string[];
  preservedStepCount: number;
  requiresReapproval: boolean;
  approvedAfterChange: boolean;
  createdAt: string;
}

export interface ToastNotification {
  id: string;
  title: string;
  description?: string;
  tone: "success" | "info" | "warning" | "error";
}

export interface CollaborativeTask {
  id: string;
  ownerId?: string;
  conversationId: string;
  title: string;
  objective: string;
  status: TaskStatus;
  feedbackStage: number; // 1..11 Human-Agent Feedback Loop stage
  planApproved: boolean;
  progress: number; // 0..100
  confidenceScore: number | null; // 0..1 or null when model does not provide calibrated score
  reasoningSummary: string;
  alternatives: AlternativeSuggestion[];
  steps: TaskStep[];
  checkpoints: TaskCheckpoint[];
  sharedContext?: SharedTaskContext;
  lastRequirementChange?: RequirementChangeSummary | null;
  finalOutput?: string;
  activeApprovalId?: string | null;
  errorMessage?: string;
  fallbackNotice?: string;
  isSimulated: boolean;
  interactionCount: number;
  planEditCount: number;
  approvalCount: number;
  rejectionCount: number;
  interruptCount: number;
  startedAt: string;
  completedAt?: string;
  updatedAt: string;
}

export interface AttachmentItem {
  id: string;
  name: string;
  size: number;
  type: string;
  excerpt?: string;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  senderRole: "human" | AgentSlug | "system";
  senderName: string;
  messageType:
    | "chat"
    | "plan_proposal"
    | "activity_update"
    | "approval_request"
    | "artifact"
    | "baseline_response";
  content: string;
  attachments?: AttachmentItem[];
  taskId?: string;
  approvalId?: string;
  isSimulated?: boolean;
  createdAt: string;
}

export interface Conversation {
  id: string;
  title: string;
  objective: string;
  mode: "relay_ai" | "baseline";
  status: "active" | "completed" | "archived";
  taskId?: string;
  isSimulated: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ApprovalQAItem {
  id: string;
  question: string;
  answer: string;
  createdAt: string;
}

export interface ApprovalRequest {
  id: string;
  taskId: string;
  stepId: string;
  agentSlug: AgentSlug;
  actionTitle: string;
  actionDescription: string;
  recommendationReason: string;
  expectedResult: string;
  supportingEvidence: string[];
  potentialRisks: string[];
  alternativeActions: string[];
  confidence: number;
  status: ApprovalStatus;
  humanFeedback?: string;
  selectedAlternative?: string;
  qaThread: ApprovalQAItem[];
  isSimulated: boolean;
  createdAt: string;
  decidedAt?: string;
}

export interface InfluencingFactor {
  factor: string;
  weight: number; // 0..100
  direction: "positive" | "caution" | "neutral";
}

export interface ExplainableDecision {
  id: string;
  taskId?: string;
  taskTitle: string;
  agentSlug: AgentSlug;
  decisionSummary: string;
  evidenceUsed: string[];
  influencingFactors: InfluencingFactor[];
  confidenceEstimate: number | null; // 0..1 or null if unavailable (never fabricated)
  confidenceNote?: string;
  alternativeOptions: { option: string; reasonNotChosen: string }[];
  uncertainties: string[];
  expectedOutcomes: string[];
  recommendationExplanation: string;
  isSimulated: boolean;
  createdAt: string;
}

export interface ActivityEvent {
  id: string;
  taskId?: string;
  agentSlug: AgentSlug | "human" | "system";
  category: ActivityCategory;
  title: string;
  detail: string;
  isSimulated: boolean;
  createdAt: string;
}

export type WorkflowNodeKind =
  | "human_input"
  | "planning_agent"
  | "research_agent"
  | "human_approval"
  | "execution_agent"
  | "final_output";

export interface WorkflowNodeData extends Record<string, unknown> {
  label: string;
  kind: WorkflowNodeKind;
  description: string;
  instructions: string;
  requiresApproval: boolean;
  executionStatus: "idle" | "running" | "waiting_for_approval" | "completed" | "failed";
}

export interface SavedWorkflow {
  id: string;
  name: string;
  description: string;
  nodes: Array<{
    id: string;
    type: string;
    position: { x: number; y: number };
    data: WorkflowNodeData;
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    animated?: boolean;
  }>;
  lastRunStatus: "idle" | "running" | "waiting_for_approval" | "completed" | "failed";
  linkedTaskId?: string;
  updatedAt: string;
}

export type ExperimentCondition = "baseline" | "relay_ai";

export interface EvaluationRun {
  id: string;
  participantCode: string;
  taskTemplateId: string;
  taskTitle: string;
  condition: ExperimentCondition;
  isSampleData: boolean; // STRICT separation between measured trials & illustrative preview
  completedSuccessfully: boolean;
  completionTimeSec: number;
  interactionCount: number;
  approvalCount: number;
  rejectionCount: number;
  planEditCount: number;
  interruptCount: number;
  midTaskChangeHandled: boolean;
  inputTokens: number;
  outputTokens: number;
  // Post-task subjective survey (1–7 Likert scale; Effort 1=low effort, 7=high effort)
  userEffortScore: number; // 1..7
  humanControlScore: number; // 1..7
  userTrustScore: number; // 1..7
  decisionQualityScore: number; // 1..7
  nasaTlxMentalDemand?: number; // 0..100
  nasaTlxFrustration?: number; // 0..100
  failureNotes?: string;
  qualitativeNotes?: string;
  createdAt: string;
}

export interface StandardizedTestTask {
  id: string;
  code: string;
  title: string;
  domain: string;
  initialPrompt: string;
  midTaskChangePrompt: string;
  successCriteria: string[];
  estimatedMinutes: number;
}

export interface UserSession {
  id: string;
  email: string;
  fullName: string;
  role: "researcher" | "admin" | "participant" | "demo";
  authMode: "supabase" | "local_demo";
  authenticated: boolean;
}

export interface PlatformSettings {
  forceDemoMode: boolean;
  requirePlanApproval: boolean;
  autoPauseHighRiskSteps: boolean;
  adaptiveAutonomyEnabled: boolean;
  autonomyThreshold: number; // 0.3..0.95
  telemetryPersistToDisk: boolean;
}

export interface BackendRuntimeStatus {
  geminiConfigured: boolean;
  geminiModel: string;
  supabaseConfigured: boolean;
  activeMode: "live_gemini" | "demo_simulated";
  serverTime: string;
}
