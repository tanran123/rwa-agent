"""把一笔计算拆成可倒查的步骤，并写成 JSON 和「计算留痕」表。"""

from __future__ import annotations

import json
import re
from datetime import datetime
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
TRACE_DIR = ROOT / "data" / "traces"

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


def _plain_number(value: Any) -> str:
    if isinstance(value, bool) or value is None or value == "":
        return ""
    if isinstance(value, (int, float)):
        if abs(float(value) - round(float(value))) < 1e-6:
            return str(int(round(float(value))))
        return show_value(value)
    return str(value)


def _field_labels() -> dict[str, str]:
    path = ROOT / "knowledge" / "权重法风险暴露分类.json"
    if not path.is_file():
        return {}
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    labels = {}

    def add(field: object) -> None:
        if isinstance(field, dict) and field.get("name"):
            labels[str(field["name"])] = str(field.get("label") or field["name"])

    def walk(node: object) -> None:
        if not isinstance(node, dict):
            return
        for field in node.get("fields") or []:
            add(field)
        for child in node.get("children") or []:
            walk(child)
        walk(node.get("otherwise"))

    for field in doc.get("fields") or []:
        add(field)
    for rule in doc.get("rules") or []:
        walk(rule)
    walk(doc.get("otherwise"))
    return labels


def _weight_label(row: dict[str, Any]) -> str:
    """权重优先用已经写成百分比的文字；数值权重按比率换算。"""
    for key in ("weight_text", "weight"):
        value = row.get(key)
        if isinstance(value, str) and value.endswith("%"):
            return value
    value = row.get("weight")
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        text = row.get("weight_text")
        return text if isinstance(text, str) else ""
    points = float(value) * 100
    if abs(points - round(points)) < 1e-9:
        return str(int(round(points))) + "%"
    return f"{points:.4f}".rstrip("0").rstrip(".") + "%"


def formula_of(row: dict[str, Any]) -> dict[str, str]:
    """风险加权资产 = 敞口 × 权重，并代入这一行的数。"""
    expression = "风险加权资产 = 敞口 × 权重"
    weight = _weight_label(row)
    ead = row.get("ead")
    rwa = row.get("rwa")
    has_ead = isinstance(ead, (int, float)) and not isinstance(ead, bool)
    has_rwa = isinstance(rwa, (int, float)) and not isinstance(rwa, bool)
    if has_ead and weight.endswith("%") and has_rwa:
        substituted = f"{_plain_number(ead)} × {weight} = {_plain_number(rwa)}"
    elif has_ead:
        substituted = f"敞口 {_plain_number(ead)}，权重未定，不计算风险加权资产"
    else:
        substituted = "这一行没有敞口，不计算风险加权资产"
    return {"expression": expression, "substituted": substituted}


def _rule_groups(steps: list[dict[str, Any]]) -> list[dict[str, Any]]:
    groups: list[dict[str, Any]] = []
    for item in steps:
        if item.get("stage") != "分类":
            continue
        key = (str(item.get("rule") or ""), str(item.get("title") or ""))
        if not groups or groups[-1]["key"] != key:
            groups.append({"key": key, "rule": key[0], "title": key[1], "conditions": [], "note": ""})
        group = groups[-1]
        if item.get("field"):
            group["conditions"].append(item)
        if item.get("note"):
            group["note"] = str(item["note"])
    return groups


def render_trace_markdown(payload: dict[str, Any]) -> str:
    """写成后续可以直接交给大模型阅读的说明。"""
    labels = _field_labels()
    lines = [
        f"# {payload.get('file') or '计算'} 计算留痕",
        "",
        "这份说明按行记录计算经历，供后续模型直接阅读。不要根据文件名猜测规则，只根据下面写出的取值、命中条件和公式。每一行的流向图只画这一行实际走进的规则，不补充没有写出的分支。",
        "",
        "## 计算公式",
        "",
        "风险加权资产 = 敞口 × 权重",
        "",
        "敞口是这一行用于计算的金额，单位与源表金额列一致。权重是分类规则最后命中那一档给出的百分比。权重未定时代入式不成立，这一行没有风险加权资产。",
        "",
        f"计算时间：{payload.get('saved_at') or ''}",
        "",
    ]
    for index, row in enumerate(payload.get("rows") or [], 1):
        if not isinstance(row, dict):
            continue
        formula = formula_of(row)
        steps = row.get("steps") or []
        lines.append(f"## {index}. {row.get('sheet') or ''} 第 {row.get('excel_row') or ''} 行 {row.get('name') or ''}")
        lines.append("")
        lines.append(f"- 风险暴露：{row.get('exposure') or ''}")
        lines.append(f"- 权重：{row.get('weight') or ''}")
        lines.append(f"- 公式：{formula.get('expression') or ''}")
        lines.append(f"- 代入：{formula.get('substituted') or ''}")
        lines.append("")
        lines.append("### 流向")
        lines.append("")
        lines.extend(_flow_mermaid(row, labels, formula))
        lines.append("")
        lines.append("### 经历")
        lines.append("")
        lines.append(_story(row, labels))
        lines.append("")
        taken = [item for item in steps if item.get("stage") == "取值" and item.get("actual") not in ("", None)]
        if taken:
            lines.append("### 取值")
            lines.append("")
            for item in taken:
                field = str(item.get("field") or "")
                label = labels.get(field) or field
                lines.append(f"- {label}（{field}）= {item.get('actual')}")
            lines.append("")
        groups = _rule_groups(steps)
        if groups:
            lines.append("### 规则")
            lines.append("")
            for order, group in enumerate(groups, 1):
                rule = group["rule"] or "无规则名"
                lines.append(f"{order}. 规则 `{rule}`：{group['title']}")
                for cond in group["conditions"]:
                    field = str(cond.get("field") or "")
                    label = labels.get(field) or field
                    mark = "命中" if cond.get("hit") is True else ("未命中" if cond.get("hit") is False else "未比较")
                    lines.append(
                        f"   - {mark}：{label}（{field}）{cond.get('op') or ''} {cond.get('expected') or ''}，实际 {cond.get('actual') or '空'}"
                    )
                if group["note"]:
                    lines.append(f"   - 说明：{group['note']}")
            lines.append("")
        weight = next((item for item in steps if item.get("stage") == "权重"), None)
        if weight:
            lines.append("### 权重")
            lines.append("")
            lines.append(f"- 规则 `{weight.get('rule') or ''}` 给出权重 {weight.get('result') or row.get('weight') or ''}")
            if weight.get("note"):
                lines.append(f"- {weight['note']}")
            lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def _mermaid_text(value: Any) -> str:
    text = show_value(value) if not isinstance(value, str) else value
    return (
        text.replace("\\", "")
        .replace('"', "'")
        .replace("[", "（")
        .replace("]", "）")
        .replace("{", "（")
        .replace("}", "）")
        .replace("#", "")
        .replace("\n", " ")
        .strip()
    )


