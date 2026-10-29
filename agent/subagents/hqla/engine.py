"""流动性 HQLA 判定引擎。

移植自原型 rwa-audit/js/lib/hqla.js。与原型的唯一结构性差异：
原型把「外部参考库」和「内部清单」放在模块级 store 里，Flask 多线程下不安全，
这里改为显式传参（list_index / ref_index 每次调用重建）。

数据键沿用原型的 camelCase，避免在 Koa、Flask、Vue 三层之间再做一次映射。
"""

from __future__ import annotations

import json
from datetime import date, datetime, timezone

# ---------------------------------------------------------------- 评级

RATING_GRADE = {
    "AAA": 1, "AA+": 1, "AA": 1, "AA-": 1,
    "Aaa": 1, "Aa1": 1, "Aa2": 1, "Aa3": 1,
    "A+": 2, "A": 2, "A-": 2,
    "A1": 2, "A2": 2, "A3": 2,
    "BBB+": 3, "BBB": 3, "BBB-": 3,
    "Baa1": 3, "Baa2": 3, "Baa3": 3,
    "BB+": 4, "BB": 4, "BB-": 4,
    "Ba1": 4, "Ba2": 4, "Ba3": 4,
    "B+": 5, "B": 5, "B-": 5,
    "B1": 5, "B2": 5, "B3": 5,
    "CCC+": 6, "CCC": 6, "CCC-": 6, "CC": 6, "C": 6, "D": 6,
    "Caa1": 6, "Caa2": 6, "Caa3": 6, "Ca": 6,
}
GRADE_LABEL = {
    1: "1 级（AAA ~ AA-）",
    2: "2 级（A+ ~ A-）",
    3: "3 级（BBB+ ~ BBB-）",
    4: "4 级（BB+ ~ BB-）",
    5: "5 级（B+ ~ B-）",
    6: "6 级（CCC 及以下）",
}
_UNRATED = {"unrated", "nr", "n/a", "not rated", "未评级"}


def rating_grade(value):
    if value is None:
        return None
    text = str(value).strip()
    if not text or text.lower() in _UNRATED:
        return None
    if text in RATING_GRADE:
        return RATING_GRADE[text]
    head = text.replace("/", ",").replace(";", ",").replace("（", ",").replace("(", ",").replace(")", "")
    head = head.split(",")[0].strip()
    return RATING_GRADE.get(head)


def grade_text(grade):
    if grade is None:
        return "未评级"
    return GRADE_LABEL.get(grade, f"等级 {grade}")


# ---------------------------------------------------------------- 币种组与发行人类型

INDUSTRY_CATEGORY = {
    "GV": "sovereign", "LG": "local_gov", "IO": "mdb_io", "LI": "policy_bank",
    "PS": "pse", "BK": "bank_fi", "FI": "bank_fi", "CO": "corporate",
}
CATEGORY_LABEL = {
    "sovereign": "主权 / 中央政府",
    "local_gov": "地方政府",
    "mdb_io": "国际组织 / 多边开发银行",
    "policy_bank": "政策性银行",
    "pse": "公共部门实体（PSE）",
    "bank_fi": "银行 / 其他金融机构",
    "corporate": "公司（非金融）",
    "unknown": "未知",
}


def currency_group_of(ccy, cfg):
    code = str(ccy or "").upper().strip()
    if not code:
        return "OTHER"
    for group in cfg.get("currencyGroups", []):
        if code in (group.get("currencies") or []):
            return group["code"]
    return "OTHER"


def issuer_category_of(sec):
    if not sec:
        return "unknown"
    ind = str(sec.get("ind") or "").upper()
    if ind in INDUSTRY_CATEGORY:
        return INDUSTRY_CATEGORY[ind]
    itype = sec.get("itype")
    if itype is not None:
        try:
            itype = int(itype)
        except (TypeError, ValueError):
            itype = None
    if itype == 1:
        return "sovereign"
    if itype == 2:
        return "pse"
    if itype == 3:
        return "bank_fi"
    if itype == 4:
        return "corporate"
    return "unknown"


def asset_class_of(sec):
    name = str((sec or {}).get("name") or "").upper()
    if "CD" in name or "CERTIFICATE OF DEPOSIT" in name:
        return "cd"
    if "MBS" in name or "MORTGAGE" in name:
        return "mbs"
    if "FRN" in name or "SOFR" in name or "BBSW" in name or "HIBOR+" in name:
        return "frn"
    if "BILL" in name:
        return "bill"
    return "bond"


def sec_key(raw):
    """把 "组合\\证券代码" / "组合-证券代码" 统一成 "组合|证券代码"。"""
    if raw is None:
        return ""
    text = str(raw).strip()
    for ch in (" ", "　"):
        text = text.replace(ch, "")
    text = text.replace("\\", "|").replace("－", "-").replace("—", "-").replace("–", "-")
    if "|" in text:
        return text
    idx = text.find("-")
    if idx > 0:
        return text[:idx] + "|" + text[idx + 1:]
    return text


