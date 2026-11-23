import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool, query } from "./db.js";
import { configProducts } from "./productStandard.js";
import { ruleView as eadRuleView } from "./eadConfig.js";
import { declaredRefs } from "./refData.js";
import { resolveVersionRef } from "./ruleVersion.js";
import { assertRevision, latestConfigRevision, recordRevision } from "./configAudit.js";
import { clearExposureCache } from "./exposureCache.js";
export { assertRevision, latestConfigRevision, recordRevision };

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const {
  validateDataMapping, validateProductRegistry, validateRuleDocument, validateRulePair
} = require(path.join(root, "server/lib/ruleset-validator.cjs"));

const KIND_LABELS = {
  exposure_classification: "暴露分类规则",
  risk_weight: "风险权重规则",
  product_registry: "产品规则注册",
  data_mapping: "数据字段映射"
};

const LIQUIDITY_TABLES = [
  "liquidity_config_meta", "liquidity_product", "liquidity_product_field", "liquidity_product_group",
  "liquidity_field_group", "liquidity_dictionary", "liquidity_dictionary_item", "liquidity_rule_scope",
  "liquidity_rule", "liquidity_param_table", "liquidity_param", "liquidity_list"
];

const MODULE_LABELS = {
  documents: "规则文档",
  products: "产品与字段映射",
  ead: "EAD 计算规则",
  crm: "信用风险缓释",
  clauses: "监管条款",
  liquidity: "流动性配置"
};

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function nowText() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + " " +
    pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
}

function documentOf(value) {
  if (value == null) return null;
  if (typeof value === "string") {
    try { return JSON.parse(value); } catch { return value; }
  }
  return value;
}

function jsonText(value) {
  if (value == null) return null;
  return typeof value === "string" ? value : JSON.stringify(value);
}

function sqlRow(row) {
  const out = {};
  Object.entries(row || {}).forEach(([key, value]) => {
    out[key] = value !== null && typeof value === "object" ? JSON.stringify(value) : value;
  });
  return out;
}

function hashOf(value) {
  return createHash("sha256").update(JSON.stringify(value == null ? null : value)).digest("hex");
}

function slug(value) {
  return String(value || "").replace(/[^A-Za-z0-9_.-]+/g, "-");
}

function newer(left, right) {
  const a = String(left || "").split(".").map((item) => Number(item) || 0);
  const b = String(right || "").split(".").map((item) => Number(item) || 0);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if ((a[index] || 0) !== (b[index] || 0)) return (a[index] || 0) > (b[index] || 0);
  }
  return false;
}

async function versionRow(id) {
  const rows = await query("SELECT * FROM rule_version WHERE id = ?", [id]);
  if (!rows[0]) throw fail(404, "版本不存在");
  return rows[0];
}

function presentVersion(row) {
  return {
    id: row.id,
    jurisdiction: row.jurisdiction,
    version: row.version,
    name: row.name,
    ruleType: row.rule_type,
    effectiveFrom: row.effective_from ? String(row.effective_from).slice(0, 10) : null,
    effectiveTo: row.effective_to ? String(row.effective_to).slice(0, 10) : null,
    status: row.status,
    institution: row.institution || "",
    rulesetFile: row.ruleset_file || "",
    publishedAt: row.published_at || "",
    author: row.author || "",
    changelog: row.changelog || "",
    framework: row.framework || "CAR",
    sourceVersionId: row.source_version_id || "",
    revision: Number(row.revision) || 1,
    configStatus: row.config_status || "",
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || "",
    updatedBy: row.updated_by || "",
    validatedAt: row.validated_at || "",
    publishedSnapshotId: row.published_snapshot_id || ""
  };
}

