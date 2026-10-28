"""研判之后，把拿不准的数据选择交给模型，由它向用户提问。"""

from __future__ import annotations

import json
from typing import Any

from agent.platform.layout import skill_body
from agent.subagents.rwa.market.mapper import _complete, _extract_json
from agent.subagents.weight.paper.paper_calc import _sheet_outline


def _system() -> str:
    return skill_body("measure-clarify")


def _context(book, planned: list[dict], note: str) -> dict[str, Any]:
    sheets = []
    for name in book.sheetnames:
        sheets.append({"sheet": name, "rows": _sheet_outline(book[name])})
    return {
        "current_plan": planned,
        "note": note,
        "sheets": sheets,
    }


def clarify_workbook(book, planned: list[dict], note: str, messages: list[dict]) -> dict[str, Any]:
    """根据研判和对话，决定是继续问，还是可以开始映射。"""
    history = []
    for item in messages[-8:]:
        if not isinstance(item, dict):
            continue
        role = "user" if item.get("role") == "user" else "assistant"
        text = str(item.get("content") or item.get("text") or "").strip()
        if text:
            history.append({"role": role, "content": text[:500]})
    payload = {
        "workbook": _context(book, planned, note),
        "conversation": history,
        "instruction": "这是第一次看研判结果。有拿不准的数据选择就问，没有就直接 ready。" if not history else "结合用户刚才的回答，决定还要不要问。",
    }
    raw = _complete(_system(), json.dumps(payload, ensure_ascii=False), timeout=90)
    parsed = _extract_json(raw)
    return _normalize(parsed, set(book.sheetnames))


def _normalize(parsed: dict, names: set[str]) -> dict[str, Any]:
    ready = parsed.get("ready") is True
    reply = str(parsed.get("reply") or "").strip()[:400]
    questions = []
    if not ready:
        for item in (parsed.get("questions") or [])[:3]:
            if not isinstance(item, dict):
                continue
            ask = str(item.get("ask") or "").strip()
            if not ask:
                continue
            options = []
            for opt in item.get("options") or []:
                text = str(opt or "").strip()
                if text and text not in options:
                    options.append(text[:80])
                if len(options) >= 4:
                    break
            questions.append({
                "id": str(item.get("id") or ("q" + str(len(questions) + 1)))[:20],
                "ask": ask[:180],
                "options": options,
            })
        if not questions and not reply:
            ready = True
            reply = "没有需要另选的数据，按研判结果继续。"
    sheet = str(parsed.get("sheet") or "").strip()
    if sheet not in names:
        sheet = ""
    try:
        header_row = int(parsed.get("header_row") or 0)
    except (TypeError, ValueError):
        header_row = 0
    if header_row < 0:
        header_row = 0
    decisions = str(parsed.get("decisions") or "").strip()[:400]
    if ready and not reply:
        reply = "已确认用哪些数据，开始映射。"
    return {
        "ready": ready,
        "reply": reply,
        "questions": [] if ready else questions,
        "decisions": decisions,
        "sheet": sheet,
        "header_row": header_row,
    }
