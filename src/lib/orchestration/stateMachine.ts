import type {
  AgentProfile,
  ApprovalRequest,
  ApprovalStatus,
  CollaborativeTask,
  StepPriority,
  TaskCheckpoint,
  TaskStatus,
  TaskStep,
} from "@/types/relay";
import { generateId } from "@/lib/utils/cn";

export class InvalidTaskTransitionError extends Error {
  constructor(from: TaskStatus, to: TaskStatus, reason?: string) {
    super(
      `Invalid task transition from "${from}" to "${to}"${reason ? `: ${reason}` : ""}`
    );
    this.name = "InvalidTaskTransitionError";
  }
}

export class DuplicateExecutionError extends Error {
  constructor(taskId: string, stepId: string) {
    super(`Step "${stepId}" on task "${taskId}" cannot start while another step is running.`);
    this.name = "DuplicateExecutionError";
  }
}

export class ApprovalGateBlockedError extends Error {
  constructor(approvalId: string) {
    super(`Execution blocked: approval "${approvalId}" must be decided by a human before proceeding.`);
    this.name = "ApprovalGateBlockedError";
  }
}

export class UnauthorizedActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnauthorizedActionError";
  }
}

export function assertTaskAuthorizedAndMutable(
  task: CollaborativeTask,
  actorUserId?: string
): void {
  if (task.ownerId && actorUserId && task.ownerId !== actorUserId) {
    throw new UnauthorizedActionError(
      `Actor "${actorUserId}" is not authorized to modify task "${task.id}" owned by "${task.ownerId}".`
    );
  }
  if (task.status === "completed" || task.status === "cancelled") {
    throw new UnauthorizedActionError(
      `Cannot modify task "${task.id}" because it is already in terminal state "${task.status}".`
    );
  }
}

export const FEEDBACK_LOOP_STAGES = [
  { stage: 1, label: "Objective", shortLabel: "1. Objective", detail: "Human provides an objective" },
  { stage: 2, label: "Understand", shortLabel: "2. Understand", detail: "AI analyzes intent and constraints" },
  { stage: 3, label: "Propose Plan", shortLabel: "3. Plan", detail: "Planning Agent proposes structured steps" },
  { stage: 4, label: "Human Review", shortLabel: "4. Review", detail: "Human inspects proposed steps and priorities" },
  { stage: 5, label: "Human Edit", shortLabel: "5. Modify", detail: "Human edits, reorders, adds, or locks steps" },
  { stage: 6, label: "AI Adapts", shortLabel: "6. Adapt", detail: "AI updates dependencies and rationale from feedback" },
  { stage: 7, label: "Plan Approved", shortLabel: "7. Approve Plan", detail: "Human authorizes execution start" },
  { stage: 8, label: "Executing", shortLabel: "8. Execute", detail: "Agents run approved tasks with live progress" },
  { stage: 9, label: "Approval Gate", shortLabel: "9. Gate", detail: "Agent pauses to request human decision" },
  { stage: 10, label: "Human Decision", shortLabel: "10. Decide", detail: "Human approves, edits, or rejects action" },
  { stage: 11, label: "Adapted & Complete", shortLabel: "11. Finalize", detail: "AI updates next steps and delivers output" },
] as const;

export const ALLOWED_TASK_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  pending: ["planning", "cancelled"],
  planning: ["awaiting_plan_approval", "failed", "cancelled"],
  awaiting_plan_approval: ["planning", "running", "paused", "cancelled"],
  running: ["waiting_for_approval", "paused", "completed", "failed", "cancelled"],
  waiting_for_approval: ["running", "planning", "paused", "failed", "cancelled"],
  paused: ["running", "awaiting_plan_approval", "planning", "cancelled"],
  completed: [],
  failed: ["planning", "running", "cancelled"],
  cancelled: [],
};

