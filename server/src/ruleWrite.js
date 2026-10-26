import { pool, query } from "./db.js";

const VERSION_STATUS = ["draft", "reviewing", "published", "superseded", "disabled"];
const ONBOARDING = ["column", "manual"];
const FIELD_TYPES = ["number", "enum"];
const MAP_STATUS = ["ok", "warn", "missing"];
const SUBSTITUTE = ["collateral", "guarantor", "provider"];

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  throw err;
}

async function write(fn, duplicateMessage) {
  try {
    return await fn();
  } catch (err) {
    if (err && (err.code === "ER_DUP_ENTRY" || err.errno === 1062)) fail(400, duplicateMessage);
    throw err;
  }
}

async function tx(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const q = async (sql, params) => {
      const [rows] = await conn.query(sql, params);
      return rows;
    };
    const result = await fn(q);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

function text(body, key, label, max, required = true) {
  const value = String(body[key] == null ? "" : body[key]).trim();
  if (!value && required) fail(400, label + "不能为空");
  if (value.length > max) fail(400, label + "不能超过 " + max + " 个字");
  return value;
}

function keyOf(value, label) {
  const id = String(value == null ? "" : value).trim();
  if (!id) fail(400, label + "不能为空");
  if (/[\s/\\?#]/.test(id)) fail(400, label + "不能包含空格或 / \\ ? #");
  return id;
}

function oneOf(value, label, allowed) {
  const picked = String(value == null ? "" : value).trim();
  if (!allowed.includes(picked)) fail(400, label + "不在可选范围内");
  return picked;
}

function integer(value, label, { min = -2147483648, max = 2147483647 } = {}) {
  if (typeof value === "boolean" || value === "" || value == null) fail(400, label + "要是整数");
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) fail(400, label + "要是整数");
  return n;
}

function flag(value, label) {
  if (value === true || value === 1 || value === "1" || value === "true") return 1;
  if (value === false || value === 0 || value === "0" || value === "false") return 0;
  fail(400, label + "要是是或否");
}

function day(value, label, required = false) {
  const textValue = String(value == null ? "" : value).trim();
  if (!textValue) {
    if (required) fail(400, label + "不能为空");
    return null;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(textValue)) fail(400, label + "要用 YYYY-MM-DD");
  const [year, month, date] = textValue.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, date));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== date) {
    fail(400, label + "不是有效日期");
  }
  return textValue;
}

function strings(value, label, maxItem, maxCount) {
  if (value == null || value === "") return [];
  if (!Array.isArray(value)) fail(400, label + "要是列表");
  if (value.length > maxCount) fail(400, label + "条数过多");
  const seen = new Set();
  const list = [];
  value.forEach((item) => {
    const textValue = String(item == null ? "" : item).trim();
    if (!textValue) fail(400, label + "不能有空项");
    if (textValue.length > maxItem) fail(400, label + "里有超长的一项");
    if (seen.has(textValue)) return;
    seen.add(textValue);
    list.push(textValue);
  });
  return list;
}

function jsonArray(value, label, maxItem) {
  const list = strings(value, label, maxItem, 40);
  if (!list.length) fail(400, label + "不能为空");
  return list;
}

async function requireJurisdiction(q, code) {
  const id = keyOf(code, "地区");
  if (id.length > 2) fail(400, "地区不能超过 2 个字");
  const rows = await q("SELECT code FROM jurisdiction WHERE code = ?", [id]);
  if (!rows[0]) fail(400, "地区不存在");
  return id;
}

async function requireProduct(q, code) {
  const id = keyOf(code, "产品");
  if (id.length > 32) fail(400, "产品不能超过 32 个字");
  const rows = await q("SELECT code FROM product_type WHERE code = ?", [id]);
  if (!rows[0]) fail(400, "产品不存在");
  return id;
}

function versionFields(body) {
  return {
    jurisdiction: null,
    version: text(body, "version", "版本编号", 40),
    name: text(body, "name", "规则名称", 128),
    ruleType: text(body, "ruleType", "规则类型", 32),
    effectiveFrom: day(body.effectiveFrom, "生效日期"),
    effectiveTo: day(body.effectiveTo, "失效日期"),
    status: oneOf(body.status, "状态", VERSION_STATUS),
    institution: text(body, "institution", "适用机构", 64),
    rulesetFile: text(body, "rulesetFile", "规则文件", 64),
    publishedAt: text(body, "publishedAt", "发布时间", 32),
    author: text(body, "author", "维护人", 64),
    changelog: text(body, "changelog", "变更说明", 65535)
  };
}

async function versionRow(q, id) {
  const rows = await q("SELECT * FROM rule_version WHERE id = ?", [id]);
  if (!rows[0]) fail(404, "版本不存在");
  return rows[0];
}

