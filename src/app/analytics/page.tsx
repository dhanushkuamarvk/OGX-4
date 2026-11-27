"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from "recharts";
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Download,
  FileJson,
  FileSpreadsheet,
  Play,
  Send,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { useRelayStore } from "@/hooks/useRelayStore";
import {
  Badge,
  Button,
  Card,
  Input,
  Textarea,
} from "@/components/ui/primitives";
import {
  computeComparisonSummary,
  computeMeasuredOnlySummary,
  exportEvaluationRunsToCSV,
  generateEvaluationMarkdownReport,
  ILLUSTRATIVE_SAMPLE_RUNS,
  KNOWN_FAILURE_CASES,
  METRIC_METHODOLOGY,
  STANDARDIZED_TEST_TASKS,
} from "@/lib/evaluation/metrics";
import {
  cn,
  downloadTextFile,
  estimateTokens,
  formatDuration,
  generateId,
} from "@/lib/utils/cn";
import type { EvaluationRun } from "@/types/relay";

interface BaselineMsg {
  role: "user" | "assistant";
  content: string;
  latencyMs?: number;
}

export default function AnalyticsPage() {
  const router = useRouter();
  const {
    evaluationRuns,
    tasks,
    settings,
    isHydrated,
    startEvaluationRelayTrial,
    recordEvaluationRun,
    clearMeasuredEvaluations,
    pushToast,
  } = useRelayStore();

  const [dataView, setDataView] = useState<"measured" | "sample_preview">("measured");
  const [activeTab, setActiveTab] = useState<
    "overview" | "baseline_runner" | "relay_logger" | "methodology"
  >("overview");

  const [participantCode, setParticipantCode] = useState("P01");
  const [selectedTaskId, setSelectedTaskId] = useState(STANDARDIZED_TEST_TASKS[0].id);
  const selectedTemplate = useMemo(
    () =>
      STANDARDIZED_TEST_TASKS.find((t) => t.id === selectedTaskId) ??
      STANDARDIZED_TEST_TASKS[0],
    [selectedTaskId]
  );

  const [baselineRunning, setBaselineRunning] = useState(false);
  const [baselineStartMs, setBaselineStartMs] = useState<number | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [baselineMsgs, setBaselineMsgs] = useState<BaselineMsg[]>([]);
  const [baselineInput, setBaselineInput] = useState("");
  const [baselineLoading, setBaselineLoading] = useState(false);
  const [baselineTokensIn, setBaselineTokensIn] = useState(0);
  const [baselineTokensOut, setBaselineTokensOut] = useState(0);
  const [midTaskInjected, setMidTaskInjected] = useState(false);

  const [completedSuccess, setCompletedSuccess] = useState(true);
  const [midTaskHandled, setMidTaskHandled] = useState(true);
  const [effortScore, setEffortScore] = useState(4);
  const [controlScore, setControlScore] = useState(4);
  const [trustScore, setTrustScore] = useState(4);
  const [qualityScore, setQualityScore] = useState(4);
  const [nasaMental, setNasaMental] = useState(50);
  const [nasaFrustration, setNasaFrustration] = useState(40);
  const [failureNotes, setFailureNotes] = useState("");
  const [linkedWorkspaceTaskId, setLinkedWorkspaceTaskId] = useState<string>("");
  const [trialValidationError, setTrialValidationError] = useState<string | null>(null);
  const [savedToast, setSavedToast] = useState<string | null>(null);

  useEffect(() => {
    if (!baselineRunning || !baselineStartMs) {
      setElapsedSec(0);
      return;
    }
    const timer = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - baselineStartMs) / 1000));
    }, 500);
    return () => clearInterval(timer);
  }, [baselineRunning, baselineStartMs]);

  const displayedRuns = useMemo(() => {
    if (dataView === "sample_preview") return ILLUSTRATIVE_SAMPLE_RUNS;
    return evaluationRuns.filter((r) => !r.isSampleData);
  }, [dataView, evaluationRuns]);

  const summary = useMemo(
    () =>
      dataView === "measured"
        ? computeMeasuredOnlySummary(evaluationRuns)
        : computeComparisonSummary(displayedRuns),
    [dataView, evaluationRuns, displayedRuns]
  );

  const measuredCount = evaluationRuns.filter((r) => !r.isSampleData).length;

  const scaleChartData = [
    {
      metric: "Effort (lower better)",
      Baseline: summary.baseline.avgUserEffort,
      "RELAY AI": summary.relayAi.avgUserEffort,
    },
    {
      metric: "Control",
      Baseline: summary.baseline.avgHumanControl,
      "RELAY AI": summary.relayAi.avgHumanControl,
    },
    {
      metric: "Trust",
      Baseline: summary.baseline.avgUserTrust,
      "RELAY AI": summary.relayAi.avgUserTrust,
    },
    {
      metric: "Quality",
      Baseline: summary.baseline.avgDecisionQuality,
      "RELAY AI": summary.relayAi.avgDecisionQuality,
    },
  ];

  const efficiencyChartData = [
    {
      metric: "Duration (s)",
      Baseline: summary.baseline.avgCompletionTimeSec,
      "RELAY AI": summary.relayAi.avgCompletionTimeSec,
    },
    {
      metric: "Completion (%)",
      Baseline: summary.baseline.taskSuccessRatePct,
      "RELAY AI": summary.relayAi.taskSuccessRatePct,
    },
    {
      metric: "Interactions",
      Baseline: summary.baseline.avgInteractions,
      "RELAY AI": summary.relayAi.avgInteractions,
    },
  ];

  function startBaselineTrial() {
    setBaselineRunning(true);
    setBaselineStartMs(Date.now());
    setBaselineMsgs([]);
    setBaselineTokensIn(0);
    setBaselineTokensOut(0);
    setMidTaskInjected(false);
    setBaselineInput(selectedTemplate.initialPrompt);
  }

  async function sendBaselinePrompt(promptOverride?: string) {
    const prompt = (promptOverride ?? baselineInput).trim();
    if (!prompt || baselineLoading) return;
    if (!baselineStartMs) {
      setBaselineRunning(true);
      setBaselineStartMs(Date.now());
    }
    setBaselineInput("");
    setBaselineLoading(true);
    const updatedHistory: BaselineMsg[] = [...baselineMsgs, { role: "user", content: prompt }];
    setBaselineMsgs(updatedHistory);

    try {
      const res = await fetch("/api/baseline/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          history: baselineMsgs.map((m) => ({ role: m.role, content: m.content })),
          sessionId: `${participantCode}_${selectedTemplate.code}`,
          forceDemo: settings.forceDemoMode,
        }),
      });
      const data = await res.json();
      setBaselineMsgs([
        ...updatedHistory,
        {
          role: "assistant",
          content: data.response || data.error || "No response",
          latencyMs: data.latencyMs,
        },
      ]);
      setBaselineTokensIn((n) => n + (data.inputTokens ?? 0));
      setBaselineTokensOut((n) => n + (data.outputTokens ?? 0));
    } finally {
      setBaselineLoading(false);
    }
  }

  async function submitMeasuredTrial(condition: "baseline" | "relay_ai") {
    setTrialValidationError(null);
    if (
      condition === "baseline" &&
      baselineMsgs.filter((m) => m.role === "user").length === 0
    ) {
      setTrialValidationError(
        "Submit at least one prompt in the Baseline runner before saving a measured trial."
      );
      return;
    }

    const linkedTask = tasks.find((t) => t.id === linkedWorkspaceTaskId);
    if (condition === "relay_ai" && !linkedTask) {
      setTrialValidationError(
        "Select a completed RELAY AI Workspace task (or launch an equivalent task on the left) before saving."
      );
      return;
    }

    let durationSec = 30;
    let interactions = 1;
    let approvalsCount = 0;
    let rejectionsCount = 0;
    let planEdits = 0;
    let interrupts = 0;
    let inTok = baselineTokensIn;
    let outTok = baselineTokensOut;

    if (condition === "baseline") {
      durationSec = baselineStartMs
        ? Math.max(1, Number(((Date.now() - baselineStartMs) / 1000).toFixed(1)))
        : 30;
      interactions = Math.max(1, baselineMsgs.filter((m) => m.role === "user").length);
    } else if (linkedTask) {
      const endMs = linkedTask.completedAt
        ? new Date(linkedTask.completedAt).getTime()
        : Date.now();
      durationSec = Math.max(
        1,
        Number(((endMs - new Date(linkedTask.startedAt).getTime()) / 1000).toFixed(1))
      );
      interactions = Math.max(1, linkedTask.interactionCount);
      approvalsCount = linkedTask.approvalCount;
      rejectionsCount = linkedTask.rejectionCount;
      planEdits = linkedTask.planEditCount;
      interrupts = linkedTask.interruptCount;
      inTok = estimateTokens(
        [
          linkedTask.objective,
          ...linkedTask.steps.map((s) => `${s.title} ${s.description}`),
        ].join("\n")
      );
      outTok = estimateTokens(
        [...linkedTask.steps.map((s) => s.output ?? ""), linkedTask.finalOutput ?? ""].join(
          "\n"
        )
      );
    }

    const run: EvaluationRun = {
      id: generateId("eval"),
      participantCode: participantCode.trim() || "P01",
      taskTemplateId: selectedTemplate.id,
      taskTitle: linkedTask ? linkedTask.title : selectedTemplate.title,
      condition,
      isSampleData: false,
      completedSuccessfully: completedSuccess,
      completionTimeSec: durationSec,
      interactionCount: interactions,
      approvalCount: approvalsCount,
      rejectionCount: rejectionsCount,
      planEditCount: planEdits,
      interruptCount: interrupts,
      midTaskChangeHandled: midTaskHandled,
      inputTokens: inTok,
      outputTokens: outTok,
      userEffortScore: effortScore,
      humanControlScore: controlScore,
      userTrustScore: trustScore,
      decisionQualityScore: qualityScore,
      nasaTlxMentalDemand: nasaMental,
      nasaTlxFrustration: nasaFrustration,
      failureNotes: failureNotes.trim() || undefined,
      createdAt: new Date().toISOString(),
    };

    await recordEvaluationRun(run);
    setDataView("measured");
    setBaselineRunning(false);
    setBaselineStartMs(null);
    setFailureNotes("");
    const notice = `Saved measured ${condition === "relay_ai" ? "RELAY AI" : "Baseline"} trial (${run.participantCode}).`;
    setSavedToast(notice);
    pushToast({ tone: "success", title: "Trial recorded", description: notice });
    setTimeout(() => setSavedToast(null), 3500);
    setActiveTab("overview");
  }

  return (
    <AppShell
      title="Analytics"
      subtitle="Compare workflow completion, duration, plan edits, and human control against a standard chat baseline"
      actions={
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            size="xs"
            variant="secondary"
            onClick={() => {
              downloadTextFile(
                `relay-ai-evaluation-${dataView}.csv`,
                exportEvaluationRunsToCSV(displayedRuns),
                "text/csv;charset=utf-8"
              );
              pushToast({ tone: "success", title: "Exported evaluation data as CSV" });
            }}
          >
            <FileSpreadsheet className="h-3.5 w-3.5" /> CSV
          </Button>
          <Button
            size="xs"
            variant="secondary"
            onClick={() => {
              downloadTextFile(
                `relay-ai-evaluation-${dataView}.json`,
                JSON.stringify(
                  {
                    datasetOrigin:
                      dataView === "sample_preview"
                        ? "ILLUSTRATIVE_SAMPLE_PREVIEW_ONLY"
                        : "MEASURED_PARTICIPANT_TRIALS",
                    summary,
                    runs: displayedRuns,
                  },
                  null,
                  2
                ),
                "application/json"
              );
              pushToast({ tone: "success", title: "Exported evaluation data as JSON" });
            }}
          >
            <FileJson className="h-3.5 w-3.5" /> JSON
          </Button>
          <Button
            size="xs"
            variant="cyan"
            onClick={() => {
              downloadTextFile(
                `relay-ai-evaluation-report-${dataView}.md`,
                generateEvaluationMarkdownReport(
                  displayedRuns,
                  dataView === "sample_preview"
                ),
                "text/markdown;charset=utf-8"
              );
              pushToast({ tone: "success", title: "Downloaded Markdown summary report" });
            }}
          >
            <Download className="h-3.5 w-3.5" /> Report
          </Button>
        </div>
      }
    >
      <div className="space-y-6">
        {savedToast && (
          <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 px-4 py-3 text-xs text-emerald-200 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
            {savedToast}
          </div>
        )}

        {/* Clear Measured vs Sample Preview Toggle */}
        <Card className="p-4 flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold text-white">Evaluation Dataset</span>
              {dataView === "measured" ? (
                measuredCount === 0 ? (
                  <Badge tone="amber">Participant Evaluation: PENDING (0 trials)</Badge>
                ) : (
                  <Badge tone="emerald">Measured Results ({measuredCount} trials)</Badge>
                )
              ) : (
                <Badge tone="amber">Sample Preview Data (Not Measured Results)</Badge>
              )}
            </div>
            <p className="text-xs text-zinc-400">
              Measured participant trials are kept strictly separate from illustrative sample
              preview data so researchers and reviewers can audit real recorded evidence.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex gap-1 bg-background p-1 rounded-lg border border-white/[0.08]">
              <button
                type="button"
                onClick={() => setDataView("measured")}
                className={cn(
                  "px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                  dataView === "measured"
                    ? "bg-[#7c6ce8] text-white"
                    : "text-zinc-400 hover:text-white"
                )}
              >
                Measured ({measuredCount})
              </button>
              <button
                type="button"
                onClick={() => setDataView("sample_preview")}
                className={cn(
                  "px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                  dataView === "sample_preview"
                    ? "bg-amber-600/90 text-white"
                    : "text-zinc-400 hover:text-white"
                )}
              >
                Sample Preview ({ILLUSTRATIVE_SAMPLE_RUNS.length})
              </button>
            </div>
            {measuredCount > 0 && dataView === "measured" && (
              <Button
                size="xs"
                variant="danger"
                onClick={clearMeasuredEvaluations}
                title="Clear measured trials"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </Card>

        {/* Sub-navigation Tabs */}
        <div className="flex flex-wrap gap-1 bg-surface p-1 rounded-lg border border-white/[0.08] w-fit">
          {[
            { id: "overview" as const, label: "Overview" },
            { id: "baseline_runner" as const, label: "Baseline Runner" },
            { id: "relay_logger" as const, label: "Log RELAY AI Trial" },
            { id: "methodology" as const, label: "Methodology & Limits" },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "px-3.5 py-1.5 rounded-md text-xs font-medium transition-colors",
                activeTab === tab.id
                  ? "bg-[#7c6ce8] text-white"
                  : "text-zinc-400 hover:text-white"
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* ================= OVERVIEW TAB ================= */}
        {activeTab === "overview" && (
          <div className="space-y-6">
            {displayedRuns.length === 0 ? (
              <Card className="py-12 text-center space-y-4">
                <BarChart3 className="h-9 w-9 text-violet-400 mx-auto" />
                <div className="space-y-1.5 max-w-md mx-auto">
                  <Badge tone="amber">Participant Evaluation: PENDING</Badge>
                  <h2 className="text-base font-semibold text-white">
                    No Measured Trials Recorded Yet
                  </h2>
                  <p className="text-xs text-zinc-400 leading-relaxed">
                    Run a Baseline trial and an equivalent RELAY AI trial to populate real
                    metrics, or switch to Sample Preview to inspect the charts.
                  </p>
                </div>
                <div className="flex flex-wrap justify-center gap-2">
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => setActiveTab("baseline_runner")}
                  >
                    <Play className="h-3.5 w-3.5" /> Run Baseline Trial
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setDataView("sample_preview")}
                  >
                    View Sample Preview
                  </Button>
                </div>
              </Card>
            ) : (
              <>
                {dataView === "sample_preview" && (
                  <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 px-4 py-3 text-xs text-amber-200 flex items-center gap-2">
                    <ShieldAlert className="h-4 w-4 text-amber-400 shrink-0" />
                    <span>
                      <strong>Sample Preview:</strong> Showing illustrative demo data only.
                      Switch to Measured and run real trials for empirical results.
                    </span>
                  </div>
                )}

                {/* 5 Key Clean Metric Cards */}
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
                  {[
                    {
                      label: "Workflow Completion",
                      base: `${summary.baseline.taskSuccessRatePct}%`,
                      relay: `${summary.relayAi.taskSuccessRatePct}%`,
                    },
                    {
                      label: "Avg Task Duration",
                      base: formatDuration(summary.baseline.avgCompletionTimeSec),
                      relay: formatDuration(summary.relayAi.avgCompletionTimeSec),
                    },
                    {
                      label: "Human Interventions",
                      base: `${summary.baseline.avgInteractions}`,
                      relay: `${summary.relayAi.avgInteractions}`,
                    },
                    {
                      label: "Avg Plan Edits",
                      base: `${summary.baseline.avgPlanEdits}`,
                      relay: `${summary.relayAi.avgPlanEdits}`,
                    },
                    {
                      label: "Trust / Control (1–7)",
                      base: `${summary.baseline.avgUserTrust} / ${summary.baseline.avgHumanControl}`,
                      relay: `${summary.relayAi.avgUserTrust} / ${summary.relayAi.avgHumanControl}`,
                    },
                  ].map((item) => (
                    <Card key={item.label} className="p-4 space-y-2">
                      <p className="text-xs text-zinc-400">{item.label}</p>
                      <div className="flex justify-between text-xs">
                        <span className="text-zinc-500">Baseline</span>
                        <span className="font-mono text-zinc-300">{item.base}</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-violet-300">RELAY AI</span>
                        <span className="font-mono font-semibold text-cyan-300">
                          {item.relay}
                        </span>
                      </div>
                    </Card>
                  ))}
                </div>

                {/* 2 Clean Side-by-Side Comparison Charts */}
                <div className="grid lg:grid-cols-2 gap-5">
                  <Card className="space-y-3">
                    <h3 className="text-sm font-semibold text-white">
                      Trust, Control, Effort &amp; Quality (1–7 Scale)
                    </h3>
                    <div className="h-64 w-full">
                      {isHydrated && (
                        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                          <BarChart data={scaleChartData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                            <XAxis dataKey="metric" tick={{ fill: "#a1a1aa", fontSize: 11 }} />
                            <YAxis domain={[0, 7]} tick={{ fill: "#a1a1aa", fontSize: 11 }} />
                            <Tooltip
                              contentStyle={{
                                backgroundColor: "#131620",
                                border: "1px solid rgba(255,255,255,0.1)",
                                borderRadius: "10px",
                                fontSize: "12px",
                              }}
                            />
                            <Legend />
                            <Bar dataKey="Baseline" fill="#52525b" radius={[4, 4, 0, 0]} />
                            <Bar dataKey="RELAY AI" fill="#8b7cf6" radius={[4, 4, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      )}
                    </div>
                  </Card>

                  <Card className="space-y-3">
                    <h3 className="text-sm font-semibold text-white">
                      Completion, Duration &amp; Interactions
                    </h3>
                    <div className="h-64 w-full">
                      {isHydrated && (
                        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                          <BarChart data={efficiencyChartData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                            <XAxis dataKey="metric" tick={{ fill: "#a1a1aa", fontSize: 11 }} />
                            <YAxis tick={{ fill: "#a1a1aa", fontSize: 11 }} />
                            <Tooltip
                              contentStyle={{
                                backgroundColor: "#11141e",
                                border: "1px solid rgba(255,255,255,0.1)",
                                borderRadius: "8px",
                                fontSize: "12px",
                              }}
                            />
                            <Legend />
                            <Bar dataKey="Baseline" fill="#52525b" radius={[4, 4, 0, 0]} />
                            <Bar dataKey="RELAY AI" fill="#22d3ee" radius={[4, 4, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      )}
                    </div>
                  </Card>
                </div>

                {/* Clean Trial Table */}
                <Card className="space-y-3 overflow-x-auto">
                  <h3 className="text-sm font-semibold text-white">
                    Recorded Trials ({displayedRuns.length})
                  </h3>
                  <table className="w-full text-xs text-left border-collapse min-w-[700px]">
                    <thead>
                      <tr className="border-b border-white/10 text-zinc-400">
                        <th className="py-2 px-2">Participant</th>
                        <th className="py-2 px-2">Mode</th>
                        <th className="py-2 px-2">Task</th>
                        <th className="py-2 px-2">Result</th>
                        <th className="py-2 px-2">Duration</th>
                        <th className="py-2 px-2">Edits</th>
                        <th className="py-2 px-2">Trust / Control</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.06]">
                      {displayedRuns.map((r) => (
                        <tr key={r.id}>
                          <td className="py-2.5 px-2 font-mono text-zinc-200">
                            {r.participantCode}
                          </td>
                          <td className="py-2.5 px-2">
                            <Badge tone={r.condition === "relay_ai" ? "purple" : "neutral"}>
                              {r.condition === "relay_ai" ? "RELAY AI" : "Baseline"}
                            </Badge>
                          </td>
                          <td className="py-2.5 px-2 text-zinc-300 max-w-[200px] truncate">
                            {r.taskTitle}
                          </td>
                          <td className="py-2.5 px-2">
                            <Badge tone={r.completedSuccessfully ? "emerald" : "rose"}>
                              {r.completedSuccessfully ? "Completed" : "Incomplete"}
                            </Badge>
                          </td>
                          <td className="py-2.5 px-2 font-mono">
                            {formatDuration(r.completionTimeSec)}
                          </td>
                          <td className="py-2.5 px-2 font-mono">{r.planEditCount}</td>
                          <td className="py-2.5 px-2 font-mono text-cyan-300">
                            {r.userTrustScore} / {r.humanControlScore}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Card>
              </>
            )}
          </div>
        )}

        {/* ================= BASELINE RUNNER TAB ================= */}
        {activeTab === "baseline_runner" && (
          <div className="grid lg:grid-cols-12 gap-5">
            <Card className="lg:col-span-7 space-y-4">
              <div>
                <h2 className="text-sm font-semibold text-white">
                  Conventional Prompt-and-Wait Baseline
                </h2>
                <p className="text-xs text-zinc-400">
                  Run the equivalent task using a standard single-pass chat baseline.
                </p>
              </div>

              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-zinc-400 block mb-1">Participant ID</label>
                  <Input
                    value={participantCode}
                    onChange={(e) => setParticipantCode(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-xs text-zinc-400 block mb-1">Standardized Task</label>
                  <select
                    value={selectedTaskId}
                    onChange={(e) => setSelectedTaskId(e.target.value)}
                    className="w-full rounded-lg bg-[#0c0f17] border border-white/10 px-3 py-2 text-xs text-zinc-100"
                  >
                    {STANDARDIZED_TEST_TASKS.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.code}: {t.title}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="primary" onClick={startBaselineTrial}>
                  <Play className="h-3.5 w-3.5" /> Start Timed Trial
                </Button>
                <Button
                  size="sm"
                  variant="warning"
                  disabled={!baselineRunning || baselineLoading}
                  onClick={() => {
                    setMidTaskInjected(true);
                    sendBaselinePrompt(selectedTemplate.midTaskChangePrompt);
                  }}
                >
                  <AlertTriangle className="h-3.5 w-3.5" /> Inject Mid-Task Change
                </Button>
              </div>

              <div className="rounded-lg bg-[#0c0f17] border border-white/[0.08] h-72 overflow-y-auto p-3.5 space-y-3">
                {baselineMsgs.length === 0 ? (
                  <p className="text-xs text-zinc-500 text-center py-20">
                    Click Start Timed Trial and send the task prompt below.
                  </p>
                ) : (
                  baselineMsgs.map((m, idx) => (
                    <div
                      key={idx}
                      className={cn(
                        "rounded-lg p-3 text-xs whitespace-pre-wrap leading-relaxed",
                        m.role === "user"
                          ? "bg-violet-600/20 border border-violet-500/30 text-white ml-8"
                          : "bg-surface border border-white/[0.08] text-zinc-300 mr-8"
                      )}
                    >
                      <div className="text-[11px] text-zinc-500 mb-1 flex justify-between">
                        <span>{m.role === "user" ? "Participant" : "Baseline Chat"}</span>
                        {m.latencyMs ? <span>{m.latencyMs} ms</span> : null}
                      </div>
                      {m.content}
                    </div>
                  ))
                )}
                {baselineLoading && (
                  <p className="text-xs text-amber-300">Waiting for response...</p>
                )}
              </div>

              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  sendBaselinePrompt();
                }}
              >
                <Input
                  value={baselineInput}
                  onChange={(e) => setBaselineInput(e.target.value)}
                  placeholder="Enter prompt..."
                  disabled={baselineLoading}
                />
                <Button
                  type="submit"
                  variant="primary"
                  disabled={baselineLoading || !baselineInput.trim()}
                >
                  <Send className="h-4 w-4" />
                </Button>
              </form>

              <div className="text-xs text-zinc-400 flex flex-wrap gap-4">
                <span>
                  Time: <strong className="font-mono text-cyan-300">{formatDuration(elapsedSec)}</strong>
                </span>
                <span>Turns: {baselineMsgs.filter((m) => m.role === "user").length}</span>
                <span>Mid-task shift: {midTaskInjected ? "Yes" : "No"}</span>
              </div>
            </Card>

            <Card className="lg:col-span-5 space-y-4">
              <h3 className="text-sm font-semibold text-white">Post-Task Questionnaire</h3>
              <SurveyFields
                completedSuccess={completedSuccess}
                setCompletedSuccess={setCompletedSuccess}
                midTaskHandled={midTaskHandled}
                setMidTaskHandled={setMidTaskHandled}
                effortScore={effortScore}
                setEffortScore={setEffortScore}
                controlScore={controlScore}
                setControlScore={setControlScore}
                trustScore={trustScore}
                setTrustScore={setTrustScore}
                qualityScore={qualityScore}
                setQualityScore={setQualityScore}
                nasaMental={nasaMental}
                setNasaMental={setNasaMental}
                nasaFrustration={nasaFrustration}
                setNasaFrustration={setNasaFrustration}
                failureNotes={failureNotes}
                setFailureNotes={setFailureNotes}
              />
              {trialValidationError && (
                <p className="text-xs text-rose-300">{trialValidationError}</p>
              )}
              <Button
                variant="primary"
                className="w-full"
                onClick={() => submitMeasuredTrial("baseline")}
              >
                Save Baseline Trial
              </Button>
            </Card>
          </div>
        )}

        {/* ================= LOG RELAY AI TRIAL TAB ================= */}
        {activeTab === "relay_logger" && (
          <div className="grid lg:grid-cols-12 gap-5">
            <Card className="lg:col-span-6 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-white">
                  Launch or Link RELAY AI Trial
                </h2>
                <Link href="/workspace">
                  <Button size="xs" variant="secondary">
                    Workspace
                  </Button>
                </Link>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="text-xs text-zinc-400 block mb-1">Participant ID</label>
                  <Input
                    value={participantCode}
                    onChange={(e) => setParticipantCode(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-xs text-zinc-400 block mb-1">
                    Select Completed Workspace Task
                  </label>
                  <select
                    value={linkedWorkspaceTaskId}
                    onChange={(e) => setLinkedWorkspaceTaskId(e.target.value)}
                    className="w-full rounded-lg bg-[#0c0f17] border border-white/10 px-3 py-2 text-xs text-zinc-100"
                  >
                    <option value="">-- Choose a workspace task --</option>
                    {tasks.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.title} ({t.status} • {t.planEditCount} edits, {t.approvalCount} approvals)
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-2 pt-2 border-t border-white/[0.07]">
                <p className="text-xs font-medium text-zinc-300">
                  Equivalent Standardized Tasks
                </p>
                {STANDARDIZED_TEST_TASKS.map((t) => (
                  <div
                    key={t.id}
                    className="rounded-lg bg-[#0c0f17] border border-white/[0.06] p-3 space-y-1.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-white">
                        {t.code}: {t.title}
                      </span>
                      <Button
                        size="xs"
                        variant="cyan"
                        onClick={async () => {
                          setSelectedTaskId(t.id);
                          await startEvaluationRelayTrial(participantCode, t);
                          router.push("/workspace");
                        }}
                      >
                        <Play className="h-3 w-3" /> Launch
                      </Button>
                    </div>
                    <p className="text-[11px] text-zinc-400">{t.initialPrompt}</p>
                  </div>
                ))}
              </div>
            </Card>

            <Card className="lg:col-span-6 space-y-4">
              <h3 className="text-sm font-semibold text-white">Post-Task Questionnaire</h3>
              <SurveyFields
                completedSuccess={completedSuccess}
                setCompletedSuccess={setCompletedSuccess}
                midTaskHandled={midTaskHandled}
                setMidTaskHandled={setMidTaskHandled}
                effortScore={effortScore}
                setEffortScore={setEffortScore}
                controlScore={controlScore}
                setControlScore={setControlScore}
                trustScore={trustScore}
                setTrustScore={setTrustScore}
                qualityScore={qualityScore}
                setQualityScore={setQualityScore}
                nasaMental={nasaMental}
                setNasaMental={setNasaMental}
                nasaFrustration={nasaFrustration}
                setNasaFrustration={setNasaFrustration}
                failureNotes={failureNotes}
                setFailureNotes={setFailureNotes}
              />
              {trialValidationError && (
                <p className="text-xs text-rose-300">{trialValidationError}</p>
              )}
              <Button
                variant="primary"
                className="w-full"
                onClick={() => submitMeasuredTrial("relay_ai")}
              >
                Save RELAY AI Trial
              </Button>
            </Card>
          </div>
        )}

        {/* ================= METHODOLOGY TAB ================= */}
        {activeTab === "methodology" && (
          <div className="space-y-5">
            <Card className="space-y-4">
              <h2 className="text-sm font-semibold text-white">
                Metric Definitions &amp; Limitations
              </h2>
              <div className="grid md:grid-cols-2 gap-4">
                {METRIC_METHODOLOGY.map((m) => (
                  <div
                    key={m.metric}
                    className="rounded-lg bg-[#0c0f17] border border-white/[0.06] p-4 space-y-1.5 text-xs"
                  >
                    <h3 className="font-semibold text-white">{m.metric}</h3>
                    <p className="text-zinc-300">{m.measures}</p>
                    <p className="text-zinc-400">
                      <strong className="text-zinc-200">Limit:</strong> {m.limitations}
                    </p>
                  </div>
                ))}
              </div>
            </Card>

            <Card className="space-y-4">
              <h2 className="text-sm font-semibold text-white">Known Failure Cases</h2>
              <div className="grid md:grid-cols-2 gap-4">
                {KNOWN_FAILURE_CASES.map((fc) => (
                  <div
                    key={fc.id}
                    className="rounded-lg bg-[#0c0f17] border border-white/[0.06] p-4 space-y-1.5 text-xs"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="font-semibold text-white">{fc.title}</h3>
                      <Badge tone={fc.severity === "High" ? "rose" : "amber"}>
                        {fc.severity}
                      </Badge>
                    </div>
                    <p className="text-zinc-400">{fc.description}</p>
                    <p className="text-emerald-300/90">Mitigation: {fc.mitigation}</p>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        )}
      </div>
    </AppShell>
  );
}

function SurveyFields(props: {
  completedSuccess: boolean;
  setCompletedSuccess: (v: boolean) => void;
  midTaskHandled: boolean;
  setMidTaskHandled: (v: boolean) => void;
  effortScore: number;
  setEffortScore: (v: number) => void;
  controlScore: number;
  setControlScore: (v: number) => void;
  trustScore: number;
  setTrustScore: (v: number) => void;
  qualityScore: number;
  setQualityScore: (v: number) => void;
  nasaMental: number;
  setNasaMental: (v: number) => void;
  nasaFrustration: number;
  setNasaFrustration: (v: number) => void;
  failureNotes: string;
  setFailureNotes: (v: string) => void;
}) {
  return (
    <div className="space-y-3 text-xs">
      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-zinc-200 cursor-pointer">
          <input
            type="checkbox"
            checked={props.completedSuccess}
            onChange={(e) => props.setCompletedSuccess(e.target.checked)}
          />
          Workflow completed
        </label>
        <label className="flex items-center gap-2 text-zinc-200 cursor-pointer">
          <input
            type="checkbox"
            checked={props.midTaskHandled}
            onChange={(e) => props.setMidTaskHandled(e.target.checked)}
          />
          Mid-task change handled
        </label>
      </div>

      {[
        { label: "User Effort (1 = easy, 7 = hard)", val: props.effortScore, set: props.setEffortScore, min: 1, max: 7 },
        { label: "Human Control (1–7)", val: props.controlScore, set: props.setControlScore, min: 1, max: 7 },
        { label: "User Trust (1–7)", val: props.trustScore, set: props.setTrustScore, min: 1, max: 7 },
        { label: "Decision Quality (1–7)", val: props.qualityScore, set: props.setQualityScore, min: 1, max: 7 },
        { label: "Mental Demand (NASA-TLX 0–100)", val: props.nasaMental, set: props.setNasaMental, min: 0, max: 100 },
        { label: "Frustration (NASA-TLX 0–100)", val: props.nasaFrustration, set: props.setNasaFrustration, min: 0, max: 100 },
      ].map((s) => (
        <div key={s.label} className="space-y-1">
          <div className="flex justify-between text-zinc-300">
            <span>{s.label}</span>
            <span className="font-mono text-cyan-300">{s.val}</span>
          </div>
          <input
            type="range"
            min={s.min}
            max={s.max}
            value={s.val}
            onChange={(e) => s.set(Number(e.target.value))}
            className="w-full accent-violet-500"
          />
        </div>
      ))}

      <div>
        <label className="text-zinc-400 block mb-1">Notes or issues observed</label>
        <Textarea
          rows={2}
          value={props.failureNotes}
          onChange={(e) => props.setFailureNotes(e.target.value)}
          placeholder="Optional observations..."
        />
      </div>
    </div>
  );
}
