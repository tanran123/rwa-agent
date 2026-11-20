/**
 * 为产品标准字段模拟生成中英文名、说明、单位、精度和码值字典。
 *
 *   node tools/simulate-product-field-metadata.mjs [--version HK-SA-2026.1] [--dry-run]
 *
 * 只补空值，不覆盖已经维护的内容；已发布版本只读，会跳过。可重复执行。
 * 生成的是演示用模拟元数据，不改变字段编码、类型、分组、必填和任何计算权重。
 */

import { pool, query } from "../server/src/db.js";
import { saveRuleDocument } from "../server/src/ruleDocs.js";

function arg(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const VERSION = arg("--version", "HK-SA-2026.1");
const DRY_RUN = process.argv.includes("--dry-run");

function json(value) {
  if (value == null) return {};
  if (typeof value === "string") {
    try { return JSON.parse(value); } catch { return {}; }
  }
  return value;
}

const ACRONYMS = new Set([
  "ID", "ECAI", "CCY", "SFT", "CLN", "SCRA", "CP", "OB", "IPO", "LTV", "DSCR",
  "CCF", "EAD", "RWA", "HKD", "USD", "CNY", "EUR", "GBP", "JPY", "HKMA", "MDB",
  "SME", "GRP", "SPV", "SOV", "DOM", "RTG", "CUST", "AMT", "BAL", "PRIN", "DPD",
  "IFRS", "CRR", "SA", "IRB", "FX", "PD", "LGD", "EL", "UL", "CVA", "CCR", "CQL"
]);

const WORDS = {
  ASSET: "Asset", ID: "ID", PROD: "Product", CODE: "Code", BOOK: "Book",
  TYPE: "Type", CUST: "Customer", RTG: "Rating", ECAI: "ECAI", SOV: "Sovereign",
  DOM: "Domestic", INCOME: "Income", PROP: "Property", PURPOSE: "Purpose",
  SPEC: "Specialised", LENDING: "Lending", CLN: "CLN", BASKET: "Basket",
  ISSUER: "Issuer", SCRA: "SCRA", GRADE: "Grade", OB: "OB", VALUE: "Value",
  AMT: "Amount", BAL: "Balance", EAD: "EAD", RWA: "RWA", DRAWN: "Drawn",
  PRIN: "Principal", ORIG: "Original", TERM: "Term", SALES: "Sales",
  HKD: "HKD", FLG: "Flag", NUM: "Number", PCT: "Percentage", RATIO: "Ratio",
  RATE: "Rate", DAYS: "Days", LTV: "LTV", DSCR: "DSCR", CCF: "CCF",
  MATURITY: "Maturity", TENOR: "Tenor", MONTHS: "Months", YEARS: "Years",
  HOME: "Home", CQL: "Credit Quality Level", CP: "Counterparty", SCRA: "SCRA",
  ISSUER: "Issuer", CCY: "Currency", FUND: "Funding", INCOME: "Income",
  RELATED: "Related", CC: "Currency", CONVERT: "Converted", EQUIV: "Equivalent",
  O: "Outstanding", S: "Standing", RATING: "Rating", ASSESSED: "Assessed",
  NOT: "Not", OTHER: "Other", TOTAL: "Total", NET: "Net", GROSS: "Gross",
  MARKET: "Market", FAIR: "Fair", CARRY: "Carrying", NOMINAL: "Nominal",
  EXPOSURE: "Exposure", LIMIT: "Limit", UTIL: "Utilisation", UTILISED: "Utilised",
  COLLATERAL: "Collateral", GUARANTEE: "Guarantee", CREDIT: "Credit",
  PROTECTION: "Protection", MATCH: "Match", MISMATCH: "Mismatch",
  RESIDUAL: "Residual", EFFECTIVE: "Effective", START: "Start", END: "End",
  REPORT: "Reporting", MEAS: "Measurement", DATE: "Date", AS: "As", AT: "At",
  RISK: "Risk", WEIGHT: "Weight", CLASS: "Class", SUB: "Sub", CATEGORY: "Category",
  COUNTRY: "Country", REGION: "Region", SECTOR: "Sector", INDUSTRY: "Industry",
  DEFAULT: "Default", STATUS: "Status", STAGE: "Stage", PROVISION: "Provision",
  IMPAIRMENT: "Impairment", PAST: "Past", DUE: "Due", OVERDUE: "Overdue",
  RESTRUCTURE: "Restructure", BANKRUPT: "Bankrupt", FORBEARANCE: "Forbearance",
  SMALL: "Small", BUSINESS: "Business", PERSONAL: "Personal", CORPORATE: "Corporate",
  RESIDENTIAL: "Residential", COMMERCIAL: "Commercial", MORTGAGE: "Mortgage",
  REAL: "Real", ESTATE: "Estate", DEVELOPMENT: "Development", PROJECT: "Project",
  FINANCE: "Finance", OBJECT: "Object", COMMODITIES: "Commodities",
  TRADE: "Trade", SUBORDINATED: "Subordinated", BILL: "Bill", RETAIL: "Retail",
  BANK: "Bank", INTERBANK: "Interbank", DEPOSIT: "Deposit", BOND: "Bond",
  EQUITY: "Equity", DERIVATIVE: "Derivative", CAPITAL: "Capital",
  INSTRUMENT: "Instrument", SECURITY: "Security", TREASURY: "Treasury",
  CASH: "Cash", SETTLEMENT: "Settlement", CLEARING: "Clearing",
  SOVEREIGN: "Sovereign", PUBLIC: "Public", SECTOR: "Sector",
  MULTILATERAL: "Multilateral", DEVELOPMENT: "Development",
  INSURANCE: "Insurance", FUND: "Fund", ORIGINATOR: "Originator",
  SPONSOR: "Sponsor", TRANCHE: "Tranche", SENIOR: "Senior", MEZZ: "Mezzanine",
  JUNIOR: "Junior", ATTACH: "Attachment", DETACH: "Detachment",
  CONST: "Constant", ASSIGNMENT: "Assignment", FAMILY: "Family",
  EXPOSURE: "Exposure", TYPE: "Type",
  PSE: "PSE", LAC: "LAC", UMB: "UMB", RW: "RW", CTRY: "Country", ST: "Short-term",
  DT: "Date", RESI: "Residential", NONHOST: "Non-host", RE: "Real Estate",
  REF: "Reference", REQ: "Requirement", MIN: "Minimum", MAX: "Maximum",
  SETTLE: "Settlement", OBLIGOR: "Obligor", COUNTERPARTY: "Counterparty",
  BORROWER: "Borrower", COLLECTION: "Collection", SETTLEMENT_DATE: "Settlement Date",
};

const CONSTANT_LABELS = {
  "贷款产品族": "Loan Product Family Constant",
  "债券产品族": "Bond Product Family Constant",
  "同业资产产品族": "Interbank Asset Product Family Constant",
  "证券融资交易产品族": "SFT Product Family Constant",
  "衍生工具产品族": "Derivative Product Family Constant",
  "股权及资本工具产品族": "Equity and Capital Instruments Product Family Constant",
  "表外业务产品族": "Off-balance Sheet Product Family Constant",
  "资金、现金及清算产品族": "Treasury, Cash and Settlement Product Family Constant",
  "暴露类型": "Exposure Type Constant"
};

function englishLabel(name, label) {
  if (name === "CONST") {
    const suffix = String(label || "").split("：").pop();
    return CONSTANT_LABELS[suffix] || "Constant Assignment";
  }
  return String(name || "").split("_").map((token) => {
    if (!token) return "";
    if (WORDS[token]) return WORDS[token];
    if (ACRONYMS.has(token)) return token;
    return token.charAt(0) + token.slice(1).toLowerCase();
  }).filter(Boolean).join(" ");
}

const FAMILY_CN = {
  LOAN: "贷款", BOND: "债券", INTERBANK: "同业", SFT: "证券融资",
  DERIVATIVE: "衍生工具", EQUITY: "股权及资本工具", OFF_BALANCE: "表外业务",
  TREASURY: "资金与清算"
};

const PRODUCT_WORDS = {
  GOVERNMENT: "政府", MUNICIPAL: "市政", FINANCIAL: "金融", COVERED: "覆盖",
  NOTE: "票据", CERTIFICATE: "凭证", PLACEMENT: "存放", SHARE: "股份",
  PREFERRED: "优先", ORDINARY: "普通", SWAP: "互换", FORWARD: "远期",
  FUTURES: "期货", OPTION: "期权", REPO: "回购", REVERSE: "逆", SALE: "卖出",
  PURCHASE: "买入", SECURITIES: "证券", FINANCING: "融资",
  CORPORATE: "公司", SMALL: "小型", BUSINESS: "企业", PERSONAL: "个人",
  CREDIT: "信用", CARD: "卡", OVERDRAFT: "透支", RESIDENTIAL: "住宅",
  COMMERCIAL: "商业", MORTGAGE: "按揭", REAL: "房地产", ESTATE: "",
  DEVELOPMENT: "开发", PROJECT: "项目", FINANCE: "融资", OBJECT: "物品",
  COMMODITIES: "商品", IPO: "首次公开发行", TRADE: "贸易", SUBORDINATED: "次级",
  GRP: "集团", BILL: "票据", RETAIL: "零售", BANK: "银行", SOVEREIGN: "主权",
  INTERBANK: "同业", DEPOSIT: "存款", BOND: "债券", EQUITY: "股权",
  DERIVATIVE: "衍生", LOAN: "贷款", TREASURY: "资金", CASH: "现金",
  CLEARING: "清算", FUND: "基金", INSURANCE: "保险", MDB: "多边开发机构",
  PUBLIC: "公共部门", OTHER: "其他", BALANCE: "余额", COMMITMENT: "承诺",
  GUARANTEE: "担保", FACILITY: "额度", REVOLVING: "循环", LISTED: "上市",
  UNLISTED: "未上市", VENTURE: "风险", CAPITAL: "资本", GOLD: "黄金",
  BULLION: "金条", RECEIVABLE: "应收", CENTRAL: "中央", PSE: "公共部门实体",
  NOSTRO: "存放同业", VOSTRO: "同业存放", LENDING: "融出", BORROWING: "融入",
  INTEREST: "利率", CROSS: "交叉", CURRENCY: "货币", ON: "在", HAND: "手",
  SECURITY: "证券", PAYABLE: "应付", ACCRUED: "应计", PREPAID: "预付",
  RATE: "", DEFAULT: "违约", SIGNIFICANT: "重大", INVESTMENT: "投资",
  STANDBY: "备用", LC: "信用证", CHEQUE: "支票", IN: "在", COLLECTION: "托收",
  SETTLEMENT: "结算", FX: "外汇", SPOT: "即期", FUTURE: "期货", OPTION: "期权",
  COMMODITY: "商品", INDEX: "指数", TOTAL: "总额", RETURN: "回报",
  ASSET: "资产", LIABILITY: "负债", DEPOSIT: "存款",
  SUPRANATIONAL: "超国家", LINKED: "挂钩", CONVERTIBLE: "可转换", SECTOR: "行业",
  ACCEPTANCE: "承兑", MARGIN: "保证金", REPURCHASE: "回购", TRADING: "交易",
  BASKET: "篮子", INSTRUMENT: "工具", NON: "非", DEBT: "债务",
  PERFORMANCE: "履约", PARTLY: "部分", PAID: "已缴", WITH: "带", RECOURSE: "追索",
  OFF: "表外", ITEM: "项目", FUNDING: "融资", TREASURY_BILL: "国库券",
  HOLDING: "持有", LIABILITY: "负债", CERTIFICATE: "凭证",
  SFT: "证券融资", OTC: "场外", CCP: "中央对手方"
};

function chineseProductName(code) {
  const parts = String(code || "").split("_").map((token) => (
    Object.prototype.hasOwnProperty.call(PRODUCT_WORDS, token) ? PRODUCT_WORDS[token] : token
  )).filter(Boolean);
  return parts.reduce((text, part) => {
    if (/[\u4e00-\u9fff]/.test(part)) return text + part;
    return text + (text && !text.endsWith(" ") ? " " : "") + part + " ";
  }, "").trim();
}

function item(code, cn, en, order) {
  return {
    item_code: code,
    item_name: cn || code,
    item_name_en: en || englishLabel(code),
    description: "",
    sort_order: order,
    status: "ACTIVE"
  };
}

function fixedDictionary(code, name, nameEn, items) {
  return {
    dict_code: code,
    dict_name: name,
    dict_name_en: nameEn,
    description: "演示用模拟码值",
    status: "ACTIVE",
    items
  };
}

function productCodeDictionary(family, codes) {
  return fixedDictionary(
    family + "_PRODUCT_CODE",
    (FAMILY_CN[family] || family) + "产品代码",
    englishLabel(family) + " Product Code",
    (codes || []).map((code, index) => item(code, chineseProductName(code), englishLabel(code), (index + 1) * 10))
  );
}

function buildDictionaries(productMappings) {
  const dicts = [];
  productMappings.forEach((entry) => {
    dicts.push(productCodeDictionary(entry.product_family, entry.product_codes || []));
  });
  dicts.push(fixedDictionary("BOOK_CODE", "账簿归属", "Accounting Book", [
    item("BANKING_BOOK", "银行账簿", "Banking Book", 10),
    item("TRADING_BOOK", "交易账簿", "Trading Book", 20)
  ]));
  dicts.push(fixedDictionary("CURRENCY", "币种", "Currency", [
    item("HKD", "港元", "Hong Kong Dollar", 10),
    item("USD", "美元", "US Dollar", 20),
    item("CNY", "人民币", "Chinese Yuan", 30),
    item("EUR", "欧元", "Euro", 40),
    item("GBP", "英镑", "Pound Sterling", 50),
    item("JPY", "日元", "Japanese Yen", 60),
    item("OTHER", "其他币种", "Other Currency", 99)
  ]));
  dicts.push(fixedDictionary("RATING_TYPE", "评级类型", "Rating Type", [
    item("ECAI", "外部信用评估机构评级", "External Credit Assessment", 10),
    item("INTERNAL", "内部评级", "Internal Rating", 20),
    item("UNRATED", "未评级", "Unrated", 90)
  ]));
  dicts.push(fixedDictionary("ECAI", "外部信用评估机构", "External Credit Assessment Institution", [
    item("S&P", "标准普尔", "S&P", 10),
    item("MOODY", "穆迪", "Moody's", 20),
    item("FITCH", "惠誉", "Fitch", 30),
    item("HKMA", "香港金管局", "HKMA", 40),
    item("OTHER", "其他", "Other", 90)
  ]));
  dicts.push(fixedDictionary("COUNTERPARTY_TYPE", "交易对手类型", "Counterparty Type", [
    item("CORP", "公司", "Corporate", 10),
    item("SME", "中小企业", "Small and Medium Enterprise", 20),
    item("RETAIL", "零售", "Retail", 30),
    item("BANK", "银行", "Bank", 40),
    item("SOVEREIGN", "主权", "Sovereign", 50),
    item("MDB", "多边开发机构", "Multilateral Development Bank", 60),
    item("INSURANCE", "保险机构", "Insurance Company", 70),
    item("FUND", "基金", "Fund", 80),
    item("OTHER", "其他", "Other", 90)
  ]));
  dicts.push(fixedDictionary("SCRA_GRADE", "SCRA 信用评估等级", "SCRA Credit Assessment Grade", [
    item("GRADE_1", "等级 1", "Grade 1", 10),
    item("GRADE_2", "等级 2", "Grade 2", 20),
    item("GRADE_3", "等级 3", "Grade 3", 30),
    item("GRADE_4", "等级 4", "Grade 4", 40),
    item("GRADE_5", "等级 5", "Grade 5", 50),
    item("NOT_ASSESSED", "未评估", "Not Assessed", 90)
  ]));
  dicts.push(fixedDictionary("PROPERTY_TYPE", "抵押物业类型", "Property Type", [
    item("RESIDENTIAL", "住宅", "Residential", 10),
    item("COMMERCIAL", "商业", "Commercial", 20),
    item("INDUSTRIAL", "工业", "Industrial", 30),
    item("OTHER", "其他", "Other", 90)
  ]));
  dicts.push(fixedDictionary("LOAN_PURPOSE", "融资用途", "Loan Purpose", [
    item("REAL_ESTATE", "房地产", "Real Estate", 10),
    item("CORPORATE", "公司经营", "Corporate Business", 20),
    item("CONSUMER", "消费", "Consumer", 30),
    item("TRADE", "贸易", "Trade", 40),
    item("OTHER", "其他", "Other", 90)
  ]));
  dicts.push(fixedDictionary("SPECIALISED_LENDING", "专业贷款类型", "Specialised Lending Type", [
    item("PROJECT_FINANCE", "项目融资", "Project Finance", 10),
    item("OBJECT_FINANCE", "物品融资", "Object Finance", 20),
    item("COMMODITIES_FINANCE", "商品融资", "Commodities Finance", 30),
    item("OTHER", "其他", "Other", 90)
  ]));
  dicts.push(fixedDictionary("LOAN_BUSINESS_TYPE", "贷款业务类型", "Loan Business Type", [
    item("ON_BALANCE", "表内贷款", "On-balance Sheet Loan", 10),
    item("OFF_BALANCE", "表外承诺", "Off-balance Sheet Commitment", 20),
    item("OTHER", "其他", "Other", 90)
  ]));
  dicts.push(fixedDictionary("BOND_BUSINESS_TYPE", "债券业务类型", "Bond Business Type", [
    item("HELD_TO_MATURITY", "持有至到期", "Held to Maturity", 10),
    item("AVAILABLE_FOR_SALE", "可供出售", "Available for Sale", 20),
    item("TRADING", "交易性", "Trading", 30),
    item("OTHER", "其他", "Other", 90)
  ]));
  dicts.push(fixedDictionary("CLN_BASKET", "CLN／篮子类型", "CLN or Basket Type", [
    item("CLN", "信用联结票据", "Credit Linked Note", 10),
    item("BASKET", "篮子", "Basket", 20),
    item("OTHER", "其他", "Other", 90)
  ]));
  dicts.push(fixedDictionary("ASSET_FORM", "资产形态", "Asset Form", [
    item("ON_BALANCE", "表内", "On-balance Sheet", 10),
    item("OFF_BALANCE", "表外", "Off-balance Sheet", 20),
    item("DERIVATIVE", "衍生工具", "Derivative", 30),
    item("OTHER", "其他", "Other", 90)
  ]));
  dicts.push(fixedDictionary("OB_TYPE", "表外业务类型", "Off-balance Sheet Type", [
    item("DIRECT_CREDIT_SUBSTITUTE", "直接信用替代", "Direct Credit Substitute", 10),
    item("COMMITMENT", "承诺", "Commitment", 20),
    item("OTHER", "其他", "Other", 90)
  ]));
  return dicts;
}

const FIELD_DICTIONARY = {
  BOOK_CODE: "BOOK_CODE",
  CCY: "CURRENCY",
  FUND_CCY: "CURRENCY",
  RTG_CCY: "CURRENCY",
  SOV_DOM_CCY: "CURRENCY",
  INCOME_CCY: "CURRENCY",
  RTG_TYPE: "RATING_TYPE",
  ECAI_CODE: "ECAI",
  CUST_TYPE: "COUNTERPARTY_TYPE",
  ISSUER_TYPE: "COUNTERPARTY_TYPE",
  CP_TYPE: "COUNTERPARTY_TYPE",
  SCRA_GRADE_CODE: "SCRA_GRADE",
  PROP_TYPE: "PROPERTY_TYPE",
  LOAN_PURPOSE: "LOAN_PURPOSE",
  SPEC_LENDING_TYPE: "SPECIALISED_LENDING",
  LOAN_TYPE: "LOAN_BUSINESS_TYPE",
  BOND_TYPE: "BOND_BUSINESS_TYPE",
  CLN_BASKET_CODE: "CLN_BASKET",
  ASSET_TYPE: "ASSET_FORM",
  OB_TYPE: "OB_TYPE"
};

function dictionaryFor(field) {
  if (field.type !== "string") return "";
  if (FIELD_DICTIONARY[field.name]) return FIELD_DICTIONARY[field.name];
  const match = String(field.name || "").match(/^([A-Z_]+)_PROD_CODE$/);
  return match ? match[1] + "_PRODUCT_CODE" : "";
}

function unitOf(field) {
  const tokens = new Set(String(field.name || "").split("_"));
  const label = String(field.label || "");
  const has = (...names) => names.some((name) => tokens.has(name));
  const labelHas = (...names) => names.some((name) => label.includes(name));
  if (field.type === "date" || has("DATE") || has("DT") || has("AS") && has("AT")) {
    return { unit: "", precision: null, scale: null, format: "YYYY-MM-DD" };
  }
  if (field.type === "boolean") return { unit: "", precision: null, scale: null, format: "" };
  if (has("CCY", "ID", "CODE", "FLG", "FLAG")) return { unit: "", precision: null, scale: null, format: "" };
  if (has("PCT", "PERCENT", "RATIO", "RATE", "LTV", "DSCR", "CCF", "WEIGHT", "DENSITY", "MARGIN", "HAIRCUT") || labelHas("比例", "比率", "利率", "百分比", "权重", "覆盖率")) {
    return { unit: "%", precision: 10, scale: 6, format: "" };
  }
  if (has("DPD") || labelHas("逾期天数")) return { unit: "天", precision: 10, scale: 0, format: "" };
  if (has("DAYS", "DAY")) return { unit: "天", precision: 10, scale: 0, format: "" };
  if (has("MONTH", "MONTHS")) return { unit: "月", precision: 10, scale: 0, format: "" };
  if (has("YEAR", "YEARS")) return { unit: "年", precision: 10, scale: 0, format: "" };
  if (has("TERM", "TENOR", "MATURITY")) return { unit: "月", precision: 10, scale: 0, format: "" };
  if (has("COUNT", "NUM", "NUMBER", "QTY")) return { unit: "笔", precision: 10, scale: 0, format: "" };
  if (has("CQL", "GRADE", "SCORE")) return { unit: "", precision: 10, scale: 0, format: "" };
  if (has("AMT", "AMOUNT", "BAL", "VALUE", "EAD", "RWA", "EXPOSURE", "PRIN", "SALES", "INCOME", "PROVISION", "DEPOSIT", "DRAWN", "LIMIT", "HKD", "CARRY", "FAIR", "NOMINAL") || labelHas("金额", "余额", "价值", "敞口", "本金", "收入", "账面价值")) {
    return { unit: "HKD", precision: 18, scale: 2, format: "" };
  }
  if (field.type === "number") return { unit: "", precision: 18, scale: 2, format: "" };
  return { unit: "", precision: null, scale: null, format: "" };
}

function fill(target, key, value) {
  if (value == null || value === "") return;
  if (target[key] == null || target[key] === "") target[key] = value;
}

function mainLoop(body, existingDictionaries) {
  const groupLabels = {};
  const groupLabelsEn = {};
  body.product_mappings.forEach((entry) => {
    (entry.standard_field_groups || []).forEach((group) => {
      groupLabels[group.group_id] = group.label || group.group_id;
      groupLabelsEn[group.group_id] = group.label_en || group.group_id;
    });
  });
  const simulated = buildDictionaries(body.product_mappings);
  const byCode = new Map(existingDictionaries.map((dict) => [dict.dict_code, dict]));
  simulated.forEach((dict) => {
    const existing = byCode.get(dict.dict_code);
    if (!existing) {
      byCode.set(dict.dict_code, dict);
      return;
    }
    if (existing.description !== "演示用模拟码值") return;
    existing.dict_name = dict.dict_name;
    existing.dict_name_en = dict.dict_name_en;
    const simulatedItems = new Map(dict.items.map((entry) => [entry.item_code, entry]));
    const items = new Map((existing.items || []).map((entry) => {
      const simulated = simulatedItems.get(entry.item_code);
      if (!simulated) return [entry.item_code, entry];
      return [entry.item_code, {
        ...entry,
        item_name: simulated.item_name,
        item_name_en: simulated.item_name_en,
        sort_order: simulated.sort_order
      }];
    }));
    dict.items.forEach((entry) => {
      if (!items.has(entry.item_code)) items.set(entry.item_code, entry);
    });
    existing.items = [...items.values()].sort((left, right) => (left.sort_order || 0) - (right.sort_order || 0));
  });
  const dictionaries = [...byCode.values()];
  const dictionaryCodes = new Set(dictionaries.map((dict) => dict.dict_code));

  let english = 0;
  let descriptions = 0;
  let units = 0;
  let linked = 0;
  body.product_mappings.forEach((entry) => {
    (entry.standard_fields || []).forEach((field) => {
      if (!field.label_en) {
        field.label_en = englishLabel(field.name, field.label);
        english += 1;
      }
      if (!field.description || field.description === field.label) {
        field.description = "用于「" + (groupLabels[field.group] || field.group || "产品") + "」的" + (field.label || field.name) + "字段，来源字段 " + field.name + "（模拟说明）。";
        descriptions += 1;
      }
      if (!field.description_en) {
        field.description_en = "Simulated metadata for " + field.label_en + " in " + (groupLabelsEn[field.group] || field.group || "product") + " (source field " + field.name + ").";
      }
      const unit = unitOf(field);
      if (!field.unit && unit.unit) { field.unit = unit.unit; units += 1; }
      if (field.precision == null && unit.precision != null) field.precision = unit.precision;
      if (field.scale == null && unit.scale != null) field.scale = unit.scale;
      if (!field.format && unit.format) field.format = unit.format;
      if (!field.status) field.status = "ACTIVE";
      if (!field.dictionary) {
        const code = dictionaryFor(field);
        if (code && dictionaryCodes.has(code)) {
          field.dictionary = code;
          linked += 1;
        }
      }
    });
  });
  return { body: { ...body, dictionaries }, english, descriptions, units, linked };
}

async function main() {
  const rows = await query(
    `SELECT d.id, d.rule_version, d.revision, d.body, v.status AS version_status
       FROM rule_document d
       LEFT JOIN rule_version v ON v.id = d.rule_version_id
      WHERE d.kind = 'product_registry' AND d.rule_version = ?`,
    [VERSION]
  );
  if (!rows.length) {
    console.log("没有找到产品注册文档：" + VERSION);
    return;
  }
  const done = [];
  const skipped = [];
  for (const row of rows) {
    const body = json(row.body);
    if (!Array.isArray(body.product_mappings) || !body.product_mappings.length) {
      skipped.push({ id: row.id, reason: "没有 product_mappings" });
      continue;
    }
    if (row.version_status === "published") {
      skipped.push({ id: row.id, reason: "版本已发布，配置只读" });
      continue;
    }
    const result = mainLoop(body, Array.isArray(body.dictionaries) ? body.dictionaries : []);
    const summary = {
      id: row.id,
      ruleVersion: row.rule_version,
      fields: result.body.product_mappings.reduce((sum, entry) => sum + (entry.standard_fields || []).length, 0),
      english: result.english,
      descriptions: result.descriptions,
      units: result.units,
      linkedDictionaries: result.linked,
      dictionaries: result.body.dictionaries.length
    };
    if (DRY_RUN) {
      done.push({
        ...summary,
        dryRun: true,
        unitSamples: result.body.product_mappings.flatMap((entry) => (entry.standard_fields || []).filter((field) => field.unit).slice(0, 6).map((field) => ({
          family: entry.product_family, name: field.name, label: field.label, unit: field.unit, precision: field.precision, scale: field.scale
        }))),
        fieldSamples: result.body.product_mappings.flatMap((entry) => (entry.standard_fields || []).map((field) => ({ family: entry.product_family, ...field }))).filter((field, index) => index % 20 === 0).map((field) => ({
          family: field.family, name: field.name, label: field.label, label_en: field.label_en, type: field.type, unit: field.unit, precision: field.precision, scale: field.scale, dictionary: field.dictionary
        })),
        sample: result.body.product_mappings.map((entry) => ({
          family: entry.product_family,
          fields: (entry.standard_fields || []).slice(0, 4).map((field) => ({
            name: field.name,
            label: field.label,
            label_en: field.label_en,
            unit: field.unit,
            precision: field.precision,
            scale: field.scale,
            dictionary: field.dictionary
          }))
        }))
      });
      continue;
    }
    try {
      await saveRuleDocument(row.id, {
        body: result.body,
        baseRevision: row.revision,
        actor: "simulate-product-field-metadata"
      });
      done.push(summary);
    } catch (err) {
      skipped.push({ ...summary, reason: err.message || "保存失败" });
    }
  }
  console.log(JSON.stringify({ dryRun: DRY_RUN, version: VERSION, done, skipped }, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