export async function createRuleVersion(body) {
  const id = keyOf(body.id, "编号");
  if (id.length > 40) fail(400, "编号不能超过 40 个字");
  const fields = versionFields(body);
  return write(async () => tx(async (q) => {
    fields.jurisdiction = await requireJurisdiction(q, body.jurisdiction);
    await q(
      `INSERT INTO rule_version
        (id, jurisdiction, version, name, rule_type, effective_from, effective_to, status, institution, ruleset_file, published_at, author, changelog)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, fields.jurisdiction, fields.version, fields.name, fields.ruleType, fields.effectiveFrom, fields.effectiveTo, fields.status, fields.institution, fields.rulesetFile, fields.publishedAt, fields.author, fields.changelog]
    );
    return versionRow(q, id);
  }), "编号已存在");
}

export async function updateRuleVersion(id, body) {
  const key = keyOf(id, "编号");
  const fields = versionFields(body);
  return write(async () => tx(async (q) => {
    await versionRow(q, key);
    fields.jurisdiction = await requireJurisdiction(q, body.jurisdiction);
    await q(
      `UPDATE rule_version SET jurisdiction = ?, version = ?, name = ?, rule_type = ?, effective_from = ?, effective_to = ?, status = ?, institution = ?, ruleset_file = ?, published_at = ?, author = ?, changelog = ? WHERE id = ?`,
      [fields.jurisdiction, fields.version, fields.name, fields.ruleType, fields.effectiveFrom, fields.effectiveTo, fields.status, fields.institution, fields.rulesetFile, fields.publishedAt, fields.author, fields.changelog, key]
    );
    return versionRow(q, key);
  }), "版本编号已存在");
}

async function orgRow(q, id) {
  const rows = await q("SELECT id, name, jurisdiction FROM org_unit WHERE id = ?", [id]);
  if (!rows[0]) fail(404, "机构不存在");
  return rows[0];
}

async function orgFields(q, body) {
  const name = text(body, "name", "名称", 64);
  const jurisdiction = await requireJurisdiction(q, body.jurisdiction);
  return { name, jurisdiction };
}

async function orgNameTaken(q, name, jurisdiction, exceptId) {
  const rows = await q(
    "SELECT id FROM org_unit WHERE name = ? AND jurisdiction = ? AND id <> ? LIMIT 1",
    [name, jurisdiction, exceptId || ""]
  );
  if (rows[0]) fail(400, "这个地区已经有同名机构");
}

async function orgUsed(q, name, jurisdiction) {
  const [versions, batches] = await Promise.all([
    q("SELECT id FROM rule_version WHERE institution = ? AND jurisdiction = ? LIMIT 1", [name, jurisdiction]),
    q("SELECT id FROM measure_batch WHERE institution = ? AND jurisdiction = ? LIMIT 1", [name, jurisdiction])
  ]);
  return !!(versions[0] || batches[0]);
}

export async function createOrg(body) {
  const id = keyOf(body.id, "编号");
  if (id.length > 32) fail(400, "编号不能超过 32 个字");
  return write(() => tx(async (q) => {
    const fields = await orgFields(q, body);
    await orgNameTaken(q, fields.name, fields.jurisdiction, "");
    await q(
      "INSERT INTO org_unit (id, name, jurisdiction) VALUES (?, ?, ?)",
      [id, fields.name, fields.jurisdiction]
    );
    return orgRow(q, id);
  }), "编号已存在");
}

export async function updateOrg(id, body) {
  const key = keyOf(id, "编号");
  return write(() => tx(async (q) => {
    const prev = await orgRow(q, key);
    const fields = await orgFields(q, body);
    await orgNameTaken(q, fields.name, fields.jurisdiction, key);
    if (fields.jurisdiction !== prev.jurisdiction && await orgUsed(q, prev.name, prev.jurisdiction)) {
      fail(400, "这个机构还被规则版本或计量批次引用，不能改地区");
    }
    await q("UPDATE org_unit SET name = ?, jurisdiction = ? WHERE id = ?", [fields.name, fields.jurisdiction, key]);
    if (fields.name !== prev.name && fields.jurisdiction === prev.jurisdiction) {
      await q(
        "UPDATE rule_version SET institution = ? WHERE institution = ? AND jurisdiction = ?",
        [fields.name, prev.name, prev.jurisdiction]
      );
      await q(
        "UPDATE measure_batch SET institution = ? WHERE institution = ? AND jurisdiction = ?",
        [fields.name, prev.name, prev.jurisdiction]
      );
    }
    return orgRow(q, key);
  }), "编号已存在");
}

export async function deleteOrg(id) {
  const key = keyOf(id, "编号");
  await tx(async (q) => {
    const row = await orgRow(q, key);
    if (await orgUsed(q, row.name, row.jurisdiction)) fail(400, "这个机构还被规则版本或计量批次引用");
    await q("DELETE FROM org_unit WHERE id = ?", [key]);
  });
}

export async function deleteRuleVersion(id) {
  const key = keyOf(id, "编号");
  await tx(async (q) => {
    const row = await versionRow(q, key);
    const [products, ead, rules, batches] = await Promise.all([
      q("SELECT code FROM product_type WHERE rule_version = ? LIMIT 1", [row.version]),
      q("SELECT product_code FROM ead_product_config WHERE version = ? LIMIT 1", [row.version]),
      q("SELECT id FROM product_exposure_rule WHERE version = ? LIMIT 1", [row.version]),
      q("SELECT id FROM measure_batch WHERE version = ? LIMIT 1", [row.version])
    ]);
    if (products[0] || ead[0] || rules[0] || batches[0]) fail(400, "这个版本还被产品、EAD、专属规则或计量批次引用");
    await q("DELETE FROM rule_version WHERE id = ?", [key]);
  });
}

function clauseFields(body) {
  return {
    doc: text(body, "doc", "制度", 128),
    docVersion: text(body, "docVersion", "制度版本", 32),
    clause: text(body, "clause", "条款编号", 32),
    title: text(body, "title", "标题", 128),
    text: text(body, "text", "原文", 65535),
    scope: text(body, "scope", "适用范围", 255, false),
    effectiveFrom: day(body.effectiveFrom, "生效日期"),
    source: text(body, "source", "来源", 255, false),
    referencedBy: strings(body.referencedBy, "引用规则", 80, 80)
  };
}

async function clauseRow(q, id) {
  const rows = await q("SELECT * FROM clause_doc WHERE id = ?", [id]);
  if (!rows[0]) fail(404, "条款不存在");
  const refs = await q("SELECT rule_name FROM clause_ref WHERE clause_id = ? ORDER BY rule_name", [id]);
  return { row: rows[0], referencedBy: refs.map((item) => item.rule_name) };
}

async function saveClauseRefs(q, id, names) {
  await q("DELETE FROM clause_ref WHERE clause_id = ?", [id]);
  for (const name of names) {
    await q("INSERT INTO clause_ref (clause_id, rule_name) VALUES (?, ?)", [id, name]);
  }
}

export async function createClause(body) {
  const id = keyOf(body.id, "编号");
  if (id.length > 32) fail(400, "编号不能超过 32 个字");
  const fields = clauseFields(body);
  return write(async () => tx(async (q) => {
    const jurisdiction = await requireJurisdiction(q, body.jurisdiction);
    await q(
      `INSERT INTO clause_doc
        (id, jurisdiction, doc, doc_version, clause_no, title, body, scope, effective_from, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, jurisdiction, fields.doc, fields.docVersion, fields.clause, fields.title, fields.text, fields.scope, fields.effectiveFrom, fields.source]
    );
    await saveClauseRefs(q, id, fields.referencedBy);
    return clauseRow(q, id);
  }), "编号已存在");
}

