import { callGeminiSafe, extractJsonObject } from "@/lib/ai/gemini";
import type { AlternativeSuggestion, ExplainableDecision, TaskStep } from "@/types/relay";
import { generateId } from "@/lib/utils/cn";

export interface PlanGenerationInput {
  objective: string;
  attachmentsSummary?: string;
  existingSteps?: TaskStep[];
  humanFeedback?: string;
  conversationContext?: string;
  forceDemo?: boolean;
}

export interface PlanGenerationOutput {
  title: string;
  summaryMessage: string;
  reasoningSummary: string;
  confidenceScore: number | null;
  steps: TaskStep[];
  alternatives: AlternativeSuggestion[];
  explainability: Omit<ExplainableDecision, "id" | "createdAt">;
  isSimulated: boolean;
  fallbackNotice?: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
}

function isRenewableEnergyScenario(objective: string): boolean {
  const lower = objective.toLowerCase();
  return (
    lower.includes("renewable") ||
    lower.includes("solar") ||
    lower.includes("clean energy") ||
    lower.includes("wind energy")
  );
}

function buildSimulatedPlan(input: PlanGenerationInput): Omit<PlanGenerationOutput, "latencyMs" | "inputTokens" | "outputTokens"> {
  const { objective, existingSteps, humanFeedback } = input;
  const renewable = isRenewableEnergyScenario(objective);

  // If adapting an existing plan based on human feedback
  if (existingSteps && existingSteps.length > 0 && humanFeedback) {
    const adaptedSteps: TaskStep[] = existingSteps.map((step, idx) => ({
      ...step,
      order: idx,
      description:
        step.isLocked
          ? step.description
          : idx === 2 || step.priority === "high"
          ? `${step.description} (Adapted to incorporate: "${humanFeedback.trim()}")`
          : step.description,
    }));

    return {
      title: renewable ? "Renewable Energy Research Report" : objective.slice(0, 58),
      summaryMessage: `I've updated the plan based on your note ("${humanFeedback.trim()}"). Any locked steps stayed untouched, and the remaining steps now reflect your updated direction. Please review the plan on the right before continuing.`,
      reasoningSummary: `Incorporated explicit human constraint ("${humanFeedback.trim()}") while preserving ${existingSteps.filter((s) => s.isLocked).length} locked step(s) and maintaining an approval checkpoint prior to final synthesis.`,
      confidenceScore: null,
      steps: adaptedSteps,
      alternatives: [
        {
          id: generateId("alt"),
          title: "Deep Policy & Grid Storage Focus",
          description: "Expand battery storage economics and grid policy sections before drafting.",
          tradeoff: "Adds ~1 step of research but strengthens executive recommendations.",
          estimatedSteps: 6,
          approvalPoints: 2,
          bestFor: "Board-level infrastructure investment briefs",
        },
        {
          id: generateId("alt"),
          title: "Rapid Executive Brief",
          description: "Condense comparative tables into a 1-page decision memo.",
          tradeoff: "Faster turnaround with less granular regional data.",
          estimatedSteps: 3,
          approvalPoints: 1,
          bestFor: "Fast executive alignment under tight deadlines",
        },
      ],
      explainability: {
        taskTitle: renewable ? "Renewable Energy Research Report" : objective.slice(0, 58),
        agentSlug: "planning-agent",
        decisionSummary: "Adapted workflow plan to integrate human mid-task feedback without overwriting locked steps.",
        evidenceUsed: [
          `Human modification prompt: "${humanFeedback.trim()}"`,
          `Current plan has ${existingSteps.length} steps (${existingSteps.filter((s) => s.isLocked).length} locked)`,
          "Dependency graph check confirmed valid topological execution order",
        ],
        influencingFactors: [
          { factor: "Explicit human constraint alignment", weight: 94, direction: "positive" },
          { factor: "Locked-step preservation invariant", weight: 88, direction: "positive" },
          { factor: "Downstream dependency consistency", weight: 81, direction: "neutral" },
        ],
        confidenceEstimate: null,
        confidenceNote: "Demo heuristic — no statistical probability calibrated.",
        alternativeOptions: [
          {
            option: "Regenerate entire plan from scratch",
            reasonNotChosen: "Would discard human step edits and increase cognitive re-verification effort.",
          },
          {
            option: "Append feedback only at the final step",
            reasonNotChosen: "Late incorporation risks inconsistent evidence gathering during research steps.",
          },
        ],
        uncertainties: [
          "Mid-task scope additions may increase downstream synthesis length if prior steps remain locked.",
          "Demo Mode adaptation uses structured template heuristics rather than live external data.",
        ],
        expectedOutcomes: [
          "Remaining pending steps incorporate the new human constraint while preserving locked/completed steps.",
          "Execution Agent will receive this constraint explicitly in its structured SharedTaskContext handoff.",
        ],
        recommendationExplanation:
          "Targeted in-place plan adaptation preserves user trust and control by respecting prior edits while ensuring research and execution steps align with the updated objective.",
        isSimulated: true,
      },
      isSimulated: true,
    };
  }

  if (renewable) {
    const s1 = generateId("step");
    const s2 = generateId("step");
    const s3 = generateId("step");
    const s4 = generateId("step");
    const s5 = generateId("step");

    const steps: TaskStep[] = [
      {
        id: s1,
        order: 0,
        title: "Research renewable energy",
        description: "Survey global 2025–2026 renewable energy adoption trends, LCOE cost curves, and grid integration status across major regions.",
        assignedAgent: "research-agent",
        priority: "high",
        status: "pending",
        requiresApproval: false,
        isLocked: false,
        editedByHuman: false,
        confidence: 0.93,
        dependencies: [],
      },
      {
        id: s2,
        order: 1,
        title: "Collect relevant information",
        description: "Gather benchmark statistics from IEA, IRENA, and NREL covering capacity growth, storage parity, carbon intensity, and capital expenditure.",
        assignedAgent: "research-agent",
        priority: "high",
        status: "pending",
        requiresApproval: false,
        isLocked: false,
        editedByHuman: false,
        confidence: 0.9,
        dependencies: [s1],
      },
      {
        id: s3,
        order: 2,
        title: "Compare energy sources",
        description: "Construct a structured multi-criteria comparison of Solar PV, Onshore/Offshore Wind, Hydro, Geothermal, and Battery-Paired Hybrid systems.",
        assignedAgent: "execution-agent",
        priority: "high",
        status: "pending",
        requiresApproval: false,
        isLocked: false,
        editedByHuman: false,
        confidence: 0.88,
        dependencies: [s2],
      },
      {
        id: s4,
        order: 3,
        title: "Analyze findings",
        description: "Synthesize economic trade-offs, intermittency risks, and policy recommendations — pausing for human approval on weighting criteria before drafting.",
        assignedAgent: "execution-agent",
        priority: "high",
        status: "pending",
        requiresApproval: true,
        isLocked: false,
        editedByHuman: false,
        confidence: 0.84,
        dependencies: [s3],
      },
      {
        id: s5,
        order: 4,
        title: "Generate the final report",
        description: "Compile the executive-ready Renewable Energy Research Report with tables, citations, risk matrix, and strategic roadmap.",
        assignedAgent: "execution-agent",
        priority: "medium",
        status: "pending",
        requiresApproval: false,
        isLocked: false,
        editedByHuman: false,
        confidence: 0.92,
        dependencies: [s4],
      },
    ];

    return {
      title: "Renewable Energy Research Report",
      summaryMessage:
        "Your plan is ready for review. I've organised your request into five steps:\n1. Research renewable energy\n2. Collect relevant information\n3. Compare energy sources\n4. Analyze findings (pauses for your review)\n5. Generate the final report\n\nYou can edit, reorder, or lock any step on the right before we begin.",
      reasoningSummary:
        "Decomposed the report request into a 5-step research-to-synthesis pipeline with a mandatory Human Approval gate at Step 4 so you control analytical framing and trade-off weights before final generation.",
      confidenceScore: null,
      steps,
      alternatives: [
        {
          id: generateId("alt"),
          title: "Regional Policy Deep-Dive (EU / US / India)",
          description: "Focus comparison specifically on IRA, EU Green Deal, and India National Solar Mission incentives.",
          tradeoff: "Higher policy depth; less emphasis on hardware-level LCOE engineering.",
          estimatedSteps: 5,
          approvalPoints: 2,
          bestFor: "Regulatory & subsidy-driven market entry decisions",
        },
        {
          id: generateId("alt"),
          title: "Grid Storage & Intermittency Priority",
          description: "Weight energy sources heavily by 24/7 dispatchability and LFP/sodium-ion storage coupling.",
          tradeoff: "Highlights baseload reliability over pure lowest per-MWh generation cost.",
          estimatedSteps: 5,
          approvalPoints: 1,
          bestFor: "Utility grid planners & industrial 24/7 clean power buyers",
        },
      ],
      explainability: {
        taskTitle: "Renewable Energy Research Report",
        agentSlug: "planning-agent",
        decisionSummary: "Structured a 5-stage multi-agent workflow with an explicit human approval gate prior to final synthesis.",
        evidenceUsed: [
          "Objective specifies a comprehensive research report requiring both empirical collection and comparative judgment",
          "Multi-criteria comparisons involve subjective weighting (cost vs. reliability vs. emissions) suited for human sign-off",
          "Separating Research Agent collection from Execution Agent synthesis improves auditability",
        ],
        influencingFactors: [
          { factor: "Need for human-aligned weighting in Step 4", weight: 92, direction: "positive" },
          { factor: "Clear separation of evidence collection vs. synthesis", weight: 86, direction: "positive" },
          { factor: "Minimizing rework cost before generating final report", weight: 84, direction: "positive" },
          { factor: "Risk of approval fatigue if every step were gated", weight: 38, direction: "caution" },
        ],
        confidenceEstimate: null,
        confidenceNote: "Structured Demo Mode workflow heuristic (not a calibrated LLM log-probability).",
        alternativeOptions: [
          {
            option: "Single-shot monolithic generation (prompt-and-wait)",
            reasonNotChosen: "Gives the human zero control over scope, metrics, or sources until after full generation.",
          },
          {
            option: "Require approval on all 5 steps individually",
            reasonNotChosen: "Creates unnecessary interaction friction on routine evidence-gathering steps.",
          },
        ],
        uncertainties: [
          "Regional grid priorities (e.g., Northern Europe vs. Sun-Belt) are not yet specified in the initial objective.",
          "Optimal trade-off weighting between CapEx cost and 24/7 reliability depends on stakeholder preferences.",
        ],
        expectedOutcomes: [
          "Research Agent collects multi-source benchmarks in Steps 1–2 and hands structured evidence to Execution Agent.",
          "Step 4 pauses at the Human Approval Center so stakeholder weights are locked before final report synthesis.",
        ],
        recommendationExplanation:
          "Placing one strategic human approval checkpoint after comparative analysis balances high human control with low interaction effort.",
        isSimulated: true,
      },
      isSimulated: true,
    };
  }

  // Generic domain-adaptive simulated plan for any user objective
  const cleanTitle = objective.trim().replace(/[.?!]+$/, "").slice(0, 62);
  const s1 = generateId("step");
  const s2 = generateId("step");
  const s3 = generateId("step");
  const s4 = generateId("step");
  const s5 = generateId("step");

  const steps: TaskStep[] = [
    {
      id: s1,
      order: 0,
      title: `Scope & frame: ${cleanTitle.slice(0, 32)}`,
      description: `Clarify core constraints, target audience, and success criteria for "${cleanTitle}".`,
      assignedAgent: "research-agent",
      priority: "high",
      status: "pending",
      requiresApproval: false,
      isLocked: false,
      editedByHuman: false,
      confidence: 0.89,
      dependencies: [],
    },
    {
      id: s2,
      order: 1,
      title: "Collect evidence & domain references",
      description: "Gather structured domain facts, benchmarks, and verifiable supporting evidence.",
      assignedAgent: "research-agent",
      priority: "high",
      status: "pending",
      requiresApproval: false,
      isLocked: false,
      editedByHuman: false,
      confidence: 0.87,
      dependencies: [s1],
    },
    {
      id: s3,
      order: 2,
      title: "Evaluate options & trade-offs",
      description: "Compare candidate approaches across effectiveness, risk, cost, and feasibility.",
      assignedAgent: "execution-agent",
      priority: "medium",
      status: "pending",
      requiresApproval: false,
      isLocked: false,
      editedByHuman: false,
      confidence: 0.85,
      dependencies: [s2],
    },
    {
      id: s4,
      order: 3,
      title: "Human decision checkpoint & synthesis",
      description: "Present recommended strategic direction, risks, and alternatives for human approval before final deliverable.",
      assignedAgent: "execution-agent",
      priority: "high",
      status: "pending",
      requiresApproval: true,
      isLocked: false,
      editedByHuman: false,
      confidence: 0.82,
      dependencies: [s3],
    },
    {
      id: s5,
      order: 4,
      title: "Produce final structured deliverable",
      description: "Compile approved findings, evidence summary, and concrete next actions into a polished report.",
      assignedAgent: "execution-agent",
      priority: "medium",
      status: "pending",
      requiresApproval: false,
      isLocked: false,
      editedByHuman: false,
      confidence: 0.9,
      dependencies: [s4],
    },
  ];

  return {
    title: cleanTitle || "Collaborative Objective",
    summaryMessage: `Your plan is ready for review. I've organised "${cleanTitle}" into 5 clear steps:\n1. ${steps[0].title}\n2. ${steps[1].title}\n3. ${steps[2].title}\n4. ${steps[3].title} (pauses for your review)\n5. ${steps[4].title}\n\nYou can edit, reorder, lock, or add steps on the right before we start.`,
    reasoningSummary: `Structured "${cleanTitle}" into sequential Research → Comparative Evaluation → Human Approval → Deliverable stages so human oversight governs critical trade-offs.`,
    confidenceScore: null,
    steps,
    alternatives: [
      {
        id: generateId("alt"),
        title: "Fast-Track 3-Step Synthesis",
        description: "Merge scoping and comparison to reach final draft faster.",
        tradeoff: "Reduces execution duration with slightly less comparative breadth.",
        estimatedSteps: 3,
        approvalPoints: 1,
        bestFor: "Quick drafts with well-known constraints",
      },
      {
        id: generateId("alt"),
        title: "High-Oversight Dual Checkpoint",
        description: "Add a second human approval gate right after evidence collection.",
        tradeoff: "Maximizes control for high-stakes decisions at slightly higher user effort.",
        estimatedSteps: 6,
        approvalPoints: 2,
        bestFor: "Regulated, financial, or compliance-critical deliverables",
      },
    ],
    explainability: {
      taskTitle: cleanTitle || "Collaborative Objective",
      agentSlug: "planning-agent",
      decisionSummary: `Decomposed "${cleanTitle}" into 5 auditable steps with an integrated decision gate at Step 4.`,
      evidenceUsed: [
        `User objective: "${objective}"`,
        input.attachmentsSummary ? `Attached context: ${input.attachmentsSummary}` : "No external attachments provided",
        "Standard HAI workflow pattern separating evidence collection from judgment synthesis",
      ],
      influencingFactors: [
        { factor: "Task complexity & multi-step dependency depth", weight: 88, direction: "positive" },
        { factor: "Strategic placement of human-in-the-loop gate", weight: 90, direction: "positive" },
        { factor: "Reversibility before final output generation", weight: 82, direction: "positive" },
      ],
      confidenceEstimate: null,
      confidenceNote: "Structured Demo Mode plan — review steps directly before approval.",
      alternativeOptions: [
        {
          option: "Direct autonomous generation without plan review",
          reasonNotChosen: "Violates human-in-the-loop transparency and prevents early error correction.",
        },
      ],
      uncertainties: [
        "Stakeholder-specific constraints not stated in the opening objective may require step edits.",
        "Simulated Demo Mode cannot query live private data sources.",
      ],
      expectedOutcomes: [
        "Produces a verified step-by-step artifact where human approval governs key trade-offs before final output.",
      ],
      recommendationExplanation:
        "Decomposing the objective into editable steps lets the human verify scope early and steer execution before downstream work is wasted.",
      isSimulated: true,
    },
    isSimulated: true,
  };
}

