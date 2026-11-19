import { query } from "./db.js";

/** 监管版本字符串 → rule_version.id。找不到返回空串，调用方按旧口径回退。 */
export async function ruleVersionId(version, jurisdiction = "") {
  const text = String(version || "").trim();
  if (!text) return "";
  const rows = await query(
    `SELECT id FROM rule_version
      WHERE version = ? AND (? = '' OR jurisdiction = ?)
      ORDER BY status = 'published' DESC, effective_from DESC LIMIT 1`,
    [text, jurisdiction, jurisdiction]
  );
  return rows[0] ? rows[0].id : "";
}

/** 辖区当前版本：优先已发布，其次日期最新的版本。 */
export async function currentRuleVersion(jurisdiction = "HK") {
  const rows = await query(
    `SELECT * FROM rule_version WHERE jurisdiction = ?
      ORDER BY status = 'published' DESC, status = 'draft' DESC, effective_from DESC, version DESC LIMIT 1`,
    [jurisdiction]
  );
  return rows[0] || null;
}

export async function currentRuleVersionId(jurisdiction = "HK") {
  const row = await currentRuleVersion(jurisdiction);
  return row ? row.id : "";
}

/** 版本字符串或 rule_version.id 都可以传，统一解析成 id。 */
export async function resolveVersionRef(value, jurisdiction = "") {
  const text = String(value || "").trim();
  if (!text) return "";
  const byId = await query("SELECT id FROM rule_version WHERE id = ?", [text]);
  if (byId[0]) return byId[0].id;
  return ruleVersionId(text, jurisdiction);
}

/** 读取版本时同时给出 id；已有 id 时直接用。 */
export async function resolveRuleVersion({ ruleVersionId: id = "", version = "", jurisdiction = "" } = {}) {
  if (id) return String(id);
  return ruleVersionId(version, jurisdiction);
}
