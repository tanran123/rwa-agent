def test_agent_modules_import() -> None:
    import agent.core.pipeline.pipeline  # noqa: F401
    import agent.llm.graph  # noqa: F401
    import agent.core.hqla  # noqa: F401
    import agent.tools  # noqa: F401
    import agent.tree.edit  # noqa: F401
    from agent.storage import CALCULATION, LATEST, checkpointer, store

    assert CALCULATION == ("rwa", "calculation")
    assert LATEST == "latest"
    assert checkpointer is not None
    assert store is not None


def test_no_urllib_model_clients_left() -> None:
    from pathlib import Path

    root = Path(__file__).resolve().parents[2] / "agent"
    offenders = []
    for path in root.rglob("*.py"):
        text = path.read_text(encoding="utf-8")
        if "urllib.request" in text and "chat/completions" in text:
            offenders.append(str(path.relative_to(root)))
    assert offenders == []
