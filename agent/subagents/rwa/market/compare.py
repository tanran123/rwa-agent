"""Aggregate calculated rows into the banking-return grid and compare with a regulatory upload."""

from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

MEASURES = (
    "on_principal",
    "on_crm",
    "off_notional",
    "off_ce",
    "off_dre",
    "rwa",
)

MEASURE_LABELS = (
    "本金",
    "CRM 后本金",
    "本金 / 名义",
    "信用等值",
    "违约风险暴露",
    "风险加权资产",
)

BANK_COLUMNS = [
    {"id": "on_principal", "label": "本金", "group": "表内敞口"},
    {"id": "on_crm", "label": "CRM 后本金", "group": "表内敞口"},
    {"id": "off_notional", "label": "本金 / 名义", "group": "表外敞口"},
    {"id": "off_ce", "label": "信用等值", "group": "表外敞口"},
    {"id": "off_dre", "label": "违约风险暴露", "group": "表外敞口"},
    {"id": "rwa", "label": "风险加权资产", "group": "风险加权资产"},
]

APPROACH_LABELS = {
    "external": "外部信用评级法",
    "standardized": "标准信用风险法",
}

_TEMPLATE = {
    "external": (0.2, 0.3, 0.5, 1.0, 1.5),
    "standardized": (0.2, 0.3, 0.4, 0.5, 0.75, 1.5),
}

_APPROACH_ORDER = {"external": 0, "standardized": 1}

_YELLOW = PatternFill("solid", fgColor="FFF2CC")
_GREEN = PatternFill("solid", fgColor="E2EFDA")
_PEACH = PatternFill("solid", fgColor="FCE4D6")
_SECTION = PatternFill("solid", fgColor="F5F5F5")
_THIN = Border(
    left=Side(style="thin", color="D0D5DD"),
    right=Side(style="thin", color="D0D5DD"),
    top=Side(style="thin", color="D0D5DD"),
    bottom=Side(style="thin", color="D0D5DD"),
)
_CENTER = Alignment(horizontal="center", vertical="center", wrap_text=True)
_LEFT = Alignment(horizontal="left", vertical="center", wrap_text=True)


def _key(approach: str, weight: float) -> tuple[str, float]:
    return approach, round(float(weight), 4)


def _weight_label(weight: float) -> str:
    return f"{float(weight):.4f}".rstrip("0").rstrip(".")


def _empty(approach: str, weight: float) -> dict:
    row = {"approach": approach, "weight": float(weight)}
    for measure in MEASURES:
        row[measure] = 0.0
    return row


def _ordered(bucket: dict) -> list[dict]:
    rows = []
    for approach, template in _TEMPLATE.items():
        weights = {round(float(item), 4) for item in template}
        weights.update(weight for ap, weight in bucket if ap == approach)
        for weight in sorted(weights):
            rows.append(bucket.get((approach, weight)) or _empty(approach, weight))
    return rows


def _has_amount(row: dict) -> bool:
    return any(abs(float(row.get(measure) or 0)) > 1e-9 for measure in MEASURES)


def _add_measures(slot: dict, row: dict) -> None:
    for measure in MEASURES:
        if measure == "rwa":
            slot[measure] += float(row.get("rwa") or 0)
        else:
            slot[measure] += float(row.get(measure) or 0)


def _blank_measures() -> dict:
    return {measure: 0.0 for measure in MEASURES}


def aggregate_exposure(rows: list[dict]) -> dict:
    """Sum successful credit-risk rows by approach and weight. Market-risk rows stay outside the grid."""
    bucket: dict[tuple[str, float], dict] = {}
    products: dict[str, dict] = {}
    ratings: dict[str, dict] = {}
    outside = 0.0
    currency = None
    for row in rows:
        if row.get("currency"):
            currency = row["currency"]
        product = str(row.get("product") or "")
        if product:
            slot = products.setdefault(product, _blank_measures())
            _add_measures(slot, row)
        weight = row.get("weight")
        approach = row.get("approach")
        rating = str(row.get("rating") or "").strip()
        if rating and weight is not None:
            known = ratings.get(rating)
            if known is None:
                ratings[rating] = {
                    "rating": rating,
                    "weight": float(weight),
                    "rwa": float(row.get("rwa") or 0),
                    "count": 1,
                    "mixed": False,
                }
            else:
                if abs(float(known["weight"]) - float(weight)) > 1e-6:
                    known["mixed"] = True
                known["rwa"] += float(row.get("rwa") or 0)
                known["count"] += 1
        if approach not in _TEMPLATE or weight is None:
            outside += float(row.get("rwa") or 0)
            continue
        key = _key(approach, weight)
        cell = bucket.get(key)
        if cell is None:
            cell = _empty(approach, weight)
            bucket[key] = cell
        _add_measures(cell, row)
    return {
        "currency": currency,
        "rows": _ordered(bucket),
        "outside_rwa": outside,
        "products": products,
        "ratings": list(ratings.values()),
    }


