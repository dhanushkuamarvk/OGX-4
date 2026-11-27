import { create } from "zustand";

const API_BASE =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ??
  (import.meta.env.DEV ? "/api" : "");

export interface TaskDefinition {
  task_id: string;
  title: string;
  domain: string;
  difficulty: "medium" | "hard";
  estimated_minutes: number;
  prompt: string;
  mid_task_requirement: string;
  recommended_injection_minute: number;
  rubric_criteria: string[];
}

export interface ChatTurn {
  message_id: string;
  role: "user" | "assistant";
  content: string;
  latency_ms?: number;
  tokens_in?: number;
  tokens_out?: number;
  created_at: string;
}

export interface BaselineSession {
  session_id: string;
  task_id: string;
  participant_id: string;
  condition: "baseline";
}

export interface HealthInfo {
  status: "ok";
  llm_provider: string;
  llm_model: string;
}

export interface ParticipantAssignment {
  participant_id: string;
  condition_order: ("coplan" | "baseline")[];
  task_order: string[];
  completed_rounds: number;
  next_round_index: number | null;
  next_condition: "coplan" | "baseline" | null;
  next_task_id: string | null;
  next_app_url: string | null;
  all_completed: boolean;
}

interface BaselineStore {
  health: HealthInfo | null;
  assignment: ParticipantAssignment | null;
  tasks: TaskDefinition[];
  session: BaselineSession | null;
  messages: ChatTurn[];
  waiting: boolean;
  error: string | null;

  loadHealth: () => Promise<void>;
  lookupAssignment: (participantId: string) => Promise<ParticipantAssignment | null>;
  loadTasks: () => Promise<void>;
  startSession: (params: {
    task_id: string;
    participant_id: string;
    initial_prompt?: string;
  }) => Promise<void>;
  sendMessage: (message: string) => Promise<void>;
  reset: () => void;
  telemetryUrl: (format: "csv" | "jsonl") => string;
}

export const useBaselineStore = create<BaselineStore>((set, get) => ({
  health: null,
  assignment: null,
  tasks: [],
  session: null,
  messages: [],
  waiting: false,
  error: null,

  loadHealth: async () => {
    try {
      const res = await fetch(`${API_BASE}/health`);
      if (res.ok) {
        const health = (await res.json()) as HealthInfo;
        set({ health });
      }
    } catch {
      // ignore if backend still booting
    }
  },

  lookupAssignment: async (participantId) => {
    if (!participantId.trim()) {
      set({ assignment: null });
      return null;
    }
    try {
      const res = await fetch(
        `${API_BASE}/assignment/${encodeURIComponent(participantId.trim())}`,
      );
      if (!res.ok) {
        set({ assignment: null });
        return null;
      }
      const assignment = (await res.json()) as ParticipantAssignment;
      set({ assignment });
      return assignment;
    } catch {
      set({ assignment: null });
      return null;
    }
  },

  telemetryUrl: (format) => {
    const sid = get().session?.session_id;
    return sid ? `${API_BASE}/sessions/${encodeURIComponent(sid)}/telemetry?format=${format}` : "#";
  },

  reset: () => set({ session: null, messages: [], waiting: false, error: null }),

  loadTasks: async () => {
    try {
      const res = await fetch(`${API_BASE}/tasks`);
      if (!res.ok) throw new Error(`Failed to fetch tasks (${res.status})`);
      const tasks = (await res.json()) as TaskDefinition[];
      set({ tasks });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Failed to load tasks" });
    }
  },

  startSession: async (params) => {
    set({ waiting: true, error: null, messages: [] });
    try {
      const res = await fetch(`${API_BASE}/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task_id: params.task_id,
          participant_id: params.participant_id,
          condition: "baseline",
          initial_prompt: params.initial_prompt,
        }),
      });
      if (!res.ok) throw new Error(`Failed to create session (${res.status})`);
      const data = (await res.json()) as BaselineSession;
      set({ session: data, waiting: false });
    } catch (err) {
      set({
        waiting: false,
        error: err instanceof Error ? err.message : "Failed to start session",
      });
    }
  },

  sendMessage: async (message) => {
    const session = get().session;
    const trimmed = message.trim();
    if (!session || !trimmed || get().waiting) return;

    const optimisticUser: ChatTurn = {
      message_id: `local-${Date.now()}`,
      role: "user",
      content: trimmed,
      created_at: new Date().toISOString(),
    };
    set((s) => ({
      messages: [...s.messages, optimisticUser],
      waiting: true,
      error: null,
    }));

    try {
      // Prompt-and-wait: single full HTTP response (no streaming)
      const res = await fetch(
        `${API_BASE}/chat/${encodeURIComponent(session.session_id)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: trimmed }),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          typeof body?.detail === "string" ? body.detail : `Chat failed (${res.status})`,
        );
      }
      const reply = (await res.json()) as {
        message_id: string;
        content: string;
        latency_ms: number;
        tokens_in: number;
        tokens_out: number;
      };
      const assistantTurn: ChatTurn = {
        message_id: reply.message_id,
        role: "assistant",
        content: reply.content,
        latency_ms: reply.latency_ms,
        tokens_in: reply.tokens_in,
        tokens_out: reply.tokens_out,
        created_at: new Date().toISOString(),
      };
      set((s) => ({
        messages: [...s.messages, assistantTurn],
        waiting: false,
      }));
    } catch (err) {
      set({
        waiting: false,
        error: err instanceof Error ? err.message : "Failed to send message",
      });
    }
  },
}));
