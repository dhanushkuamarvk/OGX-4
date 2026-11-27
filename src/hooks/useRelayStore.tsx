"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  ActivityEvent,
  AgentHandoff,
  AgentProfile,
  AgentSlug,
  ApprovalRequest,
  ApprovalStatus,
  AttachmentItem,
  BackendRuntimeStatus,
  ChatMessage,
  CollaborativeTask,
  Conversation,
  EvaluationRun,
  ExplainableDecision,
  PlatformSettings,
  RequirementChangeSummary,
  SavedWorkflow,
  SharedTaskContext,
  StandardizedTestTask,
  TaskStep,
  ToastNotification,
  UserSession,
} from "@/types/relay";
import {
  applyPlanMutation,
  calculateTaskProgress,
  createCheckpoint,
  evaluateAdaptiveEscalation,
  findExistingPendingApproval,
  findNextRunnableStep,
  guardNoDuplicateStepExecution,
  recoverInterruptedTasksOnHydration,
  resolveApprovalDecision,
  rollbackToCheckpoint,
  skipStepWithDependencyDisclosure,
  sortWorkflowNodesTopologically,
  transitionTaskStatus,
  updateAgentAdaptiveAutonomy,
  updateRemainingStepsWithRequirement,
  type PlanMutation,
} from "@/lib/orchestration/stateMachine";
import { generateId } from "@/lib/utils/cn";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/database/supabase";

const STORAGE_KEY = "relay_ai_workspace_state_v1";
const STATIC_BOOT_ISO = "2026-11-27T00:00:00.000Z";

function formatAgentName(role: string): string {
  switch (role) {
    case "research-agent":
      return "Research Agent";
    case "planning-agent":
      return "Planning Agent";
    case "execution-agent":
      return "Execution Agent";
    case "human":
      return "You";
    default:
      return "Workflow";
  }
}

function isUnclearChangeInput(input: string): boolean {
  const clean = input.trim().toLowerCase().replace(/[!.,?]+$/g, "");
  return (
    clean.length <= 2 ||
    /^(hi|hello|hey|yo|sup|ok|okay|hmm|test|testing|thanks|thank you|good morning|good afternoon|good evening)$/.test(
      clean
    )
  );
}

export const INITIAL_AGENTS: AgentProfile[] = [
  {
    id: "agent_research",
    slug: "research-agent",
    name: "Research Agent",
    roleTitle: "Evidence & Research",
    description: "Finds relevant information and supporting evidence.",
    capabilities: [
      "Domain scoping & literature synthesis",
      "Benchmark & cost-curve extraction",
      "Source-grounded findings",
      "Uncertainty & caveat flagging",
    ],
    status: "online",
    autonomyLevel: 0.72,
    overrideCount: 0,
    totalDecisions: 0,
    tasksCompleted: 0,
    avgConfidence: 0.91,
    currentTaskLabel: null,
    lastActiveAt: STATIC_BOOT_ISO,
  },
  {
    id: "agent_planning",
    slug: "planning-agent",
    name: "Planning Agent",
    roleTitle: "Structure & Planning",
    description: "Organises tasks and creates structured plans.",
    capabilities: [
      "Multi-step task decomposition",
      "Dependency graph validation",
      "Alternative strategy generation",
      "Human-feedback plan adaptation",
    ],
    status: "online",
    autonomyLevel: 0.68,
    overrideCount: 0,
    totalDecisions: 0,
    tasksCompleted: 0,
    avgConfidence: 0.89,
    currentTaskLabel: null,
    lastActiveAt: STATIC_BOOT_ISO,
  },
  {
    id: "agent_execution",
    slug: "execution-agent",
    name: "Execution Agent",
    roleTitle: "Execution & Progress",
    description: "Carries out assigned tasks and reports progress.",
    capabilities: [
      "Approved workflow execution",
      "Human-in-the-loop approval gating",
      "Risk & alternative surfacing",
      "Executive Markdown deliverable synthesis",
    ],
    status: "online",
    autonomyLevel: 0.62,
    overrideCount: 0,
    totalDecisions: 0,
    tasksCompleted: 0,
    avgConfidence: 0.9,
    currentTaskLabel: null,
    lastActiveAt: STATIC_BOOT_ISO,
  },
];

export const DEFAULT_WORKFLOW: SavedWorkflow = {
  id: "wf_renewable_default",
  name: "Renewable Energy Collaborative Pipeline",
  description:
    "Human-in-the-loop multi-agent workflow demonstrating Planning → Research → Human Approval Gate → Final Report synthesis.",
  lastRunStatus: "idle",
  updatedAt: STATIC_BOOT_ISO,
  nodes: [
    {
      id: "n1",
      type: "relayNode",
      position: { x: 40, y: 150 },
      data: {
        label: "Human Objective",
        kind: "human_input",
        description: "Prepare a research report about renewable energy.",
        instructions: "Prepare a research report about renewable energy.",
        requiresApproval: false,
        executionStatus: "idle",
      },
    },
    {
      id: "n2",
      type: "relayNode",
      position: { x: 290, y: 150 },
      data: {
        label: "Planning Agent",
        kind: "planning_agent",
        description: "Decompose into 5 editable steps with dependencies.",
        instructions: "Create a structured 5-step collaborative plan.",
        requiresApproval: false,
        executionStatus: "idle",
      },
    },
    {
      id: "n3",
      type: "relayNode",
      position: { x: 540, y: 70 },
      data: {
        label: "Research Agent",
        kind: "research_agent",
        description: "Collect IEA, IRENA, and NREL renewable benchmarks.",
        instructions: "Gather LCOE, capacity factors, and storage costs.",
        requiresApproval: false,
        executionStatus: "idle",
      },
    },
    {
      id: "n4",
      type: "relayNode",
      position: { x: 540, y: 240 },
      data: {
        label: "Human Approval Gate",
        kind: "human_approval",
        description: "Pause for human sign-off on energy weighting & risks.",
        instructions: "Present weighting criteria, risks, and alternatives.",
        requiresApproval: true,
        executionStatus: "idle",
      },
    },
    {
      id: "n5",
      type: "relayNode",
      position: { x: 800, y: 150 },
      data: {
        label: "Execution Agent",
        kind: "execution_agent",
        description: "Synthesize findings & honor approved human edits.",
        instructions: "Compare energy sources and adapt to human approval.",
        requiresApproval: false,
        executionStatus: "idle",
      },
    },
    {
      id: "n6",
      type: "relayNode",
      position: { x: 1050, y: 150 },
      data: {
        label: "Final Research Report",
        kind: "final_output",
        description: "Export executive Markdown report & log analytics.",
        instructions: "Compile final artifact and record metrics.",
        requiresApproval: false,
        executionStatus: "idle",
      },
    },
  ],
  edges: [
    { id: "e1-2", source: "n1", target: "n2", animated: true },
    { id: "e2-3", source: "n2", target: "n3", animated: true },
    { id: "e3-4", source: "n3", target: "n4", animated: true },
    { id: "e4-5", source: "n4", target: "n5", animated: true },
    { id: "e5-6", source: "n5", target: "n6", animated: true },
  ],
};

export const DEFAULT_SETTINGS: PlatformSettings = {
  forceDemoMode: false,
  requirePlanApproval: true,
  autoPauseHighRiskSteps: true,
  adaptiveAutonomyEnabled: true,
  autonomyThreshold: 0.7,
  telemetryPersistToDisk: true,
};

export const DEFAULT_SESSION: UserSession = {
  id: "local_demo_user",
  email: "collaborator@relay-ai.local",
  fullName: "RELAY Collaborator",
  role: "researcher",
  authMode: "local_demo",
  authenticated: true,
};

interface PersistedState {
  agents: AgentProfile[];
  conversations: Conversation[];
  activeConversationId: string | null;
  messages: ChatMessage[];
  tasks: CollaborativeTask[];
  approvals: ApprovalRequest[];
  explanations: ExplainableDecision[];
  activities: ActivityEvent[];
  workflows: SavedWorkflow[];
  evaluationRuns: EvaluationRun[];
  settings: PlatformSettings;
  session: UserSession;
}

interface RelayContextValue extends PersistedState {
  runtimeStatus: BackendRuntimeStatus;
  busyTaskId: string | null;
  isHydrated: boolean;
  toasts: ToastNotification[];
  pushToast: (toast: Omit<ToastNotification, "id">) => void;
  dismissToast: (id: string) => void;
  setActiveConversationId: (id: string | null) => void;
  startCollaboration: (
    objective: string,
    attachments?: AttachmentItem[],
    evaluationMeta?: SharedTaskContext["evaluationMeta"]
  ) => Promise<string | null>;
  startEvaluationRelayTrial: (
    participantCode: string,
    template: StandardizedTestTask
  ) => Promise<string | null>;
  startMidTaskPivotDemo: () => Promise<string | null>;
  sendHumanMessage: (conversationId: string, content: string, attachments?: AttachmentItem[]) => Promise<void>;
  askTaskClarification: (taskId: string, question: string) => Promise<void>;
  interruptAndModifyRequirements: (taskId: string, requirementChange: string) => void;
  mutatePlan: (taskId: string, mutation: PlanMutation) => void;
  adaptPlanWithFeedback: (taskId: string, feedback: string) => Promise<void>;
  approvePlanAndExecute: (taskId: string) => Promise<void>;
  rejectPlan: (taskId: string, reason: string) => void;
  pauseTask: (taskId: string) => void;
  resumeTask: (taskId: string) => Promise<void>;
  retryFailedTask: (taskId: string) => Promise<void>;
  skipFailedStep: (taskId: string, stepId: string) => Promise<void>;
  cancelTask: (taskId: string) => void;
  rollbackTask: (taskId: string, checkpointId: string) => void;
  decideApproval: (
    approvalId: string,
    decision: Exclude<ApprovalStatus, "pending">,
    feedback?: string,
    selectedAlternative?: string
  ) => Promise<void>;
  askApprovalQuestion: (approvalId: string, question: string) => Promise<void>;
  toggleAgentActive: (slug: AgentSlug) => void;
  updateAgentAutonomy: (slug: AgentSlug, level: number) => void;
  saveWorkflow: (workflow: SavedWorkflow) => void;
  deleteWorkflow: (workflowId: string) => void;
  executeWorkflow: (workflowId: string) => Promise<string | null>;
  recordEvaluationRun: (run: EvaluationRun) => Promise<void>;
  clearMeasuredEvaluations: () => void;
  updateSettings: (partial: Partial<PlatformSettings>) => void;
  signInDemo: (email: string, fullName: string, role?: UserSession["role"]) => void;
  signOutSession: () => Promise<void>;
  resetWorkspace: () => void;
}