def _merge_rating(grouped: dict[str, dict], item: dict) -> None:
    rating = str(item.get("rating") or "").strip()
    if not rating:
        return
    known = grouped.get(rating)
    if known is None:
        grouped[rating] = {
            "rating": rating,
            "weight": float(item.get("weight") or 0),
            "rwa": float(item.get("rwa") or 0),
            "count": int(item.get("count") or 0),
            "mixed": bool(item.get("mixed")),
        }
        return
    if abs(float(known["weight"]) - float(item.get("weight") or 0)) > 1e-6 or item.get("mixed"):
        known["mixed"] = True
    known["rwa"] += float(item.get("rwa") or 0)
    known["count"] += int(item.get("count") or 0)


def exposure_from_packs(packs: list[dict]) -> dict:
    grouped: dict[str, dict] = {}
    all_ratings: dict[str, dict] = {}
    for pack in packs:
        part = pack.pop("exposure", None) or {}
        rows = part.get("rows") or []
        outside = float(part.get("outside_rwa") or 0)
        ratings = part.get("ratings") or []
        products = part.get("products") or {}
        if not part.get("currency") and not outside and not ratings and not any(_has_amount(row) for row in rows):
            continue
        code = part.get("currency") or "—"
        slot = grouped.setdefault(
            code,
            {"currency": code, "rows": {}, "outside_rwa": 0.0, "products": {}, "ratings": {}},
        )
        slot["outside_rwa"] += outside
        for row in rows:
            key = _key(row["approach"], row["weight"])
            dest = slot["rows"].get(key)
            if dest is None:
                dest = _empty(row["approach"], row["weight"])
                slot["rows"][key] = dest
            for measure in MEASURES:
                dest[measure] += float(row.get(measure) or 0)
        for product, measures in products.items():
            dest = slot["products"].setdefault(str(product), _blank_measures())
            for measure in MEASURES:
                dest[measure] += float(measures.get(measure) or 0)
        for item in ratings:
            _merge_rating(slot["ratings"], item)
            _merge_rating(all_ratings, item)
    currencies = []
    for code in grouped:
        slot = grouped[code]
        currencies.append(
            {
                "currency": code,
                "rows": _ordered(slot["rows"]),
                "outside_rwa": slot["outside_rwa"],
                "products": slot["products"],
                "ratings": list(slot["ratings"].values()),
            }
        )
    return {"currencies": currencies, "ratings": list(all_ratings.values())}


def _number(value: object) -> float | None:
    if value is None or value == "":
        return 0.0
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        text = value.replace(",", "").strip()
        if text in ("", "-", "—", "–"):
            return 0.0
        try:
            return float(text)
        except ValueError:
            return None
    return None


def _weight(value: object) -> float | None:
    if value is None or value == "":
        return None
    number = _number(value)
    if number is None:
        return None
    if number < 0 or number > 12.5:
        return None
    return number


def _section_of(text: str) -> str | None:
    folded = text.lower()
    if "external credit risk" in folded or "外部信用" in text:
        return "external"
    if "standardized credit risk" in folded or "标准信用" in text or "标准法" in text:
        return "standardized"
    return None


def _read_grid(ws, limit: int = 80) -> list[tuple]:
    rows = []
    for row in ws.iter_rows(max_row=limit, max_col=24, values_only=True):
        rows.append(tuple(row))
    return rows


def _column_of(grid: list[tuple], text: str) -> int | None:
    for row in grid:
        for index, cell in enumerate(row):
            if isinstance(cell, str) and text in cell:
                return index
    return None


def _six_amounts(row: tuple, start: int | None) -> list[float] | None:
    if start is None:
        return None
    amounts = []
    for index in range(start, start + 6):
        raw = row[index] if len(row) > index else None
        if isinstance(raw, str) and raw.startswith("="):
            return None
        number = _number(raw)
        amounts.append(0.0 if number is None else number)
    return amounts


