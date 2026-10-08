"""Talk about the rules library by asking the WeKnora knowledge bases."""

from __future__ import annotations

import re

from rwa_agent.mapper import _complete
from rwa_agent.rules import DEFAULT_PACK_RULES, resolve_rules
from rwa_agent.weknora import ask_libraries, chat_libraries

_PERCENT = {
    "capital_ratio",
    "ccf_short",
    "ccf_mid",
    "ccf_long",
    "specific_gov",
    "specific_ig",
}


_OFF_LIBRARY = ("并非来自知识库", "没有检索到", "一般金融知识", "基于一般")
_EMPTY = "知识库里没有找到相关内容。"
_MODEL_MARK = "知识库里没有找到相关内容，以下由模型回答。"
_NO_CONTENT = ("微信知识库里还没有可用的库", "知识库没有返回回答", "没有检索到", "没有找到", "没有相关")


def lookup_basis(title: object) -> str:
    name = str(title or "").strip()[:40]
    if not name or name == "新规则":
        raise ValueError("请先写下规则名称")
    query = (
        f"规则名称是「{name}」。请只根据知识库原文，用一段话写出这条规则的监管依据，"
        "包括相关公告或通告的编号、条款和计量要求。知识库里没有的编号不要写。"
        "没有检索到就说明没找到。不要补充知识库以外的内容，不要写并非来自知识库。"
    )
    result = _from_library(lambda: ask_libraries(query))
    if result is None:
        return _model_basis(name)
    answer = result["answer"]
    if not result["references"] and any(phrase in answer for phrase in ("没有检索到", "没有找到", "无法提供")):
        return _model_basis(name)
    text = _basis_paragraph(answer)
    if text == _EMPTY:
        return _model_basis(name)
    return text


def _basis_paragraph(answer: str) -> str:
    text = _library_only(answer)
    if text == _EMPTY:
        return text
    paragraph = re.sub(r"\s+", " ", text).strip()
    return paragraph[:500]


def discuss_rules(messages: object, rules: object, focus: object) -> dict:
    cleaned = _messages(messages)
    question = next(item["content"] for item in reversed(cleaned) if item["role"] == "user")
    title = _focus_title(rules, focus)
    query = f"关于{title}：{question}" if title else question
    query += "。只根据知识库原文回答。没有检索到就说明没找到，不要补充知识库以外的内容，不要写并非来自知识库。"
    result = _from_library(lambda: chat_libraries(query))
    if result is None:
        return {"reply": _model_answer(cleaned, title), "updates": None}
    reply = _library_only(result["answer"])
    if reply == _EMPTY:
        return {"reply": _model_answer(cleaned, title), "updates": None}
    sources = [item["title"] for item in result["references"] if item.get("title")]
    if sources:
        reply = reply + "\n\n依据：" + "、".join(sources[:4])
    return {"reply": reply[:4000], "updates": None}


def _from_library(call):
    try:
        return call()
    except RuntimeError as exc:
        message = str(exc)
        if any(phrase in message for phrase in _NO_CONTENT):
            return None
        raise


def _model_answer(messages: list[dict], title: str) -> str:
    lines = []
    if title:
        lines.append(f"当前规则：{title}")
    for item in messages:
        who = "用户" if item["role"] == "user" else "助手"
        lines.append(f"{who}：{item['content']}")
    raw = _complete(
        "知识库里没有检索到相关原文。请直接回答用户最后一个问题。"
        "不要编造澳门金管局的公告号、通告编号、条款号或填报表行号。不确定的条文不要写编号。"
        "不要声称这些内容来自知识库。",
        "\n".join(lines),
    )
    return _marked(raw, 4000)


def _model_basis(name: str) -> str:
    raw = _complete(
        "知识库里没有这条规则的原文。用一段话说明这条规则在资本计量里通常指什么。"
        "不要编造公告号、通告编号、条款号或表号。没有确切编号就不要写编号。"
        "不要声称内容来自知识库。",
        f"规则名称是「{name}」。",
    )
    paragraph = re.sub(r"\s+", " ", _marked(raw, 500)).strip()
    return paragraph[:500]


def _marked(raw: str, limit: int) -> str:
    body = str(raw or "").strip()
    if body.startswith(_MODEL_MARK):
        body = body[len(_MODEL_MARK) :].strip()
    if not body:
        raise RuntimeError("模型没有返回回答")
    return (_MODEL_MARK + "\n\n" + body)[:limit]


def _library_only(answer: str) -> str:
    kept = []
    for block in re.split(r"\n\s*\n", answer.strip()):
        if any(phrase in block for phrase in _OFF_LIBRARY):
            break
        kept.append(block)
    text = "\n\n".join(part for part in kept if part.strip()).strip()
    return text or _EMPTY


def _messages(messages: object) -> list[dict]:
    if not isinstance(messages, list) or not messages:
        raise ValueError("请先输入要沟通的内容")
    cleaned = []
    for item in messages[-8:]:
        if not isinstance(item, dict):
            continue
        role = item.get("role")
        if role not in ("user", "assistant"):
            continue
        content = str(item.get("content") or "").strip()
        if not content:
            continue
        cleaned.append({"role": role, "content": content[:800]})
    if not any(item["role"] == "user" for item in cleaned):
        raise ValueError("请先输入要沟通的内容")
    return cleaned


def _focus_title(rules: object, focus: object) -> str:
    if not isinstance(focus, str) or not focus or not isinstance(rules, list):
        return ""
    for item in rules:
        if isinstance(item, dict) and str(item.get("id") or "") == focus:
            return str(item.get("title") or "").strip()[:40]
    return ""


def _updates(raw: object) -> dict:
    if not isinstance(raw, dict):
        return {}
    found = {}
    for pack, patch in raw.items():
        if pack not in DEFAULT_PACK_RULES or not isinstance(patch, dict):
            continue
        item: dict = {}
        title = patch.get("title")
        if isinstance(title, str) and title.strip():
            item["title"] = title.strip()[:40]
        lines = patch.get("lines")
        if isinstance(lines, list):
            texts = [str(line).strip()[:120] for line in lines if str(line).strip()][:4]
            if texts:
                item["lines"] = texts
        steps = patch.get("steps")
        if isinstance(steps, list):
            cleaned_steps = []
            for step in steps[:6]:
                if not isinstance(step, dict):
                    cleaned_steps.append({"title": "", "line": ""})
                    continue
                cleaned_steps.append(
                    {
                        "title": str(step.get("title") or "").strip()[:40],
                        "line": str(step.get("line") or "").strip()[:200],
                    }
                )
            if any(step["title"] or step["line"] for step in cleaned_steps):
                item["steps"] = cleaned_steps
        params = _clean_params(pack, patch.get("params"))
        if params:
            item["params"] = params
        if item:
            found[pack] = item
    return found


def _clean_params(pack: str, params: object) -> dict | None:
    if not isinstance(params, dict):
        return None
    coerced = {}
    for key, value in params.items():
        if key not in DEFAULT_PACK_RULES[pack]:
            continue
        if key == "zero_weight_name":
            coerced[key] = str(value).strip()[:80]
            continue
        try:
            number = float(value)
        except (TypeError, ValueError):
            continue
        if key in _PERCENT and 1 < number <= 100:
            number = number / 100.0
        coerced[key] = number
    if not coerced:
        return None
    try:
        resolved = resolve_rules({pack: coerced})
    except ValueError:
        return None
    return {key: resolved[pack][key] for key in coerced}
