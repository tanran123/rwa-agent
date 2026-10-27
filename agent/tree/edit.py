"""Propose a decision-tree edit. Nothing is written here."""

from __future__ import annotations

import json
from pathlib import Path

from langchain_core.messages import HumanMessage, SystemMessage

from agent.model import model

_SKILL = Path(__file__).resolve().parents[1] / "skills" / "decision-tree" / "SKILL.md"
_OPS = {"eq": True, "in": True, "gt": True, "gte": True, "lt": True, "lte": True}


def _instructions() -> str:
    text = _SKILL.read_text(encoding="utf-8")
    if text.startswith("---"):
        end = text.find("\n---", 3)
        if end >= 0:
            text = text[end + 4 :]
    return text.strip()


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


def _walk(node, visit):
    if not isinstance(node, dict):
        return
    visit(node)
    for child in node.get("children") or []:
        _walk(child, visit)
    other = node.get("otherwise")
    if isinstance(other, dict):
        _walk(other, visit)


def _each(document, visit):
    for rule in (document or {}).get("rules") or []:
        _walk(rule, visit)


def _find(document, name):
    found = {}

    def visit(node):
        if node.get("name") == name and "node" not in found:
            found["node"] = node

    _each(document, visit)
    return found.get("node")


def _index(document):
    found = {}

    def visit(node):
        if isinstance(node.get("name"), str) and node["name"] and node["name"] not in found:
            found[node["name"]] = node

    _each(document, visit)
    return found


def _mentioned(text, value):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return False
    pct = value * 100
    if abs(pct - round(pct)) < 1e-9:
        pct_text = str(int(round(pct)))
    else:
        rounded = round(pct * 10) / 10
        pct_text = str(int(rounded)) if rounded == int(rounded) else str(rounded)
    if pct_text + "%" in text:
        return True
    dec = str(value)
    return "." in dec and dec in text


def _has_weight(node):
    value = node.get("value")
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return True
    weight = node.get("weight")
    if not isinstance(weight, dict):
        return False
    if isinstance(weight.get("same_as"), str) and weight.get("same_as"):
        return True
    return isinstance(weight.get("greater_of"), list) and len(weight["greater_of"]) > 0


def _check_when(when, fields, label):
    if not isinstance(when, dict) or not any(key in when for key in ("all", "any")):
        raise ValueError("「" + label + "」的判断条件不完整")
    for key in ("all", "any"):
        group = when.get(key)
        if group is None:
            continue
        if not isinstance(group, list):
            raise ValueError("「" + label + "」的判断条件不完整")
        for item in group:
            field = fields.get(item.get("field") if isinstance(item, dict) else None)
            if not field:
                raise ValueError("「" + label + "」用了文档里没有的字段")
            if item.get("op") not in _OPS:
                raise ValueError("「" + label + "」用了文档里没有的比较")
            codes = [opt.get("code") for opt in (field.get("options") or []) if isinstance(opt, dict)]
            values = item.get("match")
            values = values if isinstance(values, list) else [values]
            if codes and any(isinstance(value, str) and value not in codes for value in values):
                raise ValueError("「" + label + "」用了字段里没有的取值")


def _check_node(node, fields, names):
    if not isinstance(node, dict) or not node.get("name") or not node.get("label"):
        raise ValueError("有一条规则缺 name 或名称")
    if node["name"] in names:
        raise ValueError("「" + node["label"] + "」已经在当前分类里，要改的话直接说改哪一条")
    names.add(node["name"])
    label = node["label"]
    if node.get("when"):
        _check_when(node["when"], fields, label)
    children = node.get("children") or []
    if not isinstance(children, list):
        raise ValueError("「" + label + "」的下级不是列表")
    for child in children:
        _check_node(child, fields, names)
    other = node.get("otherwise")
    if isinstance(other, dict):
        _check_node(other, fields, names)
    if not children and not other and not _has_weight(node):
        raise ValueError("「" + label + "」没有权重，先不要写入")


