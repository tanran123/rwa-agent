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
  connectionLimit: 8,
  dateStrings: true,
  supportBigNumbers: true
});

export async function query(sql, params) {
  const [rows] = await pool.query(sql, params);
  return rows;
}
