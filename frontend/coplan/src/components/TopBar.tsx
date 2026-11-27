import React, { useState } from "react";
import {
  Download,
  Gauge,
  LogOut,
  Pause,
  Play,
  Sparkles,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import { api } from "../lib/api";
import { useCoPlanStore } from "../store/useCoPlanStore";
import type { AutonomyLevel } from "../types/contract";

export const TopBar: React.FC = () => {
  const session = useCoPlanStore((s) => s.session);
  const tasks = useCoPlanStore((s) => s.tasks);
  const connected = useCoPlanStore((s) => s.connected);
  const busyAction = useCoPlanStore((s) => s.busyAction);
  const interrupt = useCoPlanStore((s) => s.interrupt);
  const resume = useCoPlanStore((s) => s.resume);
  const injectRequirement = useCoPlanStore((s) => s.injectRequirement);
  const setAutonomy = useCoPlanStore((s) => s.setAutonomy);
  const reconnectStream = useCoPlanStore((s) => s.reconnectStream);
  const resetWorkspace = useCoPlanStore((s) => s.resetWorkspace);

  const [steerText, setSteerText] = useState("");
  const [reqOpen, setReqOpen] = useState(false);
  const [reqText, setReqText] = useState("");

  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && reqOpen) {
        setReqOpen(false);
        return;
      }
      if (e.altKey && e.key.toLowerCase() === "p" && session) {
        e.preventDefault();
        if (session.status === "running" || session.status === "planning") {
          void interrupt(steerText);
        } else if (session.status !== "done") {
          void resume(steerText);
        }
      }
      if (e.altKey && e.key.toLowerCase() === "r" && session) {
        e.preventDefault();
        setReqOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [reqOpen, session, steerText, interrupt, resume]);

  if (!session) return null;

  const task = tasks.find((t) => t.task_id === session.task_id);
  const isRunning = session.status === "running" || session.status === "planning";

  const handleInterrupt = async () => {
    await interrupt(steerText);
    setSteerText("");
  };

  const handleResume = async () => {
    await resume(steerText);
    setSteerText("");
  };

  const handleInjectRequirement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reqText.trim()) return;
    await injectRequirement(reqText.trim());
    setReqText("");
    setReqOpen(false);
  };

  return (
    <>
      <header className="border-b border-slate-200 bg-white px-4 py-2.5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Brand + Session badge */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-xs font-bold text-white">
                CP
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold tracking-tight text-slate-900">
                    Co-Plan Workspace
                  </span>
                  <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-indigo-700">
                    Treatment
                  </span>
                </div>
                <div className="flex items-center gap-2 text-[11px] text-slate-500">
                  <span className="font-medium text-slate-700">
                    {task?.title || session.task_id}
                  </span>
                  <span>·</span>
                  <span className="font-mono">{session.participant_id}</span>
                  <span
                    role="status"
                    aria-live="polite"
                    className={[
                      "rounded px-1.5 py-0.5 text-[10px] font-semibold",
                      session.status === "paused"
                        ? "bg-amber-100 text-amber-900"
                        : session.status === "rolled_back"
                          ? "bg-purple-100 text-purple-800"
                          : session.status === "done"
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-indigo-100 text-indigo-800",
                    ].join(" ")}
                  >
                    {session.status === "paused"
                      ? "Paused — state kept"
                      : session.status === "rolled_back"
                        ? "Rolled back"
                        : session.status}
                  </span>
                  <button
                    type="button"
                    onClick={reconnectStream}
                    aria-label="Reconnect SSE event stream"
                    title="Click to reconnect SSE stream with Last-Event-ID replay"
                    className={`inline-flex items-center gap-1 ${
                      connected ? "text-emerald-600" : "text-rose-500 underline"
                    }`}
                  >
                    {connected ? (
                      <Wifi className="h-3 w-3" />
                    ) : (
                      <WifiOff className="h-3 w-3" />
                    )}
                    {connected ? "SSE Live" : "Reconnect SSE"}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Mid-flight Steering + Interrupt/Resume */}
          <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
            <input
              value={steerText}
              onChange={(e) => setSteerText(e.target.value)}
              placeholder="Optional steering note for interrupt / resume..."
              className="w-56 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-800 focus:border-indigo-500 focus:bg-white focus:outline-none lg:w-72"
            />

            {isRunning ? (
              <button
                onClick={() => void handleInterrupt()}
                disabled={busyAction === "interrupt"}
                aria-label="Interrupt agent mid-flight (Alt+P)"
                title="Pause agent and keep current state (Alt+P)"
                className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-rose-700 disabled:opacity-50"
              >
                <Pause className="h-3.5 w-3.5" />
                Interrupt
                <kbd className="hidden rounded bg-rose-700 px-1 font-mono text-[10px] sm:inline">
                  Alt+P
                </kbd>
              </button>
            ) : (
              <button
                onClick={() => void handleResume()}
                disabled={busyAction === "resume" || session.status === "done"}
                aria-label="Resume agent execution (Alt+P)"
                title="Resume from current state (Alt+P)"
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-40"
              >
                <Play className="h-3.5 w-3.5" />
                {session.status === "rolled_back" ? "Resume from Rollback" : "Resume"}
              </button>
            )}

            <button
              onClick={() => setReqOpen(true)}
              aria-label="Inject mid-task requirement change (Alt+R)"
              title="Inject mid-task requirement change (Alt+R)"
              className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100"
            >
              <Sparkles className="h-3.5 w-3.5 text-amber-600" />
              Requirement Change
            </button>

            {/* Adaptive Autonomy selector (L1 / L2 / L3) */}
            <div
              title={session.adaptive_state.reason}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs"
            >
              <Gauge className="h-3.5 w-3.5 text-indigo-600" />
              <span className="text-[11px] text-slate-500">Autonomy</span>
              <select
                value={session.autonomy_level}
                onChange={(e) => void setAutonomy(e.target.value as AutonomyLevel)}
                className="bg-transparent font-semibold text-slate-900 focus:outline-none"
              >
                <option value="L1">L1 (Every step)</option>
                <option value="L2">L2 (Low-conf)</option>
                <option value="L3">L3 (Autonomous)</option>
              </select>
              <span className="font-mono text-[10px] text-slate-400">
                (OR {Math.round(session.adaptive_state.override_rate * 100)}%)
              </span>
            </div>

            <a
              href={api.getTelemetryExportUrl(session.session_id, "csv")}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              title="Download session telemetry CSV"
            >
              <Download className="h-3.5 w-3.5" />
              CSV
            </a>

            <button
              onClick={resetWorkspace}
              title="Exit session"
              className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </header>

      {/* Mid-Task Requirement Change Modal */}
      {reqOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-xs">
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900">
                Inject Mid-Task Requirement Change
              </h3>
              <button
                onClick={() => setReqOpen(false)}
                className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-1 text-xs text-slate-600">
              Co-Plan will checkpoint current state, preserve every{" "}
              <strong className="text-emerald-700">locked</strong> step untouched,
              and selectively invalidate or add unlocked steps to meet the new requirement.
            </p>

            {task?.mid_task_requirement && (
              <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-amber-900">
                    Standardized Study Injection
                  </span>
                  <button
                    type="button"
                    onClick={() => setReqText(task.mid_task_requirement)}
                    className="font-semibold text-amber-800 underline hover:text-amber-950"
                  >
                    Use This Prompt
                  </button>
                </div>
                <p className="mt-1 text-amber-900/80">{task.mid_task_requirement}</p>
              </div>
            )}

            <form onSubmit={(e) => void handleInjectRequirement(e)} className="mt-3 space-y-3">
              <textarea
                value={reqText}
                onChange={(e) => setReqText(e.target.value)}
                rows={4}
                required
                placeholder="Describe the new stakeholder requirement or constraint change..."
                className="w-full rounded-xl border border-slate-300 p-3 text-sm text-slate-800 focus:border-indigo-500 focus:outline-none"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setReqOpen(false)}
                  className="rounded-lg border border-slate-200 px-3.5 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busyAction === "requirement"}
                  className="rounded-lg bg-amber-600 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
                >
                  {busyAction === "requirement" ? "Replanning..." : "Apply Requirement & Replan"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
};
