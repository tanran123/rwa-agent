"""CCF step. The pipeline calls program.run. The page dialogue only sees ccf_status."""

from langchain_core.tools import tool

from agent.subagents.ccf.program import explain


@tool
def ccf_status() -> str:
    """问表外转换系数时调用。只说明这一步现在能否执行，不计算系数。"""
    return explain()
