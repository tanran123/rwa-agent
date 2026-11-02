"""Build the coordinator with deepagents' ``create_deep_agent``."""

from __future__ import annotations

import os

from deepagents import (
    GeneralPurposeSubagentProfile,
    HarnessProfile,
    create_deep_agent,
    register_harness_profile,
)
from deepagents.middleware.filesystem import FilesystemMiddleware, FilesystemPermission

from agent.llm.agents.subagents import build_subagents
from agent.llm.prompts.layout import system_prompt
from agent.llm.agents.skills_backend import SkillsBackend
from agent.llm.session.turn_middleware import TurnContextMiddleware
from agent.storage import checkpointer, store
from agent.llm.client import chat_model
from agent.llm.settings import LLM
from agent.tools import tools

_READ_ONLY_TOOLS = ["ls", "read_file", "glob", "grep"]
_PERMISSIONS = [
    FilesystemPermission(operations=["read"], paths=["/skills/**"], mode="allow"),
    FilesystemPermission(operations=["write"], paths=["/**"], mode="deny"),
]


def _subagents_enabled() -> bool:
    value = (os.environ.get("RWA_COORDINATOR_SUBAGENTS") or "1").strip().lower()
    return value not in {"0", "false", "off", "no"}


def build_chat_agent():
    """Return the compiled coordinator graph. Kept in one place for rollback."""
    # The coordinator must not hand work to a generic subagent: the calculation
    # pipeline is the only executor. Registering at provider level keeps this
    # true when ``agent.json`` switches between qwen models.
    register_harness_profile(
        "openai",
        HarnessProfile(
            general_purpose_subagent=GeneralPurposeSubagentProfile(enabled=False),
            excluded_tools=frozenset({"execute"}),
        ),
    )
    backend = SkillsBackend(LLM)
    return create_deep_agent(
        model=chat_model("chat"),
        tools=tools,
        system_prompt=system_prompt(),
        skills=["/skills/"],
        subagents=build_subagents() if _subagents_enabled() else None,
        backend=backend,
        middleware=[
            FilesystemMiddleware(
                backend=backend,
                tools=_READ_ONLY_TOOLS,
                permissions=_PERMISSIONS,
                # Eviction writes tool output back to the backend; this one is read-only.
                tool_token_limit_before_evict=None,
                human_message_token_limit_before_evict=None,
            ),
            TurnContextMiddleware(),
        ],
        permissions=_PERMISSIONS,
        interrupt_on={
            "run_weight_decision": {
                "allowed_decisions": ["approve", "reject"],
                "description": "计算工作簿前需要用户确认",
            }
        },
        checkpointer=checkpointer,
        store=store,
        name="rwa",
    )
