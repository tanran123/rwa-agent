"""One DeepAgents graph per model capability.

Each capability owns exactly one skill file (its system prompt) and receives
one JSON payload as the user message. No tools, no persistence: the graph is
built once, reused for every call, and returns the assistant text.
"""

from __future__ import annotations

import json
from typing import Any

from deepagents import create_deep_agent

from agent.llm.client import MAPPING, active_settings, chat_model
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
        self._graphs: dict = {}

    def _build(self, current):
        return create_deep_agent(
            model=chat_model(self.role, timeout=self.timeout, override=current),
            tools=[],
            system_prompt=skill_body(self.skill),
            name=self.name,
            checkpointer=False,
        )

    def _compiled(self, current):
        compiled = self._graphs.get(current)
        if compiled is None:
            compiled = self._build(current)
            if len(self._graphs) >= 4:
                self._graphs.clear()
            self._graphs[current] = compiled
        return compiled

    def ask(self, payload: dict[str, Any]) -> str:
        return self.ask_text(json.dumps(payload, ensure_ascii=False))

    def ask_text(self, text: str) -> str:
        current = active_settings()
        compiled = self._compiled(current)
        state = compiled.invoke({"messages": [{"role": "user", "content": text}]})
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

    def stream_text(self, text: str):
        """Yield model text chunks for one call.

        The graph is the same one used by ``ask_text``; only the transport
        changes. Tool calls are not emitted because capabilities have no tools.
        """
        current = active_settings()
        compiled = self._compiled(current)
        for chunk in compiled.stream(
            {"messages": [{"role": "user", "content": text}]},
            stream_mode="messages",
        ):
            message = chunk[0] if isinstance(chunk, tuple) else chunk
            if getattr(message, "type", "") == "tool":
                continue
            piece = _text_of(message)
            if piece:
                yield piece


def capability(name: str, skill: str, role: str = MAPPING, timeout: float = 120) -> Capability:
    """Return the shared capability graph, building it on first use."""
    key = (name, skill, role)
    found = _REGISTRY.get(key)
    if found is None:
        found = Capability(name, skill, role, timeout)
        _REGISTRY[key] = found
    return found
