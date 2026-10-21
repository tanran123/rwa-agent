"""Weight step. Runs the workbook and returns the paths and amounts from that run."""

from __future__ import annotations

from pathlib import Path

from agent.pipeline import active_steps

NAME = "weight"
DETAIL = "风险暴露权重判断：按权重法风险暴露分类划分暴露、取权重并计算敞口。"


def status() -> str:
    state = "会执行" if NAME in active_steps() else "还没进名单，停住，不能编结果"
    return NAME + "：" + state + "。" + DETAIL


def run(context: dict) -> dict:
    source = context.get("source")
    if not source:
        context["stopped"] = True
        context["stop_reason"] = "没有工作簿路径"
        return context
    from agent.subagents.weight.calc.paper_calc import run_workbook

    dest = Path(context["dest"]) if context.get("dest") else None
    done = run_workbook(Path(source), dest)
    context["result"] = done
    context["annotated"] = done.get("annotated") or ""
    context["trace_file"] = done.get("trace_file") or ""
    context["ead_yi"] = done.get("ead_yi")
    context["rwa_yi"] = done.get("rwa_yi")
    return context


if __name__ == "__main__":
    import sys

    from agent.pipeline import run_pipeline

    if len(sys.argv) < 2:
        raise SystemExit("用法: python -m agent.subagents.weight.program 工作簿.xlsx [结果.xlsx]")
    done = run_pipeline(Path(sys.argv[1]), Path(sys.argv[2]) if len(sys.argv) > 2 else None)
    if done.get("stopped"):
        raise SystemExit(done.get("stop_reason") or "计算停住了")
    print(done.get("annotated") or "")
    print(done.get("trace_file") or "")
    print("敞口", done.get("ead_yi"), "亿  风险加权资产", done.get("rwa_yi"), "亿")
