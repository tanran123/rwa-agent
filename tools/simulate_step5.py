"""模拟一批覆盖全部产品类型的债项，调用第五步 classify_loans 并核对结果。

规则文档直接从 sql/002_seed.sql 的 exposure_document 解析，不连数据库。
运行：
    .venv/bin/python tools/simulate_step5.py
    .venv/bin/python tools/simulate_step5.py --json /tmp/step5-sim-payload.json

生成的 Markdown 留痕在 output/traces/step5/SIM-STEP5/。
"""

from __future__ import annotations

import argparse
import ast
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from agent.steps.weight.classify import classify_loans  # noqa: E402


def load_docs() -> dict[int, dict]:
    text = (ROOT / "sql/002_seed.sql").read_text(encoding="utf-8")
    start = text.index("INSERT INTO exposure_document")
    start = text.index("VALUES", start) + len("VALUES")
    end = text.index(";\n", start)
    block = text[start:end]
    tuples: list[str] = []
    depth = 0
    in_quote = False
    buf: list[str] = []
    for ch in block:
        if ch == "'":
            in_quote = not in_quote
            buf.append(ch)
        elif not in_quote and ch == "(":
            depth += 1
            if depth == 1:
                buf = ["("]
            else:
                buf.append(ch)
        elif not in_quote and ch == ")":
            depth -= 1
            buf.append(ch)
            if depth == 0:
                tuples.append("".join(buf))
        elif depth >= 1:
            buf.append(ch)
    docs = {}
    for item in tuples:
        values = ast.literal_eval(item)
        docs[int(values[0])] = {
            "id": int(values[0]),
            "name": values[1],
            "title": values[2],
            "label": values[3],
            "ruleVersion": values[6],
            "body": json.loads(values[7]),
        }
    return docs


def field(rule_field: str, column: str, std_field: str = "", code: str = "", required: bool = False) -> dict:
    return {
        "stdField": std_field or column,
        "stdCode": code,
        "ruleField": rule_field,
        "column": column,
        "required": required,
    }


