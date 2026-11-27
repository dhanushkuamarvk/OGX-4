import { describe, expect, it, vi } from "vitest";
import {
  DuplicateExecutionError,
  UnauthorizedActionError,
  applyPlanMutation,
  findNextRunnableStep,
  guardNoDuplicateStepExecution,
  resolveApprovalDecision,
  skipStepWithDependencyDisclosure,
  transitionTaskStatus,
  updateRemainingStepsWithRequirement,
} from "@/lib/orchestration/stateMachine";
import * as supabaseModule from "@/lib/database/supabase";
import { syncWorkspaceSnapshotToSupabase } from "@/lib/database/persistence";
import type { ApprovalRequest, CollaborativeTask } from "@/types/relay";

function makeOwnedTask(overrides?: Partial<CollaborativeTask>): CollaborativeTask {
  const now = new Date().toISOString();
  return {
    id: "task_sec_1",
    ownerId: "user_alice",
    conversationId: "conv_sec_1",
    title: "Security Audit Task",
    objective: "Evaluate grid security",
    status: "running",
    feedbackStage: 8,
    planApproved: true,
    progress: 33,
    confidenceScore: null,
    reasoningSummary: "Plan",
    alternatives: [],
    steps: [
      {
        id: "s1",
        order: 0,
        title: "Collect telemetry",
        description: "Step 1",
        assignedAgent: "research-agent",
        priority: "high",
        status: "failed",
        requiresApproval: false,
        isLocked: false,
        editedByHuman: false,
        confidence: null,
        dependencies: [],
      },
      {
        id: "s2",
        order: 1,
        title: "Synthesize recommendations",
        description: "Depends on Step 1",
        assignedAgent: "execution-agent",
        priority: "medium",
        status: "pending",
        requiresApproval: false,
        isLocked: false,
        editedByHuman: false,
        confidence: null,
        dependencies: ["s1"],
      },
    ],
    checkpoints: [],
    isSimulated: true,
    interactionCount: 1,
    planEditCount: 0,
    approvalCount: 1,
    rejectionCount: 0,
    interruptCount: 0,
    startedAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("Security, Authorization & Concurrency Edge Cases", () => {
  it("blocks unauthorized task mutations by a non-owner or on terminal tasks", () => {
    const task = makeOwnedTask();
    expect(() =>
      applyPlanMutation(task, { type: "edit", stepId: "s2", title: "Tampered" }, "user_mallory")
    ).toThrow(UnauthorizedActionError);

    const completed = makeOwnedTask({ status: "completed" });
    expect(() =>
      applyPlanMutation(completed, { type: "delete", stepId: "s2" }, "user_alice")
    ).toThrow(UnauthorizedActionError);
  });

  it("blocks unauthorized approval decisions (wrong actor or mismatched taskId)", () => {
    const task = makeOwnedTask({ status: "waiting_for_approval" });
    const approval: ApprovalRequest = {
      id: "apr_sec_1",
      taskId: "task_sec_1",
      stepId: "s2",
      agentSlug: "execution-agent",
      actionTitle: "Approve step",
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
    };

    expect(() =>
      resolveApprovalDecision(task, approval, "approved", undefined, undefined, "user_mallory")
    ).toThrow(UnauthorizedActionError);

    const mismatchedApproval = { ...approval, taskId: "task_other" };
    expect(() =>
      resolveApprovalDecision(task, mismatchedApproval, "approved", undefined, undefined, "user_alice")
    ).toThrow(UnauthorizedActionError);
  });

  it("handles concurrent interruption & duplicate mid-task requirement requests idempotently", () => {
    const task = makeOwnedTask({
      steps: makeOwnedTask().steps.map((s) => ({ ...s, status: "pending" as const })),
    });
    const req = "Prioritize Northern Europe regulatory compliance review";

    // Rapid duplicate interruption calls should NOT duplicate injected steps or duplicate constraints
    const first = updateRemainingStepsWithRequirement(task, req);
    const second = updateRemainingStepsWithRequirement(first, req);
    expect(first.steps).toHaveLength(3);
    expect(second.steps).toHaveLength(3);
    expect(second.sharedContext?.humanConstraints.filter((c) => c === req)).toHaveLength(1);

    // Concurrent pause transitions are idempotent
    const p1 = transitionTaskStatus(second, "paused");
    const p2 = transitionTaskStatus(p1, "paused");
    expect(p2.status).toBe("paused");
  });

  it("unblocks downstream dependent steps when skipping a failed step while explicitly recording missing-evidence disclosure", () => {
    const task = makeOwnedTask();
    // Before skip: s2 is blocked by failed prerequisite s1
    const before = findNextRunnableStep(task.steps);
    expect(before.step).toBeNull();
    expect(before.blockedReason).toBeTruthy();

    // After authorized skip: s1 is skipped, s2 is now runnable, and sharedContext discloses missing upstream input
    const afterSkip = skipStepWithDependencyDisclosure(task, "s1", "user_alice");
    const next = findNextRunnableStep(afterSkip.steps);
    expect(next.step?.id).toBe("s2");
    expect(
      afterSkip.sharedContext?.humanConstraints.some((c) =>
        c.includes('Upstream step "Collect telemetry" was skipped')
      )
    ).toBe(true);
    expect(afterSkip.sharedContext?.handoffs.at(-1)?.summary).toContain("unblocked 1 downstream");
  });

  it("prevents duplicate concurrent task step execution", () => {
    const task = makeOwnedTask({
      steps: [
        { ...makeOwnedTask().steps[0], status: "running" },
        { ...makeOwnedTask().steps[1], status: "pending" },
      ],
    });
    expect(() => guardNoDuplicateStepExecution(task, "s2")).toThrow(DuplicateExecutionError);
  });

  it("handles failed cloud persistence synchronization cleanly without unhandled exceptions", async () => {
    // 1. Unconfigured local demo mode returns honest local_demo result
    const demoRes = await syncWorkspaceSnapshotToSupabase({
      userId: "user_alice",
      task: makeOwnedTask(),
    });
    expect(demoRes.mode).toBe("local_demo");
    expect(demoRes.synced).toBe(false);

    // 2. Simulated Supabase database outage returns synced=false with error reason cleanly
    const mockAdmin = {
      from: () => ({
        upsert: async () => {
          throw new Error("Simulated PostgreSQL connection refused");
        },
      }),
    };
    const spy = vi
      .spyOn(supabaseModule, "getSupabaseAdminClient")
      .mockReturnValue(mockAdmin as unknown as ReturnType<typeof supabaseModule.getSupabaseAdminClient>);

    try {
      const failRes = await syncWorkspaceSnapshotToSupabase({
        userId: "user_alice",
        task: makeOwnedTask(),
      });
      expect(failRes.mode).toBe("cloud_supabase");
      expect(failRes.synced).toBe(false);
      expect(failRes.reason).toContain("Simulated PostgreSQL connection refused");
    } finally {
      spy.mockRestore();
    }
  });
});
