"""Ask the model to map formula fields onto the uploaded header row."""

from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request
from pathlib import Path

import openpyxl
from openpyxl.utils import get_column_letter

from rwa_agent.agent import PACK_FORMULA
from rwa_agent.fields import FIELD_HINT, FIELD_LABEL, OPTIONAL, PACK_TITLE, REQUIRED

QWEN_BASE = "https://dashscope.aliyuncs.com/compatible-mode/v1"
QWEN_MODEL = "qwen-plus"


def suggest_mappings(path: str | Path, sheet_name: str, header_row: int, products: list[str]) -> dict[str, dict[str, str]]:
    wanted = [product for product in products if product in REQUIRED]
    if not wanted:
        raise ValueError("请先选择计算方式")
    headers = _header_samples(path, sheet_name, header_row)
    if not headers:
        raise ValueError("这一行没有读到表头")
    raw = _complete(_system(), _user(wanted, headers))
    parsed = _extract_json(raw)
    blob = parsed.get("mappings") if isinstance(parsed.get("mappings"), dict) else parsed
    allowed = {item["column"] for item in headers}
    result: dict[str, dict[str, str]] = {}
    for product in wanted:
        incoming = blob.get(product) if isinstance(blob, dict) else None
        if not isinstance(incoming, dict):
            result[product] = {}
            continue
        used: set[str] = set()
        columns: dict[str, str] = {}
        by_letter = {item["column"]: item for item in headers}
        fields = REQUIRED[product] + OPTIONAL[product]
        for field in fields:
            letter = str(incoming.get(field) or "").strip().upper()
            if field == "position_local":
                letter = _prefer_ead(headers, letter)
            if field in ("issuer_type", "counterparty_type"):
                letter = _prefer_new(headers, letter)
            if not re.fullmatch(r"[A-Z]+", letter) or letter not in allowed or letter in used:
                continue
            if not _accept(field, by_letter[letter]):
                continue
            columns[field] = letter
            used.add(letter)
        result[product] = columns
    return result


def _accept(field: str, column: dict) -> bool:
    samples = [str(item) for item in column.get("samples") or []]
    title = str(column.get("header") or "")
    upper = title.upper()
    if field == "issuer_name" and any(_is_code(sample) for sample in samples):
        return False
    if field in ("rating_sp", "rating_fitch") and samples and all(_is_moodys(sample) for sample in samples):
        return False
    if field.startswith("far_") and not any(token in upper for token in ("FAR", "远端", "LEG")):
        return False
    if field in ("position_local", "mv_mop", "nop_mop") and ("RWA" in upper or upper.startswith("RW")):
        return False
    return True


def _prefer_new(headers: list[dict], letter: str) -> str:
    chosen = next((item for item in headers if item["column"] == letter), None)
    if chosen is None or "ORIGINAL" not in chosen["header"].upper():
        return letter
    stem = chosen["header"].upper().replace("_ORIGINAL", "").replace("ORIGINAL", "")
    for item in headers:
        title = item["header"].upper()
        if "NEW" in title and stem and stem in title.replace("_NEW", "").replace("NEW", ""):
            return item["column"]
    return letter


def _prefer_ead(headers: list[dict], letter: str) -> str:
    chosen = next((item for item in headers if item["column"] == letter), None)
    if chosen is None or "PRE" not in chosen["header"].upper():
        return letter
    for item in headers:
        title = item["header"].upper().replace(" ", "")
        if title.endswith("EAD") and "PRE" not in title and "PRO" not in title and "RWA" not in title:
            return item["column"]
    return letter


def _is_code(sample: str) -> bool:
    text = sample.strip()
    return bool(re.match(r"^(CHN|HKG|S)\d", text) or re.match(r"^[A-Z]{2,4}-[\w-]+$", text))


def _is_moodys(sample: str) -> bool:
    text = sample.strip()
    return bool(re.fullmatch(r"(Aaa|Aa[1-3]|A[1-3]|Baa[1-3]|Ba[1-3]|B[1-3]|Caa[1-3]|Ca|C)", text))


def _header_samples(path: str | Path, sheet_name: str, header_row: int) -> list[dict]:
    wb = openpyxl.load_workbook(path, read_only=True, data_only=False)
    try:
        if sheet_name not in wb.sheetnames:
            raise ValueError(f"没有工作表「{sheet_name}」")
        ws = wb[sheet_name]
        header: list = []
        samples: list[list] = []
        for index, row in enumerate(ws.iter_rows(max_col=45, values_only=True), start=1):
            values = list(row)
            if index < header_row:
                continue
            if index == header_row:
                header = values
                continue
            if any(cell is not None and str(cell).strip() for cell in values):
                samples.append(values)
            if len(samples) >= 3:
                break
    finally:
        wb.close()
    found = []
    for col, cell in enumerate(header):
        title = _one_line(cell)
        if not title:
            continue
        examples = []
        for sample in samples:
            if col >= len(sample):
                continue
            text = _one_line(sample[col])
            if text and text not in examples:
                examples.append(text[:40])
        found.append({"column": get_column_letter(col + 1), "header": title[:80], "samples": examples[:3]})
    return found


def _user(products: list[str], headers: list[dict]) -> str:
    packs = []
    for product in products:
        fields = []
        for field in REQUIRED[product] + OPTIONAL[product]:
            fields.append(
                {
                    "id": field,
                    "label": FIELD_LABEL.get(field, field),
                    "required": field in REQUIRED[product],
                    "hint": FIELD_HINT.get(field, ""),
                }
            )
        packs.append(
            {
                "id": product,
                "title": PACK_TITLE.get(product, product),
                "formula": PACK_FORMULA.get(product, ""),
                "fields": fields,
            }
        )
    return json.dumps({"formulas": packs, "headers": headers}, ensure_ascii=False)


def _system() -> str:
    return (
        "你负责把资本公式的字段映射到上传表的表头。只输出一个 JSON 对象，不要解释。"
        "格式是 {\"mappings\": {\"公式id\": {\"字段id\": \"列字母\"}}}。"
        "一个表头只能分给一个字段。含义对不上就不要填这个字段，不要用序号、分区、item 去凑。"
        "发行人要的是名称文本，客户号和合约号不要填到发行人。"
        "S&P 评级只接受 AAA、AA+、BBB- 这种标普符号。示例若是 A1、Aa1、Aaa，那是穆迪，不要填到 rating_sp。"
        "对手类型、发行人类型优先看主体类型，例如 BIS_ENTITY_TYPE。"
        "币种看 CURRENCY。持仓或敞口金额看 EAD，不要看 RWA、风险权重。"
        "剩余期限看 RESIDUAL_MATURITY。交易编号看合约号 CONTRACT_REFERENCE。"
        "表里没有远端两腿金额时，far_ccy、far_amt 留空。"
    )


def _complete(system: str, user: str) -> str:
    key = (
        os.environ.get("DASHSCOPE_API_KEY", "").strip()
        or os.environ.get("QWEN_API_KEY", "").strip()
    )
    if not key:
        raise RuntimeError("未配置通义千问 API Key")
    base = (os.environ.get("QWEN_BASE_URL") or QWEN_BASE).strip()
    model = (os.environ.get("QWEN_MODEL") or QWEN_MODEL).strip()
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
        with urllib.request.urlopen(req, timeout=90) as resp:
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
        raise RuntimeError("模型没有返回映射")
    return json.loads(raw[start : end + 1])


def _one_line(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, str) and value.startswith("="):
        return ""
    text = re.sub(r"\s+", " ", str(value)).strip()
    return text
