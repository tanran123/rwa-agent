/**
 * 流动性 HQLA：计算任务的持久化（MySQL）与转发。
 *
 * 判定/抽样/加总/对账/导出都在 Flask 的 agent/core/hqla/ 里；
 * 这里只负责存任务、读任务，以及把 compute / parse / export 转发给 8766。
 */

import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pool, query } from "./db.js";
import {
  autoMapDataset, identifyDatasets, lcrInput, liquidityMeta, liquidityParams, liquidityRules,
  listLiquidityDictionaries, listLiquidityProducts, qualityDataset
} from "./liquidity.js";

const FLASK = "http://127.0.0.1:8766";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(import.meta.url);
const { writeXlsx } = require(join(ROOT, "server/lib/xlsx-writer.cjs"));
const LIST_CODES = ["trading_book", "encumbered", "related_party", "own_issue", "policy_bank", "structured_sub", "rmbs_approval"];

function pad(value) {
  return String(value).padStart(2, "0");
}

function nowText() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function uid(prefix = "T") {
  return prefix + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase();
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
    rwaTaskId: row.rwa_task_id || null,
    rwaTaskSubId: row.rwa_task_sub_id || null,
    snapshotId: row.snapshot_id || null,
    currentRunId: row.current_run_id || null,
    inputVersion: Number(row.input_version) || 1,
    calcStatus: row.calc_status || "not_run",
    progress: Number(row.progress) || 0,
    reviewStatus: row.review_status || "",
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
    fileId: row.file_id || "",
    sheet: row.sheet_name || "",
    productCode: row.product_code || "",
    productName: row.product_name || "",
    productGroupCode: row.product_group_code || "",
    confidence: row.confidence == null ? null : Number(row.confidence),
    level: row.confirm_level || "",
    confirmedAt: row.confirmed_at || "",
    headers: parseJson(row.headers_json, []),
    rows: parseJson(row.rows_json, []),
    sample: parseJson(row.sample_json, []),
    profile: parseJson(row.profile_json, null),
    mapping: parseJson(row.mapping_json, {}),
    mappingMeta: parseJson(row.mapping_meta_json, null),
    quality: parseJson(row.quality_json, null),
    rowCount: Number(row.row_count) || 0,
    columnCount: Number(row.column_count) || 0,
    parseStatus: row.parse_status || "parsed",
    inputVersion: Number(row.input_version) || 1,
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

// ---------------------------------------------------------------- 快照与任务关联

function guessType(values) {
  const sample = values.slice(0, 50);
  if (!sample.length) return "empty";
  if (sample.every((value) => value === true || value === false || /^(true|false|是|否|Y|N)$/i.test(String(value)))) return "boolean";
  if (sample.every((value) => Number.isFinite(Number(String(value).replace(/[,，\s]/g, ""))))) return "number";
  if (sample.every((value) => /^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(String(value)))) return "date";
  return "string";
}

function profileOf(dataset) {
  const rows = dataset.rows || [];
  const headers = dataset.headers || [];
  const columns = {};
  headers.forEach((header) => {
    const present = rows.map((row) => row[header]).filter((value) => value !== null && value !== undefined && value !== "");
    const unique = [...new Set(present.map((value) => String(value)))];
    const numeric = present.map((value) => Number(String(value).replace(/[,，\s]/g, ""))).filter((value) => Number.isFinite(value));
    const entry = {
      header,
      type: guessType(present),
      present: present.length,
      missing: rows.length - present.length,
      nullRate: rows.length ? Number(((rows.length - present.length) / rows.length).toFixed(4)) : 0,
      unique: unique.length,
      samples: unique.slice(0, 5)
    };
    if (numeric.length) {
      entry.min = Math.min(...numeric);
      entry.max = Math.max(...numeric);
    }
    columns[header] = entry;
  });
  return { rowCount: rows.length, columnCount: headers.length, columns };
}

function sampleOf(rows, limit = 10) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return [];
  if (list.length <= limit) return list;
  const indexes = new Set([0, list.length - 1, Math.floor(list.length / 2)]);
  for (let index = 1; indexes.size < limit && index < list.length; index += Math.max(1, Math.floor(list.length / limit))) {
    indexes.add(index);
  }
  return [...indexes].sort((a, b) => a - b).slice(0, limit).map((index) => list[index]);
}

async function buildSnapshotConfig(cfg) {
  const jurisdiction = String(cfg.jurisdiction || "HK").toUpperCase();
  const version = String(cfg.ruleVersion || "").trim();
  if (!version) throw fail(400, "缺少监管规则版本");
  let meta;
  try {
    meta = await liquidityMeta({ jurisdiction, version });
  } catch (err) {
    throw fail(400, "当前版本还没有可用的流动性配置：" + (err.message || version));
  }
  const [rules, params, dictionaries] = await Promise.all([
    liquidityRules({ jurisdiction, version }),
    liquidityParams({ jurisdiction, version }),
    listLiquidityDictionaries({ jurisdiction, version })
  ]);
  return {
    domain: "LCR",
    ruleVersion: version,
    jurisdiction,
    lcrVersion: (meta.meta && meta.meta.lcrVersion) || cfg.lcrVersion || "",
    lcrVersionName: (meta.meta && meta.meta.lcrVersionName) || "",
    source: (meta.meta && meta.meta.source) || "",
    products: meta.products || [],
    packages: meta.packages || [],
    rules: rules.rules || [],
    params: params.params || [],
    tables: params.tables || [],
    lists: params.lists || [],
    dictionaries: dictionaries.dictionaries || [],
    engineVersion: "lcr-engine-v1",
    createdAt: nowText()
  };
}

export async function createSnapshot(taskId, cfg, actor = "") {
  const config = await buildSnapshotConfig(cfg);
  const json = JSON.stringify(config);
  const hash = createHash("sha256").update(json).digest("hex");
  const id = uid("S");
  await query(
    `INSERT INTO hqla_snapshot
       (id, task_id, snapshot_no, rule_version, jurisdiction, config_json, config_hash, created_by, created_at)
     VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?)`,
    [id, taskId, config.ruleVersion, config.jurisdiction, json, hash, actor, nowText()]
  );
  await query("UPDATE hqla_task SET snapshot_id = ?, updated_at = ? WHERE id = ?", [id, nowText(), taskId]);
  return { id, hash, config };
}

export async function openHqlaTask(taskId, subId, actor = "") {
  const subs = await query("SELECT * FROM rwa_task_sub WHERE id = ? AND task_id = ?", [subId, taskId]);
  if (!subs.length) throw fail(404, "流动性子任务不存在");
  const sub = subs[0];
  if (sub.module !== "liquidity") throw fail(400, "只有流动性子任务可以创建 LCR 任务");
  if (sub.hqla_task_id) return getTask(sub.hqla_task_id);
  const linked = await query("SELECT id FROM hqla_task WHERE rwa_task_sub_id = ? LIMIT 1", [subId]);
  if (linked.length) {
    await query("UPDATE rwa_task_sub SET hqla_task_id = ?, updated_at = ? WHERE id = ?", [linked[0].id, nowText(), subId]);
    return getTask(linked[0].id);
  }
  const taskRows = await query("SELECT * FROM rwa_task WHERE id = ?", [taskId]);
  if (!taskRows.length) throw fail(404, "主任务不存在");
  const task = taskRows[0];
  const id = uid();
  const now = nowText();
  const cfg = {
    domain: "LCR",
    jurisdiction: task.jurisdiction,
    ruleVersion: task.version,
    lcrVersion: "",
    inherited: true,
    rwaTask: {
      id: task.id,
      name: task.name,
      institution: task.institution,
      jurisdiction: task.jurisdiction,
      version: task.version,
      baseDate: dateText(task.base_date)
    },
    rwaTaskSub: { id: sub.id, name: sub.name },
    snapshotLockedAt: now
  };
  try {
    await query(
      `INSERT INTO hqla_task
         (id, name, institution, base_date, status, step, config, rwa_task_id, rwa_task_sub_id,
          input_version, calc_status, progress, review_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'draft', 1, ?, ?, ?, 1, 'not_run', 0, '', ?, ?)`,
      [id, String(sub.name || task.name).slice(0, 200), task.institution, dateText(task.base_date),
        JSON.stringify(cfg), task.id, sub.id, now, now]
    );
  } catch (err) {
    if (err && err.code === "ER_DUP_ENTRY") {
      const existing = await query("SELECT id FROM hqla_task WHERE rwa_task_sub_id = ? LIMIT 1", [subId]);
      if (existing.length) {
        await query("UPDATE rwa_task_sub SET hqla_task_id = ?, updated_at = ? WHERE id = ?", [existing[0].id, nowText(), subId]);
        return getTask(existing[0].id);
      }
    }
    throw err;
  }
  const snapshot = await createSnapshot(id, cfg, actor);
  await query(
    "UPDATE hqla_task SET config = ?, snapshot_id = ?, updated_at = ? WHERE id = ?",
    [JSON.stringify({ ...cfg, snapshotId: snapshot.id, snapshotHash: snapshot.hash, lcrVersion: snapshot.config.lcrVersion }), snapshot.id, nowText(), id]
  );
  await query(
    "UPDATE rwa_task_sub SET hqla_task_id = ?, status = IF(status = 'draft', 'doing', status), updated_at = ? WHERE id = ?",
    [id, nowText(), subId]
  );
  return getTask(id);
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
  const [input, lists, reported, datasets, records, recognitionRows, mappingCount, qualityRunRows] = await Promise.all([
    query("SELECT * FROM hqla_task_input WHERE task_id = ? ORDER BY line_no", [id]),
    query("SELECT * FROM hqla_task_list WHERE task_id = ? ORDER BY id", [id]),
    query("SELECT * FROM hqla_task_reported WHERE task_id = ? ORDER BY id", [id]),
    query("SELECT * FROM hqla_task_dataset WHERE task_id = ? ORDER BY sort_order, id", [id]),
    query("SELECT COUNT(*) AS n FROM hqla_record WHERE task_id = ?", [id]),
    query(
      "SELECT recognition_status, COUNT(*) AS n FROM hqla_product_recognition WHERE task_id = ? GROUP BY recognition_status",
      [id]
    ),
    query("SELECT COUNT(*) AS n FROM hqla_field_mapping WHERE task_id = ?", [id]),
    query("SELECT * FROM hqla_quality_run WHERE task_id = ? ORDER BY started_at DESC, id DESC LIMIT 1", [id]),
  ]);
  task.input = { rows: input.map(inputOut), meta: task.inputMeta };
  task.datasets = datasets.map(datasetOut);
  task.recordCount = Number(records[0] && records[0].n) || 0;
  const recognition = { total: task.recordCount, pending: 0, confirmed: 0, unmatched: 0, conflict: 0 };
  recognitionRows.forEach((row) => {
    const status = row.recognition_status || "pending";
    if (recognition[status] != null) recognition[status] = Number(row.n) || 0;
  });
  recognition.pending = Math.max(0, recognition.total - recognition.confirmed - recognition.unmatched - recognition.conflict);
  task.recognition = recognition;
  task.fieldMappingCount = Number(mappingCount[0] && mappingCount[0].n) || 0;
  if (qualityRunRows.length) {
    task.qualityRun = {
      id: qualityRunRows[0].id,
      inputVersion: Number(qualityRunRows[0].input_version) || 0,
      status: qualityRunRows[0].status,
      summary: parseJson(qualityRunRows[0].summary_json, null),
      startedAt: qualityRunRows[0].started_at,
      finishedAt: qualityRunRows[0].finished_at
    };
  }
  if (task.currentRunId) {
    const runRows = await query("SELECT * FROM hqla_task_run WHERE id = ?", [task.currentRunId]);
    if (runRows.length) {
      task.currentRun = {
        id: runRows[0].id,
        runNo: Number(runRows[0].run_no) || 0,
        snapshotId: runRows[0].snapshot_id || "",
        inputVersion: Number(runRows[0].input_version) || 0,
        engineVersion: runRows[0].engine_version || "",
        status: runRows[0].status,
        startedAt: runRows[0].started_at,
        finishedAt: runRows[0].finished_at,
        metrics: parseJson(runRows[0].metrics_json, null),
        stats: parseJson(runRows[0].stats_json, null),
        exceptionCount: Number(runRows[0].exception_count) || 0
      };
    }
  }
  task.lists = {};
  for (const list of lists) {
    if (!task.lists[list.list_code]) task.lists[list.list_code] = { rows: [], meta: { name: list.list_code, count: 0 } };
    task.lists[list.list_code].rows.push(listOut(list));
  }
  for (const code of Object.keys(task.lists)) task.lists[code].meta.count = task.lists[code].rows.length;
  task.reported = reported.map(reportedOut);
  if (task.rwaTaskId) {
    const rows = await query("SELECT * FROM rwa_task WHERE id = ?", [task.rwaTaskId]);
    if (rows.length) {
      task.rwaTask = {
        id: rows[0].id,
        name: rows[0].name,
        institution: rows[0].institution,
        jurisdiction: rows[0].jurisdiction,
        version: rows[0].version,
        baseDate: dateText(rows[0].base_date),
        status: rows[0].status || ""
      };
    }
  }
  if (task.rwaTaskSubId) {
    const rows = await query("SELECT * FROM rwa_task_sub WHERE id = ?", [task.rwaTaskSubId]);
    if (rows.length) {
      task.rwaTaskSub = {
        id: rows[0].id,
        name: rows[0].name,
        module: rows[0].module,
        status: rows[0].status,
        progress: Number(rows[0].progress) || 0,
        reviewStatus: rows[0].review_status || "",
        resultSummary: parseJson(rows[0].result_summary, null)
      };
    }
  }
  if (task.snapshotId) {
    const rows = await query("SELECT * FROM hqla_snapshot WHERE id = ?", [task.snapshotId]);
    if (rows.length) {
      task.snapshot = {
        id: rows[0].id,
        ruleVersion: rows[0].rule_version || "",
        jurisdiction: rows[0].jurisdiction || "",
        hash: rows[0].config_hash || "",
        createdAt: rows[0].created_at || ""
      };
    }
  }
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
  if (body.status !== undefined) {
    set("status", String(body.status).slice(0, 16));
    if (["done", "archived"].includes(body.status)) set("progress", 100);
  }
  if (body.step !== undefined) {
    const step = Number(body.step) || 1;
    set("step", step);
    if (body.progress === undefined) set("progress", Math.round(((step - 1) / 7) * 100));
  }
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
  if (body.calcStatus !== undefined) set("calc_status", String(body.calcStatus || "not_run").slice(0, 16));
  if (body.progress !== undefined) set("progress", Number(body.progress) || 0);
  if (body.reviewStatus !== undefined) set("review_status", String(body.reviewStatus || "").slice(0, 16));
  if (body.currentRunId !== undefined) set("current_run_id", body.currentRunId || null);
  set("updated_at", nowText());
  params.push(row.id);
  await query(`UPDATE hqla_task SET ${fields.join(", ")} WHERE id = ?`, params);
  return getTask(id);
}