export function canTransitionTask(from: TaskStatus, to: TaskStatus): boolean {
  if (from === to) return true;
  return ALLOWED_TASK_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertValidTaskTransition(
  task: CollaborativeTask,
  nextStatus: TaskStatus,
  pendingApproval?: ApprovalRequest | null
): void {
  if (!canTransitionTask(task.status, nextStatus)) {
    throw new InvalidTaskTransitionError(task.status, nextStatus);
  }
  if (
    task.status === "waiting_for_approval" &&
    nextStatus === "running" &&
    pendingApproval &&
    pendingApproval.status === "pending"
  ) {
    throw new ApprovalGateBlockedError(pendingApproval.id);
  }
  if (
    task.status === "awaiting_plan_approval" &&
    nextStatus === "running" &&
    !task.planApproved
  ) {
    throw new InvalidTaskTransitionError(
      task.status,
      nextStatus,
      "Plan must be explicitly approved by human before execution."
    );
  }
}

export function transitionTaskStatus(
  task: CollaborativeTask,
  nextStatus: TaskStatus,
  options?: {
    pendingApproval?: ApprovalRequest | null;
    feedbackStage?: number;
    errorMessage?: string;
  }
): CollaborativeTask {
  assertValidTaskTransition(task, nextStatus, options?.pendingApproval);
  const now = new Date().toISOString();
  return {
    ...task,
    status: nextStatus,
    feedbackStage: options?.feedbackStage ?? task.feedbackStage,
    errorMessage: options?.errorMessage ?? task.errorMessage,
    completedAt: nextStatus === "completed" ? now : task.completedAt,
    updatedAt: now,
  };
}

export function calculateTaskProgress(steps: TaskStep[]): number {
  if (steps.length === 0) return 0;
  const weightSum = steps.reduce((acc, step) => {
    if (step.status === "completed" || step.status === "skipped") return acc + 1;
    if (step.status === "running") return acc + 0.5;
    if (step.status === "waiting_for_approval") return acc + 0.65;
    return acc;
  }, 0);
  return Math.round((weightSum / steps.length) * 100);
}

export function guardNoDuplicateStepExecution(
  task: CollaborativeTask,
  targetStepId: string
): void {
  const alreadyRunning = task.steps.find(
    (s) => s.status === "running" && s.id !== targetStepId
  );
  if (alreadyRunning) {
    throw new DuplicateExecutionError(task.id, targetStepId);
  }
}

/**
 * Dependency-aware step scheduler: selects the next pending step whose
 * declared dependencies are all satisfied (completed or skipped).
 * Distinguishes "all done" from "blocked by unsatisfied/failed dependency".
 */
export function findNextRunnableStep(steps: TaskStep[]): {
  step: TaskStep | null;
  allFinished: boolean;
  blockedReason?: string;
} {
  const statusById = new Map(steps.map((s) => [s.id, s.status]));
  const pendingSteps = steps.filter((s) => s.status === "pending");

  if (pendingSteps.length === 0) {
    const anyFailed = steps.some((s) => s.status === "failed");
    return {
      step: null,
      allFinished: !anyFailed,
      blockedReason: anyFailed ? "One or more steps failed and require recovery." : undefined,
    };
  }

  for (const candidate of pendingSteps) {
    const unmet = candidate.dependencies.filter((depId) => {
      if (!statusById.has(depId)) return false; // Deleted step dependency no longer blocks
      const st = statusById.get(depId);
      return st !== "completed" && st !== "skipped";
    });
    if (unmet.length === 0) {
      return { step: candidate, allFinished: false };
    }
  }

  return {
    step: null,
    allFinished: false,
    blockedReason:
      "Remaining pending steps are blocked by unmet or failed upstream dependencies. Reorder steps or retry failed dependencies.",
  };
}

/**
 * Prevents duplicate pending approvals for the same (taskId, stepId).
 */
export function findExistingPendingApproval(
  approvals: ApprovalRequest[],
  taskId: string,
  stepId: string
): ApprovalRequest | null {
  return (
    approvals.find(
      (a) => a.taskId === taskId && a.stepId === stepId && a.status === "pending"
    ) ?? null
  );
}

/**
 * Browser refresh recovery: safely pauses any tasks that were interrupted mid-flight
 * (status === "running" or "planning") so users never get stuck in a phantom running state.
 */
export function recoverInterruptedTasksOnHydration(tasks: CollaborativeTask[]): {
  tasks: CollaborativeTask[];
  recoveredTaskIds: string[];
} {
  const recoveredTaskIds: string[] = [];
  const now = new Date().toISOString();

  const recovered = tasks.map((task) => {
    if (task.status !== "running" && task.status !== "planning") {
      return task;
    }
    recoveredTaskIds.push(task.id);
    const cleanedSteps = task.steps.map((s) =>
      s.status === "running" || s.status === "planning"
        ? { ...s, status: "pending" as const }
        : s
    );
    const recoveredStatus: TaskStatus =
      task.status === "planning" && cleanedSteps.length === 0 ? "failed" : "paused";
    return {
      ...task,
      status: recoveredStatus,
      steps: cleanedSteps,
      progress: calculateTaskProgress(cleanedSteps),
      errorMessage:
        recoveredStatus === "failed"
          ? "Browser refreshed during initial planning. Start again or retry."
          : undefined,
      fallbackNotice:
        recoveredStatus === "paused"
          ? "Session recovered after browser refresh. Click Resume to continue safely from the last completed step."
          : task.fallbackNotice,
      updatedAt: now,
    };
  });

  return { tasks: recovered, recoveredTaskIds };
}

/**
 * Dynamically updates ONLY remaining pending steps when human modifies requirements
 * mid-execution, preserving all completed steps and locked steps untouched.
 * If the requirement introduces a new review/regulatory/compliance dimension,
 * Planning Agent dynamically inserts a dedicated verification step before final output
 * and re-links step dependencies cleanly.
 */
export function updateRemainingStepsWithRequirement(
  task: CollaborativeTask,
  requirementChange: string
): CollaborativeTask {
  const trimmed = requirementChange.trim();
  if (!trimmed) return task;
  const now = new Date().toISOString();
  const lower = trimmed.toLowerCase();

  let updatedSteps: TaskStep[] = task.steps.map((step) => {
    if (step.status !== "pending" || step.isLocked) return step;
    const tag = `[Updated req: ${trimmed}]`;
    return {
      ...step,
      description: step.description.includes(tag)
        ? step.description
        : `${step.description} ${tag}`,
      editedByHuman: true,
    };
  });

  // Dynamically inject a dedicated review/risk step if mid-task pivot introduces regulatory/risk/compliance scope
  const asksForAddedReview =
    lower.includes("regulatory") ||
    lower.includes("compliance") ||
    lower.includes("risk review") ||
    lower.includes("add a ");
  const alreadyHasInjectedStep = updatedSteps.some((s) =>
    s.title.toLowerCase().includes("mid-task pivot") ||
    s.title.toLowerCase().includes("regulatory & winter grid")
  );

  if (asksForAddedReview && !alreadyHasInjectedStep && updatedSteps.length >= 2) {
    const insertAt = updatedSteps.length - 1; // Right before final deliverable
    const prevStep = updatedSteps[insertAt - 1];
    const injectedId = generateId("step");
    const injectedStep: TaskStep = {
      id: injectedId,
      order: insertAt,
      title: lower.includes("northern europe")
        ? "Regulatory & Winter Grid Risk Check (Mid-Task Pivot)"
        : "Adapted Scope & Risk Verification (Mid-Task Pivot)",
      description: `Added dynamically by Planning Agent in response to mid-task human requirement change: "${trimmed}"`,
      assignedAgent: "research-agent",
      priority: "high",
      status: "pending",
      requiresApproval: false,
      isLocked: false,
      editedByHuman: true,
      confidence: null,
      dependencies: prevStep ? [prevStep.id] : [],
    };

    const finalStep = updatedSteps[insertAt];
    const relinkedFinal: TaskStep = {
      ...finalStep,
      dependencies: Array.from(new Set([...finalStep.dependencies, injectedId])),
    };

    updatedSteps = [
      ...updatedSteps.slice(0, insertAt),
      injectedStep,
      relinkedFinal,
    ].map((s, idx) => ({ ...s, order: idx }));
  }

  // Ensure an approval gate remains enforced on at least one remaining pending step after a pivot
  const hasRemainingPendingGate = updatedSteps.some(
    (s) => s.status === "pending" && s.requiresApproval
  );
  if (!hasRemainingPendingGate) {
    const candidateIdx = updatedSteps.findIndex(
      (s, i) => s.status === "pending" && i < updatedSteps.length - 1
    );
    if (candidateIdx !== -1) {
      updatedSteps = updatedSteps.map((s, i) =>
        i === candidateIdx ? { ...s, requiresApproval: true } : s
      );
    }
  }

  const existingCtx = task.sharedContext ?? {
    objective: task.objective,
    humanConstraints: [],
    collectedSources: [],
    handoffs: [],
    recentConversationSummary: "",
  };

  // Deduplicate identical mid-task constraint injections under concurrent clicks
  const mergedConstraints = existingCtx.humanConstraints.includes(trimmed)
    ? existingCtx.humanConstraints
    : [...existingCtx.humanConstraints, trimmed];

  const pivotHandoff = {
    id: generateId("hof"),
    fromAgent: "planning-agent" as const,
    toAgent: "execution-agent" as const,
    stepTitle: "Mid-Task Requirement Adaptation",
    summary: `Propagated mid-task human pivot ("${trimmed.slice(0, 90)}") across ${
      updatedSteps.filter((s) => s.status === "pending" && !s.isLocked).length
    } remaining step(s) while preserving completed & locked work.`,
    keyFindings: [
      `New human constraint: ${trimmed}`,
      `Preserved ${updatedSteps.filter((s) => s.status === "completed").length} completed and ${
        updatedSteps.filter((s) => s.isLocked).length
      } locked step(s).`,
    ],
    sources: existingCtx.collectedSources,
    humanConstraints: mergedConstraints,
    createdAt: now,
  };

  return {
    ...task,
    steps: updatedSteps,
    progress: calculateTaskProgress(updatedSteps),
    sharedContext: {
      ...existingCtx,
      humanConstraints: mergedConstraints,
      handoffs: [...existingCtx.handoffs, pivotHandoff],
    },
    planEditCount: task.planEditCount + 1,
    interactionCount: task.interactionCount + 1,
    updatedAt: now,
  };
}

/**
 * Computes a deterministic, observable structural risk score (0.15–0.90) for a step
 * based strictly on task metadata (priority, agent action impact, deliverable criticality).
 * Completely decoupled from uncalibrated LLM confidence scores.
 */
export function computeStepRiskScore(step: TaskStep, isFinalStep = false): number {
  const priorityWeight =
    step.priority === "high" ? 0.52 : step.priority === "medium" ? 0.34 : 0.16;
  const agentImpactWeight =
    step.assignedAgent === "execution-agent"
      ? 0.16
      : step.assignedAgent === "planning-agent"
      ? 0.1
      : 0.06;
  const deliverableWeight = isFinalStep ? 0.12 : 0;
  return Number(Math.min(0.95, priorityWeight + agentImpactWeight + deliverableWeight).toFixed(2));
}

/**
 * Human-feedback-driven Adaptive Autonomy (Rule-Based — NOT machine learning).
 *
 * Exact escalation rule:
 * 1. Explicit step gate (`step.requiresApproval === true`) ALWAYS escalates when policy is active.
 * 2. Compute structural `stepRiskScore` (0.15–0.95) from observable metadata (never from uncalibrated LLM confidence).
 * 3. Compute `globalRiskBudget = clamp(1.20 - globalThreshold, 0.25, 0.90)` (higher supervision strictness = smaller autonomous risk budget).
 * 4. When Human-feedback-driven Adaptive Autonomy is enabled, cap the autonomous risk budget by the agent's feedback-adjusted `agent.autonomyLevel`:
 *      `effectiveAutonomyBudget = min(globalRiskBudget, agent.autonomyLevel)`
 *    Each human override lowers `agent.autonomyLevel` by -0.08 (floor 0.25); unedited approvals restore +0.03 (ceiling 0.90).
 * 5. Escalate whenever `stepRiskScore > effectiveAutonomyBudget` (works identically even when `step.confidence === null`).
 */
export function evaluateAdaptiveEscalation(params: {
  step: TaskStep;
  agent?: AgentProfile;
  isFinalStep?: boolean;
  globalThreshold: number;
  autoPauseHighRiskSteps: boolean;
  adaptiveAutonomyEnabled: boolean;
}): {
  requiresApproval: boolean;
  reason?: string;
  stepRiskScore: number;
  effectiveAutonomyBudget: number;
  confidenceAvailable: boolean;
} {
  const stepRiskScore = computeStepRiskScore(params.step, Boolean(params.isFinalStep));
  const globalRiskBudget = Number(
    Math.min(0.9, Math.max(0.25, 1.2 - params.globalThreshold)).toFixed(2)
  );
  const agentBudget =
    params.adaptiveAutonomyEnabled && params.agent
      ? params.agent.autonomyLevel
      : 1.0;
  const effectiveAutonomyBudget = Number(Math.min(globalRiskBudget, agentBudget).toFixed(2));
  const confidenceAvailable = typeof params.step.confidence === "number";

  if (!params.autoPauseHighRiskSteps) {
    return {
      requiresApproval: false,
      stepRiskScore,
      effectiveAutonomyBudget,
      confidenceAvailable,
    };
  }

  if (params.step.requiresApproval) {
    return {
      requiresApproval: true,
      reason: "Step explicitly marked as a Human Approval Gate.",
      stepRiskScore,
      effectiveAutonomyBudget,
      confidenceAvailable,
    };
  }

  // Safely escalate if structural risk exceeds the rule-based autonomy budget
  // (completely independent of whether uncalibrated model confidence is available or null)
  if (!params.step.editedByHuman && stepRiskScore > effectiveAutonomyBudget) {
    const narrowedByOverrides =
      params.adaptiveAutonomyEnabled &&
      params.agent &&
      params.agent.overrideCount > 0 &&
      agentBudget < globalRiskBudget;

    return {
      requiresApproval: true,
      stepRiskScore,
      effectiveAutonomyBudget,
      confidenceAvailable,
      reason: narrowedByOverrides
        ? `Human-feedback-driven Adaptive Autonomy (Rule-Based): After ${params.agent!.overrideCount} override(s), ${params.agent!.name}'s autonomy budget tightened to ${Math.round(
            effectiveAutonomyBudget * 100
          )}% — escalating step (structural risk ${Math.round(stepRiskScore * 100)}%) for human approval.`
        : `Rule-Based Supervision Policy: Step structural risk (${Math.round(
            stepRiskScore * 100
          )}%) exceeds the allowed autonomous risk budget (${Math.round(
            effectiveAutonomyBudget * 100
          )}%).`,
    };
  }

  return {
    requiresApproval: false,
    stepRiskScore,
    effectiveAutonomyBudget,
    confidenceAvailable,
  };
}

/**
 * Safely skips a failed/blocked step while explicitly logging a skipped-dependency
 * caveat in sharedContext so downstream steps & audit trails disclose missing upstream evidence.
 */
export function skipStepWithDependencyDisclosure(
  task: CollaborativeTask,
  stepId: string,
  actorUserId?: string
): CollaborativeTask {
  assertTaskAuthorizedAndMutable(task, actorUserId);
  const target = task.steps.find((s) => s.id === stepId);
  if (!target) {
    throw new Error(`Step "${stepId}" not found on task "${task.id}".`);
  }

  const now = new Date().toISOString();
  const updatedSteps: TaskStep[] = task.steps.map((s) =>
    s.id === stepId ? { ...s, status: "skipped" } : s
  );
  const affectedDownstream = updatedSteps
    .filter((s) => s.dependencies.includes(stepId))
    .map((s) => s.title);

  const existingCtx = task.sharedContext ?? {
    objective: task.objective,
    humanConstraints: [],
    collectedSources: [],
    handoffs: [],
    recentConversationSummary: "",
  };

  const caveat = `Upstream step "${target.title}" was skipped by human; downstream outputs must note missing input.`;
  const skipHandoff = {
    id: generateId("hof"),
    fromAgent: "human" as const,
    toAgent: "execution-agent" as const,
    stepId,
    stepTitle: target.title,
    summary: affectedDownstream.length
      ? `Skipped "${target.title}" — unblocked ${affectedDownstream.length} downstream dependent step(s) with explicit missing-evidence disclosure.`
      : `Skipped "${target.title}" to resume workflow execution.`,
    keyFindings: [caveat],
    sources: existingCtx.collectedSources,
    humanConstraints: [...existingCtx.humanConstraints, caveat],
    createdAt: now,
  };

  return {
    ...task,
    steps: updatedSteps,
    progress: calculateTaskProgress(updatedSteps),
    errorMessage: undefined,
    planApproved: true,
    sharedContext: {
      ...existingCtx,
      humanConstraints: [...existingCtx.humanConstraints, caveat],
      handoffs: [...existingCtx.handoffs, skipHandoff],
    },
    interactionCount: task.interactionCount + 1,
    updatedAt: now,
  };
}

export function createCheckpoint(
  task: CollaborativeTask,
  label: string
): TaskCheckpoint {
  return {
    id: generateId("chk"),
    label,
    createdAt: new Date().toISOString(),
    taskStatus: task.status,
    feedbackStage: task.feedbackStage,
    stepsSnapshot: task.steps.map((s) => ({ ...s, dependencies: [...s.dependencies] })),
  };
}

export function rollbackToCheckpoint(
  task: CollaborativeTask,
  checkpointId: string
): CollaborativeTask {
  const checkpoint = task.checkpoints.find((c) => c.id === checkpointId);
  if (!checkpoint) {
    throw new Error(`Checkpoint "${checkpointId}" not found on task "${task.id}".`);
  }
  const restoredSteps = checkpoint.stepsSnapshot.map((s) => ({
    ...s,
    status: s.status === "running" ? "pending" : s.status,
    dependencies: [...s.dependencies],
  }));
  return {
    ...task,
    status: checkpoint.taskStatus === "completed" ? "paused" : checkpoint.taskStatus,
    feedbackStage: checkpoint.feedbackStage,
    steps: restoredSteps,
    progress: calculateTaskProgress(restoredSteps),
    activeApprovalId: null,
    interruptCount: task.interruptCount + 1,
    updatedAt: new Date().toISOString(),
  };
}

export type PlanMutation =
  | { type: "edit"; stepId: string; title?: string; description?: string; priority?: StepPriority; requiresApproval?: boolean }
  | { type: "add"; title: string; description: string; assignedAgent?: TaskStep["assignedAgent"]; priority?: StepPriority; requiresApproval?: boolean }
  | { type: "delete"; stepId: string }
  | { type: "reorder"; stepId: string; direction: "up" | "down" }
  | { type: "toggle_lock"; stepId: string };

export function applyPlanMutation(
  task: CollaborativeTask,
  mutation: PlanMutation,
  actorUserId?: string
): CollaborativeTask {
  assertTaskAuthorizedAndMutable(task, actorUserId);
  let steps = task.steps.map((s) => ({ ...s }));
  const now = new Date().toISOString();

  switch (mutation.type) {
    case "edit": {
      steps = steps.map((s) => {
        if (s.id !== mutation.stepId) return s;
        if (s.isLocked) return s;
        return {
          ...s,
          title: mutation.title !== undefined ? mutation.title : s.title,
          description: mutation.description !== undefined ? mutation.description : s.description,
          priority: mutation.priority ?? s.priority,
          requiresApproval:
            mutation.requiresApproval !== undefined
              ? mutation.requiresApproval
              : s.requiresApproval,
          editedByHuman: true,
        };
      });
      break;
    }
    case "add": {
      const newStep: TaskStep = {
        id: generateId("step"),
        order: steps.length,
        title: mutation.title.trim() || "Custom human-added step",
        description: mutation.description.trim() || "Added directly by human collaborator.",
        assignedAgent: mutation.assignedAgent ?? "execution-agent",
        priority: mutation.priority ?? "medium",
        status: "pending",
        requiresApproval: mutation.requiresApproval ?? false,
        isLocked: false,
        editedByHuman: true,
        confidence: 0.9,
        dependencies: steps.length > 0 ? [steps[steps.length - 1].id] : [],
      };
      steps.push(newStep);
      break;
    }
    case "delete": {
      const target = steps.find((s) => s.id === mutation.stepId);
      if (target && !target.isLocked && target.status !== "running") {
        steps = steps
          .filter((s) => s.id !== mutation.stepId)
          .map((s, idx) => ({ ...s, order: idx }));
      }
      break;
    }
    case "reorder": {
      const index = steps.findIndex((s) => s.id === mutation.stepId);
      if (index === -1) break;
      const swapIdx = mutation.direction === "up" ? index - 1 : index + 1;
      if (swapIdx < 0 || swapIdx >= steps.length) break;
      if (steps[index].isLocked || steps[swapIdx].isLocked) break;
      const temp = steps[index];
      steps[index] = steps[swapIdx];
      steps[swapIdx] = temp;
      steps = steps.map((s, idx) => ({ ...s, order: idx, editedByHuman: true }));
      break;
    }
    case "toggle_lock": {
      steps = steps.map((s) =>
        s.id === mutation.stepId ? { ...s, isLocked: !s.isLocked } : s
      );
      break;
    }
  }

  return {
    ...task,
    steps,
    progress: calculateTaskProgress(steps),
    feedbackStage: Math.max(task.feedbackStage, 5),
    planEditCount: task.planEditCount + 1,
    interactionCount: task.interactionCount + 1,
    updatedAt: now,
  };
}

export function resolveApprovalDecision(
  task: CollaborativeTask,
  approval: ApprovalRequest,
  decision: Exclude<ApprovalStatus, "pending">,
  feedback?: string,
  selectedAlternative?: string,
  actorUserId?: string
): { updatedTask: CollaborativeTask; updatedApproval: ApprovalRequest } {
  assertTaskAuthorizedAndMutable(task, actorUserId);
  if (approval.taskId !== task.id) {
    throw new UnauthorizedActionError(
      `Approval "${approval.id}" belongs to task "${approval.taskId}", not "${task.id}".`
    );
  }
  if (approval.status !== "pending") {
    throw new Error(`Approval "${approval.id}" was already resolved as "${approval.status}".`);
  }

  const now = new Date().toISOString();
  const updatedApproval: ApprovalRequest = {
    ...approval,
    status: decision,
    humanFeedback: feedback,
    selectedAlternative,
    decidedAt: now,
  };

  let updatedSteps = task.steps.map((step) => {
    if (step.id !== approval.stepId) return step;
    if (decision === "rejected") {
      return {
        ...step,
        status: "pending" as const,
        description: selectedAlternative
          ? `${step.description} [Redirected to alternative: ${selectedAlternative}]`
          : feedback
          ? `${step.description} [Revised per rejection: ${feedback}]`
          : step.description,
        requiresApproval: false,
        editedByHuman: true,
      };
    }
    return {
      ...step,
      description:
        decision === "edited_and_approved" && (feedback || selectedAlternative)
          ? `${step.description} [Human edit: ${selectedAlternative || feedback}]`
          : step.description,
      requiresApproval: false,
      editedByHuman: decision === "edited_and_approved" ? true : step.editedByHuman,
      status: "pending" as const,
    };
  });

  // If rejected with an alternative, ensure downstream synthesis step reflects adaptation
  if (decision === "rejected" || decision === "edited_and_approved") {
    updatedSteps = updatedSteps.map((step) => {
      if (step.status === "pending" && step.id !== approval.stepId) {
        return {
          ...step,
          description: step.description.includes("[Adapted]")
            ? step.description
            : `${step.description} [Adapted to human decision]`,
        };
      }
      return step;
    });
  }

  const nextStatus: TaskStatus =
    task.status === "waiting_for_approval" ? "running" : task.status;

  const updatedTask: CollaborativeTask = {
    ...task,
    status: nextStatus,
    feedbackStage: 10,
    steps: updatedSteps,
    activeApprovalId: null,
    approvalCount:
      decision === "approved" || decision === "edited_and_approved"
        ? task.approvalCount + 1
        : task.approvalCount,
    rejectionCount: decision === "rejected" ? task.rejectionCount + 1 : task.rejectionCount,
    interactionCount: task.interactionCount + 1,
    progress: calculateTaskProgress(updatedSteps),
    updatedAt: now,
  };

  return { updatedTask, updatedApproval };
}

/**
 * Adaptive behavior layer: tracks human overrides/rejections and recalibrates
 * agent autonomy smoothly between 0.25 (closely supervised) and 0.90 (high autonomy).
 */
export function updateAgentAdaptiveAutonomy(
  agent: AgentProfile,
  wasOverridden: boolean
): AgentProfile {
  const totalDecisions = agent.totalDecisions + 1;
  const overrideCount = agent.overrideCount + (wasOverridden ? 1 : 0);
  const overrideRate = overrideCount / totalDecisions;

  // Higher override rate reduces autonomy so the agent asks earlier;
  // consistent alignment gradually restores autonomy.
  const delta = wasOverridden ? -0.08 : 0.03;
  const nextAutonomy = Math.min(0.9, Math.max(0.25, Number((agent.autonomyLevel + delta).toFixed(2))));

  return {
    ...agent,
    totalDecisions,
    overrideCount,
    autonomyLevel: nextAutonomy,
    avgConfidence: Number(Math.max(0.55, Math.min(0.96, 0.92 - overrideRate * 0.25)).toFixed(2)),
    lastActiveAt: new Date().toISOString(),
  };
}

/**
 * Topologically orders React Flow workflow nodes following directed edges,
 * breaking ties deterministically by canvas x-position (and handling cycles safely).
 */
export function sortWorkflowNodesTopologically<
  TNode extends { id: string; position: { x: number; y: number } }
>(
  nodes: TNode[],
  edges: Array<{ source: string; target: string }>
): TNode[] {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const n of nodes) {
    inDegree.set(n.id, 0);
    adjacency.set(n.id, []);
  }

  for (const e of edges) {
    if (!nodeMap.has(e.source) || !nodeMap.has(e.target) || e.source === e.target) continue;
    adjacency.get(e.source)!.push(e.target);
    inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1);
  }

  const ready = nodes
    .filter((n) => (inDegree.get(n.id) ?? 0) === 0)
    .sort((a, b) => a.position.x - b.position.x);

  const ordered: TNode[] = [];
  const visited = new Set<string>();

  while (ready.length > 0) {
    const current = ready.shift()!;
    if (visited.has(current.id)) continue;
    visited.add(current.id);
    ordered.push(current);

    for (const nextId of adjacency.get(current.id) ?? []) {
      const deg = (inDegree.get(nextId) ?? 1) - 1;
      inDegree.set(nextId, deg);
      if (deg === 0 && !visited.has(nextId)) {
        ready.push(nodeMap.get(nextId)!);
        ready.sort((a, b) => a.position.x - b.position.x);
      }
    }
  }

  // Append any remaining nodes (e.g., if user drew a feedback cycle) by x-position
  if (ordered.length < nodes.length) {
    const remaining = nodes
      .filter((n) => !visited.has(n.id))
      .sort((a, b) => a.position.x - b.position.x);
    ordered.push(...remaining);
  }

  return ordered;
}
