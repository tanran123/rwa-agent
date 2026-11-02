"""Compatibility adapter for market-risk field mapping.

The model calls moved to ``agent.llm.capabilities.field_mapping``. Excel
reading and the safety checks below stay here because they never call a model.
"""

from __future__ import annotations

import re
from pathlib import Path

import openpyxl
from openpyxl.utils import get_column_letter

from agent.llm.capabilities.field_mapping import complete_map, extract_map, formula_map
from agent.llm.capabilities.jsonx import extract_json as _extract_json
from agent.core.market.calculator import PACK_FORMULA
from agent.core.market.fields import FIELD_HINT, FIELD_LABEL, OPTIONAL, PACK_TITLE, REQUIRED


def suggest_field_map(headers: list[dict], fields: list[dict], table: dict | None = None) -> dict[str, dict]:
    """把用户上传的 Excel 交给模型，由模型提取要用的列。"""
    return extract_map(headers, fields, table)


def suggest_mappings(path: str | Path, sheet_name: str, header_row: int, products: list[str]) -> dict[str, dict[str, str]]:
    wanted = [product for product in products if product in REQUIRED]
    if not wanted:
        raise ValueError("请先选择计算方式")
    headers = _header_samples(path, sheet_name, header_row)
    if not headers:
        raise ValueError("这一行没有读到表头")
    parsed = formula_map(_packs(wanted), headers)
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


def _packs(products: list[str]) -> list[dict]:
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
    return packs


def suggest_complete_map(headers: list[dict], fields: list[dict], table: dict | None = None) -> dict[str, dict]:
    """每个分类字段都要有结论：对到列、整表常量，或底稿没有。"""
    return complete_map(
        headers,
        fields,
        table,
        task="这是明天演示用的信用风险底稿。请把每一个字段都对应上，然后才能计算 RWA。",
    )


def _one_line(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, str) and value.startswith("="):
        return ""
    text = re.sub(r"\s+", " ", str(value)).strip()
    return text