def _parse_return_block(grid: list[tuple]) -> tuple[list[dict], bool]:
    section = None
    got_standardized = False
    parsed = []
    return_at = _column_of(grid, "Per Banking Return")
    underlying_at = _column_of(grid, "Per CYB Underlying Data")
    weight_at = return_at - 1 if return_at else 1
    amount_at = return_at if return_at is not None else 2
    saw_template = return_at is not None
    for row in grid:
        label = row[0] if row else None
        if isinstance(label, str):
            if label.startswith("Sum of") or label.startswith("Conclusion"):
                break
            found = _section_of(label)
            if found:
                section = found
                continue
        if section is None:
            continue
        weight = _weight(row[weight_at] if len(row) > weight_at else None)
        if weight is None:
            if got_standardized:
                break
            continue
        amounts = _six_amounts(row, amount_at)
        if amounts is None:
            continue
        if section == "standardized":
            got_standardized = True
        item = _empty(section, weight)
        for measure, amount in zip(MEASURES, amounts):
            item[measure] = amount
        sheet = _six_amounts(row, underlying_at)
        if sheet is not None:
            item["sheet_underlying"] = {measure: amount for measure, amount in zip(MEASURES, sheet)}
        parsed.append(item)
    return parsed, saw_template


def _parse_header_table(grid: list[tuple]) -> list[dict]:
    header_at = None
    for index, row in enumerate(grid[:20]):
        texts = [cell for cell in row if isinstance(cell, str)]
        if any("风险权重" in text or text.strip().lower() in {"rw", "risk weight"} for text in texts):
            header_at = index
            break
    if header_at is None:
        return []
    header = [str(cell).strip() if isinstance(cell, str) else "" for cell in grid[header_at]]

    def find(*needles: str) -> int | None:
        for index, title in enumerate(header):
            folded = title.lower()
            if any(needle.lower() in folded or needle in title for needle in needles):
                return index
        return None

    weight_col = find("风险权重", "risk weight", "rw")
    approach_col = find("口径", "方法", "approach")
    columns = {
        "on_principal": find("表内本金", "principal amount"),
        "on_crm": find("crm 后", "crm后", "after crm"),
        "off_notional": find("名义", "notional"),
        "off_ce": find("信用等值", "credit equivalent"),
        "off_dre": find("违约", "default risk"),
        "rwa": find("风险加权", "rwa", "risk weighted"),
    }
    if weight_col is None or columns["rwa"] is None:
        return []
    parsed = []
    section = "external"
    for row in grid[header_at + 1 :]:
        label = row[0] if row else None
        if isinstance(label, str):
            found = _section_of(label)
            if found:
                section = found
                continue
            if "合计" in label or label.strip().lower().startswith("total"):
                break
        approach = section
        if approach_col is not None and approach_col < len(row):
            raw = row[approach_col]
            if isinstance(raw, str):
                found = _section_of(raw)
                if found:
                    approach = found
        weight = _weight(row[weight_col] if weight_col < len(row) else None)
        if weight is None:
            continue
        item = _empty(approach, weight)
        for measure, column in columns.items():
            if column is None or column >= len(row):
                continue
            number = _number(row[column])
            if number is not None:
                item[measure] = number
        parsed.append(item)
    return parsed


def parse_regulatory(path: str | Path) -> dict:
    book = load_workbook(path, read_only=True, data_only=True)
    try:
        best: list[dict] | None = None
        scale = 1
        for name in book.sheetnames:
            grid = _read_grid(book[name])
            rows, template = _parse_return_block(grid)
            if not rows:
                rows = _parse_header_table(grid)
                template = False
            if rows and (best is None or len(rows) > len(best)):
                best = rows
                scale = 1000 if template else 1
        if not best:
            raise ValueError(
                "没有读到监管结果。需要「Per Banking Return」下面的权重行，或一张带风险权重和风险加权资产列的表。"
            )
        return {
            "rows": best,
            "scale": scale,
            "unit": "千元" if scale == 1000 else "与上传表相同",
        }
    finally:
        book.close()


def _present(value: float, scale: int, measure: str) -> float:
    number = float(value or 0) / scale
    digits = 2 if scale == 1 else (1 if measure == "rwa" else 0)
    quant = Decimal("1") if digits == 0 else Decimal("1").scaleb(-digits)
    return float(Decimal(number).quantize(quant, rounding=ROUND_HALF_UP))


def _sort_keys(keys: set[tuple[str, float]]) -> list[tuple[str, float]]:
    return sorted(keys, key=lambda item: (_APPROACH_ORDER.get(item[0], 9), item[1]))


def _measures(row: dict) -> dict:
    return {measure: float(row.get(measure) or 0) for measure in MEASURES}


def _variance(underlying: dict, regulatory: dict) -> dict:
    out = {}
    for measure in MEASURES:
        base = float(regulatory.get(measure) or 0)
        out[measure] = 0.0 if base == 0 else (float(underlying[measure]) - base) / base
    return out


def _totals(rows: list[dict], side: str) -> dict:
    total = {measure: 0.0 for measure in MEASURES}
    for row in rows:
        for measure in MEASURES:
            total[measure] += float(row[side][measure])
    return total


