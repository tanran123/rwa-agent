"""风险暴露分类的纯规则引擎。

这一层只做三件事：

1. 把分类 JSON 里的规则树按顺序走一遍，得到命中的大类、子类和权重；
2. 把 Excel 原值按规则字段的选项归一化；
3. 处理多重评级、同一银行未评级债权的权重回写。

规则文档来自数据库，不在这里读文件，也不调用模型。工作簿计算
(``steps/weight/calc``) 和向导第五步 (``steps/weight/classify``) 共用
这一份实现，避免两套权重口径。
"""

from __future__ import annotations

import re
from datetime import date, datetime
from typing import Any

from agent.core.weight.engine import (
    _cond,
    _looks_residential,
    _num,
    _ordinary_categories,
    _ordinary_facts,
    _party_key,
    _percent,
    _period_header,
    _walk,
    _walk_steps,
)
from agent.core.weight.rules import load_class_doc, rule_index
from agent.core.weight.trace import step

_RATING_RANK = [
    "AAA", "AA+", "AA", "AA-", "A+", "A", "A-",
    "BBB+", "BBB", "BBB-", "BB+", "BB", "BB-", "B+", "B", "B-",
    "CCC", "CC", "C", "D",
]

_MOODY = (
    ("Aaa", "AAA"), ("Aa1", "AA+"), ("Aa2", "AA"), ("Aa3", "AA-"),
    ("A1", "A+"), ("A2", "A"), ("A3", "A-"),
    ("Baa1", "BBB+"), ("Baa2", "BBB"), ("Baa3", "BBB-"),
    ("Ba1", "BB+"), ("Ba2", "BB"), ("Ba3", "BB-"),
    ("B1", "B+"), ("B2", "B"), ("B3", "B-"),
    ("Caa", "CCC"), ("Ca", "CC"),
)

_SP_RATING = re.compile(r"(?:標普|标普|S&P|SP)\s*([A-D]{1,3}\s*[+-]?)")
_FITCH_RATING = re.compile(r"(?:惠譽|惠誉|Fitch)\s*([A-D]{1,3}\s*[+-]?)")
_MOODY_MARK = re.compile(r"(?:穆迪|Moody's|Moodys)\s*([A-C][a-z0-9]+)")

_RATING_FIELDS = {"issuer_rating", "bond_rating", "country_rating"}

_NUMBER_FIELDS = {
    "single_exposure", "balance", "notional_amount_mop", "ead",
    "residual_maturity_months", "ltv", "provision_ratio",
    "provision_ratio_past_due", "original_maturity_months",
    "cet1_ratio", "leverage_ratio", "debt_ratio", "covered_oc_ratio",
    "revenue_last_year", "retail_aggregate_exposure", "exposure_share",
    "market_price_current", "offbalance_amount", "onbalance_amount",
}


def rating_codes(text: str) -> list[str]:
    """从一段评级文字里取出 S&P 口径的评级代码。"""
    cleaned = " ".join(str(text or "").replace("／", "/").split())
    found: list[str] = []

    def keep(code: str) -> None:
        if code in _RATING_RANK and code not in found:
            found.append(code)

    for pattern in (_SP_RATING, _FITCH_RATING):
        for match in pattern.finditer(cleaned):
            keep(match.group(1).replace(" ", ""))
    for match in _MOODY_MARK.finditer(cleaned):
        token = match.group(1)
        for raw, sp in _MOODY:
            if token.startswith(raw):
                keep(sp)
                break
    if not found and re.fullmatch(r"[A-D]{1,3}[+-]?", cleaned):
        keep(cleaned)
    if not found:
        for raw, sp in _MOODY:
            if raw in cleaned:
                keep(sp)
                break
    if found:
        return found
    if cleaned.upper() in {"NR", "N/A", "NA", "UNRATED", "无", "無"}:
        return ["unrated"]
    return []


def rating_code(text: str) -> str | None:
    found = rating_codes(text)
    ranked = [item for item in found if item in _RATING_RANK]
    if ranked:
        return max(ranked, key=_RATING_RANK.index)
    if "unrated" in found:
        return "unrated"
    return None


