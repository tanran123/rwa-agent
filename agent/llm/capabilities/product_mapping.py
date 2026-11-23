"""产品标准字段与映射的归一化。

分组智能体（``product_group``）共用这里的字段、映射和缺失项归一化逻辑，
把模型输出收敛到页面可用的契约。本模块不调用模型、不写库。
"""

from __future__ import annotations

import json
import re
from typing import Any

_NAME = re.compile(r"^[A-Za-z][A-Za-z0-9_]*$")
_TYPES = {"string", "number", "boolean", "date", "enum", "constant"}
_INPUT_MODES = {"manual", "default"}
_MAPPING_TYPES = {"direct", "constant", "transform", "conditional", "calculation", "composite"}


def _text(value: Any, limit: int = 200) -> str:
    return str(value or "").strip()[:limit]


def _transform_view(value: Any) -> dict | None:
    """保留映射的转换规则，供页面展开和问答引用；非法结构按无转换处理。"""
    if not isinstance(value, dict):
        return None
    raw_mapping = value.get("mapping")
    code_map = None
    if isinstance(raw_mapping, dict):
        code_map = {}
        for key, item in raw_mapping.items():
            source = _text(key, 120)
            if source:
                code_map[source] = _text(item, 200)
    inputs = []
    for item in value.get("inputs") or []:
        name = _text(item, 120)
        if name and name not in inputs:
            inputs.append(name)
    return {
        "type": _text(value.get("type"), 60),
        "expression": _text(value.get("expression") or value.get("formula"), 600),
        "inputs": inputs[:30],
        "mapping": code_map,
        "onUnmappedCode": _text(value.get("on_unmapped_code") or value.get("onUnmappedCode"), 120),
        "outputUnit": _text(value.get("output_unit") or value.get("outputUnit"), 40),
    }


def _allowed_groups(payload: dict) -> set[str]:
    product = payload.get("product")
    if not isinstance(product, dict):
        product = {}
    groups = product.get("standardFieldGroups") or payload.get("standardFieldGroups") or []
    found = set()
    for group in groups:
        if isinstance(group, dict):
            code = _text(group.get("group_id") or group.get("id") or group.get("code"))
        else:
            code = _text(group)
        if code:
            found.add(code)
    return found


def _target_map(payload: dict) -> dict[str, dict]:
    found: dict[str, dict] = {}
    for field in payload.get("targetFields") or []:
        if isinstance(field, dict):
            name = _text(field.get("name"))
            if name:
                found[name] = field
    return found


def _normalize_fields(parsed: dict, payload: dict, warnings: list[str]) -> list[dict]:
    groups = _allowed_groups(payload)
    existing = {_text(item.get("name")): item for item in (payload.get("existingStandardFields") or []) if isinstance(item, dict)}
    result: list[dict] = []
    seen: set[str] = set()
    for item in parsed.get("standardFields") or []:
        if not isinstance(item, dict):
            continue
        name = _text(item.get("name"))
        if not _NAME.match(name):
            warnings.append("丢弃非法标准字段编码：" + (name or "（空）"))
            continue
        if name in seen:
            warnings.append("标准字段重复，已合并：" + name)
            continue
        seen.add(name)
        label = _text(item.get("label")) or name
        group = _text(item.get("group"))
        if groups and group not in groups:
            fallback = next((item for item in sorted(groups) if item != "RULE_OUTPUT"), sorted(groups)[0])
            warnings.append(name + " 的分组 " + (group or "（空）") + " 不在产品标准字段分组内，已归入 " + fallback)
            group = fallback
        field_type = _text(item.get("type")) or "string"
        if field_type not in _TYPES:
            warnings.append(name + " 的类型 " + field_type + " 不支持，已改为 string")
            field_type = "string"
        mode = _text(item.get("inputMode") or item.get("input_mode")) or "manual"
        if mode not in _INPUT_MODES:
            mode = "manual"
        default_value = _text(item.get("defaultValue") if item.get("defaultValue") is not None else item.get("default_value"), 400)
        if mode == "default" and not default_value:
            warnings.append(name + " 是默认值字段但没有默认值，已改为人工输入")
            mode = "manual"
        previous = existing.get(name) or {}
        result.append({
            "name": name,
            "label": label,
            "labelEn": _text(item.get("labelEn") or item.get("label_en")) or _text(previous.get("labelEn") or previous.get("label_en")),
            "group": group,
            "type": field_type,
            "inputMode": mode,
            "defaultValue": default_value,
            "required": bool(item.get("required", previous.get("required", False))),
            "dictionary": _text(item.get("dictionary") or previous.get("dictionary")),
            "enumValues": item.get("enumValues") or item.get("enum_values") or previous.get("enumValues") or previous.get("enum_values") or [],
            "description": _text(item.get("description")) or label,
            "sourceHint": _text(item.get("sourceHint") or item.get("source_hint")) or name,
            "aliases": item.get("aliases") or previous.get("aliases") or [],
            "newField": bool(item.get("newField", name not in existing)),
            "reason": _text(item.get("reason"), 300),
            "confidence": _clamp(item.get("confidence"), 0.6)
        })
    return result


