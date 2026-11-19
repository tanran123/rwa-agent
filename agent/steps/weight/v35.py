"""V3.5 STC 暴露分类 / 风险权重规则执行器。

只接收已经由产品配置和字段映射准备好的 facts，不读数据库、不调模型。
Koa 把规则文档、参数表、名单和 facts 作为 JSON 传进来，这里返回命中结果和留痕。
"""

from __future__ import annotations

import json
import math
import sys
from typing import Any


# ---------------------------------------------------------------- 基础工具

MISSING = object()


def _as_path(value: Any, prefix: str) -> Any:
    if not isinstance(value, str) or not value.startswith(prefix):
        return value
    path = value[len(prefix):]
    return None if path == "" else path


def _lookup_path(root: Any, path: str) -> Any:
    current = root
    for key in str(path or "").split("."):
        if not key:
            continue
        if isinstance(current, dict):
            current = current.get(key, MISSING)
        elif isinstance(current, list):
            try:
                current = current[int(key)]
            except (ValueError, IndexError):
                return MISSING
        else:
            return MISSING
        if current is MISSING:
            return MISSING
    return current


def _ref(value: Any, facts: dict, context: dict, result: dict | None = None) -> Any:
    if isinstance(value, str):
        if value.startswith("$input."):
            return _lookup_path(facts, value[7:])
        if value.startswith("$context."):
            return _lookup_path(context, value[9:])
        if value.startswith("$result."):
            return _lookup_path(result or {}, value[8:])
    return value


def _resolve(value: Any, facts: dict, context: dict, result: dict | None = None) -> Any:
    resolved = _ref(value, facts, context, result)
    if resolved is MISSING or resolved is None:
        return resolved
    if isinstance(resolved, dict):
        return {key: _resolve(item, facts, context, result) for key, item in resolved.items()}
    if isinstance(resolved, list):
        return [_resolve(item, facts, context, result) for item in resolved]
    return resolved


def _clean(value: Any) -> Any:
    return None if value is MISSING else value


def _jsonable(value: Any) -> Any:
    if value is MISSING:
        return None
    if isinstance(value, dict):
        return {str(key): _jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(item) for item in value]
    return value


def _number(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        text = value.replace(",", "").replace("%", "").strip()
        if text == "":
            return None
        try:
            return float(text)
        except ValueError:
            return None
    return None


def _text(value: Any) -> str:
    if value is None or value is MISSING:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value).strip()


def _same(left: Any, right: Any) -> bool:
    if isinstance(left, bool) or isinstance(right, bool):
        return left is right or str(left).lower() == str(right).lower()
    left_number = _number(left)
    right_number = _number(right)
    if left_number is not None and right_number is not None:
        return math.isclose(left_number, right_number, rel_tol=1e-9, abs_tol=1e-9)
    return _text(left) == _text(right)


def _table_lookup(tables: dict, table_id: str) -> dict | None:
    table = tables.get(table_id)
    if not isinstance(table, dict):
        return None
    return table


def _rows(table: dict | None) -> list[dict]:
    if not table:
        return []
    columns = [str(item) for item in (table.get("columns") or [])]
    rows = []
    for row in table.get("rows") or []:
        if isinstance(row, dict):
            rows.append(row)
        elif isinstance(row, list):
            rows.append({columns[index]: row[index] for index in range(min(len(columns), len(row)))})
    return rows


def _param_value(tables: dict, ref: str) -> Any:
    if not isinstance(ref, str) or "#" not in ref:
        return MISSING
    table_id, key = ref.split("#", 1)
    for row in _rows(_table_lookup(tables, table_id)):
        first = next(iter(row.values()), None)
        if _text(first) == key:
            for name in ("value", "constant_value", "数值"):
                if name in row:
                    return row[name]
            values = list(row.values())
            return values[1] if len(values) > 1 else values[0]
    return MISSING


def _list_rows(lists: dict, list_id: str) -> list[dict]:
    item = lists.get(list_id)
    if not item:
        return []
    if isinstance(item, list):
        return [row for row in item if isinstance(row, dict)]
    return _rows(item)


def _list_has(lists: dict, binding: dict, key: dict, facts: dict, context: dict) -> bool:
    list_id = str((binding or {}).get("list_id") or "")
    rows = _list_rows(lists, list_id)
    require = (binding or {}).get("require") or {}
    for row in rows:
        ok = True
        for name, expected in require.items():
            if not _same(row.get(name), _resolve(expected, facts, context)):
                ok = False
                break
        if not ok:
            continue
        for name, expected in key.items():
            actual = _resolve(expected, facts, context)
            if actual is MISSING or not _same(row.get(name), actual):
                ok = False
                break
        if ok:
            return True
    return False