def coerce_value(field: str, raw: Any, options: list[dict], header: str = "") -> Any:
    """把来源列的原值归一化成规则里可比的值。

    选项代码以规则文档的 ``options`` 为准；原值等于 label 或 code 时取 code。
    日期、空值、无法识别的值一律返回 ``None``，规则里引用它的条件不命中。
    """
    if isinstance(raw, datetime) or isinstance(raw, date):
        return None
    if field in _NUMBER_FIELDS:
        number = _num(raw)
        if number is None:
            return None
        if field == "ltv" and number > 3:
            return number / 100.0
        if field == "provision_ratio" and number > 1:
            return number
        if field == "original_maturity_months" and _period_header(header):
            return number / 30.0
        if field == "original_maturity_months" and number > 600 and any(
            token in header.lower() for token in ("day", "period", "rest")
        ):
            return number / 30.0
        return number
    text = str(raw).strip()
    if field == "property_uses" and ("," in text or "，" in text):
        codes = []
        for part in text.replace("，", ",").split(","):
            piece = part.strip()
            code = ""
            for opt in options:
                if piece == str(opt.get("code")) or piece == str(opt.get("label")):
                    code = opt.get("code")
                    break
            if not code and piece in {"residential", "commercial", "mixed_use"}:
                code = piece
            if code and code not in codes:
                codes.append(code)
        if codes:
            return codes
    if field in _RATING_FIELDS:
        rated = rating_code(text)
        if rated:
            return rated
    for opt in options:
        if text == str(opt.get("code")) or text == str(opt.get("label")):
            code = opt.get("code")
            if field == "property_uses":
                return [code]
            return code
    upper = text.upper()
    if field == "counterparty_type":
        if upper in {"P", "INDIVIDUAL"} or "个人" in text or "自然人" in text:
            return "individual"
        if upper in {"BANK"} or "银行" in text or "同业" in text:
            return "commercial_bank"
        if upper in {"SOVEREIGN"} or "主权" in text or "财政部" in text:
            return "cn_central_government" if any(token in upper for token in ("CN", "MO", "中国", "澳门", "我國")) else "foreign_sovereign"
        if upper in {"MDBS", "MDB"}:
            return "mdb"
        if upper in {"PSES", "PSE", "MUNICIPAL", "GOV"}:
            return "pse"
        if upper in {"C", "CORP", "CORPORATE"} or "公司" in text or "企业" in text:
            return "corporate"
    if field == "is_defaulted":
        if any(token in upper for token in ("LOSS", "SUBSTANDARD", "DOUBTFUL", "次级", "可疑", "损失", "违约", "TRUE", "逾期")):
            return "yes"
        if upper in {"PASS", "NORMAL", "FALSE"} or text in {"正常", "关注", "否", "N", "NO"}:
            return "no"
    if field in {"has_property_collateral", "cashflow_dependent", "is_credit_card", "treat_as_equity", "is_subordinated"}:
        if text in {"Y", "YES", "是", "TRUE"}:
            return "yes"
        if text in {"N", "NO", "否", "FALSE"}:
            return "no"
    if field == "property_uses":
        if _looks_residential(text):
            return ["residential"]
        if any(token in text for token in ("商用", "商业", "COMMERCIAL")):
            return ["commercial"]
    if field == "instrument_type":
        if text in {"cash", "gold", "other_asset", "equity", "covered_bond", "claim"}:
            return text
        if "现金" in text:
            return "cash"
        if "黄金" in text:
            return "gold"
        if "股权" in text:
            return "equity"
        if "担保债券" in text or "COVERED" in upper:
            return "covered_bond"
        if "其他资产" in text or "固定资产" in text:
            return "other_asset"
        return "claim"
    if field == "counterparty_name":
        return text
    return None


# 兼容旧的私有名字：工作簿计算和向导都从这里取。
_rating_codes = rating_codes
_rating_code = rating_code
_coerce = coerce_value


def _walk_rules(nodes: object):
    for rule in nodes or []:
        if not isinstance(rule, dict):
            continue
        yield rule
        yield from _walk_rules(rule.get("children"))
        other = rule.get("otherwise")
        if isinstance(other, dict):
            yield from _walk_rules([other])


_LOCAL_RULES: dict[str, dict] | None = None


