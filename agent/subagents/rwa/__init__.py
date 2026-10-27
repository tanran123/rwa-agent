"""RWA step. The pipeline calls program.run. The page dialogue only sees rwa_status."""

from langchain_core.tools import tool

from agent.calculation.pipeline import pipeline_steps
from agent.platform.layout import SKILLS, subagent_prompt
from agent.subagents.rwa.program import NAME, explain


@tool
def rwa_status() -> str:
    """问风险加权资产汇总时调用。只说明这一步现在能否执行，不新算合计。"""
    return explain()


def spec(model) -> dict:
    description, prompt = subagent_prompt(NAME)
    return {
        "name": NAME,
        "description": description,
        "system_prompt": prompt,
        "tools": [pipeline_steps, rwa_status],
        "skills": SKILLS,
        "model": model,
    }