# ---------------------------------------------------------------- 条件

def eval_condition(condition: Any, facts: dict, context: dict, tables: dict, lists: dict) -> dict:
    if condition is None:
        return {"ok": True, "missing": [], "trace": []}
    if not isinstance(condition, dict):
        return {"ok": False, "missing": [], "trace": [{"kind": "invalid", "value": condition}]}
    if "all" in condition or "any" in condition:
        kind = "all" if "all" in condition else "any"
        items = condition.get(kind) if isinstance(condition.get(kind), list) else []
        parts = [eval_condition(item, facts, context, tables, lists) for item in items if isinstance(item, dict)]
        if kind == "all":
            ok = all(item["ok"] for item in parts) if parts else True
        else:
            ok = any(item["ok"] for item in parts)
        missing = [name for item in parts for name in item.get("missing", [])]
        return {"ok": ok, "missing": sorted(set(missing)), "trace": [{"kind": kind, "items": parts}]}
    if "not" in condition:
        part = eval_condition(condition.get("not"), facts, context, tables, lists)
        return {"ok": not part["ok"], "missing": part.get("missing", []), "trace": [{"kind": "not", "item": part}]}
    if "list_check" in condition:
        check = condition.get("list_check") or {}
        key = check.get("key") or {}
        missing = [name for name, value in key.items() if _resolve(value, facts, context) is MISSING]
        include = check.get("include") or []
        exclude = check.get("exclude") or []
        include_hit = any(_list_has(lists, binding, key, facts, context) for binding in include) if include else False
        exclude_hit = any(_list_has(lists, binding, key, facts, context) for binding in exclude) if exclude else False
        ok = include_hit and not exclude_hit
        return {
            "ok": ok,
            "missing": missing,
            "trace": [{"kind": "list_check", "key": key, "include": include, "exclude": exclude,
                       "includeHit": include_hit, "excludeHit": exclude_hit, "ok": ok}],
        }

    field = str(condition.get("field") or "")
    op = str(condition.get("op") or "eq")
    if not field:
        return {"ok": False, "missing": [], "trace": [{"kind": "invalid", "value": condition}]}
    actual = _ref(facts.get(field, MISSING), facts, context)
    if actual is MISSING:
        actual = _ref(context.get(field, MISSING), facts, context)
    match = condition.get("match")
    if condition.get("param_ref"):
        match = _param_value(tables, str(condition.get("param_ref")))
    elif condition.get("lower") is not None or condition.get("upper") is not None:
        match = [condition.get("lower"), condition.get("upper")]
    else:
        match = _resolve(match, facts, context)
    missing = [] if actual is not MISSING and actual is not None and actual != "" else [field]

    if op == "exists":
        ok = actual is not MISSING and actual is not None and actual != ""
    elif op == "is_null":
        ok = actual is MISSING or actual is None or actual == ""
    elif actual is MISSING or actual is None or actual == "":
        ok = False
    elif op == "eq":
        ok = _same(actual, match)
    elif op == "neq":
        ok = not _same(actual, match)
    elif op == "in":
        values = match if isinstance(match, list) else [match]
        ok = any(_same(actual, item) for item in values)
    elif op == "not_in":
        values = match if isinstance(match, list) else [match]
        ok = not any(_same(actual, item) for item in values)
    elif op == "contains":
        haystack = actual if isinstance(actual, list) else _text(actual).split(",")
        ok = any(_same(item, match) for item in haystack)
    elif op == "not_contains":
        haystack = actual if isinstance(actual, list) else _text(actual).split(",")
        ok = not any(_same(item, match) for item in haystack)
    elif op in ("lt", "lte", "gt", "gte"):
        left = _number(actual)
        right = _number(match)
        if left is None or right is None:
            ok = False
        elif op == "lt":
            ok = left < right
        elif op == "lte":
            ok = left <= right
        elif op == "gt":
            ok = left > right
        else:
            ok = left >= right
    elif op == "between":
        left = _number(actual)
        values = match if isinstance(match, list) else [condition.get("lower"), condition.get("upper")]
        low = _number(values[0]) if len(values) > 0 else None
        high = _number(values[1]) if len(values) > 1 else None
        ok = left is not None and low is not None and high is not None and low <= left <= high
    else:
        ok = False
    return {
        "ok": ok,
        "missing": missing,
        "trace": [{"kind": "condition", "field": field, "op": op, "match": _clean(match),
                   "actual": _clean(actual), "missing": missing, "ok": ok}],
    }