def _rule_by_name(name: str, doc: dict[str, Any] | None = None) -> dict | None:
    """按名字找附加规则。给了 ``doc`` 就只看这一份，向导据此用产品文档。"""
    global _LOCAL_RULES
    if doc is None:
        if _LOCAL_RULES is None:
            _LOCAL_RULES = rule_index(load_class_doc())
        return _LOCAL_RULES.get(str(name))
    return rule_index(doc).get(str(name))


def _rule_when(when: object, facts: dict[str, Any]) -> bool:
    if not isinstance(when, dict):
        return False
    if "all" in when or "any" in when:
        key = "all" if "all" in when else "any"
        items = when.get(key) if isinstance(when.get(key), list) else []
        checks = []
        for item in items:
            if not isinstance(item, dict):
                checks.append(False)
            elif "all" in item or "any" in item:
                checks.append(_rule_when(item, facts))
            else:
                checks.append(_rule_cond(item, facts))
        if key == "all":
            return bool(checks) and all(checks)
        return bool(checks) and any(checks)
    return _rule_cond(when, facts)


def _rule_cond(cond: dict, facts: dict[str, Any]) -> bool:
    return _cond({
        "field": cond.get("field"),
        "op": cond.get("op") or "eq",
        "value": cond.get("match", cond.get("value")),
    }, facts)


def _count_hit(count: int, when: object) -> bool:
    if not isinstance(when, dict) or when.get("field") != "assessment_count":
        return False
    try:
        expected = float(when.get("match"))
    except (TypeError, ValueError):
        return False
    op = when.get("op") or "eq"
    if op == "eq":
        return count == expected
    if op == "gte":
        return count >= expected
    if op == "gt":
        return count > expected
    if op == "lte":
        return count <= expected
    if op == "lt":
        return count < expected
    return False


def _choose_assessment(pairs: list[tuple[float, str]], rule: dict) -> tuple[float, str, str]:
    distinct = {rw for rw, _code in pairs}
    if len(pairs) == 1:
        return pairs[0][0], pairs[0][1], "only"
    if len(distinct) == 1:
        return pairs[0][0], pairs[0][1], "same_weight"
    use = ""
    for item in rule.get("pick") or []:
        if isinstance(item, dict) and _count_hit(len(pairs), item.get("when")):
            use = str(item.get("use") or "")
            break
    if use == "higher_weight":
        rw, code = max(pairs, key=lambda item: item[0])
        return rw, code, use
    if use == "higher_of_two_lowest_weights":
        ordered = sorted(pairs, key=lambda item: item[0])
        rw, code = max(ordered[:2], key=lambda item: item[0])
        return rw, code, use
    ranked = [item for item in pairs if item[1] in _RATING_RANK]
    pool = ranked or pairs
    rw, code = max(pool, key=lambda item: _RATING_RANK.index(item[1]) if item[1] in _RATING_RANK else -1)
    return rw, code, "higher_weight"


def _assessment_note(field: str, codes: list[str], code: str, rw: float, use: str) -> str:
    listed = "、".join(codes)
    chosen = code + "，权重 " + _percent(rw)
    if use == "higher_weight":
        how = "有 2 个评级且权重不同，用较高的风险权重"
    elif use == "higher_of_two_lowest_weights":
        how = "有 3 个及以上评级且权重不同，用两个较低权重里较高的一个"
    elif use == "same_weight":
        how = "这些评级对应的权重相同"
    else:
        how = "只用这一个评级"
    return field + " 的评级是 " + listed + "。" + how + "，取 " + chosen + "。"


def _apply_rating_choices_ready(ready: list[dict], categories: list, rule: dict | None = None) -> None:
    for item in ready:
        for facts, _amount in item.get("draft") or []:
            _apply_rating_choices(facts, categories, rule)


