import { describe, expect, it } from "vitest";
import {
  ILLUSTRATIVE_SAMPLE_RUNS,
  aggregateCondition,
  computeComparisonSummary,
  computeMeasuredOnlySummary,
  exportEvaluationRunsToCSV,
  generateEvaluationMarkdownReport,
} from "@/lib/evaluation/metrics";
import type { EvaluationRun } from "@/types/relay";

const MEASURED_FIXTURES: EvaluationRun[] = [
  {
    id: "m_base_1",
    participantCode: "P01",
    taskTemplateId: "task_renewable_report",
    taskTitle: "Renewable Energy Report",
    condition: "baseline",
    isSampleData: false,
    completedSuccessfully: true,
    completionTimeSec: 200,
    interactionCount: 6,
    approvalCount: 0,
    rejectionCount: 0,
    planEditCount: 0,
    interruptCount: 0,
    midTaskChangeHandled: false,
    inputTokens: 900,
    outputTokens: 2100,
    userEffortScore: 5,
    humanControlScore: 3,
    userTrustScore: 3.5,
    decisionQualityScore: 4,
    nasaTlxMentalDemand: 70,
    nasaTlxFrustration: 65,
    failureNotes: "Required full re-prompt after mid-task change",
    createdAt: "2026-11-27T06:00:00.000Z",
  },
  {
    id: "m_relay_1",
    participantCode: "P01",
    taskTemplateId: "task_renewable_report",
    taskTitle: "Renewable Energy Report",
    condition: "relay_ai",
    isSampleData: false,
    completedSuccessfully: true,
    completionTimeSec: 150,
    interactionCount: 4,
    approvalCount: 2,
    rejectionCount: 0,
    planEditCount: 2,
    interruptCount: 0,
    midTaskChangeHandled: true,
    inputTokens: 820,
    outputTokens: 1950,
    userEffortScore: 3,
    humanControlScore: 6,
    userTrustScore: 6,
    decisionQualityScore: 6,
    nasaTlxMentalDemand: 35,
    nasaTlxFrustration: 20,
    createdAt: "2026-11-27T06:15:00.000Z",
  },
];

describe("Scientific Evaluation Metric Calculations", () => {
  it("computes accurate condition aggregates and Baseline vs. RELAY AI deltas", () => {
    const summary = computeComparisonSummary(MEASURED_FIXTURES);

    expect(summary.hasMeasuredData).toBe(true);
    expect(summary.baseline.sampleSize).toBe(1);
    expect(summary.relayAi.sampleSize).toBe(1);
    expect(summary.deltas.timeDiffSec).toBe(-50);
    expect(summary.deltas.timeReductionPct).toBe(25);
    expect(summary.deltas.effortDiff).toBe(-2);
    expect(summary.deltas.controlDiff).toBe(3);
    expect(summary.deltas.trustDiff).toBe(2.5);
    expect(summary.deltas.decisionQualityDiff).toBe(2);
  });

  it("handles empty measured datasets gracefully without NaN values", () => {
    const emptyAgg = aggregateCondition([], "relay_ai");
    expect(emptyAgg.sampleSize).toBe(0);
    expect(emptyAgg.taskSuccessRatePct).toBe(0);
    expect(emptyAgg.avgCompletionTimeSec).toBe(0);

    const summary = computeComparisonSummary([]);
    expect(summary.hasMeasuredData).toBe(false);
    expect(summary.deltas.timeReductionPct).toBe(0);
  });

  it("strictly labels MEASURED_EXPERIMENT vs ILLUSTRATIVE_SAMPLE in CSV and Markdown exports", () => {
    const csvMeasured = exportEvaluationRunsToCSV(MEASURED_FIXTURES);
    expect(csvMeasured).toContain("MEASURED_EXPERIMENT");
    expect(csvMeasured).not.toContain("ILLUSTRATIVE_SAMPLE");

    const csvSample = exportEvaluationRunsToCSV(ILLUSTRATIVE_SAMPLE_RUNS);
    expect(csvSample).toContain("ILLUSTRATIVE_SAMPLE");

    const mdReport = generateEvaluationMarkdownReport(MEASURED_FIXTURES, false);
    expect(mdReport).toContain("MEASURED PARTICIPANT RUNS ONLY");
    expect(mdReport).toContain("Required full re-prompt after mid-task change");

    const mdSample = generateEvaluationMarkdownReport(ILLUSTRATIVE_SAMPLE_RUNS, true);
    expect(mdSample).toContain("INCLUDES ILLUSTRATIVE SAMPLE DATA");
  });

  it("properly escapes commas, double-quotes, and newlines in CSV telemetry exports", () => {
    const trickyRun: EvaluationRun = {
      ...MEASURED_FIXTURES[0],
      id: "m_escape_1",
      taskTitle: 'Energy, "Grid" & Policy',
      failureNotes: 'Line 1, "quoted"\nLine 2',
    };
    const csv = exportEvaluationRunsToCSV([trickyRun]);
    expect(csv).toContain('"Energy, ""Grid"" & Policy"');
    expect(csv).toContain('"Line 1, ""quoted""\nLine 2"');
  });

  it("strictly prevents sample preview data from ever entering measured evaluation summaries", () => {
    // Mixed array containing both sample preview rows and zero real measured rows
    const sampleOnly = computeMeasuredOnlySummary(ILLUSTRATIVE_SAMPLE_RUNS);
    expect(sampleOnly.hasMeasuredData).toBe(false);
    expect(sampleOnly.baseline.sampleSize).toBe(0);
    expect(sampleOnly.relayAi.sampleSize).toBe(0);

    // Mixed array containing both measured and sample preview rows -> only measured counted
    const mixed = computeMeasuredOnlySummary([
      ...MEASURED_FIXTURES,
      ...ILLUSTRATIVE_SAMPLE_RUNS,
    ]);
    expect(mixed.hasMeasuredData).toBe(true);
    expect(mixed.baseline.sampleSize).toBe(1);
    expect(mixed.relayAi.sampleSize).toBe(1);
    expect(mixed.baseline.avgCompletionTimeSec).toBe(200);
  });
});
