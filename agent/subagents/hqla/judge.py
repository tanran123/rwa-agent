"""关卡一（通用合格性）→ 关卡二（分档）→ 四项核对。"""

from __future__ import annotations

import json
import re

from .engine import (
    CATEGORY_LABEL,
    asset_class_of,
    currency_group_of,
    days_between,
    fmt_date,
    fmt_money,
    grade_text,
    issuer_category_of,
    level_def,
    now_text,
    num,
    parse_date,
    rating_grade,
    status_text,
)
from .lists import list_hit, list_count

GATE1_FIXED = {
    "encumbered": {"label": "未被质押 / 占用（Unencumbered）", "list": "encumbered"},
    "trading_book": {"label": "非交易账簿持仓", "list": "trading_book"},
    "fi_issuer": {"label": "非金融机构（政策性银行除外）"},
    "structured_sub": {"label": "非结构性 / 次级债", "list": "structured_sub"},
    "related_party": {"label": "非本行及关联实体发行", "list": "related_party"},
    "currency": {"label": "币种可自由兑换"},
}


def build_context(row, cfg, index):
    sec = row.get("ref") or None
    maturity = parse_date(sec.get("mat")) if sec else None
    base = parse_date(cfg.get("baseDate"))
    remaining_days = days_between(maturity, base) if maturity and base else None

    sec_id = row.get("key") or (sec.get("id") if sec else None)
    isin = (sec.get("isin") if sec else "") or row.get("isin") or ""
    issuer = (sec.get("issuer") if sec else "") or ""

    enc_row = list_hit(index, "encumbered", sec_id, isin, issuer)
    trade_row = list_hit(index, "trading_book", sec_id, isin, issuer)
    related_row = list_hit(index, "related_party", sec_id, isin, issuer) or list_hit(index, "own_issue", sec_id, isin, issuer)
    struct_row = list_hit(index, "structured_sub", sec_id, isin, issuer)
    policy_row = list_hit(index, "policy_bank", sec_id, isin, issuer)
    rmbs_row = list_hit(index, "rmbs_approval", sec_id, isin, issuer)
    price30 = num(sec.get("p30")) if sec else None

    rw = num(sec.get("rw")) if sec else None
    rw_source = "外部数据" if rw is not None else "推定"
    if rw is None and sec:
        rw = derive_risk_weight(sec)

    return {
        "sec": sec,
        "id": sec_id,
        "isin": isin,
        "issuer": issuer,
        "category": issuer_category_of(sec),
        "industry": str((sec.get("ind") if sec else "") or "").upper(),
        "grade": rating_grade(sec.get("rating") if sec else None),
        "ccyGroup": row.get("ccyGroup"),
        "ccy": (sec.get("ccy") if sec else "") or "",
        "listed": sec.get("listed") if sec else None,
        "kind": (sec.get("kind") if sec else None) or asset_class_of(sec),
        "assetClass": asset_class_of(sec),
        "rw": rw,
        "rwSource": rw_source,
        "price30": price30,
        "priceSource": "外部市场数据" if price30 is not None else None,
        "remainingDays": remaining_days,
        "missingPolicy": (cfg.get("gate2") or {}).get("missingDataPolicy") or "warn",
        "encumbered": bool(enc_row), "encumberedRow": enc_row,
        "tradingBook": bool(trade_row), "tradingRow": trade_row,
        "relatedParty": bool(related_row), "relatedRow": related_row,
        "structured": bool(struct_row) or bool(sec and str(sec.get("sub") or "").upper() == "Y"), "structRow": struct_row,
        "policyBank": bool(policy_row) or bool(sec and sec.get("cat") == "policy_bank"),
        "approved": bool(rmbs_row) and str(rmbs_row.get("approved") or "").upper() != "N",
        "ltv": num(rmbs_row.get("ltv")) if rmbs_row else None,
    }


