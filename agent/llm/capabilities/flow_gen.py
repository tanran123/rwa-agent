"""按产品字段生成分类流程，并标出缺的字段。"""

from __future__ import annotations

from agent.llm.agents.capability import capability
from agent.llm.capabilities.jsonx import extract_json


def generate(payload: dict) -> dict:
    """payload 由调用方按技能要求的形状组装（product / product_fields / base_flow）。"""
    raw = capability("cap-flow-gen", "measure-flow", timeout=120).ask(payload)
    return extract_json(raw)
