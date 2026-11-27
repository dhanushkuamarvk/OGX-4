import { NextResponse } from "next/server";
import { z } from "zod";
import { callGeminiSafe } from "@/lib/ai/gemini";
import { appendTelemetryEvent } from "@/lib/evaluation/telemetry";
import { estimateTokens, generateId } from "@/lib/utils/cn";

const BaselineChatSchema = z.object({
  prompt: z.string().trim().min(1, "Prompt cannot be empty").max(12000, "Prompt exceeds maximum length"),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(12000),
      })
    )
    .max(50)
    .optional()
    .default([]),
  sessionId: z.string().max(120).optional(),
  forceDemo: z.boolean().optional(),
});

function buildSimulatedBaselineResponse(prompt: string, turnCount: number): string {
  const lower = prompt.toLowerCase();
  if (lower.includes("renewable") || lower.includes("energy") || lower.includes("grid")) {
    return (
      `[BASELINE DEMO MODE — Prompt-and-Wait Single-Shot Response #${turnCount}]\n\n` +
      `Renewable energy includes solar photovoltaics, wind turbines, hydroelectric power, and geothermal generation. ` +
      `Solar and onshore wind have become cost-competitive over the past decade due to manufacturing scale and declining capital costs. ` +
      `However, intermittency requires battery storage or grid interconnects, while hydro and geothermal depend heavily on local geography.\n\n` +
      `Key comparison points:\n` +
      `- Solar PV: low cost, daytime-only output.\n` +
      `- Wind: higher capacity factor, variable generation.\n` +
      `- Hydro & Geothermal: stable output, higher siting/permitting constraints.\n\n` +
      `(Note: In conventional prompt-and-wait mode, no interactive plan, mid-flight edit, or approval gate was presented before generating this monolithic answer. To adjust weighting or constraints, submit another full prompt.)`
    );
  }

  return (
    `[BASELINE DEMO MODE — Prompt-and-Wait Response #${turnCount}]\n\n` +
    `Here is a direct single-pass response addressing: "${prompt.slice(0, 120)}".\n\n` +
    `1. Context Overview: Define core constraints, budget boundaries, and primary operational risks.\n` +
    `2. Suggested Approach: Execute research, evaluate options, and produce a summary deliverable sequentially.\n` +
    `3. Key Caveats: Verify domain compliance rules and stakeholder trade-offs before execution.\n\n` +
    `(Conventional prompt-and-wait baseline: no live plan decomposition, step locking, or approval checkpoints were exposed during generation.)`
  );
}

/**
 * Conventional "prompt-and-wait" baseline endpoint.
 * Uses the EXACT same Gemini model / temperature baseline as RELAY AI,
 * without interactive task planning, step locks, or human approval checkpoints.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = BaselineChatSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid baseline chat payload", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const started = Date.now();
    const historyTranscript = parsed.data.history
      .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
      .join("\n\n");

    const combinedPrompt = historyTranscript
      ? `${historyTranscript}\n\nUser: ${parsed.data.prompt}`
      : parsed.data.prompt;

    const call = await callGeminiSafe({
      systemInstruction:
        "You are a conventional AI assistant operating in standard prompt-and-wait chat mode. Answer the user's request directly in one complete response.",
      prompt: combinedPrompt,
      temperature: 0.35,
      forceDemo: parsed.data.forceDemo,
    });

    // Brief realistic wait simulation in demo mode so baseline latency is measurable
    if (call.isSimulated) {
      await new Promise((r) => setTimeout(r, 450));
    }

    const responseText =
      !call.isSimulated && call.text
        ? call.text
        : buildSimulatedBaselineResponse(parsed.data.prompt, parsed.data.history.length + 1);

    const latencyMs = Date.now() - started;
    const outputTokens = call.outputTokens || estimateTokens(responseText);

    appendTelemetryEvent({
      id: generateId("tel"),
      eventType: "baseline_chat",
      condition: "baseline",
      sessionId: parsed.data.sessionId ?? "baseline_session",
      latencyMs,
      inputTokens: call.inputTokens,
      outputTokens,
      isSimulated: call.isSimulated,
      metadata: { historyTurns: parsed.data.history.length },
      timestamp: new Date().toISOString(),
    });

    return NextResponse.json({
      response: responseText,
      isSimulated: call.isSimulated,
      model: call.model,
      latencyMs,
      inputTokens: call.inputTokens,
      outputTokens,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Baseline chat request failed" },
      { status: 500 }
    );
  }
}
