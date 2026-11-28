"""LangGraph workflow for product-group configuration.

The graph is deliberately deterministic. Deep Agent capabilities are invoked
inside nodes; the graph owns routing, state and approval boundaries.
"""

from __future__ import annotations

from typing import Any

from langgraph.graph import END, START, StateGraph

from agent.llm.workflows.group_config import nodes
from agent.llm.workflows.group_config.state import GroupConfigState
from agent.storage import checkpointer

_GRAPH = None


def build_group_config_graph():
    global _GRAPH
    if _GRAPH is not None:
        return _GRAPH
    graph = StateGraph(GroupConfigState)
    graph.add_node("prepare", nodes.prepare)
    graph.add_node("classify", nodes.classify)
    graph.add_node("plan", nodes.plan)
    graph.add_node("answer", nodes.answer)
    graph.add_node("propose", nodes.propose)
    graph.add_node("refine", nodes.refine)
    graph.add_node("composite", nodes.composite)
    graph.add_node("merge", nodes.merge)
    graph.add_node("review", nodes.review)
    graph.add_node("finalize", nodes.finalize)

    graph.add_edge(START, "prepare")
    graph.add_edge("prepare", "classify")
    graph.add_edge("classify", "plan")
    graph.add_conditional_edges("plan", _route, {
        "answer": "answer",
        "review": "review",
        "propose": "propose",
        "refine": "refine",
        "composite": "composite",
    })
    graph.add_edge("answer", "finalize")
    graph.add_edge("review", "finalize")
    graph.add_edge("propose", "merge")
    graph.add_edge("refine", "merge")
    graph.add_edge("composite", "merge")
    graph.add_edge("merge", "review")
    graph.add_edge("review", "finalize")
    graph.add_edge("finalize", END)
    _GRAPH = graph.compile(checkpointer=checkpointer)
    return _GRAPH


def _route(state: GroupConfigState) -> str:
    intent = state.get("intent") or {}
    kind = str(intent.get("type") or "answer")
    tasks = state.get("tasks") or intent.get("tasks") or []
    if kind == "composite":
        types = {str(item.get("type") or "") for item in tasks if isinstance(item, dict)}
        if not any(item in types for item in ("propose", "refine", "local_refine", "global_refine")):
            return "review"
        return "composite"
    if kind in ("local_refine", "global_refine"):
        return "refine"
    if kind == "propose":
        return "propose"
    if kind == "review":
        return "review"
    return "answer"


def _config(payload: dict) -> dict:
    thread_id = str(payload.get("threadId") or "product-group")
    run_id = str(payload.get("runId") or "")
    # 每次运行使用独立 checkpoint 线程，避免上一轮 proposal/finding 混入；
    # run_id 在人工确认 resume 时复用，因此可以恢复同一执行。
    if run_id:
        thread_id = thread_id + ":" + run_id
    return {"configurable": {"thread_id": thread_id}, "recursion_limit": 30}


def _initial(payload: dict) -> dict:
    return {
        "payload": payload,
        "text": str(payload.get("text") or ""),
        "thread_id": str(payload.get("threadId") or ""),
        "run_id": str(payload.get("runId") or ""),
        "proposal_id": str(payload.get("proposalId") or ""),
        "draft_digest": str(payload.get("draftDigest") or ""),
        "approval_status": str(payload.get("approvalStatus") or ""),
    }


def run_group_workflow(payload: dict) -> dict:
    graph = build_group_config_graph()
    state = graph.invoke(_initial(payload), _config(payload))
    return state.get("result") or {"status": "completed", "message": ""}


def stream_group_workflow(payload: dict):
    graph = build_group_config_graph()
    config = _config(payload)
    last_status = ""
    last_intent = None
    last_plan = None
    final_state: dict[str, Any] = {}
    try:
        # custom 模式承载节点内部的模型流式输出（token/decision/…），
        # values 模式只用来判断阶段变化。
        for item in graph.stream(_initial(payload), config, stream_mode=["values", "custom"]):
            mode, chunk = item if isinstance(item, tuple) and len(item) == 2 else ("values", item)
            if mode == "custom":
                if isinstance(chunk, dict) and chunk.get("event"):
                    yield chunk
                continue
            if not isinstance(chunk, dict):
                continue
            final_state = chunk
            status = str(final_state.get("status") or "")
            if status and status != last_status:
                last_status = status
                yield {"event": "status", "data": {"stage": status, "message": _status_text(status), "total": len((payload.get("targetFields") or []))}}
            intent = final_state.get("intent")
            if intent and intent != last_intent:
                last_intent = intent
                yield {"event": "intent", "data": {"intent": intent}}
            plan = final_state.get("plan")
            if plan and plan != last_plan:
                last_plan = plan
                yield {"event": "plan", "data": {"plan": plan}}
        result = final_state.get("result") or {}
        for finding in (result.get("reviewFindings") or []):
            yield {"event": "review", "data": {"finding": finding}}
        if result.get("diff"):
            yield {"event": "diff", "data": {"diff": result["diff"]}}
        if result.get("proposal"):
            yield {"event": "proposal", "data": {"proposal": result["proposal"], "selection": result.get("selection")}}
        for conflict in (result.get("conflicts") or []):
            yield {"event": "conflict", "data": {"conflict": conflict}}
        if result.get("requiresApproval"):
            yield {"event": "approval_required", "data": {"conflicts": result.get("conflicts") or []}}
        # 回答正文已经在 answer 节点里逐段发出，这里不再重复整段。
        yield {"event": "result", "data": result}
    except Exception as exc:  # noqa: BLE001
        yield {"event": "error", "data": {"error": str(exc) or "分组智能配置失败"}}


def _status_text(status: str) -> str:
    return {
        "preparing": "正在读取分组上下文",
        "intent_ready": "正在理解任务",
        "planned": "正在规划执行步骤",
        "answered": "正在整理回答",
        "proposed": "正在生成字段决策",
        "refined": "正在应用调整意见",
        "composite_ready": "正在执行复合任务",
        "merged": "正在合并用户决策",
        "reviewed": "正在检查配置质量",
        "completed": "已完成",
        "awaiting_approval": "等待人工确认",
    }.get(status, status or "处理中")