def _uses_sheet_underlying(rows: list[dict]) -> bool:
    for row in rows:
        raw = row.get("sheet_underlying") or {}
        if any(abs(float(raw.get(measure) or 0)) > 1e-9 for measure in MEASURES):
            return True
    return False


_SHEET_HINT = (
    "明细统计读的是这张表的「Per CYB Underlying Data」。"
    "表内本金和 CRM 后本金取 item 5、表内 ASS 的 EAD_PRE_CCF，按原风险权重加总后除以 1000。"
    "表外名义、违约风险暴露按表上公式从 principal、NOMINAL、EAD_PRE_CCF 取值。"
    "风险加权资产 =（CRM 后本金 + 信用等值 + 违约风险暴露）× 权重。"
)


def build_comparison(exposure: dict, regulatory: dict) -> dict:
    scale = int(regulatory.get("scale") or 1)
    reg_rows = regulatory.get("rows") or []
    use_sheet = _uses_sheet_underlying(reg_rows)
    reg_index = {}
    for row in reg_rows:
        reg_index[_key(row["approach"], row["weight"])] = row
    parts = exposure.get("currencies") or []
    if use_sheet or not parts:
        parts = [{"currency": "—", "rows": [], "outside_rwa": 0.0}]
    blocks = []
    for part in parts:
        und_index = {_key(row["approach"], row["weight"]): row for row in part.get("rows") or []}
        keys = set(reg_index)
        for key, row in und_index.items():
            if _has_amount(row):
                keys.add(key)
        compared = []
        for approach, weight in _sort_keys(keys):
            full = und_index.get((approach, weight)) or _empty(approach, weight)
            if use_sheet:
                raw = (reg_index.get((approach, weight)) or {}).get("sheet_underlying") or {}
                underlying = {measure: float(raw.get(measure) or 0) for measure in MEASURES}
            else:
                underlying = {measure: _present(full[measure], scale, measure) for measure in MEASURES}
            regulatory_row = _measures(reg_index.get((approach, weight)) or _empty(approach, weight))
            compared.append(
                {
                    "approach": approach,
                    "weight": weight,
                    "section": APPROACH_LABELS.get(approach, approach),
                    "label": _weight_label(weight),
                    "regulatory": regulatory_row,
                    "underlying": underlying,
                    "variance": _variance(underlying, regulatory_row),
                }
            )
        reg_total = _totals(compared, "regulatory")
        und_total = _totals(compared, "underlying")
        blocks.append(
            {
                "currency": part.get("currency") or "—",
                "rows": compared,
                "totals": {
                    "regulatory": reg_total,
                    "underlying": und_total,
                    "variance": _variance(und_total, reg_total),
                },
                "outside_rwa": _present(float(part.get("outside_rwa") or 0), scale, "rwa"),
            }
        )
    return {
        "scale": scale,
        "unit": regulatory.get("unit") or ("千元" if scale == 1000 else "与上传表相同"),
        "title": "银行暴露",
        "columns": BANK_COLUMNS,
        "show_totals": True,
        "sheet_underlying": use_sheet,
        "blocks": blocks,
    }


def write_comparison(path: str | Path, comparison: dict) -> None:
    book = Workbook()
    default = book.active
    blocks = comparison.get("blocks") or []
    if not blocks:
        blocks = [
            {
                "currency": "—",
                "rows": [],
                "totals": {
                    "regulatory": {m: 0 for m in MEASURES},
                    "underlying": {m: 0 for m in MEASURES},
                    "variance": {m: 0 for m in MEASURES},
                },
                "outside_rwa": 0,
            }
        ]
    for index, block in enumerate(blocks):
        title = "对比" if len(blocks) == 1 else f"对比_{block.get('currency') or index + 1}"
        sheet = default if index == 0 else book.create_sheet()
        sheet.title = title[:31]
        _write_block(sheet, block, comparison)
    book.save(path)


