"""第五步：按产品规则逐笔做信用风险暴露划分。

输入全部来自前面四步：

- 债项来自第二步上传的工作簿（``loans[].raw``）；
- 产品来自第三步（``loans[].product``）；
- 字段映射来自第四步确认的清单（``mappings[product]``）；
- 规则文档由 Koa 从数据库 ``exposure_document`` 取出后放在 ``documents[product]``。

这一层只做规则解析和留痕，不读 Excel，不调模型，也不跑工作簿计算。
每笔债项写一份 Markdown 到 ``output/traces/step5/<uploadId>/``，把映射、
原值、逐条判定、命中路径和结论都记下来。
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from agent.core.paths import TRACES
from agent.core.weight.exposure import _coerce, classify
from agent.core.weight.rules import class_fields, prototype_flow, rule_index
from agent.core.weight.trace import number_steps


# 产品本身就是债权类工具。规则文档里 instrument_type 缺失时用它补上，
# 并在留痕里注明来源，不把推导值伪装成 Excel 原值。
_PRODUCT_INSTRUMENT = {
    "corp_loan": "claim",
    "personal_loan": "claim",
    "bond": "claim",
    "ib_call": "claim",
    "ib_time": "claim",
    "due_from_bank": "claim",
    "off_bs": "claim",
}


@dataclass
class RuleBook:
    code: str
    label: str
    doc: dict[str, Any]
    meta: dict[str, Any]
    categories: list
    auxiliary: list
    fields: dict[str, dict]
    rules: dict[str, dict]


def _auxiliary_names(body: dict) -> set[str]:
    """识别不判断风险暴露类型的附加规则。

    这类规则没有 ``when``、不直接给权重，但带 ``applies_to`` 或 ``formula``。
    它们不进入分类顺序；第五步只做逐笔分类，不读取这些附加规则。
    """
    found: set[str] = set()

    def walk(nodes: object) -> None:
        for rule in nodes or []:
            if not isinstance(rule, dict):
                continue
            if rule.get("when") is None and rule.get("value") is None and rule.get("weight") is None:
                if rule.get("applies_to") or rule.get("formula") or rule.get("covered"):
                    name = str(rule.get("name") or "")
                    if name:
                        found.add(name)
            walk(rule.get("children"))
            walk([rule.get("otherwise")] if isinstance(rule.get("otherwise"), dict) else [])

    walk(body.get("rules"))
    return found


def _safe(value: object) -> str:
    return re.sub(r"[^\w.-]+", "_", str(value or ""))[:100] or "loan"


def _book(code: str, product_label: str, raw: dict[str, Any]) -> RuleBook:
    body = raw.get("body") if isinstance(raw.get("body"), dict) else raw
    if not isinstance(body, dict) or not isinstance(body.get("rules"), list):
        raise ValueError("产品 " + (code or "未识别") + " 没有可解析的风险暴露划分规则")
    meta = {key: raw.get(key) for key in ("id", "name", "title", "label", "ruleVersion", "sourceFile", "matchedBy")}
    meta["title"] = str(meta.get("title") or body.get("title") or code or "未识别")
    meta["name"] = str(meta.get("name") or body.get("name") or "")
    skip = _auxiliary_names(body)
    categories = []
    auxiliary = []
    for node in prototype_flow(body)["categories"]:
        if str(node.get("id") or "") in skip:
            auxiliary.append(node)
        else:
            categories.append(node)
    return RuleBook(
        code=code,
        label=product_label or str(raw.get("productLabel") or code or "未识别"),
        doc=body,
        meta=meta,
        categories=categories,
        auxiliary=auxiliary,
        fields={str(item.get("id")): item for item in class_fields(body)},
        rules=rule_index(body),
    )


def _options(book: RuleBook, field: str) -> list[dict]:
    return list((book.fields.get(str(field)) or {}).get("options") or [])


# 不同规则文档对同一主体的代码不完全一致。只在文档的选项里出现时才换名，
# 不把文档没有的代码塞进去。
_OPTION_ALIASES = {
    "counterparty_type": {
        "commercial_bank": ("bank",),
        "bank": ("commercial_bank",),
        "individual": ("retail",),
        "retail": ("individual",),
        "other_fi": ("other_financial_institution",),
        "other_financial_institution": ("other_fi",),
    },
}


def _fit_option(field: str, value: Any, options: list[dict]) -> Any:
    if not isinstance(value, str) or not options:
        return value
    codes = {str(opt.get("code")) for opt in options if opt.get("code") is not None}
    if not codes or value in codes:
        return value
    for alias in _OPTION_ALIASES.get(field, {}).get(value, ()):
        if alias in codes:
            return alias
    return value


def _shown(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, (list, tuple)):
        return "、".join(str(item) for item in value)
    return str(value)


def _mapping_rows(loan: dict, book: RuleBook, mapping: list[dict]) -> list[dict]:
    """按第四步确认的映射，把每个标准字段对到来源列和规则字段。"""
    raw = loan.get("raw") if isinstance(loan.get("raw"), dict) else {}
    std = loan.get("std") if isinstance(loan.get("std"), dict) else {}
    rows: list[dict] = []
    covered: set[str] = set()
    for item in mapping:
        if not isinstance(item, dict):
            continue
        rule_field = str(item.get("ruleField") or item.get("stdCode") or "")
        column = str(item.get("column") or "")
        row = {
            "stdField": str(item.get("stdField") or ""),
            "stdCode": str(item.get("stdCode") or ""),
            "ruleField": rule_field,
            "column": column,
            "required": bool(item.get("required")),
            "source": "未映射",
            "raw": None,
            "value": None,
            "note": "",
        }
        if not rule_field:
            row["note"] = "计算字段，规则直接使用前面步骤算出的值"
            if std:
                row["source"] = "步骤 3/计算字段"
            rows.append(row)
            continue
        covered.add(rule_field)
        if column and isinstance(raw, dict) and column in raw and raw.get(column) not in (None, ""):
            row["raw"] = raw.get(column)
            value = _coerce(rule_field, raw.get(column), _options(book, rule_field), column)
            value = _fit_option(rule_field, value, _options(book, rule_field))
            if value is None and std.get(rule_field) not in (None, ""):
                value = _coerce(rule_field, std.get(rule_field), _options(book, rule_field), column)
                value = _fit_option(rule_field, value, _options(book, rule_field))
                row["source"] = "第四步映射后的标准值"
                row["note"] = "来源列原值无法归一化，改用前面步骤的标准值"
            else:
                row["source"] = "第四步映射列"
            row["value"] = value
            if value is None:
                row["note"] = "原值无法归一化到规则选项"
                row["failed"] = True
        elif std.get(rule_field) not in (None, ""):
            value = _coerce(rule_field, std.get(rule_field), _options(book, rule_field), column)
            row["value"] = _fit_option(rule_field, value, _options(book, rule_field))
            row["source"] = "第四步映射后的标准值"
            if column:
                row["note"] = "来源列「" + column + "」为空"
        else:
            row["source"] = "第四步映射列" if column else "未映射"
            row["note"] = "来源列「" + (column or "未指定") + "」没有取值"
        rows.append(row)

    # 规则需要的、映射清单里没有的派生字段，直接用前面步骤算好的标准值。
    for field, value in std.items():
        if field in covered or value in (None, ""):
            continue
        rows.append({
            "stdField": field,
            "stdCode": "",
            "ruleField": str(field),
            "column": "",
            "required": False,
            "source": "步骤 3/计算字段",
            "raw": None,
            "value": value,
            "note": "",
        })
    return rows


def _facts(loan: dict, book: RuleBook, mapping: list[dict]) -> tuple[dict[str, Any], float | None, list[dict]]:
    """按第四步映射生成规则事实。一个字段只取一个归一化值。"""
    rows = _mapping_rows(loan, book, mapping)
    facts: dict[str, Any] = {}
    failed = [row["ruleField"] for row in rows if row.get("failed")]
    if failed:
        facts["_coerce_failed"] = failed
    for row in rows:
        field = row["ruleField"]
        value = row["value"]
        if not field or value in (None, ""):
            continue
        facts[str(field)] = value

    if not facts.get("instrument_type"):
        hint = _PRODUCT_INSTRUMENT.get(str(loan.get("product") or ""))
        if hint and "instrument_type" in book.fields:
            facts["instrument_type"] = hint
            rows.append({
                "stdField": "工具",
                "stdCode": "",
                "ruleField": "instrument_type",
                "column": "",
                "required": False,
                "source": "产品类型推导",
                "raw": None,
                "value": hint,
                "note": "产品本身就是债权类工具，第四步没有单独映射工具列",
            })
    if not facts.get("counterparty_name"):
        name = loan.get("name") or loan.get("customer")
        if name:
            facts["counterparty_name"] = str(name)
    facts["_excel_row"] = loan.get("excelRow")
    # RWA 只用本笔债项金额，不汇总同一债务人。
    amount = None
    for candidate in (facts.get("balance"), loan.get("balance")):
        if isinstance(candidate, (int, float)) and not isinstance(candidate, bool) and math.isfinite(float(candidate)):
            amount = float(candidate)
            break
    facts["_amount"] = amount
    return facts, amount, rows


def _status(loan: dict, hit: dict, facts: dict[str, Any], amount: float | None, weight: float | None) -> str:
    if not loan.get("product"):
        return "warning"
    path = str(hit.get("path") or "")
    category = str(hit.get("category") or "")
    if not category or any(token in path or token in category for token in ("未归类", "未分类")):
        return "exception"
    if weight is None:
        return "warning"
    if amount is None:
        return "warning"
    if facts.get("_coerce_failed"):
        return "warning"
    return "ok"


def _cell(value: Any) -> str:
    if value is None:
        return ""
    text = _shown(value).replace("|", "\\|").replace("\n", " ")
    return text[:300]


def _mapping_table(rows: list[dict]) -> list[str]:
    if not rows:
        return ["（第四步没有确认字段映射）"]
    lines = [
        "| 标准字段 | 标准编码 | 规则字段 | 来源列 | Excel 原值 | 归一化取值 | 来源 | 说明 |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for row in rows:
        lines.append(
            "| " + " | ".join(_cell(row[key]) for key in (
                "stdField", "stdCode", "ruleField", "column", "raw", "value", "source", "note",
            )) + " |"
        )
    return lines


def _steps_table(steps: list[dict[str, Any]]) -> list[str]:
    if not steps:
        return ["（没有规则步骤）"]
    lines = [
        "| # | 阶段 | 标题 | 规则/字段 | 比较 | 规则值 | 实际值 | 命中 | 结果 | 说明 |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for index, item in enumerate(number_steps(steps), 1):
        hit = item.get("hit")
        hit_text = "" if hit is None else ("是" if hit else "否")
        values = []
        for key in ("seq", "stage", "title", "rule", "op", "expected", "actual", "hit", "result", "note"):
            values.append(hit_text if key == "hit" else item.get(key))
        lines.append("| " + " | ".join(_cell(value) for value in values) + " |")
    return lines


def _field_coverage(book: RuleBook, facts: dict[str, Any]) -> list[str]:
    if not book.fields:
        return ["（规则文档没有声明字段）"]
    lines = ["| 规则字段 | 名称 | 本次取值 |", "| --- | --- | --- |"]
    for field_id, meta in book.fields.items():
        value = facts.get(field_id)
        shown = "—（未提供）" if value in (None, "") else _shown(value)
        lines.append("| " + _cell(field_id) + " | " + _cell(meta.get("label")) + " | " + _cell(shown) + " |")
    return lines


def _document_outline(book: RuleBook) -> list[str]:
    lines = ["> 规则文档按顺序解析，同一层第一条命中后进入它的下级；没有下级时该条生效。", ""]
    for index, node in enumerate(book.categories, 1):
        if node.get("otherwise"):
            kind = "兜底"
        else:
            kind = "分类" if node.get("type") == "gate" else "叶子"
        lines.append(
            str(index) + ". " + str(node.get("label") or node.get("id") or "")
            + "（" + kind + "，" + str(node.get("id") or "") + "）"
        )
    if book.auxiliary:
        lines.append("")
        lines.append("另有不参与分类顺序的附加规则：" + "、".join(
            str(node.get("label") or node.get("id") or "") for node in book.auxiliary
        ) + "。第五步分类不读取这些规则。")
    return lines


def _write_md(
    upload_id: str,
    loan: dict,
    book: RuleBook,
    mapping_rows: list[dict],
    facts: dict[str, Any],
    hit: dict[str, Any],
    amount: float | None,
    rwa: float | None,
    status: str,
    version: str,
) -> str:
    safe_upload = _safe(upload_id)
    loan_id = loan.get("id") or (str(loan.get("sheet") or "") + "-" + str(loan.get("excelRow") or ""))
    filename = _safe(loan_id) + ".md"
    path = TRACES / "step5" / safe_upload / filename
    path.parent.mkdir(parents=True, exist_ok=True)
    meta = book.meta
    lines = [
        "# 债项风险暴露划分留痕：" + str(loan_id),
        "",
        "- 生成时间：" + datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "- 上传批次：" + str(upload_id),
        "- 规则版本：" + (version or str(meta.get("ruleVersion") or "—")),
        "- 工作表：" + str(loan.get("sheet") or "—"),
        "- Excel 行：" + str(loan.get("excelRow") or "—"),
        "- 客户：" + str(loan.get("customer") or "—"),
        "- 名称：" + str(loan.get("name") or "—"),
        "- 产品（第三步）：" + book.label + "（" + (book.code or "未识别") + "）",
        "- 规则文档（数据库）：" + str(meta.get("name") or "—")
        + " · " + str(meta.get("title") or "—")
        + " · 标签「" + str(meta.get("label") or "通用") + "」"
        + " · 版本 " + str(meta.get("ruleVersion") or "—")
        + " · id " + str(meta.get("id") or "—"),
        "- 产品规则匹配：" + str(meta.get("matchedBy") or "—"),
        "",
        "## 一、第四步字段映射与取值",
        "",
        *_mapping_table(mapping_rows),
        "",
        "## 二、规则字段覆盖",
        "",
        *_field_coverage(book, facts),
        "",
        "## 三、规则文档解析",
        "",
        *_document_outline(book),
        "",
        "## 四、逐条判定",
        "",
        *_steps_table(hit.get("steps") or []),
        "",
        "## 五、结论",
        "",
        "- 建议暴露大类：" + str(hit.get("category") or "未归类"),
        "- 建议暴露子类：" + str(hit.get("subclass") or "—"),
        "- 建议风险权重：" + (str(hit.get("rw_text") or "") or "未定权重"),
        "- 命中规则路径：" + str(hit.get("path") or "未命中"),
        "- 命中规则 ID：" + str(hit.get("rule_id") or "—"),
        "- 债项金额：" + ("—" if amount is None else f"{amount:,.2f}"),
        "- 指示性 RWA（金额 × 权重）：" + ("—" if rwa is None else f"{rwa:,.2f}"),
        "- 分类状态：" + {"ok": "正常", "warning": "待复核", "exception": "异常"}.get(status, status),
        "",
        "## 六、说明",
        "",
    ]
    notes = []
    if not loan.get("product"):
        notes.append("第三步没有识别出产品，只能使用通用规则。")
    if not hit.get("steps"):
        notes.append("规则树没有命中任何风险暴露类型。")
    if "未分类" in str(hit.get("path") or "") or "未归类" in str(hit.get("path") or ""):
        notes.append("命中的是兜底节点。兜底权重只能用于提示，不能直接当作计量结果，需要回溯缺失字段或异常取值。")
    if hit.get("rw") is None:
        notes.append("命中的档位没有固定权重，需要在后续步骤人工确认后再计算。")
    if amount is None:
        notes.append("第四步没有映射到债项余额，无法给出指示性 RWA。")
    if facts.get("_coerce_failed"):
        notes.append("这些规则字段的来源值无法归一化：" + "、".join(str(item) for item in facts["_coerce_failed"]) + "。")
    if not notes:
        notes.append("规则文档、字段映射和取值都已对上，无需人工补充。")
    lines.extend("- " + item for item in notes)
    lines.append("")
    path.write_text("\n".join(lines), encoding="utf-8")
    return "step5/" + safe_upload + "/" + filename


def classify_loans(payload: dict[str, Any]) -> dict[str, Any]:
    """逐笔分类并写 Markdown 留痕。"""
    upload_id = str(payload.get("uploadId") or "adhoc")
    version = str(payload.get("version") or "")
    documents = payload.get("documents") if isinstance(payload.get("documents"), dict) else {}
    general = payload.get("general") if isinstance(payload.get("general"), dict) else None
    mappings = payload.get("mappings") if isinstance(payload.get("mappings"), dict) else {}
    loans = [item for item in payload.get("loans") or [] if isinstance(item, dict)]
    if not loans:
        raise ValueError("没有可以分类的债项")

    books: dict[str, RuleBook] = {}
    for code in {str(loan.get("product") or "") for loan in loans}:
        raw = documents.get(code)
        if not isinstance(raw, dict):
            raw = general
        if not isinstance(raw, dict):
            raise ValueError("产品 " + (code or "未识别") + " 没有可用的风险暴露划分规则")
        books[code] = _book(code, str(raw.get("productLabel") or ""), raw)

    results = []
    for loan in loans:
        code = str(loan.get("product") or "")
        book = books[code]
        mapping = mappings.get(code) if isinstance(mappings.get(code), list) else []
        facts, amount, rows = _facts(loan, book, mapping)
        hit = classify(book.categories, facts)
        weight = hit.get("rw")
        weight = float(weight) if isinstance(weight, (int, float)) and not isinstance(weight, bool) else None
        rwa = amount * weight if amount is not None and weight is not None else None
        status = _status(loan, hit, facts, amount, weight)
        trace_file = _write_md(
            upload_id, loan, book, rows, facts, hit, amount, rwa, status, version,
        )
        results.append({
            "loanId": loan.get("id"),
            "sheet": loan.get("sheet") or "",
            "excelRow": loan.get("excelRow"),
            "product": code,
            "productLabel": book.label,
            "exposureClass": hit.get("category") or "未归类",
            "exposureSubClass": hit.get("subclass") or "",
            "path": hit.get("path") or "",
            "ruleId": hit.get("rule_id") or "",
            "weight": weight,
            "weightText": hit.get("rw_text") or "",
            "ead": amount,
            "rwa": rwa,
            "status": status,
            "traceFile": trace_file,
            "document": {
                "id": book.meta.get("id"),
                "name": book.meta.get("name") or "",
                "title": book.meta.get("title") or "",
                "label": book.meta.get("label") or "",
                "version": book.meta.get("ruleVersion") or version,
                "matchedBy": book.meta.get("matchedBy") or "",
            },
        })

    by_product: dict[str, dict] = {}
    for item in results:
        bucket = by_product.setdefault(item["product"] or "", {"label": item["productLabel"], "count": 0, "ead": 0.0, "rwa": 0.0})
        bucket["count"] += 1
        bucket["ead"] += item["ead"] or 0
        bucket["rwa"] += item["rwa"] or 0

    return {
        "uploadId": upload_id,
        "version": version,
        "rows": results,
        "summary": {
            "total": len(results),
            "ok": sum(1 for item in results if item["status"] == "ok"),
            "warning": sum(1 for item in results if item["status"] == "warning"),
            "exception": sum(1 for item in results if item["status"] == "exception"),
            "ead": sum(item["ead"] or 0 for item in results),
            "rwa": sum(item["rwa"] or 0 for item in results),
            "byProduct": by_product,
        },
        "traceDir": "step5/" + _safe(upload_id),
    }
