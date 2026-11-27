"""Stage 3 tests: real-LLM resilience (timeout, 429 exponential backoff, malformed JSON repair & fallback),
provider/model telemetry stamping, and Co-Plan vs Baseline experimental config parity.
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

import httpx
import pytest

from backend.agent.planner import Planner
from backend.api.main import create_app
from backend.shared.config import Settings
from backend.shared.llm_client import (
    LLMClient,
    LLMRateLimitError,
    LLMTimeoutError,
)
from backend.shared.prompts import SHARED_SYSTEM_PROMPT, SHARED_TOOL_REGISTRY
from backend.shared.schemas import ChatMessage, LLMResponse


@pytest.mark.asyncio
async def test_llm_timeout_raises_typed_error() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("Simulated upstream timeout", request=request)

    cfg = Settings(
        llm_provider="openai",
        llm_model="gpt-4o-mini",
        llm_api_key="sk-test-dummy",
        llm_timeout_seconds=1.0,
    )
    client = LLMClient(cfg, http_transport=httpx.MockTransport(handler))

    with pytest.raises(LLMTimeoutError):
        await client.complete(
            messages=[ChatMessage(role="user", content="hello")],
            system_prompt=SHARED_SYSTEM_PROMPT,
        )


@pytest.mark.asyncio
async def test_llm_http_429_exponential_backoff_recovers_and_exhausts() -> None:
    attempts = 0
    sleeps: list[float] = []

    async def fake_sleep(delay: float) -> None:
        sleeps.append(delay)

    def handler_recover(request: httpx.Request) -> httpx.Response:
        nonlocal attempts
        attempts += 1
        if attempts <= 2:
            return httpx.Response(429, text="rate limit exceeded", request=request)
        return httpx.Response(
            200,
            json={
                "choices": [{"message": {"content": "Recovered after 429!"}}],
                "usage": {"prompt_tokens": 12, "completion_tokens": 6},
            },
            request=request,
        )

    cfg = Settings(
        llm_provider="openai",
        llm_model="gpt-4o-mini",
        llm_api_key="sk-test-dummy",
    )
    client = LLMClient(
        cfg,
        max_retries=3,
        base_backoff_seconds=0.5,
        http_transport=httpx.MockTransport(handler_recover),
        sleep_fn=fake_sleep,
    )
    resp = await client.complete(
        messages=[ChatMessage(role="user", content="test")],
        system_prompt=SHARED_SYSTEM_PROMPT,
    )
    assert resp.content == "Recovered after 429!"
    assert attempts == 3
    assert sleeps == [0.5, 1.0]  # Exponential backoff verified!

    # Now verify permanent 429 exhausts retries and raises LLMRateLimitError
    sleeps_exhaust: list[float] = []

    async def fake_sleep2(delay: float) -> None:
        sleeps_exhaust.append(delay)

    def handler_always_429(request: httpx.Request) -> httpx.Response:
        return httpx.Response(429, text="still rate limited", request=request)

    client2 = LLMClient(
        cfg,
        max_retries=2,
        base_backoff_seconds=0.25,
        http_transport=httpx.MockTransport(handler_always_429),
        sleep_fn=fake_sleep2,
    )
    with pytest.raises(LLMRateLimitError):
        await client2.complete(
            messages=[ChatMessage(role="user", content="test")],
            system_prompt=SHARED_SYSTEM_PROMPT,
        )
    assert sleeps_exhaust == [0.25, 0.5]


class ScriptedPlannerLLMClient(LLMClient):
    """Returns scripted responses to test malformed JSON repair-once and graceful fallback."""

    def __init__(self, settings: Settings, scripted: list[str]) -> None:
        super().__init__(settings)
        self._scripted = list(scripted)
        self.calls = 0

    async def complete(
        self,
        messages: list[ChatMessage],
        system_prompt: str,
        json_mode: bool = False,
    ) -> LLMResponse:
        self.calls += 1
        content = self._scripted.pop(0) if self._scripted else "NOT JSON AT ALL"
        return LLMResponse(
            content=content,
            tokens_in=50,
            tokens_out=30,
            latency_ms=5.0,
            model=self.model,
            provider=self.provider,
        )


@pytest.mark.asyncio
async def test_planner_malformed_json_repairs_once_then_emits_step_failed_on_double_failure(
    tmp_path: Path,
) -> None:
    cfg = Settings(
        llm_provider="mock",
        llm_model="mock-coplan-v1",
        coplan_step_delay_ms=0,
        db_path=str(tmp_path / "malformed.db"),
        telemetry_dir=str(tmp_path / "logs"),
    )

    # Case A: 1st call returns garbage, 2nd call (repair) returns valid JSON -> repaired!
    repaired_json = json.dumps(
        {
            "steps": [
                {
                    "id": "step_1",
                    "parent_id": None,
                    "title": "Repaired Step",
                    "description": "Valid JSON returned on single repair attempt.",
                    "confidence": 0.85,
                }
            ]
        }
    )
    repair_client = ScriptedPlannerLLMClient(cfg, ["Sorry, here is prose not JSON!", repaired_json])
    planner = Planner(repair_client)
    res_ok = await planner.create_plan("Write a research brief on urban microgrids.", [])
    assert repair_client.calls == 2
    assert res_ok.repair_attempted is True
    assert res_ok.parse_failed is False
    assert res_ok.plan.steps[0].title == "Repaired Step"

    # Case B: BOTH initial and repair calls return invalid JSON -> graceful fallback + step_failed SSE!
    app = create_app(cfg, auto_start_sessions=True)
    engine = app.state.container.engine
    broken_client = ScriptedPlannerLLMClient(cfg, ["broken {", "still broken {{"])
    engine.planner.llm_client = broken_client

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        sess = (
            await client.post(
                "/sessions",
                json={
                    "task_id": "task_research_brief",
                    "participant_id": "P_JSON",
                    "condition": "coplan",
                    "autonomy_level": "L3",
                },
            )
        ).json()
        sid = sess["session_id"]

        # Wait until fallback plan executes and finishes
        for _ in range(100):
            cur = (await client.get(f"/sessions/{sid}")).json()
            if cur["status"] == "done":
                break
            await asyncio.sleep(0.03)

        assert broken_client.calls == 2  # Initial + exactly 1 repair attempt
        sse_events = app.state.container.db.list_sse_events(sid, after_seq=0)
        failed_events = [e for e in sse_events if e.event == "step_failed"]
        assert len(failed_events) >= 1
        assert failed_events[0].data["step_id"] == "planner"
        assert failed_events[0].data["recoverable"] is True

        # Fallback plan still allowed the session to recover cleanly
        assert cur["status"] == "done"
        assert len(cur["plan"]["steps"]) == 3

        await engine.shutdown()


@pytest.mark.asyncio
async def test_coplan_and_baseline_config_parity_and_telemetry_provider_stamping(
    tmp_path: Path,
) -> None:
    cfg = Settings(
        llm_provider="mock",
        llm_model="mock-coplan-v1",
        llm_temperature=0.3,
        llm_max_tokens=2048,
        llm_top_p=1.0,
        coplan_step_delay_ms=0,
        db_path=str(tmp_path / "parity.db"),
        telemetry_dir=str(tmp_path / "logs"),
    )
    app = create_app(cfg, auto_start_sessions=False)
    container = app.state.container

    # Exact shared LLMClient & generation params across both conditions
    coplan_llm = container.engine.llm_client
    baseline_llm = container.baseline_service.llm_client
    assert coplan_llm is baseline_llm
    assert coplan_llm.model == baseline_llm.model == "mock-coplan-v1"
    assert coplan_llm.temperature == baseline_llm.temperature == 0.3
    assert coplan_llm.max_tokens == baseline_llm.max_tokens == 2048
    assert coplan_llm.top_p == baseline_llm.top_p == 1.0
    assert len(SHARED_SYSTEM_PROMPT) > 100
    assert {"extract_markdown_headings", "audit_artifact_constraints"} == set(
        SHARED_TOOL_REGISTRY.keys()
    )

    # Verify telemetry payload_json stamps llm_provider and llm_model
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        s_resp = await client.post(
            "/sessions",
            json={
                "task_id": "task_research_brief",
                "participant_id": "P_PARITY",
                "condition": "baseline",
            },
        )
        sid = s_resp.json()["session_id"]
        await client.post(f"/chat/{sid}", json={"message": "Draft a research brief."})

    container.telemetry.flush()
    events = container.telemetry.get_events(session_id=sid)
    assert len(events) >= 3
    for ev in events:
        payload = json.loads(ev.payload_json)
        assert payload["llm_provider"] == "mock"
        assert payload["llm_model"] == "mock-coplan-v1"
    await container.engine.shutdown()
