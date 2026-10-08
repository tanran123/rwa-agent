"""Saved layout and extra relations for the rule knowledge graph."""

from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "knowledge"
GRAPH_PATH = ROOT / "graph.json"
_ID = re.compile(r"^[a-z][a-z0-9_:-]{0,80}$")
_USER_CAT = re.compile(r"^user:[a-z0-9]{1,24}$")
_ROUTE = re.compile(r"^[a-z][a-z0-9_:-]{0,120}$")


def load_graph() -> dict:
    if not GRAPH_PATH.is_file():
        return _empty()
    try:
        raw = json.loads(GRAPH_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return _empty()
    if not isinstance(raw, dict):
        return _empty()
    return _clean(raw)


def save_graph(payload: object) -> dict:
    if not isinstance(payload, dict):
        raise ValueError("图谱格式无效")
    cleaned = _clean(payload)
    GRAPH_PATH.parent.mkdir(parents=True, exist_ok=True)
    GRAPH_PATH.write_text(json.dumps(cleaned, ensure_ascii=False, indent=2), encoding="utf-8")
    return cleaned


def _empty() -> dict:
    return {"positions": {}, "nodes": [], "edges": [], "routes": {}, "labels": {}, "rules": [], "categories": [], "stepLogic": []}


def _clean(raw: dict) -> dict:
    positions = {}
    incoming = raw.get("positions") if isinstance(raw.get("positions"), dict) else {}
    for key, value in list(incoming.items())[:400]:
        if not isinstance(key, str) or not _ID.match(key) or not isinstance(value, dict):
            continue
        try:
            x = float(value.get("x"))
            y = float(value.get("y"))
        except (TypeError, ValueError):
            continue
        positions[key] = {"x": _clamp(x), "y": _clamp(y)}

    nodes = []
    incoming_nodes = raw.get("nodes") if isinstance(raw.get("nodes"), list) else []
    for item in incoming_nodes[:40]:
        if not isinstance(item, dict):
            continue
        node_id = str(item.get("id") or "")
        if not node_id.startswith("custom:") or not _ID.match(node_id):
            continue
        role = str(item.get("role") or "knowledge")
        if role not in {"knowledge", "step", "param"}:
            role = "knowledge"
        fallback = {"step": "新步骤", "param": "新参数"}.get(role, "知识点")
        nodes.append(
            {
                "id": node_id,
                "role": role,
                "label": str(item.get("label") or fallback).strip()[:40] or fallback,
                "note": str(item.get("note") or "").strip()[:200],
            }
        )

    edges = []
    incoming_edges = raw.get("edges") if isinstance(raw.get("edges"), list) else []
    for item in incoming_edges[:80]:
        if not isinstance(item, dict):
            continue
        edge_id = str(item.get("id") or "")
        source = str(item.get("from") or "")
        target = str(item.get("to") or "")
        if not edge_id.startswith("link:") or not _ID.match(edge_id):
            continue
        if not _ID.match(source) or not _ID.match(target) or source == target:
            continue
        edges.append(
            {
                "id": edge_id,
                "from": source,
                "to": target,
                "label": str(item.get("label") or "相关").strip()[:40] or "相关",
            }
        )
    return {
        "positions": positions,
        "nodes": nodes,
        "edges": edges,
        "routes": _routes(raw),
        "labels": _labels(raw),
        "rules": _rules(raw),
        "categories": _categories(raw),
        "stepLogic": _step_logic(raw),
    }


def _categories(raw: dict) -> list[dict]:
    found = []
    seen = set()
    incoming = raw.get("categories") if isinstance(raw.get("categories"), list) else []
    for item in incoming[:12]:
        if not isinstance(item, dict):
            continue
        cat_id = str(item.get("id") or "")
        if not cat_id.startswith("cat:user:") or not _ID.match(cat_id) or cat_id in seen:
            continue
        key = cat_id[4:]
        if not _USER_CAT.match(key):
            continue
        seen.add(cat_id)
        found.append({"id": cat_id, "label": str(item.get("label") or "新类别").strip()[:40] or "新类别"})
    return found


def _param_list(raw: object) -> list[dict]:
    params = []
    seen = set()
    incoming = raw if isinstance(raw, list) else []
    for param in incoming:
        if not isinstance(param, dict):
            continue
        param_id = str(param.get("id") or "")
        if not re.fullmatch(r"p[a-z0-9]{1,12}", param_id) or param_id in seen:
            continue
        seen.add(param_id)
        kind = str(param.get("kind") or "number")
        if kind not in {"number", "percent", "text", "table"}:
            kind = "number"
        value = str(param.get("value") or "").strip()[:80]
        if kind == "table" and value not in {"standard", "assets", "ratings", "ccf"}:
            value = ""
        params.append(
            {
                "id": param_id,
                "label": str(param.get("label") or "参数").strip()[:40] or "参数",
                "kind": kind,
                "value": value,
            }
        )
        if len(params) == 8:
            break
    return params


def _field_list(raw: object) -> list[dict]:
    fields = []
    seen = set()
    incoming = raw if isinstance(raw, list) else []
    for field in incoming:
        if not isinstance(field, dict):
            continue
        field_id = str(field.get("id") or "")
        if not re.fullmatch(r"f[a-z0-9]{1,12}", field_id) or field_id in seen:
            continue
        seen.add(field_id)
        table = str(field.get("table") or "").strip()
        if table not in {"standard", "assets", "ratings", "ccf"}:
            table = ""
        fields.append({
            "id": field_id,
            "label": str(field.get("label") or "字段").strip()[:40] or "字段",
            "table": table,
        })
        if len(fields) == 8:
            break
    return fields


def _line_list(raw: object) -> list[str]:
    lines = []
    incoming = raw if isinstance(raw, list) else []
    for line in incoming:
        text = str(line or "").strip()[:120]
        if text:
            lines.append(text)
        if len(lines) == 4:
            break
    return lines


def _field_tables(raw: object) -> dict:
    tables = {}
    if not isinstance(raw, dict):
        return tables
    for key, value in list(raw.items())[:24]:
        field_id = str(key or "")
        if not re.fullmatch(r"^[a-z][a-z0-9_]{1,40}$", field_id):
            continue
        table = str(value or "").strip()
        if table not in {"standard", "assets", "ratings", "ccf"}:
            continue
        tables[field_id] = table
    return tables


def _field_names(raw: object) -> dict:
    names = {}
    if not isinstance(raw, dict):
        return names
    for key, value in list(raw.items())[:24]:
        field_id = str(key or "")
        if not re.fullmatch(r"^[a-z][a-z0-9_]{1,40}$", field_id):
            continue
        label = str(value or "").strip()[:40]
        if label:
            names[field_id] = label
    return names


def _setup_list(raw: object) -> list[dict]:
    rows = []
    if not isinstance(raw, list):
        return rows
    field_id = re.compile(r"^[a-z][a-z0-9_]{1,40}$")
    for item in raw[:6]:
        if not isinstance(item, dict):
            continue
        fields = []
        for value in item.get("fields") or []:
            token = str(value or "")
            if field_id.fullmatch(token) and token not in fields:
                fields.append(token)
            if len(fields) == 4:
                break
        params = []
        incoming = item.get("params")
        if isinstance(item.get("param"), str):
            incoming = [item.get("param")]
        if not isinstance(incoming, list):
            incoming = []
        for value in incoming:
            token = str(value or "")
            if field_id.fullmatch(token) and token not in params:
                params.append(token)
            if len(params) == 4:
                break
        table = str(item.get("table") or "").strip()
        if table not in {"standard", "assets", "ratings", "ccf"}:
            table = ""
        rows.append({"fields": fields, "params": params, "table": table})
    return rows


def _step_logic(raw: dict) -> list[dict]:
    found = []
    seen = set()
    incoming = raw.get("stepLogic") if isinstance(raw.get("stepLogic"), list) else []
    pack_id = re.compile(r"^[a-z][a-z0-9_]{1,40}$")
    for item in incoming[:40]:
        if not isinstance(item, dict):
            continue
        pack = str(item.get("pack") or "")
        try:
            index = int(item.get("index"))
        except (TypeError, ValueError):
            continue
        key = pack + ":" + str(index)
        if not pack_id.match(pack) or index < 0 or index > 5 or key in seen:
            continue
        seen.add(key)
        found.append({
            "pack": pack,
            "index": index,
            "params": _param_list(item.get("params")),
            "lines": _line_list(item.get("lines")),
            "fields": _field_list(item.get("fields")),
            "formula": _line_list(item.get("formula")),
            "tables": _field_tables(item.get("tables")),
            "names": _field_names(item.get("names")),
            "setup": _setup_list(item.get("setup")),
        })
    return found


def _labels(raw: dict) -> dict:
    labels = {}
    incoming = raw.get("labels") if isinstance(raw.get("labels"), dict) else {}
    for key, value in list(incoming.items())[:200]:
        if not isinstance(key, str) or not _ROUTE.match(key):
            continue
        text = str(value or "").strip()[:40]
        if text:
            labels[key] = text
    return labels


def _rules(raw: dict) -> list[dict]:
    rules = []
    incoming = raw.get("rules") if isinstance(raw.get("rules"), list) else []
    seen = set()
    for item in incoming[:24]:
        if not isinstance(item, dict):
            continue
        rule_id = str(item.get("id") or "")
        if not rule_id.startswith("user:") or not _ID.match(rule_id) or rule_id in seen:
            continue
        seen.add(rule_id)
        category = str(item.get("category") or "")
        if category not in {"credit", "market"} and not _USER_CAT.match(category):
            category = "credit"
        title = str(item.get("title") or "新规则").strip()[:40] or "新规则"
        basis = str(item.get("basis") or "").strip()[:500]
        lines = []
        for line in item.get("lines") if isinstance(item.get("lines"), list) else []:
            text = str(line or "").strip()[:120]
            if text:
                lines.append(text)
            if len(lines) == 4:
                break
        steps = []
        for step in item.get("steps") if isinstance(item.get("steps"), list) else []:
            if not isinstance(step, dict):
                continue
            steps.append(
                {
                    "title": str(step.get("title") or "步骤").strip()[:40] or "步骤",
                    "line": str(step.get("line") or "").strip()[:200],
                    "params": _param_list(step.get("params")),
                    "lines": _line_list(step.get("lines")),
                    "fields": _field_list(step.get("fields")),
                    "formula": _line_list(step.get("formula")),
                }
            )
            if len(steps) == 6:
                break
        params = _param_list(item.get("params"))
        rules.append(
            {
                "id": rule_id,
                "category": category,
                "title": title,
                "basis": basis,
                "showFormula": item.get("showFormula") is True,
                "lines": lines or ["待填写的计算公式"],
                "steps": steps or [{"title": "第一步", "line": ""}],
                "params": params,
            }
        )
    return rules


def _routes(raw: dict) -> dict:
    routes = {}
    incoming = raw.get("routes") if isinstance(raw.get("routes"), dict) else {}
    for key, value in list(incoming.items())[:200]:
        if not isinstance(key, str) or not _ROUTE.match(key) or not isinstance(value, list):
            continue
        points = []
        for point in value[:8]:
            if not isinstance(point, dict):
                continue
            try:
                x = float(point.get("x"))
                y = float(point.get("y"))
            except (TypeError, ValueError):
                continue
            points.append({"x": _clamp(x), "y": _clamp(y)})
        if points:
            routes[key] = points
    return routes


def _clamp(value: float) -> float:
    return max(-2000.0, min(8000.0, round(value, 1)))
