"""Single unified LLM wrapper used identically by BOTH Co-Plan and Baseline.

Supports:
- mock              (deterministic, domain-aware local engine for offline tests & demos)
- openai            (OpenAI Chat Completions API)
- openai_compatible (OpenRouter / Groq / Ollama / LiteLLM / vLLM)
- anthropic         (Anthropic Messages API)
- gemini            (Google Gemini generateContent API)

Real-provider resilience:
- Explicit timeout handling -> raises LLMTimeoutError
- HTTP 429 / 503 retries with exponential backoff (honoring Retry-After) -> raises LLMRateLimitError
- Clean stream cancellation on mid-flight interrupts
"""

from __future__ import annotations

import asyncio
import json
import math
import re
import time
from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Any

import httpx

from backend.shared.config import Settings
from backend.shared.schemas import ChatMessage, LLMResponse, LLMStreamChunk


class LLMError(RuntimeError):
    """Base error for LLM client failures."""


class LLMTimeoutError(LLMError, TimeoutError):
    """Raised when an upstream LLM call exceeds the configured timeout."""


class LLMRateLimitError(LLMError):
    """Raised when HTTP 429 rate limiting persists after exponential backoff retries."""


class LLMProviderError(LLMError):
    """Raised on non-retryable upstream provider HTTP/response errors."""


def estimate_tokens(text: str) -> int:
    """Lightweight deterministic token estimator (~4 chars per token)."""
    if not text:
        return 0
    return max(1, math.ceil(len(text) / 4))


