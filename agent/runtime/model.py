"""The only model factory. Chat, mapping and tree use this module."""

from __future__ import annotations

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI

from .settings import settings

CHAT = "chat"
MAPPING = "mapping"


def chat_model(role: str = CHAT, timeout: float | None = None) -> ChatOpenAI:
    """Build a ChatOpenAI client for ``role``.

    ``chat`` reads ``agent/agent.json``'s ``runtime.model``; ``mapping`` reads
    ``MODEL_NAME`` (default ``qwen-plus``). Both share the same key and base url.
    """
    current = settings()
    name = current.chat_model if role == CHAT else current.mapping_model
    kwargs = {
        "model": name,
        "api_key": current.api_key,
        "base_url": current.base_url,
        "temperature": 0,
    }
    if timeout is not None:
        kwargs["timeout"] = timeout
    return ChatOpenAI(**kwargs)


def complete(system: str, user: str, timeout: float = 90, role: str = MAPPING) -> str:
    """One system + one user message, plain text back.

    Kept compatible with the old urllib clients: failures raise ``RuntimeError``
    with a Chinese prefix, and the return value is the raw assistant text.
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
