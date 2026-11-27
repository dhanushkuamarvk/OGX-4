"use client";

import React, { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Clock, Download, FileJson, History, Search } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { useRelayStore } from "@/hooks/useRelayStore";
import {
  AgentAvatar,
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  ProgressBar,
  StatusBadge,
} from "@/components/ui/primitives";
import { cn, downloadTextFile, formatRelativeTime } from "@/lib/utils/cn";
import type { ActivityCategory } from "@/types/relay";

const CATEGORY_META: Array<{ id: "all" | ActivityCategory; label: string }> = [
  { id: "all", label: "All" },
  { id: "plan", label: "Plans" },
  { id: "research", label: "Research" },
  { id: "execution", label: "Execution" },
  { id: "approval", label: "Approvals" },
  { id: "human_edit", label: "Your Edits" },
  { id: "state_change", label: "Status Updates" },
  { id: "workflow", label: "Workflows" },
  { id: "evaluation", label: "Evaluations" },
];

function getCategoryLabel(cat: ActivityCategory): string {
  return CATEGORY_META.find((c) => c.id === cat)?.label ?? cat.replace(/_/g, " ");
}

export default function HistoryPage() {
  const router = useRouter();
  const { tasks, activities, setActiveConversationId, pushToast } = useRelayStore();
  const [tab, setTab] = useState<"workflows" | "activity">("workflows");
  const [category, setCategory] = useState<"all" | ActivityCategory>("all");
  const [query, setQuery] = useState("");

  const filteredTasks = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tasks;
    return tasks.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.objective.toLowerCase().includes(q) ||
        t.status.toLowerCase().includes(q)
    );
  }, [tasks, query]);

  const filteredActivities = useMemo(() => {
    const q = query.trim().toLowerCase();
    return activities.filter((a) => {
      if (category !== "all" && a.category !== category) return false;
      if (!q) return true;
      return (
        a.title.toLowerCase().includes(q) ||
        a.detail.toLowerCase().includes(q) ||
        a.agentSlug.toLowerCase().includes(q)
      );
    });
  }, [activities, category, query]);

  function exportCsv() {
    const header = "id,timestamp,agent,category,simulated,title,detail";
    const rows = filteredActivities.map((a) =>
      [
        a.id,
        a.createdAt,
        a.agentSlug,
        a.category,
        a.isSimulated,
        `"${a.title.replace(/"/g, '""')}"`,
        `"${a.detail.replace(/"/g, '""')}"`,
      ].join(",")
    );
    downloadTextFile(
      "relay-ai-history.csv",
      [header, ...rows].join("\n"),
      "text/csv;charset=utf-8"
    );
    pushToast({ tone: "success", title: "Exported activity history as CSV" });
  }

  function exportJson() {
    downloadTextFile(
      "relay-ai-history.json",
      JSON.stringify(filteredActivities, null, 2),
      "application/json"
    );
    pushToast({ tone: "success", title: "Exported activity history as JSON" });
  }

  return (
    <AppShell
      title="Activity History"
      subtitle="Reopen previous workflows or browse the complete collaboration timeline"
      actions={
        <div className="flex gap-2">
          <Button size="xs" variant="secondary" onClick={exportCsv}>
            <Download className="h-3.5 w-3.5" /> Export CSV
          </Button>
          <Button size="xs" variant="secondary" onClick={exportJson}>
            <FileJson className="h-3.5 w-3.5" /> Export JSON
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        {/* View Switcher & Search */}
        <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
          <div className="flex gap-1 bg-surface p-1 rounded-lg border border-white/[0.08] w-fit">
            <button
              type="button"
              onClick={() => setTab("workflows")}
              className={cn(
                "px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                tab === "workflows"
                  ? "bg-[#7c6ce8] text-white"
                  : "text-zinc-400 hover:text-white"
              )}
            >
              Previous Workflows ({tasks.length})
            </button>
            <button
              type="button"
              onClick={() => setTab("activity")}
              className={cn(
                "px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                tab === "activity"
                  ? "bg-[#7c6ce8] text-white"
                  : "text-zinc-400 hover:text-white"
              )}
            >
              Activity Timeline ({activities.length})
            </button>
          </div>

          <div className="relative max-w-xs w-full">
            <Search className="h-4 w-4 text-zinc-500 absolute left-3 top-2.5" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search workflows or events..."
              className="pl-9"
            />
          </div>
        </div>

        {/* Previous Workflows */}
        {tab === "workflows" && (
          <>
            {filteredTasks.length === 0 ? (
              <EmptyState
                icon={History}
                title="No workflows yet"
                description="Once you start a task in Workspace, your projects and progress will be saved here so you can reopen them anytime."
                action={
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => router.push("/workspace")}
                  >
                    Open Workspace
                  </Button>
                }
              />
            ) : (
              <Card className="p-0 overflow-hidden">
                <div className="divide-y divide-white/[0.06]">
                  {filteredTasks.map((task) => (
                    <div
                      key={task.id}
                      className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-white/[0.02] transition-colors"
                    >
                      <div className="space-y-1.5 min-w-0 flex-1">
                        <div className="flex items-center gap-2.5 flex-wrap">
                          <h3 className="text-sm font-medium text-white truncate">
                            {task.title}
                          </h3>
                          <StatusBadge status={task.status} />
                          {task.isSimulated && <Badge tone="amber">Demo</Badge>}
                        </div>
                        <p className="text-xs text-zinc-400 line-clamp-1">{task.objective}</p>
                        <div className="max-w-sm pt-0.5">
                          <ProgressBar value={task.progress} />
                        </div>
                        <p className="text-[11px] text-zinc-500">
                          {task.steps.length} steps • {task.planEditCount} edit
                          {task.planEditCount === 1 ? "" : "s"} • {task.approvalCount} approval
                          {task.approvalCount === 1 ? "" : "s"} •{" "}
                          {formatRelativeTime(task.updatedAt)}
                        </p>
                      </div>
                      <Button
                        size="xs"
                        variant="secondary"
                        onClick={() => {
                          setActiveConversationId(task.conversationId);
                          router.push("/workspace");
                        }}
                      >
                        Reopen
                        <ArrowRight className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </>
        )}

        {/* Activity Timeline */}
        {tab === "activity" && (
          <div className="space-y-3.5">
            <div className="flex flex-wrap gap-1.5">
              {CATEGORY_META.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setCategory(cat.id)}
                  className={cn(
                    "px-2.5 py-1 rounded-full text-xs font-medium border transition-colors",
                    category === cat.id
                      ? "bg-[#8b7cf6]/16 border-[#8b7cf6]/40 text-white"
                      : "bg-surface border-white/[0.07] text-zinc-400 hover:text-white"
                  )}
                >
                  {cat.label}
                </button>
              ))}
            </div>

            {filteredActivities.length === 0 ? (
              <EmptyState
                icon={History}
                title="No activity in this filter"
                description="Try selecting All or run a collaborative workflow in Workspace to populate the timeline."
              />
            ) : (
              <Card className="p-0 overflow-hidden">
                <div className="divide-y divide-white/[0.06]">
                  {filteredActivities.map((act) => (
                    <div
                      key={act.id}
                      className="px-5 py-4 flex flex-col sm:flex-row sm:items-start justify-between gap-3 hover:bg-white/[0.015] transition-colors"
                    >
                      <div className="flex items-start gap-3 min-w-0">
                        <AgentAvatar role={act.agentSlug} size="sm" className="mt-0.5" />
                        <div className="space-y-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-medium text-white">
                              {act.title}
                            </span>
                            <Badge tone="neutral">{getCategoryLabel(act.category)}</Badge>
                          </div>
                          <p className="text-xs text-zinc-400 leading-relaxed">{act.detail}</p>
                        </div>
                      </div>
                      <span className="text-[11px] text-zinc-500 flex items-center gap-1 shrink-0 pl-10 sm:pl-0">
                        <Clock className="h-3 w-3" />
                        {formatRelativeTime(act.createdAt)}
                      </span>
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}
