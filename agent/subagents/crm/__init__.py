"""CRM step. The pipeline calls program.run. The page dialogue only sees crm_status."""

from langchain_core.tools import tool

from agent.calculation.pipeline import pipeline_steps
from agent.platform.layout import SKILLS, subagent_prompt
from agent.subagents.crm.program import NAME, explain


@tool
def crm_status() -> str:
    """问缓释时调用。只说明这一步现在能否执行，不拆覆盖和未覆盖金额。"""
    return explain()


def spec(model) -> dict:
    description, prompt = subagent_prompt(NAME)
    return {
        "name": NAME,
        "description": description,
        "system_prompt": prompt,
        "tools": [pipeline_steps, crm_status],
        "skills": SKILLS,
        "model": model,
    }
