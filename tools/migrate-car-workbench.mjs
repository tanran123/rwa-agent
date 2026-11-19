/**
 * CAR 配置体系阶段 0/1 增量迁移。
 *
 *   node tools/migrate-car-workbench.mjs [--rule-version-id rv-hk-2026-1]
 *
 * 只补表、补列、回填版本归属和索引，不删除业务数据。可重复执行。
 * 回填规则：
 *   - rule_document / measure_batch / rwa_task 按 (jurisdiction, version) 找 rule_version；
 *   - EAD / CRM 有明确产品版本或 version 列的，跟随该版本；无法判断的归入香港当前版本；
 *   - 参数表和名单归入香港当前版本；条款按辖区归入该辖区当前版本。
 * 找不到版本的 rule_document 会列在 unresolved 清单里，不强行归属。
 */

import { createHash } from "node:crypto";
import { pool, query } from "../server/src/db.js";

function arg(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const TARGET_VERSION_ID = arg("--rule-version-id", "rv-hk-2026-1");
const HK_JURISDICTION = "HK";

async function hasColumn(table, column) {
  const rows = await query(
    `SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    [table, column]
  );
  return rows.length > 0;
}

async function addColumn(table, column, definition) {
  if (await hasColumn(table, column)) return false;
  console.error("add column", table + "." + column);
  await query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  return true;
}

async function hasIndex(table, index) {
  const rows = await query(
    `SELECT 1 FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1`,
    [table, index]
  );
  return rows.length > 0;
}

async function addIndex(table, index, definition) {
  if (await hasIndex(table, index)) return;
  await query(`ALTER TABLE ${table} ADD ${definition}`);
}

async function dropIndex(table, index) {
  if (!(await hasIndex(table, index))) return;
  await query(`ALTER TABLE ${table} DROP INDEX ${index}`);
}

async function primaryColumns(table) {
  const rows = await query(
    `SELECT COLUMN_NAME FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = 'PRIMARY'
      ORDER BY SEQ_IN_INDEX`,
    [table]
  );
  return rows.map((row) => row.COLUMN_NAME);
}

async function setPrimary(table, columns) {
  if (columns.length < 1) return;
  const now = await primaryColumns(table);
  if (now.length === columns.length && columns.every((column, index) => now[index] === column)) return;
  console.error("set primary", table, columns.join(","));
  await query(`ALTER TABLE ${table} DROP PRIMARY KEY`);
  await query(`ALTER TABLE ${table} ADD PRIMARY KEY (${columns.join(", ")})`);
}

function hash(value) {
  return createHash("sha256").update(JSON.stringify(value == null ? null : value)).digest("hex");
}

function stamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + " " +
    pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
}

// ---------------------------------------------------------------- 列

await addColumn("rule_version", "framework", "VARCHAR(16) NOT NULL DEFAULT 'CAR'");
await addColumn("rule_version", "source_version_id", "VARCHAR(40) NOT NULL DEFAULT ''");
await addColumn("rule_version", "revision", "INT NOT NULL DEFAULT 1");
await addColumn("rule_version", "created_by", "VARCHAR(64) NOT NULL DEFAULT ''");
await addColumn("rule_version", "updated_by", "VARCHAR(64) NOT NULL DEFAULT ''");
await addColumn("rule_version", "created_at", "VARCHAR(32) NOT NULL DEFAULT ''");
await addColumn("rule_version", "updated_at", "VARCHAR(32) NOT NULL DEFAULT ''");
await addColumn("rule_version", "config_status", "VARCHAR(16) NOT NULL DEFAULT 'EMPTY'");
await addColumn("rule_version", "validated_at", "VARCHAR(32) NOT NULL DEFAULT ''");
await addColumn("rule_version", "published_snapshot_id", "VARCHAR(40) NOT NULL DEFAULT ''");

await addColumn("rule_document", "rule_version_id", "VARCHAR(40) NOT NULL DEFAULT ''");
await addColumn("rule_document", "revision", "INT NOT NULL DEFAULT 1");
await addColumn("rule_document", "updated_by", "VARCHAR(64) NOT NULL DEFAULT ''");
await addColumn("rule_document", "content_hash", "CHAR(64) NOT NULL DEFAULT ''");

await addColumn("rule_parameter_table", "rule_version_id", "VARCHAR(40) NOT NULL DEFAULT ''");
await addColumn("rule_parameter_table", "revision", "INT NOT NULL DEFAULT 1");
await addColumn("rule_parameter_table", "updated_by", "VARCHAR(64) NOT NULL DEFAULT ''");

await addColumn("rule_list", "rule_version_id", "VARCHAR(40) NOT NULL DEFAULT ''");
await addColumn("rule_list", "revision", "INT NOT NULL DEFAULT 1");
await addColumn("rule_list", "updated_by", "VARCHAR(64) NOT NULL DEFAULT ''");

await addColumn("clause_doc", "rule_version_id", "VARCHAR(40) NOT NULL DEFAULT ''");
await addColumn("clause_doc", "framework", "VARCHAR(16) NOT NULL DEFAULT 'CAR'");
await addColumn("clause_doc", "clause_code", "VARCHAR(32) NOT NULL DEFAULT ''");
await addColumn("clause_doc", "regulation_name", "VARCHAR(128) NOT NULL DEFAULT ''");
await addColumn("clause_doc", "regulation_version", "VARCHAR(32) NOT NULL DEFAULT ''");
await addColumn("clause_doc", "status", "VARCHAR(16) NOT NULL DEFAULT 'ACTIVE'");
await addColumn("clause_doc", "revision", "INT NOT NULL DEFAULT 1");
await addColumn("clause_doc", "updated_by", "VARCHAR(64) NOT NULL DEFAULT ''");
await addColumn("clause_doc", "updated_at", "VARCHAR(32) NOT NULL DEFAULT ''");

await addColumn("ead_product_config", "rule_version_id", "VARCHAR(40) NOT NULL DEFAULT ''");
await addColumn("ead_product_config", "decision_status", "VARCHAR(16) NOT NULL DEFAULT 'UNDECIDED'");
await addColumn("ead_product_config", "revision", "INT NOT NULL DEFAULT 1");
await addColumn("ead_product_config", "status", "VARCHAR(16) NOT NULL DEFAULT 'APPROVED'");
await addColumn("ead_product_config", "updated_by", "VARCHAR(64) NOT NULL DEFAULT ''");
await addColumn("ead_product_config", "updated_at", "VARCHAR(32) NOT NULL DEFAULT ''");

await addColumn("ead_product_rule", "rule_version_id", "VARCHAR(40) NOT NULL DEFAULT ''");
await addColumn("ead_product_rule", "revision", "INT NOT NULL DEFAULT 1");

await addColumn("crm_product_config", "rule_version_id", "VARCHAR(40) NOT NULL DEFAULT ''");
await addColumn("crm_product_config", "decision_status", "VARCHAR(16) NOT NULL DEFAULT 'UNDECIDED'");
await addColumn("crm_product_config", "revision", "INT NOT NULL DEFAULT 1");
await addColumn("crm_product_config", "status", "VARCHAR(16) NOT NULL DEFAULT 'APPROVED'");
await addColumn("crm_product_config", "updated_by", "VARCHAR(64) NOT NULL DEFAULT ''");
await addColumn("crm_product_config", "updated_at", "VARCHAR(32) NOT NULL DEFAULT ''");

await addColumn("crm_slot_column", "rule_version_id", "VARCHAR(40) NOT NULL DEFAULT ''");
await addColumn("crm_slot_column", "target_fact_code", "VARCHAR(40) NOT NULL DEFAULT ''");

await addColumn("crm_eligible_type", "rule_version_id", "VARCHAR(40) NOT NULL DEFAULT ''");
await addColumn("crm_eligible_type", "clause_id", "VARCHAR(32) NOT NULL DEFAULT ''");
await addColumn("crm_eligible_type", "status", "VARCHAR(16) NOT NULL DEFAULT 'ACTIVE'");

await addColumn("measure_batch", "rule_version_id", "VARCHAR(40) NOT NULL DEFAULT ''");
await addColumn("measure_batch", "snapshot_id", "VARCHAR(40) NOT NULL DEFAULT ''");
await addColumn("measure_batch", "engine_version", "VARCHAR(40) NOT NULL DEFAULT ''");

await addColumn("rwa_task", "rule_version_id", "VARCHAR(40) NOT NULL DEFAULT ''");
await addColumn("rwa_task", "snapshot_id", "VARCHAR(40) NOT NULL DEFAULT ''");

// ---------------------------------------------------------------- 新表
console.error("stage: 新表");

await query(`CREATE TABLE IF NOT EXISTS config_revision (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  rule_version_id VARCHAR(40) NOT NULL DEFAULT '',
  object_type VARCHAR(40) NOT NULL,
  object_key VARCHAR(160) NOT NULL DEFAULT '',
  revision INT NOT NULL DEFAULT 1,
  action VARCHAR(16) NOT NULL DEFAULT 'UPDATE',
  before_json JSON NULL,
  after_json JSON NULL,
  actor VARCHAR(64) NOT NULL DEFAULT '',
  created_at VARCHAR(32) NOT NULL,
  KEY idx_config_revision_object (rule_version_id, object_type, object_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

await query(`CREATE TABLE IF NOT EXISTS rule_config_snapshot (
  id VARCHAR(40) NOT NULL PRIMARY KEY,
  rule_version_id VARCHAR(40) NOT NULL,
  jurisdiction CHAR(2) NOT NULL DEFAULT '',
  framework VARCHAR(16) NOT NULL DEFAULT 'CAR',
  version VARCHAR(40) NOT NULL DEFAULT '',
  snapshot_no INT NOT NULL DEFAULT 1,
  config_hash CHAR(64) NOT NULL DEFAULT '',
  status VARCHAR(16) NOT NULL DEFAULT 'PUBLISHED',
  created_by VARCHAR(64) NOT NULL DEFAULT '',
  created_at VARCHAR(32) NOT NULL,
  KEY idx_rule_snapshot_version (rule_version_id, snapshot_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

await query(`CREATE TABLE IF NOT EXISTS rule_config_snapshot_item (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  snapshot_id VARCHAR(40) NOT NULL,
  object_type VARCHAR(40) NOT NULL,
  object_key VARCHAR(160) NOT NULL DEFAULT '',
  content_json LONGTEXT NOT NULL,
  content_hash CHAR(64) NOT NULL DEFAULT '',
  KEY idx_rule_snapshot_item (snapshot_id, object_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

await query(`CREATE TABLE IF NOT EXISTS rule_clause_relation (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  rule_version_id VARCHAR(40) NOT NULL DEFAULT '',
  rule_document_id VARCHAR(120) NOT NULL DEFAULT '',
  rule_node_id VARCHAR(120) NOT NULL DEFAULT '',
  clause_id VARCHAR(32) NOT NULL,
  relation_type VARCHAR(24) NOT NULL DEFAULT 'REFERENCE',
  created_at VARCHAR(32) NOT NULL DEFAULT '',
  KEY idx_rule_clause_relation (rule_version_id, rule_document_id),
  KEY idx_rule_clause_clause (clause_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

// ---------------------------------------------------------------- 版本基础信息
console.error("stage: 版本基础信息");

const versions = await query("SELECT * FROM rule_version ORDER BY jurisdiction, version");
const target = versions.find((row) => row.id === TARGET_VERSION_ID)
  || versions.find((row) => row.jurisdiction === HK_JURISDICTION && row.status === "published")
  || versions.find((row) => row.jurisdiction === HK_JURISDICTION)
  || null;

if (!target) throw new Error("找不到可用于回填的 rule_version，请先创建香港监管版本");

function latestOf(jurisdiction) {
  const list = versions.filter((row) => row.jurisdiction === jurisdiction);
  const published = list.filter((row) => row.status === "published");
  return (published.length ? published : list)[0] || target;
}

const byVersionKey = new Map();
versions.forEach((row) => byVersionKey.set(row.jurisdiction + "|" + row.version, row.id));

/** 有明确版本字符串就用它；没有就归香港当前版本。 */
function versionIdFor(value, jurisdiction, fallback = target.id) {
  const key = String(jurisdiction || "") + "|" + String(value || "");
  if (byVersionKey.has(key)) return byVersionKey.get(key);
  const match = versions.find((row) => row.version === value && (!jurisdiction || row.jurisdiction === jurisdiction));
  return match ? match.id : fallback;
}

const now = stamp();
await query(
  `UPDATE rule_version SET
     framework = IF(framework = '', 'CAR', framework),
     revision = IF(revision < 1, 1, revision),
     created_at = IF(created_at = '', IF(published_at = '' OR published_at = '—', ?, published_at), created_at),
     updated_at = IF(updated_at = '', IF(published_at = '' OR published_at = '—', ?, published_at), updated_at),
     config_status = CASE
       WHEN config_status <> '' AND config_status <> 'EMPTY' THEN config_status
       WHEN status = 'published' THEN 'PUBLISHED'
       WHEN status = 'superseded' THEN 'PUBLISHED'
       WHEN status IN ('draft', 'reviewing') THEN 'CONFIGURING'
       ELSE 'EMPTY' END`,
  [now, now]
);

// ---------------------------------------------------------------- 规则文档
console.error("stage: 规则文档");

const unresolvedDocs = [];
const documentRows = await query("SELECT id, jurisdiction, rule_version, kind, name, body FROM rule_document");
for (const row of documentRows) {
  const versionId = byVersionKey.get(row.jurisdiction + "|" + row.rule_version) || "";
  if (!versionId) unresolvedDocs.push({ id: row.id, jurisdiction: row.jurisdiction, version: row.rule_version, kind: row.kind, name: row.name });
  let body = row.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = row.body; }
  }
  await query(
    "UPDATE rule_document SET rule_version_id = ?, revision = IF(revision < 1, 1, revision), content_hash = ? WHERE id = ?",
    [versionId, hash(body), row.id]
  );
}

// ---------------------------------------------------------------- 参数表、名单
console.error("stage: 参数表、名单");

const hkId = target.id;
await query(
  "UPDATE rule_parameter_table SET rule_version_id = ? WHERE rule_version_id = ''",
  [hkId]
);
await query(
  "UPDATE rule_list SET rule_version_id = ? WHERE rule_version_id = ''",
  [hkId]
);

// ---------------------------------------------------------------- 条款
console.error("stage: 条款");

const clauseVersion = {
  HK: target.id,
  CN: latestOf("CN").id,
  MO: latestOf("MO").id
};
for (const jurisdiction of Object.keys(clauseVersion)) {
  await query(
    `UPDATE clause_doc SET
       rule_version_id = ?,
       framework = IF(framework = '', 'CAR', framework),
       clause_code = IF(clause_code = '', clause_no, clause_code),
       regulation_name = IF(regulation_name = '', doc, regulation_name),
       regulation_version = IF(regulation_version = '', doc_version, regulation_version),
       status = IF(status = '', 'ACTIVE', status),
       revision = IF(revision < 1, 1, revision),
       updated_at = IF(updated_at = '', ?, updated_at)
     WHERE jurisdiction = ? AND rule_version_id = ''`,
    [clauseVersion[jurisdiction], now, jurisdiction]
  );
}

await query(
  `UPDATE clause_doc SET
     clause_code = IF(clause_code = '', clause_no, clause_code),
     regulation_name = IF(regulation_name = '', doc, regulation_name),
     regulation_version = IF(regulation_version = '', doc_version, regulation_version),
     revision = IF(revision < 1, 1, revision),
     updated_at = IF(updated_at = '', ?, updated_at)
   WHERE rule_version_id = ''`,
  [now]
);

// ---------------------------------------------------------------- EAD
console.error("stage: EAD");

const productVersions = new Map();
(await query("SELECT code, rule_version FROM product_type")).forEach((row) => {
  productVersions.set(row.code, row.rule_version);
});

const eadConfigRows = await query("SELECT product_code, version FROM ead_product_config");
for (const row of eadConfigRows) {
  const explicit = row.version ? versionIdFor(row.version, "", "") : "";
  const inherited = productVersions.has(row.product_code)
    ? versionIdFor(productVersions.get(row.product_code), "", target.id)
    : target.id;
  const versionId = explicit || inherited;
  await query(
    `UPDATE ead_product_config SET
       rule_version_id = ?,
       decision_status = IF(decision_status = '' OR decision_status = 'UNDECIDED', IF(needed = 1, 'REQUIRED', 'NOT_REQUIRED'), decision_status),
       revision = IF(revision < 1, 1, revision),
       status = IF(status = '', 'APPROVED', status),
       updated_at = IF(updated_at = '', ?, updated_at)
     WHERE product_code = ? AND rule_version_id = ''`,
    [versionId, now, row.product_code]
  );
}

const eadRuleRows = await query("SELECT id, product_code FROM ead_product_rule WHERE rule_version_id = ''");
for (const row of eadRuleRows) {
  const versionId = productVersions.has(row.product_code)
    ? versionIdFor(productVersions.get(row.product_code), "", target.id)
    : target.id;
  await query(
    "UPDATE ead_product_rule SET rule_version_id = ?, revision = IF(revision < 1, 1, revision) WHERE id = ? AND rule_version_id = ''",
    [versionId, row.id]
  );
}

// ---------------------------------------------------------------- CRM
console.error("stage: CRM");

function crmVersionOf(productCode) {
  return versionIdFor(productVersions.get(productCode) || "", "", target.id);
}

const crmConfigRows = await query("SELECT product_code FROM crm_product_config WHERE rule_version_id = ''");
for (const row of crmConfigRows) {
  await query(
    `UPDATE crm_product_config SET
       rule_version_id = ?,
       decision_status = IF(decision_status = '' OR decision_status = 'UNDECIDED', IF(needed = 1, 'REQUIRED', 'NOT_REQUIRED'), decision_status),
       revision = IF(revision < 1, 1, revision),
       status = IF(status = '', 'APPROVED', status),
       updated_at = IF(updated_at = '', ?, updated_at)
     WHERE product_code = ? AND rule_version_id = ''`,
    [crmVersionOf(row.product_code), now, row.product_code]
  );
}

const crmSlotRows = await query("SELECT product_code, attr FROM crm_slot_column WHERE rule_version_id = ''");
for (const row of crmSlotRows) {
  await query(
    "UPDATE crm_slot_column SET rule_version_id = ?, target_fact_code = IF(target_fact_code = '', attr, target_fact_code) WHERE product_code = ? AND attr = ? AND rule_version_id = ''",
    [crmVersionOf(row.product_code), row.product_code, row.attr]
  );
}

const crmTypeRows = await query("SELECT DISTINCT product_code FROM crm_eligible_type WHERE rule_version_id = ''");
for (const row of crmTypeRows) {
  await query(
    `UPDATE crm_eligible_type SET
       rule_version_id = ?,
       status = IF(status = '', 'ACTIVE', status)
     WHERE product_code = ? AND rule_version_id = ''`,
    [crmVersionOf(row.product_code), row.product_code]
  );
}

// ---------------------------------------------------------------- 批次、任务
console.error("stage: 批次、任务");

const batchRows = await query("SELECT id, jurisdiction, version FROM measure_batch WHERE rule_version_id = ''");
for (const row of batchRows) {
  const versionId = versionIdFor(row.version, row.jurisdiction, "");
  if (!versionId) continue;
  await query("UPDATE measure_batch SET rule_version_id = ? WHERE id = ?", [versionId, row.id]);
}

const taskRows = await query("SELECT id, jurisdiction, version FROM rwa_task WHERE rule_version_id = ''");
for (const row of taskRows) {
  const versionId = versionIdFor(row.version, row.jurisdiction, "");
  if (!versionId) continue;
  await query("UPDATE rwa_task SET rule_version_id = ? WHERE id = ?", [versionId, row.id]);
}

// ---------------------------------------------------------------- 条款引用
console.error("stage: 条款引用");

const existingRelations = await query("SELECT COUNT(*) AS n FROM rule_clause_relation");
if (!Number(existingRelations[0].n)) {
  await query(
    `INSERT INTO rule_clause_relation
       (rule_version_id, rule_document_id, rule_node_id, clause_id, relation_type, created_at)
     SELECT COALESCE(c.rule_version_id, ''), '', r.rule_name, r.clause_id, 'legacy_text', ?
     FROM clause_ref r JOIN clause_doc c ON c.id = r.clause_id`,
    [now]
  );
}

// ---------------------------------------------------------------- 唯一键和索引
console.error("stage: 唯一键和索引");

await setPrimary("ead_product_config", ["rule_version_id", "product_code"]);
await setPrimary("ead_product_rule", ["rule_version_id", "id"]);
await setPrimary("crm_product_config", ["rule_version_id", "product_code"]);
await setPrimary("crm_slot_column", ["rule_version_id", "product_code", "attr", "slot"]);
await setPrimary("crm_eligible_type", ["rule_version_id", "product_code", "code"]);

await dropIndex("rule_parameter_table", "uk_rule_parameter");
await addIndex("rule_parameter_table", "uk_rule_parameter", "UNIQUE KEY uk_rule_parameter (rule_version_id, table_id, table_version)");
await dropIndex("rule_list", "uk_rule_list");
await addIndex("rule_list", "uk_rule_list", "UNIQUE KEY uk_rule_list (rule_version_id, list_id, list_version)");

await addIndex("rule_version", "idx_rule_version_framework", "KEY idx_rule_version_framework (framework, config_status)");
await addIndex("rule_document", "idx_rule_document_vid", "KEY idx_rule_document_vid (rule_version_id, kind)");
await addIndex("clause_doc", "idx_clause_version", "KEY idx_clause_version (rule_version_id)");
await addIndex("ead_product_config", "idx_ead_config_product", "KEY idx_ead_config_product (product_code)");
await addIndex("ead_product_rule", "uk_ead_product_rule", "UNIQUE KEY uk_ead_product_rule (rule_version_id, product_code, seq)");
await addIndex("crm_product_config", "idx_crm_config_product", "KEY idx_crm_config_product (product_code)");
await addIndex("measure_batch", "idx_batch_version", "KEY idx_batch_version (rule_version_id)");
await addIndex("rwa_task", "idx_rwa_task_version", "KEY idx_rwa_task_version (rule_version_id)");

await pool.end();

console.log(JSON.stringify({
  targetVersionId: target.id,
  targetVersion: target.version,
  unresolvedDocuments: unresolvedDocs,
  note: "EAD/CRM 有明确版本列的按版本回填，无法判断的归入香港当前版本；参数表和名单归入香港当前版本。"
}, null, 2));
