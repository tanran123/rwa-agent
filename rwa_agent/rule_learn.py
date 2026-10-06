"""Read a rules workbook and ask the model to map it onto the existing library."""

from __future__ import annotations

import json
import re
from datetime import date, datetime
from pathlib import Path

import openpyxl

from rwa_agent.library import PARAM_FIELDS, load_library
from rwa_agent.mapper import _complete, _extract_json
from rwa_agent.rule_chat import _updates

_MAX_SHEETS = 6
_MAX_ROWS = 40
_MAX_COLS = 12
_MAX_CHARS = 14000


def learn_from_excel(path: str | Path, filename: str = "") -> dict:
    excerpt = workbook_excerpt(path)
    raw = _complete(
        _system(),
        json.dumps(
            {"filename": filename[:120], "workbook": excerpt, "rules": _catalog()},
            ensure_ascii=False,
        ),
    )
    try:
        parsed = _extract_json(raw)
    except (RuntimeError, json.JSONDecodeError):
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


def _system() -> str:
    return (
        "你从用户上传的 Excel 里学习资本规则，并对照给出的现有规则库。"
        "只输出一个 JSON 对象，不要写 Markdown。"
        "格式是 {\"reply\":\"给用户看的中文说明\",\"updates\":null}。"
        "reply 先说学到了哪些规则、准备改哪些参数。Excel 里对不上现有规则的内容也写在 reply，不要丢。"
        "只有 Excel 明确写出、且能对应到现有规则 id 的公式、步骤或参数，才放入 updates。"
        "updates 写成 {\"规则id\":{\"params\":{\"参数id\":数值},\"lines\":[\"公式\"],\"steps\":[{\"title\":\"\",\"line\":\"\"}]}}。"
        "没有可写入的变更时 updates 必须是 null。"
        "params 里的百分比用小数：10% 写成 0.10，8% 写成 0.08。倍数和月数用原数字。文字参数用字符串。"
        "lines 和 steps 是给人看的，百分比写成 10% 这种形式，不要写成 0.10。"
        "lines 最多 4 条。steps 按该规则原来的顺序，条数不要增减，只改 title 和 line。"
        "只能使用给出的规则 id 和参数 id。评级权重表、期限档权重不能改；Excel 里如果有这些，在 reply 里说明，不要放进 updates。"
        "公式文字里的百分比、倍数要和 params 一致。不要编造 Excel 里没有的数字。"
    )
