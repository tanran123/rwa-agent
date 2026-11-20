import { query } from "./db.js";
import { resolveVersionRef } from "./ruleVersion.js";
import { assertRevision, assertVersionWritable, recordRevision } from "./configAudit.js";
import { clearExposureCache } from "./exposureCache.js";

const PARAM_SQL = "SELECT * FROM rule_parameter_table";
const LIST_SQL = "SELECT * FROM rule_list";

function documentOf(value) {
  if (value == null) return null;
  if (typeof value === "string") {
    try { return JSON.parse(value); } catch { return value; }
  }
  return value;
}

function bad(message) {
  const err = new Error(message);
  err.status = 400;
  throw err;
}

function stamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
}

export function parameterTableBody(row) {
  return {
    id: row.id,
    jurisdiction: row.jurisdiction,
    tableId: row.table_id,
    version: row.table_version,
    title: row.title,
    purpose: row.purpose,
    columns: documentOf(row.columns_json) || [],
    rows: documentOf(row.rows_json) || [],
    note: row.note,
    revision: Number(row.revision) || 1,
    ruleVersionId: row.rule_version_id || "",
    updatedAt: row.updated_at
  };
}

export function referenceListBody(row) {
  return {
    id: row.id,
    jurisdiction: row.jurisdiction,
    listId: row.list_id,
    version: row.list_version,
    title: row.title,
    listType: row.list_type,
    columns: documentOf(row.columns_json) || [],
    rows: documentOf(row.rows_json) || [],
    note: row.note,
    revision: Number(row.revision) || 1,
    ruleVersionId: row.rule_version_id || "",
    updatedAt: row.updated_at
  };
}

export async function parameterTables(jurisdiction, version = "") {
  const versionId = version ? await resolveVersionRef(version, jurisdiction) : "";
  const rows = await query(
    versionId
      ? PARAM_SQL + " WHERE (jurisdiction = ? OR ? = '') AND (rule_version_id = ? OR rule_version_id = '') ORDER BY table_id, table_version"
      : PARAM_SQL + " WHERE (? = '' OR jurisdiction = ?) ORDER BY table_id, table_version",
    versionId ? [jurisdiction || "", jurisdiction || "", versionId] : [jurisdiction || "", jurisdiction || ""]
  );
  const chosen = new Map();
  rows.forEach((row) => {
    const key = row.table_id + "|" + row.table_version;
    const current = chosen.get(key);
    if (!current || (!current.rule_version_id && row.rule_version_id)) chosen.set(key, row);
  });
  return Array.from(chosen.values()).map((row) => ({
    id: row.id,
    jurisdiction: row.jurisdiction,
    tableId: row.table_id,
    version: row.table_version,
    title: row.title,
    purpose: row.purpose,
    rowCount: (documentOf(row.rows_json) || []).length,
    ruleVersionId: row.rule_version_id || "",
    updatedAt: row.updated_at
  }));
}

export async function parameterTable(id) {
  const rows = await query(PARAM_SQL + " WHERE id = ?", [id]);
  return rows[0] ? parameterTableBody(rows[0]) : null;
}

