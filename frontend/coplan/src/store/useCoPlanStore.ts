import { create } from "zustand";
import { api, ConflictError } from "../lib/api";
import type {
  ActivityLogItem,
  AdaptiveState,
  Artifact,
  ArtifactConflict,
  AutonomyLevel,
  Checkpoint,
  HealthInfo,
  ParticipantAssignment,
  Plan,
  SessionState,
  SessionStatus,
  SSEEventType,
  Step,
  TaskDefinition,
} from "../types/contract";

const ALL_SSE_EVENTS: SSEEventType[] = [
  "plan_created",
  "plan_patch",
  "step_started",
  "step_progress",
  "step_completed",
  "step_failed",
  "artifact_patch",
  "confidence_update",
  "interrupt_ack",
  "checkpoint_saved",
  "rollback_done",
  "autonomy_changed",
  "requirement_changed",
  "done",
];

let activeEventSource: EventSource | null = null;

interface CoPlanStore {
  health: HealthInfo | null;
  tasks: TaskDefinition[];
  assignment: ParticipantAssignment | null;
  session: SessionState | null;
  connected: boolean;
  busyAction: string | null;
  error: string | null;
  toast: string | null;
  lastSeq: number;

  streamingStepId: string | null;
  streamingText: string;
  streamingPct: number;
  approvalPrompt: { stepId: string; reason: string; confidence: number } | null;
  artifactConflict: ArtifactConflict | null;
  activity: ActivityLogItem[];

  loadHealth: () => Promise<void>;
  loadTasks: () => Promise<void>;
  lookupAssignment: (participantId: string) => Promise<ParticipantAssignment | null>;
  startSession: (params: {
    task_id: string;
    participant_id: string;
    initial_prompt?: string;
    autonomy_level?: AutonomyLevel;
  }) => Promise<void>;
  reconnectStream: () => void;
  disconnectStream: () => void;
  resetWorkspace: () => void;
  clearError: () => void;
  clearToast: () => void;
  clearConflict: () => void;

  interrupt: (instruction?: string) => Promise<void>;
  resume: (instruction?: string) => Promise<void>;
  toggleLock: (stepId: string, currentlyLocked: boolean) => Promise<void>;
  expandStep: (stepId: string, instruction?: string) => Promise<void>;
  editStep: (stepId: string, title: string, description: string) => Promise<void>;
  saveArtifact: (content: string, baseVersion: number) => Promise<boolean>;
  rollback: (checkpointId: string) => Promise<void>;
  injectRequirement: (text: string) => Promise<void>;
  setAutonomy: (level: AutonomyLevel) => Promise<void>;
}

function appendActivity(
  list: ActivityLogItem[],
  event: SSEEventType,
  seq: number,
  ts: string,
  summary: string,
): ActivityLogItem[] {
  const next: ActivityLogItem = {
    id: `${seq}-${event}`,
    seq,
    ts,
    event,
    summary,
  };
  return [next, ...list].slice(0, 120);
}