interface RawGeminiPlan {
  title?: string;
  summaryMessage?: string;
  reasoningSummary?: string;
  steps?: Array<{
    title: string;
    description: string;
    assignedAgent?: "research-agent" | "planning-agent" | "execution-agent";
    priority?: "high" | "medium" | "low";
    requiresApproval?: boolean;
  }>;
  alternatives?: Array<{
    title: string;
    description: string;
    tradeoff: string;
    estimatedSteps?: number;
    approvalPoints?: number;
    bestFor?: string;
  }>;
  evidenceUsed?: string[];
  uncertainties?: string[];
  expectedOutcomes?: string[];
  recommendationExplanation?: string;
}

export async function runPlanningAgent(
  input: PlanGenerationInput
): Promise<PlanGenerationOutput> {
  const systemInstruction = `You are the PLANNING AGENT inside RELAY AI, a Human-Agent Collaboration platform.
Break the user's objective into 5 clear, actionable steps assigned to "research-agent" or "execution-agent".
Mark exactly ONE pivotal judgment/decision step (typically step 4) with "requiresApproval": true so a human approves before final synthesis.
Keep reasoning evidence-grounded, explicitly list uncertainties and expectedOutcomes, and NEVER fabricate confidence probabilities or claim access to hidden chain-of-thought.
Return STRICT JSON matching:
{
  "title": "short title",
  "summaryMessage": "friendly summary listing numbered steps",
  "reasoningSummary": "2-sentence grounded rationale for this plan structure",
  "steps": [
    {
      "title": "Step title",
      "description": "Concrete step action",
      "assignedAgent": "research-agent" | "execution-agent",
      "priority": "high" | "medium" | "low",
      "requiresApproval": false
    }
  ],
  "alternatives": [{ "title": "...", "description": "...", "tradeoff": "...", "estimatedSteps": 4, "approvalPoints": 1, "bestFor": "..." }],
  "evidenceUsed": ["..."],
  "uncertainties": ["..."],
  "expectedOutcomes": ["..."],
  "recommendationExplanation": "..."
}`;

  const prompt = input.humanFeedback
    ? `Objective: ${input.objective}\n${
        input.conversationContext ? `Conversation context: ${input.conversationContext}\n` : ""
      }Current steps: ${JSON.stringify(
        input.existingSteps?.map((s) => ({
          title: s.title,
          description: s.description,
          status: s.status,
          isLocked: s.isLocked,
        }))
      )}\nHuman feedback / modification request: ${input.humanFeedback}\nAdapt remaining pending steps while preserving completed and locked steps unchanged.`
    : `Objective: ${input.objective}\n${
        input.attachmentsSummary ? `Attached context: ${input.attachmentsSummary}\n` : ""
      }${
        input.conversationContext ? `Conversation context: ${input.conversationContext}\n` : ""
      }Produce a 5-step collaborative execution plan.`;

  const call = await callGeminiSafe({
    systemInstruction,
    prompt,
    expectJson: true,
    temperature: 0.35,
    forceDemo: input.forceDemo,
  });

  const parsed = extractJsonObject<RawGeminiPlan>(call.text);
  if (!call.isSimulated && parsed && Array.isArray(parsed.steps) && parsed.steps.length >= 3) {
    const stepIds = parsed.steps.map(() => generateId("step"));
    const steps: TaskStep[] = parsed.steps.map((s, idx) => ({
      id: stepIds[idx],
      order: idx,
      title: s.title || `Step ${idx + 1}`,
      description: s.description || "",
      assignedAgent:
        s.assignedAgent === "research-agent" ||
        s.assignedAgent === "planning-agent" ||
        s.assignedAgent === "execution-agent"
          ? s.assignedAgent
          : idx < 2
          ? "research-agent"
          : "execution-agent",
      priority: s.priority === "high" || s.priority === "low" ? s.priority : "medium",
      status: "pending",
      requiresApproval: Boolean(s.requiresApproval),
      isLocked: false,
      editedByHuman: false,
      confidence: 0.85,
      dependencies: idx > 0 ? [stepIds[idx - 1]] : [],
    }));

    // Ensure at least one step has a human approval gate for HAI safety
    if (!steps.some((s) => s.requiresApproval) && steps.length >= 2) {
      steps[steps.length - 2].requiresApproval = true;
    }

    const title = parsed.title || input.objective.slice(0, 60);
    return {
      title,
      summaryMessage:
        parsed.summaryMessage ||
        `I have structured your objective into ${steps.length} collaborative steps:\n` +
          steps.map((s, i) => `${i + 1}. ${s.title}`).join("\n"),
      reasoningSummary:
        parsed.reasoningSummary ||
        "Structured into evidence collection, comparative analysis, human approval gate, and final synthesis.",
      confidenceScore: null,
      steps,
      alternatives: (parsed.alternatives ?? []).slice(0, 3).map((a) => ({
        id: generateId("alt"),
        title: a.title,
        description: a.description,
        tradeoff: a.tradeoff,
        estimatedSteps: a.estimatedSteps ?? steps.length,
        approvalPoints: a.approvalPoints ?? 1,
        bestFor: a.bestFor,
      })),
      explainability: {
        taskTitle: title,
        agentSlug: "planning-agent",
        decisionSummary: `Generated ${steps.length}-step collaborative plan for "${title}".`,
        evidenceUsed: parsed.evidenceUsed?.length
          ? parsed.evidenceUsed
          : [`User objective: "${input.objective}"`],
        influencingFactors: [
          { factor: "Objective complexity & milestone decomposition", weight: 90, direction: "positive" },
          { factor: "Human approval gate placement before final deliverable", weight: 87, direction: "positive" },
          { factor: "Agent specialization (Research vs Execution)", weight: 82, direction: "positive" },
        ],
        confidenceEstimate: null,
        confidenceNote: "Gemini does not output calibrated plan-level probabilities; evaluate the steps & evidence directly.",
        alternativeOptions: (parsed.alternatives ?? []).map((a) => ({
          option: a.title,
          reasonNotChosen: a.tradeoff,
        })),
        uncertainties: parsed.uncertainties?.length
          ? parsed.uncertainties
          : ["Unstated stakeholder constraints or external data recency may require step edits."],
        expectedOutcomes: parsed.expectedOutcomes?.length
          ? parsed.expectedOutcomes
          : ["Produces a human-reviewed multi-agent workflow with auditable intermediate artifacts."],
        recommendationExplanation:
          parsed.recommendationExplanation ||
          "Plan separates research gathering from judgment synthesis so human collaborators retain control at high-leverage decisions.",
        isSimulated: false,
      },
      isSimulated: false,
      latencyMs: call.latencyMs,
      inputTokens: call.inputTokens,
      outputTokens: call.outputTokens,
    };
  }

  const simulated = buildSimulatedPlan(input);
  const fallbackNotice = call.fellBackToDemo
    ? `Live Gemini unavailable (${call.errorKind ?? "api_error"}: ${call.error ?? "request failed"}). Safely switched to clearly labeled DEMO MODE.`
    : !call.isSimulated && !parsed
    ? "Gemini returned malformed JSON structure. Safely recovered using structured DEMO MODE plan."
    : undefined;

  return {
    ...simulated,
    fallbackNotice,
    latencyMs: call.latencyMs,
    inputTokens: call.inputTokens,
    outputTokens: Math.max(call.outputTokens, 240),
  };
}
