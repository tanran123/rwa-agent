import { spawn } from "child_process";
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";
import { query } from "./db.js";
import { configProducts, versionRuleDocuments, parameterPayload } from "./productStandard.js";
import { eadConfigMap } from "./eadConfig.js";
import { resolveVersionRef } from "./ruleVersion.js";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const FormulaEngine = require(path.join(root, "server/lib/formula.cjs"));
const Engine = require(path.join(root, "server/lib/engine.cjs"));

const V35_SCRIPT = `
import json, sys
from agent.steps.weight.v35 import evaluate
payload = json.load(sys.stdin)
print(json.dumps(evaluate(payload), ensure_ascii=False))
`;

function json(value) {
  if (value == null) return null;
  if (typeof value === "string") {
    try { return JSON.parse(value); } catch { return null; }
  }
  return value;
}

function pythonBin() {
  return process.env.PYTHON_BIN || (process.platform === "win32" ? "python" : "python3");
}

function runV35(payload) {
  return new Promise((resolve, reject) => {
    const child = spawn(pythonBin(), ["-c", V35_SCRIPT], {
      cwd: root,
      env: { ...process.env, PYTHONPATH: root + path.delimiter + (process.env.PYTHONPATH || "") }
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => { out += chunk; });
    child.stderr.on("data", (chunk) => { err += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        const error = new Error((err || out || "V3.5 规则执行失败").trim().slice(-500));
        error.status = 400;
        reject(error);
        return;
      }
      try {
        const data = JSON.parse(out.trim().split("\n").pop());
        if (data && data.error) throw new Error(data.error);
        resolve(data);
      } catch (parseError) {
        reject(new Error("V3.5 规则没有返回结果"));
      }
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function numberOrNull(value) {
  if (value == null || value === "") return null;
  const n = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function headerHit(headers, names) {
  const wanted = names.filter((name) => name && name !== "—").map((name) => String(name).toLowerCase());
  for (const name of wanted) {
    const hit = (headers || []).find((header) => String(header).toLowerCase() === name);
    if (hit) return hit;
  }
  return "";
}

function mappingBySource(mappingDoc) {
  const map = {};
  ((mappingDoc && mappingDoc.mappings) || []).forEach((item) => {
    if (!item || !item.source_field) return;
    if (!map[item.source_field]) map[item.source_field] = [];
    map[item.source_field].push(item);
  });
  return map;
}

function conditionalValue(transform, value) {
  const expression = String((transform && transform.expression) || "");
  const text = String(value == null ? "" : value).trim().toUpperCase();
  const pairs = expression.split(/[；;]/).map((part) => part.trim()).filter(Boolean);
  for (const pair of pairs) {
    const bits = pair.split(/\s*(?:→|->)\s*/);
    if (bits.length < 2) continue;
    const left = bits[0].trim();
    const right = bits[1].trim().split(/[，,]/)[0].trim();
    if (/^否则/.test(left)) return right;
    const tokens = left.split(/[\/、,，]/).map((token) => token.trim().toUpperCase()).filter(Boolean);
    if (tokens.some((token) => token === text || text.includes(token))) return right;
  }
  return undefined;
}

function transformValue(transform, value, facts) {
  if (!transform || typeof transform !== "object") return value;
  const type = String(transform.type || "direct");
  const params = transform.parameters || {};
  if (type === "constant") return params.value;
  if (type === "code_mapping") {
    const map = transform.mapping || {};
    if (value == null || value === "") return value;
    return Object.prototype.hasOwnProperty.call(map, value) ? map[value] : value;
  }
  if (type === "numeric_conversion") return numberOrNull(value);
  if (type === "date_conversion") return value;
  if (type === "calculation") {
    const expression = String(transform.expression || "");
    const match = expression.match(/coalesce\s*\(([^)]+)\)/i);
    if (match) {
      const names = match[1].split(",").map((item) => item.trim());
      for (const name of names) {
        if (facts[name] != null && facts[name] !== "") return facts[name];
      }
      return undefined;
    }
    return value;
  }
  if (type === "conditional") return conditionalValue(transform, value);
  return value;
}

function buildFacts(loan, product, mappingDoc, suggestions, columns) {
  const facts = {};
  const raw = loan.raw || {};
  const bySource = mappingBySource(mappingDoc);
  const overrides = columns || {};
  (suggestions || []).forEach((item) => {
    const column = Object.prototype.hasOwnProperty.call(overrides, item.stdCode)
      ? overrides[item.stdCode]
      : item.column;
    if (!column) return;
    const value = raw[column];
    if (value == null || value === "") return;
    facts[item.stdCode] = value;
    if (item.stdField) facts[item.stdField] = value;
    (bySource[item.stdCode] || []).forEach((entry) => {
      const next = transformValue(entry.transform, value, facts);
      if (next !== undefined && next !== null && next !== "") facts[entry.target_field] = next;
    });
  });
  // 常量字段即使没有 Excel 列也要写入。
  Object.entries(bySource).forEach(([source, entries]) => {
    entries.forEach((entry) => {
      if (!entry.transform || entry.transform.type !== "constant") return;
      const value = entry.transform.parameters && entry.transform.parameters.value;
      if (value != null && facts[entry.target_field] == null) facts[entry.target_field] = value;
    });
  });
  return facts;
}

export function suggestionsFor(product, mappingDoc, headers) {
  const bySource = mappingBySource(mappingDoc);
  return (product.fields || []).map((field) => {
    const mappings = bySource[field.code] || [];
    const ruleFields = mappings.map((item) => item.target_field).filter(Boolean);
    const column = headerHit(headers, [field.code, field.name, field.stdField, field.sourceField]);
    const constant = mappings.some((item) => item.transform && item.transform.type === "constant");
    return {
      stdField: field.name,
      stdCode: field.code,
      ruleField: field.stdField || ruleFields[0] || "",
      ruleFields: ruleFields,
      transformType: mappings[0] && mappings[0].transform ? mappings[0].transform.type : "direct",
      required: !!field.required,
      constant: constant,
      column: constant ? null : column || null,
      transform: constant ? "常量赋值" : column ? "直接取值" : "—",
      confidence: constant ? 1 : column ? 0.98 : 0,
      reason: constant ? "常量赋值，无需 Excel 列" : column ? "与产品标准字段「" + column + "」一致" : "产品标准字段没有对上表头",
      needsReview: constant ? false : !column,
      source: constant ? "constant" : column ? "standard" : "none"
    };
  });
}

export async function buildV35Pack({ loans, headers, sheets, headerRow, sourceFile, version, jurisdiction, choices, config = null }) {
  const [products, docs] = config
    ? [config.products || [], config.docs || {}]
    : await Promise.all([configProducts(version), versionRuleDocuments(version)]);
  const productByCode = new Map(products.map((item) => [item.code, item]));
  const mappingByName = new Map((docs.mappings || []).map((item) => [item.name, item.doc]));
  const productByProductCode = {};
  products.forEach((product) => {
    (product.productCodes || []).forEach((code) => { productByProductCode[code] = product.code; });
  });
  const productById = (choices && choices.productById) || {};
  const columnsByProduct = (choices && choices.columnsByProduct) || {};
  const mappingCache = {};
  const suggestionCache = {};

  const prepared = (loans || []).map((loan) => {
    const rawCode = String((loan.raw && (loan.raw.productCode || loan.raw.PRODUCT_CODE)) || "").trim();
    const product = productById[loan.id] || productByProductCode[rawCode] || "";
    const productDef = productByCode.get(product) || null;
    const mappingDoc = productDef ? mappingByName.get(productDef.dataMappingRef) || {} : {};
    if (!suggestionCache[product]) suggestionCache[product] = productDef ? suggestionsFor(productDef, mappingDoc, headers) : [];
    if (!mappingCache[product]) mappingCache[product] = mappingDoc;
    const facts = productDef ? buildFacts(loan, productDef, mappingDoc, suggestionCache[product], columnsByProduct[product]) : {};
    return Object.assign({}, loan, { product, facts });
  });

  const mappings = {};
  Object.keys(suggestionCache).forEach((product) => {
    if (!product) return;
    const overrides = columnsByProduct[product] || {};
    mappings[product] = suggestionCache[product].map((item) => {
      const next = Object.assign({}, item);
      if (Object.prototype.hasOwnProperty.call(overrides, item.stdCode)) next.column = overrides[item.stdCode];
      return next;
    });
  });

  const results = prepared.map((loan, index) => {
    const facts = loan.facts || {};
    return {
      loanId: loan.id,
      customer: loan.customer || "",
      name: loan.name || "",
      product: loan.product || "",
      sheet: (loan.raw && loan.raw.sheet) || "",
      excelRow: loan.excelRow || 0,
      balance: numberOrNull(facts.exposure_amount) ?? numberOrNull(facts.balance),
      exposureClass: "",
      exposureSubClass: "",
      matchedRule: "",
      matchedRuleId: "",
      riskWeight: null,
      riskWeightText: "",
      riskWeightPercent: null,
      onEad: null,
      offEad: null,
      ead: null,
      eadFormula: "",
      eadSteps: [],
      rwa: null,
      status: "exception",
      exceptions: [{ level: "warning", text: "等待执行暴露分类" }],
      classificationTrace: "",
      classificationDocument: null,
      classification: null,
      weight: null,
      crm: null,
      facts,
      index
    };
  });

  return {
    sourceFile: sourceFile || "",
    version,
    jurisdiction,
    intake: {
      sheets,
      headerRow,
      headers,
      fieldCount: (docs.classification && docs.classification.doc && docs.classification.doc.fields || []).length,
      eadOn: 0,
      eadOff: 0,
      crmOn: 0,
      exposureTabs: ((docs.classification && docs.classification.doc && docs.classification.doc.rules) || []).map((rule) => ({
        name: rule.id, title: rule.label, label: rule.label, seq: 0
      })),
      loans: prepared,
      mappings
    },
    ruleset: docs.classification ? docs.classification.name : "",
    rulesetTitle: (docs.classification && docs.classification.doc && docs.classification.doc.title) || "",
    productRulesets: prepared.filter((loan) => loan.product).map((loan) => ({
      product: loan.product,
      label: (productByCode.get(loan.product) || {}).label || loan.product,
      ruleset: docs.classification ? docs.classification.name : "",
      rulesetLabel: "风险暴露分类",
      rulesetTitle: (docs.classification && docs.classification.doc && docs.classification.doc.title) || ""
    })),
    rules: {
      exposure: docs.classification ? {
        id: docs.classification.name,
        name: docs.classification.name,
        title: (docs.classification.doc && docs.classification.doc.title) || ""
      } : null,
      exposureTabs: [],
      ead: [],
      crm: []
    },
    products: Object.fromEntries(products.map((product) => [product.code, product.label])),
    summary: {
      total: prepared.length,
      ead: 0,
      rwa: 0,
      ok: 0,
      warning: 0,
      exception: prepared.length
    },
    byClass: {},
    byProduct: {},
    results
  };
}

function productOf(pack, row) {
  return pack.intake.loans.find((loan) => String(loan.id) === String(row.loanId)) || null;
}

function rowFor(pack, loanId) {
  return pack.results.find((row) => String(row.loanId) === String(loanId)) || null;
}

export async function classifyV35Pack(pack, version, jurisdiction, config = null) {
  const [docs, params, products] = config
    ? [config.docs || {}, config.params || { tables: {}, lists: {} }, config.products || []]
    : await Promise.all([
      versionRuleDocuments(version),
      parameterPayload(jurisdiction, version),
      configProducts(version)
    ]);
  if (!docs.classification) {
    const error = new Error("当前监管版本没有产品注册或 V3.5 暴露分类规则文档");
    error.status = 400;
    throw error;
  }
  const productByCode = new Map(products.map((item) => [item.code, item]));
  const doc = docs.classification.doc || {};
  const summaries = { total: 0, classified: 0, exceptions: 0, byClass: {} };
  for (const loan of pack.intake.loans) {
    const facts = Object.assign({}, loan.facts || {});
    const result = await runV35({
      doc,
      facts,
      tables: params.tables,
      lists: params.lists,
      kind: "exposure_classification"
    });
    const row = rowFor(pack, loan.id);
    if (!row) continue;
    summaries.total += 1;
    const product = productByCode.get(loan.product);
    const allowed = (product && product.candidateExposureClasses) || [];
    const invalidCandidate = !!result.exposureClass && allowed.length > 0 && !allowed.includes(result.exposureClass);
    row.exposureClass = result.exposureClass || "unclassified";
    row.exposureSubClass = result.exposureClassLabel || "";
    row.rulesetLabel = doc.title || docs.classification.name || "风险暴露分类";
    row.matchedRule = result.path || "";
    row.matchedRuleId = result.ruleId || "";
    row.classification = result;
    row.classificationTrace = result.path || "";
    row.classificationDocument = {
      id: docs.classification.name,
      name: docs.classification.name,
      title: (doc.title || ""),
      ruleVersion: docs.classification.docVersion || version
    };
    row.riskWeight = null;
    row.riskWeightText = "";
    row.riskWeightPercent = null;
    row.rwa = null;
    row.status = result.manualReview || invalidCandidate ? "warning" : "ok";
    row.exceptions = [];
    if (invalidCandidate) {
      row.exceptions.push({
        level: "warning",
        text: "分类结果 " + result.exposureClass + " 不在产品候选暴露类型中：" + allowed.join("、")
      });
      row.status = "warning";
    }
    if (!result.matched) {
      row.exceptions.push({ level: "error", text: "没有命中任何暴露分类规则，结果为 unclassified" });
      row.status = "exception";
    }
    if (result.manualReview) {
      row.exceptions.push({ level: "warning", text: "暴露分类需要人工复核" });
      row.status = "warning";
    }
    if (row.status === "ok") summaries.classified += 1;
    else summaries.exceptions += 1;
    row.classificationStatus = row.status;
    row.classificationExceptions = (row.exceptions || []).slice();
    summaries.byClass[row.exposureClass] = (summaries.byClass[row.exposureClass] || 0) + 1;
  }
  pack.classification = {
    summary: summaries,
    rule: {
      id: docs.classification.name,
      name: docs.classification.name,
      title: (doc.title || ""),
      version: docs.classification.docVersion || version
    }
  };
  pack.rules.classification = pack.classification.rule;
  const summary = { total: pack.results.length, ead: 0, rwa: 0, ok: 0, warning: 0, exception: 0 };
  const byClass = {};
  pack.results.forEach((row) => {
    summary[row.status] = (summary[row.status] || 0) + 1;
    byClass[row.exposureClass || "未分类"] = (byClass[row.exposureClass || "未分类"] || 0) + 1;
  });
  pack.summary = summary;
  pack.byClass = byClass;
  pack.ruleset = docs.classification.name;
  pack.rulesetTitle = doc.title || "";
  return pack;
}

export async function weightV35Pack(pack, version, jurisdiction, config = null) {
  const [docs, params] = config
    ? [config.docs || {}, config.params || { tables: {}, lists: {} }]
    : await Promise.all([
      versionRuleDocuments(version),
      parameterPayload(jurisdiction, version)
    ]);
  if (!docs.weight) {
    const error = new Error("当前监管版本没有 V3.5 风险权重规则文档");
    error.status = 400;
    throw error;
  }
  const doc = docs.weight.doc || {};
  const summaries = { total: 0, determined: 0, manual: 0, blocked: 0 };
  for (const loan of pack.intake.loans) {
    const row = rowFor(pack, loan.id);
    if (!row) continue;
    if (!row.classification || row.exposureClass === "unclassified") {
      row.riskWeight = null;
      row.riskWeightText = "";
      row.riskWeightPercent = null;
      row.status = "exception";
      row.exceptions = (row.exceptions || []).concat([{ level: "error", text: "分类未完成，不能计算风险权重" }]);
      row.weightStatus = "exception";
      row.weightExceptions = row.exceptions.slice();
      summaries.blocked += 1;
      continue;
    }
    if ((row.exceptions || []).some((item) => /不在产品候选暴露类型/.test(item.text))) {
      row.riskWeight = null;
      row.riskWeightText = "";
      row.riskWeightPercent = null;
      row.status = "warning";
      row.weightStatus = "warning";
      row.weightExceptions = row.exceptions.slice();
      summaries.blocked += 1;
      continue;
    }
    const facts = Object.assign({}, loan.facts || {}, {
      exposure_class: row.exposureClass
    });
    const result = await runV35({
      doc,
      facts,
      tables: params.tables,
      lists: params.lists,
      kind: "risk_weight"
    });
    summaries.total += 1;
    row.weight = result;
    if (result.riskWeight == null) {
      row.riskWeight = null;
      row.riskWeightText = "";
      row.riskWeightPercent = null;
      row.status = "warning";
      row.exceptions = (row.exceptions || []).filter((item) => !/风险权重/.test(item.text));
      row.exceptions.push({ level: "warning", text: "风险权重需要人工复核" });
      summaries.manual += 1;
    } else {
      row.riskWeightPercent = Number(result.riskWeight);
      row.riskWeight = Number(result.riskWeight) / 100;
      row.riskWeightText = result.riskWeightText || (result.riskWeight + "%");
      row.status = row.status === "exception" ? "warning" : "ok";
      row.weightStatus = row.status;
      row.weightExceptions = row.exceptions.slice();
      summaries.determined += 1;
    }
    if (row.weightStatus == null) {
      row.weightStatus = row.status;
      row.weightExceptions = (row.exceptions || []).slice();
    }
  }
  pack.weight = {
    summary: summaries,
    rule: {
      id: docs.weight.name,
      name: docs.weight.name,
      title: (doc.title || ""),
      version: docs.weight.docVersion || version
    }
  };
  pack.rules.weight = pack.weight.rule;
  return pack;
}

function evalEadRule(config, facts) {
  for (const rule of (config && config.rules) || []) {
    const when = rule.conditions;
    const ok = !when || Engine.evalWhen(when, facts).ok;
    if (!ok) continue;
    if (config.side === "off") facts.CCF = rule.ccf;
    const structured = rule.structured || rule;
    const evaluated = FormulaEngine.evaluateWithSteps(structured, facts);
    return { rule, value: evaluated ? evaluated.value : null, steps: evaluated ? evaluated.steps : [] };
  }
  return null;
}

function crmConfigMap(rows, columns, types, versionId) {
  const byProduct = {};
  rows.forEach((row) => {
    if (!versionId && byProduct[row.product_code]) return;
    const own = versionId ? rows.find((item) => item.product_code === row.product_code && item.rule_version_id === versionId) : null;
    const picked = own || row;
    if (picked !== row) return;
    const chosen = picked.rule_version_id || "";
    byProduct[row.product_code] = {
      code: row.product_code,
      needed: !!Number(picked.needed),
      reason: picked.reason || "",
      maxSlots: Number(picked.max_slots) || 1,
      columns: { crm_type: [], crm_value: [], crm_weight: [] },
      facts: { crm_type: [], crm_value: [], crm_weight: [] },
      types: [],
      ruleVersionId: chosen
    };
  });
  columns.forEach((row) => {
    const item = byProduct[row.product_code];
    if (!item || !item.columns[row.attr]) return;
    if ((row.rule_version_id || "") !== item.ruleVersionId) return;
    item.columns[row.attr][Number(row.slot) - 1] = row.column_name;
    item.facts[row.attr][Number(row.slot) - 1] = row.target_fact_code || row.attr;
  });
  types.forEach((row) => {
    const item = byProduct[row.product_code];
    if (!item) return;
    if ((row.rule_version_id || "") !== item.ruleVersionId) return;
    item.types.push({ code: row.code, name: row.name });
  });
  return byProduct;
}

async function crmSnapshot(version = "", jurisdiction = "") {
  const versionId = version ? await resolveVersionRef(version, jurisdiction) : "";
  const load = (scoped) => Promise.all([
    query(
      scoped
        ? "SELECT product_code, needed, reason, max_slots, rule_version_id FROM crm_product_config WHERE rule_version_id = ? OR rule_version_id = ''"
        : "SELECT product_code, needed, reason, max_slots, rule_version_id FROM crm_product_config",
      scoped ? [versionId] : []
    ),
    query(
      scoped
        ? "SELECT product_code, attr, slot, column_name, target_fact_code, rule_version_id FROM crm_slot_column WHERE rule_version_id = ? OR rule_version_id = '' ORDER BY product_code, attr, slot"
        : "SELECT product_code, attr, slot, column_name, target_fact_code, rule_version_id FROM crm_slot_column ORDER BY product_code, attr, slot",
      scoped ? [versionId] : []
    ),
    query(
      scoped
        ? "SELECT product_code, code, name, note, seq, rule_version_id FROM crm_eligible_type WHERE rule_version_id = ? OR rule_version_id = '' ORDER BY product_code, seq, code"
        : "SELECT product_code, code, name, note, seq, rule_version_id FROM crm_eligible_type ORDER BY product_code, seq, code",
      scoped ? [versionId] : []
    )
  ]);
  let [configs, columns, types] = await load(!!versionId);
  if (versionId && !configs.length) [configs, columns, types] = await load(false);
  return crmConfigMap(configs, columns, types, versionId);
}

function applyCrm(row, facts, cfg) {
  if (!cfg || !cfg.needed) {
    return { status: "off", applied: false, note: (cfg && cfg.reason) || "该产品未启用信用风险缓释", slots: [] };
  }
  const slots = [];
  for (let index = 0; index < cfg.maxSlots; index += 1) {
    const typeColumn = cfg.columns.crm_type[index] || "";
    const valueColumn = cfg.columns.crm_value[index] || "";
    const weightColumn = cfg.columns.crm_weight[index] || "";
    const typeFact = (cfg.facts && cfg.facts.crm_type[index]) || "crm_type";
    const valueFact = (cfg.facts && cfg.facts.crm_value[index]) || "crm_value";
    const weightFact = (cfg.facts && cfg.facts.crm_weight[index]) || "crm_weight";
    if (!typeColumn && !valueColumn && !weightColumn) continue;
    const type = typeColumn ? (facts[typeFact] == null ? facts[typeColumn] : facts[typeFact]) : "";
    const value = valueColumn ? numberOrNull(facts[valueFact] == null ? facts[valueColumn] : facts[valueFact]) : null;
    const weight = weightColumn ? numberOrNull(facts[weightFact] == null ? facts[weightColumn] : facts[weightFact]) : null;
    const text = type == null ? "" : String(type);
    const eligible = cfg.types.find((item) => item.code === text || item.name === text);
    slots.push({ slot: index + 1, typeColumn, valueColumn, weightColumn, type: text, value, weight, eligible: eligible ? eligible.code : "" });
  }
  const filled = slots.filter((item) => item.type);
  if (filled.some((item) => !item.eligible)) {
    return { status: "ineligible", applied: false, note: "字典外的类型视为不合格，缓释不予认定。原债务人权重不变。", slots };
  }
  const covered = numberOrNull(facts.covered_amount);
  const uncovered = numberOrNull(facts.uncovered_amount);
  const protection = numberOrNull(facts.protection_weight);
  const missing = [];
  if (covered == null) missing.push("covered_amount");
  if (uncovered == null) missing.push("uncovered_amount");
  if (protection == null) missing.push("protection_weight");
  if (facts.same_currency == null || facts.same_currency === "") missing.push("same_currency");
  if (facts.collateral_kind == null || facts.collateral_kind === "") missing.push("collateral_kind");
  if (missing.length || row.riskWeight == null) {
    return {
      status: "skipped",
      applied: false,
      note: "覆盖金额、未覆盖金额、保护方权重、币种是否相同、抵押品类型缺任何一项时，不拆分。原债务人权重不变。",
      missing,
      slots
    };
  }
  const zero = facts.same_currency === "yes" && (
    facts.collateral_kind === "cash_deposit"
    || (facts.collateral_kind === "sovereign_debt" && Number(facts.sovereign_market_haircut) === 0.8)
  );
  const used = zero ? 0 : Math.max(protection, 0.2);
  return {
    status: "applied",
    applied: true,
    note: "被覆盖部分按保护方权重，未覆盖部分仍用原债务人权重。",
    covered,
    uncovered,
    protectionWeightUsed: used,
    slots
  };
}

export async function finalizeV35Pack(pack, version, config = null) {
  const eadConfig = config ? (config.eadConfig || {}) : await eadConfigMap(version);
  const crm = config ? (config.crm || {}) : await crmSnapshot(version);
  (pack.results || []).forEach((row) => {
    const loan = productOf(pack, row);
    const facts = Object.assign({}, (loan && loan.facts) || row.facts || {});
    const config = eadConfig[row.product] || null;
    row.onEad = null;
    row.offEad = null;
    row.ead = null;
    row.eadFormula = "";
    row.eadSteps = [];
    if (config && config.needed && config.side && (config.rules || []).length) {
      const hit = evalEadRule(config, facts);
      if (hit && hit.value != null) {
        row.ead = round2(hit.value);
        if (config.side === "on") row.onEad = row.ead;
        else row.offEad = row.ead;
        row.eadFormula = hit.rule.formula || "";
        row.eadSteps = (hit.steps || []).map((item, index) => ({
          n: index + 1, label: item.label || item.type, display: item.value, value: item.value
        }));
      } else {
        row.exceptions = (row.exceptions || []).concat([{ level: "error", text: "EAD 公式没有取到值" }]);
      }
    } else if (config && !config.needed) {
      row.exceptions = (row.exceptions || []).concat([{ level: "info", text: config.reason || "该产品无需配置 EAD" }]);
    } else {
      row.exceptions = (row.exceptions || []).concat([{ level: "warning", text: "该产品没有可用的 EAD 配置" }]);
    }

    row.crm = applyCrm(row, facts, crm[row.product]);
    const weight = row.riskWeight;
    if (row.crm.applied && weight != null) {
      row.rwa = round2(row.crm.covered * row.crm.protectionWeightUsed + row.crm.uncovered * weight);
    } else if (row.ead != null && weight != null) {
      row.rwa = round2(row.ead * weight);
    } else {
      row.rwa = null;
    }
    if (row.rwa == null) {
      row.status = row.exposureClass && row.exposureClass !== "unclassified" ? "warning" : "exception";
    } else {
      row.status = "ok";
    }
    row.facts = facts;
  });
  const summary = { total: pack.results.length, ead: 0, rwa: 0, ok: 0, warning: 0, exception: 0, onEad: 0, offEad: 0 };
  const byClass = {};
  pack.results.forEach((row) => {
    summary.onEad += row.onEad || 0;
    summary.offEad += row.offEad || 0;
    summary.ead += row.ead || 0;
    summary.rwa += row.rwa || 0;
    summary[row.status] = (summary[row.status] || 0) + 1;
    byClass[row.exposureClass || "未分类"] = (byClass[row.exposureClass || "未分类"] || 0) + 1;
  });
  summary.ead = round2(summary.ead);
  summary.rwa = round2(summary.rwa);
  summary.onEad = round2(summary.onEad);
  summary.offEad = round2(summary.offEad);
  summary.rwaRate = summary.ead ? summary.rwa / summary.ead : 0;
  pack.summary = summary;
  pack.byClass = byClass;
  pack.rules.ead = Object.entries(eadConfig).flatMap(([product, item]) => (item.rules || []).map((rule) => ({
    id: rule.id, product, name: rule.name, formula: rule.formula, side: item.side, clause: rule.clause, status: rule.status
  })));
  pack.rules.crm = Object.values(crm).map((item) => ({
    code: item.code,
    needed: item.needed,
    reason: item.reason,
    maxSlots: item.maxSlots,
    columns: item.columns,
    types: item.types.map((type) => ({ code: type.code, name: type.name }))
  }));
  return pack;
}
