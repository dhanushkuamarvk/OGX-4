"""Streaming step executor with immediate in-flight LLM cancellation and safe Markdown section patching."""

from __future__ import annotations

import asyncio
import contextlib
import re
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from backend.shared.llm_client import LLMClient
from backend.shared.prompts import (
    SHARED_SYSTEM_PROMPT,
    audit_artifact_constraints,
    build_step_execution_prompt,
)
from backend.shared.schemas import Artifact, ChatMessage, Plan, Step


@dataclass(frozen=True)
class StepExecutionResult:
    step_id: str
    section_heading: str
    section_body: str
    updated_artifact_content: str
    updated_confidence: float
    tokens_in: int
    tokens_out: int
    latency_ms: float
    interrupted: bool = False


ProgressCallback = Callable[[str, float], Awaitable[None]]


def _slug_marker(step_id: str) -> tuple[str, str]:
    return (
        f"<!-- coplan:step:{step_id}:start -->",
        f"<!-- coplan:step:{step_id}:end -->",
    )


def upsert_artifact_section(
    current_content: str,
    *,
    step_id: str,
    title: str,
    body: str,
    is_substep: bool = False,
) -> tuple[str, str]:
    """Insert or replace ONLY the section owned by `step_id`, preserving all other sections."""
    start_tag, end_tag = _slug_marker(step_id)
    heading_prefix = "###" if is_substep else "##"
    heading = f"{heading_prefix} {title}"
    block = f"{start_tag}\n{heading}\n\n{body.strip()}\n{end_tag}"

    pattern = re.compile(
        re.escape(start_tag) + r".*?" + re.escape(end_tag),
        re.S,
    )
    if pattern.search(current_content):
        updated = pattern.sub(lambda _m: block, current_content, count=1)
        return updated.strip() + "\n", heading

    prefix = current_content.strip()
    if not prefix:
        updated = f"# Co-Plan Working Artifact\n\n{block}\n"
    else:
        updated = f"{prefix}\n\n{block}\n"
    return updated, heading


def split_markdown_sections(content: str) -> dict[str, str]:
    """Split a Markdown document into keyed blocks for section-level optimistic merge."""
    sections: dict[str, str] = {}
    marker_re = re.compile(
        r"(<!-- coplan:step:([^:]+):start -->.*?<!-- coplan:step:\2:end -->)",
        re.S,
    )
    last_end = 0
    preamble_parts: list[str] = []
    for match in marker_re.finditer(content):
        before = content[last_end : match.start()].strip()
        if before:
            preamble_parts.append(before)
        step_id = match.group(2)
        sections[f"step:{step_id}"] = match.group(1).strip()
        last_end = match.end()
    tail = content[last_end:].strip()
    if tail:
        sections["__tail__"] = tail
    if preamble_parts:
        sections["__preamble__"] = "\n\n".join(preamble_parts)
    return sections


def merge_non_overlapping_artifact_edit(
    *,
    base_content: str,
    server_content: str,
    user_content: str,
) -> tuple[bool, str]:
    """Attempt a clean 3-way section merge when base_version < current_version.

    Returns (merged_cleanly, resulting_content). If both human and agent edited
    the exact same section, returns (False, server_content) so the caller can
    surface a structured 409 conflict.
    """
    base_secs = split_markdown_sections(base_content)
    server_secs = split_markdown_sections(server_content)
    user_secs = split_markdown_sections(user_content)

    if len(server_secs) <= 1 and server_content.strip() != base_content.strip():
        return False, server_content

    all_keys = list(dict.fromkeys([*base_secs.keys(), *server_secs.keys(), *user_secs.keys()]))
    merged_blocks: list[str] = []

    for key in all_keys:
        b = base_secs.get(key, "")
        s = server_secs.get(key, "")
        u = user_secs.get(key, "")
        if s == u:
            if s:
                merged_blocks.append(s)
        elif u == b:
            if s:
                merged_blocks.append(s)
        elif s == b:
            if u:
                merged_blocks.append(u)
        else:
            return False, server_content

    return True, "\n\n".join(merged_blocks).strip() + "\n"


