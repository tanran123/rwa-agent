"""The only model factory. Chat, mapping and tree use this module."""

from __future__ import annotations

import uuid
from contextlib import contextmanager
from contextvars import ContextVar
from typing import Iterator
from urllib.parse import urlsplit

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI

from agent.llm.settings import Settings, from_llm_config, settings

CHAT = "chat"
MAPPING = "mapping"

_ACTIVE: ContextVar[Settings | None] = ContextVar("rwa_llm_settings", default=None)

# OpenCode Zen 网关要求带会话头，缺了会返回 400 MissingSessionID。
_OPENCODE_SESSION = "rwa-" + uuid.uuid4().hex


def _default_headers(base_url: str) -> dict:
    host = urlsplit(base_url or "").hostname or ""
    if host.endswith("opencode.ai"):
        return {"x-opencode-session": _OPENCODE_SESSION}
    return {}


@contextmanager
def use_llm_config(config: dict | None) -> Iterator[Settings | None]:
    """Use the account's Koa ``llm_config`` for model calls in this request."""
    current = from_llm_config(config) if isinstance(config, dict) and config else None
    token = _ACTIVE.set(current)
    try:
        yield current
    finally:
        _ACTIVE.reset(token)


def active_settings() -> Settings:
    return _ACTIVE.get() or settings()


def chat_model(role: str = CHAT, timeout: float | None = None, override: Settings | None = None) -> ChatOpenAI:
    """Build a ChatOpenAI client for ``role``.

    Any OpenAI-compatible endpoint works. ``chat`` uses ``MODEL_NAME`` and falls
    back to ``agent/agent.json``'s ``runtime.model``; ``mapping`` uses
    ``MAPPING_MODEL`` and falls back to the chat model. The active request
    config (``use_llm_config``) wins over the environment.
    """
    current = override or active_settings()
    name = current.chat_model if role == CHAT else current.mapping_model
    kwargs = {
        "model": name,
        "api_key": current.api_key,
        "base_url": current.base_url,
        "temperature": current.temperature,
    }
    if current.max_tokens:
        kwargs["max_tokens"] = current.max_tokens
    headers = _default_headers(current.base_url)
    if headers:
        kwargs["default_headers"] = headers
    wait = timeout if timeout is not None else current.timeout
    if wait is not None:
        kwargs["timeout"] = wait
    return ChatOpenAI(**kwargs)


def complete(system: str, user: str, timeout: float = 90, role: str = MAPPING) -> str:
    """One system + one user message, plain text back.

    Kept for callers that do not need an agent loop. New LLM capabilities
    should use ``agent.llm.agents.capability`` instead.
    """
    client = chat_model(role, timeout=timeout)
    try:
        reply = client.invoke([SystemMessage(content=system), HumanMessage(content=user)])
    except Exception as exc:  # noqa: BLE001 - translate provider errors once
        raise RuntimeError(f"模型请求失败：{exc}") from exc
    content = getattr(reply, "content", reply)
    if isinstance(content, list):
        content = "".join(
            str(part.get("text") or "") if isinstance(part, dict) else str(part)
            for part in content
        )
    text = str(content or "").strip()
    if not text:
        raise RuntimeError("模型没有返回内容")
    return text