def _normalize_mappings(parsed: dict, payload: dict, fields: list[dict], warnings: list[str]) -> list[dict]:
    targets = _target_map(payload)
    fields_by_name = {item["name"]: item for item in fields}
    proposal = payload.get("currentProposal")
    if not isinstance(proposal, dict):
        proposal = {}
    for field in proposal.get("standardFields") or []:
        if isinstance(field, dict) and _text(field.get("name")):
            fields_by_name.setdefault(_text(field.get("name")), {
                "name": _text(field.get("name")),
                "inputMode": _text(field.get("inputMode") or field.get("input_mode")) or "manual",
                "defaultValue": _text(field.get("defaultValue") if field.get("defaultValue") is not None else field.get("default_value"), 400)
            })
    for field in payload.get("existingStandardFields") or []:
        if isinstance(field, dict) and _text(field.get("name")):
            fields_by_name.setdefault(_text(field.get("name")), {
                "name": _text(field.get("name")),
                "inputMode": _text(field.get("inputMode") or field.get("input_mode")) or "manual",
                "defaultValue": _text(field.get("defaultValue") if field.get("defaultValue") is not None else field.get("default_value"), 400)
            })
    result: list[dict] = []
    seen: set[str] = set()
    for item in parsed.get("mappings") or []:
        if not isinstance(item, dict):
            continue
        target = _text(item.get("targetField") or item.get("target_field"))
        if not target or target not in targets:
            warnings.append("丢弃不存在的目标字段映射：" + (target or "（空）"))
            continue
        if targets[target].get("systemCalc"):
            warnings.append("目标字段 " + target + " 是系统计算字段，已跳过人工映射")
            continue
        if target in seen:
            warnings.append("目标字段重复映射，已保留第一条：" + target)
            continue
        source = _text(item.get("sourceField") or item.get("source_field"))
        if source and source not in fields_by_name:
            warnings.append("映射引用了不存在的标准字段，已跳过：" + source + " → " + target)
            continue
        mapping_type = _text(item.get("mappingType") or item.get("mapping_type")) or "direct"
        if mapping_type not in _MAPPING_TYPES:
            mapping_type = "direct"
        default_value = _text(item.get("defaultValue") if item.get("defaultValue") is not None else item.get("default_value"), 400)
        field = fields_by_name.get(source) if source else None
        if field and field.get("inputMode") == "default":
            mapping_type = "constant"
            default_value = default_value or _text(field.get("defaultValue"))
        if mapping_type == "constant" and not default_value:
            warnings.append("目标字段 " + target + " 的常量映射没有默认值，已跳过")
            continue
        # 默认值映射可以没有源字段：本产品对该目标字段就是固定常量，
        # 不需要为它单独建一个标准字段。
        if mapping_type == "constant" and source and source not in fields_by_name:
            warnings.append("目标字段 " + target + " 的默认值标准字段不存在，已跳过")
            continue
        if mapping_type != "constant" and not source:
            warnings.append("目标字段 " + target + " 的映射缺少源字段，已跳过")
            continue
        if mapping_type != "constant" and source not in fields_by_name:
            warnings.append("映射引用了不存在的标准字段，已跳过：" + source + " → " + target)
            continue
        seen.add(target)
        transform = _transform_view(item.get("transform"))
        result.append({
            "targetField": target,
            "sourceField": source,
            "mappingType": mapping_type,
            "defaultValue": default_value or None,
            "transform": transform,
            "transformType": (transform or {}).get("type", ""),
            "missingPolicy": _text(item.get("missingPolicy") or item.get("missing_policy"), 80),
            "description": _text(item.get("description"), 300),
            "regulatoryReference": _text(item.get("regulatoryReference") or item.get("regulatory_reference"), 200),
            "confidence": _clamp(item.get("confidence"), 0.6),
            "reason": _text(item.get("reason"), 300)
        })
    return result


