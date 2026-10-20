"""Deep Agents harness: weight judgment first, later calculations only if listed."""

from __future__ import annotations

import os
from pathlib import Path

from langchain_openai import ChatOpenAI

from agent.tools import PAGES, open_page, pipeline_steps, run_weight_decision, stop_later_step

_GRAPH = None

_COORDINATOR = """你是信用风险的计算总控，用中文回答。
顺序固定：先做风险暴露权重判断，再做后续计算。
问做到哪一步、后面还算不算时，必须先调用 pipeline_steps，只按工具原文说明哪些会执行、哪些停住。不要另加文件格式限制。
用户给出工作簿并要求计算时，把这一步交给 weight_judge。没有路径就向用户要底稿，不要换成别的文件。
问转换系数、缓释或汇总时交给 later_calc。名单里没有的步骤停住，不要编造转换系数、缓释拆分、权重或金额。
只有用户要看页面时才调用 open_page。不要写密钥，不要改分类 JSON。"""

_WEIGHT = """你负责风险暴露权重判断。
先看 pipeline_steps。weight 在名单里时，用用户给出的工作簿调用 run_weight_decision。
回复只用命令输出里的结果路径、留痕路径、敞口和风险加权资产。失败就转述错误原文。不要自己再算一遍。"""

_LATER = """你负责权重判断之后的计算：ccf、crm、rwa。
对用户问到的每一步调用 stop_later_step。名单里没有的步骤只说明停住。不要编造系数、拆分或另一套风险加权资产。"""


def _load_env() -> None:
    root = Path(__file__).resolve().parents[1]
    for env_path in (root / ".env", root / "交付/exposure-weight-decision/.env"):
        if not env_path.is_file():
            continue
        for line in env_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, val = line.split("=", 1)
            key, val = key.strip(), val.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = val


_load_env()


def _model() -> ChatOpenAI:
    key = os.environ.get("DASHSCOPE_API_KEY", "").strip() or os.environ.get("QWEN_API_KEY", "").strip()
    if not key:
        raise RuntimeError("未配置通义千问 API Key")
    base = (os.environ.get("QWEN_BASE_URL") or "https://dashscope.aliyuncs.com/compatible-mode/v1").strip()
    name = (os.environ.get("QWEN_MODEL") or "qwen-plus").strip()
    return ChatOpenAI(model=name, api_key=key, base_url=base, temperature=0)


def graph():
    global _GRAPH
    if _GRAPH is None:
        from deepagents import create_deep_agent
        from deepagents.backends import StateBackend
        from deepagents.middleware.filesystem import FilesystemPermission

        model = _model()
        _GRAPH = create_deep_agent(
            model=model,
            tools=[pipeline_steps, open_page],
            system_prompt=_COORDINATOR,
            subagents=[
                {
                    "name": "weight_judge",
                    "description": "风险暴露权重判断。按权重法分类、取权重并计算敞口。用户给出工作簿时用它。",
                    "system_prompt": _WEIGHT,
                    "tools": [pipeline_steps, run_weight_decision],
                    "model": model,
                },
                {
                    "name": "later_calc",
                    "description": "权重判断之后的计算：表外转换系数 ccf、缓释 crm、按留痕汇总 rwa。名单里没有的步骤由它停住。",
                    "system_prompt": _LATER,
                    "tools": [pipeline_steps, stop_later_step],
                    "model": model,
                },
            ],
            backend=StateBackend(),
            permissions=[FilesystemPermission(operations=["write"], paths=["/**"], mode="deny")],
            name="rwa-pipeline",
        )
    return _GRAPH


def reply(messages: list[dict], page: str) -> dict:
    cleaned = []
    for item in messages[-8:]:
        role = item.get("role")
        content = str(item.get("content") or "").strip()[:800]
        if role in ("user", "assistant") and content:
            cleaned.append({"role": role, "content": content})
    if not cleaned or cleaned[-1]["role"] != "user":
        raise ValueError("请先输入要沟通的内容")
    cleaned[-1] = {
        "role": "user",
        "content": "当前页面是 " + (page or "/") + "。" + cleaned[-1]["content"],
    }
    result = graph().invoke({"messages": cleaned}, config={"recursion_limit": 40})
    text = ""
    paths = []
    for message in result.get("messages") or []:
        for call in getattr(message, "tool_calls", None) or []:
            if call.get("name") == "open_page":
                target = (call.get("args") or {}).get("path")
                if target in PAGES and target not in paths:
                    paths.append(target)
        content = getattr(message, "content", "")
        if getattr(message, "type", "") == "ai" and isinstance(content, str) and content.strip():
            text = content.strip()
    if not text:
        text = "这次没有形成回答。"
    return {
        "reply": text[:4000],
        "pages": [{"path": path, "label": PAGES[path]} for path in paths],
    }