# ---------------------------------------------------------------- 字段派生

class Runtime:
    def __init__(self, doc: dict, facts: dict, tables: dict, lists: dict):
        self.doc = doc or {}
        self.facts = {key: value for key, value in (facts or {}).items() if value is not None}
        self.context: dict[str, Any] = {}
        self.tables = tables or {}
        self.lists = lists or {}
        self.fields = {}
        for field in self.doc.get("fields") or []:
            if isinstance(field, dict) and field.get("name"):
                self.fields[str(field["name"])] = field
        self.derived: dict[str, Any] = {}
        self.derivation_trace: list[dict] = []
        self.table_trace: list[dict] = []
        self.list_trace: list[dict] = []
        self.unknown_fields: set[str] = set()

    def value(self, name: str, resolving: set | None = None) -> Any:
        if name in self.context:
            return self.context[name]
        if name in self.facts and self.facts[name] not in (None, ""):
            return self.facts[name]
        if name in self.derived:
            return self.derived[name]
        field = self.fields.get(name)
        derivation = (field or {}).get("derivation")
        if not derivation:
            return self.facts.get(name, MISSING)
        resolving = set(resolving or set())
        if name in resolving:
            return MISSING
        resolving.add(name)
        value = self.derive(name, derivation, resolving)
        self.derived[name] = value
        return value

    def derive(self, name: str, derivation: dict, resolving: set) -> Any:
        kind = str(derivation.get("kind") or "")
        trace = {"field": name, "kind": kind}
        value = MISSING
        if kind == "cases":
            missing = []
            for item in derivation.get("cases") or []:
                check = eval_condition(item.get("when"), self.facts, self.context, self.tables, self.lists)
                missing.extend(check.get("missing", []))
                if check["ok"]:
                    value = item.get("value")
                    trace.update({"matched": item.get("value"), "condition": check})
                    break
            if value is MISSING:
                if "default" in derivation:
                    value = derivation.get("default")
                    trace["default"] = value
                else:
                    value = None
                    trace["unknown"] = True
            if missing:
                self.unknown_fields.update(missing)
            trace["missing"] = sorted(set(missing))
        elif kind == "criteria":
            check = eval_condition(derivation.get("when"), self.facts, self.context, self.tables, self.lists)
            trace["condition"] = check
            if check["ok"]:
                value = True
            elif check.get("missing"):
                self.unknown_fields.update(check.get("missing", []))
                value = None
                trace["unknown"] = True
            else:
                value = False
        elif kind == "threshold":
            actual = self.value(str(derivation.get("input") or ""), resolving)
            ref = derivation.get("parameter_ref")
            target = _param_value(self.tables, str(ref)) if ref else derivation.get("value")
            left = _number(actual)
            right = _number(target)
            op = str(derivation.get("op") or "lte")
            if left is None or right is None:
                value = None
                trace["unknown"] = True
            else:
                hit = {
                    "lt": left < right, "lte": left <= right,
                    "gt": left > right, "gte": left >= right,
                }.get(op, False)
                value = derivation.get("true_value") if hit else derivation.get("false_value")
            trace.update({"input": actual, "target": target, "op": op, "value": _clean(value)})
        elif kind == "band":
            actual = _number(self.value(str(derivation.get("input") or ""), resolving))
            rows = _rows(_table_lookup(self.tables, str(derivation.get("bands_table") or "")))
            value = None
            for row in rows:
                low = _number(row.get("lower_exclusive"))
                high = _number(row.get("upper_inclusive"))
                if actual is None or low is None or high is None:
                    continue
                if low < actual <= high:
                    value = row.get("band_code")
                    trace["matched"] = row
                    break
            if value is None:
                value = derivation.get("default")
            trace["input"] = actual
        elif kind == "table_lookup":
            key = derivation.get("key") or {}
            resolved = {name: _resolve(value, self.facts, self.context) for name, value in key.items()}
            table_id = str(derivation.get("table_id") or "")
            rows = _rows(_table_lookup(self.tables, table_id))
            matched = None
            for row in rows:
                if all(_same(row.get(name), expected) for name, expected in resolved.items()):
                    matched = row
                    break
            self.table_trace.append({"table_id": table_id, "key": resolved, "matched": matched})
            if matched is not None:
                value = matched.get(str(derivation.get("value_field") or ""))
            else:
                missing = [name for name, expected in resolved.items() if expected is MISSING or expected is None or expected == ""]
                if missing:
                    self.unknown_fields.update(missing)
                on_missing = str(derivation.get("on_missing") or "unknown")
                value = None if on_missing == "unknown" else on_missing
                trace["missing"] = missing
        elif kind == "list_lookup":
            key = {name: _resolve(value, self.facts, self.context) for name, value in (derivation.get("key") or {}).items()}
            value = derivation.get("default")
            for item in derivation.get("map") or []:
                list_id = str(item.get("list_id") or "")
                rows = _list_rows(self.lists, list_id)
                hit = any(all(_same(row.get(name), expected) for name, expected in key.items()) for row in rows)
                self.list_trace.append({"list_id": list_id, "key": key, "hit": hit})
                if hit:
                    value = item.get("value")
                    break
            trace["value"] = value
        elif kind == "list_membership":
            key = {name: _resolve(value, self.facts, self.context) for name, value in (derivation.get("key") or {}).items()}
            include = derivation.get("include") or []
            exclude = derivation.get("exclude") or []
            include_hit = any(_list_has(self.lists, binding, key, self.facts, self.context) for binding in include)
            exclude_hit = any(_list_has(self.lists, binding, key, self.facts, self.context) for binding in exclude)
            value = include_hit and not exclude_hit
            trace.update({"include": include_hit, "exclude": exclude_hit, "value": value})
        else:
            value = None
            trace["unsupported"] = kind
        self.derivation_trace.append(trace)
        return value


