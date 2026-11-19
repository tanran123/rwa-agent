import { query } from "./db.js";

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
    updatedAt: row.updated_at
  };
}

export async function parameterTables(jurisdiction) {
  const rows = await query(
    PARAM_SQL + " WHERE (? = '' OR jurisdiction = ?) ORDER BY table_id, table_version",
    [jurisdiction || "", jurisdiction || ""]
  );
  return rows.map((row) => ({
    id: row.id,
    jurisdiction: row.jurisdiction,
    tableId: row.table_id,
    version: row.table_version,
    title: row.title,
    purpose: row.purpose,
    rowCount: (documentOf(row.rows_json) || []).length,
    updatedAt: row.updated_at
  }));
}

export async function parameterTable(id) {
  const rows = await query(PARAM_SQL + " WHERE id = ?", [id]);
  return rows[0] ? parameterTableBody(rows[0]) : null;
}

export async function saveParameterTable(id, body) {
  const rows = await query(PARAM_SQL + " WHERE id = ?", [id]);
  if (!rows[0]) bad("没有这张参数表");
  if (!Array.isArray(body.columns) || !body.columns.length) bad("参数表至少需要一列");
  if (!Array.isArray(body.rows)) bad("rows 必须是数组");
  const width = body.columns.length;
  body.rows.forEach((row, index) => {
    if (!Array.isArray(row) || row.length !== width) bad("第 " + (index + 1) + " 行列数与表头不一致");
  });
  await query(
    "UPDATE rule_parameter_table SET columns_json = ?, rows_json = ?, title = ?, purpose = ?, note = ?, updated_at = ? WHERE id = ?",
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
  return parameterTable(id);
}

export async function referenceLists(jurisdiction) {
  const rows = await query(
    LIST_SQL + " WHERE (? = '' OR jurisdiction = ?) ORDER BY list_id, list_version",
    [jurisdiction || "", jurisdiction || ""]
  );
  return rows.map((row) => ({
    id: row.id,
    jurisdiction: row.jurisdiction,
    listId: row.list_id,
    version: row.list_version,
    title: row.title,
    listType: row.list_type,
    rowCount: (documentOf(row.rows_json) || []).length,
    updatedAt: row.updated_at
  }));
}

export async function referenceList(id) {
  const rows = await query(LIST_SQL + " WHERE id = ?", [id]);
  return rows[0] ? referenceListBody(rows[0]) : null;
}

export async function saveReferenceList(id, body) {
  const rows = await query(LIST_SQL + " WHERE id = ?", [id]);
  if (!rows[0]) bad("没有这份名单");
  if (!Array.isArray(body.columns) || !body.columns.length) bad("名单至少需要一列");
  if (!Array.isArray(body.rows)) bad("rows 必须是数组");
  const width = body.columns.length;
  body.rows.forEach((row, index) => {
    if (!Array.isArray(row) || row.length !== width) bad("第 " + (index + 1) + " 行列数与表头不一致");
  });
  await query(
    "UPDATE rule_list SET columns_json = ?, rows_json = ?, title = ?, list_type = ?, note = ?, updated_at = ? WHERE id = ?",
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
  return referenceList(id);
}

/** 把一批参数表写入库，按 (jurisdiction, table_id, table_version) 覆盖。 */
export async function upsertParameterTable(item) {
  const id = [item.jurisdiction, item.tableId, item.version].join("-");
  await query(
    `INSERT INTO rule_parameter_table
       (id, jurisdiction, table_id, table_version, title, purpose, columns_json, rows_json, note, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       title = VALUES(title), purpose = VALUES(purpose), columns_json = VALUES(columns_json),
       rows_json = VALUES(rows_json), note = VALUES(note), updated_at = VALUES(updated_at)`,
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
      stamp()
    ]
  );
  return id;
}

/** 把一批名单写入库，按 (jurisdiction, list_id, list_version) 覆盖。 */
export async function upsertReferenceList(item) {
  const id = [item.jurisdiction, item.listId, item.version].join("-");
  await query(
    `INSERT INTO rule_list
       (id, jurisdiction, list_id, list_version, title, list_type, columns_json, rows_json, note, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       title = VALUES(title), list_type = VALUES(list_type), columns_json = VALUES(columns_json),
       rows_json = VALUES(rows_json), note = VALUES(note), updated_at = VALUES(updated_at)`,
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
      stamp()
    ]
  );
  return id;
}

/** 当前地区已入库的参数表 / 名单标识，供规则集交叉引用校验。 */
export async function declaredRefs(jurisdiction) {
  const [tables, lists] = await Promise.all([
    query("SELECT DISTINCT table_id FROM rule_parameter_table WHERE jurisdiction = ?", [jurisdiction]),
    query("SELECT DISTINCT list_id FROM rule_list WHERE jurisdiction = ?", [jurisdiction])
  ]);
  return {
    tables: tables.map((row) => row.table_id),
    lists: lists.map((row) => row.list_id)
  };
}
