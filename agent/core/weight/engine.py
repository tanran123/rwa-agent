"""Shared, deterministic weight engine.

Extracted from the two ``paper_calc`` implementations. Everything here is
byte-identical in both; the pipeline and the working-paper page keep only
their differing functions in their own adapters.

This module must not import a model. Open-weight choices are passed in.
"""

from __future__ import annotations

import re
from datetime import date, datetime
from typing import Any

from agent.core.weight.trace import condition_steps, step

_AMOUNT_HEADERS = (
    "value balance(mop)",
    "o/s bal_mop",
    "equiv to mop",
    "信貸敞口_mop",
    "信贷敞口_mop",
    "剩余可使用额度（澳门元）",
    "剩餘可使用額度（澳門元）",
)

_LOAN_SHEETS = {"term-Loan", "Mortgage", "BILLS", "OD", "額度詳情表", "信用卡未使用額度表"}

_MDB_OFFICIAL = (
    ("IBRD", "世界银行集团"),
    ("IFC", "世界银行集团"),
    ("ASIAN DEVELOPMENT", "亚洲开发银行"),
    ("ASIA ", "亚洲开发银行"),
    ("EBRD", "欧洲复兴开发银行"),
    ("IADB", "泛美开发银行"),
    ("EIB", "欧洲投资银行"),
    ("NIB", "北欧投资银行"),
    ("ISDB", "伊斯兰开发银行"),
    ("COE", "欧洲理事会开发银行"),
)

_NO_CONST = {
    "operating_normal", "no_major_violation_3y", "not_on_dishonest_list", "no_false_statements",
    "annual_audit_opinion", "no_default_3y", "loan_classification_normal", "guarantee_reasonable",
    "profit_tests_met", "no_other_material_risk", "transactor_clean", "meets_minimum_capital",
    "meets_other_capital", "bank_tier", "prudent", "manual_bank_grade", "revenue_mainly_central",
    "cet1_ratio", "leverage_ratio", "debt_ratio", "cashflow_dependent", "financial_industry",
    "state_subsidized_equity", "covered_pool_eligible", "covered_disclosure_ok",
}