# ---------------------------------------------------------------- 规则树

def _result_value(result: Any, runtime: Runtime) -> Any:
    if isinstance(result, dict):
        return {key: _resolve(item, runtime.facts, runtime.context) for key, item in result.items()}
    return _resolve(result, runtime.facts, runtime.context)


def _apply_lookup(node: dict, runtime: Runtime, stmt: Any) -> None:
    lookup = node.get("parameter_lookup") if stmt is None else stmt
    if not isinstance(lookup, dict):
        return
    table_id = str(lookup.get("table_id") or "")
    key = {name: _resolve(value, runtime.facts, runtime.context) for name, value in (lookup.get("key") or {}).items()}
    rows = _rows(_table_lookup(runtime.tables, table_id))
    matched = None
    for row in rows:
        if all(_same(row.get(name), expected) for name, expected in key.items()):
            matched = row
            break
    runtime.table_trace.append({"table_id": table_id, "key": key, "matched": matched, "assign_to": lookup.get("assign_to")})
    target = str(lookup.get("assign_to") or "")
    if matched is not None and target.startswith("$context."):
        _assign_context(runtime.context, target[9:], matched)
    elif matched is not None and target.startswith("$input."):
        runtime.facts[target[7:]] = matched


def _assign_context(context: dict, path: str, value: Any) -> None:
    keys = [key for key in path.split(".") if key]
    if not keys:
        return
    current = context
    for key in keys[:-1]:
        if not isinstance(current.get(key), dict):
            current[key] = {}
        current = current[key]
    current[keys[-1]] = value


def _apply_set(node: dict, runtime: Runtime) -> None:
    assignments = node.get("set")
    if isinstance(assignments, dict):
        assignments = [assignments]
    for item in assignments or []:
        if not isinstance(item, dict):
            continue
        target = str(item.get("target") or item.get("assign_to") or "")
        value = _resolve(item.get("value"), runtime.facts, runtime.context)
        if target.startswith("$context."):
            _assign_context(runtime.context, target[9:], value)
        elif target.startswith("$input."):
            runtime.facts[target[7:]] = value


