/**
 * 旧配置体系归档导出。
 *
 *   node tools/archive-legacy-config.mjs [--out output/legacy-config.json]
 *
 * 只读取和导出，不删除、不改写任何表。旧表写入已由 Koa 返回 409 阻止。
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { query, pool } from "../server/src/db.js";

const TABLES = [
  "product_type",
  "product_field",
  "field_mapping",
  "exposure_document",
  "weight_rule",
  "bank_grade_row",
  "mo_weight_row",
  "ccf_rule",
  "crm_rule",
  "product_exposure_rule"
];

function arg(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const out = arg("--out", join("output", "legacy-config-" + new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-") + ".json"));

const payload = { archivedAt: new Date().toISOString(), tables: {} };
for (const table of TABLES) {
  const rows = await query(`SELECT * FROM ${table}`);
  payload.tables[table] = { count: rows.length, rows };
  console.log(table, rows.length);
}

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(payload, null, 2));
console.log("written", out);
await pool.end();
