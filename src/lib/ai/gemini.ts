import { GoogleGenerativeAI } from "@google/generative-ai";
import { estimateTokens } from "@/lib/utils/cn";

export interface GeminiCallOptions {
  systemInstruction: string;
  prompt: string;
  expectJson?: boolean;
  temperature?: number;
  forceDemo?: boolean;
  maxRetries?: number;
  timeoutMs?: number;
}

export type GeminiErrorKind =
  | "none"
  | "timeout"
  | "network"
  | "api_error"
  | "invalid_response";

export interface GeminiCallResult {
  text: string | null;
  isSimulated: boolean;
  model: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  error?: string;
  errorKind?: GeminiErrorKind;
  fellBackToDemo?: boolean;
}

export function getGeminiModelName(): string {
  return process.env.GEMINI_MODEL?.trim() || "gemini-2.0-flash";
}

export function isGeminiApiKeyValid(): boolean {
  const key = process.env.GEMINI_API_KEY?.trim();
  return Boolean(key && key.length >= 20 && !key.includes("your_"));
}

function classifyGeminiError(err: unknown): { message: string; kind: GeminiErrorKind } {
  const message = err instanceof Error ? err.message : "Unknown Gemini API error";
  const lower = message.toLowerCase();
  if (lower.includes("timeout") || lower.includes("aborted")) {
    return { message, kind: "timeout" };
  }
  if (
    lower.includes("fetch failed") ||
    lower.includes("enotfound") ||
    lower.includes("econnreset") ||
    lower.includes("network")
  ) {
    return { message, kind: "network" };
  }
  return { message, kind: "api_error" };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Gemini agent request timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    promise
      .then((val) => {
        clearTimeout(timer);
        resolve(val);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

export async function callGeminiSafe(
  options: GeminiCallOptions
): Promise<GeminiCallResult> {
  const modelName = getGeminiModelName();
  const started = Date.now();
  const inputTokens = estimateTokens(`${options.systemInstruction}\n${options.prompt}`);

  if (options.forceDemo || !isGeminiApiKeyValid()) {
    return {
      text: null,
      isSimulated: true,
      model: `${modelName} (DEMO MODE)`,
      latencyMs: Date.now() - started,
      inputTokens,
      outputTokens: 0,
      errorKind: "none",
      fellBackToDemo: false,
    };
  }

  const maxRetries = options.maxRetries ?? 2;
  const timeoutMs = options.timeoutMs ?? 20_000;
  let lastError: string | undefined;
  let lastKind: GeminiErrorKind = "api_error";

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!.trim());
      const model = genAI.getGenerativeModel({
        model: modelName,
        systemInstruction: options.systemInstruction,
        generationConfig: {
          temperature: options.temperature ?? 0.4,
          ...(options.expectJson ? { responseMimeType: "application/json" } : {}),
        },
      });

      const response = await withTimeout(
        model.generateContent(options.prompt),
        timeoutMs
      );
      const text = response.response.text();
      if (!text || !text.trim()) {
        throw new Error("Gemini returned an empty response payload");
      }
      const usage = response.response.usageMetadata;

      return {
        text,
        isSimulated: false,
        model: modelName,
        latencyMs: Date.now() - started,
        inputTokens: usage?.promptTokenCount ?? inputTokens,
        outputTokens: usage?.candidatesTokenCount ?? estimateTokens(text),
        errorKind: "none",
        fellBackToDemo: false,
      };
    } catch (err) {
      const classified = classifyGeminiError(err);
      lastError = classified.message;
      lastKind = classified.kind;
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
      }
    }
  }

  return {
    text: null,
    isSimulated: true,
    model: `${modelName} (Fallback Demo)`,
    latencyMs: Date.now() - started,
    inputTokens,
    outputTokens: 0,
    error: lastError,
    errorKind: lastKind,
    fellBackToDemo: true,
  };
}

export function extractJsonObject<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) {
      try {
        return JSON.parse(fenced[1]) as T;
      } catch {
        return null;
      }
    }
    const braceStart = raw.indexOf("{");
    const braceEnd = raw.lastIndexOf("}");
    if (braceStart !== -1 && braceEnd > braceStart) {
      try {
        return JSON.parse(raw.slice(braceStart, braceEnd + 1)) as T;
      } catch {
        return null;
      }
    }
    return null;
  }
}
