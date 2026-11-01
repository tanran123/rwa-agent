from pathlib import Path

import pytest

from agent.runtime.skills import SKILLS_DIR, read_skill, skill_body, skill_text, split_front_matter
from agent.skills import DIALOGUE


def skill_names() -> list[str]:
    return sorted(path.parent.name for path in SKILLS_DIR.glob("*/SKILL.md"))


def test_every_skill_parses() -> None:
    names = skill_names()
    assert names, "agent/skills 下没有 SKILL.md"
    for name in names:
        skill = read_skill(name)
        assert skill.description, name
        assert skill.body, name
        assert not skill.body.lstrip().startswith("---"), name


def test_dialogue_skills_are_available() -> None:
    for name in DIALOGUE:
        description, body = skill_text(name)
        assert description
        assert body
        assert body == skill_body(name)


def test_front_matter_requires_both_delimiters(tmp_path: Path) -> None:
    target = tmp_path / "SKILL.md"
    target.write_text("description: x\n\nbody\n", encoding="utf-8")
    with pytest.raises(ValueError):
        split_front_matter(target.read_text(encoding="utf-8"), target)


def test_front_matter_rejects_non_mapping(tmp_path: Path) -> None:
    target = tmp_path / "SKILL.md"
    target.write_text("---\n- a\n- b\n---\n\nbody\n", encoding="utf-8")
    with pytest.raises(ValueError):
        split_front_matter(target.read_text(encoding="utf-8"), target)
