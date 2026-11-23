"""按监管字段分组生成标准字段、字典和映射。

服务端先把当前分组、字段画像和已确认草稿交给模型；本模块只做
“当前分组”的结果收敛，不允许越组输出。生成结果以字段级决策为核心，
标准字段和映射都从决策里材料化，便于前端逐行展示、勾选和调整。
"""

from __future__ import annotations

import json
import re
from typing import Any

from agent.llm.agents.capability import capability
from agent.llm.capabilities.jsonx import extract_json
from agent.llm.capabilities.product_mapping import (
    _array_items, _clamp, _constant_default, _default_text, _missing, _normalize_fields,
    _normalize_mappings, _text, standard_field_view,
)

_NAME = re.compile(r"^[A-Za-z][A-Za-z0-9_]*$")
_DICT_CODE = re.compile(r"^[A-Z][A-Z0-9_]+$")
_DECISION_TYPES = {"reuse", "create", "default", "system", "skip", "missing"}
_MAPPING_TYPES = {"direct", "constant", "transform", "conditional", "calculation", "composite"}
# 模型没给 confidence 时按决策确定性回落，避免所有字段都显示 60%。
_CONFIDENCE_FALLBACK = {
    "reuse": 0.75,
    "create": 0.75,
    "default": 0.85,
    "system": 1.0,
    "skip": 0.9,
    "missing": 0.3,
}


def _normalize_groups(raw: object, warnings: list[str]) -> list[dict]:
    result: list[dict] = []
    seen: set[str] = set()
    for item in raw or []:
        if not isinstance(item, dict):
            continue
        group_id = _text(item.get("group_id") or item.get("id"))
        if not _NAME.match(group_id):
            warnings.append("丢弃非法标准字段分组编码：" + (group_id or "（空）"))
            continue
        if group_id in seen:
            continue
        seen.add(group_id)
        result.append({
            "group_id": group_id,
            "label": _text(item.get("label")) or group_id,
            "label_en": _text(item.get("label_en") or item.get("labelEn")) or group_id,
            "description": _text(item.get("description"), 300)
        })
    return result


def _normalize_dictionaries(raw: object, warnings: list[str]) -> list[dict]:
    result: list[dict] = []
    seen: set[str] = set()
    for item in raw or []:
        if not isinstance(item, dict):
            continue
        code = _text(item.get("dict_code") or item.get("code"))
        if not _DICT_CODE.match(code):
            warnings.append("丢弃非法字典编码：" + (code or "（空）"))
            continue
        if code in seen:
            continue
        seen.add(code)
        items: list[dict] = []
        item_seen: set[str] = set()
        for row in item.get("items") or []:
            if not isinstance(row, dict):
                continue
            item_code = _text(row.get("item_code") or row.get("code"))
            if not item_code or item_code in item_seen:
                continue
            item_seen.add(item_code)
            items.append({
                "item_code": item_code,
                "item_name": _text(row.get("item_name") or row.get("name")) or item_code,
                "item_name_en": _text(row.get("item_name_en") or row.get("itemNameEn")) or item_code,
                "status": "ACTIVE"
            })
        if not items:
            warnings.append("字典 " + code + " 没有码值，已丢弃")
            continue
        result.append({
            "dict_code": code,
            "dict_name": _text(item.get("dict_name") or item.get("name")) or code,
            "dict_name_en": _text(item.get("dict_name_en") or item.get("dictNameEn")) or code,
            "description": _text(item.get("description"), 300),
            "items": items
        })
    return result


def _field_notes(raw: object, payload: dict) -> list[dict]:
    group = payload.get("group") if isinstance(payload.get("group"), dict) else {}
    allowed = {_text(item.get("name")) for item in (group.get("targetFields") or []) if isinstance(item, dict)}
    result = []
    for item in raw or []:
        if not isinstance(item, dict):
            continue
        target = _text(item.get("targetField") or item.get("target_field"))
        if not target or target not in allowed:
            continue
        result.append({
            "targetField": target,
            "purpose": _text(item.get("purpose"), 400),
            "standardField": _text(item.get("standardField") or item.get("standard_field")),
            "mappingType": _text(item.get("mappingType") or item.get("mapping_type"))
        })
    return result