export async function updateClause(id, body) {
  const key = keyOf(id, "编号");
  const fields = clauseFields(body);
  return write(async () => tx(async (q) => {
    await clauseRow(q, key);
    const jurisdiction = await requireJurisdiction(q, body.jurisdiction);
    await q(
      `UPDATE clause_doc SET jurisdiction = ?, doc = ?, doc_version = ?, clause_no = ?, title = ?, body = ?, scope = ?, effective_from = ?, source = ? WHERE id = ?`,
      [jurisdiction, fields.doc, fields.docVersion, fields.clause, fields.title, fields.text, fields.scope, fields.effectiveFrom, fields.source, key]
    );
    await saveClauseRefs(q, key, fields.referencedBy);
    return clauseRow(q, key);
  }), "条款已存在");
}

export async function deleteClause(id) {
  const key = keyOf(id, "编号");
  await tx(async (q) => {
    await clauseRow(q, key);
    const [rules, ead] = await Promise.all([
      q("SELECT id FROM product_exposure_rule WHERE clause_id = ? LIMIT 1", [key]),
      q("SELECT id FROM ead_product_rule WHERE clause_id = ? LIMIT 1", [key])
    ]);
    if (rules[0] || ead[0]) fail(400, "这条条款还被专属规则或 EAD 规则引用");
    await q("DELETE FROM clause_ref WHERE clause_id = ?", [key]);
    await q("DELETE FROM clause_doc WHERE id = ?", [key]);
  });
}

function paramFields(body) {
  return {
    grp: text(body, "grp", "分组", 32),
    name: text(body, "name", "名称", 64),
    value: text(body, "value", "参数值", 32),
    unit: text(body, "unit", "单位", 16, false),
    usedFor: text(body, "usedFor", "用途", 255, false)
  };
}

async function paramRow(q, id) {
  const rows = await q("SELECT id, grp, name, value, unit, used_for AS usedFor FROM rule_param WHERE id = ?", [id]);
  if (!rows[0]) fail(404, "参数不存在");
  return rows[0];
}

export async function createParam(body) {
  const id = keyOf(body.id, "编号");
  if (id.length > 32) fail(400, "编号不能超过 32 个字");
  const fields = paramFields(body);
  return write(async () => {
    await query(
      "INSERT INTO rule_param (id, grp, name, value, unit, used_for) VALUES (?, ?, ?, ?, ?, ?)",
      [id, fields.grp, fields.name, fields.value, fields.unit, fields.usedFor]
    );
    return paramRow(query, id);
  }, "编号已存在");
}

export async function updateParam(id, body) {
  const key = keyOf(id, "编号");
  const current = await paramRow(query, key);
  const valueOnly = body && body.value != null && body.grp == null && body.name == null && body.unit == null && body.usedFor == null;
  const fields = valueOnly
    ? { grp: current.grp, name: current.name, value: text(body, "value", "参数值", 32), unit: current.unit, usedFor: current.usedFor }
    : paramFields(body);
  await query(
    "UPDATE rule_param SET grp = ?, name = ?, value = ?, unit = ?, used_for = ? WHERE id = ?",
    [fields.grp, fields.name, fields.value, fields.unit, fields.usedFor, key]
  );
  return paramRow(query, key);
}

