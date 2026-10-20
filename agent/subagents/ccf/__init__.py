"""CCF subagent. The step's own program is program.py."""

from langchain_core.tools import tool

from pathlib import Path

from agent.layout import SKILLS, subagent_prompt
from agent.pipeline import pipeline_steps
from agent.subagents.ccf.program import NAME, explain

HERE = Path(__file__).resolve().parent


@tool
def ccf_status() -> str:
    """Report whether the off-balance conversion step can run. It does not compute a factor."""
    return explain()


def spec(model) -> dict:
    description, prompt = subagent_prompt(HERE)
    return {
        "name": NAME,
        "description": description,
        "system_prompt": prompt,
        "tools": [pipeline_steps, ccf_status],
        "skills": SKILLS,
        "model": model,
    }
