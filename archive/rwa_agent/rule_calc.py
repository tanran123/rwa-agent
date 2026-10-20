"""Evaluate an authored rule from mapped columns and its result formula."""

from __future__ import annotations

import re
from pathlib import Path

from rwa_agent.agent import DETAIL_ROW_LIMIT, _col_index, _is_blank, _is_total, _load_sheets, _type_token
from rwa_agent.weight_tables import weight_catalog

_OPS = {"×", "÷", "+", "−", "-", "与", "取较大"}
_PLACEHOLDER = {"待填写的计算公式", "待填写"}


def run_authored(path: str | Path, specs: list[dict], graph: dict) -> dict:
    rules = {item["id"]: item for item in graph.get("rules") or [] if isinstance(item, dict)}
    names = [str(spec.get("sheet") or "") for spec in specs]
    loaded = {sheet["name"]: sheet for sheet in _load_sheets(path, names, max_row=None)}
    tables = {item["id"]: item for item in (weight_catalog().get("tables") or [])}
    packs = []
    rwa_rows = []
    for spec in specs:
        pack = _run_spec(loaded, spec, rules, tables)
        rwa_rows.extend(pack.pop("_rwa_rows", []))
        packs.append(pack)
    return {"packs": packs, "rwa_rows": rwa_rows}


def _run_spec(loaded: dict, spec: dict, rules: dict, tables: dict) -> dict:
    name = str(spec.get("sheet") or "")
    sheet = loaded.get(name)
    if sheet is None:
        raise ValueError(f"没有工作表「{name}」")
    rule = rules.get(str(spec.get("product") or ""))
    if rule is None:
        raise ValueError("请选择一种计算方式")
    try:
        header_row = int(spec.get("header_row"))
    except (TypeError, ValueError):
        raise ValueError(f"「{name}」的表头行无效") from None
    if header_row < 1 or header_row > len(sheet["rows"]):
        raise ValueError(f"「{name}」的表头行无效")
    fields = _fields(rule)
    columns = _columns(spec.get("columns") or {}, fields)
    if not columns:
        raise ValueError(f"「{rule.get('title') or '规则'}」还没有对应表头")
    lines = _formula_lines(rule)
    if not lines:
        raise ValueError(f"「{rule.get('title') or '规则'}」还没有结果公式")
    type_index, allowed = _type_filter(spec, name)
    rows = []
    for offset, raw in enumerate(sheet["rows"][header_row:]):
        if _is_blank(raw):
            if rows and allowed is None:
                break
            continue
        if _is_total(raw):
            if allowed is None:
                break
            continue
        if allowed is not None:
            cell = raw[type_index] if type_index is not None and type_index < len(raw) else None
            if _type_token(cell) not in allowed:
                continue
        excel_row = header_row + 1 + offset
        rows.append(_run_row(rule, fields, columns, lines, tables, raw, excel_row))
    ok_rows = [row for row in rows if row["status"] == "ok"]
    formula = "；".join(lines)
    return {
        "id": rule["id"],
        "title": str(rule.get("title") or "规则"),
        "sheet": name,
        "book": None,
        "header_row": header_row,
        "formula": formula,
        "basis": str(rule.get("basis") or ""),
        "currency": None,
        "mapping": [{"field": field["label"], "column": _letter(columns[field["id"]])} for field in fields if field["id"] in columns],
        "type_values": [str(value) for value in (spec.get("type_values") or []) if str(value).strip()],
        "row_count": len(rows),
        "rows": rows[:DETAIL_ROW_LIMIT],
        "rows_hidden": max(0, len(rows) - DETAIL_ROW_LIMIT),
        "total_rwa": sum(row["rwa"] for row in ok_rows),
        "total_capital": 0,
        "notes": ["这一笔的结果来自规则上的结果公式。权重字段按所选权重表查出数字后再计算。"],
        "_rwa_rows": [
            {"sheet": name, "header_row": header_row, "excel_row": row["excel_row"], "rwa": row["rwa"]}
            for row in ok_rows
        ],
    }


def _run_row(rule: dict, fields: list[dict], columns: dict, lines: list[str], tables: dict, raw: list, excel_row: int) -> dict:
    base = {"id": f"第{excel_row}行", "excel_row": excel_row, "product": rule["id"], "missing": []}
    names: dict[str, float] = {}
    steps = []
    try:
        for field in fields:
            if field["id"] not in columns:
                continue
            index = columns[field["id"]]
            cell = raw[index] if index < len(raw) else None
            names[field["label"]] = _field_value(field, cell, tables)
        value = None
        result_name = ""
        for line in lines:
            terms, ops, result = _parse_line(line)
            missing = [term for term in terms if term not in names]
            if missing:
                raise ValueError("公式里的「" + "、".join(missing) + "」没有对应到字段")
            value = _eval_terms([names[term] for term in terms], ops)
            result_name = result or result_name
            if result:
                names[result] = value
            steps.append({"name": result or "结果", "expr": " ".join(_join(terms, ops)), "value": value})
    except ValueError as exc:
        base.update(status="missing", rwa=None, capital=None, currency=None, summary=str(exc), basis=str(rule.get("basis") or ""), steps=[])
        return base
    shown = result_name or "结果"
    base.update(
        status="ok",
        rwa=value,
        capital=None,
        currency=None,
        summary=f"{shown} = {_show(value)}",
        basis=str(rule.get("basis") or ""),
        steps=steps,
    )
    return base


