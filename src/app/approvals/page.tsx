"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Edit3,
  HelpCircle,
  Loader2,
  Send,
  ShieldCheck,
  X,
} from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { useRelayStore } from "@/hooks/useRelayStore";
import {
  AgentAvatar,
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  StatusBadge,
  Textarea,
  getAgentStyle,
} from "@/components/ui/primitives";
import { cn, formatRelativeTime } from "@/lib/utils/cn";

export default function ApprovalsPage() {
  const { approvals, tasks, decideApproval, askApprovalQuestion } = useRelayStore();
  const [filter, setFilter] = useState<"pending" | "resolved" | "all">("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editFeedback, setEditFeedback] = useState("");
  const [selectedAltMap, setSelectedAltMap] = useState<Record<string, string>>({});
  const [askOpenId, setAskOpenId] = useState<string | null>(null);
  const [questionMap, setQuestionMap] = useState<Record<string, string>>({});
  const [askingId, setAskingId] = useState<string | null>(null);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const pendingCount = approvals.filter((a) => a.status === "pending").length;
  const filtered = approvals.filter((a) => {
    if (filter === "pending") return a.status === "pending";
    if (filter === "resolved") return a.status !== "pending";
    return true;
  });

  return (
    <AppShell
      title="Approval Center"
      subtitle="Review recommendations, understand risks, and guide what happens next"
      actions={
        <Link href="/workspace">
          <Button variant="secondary" size="sm">
            Back to Workspace
          </Button>
        </Link>
      }
    >
      <div className="space-y-6">
        {/* Filter Pills */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-1 bg-surface p-1 rounded-lg border border-white/[0.08]">
            {[
              { id: "all" as const, label: `All (${approvals.length})` },
              { id: "pending" as const, label: `Waiting for Review (${pendingCount})` },
              {
                id: "resolved" as const,
                label: `Decided (${approvals.length - pendingCount})`,
              },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilter(tab.id)}
                className={cn(
                  "px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                  filter === tab.id
                    ? "bg-[#7c6ce8] text-white"
                    : "text-zinc-400 hover:text-white"
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
          {pendingCount > 0 && (
            <Badge tone="amber">
              {pendingCount} recommendation{pendingCount === 1 ? "" : "s"} waiting for your review
            </Badge>
          )}
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            icon={CheckCircle2}
            title={
              approvals.length === 0
                ? "You're all caught up"
                : "No approvals in this view"
            }
            description="When an agent prepares an important decision in Workspace, it will pause automatically and share the recommendation, reasons, and relevant risks here."
            action={
              <Link href="/workspace">
                <Button variant="primary" size="sm">
                  Open Workspace
                </Button>
              </Link>
            }
          />
        ) : (
          <div className="space-y-5">
            {filtered.map((apr) => {
              const linkedTask = tasks.find((t) => t.id === apr.taskId);
              const isPending = apr.status === "pending";
              const chosenAlt = selectedAltMap[apr.id] ?? "";
              const agentStyle = getAgentStyle(apr.agentSlug);

              return (
                <Card
                  key={apr.id}
                  className={cn(
                    "space-y-4 animate-fade-in",
                    isPending && "border-amber-400/40"
                  )}
                >
                  {/* Warm Human-Centred Banner for Pending Items */}
                  {isPending && (
                    <div className="rounded-lg bg-amber-500/[0.08] border border-amber-400/25 px-3.5 py-2.5 flex items-start gap-2.5">
                      <ShieldCheck className="h-4 w-4 text-amber-300 shrink-0 mt-0.5" />
                      <div className="space-y-0.5">
                        <p className="text-xs font-semibold text-amber-200">
                          Your review is needed
                        </p>
                        <p className="text-xs text-zinc-300">
                          The agent has prepared the next step. Please review the
                          recommendation before continuing.
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Header */}
                  <div className="flex flex-wrap items-start justify-between gap-3 pb-3 border-b border-white/[0.07]">
                    <div className="flex items-start gap-3">
                      <AgentAvatar role={apr.agentSlug} size="md" />
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h2 className="text-base font-semibold text-white">
                            {apr.actionTitle}
                          </h2>
                          <StatusBadge status={apr.status} />
                        </div>
                        <p className="text-xs text-zinc-400">
                          Prepared by <span className={agentStyle.text}>{agentStyle.label}</span>{" "}
                          for{" "}
                          <span className="text-zinc-200">
                            {linkedTask?.title ?? apr.taskId}
                          </span>{" "}
                          • {formatRelativeTime(apr.createdAt)}
                        </p>
                      </div>
                    </div>
                    {apr.isSimulated && <Badge tone="amber">Demo Mode</Badge>}
                  </div>

                  {/* Clear 2-Column Decision & Risk Summary */}
                  <div className="grid lg:grid-cols-2 gap-4 text-xs">
                    <div className="space-y-3">
                      <div className="rounded-lg bg-[#0e1119] border border-white/[0.06] p-3.5 space-y-1.5">
                        <p className="font-semibold text-white">What is recommended</p>
                        <p className="text-zinc-300 leading-relaxed">
                          {apr.actionDescription}
                        </p>
                      </div>

                      <div className="rounded-lg bg-[#0e1119] border border-white/[0.06] p-3.5 space-y-1.5">
                        <p className="font-semibold text-[#c5bcff]">
                          Why this is recommended
                        </p>
                        <p className="text-zinc-300 leading-relaxed">
                          {apr.recommendationReason}
                        </p>
                        <p className="text-zinc-400 pt-1">
                          <strong className="text-zinc-200">What happens next:</strong>{" "}
                          {apr.expectedResult}
                        </p>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <div className="rounded-lg bg-amber-500/[0.06] border border-amber-400/20 p-3.5 space-y-1.5">
                        <p className="font-semibold text-amber-200 flex items-center gap-1.5">
                          <AlertTriangle className="h-3.5 w-3.5" />
                          Relevant risks to consider
                        </p>
                        <ul className="space-y-1 text-zinc-300 list-disc pl-4 leading-relaxed">
                          {apr.potentialRisks.map((risk, i) => (
                            <li key={i}>{risk}</li>
                          ))}
                        </ul>
                      </div>

                      <div className="rounded-lg bg-[#0e1119] border border-white/[0.06] p-3.5 space-y-1.5">
                        <p className="font-semibold text-cyan-300">
                          Supporting information
                        </p>
                        <ul className="space-y-1 text-zinc-300 list-disc pl-4 leading-relaxed">
                          {apr.supportingEvidence.map((ev, i) => (
                            <li key={i}>{ev}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </div>

                  {/* Alternative Directions */}
                  {isPending && apr.alternativeActions.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-zinc-400">
                        Prefer a different approach? Select an alternative before deciding:
                      </p>
                      <div className="grid sm:grid-cols-3 gap-2">
                        {apr.alternativeActions.map((alt, i) => (
                          <label
                            key={i}
                            className={cn(
                              "flex items-start gap-2 rounded-lg p-3 text-xs border cursor-pointer transition-all duration-150",
                              chosenAlt === alt
                                ? "bg-[#8b7cf6]/14 border-[#8b7cf6]/45 text-white"
                                : "bg-[#0e1119] border-white/[0.06] text-zinc-300 hover:border-white/15"
                            )}
                          >
                            <input
                              type="radio"
                              name={`alt-${apr.id}`}
                              checked={chosenAlt === alt}
                              onChange={() =>
                                setSelectedAltMap((prev) => ({ ...prev, [apr.id]: alt }))
                              }
                              className="mt-0.5 accent-[#8b7cf6]"
                            />
                            <span className="leading-snug">{alt}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Ask Agent Thread */}
                  {(askOpenId === apr.id || apr.qaThread.length > 0) && (
                    <div className="rounded-lg bg-[#0e1119] border border-cyan-400/25 p-3.5 space-y-2.5 animate-fade-in">
                      <p className="text-xs font-medium text-cyan-300 flex items-center gap-1.5">
                        <HelpCircle className="h-3.5 w-3.5" />
                        Ask {agentStyle.label} before deciding
                      </p>
                      {apr.qaThread.map((qa) => (
                        <div
                          key={qa.id}
                          className="space-y-1 text-xs border-b border-white/[0.06] pb-2"
                        >
                          <p className="text-zinc-200 font-medium">You: {qa.question}</p>
                          <p className="text-zinc-400 leading-relaxed">{qa.answer}</p>
                        </div>
                      ))}
                      {isPending && (
                        <form
                          className="flex gap-2"
                          onSubmit={async (e) => {
                            e.preventDefault();
                            const q = (questionMap[apr.id] ?? "").trim();
                            if (!q) return;
                            setAskingId(apr.id);
                            try {
                              await askApprovalQuestion(apr.id, q);
                              setQuestionMap((prev) => ({ ...prev, [apr.id]: "" }));
                            } finally {
                              setAskingId(null);
                            }
                          }}
                        >
                          <Input
                            value={questionMap[apr.id] ?? ""}
                            onChange={(e) =>
                              setQuestionMap((prev) => ({
                                ...prev,
                                [apr.id]: e.target.value,
                              }))
                            }
                            placeholder="Ask a question about this recommendation or risk..."
                          />
                          <Button
                            type="submit"
                            size="sm"
                            variant="cyan"
                            disabled={askingId === apr.id}
                          >
                            {askingId === apr.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Send className="h-3.5 w-3.5" />
                            )}
                            Ask
                          </Button>
                        </form>
                      )}
                    </div>
                  )}

                  {/* Edit Form */}
                  {isPending && editingId === apr.id && (
                    <div className="rounded-lg bg-[#8b7cf6]/10 border border-[#8b7cf6]/30 p-3.5 space-y-2.5 animate-fade-in">
                      <p className="text-xs font-medium text-[#c5bcff]">
                        Adjust the direction and continue
                      </p>
                      <Textarea
                        rows={2}
                        value={editFeedback}
                        onChange={(e) => setEditFeedback(e.target.value)}
                        placeholder="Describe what you'd like adjusted before the agent continues..."
                      />
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="primary"
                          onClick={() => {
                            decideApproval(
                              apr.id,
                              "edited_and_approved",
                              editFeedback || "Approved with your adjustments",
                              chosenAlt || undefined
                            );
                            setEditingId(null);
                            setEditFeedback("");
                          }}
                        >
                          Save Edits &amp; Approve
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* Reject Form */}
                  {isPending && rejectId === apr.id && (
                    <div className="rounded-lg bg-rose-500/10 border border-rose-400/30 p-3.5 space-y-2.5 animate-fade-in">
                      <p className="text-xs font-medium text-rose-200">
                        Reject and redirect the agent
                      </p>
                      <Input
                        value={rejectReason}
                        onChange={(e) => setRejectReason(e.target.value)}
                        placeholder="Tell the agent what to do instead..."
                      />
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() => {
                            decideApproval(
                              apr.id,
                              "rejected",
                              rejectReason || "Please take an alternative approach",
                              chosenAlt || apr.alternativeActions[0]
                            );
                            setRejectId(null);
                            setRejectReason("");
                          }}
                        >
                          Confirm Reject
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setRejectId(null)}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* Clear Human Actions */}
                  {isPending ? (
                    <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-white/[0.07]">
                      <Button
                        variant="success"
                        size="sm"
                        onClick={() =>
                          decideApproval(apr.id, "approved", undefined, chosenAlt || undefined)
                        }
                      >
                        <Check className="h-4 w-4" /> Approve
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => {
                          setRejectId(apr.id);
                          setEditingId(null);
                        }}
                      >
                        <X className="h-4 w-4" /> Reject
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setEditingId(apr.id);
                          setRejectId(null);
                        }}
                      >
                        <Edit3 className="h-4 w-4" /> Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setAskOpenId((prev) => (prev === apr.id ? null : apr.id))
                        }
                      >
                        <HelpCircle className="h-4 w-4" /> Ask Agent
                      </Button>
                    </div>
                  ) : (
                    <div className="rounded-lg bg-[#0e1119] border border-white/[0.06] px-3.5 py-2.5 text-xs text-zinc-400 flex flex-wrap justify-between gap-2">
                      <span>
                        <strong className="text-zinc-200">Your decision:</strong>{" "}
                        {apr.status.replace(/_/g, " ")}
                        {apr.humanFeedback ? ` — ${apr.humanFeedback}` : ""}
                      </span>
                      <span>{apr.decidedAt ? formatRelativeTime(apr.decidedAt) : ""}</span>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}
