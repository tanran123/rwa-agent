"""Read a rules workbook and ask the model to map it onto the existing library."""

from __future__ import annotations

import re
from datetime import date, datetime
from pathlib import Path

import openpyxl

from agent.llm.capabilities.rule_learn import learn as learn_rules
from knowledge.local.library import PARAM_FIELDS, load_library
from knowledge.weknora.rule_chat import _updates

_MAX_SHEETS = 6
_MAX_ROWS = 40
_MAX_COLS = 12
_MAX_CHARS = 14000


def learn_from_excel(path: str | Path, filename: str = "") -> dict:
    excerpt = workbook_excerpt(path)
    try:
        parsed = learn_rules(
            {"filename": filename[:120], "workbook": excerpt, "rules": _catalog()}
        )
    except (RuntimeError, ValueError):
        raise RuntimeError("模型没有返回可用的规则") from None
    if not isinstance(parsed, dict):
        raise RuntimeError("模型没有返回可用的规则")
    reply = str(parsed.get("reply") or "").strip()[:1200] or "模型没有说明学到了什么。"
    updates = _updates(parsed.get("updates"))
    return {"reply": reply, "updates": updates or None, "filename": filename[:120]}


def workbook_excerpt(path: str | Path) -> str:
    try:
        book = openpyxl.load_workbook(path, read_only=True, data_only=False)
    except Exception as exc:
        raise ValueError("无法读取这份 Excel") from exc
    chunks: list[str] = []
    try:
        for sheet in book.worksheets[:_MAX_SHEETS]:
            rows: list[str] = []
            for row in sheet.iter_rows(max_row=_MAX_ROWS, max_col=_MAX_COLS, values_only=True):
                cells = [_cell_text(value) for value in row]
                while cells and not cells[-1]:
                    cells.pop()
                if not any(cells):
                    continue
                rows.append(" | ".join(cells))
            if rows:
                chunks.append(f"## {sheet.title}\n" + "\n".join(rows))
    finally:
        book.close()
    text = "\n\n".join(chunks).strip()
    if not text:
        raise ValueError("这份 Excel 里没有读到文字或数字")
    if len(text) > _MAX_CHARS:
        text = text[:_MAX_CHARS]
    return text


def _catalog() -> list[dict]:
    library = load_library()
    found = []
    for pack, doc in library.items():
        found.append(
            {
                "id": pack,
                "title": doc["title"],
                "category": doc["category"],
                "lines": doc["lines"],
                "steps": [{"title": step["title"], "line": step["line"]} for step in doc["steps"]],
                "params": [
                    {
                        "id": key,
                        "label": label,
                        "kind": kind,
                        "value": doc["params"].get(key),
                    }
                    for key, label, kind in PARAM_FIELDS[pack]
                ],
            }
        )
    return found


def _cell_text(value: object) -> str:
    if value is None or isinstance(value, bool):
        return "" if value is None else ("TRUE" if value else "FALSE")
    if isinstance(value, datetime):
        return value.isoformat(sep=" ", timespec="minutes")
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, float):
        if value != value or value in (float("inf"), float("-inf")):
            return ""
        if abs(value - round(value)) < 1e-8:
            return str(int(round(value)))
        return f"{value:.6f}".rstrip("0").rstrip(".")
    text = re.sub(r"\s+", " ", str(value)).strip()
    return text[:80]
