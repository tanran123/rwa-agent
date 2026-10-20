"""流水线第一步：按权重法分类 JSON 划分暴露、取权重并计算敞口。"""

from __future__ import annotations

from pathlib import Path

from rwa_agent.paper_calc import run_workbook


def run(context: dict) -> dict:
    source = context.get("source")
    if not source:
        context["stopped"] = True
        context["stop_reason"] = "没有工作簿路径"
        return context
    dest = Path(context["dest"]) if context.get("dest") else None
    done = run_workbook(Path(source), dest)
    context["result"] = done
    context["annotated"] = done.get("annotated") or ""
    context["trace_file"] = done.get("trace_file") or ""
    context["ead_yi"] = done.get("ead_yi")
    context["rwa_yi"] = done.get("rwa_yi")
    return context
