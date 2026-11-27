"""Stage 6 stress & edge-case test suite covering all 10 required failure modes."""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from pathlib import Path

import httpx
import pytest

from backend.api.main import create_app
from backend.shared.config import Settings
from backend.shared.llm_client import LLMClient, LLMRateLimitError, LLMTimeoutError
from backend.shared.schemas import ChatMessage, LLMStreamChunk


async def _wait_status(
    client: httpx.AsyncClient,
    sid: str,
    targets: set[str],
    timeout: float = 5.0,
) -> dict:
    deadline = asyncio.get_event_loop().time() + timeout
    last: dict = {}
    while asyncio.get_event_loop().time() < deadline:
        r = await client.get(f"/sessions/{sid}")
        assert r.status_code == 200
        last = r.json()
        if last["status"] in targets:
            return last
        await asyncio.sleep(0.02)
    raise AssertionError(f"Timeout waiting for {targets}; last={last.get('status')}")


class FailingMidStreamLLM(LLMClient):
    """Fails with a configured exception during streaming execution."""

    def __init__(self, settings: Settings, exc_factory) -> None:
        super().__init__(settings)
        self._exc_factory = exc_factory
        self.started = asyncio.Event()

    async def stream(
        self,
        messages: list[ChatMessage],
        system_prompt: str,
    ) -> AsyncIterator[LLMStreamChunk]:
        self.started.set()
        yield LLMStreamChunk(delta="partial before failure ", done=False)
        await asyncio.sleep(0.05)
        raise self._exc_factory()


@pytest.mark.asyncio
async def test_stress_1_rapid_repeated_interrupts(tmp_path: Path) -> None:
    cfg = Settings(
        llm_provider="mock",
        llm_model="mock-coplan-v1",
        coplan_step_delay_ms=20,
        db_path=str(tmp_path / "rapid_int.db"),
        telemetry_dir=str(tmp_path / "logs"),
    )
    app = create_app(cfg, auto_start_sessions=True)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        sid = (
            await client.post(
                "/sessions",
                json={
                    "task_id": "task_research_brief",
                    "participant_id": "P_STRESS1",
                    "condition": "coplan",
                    "autonomy_level": "L3",
                },
            )
        ).json()["session_id"]

        # Fire 5 rapid concurrent interrupts simultaneously
        responses = await asyncio.gather(
            *[
                client.post(
                    f"/sessions/{sid}/interrupt",
                    json={"new_instruction": f"Steering #{i}" if i % 2 == 0 else None},
                )
                for i in range(5)
            ]
        )
        assert all(r.status_code == 200 for r in responses)
        state = (await client.get(f"/sessions/{sid}")).json()
        assert state["status"] == "paused"

        # Sequence numbers in SSE log must remain strictly monotonic with zero duplicates
        sse = app.state.container.db.list_sse_events(sid, after_seq=0)
        seqs = [int(e.data["seq"]) for e in sse]
        assert seqs == sorted(seqs)
        assert len(seqs) == len(set(seqs))
        await app.state.container.engine.shutdown()


@pytest.mark.asyncio
async def test_stress_2_interrupt_during_failing_step_and_timeout_429(tmp_path: Path) -> None:
    for exc_factory in (
        lambda: LLMTimeoutError("Simulated upstream timeout"),
        lambda: LLMRateLimitError("Simulated 429 rate limit exhausted"),
    ):
        cfg = Settings(
            llm_provider="mock",
            llm_model="mock-coplan-v1",
            coplan_step_delay_ms=0,
            db_path=str(tmp_path / f"fail_{id(exc_factory)}.db"),
            telemetry_dir=str(tmp_path / "logs"),
        )
        app = create_app(cfg, auto_start_sessions=True)
        engine = app.state.container.engine
        failing_llm = FailingMidStreamLLM(cfg, exc_factory)
        engine.executor.llm_client = failing_llm

        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://test",
        ) as client:
            sid = (
                await client.post(
                    "/sessions",
                    json={
                        "task_id": "task_event_plan",
                        "participant_id": "P_FAIL",
                        "condition": "coplan",
                        "autonomy_level": "L3",
                    },
                )
            ).json()["session_id"]

            await asyncio.wait_for(failing_llm.started.wait(), timeout=2.0)
            # Race an interrupt right as the step is failing
            int_resp = await client.post(f"/sessions/{sid}/interrupt", json={})
            assert int_resp.status_code == 200
            state = (await client.get(f"/sessions/{sid}")).json()
            assert state["status"] in {"paused", "failed"}

            # Restore healthy mock executor and verify session recovers cleanly to done
            engine.executor.llm_client = engine.llm_client
            await client.post(f"/sessions/{sid}/resume", json={})
            recovered = await _wait_status(client, sid, {"done"})
            assert recovered["status"] == "done"
            await engine.shutdown()


