"""Load the coordinator prompt, dialogue skills and each step's AGENTS.md."""

from __future__ import annotations

from pathlib import Path

from agent.llm.skills import read_markdown, skill_body

HERE = Path(__file__).resolve().parent
AGENTS = HERE / "agents"


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8").strip()


def system_prompt() -> str:
    """Return the coordinator prompt. Bodies are disclosed by the skills middleware."""
    return read_text(HERE / "system_prompt.md")


def subagent_prompt(name: str) -> tuple[str, str]:
    path = AGENTS / name / "AGENTS.md"
    data, body = read_markdown(path)
    description = str(data.get("description") or "").strip()
    if not description or not body:
        raise ValueError(str(path) + " 缺少 description 或正文")
    return description, body