def derive_risk_weight(sec):
    if not sec:
        return None
    cat = issuer_category_of(sec)
    grade = rating_grade(sec.get("rating"))
    if cat in ("sovereign", "mdb_io", "local_gov"):
        return 0
    if cat in ("policy_bank", "pse"):
        return 20
    if cat == "bank_fi":
        return 20 if (grade is not None and grade <= 2) else 50
    if cat == "corporate":
        return 100
    return None


# ---------------------------------------------------------------- 关卡一

def evaluate_gate1(ctx, cfg, lists):
    checks = []
    gate1 = cfg.get("gate1") or {}

    def empty(code):
        return list_count(lists, code) == 0

    for check in gate1.get("checks") or []:
        code = check.get("code")
        label = check.get("label") or (GATE1_FIXED.get(code) or {}).get("label") or code
        if not check.get("enabled", True):
            checks.append({"code": code, "label": label, "status": "skip", "detail": "该项检查已关闭"})
            continue

        if code == "encumbered":
            if empty("encumbered"):
                checks.append({"code": code, "label": label, "status": "skip", "detail": "未载入回购 / 质押台账，未执行"})
            elif ctx["encumbered"]:
                amt = (ctx.get("encumberedRow") or {}).get("amount")
                note = (ctx.get("encumberedRow") or {}).get("note")
                detail = "命中质押 / 回购台账" + (f"（占用 {float(amt):,.0f} 港元）" if amt else "") + (f" · {note}" if note else "")
                checks.append({"code": code, "label": label, "status": "fail", "detail": detail})
            else:
                checks.append({"code": code, "label": label, "status": "pass", "detail": "台账中未匹配到该证券"})
            continue

        if code == "trading_book":
            if empty("trading_book"):
                checks.append({"code": code, "label": label, "status": "skip", "detail": "未载入交易账簿清单，未执行"})
            elif ctx["tradingBook"]:
                note = (ctx.get("tradingRow") or {}).get("note")
                checks.append({"code": code, "label": label, "status": "fail", "detail": "命中交易账簿清单" + (f" · {note}" if note else "")})
            else:
                checks.append({"code": code, "label": label, "status": "pass", "detail": "不在交易账簿清单内"})
            continue

        if code == "fi_issuer":
            if not ctx["sec"]:
                checks.append({"code": code, "label": label, "status": "skip", "detail": "无外部信息，无法判断发行人类型"})
            else:
                exception = check.get("policyBankException", True) is not False and ctx["policyBank"]
                if ctx["category"] == "bank_fi" and not exception:
                    checks.append({"code": code, "label": label, "status": "fail", "detail": f"发行人为银行 / 其他金融机构（{ctx['issuer'] or '—'}），且不在政策性银行名单内"})
                elif ctx["category"] == "bank_fi" and exception:
                    checks.append({"code": code, "label": label, "status": "pass", "detail": f"金融机构，但命中政策性银行名单 → 豁免（{ctx['issuer']}）"})
                else:
                    checks.append({"code": code, "label": label, "status": "pass", "detail": f"发行人为 {CATEGORY_LABEL.get(ctx['category'], '非金融机构')}"})
            continue

        if code == "structured_sub":
            if ctx["structured"]:
                note = (ctx.get("structRow") or {}).get("note")
                checks.append({"code": code, "label": label, "status": "fail", "detail": "命中结构性 / 次级债清单" + (f" · {note}" if note else "")})
            else:
                checks.append({"code": code, "label": label, "status": "pass", "detail": "未标记为结构性 / 次级债"})
            continue

        if code == "related_party":
            if empty("related_party") and empty("own_issue"):
                checks.append({"code": code, "label": label, "status": "skip", "detail": "未载入关联方名单，未执行"})
            elif ctx["relatedParty"]:
                checks.append({"code": code, "label": label, "status": "fail", "detail": f"发行人命中关联方 / 本行发行名单（{ctx['issuer'] or '—'}）"})
            else:
                checks.append({"code": code, "label": label, "status": "pass", "detail": "发行人不在关联方名单内"})
            continue

        if code == "currency":
            allowed = check.get("allowed") or []
            ccy = str(ctx["ccy"] or "").upper()
            if not ccy:
                checks.append({"code": code, "label": label, "status": "skip", "detail": "币种缺失，无法判断"})
            elif allowed and ccy not in allowed:
                checks.append({"code": code, "label": label, "status": "fail", "detail": f"币种 {ccy} 不在可自由兑换清单内"})
            else:
                checks.append({"code": code, "label": label, "status": "pass", "detail": f"币种 {ccy} 可自由兑换"})
            continue

        checks.append({"code": code, "label": label, "status": "skip", "detail": "未知检查项"})

    failures = [c for c in checks if c["status"] == "fail"]
    skipped = [c for c in checks if c["status"] == "skip"]
    if failures:
        status = "fail"
        summary = "；".join(c["detail"] for c in failures)
    elif skipped:
        status = "pass_with_note"
        summary = "部分检查因缺少清单未执行"
    else:
        status = "pass"
        summary = "全部检查通过"
    return {"status": status, "checks": checks, "failures": failures, "skipped": skipped, "summary": summary}


