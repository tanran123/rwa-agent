"""Deterministic merge of a model proposal with user selections and constraints.

The model only proposes. This module owns selection protection, user edits,
constraint conflicts and draft-level diffing.
"""

from __future__ import annotations

from typing import Any

from agent.core.product_group.revision import digest_payload


def _text(value: Any) -> str:
    return str(value or "").strip()


def _list(value: Any) -> list:
    return value if isinstance(value, list) else []


def _dict(value: Any) -> dict:
    return value if isinstance(value, dict) else {}


def _decision_map(proposal: dict | None) -> dict[str, dict]:
    result = {}
    for item in _list((proposal or {}).get("decisions")):
        if isinstance(item, dict) and _text(item.get("targetField")):
            result[_text(item["targetField"])] = dict(item)
    return result


def _selection_of(value: Any, previous: dict | None) -> dict[str, list[str]]:
    if isinstance(value, dict):
        decisions = value.get("decisions")
        # 支持前端传完整 selection 对象，也支持只传决策目标数组。
        return {
            "decisions": [_text(item) for item in _list(decisions) if _text(item)],
            "fields": [_text(item) for item in _list(value.get("fields")) if _text(item)],
            "mappings": [_text(item) for item in _list(value.get("mappings")) if _text(item)],
            "dictionaries": [_text(item) for item in _list(value.get("dictionaries")) if _text(item)],
        }
    if isinstance(value, list):
        return {"decisions": [_text(item) for item in value if _text(item)], "fields": [], "mappings": [], "dictionaries": []}
    defaults = {"decisions": [], "fields": [], "mappings": [], "dictionaries": []}
    for item in _list((previous or {}).get("decisions")):
        if isinstance(item, dict) and item.get("decisionType") != "missing" and _text(item.get("targetField")):
            defaults["decisions"].append(_text(item["targetField"]))
    for item in _list((previous or {}).get("standardFields")):
        if isinstance(item, dict) and _text(item.get("name")):
            defaults["fields"].append(_text(item["name"]))
    for item in _list((previous or {}).get("mappings")):
        if isinstance(item, dict) and _text(item.get("targetField")):
            defaults["mappings"].append(_text(item["targetField"]))
    for item in _list((previous or {}).get("newDictionaries")):
        if isinstance(item, dict) and _text(item.get("dict_code")):
            defaults["dictionaries"].append(_text(item["dict_code"]))
    return defaults


def _constraint_types(constraints: list) -> set[str]:
    found = set()
    for item in constraints or []:
        if isinstance(item, dict):
            found.add(_text(item.get("type")))
        elif isinstance(item, str):
            found.add(item)
    return found


def _edit_map(edits: list) -> dict[str, dict]:
    result = {}
    for item in edits or []:
        if not isinstance(item, dict):
            continue
        target = _text(item.get("targetField") or item.get("target_field"))
        if not target:
            continue
        patch = item.get("patch") or item.get("decision") or item.get("changes") or {}
        if isinstance(patch, dict):
            result[target] = patch
    return result


def _diff(previous: dict | None, proposed: dict, selection: dict) -> dict:
    before = _decision_map(previous)
    after = _decision_map(proposed)
    added = [name for name in after if name not in before]
    removed = [name for name in before if name not in after]
    changed = []
    for name, item in after.items():
        old = before.get(name)
        if not old:
            continue
        if (
            _text(old.get("decisionType")) != _text(item.get("decisionType"))
            or _text((old.get("mapping") or {}).get("mappingType")) != _text((item.get("mapping") or {}).get("mappingType"))
            or _text((old.get("mapping") or {}).get("sourceField")) != _text((item.get("mapping") or {}).get("sourceField"))
            or _text(old.get("defaultValue")) != _text(item.get("defaultValue"))
        ):
            changed.append(name)
    before_fields = {_text(item.get("name")) for item in _list((previous or {}).get("standardFields")) if isinstance(item, dict)}
    after_fields = {_text(item.get("name")) for item in _list(proposed.get("standardFields")) if isinstance(item, dict)}
    before_mappings = {_text(item.get("targetField")) for item in _list((previous or {}).get("mappings")) if isinstance(item, dict)}
    after_mappings = {_text(item.get("targetField")) for item in _list(proposed.get("mappings")) if isinstance(item, dict)}
    before_dicts = {_text(item.get("dict_code")) for item in _list((previous or {}).get("newDictionaries")) if isinstance(item, dict)}
    after_dicts = {_text(item.get("dict_code")) for item in _list(proposed.get("newDictionaries")) if isinstance(item, dict)}
    return {
        "addedDecisions": added,
        "changedDecisions": changed,
        "removedDecisions": removed,
        "addedFields": sorted(after_fields - before_fields),
        "removedFields": sorted(before_fields - after_fields),
        "addedMappings": sorted(after_mappings - before_mappings),
        "removedMappings": sorted(before_mappings - after_mappings),
        "addedDictionaries": sorted(after_dicts - before_dicts),
        "removedDictionaries": sorted(before_dicts - after_dicts),
        "selectedDecisions": list(selection.get("decisions") or []),
        "digest": digest_payload({"decisions": after, "selection": selection}),
    }


