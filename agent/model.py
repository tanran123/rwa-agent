"""The chat model. The platform and the decision-tree assistant call model()."""

from __future__ import annotations

import json
import os
from pathlib import Path

from langchain_openai import ChatOpenAI

def load_env() -> None:
    root = Path(__file__).resolve().parents[1]
    for env_path in (root / ".env",):
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
    key = os.environ.get("DASHSCOPE_API_KEY", "").strip() or os.environ.get("MODEL_API_KEY", "").strip()
    if not key:
        raise RuntimeError("未配置模型 API Key")
    path = Path(__file__).resolve().parent / "agent.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    runtime = data.get("runtime") if isinstance(data, dict) else None
    picked = runtime.get("model") if isinstance(runtime, dict) else None
    name = picked.strip() if isinstance(picked, str) else ""
    if not name:
        raise RuntimeError(str(path) + " 的 runtime.model 未填写模型")
    base = (os.environ.get("MODEL_BASE_URL") or "https://dashscope.aliyuncs.com/compatible-mode/v1").strip()
    return ChatOpenAI(model=name, api_key=key, base_url=base, temperature=0)
