"""Editable calculation parameters. Rating weights and the maturity ladder stay in reference.py."""

from __future__ import annotations

DEFAULT_PACK_RULES: dict[str, dict] = {
    "repo_credit": {
        "usd_cnh": 7.2,
        "capital_ratio": 0.08,
        "bank_short_months": 3.0,
        "zero_weight_name": "中华人民共和国财政部",
    },
    "ccr_fx": {
        "cut_short": 12.0,
        "ccf_short": 0.01,
        "cut_mid": 60.0,
        "ccf_mid": 0.05,
        "ccf_long": 0.075,
        "capital_ratio": 0.08,
    },
    "mr_repo": {
        "specific_gov": 0.0,
        "specific_ig": 0.01,
        "rwa_multiplier": 12.5,
    },
    "mr_irs": {
        "gap_factor": 2.0,
        "rwa_multiplier": 12.5,
    },
    "mr_fx": {
        "capital_ratio": 0.08,
    },
}

_NUMBER = {
    "usd_cnh": (0.0001, 100),
    "capital_ratio": (0, 1),
    "bank_short_months": (0, 120),
    "cut_short": (0, 600),
    "ccf_short": (0, 1),
    "cut_mid": (0, 600),
    "ccf_mid": (0, 1),
    "ccf_long": (0, 1),
    "specific_gov": (0, 1),
    "specific_ig": (0, 1),
    "rwa_multiplier": (0.0001, 100),
    "gap_factor": (0, 20),
}

_TEXT = {"zero_weight_name": 80}


def resolve_rules(raw: object) -> dict[str, dict]:
    """Fill every pack from defaults. Unknown packs and keys are ignored."""
    if raw is None:
        raw = {}
    if not isinstance(raw, dict):
        raise ValueError("规则格式无效")
    resolved: dict[str, dict] = {}
    for pack, defaults in DEFAULT_PACK_RULES.items():
        incoming = raw.get(pack, {})
        if incoming is None:
            incoming = {}
        if not isinstance(incoming, dict):
            raise ValueError("规则格式无效")
        merged = dict(defaults)
        for key, value in incoming.items():
            if key not in defaults or value is None:
                continue
            if key in _TEXT:
                text = str(value).strip()
                if len(text) > _TEXT[key]:
                    raise ValueError("规则里的文字过长")
                merged[key] = text
                continue
            low, high = _NUMBER[key]
            try:
                number = float(value)
            except (TypeError, ValueError):
                raise ValueError("规则里的数字无效") from None
            if number != number or number in (float("inf"), float("-inf")) or number < low or number > high:
                raise ValueError("规则里的数字超出范围")
            merged[key] = number
        if pack == "ccr_fx" and merged["cut_mid"] < merged["cut_short"]:
            raise ValueError("附加因子的中期限上限要大于短期限上限")
        resolved[pack] = merged
    return resolved
