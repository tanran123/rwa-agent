"""Chat model for the coordinator and the subagents."""

from __future__ import annotations

import os
from pathlib import Path

from langchain_openai import ChatOpenAI

from agent.pipeline import DELIVERY


def load_env() -> None:
    root = Path(__file__).resolve().parents[1]
    for env_path in (root / ".env", DELIVERY / ".env"):
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


def model() -> ChatOpenAI:
    load_env()
    key = os.environ.get("DASHSCOPE_API_KEY", "").strip() or os.environ.get("QWEN_API_KEY", "").strip()
    if not key:
        raise RuntimeError("未配置通义千问 API Key")
    base = (os.environ.get("QWEN_BASE_URL") or "https://dashscope.aliyuncs.com/compatible-mode/v1").strip()
    name = (os.environ.get("QWEN_MODEL") or "qwen-plus").strip()
    return ChatOpenAI(model=name, api_key=key, base_url=base, temperature=0)
