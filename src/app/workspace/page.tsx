"use client";

import React, { useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Bell,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Download,
  Edit3,
  Loader2,
  Lock,
  MessageSquarePlus,
  Paperclip,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Send,
  ShieldAlert,
  Square,
  Trash2,
  Unlock,
  X,
} from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { useRelayStore } from "@/hooks/useRelayStore";
import {
  AgentAvatar,
  Badge,
  Button,
  Input,
  ProgressBar,
  StatusBadge,
  Textarea,
  Tooltip,
  getAgentStyle,
  getHumanStatusMeta,
} from "@/components/ui/primitives";
import { MarkdownMessage } from "@/components/ui/MarkdownMessage";
import { cn, downloadTextFile, formatRelativeTime, generateId } from "@/lib/utils/cn";
import type { AttachmentItem, StepPriority, TaskStep } from "@/types/relay";

export default function WorkspacePage() {
  const {
    agents,
    conversations,
    activeConversationId,
    setActiveConversationId,
    messages,
    tasks,
    approvals,
    busyTaskId,
    startCollaboration,
    startMidTaskPivotDemo,
    sendHumanMessage,
    askTaskClarification,
    interruptAndModifyRequirements,
    mutatePlan,
    adaptPlanWithFeedback,
    approvePlanAndExecute,
    rejectPlan,
    pauseTask,
    resumeTask,
    retryFailedTask,
    skipFailedStep,
    cancelTask,
    rollbackTask,
    decideApproval,
  } = useRelayStore();

  const [mobilePanel, setMobilePanel] = useState<"left" | "center" | "right">("center");
  const [inputText, setInputText] = useState("");
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const [composerMode, setComposerMode] = useState<"modify" | "clarify">("modify");

  const [editingStepId, setEditingStepId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editPriority, setEditPriority] = useState<StepPriority>("medium");
  const [editReqApproval, setEditReqApproval] = useState(false);

  const [addingStep, setAddingStep] = useState(false);
  const [newStepTitle, setNewStepTitle] = useState("");
  const [newStepDesc, setNewStepDesc] = useState("");
  const [newStepPriority, setNewStepPriority] = useState<StepPriority>("medium");

  const [modPrompt, setModPrompt] = useState("");
  const [showModInput, setShowModInput] = useState(false);
  const [expandedStepIds, setExpandedStepIds] = useState<Record<string, boolean>>({});
  const [showCheckpoints, setShowCheckpoints] = useState(false);
  const [showWorkflowUpdates, setShowWorkflowUpdates] = useState(false);
  const [showAlternatives, setShowAlternatives] = useState(false);
  const [showComparePlans, setShowComparePlans] = useState(false);
  const [showHandoffs, setShowHandoffs] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === activeConversationId) ?? null,
    [conversations, activeConversationId]
  );

  const activeTask = useMemo(
    () =>
      activeConversation
        ? tasks.find((t) => t.conversationId === activeConversation.id) ?? null
        : null,
    [tasks, activeConversation]
  );

  const activeMessages = useMemo(
    () =>
      activeConversation
        ? messages.filter((m) => m.conversationId === activeConversation.id)
        : [],
    [messages, activeConversation]
  );

  // Separate important workflow updates from normal conversation so chat feels natural
  const conversationMessages = useMemo(
    () => activeMessages.filter((m) => m.messageType !== "activity_update"),
    [activeMessages]
  );

  const workflowUpdates = useMemo(
    () => activeMessages.filter((m) => m.messageType === "activity_update"),
    [activeMessages]
  );

  const latestUpdate = workflowUpdates[workflowUpdates.length - 1] ?? null;

  const activeRunningStep = useMemo(
    () => activeTask?.steps.find((s) => s.status === "running") ?? null,
    [activeTask]
  );

  const taskPendingApproval = useMemo(
    () =>
      activeTask
        ? approvals.find((a) => a.taskId === activeTask.id && a.status === "pending") ?? null
        : null,
    [approvals, activeTask]
  );

  const activeTaskStatusMeta = activeTask ? getHumanStatusMeta(activeTask.status) : null;

  function startEditStep(step: TaskStep) {
    setEditingStepId(step.id);
    setEditTitle(step.title);
    setEditDesc(step.description);
    setEditPriority(step.priority);
    setEditReqApproval(step.requiresApproval);
  }

  function saveEditStep() {
    if (!activeTask || !editingStepId) return;
    mutatePlan(activeTask.id, {
      type: "edit",
      stepId: editingStepId,
      title: editTitle.trim() || undefined,
      description: editDesc.trim(),
      priority: editPriority,
      requiresApproval: editReqApproval,
    });
    setEditingStepId(null);
  }

  function handleAddStep(e: React.FormEvent) {
    e.preventDefault();
    if (!activeTask || !newStepTitle.trim()) return;
    mutatePlan(activeTask.id, {
      type: "add",
      title: newStepTitle,
      description: newStepDesc || "Added by collaborator.",
      priority: newStepPriority,
    });
    setNewStepTitle("");
    setNewStepDesc("");
    setAddingStep(false);
  }

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    let excerpt = "";
    try {
      const text = await file.text();
      excerpt = text.slice(0, 180).replace(/\s+/g, " ");
    } catch {
      excerpt = `${file.type || "file"} attached`;
    }
    setAttachments((prev) => [
      ...prev,
      {
        id: generateId("att"),
        name: file.name,
        size: file.size,
        type: file.type || "text/plain",
        excerpt,
      },
    ]);
    e.target.value = "";
  }

  async function handleSubmitChat(e: React.FormEvent) {
    e.preventDefault();
    const content = inputText.trim();
    if (!content) return;
    setInputText("");
    const attached = [...attachments];
    setAttachments([]);

    if (!activeConversation || !activeTask) {
      await startCollaboration(content, attached);
      return;
    }

    if (composerMode === "clarify") {
      await askTaskClarification(activeTask.id, content);
      return;
    }

    if (activeTask.status === "running") {
      interruptAndModifyRequirements(activeTask.id, content);
      return;
    }

    await sendHumanMessage(activeConversation.id, content, attached);
  }

  return (
    <AppShell
      title="Workspace"
      subtitle="Collaborate naturally with your Planning, Research, and Execution agents"
      actions={
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setActiveConversationId(null)}
          >
            <MessageSquarePlus className="h-3.5 w-3.5" />
            New Task
          </Button>
          <Button
            size="sm"
            variant="cyan"
            disabled={Boolean(busyTaskId)}
            onClick={() => startMidTaskPivotDemo()}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Mid-Task Pivot Demo
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={Boolean(busyTaskId)}
            onClick={() =>
              startCollaboration("Prepare a research report about renewable energy.")
            }
          >
            Renewable Energy Demo
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Clean Workflow Control Bar */}
        {activeTask && (
          <div className="panel-surface rounded-xl p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0 space-y-0.5">
                <div className="flex items-center gap-2.5 flex-wrap">
                  <span className="text-sm font-semibold text-white truncate max-w-md">
                    {activeTask.title}
                  </span>
                  <StatusBadge status={activeTask.status} />
                  <span className="text-xs text-zinc-400 font-mono">
                    {activeTask.progress}%
                  </span>
                </div>
                {activeTaskStatusMeta && (
                  <p className="text-xs text-zinc-400">{activeTaskStatusMeta.sentence}</p>
                )}
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                {activeTask.status === "running" && (
                  <Button
                    size="xs"
                    variant="warning"
                    onClick={() => pauseTask(activeTask.id)}
                  >
                    <Pause className="h-3 w-3" /> Pause
                  </Button>
                )}
                {activeTask.status === "paused" && (
                  <Button
                    size="xs"
                    variant="success"
                    onClick={() => resumeTask(activeTask.id)}
                  >
                    <Play className="h-3 w-3" /> Resume
                  </Button>
                )}
                {activeTask.status === "failed" && (
                  <Button
                    size="xs"
                    variant="cyan"
                    onClick={() => retryFailedTask(activeTask.id)}
                  >
                    <RefreshCw className="h-3 w-3" /> Retry Step
                  </Button>
                )}
                {(activeTask.status === "running" ||
                  activeTask.status === "paused" ||
                  activeTask.status === "waiting_for_approval" ||
                  activeTask.status === "awaiting_plan_approval") && (
                  <Button
                    size="xs"
                    variant="danger"
                    onClick={() => cancelTask(activeTask.id)}
                  >
                    <Square className="h-3 w-3" /> Stop
                  </Button>
                )}

                {activeTask.checkpoints.length > 0 && (
                  <div className="relative">
                    <Button
                      size="xs"
                      variant="secondary"
                      onClick={() => setShowCheckpoints((s) => !s)}
                    >
                      <RotateCcw className="h-3 w-3" />
                      Restore ({activeTask.checkpoints.length})
                    </Button>
                    {showCheckpoints && (
                      <div className="absolute right-0 mt-1.5 w-64 rounded-xl bg-[#191d2b] border border-white/15 shadow-toast p-2 z-30 space-y-1 animate-fade-in">
                        <p className="text-[11px] font-medium text-zinc-400 px-2 py-1">
                          Restore an earlier checkpoint
                        </p>
                        {activeTask.checkpoints.map((chk) => (
                          <button
                            key={chk.id}
                            type="button"
                            onClick={() => {
                              rollbackTask(activeTask.id, chk.id);
                              setShowCheckpoints(false);
                            }}
                            className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-white/[0.06] text-xs text-zinc-200 transition-colors"
                          >
                            <div className="font-medium truncate">{chk.label}</div>
                            <div className="text-[11px] text-zinc-500">
                              {formatRelativeTime(chk.createdAt)}
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {activeTask.finalOutput && (
                  <Button
                    size="xs"
                    variant="cyan"
                    onClick={() =>
                      downloadTextFile(
                        `${activeTask.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.md`,
                        activeTask.finalOutput!,
                        "text/markdown;charset=utf-8"
                      )
                    }
                  >
                    <Download className="h-3 w-3" />
                    Export Report
                  </Button>
                )}
              </div>
            </div>

            {/* Requirement Change Impact Banner — never silently alter an approved plan */}
            {activeTask.lastRequirementChange &&
              !activeTask.lastRequirementChange.approvedAfterChange && (
                <div className="rounded-xl bg-[#8b7cf6]/10 border border-[#8b7cf6]/35 p-3.5 space-y-2.5 animate-fade-in">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Badge tone={activeTask.lastRequirementChange.requiresReapproval ? "amber" : "purple"}>
                        {activeTask.lastRequirementChange.requiresReapproval
                          ? "Approval needed again"
                          : "Plan updated"}
                      </Badge>
                      <span className="text-xs font-semibold text-white">
                        Requirements changed
                      </span>
                    </div>
                    {activeTask.status === "awaiting_plan_approval" && (
                      <Button
                        size="xs"
                        variant="primary"
                        disabled={Boolean(busyTaskId)}
                        onClick={() => approvePlanAndExecute(activeTask.id)}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Approve Updated Plan &amp; Continue
                      </Button>
                    )}
                  </div>

                  <div className="grid sm:grid-cols-3 gap-2.5 text-xs">
                    <div className="rounded-lg bg-[#0e1119]/90 border border-white/[0.07] p-2.5 space-y-0.5">
                      <p className="text-[11px] font-medium text-zinc-400">What changed</p>
                      <p className="text-zinc-200 line-clamp-2">
                        {activeTask.lastRequirementChange.changeText}
                      </p>
                    </div>
                    <div className="rounded-lg bg-[#0e1119]/90 border border-white/[0.07] p-2.5 space-y-1">
                      <p className="text-[11px] font-medium text-zinc-400">
                        Affected steps ({activeTask.lastRequirementChange.affectedStepTitles.length})
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {activeTask.lastRequirementChange.affectedStepTitles
                          .slice(0, 3)
                          .map((title) => (
                            <span
                              key={title}
                              className="text-[11px] px-1.5 py-0.5 rounded bg-white/[0.06] text-zinc-200 truncate max-w-[180px]"
                            >
                              {title}
                            </span>
                          ))}
                      </div>
                    </div>
                    <div className="rounded-lg bg-[#0e1119]/90 border border-white/[0.07] p-2.5 space-y-0.5">
                      <p className="text-[11px] font-medium text-zinc-400">Plan approval</p>
                      <p className="text-zinc-200">
                        {activeTask.lastRequirementChange.requiresReapproval
                          ? "Yes — please review and approve the updated steps before continuing."
                          : "Ready for your initial plan approval whenever you're done editing."}
                      </p>
                    </div>
                  </div>
                </div>
              )}

            {/* Helpful Error or Recovery Notice */}
            {(activeTask.errorMessage || activeTask.fallbackNotice) && (
              <div
                className={cn(
                  "rounded-lg px-3.5 py-2.5 text-xs flex flex-wrap items-center justify-between gap-2 border",
                  activeTask.errorMessage
                    ? "bg-rose-500/10 border-rose-400/30 text-rose-100"
                    : "bg-amber-500/10 border-amber-400/25 text-amber-100"
                )}
              >
                <span className="flex items-center gap-2">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  {activeTask.errorMessage || activeTask.fallbackNotice}
                </span>
                {activeTask.status === "paused" && (
                  <Button
                    size="xs"
                    variant="success"
                    onClick={() => resumeTask(activeTask.id)}
                  >
                    Resume
                  </Button>
                )}
              </div>
            )}

            {/* Mid-Task Pivot Demo Strip */}
            {activeTask.sharedContext?.evaluationMeta && (
              <div className="rounded-lg bg-cyan-500/[0.08] border border-cyan-400/25 px-3.5 py-2.5 text-xs text-cyan-100 flex flex-wrap items-center justify-between gap-2">
                <span>
                  <strong className="text-white">
                    {activeTask.sharedContext.evaluationMeta.participantCode === "HAI-DEMO"
                      ? "Guided Mid-Task Change Demo:"
                      : `Trial (${activeTask.sharedContext.evaluationMeta.participantCode}):`}
                  </strong>{" "}
                  {activeTask.sharedContext.evaluationMeta.midTaskChangeInjected
                    ? "Your requirement change is applied. Review the updated steps and approve to continue."
                    : "Approve the plan, let the Research Agent start, then try shifting requirements mid-task."}
                </span>
                <div className="flex items-center gap-2">
                  {!activeTask.sharedContext.evaluationMeta.midTaskChangeInjected &&
                    activeTask.status !== "completed" && (
                      <Button
                        size="xs"
                        variant="warning"
                        onClick={() =>
                          interruptAndModifyRequirements(
                            activeTask.id,
                            activeTask.sharedContext!.evaluationMeta!.midTaskChangePrompt
                          )
                        }
                      >
                        Try Mid-Task Change
                      </Button>
                    )}
                  <Link href="/analytics">
                    <Button size="xs" variant="secondary">
                      Compare in Analytics
                    </Button>
                  </Link>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Mobile / Tablet Panel Switcher */}
        <div className="grid grid-cols-3 gap-1.5 xl:hidden bg-surface p-1 rounded-xl border border-white/[0.08]">
          {[
            { id: "left" as const, label: "Projects" },
            { id: "center" as const, label: "Collaboration" },
            { id: "right" as const, label: `Plan (${activeTask?.steps.length ?? 0})` },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setMobilePanel(tab.id)}
              className={cn(
                "py-2 text-xs font-medium rounded-lg transition-colors",
                mobilePanel === tab.id
                  ? "bg-[#7c6ce8] text-white"
                  : "text-zinc-400 hover:text-white"
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Comfortable 3-Column Collaboration Layout */}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
          {/* ================= LEFT: CONVERSATIONS, PROJECTS & AGENTS ================= */}
          <div
            className={cn(
              "xl:col-span-3 space-y-4",
              mobilePanel !== "left" && "hidden xl:block"
            )}
          >
            {/* Current Project */}
            <div className="panel-surface rounded-xl p-4 space-y-2.5">
              <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
                Current Project
              </p>
              {activeTask ? (
                <>
                  <h2 className="text-sm font-semibold text-white">{activeTask.title}</h2>
                  <p className="text-xs text-zinc-400 line-clamp-3 leading-relaxed">
                    {activeTask.objective}
                  </p>
                  <ProgressBar value={activeTask.progress} />
                  <div className="flex items-center justify-between text-[11px] text-zinc-500">
                    <span>
                      {activeTask.steps.filter((s) => s.status === "completed").length} /{" "}
                      {activeTask.steps.length} steps
                    </span>
                    <span className="font-mono text-zinc-300">{activeTask.progress}%</span>
                  </div>
                </>
              ) : (
                <p className="text-xs text-zinc-400 leading-relaxed">
                  Share a goal in the collaboration area or start one of the built-in demos.
                </p>
              )}
            </div>

            {/* Conversations */}
            <div className="panel-surface rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
                  Conversations ({conversations.length})
                </p>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => setActiveConversationId(null)}
                >
                  <Plus className="h-3 w-3" /> New
                </Button>
              </div>
              {conversations.length === 0 ? (
                <p className="text-xs text-zinc-500 text-center py-5">
                  Your conversations will appear here.
                </p>
              ) : (
                <div className="space-y-1.5 max-h-60 overflow-y-auto pr-1">
                  {conversations.map((conv) => {
                    const selected = conv.id === activeConversationId;
                    return (
                      <button
                        key={conv.id}
                        type="button"
                        onClick={() => {
                          setActiveConversationId(conv.id);
                          setMobilePanel("center");
                        }}
                        className={cn(
                          "w-full text-left rounded-lg px-3 py-2 border transition-all duration-150",
                          selected
                            ? "bg-[#8b7cf6]/14 border-[#8b7cf6]/35 text-white"
                            : "bg-[#0e1119] border-white/[0.06] text-zinc-300 hover:bg-surface-elevated"
                        )}
                      >
                        <p className="text-xs font-medium truncate">{conv.title}</p>
                        <p className="text-[11px] text-zinc-500 mt-0.5">
                          {formatRelativeTime(conv.updatedAt)}
                        </p>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Agent Team Status */}
            <div className="panel-surface rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
                  Agent Team
                </p>
                <Link href="/agents" className="text-xs text-[#a79bf9] hover:underline">
                  Manage
                </Link>
              </div>
              <div className="space-y-2">
                {agents.map((ag) => (
                  <div
                    key={ag.id}
                    className="rounded-lg bg-[#0e1119] border border-white/[0.06] px-3 py-2.5 flex items-center justify-between gap-2"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <AgentAvatar role={ag.slug} size="xs" />
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-zinc-100 truncate">
                          {ag.name}
                        </p>
                        <p className="text-[11px] text-zinc-500 truncate">
                          {ag.currentTaskLabel || ag.description}
                        </p>
                      </div>
                    </div>
                    <StatusBadge status={ag.status} />
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ================= CENTRE: MAIN COLLABORATION AREA ================= */}
          <div
            className={cn(
              "xl:col-span-5 panel-surface rounded-xl flex flex-col overflow-hidden min-h-[650px]",
              mobilePanel !== "center" && "hidden xl:flex"
            )}
          >
            {/* Header */}
            <div className="px-4 py-3.5 border-b border-white/[0.07] flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-white truncate">
                  {activeConversation ? activeConversation.title : "New Collaboration"}
                </h2>
                <p className="text-xs text-zinc-400">
                  {activeTask
                    ? "Ask questions anytime or modify requirements as your goals evolve"
                    : "Share what you'd like to accomplish to draft an editable plan"}
                </p>
              </div>
              {busyTaskId && (
                <Badge tone="cyan" className="shrink-0">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Working
                </Badge>
              )}
            </div>

            {/* Separated Workflow Notifications Bar (keeps chat clean & natural) */}
            {workflowUpdates.length > 0 && (
              <div className="border-b border-white/[0.06] bg-[#0e1119]/90 px-4 py-2">
                <button
                  type="button"
                  onClick={() => setShowWorkflowUpdates((v) => !v)}
                  className="w-full flex items-center justify-between gap-2 text-left text-xs text-zinc-300 hover:text-white transition-colors"
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <Bell className="h-3.5 w-3.5 text-[#a79bf9] shrink-0" />
                    <span className="truncate">
                      <strong className="font-medium text-zinc-200">Latest update:</strong>{" "}
                      {latestUpdate?.content.replace(/\*\*/g, "")}
                    </span>
                  </span>
                  <span className="text-[11px] text-zinc-500 inline-flex items-center gap-1 shrink-0">
                    {workflowUpdates.length} update{workflowUpdates.length === 1 ? "" : "s"}
                    {showWorkflowUpdates ? (
                      <ChevronUp className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5" />
                    )}
                  </span>
                </button>

                {showWorkflowUpdates && (
                  <div className="mt-2 pt-2 border-t border-white/[0.06] space-y-1.5 max-h-36 overflow-y-auto pr-1 animate-fade-in">
                    {workflowUpdates
                      .slice()
                      .reverse()
                      .map((upd) => (
                        <div
                          key={upd.id}
                          className="flex items-start justify-between gap-3 text-[11px] text-zinc-400"
                        >
                          <span className="leading-snug">
                            <span className="text-zinc-200 font-medium mr-1">
                              {upd.senderName}:
                            </span>
                            {upd.content.replace(/\*\*/g, "")}
                          </span>
                          <span className="text-zinc-500 shrink-0">
                            {formatRelativeTime(upd.createdAt)}
                          </span>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            )}

            {/* Live Progress Indicator while Agent is Working */}
            {(activeRunningStep || activeTask?.status === "planning") && (
              <div className="border-b border-cyan-400/20 bg-cyan-500/[0.06] px-4 py-2.5 flex items-center gap-2.5 text-xs text-cyan-100">
                <AgentAvatar
                  role={
                    activeRunningStep
                      ? activeRunningStep.assignedAgent
                      : "planning-agent"
                  }
                  size="xs"
                />
                <span className="flex-1 truncate">
                  {activeRunningStep
                    ? `${getAgentStyle(activeRunningStep.assignedAgent).label} is working on Step ${
                        activeRunningStep.order + 1
                      }: ${activeRunningStep.title}`
                    : "Planning Agent is organising your goal into clear steps..."}
                </span>
                <Loader2 className="h-3.5 w-3.5 animate-spin text-cyan-300 shrink-0" />
              </div>
            )}

            {/* Natural Conversation Stream */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 max-h-[500px]">
              {conversationMessages.length === 0 ? (
                <div className="py-16 px-4 text-center space-y-5">
                  <div className="flex justify-center gap-2">
                    <AgentAvatar role="planning-agent" size="md" />
                    <AgentAvatar role="research-agent" size="md" />
                    <AgentAvatar role="execution-agent" size="md" />
                  </div>
                  <div className="space-y-1.5 max-w-sm mx-auto">
                    <h3 className="text-base font-semibold text-white">
                      What would you like to work on together?
                    </h3>
                    <p className="text-xs text-zinc-400 leading-relaxed">
                      Tell the Planning Agent your goal below. You&apos;ll be able to review,
                      edit, and approve the plan before anything runs.
                    </p>
                  </div>
                  <div className="flex flex-wrap justify-center gap-2">
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() =>
                        startCollaboration("Prepare a research report about renewable energy.")
                      }
                    >
                      Try Renewable Energy Demo
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => startMidTaskPivotDemo()}
                    >
                      Try Mid-Task Pivot Demo
                    </Button>
                  </div>
                </div>
              ) : (
                conversationMessages.map((msg) => {
                  const isHuman = msg.senderRole === "human";
                  const isApproval = msg.messageType === "approval_request";
                  const isArtifact = msg.messageType === "artifact";
                  const style = getAgentStyle(msg.senderRole);

                  return (
                    <div
                      key={msg.id}
                      className={cn(
                        "flex flex-col gap-1.5 animate-fade-in",
                        isHuman ? "items-end" : "items-start"
                      )}
                    >
                      <div className="flex items-center gap-2 px-0.5">
                        {!isHuman && <AgentAvatar role={msg.senderRole} size="xs" />}
                        <span
                          className={cn(
                            "text-xs font-medium",
                            isHuman ? "text-zinc-300" : style.text
                          )}
                        >
                          {isHuman ? "You" : msg.senderName}
                        </span>
                        <span className="text-[11px] text-zinc-500">
                          {formatRelativeTime(msg.createdAt)}
                        </span>
                      </div>

                      <div
                        className={cn(
                          "rounded-2xl px-4 py-3 text-xs leading-relaxed max-w-[92%] border",
                          isHuman
                            ? "bg-[#8b7cf6]/16 border-[#8b7cf6]/30 text-white rounded-tr-sm"
                            : isApproval
                            ? "bg-amber-500/[0.09] border-amber-400/30 text-amber-50 rounded-tl-sm"
                            : isArtifact
                            ? "bg-[#0e1119] border-emerald-400/30 text-zinc-100 rounded-tl-sm"
                            : "bg-surface-elevated border-white/[0.08] text-zinc-200 rounded-tl-sm"
                        )}
                      >
                        {isArtifact && (
                          <div className="flex items-center justify-between mb-2.5 pb-2 border-b border-white/[0.08]">
                            <Badge tone="emerald">Final Deliverable</Badge>
                            <Button
                              size="xs"
                              variant="cyan"
                              onClick={() =>
                                downloadTextFile(
                                  "relay-ai-report.md",
                                  msg.content,
                                  "text/markdown;charset=utf-8"
                                )
                              }
                            >
                              <Download className="h-3 w-3" /> Export .md
                            </Button>
                          </div>
                        )}

                        <MarkdownMessage content={msg.content} />

                        {msg.attachments && msg.attachments.length > 0 && (
                          <div className="mt-2 pt-2 border-t border-white/10 flex flex-wrap gap-1.5">
                            {msg.attachments.map((att) => (
                              <Badge key={att.id} tone="neutral">
                                <Paperclip className="h-2.5 w-2.5" />
                                {att.name}
                              </Badge>
                            ))}
                          </div>
                        )}

                        {isApproval &&
                          taskPendingApproval &&
                          msg.approvalId === taskPendingApproval.id && (
                            <div className="mt-3 pt-2.5 border-t border-amber-400/25 flex flex-wrap gap-2">
                              <Button
                                size="xs"
                                variant="success"
                                onClick={() =>
                                  decideApproval(taskPendingApproval.id, "approved")
                                }
                              >
                                <Check className="h-3 w-3" /> Approve
                              </Button>
                              <Link href="/approvals">
                                <Button size="xs" variant="warning">
                                  Review Reasons &amp; Risks
                                </Button>
                              </Link>
                            </div>
                          )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Simple, Comfortable Message Composer */}
            <form
              onSubmit={handleSubmitChat}
              className="p-3.5 border-t border-white/[0.07] bg-[#0e1119] space-y-2.5"
            >
              {activeTask &&
                activeTask.status !== "completed" &&
                activeTask.status !== "cancelled" && (
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex gap-1 bg-background p-0.5 rounded-lg border border-white/[0.08]">
                      <button
                        type="button"
                        onClick={() => setComposerMode("modify")}
                        className={cn(
                          "px-2.5 py-1 rounded-md text-xs font-medium transition-colors",
                          composerMode === "modify"
                            ? "bg-[#7c6ce8] text-white"
                            : "text-zinc-400 hover:text-white"
                        )}
                      >
                        Modify Requirements
                      </button>
                      <button
                        type="button"
                        onClick={() => setComposerMode("clarify")}
                        className={cn(
                          "px-2.5 py-1 rounded-md text-xs font-medium transition-colors",
                          composerMode === "clarify"
                            ? "bg-cyan-600/80 text-white"
                            : "text-zinc-400 hover:text-white"
                        )}
                      >
                        Ask a Question
                      </button>
                    </div>
                    <span className="text-[11px] text-zinc-500">
                      {composerMode === "clarify"
                        ? "Gets an answer without changing your plan"
                        : activeTask.planApproved
                        ? "Pauses work and asks for review before resuming"
                        : "Updates steps while protecting locked items"}
                    </span>
                  </div>
                )}

              {attachments.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {attachments.map((att) => (
                    <span
                      key={att.id}
                      className="inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-md bg-white/[0.06] border border-white/10 text-zinc-200"
                    >
                      <Paperclip className="h-3 w-3" />
                      {att.name}
                      <button
                        type="button"
                        onClick={() =>
                          setAttachments((prev) => prev.filter((a) => a.id !== att.id))
                        }
                      >
                        <X className="h-3 w-3 hover:text-white" />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              <div className="flex items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".txt,.md,.json,.csv"
                  className="hidden"
                  onChange={handleFileSelect}
                />
                <Tooltip label="Attach context file (.txt, .md, .csv, .json)">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Attach file"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Paperclip className="h-4 w-4 text-zinc-400" />
                  </Button>
                </Tooltip>
                <Input
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  placeholder={
                    !activeTask
                      ? 'Describe your goal (e.g. "Prepare a research report about renewable energy.")'
                      : composerMode === "clarify"
                      ? "Ask a question about any step or decision..."
                      : "Describe what you'd like to change or prioritize..."
                  }
                  disabled={
                    Boolean(busyTaskId) &&
                    activeTask?.status !== "running" &&
                    composerMode !== "clarify"
                  }
                />
                <Button
                  type="submit"
                  variant={composerMode === "clarify" ? "cyan" : "primary"}
                  size="md"
                  disabled={
                    !inputText.trim() ||
                    (Boolean(busyTaskId) &&
                      activeTask?.status !== "running" &&
                      composerMode !== "clarify")
                  }
                >
                  <Send className="h-4 w-4" />
                  <span className="hidden sm:inline">Send</span>
                </Button>
              </div>
            </form>
          </div>

          {/* ================= RIGHT: CURRENT TASK PLAN & REVIEW ================= */}
          <div
            className={cn(
              "xl:col-span-4 space-y-4",
              mobilePanel !== "right" && "hidden xl:block"
            )}
          >
            {!activeTask ? (
              <div className="panel-surface rounded-xl p-8 text-center space-y-2">
                <h3 className="text-sm font-semibold text-white">Current Task Plan</h3>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  Once you share a goal, the Planning Agent will lay out editable steps,
                  progress, and review points here.
                </p>
              </div>
            ) : (
              <>
                {/* Human-Centred Approval Card */}
                {taskPendingApproval ? (
                  <div className="rounded-xl bg-amber-500/[0.09] border border-amber-400/35 p-4 space-y-3 animate-fade-in">
                    <div className="flex items-start gap-2.5">
                      <ShieldAlert className="h-4 w-4 text-amber-300 shrink-0 mt-0.5" />
                      <div className="space-y-1 min-w-0">
                        <p className="text-xs font-semibold text-amber-200">
                          Your review is needed
                        </p>
                        <p className="text-xs text-zinc-200 leading-relaxed">
                          The agent has prepared the next step:{" "}
                          <strong className="text-white">
                            {taskPendingApproval.actionTitle}
                          </strong>
                          . Please review the recommendation before continuing.
                        </p>
                        {taskPendingApproval.potentialRisks[0] && (
                          <p className="text-[11px] text-amber-100/80">
                            Key risk to consider: {taskPendingApproval.potentialRisks[0]}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="xs"
                        variant="success"
                        onClick={() => decideApproval(taskPendingApproval.id, "approved")}
                      >
                        <Check className="h-3 w-3" /> Approve
                      </Button>
                      <Button
                        size="xs"
                        variant="danger"
                        onClick={() =>
                          decideApproval(
                            taskPendingApproval.id,
                            "rejected",
                            "Please use an alternative approach",
                            taskPendingApproval.alternativeActions[0]
                          )
                        }
                      >
                        <X className="h-3 w-3" /> Reject
                      </Button>
                      <Link href="/approvals">
                        <Button size="xs" variant="secondary">
                          Edit or Ask Agent
                        </Button>
                      </Link>
                    </div>
                  </div>
                ) : (
                  <div className="panel-surface rounded-xl px-4 py-3 flex items-center justify-between text-xs">
                    <span className="text-zinc-400">Status</span>
                    <StatusBadge status={activeTask.status} />
                  </div>
                )}

                {/* Task Plan Card */}
                <div className="panel-surface rounded-xl p-4 space-y-3.5">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <h2 className="text-sm font-semibold text-white">
                        Task Plan ({activeTask.steps.length} steps)
                      </h2>
                      <p className="text-xs text-zinc-500">
                        {activeTask.status === "awaiting_plan_approval"
                          ? "Your plan is ready for review."
                          : "Edit, lock, reorder, or add steps anytime"}
                      </p>
                    </div>
                    <Button
                      size="xs"
                      variant="secondary"
                      onClick={() => setAddingStep((s) => !s)}
                    >
                      <Plus className="h-3 w-3" /> Add Step
                    </Button>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs text-zinc-400">
                      <span>Progress</span>
                      <span className="font-mono text-zinc-200">{activeTask.progress}%</span>
                    </div>
                    <ProgressBar value={activeTask.progress} />
                  </div>

                  {addingStep && (
                    <form
                      onSubmit={handleAddStep}
                      className="rounded-lg bg-[#0e1119] border border-white/10 p-3 space-y-2 animate-fade-in"
                    >
                      <Input
                        value={newStepTitle}
                        onChange={(e) => setNewStepTitle(e.target.value)}
                        placeholder="Step title..."
                        required
                      />
                      <Textarea
                        rows={2}
                        value={newStepDesc}
                        onChange={(e) => setNewStepDesc(e.target.value)}
                        placeholder="What should happen in this step?"
                      />
                      <div className="flex items-center justify-between">
                        <select
                          value={newStepPriority}
                          onChange={(e) =>
                            setNewStepPriority(e.target.value as StepPriority)
                          }
                          className="rounded-md bg-background border border-white/10 px-2 py-1 text-xs text-zinc-200"
                        >
                          <option value="high">High priority</option>
                          <option value="medium">Medium priority</option>
                          <option value="low">Low priority</option>
                        </select>
                        <div className="flex gap-1.5">
                          <Button
                            type="button"
                            size="xs"
                            variant="ghost"
                            onClick={() => setAddingStep(false)}
                          >
                            Cancel
                          </Button>
                          <Button type="submit" size="xs" variant="primary">
                            Save
                          </Button>
                        </div>
                      </div>
                    </form>
                  )}

                  {/* Step List */}
                  <div className="space-y-2 max-h-[380px] overflow-y-auto pr-1">
                    {activeTask.steps.map((step, idx) => {
                      const isEditing = editingStepId === step.id;
                      const isExpanded = Boolean(expandedStepIds[step.id]);
                      const agStyle = getAgentStyle(step.assignedAgent);

                      return (
                        <div
                          key={step.id}
                          className={cn(
                            "rounded-lg border p-3 space-y-2 transition-colors",
                            step.status === "running"
                              ? "bg-cyan-500/[0.07] border-cyan-400/35"
                              : step.status === "waiting_for_approval"
                              ? "bg-amber-500/[0.08] border-amber-400/35"
                              : step.status === "completed"
                              ? "bg-emerald-500/[0.05] border-emerald-400/20"
                              : "bg-[#0e1119] border-white/[0.07]"
                          )}
                        >
                          {isEditing ? (
                            <div className="space-y-2">
                              <Input
                                value={editTitle}
                                onChange={(e) => setEditTitle(e.target.value)}
                              />
                              <Textarea
                                rows={2}
                                value={editDesc}
                                onChange={(e) => setEditDesc(e.target.value)}
                              />
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                  <select
                                    value={editPriority}
                                    onChange={(e) =>
                                      setEditPriority(e.target.value as StepPriority)
                                    }
                                    className="rounded-md bg-background border border-white/10 px-2 py-1 text-xs text-zinc-200"
                                  >
                                    <option value="high">High</option>
                                    <option value="medium">Medium</option>
                                    <option value="low">Low</option>
                                  </select>
                                  <label className="inline-flex items-center gap-1.5 text-xs text-zinc-300 cursor-pointer">
                                    <input
                                      type="checkbox"
                                      checked={editReqApproval}
                                      onChange={(e) => setEditReqApproval(e.target.checked)}
                                    />
                                    Review checkpoint
                                  </label>
                                </div>
                                <div className="flex gap-1.5">
                                  <Button
                                    size="xs"
                                    variant="ghost"
                                    onClick={() => setEditingStepId(null)}
                                  >
                                    Cancel
                                  </Button>
                                  <Button size="xs" variant="primary" onClick={saveEditStep}>
                                    Save
                                  </Button>
                                </div>
                              </div>
                            </div>
                          ) : (
                            <>
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0 space-y-0.5">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="text-[11px] font-mono text-zinc-500">
                                      {idx + 1}.
                                    </span>
                                    <span className="text-xs font-medium text-white">
                                      {step.title}
                                    </span>
                                  </div>
                                  <p className="text-[11px] text-zinc-400 leading-snug">
                                    {step.description}
                                  </p>
                                </div>
                                <StatusBadge status={step.status} />
                              </div>

                              <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-white/[0.06]">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span
                                    className={cn(
                                      "text-[10px] font-medium px-2 py-0.5 rounded-full border",
                                      agStyle.pill
                                    )}
                                  >
                                    {agStyle.shortLabel}
                                  </span>
                                  {step.requiresApproval && (
                                    <Badge tone="amber" className="text-[10px] py-0">
                                      Review Point
                                    </Badge>
                                  )}
                                  {step.editedByHuman && (
                                    <Badge tone="cyan" className="text-[10px] py-0">
                                      Edited
                                    </Badge>
                                  )}
                                </div>

                                <div className="flex items-center gap-0.5">
                                  <Tooltip label={step.isLocked ? "Unlock step" : "Lock step"}>
                                    <button
                                      type="button"
                                      aria-label={step.isLocked ? "Unlock step" : "Lock step"}
                                      onClick={() =>
                                        mutatePlan(activeTask.id, {
                                          type: "toggle_lock",
                                          stepId: step.id,
                                        })
                                      }
                                      className={cn(
                                        "p-1 rounded hover:bg-white/10 transition-colors",
                                        step.isLocked ? "text-cyan-300" : "text-zinc-500"
                                      )}
                                    >
                                      {step.isLocked ? (
                                        <Lock className="h-3 w-3" />
                                      ) : (
                                        <Unlock className="h-3 w-3" />
                                      )}
                                    </button>
                                  </Tooltip>
                                  <Tooltip label="Edit step">
                                    <button
                                      type="button"
                                      aria-label="Edit step"
                                      disabled={step.isLocked || step.status === "running"}
                                      onClick={() => startEditStep(step)}
                                      className="p-1 rounded text-zinc-400 hover:text-white hover:bg-white/10 disabled:opacity-30 transition-colors"
                                    >
                                      <Edit3 className="h-3 w-3" />
                                    </button>
                                  </Tooltip>
                                  <Tooltip label="Move up">
                                    <button
                                      type="button"
                                      aria-label="Move up"
                                      disabled={idx === 0 || step.isLocked}
                                      onClick={() =>
                                        mutatePlan(activeTask.id, {
                                          type: "reorder",
                                          stepId: step.id,
                                          direction: "up",
                                        })
                                      }
                                      className="p-1 rounded text-zinc-400 hover:text-white hover:bg-white/10 disabled:opacity-30 transition-colors"
                                    >
                                      <ArrowUp className="h-3 w-3" />
                                    </button>
                                  </Tooltip>
                                  <Tooltip label="Move down">
                                    <button
                                      type="button"
                                      aria-label="Move down"
                                      disabled={
                                        idx === activeTask.steps.length - 1 || step.isLocked
                                      }
                                      onClick={() =>
                                        mutatePlan(activeTask.id, {
                                          type: "reorder",
                                          stepId: step.id,
                                          direction: "down",
                                        })
                                      }
                                      className="p-1 rounded text-zinc-400 hover:text-white hover:bg-white/10 disabled:opacity-30 transition-colors"
                                    >
                                      <ArrowDown className="h-3 w-3" />
                                    </button>
                                  </Tooltip>
                                  <Tooltip label="Remove step">
                                    <button
                                      type="button"
                                      aria-label="Remove step"
                                      disabled={step.isLocked || step.status === "running"}
                                      onClick={() =>
                                        mutatePlan(activeTask.id, {
                                          type: "delete",
                                          stepId: step.id,
                                        })
                                      }
                                      className="p-1 rounded text-zinc-500 hover:text-rose-400 hover:bg-rose-500/10 disabled:opacity-30 transition-colors"
                                    >
                                      <Trash2 className="h-3 w-3" />
                                    </button>
                                  </Tooltip>
                                  {step.status === "failed" && (
                                    <Button
                                      size="xs"
                                      variant="warning"
                                      onClick={() => skipFailedStep(activeTask.id, step.id)}
                                    >
                                      Skip
                                    </Button>
                                  )}
                                  {step.output && (
                                    <Tooltip label="View step output">
                                      <button
                                        type="button"
                                        aria-label="Toggle step output"
                                        onClick={() =>
                                          setExpandedStepIds((prev) => ({
                                            ...prev,
                                            [step.id]: !prev[step.id],
                                          }))
                                        }
                                        className="p-1 rounded text-emerald-300 hover:bg-emerald-500/10 transition-colors"
                                      >
                                        {isExpanded ? (
                                          <ChevronUp className="h-3.5 w-3.5" />
                                        ) : (
                                          <ChevronDown className="h-3.5 w-3.5" />
                                        )}
                                      </button>
                                    </Tooltip>
                                  )}
                                </div>
                              </div>

                              {isExpanded && step.output && (
                                <div className="rounded-md bg-background border border-white/[0.08] p-2.5 text-[11px] text-zinc-300 max-h-40 overflow-y-auto">
                                  <MarkdownMessage content={step.output} />
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Plan Review Action Bar */}
                  {activeTask.status === "awaiting_plan_approval" && (
                    <div className="pt-2.5 border-t border-white/[0.07] space-y-2">
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="primary"
                          size="sm"
                          className="flex-1"
                          disabled={Boolean(busyTaskId)}
                          onClick={() => approvePlanAndExecute(activeTask.id)}
                        >
                          <CheckCircle2 className="h-4 w-4" />
                          {activeTask.lastRequirementChange?.requiresReapproval
                            ? "Approve Updated Plan"
                            : "Approve & Start"}
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => setShowModInput((s) => !s)}
                        >
                          Modify
                        </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() =>
                            rejectPlan(activeTask.id, "Needs a few adjustments first")
                          }
                        >
                          Hold
                        </Button>
                      </div>

                      {showModInput && (
                        <div className="flex gap-1.5 animate-fade-in">
                          <Input
                            value={modPrompt}
                            onChange={(e) => setModPrompt(e.target.value)}
                            placeholder="Tell Planning Agent what to change..."
                          />
                          <Button
                            size="sm"
                            variant="cyan"
                            disabled={!modPrompt.trim() || Boolean(busyTaskId)}
                            onClick={async () => {
                              await adaptPlanWithFeedback(activeTask.id, modPrompt);
                              setModPrompt("");
                              setShowModInput(false);
                            }}
                          >
                            Update
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Collapsible Plan Rationale & Alternatives */}
                <div className="panel-surface rounded-xl p-4 space-y-2.5">
                  <button
                    type="button"
                    onClick={() => setShowAlternatives((v) => !v)}
                    className="w-full flex items-center justify-between text-left"
                  >
                    <span className="text-xs font-semibold text-zinc-200">
                      Plan Rationale &amp; Alternatives ({activeTask.alternatives.length})
                    </span>
                    {showAlternatives ? (
                      <ChevronUp className="h-4 w-4 text-zinc-400" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-zinc-400" />
                    )}
                  </button>

                  {showAlternatives && (
                    <div className="space-y-3 pt-1 animate-fade-in">
                      <p className="text-xs text-zinc-400 leading-relaxed">
                        {activeTask.reasoningSummary}
                      </p>

                      {activeTask.alternatives.length > 0 && (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] font-medium text-zinc-400">
                              Other approaches you can switch to
                            </span>
                            <Button
                              size="xs"
                              variant="ghost"
                              onClick={() => setShowComparePlans((v) => !v)}
                            >
                              {showComparePlans ? "Hide Table" : "Compare Plans"}
                            </Button>
                          </div>

                          {showComparePlans && (
                            <div className="overflow-x-auto rounded-lg border border-white/10 bg-[#0e1119]">
                              <table className="w-full text-[11px] text-left border-collapse">
                                <thead>
                                  <tr className="border-b border-white/10 text-zinc-400">
                                    <th className="p-2">Option</th>
                                    <th className="p-2">Steps</th>
                                    <th className="p-2">Trade-off</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-white/[0.06]">
                                  <tr>
                                    <td className="p-2 font-medium text-white">Current</td>
                                    <td className="p-2 font-mono">{activeTask.steps.length}</td>
                                    <td className="p-2 text-zinc-400">Balanced scope</td>
                                  </tr>
                                  {activeTask.alternatives.map((alt) => (
                                    <tr key={alt.id}>
                                      <td className="p-2 text-cyan-300">{alt.title}</td>
                                      <td className="p-2 font-mono">
                                        {alt.estimatedSteps ?? activeTask.steps.length}
                                      </td>
                                      <td className="p-2 text-zinc-400">{alt.tradeoff}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}

                          {activeTask.alternatives.map((alt) => (
                            <div
                              key={alt.id}
                              className="rounded-lg bg-[#0e1119] border border-white/[0.07] p-2.5 space-y-1"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-xs font-medium text-zinc-100">
                                  {alt.title}
                                </span>
                                <Button
                                  size="xs"
                                  variant="secondary"
                                  disabled={Boolean(busyTaskId)}
                                  onClick={() =>
                                    adaptPlanWithFeedback(
                                      activeTask.id,
                                      `Switch approach to: ${alt.title} — ${alt.description}`
                                    )
                                  }
                                >
                                  Use This
                                </Button>
                              </div>
                              <p className="text-[11px] text-zinc-400">{alt.description}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Collapsible Agent Handoffs */}
                {activeTask.sharedContext &&
                  activeTask.sharedContext.handoffs.length > 0 && (
                    <div className="panel-surface rounded-xl p-4 space-y-2.5">
                      <button
                        type="button"
                        onClick={() => setShowHandoffs((v) => !v)}
                        className="w-full flex items-center justify-between text-left"
                      >
                        <span className="text-xs font-semibold text-zinc-200">
                          Agent Handoffs ({activeTask.sharedContext.handoffs.length})
                        </span>
                        {showHandoffs ? (
                          <ChevronUp className="h-4 w-4 text-zinc-400" />
                        ) : (
                          <ChevronDown className="h-4 w-4 text-zinc-400" />
                        )}
                      </button>

                      {showHandoffs && (
                        <div className="space-y-2 pt-1 max-h-48 overflow-y-auto pr-1 animate-fade-in">
                          {activeTask.sharedContext.handoffs.map((h) => (
                            <div
                              key={h.id}
                              className="rounded-lg bg-[#0e1119] border border-white/[0.06] p-2.5 text-xs space-y-1"
                            >
                              <div className="flex justify-between text-[11px]">
                                <span className="font-medium text-[#c5bcff]">
                                  {getAgentStyle(h.fromAgent).label} →{" "}
                                  {getAgentStyle(h.toAgent).label}
                                </span>
                                <span className="text-zinc-500">
                                  {formatRelativeTime(h.createdAt)}
                                </span>
                              </div>
                              <p className="text-zinc-400 leading-relaxed">{h.summary}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
              </>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
