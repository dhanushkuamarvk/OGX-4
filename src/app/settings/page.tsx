"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  Database,
  KeyRound,
  LogOut,
  RotateCcw,
  Sliders,
  User,
} from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { useRelayStore } from "@/hooks/useRelayStore";
import { Badge, Button, Card, Input } from "@/components/ui/primitives";

export default function SettingsPage() {
  const {
    settings,
    session,
    runtimeStatus,
    updateSettings,
    signInDemo,
    signOutSession,
    resetWorkspace,
    pushToast,
  } = useRelayStore();

  const [fullName, setFullName] = useState(session.fullName);
  const [email, setEmail] = useState(session.email);
  const [savedProfile, setSavedProfile] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    setFullName(session.fullName);
    setEmail(session.email);
  }, [session.fullName, session.email]);

  function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    signInDemo(email, fullName, session.role);
    setSavedProfile(true);
    pushToast({ tone: "success", title: "Profile updated" });
    setTimeout(() => setSavedProfile(false), 2000);
  }

  return (
    <AppShell
      title="Settings"
      subtitle="Manage your session, connected services, and collaboration preferences"
    >
      <div className="grid lg:grid-cols-12 gap-5">
        {/* Profile */}
        <Card className="lg:col-span-6 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-white/[0.07]">
            <h2 className="text-sm font-semibold text-white flex items-center gap-2">
              <User className="h-4 w-4 text-[#a79bf9]" />
              Profile &amp; Session
            </h2>
            <Badge tone={session.authMode === "supabase" ? "emerald" : "amber"}>
              {session.authMode === "supabase" ? "Supabase Auth" : "Local Demo Session"}
            </Badge>
          </div>

          <form onSubmit={handleSaveProfile} className="space-y-3">
            <div>
              <label className="text-xs text-zinc-400 block mb-1">Display Name</label>
              <Input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Your display name"
              />
            </div>
            <div>
              <label className="text-xs text-zinc-400 block mb-1">Email</label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@organization.com"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-2">
              <Button type="submit" variant="primary" size="sm">
                Save Changes
              </Button>
              <Link href="/login">
                <Button type="button" variant="secondary" size="sm">
                  Switch Account
                </Button>
              </Link>
              <Button
                type="button"
                variant="danger"
                size="sm"
                onClick={() => signOutSession()}
              >
                <LogOut className="h-3.5 w-3.5" /> Sign Out
              </Button>
              {savedProfile && (
                <span className="text-xs text-emerald-300 flex items-center gap-1 animate-fade-in">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Saved
                </span>
              )}
            </div>
          </form>
        </Card>

        {/* Connected Services */}
        <Card className="lg:col-span-6 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-white/[0.07]">
            <h2 className="text-sm font-semibold text-white flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-cyan-300" />
              Connected Services
            </h2>
            <Badge tone="neutral">Server-Side Keys Only</Badge>
          </div>

          <div className="space-y-3 text-xs">
            <div className="rounded-lg bg-[#0e1119] border border-white/[0.07] p-3.5 flex items-center justify-between gap-2">
              <div>
                <p className="font-medium text-white">Google Gemini API</p>
                <p className="text-zinc-500 font-mono text-[11px]">
                  {runtimeStatus.geminiModel}
                </p>
              </div>
              <Badge tone={runtimeStatus.geminiConfigured ? "emerald" : "amber"}>
                {runtimeStatus.geminiConfigured ? "Connected" : "Demo Mode"}
              </Badge>
            </div>

            <div className="rounded-lg bg-[#0e1119] border border-white/[0.07] p-3.5 flex items-center justify-between gap-2">
              <div>
                <p className="font-medium text-white flex items-center gap-1.5">
                  <Database className="h-3.5 w-3.5 text-cyan-300" />
                  Supabase PostgreSQL
                </p>
                <p className="text-zinc-500 text-[11px]">Schema in supabase/schema.sql</p>
              </div>
              <Badge tone={runtimeStatus.supabaseConfigured ? "emerald" : "amber"}>
                {runtimeStatus.supabaseConfigured ? "Connected" : "Local Storage"}
              </Badge>
            </div>

            <p className="text-[11px] text-zinc-500 leading-relaxed">
              Add <code>GEMINI_API_KEY</code> and Supabase credentials in{" "}
              <code>.env.local</code> on your server to enable live AI generation and cloud
              persistence. API keys are never exposed to the browser.
            </p>
          </div>
        </Card>

        {/* Collaboration & Supervision Preferences */}
        <Card className="lg:col-span-12 space-y-5">
          <h2 className="text-sm font-semibold text-white flex items-center gap-2 pb-3 border-b border-white/[0.07]">
            <Sliders className="h-4 w-4 text-[#a79bf9]" />
            Collaboration &amp; Supervision Preferences
          </h2>

          <div className="grid md:grid-cols-2 gap-3.5 text-xs">
            {[
              {
                key: "forceDemoMode" as const,
                title: "Use Demo Mode",
                desc: "Run predictable local demo responses even when a Gemini API key is configured.",
              },
              {
                key: "requirePlanApproval" as const,
                title: "Review plans before starting",
                desc: "Pause after the Planning Agent prepares steps so you can review and edit first.",
              },
              {
                key: "autoPauseHighRiskSteps" as const,
                title: "Pause for review on high-impact steps",
                desc: "Automatically ask for your approval before high-impact or review-tagged actions.",
              },
              {
                key: "adaptiveAutonomyEnabled" as const,
                title: "Human-feedback-driven Adaptive Autonomy (Rule-Based)",
                desc: "Each override lowers an agent's autonomous risk budget (-8%, floor 25%); unedited approvals restore +3%.",
              },
              {
                key: "telemetryPersistToDisk" as const,
                title: "Save evaluation logs locally (JSON/CSV)",
                desc: "Store measured trial runs in .relay-telemetry/ on disk and sync to Supabase when connected.",
              },
            ].map((item) => (
              <label
                key={item.key}
                className="flex items-start justify-between gap-4 rounded-lg bg-[#0e1119] border border-white/[0.07] p-3.5 cursor-pointer hover:border-white/15 transition-colors"
              >
                <div className="space-y-0.5">
                  <p className="font-medium text-white">{item.title}</p>
                  <p className="text-zinc-400 leading-relaxed">{item.desc}</p>
                </div>
                <input
                  type="checkbox"
                  checked={settings[item.key]}
                  onChange={(e) => {
                    updateSettings({ [item.key]: e.target.checked });
                    pushToast({
                      tone: "info",
                      title: `${item.title} ${e.target.checked ? "enabled" : "turned off"}`,
                    });
                  }}
                  className="mt-1 h-4 w-4 accent-[#8b7cf6]"
                />
              </label>
            ))}
          </div>

          <div className="rounded-lg bg-[#0e1119] border border-white/[0.07] p-4 space-y-2.5">
            <div className="flex flex-wrap justify-between gap-2 text-xs">
              <span className="font-medium text-white">
                Global Supervision Strictness (Rule-Based)
              </span>
              <span className="font-mono text-cyan-300">
                {Math.round(settings.autonomyThreshold * 100)}% (Max automatic risk:{" "}
                {Math.round(
                  Math.min(0.9, Math.max(0.25, 1.2 - settings.autonomyThreshold)) * 100
                )}
                %)
              </span>
            </div>
            <input
              type="range"
              min={30}
              max={95}
              value={Math.round(settings.autonomyThreshold * 100)}
              onChange={(e) =>
                updateSettings({ autonomyThreshold: Number(e.target.value) / 100 })
              }
              className="w-full accent-[#8b7cf6]"
            />
            <p className="text-[11px] text-zinc-400 leading-relaxed">
              Separate from uncalibrated model confidence: any step whose structural risk
              exceeds <code>min(120% - Strictness, Agent Autonomy Budget)</code> pauses for
              your review in the Approval Center.
            </p>
          </div>

          <div className="pt-3 border-t border-white/[0.07] flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-zinc-500">
              Clear locally stored conversations, plans, approvals, and trial logs in this
              browser.
            </p>
            {confirmReset ? (
              <div className="flex items-center gap-2 animate-fade-in">
                <span className="text-xs text-rose-200">Reset all local workspace data?</span>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => {
                    resetWorkspace();
                    setConfirmReset(false);
                    pushToast({ tone: "info", title: "Local workspace data cleared" });
                  }}
                >
                  Confirm Reset
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirmReset(false)}>
                  Cancel
                </Button>
              </div>
            ) : (
              <Button variant="danger" size="sm" onClick={() => setConfirmReset(true)}>
                <RotateCcw className="h-3.5 w-3.5" />
                Reset Local Data
              </Button>
            )}
          </div>
        </Card>
      </div>
    </AppShell>
  );
}