export async function deleteTask(id) {
  const row = await taskRow(id);
  if (row.status === "archived") throw fail(400, "已归档任务不能删除");
  for (const table of [
    "hqla_task_input", "hqla_task_list", "hqla_task_reported", "hqla_task_dataset", "hqla_record",
    "hqla_file", "hqla_snapshot", "hqla_product_rule", "hqla_product_recognition",
    "hqla_field_suggestion", "hqla_field_mapping", "hqla_quality_issue", "hqla_quality_run",
    "hqla_result_detail", "hqla_result_summary", "hqla_calculation_exception", "hqla_task_run",
    "hqla_review", "hqla_audit_log"
  ]) {
    await query(`DELETE FROM ${table} WHERE task_id = ?`, [id]);
  }
  await query("DELETE FROM hqla_task WHERE id = ?", [id]);
  if (row.rwa_task_sub_id) {
    await query(
      `UPDATE rwa_task_sub
          SET hqla_task_id = NULL, status = 'draft', progress = 0, review_status = '',
              result_summary = NULL, updated_at = ?
        WHERE id = ?`,
      [nowText(), row.rwa_task_sub_id]
    );
  }
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
  const row = await taskRow(id);
  const now = nowText();
  await query(
    "UPDATE hqla_task SET status = ?, progress = ?, review_status = ?, updated_at = ? WHERE id = ?",
    [archived ? "archived" : "doing", archived ? 100 : Number(row.progress) || 0, archived ? "reviewed" : "", now, id]
  );
  if (row.rwa_task_sub_id) {
    const summary = archived ? parseJson(row.summary, null) : null;
    await query(
      `UPDATE rwa_task_sub
          SET status = ?, progress = ?, review_status = ?, result_summary = ?, updated_at = ?
        WHERE id = ?`,
      [archived ? "archived" : "doing", archived ? 100 : Number(row.progress) || 0, archived ? "reviewed" : "",
        summary ? JSON.stringify(summary) : null, now, row.rwa_task_sub_id]
    );
  }
  return getTask(id);
}

