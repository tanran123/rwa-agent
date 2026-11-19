"""LCR 标准字段识别建议：原始列 + 产品字段 + 字典 → 一对一匹配建议。"""

from __future__ import annotations

from agent.llm.agents.capability import capability
from agent.llm.capabilities.jsonx import extract_json

_TASK = (
    "这是一个 LCR 流动性监管计量任务的数据集。请把 Excel 原始列匹配到已确认产品的标准字段。"
    "只输出建议，不要确认，不要编造字段或原始列。一个原始列最多对应一个标准字段。"
)


def _clean_fields(fields: list[dict]) -> list[dict]:
    out = []
    for field in fields or []:
        if not isinstance(field, dict):
            continue
        code = str(field.get("code") or "").strip()
        if not code:
            continue
        out.append({
            "code": code,
            "name": str(field.get("name") or ""),
            "data_type": str(field.get("dataType") or field.get("data_type") or ""),
            "business_type": str(field.get("businessType") or field.get("business_type") or ""),
            "unit": str(field.get("unit") or ""),
            "required": bool(field.get("required") or field.get("requiredByRule")),
            "dictionary": str(field.get("dictionary") or ""),
            "aliases": [str(item) for item in (field.get("aliases") or []) if str(item).strip()][:10],
        })
    return out


def suggest_fields(dataset: dict, product: dict, dictionaries: list[dict] | None = None) -> dict:
    headers = [str(item) for item in (dataset.get("headers") or []) if str(item).strip()]
    fields = _clean_fields(product.get("fields") or [])
    if not headers or not fields:
        return {"mapping": {header: {"field_code": "", "confidence": 0, "reason": "没有可匹配字段"} for header in headers}}
    allowed_fields = {item["code"] for item in fields}
    payload = {
        "task": _TASK,
        "dataset": {
            "sheet": str(dataset.get("sheet") or dataset.get("sheet_name") or ""),
            "headers": headers,
            "sample": (dataset.get("sample") or dataset.get("sample_rows") or [])[:10],
            "profile": dataset.get("profile") or {},
        },
        "product": {
            "code": str(product.get("code") or ""),
            "name": str(product.get("name") or ""),
            "fields": fields[:120],
        },
        "dictionaries": (dictionaries or [])[:20],
    }
    raw = capability("cap-liquidity-field", "liquidity-standard-field-matcher", timeout=120).ask(payload)
    parsed = extract_json(raw)
    incoming = parsed.get("mapping") if isinstance(parsed.get("mapping"), dict) else {}
    used = set()
    mapping = {}
    for header in headers:
        slot = incoming.get(header) if isinstance(incoming, dict) else None
        field_code = ""
        confidence = 0
        reason = "模型没有给出这一列"
        if isinstance(slot, dict):
            field_code = str(slot.get("field_code") or slot.get("field") or "").strip()
            try:
                confidence = int(float(slot.get("confidence") or 0))
            except (TypeError, ValueError):
                confidence = 0
            reason = str(slot.get("reason") or "")[:200]
        elif isinstance(slot, str):
            field_code = slot.strip()
        if field_code not in allowed_fields or field_code in used:
            field_code = ""
            confidence = 0
            reason = reason or "没有匹配到可用标准字段"
        if field_code:
            used.add(field_code)
            confidence = max(0, min(100, confidence))
        mapping[header] = {
            "field_code": field_code,
            "confidence": confidence,
            "reason": reason,
        }
    return {"mapping": mapping}