async function rawConfig(row) {
  const [documents, tables, lists, eadConfigs, eadRules, crmConfigs, crmSlots, crmTypes, clauses, relations, products] = await Promise.all([
    query("SELECT * FROM rule_document WHERE rule_version_id = ?", [row.id])
      .then((rows) => rows.sort((left, right) => (left.kind + "|" + left.name).localeCompare(right.kind + "|" + right.name))),
    query("SELECT * FROM rule_parameter_table WHERE rule_version_id = ? ORDER BY table_id, table_version", [row.id]),
    query("SELECT * FROM rule_list WHERE rule_version_id = ? ORDER BY list_id, list_version", [row.id]),
    query("SELECT * FROM ead_product_config WHERE rule_version_id = ? ORDER BY product_code", [row.id]),
    query("SELECT * FROM ead_product_rule WHERE rule_version_id = ? ORDER BY product_code, seq", [row.id]),
    query("SELECT * FROM crm_product_config WHERE rule_version_id = ? ORDER BY product_code", [row.id]),
    query("SELECT * FROM crm_slot_column WHERE rule_version_id = ? ORDER BY product_code, attr, slot", [row.id]),
    query("SELECT * FROM crm_eligible_type WHERE rule_version_id = ? ORDER BY product_code, seq, code", [row.id]),
    query(
      "SELECT * FROM clause_doc WHERE rule_version_id = ? OR (jurisdiction = ? AND rule_version_id = '') ORDER BY clause_no",
      [row.id, row.jurisdiction]
    ),
    query("SELECT * FROM rule_clause_relation WHERE rule_version_id = ? ORDER BY clause_id, rule_node_id", [row.id]),
    configProducts(row.version)
  ]);
  const liquidityRows = await Promise.all(
    LIQUIDITY_TABLES.map((table) =>
      query(
        `SELECT * FROM ${table} WHERE jurisdiction = ? AND rule_version = ?`,
        [row.jurisdiction, row.version]
      )
    )
  );
  const liquidity = {};
  LIQUIDITY_TABLES.forEach((table, index) => {
    liquidity[table] = liquidityRows[index];
  });
  return { row, documents, tables, lists, eadConfigs, eadRules, crmConfigs, crmSlots, crmTypes, clauses, relations, products, liquidity };
}

function docsFromDocuments(rows) {
  const registryRow = rows.find((item) => item.kind === "product_registry") || null;
  const registryBody = registryRow ? documentOf(registryRow.body) || {} : {};
  const sets = registryBody.default_rule_sets || {};
  const classificationRows = rows.filter((item) => item.kind === "exposure_classification");
  const weightRows = rows.filter((item) => item.kind === "risk_weight");
  const pickDoc = (list, ref) => {
    const named = ref ? list.find((item) => item.name === ref) : null;
    if (named) return named;
    return list.slice().sort((left, right) => newer(right.doc_version, left.doc_version) ? -1 : 1)[0] || null;
  };
  const wrap = (item) => item ? {
    id: item.id,
    name: item.name,
    docVersion: item.doc_version,
    doc: documentOf(item.body) || {}
  } : null;
  return {
    registry: registryRow ? { id: registryRow.id, name: registryRow.name, docVersion: registryRow.doc_version, doc: registryBody } : null,
    classification: wrap(pickDoc(classificationRows, sets.classification_rule_ref)),
    weight: wrap(pickDoc(weightRows, sets.risk_weight_rule_ref)),
    mappings: rows.filter((item) => item.kind === "data_mapping").map((item) => ({
      id: item.id, name: item.name, docVersion: item.doc_version, doc: documentOf(item.body) || {}
    }))
  };
}

function paramsFromRows(tables, lists) {
  const outTables = {};
  tables.forEach((row) => {
    outTables[row.table_id] = {
      tableId: row.table_id,
      version: row.table_version,
      columns: documentOf(row.columns_json) || [],
      rows: documentOf(row.rows_json) || []
    };
  });
  const outLists = {};
  lists.forEach((row) => {
    outLists[row.list_id] = {
      listId: row.list_id,
      version: row.list_version,
      columns: documentOf(row.columns_json) || [],
      rows: documentOf(row.rows_json) || []
    };
  });
  return { tables: outTables, lists: outLists };
}

function eadMap(rows, rules) {
  const map = {};
  rows.forEach((row) => {
    map[row.product_code] = {
      needed: !!Number(row.needed),
      reason: row.reason || "",
      side: row.side,
      rules: rules.filter((rule) => rule.product_code === row.product_code).map(eadRuleView)
    };
  });
  return map;
}

