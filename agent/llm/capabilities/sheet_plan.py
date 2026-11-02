"""选表。工作簿的表名与前几行 → 哪些表要逐笔计算。

流水线与底稿页用两份技能，口径不同，所以技能名由调用方传入。
"""

from __future__ import annotations

from agent.llm.agents.capability import capability
from agent.llm.capabilities.jsonx import extract_json


def plan(
    outlines: list[dict],
    *,
    skill: str = "measure-sheets",
    name: str = "cap-sheet-plan",
) -> tuple[dict, str]:
    """把整本工作簿的表名和表头样例交给模型，返回解析后的计划。"""
    raw = capability(name, skill, timeout=120).ask({"sheets": outlines})
    parsed = extract_json(raw)
    return parsed, str(parsed.get("note") or "").strip()[:200]