function attachStream(
  sessionId: string,
  lastSeq: number,
  set: (
    partial:
      | Partial<CoPlanStore>
      | ((state: CoPlanStore) => CoPlanStore | Partial<CoPlanStore>),
  ) => void,
): void {
  if (activeEventSource) {
    activeEventSource.close();
    activeEventSource = null;
  }

  const es = new EventSource(api.getStreamUrl(sessionId, lastSeq));
  activeEventSource = es;

  es.onopen = () => set({ connected: true });
  es.onerror = () => set({ connected: false });

  const handleEvent = (eventType: SSEEventType, raw: string) => {
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }
    const seq = Number(data.seq || 0);
    const ts = String(data.ts || new Date().toISOString());

    set((state) => {
      if (!state.session || (seq > 0 && seq <= state.lastSeq)) {
        return state;
      }
      let nextSession: SessionState = { ...state.session, seq };
      let streamingStepId = state.streamingStepId;
      let streamingText = state.streamingText;
      let streamingPct = state.streamingPct;
      let approvalPrompt = state.approvalPrompt;
      let summary: string = eventType;

      switch (eventType) {
        case "plan_created": {
          const plan = data.plan as Plan;
          nextSession = { ...nextSession, plan, status: "running" };
          summary = `Plan created (${plan.steps.length} steps)`;
          break;
        }
        case "plan_patch": {
          const plan = data.plan as Plan;
          nextSession = { ...nextSession, plan };
          summary = `Plan updated (${String(data.reason || "patch")})`;
          break;
        }
        case "step_started": {
          const sid = String(data.step_id);
          const steps = nextSession.plan.steps.map((s) =>
            s.id === sid ? { ...s, status: "running" as const } : s,
          );
          nextSession = {
            ...nextSession,
            status: "running",
            plan: { ...nextSession.plan, steps },
          };
          streamingStepId = sid;
          streamingText = "";
          streamingPct = 5;
          approvalPrompt = null;
          summary = `Started: ${String(data.title || sid)}`;
          break;
        }
        case "step_progress": {
          const sid = String(data.step_id);
          streamingStepId = sid;
          streamingText = state.streamingText + String(data.chunk || "");
          streamingPct = Number(data.progress_pct || state.streamingPct);
          return {
            ...state,
            lastSeq: seq,
            session: nextSession,
            streamingStepId,
            streamingText,
            streamingPct,
          };
        }
        case "step_completed": {
          const completed = data.step as Step;
          const steps = nextSession.plan.steps.map((s) =>
            s.id === completed.id ? completed : s,
          );
          nextSession = {
            ...nextSession,
            plan: { ...nextSession.plan, steps },
          };
          if (streamingStepId === completed.id) {
            streamingStepId = null;
            streamingText = "";
            streamingPct = 100;
          }
          summary = `Completed: ${completed.title} (${Math.round(completed.confidence * 100)}%)`;
          break;
        }
        case "step_failed": {
          const sid = String(data.step_id);
          const steps = nextSession.plan.steps.map((s) =>
            s.id === sid ? { ...s, status: "failed" as const } : s,
          );
          nextSession = {
            ...nextSession,
            plan: { ...nextSession.plan, steps },
          };
          summary = `Failed (${sid}): ${String(data.error || "unknown error")}`;
          break;
        }
        case "artifact_patch": {
          const artifact = data.artifact as Artifact;
          nextSession = { ...nextSession, artifact };
          summary = String(data.summary || `Artifact v${artifact.version}`);
          break;
        }
        case "confidence_update": {
          const sid = String(data.step_id);
          const conf = Number(data.confidence);
          const requiresApproval = Boolean(data.requires_approval);
          const steps = nextSession.plan.steps.map((s) =>
            s.id === sid ? { ...s, confidence: conf } : s,
          );
          nextSession = {
            ...nextSession,
            plan: { ...nextSession.plan, steps },
            status: requiresApproval ? "paused" : nextSession.status,
          };
          if (requiresApproval) {
            approvalPrompt = {
              stepId: sid,
              confidence: conf,
              reason: String(data.reason || "Low confidence step requires review."),
            };
          }
          summary = requiresApproval
            ? `Approval gate on ${sid} (${Math.round(conf * 100)}% conf)`
            : `Confidence updated for ${sid}: ${Math.round(conf * 100)}%`;
          break;
        }
        case "interrupt_ack": {
          nextSession = {
            ...nextSession,
            status: (data.status as SessionStatus) || "paused",
            active_instruction:
              (data.new_instruction as string | null) ?? nextSession.active_instruction,
          };
          streamingStepId = null;
          summary = data.new_instruction
            ? `Paused, state kept — steered: "${String(data.new_instruction)}"`
            : "Paused, state kept";
          break;
        }
        case "checkpoint_saved": {
          const cp = data.checkpoint as Checkpoint;
          const exists = nextSession.checkpoints.some(
            (c) => c.checkpoint_id === cp.checkpoint_id,
          );
          const checkpoints = exists
            ? nextSession.checkpoints
            : [...nextSession.checkpoints, cp];
          nextSession = { ...nextSession, checkpoints };
          summary = `Checkpoint saved: ${cp.label}`;
          break;
        }
        case "rollback_done": {
          nextSession = {
            ...nextSession,
            plan: data.plan as Plan,
            artifact: data.artifact as Artifact,
            autonomy_level: data.autonomy_level as AutonomyLevel,
            status: (data.status as SessionStatus) || "rolled_back",
          };
          streamingStepId = null;
          streamingText = "";
          approvalPrompt = null;
          summary = `Rolled back to ${String(data.checkpoint_id)}`;
          break;
        }
        case "autonomy_changed": {
          const newLevel = data.new_level as AutonomyLevel;
          const adaptive: AdaptiveState = {
            ...nextSession.adaptive_state,
            level: newLevel,
            override_rate: Number(
              data.override_rate ?? nextSession.adaptive_state.override_rate,
            ),
            confidence_gate: Number(
              data.confidence_gate ?? nextSession.adaptive_state.confidence_gate,
            ),
            reason: String(data.reason || ""),
          };
          nextSession = {
            ...nextSession,
            autonomy_level: newLevel,
            adaptive_state: adaptive,
          };
          summary = `Autonomy ${String(data.previous_level)} → ${newLevel}`;
          break;
        }
        case "requirement_changed": {
          const reqText = String(data.requirement || "");
          const plan = data.plan as Plan;
          const requirements = nextSession.requirements.includes(reqText)
            ? nextSession.requirements
            : [...nextSession.requirements, reqText];
          nextSession = {
            ...nextSession,
            plan,
            requirements,
            status: "paused",
          };
          summary = `Requirement injected (${(data.preserved_locked_step_ids as string[] | undefined)?.length ?? 0} locked preserved)`;
          break;
        }
        case "done": {
          nextSession = {
            ...nextSession,
            status: (data.status as SessionStatus) || "done",
          };
          streamingStepId = null;
          summary = String(data.summary || "Execution done");
          break;
        }
      }

      return {
        ...state,
        lastSeq: seq,
        session: nextSession,
        streamingStepId,
        streamingText,
        streamingPct,
        approvalPrompt,
        activity: appendActivity(state.activity, eventType, seq, ts, summary),
      };
    });
  };

  for (const evt of ALL_SSE_EVENTS) {
    es.addEventListener(evt, (e) => {
      handleEvent(evt, (e as MessageEvent<string>).data);
    });
  }
}