def _known_field(payload: dict, name: str) -> dict | None:
    for item in payload.get("existingStandardFields") or []:
        if isinstance(item, dict) and _text(item.get("name")) == name:
            return standard_field_view(item)
    proposal = payload.get("currentProposal")
    if isinstance(proposal, dict):
        for item in proposal.get("standardFields") or []:
            if isinstance(item, dict) and _text(item.get("name")) == name:
                return standard_field_view(item)
    return None


def _dictionary_of(item: object, dictionaries: list[dict], warnings: list[str]) -> dict | None:
    if isinstance(item, str):
        code = _text(item)
        if not code:
            return None
        found = next((dict_ for dict_ in dictionaries if dict_["dict_code"] == code), None)
        if not found:
            warnings.append("引用了未定义的字典：" + code)
        return found
    if isinstance(item, dict):
        normalized = _normalize_dictionaries([item], warnings)
        return normalized[0] if normalized else None
    return None


def _normalize_decisions(
    parsed: dict,
    payload: dict,
    fields: list[dict],
    mappings: list[dict],
    dictionaries: list[dict],
    warnings: list[str],
    complete: bool = True,
) -> list[dict]:
    """把模型输出的字段级决策收敛成当前分组内可应用的清单。

    决策是唯一来源：决策里可以内嵌标准字段、字典和映射；本函数把它们
    材料化到 `fields` / `mappings` 中，后续应用逻辑只读决策即可。
    """
    targets = {
        _text(item.get("name")): item
        for item in (payload.get("targetFields") or [])
        if isinstance(item, dict) and _text(item.get("name"))
    }
    fields_by_name = {item["name"]: item for item in fields if item.get("name")}
    mapping_by_target = {item["targetField"]: item for item in mappings if item.get("targetField")}
    dictionary_by_code = {item["dict_code"]: item for item in dictionaries}
    result: list[dict] = []
    seen: set[str] = set()

    for item in parsed.get("decisions") or parsed.get("fieldDecisions") or parsed.get("field_decisions") or []:
        if not isinstance(item, dict):
            continue
        target = _text(item.get("targetField") or item.get("target_field"))
        if not target or target not in targets:
            warnings.append("丢弃当前分组之外的决策：" + (target or "（空）"))
            continue
        if target in seen:
            warnings.append("同一目标字段出现多条决策，已保留第一条：" + target)
            continue
        seen.add(target)

        decision_type = _text(item.get("decisionType") or item.get("decision_type")) or "missing"
        if decision_type not in _DECISION_TYPES:
            warnings.append(target + " 的决策类型不支持：" + decision_type + "，已改为缺失")
            decision_type = "missing"
        if targets[target].get("systemCalc"):
            if decision_type != "system":
                warnings.append(target + " 是系统计算字段，决策已改为 system")
            decision_type = "system"

        raw_confidence = item.get("confidence")
        if raw_confidence in (None, ""):
            decision_confidence = _CONFIDENCE_FALLBACK.get(decision_type, 0.6)
        else:
            decision_confidence = _clamp(raw_confidence, _CONFIDENCE_FALLBACK.get(decision_type, 0.6))

        inline_field = item.get("standardField") if isinstance(item.get("standardField"), dict) else (
            item.get("standard_field") if isinstance(item.get("standard_field"), dict) else None
        )
        if inline_field and inline_field.get("confidence") in (None, ""):
            # 复用/新建的置信度以决策为准，避免字段行回落成默认 60%。
            inline_field = dict(inline_field)
            inline_field["confidence"] = decision_confidence
        standard_name = _text(item.get("standardField") or item.get("standard_field")) if not inline_field else ""
        standard: dict | None = None

        if decision_type in ("reuse", "create"):
            if inline_field:
                normalized = _normalize_fields({"standardFields": [inline_field]}, payload, warnings)
                if normalized:
                    standard = normalized[0]
                    if standard["name"] in fields_by_name:
                        # 模型重复声明已有字段时以新内容为准，但保留复用标记。
                        position = fields.index(fields_by_name[standard["name"]])
                        fields[position] = standard
                    else:
                        fields.append(standard)
                    fields_by_name[standard["name"]] = standard
            elif standard_name:
                standard = fields_by_name.get(standard_name) or _known_field(payload, standard_name)
                if standard and standard["name"] not in fields_by_name:
                    fields.append(standard)
                    fields_by_name[standard["name"]] = standard
            if not standard:
                warnings.append(target + " 的 " + decision_type + " 决策缺少可用的标准字段，已改为缺失")
                decision_type = "missing"

        dictionary = None
        if standard and standard.get("dictionary"):
            dictionary = dictionary_by_code.get(_text(standard.get("dictionary")))
            if not dictionary and complete:
                warnings.append("标准字段 " + standard["name"] + " 引用了未定义的字典：" + _text(standard.get("dictionary")))
                standard["dictionary"] = ""
        elif decision_type in ("reuse", "create"):
            dictionary = _dictionary_of(item.get("dictionary"), dictionaries, warnings if complete else [])
            if dictionary and standard:
                standard["dictionary"] = dictionary["dict_code"]

        mapping: dict | None = None
        raw_mapping = item.get("mapping") if isinstance(item.get("mapping"), dict) else None
        if raw_mapping:
            candidate = dict(raw_mapping)
            candidate.setdefault("targetField", target)
            normalized = _normalize_mappings({"mappings": [candidate]}, payload, list(fields_by_name.values()), warnings)
            if normalized:
                mapping = normalized[0]
            else:
                warnings.append(target + " 的映射建议不合法，已忽略")
        if mapping is None:
            mapping = mapping_by_target.get(target)

        if decision_type == "default":
            default_value = _default_text(
                item.get("defaultValue") if item.get("defaultValue") is not None else item.get("default_value"),
                (targets.get(target) or {}).get("type") or "",
            )
            if not default_value and mapping:
                default_value = _constant_default(mapping, (targets.get(target) or {}).get("type") or "")
            if not default_value:
                warnings.append(target + " 需要固定默认值，但模型没有给出默认值，已改为缺失")
                decision_type = "missing"
                mapping = None
            else:
                mapping = {
                    "targetField": target,
                    "sourceField": "",
                    "mappingType": "constant",
                    "defaultValue": default_value,
                    "confidence": decision_confidence,
                    "reason": _text(item.get("reason"), 300)
                }
        elif decision_type in ("reuse", "create") and standard:
            if not mapping or not _text(mapping.get("sourceField")):
                mapping = {
                    "targetField": target,
                    "sourceField": standard["name"],
                    "mappingType": "direct",
                    "defaultValue": None,
                    "confidence": decision_confidence,
                    "reason": _text(item.get("reason"), 300)
                }
        elif decision_type in ("system", "skip", "missing"):
            mapping = None

        if mapping:
            mapping = dict(mapping)
            mapping["targetField"] = target
            if mapping.get("mappingType") not in _MAPPING_TYPES:
                mapping["mappingType"] = "direct"
            if mapping["mappingType"] == "constant":
                mapping["sourceField"] = _text(mapping.get("sourceField"))
                if not mapping["sourceField"]:
                    mapping["defaultValue"] = _constant_default(mapping, (targets.get(target) or {}).get("type") or "")
                if not _constant_default(mapping, (targets.get(target) or {}).get("type") or ""):
                    mapping = None
        if mapping:
            mapping_by_target[target] = mapping
            existing = next((entry for entry in mappings if entry.get("targetField") == target), None)
            if existing is not None:
                position = mappings.index(existing)
                mappings[position] = mapping
            else:
                mappings.append(mapping)
        elif decision_type == "default":
            warnings.append(target + " 的默认值映射缺少默认值，已改为缺失")
            decision_type = "missing"

        result.append({
            "targetField": target,
            "targetLabel": targets[target].get("label") or target,
            "decisionType": decision_type,
            "standardField": standard if decision_type in ("reuse", "create") else None,
            "dictionary": dictionary,
            "mapping": mapping,
            "defaultValue": _constant_default(mapping, (targets.get(target) or {}).get("type") or "") if decision_type == "default" and mapping else "",
            "reason": _text(item.get("reason"), 300),
            "ruleReason": _text(item.get("ruleReason") or item.get("rule_reason"), 500),
            "confidence": decision_confidence
        })

    # 模型漏掉的字段补一条决策，保证本组每个监管字段都有结论。
    # 流式增量处理时不做补全，等最终 result 再统一补。
    if complete:
        for target, field in targets.items():
            if target in seen:
                continue
            mapping = mapping_by_target.get(target)
            if field.get("systemCalc"):
                decision_type = "system"
                standard = None
            elif mapping:
                decision_type = "reuse"
                standard = fields_by_name.get(_text(mapping.get("sourceField"))) or None
            else:
                decision_type = "missing"
                standard = None
            result.append({
                "targetField": target,
                "targetLabel": field.get("label") or target,
                "decisionType": decision_type,
                "standardField": standard,
                "dictionary": dictionary_by_code.get(_text(standard.get("dictionary"))) if standard else None,
                "mapping": mapping,
                "reason": "模型没有给出该字段的决策，已按当前配置补全。",
                "ruleReason": "",
                "confidence": _CONFIDENCE_FALLBACK.get(decision_type, 0.5)
            })
            seen.add(target)

    order = {name: index for index, name in enumerate(targets)}
    result.sort(key=lambda row: order.get(row["targetField"], 999))
    return result