def _num(value: Any) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip().replace(",", "")
    if not text or text in {"-", "—"}:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def write_result_workbook(data: dict[str, Any], dest) -> None:
    """把算完的敞口、风险加权资产和字段对应写成可下载的 Excel。"""
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
    from openpyxl.utils import get_column_letter

    book = Workbook()
    header_font = Font(bold=True, color="FFFFFF")
    header_fill = PatternFill("solid", fgColor="1A5F4A")
    thin = Border(
        left=Side(style="thin", color="D9E4DE"),
        right=Side(style="thin", color="D9E4DE"),
        top=Side(style="thin", color="D9E4DE"),
        bottom=Side(style="thin", color="D9E4DE"),
    )
    wrap = Alignment(wrap_text=True, vertical="center")

    def paint(ws, headers: list[str], rows: list[list], widths: list[int]) -> None:
        ws.append(headers)
        for cell in ws[1]:
            cell.font = header_font
            cell.fill = header_fill
            cell.alignment = Alignment(vertical="center")
        for row in rows:
            ws.append(row)
        for col, width in enumerate(widths, 1):
            ws.column_dimensions[get_column_letter(col)].width = width
        for row in ws.iter_rows(min_row=1, max_row=ws.max_row, max_col=len(headers)):
            for cell in row:
                cell.border = thin
                cell.alignment = wrap
        ws.auto_filter.ref = ws.dimensions
        ws.freeze_panes = "A2"
        ws.row_dimensions[1].height = 22

    ead_yi = float(data.get("ead_yi") or 0)
    rwa_yi = float(data.get("rwa_yi") or 0)
    unpriced_yi = float(data.get("unpriced_yi") or 0)
    summary = book.active
    summary.title = "汇总"
    paint(summary, ["项目", "数值", "单位"], [
        ["底稿", data.get("file") or "", ""],
        ["数据日期", data.get("as_of") or "", ""],
        ["敞口", round(ead_yi, 4), "亿元"],
        ["敞口", round(ead_yi * 100_000_000, 2), "澳门元"],
        ["风险加权资产", round(rwa_yi, 4), "亿元"],
        ["风险加权资产", round(rwa_yi * 100_000_000, 2), "澳门元"],
        ["风险加权资产", round(float(data.get("rwa_thousand") or 0), 2), "千澳门元"],
        ["权重未定敞口", round(unpriced_yi, 4), "亿元"],
        ["已对应字段", data.get("mapped_fields") or 0, "个"],
        ["分类字段", data.get("field_count") or 0, "个"],
        ["说明", data.get("note") or "", ""],
    ], [22, 42, 14])

    result = book.create_sheet("分类结果")
    result_rows = []
    for line in data.get("lines") or []:
        ead = float(line.get("ead_yi") or 0)
        rwa = float(line.get("rwa_yi") or 0)
        weight = line.get("weight")
        result_rows.append([
            line.get("part") or "",
            line.get("section") or "",
            line.get("label") or "",
            line.get("weight_text") or ("未定权重" if weight is None else ""),
            line.get("model_reason") or "",
            line.get("count") or 0,
            round(ead, 4),
            round(rwa, 4),
            round(ead * 100_000_000, 2),
            round(rwa * 100_000_000, 2),
        ])
    paint(result, ["明细表", "风险暴露", "细分", "权重", "模型结论", "笔数", "敞口（亿元）", "风险加权资产（亿元）", "敞口（澳门元）", "风险加权资产（澳门元）"], result_rows, [24, 28, 42, 14, 36, 10, 16, 24, 20, 26])

    by_sheet = book.create_sheet("分表")
    sheet_rows = []
    for sheet in data.get("sheets") or []:
        sheet_rows.append([
            sheet.get("sheet") or "",
            sheet.get("rows") or 0,
            sheet.get("mapped") or 0,
            round(float(sheet.get("ead_yi") or 0), 4),
            round(float(sheet.get("rwa_yi") or 0), 4),
        ])
    paint(by_sheet, ["明细表", "笔数", "对上字段", "敞口（亿元）", "风险加权资产（亿元）"], sheet_rows, [28, 12, 14, 16, 24])

    fields = book.create_sheet("字段对应")
    field_rows = []
    for field in data.get("coverage") or []:
        hits = field.get("hits") or []
        field_rows.append([
            field.get("label") or "",
            field.get("id") or "",
            "\n".join(hits) if hits else "底稿没有",
        ])
    paint(fields, ["分类字段", "字段", "底稿对应"], field_rows, [36, 32, 72])
    book.save(dest)

def _has_amount_column(mapping: dict) -> bool:
    slot = mapping.get("single_exposure") or {}
    return slot.get("status") == "column"

def _amount_header_row(ws) -> int:
    words = ("balance", "余额", "餘額", "敞口", "equiv to", "额度", "額度")
    best = 0
    best_score = 0
    for index, row in enumerate(ws.iter_rows(max_row=30, max_col=40, values_only=True), 1):
        texts = []
        for value in row:
            if isinstance(value, str) and value.strip() and not value.startswith("="):
                texts.append(value.strip().lower())
        if len(texts) < 4:
            continue
        score = 0
        for text in texts:
            if "表" in text and not any(token in text.lower() for token in ("balance", "余额", "餘額")):
                continue
            lowered = text.lower()
            if any(word in lowered or word in text for word in words):
                score += 1
        if score > best_score:
            best = index
            best_score = score
    return best

