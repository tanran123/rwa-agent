"""Build the coordinator graph and answer a chat turn.

``RWA_CHAT_ENGINE`` selects the implementation:

- ``deepagents`` (default): ``agent.composition.chat``
- ``legacy``: the hand-rolled ``llm_call`` / ``tool_node`` loop, kept as a
  rollback path for one release.
"""

from __future__ import annotations

import os

from agent.composition.client import reply
from agent.runtime import checkpointer, store

__all__ = ["agent", "graph", "reply"]

_GRAPH = None


def _legacy_agent():
    from langgraph.graph import END, START, StateGraph
    from langgraph.types import RetryPolicy

    from agent.runtime.model import chat_model
    from agent.platform.legacy.nodes import make_nodes, model_failed
    from agent.platform.legacy.state import MessagesState

    llm_call, tool_node, should_continue = make_nodes(chat_model("chat"))
    builder = StateGraph(MessagesState)
    builder.add_node(
        "llm_call",
        llm_call,
        retry_policy=RetryPolicy(max_attempts=2),
        error_handler=model_failed,
    )
    builder.add_node("tool_node", tool_node)
    builder.add_edge(START, "llm_call")
    builder.add_conditional_edges("llm_call", should_continue, ["tool_node", END])
    builder.add_edge("tool_node", "llm_call")
    return builder.compile(checkpointer=checkpointer, store=store)


def agent():
    """Return the compiled coordinator graph."""
    engine = (os.environ.get("RWA_CHAT_ENGINE") or "deepagents").strip().lower()
    if engine == "legacy":
        return _legacy_agent()
    from agent.composition.chat import build_chat_agent

    return build_chat_agent()


def graph():
    global _GRAPH
    if _GRAPH is None:
        _GRAPH = agent()
    return _GRAPH


def thread_config(thread_id: str, checkpoint_id: str | None = None) -> dict:
    configurable = {"thread_id": thread_id}
    if checkpoint_id:
        configurable["checkpoint_id"] = checkpoint_id
    return {"configurable": configurable, "recursion_limit": 40}


def checkpoints(thread_id: str) -> list[str]:
    found = []
    for snap in graph().get_state_history(thread_config(thread_id)):
        checkpoint_id = (snap.config.get("configurable") or {}).get("checkpoint_id")
        if checkpoint_id:
            found.append(checkpoint_id)
    return found


def fork(thread_id: str, checkpoint_id: str, content: str) -> None:
    """Branch a saved turn and append one user message."""
    graph().update_state(
        thread_config(thread_id, checkpoint_id),
        {"messages": [{"role": "user", "content": content}]},
    )