def _decorate_group_result(result: dict, payload: dict, dictionaries: list[dict]) -> dict:
    """把结果行需要的展示元数据补齐：服务目标、字典码值、来源字段和转换规则。

    这些信息都来自服务端已组装的上下文或映射文档，不从模型输出里推断；
    模型给出的映射只用来选择源字段，转换规则以已有映射为准。
    """
    group = payload.get("group") if isinstance(payload.get("group"), dict) else {}
    targets = {}
    for item in group.get("targetFields") or []:
        if isinstance(item, dict) and _text(item.get("name")):
            targets[_text(item.get("name"))] = item
    existing_fields = {}
    for item in payload.get("existingStandardFields") or []:
        if isinstance(item, dict):
            view = standard_field_view(item)
            if view["name"]:
                existing_fields[view["name"]] = view
    fields_by_name = {}
    for item in result.get("standardFields") or []:
        if isinstance(item, dict) and _text(item.get("name")):
            fields_by_name[_text(item.get("name"))] = item

    served: dict[str, list[dict]] = {}
    for decision in result.get("decisions") or []:
        if not isinstance(decision, dict):
            continue
        standard = decision.get("standardField")
        if not isinstance(standard, dict):
            continue
        name = _text(standard.get("name"))
        if not name:
            continue
        target_name = _text(decision.get("targetField"))
        target = targets.get(target_name) or {}
        served.setdefault(name, []).append({
            "targetField": target_name,
            "targetLabel": _text(decision.get("targetLabel")) or _text(target.get("label")) or target_name,
        })
        if standard.get("confidence") in (None, ""):
            standard["confidence"] = decision.get("confidence")
        field = fields_by_name.get(name)
        if field is not None and field.get("confidence") in (None, ""):
            field["confidence"] = decision.get("confidence")

    dictionary_by_code = {
        _text(item.get("dict_code")): item
        for item in dictionaries
        if isinstance(item, dict) and _text(item.get("dict_code"))
    }
    for field in result.get("standardFields") or []:
        if not isinstance(field, dict):
            continue
        name = _text(field.get("name"))
        field["servedTargetFields"] = served.get(name, [])
        code = _text(field.get("dictionary"))
        if code and code in dictionary_by_code:
            field["dictionaryDetail"] = dictionary_by_code[code]
        existing = existing_fields.get(name)
        if existing:
            field["existingStandardField"] = existing
        if field.get("confidence") in (None, ""):
            field["confidence"] = 0.6

    existing_mappings = {}
    for item in payload.get("existingMappings") or []:
        if isinstance(item, dict):
            target_name = _text(item.get("targetField") or item.get("target_field"))
            if target_name:
                existing_mappings[target_name] = item
    for mapping in result.get("mappings") or []:
        if not isinstance(mapping, dict):
            continue
        target_name = _text(mapping.get("targetField"))
        target = targets.get(target_name) or {}
        mapping["targetLabel"] = _text(target.get("label")) or target_name
        mapping["targetType"] = _text(target.get("type"))
        mapping["targetRequired"] = bool(target.get("required"))
        source_name = _text(mapping.get("sourceField"))
        source = fields_by_name.get(source_name) or existing_fields.get(source_name) or {}
        if source:
            mapping["sourceLabel"] = _text(source.get("label")) or source_name
            mapping["sourceType"] = _text(source.get("type"))
            mapping["sourceInputMode"] = _text(source.get("inputMode"))
            mapping["sourceDictionary"] = _text(source.get("dictionary"))
        existing = existing_mappings.get(target_name)
        if existing and _text(existing.get("sourceField") or existing.get("source_field")) == source_name:
            mapping["mappingType"] = _text(existing.get("mappingType")) or mapping.get("mappingType")
            mapping["transform"] = existing.get("transform") or mapping.get("transform")
            mapping["transformType"] = _text(existing.get("transformType")) or mapping.get("transformType")
            for key in ("missingPolicy", "description", "regulatoryReference", "sourceType", "targetType", "defaultValue"):
                if mapping.get(key) in (None, "", False) and existing.get(key) not in (None, "", False):
                    mapping[key] = existing.get(key)
        transform = mapping.get("transform")
        if isinstance(transform, dict) and not mapping.get("transformType"):
            mapping["transformType"] = _text(transform.get("type"))
    return result