def _copy_fields(doc, generic, raw):
    source = {}
    for field in (generic or {}).get("fields") or []:
        if isinstance(field, dict) and isinstance(field.get("name"), str) and field["name"]:
            source[field["name"]] = field
    have = {field.get("name") for field in (doc.get("fields") or []) if isinstance(field, dict)}
    for item in raw or []:
        name = item if isinstance(item, str) else item.get("name") if isinstance(item, dict) else ""
        if not name or name in have:
            continue
        if name not in source:
            raise ValueError("「" + name + "」不在通用分类的字段里")
        doc.setdefault("fields", []).append(json.loads(json.dumps(source[name])))
        have.add(name)


def _leaves(node):
    rows = []

    def visit(item):
        children = item.get("children") or []
        other = item.get("otherwise") if isinstance(item.get("otherwise"), dict) else None
        if not children and not other:
            rows.append(item)

    _walk(node, visit)
    return rows


def _contains_existing(node, names):
    if not isinstance(node, dict):
        return False
    if node.get("name") in names:
        return True
    for child in node.get("children") or []:
        if _contains_existing(child, names):
            return True
    other = node.get("otherwise")
    return isinstance(other, dict) and _contains_existing(other, names)


def _apply_add(document, generic, attach, field_names, said):
    doc = json.loads(json.dumps(document or {}))
    base = generic if isinstance(generic, dict) and generic.get("name") != doc.get("name") else doc
    _copy_fields(doc, base if base is not doc else generic or doc, field_names)
    if not isinstance(attach, list) or not attach:
        raise ValueError("没有指出加在哪一条下面")
    names = set(_index(doc))
    fields = {}
    for field in doc.get("fields") or []:
        if isinstance(field, dict) and field.get("name"):
            fields[field["name"]] = field
    generic_nodes = _index(generic if isinstance(generic, dict) else {})
    added = []
    for item in attach:
        if not isinstance(item, dict):
            raise ValueError("没有指出加在哪一条下面")
        parent = item.get("parent") if isinstance(item.get("parent"), str) else ""
        node = item.get("node")
        if not parent or not isinstance(node, dict):
            raise ValueError("没有指出加在哪一条下面")
        if _contains_existing(node, names):
            continue
        _check_node(node, fields, names)
        copy = json.loads(json.dumps(node))
        if parent == "rules":
            doc.setdefault("rules", []).append(copy)
        else:
            host = _find(doc, parent)
            if not host:
                raise ValueError("「" + parent + "」不在当前分类里")
            host.setdefault("children", []).append(copy)
        added.append(copy)
    if not added:
        raise ValueError("这些分类在当前规则里已经有了。直接说要改哪一条、改成什么样。")
    for node in added:
        for leaf in _leaves(node):
            value = leaf.get("value")
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                continue
            origin = generic_nodes.get(leaf.get("name"))
            if isinstance(origin, dict) and origin.get("value") == value:
                continue
            if _mentioned(said, value):
                continue
            raise ValueError("「" + str(leaf.get("label") or "") + "」的权重没有出现在监管条款或对话里，先不要写入")
    doc["name"] = (document or {}).get("name") or doc.get("name")
    return doc


_CLAUSE_KEYS = (
    ("商业银行", "银行"),
    ("多边开发银行", "多边开发银行"),
    ("公共部门", "公共部门"),
    ("主权", "主权"),
    ("居住", "住宅"),
    ("商用", "商用"),
    ("违约", "逾期"),
    ("零售", "零售"),
    ("资产担保", "资产担保"),
    ("公司", "公司"),
)


def _flat_nodes(document):
    rows = []

    def visit(node, depth):
        rows.append((depth, node))
        for child in node.get("children") or []:
            if isinstance(child, dict):
                visit(child, depth + 1)
        other = node.get("otherwise")
        if isinstance(other, dict):
            visit(other, depth + 1)

    for rule in (document or {}).get("rules") or []:
        if isinstance(rule, dict):
            visit(rule, 0)
    return rows


def _match_clause(title, nodes):
    for needle, key in _CLAUSE_KEYS:
        if needle not in title:
            continue
        hits = []
        for depth, node in nodes:
            label = str(node.get("label") or "")
            if key not in label:
                continue
            if needle == "商业银行" and ("多边" in label or "开发" in label):
                continue
            hits.append((depth, node))
        if hits:
            hits.sort(key=lambda item: item[0])
            return hits[0][1]
    return None