def _missing(parsed: dict, payload: dict, mappings: list[dict]) -> list[dict]:
    targets = _target_map(payload)
    mapped = {item["targetField"] for item in mappings}
    rows = []
    for item in parsed.get("missing") or []:
        if not isinstance(item, dict):
            continue
        target = _text(item.get("targetField") or item.get("target_field"))
        if not target or target not in targets:
            continue
        rows.append({
            "targetField": target,
            "reason": _text(item.get("reason"), 300),
            "suggestedField": _text(item.get("suggestedField") or item.get("suggested_field"))
        })
    known = {item["targetField"] for item in rows}
    for name, field in targets.items():
        if not field.get("required") or field.get("systemCalc") or name in mapped or name in known:
            continue
        rows.append({"targetField": name, "reason": "必填目标字段尚未映射", "suggestedField": ""})
    return rows


_CHAT_ANSWER_TYPES = {"text", "field_list", "mapping_list", "action", "validation"}
_CHAT_PATCH_KEYS = {
    "label", "labelEn", "label_en", "group", "type", "inputMode", "input_mode",
    "defaultValue", "default_value", "required", "dictionary", "description",
    "sourceHint", "source_hint"
}


def standard_field_view(field: dict) -> dict:
    mode = _text(field.get("inputMode") or field.get("input_mode")) or "manual"
    return {
        "name": _text(field.get("name")),
        "label": _text(field.get("label")) or _text(field.get("name")),
        "labelEn": _text(field.get("labelEn") or field.get("label_en")),
        "group": _text(field.get("group")),
        "type": _text(field.get("type")) or "string",
        "inputMode": mode if mode in _INPUT_MODES else "manual",
        "defaultValue": _text(field.get("defaultValue") if field.get("defaultValue") is not None else field.get("default_value"), 400),
        "required": bool(field.get("required")),
        "dictionary": _text(field.get("dictionary")),
        "enumValues": field.get("enumValues") or field.get("enum_values") or [],
        "description": _text(field.get("description")) or _text(field.get("label")),
        "sourceHint": _text(field.get("sourceHint") or field.get("source_hint")),
        "aliases": field.get("aliases") or [],
        "newField": bool(field.get("newField"))
    }


def _clamp(value: Any, fallback: float) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return fallback
    return max(0.0, min(1.0, round(number, 2)))




def _array_items(text: str, key: str) -> list[dict]:
    """Extract complete JSON objects from a top-level array named ``key``.

    The model streams one JSON object; this helper lets the UI append fields or
    mappings as soon as each array element is complete. Incomplete items are
    ignored until a later chunk closes them.
    """
    marker = '"' + key + '"'
    start = text.find(marker)
    if start < 0:
        return []
    start = text.find("[", start + len(marker))
    if start < 0:
        return []
    items: list[dict] = []
    depth = 0
    in_string = False
    escape = False
    item_start = -1
    for index in range(start + 1, len(text)):
        char = text[index]
        if in_string:
            if escape:
                escape = False
            elif char == "\\":
                escape = True
            elif char == '"':
                in_string = False
            continue
        if char == '"':
            in_string = True
        elif char == "{":
            if depth == 0:
                item_start = index
            depth += 1
        elif char == "}":
            if depth > 0:
                depth -= 1
                if depth == 0 and item_start >= 0:
                    try:
                        value = json.loads(text[item_start:index + 1])
                    except (ValueError, TypeError):
                        value = None
                    if isinstance(value, dict):
                        items.append(value)
                    item_start = -1
        elif char == "]" and depth == 0:
            break
    return items