def _normalize_group(parsed: dict, payload: dict) -> dict:
    group = payload.get("group") if isinstance(payload.get("group"), dict) else {}
    warnings: list[str] = []
    for item in parsed.get("warnings") or []:
        text = _text(item, 300)
        if text:
            warnings.append(text)

    normalized_payload = dict(payload)
    product = dict(payload.get("product") or {})
    if payload.get("standardFieldGroups"):
        product["standardFieldGroups"] = payload["standardFieldGroups"]
    normalized_payload["product"] = product

    fields = _normalize_fields(parsed, normalized_payload, warnings)
    new_groups = _normalize_groups(parsed.get("newStandardGroups") or parsed.get("new_standard_groups"), warnings)
    suggested = group.get("suggestedStandardGroup") if isinstance(group.get("suggestedStandardGroup"), dict) else None
    if suggested and not any(item["group_id"] == _text(suggested.get("group_id")) for item in new_groups):
        suggested_id = _text(suggested.get("group_id"))
        if any(_text(item.get("group")) == suggested_id for item in fields):
            new_groups.append({
                "group_id": suggested_id,
                "label": _text(suggested.get("label")) or suggested_id,
                "label_en": _text(suggested.get("label_en")) or suggested_id,
                "description": _text(suggested.get("description"), 300)
            })
    new_dictionaries = _normalize_dictionaries(
        parsed.get("newDictionaries") or parsed.get("new_dictionaries"),
        warnings,
    )
    dictionaries = list(payload.get("dictionaries") or [])
    known_codes = {_text(item.get("dict_code")) for item in dictionaries if isinstance(item, dict)}
    for dictionary in new_dictionaries:
        if dictionary["dict_code"] not in known_codes:
            dictionaries.append(dictionary)
            known_codes.add(dictionary["dict_code"])
    # 模型有时把新字典直接嵌在决策里；把它补进 newDictionaries，避免字段引用落空。
    for decision in parsed.get("decisions") or parsed.get("fieldDecisions") or parsed.get("field_decisions") or []:
        if not isinstance(decision, dict):
            continue
        inline_dictionary = decision.get("dictionary")
        if not isinstance(inline_dictionary, dict):
            continue
        code = _text(inline_dictionary.get("dict_code") or inline_dictionary.get("code"))
        if not code or code in known_codes:
            continue
        normalized = _normalize_dictionaries([inline_dictionary], warnings)
        if normalized:
            new_dictionaries.append(normalized[0])
            dictionaries.append(normalized[0])
            known_codes.add(code)

    mappings = _normalize_mappings(parsed, normalized_payload, fields, warnings)
    decisions = _normalize_decisions(parsed, normalized_payload, fields, mappings, dictionaries, warnings)
    missing = _missing(parsed, normalized_payload, mappings)
    suggestions = [_text(item, 120) for item in (parsed.get("suggestions") or []) if _text(item, 120)][:5]

    # 双保险：只保留当前分组的目标字段。
    target_fields = {
        _text(item.get("name"))
        for item in (payload.get("targetFields") or [])
        if isinstance(item, dict)
    }
    mappings = [item for item in mappings if item["targetField"] in target_fields]
    missing = [item for item in missing if item["targetField"] in target_fields]
    decisions = [item for item in decisions if item["targetField"] in target_fields]
    allowed_groups = {
        _text(item.get("group_id"))
        for item in (payload.get("standardFieldGroups") or [])
        if isinstance(item, dict)
    }
    allowed_groups.update(item["group_id"] for item in new_groups)
    fields = [item for item in fields if not allowed_groups or item["group"] in allowed_groups]

    derived_notes = []
    for decision in decisions:
        if decision.get("ruleReason") or decision.get("reason"):
            derived_notes.append({
                "targetField": decision["targetField"],
                "purpose": decision.get("ruleReason") or decision.get("reason"),
                "standardField": (decision.get("standardField") or {}).get("name", ""),
                "mappingType": decision["decisionType"]
            })
    field_notes = _field_notes(parsed.get("fieldNotes") or parsed.get("field_notes"), payload) or derived_notes

    result = {
        "message": _text(parsed.get("message"), 4000) or ("已完成 " + _text(group.get("label")) + " 分组的字段建议。"),
        "groupPurpose": _text(parsed.get("groupPurpose") or parsed.get("group_purpose"), 600)
            or _text(group.get("description"), 600),
        "fieldNotes": field_notes,
        "decisions": decisions,
        "standardFields": fields,
        "mappings": mappings,
        "newStandardGroups": new_groups,
        "newDictionaries": new_dictionaries,
        "missing": missing,
        "suggestions": suggestions,
        "warnings": warnings
    }
    return _decorate_group_result(result, payload, dictionaries)


