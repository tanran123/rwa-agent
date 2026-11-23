// 确保部署库里存在香港资本充足率版本，供 import-rulesets / seed-hk-ead 使用。
//
// 用法（仓库根目录或容器内）：
//   node tools/ensure-hk-version.mjs
//   node tools/ensure-hk-version.mjs --version HK-SA-2026.1 --jurisdiction HK
//
// 已存在时不覆盖；只在缺失时插入一条草稿版本。

import { pool, query } from "../server/src/db.js";

function argument(name, fallback) {
  const index = process.argv.indexOf("--" + name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function stamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + " " +
    pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
}

const VERSION = argument("version", "HK-SA-2026.1");
const JURISDICTION = argument("jurisdiction", "HK");
const ID = argument("id", "rv-hk-2026-1");

try {
  const rows = await query(
    "SELECT id, status, config_status FROM rule_version WHERE jurisdiction = ? AND version = ? LIMIT 1",
    [JURISDICTION, VERSION]
  );
  if (rows[0]) {
    console.log("版本已存在：" + rows[0].id + "（" + rows[0].status + " / " + rows[0].config_status + "）");
  } else {
    const now = stamp();
    await query(
      `INSERT INTO rule_version
         (id, jurisdiction, version, name, rule_type, effective_from, effective_to, status,
          institution, ruleset_file, published_at, author, changelog, framework, revision,
          created_by, updated_by, created_at, updated_at, config_status)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, '', ?, ?, 'CAR', 1, ?, ?, ?, ?, ?)`,
      [
        ID, JURISDICTION, VERSION, "香港银行业（资本）规则", "资本充足率", "2027-01-01",
        "draft", "香港分行", "ruleset_hk.json", "规则管理员·黄嘉怡",
        "香港资本充足率规则基线，按 STC 2026.1 配置。",
        "deploy", "deploy", now, now, "CONFIGURING"
      ]
    );
    console.log("已创建草稿版本：" + ID + " / " + JURISDICTION + " / " + VERSION);
  }
} catch (err) {
  console.error("失败：" + (err && err.message ? err.message : err));
  process.exitCode = 1;
} finally {
  await pool.end();
}
