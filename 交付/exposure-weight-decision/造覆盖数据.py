"""按权重法决策树的每一个末端分支造一行明细。

前 25 列与同业底稿一致。分类要用、底稿里没有的字段，接在 Country Code 后面，表头写成「中文名（字段编号）」。
"""

from __future__ import annotations

import copy
from datetime import date, timedelta
from pathlib import Path

from openpyxl import Workbook

from rwa_agent.exposure_class import class_fields, prototype_flow
from rwa_agent.paper_calc import _classify, _cond, _when, _walk

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "samples" / "同业_模拟.xlsx"

TONGYE_HEADERS = [
    "GL A/C No.",
    "Account Name",
    "Accounting Centre No.",
    "Customer",
    "Customer Name",
    "Contract",
    "Product Code",
    "Currency Code",
    "Value Date",
    "Next Settlement Date",
    "Last Settlement Date",
    "Maturity Date",
    "Rest Period",
    "Value Balance",
    "Value Balance(MOP)",
    "Interest Revenue Balance",
    "Interest Revenue Balance(MOP)",
    "Interest Expense Balance",
    "Interest Expense Balance(MOP)",
    "Interest Rate Flag",
    "Interest Rate",
    "value date",
    "Maturity Date",
    "rest period",
    "Country Code",
]


def _leaves(nodes: list) -> list[dict]:
    found = []
    for node in nodes or []:
        children = node.get("children") or []
        if children:
            found.extend(_leaves(children))
        else:
            found.append(node)
    return found


def _index(nodes: list, parent: dict | None, parents: dict) -> None:
    for node in nodes or []:
        parents[id(node)] = parent
        _index(node.get("children") or [], node, parents)


def _find(nodes: list, target: str, acc: list) -> list | None:
    for node in nodes or []:
        here = acc + [node]
        if node.get("id") == target:
            return here
        found = _find(node.get("children") or [], target, here)
        if found:
            return found
    return None


def _step(value: float) -> float:
    return 1.0 if abs(value) >= 1000 else 0.01


def _satisfy(match: object, facts: dict) -> None:
    if not isinstance(match, dict):
        return
    if isinstance(match.get("all"), list):
        for item in match["all"]:
            _satisfy(item, facts)
        return
    if isinstance(match.get("any"), list):
        if _when(match, facts):
            return
        if match["any"]:
            _satisfy(match["any"][0], facts)
        return
    field = match.get("field")
    if not field:
        return
    op = match.get("op") or "eq"
    value = match.get("value")
    if op == "contains":
        current = facts.get(field)
        if not isinstance(current, list):
            current = []
        if value not in current:
            current = current + [value]
        facts[field] = current
        return
    if op in {"lte", "lt", "gte", "gt"}:
        facts[field] = _fit(facts.get(field), op, float(value))
        return
    if op == "in":
        pool = value if isinstance(value, list) else [value]
        current = facts.get(field)
        if any(current == item or str(current) == str(item) for item in pool):
            return
        facts[field] = pool[0]
        return
    if op == "eq":
        current = facts.get(field)
        if current == value or str(current) == str(value):
            return
        facts[field] = value
        return
    if op == "neq" and facts.get(field) in (None, value):
        facts[field] = "yes" if value == "no" else "no"


def _fit(current: object, op: str, value: float) -> float:
    gap = _step(value)
    if not isinstance(current, (int, float)):
        if op == "lte":
            return value
        if op == "lt":
            return value - gap
        if op == "gte":
            return value
        return value + gap
    number = float(current)
    if op == "lte":
        return min(number, value)
    if op == "lt":
        return min(number, value - gap)
    if op == "gte":
        return max(number, value)
    return max(number, value + gap)


def _avoid_skip(node: dict, facts: dict) -> None:
    skip = node.get("skip") or {}
    field = skip.get("field")
    if not field:
        return
    cond = {"field": field, "op": skip.get("op") or "eq", "value": skip.get("match")}
    if _cond(cond, facts):
        facts.pop(field, None)


def _atoms(match: object) -> list[dict]:
    if not isinstance(match, dict):
        return []
    if isinstance(match.get("all"), list):
        found = []
        for item in match["all"]:
            found.extend(_atoms(item))
        return found
    if isinstance(match.get("any"), list):
        found = []
        for item in match["any"]:
            found.extend(_atoms(item))
        return found
    if match.get("field"):
        return [match]
    return []


def _landed(categories: list, facts: dict) -> tuple[str, float | None]:
    hit = _classify(categories, facts)
    rule = ""
    for item in hit.get("steps") or []:
        if item.get("stage") == "权重":
            rule = str(item.get("rule") or "")
    rw = hit.get("rw")
    return rule, float(rw) if isinstance(rw, float) else None


def _path_holds(categories: list, facts: dict, target: str) -> bool:
    return _landed(categories, facts)[0] == target


