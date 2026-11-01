"""One place for model names, the API key, the base url and repo paths."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
AGENT = REPO / "agent"
ENV_PATH = REPO / ".env"
CONFIG_PATH = AGENT / "agent.json"

DEFAULT_BASE = "https://dashscope.aliyuncs.com/compatible-mode/v1"
DEFAULT_MODEL = "qwen-plus"


def load_env(path: Path | None = None) -> None:
    """Read the repo ``.env`` without overriding variables already set."""
    target = path or ENV_PATH
    if not target.is_file():
        return
    for line in target.read_text(encoding="utf-8").splitlines():
        text = line.strip()
        if not text or text.startswith("#") or "=" not in text:
            continue
        key, val = text.split("=", 1)
        key = key.strip()
        val = val.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = val


@dataclass(frozen=True)
class Settings:
    api_key: str
    base_url: str
    chat_model: str
    mapping_model: str


def _chat_model_name() -> str:
    data = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    runtime = data.get("runtime") if isinstance(data, dict) else None
    picked = runtime.get("model") if isinstance(runtime, dict) else None
    name = picked.strip() if isinstance(picked, str) else ""
    if not name:
        raise RuntimeError(str(CONFIG_PATH) + " 的 runtime.model 未填写模型")
    return name


@lru_cache(maxsize=1)
def settings() -> Settings:
    load_env()
    key = os.environ.get("DASHSCOPE_API_KEY", "").strip() or os.environ.get("MODEL_API_KEY", "").strip()
    if not key:
        raise RuntimeError("未配置模型 API Key")
    base = (os.environ.get("MODEL_BASE_URL") or DEFAULT_BASE).strip()
    mapping = (os.environ.get("MODEL_NAME") or DEFAULT_MODEL).strip()
    return Settings(api_key=key, base_url=base, chat_model=_chat_model_name(), mapping_model=mapping)


def clear_cache() -> None:
    """Tests and long-running reloads call this after changing the environment."""
    settings.cache_clear()
