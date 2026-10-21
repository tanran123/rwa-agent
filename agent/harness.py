"""Coordinator. Prompts come from AGENTS.md. Each step lives in subagents/."""

from __future__ import annotations

import json
import re

from agent.chat import model
from agent.layout import ROOT, SKILLS, coordinator_prompt, project
from agent.pages import PAGES, open_page
from agent.pipeline import pipeline_steps

_GRAPH = None

_FENCE = re.compile(r"```json\s*(.*?)```", re.S)


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
        # 整份配置超过 800 字，截断后模型看不到，所以这一条单独拼、不截断。
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
        # 草稿已经单独带回去，正文里不重复贴一遍整份 JSON。
        text = _FENCE.sub("（修订草稿见下方，确认后才写入文件）", text, count=1).strip()
    return {
        "reply": text[:4000],
        "pages": [{"path": path, "label": PAGES[path]} for path in paths],
        "draft": draft,
    }