# ---------------------------------------------------------------- 关卡二

def rule_matches(rule, ctx):
    w = rule.get("when") or {}
    if w.get("fallback"):
        return True
    if w.get("categories") and ctx["category"] not in w["categories"]:
        return False
    if w.get("industries") and ctx["industry"] not in w["industries"]:
        return False
    if w.get("ccyGroups") and ctx["ccyGroup"] not in w["ccyGroups"]:
        return False
    if w.get("listed") and w["listed"] != "any" and str(ctx["listed"] or "").upper() != w["listed"]:
        return False
    if w.get("assetClasses") and ctx["assetClass"] not in w["assetClasses"]:
        return False
    if w.get("kinds") and ctx["kind"] not in w["kinds"]:
        return False
    if w.get("rw"):
        if ctx["rw"] is None or num(ctx["rw"]) not in [num(x) for x in w["rw"]]:
            return False
    if w.get("rwMax") is not None:
        if ctx["rw"] is None or num(ctx["rw"]) > num(w["rwMax"]):
            return False
    if w.get("maxGrade") is not None:
        if ctx["grade"] is None or ctx["grade"] > w["maxGrade"]:
            return False
    if w.get("minGrade") is not None:
        if ctx["grade"] is None or ctx["grade"] < w["minGrade"]:
            return False
    if w.get("maxPrice30") is not None:
        if ctx["price30"] is None:
            if ctx["missingPolicy"] == "fail":
                return False
        elif num(ctx["price30"]) > num(w["maxPrice30"]):
            return False
    if w.get("approval") and not ctx["approved"]:
        return False
    if w.get("maxLtv") is not None:
        if ctx["ltv"] is None or num(ctx["ltv"]) > num(w["maxLtv"]):
            return False
    if w.get("maxRemainingDays") is not None:
        if ctx["remainingDays"] is None or ctx["remainingDays"] > w["maxRemainingDays"]:
            return False
    return True