function crmMap(configs, columns, types) {
  const map = {};
  configs.forEach((row) => {
    map[row.product_code] = {
      code: row.product_code,
      needed: !!Number(row.needed),
      reason: row.reason || "",
      maxSlots: Number(row.max_slots) || 1,
      columns: { crm_type: [], crm_value: [], crm_weight: [] },
      facts: { crm_type: [], crm_value: [], crm_weight: [] },
      types: []
    };
  });
  columns.forEach((row) => {
    const item = map[row.product_code];
    if (!item || !item.columns[row.attr]) return;
    item.columns[row.attr][Number(row.slot) - 1] = row.column_name;
    item.facts[row.attr][Number(row.slot) - 1] = row.target_fact_code || row.attr;
  });
  types.forEach((row) => {
    const item = map[row.product_code];
    if (item) item.types.push({ code: row.code, name: row.name });
  });
  return map;
}

function modulesOf(raw, framework) {
  const docs = docsFromDocuments(raw.documents);
  const modules = [];
  const errors = [];
  const warnings = [];


  const docErrors = [];
  raw.documents.forEach((row) => {
    const body = documentOf(row.body) || {};
    let list = [];
    if (row.kind === "product_registry") list = validateProductRegistry(body);
    else if (row.kind === "data_mapping") list = validateDataMapping(body);
    else list = validateRuleDocument(body, { tables: raw.tables.map((item) => item.table_id), lists: raw.lists.map((item) => item.list_id) });
    if (list.length) {
      docErrors.push(...list.map((text) => row.kind + "/" + row.name + "：" + text));
    }
  });
  if (!docs.registry) docErrors.push("缺少产品规则注册文档");
  if (!docs.classification) docErrors.push("缺少 V3.5 暴露分类规则文档");
  if (!docs.weight) docErrors.push("缺少 V3.5 风险权重规则文档");
  if (!docs.mappings.length) docErrors.push("缺少数据字段映射文档");
  if (docs.classification && docs.weight) {
    docErrors.push(...validateRulePair(docs.classification.doc, docs.weight.doc));
  }
  docErrors.forEach((text) => errors.push(text));
  modules.push({
    key: "documents",
    label: MODULE_LABELS.documents,
    status: docErrors.length ? "error" : "ok",
    count: raw.documents.length,
    errors: docErrors,
    warnings: [],
    updatedAt: raw.documents.reduce((latest, item) => (item.updated_at > latest ? item.updated_at : latest), "")
  });

  const productErrors = [];
  if (!raw.products.length) productErrors.push("当前版本没有产品注册，产品清单为空");
  raw.products.forEach((product) => {
    if (!(product.fields || []).length) productErrors.push(product.label + "：没有标准字段");
    if (!(product.mappings || []).length && !product.dataMappingRef) productErrors.push(product.label + "：没有映射配置引用");
  });
  productErrors.forEach((text) => errors.push(text));
  modules.push({
    key: "products",
    label: MODULE_LABELS.products,
    status: productErrors.length ? "error" : "ok",
    count: raw.products.length,
    errors: productErrors,
    warnings: [],
    updatedAt: ""
  });

  const eadErrors = [];
  const eadWarnings = [];
  raw.products.forEach((product) => {
    const config = raw.eadConfigs.find((item) => item.product_code === product.code);
    if (!config) {
      eadErrors.push(product.label + "：尚未决定是否配置 EAD");
      return;
    }
    if (!Number(config.needed)) return;
    if (!config.side) eadErrors.push(product.label + "：标了需要配置，但还没选表内或表外");
    const rules = raw.eadRules.filter((rule) => rule.product_code === product.code);
    if (!rules.length) eadErrors.push(product.label + "：标了需要配置，但没有 EAD 规则");
    rules.forEach((rule) => {
      if (!rule.formula) eadErrors.push(rule.id + "：公式为空");
      if (!documentOf(rule.structured_json)) eadErrors.push(rule.id + "：缺少结构化公式");
    });
  });
  eadErrors.forEach((text) => errors.push(text));
  eadWarnings.forEach((text) => warnings.push(text));
  modules.push({
    key: "ead",
    label: MODULE_LABELS.ead,
    status: eadErrors.length ? "error" : (eadWarnings.length ? "warning" : "ok"),
    count: raw.eadConfigs.length,
    errors: eadErrors,
    warnings: eadWarnings,
    updatedAt: raw.eadConfigs.reduce((latest, item) => (item.updated_at > latest ? item.updated_at : latest), "")
  });

  const crmErrors = [];
  const crmWarnings = [];
  raw.products.forEach((product) => {
    const config = raw.crmConfigs.find((item) => item.product_code === product.code);
    if (!config) return;
    if (!Number(config.needed)) return;
    const slots = raw.crmSlots.filter((item) => item.product_code === product.code);
    if (!slots.length) crmErrors.push(product.label + "：标了需要配置，但没有缓释字段绑定");
    const types = raw.crmTypes.filter((item) => item.product_code === product.code);
    if (!types.length) crmErrors.push(product.label + "：标了需要配置，但没有合格缓释物字典");
  });
  crmErrors.forEach((text) => errors.push(text));
  crmWarnings.forEach((text) => warnings.push(text));
  modules.push({
    key: "crm",
    label: MODULE_LABELS.crm,
    status: crmErrors.length ? "error" : (crmWarnings.length ? "warning" : "ok"),
    count: raw.crmConfigs.length,
    errors: crmErrors,
    warnings: crmWarnings,
    updatedAt: raw.crmConfigs.reduce((latest, item) => (item.updated_at > latest ? item.updated_at : latest), "")
  });

  if (!raw.clauses.length) warnings.push("当前版本还没有监管条款");
  modules.push({
    key: "clauses",
    label: MODULE_LABELS.clauses,
    status: raw.clauses.length ? "ok" : "warning",
    count: raw.clauses.length,
    errors: [],
    warnings: raw.clauses.length ? [] : ["当前版本还没有监管条款"],
    updatedAt: raw.clauses.reduce((latest, item) => (item.updated_at > latest ? item.updated_at : latest), "")
  });

  const liquidityCount = ((raw.liquidity && raw.liquidity.liquidity_product) || []).length;
  const liquidityWarnings = liquidityCount ? [] : ["当前版本还没有流动性产品配置"];
  liquidityWarnings.forEach((text) => warnings.push(text));
  modules.push({
    key: "liquidity",
    label: MODULE_LABELS.liquidity,
    status: liquidityCount ? "ok" : "warning",
    count: liquidityCount,
    errors: [],
    warnings: liquidityWarnings,
    updatedAt: ""
  });

  const done = modules.filter((item) => item.status === "ok").length;
  return {
    modules,
    errors,
    warnings,
    completeness: Math.round((done / Math.max(modules.length, 1)) * 100)
  };
}