def _fields(rule: dict) -> list[dict]:
    found = []
    seen = set()
    for step in rule.get("steps") or []:
        if not isinstance(step, dict):
            continue
        for field in step.get("fields") or []:
            if not isinstance(field, dict):
                continue
            field_id = str(field.get("id") or "")
            label = str(field.get("label") or "").strip()
            if not field_id or not label or field_id in seen:
                continue
            seen.add(field_id)
            found.append({"id": field_id, "label": label, "table": str(field.get("table") or "")})
    return found


def _columns(raw: dict, fields: list[dict]) -> dict[str, int]:
    known = {field["id"] for field in fields}
    columns = {}
    for field_id, letter in raw.items():
        if field_id not in known or not letter:
            continue
        token = str(letter).strip().upper()
        if not re.fullmatch(r"[A-Z]+", token):
            continue
        columns[field_id] = _col_index(token)
    return columns


def _formula_lines(rule: dict) -> list[str]:
    lines = []
    for line in rule.get("lines") or []:
        text = str(line or "").strip()
        if text and text not in _PLACEHOLDER:
            lines.append(text)
        if len(lines) == 4:
            break
    return lines


def _type_filter(spec: dict, name: str) -> tuple[int | None, set[str] | None]:
    type_values = [str(value) for value in (spec.get("type_values") or []) if str(value).strip()]
    type_letter = str(spec.get("type_column") or "").strip().upper()
    if not type_letter and not type_values:
        return None, None
    if not re.fullmatch(r"[A-Z]+", type_letter) or not type_values:
        raise ValueError(f"「{name}」请先选定类型列，再选择要计算的类型")
    return _col_index(type_letter), set(type_values)


def _field_value(field: dict, cell: object, tables: dict) -> float:
    table_id = field.get("table") or ""
    if table_id:
        table = tables.get(table_id)
        if table is None:
            raise ValueError(f"「{field['label']}」没有可用的权重表")
        weight = _lookup_weight(table, cell)
        if weight is None:
            shown = "" if cell is None else str(cell).strip()
            raise ValueError(f"「{field['label']}」在权重表里没有「{shown or '空值'}」")
        return weight
    return _number(cell, field["label"])


def _lookup_weight(table: dict, cell: object) -> float | None:
    text = "" if cell is None else str(cell).strip()
    if not text or text.startswith("="):
        return None
    wanted = text.casefold()
    for row in table.get("rows") or []:
        if not row:
            continue
        for item in row[:-1]:
            if str(item).strip().casefold() == wanted:
                return _parse_weight(row[-1])
    return None


def _parse_weight(value: object) -> float:
    text = str(value or "").strip().replace(",", "")
    if not text or text == "—":
        raise ValueError("权重表这一格没有数字")
    percent = text.endswith("%")
    if percent:
        text = text[:-1].strip()
    number = float(text)
    if percent:
        number = number / 100.0
    return number


def _number(value: object, label: str) -> float:
    if isinstance(value, bool) or value is None:
        raise ValueError(f"「{label}」没有数字")
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip().replace(",", "")
    if not text or text.startswith("="):
        raise ValueError(f"「{label}」没有数字")
    try:
        return float(text)
    except ValueError as exc:
        raise ValueError(f"「{label}」不是数字") from exc


def _parse_line(text: str) -> tuple[list[str], list[str], str]:
    left, result = text, ""
    if "=" in text:
        left, result = text.rsplit("=", 1)
    tokens = [token for token in left.split() if token]
    if not tokens:
        raise ValueError("结果公式是空的")
    terms = [tokens[0]]
    ops = []
    index = 1
    while index < len(tokens):
        op = tokens[index]
        if op not in _OPS or index + 1 >= len(tokens):
            raise ValueError("结果公式没读懂")
        ops.append("−" if op == "-" else op)
        terms.append(tokens[index + 1])
        index += 2
    return terms, ops, result.strip()


def _eval_terms(values: list[float], ops: list[str]) -> float:
    if not values:
        raise ValueError("结果公式是空的")
    total = values[0]
    for op, value in zip(ops, values[1:]):
        if op == "×" or op == "与":
            total *= value
        elif op == "÷":
            if value == 0:
                raise ValueError("除数是 0")
            total /= value
        elif op == "+":
            total += value
        elif op == "−":
            total -= value
        elif op == "取较大":
            total = max(total, value)
        else:
            raise ValueError("结果公式没读懂")
    return total


def _join(terms: list[str], ops: list[str]) -> list[str]:
    parts = [terms[0]]
    for op, term in zip(ops, terms[1:]):
        parts.extend([op, term])
    return parts


def _show(value: float) -> str:
    return f"{value:.6f}".rstrip("0").rstrip(".")


def _letter(index: int) -> str:
    letters = ""
    number = index + 1
    while number:
        number, rest = divmod(number - 1, 26)
        letters = chr(65 + rest) + letters
    return letters
