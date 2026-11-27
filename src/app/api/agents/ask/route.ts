import { NextResponse } from "next/server";
import { z } from "zod";
import {
  answerClarificationQuestion,
  askAgentAboutApproval,
} from "@/lib/agents/executionAgent";
import type { ApprovalRequest } from "@/types/relay";

const AskApprovalSchema = z.object({
  mode: z.literal("approval").optional(),
  approval: z.any(),
  question: z.string().trim().min(2).max(2000),
  forceDemo: z.boolean().optional(),
});

const ClarifyTaskSchema = z.object({
  mode: z.literal("clarify"),
  objective: z.string().min(2).max(8000),
  taskStatus: z.string().max(64),
  stepsSummary: z.string().max(6000),
  constraints: z.array(z.string().max(500)).max(20).optional(),
  question: z.string().trim().min(2).max(2000),
  forceDemo: z.boolean().optional(),
});

export async function POST(req: Request) {
  try {
    const body = await req.json();

    if (body?.mode === "clarify") {
      const parsed = ClarifyTaskSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          { error: "Invalid clarification payload", details: parsed.error.flatten() },
          { status: 400 }
        );
      }
      const res = await answerClarificationQuestion(parsed.data);
      return NextResponse.json(res);
    }

    const parsed = AskApprovalSchema.safeParse(body);
    if (!parsed.success || !parsed.data.approval?.actionTitle) {
      return NextResponse.json({ error: "Invalid question payload" }, { status: 400 });
    }

    const result = await askAgentAboutApproval({
      approval: parsed.data.approval as ApprovalRequest,
      question: parsed.data.question,
      forceDemo: parsed.data.forceDemo,
    });

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to ask agent" },
      { status: 500 }
    );
  }
}
