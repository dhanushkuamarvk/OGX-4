import type {
  EvaluationRun,
  ExperimentCondition,
  StandardizedTestTask,
} from "@/types/relay";

export const STANDARDIZED_TEST_TASKS: StandardizedTestTask[] = [
  {
    id: "task_renewable_report",
    code: "T1",
    title: "Renewable Energy Investment & Policy Report",
    domain: "Energy Strategy",
    initialPrompt: "Prepare a research report about renewable energy.",
    midTaskChangePrompt:
      "Requirement change: Prioritize 24/7 grid reliability and LFP storage economics for Northern European grids over lowest raw daytime LCOE.",
    successCriteria: [
      "Compares at least 4 renewable energy sources quantitatively",
      "Integrates mid-task grid reliability requirement cleanly",
      "Surfaces risks & implementation roadmap",
    ],
    estimatedMinutes: 6,
  },
  {
    id: "task_saas_launch",
    code: "T2",
    title: "B2B AI Product Launch & Compliance Plan",
    domain: "Product Strategy",
    initialPrompt:
      "Create a 90-day go-to-market and risk compliance plan for launching a B2B healthcare scheduling AI assistant.",
    midTaskChangePrompt:
      "Requirement change: Narrow target launch strictly to mid-size dental clinics under HIPAA Business Associate Agreement constraints and cut budget by 35%.",
    successCriteria: [
      "Addresses HIPAA compliance & risk gates explicitly",
      "Adapts GTM plan to dental clinic budget constraint without losing structure",
      "Provides phased launch milestones",
    ],
    estimatedMinutes: 7,
  },
  {
    id: "task_supply_chain",
    code: "T3",
    title: "Supply Chain Disruption Mitigation Playbook",
    domain: "Operations",
    initialPrompt:
      "Design an actionable mitigation playbook for a semiconductor shortage affecting two regional EV battery assembly plants.",
    midTaskChangePrompt:
      "Requirement change: Secondary supplier in Penang is delayed by 6 weeks — prioritize air-freight cost caps and critical SKU triage.",
    successCriteria: [
      "Separates immediate triage from medium-term dual-sourcing",
      "Incorporates the 6-week Penang delay mid-workflow",
      "Explicitly flags approval-required financial commitments",
    ],
    estimatedMinutes: 6,
  },
];

export interface ConditionAggregate {
  condition: ExperimentCondition;
  sampleSize: number;
  taskSuccessRatePct: number;
  avgCompletionTimeSec: number;
  avgInteractions: number;
  avgApprovals: number;
  avgRejections: number;
  avgPlanEdits: number;
  avgUserEffort: number; // 1-7 (lower is better)
  avgHumanControl: number; // 1-7 (higher is better)
  avgUserTrust: number; // 1-7 (higher is better)
  avgDecisionQuality: number; // 1-7 (higher is better)
  avgNasaTlxMental: number; // 0-100 (lower is better)
  midTaskChangeSuccessPct: number;
}

