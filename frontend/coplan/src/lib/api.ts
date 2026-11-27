import type {
  AdaptiveState,
  Artifact,
  ArtifactConflict,
  AutonomyLevel,
  HealthInfo,
  ParticipantAssignment,
  Plan,
  SessionState,
  Step,
  TaskDefinition,
} from "../types/contract";

const API_BASE =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ??
  (import.meta.env.DEV ? "/api" : "");

export class ConflictError extends Error {
  detail: ArtifactConflict;
  constructor(detail: ArtifactConflict) {
    super(detail.message);
    this.detail = detail;
  }
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
    ...init,
  });

  if (res.status === 409) {
    const body = await res.json().catch(() => ({}));
    if (body?.detail && typeof body.detail === "object" && "current_artifact" in body.detail) {
      throw new ConflictError(body.detail as ArtifactConflict);
    }
    throw new Error(typeof body?.detail === "string" ? body.detail : "Conflict");
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const msg =
      typeof body?.detail === "string"
        ? body.detail
        : `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return (await res.json()) as T;
}

export const api = {
  getStreamUrl(sessionId: string, lastSeq = 0): string {
    const base = `${API_BASE}/sessions/${encodeURIComponent(sessionId)}/stream`;
    return lastSeq > 0 ? `${base}?last_seq=${lastSeq}` : base;
  },

  getHealth(): Promise<HealthInfo> {
    return requestJson<HealthInfo>("/health");
  },

  getAssignment(participantId: string): Promise<ParticipantAssignment> {
    return requestJson<ParticipantAssignment>(
      `/assignment/${encodeURIComponent(participantId.trim())}`,
    );
  },

  getTelemetryExportUrl(sessionId: string, format: "csv" | "jsonl"): string {
    return `${API_BASE}/sessions/${encodeURIComponent(sessionId)}/telemetry?format=${format}`;
  },

  listTasks(): Promise<TaskDefinition[]> {
    return requestJson<TaskDefinition[]>("/tasks");
  },

  createSession(payload: {
    task_id: string;
    participant_id: string;
    condition: "coplan";
    initial_prompt?: string;
    autonomy_level?: AutonomyLevel;
  }): Promise<SessionState> {
    return requestJson<SessionState>("/sessions", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  getSession(sessionId: string): Promise<SessionState> {
    return requestJson<SessionState>(`/sessions/${encodeURIComponent(sessionId)}`);
  },

  interrupt(sessionId: string, newInstruction?: string): Promise<{
    session_id: string;
    interrupt_id: string;
    status: SessionState["status"];
    new_instruction: string | null;
    checkpoint_id: string;
  }> {
    return requestJson(`/sessions/${encodeURIComponent(sessionId)}/interrupt`, {
      method: "POST",
      body: JSON.stringify({
        new_instruction: newInstruction?.trim() || null,
      }),
    });
  },

  resume(sessionId: string, instruction?: string): Promise<{
    session_id: string;
    status: SessionState["status"];
    next_step_id: string | null;
  }> {
    return requestJson(`/sessions/${encodeURIComponent(sessionId)}/resume`, {
      method: "POST",
      body: JSON.stringify({
        instruction: instruction?.trim() || null,
      }),
    });
  },

  lockStep(sessionId: string, stepId: string): Promise<{ step: Step; plan_version: number }> {
    return requestJson(
      `/sessions/${encodeURIComponent(sessionId)}/steps/${encodeURIComponent(stepId)}/lock`,
      { method: "POST" },
    );
  },

  unlockStep(sessionId: string, stepId: string): Promise<{ step: Step; plan_version: number }> {
    return requestJson(
      `/sessions/${encodeURIComponent(sessionId)}/steps/${encodeURIComponent(stepId)}/unlock`,
      { method: "POST" },
    );
  },

  expandStep(
    sessionId: string,
    stepId: string,
    instruction?: string,
  ): Promise<{ parent_step_id: string; substeps: Step[]; plan: Plan }> {
    return requestJson(
      `/sessions/${encodeURIComponent(sessionId)}/steps/${encodeURIComponent(stepId)}/expand`,
      {
        method: "POST",
        body: JSON.stringify({ instruction: instruction?.trim() || null }),
      },
    );
  },

  editStep(
    sessionId: string,
    stepId: string,
    payload: { title?: string; description?: string },
  ): Promise<{ step: Step; plan: Plan; invalidated_step_ids: string[] }> {
    return requestJson(
      `/sessions/${encodeURIComponent(sessionId)}/steps/${encodeURIComponent(stepId)}`,
      {
        method: "PATCH",
        body: JSON.stringify(payload),
      },
    );
  },

  patchArtifact(
    sessionId: string,
    payload: { content: string; base_version: number },
  ): Promise<{ artifact: Artifact; merged: boolean; conflict: boolean }> {
    return requestJson(`/sessions/${encodeURIComponent(sessionId)}/artifact`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  },

  rollback(
    sessionId: string,
    checkpointId: string,
  ): Promise<{
    checkpoint_id: string;
    plan: Plan;
    artifact: Artifact;
    autonomy_level: AutonomyLevel;
    adaptive_state: AdaptiveState;
    status: SessionState["status"];
  }> {
    return requestJson(`/sessions/${encodeURIComponent(sessionId)}/rollback`, {
      method: "POST",
      body: JSON.stringify({ checkpoint_id: checkpointId }),
    });
  },

  injectRequirement(
    sessionId: string,
    text: string,
  ): Promise<{
    requirement: string;
    plan: Plan;
    invalidated_step_ids: string[];
    preserved_locked_step_ids: string[];
    autonomy_level: AutonomyLevel;
    status: SessionState["status"];
  }> {
    return requestJson(`/sessions/${encodeURIComponent(sessionId)}/requirement`, {
      method: "POST",
      body: JSON.stringify({ text }),
    });
  },

  setAutonomy(
    sessionId: string,
    level: AutonomyLevel,
  ): Promise<{ adaptive_state: AdaptiveState }> {
    return requestJson(`/sessions/${encodeURIComponent(sessionId)}/autonomy`, {
      method: "POST",
      body: JSON.stringify({
        level,
        reason: `Participant set autonomy to ${level}.`,
      }),
    });
  },
};
