"""Tools the platform can call. MCP serves this same list."""

from agent.calculation.pipeline import pipeline_steps
from agent.platform.turn import note_page_actions
from agent.runtime import CALCULATION, LATEST, store
from agent.subagents.ccf import ccf_status
from agent.subagents.crm import crm_status
from agent.subagents.rwa import rwa_status
from agent.subagents.weight import run_weight_decision
from langchain_core.tools import tool


@tool
def recent_calculation() -> str:
    """问上一次权重计算结果时调用。只复述返回原文，不要重算。"""
    item = store.get(CALCULATION, LATEST)
    if item is None:
        return "这次进程里还没有算过工作簿。"
    value = item.value if isinstance(item.value, dict) else {}
    text = value.get("text") if isinstance(value, dict) else ""
    return text or "这次进程里还没有算过工作簿。"


@tool
def page_actions(actions: list) -> str:
    """当前页面要填写、修改或保存时调用。没有要执行的操作时不要调用。
    actions 是步骤数组。每项含 path（当前页面）、form（这一页列出的表单编号）、fields（只含对话里已经说出的字段）、save（要保存时为 true）。
    调用后用白话收尾，不要在回答里写 JSON。"""
    note_page_actions(actions if isinstance(actions, list) else [])
    count = len(actions) if isinstance(actions, list) else 0
    if not count:
        return "没有要执行的步骤。用白话说明原因，不要在回答里写 JSON。"
    return "已记下 " + str(count) + " 步，页面会在当前页执行。用白话收尾，不要在回答里再写 JSON。"


tools = [
    pipeline_steps,
    run_weight_decision,
    recent_calculation,
    ccf_status,
    crm_status,
    rwa_status,
    page_actions,
]
