"""LangChain tools that expose the pipeline steps to the coordinator."""

from __future__ import annotations

from pathlib import Path

from langchain_core.tools import tool

from agent.core.pipeline.pipeline import active_steps, run_pipeline
from agent.steps.ccf.program import explain as explain_ccf
from agent.steps.crm.program import explain as explain_crm
from agent.steps.rwa.program import explain as explain_rwa
from agent.steps.weight.program import NAME as WEIGHT


@tool
def run_weight_decision(workbook: str) -> str:
    """用户给出工作簿并要求计算时调用。workbook 是已有的 .xlsx 或 .xlsm 路径。没有路径不要猜文件。调用后需用户确认才会开始计算。"""
    path = Path(workbook).expanduser().resolve()
    if not path.is_file():
        return "找不到工作簿：" + str(path) + "。请给出信用风险底稿的 .xlsx 路径，不要换一本表。"
    if path.suffix.lower() not in {".xlsx", ".xlsm"}:
        return "只接受 .xlsx 或 .xlsm。"
    if WEIGHT not in active_steps():
        return "权重判断不在当前计算名单里，停住。"
    thread_id = None
    try:
        from langgraph.config import get_config

        parent = (get_config().get("configurable") or {}).get("thread_id")
        if isinstance(parent, str) and parent:
            thread_id = parent + "::calculation"
    except Exception:
        thread_id = None
    try:
        done = run_pipeline(path, thread_id=thread_id)
    except Exception as exc:
        return str(exc)[-2000:]
    if done.get("stopped"):
        return str(done.get("stop_reason") or "计算停住了")
    lines = [
        str(done.get("annotated") or ""),
        str(done.get("trace_file") or ""),
        "敞口 " + str(done.get("ead_yi")) + " 亿  风险加权资产 " + str(done.get("rwa_yi")) + " 亿",
    ]
    text = "\n".join(line for line in lines if line.strip()) or "命令没有输出。"
    from agent.storage import CALCULATION, LATEST, store

    store.put(CALCULATION, LATEST, {"text": text})
    return text


@tool
def ccf_status() -> str:
    """问表外转换系数时调用。只说明这一步现在能否执行，不计算系数。"""
    return explain_ccf()


@tool
def crm_status() -> str:
    """问缓释时调用。只说明这一步现在能否执行，不拆覆盖和未覆盖金额。"""
    return explain_crm()


@tool
def rwa_status() -> str:
    """问风险加权资产汇总时调用。只说明这一步现在能否执行，不新算合计。"""
    return explain_rwa()
