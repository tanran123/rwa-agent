"""数据确认追问。研判结果 + 对话 → 还要问什么，或者可以开始映射。"""

from __future__ import annotations

from typing import Any

from agent.llm.agents.capability import capability
from agent.llm.capabilities.jsonx import extract_json


def ask(payload: dict[str, Any]) -> dict:
    raw = capability("cap-clarify", "measure-clarify", timeout=90).ask(payload)
    return extract_json(raw)
