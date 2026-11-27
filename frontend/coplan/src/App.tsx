import React, { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { ArtifactEditor } from "./components/ArtifactEditor";
import { PlanTree } from "./components/PlanTree";
import { SessionLauncher } from "./components/SessionLauncher";
import { TimelinePanel } from "./components/TimelinePanel";
import { TopBar } from "./components/TopBar";
import { useCoPlanStore } from "./store/useCoPlanStore";
import BaselineApp from "../../baseline/src/App";

export const App: React.FC = () => {
  const [mode, setMode] = useState<"coplan" | "baseline">("coplan");
  const health = useCoPlanStore((s) => s.health);
  const loadHealth = useCoPlanStore((s) => s.loadHealth);
  const session = useCoPlanStore((s) => s.session);
  const error = useCoPlanStore((s) => s.error);
  const toast = useCoPlanStore((s) => s.toast);
  const clearError = useCoPlanStore((s) => s.clearError);
  const clearToast = useCoPlanStore((s) => s.clearToast);

  useEffect(() => {
    void loadHealth();
  }, [loadHealth]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(clearToast, 3500);
    return () => window.clearTimeout(timer);
  }, [toast, clearToast]);

  const mockBanner =
    health?.llm_provider === "mock" ? (
      <div
        role="alert"
        className="flex items-center justify-center gap-2 border-b border-amber-400 bg-amber-300 px-4 py-1.5 text-center text-xs font-bold tracking-wide text-amber-950"
      >
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>
          MOCK LLM ACTIVE ({health.llm_model}) — Demo / test mode only. Set
          LLM_PROVIDER &amp; LLM_API_KEY in .env before collecting study data.
        </span>
      </div>
    ) : null;

  if (!session) {
    if (mode === "baseline") {
      return <BaselineApp onSwitchMode={() => setMode("coplan")} />;
    }
    return (
      <div className="flex min-h-screen flex-col">
        {mockBanner}
        <div className="flex-1">
          <SessionLauncher onSwitchToBaseline={() => setMode("baseline")} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-slate-50">
      {mockBanner}
      <TopBar />

      {error && (
        <div
          role="alert"
          className="flex items-center justify-between border-b border-rose-200 bg-rose-50 px-4 py-2 text-xs text-rose-800"
        >
          <span>{error}</span>
          <button
            onClick={clearError}
            className="font-semibold underline hover:text-rose-950"
          >
            Dismiss
          </button>
        </div>
      )}

      <main className="grid flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[340px_1fr_300px]">
        <PlanTree />
        <ArtifactEditor />
        <TimelinePanel />
      </main>

      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed right-5 bottom-5 z-50 rounded-xl border border-slate-800 bg-slate-900 px-4 py-2.5 text-xs font-medium text-white shadow-lg"
        >
          {toast}
        </div>
      )}
    </div>
  );
};

export default App;
