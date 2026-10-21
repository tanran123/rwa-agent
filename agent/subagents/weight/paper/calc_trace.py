"""把一笔计算拆成可倒查的步骤，并写成 JSON 和「计算留痕」表。"""

from __future__ import annotations

import json
import re
from datetime import datetime
from pathlib import Path
from typing import Any

from agent.paths import REPO

TRACE_DIR = REPO / "output" / "traces"

OP_LABEL = {
    "eq": "等于",
    "neq": "不等于",
    "in": "属于",
    "contains": "包含",
    "gt": "大于",
    "gte": "大于等于",
    "lt": "小于",
    "lte": "小于等于",
}

TRACE_HEADERS = ["来源表", "源表行", "名称", "序号", "阶段", "步骤", "规则", "字段", "比较", "规则值", "实际值", "命中", "结果", "说明"]


def show_value(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, list):
        return ", ".join(show_value(item) for item in value)
    if isinstance(value, bool):
        return "yes" if value else "no"
    if isinstance(value, float):
        if abs(value - round(value)) < 1e-9:
            return str(int(round(value)))
        text = f"{value:.6f}".rstrip("0").rstrip(".")
        return text
    return str(value)


def step(
    stage: str,
    title: str,
    *,
    field: str = "",
    op: str = "",
    expected: Any = "",
    actual: Any = "",
    hit: bool | None = None,
    result: Any = "",
    note: str = "",
    rule: str = "",
) -> dict[str, Any]:
    return {
        "stage": stage,
        "title": title,
        "rule": rule,
        "field": field,
        "op": OP_LABEL.get(op, op),
        "expected": show_value(expected),
        "actual": show_value(actual),
        "hit": hit,
        "result": show_value(result),
        "note": note,
    }


def number_steps(steps: list[dict[str, Any]]) -> list[dict[str, Any]]:
    numbered = []
    for index, item in enumerate(steps, 1):
        if not isinstance(item, dict):
            continue
        numbered.append({
            "seq": index,
            "stage": str(item.get("stage") or ""),
            "title": str(item.get("title") or ""),
            "rule": str(item.get("rule") or ""),
            "field": str(item.get("field") or ""),
            "op": str(item.get("op") or ""),
            "expected": show_value(item.get("expected")),
            "actual": show_value(item.get("actual")),
            "hit": item.get("hit") if isinstance(item.get("hit"), bool) else None,
            "result": show_value(item.get("result")),
            "note": str(item.get("note") or ""),
        })
    return numbered


def condition_steps(match: object, facts: dict[str, Any], title: str, hit_of, rule: str = "") -> list[dict[str, Any]]:
    """把命中节点上的条件摊平。hit_of(cond) 用调用方的比较函数。"""
    found: list[dict[str, Any]] = []

    def walk(node: object) -> None:
        if not isinstance(node, dict):
            return
        if isinstance(node.get("all"), list):
            for item in node["all"]:
                walk(item)
            return
        if isinstance(node.get("any"), list):
            for item in node["any"]:
                walk(item)
            return
        field = node.get("field")
        if not field:
            return
        expected = node.get("value") if node.get("value") is not None else node.get("match")
        found.append(step(
            "分类",
            title,
            rule=rule,
            field=str(field),
            op=str(node.get("op") or "eq"),
            expected=expected,
            actual=facts.get(field, ""),
            hit=bool(hit_of(node)),
        ))

    walk(match)
    return found


def trace_records(rows: list[dict[str, Any]]) -> list[list[Any]]:
    """一行计算对应留痕表里的多行，按源表行和序号排好。"""
    records = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        steps = number_steps(row.get("steps") or [])
        if not steps and row.get("trace"):
            steps = number_steps([step("分类", str(row.get("exposure") or ""), note=str(row.get("trace")), hit=True)])
        for item in steps:
            hit = item.get("hit")
            records.append([
                str(row.get("sheet") or ""),
                row.get("excel_row") if isinstance(row.get("excel_row"), int) else None,
                str(row.get("name") or ""),
                item["seq"],
                item["stage"],
                item["title"],
                item["rule"],
                item["field"],
                item["op"],
                item["expected"],
                item["actual"],
                "命中" if hit is True else ("未命中" if hit is False else ""),
                item["result"],
                item["note"],
            ])
    return records


def write_trace_sheet(book, rows: list[dict[str, Any]]) -> None:
    from openpyxl.styles import Font, PatternFill

    if "计算留痕" in book.sheetnames:
        del book["计算留痕"]
    sheet = book.create_sheet("计算留痕")
    sheet.append(TRACE_HEADERS)
    fill = PatternFill("solid", fgColor="1A5F4A")
    font = Font(bold=True, color="FFFFFF")
    for cell in sheet[1]:
        cell.font = font
        cell.fill = fill
    for record in trace_records(rows):
        sheet.append(record)
    sheet.auto_filter.ref = sheet.dimensions
    sheet.freeze_panes = "A2"


def save_trace_file(name: str, rows: list[dict[str, Any]]) -> Path:
    TRACE_DIR.mkdir(parents=True, exist_ok=True)
    stem = re.sub(r"[^\w\u4e00-\u9fff.-]+", "_", Path(name or "计算").stem).strip("._") or "计算"
    payload = {
        "file": name,
        "saved_at": datetime.now().isoformat(timespec="seconds"),
        "rows": [],
    }
    for row in rows:
        if not isinstance(row, dict):
            continue
        payload["rows"].append({
            "sheet": row.get("sheet") or "",
            "excel_row": row.get("excel_row"),
            "name": row.get("name") or "",
            "exposure": row.get("exposure") or "",
            "weight": row.get("weight_text") or row.get("weight") or "",
            "ead": row.get("ead"),
            "rwa": row.get("rwa"),
            "steps": number_steps(row.get("steps") or []),
        })
    path = TRACE_DIR / f"{stem}-计算留痕.json"
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return path
