"""上传文件的列识别与转换：明细 / 清单在 lists.py，这里是明细、参考库、申报汇总。"""

from __future__ import annotations

import re

from .engine import sec_key

HEADER_HINTS = {
    "item": ["item", "档位", "分类", "hqla level", "level"],
    "secId": ["portfolio & sec code", "portfolio+security code", "security code", "security id", "security", "instrument",
              "证券代码", "证券编号", "证券名称", "债券代码", "债券", "code", "isin"],
    "ccyGroup": ["currency group", "币种组", "币种", "currency"],
    "amount": ["reported amount", "amount", "金额", "申报金额", "hkd"],
}


def norm_header(value):
    text = str(value if value is not None else "").lower()
    for ch in (" ", "_", '"', "'", "(", ")", "（", "）"):
        text = text.replace(ch, "")
    return text


def detect_columns(matrix):
    """在前 10 行里找表头行（命中关键字最多那行）。"""
    best = {"row": -1, "score": 0, "map": {}}
    for i, row in enumerate((matrix or [])[:10]):
        mapping = {}
        for ci, cell in enumerate(row or []):
            head = norm_header(cell)
            if not head:
                continue
            for field, hints in HEADER_HINTS.items():
                if field in mapping:
                    continue
                if any(head == norm_header(h) or norm_header(h) in head for h in hints):
                    mapping[field] = ci
        score = len(mapping)
        if score > best["score"]:
            best = {"row": i, "score": score, "map": mapping}
    return best


ITEM_ALIAS = [
    (re.compile(r"^(level\s*)?1$|^l1$|^level\s*1|一级|第1级", re.I), "L1"),
    (re.compile(r"^(level\s*)?2a$|^l2a$|^level\s*2a|二级\s*a|2a", re.I), "L2A"),
    (re.compile(r"^(level\s*)?2b$|^l2b$|^level\s*2b|二级\s*b|2b", re.I), "L2B"),
    (re.compile(r"^(na|n/a|不合格|非hqla|other)$", re.I), "NA"),
]


def normalize_item(value):
    text = str(value if value is not None else "").strip()
    if not text:
        return "UNK"
    for pattern, code in ITEM_ALIAS:
        if pattern.search(text):
            return code
    return "UNK"


def parse_input_matrix(matrix, det):
    mapping = (det or {}).get("map") or det or {}
    start = (det or {}).get("row", -1)
    start = start + 1 if isinstance(start, int) and start >= 0 else 0
    rows = []
    for i, row in enumerate((matrix or [])[start:], start=start):
        row = row or []

        def get(field):
            idx = mapping.get(field)
            return row[idx] if idx is not None and idx < len(row) else None

        item_raw, sec_raw, amount_raw, ccy_raw = get("item"), get("secId"), get("amount"), get("ccyGroup")
        if item_raw is None and sec_raw is None:
            continue
        if isinstance(amount_raw, (int, float)) and not isinstance(amount_raw, bool):
            amount = float(amount_raw)
        elif amount_raw in (None, ""):
            amount = None
        else:
            try:
                amount = float(str(amount_raw).replace(",", ""))
            except ValueError:
                amount = None
        rows.append({
            "lineNo": i + 1,
            "itemRaw": "" if item_raw is None else str(item_raw),
            "item": normalize_item(item_raw),
            "secId": "" if sec_raw is None else str(sec_raw).strip(),
            "key": sec_key(sec_raw),
            "ccyGroupRaw": "" if ccy_raw is None else str(ccy_raw).strip(),
            "amount": amount,
        })
    return rows


REF_HINTS = {
    "id": ["portfolio+security code", "portfolio & sec code", "security id", "证券代码", "组合与证券代码"],
    "isin": ["isin"],
    "name": ["bond_name", "name of securities", "债券名称", "证券名称"],
    "issuer": ["issuer desc", "issuer", "发行人"],
    "ind": ["issuer industry", "industry", "行业"],
    "rating": ["issue rating", "rating", "评级"],
    "mat": ["mature date", "maturity", "到期日"],
    "coupon": ["coupon rate", "coupon", "票面利率", "票息"],
    "mv": ["mv_hkd", "market value", "市值"],
    "acc": ["acc_hkd", "accrued", "应计利息"],
    "book": ["tbv_hkd", "book value", "账面价值"],
    "ecl": ["ecl impairment", "ecl", "减值"],
    "ccy": ["currency", "币种"],
    "listed": ["listed ind", "listed", "上市"],
    "acct": ["hkgaap classification", "accounting", "会计分类"],
    "itype": ["issuer type", "发行人类型"],
    "rw": ["risk weight", "风险权重"],
    "p30": ["30 day", "price decline", "跌幅", "price decline"],
    "kind": ["bond type", "债券种类", "kind"],
    "sub": ["subordinated", "次级"],
}


