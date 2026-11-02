"""知识库没有命中时的两条兜底回答。纯文本进，纯文本出。"""

from __future__ import annotations

from agent.llm.agents.capability import capability


def answer(text: str) -> str:
    """按对话直接回答最后一个问题，不声称来自知识库。"""
    return capability("cap-rule-chat", "rule-chat", timeout=90).ask_text(text)


def basis(name: str) -> str:
    """知识库没有原文时，概括这条规则通常指什么。"""
    return capability("cap-rule-basis", "rule-basis", timeout=90).ask_text(
        "规则名称是「" + str(name or "").strip()[:40] + "」。"
    )
