import { createRequire } from "module";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { eadConfigMap } from "./eadConfig.js";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { writeXlsx } = require(path.join(root, "server/lib/xlsx-writer.cjs"));
let cached = null;

function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function suggestMapping(productCode, headers, master) {
  const fields = (master.PRODUCT_FIELDS && master.PRODUCT_FIELDS[productCode]) || [];
  const preset = (master.FIELD_MAPPINGS && master.FIELD_MAPPINGS[productCode]) || [];
  const hs = (headers || []).map((item) => String(item));
  return fields.map((field) => {
    const pre = preset.find((item) => item.stdField === field.name);
    if (pre && pre.srcField && pre.srcField !== "—") {
      const needle = String(pre.srcField).toLowerCase();
      const col = hs.find((item) => item.toLowerCase() === needle)
        || hs.find((item) => item.toLowerCase().includes(needle.slice(0, 8)));
      return {
        stdField: field.name,
        stdCode: field.code,
        ruleField: field.stdField,
        required: !!field.required,
        column: col || pre.srcField,
        transform: pre.via,
        confidence: col ? 0.98 : 0.72,
        reason: col
          ? "命中产品预设映射：" + pre.srcSystem + "." + pre.srcField
          : "预设映射指向 " + pre.srcField + "，但当前表头未找到同名列，需人工确认",
        needsReview: !col,
        source: "preset"
      };
    }
    const hit = hs.find((item) => item === field.name)
      || hs.find((item) => item.includes(field.name) || field.name.includes(item));
    if (hit) {
      const exact = hit === field.name;
      return {
        stdField: field.name,
        stdCode: field.code,
        ruleField: field.stdField,
        required: !!field.required,
        column: hit,
        transform: "直接取值",
        confidence: exact ? 0.95 : 0.8,
        reason: exact ? "列名与标准字段名称完全一致" : "列名「" + hit + "」与标准字段名称近似",
        needsReview: !exact,
        source: "matched"
      };
    }
    return {
      stdField: field.name,
      stdCode: field.code,
      ruleField: field.stdField,
      required: !!field.required,
      column: null,
      transform: "—",
      confidence: 0,
      reason: field.required
        ? "未在表头中找到匹配列。该字段为必填，缺失会导致引用它的规则条件不命中。"
        : "未在表头中找到匹配列。该字段为选填，未映射时引用它的条件不命中。",
      needsReview: true,
      source: "none"
    };
  });
}

export async function measureDemo() {
  if (cached) return cached;
  const master = require(path.join(root, "server/data/master_data.cjs"));
  const mock = require(path.join(root, "server/data/mock_loans.cjs"));
  const pipeline = require(path.join(root, "server/lib/pipeline.cjs"));
  global.MASTER = master;
  const doc = JSON.parse(readFileSync(
    path.join(root, "agent/subagents/weight/knowledge/权重法风险暴露分类.json"),
    "utf8"
  ));
  const eadConfig = await eadConfigMap();
  const out = pipeline.measureBatch(mock.MOCK_LOANS, {
    ruleset: doc,
    eadConfig,
    detectRules: mock.PRODUCT_DETECT_RULES
  });
  const products = {};
  (master.PRODUCT_TYPES || []).forEach((item) => { products[item.code] = item.label; });
  const detected = mock.MOCK_LOANS.map((loan) => {
    const found = pipeline.detectProduct(loan, mock.PRODUCT_DETECT_RULES);
    return {
      id: loan.id,
      customer: loan.customer,
      name: loan.name,
      raw: loan.raw || {},
      std: loan.std || {},
      anomaly: loan.anomaly || "",
      anomalyDetail: loan.anomalyDetail || "",
      product: found.product,
      basis: found.basis,
      confidence: found.confidence
    };
  });
  const mappings = {};
  detected.forEach((loan) => {
    if (loan.product && !mappings[loan.product]) {
      mappings[loan.product] = suggestMapping(loan.product, mock.RAW_SHEET_HEADERS, master);
    }
  });
  cached = {
    intake: {
      sheets: ["term-Loan", "Bonds", "Mortgage", "212 222 存放同业", "額度詳情表"],
      headerRow: 14,
      headers: mock.RAW_SHEET_HEADERS,
      fieldCount: Array.isArray(doc.fields) ? doc.fields.length : 0,
      eadOn: Object.values(eadConfig).filter((c) => c.side === "on").reduce((n, c) => n + c.rules.length, 0),
      eadOff: Object.values(eadConfig).filter((c) => c.side === "off").reduce((n, c) => n + c.rules.length, 0),
      loans: detected,
      mappings
    },
    ruleset: doc.name || doc.title || "",
    summary: out.summary,
    byClass: out.byClass,
    byProduct: out.byProduct,
    products,
    results: out.results.map((row) => ({
      loanId: row.loanId,
      customer: row.customer,
      name: row.name,
      product: row.product,
      balance: row.std ? row.std.balance : null,
      exposureClass: row.exposureClass,
      exposureSubClass: row.exposureSubClass,
      matchedRule: row.matchedRule,
      riskWeight: row.riskWeight,
      onEad: row.onEad,
      offEad: row.offEad,
      ead: row.ead,
      rwa: row.rwa,
      status: row.status,
      reference: row.reference,
      exceptions: row.exceptions || [],
      eadFormula: row.stages && row.stages.ead && row.stages.ead.result ? row.stages.ead.result.formula : "",
      eadSteps: row.stages && row.stages.ead && row.stages.ead.result ? row.stages.ead.result.steps || [] : [],
      rwaSteps: row.stages && row.stages.rwa && row.stages.rwa.result ? row.stages.rwa.result.steps || [] : []
    })).map((row) => ({
      ...row,
      ead: row.ead == null ? null : round2(row.ead),
      onEad: row.onEad == null ? null : round2(row.onEad),
      offEad: row.offEad == null ? null : round2(row.offEad),
      rwa: row.rwa == null ? null : round2(row.rwa)
    }))
  };
  return cached;
}