export async function deleteParam(id) {
  const key = keyOf(id, "编号");
  await tx(async (q) => {
    await paramRow(q, key);
    const [grades, ccf, ead] = await Promise.all([
      q("SELECT id FROM bank_grade_row WHERE param_id = ? LIMIT 1", [key]),
      q("SELECT id FROM ccf_rule WHERE JSON_SEARCH(conds_json, 'one', ?) IS NOT NULL LIMIT 1", [key]),
      q("SELECT id FROM ead_product_rule WHERE JSON_SEARCH(params_json, 'one', ?) IS NOT NULL LIMIT 1", [key])
    ]);
    if (grades[0] || ccf[0] || ead[0]) fail(400, "这个参数还被银行评级档、转换系数或 EAD 规则引用");
    await q("DELETE FROM rule_param WHERE id = ?", [key]);
  });
}

function productFields(body) {
  return {
    label: text(body, "label", "名称", 64),
    icon: text(body, "icon", "图标", 8),
    color: text(body, "color", "颜色", 16),
    desc: text(body, "desc", "说明", 255),
    ruleVersion: text(body, "ruleVersion", "规则版本", 40),
    onboarding: oneOf(body.onboarding, "接入方式", ONBOARDING),
    sampleCount: integer(body.sampleCount, "样例笔数", { min: 0 }),
    system: text(body, "system", "来源系统", 80)
  };
}

async function productRow(q, code) {
  const rows = await q(
    `SELECT p.*, (SELECT COUNT(*) FROM product_field f WHERE f.product_code = p.code) AS field_count
     FROM product_type p WHERE p.code = ?`,
    [code]
  );
  if (!rows[0]) fail(404, "产品不存在");
  return rows[0];
}

export function productBody(row) {
  return {
    code: row.code,
    label: row.label,
    icon: row.icon,
    color: row.color,
    desc: row.description,
    ruleVersion: row.rule_version,
    sampleCount: row.sample_count,
    system: row.source_system,
    onboarding: row.onboarding,
    fieldCount: Number(row.field_count)
  };
}

export async function createProduct(body) {
  const code = keyOf(body.code, "产品编码");
  if (code.length > 32) fail(400, "产品编码不能超过 32 个字");
  const fields = productFields(body);
  return write(async () => {
    await query(
      `INSERT INTO product_type (code, label, icon, color, description, rule_version, onboarding, sample_count, source_system)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [code, fields.label, fields.icon, fields.color, fields.desc, fields.ruleVersion, fields.onboarding, fields.sampleCount, fields.system]
    );
    return productBody(await productRow(query, code));
  }, "产品编码已存在");
}

export async function updateProduct(code, body) {
  const key = await requireProduct(query, code);
  const fields = productFields(body);
  await query(
    `UPDATE product_type SET label = ?, icon = ?, color = ?, description = ?, rule_version = ?, onboarding = ?, sample_count = ?, source_system = ? WHERE code = ?`,
    [fields.label, fields.icon, fields.color, fields.desc, fields.ruleVersion, fields.onboarding, fields.sampleCount, fields.system, key]
  );
  return productBody(await productRow(query, key));
}

export async function deleteProduct(code) {
  const key = await requireProduct(query, code);
  await tx(async (q) => {
    await q("DELETE FROM product_field WHERE product_code = ?", [key]);
    await q("DELETE FROM field_mapping WHERE product_code = ?", [key]);
    await q("DELETE FROM ead_product_rule WHERE product_code = ?", [key]);
    await q("DELETE FROM ead_product_config WHERE product_code = ?", [key]);
    await q("DELETE FROM crm_slot_column WHERE product_code = ?", [key]);
    await q("DELETE FROM crm_eligible_type WHERE product_code = ?", [key]);
    await q("DELETE FROM crm_product_config WHERE product_code = ?", [key]);
    await q("DELETE FROM product_exposure_rule WHERE product_code = ?", [key]);
    await q("DELETE FROM product_type WHERE code = ?", [key]);
  });
}

function fieldFields(body) {
  return {
    name: text(body, "name", "标准字段名称", 64),
    meaning: text(body, "meaning", "含义", 255),
    type: oneOf(body.type, "数据类型", FIELD_TYPES),
    unit: text(body, "unit", "单位", 16, false),
    required: flag(body.required, "必填"),
    sourceSystem: text(body, "sourceSystem", "来源系统", 80, false),
    sourceField: text(body, "sourceField", "来源字段", 80, false),
    transform: text(body, "transform", "转换规则", 255, false),
    validate: text(body, "validate", "校验规则", 255, false),
    options: strings(body.options, "枚举取值", 80, 40),
    referencedBy: strings(body.referencedBy, "被引用条款", 32, 40),
    stdField: text(body, "stdField", "对应规则字段", 64, false) || null
  };
}

async function fieldRow(q, product, code) {
  const rows = await q("SELECT * FROM product_field WHERE product_code = ? AND code = ?", [product, code]);
  if (!rows[0]) fail(404, "字段不存在");
  return rows[0];
}

export function fieldBody(row) {
  let options = row.options_json;
  let referenced = row.referenced_json;
  if (typeof options === "string") options = JSON.parse(options);
  if (typeof referenced === "string") referenced = JSON.parse(referenced);
  return {
    code: row.code,
    name: row.name,
    meaning: row.meaning,
    type: row.data_type,
    unit: row.unit,
    required: !!row.required,
    sourceSystem: row.source_system,
    sourceField: row.source_field,
    transform: row.transform_rule,
    validate: row.validate_rule,
    options: options || [],
    referencedBy: referenced || [],
    stdField: row.std_field
  };
}

export async function createField(product, body) {
  const productCode = await requireProduct(query, product);
  const code = keyOf(body.code, "字段编码");
  if (code.length > 32) fail(400, "字段编码不能超过 32 个字");
  const fields = fieldFields(body);
  return write(async () => {
    await query(
      `INSERT INTO product_field
        (product_code, code, name, meaning, data_type, unit, required, source_system, source_field, transform_rule, validate_rule, options_json, referenced_json, std_field)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [productCode, code, fields.name, fields.meaning, fields.type, fields.unit, fields.required, fields.sourceSystem, fields.sourceField, fields.transform, fields.validate, JSON.stringify(fields.options), JSON.stringify(fields.referencedBy), fields.stdField]
    );
    return fieldBody(await fieldRow(query, productCode, code));
  }, "字段编码已存在");
}