def _push_out(cond: dict, facts: dict) -> bool:
    field = cond.get("field")
    if not field:
        return False
    op = cond.get("op") or "eq"
    value = cond.get("value")
    if op == "eq":
        if value == "yes":
            facts[field] = "no"
        elif value == "no":
            facts[field] = "yes"
        elif value == "applicable":
            facts[field] = "not_applicable"
        elif value == "not_applicable":
            facts[field] = "applicable"
        else:
            facts.pop(field, None)
        return True
    if op == "neq":
        facts[field] = value
        return True
    if op == "in":
        facts.pop(field, None)
        return True
    if op == "contains":
        facts[field] = []
        return True
    if op in {"lte", "lt", "gte", "gt"}:
        try:
            number = float(value)
        except (TypeError, ValueError):
            facts.pop(field, None)
            return True
        gap = _step(number)
        if op == "lte":
            facts[field] = number + gap
        elif op == "lt":
            facts[field] = number
        elif op == "gte":
            facts[field] = number - gap
        else:
            facts[field] = number
        return True
    facts.pop(field, None)
    return True


def _option_codes(field: str) -> list:
    for item in class_fields():
        if item["id"] == field:
            return [opt.get("code") for opt in item.get("options") or [] if opt.get("code") is not None]
    return []


def _accept(categories: list, match: object, trial: dict, target: str, facts: dict) -> bool:
    if _when(match, trial):
        return False
    _resatisfy(trial, target, categories)
    if _when(match, trial) or not _path_holds(categories, trial, target):
        return False
    facts.clear()
    facts.update(trial)
    return True


def _falsify(categories: list, match: object, facts: dict, target: str) -> bool:
    if not _when(match, facts):
        return True
    origin = copy.deepcopy(facts)
    for cond in _atoms(match):
        field = cond.get("field")
        trial = copy.deepcopy(origin)
        if _push_out(cond, trial) and _accept(categories, match, trial, target, facts):
            return True
        trial = copy.deepcopy(origin)
        trial.pop(field, None)
        if _accept(categories, match, trial, target, facts):
            return True
        current = origin.get(field)
        for code in _option_codes(str(field or "")):
            if code == current or str(code) == str(current):
                continue
            trial = copy.deepcopy(origin)
            trial[field] = code
            if _accept(categories, match, trial, target, facts):
                return True
    return False


def _resatisfy(facts: dict, target: str, categories: list) -> None:
    path = _find(categories, target, []) or []
    for node in path:
        if not node.get("otherwise"):
            _satisfy(node.get("match"), facts)
        _avoid_skip(node, facts)


def _clear_earlier(categories: list, facts: dict, target: str, parents: dict) -> str:
    path = _find(categories, target, []) or []
    for node in path:
        parent = parents.get(id(node))
        siblings = categories if parent is None else (parent.get("children") or [])
        for sib in siblings:
            if sib.get("id") == node.get("id"):
                break
            if sib.get("otherwise"):
                continue
            if _when(sib.get("match"), facts) and not _falsify(categories, sib.get("match"), facts, target):
                return str(sib.get("id") or "")
    return ""


def _prune(categories: list, facts: dict, target: str) -> None:
    signature = _landed(categories, facts)
    for key in list(facts):
        saved = facts[key]
        facts.pop(key)
        if _landed(categories, facts) != signature:
            facts[key] = saved


def _weight_type(node: dict) -> str:
    return str(((node.get("then") or {}).get("risk_weight") or {}).get("type") or "")


def build_rows() -> tuple[list[dict], list[str]]:
    categories = prototype_flow()["categories"]
    parents: dict = {}
    _index(categories, None, parents)
    rows = []
    missed = []
    for leaf in _leaves(categories):
        target = str(leaf.get("id") or "")
        facts: dict = {}
        _resatisfy(facts, target, categories)
        blocked = _clear_earlier(categories, facts, target, parents)
        rule, priced = _landed(categories, facts)
        if rule != target:
            missed.append(target + (" 被 " + blocked + " 挡住" if blocked else " 落到 " + (rule or "空")))
            continue
        if _weight_type(leaf) in {"counterparty", "max"} and "counterparty_type" not in facts:
            for party in ("corporate", "individual", "commercial_bank"):
                trial = dict(facts)
                trial["counterparty_type"] = party
                again, again_rw = _landed(categories, trial)
                if again == target and isinstance(again_rw, float):
                    facts = trial
                    priced = again_rw
                    break
        if _weight_type(leaf) == "const" and not isinstance(priced, float):
            missed.append(target + " 没有落到固定权重")
            continue
        _prune(categories, facts, target)
        rows.append({
            "id": target,
            "label": str(leaf.get("label") or target),
            "path": " · ".join(str(node.get("label") or "") for node in (_find(categories, target, []) or [])),
            "facts": facts,
            "weight": ((leaf.get("then") or {}).get("risk_weight") or {}).get("display") or "",
        })
    return rows, missed