def assist_group(payload: dict) -> dict:
    group = payload.get("group") if isinstance(payload.get("group"), dict) else {}
    if not group.get("id"):
        raise ValueError("缺少当前监管字段分组")
    target_fields = {
        _text(item.get("name"))
        for item in (payload.get("targetFields") or [])
        if isinstance(item, dict)
    }
    if not target_fields:
        raise ValueError("当前分组没有目标字段")

    raw = capability("cap-product-group", "product-field-group", timeout=150).ask(payload)
    parsed = extract_json(raw)
    if not isinstance(parsed, dict):
        raise ValueError("模型没有返回 JSON 对象")
    return _normalize_group(parsed, payload)


def assist_group_stream(payload: dict):
    """Yield SSE events for one group: status / dictionary / field / mapping / decision / result.

    Decisions are the source of truth; standard fields and mappings embedded in a
    decision are emitted as soon as that decision is complete.
    """
    group = payload.get("group") if isinstance(payload.get("group"), dict) else {}
    if not group.get("id"):
        raise ValueError("缺少当前监管字段分组")
    target_fields = [
        item for item in (payload.get("targetFields") or [])
        if isinstance(item, dict) and _text(item.get("name"))
    ]
    if not target_fields:
        raise ValueError("当前分组没有目标字段")

    text = json.dumps(payload, ensure_ascii=False)
    chunks: list[str] = []
    buffer = ""
    fields: list[dict] = []
    mappings: list[dict] = []
    dictionaries = [dict(item) for item in (payload.get("dictionaries") or []) if isinstance(item, dict)]
    seen_decisions: set[str] = set()
    seen_fields: set[str] = set()
    seen_mappings: set[str] = set()
    seen_dictionaries: set[str] = set()

    yield {"event": "status", "data": {
        "stage": "reading_group",
        "message": "正在读取本组 " + str(len(target_fields)) + " 个监管字段的画像与规则用途…",
        "total": len(target_fields)
    }}
    yield {"event": "status", "data": {
        "stage": "analyzing",
        "message": "正在分析字段定义、规则用途和产品默认值…",
        "total": len(target_fields)
    }}
    yield {"event": "status", "data": {
        "stage": "generating",
        "message": "正在生成字段级决策…",
        "total": len(target_fields)
    }}
    try:
        for piece in capability("cap-product-group", "product-field-group", timeout=150).stream_text(text):
            chunks.append(piece)
            buffer += piece
            for obj in _array_items(buffer, "newDictionaries"):
                key = json.dumps(obj, ensure_ascii=False, sort_keys=True)
                if key in seen_dictionaries:
                    continue
                normalized = _normalize_dictionaries([obj], [])
                if not normalized:
                    continue
                seen_dictionaries.add(key)
                dictionary = normalized[0]
                if dictionary["dict_code"] not in {item.get("dict_code") for item in dictionaries}:
                    dictionaries.append(dictionary)
                yield {"event": "dictionary", "data": {"dictionary": dictionary}}
            for obj in _array_items(buffer, "standardFields"):
                normalized = _normalize_fields({"standardFields": [obj]}, payload, [])
                if not normalized:
                    continue
                field = normalized[0]
                if field["name"] in {item.get("name") for item in fields}:
                    continue
                fields.append(field)
                if field["name"] in seen_fields:
                    continue
                seen_fields.add(field["name"])
                yield {"event": "field", "data": {"field": field}}
            for obj in _array_items(buffer, "mappings"):
                normalized = _normalize_mappings({"mappings": [obj]}, payload, fields, [])
                if not normalized:
                    continue
                mapping = normalized[0]
                if mapping["targetField"] in {item.get("targetField") for item in mappings}:
                    continue
                mappings.append(mapping)
                if mapping["targetField"] in seen_mappings:
                    continue
                seen_mappings.add(mapping["targetField"])
                yield {"event": "mapping", "data": {"mapping": mapping}}
            for obj in _array_items(buffer, "decisions"):
                target = _text(obj.get("targetField") or obj.get("target_field"))
                key = target or json.dumps(obj, ensure_ascii=False, sort_keys=True)
                if not target or key in seen_decisions:
                    continue
                before_fields = len(fields)
                before_mappings = len(mappings)
                normalized = _normalize_decisions(
                    {"decisions": [obj]}, payload, fields, mappings, dictionaries, [], complete=False
                )
                if not normalized:
                    continue
                seen_decisions.add(key)
                for decision in normalized:
                    yield {"event": "decision", "data": {
                        "decision": decision,
                        "done": len(seen_decisions),
                        "total": len(target_fields)
                    }}
                for field in fields[before_fields:]:
                    field_key = field["name"]
                    if field_key in seen_fields:
                        continue
                    seen_fields.add(field_key)
                    yield {"event": "field", "data": {"field": field}}
                for mapping in mappings[before_mappings:]:
                    mapping_key = mapping["targetField"]
                    if mapping_key in seen_mappings:
                        continue
                    seen_mappings.add(mapping_key)
                    yield {"event": "mapping", "data": {"mapping": mapping}}
        result = _normalize_group(extract_json("".join(chunks)), payload)
        yield {"event": "result", "data": result}
    except Exception as exc:  # noqa: BLE001
        yield {"event": "error", "data": {"error": str(exc) or "分组字段建议失败"}}


