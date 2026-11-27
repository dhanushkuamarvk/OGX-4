import { describe, expect, it } from "vitest";
import {
  evaluateAdaptiveEscalation,
  findExistingPendingApproval,
  findNextRunnableStep,
  recoverInterruptedTasksOnHydration,
  updateRemainingStepsWithRequirement,
} from "@/lib/orchestration/stateMachine";
import { runResearchAgent } from "@/lib/agents/researchAgent";
import {
  answerClarificationQuestion,
  buildApprovalRequestForStep,
  runExecutionAgent,
} from "@/lib/agents/executionAgent";
import { runPlanningAgent } from "@/lib/agents/planningAgent";
import type {
  AgentProfile,
  ApprovalRequest,
  CollaborativeTask,
  SharedTaskContext,
} from "@/types/relay";

function makeTask(overrides?: Partial<CollaborativeTask>): CollaborativeTask {
  const now = new Date().toISOString();
  return {
    id: "t_ref",
    conversationId: "c_ref",
    title: "Test Task",
    objective: "Prepare a research report about renewable energy.",
    status: "running",
    feedbackStage: 8,
    planApproved: true,
    progress: 33,
    confidenceScore: null,
    reasoningSummary: "Test plan",
    alternatives: [],
    steps: [
      {
        id: "s1",
        order: 0,
        title: "Step 1",
        description: "First",
        assignedAgent: "research-agent",
        priority: "high",
        status: "completed",
        requiresApproval: false,
        isLocked: false,
        editedByHuman: false,
        confidence: 0.9,
        dependencies: [],
        output: "Step 1 output",
      },
      {
        id: "s2",
        order: 1,
        title: "Step 2",
        description: "Second (locked)",
        assignedAgent: "execution-agent",
        priority: "high",
        status: "pending",
        requiresApproval: false,
        isLocked: true,
        editedByHuman: false,
        confidence: 0.85,
        dependencies: ["s1"],
      },
      {
        id: "s3",
        order: 2,
        title: "Step 3",
        description: "Third (unlocked)",
        assignedAgent: "execution-agent",
        priority: "medium",
        status: "pending",
        requiresApproval: false,
        isLocked: false,
        editedByHuman: false,
        confidence: 0.88,
        dependencies: ["s2"],
      },
    ],
    checkpoints: [],
    isSimulated: true,
    interactionCount: 2,
    planEditCount: 0,
    approvalCount: 1,
    rejectionCount: 0,
    interruptCount: 0,
    startedAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("Dependency-Aware Scheduling & Failure Recovery", () => {
  it("respects step dependencies even when steps are reordered and detects blocked graphs", () => {
    const t = makeTask();
    // Reverse pending steps: s3 depends on s2, so s2 must still be scheduled first
    const reordered = [t.steps[0], t.steps[2], t.steps[1]];
    const sched = findNextRunnableStep(reordered);
    expect(sched.step?.id).toBe("s2");
    expect(sched.allFinished).toBe(false);

    // If s2 fails, s3 cannot run and scheduler reports blockedReason
    const withFailedDep = t.steps.map((s) =>
      s.id === "s2" ? { ...s, status: "failed" as const } : s
    );
    const blocked = findNextRunnableStep(withFailedDep);
    expect(blocked.step).toBeNull();
    expect(blocked.allFinished).toBe(false);
    expect(blocked.blockedReason).toBeTruthy();
  });

  it("prevents duplicate pending approvals for the same (taskId, stepId)", () => {
    const existing: ApprovalRequest[] = [
      {
        id: "apr_1",
        taskId: "t_ref",
        stepId: "s2",
        agentSlug: "execution-agent",
        actionTitle: "Gate",
        actionDescription: "Desc",
        recommendationReason: "Reason",
        expectedResult: "Result",
        supportingEvidence: [],
        potentialRisks: [],
        alternativeActions: [],
        confidence: 0.85,
        status: "pending",
        qaThread: [],
        isSimulated: true,
        createdAt: new Date().toISOString(),
      },
    ];

    expect(findExistingPendingApproval(existing, "t_ref", "s2")?.id).toBe("apr_1");
    expect(findExistingPendingApproval(existing, "t_ref", "s3")).toBeNull();
    const decided = [{ ...existing[0], status: "approved" as const }];
    expect(findExistingPendingApproval(decided, "t_ref", "s2")).toBeNull();
  });

  it("safely recovers interrupted running/planning tasks after browser refresh", () => {
    const runningTask = makeTask({
      id: "t_running",
      status: "running",
      steps: makeTask().steps.map((s) =>
        s.id === "s2" ? { ...s, status: "running" as const } : s
      ),
    });
    const planningEmpty = makeTask({
      id: "t_planning",
      status: "planning",
      steps: [],
    });
    const completedTask = makeTask({ id: "t_done", status: "completed" });

    const { tasks, recoveredTaskIds } = recoverInterruptedTasksOnHydration([
      runningTask,
      planningEmpty,
      completedTask,
    ]);

    expect(recoveredTaskIds).toEqual(["t_running", "t_planning"]);
    expect(tasks[0].status).toBe("paused");
    expect(tasks[0].steps[1].status).toBe("pending");
    expect(tasks[0].fallbackNotice).toContain("browser refresh");
    expect(tasks[1].status).toBe("failed");
    expect(tasks[2].status).toBe("completed");
  });

  it("updates ONLY remaining pending unlocked steps on mid-flight requirement change", () => {
    const task = makeTask();
    const updated = updateRemainingStepsWithRequirement(
      task,
      "Prioritize Northern European winter reliability"
    );

    // Completed step 1 untouched
    expect(updated.steps[0].description).toBe("First");
    // Locked pending step 2 untouched
    expect(updated.steps[1].description).toBe("Second (locked)");
    // Unlocked pending step 3 updated
    expect(updated.steps[2].description).toContain(
      "Prioritize Northern European winter reliability"
    );
    expect(updated.sharedContext?.humanConstraints).toContain(
      "Prioritize Northern European winter reliability"
    );
  });
});

describe("Shared Context Handoffs, Honest Explainability & Clarification", () => {
  it("propagates structured handoffs, sources, constraints, uncertainties & expected outcomes across all 3 agents", async () => {
    const plan = await runPlanningAgent({
      objective: "Prepare a research report about renewable energy.",
      forceDemo: true,
    });
    expect(plan.explainability.uncertainties.length).toBeGreaterThan(0);
    expect(plan.explainability.expectedOutcomes.length).toBeGreaterThan(0);
    expect(plan.explainability.confidenceEstimate).toBeNull();

    const sharedContext: SharedTaskContext = {
      objective: "Prepare a research report about renewable energy.",
      humanConstraints: ["Prioritize 4-hour LFP storage"],
      collectedSources: [],
      handoffs: [],
      recentConversationSummary: "",
    };

    const research = await runResearchAgent({
      objective: sharedContext.objective,
      step: plan.steps[0],
      priorOutputs: [],
      sharedContext,
      forceDemo: true,
    });
    expect(research.handoff.fromAgent).toBe("research-agent");
    expect(research.handoff.toAgent).toBe("execution-agent");
    expect(research.explainability.uncertainties.length).toBeGreaterThan(0);
    expect(research.explainability.expectedOutcomes.length).toBeGreaterThan(0);
    expect(research.explainability.confidenceEstimate).toBeNull();

    sharedContext.handoffs.push(research.handoff);
    sharedContext.collectedSources.push(...research.sources);

    const finalStep = await runExecutionAgent({
      taskId: "t_handoff",
      objective: sharedContext.objective,
      step: plan.steps[4],
      allSteps: plan.steps,
      priorOutputs: [research.output],
      sharedContext,
      forceDemo: true,
    });

    expect(finalStep.output).toContain("Prioritize 4-hour LFP storage");
    expect(finalStep.handoff.fromAgent).toBe("execution-agent");
    expect(finalStep.handoff.toAgent).toBe("human");
    expect(finalStep.explainability.uncertainties.length).toBeGreaterThan(0);
    expect(finalStep.explainability.expectedOutcomes.length).toBeGreaterThan(0);

    const clarify = await answerClarificationQuestion({
      objective: sharedContext.objective,
      taskStatus: "paused",
      stepsSummary: "1. Research renewable energy",
      question: "Why is Step 4 gated?",
      constraints: sharedContext.humanConstraints,
      forceDemo: true,
    });
    expect(clarify.answer).toContain("Prioritize 4-hour LFP storage");
  });

  it("proactively escalates steps via rule-based Human-feedback-driven Adaptive Autonomy even when confidence is null", () => {
    const task = makeTask();
    // Medium-priority Execution step with confidence = null (unavailable!)
    // Structural risk = 0.34 (medium) + 0.16 (execution-agent) = 0.50
    const uncalibratedMediumExecStep = {
      ...task.steps[2],
      priority: "medium" as const,
      assignedAgent: "execution-agent" as const,
      confidence: null,
      requiresApproval: false,
    };
    const alignedAgent: AgentProfile = {
      id: "ag_exec",
      slug: "execution-agent",
      name: "Execution Agent",
      roleTitle: "Delivery",
      description: "",
      capabilities: [],
      status: "online",
      autonomyLevel: 0.62,
      overrideCount: 0,
      totalDecisions: 2,
      tasksCompleted: 1,
      avgConfidence: 0.9,
      currentTaskLabel: null,
      lastActiveAt: new Date().toISOString(),
    };

    // Global strictness 0.70 => global risk budget 0.50; agent budget 0.62 => min = 0.50
    // Step risk 0.50 <= 0.50 => allowed autonomously even with confidence === null
    const beforeOverride = evaluateAdaptiveEscalation({
      step: uncalibratedMediumExecStep,
      agent: alignedAgent,
      globalThreshold: 0.7,
      autoPauseHighRiskSteps: true,
      adaptiveAutonomyEnabled: true,
    });
    expect(beforeOverride.requiresApproval).toBe(false);
    expect(beforeOverride.confidenceAvailable).toBe(false);
    expect(beforeOverride.stepRiskScore).toBe(0.5);

    // After 2 human overrides, agent autonomy drops to 0.46 => effective budget = min(0.50, 0.46) = 0.46
    // Step risk 0.50 > 0.46 => escalates automatically regardless of null confidence!
    const overriddenAgent: AgentProfile = {
      ...alignedAgent,
      autonomyLevel: 0.46,
      overrideCount: 2,
      totalDecisions: 4,
    };
    const afterOverride = evaluateAdaptiveEscalation({
      step: uncalibratedMediumExecStep,
      agent: overriddenAgent,
      globalThreshold: 0.7,
      autoPauseHighRiskSteps: true,
      adaptiveAutonomyEnabled: true,
    });
    expect(afterOverride.requiresApproval).toBe(true);
    expect(afterOverride.effectiveAutonomyBudget).toBe(0.46);
    expect(afterOverride.reason).toContain("Human-feedback-driven Adaptive Autonomy (Rule-Based)");
  });

  it("dynamically injects a regulatory risk step, enforces an approval gate, and labels predefined Northern Europe demo output", async () => {
    const baseTask = makeTask();
    const pivotPrompt =
      "MID-TASK PIVOT: Target region changed to Northern Europe (low winter solar). Prioritize 24/7 firm baseload (Offshore Wind + Enhanced Geothermal + Hydro) and add a regulatory risk review step.";

    const pivoted = updateRemainingStepsWithRequirement(baseTask, pivotPrompt);
    // Completed step 1 untouched, locked step 2 untouched, new regulatory step injected before final step!
    expect(pivoted.steps).toHaveLength(4);
    expect(pivoted.steps[2].title).toContain("Regulatory & Winter Grid Risk Check");
    expect(pivoted.steps[3].dependencies).toContain(pivoted.steps[2].id);
    expect(pivoted.steps.some((s) => s.status === "pending" && s.requiresApproval)).toBe(true);
    expect(pivoted.sharedContext?.handoffs.at(-1)?.fromAgent).toBe("planning-agent");

    // Approval Gate adapts framing to Northern Europe 24/7 Firm Baseload
    const approval = buildApprovalRequestForStep(
      pivoted.id,
      pivoted.objective,
      pivoted.steps[2],
      true,
      pivoted.sharedContext
    );
    expect(approval.actionTitle).toContain("Northern Europe");
    expect(approval.actionDescription).toContain("Offshore Wind + Enhanced Geothermal");

    // Final Report substantively switches primary strategy & clearly labels Predefined Demonstration Output
    const finalReport = await runExecutionAgent({
      taskId: pivoted.id,
      objective: pivoted.objective,
      step: pivoted.steps[3],
      allSteps: pivoted.steps,
      priorOutputs: ["Research findings"],
      sharedContext: pivoted.sharedContext,
      forceDemo: true,
    });
    expect(finalReport.isFinalReport).toBe(true);
    expect(finalReport.output).toContain("PREDEFINED DEMONSTRATION OUTPUT");
    expect(finalReport.output).toContain("Northern Europe 24/7 Clean Baseload Strategy Report");
    expect(finalReport.output).toContain("Dunkelflaute");
  });
});
