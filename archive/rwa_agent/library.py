"""Persist the rules library as Markdown and read it before each use."""

from __future__ import annotations

from pathlib import Path

from rwa_agent.rules import DEFAULT_PACK_RULES, resolve_rules
from rwa_agent.weight_tables import write_weight_markdown

ROOT = Path(__file__).resolve().parents[1] / "knowledge"

PACK_ORDER = ("repo_credit", "ccr_fx", "mr_repo", "mr_irs", "mr_fx")

PACK_META = {
    "repo_credit": ("正回购信用风险", "信用风险"),
    "ccr_fx": ("外汇互换对手信用风险", "信用风险"),
    "mr_repo": ("回购利率市场风险", "市场风险"),
    "mr_irs": ("利率互换市场风险", "市场风险"),
    "mr_fx": ("外汇净敞口市场风险", "市场风险"),
}

PARAM_FIELDS = {
    "repo_credit": (
        ("usd_cnh", "CNH 折美元除数", "number"),
        ("capital_ratio", "资本比例", "percent"),
        ("bank_short_months", "银行短期上限（月）", "number"),
        ("zero_weight_name", "权重为 0 的发行人", "text"),
    ),
    "ccr_fx": (
        ("cut_short", "短期限上限（月）", "number"),
        ("ccf_short", "短期限附加因子", "percent"),
        ("cut_mid", "中期限上限（月）", "number"),
        ("ccf_mid", "中期限附加因子", "percent"),
        ("ccf_long", "更长期限附加因子", "percent"),
        ("capital_ratio", "资本比例", "percent"),
    ),
    "mr_repo": (
        ("specific_gov", "政府类特定风险", "percent"),
        ("specific_ig", "投资级特定风险", "percent"),
        ("rwa_multiplier", "RWA 倍数", "number"),
    ),
    "mr_irs": (
        ("gap_factor", "两腿差额倍数", "number"),
        ("rwa_multiplier", "RWA 倍数", "number"),
    ),
    "mr_fx": (("capital_ratio", "资本比例", "percent"),),
}

DEFAULT_TEXT = {
    "repo_credit": {
        "lines": ["折美元持仓 × 风险权重 = RWA", "RWA × 8% = 资本"],
        "steps": [
            {"title": "把持仓折成美元", "fields": ["bond_ccy", "position_local"], "line": "人民币（CNH）金额除以 7.2 得到美元。其他币种按原来的金额计算。"},
            {"title": "按发行人查找风险权重", "fields": ["issuer_name", "issuer_type", "rating_sp", "residual_months"], "line": "发行人是财政部时，权重为 0。银行且剩余期限不超过 3 个月时，用短期档。"},
        ],
    },
    "ccr_fx": {
        "lines": ["折现后的净流入 + 流入金额 × 附加因子 = 信用暴露", "信用暴露 × 对手风险权重 = RWA"],
        "steps": [
            {"title": "轧差远端两腿的折现金额", "fields": ["far_ccy_1", "far_amt_1", "far_ccy_2", "far_amt_2", "residual_months"], "line": "远端两腿一正一负，一边是将来流入，一边是将来流出。先折成澳门元，再按剩余期限折现，用流入减去流出。小于 0 时记为 0。"},
            {"title": "按剩余期限加上附加因子", "fields": ["residual_months"], "line": "不超过 12 个月按 1%，不超过 60 个月按 5%，更长按 7.5%。这个比例只乘在流入那一腿上。"},
            {"title": "乘上对手方的风险权重", "fields": ["counterparty_type", "rating_fitch", "counterparty_name"], "line": "银行对手按一般期限档，用 Fitch 评级查出风险权重。"},
        ],
    },
    "mr_repo": {
        "lines": ["市值 × 特定风险 + 市值 × 期限档 = 资本", "资本 × 12.5 = RWA"],
        "steps": [
            {"title": "计算特定风险", "fields": ["mv_mop", "issuer_category"], "line": "政府类发行人按 0%，投资级企业按 1%，再乘以市值。"},
            {"title": "按剩余期限套用期限档", "fields": ["residual_months", "trade_id"], "line": "用剩余期限查出对应的期限档权重，再乘以市值。"},
        ],
    },
    "mr_irs": {
        "lines": ["|浮动腿加权 − 固定腿加权| × 2 = 资本", "资本 × 12.5 = RWA"],
        "steps": [
            {"title": "浮动腿和固定腿分别加权", "fields": ["floating_pv", "floating_tenor_months", "fixed_pv", "fixed_tenor_months"], "line": "每条腿用现值乘上该腿剩余期限对应的期限档权重。"},
            {"title": "取两腿差额", "fields": ["direction", "trade_id"], "line": "两条腿的加权头寸相减，取绝对值，再乘以 2。"},
        ],
    },
    "mr_fx": {
        "lines": ["净敞口 × 8% = 单币种资本", "多头合计与空头合计取较大一边，作为全行 RWA"],
        "steps": [
            {"title": "计算单个币种", "fields": ["ccy", "nop_mop"], "line": "这一行的 RWA 等于净敞口，资本等于净敞口的 8%。"},
            {"title": "汇总全行敞口", "fields": ["side", "trade_id"], "line": "多头和空头分别加总，取金额较大的一边作为全行 RWA。"},
        ],
    },
}


