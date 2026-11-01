from pathlib import Path

import pytest

from agent.prompts.layout import system_prompt
from agent.runtime.skills_backend import SkillsBackend
from agent.runtime.settings import AGENT


def test_legacy_prompt_keeps_dialogue_bodies() -> None:
    full = system_prompt()
    lean = system_prompt(with_skills=False)
    assert len(full) > len(lean)
    assert "## 技能 calculation-order" in full
    assert "## 技能 calculation-order" not in lean


def test_skills_backend_reads_inside_skills() -> None:
    backend = SkillsBackend(AGENT)
    result = backend.read("/skills/decision-tree/SKILL.md", limit=5)
    assert result.error is None
    assert "决策树" in (result.file_data or {}).get("content", "")


def test_skills_backend_rejects_paths_outside_skills() -> None:
    backend = SkillsBackend(AGENT)
    with pytest.raises(ValueError):
        backend.read("/.env")
    with pytest.raises(ValueError):
        backend.ls("/")


def test_skills_backend_rejects_writes() -> None:
    backend = SkillsBackend(AGENT)
    with pytest.raises(PermissionError):
        backend.write("/skills/decision-tree/SKILL.md", "x")
    with pytest.raises(PermissionError):
        backend.delete("/skills/decision-tree/SKILL.md")


def test_graph_engine_toggle(monkeypatch) -> None:
    from agent.platform.graph import agent

    monkeypatch.setenv("RWA_CHAT_ENGINE", "legacy")
    assert type(agent()).__name__ == "CompiledStateGraph"
    monkeypatch.delenv("RWA_CHAT_ENGINE")
    assert type(agent()).__name__ == "CompiledStateGraph"
