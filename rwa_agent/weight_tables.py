"""Risk weights observed in uploaded workbooks. New files are merged in."""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

import openpyxl

# id, Chinese label, most common weight, other weights that also appear, row count
_ASSETS: tuple[tuple[str, str, float, tuple[float, ...], int], ...] = (
    ("CLAIM_RETAIL_OTHER", "其他零售", 0.75, (), 21057),
    ("CLAIM_CORP", "企业", 1.0, (1.5,), 4377),
    ("CLAIM_BANK", "银行", 0.3, (0.2, 0.5, 1.5), 3073),
    ("CLAIM_RETAIL_RESIDENTIAL_MORTGAGE", "零售住房按揭", 0.2, (0.3, 0.25), 2548),
    ("CLAIM_RETAIL_OTHER_100", "其他零售（100%）", 1.0, (), 859),
    ("CLAIM_SME", "中小企业", 0.85, (1.5,), 545),
    ("CLAIM_PSE", "公共部门", 0.2, (0.5,), 261),
    ("CLAIM_SOV", "主权", 0.0, (0.2,), 187),
    ("CLAIM_RETAIL_OTHER_T", "其他零售（过渡）", 0.45, (), 68),
    ("CLAIM_OTH_100", "其他（100%）", 1.0, (1.5,), 54),
    ("CLAIM_RETAIL_RESIDENTIAL_MORTGAGE_OTH", "零售住房按揭（其他）", 0.75, (), 52),
    ("CLAIM_COMMERCIAL_MORTGAGE_IPRE", "商业按揭（收益型地产）", 1.5, (0.7,), 40),
    ("CLAIM_ADC", "土地收购及发展", 1.5, (), 39),
    ("CLAIM_OTH_0", "其他（0%）", 0.0, (), 35),
    ("CLAIM_RESIDENTIAL_MORTGAGE_OTH", "住房按揭（其他）", 1.0, (), 29),
    ("CLAIM_SME_RESIDENTIAL_MORTGAGE_ADC", "中小企业住房按揭（发展）", 1.0, (), 29),
    ("CLAIM_RESIDENTIAL_MORTGAGE", "住房按揭", 0.2, (), 25),
    ("CLAIM_MDB_PREF_0", "多边开发银行（0%）", 0.0, (), 25),
    ("CLAIM_SME_RESIDENTIAL_MORTGAGE", "中小企业住房按揭", 0.2, (0.85,), 23),
    ("CLAIM_RESIDENTIAL_MORTGAGE_IPRE", "住房按揭（收益型地产）", 0.45, (0.3,), 16),
    ("CLAIM_SEC_CRE", "证券化", 0.6, (), 16),
    ("CLAIM_OTHER_EQT", "其他股权", 2.5, (), 14),
    ("CLAIM_SME_SEC_CRE", "中小企业证券化", 0.85, (0.6,), 11),
    ("CLAIM_RETAIL_COMMERCIAL_MORTGAGE_OTH", "零售商业按揭（其他）", 0.75, (), 8),
    ("CLAIM_COMMERCIAL_MORTGAGE_OTH", "商业按揭（其他）", 1.0, (), 8),
    ("CLAIM_SME_ADC", "中小企业土地发展", 1.5, (), 7),
    ("CLAIM_SME_RESIDENTIAL_MORTGAGE_OTH", "中小企业住房按揭（其他）", 0.85, (), 6),
    ("CLAIM_CORP_PF_PO", "企业项目融资（经营前）", 1.3, (), 6),
    ("CLAIM_RESIDENTIAL_MORTGAGE_IPRE_OTH", "住房按揭（收益型地产，其他）", 1.5, (), 5),
    ("CLAIM_REGULATORY_CAPITAL_INSTR", "监管资本工具", 1.5, (), 5),
    ("CLAIM_MDB", "多边开发银行", 0.2, (), 5),
    ("CLAIM_CORP_PF", "企业项目融资", 1.0, (), 5),
)