export async function updateField(product, code, body) {
  const productCode = await requireProduct(query, product);
  const key = keyOf(code, "字段编码");
  const fields = fieldFields(body);
  await fieldRow(query, productCode, key);
  await query(
    `UPDATE product_field SET name = ?, meaning = ?, data_type = ?, unit = ?, required = ?, source_system = ?, source_field = ?, transform_rule = ?, validate_rule = ?, options_json = ?, referenced_json = ?, std_field = ? WHERE product_code = ? AND code = ?`,
    [fields.name, fields.meaning, fields.type, fields.unit, fields.required, fields.sourceSystem, fields.sourceField, fields.transform, fields.validate, JSON.stringify(fields.options), JSON.stringify(fields.referencedBy), fields.stdField, productCode, key]
  );
  return fieldBody(await fieldRow(query, productCode, key));
}

export async function deleteField(product, code) {
  const productCode = await requireProduct(query, product);
  const key = keyOf(code, "字段编码");
  const ret = await query("DELETE FROM product_field WHERE product_code = ? AND code = ?", [productCode, key]);
  if (!ret.affectedRows) fail(404, "字段不存在");
}

function mappingFields(body) {
  return {
    product: null,
    stdField: text(body, "stdField", "标准字段", 64),
    stdCode: text(body, "stdCode", "标准编码", 64),
    srcSystem: text(body, "srcSystem", "源系统", 80),
    srcField: text(body, "srcField", "源字段", 80),
    via: text(body, "via", "转换", 255, false),
    status: oneOf(body.status, "状态", MAP_STATUS),
    hitRate: hitRate(body.hitRate),
    sample: text(body, "sample", "样例", 255, false)
  };
}

function hitRate(value) {
  if (typeof value === "boolean" || value === "" || value == null) fail(400, "命中率不能为空");
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 99.9999) fail(400, "命中率要在 0 到 99.9999 之间");
  return Math.round(n * 10000) / 10000;
}

function mappingBody(row) {
  return {
    id: row.id,
    product: row.product_code,
    stdField: row.std_field,
    stdCode: row.std_code,
    srcSystem: row.src_system,
    srcField: row.src_field,
    via: row.via,
    status: row.status,
    hitRate: Number(row.hit_rate),
    sample: row.sample
  };
}

async function mappingRow(q, id) {
  const rows = await q("SELECT * FROM field_mapping WHERE id = ?", [id]);
  if (!rows[0]) fail(404, "映射不存在");
  return rows[0];
}

