"""CCF step. The pipeline calls program.run. The page dialogue only sees ccf_status."""

from langchain_core.tools import tool

from agent.calculation.pipeline import pipeline_steps
from agent.platform.layout import SKILLS, subagent_prompt
from agent.subagents.ccf.program import NAME, explain


@tool
def ccf_status() -> str:
    """问表外转换系数时调用。只说明这一步现在能否执行，不计算系数。"""
    return explain()


def spec(model) -> dict:
    description, prompt = subagent_prompt(NAME)
    return {
        "name": NAME,
        "description": description,
        "system_prompt": prompt,
        "tools": [pipeline_steps, ccf_status],
        "skills": SKILLS,
        "model": model,
    }
