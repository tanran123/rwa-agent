"""Coordinator. Memory is AGENTS.md. Skills and subagent prompts live under .deepagents/."""

from __future__ import annotations

import json
import re

from agent.chat import model
from agent.layout import MEMORY, ROOT, SKILLS, project
from agent.pages import PAGES, open_page
from agent.pipeline import pipeline_steps

_GRAPH = None

_FENCE = re.compile(r"```json\s*(.*?)```", re.S)


def _profile(chat) -> None:
    from deepagents import GeneralPurposeSubagentProfile, HarnessProfile, register_harness_profile
    from deepagents._models import get_model_identifier, get_model_provider

    provider = get_model_provider(chat)
    identifier = get_model_identifier(chat)
    if not provider or not identifier:
        raise RuntimeError("通义模型没有对上 deepagents 的配置键")
    register_harness_profile(
        provider + ":" + identifier,
        HarnessProfile(
            general_purpose_subagent=GeneralPurposeSubagentProfile(enabled=False),
            excluded_tools=frozenset({"write_file", "edit_file", "delete", "execute"}),
        ),
    )


def graph():
    global _GRAPH
    if _GRAPH is None:
        from deepagents import create_deep_agent
        from deepagents.backends.filesystem import FilesystemBackend
        from deepagents.middleware.filesystem import FilesystemPermission

        from agent.subagents import specs

        chat = model()
        meta = project()
        _profile(chat)
        _GRAPH = create_deep_agent(
            model=chat,
            tools=[pipeline_steps, open_page],
            memory=MEMORY,
            skills=SKILLS,
            subagents=specs(chat),
            backend=FilesystemBackend(root_dir=ROOT),
            permissions=[FilesystemPermission(operations=["write"], paths=["/**"], mode="deny")],
            name=str(meta.get("name") or "rwa-pipeline"),
        )
    return _GRAPH


def draft_of(text: str) -> dict | None:
    """取回复里 ```json 代码块那份修订草稿。取不到就返回 None。"""
    match = _FENCE.search(text or "")
    if not match:
        return None
    try:
        data = json.loads(match.group(1).strip())
    except (ValueError, TypeError):
        return None
    return data if isinstance(data, dict) else None


def reply(messages: list[dict], page: str, config: dict | None = None) -> dict:
    cleaned = []
    for item in messages[-8:]:
        role = item.get("role")
        content = str(item.get("content") or "").strip()[:800]
        if role in ("user", "assistant") and content:
            cleaned.append({"role": role, "content": content})
    if not cleaned or cleaned[-1]["role"] != "user":
        raise ValueError("请先输入要沟通的内容")
    tail = cleaned[-1]["content"]
    if config:
        cleaned[-1] = {
            "role": "user",
            "content": (
                "当前页面是 " + (page or "/") + "。这是当前的 EAD 配置 JSON："
                + json.dumps(config, ensure_ascii=False)
                + "。请按这条修订意见改：" + tail
            ),
        }
    else:
        cleaned[-1] = {"role": "user", "content": "当前页面是 " + (page or "/") + "。" + tail}
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
    draft = draft_of(text) if config else None
    if draft is not None:
        text = _FENCE.sub("（修订草稿见下方，确认后才写入文件）", text, count=1).strip()
    return {
        "reply": text[:4000],
        "pages": [{"path": path, "label": PAGES[path]} for path in paths],
        "draft": draft,
    }