MAPPINGS = {
    "corp_loan": [
        field("balance", "债项余额", "债项余额", "bal", True),
        field("counterparty_type", "交易对手类型", "交易对手类型", "cpt", True),
        field("credit_quality_grade", "信用等级", "信用质量等级"),
        field("short_term_grade", "短期等级", "短期信用质量等级"),
        field("original_maturity_months", "剩余期限", "剩余期限", "mat", True),
        field("is_fully_secured_by_residential", "住宅全额抵押", "是否住宅物业全额担保"),
        field("is_owner_occupied", "自用", "是否借款自用"),
        field("is_past_due", "是否逾期", "是否逾期"),
        field("is_overdue_90d", "逾期超90天", "是否逾期超过90天"),
        field("is_unsecured_portion", "无抵押部分", "是否无抵押部分"),
        field("provision_ratio_past_due", "拨备比例", "特定拨备占未偿还金额比例"),
    ],
    "personal_loan": [
        field("balance", "债项余额", "债项余额", "bal", True),
        field("counterparty_type", "交易对手类型", "交易对手类型", "cpt", True),
        field("single_exposure", "单一债务人暴露", "对单一债务人风险暴露", "sng", True),
        field("exposure_share", "占全行比例", "占全行信用风险暴露比例", "shr", True),
        field("meets_retail_form", "零售形式", "敞口形式属零售"),
        field("is_well_diversified", "充分分散", "组合充分分散"),
        field("retail_aggregate_exposure", "零售合计", "单一交易对手合计零售敞口"),
        field("is_sme_loan", "中小企业", "是否中小企业贷款"),
    ],
    "bond": [
        field("balance", "债券余额", "债券余额", "bal", True),
        field("industry", "行业", "行业分类"),
        field("credit_quality_grade", "信用等级", "信用质量等级"),
        field("short_term_grade", "短期等级", "短期信用质量等级"),
        field("residual_maturity_months", "剩余期限", "剩余期限"),
        field("is_local_currency_funded", "本币融资", "以当地货币计价并融资"),
        field("is_mdb_zero_list", "表4清单", "是否属表4机构清单"),
        field("sovereign_grade_of_pse", "主权等级", "PSE所在辖区主权等级"),
        field("is_quasi_sovereign_rating", "准主权评级", "是否获准用本币评级"),
        field("instrument_type", "债券类别", "债券类别", "cat", True),
        field("counterparty_type", "发行人类型", "发行人类型", "itp", True),
        field("issuer_rating", "发行人评级", "发行人评级", "rat"),
    ],
    "ib_call": [
        field("balance", "余额", "余额", "bal", True),
        field("counterparty_type", "交易对手类型", "交易对手类型", "cpt", True),
        field("issuer_rating", "交易对手评级", "交易对手评级", "rat", True),
        field("short_term_grade", "短期等级", "短期信用质量等级"),
        field("original_maturity_months", "剩余期限", "原到期月数"),
    ],
    "ib_time": [
        field("balance", "余额", "余额", "bal", True),
        field("counterparty_type", "交易对手类型", "交易对手类型", "cpt", True),
        field("original_maturity_months", "存放期", "整个存放期", "term", True),
        field("issuer_rating", "交易对手评级", "交易对手评级", "rat", True),
        field("short_term_grade", "短期等级", "短期信用质量等级"),
        field("credit_quality_grade", "信用等级", "信用质量等级"),
    ],
    "due_from_bank": [
        field("balance", "余额", "余额", "bal", True),
        field("counterparty_type", "交易对手类型", "交易对手类型", "cpt", True),
        field("original_maturity_months", "存放期", "整个存放期", "term", True),
        field("credit_quality_grade", "信用等级", "信用质量等级"),
        field("short_term_grade", "短期等级", "短期信用质量等级"),
    ],
    "off_bs": [
        field("balance", "授信总额度", "授信总额度", "tot", True),
        field("counterparty_type", "交易对手类型", "交易对手类型", "cpt", True),
        field("credit_quality_grade", "信用等级", "信用质量等级"),
        field("original_maturity_months", "剩余期限", "原到期月数"),
        field("short_term_grade", "短期等级", "短期信用质量等级"),
    ],
    "other_credit": [
        field("balance", "余额", "余额", "bal", True),
        field("instrument_type", "工具类型", "工具类型", "itp", True),
        field("counterparty_type", "交易对手类型", "交易对手类型", "cpt", True),
        field("credit_quality_grade", "信用等级", "信用质量等级"),
    ],
}

PRODUCT_LABELS = {
    "corp_loan": "对公贷款",
    "personal_loan": "个人贷款",
    "bond": "债券投资",
    "ib_call": "同业活期",
    "ib_time": "同业定期",
    "due_from_bank": "存放同业",
    "off_bs": "表外授信及承诺",
    "other_credit": "其他信用风险暴露",
}

# 产品标签 -> 规则文档 id，与 Koa documentMatchForProduct 的标签包含结果一致。
PRODUCT_DOC = {
    "corp_loan": 3,
    "personal_loan": 3,
    "bond": 4,
    "ib_call": 2,
    "ib_time": 2,
    "due_from_bank": 2,
    "off_bs": 2,
    "other_credit": 2,
}


def loan(loan_id: str, product: str, raw: dict, expect_class: str, expect_sub: str, expect_weight: float | None) -> dict:
    return {
        "id": loan_id,
        "sheet": "term-Loan" if product in {"corp_loan", "personal_loan"} else "明细",
        "excelRow": 0,
        "customer": "CUST-" + loan_id,
        "name": "模拟客户-" + loan_id,
        "product": product,
        "raw": raw,
        "std": {},
        "expect": {
            "class": expect_class,
            "sub": expect_sub,
            "weight": expect_weight,
        },
    }