def _amount_for(facts: dict) -> float:
    amount = 100_000_000.0
    exposure = facts.get("single_exposure")
    if isinstance(exposure, (int, float)) and exposure > 0:
        amount = float(exposure)
    share = facts.get("exposure_share")
    if isinstance(share, (int, float)) and share <= 0.005:
        amount = min(amount, 1_000_000.0)
    return amount


def _with_book(facts: dict, amount: float, total: float) -> dict:
    ready = dict(facts)
    ready["single_exposure"] = amount
    ready["exposure_share"] = amount / total if total else 0.0
    return ready


def assign_amounts(rows: list[dict]) -> list[str]:
    categories = prototype_flow()["categories"]
    for row in rows:
        row["amount"] = _amount_for(row["facts"])
    problems = []
    for _ in range(6):
        total = sum(row["amount"] for row in rows) or 1.0
        problems = []
        for row in rows:
            ready = _with_book(row["facts"], row["amount"], total)
            rule, _priced = _landed(categories, ready)
            if rule == row["id"]:
                continue
            share = row["facts"].get("exposure_share")
            exposure = row["facts"].get("single_exposure")
            if isinstance(share, (int, float)) and share <= 0.005:
                row["amount"] = min(row["amount"], 100_000.0)
            elif isinstance(exposure, (int, float)) and exposure > 10_000_000:
                row["amount"] = max(row["amount"], float(exposure))
            else:
                problems.append(row["id"] + " 按账面重算后落到 " + (rule or "空"))
        else:
            if not problems:
                break
    total = sum(row["amount"] for row in rows) or 1.0
    still = []
    for row in rows:
        ready = _with_book(row["facts"], row["amount"], total)
        rule, _priced = _landed(categories, ready)
        if rule != row["id"]:
            still.append(row["id"] + " 按账面重算后落到 " + (rule or "空"))
    return still


def _cell_value(value: object) -> object:
    if isinstance(value, list):
        return ",".join(str(item) for item in value)
    if isinstance(value, float) and value.is_integer() and abs(value) >= 1000:
        return int(value)
    return value


def write_book(rows: list[dict]) -> None:
    fields = class_fields()
    labels = {item["id"]: item["label"] for item in fields}
    used = []
    # 账面余额和占比由计算按金额得出，不能再占掉金额列。
    derived = {"single_exposure", "exposure_share"}
    for row in rows:
        for key in row["facts"]:
            if key not in used and key in labels and key not in derived:
                used.append(key)
    book = Workbook()
    sheet = book.active
    sheet.title = "Sheet1"
    headers = TONGYE_HEADERS + [f"{labels[fid]}（{fid}）" for fid in used]
    sheet.append([None] * len(headers))
    sheet.append(headers)
    base = date(2026, 9, 29)
    for index, row in enumerate(rows, 1):
        facts = row["facts"]
        months = facts.get("original_maturity_months")
        term_months = float(months) if isinstance(months, (int, float)) and months > 0 else 3.0
        days = max(1, int(round(term_months * 30)))
        mature = base + timedelta(days=days)
        amount = _cell_value(row["amount"])
        excel_row = index + 2
        party = str(facts.get("counterparty_type") or "")
        # 212、222 会被认成存放同业。只有本来就是商业银行的分支才用这两个科目。
        gl = 2120000100 + index if party == "commercial_bank" else 1410000100 + index
        values = [
            gl,
            row["label"],
            80101000110,
            f"8000{index:06d}",
            row["path"],
            f"{5530 + index:05d}PL",
            "ILP1" if index % 2 else "ILP2",
            "MOP",
            int(base.strftime("%Y%m%d")),
            "00000000",
            "00000000",
            int(mature.strftime("%Y%m%d")),
            days,
            amount,
            amount,
            0,
            0,
            0,
            0,
            None,
            1.5,
            f"=DATE(LEFT(I{excel_row},4),MID(I{excel_row},5,2),MID(I{excel_row},7,2))",
            f"=DATE(LEFT(L{excel_row},4),MID(L{excel_row},5,2),MID(L{excel_row},7,2))",
            f"=W{excel_row}-V{excel_row}",
            "MO",
        ]
        for fid in used:
            values.append(_cell_value(facts.get(fid, "")))
        sheet.append(values)
    sheet.freeze_panes = "A3"
    sheet.auto_filter.ref = f"A2:{sheet.dimensions.split(':')[-1]}"
    sheet.column_dimensions["B"].width = 28
    sheet.column_dimensions["E"].width = 64
    book.save(OUT)


def main() -> None:
    rows, missed = build_rows()
    drifted = assign_amounts(rows)
    write_book(rows)
    print("末端", len(_leaves(prototype_flow()["categories"])))
    print("写成", len(rows), OUT.name)
    if missed:
        print("没造出来", len(missed))
        for item in missed:
            print(" -", item)
    if drifted:
        print("金额改写后对不上", len(drifted))
        for item in drifted:
            print(" -", item)


if __name__ == "__main__":
    main()
