"""Deterministic review of a product-group proposal.

Review never mutates the proposal. It returns findings that may later become a
Refine task after user confirmation.
"""

from __future__ import annotations

from typing import Any

from agent.core.product_group.revision import same_digest


def _text(value: Any) -> str:
    return str(value or "").strip()


def _list(value: Any) -> list:
    return value if isinstance(value, list) else []


def _finding(code: str, target: str, message: str, suggested: str = "", severity: str = "warning") -> dict:
    return {
        "id": code + ":" + (target or "group"),
        "code": code,
        "severity": severity,
        "targetField": target,
        "message": message,
        "suggestedAction": suggested,
        "actionType": "refine",
    }


def review_proposal(
    proposal: dict,
    context: dict,
    constraints: list | None = None,
    draft_digest: str = "",
    expected_digest: str = "",
) -> list[dict]:
    findings: list[dict] = []
    target_map = {
        _text(item.get("name")): item
        for item in _list(context.get("targetFields"))
        if isinstance(item, dict) and _text(item.get("name"))
    }
    decisions = [item for item in _list(proposal.get("decisions")) if isinstance(item, dict)]
    decision_targets = {_text(item.get("targetField")) for item in decisions}
    constraint_types = {
        _text(item.get("type")) if isinstance(item, dict) else _text(item)
        for item in (constraints or [])
    }
    dictionaries = {
        _text(item.get("dict_code")): item
        for item in _list(context.get("dictionaries"))
        if isinstance(item, dict) and _text(item.get("dict_code"))
    }
    for item in _list(proposal.get("newDictionaries")):
        if isinstance(item, dict) and _text(item.get("dict_code")):
            dictionaries[_text(item.get("dict_code"))] = item

    mapping_targets = []
    for decision in decisions:
        target = _text(decision.get("targetField"))
        target_def = target_map.get(target, {})
        decision_type = _text(decision.get("decisionType"))
        mapping = decision.get("mapping") if isinstance(decision.get("mapping"), dict) else {}
        if target and target not in target_map:
            findings.append(_finding("TARGET_NOT_IN_SCOPE", target, "目标字段不在当前暴露类型范围", "移除该字段决策", "error"))
        if target_def.get("systemCalc") and mapping:
            findings.append(_finding("CALC_MAPPING", target, "系统计算字段不应建立产品映射", "删除该映射", "error"))
        if decision_type == "create" and "NO_NEW_FIELDS" in constraint_types:
            findings.append(_finding("USER_CONSTRAINT", target, "用户约束为不新建标准字段", "改为复用或跳过", "error"))
        if mapping:
            mapping_targets.append(target)
            if _text(mapping.get("mappingType")) == "constant" and not _text(mapping.get("defaultValue")):
                findings.append(_finding("CONSTANT_EMPTY", target, "常量映射缺少默认值", "补充 defaultValue", "error"))
            dictionary = _text(mapping.get("dictionary") or decision.get("dictionary"))
            if dictionary and dictionary not in dictionaries:
                findings.append(_finding("DICTIONARY_MISSING", target, "引用的字典不存在：" + dictionary, "补充字典或移除引用", "error"))
        if decision_type == "missing":
            findings.append(_finding("DECISION_MISSING", target, "字段仍未确定处理方式", "人工确认或重新生成", "warning"))
    duplicates = sorted({target for target in mapping_targets if mapping_targets.count(target) > 1})
    for target in duplicates:
        findings.append(_finding("DUPLICATE_MAPPING", target, "同一目标字段出现多条映射", "只保留一条映射", "error"))
    for target, fixed in target_map.items():
        if fixed.get("required") and target not in decision_targets:
            findings.append(_finding("REQUIRED_UNMAPPED", target, "必填监管字段没有决策", "补充字段决策", "error"))
    if draft_digest and expected_digest and not same_digest(draft_digest, expected_digest):
        findings.append(_finding("DRAFT_STALE", "", "草稿在 Agent 执行期间已变化，当前结果不能直接应用", "重新加载草稿后重试", "error"))
    return findings