class StepExecutor:
    """Executes individual Co-Plan steps with live streaming and true mid-flight LLM cancellation."""

    def __init__(self, llm_client: LLMClient) -> None:
        self.llm_client = llm_client

    async def execute_step(
        self,
        *,
        task_prompt: str,
        step: Step,
        plan: Plan,
        artifact: Artifact,
        requirements: list[str],
        active_instruction: str | None,
        interrupt_event: asyncio.Event,
        on_progress: ProgressCallback,
    ) -> StepExecutionResult:
        t0 = time.perf_counter()
        prompt = build_step_execution_prompt(
            task_prompt=task_prompt,
            step=step,
            plan=plan,
            artifact=artifact,
            requirements=requirements,
            active_instruction=active_instruction,
        )

        chunks: list[str] = []
        tokens_in = 0
        tokens_out = 0
        interrupted = False
        stream_index = 0

        stream_gen = self.llm_client.stream(
            messages=[ChatMessage(role="user", content=prompt)],
            system_prompt=SHARED_SYSTEM_PROMPT,
        )
        interrupt_waiter = asyncio.create_task(interrupt_event.wait())
        try:
            while True:
                if interrupt_event.is_set():
                    interrupted = True
                    break

                next_chunk_task = asyncio.create_task(anext(stream_gen))
                done_tasks, _pending = await asyncio.wait(
                    {next_chunk_task, interrupt_waiter},
                    return_when=asyncio.FIRST_COMPLETED,
                )

                if interrupt_waiter in done_tasks:
                    interrupted = True
                    if not next_chunk_task.done():
                        next_chunk_task.cancel()
                        with contextlib.suppress(asyncio.CancelledError, StopAsyncIteration):
                            await next_chunk_task
                    break

                try:
                    chunk = next_chunk_task.result()
                except StopAsyncIteration:
                    break

                if chunk.delta:
                    chunks.append(chunk.delta)
                    stream_index += 1
                    approx_pct = min(95.0, round(stream_index * 9.5, 1))
                    await on_progress(chunk.delta, approx_pct)
                if chunk.done:
                    tokens_in = chunk.tokens_in
                    tokens_out = chunk.tokens_out
        finally:
            if not interrupt_waiter.done():
                interrupt_waiter.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await interrupt_waiter
            if hasattr(stream_gen, "aclose"):
                with contextlib.suppress(Exception):
                    await stream_gen.aclose()  # type: ignore[attr-defined]

        elapsed_ms = round((time.perf_counter() - t0) * 1000.0, 2)
        body = "".join(chunks).strip()

        if interrupted:
            return StepExecutionResult(
                step_id=step.id,
                section_heading=f"{'###' if step.parent_id else '##'} {step.title}",
                section_body=body,
                updated_artifact_content=artifact.content,
                updated_confidence=step.confidence,
                tokens_in=tokens_in,
                tokens_out=tokens_out,
                latency_ms=elapsed_ms,
                interrupted=True,
            )

        updated_content, heading = upsert_artifact_section(
            artifact.content,
            step_id=step.id,
            title=step.title,
            body=body,
            is_substep=step.parent_id is not None,
        )

        audit = audit_artifact_constraints(updated_content, requirements)
        calibrated = round(
            max(
                0.25,
                min(
                    0.98,
                    0.65 * step.confidence + 0.35 * audit.coverage_score,
                ),
            ),
            3,
        )

        return StepExecutionResult(
            step_id=step.id,
            section_heading=heading,
            section_body=body,
            updated_artifact_content=updated_content,
            updated_confidence=calibrated,
            tokens_in=tokens_in,
            tokens_out=tokens_out,
            latency_ms=elapsed_ms,
            interrupted=False,
        )
