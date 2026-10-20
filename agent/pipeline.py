"""Run the steps named in the delivery pipeline, in that order."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from langchain_core.tools import tool

DELIVERY = Path(__file__).resolve().parents[1] / "交付" / "exposure-weight-decision"
_STEPS_FILE = DELIVERY / "rwa_agent" / "pipeline.py"


def active_steps() -> list[str]:
    text = _STEPS_FILE.read_text(encoding="utf-8")
    found = re.search(r"^STEPS\s*=\s*\[(.*?)\]", text, re.M | re.S)
    if not found:
        return []
    return re.findall(r'"([^"]+)"', found.group(1))


def run_pipeline(source: Path, dest: Path | None = None) -> dict[str, Any]:
    from agent.subagents import ORDER

    programs = {item.NAME: item.program for item in ORDER}
    context: dict[str, Any] = {
        "source": str(Path(source)),
        "dest": str(Path(dest)) if dest else None,
        "steps_ran": [],
    }
    for name in active_steps():
        program = programs.get(name)
        run = getattr(program, "run", None) if program is not None else None
        if not callable(run):
            raise RuntimeError(f"流水线步骤 {name} 还没有实现")
        context = run(context)
        context["steps_ran"].append(name)
        if context.get("stopped"):
            break
    return context


@tool
def pipeline_steps() -> str:
    """List the calculation order. Only names on this list may run."""
    from agent.subagents import ORDER

    active = active_steps()
    lines = [item.program.status() for item in ORDER]
    lines.append("当前顺序：" + " → ".join(active))
    return "\n".join(lines)
