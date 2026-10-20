"""研判之后，把拿不准的数据选择交给模型，由它向用户提问。"""

from __future__ import annotations

import json
from typing import Any

from rwa_agent.mapper import _complete, _extract_json
from rwa_agent.paper_calc import _sheet_outline


def _system() -> str:
    return (
        "你刚看完一本信用风险工作簿的研判结果，下一步才是字段映射和 RWA 计算。"
        "只有「用哪一块数据」会改变算进去的行或金额时才问用户。"
        "例如同一张明细有两列都能当敞口、一张表有两段表头、两张表像是同一批业务可能算重。"
        "选项必须是工作簿里真实出现的表名或列名，不要编造。"
        "一次最多问 3 个问题，每个问题最多 4 个选项。"
        "没有这类选择时 ready 为 true，不要为了问而问。"
        "不要问资本等级、风险权重、风险暴露类型，那些不是这一步要确认的。"
        "用户已经回答过的不要再问。用户说按当前判断继续时，ready 为 true。"
        "只输出一个 JSON 对象，不要解释。"
        "还要问时：{\"ready\":false,\"reply\":\"说明哪里拿不准\",\"questions\":[{\"id\":\"q1\",\"ask\":\"问题\",\"options\":[\"选项\"]}] }。"
        "可以算时：{\"ready\":true,\"reply\":\"一句确认\",\"decisions\":\"用哪张表、表头行、敞口列、跳过什么\",\"sheet\":\"要改用的明细表名，不改就写空字符串\",\"header_row\":0}。"
        "header_row 从 1 开始，0 表示不改表头行。sheet 必须是工作簿里的表名。"
    )


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