LOANS = [
    # 对公贷款：贷款规则
    loan("corp-grade1", "corp_loan",
         {"债项余额": 5_000_000, "交易对手类型": "公司", "信用等级": "1", "剩余期限": 24},
         "公司债权", "等级1", 0.20),
    loan("corp-unrated", "corp_loan",
         {"债项余额": 3_000_000, "交易对手类型": "公司", "剩余期限": 24},
         "公司债权", "未评级", 1.00),
    loan("corp-grade3", "corp_loan",
         {"债项余额": 2_000_000, "交易对手类型": "公司", "信用等级": "3", "剩余期限": 24},
         "公司债权", "BBB+至BBB-一般公司债", 0.75),
    loan("corp-residential", "corp_loan",
         {"债项余额": 4_000_000, "交易对手类型": "公司", "剩余期限": 240,
          "住宅全额抵押": "是", "自用": "是", "逾期超90天": "否"},
         "以住宅物业抵押的债权", "自用且未逾期超90天", 0.50),
    loan("corp-pastdue", "corp_loan",
         {"债项余额": 1_500_000, "交易对手类型": "公司", "剩余期限": 12,
          "是否逾期": "是", "逾期超90天": "是", "无抵押部分": "是",
          "住宅全额抵押": "否", "拨备比例": 0.10},
         "逾期贷款", "特定拨备低于20%", 1.50),
    loan("corp-bank", "corp_loan",
         {"债项余额": 8_000_000, "交易对手类型": "商业银行", "剩余期限": 12},
         "银行债权", "未评级", 0.50),

    # 个人贷款：贷款规则
    loan("personal-retail", "personal_loan",
         {"债项余额": 8_000_000, "交易对手类型": "自然人", "单一债务人暴露": 8_000_000,
          "占全行比例": 0.003, "零售形式": "是", "充分分散": "是",
          "零售合计": 8_000_000, "中小企业": "否"},
         "监管零售组合", "一般监管零售组合债权", 0.75),
    loan("personal-sme", "personal_loan",
         {"债项余额": 12_000_000, "交易对手类型": "自然人", "单一债务人暴露": 12_000_000,
          "占全行比例": 0.004, "零售形式": "是", "充分分散": "是",
          "零售合计": 12_000_000, "中小企业": "是"},
         "监管零售组合", "超过门槛的中小企业贷款", 0.85),
    loan("personal-missing", "personal_loan",
         {"债项余额": 500_000, "交易对手类型": "自然人"},
         "其他表内敞口", "其他非逾期表内敞口", 1.00),

    # 债券投资：债券规则
    loan("bond-sovereign-grade1", "bond",
         {"债券余额": 20_000_000, "行业": "sovereign", "信用等级": "1", "剩余期限": 24},
         "主权及政府类债券", "等级1", 0.00),
    loan("bond-corp-grade3", "bond",
         {"债券余额": 10_000_000, "行业": "corp", "信用等级": "3", "剩余期限": 60},
         "公司债券", "BBB+至BBB-一般公司债", 0.75),
    loan("bond-bank-grade2", "bond",
         {"债券余额": 15_000_000, "行业": "bank", "信用等级": "2", "剩余期限": 12},
         "银行债券", "A+至A-一般银行债", 0.30),
    loan("bond-mdb-zero", "bond",
         {"债券余额": 5_000_000, "行业": "mdbs", "表4清单": "是"},
         "多边开发银行及其他国际组织债券", "表4机构清单", 0.00),
    loan("bond-pse", "bond",
         {"债券余额": 3_000_000, "行业": "pses", "主权等级": "6"},
         "公共部门实体债券", "澳门公共企业", 0.50),

    # 同业活期 / 定期 / 存放同业 / 表外：通用规则
    loan("ib-call-short-I", "ib_call",
         {"余额": 10_000_000, "交易对手类型": "商业银行", "短期等级": "I", "剩余期限": 2},
         "银行债权", "短期等级I", 0.20),
    loan("ib-call-unrated", "ib_call",
         {"余额": 6_000_000, "交易对手类型": "商业银行", "剩余期限": 12},
         "银行债权", "未评级", 0.50),
    loan("ib-call-otherfi", "ib_call",
         {"余额": 4_000_000, "交易对手类型": "其他金融机构", "剩余期限": 12},
         "股权及其他表内敞口", "其他非逾期表内敞口", 1.00),

    loan("ib-time-short-II", "ib_time",
         {"余额": 7_000_000, "交易对手类型": "商业银行", "存放期": 2, "短期等级": "II"},
         "银行债权", "短期等级II", 0.50),
    loan("ib-time-grade1", "ib_time",
         {"余额": 9_000_000, "交易对手类型": "商业银行", "存放期": 12, "信用等级": "1"},
         "银行债权", "等级1", 0.20),
    loan("ib-time-unrated", "ib_time",
         {"余额": 3_000_000, "交易对手类型": "商业银行", "存放期": 12},
         "银行债权", "未评级", 0.50),

    loan("due-grade2", "due_from_bank",
         {"余额": 12_000_000, "交易对手类型": "商业银行", "存放期": 12, "信用等级": "2"},
         "银行债权", "A+至A-一般银行债", 0.30),
    loan("due-short-III", "due_from_bank",
         {"余额": 2_000_000, "交易对手类型": "商业银行", "存放期": 2, "短期等级": "III"},
         "银行债权", "短期等级III", 1.00),

    loan("off-corp-grade1", "off_bs",
         {"授信总额度": 5_000_000, "交易对手类型": "公司", "信用等级": "1", "剩余期限": 12},
         "公司债权", "等级1", 0.20),
    loan("off-bank-unrated", "off_bs",
         {"授信总额度": 6_000_000, "交易对手类型": "商业银行", "剩余期限": 12},
         "银行债权", "未评级", 0.50),
    loan("off-individual", "off_bs",
         {"授信总额度": 1_000_000, "交易对手类型": "自然人", "剩余期限": 12},
         "股权及其他表内敞口", "其他非逾期表内敞口", 1.00),

    # 其他信用风险暴露：通用规则
    loan("other-equity", "other_credit",
         {"余额": 2_000_000, "工具类型": "股权"},
         "股权及其他表内敞口", "股权类资产", 1.00),
    loan("other-claim-corp", "other_credit",
         {"余额": 4_000_000, "工具类型": "债权", "交易对手类型": "公司", "信用等级": "2"},
         "公司债权", "等级2", 0.50),
    loan("other-claim-bank", "other_credit",
         {"余额": 3_000_000, "工具类型": "债权", "交易对手类型": "商业银行", "信用等级": "1"},
         "银行债权", "等级1", 0.20),
]


