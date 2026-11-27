import React, { useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Clock,
  GitBranch,
  Loader2,
  Lock,
  Pencil,
  ShieldAlert,
  ShieldCheck,
  Unlock,
  X,
} from "lucide-react";
import { useCoPlanStore } from "../store/useCoPlanStore";
import type { Step, StepStatus } from "../types/contract";

const STATUS_META: Record<
  StepStatus,
  { label: string; badge: string; icon: React.ReactNode }
> = {
  pending: {
    label: "Pending",
    badge: "bg-slate-100 text-slate-600 border-slate-200",
    icon: <Clock className="h-3.5 w-3.5 text-slate-400" />,
  },
  running: {
    label: "Running",
    badge: "bg-indigo-50 text-indigo-700 border-indigo-200",
    icon: <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-600" />,
  },
  done: {
    label: "Done",
    badge: "bg-emerald-50 text-emerald-700 border-emerald-200",
    icon: <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />,
  },
  failed: {
    label: "Failed",
    badge: "bg-rose-50 text-rose-700 border-rose-200",
    icon: <ShieldAlert className="h-3.5 w-3.5 text-rose-600" />,
  },
  skipped: {
    label: "Skipped",
    badge: "bg-slate-100 text-slate-500 border-slate-200",
    icon: <ChevronRight className="h-3.5 w-3.5 text-slate-400" />,
  },
  invalidated: {
    label: "Invalidated",
    badge: "bg-amber-50 text-amber-800 border-amber-300",
    icon: <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />,
  },
};

function confidenceMeta(c: number): {
  bar: string;
  badge: string;
  label: "High" | "Medium" | "Low";
  icon: React.ReactNode;
} {
  if (c >= 0.78) {
    return {
      bar: "bg-emerald-500",
      badge: "text-emerald-700 bg-emerald-50 border-emerald-200",
      label: "High",
      icon: <ShieldCheck className="h-3 w-3 text-emerald-600" aria-hidden="true" />,
    };
  }
  if (c >= 0.6) {
    return {
      bar: "bg-amber-500",
      badge: "text-amber-800 bg-amber-50 border-amber-200",
      label: "Medium",
      icon: <AlertCircle className="h-3 w-3 text-amber-600" aria-hidden="true" />,
    };
  }
  return {
    bar: "bg-rose-500",
    badge: "text-rose-700 bg-rose-50 border-rose-200",
    label: "Low",
    icon: <ShieldAlert className="h-3 w-3 text-rose-600" aria-hidden="true" />,
  };
}

