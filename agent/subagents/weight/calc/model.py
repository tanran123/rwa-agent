"""调用模型，把明细表的列对到分类字段。密钥从仓库根目录的 .env 读取。"""

from __future__ import annotations

import json
import re
import urllib.error
import urllib.request

from agent.platform.layout import skill_body
from agent.subagents.weight.calc.paths import ENV_PATH

DEFAULT_BASE = "https://dashscope.aliyuncs.com/compatible-mode/v1"
DEFAULT_MODEL = "qwen-plus"


def suggest_standard_fields(headers: list[str], fields: list[dict], samples: list[dict] | None = None, column_values: dict | None = None) -> dict:
    """产品标准字段对不上表头时，只让模型补这些字段。column 必须是表头原文。"""
    names = [str(item) for item in headers if str(item).strip()]
    clean = [item for item in fields if isinstance(item, dict) and str(item.get("id") or "").strip()]
    if not names or not clean:
        return {"mapping": {}}
    values = column_values if isinstance(column_values, dict) else {}
    payload = {
        "task": "这些产品标准字段还没有对上 Excel 表头。这份明细用来做信用风险 RWA（风险加权资产）：先判断风险暴露类别，再算敞口，再乘风险权重。请根据表头和抽样值判断每一列是干什么的，只对给出的字段。",
        "headers": names,
        "samples": (samples or [])[:3],
        "columnValues": {str(key): values[key] for key in values if str(key) in names},
        "fields": clean,
    }
    raw = _complete(_standard_system(), json.dumps(payload, ensure_ascii=False), timeout=120)
    parsed = _extract_json(raw)
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


def suggest_product_types(groups: list[dict], products: list[dict]) -> dict:
    """每一组产品代码都交给模型，产品只能从已配置清单里选。"""
    clean_products = [item for item in products if isinstance(item, dict) and str(item.get("code") or "").strip()]
    clean_groups = [item for item in groups if isinstance(item, dict)]
    if not clean_products or not clean_groups:
        return {"mapping": {}}
    allowed = {str(item.get("code")).strip() for item in clean_products}
    payload = {
        "task": "这些债项明细用来做信用风险 RWA（风险加权资产）：先认出产品，再归类风险暴露、计算敞口并乘风险权重。请为每一组产品代码选择一个已配置产品。",
        "products": [{"code": str(item.get("code")).strip(), "label": str(item.get("label") or ""), "description": str(item.get("description") or "")} for item in clean_products],
        "groups": clean_groups,
    }
    raw = _complete(_product_system(), json.dumps(payload, ensure_ascii=False), timeout=120)
    parsed = _extract_json(raw)
    incoming = parsed.get("mapping") if isinstance(parsed.get("mapping"), dict) else {}
    found: dict[str, dict] = {}
    for group in clean_groups:
        gid = str(group.get("id") or "")
        slot = incoming.get(gid) if isinstance(incoming, dict) else None
        product = ""
        reason = ""
        if isinstance(slot, dict):
            product = str(slot.get("product") or "").strip()
            reason = str(slot.get("reason") or "").strip()[:80]
        elif isinstance(slot, str):
            product = slot.strip()
        if product in allowed:
            found[gid] = {"product": product, "reason": reason or "模型识别为该产品"}
        else:
            found[gid] = {"product": "", "reason": reason or "模型没有对上已配置产品"}
    return {"mapping": found}


def _product_system() -> str:
    return skill_body("measure-product")


def _standard_system() -> str:
    return skill_body("measure-field-map")


def suggest_complete_map(headers: list[dict], fields: list[dict], table: dict | None = None) -> dict[str, dict]:
    """每个分类字段都要有结论：对到列、整表常量，或底稿没有。同一列可以对应多个字段。"""
    if not headers:
        raise ValueError("这一行没有读到表头")
    clean_fields = [item for item in fields if isinstance(item, dict) and str(item.get("id") or "").strip()]
    if not clean_fields:
        raise ValueError("没有需要对应的字段")
    payload = {
        "task": "这是一份信用风险明细，要计算 RWA。请把每一个字段都对应上。",
        "workbook": table or {},
        "fields": clean_fields,
        "headers": headers,
    }
    raw = _complete(_complete_system(), json.dumps(payload, ensure_ascii=False), timeout=120)
    parsed = _extract_json(raw)
    incoming = parsed.get("mapping") if isinstance(parsed.get("mapping"), dict) else {}
    allowed = {str(item.get("column") or "") for item in headers}
    found: dict[str, dict] = {}
    for field in clean_fields:
        fid = str(field.get("id") or "").strip()
        slot = incoming.get(fid) if isinstance(incoming, dict) else None
        found[fid] = _normalize_slot(slot, allowed)
    return {"mapping": found, "extract": str(parsed.get("extract") or "").strip()[:240]}


def _complete_system() -> str:
    return skill_body("measure-mapping")


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
        return {"status": "const", "const": const if isinstance(const, (int, float)) else str(const).strip(), "reason": reason or "模型按整表取值"}
    return {"status": "missing", "reason": reason or "底稿没有"}


def _file_value(name: str) -> str:
    if not ENV_PATH.is_file():
        return ""
    for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
        text = line.strip()
        if not text or text.startswith("#") or "=" not in text:
            continue
        key, val = text.split("=", 1)
        if key.strip() == name:
            return val.strip().strip('"').strip("'")
    return ""


def _complete(system: str, user: str, timeout: int = 90) -> str:
    key = _file_value("DASHSCOPE_API_KEY") or _file_value("MODEL_API_KEY")
    if not key:
        raise RuntimeError("未配置模型 API Key。请写在 " + str(ENV_PATH))
    base = _file_value("MODEL_BASE_URL") or DEFAULT_BASE
    model = _file_value("MODEL_NAME") or DEFAULT_MODEL
    body = json.dumps(
        {
            "model": model,
            "temperature": 0,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        }
    ).encode("utf-8")
    req = urllib.request.Request(
        base.rstrip("/") + "/chat/completions",
        data=body,
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            payload = json.loads(resp.read().decode())
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode(errors="replace")[:300]
        raise RuntimeError(f"模型请求失败：{exc.code} {detail}") from exc
    return payload["choices"][0]["message"]["content"]


def _extract_json(text: str) -> dict:
    raw = text.strip()
    fenced = re.search(r"```(?:json)?\s*(\{.*\})\s*```", raw, re.DOTALL)
    if fenced:
        raw = fenced.group(1)
    start = raw.find("{")
    end = raw.rfind("}")
    if start == -1 or end <= start:
        raise RuntimeError("模型没有返回可用的 JSON")
    return json.loads(raw[start : end + 1])
