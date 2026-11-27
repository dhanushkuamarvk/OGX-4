import { callGeminiSafe } from "@/lib/ai/gemini";
import type {
  AgentHandoff,
  ExplainableDecision,
  SharedTaskContext,
  TaskStep,
} from "@/types/relay";
import { generateId } from "@/lib/utils/cn";

export interface ResearchStepInput {
  objective: string;
  step: TaskStep;
  priorOutputs: string[];
  sharedContext?: SharedTaskContext;
  forceDemo?: boolean;
}

export interface ResearchStepOutput {
  output: string;
  sources: string[];
  handoff: AgentHandoff;
  confidence: number | null;
  explainability: Omit<ExplainableDecision, "id" | "createdAt">;
  isSimulated: boolean;
  fallbackNotice?: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
}

function buildSimulatedResearch(
  input: ResearchStepInput
): Omit<ResearchStepOutput, "latencyMs" | "inputTokens" | "outputTokens" | "fallbackNotice"> {
  const lower = `${input.objective} ${input.step.title}`.toLowerCase();
  const isRenewable =
    lower.includes("renewable") || lower.includes("solar") || lower.includes("energy");
  const constraints = input.sharedContext?.humanConstraints ?? [];
  const constraintLine = constraints.length
    ? `\n• Active Human Constraints Honored: ${constraints.join(" | ")}`
    : "";

  if (isRenewable && input.step.order === 0) {
    const sources = [
      "IEA Renewables 2025 Market Analysis & Forecast (Demo reference)",
      "IRENA Renewable Power Generation Costs Report (Demo reference)",
      "NREL Annual Technology Baseline (Demo reference)",
    ];
    const keyFindings = [
      "Global renewable additions accounted for >85% of net new power capacity.",
      "Utility-scale Solar PV LCOE fell below $32–$44/MWh in high-irradiance regions.",
      "LFP grid-scale battery storage prices fell ~40% over 24 months, enabling 4-hour solar firming.",
      "Transmission queues and grid interconnection surpassed generation cost as primary bottlenecks.",
    ];
    return {
      output:
        "[SIMULATED RESEARCH FINDINGS]\n" +
        keyFindings.map((f) => `• ${f}`).join("\n") +
        constraintLine,
      sources,
      handoff: {
        id: generateId("hof"),
        fromAgent: "research-agent",
        toAgent: "execution-agent",
        stepId: input.step.id,
        stepTitle: input.step.title,
        summary: "Handed global capacity, LCOE, LFP storage, and interconnection findings downstream.",
        keyFindings,
        sources,
        humanConstraints: constraints,
        createdAt: new Date().toISOString(),
      },
      confidence: null,
      explainability: {
        taskTitle: input.objective.slice(0, 60),
        agentSlug: "research-agent",
        decisionSummary: `Prioritized cost-curve, deployment volume, and grid-bottleneck evidence for "${input.step.title}".`,
        evidenceUsed: [
          "IEA global capacity installation benchmarks (Demo reference set)",
          "IRENA Levelized Cost of Energy (LCOE) historical series",
          "NREL battery-paired solar cost projections",
          ...(constraints.length ? [`Human constraints: ${constraints.join("; ")}`] : []),
        ],
        influencingFactors: [
          { factor: "Empirical benchmark coverage across cost + grid bottlenecks", weight: 93, direction: "positive" },
          { factor: "Cross-institutional source triangulation", weight: 88, direction: "positive" },
          { factor: "Regional policy & latitude variance requiring caveat", weight: 52, direction: "caution" },
        ],
        confidenceEstimate: null,
        confidenceNote: "Simulated Demo Mode benchmark set — verify live citations when connecting Gemini.",
        alternativeOptions: [
          {
            option: "Focus only on emerging experimental tech (fusion / tidal)",
            reasonNotChosen: "Too early-stage for near-term comparative energy strategy.",
          },
        ],
        uncertainties: [
          "Simulated Demo Mode does not query live web feeds or region-specific tariff updates.",
          "Interconnection wait times vary substantially across US ISO, EU ENTSO-E, and Asian grids.",
        ],
        expectedOutcomes: [
          "Establishes quantitative cost & bottleneck baselines for Step 2 data collection and Step 3 multi-source comparison.",
        ],
        recommendationExplanation:
          "Anchoring the initial survey in deployment, LCOE, and interconnection metrics creates a balanced base for comparative analysis.",
        isSimulated: true,
      },
      isSimulated: true,
    };
  }

  if (isRenewable) {
    const sources = [
      "Lazard LCOE+ Comparative Energy Dataset (Demo reference)",
      "IPCC Lifecycle Emissions Synthesis Table (Demo reference)",
      "BloombergNEF Energy Storage & Clean Power Tracker (Demo reference)",
    ];
    const keyFindings = [
      "Solar PV: LCOE $32–$48/MWh | Capacity Factor 18–28% | Lifecycle CO₂ ~40 g/kWh | Build: 12–18 mo.",
      "Onshore Wind: LCOE $33–$50/MWh | Capacity Factor 35–48% | Lifecycle CO₂ ~12 g/kWh.",
      "Offshore Wind: LCOE $72–$108/MWh | Capacity Factor 45–55% | High CapEx, coastal load proximity.",
      "Hydropower: LCOE $45–$68/MWh | Dispatchable baseload | Siting & ecological constraints.",
      "Enhanced Geothermal: LCOE $60–$95/MWh | 24/7 firm baseload (~85%+ CF).",
    ];
    return {
      output:
        "[SIMULATED DATA COLLECTION]\n" +
        keyFindings.map((f) => `• ${f}`).join("\n") +
        constraintLine,
      sources,
      handoff: {
        id: generateId("hof"),
        fromAgent: "research-agent",
        toAgent: "execution-agent",
        stepId: input.step.id,
        stepTitle: input.step.title,
        summary: "Transferred 5-source quantitative matrix (LCOE, CF, CO₂, build speed) to Execution Agent.",
        keyFindings,
        sources,
        humanConstraints: constraints,
        createdAt: new Date().toISOString(),
      },
      confidence: null,
      explainability: {
        taskTitle: input.objective.slice(0, 60),
        agentSlug: "research-agent",
        decisionSummary: "Compiled standardized metrics (LCOE, Capacity Factor, Lifecycle CO₂, Deployment Speed) across 5 major sources.",
        evidenceUsed: [
          "Lazard LCOE+ utility-scale cost ranges (Demo reference)",
          "IPCC harmonized lifecycle greenhouse gas intensity",
          "Utility interconnection & build-time records",
        ],
        influencingFactors: [
          { factor: "Metric comparability across technologies", weight: 95, direction: "positive" },
          { factor: "Inclusion of dispatchability alongside cost", weight: 89, direction: "positive" },
        ],
        confidenceEstimate: null,
        confidenceNote: "Simulated Demo Mode figures — ranges represent broad global averages.",
        alternativeOptions: [
          {
            option: "Compare strictly on raw LCOE without capacity factor",
            reasonNotChosen: "Omits intermittency and grid firming cost, skewing strategic comparisons.",
          },
        ],
        uncertainties: [
          "Regional financing rates and local tax incentives (e.g., IRA PTC/ITC) shift effective LCOE by 20–35%.",
          "Enhanced Geothermal cost curves remain early in commercial scaling.",
        ],
        expectedOutcomes: [
          "Enables Execution Agent to build an apples-to-apples Pareto comparison table in Step 3.",
        ],
        recommendationExplanation:
          "Collecting multi-dimensional metrics prevents biased single-variable rankings in the upcoming comparison step.",
        isSimulated: true,
      },
      isSimulated: true,
    };
  }

  const sources = [
    "Structured Domain Reference Corpus (Demo Mode)",
    "Comparative Risk & Trade-Off Framework",
  ];
  const keyFindings = [
    `Scoped domain constraints and operational priorities for "${input.objective}".`,
    "Mapped 4 evaluation dimensions: Feasibility, Evidence Strength, Stakeholder Impact, and Implementation Risk.",
    `Verified alignment with human step directive: "${input.step.description}".`,
  ];

  return {
    output:
      `[SIMULATED RESEARCH AGENT OUTPUT — ${input.step.title}]\n` +
      keyFindings.map((f) => `• ${f}`).join("\n") +
      constraintLine,
    sources,
    handoff: {
      id: generateId("hof"),
      fromAgent: "research-agent",
      toAgent: "execution-agent",
      stepId: input.step.id,
      stepTitle: input.step.title,
      summary: `Handed structured findings for "${input.step.title}" to Execution Agent.`,
      keyFindings,
      sources,
      humanConstraints: constraints,
      createdAt: new Date().toISOString(),
    },
    confidence: null,
    explainability: {
      taskTitle: input.objective.slice(0, 60),
      agentSlug: "research-agent",
      decisionSummary: `Gathered structured baseline evidence for "${input.step.title}".`,
      evidenceUsed: [
        `Step directive: ${input.step.description}`,
        `Prior context count: ${input.priorOutputs.length} completed step(s)`,
        ...(constraints.length ? [`Human constraints: ${constraints.join("; ")}`] : []),
      ],
      influencingFactors: [
        { factor: "Alignment with objective scope", weight: 87, direction: "positive" },
        { factor: "Simulated offline reference caveat", weight: 45, direction: "caution" },
      ],
      confidenceEstimate: null,
      confidenceNote: "Simulated Demo Mode synthesis — no external retrieval performed.",
      alternativeOptions: [
        {
          option: "Broad unfocused literature summary",
          reasonNotChosen: "Adds noise without clarifying actionable trade-offs.",
        },
      ],
      uncertainties: [
        "Offline Demo Mode cannot verify real-time market pricing or domain-specific private documents.",
      ],
      expectedOutcomes: [
        "Provides clean, auditable inputs for downstream Execution Agent evaluation and synthesis.",
      ],
      recommendationExplanation:
        "Focused evidence gathering keeps downstream execution grounded and easy for humans to audit.",
      isSimulated: true,
    },
    isSimulated: true,
  };
}