# asset id, rating, most common weight, other weights, row count
_RATINGS: tuple[tuple[str, str, float, tuple[float, ...], int], ...] = (
    ("CLAIM_BANK", "A", 0.3, (), 177),
    ("CLAIM_BANK", "A+", 0.3, (0.2,), 303),
    ("CLAIM_BANK", "A-", 0.5, (0.3, 0.2), 241),
    ("CLAIM_BANK", "A1", 0.3, (0.2,), 669),
    ("CLAIM_BANK", "A2", 0.5, (0.2, 0.3), 79),
    ("CLAIM_BANK", "A3", 0.3, (0.5,), 28),
    ("CLAIM_BANK", "AA", 0.2, (0.3,), 38),
    ("CLAIM_BANK", "AA-", 0.2, (0.3,), 116),
    ("CLAIM_BANK", "Aa1", 0.2, (0.3,), 108),
    ("CLAIM_BANK", "Aa2", 0.2, (0.3,), 349),
    ("CLAIM_BANK", "Aa3", 0.2, (0.3,), 47),
    ("CLAIM_BANK", "BB+", 1.0, (0.2,), 81),
    ("CLAIM_BANK", "BBB", 0.5, (), 6),
    ("CLAIM_BANK", "BBB+", 0.5, (), 86),
    ("CLAIM_BANK", "BBB-", 0.5, (1.0,), 108),
    ("CLAIM_BANK", "Baa1", 0.5, (), 14),
    ("CLAIM_BANK", "Baa2", 0.5, (0.2,), 191),
    ("CLAIM_CORP", "A", 0.5, (0.75,), 22),
    ("CLAIM_CORP", "A+", 0.5, (), 15),
    ("CLAIM_CORP", "A-", 0.5, (0.75, 1.0), 43),
    ("CLAIM_CORP", "A1", 0.5, (1.0,), 64),
    ("CLAIM_CORP", "A2", 0.5, (1.0, 0.75), 46),
    ("CLAIM_CORP", "A3", 0.5, (1.0, 0.75), 37),
    ("CLAIM_CORP", "Aa2", 0.2, (), 6),
    ("CLAIM_CORP", "Aa3", 0.2, (), 5),
    ("CLAIM_CORP", "BBB", 0.75, (1.0,), 26),
    ("CLAIM_CORP", "BBB+", 0.75, (1.0,), 34),
    ("CLAIM_CORP", "BBB-", 1.0, (0.75,), 14),
    ("CLAIM_CORP", "Baa1", 1.0, (0.75,), 21),
    ("CLAIM_CORP", "Baa2", 0.75, (1.0,), 19),
    ("CLAIM_CORP", "C", 1.5, (), 18),
    ("CLAIM_MDB", "AA+", 0.2, (), 5),
    ("CLAIM_PSE", "A1", 0.5, (), 19),
    ("CLAIM_PSE", "AA+", 0.2, (), 23),
    ("CLAIM_PSE", "Aa3", 0.2, (), 219),
    ("CLAIM_SOV", "A1", 0.0, (0.2,), 60),
    ("CLAIM_SOV", "AA+", 0.0, (), 6),
    ("CLAIM_SOV", "Aa1", 0.0, (), 32),
    ("CLAIM_SOV", "Aa3", 0.0, (), 59),
    ("CLAIM_SOV", "Aaa", 0.0, (), 16),
)

_CCF: tuple[tuple[str, str, float], ...] = (
    ("直接信用替代", "1.Direct credit substitutes", 1.0),
    ("与交易相关的或有项目", "2.Transaction-related contingencies", 0.5),
    ("与贸易相关的或有项目", "3.Trade-related contingencies", 0.2),
    ("可豁免承诺", "10a. Exempted commitment", 0.0),
    ("其他承诺（10%档）", "10b. Other commitments (CCF at 10%)", 0.1),
    ("其他承诺（40%档）", "10c. Other commitments (CCF at 40%)", 0.4),
)

_NOTE = (
    "权重来自已经读过的 Excel。2025 年银行、企业、零售和衍生分析表是同一套信用风险拆分，只计了一次。"
    "以后再上传带风险权重、外部评级或表外转换系数的 Excel，会按行累加到这张表里；同一份文件不会重复计。"
    "资产类别的常用权重是明细里出现最多的那个。外部评级只列标准法参考权重，企业档与企业分析表逐项核对的结果一致。"
    "明细里如果已经带了权重，计算仍用那一列。"
)

