"""Load the deepagents project files: agent.json, AGENTS.md, and skills."""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SKILLS = ["/skills/"]


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8").strip()


def read_json(path: Path) -> dict:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError(str(path) + " 必须是 JSON 对象")
    return data


def project() -> dict:
    return read_json(ROOT / "agent.json")


def coordinator_prompt() -> str:
    return read_text(ROOT / "AGENTS.md")


def subagent_prompt(directory: Path) -> tuple[str, str]:
    data = read_json(directory / "agent.json")
    description = str(data.get("description") or "").strip()
    if not description:
        raise ValueError(str(directory / "agent.json") + " 缺少 description")
    return description, read_text(directory / "AGENTS.md")
