"""汇总重编（Level × 币种组）、关卡三组合上限、与客户申报数对账。"""

from __future__ import annotations

from .engine import level_def


def aggregate(rows, cfg, by="reported"):
    ccy_codes = [g["code"] for g in cfg.get("currencyGroups") or []]
    levels = ["L1", "L2A", "L2B", "NA", "UNK"]
    matrix = {}
    for level in levels:
        matrix[level] = {"ccy": {c: {"amount": 0, "weighted": 0} for c in ccy_codes}, "totalAmount": 0, "totalWeighted": 0}

    for row in rows or []:
        level = row["judged"]["level"] if by == "judged" else ("UNK" if row.get("item") == "UNK" else row.get("item"))
        ccy = row.get("ccyGroup") if row.get("ccyGroup") in ccy_codes else "OTHER"
        amount = row.get("amount") or 0
        weight = (level_def(cfg, level) or {}).get("weight") or 0
        if level not in matrix:
            matrix[level] = {"ccy": {}, "totalAmount": 0, "totalWeighted": 0}
        if ccy not in matrix[level]["ccy"]:
            matrix[level]["ccy"][ccy] = {"amount": 0, "weighted": 0}
        matrix[level]["ccy"][ccy]["amount"] += amount
        matrix[level]["ccy"][ccy]["weighted"] += amount * weight
        matrix[level]["totalAmount"] += amount
        matrix[level]["totalWeighted"] += amount * weight

    totals = {"amount": 0, "weighted": 0, "ccy": {c: {"amount": 0, "weighted": 0} for c in ccy_codes}}
    for level in levels:
        totals["amount"] += matrix[level]["totalAmount"]
        totals["weighted"] += matrix[level]["totalWeighted"]
        for c in ccy_codes:
            totals["ccy"][c]["amount"] += matrix[level]["ccy"].get(c, {}).get("amount", 0)
            totals["ccy"][c]["weighted"] += matrix[level]["ccy"].get(c, {}).get("weighted", 0)

    return {"by": by, "ccyCodes": ccy_codes, "levels": levels, "matrix": matrix, "totals": totals, "levelDefs": cfg.get("levels")}


def apply_caps(agg, cfg):
    gate3 = cfg.get("gate3") or {}
    l2_pct = float(gate3.get("level2CapPct") if gate3.get("level2CapPct") is not None else 0.40)
    l2b_pct = float(gate3.get("level2bCapPct") if gate3.get("level2bCapPct") is not None else 0.15)
    a = agg["matrix"]["L1"]["totalWeighted"] if "L1" in agg["matrix"] else 0
    b = agg["matrix"]["L2A"]["totalWeighted"] if "L2A" in agg["matrix"] else 0
    c = agg["matrix"]["L2B"]["totalWeighted"] if "L2B" in agg["matrix"] else 0
    before = {"l1": a, "l2a": b, "l2b": c, "total": a + b + c}

    if not gate3.get("enabled", True):
        return {
            "enabled": False, "before": before, "after": {**before, "l2": b + c, "l2b": c},
            "caps": {"l2Pct": l2_pct, "l2bPct": l2b_pct}, "binding": {"l2": False, "l2b": False},
            "excluded": {"l2": 0, "l2b": 0},
        }

    total = a + b + c
    b2, c2 = b, c
    for _ in range(60):
        cap_l2b = l2b_pct * total
        cap_l2 = l2_pct * total
        c2 = min(c, cap_l2b)
        b2 = min(b, max(0.0, cap_l2 - c2))
        total2 = a + b2 + c2
        if abs(total2 - total) < 0.5:
            total = total2
            break
        total = total2

    after = {"l1": a, "l2a": b2, "l2b": c2, "l2": b2 + c2, "total": a + b2 + c2}
    return {
        "enabled": True, "before": before, "after": after,
        "caps": {"l2Pct": l2_pct, "l2bPct": l2b_pct, "l2CapAmount": l2_pct * after["total"], "l2bCapAmount": l2b_pct * after["total"]},
        "binding": {"l2": b2 < b - 0.5, "l2b": c2 < c - 0.5},
        "excluded": {"l2": b - b2, "l2b": c - c2},
        "ratios": {
            "l2Before": (b + c) / before["total"] if before["total"] else 0,
            "l2bBefore": c / before["total"] if before["total"] else 0,
            "l2After": after["l2"] / after["total"] if after["total"] else 0,
            "l2bAfter": after["l2b"] / after["total"] if after["total"] else 0,
        },
    }


def reconcile(agg, reported_rows, cfg):
    tolerance = cfg.get("reconciliation") or {}
    tol_abs = float(tolerance.get("toleranceThousand") or 1)
    tol_pct = float(tolerance.get("tolerancePct") or 0)

    rep = {}
    for row in reported_rows or []:
        raw_level = row.get("level")
        level = raw_level
        for code in ("L1", "L2A", "L2B", "NA"):
            if raw_level in (code, {"L1": "Level 1", "L2A": "Level 2A", "L2B": "Level 2B"}.get(code)):
                level = code
        rep.setdefault(level, {"principal": 0, "weighted": 0, "ccy": {}, "clauses": []})
        rep[level]["principal"] += float(row.get("principalThousand") or 0)
        rep[level]["weighted"] += float(row.get("weightedThousand") or 0)
        for ccy, value in (row.get("byCcy") or {}).items():
            rep[level]["ccy"][ccy] = rep[level]["ccy"].get(ccy, 0) + float(value or 0)
        rep[level]["clauses"].append(row)

    rows = []
    for level in ("L1", "L2A", "L2B"):
        for group in cfg.get("currencyGroups") or []:
            dtt = agg["matrix"].get(level, {}).get("ccy", {}).get(group["code"], {}).get("weighted", 0) / 1000
            cyb = (rep.get(level) or {}).get("ccy", {}).get(group["code"], 0)
            diff = dtt - cyb
            tol = max(tol_abs, abs(cyb) * tol_pct)
            rows.append({"level": level, "ccy": group["code"], "ccyLabel": group["label"], "dtt": dtt, "cyb": cyb, "diff": diff, "status": "ok" if abs(diff) <= tol else "diff"})
        dtt_total = agg["matrix"].get(level, {}).get("totalWeighted", 0) / 1000
        cyb_total = (rep.get(level) or {}).get("weighted", 0)
        rows.append({
            "level": level, "ccy": "TOTAL", "ccyLabel": "合计", "dtt": dtt_total, "cyb": cyb_total, "diff": dtt_total - cyb_total,
            "status": "ok" if abs(dtt_total - cyb_total) <= max(tol_abs, abs(cyb_total) * tol_pct) else "diff",
        })

    dtt_total = agg["totals"]["weighted"] / 1000
    cyb_total = sum((rep.get(level) or {}).get("weighted", 0) for level in ("L1", "L2A", "L2B"))
    return {
        "rows": rows,
        "rep": rep,
        "summary": {
            "dttTotal": dtt_total,
            "cybTotal": cyb_total,
            "diff": dtt_total - cyb_total,
            "diffPct": ((dtt_total - cyb_total) / cyb_total) if cyb_total else 0,
            "exceptions": len([r for r in rows if r["status"] == "diff"]),
            "hasReported": any(rep.get(level) for level in ("L1", "L2A", "L2B")),
        },
    }
