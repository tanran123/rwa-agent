"""根据通用流程模板 + 产品字段，让模型生成产品分类流程并标出字段缺口。"""

from __future__ import annotations

import copy
import json
from typing import Any

from rwa_agent.mapper import _complete, _extract_json


def generate_product_flow(
    product_label: str,
    product_fields: list[dict[str, Any]],
    base_flow: dict[str, Any],
) -> dict[str, Any]:
    """返回 { flow, gaps, summary, source }。模型失败时抛错，由调用方回退本地分析。"""
    compact = _compact_flow(base_flow)
    field_ids = [str(f.get("id") or "") for f in product_fields if f.get("id")]
    raw = _complete(_system(), _user(product_label, product_fields, compact))
    parsed = _extract_json(raw)
    keep_ids = set(parsed.get("keep_layers") or [])
    drop_ids = set(parsed.get("drop_layers") or [])
    aliases = parsed.get("field_aliases") if isinstance(parsed.get("field_aliases"), dict) else {}
    model_gaps = parsed.get("gaps") if isinstance(parsed.get("gaps"), list) else []

    flow = copy.deepcopy(base_flow)
    flow["ref"] = False
    flow["customized"] = True
    flow["generated_by"] = "llm"
    flow["name"] = f"{product_label} · 分类流程"
    flow["based_on"] = base_flow.get("id")
    cats = list(flow.get("categories") or [])
    if keep_ids or drop_ids:
        kept = []
        for cat in cats:
            cid = cat.get("id")
            if drop_ids and cid in drop_ids:
                continue
            if keep_ids and cid not in keep_ids and not drop_ids:
                # 仅当模型给了 keep 列表时过滤
                if keep_ids:
                    continue
            kept.append(cat)
        if kept:
            flow["categories"] = kept

    _apply_aliases(flow, aliases)
    gaps = _analyze_gaps(flow, field_ids)
    # 合并模型指出的缺口
    by_node = {g["node_id"]: g for g in gaps}
    for item in model_gaps:
        if not isinstance(item, dict):
            continue
        nid = str(item.get("node_id") or "")
        missing = [str(x) for x in (item.get("missing_fields") or []) if x]
        if not nid:
            continue
        cur = by_node.get(nid) or {
            "node_id": nid,
            "missing_fields": [],
            "note": "",
        }
        cur["missing_fields"] = sorted(set(cur["missing_fields"]) | set(missing))
        note = str(item.get("note") or "").strip()
        if note:
            cur["note"] = note
        by_node[nid] = cur
    gaps = list(by_node.values())
    _annotate_flow(flow, gaps)
    flow["field_gaps"] = gaps
    return {
        "flow": flow,
        "gaps": gaps,
        "summary": str(parsed.get("summary") or f"已按「{product_label}」字段裁剪通用流程。"),
        "source": "llm",
        "field_aliases": aliases,
    }


def analyze_flow_gaps_local(
    product_label: str,
    product_fields: list[dict[str, Any]],
    base_flow: dict[str, Any],
) -> dict[str, Any]:
    """无模型时：复制模板并标出产品字段覆盖不了的判定字段。"""
    field_ids = [str(f.get("id") or "") for f in product_fields if f.get("id")]
    flow = copy.deepcopy(base_flow)
    flow["ref"] = False
    flow["customized"] = True
    flow["generated_by"] = "local"
    flow["name"] = f"{product_label} · 分类流程"
    flow["based_on"] = base_flow.get("id")
    gaps = _analyze_gaps(flow, field_ids)
    _annotate_flow(flow, gaps)
    flow["field_gaps"] = gaps
    miss_n = len(gaps)
    summary = (
        f"已基于通用模板生成「{product_label}」流程；"
        + (f"有 {miss_n} 处节点字段未对齐，已在图上标 !。" if miss_n else "产品字段已覆盖判定所需字段。")
    )
    return {"flow": flow, "gaps": gaps, "summary": summary, "source": "local", "field_aliases": {}}


def _system() -> str:
    return (
        "你是信用风险 RWA 分类流程助手。根据「通用瀑布模板」和「产品标准字段」，"
        "为该产品生成裁剪建议。只输出一个 JSON 对象，不要解释。"
        "格式："
        '{"summary":"一句话","keep_layers":["cat:id",...],"drop_layers":["cat:id",...],'
        '"field_aliases":{"模板字段":"产品字段"},'
        '"gaps":[{"node_id":"cat:xx或sub:xx","missing_fields":["field"],"note":"原因"}]}。'
        "规则：尽量保留模板结构；产品明显用不到的层可放进 drop_layers；"
        "产品字段名与模板不一致但语义接近时写入 field_aliases；"
        "产品字段确实没有、也无法映射的判定字段写入 gaps。"
        "不要编造模板里不存在的 node_id。"
    )