export async function createMapping(body) {
  const fields = mappingFields(body);
  return write(async () => tx(async (q) => {
    fields.product = await requireProduct(q, body.product);
    const ret = await q(
      `INSERT INTO field_mapping (product_code, std_field, std_code, src_system, src_field, via, status, hit_rate, sample)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [fields.product, fields.stdField, fields.stdCode, fields.srcSystem, fields.srcField, fields.via, fields.status, fields.hitRate, fields.sample]
    );
    return mappingBody(await mappingRow(q, ret.insertId));
  }), "映射已存在");
}

export async function updateMapping(id, body) {
  const key = integer(id, "编号", { min: 1 });
  const fields = mappingFields(body);
  return tx(async (q) => {
    await mappingRow(q, key);
    fields.product = await requireProduct(q, body.product);
    await q(
      `UPDATE field_mapping SET product_code = ?, std_field = ?, std_code = ?, src_system = ?, src_field = ?, via = ?, status = ?, hit_rate = ?, sample = ? WHERE id = ?`,
      [fields.product, fields.stdField, fields.stdCode, fields.srcSystem, fields.srcField, fields.via, fields.status, fields.hitRate, fields.sample, key]
    );
    return mappingBody(await mappingRow(q, key));
  });
}

export async function deleteMapping(id) {
  const key = integer(id, "编号", { min: 1 });
  const ret = await query("DELETE FROM field_mapping WHERE id = ?", [key]);
  if (!ret.affectedRows) fail(404, "映射不存在");
}

async function weightRow(q, id) {
  const rows = await q(
    "SELECT id, class_name AS cls, cond_text AS cond, risk_weight AS rw, priority AS pri, bank_tier AS bank, basis FROM weight_rule WHERE id = ?",
    [id]
  );
  if (!rows[0]) fail(404, "权重规则不存在");
  return rows[0];
}

function weightFields(body) {
  return {
    cls: text(body, "cls", "大类", 64),
    cond: text(body, "cond", "条件", 255),
    rw: text(body, "rw", "权重", 32),
    pri: integer(body.pri, "优先级"),
    bank: text(body, "bank", "档", 16),
    basis: text(body, "basis", "依据", 255)
  };
}

export async function createWeightRule(body) {
  const id = keyOf(body.id, "编号");
  if (id.length > 40) fail(400, "编号不能超过 40 个字");
  const fields = weightFields(body);
  return write(async () => {
    await query(
      "INSERT INTO weight_rule (id, class_name, cond_text, risk_weight, priority, bank_tier, basis) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [id, fields.cls, fields.cond, fields.rw, fields.pri, fields.bank, fields.basis]
    );
    return weightRow(query, id);
  }, "编号已存在");
}

export async function updateWeightRule(id, body) {
  const key = keyOf(id, "编号");
  const fields = weightFields(body);
  await weightRow(query, key);
  await query(
    "UPDATE weight_rule SET class_name = ?, cond_text = ?, risk_weight = ?, priority = ?, bank_tier = ?, basis = ? WHERE id = ?",
    [fields.cls, fields.cond, fields.rw, fields.pri, fields.bank, fields.basis, key]
  );
  return weightRow(query, key);
}

export async function deleteWeightRule(id) {
  const key = keyOf(id, "编号");
  await tx(async (q) => {
    await weightRow(q, key);
    const used = await q("SELECT id FROM bank_grade_row WHERE JSON_CONTAINS(ids_json, JSON_QUOTE(?)) LIMIT 1", [key]);
    if (used[0]) fail(400, "这条权重还被银行评级档引用");
    await q("DELETE FROM weight_rule WHERE id = ?", [key]);
  });
}

function gradeBody(row) {
  let weights = row.weights_json;
  let ids = row.ids_json;
  if (typeof weights === "string") weights = JSON.parse(weights);
  if (typeof ids === "string") ids = JSON.parse(ids);
  return {
    id: row.id,
    label: row.label,
    pri: row.priority,
    basis: row.basis,
    weights: weights || [],
    ids: ids || [],
    paramId: row.param_id
  };
}

async function gradeRow(q, id) {
  const rows = await q("SELECT * FROM bank_grade_row WHERE id = ?", [id]);
  if (!rows[0]) fail(404, "评级档不存在");
  return rows[0];
}

function gradeFields(body) {
  const paramId = text(body, "paramId", "参数", 32, false);
  return {
    label: text(body, "label", "情形", 64),
    pri: integer(body.pri, "优先级"),
    basis: text(body, "basis", "依据", 128),
    weights: jsonArray(body.weights, "权重", 32),
    ids: strings(body.ids, "规则编号", 40, 40),
    paramId: paramId || null
  };
}

export async function createGrade(body) {
  const id = keyOf(body.id, "编号");
  if (id.length > 32) fail(400, "编号不能超过 32 个字");
  const fields = gradeFields(body);
  return write(async () => tx(async (q) => {
    if (fields.paramId) {
      const params = await q("SELECT id FROM rule_param WHERE id = ?", [fields.paramId]);
      if (!params[0]) fail(400, "参数不存在");
    }
    await q(
      "INSERT INTO bank_grade_row (id, label, priority, basis, weights_json, ids_json, param_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [id, fields.label, fields.pri, fields.basis, JSON.stringify(fields.weights), JSON.stringify(fields.ids), fields.paramId]
    );
    return gradeBody(await gradeRow(q, id));
  }), "编号已存在");
}

export async function updateGrade(id, body) {
  const key = keyOf(id, "编号");
  const fields = gradeFields(body);
  return tx(async (q) => {
    await gradeRow(q, key);
    if (fields.paramId) {
      const params = await q("SELECT id FROM rule_param WHERE id = ?", [fields.paramId]);
      if (!params[0]) fail(400, "参数不存在");
    }
    await q(
      "UPDATE bank_grade_row SET label = ?, priority = ?, basis = ?, weights_json = ?, ids_json = ?, param_id = ? WHERE id = ?",
      [fields.label, fields.pri, fields.basis, JSON.stringify(fields.weights), JSON.stringify(fields.ids), fields.paramId, key]
    );
    return gradeBody(await gradeRow(q, key));
  });
}

export async function deleteGrade(id) {
  const key = keyOf(id, "编号");
  const ret = await query("DELETE FROM bank_grade_row WHERE id = ?", [key]);
  if (!ret.affectedRows) fail(404, "评级档不存在");
}

function moBody(row) {
  let weights = row.weights_json;
  if (typeof weights === "string") weights = JSON.parse(weights);
  return { id: row.id, bucket: row.bucket, weights: weights || [], note: row.note };
}

async function moRow(q, id) {
  const rows = await q("SELECT * FROM mo_weight_row WHERE id = ?", [id]);
  if (!rows[0]) fail(404, "澳门评级档不存在");
  return rows[0];
}

export async function createMoWeight(body) {
  const id = keyOf(body.id, "编号");
  if (id.length > 32) fail(400, "编号不能超过 32 个字");
  const bucket = text(body, "bucket", "类别", 64);
  const weights = jsonArray(body.weights, "权重", 32);
  const note = text(body, "note", "说明", 255, false);
  return write(async () => {
    await query(
      "INSERT INTO mo_weight_row (id, bucket, weights_json, note) VALUES (?, ?, ?, ?)",
      [id, bucket, JSON.stringify(weights), note]
    );
    return moBody(await moRow(query, id));
  }, "编号已存在");
}

export async function updateMoWeight(id, body) {
  const key = keyOf(id, "编号");
  const bucket = text(body, "bucket", "类别", 64);
  const weights = jsonArray(body.weights, "权重", 32);
  const note = text(body, "note", "说明", 255, false);
  await moRow(query, key);
  await query(
    "UPDATE mo_weight_row SET bucket = ?, weights_json = ?, note = ? WHERE id = ?",
    [bucket, JSON.stringify(weights), note, key]
  );
  return moBody(await moRow(query, key));
}

export async function deleteMoWeight(id) {
  const key = keyOf(id, "编号");
  const ret = await query("DELETE FROM mo_weight_row WHERE id = ?", [key]);
  if (!ret.affectedRows) fail(404, "澳门评级档不存在");
}

function ccfBody(row) {
  let conds = row.conds_json;
  if (typeof conds === "string") {
    try { conds = JSON.parse(conds); } catch { conds = null; }
  }
  return { id: row.id, type: row.type_name, cond: row.cond_text, ccf: row.ccf, pri: row.priority, conds: conds || null };
}

async function ccfRow(q, id) {
  const rows = await q("SELECT * FROM ccf_rule WHERE id = ?", [id]);
  if (!rows[0]) fail(404, "转换系数不存在");
  return rows[0];
}

function ccfFields(body) {
  let conds = body.conds;
  if (conds == null || conds === "") conds = null;
  else if (!Array.isArray(conds)) fail(400, "条件要是 JSON 数组");
  return {
    type: text(body, "type", "类型", 128),
    cond: text(body, "cond", "条件", 255),
    ccf: text(body, "ccf", "系数", 16),
    pri: integer(body.pri, "优先级"),
    conds
  };
}

export async function createCcf(body) {
  const id = keyOf(body.id, "编号");
  if (id.length > 32) fail(400, "编号不能超过 32 个字");
  const fields = ccfFields(body);
  return write(async () => {
    await query(
      "INSERT INTO ccf_rule (id, type_name, cond_text, ccf, priority, conds_json) VALUES (?, ?, ?, ?, ?, ?)",
      [id, fields.type, fields.cond, fields.ccf, fields.pri, fields.conds ? JSON.stringify(fields.conds) : null]
    );
    return ccfBody(await ccfRow(query, id));
  }, "编号已存在");
}

export async function updateCcf(id, body) {
  const key = keyOf(id, "编号");
  const fields = ccfFields(body);
  await ccfRow(query, key);
  await query(
    "UPDATE ccf_rule SET type_name = ?, cond_text = ?, ccf = ?, priority = ?, conds_json = ? WHERE id = ?",
    [fields.type, fields.cond, fields.ccf, fields.pri, fields.conds ? JSON.stringify(fields.conds) : null, key]
  );
  return ccfBody(await ccfRow(query, key));
}

export async function deleteCcf(id) {
  const key = keyOf(id, "编号");
  const ret = await query("DELETE FROM ccf_rule WHERE id = ?", [key]);
  if (!ret.affectedRows) fail(404, "转换系数不存在");
}

function crmBody(row) {
  let constraints = row.constraints_json;
  if (typeof constraints === "string") constraints = JSON.parse(constraints);
  return {
    id: row.id,
    type: row.type_name,
    tool: row.tool,
    substitute: row.substitute,
    floorParam: row.floor_param,
    constraints: constraints || { maturity: false, currency: false, correlation: false },
    pri: row.priority
  };
}

async function crmRow(q, id) {
  const rows = await q("SELECT * FROM crm_rule WHERE id = ?", [id]);
  if (!rows[0]) fail(404, "缓释规则不存在");
  return rows[0];
}

function crmFields(body) {
  const src = body.constraints;
  if (!src || typeof src !== "object" || Array.isArray(src)) fail(400, "不计入条件要一起提交");
  return {
    type: text(body, "type", "类型", 32),
    tool: text(body, "tool", "合格工具", 255),
    substitute: oneOf(body.substitute, "覆盖部分", SUBSTITUTE),
    floorParam: text(body, "floorParam", "底线参数", 32, false),
    constraints: {
      maturity: !!src.maturity,
      currency: !!src.currency,
      correlation: !!src.correlation
    },
    pri: integer(body.pri, "优先级")
  };
}

export async function createCrmRule(body) {
  const id = keyOf(body.id, "编号");
  if (id.length > 32) fail(400, "编号不能超过 32 个字");
  const fields = crmFields(body);
  return write(async () => {
    await query(
      "INSERT INTO crm_rule (id, type_name, tool, substitute, floor_param, constraints_json, priority) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [id, fields.type, fields.tool, fields.substitute, fields.floorParam, JSON.stringify(fields.constraints), fields.pri]
    );
    return crmBody(await crmRow(query, id));
  }, "编号已存在");
}

export async function updateCrmRule(id, body) {
  const key = keyOf(id, "编号");
  const fields = crmFields(body);
  await crmRow(query, key);
  await query(
    "UPDATE crm_rule SET type_name = ?, tool = ?, substitute = ?, floor_param = ?, constraints_json = ?, priority = ? WHERE id = ?",
    [fields.type, fields.tool, fields.substitute, fields.floorParam, JSON.stringify(fields.constraints), fields.pri, key]
  );
  return crmBody(await crmRow(query, key));
}

export async function deleteCrmRule(id) {
  const key = keyOf(id, "编号");
  const ret = await query("DELETE FROM crm_rule WHERE id = ?", [key]);
  if (!ret.affectedRows) fail(404, "缓释规则不存在");
}

function exposureRuleBody(row) {
  return {
    id: row.id,
    product: row.product_code,
    name: row.rule_name,
    label: row.label,
    priority: row.priority,
    version: row.version,
    when: row.when_text,
    targetClass: row.target_class,
    targetSub: row.target_sub,
    weight: row.weight_text,
    clause: row.clause_id,
    status: row.status
  };
}

async function exposureRuleRow(q, id) {
  const rows = await q("SELECT * FROM product_exposure_rule WHERE id = ?", [id]);
  if (!rows[0]) fail(404, "专属规则不存在");
  return rows[0];
}

function exposureRuleFields(body) {
  return {
    name: text(body, "name", "规则编码", 64),
    label: text(body, "label", "规则", 128),
    priority: integer(body.priority, "顺序"),
    version: text(body, "version", "规则版本", 40),
    when: text(body, "when", "条件", 255),
    targetClass: text(body, "targetClass", "暴露大类", 64),
    targetSub: text(body, "targetSub", "子类", 80, false),
    weight: text(body, "weight", "权重", 80),
    clause: text(body, "clause", "条款", 32, false),
    status: oneOf(body.status, "状态", VERSION_STATUS)
  };
}

export async function createExposureRule(body) {
  const id = keyOf(body.id, "编号");
  if (id.length > 32) fail(400, "编号不能超过 32 个字");
  const fields = exposureRuleFields(body);
  return write(async () => tx(async (q) => {
    const product = await requireProduct(q, body.product);
    if (fields.clause) {
      const clauses = await q("SELECT id FROM clause_doc WHERE id = ?", [fields.clause]);
      if (!clauses[0]) fail(400, "条款不存在");
    }
    await q(
      `INSERT INTO product_exposure_rule
        (id, product_code, rule_name, label, priority, version, when_text, target_class, target_sub, weight_text, clause_id, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, product, fields.name, fields.label, fields.priority, fields.version, fields.when, fields.targetClass, fields.targetSub, fields.weight, fields.clause, fields.status]
    );
    return exposureRuleBody(await exposureRuleRow(q, id));
  }), "编号已存在");
}

