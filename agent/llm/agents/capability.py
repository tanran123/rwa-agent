"""One DeepAgents graph per model capability.

Each capability owns exactly one skill file (its system prompt) and receives
one JSON payload as the user message. No tools, no persistence: the graph is
built once, reused for every call, and returns the assistant text.
"""

from __future__ import annotations

import json
from typing import Any

from deepagents import create_deep_agent

from agent.llm.client import MAPPING, chat_model
from agent.llm.skills import skill_body

_REGISTRY: dict[tuple[str, str, str], "Capability"] = {}


def _text_of(message: Any) -> str:
    content = getattr(message, "content", message)
    if isinstance(content, list):
        content = "".join(
            str(part.get("text") or "") if isinstance(part, dict) else str(part)
            for part in content
        )
    return str(content or "").strip()


class Capability:
    """A named DeepAgents graph bound to one skill file."""

    def __init__(self, name: str, skill: str, role: str = MAPPING, timeout: float = 120) -> None:
        self.name = name
        self.skill = skill
        self.role = role
        self.timeout = timeout
        self._graph = None

    def _build(self):
        return create_deep_agent(
            model=chat_model(self.role, timeout=self.timeout),
            tools=[],
            system_prompt=skill_body(self.skill),
            name=self.name,
            checkpointer=False,
        )

    def ask(self, payload: dict[str, Any]) -> str:
        return self.ask_text(json.dumps(payload, ensure_ascii=False))

    def ask_text(self, text: str) -> str:
        if self._graph is None:
            self._graph = self._build()
        state = self._graph.invoke({"messages": [{"role": "user", "content": text}]})
        messages = state.get("messages") if isinstance(state, dict) else None
        if not messages:
            raise RuntimeError("模型没有返回内容")
        for message in reversed(messages):
            if getattr(message, "type", "") in ("ai", "assistant"):
                text = _text_of(message)
                if text:
                    return text
        text = _text_of(messages[-1])
        if not text:
            raise RuntimeError("模型没有返回内容")
        return text


def capability(name: str, skill: str, role: str = MAPPING, timeout: float = 120) -> Capability:
    """Return the shared capability graph, building it on first use."""
    key = (name, skill, role)
    found = _REGISTRY.get(key)
    if found is None:
        found = Capability(name, skill, role, timeout)
        _REGISTRY[key] = found
    return found
