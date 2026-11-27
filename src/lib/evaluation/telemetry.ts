import fs from "fs";
import path from "path";
import type { EvaluationRun } from "@/types/relay";
import { exportEvaluationRunsToCSV } from "@/lib/evaluation/metrics";
import { getSupabaseAdminClient } from "@/lib/database/supabase";

const TELEMETRY_DIR = path.join(process.cwd(), ".relay-telemetry");
const EVENTS_JSONL_PATH = path.join(TELEMETRY_DIR, "interaction_events.jsonl");
const EVALUATIONS_JSON_PATH = path.join(TELEMETRY_DIR, "evaluations.json");
const EVALUATIONS_CSV_PATH = path.join(TELEMETRY_DIR, "evaluations.csv");

export interface TelemetryEventRecord {
  id: string;
  eventType:
    | "baseline_chat"
    | "plan_generated"
    | "plan_adapted"
    | "step_executed"
    | "approval_decision"
    | "evaluation_recorded";
  condition: "baseline" | "relay_ai";
  sessionId: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  isSimulated: boolean;
  metadata?: Record<string, unknown>;
  timestamp: string;
}

function ensureTelemetryDir(): boolean {
  try {
    if (!fs.existsSync(TELEMETRY_DIR)) {
      fs.mkdirSync(TELEMETRY_DIR, { recursive: true });
    }
    return true;
  } catch {
    return false;
  }
}

export function appendTelemetryEvent(record: TelemetryEventRecord): void {
  if (!ensureTelemetryDir()) return;
  try {
    fs.appendFileSync(EVENTS_JSONL_PATH, JSON.stringify(record) + "\n", "utf8");
  } catch {
    // Non-fatal in read-only/serverless environments
  }
}

export function readTelemetryEvents(limit = 200): TelemetryEventRecord[] {
  try {
    if (!fs.existsSync(EVENTS_JSONL_PATH)) return [];
    const lines = fs
      .readFileSync(EVENTS_JSONL_PATH, "utf8")
      .split("\n")
      .filter((l) => l.trim().length > 0);
    return lines
      .slice(-limit)
      .map((line) => JSON.parse(line) as TelemetryEventRecord)
      .reverse();
  } catch {
    return [];
  }
}

export function readPersistedEvaluations(): EvaluationRun[] {
  try {
    if (!fs.existsSync(EVALUATIONS_JSON_PATH)) return [];
    const raw = fs.readFileSync(EVALUATIONS_JSON_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as EvaluationRun[]) : [];
  } catch {
    return [];
  }
}

export async function persistEvaluationRun(run: EvaluationRun): Promise<{
  savedToDisk: boolean;
  savedToSupabase: boolean;
}> {
  let savedToDisk = false;
  let savedToSupabase = false;

  if (ensureTelemetryDir()) {
    try {
      const existing = readPersistedEvaluations().filter((r) => r.id !== run.id);
      const updated = [run, ...existing];
      fs.writeFileSync(EVALUATIONS_JSON_PATH, JSON.stringify(updated, null, 2), "utf8");
      fs.writeFileSync(EVALUATIONS_CSV_PATH, exportEvaluationRunsToCSV(updated), "utf8");
      savedToDisk = true;
    } catch {
      savedToDisk = false;
    }
  }

  appendTelemetryEvent({
    id: `tel_${run.id}`,
    eventType: "evaluation_recorded",
    condition: run.condition,
    sessionId: run.participantCode,
    latencyMs: Math.round(run.completionTimeSec * 1000),
    inputTokens: run.inputTokens,
    outputTokens: run.outputTokens,
    isSimulated: run.isSampleData,
    metadata: {
      taskTemplateId: run.taskTemplateId,
      completedSuccessfully: run.completedSuccessfully,
      interactionCount: run.interactionCount,
      approvalCount: run.approvalCount,
      rejectionCount: run.rejectionCount,
    },
    timestamp: run.createdAt,
  });

  // Optional Supabase persistence if service role is configured
  const admin = getSupabaseAdminClient();
  if (admin && !run.isSampleData) {
    try {
      const { data: insertedEval, error: evalError } = await admin
        .from("evaluations")
        .insert({
          participant_code: run.participantCode,
          task_template_id: run.taskTemplateId,
          task_title: run.taskTitle,
          condition: run.condition,
          is_sample_data: false,
          completed_successfully: run.completedSuccessfully,
          completion_time_sec: run.completionTimeSec,
          interaction_count: run.interactionCount,
          approval_count: run.approvalCount,
          rejection_count: run.rejectionCount,
          plan_edit_count: run.planEditCount,
          interrupt_count: run.interruptCount,
          mid_task_change_handled: run.midTaskChangeHandled,
          input_tokens: run.inputTokens,
          output_tokens: run.outputTokens,
          failure_notes: run.failureNotes ?? null,
        })
        .select("id")
        .single();

      if (!evalError && insertedEval?.id) {
        const { error: respError } = await admin.from("evaluation_responses").insert({
          evaluation_id: insertedEval.id,
          user_effort_score: run.userEffortScore,
          human_control_score: run.humanControlScore,
          user_trust_score: run.userTrustScore,
          decision_quality_score: run.decisionQualityScore,
          nasa_tlx_mental_demand: run.nasaTlxMentalDemand ?? null,
          nasa_tlx_frustration: run.nasaTlxFrustration ?? null,
          qualitative_notes: run.qualitativeNotes ?? run.failureNotes ?? null,
        });
        if (!respError) savedToSupabase = true;
      }
    } catch {
      savedToSupabase = false;
    }
  }

  return { savedToDisk, savedToSupabase };
}
