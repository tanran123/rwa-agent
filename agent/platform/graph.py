"""Build the coordinator graph and answer a chat turn."""

from __future__ import annotations

from langgraph.graph import END, START, StateGraph

from langgraph.types import RetryPolicy

from agent.model import model
from agent.platform.client import reply
from agent.platform.nodes import make_nodes, model_failed
from agent.platform.state import MessagesState
from agent.runtime import checkpointer, store

__all__ = ["agent", "graph", "reply"]

_GRAPH = None


def agent(config=None):
    """Return the compiled coordinator graph.

    LangGraph loads this function from langgraph.json. config is unused.
    """

    llm_call, tool_node, should_continue = make_nodes(model())

    # Step 6: Build agent

    # Build workflow
    agent_builder = StateGraph(MessagesState)

    # Add nodes
    agent_builder.add_node(
        "llm_call",
        llm_call,
        retry_policy=RetryPolicy(max_attempts=2),
        error_handler=model_failed,
    )
    agent_builder.add_node("tool_node", tool_node)

    # Add edges to connect nodes
    agent_builder.add_edge(START, "llm_call")
    agent_builder.add_conditional_edges(
        "llm_call",
        should_continue,
        ["tool_node", END]
    )
    agent_builder.add_edge("tool_node", "llm_call")

    # Compile the agent
    return agent_builder.compile(checkpointer=checkpointer, store=store)


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
