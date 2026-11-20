import { query } from "./db.js";

function nowText() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + " " +
    pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
}

export async function recordRevision({
  ruleVersionId = "", objectType, objectKey = "", action = "UPDATE", before = null, after = null, actor = ""
}) {
  const rows = await query(
    `SELECT MAX(revision) AS revision FROM config_revision
      WHERE rule_version_id = ? AND object_type = ? AND object_key = ?`,
    [ruleVersionId, objectType, objectKey]
  );
  const revision = (Number(rows[0] && rows[0].revision) || 0) + 1;
  await query(
    `INSERT INTO config_revision
       (rule_version_id, object_type, object_key, revision, action, before_json, after_json, actor, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      ruleVersionId, objectType, objectKey, revision, action,
      before == null ? null : JSON.stringify(before),
      after == null ? null : JSON.stringify(after),
      actor || "", nowText()
    ]
  );
  return revision;
}

export async function latestConfigRevision(ruleVersionId, objectType, objectKey = "") {
  const rows = await query(
    `SELECT MAX(revision) AS revision FROM config_revision
      WHERE rule_version_id = ? AND object_type = ? AND (? = '' OR object_key = ?)`,
    [ruleVersionId, objectType, objectKey, objectKey]
  );
  return Number(rows[0] && rows[0].revision) || 0;
}

export function assertRevision(current, expected, label) {
  if (expected == null || expected === "") return;
  if (Number(expected) !== Number(current)) {
    const err = new Error(label + "已被其他人修改，请刷新后再保存");
    err.status = 409;
    throw err;
  }
}

export async function assertVersionWritable(ruleVersionId) {
  if (!ruleVersionId) return;
  const rows = await query("SELECT status FROM rule_version WHERE id = ?", [ruleVersionId]);
  if (rows[0] && rows[0].status === "published") {
    const err = new Error("当前版本已发布，配置只读；请先撤回发布");
    err.status = 409;
    throw err;
  }
}
