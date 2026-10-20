"""Coordinator. Prompts come from AGENTS.md. Each step lives in subagents/."""

from __future__ import annotations

from agent.chat import model
from agent.layout import ROOT, SKILLS, coordinator_prompt, project
from agent.pages import PAGES, open_page
from agent.pipeline import pipeline_steps

_GRAPH = None


def graph():
    global _GRAPH
    if _GRAPH is None:
        from deepagents import create_deep_agent
        from deepagents.backends.filesystem import FilesystemBackend
        from deepagents.middleware.filesystem import FilesystemPermission

        from agent.subagents import specs

        chat = model()
        meta = project()
        _GRAPH = create_deep_agent(
            model=chat,
            tools=[pipeline_steps, open_page],
            system_prompt=coordinator_prompt(),
            subagents=specs(chat),
            skills=SKILLS,
            backend=FilesystemBackend(root_dir=ROOT, virtual_mode=True),
            permissions=[FilesystemPermission(operations=["write"], paths=["/**"], mode="deny")],
            name=str(meta.get("name") or "rwa-pipeline"),
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