def _fx_notional_header(ws, header_row: int) -> bool:
    texts = []
    for row in ws.iter_rows(min_row=header_row, max_row=header_row, max_col=40, values_only=True):
        for value in row:
            if isinstance(value, str) and value.strip():
                texts.append(value.strip().lower())
        break
    blob = " ".join(texts)
    traded = any(token in blob for token in ("amount bought", "amount sold", "notional principal", "名义本金", "名義本金"))
    exposure = any(token in blob for token in ("value balance", "o/s bal", "信贷敞口", "信貸敞口", "剩余可使用", "剩餘可使用"))
    return traded and not exposure

def _header_width(ws, header_row: int) -> int:
    count = 0
    for row in ws.iter_rows(min_row=header_row, max_row=header_row, max_col=40, values_only=True):
        for value in row:
            if isinstance(value, str) and value.strip() and not value.startswith("="):
                count += 1
        break
    return count

def _roll_up_debtors(ready: list[dict]) -> None:
    totals: dict[str, float] = {}
    for item in ready:
        for facts, amount in item["draft"]:
            key = str(facts.get("_debtor") or "")
            if key:
                totals[key] = totals.get(key, 0.0) + amount
    for item in ready:
        for facts, _amount in item["draft"]:
            key = str(facts.get("_debtor") or "")
            if key and key in totals:
                facts["single_exposure"] = totals[key]
                facts["_debtor_rolled"] = True

def _repair_mapping(spec: dict, mapping: dict[str, dict]) -> dict[str, dict]:
    """模型必须给每个字段一个结论；这里只改明显对错列的几项，避免抵押品被当成敞口。"""
    found = {fid: dict(slot) for fid, slot in mapping.items()}
    headers = spec["headers"]
    by_letter = {item["column"]: item["header"] for item in headers}
    for fid in list(found):
        slot = found[fid]
        if fid in _NO_CONST and slot.get("status") == "const":
            found[fid] = {"status": "missing", "reason": "底稿没有这一列，不能整表默认"}
    amount = _best_amount_column(headers)
    current = found.get("single_exposure") or {}
    current_header = by_letter.get(current.get("column") or "", "")
    if amount and not (current.get("status") == "column" and _good_amount_header(current_header)):
        found["single_exposure"] = {
            "status": "column",
            "column": amount[0],
            "reason": "账面余额 " + amount[1],
        }
    period = _period_column(headers)
    maturity = found.get("original_maturity_months") or {}
    maturity_header = by_letter.get(maturity.get("column") or "", "")
    if maturity.get("status") == "column" and not _period_header(maturity_header):
        if period:
            found["original_maturity_months"] = {
                "status": "column",
                "column": period[0],
                "reason": "期限天数 " + period[1],
            }
        else:
            found["original_maturity_months"] = {"status": "missing", "reason": "只有到期日，没有期限天数"}
    elif period and maturity.get("status") != "column":
        found["original_maturity_months"] = {
            "status": "column",
            "column": period[0],
            "reason": "期限天数 " + period[1],
        }
    name = spec["sheet"]
    if name in _LOAN_SHEETS:
        found["fi_bank_applicable"] = {"status": "const", "const": "not_applicable", "reason": "贷款、额度和信用卡不形成对商业银行的债权"}
    if "存放" in name:
        found["counterparty_type"] = {"status": "const", "const": "commercial_bank", "reason": "这张表是存放同业"}
        found["fi_bank_applicable"] = {"status": "const", "const": "applicable", "reason": "存放同业适用商业银行"}
        found["instrument_type"] = {"status": "const", "const": "claim", "reason": "存放同业是债权"}
    if "信用卡" in name:
        found["is_credit_card"] = {"status": "const", "const": "yes", "reason": "这张表是信用卡未使用额度"}
        found["instrument_type"] = {"status": "const", "const": "claim", "reason": "信用卡额度是债权"}
        found["counterparty_type"] = {"status": "const", "const": "individual", "reason": "信用卡持卡人按自然人"}
    if name == "額度詳情表":
        party = found.get("counterparty_type") or {}
        if party.get("status") == "const":
            found["counterparty_type"] = {"status": "missing", "reason": "额度表没有交易对手类型，不能整表写成主权"}
    if spec.get("notional"):
        found["single_exposure"] = {"status": "missing", "reason": "这张表只有外汇名义本金，没有信用等值"}
    return found

