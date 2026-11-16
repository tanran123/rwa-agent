"""One place for the model provider, model names, the API key, the base url and repo paths.

The app talks to any OpenAI-compatible ``/chat/completions`` endpoint, not only
DashScope. The account's active Koa ``llm_config`` wins per request (see
``agent.llm.client.use_llm_config``); the environment below is the fallback.
Pick a preset with ``MODEL_PROVIDER`` or point ``MODEL_BASE_URL`` at any
compatible service, then set ``MODEL_API_KEY`` and ``MODEL_NAME`` in the repo
``.env``. ``DASHSCOPE_API_KEY`` is still read as a fallback so existing installs
keep working.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from urllib.parse import urlsplit

REPO = Path(__file__).resolve().parents[2]
AGENT = REPO / "agent"
LLM = AGENT / "llm"
ENV_PATH = REPO / ".env"
CONFIG_PATH = AGENT / "agent.json"

DEFAULT_PROVIDER = "dashscope"
NO_KEY = "not-needed"
LOCAL_HOSTS = {"localhost", "127.0.0.1", "0.0.0.0", "::1"}

# 任何 OpenAI 兼容服务都能用；这里只是 MODEL_BASE_URL 的快捷方式。
PROVIDERS = {
    "dashscope": "https://dashscope.aliyuncs.com/compatible-mode/v1",
    "openai": "https://api.openai.com/v1",
    "deepseek": "https://api.deepseek.com/v1",
    "moonshot": "https://api.moonshot.cn/v1",
    "zhipu": "https://open.bigmodel.cn/api/paas/v4",
    "siliconflow": "https://api.siliconflow.cn/v1",
    "ollama": "http://127.0.0.1:11434/v1",
}


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
    provider: str
    api_key: str
    base_url: str
    chat_model: str
    mapping_model: str
    temperature: float = 0
    max_tokens: int | None = None
    timeout: float | None = None


def _runtime() -> dict:
    data = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    runtime = data.get("runtime") if isinstance(data, dict) else None
    return runtime if isinstance(runtime, dict) else {}


def _runtime_text(runtime: dict, key: str) -> str:
    value = runtime.get(key)
    return value.strip() if isinstance(value, str) else ""


def _provider(runtime: dict) -> str:
    picked = os.environ.get("MODEL_PROVIDER") or _runtime_text(runtime, "provider") or DEFAULT_PROVIDER
    return picked.strip().lower()


def _base_url(provider: str, runtime: dict) -> str:
    explicit = (os.environ.get("MODEL_BASE_URL") or _runtime_text(runtime, "base_url")).strip()
    if explicit:
        return explicit
    preset = PROVIDERS.get(provider)
    if not preset:
        raise RuntimeError(f"未知的 MODEL_PROVIDER：{provider}；请设置 MODEL_BASE_URL")
    return preset


def _chat_model_name(runtime: dict) -> str:
    name = (os.environ.get("MODEL_NAME") or _runtime_text(runtime, "model")).strip()
    if not name:
        raise RuntimeError(f"{CONFIG_PATH} 的 runtime.model 未填写模型，且未设置 MODEL_NAME")
    return name


def _mapping_model_name(chat_model: str) -> str:
    return (os.environ.get("MAPPING_MODEL") or chat_model).strip()


def _api_key(base_url: str, explicit: str = "") -> str:
    key = explicit.strip() or (os.environ.get("MODEL_API_KEY") or os.environ.get("DASHSCOPE_API_KEY") or "").strip()
    if key:
        return key
    host = urlsplit(base_url).hostname or ""
    if host in LOCAL_HOSTS:
        return NO_KEY
    raise RuntimeError("未配置模型 API Key：请在 .env 里设置 MODEL_API_KEY")


def _number(value, default=None, minimum: float = 0.0) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    return number if number >= minimum else default


def from_llm_config(config: dict | None) -> Settings:
    """Turn the active Koa ``llm_config`` row into Settings.

    Koa forwards the current account's default model with each model-backed
    request. An incomplete row falls back to the environment config rather than
    failing the request.
    """
    if not isinstance(config, dict):
        return settings()
    base = str(config.get("base_url") or "").strip()
    model = str(config.get("model") or "").strip()
    if not base or not model:
        return settings()
    load_env()
    max_tokens = _number(config.get("max_tokens"), minimum=1)
    timeout = _number(config.get("timeout"), minimum=1)
    return Settings(
        provider=str(config.get("provider") or "").strip().lower() or "custom",
        api_key=_api_key(base, str(config.get("api_key") or "")),
        base_url=base,
        chat_model=model,
        mapping_model=model,
        temperature=_number(config.get("temperature"), default=0.0) or 0.0,
        max_tokens=int(max_tokens) if max_tokens is not None else None,
        timeout=timeout,
    )


@lru_cache(maxsize=1)
def settings() -> Settings:
    load_env()
    runtime = _runtime()
    provider = _provider(runtime)
    base = _base_url(provider, runtime)
    chat = _chat_model_name(runtime)
    max_tokens = _number(os.environ.get("MODEL_MAX_TOKENS"), minimum=1)
    timeout = _number(os.environ.get("MODEL_TIMEOUT"), minimum=1)
    return Settings(
        provider=provider,
        api_key=_api_key(base),
        base_url=base,
        chat_model=chat,
        mapping_model=_mapping_model_name(chat),
        temperature=_number(os.environ.get("MODEL_TEMPERATURE"), default=0.0) or 0.0,
        max_tokens=int(max_tokens) if max_tokens is not None else None,
        timeout=timeout,
    )


def clear_cache() -> None:
    """Tests and long-running reloads call this after changing the environment."""
    settings.cache_clear()
