import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";

const envFile = join(dirname(fileURLToPath(import.meta.url)), "..", ".env");
if (existsSync(envFile)) {
  readFileSync(envFile, "utf8").split("\n").forEach((line) => {
    const text = line.trim();
    if (!text || text.startsWith("#")) return;
    const eq = text.indexOf("=");
    if (eq < 0) return;
    const key = text.slice(0, eq).trim();
    if (process.env[key] == null || process.env[key] === "") process.env[key] = text.slice(eq + 1).trim();
  });
}

export const pool = mysql.createPool({
  host: process.env.MYSQL_HOST || "127.0.0.1",
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER || "root",
  password: process.env.MYSQL_PASSWORD || "",
  database: process.env.MYSQL_DATABASE || "rwa",
  charset: "utf8mb4",
  waitForConnections: true,
  connectionLimit: 16,
  maxIdle: 4,
  idleTimeout: 30000,
  connectTimeout: 10000,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
  dateStrings: true,
  supportBigNumbers: true
});

pool.on("error", (err) => {
  console.error(err);
});

/** 读查询遇到连接层瞬时错误时重试一次；写操作不重试，避免重复落库。 */
const RETRYABLE = new Set(["PROTOCOL_CONNECTION_LOST", "ECONNRESET", "ETIMEDOUT", "EPIPE"]);
const READ_SQL = /^\s*(select|show|describe|explain)\b/i;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function query(sql, params) {
  try {
    const [rows] = await pool.query(sql, params);
    return rows;
  } catch (err) {
    if (!READ_SQL.test(sql) || !RETRYABLE.has(err && err.code)) throw err;
    await wait(200);
    const [rows] = await pool.query(sql, params);
    return rows;
  }
}