def _write_block(sheet, block: dict, comparison: dict) -> None:
    columns = comparison.get("columns") or BANK_COLUMNS
    width = 1 + len(columns) * 3
    unit = comparison.get("unit") or ""
    currency = block.get("currency") or ""
    title = comparison.get("title") or "对比"
    note = f"{title}。币种 {currency}。金额单位：{unit}。偏离 =（明细统计 − 监管结果）/ 监管结果，监管结果为 0 时记 0。"
    if comparison.get("hint"):
        note += " " + str(comparison["hint"])
    if comparison.get("scale") == 1000:
        note += " 监管表按千元，明细统计已按计算结果除以 1000 后四舍五入。"
    sheet["A1"] = f"{title} · 明细与监管结果对比"
    sheet["A1"].font = Font(bold=True, size=14)
    sheet.merge_cells(start_row=2, start_column=1, end_row=2, end_column=width)
    sheet["A2"] = note
    sheet["A2"].alignment = _LEFT
    fills = (("监管结果", _YELLOW), ("明细统计", _GREEN), ("偏离", _PEACH))
    sheet["A6"] = "项目"
    sheet["A6"].font = Font(bold=True)
    sheet["A6"].alignment = _CENTER
    sheet["A6"].border = _THIN
    for index, (name, fill) in enumerate(fills):
        start = 2 + index * len(columns)
        head = sheet.cell(4, start, name)
        head.fill = fill
        head.font = Font(bold=True)
        head.alignment = _CENTER
        if len(columns) > 1:
            sheet.merge_cells(start_row=4, start_column=start, end_row=4, end_column=start + len(columns) - 1)
        for column in range(start, start + len(columns)):
            sheet.cell(4, column).fill = fill
            sheet.cell(4, column).border = _THIN
        groups = _column_groups(columns)
        cursor = start
        for text, span in groups:
            cell = sheet.cell(5, cursor, text)
            cell.fill = fill
            cell.font = Font(bold=True)
            cell.alignment = _CENTER
            cell.border = _THIN
            if span > 1:
                sheet.merge_cells(start_row=5, start_column=cursor, end_row=5, end_column=cursor + span - 1)
            for column in range(cursor, cursor + span):
                sheet.cell(5, column).fill = fill
                sheet.cell(5, column).border = _THIN
            cursor += span
        for offset, column in enumerate(columns):
            cell = sheet.cell(6, start + offset, column["label"])
            cell.fill = fill
            cell.font = Font(bold=True, size=9)
            cell.alignment = _CENTER
            cell.border = _THIN
    sheet.row_dimensions[6].height = 32
    row_index = 7
    last_section = None
    for item in block.get("rows") or []:
        section = item.get("section") or ""
        if section and section != last_section:
            sheet.merge_cells(start_row=row_index, start_column=1, end_row=row_index, end_column=width)
            banner = sheet.cell(row_index, 1, section)
            banner.font = Font(bold=True)
            banner.fill = _SECTION
            for column in range(1, width + 1):
                sheet.cell(row_index, column).fill = _SECTION
                sheet.cell(row_index, column).border = _THIN
            row_index += 1
            last_section = section
        sheet.cell(row_index, 1, item.get("label") or "")
        _paint_side(sheet, row_index, 2, item.get("regulatory") or {}, columns, comparison, False)
        _paint_side(sheet, row_index, 2 + len(columns), item.get("underlying") or {}, columns, comparison, False)
        _paint_side(sheet, row_index, 2 + len(columns) * 2, item.get("variance") or {}, columns, comparison, True)
        for column in range(1, width + 1):
            sheet.cell(row_index, column).border = _THIN
        row_index += 1
    if comparison.get("show_totals", True):
        sheet.cell(row_index, 1, "合计").font = Font(bold=True)
        totals = block.get("totals") or {}
        _paint_side(sheet, row_index, 2, totals.get("regulatory") or {}, columns, comparison, False)
        _paint_side(sheet, row_index, 2 + len(columns), totals.get("underlying") or {}, columns, comparison, False)
        _paint_side(sheet, row_index, 2 + len(columns) * 2, totals.get("variance") or {}, columns, comparison, True)
        for column in range(1, width + 1):
            sheet.cell(row_index, column).font = Font(bold=True)
            sheet.cell(row_index, column).border = _THIN
        row_index += 1
    outside = block.get("outside_rwa")
    if isinstance(outside, (int, float)) and outside:
        sheet.cell(row_index + 1, 1, f"市场风险 RWA 不进入上面的表：{outside:,.1f} {unit}")
    sheet.column_dimensions["A"].width = 28
    for column in range(2, width + 1):
        sheet.column_dimensions[get_column_letter(column)].width = 16
    sheet.freeze_panes = "B7"
    sheet.page_setup.orientation = "landscape"
    sheet.page_setup.fitToPage = True
    sheet.page_setup.fitToWidth = 1
    sheet.page_setup.fitToHeight = 1
    sheet.sheet_view.showGridLines = False
    sheet.oddFooter.center.text = "明细统计来自按规则计算的 RWA，监管结果来自上传表"


def _column_groups(columns: list[dict]) -> list[tuple[str, int]]:
    groups: list[tuple[str, int]] = []
    for column in columns:
        name = str(column.get("group") or "")
        if groups and groups[-1][0] == name:
            groups[-1] = (name, groups[-1][1] + 1)
        else:
            groups.append((name, 1))
    return groups


