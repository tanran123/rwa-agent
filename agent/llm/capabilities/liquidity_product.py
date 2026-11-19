"""LCR 产品识别策略：数据集特征 + 产品目录 → 可批量执行的识别规则。"""

from __future__ import annotations

from agent.llm.agents.capability import capability
from agent.llm.capabilities.jsonx import extract_json

_TASK = (
    "这是一个 LCR 流动性监管计量任务的数据集。请根据表头、抽样和数据特征，"
    "生成一套批量产品识别策略。产品只能从给定产品目录中选择，条件只能引用给定表头。"
    "不要逐条输出记录结果，只输出策略。"
)

OPS = {
    "eq", "neq", "in", "not_in", "contains", "not_contains",
    "gt", "gte", "lt", "lte", "between", "exists", "is_null",
}


def _clean_products(products: list[dict]) -> list[dict]:
    out = []
    for item in products or []:
        if not isinstance(item, dict):
            continue
        code = str(item.get("code") or "").strip()
        if not code:
            continue
        fields = []
        for field in item.get("fields") or []:
            if not isinstance(field, dict):
                continue
            field_code = str(field.get("code") or "").strip()
            if not field_code:
                continue
            fields.append({
                "code": field_code,
                "name": str(field.get("name") or ""),
                "data_type": str(field.get("dataType") or field.get("data_type") or ""),
                "required": bool(field.get("required") or field.get("requiredByRule")),
                "dictionary": str(field.get("dictionary") or ""),
            })
        out.append({
            "code": code,
            "name": str(item.get("name") or ""),
            "category": str(item.get("category") or ""),
            "side": str(item.get("side") or ""),
            "description": str(item.get("description") or ""),
            "fields": fields[:80],
        })
    return out


def suggest_strategy(dataset: dict, products: list[dict]) -> dict:
    headers = [str(item) for item in (dataset.get("headers") or []) if str(item).strip()]
    clean = _clean_products(products)
    if not headers or not clean:
        return {"summary": "", "rules": [], "fallback_product_code": ""}
    allowed_products = {item["code"] for item in clean}
    allowed_columns = set(headers)
    payload = {
        "task": _TASK,
        "dataset": {
            "sheet": str(dataset.get("sheet") or dataset.get("sheet_name") or ""),
            "headers": headers,
            "sample": (dataset.get("sample") or dataset.get("sample_rows") or [])[:10],
            "profile": dataset.get("profile") or {},
        },
        "products": clean,
    }
    raw = capability("cap-liquidity-product", "liquidity-product-identifier", timeout=120).ask(payload)
    parsed = extract_json(raw)
    rules = []
    for rule in parsed.get("rules") or []:
        if not isinstance(rule, dict):
            continue
        product_code = str(rule.get("product_code") or "").strip()
        if product_code not in allowed_products:
            continue
        conditions = []
        for condition in rule.get("conditions") or []:
            if not isinstance(condition, dict):
                continue
            column = str(condition.get("source_column") or "").strip()
            op = str(condition.get("op") or "").strip()
            if column not in allowed_columns or op not in OPS:
                continue
            item = {"source_column": column, "op": op}
            if op not in {"exists", "is_null"}:
                value = condition.get("value")
                if value is None or value == "":
                    continue
                item["value"] = value
            conditions.append(item)
        if not conditions:
            continue
        rules.append({
            "product_code": product_code,
            "priority": int(rule.get("priority") or 0),
            "conditions": conditions,
            "reason": str(rule.get("reason") or "")[:200],
        })
    rules.sort(key=lambda item: item["priority"], reverse=True)
    fallback = str(parsed.get("fallback_product_code") or "").strip()
    if fallback not in allowed_products:
        fallback = ""
    return {
        "summary": str(parsed.get("summary") or "")[:300],
        "rules": rules,
        "fallback_product_code": fallback,
    }