def _best_amount_column(headers: list[dict]) -> tuple[str, str] | None:
    ranked = []
    for item in headers:
        header = item["header"]
        if not _good_amount_header(header):
            continue
        lowered = header.lower()
        score = 0
        if "value balance(mop)" in lowered:
            score = 0
        elif "o/s bal_mop" in lowered:
            score = 1
        elif lowered.strip() == "equiv to mop":
            score = 2
        elif "信貸敞口_mop" in lowered or "信贷敞口_mop" in lowered:
            score = 3
        elif "剩余可使用额度" in header or "剩餘可使用額度" in header:
            score = 4
        else:
            score = 9
        ranked.append((score, item["column"], header))
    if not ranked:
        return None
    ranked.sort()
    return ranked[0][1], ranked[0][2]

def _good_amount_header(header: str) -> bool:
    if _bad_amount_header(header):
        return False
    lowered = header.lower()
    if lowered.strip() == "equiv to mop":
        return True
    return any(token in lowered or token in header for token in _AMOUNT_HEADERS)

def _bad_amount_header(header: str) -> bool:
    lowered = header.lower()
    tokens = ("collateral", "抵押", "rwa", "权重", "權重", "interest", "利息", "ccf", "ecl", "acquisition", "notional")
    return any(token in lowered or token in header for token in tokens)

def _period_column(headers: list[dict]) -> tuple[str, str] | None:
    for item in headers:
        if _period_header(item["header"]):
            return item["column"], item["header"]
    return None

def _period_header(header: str) -> bool:
    lowered = header.lower()
    if "maturity" in lowered or "到期" in header or "value date" in lowered:
        return False
    return "rest period" in lowered or "original period" in lowered or "by period" in lowered

def _header_column(headers: list[dict], names: tuple[str, ...]) -> tuple[str, str] | None:
    for item in headers:
        if any(name in item["header"] for name in names):
            return item["column"], item["header"]
    return None

