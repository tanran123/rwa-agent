"""Stable fields and header aliases. Upload column titles may change; formulas use these ids."""

from __future__ import annotations

import re

# field id -> aliases matched against a normalized header (punctuation and spaces removed).
ALIASES: dict[str, list[str]] = {
    "trade_id": ["回购交易编号", "回购编号", "互换编号", "交易编号", "repoid", "swapid"],
    "book": ["账簿", "bankingbook", "tradingbook"],
    "issuer_name": ["发行人名称", "发行人"],
    "issuer_type": ["发行人类型", "issuertype"],
    "issuer_category": ["发行人类别", "特定风险类别"],
    "rating_sp": ["sp评级", "评级sp", "标普", "sprating"],
    "rating_moodys": ["moodys评级", "评级moodys", "穆迪", "moodysrating"],
    "rating_fitch": ["fitch评级", "惠誉", "评级fitch", "fitch"],
    "bond_ccy": ["债券计价货币", "债券币种", "bondccy"],
    "cash_ccy": ["融入币种", "cashccy"],
    "position_local": ["持仓规模", "持仓", "账面价值", "面值", "positionlocal"],
    "residual_months": ["远端剩余期限", "剩余期限月", "剩余期限", "residualm", "residual"],
    "counterparty_name": ["交易对手", "counterparty"],
    "counterparty_type": ["对手类型", "counterpartytype"],
    "far_ccy_1": ["远端币种一", "farccy1"],
    "far_amt_1": ["远端币种一金额", "farccy1amt"],
    "far_ccy_2": ["远端币种二", "farccy2"],
    "far_amt_2": ["远端币种二金额", "farccy2amt"],
    "mv_mop": ["债券市值", "市值mop", "市值", "marketvalue"],
    "direction": ["方向", "direction"],
    "floating_tenor_months": ["浮动腿期限", "floatingterm"],
    "floating_pv": ["浮动腿现值", "floatingpv"],
    "fixed_tenor_months": ["固定腿期限", "fixedterm"],
    "fixed_pv": ["固定腿现值", "fixedpv"],
    "ccy": ["远端币种", "币种", "farccy", "ccy"],
    "side": ["多空头", "多头空头", "方向头寸"],
    "nop_mop": ["净敞口", "netopenposition", "nop"],
    "notional": ["名义本金", "名义", "notional"],
}

REQUIRED: dict[str, list[str]] = {
    "repo_credit": [
        "issuer_name",
        "issuer_type",
        "rating_sp",
        "bond_ccy",
        "position_local",
        "residual_months",
    ],
    "ccr_fx": [
        "counterparty_type",
        "rating_fitch",
        "far_ccy_1",
        "far_amt_1",
        "far_ccy_2",
        "far_amt_2",
        "residual_months",
    ],
    "mr_repo": ["mv_mop", "issuer_category", "residual_months"],
    "mr_irs": [
        "floating_pv",
        "floating_tenor_months",
        "fixed_pv",
        "fixed_tenor_months",
    ],
    "mr_fx": ["ccy", "nop_mop"],
}

OPTIONAL: dict[str, list[str]] = {
    "repo_credit": ["trade_id"],
    "ccr_fx": ["trade_id", "counterparty_name"],
    "mr_repo": ["trade_id"],
    "mr_irs": ["trade_id", "direction"],
    "mr_fx": ["trade_id", "side"],
}

PACK_TITLE = {
    "repo_credit": "正回购信用风险",
    "ccr_fx": "外汇互换对手信用风险",
    "mr_repo": "回购利率市场风险",
    "mr_irs": "利率互换市场风险",
    "mr_fx": "外汇净敞口市场风险",
}

