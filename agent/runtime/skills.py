"""Read SKILL.md and AGENTS.md front matter. One parser for the whole repo."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import yaml

from .settings import AGENT

SKILLS_DIR = AGENT / "skills"


@dataclass(frozen=True)
class Skill:
    name: str
    description: str
    body: str
    path: Path


def split_front_matter(text: str, path: Path) -> tuple[dict, str]:
    """Split ``---`` front matter from the body; raise with the file name."""
    if not text.startswith("---"):
        raise ValueError(str(path) + " 缺少开头的说明")
    end = text.find("\n---", 3)
    if end < 0:
        raise ValueError(str(path) + " 缺少说明的结束")
    raw = text[3:end].strip()
    try:
        data = yaml.safe_load(raw) if raw else {}
    except yaml.YAMLError as exc:
        raise ValueError(str(path) + " 的说明不是合法 YAML") from exc
    if data is None:
        data = {}
    if not isinstance(data, dict):
        raise ValueError(str(path) + " 的说明必须是键值对")
    body = text[end + 4 :].strip()
    return data, body


def read_markdown(path: Path) -> tuple[dict, str]:
    return split_front_matter(path.read_text(encoding="utf-8"), path)


def read_skill(name: str) -> Skill:
    path = SKILLS_DIR / name / "SKILL.md"
    data, body = read_markdown(path)
    description = str(data.get("description") or "").strip()
    if not description or not body:
        raise ValueError(str(path) + " 缺少 description 或正文")
    declared = str(data.get("name") or name).strip()
    return Skill(name=declared, description=description, body=body, path=path)


def skill_text(name: str) -> tuple[str, str]:
    found = read_skill(name)
    return found.description, found.body


def skill_body(name: str) -> str:
    return read_skill(name).body
