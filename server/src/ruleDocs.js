import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { query } from "./db.js";
import {
  declaredRefs, upsertParameterTable, upsertReferenceList
} from "./refData.js";
import { resolveVersionRef } from "./ruleVersion.js";
import { assertRevision, assertVersionWritable, recordRevision } from "./configAudit.js";
import { clearExposureCache } from "./exposureCache.js";
import { createRuleConfigSnapshot } from "./ruleGovernance.js";
import {
  validateDataMapping, validateProductRegistry, validateRuleDocument, validateRulePair
} from "../lib/ruleset-validator.cjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const DOCS = join(ROOT, "docs", "信用风险规则");

const KIND_LABELS = {
  exposure_classification: "暴露分类规则",
  risk_weight: "风险权重规则",
  product_registry: "产品规则注册",
  data_mapping: "数据字段映射"
};

function bad(message) {
  const err = new Error(message);
  err.status = 400;
  throw err;
}

function documentOf(value) {
  if (value == null) return null;
  if (typeof value === "string") {
    try { return JSON.parse(value); } catch { return value; }
  }
  return value;
}

function stamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
}

function hashOf(value) {
  return createHash("sha256").update(JSON.stringify(value == null ? null : value)).digest("hex");
}

function slug(value) {
  return String(value || "").replace(/[^A-Za-z0-9_.-]+/g, "-");
}

function ruleDocumentId(row) {
  return [row.jurisdiction, row.kind, row.name, row.docVersion, row.ruleVersion].map(slug).join("-");
}

function nodeCount(rules) {
  let count = 0;
  const walk = (list) => {
    (list || []).forEach((node) => {
      count += 1;
      if (node && Array.isArray(node.children)) walk(node.children);
      if (node && node.otherwise && node.otherwise.id) walk([node.otherwise]);
    });
  };
  walk(rules);
  return count;
}

function countsOf(kind, body) {
  if (kind === "product_registry") {
    const mappings = (body && body.product_mappings) || [];
    return {
      fields: 0,
      rules: mappings.length,
      nodes: mappings.reduce((sum, item) => sum + ((item && item.product_codes) || []).length, 0),
      tables: 0,
      lists: 0
    };
  }
  if (kind === "data_mapping") {
    return {
      fields: 0,
      rules: ((body && body.mappings) || []).length,
      nodes: ((body && body.validation_rules) || []).length,
      tables: 0,
      lists: 0
    };
  }
  return {
    fields: ((body && body.fields) || []).length,
    rules: ((body && body.rules) || []).length,
    nodes: nodeCount(body && body.rules),
    tables: ((body && body.tables) || []).length,
    lists: ((body && body.lists) || []).length
  };
}

function present(row, full) {
  const body = documentOf(row.body);
  const counts = countsOf(row.kind, body);
  const view = {
    id: row.id,
    jurisdiction: row.jurisdiction,
    ruleVersion: row.rule_version,
    ruleVersionId: row.rule_version_id || "",
    revision: Number(row.revision) || 1,
    contentHash: row.content_hash || "",
    kind: row.kind,
    kindLabel: KIND_LABELS[row.kind] || row.kind,
    name: row.name,
    docVersion: row.doc_version,
    status: row.status,
    title: row.title,
    updatedAt: row.updated_at,
    fieldCount: counts.fields,
    ruleCount: counts.rules,
    nodeCount: counts.nodes,
    tableCount: counts.tables,
    listCount: counts.lists
  };
  if (full) view.body = body;
  return view;
}

const DOC_SQL = "SELECT * FROM rule_document";

export async function ruleDocuments({ jurisdiction = "", version = "", kind = "" } = {}) {
  // 不在 SQL 里 ORDER BY：rule_document.body 很大，全量排序会触发
  // MySQL 的 out-of-sort-memory（尤其不传 version 时）。取回后再排序。
  const rows = await query(
    DOC_SQL + " WHERE (? = '' OR jurisdiction = ?) AND (? = '' OR rule_version = ?) AND (? = '' OR kind = ?)",
    [jurisdiction, jurisdiction, version, version, kind, kind]
  );
  return rows.map((row) => present(row, false)).sort((left, right) => (
    String(left.kind).localeCompare(String(right.kind)) || String(left.name).localeCompare(String(right.name))
  ));
}

