"""逐笔调试第五步信用风险暴露分类，不经过 Koa 和浏览器。

用法：
    .venv/bin/python tools/debug_step5.py /tmp/step5-payload.json
    .venv/bin/python tools/debug_step5.py /tmp/step5-payload.json --trace
    .venv/bin/python tools/debug_step5.py /tmp/step5-payload.json --json
    .venv/bin/python tools/debug_step5.py /tmp/step5-payload.json --pdb

怎么拿到真实 payload：
    在 server/src/measure.js 的 runClassifyLoans(payload) 开头临时加一行：
        if (process.env.STEP5_DUMP) writeFileSync(process.env.STEP5_DUMP, JSON.stringify(payload, null, 2));
    用 STEP5_DUMP=/tmp/step5-payload.json 重启 rwa-api，再在页面上点一次第五步。
"""

from __future__ import annotations

import argparse
import json
import pdb
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from agent.core.weight.exposure import classify  # noqa: E402
from agent.steps.weight.classify import _book, _facts, _status, classify_loans  # noqa: E402


def _money(value: object) -> str:
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        return "—"
    return f"{float(value):,.2f}"


def _load(payload_path: str) -> dict:
    return json.loads(Path(payload_path).read_text(encoding="utf-8"))


def _books(payload: dict) -> dict:
    documents = payload.get("documents") if isinstance(payload.get("documents"), dict) else {}
    general = payload.get("general") if isinstance(payload.get("general"), dict) else None
    loans = [item for item in payload.get("loans") or [] if isinstance(item, dict)]
    books = {}
    for code in {str(loan.get("product") or "") for loan in loans}:
        raw = documents.get(code)
        if not isinstance(raw, dict):
            raw = general
        if not isinstance(raw, dict):
            raise SystemExit("产品 " + (code or "未识别") + " 没有规则文档（检查 documents / general）")
        books[code] = _book(code, str(raw.get("productLabel") or ""), raw)
    return books


def _explain(payload: dict) -> None:
    loans = [item for item in payload.get("loans") or [] if isinstance(item, dict)]
    mappings = payload.get("mappings") if isinstance(payload.get("mappings"), dict) else {}
    books = _books(payload)
    print("批次:", payload.get("uploadId"), " 规则版本:", payload.get("version"), " 债项:", len(loans))
    for loan in loans:
        code = str(loan.get("product") or "")
        book = books[code]
        mapping = mappings.get(code) if isinstance(mappings.get(code), list) else []
        facts, amount, rows = _facts(loan, book, mapping)
        hit = classify(book.categories, facts)
        weight = hit.get("rw")
        status = _status(loan, hit, facts, amount, weight)
        print("\n" + "=" * 78)
        print("债项:", loan.get("id"), "| 工作表:", loan.get("sheet"), "| Excel 行:", loan.get("excelRow"))
        print("产品:", code, "|", book.label)
        print("规则文档:", "id=" + str(book.meta.get("id")), "|", book.meta.get("name"), "|",
              book.meta.get("title"), "| 标签", book.meta.get("label"), "| 版本", book.meta.get("ruleVersion"))
        print("匹配依据:", book.meta.get("matchedBy"))
        print("-- 字段映射 --")
        for row in rows:
            print(
                "  {ruleField:<32} <- {column:<18} raw={raw!r:<18} value={value!r:<18} {source} {note}".format(
                    ruleField=row.get("ruleField") or "",
                    column=row.get("column") or "",
                    raw=row.get("raw"),
                    value=row.get("value"),
                    source=row.get("source") or "",
                    note=("| " + row.get("note")) if row.get("note") else "",
                )
            )
        print("-- facts --")
        print("  " + json.dumps({k: v for k, v in facts.items() if not str(k).startswith("_")}, ensure_ascii=False))
        print("-- 规则判定 --")
        print("  大类:", hit.get("category"), "| 子类:", hit.get("subclass"), "| 权重:", hit.get("rw_text") or "未定")
        print("  路径:", hit.get("path"), "| rule_id:", hit.get("rule_id"))
        for step in hit.get("steps") or []:
            print("   ", step.get("stage"), step.get("title"), "|", step.get("rule"),
                  "|", step.get("field"), step.get("op"), step.get("expected"), "=>", step.get("actual"),
                  "| 命中", step.get("hit"), "|", step.get("result"))
        print("-- 结论 --")
        print("  金额:", _money(amount), "| 指示性 RWA:",
              _money(amount * weight) if isinstance(weight, (int, float)) and amount is not None else "—",
              "| 状态:", status)


def main() -> None:
    parser = argparse.ArgumentParser(description="逐笔调试第五步暴露分类")
    parser.add_argument("payload", help="Koa 发给 classify_loans 的 JSON 文件")
    parser.add_argument("--trace", action="store_true", help="跑完后打印每笔 Markdown 留痕")
    parser.add_argument("--json", action="store_true", help="打印 classify_loans 原始返回")
    parser.add_argument("--pdb", action="store_true", help="进入 classify_loans 前停住")
    args = parser.parse_args()

    payload = _load(args.payload)
    _explain(payload)

    if args.pdb:
        pdb.set_trace()

    out = classify_loans(payload)
    print("\n" + "=" * 78)
    print("-- 汇总 --")
    print(json.dumps(out.get("summary") or {}, ensure_ascii=False, indent=1))
    if args.json:
        print(json.dumps(out, ensure_ascii=False, indent=1))
    if args.trace:
        for row in out.get("rows") or []:
            trace = row.get("traceFile") or ""
            path = ROOT / "output" / "traces" / trace
            print("\n" + "=" * 78)
            print("#", path)
            print(path.read_text(encoding="utf-8") if path.exists() else "（留痕文件不存在）")


if __name__ == "__main__":
    main()