function col(title, width) {
  return { title, width };
}

export async function auditWorkbook() {
  const data = await measureDemo();
  const label = (code) => data.products[code] || code || "未识别";
  const money = (value) => (value == null ? "" : Number(value));
  return Buffer.from(writeXlsx([
    {
      name: "ReadMe",
      freeze: 1,
      columns: [col("项目", 22), col("内容", 60)],
      rows: [
        ["规则", data.ruleset],
        ["债项", data.summary.total],
        ["表内 EAD", data.summary.onEad],
        ["表外 EAD", data.summary.offEad],
        ["EAD 合计", data.summary.ead],
        ["信用风险 RWA", data.summary.rwa],
        ["正常 / 待复核 / 异常", data.summary.ok + " / " + data.summary.warning + " / " + data.summary.exception],
        ["说明", "底稿里的业务数据是内置模拟债项，计算口径与计量结果明细相同。"]
      ]
    },
    {
      name: "原始债项数据",
      freeze: 1,
      columns: [col("债项编号", 12), col("客户编号", 12), col("客户名称", 28), col("产品代码", 16), col("币种", 10), col("余额", 16), col("客户类型", 12), col("押品", 16), col("逾期天数", 12), col("五级分类", 12)],
      rows: data.intake.loans.map((loan) => [
        loan.id, loan.customer, loan.name, loan.raw.productCode || "", loan.raw.ccy || "",
        money(loan.raw.balance), loan.raw.custType || "", loan.raw.collateralType || "",
        loan.raw.overdueDays ?? "", loan.raw.loanClass || ""
      ])
    },
    {
      name: "暴露分类结果",
      freeze: 1,
      columns: [col("债项编号", 12), col("客户名称", 28), col("产品类型", 14), col("暴露大类", 22), col("暴露子类", 28), col("命中规则", 28), col("风险权重", 12), col("状态", 10)],
      rows: data.results.map((row) => [
        row.loanId, row.name, label(row.product), row.exposureClass || "未分类",
        row.exposureSubClass || "", row.matchedRule || "", row.riskWeight, row.status
      ])
    },
    {
      name: "EAD计算明细",
      freeze: 1,
      columns: [col("债项编号", 12), col("产品类型", 14), col("表内 EAD", 16), col("表外 EAD", 16), col("EAD", 16), col("公式", 36)],
      rows: data.results.map((row) => [row.loanId, label(row.product), money(row.onEad), money(row.offEad), money(row.ead), row.eadFormula || ""])
    },
    {
      name: "RWA计算明细",
      freeze: 1,
      columns: [col("债项编号", 12), col("暴露大类", 22), col("风险权重", 12), col("EAD", 16), col("RWA", 16)],
      rows: data.results.map((row) => [row.loanId, row.exposureClass || "", row.riskWeight, money(row.ead), money(row.rwa)])
    }
  ]));
}
