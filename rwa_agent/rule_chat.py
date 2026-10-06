"""Talk about the rules library. Parameter changes are returned for the user to confirm."""

from __future__ import annotations

import json

from rwa_agent.mapper import _complete, _extract_json
from rwa_agent.rules import DEFAULT_PACK_RULES, resolve_rules

_PERCENT = {
    "capital_ratio",
    "ccf_short",
    "ccf_mid",
    "ccf_long",
    "specific_gov",
    "specific_ig",
}


def discuss_rules(messages: object, rules: object, focus: object) -> dict:
    cleaned = _messages(messages)
    snapshot = _snapshot(rules)
    focus_id = focus if isinstance(focus, str) and focus in DEFAULT_PACK_RULES else ""
    raw = _complete(
        _system(),
        json.dumps({"focus": focus_id, "rules": snapshot, "messages": cleaned}, ensure_ascii=False),
    )
    try:
        parsed = _extract_json(raw)
    except (RuntimeError, json.JSONDecodeError):
        raise RuntimeError("模型没有返回可用的回复") from None
    if not isinstance(parsed, dict):
        raise RuntimeError("模型没有返回可用的回复")
    reply = str(parsed.get("reply") or "").strip()[:800] or "我没有形成可用的回复。"
    updates = _updates(parsed.get("updates"))
    return {"reply": reply, "updates": updates or None}


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


def _snapshot(rules: object) -> list[dict]:
    if not isinstance(rules, list):
        return []
    found = []
    for item in rules[:8]:
        if not isinstance(item, dict):
            continue
        pack = str(item.get("id") or "")
        if pack not in DEFAULT_PACK_RULES:
            continue
        lines = item.get("lines") if isinstance(item.get("lines"), list) else []
        steps = item.get("steps") if isinstance(item.get("steps"), list) else []
        params = item.get("params") if isinstance(item.get("params"), list) else []
        found.append(
            {
                "id": pack,
                "title": str(item.get("title") or "")[:40],
                "lines": [str(line)[:120] for line in lines[:4]],
                "steps": [
                    {
                        "title": str(step.get("title") or "")[:40],
                        "line": str(step.get("line") or "")[:200],
                    }
                    for step in steps[:6]
                    if isinstance(step, dict)
                ],
                "params": [
                    {
                        "id": str(param.get("id") or ""),
                        "label": str(param.get("label") or "")[:40],
                        "kind": str(param.get("kind") or ""),
                        "value": param.get("value"),
                        "display": str(param.get("display") or "")[:40],
                    }
                    for param in params[:12]
                    if isinstance(param, dict)
                ],
            }
        )
    return found


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


def _system() -> str:
    return (
        "你是资本规则库的对话助手。只根据给出的规则回答，用中文，先说结论。"
        "只输出一个 JSON 对象，不要写 Markdown。"
        "格式是 {\"reply\":\"给用户看的话\",\"updates\":null}。"
        "用户只是在问规则时，updates 必须是 null。"
        "用户明确要求修改时，updates 写成 {\"规则id\":{\"params\":{\"参数id\":数值}}}。"
        "也可以改 title、lines、steps。lines 是字符串数组，steps 是 {\"title\",\"line\"} 数组，按原顺序，不要增删步骤。"
        "百分比参数用小数：8% 写成 0.08，10% 写成 0.10。倍数和月数用原数字。"
        "只能改当前规则里已经列出的参数。评级权重表和期限档不能改；用户要改这些时，在 reply 里说明，updates 不要带这些内容。"
        "不要编造新的规则 id，不要改字段映射。"
    )