export const useCoPlanStore = create<CoPlanStore>((set, get) => ({
  health: null,
  tasks: [],
  assignment: null,
  session: null,
  connected: false,
  busyAction: null,
  error: null,
  toast: null,
  lastSeq: 0,
  streamingStepId: null,
  streamingText: "",
  streamingPct: 0,
  approvalPrompt: null,
  artifactConflict: null,
  activity: [],

  clearError: () => set({ error: null }),
  clearToast: () => set({ toast: null }),
  clearConflict: () => set({ artifactConflict: null }),

  disconnectStream: () => {
    if (activeEventSource) {
      activeEventSource.close();
      activeEventSource = null;
    }
    set({ connected: false });
  },

  reconnectStream: () => {
    const { session, lastSeq } = get();
    if (!session) return;
    attachStream(session.session_id, lastSeq, set);
    set({ toast: `Reconnecting SSE from event #${lastSeq}...` });
  },

  resetWorkspace: () => {
    get().disconnectStream();
    set({
      session: null,
      lastSeq: 0,
      streamingStepId: null,
      streamingText: "",
      streamingPct: 0,
      approvalPrompt: null,
      artifactConflict: null,
      activity: [],
      error: null,
      toast: null,
    });
  },

  loadHealth: async () => {
    try {
      const health = await api.getHealth();
      set({ health });
    } catch {
      // Backend may still be booting
    }
  },

  loadTasks: async () => {
    try {
      const tasks = await api.listTasks();
      set({ tasks });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Failed to load tasks" });
    }
  },

  lookupAssignment: async (participantId) => {
    if (!participantId.trim()) {
      set({ assignment: null });
      return null;
    }
    try {
      const assignment = await api.getAssignment(participantId);
      set({ assignment, error: null });
      return assignment;
    } catch {
      set({ assignment: null });
      return null;
    }
  },

  startSession: async (params) => {
    get().disconnectStream();
    set({
      busyAction: "creating_session",
      error: null,
      activity: [],
      lastSeq: 0,
      streamingStepId: null,
      streamingText: "",
      streamingPct: 0,
      approvalPrompt: null,
      artifactConflict: null,
    });
    try {
      const session = await api.createSession({
        ...params,
        condition: "coplan",
      });
      set({ session, busyAction: null });
      attachStream(session.session_id, 0, set);
    } catch (err) {
      set({
        busyAction: null,
        error: err instanceof Error ? err.message : "Failed to start session",
      });
    }
  },

  interrupt: async (instruction) => {
    const session = get().session;
    if (!session) return;
    set({ busyAction: "interrupt", error: null });
    try {
      await api.interrupt(session.session_id, instruction);
      set((s) => ({
        busyAction: null,
        session: s.session ? { ...s.session, status: "paused" } : s.session,
        toast: "Paused, state kept.",
      }));
    } catch (err) {
      set({
        busyAction: null,
        error: err instanceof Error ? err.message : "Interrupt failed",
      });
    }
  },

  resume: async (instruction) => {
    const session = get().session;
    if (!session) return;
    set({ busyAction: "resume", error: null, approvalPrompt: null });
    try {
      await api.resume(session.session_id, instruction);
      set({ busyAction: null, toast: "Resumed execution." });
    } catch (err) {
      set({
        busyAction: null,
        error: err instanceof Error ? err.message : "Resume failed",
      });
    }
  },

  // Optimistic Lock/Unlock with automatic rollback on server error
  toggleLock: async (stepId, currentlyLocked) => {
    const session = get().session;
    if (!session) return;
    const prevPlan = session.plan;
    const optimisticSteps = prevPlan.steps.map((s) =>
      s.id === stepId ? { ...s, locked: !currentlyLocked } : s,
    );
    set({
      busyAction: `lock:${stepId}`,
      error: null,
      session: { ...session, plan: { ...prevPlan, steps: optimisticSteps } },
    });
    try {
      if (currentlyLocked) {
        await api.unlockStep(session.session_id, stepId);
      } else {
        await api.lockStep(session.session_id, stepId);
      }
      set({
        busyAction: null,
        toast: currentlyLocked
          ? "Step unlocked."
          : "Step locked & protected from replanning.",
      });
    } catch (err) {
      // Roll back optimistic state on server failure
      set((s) => ({
        busyAction: null,
        session: s.session ? { ...s.session, plan: prevPlan } : s.session,
        error: err instanceof Error ? err.message : "Lock toggle failed (reverted)",
      }));
    }
  },

  // Optimistic Expand with automatic rollback on server error
  expandStep: async (stepId, instruction) => {
    const session = get().session;
    if (!session) return;
    const prevPlan = session.plan;
    const idx = prevPlan.steps.findIndex((s) => s.id === stepId);
    const placeholder: Step = {
      id: `${stepId}_optimistic`,
      parent_id: stepId,
      title: "Expanding substeps...",
      description: "Decomposing step into actionable substeps...",
      status: "pending",
      confidence: 0.75,
      locked: false,
      user_edited: false,
      output_ref: null,
    };
    const optimisticSteps = [...prevPlan.steps];
    if (idx >= 0) {
      optimisticSteps.splice(idx + 1, 0, placeholder);
    }
    set({
      busyAction: `expand:${stepId}`,
      error: null,
      session: { ...session, plan: { ...prevPlan, steps: optimisticSteps } },
    });
    try {
      const res = await api.expandStep(session.session_id, stepId, instruction);
      set((s) => ({
        busyAction: null,
        session: s.session ? { ...s.session, plan: res.plan } : s.session,
        toast: `Expanded into ${res.substeps.length} substeps.`,
      }));
    } catch (err) {
      set((s) => ({
        busyAction: null,
        session: s.session ? { ...s.session, plan: prevPlan } : s.session,
        error: err instanceof Error ? err.message : "Expand failed (reverted)",
      }));
    }
  },

  // Optimistic Edit Step with automatic rollback on server error
  editStep: async (stepId, title, description) => {
    const session = get().session;
    if (!session) return;
    const prevPlan = session.plan;
    const optimisticSteps = prevPlan.steps.map((s) =>
      s.id === stepId
        ? { ...s, title: title.trim() || s.title, description: description.trim() || s.description, user_edited: true }
        : s,
    );
    set({
      busyAction: `edit:${stepId}`,
      error: null,
      session: { ...session, plan: { ...prevPlan, steps: optimisticSteps } },
    });
    try {
      const res = await api.editStep(session.session_id, stepId, { title, description });
      set((s) => ({
        busyAction: null,
        session: s.session ? { ...s.session, plan: res.plan } : s.session,
        toast:
          res.invalidated_step_ids.length > 0
            ? `Step updated (${res.invalidated_step_ids.length} downstream unlocked step(s) invalidated).`
            : "Step updated.",
      }));
    } catch (err) {
      set((s) => ({
        busyAction: null,
        session: s.session ? { ...s.session, plan: prevPlan } : s.session,
        error: err instanceof Error ? err.message : "Step edit failed (reverted)",
      }));
    }
  },

  saveArtifact: async (content, baseVersion) => {
    const session = get().session;
    if (!session) return false;
    set({ busyAction: "save_artifact", error: null, artifactConflict: null });
    try {
      const res = await api.patchArtifact(session.session_id, {
        content,
        base_version: baseVersion,
      });
      set((s) => ({
        busyAction: null,
        session: s.session ? { ...s.session, artifact: res.artifact } : s.session,
        toast: res.merged
          ? `Artifact saved (auto-merged to v${res.artifact.version}).`
          : `Artifact saved (v${res.artifact.version}).`,
      }));
      return true;
    } catch (err) {
      if (err instanceof ConflictError) {
        set({
          busyAction: null,
          artifactConflict: err.detail,
        });
        return false;
      }
      set({
        busyAction: null,
        error: err instanceof Error ? err.message : "Artifact save failed",
      });
      return false;
    }
  },

  rollback: async (checkpointId) => {
    const session = get().session;
    if (!session) return;
    set({ busyAction: `rollback:${checkpointId}`, error: null });
    try {
      const res = await api.rollback(session.session_id, checkpointId);
      set((s) => ({
        busyAction: null,
        session: s.session
          ? {
              ...s.session,
              plan: res.plan,
              artifact: res.artifact,
              autonomy_level: res.autonomy_level,
              adaptive_state: res.adaptive_state,
              status: res.status,
            }
          : s.session,
        toast: `Rolled back to checkpoint ${checkpointId}.`,
      }));
    } catch (err) {
      set({
        busyAction: null,
        error: err instanceof Error ? err.message : "Rollback failed",
      });
    }
  },

  injectRequirement: async (text) => {
    const session = get().session;
    if (!session) return;
    set({ busyAction: "requirement", error: null });
    try {
      const res = await api.injectRequirement(session.session_id, text);
      set((s) => ({
        busyAction: null,
        session: s.session
          ? {
              ...s.session,
              plan: res.plan,
              autonomy_level: res.autonomy_level,
              status: res.status,
              requirements: s.session.requirements.includes(res.requirement)
                ? s.session.requirements
                : [...s.session.requirements, res.requirement],
            }
          : s.session,
        toast: `Replanned: ${res.invalidated_step_ids.length} invalidated, ${res.preserved_locked_step_ids.length} locked preserved.`,
      }));
    } catch (err) {
      set({
        busyAction: null,
        error: err instanceof Error ? err.message : "Requirement update failed",
      });
    }
  },

  setAutonomy: async (level) => {
    const session = get().session;
    if (!session) return;
    try {
      const res = await api.setAutonomy(session.session_id, level);
      set((s) => ({
        session: s.session
          ? {
              ...s.session,
              autonomy_level: res.adaptive_state.level,
              adaptive_state: res.adaptive_state,
            }
          : s.session,
        toast: `Autonomy set to ${level}.`,
      }));
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Autonomy update failed",
      });
    }
  },
}));
