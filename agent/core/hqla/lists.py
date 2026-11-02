"""内部基础参数清单：7 类，按 证券代码 → ISIN → 发行人名称 匹配。"""

from __future__ import annotations

from .engine import sec_key

LIST_DEFS = [
    {"code": "trading_book", "label": "交易账簿持仓清单", "match": ["secId", "isin"], "note": "交易账簿下持有的证券明细"},
    {"code": "encumbered", "label": "回购 / 质押 / 占用台账", "match": ["secId", "isin"], "fields": ["amount"], "note": "已质押、已用于回购或被限制的证券及占用金额"},
    {"code": "related_party", "label": "集团关联方名单", "match": ["issuer"], "note": "本行所属集团的关联实体名称"},
    {"code": "own_issue", "label": "本行及关联实体发行清单", "match": ["issuer"], "note": "本行或关联实体作为发行人的证券"},
    {"code": "policy_bank", "label": "政策性银行名单", "match": ["issuer"], "note": "政策性银行名称清单"},
    {"code": "structured_sub", "label": "结构性 / 次级债清单", "match": ["secId", "isin"], "note": "结构性金融工具、次级债、永续债"},
    {"code": "rmbs_approval", "label": "RMBS 批准与 LTV", "match": ["secId", "isin"], "fields": ["ltv", "approved"], "note": "RMBS 的监管批准标记与加权平均 LTV"},
]

LIST_CODES = [d["code"] for d in LIST_DEFS]
LIST_LABEL = {d["code"]: d["label"] for d in LIST_DEFS}

LIST_HINTS = {
    "secId": ["portfolio+security code", "security code", "证券代码", "组合与证券代码", "security id", "债券代码"],
    "isin": ["isin"],
    "issuer": ["issuer", "issuer desc", "发行人", "发行人名称", "名称"],
    "name": ["bond_name", "name of securities", "债券名称"],
    "amount": ["amount", "金额", "占用金额", "balance", "余额"],
    "ltv": ["ltv", "贷款价值比", "按揭成数"],
    "decline": ["decline", "跌幅", "价格跌幅", "drop"],
    "approved": ["approved", "批准", "approval"],
    "note": ["note", "备注", "reason"],
}

MATCH_LABEL = {"secId": "证券代码", "isin": "ISIN", "issuer": "发行人名称"}


def _strip(value):
    return str(value if value is not None else "").lower().replace(" ", "").replace("_", "").replace('"', "").replace("'", "").replace("(", "").replace(")", "").replace("（", "").replace("）", "")


def build_index(lists):
    """lists: {code: [rows]} -> {code: {byId, byIsin, issuers}}"""
    index = {}
    for code in LIST_CODES:
        by_id, by_isin, issuers = {}, {}, []
        for row in (lists or {}).get(code) or []:
            key = sec_key(row.get("secId") or row.get("id") or "")
            if key:
                by_id[key] = row
            if row.get("isin"):
                by_isin[str(row["isin"]).upper()] = row
            name = str(row.get("issuer") or row.get("name") or "").strip().upper()
            if name:
                issuers.append({"name": name, "row": row})
        index[code] = {"byId": by_id, "byIsin": by_isin, "issuers": issuers}
    return index


def list_count(lists, code):
    return len((lists or {}).get(code) or [])


def list_hit(index, code, sec_id=None, isin=None, issuer=None):
    state = (index or {}).get(code)
    if not state or not state["byId"] and not state["byIsin"] and not state["issuers"]:
        return None
    key = sec_key(sec_id or "")
    if key and key in state["byId"]:
        return state["byId"][key]
    if isin and str(isin).upper() in state["byIsin"]:
        return state["byIsin"][str(isin).upper()]
    definition = next((d for d in LIST_DEFS if d["code"] == code), None)
    by_issuer = bool(definition) and "issuer" in (definition.get("match") or [])
    if by_issuer and issuer and state["issuers"]:
        up = str(issuer).upper()
        for item in state["issuers"]:
            if up in item["name"] or item["name"] in up:
                return item["row"]
    return None


def parse_list_matrix(matrix):
    """从二维表解析清单行：自动识别 证券代码 / ISIN / 发行人 / 数值列。"""
    matrix = matrix or []
    best = {"row": -1, "score": 0, "map": {}}
    for i, row in enumerate(matrix[:6]):
        mapping = {}
        for ci, cell in enumerate(row or []):
            head = _strip(cell)
            if not head:
                continue
            for field, hints in LIST_HINTS.items():
                if field in mapping:
                    continue
                if any(head == _strip(h) or _strip(h) in head for h in hints):
                    mapping[field] = ci
        score = len(mapping)
        if score > best["score"]:
            best = {"row": i, "score": score, "map": mapping}
    mapping = best["map"]
    rows = []
    start = best["row"] + 1 if best["row"] >= 0 else 0
    for row in matrix[start:]:
        row = row or []

        def get(field):
            return row[mapping[field]] if mapping.get(field) is not None and mapping[field] < len(row) else None

        sec_id, isin, issuer = get("secId"), get("isin"), get("issuer")
        if not sec_id and not isin and not issuer:
            continue
        out = {}
        if sec_id:
            out["secId"] = str(sec_id).strip()
        if isin:
            out["isin"] = str(isin).strip()
        if issuer:
            out["issuer"] = str(issuer).strip()
        if get("name"):
            out["name"] = str(get("name")).strip()
        for field in ("amount", "ltv", "decline"):
            value = get(field)
            if value not in (None, ""):
                try:
                    out[field] = float(str(value).replace(",", "").replace("%", ""))
                except ValueError:
                    pass
        if get("approved"):
            out["approved"] = str(get("approved")).strip().upper()
        if get("note"):
            out["note"] = str(get("note")).strip()
        rows.append(out)
    return {"rows": rows, "map": mapping, "headerRow": best["row"]}


TEMPLATES = {
    "trading_book": (["证券代码", "ISIN", "备注"], ["CYB_BB_OCI_BD|UST015027", "US912828Z781", "FVTPL 会计分类"]),
    "encumbered": (["证券代码", "ISIN", "占用金额", "备注"], ["CYB_BB_OCI_BD|GHKQ2541", "HK0000000001", "1000000000", "2025-12-31 未到期回购"]),
    "related_party": (["发行人名称", "备注"], ["CHIYU BANKING CORPORATION LIMITED", "集团关联实体"]),
    "own_issue": (["发行人名称", "备注"], ["CHIYU BANKING CORPORATION LIMITED", "本行发行"]),
    "policy_bank": (["发行人名称", "备注"], ["CHINA DEVELOPMENT BANK", "视同主权相关"]),
    "structured_sub": (["证券代码", "ISIN", "备注"], ["CYB_BB_OCI_BD|XXX000001", "", "次级/永续条款"]),
    "rmbs_approval": (["证券代码", "ISIN", "批准", "加权平均LTV", "备注"], ["CYB_BB_OCI_BDMBS|GNM05055A", "US3618N5XP94", "Y", "62", "金管局批准"]),
}


def list_template(code):
    item = TEMPLATES.get(code)
    if not item:
        return None
    heads, sample = item
    return ",".join(heads) + "\n" + ",".join(sample) + "\n"