def merge_proposal(
    previous: dict | None,
    proposed: dict,
    selection: Any = None,
    constraints: list | None = None,
    edits: list | None = None,
    approved: bool = False,
) -> dict:
    previous = previous or {}
    proposed = proposed or {}
    before = _decision_map(previous)
    after = _decision_map(proposed)
    old_selection = _selection_of(selection, previous)
    constraint_types = _constraint_types(constraints or [])
    user_edits = _edit_map(edits or [])
    no_new_fields = "NO_NEW_FIELDS" in constraint_types and not approved
    required_only = "REQUIRED_ONLY" in constraint_types and not approved

    conflicts: list[dict] = []
    decisions = []
    selected_decisions = []
    blocked_targets: set[str] = set()
    old_selected = set(old_selection["decisions"])

    for target, item in after.items():
        decision = dict(item)
        decision.setdefault("source", "model")
        decision.setdefault("status", "recommended")
        target_label = _text(decision.get("targetLabel"))
        # 用户手工修改优先。
        patch = user_edits.get(target)
        if patch:
            decision.update(patch)
            decision["source"] = "user"
            decision["status"] = "confirmed"
            decision["userModified"] = True
            decision["changeReason"] = decision.get("changeReason") or "用户手工修改"
        # 用户约束：不新建标准字段。
        if no_new_fields and decision.get("decisionType") == "create":
            decision["blockedByConstraint"] = "NO_NEW_FIELDS"
            decision["status"] = "excluded"
            blocked_targets.add(target)
            conflicts.append({
                "type": "USER_CONSTRAINT",
                "code": "NO_NEW_FIELDS",
                "targetField": target,
                "message": "用户约束为不新建标准字段，模型建议新建 " + target,
            })
        # 用户约束：只处理必填字段。
        if required_only and decision.get("targetRequired") is False:
            decision["status"] = "excluded"
            decision["blockedByConstraint"] = "REQUIRED_ONLY"
        # 保留旧勾选；本次新增的决策自动勾选。
        if target in old_selected or (target not in before and target not in blocked_targets):
            if decision.get("decisionType") != "missing" and decision.get("status") != "excluded":
                decision["status"] = "confirmed" if target in old_selected else "recommended"
                selected_decisions.append(target)
        decisions.append(decision)

    proposed["decisions"] = decisions
    selections = {
        "decisions": selected_decisions,
        "fields": [],
        "mappings": [],
        "dictionaries": [],
    }

    # 字段/映射/字典沿用“保留旧勾选或本次新增”的规则。
    old_fields = set(old_selection["fields"])
    old_mappings = set(old_selection["mappings"])
    old_dicts = set(old_selection["dictionaries"])
    before_fields = {_text(item.get("name")) for item in _list(previous.get("standardFields")) if isinstance(item, dict)}
    before_mappings = {_text(item.get("targetField")) for item in _list(previous.get("mappings")) if isinstance(item, dict)}
    before_dicts = {_text(item.get("dict_code")) for item in _list(previous.get("newDictionaries")) if isinstance(item, dict)}

    if no_new_fields:
        proposed["standardFields"] = [
            item for item in _list(proposed.get("standardFields"))
            if isinstance(item, dict) and _text(item.get("name")) in before_fields
        ]
    for item in _list(proposed.get("standardFields")):
        name = _text(item.get("name")) if isinstance(item, dict) else ""
        if name and (name in old_fields or name not in before_fields):
            selections["fields"].append(name)
    for item in _list(proposed.get("mappings")):
        target = _text(item.get("targetField")) if isinstance(item, dict) else ""
        if target and target not in blocked_targets and (target in old_mappings or target not in before_mappings):
            selections["mappings"].append(target)
    for item in _list(proposed.get("newDictionaries")):
        code = _text(item.get("dict_code")) if isinstance(item, dict) else ""
        if code and (code in old_dicts or code not in before_dicts):
            selections["dictionaries"].append(code)

    diff = _diff(previous, proposed, selections)
    change_count = len(diff["addedDecisions"]) + len(diff["changedDecisions"]) + len(diff["addedMappings"]) + len(diff["addedFields"])
    if change_count >= 10:
        conflicts.append({
            "type": "BATCH_THRESHOLD",
            "message": "本次变更涉及 " + str(change_count) + " 个对象，需要人工确认",
        })
    return {
        "proposal": proposed,
        "selection": selections,
        "diff": diff,
        "conflicts": conflicts,
        "requiresApproval": bool(conflicts),
        "changeSummary": {
            "decisions": len(selections["decisions"]),
            "fields": len(selections["fields"]),
            "mappings": len(selections["mappings"]),
            "dictionaries": len(selections["dictionaries"]),
            "changes": change_count,
        },
    }
