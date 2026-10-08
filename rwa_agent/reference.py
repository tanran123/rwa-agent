"""Reference tables taken from Repo_swap_RWA_Examples.xlsx. Not read from the upload."""

from __future__ import annotations

USD_CNH = 7.2
CAPITAL_RATIO = 0.08
RWA_MULTIPLIER = 12.5
PRC_MOF = "中华人民共和国财政部"

# Exact rating symbol -> Grade. Unlisted symbols are 未评级.
RATING_GRADE: dict[str, str] = {}
for _symbols, _grade in (
    (("AAA", "AA+", "AA", "AA-", "Aaa", "Aa1", "Aa2", "Aa3"), "1"),
    (("A+", "A", "A-", "A1", "A2", "A3"), "2"),
    (("BBB+", "BBB", "BBB-", "Baa1", "Baa2", "Baa3"), "3"),
    (("BB+", "BB", "BB-", "Ba1", "Ba2", "Ba3"), "4"),
    (("B+", "B", "B-", "B1", "B2", "B3"), "5"),
    (("CCC", "CC", "C", "Caa1", "Caa2", "Caa3"), "6"),
):
    for _symbol in _symbols:
        RATING_GRADE[_symbol.upper()] = _grade

# (issuer bucket, grade) -> risk weight. Grades are "1".."6" and "未评级".
def _row(weights: list[float]) -> dict[str, float]:
    keys = ["1", "2", "3", "4", "5", "6", "未评级"]
    return dict(zip(keys, weights, strict=True))


WEIGHTS: dict[tuple[str, str], float] = {}
for _bucket, _weights in (
    ("主权", [0, 0.2, 0.5, 1, 1, 1.5, 1]),
    ("PSE", [0.2, 0.5, 1, 1, 1, 1.5, 1]),
    ("银行-一般", [0.2, 0.5, 0.5, 1, 1, 1.5, 0.5]),
    ("银行-短期(≤3月)", [0.2, 0.2, 0.2, 0.5, 0.5, 1.5, 0.2]),
    ("企业/非银", [0.2, 0.5, 1, 1, 1.5, 1.5, 1]),
):
    for _grade, _weight in _row(_weights).items():
        WEIGHTS[(_bucket, _grade)] = _weight

FX_MOP = {
    "HKD": 1.03,
    "CNH": 1.198615,
    "USD": 8.080547,
    "AUD": 5.743792,
    "EUR": 9.362156,
    "MOP": 1.0,
}

# Simple rate used by the workbook discount factor 1 / (1 + r × t).
SIMPLE_RATE = {
    "HKD": 0.037,
    "CNH": 0.03,
    "USD": 0.05,
    "AUD": 0.041,
    "EUR": 0.0345,
    "MOP": 0.034,
}


def grade_of(symbol: object) -> str:
    if symbol is None:
        return "未评级"
    text = str(symbol).strip()
    if not text or text in {"未评级", "Unrated", "NR"}:
        return "未评级"
    return RATING_GRADE.get(text.upper(), "未评级")


def matched_type(issuer_type: object, residual_months: float | None, short_months: float = 3) -> str:
    text = str(issuer_type or "").strip()
    if text in {"银行", "银行-一般"} and residual_months is not None and residual_months <= short_months:
        return "银行-短期(≤3月)"
    if text == "银行":
        return "银行-一般"
    return text


