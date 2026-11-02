"""规则树停住时的开放权重。只在规则给出的选项里选，不写权重百分比。"""

from __future__ import annotations

from agent.llm.agents.capability import capability
from agent.llm.capabilities.jsonx import extract_json


def choose(cases: list[dict]) -> dict:
    raw = capability("cap-open-weight", "measure-open-weight", timeout=120).ask({"cases": cases})
    return extract_json(raw)
