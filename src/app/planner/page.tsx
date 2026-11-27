"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  addEdge,
  useNodesState,
  useEdgesState,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Activity,
  ArrowDown,
  ArrowUp,
  Edit3,
  FileOutput,
  GitBranch,
  ListChecks,
  ListTree,
  Lock,
  Play,
  Plus,
  Save,
  Search,
  ShieldAlert,
  Trash2,
  Unlock,
  User,
} from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { useRelayStore } from "@/hooks/useRelayStore";
import {
  AgentAvatar,
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  ProgressBar,
  StatusBadge,
  Textarea,
  Tooltip,
  getAgentStyle,
} from "@/components/ui/primitives";
import { cn, generateId } from "@/lib/utils/cn";
import type {
  SavedWorkflow,
  StepPriority,
  TaskStep,
  WorkflowNodeData,
  WorkflowNodeKind,
} from "@/types/relay";

const NODE_PALETTE: Array<{
  kind: WorkflowNodeKind;
  label: string;
  description: string;
  tone: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  {
    kind: "human_input",
    label: "Human Input",
    description: "Initial goal & constraints",
    tone: "border-cyan-500/35 bg-cyan-500/10 text-cyan-300",
    icon: User,
  },
  {
    kind: "planning_agent",
    label: "Planning Agent",
    description: "Organises tasks and creates structured plans",
    tone: "border-[#8b7cf6]/35 bg-[#8b7cf6]/12 text-[#c5bcff]",
    icon: ListTree,
  },
  {
    kind: "research_agent",
    label: "Research Agent",
    description: "Finds relevant information and supporting evidence",
    tone: "border-cyan-400/35 bg-cyan-500/12 text-cyan-200",
    icon: Search,
  },
  {
    kind: "human_approval",
    label: "Human Review",
    description: "Pause for your review before continuing",
    tone: "border-amber-400/35 bg-amber-500/12 text-amber-200",
    icon: ShieldAlert,
  },
  {
    kind: "execution_agent",
    label: "Execution Agent",
    description: "Carries out assigned tasks and reports progress",
    tone: "border-emerald-400/35 bg-emerald-500/12 text-emerald-200",
    icon: Activity,
  },
  {
    kind: "final_output",
    label: "Final Output",
    description: "Deliver final report",
    tone: "border-[#8b7cf6]/35 bg-[#8b7cf6]/12 text-[#c5bcff]",
    icon: FileOutput,
  },
];

type RelayFlowNode = Node<WorkflowNodeData, "relayNode">;