def _user(product_label: str, product_fields: list[dict[str, Any]], compact: dict) -> str:
    fields = [
        {
            "id": f.get("id"),
            "label": f.get("zh") or f.get("label") or f.get("id"),
            "type": f.get("type"),
            "required": bool(f.get("required")),
        }
        for f in product_fields
    ]
    return json.dumps(
        {
            "product": product_label,
            "product_fields": fields,
            "base_flow": compact,
        },
        ensure_ascii=False,
    )


def _compact_flow(flow: dict[str, Any]) -> dict[str, Any]:
    cats = []
    for cat in flow.get("categories") or []:
        used: dict[str, bool] = {}
        _collect_fields(cat.get("match"), used)
        children = []
        for ch in cat.get("children") or []:
            ch_used: dict[str, bool] = {}
            _collect_fields(ch.get("match"), ch_used)
            _collect_fields(ch.get("formula"), ch_used)
            children.append(
                {
                    "id": ch.get("id"),
                    "label": ch.get("label"),
                    "fields": sorted(ch_used.keys()),
                    "rule_id": ch.get("rule_id") or ch.get("rule"),
                }
            )
        cats.append(
            {
                "id": cat.get("id"),
                "label": cat.get("label"),
                "question": cat.get("question"),
                "fields": sorted(used.keys()),
                "children": children,
            }
        )
    return {
        "id": flow.get("id"),
        "name": flow.get("name"),
        "categories": cats,
    }


def _collect_fields(node: Any, out: dict[str, bool]) -> None:
    if node is None:
        return
    if isinstance(node, list):
        for item in node:
            _collect_fields(item, out)
        return
    if not isinstance(node, dict):
        return
    field = node.get("field")
    if isinstance(field, str) and field:
        out[field] = True
    var = node.get("var")
    if isinstance(var, str) and var and var not in ("ead", "risk_weight", "rwa"):
        out[var] = True
    key = node.get("key")
    if isinstance(key, str) and key and node.get("lookup"):
        out[key] = True
    for k, v in node.items():
        if k in ("display", "label", "type", "id", "note", "op"):
            continue
        _collect_fields(v, out)


def _apply_aliases(flow: dict[str, Any], aliases: dict[str, Any]) -> None:
    if not aliases:
        return
    mapping = {str(k): str(v) for k, v in aliases.items() if k and v and str(k) != str(v)}

    def walk(node: Any) -> None:
        if isinstance(node, list):
            for item in node:
                walk(item)
            return
        if not isinstance(node, dict):
            return
        if isinstance(node.get("field"), str) and node["field"] in mapping:
            node["field"] = mapping[node["field"]]
        if isinstance(node.get("var"), str) and node["var"] in mapping:
            node["var"] = mapping[node["var"]]
        if isinstance(node.get("key"), str) and node["key"] in mapping:
            node["key"] = mapping[node["key"]]
        for v in node.values():
            walk(v)

    walk(flow.get("categories"))
    walk(flow.get("formulas"))


def _analyze_gaps(flow: dict[str, Any], field_ids: list[str]) -> list[dict[str, Any]]:
    have = set(field_ids)
    gaps: list[dict[str, Any]] = []
    for cat in flow.get("categories") or []:
        used: dict[str, bool] = {}
        _collect_fields(cat.get("match"), used)
        missing = sorted(f for f in used if f not in have)
        if missing:
            gaps.append(
                {
                    "node_id": cat.get("id"),
                    "missing_fields": missing,
                    "note": "产品字段未覆盖本层判定条件",
                }
            )
        for ch in cat.get("children") or []:
            ch_used: dict[str, bool] = {}
            _collect_fields(ch.get("match"), ch_used)
            _collect_fields(ch.get("formula"), ch_used)
            ch_miss = sorted(f for f in ch_used if f not in have)
            if ch_miss:
                gaps.append(
                    {
                        "node_id": ch.get("id"),
                        "missing_fields": ch_miss,
                        "note": "产品字段未覆盖本细分条件/公式",
                    }
                )
    return gaps


def _annotate_flow(flow: dict[str, Any], gaps: list[dict[str, Any]]) -> None:
    by_id = {g["node_id"]: g for g in gaps}
    for cat in flow.get("categories") or []:
        g = by_id.get(cat.get("id"))
        if g:
            cat["field_gaps"] = g["missing_fields"]
            cat["field_gap_note"] = g.get("note") or ""
        else:
            cat.pop("field_gaps", None)
            cat.pop("field_gap_note", None)
        for ch in cat.get("children") or []:
            cg = by_id.get(ch.get("id"))
            if cg:
                ch["field_gaps"] = cg["missing_fields"]
                ch["field_gap_note"] = cg.get("note") or ""
            else:
                ch.pop("field_gaps", None)
                ch.pop("field_gap_note", None)
