/**
 * 信用风险 RWA：任务工作台的主任务与暴露子任务。
 *
 * 主任务 = 一个季度的计量作业，创建时固定监管版本和机构。
 * 子任务挂主任务，每次由计量向导执行一次计量，完成后把批次归档回子任务。
 * 这里只读写库表，不计算权重、不跑工作簿。
 */

import { query } from "./db.js";

function pad(value) {
  return String(value).padStart(2, "0");
}

function nowText() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function uid(prefix) {
  return prefix + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase();
}

function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function dateText(value) {
  if (!value) return null;
  if (value instanceof Date) return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  return String(value).slice(0, 10);
}

function taskOut(row) {
  return {
    id: row.id,
    name: row.name,
    institution: row.institution || "",
    jurisdiction: row.jurisdiction || "",
    version: row.version || "",
    baseDate: dateText(row.base_date),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function subOut(row) {
  return {
    id: row.id,
    taskId: row.task_id,
    module: row.module === "liquidity" ? "liquidity" : "capital",
    name: row.name,
    exposureType: row.exposure_type || "",
    status: row.status,
    batchId: row.batch_id || null,
    batchName: row.batch_name || "",
    measureName: row.measure_name || "",
    ead: row.batch_ead == null ? null : Number(row.batch_ead),
    rwa: row.batch_rwa == null ? null : Number(row.batch_rwa),
    batchStatus: row.batch_status || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function decorate(task, subs) {
  const capital = subs.filter((item) => item.module !== "liquidity");
  const archived = capital.filter((item) => item.status === "archived").length;
  const status = !subs.length ? "draft" : capital.length && archived === capital.length ? "done" : "doing";
  const ead = capital.reduce((sum, item) => sum + (Number(item.ead) || 0), 0);
  const rwa = capital.reduce((sum, item) => sum + (Number(item.rwa) || 0), 0);
  return {
    ...task,
    subs,
    subCount: subs.length,
    capitalCount: capital.length,
    liquidityCount: subs.length - capital.length,
    archivedCount: archived,
    status,
    ead,
    rwa
  };
}

async function taskRow(id) {
  const rows = await query("SELECT * FROM rwa_task WHERE id = ?", [id]);
  if (!rows.length) throw fail(404, "主任务不存在");
  return rows[0];
}

async function subRows(taskId) {
  const rows = await query(
    `SELECT s.*, b.name AS measure_name, b.ead AS batch_ead, b.rwa AS batch_rwa, b.status AS batch_status
       FROM rwa_task_sub s
       LEFT JOIN measure_batch b ON b.id = s.batch_id
      WHERE s.task_id = ?
      ORDER BY s.created_at ASC, s.id ASC`,
    [taskId]
  );
  return rows.map(subOut);
}

export async function listRwaTasks() {
  const rows = await query("SELECT * FROM rwa_task ORDER BY updated_at DESC");
  const out = [];
  for (const row of rows) out.push(decorate(taskOut(row), await subRows(row.id)));
  return out;
}

export async function getRwaTask(id) {
  const row = await taskRow(id);
  return decorate(taskOut(row), await subRows(id));
}

export async function createRwaTask(body) {
  const name = String(body.name || "").trim();
  const jurisdiction = String(body.jurisdiction || "").trim().slice(0, 2);
  const version = String(body.version || "").trim().slice(0, 40);
  const institution = String(body.institution || "").trim().slice(0, 64);
  const baseDate = dateText(body.baseDate) || dateText(new Date());
  if (!name) throw fail(400, "请填写主任务名称");
  if (!jurisdiction) throw fail(400, "请选择司法管辖区");
  if (!version) throw fail(400, "请选择监管规则版本");
  if (!institution) throw fail(400, "请选择机构");
  const id = uid("RT");
  const now = nowText();
  await query(
    `INSERT INTO rwa_task (id, name, institution, jurisdiction, version, base_date, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, name.slice(0, 200), institution, jurisdiction, version, baseDate, now, now]
  );
  return getRwaTask(id);
}

export async function updateRwaTask(id, body) {
  const row = await taskRow(id);
  if (body.version !== undefined && String(body.version) !== row.version) {
    throw fail(400, "监管规则版本在创建主任务时固定，不能修改");
  }
  if (body.institution !== undefined && String(body.institution) !== row.institution) {
    throw fail(400, "机构在创建主任务时固定，不能修改");
  }
  if (body.jurisdiction !== undefined && String(body.jurisdiction) !== row.jurisdiction) {
    throw fail(400, "司法管辖区在创建主任务时固定，不能修改");
  }
  const fields = [];
  const params = [];
  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (!name) throw fail(400, "请填写主任务名称");
    fields.push("name = ?");
    params.push(name.slice(0, 200));
  }
  if (body.baseDate !== undefined) {
    const baseDate = dateText(body.baseDate);
    if (!baseDate) throw fail(400, "请填写计量基准日");
    fields.push("base_date = ?");
    params.push(baseDate);
  }
  fields.push("updated_at = ?");
  params.push(nowText());
  params.push(id);
  await query(`UPDATE rwa_task SET ${fields.join(", ")} WHERE id = ?`, params);
  return getRwaTask(id);
}

export async function deleteRwaTask(id) {
  await taskRow(id);
  await query("DELETE FROM rwa_task_sub WHERE task_id = ?", [id]);
  await query("DELETE FROM rwa_task WHERE id = ?", [id]);
  return { ok: true };
}

export async function createSubtask(taskId, body) {
  await taskRow(taskId);
  const name = String(body.name || "").trim();
  if (!name) throw fail(400, "请填写子任务名称");
  const module = body.module === "liquidity" ? "liquidity" : "capital";
  const id = uid("RS");
  const now = nowText();
  await query(
    `INSERT INTO rwa_task_sub (id, task_id, module, name, exposure_type, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'draft', ?, ?)`,
    [id, taskId, module, name.slice(0, 200), String(body.exposureType || "").trim().slice(0, 64), now, now]
  );
  await query("UPDATE rwa_task SET updated_at = ? WHERE id = ?", [now, taskId]);
  return getRwaTask(taskId);
}

export async function updateSubtask(taskId, subId, body) {
  await taskRow(taskId);
  const rows = await query("SELECT * FROM rwa_task_sub WHERE id = ? AND task_id = ?", [subId, taskId]);
  if (!rows.length) throw fail(404, "子任务不存在");
  const fields = [];
  const params = [];
  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (!name) throw fail(400, "请填写子任务名称");
    fields.push("name = ?");
    params.push(name.slice(0, 200));
  }
  if (body.exposureType !== undefined) {
    fields.push("exposure_type = ?");
    params.push(String(body.exposureType).trim().slice(0, 64));
  }
  fields.push("updated_at = ?");
  params.push(nowText());
  params.push(subId, taskId);
  await query(`UPDATE rwa_task_sub SET ${fields.join(", ")} WHERE id = ? AND task_id = ?`, params);
  return getRwaTask(taskId);
}

export async function deleteSubtask(taskId, subId) {
  await taskRow(taskId);
  await query("DELETE FROM rwa_task_sub WHERE id = ? AND task_id = ?", [subId, taskId]);
  await query("UPDATE rwa_task SET updated_at = ? WHERE id = ?", [nowText(), taskId]);
  return getRwaTask(taskId);
}

export async function archiveSubtask(taskId, subId, body) {
  const task = await taskRow(taskId);
  const rows = await query("SELECT * FROM rwa_task_sub WHERE id = ? AND task_id = ?", [subId, taskId]);
  if (!rows.length) throw fail(404, "子任务不存在");
  const batchId = String(body.batchId || "").trim();
  if (!batchId) throw fail(400, "请提供要归档的计量批次");
  const batches = await query("SELECT * FROM measure_batch WHERE id = ?", [batchId]);
  if (!batches.length) throw fail(404, "计量批次不存在");
  const batch = batches[0];
  if (batch.version !== task.version) throw fail(400, "计量批次的监管规则版本和主任务不一致");
  if (batch.jurisdiction !== task.jurisdiction) throw fail(400, "计量批次的司法管辖区和主任务不一致");
  if (batch.institution !== task.institution) throw fail(400, "计量批次的机构和主任务不一致");
  const now = nowText();
  await query(
    `UPDATE rwa_task_sub
        SET status = 'archived', batch_id = ?, batch_name = ?, updated_at = ?
      WHERE id = ? AND task_id = ?`,
    [batch.id, batch.name, now, subId, taskId]
  );
  await query("UPDATE rwa_task SET updated_at = ? WHERE id = ?", [now, taskId]);
  return getRwaTask(taskId);
}
