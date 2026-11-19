/**
 * 流动性 HQLA：计算任务的持久化（MySQL）与转发。
 *
 * 判定/抽样/加总/对账/导出都在 Flask 的 agent/core/hqla/ 里；
 * 这里只负责存任务、读任务，以及把 compute / parse / export 转发给 8766。
 */

import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pool, query } from "./db.js";
import { lcrInput, autoMapDataset, identifyDatasets, listLiquidityProducts, qualityDataset } from "./liquidity.js";

const FLASK = "http://127.0.0.1:8766";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(import.meta.url);
const LIST_CODES = ["trading_book", "encumbered", "related_party", "own_issue", "policy_bank", "structured_sub", "rmbs_approval"];

function pad(value) {
  return String(value).padStart(2, "0");
}

function nowText() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function uid() {
  return "T" + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase();
}

function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function parseJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === "string") {
    try { return JSON.parse(value); } catch { return fallback; }
  }
  return value;
}

function dateText(value) {
  if (!value) return null;
  if (value instanceof Date) return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  return String(value).slice(0, 10);
}

function numOrNull(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------- 行 → 对象

function taskOut(row) {
  return {
    id: row.id,
    name: row.name,
    institution: row.institution,
    baseDate: dateText(row.base_date),
    status: row.status,
    step: Number(row.step) || 1,
    cfg: parseJson(row.config, {}),
    sample: parseJson(row.sample, null),
    fetchLog: parseJson(row.fetch_log, []),
    summary: parseJson(row.summary, null),
    inputMeta: parseJson(row.input_meta, null),
    refMeta: parseJson(row.ref_meta, null),
    fetchSig: row.fetch_sig || null,
    frozenAt: row.frozen_at || null,
    frozenSig: row.frozen_sig || null,
    runAt: row.run_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function inputOut(row) {
  return {
    lineNo: Number(row.line_no),
    itemRaw: row.item_raw || "",
    item: row.item || "",
    secId: row.sec_id || "",
    key: row.sec_key || "",
    ccyGroupRaw: row.ccy_group_raw || "",
    amount: row.amount == null ? null : Number(row.amount),
  };
}

function listOut(row) {
  return {
    secId: row.sec_id || "",
    isin: row.isin || "",
    issuer: row.issuer || "",
    name: row.name || "",
    amount: row.amount == null ? null : Number(row.amount),
    ltv: row.ltv == null ? null : Number(row.ltv),
    decline: row.decline == null ? null : Number(row.decline),
    approved: row.approved || "",
    note: row.note || "",
  };
}

function reportedOut(row) {
  return {
    level: row.level,
    clause: row.clause || "",
    principalThousand: Number(row.principal_thousand) || 0,
    weightedThousand: Number(row.weighted_thousand) || 0,
    byCcy: parseJson(row.by_ccy, {}),
  };
}

function datasetOut(row) {
  return {
    id: row.dataset_id,
    sheet: row.sheet_name || "",
    productCode: row.product_code || "",
    productName: row.product_name || "",
    confidence: row.confidence == null ? null : Number(row.confidence),
    level: row.confirm_level || "",
    confirmedAt: row.confirmed_at || "",
    headers: parseJson(row.headers_json, []),
    rows: parseJson(row.rows_json, []),
    mapping: parseJson(row.mapping_json, {}),
    mappingMeta: parseJson(row.mapping_meta_json, null),
    quality: parseJson(row.quality_json, null),
    sort: Number(row.sort_order) || 0,
  };
}

function referenceOut(row) {
  return {
    id: row.id,
    isin: row.isin || "",
    name: row.name || "",
    issuer: row.issuer || "",
    ind: row.ind || "",
    itype: row.itype == null ? null : Number(row.itype),
    ccy: row.ccy || "",
    mat: row.mat || null,
    cp: row.cp == null ? null : Number(row.cp),
    listed: row.listed || "",
    acct: row.acct || "",
    rating: row.rating || "",
    book: row.book == null ? null : Number(row.book),
    mv: row.mv == null ? null : Number(row.mv),
    acc: row.acc == null ? null : Number(row.acc),
    ecl: row.ecl == null ? null : Number(row.ecl),
    rw: row.rw == null ? null : Number(row.rw),
    p30: row.p30 == null ? null : Number(row.p30),
    kind: row.kind || "",
    sub: row.sub || "",
    region: row.region || "",
  };
}

// ---------------------------------------------------------------- 读取

async function taskRow(id) {
  const rows = await query("SELECT * FROM hqla_task WHERE id = ?", [id]);
  if (!rows.length) throw fail(404, "任务不存在");
  return rows[0];
}

export async function listTasks() {
  const rows = await query("SELECT * FROM hqla_task ORDER BY updated_at DESC");
  const out = [];
  for (const row of rows) {
    const task = taskOut(row);
    const [stats] = await query(
      `SELECT
         (SELECT COUNT(*) FROM hqla_task_input WHERE task_id = ?) AS inputCount,
         (SELECT COUNT(*) FROM hqla_task_list WHERE task_id = ?) AS listCount,
         (SELECT COUNT(*) FROM hqla_task_dataset WHERE task_id = ?) AS datasetCount,
         (SELECT COUNT(*) FROM hqla_task_dataset WHERE task_id = ? AND product_code <> '') AS productCount,
         (SELECT COUNT(*) FROM hqla_task_dataset WHERE task_id = ? AND mapping_json IS NOT NULL AND JSON_LENGTH(mapping_json) > 0) AS mappedCount,
         (SELECT COUNT(*) FROM hqla_task_dataset WHERE task_id = ? AND quality_json IS NOT NULL) AS qualityCount`,
      [row.id, row.id, row.id, row.id, row.id, row.id]
    );
    task.inputCount = Number(stats.inputCount) || 0;
    task.listCount = Number(stats.listCount) || 0;
    task.datasetCount = Number(stats.datasetCount) || 0;
    task.productCount = Number(stats.productCount) || 0;
    task.mappedCount = Number(stats.mappedCount) || 0;
    task.qualityCount = Number(stats.qualityCount) || 0;
    out.push(task);
  }
  return out;
}

export async function getTask(id) {
  const row = await taskRow(id);
  const task = taskOut(row);
  const [input, lists, reported, datasets] = await Promise.all([
    query("SELECT * FROM hqla_task_input WHERE task_id = ? ORDER BY line_no", [id]),
    query("SELECT * FROM hqla_task_list WHERE task_id = ? ORDER BY id", [id]),
    query("SELECT * FROM hqla_task_reported WHERE task_id = ? ORDER BY id", [id]),
    query("SELECT * FROM hqla_task_dataset WHERE task_id = ? ORDER BY sort_order, id", [id]),
  ]);
  task.input = { rows: input.map(inputOut), meta: task.inputMeta };
  task.datasets = datasets.map(datasetOut);
  task.lists = {};
  for (const list of lists) {
    if (!task.lists[list.list_code]) task.lists[list.list_code] = { rows: [], meta: { name: list.list_code, count: 0 } };
    task.lists[list.list_code].rows.push(listOut(list));
  }
  for (const code of Object.keys(task.lists)) task.lists[code].meta.count = task.lists[code].rows.length;
  task.reported = reported.map(reportedOut);
  return task;
}

export async function listMeta() {
  const response = await fetch(FLASK + "/api/hqla/list-meta");
  return response.json();
}

export async function referenceRows() {
  const rows = await query("SELECT * FROM hqla_reference ORDER BY id");
  return rows.map(referenceOut);
}

export async function upsertReference(rows) {
  const list = Array.isArray(rows) ? rows : [];
  for (const row of list) {
    const id = String(row.id || row.secId || row.isin || "").trim();
    if (!id) continue;
    await query(
      `INSERT INTO hqla_reference
         (id, isin, name, issuer, ind, itype, ccy, mat, cp, listed, acct, rating, book, mv, acc, ecl, rw, p30, kind, sub, region)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         name = VALUES(name), issuer = VALUES(issuer), rating = VALUES(rating),
         rw = VALUES(rw), p30 = VALUES(p30), mat = VALUES(mat), ccy = VALUES(ccy)`,
      [
        id, String(row.isin || "").slice(0, 32), String(row.name || "").slice(0, 200),
        String(row.issuer || "").slice(0, 200), String(row.ind || "").slice(0, 8),
        row.itype == null ? null : Number(row.itype), String(row.ccy || "").slice(0, 8),
        row.mat == null ? null : String(row.mat).slice(0, 16), row.cp == null ? null : Number(row.cp),
        String(row.listed || "").slice(0, 8), String(row.acct || "").slice(0, 64), String(row.rating || "").slice(0, 32),
        row.book == null ? null : Number(row.book), row.mv == null ? null : Number(row.mv),
        row.acc == null ? null : Number(row.acc), row.ecl == null ? null : Number(row.ecl),
        row.rw == null ? null : Number(row.rw), row.p30 == null ? null : Number(row.p30),
        String(row.kind || "").slice(0, 16), String(row.sub || "").slice(0, 8), String(row.region || "").slice(0, 16),
      ]
    );
  }
  return { ok: true, count: list.length };
}

// ---------------------------------------------------------------- 写入

export async function createTask(body) {
  const id = uid();
  const now = nowText();
  const name = String(body.name || "HQLA 判定任务").trim().slice(0, 200);
  const baseDate = dateText(body.baseDate) || "2025-12-31";
  const institution = String(body.institution || "总行（法人）").slice(0, 64);
  let cfg = body.cfg || null;
  if (body.copyFrom) {
    const source = await taskRow(body.copyFrom);
    cfg = parseJson(source.config, null);
    if (cfg) cfg.baseDate = baseDate;
  }
  await query(
    `INSERT INTO hqla_task
       (id, name, institution, base_date, status, step, config, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'draft', 1, ?, ?, ?)`,
    [id, name, institution, baseDate, cfg ? JSON.stringify(cfg) : null, now, now]
  );
  return getTask(id);
}

export async function updateTask(id, body) {
  const row = await taskRow(id);
  const fields = [];
  const params = [];
  const set = (column, value) => { fields.push(`${column} = ?`); params.push(value); };
  if (body.name !== undefined) set("name", String(body.name).slice(0, 200));
  if (body.institution !== undefined) set("institution", String(body.institution).slice(0, 64));
  if (body.baseDate !== undefined) set("base_date", dateText(body.baseDate));
  if (body.status !== undefined) set("status", String(body.status).slice(0, 16));
  if (body.step !== undefined) set("step", Number(body.step) || 1);
  if (body.config !== undefined) set("config", body.config ? JSON.stringify(body.config) : null);
  if (body.sample !== undefined) set("sample", body.sample ? JSON.stringify(body.sample) : null);
  if (body.fetchLog !== undefined) set("fetch_log", body.fetchLog ? JSON.stringify(body.fetchLog) : null);
  if (body.summary !== undefined) set("summary", body.summary ? JSON.stringify(body.summary) : null);
  if (body.inputMeta !== undefined) set("input_meta", body.inputMeta ? JSON.stringify(body.inputMeta) : null);
  if (body.refMeta !== undefined) set("ref_meta", body.refMeta ? JSON.stringify(body.refMeta) : null);
  if (body.fetchSig !== undefined) set("fetch_sig", body.fetchSig || null);
  if (body.frozenAt !== undefined) set("frozen_at", body.frozenAt || null);
  if (body.frozenSig !== undefined) set("frozen_sig", body.frozenSig || null);
  if (body.runAt !== undefined) set("run_at", body.runAt || null);
  set("updated_at", nowText());
  params.push(row.id);
  await query(`UPDATE hqla_task SET ${fields.join(", ")} WHERE id = ?`, params);
  return getTask(id);
}

export async function deleteTask(id) {
  await taskRow(id);
  await query("DELETE FROM hqla_task_input WHERE task_id = ?", [id]);
  await query("DELETE FROM hqla_task_list WHERE task_id = ?", [id]);
  await query("DELETE FROM hqla_task_reported WHERE task_id = ?", [id]);
  await query("DELETE FROM hqla_task_dataset WHERE task_id = ?", [id]);
  await query("DELETE FROM hqla_task WHERE id = ?", [id]);
  return { ok: true };
}

export async function duplicateTask(id) {
  const task = await getTask(id);
  const copy = await createTask({ name: `${task.name}（副本）`, baseDate: task.baseDate, institution: task.institution });
  await query("UPDATE hqla_task SET status = 'doing', config = ?, step = ? WHERE id = ?", [JSON.stringify(task.cfg || {}), task.step || 1, copy.id]);
  if (task.input && task.input.rows && task.input.rows.length) {
    await saveInput(copy.id, { rows: task.input.rows, meta: task.input.meta });
  }
  if (task.datasets && task.datasets.length) {
    await saveDatasets(copy.id, { datasets: task.datasets });
  }
  for (const code of Object.keys(task.lists || {})) {
    await saveList(copy.id, code, { rows: task.lists[code].rows });
  }
  if (task.reported && task.reported.length) await saveReported(copy.id, { rows: task.reported });
  return getTask(copy.id);
}

export async function archiveTask(id, archived) {
  await taskRow(id);
  await query("UPDATE hqla_task SET status = ?, updated_at = ? WHERE id = ?", [archived ? "archived" : "doing", nowText(), id]);
  return getTask(id);
}

export async function exportTask(id) {
  const task = await getTask(id);
  return { kind: "hqla-task", version: 1, exportedAt: nowText(), task };
}

export async function importTask(body) {
  const doc = body && body.kind === "hqla-task" ? body : null;
  if (!doc || !doc.task) throw fail(400, "不是有效的 HQLA 任务归档文件");
  const source = doc.task;
  const created = await createTask({ name: source.name, baseDate: source.baseDate, institution: source.institution });
  await query("UPDATE hqla_task SET status = 'doing', step = ?, config = ?, sample = ?, fetch_log = ?, summary = ? WHERE id = ?", [
    Number(source.step) || 1,
    source.cfg ? JSON.stringify(source.cfg) : null,
    source.sample ? JSON.stringify(source.sample) : null,
    source.fetchLog ? JSON.stringify(source.fetchLog) : null,
    source.summary ? JSON.stringify(source.summary) : null,
    created.id,
  ]);
  if (source.input && source.input.rows) await saveInput(created.id, source.input);
  if (source.datasets && source.datasets.length) await saveDatasets(created.id, { datasets: source.datasets });
  for (const code of Object.keys(source.lists || {})) {
    const entry = source.lists[code];
    if (entry && entry.rows && entry.rows.length) await saveList(created.id, code, entry);
  }
  if (source.reported && source.reported.length) await saveReported(created.id, { rows: source.reported });
  return getTask(created.id);
}

export async function saveInput(id, body) {
  await taskRow(id);
  const rows = Array.isArray(body.rows) ? body.rows : [];
  await query("DELETE FROM hqla_task_input WHERE task_id = ?", [id]);
  if (rows.length) {
    const values = [];
    const params = [];
    rows.forEach((row, index) => {
      values.push("(?, ?, ?, ?, ?, ?, ?, ?)");
      params.push(
        id,
        Number(row.lineNo) || index + 1,
        String(row.itemRaw || "").slice(0, 64),
        String(row.item || "").slice(0, 8),
        String(row.secId || "").slice(0, 128),
        String(row.key || "").slice(0, 128),
        String(row.ccyGroupRaw || "").slice(0, 32),
        numOrNull(row.amount)
      );
    });
    await query(
      `INSERT INTO hqla_task_input
         (task_id, line_no, item_raw, item, sec_id, sec_key, ccy_group_raw, amount)
       VALUES ${values.join(", ")}`,
      params
    );
  }
  await query("UPDATE hqla_task SET input_meta = ?, sample = NULL, fetch_log = NULL, fetch_sig = NULL, step = 1, updated_at = ? WHERE id = ?", [
    body.meta ? JSON.stringify(body.meta) : JSON.stringify({ count: rows.length }),
    nowText(),
    id,
  ]);
  return getTask(id);
}

export async function saveDatasets(id, body) {
  await taskRow(id);
  const datasets = Array.isArray(body.datasets) ? body.datasets : [];
  await query("DELETE FROM hqla_task_dataset WHERE task_id = ?", [id]);
  let order = 0;
  for (const dataset of datasets) {
    order += 1;
    const datasetId = String(dataset.id || "DS" + order).slice(0, 64);
    await query(
      `INSERT INTO hqla_task_dataset
         (task_id, dataset_id, sheet_name, product_code, product_name, confidence, confirm_level,
          confirmed_at, headers_json, rows_json, mapping_json, mapping_meta_json, quality_json, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, datasetId, String(dataset.sheet || "").slice(0, 128),
        String(dataset.productCode || "").slice(0, 64), String(dataset.productName || "").slice(0, 128),
        dataset.confidence == null ? null : Number(dataset.confidence), String(dataset.level || "").slice(0, 16),
        String(dataset.confirmedAt || "").slice(0, 32),
        JSON.stringify(dataset.headers || []), JSON.stringify(dataset.rows || []),
        JSON.stringify(dataset.mapping || {}),
        dataset.mappingMeta ? JSON.stringify(dataset.mappingMeta) : null,
        dataset.quality ? JSON.stringify(dataset.quality) : null,
        order
      ]
    );
  }
  await query("UPDATE hqla_task SET updated_at = ? WHERE id = ?", [nowText(), id]);
  return getTask(id);
}

export async function saveDatasetMeta(id, datasetId, patch = {}) {
  await taskRow(id);
  const rows = await query("SELECT * FROM hqla_task_dataset WHERE task_id = ? AND dataset_id = ?", [id, datasetId]);
  if (!rows.length) throw fail(404, "数据集不存在");
  const current = datasetOut(rows[0]);
  const next = { ...current, ...patch, id: current.id };
  await query(
    `UPDATE hqla_task_dataset
        SET product_code = ?, product_name = ?, confidence = ?, confirm_level = ?, confirmed_at = ?,
            headers_json = ?, mapping_json = ?, mapping_meta_json = ?, quality_json = ?
      WHERE task_id = ? AND dataset_id = ?`,
    [
      String(next.productCode || "").slice(0, 64), String(next.productName || "").slice(0, 128),
      next.confidence == null ? null : Number(next.confidence), String(next.level || "").slice(0, 16),
      String(next.confirmedAt || "").slice(0, 32),
      JSON.stringify(next.headers || []), JSON.stringify(next.mapping || {}),
      next.mappingMeta ? JSON.stringify(next.mappingMeta) : null,
      next.quality ? JSON.stringify(next.quality) : null,
      id, datasetId
    ]
  );
  await query("UPDATE hqla_task SET updated_at = ? WHERE id = ?", [nowText(), id]);
  return getTask(id);
}

export async function deleteDataset(id, datasetId) {
  await query("DELETE FROM hqla_task_dataset WHERE task_id = ? AND dataset_id = ?", [id, datasetId]);
  await query("UPDATE hqla_task SET updated_at = ? WHERE id = ?", [nowText(), id]);
  return getTask(id);
}

async function configuredProducts(task) {
  const cfg = task.cfg || {};
  if (!cfg.ruleVersion) throw fail(400, "请先在第一步选择监管规则版本");
  const catalogue = await listLiquidityProducts({
    jurisdiction: cfg.jurisdiction || "HK",
    version: cfg.ruleVersion,
  });
  if (!catalogue.products.length) throw fail(400, "这一版还没有流动性产品配置");
  return catalogue.products;
}

export async function identifyTaskDatasets(id) {
  const task = await getTask(id);
  if (!task.datasets.length) throw fail(400, "还没有导入数据");
  const products = await configuredProducts(task);
  const identified = identifyDatasets(task.datasets, products);
  for (const dataset of identified) {
    const product = products.find((item) => item.code === dataset.productCode);
    await saveDatasetMeta(id, dataset.id, {
      productCode: dataset.productCode,
      productName: product ? product.name : dataset.productName,
      confidence: dataset.confidence,
      level: dataset.level,
      confirmedAt: dataset.confirmedAt || "",
    });
  }
  return { datasets: identified };
}

export async function mapTaskDatasets(id) {
  const task = await getTask(id);
  if (!task.datasets.length) throw fail(400, "还没有导入数据");
  const products = await configuredProducts(task);
  for (const dataset of task.datasets) {
    const product = products.find((item) => item.code === dataset.productCode);
    if (!product) continue;
    const mapping = autoMapDataset(dataset, product);
    const plain = {};
    mapping.mappings.forEach((item) => {
      if (item.standard) plain[item.standard] = item.excel;
    });
    await saveDatasetMeta(id, dataset.id, {
      mapping: plain,
      mappingMeta: mapping,
      quality: null,
    });
  }
  return getTask(id);
}

export async function qualityTaskDatasets(id) {
  const task = await getTask(id);
  if (!task.datasets.length) throw fail(400, "还没有导入数据");
  const products = await configuredProducts(task);
  for (const dataset of task.datasets) {
    const product = products.find((item) => item.code === dataset.productCode);
    if (!product) continue;
    const quality = qualityDataset(dataset, product);
    await saveDatasetMeta(id, dataset.id, { quality });
  }
  return getTask(id);
}

export async function saveList(id, code, body) {
  if (!LIST_CODES.includes(code)) throw fail(400, "未知的清单类型");
  await taskRow(id);
  const rows = Array.isArray(body.rows) ? body.rows : [];
  await query("DELETE FROM hqla_task_list WHERE task_id = ? AND list_code = ?", [id, code]);
  if (rows.length) {
    const values = [];
    const params = [];
    rows.forEach((row) => {
      values.push("(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
      params.push(
        id, code,
        String(row.secId || "").slice(0, 128),
        String(row.isin || "").slice(0, 32),
        String(row.issuer || "").slice(0, 200),
        String(row.name || "").slice(0, 200),
        numOrNull(row.amount), numOrNull(row.ltv), numOrNull(row.decline),
        String(row.approved || "").slice(0, 8),
        String(row.note || "").slice(0, 255)
      );
    });
    await query(
      `INSERT INTO hqla_task_list
         (task_id, list_code, sec_id, isin, issuer, name, amount, ltv, decline, approved, note)
       VALUES ${values.join(", ")}`,
      params
    );
  }
  await query("UPDATE hqla_task SET updated_at = ? WHERE id = ?", [nowText(), id]);
  return getTask(id);
}

export async function deleteList(id, code) {
  await query("DELETE FROM hqla_task_list WHERE task_id = ? AND list_code = ?", [id, code]);
  await query("UPDATE hqla_task SET updated_at = ? WHERE id = ?", [nowText(), id]);
  return getTask(id);
}

export async function saveReported(id, body) {
  await taskRow(id);
  const rows = Array.isArray(body.rows) ? body.rows : [];
  await query("DELETE FROM hqla_task_reported WHERE task_id = ?", [id]);
  if (rows.length) {
    const values = [];
    const params = [];
    rows.forEach((row) => {
      values.push("(?, ?, ?, ?, ?, ?)");
      params.push(
        id,
        String(row.level || "").slice(0, 16),
        String(row.clause || "").slice(0, 16),
        numOrNull(row.principalThousand) || 0,
        numOrNull(row.weightedThousand) || 0,
        row.byCcy ? JSON.stringify(row.byCcy) : null
      );
    });
    await query(
      `INSERT INTO hqla_task_reported
         (task_id, level, clause, principal_thousand, weighted_thousand, by_ccy)
       VALUES ${values.join(", ")}`,
      params
    );
  }
  await query("UPDATE hqla_task SET updated_at = ? WHERE id = ?", [nowText(), id]);
  return getTask(id);
}

export async function saveSimple(id, body, columns) {
  await taskRow(id);
  const fields = [];
  const params = [];
  for (const [key, column] of Object.entries(columns)) {
    if (body[key] === undefined) continue;
    fields.push(`${column} = ?`);
    const value = body[key];
    params.push(value !== null && typeof value === "object" ? JSON.stringify(value) : value);
  }
  fields.push("updated_at = ?");
  params.push(nowText(), id);
  await query(`UPDATE hqla_task SET ${fields.join(", ")} WHERE id = ?`, params);
  return getTask(id);
}

// ---------------------------------------------------------------- 转发 Flask

async function callFlask(path, body) {
  const response = await fetch(FLASK + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { error: "服务异常" }; }
  if (!response.ok) throw fail(response.status, data.error || "服务异常");
  return data;
}

export async function inspectUpload(body) {
  return callFlask("/api/hqla/inspect", body);
}

export async function parseUpload(body) {
  return callFlask("/api/hqla/parse", body);
}

export async function inspectWorkbook(body) {
  return callFlask("/api/hqla/inspect-workbook", body);
}

export async function parseWorkbook(body) {
  return callFlask("/api/hqla/parse-workbook", body);
}

export async function computeLcr(id) {
  const task = await getTask(id);
  const payload = await lcrInput(task);
  return callFlask("/api/hqla/lcr-compute", payload);
}

export async function computeTask(id) {
  const task = await getTask(id);
  const reference = await referenceRows();
  return callFlask("/api/hqla/compute", { task, reference });
}

export async function planSample(id) {
  const task = await getTask(id);
  const reference = await referenceRows();
  return callFlask("/api/hqla/sample", { task, reference });
}

export async function listHitsFor(id, code) {
  const task = await getTask(id);
  const reference = await referenceRows();
  return callFlask("/api/hqla/list-hits", { task, reference, code });
}

export async function exportWorkbook(id) {
  const task = await getTask(id);
  const reference = await referenceRows();
  const response = await fetch(FLASK + "/api/hqla/export", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ task, reference }),
  });
  if (!response.ok) {
    const text = await response.text();
    let message = "导出失败";
    try { message = JSON.parse(text).error || message; } catch { /* 忽略 */ }
    throw fail(response.status, message);
  }
  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    filename: `HQLA底稿_${task.name || "HQLA"}_${task.baseDate || ""}.xlsx`.replace(/[\\/:*?"<>|]/g, "_"),
  };
}

// ---------------------------------------------------------------- 演示数据

export async function demoData(kind) {
  const demo = require(join(ROOT, "server/data/hqla_demo.cjs"));
  if (kind === "input") return { rows: demo.sample.rows, meta: demo.sample.meta, reported: demo.sample.reported };
  if (kind === "lists") return demo.inputs;
  if (kind === "reported") return demo.sample.reported;
  if (kind === "reference") return demo.reference;
  throw fail(400, "未知的演示数据类型");
}
