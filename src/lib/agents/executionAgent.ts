import { callGeminiSafe } from "@/lib/ai/gemini";
import type {
  AgentHandoff,
  ApprovalRequest,
  ExplainableDecision,
  SharedTaskContext,
  TaskStep,
} from "@/types/relay";
import { generateId } from "@/lib/utils/cn";

export interface ExecutionStepInput {
  taskId: string;
  objective: string;
  step: TaskStep;
  allSteps: TaskStep[];
  priorOutputs: string[];
  sharedContext?: SharedTaskContext;
  humanDecisionNote?: string;
  forceDemo?: boolean;
}

export interface ExecutionStepOutput {
  output: string;
  isFinalReport: boolean;
  handoff: AgentHandoff;
  confidence: number | null;
  explainability: Omit<ExplainableDecision, "id" | "createdAt">;
  isSimulated: boolean;
  fallbackNotice?: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
}

export function buildApprovalRequestForStep(
  taskId: string,
  objective: string,
  step: TaskStep,
  isSimulated: boolean,
  sharedContext?: SharedTaskContext,
  escalationReason?: string
): ApprovalRequest {
  const isRenewable =
    objective.toLowerCase().includes("renewable") ||
    step.title.toLowerCase().includes("energy") ||
    step.title.toLowerCase().includes("findings");
  const extraConstraints = sharedContext?.humanConstraints ?? [];
  const constraintText = extraConstraints.join(" ").toLowerCase();
  const isNorthernBaseloadPivot =
    constraintText.includes("northern europe") ||
    constraintText.includes("24/7") ||
    constraintText.includes("winter") ||
    constraintText.includes("baseload") ||
    constraintText.includes("offshore wind");

  if (isRenewable && isNorthernBaseloadPivot) {
    return {
      id: generateId("apr"),
      taskId,
      stepId: step.id,
      agentSlug: "execution-agent",
      actionTitle: `Approve Adapted Northern Europe Framing: ${step.title}`,
      actionDescription:
        "Apply mid-task adapted weights (50% 24/7 Firm Winter Reliability, 30% Grid Interconnection & Regulatory Feasibility, 20% LCOE Cost) and recommend Offshore Wind + Enhanced Geothermal + Dispatchable Hydro instead of daytime Solar PV." +
        (escalationReason ? ` (${escalationReason})` : ""),
      recommendationReason:
        "Per your mid-task requirement pivot to Northern European winter grids, solar capacity factors drop below 8% in winter. Pairing Offshore Wind (45–55% CF) with Enhanced Geothermal (85%+ CF) and Hydro directly satisfies 24/7 baseload reliability.",
      expectedResult:
        "The final report will pivot away from daytime Solar PV toward a Northern European 24/7 Firm Clean Baseload architecture with explicit winter grid & EU permitting risk mitigations.",
      supportingEvidence: [
        `Active Mid-Task Human Constraint: ${extraConstraints.join("; ")}`,
        "Upstream Research Handoff: Offshore Wind (45–55% CF) & Enhanced Geothermal (85%+ CF) sustain winter load far above Solar PV",
        "Dispatchable Hydro & long-duration storage cover multi-day Dunkelflaute (low-wind winter) events",
        ...(sharedContext?.collectedSources?.slice(0, 2).map((s) => `Source: ${s}`) ?? []),
      ],
      potentialRisks: [
        "Offshore Wind carries higher upfront CapEx ($72–$108/MWh) and 4–6 year marine permitting timelines",
        "Enhanced Geothermal deep-drilling cost overruns remain an early-commercialization uncertainty",
        "Multi-day winter Dunkelflaute episodes still require cross-border HVDC interconnectors",
      ],
      alternativeActions: [
        "Add Cross-Border HVDC Interconnectors + Onshore Wind (Lower CapEx than pure offshore)",
        "Keep Balanced Global Hybrid (40% Cost / 35% Reliability / 25% Carbon: Solar + LFP + Wind)",
        "Split Report Into Summer Peak vs. Winter Dunkelflaute Dual Portfolio Scenarios",
      ],
      confidence: step.confidence || 0.85,
      status: "pending",
      qaThread: [],
      isSimulated,
      createdAt: new Date().toISOString(),
    };
  }

  if (isRenewable) {
    return {
      id: generateId("apr"),
      taskId,
      stepId: step.id,
      agentSlug: "execution-agent",
      actionTitle: `Approve Analysis Framing: ${step.title}`,
      actionDescription:
        "Finalize the multi-criteria scoring weights (40% LCOE Cost, 35% Grid Reliability & Storage Firming, 25% Lifecycle Decarbonization) and lock the strategic recommendation favoring Solar PV + 4-Hour LFP Storage paired with Onshore Wind." +
        (extraConstraints.length
          ? ` Incorporates human constraints: ${extraConstraints.join("; ")}.`
          : "") +
        (escalationReason ? ` (${escalationReason})` : ""),
      recommendationReason:
        "Combining lowest-cost Solar PV with wind complementarity and 4-hour LFP storage achieves the highest balanced score across affordability, deployment speed, and grid stability in upstream research benchmarks.",
      expectedResult:
        "The final research report will present a Hybrid Solar+Storage+Wind primary recommendation with sensitivity tables and clear capital allocation guidance.",
      supportingEvidence: [
        "Upstream Research Agent handoff: Solar PV ($32–$48/MWh) + Onshore Wind ($33–$50/MWh) deliver the lowest combined generation cost",
        "LFP grid battery pricing dropped ~40% in 24 months, addressing solar evening ramp intermittency",
        "Geothermal & hydro remain valuable regional baseload supplements but face tighter siting constraints",
        ...(sharedContext?.collectedSources?.slice(0, 2).map((s) => `Source: ${s}`) ?? []),
      ],
      potentialRisks: [
        "High-latitude regions with weak winter solar yield may favor Offshore Wind + Geothermal weighting",
        "Interconnection queue delays (3–5 years in parts of US/EU) could slow deployment timelines",
        "Supply chain concentration in polysilicon and LFP battery cells introduces geopolitical exposure",
      ],
      alternativeActions: [
        "Prioritize 24/7 Firm Clean Baseload (50% Reliability weight: Enhanced Geothermal + Hydro + Nuclear-ready grid)",
        "Prioritize Lowest Short-Term CapEx (60% Cost weight: Utility Solar + Onshore Wind only)",
        "Generate Region-Segmented Recommendations (Separate weightings for Sun-Belt vs. Northern grids)",
      ],
      confidence: step.confidence || 0.85,
      status: "pending",
      qaThread: [],
      isSimulated,
      createdAt: new Date().toISOString(),
    };
  }

  return {
    id: generateId("apr"),
    taskId,
    stepId: step.id,
    agentSlug: "execution-agent",
    actionTitle: `Approve Critical Step: ${step.title}`,
    actionDescription:
      `Proceed with "${step.title}" — ${step.description}` +
      (escalationReason ? ` (${escalationReason})` : ""),
    recommendationReason:
      "This step locks in strategic conclusions and trade-off priorities that directly shape the final deliverable.",
    expectedResult:
      "Confirmed framing will be carried directly into final deliverable synthesis with full citation traceability.",
    supportingEvidence: [
      `Aligned with stated objective: "${objective}"`,
      `Upstream handoffs received: ${sharedContext?.handoffs?.length ?? 0} structured packet(s)`,
      ...(extraConstraints.length ? [`Active human constraints: ${extraConstraints.join("; ")}`] : []),
    ],
    potentialRisks: [
      "Implicit weighting assumptions may not match stakeholder risk tolerance if left unreviewed",
      "Downstream final synthesis requires rework if scope changes later",
    ],
    alternativeActions: [
      "Adopt conservative risk-minimizing framing",
      "Adopt accelerated executive-summary format with tighter scope",
      "Request additional comparative evidence before synthesizing",
    ],
    confidence: step.confidence || 0.84,
    status: "pending",
    qaThread: [],
    isSimulated,
    createdAt: new Date().toISOString(),
  };
}

