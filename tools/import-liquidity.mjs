/**
 * 把 server/data/liquidity.v1.0.0.json 导入某个监管规则版本的流动性产品配置。
 *
 *   node tools/import-liquidity.mjs                       # 香港当前版本
 *   node tools/import-liquidity.mjs --jurisdiction MO --version MO-SA-2026.1
 *   node tools/import-liquidity.mjs --reset               # 先清空该版本的流动性配置
 *
 * 数据来自 LCR 系统原型的 16 个产品、242 个标准字段和 68 条规则；
 * 产品编码、字段编码和参数键都在 JSON 里，不在本脚本里另写一套。
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

function uid(jurisdiction, version, code) {
  return [jurisdiction, "liquidity", version, code].join("-").replace(/[^A-Za-z0-9_.-]+/g, "-");
}

function stamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
}

function text(value, size) {
  return String(value == null ? "" : value).slice(0, size);
}

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

if (process.argv.includes("--reset")) {
  await query("DELETE FROM liquidity_config_meta WHERE jurisdiction = ? AND rule_version = ?", [jurisdiction, version]);
  await query("DELETE FROM liquidity_product_field WHERE jurisdiction = ? AND rule_version = ?", [jurisdiction, version]);
  await query("DELETE FROM liquidity_product WHERE jurisdiction = ? AND rule_version = ?", [jurisdiction, version]);
  await query("DELETE FROM liquidity_rule WHERE jurisdiction = ? AND rule_version = ?", [jurisdiction, version]);
  await query("DELETE FROM liquidity_param_table WHERE jurisdiction = ? AND rule_version = ?", [jurisdiction, version]);
  await query("DELETE FROM liquidity_param WHERE jurisdiction = ? AND rule_version = ?", [jurisdiction, version]);
  await query("DELETE FROM liquidity_list WHERE jurisdiction = ? AND rule_version = ?", [jurisdiction, version]);
}

const now = stamp();

await query(
  `INSERT INTO liquidity_config_meta
     (id, jurisdiction, rule_version, lcr_version, lcr_version_name, snapshot_json, source, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)
   ON DUPLICATE KEY UPDATE
     lcr_version = VALUES(lcr_version), lcr_version_name = VALUES(lcr_version_name),
     snapshot_json = VALUES(snapshot_json), source = VALUES(source), updated_at = VALUES(updated_at)`,
  [
    uid(jurisdiction, version, "meta"), jurisdiction, version,
    text(data.meta.lcrVersion, 40), text(data.meta.lcrVersionName, 200),
    JSON.stringify(data.meta.snapshot || {}), text(data.meta.source, 255), now
  ]
);

for (const product of data.products) {
  const domainCodes = (product.domains || []).map((item) => item.code);
  await query(
    `INSERT INTO liquidity_product
       (id, jurisdiction, rule_version, code, name, category, product_group, side, source_system,
        status, description, domains_json, param_key, rule_count, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       name = VALUES(name), category = VALUES(category), product_group = VALUES(product_group),
       side = VALUES(side), source_system = VALUES(source_system), status = VALUES(status),
       description = VALUES(description), domains_json = VALUES(domains_json),
       param_key = VALUES(param_key), rule_count = VALUES(rule_count), updated_at = VALUES(updated_at)`,
    [
      uid(jurisdiction, version, product.code), jurisdiction, version, text(product.code, 64),
      text(product.name, 128), text(product.category, 64), text(product.group, 64), text(product.side, 16),
      text(product.source, 64), text(product.status || "LIVE", 16), text(product.description, 500),
      JSON.stringify(domainCodes), text(product.paramKey, 64), (product.ruleIds || []).length, now
    ]
  );

  let order = 0;
  for (const field of product.fields || []) {
    order += 1;
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
         description = VALUES(description),
         status = VALUES(status), sort_order = VALUES(sort_order)`,
      [
        jurisdiction, version, text(product.code, 64), text(field.id, 64), text(field.name, 128),
        text(field.category, 64), text(field.groupName || field.groupId, 64), Number(field.groupOrder) || 0,
        text(field.type, 24), text(field.role || "NONE", 24), field.required ? 1 : 0,
        text(field.valueType, 24), text(field.dictionary, 64), text(field.source, 128),
        JSON.stringify(field.aliases || []),
        text(field.description, 500), text(field.status || "ACTIVE", 16), order
      ]
    );
  }
}

for (const rule of data.rules) {
  await query(
    `INSERT INTO liquidity_rule
       (id, jurisdiction, rule_version, rule_id, name, package_id, package_name, side,
        sequence_no, priority, rule_type, rule_type_name, condition_text, result_text,
        basis, description, products_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       name = VALUES(name), package_id = VALUES(package_id), package_name = VALUES(package_name),
       side = VALUES(side), sequence_no = VALUES(sequence_no), priority = VALUES(priority),
       rule_type = VALUES(rule_type), rule_type_name = VALUES(rule_type_name),
       condition_text = VALUES(condition_text), result_text = VALUES(result_text),
       basis = VALUES(basis), description = VALUES(description), products_json = VALUES(products_json)`,
    [
      uid(jurisdiction, version, rule.id), jurisdiction, version, text(rule.id, 64), text(rule.name, 200),
      text(rule.package, 64), text(rule.packageName, 128), text(rule.side, 16),
      Number(rule.sequence) || 0, Number(rule.priority) || 0, text(rule.ruleType, 24),
      text(rule.ruleTypeName, 64), rule.condition || "", rule.resultText || "",
      text(rule.basis, 128), rule.description || "", JSON.stringify(rule.products || [])
    ]
  );
}

for (const table of data.tables || []) {
  await query(
    `INSERT INTO liquidity_param_table
       (id, jurisdiction, rule_version, table_id, title, kind, rows_json, note, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       title = VALUES(title), kind = VALUES(kind), rows_json = VALUES(rows_json),
       note = VALUES(note), updated_at = VALUES(updated_at)`,
    [
      uid(jurisdiction, version, table.id), jurisdiction, version, text(table.id, 64),
      text(table.name, 255), text(table.kind, 32), JSON.stringify(table.rows || []),
      "来源：LCR 系统原型示例参数表，正式投产须以现行监管规则为准。", now
    ]
  );
}

for (const param of data.params || []) {
  await query(
    `INSERT INTO liquidity_param
       (id, jurisdiction, rule_version, param_id, name, value, unit, basis)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       name = VALUES(name), value = VALUES(value), unit = VALUES(unit), basis = VALUES(basis)`,
    [
      uid(jurisdiction, version, param.id), jurisdiction, version, text(param.id, 64),
      text(param.name, 128), Number(param.value) || 0, text(param.unit, 24), text(param.basis, 128)
    ]
  );
}

for (const list of data.lists || []) {
  await query(
    `INSERT INTO liquidity_list
       (id, jurisdiction, rule_version, list_id, title, list_type, list_version, items_json, note, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       title = VALUES(title), list_type = VALUES(list_type), list_version = VALUES(list_version),
       items_json = VALUES(items_json), note = VALUES(note), updated_at = VALUES(updated_at)`,
    [
      uid(jurisdiction, version, list.code), jurisdiction, version, text(list.code, 64),
      text(list.name, 255), text(list.type, 32), text(list.version, 32), JSON.stringify(list.items || []),
      text(list.source, 500), now
    ]
  );
}

console.log(
  `已导入 ${jurisdiction} ${version}：${data.products.length} 个产品、` +
  `${data.products.reduce((sum, item) => sum + (item.fields || []).length, 0)} 个字段、` +
  `${data.rules.length} 条规则、${(data.tables || []).length} 张参数表、` +
  `${(data.params || []).length} 个参数、${(data.lists || []).length} 份名单`
);
await pool.end();