class MockLLMBackend:
    """Rich, deterministic, domain-aware mock LLM for offline demos & unit tests."""

    def __init__(self, model: str, step_delay_ms: int = 140) -> None:
        self.model = model
        self.step_delay_ms = max(0, step_delay_ms)

    def _detect_domain(self, prompt: str) -> str:
        lower = prompt.lower()
        if "research brief" in lower or "urban microgrid" in lower or "policy brief" in lower:
            return "research_brief"
        if "event plan" in lower or "summit" in lower or "conference" in lower or "run-of-show" in lower:
            return "event_plan"
        if "data-analysis" in lower or "data analysis" in lower or "churn" in lower or "cohort" in lower:
            return "data_analysis"
        if "postmortem" in lower or "outage" in lower or "checkout api" in lower:
            return "postmortem"
        if "copilot" in lower or "launch" in lower or "hallucination" in lower:
            return "launch"
        if "monolith" in lower or "event-driven" in lower or "kafka" in lower or "outbox" in lower:
            return "architecture"
        return "generic"

    def _plan_for_domain(self, domain: str, prompt: str) -> dict[str, Any]:
        if domain == "research_brief":
            return {
                "steps": [
                    {
                        "id": "step_1",
                        "parent_id": None,
                        "title": "Executive Summary & Policy Framing",
                        "description": "Synthesize the decision context, grid resilience stakes, and headline recommendation for municipal leaders.",
                        "confidence": 0.90,
                    },
                    {
                        "id": "step_2",
                        "parent_id": None,
                        "title": "Evidence Synthesis & Case Comparisons",
                        "description": "Compare empirical microgrid deployments, outage reduction metrics, and capital cost ranges from the source materials.",
                        "confidence": 0.85,
                    },
                    {
                        "id": "step_3",
                        "parent_id": None,
                        "title": "Financing & Regulatory Trade-Offs",
                        "description": "Evaluate municipal bond, PPA, and grant options with uncertain tariff trade-offs depending on utility rules.",
                        "confidence": 0.61,
                    },
                    {
                        "id": "step_3_1",
                        "parent_id": "step_3",
                        "title": "Capital vs. Operating Cost Model",
                        "description": "Quantify upfront capex, storage replacement schedule, and payback period under baseline rates.",
                        "confidence": 0.78,
                    },
                    {
                        "id": "step_3_2",
                        "parent_id": "step_3",
                        "title": "Interconnection & Regulatory Risks",
                        "description": "Document utility interconnection queue delays and local permitting bottlenecks.",
                        "confidence": 0.75,
                    },
                    {
                        "id": "step_4",
                        "parent_id": None,
                        "title": "Prioritized Recommendations & 18-Month Roadmap",
                        "description": "Define pilot site selection criteria, governance owners, and measurable milestone KPIs.",
                        "confidence": 0.83,
                    },
                ]
            }
        if domain == "event_plan":
            return {
                "steps": [
                    {
                        "id": "step_1",
                        "parent_id": None,
                        "title": "Event Objectives, Audience & Venue Layout",
                        "description": "Establish summit goals, attendee persona breakdown, room allocation, and accessibility requirements.",
                        "confidence": 0.89,
                    },
                    {
                        "id": "step_2",
                        "parent_id": None,
                        "title": "Program Schedule & Run-of-Show",
                        "description": "Design the full-day keynote, panel, workshop, and networking schedule with buffer times.",
                        "confidence": 0.86,
                    },
                    {
                        "id": "step_3",
                        "parent_id": None,
                        "title": "Budget Allocation & Vendor Logistics",
                        "description": "Break down venue, AV, catering, and staffing line items with contingency trade-off options TBD.",
                        "confidence": 0.60,
                    },
                    {
                        "id": "step_3_1",
                        "parent_id": "step_3",
                        "title": "Catering, AV & Hybrid Streaming Spec",
                        "description": "Specify dietary accommodations, microphone/recording plan, and backup internet provisioning.",
                        "confidence": 0.81,
                    },
                    {
                        "id": "step_3_2",
                        "parent_id": "step_3",
                        "title": "Budget Ceiling & Contingency Reserve",
                        "description": "Verify line-item totals stay strictly under budget cap with a 10% reserve.",
                        "confidence": 0.77,
                    },
                    {
                        "id": "step_4",
                        "parent_id": None,
                        "title": "Risk Register, Staffing & Comms Checklist",
                        "description": "Define day-of incident playbooks, volunteer roles, speaker check-in, and post-event survey metrics.",
                        "confidence": 0.84,
                    },
                ]
            }
        if domain == "data_analysis":
            return {
                "steps": [
                    {
                        "id": "step_1",
                        "parent_id": None,
                        "title": "Dataset Audit & Metric Definitions",
                        "description": "Verify cohort definitions, retention formulas, sample sizes, and data-quality caveats from the raw table.",
                        "confidence": 0.91,
                    },
                    {
                        "id": "step_2",
                        "parent_id": None,
                        "title": "Segment & Trend Findings",
                        "description": "Quantify churn, expansion MRR, and onboarding drop-off across SMB, Mid-Market, and Enterprise cohorts.",
                        "confidence": 0.86,
                    },
                    {
                        "id": "step_3",
                        "parent_id": None,
                        "title": "Root-Cause Hypotheses & Confounders",
                        "description": "Assess competing explanations for Q3 churn spikes with uncertain seasonal options depending on pricing tier.",
                        "confidence": 0.62,
                    },
                    {
                        "id": "step_3_1",
                        "parent_id": "step_3",
                        "title": "Onboarding Funnel & Activation Correlation",
                        "description": "Compare 14-day activation rates against 90-day retention across all segments.",
                        "confidence": 0.80,
                    },
                    {
                        "id": "step_3_2",
                        "parent_id": "step_3",
                        "title": "Support Ticket Load & Latency Impact",
                        "description": "Correlate high-severity support ticket volume with account contraction.",
                        "confidence": 0.78,
                    },
                    {
                        "id": "step_4",
                        "parent_id": None,
                        "title": "Actionable Experiments & Executive Recommendations",
                        "description": "Prioritize retention interventions with expected ARR impact, owners, and A/B test guardrails.",
                        "confidence": 0.84,
                    },
                ]
            }
        if domain == "postmortem":
            return {
                "steps": [
                    {
                        "id": "step_1",
                        "parent_id": None,
                        "title": "Executive Summary & Impact Quantification",
                        "description": "Summarize the 47-minute checkout outage, customer impact, revenue exposure, and top-line remediation commitments.",
                        "confidence": 0.91,
                    },
                    {
                        "id": "step_2",
                        "parent_id": None,
                        "title": "Incident Timeline & Detection Signals",
                        "description": "Construct a minute-by-minute UTC timeline from feature-flag rollout through paging, mitigation, and full recovery.",
                        "confidence": 0.87,
                    },
                    {
                        "id": "step_3",
                        "parent_id": None,
                        "title": "Root Cause & Contributing Factors",
                        "description": "Analyze the interaction between the unthrottled feature flag and PostgreSQL primary connection-pool exhaustion.",
                        "confidence": 0.80,
                    },
                    {
                        "id": "step_3_1",
                        "parent_id": "step_3",
                        "title": "Feature Flag Blast-Radius Analysis",
                        "description": "Trace how checkout_v2_enrich bypassed read-replica routing across active checkout pods.",
                        "confidence": 0.84,
                    },
                    {
                        "id": "step_3_2",
                        "parent_id": "step_3",
                        "title": "PostgreSQL Pool Saturation Diagnostics",
                        "description": "Quantify primary connection queuing, p99 latency spikes, and timeout cascades.",
                        "confidence": 0.82,
                    },
                    {
                        "id": "step_4",
                        "parent_id": None,
                        "title": "Remediation Action Plan & SLAs",
                        "description": "Define prioritized engineering fixes with owners, target dates, PgBouncer tuning, and trade-off options depending on workload.",
                        "confidence": 0.62,
                    },
                    {
                        "id": "step_5",
                        "parent_id": None,
                        "title": "Rollout Guardrails & Verification Checklist",
                        "description": "Specify progressive canary gates, automated rollback SLO triggers, and load-test sign-off criteria.",
                        "confidence": 0.82,
                    },
                ]
            }
        if domain == "launch":
            return {
                "steps": [
                    {
                        "id": "step_1",
                        "parent_id": None,
                        "title": "Target Architecture & Data Flow",
                        "description": "Define retrieval pipeline, tenant isolation boundaries, citation grounding, and inference latency budgets.",
                        "confidence": 0.88,
                    },
                    {
                        "id": "step_2",
                        "parent_id": None,
                        "title": "Evaluation & Hallucination Guardrails",
                        "description": "Specify golden eval suites, faithfulness thresholds, abstention fallbacks, and red-team test cases.",
                        "confidence": 0.81,
                    },
                    {
                        "id": "step_3",
                        "parent_id": None,
                        "title": "Phased Rollout Schedule",
                        "description": "Map internal dogfooding, design-partner beta, and general availability milestones with trade-off options TBD.",
                        "confidence": 0.58,
                    },
                    {
                        "id": "step_4",
                        "parent_id": None,
                        "title": "Operational Runbook & Incident Triggers",
                        "description": "Document on-call escalation, prompt/model kill-switches, quality regression alarms, and audit logging.",
                        "confidence": 0.83,
                    },
                    {
                        "id": "step_5",
                        "parent_id": None,
                        "title": "Success Metrics & Governance Review",
                        "description": "Define adoption, CSAT, edit-distance, deflection accuracy, and security sign-off criteria.",
                        "confidence": 0.87,
                    },
                ]
            }
        if domain == "architecture":
            return {
                "steps": [
                    {
                        "id": "step_1",
                        "parent_id": None,
                        "title": "Current Bottlenecks & Coupling Audit",
                        "description": "Document synchronous transaction locks, deployment blast radius, and database contention in the monolith.",
                        "confidence": 0.90,
                    },
                    {
                        "id": "step_2",
                        "parent_id": None,
                        "title": "Public API Contract & Backward Compatibility",
                        "description": "Freeze external REST/webhook contracts, idempotency keys, and semantic versioning guarantees.",
                        "confidence": 0.89,
                    },
                    {
                        "id": "step_3",
                        "parent_id": None,
                        "title": "Target Event Topology & Broker Selection",
                        "description": "Design domain events for billing, inventory, and notifications comparing broker options and trade-offs.",
                        "confidence": 0.61,
                    },
                    {
                        "id": "step_4",
                        "parent_id": None,
                        "title": "Zero-Downtime Data Migration Strategy",
                        "description": "Outline dual-write/shadow-read verification, backfill throttling, and strangler-fig cutover stages.",
                        "confidence": 0.74,
                    },
                    {
                        "id": "step_5",
                        "parent_id": None,
                        "title": "Observability, Replay & Failure Recovery",
                        "description": "Specify distributed tracing, dead-letter queues, consumer lag alerts, and deterministic event replay.",
                        "confidence": 0.82,
                    },
                ]
            }
        topic = prompt.strip().splitlines()[0][:80]
        return {
            "steps": [
                {
                    "id": "step_1",
                    "parent_id": None,
                    "title": "Problem Framing & Objectives",
                    "description": f"Clarify scope, stakeholders, and measurable success criteria for: {topic}",
                    "confidence": 0.88,
                },
                {
                    "id": "step_2",
                    "parent_id": None,
                    "title": "Core Design & Trade-Off Analysis",
                    "description": "Evaluate primary design options, constraints, and architectural trade-offs.",
                    "confidence": 0.76,
                },
                {
                    "id": "step_3",
                    "parent_id": None,
                    "title": "Implementation & Delivery Plan",
                    "description": "Break work into phased milestones with clear owners and dependencies.",
                    "confidence": 0.63,
                },
                {
                    "id": "step_4",
                    "parent_id": None,
                    "title": "Risk Mitigation & Quality Guardrails",
                    "description": "Identify failure modes, fallback mechanisms, and validation gates.",
                    "confidence": 0.81,
                },
                {
                    "id": "step_5",
                    "parent_id": None,
                    "title": "Verification & Next Steps",
                    "description": "Define acceptance tests, launch telemetry, and immediate follow-up actions.",
                    "confidence": 0.87,
                },
            ]
        }

    def _expand_step(self, prompt: str) -> dict[str, Any]:
        title_match = re.search(r"- Title:\s*(.+)", prompt)
        title = title_match.group(1).strip() if title_match else "Selected Workstream"
        guidance_match = re.search(r"USER EXPANSION GUIDANCE:\s*(.+)", prompt)
        guidance = guidance_match.group(1).strip() if guidance_match else ""
        suffix = f" ({guidance})" if guidance else ""
        return {
            "substeps": [
                {
                    "title": f"{title}: Assumptions & Constraint Audit",
                    "description": f"Enumerate hard constraints, compliance boundaries, and dependencies{suffix}.",
                    "confidence": 0.84,
                },
                {
                    "title": f"{title}: Concrete Execution Spec",
                    "description": f"Draft step-by-step specifications, owners, and concrete artifacts{suffix}.",
                    "confidence": 0.78,
                },
                {
                    "title": f"{title}: Verification & Rollback Criteria",
                    "description": f"Define measurable pass/fail tests and safe fallback triggers{suffix}.",
                    "confidence": 0.86,
                },
            ]
        }

    def _replan(self, prompt: str) -> dict[str, Any]:
        req_match = re.search(
            r"(?:NEW MID-TASK REQUIREMENT CHANGE|MID-FLIGHT HUMAN STEERING INSTRUCTION):\s*(.+?)\n\nRules:",
            prompt,
            re.S,
        )
        requirement = req_match.group(1).strip() if req_match else "Updated stakeholder requirement"
        focus_match = re.search(r"INTERRUPTED STEP:\s*(\S+)", prompt)
        interrupted_step_id = focus_match.group(1).strip() if focus_match else None

        step_lines = re.findall(
            r"- \[([^\]]+)\] \(([^,]+), locked=(True|False), user_edited=(True|False), conf=[0-9.]+\) ([^:]+): (.+)",
            prompt,
        )
        req_lower = requirement.lower()
        req_tokens = {
            t
            for t in re.findall(r"[a-z0-9_-]{4,}", req_lower)
            if t
            not in {
                "with",
                "that",
                "from",
                "this",
                "must",
                "should",
                "have",
                "into",
                "only",
                "make",
                "update",
                "change",
                "step",
                "steps",
            }
        }
        invalidated: list[str] = []
        updated_steps: list[dict[str, Any]] = []

        for step_id, _status, locked_str, edited_str, title, desc in step_lines:
            if locked_str == "True" or edited_str == "True":
                continue
            title_lower = title.lower()
            desc_lower = desc.lower()
            if "timeline" in title_lower and "timeline" in req_lower and ("not modify" in req_lower or "do not" in req_lower):
                continue
            if "api contract" in title_lower and "api contract" in req_lower and ("unchanged" in req_lower or "keep" in req_lower):
                continue
            if "schedule" in title_lower and "keynote" in req_lower and "keep" in req_lower:
                continue

            keyword_overlap = any(tok in title_lower or tok in desc_lower for tok in req_tokens)
            is_interrupted_target = interrupted_step_id is not None and step_id == interrupted_step_id
            is_domain_impacted = any(
                k in title_lower
                for k in (
                    "remediation",
                    "guardrail",
                    "rollout",
                    "topology",
                    "broker",
                    "migration",
                    "runbook",
                    "budget",
                    "financing",
                    "recommendation",
                    "experiment",
                )
            )
            if is_interrupted_target or keyword_overlap or (
                "NEW MID-TASK REQUIREMENT CHANGE:" in prompt and is_domain_impacted
            ):
                invalidated.append(step_id)
                updated_steps.append(
                    {
                        "id": step_id,
                        "title": title.strip(),
                        "description": f"{desc.strip()} [Updated: {requirement[:120]}]",
                        "confidence": 0.64,
                    }
                )

        if not invalidated:
            for step_id, _status, locked_str, edited_str, title, desc in reversed(step_lines):
                if locked_str == "False" and edited_str == "False":
                    invalidated.append(step_id)
                    updated_steps.append(
                        {
                            "id": step_id,
                            "title": title.strip(),
                            "description": f"{desc.strip()} [Revised: {requirement[:120]}]",
                            "confidence": 0.65,
                        }
                    )
                    break

        if "MID-FLIGHT HUMAN STEERING INSTRUCTION:" in prompt:
            return {
                "invalidated_step_ids": invalidated,
                "updated_steps": updated_steps,
            }

        new_step_title = "Requirement Compliance & Constraint Integration"
        if "soc-2" in req_lower or "soc2" in req_lower:
            new_step_title = "SOC-2 Audit Controls & Zero-Downtime Verification"
        elif "hipaa" in req_lower:
            new_step_title = "HIPAA BAA, Zero-Retention & 6-Week Compression Gate"
        elif "outbox" in req_lower or "listen/notify" in req_lower:
            new_step_title = "PostgreSQL Outbox & LISTEN/NOTIFY Cutover Design"
        elif "equity" in req_lower or "low-income" in req_lower:
            new_step_title = "Equity Allocation & Low-Income Resilience Criteria"
        elif "hybrid" in req_lower or "budget" in req_lower:
            new_step_title = "Revised Budget Cap & Hybrid Accessibility Plan"
        elif "enterprise" in req_lower or "board" in req_lower:
            new_step_title = "Board-Ready Enterprise Retention & Sensitivity Analysis"

        return {
            "invalidated_step_ids": invalidated,
            "updated_steps": updated_steps,
            "new_steps": [
                {
                    "title": new_step_title,
                    "description": f"Explicitly verify and document satisfaction of mid-task requirement: {requirement}",
                    "confidence": 0.62,
                }
            ],
        }

    def _execute_step_markdown(self, prompt: str) -> str:
        title_match = re.search(r"- Title:\s*(.+)", prompt)
        desc_match = re.search(r"- Description:\s*(.+)", prompt)
        req_match = re.search(r"ACTIVE REQUIREMENTS:\n(.*?)\nLOCKED SECTIONS:", prompt, re.S)
        steer_match = re.search(r"USER STEERING INSTRUCTION:\n(.*?)\n\nEXISTING ARTIFACT", prompt, re.S)

        desc = desc_match.group(1).strip() if desc_match else "Detailed technical breakdown."
        reqs_raw = req_match.group(1).strip() if req_match else "(none)"
        steer = steer_match.group(1).strip() if steer_match else ""
        domain = self._detect_domain(prompt)
        req_lines = [
            line.strip("- ").strip()
            for line in reqs_raw.splitlines()
            if line.strip() and line.strip() != "(none)"
        ]

        bullets: list[str] = [f"- **Objective:** {desc}"]
        if domain == "research_brief":
            bullets.extend([
                "- **Empirical Evidence:** Municipal microgrid pilots in Bronzeville (IL) and Redwood Coast (CA) cut critical-facility outage hours by 64–78% while maintaining 4-hour battery islanding reserves.",
                "- **Cost & Governance:** Estimated $4.2M–$5.8M capex per 2 MW site; federal resilience grants plus utility tariff riders reduce municipal debt service by 30%.",
            ])
        elif domain == "event_plan":
            bullets.extend([
                "- **Operations Spec:** 250 in-person attendees across Main Auditorium + 3 breakout rooms, ADA-compliant routing, 15-minute transition buffers, and dedicated AV stage manager.",
                "- **Budget Control:** Venue ($14k), Catering ($11k), AV & captioning ($6.5k), Staffing/Signage ($3.5k), 10% contingency ($3.5k) — tracking cleanly within ceiling.",
            ])
        elif domain == "data_analysis":
            bullets.extend([
                "- **Quantitative Finding:** Q3 SMB monthly churn rose from 3.1% to 5.4% (+230 bps) concentrated among accounts failing Day-14 workflow activation (71% of churned accounts vs. 22% retained).",
                "- **Actionable Lever:** Guided onboarding checklist + proactive CSM trigger for accounts with >= 3 P1 tickets in 30 days projects +$420k ARR retained over two quarters.",
            ])
        elif domain == "postmortem":
            bullets.extend([
                "- **Primary Failure Mechanism:** Feature flag `checkout_v2_enrich` bypassed read-replica routing, saturating the 400-connection PostgreSQL primary pool within 90 seconds (p99 latency spiked from 110ms to 14.2s).",
                "- **Owner & SLA:** Platform Reliability Team — PgBouncer transaction pooling + connection cap enforcement within 7 days; automated canary error-budget abort within 14 days.",
            ])
        else:
            bullets.extend([
                "- **Concrete Specification:** Define clear interfaces, accountable owners, quantitative exit criteria, and fallback paths before execution.",
                "- **Verification Signal:** Track latency, defect escape rate, and stakeholder review sign-off before advancing to the next phase.",
            ])

        if req_lines:
            req_bullets = "\n".join(f"  - **Integrated Constraint:** {r}" for r in req_lines)
            bullets.append(f"- **Mid-Task Requirement Alignment:**\n{req_bullets}")

        if steer:
            bullets.append(f"- **Applied Human Steering:** Incorporated user direction — _{steer}_.")

        bullets.append(
            "- **Risks & Open Assumptions:** Validate assumptions against source materials and verify lock-protected upstream sections remain consistent."
        )

        return "### Key Decisions & Details\n\n" + "\n".join(bullets) + "\n"

    def _baseline_response(self, messages: list[ChatMessage]) -> str:
        last_user = ""
        for msg in reversed(messages):
            if msg.role == "user":
                last_user = msg.content
                break
        domain = self._detect_domain(last_user)
        plan = self._plan_for_domain(domain, last_user)["steps"]

        sections: list[str] = [
            "# Deliverable Draft\n\n_Generated via conventional single-turn baseline response._\n"
        ]
        for step in plan:
            step_prompt = (
                f"OVERALL TASK:\n{last_user}\n\n"
                f"CURRENT STEP TO EXECUTE:\n- Title: {step['title']}\n- Description: {step['description']}\n\n"
                f"ACTIVE REQUIREMENTS:\n(none)\nLOCKED SECTIONS: none\n"
            )
            body = self._execute_step_markdown(step_prompt)
            sections.append(f"## {step['title']}\n\n{body}")

        return "\n".join(sections).strip() + "\n"

    async def complete(
        self,
        messages: list[ChatMessage],
        system_prompt: str,
        json_mode: bool = False,
    ) -> LLMResponse:
        t0 = time.perf_counter()
        joined_in = system_prompt + "\n" + "\n".join(m.content for m in messages)
        last_user = messages[-1].content if messages else ""

        if self.step_delay_ms > 0:
            await asyncio.sleep(min(self.step_delay_ms / 1000.0, 0.35))

        if json_mode and "key `steps`" in last_user:
            domain = self._detect_domain(last_user)
            content = json.dumps(self._plan_for_domain(domain, last_user))
        elif json_mode and "key `substeps`" in last_user:
            content = json.dumps(self._expand_step(last_user))
        elif json_mode and (
            "NEW MID-TASK REQUIREMENT CHANGE:" in last_user
            or "MID-FLIGHT HUMAN STEERING INSTRUCTION:" in last_user
        ):
            content = json.dumps(self._replan(last_user))
        elif "CURRENT STEP TO EXECUTE:" in last_user:
            content = self._execute_step_markdown(last_user)
        else:
            content = self._baseline_response(messages)

        elapsed_ms = (time.perf_counter() - t0) * 1000.0
        return LLMResponse(
            content=content,
            tokens_in=estimate_tokens(joined_in),
            tokens_out=estimate_tokens(content),
            latency_ms=round(elapsed_ms, 2),
            model=self.model,
            provider="mock",
        )

    async def stream(
        self,
        messages: list[ChatMessage],
        system_prompt: str,
    ) -> AsyncIterator[LLMStreamChunk]:
        t0 = time.perf_counter()
        full = await self.complete(messages, system_prompt, json_mode=False)
        words = full.content.split(" ")
        chunk_size = max(4, len(words) // 10)

        for i in range(0, len(words), chunk_size):
            piece = " ".join(words[i : i + chunk_size])
            if i + chunk_size < len(words):
                piece += " "
            if self.step_delay_ms > 0:
                await asyncio.sleep(self.step_delay_ms / 1000.0)
            yield LLMStreamChunk(delta=piece, done=False)

        elapsed_ms = (time.perf_counter() - t0) * 1000.0
        yield LLMStreamChunk(
            delta="",
            done=True,
            tokens_in=full.tokens_in,
            tokens_out=full.tokens_out,
            latency_ms=round(elapsed_ms, 2),
        )


class LLMClient:
    """Unified async LLM client shared by Co-Plan and Baseline with timeout & 429 retry backoff."""

    def __init__(
        self,
        settings: Settings,
        *,
        max_retries: int = 3,
        base_backoff_seconds: float = 0.5,
        http_transport: httpx.AsyncBaseTransport | None = None,
        sleep_fn: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        self.settings = settings
        self.provider = settings.llm_provider
        self.model = settings.llm_model
        self.temperature = settings.llm_temperature
        self.max_tokens = settings.llm_max_tokens
        self.top_p = settings.llm_top_p
        self.max_retries = max_retries
        self.base_backoff_seconds = base_backoff_seconds
        self._http_transport = http_transport
        self._sleep = sleep_fn
        self._mock = MockLLMBackend(
            model=settings.llm_model,
            step_delay_ms=settings.coplan_step_delay_ms,
        )

    def _effective_provider(self) -> str:
        if self.provider != "mock" and not self.settings.llm_api_key.strip():
            return "mock"
        return self.provider

    def _make_http_client(self) -> httpx.AsyncClient:
        kwargs: dict[str, Any] = {"timeout": self.settings.llm_timeout_seconds}
        if self._http_transport is not None:
            kwargs["transport"] = self._http_transport
        return httpx.AsyncClient(**kwargs)

    async def _post_with_retry(
        self,
        url: str,
        *,
        payload: dict[str, Any],
        headers: dict[str, str],
    ) -> dict[str, Any]:
        """POST JSON with timeout handling and HTTP 429/503 exponential backoff."""
        async with self._make_http_client() as client:
            for attempt in range(self.max_retries + 1):
                try:
                    resp = await client.post(url, json=payload, headers=headers)
                except httpx.TimeoutException as exc:
                    raise LLMTimeoutError(
                        f"LLM request timed out after {self.settings.llm_timeout_seconds}s "
                        f"({self.provider}/{self.model})."
                    ) from exc
                except httpx.HTTPError as exc:
                    raise LLMProviderError(
                        f"LLM HTTP transport error ({self.provider}/{self.model}): {exc}"
                    ) from exc

                if resp.status_code in {429, 503}:
                    if attempt >= self.max_retries:
                        raise LLMRateLimitError(
                            f"LLM rate limited (HTTP {resp.status_code}) after "
                            f"{self.max_retries + 1} attempts ({self.provider}/{self.model})."
                        )
                    retry_after_raw = resp.headers.get("Retry-After")
                    delay = self.base_backoff_seconds * (2**attempt)
                    if retry_after_raw:
                        try:
                            delay = max(0.0, min(30.0, float(retry_after_raw)))
                        except ValueError:
                            pass
                    await self._sleep(delay)
                    continue

                if resp.status_code >= 400:
                    raise LLMProviderError(
                        f"LLM provider error HTTP {resp.status_code}: {resp.text[:300]}"
                    )
                return resp.json()

        raise LLMRateLimitError(f"LLM request failed after retries ({self.provider}/{self.model}).")

    async def complete(
        self,
        messages: list[ChatMessage],
        system_prompt: str,
        json_mode: bool = False,
    ) -> LLMResponse:
        provider = self._effective_provider()
        if provider == "mock":
            return await self._mock.complete(messages, system_prompt, json_mode=json_mode)
        if provider in {"openai", "openai_compatible"}:
            return await self._complete_openai(messages, system_prompt, json_mode=json_mode)
        if provider == "anthropic":
            return await self._complete_anthropic(messages, system_prompt)
        if provider == "gemini":
            return await self._complete_gemini(messages, system_prompt, json_mode=json_mode)
        raise ValueError(f"Unsupported LLM provider: {provider}")

    async def stream(
        self,
        messages: list[ChatMessage],
        system_prompt: str,
    ) -> AsyncIterator[LLMStreamChunk]:
        provider = self._effective_provider()
        if provider == "mock":
            async for chunk in self._mock.stream(messages, system_prompt):
                yield chunk
            return
        if provider in {"openai", "openai_compatible"}:
            async for chunk in self._stream_openai(messages, system_prompt):
                yield chunk
            return
        response = await self.complete(messages, system_prompt, json_mode=False)
        step = max(24, len(response.content) // 12)
        for idx in range(0, len(response.content), step):
            yield LLMStreamChunk(delta=response.content[idx : idx + step], done=False)
            await asyncio.sleep(0.01)
        yield LLMStreamChunk(
            delta="",
            done=True,
            tokens_in=response.tokens_in,
            tokens_out=response.tokens_out,
            latency_ms=response.latency_ms,
        )

    # ------------------------------------------------------------------
    # OpenAI / OpenAI-Compatible
    # ------------------------------------------------------------------

    async def _complete_openai(
        self,
        messages: list[ChatMessage],
        system_prompt: str,
        json_mode: bool = False,
    ) -> LLMResponse:
        t0 = time.perf_counter()
        base_url = (self.settings.llm_base_url or "https://api.openai.com/v1").rstrip("/")
        payload: dict[str, Any] = {
            "model": self.model,
            "temperature": self.temperature,
            "max_tokens": self.max_tokens,
            "top_p": self.top_p,
            "messages": [
                {"role": "system", "content": system_prompt},
                *[{"role": m.role, "content": m.content} for m in messages],
            ],
        }
        if json_mode:
            payload["response_format"] = {"type": "json_object"}

        headers = {
            "Authorization": f"Bearer {self.settings.llm_api_key}",
            "Content-Type": "application/json",
        }
        data = await self._post_with_retry(
            f"{base_url}/chat/completions",
            payload=payload,
            headers=headers,
        )

        content = data["choices"][0]["message"]["content"] or ""
        usage = data.get("usage") or {}
        elapsed_ms = (time.perf_counter() - t0) * 1000.0
        return LLMResponse(
            content=content,
            tokens_in=int(usage.get("prompt_tokens") or estimate_tokens(system_prompt)),
            tokens_out=int(usage.get("completion_tokens") or estimate_tokens(content)),
            latency_ms=round(elapsed_ms, 2),
            model=self.model,
            provider=self.provider,
        )

    async def _stream_openai(
        self,
        messages: list[ChatMessage],
        system_prompt: str,
    ) -> AsyncIterator[LLMStreamChunk]:
        t0 = time.perf_counter()
        base_url = (self.settings.llm_base_url or "https://api.openai.com/v1").rstrip("/")
        payload: dict[str, Any] = {
            "model": self.model,
            "temperature": self.temperature,
            "max_tokens": self.max_tokens,
            "top_p": self.top_p,
            "stream": True,
            "messages": [
                {"role": "system", "content": system_prompt},
                *[{"role": m.role, "content": m.content} for m in messages],
            ],
        }
        headers = {
            "Authorization": f"Bearer {self.settings.llm_api_key}",
            "Content-Type": "application/json",
        }
        collected: list[str] = []
        prompt_text = system_prompt + "\n".join(m.content for m in messages)

        async with self._make_http_client() as client:
            for attempt in range(self.max_retries + 1):
                try:
                    async with client.stream(
                        "POST",
                        f"{base_url}/chat/completions",
                        json=payload,
                        headers=headers,
                    ) as resp:
                        if resp.status_code in {429, 503}:
                            if attempt >= self.max_retries:
                                raise LLMRateLimitError(
                                    f"Streaming LLM rate limited (HTTP {resp.status_code})."
                                )
                            await self._sleep(self.base_backoff_seconds * (2**attempt))
                            continue
                        if resp.status_code >= 400:
                            body = (await resp.aread()).decode("utf-8", errors="replace")
                            raise LLMProviderError(f"HTTP {resp.status_code}: {body[:300]}")
                        async for line in resp.aiter_lines():
                            if not line.startswith("data: "):
                                continue
                            raw = line[6:].strip()
                            if raw == "[DONE]":
                                break
                            chunk_data = json.loads(raw)
                            delta = chunk_data["choices"][0].get("delta", {}).get("content", "")
                            if delta:
                                collected.append(delta)
                                yield LLMStreamChunk(delta=delta, done=False)
                    break
                except httpx.TimeoutException as exc:
                    raise LLMTimeoutError(
                        f"Streaming LLM call timed out after {self.settings.llm_timeout_seconds}s."
                    ) from exc

        elapsed_ms = (time.perf_counter() - t0) * 1000.0
        full_text = "".join(collected)
        yield LLMStreamChunk(
            delta="",
            done=True,
            tokens_in=estimate_tokens(prompt_text),
            tokens_out=estimate_tokens(full_text),
            latency_ms=round(elapsed_ms, 2),
        )

    # ------------------------------------------------------------------
    # Anthropic Messages API
    # ------------------------------------------------------------------

    async def _complete_anthropic(
        self,
        messages: list[ChatMessage],
        system_prompt: str,
    ) -> LLMResponse:
        t0 = time.perf_counter()
        base_url = (self.settings.llm_base_url or "https://api.anthropic.com/v1").rstrip("/")
        payload: dict[str, Any] = {
            "model": self.model,
            "max_tokens": self.max_tokens,
            "temperature": self.temperature,
            "top_p": self.top_p,
            "system": system_prompt,
            "messages": [
                {"role": m.role, "content": m.content}
                for m in messages
                if m.role != "system"
            ],
        }
        headers = {
            "x-api-key": self.settings.llm_api_key,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
        }
        data = await self._post_with_retry(
            f"{base_url}/messages",
            payload=payload,
            headers=headers,
        )

        blocks = data.get("content") or []
        content = "".join(b.get("text", "") for b in blocks if b.get("type") == "text")
        usage = data.get("usage") or {}
        elapsed_ms = (time.perf_counter() - t0) * 1000.0
        return LLMResponse(
            content=content,
            tokens_in=int(usage.get("input_tokens") or estimate_tokens(system_prompt)),
            tokens_out=int(usage.get("output_tokens") or estimate_tokens(content)),
            latency_ms=round(elapsed_ms, 2),
            model=self.model,
            provider=self.provider,
        )

    # ------------------------------------------------------------------
    # Google Gemini API
    # ------------------------------------------------------------------

    async def _complete_gemini(
        self,
        messages: list[ChatMessage],
        system_prompt: str,
        json_mode: bool = False,
    ) -> LLMResponse:
        t0 = time.perf_counter()
        base_url = (
            self.settings.llm_base_url or "https://generativelanguage.googleapis.com/v1beta"
        ).rstrip("/")
        url = f"{base_url}/models/{self.model}:generateContent?key={self.settings.llm_api_key}"
        generation_config: dict[str, Any] = {
            "temperature": self.temperature,
            "maxOutputTokens": self.max_tokens,
            "topP": self.top_p,
        }
        if json_mode:
            generation_config["responseMimeType"] = "application/json"

        contents = [
            {
                "role": "model" if m.role == "assistant" else "user",
                "parts": [{"text": m.content}],
            }
            for m in messages
            if m.role != "system"
        ]
        payload: dict[str, Any] = {
            "systemInstruction": {"parts": [{"text": system_prompt}]},
            "contents": contents,
            "generationConfig": generation_config,
        }
        data = await self._post_with_retry(
            url,
            payload=payload,
            headers={"Content-Type": "application/json"},
        )

        candidates = data.get("candidates") or []
        parts = candidates[0]["content"]["parts"] if candidates else []
        content = "".join(p.get("text", "") for p in parts)
        usage = data.get("usageMetadata") or {}
        elapsed_ms = (time.perf_counter() - t0) * 1000.0
        return LLMResponse(
            content=content,
            tokens_in=int(usage.get("promptTokenCount") or estimate_tokens(system_prompt)),
            tokens_out=int(usage.get("candidatesTokenCount") or estimate_tokens(content)),
            latency_ms=round(elapsed_ms, 2),
            model=self.model,
            provider=self.provider,
        )