def sec_short(key):
    key = key or ""
    return key.split("|", 1)[1] if "|" in key else key


# ---------------------------------------------------------------- 默认配置

def cfg_default():
    return {
        "version": "BLR-2025.12",
        "standardVersion": "v1.0",
        "effectiveFrom": "2025-12-31",
        "locked": False,
        "baseDate": "2025-12-31",
        "currencyGroups": [
            {"code": "HKD", "label": "港元", "currencies": ["HKD"]},
            {"code": "USD", "label": "美元", "currencies": ["USD"]},
            {"code": "MAJOR", "label": "其他主要货币", "currencies": ["AUD", "EUR", "GBP", "JPY", "CAD", "CHF", "SGD", "NZD", "SEK", "NOK", "DKK"]},
            {"code": "RMB", "label": "人民币", "currencies": ["CNY", "RMB", "CNH"]},
            {"code": "OTHER", "label": "其他货币", "currencies": []},
        ],
        "levels": [
            {
                "code": "L1", "label": "Level 1", "short": "一级资产", "weight": 1.00, "minGrade": None,
                "tone": "ok", "clause": "附表 2 第二部分 1(c)/(d)/(e)",
                "note": "主权、央行、公共部门实体、国际组织及多边开发银行发行或担保的债务证券；本币计价的主权/央行债。",
            },
            {
                "code": "L2A", "label": "Level 2A", "short": "二级 A 资产", "weight": 0.85, "minGrade": 2,
                "tone": "info", "clause": "附表 2 第二部分 2(a)/(b)",
                "note": "主权 / 央行 / PSE 发行且适用 20% 风险权重；或公司债、担保债券评级 1–2 级；30 天跌幅 ≤10%。",
            },
            {
                "code": "L2B", "label": "Level 2B", "short": "二级 B 资产", "weight": 0.50, "minGrade": 3,
                "tone": "warn", "clause": "附表 2 第二部分 3(a)",
                "note": "公司 / 主权 / 央行 / PSE 债务证券；评级达投资级（BBB- 以上）、30 天跌幅 ≤20%；RMBS 另有批准与 LTV 要求。",
            },
            {
                "code": "NA", "label": "不合格", "short": "非 HQLA", "weight": 0, "minGrade": None,
                "tone": "danger", "clause": "不符合纳入条件",
                "note": "金融机构债、评级不足或期限不符的债务证券，不得计入 HQLA。",
            },
        ],
        "gate1": {
            "checks": [
                {"code": "encumbered", "enabled": True, "label": "未被质押 / 占用（Unencumbered）"},
                {"code": "trading_book", "enabled": True, "label": "非交易账簿持仓"},
                {"code": "fi_issuer", "enabled": True, "label": "非金融机构（政策性银行除外）", "policyBankException": True},
                {"code": "structured_sub", "enabled": True, "label": "非结构性 / 次级债"},
                {"code": "related_party", "enabled": True, "label": "非本行及关联实体发行"},
                {"code": "currency", "enabled": True, "label": "币种可自由兑换",
                 "allowed": ["HKD", "USD", "CNY", "AUD", "EUR", "GBP", "JPY", "SGD", "CAD", "CHF", "NZD", "MOP", "THB", "MYR", "NOK", "SEK", "DKK"]},
            ],
        },
        "gate2": {"missingDataPolicy": "warn"},
        "rules": [
            {"id": "R1", "enabled": True, "target": "L1", "clause": "2-1(c)", "label": "主权 / 央行 / EF 票据（标准法 0% 风险权重）", "when": {"categories": ["sovereign"], "rw": [0]}},
            {"id": "R2", "enabled": True, "target": "L1", "clause": "2-1(c)", "label": "多边开发银行 / 国际组织（0% 风险权重）", "when": {"categories": ["mdb_io"], "rw": [0]}},
            {"id": "R3", "enabled": True, "target": "L1", "clause": "2-1(c)", "label": "政策性银行（视同主权相关，0% 风险权重）", "when": {"categories": ["policy_bank"], "rw": [0]}},
            {"id": "R4", "enabled": True, "target": "L1", "clause": "2-1(c)", "label": "公共部门实体 / 地方政府（0% 风险权重）", "when": {"categories": ["pse", "local_gov"], "rw": [0]}},
            {"id": "R5", "enabled": True, "target": "L2A", "clause": "2-2(a)", "label": "主权 / 央行 / PSE（20% 风险权重，跌幅 ≤10%）", "when": {"categories": ["sovereign", "mdb_io", "pse", "local_gov", "policy_bank"], "rw": [20], "maxPrice30": 10}},
            {"id": "R6", "enabled": True, "target": "L2A", "clause": "2-2(b)", "label": "公司债 / 担保债券（评级 1–2 级，跌幅 ≤10%）", "when": {"categories": ["corporate"], "maxGrade": 2, "maxPrice30": 10}},
            {"id": "R7", "enabled": True, "target": "L2B", "clause": "2-3(b)", "label": "RMBS（金管局批准 + 评级 1–2 级 + LTV ≤80%）", "when": {"kinds": ["rmbs"], "approval": True, "maxGrade": 2, "maxLtv": 80, "maxPrice30": 20}},
            {"id": "R8", "enabled": True, "target": "L2B", "clause": "2-3(a)", "label": "公司 / 主权 / 央行 / PSE 债务证券（评级 ≤3 级，跌幅 ≤20%）", "when": {"maxGrade": 3, "maxPrice30": 20}},
            {"id": "R9", "enabled": True, "target": "NA", "clause": "—", "label": "不满足任何档位条件", "when": {"fallback": True}},
        ],
        "gate3": {"enabled": True, "level2CapPct": 0.40, "level2bCapPct": 0.15},
        "checks": {
            "valuation": {"basis": "market", "toleranceAbs": 1, "tolerancePct": 0.0005, "enabled": True},
            "maturity": {"lcrDays": 30, "enabled": True},
            "rating": {"enabled": True},
            "classification": {"enabled": True},
        },
        "sampling": {
            "mode": "full", "risk": "higher", "reliance": "none",
            "expectedDeviations": 0, "fixedSize": 15, "seed": 20251231, "stratify": True,
        },
        "reconciliation": {"toleranceThousand": 1, "tolerancePct": 0.0005},
        "external": {"useBuiltin": True, "endpoint": "", "timeoutMs": 8000},
    }