# Grade 1..6. Corporate row matches A-3.4-2 Analysis (Corrected Risk-Weighted % = Y):
# AA 20%, A 50%, BBB/BB 100%, C 150%. Bank grade 2 is 30%, the external-approach
# line on the bank summary (20/30/50/100/150), not the older 50% row.
_GRADE_REFERENCE: dict[str, tuple[float, float, float, float, float, float]] = {
    "sov": (0.0, 0.2, 0.5, 1.0, 1.0, 1.5),
    "pse": (0.2, 0.5, 1.0, 1.0, 1.0, 1.5),
    "bank": (0.2, 0.3, 0.5, 1.0, 1.0, 1.5),
    "corp": (0.2, 0.5, 1.0, 1.0, 1.5, 1.5),
}
_SCHEDULE_BY_ASSET = {
    "CLAIM_SOV": "sov",
    "CLAIM_PSE": "pse",
    "CLAIM_BANK": "bank",
    "CLAIM_MDB": "bank",
    "CLAIM_CORP": "corp",
    "CLAIM_SME": "corp",
    "CLAIM_CORP_PF": "corp",
    "CLAIM_CORP_PF_PO": "corp",
}
_FLAT_REFERENCE = {
    "CLAIM_MDB_PREF_0": 0.0,
    "CLAIM_RETAIL_OTHER": 0.75,
    "CLAIM_LT_REC_NMAIN_EQT": 2.5,
    "CLAIM_OTHER_EQT": 2.5,
    "CLAIM_REGULATORY_CAPITAL_INSTR": 1.5,
}
_SHORT_GRADE = {
    "F1+": "1",
    "F1": "1",
    "A-1+": "1",
    "A-1": "1",
    "P-1": "1",
    "F2": "2",
    "A-2": "2",
    "P-2": "2",
    "F3": "3",
    "A-3": "3",
    "P-3": "3",
}

_STORE = Path(__file__).resolve().parents[1] / "knowledge" / "weights_observed.json"
_BLANK = {"", "空白", "blank", "none", "nan", "na", "n/a", "-"}
_WEIGHT_HEADERS = ("rwnew", "riskweight", "rw", "rworiginal", "风险权重", "权重")
_ASSET_HEADERS = ("assetclassnew", "assetclass", "assetclassoriginal", "资产类别", "资产分类")
_RATING_HEADERS = ("externalratingnew", "externalrating", "外部评级", "scrratingnew", "评级")
_CCF_HEADERS = ("ccf", "信用转换系数", "转换系数")
_ITEM_HEADERS = ("natureofitem", "项目性质", "表外项目")
_LABELS = {item[0]: item[1] for item in _ASSETS}
_LABEL_IDS = {label: asset_id for asset_id, label in _LABELS.items()}
_CCF_LABELS = {code: label for label, code, _value in _CCF}


def weight_catalog() -> dict:
    store = _load_store()
    if store is None:
        return _catalog_from_seed()
    return _catalog_from_store(store)


def ingest_weight_workbook(path: str | Path, filename: str = "") -> dict:
    """Merge risk weights from an uploaded workbook. The same file is counted once."""
    src = Path(path)
    digest = _file_digest(src)
    store = _load_store() or _store_from_seed()
    name = filename or src.name
    if digest in store["files"]:
        return {"added": False, "duplicate": True, "filename": name}
    found = _scan_workbook(src)
    if found["rows"] <= 0:
        return {"added": False, "duplicate": False, "filename": name}
    _merge_store(store, found)
    store["files"].append(digest)
    if name and name not in store["sources"]:
        store["sources"].append(name)
    _save_store(store)
    write_weight_markdown(_STORE.parent / "权重表.md")
    return {
        "added": True,
        "duplicate": False,
        "filename": name,
        "rows": found["rows"],
        "asset_rows": found["asset_rows"],
        "rating_rows": found["rating_rows"],
        "ccf_rows": found["ccf_rows"],
    }


