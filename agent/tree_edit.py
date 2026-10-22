"""Propose a decision-tree edit. Nothing is written here."""

from __future__ import annotations

import json

from langchain_core.messages import HumanMessage, SystemMessage

from agent.chat import model

_PROMPT = """你是当前这一份信用风险暴露划分决策树的助手。按问答往下走，一次只做一步。
不要新开产品，不要改 name，不要改其他页签。
用户没写出的权重、判断条件、字段编码不要补，也不要改成另一个数。
字段的 code 只能用当前文档 fields.options 里已有的 code。比较只用 eq、in、gt、gte、lt、lte。
叶子上的 value 用小数，并且必须是用户说过的百分比。不要用 0 或 1 充数。

用户点了某一条规则、还没说改成什么样：action 用 explain。
在当前 document 里找到那一条，用白话说明它现在的判断条件和权重是什么意思，然后问要改成什么样。
不要带 document，不要提保存。

用户已经说了改成什么样：action 用 draft，不要再追问是不是这个意思。
不要返回整份 document。changes 里只放被改动的节点，每个节点必须带原来的 name。
只改权重时，节点只写 name 和 value。改判断条件时带上 when。增加或删除子规则时带上完整 children。
没点名的节点不要放进 changes。
reply 只用白话说明改了哪一条、条件是什么意思、权重变成多少，并请用户确认。
不要在 reply 里写 JSON、字段编码或 name。不要提保存。

还没说清是哪一条，或改法里缺权重、缺判断条件：action 用 ask，不要带 changes，在 reply 里问清楚。

只返回一个 JSON 对象，不要 Markdown：
{"action":"explain","reply":"..."}
{"action":"ask","reply":"..."}
{"action":"draft","reply":"...","changes":[{...}]}
"""


def _plain(reply: str) -> str:
    text = reply or ""
    while "```" in text:
        start = text.find("```")
        end = text.find("```", start + 3)
        if end < 0:
            text = text[:start]
            break
        text = text[:start] + text[end + 3:]
    kept = []
    index = 0
    while index < len(text):
        if text[index] in "{[":
            try:
                _, end = json.JSONDecoder().raw_decode(text[index:])
            except json.JSONDecodeError:
                kept.append(text[index])
                index += 1
                continue
            index += end
            continue
        kept.append(text[index])
        index += 1
    lines = [line.strip() for line in "".join(kept).splitlines()]
    return "\n".join(line for line in lines if line).strip()


def _parse(text: str) -> dict:
    start = text.find("{")
    if start < 0:
        raise ValueError("没有形成可写入的分类")
    try:
        body, _ = json.JSONDecoder().raw_decode(text[start:])
    except json.JSONDecodeError as exc:
        raise ValueError("没有形成可写入的分类") from exc
    if not isinstance(body, dict):
        raise ValueError("没有形成可写入的分类")
    return body


def _apply(document: dict, changes: list) -> dict:
    doc = json.loads(json.dumps(document or {}))
    pending = {}
    for item in changes or []:
        if isinstance(item, dict) and isinstance(item.get("name"), str) and item["name"]:
            pending[item["name"]] = item
    if not pending:
        raise ValueError("没有指出改了哪一条")

    def walk(node):
        if not isinstance(node, dict):
            return
        incoming = pending.get(node.get("name"))
        if incoming:
            pending.pop(node["name"], None)
            for key, value in incoming.items():
                if key != "name":
                    node[key] = value
        for child in node.get("children") or []:
            walk(child)
        other = node.get("otherwise")
        if isinstance(other, dict):
            walk(other)

    for rule in doc.get("rules") or []:
        walk(rule)
    if pending:
        missing = next(iter(pending))
        raise ValueError("「" + missing + "」不在当前分类里")
    doc["name"] = (document or {}).get("name") or doc.get("name")
    return doc


def propose(messages: list, document: dict, label: str) -> dict:
    cleaned = []
    for item in (messages or [])[-8:]:
        role = item.get("role") if isinstance(item, dict) else ""
        content = str((item or {}).get("content") or "").strip()[:2000]
        if role in ("user", "assistant") and content:
            cleaned.append(role + "：" + content)
    if not cleaned or not cleaned[-1].startswith("user："):
        raise ValueError("请先输入要改的内容")
    prompt = (
        "当前页签是 " + str(label or "") + "。\n"
        "当前分类 JSON：\n" + json.dumps(document or {}, ensure_ascii=False) + "\n\n"
        + "\n".join(cleaned)
    )
    result = model().invoke([SystemMessage(content=_PROMPT), HumanMessage(content=prompt)])
    text = getattr(result, "content", "")
    if not isinstance(text, str):
        text = str(text or "")
    body = _parse(text)
    action = body.get("action")
    if action == "update":
        action = "draft"
    reply = _plain(str(body.get("reply") or ""))
    if not reply:
        reply = "已经按你说的改好了，请确认。" if action == "draft" else "还需要补充要改的规则和权重。"
    if action not in ("explain", "ask", "draft"):
        action = "ask"
    if action != "draft":
        return {"action": action, "reply": reply[:2000]}
    try:
        if isinstance(body.get("changes"), list):
            doc = _apply(document, body.get("changes"))
        elif isinstance(body.get("document"), dict):
            doc = body.get("document")
            doc["name"] = (document or {}).get("name") or doc.get("name")
        else:
            return {"action": "ask", "reply": _plain(reply)[:2000] or "还需要补充要改的规则和权重。"}
    except ValueError as exc:
        return {"action": "ask", "reply": str(exc)}
    changes = body.get("changes") if isinstance(body.get("changes"), list) else []
    return {
        "action": "draft",
        "reply": (_plain(reply) or "已经按你说的改好了，请确认。")[:2000],
        "label": str(label or "").strip(),
        "changes": changes,
        "document": doc,
    }
