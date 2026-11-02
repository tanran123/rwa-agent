from pathlib import Path

import pytest

from agent.llm.prompts.layout import system_prompt
from agent.llm.agents.skills_backend import SkillsBackend
from agent.llm.settings import LLM


def test_skills_backend_reads_inside_skills() -> None:
    backend = SkillsBackend(LLM)
    result = backend.read("/skills/decision-tree/SKILL.md", limit=5)
    assert result.error is None
    assert "决策树" in (result.file_data or {}).get("content", "")


def test_skills_backend_rejects_paths_outside_skills() -> None:
    backend = SkillsBackend(LLM)
    with pytest.raises(ValueError):
        backend.read("/.env")
    with pytest.raises(ValueError):
        backend.ls("/")


def test_skills_backend_rejects_writes() -> None:
    backend = SkillsBackend(LLM)
    with pytest.raises(PermissionError):
        backend.write("/skills/decision-tree/SKILL.md", "x")
    with pytest.raises(PermissionError):
        backend.delete("/skills/decision-tree/SKILL.md")


def test_graph_is_a_compiled_deepagents_graph() -> None:
    from agent.llm.graph import agent

    assert type(agent()).__name__ == "CompiledStateGraph"