def strip_hdr(value):
    return norm_header(value)


def detect_ref_columns(matrix):
    best = {"row": -1, "score": 0, "map": {}}
    for i, row in enumerate((matrix or [])[:6]):
        mapping = {}
        for ci, cell in enumerate(row or []):
            head = strip_hdr(cell)
            if not head:
                continue
            for field, hints in REF_HINTS.items():
                if field in mapping:
                    continue
                if any(head == strip_hdr(h) or strip_hdr(h) in head for h in hints):
                    mapping[field] = ci
        score = len(mapping)
        if score > best["score"]:
            best = {"row": i, "score": score, "map": mapping}
    return best


def _numv(value):
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value)
    if value in (None, ""):
        return None
    try:
        return float(str(value).replace(",", ""))
    except ValueError:
        return None


def rows_from_ref_matrix(matrix, det):
    mapping = (det or {}).get("map") or det or {}
    start = (det or {}).get("row", -1)
    start = start + 1 if isinstance(start, int) and start >= 0 else 0
    out = []
    for row in (matrix or [])[start:]:
        row = row or []

        def get(field):
            idx = mapping.get(field)
            return row[idx] if idx is not None and idx < len(row) else None

        if not get("id") and not get("isin"):
            continue
        itype = get("itype")
        try:
            itype = int(itype) if itype not in (None, "") else None
        except (TypeError, ValueError):
            itype = None
        out.append({
            "id": sec_key(get("id") or get("isin")),
            "isin": get("isin") or "",
            "name": get("name") or "",
            "issuer": get("issuer") or "",
            "ind": str(get("ind") or "").upper(),
            "itype": itype,
            "ccy": get("ccy") or "",
            "mat": get("mat") or None,
            "cp": _numv(get("coupon")),
            "days": None,
            "listed": get("listed") or "N",
            "acct": get("acct") or "",
            "rating": get("rating") or "Unrated",
            "book": _numv(get("book")),
            "mv": _numv(get("mv")),
            "acc": _numv(get("acc")),
            "ecl": _numv(get("ecl")),
            "rw": _numv(get("rw")),
            "p30": _numv(get("p30")),
            "kind": get("kind") or "",
            "sub": get("sub") or "",
            "region": "",
        })
    return out


def parse_compilation_rows(rows):
    """从底稿 HQLA Compilation 工作表读取客户申报的加权金额。

    依赖固定列位：D=条款描述，F=本金，J=加权金额，L/N/P/R/T=各币种加权。
    """
    out = []
    level = None
    for row in rows or []:
        row = row or []
        joined = " | ".join("" if c is None else str(c) for c in row)
        found = re.search(r"Level\s*(1|2A|2B)\b", joined, re.I)
        if found:
            level = "L" + found.group(1).upper()
        desc = "" if len(row) <= 3 or row[3] is None else str(row[3]).strip()
        clause = re.match(r"^\(([a-e])\)", desc, re.I)
        if not level or not clause:
            continue
        try:
            principal = float(row[5]) if len(row) > 5 and row[5] not in (None, "") else None
        except (TypeError, ValueError):
            principal = None
        try:
            weighted = float(row[9]) if len(row) > 9 and row[9] not in (None, "") else None
        except (TypeError, ValueError):
            weighted = None
        if principal is None and weighted is None:
            continue

        def cell(idx):
            try:
                return float(row[idx]) if len(row) > idx and row[idx] not in (None, "") else 0.0
            except (TypeError, ValueError):
                return 0.0

        level_label = {"L1": "Level 1", "L2A": "Level 2A", "L2B": "Level 2B"}[level]
        out.append({
            "level": level_label,
            "clause": f"{'1' if level == 'L1' else '2' if level == 'L2A' else '3'}({clause.group(1).lower()})",
            "principalThousand": principal if principal is not None else 0,
            "weightedThousand": weighted if weighted is not None else 0,
            "byCcy": {
                "HKD": cell(11), "USD": cell(13), "MAJOR": cell(15),
                "RMB": cell(17), "OTHER": cell(19),
            },
        })
    return out
