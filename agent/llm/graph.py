"""Coordinator graph entry point.

``app.py`` and ``langgraph.json`` use ``agent`` and ``reply`` from here.
The graph itself is built in ``agent.llm.agents.chat``.
"""

from __future__ import annotations

from agent.llm.client import active_settings
from agent.llm.settings import Settings
from agent.llm.session.client import reply
from agent.storage import checkpointer, store

__all__ = ["agent", "graph", "reply"]

_GRAPHS: dict[Settings, object] = {}
_MAX_GRAPHS = 8


def agent():
    """Return a compiled coordinator graph using the active model config."""
    from agent.llm.agents.chat import build_chat_agent

    return build_chat_agent()


def _agent_for(current: Settings):
    from agent.llm.agents.chat import build_chat_agent

    return build_chat_agent(current)


def graph():
    """Return the coordinator for the account model active in this request."""
    current = active_settings()
    compiled = _GRAPHS.get(current)
    if compiled is None:
        compiled = _agent_for(current)
        if len(_GRAPHS) >= _MAX_GRAPHS:
            _GRAPHS.clear()
        _GRAPHS[current] = compiled
    return compiled


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
