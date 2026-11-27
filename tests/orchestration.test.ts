import { describe, expect, it } from "vitest";
import {
  ApprovalGateBlockedError,
  DuplicateExecutionError,
  InvalidTaskTransitionError,
  applyPlanMutation,
  calculateTaskProgress,
  canTransitionTask,
  createCheckpoint,
  guardNoDuplicateStepExecution,
  resolveApprovalDecision,
  rollbackToCheckpoint,
  transitionTaskStatus,
  updateAgentAdaptiveAutonomy,
} from "@/lib/orchestration/stateMachine";
import type { AgentProfile, ApprovalRequest, CollaborativeTask } from "@/types/relay";

function makeSampleTask(overrides?: Partial<CollaborativeTask>): CollaborativeTask {
  const now = new Date().toISOString();
  return {
    id: "task_1",
    conversationId: "conv_1",
    title: "Renewable Energy Research Report",
    objective: "Prepare a research report about renewable energy.",
    status: "awaiting_plan_approval",
    feedbackStage: 4,
    planApproved: false,
    progress: 0,
    confidenceScore: 0.9,
    reasoningSummary: "5-step collaborative plan",
    alternatives: [],
    steps: [
      {
        id: "s1",
        order: 0,
        title: "Research renewable energy",
        description: "Survey global trends",
        assignedAgent: "research-agent",
        priority: "high",
        status: "pending",
        requiresApproval: false,
        isLocked: false,
        editedByHuman: false,
        confidence: 0.92,
        dependencies: [],
      },
      {
        id: "s2",
        order: 1,
        title: "Analyze findings",
        description: "Weight energy sources",
        assignedAgent: "execution-agent",
        priority: "high",
        status: "pending",
        requiresApproval: true,
        isLocked: false,
        editedByHuman: false,
        confidence: 0.85,
        dependencies: ["s1"],
      },
      {
        id: "s3",
        order: 2,
        title: "Generate final report",
        description: "Compile final markdown report",
        assignedAgent: "execution-agent",
        priority: "medium",
        status: "pending",
        requiresApproval: false,
        isLocked: false,
        editedByHuman: false,
        confidence: 0.91,
        dependencies: ["s2"],
      },
    ],
    checkpoints: [],
    isSimulated: true,
    interactionCount: 1,
    planEditCount: 0,
    approvalCount: 0,
    rejectionCount: 0,
    interruptCount: 0,
    startedAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeSampleApproval(overrides?: Partial<ApprovalRequest>): ApprovalRequest {
  return {
    id: "apr_1",
    taskId: "task_1",
    stepId: "s2",
    agentSlug: "execution-agent",
    actionTitle: "Approve weighting criteria",
    actionDescription: "Apply 40/35/25 weighting",
    recommendationReason: "Balanced LCOE & grid reliability",
    expectedResult: "Hybrid portfolio recommendation",
    supportingEvidence: ["IEA 2025", "NREL ATB"],
    potentialRisks: ["Regional winter solar variance"],
    alternativeActions: ["Prioritize 24/7 Firm Baseload"],
    confidence: 0.85,
    status: "pending",
    qaThread: [],
    isSimulated: true,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("Task State Machine Transitions", () => {
  it("allows valid lifecycle transitions and blocks invalid transitions", () => {
    expect(canTransitionTask("pending", "planning")).toBe(true);
    expect(canTransitionTask("planning", "awaiting_plan_approval")).toBe(true);
    expect(canTransitionTask("running", "waiting_for_approval")).toBe(true);
    expect(canTransitionTask("completed", "running")).toBe(false);
    expect(canTransitionTask("pending", "completed")).toBe(false);
  });

  it("blocks running a task before the human approves the plan", () => {
    const task = makeSampleTask({ status: "awaiting_plan_approval", planApproved: false });
    expect(() => transitionTaskStatus(task, "running")).toThrow(InvalidTaskTransitionError);

    const approvedTask = { ...task, planApproved: true };
    const running = transitionTaskStatus(approvedTask, "running");
    expect(running.status).toBe("running");
  });

  it("prevents duplicate concurrent step execution on the same task", () => {
    const task = makeSampleTask({ status: "running", planApproved: true });
    task.steps[0].status = "running";
    expect(() => guardNoDuplicateStepExecution(task, "s2")).toThrow(DuplicateExecutionError);
    expect(() => guardNoDuplicateStepExecution(task, "s1")).not.toThrow();
  });
});

describe("Human Approval Flow & Gate Enforcement", () => {
  it("blocks resuming from waiting_for_approval while approval is still pending", () => {
    const task = makeSampleTask({
      status: "waiting_for_approval",
      planApproved: true,
      activeApprovalId: "apr_1",
    });
    const pendingApproval = makeSampleApproval({ status: "pending" });

    expect(() =>
      transitionTaskStatus(task, "running", { pendingApproval })
    ).toThrow(ApprovalGateBlockedError);
  });

  it("resolves approval decisions and adapts downstream steps on edit or rejection", () => {
    const task = makeSampleTask({
      status: "waiting_for_approval",
      planApproved: true,
      activeApprovalId: "apr_1",
    });
    const approval = makeSampleApproval();

    const { updatedTask, updatedApproval } = resolveApprovalDecision(
      task,
      approval,
      "rejected",
      "Use Northern European baseload priority",
      "Prioritize 24/7 Firm Baseload"
    );

    expect(updatedApproval.status).toBe("rejected");
    expect(updatedTask.status).toBe("running");
    expect(updatedTask.rejectionCount).toBe(1);
    expect(updatedTask.activeApprovalId).toBeNull();
    expect(updatedTask.steps[1].requiresApproval).toBe(false);
    expect(updatedTask.steps[1].description).toContain("Prioritize 24/7 Firm Baseload");
    expect(updatedTask.steps[2].description).toContain("[Adapted to human decision]");
  });
});

describe("Human Feedback Plan Updates, Rollback & Adaptive Autonomy", () => {
  it("applies edit, add, reorder, lock, and delete mutations while protecting locked steps", () => {
    let task = makeSampleTask();

    // Lock step 1 and attempt edit/delete (should remain protected)
    task = applyPlanMutation(task, { type: "toggle_lock", stepId: "s1" });
    expect(task.steps[0].isLocked).toBe(true);

    task = applyPlanMutation(task, {
      type: "edit",
      stepId: "s1",
      title: "Should not overwrite locked step",
    });
    expect(task.steps[0].title).toBe("Research renewable energy");

    task = applyPlanMutation(task, { type: "delete", stepId: "s1" });
    expect(task.steps).toHaveLength(3);

    // Edit unlocked step 2, add step 4, reorder steps 2 & 3
    task = applyPlanMutation(task, {
      type: "edit",
      stepId: "s2",
      title: "Analyze findings with LFP storage",
      priority: "low",
    });
    expect(task.steps[1].title).toBe("Analyze findings with LFP storage");
    expect(task.steps[1].editedByHuman).toBe(true);

    task = applyPlanMutation(task, {
      type: "add",
      title: "Verify regional grid policy",
      description: "Check IRA & EU Green Deal rules",
      priority: "high",
    });
    expect(task.steps).toHaveLength(4);

    task = applyPlanMutation(task, { type: "reorder", stepId: "s3", direction: "up" });
    expect(task.steps[1].id).toBe("s3");
  });

  it("restores prior step state cleanly via checkpoint rollback", () => {
    const task = makeSampleTask({ status: "running", planApproved: true });
    const chk = createCheckpoint(task, "Before Step 2");
    const mutated = {
      ...task,
      checkpoints: [chk],
      steps: task.steps.map((s, i) => (i === 0 ? { ...s, status: "completed" as const } : s)),
    };
    expect(calculateTaskProgress(mutated.steps)).toBeGreaterThan(0);

    const rolledBack = rollbackToCheckpoint(mutated, chk.id);
    expect(rolledBack.steps[0].status).toBe("pending");
    expect(rolledBack.interruptCount).toBe(1);
  });

  it("recalibrates agent adaptive autonomy based on human overrides", () => {
    const agent: AgentProfile = {
      id: "ag_1",
      slug: "execution-agent",
      name: "Execution Agent",
      roleTitle: "Delivery",
      description: "Executes steps",
      capabilities: [],
      status: "online",
      autonomyLevel: 0.7,
      overrideCount: 0,
      totalDecisions: 0,
      tasksCompleted: 0,
      avgConfidence: 0.9,
      currentTaskLabel: null,
      lastActiveAt: new Date().toISOString(),
    };

    const afterOverride = updateAgentAdaptiveAutonomy(agent, true);
    expect(afterOverride.autonomyLevel).toBeLessThan(agent.autonomyLevel);
    expect(afterOverride.overrideCount).toBe(1);

    const afterApproval = updateAgentAdaptiveAutonomy(afterOverride, false);
    expect(afterApproval.autonomyLevel).toBeGreaterThan(afterOverride.autonomyLevel);
    expect(afterApproval.totalDecisions).toBe(2);
  });
});
