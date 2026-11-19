"""LCR 计量：按产品侧别查参数表，汇总 HQLA / 现金流入 / 现金流出。

输入来自 Koa 的 liquidity.lcrInput()：
  task.datasets  —— 每个 Sheet 的标准化行与字段映射
  products       —— 流动性产品配置（side、param_key）
  tables         —— HQLA 折扣率、现金流入率、现金流出率
  params         —— 流入上限、Level 2 上限、LCR 下限

这个模块不读数据库，也不改任务状态；Koa 负责持久化，前端负责复核与归档。
"""

from __future__ import annotations

from datetime import datetime

AMOUNT_FIELDS = ("amount", "book_value", "fair_value", "undrawn_amount")


def _num(value):
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).replace(",", "").replace("，", "").replace(" ", "")
    text = text.replace("（", "-").replace("(", "-").replace("）", "").replace(")", "")
    try:
        return float(text)
    except ValueError:
        return None


def _round(value):
    return round(float(value or 0), 2)


def _value(row, mapping, fields):
    for field in fields:
        header = mapping.get(field)
        if header and row.get(header) not in (None, ""):
            return row.get(header), field
        if row.get(field) not in (None, ""):
            return row.get(field), field
    return None, ""


def _business_id(row, mapping):
    value, _ = _value(row, mapping, ("business_id",))
    return "" if value is None else str(value)


def _rate_tables(tables):
    haircut = {}
    inflow = {}
    outflow = {}
    for table in tables or []:
        kind = table.get("kind") or ""
        for row in table.get("rows") or []:
            if kind == "HQLA_HAIRCUT":
                haircut[str(row.get("hqla_key") or "")] = {
                    "factor": _num(row.get("haircut_factor")),
                    "level": str(row.get("hqla_level") or ""),
                    "basis": str(row.get("basis_note") or ""),
                }
            elif kind == "CASH_INFLOW_RATE":
                inflow[str(row.get("inflow_key") or "")] = {
                    "factor": _num(row.get("inflow_rate")),
                    "category": str(row.get("inflow_category") or ""),
                    "basis": str(row.get("basis_note") or ""),
                }
            elif kind == "CASH_OUTFLOW_RATE":
                outflow[str(row.get("outflow_key") or "")] = {
                    "factor": _num(row.get("outflow_rate")),
                    "category": str(row.get("outflow_category") or ""),
                    "basis": str(row.get("basis_note") or ""),
                }
    return haircut, inflow, outflow


def _param_map(params):
    out = {}
    for item in params or []:
        out[str(item.get("id") or "")] = _num(item.get("value"))
    return out


def _apply_caps(level1, level2a, level2b, params):
    cap_b = params.get("P_L2B_CAP")
    cap_2 = params.get("P_L2_TOTAL_CAP")
    if cap_b is None:
        cap_b = 0.15
    if cap_2 is None:
        cap_2 = 0.40
    level2b_adj = level2b
    if level1 <= 0:
        level2b_adj = 0.0
    elif cap_b < 1:
        level2b_adj = min(level2b, level1 * cap_b / (1 - cap_b))
    level2_total = level2a + level2b_adj
    level2_adj = level2_total
    if level1 <= 0:
        level2_adj = 0.0
    elif cap_2 < 1:
        level2_adj = min(level2_total, level1 * cap_2 / (1 - cap_2))
    return {
        "level1": _round(level1),
        "level2a": _round(level2a),
        "level2b": _round(level2b),
        "level2bAdjusted": _round(level2b_adj),
        "level2Total": _round(level2_total),
        "level2Adjusted": _round(level2_adj),
        "level2BCap": cap_b,
        "level2TotalCap": cap_2,
        "totalBeforeCaps": _round(level1 + level2a + level2b),
        "total": _round(level1 + level2_adj),
    }


