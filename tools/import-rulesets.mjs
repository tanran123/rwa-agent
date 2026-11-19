// 把 docs/信用风险规则/ 下的香港 STC 规则集、参数表、名单和 8 套字段映射导入数据库。
// 用法（仓库根目录）：node tools/import-rulesets.mjs --version "HK-SA-2026.1" --jurisdiction HK
// 只会覆盖同一地区、同一监管版本下的同名文档，不动其它版本。

import { pool } from "../server/src/db.js";
import { importStcDocuments } from "../server/src/ruleDocs.js";

function argument(name, fallback) {
  const index = process.argv.indexOf("--" + name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const version = argument("version", "");
const jurisdiction = argument("jurisdiction", "HK");

if (!version) {
  console.error("缺少 --version，例如：node tools/import-rulesets.mjs --version HK-SA-2026.1");
  process.exit(1);
}

try {
  const result = await importStcDocuments({ jurisdiction, version });
  console.log(JSON.stringify(result, null, 2));
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
