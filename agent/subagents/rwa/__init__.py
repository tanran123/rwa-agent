"""RWA step. The pipeline calls program.run. The page dialogue only sees rwa_status."""

from langchain_core.tools import tool

from agent.subagents.rwa.program import explain


@tool
def rwa_status() -> str:
    """问风险加权资产汇总时调用。只说明这一步现在能否执行，不新算合计。"""
    return explain()