def _paint_side(sheet, row: int, start: int, values: dict, columns: list[dict], comparison: dict, percent: bool) -> None:
    scale = int(comparison.get("scale") or 1)
    for offset, column in enumerate(columns):
        raw = values.get(column["id"]) if values else None
        cell = sheet.cell(row, start + offset)
        cell.alignment = Alignment(horizontal="right")
        if raw is None:
            cell.value = None
            continue
        cell.value = float(raw)
        if percent:
            cell.number_format = "0.00%"
        elif column.get("format") == "weight":
            cell.number_format = "0.00"
        elif scale == 1:
            cell.number_format = "#,##0.00"
        elif column["id"] == "rwa":
            cell.number_format = "#,##0.0"
        else:
            cell.number_format = "#,##0"



MODULES = [
    {
        "id": "bank",
        "title": "银行暴露",
        "blurb": "按外部信用评级法和标准法的风险权重，对照表内、表外和风险加权资产。",
        "return_hint": "上传银行暴露的监管回报。表里「Per Banking Return」按风险权重读入，金额是千元。",
    },
    {
        "id": "corporate",
        "title": "企业暴露",
        "blurb": "按外部评级核对风险权重，看计算用的权重和监管结果是否一致。",
        "return_hint": "上传企业暴露分析表。按评级读监管权重，再和明细算出的权重比较。",
    },
    {
        "id": "offbalance",
        "title": "表外项目",
        "blurb": "按表外项目性质，对照本金、信用等值和各类暴露。",
        "return_hint": "上传表外项目的监管回报。「Nature of items」这一段按项目性质读入，金额是千元。",
    },
    {
        "id": "retail",
        "title": "零售暴露",
        "blurb": "按披露项目 9a 至 9d，对照表内、表外和风险加权资产。",
        "return_hint": "上传零售暴露的监管回报。按 9a(i) 到 9d 读入，金额是千元。",
    },
    {
        "id": "derivatives",
        "title": "衍生工具",
        "blurb": "按利率合约和汇率合约，对照名义本金、重置成本、潜在暴露和违约风险。",
        "return_hint": "上传衍生工具的监管回报。分成已认可净额结算，和未纳入净额的未保证金合约。",
    },
]

_MODULE_BY_ID = {item["id"]: item for item in MODULES}

OFF_COLUMNS = [
    {"id": "principal", "label": "本金合计", "group": "金额"},
    {"id": "credit", "label": "信用等值", "group": "金额"},
    {"id": "pse", "label": "公共部门", "group": "暴露分类"},
    {"id": "qnbfi", "label": "准银行", "group": "暴露分类"},
    {"id": "corporate", "label": "企业", "group": "暴露分类"},
    {"id": "retail", "label": "零售", "group": "暴露分类"},
    {"id": "property", "label": "房地产", "group": "暴露分类"},
]

DERIV_COLUMNS = [
    {"id": "notional", "label": "名义本金", "group": "合约"},
    {"id": "replacement", "label": "重置成本", "group": "合约"},
    {"id": "potential", "label": "潜在暴露", "group": "合约"},
    {"id": "default", "label": "违约风险", "group": "合约"},
]

CORP_COLUMNS = [
    {"id": "weight", "label": "风险权重", "group": "权重", "format": "weight"},
]


def module_catalog() -> list[dict]:
    return [
        {"id": item["id"], "title": item["title"], "blurb": item["blurb"], "return_hint": item["return_hint"]}
        for item in MODULES
    ]


def _grids(path: str | Path, limit: int = 80) -> list[list[tuple]]:
    book = load_workbook(path, read_only=True, data_only=False)
    try:
        return [_read_grid(book[name], limit) for name in book.sheetnames]
    finally:
        book.close()


def _text(value: object) -> str:
    return value.strip() if isinstance(value, str) else ""


def _amounts(row: tuple, start: int, count: int) -> list[float | None]:
    found = []
    for index in range(start, start + count):
        raw = row[index] if len(row) > index else None
        if isinstance(raw, str) and raw.startswith("="):
            return []
        number = _number(raw)
        found.append(0.0 if number is None else number)
    return found


def _parse_retail(grid: list[tuple]) -> list[dict]:
    rows = []
    started = False
    for row in grid:
        head = _text(row[0] if row else None)
        label = _text(row[1] if len(row) > 1 else None)
        if head.lower() == "disclosure" or label.lower() == "disclosure":
            started = True
            continue
        if not started or not label or not label[:1].isdigit():
            if rows and not label and not head:
                break
            continue
        weight = _weight(row[0] if row else None)
        amounts = _amounts(row, 2, 6)
        if weight is None or not amounts:
            continue
        values = {column["id"]: amount for column, amount in zip(BANK_COLUMNS, amounts)}
        rows.append({"section": "零售披露", "label": label, "weight": weight, "values": values})
    return rows


