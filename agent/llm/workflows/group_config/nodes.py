"""LangGraph nodes for the product-group configuration workflow."""

from __future__ import annotations

import json
from typing import Any, Callable

from langgraph.config import get_stream_writer

from agent.core.product_group.intent import classify_intent
from agent.core.product_group.proposal import merge_proposal
from agent.core.product_group.review import review_proposal
from agent.core.product_group.revision import digest_payload
from agent.llm.agents.capability import capability
from agent.llm.capabilities.jsonx import extract_json
from agent.llm.capabilities.product_group import answer_group_stream, assist_group_stream
from agent.llm.workflows.group_config.state import GroupConfigState


def _messages(payload: dict, text: str) -> list[dict]:
    messages = [dict(item) for item in (payload.get("messages") or []) if isinstance(item, dict)]
    if text and not any(item.get("role") == "user" and str(item.get("text") or "").strip() == text for item in messages):
        messages.append({"role": "user", "text": text})
    return messages


def _payload(state: GroupConfigState) -> dict:
    return state.get("payload") or {}


def _writer() -> Callable[[dict], None]:
    """节点内的自定义流写出器；非流式调用时是空操作。"""
    try:
        return get_stream_writer()
    except Exception:  # noqa: BLE001 - invoke() 里没有 runtime 配置
        return lambda _event: None


# 能力层事件直接转发给前端，顺序就是模型产出的顺序。
_FORWARDED = {"status", "token", "decision", "field", "mapping", "dictionary"}


def _forward(events, writer: Callable[[dict], None], on_token: Callable[[str], None] | None = None) -> dict:
    """把能力层的流式事件转给 LangGraph 自定义流，返回最终的 result 载荷。"""
    result: dict = {}
    for item in events:
        event = str(item.get("event") or "")
        data = item.get("data") if isinstance(item.get("data"), dict) else {}
        if event == "error":
            raise RuntimeError(str(data.get("error") or "分组智能配置失败"))
        if event == "result":
            result = data
            continue
        if event not in _FORWARDED:
            continue
        if event == "token" and on_token is not None:
            on_token(str(data.get("text") or ""))
            continue
        writer({"event": event, "data": data})
    return result


def _token_sink(writer: Callable[[dict], None]) -> Callable[[str], None]:
    """回答模式下逐段显示；模型若把正文包成 JSON 就先不显示，等最终结果。"""
    buffer: list[str] = []
    decided = False
    plain = True

    def write(text: str) -> None:
        nonlocal decided, plain
        if not text:
            return
        if decided:
            if plain:
                writer({"event": "token", "data": {"text": text}})
            return
        buffer.append(text)
        head = "".join(buffer).lstrip()
        if not head:
            return
        decided = True
        plain = not head.startswith("{")
        if plain:
            writer({"event": "token", "data": {"text": "".join(buffer)}})
            buffer.clear()

    return write


def _target_fields(payload: dict) -> list[dict]:
    return [item for item in (payload.get("targetFields") or []) if isinstance(item, dict)]


def prepare(state: GroupConfigState) -> dict:
    payload = _payload(state)
    text = str(payload.get("text") or "").strip()
    if not text:
        for item in reversed(payload.get("messages") or []):
            if isinstance(item, dict) and item.get("role") == "user":
                text = str(item.get("text") or "").strip()
                break
    draft_digest = str(payload.get("draftDigest") or "").strip()
    if not draft_digest:
        draft_digest = digest_payload({
            "standardFields": payload.get("draftStandardFields") or [],
            "mappings": payload.get("draftMappings") or [],
            "selection": payload.get("selection") or payload.get("currentSelections") or [],
        })
    return {
        "text": text,
        "thread_id": str(payload.get("threadId") or ""),
        "run_id": str(payload.get("runId") or ""),
        "proposal_id": str(payload.get("proposalId") or ""),
        "draft_digest": draft_digest,
        "approval_status": str(payload.get("approvalStatus") or ""),
        "status": "preparing",
    }


def _model_intent(payload: dict, text: str) -> dict | None:
    try:
        raw = capability("cap-product-group-intent", "group-config-intent", timeout=60).ask({
            "text": text,
            "targetFields": _target_fields(payload),
            "currentProposal": payload.get("currentProposal") or {},
            "messages": payload.get("messages") or [],
        })
        parsed = extract_json(raw)
        if not isinstance(parsed, dict):
            return None
        intent_type = str(parsed.get("type") or "").strip()
        if intent_type not in {"answer", "local_refine", "global_refine", "propose", "review", "composite"}:
            return None
        return {
            "type": intent_type,
            "confidence": float(parsed.get("confidence") or 0.6),
            "targets": parsed.get("targets") if isinstance(parsed.get("targets"), list) else [],
            "tasks": parsed.get("tasks") if isinstance(parsed.get("tasks"), list) else [],
            "constraints": parsed.get("constraints") if isinstance(parsed.get("constraints"), list) else [],
            "reason": str(parsed.get("reason") or ""),
            "model": True,
        }
    except Exception:
        return None