def render_weight_markdown() -> str:
    catalog = weight_catalog()
    lines = [
        "# 权重表",
        "",
        catalog["note"],
        "",
        "## 资产类别",
        "",
        "| 类别 | 标识 | 常用权重 | 其他 | 已分析笔数 |",
        "| --- | --- | --- | --- | --- |",
    ]
    for item in catalog["assets"]:
        lines.append(
            f"| {item['label']} | {item['id']} | {item['display']} | {item['others_display']} | {item['count']} |"
        )
    lines.extend(
        [
            "",
            "## 外部评级",
            "",
            "有外部评级的行按类别和评级累计。这里只列标准法参考权重。",
            "",
            "| 类别 | 外部评级 | 参考权重 | 已分析笔数 |",
            "| --- | --- | --- | --- |",
        ]
    )
    for item in catalog["ratings"]:
        lines.append(
            f"| {item['label']} | {item['rating']} | {item['reference_display']} | {item['count']} |"
        )
    lines.extend(
        [
            "",
            "## 表外信用转换系数",
            "",
            "| 项目 | 原文 | 转换系数 |",
            "| --- | --- | --- |",
        ]
    )
    for item in catalog["ccf"]:
        lines.append(f"| {item['label']} | {item['item']} | {item['display']} |")
    lines.append("")
    return "\n".join(lines)


def write_weight_markdown(path: Path) -> None:
    path.write_text(render_weight_markdown(), encoding="utf-8")


def _catalog_from_seed() -> dict:
    labels = {item[0]: item[1] for item in _ASSETS}
    return {
        "note": _NOTE,
        "assets": [_asset_row(item) for item in _ASSETS],
        "ratings": [_rating_row(item, labels) for item in _RATINGS],
        "ccf": [
            {"label": label, "item": code, "ccf": value, "display": _pct(value)}
            for label, code, value in _CCF
        ],
    }


def _catalog_from_store(store: dict) -> dict:
    assets = [_bucket_row(asset_id, bucket) for asset_id, bucket in store["assets"].items()]
    assets.sort(key=lambda item: (-item["count"], item["label"]))
    ratings = []
    for bucket in store["ratings"].values():
        row = _bucket_row(bucket["asset"], bucket)
        row["asset"] = bucket["asset"]
        row["rating"] = bucket["rating"]
        ratings.append(row)
    ratings.sort(key=lambda item: (item["label"], item["rating"]))
    ccf = []
    for bucket in store["ccf"].values():
        weight, _others, count = _mode(bucket["counts"])
        ccf.append(
            {
                "label": bucket["label"],
                "item": bucket["item"],
                "ccf": weight,
                "display": _pct(weight),
                "count": count,
            }
        )
    ccf.sort(key=lambda item: item["item"])
    return {"note": _NOTE, "assets": assets, "ratings": ratings, "ccf": ccf}


def _bucket_row(bucket_id: str, bucket: dict) -> dict:
    weight, others, count = _mode(bucket["counts"])
    return {
        "id": bucket_id,
        "label": bucket.get("label") or _LABELS.get(bucket_id, bucket_id),
        "weight": weight,
        "display": _pct(weight),
        "others": others,
        "others_display": _others(tuple(others)),
        "count": count,
        **_reference_fields(bucket.get("asset") or bucket_id, bucket.get("rating")),
    }


def _mode(counts: dict) -> tuple[float, list[float], int]:
    parsed = [(float(key), int(value)) for key, value in counts.items() if int(value) > 0]
    parsed.sort(key=lambda item: (-item[1], item[0]))
    total = sum(count for _weight, count in parsed)
    if not parsed:
        return 0.0, [], 0
    weight = parsed[0][0]
    others = [item[0] for item in parsed[1:] if item[1] >= max(3, int(total * 0.05))]
    return weight, others, total


def _store_from_seed() -> dict:
    store = {"files": [], "sources": [], "assets": {}, "ratings": {}, "ccf": {}}
    for asset_id, label, weight, others, count in _ASSETS:
        counts = { _key(weight): count }
        for extra in others:
            counts.setdefault(_key(extra), 0)
        store["assets"][asset_id] = {"label": label, "counts": {key: value for key, value in counts.items() if value}}
    labels = {item[0]: item[1] for item in _ASSETS}
    for asset_id, rating, weight, others, count in _RATINGS:
        counts = {_key(weight): count}
        for extra in others:
            counts[_key(extra)] = counts.get(_key(extra), 0)
        store["ratings"][_rating_key(asset_id, rating)] = {
            "asset": asset_id,
            "label": labels.get(asset_id, asset_id),
            "rating": rating,
            "counts": {key: value for key, value in counts.items() if value},
        }
    for label, code, value in _CCF:
        store["ccf"][_norm(code)] = {"label": label, "item": code, "counts": {_key(value): 1}}
    return store


