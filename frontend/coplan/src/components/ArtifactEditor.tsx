import React, { useEffect, useState } from "react";
import {
  AlertTriangle,
  Bot,
  Columns2,
  Eye,
  FileEdit,
  Save,
  User,
} from "lucide-react";
import { useCoPlanStore } from "../store/useCoPlanStore";
import { MarkdownPreview } from "./MarkdownPreview";

type ViewMode = "preview" | "edit" | "split";

export const ArtifactEditor: React.FC = () => {
  const session = useCoPlanStore((s) => s.session);
  const busyAction = useCoPlanStore((s) => s.busyAction);
  const artifactConflict = useCoPlanStore((s) => s.artifactConflict);
  const saveArtifact = useCoPlanStore((s) => s.saveArtifact);
  const clearConflict = useCoPlanStore((s) => s.clearConflict);

  const [mode, setMode] = useState<ViewMode>("split");
  const [draft, setDraft] = useState("");
  const [baseVersion, setBaseVersion] = useState(1);
  const [dirty, setDirty] = useState(false);

  const artifact = session?.artifact;

  // Sync incoming agent/rollback patches cleanly unless user has unsaved edits
  useEffect(() => {
    if (!artifact) return;
    if (!dirty) {
      setDraft(artifact.content);
      setBaseVersion(artifact.version);
    }
  }, [artifact?.version, artifact?.content, dirty]);

  if (!session || !artifact) return null;

  const handleSave = async () => {
    const ok = await saveArtifact(draft, baseVersion);
    if (ok) {
      setDirty(false);
    }
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (dirty) {
          void handleSave();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const handleAcceptServer = () => {
    const latest = artifactConflict?.current_artifact || artifact;
    setDraft(latest.content);
    setBaseVersion(latest.version);
    setDirty(false);
    clearConflict();
  };

  const handleOverwriteWithDraft = async () => {
    const latestVersion = artifactConflict?.current_version || artifact.version;
    const ok = await saveArtifact(draft, latestVersion);
    if (ok) {
      setDirty(false);
      clearConflict();
    }
  };

  const wordCount = draft.trim() ? draft.trim().split(/\s+/).length : 0;

  return (
    <section className="flex h-full flex-col bg-slate-50">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-4 py-2.5">
        <div className="flex items-center gap-2.5">
          <h2 className="text-sm font-semibold text-slate-900">
            Shared Working Artifact
          </h2>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 font-mono text-[11px] font-medium text-slate-700">
            v{artifact.version}
          </span>
          <span
            className={[
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
              artifact.last_editor === "user"
                ? "bg-indigo-50 text-indigo-700"
                : "bg-emerald-50 text-emerald-700",
            ].join(" ")}
          >
            {artifact.last_editor === "user" ? (
              <>
                <User className="h-3 w-3" /> Last edit: You
              </>
            ) : (
              <>
                <Bot className="h-3 w-3" /> Last edit: Agent
              </>
            )}
          </span>
          <span className="hidden text-xs text-slate-400 sm:inline">
            {wordCount} words
          </span>
        </div>

        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
            {(
              [
                { id: "preview", label: "Preview", icon: <Eye className="h-3.5 w-3.5" /> },
                { id: "split", label: "Split", icon: <Columns2 className="h-3.5 w-3.5" /> },
                { id: "edit", label: "Markdown", icon: <FileEdit className="h-3.5 w-3.5" /> },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                onClick={() => setMode(tab.id)}
                className={[
                  "inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition",
                  mode === tab.id
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-500 hover:text-slate-800",
                ].join(" ")}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>

          <button
            onClick={() => void handleSave()}
            disabled={!dirty || busyAction === "save_artifact"}
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Save className="h-3.5 w-3.5" />
            {dirty ? "Sync Edits" : "Synced"}
          </button>
        </div>
      </div>

      {/* Unsaved notice when agent advanced version */}
      {dirty && artifact.version > baseVersion && !artifactConflict && (
        <div className="flex items-center justify-between border-b border-indigo-200 bg-indigo-50 px-4 py-2 text-xs text-indigo-800">
          <span>
            Agent updated the document to v{artifact.version} while you are editing (based on v{baseVersion}). Saving will attempt a non-overlapping section merge.
          </span>
          <button
            onClick={handleAcceptServer}
            className="ml-3 shrink-0 font-semibold underline hover:text-indigo-950"
          >
            Discard local & pull v{artifact.version}
          </button>
        </div>
      )}

      {/* Optimistic version conflict banner */}
      {artifactConflict && (
        <div className="border-b border-rose-300 bg-rose-50 px-4 py-3 text-xs text-rose-900">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
            <div className="flex-1">
              <div className="font-semibold">Concurrent Edit Conflict</div>
              <p className="mt-0.5 text-rose-800">{artifactConflict.message}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  onClick={handleAcceptServer}
                  className="rounded-md border border-rose-300 bg-white px-2.5 py-1 font-medium text-rose-800 hover:bg-rose-100"
                >
                  Load Agent Version (v{artifactConflict.current_version})
                </button>
                <button
                  onClick={() => void handleOverwriteWithDraft()}
                  className="rounded-md bg-rose-600 px-2.5 py-1 font-medium text-white hover:bg-rose-700"
                >
                  Keep My Edits & Force Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Editor / Preview body */}
      <div className="flex flex-1 overflow-hidden">
        {(mode === "edit" || mode === "split") && (
          <div
            className={[
              "flex flex-col bg-white",
              mode === "split" ? "w-1/2 border-r border-slate-200" : "w-full",
            ].join(" ")}
          >
            <textarea
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                setDirty(true);
              }}
              spellCheck={false}
              placeholder="Collaboratively edit the Markdown artifact directly. Save to sync with the agent..."
              className="h-full w-full resize-none p-5 font-mono text-xs leading-relaxed text-slate-800 focus:outline-none"
            />
          </div>
        )}

        {(mode === "preview" || mode === "split") && (
          <div
            className={[
              "overflow-y-auto bg-white p-6",
              mode === "split" ? "w-1/2" : "w-full",
            ].join(" ")}
          >
            <MarkdownPreview content={draft} />
          </div>
        )}
      </div>
    </section>
  );
};