def level_def(cfg, code):
    for item in cfg.get("levels", []):
        if item.get("code") == code:
            return item
    levels = cfg.get("levels") or [{"code": "NA", "label": "不合格", "weight": 0}]
    return levels[-1]


def describe_when(when):
    when = when or {}
    parts = []
    if when.get("categories"):
        parts.append("发行人类型 ∈ {" + "、".join(CATEGORY_LABEL.get(c, c) for c in when["categories"]) + "}")
    if when.get("industries"):
        parts.append("行业代码 ∈ {" + "、".join(when["industries"]) + "}")
    if when.get("rw"):
        parts.append("风险权重 ∈ {" + "、".join(str(x) for x in when["rw"]) + "}%")
    if when.get("rwMax") is not None:
        parts.append(f"风险权重 ≤ {when['rwMax']}%")
    if when.get("kinds"):
        parts.append("债券种类 ∈ {" + "、".join(when["kinds"]) + "}")
    if when.get("maxPrice30") is not None:
        parts.append(f"30 天跌幅 ≤ {when['maxPrice30']}%")
    if when.get("approval"):
        parts.append("需金管局批准")
    if when.get("maxLtv") is not None:
        parts.append(f"LTV ≤ {when['maxLtv']}%")
    if when.get("maxGrade") is not None:
        parts.append("评级不差于 " + grade_text(when["maxGrade"]))
    if when.get("minGrade") is not None:
        parts.append("评级不优于 " + grade_text(when["minGrade"]))
    if when.get("ccyGroups"):
        parts.append("币种组 ∈ {" + "、".join(when["ccyGroups"]) + "}")
    if when.get("listed") and when["listed"] != "any":
        parts.append("上市 " + when["listed"])
    if when.get("assetClasses"):
        parts.append("资产类别 ∈ {" + "、".join(when["assetClasses"]) + "}")
    if when.get("maxRemainingDays") is not None:
        parts.append(f"剩余期限 ≤ {when['maxRemainingDays']} 天")
    return "；".join(parts) or "（无附加条件，命中全部）"


# ---------------------------------------------------------------- 日期

def parse_date(value):
    if value in (None, ""):
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    text = str(value).strip()
    for sep in ("-", "/"):
        bits = text.split(" ")
        head = bits[0]
        parts = head.split(sep)
        if len(parts) == 3 and len(parts[0]) == 4 and parts[0].isdigit():
            try:
                return date(int(parts[0]), int(parts[1]), int(parts[2]))
            except ValueError:
                pass
    return None


def days_between(a, b):
    return (a - b).days


def fmt_date(value):
    if isinstance(value, datetime):
        value = value.date()
    return value.isoformat() if value else "—"


def round2(value):
    try:
        return round((float(value or 0)) * 100) / 100
    except (TypeError, ValueError):
        return 0


def status_text(status):
    return {"pass": "通过", "warn": "关注", "fail": "异常", "skip": "不适用"}.get(status, status)


def now_text():
    return datetime.now(timezone.utc).astimezone().strftime("%Y-%m-%d %H:%M:%S")


def fmt_money(value):
    if value is None:
        return "—"
    try:
        return f"{float(value):,.2f}"
    except (TypeError, ValueError):
        return "—"


def num(value):
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return value
    if value in (None, ""):
        return None
    try:
        return float(str(value).replace(",", ""))
    except (TypeError, ValueError):
        return None
