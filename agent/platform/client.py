"""Headless session. The page calls this. There is no terminal UI in this package."""

from __future__ import annotations

import json
import re
import uuid

from langchain.messages import RemoveMessage
from langgraph.types import Command

from agent.platform.turn import catalog_text, noted_page_actions, page_actions

_FENCE = re.compile(r"```json\s*(.*?)```", re.S | re.I)
_KEEP = 16


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


def _drive(compiled, payload, config):
    for _chunk in compiled.stream(payload, config, stream_mode="updates", subgraphs=True):
        pass
    return compiled.get_state(config)


def _trim(compiled, config, messages) -> None:
    extra = [item for item in messages[:-_KEEP] if getattr(item, "id", None)]
    if extra:
        compiled.update_state(config, {"messages": [RemoveMessage(id=item.id) for item in extra]})


def _result(text: str, thread: str, confirm: bool, draft: dict | None = None, actions: list | None = None) -> dict:
    return {
        "reply": text[:4000],
        "pages": [],
        "draft": draft,
        "actions": actions or [],
        "threadId": thread,
        "confirm": confirm,
    }


def form_brief(forms) -> str:
    if not isinstance(forms, list):
        return ""
    lines = []
    for item in forms:
        if not isinstance(item, dict):
            continue
        name = str(item.get("id") or "").strip()
        label = str(item.get("title") or "").strip()
        path = str(item.get("path") or "").strip()
        if not name:
            continue
        parts = []
        for field in item.get("fields") or []:
            if not isinstance(field, dict) or not field.get("key"):
                continue
            piece = str(field["key"]) + "（" + str(field.get("label") or field["key"]) + "）"
            options = field.get("options")
            if isinstance(options, list) and options:
                piece += "，只能是 " + "、".join(str(option) for option in options[:40])
            parts.append(piece)
        if parts:
            head = " ".join(part for part in (path, name, label) if part)
            lines.append(head + "：" + "、".join(parts))
    return "\n".join(lines)


def catalog_brief(catalog, page) -> str:
    current = page or "/"
    if not isinstance(catalog, dict):
        return ""
    forms = []
    for item in catalog.get("forms") or []:
        if isinstance(item, dict) and str(item.get("path") or current) == current:
            forms.append(item)
    lines = ["只处理当前页面 " + current + "。字段值只使用这次对话里已经说出的内容。"]
    scope = catalog.get("scope") if isinstance(catalog.get("scope"), dict) else {}
    jurisdiction = str(scope.get("jurisdiction") or "").strip()
    version = str(scope.get("version") or "").strip()
    if jurisdiction or version:
        lines.append("当前顶栏地区是 " + (jurisdiction or "未选") + "，规则版本是 " + (version or "未选") + "。")
    lines.append("当前页面：")
    for item in catalog.get("pages") or []:
        if isinstance(item, dict) and str(item.get("path") or "") == current:
            lines.append(current + " " + str(item.get("title") or ""))
    lines.append("这一页的接口：")
    for api in catalog.get("apis") or []:
        if isinstance(api, str) and api.strip():
            lines.append(api.strip())
    brief = form_brief(forms)
    if brief:
        lines.append("这一页可填写的表单：")
        lines.append(brief)
    return "\n".join(lines)


def for_page(actions, page, catalog) -> list:
    current = page or "/"
    allowed = set()
    if isinstance(catalog, dict):
        for item in catalog.get("forms") or []:
            if not isinstance(item, dict) or str(item.get("path") or current) != current:
                continue
            name = str(item.get("id") or "").strip()
            if name:
                allowed.add(name)
    kept = []
    for step in actions or []:
        form = step.get("form")
        if form not in allowed:
            continue
        kept.append({
            "path": current,
            "form": form,
            "fields": step.get("fields") if isinstance(step.get("fields"), dict) else {},
            "save": step.get("save") is True,
        })
    return kept


def _step(item) -> dict | None:
    if not isinstance(item, dict):
        return None
    step = {}
    path = item.get("path")
    if isinstance(path, str) and path.startswith("/") and ".." not in path:
        step["path"] = path
    form = item.get("form")
    if isinstance(form, str) and form.strip():
        step["form"] = form.strip()
    fields = item.get("fields")
    if isinstance(fields, dict):
        step["fields"] = fields
    step["save"] = item.get("save") is True
    if not step.get("path") and not step.get("form"):
        return None
    return step


def _steps(data) -> list:
    if not isinstance(data, dict):
        return []
    raw = data.get("actions")
    items = raw if isinstance(raw, list) else None
    if items is None and isinstance(data.get("fields"), dict):
        items = [data]
    steps = []
    for item in items or []:
        step = _step(item)
        if step:
            steps.append(step)
        if len(steps) >= 8:
            break
    return steps


def _object_at(text: str, start: int):
    depth = 0
    in_str = False
    escaped = False
    for index in range(start, len(text)):
        char = text[index]
        if in_str:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_str = False
            continue
        if char == '"':
            in_str = True
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return text[start:index + 1], index + 1
    return "", start


_NOTE = "（已按这些步骤在当前页面执行。删除不会自动做。）"