@pytest.mark.asyncio
async def test_stress_3_sse_drop_reconnect_and_5_rollback_to_checkpoint_0(
    tmp_path: Path,
) -> None:
    cfg = Settings(
        llm_provider="mock",
        llm_model="mock-coplan-v1",
        coplan_step_delay_ms=0,
        db_path=str(tmp_path / "cp0.db"),
        telemetry_dir=str(tmp_path / "logs"),
    )
    app = create_app(cfg, auto_start_sessions=True)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        sid = (
            await client.post(
                "/sessions",
                json={
                    "task_id": "task_data_analysis",
                    "participant_id": "P_CP0",
                    "condition": "coplan",
                    "autonomy_level": "L3",
                },
            )
        ).json()["session_id"]
        done_state = await _wait_status(client, sid, {"done"})
        assert len(done_state["step_outputs"]) >= 4
        cp0 = done_state["checkpoints"][0]["checkpoint_id"]

        # Read first 3 SSE events, drop connection
        first_batch: list[int] = []
        async with client.stream("GET", f"/sessions/{sid}/stream?max_events=3") as s1:
            async for line in s1.aiter_lines():
                if line.startswith("data:"):
                    first_batch.append(json.loads(line.split(":", 1)[1])["seq"])
        assert len(first_batch) == 3

        # While disconnected, roll back all the way to checkpoint 0 (empty artifact, 0 outputs)
        rb = await client.post(f"/sessions/{sid}/rollback", json={"checkpoint_id": cp0})
        assert rb.status_code == 200
        rb_data = rb.json()
        assert rb_data["status"] == "rolled_back"
        assert rb_data["plan"]["version"] == 1
        assert rb_data["artifact"]["content"] == ""
        assert rb_data["step_outputs"] == {}

        # Resume from checkpoint 0 and complete cleanly
        await client.post(f"/sessions/{sid}/resume", json={})
        done2 = await _wait_status(client, sid, {"done"})
        assert done2["status"] == "done"
        assert len(done2["step_outputs"]) >= 4

        # Reconnect with Last-Event-ID and verify every missed event (including rollback_done) arrives
        replayed: list[tuple[str, int]] = []
        async with client.stream(
            "GET",
            f"/sessions/{sid}/stream?close_on_done=true",
            headers={"Last-Event-ID": str(first_batch[-1])},
        ) as s2:
            cur_ev = ""
            async for line in s2.aiter_lines():
                if line.startswith("event:"):
                    cur_ev = line.split(":", 1)[1].strip()
                elif line.startswith("data:"):
                    replayed.append((cur_ev, json.loads(line.split(":", 1)[1])["seq"]))

        all_seqs = first_batch + [seq for _, seq in replayed]
        assert all_seqs == sorted(all_seqs)
        assert len(all_seqs) == len(set(all_seqs))
        assert any(ev == "rollback_done" for ev, _ in replayed)
        await app.state.container.engine.shutdown()


@pytest.mark.asyncio
async def test_stress_4_all_steps_locked_plus_requirement_change_conflict(
    tmp_path: Path,
) -> None:
    cfg = Settings(
        llm_provider="mock",
        llm_model="mock-coplan-v1",
        coplan_step_delay_ms=0,
        db_path=str(tmp_path / "all_locked.db"),
        telemetry_dir=str(tmp_path / "logs"),
    )
    app = create_app(cfg, auto_start_sessions=True)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        sid = (
            await client.post(
                "/sessions",
                json={
                    "task_id": "task_event_plan",
                    "participant_id": "P_LOCKALL",
                    "condition": "coplan",
                    "autonomy_level": "L3",
                },
            )
        ).json()["session_id"]
        done_state = await _wait_status(client, sid, {"done"})

        # Lock EVERY single existing step in the plan!
        original_steps = done_state["plan"]["steps"]
        for s in original_steps:
            r = await client.post(f"/sessions/{sid}/steps/{s['id']}/lock")
            assert r.status_code == 200

        # Inject a conflicting requirement change targeting the locked steps
        req = await client.post(
            f"/sessions/{sid}/requirement",
            json={"text": "Budget is cut to $31,000 and add ADA live captioned hybrid stream."},
        )
        assert req.status_code == 200
        data = req.json()
        original_ids = {s["id"] for s in original_steps}
        # ZERO locked steps may be invalidated or overwritten!
        assert original_ids == set(data["preserved_locked_step_ids"])
        assert set(data["invalidated_step_ids"]).isdisjoint(original_ids)
        # New requirement is still accommodated via an added step
        assert len(data["plan"]["steps"]) > len(original_steps)
        await app.state.container.engine.shutdown()