def evaluate_rule_conditions(rule, ctx):
    w = rule.get("when") or {}
    if w.get("fallback"):
        return [{"name": "兜底规则", "ok": True, "expect": "不满足前述任何档位", "actual": "—"}]
    out = []

    def push(name, ok, expect, actual):
        out.append({"name": name, "ok": ok, "expect": expect, "actual": actual})

    if w.get("categories"):
        push("发行人类型", ctx["category"] in w["categories"],
             " / ".join(CATEGORY_LABEL.get(c, c) for c in w["categories"]),
             CATEGORY_LABEL.get(ctx["category"], ctx["category"]))
    if w.get("kinds"):
        push("债券种类", ctx["kind"] in w["kinds"], " / ".join(w["kinds"]), ctx["kind"] or "—")

    def rw_text(value):
        return "缺失" if value is None else f"{value}%" + ("（推定）" if ctx["rwSource"] == "推定" else "")

    if w.get("rw"):
        push("标准法风险权重", ctx["rw"] is not None and num(ctx["rw"]) in [num(x) for x in w["rw"]],
             " / ".join(f"{x}%" for x in w["rw"]), rw_text(ctx["rw"]))
    if w.get("rwMax") is not None:
        push("风险权重上限", ctx["rw"] is not None and num(ctx["rw"]) <= num(w["rwMax"]),
             f"≤ {w['rwMax']}%", "缺失" if ctx["rw"] is None else f"{ctx['rw']}%")
    if w.get("maxGrade") is not None:
        push("债项评级", ctx["grade"] is not None and ctx["grade"] <= w["maxGrade"],
             "不差于 " + grade_text(w["maxGrade"]),
             "缺失 / 未评级" if ctx["grade"] is None else grade_text(ctx["grade"]))
    if w.get("minGrade") is not None:
        push("债项评级下限", ctx["grade"] is not None and ctx["grade"] >= w["minGrade"],
             "不优于 " + grade_text(w["minGrade"]),
             "缺失" if ctx["grade"] is None else grade_text(ctx["grade"]))
    if w.get("maxPrice30") is not None:
        ok = (ctx["missingPolicy"] != "fail") if ctx["price30"] is None else num(ctx["price30"]) <= num(w["maxPrice30"])
        actual = ("缺失（按不满足处理）" if ctx["missingPolicy"] == "fail" else "缺失（暂按满足处理，需补证）") if ctx["price30"] is None else f"{ctx['price30']}%（{ctx['priceSource'] or '—'}）"
        push("30 天价格跌幅", ok, f"≤ {w['maxPrice30']}%", actual)
    if w.get("approval"):
        push("金管局批准", bool(ctx["approved"]), "需批准", "已批准" if ctx["approved"] else "未批准")
    if w.get("maxLtv") is not None:
        push("加权平均 LTV", ctx["ltv"] is not None and num(ctx["ltv"]) <= num(w["maxLtv"]),
             f"≤ {w['maxLtv']}%", "缺失" if ctx["ltv"] is None else f"{ctx['ltv']}%")
    if w.get("ccyGroups"):
        push("币种组", ctx["ccyGroup"] in w["ccyGroups"], " / ".join(w["ccyGroups"]), ctx["ccyGroup"])
    if w.get("listed") and w["listed"] != "any":
        push("上市", str(ctx["listed"] or "").upper() == w["listed"], w["listed"], ctx["listed"] or "—")
    if w.get("maxRemainingDays") is not None:
        push("剩余期限", ctx["remainingDays"] is not None and ctx["remainingDays"] <= w["maxRemainingDays"],
             f"≤ {w['maxRemainingDays']} 天", "缺失" if ctx["remainingDays"] is None else f"{ctx['remainingDays']} 天")
    return out


def evaluate_gate2(ctx, cfg):
    closest = None
    for rule in cfg.get("rules") or []:
        if rule.get("enabled") is False:
            continue
        checks = evaluate_rule_conditions(rule, ctx)
        passed = len([c for c in checks if c["ok"]])
        if closest is None or passed > closest["passed"]:
            closest = {"rule": rule, "checks": checks, "passed": passed}
        if rule_matches(rule, ctx):
            return {
                "level": rule["target"], "ruleId": rule["id"], "ruleLabel": rule["label"],
                "clause": rule.get("clause"), "checks": checks, "hit": True, "ctx": ctx,
            }
    fallback = closest or {"rule": None, "checks": []}
    failed = [c for c in (fallback.get("checks") or []) if not c["ok"]]
    if failed:
        reason = "未满足 " + (fallback["rule"]["id"] if fallback.get("rule") else "") + " 的条件：" + "；".join(
            f"{f['name']}（要求 {f['expect']}，实际 {f['actual']}）" for f in failed[:3]
        )
    else:
        reason = "未命中任何分档规则"
    return {
        "level": "NA", "ruleId": None, "ruleLabel": "不满足任何档位条件", "clause": "—",
        "checks": fallback.get("checks") or [], "hit": False, "reason": reason, "ctx": ctx,
    }