# Pack-level regulatory source. Shown apart from the arithmetic.
REGULATORY_BASIS = {
    "repo_credit": "第011/2015-AMCM号公告第2点：澳门本地信用机构偿付能力比率不得低于8%，资本按 RWA 的8%计算。第015/B/2022-DSB/AMCM号通告信用风险第6段要求采用标准法，并遵守第028/B/2015-DSB/AMCM号通告随函的《信用风险回报填报说明》。这份通告公开文本只有函件，报表没有附上，写不出行号。",
    "ccr_fx": "第015/B/2022-DSB/AMCM号通告信用风险第6段：对单个交易对手采用标准法，并遵守第028/B/2015-DSB/AMCM号通告随函的《信用风险回报填报说明》。折现轧差和附加因子在随函报表里。这份通告公开文本只有函件，报表没有附上，写不出行号。资本比例对应第011/2015-AMCM号公告第2点，不得低于8%。",
    "mr_repo": "第015/B/2022-DSB/AMCM号通告市场风险第10段要求采用标准法，并遵守第028/B/2015-DSB/AMCM号通告随函的《市场风险回报填报说明》。特定风险和期限档在随函报表里。这份通告公开文本只有函件，报表没有附上，写不出行号。RWA 按资本的12.5倍，对应第011/2015-AMCM号公告第2点的8%。",
    "mr_irs": "第015/B/2022-DSB/AMCM号通告市场风险第10段要求采用标准法，并遵守第028/B/2015-DSB/AMCM号通告随函的《市场风险回报填报说明》。两腿期限档和差额倍数在随函报表里。这份通告公开文本只有函件，报表没有附上，写不出行号。RWA 按资本的12.5倍，对应第011/2015-AMCM号公告第2点的8%。",
    "mr_fx": "第015/B/2022-DSB/AMCM号通告市场风险第10段要求采用标准法，并遵守第028/B/2015-DSB/AMCM号通告随函的《市场风险回报填报说明》。单币种净敞口和多头、空头取较大一边在随函报表里。这份通告公开文本只有函件，报表没有附上，写不出行号。8%对应第011/2015-AMCM号公告第2点。",
}


def risk_weight(
    issuer_name: object,
    bucket: str,
    grade: str,
    zero_name: str = PRC_MOF,
) -> tuple[float | None, str]:
    name = str(zero_name or "").strip()
    if name and str(issuer_name or "").strip() == name:
        return 0.0, f"发行人是{name}，风险权重 0%"
    weight = WEIGHTS.get((bucket, grade))
    if weight is None:
        return None, f"权重表没有「{bucket} × Grade {grade}」"
    return weight, f"标准法权重表 {bucket} Grade {grade}"


def fx_mop(ccy: object) -> float | None:
    return FX_MOP.get(str(ccy or "").strip().upper())


def simple_rate(ccy: object) -> float | None:
    return SIMPLE_RATE.get(str(ccy or "").strip().upper())


def _pct(weight: float) -> str:
    points = weight * 100
    if abs(points - round(points)) < 1e-8:
        return f"{int(round(points))}%"
    return f"{points:.2f}%"


def ccf_fx(
    residual_months: float,
    cut_short: float = 12,
    ccf_short: float = 0.01,
    cut_mid: float = 60,
    ccf_mid: float = 0.05,
    ccf_long: float = 0.075,
) -> tuple[float, str]:
    if residual_months <= cut_short:
        return ccf_short, f"剩余期限 ≤ {cut_short:g} 个月，外汇附加因子 {_pct(ccf_short)}"
    if residual_months <= cut_mid:
        return ccf_mid, f"剩余期限 ≤ {cut_mid:g} 个月，外汇附加因子 {_pct(ccf_mid)}"
    return ccf_long, f"剩余期限 > {cut_mid:g} 个月，外汇附加因子 {_pct(ccf_long)}"


def specific_factor(category: object, gov: float = 0.0, investment: float = 0.01) -> tuple[float | None, str]:
    text = str(category or "").strip().lower()
    if "投资级" in text:
        return investment, f"投资级企业特定风险 {_pct(investment)}"
    if any(token in text for token in ("政府", "oecd", "主权", "国债")):
        return gov, f"政府类特定风险 {_pct(gov)}"
    return None, "参照表没有该发行人类别的特定风险因子"


def ladder(months: float) -> tuple[str, float]:
    """Maturity-ladder weight. Year boundaries 24 and 60 sit in the longer band, as in 示例7/8."""
    if months <= 1:
        return "0–1个月", 0.0
    if months <= 3:
        return "1–3个月", 0.002
    if months <= 6:
        return "3–6个月", 0.004
    if months <= 12:
        return "6–12个月", 0.007
    if months < 24:
        return "1–2年", 0.0125
    if months < 36:
        return "2–3年", 0.0175
    if months < 48:
        return "3–4年", 0.0225
    if months < 60:
        return "4–5年", 0.0275
    if months < 84:
        return "5–7年", 0.0325
    if months < 120:
        return "7–10年", 0.0375
    if months < 180:
        return "10–15年", 0.045
    if months < 240:
        return "15–20年", 0.0525
    return "20年以上", 0.06
