"""DeepAgents subagent specs for the four regulatory steps.

The order is fixed by ``agent.subagents.ORDER``; the prompts come from
``agent/prompts/agents/<name>/AGENTS.md``. Only ``weight`` can execute
today. ``ccf``, ``crm`` and ``rwa`` exist so the coordinator can explain why
they stop without inventing numbers.
"""

from __future__ import annotations

from agent.calculation.pipeline import pipeline_steps
from agent.prompts.layout import subagent_prompt
from agent.subagents.ccf import ccf_status
from agent.subagents.crm import crm_status
from agent.subagents.rwa import rwa_status
from agent.subagents.weight import run_weight_decision

# Loading every skill into every subagent would defeat progressive disclosure
# and widen the prompt. Only the weight step needs the calculation skills today.
_WEIGHT_SKILLS = ["/skills/"]


def _spec(name: str, tools: list, skills: list[str] | None = None) -> dict:
    description, prompt = subagent_prompt(name)
    spec = {
        "name": name,
        "description": description,
        "system_prompt": prompt,
        "tools": tools,
    }
    if skills:
        spec["skills"] = skills
    return spec


def build_subagents() -> list[dict]:
    return [
        _spec("weight", [pipeline_steps, run_weight_decision], _WEIGHT_SKILLS),
        _spec("ccf", [pipeline_steps, ccf_status]),
        _spec("crm", [pipeline_steps, crm_status]),
        _spec("rwa", [pipeline_steps, rwa_status]),
    ]
