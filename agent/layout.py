"""Load the dcode project files: AGENTS.md, skills, and subagent definitions."""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
MEMORY = ["./AGENTS.md"]
SKILLS = ["./.deepagents/skills/"]
AGENTS = ROOT / ".deepagents" / "agents"


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


def subagent_prompt(name: str) -> tuple[str, str]:
    path = AGENTS / name / "AGENTS.md"
    text = path.read_text(encoding="utf-8")
    if not text.startswith("---\n"):
        raise ValueError(str(path) + " 缺少开头的说明")
    end = text.find("\n---", 3)
    if end < 0:
        raise ValueError(str(path) + " 缺少说明的结束")
    description = ""
    for line in text[4:end].splitlines():
        if line.startswith("description:"):
            description = line.split(":", 1)[1].strip()
    body = text[end + 4 :].strip()
    if not description or not body:
        raise ValueError(str(path) + " 缺少 description 或正文")
    return description, body
