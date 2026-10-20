"""按固定顺序计算。名单在 STEPS，不由模型临时决定下一步。"""

from __future__ import annotations

from pathlib import Path
from typing import Any

# 已实现的步骤才会执行。后续按这个位置接上：
# ccf 只处理表外，crm 拆缓释且不改原权重，rwa 按留痕汇总。
STEPS = ["weight"]


def run_pipeline(source: Path, dest: Path | None = None) -> dict[str, Any]:
    from rwa_agent._agent_path import REPO  # noqa: F401
    from agent.pipeline import run_pipeline as run

    return run(source, dest)


if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        raise SystemExit("用法: python -m rwa_agent.pipeline 工作簿.xlsx [结果.xlsx]")
    done = run_pipeline(Path(sys.argv[1]), Path(sys.argv[2]) if len(sys.argv) > 2 else None)
    if done.get("stopped"):
        raise SystemExit(done.get("stop_reason") or "计算停住了")
    print(done.get("annotated") or "")
    print(done.get("trace_file") or "")
    print("敞口", done.get("ead_yi"), "亿  风险加权资产", done.get("rwa_yi"), "亿")
