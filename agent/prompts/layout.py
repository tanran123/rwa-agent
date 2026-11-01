"""Load the coordinator prompt, dialogue skills and each step's AGENTS.md."""

from __future__ import annotations

from pathlib import Path

from agent.runtime.skills import read_markdown, skill_body, skill_text
from agent.skills import DIALOGUE

HERE = Path(__file__).resolve().parent
AGENT = HERE.parent
AGENTS = HERE / "agents"


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8").strip()


def system_prompt(with_skills: bool = True) -> str:
    """Return the coordinator prompt.

    ``with_skills=True`` keeps the pre-DeepAgents behaviour and appends the
    full body of every DIALOGUE skill. The DeepAgents graph passes ``False``
    and lets the skills middleware disclose bodies progressively.
    """
    parts = [read_text(HERE / "system_prompt.md")]
    if with_skills:
        for name in DIALOGUE:
            description, body = skill_text(name)
            parts.append("## 技能 " + name + "\n" + description + "\n\n" + body)
    return "\n\n".join(parts)


def subagent_prompt(name: str) -> tuple[str, str]:
    path = AGENTS / name / "AGENTS.md"
    data, body = read_markdown(path)
    description = str(data.get("description") or "").strip()
    if not description or not body:
        raise ValueError(str(path) + " 缺少 description 或正文")
    return description, body
