"""Run the named steps in order. Only names in STEPS may run."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from langchain_core.tools import tool

STEPS = ["weight"]


def active_steps() -> list[str]:
    return list(STEPS)


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


if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        raise SystemExit("用法: python -m agent.pipeline 工作簿.xlsx [结果.xlsx]")
    done = run_pipeline(Path(sys.argv[1]), Path(sys.argv[2]) if len(sys.argv) > 2 else None)
    if done.get("stopped"):
        raise SystemExit(done.get("stop_reason") or "计算停住了")
    print(done.get("annotated") or "")
    print(done.get("trace_file") or "")
    print("敞口", done.get("ead_yi"), "亿  风险加权资产", done.get("rwa_yi"), "亿")