def coerce_actions(args) -> list:
    if isinstance(args, str):
        try:
            args = json.loads(args)
        except (ValueError, TypeError):
            return []
    if isinstance(args, list):
        args = {"actions": args}
    if not isinstance(args, dict):
        return []
    raw = args.get("actions", args)
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except (ValueError, TypeError):
            return []
    if isinstance(raw, dict):
        raw = [raw]
    return _steps({"actions": raw})


def actions_from_turn(messages) -> list | None:
    last_human = -1
    for index, message in enumerate(messages or []):
        if getattr(message, "type", "") in ("human", "user"):
            last_human = index
    found = None
    for message in (messages or [])[last_human + 1:]:
        for call in getattr(message, "tool_calls", None) or []:
            if call.get("name") == "page_actions":
                found = coerce_actions(call.get("args") or {})
    return found


def strip_actions_json(text: str) -> str:
    body = text or ""
    match = _FENCE.search(body)
    if match:
        try:
            data = json.loads(match.group(1).strip())
        except (ValueError, TypeError):
            data = None
        if isinstance(data, dict) and "actions" in data:
            body = (body[:match.start()] + body[match.end():]).strip()
    found = re.search(r'\{\s*"actions"\s*:', body)
    if not found:
        return body
    raw, end = _object_at(body, found.start())
    try:
        data = json.loads(raw) if raw else None
    except (ValueError, TypeError):
        return body
    if isinstance(data, dict) and "actions" in data:
        return (body[:found.start()] + body[end:]).strip()
    return body


def visible_reply(text: str, ran: bool) -> str:
    body = strip_actions_json(text).strip()
    if ran:
        if _NOTE not in body:
            body = (body + "\n\n" + _NOTE).strip()
        return body or _NOTE
    if body:
        return body
    if body != (text or "").strip():
        return "这一页没有要执行的操作。"
    return (text or "").strip() or "这次没有形成回答。"


def actions_of(text: str):
    body = text or ""
    match = _FENCE.search(body)
    if match:
        try:
            data = json.loads(match.group(1).strip())
        except (ValueError, TypeError):
            data = None
        steps = _steps(data)
        if steps:
            return steps, _FENCE.sub(_NOTE, body, count=1).strip()
    found = re.search(r'\{\s*"actions"\s*:', body)
    if not found:
        return [], body
    raw, end = _object_at(body, found.start())
    try:
        data = json.loads(raw) if raw else None
    except (ValueError, TypeError):
        return [], body
    steps = _steps(data)
    if not steps:
        return [], body
    return steps, (body[:found.start()] + _NOTE + body[end:]).strip()


def reply(messages: list[dict], page: str, config: dict | None = None, thread_id: str | None = None, confirm: bool | None = None, catalog=None) -> dict:
    from agent.platform.graph import graph, thread_config

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
        shown = (
            "当前页面是 " + (page or "/") + "。这是当前的 EAD 配置 JSON："
            + json.dumps(config, ensure_ascii=False)
            + "。请按这条修订意见改：" + tail
        )
    else:
        shown = "当前页面是 " + (page or "/") + "。只根据到这里为止的对话，在这一页上处理：" + tail
    cleaned[-1] = {"role": "user", "content": shown}
    thread = thread_id.strip() if isinstance(thread_id, str) and thread_id.strip() else str(uuid.uuid4())
    run = thread_config(thread)
    compiled = graph()
    token = catalog_text.set(catalog_brief(catalog, page))
    action_token = page_actions.set(None)
    try:
        snapshot = compiled.get_state(run)
        if getattr(snapshot, "interrupts", None):
            if confirm is True or confirm is False:
                snapshot = _drive(compiled, Command(resume={"confirm": confirm}), run)
            else:
                return _result(str(snapshot.interrupts[0].value), thread, True)
        else:
            remembered = (snapshot.values or {}).get("messages") or []
            if remembered:
                _trim(compiled, run, remembered)
                snapshot = _drive(compiled, {"messages": [cleaned[-1]]}, run)
            else:
                snapshot = _drive(compiled, {"messages": cleaned}, run)
        interrupts = getattr(snapshot, "interrupts", None) or ()
        if interrupts:
            text = str(interrupts[0].value)
        else:
            text = ""
            for message in (snapshot.values or {}).get("messages") or []:
                content = getattr(message, "content", "")
                if getattr(message, "type", "") == "ai" and isinstance(content, str) and content.strip():
                    text = content.strip()
        pending = bool(getattr(snapshot, "interrupts", None))
        actions = []
        if not pending:
            history = (snapshot.values or {}).get("messages") or []
            raw_text = text
            parsed, _shown = actions_of(raw_text)
            called = actions_from_turn(history)
            if called is None:
                noted = noted_page_actions()
                called = None if noted is None else coerce_actions(noted)
            chosen = parsed if called is None else called
            actions = for_page(chosen, page, catalog)
            text = visible_reply(raw_text, bool(actions))
        elif not text:
            text = "这次没有形成回答。"
        draft = draft_of(text) if config and not actions else None
        if draft is not None:
            text = _FENCE.sub("（修订草稿见下方，确认后才写入文件）", text, count=1).strip()
        return _result(text, thread, pending, None if pending else draft, None if pending else actions)
    finally:
        catalog_text.reset(token)
        page_actions.reset(action_token)