def _answer_text(raw: str) -> str:
    """问答模式允许 Markdown；模型偶尔仍包成 JSON 时取其中的正文。"""
    text = (raw or "").strip()
    if text.startswith("{"):
        parsed = extract_json(text)
        if isinstance(parsed, dict):
            candidate = _text(parsed.get("message") or parsed.get("reply"), 8000)
            if candidate:
                return candidate
    return text


def answer_group(payload: dict) -> dict:
    """回答本组的问题，不生成也不修改任何决策。"""
    group = payload.get("group") if isinstance(payload.get("group"), dict) else {}
    if not group.get("id"):
        raise ValueError("缺少当前监管字段分组")
    raw = capability("cap-product-group", "product-field-group", timeout=150).ask(payload)
    text = _answer_text(raw)
    if not text:
        raise ValueError("模型没有返回回答")
    return {"message": text, "answerType": "answer"}


def answer_group_stream(payload: dict):
    """流式回答本组问题：status / token / result / error。"""
    group = payload.get("group") if isinstance(payload.get("group"), dict) else {}
    if not group.get("id"):
        raise ValueError("缺少当前监管字段分组")
    total = len(group.get("targetFields") or [])
    yield {"event": "status", "data": {
        "stage": "reading_group",
        "message": "正在读取本组 " + str(total) + " 个监管字段的画像、字典和映射…",
        "total": total
    }}
    yield {"event": "status", "data": {
        "stage": "answering",
        "message": "正在整理详细回答…",
        "total": total
    }}
    chunks: list[str] = []
    try:
        text = json.dumps(payload, ensure_ascii=False)
        for piece in capability("cap-product-group", "product-field-group", timeout=150).stream_text(text):
            chunks.append(piece)
            yield {"event": "token", "data": {"text": piece}}
        answer = _answer_text("".join(chunks))
        if not answer:
            raise ValueError("模型没有返回回答")
        yield {"event": "result", "data": {"message": answer, "answerType": "answer"}}
    except Exception as exc:  # noqa: BLE001
        yield {"event": "error", "data": {"error": str(exc) or "分组问答失败"}}