const RelayContext = createContext<RelayContextValue | null>(null);

export function RelayProvider({ children }: { children: React.ReactNode }) {
  const [agents, setAgents] = useState<AgentProfile[]>(INITIAL_AGENTS);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [tasks, setTasks] = useState<CollaborativeTask[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [explanations, setExplanations] = useState<ExplainableDecision[]>([]);
  const [activities, setActivities] = useState<ActivityEvent[]>([]);
  const [workflows, setWorkflows] = useState<SavedWorkflow[]>([DEFAULT_WORKFLOW]);
  const [evaluationRuns, setEvaluationRuns] = useState<EvaluationRun[]>([]);
  const [settings, setSettings] = useState<PlatformSettings>(DEFAULT_SETTINGS);
  const [session, setSession] = useState<UserSession>(DEFAULT_SESSION);
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);
  const [toasts, setToasts] = useState<ToastNotification[]>([]);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const pushToast = useCallback((toast: Omit<ToastNotification, "id">) => {
    const id = generateId("toast");
    setToasts((prev) => [...prev.slice(-2), { ...toast, id }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4200);
  }, []);

  const [runtimeStatus, setRuntimeStatus] = useState<BackendRuntimeStatus>({
    geminiConfigured: false,
    geminiModel: "gemini-2.0-flash",
    supabaseConfigured: false,
    activeMode: "demo_simulated",
    serverTime: STATIC_BOOT_ISO,
  });

  // Live refs so async orchestration loops always read up-to-date state
  const tasksRef = useRef<CollaborativeTask[]>(tasks);
  tasksRef.current = tasks;
  const agentsRef = useRef<AgentProfile[]>(agents);
  agentsRef.current = agents;
  const approvalsRef = useRef<ApprovalRequest[]>(approvals);
  approvalsRef.current = approvals;
  const messagesRef = useRef<ChatMessage[]>(messages);
  messagesRef.current = messages;
  const settingsRef = useRef<PlatformSettings>(settings);
  settingsRef.current = settings;
  const pausedOrCancelledRef = useRef<Set<string>>(new Set());
  const abortControllersRef = useRef<Map<string, AbortController>>(new Map());
  const inFlightOpsRef = useRef<Set<string>>(new Set());

  const logActivity = useCallback(
    (entry: Omit<ActivityEvent, "id" | "createdAt">) => {
      const item: ActivityEvent = {
        ...entry,
        id: generateId("act"),
        createdAt: new Date().toISOString(),
      };
      setActivities((prev) => [item, ...prev].slice(0, 250));
    },
    []
  );

  // Hydrate from localStorage + browser refresh recovery + backend status + telemetry
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<PersistedState>;
        if (parsed.agents?.length) {
          const initialBySlug = new Map(INITIAL_AGENTS.map((a) => [a.slug, a]));
          setAgents(
            parsed.agents.map((a) => {
              const base = initialBySlug.get(a.slug);
              return {
                ...a,
                roleTitle: base?.roleTitle ?? a.roleTitle,
                description: base?.description ?? a.description,
                status: a.status === "working" ? "online" : a.status,
                currentTaskLabel: a.status === "working" ? null : a.currentTaskLabel,
              };
            })
          );
        }
        if (parsed.conversations) setConversations(parsed.conversations);
        if (parsed.activeConversationId !== undefined)
          setActiveConversationId(parsed.activeConversationId);
        if (parsed.messages) setMessages(parsed.messages);
        if (parsed.tasks) {
          const { tasks: recoveredTasks, recoveredTaskIds } =
            recoverInterruptedTasksOnHydration(parsed.tasks);
          setTasks(recoveredTasks);
          if (recoveredTaskIds.length > 0) {
            const recoveryEvent: ActivityEvent = {
              id: generateId("act"),
              taskId: recoveredTaskIds[0],
              agentSlug: "system",
              category: "state_change",
              title: `Recovered ${recoveredTaskIds.length} interrupted task(s) after browser refresh`,
              detail:
                "Safely paused in-flight execution and reset running steps to pending so you can resume cleanly.",
              isSimulated: false,
              createdAt: new Date().toISOString(),
            };
            setActivities((prev) => [recoveryEvent, ...(parsed.activities ?? prev)].slice(0, 250));
          } else if (parsed.activities) {
            setActivities(parsed.activities);
          }
        } else if (parsed.activities) {
          setActivities(parsed.activities);
        }
        if (parsed.approvals) setApprovals(parsed.approvals);
        if (parsed.explanations) setExplanations(parsed.explanations);
        if (parsed.workflows?.length) setWorkflows(parsed.workflows);
        if (parsed.evaluationRuns) setEvaluationRuns(parsed.evaluationRuns);
        if (parsed.settings) setSettings({ ...DEFAULT_SETTINGS, ...parsed.settings });
        if (parsed.session) setSession(parsed.session);
      }
    } catch {
      // Ignore corrupted local storage
    } finally {
      setIsHydrated(true);
    }

    fetch("/api/status")
      .then((r) => r.json())
      .then((data: BackendRuntimeStatus) => setRuntimeStatus(data))
      .catch(() => {});

    fetch("/api/telemetry")
      .then((r) => r.json())
      .then((data: { evaluations?: EvaluationRun[] }) => {
        if (Array.isArray(data.evaluations) && data.evaluations.length > 0) {
          setEvaluationRuns((prev) => {
            const ids = new Set(prev.map((e) => e.id));
            const merged = [...prev];
            for (const item of data.evaluations!) {
              if (!ids.has(item.id)) merged.push(item);
            }
            return merged;
          });
        }
      })
      .catch(() => {});
  }, []);

  // Persist workspace changes to localStorage
  useEffect(() => {
    if (!isHydrated) return;
    try {
      const payload: PersistedState = {
        agents,
        conversations,
        activeConversationId,
        messages,
        tasks,
        approvals,
        explanations,
        activities,
        workflows,
        evaluationRuns,
        settings,
        session,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Storage quota ignored safely
    }
  }, [
    isHydrated,
    agents,
    conversations,
    activeConversationId,
    messages,
    tasks,
    approvals,
    explanations,
    activities,
    workflows,
    evaluationRuns,
    settings,
    session,
  ]);

  const setAgentVisualStatus = useCallback(
    (slug: AgentSlug, status: AgentProfile["status"], currentTaskLabel: string | null) => {
      setAgents((prev) =>
        prev.map((a) =>
          a.slug === slug
            ? {
                ...a,
                status: a.status === "offline" ? "offline" : status,
                currentTaskLabel,
                lastActiveAt: new Date().toISOString(),
              }
            : a
        )
      );
    },
    []
  );

  const syncWorkflowNodeStatus = useCallback(
    (taskId: string, status: "running" | "waiting_for_approval" | "completed" | "failed", activeAgent?: AgentSlug) => {
      setWorkflows((prev) =>
        prev.map((wf) => {
          if (wf.linkedTaskId !== taskId) return wf;
          return {
            ...wf,
            lastRunStatus: status,
            updatedAt: new Date().toISOString(),
            nodes: wf.nodes.map((node) => {
              const k = node.data.kind;
              if (status === "completed") {
                return { ...node, data: { ...node.data, executionStatus: "completed" } };
              }
              if (status === "waiting_for_approval") {
                if (k === "human_approval") {
                  return { ...node, data: { ...node.data, executionStatus: "waiting_for_approval" } };
                }
                if (k === "human_input" || k === "planning_agent" || k === "research_agent") {
                  return { ...node, data: { ...node.data, executionStatus: "completed" } };
                }
                return node;
              }
              if (status === "running") {
                if (k === "human_input" || k === "planning_agent") {
                  return { ...node, data: { ...node.data, executionStatus: "completed" } };
                }
                if (
                  k === "human_approval" &&
                  node.data.executionStatus === "waiting_for_approval"
                ) {
                  return { ...node, data: { ...node.data, executionStatus: "completed" } };
                }
                if (activeAgent === "research-agent" && k === "research_agent") {
                  return { ...node, data: { ...node.data, executionStatus: "running" } };
                }
                if (activeAgent === "execution-agent" && k === "execution_agent") {
                  return { ...node, data: { ...node.data, executionStatus: "running" } };
                }
              }
              return node;
            }),
          };
        })
      );
    },
    []
  );

  const executeStepsLoop = useCallback(
    async (taskId: string, humanDecisionNote?: string) => {
      if (inFlightOpsRef.current.has(`exec:${taskId}`)) {
        return; // Prevent duplicate concurrent loop execution
      }
      inFlightOpsRef.current.add(`exec:${taskId}`);
      pausedOrCancelledRef.current.delete(taskId);
      setBusyTaskId(taskId);

      try {
        while (true) {
          if (pausedOrCancelledRef.current.has(taskId)) {
            break;
          }

          const currentTask = tasksRef.current.find((t) => t.id === taskId);
          if (!currentTask || currentTask.status !== "running") {
            break;
          }

          // Dependency-aware step selection
          const schedule = findNextRunnableStep(currentTask.steps);
          const nextStep = schedule.step;

          if (!nextStep) {
            if (!schedule.allFinished && schedule.blockedReason) {
              const pausedBlocked = transitionTaskStatus(
                { ...currentTask, errorMessage: schedule.blockedReason },
                "paused"
              );
              setTasks((prev) => prev.map((t) => (t.id === taskId ? pausedBlocked : t)));
              setMessages((prev) => [
                ...prev,
                {
                  id: generateId("msg"),
                  conversationId: currentTask.conversationId,
                  senderRole: "system",
                  senderName: "Orchestrator",
                  messageType: "activity_update",
                  content: `Execution paused: ${schedule.blockedReason}`,
                  taskId,
                  createdAt: new Date().toISOString(),
                },
              ]);
              logActivity({
                taskId,
                agentSlug: "system",
                category: "state_change",
                title: "Blocked by upstream dependency",
                detail: schedule.blockedReason,
                isSimulated: currentTask.isSimulated,
              });
              break;
            }

            // All steps complete
            const completedTask = transitionTaskStatus(currentTask, "completed", {
              feedbackStage: 11,
            });
            completedTask.progress = 100;
            setTasks((prev) => prev.map((t) => (t.id === taskId ? completedTask : t)));
            setConversations((prev) =>
              prev.map((c) =>
                c.id === currentTask.conversationId
                  ? { ...c, status: "completed", updatedAt: new Date().toISOString() }
                  : c
              )
            );
            setAgents((prev) =>
              prev.map((a) => ({
                ...a,
                status: a.status === "offline" || a.status === "paused" ? a.status : "online",
                currentTaskLabel: null,
                tasksCompleted:
                  a.slug === "execution-agent" || a.slug === "research-agent"
                    ? a.tasksCompleted + 1
                    : a.tasksCompleted,
              }))
            );
            syncWorkflowNodeStatus(taskId, "completed");
            logActivity({
              taskId,
              agentSlug: "execution-agent",
              category: "state_change",
              title: `Task completed: ${currentTask.title}`,
              detail: "All approved steps finished and final artifact delivered.",
              isSimulated: currentTask.isSimulated,
            });
            break;
          }

          // Respect Agent Manager pause/offline controls before running a step
          const assignedProfile = agentsRef.current.find(
            (a) => a.slug === nextStep.assignedAgent
          );
          if (
            assignedProfile &&
            (assignedProfile.status === "paused" || assignedProfile.status === "offline")
          ) {
            const pausedTask = transitionTaskStatus(currentTask, "paused");
            setTasks((prev) => prev.map((t) => (t.id === taskId ? pausedTask : t)));
            setMessages((prev) => [
              ...prev,
              {
                id: generateId("msg"),
                conversationId: currentTask.conversationId,
                senderRole: "system",
                senderName: "Workflow Update",
                messageType: "activity_update",
                content: `Paused before Step ${nextStep.order + 1} ("${nextStep.title}") because ${assignedProfile.name} is currently ${assignedProfile.status} in Agent Manager. Turn the agent back on and select Resume when you're ready.`,
                taskId,
                createdAt: new Date().toISOString(),
              },
            ]);
            pushToast({
              tone: "warning",
              title: `${assignedProfile.name} is paused`,
              description: "Activate the agent in Agents to continue this workflow.",
            });
            logActivity({
              taskId,
              agentSlug: nextStep.assignedAgent,
              category: "state_change",
              title: `Paused: ${assignedProfile.name} is ${assignedProfile.status}`,
              detail: `Cannot run "${nextStep.title}" until agent is reactivated.`,
              isSimulated: currentTask.isSimulated,
            });
            break;
          }

          // Enforce no duplicate step execution
          guardNoDuplicateStepExecution(currentTask, nextStep.id);

          // Honor Settings & Human-feedback-driven Adaptive Autonomy (Rule-Based, decoupled from uncalibrated confidence)
          const escalation = evaluateAdaptiveEscalation({
            step: nextStep,
            agent: assignedProfile,
            isFinalStep: nextStep.order === currentTask.steps.length - 1,
            globalThreshold: settingsRef.current.autonomyThreshold,
            autoPauseHighRiskSteps: settingsRef.current.autoPauseHighRiskSteps,
            adaptiveAutonomyEnabled: settingsRef.current.adaptiveAutonomyEnabled,
          });
          const effectiveStep: TaskStep = {
            ...nextStep,
            requiresApproval: escalation.requiresApproval,
          };

          // Mark step as running
          const runningSteps: TaskStep[] = currentTask.steps.map((s) =>
            s.id === nextStep.id
              ? { ...s, status: "running", startedAt: new Date().toISOString() }
              : s
          );
          const withRunningStep: CollaborativeTask = {
            ...currentTask,
            steps: runningSteps,
            feedbackStage: Math.max(currentTask.feedbackStage, 8),
            progress: calculateTaskProgress(runningSteps),
            updatedAt: new Date().toISOString(),
          };
          setTasks((prev) => prev.map((t) => (t.id === taskId ? withRunningStep : t)));
          setAgentVisualStatus(nextStep.assignedAgent, "working", nextStep.title);
          syncWorkflowNodeStatus(taskId, "running", nextStep.assignedAgent);

          setMessages((prev) => [
            ...prev,
            {
              id: generateId("msg"),
              conversationId: currentTask.conversationId,
              senderRole: nextStep.assignedAgent,
              senderName: formatAgentName(nextStep.assignedAgent),
              messageType: "activity_update",
              content: `I'm starting Step ${nextStep.order + 1}: "${nextStep.title}".`,
              taskId,
              isSimulated: currentTask.isSimulated,
              createdAt: new Date().toISOString(),
            },
          ]);

          // Short readable delay so humans can observe live status & hit Pause/Stop if desired
          await new Promise((r) => setTimeout(r, 650));

          if (pausedOrCancelledRef.current.has(taskId)) {
            setTasks((prev) =>
              prev.map((t) =>
                t.id === taskId
                  ? {
                      ...t,
                      steps: t.steps.map((s) =>
                        s.id === nextStep.id && s.status === "running"
                          ? { ...s, status: "pending" }
                          : s
                      ),
                    }
                  : t
              )
            );
            setAgentVisualStatus(nextStep.assignedAgent, "online", null);
            break;
          }

          const priorOutputs = currentTask.steps
            .filter((s) => s.status === "completed" && s.output)
            .map((s) => `[Step ${s.order + 1}: ${s.title}]\n${s.output}`);

          const controller = new AbortController();
          abortControllersRef.current.set(taskId, controller);

          let res: Response;
          try {
            res = await fetch("/api/agents/execute-step", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              signal: controller.signal,
              body: JSON.stringify({
                taskId,
                objective: currentTask.objective,
                step: effectiveStep,
                allSteps: currentTask.steps,
                priorOutputs,
                sharedContext: currentTask.sharedContext,
                escalationReason: escalation.reason,
                humanDecisionNote,
                forceDemo: settingsRef.current.forceDemoMode,
                sessionId: currentTask.conversationId,
              }),
            });
          } catch (fetchErr) {
            // Mid-flight human interrupt via AbortController: cleanly reset step to pending without failing
            if (
              (fetchErr instanceof DOMException && fetchErr.name === "AbortError") ||
              pausedOrCancelledRef.current.has(taskId)
            ) {
              setTasks((prev) =>
                prev.map((t) =>
                  t.id === taskId
                    ? {
                        ...t,
                        steps: t.steps.map((s) =>
                          s.id === nextStep.id && s.status === "running"
                            ? { ...s, status: "pending" }
                            : s
                        ),
                      }
                    : t
                )
              );
              setAgentVisualStatus(nextStep.assignedAgent, "online", null);
              break;
            }
            throw fetchErr;
          } finally {
            abortControllersRef.current.delete(taskId);
          }

          if (!res.ok) {
            const errBody = await res.json().catch(() => ({}));
            throw new Error(errBody.error || `Step execution API failed (HTTP ${res.status})`);
          }

          const data = await res.json();

          // Check if human approval gate triggered (with duplicate approval guard)
          if (data.gated && data.approvalRequest) {
            const existingDup = findExistingPendingApproval(
              approvalsRef.current,
              taskId,
              nextStep.id
            );
            const apr = existingDup ?? (data.approvalRequest as ApprovalRequest);
            const latest = tasksRef.current.find((t) => t.id === taskId) ?? withRunningStep;
            const gatedSteps: TaskStep[] = latest.steps.map((s) =>
              s.id === nextStep.id ? { ...s, status: "waiting_for_approval" } : s
            );
            const chk = createCheckpoint(latest, `Before Approval: ${nextStep.title}`);
            const waitingTask = transitionTaskStatus(
              {
                ...latest,
                steps: gatedSteps,
                progress: calculateTaskProgress(gatedSteps),
                activeApprovalId: apr.id,
                checkpoints: [...latest.checkpoints, chk],
              },
              "waiting_for_approval",
              { feedbackStage: 9 }
            );

            setTasks((prev) => prev.map((t) => (t.id === taskId ? waitingTask : t)));
            if (!existingDup) {
              setApprovals((prev) => [apr, ...prev]);
            }
            setAgentVisualStatus("execution-agent", "waiting_approval", `Awaiting approval: ${nextStep.title}`);
            syncWorkflowNodeStatus(taskId, "waiting_for_approval");

            setMessages((prev) => [
              ...prev,
              {
                id: generateId("msg"),
                conversationId: currentTask.conversationId,
                senderRole: "execution-agent",
                senderName: "Execution Agent",
                messageType: "approval_request",
                content: `**Your review is needed** before continuing with Step ${nextStep.order + 1} ("${nextStep.title}").\n\nI've prepared the next recommendation: ${apr.actionDescription}`,
                taskId,
                approvalId: apr.id,
                isSimulated: apr.isSimulated,
                createdAt: new Date().toISOString(),
              },
            ]);
            pushToast({
              tone: "warning",
              title: "Your review is needed",
              description: `Execution Agent paused at Step ${nextStep.order + 1}: ${nextStep.title}`,
            });

            logActivity({
              taskId,
              agentSlug: "execution-agent",
              category: "approval",
              title: `Approval requested: ${apr.actionTitle}`,
              detail: apr.recommendationReason,
              isSimulated: apr.isSimulated,
            });
            break; // Strictly halt until human approves/edits/rejects
          }

          // Step succeeded — record output, structured handoff, & explainability
          const latest = tasksRef.current.find((t) => t.id === taskId) ?? withRunningStep;
          const finishedSteps: TaskStep[] = latest.steps.map((s) =>
            s.id === nextStep.id
              ? {
                  ...s,
                  status: "completed",
                  output: data.output,
                  confidence:
                    typeof data.confidence === "number" ? data.confidence : s.confidence,
                  completedAt: new Date().toISOString(),
                }
              : s
          );
          const stepCheckpoint = createCheckpoint(
            { ...latest, steps: finishedSteps },
            `After Step ${nextStep.order + 1}: ${nextStep.title}`
          );

          const prevCtx: SharedTaskContext = latest.sharedContext ?? {
            objective: latest.objective,
            humanConstraints: [],
            collectedSources: [],
            handoffs: [],
            recentConversationSummary: "",
          };
          const incomingHandoff = data.handoff as AgentHandoff | undefined;
          const mergedSources = Array.from(
            new Set([
              ...prevCtx.collectedSources,
              ...(Array.isArray(data.sources) ? (data.sources as string[]) : []),
            ])
          );
          const updatedSharedContext: SharedTaskContext = {
            ...prevCtx,
            collectedSources: mergedSources,
            handoffs: incomingHandoff
              ? [...prevCtx.handoffs, incomingHandoff]
              : prevCtx.handoffs,
          };

          const updatedTask: CollaborativeTask = {
            ...latest,
            steps: finishedSteps,
            sharedContext: updatedSharedContext,
            progress: calculateTaskProgress(finishedSteps),
            finalOutput: data.isFinalReport ? data.output : latest.finalOutput,
            fallbackNotice: data.fallbackNotice || latest.fallbackNotice,
            checkpoints: [...latest.checkpoints, stepCheckpoint].slice(-10),
            updatedAt: new Date().toISOString(),
          };
          setTasks((prev) => prev.map((t) => (t.id === taskId ? updatedTask : t)));
          setAgentVisualStatus(nextStep.assignedAgent, "online", null);

          if (data.explainability) {
            setExplanations((prev) => [
              {
                ...data.explainability,
                id: generateId("exp"),
                taskId,
                createdAt: new Date().toISOString(),
              },
              ...prev,
            ]);
          }

          setMessages((prev) => [
            ...prev,
            {
              id: generateId("msg"),
              conversationId: currentTask.conversationId,
              senderRole: nextStep.assignedAgent,
              senderName:
                nextStep.assignedAgent === "research-agent"
                  ? "Research Agent"
                  : "Execution Agent",
              messageType: data.isFinalReport ? "artifact" : "chat",
              content: data.output,
              taskId,
              isSimulated: Boolean(data.isSimulated),
              createdAt: new Date().toISOString(),
            },
            ...(incomingHandoff && incomingHandoff.fromAgent !== incomingHandoff.toAgent
              ? [
                  {
                    id: generateId("msg"),
                    conversationId: currentTask.conversationId,
                    senderRole: "system" as const,
                    senderName: "Handoff",
                    messageType: "activity_update" as const,
                    content: `${formatAgentName(incomingHandoff.fromAgent)} handed context to ${formatAgentName(incomingHandoff.toAgent)}: ${incomingHandoff.summary}`,
                    taskId,
                    isSimulated: Boolean(data.isSimulated),
                    createdAt: new Date().toISOString(),
                  },
                ]
              : []),
          ]);

          logActivity({
            taskId,
            agentSlug: nextStep.assignedAgent,
            category: nextStep.assignedAgent === "research-agent" ? "research" : "execution",
            title: `Completed Step ${nextStep.order + 1}: ${nextStep.title}`,
            detail: String(data.output).slice(0, 180),
            isSimulated: Boolean(data.isSimulated),
          });

          // Clear single-use note after consuming it on the resumed step
          humanDecisionNote = undefined;
          await new Promise((r) => setTimeout(r, 350));
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "An unexpected error occurred";
        const friendlyErr = `I couldn't complete this step. Here's what happened: ${msg}`;
        setTasks((prev) =>
          prev.map((t) =>
            t.id === taskId ? { ...t, status: "failed", errorMessage: friendlyErr } : t
          )
        );
        syncWorkflowNodeStatus(taskId, "failed");
        pushToast({
          tone: "error",
          title: "I couldn't complete this step",
          description: msg,
        });
        logActivity({
          taskId,
          agentSlug: "system",
          category: "state_change",
          title: "Step could not be completed",
          detail: friendlyErr,
          isSimulated: settingsRef.current.forceDemoMode,
        });
      } finally {
        inFlightOpsRef.current.delete(`exec:${taskId}`);
        abortControllersRef.current.delete(taskId);
        setBusyTaskId(null);
      }
    },
    [logActivity, pushToast, setAgentVisualStatus, syncWorkflowNodeStatus]
  );

  const startCollaboration = useCallback(
    async (
      objective: string,
      attachments?: AttachmentItem[],
      evaluationMeta?: SharedTaskContext["evaluationMeta"]
    ): Promise<string | null> => {
      const trimmed = objective.trim();
      if (!trimmed) return null;

      const convId = generateId("conv");
      const taskId = generateId("task");
      const now = new Date().toISOString();

      const newConv: Conversation = {
        id: convId,
        title: trimmed.slice(0, 56),
        objective: trimmed,
        mode: "relay_ai",
        status: "active",
        taskId,
        isSimulated: settingsRef.current.forceDemoMode || !runtimeStatus.geminiConfigured,
        createdAt: now,
        updatedAt: now,
      };

      const initialSharedContext: SharedTaskContext = {
        objective: trimmed,
        humanConstraints: [],
        collectedSources: [],
        handoffs: [],
        recentConversationSummary: trimmed.slice(0, 200),
        evaluationMeta,
      };

      const initialTask: CollaborativeTask = {
        id: taskId,
        ownerId: session.id,
        conversationId: convId,
        title: trimmed.slice(0, 56),
        objective: trimmed,
        status: "planning",
        feedbackStage: 2,
        planApproved: false,
        progress: 5,
        confidenceScore: null,
        reasoningSummary: "Planning Agent is analyzing your objective and structuring steps...",
        alternatives: [],
        steps: [],
        checkpoints: [],
        sharedContext: initialSharedContext,
        isSimulated: newConv.isSimulated,
        interactionCount: 1,
        planEditCount: 0,
        approvalCount: 0,
        rejectionCount: 0,
        interruptCount: 0,
        startedAt: now,
        updatedAt: now,
      };

      setConversations((prev) => [newConv, ...prev]);
      setActiveConversationId(convId);
      setTasks((prev) => [initialTask, ...prev]);
      setMessages((prev) => [
        ...prev,
        {
          id: generateId("msg"),
          conversationId: convId,
          senderRole: "human",
          senderName: session.fullName,
          messageType: "chat",
          content: trimmed,
          attachments,
          taskId,
          createdAt: now,
        },
      ]);

      setAgentVisualStatus("planning-agent", "working", `Planning: ${trimmed.slice(0, 36)}`);
      setBusyTaskId(taskId);

      try {
        const attachmentsSummary = attachments?.length
          ? attachments.map((a) => `${a.name} (${a.excerpt ?? `${a.size}B`})`).join("; ")
          : undefined;

        const res = await fetch("/api/agents/plan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            objective: trimmed,
            attachmentsSummary,
            forceDemo: settingsRef.current.forceDemoMode,
            sessionId: convId,
          }),
        });

        if (!res.ok) throw new Error("Failed to generate plan");
        const plan = await res.json();

        const planSteps = (plan.steps ?? []) as TaskStep[];
        const initialHandoff: AgentHandoff = {
          id: generateId("hof"),
          fromAgent: "planning-agent",
          toAgent: planSteps[0]?.assignedAgent ?? "research-agent",
          stepId: planSteps[0]?.id,
          stepTitle: planSteps[0]?.title ?? "Initial Plan",
          summary: `Decomposed objective into ${planSteps.length} dependency-linked steps and prepared initial workflow.`,
          keyFindings: planSteps.map((s, i) => `${i + 1}. ${s.title} (${s.assignedAgent})`),
          sources: [],
          humanConstraints: [],
          createdAt: new Date().toISOString(),
        };

        const proposedTask: CollaborativeTask = {
          ...initialTask,
          title: plan.title || initialTask.title,
          status: "awaiting_plan_approval",
          feedbackStage: 4,
          confidenceScore: plan.confidenceScore ?? null,
          reasoningSummary: plan.reasoningSummary ?? "",
          alternatives: plan.alternatives ?? [],
          steps: planSteps,
          sharedContext: {
            ...initialSharedContext,
            handoffs: [initialHandoff],
          },
          fallbackNotice: plan.fallbackNotice,
          isSimulated: Boolean(plan.isSimulated),
          updatedAt: new Date().toISOString(),
        };
        proposedTask.checkpoints = [createCheckpoint(proposedTask, "Initial Proposed Plan")];

        setTasks((prev) => prev.map((t) => (t.id === taskId ? proposedTask : t)));
        setConversations((prev) =>
          prev.map((c) =>
            c.id === convId
              ? { ...c, title: proposedTask.title, isSimulated: proposedTask.isSimulated }
              : c
          )
        );

        setMessages((prev) => [
          ...prev,
          {
            id: generateId("msg"),
            conversationId: convId,
            senderRole: "planning-agent",
            senderName: "Planning Agent",
            messageType: "plan_proposal",
            content: plan.summaryMessage,
            taskId,
            isSimulated: Boolean(plan.isSimulated),
            createdAt: new Date().toISOString(),
          },
        ]);

        if (plan.explainability) {
          setExplanations((prev) => [
            {
              ...plan.explainability,
              id: generateId("exp"),
              taskId,
              createdAt: new Date().toISOString(),
            },
            ...prev,
          ]);
        }

        setAgents((prev) =>
          prev.map((a) =>
            a.slug === "planning-agent"
              ? {
                  ...a,
                  status: a.status === "offline" ? "offline" : "online",
                  currentTaskLabel: null,
                  tasksCompleted: a.tasksCompleted + 1,
                }
              : a
          )
        );

        logActivity({
          taskId,
          agentSlug: "planning-agent",
          category: "plan",
          title: `Proposed ${proposedTask.steps.length}-step plan: ${proposedTask.title}`,
          detail: proposedTask.reasoningSummary,
          isSimulated: proposedTask.isSimulated,
        });

        // Honor Settings: if requirePlanApproval is disabled, auto-approve and run
        if (!settingsRef.current.requirePlanApproval) {
          const autoRunning = transitionTaskStatus(
            { ...proposedTask, planApproved: true },
            "running",
            { feedbackStage: 7 }
          );
          setTasks((prev) => prev.map((t) => (t.id === taskId ? autoRunning : t)));
          tasksRef.current = tasksRef.current.map((t) => (t.id === taskId ? autoRunning : t));
          setBusyTaskId(null);
          await executeStepsLoop(taskId);
        }

        return taskId;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Plan generation error";
        setTasks((prev) =>
          prev.map((t) => (t.id === taskId ? { ...t, status: "failed", errorMessage: msg } : t))
        );
        setAgentVisualStatus("planning-agent", "online", null);
        return null;
      } finally {
        inFlightOpsRef.current.delete(`exec:${taskId}`);
        abortControllersRef.current.delete(taskId);
        setBusyTaskId(null);
      }
    },
    [
      executeStepsLoop,
      logActivity,
      runtimeStatus.geminiConfigured,
      session.fullName,
      session.id,
      setAgentVisualStatus,
    ]
  );

  const startEvaluationRelayTrial = useCallback(
    async (participantCode: string, template: StandardizedTestTask) => {
      return startCollaboration(template.initialPrompt, undefined, {
        participantCode: participantCode.trim() || "P01",
        taskTemplateId: template.id,
        midTaskChangePrompt: template.midTaskChangePrompt,
        midTaskChangeInjected: false,
      });
    },
    [startCollaboration]
  );

  const startMidTaskPivotDemo = useCallback(async () => {
    return startCollaboration(
      "Prepare a renewable energy strategy report for a utility grid expansion.",
      undefined,
      {
        participantCode: "HAI-DEMO",
        taskTemplateId: "task_renewable_report",
        midTaskChangePrompt:
          "MID-TASK PIVOT: Target region changed to Northern Europe (low winter solar). Prioritize 24/7 firm baseload (Offshore Wind + Enhanced Geothermal + Hydro) and add a regulatory risk review step.",
        midTaskChangeInjected: false,
      }
    );
  }, [startCollaboration]);

  const askTaskClarification = useCallback(
    async (taskId: string, question: string) => {
      const task = tasksRef.current.find((t) => t.id === taskId);
      const q = question.trim();
      if (!task || !q) return;

      setMessages((prev) => [
        ...prev,
        {
          id: generateId("msg"),
          conversationId: task.conversationId,
          senderRole: "human",
          senderName: session.fullName,
          messageType: "chat",
          content: q,
          taskId,
          createdAt: new Date().toISOString(),
        },
      ]);

      setTasks((prev) =>
        prev.map((t) =>
          t.id === taskId
            ? { ...t, interactionCount: t.interactionCount + 1, updatedAt: new Date().toISOString() }
            : t
        )
      );

      const stepsSummary = task.steps
        .map((s, i) => `${i + 1}. [${s.status}] ${s.title}: ${s.description}`)
        .join("\n");

      try {
        const res = await fetch("/api/agents/ask", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: "clarify",
            objective: task.objective,
            taskStatus: task.status,
            stepsSummary,
            constraints: task.sharedContext?.humanConstraints ?? [],
            question: q,
            forceDemo: settingsRef.current.forceDemoMode,
          }),
        });
        const data = await res.json();
        setMessages((prev) => [
          ...prev,
          {
            id: generateId("msg"),
            conversationId: task.conversationId,
            senderRole: "planning-agent",
            senderName: "Planning Agent",
            messageType: "chat",
            content: data.answer || data.error || "I couldn't answer that right now. Please try again.",
            taskId,
            isSimulated: Boolean(data.isSimulated),
            createdAt: new Date().toISOString(),
          },
        ]);
      } catch (err) {
        setMessages((prev) => [
          ...prev,
          {
            id: generateId("msg"),
            conversationId: task.conversationId,
            senderRole: "planning-agent",
            senderName: "Planning Agent",
            messageType: "chat",
            content: `I couldn't get a reply right now. Here's what happened: ${
              err instanceof Error ? err.message : "connection interrupted"
            }. Please try asking again.`,
            taskId,
            createdAt: new Date().toISOString(),
          },
        ]);
      }
    },
    [session.fullName]
  );

  const interruptAndModifyRequirements = useCallback(
    (taskId: string, requirementChange: string) => {
      const task = tasksRef.current.find((t) => t.id === taskId);
      const trimmed = requirementChange.trim();
      if (!task || !trimmed) return;

      if (isUnclearChangeInput(trimmed)) {
        setMessages((prev) => [
          ...prev,
          {
            id: generateId("msg"),
            conversationId: task.conversationId,
            senderRole: "human",
            senderName: session.fullName,
            messageType: "chat",
            content: trimmed,
            taskId,
            createdAt: new Date().toISOString(),
          },
          {
            id: generateId("msg"),
            conversationId: task.conversationId,
            senderRole: "planning-agent",
            senderName: "Planning Agent",
            messageType: "chat",
            content:
              "I'm not sure what you'd like me to change. Could you tell me a little more about your goal, or let me know which step you'd like to adjust? Your current plan hasn't been changed.",
            taskId,
            createdAt: new Date().toISOString(),
          },
        ]);
        return;
      }

      // Abort any active in-flight network step call immediately
      if (task.status === "running") {
        pausedOrCancelledRef.current.add(taskId);
        abortControllersRef.current.get(taskId)?.abort();
      }

      const chk = createCheckpoint(task, "Before Requirement Change");
      const resetRunningSteps = task.steps.map((s) =>
        s.status === "running" ? { ...s, status: "pending" as const } : s
      );
      const withUpdatedRemaining = updateRemainingStepsWithRequirement(
        {
          ...task,
          steps: resetRunningSteps,
          checkpoints: [...task.checkpoints, chk].slice(-10),
          interruptCount: task.status === "running" ? task.interruptCount + 1 : task.interruptCount,
        },
        trimmed
      );

      // Mark evaluation mid-task change injected if applicable
      if (withUpdatedRemaining.sharedContext?.evaluationMeta) {
        withUpdatedRemaining.sharedContext = {
          ...withUpdatedRemaining.sharedContext,
          evaluationMeta: {
            ...withUpdatedRemaining.sharedContext.evaluationMeta,
            midTaskChangeInjected: true,
          },
        };
      }

      const prevDescById = new Map(task.steps.map((s) => [s.id, s.description]));
      const affectedStepTitles = withUpdatedRemaining.steps
        .filter((s) => !prevDescById.has(s.id) || prevDescById.get(s.id) !== s.description)
        .map((s) => `Step ${s.order + 1}: ${s.title}`);
      const preservedStepCount = withUpdatedRemaining.steps.filter(
        (s) => s.status === "completed" || s.isLocked
      ).length;
      const requiresReapproval = task.planApproved;

      const changeSummary: RequirementChangeSummary = {
        id: generateId("chg"),
        changeText: trimmed,
        affectedStepTitles,
        preservedStepCount,
        requiresReapproval,
        approvedAfterChange: false,
        createdAt: new Date().toISOString(),
      };

      // Never silently continue an approved plan after requirements change:
      // pause & require explicit plan review if it was previously approved.
      let nextTask: CollaborativeTask = {
        ...withUpdatedRemaining,
        planApproved: requiresReapproval ? false : withUpdatedRemaining.planApproved,
        lastRequirementChange: changeSummary,
        feedbackStage: 6,
      };
      if (nextTask.status === "running") {
        nextTask = transitionTaskStatus(nextTask, "paused", { feedbackStage: 6 });
      }
      if (requiresReapproval && nextTask.status === "paused") {
        nextTask = transitionTaskStatus(nextTask, "awaiting_plan_approval", { feedbackStage: 6 });
      }

      setTasks((prev) => prev.map((t) => (t.id === taskId ? nextTask : t)));
      tasksRef.current = tasksRef.current.map((t) => (t.id === taskId ? nextTask : t));

      setMessages((prev) => [
        ...prev,
        {
          id: generateId("msg"),
          conversationId: task.conversationId,
          senderRole: "human",
          senderName: session.fullName,
          messageType: "chat",
          content: trimmed,
          taskId,
          createdAt: new Date().toISOString(),
        },
        {
          id: generateId("msg"),
          conversationId: task.conversationId,
          senderRole: "planning-agent",
          senderName: "Planning Agent",
          messageType: "chat",
          content: `I've paused work and updated **${affectedStepTitles.length} remaining step(s)** to reflect your change while keeping ${preservedStepCount} completed or locked step(s) intact.${
            requiresReapproval
              ? " Because your previously approved plan changed, please review the updated steps on the right and approve before I continue."
              : " Review the updated steps on the right whenever you're ready."
          }`,
          taskId,
          createdAt: new Date().toISOString(),
        },
      ]);

      pushToast({
        tone: "info",
        title: requiresReapproval ? "Plan updated — review needed" : "Requirements updated",
        description: `${affectedStepTitles.length} step(s) updated. Saved a restore checkpoint.`,
      });

      logActivity({
        taskId,
        agentSlug: "human",
        category: "human_edit",
        title: "Updated requirements mid-workflow",
        detail: `${trimmed} (${affectedStepTitles.length} step(s) affected)`,
        isSimulated: false,
      });
    },
    [logActivity, pushToast, session.fullName]
  );

  const mutatePlan = useCallback(
    (taskId: string, mutation: PlanMutation) => {
      setTasks((prev) =>
        prev.map((t) => {
          if (t.id !== taskId) return t;
          try {
            return applyPlanMutation(t, mutation, session.id);
          } catch {
            return t;
          }
        })
      );
      const actionLabel: Record<PlanMutation["type"], string> = {
        add: "Added a new step to your plan",
        edit: "Saved changes to step",
        delete: "Removed step from plan",
        reorder: "Updated step order",
        toggle_lock: "Updated step lock",
      };
      pushToast({
        tone: "success",
        title: actionLabel[mutation.type],
      });
      logActivity({
        taskId,
        agentSlug: "human",
        category: "human_edit",
        title: actionLabel[mutation.type],
        detail: `Collaborator updated the plan (${mutation.type}).`,
        isSimulated: false,
      });
    },
    [logActivity, pushToast, session.id]
  );

  const adaptPlanWithFeedback = useCallback(
    async (taskId: string, feedback: string) => {
      const task = tasksRef.current.find((t) => t.id === taskId);
      const trimmed = feedback.trim();
      if (!task || !trimmed) return;

      if (isUnclearChangeInput(trimmed)) {
        setMessages((prev) => [
          ...prev,
          {
            id: generateId("msg"),
            conversationId: task.conversationId,
            senderRole: "planning-agent",
            senderName: "Planning Agent",
            messageType: "chat",
            content:
              "I'm not sure what you'd like me to change. Could you tell me a little more about your goal, or let me know which step you'd like to update?",
            taskId,
            createdAt: new Date().toISOString(),
          },
        ]);
        return;
      }

      setBusyTaskId(taskId);
      setAgentVisualStatus("planning-agent", "working", "Updating your plan");

      try {
        const res = await fetch("/api/agents/plan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            objective: task.objective,
            existingSteps: task.steps,
            humanFeedback: trimmed,
            forceDemo: settingsRef.current.forceDemoMode,
            sessionId: task.conversationId,
          }),
        });
        if (!res.ok) throw new Error("Plan update request failed");
        const adapted = await res.json();
        const nextSteps = (adapted.steps ?? task.steps) as TaskStep[];

        const prevDescById = new Map(task.steps.map((s) => [s.id, s.description]));
        const affectedStepTitles = nextSteps
          .filter((s) => !prevDescById.has(s.id) || prevDescById.get(s.id) !== s.description)
          .map((s) => `Step ${s.order + 1}: ${s.title}`);
        const preservedStepCount = nextSteps.filter(
          (s) => s.status === "completed" || s.isLocked
        ).length;
        const requiresReapproval = task.planApproved;

        const changeSummary: RequirementChangeSummary = {
          id: generateId("chg"),
          changeText: trimmed,
          affectedStepTitles:
            affectedStepTitles.length > 0
              ? affectedStepTitles
              : nextSteps.filter((s) => !s.isLocked && s.status === "pending").map((s) => `Step ${s.order + 1}: ${s.title}`),
          preservedStepCount,
          requiresReapproval,
          approvedAfterChange: false,
          createdAt: new Date().toISOString(),
        };

        let updated: CollaborativeTask = {
          ...task,
          steps: nextSteps,
          reasoningSummary: adapted.reasoningSummary ?? task.reasoningSummary,
          confidenceScore: adapted.confidenceScore ?? task.confidenceScore,
          alternatives: adapted.alternatives ?? task.alternatives,
          planApproved: requiresReapproval ? false : task.planApproved,
          lastRequirementChange: changeSummary,
          feedbackStage: 6,
          planEditCount: task.planEditCount + 1,
          interactionCount: task.interactionCount + 1,
          checkpoints: [
            ...task.checkpoints,
            createCheckpoint({ ...task, steps: nextSteps }, "Updated Plan"),
          ],
          updatedAt: new Date().toISOString(),
        };
        if (requiresReapproval && updated.status === "paused") {
          updated = transitionTaskStatus(updated, "awaiting_plan_approval", { feedbackStage: 6 });
        }

        setTasks((prev) => prev.map((t) => (t.id === taskId ? updated : t)));
        setAgents((prev) =>
          prev.map((a) =>
            a.slug === "planning-agent"
              ? {
                  ...(settingsRef.current.adaptiveAutonomyEnabled
                    ? updateAgentAdaptiveAutonomy(a, true)
                    : a),
                  status: "online",
                  currentTaskLabel: null,
                }
              : a
          )
        );

        setMessages((prev) => [
          ...prev,
          {
            id: generateId("msg"),
            conversationId: task.conversationId,
            senderRole: "planning-agent",
            senderName: "Planning Agent",
            messageType: "plan_proposal",
            content: adapted.summaryMessage,
            taskId,
            isSimulated: Boolean(adapted.isSimulated),
            createdAt: new Date().toISOString(),
          },
        ]);

        if (adapted.explainability) {
          setExplanations((prev) => [
            {
              ...adapted.explainability,
              id: generateId("exp"),
              taskId,
              createdAt: new Date().toISOString(),
            },
            ...prev,
          ]);
        }

        pushToast({
          tone: "info",
          title: requiresReapproval ? "Plan updated — review needed" : "Plan updated",
          description: `${changeSummary.affectedStepTitles.length} step(s) updated.`,
        });

        logActivity({
          taskId,
          agentSlug: "planning-agent",
          category: "plan",
          title: "Updated plan from your feedback",
          detail: trimmed,
          isSimulated: Boolean(adapted.isSimulated),
        });
      } finally {
        setBusyTaskId(null);
        setAgentVisualStatus("planning-agent", "online", null);
      }
    },
    [logActivity, pushToast, setAgentVisualStatus]
  );

  const sendHumanMessage = useCallback(
    async (conversationId: string, content: string, attachments?: AttachmentItem[]) => {
      const trimmed = content.trim();
      if (!trimmed) return;
      const conv = conversations.find((c) => c.id === conversationId);
      const linkedTask = tasksRef.current.find((t) => t.conversationId === conversationId);

      setMessages((prev) => [
        ...prev,
        {
          id: generateId("msg"),
          conversationId,
          senderRole: "human",
          senderName: session.fullName,
          messageType: "chat",
          content: trimmed,
          attachments,
          taskId: linkedTask?.id,
          createdAt: new Date().toISOString(),
        },
      ]);

      if (!conv || !linkedTask || linkedTask.status === "completed" || linkedTask.status === "cancelled") {
        await startCollaboration(trimmed, attachments);
        return;
      }

      if (linkedTask.status === "running") {
        interruptAndModifyRequirements(linkedTask.id, trimmed);
        return;
      }

      // Treat pre-execution / paused chat messages as live human feedback adapting the plan
      await adaptPlanWithFeedback(linkedTask.id, trimmed);
    },
    [adaptPlanWithFeedback, conversations, interruptAndModifyRequirements, session.fullName, startCollaboration]
  );

  const approvePlanAndExecute = useCallback(
    async (taskId: string) => {
      const task = tasksRef.current.find((t) => t.id === taskId);
      if (!task) return;

      const withApproval: CollaborativeTask = {
        ...task,
        planApproved: true,
        lastRequirementChange: task.lastRequirementChange
          ? { ...task.lastRequirementChange, approvedAfterChange: true }
          : task.lastRequirementChange,
        approvalCount: task.approvalCount + 1,
        interactionCount: task.interactionCount + 1,
        checkpoints: [...task.checkpoints, createCheckpoint(task, "Approved Plan Baseline")],
      };

      const runningTask = transitionTaskStatus(withApproval, "running", {
        feedbackStage: 7,
      });

      setTasks((prev) => prev.map((t) => (t.id === taskId ? runningTask : t)));
      tasksRef.current = tasksRef.current.map((t) => (t.id === taskId ? runningTask : t));

      setMessages((prev) => [
        ...prev,
        {
          id: generateId("msg"),
          conversationId: task.conversationId,
          senderRole: "system",
          senderName: "Workflow Update",
          messageType: "activity_update",
          content: `Plan approved. I'm starting the task now (${task.steps.length} steps) and will pause for your review before major decisions.`,
          taskId,
          createdAt: new Date().toISOString(),
        },
      ]);

      pushToast({
        tone: "success",
        title: "Plan approved",
        description: "I'm starting the task now.",
      });

      logActivity({
        taskId,
        agentSlug: "human",
        category: "approval",
        title: `Plan approved: ${task.title}`,
        detail: `Authorized ${task.steps.length} steps to begin.`,
        isSimulated: false,
      });

      await executeStepsLoop(taskId);
    },
    [executeStepsLoop, logActivity, pushToast]
  );

  const rejectPlan = useCallback(
    (taskId: string, reason: string) => {
      const task = tasksRef.current.find((t) => t.id === taskId);
      if (!task) return;

      setTasks((prev) =>
        prev.map((t) =>
          t.id === taskId
            ? {
                ...t,
                planApproved: false,
                rejectionCount: t.rejectionCount + 1,
                interactionCount: t.interactionCount + 1,
                feedbackStage: 5,
                updatedAt: new Date().toISOString(),
              }
            : t
        )
      );

      setAgents((prev) =>
        prev.map((a) =>
          a.slug === "planning-agent" ? updateAgentAdaptiveAutonomy(a, true) : a
        )
      );

      setMessages((prev) => [
        ...prev,
        {
          id: generateId("msg"),
          conversationId: task.conversationId,
          senderRole: "system",
          senderName: "Workflow Update",
          messageType: "activity_update",
          content: `Plan held for adjustments ("${reason || "Needs revision"}"). Edit steps on the right or tell me what you'd like changed.`,
          taskId,
          createdAt: new Date().toISOString(),
        },
      ]);

      pushToast({
        tone: "info",
        title: "Plan held for edits",
        description: "Edit steps on the right or describe what to adjust.",
      });

      logActivity({
        taskId,
        agentSlug: "human",
        category: "approval",
        title: `Plan held for changes: ${task.title}`,
        detail: reason || "Requested plan revisions before starting.",
        isSimulated: false,
      });
    },
    [logActivity, pushToast]
  );

  const pauseTask = useCallback(
    (taskId: string) => {
      const task = tasksRef.current.find((t) => t.id === taskId);
      if (!task || (task.status !== "running" && task.status !== "waiting_for_approval")) return;
      pausedOrCancelledRef.current.add(taskId);
      abortControllersRef.current.get(taskId)?.abort();

      const paused = transitionTaskStatus(
        { ...task, interruptCount: task.interruptCount + 1, interactionCount: task.interactionCount + 1 },
        "paused"
      );
      setTasks((prev) => prev.map((t) => (t.id === taskId ? paused : t)));
      pushToast({
        tone: "info",
        title: "Workflow paused",
        description: "You can edit steps or resume whenever you're ready.",
      });
      logActivity({
        taskId,
        agentSlug: "human",
        category: "state_change",
        title: `Paused workflow: ${task.title}`,
        detail: "Paused by collaborator.",
        isSimulated: false,
      });
    },
    [logActivity, pushToast]
  );

  const resumeTask = useCallback(
    async (taskId: string) => {
      const task = tasksRef.current.find((t) => t.id === taskId);
      if (!task || task.status !== "paused") return;
      const pendingApproval = approvals.find(
        (a) => a.id === task.activeApprovalId && a.status === "pending"
      );
      if (pendingApproval) {
        const backToWait = { ...task, status: "waiting_for_approval" as const };
        setTasks((prev) => prev.map((t) => (t.id === taskId ? backToWait : t)));
        return;
      }

      const resumed = transitionTaskStatus(
        { ...task, interactionCount: task.interactionCount + 1 },
        "running"
      );
      setTasks((prev) => prev.map((t) => (t.id === taskId ? resumed : t)));
      tasksRef.current = tasksRef.current.map((t) => (t.id === taskId ? resumed : t));
      logActivity({
        taskId,
        agentSlug: "human",
        category: "state_change",
        title: `Resumed execution: ${task.title}`,
        detail: "Human resumed collaborative agent workflow.",
        isSimulated: false,
      });

      await executeStepsLoop(taskId);
    },
    [approvals, executeStepsLoop, logActivity]
  );

  const retryFailedTask = useCallback(
    async (taskId: string) => {
      const task = tasksRef.current.find((t) => t.id === taskId);
      if (!task || task.status !== "failed") return;
      const resetSteps: TaskStep[] = task.steps.map((s) =>
        s.status === "failed" || s.status === "running"
          ? { ...s, status: "pending" }
          : s
      );
      const restarted = transitionTaskStatus(
        {
          ...task,
          steps: resetSteps,
          planApproved: true,
          errorMessage: undefined,
          interactionCount: task.interactionCount + 1,
        },
        "running"
      );
      setTasks((prev) => prev.map((t) => (t.id === taskId ? restarted : t)));
      tasksRef.current = tasksRef.current.map((t) => (t.id === taskId ? restarted : t));
      logActivity({
        taskId,
        agentSlug: "human",
        category: "state_change",
        title: `Retried failed task: ${task.title}`,
        detail: "Human triggered recovery execution from failed state.",
        isSimulated: task.isSimulated,
      });
      await executeStepsLoop(taskId);
    },
    [executeStepsLoop, logActivity]
  );

  const skipFailedStep = useCallback(
    async (taskId: string, stepId: string) => {
      const task = tasksRef.current.find((t) => t.id === taskId);
      if (!task) return;
      const withSkipped = skipStepWithDependencyDisclosure(task, stepId, session.id);
      const nextTask = transitionTaskStatus(withSkipped, "running");
      setTasks((prev) => prev.map((t) => (t.id === taskId ? nextTask : t)));
      tasksRef.current = tasksRef.current.map((t) => (t.id === taskId ? nextTask : t));
      const skippedStep = task.steps.find((s) => s.id === stepId);
      setMessages((prev) => [
        ...prev,
        {
          id: generateId("msg"),
          conversationId: task.conversationId,
          senderRole: "system",
          senderName: "Orchestrator",
          messageType: "activity_update",
          content: `Human skipped step **"${skippedStep?.title ?? stepId}"** to recover execution. Downstream dependent steps were explicitly notified that this upstream input is missing.`,
          taskId,
          createdAt: new Date().toISOString(),
        },
      ]);
      logActivity({
        taskId,
        agentSlug: "human",
        category: "state_change",
        title: "Skipped blocked/failed step & resumed",
        detail: `Human skipped "${skippedStep?.title ?? stepId}" with downstream missing-evidence disclosure.`,
        isSimulated: false,
      });
      await executeStepsLoop(taskId);
    },
    [executeStepsLoop, logActivity, session.id]
  );

  const cancelTask = useCallback(
    (taskId: string) => {
      const task = tasksRef.current.find((t) => t.id === taskId);
      if (!task || task.status === "completed" || task.status === "cancelled") return;
      pausedOrCancelledRef.current.add(taskId);
      abortControllersRef.current.get(taskId)?.abort();
      const cancelled = transitionTaskStatus(
        { ...task, interruptCount: task.interruptCount + 1 },
        "cancelled"
      );
      setTasks((prev) => prev.map((t) => (t.id === taskId ? cancelled : t)));
      logActivity({
        taskId,
        agentSlug: "human",
        category: "state_change",
        title: `Stopped task: ${task.title}`,
        detail: "Human cancelled task execution.",
        isSimulated: false,
      });
    },
    [logActivity]
  );

  const rollbackTask = useCallback(
    (taskId: string, checkpointId: string) => {
      const task = tasksRef.current.find((t) => t.id === taskId);
      if (!task) return;
      pausedOrCancelledRef.current.add(taskId);
      const restored = rollbackToCheckpoint(task, checkpointId);
      setTasks((prev) => prev.map((t) => (t.id === taskId ? restored : t)));
      pushToast({
        tone: "info",
        title: "Checkpoint restored",
        description: "Restored your workflow to the selected earlier snapshot.",
      });
      logActivity({
        taskId,
        agentSlug: "human",
        category: "state_change",
        title: "Checkpoint restored",
        detail: `Restored "${task.title}" to an earlier snapshot.`,
        isSimulated: false,
      });
    },
    [logActivity, pushToast]
  );

  const decideApproval = useCallback(
    async (
      approvalId: string,
      decision: Exclude<ApprovalStatus, "pending">,
      feedback?: string,
      selectedAlternative?: string
    ) => {
      const approval = approvals.find((a) => a.id === approvalId);
      if (!approval || approval.status !== "pending") return;
      const task = tasksRef.current.find((t) => t.id === approval.taskId);
      if (!task) return;

      const { updatedTask, updatedApproval } = resolveApprovalDecision(
        task,
        approval,
        decision,
        feedback,
        selectedAlternative,
        session.id
      );

      setApprovals((prev) => prev.map((a) => (a.id === approvalId ? updatedApproval : a)));
      setTasks((prev) => prev.map((t) => (t.id === task.id ? updatedTask : t)));
      tasksRef.current = tasksRef.current.map((t) => (t.id === task.id ? updatedTask : t));

      const wasOverridden = decision === "rejected" || decision === "edited_and_approved";
      setAgents((prev) =>
        prev.map((a) =>
          a.slug === approval.agentSlug
            ? {
                ...(settingsRef.current.adaptiveAutonomyEnabled
                  ? updateAgentAdaptiveAutonomy(a, wasOverridden)
                  : a),
                status: "online",
                currentTaskLabel: null,
              }
            : a
        )
      );

      const decisionLabel =
        decision === "approved"
          ? "Approved"
          : decision === "edited_and_approved"
          ? "Edited & Approved"
          : "Rejected & Redirected";

      const steeringSummary =
        selectedAlternative || feedback || `Human ${decisionLabel.toLowerCase()} agent recommendation.`;

      setMessages((prev) => [
        ...prev,
        {
          id: generateId("msg"),
          conversationId: task.conversationId,
          senderRole: "system",
          senderName: "Workflow Update",
          messageType: "activity_update",
          content: `Got it — you ${decisionLabel.toLowerCase()} "${approval.actionTitle}". ${steeringSummary} Continuing with the next step now.`,
          taskId: task.id,
          approvalId: approval.id,
          createdAt: new Date().toISOString(),
        },
      ]);

      pushToast({
        tone: decision === "rejected" ? "info" : "success",
        title: `${decisionLabel}`,
        description: `Continuing "${task.title}" with your direction.`,
      });

      logActivity({
        taskId: task.id,
        agentSlug: "human",
        category: "approval",
        title: `${decisionLabel}: ${approval.actionTitle}`,
        detail: steeringSummary,
        isSimulated: false,
      });

      await executeStepsLoop(task.id, `${decisionLabel}: ${steeringSummary}`);
    },
    [approvals, executeStepsLoop, logActivity, pushToast, session.id]
  );

  const askApprovalQuestion = useCallback(
    async (approvalId: string, question: string) => {
      const approval = approvals.find((a) => a.id === approvalId);
      if (!approval || !question.trim()) return;

      const res = await fetch("/api/agents/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          approval,
          question: question.trim(),
          forceDemo: settingsRef.current.forceDemoMode,
        }),
      });
      const data = await res.json();
      setApprovals((prev) =>
        prev.map((a) =>
          a.id === approvalId
            ? {
                ...a,
                qaThread: [
                  ...a.qaThread,
                  {
                    id: generateId("qa"),
                    question: question.trim(),
                    answer: data.answer || "No answer returned.",
                    createdAt: new Date().toISOString(),
                  },
                ],
              }
            : a
        )
      );
    },
    [approvals]
  );

  const toggleAgentActive = useCallback(
    (slug: AgentSlug) => {
      setAgents((prev) =>
        prev.map((a) => {
          if (a.slug !== slug) return a;
          const next = a.status === "paused" || a.status === "offline" ? "online" : "paused";
          pushToast({
            tone: "info",
            title: `${a.name} is now ${next === "online" ? "available" : "paused"}`,
          });
          logActivity({
            agentSlug: slug,
            category: "state_change",
            title: `${a.name} set to ${next === "online" ? "available" : "paused"}`,
            detail: "Updated agent availability in Agents.",
            isSimulated: false,
          });
          return { ...a, status: next, lastActiveAt: new Date().toISOString() };
        })
      );
    },
    [logActivity, pushToast]
  );

  const updateAgentAutonomy = useCallback((slug: AgentSlug, level: number) => {
    setAgents((prev) =>
      prev.map((a) =>
        a.slug === slug
          ? { ...a, autonomyLevel: Math.max(0.2, Math.min(0.95, level)) }
          : a
      )
    );
  }, []);

  const saveWorkflow = useCallback(
    (workflow: SavedWorkflow) => {
      setWorkflows((prev) => {
        const exists = prev.some((w) => w.id === workflow.id);
        const next = exists
          ? prev.map((w) => (w.id === workflow.id ? { ...workflow, updatedAt: new Date().toISOString() } : w))
          : [{ ...workflow, updatedAt: new Date().toISOString() }, ...prev];
        return next;
      });
      logActivity({
        agentSlug: "human",
        category: "workflow",
        title: `Saved visual workflow: ${workflow.name}`,
        detail: `${workflow.nodes.length} nodes and ${workflow.edges.length} connections persisted.`,
        isSimulated: false,
      });
    },
    [logActivity]
  );

  const deleteWorkflow = useCallback((workflowId: string) => {
    setWorkflows((prev) => prev.filter((w) => w.id !== workflowId));
  }, []);

  const executeWorkflow = useCallback(
    async (workflowId: string): Promise<string | null> => {
      const wf = workflows.find((w) => w.id === workflowId);
      if (!wf) return null;

      const inputNode = wf.nodes.find((n) => n.data.kind === "human_input");
      const objective =
        inputNode?.data.instructions?.trim() ||
        inputNode?.data.description?.trim() ||
        wf.name;

      const convId = generateId("conv");
      const taskId = generateId("task");
      const now = new Date().toISOString();

      // Convert visual workflow nodes into executable TaskSteps in true topological edge order
      const sortedNodes = sortWorkflowNodesTopologically(wf.nodes, wf.edges).filter(
        (n) => n.data.kind !== "human_input"
      );

      const stepIds = sortedNodes.map(() => generateId("step"));
      const steps: TaskStep[] = sortedNodes.map((node, idx) => ({
        id: stepIds[idx],
        order: idx,
        title: node.data.label,
        description: node.data.instructions || node.data.description,
        assignedAgent:
          node.data.kind === "research_agent"
            ? "research-agent"
            : node.data.kind === "planning_agent"
            ? "planning-agent"
            : "execution-agent",
        priority: node.data.kind === "human_approval" ? "high" : "medium",
        status: "pending",
        requiresApproval:
          node.data.kind === "human_approval" || Boolean(node.data.requiresApproval),
        isLocked: false,
        editedByHuman: false,
        confidence: 0.89,
        dependencies: idx > 0 ? [stepIds[idx - 1]] : [],
      }));

      const isSim = settingsRef.current.forceDemoMode || !runtimeStatus.geminiConfigured;

      const newConv: Conversation = {
        id: convId,
        title: `[Workflow] ${wf.name}`,
        objective,
        mode: "relay_ai",
        status: "active",
        taskId,
        isSimulated: isSim,
        createdAt: now,
        updatedAt: now,
      };

      const wfTask: CollaborativeTask = {
        id: taskId,
        conversationId: convId,
        title: wf.name,
        objective,
        status: "running",
        feedbackStage: 7,
        planApproved: true,
        progress: 0,
        confidenceScore: 0.89,
        reasoningSummary: `Compiled directly from visual workflow "${wf.name}" (${steps.length} stages).`,
        alternatives: [],
        steps,
        checkpoints: [],
        isSimulated: isSim,
        interactionCount: 1,
        planEditCount: 0,
        approvalCount: 1,
        rejectionCount: 0,
        interruptCount: 0,
        startedAt: now,
        updatedAt: now,
      };
      wfTask.checkpoints = [createCheckpoint(wfTask, "Visual Workflow Start")];

      setWorkflows((prev) =>
        prev.map((w) =>
          w.id === workflowId
            ? {
                ...w,
                linkedTaskId: taskId,
                lastRunStatus: "running",
                nodes: w.nodes.map((n) => ({
                  ...n,
                  data: {
                    ...n.data,
                    executionStatus: n.data.kind === "human_input" ? "completed" : "idle",
                  },
                })),
              }
            : w
        )
      );

      setConversations((prev) => [newConv, ...prev]);
      setActiveConversationId(convId);
      setTasks((prev) => [wfTask, ...prev]);
      tasksRef.current = [wfTask, ...tasksRef.current];

      setMessages((prev) => [
        ...prev,
        {
          id: generateId("msg"),
          conversationId: convId,
          senderRole: "system",
          senderName: "Visual Workflow Engine",
          messageType: "activity_update",
          content: `Executing saved workflow **"${wf.name}"** (${steps.length} connected stages).`,
          taskId,
          createdAt: now,
        },
      ]);

      logActivity({
        taskId,
        agentSlug: "system",
        category: "workflow",
        title: `Executed visual workflow: ${wf.name}`,
        detail: `Dispatched ${steps.length} workflow nodes to the orchestration engine.`,
        isSimulated: isSim,
      });

      await executeStepsLoop(taskId);
      return taskId;
    },
    [executeStepsLoop, logActivity, runtimeStatus.geminiConfigured, workflows]
  );

  const recordEvaluationRun = useCallback(
    async (run: EvaluationRun) => {
      setEvaluationRuns((prev) => [run, ...prev.filter((r) => r.id !== run.id)]);
      logActivity({
        agentSlug: "human",
        category: "evaluation",
        title: `Recorded ${run.condition === "relay_ai" ? "RELAY AI" : "Baseline"} trial (${run.participantCode})`,
        detail: `Task: ${run.taskTitle} | Time: ${run.completionTimeSec}s | Success: ${run.completedSuccessfully ? "Yes" : "No"}`,
        isSimulated: run.isSampleData,
      });

      if (settingsRef.current.telemetryPersistToDisk) {
        await fetch("/api/telemetry", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(run),
        }).catch(() => {});
      }
    },
    [logActivity]
  );

  const clearMeasuredEvaluations = useCallback(() => {
    setEvaluationRuns([]);
  }, []);

  const updateSettings = useCallback((partial: Partial<PlatformSettings>) => {
    setSettings((prev) => ({ ...prev, ...partial }));
  }, []);

  const signInDemo = useCallback(
    (email: string, fullName: string, role: UserSession["role"] = "researcher") => {
      setSession({
        id: generateId("usr"),
        email: email.trim() || "collaborator@relay-ai.local",
        fullName: fullName.trim() || "Collaborator",
        role,
        authMode: isSupabaseConfigured() ? "supabase" : "local_demo",
        authenticated: true,
      });
    },
    []
  );

  const signOutSession = useCallback(async () => {
    const sb = getSupabaseBrowserClient();
    if (sb) {
      await sb.auth.signOut().catch(() => {});
    }
    setSession((prev) => ({ ...prev, authenticated: false }));
  }, []);

  const resetWorkspace = useCallback(() => {
    pausedOrCancelledRef.current.clear();
    setAgents(INITIAL_AGENTS);
    setConversations([]);
    setActiveConversationId(null);
    setMessages([]);
    setTasks([]);
    setApprovals([]);
    setExplanations([]);
    setActivities([]);
    setWorkflows([DEFAULT_WORKFLOW]);
    setEvaluationRuns([]);
    setSettings(DEFAULT_SETTINGS);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {}
  }, []);

  const contextValue = useMemo<RelayContextValue>(
    () => ({
      agents,
      conversations,
      activeConversationId,
      messages,
      tasks,
      approvals,
      explanations,
      activities,
      workflows,
      evaluationRuns,
      settings,
      session,
      runtimeStatus,
      busyTaskId,
      isHydrated,
      toasts,
      pushToast,
      dismissToast,
      setActiveConversationId,
      startCollaboration,
      startEvaluationRelayTrial,
      startMidTaskPivotDemo,
      sendHumanMessage,
      askTaskClarification,
      interruptAndModifyRequirements,
      mutatePlan,
      adaptPlanWithFeedback,
      approvePlanAndExecute,
      rejectPlan,
      pauseTask,
      resumeTask,
      retryFailedTask,
      skipFailedStep,
      cancelTask,
      rollbackTask,
      decideApproval,
      askApprovalQuestion,
      toggleAgentActive,
      updateAgentAutonomy,
      saveWorkflow,
      deleteWorkflow,
      executeWorkflow,
      recordEvaluationRun,
      clearMeasuredEvaluations,
      updateSettings,
      signInDemo,
      signOutSession,
      resetWorkspace,
    }),
    [
      agents,
      conversations,
      activeConversationId,
      messages,
      tasks,
      approvals,
      explanations,
      activities,
      workflows,
      evaluationRuns,
      settings,
      session,
      runtimeStatus,
      busyTaskId,
      isHydrated,
      toasts,
      pushToast,
      dismissToast,
      startCollaboration,
      startEvaluationRelayTrial,
      startMidTaskPivotDemo,
      sendHumanMessage,
      askTaskClarification,
      interruptAndModifyRequirements,
      mutatePlan,
      adaptPlanWithFeedback,
      approvePlanAndExecute,
      rejectPlan,
      pauseTask,
      resumeTask,
      retryFailedTask,
      skipFailedStep,
      cancelTask,
      rollbackTask,
      decideApproval,
      askApprovalQuestion,
      toggleAgentActive,
      updateAgentAutonomy,
      saveWorkflow,
      deleteWorkflow,
      executeWorkflow,
      recordEvaluationRun,
      clearMeasuredEvaluations,
      updateSettings,
      signInDemo,
      signOutSession,
      resetWorkspace,
    ]
  );

  return (
    <RelayContext.Provider value={contextValue}>
      {children}
    </RelayContext.Provider>
  );
}

export function useRelayStore() {
  const ctx = useContext(RelayContext);
  if (!ctx) throw new Error("useRelayStore must be used inside RelayProvider");
  return ctx;
}
