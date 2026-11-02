"""Guard the core/llm boundary introduced by the 2026-11 refactor."""

import importlib
from pathlib import Path

AGENT = Path(__file__).resolve().parents[2] / "agent"
_FORBIDDEN_IMPORTS = ("agent.llm", "agent.runtime.model", "agent.llm.prompts.layout")
_FORBIDDEN_CALLS = ("skill_body(", "chat_model(", "suggest_complete_map(")


def _offenders() -> list[str]:
    found = []
    for path in (AGENT / "core").rglob("*.py"):
        for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
            text = line.strip()
            is_import = text.startswith("import ") or text.startswith("from ")
            if is_import and any(token in text for token in _FORBIDDEN_IMPORTS):
                found.append(f"{path.relative_to(AGENT)}:{number}: {text}")
            elif not is_import and not text.startswith("#") and any(token in text for token in _FORBIDDEN_CALLS):
                found.append(f"{path.relative_to(AGENT)}:{number}: {text}")
    return found


def test_core_does_not_import_the_llm_layer() -> None:
    assert _offenders() == []


def test_only_the_client_builds_a_chat_model() -> None:
    offenders = []
    for path in AGENT.rglob("*.py"):
        if path.parent.name == "llm" and path.name == "client.py":
            continue
        if "ChatOpenAI(" in path.read_text(encoding="utf-8"):
            offenders.append(str(path.relative_to(AGENT)))
    assert offenders == []


def test_capabilities_are_registered_deepagents_graphs() -> None:
    module = importlib.import_module("agent.llm.agents.capability")
    found = module.capability("cap-layering-check", "measure-product")
    assert found.name == "cap-layering-check"
    assert module.capability("cap-layering-check", "measure-product") is found
