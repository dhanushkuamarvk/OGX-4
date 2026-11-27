import { describe, expect, it } from "vitest";
import { runPlanningAgent } from "@/lib/agents/planningAgent";
import { runResearchAgent } from "@/lib/agents/researchAgent";
import {
  askAgentAboutApproval,
  buildApprovalRequestForStep,
  runExecutionAgent,
} from "@/lib/agents/executionAgent";
import { extractJsonObject } from "@/lib/ai/gemini";
import { sortWorkflowNodesTopologically } from "@/lib/orchestration/stateMachine";

describe("Multi-Agent Trio (Demo Mode End-to-End)", () => {
  it("Planning Agent produces the 5-step Renewable Energy plan and adapts to human feedback", async () => {
    const plan = await runPlanningAgent({
      objective: "Prepare a research report about renewable energy.",
      forceDemo: true,
    });

    expect(plan.isSimulated).toBe(true);
    expect(plan.steps).toHaveLength(5);
    expect(plan.steps[0].title).toBe("Research renewable energy");
    expect(plan.steps[3].requiresApproval).toBe(true);
    expect(plan.explainability.evidenceUsed.length).toBeGreaterThan(0);

    // Lock step 1 and adapt plan with human feedback
    const lockedSteps = plan.steps.map((s, i) => (i === 0 ? { ...s, isLocked: true } : s));
    const adapted = await runPlanningAgent({
      objective: "Prepare a research report about renewable energy.",
      existingSteps: lockedSteps,
      humanFeedback: "Emphasize Northern European winter grid reliability",
      forceDemo: true,
    });

    expect(adapted.steps[0].description).toBe(lockedSteps[0].description);
    expect(adapted.steps[2].description).toContain("Northern European winter grid reliability");
  });

  it("Research Agent returns evidence-grounded findings and sources", async () => {
    const plan = await runPlanningAgent({
      objective: "Prepare a research report about renewable energy.",
      forceDemo: true,
    });
    const res = await runResearchAgent({
      objective: "Prepare a research report about renewable energy.",
      step: plan.steps[0],
      priorOutputs: [],
      forceDemo: true,
    });

    expect(res.isSimulated).toBe(true);
    expect(res.output).toContain("Solar PV");
    expect(res.sources.length).toBeGreaterThanOrEqual(2);
    expect(res.confidence).toBeNull();
    expect(res.explainability.uncertainties.length).toBeGreaterThan(0);
    expect(res.explainability.expectedOutcomes.length).toBeGreaterThan(0);
  });

  it("Execution Agent builds rich Approval Requests, answers Ask Agent Q&A, and generates final report", async () => {
    const plan = await runPlanningAgent({
      objective: "Prepare a research report about renewable energy.",
      forceDemo: true,
    });

    const approval = buildApprovalRequestForStep(
      "task_demo",
      "Prepare a research report about renewable energy.",
      plan.steps[3],
      true
    );
    expect(approval.status).toBe("pending");
    expect(approval.supportingEvidence.length).toBeGreaterThan(0);
    expect(approval.potentialRisks.length).toBeGreaterThan(0);
    expect(approval.alternativeActions.length).toBeGreaterThan(0);

    const qa = await askAgentAboutApproval({
      approval,
      question: "What if winter solar output is low?",
      forceDemo: true,
    });
    expect(qa.answer.length).toBeGreaterThan(40);

    const finalOut = await runExecutionAgent({
      taskId: "task_demo",
      objective: "Prepare a research report about renewable energy.",
      step: plan.steps[4],
      allSteps: plan.steps,
      priorOutputs: ["Research findings summary"],
      humanDecisionNote: "Approved with 4-hour LFP storage emphasis",
      forceDemo: true,
    });
    expect(finalOut.isFinalReport).toBe(true);
    expect(finalOut.output).toContain("# Renewable Energy Research Report");
    expect(finalOut.output).toContain("4-hour LFP storage emphasis");
  });
});

describe("Gemini JSON Extraction & Visual Workflow Topological Sort", () => {
  it("extracts raw JSON, fenced markdown JSON, and gracefully returns null on malformed text", () => {
    expect(extractJsonObject<{ ok: boolean }>('{"ok":true}')).toEqual({ ok: true });
    expect(
      extractJsonObject<{ steps: number }>('Here is plan:\n```json\n{"steps": 5}\n```')
    ).toEqual({ steps: 5 });
    expect(extractJsonObject("not json at all")).toBeNull();
  });

  it("orders workflow nodes strictly along directed edges and survives cycles safely", () => {
    const nodes = [
      { id: "c", position: { x: 100, y: 0 } },
      { id: "a", position: { x: 400, y: 0 } },
      { id: "b", position: { x: 250, y: 0 } },
    ];
    // Directed chain: a -> b -> c (even though x positions are reversed!)
    const edges = [
      { source: "a", target: "b" },
      { source: "b", target: "c" },
    ];
    const sorted = sortWorkflowNodesTopologically(nodes, edges);
    expect(sorted.map((n) => n.id)).toEqual(["a", "b", "c"]);

    // Cycle safety: a -> b -> a should not hang or drop nodes
    const cyclic = sortWorkflowNodesTopologically(nodes, [
      { source: "a", target: "b" },
      { source: "b", target: "a" },
    ]);
    expect(cyclic).toHaveLength(3);
  });
});
