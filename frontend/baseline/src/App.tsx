import React, { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  Copy,
  Download,
  ExternalLink,
  Layers,
  Loader2,
  LogOut,
  MessageSquare,
  Send,
  Sparkles,
  User,
  UserCheck,
} from "lucide-react";
import { useBaselineStore } from "./store/useBaselineStore";

export interface BaselineAppProps {
  onSwitchMode?: () => void;
}

export const App: React.FC<BaselineAppProps> = ({ onSwitchMode }) => {
  const health = useBaselineStore((s) => s.health);
  const assignment = useBaselineStore((s) => s.assignment);
  const loadHealth = useBaselineStore((s) => s.loadHealth);
  const lookupAssignment = useBaselineStore((s) => s.lookupAssignment);
  const tasks = useBaselineStore((s) => s.tasks);
  const session = useBaselineStore((s) => s.session);
  const messages = useBaselineStore((s) => s.messages);
  const waiting = useBaselineStore((s) => s.waiting);
  const error = useBaselineStore((s) => s.error);
  const loadTasks = useBaselineStore((s) => s.loadTasks);
  const startSession = useBaselineStore((s) => s.startSession);
  const sendMessage = useBaselineStore((s) => s.sendMessage);
  const reset = useBaselineStore((s) => s.reset);
  const telemetryUrl = useBaselineStore((s) => s.telemetryUrl);

  const [participantId, setParticipantId] = useState("P01");
  const [selectedTaskId, setSelectedTaskId] = useState("task_research_brief");
  const [input, setInput] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void loadHealth();
    void loadTasks();
  }, [loadHealth, loadTasks]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void lookupAssignment(participantId).then((res) => {
        if (res?.next_task_id) setSelectedTaskId(res.next_task_id);
      });
    }, 200);
    return () => window.clearTimeout(timer);
  }, [participantId, lookupAssignment]);

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

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, waiting]);

  const currentTask = tasks.find(
    (t) => t.task_id === (session?.task_id || selectedTaskId),
  );

  const handleLaunch = async (e: React.FormEvent) => {
    e.preventDefault();
    await startSession({
      task_id: selectedTaskId,
      participant_id: participantId.trim() || "P01",
    });
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || waiting) return;
    const text = input;
    setInput("");
    await sendMessage(text);
  };

  const copyContent = (id: string, text: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedId(id);
    window.setTimeout(() => setCopiedId(null), 1800);
  };

  if (!session) {
    return (
      <div className="flex min-h-screen flex-col bg-slate-50">
        {mockBanner}
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-800 text-white">
                <MessageSquare className="h-5 w-5" />
              </div>
              <div>
                <h1 className="text-xl font-bold tracking-tight text-slate-900">
                  Baseline Chat Workspace
                </h1>
                <p className="text-xs text-slate-500">
                  Resurrect 2026 · Problem 3 · Control Condition (Prompt-and-Wait)
                </p>
              </div>
            </div>
            <span className="rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
              Control
            </span>
          </div>

          {onSwitchMode && (
            <div
              role="tablist"
              aria-label="Interface Mode"
              className="mt-5 grid grid-cols-2 gap-1.5 rounded-xl border border-slate-200 bg-slate-100 p-1"
            >
              <button
                type="button"
                role="tab"
                aria-selected={false}
                onClick={onSwitchMode}
                className="inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-slate-600 transition hover:bg-white/60 hover:text-slate-900"
              >
                <Layers className="h-3.5 w-3.5" />
                Shared Workspace (Treatment)
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={true}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-white px-3 py-2 text-xs font-semibold text-slate-900 shadow-xs"
              >
                <MessageSquare className="h-3.5 w-3.5" />
                Baseline Chat (Control)
              </button>
            </div>
          )}

          {error && (
            <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-xs text-rose-800">
              {error}
            </div>
          )}

          <form onSubmit={(e) => void handleLaunch(e)} className="mt-6 space-y-5">
            <div>
              <label
                htmlFor="baseline-participant-id"
                className="block text-xs font-semibold text-slate-700"
              >
                Participant ID
              </label>
              <input
                id="baseline-participant-id"
                value={participantId}
                onChange={(e) => setParticipantId(e.target.value)}
                required
                className="mt-1 w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm focus:border-slate-700 focus:outline-none"
                placeholder="e.g. P01"
              />
            </div>

            {assignment && (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-800">
                <div className="flex items-center justify-between gap-2 font-semibold">
                  <span className="inline-flex items-center gap-1.5">
                    <UserCheck className="h-4 w-4 text-slate-700" />
                    Assignment for {assignment.participant_id}
                  </span>
                  {assignment.next_condition && (
                    <span className="font-mono text-[11px]">
                      {assignment.next_condition.toUpperCase()} · {assignment.next_task_id}
                    </span>
                  )}
                </div>
                {assignment.next_condition === "coplan" &&
                  (onSwitchMode || assignment.next_app_url) && (
                    <div className="mt-2 flex items-center justify-between rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 text-indigo-900">
                      <span>Next counterbalanced round is Shared Workspace.</span>
                      {onSwitchMode ? (
                        <button
                          type="button"
                          onClick={onSwitchMode}
                          className="inline-flex items-center gap-1 font-semibold underline"
                        >
                          Switch to Shared Workspace <ArrowRight className="h-3 w-3" />
                        </button>
                      ) : (
                        <a
                          href={assignment.next_app_url || "#"}
                          className="inline-flex items-center gap-1 font-semibold underline"
                        >
                          Open Co-Plan <ExternalLink className="h-3 w-3" />
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
              <div className="mt-2 space-y-2.5">
                {tasks.map((task) => (
                  <button
                    key={task.task_id}
                    type="button"
                    onClick={() => setSelectedTaskId(task.task_id)}
                    className={[
                      "w-full rounded-xl border p-3.5 text-left transition",
                      selectedTaskId === task.task_id
                        ? "border-slate-800 bg-slate-50 ring-2 ring-slate-200"
                        : "border-slate-200 bg-white hover:border-slate-300",
                    ].join(" ")}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-slate-900">
                        {task.title}
                      </span>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                        {task.domain}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-slate-600">
                      {task.prompt}
                    </p>
                  </button>
                ))}
              </div>
            </div>

            <button
              type="submit"
              disabled={waiting}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:opacity-50"
            >
              Start Baseline Chat Session
              <ArrowRight className="h-4 w-4" />
            </button>
          </form>
        </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-slate-50">
      {mockBanner}
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-5 py-3 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 text-white">
            <MessageSquare className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-slate-900">Baseline Chat</span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-slate-600">
                Control · Non-Streaming
              </span>
            </div>
            <p className="text-[11px] text-slate-500">
              {currentTask?.title || session.task_id} · {session.participant_id}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <a
            href={telemetryUrl("csv")}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <Download className="h-3.5 w-3.5" />
            CSV
          </a>
          <button
            onClick={reset}
            className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-100"
            title="Exit session"
          >
            <LogOut className="h-3.5 w-3.5" />
          </button>
        </div>
      </header>

      {/* Task Prompt & Mid-Task Requirement Reference Bar */}
      {currentTask && (
        <div className="border-b border-slate-200 bg-slate-100/70 px-5 py-2.5 text-xs text-slate-700">
          <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-2">
            <p className="flex-1">
              <strong className="text-slate-900">Task:</strong> {currentTask.prompt}
            </p>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => setInput(currentTask.prompt)}
                className="rounded-md border border-slate-300 bg-white px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-50"
              >
                Insert Task Prompt
              </button>
              <button
                type="button"
                onClick={() => setInput(currentTask.mid_task_requirement)}
                className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1 font-medium text-amber-900 hover:bg-amber-100"
              >
                <Sparkles className="h-3 w-3 text-amber-600" />
                Insert Requirement Change
              </button>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="border-b border-rose-200 bg-rose-50 px-5 py-2 text-xs text-rose-800">
          {error}
        </div>
      )}

      {/* Conversation List */}
      <main className="flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto max-w-3xl space-y-4">
          {messages.length === 0 && (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
              Send your prompt below. The assistant will process your entire request and return the full response once finished.
            </div>
          )}

          {messages.map((msg) => (
            <div
              key={msg.message_id}
              className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              {msg.role === "assistant" && (
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-900 text-white">
                  <Bot className="h-4 w-4" />
                </div>
              )}

              <div
                className={[
                  "max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-xs",
                  msg.role === "user"
                    ? "bg-slate-900 text-white"
                    : "border border-slate-200 bg-white text-slate-800",
                ].join(" ")}
              >
                <div className="whitespace-pre-wrap font-sans">{msg.content}</div>
                {msg.role === "assistant" && (
                  <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2 text-[11px] text-slate-400">
                    <span className="font-mono">
                      {Math.round(msg.latency_ms || 0)}ms · in {msg.tokens_in || 0} / out{" "}
                      {msg.tokens_out || 0} tok
                    </span>
                    <button
                      onClick={() => copyContent(msg.message_id, msg.content)}
                      className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-900"
                    >
                      <Copy className="h-3 w-3" />
                      {copiedId === msg.message_id ? "Copied" : "Copy"}
                    </button>
                  </div>
                )}
              </div>

              {msg.role === "user" && (
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-200 text-slate-700">
                  <User className="h-4 w-4" />
                </div>
              )}
            </div>
          ))}

          {waiting && (
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-900 text-white">
                <Bot className="h-4 w-4" />
              </div>
              <div className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-600 shadow-xs">
                <Loader2 className="h-4 w-4 animate-spin text-slate-500" />
                Generating full response... (please wait)
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>
      </main>

      {/* Bottom Prompt Box */}
      <footer className="border-t border-slate-200 bg-white px-4 py-3">
        <form
          onSubmit={(e) => void handleSend(e)}
          className="mx-auto flex max-w-3xl items-end gap-2"
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void handleSend(e);
              }
            }}
            rows={2}
            disabled={waiting}
            placeholder="Write a prompt or revision request... (Enter to send, Shift+Enter for newline)"
            className="flex-1 resize-none rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 focus:border-slate-800 focus:outline-none disabled:bg-slate-50"
          />
          <button
            type="submit"
            disabled={waiting || !input.trim()}
            className="inline-flex h-11 items-center gap-1.5 rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-40"
          >
            <Send className="h-4 w-4" />
            Send
          </button>
        </form>
      </footer>
    </div>
  );
};

export default App;
