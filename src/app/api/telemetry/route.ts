import { NextResponse } from "next/server";
import { z } from "zod";
import {
  persistEvaluationRun,
  readPersistedEvaluations,
  readTelemetryEvents,
} from "@/lib/evaluation/telemetry";
import { exportEvaluationRunsToCSV } from "@/lib/evaluation/metrics";
import type { EvaluationRun } from "@/types/relay";

export const dynamic = "force-dynamic";

const EvaluationRunSchema = z.object({
  id: z.string().min(1),
  participantCode: z.string().min(1),
  taskTemplateId: z.string().min(1),
  taskTitle: z.string().min(1),
  condition: z.enum(["baseline", "relay_ai"]),
  isSampleData: z.boolean().default(false),
  completedSuccessfully: z.boolean(),
  completionTimeSec: z.number().min(0),
  interactionCount: z.number().int().min(0),
  approvalCount: z.number().int().min(0),
  rejectionCount: z.number().int().min(0),
  planEditCount: z.number().int().min(0),
  interruptCount: z.number().int().min(0),
  midTaskChangeHandled: z.boolean(),
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  userEffortScore: z.number().min(1).max(7),
  humanControlScore: z.number().min(1).max(7),
  userTrustScore: z.number().min(1).max(7),
  decisionQualityScore: z.number().min(1).max(7),
  nasaTlxMentalDemand: z.number().min(0).max(100).optional(),
  nasaTlxFrustration: z.number().min(0).max(100).optional(),
  failureNotes: z.string().optional(),
  qualitativeNotes: z.string().optional(),
  createdAt: z.string(),
});

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const format = searchParams.get("format");
  const evaluations = readPersistedEvaluations();

  if (format === "csv") {
    const csv = exportEvaluationRunsToCSV(evaluations);
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="relay-ai-evaluations.csv"',
      },
    });
  }

  return NextResponse.json({
    evaluations,
    events: readTelemetryEvents(100),
  });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = EvaluationRunSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid evaluation payload", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const result = await persistEvaluationRun(parsed.data as EvaluationRun);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to persist telemetry" },
      { status: 500 }
    );
  }
}
