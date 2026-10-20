"""Tools for the weight-decision pipeline. Later steps stop until they are on the list."""

from __future__ import annotations

import os
import re
import subprocess
import sys
from pathlib import Path

from langchain_core.tools import tool

DELIVERY = Path(__file__).resolve().parents[1] / "交付" / "exposure-weight-decision"

PLANNED = (
    ("weight", "风险暴露权重判断：按权重法风险暴露分类划分暴露、取权重并计算敞口。"),
    ("ccf", "表外转换系数：只处理表外，等值金额 = 名义金额 × 转换系数。"),
    ("crm", "缓释：把覆盖部分和未覆盖部分拆开，不改原来的风险权重。"),
    ("rwa", "按留痕汇总风险加权资产。"),
)

PAGES = {
    "/engine": "底稿计算",
    "/results": "结果明细",
    "/wizard": "计量向导",
}


def active_steps() -> list[str]:
    text = (DELIVERY / "rwa_agent" / "pipeline.py").read_text(encoding="utf-8")
    found = re.search(r"^STEPS\s*=\s*\[(.*?)\]", text, re.M | re.S)
    if not found:
        return []
    return re.findall(r'"([^"]+)"', found.group(1))


@tool
def pipeline_steps() -> str:
    """List the calculation order. Only names on this list may run."""
    active = active_steps()
    lines = []
    for name, detail in PLANNED:
        state = "会执行" if name in active else "还没进名单，停住，不能编结果"
        lines.append(name + "：" + state + "。" + detail)
    lines.append("当前顺序：" + " → ".join(active))
    return "\n".join(lines)


@tool
def run_weight_decision(workbook: str) -> str:
    """Run the weight step on one credit-risk workbook. workbook is an existing .xlsx path."""
    path = Path(workbook).expanduser().resolve()
    if not path.is_file():
        return "找不到工作簿：" + str(path) + "。请给出信用风险底稿的 .xlsx 路径，不要换一本表。"
    if path.suffix.lower() not in {".xlsx", ".xlsm"}:
        return "只接受 .xlsx 或 .xlsm。"
    if "weight" not in active_steps():
        return "权重判断不在当前计算名单里，停住。"
    env = os.environ.copy()
    env["PYTHONPATH"] = str(DELIVERY) + os.pathsep + env.get("PYTHONPATH", "")
    try:
        done = subprocess.run(
            [sys.executable, "-m", "rwa_agent.pipeline", str(path)],
            cwd=DELIVERY,
            env=env,
            capture_output=True,
            text=True,
            timeout=900,
            check=False,
        )
    except subprocess.TimeoutExpired:
        return "权重判断超时，没有形成结果。"
    if done.returncode != 0:
        detail = (done.stderr or done.stdout or "计算失败").strip()
        return detail[-2000:]
    return (done.stdout or "").strip() or "命令没有输出。"


@tool
def stop_later_step(name: str) -> str:
    """Stop ccf, crm, or rwa when that step is not on the calculation list."""
    step = (name or "").strip().lower()
    known = {item[0]: item[1] for item in PLANNED}
    if step not in known:
        return "没有这一步：" + step
    if step in active_steps():
        return step + " 已在名单里。不要在对话里另算一套数。"
    return step + " 还没有实现。" + known[step] + "流水线停住，不要编造转换系数、缓释拆分或另一套风险加权资产。"


@tool
def open_page(path: str) -> str:
    """Open a product page when the user asks to look at the screen. path is /engine, /results, or /wizard."""
    if path not in PAGES:
        return "没有这个页面：" + path
    return "将打开 " + PAGES[path]
