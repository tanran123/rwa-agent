"""入口仍叫 rwa_agent.paper_calc。程序在 agent/subagents/weight/calc/paper_calc.py。"""

from rwa_agent._agent_path import REPO  # noqa: F401
from agent.subagents.weight.calc import paper_calc as _impl

globals().update({name: value for name, value in vars(_impl).items() if not name.startswith("__")})


if __name__ == "__main__":
    import sys
    from pathlib import Path

    if len(sys.argv) < 2:
        raise SystemExit("用法: python -m rwa_agent.paper_calc 工作簿.xlsx")
    done = run_workbook(Path(sys.argv[1]), Path(sys.argv[2]) if len(sys.argv) > 2 else None)
    print(done.get("annotated") or "")
    print(done.get("trace_file") or "")
    print("敞口", done.get("ead_yi"), "亿  风险加权资产", done.get("rwa_yi"), "亿")
