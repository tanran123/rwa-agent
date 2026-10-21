"""Call the WeKnora knowledge base with an API key."""

from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request

_DEFAULT_BASE = "https://weknora.weixin.qq.com/api/v1"
_ID = re.compile(r"^[A-Za-z0-9_-]{1,80}$")
_rule_session = ""


def list_bases() -> list[dict]:
    payload = _json("GET", "/knowledge-bases")
    items = payload.get("data") if isinstance(payload.get("data"), list) else []
    bases = []
    for item in items:
        if not isinstance(item, dict):
            continue
        base_id = str(item.get("id") or "")
        if not _ID.match(base_id):
            continue
        bases.append(
            {
                "id": base_id,
                "name": str(item.get("name") or "未命名").strip()[:80] or "未命名",
                "description": str(item.get("description") or "").strip()[:200],
            }
        )
    return bases


def ask(query: str, knowledge_base_id: str) -> dict:
    text = _question(query)
    if not _ID.match(knowledge_base_id or ""):
        raise ValueError("请先选择一个知识库")
    return _chat(text, [knowledge_base_id], reuse=False)


def ask_libraries(query: str) -> dict:
    text = _question(query)
    ids = [item["id"] for item in list_bases()]
    if not ids:
        raise RuntimeError("微信知识库里还没有可用的库")
    return _chat(text, ids, reuse=False)


def chat_libraries(query: str) -> dict:
    text = _question(query)
    ids = [item["id"] for item in list_bases()]
    if not ids:
        raise RuntimeError("微信知识库里还没有可用的库")
    return _chat(text, ids, reuse=True)


def _question(query: str) -> str:
    text = str(query or "").strip()
    if not text:
        raise ValueError("请先写下要问的内容")
    if len(text) > 800:
        raise ValueError("问题请少于 800 字")
    return text


def _chat(query: str, knowledge_base_ids: list[str], reuse: bool) -> dict:
    global _rule_session
    session_id = _rule_session if reuse and _ID.match(_rule_session) else ""
    if not session_id:
        session_id = _new_session("规则库对话" if reuse else "RWA")
        if reuse:
            _rule_session = session_id
    try:
        raw = _read(
            "POST",
            "/knowledge-chat/" + session_id,
            {"query": query, "knowledge_base_ids": knowledge_base_ids},
            timeout=120,
        )
    except RuntimeError:
        if not reuse:
            raise
        _rule_session = _new_session("规则库对话")
        raw = _read(
            "POST",
            "/knowledge-chat/" + _rule_session,
            {"query": query, "knowledge_base_ids": knowledge_base_ids},
            timeout=120,
        )
    answer, references, error = _parse_sse(raw)
    if error and not answer:
        raise RuntimeError(error)
    if not answer:
        raise RuntimeError("知识库没有返回回答")
    return {"answer": answer[:4000], "references": references[:6]}


def _new_session(title: str) -> str:
    created = _json("POST", "/sessions", {"title": title})
    session = created.get("data") if isinstance(created.get("data"), dict) else {}
    session_id = str(session.get("id") or "")
    if not _ID.match(session_id):
        raise RuntimeError("微信知识库没有建立会话")
    return session_id


def _settings() -> tuple[str, str]:
    base = (os.environ.get("WEKNORA_BASE_URL") or _DEFAULT_BASE).strip().rstrip("/")
    key = os.environ.get("WEKNORA_API_KEY", "").strip()
    if not key:
        raise RuntimeError("未配置微信知识库 API Key")
    if not base.startswith("https://"):
        raise RuntimeError("知识库地址无效")
    return base, key


def _json(method: str, path: str, body: dict | None = None) -> dict:
    raw = _read(method, path, body, timeout=30)
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RuntimeError("知识库返回的不是 JSON") from exc
    if not isinstance(payload, dict):
        raise RuntimeError("知识库返回的格式无效")
    if payload.get("success") is False:
        raise RuntimeError(str(payload.get("message") or "知识库请求失败")[:200])
    return payload


def _read(method: str, path: str, body: dict | None, timeout: int) -> str:
    base, key = _settings()
    data = None if body is None else json.dumps(body, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        base + path,
        data=data,
        headers={"X-API-Key": key, "Content-Type": "application/json", "Accept": "application/json"},
        method=method,
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:240]
        raise RuntimeError(f"知识库请求失败：{exc.code} {detail}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError("连不上微信知识库") from exc


def _parse_sse(raw: str) -> tuple[str, list[dict], str]:
    answer: list[str] = []
    references: list[dict] = []
    error = ""
    for block in raw.split("\n\n"):
        data = "\n".join(line[5:].strip() for line in block.splitlines() if line.startswith("data:")).strip()
        if not data or data == "[DONE]":
            continue
        try:
            event = json.loads(data)
        except json.JSONDecodeError:
            continue
        if not isinstance(event, dict):
            continue
        kind = str(event.get("response_type") or "")
        if kind == "answer":
            answer.append(str(event.get("content") or ""))
        elif kind == "references":
            references.extend(_references(event.get("knowledge_references")))
        elif kind == "error":
            error = str(event.get("content") or "知识库没有答上来")[:200]
    return "".join(answer).strip(), references, error


def _references(value: object) -> list[dict]:
    if not isinstance(value, list):
        return []
    found = []
    for item in value[:6]:
        if not isinstance(item, dict):
            continue
        title = str(item.get("knowledge_title") or item.get("title") or item.get("knowledge_filename") or "").strip()
        content = str(item.get("content") or "").strip()
        if not title and not content:
            continue
        found.append({"title": title[:80] or "引用", "content": content[:240]})
    return found
