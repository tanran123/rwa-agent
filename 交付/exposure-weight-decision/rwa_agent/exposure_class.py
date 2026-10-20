"""把权重法风险暴露分类 JSON 转成原型流程能直接画的判定树。"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
CLASS_PATH = ROOT / "knowledge" / "权重法风险暴露分类.json"


def load_class_doc() -> dict[str, Any]:
    raw = json.loads(CLASS_PATH.read_text(encoding="utf-8"))
    if not isinstance(raw, dict) or not isinstance(raw.get("rules"), list):
        raise ValueError("风险暴露分类 JSON 无效")
    return raw


def class_fields(doc: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    """分类 JSON 里的字段，含规则上另行声明的。例子扩展不算。"""
    doc = doc if isinstance(doc, dict) else load_class_doc()
    found: list[dict[str, Any]] = []
    seen: set[str] = set()

    def add(field: dict[str, Any]) -> None:
        name = str(field.get("name") or "").strip()
        if not name or name in seen or not isinstance(field, dict):
            return
        seen.add(name)
        options = []
        for opt in field.get("options") or []:
            if not isinstance(opt, dict) or opt.get("code") is None:
                continue
            options.append({"label": str(opt.get("label") or opt.get("code")), "code": opt.get("code")})
            if len(options) >= 40:
                break
        found.append({
            "id": name,
            "label": str(field.get("label") or name),
            "meaning": str(field.get("meaning") or field.get("note") or "")[:240],
            "type": str(field.get("type") or ""),
            "source": str(field.get("source") or "column"),
            "options": options,
        })

    def walk(rule: dict[str, Any]) -> None:
        for field in rule.get("fields") or []:
            if isinstance(field, dict):
                add(field)
        for child in rule.get("children") or []:
            if isinstance(child, dict):
                walk(child)
        other = rule.get("otherwise")
        if isinstance(other, dict):
            walk(other)

    for field in doc.get("fields") or []:
        if isinstance(field, dict):
            add(field)
    for rule in doc.get("rules") or []:
        if isinstance(rule, dict):
            walk(rule)
    other = doc.get("otherwise")
    if isinstance(other, dict):
        walk(other)
    return found


def prototype_flow() -> dict[str, Any]:
    """原型画布用的流程。分类顺序、条件和权重都来自 JSON，不沿用原型里手写的瀑布。"""
    doc = load_class_doc()
    categories = [_node(rule, str(rule.get("name") or "")) for rule in doc["rules"]]
    otherwise = doc.get("otherwise")
    if isinstance(otherwise, dict):
        node = _node(otherwise, str(otherwise.get("name") or "unclassified"))
        node["otherwise"] = True
        categories.append(node)
    return {
        "id": str(doc.get("name") or "cn_sa_exposure_class"),
        "name": str(doc.get("title") or "风险暴露分类"),
        "source": "knowledge/权重法风险暴露分类.json",
        "meta": {
            "jurisdiction": "CN",
            "method": "信用风险权重法",
            "regulation": "商业银行资本管理办法",
            "description": "按知识库里的规则从上到下，第一条命中再进它的下级。现金及现金等价物在最前，股权在已违约之前，其他资产在最后。某一支标了不适用就整段跳过，并且不落入同一层的兜底。",
            "default_first": False,
            "default_first_note": "已违约在股权之后、房地产和公司之前。股权即使违约也先归股权。逾期超过 90 天或五级分类为次级、可疑、损失的，走已违约。",
            "tree_align": "knowledge/权重法风险暴露分类.json",
        },
        "engine": {
            "mode": "waterfall",
            "on_yes": "enter_children_in_order",
            "on_no": "continue_down",
            "child_select": "first_match_then_children",
            "skip_unfilled": "applicable",
        },
        "fields": class_fields(doc),
        "categories": categories,
    }


def _node(rule: dict[str, Any], exposure_class: str) -> dict[str, Any]:
    name = str(rule.get("name") or "")
    label = str(rule.get("label") or name)
    children = [_node(child, exposure_class) for child in rule.get("children") or [] if isinstance(child, dict)]
    other = rule.get("otherwise")
    if isinstance(other, dict):
        fallback = _node(other, exposure_class)
        fallback["otherwise"] = True
        children.append(fallback)
    match = _when_to_match(rule.get("when"))
    node: dict[str, Any] = {
        "id": name,
        "type": "gate" if children else "leaf",
        "label": label,
        "question": label if label.endswith("？") else label + "？",
        "match": match,
        "on_match": "expand_children",
        "on_miss": "next_layer",
        "children": children,
    }
    note = str(rule.get("note") or "").strip()
    if note:
        node["content"] = {"basis": note}
    skip = rule.get("skip")
    if isinstance(skip, dict) and skip.get("field"):
        node["skip"] = {
            "field": skip.get("field"),
            "op": skip.get("op") or "eq",
            "match": skip.get("match"),
        }
    if not children:
        node["rule_id"] = name
        node["then"] = {
            "exposure_class": exposure_class,
            "sub_class": label,
            "risk_weight": _weight(rule),
        }
    return node


def _when_to_match(when: object) -> dict[str, Any]:
    if not isinstance(when, dict):
        return {"all": []}
    if "all" in when or "any" in when:
        key = "all" if "all" in when else "any"
        items = when.get(key) if isinstance(when.get(key), list) else []
        return {key: [_when_to_match(item) if _is_group(item) else _cond(item) for item in items if isinstance(item, dict)]}
    return {"all": [_cond(when)]}


def _is_group(item: dict[str, Any]) -> bool:
    return "all" in item or "any" in item


def _cond(item: dict[str, Any]) -> dict[str, Any]:
    cond: dict[str, Any] = {
        "field": item.get("field"),
        "op": item.get("op") or "eq",
        "value": item.get("match", item.get("value")),
    }
    return cond


def _weight(rule: dict[str, Any]) -> dict[str, Any]:
    if "value" in rule and rule.get("value") is not None:
        try:
            number = float(rule["value"])
        except (TypeError, ValueError):
            number = None
        if number is not None:
            return {"type": "const", "value": number, "display": _percent(number)}
    weight = rule.get("weight")
    if isinstance(weight, dict) and weight.get("same_as") == "counterparty_ordinary_claim":
        return {
            "type": "counterparty",
            "display": "按交易对手",
            "note": "忘掉当前产品类别，按交易对手的普通债权从最外层再分一次。",
        }
    if isinstance(weight, dict) and isinstance(weight.get("greater_of"), list):
        floor = None
        field_name = ""
        counterparty = False
        for item in weight["greater_of"]:
            if isinstance(item, bool):
                continue
            if isinstance(item, (int, float)):
                floor = float(item)
            elif isinstance(item, dict) and item.get("field"):
                field_name = str(item.get("field") or "")
            elif isinstance(item, dict) and item.get("same_as") == "counterparty_ordinary_claim":
                counterparty = True
        if field_name and not counterparty:
            shown = _percent(floor) if floor is not None else "已得权重"
            return {
                "type": "max_field",
                "display": shown + " 与已得权重较大值" if floor is not None else "与已得权重较大值",
                "with": floor,
                "field": field_name,
                "note": "取固定权重和已得权重中较大的一个。",
            }
        if floor is None:
            floor = 0.9
        return {
            "type": "max",
            "display": _percent(floor) + " 与交易对手较大值",
            "with": floor,
            "note": "取固定权重和交易对手普通债权权重中较大的一个。",
        }
    return {"type": "unspecified", "display": "权重未单列"}


def _percent(number: float) -> str:
    points = number * 100
    if abs(points - round(points)) < 1e-9:
        return str(int(round(points))) + "%"
    text = f"{points:.2f}".rstrip("0").rstrip(".")
    return text + "%"
