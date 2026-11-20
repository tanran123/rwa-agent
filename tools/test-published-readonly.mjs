/**
 * 验证已发布版本的服务端只读约束。
 *
 *   node tools/test-published-readonly.mjs
 *
 * 只创建临时版本和临时参数表，不修改现有业务数据；结束后自动清理。
 */

import { query, pool } from "../server/src/db.js";

const API = process.env.RWA_API || "http://127.0.0.1:8780/api";
const stamp = Date.now();
const versionId = "rv-readonly-test-" + stamp;
const tableId = "HK-T_READONLY_TEST-" + stamp;
const version = "HK-READONLY-" + stamp;

async function call(path, options) {
  const response = await fetch(API + path, options);
  const text = await response.text();
  let body = text;
  try { body = JSON.parse(text); } catch {}
  return { status: response.status, body };
}

try {
  await query(
    `INSERT INTO rule_version
       (id, jurisdiction, version, name, rule_type, effective_from, effective_to, status, institution, ruleset_file,
        published_at, author, changelog, framework, source_version_id, revision, created_by, updated_by,
        created_at, updated_at, config_status, validated_at, published_snapshot_id)
     VALUES (?, 'HK', ?, '只读约束测试', '资本充足率', NULL, NULL, 'published', '', '',
             '', '', '', 'CAR', '', 1, 'test', 'test', ?, ?, 'PUBLISHED', '', '')`,
    [versionId, version, new Date().toISOString().slice(0, 19).replace("T", " "), new Date().toISOString().slice(0, 19).replace("T", " ")]
  );
  await query(
    `INSERT INTO rule_parameter_table
       (id, jurisdiction, table_id, table_version, title, purpose, columns_json, rows_json, note, updated_at, rule_version_id)
     VALUES (?, 'HK', ?, '1.0', '只读约束测试', 'regulatory_parameter', ?, ?, '', ?, ?)`,
    [tableId, tableId, JSON.stringify(["A"]), JSON.stringify([["1"]]), new Date().toISOString().slice(0, 19).replace("T", " "), versionId]
  );

  const blocked = await call("/parameter-tables/" + encodeURIComponent(tableId), {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ columns: ["A"], rows: [["2"]] })
  });
  console.log("published save", blocked.status, blocked.status === 409 ? "PASS" : "FAIL");

  const withdraw = await call("/rule-versions/" + encodeURIComponent(versionId) + "/withdraw", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}"
  });
  console.log("withdraw", withdraw.status, withdraw.status === 200 ? "PASS" : "FAIL");

  const allowed = await call("/parameter-tables/" + encodeURIComponent(tableId), {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ columns: ["A"], rows: [["2"]] })
  });
  console.log("draft save", allowed.status, allowed.status === 200 ? "PASS" : "FAIL");

  if (blocked.status !== 409 || withdraw.status !== 200 || allowed.status !== 200) process.exitCode = 1;
} finally {
  await query("DELETE FROM rule_parameter_table WHERE id = ?", [tableId]);
  await query("DELETE FROM config_revision WHERE rule_version_id = ?", [versionId]);
  const snaps = await query("SELECT id FROM rule_config_snapshot WHERE rule_version_id = ?", [versionId]);
  for (const snap of snaps) {
    await query("DELETE FROM rule_config_snapshot_item WHERE snapshot_id = ?", [snap.id]);
    await query("DELETE FROM rule_config_snapshot WHERE id = ?", [snap.id]);
  }
  await query("DELETE FROM rule_version WHERE id = ?", [versionId]);
  await pool.end();
}