def _parse_offbalance(grid: list[tuple]) -> list[dict]:
    rows = []
    started = False
    for row in grid:
        label = _text(row[0] if row else None)
        if label == "Nature of items":
            started = True
            continue
        if not started:
            continue
        if label.lower() == "total":
            break
        if not label or label.lower() == "nature of items":
            continue
        factor = _weight(row[1] if len(row) > 1 else None)
        amounts = _amounts(row, 2, 7)
        if factor is None or not amounts:
            continue
        values = {column["id"]: amount for column, amount in zip(OFF_COLUMNS, amounts)}
        rows.append({"section": "表外项目", "label": label, "values": values})
    return rows


def _contract_key(label: str) -> str:
    folded = label.lower()
    if "interest rate" in folded:
        return "利率合约"
    if "exchange rate" in folded:
        return "汇率合约"
    return ""


def _parse_derivatives(grid: list[tuple]) -> list[dict]:
    netting: dict[str, dict] = {}
    plain: dict[str, dict] = {}
    pending = ""
    seen = False
    for row in grid:
        label = _text(row[0] if row else None)
        if label == "Per Banking Return":
            seen = True
            continue
        if not seen:
            continue
        if label.startswith("Per CYB") or label == "Variance":
            break
        key = _contract_key(label)
        if key:
            net = _amounts(row, 1, 4)
            bare = _amounts(row, 11, 4)
            if net:
                netting[key] = {column["id"]: amount for column, amount in zip(DERIV_COLUMNS, net)}
                pending = key if net[1] == 0 and net[2] == 0 and net[3] == 0 else ""
            if bare:
                plain[key] = {column["id"]: amount for column, amount in zip(DERIV_COLUMNS, bare)}
            continue
        if pending and not label:
            extra = _amounts(row, 1, 4)
            if extra and any(extra[1:]):
                current = netting.get(pending) or {column["id"]: 0.0 for column in DERIV_COLUMNS}
                current["replacement"] = extra[1]
                current["potential"] = extra[2]
                current["default"] = extra[3]
                netting[pending] = current
            pending = ""
    rows = []
    for section, bucket in (("已认可净额结算", netting), ("未纳入净额的未保证金合约", plain)):
        for key in ("利率合约", "汇率合约"):
            if key not in bucket:
                continue
            rows.append({"section": section, "label": key, "values": bucket[key]})
    return rows


def _parse_corporate(grid: list[tuple]) -> list[dict]:
    rows = []
    started = False
    for row in grid:
        label = _text(row[0] if row else None)
        if label == "Row Labels":
            started = True
            continue
        if not started:
            continue
        if not label or label.lower().startswith("grand total"):
            break
        weight = _weight(row[1] if len(row) > 1 else None)
        if weight is None or len(label) > 12:
            continue
        rows.append({"section": "外部评级", "label": label, "values": {"weight": weight}})
    return rows


def _module_table(path: str | Path, module: str) -> dict:
    spec = _MODULE_BY_ID[module]
    parsers = {
        "retail": (_parse_retail, BANK_COLUMNS, 1000, "千元", True),
        "offbalance": (_parse_offbalance, OFF_COLUMNS, 1000, "千元", True),
        "derivatives": (_parse_derivatives, DERIV_COLUMNS, 1, "与上传表相同", True),
        "corporate": (_parse_corporate, CORP_COLUMNS, 1, "权重", False),
    }
    parser, columns, scale, unit, totals = parsers[module]
    found: list[dict] = []
    for grid in _grids(path):
        rows = parser(grid)
        if len(rows) > len(found):
            found = rows
    if not found:
        raise ValueError(f"没有读到{spec['title']}的监管结果。请上传这个模块的分析表。")
    return {
        "title": spec["title"],
        "columns": columns,
        "rows": found,
        "scale": scale,
        "unit": unit,
        "show_totals": totals,
        "hint": spec["return_hint"],
    }


def _none_values(columns: list[dict]) -> dict:
    return {column["id"]: None for column in columns}


def _value_or_none(raw: dict, column_id: str, present: bool) -> float | None:
    if not present:
        return None
    return float(raw.get(column_id) or 0)


def _retail_underlying(exposure: dict, rows: list[dict], columns: list[dict]) -> list[dict]:
    owners: dict[float, list[str]] = {}
    for row in rows:
        owners.setdefault(round(float(row.get("weight") or 0), 4), []).append(row["label"])
    sums: dict[float, dict] = {}
    for part in exposure.get("currencies") or []:
        for item in part.get("rows") or []:
            if not _has_amount(item):
                continue
            key = round(float(item["weight"]), 4)
            slot = sums.setdefault(key, _blank_measures())
            for measure in MEASURES:
                slot[measure] += float(item.get(measure) or 0)
    built = []
    for row in rows:
        key = round(float(row.get("weight") or 0), 4)
        usable = len(owners.get(key) or []) == 1 and key in sums
        values = {column["id"]: _value_or_none(sums.get(key) or {}, column["id"], usable) for column in columns}
        built.append({"section": row["section"], "label": row["label"], "values": values})
    return built