def judge_row(row, cfg, index):
    ctx = build_context(row, cfg, index)
    gate1 = evaluate_gate1(ctx, cfg, index.get("_lists") or {})
    gate2 = evaluate_gate2(ctx, cfg)
    level = "NA" if gate1["status"] == "fail" else gate2["level"]
    return {
        "ctx": ctx, "gate1": gate1, "gate2": gate2,
        "judged": {
            "level": level,
            "ruleId": gate2.get("ruleId"),
            "ruleLabel": gate2.get("ruleLabel"),
            "clause": "关卡一不合格" if (level == "NA" and gate1["status"] == "fail") else gate2.get("clause"),
            "checks": gate2.get("checks") or [],
            "blockedByGate1": gate1["status"] == "fail",
        },
        "remainingDays": ctx["remainingDays"],
        "price30": ctx["price30"],
        "rw": ctx["rw"],
        "category": ctx["category"],
        "kind": ctx["kind"],
    }


# ---------------------------------------------------------------- 规则体检

def analyze_rules(cfg):
    issues = []
    rules = [r for r in (cfg.get("rules") or []) if r.get("enabled") is not False]
    if not any((r.get("when") or {}).get("fallback") for r in rules):
        issues.append({"level": "danger", "code": "no-fallback", "text": "缺少兜底规则：未命中任何档位的债券将无法归类"})
    seen = {}
    for i, rule in enumerate(rules):
        w = rule.get("when") or {}
        key = str(sorted((k, str(v)) for k, v in w.items()))
        if key in seen:
            issues.append({"level": "warn", "code": "dup", "text": f"{rule['id']} 与 {seen[key]} 条件完全相同，{rule['id']} 永远无法命中"})
        else:
            seen[key] = rule["id"]
        if not w.get("fallback") and len(w) == 0 and i < len(rules) - 1:
            issues.append({"level": "warn", "code": "empty", "text": f"{rule['id']} 未设置任何条件，将命中全部债券，其后的规则不会生效"})
        if w.get("fallback") and i != len(rules) - 1:
            issues.append({"level": "warn", "code": "fallback-order", "text": f"兜底规则 {rule['id']} 不在最后，其后的规则不会生效"})
        if not any(l.get("code") == rule.get("target") for l in cfg.get("levels") or []):
            issues.append({"level": "danger", "code": "bad-target", "text": f"{rule['id']} 的目标档位「{rule.get('target')}」不存在"})
    if not any((r.get("when") or {}).get("maxGrade") is not None or (r.get("when") or {}).get("minGrade") is not None for r in rules):
        issues.append({"level": "info", "code": "no-rating", "text": "所有规则都未设置评级条件（若监管口径要求评级门槛，请补充）"})
    return issues


# ---------------------------------------------------------------- 四项核对

def check_classification(row, cfg):
    definition = level_def(cfg, row["judged"]["level"])
    reported = row["item"]
    if not (cfg.get("checks") or {}).get("classification", {}).get("enabled", True):
        return {"status": "skip", "text": "已关闭分类核对"}
    if not row.get("ref"):
        return {"status": "skip", "text": "无外部债券信息，无法按规则判定档位（请先载入外部参考库）"}
    if reported == "UNK":
        return {"status": "warn", "text": f"申报档位「{row.get('itemRaw') or '空'}」无法识别", "expected": row["judged"]["level"], "actual": reported}
    if reported == row["judged"]["level"]:
        return {"status": "pass", "text": f"与规则判定一致（{definition['label']}）", "expected": row["judged"]["level"], "actual": reported}
    rep_label = level_def(cfg, reported)["label"]
    if row["judged"].get("blockedByGate1"):
        return {"status": "fail", "text": f"申报为 {rep_label}，但未通过关卡一通用合格性：{row['gate1']['summary']}", "expected": "NA", "actual": reported}
    return {"status": "fail", "text": f"申报为 {rep_label}，按规则应属 {definition['label']}（{row['judged']['ruleLabel']}）", "expected": row["judged"]["level"], "actual": reported}