def _apply_rating_choices(facts: dict[str, Any], categories: list, rule: dict | None = None) -> None:
    choices = facts.get("_rating_choices")
    if not isinstance(choices, dict):
        return
    if rule is None:
        rule = _rule_by_name("multiple_assessments")
    applies = {str(name) for name in (rule.get("applies_to") or [])} if rule else set()
    notes = []
    for field, codes in list(choices.items()):
        if not isinstance(codes, list):
            continue
        usable = [str(code) for code in codes if code and str(code) != "unrated"]
        if len(usable) < 2:
            if len(usable) == 1 and field not in facts:
                facts[field] = usable[0]
            continue
        if rule is None or field not in applies:
            ranked = [code for code in usable if code in _RATING_RANK]
            if ranked and field not in facts:
                facts[field] = max(ranked, key=_RATING_RANK.index)
            continue
        pairs: list[tuple[float, str]] = []
        for code in usable:
            trial = dict(facts)
            trial.pop("_rating_choices", None)
            trial[field] = code
            hit = classify(categories, trial)
            rw = hit.get("rw")
            if isinstance(rw, (int, float)) and not isinstance(rw, bool):
                pairs.append((float(rw), code))
        if not pairs:
            continue
        rw, code, use = _choose_assessment(pairs, rule)
        facts[field] = code
        notes.append({
            "field": field,
            "result": code,
            "note": _assessment_note(field, usable, code, rw, use),
        })
    if notes:
        facts["_assessment_notes"] = notes


def _weight_close(left: float, right: float) -> bool:
    return abs(float(left) - float(right)) < 1e-9


def _peer_has(peers: list[float], target: float) -> bool:
    return any(_weight_close(item, target) for item in peers)


def _is_unrated_claim(facts: dict[str, Any], rule: dict) -> bool:
    field = str(rule.get("unrated_field") or "issuer_rating")
    pool = {str(item) for item in (rule.get("unrated_match") or ["unrated"])}
    if field not in facts or facts.get(field) in (None, ""):
        return bool(rule.get("unrated_if_missing"))
    return str(facts.get(field)) in pool


def _under_rule(hit: dict, name: str) -> bool:
    if not name:
        return True
    prefix = name + "_"
    for item in hit.get("steps") or []:
        rule_id = str(item.get("rule") or "")
        if rule_id == name or rule_id.startswith(prefix):
            return True
    return False


def _link_value(facts: dict, derived: Any, peers: list[float], rule: dict) -> tuple[float, str] | None:
    for item in rule.get("raise") or []:
        if not isinstance(item, dict):
            continue
        if "when_peer_weight_eq" in item:
            try:
                target = float(item["when_peer_weight_eq"])
            except (TypeError, ValueError):
                continue
            if item.get("scope") != "all_unrated" or not _peer_has(peers, target) or "value" not in item:
                continue
            try:
                value = float(item["value"])
            except (TypeError, ValueError):
                continue
            note = "该银行其他已评级债权的权重含 " + _percent(target) + "，这家银行的未评级债权定为 " + _percent(value) + "。"
            return value, note
        targets = item.get("when_peer_weight_in")
        if not isinstance(targets, list):
            continue
        numbers = []
        for piece in targets:
            try:
                numbers.append(float(piece))
            except (TypeError, ValueError):
                continue
        if item.get("scope") == "short_unrated" and not _rule_cond(rule.get("short") or {}, facts):
            continue
        if not any(_peer_has(peers, number) for number in numbers):
            continue
        floor = None
        use_derived = False
        for piece in item.get("greater_of") or []:
            if piece == "derived":
                use_derived = True
            elif isinstance(piece, (int, float)):
                floor = float(piece)
        if floor is None:
            continue
        if use_derived and isinstance(derived, (int, float)):
            value = max(floor, float(derived))
        else:
            value = floor
        shown = "、".join(_percent(number) for number in numbers)
        note = "该银行其他已评级债权的权重为 " + shown + "，原始期限不超过 3 个月的未评级债权取 " + _percent(floor) + " 与已得权重中的较大者。"
        return value, note
    return None