FIELD_HINT = {
    "trade_id": "只用来在结果里认出这一笔，不进入乘式。",
    "issuer_name": "通告 025 第 1 条看发行人名称。是「中华人民共和国财政部」时，风险权重为 0。",
    "issuer_type": "决定查哪一类权重：主权、PSE、银行、企业/非银。银行还会再分一般档和三个月以内档。",
    "issuer_category": "决定利率特定风险。政府类为 0%，投资级企业为 1%。",
    "rating_sp": "用 S&P 符号精确匹配 Grade。这一套信用风险公式只读这一列。",
    "rating_fitch": "用 Fitch 符号得到对手的 Grade，再去查风险权重。",
    "bond_ccy": "债券币种是 CNH 时，持仓除以 7.2 折成美元；其他币种按原币金额。",
    "position_local": "信用风险 RWA 的基数。RWA = 折美元后的持仓 × 风险权重。",
    "residual_months": "银行且不超过 3 个月时走短期权重。对手信用风险里还用来算折现年限和附加因子：不超过 12 个月为 1%，不超过 60 个月为 5%，更长为 7.5%。市场风险里用来查期限档。",
    "counterparty_name": "结果里显示对手名称，权重看的是对手类型和评级。",
    "counterparty_type": "银行按「银行-一般」查标准法权重。通告第 5 条的 30% 还要原到期日，当前知识库没有这条的输入字段。",
    "far_ccy_1": "远端第一腿的币种。金额为正是流入腿，为负是流出腿。",
    "far_amt_1": "远端第一腿金额，保留正负号。附加因子乘在流入腿折成澳门元之后的金额上。",
    "far_ccy_2": "远端第二腿的币种，和第一腿方向相反。",
    "far_amt_2": "远端第二腿金额，保留正负号。两腿必须一正一负。",
    "mv_mop": "质押债市值，单位澳门元。特定风险资本和一般市场风险加权头寸都以它为基数。",
    "direction": "收浮动或付固定。当前资本公式取两腿加权头寸之差的绝对值，方向不改变这个数。",
    "floating_tenor_months": "浮动腿做到下次重定价的月数，用来查期限档权重。",
    "floating_pv": "浮动腿现值。加权头寸 = 现值 × 该期限档权重。",
    "fixed_tenor_months": "固定腿做到到期的月数，用来查期限档权重。",
    "fixed_pv": "固定腿现值。加权头寸 = 现值 × 该期限档权重。",
    "ccy": "这一行净敞口的币种。全行把多头、空头分开合计时用来归类。",
    "side": "多头或空头。全行口径取两边合计的较大者。不映射时这一行按多头。",
    "nop_mop": "该币种净敞口，单位澳门元。按行资本 = 净敞口 × 8%，按行 RWA 等于净敞口。",
    "notional": "名义本金不进入利率互换的这套资本公式。",
}

FIELD_LABEL = {
    "trade_id": "交易编号",
    "book": "账簿",
    "issuer_name": "发行人",
    "issuer_type": "发行人类型或对手类型",
    "issuer_category": "特定风险类别",
    "rating_sp": "S&P 评级",
    "rating_moodys": "Moody's 评级",
    "rating_fitch": "Fitch 评级",
    "bond_ccy": "债券币种",
    "cash_ccy": "融入币种",
    "position_local": "持仓原币",
    "residual_months": "剩余期限（月）",
    "counterparty_name": "交易对手",
    "counterparty_type": "对手类型",
    "far_ccy_1": "远端币种一",
    "far_amt_1": "远端金额一",
    "far_ccy_2": "远端币种二",
    "far_amt_2": "远端金额二",
    "mv_mop": "市值（澳门元）",
    "direction": "方向",
    "floating_tenor_months": "浮动腿期限（月）",
    "floating_pv": "浮动腿现值",
    "fixed_tenor_months": "固定腿期限（月）",
    "fixed_pv": "固定腿现值",
    "ccy": "币种",
    "side": "多空方向",
    "nop_mop": "净敞口（澳门元）",
    "notional": "名义本金",
}


def norm_header(value: object) -> str:
    if not isinstance(value, str):
        return ""
    text = value.strip()
    if not text or len(text) > 80:
        return ""
    text = text.lower().replace("\n", "")
    text = text.replace("（", "(").replace("）", ")")
    text = re.sub(r"[\s_/\\:：,，.。·\-—–&'’()（）%％]", "", text)
    return text


def best_match(header: object) -> tuple[str, int] | None:
    text = norm_header(header)
    if not text:
        return None
    found: tuple[str, int] | None = None
    for field, aliases in ALIASES.items():
        for alias in aliases:
            if field == "ccy" and any(token in text for token in ("近端", "流入", "流出")):
                continue
            if alias in text and (found is None or len(alias) > found[1]):
                found = (field, len(alias))
    return found


def map_header_row(row: list) -> dict[str, int]:
    """Map field id -> column index. Each field keeps the header with the longest alias."""
    best: dict[str, tuple[int, int]] = {}
    for col, cell in enumerate(row):
        hit = best_match(cell)
        if hit is None:
            continue
        field, length = hit
        prev = best.get(field)
        if prev is None or length > prev[1]:
            best[field] = (col, length)
    return {field: col for field, (col, _) in best.items()}


def classify(fields: set[str], sheet_name: str) -> tuple[str, str | None]:
    if "far_amt_1" in fields and "far_ccy_1" in fields:
        return "ccr_fx", None
    if "floating_pv" in fields and "fixed_pv" in fields:
        return "mr_irs", "trading"
    if "nop_mop" in fields:
        return "mr_fx", "trading"
    if "mv_mop" in fields:
        return "mr_repo", "trading"
    if "position_local" in fields:
        trading = "市场风险" in sheet_name or "交易账簿" in sheet_name
        return "repo_credit", "trading" if trading else "banking"
    return "", None
