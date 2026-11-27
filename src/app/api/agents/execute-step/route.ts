import { NextResponse } from "next/server";
import { z } from "zod";
import { isGeminiApiKeyValid } from "@/lib/ai/gemini";
import { runResearchAgent } from "@/lib/agents/researchAgent";
import {
  buildApprovalRequestForStep,
  runExecutionAgent,
} from "@/lib/agents/executionAgent";
import { appendTelemetryEvent } from "@/lib/evaluation/telemetry";
import { generateId } from "@/lib/utils/cn";
import type { SharedTaskContext, TaskStep } from "@/types/relay";

const ExecuteStepSchema = z.object({
  taskId: z.string().min(1).max(120),
  objective: z.string().min(1).max(12000),
  step: z.any(),
  allSteps: z.array(z.any()).min(1).max(25),
  priorOutputs: z.array(z.string().max(15000)).max(25).default([]),
  sharedContext: z.any().optional(),
  escalationReason: z.string().max(500).optional(),
  humanDecisionNote: z.string().max(3000).optional(),
  forceDemo: z.boolean().optional(),
  sessionId: z.string().max(120).optional(),
});

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = ExecuteStepSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid step execution payload", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const step = parsed.data.step as TaskStep;
    const allSteps = parsed.data.allSteps as TaskStep[];
    const sharedContext = parsed.data.sharedContext as SharedTaskContext | undefined;

    if (!step?.id || !step?.title) {
      return NextResponse.json({ error: "Step must include id and title" }, { status: 400 });
    }

    // Enforce human approval gate strictly before executing approval-required steps
    if (step.requiresApproval) {
      const isSimulated = Boolean(parsed.data.forceDemo) || !isGeminiApiKeyValid();
      const approvalRequest = buildApprovalRequestForStep(
        parsed.data.taskId,
        parsed.data.objective,
        step,
        isSimulated,
        sharedContext,
        parsed.data.escalationReason
      );

      return NextResponse.json({
        gated: true,
        approvalRequest,
        isSimulated,
      });
    }

    if (step.assignedAgent === "research-agent") {
      const res = await runResearchAgent({
        objective: parsed.data.objective,
        step,
        priorOutputs: parsed.data.priorOutputs,
        sharedContext,
        forceDemo: parsed.data.forceDemo,
      });

      appendTelemetryEvent({
        id: generateId("tel"),
        eventType: "step_executed",
        condition: "relay_ai",
        sessionId: parsed.data.sessionId ?? parsed.data.taskId,
        latencyMs: res.latencyMs,
        inputTokens: res.inputTokens,
        outputTokens: res.outputTokens,
        isSimulated: res.isSimulated,
        metadata: { agent: "research-agent", stepTitle: step.title },
        timestamp: new Date().toISOString(),
      });

      return NextResponse.json({
        gated: false,
        agentSlug: "research-agent",
        output: res.output,
        sources: res.sources,
        handoff: res.handoff,
        isFinalReport: false,
        confidence: res.confidence,
        explainability: res.explainability,
        isSimulated: res.isSimulated,
        fallbackNotice: res.fallbackNotice,
        latencyMs: res.latencyMs,
        inputTokens: res.inputTokens,
        outputTokens: res.outputTokens,
      });
    }

    const exec = await runExecutionAgent({
      taskId: parsed.data.taskId,
      objective: parsed.data.objective,
      step,
      allSteps,
      priorOutputs: parsed.data.priorOutputs,
      sharedContext,
      humanDecisionNote: parsed.data.humanDecisionNote,
      forceDemo: parsed.data.forceDemo,
    });

    appendTelemetryEvent({
      id: generateId("tel"),
      eventType: "step_executed",
      condition: "relay_ai",
      sessionId: parsed.data.sessionId ?? parsed.data.taskId,
      latencyMs: exec.latencyMs,
      inputTokens: exec.inputTokens,
      outputTokens: exec.outputTokens,
      isSimulated: exec.isSimulated,
      metadata: {
        agent: "execution-agent",
        stepTitle: step.title,
        isFinalReport: exec.isFinalReport,
      },
      timestamp: new Date().toISOString(),
    });

    return NextResponse.json({
      gated: false,
      agentSlug: "execution-agent",
      ...exec,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Step execution failed" },
      { status: 500 }
    );
  }
}