export async function saveParameterTable(id, body, actor = "") {
  const rows = await query(PARAM_SQL + " WHERE id = ?", [id]);
  if (!rows[0]) bad("没有这张参数表");
  assertRevision(rows[0].revision, body.baseRevision, "参数表「" + rows[0].title + "」");
  await assertVersionWritable(rows[0].rule_version_id);
  if (!Array.isArray(body.columns) || !body.columns.length) bad("参数表至少需要一列");
  if (!Array.isArray(body.rows)) bad("rows 必须是数组");
  const width = body.columns.length;
  body.rows.forEach((row, index) => {
    if (!Array.isArray(row) || row.length !== width) bad("第 " + (index + 1) + " 行列数与表头不一致");
  });
  await query(
    "UPDATE rule_parameter_table SET columns_json = ?, rows_json = ?, title = ?, purpose = ?, note = ?, revision = revision + 1, updated_at = ? WHERE id = ?",
    [
      JSON.stringify(body.columns),
      JSON.stringify(body.rows),
      String(body.title || rows[0].title),
      String(body.purpose || rows[0].purpose),
      String(body.note == null ? rows[0].note : body.note),
      stamp(),
      id
    ]
  );
  clearExposureCache(rows[0].rule_version_id || "");
  await recordRevision({
    ruleVersionId: rows[0].rule_version_id || "", objectType: "rule_parameter_table",
    objectKey: rows[0].table_id + "|" + rows[0].table_version, action: "UPDATE",
    before: { title: rows[0].title, rows: (documentOf(rows[0].rows_json) || []).length },
    after: { title: String(body.title || rows[0].title), rows: body.rows.length }, actor
  });
  return parameterTable(id);
}

export async function referenceLists(jurisdiction, version = "") {
  const versionId = version ? await resolveVersionRef(version, jurisdiction) : "";
  const rows = await query(
    versionId
      ? LIST_SQL + " WHERE (jurisdiction = ? OR ? = '') AND (rule_version_id = ? OR rule_version_id = '') ORDER BY list_id, list_version"
      : LIST_SQL + " WHERE (? = '' OR jurisdiction = ?) ORDER BY list_id, list_version",
    versionId ? [jurisdiction || "", jurisdiction || "", versionId] : [jurisdiction || "", jurisdiction || ""]
  );
  const chosen = new Map();
  rows.forEach((row) => {
    const key = row.list_id + "|" + row.list_version;
    const current = chosen.get(key);
    if (!current || (!current.rule_version_id && row.rule_version_id)) chosen.set(key, row);
  });
  return Array.from(chosen.values()).map((row) => ({
    id: row.id,
    jurisdiction: row.jurisdiction,
    listId: row.list_id,
    version: row.list_version,
    title: row.title,
    listType: row.list_type,
    rowCount: (documentOf(row.rows_json) || []).length,
    ruleVersionId: row.rule_version_id || "",
    updatedAt: row.updated_at
  }));
}

export async function referenceList(id) {
  const rows = await query(LIST_SQL + " WHERE id = ?", [id]);
  return rows[0] ? referenceListBody(rows[0]) : null;
}

export async function saveReferenceList(id, body, actor = "") {
  const rows = await query(LIST_SQL + " WHERE id = ?", [id]);
  if (!rows[0]) bad("没有这份名单");
  assertRevision(rows[0].revision, body.baseRevision, "监管名单「" + rows[0].title + "」");
  await assertVersionWritable(rows[0].rule_version_id);
  if (!Array.isArray(body.columns) || !body.columns.length) bad("名单至少需要一列");
  if (!Array.isArray(body.rows)) bad("rows 必须是数组");
  const width = body.columns.length;
  body.rows.forEach((row, index) => {
    if (!Array.isArray(row) || row.length !== width) bad("第 " + (index + 1) + " 行列数与表头不一致");
  });
  await query(
    "UPDATE rule_list SET columns_json = ?, rows_json = ?, title = ?, list_type = ?, note = ?, revision = revision + 1, updated_at = ? WHERE id = ?",
    [
      JSON.stringify(body.columns),
      JSON.stringify(body.rows),
      String(body.title || rows[0].title),
      String(body.listType || rows[0].list_type),
      String(body.note == null ? rows[0].note : body.note),
      stamp(),
      id
    ]
  );
  clearExposureCache(rows[0].rule_version_id || "");
  await recordRevision({
    ruleVersionId: rows[0].rule_version_id || "", objectType: "rule_list",
    objectKey: rows[0].list_id + "|" + rows[0].list_version, action: "UPDATE",
    before: { title: rows[0].title, rows: (documentOf(rows[0].rows_json) || []).length },
    after: { title: String(body.title || rows[0].title), rows: body.rows.length }, actor
  });
  return referenceList(id);
}

