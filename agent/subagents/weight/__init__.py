"""Weight step. The pipeline calls program.run. The page dialogue only sees run_weight_decision."""

from __future__ import annotations

from pathlib import Path

from langchain_core.tools import tool

from agent.calculation.pipeline import active_steps, pipeline_steps, run_pipeline
from agent.platform.layout import SKILLS, subagent_prompt
from agent.subagents.weight.program import NAME


@tool
def run_weight_decision(workbook: str) -> str:
    """用户给出工作簿并要求计算时调用。workbook 是已有的 .xlsx 或 .xlsm 路径。没有路径不要猜文件。调用后需用户确认才会开始计算。"""
    path = Path(workbook).expanduser().resolve()
    if not path.is_file():
        return "找不到工作簿：" + str(path) + "。请给出信用风险底稿的 .xlsx 路径，不要换一本表。"
    if path.suffix.lower() not in {".xlsx", ".xlsm"}:
        return "只接受 .xlsx 或 .xlsm。"
    if NAME not in active_steps():
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
    from agent.runtime import CALCULATION, LATEST, store

    store.put(CALCULATION, LATEST, {"text": text})
    return text


def spec(model) -> dict:
    description, prompt = subagent_prompt(NAME)
    return {
        "name": NAME,
        "description": description,
        "system_prompt": prompt,
        "tools": [pipeline_steps, run_weight_decision],
        "skills": SKILLS,
        "model": model,
    }