export async function validateRuleVersion(id) {
  const row = await versionRow(id);
  const raw = await rawConfig(row);
  const state = modulesOf(raw, row.framework || "CAR");
  return {
    version: row.version,
    ruleVersionId: row.id,
    framework: row.framework || "CAR",
    ok: state.errors.length === 0,
    errors: state.errors,
    warnings: state.warnings,
    modules: state.modules,
    completeness: state.completeness
  };
}

export async function ruleVersionOverview(id) {
  const row = await versionRow(id);
  const raw = await rawConfig(row);
  const state = modulesOf(raw, row.framework || "CAR");
  const [snapshots, latestRevision] = await Promise.all([
    query(
      "SELECT id, snapshot_no, status, config_hash, created_by, created_at FROM rule_config_snapshot WHERE rule_version_id = ? ORDER BY snapshot_no DESC",
      [id]
    ),
    query("SELECT MAX(revision) AS revision FROM config_revision WHERE rule_version_id = ?", [id])
  ]);
  return {
    version: {
      ...presentVersion(row),
      ruleVersionId: row.id,
      snapshotId: row.published_snapshot_id || ""
    },
    modules: state.modules,
    validation: {
      ok: state.errors.length === 0,
      errors: state.errors,
      warnings: state.warnings,
      completeness: state.completeness
    },
    counts: {
      documents: raw.documents.length,
      parameterTables: raw.tables.length,
      referenceLists: raw.lists.length,
      products: raw.products.length,
      eadConfigs: raw.eadConfigs.length,
      eadRules: raw.eadRules.length,
      crmConfigs: raw.crmConfigs.length,
      crmSlots: raw.crmSlots.length,
      crmTypes: raw.crmTypes.length,
      clauses: raw.clauses.length,
      liquidityProducts: ((raw.liquidity && raw.liquidity.liquidity_product) || []).length
    },
    snapshots,
    revision: Number(latestRevision[0] && latestRevision[0].revision) || 0
  };
}

