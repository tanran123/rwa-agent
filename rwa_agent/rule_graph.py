"""Saved layout and extra relations for the rule knowledge graph."""

from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "knowledge"
GRAPH_PATH = ROOT / "graph.json"
_ID = re.compile(r"^[a-z][a-z0-9_:-]{0,80}$")
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
    return {"positions": {}, "nodes": [], "edges": [], "routes": {}, "labels": {}}


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
    return {"positions": positions, "nodes": nodes, "edges": edges, "routes": _routes(raw), "labels": _labels(raw)}


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
