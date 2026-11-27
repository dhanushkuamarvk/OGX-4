"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowRight,
  Check,
  CheckCircle2,
  Eye,
  GitBranch,
  ListTree,
  Lock,
  RotateCcw,
  Search,
  ShieldCheck,
  Sliders,
  UserCheck,
} from "lucide-react";
import {
  AgentAvatar,
  Badge,
  Button,
  Card,
  ProgressBar,
  StatusBadge,
} from "@/components/ui/primitives";
import { RelayLogo } from "@/components/layout/AppShell";

const COLLAB_STAGES = [
  {
    step: "01",
    role: "planning-agent",
    title: "Planning Agent",
    subtitle: "Organises tasks and creates structured plans",
    style: "Organised and helpful",
    summary: "Turns your goal into clear, editable steps before anything runs.",
    detail:
      "You can edit titles, reorder priorities, lock steps you want protected, or adjust the scope freely.",
  },
  {
    step: "02",
    role: "research-agent",
    title: "Research Agent",
    subtitle: "Finds relevant information and supporting evidence",
    style: "Informative and clear",
    summary: "Gathers structured findings and cites the evidence behind every claim.",
    detail:
      "Need to change direction mid-task? Pause or update requirements — completed work stays intact.",
  },
  {
    step: "03",
    role: "human",
    title: "Your Review Point",
    subtitle: "You approve key decisions before continuing",
    style: "Human-controlled",
    summary: "Agents pause at important decisions and explain the trade-offs clearly.",
    detail:
      "Approve, reject, edit the direction, or ask the agent questions in plain language before moving on.",
  },
  {
    step: "04",
    role: "execution-agent",
    title: "Execution Agent",
    subtitle: "Carries out assigned tasks and reports progress",
    style: "Concise and practical",
    summary: "Delivers the final output shaped by every edit and approval you made.",
    detail:
      "Every decision, handoff, and explanation stays available for inspection and export.",
  },
];

const HOW_IT_WORKS = [
  {
    num: "01",
    title: "Share your goal",
    desc: "Describe what you want to accomplish or attach supporting context files in the Workspace.",
  },
  {
    num: "02",
    title: "Review and shape the plan",
    desc: "The Planning Agent proposes structured steps. Edit, reorder, lock, or refine them before starting.",
  },
  {
    num: "03",
    title: "Guide and approve key steps",
    desc: "Stay informed as agents work. Pause anytime, change requirements mid-flight, and sign off on key decisions.",
  },
  {
    num: "04",
    title: "Understand and export",
    desc: "Review plain-language explanations for every major decision, export your deliverable, and inspect metrics.",
  },
];

const EXPLAINABILITY_PREVIEW = [
  {
    question: "What was decided?",
    answer: "Recommended a balanced hybrid solar, wind, and 4-hour storage mix for the regional plan.",
  },
  {
    question: "Why was this recommended?",
    answer: "It balances lower generation cost with stronger evening reliability based on collected benchmarks.",
  },
  {
    question: "What information supports it?",
    answer: "IEA, IRENA, and NREL benchmark findings handed off by the Research Agent.",
  },
  {
    question: "What other options were considered?",
    answer: "Lowest-cost solar-only mix (higher evening risk) and 24/7 firm baseload mix (higher upfront CapEx).",
  },
  {
    question: "What are the uncertainties?",
    answer: "Local grid interconnection queues and regional winter weather variability.",
  },
  {
    question: "What happens next?",
    answer: "Once you approve or adjust the priorities, Execution Agent drafts the final report.",
  },
];

