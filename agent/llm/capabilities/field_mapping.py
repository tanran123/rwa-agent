"""字段映射。表头 + 标准字段 → 列或常量。

三种口径共用同一份 ``measure-mapping`` / ``measure-field-map`` 技能：
产品标准字段、分类字段全量映射、上传表抽列。
"""

from __future__ import annotations

import re
from typing import Any

from agent.llm.agents.capability import capability
from agent.llm.capabilities.jsonx import extract_json

_STANDARD_TASK = (
    "这些产品标准字段还没有对上 Excel 表头。这份明细用来做信用风险 RWA（风险加权资产）："
    "先判断风险暴露类别，再算敞口，再乘风险权重。请根据表头和抽样值判断每一列是干什么的，"
    "只对给出的字段。"
)
_COMPLETE_TASK = "这是一份信用风险明细，要计算 RWA。请把每一个字段都对应上。"
_EXTRACT_TASK = (
    "用户上传了这份 Excel，需要用它计算信用风险 RWA（风险加权资产）。"
    "请从表格内容里提取计算要用的列。"
)


def _clean_fields(fields: list[dict]) -> list[dict]:
    return [
        item
        for item in fields
        if isinstance(item, dict) and str(item.get("id") or "").strip()
    ]


def _ask(name: str, skill: str, payload: dict, timeout: int = 120) -> dict:
    raw = capability(name, skill, timeout=timeout).ask(payload)
    return extract_json(raw)


def standard_fields(
    headers: list[str],
    fields: list[dict],
    samples: list[dict] | None = None,
    column_values: dict | None = None,
) -> dict:
    """产品标准字段对不上表头时，只让模型补这些字段。column 必须是表头原文。"""
    names = [str(item) for item in headers if str(item).strip()]
    clean = _clean_fields(fields)
    if not names or not clean:
        return {"mapping": {}}
    values = column_values if isinstance(column_values, dict) else {}
    payload = {
        "task": _STANDARD_TASK,
        "headers": names,
        "samples": (samples or [])[:3],
        "columnValues": {str(key): values[key] for key in values if str(key) in names},
        "fields": clean,
    }
    parsed = _ask("cap-field-map", "measure-field-map", payload)
    incoming = parsed.get("mapping") if isinstance(parsed.get("mapping"), dict) else {}
    allowed = set(names)
    found: dict[str, dict] = {}
    for field in clean:
        fid = str(field.get("id") or "").strip()
        slot = incoming.get(fid) if isinstance(incoming, dict) else None
        column = ""
        reason = ""
        if isinstance(slot, dict):
            column = str(slot.get("column") or "").strip()
            reason = str(slot.get("reason") or "").strip()[:80]
        if column in allowed:
            found[fid] = {"column": column, "reason": reason or "模型对到该列"}
        else:
            found[fid] = {"column": "", "reason": reason or "模型没有对上"}
    return {"mapping": found}


def _normalize_slot(slot: object, allowed: set[str]) -> dict:
    if isinstance(slot, str) and re.fullmatch(r"[A-Za-z]+", slot.strip()):
        slot = {"column": slot.strip().upper()}
    if not isinstance(slot, dict):
        return {"status": "missing", "reason": "模型没有给出这一项"}
    if slot.get("missing") is True or str(slot.get("status") or "") == "missing":
        return {"status": "missing", "reason": str(slot.get("reason") or "底稿没有")[:80]}
    letter = str(slot.get("column") or slot.get("letter") or "").strip().upper()
    const = slot.get("const")
    reason = str(slot.get("reason") or "").strip()[:80]
    if letter and letter in allowed:
        return {"status": "column", "column": letter, "reason": reason or ("模型对到 " + letter)}
    if const is not None and str(const).strip() and str(const).strip().lower() not in {"null", "none", "unknown"}:
        return {
            "status": "const",
            "const": const if isinstance(const, (int, float)) else str(const).strip(),
            "reason": reason or "模型按整表取值",
        }
    return {"status": "missing", "reason": reason or "底稿没有"}


def complete_map(
    headers: list[dict],
    fields: list[dict],
    table: dict | None = None,
    task: str = _COMPLETE_TASK,
) -> dict:
    """每个分类字段都要有结论：对到列、整表常量，或底稿没有。"""
    if not headers:
        raise ValueError("这一行没有读到表头")
    clean = _clean_fields(fields)
    if not clean:
        raise ValueError("没有需要对应的字段")
    payload = {"task": task, "workbook": table or {}, "fields": clean, "headers": headers}
    parsed = _ask("cap-complete-map", "measure-mapping", payload)
    incoming = parsed.get("mapping") if isinstance(parsed.get("mapping"), dict) else {}
    allowed = {str(item.get("column") or "") for item in headers}
    found: dict[str, dict] = {}
    for field in clean:
        fid = str(field.get("id") or "").strip()
        found[fid] = _normalize_slot(incoming.get(fid) if isinstance(incoming, dict) else None, allowed)
    return {"mapping": found, "extract": str(parsed.get("extract") or "").strip()[:240]}


def extract_map(
    headers: list[dict],
    fields: list[dict],
    table: dict | None = None,
    task: str = _EXTRACT_TASK,
) -> dict:
    """把用户上传的 Excel 交给模型，提取要用的列；对不上时用字段示例当常量。"""
    if not headers:
        raise ValueError("这一行没有读到表头")
    clean = _clean_fields(fields)
    if not clean:
        raise ValueError("没有需要对应的字段")
    payload = {"task": task, "workbook": table or {}, "fields": clean, "headers": headers}
    parsed = _ask("cap-extract-map", "measure-extract", payload)
    incoming = parsed.get("mapping") if isinstance(parsed.get("mapping"), dict) else parsed
    if not isinstance(incoming, dict):
        incoming = {}
    allowed = {str(item.get("column") or "") for item in headers}
    used: set[str] = set()
    mapped: dict[str, dict] = {}
    for field in clean:
        fid = str(field.get("id") or "").strip()
        slot = incoming.get(fid)
        letter = ""
        const = ""
        reason = ""
        if isinstance(slot, dict):
            letter = str(slot.get("column") or slot.get("letter") or "").strip().upper()
            const = str(slot.get("const") or slot.get("value") or "").strip()
            reason = str(slot.get("reason") or "").strip()[:80]
        elif isinstance(slot, str):
            token = slot.strip()
            if re.fullmatch(r"[A-Za-z]+", token):
                letter = token.upper()
            else:
                const = token
        if re.fullmatch(r"[A-Z]+", letter) and letter in allowed and letter not in used:
            mapped[fid] = {"column": letter, "reason": reason or ("模型对应到 " + letter)}
            used.add(letter)
            continue
        if not const:
            const = str(field.get("sample") or "").strip() or "未提供"
            reason = reason or "表里没有能对上的列，先用字段示例作常量"
        mapped[fid] = {"const": const[:80], "reason": reason or "表里没有这一列，模型填了常量"}
    return {
        "mapping": mapped,
        "extract": str(parsed.get("extract") or "").strip()[:240],
    }


def formula_map(packs: list[dict], headers: list[dict]) -> dict:
    """自建公式的字段映射。packs 已由调用方按产品展开，只做模型请求。"""
    payload = {"formulas": packs, "headers": headers}
    return _ask("cap-formula-map", "measure-formula-map", payload)