def _apply_adjustments(node: dict, weight: Any, runtime: Runtime) -> tuple[Any, list]:
    applied = []
    if weight is None:
        return weight, applied
    try:
        value = float(weight)
    except (TypeError, ValueError):
        return weight, applied
    for adjustment in node.get("adjustments") or []:
        if adjustment.get("target") not in (None, "result.risk_weight"):
            continue
        check = eval_condition(adjustment.get("when"), runtime.facts, runtime.context, runtime.tables, runtime.lists)
        if not check["ok"]:
            continue
        op = str(adjustment.get("operation") or "")
        amount = _resolve(adjustment.get("value"), runtime.facts, runtime.context)
        before = value
        if op == "set" and _number(amount) is not None:
            value = _number(amount)
        elif op == "floor" and _number(amount) is not None:
            value = max(value, _number(amount))
        elif op == "cap" and _number(amount) is not None:
            value = min(value, _number(amount))
        elif op == "add" and _number(amount) is not None:
            value += _number(amount)
        elif op == "multiply" and _number(amount) is not None:
            value *= _number(amount)
        elif op == "ladder_floor":
            floor = None
            for step in adjustment.get("ladder") or []:
                step_check = eval_condition(step.get("when"), runtime.facts, runtime.context, runtime.tables, runtime.lists)
                if step_check["ok"]:
                    floor = _number(step.get("value"))
                    break
            if floor is not None:
                value = max(value, floor)
        else:
            continue
        applied.append({
            "adjustment_id": adjustment.get("adjustment_id"),
            "label": adjustment.get("label"),
            "operation": op,
            "before": before,
            "after": value,
            "when": check.get("trace", []),
        })
    return value, applied


def _eval_layer(nodes: list, runtime: Runtime, path: list, trace: list) -> dict | None:
    for node in nodes or []:
        if not isinstance(node, dict):
            continue
        node_path = path + [str(node.get("id") or "")]
        skip = eval_condition(node.get("skip"), runtime.facts, runtime.context, runtime.tables, runtime.lists) if node.get("skip") else None
        if skip and skip["ok"]:
            trace.append({"id": node.get("id"), "label": node.get("label"), "path": node_path, "skipped": True, "skip": skip["trace"]})
            continue
        check = eval_condition(node.get("when"), runtime.facts, runtime.context, runtime.tables, runtime.lists)
        entry = {
            "id": node.get("id"),
            "label": node.get("label"),
            "path": node_path,
            "condition": check.get("trace", []),
            "missing": check.get("missing", []),
            "matched": check["ok"],
        }
        trace.append(entry)
        if not check["ok"]:
            continue
        _apply_lookup(node, runtime, None)
        _apply_set(node, runtime)
        children = node.get("children") or []
        if children:
            child = _eval_layer(children, runtime, node_path, trace)
            if child:
                return child
            other = node.get("otherwise")
            if isinstance(other, dict):
                child = _eval_layer([other], runtime, node_path + ["otherwise"], trace)
                if child:
                    return child
            if node.get("result") is not None:
                entry["result"] = _result_value(node.get("result"), runtime)
                return entry
            entry["exhausted"] = True
            return entry
        if node.get("result") is not None:
            result = _result_value(node.get("result"), runtime)
            if isinstance(result, dict) and "risk_weight" in result:
                weight, applied = _apply_adjustments(node, result.get("risk_weight"), runtime)
                result["risk_weight"] = weight
                result["adjustments"] = applied
            entry["result"] = result
            return entry
        other = node.get("otherwise")
        if isinstance(other, dict):
            child = _eval_layer([other], runtime, node_path + ["otherwise"], trace)
            if child:
                return child
        entry["exhausted"] = True
        return entry
    return None


def _fallback(runtime: Runtime, trace: list) -> dict | None:
    other = runtime.doc.get("otherwise")
    if isinstance(other, dict):
        if other.get("when") is not None:
            check = eval_condition(other.get("when"), runtime.facts, runtime.context, runtime.tables, runtime.lists)
            if not check["ok"]:
                return None
        result = _result_value(other, runtime)
        if isinstance(result, dict) and "risk_weight" in result:
            weight, applied = _apply_adjustments(other, result.get("risk_weight"), runtime)
            result["risk_weight"] = weight
            result["adjustments"] = applied
        trace.append({"id": other.get("id"), "label": other.get("label"), "path": ["otherwise"],
                      "condition": [], "matched": True, "fallback": True})
        return {"id": other.get("id") or "otherwise", "label": other.get("label") or "兜底",
                "path": ["otherwise"], "condition": [], "result": result, "fallback": True}
    if "exposure_class" in runtime.doc:
        return {"id": "otherwise", "label": runtime.doc.get("label") or "兜底",
                "path": ["otherwise"], "condition": [], "result": runtime.doc}
    return None