export interface ComparisonSummary {
  baseline: ConditionAggregate;
  relayAi: ConditionAggregate;
  hasMeasuredData: boolean;
  deltas: {
    successRateDiffPct: number;
    timeDiffSec: number;
    timeReductionPct: number;
    effortDiff: number;
    controlDiff: number;
    trustDiff: number;
    decisionQualityDiff: number;
  };
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function aggregateCondition(
  runs: EvaluationRun[],
  condition: ExperimentCondition
): ConditionAggregate {
  const subset = runs.filter((r) => r.condition === condition);
  const n = subset.length;
  if (n === 0) {
    return {
      condition,
      sampleSize: 0,
      taskSuccessRatePct: 0,
      avgCompletionTimeSec: 0,
      avgInteractions: 0,
      avgApprovals: 0,
      avgRejections: 0,
      avgPlanEdits: 0,
      avgUserEffort: 0,
      avgHumanControl: 0,
      avgUserTrust: 0,
      avgDecisionQuality: 0,
      avgNasaTlxMental: 0,
      midTaskChangeSuccessPct: 0,
    };
  }

  return {
    condition,
    sampleSize: n,
    taskSuccessRatePct: round2((subset.filter((r) => r.completedSuccessfully).length / n) * 100),
    avgCompletionTimeSec: round2(mean(subset.map((r) => r.completionTimeSec))),
    avgInteractions: round2(mean(subset.map((r) => r.interactionCount))),
    avgApprovals: round2(mean(subset.map((r) => r.approvalCount))),
    avgRejections: round2(mean(subset.map((r) => r.rejectionCount))),
    avgPlanEdits: round2(mean(subset.map((r) => r.planEditCount))),
    avgUserEffort: round2(mean(subset.map((r) => r.userEffortScore))),
    avgHumanControl: round2(mean(subset.map((r) => r.humanControlScore))),
    avgUserTrust: round2(mean(subset.map((r) => r.userTrustScore))),
    avgDecisionQuality: round2(mean(subset.map((r) => r.decisionQualityScore))),
    avgNasaTlxMental: round2(
      mean(subset.map((r) => r.nasaTlxMentalDemand ?? Math.round((r.userEffortScore / 7) * 100)))
    ),
    midTaskChangeSuccessPct: round2(
      (subset.filter((r) => r.midTaskChangeHandled).length / n) * 100
    ),
  };
}

export function computeComparisonSummary(runs: EvaluationRun[]): ComparisonSummary {
  const baseline = aggregateCondition(runs, "baseline");
  const relayAi = aggregateCondition(runs, "relay_ai");
  const hasMeasuredData = runs.some((r) => !r.isSampleData);

  const timeReductionPct =
    baseline.avgCompletionTimeSec > 0
      ? round2(
          ((baseline.avgCompletionTimeSec - relayAi.avgCompletionTimeSec) /
            baseline.avgCompletionTimeSec) *
            100
        )
      : 0;

  return {
    baseline,
    relayAi,
    hasMeasuredData,
    deltas: {
      successRateDiffPct: round2(relayAi.taskSuccessRatePct - baseline.taskSuccessRatePct),
      timeDiffSec: round2(relayAi.avgCompletionTimeSec - baseline.avgCompletionTimeSec),
      timeReductionPct,
      effortDiff: round2(relayAi.avgUserEffort - baseline.avgUserEffort),
      controlDiff: round2(relayAi.avgHumanControl - baseline.avgHumanControl),
      trustDiff: round2(relayAi.avgUserTrust - baseline.avgUserTrust),
      decisionQualityDiff: round2(relayAi.avgDecisionQuality - baseline.avgDecisionQuality),
    },
  };
}

/**
 * Strictly excludes any sample preview rows (`isSampleData === true`) so illustrative
 * preview data can NEVER contaminate measured evaluation statistics.
 */
export function computeMeasuredOnlySummary(allRuns: EvaluationRun[]): ComparisonSummary {
  const measuredOnly = allRuns.filter((r) => !r.isSampleData);
  return computeComparisonSummary(measuredOnly);
}

export function exportEvaluationRunsToCSV(runs: EvaluationRun[]): string {
  const headers = [
    "id",
    "participant_code",
    "task_template_id",
    "task_title",
    "condition",
    "data_origin",
    "completed_successfully",
    "completion_time_sec",
    "interaction_count",
    "approval_count",
    "rejection_count",
    "plan_edit_count",
    "interrupt_count",
    "mid_task_change_handled",
    "input_tokens",
    "output_tokens",
    "user_effort_1_to_7",
    "human_control_1_to_7",
    "user_trust_1_to_7",
    "decision_quality_1_to_7",
    "nasa_tlx_mental_demand",
    "nasa_tlx_frustration",
    "failure_notes",
    "created_at",
  ];

  const escapeCell = (val: unknown) => {
    const s = String(val ?? "");
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const rows = runs.map((r) =>
    [
      r.id,
      r.participantCode,
      r.taskTemplateId,
      r.taskTitle,
      r.condition,
      r.isSampleData ? "ILLUSTRATIVE_SAMPLE" : "MEASURED_EXPERIMENT",
      r.completedSuccessfully,
      r.completionTimeSec,
      r.interactionCount,
      r.approvalCount,
      r.rejectionCount,
      r.planEditCount,
      r.interruptCount,
      r.midTaskChangeHandled,
      r.inputTokens,
      r.outputTokens,
      r.userEffortScore,
      r.humanControlScore,
      r.userTrustScore,
      r.decisionQualityScore,
      r.nasaTlxMentalDemand ?? "",
      r.nasaTlxFrustration ?? "",
      r.failureNotes ?? "",
      r.createdAt,
    ]
      .map(escapeCell)
      .join(",")
  );

  return [headers.join(","), ...rows].join("\n");
}

export function generateEvaluationMarkdownReport(
  runs: EvaluationRun[],
  includeSampleData: boolean
): string {
  const filtered = includeSampleData ? runs : runs.filter((r) => !r.isSampleData);
  const summary = computeComparisonSummary(filtered);
  const label = includeSampleData
    ? "INCLUDES ILLUSTRATIVE SAMPLE DATA (NOT FOR SCIENTIFIC CLAIMS)"
    : "MEASURED PARTICIPANT RUNS ONLY";

  return `# RELAY AI — Scientific Evaluation Report
**Generated:** ${new Date().toISOString()}  
**Dataset Scope:** ${label}  
**Baseline Runs (n):** ${summary.baseline.sampleSize} | **RELAY AI Runs (n):** ${summary.relayAi.sampleSize}

## Comparative Metrics Summary
| Metric | Baseline (Prompt-and-Wait) | RELAY AI (Collaborative) | Delta |
| :--- | :---: | :---: | :---: |
| Task Success Rate (%) | ${summary.baseline.taskSuccessRatePct}% | ${summary.relayAi.taskSuccessRatePct}% | ${summary.deltas.successRateDiffPct >= 0 ? "+" : ""}${summary.deltas.successRateDiffPct}% |
| Avg Completion Time (s) | ${summary.baseline.avgCompletionTimeSec}s | ${summary.relayAi.avgCompletionTimeSec}s | ${summary.deltas.timeDiffSec}s |
| Avg User Interactions | ${summary.baseline.avgInteractions} | ${summary.relayAi.avgInteractions} | ${round2(summary.relayAi.avgInteractions - summary.baseline.avgInteractions)} |
| User Effort (1–7, lower better) | ${summary.baseline.avgUserEffort} | ${summary.relayAi.avgUserEffort} | ${summary.deltas.effortDiff} |
| Human Control (1–7, higher better) | ${summary.baseline.avgHumanControl} | ${summary.relayAi.avgHumanControl} | ${summary.deltas.controlDiff >= 0 ? "+" : ""}${summary.deltas.controlDiff} |
| User Trust (1–7, higher better) | ${summary.baseline.avgUserTrust} | ${summary.relayAi.avgUserTrust} | ${summary.deltas.trustDiff >= 0 ? "+" : ""}${summary.deltas.trustDiff} |
| Decision Quality (1–7, higher better) | ${summary.baseline.avgDecisionQuality} | ${summary.relayAi.avgDecisionQuality} | ${summary.deltas.decisionQualityDiff >= 0 ? "+" : ""}${summary.deltas.decisionQualityDiff} |

## Recorded Failure Cases & Qualitative Notes
${
  filtered.filter((r) => r.failureNotes || !r.completedSuccessfully).length === 0
    ? "- No failure notes recorded in this subset yet."
    : filtered
        .filter((r) => r.failureNotes || !r.completedSuccessfully)
        .map(
          (r) =>
            `- **${r.participantCode} (${r.condition} / ${r.taskTitle}):** ${
              r.failureNotes || "Marked incomplete during trial."
            }`
        )
        .join("\n")
}
`;
}

export const METRIC_METHODOLOGY = [
  {
    metric: "Task Success Rate (%)",
    measures: "Percentage of trials satisfying all objective task success criteria including mid-task requirement shifts.",
    relevance: "Core measure of interaction effectiveness; prevents misleading speed wins that produce unusable outputs.",
    limitations: "Binary pass/fail hides partial quality gradations; requires a blind rubric scorer for high rigor.",
  },
  {
    metric: "Task Completion Time (sec)",
    measures: "Wall-clock duration from initial objective submission to human sign-off on the final deliverable.",
    relevance: "Quantifies whether upfront plan editing and approval checkpoints save rework time compared to repeated re-prompting.",
    limitations: "On trivial single-step queries, interactive planning adds overhead; advantage appears on multi-step/changing tasks.",
  },
  {
    metric: "Number of User Interactions",
    measures: "Count of explicit human actions (prompts, plan edits, locks, approvals, rejections, interrupts).",
    relevance: "Distinguishes constructive steering actions (plan edits) from wasteful full re-prompts in prompt-and-wait chat.",
    limitations: "Raw interaction count alone is ambiguous; must be interpreted alongside effort and rework rates.",
  },
  {
    metric: "User Effort (NASA-TLX & 1–7 Scale)",
    measures: "Perceived mental demand, frustration, and cognitive workload required to steer the agent.",
    relevance: "Directly validates whether visual plan trees and micro-actions lower cognitive strain versus crafting long corrective prompts.",
    limitations: "Self-reported scores are sensitive to novelty bias and participant prior familiarity with AI tools.",
  },
  {
    metric: "Human Control (1–7 Scale)",
    measures: "User's perceived agency to inspect, pause, edit, redirect, and veto agent actions mid-flight.",
    relevance: "Addresses the core HAI limitation of black-box prompt-and-wait generation where users feel passive.",
    limitations: "Excessive control gates can invert into micromanagement fatigue if autonomy thresholds are poorly calibrated.",
  },
  {
    metric: "User Trust (1–7 Scale)",
    measures: "Calibrated confidence that the agent behaves transparently, surfaces risks honestly, and respects boundaries.",
    relevance: "Appropriate trust (neither blind over-reliance nor constant distrust) is essential for real-world deployment.",
    limitations: "High trust without accuracy is dangerous (automation bias); must always be paired with Decision Quality.",
  },
  {
    metric: "Decision Quality (1–7 Scale)",
    measures: "Rubric-evaluated coherence, evidence grounding, risk awareness, and alignment with human priorities.",
    relevance: "Verifies that collaborative checkpoints materially improve the substance of final outputs.",
    limitations: "Subjective expert rating requires inter-rater reliability checks in larger studies (n ≥ 12).",
  },
];

export const KNOWN_FAILURE_CASES = [
  {
    id: "fc-1",
    title: "Approval Fatigue on Low-Stakes Tasks",
    severity: "Medium",
    description:
      "When users ask simple factual questions, pausing for plan approval adds 10–25 seconds of avoidable overhead compared to baseline prompt-and-wait.",
    mitigation:
      "Adaptive autonomy lowers gating frequency on low-risk tasks and exposes a single-click autonomy threshold slider in Settings.",
  },
  {
    id: "fc-2",
    title: "Automation Bias / Rubber-Stamping Approvals",
    severity: "High",
    description:
      "Participants under time pressure may click 'Approve' without reading potential risks or alternative actions.",
    mitigation:
      "Approval Center highlights potential risks prominently alongside selectable alternatives and tracks fast-approve times in telemetry.",
  },
  {
    id: "fc-3",
    title: "Mid-Flight Requirement Conflict with Locked Steps",
    severity: "Medium",
    description:
      "If a human locks an early step and later introduces a conflicting mid-task requirement, strict lock preservation can create stale upstream framing.",
    mitigation:
      "Orchestrator flags locked steps visibly during adaptation and supports one-click Checkpoint Rollback.",
  },
  {
    id: "fc-4",
    title: "External LLM Latency & JSON Parsing Failures",
    severity: "Low",
    description:
      "Live LLM API rate limits or malformed JSON responses can interrupt structured multi-agent step generation.",
    mitigation:
      "Server-side retry with exponential backoff, robust fenced-JSON extraction, and automatic clearly-labeled Demo Mode fallback.",
  },
];

/**
 * STRICTLY LABELED ILLUSTRATIVE SAMPLE DATASET FOR CHART PREVIEW ONLY.
 * Never merged into Measured Experiment Runs; clearly badged in UI & CSV exports.
 */
export const ILLUSTRATIVE_SAMPLE_RUNS: EvaluationRun[] = [
  {
    id: "sample_b1",
    participantCode: "DEMO-S01",
    taskTemplateId: "task_renewable_report",
    taskTitle: "Renewable Energy Investment & Policy Report",
    condition: "baseline",
    isSampleData: true,
    completedSuccessfully: true,
    completionTimeSec: 245,
    interactionCount: 6,
    approvalCount: 0,
    rejectionCount: 0,
    planEditCount: 0,
    interruptCount: 0,
    midTaskChangeHandled: false,
    inputTokens: 1120,
    outputTokens: 2850,
    userEffortScore: 5.4,
    humanControlScore: 2.8,
    userTrustScore: 3.6,
    decisionQualityScore: 4.1,
    nasaTlxMentalDemand: 74,
    nasaTlxFrustration: 68,
    failureNotes: "Sample preview: User had to re-prompt twice after mid-task change.",
    createdAt: "2026-11-26T10:15:00.000Z",
  },
  {
    id: "sample_r1",
    participantCode: "DEMO-S01",
    taskTemplateId: "task_renewable_report",
    taskTitle: "Renewable Energy Investment & Policy Report",
    condition: "relay_ai",
    isSampleData: true,
    completedSuccessfully: true,
    completionTimeSec: 178,
    interactionCount: 4,
    approvalCount: 2,
    rejectionCount: 0,
    planEditCount: 2,
    interruptCount: 0,
    midTaskChangeHandled: true,
    inputTokens: 980,
    outputTokens: 2410,
    userEffortScore: 2.9,
    humanControlScore: 6.2,
    userTrustScore: 5.9,
    decisionQualityScore: 6.1,
    nasaTlxMentalDemand: 38,
    nasaTlxFrustration: 24,
    createdAt: "2026-11-26T10:30:00.000Z",
  },
  {
    id: "sample_b2",
    participantCode: "DEMO-S02",
    taskTemplateId: "task_saas_launch",
    taskTitle: "B2B AI Product Launch & Compliance Plan",
    condition: "baseline",
    isSampleData: true,
    completedSuccessfully: false,
    completionTimeSec: 312,
    interactionCount: 8,
    approvalCount: 0,
    rejectionCount: 0,
    planEditCount: 0,
    interruptCount: 0,
    midTaskChangeHandled: false,
    inputTokens: 1450,
    outputTokens: 3420,
    userEffortScore: 6.0,
    humanControlScore: 2.4,
    userTrustScore: 3.1,
    decisionQualityScore: 3.5,
    nasaTlxMentalDemand: 82,
    nasaTlxFrustration: 79,
    failureNotes: "Sample preview: Baseline dropped HIPAA BAA constraint during full rewrite.",
    createdAt: "2026-11-26T11:05:00.000Z",
  },
  {
    id: "sample_r2",
    participantCode: "DEMO-S02",
    taskTemplateId: "task_saas_launch",
    taskTitle: "B2B AI Product Launch & Compliance Plan",
    condition: "relay_ai",
    isSampleData: true,
    completedSuccessfully: true,
    completionTimeSec: 204,
    interactionCount: 5,
    approvalCount: 2,
    rejectionCount: 1,
    planEditCount: 2,
    interruptCount: 1,
    midTaskChangeHandled: true,
    inputTokens: 1100,
    outputTokens: 2690,
    userEffortScore: 3.2,
    humanControlScore: 6.4,
    userTrustScore: 6.0,
    decisionQualityScore: 6.3,
    nasaTlxMentalDemand: 41,
    nasaTlxFrustration: 27,
    createdAt: "2026-11-26T11:25:00.000Z",
  },
];
