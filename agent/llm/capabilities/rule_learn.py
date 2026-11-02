"""从规则 Excel 学习资本规则。输入输出都是 JSON。"""

from __future__ import annotations

from agent.llm.agents.capability import capability
from agent.llm.capabilities.jsonx import extract_json


def learn(payload: dict) -> dict:
    raw = capability("cap-rule-learn", "rule-learn", timeout=120).ask(payload)
    return extract_json(raw)