export async function updateExposureRule(id, body) {
  const key = keyOf(id, "编号");
  const fields = exposureRuleFields(body);
  return tx(async (q) => {
    await exposureRuleRow(q, key);
    const product = await requireProduct(q, body.product);
    if (fields.clause) {
      const clauses = await q("SELECT id FROM clause_doc WHERE id = ?", [fields.clause]);
      if (!clauses[0]) fail(400, "条款不存在");
    }
    await q(
      `UPDATE product_exposure_rule SET product_code = ?, rule_name = ?, label = ?, priority = ?, version = ?, when_text = ?, target_class = ?, target_sub = ?, weight_text = ?, clause_id = ?, status = ? WHERE id = ?`,
      [product, fields.name, fields.label, fields.priority, fields.version, fields.when, fields.targetClass, fields.targetSub, fields.weight, fields.clause, fields.status, key]
    );
    return exposureRuleBody(await exposureRuleRow(q, key));
  });
}

export async function deleteExposureRule(id) {
  const key = keyOf(id, "编号");
  const ret = await query("DELETE FROM product_exposure_rule WHERE id = ?", [key]);
  if (!ret.affectedRows) fail(404, "专属规则不存在");
}

function idList(body) {
  const raw = body && body.ids;
  if (!Array.isArray(raw) || raw.length === 0) fail(400, "请选择要删除的记录");
  if (raw.length > 200) fail(400, "一次最多删除 200 条");
  const seen = new Set();
  const ids = [];
  raw.forEach((item) => {
    const id = String(item == null ? "" : item).trim();
    if (!id) fail(400, "编号不能为空");
    if (seen.has(id)) return;
    seen.add(id);
    ids.push(id);
  });
  return ids;
}

