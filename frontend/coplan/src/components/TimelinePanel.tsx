import React, { useState } from "react";
import { Activity, History, RotateCcw } from "lucide-react";
import { useCoPlanStore } from "../store/useCoPlanStore";

export const TimelinePanel: React.FC = () => {
  const session = useCoPlanStore((s) => s.session);
  const activity = useCoPlanStore((s) => s.activity);
  const busyAction = useCoPlanStore((s) => s.busyAction);
  const rollback = useCoPlanStore((s) => s.rollback);

  const [tab, setTab] = useState<"checkpoints" | "events">("checkpoints");

  if (!session) return null;

  const checkpoints = [...session.checkpoints].reverse();

  return (
    <aside className="flex h-full flex-col border-l border-slate-200 bg-white">
      <div className="flex border-b border-slate-200 px-3 pt-2.5">
        <button
          onClick={() => setTab("checkpoints")}
          className={[
            "flex flex-1 items-center justify-center gap-1.5 border-b-2 pb-2.5 text-xs font-semibold transition",
            tab === "checkpoints"
              ? "border-indigo-600 text-indigo-600"
              : "border-transparent text-slate-500 hover:text-slate-800",
          ].join(" ")}
        >
          <History className="h-3.5 w-3.5" />
          Checkpoints ({checkpoints.length})
        </button>
        <button
          onClick={() => setTab("events")}
          className={[
            "flex flex-1 items-center justify-center gap-1.5 border-b-2 pb-2.5 text-xs font-semibold transition",
            tab === "events"
              ? "border-indigo-600 text-indigo-600"
              : "border-transparent text-slate-500 hover:text-slate-800",
          ].join(" ")}
        >
          <Activity className="h-3.5 w-3.5" />
          SSE Feed ({activity.length})
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {tab === "checkpoints" ? (
          checkpoints.length === 0 ? (
            <p className="p-4 text-center text-xs text-slate-400">
              Checkpoints appear automatically at every plan, step, edit, and interrupt boundary.
            </p>
          ) : (
            <div className="space-y-2">
              {checkpoints.map((cp) => (
                <div
                  key={cp.checkpoint_id}
                  className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 transition hover:border-slate-300"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold text-slate-900">
                        {cp.label}
                      </p>
                      <p className="mt-0.5 font-mono text-[10px] text-slate-500">
                        Plan v{cp.plan_version} · Art v{cp.artifact_version} ·{" "}
                        {cp.autonomy_level}
                      </p>
                      <p className="mt-0.5 font-mono text-[10px] text-slate-400">
                        {new Date(cp.created_at).toLocaleTimeString()} ·{" "}
                        {cp.checkpoint_id}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => void rollback(cp.checkpoint_id)}
                    disabled={busyAction === `rollback:${cp.checkpoint_id}`}
                    className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 disabled:opacity-50"
                  >
                    <RotateCcw className="h-3 w-3" />
                    Roll Back Here
                  </button>
                </div>
              ))}
            </div>
          )
        ) : activity.length === 0 ? (
          <p className="p-4 text-center text-xs text-slate-400">
            Waiting for live SSE events...
          </p>
        ) : (
          <div className="space-y-1.5">
            {activity.map((item) => (
              <div
                key={item.id}
                className="rounded-lg border border-slate-100 bg-slate-50 px-2.5 py-2 text-[11px]"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="rounded bg-slate-200/70 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-700">
                    {item.event}
                  </span>
                  <span className="font-mono text-[10px] text-slate-400">
                    #{item.seq}
                  </span>
                </div>
                <p className="mt-1 text-slate-700">{item.summary}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
};
