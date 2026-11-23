// 从当前数据库导出可部署的业务数据快照（schema + data）。
//
// 用法（仓库根目录）：
//   node tools/export-db-snapshot.mjs
//   node tools/export-db-snapshot.mjs --out docker/offline/db-snapshot.sql
//
// 说明：
//   - 包含所有表的 CREATE TABLE，表结构与当前库一致；
//   - 包含业务配置、任务和计量数据；
//   - 不导出日志/令牌/模型密钥表的数据（表结构仍保留，导入后为空）；
//   - 文件是完整替换脚本，导入时会 DROP 并重建这些表。

import { writeFileSync } from "node:fs";
import { query, pool } from "../server/src/db.js";

function argument(name, fallback) {
  const index = process.argv.indexOf("--" + name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const OUT = argument("out", "docker/offline/db-snapshot.sql");

// 这些表只保留结构，不导出数据：日志、令牌、模型密钥、对话记录。
const NO_DATA = new Set([
  "assistant_turn",
  "hqla_audit_log",
  "llm_config",
  "login_log",
  "operation_log",
  "token_log"
]);

const BATCH_ROWS = 100;

function ident(name) {
  return "`" + String(name).replace(/`/g, "``") + "`";
}

function valueSql(value) {
  if (value == null) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "boolean") return value ? "1" : "0";
  if (Buffer.isBuffer(value)) return "X'" + value.toString("hex") + "'";
  if (value instanceof Date) {
    return "'" + value.toISOString().slice(0, 19).replace("T", " ") + "'";
  }
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return "'" + text
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/\0/g, "\\0")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\x1a/g, "\\Z") + "'";
}

function rowSql(row) {
  const columns = Object.keys(row);
  return "(" + columns.map((key) => valueSql(row[key])).join(",") + ")";
}

function insertSql(table, rows) {
  if (!rows.length) return "";
  const columns = Object.keys(rows[0]).map(ident).join(",");
  const chunks = [];
  for (let index = 0; index < rows.length; index += BATCH_ROWS) {
    const batch = rows.slice(index, index + BATCH_ROWS);
    chunks.push(
      "INSERT INTO " + ident(table) + " (" + columns + ") VALUES\n" +
      batch.map(rowSql).join(",\n") + ";"
    );
  }
  return chunks.join("\n");
}

try {
  const tableRows = await query(
    "SELECT TABLE_NAME AS name FROM information_schema.tables WHERE table_schema = 'rwa' ORDER BY TABLE_NAME"
  );
  const tables = tableRows.map((row) => row.name);
  const lines = [];
  lines.push("-- RWA Agent 数据库快照");
  lines.push("-- 生成时间：" + new Date().toISOString());
  lines.push("-- 导入方式：./restore-snapshot.sh 或 mysql < sql/003_snapshot.sql");
  lines.push("-- 注意：脚本会 DROP 并重建下列表，原有数据会被替换。");
  lines.push("");
  lines.push("SET NAMES utf8mb4;");
  lines.push("SET FOREIGN_KEY_CHECKS = 0;");
  lines.push("SET UNIQUE_CHECKS = 0;");
  lines.push("CREATE DATABASE IF NOT EXISTS `rwa` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;");
  lines.push("USE `rwa`;");
  lines.push("");

  for (const table of tables) {
    const createRows = await query("SHOW CREATE TABLE " + ident(table));
    const createSql = Object.values(createRows[0] || {})[1];
    if (!createSql) throw new Error("读不到建表语句：" + table);
    lines.push("-- ---------------------------- " + table);
    lines.push("DROP TABLE IF EXISTS " + ident(table) + ";");
    lines.push(createSql + ";");
    if (!NO_DATA.has(table)) {
      const rows = await query("SELECT * FROM " + ident(table));
      if (rows.length) {
        lines.push(insertSql(table, rows));
      }
      console.log(table + "：" + rows.length + " 行");
    } else {
      console.log(table + "：只导出结构（日志/密钥/对话）");
    }
    lines.push("");
  }

  lines.push("SET UNIQUE_CHECKS = 1;");
  lines.push("SET FOREIGN_KEY_CHECKS = 1;");
  lines.push("");

  writeFileSync(OUT, lines.join("\n"), "utf8");
  console.log("已生成 " + OUT);
} catch (err) {
  console.error("导出失败：" + (err && err.message ? err.message : err));
  process.exitCode = 1;
} finally {
  await pool.end();
}