def check_valuation(row, cfg):
    c = (cfg.get("checks") or {}).get("valuation") or {}
    if not c.get("enabled", True):
        return {"status": "skip", "text": "已关闭估值核对"}
    ref = row.get("ref")
    if not ref:
        return {"status": "skip", "text": "无外部债券信息，无法核对估值"}
    mv, acc, book, ecl = num(ref.get("mv")), num(ref.get("acc")), num(ref.get("book")), num(ref.get("ecl"))
    if mv is None and book is None:
        return {"status": "skip", "text": "外部信息缺少市值/账面价值"}
    use_book = c.get("basis") == "book" and str(ref.get("acct") or "") == "Amortised Cost" and book is not None
    expected = (book + (acc or 0) + (ecl or 0)) if use_book else ((book if mv is None else mv) + (acc or 0))
    diff = (row.get("amount") or 0) - expected
    tol = max(num(c.get("toleranceAbs")) or 0, abs(expected) * (num(c.get("tolerancePct")) or 0))
    basis_text = "账面价值＋应计利息＋减值准备" if use_book else "市值＋应计利息"
    if abs(diff) <= tol:
        return {"status": "pass", "text": f"{basis_text} {fmt_money(expected)} 与申报一致", "expected": expected, "actual": row.get("amount"), "diff": diff}
    return {"status": "fail", "text": f"{basis_text}应为 {fmt_money(expected)}，申报 {fmt_money(row.get('amount'))}，差异 {fmt_money(diff)}", "expected": expected, "actual": row.get("amount"), "diff": diff}


def check_maturity(row, cfg):
    c = (cfg.get("checks") or {}).get("maturity") or {}
    if not c.get("enabled", True):
        return {"status": "skip", "text": "已关闭期限核对"}
    ref = row.get("ref")
    if not ref:
        return {"status": "skip", "text": "无外部债券信息，无法核对到期日"}
    mat = parse_date(ref.get("mat"))
    if not mat:
        return {"status": "skip", "text": "外部信息缺少到期日"}
    base = parse_date(cfg.get("baseDate")) or parse_date(now_text()[:10])
    days = days_between(mat, base)
    row["remainingDays"] = days
    months = days / 30.44
    row["remainingMonths"] = round(months * 10) / 10
    row["termBand"] = "已到期" if days < 0 else ("< 6 个月" if months < 6 else ("6 ~ <12 个月" if months < 12 else "≥ 12 个月"))
    if days < 0:
        return {"status": "fail", "text": f"已于 {fmt_date(mat)} 到期（基准日后 {-days} 天），不应计入 HQLA", "days": days}
    if days <= (num(c.get("lcrDays")) or 30):
        return {"status": "warn", "text": f"{days} 天后（{fmt_date(mat)}）到期，落在 LCR 观察期内，须与 Part C6（期间内到期证券）交叉核对，确认是否重复计入", "days": days}
    return {"status": "pass", "text": f"剩余 {days} 天（{row['termBand']}），到期日 {fmt_date(mat)}", "days": days}


