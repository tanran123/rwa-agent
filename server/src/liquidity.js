/**
 * 流动性产品配置与 LCR 数据集处理。
 *
 * 产品、标准字段、规则、参数表、名单都按 (jurisdiction, rule_version) 版本化存储。
 * 这里只做读取、维护和数据准备；LCR 计算在 agent/core/hqla/lcr.py。
 */

import { query } from "./db.js";

function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function parseJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === "string") {
    try { return JSON.parse(value); } catch { return fallback; }
  }
  return value;
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function nowText() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function slug(value) {
  return String(value == null ? "" : value).replace(/[^A-Za-z0-9_.-]+/g, "-");
}

function uid(jurisdiction, version, code) {
  return ["liquidity", jurisdiction, version, code].map(slug).join("-");
}

function text(value, size) {
  return String(value == null ? "" : value).slice(0, size);
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

// ---------------------------------------------------------------- 版本上下文

export async function liquidityVersions(jurisdiction = "HK") {
  const rows = await query(
    `SELECT rv.id, rv.jurisdiction, rv.version, rv.name, rv.status,
            m.lcr_version, m.lcr_version_name,
            (SELECT COUNT(*) FROM liquidity_product p
              WHERE p.jurisdiction = rv.jurisdiction AND p.rule_version = rv.version) AS productCount
       FROM rule_version rv
       LEFT JOIN liquidity_config_meta m
         ON m.jurisdiction = rv.jurisdiction AND m.rule_version = rv.version
      WHERE (? = '' OR rv.jurisdiction = ?)
      ORDER BY rv.jurisdiction, rv.status = 'published' DESC, rv.version DESC`,
    [jurisdiction, jurisdiction]
  );
  return rows.map((row) => ({
    id: row.id,
    jurisdiction: row.jurisdiction,
    version: row.version,
    name: row.name,
    status: row.status,
    lcrVersion: row.lcr_version || "",
    lcrVersionName: row.lcr_version_name || "",
    productCount: Number(row.productCount) || 0
  }));
}

async function versionContext(params = {}) {
  const jurisdiction = String(params.jurisdiction || "").toUpperCase();
  let version = String(params.version || "");
  if (!jurisdiction && !version) throw fail(400, "需要指定监管规则版本");
  if (!version) {
    const rows = await query(
      `SELECT rv.version FROM rule_version rv
        WHERE (? = '' OR rv.jurisdiction = ?)
        ORDER BY rv.status = 'published' DESC, rv.version DESC LIMIT 1`,
      [jurisdiction, jurisdiction]
    );
    version = rows.length ? rows[0].version : "";
  }
  if (!version) throw fail(404, "没有找到监管规则版本");
  let jur = jurisdiction;
  if (!jur) {
    const rows = await query("SELECT jurisdiction FROM rule_version WHERE version = ? LIMIT 1", [version]);
    jur = rows.length ? rows[0].jurisdiction : "HK";
  }
  return { jurisdiction: jur, version };
}

// ---------------------------------------------------------------- 行 → 对象

function fieldOut(row) {
  return {
    code: row.field_code,
    name: row.field_name,
    category: row.category,
    group: row.field_group,
    groupOrder: Number(row.group_order) || 0,
    dataType: row.data_type,
    role: row.role,
    required: !!Number(row.required),
    valueType: row.value_type,
    dictionary: row.dictionary || "",
    source: row.source_column || "",
    aliases: parseJson(row.aliases_json, []),
    description: row.description || "",
    status: row.status,
    sort: Number(row.sort_order) || 0
  };
}

function ruleOut(row) {
  return {
    id: row.rule_id,
    name: row.name,
    packageId: row.package_id,
    packageName: row.package_name,
    side: row.side,
    sequence: Number(row.sequence_no) || 0,
    priority: Number(row.priority) || 0,
    ruleType: row.rule_type,
    ruleTypeName: row.rule_type_name,
    condition: row.condition_text || "",
    result: row.result_text || "",
    basis: row.basis || "",
    description: row.description || "",
    products: parseJson(row.products_json, [])
  };
}

function productRowOut(row) {
  return {
    code: row.code,
    name: row.name,
    category: row.category,
    productGroup: row.product_group,
    side: row.side,
    source: row.source_system,
    status: row.status,
    description: row.description,
    domains: parseJson(row.domains_json, []),
    paramKey: row.param_key,
    ruleCount: Number(row.rule_count) || 0,
    updatedAt: row.updated_at
  };
}

const SIDE_LABEL = { ASSET: "资产端", INFLOW: "现金流入", OUTFLOW: "现金流出" };

function productGroupsOf(product) {
  const out = [];
  if (product.category) {
    out.push({ code: "PG_" + product.category, name: product.category, kind: "业务大类", desc: "决定适用规则集与字段模板" });
  }
  if (product.productGroup) {
    out.push({ code: "PG_" + product.productGroup, name: product.productGroup, kind: "产品组", desc: "同组产品共享字段与规则模板" });
  }
  if (product.side) {
    out.push({ code: "PG_SIDE_" + product.side, name: SIDE_LABEL[product.side] || product.side, kind: "计量侧别", desc: "决定进入资产端还是现金流端" });
  }
  return out;
}

function fieldGroupsOf(fields) {
  const map = new Map();
  fields.forEach((field) => {
    const key = field.group || "未分组";
    if (!map.has(key)) map.set(key, { id: key, name: key, order: field.groupOrder || 0, count: 0 });
    map.get(key).count += 1;
  });
  return [...map.values()].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

function completenessOf(product, fields) {
  const items = [];
  const basicOk = !!(product.code && product.name && product.category && product.side && product.source);
  items.push({
    key: "basic", label: "产品基础信息", weight: 20,
    status: basicOk ? "DONE" : (product.code && product.name ? "PARTIAL" : "TODO"),
    detail: basicOk ? `${product.code} · ${product.category}` : "缺少产品名称、业务大类、侧别或来源系统"
  });
  const groupOk = !!(product.category && product.productGroup && product.side);
  items.push({
    key: "groups", label: "产品组配置", weight: 20,
    status: groupOk ? "DONE" : (product.category || product.productGroup ? "PARTIAL" : "TODO"),
    detail: groupOk ? "已归属业务大类、产品组与计量侧别" : "产品组信息不完整"
  });
  const fieldOk = fields.length >= 5;
  items.push({
    key: "fields", label: "标准字段配置", weight: 30,
    status: fieldOk ? "DONE" : (fields.length ? "PARTIAL" : "TODO"),
    detail: fields.length ? `${fields.length} 个字段，${fieldGroupsOf(fields).length} 个分组` : "尚未配置标准字段"
  });
  const ruleOk = product.ruleCount > 0;
  items.push({
    key: "rules", label: "监管规则配置", weight: 30,
    status: ruleOk ? "DONE" : "TODO",
    detail: ruleOk ? `${product.ruleCount} 条规则` : "尚未关联流动性规则"
  });
  const score = items.reduce((sum, item) => sum + (item.status === "DONE" ? item.weight : item.status === "PARTIAL" ? item.weight / 2 : 0), 0);
  return { score: Math.round(score), status: score >= 100 ? "已完善" : score >= 60 ? "部分完善" : "未完善", items };
}

function productOut(row, fields, cited) {
  const product = productRowOut(row);
  const list = fields.map((field) => ({ ...field, requiredByRule: !!cited.has(field.code) }));
  const required = list.filter((field) => field.required || field.requiredByRule);
  return {
    ...product,
    fields: list,
    fieldGroups: fieldGroupsOf(list),
    productGroups: productGroupsOf(product),
    completeness: completenessOf(product, list),
    requiredFields: required.map((field) => field.code)
  };
}

function citedFields(ruleRows, productCode) {
  const set = new Set();
  ruleRows.forEach((rule) => {
    const products = parseJson(rule.products_json, []);
    if (productCode && !products.includes(productCode)) return;
    const text = `${rule.condition_text || ""} ${rule.result_text || ""}`;
    const matches = text.match(/[A-Za-z_][A-Za-z0-9_]{2,}/g) || [];
    matches.forEach((name) => set.add(name));
  });
  return set;
}

function citedByProduct(ruleRows) {
  const map = new Map();
  ruleRows.forEach((rule) => {
    const products = parseJson(rule.products_json, []);
    const text = `${rule.condition_text || ""} ${rule.result_text || ""}`;
    const matches = text.match(/[A-Za-z_][A-Za-z0-9_]{2,}/g) || [];
    products.forEach((code) => {
      if (!map.has(code)) map.set(code, new Set());
      matches.forEach((name) => map.get(code).add(name));
    });
  });
  return map;
}

// ---------------------------------------------------------------- 产品读取

export async function listLiquidityProducts(params = {}) {
  const { jurisdiction, version } = await versionContext(params);
  const [products, fieldRows, ruleRows, metaRows] = await Promise.all([
    query("SELECT * FROM liquidity_product WHERE jurisdiction = ? AND rule_version = ? ORDER BY side, category, name", [jurisdiction, version]),
    query("SELECT * FROM liquidity_product_field WHERE jurisdiction = ? AND rule_version = ? ORDER BY product_code, sort_order, id", [jurisdiction, version]),
    query("SELECT * FROM liquidity_rule WHERE jurisdiction = ? AND rule_version = ?", [jurisdiction, version]),
    query("SELECT * FROM liquidity_config_meta WHERE jurisdiction = ? AND rule_version = ?", [jurisdiction, version])
  ]);
  const fieldsByProduct = new Map();
  fieldRows.forEach((row) => {
    if (!fieldsByProduct.has(row.product_code)) fieldsByProduct.set(row.product_code, []);
    fieldsByProduct.get(row.product_code).push(fieldOut(row));
  });
  const cited = citedByProduct(ruleRows);
  const meta = metaRows.length ? {
    lcrVersion: metaRows[0].lcr_version,
    lcrVersionName: metaRows[0].lcr_version_name,
    snapshot: parseJson(metaRows[0].snapshot_json, {}),
    source: metaRows[0].source
  } : null;
  return {
    jurisdiction,
    version,
    meta,
    products: products.map((row) => productOut(row, fieldsByProduct.get(row.code) || [], cited.get(row.code) || new Set()))
  };
}

export async function getLiquidityProduct(code, params = {}) {
  const { jurisdiction, version } = await versionContext(params);
  const rows = await query(
    "SELECT * FROM liquidity_product WHERE jurisdiction = ? AND rule_version = ? AND code = ?",
    [jurisdiction, version, code]
  );
  if (!rows.length) throw fail(404, "没有找到这个流动性产品");
  const [fieldRows, ruleRows] = await Promise.all([
    query("SELECT * FROM liquidity_product_field WHERE jurisdiction = ? AND rule_version = ? AND product_code = ? ORDER BY sort_order, id", [jurisdiction, version, code]),
    query("SELECT * FROM liquidity_rule WHERE jurisdiction = ? AND rule_version = ? ORDER BY sequence_no, priority DESC, rule_id", [jurisdiction, version])
  ]);
  const fields = fieldRows.map(fieldOut);
  const cited = citedFields(ruleRows, code);
  const product = productOut(rows[0], fields, cited);
  const rules = ruleRows.map(ruleOut).filter((rule) => rule.products.includes(code));
  return { jurisdiction, version, product, rules };
}

export async function liquidityMeta(params = {}) {
  const { jurisdiction, version } = await versionContext(params);
  const [metaRows, packages, productRows, fieldRows, ruleRows] = await Promise.all([
    query("SELECT * FROM liquidity_config_meta WHERE jurisdiction = ? AND rule_version = ?", [jurisdiction, version]),
    query("SELECT DISTINCT package_id, package_name, side, sequence_no FROM liquidity_rule WHERE jurisdiction = ? AND rule_version = ? ORDER BY side, sequence_no", [jurisdiction, version]),
    query("SELECT code, name, side, category FROM liquidity_product WHERE jurisdiction = ? AND rule_version = ? AND status <> 'DISABLED' ORDER BY side, name", [jurisdiction, version]),
    query("SELECT * FROM liquidity_product_field WHERE jurisdiction = ? AND rule_version = ? ORDER BY product_code, sort_order, id", [jurisdiction, version]),
    query("SELECT * FROM liquidity_rule WHERE jurisdiction = ? AND rule_version = ?", [jurisdiction, version])
  ]);
  const versions = await liquidityVersions(jurisdiction);
  const meta = metaRows.length ? {
    lcrVersion: metaRows[0].lcr_version,
    lcrVersionName: metaRows[0].lcr_version_name,
    snapshot: parseJson(metaRows[0].snapshot_json, {}),
    source: metaRows[0].source
  } : null;
  const fieldsByProduct = new Map();
  fieldRows.forEach((row) => {
    if (!fieldsByProduct.has(row.product_code)) fieldsByProduct.set(row.product_code, []);
    fieldsByProduct.get(row.product_code).push(fieldOut(row));
  });
  const cited = citedByProduct(ruleRows);
  return {
    jurisdiction,
    version,
    meta,
    versions,
    packages: packages.map((row) => ({
      packageId: row.package_id,
      name: row.package_name,
      side: row.side,
      sequence: Number(row.sequence_no) || 0,
      stage: Number(row.sequence_no) === 10 ? "资格认定" : "等级 / 类别"
    })),
    products: productRows.map((row) => {
      const fields = fieldsByProduct.get(row.code) || [];
      const citedFields = cited.get(row.code) || new Set();
      const list = fields.map((field) => ({ ...field, requiredByRule: citedFields.has(field.code) }));
      return {
        code: row.code,
        name: row.name,
        side: row.side,
        category: row.category,
        fields: list,
        requiredFields: list.filter((field) => field.required || field.requiredByRule).map((field) => field.code)
      };
    })
  };
}

export async function liquidityRules(params = {}) {
  const { jurisdiction, version } = await versionContext(params);
  const rows = await query(
    "SELECT * FROM liquidity_rule WHERE jurisdiction = ? AND rule_version = ? ORDER BY sequence_no, priority DESC, rule_id",
    [jurisdiction, version]
  );
  return { jurisdiction, version, rules: rows.map(ruleOut) };
}

export async function liquidityParams(params = {}) {
  const { jurisdiction, version } = await versionContext(params);
  const [paramRows, tables, lists, metaRows] = await Promise.all([
    query("SELECT * FROM liquidity_param WHERE jurisdiction = ? AND rule_version = ? ORDER BY param_id", [jurisdiction, version]),
    query("SELECT * FROM liquidity_param_table WHERE jurisdiction = ? AND rule_version = ? ORDER BY table_id", [jurisdiction, version]),
    query("SELECT * FROM liquidity_list WHERE jurisdiction = ? AND rule_version = ? ORDER BY list_id", [jurisdiction, version]),
    query("SELECT * FROM liquidity_config_meta WHERE jurisdiction = ? AND rule_version = ?", [jurisdiction, version])
  ]);
  return {
    jurisdiction,
    version,
    meta: metaRows.length ? {
      lcrVersion: metaRows[0].lcr_version,
      lcrVersionName: metaRows[0].lcr_version_name,
      snapshot: parseJson(metaRows[0].snapshot_json, {})
    } : null,
    params: paramRows.map((row) => ({
      id: row.param_id, name: row.name, value: Number(row.value), unit: row.unit, basis: row.basis
    })),
    tables: tables.map((row) => ({
      id: row.table_id, title: row.title, kind: row.kind,
      rows: parseJson(row.rows_json, []), note: row.note
    })),
    lists: lists.map((row) => ({
      id: row.list_id, title: row.title, type: row.list_type, version: row.list_version,
      items: parseJson(row.items_json, []), note: row.note
    }))
  };
}

export async function liquidityConfigCheck(params = {}) {
  const data = await listLiquidityProducts(params);
  const pending = data.products.filter((product) => product.completeness.score < 100);
  return {
    ...data,
    total: data.products.length,
    complete: data.products.length - pending.length,
    pending: pending.length,
    products: data.products.map((product) => ({
      code: product.code,
      name: product.name,
      category: product.category,
      side: product.side,
      score: product.completeness.score,
      status: product.completeness.status,
      missing: product.completeness.items.filter((item) => item.status !== "DONE").map((item) => item.label)
    }))
  };
}

// ---------------------------------------------------------------- 维护写入

export async function saveLiquidityProduct(body = {}) {
  const { jurisdiction, version } = await versionContext(body);
  const code = text(body.code, 64).trim();
  if (!code) throw fail(400, "产品编码不能为空");
  if (!String(body.name || "").trim()) throw fail(400, "产品名称不能为空");
  const side = ["ASSET", "INFLOW", "OUTFLOW"].includes(body.side) ? body.side : "ASSET";
  const now = nowText();
  await query(
    `INSERT INTO liquidity_product
       (id, jurisdiction, rule_version, code, name, category, product_group, side, source_system,
        status, description, domains_json, param_key, rule_count, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       name = VALUES(name), category = VALUES(category), product_group = VALUES(product_group),
       side = VALUES(side), source_system = VALUES(source_system), status = VALUES(status),
       description = VALUES(description), domains_json = VALUES(domains_json),
       param_key = VALUES(param_key), updated_at = VALUES(updated_at)`,
    [
      uid(jurisdiction, version, code), jurisdiction, version, code, text(body.name, 128),
      text(body.category, 64), text(body.productGroup, 64), side, text(body.source, 64),
      text(body.status || "LIVE", 16), text(body.description, 500),
      JSON.stringify(Array.isArray(body.domains) ? body.domains : ["CAPITAL", "LIQUIDITY", "NSFR"]),
      text(body.paramKey, 64), num(body.ruleCount), now
    ]
  );
  return getLiquidityProduct(code, { jurisdiction, version });
}

export async function deleteLiquidityProduct(code, params = {}) {
  const { jurisdiction, version } = await versionContext(params);
  await query("DELETE FROM liquidity_product_field WHERE jurisdiction = ? AND rule_version = ? AND product_code = ?", [jurisdiction, version, code]);
  await query("DELETE FROM liquidity_product WHERE jurisdiction = ? AND rule_version = ? AND code = ?", [jurisdiction, version, code]);
  return { ok: true };
}

export async function saveLiquidityField(code, body = {}) {
  const { jurisdiction, version } = await versionContext(body);
  const fieldCode = text(body.code || body.fieldCode, 64).trim();
  if (!fieldCode) throw fail(400, "字段编码不能为空");
  if (!String(body.name || "").trim()) throw fail(400, "字段名称不能为空");
  const rows = await query(
    "SELECT COALESCE(MAX(sort_order), 0) AS maxOrder FROM liquidity_product_field WHERE jurisdiction = ? AND rule_version = ? AND product_code = ?",
    [jurisdiction, version, code]
  );
  const order = num(rows[0] && rows[0].maxOrder) + 1;
  await query(
    `INSERT INTO liquidity_product_field
       (jurisdiction, rule_version, product_code, field_code, field_name, category, field_group,
        group_order, data_type, role, required, value_type, dictionary, source_column,
        aliases_json, description, status, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       field_name = VALUES(field_name), category = VALUES(category), field_group = VALUES(field_group),
       group_order = VALUES(group_order), data_type = VALUES(data_type), role = VALUES(role),
       required = VALUES(required), value_type = VALUES(value_type), dictionary = VALUES(dictionary),
       source_column = VALUES(source_column), aliases_json = VALUES(aliases_json),
       description = VALUES(description), status = VALUES(status)`,
    [
      jurisdiction, version, code, fieldCode, text(body.name, 128), text(body.category, 64),
      text(body.group, 64), num(body.groupOrder), text(body.dataType || "STRING", 24),
      text(body.role || "NONE", 24), body.required ? 1 : 0, text(body.valueType || "FREE_TEXT", 24),
      text(body.dictionary, 64), text(body.source, 128),
      JSON.stringify(Array.isArray(body.aliases) ? body.aliases : []),
      text(body.description, 500), text(body.status || "ACTIVE", 16), order
    ]
  );
  return getLiquidityProduct(code, { jurisdiction, version });
}

export async function deleteLiquidityField(code, fieldCode, params = {}) {
  const { jurisdiction, version } = await versionContext(params);
  await query(
    "DELETE FROM liquidity_product_field WHERE jurisdiction = ? AND rule_version = ? AND product_code = ? AND field_code = ?",
    [jurisdiction, version, code, fieldCode]
  );
  return getLiquidityProduct(code, { jurisdiction, version });
}

// ---------------------------------------------------------------- 数据集：识别 / 映射 / 质量

function norm(value) {
  return String(value == null ? "" : value)
    .toLowerCase()
    .replace(/[\s_\-/\\()（）:：,，.。]+/g, "")
    .replace(/金额|余额|数值|合计|\(.*?\)|（.*?）/g, "");
}

function fieldNames(field) {
  return [field.code, field.name, field.source, ...(field.aliases || [])].filter(Boolean);
}

function matchScore(header, field) {
  const target = norm(header);
  if (!target) return 0;
  for (const name of fieldNames(field)) {
    const candidate = norm(name);
    if (!candidate) continue;
    if (candidate === target) return 100;
  }
  for (const name of fieldNames(field)) {
    const candidate = norm(name);
    if (candidate.length >= 2 && target.includes(candidate)) return 82;
    if (target.length >= 2 && candidate.includes(target)) return 70;
  }
  return 0;
}

export function autoMapDataset(dataset, product) {
  const headers = (dataset.headers || []).filter((header) => String(header || "").trim());
  const fields = (product.fields || []).filter((field) => field.status !== "DISABLED");
  const used = new Set();
  const mappings = headers.map((header) => {
    let best = null;
    let bestScore = 0;
    fields.forEach((field) => {
      if (used.has(field.code)) return;
      const score = matchScore(header, field);
      if (score > bestScore) { best = field; bestScore = score; }
    });
    if (best && bestScore >= 60) used.add(best.code);
    return {
      excel: header,
      standard: best ? best.code : "",
      standardName: best ? best.name : "",
      method: bestScore >= 100 ? "自动匹配" : bestScore >= 60 ? "模糊匹配" : "未匹配",
      confidence: bestScore,
      required: best ? !!(best.required || best.requiredByRule) : false,
      status: bestScore >= 90 ? "已确认" : bestScore >= 60 ? "待确认" : "不适用"
    };
  });
  const mapped = new Set(mappings.filter((item) => item.standard).map((item) => item.standard));
  const missing = (product.requiredFields || []).filter((code) => !mapped.has(code));
  return {
    mappings,
    stats: {
      headers: headers.length,
      mapped: mapped.size,
      confirmed: mappings.filter((item) => item.status === "已确认").length,
      pending: mappings.filter((item) => item.status === "待确认").length,
      missingRequired: missing.length,
      notApplicable: mappings.filter((item) => item.status === "不适用").length
    },
    missingRequired: missing
  };
}

function cleanName(value) {
  return String(value == null ? "" : value)
    .toLowerCase()
    .replace(/[（(].*?[）)]/g, "")
    .replace(/(明细|数据|清单|台账|表)$/g, "")
    .replace(/[\s_\-/\\()（）:：,，.。]+/g, "");
}

export function identifyDatasets(datasets, products) {
  const list = Array.isArray(products) ? products : [];
  return (datasets || []).map((dataset) => {
    if (dataset.productCode && dataset.confirmedAt) return dataset;
    const headers = (dataset.headers || []).map((header) => String(header || ""));
    const sheetRaw = String(dataset.sheet || "");
    const sheet = cleanName(sheetRaw);
    const scored = list.map((product) => {
      let score = 0;
      const name = cleanName(product.name);
      const code = cleanName(product.code);
      const category = cleanName(product.category);
      if (name && sheet === name) score += 60;
      else if (name && sheet && (sheet.includes(name) || name.includes(sheet))) score += 48;
      if (code && (sheet.includes(code) || headers.some((header) => cleanName(header).includes(code)))) score += 40;
      if (category && sheet.includes(category)) score += 25;
      let headerHits = 0;
      (product.fields || []).forEach((field) => {
        if (headers.some((header) => matchScore(header, field) >= 70)) headerHits += 1;
      });
      score += Math.min(40, headerHits * 4);
      if (headers.some((header) => /金额|余额|价值|amount|value|balance/i.test(header))) score += 10;
      return { product, score: Math.min(99, score), headerHits };
    }).sort((a, b) => b.score - a.score);
    const best = scored[0];
    const confidence = best ? best.score : 0;
    const level = confidence >= 80 ? "HIGH" : confidence >= 55 ? "MEDIUM" : "LOW";
    return {
      ...dataset,
      productCode: dataset.productCode || (best ? best.product.code : ""),
      productName: dataset.productName || (best ? best.product.name : ""),
      confidence: dataset.confidence != null ? dataset.confidence : confidence,
      level: dataset.level || level,
      candidates: scored.slice(0, 3).filter((item) => item.score > 0).map((item) => ({
        code: item.product.code, name: item.product.name, score: item.score
      })),
      confirmedAt: dataset.confirmedAt || null
    };
  });
}

function rowValue(row, mapping, fieldCodes) {
  for (const code of fieldCodes) {
    const header = (mapping || {})[code];
    if (header && row[header] != null && row[header] !== "") return row[header];
    if (row[code] != null && row[code] !== "") return row[code];
  }
  return null;
}

function toNumber(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = String(value).replace(/[,，\s]/g, "").replace(/[（(]/g, "-").replace(/[）)]/g, "");
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

export function effectiveMapping(dataset) {
  const mapping = dataset.mapping || {};
  const out = {};
  Object.entries(mapping).forEach(([standard, excel]) => {
    if (excel && !standard.startsWith("__")) out[standard] = excel;
  });
  return out;
}

export function qualityDataset(dataset, product) {
  const rows = dataset.rows || [];
  const mapping = effectiveMapping(dataset);
  const amountCodes = ["amount", "book_value", "fair_value", "undrawn_amount"];
  const hasAmount = amountCodes.some((code) => mapping[code]);
  const required = product.requiredFields || [];
  const mapped = new Set(Object.keys(mapping));
  const missingRequired = required.filter((code) => !mapped.has(code));
  const badFormat = [];
  const missingAmount = [];
  const negative = [];
  const seen = new Map();
  const duplicate = [];
  rows.forEach((row, index) => {
    const amount = toNumber(rowValue(row, mapping, amountCodes));
    if (amount == null || amount === 0) missingAmount.push(index + 1);
    else if (amount < 0) negative.push(index + 1);
    if (amount == null && hasAmount && rowValue(row, mapping, amountCodes) != null) badFormat.push(index + 1);
    const key = rowValue(row, mapping, ["business_id"]);
    if (key != null && key !== "") {
      const text = String(key);
      if (seen.has(text)) duplicate.push(text);
      else seen.set(text, index + 1);
    }
  });
  const checks = [
    {
      type: "字段完整性",
      detail: missingRequired.length ? `缺少规则引用字段：${missingRequired.join(", ")}` : `${required.length} 个规则必需字段均已映射`,
      total: required.length,
      failed: missingRequired.length,
      status: hasAmount && !missingRequired.length ? "PASS" : !hasAmount ? "BLOCK" : "WARN",
      rows: missingRequired
    },
    {
      type: "金额格式",
      detail: badFormat.length ? `${badFormat.length} 行金额无法解析` : "金额列可解析",
      total: rows.length,
      failed: badFormat.length,
      status: badFormat.length ? "WARN" : "PASS",
      rows: badFormat
    },
    {
      type: "金额缺失",
      detail: missingAmount.length ? `${missingAmount.length} 行金额为空或为 0` : "每行都有金额",
      total: rows.length,
      failed: missingAmount.length,
      status: missingAmount.length ? "WARN" : "PASS",
      rows: missingAmount
    },
    {
      type: "业务主键重复",
      detail: duplicate.length ? `${duplicate.length} 个业务编号重复` : "业务编号唯一",
      total: rows.length,
      failed: duplicate.length,
      status: duplicate.length ? "WARN" : "PASS",
      rows: duplicate
    },
    {
      type: "负值金额",
      detail: negative.length ? `${negative.length} 行金额为负` : "没有负值金额",
      total: rows.length,
      failed: negative.length,
      status: negative.length ? "WARN" : "PASS",
      rows: negative
    }
  ];
  const status = checks.some((check) => check.status === "BLOCK") ? "BLOCK"
    : checks.some((check) => check.status === "WARN") ? "WARN" : "PASS";
  return { status, checks, amountMapped: hasAmount, missingRequired };
}

// ---------------------------------------------------------------- 计算输入

export async function lcrInput(task) {
  const cfg = task.cfg || {};
  const jurisdiction = String(cfg.jurisdiction || "HK").toUpperCase();
  const version = String(cfg.ruleVersion || "").trim();
  if (!version) throw fail(400, "任务还没有选择监管规则版本");
  const [productRows, fieldRows, tableRows, paramRows] = await Promise.all([
    query("SELECT * FROM liquidity_product WHERE jurisdiction = ? AND rule_version = ? AND status <> 'DISABLED'", [jurisdiction, version]),
    query("SELECT * FROM liquidity_product_field WHERE jurisdiction = ? AND rule_version = ? ORDER BY product_code, sort_order, id", [jurisdiction, version]),
    query("SELECT * FROM liquidity_param_table WHERE jurisdiction = ? AND rule_version = ?", [jurisdiction, version]),
    query("SELECT * FROM liquidity_param WHERE jurisdiction = ? AND rule_version = ?", [jurisdiction, version])
  ]);
  const fieldsByProduct = {};
  fieldRows.forEach((row) => {
    (fieldsByProduct[row.product_code] = fieldsByProduct[row.product_code] || []).push(fieldOut(row));
  });
  return {
    task: {
      id: task.id,
      name: task.name,
      baseDate: task.baseDate,
      config: cfg,
      datasets: task.datasets || []
    },
    products: productRows.map((row) => ({
      code: row.code, name: row.name, side: row.side, paramKey: row.param_key,
      category: row.category, group: row.product_group,
      fields: fieldsByProduct[row.code] || []
    })),
    tables: tableRows.map((row) => ({ id: row.table_id, kind: row.kind, rows: parseJson(row.rows_json, []) })),
    params: paramRows.map((row) => ({ id: row.param_id, name: row.name, value: Number(row.value), unit: row.unit }))
  };
}