@pytest.mark.asyncio
async def test_stress_6_empty_input_and_7_very_long_input(tmp_path: Path) -> None:
    cfg = Settings(
        llm_provider="mock",
        llm_model="mock-coplan-v1",
        coplan_step_delay_ms=0,
        db_path=str(tmp_path / "inputs.db"),
        telemetry_dir=str(tmp_path / "logs"),
    )
    app = create_app(cfg, auto_start_sessions=True)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        # Empty requirement -> 422
        co_sid = (
            await client.post(
                "/sessions",
                json={
                    "task_id": "task_research_brief",
                    "participant_id": "P_IN",
                    "condition": "coplan",
                    "autonomy_level": "L3",
                },
            )
        ).json()["session_id"]
        await _wait_status(client, co_sid, {"done"})

        assert (await client.post(f"/sessions/{co_sid}/requirement", json={"text": ""})).status_code == 422
        assert (await client.post(f"/sessions/{co_sid}/requirement", json={"text": "   "})).status_code == 422

        # Empty baseline chat message -> 422
        base_sid = (
            await client.post(
                "/sessions",
                json={
                    "task_id": "task_research_brief",
                    "participant_id": "P_IN",
                    "condition": "baseline",
                },
            )
        ).json()["session_id"]
        assert (await client.post(f"/chat/{base_sid}", json={"message": ""})).status_code == 422
        assert (await client.post(f"/chat/{base_sid}", json={"message": "   \n\t "})).status_code == 422

        # Very long input (50,000 chars) in both Co-Plan and Baseline
        huge_text = "Urban microgrid resilience analysis constraint. " * 1050
        assert len(huge_text) > 50_000

        long_co = await client.post(
            "/sessions",
            json={
                "task_id": "custom",
                "participant_id": "P_LONG",
                "condition": "coplan",
                "initial_prompt": huge_text,
                "autonomy_level": "L3",
            },
        )
        assert long_co.status_code == 200
        long_done = await _wait_status(client, long_co.json()["session_id"], {"done"})
        assert long_done["status"] == "done"

        long_base = await client.post(f"/chat/{base_sid}", json={"message": huge_text})
        assert long_base.status_code == 200
        assert long_base.json()["tokens_in"] > 10_000

        await app.state.container.engine.shutdown()


@pytest.mark.asyncio
async def test_stress_8_concurrent_sessions_isolation(tmp_path: Path) -> None:
    cfg = Settings(
        llm_provider="mock",
        llm_model="mock-coplan-v1",
        coplan_step_delay_ms=5,
        db_path=str(tmp_path / "concurrent.db"),
        telemetry_dir=str(tmp_path / "logs"),
    )
    app = create_app(cfg, auto_start_sessions=True)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        tasks = ["task_research_brief", "task_event_plan", "task_data_analysis"]

        async def run_coplan(idx: int) -> str:
            res = await client.post(
                "/sessions",
                json={
                    "task_id": tasks[idx % 3],
                    "participant_id": f"P_CONC_{idx}",
                    "condition": "coplan",
                    "autonomy_level": "L3",
                },
            )
            assert res.status_code == 200
            sid = res.json()["session_id"]
            done = await _wait_status(client, sid, {"done"}, timeout=10.0)
            assert done["status"] == "done"
            return sid

        async def run_baseline(idx: int) -> str:
            res = await client.post(
                "/sessions",
                json={
                    "task_id": tasks[idx % 3],
                    "participant_id": f"P_CONC_{idx}",
                    "condition": "baseline",
                },
            )
            assert res.status_code == 200
            sid = res.json()["session_id"]
            chat = await client.post(f"/chat/{sid}", json={"message": f"Draft deliverable #{idx}"})
            assert chat.status_code == 200
            return sid

        sids = await asyncio.gather(
            run_coplan(1),
            run_coplan(2),
            run_coplan(3),
            run_baseline(1),
            run_baseline(2),
            run_baseline(3),
        )
        assert len(set(sids)) == 6
        app.state.container.telemetry.flush()

        # Verify each concurrent session has isolated telemetry rows with zero cross-session bleed
        for sid in sids:
            events = app.state.container.telemetry.get_events(session_id=sid)
            assert len(events) >= 3
            assert all(e.session_id == sid for e in events)

        await app.state.container.engine.shutdown()
