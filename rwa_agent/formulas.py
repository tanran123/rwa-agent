"""Formula packs. Inputs are stable fields; results are not read from the upload."""

from __future__ import annotations

from rwa_agent.reference import (
    CAPITAL_RATIO,
    ccf_fx,
    fx_mop,
    grade_of,
    ladder,
    matched_type,
    risk_weight,
    simple_rate,
    specific_factor,
)
from rwa_agent.rules import DEFAULT_PACK_RULES


def _step(name: str, expr: str, value: float | str | None) -> dict:
    return {"name": name, "expr": expr, "value": value}


def _pack(rules: dict | None, name: str) -> dict:
    if rules and name in rules:
        return rules[name]
    return DEFAULT_PACK_RULES[name]


def position_usd(bond_ccy: object, position_local: float, usd_cnh: float) -> tuple[float, str]:
    if str(bond_ccy or "").strip().upper() == "CNH":
        return position_local / usd_cnh, f"{position_local:g} / {usd_cnh:g}"
    return position_local, f"{position_local:g}"


def calc_repo_credit(row: dict, rules: dict | None = None) -> dict:
    cfg = _pack(rules, "repo_credit")
    steps = []
    pos, expr = position_usd(row.get("bond_ccy"), float(row["position_local"]), cfg["usd_cnh"])
    steps.append(_step("折美元", expr, pos))
    grade = grade_of(row.get("rating_sp"))
    steps.append(_step("评级分档", f"rating_sp {row.get('rating_sp')}", grade))
    bucket = matched_type(row.get("issuer_type"), row.get("residual_months"), cfg["bank_short_months"])
    steps.append(_step("发行人档", bucket, bucket))
    weight, why = risk_weight(row.get("issuer_name"), bucket, grade, cfg["zero_weight_name"])
    steps.append(_step("风险权重", why, weight))
    if weight is None:
        return {"ok": False, "steps": steps, "message": why}
    rwa = pos * weight
    capital = rwa * cfg["capital_ratio"]
    steps.append(_step("RWA", "position_usd × risk_weight", rwa))
    steps.append(_step("资本", f"rwa × {_pct(cfg['capital_ratio'])}", capital))
    return {
        "ok": True,
        "steps": steps,
        "rwa": rwa,
        "capital": capital,
        "currency": "USD",
        "summary": f"{why}。RWA = {pos:,.2f} × {_pct(weight)}",
    }


def calc_ccr(row: dict, rules: dict | None = None) -> dict:
    cfg = _pack(rules, "ccr_fx")
    steps = []
    ccy1, amt1 = str(row.get("far_ccy_1") or "").strip().upper(), float(row["far_amt_1"])
    ccy2, amt2 = str(row.get("far_ccy_2") or "").strip().upper(), float(row["far_amt_2"])
    if amt1 == 0 or amt2 == 0 or (amt1 > 0) == (amt2 > 0):
        return {"ok": False, "steps": steps, "message": "远端两腿需要一正一负"}
    if amt1 > 0:
        in_ccy, in_amt, out_ccy, out_amt = ccy1, amt1, ccy2, abs(amt2)
    else:
        in_ccy, in_amt, out_ccy, out_amt = ccy2, amt2, ccy1, abs(amt1)
    in_fx, out_fx = fx_mop(in_ccy), fx_mop(out_ccy)
    if in_fx is None or out_fx is None:
        missing = in_ccy if in_fx is None else out_ccy
        return {"ok": False, "steps": steps, "message": f"汇率表没有 {missing}"}
    in_mop, out_mop = in_amt * in_fx, out_amt * out_fx
    steps.append(_step("流入腿澳门元", f"{in_amt:g} {in_ccy} × {in_fx:g}", in_mop))
    steps.append(_step("流出腿澳门元", f"{out_amt:g} {out_ccy} × {out_fx:g}", out_mop))
    months = float(row["residual_months"])
    t = months / 12
    r_in, r_out = simple_rate(in_ccy), simple_rate(out_ccy)
    if r_in is None or r_out is None:
        return {"ok": False, "steps": steps, "message": "简单利率表缺币种"}
    df_in = 1 / (1 + r_in * t)
    df_out = 1 / (1 + r_out * t)
    mtm = in_mop * df_in - out_mop * df_out
    ce = max(0.0, mtm)
    steps.append(_step("现期暴露", "max(0, 流入折现 − 流出折现)", ce))
    ccf, ccf_why = ccf_fx(
        months,
        cfg["cut_short"],
        cfg["ccf_short"],
        cfg["cut_mid"],
        cfg["ccf_mid"],
        cfg["ccf_long"],
    )
    addon = in_mop * ccf
    cea = ce + addon
    steps.append(_step("附加因子", ccf_why, ccf))
    steps.append(_step("信用暴露", "现期暴露 + 流入腿澳门元 × 附加因子", cea))
    bucket = matched_type(row.get("counterparty_type"), None)
    if bucket == "银行-短期(≤3月)":
        bucket = "银行-一般"
    grade = grade_of(row.get("rating_fitch"))
    weight, why = risk_weight(None, bucket, grade)
    steps.append(_step("对手权重", f"Fitch {row.get('rating_fitch')} → Grade {grade}。{why}", weight))
    if weight is None:
        return {"ok": False, "steps": steps, "message": why}
    rwa = cea * weight
    capital = rwa * cfg["capital_ratio"]
    steps.append(_step("RWA", "信用暴露 × 对手权重", rwa))
    return {
        "ok": True,
        "steps": steps,
        "rwa": rwa,
        "capital": capital,
        "currency": "MOP",
        "summary": f"{why}。信用暴露 {cea:,.0f}，RWA {rwa:,.0f} 澳门元",
    }