export async function createRuleConfigSnapshot(ruleVersionId, actor = "", status = "PUBLISHED") {
  const row = await versionRow(ruleVersionId);
  const raw = await rawConfig(row);
  const items = [];
  const push = (objectType, key, content) => {
    items.push({ objectType, objectKey: key, content, hash: hashOf(content) });
  };
  raw.documents.forEach((item) => push("rule_document", item.kind + "|" + item.name, item));
  raw.tables.forEach((item) => push("rule_parameter_table", item.table_id + "|" + item.table_version, item));
  raw.lists.forEach((item) => push("rule_list", item.list_id + "|" + item.list_version, item));
  raw.eadConfigs.forEach((item) => push("ead_product_config", item.product_code, item));
  raw.eadRules.forEach((item) => push("ead_product_rule", item.id, item));
  raw.crmConfigs.forEach((item) => push("crm_product_config", item.product_code, item));
  raw.crmSlots.forEach((item) => push("crm_slot_column", [item.product_code, item.attr, item.slot].join("|"), item));
  raw.crmTypes.forEach((item) => push("crm_eligible_type", item.product_code + "|" + item.code, item));
  raw.clauses.forEach((item) => push("clause_doc", item.id, item));
  (raw.relations || []).forEach((item) => push("rule_clause_relation", [item.clause_id, item.rule_node_id].join("|"), item));
  push("product_catalog", "catalog", raw.products);
  if (raw.liquidity) {
    Object.entries(raw.liquidity).forEach(([table, rows]) => {
      rows.forEach((item) => push(table, String(item.id == null ? item.code || item.dict_code || "" : item.id), item));
    });
  }

  const configHash = hashOf(items.map((item) => ({ type: item.objectType, key: item.objectKey, hash: item.hash })));
  const previous = await query(
    "SELECT MAX(snapshot_no) AS no FROM rule_config_snapshot WHERE rule_version_id = ?",
    [ruleVersionId]
  );
  const snapshotNo = (Number(previous[0] && previous[0].no) || 0) + 1;
  const id = "SNP-" + slug(ruleVersionId) + "-" + snapshotNo + "-" + Math.random().toString(36).slice(2, 6).toUpperCase();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      `INSERT INTO rule_config_snapshot
         (id, rule_version_id, jurisdiction, framework, version, snapshot_no, config_hash, status, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, ruleVersionId, row.jurisdiction, row.framework || "CAR", row.version, snapshotNo, configHash, status, actor, nowText()]
    );
    for (const item of items) {
      await conn.query(
        `INSERT INTO rule_config_snapshot_item
           (snapshot_id, object_type, object_key, content_json, content_hash)
         VALUES (?, ?, ?, ?, ?)`,
        [id, item.objectType, item.objectKey, JSON.stringify(item.content), item.hash]
      );
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
  await recordRevision({
    ruleVersionId, objectType: "rule_config_snapshot", objectKey: id, action: "SNAPSHOT",
    after: { snapshotNo, configHash, status }, actor
  });
  return { id, snapshotNo, configHash, status };
}

export async function publishRuleVersion(id, actor = "") {
  const row = await versionRow(id);
  if (row.status === "published") throw fail(409, "这个版本已经发布");
  if (row.status !== "draft") throw fail(409, "只有草稿版本可以发布");
  const validation = await validateRuleVersion(id);
  if (!validation.ok) throw fail(400, "版本配置还有阻断问题，不能发布：" + validation.errors.slice(0, 5).join("；"));
  const snapshot = await createRuleConfigSnapshot(id, actor, "PUBLISHED");
  const now = nowText();
  await query(
    `UPDATE rule_version SET status = 'published', config_status = 'PUBLISHED', validated_at = ?,
       published_at = ?, published_snapshot_id = ?, revision = revision + 1, updated_by = ?, updated_at = ?
     WHERE id = ?`,
    [now, now, snapshot.id, actor, now, id]
  );
  clearExposureCache(id);
  await recordRevision({
    ruleVersionId: id, objectType: "rule_version", objectKey: id, action: "PUBLISH",
    before: { status: row.status }, after: { status: "published", snapshotId: snapshot.id }, actor
  });
  return { ...(await ruleVersionOverview(id)), snapshot };
}

export async function withdrawRuleVersion(id, actor = "") {
  const row = await versionRow(id);
  if (row.status !== "published") throw fail(409, "只有已发布版本可以撤回发布");
  const now = nowText();
  await query(
    "UPDATE rule_config_snapshot SET status = 'SUPERSEDED' WHERE rule_version_id = ? AND status = 'PUBLISHED'",
    [id]
  );
  await query(
    `UPDATE rule_version SET status = 'draft', config_status = 'CONFIGURING', validated_at = '',
       published_snapshot_id = '', revision = revision + 1, updated_by = ?, updated_at = ?
     WHERE id = ?`,
    [actor, now, id]
  );
  clearExposureCache(id);
  await recordRevision({
    ruleVersionId: id, objectType: "rule_version", objectKey: id, action: "WITHDRAW_PUBLISH",
    before: { status: "published", snapshotId: row.published_snapshot_id || "" },
    after: { status: "draft", configStatus: "CONFIGURING" }, actor
  });
  return ruleVersionOverview(id);
}

export async function latestPublishedSnapshot(ruleVersionId) {
  const rows = await query(
    `SELECT * FROM rule_config_snapshot WHERE rule_version_id = ? AND status = 'PUBLISHED'
      ORDER BY snapshot_no DESC LIMIT 1`,
    [ruleVersionId]
  );
  return rows[0] || null;
}

async function snapshotById(snapshotId) {
  const rows = await query("SELECT * FROM rule_config_snapshot WHERE id = ?", [snapshotId]);
  if (!rows[0]) throw fail(404, "配置快照不存在");
  return rows[0];
}

export async function snapshotItems(snapshotId) {
  const rows = await query(
    "SELECT object_type, object_key, content_json, content_hash FROM rule_config_snapshot_item WHERE snapshot_id = ? ORDER BY object_type, object_key",
    [snapshotId]
  );
  return rows.map((row) => ({
    objectType: row.object_type,
    objectKey: row.object_key,
    content: documentOf(row.content_json),
    hash: row.content_hash
  }));
}

function configFromItems(snapshot, items) {
  const pick = (type) => items.filter((item) => item.objectType === type).map((item) => item.content);
  const documents = pick("rule_document");
  const tables = pick("rule_parameter_table");
  const lists = pick("rule_list");
  const eadConfigs = pick("ead_product_config");
  const eadRules = pick("ead_product_rule");
  const crmConfigs = pick("crm_product_config");
  const crmSlots = pick("crm_slot_column");
  const crmTypes = pick("crm_eligible_type");
  const catalog = pick("product_catalog");
  const liquidity = {};
  LIQUIDITY_TABLES.forEach((table) => { liquidity[table] = pick(table); });
  return {
    snapshotId: snapshot.id,
    source: "snapshot",
    ruleVersionId: snapshot.rule_version_id,
    version: snapshot.version,
    jurisdiction: snapshot.jurisdiction,
    framework: snapshot.framework,
    documents,
    parameterTables: tables,
    referenceLists: lists,
    eadConfigs,
    eadRules,
    crmConfigs,
    crmSlots,
    crmTypes,
    products: catalog[0] || [],
    liquidity,
    clauses: pick("clause_doc"),
    relations: pick("rule_clause_relation"),
    docs: docsFromDocuments(documents),
    params: paramsFromRows(tables, lists),
    eadConfig: eadMap(eadConfigs, eadRules),
    crm: crmMap(crmConfigs, crmSlots, crmTypes)
  };
}

/** 统一配置加载器：正式计量只读已发布快照，试算读当前草稿。 */
export async function loadRwaConfig({ version = "", ruleVersionId = "", jurisdiction = "", snapshotId = "", mode = "draft" } = {}) {
  let versionId = ruleVersionId || "";
  if (!versionId && version) versionId = await resolveVersionRef(version, jurisdiction);
  let snapshot = null;
  if (snapshotId) {
    snapshot = await snapshotById(snapshotId);
    if (versionId && snapshot.rule_version_id !== versionId) throw fail(409, "快照不属于当前监管版本");
  } else if (mode === "formal") {
    if (!versionId) throw fail(400, "缺少监管版本，不能执行正式计量");
    snapshot = await latestPublishedSnapshot(versionId);
    if (!snapshot) throw fail(409, "当前监管版本尚未发布正式快照，不能执行正式计量");
  }
  if (snapshot && mode === "formal" && snapshot.status !== "PUBLISHED") {
    throw fail(409, "正式计量只能使用已发布的配置快照");
  }
  if (snapshot) return configFromItems(snapshot, await snapshotItems(snapshot.id));
  if (!versionId) throw fail(400, "缺少监管版本");
  const row = await versionRow(versionId);
  const raw = await rawConfig(row);
  return {
    snapshotId: "",
    source: "draft",
    ruleVersionId: row.id,
    version: row.version,
    jurisdiction: row.jurisdiction,
    framework: row.framework || "CAR",
    ...raw,
    docs: docsFromDocuments(raw.documents),
    params: paramsFromRows(raw.tables, raw.lists),
    eadConfig: eadMap(raw.eadConfigs, raw.eadRules),
    crm: crmMap(raw.crmConfigs, raw.crmSlots, raw.crmTypes)
  };
}

export async function compareSnapshots(leftId, rightId) {
  const [left, right] = await Promise.all([snapshotById(leftId), snapshotById(rightId)]);
  const [leftItems, rightItems] = await Promise.all([snapshotItems(leftId), snapshotItems(rightId)]);
  const toMap = (items) => {
    const map = new Map();
    items.forEach((item) => map.set(item.objectType + "|" + item.objectKey, item));
    return map;
  };
  const a = toMap(leftItems);
  const b = toMap(rightItems);
  const keys = Array.from(new Set(Array.from(a.keys()).concat(Array.from(b.keys())))).sort();
  const changes = [];
  keys.forEach((key) => {
    const x = a.get(key);
    const y = b.get(key);
    if (!x) changes.push({ key, change: "added" });
    else if (!y) changes.push({ key, change: "removed" });
    else if (x.hash !== y.hash) changes.push({ key, change: "changed" });
  });
  return {
    left: { id: left.id, version: left.version, snapshotNo: left.snapshot_no, hash: left.config_hash, createdAt: left.created_at },
    right: { id: right.id, version: right.version, snapshotNo: right.snapshot_no, hash: right.config_hash, createdAt: right.created_at },
    sameHash: left.config_hash === right.config_hash,
    changes
  };
}

export async function rollbackSnapshot(snapshotId, actor = "") {
  const snapshot = await snapshotById(snapshotId);
  const version = await versionRow(snapshot.rule_version_id);
  if (version.status === "published") throw fail(409, "已发布版本不能直接回滚，请新建版本后再恢复");
  const items = await snapshotItems(snapshotId);
  const pick = (type) => items.filter((item) => item.objectType === type).map((item) => item.content);
  const documents = pick("rule_document");
  const tables = pick("rule_parameter_table");
  const lists = pick("rule_list");
  const eadConfigs = pick("ead_product_config");
  const eadRules = pick("ead_product_rule");
  const crmConfigs = pick("crm_product_config");
  const crmSlots = pick("crm_slot_column");
  const crmTypes = pick("crm_eligible_type");
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query("DELETE FROM rule_document WHERE rule_version_id = ?", [snapshot.rule_version_id]);
    await conn.query("DELETE FROM rule_parameter_table WHERE rule_version_id = ?", [snapshot.rule_version_id]);
    await conn.query("DELETE FROM rule_list WHERE rule_version_id = ?", [snapshot.rule_version_id]);
    await conn.query("DELETE FROM ead_product_rule WHERE rule_version_id = ?", [snapshot.rule_version_id]);
    await conn.query("DELETE FROM ead_product_config WHERE rule_version_id = ?", [snapshot.rule_version_id]);
    await conn.query("DELETE FROM crm_slot_column WHERE rule_version_id = ?", [snapshot.rule_version_id]);
    await conn.query("DELETE FROM crm_eligible_type WHERE rule_version_id = ?", [snapshot.rule_version_id]);
    await conn.query("DELETE FROM crm_product_config WHERE rule_version_id = ?", [snapshot.rule_version_id]);
    for (const [table, rows] of [
      ["rule_document", documents],
      ["rule_parameter_table", tables],
      ["rule_list", lists],
      ["ead_product_config", eadConfigs],
      ["ead_product_rule", eadRules],
      ["crm_product_config", crmConfigs],
      ["crm_slot_column", crmSlots],
      ["crm_eligible_type", crmTypes]
    ]) {
      for (const row of rows) {
        await conn.query(`INSERT INTO ${table} SET ?`, [sqlRow(row)]);
      }
    }
    if (items.some((item) => String(item.objectType).startsWith("liquidity_"))) {
      const autoIncRows = await conn.query(
        `SELECT TABLE_NAME FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND EXTRA LIKE '%auto_increment%'
            AND TABLE_NAME IN (${LIQUIDITY_TABLES.map(() => "?").join(",")})`,
        LIQUIDITY_TABLES
      );
      const autoInc = new Set(autoIncRows[0].map((item) => item.TABLE_NAME));
      for (const table of LIQUIDITY_TABLES) {
        await conn.query(`DELETE FROM ${table} WHERE jurisdiction = ? AND rule_version = ?`, [snapshot.jurisdiction, snapshot.version]);
        for (const item of pick(table)) {
          const next = { ...item };
          if (autoInc.has(table)) delete next.id;
          await conn.query(`INSERT INTO ${table} SET ?`, [sqlRow(next)]);
        }
      }
    }
    await conn.query(
      "UPDATE rule_version SET revision = revision + 1, updated_by = ?, updated_at = ? WHERE id = ?",
      [actor, nowText(), snapshot.rule_version_id]
    );
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
  await recordRevision({
    ruleVersionId: snapshot.rule_version_id, objectType: "rule_config_snapshot", objectKey: snapshotId,
    action: "ROLLBACK", after: { snapshotId }, actor
  });
  return ruleVersionOverview(snapshot.rule_version_id);
}

export async function clauseImpact(clauseId) {
  const [relations, refs, ead, productRules] = await Promise.all([
    query("SELECT rule_version_id, rule_document_id, rule_node_id, relation_type FROM rule_clause_relation WHERE clause_id = ?", [clauseId]),
    query("SELECT rule_name FROM clause_ref WHERE clause_id = ?", [clauseId]),
    query("SELECT rule_version_id, id, product_code FROM ead_product_rule WHERE clause_id = ?", [clauseId]),
    query("SELECT id, product_code, rule_name FROM product_exposure_rule WHERE clause_id = ?", [clauseId])
  ]);
  return { clauseId, relations, referencedBy: refs.map((item) => item.rule_name), eadRules: ead, productRules };
}

export async function configRevisions(ruleVersionId, limit = 100) {
  return query(
    "SELECT id, rule_version_id, object_type, object_key, revision, action, actor, created_at FROM config_revision WHERE rule_version_id = ? ORDER BY id DESC LIMIT ?",
    [ruleVersionId, Number(limit) || 100]
  );
}

export async function getRuleSnapshot(snapshotId, includeItems = true) {
  const snapshot = await snapshotById(snapshotId);
  return {
    ...snapshot,
    items: includeItems ? await snapshotItems(snapshotId) : undefined
  };
}

export async function clauseRelations(clauseId) {
  return query("SELECT rule_version_id, rule_document_id, rule_node_id, clause_id, relation_type FROM rule_clause_relation WHERE clause_id = ? ORDER BY rule_node_id", [clauseId]);
}

export async function saveClauseRelations(clauseId, relations, actor = "") {
  const list = Array.isArray(relations) ? relations : [];
  const clauseRows = await query("SELECT rule_version_id FROM clause_doc WHERE id = ?", [clauseId]);
  const defaultVersionId = clauseRows[0] ? (clauseRows[0].rule_version_id || "") : "";
  const before = await clauseRelations(clauseId);
  await query("DELETE FROM rule_clause_relation WHERE clause_id = ?", [clauseId]);
  for (const item of list) {
    const node = String((item && item.ruleNodeId) || (item && item.rule_node_id) || "").trim();
    if (!node) continue;
    await query(
      `INSERT INTO rule_clause_relation
         (rule_version_id, rule_document_id, rule_node_id, clause_id, relation_type, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        String((item && (item.ruleVersionId || item.rule_version_id)) || defaultVersionId),
        String((item && (item.ruleDocumentId || item.rule_document_id)) || ""),
        node.slice(0, 120),
        clauseId,
        String((item && (item.relationType || item.relation_type)) || "REFERENCE").slice(0, 24),
        nowText()
      ]
    );
  }
  const after = await clauseRelations(clauseId);
  await recordRevision({
    ruleVersionId: after[0] ? after[0].rule_version_id : "", objectType: "rule_clause_relation",
    objectKey: clauseId, action: "UPDATE", before: { count: before.length }, after: { count: after.length }, actor
  });
  return after;
}
