import { NextResponse } from "next/server";
import { z } from "zod";
import { runPlanningAgent } from "@/lib/agents/planningAgent";
import { appendTelemetryEvent } from "@/lib/evaluation/telemetry";
import { generateId } from "@/lib/utils/cn";
import type { TaskStep } from "@/types/relay";

const PlanRequestSchema = z.object({
  objective: z.string().trim().min(2, "Objective is required").max(12000, "Objective too long"),
  attachmentsSummary: z.string().max(4000).optional(),
  humanFeedback: z.string().max(4000).optional(),
  conversationContext: z.string().max(6000).optional(),
  existingSteps: z.array(z.any()).max(25).optional(),
  forceDemo: z.boolean().optional(),
  sessionId: z.string().max(120).optional(),
});

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = PlanRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid planning request", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const result = await runPlanningAgent({
      objective: parsed.data.objective,
      attachmentsSummary: parsed.data.attachmentsSummary,
      humanFeedback: parsed.data.humanFeedback,
      conversationContext: parsed.data.conversationContext,
      existingSteps: parsed.data.existingSteps as TaskStep[] | undefined,
      forceDemo: parsed.data.forceDemo,
    });

    appendTelemetryEvent({
      id: generateId("tel"),
      eventType: parsed.data.humanFeedback ? "plan_adapted" : "plan_generated",
      condition: "relay_ai",
      sessionId: parsed.data.sessionId ?? "workspace",
      latencyMs: result.latencyMs,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      isSimulated: result.isSimulated,
      metadata: {
        stepCount: result.steps.length,
        title: result.title,
        fallbackNotice: result.fallbackNotice,
      },
      timestamp: new Date().toISOString(),
    });

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Planning agent failed" },
      { status: 500 }
    );
  }
}