export async function ruleDocument(id) {
  const rows = await query(DOC_SQL + " WHERE id = ?", [id]);
  return rows[0] ? present(rows[0], true) : null;
}

async function structuralErrors(kind, body, jurisdiction, ruleVersion) {
  const refs = jurisdiction ? await declaredRefs(jurisdiction, ruleVersion) : { tables: [], lists: [] };
  if (kind === "product_registry") return validateProductRegistry(body);
  if (kind === "data_mapping") return validateDataMapping(body);
  return validateRuleDocument(body, refs);
}

function metadataOf(body) {
  if (body.registry_name) {
    return { name: body.registry_name, title: body.title || "", version: body.version || "", status: body.status || "DRAFT" };
  }
  if (body.mapping_name) {
    return { name: body.mapping_name, title: body.title || "", version: body.version || "", status: body.status || "DRAFT" };
  }
  return { name: body.name || "", title: body.title || "", version: body.version || "", status: body.status || "DRAFT" };
}

export async function createRuleDocument(input) {
  const body = input.body;
  const kind = String(input.kind || "");
  if (!KIND_LABELS[kind]) bad("kind 只能是 " + Object.keys(KIND_LABELS).join(" / "));
  if (!body || typeof body !== "object") bad("body 必须是 JSON 对象");
  const jurisdiction = String(input.jurisdiction || "").trim();
  const ruleVersion = String(input.ruleVersion || "").trim();
  if (!jurisdiction) bad("缺少地区");
  if (!ruleVersion) bad("缺少监管版本");
  const meta = metadataOf(body);
  if (!meta.name) bad("文档缺少 name / registry_name / mapping_name");
  await assertVersionWritable(await resolveVersionRef(ruleVersion, jurisdiction));
  const errors = await structuralErrors(kind, body, jurisdiction, ruleVersion);
  if (errors.length) bad("结构校验没通过：" + errors.slice(0, 5).join("；"));
  const row = { jurisdiction, kind, name: meta.name, docVersion: meta.version || "0.0.1", ruleVersion };
  const id = ruleDocumentId(row);
  const exists = await query(DOC_SQL + " WHERE id = ?", [id]);
  if (exists[0]) bad("这个版本下已存在同名文档");
  const versionId = await resolveVersionRef(ruleVersion, jurisdiction);
  await query(
    `INSERT INTO rule_document
       (id, jurisdiction, rule_version, kind, name, doc_version, status, title, body, updated_at,
        rule_version_id, revision, content_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    [id, jurisdiction, ruleVersion, kind, meta.name, row.docVersion, meta.status, meta.title, JSON.stringify(body), stamp(), versionId, hashOf(body)]
  );
  clearExposureCache(versionId);
  await recordRevision({
    ruleVersionId: versionId, objectType: "rule_document", objectKey: kind + "|" + meta.name,
    action: "CREATE", after: { status: meta.status, docVersion: row.docVersion, hash: hashOf(body) }, actor: input.actor || ""
  });
  return ruleDocument(id);
}

export async function saveRuleDocument(id, input) {
  const rows = await query(DOC_SQL + " WHERE id = ?", [id]);
  if (!rows[0]) bad("没有这份规则文档");
  const body = input.body;
  if (!body || typeof body !== "object") bad("body 必须是 JSON 对象");
  assertRevision(rows[0].revision, input.baseRevision, "规则文档「" + rows[0].name + "」");
  await assertVersionWritable(rows[0].rule_version_id || await resolveVersionRef(rows[0].rule_version, rows[0].jurisdiction));
  const errors = await structuralErrors(rows[0].kind, body, rows[0].jurisdiction, rows[0].rule_version);
  if (errors.length) bad("结构校验没通过：" + errors.slice(0, 5).join("；"));
  const meta = metadataOf(body);
  const nextName = meta.name || rows[0].name;
  const nextVersion = meta.version || rows[0].doc_version;
  const nextId = ruleDocumentId({
    jurisdiction: rows[0].jurisdiction,
    kind: rows[0].kind,
    name: nextName,
    docVersion: nextVersion,
    ruleVersion: rows[0].rule_version
  });
  if (nextId !== id) {
    const taken = await query(DOC_SQL + " WHERE id = ?", [nextId]);
    if (taken[0]) bad("这个版本下已存在同名同版本文档");
  }
  const versionId = rows[0].rule_version_id || await resolveVersionRef(rows[0].rule_version, rows[0].jurisdiction);
  await query(
    `UPDATE rule_document
        SET id = ?, name = ?, doc_version = ?, status = ?, title = ?, body = ?, updated_at = ?,
            rule_version_id = ?, revision = revision + 1, content_hash = ?
      WHERE id = ?`,
    [
      nextId,
      nextName,
      nextVersion,
      meta.status || rows[0].status,
      meta.title || rows[0].title,
      JSON.stringify(body),
      stamp(),
      versionId,
      hashOf(body),
      id
    ]
  );
  clearExposureCache(versionId);
  await recordRevision({
    ruleVersionId: versionId, objectType: "rule_document", objectKey: rows[0].kind + "|" + nextName,
    action: "UPDATE", before: { status: rows[0].status, docVersion: rows[0].doc_version, hash: rows[0].content_hash },
    after: { status: meta.status || rows[0].status, docVersion: nextVersion, hash: hashOf(body) }, actor: input.actor || ""
  });
  return ruleDocument(nextId);
}

export async function deleteRuleDocument(id, actor = "") {
  const rows = await query(DOC_SQL + " WHERE id = ?", [id]);
  if (!rows[0]) bad("没有这份规则文档");
  await query("DELETE FROM rule_document WHERE id = ?", [id]);
  clearExposureCache(rows[0].rule_version_id || "");
  await recordRevision({
    ruleVersionId: rows[0].rule_version_id || "", objectType: "rule_document",
    objectKey: rows[0].kind + "|" + rows[0].name, action: "DELETE",
    before: { status: rows[0].status, docVersion: rows[0].doc_version, hash: rows[0].content_hash }, actor
  });
}

export async function validateRuleDocumentById(id) {
  const rows = await query(DOC_SQL + " WHERE id = ?", [id]);
  if (!rows[0]) bad("没有这份规则文档");
  const doc = documentOf(rows[0].body);
  const refs = await declaredRefs(rows[0].jurisdiction, rows[0].rule_version);
  let errors = [];
  if (rows[0].kind === "product_registry") errors = validateProductRegistry(doc);
  else if (rows[0].kind === "data_mapping") errors = validateDataMapping(doc);
  else errors = validateRuleDocument(doc, refs);

  if (rows[0].kind === "exposure_classification" || rows[0].kind === "risk_weight") {
    const otherKind = rows[0].kind === "exposure_classification" ? "risk_weight" : "exposure_classification";
    const others = await query(
      DOC_SQL + " WHERE jurisdiction = ? AND rule_version = ? AND kind = ?",
      [rows[0].jurisdiction, rows[0].rule_version, otherKind]
    );
    if (others[0]) {
      const pair = rows[0].kind === "exposure_classification"
        ? validateRulePair(doc, documentOf(others[0].body))
        : validateRulePair(documentOf(others[0].body), doc);
      errors = errors.concat(pair);
    }
  }
  return { id, ok: errors.length === 0, errors };
}

/** 校验还没保存的文档，供页面在 JSON 编辑时使用。 */
export async function validateRuleBody({ kind = "", body, jurisdiction = "", ruleVersion = "" } = {}) {
  if (!body || typeof body !== "object") bad("body 必须是 JSON 对象");
  let errors = [];
  if (kind === "product_registry") errors = validateProductRegistry(body);
  else if (kind === "data_mapping") errors = validateDataMapping(body);
  else {
    const refs = jurisdiction ? await declaredRefs(jurisdiction, ruleVersion) : { tables: [], lists: [] };
    errors = validateRuleDocument(body, refs);
    if (jurisdiction && ruleVersion) {
      const otherKind = kind === "exposure_classification" ? "risk_weight" : "exposure_classification";
      const others = await query(
        DOC_SQL + " WHERE jurisdiction = ? AND rule_version = ? AND kind = ?",
        [jurisdiction, ruleVersion, otherKind]
      );
      if (others[0]) {
        const pair = kind === "exposure_classification"
          ? validateRulePair(body, documentOf(others[0].body))
          : validateRulePair(documentOf(others[0].body), body);
        errors = errors.concat(pair);
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

// ---------------------------------------------------------------- 导入

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function readCsv(path) {
  const text = readFileSync(path, "utf8").replace(/^﻿/, "").replace(/\r\n/g, "\n");
  const lines = text.split("\n").filter((line) => line.trim());
  if (!lines.length) return { columns: [], rows: [] };
  const columns = lines[0].split(",").map((item) => item.trim());
  const rows = lines.slice(1).map((line) => line.split(",").map((item) => item.trim()));
  return { columns, rows };
}

function fill(row, width) {
  const copy = row.slice(0, width);
  while (copy.length < width) copy.push("");
  return copy;
}

function readRefItems() {
  const tables = [];
  const lists = [];
  const paramDir = join(DOCS, "parameters");
  const manifestPath = join(paramDir, "PARAMETER_MANIFEST.json");
  if (existsSync(manifestPath)) {
    const manifest = readJson(manifestPath);
    for (const item of manifest.tables || []) {
      const file = join(paramDir, item.file || "");
      if (!item.file || !existsSync(file)) continue;
      const csv = readCsv(file);
      const columns = (item.columns && item.columns.length ? item.columns : csv.columns);
      tables.push({
        tableId: item.table_id,
        version: item.version || manifest.version || "",
        title: item.title || item.table_id,
        purpose: item.purpose || "regulatory_parameter",
        columns,
        rows: csv.rows.map((row) => fill(row, columns.length)),
        note: item.note || ""
      });
    }
  }
  const listDir = join(DOCS, "lists");
  const listManifestPath = join(listDir, "LIST_MANIFEST.json");
  if (existsSync(listManifestPath)) {
    const manifest = readJson(listManifestPath);
    for (const item of manifest.lists || []) {
      const file = join(listDir, item.file || "");
      if (!item.file || !existsSync(file)) continue;
      const csv = readCsv(file);
      const columns = (item.columns && item.columns.length ? item.columns : csv.columns);
      lists.push({
        listId: item.list_id,
        version: item.version || manifest.version || "",
        title: item.title || item.list_id,
        listType: item.list_type || "positive",
        columns,
        rows: csv.rows.map((row) => fill(row, columns.length)),
        note: item.note || ""
      });
    }
  }
  return { tables, lists };
}

/** 从 docs/信用风险规则/ 读取参数表与名单，导入当前地区。 */
async function importRefData(jurisdiction, ruleVersion, actor = "") {
  const ruleVersionId = await resolveVersionRef(ruleVersion, jurisdiction);
  const items = readRefItems();
  for (const item of items.tables) {
    await upsertParameterTable({ jurisdiction, ruleVersionId, actor, ...item });
  }
  for (const item of items.lists) {
    await upsertReferenceList({ jurisdiction, ruleVersionId, actor, ...item });
  }
  return { tables: items.tables.length, lists: items.lists.length };
}

function readProductGroups() {
  const file = join(DOCS, "product_groups.v1.0.0.json");
  if (!existsSync(file)) return [];
  try {
    const body = JSON.parse(readFileSync(file, "utf8"));
    return Array.isArray(body.groups) ? body.groups : [];
  } catch {
    return [];
  }
}

/** 从配套规范 02 的 67 个产品代码清单构造产品注册。 */
function productRegistry(classDoc, weightDoc, mappingBodies) {
  const spec = join(DOCS, "02_产品规则注册与字段映射规范.md");
  const families = {};
  if (existsSync(spec)) {
    const text = readFileSync(spec, "utf8");
    const pattern = /^\|\s*([A-Z_]+)\s*\|\s*`([A-Z0-9_]+)`\s*\|/gm;
    let match = pattern.exec(text);
    while (match) {
      const family = match[1];
      if (["LOAN", "BOND", "INTERBANK", "SFT", "DERIVATIVE", "EQUITY", "OFF_BALANCE", "TREASURY"].includes(family)) {
        if (!families[family]) families[family] = [];
        families[family].push(match[2]);
      }
      match = pattern.exec(text);
    }
  }

  const groupMeta = {};
  [classDoc, weightDoc].forEach((doc) => {
    (doc.field_groups || []).forEach((group) => {
      if (!group || !group.group_id || groupMeta[group.group_id]) return;
      groupMeta[group.group_id] = {
        label: group.label || group.group_id,
        label_en: group.label_en || "",
        level: group.level || "FACILITY",
        description: group.description || "",
        order: typeof group.order === "number" ? group.order : null
      };
    });
  });
  const readable = (code) => String(code || "").split("_").map((word) => word ? word.charAt(0) + word.slice(1).toLowerCase() : "").join(" ").trim();
  const mappingByFamily = {};
  (mappingBodies || []).forEach((body) => {
    if (body && body.product_family) mappingByFamily[body.product_family] = body;
  });

  const businessGroups = readProductGroups();
  const productMappings = Object.keys(families).map((family) => {
    const mapping = mappingByFamily[family] || {};
    const fieldMap = new Map();
    (mapping.mappings || []).forEach((item) => {
      if (!item || !item.source_field || !item.target_field || fieldMap.has(item.source_field)) return;
      fieldMap.set(item.source_field, {
        name: item.source_field,
        label: item.description || item.source_field,
        label_en: "",
        type: item.source_type || "string",
        group: item.target_group || "PRODUCT_TRANSACTION",
        required: item.required !== false,
        status: "ACTIVE",
        unit: item.unit || "",
        precision: null,
        scale: null,
        format: "",
        default_value: "",
        description: item.description || item.source_field,
        description_en: "",
        dictionary: "",
        enum_values: [],
        source_hint: item.source_field,
        aliases: []
      });
    });
    const fields = [...fieldMap.values()];
    const groups = {};
    fields.forEach((field) => {
      if (!groups[field.group]) {
        const meta = groupMeta[field.group] || {};
        groups[field.group] = {
          group_id: field.group,
          label: meta.label || field.group,
          label_en: meta.label_en || readable(field.group),
          description: meta.description || "",
          order: meta.order == null ? 999 : meta.order,
          field_count: 0
        };
      }
      groups[field.group].field_count += 1;
    });
    const familyGroups = businessGroups.filter((group) => group && group.product_family === family && group.group_code);
    const productCodes = Array.from(new Set(families[family].concat(familyGroups.map((group) => group.group_code))));
    const productProfiles = {};
    familyGroups.forEach((group) => {
      productProfiles[group.group_code] = {
        candidate_exposure_classes: (group.candidate_exposure_classes || []).slice(),
        note: (group.member_codes || []).join(",")
      };
    });
    return {
      product_family: family,
      product_codes: productCodes,
      product_profiles: productProfiles,
      data_mapping_ref: mapping.mapping_name || family + "_DATA_MAPPING",
      data_mapping_version: mapping.version || "1.0.0",
      candidate_exposure_classes: mapping.candidate_exposure_classes || [],
      target_profile_ref: mapping.target_profile_ref || family,
      standard_fields: fields,
      standard_field_groups: Object.keys(groups).map((key) => groups[key]).sort((left, right) => (left.order || 999) - (right.order || 999))
    };
  }).filter((mapping) => mapping.candidate_exposure_classes.length && mapping.standard_fields.length);

  return {
    registry_name: "STC_PRODUCT_REGISTRY",
    title: "STC 产品规则注册",
    version: "1.1.0",
    status: "DRAFT",
    jurisdiction: "HK",
    framework: "STC",
    field_schema_version: 2,
    dictionaries: [],
    effective_from: classDoc.effective_from || null,
    default_rule_sets: {
      classification_rule_ref: classDoc.name,
      classification_rule_version: classDoc.version,
      risk_weight_rule_ref: weightDoc.name,
      risk_weight_rule_version: weightDoc.version
    },
    rule_set_version_policy: {
      selection_basis: "MEASUREMENT_DATE",
      on_missing_version: "manual_review",
      require_same_version_date: true
    },
    product_mappings: productMappings
  };
}

async function upsertRuleDocument(input) {
  const meta = metadataOf(input.body);
  const row = {
    jurisdiction: input.jurisdiction,
    kind: input.kind,
    name: meta.name,
    docVersion: meta.version || "0.0.1",
    ruleVersion: input.ruleVersion
  };
  const id = ruleDocumentId(row);
  const versionId = await resolveVersionRef(input.ruleVersion, input.jurisdiction);
  await query(
    `INSERT INTO rule_document
       (id, jurisdiction, rule_version, kind, name, doc_version, status, title, body, updated_at,
        rule_version_id, revision, content_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
     ON DUPLICATE KEY UPDATE
       doc_version = VALUES(doc_version), status = VALUES(status), title = VALUES(title),
       body = VALUES(body), updated_at = VALUES(updated_at), rule_version_id = VALUES(rule_version_id),
       revision = revision + 1, content_hash = VALUES(content_hash)`,
    [id, row.jurisdiction, row.ruleVersion, row.kind, row.name, row.docVersion, meta.status, meta.title, JSON.stringify(input.body), stamp(), versionId, hashOf(input.body)]
  );
  clearExposureCache(versionId);
  await recordRevision({
    ruleVersionId: versionId, objectType: "rule_document", objectKey: row.kind + "|" + row.name,
    action: "IMPORT", after: { status: meta.status, docVersion: row.docVersion, hash: hashOf(input.body) }, actor: input.actor || ""
  });
  return id;
}

function latestRuleSet(prefix) {
  if (!existsSync(DOCS)) return "";
  const pattern = new RegExp("^" + prefix + "\\.v(\\d+\\.\\d+\\.\\d+)\\.json$");
  const candidates = readdirSync(DOCS)
    .map((name) => ({ name, match: pattern.exec(name) }))
    .filter((item) => item.match)
    .sort((a, b) => {
      const left = a.match[1].split(".").map(Number);
      const right = b.match[1].split(".").map(Number);
      for (let index = 0; index < 3; index += 1) {
        if (left[index] !== right[index]) return right[index] - left[index];
      }
      return 0;
    });
  return candidates.length ? join(DOCS, candidates[0].name) : "";
}

export async function importStcDocuments({ jurisdiction = "HK", version, actor = "", dryRun = false }) {
  if (!version) bad("缺少监管版本");
  const classPath = latestRuleSet("STC_EXPOSURE_CLASSIFICATION");
  const weightPath = latestRuleSet("STC_RISK_WEIGHT");
  if (!classPath || !weightPath || !existsSync(classPath) || !existsSync(weightPath)) {
    bad("仓库里没有 docs/信用风险规则/ 下的两份 STC 规则集 JSON，当前环境不能执行导入预览");
  }
  const classDoc = readJson(classPath);
  const weightDoc = readJson(weightPath);
  const ruleVersionId = await resolveVersionRef(version, jurisdiction);
  const mappingDir = join(DOCS, "mappings");
  const mappingNames = existsSync(mappingDir)
    ? readdirSync(mappingDir).filter((name) => name.endsWith(".json") && !name.startsWith(".")).sort()
    : [];
  const mappingBodies = mappingNames
    .map((file) => readJson(join(mappingDir, file)))
    .filter((body) => body && body.mapping_name);
  const registry = productRegistry(classDoc, weightDoc, mappingBodies);
  registry.jurisdiction = jurisdiction;

  const plans = [
    { kind: "exposure_classification", body: classDoc },
    { kind: "risk_weight", body: weightDoc },
    ...mappingBodies.map((body) => ({ kind: "data_mapping", body })),
    { kind: "product_registry", body: registry }
  ].map((item) => {
    const meta = metadataOf(item.body);
    const id = ruleDocumentId({
      jurisdiction, kind: item.kind, name: meta.name,
      docVersion: meta.version || "0.0.1", ruleVersion: version
    });
    return { ...item, meta, id, hash: hashOf(item.body) };
  });

  if (dryRun) {
    const existingDocs = await query(
      "SELECT kind, name, content_hash, body FROM rule_document WHERE rule_version_id = ?",
      [ruleVersionId]
    );
    const docMap = new Map(existingDocs.map((row) => [row.kind + "|" + row.name, row]));
    const documents = plans.map((plan) => {
      const key = plan.kind + "|" + plan.meta.name;
      const row = docMap.get(key);
      return {
        key,
        kind: plan.kind,
        name: plan.meta.name,
        id: plan.id,
        change: !row ? "added" : ((row.content_hash || hashOf(documentOf(row.body))) === plan.hash ? "same" : "updated")
      };
    });
    const refItems = readRefItems();
    const existingTables = await query("SELECT table_id, table_version, columns_json, rows_json FROM rule_parameter_table WHERE rule_version_id = ?", [ruleVersionId]);
    const existingLists = await query("SELECT list_id, list_version, columns_json, rows_json FROM rule_list WHERE rule_version_id = ?", [ruleVersionId]);
    const tableMap = new Map(existingTables.map((row) => [row.table_id + "|" + row.table_version, hashOf([documentOf(row.columns_json) || [], documentOf(row.rows_json) || []])]));
    const listMap = new Map(existingLists.map((row) => [row.list_id + "|" + row.list_version, hashOf([documentOf(row.columns_json) || [], documentOf(row.rows_json) || []])]));
    const compare = (items, map, idKey) => {
      const rows = items.map((item) => {
        const key = item[idKey] + "|" + item.version;
        const hash = hashOf([item.columns || [], item.rows || []]);
        return { key, change: !map.has(key) ? "added" : (map.get(key) === hash ? "same" : "updated") };
      });
      return {
        total: rows.length,
        added: rows.filter((row) => row.change === "added").length,
        updated: rows.filter((row) => row.change === "updated").length,
        same: rows.filter((row) => row.change === "same").length,
        rows
      };
    };
    return {
      dryRun: true,
      version,
      jurisdiction,
      documents,
      documentChanges: {
        total: documents.length,
        added: documents.filter((row) => row.change === "added").length,
        updated: documents.filter((row) => row.change === "updated").length,
        same: documents.filter((row) => row.change === "same").length
      },
      parameterTables: compare(refItems.tables, tableMap, "tableId"),
      referenceLists: compare(refItems.lists, listMap, "listId")
    };
  }

  let preImportSnapshot = null;
  if (ruleVersionId) preImportSnapshot = await createRuleConfigSnapshot(ruleVersionId, actor, "PRE_IMPORT");
  const refs = await importRefData(jurisdiction, version, actor);
  const documents = [];
  for (const plan of plans) {
    const id = await upsertRuleDocument({ jurisdiction, ruleVersion: version, kind: plan.kind, body: plan.body, actor });
    documents.push({ id, kind: plan.kind, name: plan.meta.name });
  }
  return {
    version,
    jurisdiction,
    rulesets: documents.filter((item) => item.kind === "exposure_classification" || item.kind === "risk_weight"),
    registryId: (documents.find((item) => item.kind === "product_registry") || {}).id,
    mappingCount: documents.filter((item) => item.kind === "data_mapping").length,
    parameterTables: refs.tables,
    referenceLists: refs.lists,
    preImportSnapshot
  };
}
