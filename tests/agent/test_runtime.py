from types import SimpleNamespace

import pytest

from agent.runtime import model as runtime_model
from agent.runtime import settings as runtime_settings


@pytest.fixture(autouse=True)
def fresh_settings(monkeypatch):
    monkeypatch.setenv("DASHSCOPE_API_KEY", "test-key")
    monkeypatch.delenv("MODEL_API_KEY", raising=False)
    monkeypatch.delenv("MODEL_NAME", raising=False)
    monkeypatch.delenv("MODEL_BASE_URL", raising=False)
    runtime_settings.clear_cache()
    yield
    runtime_settings.clear_cache()


def test_chat_model_name_comes_from_agent_json() -> None:
    assert runtime_settings.settings().chat_model == "qwen-plus"


def test_mapping_model_can_be_overridden(monkeypatch) -> None:
    monkeypatch.setenv("MODEL_NAME", "qwen-max")
    runtime_settings.clear_cache()
    assert runtime_settings.settings().mapping_model == "qwen-max"


def test_chat_model_builds_the_configured_client() -> None:
    client = runtime_model.chat_model("chat")
    assert client.model_name == "qwen-plus"


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