def _fx_exposure(exposure: dict) -> dict | None:
    total = _blank_measures()
    found = False
    for part in exposure.get("currencies") or []:
        product = (part.get("products") or {}).get("ccr_fx")
        if not product:
            continue
        found = True
        for measure in MEASURES:
            total[measure] += float(product.get(measure) or 0)
    return total if found else None


def _derivative_underlying(exposure: dict, rows: list[dict], columns: list[dict]) -> list[dict]:
    fx = _fx_exposure(exposure)
    built = []
    for row in rows:
        values = _none_values(columns)
        if fx and row["section"] == "未纳入净额的未保证金合约" and row["label"] == "汇率合约":
            values["notional"] = fx["off_notional"]
            values["default"] = fx["off_dre"]
        elif row["label"] == "利率合约":
            values = {column["id"]: 0.0 for column in columns}
        built.append({"section": row["section"], "label": row["label"], "values": values})
    return built


def _corporate_underlying(exposure: dict, rows: list[dict]) -> list[dict]:
    known = {}
    for item in exposure.get("ratings") or []:
        known[str(item.get("rating") or "").strip().upper()] = item
    built = []
    for row in rows:
        item = known.get(row["label"].upper())
        weight = None
        if item and not item.get("mixed"):
            weight = float(item["weight"])
        built.append({"section": row["section"], "label": row["label"], "values": {"weight": weight}})
    return built


def _cell_variance(underlying: float | None, regulatory: float | None) -> float | None:
    if underlying is None or regulatory is None:
        return None
    if regulatory == 0:
        return 0.0
    return (float(underlying) - float(regulatory)) / float(regulatory)


def _sum_column(rows: list[dict], side: str, column_id: str) -> float | None:
    values = []
    for row in rows:
        raw = (row.get(side) or {}).get(column_id)
        if raw is None:
            return None
        values.append(float(raw))
    return sum(values)


def _assemble(table: dict, underlying_rows: list[dict]) -> dict:
    columns = table["columns"]
    scale = int(table["scale"])
    index = {(row["section"], row["label"]): row.get("values") or {} for row in underlying_rows}
    compared = []
    for row in table["rows"]:
        regulatory = {}
        underlying = {}
        variance = {}
        source = index.get((row["section"], row["label"]), {})
        for column in columns:
            cid = column["id"]
            regulatory[cid] = float((row.get("values") or {}).get(cid) or 0)
            raw = source.get(cid)
            underlying[cid] = None if raw is None else _present(float(raw), scale, cid)
            variance[cid] = _cell_variance(underlying[cid], regulatory[cid])
        compared.append(
            {
                "section": row["section"],
                "label": row["label"],
                "regulatory": regulatory,
                "underlying": underlying,
                "variance": variance,
            }
        )
    totals = {"regulatory": {}, "underlying": {}, "variance": {}}
    if table.get("show_totals", True):
        for column in columns:
            cid = column["id"]
            totals["regulatory"][cid] = _sum_column(compared, "regulatory", cid)
            totals["underlying"][cid] = _sum_column(compared, "underlying", cid)
            totals["variance"][cid] = _cell_variance(totals["underlying"][cid], totals["regulatory"][cid])
    return {
        "title": table["title"],
        "columns": columns,
        "scale": scale,
        "unit": table["unit"],
        "show_totals": bool(table.get("show_totals", True)),
        "hint": table.get("hint") or "",
        "blocks": [
            {
                "currency": "—",
                "rows": compared,
                "totals": totals,
                "outside_rwa": 0,
            }
        ],
    }


def compare_module(module: str, exposure: dict, path: str | Path) -> dict:
    if module not in _MODULE_BY_ID:
        raise ValueError("请先选择模块")
    if module == "bank":
        regulatory = parse_regulatory(path)
        result = build_comparison(exposure, regulatory)
        result["hint"] = _SHEET_HINT if result.get("sheet_underlying") else _MODULE_BY_ID["bank"]["return_hint"]
        return result
    table = _module_table(path, module)
    if module == "retail":
        underlying = _retail_underlying(exposure, table["rows"], table["columns"])
    elif module == "derivatives":
        underlying = _derivative_underlying(exposure, table["rows"], table["columns"])
    elif module == "corporate":
        underlying = _corporate_underlying(exposure, table["rows"])
    else:
        underlying = [
            {"section": row["section"], "label": row["label"], "values": _none_values(table["columns"])}
            for row in table["rows"]
        ]
    return _assemble(table, underlying)