export async function runResearchAgent(
  input: ResearchStepInput
): Promise<ResearchStepOutput> {
  const constraints = input.sharedContext?.humanConstraints ?? [];
  const priorHandoffs = input.sharedContext?.handoffs ?? [];

  const systemInstruction = `You are the RESEARCH AGENT in RELAY AI.
Produce concise, structured, evidence-grounded bullet findings for the requested step.
Honesty rules:
- Explicitly note key uncertainties or data limitations.
- Do NOT fabricate URLs, fake statistics, or arbitrary confidence percentages.
- Do NOT claim access to hidden model chain-of-thought.`;

  const prompt = `Overall Objective: ${input.objective}
Current Step: ${input.step.title}
Step Instructions: ${input.step.description}
Active Human Constraints: ${constraints.join(" | ") || "None"}
Prior Agent Handoffs: ${
    priorHandoffs.map((h) => `${h.fromAgent} -> ${h.toAgent}: ${h.summary}`).join("\n") || "None"
  }
Prior Step Outputs: ${input.priorOutputs.slice(-2).join("\n---\n") || "None"}

Provide crisp structured research findings (5-7 bullets) and note any key uncertainties.`;

  const call = await callGeminiSafe({
    systemInstruction,
    prompt,
    temperature: 0.3,
    forceDemo: input.forceDemo,
  });

  if (!call.isSimulated && call.text) {
    const bulletLines = call.text
      .split("\n")
      .map((l) => l.replace(/^[-•*]\s*/, "").trim())
      .filter((l) => l.length > 12)
      .slice(0, 4);

    return {
      output: call.text,
      sources: ["Google Gemini Research Synthesis", "User objective & shared task context"],
      handoff: {
        id: generateId("hof"),
        fromAgent: "research-agent",
        toAgent: "execution-agent",
        stepId: input.step.id,
        stepTitle: input.step.title,
        summary: `Completed live research for "${input.step.title}" and passed ${bulletLines.length} key points downstream.`,
        keyFindings: bulletLines,
        sources: ["Google Gemini Research Synthesis"],
        humanConstraints: constraints,
        createdAt: new Date().toISOString(),
      },
      confidence: null,
      explainability: {
        taskTitle: input.objective.slice(0, 60),
        agentSlug: "research-agent",
        decisionSummary: `Completed live research synthesis for "${input.step.title}".`,
        evidenceUsed: [
          `Step instructions: ${input.step.description}`,
          `Incorporated ${input.priorOutputs.length} prior step output(s)`,
          ...(constraints.length ? [`Human constraints: ${constraints.join("; ")}`] : []),
        ],
        influencingFactors: [
          { factor: "Objective & step directive specificity", weight: 90, direction: "positive" },
          { factor: "Structured evidence organization", weight: 85, direction: "positive" },
        ],
        confidenceEstimate: null,
        confidenceNote: "Gemini does not output calibrated factual accuracy probabilities; verify critical figures.",
        alternativeOptions: [
          {
            option: "Skip secondary benchmark comparison",
            reasonNotChosen: "Would weaken evidence grounding for the execution agent.",
          },
        ],
        uncertainties: [
          "Model knowledge cutoff and lack of live web browsing may omit very recent regulatory or pricing changes.",
        ],
        expectedOutcomes: [
          "Execution Agent uses these structured findings in its upcoming comparison and final report synthesis.",
        ],
        recommendationExplanation:
          "Structured findings provide transparent inputs that humans can inspect before approving downstream decisions.",
        isSimulated: false,
      },
      isSimulated: false,
      latencyMs: call.latencyMs,
      inputTokens: call.inputTokens,
      outputTokens: call.outputTokens,
    };
  }

  const sim = buildSimulatedResearch(input);
  const fallbackNotice = call.fellBackToDemo
    ? `Live Gemini failed during research (${call.errorKind ?? "api_error"}: ${call.error ?? "request error"}). Safely switched to clearly labeled DEMO MODE.`
    : undefined;

  return {
    ...sim,
    fallbackNotice,
    latencyMs: call.latencyMs,
    inputTokens: call.inputTokens,
    outputTokens: Math.max(call.outputTokens, 190),
  };
}