def _normalise_result(doc: dict, matched: dict | None, runtime: Runtime, kind: str) -> dict:
    if not matched:
        fallback = doc.get("otherwise")
        if isinstance(fallback, dict):
            matched = {"id": fallback.get("id") or "otherwise", "label": fallback.get("label") or "兜底",
                       "path": ["otherwise"], "condition": [], "result": _result_value(fallback, runtime),
                       "fallback": True}
    result = matched.get("result") if matched else None
    if isinstance(result, dict):
        payload = result
    elif kind == "risk_weight" and result is not None:
        payload = {"risk_weight": result}
    else:
        payload = {"exposure_class": result} if result is not None else {}
    if kind == "exposure_classification":
        exposure_class = payload.get("exposure_class")
        label = payload.get("label") or payload.get("exposure_class_label")
        if not label and exposure_class:
            label = exposure_class
        weight = None
    else:
        exposure_class = None
        label = payload.get("label")
        weight = payload.get("risk_weight")
        try:
            if weight is not None and not isinstance(weight, bool):
                weight = float(weight)
        except (TypeError, ValueError):
            weight = None
    missing = sorted(set(runtime.unknown_fields) | {field for field in runtime.facts if runtime.facts[field] is MISSING})
    return {
        "kind": kind,
        "matched": bool(matched),
        "ruleId": matched.get("id") if matched else "",
        "ruleLabel": matched.get("label") if matched else "",
        "path": " → ".join(str(item) for item in (matched.get("path") if matched else []) if item),
        "exposureClass": exposure_class,
        "exposureClassLabel": label or exposure_class or "",
        "category": payload.get("category") or "",
        "attributes": payload.get("attributes") or {},
        "note": payload.get("note") or "",
        "riskWeight": weight,
        "riskWeightText": (str(weight) + "%") if weight is not None else "",
        "manualReview": weight is None if kind == "risk_weight" else False,
        "missingFields": missing,
        "conditionTrace": runtime.derivation_trace + (matched.get("condition") if matched else []),
        "ruleTrace": matched.get("condition") if matched else [],
        "derivations": runtime.derivation_trace,
        "tableTrace": runtime.table_trace,
        "listTrace": runtime.list_trace,
        "adjustments": payload.get("adjustments") or [],
        "facts": {key: _clean(value) for key, value in runtime.facts.items()},
        "context": runtime.context,
    }


def _prepare_facts(doc: dict, facts: dict, tables: dict, lists: dict) -> dict:
    """反复计算派生字段，直到 facts 稳定。

    规则条件里会引用派生字段（例如 obligor_type、credit_quality_level），
    而这些字段又可能依赖另一个派生字段，所以不能只算一遍。
    """
    current = {key: value for key, value in (facts or {}).items() if value is not None}
    field_count = len([item for item in (doc.get("fields") or []) if isinstance(item, dict) and item.get("derivation")])
    for _ in range(max(2, field_count + 1)):
        runtime = Runtime(doc, current, tables, lists)
        changed = False
        for name, field in runtime.fields.items():
            if not field.get("derivation"):
                continue
            value = runtime.value(name)
            if value is None or value is MISSING:
                continue
            if current.get(name) != value:
                changed = True
            current[name] = value
            runtime.facts[name] = value
        if not changed:
            break
    return current


def evaluate(payload: dict) -> dict:
    doc = payload.get("doc") or {}
    facts = payload.get("facts") or {}
    tables = payload.get("tables") or {}
    lists = payload.get("lists") or {}
    kind = str(payload.get("kind") or doc.get("rule_type") or "exposure_classification")
    prepared = _prepare_facts(doc, facts, tables, lists)
    runtime = Runtime(doc, prepared, tables, lists)
    # 再算一遍，保留派生字段的求值留痕。
    for name, field in runtime.fields.items():
        if not field.get("derivation"):
            continue
        value = runtime.derive(name, field.get("derivation"), set())
        runtime.derived[name] = value
        if value is not None and value is not MISSING:
            runtime.facts[name] = value
    trace = []
    matched = _eval_layer(doc.get("rules") or [], runtime, [], trace)
    if matched is None:
        matched = _fallback(runtime, trace)
    normal = _normalise_result(doc, matched, runtime, kind)
    normal["trace"] = trace
    normal["ruleType"] = kind
    return _jsonable(normal)


if __name__ == "__main__":
    try:
        payload = json.load(sys.stdin)
        print(json.dumps(evaluate(payload), ensure_ascii=False))
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"error": str(exc)}, ensure_ascii=False))
        sys.exit(1)