def calc_mr_repo(row: dict, rules: dict | None = None) -> dict:
    cfg = _pack(rules, "mr_repo")
    mv = float(row["mv_mop"])
    months = float(row["residual_months"])
    category = row.get("issuer_category") or row.get("issuer_type")
    factor, factor_why = specific_factor(category, cfg["specific_gov"], cfg["specific_ig"])
    if factor is None:
        return {"ok": False, "steps": [], "message": factor_why}
    band, gmr = ladder(months)
    specific = mv * factor
    weighted = mv * gmr
    capital = specific + weighted
    rwa = capital * cfg["rwa_multiplier"]
    steps = [
        _step("特定风险资本", f"市值 × {factor_why}", specific),
        _step("一般市场风险", f"{band} 权重 {_pct(gmr)}", weighted),
        _step("资本", "特定风险资本 + 加权头寸", capital),
        _step("RWA", f"资本 × {cfg['rwa_multiplier']:g}", rwa),
    ]
    return {
        "ok": True,
        "steps": steps,
        "rwa": rwa,
        "capital": capital,
        "currency": "MOP",
        "summary": f"{factor_why}；{band} {_pct(gmr)}。资本 {capital:,.0f}，RWA {rwa:,.0f} 澳门元",
    }


def calc_mr_irs(row: dict, rules: dict | None = None) -> dict:
    cfg = _pack(rules, "mr_irs")
    float_months = float(row["floating_tenor_months"])
    fixed_months = float(row["fixed_tenor_months"])
    float_pv = float(row["floating_pv"])
    fixed_pv = float(row["fixed_pv"])
    float_band, float_w = ladder(float_months)
    fixed_band, fixed_w = ladder(fixed_months)
    float_weighted = float_pv * float_w
    fixed_weighted = fixed_pv * fixed_w
    capital = abs(float_weighted - fixed_weighted) * cfg["gap_factor"]
    rwa = capital * cfg["rwa_multiplier"]
    larger = max(float_weighted, fixed_weighted)
    steps = [
        _step("浮动腿加权", f"{float_band} {_pct(float_w)}", float_weighted),
        _step("固定腿加权", f"{fixed_band} {_pct(fixed_w)}", fixed_weighted),
        _step("资本", f"|浮动腿加权 − 固定腿加权| × {cfg['gap_factor']:g}", capital),
        _step("RWA", f"资本 × {cfg['rwa_multiplier']:g}", rwa),
    ]
    return {
        "ok": True,
        "steps": steps,
        "rwa": rwa,
        "capital": capital,
        "currency": "MOP",
        "summary": (
            f"浮动腿 {float_band}，固定腿 {fixed_band}。"
            f"按示例公式资本 {capital:,.0f}；两腿若落在 1 区与 3 区，期限法资本为较大一腿 {larger:,.0f}"
        ),
        "ladder_capital": larger,
    }


def calc_mr_fx(row: dict, rules: dict | None = None) -> dict:
    cfg = _pack(rules, "mr_fx")
    nop = abs(float(row["nop_mop"]))
    capital = nop * cfg["capital_ratio"]
    rwa = nop
    side = str(row.get("side") or "")
    short = ("空" in side) or ("short" in side.lower())
    steps = [
        _step("单币种资本", f"净敞口 × {_pct(cfg['capital_ratio'])}", capital),
        _step("单币种 RWA", "净敞口", rwa),
    ]
    return {
        "ok": True,
        "steps": steps,
        "rwa": rwa,
        "capital": capital,
        "currency": "MOP",
        "nop": nop,
        "short": short,
        "summary": f"{'空头' if short else '多头'} {nop:,.0f} × {_pct(cfg['capital_ratio'])}，RWA {rwa:,.0f} 澳门元",
    }


def fx_portfolio(legs: list[dict], capital_ratio: float = CAPITAL_RATIO) -> dict:
    long_sum = sum(item["nop"] for item in legs if not item["short"])
    short_sum = sum(item["nop"] for item in legs if item["short"])
    base = max(long_sum, short_sum)
    return {
        "long": long_sum,
        "short": short_sum,
        "base": base,
        "capital": base * capital_ratio,
        "rwa": base,
        "line_rwa": sum(item["rwa"] for item in legs),
    }


def _pct(weight: float) -> str:
    points = weight * 100
    if abs(points - round(points)) < 1e-8:
        return f"{int(round(points))}%"
    return f"{points:.2f}%"
