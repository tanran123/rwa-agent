"""Run the named steps in order. Only names in STEPS may run."""

from __future__ import annotations

import uuid
from pathlib import Path
from typing import Any

from langchain_core.tools import tool

from agent.calculation.registry import ENABLED, active_names, status_lines

# Kept for callers and docs that still read ``pipeline.STEPS``. The registry is
# the source of truth; this list is derived from it.
STEPS = list(ENABLED)


def active_steps() -> list[str]:
    return active_names()


def run_pipeline(source: Path, dest: Path | None = None, thread_id: str | None = None) -> dict[str, Any]:
    from agent.calculation.graph import calculation

    state: dict[str, Any] = {
        "source": str(Path(source)),
        "dest": str(Path(dest)) if dest else None,
        "steps_ran": [],
    }
    config = {"configurable": {"thread_id": thread_id or str(uuid.uuid4())}}
    return calculation().invoke(state, config)


@tool
def pipeline_steps() -> str:
    """问做到哪一步、后面还算不算时调用。返回哪些步骤会执行、哪些停住。不要据此编造系数或金额。"""
    active = active_steps()
    lines = status_lines()
    lines.append("当前顺序：" + " → ".join(active))
    return "\n".join(lines)


if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        raise SystemExit("用法: python -m agent.calculation.pipeline 工作簿.xlsx [结果.xlsx]")
    done = run_pipeline(Path(sys.argv[1]), Path(sys.argv[2]) if len(sys.argv) > 2 else None)
    if done.get("stopped"):
        raise SystemExit(done.get("stop_reason") or "计算停住了")
    print(done.get("annotated") or "")
    print(done.get("trace_file") or "")
    print("敞口", done.get("ead_yi"), "亿  风险加权资产", done.get("rwa_yi"), "亿")