export async function reviewTask(id, body = {}) {
  const task = await getTask(id);
  if (task.status === "archived") throw fail(400, "任务已归档");
  if (!task.currentRunId) throw fail(400, "还没有计算批次，不能复核");
  const runs = await query("SELECT * FROM hqla_task_run WHERE task_id = ? AND id = ?", [id, task.currentRunId]);
  if (!runs.length) throw fail(404, "当前计算批次不存在");
  const now = nowText();
  const reviewer = String(body.reviewer || "").slice(0, 64);
  const comment = String(body.comment || "").slice(0, 1000);
  const reviewId = uid("V");
  await query(
    `INSERT INTO hqla_review (id, task_id, run_id, status, reviewer, comment, reviewed_at)
     VALUES (?, ?, ?, 'reviewed', ?, ?, ?)`,
    [reviewId, id, task.currentRunId, reviewer, comment, now]
  );
  await query(
    `UPDATE hqla_task
        SET status = 'archived', step = 7, progress = 100, review_status = 'reviewed',
            config = ?, updated_at = ?
      WHERE id = ?`,
    [JSON.stringify({ ...(task.cfg || {}), review: { status: "reviewed", reviewedAt: now, reviewer } }), now, id]
  );
  if (task.rwaTaskSubId) {
    await query(
      `UPDATE rwa_task_sub
          SET status = 'archived', progress = 100, review_status = 'reviewed',
              result_summary = ?, updated_at = ?
        WHERE id = ?`,
      [task.summary ? JSON.stringify(task.summary) : null, now, task.rwaTaskSubId]
    );
  }
  await query(
    `INSERT INTO hqla_audit_log (task_id, action, object_type, object_id, detail_json, actor, at)
     VALUES (?, 'review', 'hqla_task', ?, ?, ?, ?)`,
    [id, id, JSON.stringify({ runId: task.currentRunId, reviewId }), reviewer, now]
  );
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
  const task = await taskRow(id);
  const datasets = Array.isArray(body.datasets) ? body.datasets : [];
  const nextVersion = (Number(task.input_version) || 1) + 1;
  await query("DELETE FROM hqla_record WHERE task_id = ?", [id]);
  await query("DELETE FROM hqla_product_rule WHERE task_id = ?", [id]);
  await query("DELETE FROM hqla_product_recognition WHERE task_id = ?", [id]);
  await query("DELETE FROM hqla_field_suggestion WHERE task_id = ?", [id]);
  await query("DELETE FROM hqla_field_mapping WHERE task_id = ?", [id]);
  await query("DELETE FROM hqla_task_dataset WHERE task_id = ?", [id]);
  let order = 0;
  for (const dataset of datasets) {
    order += 1;
    const datasetId = String(dataset.id || "DS" + order).slice(0, 64);
    const rows = Array.isArray(dataset.rows) ? dataset.rows : [];
    const headers = Array.isArray(dataset.headers) ? dataset.headers : [];
    const profile = dataset.profile || profileOf({ headers, rows });
    const sample = Array.isArray(dataset.sample) && dataset.sample.length ? dataset.sample : sampleOf(rows, 10);
    await query(
      `INSERT INTO hqla_task_dataset
         (task_id, dataset_id, file_id, sheet_name, product_code, product_name, product_group_code,
          confidence, confirm_level, confirmed_at, headers_json, rows_json, sample_json, profile_json,
          mapping_json, mapping_meta_json, quality_json, row_count, column_count, parse_status,
          input_version, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, datasetId, String(dataset.fileId || "").slice(0, 40), String(dataset.sheet || "").slice(0, 128),
        String(dataset.productCode || "").slice(0, 64), String(dataset.productName || "").slice(0, 128),
        String(dataset.productGroupCode || "").slice(0, 64),
        dataset.confidence == null ? null : Number(dataset.confidence), String(dataset.level || "").slice(0, 16),
        String(dataset.confirmedAt || "").slice(0, 32),
        JSON.stringify(headers), JSON.stringify(rows), JSON.stringify(sample), JSON.stringify(profile),
        JSON.stringify(dataset.mapping || {}),
        dataset.mappingMeta ? JSON.stringify(dataset.mappingMeta) : null,
        dataset.quality ? JSON.stringify(dataset.quality) : null,
        rows.length, headers.length, String(dataset.parseStatus || "parsed").slice(0, 16), nextVersion, order
      ]
    );
    const recordValues = [];
    const recordParams = [];
    rows.forEach((row, index) => {
      const rowNo = Number(row && row._line) || index + 1;
      const recordId = datasetId + ":" + rowNo + ":" + (index + 1);
      recordValues.push("(?, ?, ?, ?, ?, ?, ?, ?, ?)");
      recordParams.push(
        id, datasetId, recordId, rowNo, JSON.stringify(row || {}),
        String(dataset.productCode || "").slice(0, 64), String(dataset.productGroupCode || "").slice(0, 64),
        dataset.confirmedAt ? "confirmed" : "pending", nextVersion
      );
    });
    for (let start = 0; start < recordValues.length; start += 200) {
      const chunkValues = recordValues.slice(start, start + 200);
      const chunkParams = recordParams.slice(start * 9, (start + 200) * 9);
      await query(
        `INSERT INTO hqla_record
           (task_id, dataset_id, record_id, row_no, raw_json, product_code, product_group_code,
            recognition_status, input_version)
         VALUES ${chunkValues.join(", ")}`,
        chunkParams
      );
    }
  }
  await query(
    `UPDATE hqla_task
        SET input_version = ?, calc_status = 'not_run', current_run_id = NULL,
            review_status = '', updated_at = ?
      WHERE id = ?`,
    [nextVersion, nowText(), id]
  );
  return getTask(id);
}

export async function saveDatasetMeta(id, datasetId, patch = {}) {
  const task = await taskRow(id);
  const rows = await query("SELECT * FROM hqla_task_dataset WHERE task_id = ? AND dataset_id = ?", [id, datasetId]);
  if (!rows.length) throw fail(404, "数据集不存在");
  const current = datasetOut(rows[0]);
  const next = { ...current, ...patch, id: current.id };
  const nextVersion = (Number(task.input_version) || 1) + 1;
  await query(
    `UPDATE hqla_task_dataset
        SET product_code = ?, product_name = ?, product_group_code = ?, confidence = ?, confirm_level = ?, confirmed_at = ?,
            headers_json = ?, mapping_json = ?, mapping_meta_json = ?, quality_json = ?, input_version = ?
      WHERE task_id = ? AND dataset_id = ?`,
    [
      String(next.productCode || "").slice(0, 64), String(next.productName || "").slice(0, 128),
      String(next.productGroupCode || "").slice(0, 64),
      next.confidence == null ? null : Number(next.confidence), String(next.level || "").slice(0, 16),
      String(next.confirmedAt || "").slice(0, 32),
      JSON.stringify(next.headers || []), JSON.stringify(next.mapping || {}),
      next.mappingMeta ? JSON.stringify(next.mappingMeta) : null,
      next.quality ? JSON.stringify(next.quality) : null,
      nextVersion, id, datasetId
    ]
  );
  if (current.productCode !== String(next.productCode || "")) {
    await query(
      "UPDATE hqla_record SET product_code = ?, recognition_status = ?, input_version = ? WHERE task_id = ? AND dataset_id = ?",
      [String(next.productCode || "").slice(0, 64), next.confirmedAt ? "confirmed" : "pending", nextVersion, id, datasetId]
    );
    await query("DELETE FROM hqla_field_suggestion WHERE task_id = ? AND dataset_id = ?", [id, datasetId]);
    await query("DELETE FROM hqla_field_mapping WHERE task_id = ? AND dataset_id = ?", [id, datasetId]);
  }
  await query(
    `UPDATE hqla_task
        SET input_version = ?, calc_status = 'not_run', current_run_id = NULL,
            review_status = '', updated_at = ?
      WHERE id = ?`,
    [nextVersion, nowText(), id]
  );
  return getTask(id);
}

export async function deleteDataset(id, datasetId) {
  const task = await taskRow(id);
  const nextVersion = (Number(task.input_version) || 1) + 1;
  await query("DELETE FROM hqla_record WHERE task_id = ? AND dataset_id = ?", [id, datasetId]);
  await query("DELETE FROM hqla_product_rule WHERE task_id = ? AND dataset_id = ?", [id, datasetId]);
  await query("DELETE FROM hqla_product_recognition WHERE task_id = ? AND dataset_id = ?", [id, datasetId]);
  await query("DELETE FROM hqla_field_suggestion WHERE task_id = ? AND dataset_id = ?", [id, datasetId]);
  await query("DELETE FROM hqla_field_mapping WHERE task_id = ? AND dataset_id = ?", [id, datasetId]);
  await query("DELETE FROM hqla_task_dataset WHERE task_id = ? AND dataset_id = ?", [id, datasetId]);
  await query(
    `UPDATE hqla_task
        SET input_version = ?, calc_status = 'not_run', current_run_id = NULL,
            review_status = '', updated_at = ?
      WHERE id = ?`,
    [nextVersion, nowText(), id]
  );
  return getTask(id);
}

async function configuredProducts(task) {
  const cfg = task.cfg || {};
  if (!cfg.ruleVersion) throw fail(400, "请先在第一步选择监管规则版本");
  const catalogue = await listLiquidityProducts({
    jurisdiction: cfg.jurisdiction || "HK",
    version: cfg.ruleVersion,
  });
  const usable = catalogue.products.filter(
    (product) => product.status === "LIVE" && product.completeness.score >= 100
  );
  if (!usable.length) {
    throw fail(400, "这一版没有可用于计量的产品（需已启用且配置完整）");
  }
  return usable;
}

// ---------------------------------------------------------------- Phase 2：记录级识别与字段对应

async function snapshotConfig(task) {
  const snapshotId = task.snapshotId || task.snapshot_id;
  if (snapshotId) {
    const rows = await query("SELECT * FROM hqla_snapshot WHERE id = ?", [snapshotId]);
    if (rows.length) {
      const config = parseJson(rows[0].config_json, null);
      if (config) return config;
    }
  }
  const cfg = task.cfg || {};
  if (!cfg.ruleVersion) return null;
  const jurisdiction = String(cfg.jurisdiction || "HK").toUpperCase();
  const version = String(cfg.ruleVersion);
  try {
    const [meta, rules, params] = await Promise.all([
      liquidityMeta({ jurisdiction, version }),
      liquidityRules({ jurisdiction, version }),
      liquidityParams({ jurisdiction, version })
    ]);
    return {
      ruleVersion: version,
      jurisdiction,
      lcrVersion: (meta.meta && meta.meta.lcrVersion) || cfg.lcrVersion || "",
      products: meta.products || [],
      packages: meta.packages || [],
      rules: rules.rules || [],
      params: params.params || [],
      tables: params.tables || [],
      lists: params.lists || [],
      engineVersion: "lcr-engine-v1"
    };
  } catch (err) {
    return null;
  }
}

function catalogProducts(config) {
  return Array.isArray(config && config.products) ? config.products : [];
}

function catalogForAgent(products) {
  return (products || []).map((product) => ({
    code: product.code,
    name: product.name,
    category: product.category || "",
    side: product.side || "",
    description: product.description || "",
    status: product.status || "",
    fields: (product.fields || []).slice(0, 100).map((field) => ({
      code: field.code,
      name: field.name,
      dataType: field.dataType,
      required: !!field.required,
      requiredByRule: !!field.requiredByRule,
      dictionary: field.dictionary || "",
      unit: field.unit || "",
      businessType: field.businessType || "",
      aliases: field.aliases || []
    }))
  }));
}

function productMapOf(products) {
  return new Map((products || []).map((product) => [product.code, product]));
}

function fieldMapOf(product) {
  return new Map(((product && product.fields) || []).map((field) => [field.code, field]));
}

function normalizedText(value) {
  return String(value == null ? "" : value).trim().toLowerCase().replace(/[\s_\-/\\()（）:：,，.。]+/g, "");
}

function numericValue(value) {
  if (value == null || value === "" || typeof value === "boolean") return null;
  const number = Number(String(value).replace(/[,，\s]/g, ""));
  return Number.isFinite(number) ? number : null;
}

function compareScalar(actual, expected, op) {
  const aNumber = numericValue(actual);
  const eNumber = numericValue(expected);
  if (aNumber != null && eNumber != null) {
    if (op === "eq") return aNumber === eNumber;
    if (op === "neq") return aNumber !== eNumber;
    if (op === "gt") return aNumber > eNumber;
    if (op === "gte") return aNumber >= eNumber;
    if (op === "lt") return aNumber < eNumber;
    if (op === "lte") return aNumber <= eNumber;
  }
  const aText = normalizedText(actual);
  const eText = normalizedText(expected);
  if (op === "eq") return aText === eText;
  if (op === "neq") return aText !== eText;
  if (op === "gt") return String(actual) > String(expected);
  if (op === "gte") return String(actual) >= String(expected);
  if (op === "lt") return String(actual) < String(expected);
  if (op === "lte") return String(actual) <= String(expected);
  return false;
}

function conditionMatches(record, condition) {
  const column = String(condition && condition.source_column || "");
  const op = String(condition && condition.op || "");
  const actual = record ? record[column] : null;
  const empty = actual == null || String(actual).trim() === "";
  if (op === "exists") return !empty;
  if (op === "is_null") return empty;
  if (op === "in") return Array.isArray(condition.value) && condition.value.some((value) => compareScalar(actual, value, "eq"));
  if (op === "not_in") return Array.isArray(condition.value) && !condition.value.some((value) => compareScalar(actual, value, "eq"));
  if (op === "contains") return normalizedText(actual).includes(normalizedText(condition.value));
  if (op === "not_contains") return !normalizedText(actual).includes(normalizedText(condition.value));
  if (op === "between") {
    const bounds = Array.isArray(condition.value) ? condition.value : [];
    return bounds.length === 2 && compareScalar(actual, bounds[0], "gte") && compareScalar(actual, bounds[1], "lte");
  }
  return compareScalar(actual, condition.value, op);
}

function ruleMatches(record, rule) {
  const conditions = Array.isArray(rule && rule.conditions) ? rule.conditions : [];
  return conditions.every((condition) => conditionMatches(record, condition));
}

function executeStrategy(records, strategy, productMap) {
  const rules = (strategy && Array.isArray(strategy.rules) ? strategy.rules : [])
    .filter((rule) => productMap.has(String(rule.product_code || "")));
  const fallback = strategy && String(strategy.fallback_product_code || "");
  return (records || []).map((record) => {
    const matches = rules.filter((rule) => ruleMatches(record.raw, rule));
    if (matches.length) {
      const sorted = matches.slice().sort((a, b) => (Number(b.priority) || 0) - (Number(a.priority) || 0));
      const best = sorted[0];
      const top = Number(best.priority) || 0;
      const conflict = sorted.length > 1 && Number(sorted[1].priority) === top && sorted[1].product_code !== best.product_code;
      const confidence = Math.max(0, Math.min(99, 60 + (best.conditions || []).length * 10 + Math.min(15, Math.floor(top / 10))));
      return {
        suggested: best.product_code,
        confidence,
        reason: best.reason || "匹配产品识别规则",
        candidates: sorted.slice(0, 5).map((rule) => ({ productCode: rule.product_code, score: Number(rule.priority) || 0 })),
        status: conflict ? "conflict" : "pending"
      };
    }
    if (fallback && productMap.has(fallback)) {
      return { suggested: fallback, confidence: 30, reason: "按兜底产品识别", candidates: [], status: "pending" };
    }
    return { suggested: "", confidence: 0, reason: "没有匹配到产品识别规则", candidates: [], status: "unmatched" };
  });
}

async function ensureRecords(task, dataset) {
  let records = await query(
    "SELECT * FROM hqla_record WHERE task_id = ? AND dataset_id = ? ORDER BY row_no, id",
    [task.id, dataset.id]
  );
  if (records.length || !(dataset.rows || []).length) return records.map((row) => ({ ...row, raw: parseJson(row.raw_json, {}) }));
  const rows = dataset.rows || [];
  for (let start = 0; start < rows.length; start += 200) {
    const values = [];
    const params = [];
    rows.slice(start, start + 200).forEach((row, offset) => {
      const index = start + offset;
      const rowNo = Number(row && row._line) || index + 1;
      const recordId = dataset.id + ":" + rowNo + ":" + (index + 1);
      values.push("(?, ?, ?, ?, ?, ?, ?, ?, ?)");
      params.push(task.id, dataset.id, recordId, rowNo, JSON.stringify(row || {}), "", "", "pending", task.inputVersion || 1);
    });
    await query(
      `INSERT INTO hqla_record
         (task_id, dataset_id, record_id, row_no, raw_json, product_code, product_group_code,
          recognition_status, input_version)
       VALUES ${values.join(", ")}`,
      params
    );
  }
  records = await query(
    "SELECT * FROM hqla_record WHERE task_id = ? AND dataset_id = ? ORDER BY row_no, id",
    [task.id, dataset.id]
  );
  return records.map((row) => ({ ...row, raw: parseJson(row.raw_json, {}) }));
}

async function bumpTaskVersion(id) {
  const task = await taskRow(id);
  const next = (Number(task.input_version) || 1) + 1;
  await query(
    `UPDATE hqla_task
        SET input_version = ?, calc_status = 'not_run', current_run_id = NULL,
            review_status = '', updated_at = ?
      WHERE id = ?`,
    [next, nowText(), id]
  );
  return next;
}

function fallbackStrategy(dataset, products) {
  const candidate = identifyDatasets([{ ...dataset, rows: dataset.rows || [] }], products)[0];
  if (!candidate || !candidate.productCode) return { summary: "", rules: [], fallback_product_code: "" };
  return {
    summary: "模型不可用，按表头和产品标准字段做确定性兜底识别",
    rules: [{ product_code: candidate.productCode, priority: 1, conditions: [], reason: "确定性兜底" }],
    fallback_product_code: candidate.productCode
  };
}

export async function getTaskSnapshot(id) {
  const task = await getTask(id);
  const config = await snapshotConfig(task);
  if (!config) throw fail(404, "任务还没有可用的配置快照");
  return { taskId: id, snapshotId: task.snapshotId || "", inputVersion: Number(task.inputVersion) || 1, config };
}

export async function recognizeTaskProducts(id, body = {}) {
  const task = await getTask(id);
  if (task.status === "archived") throw fail(400, "已归档任务不能重新识别");
  const config = await snapshotConfig(task);
  if (!config) throw fail(400, "任务还没有可用的配置快照");
  const products = catalogProducts(config);
  if (!products.length) throw fail(400, "配置快照里没有产品");
  const productMap = productMapOf(products);
  const datasets = Array.isArray(task.datasets) ? task.datasets : [];
  const selected = body.datasetId ? datasets.filter((dataset) => dataset.id === String(body.datasetId)) : datasets;
  if (!selected.length) throw fail(400, "没有可识别的数据集");
  const nextVersion = (Number(task.inputVersion) || 1) + 1;
  const result = [];
  for (const dataset of selected) {
    const records = await ensureRecords(task, dataset);
    if (!records.length) {
      result.push({ datasetId: dataset.id, sheet: dataset.sheet, ruleCount: 0, records: 0, matched: 0, pending: 0, unmatched: 0, conflict: 0, modelError: "数据集没有记录" });
      continue;
    }
    let strategy = null;
    let meta = { skill_version: "liquidity-product-identifier@1", model: "", prompt_version: "2026-11-19" };
    let modelError = "";
    try {
      const response = await callFlask("/api/hqla/recognize-products", {
        dataset: {
          id: dataset.id,
          sheet: dataset.sheet,
          headers: dataset.headers || [],
          sample: dataset.sample || [],
          profile: dataset.profile || null
        },
        products: catalogForAgent(products)
      });
      strategy = response.strategy;
      meta = {
        skill_version: response.skill_version || meta.skill_version,
        model: response.model || "",
        prompt_version: response.prompt_version || "2026-11-19"
      };
    } catch (err) {
      modelError = err.message || "模型识别失败";
      strategy = fallbackStrategy(dataset, products);
    }
    if (!strategy || !Array.isArray(strategy.rules) || !strategy.rules.length) {
      if (!modelError) modelError = "模型没有给出可用识别规则";
      strategy = fallbackStrategy(dataset, products);
    }
    await query("DELETE FROM hqla_product_rule WHERE task_id = ? AND dataset_id = ?", [id, dataset.id]);
    await query(
      `INSERT INTO hqla_product_rule
         (id, task_id, dataset_id, strategy_json, skill_version, model, prompt_version, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'suggested', ?)`,
      [uid("PR"), id, dataset.id, JSON.stringify(strategy), meta.skill_version, meta.model, meta.prompt_version, nowText()]
    );
    const outcomes = executeStrategy(records, strategy, productMap);
    const existing = await query(
      "SELECT * FROM hqla_product_recognition WHERE task_id = ? AND dataset_id = ?",
      [id, dataset.id]
    );
    const existingMap = new Map(existing.map((row) => [row.record_id, row]));
    let matched = 0;
    let pending = 0;
    let unmatched = 0;
    let conflict = 0;
    const productCounts = new Map();
    for (let index = 0; index < records.length; index += 1) {
      const record = records[index];
      const outcome = outcomes[index];
      const previous = existingMap.get(record.record_id);
      const forced = body.forceConfirmed === true;
      if (previous && previous.recognition_status === "confirmed" && !forced) {
        await query(
          "UPDATE hqla_record SET product_code = ?, recognition_status = 'confirmed', input_version = ? WHERE id = ?",
          [previous.confirmed_product_code || record.product_code || "", nextVersion, record.id]
        );
        productCounts.set(previous.confirmed_product_code, (productCounts.get(previous.confirmed_product_code) || 0) + 1);
        matched += 1;
        continue;
      }
      const status = outcome.suggested ? outcome.status : "unmatched";
      if (status === "matched" || status === "pending") matched += outcome.suggested ? 1 : 0;
      if (status === "pending") pending += 1;
      if (status === "unmatched") unmatched += 1;
      if (status === "conflict") conflict += 1;
      if (outcome.suggested) productCounts.set(outcome.suggested, (productCounts.get(outcome.suggested) || 0) + 1);
      await query(
        `INSERT INTO hqla_product_recognition
           (task_id, dataset_id, record_id, suggested_product_code, candidate_json, confidence, reason,
            method, confirmed_product_code, recognition_status, skill_version, model, prompt_version,
            input_version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'AI_RULE', ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           suggested_product_code = VALUES(suggested_product_code), candidate_json = VALUES(candidate_json),
           confidence = VALUES(confidence), reason = VALUES(reason), method = VALUES(method),
           confirmed_product_code = VALUES(confirmed_product_code), recognition_status = VALUES(recognition_status),
           skill_version = VALUES(skill_version), model = VALUES(model), prompt_version = VALUES(prompt_version),
           input_version = VALUES(input_version), updated_at = VALUES(updated_at)`,
        [
          id, dataset.id, record.record_id, outcome.suggested, JSON.stringify(outcome.candidates || []),
          outcome.confidence, String(outcome.reason || "").slice(0, 500), "", status,
          meta.skill_version, meta.model, meta.prompt_version, nextVersion, nowText(), nowText()
        ]
      );
      await query(
        "UPDATE hqla_record SET product_code = '', recognition_status = ?, input_version = ? WHERE id = ?",
        [status, nextVersion, record.id]
      );
    }
    const entries = [...productCounts.entries()].sort((a, b) => b[1] - a[1]);
    const dominant = entries.length ? entries[0] : null;
    const dominantShare = dominant ? dominant[1] / records.length : 0;
    const dominantProduct = dominant ? productMap.get(dominant[0]) : null;
    await query(
      `UPDATE hqla_task_dataset
          SET product_code = ?, product_name = ?, confidence = ?, confirm_level = ?,
              product_group_code = '', input_version = ?
        WHERE task_id = ? AND dataset_id = ?`,
      [
        dominantShare >= 0.8 && dominantProduct ? dominantProduct.code : "",
        dominantShare >= 0.8 && dominantProduct ? dominantProduct.name : "混合产品",
        dominantShare >= 0.8 ? Math.round(dominantShare * 100) : null,
        dominantShare >= 0.8 ? "SUGGESTED" : "MIXED",
        nextVersion, id, dataset.id
      ]
    );
    result.push({
      datasetId: dataset.id,
      sheet: dataset.sheet,
      ruleCount: (strategy.rules || []).length,
      records: records.length,
      matched,
      pending,
      unmatched,
      conflict,
      modelError,
      strategy
    });
  }
  await query(
    `UPDATE hqla_task
        SET input_version = ?, calc_status = 'not_run', current_run_id = NULL,
            review_status = '', updated_at = ?
      WHERE id = ?`,
    [nextVersion, nowText(), id]
  );
  return { inputVersion: nextVersion, datasets: result };
}

export async function listTaskRecognitions(id, queryParams = {}) {
  const task = await getTask(id);
  const config = await snapshotConfig(task);
  const products = catalogProducts(config);
  const productNames = new Map(products.map((product) => [product.code, product.name]));
  const datasets = new Map((task.datasets || []).map((dataset) => [dataset.id, dataset]));
  const where = ["r.task_id = ?"];
  const params = [id];
  if (queryParams.datasetId) { where.push("r.dataset_id = ?"); params.push(String(queryParams.datasetId)); }
  if (queryParams.status) {
    where.push("COALESCE(p.recognition_status, r.recognition_status) = ?");
    params.push(String(queryParams.status));
  }
  if (queryParams.productCode) {
    where.push("COALESCE(NULLIF(p.confirmed_product_code, ''), p.suggested_product_code, r.product_code) = ?");
    params.push(String(queryParams.productCode));
  }
  if (queryParams.q) {
    where.push("(CAST(r.raw_json AS CHAR) LIKE ? OR r.record_id LIKE ?)");
    const word = "%" + String(queryParams.q) + "%";
    params.push(word, word);
  }
  const page = Math.max(1, Number(queryParams.page) || 1);
  const pageSize = Math.min(200, Math.max(10, Number(queryParams.pageSize) || 50));
  const [countRows] = await query(
    `SELECT COUNT(*) AS n
       FROM hqla_record r
       LEFT JOIN hqla_product_recognition p
         ON p.task_id = r.task_id AND p.dataset_id = r.dataset_id AND p.record_id = r.record_id
      WHERE ${where.join(" AND ")}`,
    params
  );
  const rows = await query(
    `SELECT r.*, p.suggested_product_code, p.candidate_json, p.confidence AS recognition_confidence,
            p.reason, p.method, p.confirmed_product_code, p.recognition_status AS product_recognition_status,
            p.input_version AS recognition_input_version, p.skill_version, p.model, p.prompt_version
       FROM hqla_record r
       LEFT JOIN hqla_product_recognition p
         ON p.task_id = r.task_id AND p.dataset_id = r.dataset_id AND p.record_id = r.record_id
      WHERE ${where.join(" AND ")}
      ORDER BY r.dataset_id, r.row_no, r.id
      LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize]
  );
  return {
    total: Number(countRows && countRows.n) || 0,
    page,
    pageSize,
    rows: rows.map((row) => {
      const productCode = row.confirmed_product_code || row.suggested_product_code || row.product_code || "";
      return {
        recordId: row.record_id,
        datasetId: row.dataset_id,
        datasetSheet: (datasets.get(row.dataset_id) || {}).sheet || "",
        rowNo: Number(row.row_no) || 0,
        raw: parseJson(row.raw_json, {}),
        productCode,
        productName: productNames.get(productCode) || "",
        suggestedProductCode: row.suggested_product_code || "",
        confirmedProductCode: row.confirmed_product_code || "",
        status: row.product_recognition_status || row.recognition_status || "pending",
        confidence: row.recognition_confidence == null ? null : Number(row.recognition_confidence),
        reason: row.reason || "",
        candidates: parseJson(row.candidate_json, []),
        skillVersion: row.skill_version || "",
        model: row.model || "",
        promptVersion: row.prompt_version || ""
      };
    })
  };
}

export async function confirmTaskRecognitions(id, body = {}) {
  const task = await getTask(id);
  if (task.status === "archived") throw fail(400, "已归档任务不能修改识别结果");
  const config = await snapshotConfig(task);
  if (!config) throw fail(400, "任务还没有可用的配置快照");
  const productMap = productMapOf(catalogProducts(config));
  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length) {
    for (const item of items) {
      if (!item || !item.recordId) throw fail(400, "确认项缺少 recordId");
      if (!productMap.has(String(item.productCode || ""))) throw fail(400, "产品不存在：" + item.productCode);
    }
  } else {
    const recordIds = Array.isArray(body.recordIds) ? body.recordIds : body.recordId ? [body.recordId] : [];
    const productCode = String(body.productCode || "").trim();
    if (!recordIds.length) throw fail(400, "请选择要确认的记录");
    if (!productMap.has(productCode)) throw fail(400, "产品不存在：" + productCode);
    recordIds.forEach((recordId) => items.push({ recordId, productCode }));
  }
  if (!items.length) throw fail(400, "没有要确认的记录");
  const nextVersion = (Number(task.inputVersion) || 1) + 1;
  const now = nowText();
  let confirmed = 0;
  for (const item of items) {
    const rows = await query("SELECT * FROM hqla_record WHERE task_id = ? AND record_id = ?", [id, item.recordId]);
    if (!rows.length) continue;
    const record = rows[0];
    const product = productMap.get(String(item.productCode));
    await query(
      `INSERT INTO hqla_product_recognition
         (task_id, dataset_id, record_id, suggested_product_code, candidate_json, confidence, reason,
          method, confirmed_product_code, recognition_status, skill_version, model, prompt_version,
          input_version, created_at, updated_at)
       VALUES (?, ?, ?, '', '[]', 100, '人工确认', 'MANUAL', ?, 'confirmed', '', '', '', ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         confirmed_product_code = VALUES(confirmed_product_code), recognition_status = 'confirmed',
         method = 'MANUAL', confidence = 100, reason = '人工确认',
         input_version = VALUES(input_version), updated_at = VALUES(updated_at)`,
      [id, record.dataset_id, record.record_id, product.code, nextVersion, now, now]
    );
    await query(
      "UPDATE hqla_record SET product_code = ?, recognition_status = 'confirmed', quality_status = '', calc_status = '', input_version = ? WHERE id = ?",
      [product.code, nextVersion, record.id]
    );
    confirmed += 1;
  }
  await query(
    `UPDATE hqla_task
        SET input_version = ?, calc_status = 'not_run', current_run_id = NULL,
            review_status = '', updated_at = ?
      WHERE id = ?`,
    [nextVersion, now, id]
  );
  return { ok: true, confirmed, inputVersion: nextVersion };
}