def _scan_workbook(path: Path) -> dict:
    found = {
        "rows": 0,
        "asset_rows": 0,
        "rating_rows": 0,
        "ccf_rows": 0,
        "assets": {},
        "ratings": {},
        "ccf": {},
    }
    book = openpyxl.load_workbook(path, read_only=True, data_only=True)
    try:
        for sheet in book.worksheets:
            _scan_sheet(sheet, found)
    finally:
        book.close()
    return found


def _scan_sheet(sheet, found: dict) -> None:
    rows = sheet.iter_rows(values_only=True)
    header = None
    indexes = None
    for _index, raw in enumerate(rows):
        if header is None:
            picked = _header_indexes(raw)
            if picked is None:
                if _index >= 25:
                    return
                continue
            header = raw
            indexes = picked
            continue
        _read_observation(raw, indexes, found)


def _header_indexes(raw: tuple) -> dict | None:
    names = [_norm(cell) for cell in raw]
    weight = _pick(names, _WEIGHT_HEADERS)
    ccf = _pick(names, _CCF_HEADERS)
    if weight is None and ccf is None:
        return None
    return {
        "weight": weight,
        "asset": _pick(names, _ASSET_HEADERS),
        "rating": _pick(names, _RATING_HEADERS),
        "ccf": ccf,
        "item": _pick(names, _ITEM_HEADERS),
    }


def _read_observation(raw: tuple, indexes: dict, found: dict) -> None:
    weight = _weight_at(raw, indexes["weight"])
    asset = _asset_at(raw, indexes["asset"]) if weight is not None else ""
    rating = _text_at(raw, indexes["rating"]) if weight is not None else ""
    if weight is not None and asset:
        _add_count(found["assets"], asset, _LABELS.get(asset, asset), weight)
        found["asset_rows"] += 1
        found["rows"] += 1
        if rating:
            key = _rating_key(asset, rating)
            bucket = found["ratings"].setdefault(
                key,
                {"asset": asset, "label": _LABELS.get(asset, asset), "rating": rating, "counts": {}},
            )
            bucket["counts"][_key(weight)] = bucket["counts"].get(_key(weight), 0) + 1
            found["rating_rows"] += 1
    ccf = _weight_at(raw, indexes["ccf"])
    item = _text_at(raw, indexes["item"])
    if ccf is not None and item:
        key = _norm(item)
        label = _CCF_LABELS.get(item, item)
        bucket = found["ccf"].setdefault(key, {"label": label, "item": item, "counts": {}})
        bucket["counts"][_key(ccf)] = bucket["counts"].get(_key(ccf), 0) + 1
        found["ccf_rows"] += 1
        found["rows"] += 1


def _add_count(bucket: dict, asset_id: str, label: str, weight: float) -> None:
    item = bucket.setdefault(asset_id, {"label": label, "counts": {}})
    item["counts"][_key(weight)] = item["counts"].get(_key(weight), 0) + 1


def _merge_store(store: dict, found: dict) -> None:
    for asset_id, bucket in found["assets"].items():
        target = store["assets"].setdefault(asset_id, {"label": bucket["label"], "counts": {}})
        if asset_id in _LABELS:
            target["label"] = _LABELS[asset_id]
        _add_counts(target["counts"], bucket["counts"])
    for key, bucket in found["ratings"].items():
        target = store["ratings"].setdefault(
            key,
            {
                "asset": bucket["asset"],
                "label": bucket["label"],
                "rating": bucket["rating"],
                "counts": {},
            },
        )
        if bucket["asset"] in _LABELS:
            target["label"] = _LABELS[bucket["asset"]]
        _add_counts(target["counts"], bucket["counts"])
    for key, bucket in found["ccf"].items():
        target = store["ccf"].setdefault(key, {"label": bucket["label"], "item": bucket["item"], "counts": {}})
        _add_counts(target["counts"], bucket["counts"])


def _add_counts(target: dict, incoming: dict) -> None:
    for key, count in incoming.items():
        target[key] = int(target.get(key, 0)) + int(count)


