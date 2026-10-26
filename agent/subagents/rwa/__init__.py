"""RWA subagent. The step's own program is program.py."""

from langchain_core.tools import tool

from agent.layout import SKILLS, subagent_prompt
from agent.pipeline import pipeline_steps
from agent.subagents.rwa.program import NAME, explain


@tool
def rwa_status() -> str:
    """Report whether the risk-weighted asset rollup can run. It does not add up a new total."""
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