function dictionariesForProduct(config, product) {
  const all = Array.isArray(config && config.dictionaries) ? config.dictionaries : [];
  const codes = new Set(((product && product.fields) || []).map((field) => field.dictionary).filter(Boolean));
  const picked = all.filter((dict) => codes.has(dict.code));
  return (picked.length ? picked : all).slice(0, 20);
}

export async function suggestTaskFields(id, body = {}) {
  const task = await getTask(id);
  if (task.status === "archived") throw fail(400, "已归档任务不能修改字段对应");
  const config = await snapshotConfig(task);
  if (!config) throw fail(400, "任务还没有可用的配置快照");
  const products = catalogProducts(config);
  const productMap = productMapOf(products);
  const datasets = task.datasets || [];
  const dataset = body.datasetId
    ? datasets.find((item) => item.id === String(body.datasetId))
    : datasets[0];
  if (!dataset) throw fail(404, "数据集不存在");
  let productCodes = body.productCode ? [String(body.productCode)] : [];
  if (!productCodes.length) {
    const rows = await query(
      `SELECT DISTINCT product_code FROM hqla_record
        WHERE task_id = ? AND dataset_id = ? AND product_code <> ''`,
      [id, dataset.id]
    );
    productCodes = rows.map((row) => row.product_code);
  }
  if (!productCodes.length && dataset.productCode) productCodes = [dataset.productCode];
  if (!productCodes.length) throw fail(400, "请先确认产品，再识别标准字段");
  const nextVersion = (Number(task.inputVersion) || 1) + 1;
  const results = [];
  for (const productCode of productCodes) {
    const product = productMap.get(productCode);
    if (!product) continue;
    await query("DELETE FROM hqla_field_suggestion WHERE task_id = ? AND dataset_id = ? AND product_code = ?", [id, dataset.id, product.code]);
    let mapping = {};
    let method = "AI";
    let meta = { skill_version: "liquidity-standard-field-matcher@1", model: "", prompt_version: "2026-11-19" };
    let modelError = "";
    try {
      const response = await callFlask("/api/hqla/recognize-fields", {
        dataset: {
          id: dataset.id,
          sheet: dataset.sheet,
          headers: dataset.headers || [],
          sample: dataset.sample || [],
          profile: dataset.profile || null
        },
        product: { code: product.code, name: product.name, fields: product.fields || [] },
        dictionaries: dictionariesForProduct(config, product)
      });
      mapping = response.mapping || {};
      meta = {
        skill_version: response.skill_version || meta.skill_version,
        model: response.model || "",
        prompt_version: response.prompt_version || "2026-11-19"
      };
    } catch (err) {
      modelError = err.message || "模型字段识别失败";
      method = "RULE";
      const fallback = autoMapDataset(dataset, product);
      (fallback.mappings || []).forEach((item) => {
        mapping[item.excel] = { field_code: item.standard || "", confidence: item.confidence || 0, reason: item.method || "确定性兜底" };
      });
    }
    const rows = [];
    for (const header of dataset.headers || []) {
      const suggestion = mapping[header] || { field_code: "", confidence: 0, reason: "没有建议" };
      const field = (product.fields || []).find((item) => item.code === suggestion.field_code);
      const row = {
        sourceColumn: header,
        suggestedFieldCode: field ? field.code : "",
        suggestedFieldName: field ? field.name : "",
        confidence: Number(suggestion.confidence) || 0,
        reason: String(suggestion.reason || "").slice(0, 500),
        method,
        required: field ? !!(field.required || field.requiredByRule) : false
      };
      rows.push(row);
      await query(
        `INSERT INTO hqla_field_suggestion
           (task_id, dataset_id, product_code, source_column, suggested_field_code, confidence, reason,
            method, skill_version, model, prompt_version, input_version, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, dataset.id, product.code, header, row.suggestedFieldCode, row.confidence, row.reason, method,
          meta.skill_version, meta.model, meta.prompt_version, nextVersion, nowText()]
      );
    }
    results.push({ datasetId: dataset.id, productCode: product.code, productName: product.name, rows, modelError });
  }
  if (!results.length) throw fail(400, "没有可识别字段的产品");
  await query(
    `UPDATE hqla_task
        SET input_version = ?, calc_status = 'not_run', current_run_id = NULL,
            review_status = '', updated_at = ?
      WHERE id = ?`,
    [nextVersion, nowText(), id]
  );
  return { inputVersion: nextVersion, datasets: results };
}

export async function listTaskFields(id, queryParams = {}) {
  const task = await getTask(id);
  const config = await snapshotConfig(task);
  if (!config) throw fail(400, "任务还没有可用的配置快照");
  const products = catalogProducts(config);
  const datasets = task.datasets || [];
  const dataset = queryParams.datasetId
    ? datasets.find((item) => item.id === String(queryParams.datasetId))
    : datasets[0];
  if (!dataset) throw fail(404, "数据集不存在");
  const productCodes = products.map((product) => product.code);
  if (!queryParams.productCode) {
    const rows = await query(
      `SELECT DISTINCT product_code FROM hqla_record
        WHERE task_id = ? AND dataset_id = ? AND product_code <> ''`,
      [id, dataset.id]
    );
    return { datasetId: dataset.id, datasetSheet: dataset.sheet, products: rows.map((row) => row.product_code) };
  }
  const product = products.find((item) => item.code === String(queryParams.productCode));
  if (!product) throw fail(404, "产品不存在");
  const suggestions = await query(
    "SELECT * FROM hqla_field_suggestion WHERE task_id = ? AND dataset_id = ? AND product_code = ?",
    [id, dataset.id, product.code]
  );
  const mappings = await query(
    "SELECT * FROM hqla_field_mapping WHERE task_id = ? AND dataset_id = ? AND product_code = ?",
    [id, dataset.id, product.code]
  );
  const suggestionMap = new Map(suggestions.map((row) => [row.source_column, row]));
  const mappingMap = new Map(mappings.map((row) => [row.source_column, row]));
  const fields = fieldMapOf(product);
  const rows = (dataset.headers || []).map((header) => {
    const suggestion = suggestionMap.get(header);
    const mapping = mappingMap.get(header);
    const fieldCode = mapping ? mapping.field_code : suggestion ? suggestion.suggested_field_code : "";
    const field = fields.get(fieldCode);
    return {
      sourceColumn: header,
      suggestedFieldCode: suggestion ? suggestion.suggested_field_code : "",
      suggestedFieldName: suggestion && fields.get(suggestion.suggested_field_code) ? fields.get(suggestion.suggested_field_code).name : "",
      confidence: suggestion && suggestion.confidence != null ? Number(suggestion.confidence) : null,
      reason: suggestion ? suggestion.reason || "" : "",
      fieldCode: mapping ? mapping.field_code : "",
      fieldName: field ? field.name : "",
      required: field ? !!(field.required || field.requiredByRule) : false,
      status: mapping ? mapping.status : "pending"
    };
  });
  const confirmedFields = new Set(mappings.filter((row) => row.field_code).map((row) => row.field_code));
  const missingRequired = (product.fields || [])
    .filter((field) => field.required || field.requiredByRule)
    .filter((field) => !confirmedFields.has(field.code))
    .map((field) => field.code);
  return {
    datasetId: dataset.id,
    datasetSheet: dataset.sheet,
    productCode: product.code,
    productName: product.name,
    rows,
    stats: {
      headers: rows.length,
      suggested: rows.filter((row) => row.suggestedFieldCode).length,
      confirmed: rows.filter((row) => row.fieldCode).length,
      missingRequired: missingRequired.length
    },
    missingRequired
  };
}

export async function confirmTaskFields(id, body = {}) {
  const task = await getTask(id);
  if (task.status === "archived") throw fail(400, "已归档任务不能修改字段对应");
  const config = await snapshotConfig(task);
  if (!config) throw fail(400, "任务还没有可用的配置快照");
  const datasets = task.datasets || [];
  const dataset = datasets.find((item) => item.id === String(body.datasetId || ""));
  if (!dataset) throw fail(404, "数据集不存在");
  const product = catalogProducts(config).find((item) => item.code === String(body.productCode || ""));
  if (!product) throw fail(404, "产品不存在");
  const fields = fieldMapOf(product);
  const headers = new Set(dataset.headers || []);
  const mappings = Array.isArray(body.mappings) ? body.mappings : [];
  const used = new Set();
  for (const item of mappings) {
    if (!item || !headers.has(String(item.sourceColumn || ""))) throw fail(400, "原始列不存在：" + (item && item.sourceColumn));
    const fieldCode = String(item.fieldCode || "");
    if (fieldCode && (!fields.has(fieldCode) || (fields.get(fieldCode).status || "ACTIVE") === "DISABLED")) {
      throw fail(400, "标准字段不存在或已停用：" + fieldCode);
    }
    if (fieldCode && used.has(fieldCode)) throw fail(400, "标准字段重复占用：" + fieldCode);
    if (fieldCode) used.add(fieldCode);
  }
  const nextVersion = (Number(task.inputVersion) || 1) + 1;
  const now = nowText();
  await query("DELETE FROM hqla_field_mapping WHERE task_id = ? AND dataset_id = ? AND product_code = ?", [id, dataset.id, product.code]);
  for (const item of mappings) {
    const fieldCode = String(item.fieldCode || "");
    if (!fieldCode) continue;
    const field = fields.get(fieldCode);
    await query(
      `INSERT INTO hqla_field_mapping
         (task_id, dataset_id, product_code, source_column, field_code, required, status,
          confirmed_by, confirmed_at, input_version)
       VALUES (?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?)`,
      [id, dataset.id, product.code, String(item.sourceColumn), fieldCode,
        field && (field.required || field.requiredByRule) ? 1 : 0,
        String(body.confirmedBy || "").slice(0, 64), now, nextVersion]
    );
  }
  const plain = {};
  mappings.forEach((item) => { if (item.fieldCode) plain[item.fieldCode] = item.sourceColumn; });
  const mappingRows = (dataset.headers || []).map((header) => {
    const hit = mappings.find((item) => item.sourceColumn === header && item.fieldCode);
    const field = hit ? fields.get(hit.fieldCode) : null;
    return {
      excel: header,
      standard: hit ? hit.fieldCode : "",
      standardName: field ? field.name : "",
      method: hit ? "人工确认" : "未匹配",
      confidence: hit ? 100 : 0,
      required: !!(field && (field.required || field.requiredByRule)),
      status: hit ? "已确认" : "不适用"
    };
  });
  const confirmedFields = new Set(Object.keys(plain));
  const missingRequired = (product.fields || [])
    .filter((field) => field.required || field.requiredByRule)
    .filter((field) => !confirmedFields.has(field.code))
    .map((field) => field.code);
  const stats = {
    headers: mappingRows.length,
    mapped: confirmedFields.size,
    confirmed: mappingRows.filter((row) => row.status === "已确认").length,
    pending: 0,
    missingRequired: missingRequired.length,
    notApplicable: mappingRows.filter((row) => row.status === "不适用").length
  };
  if (dataset.productCode && dataset.productCode === product.code) {
    await query(
      `UPDATE hqla_task_dataset
          SET product_code = ?, product_name = ?, mapping_json = ?, mapping_meta_json = ?,
              quality_json = NULL, input_version = ?
        WHERE task_id = ? AND dataset_id = ?`,
      [product.code, product.name, JSON.stringify(plain), JSON.stringify({ mappings: mappingRows, stats, missingRequired, productCode: product.code }), nextVersion, id, dataset.id]
    );
  } else if (!dataset.productCode) {
    await query(
      `UPDATE hqla_task_dataset
          SET mapping_json = ?, mapping_meta_json = ?, quality_json = NULL, input_version = ?
        WHERE task_id = ? AND dataset_id = ?`,
      [JSON.stringify(plain), JSON.stringify({ mappings: mappingRows, stats, missingRequired, productCode: product.code }), nextVersion, id, dataset.id]
    );
  }
  await query(
    `UPDATE hqla_task
        SET input_version = ?, calc_status = 'not_run', current_run_id = NULL,
            review_status = '', updated_at = ?
      WHERE id = ?`,
    [nextVersion, now, id]
  );
  return listTaskFields(id, { datasetId: dataset.id, productCode: product.code });
}

// ---------------------------------------------------------------- Phase 3：质量检查与快照计算

function amountCodes() {
  return ["amount", "book_value", "fair_value", "undrawn_amount"];
}

function issue(level, type, message, extra = {}) {
  return { level, type, message: String(message || "").slice(0, 500), ...extra };
}

function fieldMapOfProduct(product) {
  return new Map(((product && product.fields) || []).map((field) => [field.code, field]));
}

function dictionaryMapOf(config) {
  return new Map(((config && config.dictionaries) || []).map((dict) => [dict.code, dict]));
}

function rateIndexFrom(config) {
  const index = { ASSET: new Set(), INFLOW: new Set(), OUTFLOW: new Set() };
  ((config && config.tables) || []).forEach((table) => {
    const kind = table.kind || "";
    ((table.rows) || []).forEach((row) => {
      if (kind === "HQLA_HAIRCUT" && row.hqla_key) index.ASSET.add(String(row.hqla_key));
      if (kind === "CASH_INFLOW_RATE" && row.inflow_key) index.INFLOW.add(String(row.inflow_key));
      if (kind === "CASH_OUTFLOW_RATE" && row.outflow_key) index.OUTFLOW.add(String(row.outflow_key));
    });
  });
  return index;
}

function isNumericType(dataType) {
  return ["INTEGER", "DECIMAL", "NUMBER", "PERCENT", "CURRENCY"].includes(String(dataType || "").toUpperCase());
}

function recordValue(raw, source) {
  if (!source) return null;
  return raw ? raw[source] : null;
}

function checkRecordQuality(record, product, mapping, config, rateIndex) {
  const issues = [];
  const raw = record.raw || {};
  if (!record.product_code) {
    issues.push(issue("BLOCK", "PRODUCT_UNCONFIRMED", "记录尚未确认产品"));
  }
  if (!product) {
    issues.push(issue("BLOCK", "PRODUCT_UNKNOWN", "产品不在当前配置快照中：" + (record.product_code || "空")));
    return issues;
  }
  const fields = fieldMapOfProduct(product);
  const mapped = new Set(Object.keys(mapping || {}));
  const required = (product.fields || []).filter((field) => field.required || field.requiredByRule);
  required.forEach((field) => {
    if (!mapped.has(field.code)) {
      issues.push(issue("BLOCK", "FIELD_UNMAPPED", "必需字段未对应：" + field.name, { fieldCode: field.code }));
      return;
    }
    const value = recordValue(raw, mapping[field.code]);
    if (value == null || String(value).trim() === "") {
      issues.push(issue("BLOCK", "FIELD_MISSING", "必需字段为空：" + field.name, { fieldCode: field.code }));
    }
  });
  Object.entries(mapping || {}).forEach(([fieldCode, source]) => {
    const field = fields.get(fieldCode);
    if (!field) return;
    const value = recordValue(raw, source);
    if (value == null || String(value).trim() === "") return;
    const level = field.required || field.requiredByRule ? "BLOCK" : "WARN";
    if (isNumericType(field.dataType) && numericValue(value) == null) {
      issues.push(issue(level, "FIELD_TYPE", field.name + " 不是有效数值", { fieldCode }));
    }
    if (String(field.dataType || "").toUpperCase() === "DATE" && !/^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(String(value))) {
      issues.push(issue("WARN", "FIELD_TYPE", field.name + " 不是有效日期", { fieldCode }));
    }
    if (field.dictionary) {
      const dict = dictionaryMapOf(config).get(field.dictionary);
      if (dict) {
        const allowed = new Set((dict.items || []).filter((item) => item.status === "ACTIVE").map((item) => item.code));
        if (allowed.size && !allowed.has(String(value))) {
          issues.push(issue(level, "DICTIONARY_INVALID", field.name + " 取值不在字典 " + field.dictionary + " 中", { fieldCode }));
        }
      }
    }
  });
  const amountField = amountCodes().find((code) => mapping[code]);
  if (!amountField) {
    issues.push(issue("BLOCK", "AMOUNT_UNMAPPED", "没有对应金额字段"));
  } else {
    const value = recordValue(raw, mapping[amountField]);
    const number = numericValue(value);
    if (number == null) issues.push(issue("BLOCK", "AMOUNT_INVALID", "金额无法解析", { fieldCode: amountField }));
    else if (number < 0) issues.push(issue("WARN", "AMOUNT_NEGATIVE", "金额为负", { fieldCode: amountField }));
  }
  const side = String(product.side || "").toUpperCase();
  if (!["ASSET", "INFLOW", "OUTFLOW"].includes(side)) {
    issues.push(issue("BLOCK", "PRODUCT_SIDE", "产品侧别无效：" + side));
  } else if (!product.paramKey) {
    issues.push(issue("BLOCK", "RATE_KEY_MISSING", "产品没有参数键"));
  } else if (!rateIndex[side] || !rateIndex[side].has(String(product.paramKey))) {
    issues.push(issue("BLOCK", "RATE_MISSING", "当前参数表缺少 " + side + " 参数键 " + product.paramKey));
  }
  return issues;
}

function worstLevel(levels) {
  if (levels.includes("BLOCK")) return "BLOCK";
  if (levels.includes("WARN")) return "WARN";
  if (levels.includes("INFO")) return "INFO";
  return "PASS";
}

function summarizeQualityDataset(issues, recordCount) {
  const checks = [];
  const groups = [
    ["STRUCTURE", "数据结构", (item) => ["DATASET_HEADER", "DUPLICATE_HEADER", "PARSE_STATUS"].includes(item.type)],
    ["FIELDS", "字段完整性", (item) => ["PRODUCT_UNCONFIRMED", "PRODUCT_UNKNOWN", "FIELD_UNMAPPED", "FIELD_MISSING"].includes(item.type)],
    ["FORMAT", "字段格式", (item) => ["FIELD_TYPE", "DICTIONARY_INVALID"].includes(item.type)],
    ["AMOUNT", "金额", (item) => ["AMOUNT_UNMAPPED", "AMOUNT_INVALID", "AMOUNT_NEGATIVE"].includes(item.type)],
    ["BUSINESS", "业务主键", (item) => ["BUSINESS_ID_DUPLICATE"].includes(item.type)],
    ["REGULATORY", "监管参数", (item) => ["PRODUCT_SIDE", "RATE_KEY_MISSING", "RATE_MISSING"].includes(item.type)]
  ];
  groups.forEach(([key, label, match]) => {
    const list = issues.filter(match);
    if (!list.length) return;
    checks.push({
      key,
      type: label,
      detail: list.slice(0, 3).map((item) => item.message).join("；"),
      total: recordCount,
      failed: new Set(list.map((item) => item.recordId || item.record_id || "")).size || list.length,
      status: worstLevel(list.map((item) => item.level))
    });
  });
  const missingRequired = [...new Set(issues.filter((item) => ["FIELD_UNMAPPED", "FIELD_MISSING"].includes(item.type)).map((item) => item.fieldCode).filter(Boolean))];
  return {
    status: worstLevel(issues.map((item) => item.level)),
    checks,
    missingRequired
  };
}

export async function runTaskQuality(id, body = {}) {
  const task = await getTask(id);
  if (task.status === "archived") throw fail(400, "已归档任务不能执行质量检查");
  const config = await snapshotConfig(task);
  if (!config) throw fail(400, "任务还没有可用的配置快照");
  const products = catalogProducts(config);
  const productMap = productMapOf(products);
  const rateIndex = rateIndexFrom(config);
  const datasets = task.datasets || [];
  const recordRows = await query("SELECT * FROM hqla_record WHERE task_id = ? ORDER BY dataset_id, row_no, id", [id]);
  const recordsByDataset = new Map();
  recordRows.forEach((row) => {
    if (!recordsByDataset.has(row.dataset_id)) recordsByDataset.set(row.dataset_id, []);
    recordsByDataset.get(row.dataset_id).push({ ...row, raw: parseJson(row.raw_json, {}) });
  });
  const mappingRows = await query("SELECT * FROM hqla_field_mapping WHERE task_id = ?", [id]);
  const mappingByKey = new Map();
  mappingRows.forEach((row) => {
    const key = row.dataset_id + "|" + row.product_code;
    if (!mappingByKey.has(key)) mappingByKey.set(key, {});
    mappingByKey.get(key)[row.field_code] = row.source_column;
  });
  const runId = uid("Q");
  const startedAt = nowText();
  const inputVersion = Number(task.inputVersion) || 1;
  const allIssues = [];
  const datasetSummaries = [];
  const statusByRecord = new Map();
  for (const dataset of datasets) {
    const records = recordsByDataset.get(dataset.id) || [];
    const relevant = [];
    const headers = dataset.headers || [];
    if (!headers.length) relevant.push(issue("BLOCK", "DATASET_HEADER", "数据集没有表头", { recordId: "", rowNo: 0 }));
    const seenHeaders = new Set();
    headers.forEach((header) => {
      if (seenHeaders.has(header)) relevant.push(issue("WARN", "DUPLICATE_HEADER", "表头重复：" + header, { recordId: "", rowNo: 0 }));
      seenHeaders.add(header);
    });
    if ((dataset.parseStatus || "parsed") !== "parsed") {
      relevant.push(issue("BLOCK", "PARSE_STATUS", "数据集解析状态异常：" + (dataset.parseStatus || ""), { recordId: "", rowNo: 0 }));
    }
    const businessIds = new Map();
    records.forEach((record) => {
      const product = productMap.get(record.product_code);
      const mapping = mappingByKey.get(record.dataset_id + "|" + record.product_code) || {};
      const matches = checkRecordQuality(record, product, mapping, config, rateIndex);
      matches.forEach((item) => relevant.push({ ...item, recordId: record.record_id, rowNo: record.row_no }));
      if (product) {
        const source = mapping.business_id || (record.raw && record.raw.business_id ? "business_id" : "");
        const businessId = source ? String(record.raw[source] || "").trim() : "";
        if (businessId) {
          if (!businessIds.has(businessId)) businessIds.set(businessId, []);
          businessIds.get(businessId).push(record);
        }
      }
    });
    businessIds.forEach((group, businessId) => {
      if (group.length <= 1) return;
      group.forEach((record) => {
        relevant.push(issue("WARN", "BUSINESS_ID_DUPLICATE", "业务主键重复：" + businessId, {
          recordId: record.record_id, rowNo: record.row_no, fieldCode: "business_id"
        }));
      });
    });
    const summary = summarizeQualityDataset(relevant, records.length);
    datasetSummaries.push({ datasetId: dataset.id, sheet: dataset.sheet, records: records.length, ...summary });
    relevant.forEach((item) => allIssues.push({ ...item, datasetId: dataset.id, sheet: dataset.sheet, productCode: (records.find((record) => record.record_id === item.recordId) || {}).product_code || "" }));
    records.forEach((record) => {
      const levels = relevant.filter((item) => item.recordId === record.record_id).map((item) => item.level);
      statusByRecord.set(record.record_id, worstLevel(levels));
    });
  }
  await query(
    `INSERT INTO hqla_quality_run (id, task_id, input_version, status, summary_json, started_at, finished_at)
     VALUES (?, ?, ?, 'running', NULL, ?, '')`,
    [runId, id, inputVersion, startedAt]
  );
  for (let start = 0; start < allIssues.length; start += 200) {
    const chunk = allIssues.slice(start, start + 200);
    const values = [];
    const params = [];
    chunk.forEach((item) => {
      values.push("(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
      params.push(runId, id, item.datasetId || "", item.recordId || "", item.productCode || "",
        Number(item.rowNo) || 0, item.fieldCode || "", item.type || "", item.level || "WARN",
        item.message || "", "open", nowText());
    });
    await query(
      `INSERT INTO hqla_quality_issue
         (run_id, task_id, dataset_id, record_id, product_code, row_no, field_code, issue_type,
          level, message, status, created_at)
       VALUES ${values.join(", ")}`,
      params
    );
  }
  for (const [recordId, level] of statusByRecord.entries()) {
    await query("UPDATE hqla_record SET quality_status = ? WHERE task_id = ? AND record_id = ?", [level, id, recordId]);
  }
  for (const summary of datasetSummaries) {
    await query(
      "UPDATE hqla_task_dataset SET quality_json = ? WHERE task_id = ? AND dataset_id = ?",
      [JSON.stringify({ ...summary, runId, inputVersion, checkedAt: startedAt }), id, summary.datasetId]
    );
  }
  const levelSummary = { BLOCK: 0, WARN: 0, INFO: 0 };
  allIssues.forEach((item) => { levelSummary[item.level] = (levelSummary[item.level] || 0) + 1; });
  const byType = {};
  allIssues.forEach((item) => { byType[item.type] = (byType[item.type] || 0) + 1; });
  const summary = {
    total: recordRows.length,
    pass: recordRows.filter((row) => (statusByRecord.get(row.record_id) || "PASS") === "PASS").length,
    block: recordRows.filter((row) => statusByRecord.get(row.record_id) === "BLOCK").length,
    warn: recordRows.filter((row) => statusByRecord.get(row.record_id) === "WARN").length,
    info: recordRows.filter((row) => statusByRecord.get(row.record_id) === "INFO").length,
    issues: allIssues.length,
    byLevel: levelSummary,
    byType,
    hasBlock: allIssues.some((item) => item.level === "BLOCK"),
    hasWarn: allIssues.some((item) => item.level === "WARN"),
    datasets: datasetSummaries
  };
  await query(
    "UPDATE hqla_quality_run SET status = 'succeeded', summary_json = ?, finished_at = ? WHERE id = ?",
    [JSON.stringify(summary), nowText(), runId]
  );
  return {
    run: { id: runId, taskId: id, inputVersion, status: "succeeded", startedAt, finishedAt: nowText(), summary },
    summary,
    issues: allIssues.slice(0, 500)
  };
}

export async function listTaskQualityRuns(id) {
  const rows = await query("SELECT * FROM hqla_quality_run WHERE task_id = ? ORDER BY started_at DESC, id DESC", [id]);
  return rows.map((row) => ({
    id: row.id,
    inputVersion: Number(row.input_version) || 0,
    status: row.status,
    summary: parseJson(row.summary_json, null),
    startedAt: row.started_at,
    finishedAt: row.finished_at
  }));
}

export async function listTaskQualityIssues(id, queryParams = {}) {
  const runs = await listTaskQualityRuns(id);
  const runId = String(queryParams.runId || (runs[0] ? runs[0].id : ""));
  if (!runId) return { run: null, total: 0, rows: [] };
  const run = runs.find((item) => item.id === runId) || null;
  const where = ["task_id = ?", "run_id = ?"];
  const params = [id, runId];
  if (queryParams.level) { where.push("level = ?"); params.push(String(queryParams.level)); }
  if (queryParams.datasetId) { where.push("dataset_id = ?"); params.push(String(queryParams.datasetId)); }
  if (queryParams.status) { where.push("status = ?"); params.push(String(queryParams.status)); }
  if (queryParams.q) { where.push("message LIKE ?"); params.push("%" + String(queryParams.q) + "%"); }
  const page = Math.max(1, Number(queryParams.page) || 1);
  const pageSize = Math.min(200, Math.max(10, Number(queryParams.pageSize) || 50));
  const [countRows] = await query(`SELECT COUNT(*) AS n FROM hqla_quality_issue WHERE ${where.join(" AND ")}`, params);
  const rows = await query(
    `SELECT * FROM hqla_quality_issue WHERE ${where.join(" AND ")} ORDER BY level, dataset_id, row_no, id LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize]
  );
  return {
    run,
    total: Number(countRows && countRows.n) || 0,
    page,
    pageSize,
    rows: rows.map((row) => ({
      id: row.id,
      datasetId: row.dataset_id,
      recordId: row.record_id,
      productCode: row.product_code,
      rowNo: Number(row.row_no) || 0,
      fieldCode: row.field_code,
      issueType: row.issue_type,
      level: row.level,
      message: row.message,
      status: row.status
    }))
  };
}

export async function preflightTask(id, options = {}) {
  const task = await getTask(id);
  const allowPartial = options.allowPartial === true;
  const config = await snapshotConfig(task);
  const checks = [];
  const blocking = [];
  const warnings = [];
  const excluded = new Set();
  const push = (key, label, status, detail) => {
    checks.push({ key, label, status, detail });
    if (status === "BLOCK") blocking.push(detail);
    if (status === "WARN") warnings.push(detail);
  };
  push("input", "输入数据", task.datasets && task.datasets.length ? "PASS" : "BLOCK",
    task.datasets && task.datasets.length ? task.datasets.length + " 个数据集" : "还没有导入数据集");
  push("snapshot", "配置快照", config ? "PASS" : "BLOCK", config ? "快照可用" : "任务没有可用的配置快照");
  if (config) {
    push("snapshot-tables", "参数表", config.tables && config.tables.length ? "PASS" : "BLOCK",
      config.tables && config.tables.length ? config.tables.length + " 张参数表" : "快照缺少参数表");
    push("snapshot-params", "监管参数", config.params && config.params.length ? "PASS" : "WARN",
      config.params && config.params.length ? config.params.length + " 个参数" : "快照没有监管参数，使用引擎默认值");
  }
  const records = await query(
    "SELECT record_id, dataset_id, product_code, recognition_status FROM hqla_record WHERE task_id = ?",
    [id]
  );
  const unconfirmed = records.filter((row) => !row.product_code || row.recognition_status !== "confirmed");
  if (unconfirmed.length) {
    if (allowPartial) {
      unconfirmed.forEach((row) => excluded.add(row.record_id));
      push("products", "产品确认", "WARN", unconfirmed.length + " 条记录未确认，按部分计算排除");
    } else {
      push("products", "产品确认", "BLOCK", unconfirmed.length + " 条记录未确认产品");
    }
  } else {
    push("products", "产品确认", "PASS", records.length + " 条记录已确认产品");
  }
  const productMap = catalogProducts(config).reduce((map, product) => map.set(product.code, product), new Map());
  const missingProducts = [...new Set(records.map((row) => row.product_code).filter(Boolean))].filter((code) => !productMap.has(code));
  push("product-catalog", "产品目录", missingProducts.length ? "BLOCK" : "PASS",
    missingProducts.length ? "以下产品不在快照中：" + missingProducts.join("、") : "记录产品均在快照中");
  const mappings = await query("SELECT DISTINCT product_code, field_code FROM hqla_field_mapping WHERE task_id = ?", [id]);
  const mappedByProduct = new Map();
  mappings.forEach((row) => {
    if (!mappedByProduct.has(row.product_code)) mappedByProduct.set(row.product_code, new Set());
    mappedByProduct.get(row.product_code).add(row.field_code);
  });
  const missingFields = [];
  [...new Set(records.map((row) => row.product_code).filter(Boolean))].forEach((productCode) => {
    const product = productMap.get(productCode);
    if (!product) return;
    const mapped = mappedByProduct.get(productCode) || new Set();
    (product.fields || []).filter((field) => field.required || field.requiredByRule).forEach((field) => {
      if (!mapped.has(field.code)) missingFields.push(productCode + ":" + field.name);
    });
  });
  push("fields", "字段对应", missingFields.length ? "BLOCK" : "PASS",
    missingFields.length ? "缺少必需字段对应：" + missingFields.slice(0, 8).join("、") : "必需字段已对应");
  const qualityRuns = await listTaskQualityRuns(id);
  const latestQuality = qualityRuns[0] || null;
  if (!latestQuality) {
    push("quality", "质量检查", "BLOCK", "还没有执行质量检查");
  } else if (Number(latestQuality.inputVersion) !== (Number(task.inputVersion) || 1)) {
    push("quality", "质量检查", "BLOCK", "质量检查结果不是当前输入版本，请重新检查");
  } else if (latestQuality.summary && latestQuality.summary.hasBlock && !allowPartial) {
    push("quality", "质量检查", "BLOCK", "存在 BLOCK 问题，请先处理或勾选部分计算");
  } else {
    push("quality", "质量检查", "PASS", "当前输入版本的质量检查已完成");
    if (allowPartial && latestQuality.summary && latestQuality.summary.hasBlock) {
      const issues = await query(
        "SELECT DISTINCT record_id FROM hqla_quality_issue WHERE task_id = ? AND run_id = ? AND level = 'BLOCK' AND record_id <> ''",
        [id, latestQuality.id]
      );
      issues.forEach((row) => excluded.add(row.record_id));
    }
  }
  return {
    ok: blocking.length === 0,
    allowPartial,
    inputVersion: Number(task.inputVersion) || 1,
    checks,
    blocking,
    warnings,
    excludedRecordIds: [...excluded],
    latestQualityRun: latestQuality
  };
}

export async function computeTaskRun(id, body = {}) {
  const allowPartial = body.allowPartial === true;
  const preflight = await preflightTask(id, { allowPartial });
  if (!preflight.ok) throw fail(400, "计算前检查未通过：" + preflight.blocking.join("；"));
  const task = await getTask(id);
  if (task.status === "archived") throw fail(400, "已归档任务不能重新计算");
  const config = await snapshotConfig(task);
  const products = catalogProducts(config);
  const productMap = productMapOf(products);
  const excluded = new Set(preflight.excludedRecordIds || []);
  const records = await query("SELECT * FROM hqla_record WHERE task_id = ? ORDER BY dataset_id, row_no, id", [id]);
  const mappings = await query("SELECT * FROM hqla_field_mapping WHERE task_id = ?", [id]);
  const mappingByKey = new Map();
  mappings.forEach((row) => {
    const key = row.dataset_id + "|" + row.product_code;
    if (!mappingByKey.has(key)) mappingByKey.set(key, {});
    mappingByKey.get(key)[row.field_code] = row.source_column;
  });
  const datasetsById = new Map((task.datasets || []).map((dataset) => [dataset.id, dataset]));
  const groups = new Map();
  let eligible = 0;
  records.forEach((record) => {
    if (excluded.has(record.record_id)) return;
    const product = productMap.get(record.product_code);
    if (!product) return;
    const mapping = mappingByKey.get(record.dataset_id + "|" + record.product_code) || {};
    const raw = parseJson(record.raw_json, {});
    const normalized = {
      record_id: record.record_id,
      dataset_id: record.dataset_id,
      business_id: mapping.business_id ? raw[mapping.business_id] : (raw.business_id || ""),
      _line: record.row_no
    };
    Object.entries(mapping).forEach(([fieldCode, source]) => {
      normalized[fieldCode] = raw[source];
    });
    const key = record.dataset_id + "|" + record.product_code;
    if (!groups.has(key)) {
      const dataset = datasetsById.get(record.dataset_id) || {};
      groups.set(key, {
        id: key.replace("|", "::"),
        sheet: (dataset.sheet || record.dataset_id) + " · " + product.name,
        productCode: product.code,
        productName: product.name,
        mapping: {},
        rows: []
      });
    }
    groups.get(key).rows.push(normalized);
    eligible += 1;
  });
  if (!groups.size) throw fail(400, "没有可参与计算的记录");
  const computed = await callFlask("/api/hqla/lcr-compute", {
    task: { id, datasets: [...groups.values()] },
    products,
    tables: (config && config.tables) || [],
    params: (config && config.params) || []
  });
  const [maxRows] = await query("SELECT COALESCE(MAX(run_no), 0) AS maxNo FROM hqla_task_run WHERE task_id = ?", [id]);
  const runNo = (Number(maxRows && maxRows.maxNo) || 0) + 1;
  const runId = uid("R");
  const startedAt = nowText();
  const status = computed.stats.exceptions
    ? (computed.stats.success ? "partial_failed" : "failed")
    : "succeeded";
  const excludedCount = excluded.size;
  const stats = {
    ...computed.stats,
    eligible,
    excluded: excludedCount,
    qualityRunId: preflight.latestQualityRun ? preflight.latestQualityRun.id : "",
    qualityInputVersion: preflight.latestQualityRun ? preflight.latestQualityRun.inputVersion : null
  };
  await query(
    `INSERT INTO hqla_task_run
       (id, task_id, run_no, snapshot_id, input_version, engine_version, status, started_at,
        finished_at, metrics_json, stats_json, exception_count, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [runId, id, runNo, task.snapshotId || "", Number(task.inputVersion) || 1,
      (config && config.engineVersion) || "lcr-engine-v1", status, startedAt, nowText(),
      JSON.stringify({ ...(computed.metrics || {}), lcr: computed.lcr }), JSON.stringify(stats), Number(computed.stats.exceptions) || 0,
      String(body.actor || "").slice(0, 64)]
  );
  const details = Array.isArray(computed.rows) ? computed.rows : [];
  for (let start = 0; start < details.length; start += 100) {
    const chunk = details.slice(start, start + 100);
    const values = [];
    const params = [];
    chunk.forEach((row) => {
      const datasetId = String(row.datasetId || "").split("::")[0];
      values.push("(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
      params.push(runId, id, datasetId, row.recordId || "", row.productCode || "", row.productName || "",
        row.side || "", row.businessId || "", row.amount == null ? null : Number(row.amount),
        row.rateKey || "", row.rate == null ? null : Number(row.rate), row.contribution == null ? null : Number(row.contribution),
        row.level || "", row.category || "", "success", "", JSON.stringify(row));
    });
    await query(
      `INSERT INTO hqla_result_detail
         (run_id, task_id, dataset_id, record_id, product_code, product_name, side, business_id,
          raw_amount, rate_key, rate, amount, level, category, status, message, detail_json)
       VALUES ${values.join(", ")}`,
      params
    );
  }
  const exceptions = Array.isArray(computed.exceptions) ? computed.exceptions : [];
  for (let start = 0; start < exceptions.length; start += 100) {
    const chunk = exceptions.slice(start, start + 100);
    const values = [];
    const params = [];
    chunk.forEach((row) => {
      const datasetId = String(row.datasetId || "").split("::")[0];
      values.push("(?, ?, ?, ?, ?, ?, 'WARN', 'CALC', ?, ?, 'open')");
      params.push(runId, id, datasetId, row.recordId || "", row.productCode || "", String(row.reason || "").slice(0, 500), JSON.stringify(row));
    });
    await query(
      `INSERT INTO hqla_calculation_exception
         (run_id, task_id, dataset_id, record_id, product_code, level, code, message, detail_json, status)
       VALUES ${values.join(", ")}`,
      params
    );
  }
  const metrics = computed.metrics || {};
  const metricRows = [
    ["lcr", "流动性覆盖率", computed.lcr, "%"],
    ["hqla", "HQLA", metrics.hqla, "金额"],
    ["hqlaBeforeCaps", "上限调整前 HQLA", metrics.hqlaBeforeCaps, "金额"],
    ["level1", "Level 1", metrics.level1, "金额"],
    ["level2a", "Level 2A", metrics.level2a, "金额"],
    ["level2b", "Level 2B", metrics.level2b, "金额"],
    ["inflow", "现金流入", metrics.inflow, "金额"],
    ["recognizedInflow", "认可现金流入", metrics.recognizedInflow, "金额"],
    ["outflow", "现金流出", metrics.outflow, "金额"],
    ["netOutflow", "净现金流出", metrics.netOutflow, "金额"]
  ];
  for (const [key, label, value, unit] of metricRows) {
    await query(
      "INSERT INTO hqla_result_summary (run_id, task_id, metric_key, metric_name, value, unit, detail_json) VALUES (?, ?, ?, ?, ?, ?, NULL)",
      [runId, id, key, label, value == null ? null : Number(value), unit]
    );
  }
  const summary = {
    ...(task.summary || {}),
    calculation: computed,
    stats,
    metrics: computed.metrics,
    lcr: computed.lcr,
    calculatedAt: computed.runAt,
    runId,
    runNo,
    inputVersion: Number(task.inputVersion) || 1,
    excluded: excludedCount
  };
  await query(
    `UPDATE hqla_task
        SET current_run_id = ?, calc_status = ?, status = 'review_pending', step = ?,
            progress = 90, review_status = 'pending', summary = ?, run_at = ?, updated_at = ?
      WHERE id = ?`,
    [runId, status, Math.max(6, Number(task.step) || 6), JSON.stringify(summary), computed.runAt, nowText(), id]
  );
  if (task.rwaTaskSubId) {
    await query(
      `UPDATE rwa_task_sub
          SET progress = 90, review_status = 'pending', result_summary = ?, updated_at = ?
        WHERE id = ?`,
      [JSON.stringify({ lcr: computed.lcr, metrics: computed.metrics, runId, calculatedAt: computed.runAt, stats }), nowText(), task.rwaTaskSubId]
    );
  }
  await writeTaskAudit(id, "compute", "hqla_task_run", runId, { status, lcr: computed.lcr, exceptionCount: exceptions.length }, body.actor || "");
  return {
    run: {
      id: runId, runNo, status, inputVersion: Number(task.inputVersion) || 1,
      snapshotId: task.snapshotId || "", engineVersion: (config && config.engineVersion) || "lcr-engine-v1",
      startedAt, finishedAt: nowText(), metrics: { ...(computed.metrics || {}), lcr: computed.lcr }, stats, exceptionCount: exceptions.length
    },
    result: computed,
    excluded: excludedCount,
    preflight
  };
}

async function writeTaskAudit(taskId, action, objectType, objectId, detail, actor) {
  await query(
    `INSERT INTO hqla_audit_log (task_id, action, object_type, object_id, detail_json, actor, at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [taskId, action, objectType, objectId || "", JSON.stringify(detail || {}), actor || "", nowText()]
  );
}

export async function listTaskAudit(id) {
  const rows = await query("SELECT * FROM hqla_audit_log WHERE task_id = ? ORDER BY id DESC", [id]);
  return rows.map((row) => ({
    id: row.id, action: row.action, objectType: row.object_type, objectId: row.object_id,
    detail: parseJson(row.detail_json, {}), actor: row.actor || "", at: row.at
  }));
}

export async function listTaskRuns(id) {
  const rows = await query("SELECT * FROM hqla_task_run WHERE task_id = ? ORDER BY run_no DESC", [id]);
  return rows.map((row) => ({
    id: row.id,
    runNo: Number(row.run_no) || 0,
    snapshotId: row.snapshot_id || "",
    inputVersion: Number(row.input_version) || 0,
    engineVersion: row.engine_version || "",
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    metrics: parseJson(row.metrics_json, null),
    stats: parseJson(row.stats_json, null),
    exceptionCount: Number(row.exception_count) || 0,
    createdBy: row.created_by || ""
  }));
}

export async function getTaskRunDetail(id, runId) {
  const rows = await query("SELECT * FROM hqla_task_run WHERE task_id = ? AND id = ?", [id, runId]);
  if (!rows.length) throw fail(404, "计算批次不存在");
  const summary = await query("SELECT * FROM hqla_result_summary WHERE run_id = ? AND task_id = ? ORDER BY id", [runId, id]);
  return {
    run: {
      id: rows[0].id, runNo: Number(rows[0].run_no) || 0, snapshotId: rows[0].snapshot_id || "",
      inputVersion: Number(rows[0].input_version) || 0, engineVersion: rows[0].engine_version || "",
      status: rows[0].status, startedAt: rows[0].started_at, finishedAt: rows[0].finished_at,
      metrics: parseJson(rows[0].metrics_json, null), stats: parseJson(rows[0].stats_json, null),
      exceptionCount: Number(rows[0].exception_count) || 0
    },
    summary: summary.map((row) => ({
      key: row.metric_key, name: row.metric_name,
      value: row.value == null ? null : Number(row.value), unit: row.unit || ""
    }))
  };
}

export async function listTaskRunResults(id, runId, queryParams = {}) {
  const where = ["task_id = ?", "run_id = ?"];
  const params = [id, runId];
  if (queryParams.productCode) { where.push("product_code = ?"); params.push(String(queryParams.productCode)); }
  if (queryParams.datasetId) { where.push("dataset_id = ?"); params.push(String(queryParams.datasetId)); }
  if (queryParams.status) { where.push("status = ?"); params.push(String(queryParams.status)); }
  if (queryParams.q) { where.push("(business_id LIKE ? OR record_id LIKE ?)"); const word = "%" + String(queryParams.q) + "%"; params.push(word, word); }
  const page = Math.max(1, Number(queryParams.page) || 1);
  const pageSize = Math.min(500, Math.max(10, Number(queryParams.pageSize) || 100));
  const [countRows] = await query(`SELECT COUNT(*) AS n FROM hqla_result_detail WHERE ${where.join(" AND ")}`, params);
  const rows = await query(
    `SELECT * FROM hqla_result_detail WHERE ${where.join(" AND ")} ORDER BY dataset_id, id LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize]
  );
  return {
    total: Number(countRows && countRows.n) || 0, page, pageSize,
    rows: rows.map((row) => ({
      id: row.id, datasetId: row.dataset_id, recordId: row.record_id,
      productCode: row.product_code, productName: row.product_name, side: row.side,
      businessId: row.business_id, rawAmount: row.raw_amount == null ? null : Number(row.raw_amount),
      rateKey: row.rate_key, rate: row.rate == null ? null : Number(row.rate),
      amount: row.amount == null ? null : Number(row.amount), level: row.level,
      category: row.category, status: row.status, message: row.message,
      detail: parseJson(row.detail_json, null)
    }))
  };
}

export async function listTaskRunExceptions(id, runId, queryParams = {}) {
  const where = ["task_id = ?", "run_id = ?"];
  const params = [id, runId];
  if (queryParams.level) { where.push("level = ?"); params.push(String(queryParams.level)); }
  if (queryParams.productCode) { where.push("product_code = ?"); params.push(String(queryParams.productCode)); }
  if (queryParams.q) { where.push("message LIKE ?"); params.push("%" + String(queryParams.q) + "%"); }
  const page = Math.max(1, Number(queryParams.page) || 1);
  const pageSize = Math.min(500, Math.max(10, Number(queryParams.pageSize) || 100));
  const [countRows] = await query(`SELECT COUNT(*) AS n FROM hqla_calculation_exception WHERE ${where.join(" AND ")}`, params);
  const rows = await query(
    `SELECT * FROM hqla_calculation_exception WHERE ${where.join(" AND ")} ORDER BY dataset_id, id LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize]
  );
  return {
    total: Number(countRows && countRows.n) || 0, page, pageSize,
    rows: rows.map((row) => ({
      id: row.id, datasetId: row.dataset_id, recordId: row.record_id,
      productCode: row.product_code, level: row.level, code: row.code,
      message: row.message, status: row.status, detail: parseJson(row.detail_json, null)
    }))
  };
}

export async function exportTaskRunWorkbook(id, runId) {
  const task = await getTask(id);
  const runRows = await query("SELECT * FROM hqla_task_run WHERE task_id = ? AND id = ?", [id, runId]);
  if (!runRows.length) throw fail(404, "计算批次不存在");
  const runRow = runRows[0];
  const metrics = parseJson(runRow.metrics_json, {});
  const stats = parseJson(runRow.stats_json, {});
  const [summaryRows, details, exceptions, reviewRows, snapshotRows] = await Promise.all([
    query("SELECT * FROM hqla_result_summary WHERE task_id = ? AND run_id = ? ORDER BY id", [id, runId]),
    query("SELECT * FROM hqla_result_detail WHERE task_id = ? AND run_id = ? ORDER BY dataset_id, id", [id, runId]),
    query("SELECT * FROM hqla_calculation_exception WHERE task_id = ? AND run_id = ? ORDER BY dataset_id, id", [id, runId]),
    query("SELECT * FROM hqla_review WHERE task_id = ? AND run_id = ? ORDER BY reviewed_at DESC LIMIT 1", [id, runId]),
    runRow.snapshot_id ? query("SELECT * FROM hqla_snapshot WHERE id = ?", [runRow.snapshot_id]) : Promise.resolve([])
  ]);
  const snapshot = snapshotRows.length ? parseJson(snapshotRows[0].config_json, {}) : null;
  let qualityRun = null;
  let qualityIssues = [];
  const qualityRunId = stats.qualityRunId || "";
  if (qualityRunId) {
    const rows = await query("SELECT * FROM hqla_quality_run WHERE task_id = ? AND id = ?", [id, qualityRunId]);
    if (rows.length) qualityRun = rows[0];
  } else {
    const rows = await query("SELECT * FROM hqla_quality_run WHERE task_id = ? ORDER BY started_at DESC, id DESC LIMIT 1", [id]);
    if (rows.length) qualityRun = rows[0];
  }
  if (qualityRun) {
    qualityIssues = await query(
      "SELECT * FROM hqla_quality_issue WHERE task_id = ? AND run_id = ? ORDER BY level, dataset_id, row_no, id",
      [id, qualityRun.id]
    );
  }
  const qualitySummary = qualityRun ? parseJson(qualityRun.summary_json, null) : null;
  const datasets = new Map((task.datasets || []).map((dataset) => [dataset.id, dataset]));
  const review = reviewRows[0] || null;
  const col = (title, width = 14) => ({ title, width });
  const sheetRows = (rows) => rows.map((row) => row.map((value) => (value === undefined ? "" : value)));

  const cover = [
    ["任务编号", task.id],
    ["任务名称", task.name],
    ["主任务", task.rwaTask ? task.rwaTask.name : ""],
    ["流动性子任务", task.rwaTaskSub ? task.rwaTaskSub.name : ""],
    ["机构", task.institution],
    ["司法管辖区", task.rwaTask ? task.rwaTask.jurisdiction : (task.cfg && task.cfg.jurisdiction) || ""],
    ["监管规则版本", (task.cfg && task.cfg.ruleVersion) || ""],
    ["LCR 规则集", (task.cfg && task.cfg.lcrVersion) || ""],
    ["计量基准日", task.baseDate],
    ["配置快照 ID", runRow.snapshot_id || ""],
    ["快照哈希", snapshotRows.length ? snapshotRows[0].config_hash : ""],
    ["输入版本", Number(runRow.input_version) || 0],
    ["计算批次 ID", runRow.id],
    ["计算批次序号", Number(runRow.run_no) || 0],
    ["计算引擎版本", runRow.engine_version || ""],
    ["计算状态", runRow.status || ""],
    ["开始时间", runRow.started_at || ""],
    ["完成时间", runRow.finished_at || ""],
    ["记录总数", Number(stats.records) || 0],
    ["成功记录", Number(stats.success) || 0],
    ["异常记录", Number(stats.exceptions) || 0],
    ["参与计算记录", Number(stats.eligible) || 0],
    ["排除记录", Number(stats.excluded) || 0],
    ["复核状态", task.reviewStatus || (review ? review.status : "")],
    ["复核人", review ? review.reviewer : ""],
    ["复核时间", review ? review.reviewed_at : ""],
    ["导出时间", nowText()]
  ];

  const metricRows = summaryRows.length
    ? summaryRows.map((row) => [row.metric_key, row.metric_name, row.value == null ? "" : Number(row.value), row.unit || ""])
    : Object.entries(metrics).filter(([, value]) => typeof value === "number").map(([key, value]) => [key, key, value, "金额"]);

  const productGroups = new Map();
  function bucket(productCode, productName, side) {
    const key = productCode || "";
    if (!productGroups.has(key)) {
      productGroups.set(key, {
        code: key, name: productName || "", side: side || "",
        records: 0, amount: 0, contribution: 0, rateKey: "", rate: null, exceptions: 0
      });
    }
    return productGroups.get(key);
  }
  details.forEach((row) => {
    const group = bucket(row.product_code, row.product_name, row.side);
    group.records += 1;
    group.amount += Number(row.raw_amount) || 0;
    group.contribution += Number(row.amount) || 0;
    if (!group.rateKey) group.rateKey = row.rate_key || "";
    if (group.rate == null) group.rate = row.rate == null ? null : Number(row.rate);
  });
  exceptions.forEach((row) => {
    const group = bucket(row.product_code, "", "");
    group.exceptions += 1;
  });
  const productRows = [...productGroups.values()]
    .sort((a, b) => String(a.side).localeCompare(String(b.side)) || a.code.localeCompare(b.code))
    .map((group) => [group.code, group.name, group.side, group.records, group.amount, group.contribution, group.rateKey, group.rate, group.exceptions]);

  const detailRows = details.map((row) => [
    (datasets.get(row.dataset_id) || {}).sheet || row.dataset_id,
    row.record_id, row.product_code, row.product_name, row.side, row.business_id,
    row.raw_amount == null ? "" : Number(row.raw_amount), row.rate_key,
    row.rate == null ? "" : Number(row.rate), row.amount == null ? "" : Number(row.amount),
    row.level, row.category, row.status, row.message
  ]);

  const exceptionRows = exceptions.map((row) => [
    (datasets.get(row.dataset_id) || {}).sheet || row.dataset_id,
    row.record_id, row.product_code, row.level, row.code, row.message, row.status
  ]);

  const qualityIssueRows = qualityIssues.map((row) => [
    qualityRun.id,
    (datasets.get(row.dataset_id) || {}).sheet || row.dataset_id,
    row.record_id, row.product_code, Number(row.row_no) || 0,
    row.field_code, row.issue_type, row.level, row.message, row.status
  ]);

  const qualityConclusions = qualitySummary && Array.isArray(qualitySummary.datasets)
    ? qualitySummary.datasets.map((item) => [
      item.sheet || item.datasetId, Number(item.records) || 0, item.status,
      (item.missingRequired || []).join("、"),
      (item.checks || []).map((check) => check.type + "：" + check.status).join(" · ")
    ])
    : [];

  const datasetRows = (task.datasets || []).map((dataset) => [
    dataset.id, dataset.sheet, Number(dataset.rowCount) || 0, Number(dataset.columnCount) || 0,
    dataset.parseStatus || "", Number(dataset.inputVersion) || 0,
    dataset.productCode || "", dataset.level || "",
    dataset.quality ? dataset.quality.status : ""
  ]);

  const snapshotProducts = snapshot && Array.isArray(snapshot.products) ? snapshot.products : [];
  const productCatalogRows = snapshotProducts.map((product) => [
    product.code, product.name, product.side, product.paramKey || "",
    (product.fields || []).length, product.groupMode || "NONE"
  ]);

  const snapshotRowsSheet = [
    ["快照 ID", runRow.snapshot_id || ""],
    ["监管规则版本", snapshotRows.length ? snapshotRows[0].rule_version : ""],
    ["司法管辖区", snapshotRows.length ? snapshotRows[0].jurisdiction : ""],
    ["配置哈希", snapshotRows.length ? snapshotRows[0].config_hash : ""],
    ["生成时间", snapshotRows.length ? snapshotRows[0].created_at : ""],
    ["生成人", snapshotRows.length ? snapshotRows[0].created_by : ""],
    ["引擎版本", snapshot ? snapshot.engineVersion : ""],
    ["产品数量", snapshotProducts.length],
    ["参数表数量", snapshot && Array.isArray(snapshot.tables) ? snapshot.tables.length : 0],
    ["监管参数数量", snapshot && Array.isArray(snapshot.params) ? snapshot.params.length : 0],
    ["码值字典数量", snapshot && Array.isArray(snapshot.dictionaries) ? snapshot.dictionaries.length : 0]
  ];

  const sheets = [
    { name: "封面", freeze: 1, columns: [col("项目", 24), col("内容", 70)], rows: sheetRows(cover) },
    { name: "监管指标", freeze: 1, columns: [col("指标键", 24), col("指标名称", 30), col("数值", 18), col("单位", 10)], rows: sheetRows(metricRows) },
    { name: "产品维度", freeze: 1, columns: [col("产品编码", 20), col("产品名称", 30), col("侧别", 12), col("记录数", 10), col("原始金额合计", 18), col("计量贡献合计", 18), col("参数键", 30), col("系数", 10), col("异常数", 10)], rows: sheetRows(productRows) },
    { name: "逐笔结果", freeze: 1, columns: [col("数据集", 22), col("记录 ID", 20), col("产品编码", 18), col("产品名称", 28), col("侧别", 10), col("业务编号", 18), col("原始金额", 16), col("参数键", 30), col("系数", 10), col("计量贡献", 16), col("等级", 16), col("类别", 20), col("状态", 12), col("消息", 40)], rows: sheetRows(detailRows) },
    { name: "计算异常", freeze: 1, columns: [col("数据集", 22), col("记录 ID", 20), col("产品编码", 18), col("级别", 8), col("代码", 12), col("原因", 60), col("状态", 12)], rows: sheetRows(exceptionRows) },
    { name: "质量异常", freeze: 1, columns: [col("质量批次", 20), col("数据集", 22), col("记录 ID", 20), col("产品编码", 18), col("行号", 8), col("字段", 18), col("类型", 20), col("级别", 8), col("问题", 60), col("状态", 12)], rows: sheetRows(qualityIssueRows) },
    { name: "质量结论", freeze: 1, columns: [col("数据集", 22), col("记录数", 10), col("结果", 10), col("缺失必需字段", 40), col("检查项", 60)], rows: sheetRows(qualityConclusions) },
    { name: "数据集", freeze: 1, columns: [col("数据集 ID", 16), col("Sheet", 24), col("行数", 10), col("列数", 10), col("解析状态", 12), col("输入版本", 10), col("产品编码", 18), col("确认级别", 14), col("质量结论", 12)], rows: sheetRows(datasetRows) },
    { name: "配置快照", freeze: 1, columns: [col("项目", 24), col("内容", 70)], rows: sheetRows(snapshotRowsSheet) },
    { name: "适用产品", freeze: 1, columns: [col("产品编码", 20), col("产品名称", 30), col("侧别", 12), col("参数键", 30), col("字段数", 10), col("产品组模式", 14)], rows: sheetRows(productCatalogRows) }
  ];
  const stamp = (runRow.finished_at || nowText()).slice(0, 10);
  const safe = String(task.name || "LCR").replace(/[\\/:*?"<>|]/g, "_").slice(0, 60);
  return {
    buffer: Buffer.from(writeXlsx(sheets)),
    filename: `LCR底稿_${safe}_${runRow.run_no}_${stamp}.xlsx`
  };
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