async function batchDelete(body, removeOne) {
  const ids = idList(body);
  const deleted = [];
  const blocked = [];
  for (const id of ids) {
    try {
      await removeOne(id);
      deleted.push(id);
    } catch (err) {
      if (err && err.status && err.status < 500) blocked.push({ id, error: err.message });
      else throw err;
    }
  }
  return { deleted, blocked };
}

export const deleteRuleVersions = (body) => batchDelete(body, deleteRuleVersion);
export const deleteOrgs = (body) => batchDelete(body, deleteOrg);
export const deleteClauses = (body) => batchDelete(body, deleteClause);
export const deleteParams = (body) => batchDelete(body, deleteParam);
export const deleteProducts = (body) => batchDelete(body, deleteProduct);
export const deleteFields = (product, body) => batchDelete(body, (code) => deleteField(product, code));
export const deleteMappings = (body) => batchDelete(body, deleteMapping);
export const deleteWeightRules = (body) => batchDelete(body, deleteWeightRule);
export const deleteGrades = (body) => batchDelete(body, deleteGrade);
export const deleteMoWeights = (body) => batchDelete(body, deleteMoWeight);
export const deleteCcfs = (body) => batchDelete(body, deleteCcf);
export const deleteCrmRules = (body) => batchDelete(body, deleteCrmRule);
export const deleteExposureRules = (body) => batchDelete(body, deleteExposureRule);