def build_payload(docs: dict[int, dict]) -> dict:
    documents = {}
    for code, doc_id in PRODUCT_DOC.items():
        doc = docs[doc_id]
        documents[code] = {
            "id": doc["id"],
            "name": doc["name"],
            "title": doc["title"],
            "label": doc["label"],
            "ruleVersion": doc["ruleVersion"],
            "matchedBy": "模拟：" + PRODUCT_LABELS[code] + " → 规则文档标签「" + (doc["label"] or "通用") + "」",
            "productLabel": PRODUCT_LABELS[code],
            "body": doc["body"],
        }
    return {
        "uploadId": "SIM-STEP5",
        "version": "MO-SA-2026.1",
        "documents": documents,
        "general": documents.get("ib_call"),
        "mappings": MAPPINGS,
        "loans": LOANS,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="模拟第五步暴露分类")
    parser.add_argument("--json", help="把本次 payload 写到这个路径")
    args = parser.parse_args()

    docs = load_docs()
    payload = build_payload(docs)
    if args.json:
        Path(args.json).write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    out = classify_loans(payload)

    print("模拟债项:", len(out["rows"]), " 产品类型:", len(PRODUCT_LABELS))
    print()
    header = f"{'债项':<24}{'产品':<14}{'大类':<24}{'子类':<28}{'权重':>8}  {'状态':<10} 核对"
    print(header)
    print("-" * len(header))
    passed = 0
    for row in out["rows"]:
        expect = next(item["expect"] for item in LOANS if item["id"] == row["loanId"])
        actual_weight = row["weight"]
        ok = (
            row["exposureClass"] == expect["class"]
            and row["exposureSubClass"] == expect["sub"]
            and actual_weight == expect["weight"]
        )
        passed += 1 if ok else 0
        print(
            f"{row['loanId']:<24}{row['productLabel']:<12}"
            f"{row['exposureClass']:<22}{row['exposureSubClass']:<26}"
            f"{(row['weightText'] or '—'):>8}  {row['status']:<10} "
            + ("通过" if ok else f"不符（期望 {expect['class']} / {expect['sub']} / {expect['weight']}）")
        )
    print("-" * len(header))
    print(f"核对：{passed}/{len(out['rows'])} 通过")
    print("汇总：", json.dumps(out["summary"], ensure_ascii=False))
    print("留痕：", "output/traces/" + out["traceDir"])


if __name__ == "__main__":
    main()