function buildSimulatedExecution(
  input: ExecutionStepInput
): Omit<ExecutionStepOutput, "latencyMs" | "inputTokens" | "outputTokens" | "fallbackNotice"> {
  const isLastStep = input.step.order === input.allSteps.length - 1;
  const isRenewable =
    input.objective.toLowerCase().includes("renewable") ||
    input.step.title.toLowerCase().includes("energy") ||
    input.step.title.toLowerCase().includes("report");
  const constraints = input.sharedContext?.humanConstraints ?? [];
  const sources = input.sharedContext?.collectedSources ?? [];

  const steeringNotes = [
    ...(input.humanDecisionNote ? [input.humanDecisionNote] : []),
    ...constraints,
  ];
  const combinedSteeringLower = steeringNotes.join(" ").toLowerCase();
  const isNorthernBaseloadPivot =
    combinedSteeringLower.includes("northern europe") ||
    combinedSteeringLower.includes("24/7") ||
    combinedSteeringLower.includes("winter") ||
    combinedSteeringLower.includes("baseload") ||
    combinedSteeringLower.includes("offshore wind");

  const humanNote = steeringNotes.length
    ? `\n> **Human Steering & Constraints Applied:** ${steeringNotes.join(" • ")}\n`
    : "";

  if (isRenewable && isLastStep && isNorthernBaseloadPivot) {
    return {
      isFinalReport: true,
      confidence: null,
      handoff: {
        id: generateId("hof"),
        fromAgent: "execution-agent",
        toAgent: "human",
        stepId: input.step.id,
        stepTitle: input.step.title,
        summary: "Delivered Northern Europe 24/7 Firm Baseload Report dynamically adapted from mid-task human pivot.",
        keyFindings: [
          "Re-ranked portfolio from daytime Solar PV to Offshore Wind + Enhanced Geothermal + Dispatchable Hydro.",
          "Integrated winter Dunkelflaute reliability risks & EU marine/grid permitting timelines.",
          "Preserved upstream Research Agent benchmarks without restarting the workflow.",
        ],
        sources,
        humanConstraints: constraints,
        createdAt: new Date().toISOString(),
      },
      output: `# Northern Europe 24/7 Clean Baseload Strategy Report (Predefined Demonstration Output)
> **PREDEFINED DEMONSTRATION OUTPUT (Deterministic Demo Mode):** This adapted report demonstrates how mid-task human pivots restructure the plan, dependencies, approval framing, and deliverable in offline Demo Mode. Connect a live \`GEMINI_API_KEY\` in \`.env.local\` for dynamically generated live AI synthesis.
${humanNote}
## 1. Executive Summary (Adapted to Mid-Task Pivot)
Following your mid-flight requirement shift toward **Northern European winter grid reliability**, this strategy replaces daytime Solar PV as the anchor asset with **Offshore Wind + Enhanced Geothermal + Dispatchable Hydropower**, supported by cross-border HVDC interconnectors to survive multi-day winter *Dunkelflaute* (low-wind, low-sun) events.

## 2. Winter-Weighted Comparative Source Matrix
| Energy Source | Winter Reliability Fit | LCOE ($/MWh) | Capacity Factor | Lifecycle CO₂ (g/kWh) | Northern EU Role |
| :--- | :---: | :---: | :---: | :---: | :--- |
| **Offshore Wind** | **High** | $72 – $108 | 45% – 55% | ~14 | Primary winter bulk generation |
| **Enhanced Geothermal** | **Very High (24/7)** | $60 – $95 | 85% – 92% | ~38 | Continuous firm clean baseload |
| **Hydropower (Reservoir)** | **Very High** | $45 – $68 | 40% – 55% | ~24 | Multi-day Dunkelflaute balancing |
| **Onshore Wind** | **Moderate–High** | $33 – $50 | 35% – 48% | ~12 | Cost-lowering inland complement |
| **Solar PV + 4hr LFP** | **Low in Winter** | $32 – $48 | 18% – 28% (annual) | ~40 | Summer peak / secondary offset |

## 3. Regulatory & Winter Grid Risk Mitigations
1. **Marine & Grid Permitting Bottlenecks:** Parallelize EU TEN-E offshore environmental permitting and substation reinforcement early to cut 48–72 month lead times.
2. **Dunkelflaute Resilience:** Pair 4-hour LFP batteries (intra-day smoothing) with Nordic hydro reservoirs and HVDC interconnects for 72+ hour winter lulls.
3. **Mid-Flight Adaptation Traceability:** Completed Research Agent benchmarks from Steps 1–2 were retained untouched while Steps 3–5 adapted dynamically to your human-approved pivot.

## 4. Recommended 3-Phase Northern Europe Roadmap
- **Phase 1 (0–24 Months):** Secure onshore wind + HVDC corridor capacity upgrades and launch geothermal test wells.
- **Phase 2 (24–48 Months):** Commission offshore wind clusters paired with Nordic hydro balancing contracts.
- **Phase 3 (48+ Months):** Scale 24/7 Enhanced Geothermal firm capacity to close residual winter reserve margins.

---
*Generated via RELAY AI Multi-Agent Collaboration — substantively adapted to mid-task human pivot (DEMO MODE).*`,
      explainability: {
        taskTitle: "Northern Europe 24/7 Clean Baseload Strategy",
        agentSlug: "execution-agent",
        decisionSummary: "Substantively pivoted final report recommendation from Solar PV to Offshore Wind + Geothermal + Hydro based on mid-task human constraint.",
        evidenceUsed: [
          `Mid-task human steering: ${steeringNotes.join("; ")}`,
          "Research Agent capacity-factor & LCOE handoff preserved from Steps 1–2",
          "Human Approval Center decision locking Northern European reliability weights",
        ],
        influencingFactors: [
          { factor: "Mid-task human pivot to Northern Europe 24/7 reliability", weight: 98, direction: "positive" },
          { factor: "Winter capacity factor advantage of Offshore Wind & Geothermal", weight: 92, direction: "positive" },
          { factor: "Higher Offshore CapEx & permitting duration trade-off", weight: 64, direction: "caution" },
        ],
        confidenceEstimate: null,
        confidenceNote: "Simulated Demo Mode adaptive synthesis — verify country-specific tariffs before CapEx allocation.",
        alternativeOptions: [
          {
            option: "Keep original global Solar PV + LFP recommendation",
            reasonNotChosen: "Would violate the human's mid-task requirement shift toward Northern European winter firmness.",
          },
        ],
        uncertainties: [
          "National auction CfD strike prices and marine spatial planning approvals vary significantly between North Sea and Baltic jurisdictions.",
        ],
        expectedOutcomes: [
          "Demonstrates end-to-end human control where mid-flight requirement shifts visibly reshape both intermediate approval gates and the final strategic report.",
        ],
        recommendationExplanation:
          "Adapting weighting and technology selection mid-workflow prevents wasted research while aligning final recommendations directly with evolving human requirements.",
        isSimulated: true,
      },
      isSimulated: true,
    };
  }

  if (isRenewable && isLastStep) {
    return {
      isFinalReport: true,
      confidence: null,
      handoff: {
        id: generateId("hof"),
        fromAgent: "execution-agent",
        toAgent: "human",
        stepId: input.step.id,
        stepTitle: input.step.title,
        summary: "Delivered final Renewable Energy Research Report honoring all human edits and approvals.",
        keyFindings: [
          "Compiled 5-source comparative matrix from Research Agent handoffs.",
          "Applied approved human trade-off weights and constraints.",
          "Included 3-phase deployment roadmap and interconnection risk mitigations.",
        ],
        sources,
        humanConstraints: constraints,
        createdAt: new Date().toISOString(),
      },
      output: `# Renewable Energy Research Report (Predefined Demonstration Output)
> **PREDEFINED DEMONSTRATION OUTPUT (Deterministic Demo Mode):** Illustrative benchmark synthesis for offline demonstration. Connect \`GEMINI_API_KEY\` for live Gemini generation.
${humanNote}
## 1. Executive Summary
Global power generation has crossed an economic tipping point: utility-scale **Solar PV** and **Onshore Wind**, firmed by rapidly declining **LFP battery storage**, now deliver the lowest-cost new electricity in most major markets. The primary barrier to accelerated decarbonization has shifted from generation economics to **grid transmission, permitting, and seasonal firming**.

## 2. Comparative Energy Source Matrix
| Energy Source | LCOE ($/MWh) | Capacity Factor | Lifecycle CO₂ (g/kWh) | Deployment Speed | Strategic Role |
| :--- | :---: | :---: | :---: | :---: | :--- |
| **Solar PV (Utility)** | $32 – $48 | 18% – 28% | ~40 | 12–18 months | Lowest-cost daytime bulk power |
| **Onshore Wind** | $33 – $50 | 35% – 48% | ~12 | 24–36 months | Strong nighttime & winter complement |
| **Offshore Wind** | $72 – $108 | 45% – 55% | ~14 | 48–72 months | High-yield coastal load centers |
| **Hydropower** | $45 – $68 | 40% – 55% | ~24 | 60+ months | Flexible dispatchable grid stabilizer |
| **Enhanced Geothermal** | $60 – $95 | 85% – 92% | ~38 | 36–48 months | 24/7 firm clean baseload |

## 3. Key Analytical Findings
1. **Hybrid Portfolios Outperform Single-Tech Bets:** Pairing Solar PV with Onshore Wind and 4-hour LFP storage reduces curtailment by 30–45% while preserving top-quartile LCOE.
2. **Grid Bottlenecks Are the #1 Execution Risk:** Over 1,500 GW of clean capacity awaits interconnection globally; grid-enhancing technologies (GETs) offer 2–3× faster relief than greenfield transmission alone.
3. **Human-Approved Framing Impact:** All weighting assumptions and regional caveats were explicitly reviewed and approved via RELAY AI's Human Approval Center prior to synthesis.

## 4. Recommended 3-Phase Roadmap
- **Phase 1 (0–18 Months):** Deploy co-located Solar PV + 4-hour LFP storage at existing substation interconnects.
- **Phase 2 (18–48 Months):** Expand wind diversification and deploy grid-enhancing dynamic line rating sensors.
- **Phase 3 (48+ Months):** Contract 24/7 firm clean baseload (Enhanced Geothermal / long-duration storage) to close the final 15% winter reliability gap.

---
*Generated via RELAY AI Multi-Agent Collaboration (DEMO MODE — clearly labeled simulated benchmark synthesis).*`,
      explainability: {
        taskTitle: "Renewable Energy Research Report",
        agentSlug: "execution-agent",
        decisionSummary: "Compiled final Renewable Energy Research Report honoring all human plan edits and approval decisions.",
        evidenceUsed: [
          "Research Agent benchmark matrix handoff (IEA, IRENA, NREL, Lazard LCOE+)",
          "Comparative energy analysis from Step 3",
          ...steeringNotes,
        ],
        influencingFactors: [
          { factor: "Fidelity to human-approved analytical framing", weight: 96, direction: "positive" },
          { factor: "Structured comparative clarity (executive table + roadmap)", weight: 90, direction: "positive" },
          { factor: "Transparent inclusion of grid & supply-chain risks", weight: 85, direction: "positive" },
        ],
        confidenceEstimate: null,
        confidenceNote: "Simulated Demo Mode synthesis — benchmark figures are illustrative ranges.",
        alternativeOptions: [
          {
            option: "Unstructured narrative essay without comparative table",
            reasonNotChosen: "Harder for decision-makers to audit trade-offs rapidly.",
          },
        ],
        uncertainties: [
          "Local policy incentives, interconnection tariffs, and capital cost rates require region-specific financial modeling prior to CapEx commitment.",
        ],
        expectedOutcomes: [
          "Provides an exportable Markdown decision brief aligned with explicit human approvals and constraints.",
        ],
        recommendationExplanation:
          "Combining quantitative comparison tables with phased strategic actions maximizes decision quality while keeping evidence verifiable.",
        isSimulated: true,
      },
      isSimulated: true,
    };
  }

  if (isRenewable && input.step.title.toLowerCase().includes("compare")) {
    return {
      isFinalReport: false,
      confidence: null,
      handoff: {
        id: generateId("hof"),
        fromAgent: "execution-agent",
        toAgent: "human",
        stepId: input.step.id,
        stepTitle: input.step.title,
        summary: "Prepared Pareto comparison across Cost, Reliability, and Speed-to-Grid ahead of Human Approval Gate.",
        keyFindings: [
          "Cost leaders: Utility Solar PV & Onshore Wind.",
          "24/7 firmness leaders: Enhanced Geothermal & Hydro.",
          "Weighting decision escalated to Human Approval Center.",
        ],
        sources,
        humanConstraints: constraints,
        createdAt: new Date().toISOString(),
      },
      output:
        "[SIMULATED COMPARATIVE ANALYSIS]\n" +
        humanNote +
        "• Cost Winner: Utility Solar PV ($32–$48/MWh) & Onshore Wind ($33–$50/MWh).\n" +
        "• Reliability Winner: Enhanced Geothermal (85%+ CF) & Dispatchable Hydropower.\n" +
        "• Speed-to-Grid Winner: Solar PV + Modular LFP Battery Storage (12–18 months).\n" +
        "• Key Insight: No single technology dominates all 3 axes; portfolio composition depends on stakeholder weighting (Cost vs. 24/7 Firmness vs. Carbon Speed).",
      explainability: {
        taskTitle: "Renewable Energy Research Report",
        agentSlug: "execution-agent",
        decisionSummary: "Ranked 5 renewable sources across Cost, Reliability, and Speed-to-Grid.",
        evidenceUsed: [
          "Collected LCOE & capacity factor ranges from Research Agent handoff",
          "Lifecycle emissions & construction lead-time metrics",
        ],
        influencingFactors: [
          { factor: "Multi-axis Pareto comparison", weight: 91, direction: "positive" },
          { factor: "Surfacing weighting trade-off for upcoming human approval", weight: 88, direction: "positive" },
        ],
        confidenceEstimate: null,
        confidenceNote: "Qualitative Pareto trade-off synthesis — final weighting requires human judgment.",
        alternativeOptions: [
          {
            option: "Pick a single universal 'best' energy source automatically",
            reasonNotChosen: "Silently imposes unverified stakeholder preferences instead of asking the human.",
          },
        ],
        uncertainties: [
          "Optimal portfolio mix shifts significantly by latitude, winter heating demand, and grid interconnect queue.",
        ],
        expectedOutcomes: [
          "Arms the human collaborator with clear Pareto trade-offs before Step 4's Approval Gate.",
        ],
        recommendationExplanation:
          "Surfacing Pareto trade-offs prepares the human collaborator to make an informed weighting decision at the approval gate.",
        isSimulated: true,
      },
      isSimulated: true,
    };
  }

  if (isLastStep) {
    return {
      isFinalReport: true,
      confidence: null,
      handoff: {
        id: generateId("hof"),
        fromAgent: "execution-agent",
        toAgent: "human",
        stepId: input.step.id,
        stepTitle: input.step.title,
        summary: `Delivered final collaborative artifact for "${input.objective.slice(0, 48)}".`,
        keyFindings: [
          `Synthesized ${input.priorOutputs.length} upstream step outputs.`,
          ...(steeringNotes.length ? [`Honored steering: ${steeringNotes[0]}`] : []),
        ],
        sources,
        humanConstraints: constraints,
        createdAt: new Date().toISOString(),
      },
      output: `# Final Collaborative Deliverable: ${input.objective}
${humanNote}
## 1. Objective & Scope
This deliverable synthesizes collaborative research, human plan refinements, and approved decision checkpoints for **${input.objective}**.

## 2. Core Evidence & Comparative Takeaways
${input.priorOutputs.map((out, i) => `### Stage ${i + 1} Summary\n${out}`).join("\n\n")}

## 3. Strategic Recommendations
1. **Prioritize High-Confidence, Low-Rework Actions:** Execute verified milestones first while preserving rollback checkpoints.
2. **Maintain Human Oversight on Trade-Offs:** Keep approval gates active whenever risk or stakeholder weighting shifts.
3. **Iterate with Measurable Telemetry:** Track completion time, edit count, and decision quality continuously.

---
*Generated by RELAY AI Execution Agent (DEMO MODE — simulated synthesis).*`,
      explainability: {
        taskTitle: input.objective.slice(0, 60),
        agentSlug: "execution-agent",
        decisionSummary: `Synthesized final deliverable for "${input.objective.slice(0, 50)}".`,
        evidenceUsed: [
          `${input.priorOutputs.length} prior step artifacts`,
          ...steeringNotes,
        ],
        influencingFactors: [
          { factor: "Human approval alignment", weight: 94, direction: "positive" },
          { factor: "Coverage of all plan steps", weight: 89, direction: "positive" },
        ],
        confidenceEstimate: null,
        confidenceNote: "Simulated Demo Mode synthesis.",
        alternativeOptions: [
          {
            option: "Short bullet list only",
            reasonNotChosen: "Lacks executive structure and traceability to intermediate steps.",
          },
        ],
        uncertainties: [
          "Simulated Demo Mode relies on structured workflow synthesis rather than live external domain APIs.",
        ],
        expectedOutcomes: [
          "Delivers an auditable, exportable Markdown artifact reflecting every upstream handoff and human decision.",
        ],
        recommendationExplanation:
          "A structured multi-section artifact connects every conclusion back to prior agent steps and human approvals.",
        isSimulated: true,
      },
      isSimulated: true,
    };
  }

  return {
    isFinalReport: false,
    confidence: null,
    handoff: {
      id: generateId("hof"),
      fromAgent: "execution-agent",
      toAgent: "execution-agent",
      stepId: input.step.id,
      stepTitle: input.step.title,
      summary: `Executed "${input.step.title}" and passed structured output to next step.`,
      keyFindings: [
        `Executed directive: ${input.step.description}`,
        `Integrated ${input.priorOutputs.length} upstream step artifact(s).`,
      ],
      sources,
      humanConstraints: constraints,
      createdAt: new Date().toISOString(),
    },
    output:
      `[SIMULATED EXECUTION — ${input.step.title}]\n` +
      `${humanNote}` +
      `• Executed approved task directive: "${input.step.description}".\n` +
      `• Integrated ${input.priorOutputs.length} upstream research artifact(s) into structured analytical findings.\n` +
      `• Verified readiness for next workflow stage with zero dependency conflicts.`,
    explainability: {
      taskTitle: input.objective.slice(0, 60),
      agentSlug: "execution-agent",
      decisionSummary: `Executed step "${input.step.title}" in accordance with approved plan.`,
      evidenceUsed: [
        `Approved step specification: ${input.step.description}`,
        ...steeringNotes,
      ],
      influencingFactors: [
        { factor: "Plan adherence & dependency verification", weight: 90, direction: "positive" },
        { factor: "Human feedback integration", weight: 86, direction: "positive" },
      ],
      confidenceEstimate: null,
      confidenceNote: "Simulated Demo Mode execution step.",
      alternativeOptions: [
        {
          option: "Defer synthesis to final step",
          reasonNotChosen: "Intermediate outputs increase transparency and catch drift early.",
        },
      ],
      uncertainties: [
        "Downstream final report remains sensitive to upcoming human approval or mid-task requirement updates.",
      ],
      expectedOutcomes: [
        "Feeds structured intermediate analysis into the next workflow milestone.",
      ],
      recommendationExplanation:
        "Producing explicit step-level outputs allows human collaborators to audit progress before final report generation.",
      isSimulated: true,
    },
    isSimulated: true,
  };
}

export async function runExecutionAgent(
  input: ExecutionStepInput
): Promise<ExecutionStepOutput> {
  const isLastStep = input.step.order === input.allSteps.length - 1;
  const constraints = input.sharedContext?.humanConstraints ?? [];
  const handoffs = input.sharedContext?.handoffs ?? [];

  const systemInstruction = isLastStep
    ? `You are the EXECUTION AGENT in RELAY AI. Produce a crisp, executive-grade Markdown final report synthesizing all prior step findings and explicitly honoring every human approval/feedback directive and constraint. Include an explicit 'Uncertainties & Limitations' subsection. Never fabricate citations or claim hidden chain-of-thought.`
    : `You are the EXECUTION AGENT in RELAY AI. Execute the approved intermediate step clearly and concisely (5-7 structured bullet points or compact markdown table), incorporating prior agent handoffs and human constraints.`;

  const prompt = `Objective: ${input.objective}
Step (${input.step.order + 1}/${input.allSteps.length}): ${input.step.title}
Instructions: ${input.step.description}
Active Human Constraints: ${constraints.join(" | ") || "None"}
Human Approval/Steering Note: ${input.humanDecisionNote || "Standard approved direction"}
Structured Agent Handoffs:
${handoffs.map((h) => `[${h.fromAgent} -> ${h.toAgent}] ${h.summary}`).join("\n") || "None"}
Prior Step Outputs:
${input.priorOutputs.join("\n\n---\n\n") || "None"}`;

  const call = await callGeminiSafe({
    systemInstruction,
    prompt,
    temperature: 0.35,
    forceDemo: input.forceDemo,
  });

  if (!call.isSimulated && call.text) {
    return {
      output: call.text,
      isFinalReport: isLastStep,
      handoff: {
        id: generateId("hof"),
        fromAgent: "execution-agent",
        toAgent: isLastStep ? "human" : "execution-agent",
        stepId: input.step.id,
        stepTitle: input.step.title,
        summary: `Completed "${input.step.title}" via live Gemini synthesis.`,
        keyFindings: [call.text.slice(0, 140).replace(/\s+/g, " ")],
        sources: input.sharedContext?.collectedSources ?? [],
        humanConstraints: constraints,
        createdAt: new Date().toISOString(),
      },
      confidence: null,
      explainability: {
        taskTitle: input.objective.slice(0, 60),
        agentSlug: "execution-agent",
        decisionSummary: `Executed "${input.step.title}" using live Gemini synthesis.`,
        evidenceUsed: [
          `Upstream outputs: ${input.priorOutputs.length} step(s)`,
          `Structured handoffs: ${handoffs.length} packet(s)`,
          input.humanDecisionNote || "Human-approved task parameters",
        ],
        influencingFactors: [
          { factor: "Alignment with approved human direction", weight: 95, direction: "positive" },
          { factor: "Grounding in collected step outputs", weight: 89, direction: "positive" },
        ],
        confidenceEstimate: null,
        confidenceNote: "Gemini does not output calibrated confidence scores; verify high-stakes claims against evidence.",
        alternativeOptions: [
          {
            option: "Generate shorter raw summary",
            reasonNotChosen: "Structured markdown improves human verification and decision clarity.",
          },
        ],
        uncertainties: [
          "Live LLM synthesis can reflect knowledge cutoff gaps and should be reviewed before irreversible decisions.",
        ],
        expectedOutcomes: [
          isLastStep
            ? "Delivers final exportable Markdown report grounded in collaborative workflow history."
            : "Produces intermediate findings handed to the next dependent workflow step.",
        ],
        recommendationExplanation:
          "Grounded execution ensures the final deliverable reflects the collaborative choices made throughout the workflow.",
        isSimulated: false,
      },
      isSimulated: false,
      latencyMs: call.latencyMs,
      inputTokens: call.inputTokens,
      outputTokens: call.outputTokens,
    };
  }

  const sim = buildSimulatedExecution(input);
  const fallbackNotice = call.fellBackToDemo
    ? `Live Gemini failed during execution (${call.errorKind ?? "api_error"}: ${call.error ?? "request error"}). Safely switched to clearly labeled DEMO MODE.`
    : undefined;

  return {
    ...sim,
    fallbackNotice,
    latencyMs: call.latencyMs,
    inputTokens: call.inputTokens,
    outputTokens: Math.max(call.outputTokens, isLastStep ? 420 : 180),
  };
}

export async function askAgentAboutApproval(params: {
  approval: ApprovalRequest;
  question: string;
  forceDemo?: boolean;
}): Promise<{ answer: string; isSimulated: boolean }> {
  const call = await callGeminiSafe({
    systemInstruction:
      "You are an explainable AI assistant in RELAY AI answering a human reviewer's question about a pending approval request. Be concise, honest about uncertainty, evidence-grounded, and never claim hidden chain-of-thought.",
    prompt: `Approval Action: ${params.approval.actionTitle}
Description: ${params.approval.actionDescription}
Recommendation Reason: ${params.approval.recommendationReason}
Supporting Evidence: ${params.approval.supportingEvidence.join("; ")}
Potential Risks: ${params.approval.potentialRisks.join("; ")}
Alternatives: ${params.approval.alternativeActions.join("; ")}

Human Question: ${params.question}`,
    temperature: 0.3,
    forceDemo: params.forceDemo,
  });

  if (!call.isSimulated && call.text) {
    return { answer: call.text, isSimulated: false };
  }

  return {
    isSimulated: true,
    answer: `Here is why I recommended **${params.approval.actionTitle}** (Demo Mode): it is based on ${params.approval.supportingEvidence.length} supporting points, starting with ${params.approval.supportingEvidence[0] || "earlier research findings"}. The main risk to weigh is ${params.approval.potentialRisks[0] || "shifting regional or stakeholder priorities"}. If you would prefer another direction, choose **Edit** or select one of the ${params.approval.alternativeActions.length} alternatives and I will update the remaining steps.`,
  };
}

function humanizeTaskStatus(status: string): string {
  const map: Record<string, string> = {
    pending: "waiting to start",
    planning: "drafting the plan",
    awaiting_plan_approval: "ready for your review",
    running: "in progress",
    waiting_for_approval: "waiting for your review",
    paused: "paused",
    completed: "completed",
    failed: "paused because a step needs attention",
    cancelled: "stopped",
  };
  return map[status] ?? status.replace(/_/g, " ");
}

function isAmbiguousGreeting(input: string): boolean {
  const clean = input.trim().toLowerCase().replace(/[!.,?]+$/g, "");
  return (
    clean.length <= 2 ||
    /^(hi|hello|hey|yo|sup|ok|okay|hmm|test|testing|thanks|thank you|good morning|good afternoon|good evening)$/.test(
      clean
    )
  );
}

export async function answerClarificationQuestion(params: {
  objective: string;
  taskStatus: string;
  stepsSummary: string;
  question: string;
  constraints?: string[];
  forceDemo?: boolean;
}): Promise<{ answer: string; isSimulated: boolean }> {
  if (isAmbiguousGreeting(params.question)) {
    const constraintNote = params.constraints?.length
      ? ` Active preferences currently noted: ${params.constraints.join("; ")}.`
      : "";
    return {
      isSimulated: true,
      answer: `I'm not sure what you'd like me to clarify or change.${constraintNote} Could you tell me a little more about your goal, or let me know which step you'd like to discuss?\n\n**Here are a couple of ways I can help:**\n- Ask why a specific step or review point is included in the plan.\n- Switch to **Modify Requirements** below to add a region, budget, or priority.`,
    };
  }

  const call = await callGeminiSafe({
    systemInstruction:
      "You are a helpful collaborative agent inside RELAY AI answering a user's clarification question about an active workflow without modifying the plan. Use clear, natural, professional language (no robotic status codes and no pretend human emotions). Answer in 2-3 concise sentences, then ask 1-2 short, practical follow-up questions to confirm the user's preferences. Never claim hidden chain-of-thought.",
    prompt: `Task Objective: ${params.objective}
Current Task Status: ${humanizeTaskStatus(params.taskStatus)}
Human Constraints: ${params.constraints?.join("; ") || "None"}
Current Steps:\n${params.stepsSummary}

Human Clarification Question: ${params.question}`,
    temperature: 0.3,
    forceDemo: params.forceDemo,
  });

  if (!call.isSimulated && call.text) {
    return { answer: call.text, isSimulated: false };
  }

  const lowerQ = params.question.toLowerCase();
  const isGateQ = lowerQ.includes("gate") || lowerQ.includes("approv") || lowerQ.includes("step 4") || lowerQ.includes("review");
  const isScopeQ = lowerQ.includes("region") || lowerQ.includes("cost") || lowerQ.includes("weight") || lowerQ.includes("scope");
  const constraintsText = params.constraints?.length
    ? params.constraints.join("; ")
    : "no custom constraints added yet";
  const friendlyStatus = humanizeTaskStatus(params.taskStatus);

  const directAnswer = isGateQ
    ? `This review checkpoint pauses before the final report is written so you can confirm the trade-off priorities (such as cost versus 24/7 reliability) first.${params.constraints?.length ? ` Active constraints considered: ${constraintsText}.` : ""}`
    : isScopeQ
    ? `Right now this workflow is focused on "${params.objective}" with these preferences: ${constraintsText}. Asking a question does not change your plan.`
    : `Your workflow for "${params.objective}" is currently **${friendlyStatus}** (active preferences: ${constraintsText}). Asking a question won't change any steps automatically.`;

  const followUps = isGateQ
    ? [
        "Would you like to prioritize **lowest cost**, **24/7 reliability**, or a **balanced approach**?",
        "Should we keep the review checkpoint on Step 4, or add an earlier check as well?",
      ]
    : [
        "Would you like to narrow this workflow to a specific **region, budget, or timeline**?",
        "If you want to update the remaining steps, choose **Modify Requirements** below and tell me what changed.",
      ];

  return {
    isSimulated: true,
    answer: `${directAnswer}\n\n**Quick questions to make sure we stay aligned:**\n- ${followUps[0]}\n- ${followUps[1]}`,
  };
}