export default function LandingPage() {
  const [activeStage, setActiveStage] = useState(0);
  const current = COLLAB_STAGES[activeStage];

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {/* Navigation */}
      <header className="sticky top-0 z-30 border-b border-white/[0.07] bg-[#0b0d12]/90 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <Link href="/">
            <RelayLogo />
          </Link>

          <nav className="hidden md:flex items-center gap-7 text-sm text-zinc-400">
            <a href="#agents" className="hover:text-white transition-colors">
              Agents
            </a>
            <a href="#how-it-works" className="hover:text-white transition-colors">
              How It Works
            </a>
            <a href="#human-control" className="hover:text-white transition-colors">
              Human Control
            </a>
            <a href="#explainability" className="hover:text-white transition-colors">
              Explainable AI
            </a>
          </nav>

          <div className="flex items-center gap-2.5">
            <Link href="/login">
              <Button variant="ghost" size="sm">
                Sign In
              </Button>
            </Link>
            <Link href="/workspace">
              <Button variant="primary" size="sm">
                Get Started
              </Button>
            </Link>
          </div>
        </div>
      </header>

      {/* Hero + Restrained Product Preview */}
      <section className="pt-16 pb-20 sm:pt-24 sm:pb-24 border-b border-white/[0.06]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 space-y-14">
          <div className="max-w-3xl mx-auto text-center space-y-6">
            <Badge tone="purple" className="mx-auto">
              Human-Agent Collaboration Platform
            </Badge>

            <h1 className="text-4xl sm:text-5xl lg:text-[56px] font-semibold tracking-tight text-white leading-[1.08]">
              Beyond Prompts.{" "}
              <span className="text-[#a79bf9]">Into Collaboration.</span>
            </h1>

            <p className="text-base sm:text-lg text-zinc-400 leading-relaxed max-w-2xl mx-auto">
              RELAY AI is an intelligent human-agent collaboration platform that enables
              people to coordinate, supervise and interact with multiple AI agents through
              an adaptive, transparent and human-controlled workflow.
            </p>

            <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
              <Link href="/workspace">
                <Button variant="primary" size="lg">
                  Get Started
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
              <Link href="/dashboard">
                <Button variant="secondary" size="lg">
                  Explore Platform
                </Button>
              </Link>
            </div>
          </div>

          {/* Restrained Product Preview */}
          <div className="panel-surface rounded-2xl overflow-hidden max-w-5xl mx-auto">
            <div className="px-5 py-3 border-b border-white/[0.07] bg-[#0e1119] flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
                <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
                <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
                <span className="ml-2 text-xs text-zinc-400 font-medium">
                  RELAY AI Workspace — Renewable Energy Research Report
                </span>
              </div>
              <Badge tone="neutral">Illustrative preview</Badge>
            </div>

            <div className="grid lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-white/[0.07]">
              {/* Conversation Snapshot */}
              <div className="lg:col-span-7 p-5 space-y-4">
                <div className="flex justify-end">
                  <div className="rounded-xl bg-[#8b7cf6]/16 border border-[#8b7cf6]/30 px-4 py-2.5 text-xs text-zinc-100 max-w-md">
                    Prepare a research report about renewable energy and compare key sources.
                  </div>
                </div>

                <div className="flex items-start gap-2.5">
                  <AgentAvatar role="planning-agent" size="sm" />
                  <div className="space-y-1.5 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-[#c5bcff]">Planning Agent</span>
                      <span className="text-[11px] text-zinc-500">Organised and helpful</span>
                    </div>
                    <div className="rounded-xl bg-surface-elevated border border-white/[0.08] px-4 py-3 text-xs text-zinc-200 leading-relaxed">
                      Your plan is ready for review. I&apos;ve organised this into 5 steps, with
                      a review pause before the final report so you can confirm trade-off
                      priorities first.
                    </div>
                  </div>
                </div>

                <div className="rounded-xl bg-amber-500/[0.08] border border-amber-400/25 p-3.5 space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-amber-200 flex items-center gap-1.5">
                      <UserCheck className="h-3.5 w-3.5" />
                      Your review is needed
                    </span>
                    <StatusBadge status="waiting_for_approval" />
                  </div>
                  <p className="text-xs text-zinc-300 leading-relaxed">
                    Execution Agent prepared the comparative weighting for Step 4. Review the
                    recommendation and risks before continuing.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/15 border border-emerald-400/25 px-2.5 py-1 text-[11px] font-medium text-emerald-200">
                      <Check className="h-3 w-3" /> Approve
                    </span>
                    <span className="inline-flex items-center rounded-md bg-white/[0.05] border border-white/10 px-2.5 py-1 text-[11px] text-zinc-300">
                      Edit Direction
                    </span>
                    <span className="inline-flex items-center rounded-md bg-white/[0.05] border border-white/10 px-2.5 py-1 text-[11px] text-zinc-300">
                      Ask Agent
                    </span>
                  </div>
                </div>
              </div>

              {/* Plan Snapshot */}
              <div className="lg:col-span-5 p-5 bg-[#0e1119]/60 space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-white">Task Plan (5 steps)</span>
                  <span className="text-xs font-mono text-zinc-400">60%</span>
                </div>
                <ProgressBar value={60} />

                <div className="space-y-2">
                  {[
                    {
                      num: "1",
                      title: "Research renewable energy",
                      agent: "Research",
                      tone: "text-cyan-300",
                      status: "completed",
                      locked: true,
                    },
                    {
                      num: "2",
                      title: "Collect benchmark evidence",
                      agent: "Research",
                      tone: "text-cyan-300",
                      status: "completed",
                      locked: false,
                    },
                    {
                      num: "3",
                      title: "Compare energy sources",
                      agent: "Execution",
                      tone: "text-emerald-300",
                      status: "completed",
                      locked: false,
                    },
                    {
                      num: "4",
                      title: "Analyze findings & weights",
                      agent: "Execution",
                      tone: "text-emerald-300",
                      status: "waiting_for_approval",
                      locked: false,
                    },
                    {
                      num: "5",
                      title: "Generate final report",
                      agent: "Execution",
                      tone: "text-emerald-300",
                      status: "pending",
                      locked: false,
                    },
                  ].map((s) => (
                    <div
                      key={s.num}
                      className="rounded-lg bg-surface border border-white/[0.07] px-3 py-2 flex items-center justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-zinc-100 truncate flex items-center gap-1.5">
                          <span className="text-zinc-500 font-mono">{s.num}.</span>
                          {s.title}
                          {s.locked && <Lock className="h-3 w-3 text-cyan-300 shrink-0" />}
                        </p>
                        <p className={`text-[11px] ${s.tone}`}>{s.agent} Agent</p>
                      </div>
                      <StatusBadge status={s.status} />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Three-Agent Collaboration Illustration */}
      <section id="agents" className="py-20 border-b border-white/[0.06]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 space-y-10">
          <div className="max-w-2xl space-y-2">
            <p className="text-xs font-medium uppercase tracking-wider text-[#a79bf9]">
              Collaborative Agents
            </p>
            <h2 className="text-2xl sm:text-3xl font-semibold text-white tracking-tight">
              Three specialized agents working transparently alongside you.
            </h2>
            <p className="text-sm text-zinc-400 leading-relaxed">
              Each agent has a clear responsibility and hands off structured context so you
              always know who is working and what happens next.
            </p>
          </div>

          <Card className="p-5 sm:p-6 space-y-5">
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {COLLAB_STAGES.map((stage, idx) => {
                const selected = idx === activeStage;
                return (
                  <button
                    key={stage.step}
                    type="button"
                    onClick={() => setActiveStage(idx)}
                    className={`text-left rounded-xl p-4 border transition-all duration-150 space-y-3 ${
                      selected
                        ? "bg-surface-elevated border-[#8b7cf6]/50"
                        : "bg-[#0e1119] border-white/[0.07] hover:border-white/15"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <AgentAvatar role={stage.role} size="md" />
                      <span className="text-[11px] font-mono text-zinc-500">{stage.step}</span>
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm font-semibold text-white">{stage.title}</p>
                      <p className="text-xs text-zinc-400 leading-snug">{stage.subtitle}</p>
                    </div>
                    <p className="text-[11px] text-zinc-500">{stage.style}</p>
                  </button>
                );
              })}
            </div>

            <div className="rounded-xl bg-[#0e1119] border border-white/[0.07] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-1">
                <p className="text-sm font-medium text-white flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-[#a79bf9] shrink-0" />
                  {current.summary}
                </p>
                <p className="text-xs text-zinc-400 pl-6 leading-relaxed">{current.detail}</p>
              </div>
              <Link href="/workspace" className="shrink-0">
                <Button variant="cyan" size="sm">
                  Try in Workspace
                  <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </Link>
            </div>
          </Card>

          {/* Compact Agent Identity Legend */}
          <div className="grid md:grid-cols-3 gap-4">
            <Card className="space-y-2.5">
              <div className="flex items-center gap-2.5">
                <span className="h-8 w-8 rounded-lg bg-cyan-500/12 border border-cyan-400/30 flex items-center justify-center text-cyan-300">
                  <Search className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-white">Research Agent</p>
                  <p className="text-[11px] text-cyan-300">Informative and clear</p>
                </div>
              </div>
              <p className="text-xs text-zinc-400 leading-relaxed">
                Finds relevant information and supporting evidence, citing sources and noting
                uncertainties clearly.
              </p>
            </Card>

            <Card className="space-y-2.5">
              <div className="flex items-center gap-2.5">
                <span className="h-8 w-8 rounded-lg bg-[#8b7cf6]/14 border border-[#8b7cf6]/35 flex items-center justify-center text-[#c5bcff]">
                  <ListTree className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-white">Planning Agent</p>
                  <p className="text-[11px] text-[#c5bcff]">Organised and helpful</p>
                </div>
              </div>
              <p className="text-xs text-zinc-400 leading-relaxed">
                Organises tasks and creates structured plans you can edit, lock, reorder, or
                adapt mid-workflow.
              </p>
            </Card>

            <Card className="space-y-2.5">
              <div className="flex items-center gap-2.5">
                <span className="h-8 w-8 rounded-lg bg-emerald-500/12 border border-emerald-400/30 flex items-center justify-center text-emerald-300">
                  <Activity className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-white">Execution Agent</p>
                  <p className="text-[11px] text-emerald-300">Concise and practical</p>
                </div>
              </div>
              <p className="text-xs text-zinc-400 leading-relaxed">
                Carries out assigned tasks, reports progress clearly, and pauses for your review
                before important choices.
              </p>
            </Card>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section id="how-it-works" className="py-20 border-b border-white/[0.06]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 space-y-10">
          <div className="max-w-2xl space-y-2">
            <p className="text-xs font-medium uppercase tracking-wider text-cyan-300">
              How It Works
            </p>
            <h2 className="text-2xl sm:text-3xl font-semibold text-white tracking-tight">
              A calm workflow from initial goal to verified result.
            </h2>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {HOW_IT_WORKS.map((item) => (
              <Card key={item.num} className="space-y-3">
                <span className="inline-flex h-7 px-2 items-center justify-center rounded-md bg-[#8b7cf6]/14 border border-[#8b7cf6]/30 text-xs font-mono font-medium text-[#c5bcff]">
                  {item.num}
                </span>
                <h3 className="text-sm font-semibold text-white">{item.title}</h3>
                <p className="text-xs text-zinc-400 leading-relaxed">{item.desc}</p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Human Control Section */}
      <section id="human-control" className="py-20 border-b border-white/[0.06]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 grid lg:grid-cols-12 gap-8 items-center">
          <div className="lg:col-span-5 space-y-4">
            <p className="text-xs font-medium uppercase tracking-wider text-amber-300">
              Human Control
            </p>
            <h2 className="text-2xl sm:text-3xl font-semibold text-white tracking-tight">
              Stay in charge before, during, and after every step.
            </h2>
            <p className="text-sm text-zinc-400 leading-relaxed">
              Instead of waiting for a black-box response and starting over when requirements
              change, RELAY AI keeps your plan editable and asks before taking important turns.
            </p>
            <div className="pt-2">
              <Link href="/approvals">
                <Button variant="secondary" size="md">
                  Explore Approval Center
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            </div>
          </div>

          <div className="lg:col-span-7 grid sm:grid-cols-2 gap-4">
            {[
              {
                icon: ShieldCheck,
                title: "Explicit Plan Review",
                desc: "Approved plans are never silently altered. Requirement changes clearly show what changed, which steps are affected, and ask for review again.",
              },
              {
                icon: Lock,
                title: "Step Locking & Direct Edits",
                desc: "Lock completed or critical steps so future adjustments only adapt the remaining work.",
              },
              {
                icon: Sliders,
                title: "Human-Feedback Adaptive Autonomy",
                desc: "Rule-based supervision automatically checks in earlier when you override an agent, and relaxes smoothly when recommendations align.",
              },
              {
                icon: RotateCcw,
                title: "Pause, Resume & Checkpoints",
                desc: "Interrupt work safely at any moment or restore a previous verified checkpoint without losing context.",
              },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <Card key={item.title} className="space-y-2.5">
                  <div className="h-8 w-8 rounded-lg bg-white/[0.04] border border-white/[0.08] flex items-center justify-center">
                    <Icon className="h-4 w-4 text-[#a79bf9]" />
                  </div>
                  <h3 className="text-sm font-semibold text-white">{item.title}</h3>
                  <p className="text-xs text-zinc-400 leading-relaxed">{item.desc}</p>
                </Card>
              );
            })}
          </div>
        </div>
      </section>

      {/* Explainable AI Section */}
      <section id="explainability" className="py-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 space-y-10">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
            <div className="max-w-2xl space-y-2">
              <p className="text-xs font-medium uppercase tracking-wider text-emerald-300">
                Explainable AI
              </p>
              <h2 className="text-2xl sm:text-3xl font-semibold text-white tracking-tight">
                Plain-language reasoning you can actually read and trust.
              </h2>
              <p className="text-sm text-zinc-400 leading-relaxed">
                Every major recommendation is broken into six clear questions — grounded in
                recorded evidence, never invented probability scores.
              </p>
            </div>
            <Link href="/explainability">
              <Button variant="secondary" size="md">
                <Eye className="h-4 w-4" />
                View Explainability
              </Button>
            </Link>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {EXPLAINABILITY_PREVIEW.map((item) => (
              <Card key={item.question} className="space-y-2">
                <p className="text-xs font-semibold text-white">{item.question}</p>
                <p className="text-xs text-zinc-400 leading-relaxed">{item.answer}</p>
              </Card>
            ))}
          </div>

          {/* Calm Bottom CTA */}
          <Card className="p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-5">
            <div className="space-y-1">
              <h3 className="text-lg font-semibold text-white">
                Ready to collaborate with full visibility?
              </h3>
              <p className="text-sm text-zinc-400">
                Launch a workflow in the Workspace or explore the Visual Planner.
              </p>
            </div>
            <div className="flex flex-wrap gap-2.5 shrink-0">
              <Link href="/workspace">
                <Button variant="primary" size="md">
                  Get Started
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
              <Link href="/planner">
                <Button variant="secondary" size="md">
                  <GitBranch className="h-4 w-4" />
                  Open Planner
                </Button>
              </Link>
            </div>
          </Card>
        </div>
      </section>

      {/* Footer */}
      <footer className="mt-auto border-t border-white/[0.07] py-8 bg-[#0e1119]/60">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-zinc-500">
          <div className="flex items-center gap-3">
            <RelayLogo />
            <span>Beyond Prompts. Into Collaboration.</span>
          </div>
          <div className="flex flex-wrap items-center gap-5">
            <Link href="/dashboard" className="hover:text-zinc-200 transition-colors">
              Dashboard
            </Link>
            <Link href="/workspace" className="hover:text-zinc-200 transition-colors">
              Workspace
            </Link>
            <Link href="/approvals" className="hover:text-zinc-200 transition-colors">
              Approvals
            </Link>
            <Link href="/explainability" className="hover:text-zinc-200 transition-colors">
              Explainability
            </Link>
            <Link href="/analytics" className="hover:text-zinc-200 transition-colors">
              Analytics
            </Link>
            <Link href="/settings" className="hover:text-zinc-200 transition-colors">
              Settings
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
