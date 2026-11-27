"""Prompt-and-wait baseline chat service (control condition).

Uses the EXACT SAME LLMClient, SHARED_SYSTEM_PROMPT, generation parameters,
and SHARED_TOOLS as Co-Plan. Only the interaction model differs: conventional
turn-based chat with full non-streaming responses.
"""

from __future__ import annotations

import time
import uuid

from backend.shared.db import Database
from backend.shared.llm_client import LLMClient
from backend.shared.prompts import (
    SHARED_SYSTEM_PROMPT,
    audit_artifact_constraints,
    build_baseline_user_prompt,
)
from backend.shared.schemas import (
    Artifact,
    BaselineChatResponse,
    BaselineHistoryResponse,
    BaselineMessage,
    ChatMessage,
    utc_now_iso,
)
from backend.shared.telemetry import TelemetryLogger


class BaselineSessionNotFoundError(KeyError):
    """Raised when a baseline chat session does not exist."""


class BaselineConditionMismatchError(ValueError):
    """Raised if /chat/{session_id} is called on a non-baseline session."""


class BaselineChatService:
    """Handles conventional prompt-and-wait chat turns for the control condition."""

    def __init__(
        self,
        *,
        db: Database,
        llm_client: LLMClient,
        telemetry: TelemetryLogger,
    ) -> None:
        self.db = db
        self.llm_client = llm_client
        self.telemetry = telemetry

    async def send_message(
        self,
        session_id: str,
        user_text: str,
    ) -> BaselineChatResponse:
        row = self.db.get_session_row(session_id)
        if row is None:
            raise BaselineSessionNotFoundError(f"Session '{session_id}' not found.")
        state = self.db.get_session_state(session_id)
        assert state is not None
        if state.condition != "baseline":
            raise BaselineConditionMismatchError(
                f"Session '{session_id}' has condition '{state.condition}', expected 'baseline'."
            )

        existing = self.db.list_baseline_messages(session_id)
        cleaned_text = user_text.strip()
        if not cleaned_text:
            raise ValueError("Chat message must not be empty.")

        user_turn_index = len(existing) + 1
        user_msg = BaselineMessage(
            message_id=f"msg_{uuid.uuid4().hex[:10]}",
            session_id=session_id,
            turn_index=user_turn_index,
            role="user",
            content=cleaned_text,
            created_at=utc_now_iso(),
        )
        self.db.insert_baseline_message(user_msg)
        self.telemetry.record(
            session_id=session_id,
            participant_id=state.participant_id,
            condition="baseline",
            task_id=state.task_id,
            actor="user",
            event_type="baseline_user_message",
            payload={
                "turn_index": user_turn_index,
                "char_count": len(user_msg.content),
            },
            autonomy_level=state.autonomy_level,
        )

        # Detect mid-task requirement change turn (turn 2+ or explicit requirement phrasing)
        req_lower = cleaned_text.lower()
        is_requirement_turn = user_turn_index >= 3 or any(
            kw in req_lower
            for kw in (
                "mid-task",
                "requirement",
                "directive",
                "compliance update",
                "budget is cut",
                "cfo request",
                "executive pivot",
                "sponsor update",
            )
        )
        t_req_start = time.perf_counter()
        if is_requirement_turn:
            self.telemetry.record(
                session_id=session_id,
                participant_id=state.participant_id,
                condition="baseline",
                task_id=state.task_id,
                actor="user",
                event_type="requirement_change_sent",
                payload={"turn_index": user_turn_index, "requirement": cleaned_text[:300]},
                autonomy_level=state.autonomy_level,
            )

        # Build conversation history using the exact same shared system prompt
        chat_history: list[ChatMessage] = []
        for idx, msg in enumerate(existing):
            if idx == 0 and msg.role == "user":
                chat_history.append(
                    ChatMessage(
                        role="user",
                        content=build_baseline_user_prompt(
                            row["task_prompt"],
                            msg.content,
                            state.requirements,
                        ),
                    )
                )
            else:
                chat_history.append(ChatMessage(role=msg.role, content=msg.content))

        current_user_content = (
            build_baseline_user_prompt(
                row["task_prompt"],
                user_msg.content,
                state.requirements,
            )
            if not existing
            else user_msg.content
        )
        chat_history.append(ChatMessage(role="user", content=current_user_content))

        # Non-streaming full completion (prompt-and-wait)
        llm_resp = await self.llm_client.complete(
            messages=chat_history,
            system_prompt=SHARED_SYSTEM_PROMPT,
            json_mode=False,
        )

        assistant_turn_index = user_turn_index + 1
        assistant_msg = BaselineMessage(
            message_id=f"msg_{uuid.uuid4().hex[:10]}",
            session_id=session_id,
            turn_index=assistant_turn_index,
            role="assistant",
            content=llm_resp.content,
            latency_ms=llm_resp.latency_ms,
            tokens_in=llm_resp.tokens_in,
            tokens_out=llm_resp.tokens_out,
            created_at=utc_now_iso(),
        )
        self.db.insert_baseline_message(assistant_msg)

        # Run shared audit tool identically for telemetry comparability
        audit = audit_artifact_constraints(llm_resp.content, state.requirements)

        updated_artifact = Artifact(
            artifact_id=state.artifact.artifact_id,
            version=state.artifact.version + 1,
            content=llm_resp.content,
            last_editor="agent",
        )
        self.db.upsert_session(
            session_id=state.session_id,
            task_id=state.task_id,
            participant_id=state.participant_id,
            condition="baseline",
            status="running",
            adaptive_state=state.adaptive_state,
            plan=state.plan,
            artifact=updated_artifact,
            step_outputs=state.step_outputs,
            requirements=state.requirements,
            active_instruction=state.active_instruction,
            task_prompt=row["task_prompt"],
            seq=state.seq + 1,
            created_at=state.created_at,
        )

        self.telemetry.record(
            session_id=session_id,
            participant_id=state.participant_id,
            condition="baseline",
            task_id=state.task_id,
            actor="agent",
            event_type="baseline_assistant_response",
            payload={
                "turn_index": assistant_turn_index,
                "artifact_version": updated_artifact.version,
                "word_count": audit.word_count,
                "coverage_score": audit.coverage_score,
            },
            latency_ms=llm_resp.latency_ms,
            tokens_in=llm_resp.tokens_in,
            tokens_out=llm_resp.tokens_out,
            autonomy_level=state.autonomy_level,
        )

        if is_requirement_turn:
            recovery_ms = round((time.perf_counter() - t_req_start) * 1000.0, 2)
            self.telemetry.record(
                session_id=session_id,
                participant_id=state.participant_id,
                condition="baseline",
                task_id=state.task_id,
                actor="agent",
                event_type="first_useful_response",
                payload={
                    "trigger": "baseline_assistant_response",
                    "turn_index": assistant_turn_index,
                    "artifact_version": updated_artifact.version,
                },
                latency_ms=recovery_ms,
                tokens_in=llm_resp.tokens_in,
                tokens_out=llm_resp.tokens_out,
                autonomy_level=state.autonomy_level,
            )

        return BaselineChatResponse(
            session_id=session_id,
            message_id=assistant_msg.message_id,
            role="assistant",
            content=assistant_msg.content,
            turn_index=assistant_turn_index,
            latency_ms=llm_resp.latency_ms,
            tokens_in=llm_resp.tokens_in,
            tokens_out=llm_resp.tokens_out,
            artifact=updated_artifact,
        )

    def get_history(self, session_id: str) -> BaselineHistoryResponse:
        state = self.db.get_session_state(session_id)
        if state is None:
            raise BaselineSessionNotFoundError(f"Session '{session_id}' not found.")
        messages = self.db.list_baseline_messages(session_id)
        return BaselineHistoryResponse(
            session_id=session_id,
            messages=messages,
            artifact=state.artifact,
        )
