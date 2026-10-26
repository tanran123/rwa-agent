"""Weight subagent. Its program and the Python that program calls live in this directory."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

from langchain_core.tools import tool

from agent.layout import SKILLS, subagent_prompt
from agent.pipeline import active_steps, pipeline_steps
from agent.subagents.weight.program import NAME

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]


@tool
def run_weight_decision(workbook: str) -> str:
    """Run the weight step on one credit-risk workbook. workbook is an existing .xlsx path."""
    path = Path(workbook).expanduser().resolve()
    if not path.is_file():
        return "找不到工作簿：" + str(path) + "。请给出信用风险底稿的 .xlsx 路径，不要换一本表。"
    if path.suffix.lower() not in {".xlsx", ".xlsm"}:
        return "只接受 .xlsx 或 .xlsm。"
    if NAME not in active_steps():
        return "权重判断不在当前计算名单里，停住。"
    env = os.environ.copy()
    env["PYTHONPATH"] = str(REPO) + os.pathsep + env.get("PYTHONPATH", "")
    try:
        done = subprocess.run(
            [sys.executable, "-m", "agent.subagents.weight.program", str(path)],
            cwd=REPO,
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


def spec(model) -> dict:
    description, prompt = subagent_prompt(NAME)
    return {
        "name": NAME,
        "description": description,
        "system_prompt": prompt,
        "tools": [pipeline_steps, run_weight_decision],
        "skills": SKILLS,
        "model": model,
    }
