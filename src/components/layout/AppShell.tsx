"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  AlertCircle,
  AlertTriangle,
  BarChart3,
  Bot,
  CheckCircle2,
  CheckSquare,
  Eye,
  GitBranch,
  History,
  Info,
  LayoutDashboard,
  LogIn,
  LogOut,
  Menu,
  MessageSquare,
  Settings,
  ShieldAlert,
  X,
} from "lucide-react";
import { useRelayStore } from "@/hooks/useRelayStore";
import { Badge, Button, Card, Input, Tooltip } from "@/components/ui/primitives";
import { cn } from "@/lib/utils/cn";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/workspace", label: "Workspace", icon: MessageSquare },
  { href: "/agents", label: "Agents", icon: Bot },
  { href: "/planner", label: "Planner", icon: GitBranch },
  { href: "/approvals", label: "Approvals", icon: CheckSquare, badgeKey: "approvals" as const },
  { href: "/explainability", label: "Explainability", icon: Eye },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/history", label: "History", icon: History },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function RelayLogo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <span className="h-8 w-8 rounded-lg bg-[#8b7cf6]/18 border border-[#8b7cf6]/40 flex items-center justify-center shrink-0 shadow-sm shadow-black/20">
        <span className="font-semibold text-sm text-white tracking-tight">R</span>
      </span>
      {!compact && (
        <span className="font-semibold tracking-tight text-white text-[15px]">
          RELAY AI
        </span>
      )}
    </span>
  );
}

