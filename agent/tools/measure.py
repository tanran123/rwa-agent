"""Product identification and standard-field mapping. The wizard calls the same functions."""

from __future__ import annotations

import json

from langchain_core.tools import tool


def _as_list(value) -> list:
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except (ValueError, TypeError):
            return []
    return value if isinstance(value, list) else []


def _as_dict(value) -> dict:
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except (ValueError, TypeError):
            return {}
    return value if isinstance(value, dict) else {}


@tool
def identify_products(groups: list, products: list) -> str:
    """用户要识别产品类型时调用。groups 是按产品代码分组的抽样，products 是已配置产品。没有这些材料不要调用，也不要编造产品 code。"""
    from agent.subagents.weight.calc.model import suggest_product_types

    grouped = _as_list(groups)
    catalog = _as_list(products)
    if not grouped or not catalog:
        return "没有产品分组或已配置产品，没有识别。"
    try:
        found = suggest_product_types(grouped, catalog)
    except Exception as exc:
        return str(exc)[-500:]
    return json.dumps(found, ensure_ascii=False)


@tool
def map_fields(headers: list, fields: list, samples: list | None = None, column_values: dict | None = None) -> str:
    """用户要做字段映射时调用。headers 是表头，fields 是还没对上的标准字段。没有表头或字段不要调用，也不要编造表头。"""
    from agent.subagents.weight.calc.model import suggest_standard_fields

    names = _as_list(headers)
    pending = _as_list(fields)
    if not names or not pending:
        return "没有表头或标准字段，没有映射。"
    try:
        found = suggest_standard_fields(names, pending, _as_list(samples), _as_dict(column_values))
    except Exception as exc:
        return str(exc)[-500:]
    return json.dumps(found, ensure_ascii=False)
