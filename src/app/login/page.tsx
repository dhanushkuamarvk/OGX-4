"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Loader2, Lock, UserPlus } from "lucide-react";
import { useRelayStore } from "@/hooks/useRelayStore";
import { Badge, Button, Card, Input } from "@/components/ui/primitives";
import { RelayLogo } from "@/components/layout/AppShell";
import { getSupabaseBrowserClient } from "@/lib/database/supabase";

export default function LoginPage() {
  const router = useRouter();
  const { runtimeStatus, signInDemo } = useRelayStore();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [fullName, setFullName] = useState("Workspace User");
  const [email, setEmail] = useState("collaborator@relay-ai.local");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const sb = getSupabaseBrowserClient();
      if (sb && password.length >= 6) {
        if (mode === "register") {
          const { error: err } = await sb.auth.signUp({
            email,
            password,
            options: { data: { full_name: fullName } },
          });
          if (err) throw err;
        } else {
          const { error: err } = await sb.auth.signInWithPassword({ email, password });
          if (err) throw err;
        }
      }
      signInDemo(email, fullName, "researcher");
      router.push("/dashboard");
    } catch (err) {
      setError(
        err instanceof Error
          ? `We couldn't sign you in. ${err.message}`
          : "We couldn't complete sign-in right now. Please try again."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-md space-y-6 animate-fade-in">
        <div className="text-center space-y-2">
          <Link href="/" className="inline-flex">
            <RelayLogo />
          </Link>
          <p className="text-sm text-zinc-400">Beyond Prompts. Into Collaboration.</p>
        </div>

        <Card className="space-y-5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex gap-1 bg-background p-1 rounded-lg border border-white/[0.08]">
              <button
                type="button"
                onClick={() => setMode("login")}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  mode === "login"
                    ? "bg-[#7c6ce8] text-white"
                    : "text-zinc-400 hover:text-white"
                }`}
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => setMode("register")}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  mode === "register"
                    ? "bg-[#7c6ce8] text-white"
                    : "text-zinc-400 hover:text-white"
                }`}
              >
                Create Account
              </button>
            </div>
            <Badge tone={runtimeStatus.supabaseConfigured ? "emerald" : "amber"}>
              {runtimeStatus.supabaseConfigured ? "Supabase" : "Local Session"}
            </Badge>
          </div>

          {!runtimeStatus.supabaseConfigured && (
            <p className="rounded-lg bg-amber-500/10 border border-amber-400/25 p-3 text-xs text-amber-100 leading-relaxed">
              Cloud authentication isn&apos;t configured yet. You can continue right away with
              a private local session in your browser.
            </p>
          )}

          {error && (
            <p className="rounded-lg bg-rose-500/15 border border-rose-400/30 p-3 text-xs text-rose-100">
              {error}
            </p>
          )}

          <form onSubmit={handleSubmit} className="space-y-3.5">
            {mode === "register" && (
              <div>
                <label className="text-xs text-zinc-400 block mb-1">Display Name</label>
                <Input
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Your name"
                  required
                />
              </div>
            )}
            <div>
              <label className="text-xs text-zinc-400 block mb-1">Email</label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@organization.com"
                required
              />
            </div>
            {runtimeStatus.supabaseConfigured && (
              <div>
                <label className="text-xs text-zinc-400 block mb-1">Password</label>
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  minLength={6}
                  required
                />
              </div>
            )}

            <Button type="submit" variant="primary" size="lg" className="w-full" disabled={loading}>
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : mode === "register" ? (
                <UserPlus className="h-4 w-4" />
              ) : (
                <Lock className="h-4 w-4" />
              )}
              {loading
                ? "Signing in..."
                : runtimeStatus.supabaseConfigured
                ? mode === "register"
                  ? "Create Account"
                  : "Sign In"
                : "Continue to Workspace"}
              <ArrowRight className="h-4 w-4" />
            </Button>
          </form>

          <div className="pt-2 border-t border-white/[0.07] text-center">
            <Link href="/" className="text-xs text-zinc-400 hover:text-white transition-colors">
              Back to Home
            </Link>
          </div>
        </Card>
      </div>
    </div>
  );
}