def check_rating(row, cfg):
    c = (cfg.get("checks") or {}).get("rating") or {}
    if not c.get("enabled", True):
        return {"status": "skip", "text": "已关闭评级核对"}
    ref = row.get("ref")
    if not ref:
        return {"status": "skip", "text": "无外部债券信息，无法核对评级"}
    level = row["judged"]["level"]
    if level == "NA":
        return {"status": "skip", "text": "判定为非 HQLA，不适用评级门槛", "grade": rating_grade(ref.get("rating"))}
    definition = level_def(cfg, level)
    grade = rating_grade(ref.get("rating"))
    row["ratingGrade"] = grade
    if definition.get("minGrade") is None:
        return {"status": "pass", "text": f"{definition['label']} 无最低评级要求（当前 {ref.get('rating') or '未评级'}）", "grade": grade}
    if grade is None:
        return {"status": "warn", "text": f"未取得债券评级，需人工确认是否满足「{grade_text(definition['minGrade'])}」的合格评级要求", "grade": grade, "required": definition["minGrade"]}
    if grade <= definition["minGrade"]:
        return {"status": "pass", "text": f"评级 {ref.get('rating')} 对应{grade_text(grade)}，满足 {definition['label']} 门槛（{grade_text(definition['minGrade'])}）", "grade": grade, "required": definition["minGrade"]}
    return {"status": "fail", "text": f"评级 {ref.get('rating')} 对应{grade_text(grade)}，低于 {definition['label']} 门槛（{grade_text(definition['minGrade'])}）", "grade": grade, "required": definition["minGrade"]}


# ---------------------------------------------------------------- 主流程

def build_reference_index(reference_rows):
    by_id, by_isin = {}, {}
    for row in reference_rows or []:
        key = str(row.get("id") or "").strip()
        if key:
            by_id[key] = row
        if row.get("isin"):
            by_isin[str(row["isin"]).upper()] = row
    return {"byId": by_id, "byIsin": by_isin}


def ref_lookup(ref_index, key, isin=None):
    if key and key in ref_index["byId"]:
        return {"row": ref_index["byId"][key], "by": "证券代码"}
    if isin and str(isin).upper() in ref_index["byIsin"]:
        return {"row": ref_index["byIsin"][str(isin).upper()], "by": "ISIN"}
    return {"row": None, "by": None}


_ADJUST_RE = re.compile(r"^less\b|repo|pledged|扣减|调整", re.I)


def normalize_ccy_group(raw, ref, cfg):
    text = str(raw or "").strip().upper()
    if text in ("HKD", "USD", "RMB", "MAJOR", "OTHER"):
        return text
    if text in ("CNY", "CNH"):
        return "RMB"
    if text:
        return currency_group_of(text, cfg)
    if ref and ref.get("ccy"):
        return currency_group_of(ref["ccy"], cfg)
    return "OTHER"


def overall_status(checks):
    items = [checks.get(k) for k in ("classification", "valuation", "maturity", "rating") if checks.get(k)]
    if any(c["status"] == "fail" for c in items):
        return "fail"
    if any(c["status"] == "warn" for c in items):
        return "warn"
    if items and all(c["status"] == "skip" for c in items):
        return "skip"
    return "pass"