def _weight_at(raw: tuple, index: int | None) -> float | None:
    if index is None or index >= len(raw):
        return None
    value = raw[index]
    if isinstance(value, str):
        text = value.strip()
        if _norm(text) in _BLANK or text.startswith("#"):
            return None
        percent = text.endswith("%")
        text = text[:-1].strip() if percent else text
        try:
            number = float(text.replace(",", ""))
        except ValueError:
            return None
        if percent:
            number /= 100.0
    elif isinstance(value, (int, float)) and not isinstance(value, bool):
        number = float(value)
    else:
        return None
    if number > 12.5 and number <= 1250:
        number /= 100.0
    if number < 0 or number > 12.5 or number != number:
        return None
    return round(number, 6)


def _asset_at(raw: tuple, index: int | None) -> str:
    text = _text_at(raw, index)
    if not text:
        return ""
    return _LABEL_IDS.get(text, text)


def _text_at(raw: tuple, index: int | None) -> str:
    if index is None or index >= len(raw) or raw[index] is None:
        return ""
    text = re.sub(r"\s+", " ", str(raw[index])).strip()
    if _norm(text) in _BLANK:
        return ""
    return text[:80]


def _pick(names: list[str], wanted: tuple[str, ...]) -> int | None:
    for name in wanted:
        if name in names:
            return names.index(name)
    return None


def _norm(value: object) -> str:
    return re.sub(r"[^a-z0-9\u4e00-\u9fff]", "", str(value or "").lower())


def _rating_key(asset_id: str, rating: str) -> str:
    return asset_id + "||" + rating


def _key(value: float) -> str:
    return f"{value:.6f}".rstrip("0").rstrip(".")


def _file_digest(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _load_store() -> dict | None:
    if not _STORE.is_file():
        return None
    try:
        data = json.loads(_STORE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(data, dict):
        return None
    data.setdefault("files", [])
    data.setdefault("sources", [])
    data.setdefault("assets", {})
    data.setdefault("ratings", {})
    data.setdefault("ccf", {})
    return data


def _save_store(store: dict) -> None:
    _STORE.parent.mkdir(parents=True, exist_ok=True)
    _STORE.write_text(json.dumps(store, ensure_ascii=False, indent=2), encoding="utf-8")


def _asset_row(item: tuple) -> dict:
    asset_id, label, weight, others, count = item
    return {
        "id": asset_id,
        "label": label,
        "weight": weight,
        "display": _pct(weight),
        "others": list(others),
        "others_display": _others(others),
        "count": count,
    }


def _rating_row(item: tuple, labels: dict[str, str]) -> dict:
    asset_id, rating, weight, others, count = item
    return {
        "asset": asset_id,
        "label": labels.get(asset_id, asset_id),
        "rating": rating,
        "weight": weight,
        "display": _pct(weight),
        "others": list(others),
        "others_display": _others(others),
        "count": count,
        **_reference_fields(asset_id, rating),
    }


def reference_weight(asset_id: str, rating: object) -> float | None:
    """Standard weight for this asset class and external rating."""
    flat = _FLAT_REFERENCE.get(asset_id)
    if flat is not None:
        return flat
    schedule = _SCHEDULE_BY_ASSET.get(asset_id)
    if schedule is None:
        return None
    grade = _grade_of(rating)
    if not grade.isdigit():
        return None
    return _GRADE_REFERENCE[schedule][int(grade) - 1]


def _grade_of(rating: object) -> str:
    from rwa_agent.reference import grade_of

    text = str(rating or "").strip().upper()
    short = _SHORT_GRADE.get(text)
    if short:
        return short
    return grade_of(rating)


def _reference_fields(asset_id: str, rating: object) -> dict:
    weight = reference_weight(asset_id, rating)
    return {
        "reference": weight,
        "reference_display": "—" if weight is None else _pct(weight),
    }


def _others(values: tuple[float, ...]) -> str:
    if not values:
        return "—"
    return "、".join(_pct(value) for value in values)


def _pct(value: float) -> str:
    points = float(value) * 100
    if abs(points - round(points)) < 1e-6:
        return f"{int(round(points))}%"
    text = f"{points:.2f}".rstrip("0").rstrip(".")
    return text + "%"