/** 把一批参数表写入库，按 (rule_version_id, table_id, table_version) 覆盖。 */
export async function upsertParameterTable(item) {
  const ruleVersionId = String(item.ruleVersionId || "");
  const id = [item.jurisdiction, ruleVersionId || "legacy", item.tableId, item.version].join("-");
  await query(
    `INSERT INTO rule_parameter_table
       (id, jurisdiction, table_id, table_version, title, purpose, columns_json, rows_json, note, updated_at, rule_version_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       title = VALUES(title), purpose = VALUES(purpose), columns_json = VALUES(columns_json),
       rows_json = VALUES(rows_json), note = VALUES(note), revision = revision + 1, updated_at = VALUES(updated_at)`,
    [
      id,
      item.jurisdiction,
      item.tableId,
      item.version,
      item.title,
      item.purpose || "regulatory_parameter",
      JSON.stringify(item.columns || []),
      JSON.stringify(item.rows || []),
      item.note || "",
      stamp(),
      ruleVersionId
    ]
  );
  if (item.actor) {
    await recordRevision({
      ruleVersionId, objectType: "rule_parameter_table", objectKey: item.tableId + "|" + item.version,
      action: "IMPORT", after: { title: item.title, rows: (item.rows || []).length }, actor: item.actor
    });
  }
  return id;
}

/** 把一批名单写入库，按 (rule_version_id, list_id, list_version) 覆盖。 */
export async function upsertReferenceList(item) {
  const ruleVersionId = String(item.ruleVersionId || "");
  const id = [item.jurisdiction, ruleVersionId || "legacy", item.listId, item.version].join("-");
  await query(
    `INSERT INTO rule_list
       (id, jurisdiction, list_id, list_version, title, list_type, columns_json, rows_json, note, updated_at, rule_version_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       title = VALUES(title), list_type = VALUES(list_type), columns_json = VALUES(columns_json),
       rows_json = VALUES(rows_json), note = VALUES(note), revision = revision + 1, updated_at = VALUES(updated_at)`,
    [
      id,
      item.jurisdiction,
      item.listId,
      item.version,
      item.title,
      item.listType || "positive",
      JSON.stringify(item.columns || []),
      JSON.stringify(item.rows || []),
      item.note || "",
      stamp(),
      ruleVersionId
    ]
  );
  if (item.actor) {
    await recordRevision({
      ruleVersionId, objectType: "rule_list", objectKey: item.listId + "|" + item.version,
      action: "IMPORT", after: { title: item.title, rows: (item.rows || []).length }, actor: item.actor
    });
  }
  return id;
}

/** 当前地区已入库的参数表 / 名单标识，供规则集交叉引用校验。 */
export async function declaredRefs(jurisdiction, version = "") {
  const versionId = version ? await resolveVersionRef(version, jurisdiction) : "";
  const [tables, lists] = await Promise.all([
    query(
      versionId
        ? "SELECT DISTINCT table_id FROM rule_parameter_table WHERE (jurisdiction = ? OR ? = '') AND (rule_version_id = ? OR rule_version_id = '')"
        : "SELECT DISTINCT table_id FROM rule_parameter_table WHERE jurisdiction = ?",
      versionId ? [jurisdiction, jurisdiction, versionId] : [jurisdiction]
    ),
    query(
      versionId
        ? "SELECT DISTINCT list_id FROM rule_list WHERE (jurisdiction = ? OR ? = '') AND (rule_version_id = ? OR rule_version_id = '')"
        : "SELECT DISTINCT list_id FROM rule_list WHERE jurisdiction = ?",
      versionId ? [jurisdiction, jurisdiction, versionId] : [jurisdiction]
    )
  ]);
  return {
    tables: tables.map((row) => row.table_id),
    lists: lists.map((row) => row.list_id)
  };
}
