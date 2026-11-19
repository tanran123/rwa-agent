/**
 * 流动性产品配置工作台 V2.0 的增量迁移。
 *
 *   node tools/migrate-liquidity-workbench.mjs
 *   node tools/migrate-liquidity-workbench.mjs --jurisdiction HK --version HK-SA-2026.1
 *
 * 只做增量：补表、补列，并从现有字段和规则回填字段分组、码值字典、
 * 字段属性和规则包关联。重复执行不会重复写入。
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pool, query } from "../server/src/db.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SEED = join(ROOT, "server", "data", "liquidity.v1.0.0.json");

function arg(name, fallback = "") {
  const index = process.argv.indexOf("--" + name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function uid(jurisdiction, version, ...parts) {
  return [jurisdiction, "liquidity", version, ...parts].join("-").replace(/[^A-Za-z0-9_.-]+/g, "-");
}

function text(value, size) {
  return String(value == null ? "" : value).slice(0, size);
}

function stamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

const DICT_NAMES = {
  DICT_CURRENCY: "币种",
  DICT_COUNTERPARTY_TYPE: "交易对手类型",
  DICT_ISSUER_TYPE: "发行人类型",
  DICT_HQLA_LEVEL: "HQLA 等级",
  DICT_CUSTOMER_TYPE: "客户类型",
  DICT_DEPOSIT_STABILITY: "存款稳定性",
  DICT_COMMITMENT_TYPE: "承诺类型"
};

const data = JSON.parse(readFileSync(SEED, "utf8"));
const jurisdiction = arg("jurisdiction", "HK").toUpperCase();
let version = arg("version", "");

if (!version) {
  const rows = await query(
    "SELECT version FROM rule_version WHERE jurisdiction = ? ORDER BY status = 'published' DESC, version DESC LIMIT 1",
    [jurisdiction]
  );
  version = rows.length ? rows[0].version : "";
}
if (!version) {
  console.error("没有找到可用的监管规则版本，请用 --version 指定");
  process.exit(1);
}

const now = stamp();

const TABLES = [
  `CREATE TABLE IF NOT EXISTS liquidity_product_group (
    id VARCHAR(180) NOT NULL PRIMARY KEY,
    jurisdiction CHAR(2) NOT NULL,
    rule_version VARCHAR(40) NOT NULL,
    product_code VARCHAR(64) NOT NULL,
    group_code VARCHAR(64) NOT NULL,
    group_name VARCHAR(128) NOT NULL,
    description VARCHAR(500) NOT NULL DEFAULT '',
    conditions_json JSON NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    sort_order INT NOT NULL DEFAULT 0,
    updated_at VARCHAR(32) NOT NULL DEFAULT '',
    UNIQUE KEY uk_liquidity_product_group (jurisdiction, rule_version, product_code, group_code),
    KEY idx_liquidity_product_group_product (jurisdiction, rule_version, product_code)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS liquidity_field_group (
    id VARCHAR(180) NOT NULL PRIMARY KEY,
    jurisdiction CHAR(2) NOT NULL,
    rule_version VARCHAR(40) NOT NULL,
    product_code VARCHAR(64) NOT NULL,
    group_code VARCHAR(64) NOT NULL,
    group_name VARCHAR(128) NOT NULL,
    parent_code VARCHAR(64) NOT NULL DEFAULT '',
    description VARCHAR(500) NOT NULL DEFAULT '',
    sort_order INT NOT NULL DEFAULT 0,
    status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    updated_at VARCHAR(32) NOT NULL DEFAULT '',
    UNIQUE KEY uk_liquidity_field_group (jurisdiction, rule_version, product_code, group_code),
    KEY idx_liquidity_field_group_product (jurisdiction, rule_version, product_code)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS liquidity_dictionary (
    id VARCHAR(180) NOT NULL PRIMARY KEY,
    jurisdiction CHAR(2) NOT NULL,
    rule_version VARCHAR(40) NOT NULL,
    dict_code VARCHAR(64) NOT NULL,
    dict_name VARCHAR(128) NOT NULL,
    description VARCHAR(500) NOT NULL DEFAULT '',
    dict_type VARCHAR(16) NOT NULL DEFAULT 'PUBLIC',
    product_code VARCHAR(64) NOT NULL DEFAULT '',
    status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    updated_at VARCHAR(32) NOT NULL DEFAULT '',
    UNIQUE KEY uk_liquidity_dictionary (jurisdiction, rule_version, dict_code),
    KEY idx_liquidity_dictionary_product (jurisdiction, rule_version, product_code)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS liquidity_dictionary_item (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    jurisdiction CHAR(2) NOT NULL,
    rule_version VARCHAR(40) NOT NULL,
    dict_code VARCHAR(64) NOT NULL,
    item_code VARCHAR(64) NOT NULL,
    item_name VARCHAR(128) NOT NULL DEFAULT '',
    description VARCHAR(255) NOT NULL DEFAULT '',
    sort_order INT NOT NULL DEFAULT 0,
    status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    UNIQUE KEY uk_liquidity_dictionary_item (jurisdiction, rule_version, dict_code, item_code)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS liquidity_rule_scope (
    id VARCHAR(180) NOT NULL PRIMARY KEY,
    jurisdiction CHAR(2) NOT NULL,
    rule_version VARCHAR(40) NOT NULL,
    product_code VARCHAR(64) NOT NULL,
    group_code VARCHAR(64) NOT NULL DEFAULT '',
    package_id VARCHAR(64) NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    updated_at VARCHAR(32) NOT NULL DEFAULT '',
    UNIQUE KEY uk_liquidity_rule_scope (jurisdiction, rule_version, product_code, group_code, package_id),
    KEY idx_liquidity_rule_scope_product (jurisdiction, rule_version, product_code)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
];

for (const sql of TABLES) await query(sql);

async function hasColumn(table, column) {
  const rows = await query(
    `SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    [table, column]
  );
  return rows.length > 0;
}

if (!(await hasColumn("liquidity_product", "group_mode"))) {
  await query("ALTER TABLE liquidity_product ADD COLUMN group_mode VARCHAR(8) NOT NULL DEFAULT 'NONE' AFTER rule_count");
}
if (!(await hasColumn("liquidity_product_field", "attributes_json"))) {
  await query("ALTER TABLE liquidity_product_field ADD COLUMN attributes_json JSON NULL AFTER sort_order");
}

const sourceFields = new Map();
const sourceGroups = new Map();
const dictionaryItems = new Map();

for (const product of data.products || []) {
  for (const field of product.fields || []) {
    sourceFields.set(product.code + "\n" + field.id, field);
    if (field.groupId) {
      const key = product.code + "\n" + field.groupId;
      if (!sourceGroups.has(key)) {
        sourceGroups.set(key, {
          product: product.code,
          code: field.groupId,
          name: field.groupName || field.groupId,
          order: Number(field.groupOrder) || 0
        });
      }
    }
    const dict = String(field.dictionary || "").trim();
    if (!dict) continue;
    if (!dictionaryItems.has(dict)) dictionaryItems.set(dict, new Map());
    const bag = dictionaryItems.get(dict);
    for (const value of field.enum || []) {
      const code = text(value, 64);
      if (code) bag.set(code, code);
    }
  }
}

const fields = await query(
  "SELECT * FROM liquidity_product_field WHERE jurisdiction = ? AND rule_version = ?",
  [jurisdiction, version]
);

const fieldGroupKeys = new Set();
for (const row of fields) {
  const source = sourceFields.get(row.product_code + "\n" + row.field_code);
  const groupCode = source && source.groupId ? text(source.groupId, 64) : text(row.field_group, 64);
  const groupName = source && source.groupName ? text(source.groupName, 128) : text(row.field_group, 128);
  if (!groupCode) continue;
  fieldGroupKeys.add(row.product_code + "\n" + groupCode);
  await query(
    `INSERT IGNORE INTO liquidity_field_group
       (id, jurisdiction, rule_version, product_code, group_code, group_name, parent_code,
        description, sort_order, status, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, '', '', ?, 'ACTIVE', ?)`,
    [
      uid(jurisdiction, version, "fg", text(row.product_code, 64), groupCode), jurisdiction, version,
      text(row.product_code, 64), groupCode, groupName,
      source ? Number(source.groupOrder) || 0 : Number(row.group_order) || 0, now
    ]
  );
  if (source && source.groupId && row.field_group !== source.groupId) {
    await query(
      "UPDATE liquidity_product_field SET field_group = ? WHERE jurisdiction = ? AND rule_version = ? AND product_code = ? AND field_code = ? AND (field_group = '' OR field_group = ?)",
      [text(source.groupId, 64), jurisdiction, version, row.product_code, row.field_code, text(source.groupName || "", 64)]
    );
  }
  if (source) {
    const attributes = {
      categoryName: source.categoryName || "",
      businessType: source.businessType || "",
      unit: source.unit || "",
      precision: source.precision == null ? null : Number(source.precision),
      nullable: source.nullable == null ? null : !!source.nullable,
      defaultValue: source.default == null ? null : source.default,
      sourceType: source.sourceType || "",
      enum: Array.isArray(source.enum) ? source.enum : [],
      hint: source.hint || "",
      example: source.example || "",
      requiredNote: source.requiredNote || ""
    };
    await query(
      "UPDATE liquidity_product_field SET attributes_json = ? WHERE jurisdiction = ? AND rule_version = ? AND product_code = ? AND field_code = ? AND attributes_json IS NULL",
      [JSON.stringify(attributes), jurisdiction, version, row.product_code, row.field_code]
    );
  }
}

const dictionaries = new Map(dictionaryItems);
for (const row of fields) {
  const dict = String(row.dictionary || "").trim();
  if (dict && !dictionaries.has(dict)) dictionaries.set(dict, new Map());
}
for (const [dictCode, items] of dictionaries) {
  await query(
    `INSERT IGNORE INTO liquidity_dictionary
       (id, jurisdiction, rule_version, dict_code, dict_name, description, dict_type, product_code, status, updated_at)
     VALUES (?, ?, ?, ?, ?, '', 'PUBLIC', '', 'ACTIVE', ?)`,
    [uid(jurisdiction, version, "dict", dictCode), jurisdiction, version, dictCode, DICT_NAMES[dictCode] || dictCode, now]
  );
  let order = 0;
  for (const [code, name] of items) {
    order += 1;
    await query(
      `INSERT IGNORE INTO liquidity_dictionary_item
         (jurisdiction, rule_version, dict_code, item_code, item_name, description, sort_order, status)
       VALUES (?, ?, ?, ?, ?, '', ?, 'ACTIVE')`,
      [jurisdiction, version, dictCode, code, name, order]
    );
  }
}

const rules = await query(
  "SELECT rule_id, package_id, products_json FROM liquidity_rule WHERE jurisdiction = ? AND rule_version = ?",
  [jurisdiction, version]
);
for (const rule of rules) {
  const products = typeof rule.products_json === "string" ? JSON.parse(rule.products_json || "[]") : (rule.products_json || []);
  for (const code of Array.isArray(products) ? products : []) {
    await query(
      `INSERT IGNORE INTO liquidity_rule_scope
         (id, jurisdiction, rule_version, product_code, group_code, package_id, status, updated_at)
       VALUES (?, ?, ?, ?, '', ?, 'ACTIVE', ?)`,
      [uid(jurisdiction, version, "scope", text(code, 64), text(rule.package_id, 64)), jurisdiction, version, text(code, 64), text(rule.package_id, 64), now]
    );
  }
}

console.log(
  `迁移完成 ${jurisdiction} ${version}：${fields.length} 个字段、` +
  `${fieldGroupKeys.size} 个字段分组、${dictionaries.size} 个码值字典、${rules.length} 条规则的规则包关联`
);
await pool.end();