def _flow_mermaid(row: dict[str, Any], labels: dict[str, str], formula: dict[str, str]) -> list[str]:
    """一行判断的总览：只串联实际走进的规则，再到权重和代入结果。"""
    groups = _rule_groups(row.get("steps") or [])
    lines = ["```mermaid", "flowchart TD"]
    lines.append('  n0(["本行"])')
    previous = "n0"
    if not groups:
        lines.append('  n1["这一行没有命中分类规则"]')
        lines.append("  n0 --> n1")
        previous = "n1"
        next_index = 2
    else:
        next_index = 1
        for group in groups:
            node = f"n{next_index}"
            next_index += 1
            parts = [group["title"] or "未命名", f"规则 {group['rule'] or '未命名'}"]
            for cond in group["conditions"]:
                field = str(cond.get("field") or "")
                label = labels.get(field) or field
                mark = "命中" if cond.get("hit") is True else ("未命中" if cond.get("hit") is False else "未比较")
                actual = cond.get("actual") or "空"
                parts.append(f"{label} {cond.get('op') or ''} {cond.get('expected') or ''}，实际 {actual}，{mark}")
            if group["note"]:
                parts.append(str(group["note"]))
            lines.append(f'  {node}["{"<br/>".join(_mermaid_text(part) for part in parts if part)}"]')
            lines.append(f"  {previous} --> {node}")
            previous = node
    weight = next((item for item in (row.get("steps") or []) if item.get("stage") == "权重"), None)
    if weight:
        node = f"n{next_index}"
        next_index += 1
        shown = weight.get("result") or row.get("weight") or "未定"
        lines.append(f'  {node}["权重 {_mermaid_text(shown)}"]')
        lines.append(f"  {previous} --> {node}")
        previous = node
    substituted = formula.get("substituted") or ""
    if substituted:
        node = f"n{next_index}"
        lines.append(f'  {node}["{_mermaid_text(substituted)}"]')
        lines.append(f"  {previous} --> {node}")
    lines.append("```")
    return lines


def _story(row: dict[str, Any], labels: dict[str, str]) -> str:
    groups = _rule_groups(row.get("steps") or [])
    bits = []
    for group in groups:
        hits = [cond for cond in group["conditions"] if cond.get("hit") is True]
        if hits:
            parts = []
            for cond in hits:
                field = str(cond.get("field") or "")
                label = labels.get(field) or field
                parts.append(f"{label}实际为 {cond.get('actual') or '空'}，{cond.get('op') or '符合'} {cond.get('expected') or ''}")
            bits.append(f"进入「{group['title']}」（规则 {group['rule'] or '未命名'}），因为" + "；".join(parts))
        elif group["note"]:
            bits.append(f"进入「{group['title']}」（规则 {group['rule'] or '未命名'}）。{group['note']}")
        else:
            bits.append(f"进入「{group['title']}」（规则 {group['rule'] or '未命名'}）")
    formula = formula_of(row)
    if not bits:
        return "这一行没有命中分类规则。" + formula.get("substituted", "")
    return "。".join(bits) + "。然后计算：" + formula.get("expression", "") + "，即 " + formula.get("substituted", "") + "。"


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
            "formula": formula_of(row),
        })
    path = TRACE_DIR / f"{stem}-计算留痕.json"
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    markdown = TRACE_DIR / f"{stem}-计算留痕.md"
    markdown.write_text(render_trace_markdown(payload), encoding="utf-8")
    return path