function RelayWorkflowNode({ data, selected }: NodeProps<RelayFlowNode>) {
  const palette = NODE_PALETTE.find((p) => p.kind === data.kind) ?? NODE_PALETTE[0];
  const Icon = palette.icon;

  return (
    <div
      className={cn(
        "w-52 rounded-xl border bg-[#11141e] p-3 shadow-card transition-colors",
        selected ? "border-violet-400" : "border-white/15 hover:border-white/25",
        data.executionStatus === "running" && "border-cyan-400",
        data.executionStatus === "waiting_for_approval" && "border-amber-400",
        data.executionStatus === "completed" && "border-emerald-400/70"
      )}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!w-2.5 !h-2.5 !bg-violet-400 !border-[#11141e]"
      />
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-2 min-w-0">
          <span className={cn("p-1 rounded-md border shrink-0", palette.tone)}>
            <Icon className="h-3.5 w-3.5" />
          </span>
          <span className="text-xs font-semibold text-white truncate">{data.label}</span>
        </div>
      </div>
      <p className="text-[11px] text-zinc-400 line-clamp-2">{data.description}</p>
      {data.executionStatus && data.executionStatus !== "idle" && (
        <div className="mt-2">
          <StatusBadge status={data.executionStatus} />
        </div>
      )}
      <Handle
        type="source"
        position={Position.Right}
        className="!w-2.5 !h-2.5 !bg-cyan-400 !border-[#11141e]"
      />
    </div>
  );
}

export default function PlannerPage() {
  const router = useRouter();
  const {
    tasks,
    workflows,
    busyTaskId,
    mutatePlan,
    approvePlanAndExecute,
    setActiveConversationId,
    saveWorkflow,
    deleteWorkflow,
    executeWorkflow,
    pushToast,
  } = useRelayStore();

  const [viewMode, setViewMode] = useState<"list" | "graph">("list");

  // Structured Step List State
  const [selectedTaskId, setSelectedTaskId] = useState<string>(tasks[0]?.id ?? "");
  const activeTask = useMemo(
    () => tasks.find((t) => t.id === selectedTaskId) ?? tasks[0] ?? null,
    [tasks, selectedTaskId]
  );

  const [editingStepId, setEditingStepId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editPriority, setEditPriority] = useState<StepPriority>("medium");
  const [addingStep, setAddingStep] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDesc, setNewDesc] = useState("");

  // React Flow Visual Workflow State
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string>(
    workflows[0]?.id ?? "wf_renewable_default"
  );
  const currentWorkflow = useMemo(
    () => workflows.find((w) => w.id === selectedWorkflowId) ?? workflows[0],
    [workflows, selectedWorkflowId]
  );

  const [wfName, setWfName] = useState(currentWorkflow?.name ?? "Custom Workflow");
  const [wfDesc, setWfDesc] = useState(currentWorkflow?.description ?? "");
  const [nodes, setNodes, onNodesChange] = useNodesState<RelayFlowNode>(
    (currentWorkflow?.nodes as RelayFlowNode[]) ?? []
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(
    (currentWorkflow?.edges as Edge[]) ?? []
  );
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  const nodeTypes = useMemo(() => ({ relayNode: RelayWorkflowNode }), []);

  useEffect(() => {
    if (!currentWorkflow) return;
    setWfName(currentWorkflow.name);
    setWfDesc(currentWorkflow.description);
    setNodes(currentWorkflow.nodes as RelayFlowNode[]);
    setEdges(currentWorkflow.edges as Edge[]);
  }, [currentWorkflow, setNodes, setEdges]);

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((eds) =>
        addEdge(
          { ...connection, animated: true, style: { stroke: "#8b5cf6", strokeWidth: 2 } },
          eds
        )
      );
    },
    [setEdges]
  );

  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId]
  );

  function startEdit(step: TaskStep) {
    setEditingStepId(step.id);
    setEditTitle(step.title);
    setEditDesc(step.description);
    setEditPriority(step.priority);
  }

  function commitEdit() {
    if (!activeTask || !editingStepId) return;
    mutatePlan(activeTask.id, {
      type: "edit",
      stepId: editingStepId,
      title: editTitle.trim() || undefined,
      description: editDesc.trim(),
      priority: editPriority,
    });
    setEditingStepId(null);
  }

  function addNodeToCanvas(kind: WorkflowNodeKind) {
    const palette = NODE_PALETTE.find((p) => p.kind === kind)!;
    const newNode: RelayFlowNode = {
      id: generateId("node"),
      type: "relayNode",
      position: {
        x: 100 + (nodes.length % 4) * 230,
        y: 80 + Math.floor(nodes.length / 4) * 140,
      },
      data: {
        label: palette.label,
        kind,
        description: palette.description,
        instructions: palette.description,
        requiresApproval: kind === "human_approval",
        executionStatus: "idle",
      },
    };
    setNodes((prev) => [...prev, newNode]);
    setSelectedNodeId(newNode.id);
  }

  function updateSelectedNodeData(partial: Partial<WorkflowNodeData>) {
    if (!selectedNodeId) return;
    setNodes((prev) =>
      prev.map((n) =>
        n.id === selectedNodeId ? { ...n, data: { ...n.data, ...partial } } : n
      )
    );
  }

  function removeSelectedNode() {
    if (!selectedNodeId) return;
    setNodes((prev) => prev.filter((n) => n.id !== selectedNodeId));
    setEdges((prev) =>
      prev.filter((e) => e.source !== selectedNodeId && e.target !== selectedNodeId)
    );
    setSelectedNodeId(null);
  }

  function persistCurrentWorkflow(asNew = false): SavedWorkflow {
    const wf: SavedWorkflow = {
      id: asNew ? generateId("wf") : currentWorkflow?.id ?? generateId("wf"),
      name: wfName.trim() || "Untitled Workflow",
      description: wfDesc.trim(),
      nodes: nodes.map((n) => ({
        id: n.id,
        type: n.type ?? "relayNode",
        position: n.position,
        data: n.data,
      })),
      edges: edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        animated: e.animated ?? true,
      })),
      lastRunStatus: currentWorkflow?.lastRunStatus ?? "idle",
      linkedTaskId: currentWorkflow?.linkedTaskId,
      updatedAt: new Date().toISOString(),
    };
    saveWorkflow(wf);
    setSelectedWorkflowId(wf.id);
    setSavedNotice(asNew ? "Saved copy" : "Saved");
    pushToast({
      tone: "success",
      title: asNew ? "Saved a copy of your workflow" : "Workflow saved",
      description: wf.name,
    });
    setTimeout(() => setSavedNotice(null), 2000);
    return wf;
  }

  async function handleRunWorkflow() {
    const wf = persistCurrentWorkflow(false);
    pushToast({
      tone: "info",
      title: "Starting workflow",
      description: `Running "${wf.name}" now.`,
    });
    await executeWorkflow(wf.id);
  }

  return (
    <AppShell
      title="Visual Planner"
      subtitle="Review steps, dependencies, and assigned agents, or design a visual pipeline"
      actions={
        <div className="flex items-center gap-1 bg-surface p-1 rounded-lg border border-white/[0.08]">
          <button
            type="button"
            onClick={() => setViewMode("list")}
            className={cn(
              "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
              viewMode === "list"
                ? "bg-[#7c6ce8] text-white"
                : "text-zinc-400 hover:text-white"
            )}
          >
            <ListChecks className="h-3.5 w-3.5" />
            Step Plan
          </button>
          <button
            type="button"
            onClick={() => setViewMode("graph")}
            className={cn(
              "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
              viewMode === "graph"
                ? "bg-[#7c6ce8] text-white"
                : "text-zinc-400 hover:text-white"
            )}
          >
            <GitBranch className="h-3.5 w-3.5" />
            Visual Graph
          </button>
        </div>
      }
    >
      {/* ================= CLEAN STEP PLAN VIEW (DEFAULT) ================= */}
      {viewMode === "list" && (
        <div className="space-y-5">
          {!activeTask ? (
            <EmptyState
              icon={ListTree}
              title="No active task plan yet"
              description="Start a collaboration in Workspace to view and edit its step-by-step plan here, or switch to Visual Graph to customize the template workflow."
              action={
                <>
                  <Button variant="primary" size="sm" onClick={() => router.push("/workspace")}>
                    Open Workspace
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => setViewMode("graph")}>
                    Open Visual Graph
                  </Button>
                </>
              }
            />
          ) : (
            <>
              <Card className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3 flex-wrap min-w-0">
                    <select
                      value={activeTask.id}
                      onChange={(e) => setSelectedTaskId(e.target.value)}
                      className="rounded-lg bg-[#0c0f17] border border-white/10 px-3 py-1.5 text-sm font-medium text-white max-w-xs"
                    >
                      {tasks.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.title}
                        </option>
                      ))}
                    </select>
                    <StatusBadge status={activeTask.status} />
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    <Button
                      size="xs"
                      variant="secondary"
                      onClick={() => setAddingStep((s) => !s)}
                    >
                      <Plus className="h-3.5 w-3.5" /> Add Step
                    </Button>
                    {activeTask.status === "awaiting_plan_approval" && (
                      <Button
                        size="xs"
                        variant="primary"
                        disabled={Boolean(busyTaskId)}
                        onClick={() => approvePlanAndExecute(activeTask.id)}
                      >
                        <Play className="h-3.5 w-3.5" /> Approve &amp; Run
                      </Button>
                    )}
                    <Button
                      size="xs"
                      variant="cyan"
                      onClick={() => {
                        setActiveConversationId(activeTask.conversationId);
                        router.push("/workspace");
                      }}
                    >
                      Open in Workspace
                    </Button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs text-zinc-400">
                    <span>Overall Progress</span>
                    <span className="font-mono text-white">{activeTask.progress}%</span>
                  </div>
                  <ProgressBar value={activeTask.progress} />
                </div>

                {addingStep && (
                  <form
                    className="rounded-lg bg-[#0c0f17] border border-white/10 p-3.5 space-y-2.5"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!newTitle.trim()) return;
                      mutatePlan(activeTask.id, {
                        type: "add",
                        title: newTitle,
                        description: newDesc || "Added in Planner",
                      });
                      setNewTitle("");
                      setNewDesc("");
                      setAddingStep(false);
                    }}
                  >
                    <Input
                      value={newTitle}
                      onChange={(e) => setNewTitle(e.target.value)}
                      placeholder="New step title..."
                      required
                    />
                    <Input
                      value={newDesc}
                      onChange={(e) => setNewDesc(e.target.value)}
                      placeholder="Step description..."
                    />
                    <div className="flex justify-end gap-2">
                      <Button
                        type="button"
                        size="xs"
                        variant="ghost"
                        onClick={() => setAddingStep(false)}
                      >
                        Cancel
                      </Button>
                      <Button type="submit" size="xs" variant="primary">
                        Save Step
                      </Button>
                    </div>
                  </form>
                )}

                {/* Structured Steps Table / Cards */}
                <div className="space-y-2.5">
                  {activeTask.steps.map((step, idx) => {
                    const agStyle = getAgentStyle(step.assignedAgent);
                    const depNames = step.dependencies
                      .map((id) => {
                        const depIdx = activeTask.steps.findIndex((s) => s.id === id);
                        return depIdx >= 0 ? `Step ${depIdx + 1}` : null;
                      })
                      .filter(Boolean);

                    return (
                      <div
                        key={step.id}
                        className="rounded-xl bg-[#0c0f17] border border-white/[0.07] p-4 space-y-2.5"
                      >
                        {editingStepId === step.id ? (
                          <div className="space-y-2.5">
                            <Input
                              value={editTitle}
                              onChange={(e) => setEditTitle(e.target.value)}
                            />
                            <Textarea
                              rows={2}
                              value={editDesc}
                              onChange={(e) => setEditDesc(e.target.value)}
                            />
                            <div className="flex items-center justify-between">
                              <select
                                value={editPriority}
                                onChange={(e) =>
                                  setEditPriority(e.target.value as StepPriority)
                                }
                                className="rounded-md bg-background border border-white/10 px-2 py-1 text-xs text-zinc-200"
                              >
                                <option value="high">High priority</option>
                                <option value="medium">Medium priority</option>
                                <option value="low">Low priority</option>
                              </select>
                              <div className="flex gap-2">
                                <Button
                                  size="xs"
                                  variant="ghost"
                                  onClick={() => setEditingStepId(null)}
                                >
                                  Cancel
                                </Button>
                                <Button size="xs" variant="primary" onClick={commitEdit}>
                                  Save
                                </Button>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                            <div className="flex items-start gap-3 min-w-0">
                              <AgentAvatar role={step.assignedAgent} size="sm" className="mt-0.5" />
                              <div className="space-y-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-xs font-mono text-zinc-500">
                                    Step {idx + 1}
                                  </span>
                                  <h3 className="text-sm font-medium text-white">
                                    {step.title}
                                  </h3>
                                  <span
                                    className={cn(
                                      "text-[11px] px-2 py-0.5 rounded-full border font-medium",
                                      agStyle.pill
                                    )}
                                  >
                                    {agStyle.label}
                                  </span>
                                  {step.requiresApproval && (
                                    <Badge tone="amber">Review Point</Badge>
                                  )}
                                </div>
                                <p className="text-xs text-zinc-400 leading-relaxed">
                                  {step.description}
                                </p>
                                <p className="text-[11px] text-zinc-500">
                                  Dependencies:{" "}
                                  <span className="text-zinc-300">
                                    {depNames.length ? depNames.join(", ") : "None"}
                                  </span>{" "}
                                  • Priority: <span className="capitalize">{step.priority}</span>
                                </p>
                              </div>
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                              <StatusBadge status={step.status} />
                              <div className="flex items-center gap-0.5 pl-1">
                                <Tooltip label={step.isLocked ? "Unlock step" : "Lock step"}>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    aria-label={step.isLocked ? "Unlock step" : "Lock step"}
                                    onClick={() =>
                                      mutatePlan(activeTask.id, {
                                        type: "toggle_lock",
                                        stepId: step.id,
                                      })
                                    }
                                  >
                                    {step.isLocked ? (
                                      <Lock className="h-3.5 w-3.5 text-cyan-300" />
                                    ) : (
                                      <Unlock className="h-3.5 w-3.5 text-zinc-500" />
                                    )}
                                  </Button>
                                </Tooltip>
                                <Tooltip label="Edit step">
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    aria-label="Edit step"
                                    disabled={step.isLocked || step.status === "running"}
                                    onClick={() => startEdit(step)}
                                  >
                                    <Edit3 className="h-3.5 w-3.5" />
                                  </Button>
                                </Tooltip>
                                <Tooltip label="Move up">
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    aria-label="Move up"
                                    disabled={idx === 0 || step.isLocked}
                                    onClick={() =>
                                      mutatePlan(activeTask.id, {
                                        type: "reorder",
                                        stepId: step.id,
                                        direction: "up",
                                      })
                                    }
                                  >
                                    <ArrowUp className="h-3.5 w-3.5" />
                                  </Button>
                                </Tooltip>
                                <Tooltip label="Move down">
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    aria-label="Move down"
                                    disabled={
                                      idx === activeTask.steps.length - 1 || step.isLocked
                                    }
                                    onClick={() =>
                                      mutatePlan(activeTask.id, {
                                        type: "reorder",
                                        stepId: step.id,
                                        direction: "down",
                                      })
                                    }
                                  >
                                    <ArrowDown className="h-3.5 w-3.5" />
                                  </Button>
                                </Tooltip>
                                <Tooltip label="Remove step">
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    aria-label="Remove step"
                                    disabled={step.isLocked || step.status === "running"}
                                    onClick={() =>
                                      mutatePlan(activeTask.id, {
                                        type: "delete",
                                        stepId: step.id,
                                      })
                                    }
                                  >
                                    <Trash2 className="h-3.5 w-3.5 text-zinc-500 hover:text-rose-400" />
                                  </Button>
                                </Tooltip>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </Card>
            </>
          )}
        </div>
      )}

      {/* ================= VISUAL GRAPH VIEW (REACT FLOW PRESERVED) ================= */}
      {viewMode === "graph" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={selectedWorkflowId}
                onChange={(e) => setSelectedWorkflowId(e.target.value)}
                className="rounded-lg bg-surface border border-white/10 px-3 py-1.5 text-xs text-zinc-100"
              >
                {workflows.map((wf) => (
                  <option key={wf.id} value={wf.id}>
                    {wf.name} ({wf.nodes.length} nodes)
                  </option>
                ))}
              </select>
              <Input
                value={wfName}
                onChange={(e) => setWfName(e.target.value)}
                className="w-56 h-8 text-xs"
                placeholder="Workflow name..."
              />
              {savedNotice && <Badge tone="emerald">{savedNotice}</Badge>}
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <Button size="xs" variant="secondary" onClick={() => persistCurrentWorkflow(true)}>
                <Plus className="h-3.5 w-3.5" /> Clone
              </Button>
              <Button size="xs" variant="secondary" onClick={() => persistCurrentWorkflow(false)}>
                <Save className="h-3.5 w-3.5" /> Save
              </Button>
              {workflows.length > 1 && (
                <Button
                  size="xs"
                  variant="danger"
                  onClick={() => {
                    deleteWorkflow(selectedWorkflowId);
                    setSelectedWorkflowId(
                      workflows.find((w) => w.id !== selectedWorkflowId)?.id ?? ""
                    );
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
              <Button
                size="xs"
                variant="primary"
                disabled={Boolean(busyTaskId) || nodes.length < 2}
                onClick={handleRunWorkflow}
              >
                <Play className="h-3.5 w-3.5" /> Run Workflow
              </Button>
            </div>
          </div>

          {/* Simple Node Palette */}
          <div className="flex flex-wrap gap-2">
            {NODE_PALETTE.map((item) => {
              const Icon = item.icon;
              return (
                <Button
                  key={item.kind}
                  size="xs"
                  variant="secondary"
                  onClick={() => addNodeToCanvas(item.kind)}
                >
                  <Icon className="h-3.5 w-3.5" />+ {item.label}
                </Button>
              );
            })}
          </div>

          <div className="grid lg:grid-cols-12 gap-4">
            <div className="lg:col-span-9 h-[400px] sm:h-[520px] rounded-xl border border-white/10 bg-[#0c0f17] overflow-hidden">
              <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onNodeClick={(_, node) => setSelectedNodeId(node.id)}
                onPaneClick={() => setSelectedNodeId(null)}
                fitView
                proOptions={{ hideAttribution: true }}
              >
                <Background color="rgba(255,255,255,0.05)" gap={24} />
                <Controls />
                <MiniMap nodeColor="#8b5cf6" maskColor="rgba(9,11,17,0.75)" />
              </ReactFlow>
            </div>

            <Card className="lg:col-span-3 space-y-4">
              <div className="flex items-center justify-between border-b border-white/[0.07] pb-2.5">
                <h3 className="text-xs font-semibold text-zinc-300">Node Inspector</h3>
                {selectedNode && (
                  <Button size="xs" variant="danger" onClick={removeSelectedNode}>
                    Delete
                  </Button>
                )}
              </div>

              {!selectedNode ? (
                <p className="text-xs text-zinc-500 py-8 text-center">
                  Select a node to edit its label, instructions, or approval gate.
                </p>
              ) : (
                <div className="space-y-3">
                  <div>
                    <label className="text-[11px] text-zinc-400 block mb-1">Label</label>
                    <Input
                      value={selectedNode.data.label}
                      onChange={(e) => updateSelectedNodeData({ label: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-zinc-400 block mb-1">
                      Instructions
                    </label>
                    <Textarea
                      rows={3}
                      value={selectedNode.data.instructions}
                      onChange={(e) =>
                        updateSelectedNodeData({ instructions: e.target.value })
                      }
                    />
                  </div>
                  <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(selectedNode.data.requiresApproval)}
                      onChange={(e) =>
                        updateSelectedNodeData({ requiresApproval: e.target.checked })
                      }
                    />
                    Require Human Approval
                  </label>
                </div>
              )}
            </Card>
          </div>
        </div>
      )}
    </AppShell>
  );
}