def _user_lines(cleaned):
    prefix = "user："
    return [line[len(prefix):].strip() for line in cleaned if line.startswith(prefix)]


def _library_request(cleaned):
    users = _user_lines(cleaned)
    if not users:
        return False
    last = users[-1]
    blob = "\n".join(users)
    if "条款" not in blob and "监管" not in blob:
        return False
    if "全部" in last or last in ("都要", "所有", "所有条款"):
        return True
    return len(users) == 1 and ("新增" in last or "加" in last) and "第" not in last


def _same_region(clauses, document, label, user_text):
    blob = str((document or {}).get("title") or "") + str(label or "") + user_text
    picked = [item for item in clauses if str(item.get("region") or "") and str(item.get("region")) in blob]
    if picked:
        return picked
    if "澳门" in blob:
        return [item for item in clauses if item.get("jurisdiction") == "MO"]
    return list(clauses)


def _first_version(document, label, clauses, user_text):
    nodes = _flat_nodes(document)
    lines = ["已按监管条款库对过当前分类，这是第一版。"]
    pending = []
    for item in _same_region(clauses, document, label, user_text):
        title = str(item.get("title") or "")
        if "EAD" in title or "转换系数" in title:
            continue
        clause = str(item.get("clause") or "")
        node = _match_clause(title, nodes)
        if node:
            lines.append(clause + " " + title + "：当前是「" + str(node.get("label") or "") + "」。")
        else:
            pending.append(clause + " " + title)
            text = str(item.get("text") or "").strip()
            lines.append(clause + " " + title + "：当前分类里还没有。" + text)
    if len(lines) == 1:
        return ""
    if pending:
        lines.append("还没有的先不写入。要补上或要改已有的，直接说哪一条、改成什么样。")
    else:
        lines.append("这些分类都已经在当前规则里。要改哪一条，直接说。")
    return "\n".join(lines)


def propose(messages: list, document: dict, label: str, generic: dict | None = None, clauses: list | None = None) -> dict:
    cleaned = []
    for item in (messages or [])[-8:]:
        role = item.get("role") if isinstance(item, dict) else ""
        content = str((item or {}).get("content") or "").strip()[:2000]
        if role in ("user", "assistant") and content:
            cleaned.append(role + "：" + content)
    if not cleaned or not cleaned[-1].startswith("user："):
        raise ValueError("请先输入要改的内容")
    user_text = "\n".join(_user_lines(cleaned))
    if _library_request(cleaned):
        reply = _first_version(document, label, clauses or [], user_text)
        if reply:
            return {"action": "ask", "reply": reply[:2000]}
    clause_text = "\n".join(
        str((item or {}).get("text") or "") for item in (clauses or []) if isinstance(item, dict)
    )
    parts = ["当前页签是 " + str(label or "") + "。", "当前分类 JSON：\n" + json.dumps(document or {}, ensure_ascii=False)]
    if isinstance(generic, dict) and generic.get("name") and generic.get("name") != (document or {}).get("name"):
        parts.append("通用分类 JSON：\n" + json.dumps(generic, ensure_ascii=False))
    else:
        parts.append("当前页签就是通用分类。新增时就在这份 JSON 上扩展，不要另造一套键。")
    if clauses:
        parts.append("监管条款：\n" + json.dumps(clauses, ensure_ascii=False))
    parts.append("\n".join(cleaned))
    prompt = "\n\n".join(parts)
    result = model().invoke([SystemMessage(content=_instructions()), HumanMessage(content=prompt)])
    text = getattr(result, "content", "")
    if not isinstance(text, str):
        text = str(text or "")
    try:
        body = _parse(text)
    except ValueError:
        return {"action": "ask", "reply": "这次没有形成可调整的第一版。直接说要改哪一条、改成什么样。"}
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
        if body.get("intent") == "add":
            doc = _apply_add(
                document,
                generic if isinstance(generic, dict) else None,
                body.get("attach"),
                body.get("fields"),
                user_text + "\n" + clause_text,
            )
        elif isinstance(body.get("changes"), list):
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
