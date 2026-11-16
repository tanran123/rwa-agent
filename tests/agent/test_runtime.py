from types import SimpleNamespace

import pytest

from agent.llm import client as runtime_model
from agent.llm import settings as runtime_settings


@pytest.fixture(autouse=True)
def fresh_settings(monkeypatch, tmp_path):
    # Do not let the developer's real .env decide what these tests see.
    monkeypatch.setattr(runtime_settings, "ENV_PATH", tmp_path / "missing.env")
    for name in (
        "MODEL_API_KEY", "MODEL_NAME", "MODEL_BASE_URL", "MODEL_PROVIDER", "MAPPING_MODEL",
        "MODEL_TEMPERATURE", "MODEL_MAX_TOKENS", "MODEL_TIMEOUT",
    ):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("DASHSCOPE_API_KEY", "test-key")
    runtime_settings.clear_cache()
    yield
    runtime_settings.clear_cache()


def test_chat_model_name_comes_from_agent_json() -> None:
    assert runtime_settings.settings().chat_model == "qwen-plus"


def test_any_openai_compatible_provider_can_be_selected(monkeypatch) -> None:
    monkeypatch.setenv("MODEL_PROVIDER", "deepseek")
    monkeypatch.setenv("MODEL_NAME", "deepseek-chat")
    monkeypatch.setenv("MODEL_API_KEY", "sk-deepseek")
    runtime_settings.clear_cache()

    current = runtime_settings.settings()
    assert current.provider == "deepseek"
    assert current.base_url == "https://api.deepseek.com/v1"
    assert current.chat_model == "deepseek-chat"
    assert current.mapping_model == "deepseek-chat"
    assert current.api_key == "sk-deepseek"


def test_explicit_base_url_wins_over_the_provider_preset(monkeypatch) -> None:
    monkeypatch.setenv("MODEL_PROVIDER", "custom")
    monkeypatch.setenv("MODEL_BASE_URL", "https://llm.example.com/v1")
    monkeypatch.setenv("MODEL_NAME", "my-model")
    runtime_settings.clear_cache()

    current = runtime_settings.settings()
    assert current.base_url == "https://llm.example.com/v1"
    assert current.chat_model == "my-model"


def test_unknown_provider_without_base_url_is_reported(monkeypatch) -> None:
    monkeypatch.setenv("MODEL_PROVIDER", "my-gateway")
    runtime_settings.clear_cache()

    with pytest.raises(RuntimeError, match="MODEL_BASE_URL"):
        runtime_settings.settings()


def test_mapping_model_can_be_overridden(monkeypatch) -> None:
    monkeypatch.setenv("MODEL_NAME", "deepseek-chat")
    monkeypatch.setenv("MAPPING_MODEL", "deepseek-reasoner")
    runtime_settings.clear_cache()

    current = runtime_settings.settings()
    assert current.chat_model == "deepseek-chat"
    assert current.mapping_model == "deepseek-reasoner"


def test_local_endpoint_needs_no_key(monkeypatch) -> None:
    monkeypatch.delenv("DASHSCOPE_API_KEY")
    monkeypatch.setenv("MODEL_PROVIDER", "ollama")
    monkeypatch.setenv("MODEL_NAME", "llama3.1")
    runtime_settings.clear_cache()

    assert runtime_settings.settings().api_key == runtime_settings.NO_KEY


def test_missing_key_is_reported(monkeypatch) -> None:
    monkeypatch.delenv("DASHSCOPE_API_KEY")
    monkeypatch.setenv("MODEL_NAME", "deepseek-chat")
    runtime_settings.clear_cache()

    with pytest.raises(RuntimeError, match="MODEL_API_KEY"):
        runtime_settings.settings()


def test_chat_model_builds_the_configured_client(monkeypatch) -> None:
    monkeypatch.setenv("MODEL_PROVIDER", "openai")
    monkeypatch.setenv("MODEL_NAME", "gpt-4o-mini")
    monkeypatch.setenv("MODEL_API_KEY", "sk-openai")
    runtime_settings.clear_cache()

    client = runtime_model.chat_model("chat")
    assert client.model_name == "gpt-4o-mini"
    assert client.openai_api_base == "https://api.openai.com/v1"


def test_active_llm_config_drives_the_model_for_one_request() -> None:
    config = {
        "name": "账号默认模型",
        "provider": "DeepSeek",
        "base_url": "https://api.deepseek.com/v1",
        "model": "deepseek-chat",
        "api_key": "sk-db",
        "temperature": 0.2,
        "max_tokens": 4096,
        "timeout": 45,
    }
    with runtime_model.use_llm_config(config):
        client = runtime_model.chat_model("chat")
        assert client.model_name == "deepseek-chat"
        assert client.openai_api_base == "https://api.deepseek.com/v1"
        assert client.temperature == 0.2
        assert client.max_tokens == 4096
        assert client.request_timeout == 45

    # Leaving the request scope restores the environment configuration.
    assert runtime_model.chat_model("chat").model_name == "qwen-plus"


def test_incomplete_llm_config_falls_back_to_the_environment() -> None:
    assert runtime_settings.from_llm_config({}).chat_model == "qwen-plus"
    assert runtime_settings.from_llm_config({"model": "only-model"}).chat_model == "qwen-plus"


def test_complete_returns_text(monkeypatch) -> None:
    class Fake:
        def invoke(self, messages):
            assert messages[0].content == "system"
            assert messages[1].content == "user"
            return SimpleNamespace(content="回答")

    monkeypatch.setattr(runtime_model, "chat_model", lambda role, timeout=None: Fake())
    assert runtime_model.complete("system", "user") == "回答"


def test_complete_translates_provider_errors(monkeypatch) -> None:
    class Fake:
        def invoke(self, messages):
            raise RuntimeError("boom")

    monkeypatch.setattr(runtime_model, "chat_model", lambda role, timeout=None: Fake())
    with pytest.raises(RuntimeError, match="模型请求失败"):
        runtime_model.complete("system", "user")