def classify(state: GroupConfigState) -> dict:
    payload = _payload(state)
    text = state.get("text") or ""
    intent = classify_intent(text, _target_fields(payload))
    if intent.get("type") == "auto":
        model_intent = _model_intent(payload, text)
        if model_intent:
            intent = model_intent
        elif payload.get("currentProposal"):
            intent = {"type": "local_refine", "confidence": 0.5, "targets": intent.get("targets") or [], "tasks": [{"type": "local_refine"}], "constraints": intent.get("constraints") or []}
        else:
            intent = {"type": "answer", "confidence": 0.5, "targets": [], "tasks": [{"type": "answer"}], "constraints": []}
    constraints = list(intent.get("constraints") or [])
    for item in payload.get("constraints") or []:
        if item not in constraints:
            constraints.append(item)
    return {"intent": intent, "constraints": constraints, "status": "intent_ready"}


def plan(state: GroupConfigState) -> dict:
    intent = state.get("intent") or {}
    tasks = [item for item in (intent.get("tasks") or []) if isinstance(item, dict)]
    if not tasks:
        if intent.get("type") == "composite":
            tasks = [{"type": "local_refine"}, {"type": "review", "scope": "group"}]
        else:
            tasks = [{"type": intent.get("type") or "answer"}]
    return {"plan": tasks, "tasks": tasks, "status": "planned"}


def answer(state: GroupConfigState) -> dict:
    payload = _payload(state)
    writer = _writer()
    result = _forward(
        answer_group_stream({**payload, "action": "answer", "messages": _messages(payload, state.get("text") or "")}),
        writer,
        on_token=_token_sink(writer),
    )
    return {"answer_text": str(result.get("message") or ""), "status": "answered"}


def _assist(state: GroupConfigState, action: str) -> dict:
    payload = _payload(state)
    mappable = [item for item in _target_fields(payload) if not item.get("systemCalc")]
    model_payload = {
        **payload,
        "action": action,
        "targetFields": mappable,
        "group": {**(payload.get("group") or {}), "targetFields": mappable},
        "messages": _messages(payload, state.get("text") or ""),
    }
    result = _forward(assist_group_stream(model_payload), _writer())
    if not result:
        raise RuntimeError("模型没有返回分组建议")
    return result


def propose(state: GroupConfigState) -> dict:
    return {"proposed": _assist(state, "propose"), "status": "proposed"}


def refine(state: GroupConfigState) -> dict:
    return {"proposed": _assist(state, "refine"), "status": "refined"}


def composite(state: GroupConfigState) -> dict:
    tasks = state.get("tasks") or []
    types = {str(item.get("type") or "") for item in tasks}
    if "propose" in types:
        return propose(state)
    if "refine" in types or "local_refine" in types or "global_refine" in types:
        return refine(state)
    return {"status": "composite_ready"}


def merge(state: GroupConfigState) -> dict:
    payload = _payload(state)
    proposed = state.get("proposed") or {}
    previous = payload.get("previousProposal") or payload.get("currentProposal") or {}
    selection = payload.get("selection")
    if selection is None:
        selection = payload.get("currentSelections")
    merged = merge_proposal(
        previous,
        proposed,
        selection=selection,
        constraints=state.get("constraints") or [],
        edits=payload.get("edits") or [],
        approved=state.get("approval_status") == "approved",
    )
    return {
        "merged": merged.get("proposal") or proposed,
        "selection": merged.get("selection") or {},
        "diff": merged.get("diff") or {},
        "conflicts": merged.get("conflicts") or [],
        "requires_approval": bool(merged.get("requiresApproval")),
        "status": "merged",
    }


def review(state: GroupConfigState) -> dict:
    payload = _payload(state)
    proposal = state.get("merged") or state.get("proposed") or payload.get("currentProposal") or {}
    findings = review_proposal(
        proposal,
        payload,
        constraints=state.get("constraints") or [],
        draft_digest=state.get("draft_digest") or "",
        expected_digest=str(payload.get("baseDraftDigest") or ""),
    )
    return {"review_findings": findings, "status": "reviewed"}


def finalize(state: GroupConfigState) -> dict:
    payload = _payload(state)
    intent = state.get("intent") or {}
    merged = state.get("merged") or {}
    proposal = merged or state.get("proposed") or payload.get("currentProposal") or {}
    is_answer = intent.get("type") == "answer"
    result = {
        "threadId": state.get("thread_id") or "",
        "runId": state.get("run_id") or "",
        "proposalId": state.get("proposal_id") or "",
        "intent": intent.get("type") or "answer",
        "confidence": intent.get("confidence") or 0,
        "plan": state.get("plan") or [],
        "message": state.get("answer_text") or proposal.get("message") or "",
        "proposal": None if is_answer else proposal,
        "selection": None if is_answer else state.get("selection") or {},
        "diff": {} if is_answer else state.get("diff") or {},
        "reviewFindings": state.get("review_findings") or [],
        "conflicts": state.get("conflicts") or [],
        "requiresApproval": bool(state.get("requires_approval")),
        "changeSummary": {
            "decisions": len(((state.get("selection") or {}).get("decisions")) or []),
            "mappings": len(((state.get("selection") or {}).get("mappings")) or []),
            "fields": len(((state.get("selection") or {}).get("fields")) or []),
        },
        "status": "awaiting_approval" if state.get("requires_approval") else "completed",
    }
    return {"status": result["status"], "result": result}
