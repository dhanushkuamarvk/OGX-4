"use client";

import React, { useState } from "react";
import { Pause, Play, Sliders } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { useRelayStore } from "@/hooks/useRelayStore";
import {
  AgentAvatar,
  Badge,
  Button,
  Card,
  ProgressBar,
  StatusBadge,
  getAgentStyle,
} from "@/components/ui/primitives";
import { cn, formatRelativeTime } from "@/lib/utils/cn";
import type { AgentSlug } from "@/types/relay";

export default function AgentsPage() {
  const { agents, activities, toggleAgentActive, updateAgentAutonomy } = useRelayStore();
  const [selectedSlug, setSelectedSlug] = useState<AgentSlug>("planning-agent");

  const selectedAgent = agents.find((a) => a.slug === selectedSlug) ?? agents[0];
  const selectedStyle = getAgentStyle(selectedAgent.slug);
  const agentActivities = activities.filter((act) => act.agentSlug === selectedAgent.slug);
  const selectedOverrideRate =
    selectedAgent.totalDecisions > 0
      ? Math.round((selectedAgent.overrideCount / selectedAgent.totalDecisions) * 100)
      : 0;

  return (
    <AppShell
      title="Agent Manager"
      subtitle="Monitor your agent team and tune how closely each agent checks in with you"
    >
      <div className="space-y-6">
        {/* Three Distinct Agent Cards */}
        <div className="grid md:grid-cols-3 gap-5">
          {agents.map((agent) => {
            const style = getAgentStyle(agent.slug);
            const isSelected = agent.slug === selectedAgent.slug;

            return (
              <Card
                key={agent.id}
                onClick={() => setSelectedSlug(agent.slug)}
                className={cn(
                  "cursor-pointer space-y-4 transition-all duration-150",
                  isSelected && "border-[#8b7cf6]/50 bg-surface-elevated/60"
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <AgentAvatar role={agent.slug} size="md" />
                    <div>
                      <h2 className="text-sm font-semibold text-white">{agent.name}</h2>
                      <p className={cn("text-xs", style.text)}>{style.communicationStyle}</p>
                    </div>
                  </div>
                  <StatusBadge status={agent.status} />
                </div>

                <p className="text-xs text-zinc-300 leading-relaxed">{style.description}</p>

                <div className="rounded-lg bg-[#0e1119] border border-white/[0.06] px-3 py-2.5 space-y-1">
                  <p className="text-[11px] text-zinc-500">Current Focus</p>
                  <p className="text-xs text-zinc-200 truncate">
                    {agent.currentTaskLabel || "Available and ready for your next workflow"}
                  </p>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-white/[0.07]">
                  <span className="text-xs text-zinc-500">
                    {agent.tasksCompleted} completed • {agent.overrideCount} override
                    {agent.overrideCount === 1 ? "" : "s"}
                  </span>
                  <Button
                    size="xs"
                    variant={
                      agent.status === "paused" || agent.status === "offline"
                        ? "success"
                        : "secondary"
                    }
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleAgentActive(agent.slug);
                    }}
                  >
                    {agent.status === "paused" || agent.status === "offline" ? (
                      <>
                        <Play className="h-3 w-3" /> Resume
                      </>
                    ) : (
                      <>
                        <Pause className="h-3 w-3" /> Pause
                      </>
                    )}
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>

        {/* Selected Agent Supervision & Recent Work */}
        <div className="grid lg:grid-cols-12 gap-5">
          <Card className="lg:col-span-5 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <AgentAvatar role={selectedAgent.slug} size="sm" />
                <div>
                  <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                    {selectedAgent.name}
                  </h3>
                  <p className="text-[11px] text-zinc-400">
                    Style: {selectedStyle.communicationStyle}
                  </p>
                </div>
              </div>
              <Badge tone="neutral">Rule-Based</Badge>
            </div>

            <div className="space-y-2 pt-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-zinc-200 flex items-center gap-1.5">
                  <Sliders className="h-3.5 w-3.5 text-[#a79bf9]" />
                  Human-feedback-driven Adaptive Autonomy
                </span>
                <span className="font-mono text-cyan-300 font-medium">
                  {Math.round(selectedAgent.autonomyLevel * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={25}
                max={90}
                value={Math.round(selectedAgent.autonomyLevel * 100)}
                onChange={(e) =>
                  updateAgentAutonomy(selectedAgent.slug, Number(e.target.value) / 100)
                }
                className="w-full accent-[#8b7cf6] cursor-pointer"
              />
              <div className="flex justify-between text-[11px] text-zinc-500">
                <span>Check in more often (25%)</span>
                <span>More independent (90%)</span>
              </div>
            </div>

            <p className="text-xs text-zinc-400 leading-relaxed">
              When you edit or reject a recommendation, this agent lowers its autonomous risk
              budget by <strong className="text-zinc-200">-8%</strong> so higher-impact steps
              ask for your review earlier (never relying on uncalibrated model confidence).
              Unedited approvals gradually restore{" "}
              <strong className="text-zinc-200">+3%</strong>.
            </p>

            <div className="grid grid-cols-3 gap-2.5 pt-2 border-t border-white/[0.07] text-center">
              <div className="rounded-lg bg-[#0e1119] p-2.5">
                <p className="text-[11px] text-zinc-500">Decisions</p>
                <p className="text-sm font-semibold text-white">
                  {selectedAgent.totalDecisions}
                </p>
              </div>
              <div className="rounded-lg bg-[#0e1119] p-2.5">
                <p className="text-[11px] text-zinc-500">Alignment</p>
                <p className="text-sm font-semibold text-emerald-300">
                  {selectedAgent.totalDecisions > 0 ? `${100 - selectedOverrideRate}%` : "—"}
                </p>
              </div>
              <div className="rounded-lg bg-[#0e1119] p-2.5">
                <p className="text-[11px] text-zinc-500">Overrides</p>
                <p className="text-sm font-semibold text-amber-300">
                  {selectedAgent.overrideCount}
                </p>
              </div>
            </div>

            <ProgressBar value={selectedAgent.autonomyLevel * 100} />
          </Card>

          <Card className="lg:col-span-7 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white">
                {selectedAgent.name} Recent Activity
              </h3>
              <span className="text-xs text-zinc-500">
                {agentActivities.length} update{agentActivities.length === 1 ? "" : "s"}
              </span>
            </div>

            {agentActivities.length === 0 ? (
              <div className="rounded-lg border border-dashed border-white/10 p-10 text-center space-y-1">
                <p className="text-xs font-medium text-zinc-300">
                  No activity for {selectedAgent.name} yet
                </p>
                <p className="text-xs text-zinc-500">
                  Start a workflow in Workspace to see how this agent contributes step by step.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-white/[0.06] max-h-80 overflow-y-auto pr-1">
                {agentActivities.slice(0, 12).map((act) => (
                  <div
                    key={act.id}
                    className="py-3 flex items-start justify-between gap-4"
                  >
                    <div className="space-y-0.5 min-w-0">
                      <p className="text-xs font-medium text-white">{act.title}</p>
                      <p className="text-xs text-zinc-400 line-clamp-2">{act.detail}</p>
                    </div>
                    <span className="text-[11px] text-zinc-500 shrink-0">
                      {formatRelativeTime(act.createdAt)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