def _sample(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%d")
    if isinstance(value, date):
        return value.isoformat()
    text = str(value).strip()
    if not text or text.startswith("="):
        return ""
    return text[:36]

def _supplement_sheets(book) -> list[dict]:
    """资产负债表上没有交易明细的现金、货币当局存款和其他资产。"""
    if "FS-ASSETS" not in book.sheetnames:
        return []
    assets = book["FS-ASSETS"]
    cash = _balance_line(assets, "現金")
    central = _balance_line(assets, "AMCM")
    others = [
        ("不動產", _balance_line(assets, "不動產")),
        ("設備", _balance_line(assets, "設備")),
        ("遞延費用", _balance_line(assets, "遞延費用")),
        ("開辦費用", _balance_line(assets, "開辦費用")),
        ("未完成不動產", _balance_line(assets, "未完成不動產")),
    ]
    sheets = []
    if cash:
        sheets.append(_synthetic("现金", [("库存现金", cash)]))
    if central:
        sheets.append(_synthetic("存放中央银行", [("AUTORIDADE MONETARIA DE MACAU", central)]))
    other_rows = [(label, amount) for label, amount in others if amount]
    if other_rows:
        sheets.append(_synthetic("其他资产", other_rows))
    return sheets

def _synthetic(name: str, rows: list[tuple[str, float]]) -> dict:
    headers = [
        {"column": "A", "header": "Customer Name"},
        {"column": "B", "header": "Value Balance(MOP)"},
    ]
    data = [{"A": label, "B": amount} for label, amount in rows]
    return {"sheet": name, "header_row": 1, "off": False, "headers": headers, "samples": [], "rows": data}

def _balance_line(ws, prefix: str) -> float:
    for row in ws.iter_rows(min_row=6, max_row=24, max_col=4, values_only=True):
        label = str(row[0] or "").strip()
        if label.startswith(prefix):
            return _num(row[3]) or 0.0
    return 0.0

def _party_key(name: str) -> str:
    return " ".join(name.upper().replace(".", " ").split())

def _header_value(row: dict, header_by_letter: dict[str, str], *names: str):
    wanted = {name.upper() for name in names}
    for letter, header in header_by_letter.items():
        if header.strip().upper() in wanted:
            return row.get(letter)
    return None

def _interbank_deposit(gl: str, account: str, party: str) -> bool:
    """212、222 是存放同业科目。表名不叫存放时，仍按科目和户名认出商业银行。"""
    code = str(gl or "").strip()
    if code.startswith("212") or code.startswith("222"):
        return True
    blob = (str(account or "") + " " + str(party or "")).upper()
    return any(token in blob for token in ("FOREIGN BANK", "INTERBANK", "NOSTRO", "存放同业", "存放同業"))

def _find_number(row: dict, mapping: dict, fid: str) -> float | None:
    slot = mapping.get(fid) or {}
    if slot.get("status") != "column":
        return None
    return _num(row.get(slot.get("column") or ""))

def _text_blob(row: dict) -> str:
    parts = []
    for value in row.values():
        if isinstance(value, str):
            parts.append(value)
    return " ".join(parts)

def _row_has_identity(row: dict, header_by_letter: dict[str, str]) -> bool:
    for letter, header in header_by_letter.items():
        lowered = header.lower()
        if not any(token in lowered or token in header for token in ("customer", "客户", "客戶", "name", "gl a/c", "contract", "isin", "卡号", "证件", "ci")):
            continue
        if "country" in lowered or "industry" in lowered:
            continue
        value = row.get(letter)
        if isinstance(value, str) and value.strip():
            return True
        if isinstance(value, (int, float)) and not isinstance(value, bool) and value != 0:
            return True
    return False

def _mdb_official_name(text: str) -> str:
    upper = text.upper()
    for token, official in _MDB_OFFICIAL:
        if token in upper:
            return official
    return ""

def _looks_residential(text: str) -> bool:
    return any(token in text.upper() for token in ("RESIDENTIAL", "MORTGAGE", "住宅", "按揭", "物業", "物业"))

def _looks_property(text: str) -> bool:
    upper = text.upper()
    if any(token in upper for token in ("GUARANTEE", "LIVRANCA", "DEPOSIT", "保证", "擔保", "存单", "存單")):
        return False
    if re.search(r"\bTD\b", upper):
        return False
    return any(token in upper for token in ("RESIDENTIAL", "COMMERCIAL PROPERTY", "PROPERTY", "住宅", "商用", "物業", "物业", "按揭"))

def _collateral_groups(row: dict, header_by_letter: dict[str, str]) -> list[dict]:
    groups: dict[str, dict] = {}
    for letter, header in header_by_letter.items():
        desc = re.search(r"Description\s*(\d+)", header, re.I)
        if desc:
            groups.setdefault(desc.group(1), {})["desc"] = str(row.get(letter) or "")
        value = re.search(r"Collateral Value.*(\d+)\s*$", header, re.I)
        if value and "mop" in header.lower():
            groups.setdefault(value.group(1), {})["value"] = _num(row.get(letter))
    return list(groups.values())

def _property_uses(row: dict, header_by_letter: dict[str, str]) -> list[str]:
    uses = []
    for group in _collateral_groups(row, header_by_letter):
        text = group.get("desc") or ""
        if not _looks_property(text):
            continue
        if _looks_residential(text) and "residential" not in uses:
            uses.append("residential")
        elif "commercial" not in uses:
            uses.append("commercial")
    return uses

def _property_collateral_mop(row: dict, header_by_letter: dict[str, str]) -> float:
    total = 0.0
    for group in _collateral_groups(row, header_by_letter):
        if not _looks_property(group.get("desc") or ""):
            continue
        number = group.get("value")
        if isinstance(number, float) and number > 0:
            total += number
    return total

def _debtor_of(row: dict, header_by_letter: dict[str, str]) -> str:
    by_header = {header.strip(): letter for letter, header in header_by_letter.items()}
    for name in ("Customer", "CI", "客户号", "客戶號", "证件号码"):
        letter = by_header.get(name)
        if not letter:
            continue
        value = row.get(letter)
        if value not in (None, ""):
            return str(value).strip()
    for name in ("Full Name", "Customer Name", "NAME", "客戶名", "中文名"):
        letter = by_header.get(name)
        if not letter:
            continue
        value = row.get(letter)
        if isinstance(value, str) and value.strip():
            return "name:" + value.strip()
    return ""

def _pick_date_column(header_by_letter: dict[str, str], kind: str) -> str:
    exact = ""
    fuzzy = ""
    for letter, header in header_by_letter.items():
        lowered = header.strip().lower()
        if kind == "value":
            if lowered == "value date":
                exact = letter
            elif not fuzzy and ("value date" in lowered or header.strip() in {"起息日", "额度生效日", "額度生效日", "发卡日期", "發卡日期"}):
                fuzzy = letter
        elif lowered == "maturity date":
            exact = letter
        elif not fuzzy and "maturity" in lowered and "next" not in lowered:
            fuzzy = letter
        elif not fuzzy and header.strip() in {"到期日", "额度到期日", "額度到期日", "信用卡到期日"}:
            fuzzy = letter
    return exact or fuzzy

def _date_pair(headers: list[dict]) -> bool:
    letters = {item["column"]: item["header"] for item in headers}
    return bool(_pick_date_column(letters, "value") and _pick_date_column(letters, "maturity"))

def _as_date(value: Any) -> date | None:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    return None

def _original_months(row: dict, header_by_letter: dict[str, str]) -> float | None:
    start = _as_date(row.get(_pick_date_column(header_by_letter, "value")))
    end = _as_date(row.get(_pick_date_column(header_by_letter, "maturity")))
    if not start or not end or end <= start:
        return None
    return (end - start).days / 30.0

def _country_text(row: dict, header_by_letter: dict[str, str]) -> str:
    for letter, header in header_by_letter.items():
        upper = header.upper()
        if "COUNTRY" not in upper and "國別" not in header and "国别" not in header:
            continue
        if "CODE" in upper:
            continue
        value = row.get(letter)
        if isinstance(value, str) and value.strip() and not _num(value):
            return value.strip()
    return ""

def _is_prc(country: str) -> bool:
    upper = country.upper().strip()
    if upper in {"CN", "CHN", "PRC", "CHINA"} or upper.startswith("CN ") or upper.startswith("CHINA"):
        return True
    return any(token in country for token in ("中国", "中國"))

def _open_id(kind: str, facts: dict, sheet: str) -> str:
    if kind == "default_provision":
        return "default_provision"
    if kind == "property_side":
        collateral = str(facts.get("_collateral") or facts.get("counterparty_name") or facts.get("_debtor") or sheet)
        return "property:" + collateral[:80]
    name = _party_key(str(facts.get("counterparty_name") or ""))
    if not name:
        debtor = str(facts.get("_debtor") or "")
        name = debtor[5:] if debtor.startswith("name:") else debtor
        name = _party_key(name)
    return "bank:" + (name or sheet)

def _remember_open(group: dict, facts: dict, sheet: str) -> None:
    if sheet not in group["sheets"]:
        group["sheets"].append(sheet)
    name = str(facts.get("counterparty_name") or "")
    if not name:
        debtor = str(facts.get("_debtor") or "")
        name = debtor[5:] if debtor.startswith("name:") else ""
    if name and name not in group["names"] and len(group["names"]) < 4:
        group["names"].append(name[:60])
    rating = str(facts.get("issuer_rating") or "")
    if rating and rating not in group["ratings"]:
        group["ratings"].append(rating)
    months = facts.get("original_maturity_months")
    if isinstance(months, (int, float)):
        group["months"].append(float(months))
    collateral = str(facts.get("_collateral") or "")
    if collateral and collateral not in group["collateral"]:
        group["collateral"].append(collateral)

def _apply_open_choice(facts: dict, kind: str, choice: str) -> bool:
    if kind == "bank_grade":
        if choice == "a_plus":
            facts["meets_minimum_capital"] = "yes"
            facts["meets_other_capital"] = "yes"
            facts["cet1_ratio"] = 0.14
            facts["leverage_ratio"] = 0.05
        elif choice == "a":
            facts["meets_minimum_capital"] = "yes"
            facts["meets_other_capital"] = "yes"
        elif choice == "b":
            facts["meets_minimum_capital"] = "yes"
            facts["meets_other_capital"] = "no"
        elif choice == "c":
            facts["meets_minimum_capital"] = "no"
        else:
            return False
        return True
    if kind == "property_side":
        if choice not in {"residential", "commercial"}:
            return False
        facts["has_property_collateral"] = "yes"
        facts["property_uses"] = [choice]
        return True
    if kind == "default_provision":
        if choice == "high":
            facts["provision_ratio"] = 0.2
        elif choice == "low":
            facts["provision_ratio"] = 0.0
        else:
            return False
        return True
    return False

def _choice_label(kind: str, choice: str) -> str:
    labels = {
        ("bank_grade", "a_plus"): "模型定为 A+ 级",
        ("bank_grade", "a"): "模型定为 A 级",
        ("bank_grade", "b"): "模型定为 B 级",
        ("bank_grade", "c"): "模型定为 C 级",
        ("property_side", "residential"): "模型选定居住用",
        ("property_side", "commercial"): "模型选定商用",
        ("default_provision", "high"): "模型按准备不低于 20%，权重 100%",
        ("default_provision", "low"): "模型按准备低于 20%，权重 150%",
    }
    return labels.get((kind, choice), "模型选定")

def _walk_steps(walked: list[dict], facts: dict[str, Any]) -> list[dict[str, Any]]:
    steps: list[dict[str, Any]] = []
    for node in walked:
        title = str(node.get("label") or "")
        rule = str(node.get("id") or "")
        conds = condition_steps(node.get("match"), facts, title, lambda cond: _cond(cond, facts), rule)
        if conds:
            steps.extend(conds)
        else:
            steps.append(step(
                "分类",
                title,
                rule=rule,
                hit=True,
                note="同层其余分支都未命中，落入这一档" if node.get("otherwise") else "进入这一档",
            ))
    return steps

def _trace_text(hit: dict, facts: dict) -> str:
    parts = []
    path = str(hit.get("path") or "").strip()
    if path:
        parts.append(path)
    reason = str(facts.get("_model_reason") or "").strip()
    if reason:
        parts.append("模型：" + reason[:80])
    return "。".join(parts)[:180]

def _ordinary_categories(categories: list) -> list:
    return categories

def _ordinary_facts(facts: dict[str, Any]) -> dict[str, Any]:
    next_facts = dict(facts)
    next_facts["instrument_type"] = "claim"
    next_facts["treat_as_equity"] = "no"
    next_facts["is_defaulted"] = "no"
    next_facts["is_subordinated"] = "no"
    next_facts["has_property_collateral"] = "no"
    next_facts.pop("property_uses", None)
    next_facts.pop("cashflow_dependent", None)
    next_facts.pop("ltv", None)
    return next_facts

def _percent(number: float) -> str:
    points = number * 100
    if abs(points - round(points)) < 1e-9:
        return str(int(round(points))) + "%"
    return f"{points:.2f}".rstrip("0").rstrip(".") + "%"

def _walk(nodes: list, facts: dict[str, Any]) -> list[dict] | None:
    active = []
    skipped_would = False
    for node in nodes or []:
        if _skipped(node, facts):
            if _when(node.get("match"), facts):
                skipped_would = True
            continue
        active.append(node)
    when_hit = False
    for node in active:
        if node.get("otherwise"):
            if when_hit or skipped_would:
                continue
        elif not _when(node.get("match"), facts):
            continue
        else:
            when_hit = True
        children = node.get("children") or []
        if children:
            child = _walk(children, facts)
            if child == []:
                when_hit = False
                continue
            if child:
                return [node, *child]
            return [node]
        return [node]
    if not when_hit and skipped_would:
        return []
    return None

def _skipped(node: dict, facts: dict[str, Any]) -> bool:
    skip = node.get("skip") or {}
    if not skip.get("field"):
        return False
    return _cond({"field": skip.get("field"), "op": skip.get("op") or "eq", "value": skip.get("match")}, facts)

def _when(match: object, facts: dict[str, Any]) -> bool:
    if not isinstance(match, dict):
        return False
    if isinstance(match.get("all"), list):
        return bool(match["all"]) and all(_item(item, facts) for item in match["all"])
    if isinstance(match.get("any"), list):
        return bool(match["any"]) and any(_item(item, facts) for item in match["any"])
    if match.get("field"):
        return _cond(match, facts)
    return False

def _item(item: object, facts: dict[str, Any]) -> bool:
    if not isinstance(item, dict):
        return False
    if "all" in item or "any" in item:
        return _when(item, facts)
    return _cond(item, facts)

def _cond(cond: dict, facts: dict[str, Any]) -> bool:
    field = cond.get("field")
    if not field or field not in facts:
        return False
    actual = facts[field]
    if actual is None or actual == "":
        return False
    expected = cond.get("value") if cond.get("value") is not None else cond.get("match")
    op = cond.get("op") or "eq"
    if op == "eq":
        return actual == expected or str(actual) == str(expected)
    if op == "neq":
        return str(actual) != str(expected)
    if op == "in":
        pool = expected if isinstance(expected, list) else [expected]
        return any(actual == item or str(actual) == str(item) for item in pool)
    if op == "contains":
        pool = actual if isinstance(actual, list) else str(actual).split(",")
        return any(str(item) == str(expected) for item in pool)
    try:
        left = float(actual)
        right = float(expected)
    except (TypeError, ValueError):
        return False
    if op == "gt":
        return left > right
    if op == "gte":
        return left >= right
    if op == "lt":
        return left < right
    if op == "lte":
        return left <= right
    return False


__all__ = ['_num', 'write_result_workbook', '_has_amount_column', '_amount_header_row', '_fx_notional_header', '_header_width', '_roll_up_debtors', '_repair_mapping', '_best_amount_column', '_good_amount_header', '_bad_amount_header', '_period_column', '_period_header', '_header_column', '_sample', '_supplement_sheets', '_synthetic', '_balance_line', '_party_key', '_header_value', '_interbank_deposit', '_find_number', '_text_blob', '_row_has_identity', '_mdb_official_name', '_looks_residential', '_looks_property', '_collateral_groups', '_property_uses', '_property_collateral_mop', '_debtor_of', '_pick_date_column', '_date_pair', '_as_date', '_original_months', '_country_text', '_is_prc', '_open_id', '_remember_open', '_apply_open_choice', '_choice_label', '_walk_steps', '_trace_text', '_ordinary_categories', '_ordinary_facts', '_percent', '_walk', '_skipped', '_when', '_item', '_cond', '_AMOUNT_HEADERS', '_LOAN_SHEETS', '_MDB_OFFICIAL', '_NO_CONST']