export function AppShell({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const {
    approvals,
    runtimeStatus,
    settings,
    session,
    toasts,
    dismissToast,
    signInDemo,
    signOutSession,
  } = useRelayStore();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [demoEmail, setDemoEmail] = useState("collaborator@relay-ai.local");
  const [demoName, setDemoName] = useState("Workspace User");

  const pendingApprovalsCount = approvals.filter((a) => a.status === "pending").length;
  const isDemoActive = settings.forceDemoMode || !runtimeStatus.geminiConfigured;

  if (!session.authenticated) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <Card className="max-w-md w-full space-y-5 animate-fade-in">
          <div className="flex items-center gap-3">
            <RelayLogo compact />
            <div>
              <h1 className="text-lg font-semibold text-white">Welcome to RELAY AI</h1>
              <p className="text-xs text-zinc-400">
                {runtimeStatus.supabaseConfigured
                  ? "Sign in with your workspace account"
                  : "Local Demo Session (cloud sync not configured)"}
              </p>
            </div>
          </div>

          <div className="rounded-lg bg-amber-500/10 border border-amber-400/25 p-3 text-xs text-amber-100 flex gap-2.5">
            <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5 text-amber-300" />
            <span className="leading-relaxed">
              {runtimeStatus.supabaseConfigured
                ? "Sign in with your Supabase account or start a local collaborator session."
                : "Cloud database credentials are not set in .env.local. Continuing creates a private local session in your browser."}
            </span>
          </div>

          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              signInDemo(demoEmail, demoName);
            }}
          >
            <div>
              <label className="text-xs text-zinc-400 block mb-1">Display Name</label>
              <Input
                value={demoName}
                onChange={(e) => setDemoName(e.target.value)}
                placeholder="Your name"
                required
              />
            </div>
            <div>
              <label className="text-xs text-zinc-400 block mb-1">Email</label>
              <Input
                type="email"
                value={demoEmail}
                onChange={(e) => setDemoEmail(e.target.value)}
                placeholder="you@organization.com"
                required
              />
            </div>
            <div className="flex flex-wrap gap-2 pt-2">
              <Button type="submit" variant="primary" className="flex-1">
                <LogIn className="h-4 w-4" />
                Continue to Workspace
              </Button>
              {runtimeStatus.supabaseConfigured && (
                <Link href="/login">
                  <Button type="button" variant="secondary">
                    Account Sign In
                  </Button>
                </Link>
              )}
              <Button type="button" variant="ghost" onClick={() => router.push("/")}>
                Home
              </Button>
            </div>
          </form>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:flex-col lg:w-60 lg:fixed lg:inset-y-0 border-r border-white/[0.07] bg-[#0e1119] z-30">
        <div className="h-16 px-5 flex items-center border-b border-white/[0.07]">
          <Link href="/" className="flex items-center">
            <RelayLogo />
          </Link>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            const badgeCount = item.badgeKey === "approvals" ? pendingApprovalsCount : 0;

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center justify-between rounded-lg px-3 py-2 text-sm font-medium transition-all duration-150",
                  active
                    ? "bg-[#8b7cf6]/14 text-white border border-[#8b7cf6]/28"
                    : "text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.04] border border-transparent"
                )}
              >
                <span className="flex items-center gap-2.5 truncate">
                  <Icon
                    className={cn(
                      "h-4 w-4 shrink-0 transition-colors",
                      active ? "text-[#a79bf9]" : "text-zinc-500"
                    )}
                  />
                  <span className="truncate">{item.label}</span>
                </span>
                {badgeCount > 0 && (
                  <span className="ml-2 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-amber-500/20 border border-amber-400/35 px-1.5 text-[11px] font-semibold text-amber-200">
                    {badgeCount}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* Bottom Status & Profile */}
        <div className="p-3 border-t border-white/[0.07] space-y-3">
          <div className="flex items-center justify-between px-2.5 py-2 rounded-lg bg-white/[0.03] border border-white/[0.06] text-[11px]">
            <span className="text-zinc-400">Runtime</span>
            <span className={cn("font-medium", isDemoActive ? "text-amber-300" : "text-emerald-300")}>
              {isDemoActive ? "Demo Mode" : "Live Gemini"}
            </span>
          </div>

          <div className="flex items-center justify-between px-1.5">
            <div className="min-w-0">
              <p className="text-xs font-medium text-zinc-200 truncate">
                {session.fullName}
              </p>
              <p className="text-[11px] text-zinc-500 truncate">
                {session.authMode === "local_demo" ? "Local Session" : session.email}
              </p>
            </div>
            <Tooltip label="Sign out">
              <Button
                variant="ghost"
                size="icon"
                aria-label="Sign Out"
                onClick={() => signOutSession()}
              >
                <LogOut className="h-3.5 w-3.5 text-zinc-400" />
              </Button>
            </Tooltip>
          </div>
        </div>
      </aside>

      {/* Mobile Navigation Drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex animate-fade-in">
          <div
            className="fixed inset-0 bg-black/65 backdrop-blur-[2px]"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="relative w-64 max-w-[85vw] bg-[#0e1119] border-r border-white/10 flex flex-col z-10">
            <div className="h-14 px-4 flex items-center justify-between border-b border-white/[0.08]">
              <Link href="/" onClick={() => setMobileOpen(false)}>
                <RelayLogo />
              </Link>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Close navigation menu"
                onClick={() => setMobileOpen(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <nav className="flex-1 overflow-y-auto p-3 space-y-1">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const active = pathname === item.href;
                const badgeCount = item.badgeKey === "approvals" ? pendingApprovalsCount : 0;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileOpen(false)}
                    className={cn(
                      "flex items-center justify-between rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                      active
                        ? "bg-[#8b7cf6]/14 text-white border border-[#8b7cf6]/28"
                        : "text-zinc-400 hover:bg-white/[0.04] hover:text-white"
                    )}
                  >
                    <span className="flex items-center gap-2.5">
                      <Icon className="h-4 w-4" />
                      {item.label}
                    </span>
                    {badgeCount > 0 && <Badge tone="amber">{badgeCount}</Badge>}
                  </Link>
                );
              })}
            </nav>
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 lg:pl-60 flex flex-col min-w-0 min-h-screen">
        <header className="sticky top-0 z-20 min-h-16 py-2.5 border-b border-white/[0.07] bg-[#0b0d12]/90 backdrop-blur-md px-4 sm:px-6 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation menu"
            >
              <Menu className="h-5 w-5" />
            </Button>
            <div className="min-w-0">
              <h1 className="text-base sm:text-lg font-semibold text-white truncate tracking-tight">
                {title}
              </h1>
              {subtitle && (
                <p className="text-xs text-zinc-400 truncate hidden sm:block">
                  {subtitle}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap shrink-0">
            <Badge tone={isDemoActive ? "amber" : "emerald"} className="hidden md:inline-flex">
              {isDemoActive ? "Demo Mode" : "Live Gemini"}
            </Badge>

            {pendingApprovalsCount > 0 && pathname !== "/approvals" && (
              <Link href="/approvals">
                <Button variant="warning" size="sm">
                  <CheckSquare className="h-3.5 w-3.5" />
                  {pendingApprovalsCount} Ready for Review
                </Button>
              </Link>
            )}
            {actions}
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 max-w-[1440px] w-full mx-auto animate-fade-in">
          {children}
        </main>
      </div>

      {/* Subtle Toast Notifications */}
      {toasts.length > 0 && (
        <div
          aria-live="polite"
          className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 w-[calc(100vw-2rem)] max-w-sm pointer-events-none"
        >
          {toasts.map((toast) => {
            const Icon =
              toast.tone === "success"
                ? CheckCircle2
                : toast.tone === "warning"
                ? AlertTriangle
                : toast.tone === "error"
                ? AlertCircle
                : Info;
            return (
              <div
                key={toast.id}
                className={cn(
                  "pointer-events-auto animate-slide-up rounded-xl border px-3.5 py-3 shadow-toast bg-[#151925] flex items-start gap-2.5",
                  toast.tone === "success" && "border-emerald-400/30",
                  toast.tone === "warning" && "border-amber-400/35",
                  toast.tone === "error" && "border-rose-400/35",
                  toast.tone === "info" && "border-[#8b7cf6]/35"
                )}
              >
                <Icon
                  className={cn(
                    "h-4 w-4 shrink-0 mt-0.5",
                    toast.tone === "success" && "text-emerald-400",
                    toast.tone === "warning" && "text-amber-300",
                    toast.tone === "error" && "text-rose-400",
                    toast.tone === "info" && "text-[#a79bf9]"
                  )}
                />
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="text-xs font-semibold text-white">{toast.title}</p>
                  {toast.description && (
                    <p className="text-[11px] text-zinc-400 leading-snug">
                      {toast.description}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => dismissToast(toast.id)}
                  aria-label="Dismiss notification"
                  className="text-zinc-500 hover:text-white p-0.5 rounded transition-colors"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
