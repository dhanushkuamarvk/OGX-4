"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import {
  Activity,
  ArrowRight,
  Bot,
  CheckCircle2,
  CheckSquare,
  Clock,
  FolderKanban,
  Plus,
  RefreshCw,
} from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { useRelayStore } from "@/hooks/useRelayStore";
import {
  AgentAvatar,
  Button,
  Card,
  EmptyState,
  Input,
  ProgressBar,
  StatusBadge,
  getHumanStatusMeta,
} from "@/components/ui/primitives";
import { formatRelativeTime } from "@/lib/utils/cn";

export default function DashboardPage() {
  const router = useRouter();
  const {
    agents,
    tasks,
    approvals,
    activities,
    isHydrated,
    startCollaboration,
    startMidTaskPivotDemo,
    setActiveConversationId,
  } = useRelayStore();

  const [quickObjective, setQuickObjective] = useState("");
  const [creating, setCreating] = useState(false);

  const activeWorkflowsCount = tasks.filter(
    (t) =>
      t.status === "running" ||
      t.status === "planning" ||
      t.status === "awaiting_plan_approval" ||
      t.status === "waiting_for_approval" ||
      t.status === "paused"
  ).length;
  const completedTasksCount = tasks.filter((t) => t.status === "completed").length;
  const pendingApprovalsCount = approvals.filter((a) => a.status === "pending").length;
  const availableAgentsCount = agents.filter(
    (a) => a.status !== "offline" && a.status !== "paused"
  ).length;

  const latestActiveTask = useMemo(
    () =>
      tasks.find(
        (t) =>
          t.status !== "completed" && t.status !== "cancelled"
      ) ?? tasks[0] ?? null,
    [tasks]
  );

  const stepBreakdownData = useMemo(() => {
    const allSteps = tasks.flatMap((t) => t.steps);
    return [
      {
        stage: "Completed",
        Steps: allSteps.filter((s) => s.status === "completed").length,
      },
      {
        stage: "In Progress",
        Steps: allSteps.filter((s) => s.status === "running").length,
      },
      {
        stage: "Needs Review",
        Steps: allSteps.filter((s) => s.status === "waiting_for_approval").length,
      },
      {
        stage: "Up Next",
        Steps: allSteps.filter((s) => s.status === "pending").length,
      },
    ];
  }, [tasks]);

  async function handleQuickCreate(objectiveText: string) {
    if (!objectiveText.trim() || creating) return;
    setCreating(true);
    try {
      await startCollaboration(objectiveText.trim());
      setQuickObjective("");
      router.push("/workspace");
    } finally {
      setCreating(false);
    }
  }

  return (
    <AppShell
      title="Dashboard"
      subtitle="Overview of your workflows, approvals, and available agents"
      actions={
        <Button
          variant="primary"
          size="sm"
          disabled={creating}
          onClick={() => router.push("/workspace")}
        >
          <Plus className="h-4 w-4" />
          New Workflow
        </Button>
      }
    >
      <div className="space-y-6">
        {/* Welcoming Greeting Header */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
          <div className="space-y-1">
            <h2 className="text-2xl font-semibold tracking-tight text-white">
              Welcome back
            </h2>
            <p className="text-sm text-zinc-400">
              Here&apos;s what&apos;s happening with your workflows.
            </p>
          </div>
          {pendingApprovalsCount > 0 && (
            <Link href="/approvals">
              <Button variant="warning" size="sm">
                <CheckSquare className="h-3.5 w-3.5" />
                {pendingApprovalsCount} item{pendingApprovalsCount === 1 ? "" : "s"} waiting for your review
              </Button>
            </Link>
          )}
        </div>

        {/* 4 Clean Summary Metrics */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="space-y-2">
            <div className="flex items-center justify-between text-xs text-zinc-400">
              <span>Active Workflows</span>
              <Activity className="h-4 w-4 text-cyan-300" />
            </div>
            <p className="text-3xl font-semibold text-white">{activeWorkflowsCount}</p>
            <p className="text-xs text-zinc-500">
              {tasks.length === 0 ? "None started yet" : `${tasks.length} total created`}
            </p>
          </Card>

          <Card className="space-y-2">
            <div className="flex items-center justify-between text-xs text-zinc-400">
              <span>Completed Tasks</span>
              <CheckCircle2 className="h-4 w-4 text-emerald-300" />
            </div>
            <p className="text-3xl font-semibold text-white">{completedTasksCount}</p>
            <p className="text-xs text-zinc-500">Finished deliverables</p>
          </Card>

          <Card
            className={`space-y-2 ${
              pendingApprovalsCount > 0 ? "border-amber-400/35" : ""
            }`}
          >
            <div className="flex items-center justify-between text-xs text-zinc-400">
              <span>Pending Approvals</span>
              <CheckSquare className="h-4 w-4 text-amber-300" />
            </div>
            <p className="text-3xl font-semibold text-white">{pendingApprovalsCount}</p>
            <Link
              href="/approvals"
              className="inline-flex items-center gap-1 text-xs text-amber-300 hover:underline"
            >
              {pendingApprovalsCount > 0 ? "Review now" : "Open Approvals"}
              <ArrowRight className="h-3 w-3" />
            </Link>
          </Card>

          <Card className="space-y-2">
            <div className="flex items-center justify-between text-xs text-zinc-400">
              <span>Available Agents</span>
              <Bot className="h-4 w-4 text-[#a79bf9]" />
            </div>
            <p className="text-3xl font-semibold text-white">
              {availableAgentsCount}
              <span className="text-sm font-normal text-zinc-500"> / {agents.length}</span>
            </p>
            <Link
              href="/agents"
              className="inline-flex items-center gap-1 text-xs text-zinc-400 hover:text-white transition-colors"
            >
              Configure agents
              <ArrowRight className="h-3 w-3" />
            </Link>
          </Card>
        </div>

        {/* Start a Collaborative Workflow */}
        <Card className="space-y-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-white">
                Start a new collaboration
              </h3>
              <p className="text-xs text-zinc-400">
                Describe your goal and the Planning Agent will prepare an editable step-by-step plan.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                size="xs"
                disabled={creating}
                onClick={() =>
                  handleQuickCreate("Prepare a research report about renewable energy.")
                }
              >
                Renewable Energy Demo
              </Button>
              <Button
                variant="cyan"
                size="xs"
                disabled={creating}
                onClick={async () => {
                  setCreating(true);
                  try {
                    await startMidTaskPivotDemo();
                    router.push("/workspace");
                  } finally {
                    setCreating(false);
                  }
                }}
              >
                <RefreshCw className="h-3 w-3" />
                Mid-Task Pivot Demo
              </Button>
            </div>
          </div>

          <form
            className="flex flex-col sm:flex-row gap-2.5"
            onSubmit={(e) => {
              e.preventDefault();
              handleQuickCreate(quickObjective);
            }}
          >
            <Input
              value={quickObjective}
              onChange={(e) => setQuickObjective(e.target.value)}
              placeholder='What would you like to work on? (e.g. "Prepare a research report about renewable energy.")'
            />
            <Button
              type="submit"
              variant="primary"
              disabled={creating || !quickObjective.trim()}
            >
              {creating ? "Drafting plan..." : "Start"}
            </Button>
          </form>
        </Card>

        {/* Main Two-Column Overview */}
        <div className="grid lg:grid-cols-12 gap-5">
          <div className="lg:col-span-7 space-y-5">
            {/* Current Project Progress */}
            <Card className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-white">Current Project Progress</h3>
                <Link href="/workspace" className="text-xs text-[#a79bf9] hover:underline">
                  Open Workspace
                </Link>
              </div>

              {!latestActiveTask ? (
                <EmptyState
                  icon={FolderKanban}
                  title="No workflows in progress yet"
                  description="Start a task above or try one of the guided demos. Your plan, progress, and review checkpoints will appear here."
                  action={
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={creating}
                      onClick={() =>
                        handleQuickCreate("Prepare a research report about renewable energy.")
                      }
                    >
                      Try Renewable Energy Demo
                    </Button>
                  }
                />
              ) : (
                <div className="space-y-3">
                  {tasks.slice(0, 4).map((task) => {
                    const meta = getHumanStatusMeta(task.status);
                    return (
                      <button
                        key={task.id}
                        type="button"
                        onClick={() => {
                          setActiveConversationId(task.conversationId);
                          router.push("/workspace");
                        }}
                        className="w-full text-left rounded-xl bg-[#0e1119] hover:bg-surface-elevated border border-white/[0.07] hover:border-white/14 p-4 space-y-2.5 transition-all duration-150"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-sm font-medium text-white truncate">
                            {task.title}
                          </span>
                          <StatusBadge status={task.status} />
                        </div>
                        <p className="text-xs text-zinc-400">{meta.sentence}</p>
                        <ProgressBar value={task.progress} />
                        <div className="flex items-center justify-between text-[11px] text-zinc-500">
                          <span>
                            {task.steps.filter((s) => s.status === "completed").length} of{" "}
                            {task.steps.length} steps complete
                          </span>
                          <span className="font-mono text-zinc-300">{task.progress}%</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </Card>

            {/* Step Progress Chart */}
            <Card className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-white">Workflow Step Breakdown</h3>
                  <p className="text-xs text-zinc-500">Current distribution across your projects</p>
                </div>
                <Link href="/analytics" className="text-xs text-cyan-300 hover:underline">
                  View Analytics
                </Link>
              </div>
              <div className="h-52 w-full">
                {isHydrated && (
                  <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                    <BarChart data={stepBreakdownData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                      <XAxis dataKey="stage" tick={{ fill: "#a1a1aa", fontSize: 12 }} />
                      <YAxis allowDecimals={false} tick={{ fill: "#a1a1aa", fontSize: 12 }} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "#131620",
                          border: "1px solid rgba(255,255,255,0.1)",
                          borderRadius: "10px",
                          fontSize: "12px",
                        }}
                      />
                      <Bar dataKey="Steps" fill="#8b7cf6" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </Card>
          </div>

          {/* Right Column: Available Agents + Recent Activity */}
          <div className="lg:col-span-5 space-y-5">
            <Card className="space-y-3.5">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-white">Your Agent Team</h3>
                <Link href="/agents" className="text-xs text-zinc-400 hover:text-white">
                  Manage
                </Link>
              </div>
              <div className="space-y-2.5">
                {agents.map((agent) => (
                  <div
                    key={agent.id}
                    className="rounded-lg bg-[#0e1119] border border-white/[0.06] p-3 flex items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <AgentAvatar role={agent.slug} size="md" />
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-white truncate">{agent.name}</p>
                        <p className="text-[11px] text-zinc-400 truncate">
                          {agent.currentTaskLabel || agent.description}
                        </p>
                      </div>
                    </div>
                    <StatusBadge status={agent.status} />
                  </div>
                ))}
              </div>
            </Card>

            <Card className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-white">Recent Activity</h3>
                <Link href="/history" className="text-xs text-zinc-400 hover:text-white">
                  View all
                </Link>
              </div>

              {activities.length === 0 ? (
                <div className="rounded-lg border border-dashed border-white/10 p-8 text-center space-y-1">
                  <p className="text-xs font-medium text-zinc-300">No activity yet</p>
                  <p className="text-xs text-zinc-500">
                    Plans, edits, approvals, and completed steps will show up here as you work.
                  </p>
                </div>
              ) : (
                <div className="space-y-2.5 max-h-[380px] overflow-y-auto pr-1">
                  {activities.slice(0, 10).map((act) => (
                    <div
                      key={act.id}
                      className="rounded-lg bg-[#0e1119] border border-white/[0.06] p-3 space-y-1"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-xs font-medium text-zinc-100">{act.title}</p>
                        <span className="text-[11px] text-zinc-500 flex items-center gap-1 shrink-0">
                          <Clock className="h-3 w-3" />
                          {formatRelativeTime(act.createdAt)}
                        </span>
                      </div>
                      <p className="text-xs text-zinc-400 line-clamp-2">{act.detail}</p>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
