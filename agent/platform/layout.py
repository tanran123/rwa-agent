"""Load the coordinator prompt and each step's AGENTS.md."""

from __future__ import annotations

from pathlib import Path

from agent.skills import DIALOGUE, SKILLS

HERE = Path(__file__).resolve().parent
AGENT = HERE.parent
AGENTS = AGENT / ".deepagents" / "agents"


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8").strip()


def _description(raw: str) -> str:
    lines = raw.splitlines()
    for index, line in enumerate(lines):
        if not line.startswith("description:"):
            continue
        rest = line.split(":", 1)[1].strip()
        if rest not in (">-", ">", "|"):
            return rest
        folded = []
        for extra in lines[index + 1 :]:
            if extra.startswith("  "):
                folded.append(extra.strip())
            elif not extra.strip():
                continue
            else:
                break
        return " ".join(folded).strip()
    return ""


def skill_body(name: str) -> str:
    _, body = skill_text(name)
    return body


def skill_text(name: str) -> tuple[str, str]:
    path = AGENT / "skills" / name / "SKILL.md"
    text = path.read_text(encoding="utf-8")
    if not text.startswith("---\n"):
        raise ValueError(str(path) + " 缺少开头的说明")
    end = text.find("\n---", 3)
    if end < 0:
        raise ValueError(str(path) + " 缺少说明的结束")
    description = _description(text[4:end])
    body = text[end + 4 :].strip()
    if not description or not body:
        raise ValueError(str(path) + " 缺少 description 或正文")
    return description, body


def system_prompt() -> str:
    parts = [read_text(HERE / "system_prompt.md")]
    for name in DIALOGUE:
        description, body = skill_text(name)
        parts.append("## 技能 " + name + "\n" + description + "\n\n" + body)
    return "\n\n".join(parts)


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