def ensure_library() -> dict[str, dict]:
    """Create any missing rule file, then read the whole library from disk."""
    ROOT.mkdir(parents=True, exist_ok=True)
    for pack in PACK_ORDER:
        path = _path(pack)
        if not path.is_file():
            path.write_text(render_rule(default_rule(pack)), encoding="utf-8")
    library = load_library()
    write_weight_markdown(ROOT / "权重表.md")
    _write_index(library)
    return library


def load_library() -> dict[str, dict]:
    """Read every rule file. Called on startup and again whenever rules are used."""
    library = {}
    for pack in PACK_ORDER:
        library[pack] = _read_pack(pack)
    return library


def calculation_rules() -> dict[str, dict]:
    """Numeric parameters currently saved in the Markdown files."""
    library = load_library()
    return resolve_rules({pack: doc["params"] for pack, doc in library.items()})


def save_rule(pack: str, incoming: object) -> dict:
    if pack not in PACK_META:
        raise ValueError("没有这条规则")
    if not isinstance(incoming, dict):
        raise ValueError("规则格式无效")
    current = default_rule(pack)
    title = str(incoming.get("title") or current["title"]).strip()[:40] or current["title"]
    lines = _clean_lines(incoming.get("lines")) or current["lines"]
    steps = _clean_steps(incoming.get("steps"), current["steps"])
    params = resolve_rules({pack: incoming.get("params") or {}})[pack]
    doc = {"id": pack, "title": title, "category": current["category"], "lines": lines, "steps": steps, "params": params}
    _path(pack).parent.mkdir(parents=True, exist_ok=True)
    _path(pack).write_text(render_rule(doc), encoding="utf-8")
    _write_index(load_library())
    return _read_pack(pack)


def reset_rule(pack: str) -> dict:
    if pack not in PACK_META:
        raise ValueError("没有这条规则")
    doc = default_rule(pack)
    _path(pack).parent.mkdir(parents=True, exist_ok=True)
    _path(pack).write_text(render_rule(doc), encoding="utf-8")
    _write_index(load_library())
    return _read_pack(pack)


def default_rule(pack: str) -> dict:
    title, category = PACK_META[pack]
    text = DEFAULT_TEXT[pack]
    return {
        "id": pack,
        "title": title,
        "category": category,
        "lines": list(text["lines"]),
        "steps": [dict(step) for step in text["steps"]],
        "params": dict(DEFAULT_PACK_RULES[pack]),
    }


def render_rule(doc: dict) -> str:
    kinds = {key: kind for key, _label, kind in PARAM_FIELDS[doc["id"]]}
    labels = {key: label for key, label, _kind in PARAM_FIELDS[doc["id"]]}
    parts = [
        f"# {doc['title']}",
        "",
        f"id: {doc['id']}",
        f"类别: {doc['category']}",
        "",
        "## 公式",
        "",
    ]
    parts.extend(f"- {line}" for line in doc["lines"])
    parts.extend(["", "## 步骤", ""])
    for index, step in enumerate(doc["steps"], start=1):
        fields = "、".join(step.get("fields") or [])
        parts.extend(
            [
                f"### {index}. {step['title']}",
                "",
                f"- 字段: {fields}",
                f"- 说明: {step['line']}",
                "",
            ]
        )
    parts.extend(["## 参数", "", "| 名称 | 标识 | 值 |", "| --- | --- | --- |"])
    for key, _label, _kind in PARAM_FIELDS[doc["id"]]:
        value = doc["params"].get(key, DEFAULT_PACK_RULES[doc["id"]][key])
        parts.append(f"| {labels[key]} | {key} | {_display(kinds[key], value)} |")
    parts.append("")
    return "\n".join(parts)


