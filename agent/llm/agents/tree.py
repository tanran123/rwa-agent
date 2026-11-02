"""决策树起草。一次调用：对话 + 当前规则 → 草稿或追问。"""

from __future__ import annotations

from agent.llm.agents.capability import capability
from agent.llm.client import CHAT


def propose(prompt: str) -> str:
    return capability("decision-tree", "decision-tree", role=CHAT, timeout=120).ask_text(prompt)
