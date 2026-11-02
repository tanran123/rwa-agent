"""Read-only tools over the calculation engines.

These wrap existing functions; they never recompute a number or write a
workbook. Heavy imports stay inside each tool so importing the tool registry
does not load openpyxl or the HQLA engine.
"""

from __future__ import annotations

import json
from pathlib import Path

from langchain_core.tools import tool

_MAX = 12000


def _json(value: object) -> str:
    text = json.dumps(value, ensure_ascii=False, default=str)
    if len(text) <= _MAX:
        return text
    # Never return a half-written JSON string: the model cannot parse it.
    return json.dumps(
        {"truncated": True, "note": "结果过大，只保留前一段原文", "preview": text[:_MAX]},
        ensure_ascii=False,
    )


@tool
def working_paper_summary() -> str:
    """问底稿页当前缓存了多少行、敞口和风险加权资产时调用。只读缓存文件，不重算，也不调用模型。"""
    from agent.core.paths import PAPER_CACHE

    path = PAPER_CACHE
    if not path.is_file():
        return "底稿缓存不存在：" + str(path)
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        return "底稿缓存读取失败：" + str(exc)
    ead = data.get("ead_yi")
    rwa = data.get("rwa_yi")
    ead_text = f"{round(ead, 2)} 亿元" if isinstance(ead, (int, float)) else ""
    rwa_text = f"{round(rwa, 2)} 亿元" if isinstance(rwa, (int, float)) else ""
    lines = len(data.get("lines") or [])
    summary = {
        "file": data.get("file"),
        "as_of": data.get("as_of"),
        "unit": data.get("unit"),
        # The ``*_yi`` values are already in 亿元. State the unit in the same
        # breath; otherwise a model reads 372.79 as 万元.
        "ead_yi": ead,
        "rwa_yi": rwa,
        "ead_text": ead_text,
        "rwa_text": rwa_text,
        "summary": f"底稿 {lines} 行；敞口 {ead_text}；风险加权资产 {rwa_text}。",
        "rwa_thousand": data.get("rwa_thousand"),
        "unpriced_yi": data.get("unpriced_yi"),
        "line_count": lines,
        "process_row_count": len(data.get("process_rows") or []),
        "sheet_count": len(data.get("sheets") or []),
        "sheet_plan_count": len(data.get("sheet_plan") or []),
        "coverage_count": len(data.get("coverage") or {}),
    }
    return _json(summary)


@tool
def hqla_compute_summary(task: dict, reference: list | None = None) -> str:
    """用户给出 HQLA 任务 JSON 并要求判定摘要时调用。只返回统计、汇总、上限、对账和规则自检，不返回逐笔明细。不写数据库。"""
    if not isinstance(task, dict):
        return "task 必须是任务 JSON 对象。"
    from agent.core.hqla import compute

    try:
        out = compute({"task": task, "reference": reference or []})
    except Exception as exc:  # noqa: BLE001 - a tool must return text
        return "HQLA 计算失败：" + str(exc)[-500:]
    if out.get("empty"):
        return "任务里没有明细行。"
    return _json({
        "stats": out.get("stats"),
        "agg": out.get("agg"),
        "aggJ": out.get("aggJ"),
        "caps": out.get("caps"),
        "recon": out.get("recon"),
        "analyzeRules": out.get("analyzeRules"),
        "runAt": out.get("runAt"),
    })


@tool
def hqla_sample_plan(task: dict, reference: list | None = None) -> str:
    """用户给出 HQLA 任务 JSON 并要求抽样计划时调用。只返回抽样结果，不写数据库。"""
    if not isinstance(task, dict):
        return "task 必须是任务 JSON 对象。"
    from agent.core.hqla import sample_plan

    try:
        out = sample_plan({"task": task, "reference": reference or []})
    except Exception as exc:  # noqa: BLE001
        return "HQLA 抽样失败：" + str(exc)[-500:]
    return _json(out)


@tool
def market_modules() -> str:
    """问市场风险有哪些计算模块时调用。只返回模块目录，不计算。"""
    from agent.core.market.compare import module_catalog

    return _json(module_catalog())


@tool
def exposure_class_summary() -> str:
    """问暴露分类规则有多少字段、多少条规则时调用。只读分类 JSON，不修改。"""
    from agent.core.weight.rules import class_fields, load_class_doc

    try:
        doc = load_class_doc()
        fields = class_fields()
    except Exception as exc:  # noqa: BLE001
        return "分类规则读取失败：" + str(exc)
    rules = doc.get("rules") or []
    return _json({
        "name": doc.get("name"),
        "title": doc.get("title"),
        "field_count": len(fields),
        "rule_count": len(rules),
        "rules": [str(item.get("name") or "") for item in rules],
    })


domain_tools = [
    working_paper_summary,
    hqla_compute_summary,
    hqla_sample_plan,
    market_modules,
    exposure_class_summary,
]
