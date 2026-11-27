import { NextResponse } from "next/server";
import { getGeminiModelName, isGeminiApiKeyValid } from "@/lib/ai/gemini";
import { isSupabaseConfigured } from "@/lib/database/supabase";
import type { BackendRuntimeStatus } from "@/types/relay";

export const dynamic = "force-dynamic";

export async function GET() {
  const geminiConfigured = isGeminiApiKeyValid();
  const status: BackendRuntimeStatus = {
    geminiConfigured,
    geminiModel: getGeminiModelName(),
    supabaseConfigured: isSupabaseConfigured(),
    activeMode: geminiConfigured ? "live_gemini" : "demo_simulated",
    serverTime: new Date().toISOString(),
  };

  return NextResponse.json(status);
}
