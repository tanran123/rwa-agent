"""Calculation workflow. Nodes follow regulatory order. Only names in STEPS are entered."""

from __future__ import annotations

from langgraph.graph import END, START, StateGraph

from agent.calculation.state import PipelineState

_GRAPH = None


def calculation():
    global _GRAPH
    if _GRAPH is not None:
        return _GRAPH

    from agent.calculation.nodes import make_node
    from agent.calculation.pipeline import active_steps
    from agent.runtime import checkpointer
    from agent.subagents import ORDER

    names = [item.NAME for item in ORDER]
    builder = StateGraph(PipelineState)
    for item in ORDER:
        builder.add_node(item.NAME, make_node(item))

    def enter(state: PipelineState):
        if state.get("stopped"):
            return END
        active = active_steps()
        for name in names:
            if name in active:
                return name
        return END

    def after(name: str):
        def route(state: PipelineState):
            if state.get("stopped"):
                return END
            active = active_steps()
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