def compute(payload):
    task = payload.get("task") or {}
    datasets = task.get("datasets") or []
    products = {str(item.get("code")): item for item in payload.get("products") or []}
    haircut, inflow_rates, outflow_rates = _rate_tables(payload.get("tables"))
    params = _param_map(payload.get("params"))

    level = {"L1": 0.0, "L2A": 0.0, "L2B": 0.0}
    inflow_total = 0.0
    outflow_total = 0.0
    product_stats = {}
    dataset_stats = []
    exceptions = []
    trace = []
    records = 0

    def product_bucket(code, name, side):
        if code not in product_stats:
            product_stats[code] = {
                "productCode": code, "productName": name, "side": side,
                "records": 0, "success": 0, "exceptions": 0,
                "amount": 0.0, "contribution": 0.0, "rateKey": "", "rate": None, "level": "",
            }
        return product_stats[code]

    for dataset in datasets:
        rows = dataset.get("rows") or []
        mapping = dataset.get("mapping") or {}
        code = str(dataset.get("productCode") or "")
        product = products.get(code)
        bucket = product_bucket(code, dataset.get("productName") or (product or {}).get("name") or "", (product or {}).get("side") or "")
        bucket["rateKey"] = (product or {}).get("paramKey") or ""
        ds_success = 0
        ds_exceptions = 0
        ds_amount = 0.0
        ds_contribution = 0.0
        if not product:
            exceptions.append({
                "dataset": dataset.get("sheet") or "", "rowNo": 0, "businessId": "",
                "reason": "数据集尚未确认产品，未参与计算", "productCode": code,
            })
            dataset_stats.append({
                "id": dataset.get("id"), "sheet": dataset.get("sheet"),
                "productCode": code, "records": len(rows), "success": 0,
                "exceptions": len(rows), "amount": 0, "contribution": 0,
            })
            bucket["records"] += len(rows)
            bucket["exceptions"] += len(rows)
            continue

        side = product.get("side") or ""
        param_key = str(product.get("paramKey") or "")
        rate_row = None
        if side == "ASSET":
            rate_row = haircut.get(param_key)
            bucket["level"] = (rate_row or {}).get("level", "")
        elif side == "INFLOW":
            rate_row = inflow_rates.get(param_key)
        elif side == "OUTFLOW":
            rate_row = outflow_rates.get(param_key)
        rate = (rate_row or {}).get("factor")

        for index, row in enumerate(rows):
            records += 1
            bucket["records"] += 1
            row_no = index + 1
            business_id = _business_id(row, mapping)
            amount, amount_field = _value(row, mapping, AMOUNT_FIELDS)
            amount = _num(amount)
            if amount is None:
                ds_exceptions += 1
                bucket["exceptions"] += 1
                exceptions.append({
                    "dataset": dataset.get("sheet") or "", "rowNo": row_no, "businessId": business_id,
                    "reason": "金额缺失或无法解析，未参与计算", "productCode": code,
                })
                continue
            if rate is None:
                ds_exceptions += 1
                bucket["exceptions"] += 1
                exceptions.append({
                    "dataset": dataset.get("sheet") or "", "rowNo": row_no, "businessId": business_id,
                    "reason": f"产品 {code} 未配置可用的{'折扣率' if side == 'ASSET' else '流入/流出率'}（{param_key or '空参数键'}）",
                    "productCode": code,
                })
                continue
            amount = max(0.0, amount)
            contribution = amount * rate
            if side == "ASSET":
                text_level = (rate_row or {}).get("level") or ""
                if text_level == "Level 1":
                    level["L1"] += contribution
                elif text_level == "Level 2A":
                    level["L2A"] += contribution
                elif text_level == "Level 2B":
                    level["L2B"] += contribution
            elif side == "INFLOW":
                inflow_total += contribution
            elif side == "OUTFLOW":
                outflow_total += contribution
            ds_success += 1
            bucket["success"] += 1
            ds_amount += amount
            ds_contribution += contribution
            bucket["amount"] += amount
            bucket["contribution"] += contribution
            bucket["rate"] = rate
            if len(trace) < 500:
                trace.append({
                    "dataset": dataset.get("sheet") or "", "rowNo": row_no,
                    "businessId": business_id, "productCode": code,
                    "productName": product.get("name") or "", "side": side,
                    "amountField": amount_field, "amount": _round(amount),
                    "rateKey": param_key, "rate": rate, "level": (rate_row or {}).get("level", ""),
                    "category": (rate_row or {}).get("category", ""),
                    "contribution": _round(contribution),
                    "basis": (rate_row or {}).get("basis", ""),
                })
        dataset_stats.append({
            "id": dataset.get("id"), "sheet": dataset.get("sheet"), "productCode": code,
            "records": len(rows), "success": ds_success, "exceptions": ds_exceptions,
            "amount": _round(ds_amount), "contribution": _round(ds_contribution),
        })

    caps = _apply_caps(level["L1"], level["L2A"], level["L2B"], params)
    inflow_cap = params.get("P_INFLOW_CAP")
    if inflow_cap is None:
        inflow_cap = 0.75
    recognized_inflow = min(inflow_total, outflow_total * inflow_cap) if outflow_total > 0 else inflow_total
    net_outflow = outflow_total - recognized_inflow
    lcr = None
    if net_outflow > 0:
        lcr = round(caps["total"] / net_outflow * 100, 2)

    products_out = []
    for item in product_stats.values():
        item["amount"] = _round(item["amount"])
        item["contribution"] = _round(item["contribution"])
        products_out.append(item)
    products_out.sort(key=lambda item: (item["side"], item["productCode"]))

    return {
        "runAt": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "lcr": lcr,
        "metrics": {
            "hqla": caps["total"],
            "hqlaBeforeCaps": caps["totalBeforeCaps"],
            "level1": caps["level1"],
            "level2a": caps["level2a"],
            "level2b": caps["level2b"],
            "level2bAdjusted": caps["level2bAdjusted"],
            "level2Adjusted": caps["level2Adjusted"],
            "inflow": _round(inflow_total),
            "inflowCap": inflow_cap,
            "recognizedInflow": _round(recognized_inflow),
            "outflow": _round(outflow_total),
            "netOutflow": _round(net_outflow),
            "lcrMin": params.get("P_LCR_MIN_RATIO", 1.0),
            "caps": caps,
        },
        "stats": {
            "records": records,
            "success": sum(item["success"] for item in product_stats.values()),
            "exceptions": len(exceptions),
            "datasets": len(datasets),
            "products": len(products_out),
        },
        "products": products_out,
        "datasets": dataset_stats,
        "exceptions": exceptions[:2000],
        "rows": trace,
    }
