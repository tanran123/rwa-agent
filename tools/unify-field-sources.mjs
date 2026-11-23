/**
 * 把规则字段来源统一为两类：column / calc。
 *
 *   node tools/unify-field-sources.mjs [--version HK-SA-2026.1] [--dry-run]
 *
 * 非 calc 来源（prepared / manual / external / legacy_calc）全部改为 column，
 * 并移除 prepared / external_input / legacy_calc 元数据；原 prepared 契约写入 note。
 * 已发布版本只读，会跳过。可重复执行。
 */
import { pool, query } from "../server/src/db.js";
import { saveRuleDocument } from "../server/src/ruleDocs.js";

function arg(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}
const VERSION = arg("--version", "");
const DRY_RUN = process.argv.includes("--dry-run");

function json(value) {
  if (value == null) return {};
  if (typeof value === "string") {
    try { return JSON.parse(value); } catch { return {}; }
  }
  return value;
}

async function main() {
  const params = [];
  let sql = `SELECT d.id, d.kind, d.rule_version, d.revision, d.body, v.status AS version_status
               FROM rule_document d
               LEFT JOIN rule_version v ON v.id = d.rule_version_id
              WHERE d.kind IN ('exposure_classification', 'risk_weight')`;
  if (VERSION) { sql += " AND d.rule_version = ?"; params.push(VERSION); }
  const rows = await query(sql, params);
  const done = [];
  const skipped = [];
  for (const row of rows) {
    if (row.version_status === "published") {
      skipped.push({ id: row.id, ruleVersion: row.rule_version, reason: "版本已发布，配置只读" });
      continue;
    }
    const body = json(row.body);
    const changed = [];
    (body.fields || []).forEach((field) => {
      if (!field || !field.name) return;
      const current = field.source || "column";
      if (current === "calc") return;
      if (current !== "column") {
        const prepared = field.prepared && typeof field.prepared === "object" ? field.prepared : null;
        const detail = prepared
          ? " 原 prepared 契约 " + (prepared.contract_ref || "—") + "，阶段 " + (prepared.stage || "—") + "。"
          : "";
        field.note = String(field.note || "").trim() + " 已统一为 column 外部输入，由产品标准字段映射提供。" + detail;
        field.source = "column";
        delete field.prepared;
        delete field.external_input;
        delete field.legacy_calc;
        changed.push(field.name + "(" + current + "→column)");
      } else {
        // 理论上 column 不应带 prepared；兼容旧文档时一并清理。
        if (field.prepared != null) { delete field.prepared; changed.push(field.name + "(清理 prepared)"); }
        if (field.external_input != null) { delete field.external_input; changed.push(field.name + "(清理 external_input)"); }
      }
    });
    if (!changed.length) continue;
    const summary = { id: row.id, kind: row.kind, ruleVersion: row.rule_version, changed };
    if (DRY_RUN) {
      done.push({ ...summary, dryRun: true });
      continue;
    }
    try {
      await saveRuleDocument(row.id, {
        body,
        baseRevision: row.revision,
        actor: "unify-field-sources"
      });
      done.push(summary);
    } catch (err) {
      skipped.push({ ...summary, reason: err.message || "保存失败" });
    }
  }
  console.log(JSON.stringify({ dryRun: DRY_RUN, version: VERSION || "all", done, skipped }, null, 2));
}

main().catch((err) => { console.error(err); process.exitCode = 1; }).finally(() => pool.end());
