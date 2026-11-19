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
const DICT_NAMES = {
  DICT_CURRENCY: "币种",
  DICT_COUNTERPARTY_TYPE: "交易对手类型",
  DICT_ISSUER_TYPE: "发行人类型",
  DICT_HQLA_LEVEL: "HQLA 等级",
  DICT_CUSTOMER_TYPE: "客户类型",
  DICT_DEPOSIT_STABILITY: "存款稳定性",
  DICT_COMMITMENT_TYPE: "承诺类型"
};

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
  await query("DELETE FROM liquidity_product_group WHERE jurisdiction = ? AND rule_version = ?", [jurisdiction, version]);
  await query("DELETE FROM liquidity_field_group WHERE jurisdiction = ? AND rule_version = ?", [jurisdiction, version]);
  await query("DELETE FROM liquidity_dictionary_item WHERE jurisdiction = ? AND rule_version = ?", [jurisdiction, version]);
  await query("DELETE FROM liquidity_dictionary WHERE jurisdiction = ? AND rule_version = ?", [jurisdiction, version]);
  await query("DELETE FROM liquidity_rule_scope WHERE jurisdiction = ? AND rule_version = ?", [jurisdiction, version]);
  await query("DELETE FROM liquidity_product WHERE jurisdiction = ? AND rule_version = ?", [jurisdiction, version]);
  await query("DELETE FROM liquidity_rule WHERE jurisdiction = ? AND rule_version = ?", [jurisdiction, version]);
  await query("DELETE FROM liquidity_param_table WHERE jurisdiction = ? AND rule_version = ?", [jurisdiction, version]);
  await query("DELETE FROM liquidity_param WHERE jurisdiction = ? AND rule_version = ?", [jurisdiction, version]);
  await query("DELETE FROM liquidity_list WHERE jurisdiction = ? AND rule_version = ?", [jurisdiction, version]);
}

const fieldGroups = new Map();
const dictionaries = new Map();

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
        status, description, domains_json, param_key, rule_count, group_mode, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       name = VALUES(name), category = VALUES(category), product_group = VALUES(product_group),
       side = VALUES(side), source_system = VALUES(source_system), status = VALUES(status),
       description = VALUES(description), domains_json = VALUES(domains_json),
       param_key = VALUES(param_key), rule_count = VALUES(rule_count),
       group_mode = VALUES(group_mode), updated_at = VALUES(updated_at)`,
    [
      uid(jurisdiction, version, product.code), jurisdiction, version, text(product.code, 64),
      text(product.name, 128), text(product.category, 64), text(product.group, 64), text(product.side, 16),
      text(product.source, 64), text(product.status || "LIVE", 16), text(product.description, 500),
      JSON.stringify(domainCodes), text(product.paramKey, 64), (product.ruleIds || []).length,
      text(product.groupMode || "NONE", 8), now
    ]
  );

  let order = 0;
  for (const field of product.fields || []) {
    order += 1;
    if (field.groupId) {
      fieldGroups.set(product.code + "\n" + field.groupId, {
        product: product.code,
        code: field.groupId,
        name: field.groupName || field.groupId,
        order: Number(field.groupOrder) || 0
      });
    }
    if (field.dictionary) {
      if (!dictionaries.has(field.dictionary)) dictionaries.set(field.dictionary, new Map());
      const bag = dictionaries.get(field.dictionary);
      for (const value of field.enum || []) bag.set(text(value, 64), text(value, 64));
    }
    const attributes = {
      categoryName: field.categoryName || "",
      businessType: field.businessType || "",
      unit: field.unit || "",
      precision: field.precision == null ? null : Number(field.precision),
      nullable: field.nullable == null ? null : !!field.nullable,
      defaultValue: field.default == null ? null : field.default,
      sourceType: field.sourceType || "",
      enum: Array.isArray(field.enum) ? field.enum : [],
      hint: field.hint || "",
      example: field.example || "",
      requiredNote: field.requiredNote || ""
    };
    await query(
      `INSERT INTO liquidity_product_field
         (jurisdiction, rule_version, product_code, field_code, field_name, category, field_group,
          group_order, data_type, role, required, value_type, dictionary, source_column,
          aliases_json, description, status, sort_order, attributes_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         field_name = VALUES(field_name), category = VALUES(category), field_group = VALUES(field_group),
         group_order = VALUES(group_order), data_type = VALUES(data_type), role = VALUES(role),
         required = VALUES(required), value_type = VALUES(value_type), dictionary = VALUES(dictionary),
         source_column = VALUES(source_column), aliases_json = VALUES(aliases_json),
         description = VALUES(description), status = VALUES(status), sort_order = VALUES(sort_order),
         attributes_json = VALUES(attributes_json)`,
      [
        jurisdiction, version, text(product.code, 64), text(field.id, 64), text(field.name, 128),
        text(field.category, 64), text(field.groupId || field.groupName, 64), Number(field.groupOrder) || 0,
        text(field.type, 24), text(field.role || "NONE", 24), field.required ? 1 : 0,
        text(field.valueType, 24), text(field.dictionary, 64), text(field.source, 128),
        JSON.stringify(field.aliases || []),
        text(field.description, 500), text(field.status || "ACTIVE", 16), order,
        JSON.stringify(attributes)
      ]
    );
  }
}

for (const group of fieldGroups.values()) {
  await query(
    `INSERT INTO liquidity_field_group
       (id, jurisdiction, rule_version, product_code, group_code, group_name, parent_code,
        description, sort_order, status, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, '', '', ?, 'ACTIVE', ?)
     ON DUPLICATE KEY UPDATE group_name = VALUES(group_name), sort_order = VALUES(sort_order)`,
    [uid(jurisdiction, version, "fg", group.product, group.code), jurisdiction, version, text(group.product, 64), text(group.code, 64), text(group.name, 128), group.order, now]
  );
}

for (const [dictCode, items] of dictionaries) {
  await query(
    `INSERT INTO liquidity_dictionary
       (id, jurisdiction, rule_version, dict_code, dict_name, description, dict_type, product_code, status, updated_at)
     VALUES (?, ?, ?, ?, ?, '', 'PUBLIC', '', 'ACTIVE', ?)
     ON DUPLICATE KEY UPDATE dict_name = VALUES(dict_name)`,
    [uid(jurisdiction, version, "dict", dictCode), jurisdiction, version, text(dictCode, 64), text(DICT_NAMES[dictCode] || dictCode, 128), now]
  );
  let itemOrder = 0;
  for (const [code, name] of items) {
    itemOrder += 1;
    await query(
      `INSERT INTO liquidity_dictionary_item
         (jurisdiction, rule_version, dict_code, item_code, item_name, description, sort_order, status)
       VALUES (?, ?, ?, ?, ?, '', ?, 'ACTIVE')
       ON DUPLICATE KEY UPDATE item_name = VALUES(item_name), sort_order = VALUES(sort_order)`,
      [jurisdiction, version, text(dictCode, 64), code, name, itemOrder]
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
  for (const code of rule.products || []) {
    await query(
      `INSERT INTO liquidity_rule_scope
         (id, jurisdiction, rule_version, product_code, group_code, package_id, status, updated_at)
       VALUES (?, ?, ?, ?, '', ?, 'ACTIVE', ?)
       ON DUPLICATE KEY UPDATE status = VALUES(status)`,
      [uid(jurisdiction, version, "scope", text(code, 64), text(rule.package, 64)), jurisdiction, version, text(code, 64), text(rule.package, 64), now]
    );
  }
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
