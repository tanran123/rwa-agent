/**
 * 信用风险 RWA：任务工作台的主任务与暴露子任务。
 *
 * 主任务 = 一个季度的计量作业，创建时固定监管版本和机构。
 * 子任务挂主任务，每次由计量向导执行一次计量，完成后把批次归档回子任务。
 * 这里只读写库表，不计算权重、不跑工作簿。
 */

import { query } from "./db.js";
import { readCrmConfig } from "./crmConfig.js";
import { readEadConfig } from "./eadConfig.js";
import { deleteTask as deleteHqlaTask } from "./hqla.js";
import { listLiquidityProducts, liquidityParams } from "./liquidity.js";
import { configProducts, versionRuleDocuments } from "./productStandard.js";
import { resolveVersionRef } from "./ruleVersion.js";
import { latestPublishedSnapshot } from "./ruleGovernance.js";

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

function taskOut(row) {
  return {
    id: row.id,
    name: row.name,
    institution: row.institution || "",
    jurisdiction: row.jurisdiction || "",
    version: row.version || "",
    ruleVersionId: row.rule_version_id || "",
    snapshotId: row.snapshot_id || "",
    baseDate: dateText(row.base_date),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function subOut(row) {
  const summary = parseJson(row.result_summary, null) || parseJson(row.hqla_summary, null) || null;
  const calculation = summary && summary.calculation ? summary.calculation : summary;
  return {
    id: row.id,
    taskId: row.task_id,
    module: row.module === "liquidity" ? "liquidity" : "capital",
    name: row.name,
    exposureType: row.exposure_type || "",
    status: row.status,
    batchId: row.batch_id || null,
    batchName: row.batch_name || "",
    hqlaTaskId: row.hqla_task_id || null,
    progress: row.hqla_progress == null ? Number(row.progress) || 0 : Number(row.hqla_progress),
    exceptionCount: calculation && calculation.stats ? Number(calculation.stats.exceptions) || 0 : 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function decorate(task, subs) {
  const capital = subs.filter((item) => item.module !== "liquidity");
  const liquidity = subs.filter((item) => item.module === "liquidity");
  const done = new Set(["archived", "done"]);
  const archived = capital.filter((item) => done.has(item.status)).length;
  const liquidityArchived = liquidity.filter((item) => done.has(item.status)).length;
  const status = !subs.length ? "draft" : subs.every((item) => done.has(item.status)) ? "done" : "doing";
  return {
    ...task,
    subs,
    subCount: subs.length,
    capitalCount: capital.length,
    liquidityCount: liquidity.length,
    liquidityArchived: liquidityArchived,
    archivedCount: archived,
    status
  };
}

async function taskRow(id) {
  const rows = await query("SELECT * FROM rwa_task WHERE id = ?", [id]);
  if (!rows.length) throw fail(404, "主任务不存在");
  return rows[0];
}

async function subRows(taskId) {
  const rows = await query(
    `SELECT s.*, b.name AS batch_name,
            h.progress AS hqla_progress, h.summary AS hqla_summary
       FROM rwa_task_sub s
       LEFT JOIN measure_batch b ON b.id = s.batch_id
       LEFT JOIN hqla_task h ON h.id = s.hqla_task_id
      WHERE s.task_id = ?
      ORDER BY s.created_at ASC, s.id ASC`,
    [taskId]
  );
  return rows.map(subOut);
}

export async function listRwaTasks(options = {}) {
  const page = Number(options.page) || 0;
  const pageSize = Math.min(100, Math.max(1, Number(options.pageSize) || 20));
  const where = [];
  const params = [];
  const q = String(options.q || "").trim();
  if (q) {
    where.push("CONCAT_WS(' ', t.name, t.id, t.version, t.institution, t.jurisdiction, t.base_date) LIKE ?");
    params.push("%" + q + "%");
  }
  if (options.jurisdiction) { where.push("t.jurisdiction = ?"); params.push(String(options.jurisdiction)); }
  if (options.version) { where.push("t.version = ?"); params.push(String(options.version)); }
  if (options.institution) { where.push("t.institution = ?"); params.push(String(options.institution)); }
  if (options.from) { where.push("t.base_date >= ?"); params.push(String(options.from)); }
  if (options.to) { where.push("t.base_date <= ?"); params.push(String(options.to)); }
  if (options.status === "draft") {
    where.push("NOT EXISTS (SELECT 1 FROM rwa_task_sub s WHERE s.task_id = t.id)");
  } else if (options.status === "done") {
    where.push("EXISTS (SELECT 1 FROM rwa_task_sub s WHERE s.task_id = t.id)");
    where.push("NOT EXISTS (SELECT 1 FROM rwa_task_sub s WHERE s.task_id = t.id AND s.status NOT IN ('archived', 'done'))");
  } else if (options.status === "doing") {
    where.push("EXISTS (SELECT 1 FROM rwa_task_sub s WHERE s.task_id = t.id AND s.status NOT IN ('archived', 'done'))");
  }
  const clause = where.length ? " WHERE " + where.join(" AND ") : "";
  const order = " ORDER BY t.base_date DESC, t.created_at DESC, t.id DESC";
  if (!page) {
    const rows = await query("SELECT t.* FROM rwa_task t" + clause + order, params);
    const out = [];
    for (const row of rows) out.push(decorate(taskOut(row), await subRows(row.id)));
    return out;
  }
  const countRows = await query("SELECT COUNT(*) AS n FROM rwa_task t" + clause, params);
  const rows = await query(
    "SELECT t.* FROM rwa_task t" + clause + order + " LIMIT ? OFFSET ?",
    params.concat([pageSize, (page - 1) * pageSize])
  );
  const out = [];
  for (const row of rows) out.push(decorate(taskOut(row), await subRows(row.id)));
  return { rows: out, total: Number(countRows[0].n) || 0, page, pageSize };
}

export async function getRwaTask(id) {
  const row = await taskRow(id);
  return decorate(taskOut(row), await subRows(id));
}


export async function readRwaTaskReadiness(version, jurisdiction = "") {
  const ruleVersion = String(version || "").trim();
  if (!ruleVersion) {
    return { ok: false, version: ruleVersion, jurisdiction, issues: ["缺少监管规则版本"] };
  }
  const versionId = await resolveVersionRef(ruleVersion, jurisdiction);
  const versionRows = versionId ? await query("SELECT * FROM rule_version WHERE id = ?", [versionId]) : [];
  const versionRow = versionRows[0] || null;
  const published = !!versionRow && versionRow.status === "published";
  const snapshot = versionId ? await latestPublishedSnapshot(versionId) : null;
  const [products, docs, ead, crm, paramRows, listRows] = await Promise.all([
    configProducts(ruleVersion),
    versionRuleDocuments(ruleVersion),
    readEadConfig({ version: ruleVersion, jurisdiction }),
    readCrmConfig({ version: ruleVersion, jurisdiction }),
    versionId
      ? query("SELECT COUNT(*) AS n FROM rule_parameter_table WHERE rule_version_id = ? OR rule_version_id = ''", [versionId])
      : query("SELECT COUNT(*) AS n FROM rule_parameter_table WHERE jurisdiction = ?", [jurisdiction]),
    versionId
      ? query("SELECT COUNT(*) AS n FROM rule_list WHERE rule_version_id = ? OR rule_version_id = ''", [versionId])
      : query("SELECT COUNT(*) AS n FROM rule_list WHERE jurisdiction = ?", [jurisdiction])
  ]);
  let catalogue = { products: [] };
  let liquidityParamData = { params: [], tables: [], lists: [] };
  try {
    catalogue = await listLiquidityProducts({ jurisdiction, version: ruleVersion });
  } catch (err) {
    catalogue = { products: [] };
  }
  try {
    liquidityParamData = await liquidityParams({ jurisdiction, version: ruleVersion });
  } catch (err) {
    liquidityParamData = { params: [], tables: [], lists: [] };
  }
  const fieldCount = products.reduce((sum, item) => sum + ((item.fields || []).length), 0);
  const usableLiquidity = (catalogue.products || []).filter(
    (product) => product.status === "LIVE" && product.completeness && product.completeness.score >= 100
  );
  const crmNeeded = (crm.products || []).filter((product) => product.needed);
  const crmBound = (product) => ["crm_type", "crm_value", "crm_weight"].some((attr) =>
    (product.slotColumns && product.slotColumns[attr] ? product.slotColumns[attr] : [])
      .slice(0, product.maxSlots || 1)
      .some((value) => String(value || "").trim())
  );
  const crmReady = crmNeeded.filter((product) => crmBound(product) && (product.eligibleTypes || []).length);
  const eadNeeded = (ead.products || []).filter((product) => product.needed);
  const eadReady = eadNeeded.filter((product) =>
    product.side && (product.rules || []).length && (product.rules || []).every((rule) => rule.structured)
  );
  const parameterTableCount = Number((paramRows[0] && paramRows[0].n) || 0);
  const referenceListCount = Number((listRows[0] && listRows[0].n) || 0);
  const issues = [];
  if (!published) {
    issues.push("监管规则版本未发布" + (versionRow ? "（当前状态：" + versionRow.status + "）" : ""));
  }
  if (!snapshot) issues.push("该版本还没有发布正式配置快照，不能创建正式任务");
  if (!docs.registry) issues.push("该版本还没有产品注册");
  if (!products.length) issues.push("产品清单为空");
  if (!docs.classification) issues.push("缺少 V3.5 暴露分类规则集");
  if (!docs.weight) issues.push("缺少 V3.5 风险权重规则集");
  if (!docs.mappings.length) issues.push("缺少字段映射文档");
  if (!parameterTableCount) issues.push("缺少规则参数表");
  if (!referenceListCount) issues.push("缺少监管名单");
  if (!eadNeeded.length) issues.push("缺少 EAD 配置");
  else {
    const incomplete = eadNeeded.length - eadReady.length;
    if (incomplete) issues.push("EAD 配置不完整：" + incomplete + " 个产品缺少表内/表外或公式");
  }
  if (crmNeeded.length && crmReady.length < crmNeeded.length) {
    issues.push("信用风险缓释配置不完整：" + (crmNeeded.length - crmReady.length) + " 个产品缺少字段绑定或合格缓释物");
  }
  if (!usableLiquidity.length) issues.push("流动性没有已启用且配置完整的产品");
  if (!(liquidityParamData.tables || []).length) issues.push("流动性缺少参数表");
  if (!(liquidityParamData.params || []).length) issues.push("流动性缺少监管参数");
  if (!(liquidityParamData.lists || []).length) issues.push("流动性缺少监管名单");
  return {
    ok: issues.length === 0,
    version: ruleVersion,
    versionId,
    jurisdiction,
    published,
    snapshotId: snapshot ? snapshot.id : "",
    productCount: products.length,
    fieldCount,
    registry: docs.registry ? { name: docs.registry.name, version: docs.registry.docVersion } : null,
    classification: docs.classification ? { name: docs.classification.name, version: docs.classification.docVersion } : null,
    weight: docs.weight ? { name: docs.weight.name, version: docs.weight.docVersion } : null,
    mappingCount: docs.mappings.length,
    parameterTableCount,
    referenceListCount,
    ead: {
      productCount: (ead.products || []).length,
      neededCount: eadNeeded.length,
      readyCount: eadReady.length,
      issues: ead.issues || []
    },
    crm: {
      productCount: (crm.products || []).length,
      neededCount: crmNeeded.length,
      readyCount: crmReady.length
    },
    liquidity: {
      productCount: (catalogue.products || []).length,
      usableCount: usableLiquidity.length,
      tableCount: (liquidityParamData.tables || []).length,
      paramCount: (liquidityParamData.params || []).length,
      listCount: (liquidityParamData.lists || []).length
    },
    issues
  };
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
  const duplicate = await query(
    "SELECT id, name FROM rwa_task WHERE jurisdiction = ? AND version = ? AND institution = ? AND base_date = ? LIMIT 1",
    [jurisdiction, version, institution, baseDate]
  );
  if (duplicate[0]) {
    throw fail(409, "该机构在 " + version + "、基准日 " + baseDate + " 已有主任务 " + duplicate[0].id + "，请直接进入该任务或调整基准日");
  }
  const readiness = await readRwaTaskReadiness(version, jurisdiction);
  if (!readiness.ok) throw fail(400, "当前监管版本的规则配置不完整：" + readiness.issues.join("；"));
  const id = uid("RT");
  const now = nowText();
  const ruleVersionId = await resolveVersionRef(version, jurisdiction);
  const snapshot = ruleVersionId ? await latestPublishedSnapshot(ruleVersionId) : null;
  if (!snapshot) throw fail(409, "当前监管版本尚未发布正式配置快照，不能创建正式计量任务");
  await query(
    `INSERT INTO rwa_task (id, name, institution, jurisdiction, version, base_date, created_at, updated_at, rule_version_id, snapshot_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, name.slice(0, 200), institution, jurisdiction, version, baseDate, now, now, ruleVersionId, snapshot.id]
  );
  const subtasks = Array.isArray(body.subtasks) ? body.subtasks : [];
  for (const item of subtasks) {
    if (!item || typeof item !== "object") continue;
    const module = item.module === "liquidity" ? "liquidity" : "capital";
    const subName = String(item.name || (module === "liquidity" ? "流动性计量" : "资本充足率计量")).trim();
    if (!subName) continue;
    await query(
      `INSERT INTO rwa_task_sub (id, task_id, module, name, exposure_type, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'draft', ?, ?)`,
      [uid("RS"), id, module, subName.slice(0, 200), String(item.exposureType || "").trim().slice(0, 64), now, now]
    );
  }
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
  if (body.name !== undefined || body.baseDate !== undefined) {
    await syncHqlaTaskInfo(await taskRow(id));
  }
  return getRwaTask(id);
}

async function syncHqlaTaskInfo(task) {
  const rows = await query("SELECT id, config FROM hqla_task WHERE rwa_task_id = ?", [task.id]);
  const now = nowText();
  for (const row of rows) {
    const cfg = parseJson(row.config, {}) || {};
    cfg.rwaTask = Object.assign({}, cfg.rwaTask || {}, {
      id: task.id,
      name: task.name,
      institution: task.institution,
      jurisdiction: task.jurisdiction,
      version: task.version,
      baseDate: dateText(task.base_date)
    });
    await query(
      "UPDATE hqla_task SET base_date = ?, config = ?, updated_at = ? WHERE id = ?",
      [dateText(task.base_date), JSON.stringify(cfg), now, row.id]
    );
  }
}

export async function deleteRwaTask(id) {
  await taskRow(id);
  const subs = await query("SELECT id, hqla_task_id FROM rwa_task_sub WHERE task_id = ?", [id]);
  for (const sub of subs) {
    let hqlaId = sub.hqla_task_id || "";
    if (!hqlaId) {
      const linked = await query("SELECT id FROM hqla_task WHERE rwa_task_sub_id = ? LIMIT 1", [sub.id]);
      hqlaId = linked[0] ? linked[0].id : "";
    }
    if (hqlaId) await deleteHqlaTask(hqlaId, { force: true });
  }
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
  if (body.name !== undefined && body.name !== rows[0].name) {
    await syncHqlaSubName(subId, String(body.name).trim());
  }
  return getRwaTask(taskId);
}

async function syncHqlaSubName(subId, name) {
  const rows = await query("SELECT id, config FROM hqla_task WHERE rwa_task_sub_id = ?", [subId]);
  const now = nowText();
  for (const row of rows) {
    const cfg = parseJson(row.config, {}) || {};
    cfg.rwaTaskSub = Object.assign({}, cfg.rwaTaskSub || {}, { id: subId, name: name });
    await query(
      "UPDATE hqla_task SET name = ?, config = ?, updated_at = ? WHERE id = ?",
      [name.slice(0, 200), JSON.stringify(cfg), now, row.id]
    );
  }
}

export async function deleteSubtask(taskId, subId) {
  await taskRow(taskId);
  const rows = await query("SELECT * FROM rwa_task_sub WHERE id = ? AND task_id = ?", [subId, taskId]);
  if (!rows.length) throw fail(404, "子任务不存在");
  if (rows[0].hqla_task_id) {
    throw fail(400, "该流动性子任务已关联 LCR 任务，不能直接删除；请先在 LCR 任务中作废或解除关联");
  }
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
  if (task.snapshot_id && batch.snapshot_id !== task.snapshot_id) {
    throw fail(409, "计量批次没有使用主任务绑定的配置快照，不能归档");
  }
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
