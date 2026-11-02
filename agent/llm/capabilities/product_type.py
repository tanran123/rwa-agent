"""产品类型识别。一组产品代码 → 一个已配置产品。"""

from __future__ import annotations

from agent.llm.agents.capability import capability
from agent.llm.capabilities.jsonx import extract_json

_TASK = (
    "这些债项明细用来做信用风险 RWA（风险加权资产）：先认出产品，再归类风险暴露、"
    "计算敞口并乘风险权重。请为每一组产品代码选择一个已配置产品。"
)


def _clean_products(products: list[dict]) -> list[dict]:
    return [
        {
            "code": str(item.get("code")).strip(),
            "label": str(item.get("label") or ""),
            "description": str(item.get("description") or ""),
        }
        for item in products
        if isinstance(item, dict) and str(item.get("code") or "").strip()
    ]


def suggest(groups: list[dict], products: list[dict]) -> dict:
    """每一组产品代码都交给模型，产品只能从已配置清单里选。"""
    clean_products = _clean_products(products)
    clean_groups = [item for item in groups if isinstance(item, dict)]
    if not clean_products or not clean_groups:
        return {"mapping": {}}
    allowed = {item["code"] for item in clean_products}
    payload = {"task": _TASK, "products": clean_products, "groups": clean_groups}
    raw = capability("cap-product-type", "measure-product", timeout=120).ask(payload)
    parsed = extract_json(raw)
    incoming = parsed.get("mapping") if isinstance(parsed.get("mapping"), dict) else {}
    found: dict[str, dict] = {}
    for group in clean_groups:
        gid = str(group.get("id") or "")
        slot = incoming.get(gid) if isinstance(incoming, dict) else None
        product = ""
        reason = ""
        if isinstance(slot, dict):
            product = str(slot.get("product") or "").strip()
            reason = str(slot.get("reason") or "").strip()[:80]
        elif isinstance(slot, str):
            product = slot.strip()
        if product in allowed:
            found[gid] = {"product": product, "reason": reason or "模型识别为该产品"}
        else:
            found[gid] = {"product": "", "reason": reason or "模型没有对上已配置产品"}
    return {"mapping": found}