export const PlanTree: React.FC = () => {
  const session = useCoPlanStore((s) => s.session);
  const streamingStepId = useCoPlanStore((s) => s.streamingStepId);
  const streamingText = useCoPlanStore((s) => s.streamingText);
  const streamingPct = useCoPlanStore((s) => s.streamingPct);
  const approvalPrompt = useCoPlanStore((s) => s.approvalPrompt);
  const busyAction = useCoPlanStore((s) => s.busyAction);
  const toggleLock = useCoPlanStore((s) => s.toggleLock);
  const expandStep = useCoPlanStore((s) => s.expandStep);
  const editStep = useCoPlanStore((s) => s.editStep);
  const resume = useCoPlanStore((s) => s.resume);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDesc, setEditDesc] = useState("");

  if (!session) return null;

  const { plan } = session;

  const openEdit = (step: Step) => {
    setEditingId(step.id);
    setEditTitle(step.title);
    setEditDesc(step.description);
  };

  const submitEdit = async (stepId: string) => {
    await editStep(stepId, editTitle, editDesc);
    setEditingId(null);
  };

  return (
    <aside className="flex h-full flex-col border-r border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Shared Plan Tree</h2>
          <p className="text-xs text-slate-500">
            Plan v{plan.version} · {plan.steps.length} steps
          </p>
        </div>
        <span className="rounded-full bg-slate-100 px-2.5 py-0.5 font-mono text-[11px] text-slate-600">
          {plan.steps.filter((s) => s.status === "done").length}/{plan.steps.length} done
        </span>
      </div>

      {approvalPrompt && (
        <div className="mx-3 mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <div className="flex-1">
              <div className="font-semibold">Human Review Gate</div>
              <p className="mt-0.5 text-amber-800">{approvalPrompt.reason}</p>
              <button
                onClick={() => void resume()}
                className="mt-2 inline-flex items-center rounded-md bg-amber-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-amber-700"
              >
                Approve & Continue
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 space-y-2.5 overflow-y-auto p-3">
        {plan.steps.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 p-8 text-center">
            <Loader2 className="h-5 w-5 animate-spin text-indigo-500" />
            <p className="mt-2 text-xs font-medium text-slate-600">
              Generating structured execution plan...
            </p>
          </div>
        ) : (
          plan.steps.map((step) => {
            const meta = STATUS_META[step.status];
            const isSubstep = step.parent_id !== null;
            const isStreaming = streamingStepId === step.id;
            const isEditing = editingId === step.id;
            const confPct = Math.round(step.confidence * 100);

            return (
              <div
                key={step.id}
                className={[
                  "rounded-xl border p-3 transition-all",
                  isSubstep ? "ml-5 border-l-2 border-l-indigo-300 bg-slate-50/70" : "bg-white",
                  step.status === "running"
                    ? "border-indigo-300 ring-2 ring-indigo-100"
                    : step.locked
                      ? "border-emerald-300 bg-emerald-50/20"
                      : step.status === "invalidated"
                        ? "border-amber-300 bg-amber-50/30"
                        : "border-slate-200 hover:border-slate-300",
                ].join(" ")}
              >
                {isEditing ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-indigo-600">
                        Edit Step ({step.id})
                      </span>
                      <button
                        onClick={() => setEditingId(null)}
                        className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <input
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-900 focus:border-indigo-500 focus:outline-none"
                      placeholder="Step title"
                    />
                    <textarea
                      value={editDesc}
                      onChange={(e) => setEditDesc(e.target.value)}
                      rows={3}
                      className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-xs text-slate-700 focus:border-indigo-500 focus:outline-none"
                      placeholder="Step instructions"
                    />
                    <div className="flex justify-end gap-1.5">
                      <button
                        onClick={() => setEditingId(null)}
                        className="rounded-md border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => void submitEdit(step.id)}
                        className="rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-700"
                      >
                        Save Edit
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2">
                        <div className="mt-0.5 shrink-0">{meta.icon}</div>
                        <div>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-xs font-semibold text-slate-900">
                              {step.title}
                            </span>
                            {step.locked && (
                              <span className="inline-flex items-center gap-0.5 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800">
                                <Lock className="h-2.5 w-2.5" />
                                Locked
                              </span>
                            )}
                            {step.user_edited && (
                              <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700">
                                Edited
                              </span>
                            )}
                          </div>
                          <p className="mt-1 text-xs leading-relaxed text-slate-600">
                            {step.description}
                          </p>
                        </div>
                      </div>
                      <span
                        className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${meta.badge}`}
                      >
                        {meta.label}
                      </span>
                    </div>

                    {/* Accessible Confidence indicator: icon + High/Medium/Low label + bar + numeric tooltip */}
                    {(() => {
                      const cMeta = confidenceMeta(step.confidence);
                      return (
                        <div
                          className="mt-2.5 flex items-center gap-2"
                          title={`Calibrated confidence: ${confPct}% (${step.confidence.toFixed(2)})`}
                          aria-label={`Confidence ${cMeta.label}, ${confPct} percent`}
                        >
                          <span
                            className={`inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold ${cMeta.badge}`}
                          >
                            {cMeta.icon}
                            {cMeta.label}
                          </span>
                          <div
                            className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100"
                            role="progressbar"
                            aria-valuenow={confPct}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-label={`${step.title} confidence`}
                          >
                            <div
                              className={`h-full rounded-full transition-all duration-300 ${cMeta.bar}`}
                              style={{ width: `${confPct}%` }}
                            />
                          </div>
                          <span className="w-8 text-right font-mono text-[10px] text-slate-600">
                            {confPct}%
                          </span>
                        </div>
                      );
                    })()}

                    {/* Live streaming preview for active step */}
                    {isStreaming && (
                      <div className="mt-2.5 rounded-lg border border-indigo-200 bg-indigo-50/50 p-2">
                        <div className="mb-1 flex items-center justify-between text-[10px] font-medium text-indigo-700">
                          <span>Streaming draft...</span>
                          <span>{Math.round(streamingPct)}%</span>
                        </div>
                        <p className="max-h-20 overflow-y-auto whitespace-pre-wrap font-mono text-[11px] leading-snug text-slate-700">
                          {streamingText || "Thinking..."}
                        </p>
                      </div>
                    )}

                    {/* Action buttons */}
                    <div className="mt-2.5 flex items-center justify-between border-t border-slate-100 pt-2">
                      <span className="font-mono text-[10px] text-slate-400">
                        {step.id}
                      </span>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => void toggleLock(step.id, step.locked)}
                          disabled={busyAction === `lock:${step.id}`}
                          title={
                            step.locked
                              ? "Unlock step"
                              : "Lock step to protect it from agent replanning"
                          }
                          className={[
                            "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition",
                            step.locked
                              ? "border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
                              : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
                          ].join(" ")}
                        >
                          {step.locked ? (
                            <>
                              <Unlock className="h-3 w-3" /> Unlock
                            </>
                          ) : (
                            <>
                              <Lock className="h-3 w-3" /> Lock
                            </>
                          )}
                        </button>

                        <button
                          onClick={() => openEdit(step)}
                          disabled={step.locked}
                          title={
                            step.locked
                              ? "Unlock step before editing"
                              : "Edit step title or instructions"
                          }
                          className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <Pencil className="h-3 w-3" /> Edit
                        </button>

                        {!isSubstep && (
                          <button
                            onClick={() => void expandStep(step.id)}
                            disabled={busyAction === `expand:${step.id}`}
                            title="Decompose this step into finer substeps"
                            className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                          >
                            <GitBranch className="h-3 w-3" /> Expand
                          </button>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
};
