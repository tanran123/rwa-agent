"""Deterministic calculation workflow (LangGraph state machine, no model).

Nodes follow the regulatory order. Only names in ``registry.ENABLED`` are
entered. This is not the coordinator graph; that one lives in ``agent.llm``.
"""

from __future__ import annotations

from langgraph.graph import END, START, StateGraph

from agent.core.pipeline.state import PipelineState

_GRAPH = None


def calculation():
    global _GRAPH
    if _GRAPH is not None:
        return _GRAPH

    from agent.core.pipeline.nodes import make_node
    from agent.core.pipeline.registry import active_names, steps
    from agent.storage import checkpointer

    items = steps()
    names = [item.name for item in items]
    builder = StateGraph(PipelineState)
    for item in items:
        builder.add_node(item.name, make_node(item))

    def enter(state: PipelineState):
        if state.get("stopped"):
            return END
        active = active_names()
        for name in names:
            if name in active:
                return name
        return END

    def after(name: str):
        def route(state: PipelineState):
            if state.get("stopped"):
                return END
            active = active_names()
            index = names.index(name)
            for nxt in names[index + 1 :]:
                if nxt in active:
                    return nxt
            return END

        return route

    targets = [*names, END]
    builder.add_conditional_edges(START, enter, targets)
    for name in names:
        builder.add_conditional_edges(name, after(name), targets)

    _GRAPH = builder.compile(checkpointer=checkpointer)
    return _GRAPH
