/**
 * 产品标准字段元数据迁移。
 *
 *   node tools/migrate-product-field-metadata.mjs [--dry-run]
 *
 * 把 product_registry 文档升级到 field_schema_version = 2：
 *   - standard_fields 去掉 maps_to 和 level，补齐中英文名、说明、状态、字典等键；
 *   - 同名标准字段合并为一条（映射目标仍保留在 data_mapping 文档里）；
 *   - standard_field_groups 补齐中文名、英文名、说明和顺序，保留空分组；
 *   - 文档顶层补 dictionaries: []。
 *
 * 只处理未发布版本；已发布版本只读，会列在 skipped 清单里。可重复执行。
 */

import { pool, query } from "../server/src/db.js";
import { saveRuleDocument } from "../server/src/ruleDocs.js";

const DRY_RUN = process.argv.includes("--dry-run");

function json(value) {
  if (value == null) return {};
  if (typeof value === "string") {
    try { return JSON.parse(value); } catch { return {}; }
  }
  return value;
}

function readable(code) {
  return String(code || "").split("_").map((word) => word ? word.charAt(0) + word.slice(1).toLowerCase() : "").join(" ").trim();
}

function isAsciiCode(value) {
  return /^[A-Z0-9_]+$/.test(String(value || ""));
}

function text(value) {
  return typeof value === "string" ? value : "";
}

function numberOrNull(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function normalizeField(field) {
  const label = text(field.label) || text(field.name);
  return {
    name: field.name,
    label,
    label_en: text(field.label_en),
    type: field.type || "string",
    group: field.group || "OTHER",
    required: !!field.required,
    status: field.status === "DISABLED" ? "DISABLED" : "ACTIVE",
    unit: text(field.unit),
    precision: numberOrNull(field.precision),
    scale: numberOrNull(field.scale),
    format: text(field.format),
    default_value: text(field.default_value),
    description: text(field.description) || label,
    description_en: text(field.description_en),
    dictionary: text(field.dictionary),
    enum_values: Array.isArray(field.enum_values) ? field.enum_values : [],
    source_hint: text(field.source_hint) || field.name,
    aliases: Array.isArray(field.aliases) ? field.aliases : []
  };
}

function mergeField(target, field) {
  const next = normalizeField(field);
  Object.keys(next).forEach((key) => {
    const value = next[key];
    if (value == null || value === "" || (Array.isArray(value) && !value.length)) return;
    if (target[key] == null || target[key] === "" || (Array.isArray(target[key]) && !target[key].length)) target[key] = value;
  });
  return target;
}

async function groupMetaOf(ruleVersion) {
  const rows = await query(
    "SELECT body FROM rule_document WHERE rule_version = ? AND kind IN ('exposure_classification', 'risk_weight')",
    [ruleVersion]
  );
  const meta = {};
  rows.forEach((row) => {
    const body = json(row.body);
    (body.field_groups || []).forEach((group) => {
      if (!group || !group.group_id || meta[group.group_id]) return;
      meta[group.group_id] = {
        label: group.label || "",
        label_en: group.label_en || "",
        level: group.level || "FACILITY",
        description: group.description || "",
        order: typeof group.order === "number" ? group.order : 999
      };
    });
  });
  return meta;
}

function upgrade(body, meta) {
  const next = JSON.parse(JSON.stringify(body || {}));
  const entries = Array.isArray(next.product_mappings) ? next.product_mappings : [];
  let removedMapsTo = 0;
  let mergedFields = 0;
  entries.forEach((entry) => {
    const fields = new Map();
    (entry.standard_fields || []).forEach((field) => {
      if (!field || !field.name) return;
      if (Object.prototype.hasOwnProperty.call(field, "maps_to")) removedMapsTo += 1;
      if (fields.has(field.name)) {
        mergeField(fields.get(field.name), field);
        mergedFields += 1;
      } else {
        fields.set(field.name, normalizeField(field));
      }
    });
    entry.standard_fields = [...fields.values()];

    const groups = new Map();
    (entry.standard_field_groups || []).forEach((group, index) => {
      if (!group || !group.group_id) return;
      const info = meta[group.group_id] || {};
      const rawLabel = text(group.label);
      groups.set(group.group_id, {
        group_id: group.group_id,
        label: (!rawLabel || isAsciiCode(rawLabel)) ? (info.label || rawLabel || group.group_id) : rawLabel,
        label_en: text(group.label_en) || info.label_en || readable(group.group_id),
        description: text(group.description) || info.description || "",
        order: typeof group.order === "number" ? group.order : (typeof info.order === "number" ? info.order : index),
        field_count: 0
      });
    });
    entry.standard_fields.forEach((field) => {
      if (!groups.has(field.group)) {
        const info = meta[field.group] || {};
        groups.set(field.group, {
          group_id: field.group,
          label: info.label || field.group,
          label_en: info.label_en || readable(field.group),
          description: info.description || "",
          order: typeof info.order === "number" ? info.order : 999,
          field_count: 0
        });
      }
    });
    groups.forEach((group) => {
      group.field_count = entry.standard_fields.filter((field) => field.group === group.group_id).length;
    });
    entry.standard_field_groups = [...groups.values()].sort((left, right) => (left.order == null ? 999 : left.order) - (right.order == null ? 999 : right.order));
  });
  next.field_schema_version = 2;
  next.dictionaries = Array.isArray(next.dictionaries) ? next.dictionaries : [];
  return { body: next, removedMapsTo, mergedFields };
}

async function main() {
  const rows = await query(
    `SELECT d.id, d.rule_version, d.revision, d.body, v.status AS version_status
       FROM rule_document d
       LEFT JOIN rule_version v ON v.id = d.rule_version_id
      WHERE d.kind = 'product_registry'`
  );
  const done = [];
  const skipped = [];
  for (const row of rows) {
    const body = json(row.body);
    const meta = await groupMetaOf(row.rule_version);
    if (!Array.isArray(body.product_mappings) || !body.product_mappings.length) {
      skipped.push({ id: row.id, ruleVersion: row.rule_version, reason: "没有 product_mappings" });
      continue;
    }
    const { body: next, removedMapsTo, mergedFields } = upgrade(body, meta);
    const summary = {
      id: row.id,
      ruleVersion: row.rule_version,
      fields: (next.product_mappings || []).reduce((sum, entry) => sum + (entry.standard_fields || []).length, 0),
      groups: (next.product_mappings || []).reduce((sum, entry) => sum + (entry.standard_field_groups || []).length, 0),
      removedMapsTo,
      mergedFields
    };
    if (row.version_status === "published") {
      skipped.push({ ...summary, reason: "版本已发布，配置只读" });
      continue;
    }
    if (DRY_RUN) {
      done.push({ ...summary, dryRun: true });
      continue;
    }
    try {
      await saveRuleDocument(row.id, {
        body: next,
        baseRevision: row.revision,
        actor: "migrate-product-field-metadata"
      });
      done.push(summary);
    } catch (err) {
      skipped.push({ ...summary, reason: err.message || "保存失败" });
    }
  }
  console.log(JSON.stringify({ dryRun: DRY_RUN, done, skipped }, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
