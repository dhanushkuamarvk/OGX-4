"use client";

import React, { useState } from "react";
import Link from "next/link";
import { ArrowRight, Eye } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { useRelayStore } from "@/hooks/useRelayStore";
import {
  AgentAvatar,
  Badge,
  Button,
  Card,
  EmptyState,
  getAgentStyle,
} from "@/components/ui/primitives";
import { cn, formatRelativeTime } from "@/lib/utils/cn";
import type { AgentSlug } from "@/types/relay";

export default function ExplainabilityPage() {
  const { explanations } = useRelayStore();
  const [agentFilter, setAgentFilter] = useState<"all" | AgentSlug>("all");

  const filtered = explanations.filter(
    (e) => agentFilter === "all" || e.agentSlug === agentFilter
  );

  return (
    <AppShell
      title="Explainability"
      subtitle="Plain-language explanations for every major agent recommendation"
      actions={
        <Link href="/workspace">
          <Button variant="primary" size="sm">
            Open Workspace
          </Button>
        </Link>
      }
    >
      <div className="space-y-6">
        {/* Agent Filter Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1 bg-surface p-1 rounded-lg border border-white/[0.08]">
            {[
              { id: "all" as const, label: `All (${explanations.length})` },
              { id: "planning-agent" as const, label: "Planning Agent" },
              { id: "research-agent" as const, label: "Research Agent" },
              { id: "execution-agent" as const, label: "Execution Agent" },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setAgentFilter(tab.id)}
                className={cn(
                  "px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                  agentFilter === tab.id
                    ? "bg-[#7c6ce8] text-white"
                    : "text-zinc-400 hover:text-white"
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <span className="text-xs text-zinc-500">
            Grounded in recorded evidence — never invented probability scores
          </span>
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            icon={Eye}
            title="No decisions recorded yet"
            description="Start a collaboration in Workspace. Whenever the Planning, Research, or Execution agent makes a recommendation, you'll see a plain-language breakdown here."
            action={
              <Link href="/workspace">
                <Button variant="primary" size="sm">
                  Start a Workflow
                </Button>
              </Link>
            }
          />
        ) : (
          <div className="space-y-5">
            {filtered.map((dec) => {
              const style = getAgentStyle(dec.agentSlug);
              return (
                <Card key={dec.id} className="space-y-4 animate-fade-in">
                  {/* Decision Card Header */}
                  <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-white/[0.07]">
                    <div className="flex items-center gap-3 flex-wrap">
                      <AgentAvatar role={dec.agentSlug} size="sm" />
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={cn("text-xs font-semibold", style.text)}>
                            {style.label}
                          </span>
                          <span className="text-xs text-zinc-500">•</span>
                          <span className="text-xs font-medium text-white">
                            {dec.taskTitle}
                          </span>
                          {dec.isSimulated && <Badge tone="amber">Demo Mode</Badge>}
                        </div>
                      </div>
                    </div>
                    <span className="text-xs text-zinc-500">
                      {formatRelativeTime(dec.createdAt)}
                    </span>
                  </div>

                  {/* 6 Clear, Non-Technical Sections */}
                  <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3.5 text-xs">
                    {/* 1. What was decided? */}
                    <div className="rounded-lg bg-[#0e1119] border border-white/[0.06] p-4 space-y-1.5">
                      <p className="font-semibold text-white">What was decided?</p>
                      <p className="text-zinc-300 leading-relaxed">{dec.decisionSummary}</p>
                    </div>

                    {/* 2. Why was this recommended? */}
                    <div className="rounded-lg bg-[#0e1119] border border-white/[0.06] p-4 space-y-1.5">
                      <p className="font-semibold text-[#c5bcff]">
                        Why was this recommended?
                      </p>
                      <p className="text-zinc-300 leading-relaxed">
                        {dec.recommendationExplanation}
                      </p>
                    </div>

                    {/* 3. What information supports it? */}
                    <div className="rounded-lg bg-[#0e1119] border border-white/[0.06] p-4 space-y-1.5">
                      <p className="font-semibold text-cyan-300">
                        What information supports it?
                      </p>
                      <ul className="space-y-1 text-zinc-300 list-disc pl-4 leading-relaxed">
                        {dec.evidenceUsed.map((ev, i) => (
                          <li key={i}>{ev}</li>
                        ))}
                      </ul>
                    </div>

                    {/* 4. What other options were considered? */}
                    <div className="rounded-lg bg-[#0e1119] border border-white/[0.06] p-4 space-y-1.5">
                      <p className="font-semibold text-zinc-200">
                        What other options were considered?
                      </p>
                      {dec.alternativeOptions.length === 0 ? (
                        <p className="text-zinc-500">No alternative options were recorded.</p>
                      ) : (
                        <ul className="space-y-1.5 text-zinc-300 leading-relaxed">
                          {dec.alternativeOptions.map((alt, i) => (
                            <li key={i}>
                              <strong className="text-white">{alt.option}:</strong>{" "}
                              <span className="text-zinc-400">{alt.reasonNotChosen}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    {/* 5. What are the uncertainties? */}
                    <div className="rounded-lg bg-amber-500/[0.06] border border-amber-400/20 p-4 space-y-1.5">
                      <p className="font-semibold text-amber-200">
                        What are the uncertainties?
                      </p>
                      {dec.uncertainties && dec.uncertainties.length > 0 ? (
                        <ul className="space-y-1 text-zinc-300 list-disc pl-4 leading-relaxed">
                          {dec.uncertainties.map((u, i) => (
                            <li key={i}>{u}</li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-zinc-400 leading-relaxed">
                          Review key assumptions against your local requirements before acting.
                        </p>
                      )}
                    </div>

                    {/* 6. What happens next? */}
                    <div className="rounded-lg bg-emerald-500/[0.05] border border-emerald-400/20 p-4 space-y-1.5">
                      <p className="font-semibold text-emerald-300 flex items-center gap-1.5">
                        What happens next?
                        <ArrowRight className="h-3.5 w-3.5" />
                      </p>
                      {dec.expectedOutcomes && dec.expectedOutcomes.length > 0 ? (
                        <ul className="space-y-1 text-zinc-300 list-disc pl-4 leading-relaxed">
                          {dec.expectedOutcomes.map((outcome, i) => (
                            <li key={i}>{outcome}</li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-zinc-400 leading-relaxed">
                          The workflow continues to the next step once you confirm or adjust
                          the plan.
                        </p>
                      )}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}