def _read_pack(pack: str) -> dict:
    path = _path(pack)
    base = default_rule(pack)
    if not path.is_file():
        return base
    try:
        parsed = _parse(path.read_text(encoding="utf-8"), pack)
    except (OSError, ValueError):
        return base
    title = parsed.get("title") or base["title"]
    lines = parsed.get("lines") or base["lines"]
    steps = parsed.get("steps") or base["steps"]
    if len(steps) < len(base["steps"]):
        steps = steps + base["steps"][len(steps) :]
    merged_steps = []
    for index, step in enumerate(steps):
        fallback = base["steps"][index] if index < len(base["steps"]) else {"fields": [], "title": "", "line": ""}
        merged_steps.append(
            {
                "title": step.get("title") or fallback["title"],
                "line": step.get("line") or fallback["line"],
                "fields": step.get("fields") or list(fallback.get("fields") or []),
            }
        )
    try:
        params = resolve_rules({pack: parsed.get("params") or {}})[pack]
    except ValueError:
        params = base["params"]
    return {
        "id": pack,
        "title": title,
        "category": parsed.get("category") or base["category"],
        "lines": lines,
        "steps": merged_steps,
        "params": params,
    }


def _parse(text: str, pack: str) -> dict:
    title = ""
    category = ""
    lines: list[str] = []
    steps: list[dict] = []
    params: dict = {}
    section = ""
    step: dict | None = None
    kinds = {key: kind for key, _label, kind in PARAM_FIELDS[pack]}
    for raw in text.splitlines():
        line = raw.strip()
        if line.startswith("# "):
            title = line[2:].strip()
            continue
        if line.startswith("## "):
            section = line[3:].strip()
            step = None
            continue
        if line.startswith("id:") or line.startswith("类别:"):
            if line.startswith("类别:"):
                category = line.split(":", 1)[1].strip()
            continue
        if section == "公式" and line.startswith("- "):
            item = line[2:].strip()
            if item:
                lines.append(item[:120])
            continue
        if section == "步骤" and line.startswith("### "):
            heading = line[4:].strip()
            if ". " in heading:
                heading = heading.split(". ", 1)[1]
            step = {"title": heading[:40], "line": "", "fields": []}
            steps.append(step)
            continue
        if section == "步骤" and step is not None and line.startswith("- 字段:"):
            fields = line.split(":", 1)[1].replace(",", "、")
            step["fields"] = [item.strip() for item in fields.split("、") if item.strip()]
            continue
        if section == "步骤" and step is not None and line.startswith("- 说明:"):
            step["line"] = line.split(":", 1)[1].strip()[:200]
            continue
        if section == "参数" and line.startswith("|") and "---" not in line and "标识" not in line:
            cells = [cell.strip() for cell in line.strip("|").split("|")]
            if len(cells) < 3:
                continue
            key = cells[1]
            if key not in kinds:
                continue
            params[key] = _parse_value(kinds[key], cells[2])
    return {"title": title[:40], "category": category, "lines": lines[:4], "steps": steps[:6], "params": params}


def _parse_value(kind: str, raw: str):
    text = raw.strip()
    if kind == "text":
        return text[:80]
    if text.endswith("%"):
        text = text[:-1].strip()
        return float(text) / 100.0
    number = float(text)
    if kind == "percent" and 1 < number <= 100:
        return number / 100.0
    return number


def _display(kind: str, value: object) -> str:
    if kind == "text":
        return str(value)
    number = float(value)
    if kind == "percent":
        points = number * 100
        text = str(int(points)) if abs(points - round(points)) < 1e-8 else f"{points:.4f}".rstrip("0").rstrip(".")
        return text + "%"
    text = f"{number:.6f}".rstrip("0").rstrip(".")
    return text or "0"


def _clean_lines(raw: object) -> list[str]:
    if not isinstance(raw, list):
        return []
    return [str(item).strip()[:120] for item in raw if str(item).strip()][:4]


def _clean_steps(raw: object, fallback: list[dict]) -> list[dict]:
    if not isinstance(raw, list) or not raw:
        return fallback
    cleaned = []
    for index, item in enumerate(raw[:6]):
        base = fallback[index] if index < len(fallback) else {"title": "", "line": "", "fields": []}
        if not isinstance(item, dict):
            cleaned.append(dict(base))
            continue
        fields = item.get("fields") if isinstance(item.get("fields"), list) else base.get("fields") or []
        cleaned.append(
            {
                "title": str(item.get("title") or base.get("title") or "").strip()[:40],
                "line": str(item.get("line") or base.get("line") or "").strip()[:200],
                "fields": [str(field).strip() for field in fields if str(field).strip()][:12],
            }
        )
    return cleaned


def _write_index(library: dict[str, dict]) -> None:
    parts = ["# 规则库", "", "服务启动、打开页面和计算之前都会重新读这些文件。参数以每条规则里的参数表为准。", ""]
    for pack in PACK_ORDER:
        doc = library[pack]
        parts.append(f"- [{doc['title']}]({pack}.md)")
    parts.append("- [权重表](权重表.md)")
    parts.append("")
    (ROOT / "规则库.md").write_text("\n".join(parts), encoding="utf-8")


def _path(pack: str) -> Path:
    return ROOT / f"{pack}.md"