def _apply_bank_link(ready: list[dict], categories: list) -> None:
    """先按资本档次得到权重，再把同一银行其他已评级债权的最高权重写回，让商业银行下的未评级节点命中。"""
    grouped: dict[str, list[tuple[dict, dict]]] = {}
    for item in ready:
        for facts, _amount in item.get("draft") or []:
            facts.pop("bank_peer_weight", None)
            facts.pop("derived_bank_weight", None)
            hit = classify(categories, facts)
            if facts.get("counterparty_type") != "commercial_bank" or not _under_rule(hit, "fi_bank"):
                continue
            key = _party_key(str(facts.get("counterparty_name") or facts.get("_debtor") or ""))
            if not key:
                continue
            grouped.setdefault(key, []).append((facts, hit))
    for group in grouped.values():
        peers = []
        for facts, hit in group:
            rating = facts.get("issuer_rating")
            rw = hit.get("rw")
            if rating in (None, "", "unrated") or isinstance(rw, bool) or not isinstance(rw, (int, float)):
                continue
            peers.append(float(rw))
        if not peers:
            continue
        peer = max(peers)
        for facts, hit in group:
            rating = facts.get("issuer_rating")
            if rating not in (None, "", "unrated"):
                continue
            if rating in (None, ""):
                facts["issuer_rating"] = "unrated"
            facts["bank_peer_weight"] = peer
            rw = hit.get("rw")
            if isinstance(rw, (int, float)) and not isinstance(rw, bool):
                facts["derived_bank_weight"] = float(rw)


def _with_special_weight(facts: dict, hit: dict) -> dict:
    steps = list(hit.get("steps") or [])
    changed = False
    notes = facts.get("_assessment_notes")
    if isinstance(notes, list):
        for note in notes:
            if not isinstance(note, dict):
                continue
            changed = True
            steps.append(step(
                "权重",
                "多重评级取值",
                rule="multiple_assessments",
                field=str(note.get("field") or ""),
                result=note.get("result") or "",
                hit=True,
                note=str(note.get("note") or ""),
            ))
    if not changed:
        return hit
    return {**hit, "steps": steps}


def classify(categories: list, facts: dict[str, Any], ordinary: bool = False) -> dict[str, Any]:
    """按顺序走规则树，返回命中的大类、子类、权重和逐步判断。"""
    walked = _walk(categories, facts)
    if not walked:
        return {
            "category": "未归类",
            "subclass": "未归类",
            "rw": None,
            "rw_text": "",
            "steps": [step("分类", "未归类", hit=False, note="决策树没有命中风险暴露类型")],
        }
    node = walked[-1]
    weight = ((node.get("then") or {}).get("risk_weight") or {})
    kind = weight.get("type")
    rw = weight.get("value") if kind == "const" else None
    text = weight.get("display") or ""
    steps = _walk_steps(walked, facts)
    if kind == "max_field":
        floor = weight.get("with")
        other = facts.get(str(weight.get("field") or ""))
        if isinstance(floor, (int, float)) and not isinstance(floor, bool):
            if isinstance(other, (int, float)) and not isinstance(other, bool):
                rw = max(float(floor), float(other))
            else:
                rw = float(floor)
            text = _percent(rw)
    elif not ordinary and kind in {"counterparty", "max"}:
        other = classify(_ordinary_categories(categories), _ordinary_facts(facts), True)
        other_rw = other.get("rw")
        if kind == "counterparty":
            rw = other_rw
            text = "按交易对手" if rw is None else _percent(rw)
        else:
            floor = weight.get("with") if isinstance(weight.get("with"), (int, float)) else 0.9
            rw = floor if other_rw is None else max(float(floor), float(other_rw))
            text = _percent(rw)
        for item in other.get("steps") or []:
            again = dict(item)
            again["note"] = (again.get("note") + "；" if again.get("note") else "") + "按交易对手的普通债权再走一次"
            steps.append(again)
    steps.append(step(
        "权重",
        text or "未定权重",
        rule=str(node.get("id") or ""),
        result=text,
        hit=isinstance(rw, (int, float)) and not isinstance(rw, bool),
        note="" if isinstance(rw, (int, float)) and not isinstance(rw, bool) else "这一档没有固定权重，需要人工确认",
    ))
    return {
        "category": walked[0].get("label") or "",
        "subclass": node.get("label") or "",
        "path": " → ".join(str(item.get("label") or "") for item in walked if item.get("label")),
        "rule_id": node.get("id") or "",
        "rw": float(rw) if isinstance(rw, (int, float)) and not isinstance(rw, bool) else None,
        "rw_text": text,
        "steps": steps,
    }


# 兼容工作簿计算里的旧名字。
_classify = classify
