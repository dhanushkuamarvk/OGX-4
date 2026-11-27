import React, { useEffect, useState } from "react";
import {
  ArrowRight,
  ExternalLink,
  Gauge,
  Layers,
  Lock,
  MessageSquare,
  RotateCcw,
  UserCheck,
} from "lucide-react";
import { useCoPlanStore } from "../store/useCoPlanStore";
import type { AutonomyLevel } from "../types/contract";

interface SessionLauncherProps {
  onSwitchToBaseline?: () => void;
}

export const SessionLauncher: React.FC<SessionLauncherProps> = ({
  onSwitchToBaseline,
}) => {
  const tasks = useCoPlanStore((s) => s.tasks);
  const assignment = useCoPlanStore((s) => s.assignment);
  const loadTasks = useCoPlanStore((s) => s.loadTasks);
  const lookupAssignment = useCoPlanStore((s) => s.lookupAssignment);
  const startSession = useCoPlanStore((s) => s.startSession);
  const busyAction = useCoPlanStore((s) => s.busyAction);
  const error = useCoPlanStore((s) => s.error);

  const [participantId, setParticipantId] = useState("P01");
  const [selectedTaskId, setSelectedTaskId] = useState("task_research_brief");
  const [customPrompt, setCustomPrompt] = useState("");
  const [autonomy, setAutonomy] = useState<AutonomyLevel>("L2");

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void lookupAssignment(participantId).then((res) => {
        if (res?.next_task_id) {
          setSelectedTaskId(res.next_task_id);
        }
      });
    }, 200);
    return () => window.clearTimeout(timer);
  }, [participantId, lookupAssignment]);

  useEffect(() => {
    if (tasks.length > 0 && !tasks.some((t) => t.task_id === selectedTaskId)) {
      setSelectedTaskId(tasks[0].task_id);
    }
  }, [tasks, selectedTaskId]);

  const selectedTask = tasks.find((t) => t.task_id === selectedTaskId);

  const handleLaunch = async (e: React.FormEvent) => {
    e.preventDefault();
    await startSession({
      task_id: selectedTaskId,
      participant_id: participantId.trim() || "P01",
      initial_prompt: customPrompt.trim() || undefined,
      autonomy_level: autonomy,
    });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 via-white to-indigo-50/40 p-6">
      <div className="w-full max-w-3xl rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-600 text-base font-bold text-white shadow-sm">
              CP
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-slate-900">
                Co-Plan Shared HAI Workspace
              </h1>
              <p className="text-xs text-slate-500">
                Resurrect 2026 · Problem 3 · Treatment Condition
              </p>
            </div>
          </div>
          <span className="rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700">
            Interactive Steering + Rollback
          </span>
        </div>

        {onSwitchToBaseline && (
          <div
            role="tablist"
            aria-label="Interface Mode"
            className="mt-5 grid grid-cols-2 gap-1.5 rounded-xl border border-slate-200 bg-slate-100 p-1"
          >
            <button
              type="button"
              role="tab"
              aria-selected={true}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-white px-3 py-2 text-xs font-semibold text-indigo-700 shadow-xs"
            >
              <Layers className="h-3.5 w-3.5" />
              Shared Workspace (Treatment)
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={false}
              onClick={onSwitchToBaseline}
              className="inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-slate-600 transition hover:bg-white/60 hover:text-slate-900"
            >
              <MessageSquare className="h-3.5 w-3.5" />
              Baseline Chat (Control)
            </button>
          </div>
        )}

        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[
            {
              icon: <Layers className="h-4 w-4 text-indigo-600" />,
              title: "Watch & Steer Live",
              desc: "Inspect the plan tree and interrupt mid-flight.",
            },
            {
              icon: <Lock className="h-4 w-4 text-emerald-600" />,
              title: "Lock & Co-Edit",
              desc: "Freeze approved steps and co-author Markdown directly.",
            },
            {
              icon: <RotateCcw className="h-4 w-4 text-amber-600" />,
              title: "Checkpoint & Adapt",
              desc: "Roll back any step with adaptive autonomy gating.",
            },
          ].map((item) => (
            <div
              key={item.title}
              className="rounded-xl border border-slate-100 bg-slate-50/80 p-3.5"
            >
              <div className="mb-1.5">{item.icon}</div>
              <div className="text-xs font-semibold text-slate-900">{item.title}</div>
              <p className="mt-0.5 text-[11px] text-slate-600">{item.desc}</p>
            </div>
          ))}
        </div>

        {error && (
          <div
            role="alert"
            className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-xs text-rose-800"
          >
            {error}
          </div>
        )}

        <form onSubmit={(e) => void handleLaunch(e)} className="mt-6 space-y-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="participant-id-input"
                className="block text-xs font-semibold text-slate-700"
              >
                Participant ID
              </label>
              <input
                id="participant-id-input"
                value={participantId}
                onChange={(e) => setParticipantId(e.target.value)}
                required
                className="mt-1 w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none"
                placeholder="e.g. P01"
              />
            </div>

            <div>
              <label
                htmlFor="autonomy-select"
                className="flex items-center gap-1.5 text-xs font-semibold text-slate-700"
              >
                <Gauge className="h-3.5 w-3.5 text-indigo-600" />
                Initial Autonomy Level
              </label>
              <select
                id="autonomy-select"
                value={autonomy}
                onChange={(e) => setAutonomy(e.target.value as AutonomyLevel)}
                className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none"
              >
                <option value="L1">L1 — Ask before every step</option>
                <option value="L2">L2 — Ask before low-confidence steps</option>
                <option value="L3">L3 — Run freely &amp; show summary</option>
              </select>
            </div>
          </div>

          {/* Counterbalanced study assignment card */}
          {assignment && (
            <div className="rounded-xl border border-indigo-200 bg-indigo-50/60 p-3.5 text-xs text-indigo-950">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 font-semibold">
                  <UserCheck className="h-4 w-4 text-indigo-600" />
                  <span>
                    Study Assignment for {assignment.participant_id} (Round{" "}
                    {assignment.next_round_index !== null
                      ? assignment.next_round_index + 1
                      : assignment.completed_rounds}
                    /{assignment.condition_order.length})
                  </span>
                </div>
                {assignment.next_condition && (
                  <span className="rounded-full bg-white px-2.5 py-0.5 font-mono text-[11px] font-semibold text-indigo-700 shadow-xs">
                    Assigned: {assignment.next_condition.toUpperCase()} ·{" "}
                    {assignment.next_task_id}
                  </span>
                )}
              </div>
              {assignment.next_condition === "baseline" &&
                (onSwitchToBaseline || assignment.next_app_url) && (
                  <div className="mt-2 flex items-center justify-between rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900">
                    <span>
                      This participant&apos;s next counterbalanced round is{" "}
                      <strong>Baseline Chat</strong>.
                    </span>
                    {onSwitchToBaseline ? (
                      <button
                        type="button"
                        onClick={onSwitchToBaseline}
                        className="inline-flex items-center gap-1 font-semibold underline"
                      >
                        Switch to Baseline Chat <ArrowRight className="h-3 w-3" />
                      </button>
                    ) : (
                      <a
                        href={assignment.next_app_url || "#"}
                        className="inline-flex items-center gap-1 font-semibold underline"
                      >
                        Open Baseline App <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                )}
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700">
              Evaluation Task
            </label>
            <div className="mt-2 grid grid-cols-1 gap-2.5">
              {tasks.map((task) => (
                <button
                  key={task.task_id}
                  type="button"
                  onClick={() => setSelectedTaskId(task.task_id)}
                  className={[
                    "rounded-xl border p-3.5 text-left transition",
                    selectedTaskId === task.task_id
                      ? "border-indigo-500 bg-indigo-50/50 ring-2 ring-indigo-100"
                      : "border-slate-200 bg-white hover:border-slate-300",
                  ].join(" ")}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-slate-900">
                      {task.title}
                    </span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                      {task.domain} · ~{task.estimated_minutes}m
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-slate-600">
                    {task.prompt}
                  </p>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label
              htmlFor="custom-prompt-input"
              className="block text-xs font-semibold text-slate-700"
            >
              Custom Prompt Override (optional)
            </label>
            <textarea
              id="custom-prompt-input"
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              rows={2}
              placeholder={
                selectedTask
                  ? "Leave blank to use the selected evaluation task prompt..."
                  : "Enter your task prompt..."
              }
              className="mt-1 w-full rounded-xl border border-slate-300 px-3.5 py-2 text-xs text-slate-800 focus:border-indigo-500 focus:outline-none"
            />
          </div>

          <button
            type="submit"
            disabled={busyAction === "creating_session"}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
          >
            {busyAction === "creating_session"
              ? "Launching Co-Plan Session..."
              : "Start Co-Plan Session"}
            <ArrowRight className="h-4 w-4" />
          </button>
        </form>
      </div>
    </div>
  );
};