def run(input_rows, cfg, lists, reference_rows):
    """返回 {rows, stats, byCheck, cfgSnapshot, runAt}。"""
    index = build_index_mixed(lists)
    ref_index = build_reference_index(reference_rows)
    rows = []
    for i, raw in enumerate(input_rows or []):
        looks_adjust = (not raw.get("key")) or bool(_ADJUST_RE.search(str(raw.get("secId") or "")))
        hit = ref_lookup(ref_index, raw.get("key")) if raw.get("key") else {"row": None, "by": None}
        ref = hit["row"]
        ccy_group = normalize_ccy_group(raw.get("ccyGroupRaw"), ref, cfg)
        out = {
            "i": i,
            "lineNo": raw.get("lineNo"),
            "itemRaw": raw.get("itemRaw"),
            "item": raw.get("item"),
            "secId": raw.get("secId"),
            "key": raw.get("key"),
            "ccyGroup": ccy_group,
            "ccyGroupRaw": raw.get("ccyGroupRaw"),
            "amount": raw.get("amount"),
            "ref": ref,
            "matchBy": hit["by"],
            "isAdjustment": looks_adjust and not ref,
            "remainingDays": None,
            "remainingMonths": None,
            "termBand": None,
            "ratingGrade": None,
            "judged": {"level": "NA", "clause": "—", "ruleLabel": "—", "ruleId": None},
            "checks": {},
            "gate1": None,
            "gate2": None,
            "ctx": None,
        }
        if out["isAdjustment"]:
            out["judged"] = {
                "level": "NA" if out["item"] == "UNK" else out["item"],
                "ruleId": None,
                "ruleLabel": "手工调整行（不使用分类规则）",
                "clause": "手工调整",
                "checks": [],
                "blockedByGate1": False,
            }
            out["checks"] = {
                "classification": {"status": "skip", "text": "手工调整行（如回购扣减），不适用于逐笔分类核对"},
                "valuation": {"status": "skip", "text": "手工调整行，无对应外部债券信息"},
                "maturity": {"status": "skip", "text": "手工调整行，无到期日"},
                "rating": {"status": "skip", "text": "手工调整行，不适用评级门槛"},
            }
            out["status"] = "skip"
            rows.append(out)
            continue

        judged = judge_row(out, cfg, index)
        out["gate1"] = judged["gate1"]
        out["gate2"] = judged["gate2"]
        out["ctx"] = judged["ctx"]
        out["judged"] = judged["judged"]
        out["remainingDays"] = judged["remainingDays"]
        out["rw"] = judged["rw"]
        out["price30"] = judged["price30"]
        out["category"] = judged["category"]
        out["kind"] = judged["kind"]
        out["checks"]["classification"] = check_classification(out, cfg)
        out["checks"]["valuation"] = check_valuation(out, cfg)
        out["checks"]["maturity"] = check_maturity(out, cfg)
        out["checks"]["rating"] = check_rating(out, cfg)
        out["status"] = overall_status(out["checks"])
        rows.append(out)

    stats = {
        "total": len(rows), "securities": 0, "adjustments": 0, "matched": 0, "unmatched": 0,
        "pass": 0, "warn": 0, "fail": 0, "skip": 0,
        "gate1Fail": 0, "gate1Pass": 0, "gate1Skip": 0,
        "byLevel": {"L1": 0, "L2A": 0, "L2B": 0, "NA": 0},
    }
    by_check = {
        "classification": {"fail": 0, "warn": 0},
        "valuation": {"fail": 0, "warn": 0},
        "maturity": {"fail": 0, "warn": 0},
        "rating": {"fail": 0, "warn": 0},
    }
    for row in rows:
        if row["isAdjustment"]:
            stats["adjustments"] += 1
            stats["skip"] += 1
            continue
        stats["securities"] += 1
        if row["ref"]:
            stats["matched"] += 1
        else:
            stats["unmatched"] += 1
        status = row["status"]
        if status in stats:
            stats[status] += 1
        gate1 = row.get("gate1")
        if gate1:
            if gate1["status"] == "fail":
                stats["gate1Fail"] += 1
            elif gate1["status"] == "pass_with_note":
                stats["gate1Skip"] += 1
            else:
                stats["gate1Pass"] += 1
        level = (row.get("judged") or {}).get("level")
        if level in stats["byLevel"]:
            stats["byLevel"][level] += 1
        for key, check in (row.get("checks") or {}).items():
            if key not in by_check:
                continue
            if check["status"] == "fail":
                by_check[key]["fail"] += 1
            if check["status"] == "warn":
                by_check[key]["warn"] += 1
    stats["matchedPct"] = (stats["matched"] / stats["securities"]) if stats["securities"] else 0

    return {
        "rows": rows,
        "stats": stats,
        "byCheck": by_check,
        "cfgSnapshot": json.loads(json.dumps(cfg, ensure_ascii=False)),
        "runAt": now_text(),
    }


def build_index_mixed(lists):
    """把清单索引和清单原始行放在一起，judge_row 需要两者。"""
    from .lists import build_index

    index = build_index(lists)
    index["_lists"] = lists or {}
    return index
