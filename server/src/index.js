import Koa from "koa";
import Router from "@koa/router";
import cors from "@koa/cors";
import bodyParser from "koa-bodyparser";
import { Readable } from "node:stream";
import { query } from "./db.js";
import { annotatedUpload, applyMeasureChoices, auditWorkbook, classifyUpload, detectMeasureProducts, mapMeasureFields, measureDemo, readClassifyTrace, readMeasureRun, readUploadedWorkbook, saveMeasureRun, weightUpload } from "./measure.js";
import { paperView, uploadSamples } from "./paper.js";
import {
  archiveSubtask, createRwaTask, createSubtask, deleteRwaTask, deleteSubtask, getRwaTask,
  listRwaTasks, readRwaTaskReadiness, updateRwaTask, updateSubtask
} from "./tasks.js";
import { trialEad } from "./ead.js";
import { checkEadFormula, readEadConfig, saveEadConfig } from "./eadConfig.js";
import { readCrmConfig, saveCrmConfig } from "./crmConfig.js";
import { configProducts, productGroupMappings } from "./productStandard.js";
import { buildProductAssistContext } from "./productAssist.js";
import {
  readGroupConstraints, readGroupProposal, readGroupRun,
  saveGroupConstraints, streamGroupWorkflow
} from "./productGroupWorkflow.js";
import {
  archiveTask, computeLcr, computeTask, computeTaskRun, confirmTaskFields, confirmTaskRecognitions,
  deleteDataset, deleteList, deleteTask, demoData,
  exportTaskRunWorkbook, exportWorkbook,
  getTask, getTaskRunDetail, getTaskSnapshot, identifyTaskDatasets, inspectUpload,
  inspectWorkbook, listHitsFor, listMeta, listTaskFields, listTaskQualityIssues, listTaskQualityRuns,
  listTaskAudit, listTaskRecognitions, listTaskRunExceptions, listTaskRunResults, listTaskRuns,
  mapTaskDatasets, openHqlaTask, parseUpload, parseWorkbook, planSample, preflightTask,
  qualityTaskDatasets, recognizeTaskProducts, referenceRows, runTaskQuality,
  saveDatasetMeta, saveDatasets, saveInput, saveList, saveReported, saveSimple, suggestTaskFields,
  updateTask, upsertReference
} from "./hqla.js";
import {
  copyLiquidityProduct, deleteLiquidityDictionary, deleteLiquidityDictionaryItem,
  deleteLiquidityField, deleteLiquidityFieldGroup, deleteLiquidityGroup, deleteLiquidityProduct,
  deleteLiquidityRuleScope, getLiquidityProduct, listLiquidityDictionaries,
  liquidityMeta, liquidityParams, liquidityRules, liquidityVersions, listLiquidityProducts,
  saveLiquidityDictionary, saveLiquidityDictionaryItem, saveLiquidityField, saveLiquidityFieldGroup,
  saveLiquidityGroup, saveLiquidityProduct, saveLiquidityRuleScope, validateProductGroups
} from "./liquidity.js";
import { copyExposureDoc, deleteExposureDoc, exposureChat, exposureDoc, exposureDocs, provisionExposureDocs, saveExposureChat, saveExposureDoc } from "./exposureDocs.js";
import {
  createLlm, createRole, createTokenLog, createUser, defaultLlm, listLlm, listLoginLogs, listOperationLogs,
  activeLlm,
  listRoles, listTokenLogs, listUsers, login, logout, menuTree, resetPassword, saveRoleMenus, sessionInfo, testLlm,
  toggleLlm, toggleRole, toggleUser, updateLlm, updateRole, updateUser
} from "./admin.js";
import {
  createCcf, createClause, createCrmRule, createExposureRule, createField, createGrade, createMapping, createMoWeight,
  createOrg, createProduct, createRuleVersion, createWeightRule, deleteCcf, deleteCcfs, deleteClause, deleteClauses,
  deleteCrmRule, deleteCrmRules, deleteExposureRule, deleteExposureRules, deleteField, deleteFields, deleteGrade, deleteGrades,
  deleteMapping, deleteMappings, deleteMoWeight, deleteMoWeights, deleteOrg, deleteOrgs, deleteProduct, deleteProducts,
  deleteRuleVersion, deleteRuleVersions, deleteWeightRule, deleteWeightRules,
  updateCcf, updateClause, updateCrmRule, updateExposureRule, updateField, updateGrade, updateMapping, updateMoWeight,
  updateOrg, updateProduct, updateRuleVersion, updateWeightRule
} from "./ruleWrite.js";
import { requestContext } from "./requestContext.js";
import {
  createRuleDocument, deleteRuleDocument, ruleDocument, ruleDocuments,
  saveRuleDocument, validateRuleBody, validateRuleDocumentById
} from "./ruleDocs.js";
import {
  parameterTable, parameterTables, referenceList, referenceLists, saveParameterTable, saveReferenceList
} from "./refData.js";
import { resolveVersionRef } from "./ruleVersion.js";
import { exposureOverview } from "./exposureOverview.js";
import {
  clauseImpact, clauseRelations, compareSnapshots, configRevisions, createRuleConfigSnapshot,
  getRuleSnapshot, loadRwaConfig, publishRuleVersion, rollbackSnapshot,
  ruleVersionOverview, saveClauseRelations, validateRuleVersion, withdrawRuleVersion
} from "./ruleGovernance.js";

const app = new Koa();
const router = new Router({ prefix: "/api" });

function date(value) {
  if (!value) return null;
  return String(value).slice(0, 10);
}

function json(value) {
  if (value == null) return null;
  if (typeof value === "string") {
    try { return JSON.parse(value); } catch { return value; }
  }
  return value;
}

/** Resolve the account's default model so Flask can use it for this request. */
async function requestLlm(ctx) {
  const owner = String(ctx.get("x-rwa-user") || (ctx.request.body || {}).owner || "").trim();
  return activeLlm(owner);
}

function actorOf(ctx) {
  return String(ctx.get("x-rwa-user") || (ctx.request.body || {}).actor || "").trim();
}

function org(row) {
  return { id: row.id, name: row.name, jurisdiction: row.jurisdiction };
}

function version(row) {
  return {
    id: row.id,
    jurisdiction: row.jurisdiction,
    version: row.version,
    name: row.name,
    ruleType: row.rule_type,
    effectiveFrom: date(row.effective_from),
    effectiveTo: date(row.effective_to),
    status: row.status,
    institution: row.institution,
    author: row.author,
    changelog: row.changelog,
    publishedAt: row.published_at,
    rulesetFile: row.ruleset_file,
    framework: row.framework || "CAR",
    sourceVersionId: row.source_version_id || "",
    revision: Number(row.revision) || 1,
    configStatus: row.config_status || "",
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || "",
    updatedBy: row.updated_by || ""
  };
}

function clauseBody(row, referencedBy, relations) {
  return {
    id: row.id,
    jurisdiction: row.jurisdiction,
    doc: row.doc,
    docVersion: row.doc_version,
    clause: row.clause_no,
    title: row.title,
    text: row.body,
    scope: row.scope,
    effectiveFrom: date(row.effective_from),
    source: row.source,
    ruleVersionId: row.rule_version_id || "",
    framework: row.framework || "CAR",
    status: row.status || "ACTIVE",
    revision: Number(row.revision) || 1,
    referencedBy: referencedBy || [],
    relations: relations || []
  };
}

function batch(row) {
  return {
    id: row.id,
    name: row.name,
    institution: row.institution,
    jurisdiction: row.jurisdiction,
    version: row.version,
    baseDate: date(row.base_date),
    imported: row.imported,
    success: row.success_count,
    exception: row.exception_count,
    onEad: Number(row.on_ead),
    offEad: Number(row.off_ead),
    ead: Number(row.ead),
    rwa: Number(row.rwa),
    createdAt: row.created_at,
    status: row.status,
    ruleVersionId: row.rule_version_id || "",
    snapshotId: row.snapshot_id || "",
    engineVersion: row.engine_version || ""
  };
}

function countNodes(doc) {
  let total = 0;
  function walk(node) {
    if (!node || typeof node !== "object") return;
    total += 1;
    (node.children || []).forEach(walk);
    if (node.otherwise && typeof node.otherwise === "object") walk(node.otherwise);
  }
  (doc.rules || []).forEach(walk);
  (doc.extensions || []).forEach((item) => (item.children || []).forEach(walk));
  return total;
}

router.get("/health", async (ctx) => {
  await query("SELECT 1 AS ok");
  ctx.body = { ok: true };
});

// ---------------------------------------------------------------- 登录与系统管理

router.post("/auth/login", async (ctx) => {
  ctx.body = await login(ctx.request.body || {});
});

router.post("/auth/logout", async (ctx) => {
  ctx.body = await logout(ctx.request.body || {});
});

router.get("/auth/session", async (ctx) => {
  ctx.body = await sessionInfo(String(ctx.query.username || ""));
});

router.get("/menus", async (ctx) => {
  ctx.body = menuTree();
});

router.get("/users", async (ctx) => {
  ctx.body = await listUsers();
});

router.post("/users", async (ctx) => {
  const body = ctx.request.body || {};
  ctx.status = 201;
  ctx.body = await createUser(body, body.actor);
});

router.put("/users/:id", async (ctx) => {
  const body = ctx.request.body || {};
  ctx.body = await updateUser(ctx.params.id, body, body.actor);
});

router.post("/users/:id/toggle", async (ctx) => {
  const body = ctx.request.body || {};
  ctx.body = await toggleUser(ctx.params.id, body.actor);
});

router.post("/users/:id/reset-password", async (ctx) => {
  const body = ctx.request.body || {};
  ctx.body = await resetPassword(ctx.params.id, body.actor);
});

router.get("/roles", async (ctx) => {
  ctx.body = await listRoles();
});

router.post("/roles", async (ctx) => {
  const body = ctx.request.body || {};
  ctx.status = 201;
  ctx.body = await createRole(body, body.actor);
});

router.put("/roles/:id", async (ctx) => {
  const body = ctx.request.body || {};
  ctx.body = await updateRole(ctx.params.id, body, body.actor);
});

router.put("/roles/:id/menus", async (ctx) => {
  const body = ctx.request.body || {};
  ctx.body = await saveRoleMenus(ctx.params.id, body, body.actor);
});

router.post("/roles/:id/toggle", async (ctx) => {
  const body = ctx.request.body || {};
  ctx.body = await toggleRole(ctx.params.id, body.actor);
});

router.get("/login-logs", async (ctx) => {
  ctx.body = await listLoginLogs(Number(ctx.query.limit) || 200);
});

router.get("/operation-logs", async (ctx) => {
  ctx.body = await listOperationLogs(Number(ctx.query.limit) || 200);
});

router.get("/llm-configs", async (ctx) => {
  ctx.body = await listLlm(String(ctx.query.owner || ""));
});

router.post("/llm-configs", async (ctx) => {
  const body = ctx.request.body || {};
  ctx.status = 201;
  ctx.body = await createLlm(body.owner, body, body.actor);
});

router.put("/llm-configs/:id", async (ctx) => {
  const body = ctx.request.body || {};
  ctx.body = await updateLlm(ctx.params.id, body.owner, body, body.actor);
});

router.post("/llm-configs/:id/toggle", async (ctx) => {
  const body = ctx.request.body || {};
  ctx.body = await toggleLlm(ctx.params.id, body.owner, body.actor);
});

router.post("/llm-configs/:id/default", async (ctx) => {
  const body = ctx.request.body || {};
  ctx.body = await defaultLlm(ctx.params.id, body.owner, body.actor);
});

router.post("/llm-configs/:id/test", async (ctx) => {
  const body = ctx.request.body || {};
  ctx.body = await testLlm(ctx.params.id, body.owner, body.actor);
});

router.get("/token-logs", async (ctx) => {
  ctx.body = await listTokenLogs(ctx.query || {});
});

router.post("/token-logs", async (ctx) => {
  ctx.status = 201;
  ctx.body = await createTokenLog(ctx.request.body || {});
});

router.get("/bootstrap", async (ctx) => {
  const [customers, jurisdictions, versions, orgs] = await Promise.all([
    query("SELECT id, name, code, category, note FROM customer ORDER BY category, code"),
    query("SELECT code, label, regulator, currency, currency_label AS currencyLabel FROM jurisdiction ORDER BY code"),
    query("SELECT * FROM rule_version ORDER BY jurisdiction, effective_from"),
    query("SELECT id, name, jurisdiction FROM org_unit ORDER BY id")
  ]);
  ctx.body = {
    customers,
    jurisdictions,
    versions: versions.map(version),
    orgs: orgs.map(org)
  };
});

router.get("/exposure-overview", async (ctx) => {
  ctx.body = await exposureOverview({
    jurisdiction: String(ctx.query.jurisdiction || "HK"),
    version: String(ctx.query.version || "")
  });
});

router.get("/orgs", async (ctx) => {
  const jur = ctx.query.jurisdiction || "";
  const rows = await query(
    "SELECT id, name, jurisdiction FROM org_unit WHERE (? = '' OR jurisdiction = ?) ORDER BY jurisdiction, name",
    [jur, jur]
  );
  ctx.body = rows.map(org);
});

router.post("/orgs", async (ctx) => {
  ctx.body = org(await createOrg(ctx.request.body || {}));
});

router.put("/orgs/:id", async (ctx) => {
  ctx.body = org(await updateOrg(ctx.params.id, ctx.request.body || {}));
});

router.delete("/orgs/:id", async (ctx) => {
  await deleteOrg(ctx.params.id);
  ctx.body = { ok: true };
});

router.post("/orgs/batch-delete", async (ctx) => {
  ctx.body = await deleteOrgs(ctx.request.body || {});
});

router.get("/dashboard", async (ctx) => {
  const docs = await query("SELECT body FROM exposure_document WHERE id = 1");
  const doc = json(docs[0] && docs[0].body) || { rules: [] };
  const batches = await query("SELECT * FROM measure_batch ORDER BY created_at DESC, id DESC");
  const published = await query(
    "SELECT version, jurisdiction FROM rule_version WHERE status = 'published' ORDER BY effective_from DESC LIMIT 1"
  );
  ctx.body = {
    nodeCount: countNodes(doc),
    topRules: (doc.rules || []).length,
    fieldCount: (doc.fields || []).length,
    version: published[0] || null,
    batches: batches.map(batch),
    tasks: await listRwaTasks()
  };
});

router.get("/rule-versions", async (ctx) => {
  const jur = String(ctx.query.jurisdiction || "");
  const framework = String(ctx.query.framework || "");
  const page = Number(ctx.query.page) || 0;
  const pageSize = Math.min(200, Math.max(1, Number(ctx.query.pageSize) || 20));
  const offset = page > 0 ? (page - 1) * pageSize : 0;
  const rows = await query(
    `SELECT * FROM rule_version WHERE (? = '' OR jurisdiction = ?) AND (? = '' OR framework = ?)
      ORDER BY jurisdiction, effective_from DESC
      ${page > 0 ? "LIMIT ? OFFSET ?" : ""}`,
    page > 0 ? [jur, jur, framework, framework, pageSize, offset] : [jur, jur, framework, framework]
  );
  const counts = await query(
    "SELECT rule_version, COUNT(*) AS n FROM exposure_document WHERE seq > 0 GROUP BY rule_version"
  );
  const exposureCount = {};
  counts.forEach((row) => { exposureCount[row.rule_version] = Number(row.n); });
  const mapped = rows.map((row) => ({ ...version(row), exposureCount: exposureCount[row.version] || 0 }));
  if (page > 0) {
    const totalRows = await query(
      "SELECT COUNT(*) AS n FROM rule_version WHERE (? = '' OR jurisdiction = ?) AND (? = '' OR framework = ?)",
      [jur, jur, framework, framework]
    );
    ctx.body = { rows: mapped, total: Number(totalRows[0].n), page, pageSize };
    return;
  }
  ctx.body = mapped;
});

router.post("/rule-versions", async (ctx) => {
  const body = ctx.request.body || {};
  if (!body.actor) body.actor = actorOf(ctx);
  ctx.body = version(await createRuleVersion(body));
});

router.put("/rule-versions/:id", async (ctx) => {
  const body = ctx.request.body || {};
  if (!body.actor) body.actor = actorOf(ctx);
  ctx.body = version(await updateRuleVersion(ctx.params.id, body));
});

router.delete("/rule-versions/:id", async (ctx) => {
  await deleteRuleVersion(ctx.params.id, actorOf(ctx));
  ctx.body = { ok: true };
});

router.post("/rule-versions/batch-delete", async (ctx) => {
  ctx.body = await deleteRuleVersions(ctx.request.body || {});
});

router.get("/rule-versions/:id/overview", async (ctx) => {
  ctx.body = await ruleVersionOverview(ctx.params.id);
});

router.post("/rule-versions/:id/validate", async (ctx) => {
  ctx.body = await validateRuleVersion(ctx.params.id);
});

router.post("/rule-versions/:id/publish", async (ctx) => {
  ctx.body = await publishRuleVersion(ctx.params.id, actorOf(ctx));
});

router.post("/rule-versions/:id/withdraw", async (ctx) => {
  ctx.body = await withdrawRuleVersion(ctx.params.id, actorOf(ctx));
});

router.get("/rule-versions/:id/revisions", async (ctx) => {
  ctx.body = await configRevisions(ctx.params.id, ctx.query.limit);
});

router.post("/rule-versions/:id/snapshot", async (ctx) => {
  ctx.status = 201;
  ctx.body = await createRuleConfigSnapshot(ctx.params.id, actorOf(ctx), "DRAFT");
});

router.get("/rule-snapshots/:snapshotId", async (ctx) => {
  ctx.body = await getRuleSnapshot(ctx.params.snapshotId, ctx.query.items !== "0");
});

router.get("/rule-snapshots/:snapshotId/compare/:otherId", async (ctx) => {
  ctx.body = await compareSnapshots(ctx.params.snapshotId, ctx.params.otherId);
});

router.post("/rule-snapshots/:snapshotId/rollback", async (ctx) => {
  ctx.body = await rollbackSnapshot(ctx.params.snapshotId, actorOf(ctx));
});

router.get("/rule-config/load", async (ctx) => {
  ctx.body = await loadRwaConfig({
    version: String(ctx.query.version || ""),
    ruleVersionId: String(ctx.query.ruleVersionId || ""),
    jurisdiction: String(ctx.query.jurisdiction || ""),
    snapshotId: String(ctx.query.snapshotId || ""),
    mode: String(ctx.query.mode || "draft")
  });
});

router.get("/clauses", async (ctx) => {
  const jur = ctx.query.jurisdiction || "";
  const versionRef = String(ctx.query.version || "");
  const versionId = versionRef ? await resolveVersionRef(versionRef, jur) : "";
  const q = "%" + (ctx.query.q || "") + "%";
  const page = Number(ctx.query.page) || 0;
  const pageSize = Math.min(500, Math.max(1, Number(ctx.query.pageSize) || 50));
  const rows = await query(
    `SELECT * FROM clause_doc
     WHERE (? = '' OR jurisdiction = ?)
       AND (? = '' OR rule_version_id = ?)
       AND (clause_no LIKE ? OR title LIKE ? OR doc LIKE ? OR doc_version LIKE ?)
     ORDER BY jurisdiction, clause_no
     ${page > 0 ? "LIMIT ? OFFSET ?" : ""}`,
    page > 0
      ? [jur, jur, versionId, versionId, q, q, q, q, pageSize, (page - 1) * pageSize]
      : [jur, jur, versionId, versionId, q, q, q, q]
  );
  const refs = await query("SELECT clause_id, rule_name FROM clause_ref");
  const byId = {};
  refs.forEach((item) => {
    (byId[item.clause_id] || (byId[item.clause_id] = [])).push(item.rule_name);
  });
  const relationRows = await query("SELECT clause_id, rule_version_id, rule_document_id, rule_node_id, relation_type FROM rule_clause_relation");
  const relationsById = {};
  relationRows.forEach((item) => {
    (relationsById[item.clause_id] || (relationsById[item.clause_id] = [])).push(item);
  });
  const mapped = rows.map((row) => clauseBody(row, byId[row.id], relationsById[row.id]));
  if (page > 0) {
    const totalRows = await query(
      `SELECT COUNT(*) AS n FROM clause_doc
        WHERE (? = '' OR jurisdiction = ?)
          AND (? = '' OR rule_version_id = ?)
          AND (clause_no LIKE ? OR title LIKE ? OR doc LIKE ? OR doc_version LIKE ?)`,
      [jur, jur, versionId, versionId, q, q, q, q]
    );
    ctx.body = { rows: mapped, total: Number(totalRows[0].n), page, pageSize };
    return;
  }
  ctx.body = mapped;
});

router.post("/clauses", async (ctx) => {
  const body = ctx.request.body || {};
  if (!body.actor) body.actor = actorOf(ctx);
  const saved = await createClause(body);
  ctx.body = clauseBody(saved.row, saved.referencedBy);
});

router.put("/clauses/:id", async (ctx) => {
  const body = ctx.request.body || {};
  if (!body.actor) body.actor = actorOf(ctx);
  const saved = await updateClause(ctx.params.id, body);
  ctx.body = clauseBody(saved.row, saved.referencedBy);
});

router.get("/clauses/:id/impact", async (ctx) => {
  ctx.body = await clauseImpact(ctx.params.id);
});

router.get("/clauses/:id/relations", async (ctx) => {
  ctx.body = await clauseRelations(ctx.params.id);
});

router.put("/clauses/:id/relations", async (ctx) => {
  const body = ctx.request.body || {};
  ctx.body = await saveClauseRelations(ctx.params.id, body.relations || [], actorOf(ctx));
});

router.delete("/clauses/:id", async (ctx) => {
  await deleteClause(ctx.params.id, actorOf(ctx));
  ctx.body = { ok: true };
});

router.post("/clauses/batch-delete", async (ctx) => {
  ctx.body = await deleteClauses(ctx.request.body || {});
});

router.get("/product-standard/products", async (ctx) => {
  ctx.body = await configProducts(String(ctx.query.version || ""));
});

router.get("/product-standard/group-mappings", async (ctx) => {
  ctx.body = await productGroupMappings(String(ctx.query.version || ""));
});

function groupAssistRequest(context, body) {
  const plan = context.groupPlan || [];
  const group = plan.find((item) => item.id === String(body.groupId || ""));
  if (!group) throw Object.assign(new Error("没有这个监管字段分组"), { status: 404 });
  // 问答模式要能解释本组全部字段（包括系统计算字段），生成模式只处理需要人工映射的字段。
  const action = String(body.action || "propose");
  const targetFields = action === "answer" ? group.fields : group.fields.filter((field) => !field.systemCalc);
  const allowedGroups = (context.standardFieldGroups || []).slice();
  plan.forEach((item) => {
    if (!item.standardGroup && item.suggestedStandardGroup) {
      if (!allowedGroups.some((entry) => entry.group_id === item.suggestedStandardGroup.group_id)) {
        allowedGroups.push(item.suggestedStandardGroup);
      }
    }
  });
  const groupContext = {
    action: String(body.action || "propose"),
    mode: "group_flow",
    product: context.product,
    exposureClasses: context.exposureClasses,
    group: {
      id: group.id,
      label: group.label,
      description: group.description,
      standardGroup: group.standardGroup,
      suggestedStandardGroup: group.suggestedStandardGroup,
      targetFields
    },
    targetFields,
    existingStandardFields: context.existingStandardFields,
    existingMappings: context.existingMappings,
    dictionaries: context.dictionaries,
    messages: Array.isArray(body.messages) ? body.messages.slice(-20) : [],
    currentProposal: body.currentProposal || null,
    previousProposal: body.previousProposal || null,
    currentSelections: Array.isArray(body.currentSelections) ? body.currentSelections : [],
    standardFieldGroups: allowedGroups,
    knownTargetFields: context.knownTargetFields
  };
  return { group, groupContext };
}

router.post("/product-standard/assist/group", async (ctx) => {
  const body = ctx.request.body || {};
  const action = String(body.action || "plan");
  try {
    const context = await buildProductAssistContext({
      version: String(body.version || ""),
      family: String(body.family || ""),
      entryIndex: body.entryIndex,
      mode: "group_flow",
      messages: body.messages,
      currentProposal: body.currentProposal,
      draftStandardFields: body.draftStandardFields,
      draftMappings: body.draftMappings,
      draftDirty: body.draftDirty,
      scopeClasses: body.exposureClasses
    });
    const plan = context.groupPlan || [];
    if (action === "plan") {
      ctx.body = {
        stage: "plan",
        groups: plan.map((group) => ({
          id: group.id,
          label: group.label,
          description: group.description,
          order: group.order,
          stats: group.stats,
          standardGroup: group.standardGroup,
          suggestedStandardGroup: group.suggestedStandardGroup
        }))
      };
      return;
    }
    if (action === "scope") {
      const fields = [];
      const seen = new Set();
      plan.forEach((group) => {
        (group.fields || []).forEach((field) => {
          if (!field || !field.name || seen.has(field.name)) return;
          seen.add(field.name);
          fields.push({
            name: field.name,
            label: field.label || field.name,
            group: group.id,
            groupLabel: group.label || group.id,
            groupOrder: group.order,
            required: field.required === true,
            systemCalc: field.systemCalc === true,
            preparedInput: field.preparedInput === true
          });
        });
      });
      (context.externalInputs || []).forEach((field) => {
        if (!field || !field.name || seen.has(field.name)) return;
        seen.add(field.name);
        const group = plan.find((item) => (item.fields || []).some((entry) => entry.name === field.name));
        fields.push({
          name: field.name,
          label: field.label || field.name,
          group: field.group || (group && group.id) || "",
          groupLabel: (group && group.label) || field.group || "",
          groupOrder: group ? group.order : 999,
          required: false,
          systemCalc: false,
          externalInput: true
        });
      });
      ctx.body = {
        stage: "scope",
        fields,
        fieldNames: fields.map((field) => field.name),
        requiredFields: fields.filter((field) => field.required && !field.systemCalc && !field.externalInput).map((field) => field.name)
      };
      return;
    }
    if (action === "summary") {
      ctx.body = {
        stage: "summary",
        message: "共 " + plan.length + " 组监管字段，已返回分组统计。",
        groups: plan.map((item) => ({ id: item.id, label: item.label, stats: item.stats }))
      };
      return;
    }
    const { group, groupContext } = groupAssistRequest(context, body);
    if (action === "brief") {
      ctx.body = { stage: "brief", group };
      return;
    }
    if (action !== "propose" && action !== "refine" && action !== "answer") ctx.throw(400, "不支持的分组动作：" + action);
    const llm = await requestLlm(ctx);
    const response = await fetch("http://127.0.0.1:8766/api/product/assist/group", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...groupContext, ...(llm ? { llm } : {}) }),
      signal: AbortSignal.timeout(200000)
    });
    const text = await response.text();
    let payload;
    try { payload = text ? JSON.parse(text) : { error: "服务异常" }; }
    catch { payload = { error: "服务异常" }; }
    ctx.status = response.status;
    ctx.body = payload;
  } catch (err) {
    console.error(err);
    ctx.status = err.status || 502;
    ctx.body = { error: err.message || "分组生成失败" };
  }
});

router.post("/product-standard/assist/group/workflow", async (ctx) => {
  const llm = await requestLlm(ctx);
  await streamGroupWorkflow(ctx, ctx.request.body || {}, llm);
});

router.post("/product-standard/assist/group/workflow/resume", async (ctx) => {
  const llm = await requestLlm(ctx);
  await streamGroupWorkflow(ctx, ctx.request.body || {}, llm, { resume: true });
});

router.get("/product-standard/group-runs/:runId", async (ctx) => {
  const row = await readGroupRun(ctx.params.runId);
  if (!row) ctx.throw(404, "没有这个分组智能体运行记录");
  ctx.body = {
    runId: row.run_id,
    threadId: row.thread_id,
    proposalId: row.proposal_id,
    version: row.rule_version,
    family: row.product_family,
    groupId: row.group_id,
    action: row.action,
    intent: row.intent,
    status: row.status,
    draftDigest: row.draft_digest,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
});

router.get("/product-standard/group-proposals/:proposalId", async (ctx) => {
  const row = await readGroupProposal(ctx.params.proposalId);
  if (!row) ctx.throw(404, "没有这个分组建议");
  ctx.body = {
    proposalId: row.proposal_id,
    runId: row.run_id,
    threadId: row.thread_id,
    groupId: row.group_id,
    status: row.status,
    proposal: json(row.proposal_json),
    diff: json(row.diff_json),
    reviewFindings: json(row.review_json),
    conflicts: json(row.conflicts_json),
    createdAt: row.created_at
  };
});

router.get("/product-standard/group-constraints", async (ctx) => {
  const rows = await readGroupConstraints(
    String(ctx.query.version || ""), String(ctx.query.family || ""), String(ctx.query.groupId || "")
  );
  ctx.body = { constraints: rows.map((row) => json(row.constraint_json)).filter(Boolean) };
});

router.put("/product-standard/group-constraints", async (ctx) => {
  const body = ctx.request.body || {};
  const rows = await saveGroupConstraints(
    String(body.version || ""), String(body.family || ""), String(body.groupId || ""),
    Array.isArray(body.constraints) ? body.constraints : [], actorOf(ctx)
  );
  ctx.body = { constraints: rows.map((row) => json(row.constraint_json)).filter(Boolean) };
});

router.post("/product-standard/assist/group/stream", async (ctx) => {
  const body = ctx.request.body || {};
  const action = String(body.action || "propose");
  let groupContext;
  try {
    if (action !== "propose" && action !== "refine" && action !== "answer") ctx.throw(400, "不支持的分组动作：" + action);
    const context = await buildProductAssistContext({
      version: String(body.version || ""),
      family: String(body.family || ""),
      entryIndex: body.entryIndex,
      mode: "group_flow",
      messages: body.messages,
      currentProposal: body.currentProposal,
      draftStandardFields: body.draftStandardFields,
      draftMappings: body.draftMappings,
      draftDirty: body.draftDirty,
      scopeClasses: body.exposureClasses
    });
    groupContext = groupAssistRequest(context, body).groupContext;
  } catch (err) {
    ctx.status = err.status || 502;
    ctx.body = { error: err.message || "分组生成失败" };
    return;
  }
  const llm = await requestLlm(ctx);
  const controller = new AbortController();
  ctx.res.setTimeout(0);
  ctx.res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no"
  });
  ctx.res.flushHeaders();
  ctx.respond = false;
  ctx.res.on("close", () => controller.abort());
  const writeEvent = (name, data) => {
    if (ctx.res.writableEnded) return;
    ctx.res.write("event: " + name + "\n");
    ctx.res.write("data: " + JSON.stringify(data || {}) + "\n\n");
  };
  writeEvent("status", {
    stage: "reading_group",
    message: "正在读取本组 " + groupContext.targetFields.length + " 个监管字段的画像与规则用途…",
    total: groupContext.targetFields.length
  });
  try {
    const response = await fetch("http://127.0.0.1:8766/api/product/assist/group/stream", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...groupContext, ...(llm ? { llm } : {}) }),
      signal: controller.signal
    });
    if (!response.ok || !response.body) {
      const text = await response.text();
      writeEvent("error", { error: text || "分组字段建议失败" });
      ctx.res.end();
      return;
    }
    for await (const chunk of Readable.fromWeb(response.body)) {
      if (ctx.res.writableEnded) break;
      ctx.res.write(chunk);
    }
    ctx.res.end();
  } catch (err) {
    if (err && err.name === "AbortError") {
      if (!ctx.res.writableEnded) ctx.res.end();
      return;
    }
    console.error(err);
    writeEvent("error", { error: err.message || "分组字段建议失败" });
    if (!ctx.res.writableEnded) ctx.res.end();
  }
});

router.get("/products", async (ctx) => {
  const rows = await query(
    `SELECT p.*, (SELECT COUNT(*) FROM product_field f WHERE f.product_code = p.code) AS field_count
     FROM product_type p ORDER BY p.code`
  );
  ctx.body = rows.map((row) => ({
    code: row.code,
    label: row.label,
    icon: row.icon,
    color: row.color,
    desc: row.description,
    ruleVersion: row.rule_version,
    sampleCount: row.sample_count,
    system: row.source_system,
    onboarding: row.onboarding,
    fieldCount: Number(row.field_count)
  }));
});

router.post("/products", async (ctx) => {
  ctx.body = await createProduct(ctx.request.body || {});
});

router.put("/products/:code", async (ctx) => {
  ctx.body = await updateProduct(ctx.params.code, ctx.request.body || {});
});

router.delete("/products/:code", async (ctx) => {
  await deleteProduct(ctx.params.code);
  ctx.body = { ok: true };
});

router.post("/products/batch-delete", async (ctx) => {
  ctx.body = await deleteProducts(ctx.request.body || {});
});

router.get("/products/:code/fields", async (ctx) => {
  const rows = await query(
    "SELECT * FROM product_field WHERE product_code = ? ORDER BY id",
    [ctx.params.code]
  );
  ctx.body = rows.map((row) => ({
    code: row.code,
    name: row.name,
    meaning: row.meaning,
    type: row.data_type,
    unit: row.unit,
    required: !!row.required,
    sourceSystem: row.source_system,
    sourceField: row.source_field,
    transform: row.transform_rule,
    validate: row.validate_rule,
    options: json(row.options_json) || [],
    referencedBy: json(row.referenced_json) || [],
    stdField: row.std_field
  }));
});

router.post("/products/:code/fields", async (ctx) => {
  ctx.body = await createField(ctx.params.code, ctx.request.body || {});
});

router.put("/products/:code/fields/:fieldCode", async (ctx) => {
  ctx.body = await updateField(ctx.params.code, ctx.params.fieldCode, ctx.request.body || {});
});

router.delete("/products/:code/fields/:fieldCode", async (ctx) => {
  await deleteField(ctx.params.code, ctx.params.fieldCode);
  ctx.body = { ok: true };
});

router.post("/products/:code/fields/batch-delete", async (ctx) => {
  ctx.body = await deleteFields(ctx.params.code, ctx.request.body || {});
});

router.get("/field-mappings", async (ctx) => {
  const code = ctx.query.product || "";
  const rows = await query(
    "SELECT * FROM field_mapping WHERE (? = '' OR product_code = ?) ORDER BY id",
    [code, code]
  );
  ctx.body = rows.map((row) => ({
    id: row.id,
    product: row.product_code,
    stdField: row.std_field,
    stdCode: row.std_code,
    srcSystem: row.src_system,
    srcField: row.src_field,
    via: row.via,
    status: row.status,
    hitRate: Number(row.hit_rate),
    sample: row.sample
  }));
});

router.post("/field-mappings", async (ctx) => {
  ctx.body = await createMapping(ctx.request.body || {});
});

router.put("/field-mappings/:id", async (ctx) => {
  ctx.body = await updateMapping(ctx.params.id, ctx.request.body || {});
});

router.delete("/field-mappings/:id", async (ctx) => {
  await deleteMapping(ctx.params.id);
  ctx.body = { ok: true };
});

router.post("/field-mappings/batch-delete", async (ctx) => {
  ctx.body = await deleteMappings(ctx.request.body || {});
});

// ---------------------------------------------------------------- 敞口划分与产品规则配置（V3.5）
// 规则集文档、参数表和名单各存一张表；页面读写这里的 JSON，计算侧不从这里取数。

router.get("/rule-documents", async (ctx) => {
  ctx.body = await ruleDocuments({
    jurisdiction: String(ctx.query.jurisdiction || ""),
    version: String(ctx.query.version || ""),
    kind: String(ctx.query.kind || "")
  });
});

router.get("/rule-documents/:id", async (ctx) => {
  const doc = await ruleDocument(ctx.params.id);
  if (!doc) ctx.throw(404, "没有这份规则文档");
  ctx.body = doc;
});

router.post("/rule-documents", async (ctx) => {
  const body = ctx.request.body || {};
  if (!body.actor) body.actor = actorOf(ctx);
  ctx.body = await createRuleDocument(body);
});

router.post("/rule-documents/validate", async (ctx) => {
  ctx.body = await validateRuleBody(ctx.request.body || {});
});

router.put("/rule-documents/:id", async (ctx) => {
  const body = ctx.request.body || {};
  if (!body.actor) body.actor = actorOf(ctx);
  ctx.body = await saveRuleDocument(ctx.params.id, body);
});

router.post("/rule-documents/:id/validate", async (ctx) => {
  ctx.body = await validateRuleDocumentById(ctx.params.id);
});

router.delete("/rule-documents/:id", async (ctx) => {
  await deleteRuleDocument(ctx.params.id, actorOf(ctx));
  ctx.body = { ok: true };
});

router.get("/parameter-tables", async (ctx) => {
  ctx.body = await parameterTables(String(ctx.query.jurisdiction || ""), String(ctx.query.version || ""));
});

router.get("/parameter-tables/:id", async (ctx) => {
  const table = await parameterTable(ctx.params.id);
  if (!table) ctx.throw(404, "没有这张参数表");
  ctx.body = table;
});

router.put("/parameter-tables/:id", async (ctx) => {
  ctx.body = await saveParameterTable(ctx.params.id, ctx.request.body || {}, actorOf(ctx));
});

router.get("/reference-lists", async (ctx) => {
  ctx.body = await referenceLists(String(ctx.query.jurisdiction || ""), String(ctx.query.version || ""));
});

router.get("/reference-lists/:id", async (ctx) => {
  const list = await referenceList(ctx.params.id);
  if (!list) ctx.throw(404, "没有这份名单");
  ctx.body = list;
});

router.put("/reference-lists/:id", async (ctx) => {
  ctx.body = await saveReferenceList(ctx.params.id, ctx.request.body || {}, actorOf(ctx));
});

router.get("/exposure-classes", async (ctx) => {
  const rows = await exposureDocs(String(ctx.query.version || ""));
  ctx.body = rows.map((item) => ({
    name: item.name,
    title: item.title,
    label: item.label
  }));
});

router.get("/exposure-class", async (ctx) => {
  const name = String(ctx.query.name || "");
  if (name) {
    const doc = await exposureDoc(name, String(ctx.query.version || ""));
    if (!doc) ctx.throw(404, "没有这份分类 JSON");
    ctx.body = {
      name: doc.name,
      title: doc.title,
      sourceFile: doc.sourceFile,
      document: doc.document
    };
    return;
  }
  const rows = await query("SELECT name, title, source_file, body FROM exposure_document WHERE id = 1");
  if (!rows[0]) ctx.throw(404, "分类 JSON 不在库里");
  ctx.body = {
    name: rows[0].name,
    title: rows[0].title,
    sourceFile: rows[0].source_file,
    document: json(rows[0].body)
  };
});

router.get("/weights", async (ctx) => {
  const [rules, grades, mo] = await Promise.all([
    query("SELECT id, class_name AS cls, cond_text AS cond, risk_weight AS rw, priority AS pri, bank_tier AS bank, basis FROM weight_rule ORDER BY class_name, priority DESC"),
    query("SELECT id, label, priority AS pri, basis, weights_json, ids_json FROM bank_grade_row ORDER BY priority"),
    query("SELECT id, bucket, weights_json, note FROM mo_weight_row")
  ]);
  ctx.body = {
    rules,
    grades: grades.map((row) => ({
      ...row,
      weights: json(row.weights_json),
      ids: json(row.ids_json)
    })),
    mo: mo.map((row) => ({ id: row.id, bucket: row.bucket, weights: json(row.weights_json), note: row.note }))
  };
});

router.post("/weight-rules", async (ctx) => {
  ctx.body = await createWeightRule(ctx.request.body || {});
});

router.put("/weight-rules/:id", async (ctx) => {
  ctx.body = await updateWeightRule(ctx.params.id, ctx.request.body || {});
});

router.delete("/weight-rules/:id", async (ctx) => {
  await deleteWeightRule(ctx.params.id);
  ctx.body = { ok: true };
});

router.post("/weight-rules/batch-delete", async (ctx) => {
  ctx.body = await deleteWeightRules(ctx.request.body || {});
});

router.post("/bank-grades", async (ctx) => {
  ctx.body = await createGrade(ctx.request.body || {});
});

router.put("/bank-grades/:id", async (ctx) => {
  ctx.body = await updateGrade(ctx.params.id, ctx.request.body || {});
});

router.delete("/bank-grades/:id", async (ctx) => {
  await deleteGrade(ctx.params.id);
  ctx.body = { ok: true };
});

router.post("/bank-grades/batch-delete", async (ctx) => {
  ctx.body = await deleteGrades(ctx.request.body || {});
});

router.post("/mo-weights", async (ctx) => {
  ctx.body = await createMoWeight(ctx.request.body || {});
});

router.put("/mo-weights/:id", async (ctx) => {
  ctx.body = await updateMoWeight(ctx.params.id, ctx.request.body || {});
});

router.delete("/mo-weights/:id", async (ctx) => {
  await deleteMoWeight(ctx.params.id);
  ctx.body = { ok: true };
});

router.post("/mo-weights/batch-delete", async (ctx) => {
  ctx.body = await deleteMoWeights(ctx.request.body || {});
});

router.get("/ead-config", async (ctx) => {
  ctx.body = await readEadConfig({
    version: String(ctx.query.version || ""),
    jurisdiction: String(ctx.query.jurisdiction || "")
  });
});

router.put("/ead-config", async (ctx) => {
  const body = ctx.request.body || {};
  ctx.body = await saveEadConfig(body.config, {
    version: String(body.version || ""),
    jurisdiction: String(body.jurisdiction || ""),
    actor: String(ctx.get("x-rwa-user") || body.actor || "")
  });
});

router.post("/ead-formula/check", async (ctx) => {
  const body = ctx.request.body || {};
  ctx.body = await checkEadFormula(body.productCode, body.side, body.formula, body.version || "");
});

router.post("/ead-trial", async (ctx) => {
  ctx.body = await trialEad(ctx.request.body || {});
});

router.get("/crm-config", async (ctx) => {
  ctx.body = await readCrmConfig({
    version: String(ctx.query.version || ""),
    jurisdiction: String(ctx.query.jurisdiction || "")
  });
});

router.put("/crm-config", async (ctx) => {
  const body = ctx.request.body || {};
  ctx.body = await saveCrmConfig(body.config, {
    version: String(body.version || ""),
    jurisdiction: String(body.jurisdiction || ""),
    actor: String(ctx.get("x-rwa-user") || body.actor || "")
  });
});

router.get("/ccf", async (ctx) => {
  const rows = await query("SELECT id, type_name AS type, cond_text AS cond, ccf, priority AS pri, conds_json FROM ccf_rule ORDER BY priority DESC");
  ctx.body = rows.map((row) => ({ ...row, conds: json(row.conds_json) }));
});

router.post("/ccf", async (ctx) => {
  ctx.body = await createCcf(ctx.request.body || {});
});

router.put("/ccf/:id", async (ctx) => {
  ctx.body = await updateCcf(ctx.params.id, ctx.request.body || {});
});

router.delete("/ccf/:id", async (ctx) => {
  await deleteCcf(ctx.params.id);
  ctx.body = { ok: true };
});

router.post("/ccf/batch-delete", async (ctx) => {
  ctx.body = await deleteCcfs(ctx.request.body || {});
});

router.get("/crm", async (ctx) => {
  const rows = await query("SELECT id, type_name AS type, tool, substitute, floor_param AS floorParam, constraints_json, priority AS pri FROM crm_rule ORDER BY priority DESC");
  ctx.body = rows.map((row) => ({ ...row, constraints: json(row.constraints_json) }));
});

router.post("/crm", async (ctx) => {
  ctx.body = await createCrmRule(ctx.request.body || {});
});

router.put("/crm/:id", async (ctx) => {
  ctx.body = await updateCrmRule(ctx.params.id, ctx.request.body || {});
});

router.delete("/crm/:id", async (ctx) => {
  await deleteCrmRule(ctx.params.id);
  ctx.body = { ok: true };
});

router.post("/crm/batch-delete", async (ctx) => {
  ctx.body = await deleteCrmRules(ctx.request.body || {});
});

router.get("/product-rules", async (ctx) => {
  const code = ctx.query.product || "";
  const rows = await query(
    `SELECT id, product_code AS product, rule_name AS name, label, priority, version,
            when_text AS \`when\`, target_class AS targetClass, target_sub AS targetSub,
            weight_text AS weight, clause_id AS clause, status
     FROM product_exposure_rule
     WHERE (? = '' OR product_code = ?)
     ORDER BY product_code, priority`,
    [code, code]
  );
  ctx.body = rows;
});

router.post("/product-rules", async (ctx) => {
  ctx.body = await createExposureRule(ctx.request.body || {});
});

router.put("/product-rules/:id", async (ctx) => {
  ctx.body = await updateExposureRule(ctx.params.id, ctx.request.body || {});
});

router.delete("/product-rules/:id", async (ctx) => {
  await deleteExposureRule(ctx.params.id);
  ctx.body = { ok: true };
});

router.post("/product-rules/batch-delete", async (ctx) => {
  ctx.body = await deleteExposureRules(ctx.request.body || {});
});

router.get("/batches/:id", async (ctx) => {
  const data = await readMeasureRun(ctx.params.id);
  if (!data) ctx.throw(404, "没有这个计量批次");
  ctx.body = data;
});

router.get("/batches", async (ctx) => {
  const rows = await query("SELECT * FROM measure_batch ORDER BY base_date DESC, id DESC");
  ctx.body = rows.map(batch);
});

router.get("/batches/:id/lines", async (ctx) => {
  const rows = await query(
    `SELECT id, loan_id AS loanId, customer_name AS customerName, product_code AS product,
            exposure_class AS exposureClass, weight_text AS weight, ead, rwa, status, detail
     FROM measure_line WHERE batch_id = ? ORDER BY id`,
    [ctx.params.id]
  );
  ctx.body = rows.map((row) => ({ ...row, ead: Number(row.ead), rwa: Number(row.rwa), detail: json(row.detail) }));
});

router.post("/batches", async (ctx) => {
  const body = ctx.request.body || {};
  const name = String(body.name || "").trim();
  if (!name) ctx.throw(400, "请填写计量批次名称");
  const taken = await query("SELECT id FROM measure_batch WHERE name = ? LIMIT 1", [name]);
  if (taken.length) ctx.throw(400, "已经有这个批次名称。每次执行要用不同的批次名称");
  const id = "BATCH-" + new Date().toISOString().slice(0, 10).replace(/-/g, "") + "-" + Math.random().toString(36).slice(2, 6).toUpperCase();
  const row = {
    id,
    name,
    institution: body.institution || "",
    jurisdiction: body.jurisdiction || "MO",
    version: body.version || "",
    baseDate: body.baseDate || new Date().toISOString().slice(0, 10),
    createdAt: new Date().toISOString().slice(0, 19).replace("T", " "),
    status: "draft"
  };
  await query(
    `INSERT INTO measure_batch
      (id, name, institution, jurisdiction, version, base_date, imported, success_count, exception_count, created_at, status)
     VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?)`,
    [row.id, row.name, row.institution, row.jurisdiction, row.version, row.baseDate, row.createdAt, row.status]
  );
  const ruleVersionId = await resolveVersionRef(row.version, row.jurisdiction);
  if (ruleVersionId) await query("UPDATE measure_batch SET rule_version_id = ? WHERE id = ?", [ruleVersionId, row.id]);
  ctx.body = { ...row, imported: 0, success: 0, exception: 0, onEad: 0, offEad: 0, ead: 0, rwa: 0 };
});

router.get("/measure", async (ctx) => {
  ctx.body = await measureDemo();
});

router.get("/rwa-tasks/readiness", async (ctx) => {
  ctx.body = await readRwaTaskReadiness(ctx.query.version || "", ctx.query.jurisdiction || "");
});

router.get("/rwa-tasks", async (ctx) => {
  ctx.body = await listRwaTasks({
    page: ctx.query.page,
    pageSize: ctx.query.pageSize,
    q: String(ctx.query.q || ""),
    jurisdiction: String(ctx.query.jurisdiction || ""),
    version: String(ctx.query.version || ""),
    institution: String(ctx.query.institution || ""),
    status: String(ctx.query.status || ""),
    from: String(ctx.query.from || ""),
    to: String(ctx.query.to || "")
  });
});

router.post("/rwa-tasks", async (ctx) => {
  ctx.status = 201;
  ctx.body = await createRwaTask(ctx.request.body || {});
});

router.get("/rwa-tasks/:id", async (ctx) => {
  ctx.body = await getRwaTask(ctx.params.id);
});

router.put("/rwa-tasks/:id", async (ctx) => {
  ctx.body = await updateRwaTask(ctx.params.id, ctx.request.body || {});
});

router.delete("/rwa-tasks/:id", async (ctx) => {
  ctx.body = await deleteRwaTask(ctx.params.id);
});

router.post("/rwa-tasks/:id/subs", async (ctx) => {
  ctx.status = 201;
  ctx.body = await createSubtask(ctx.params.id, ctx.request.body || {});
});

router.put("/rwa-tasks/:id/subs/:subId", async (ctx) => {
  ctx.body = await updateSubtask(ctx.params.id, ctx.params.subId, ctx.request.body || {});
});

router.delete("/rwa-tasks/:id/subs/:subId", async (ctx) => {
  ctx.body = await deleteSubtask(ctx.params.id, ctx.params.subId);
});

router.post("/rwa-tasks/:id/subs/:subId/archive", async (ctx) => {
  ctx.body = await archiveSubtask(ctx.params.id, ctx.params.subId, ctx.request.body || {});
});
router.post("/rwa-tasks/:id/subs/:subId/hqla/open", async (ctx) => {
  const body = ctx.request.body || {};
  ctx.body = await openHqlaTask(ctx.params.id, ctx.params.subId, body.actor || "");
});

router.post("/measure/runs", async (ctx) => {
  ctx.body = await saveMeasureRun(ctx.request.body || {});
});

router.post("/measure/workbook", async (ctx) => {
  ctx.body = await readUploadedWorkbook(ctx.request.body || {});
});

router.get("/measure/workbook.xlsx", async (ctx) => {
  const file = annotatedUpload(ctx.query.uploadId);
  ctx.set("content-type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  ctx.set("content-disposition", "attachment; filename*=UTF-8''" + encodeURIComponent(file.filename));
  ctx.body = file.buffer;
});

router.post("/measure/apply", async (ctx) => {
  ctx.body = await applyMeasureChoices(ctx.request.body || {});
});

router.post("/measure/map", async (ctx) => {
  ctx.body = await mapMeasureFields(ctx.request.body || {});
});

router.post("/measure/products", async (ctx) => {
  ctx.body = await detectMeasureProducts(ctx.request.body || {});
});

router.post("/measure/classify", async (ctx) => {
  const body = ctx.request.body || {};
  ctx.body = await classifyUpload(body.uploadId, body.version || "", body.snapshotId || "");
});

router.post("/measure/weight", async (ctx) => {
  const body = ctx.request.body || {};
  ctx.body = await weightUpload(body.uploadId, body.version || "", body.snapshotId || "");
});

router.get("/measure/classify/trace/:uploadId/:file", async (ctx) => {
  ctx.type = "text/markdown; charset=utf-8";
  ctx.body = readClassifyTrace(ctx.params.uploadId, ctx.params.file);
});

router.get("/working-paper", async (ctx) => {
  ctx.body = paperView(ctx.query.offset, ctx.query.limit);
});

router.get("/upload-samples", async (ctx) => {
  ctx.body = uploadSamples();
});

router.get("/audit.xlsx", async (ctx) => {
  const body = await auditWorkbook();
  ctx.set("content-type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  ctx.set("content-disposition", "attachment; filename*=UTF-8''" + encodeURIComponent("信用风险RWA审计底稿.xlsx"));
  ctx.body = body;
});

router.get("/assistant", async (ctx) => {
  const rows = await query("SELECT seq, role, body FROM assistant_turn ORDER BY seq");
  ctx.body = rows.map((row) => ({ seq: row.seq, ...(json(row.body) || {}), role: row.role }));
});

router.post("/exposure-tree/propose", async (ctx) => {
  const body = ctx.request.body || {};
  const name = String(body.name || "");
  let version = String(body.version || "");
  if (!version && name) {
    const pinned = await exposureDoc(name);
    version = pinned ? pinned.ruleVersion : "";
  }
  const docs = await exposureDocs(version);
  const item = name ? docs.find((row) => row.name === name) : docs[0];
  if (!item) ctx.throw(404, "没有这份分类 JSON");
  const generic = docs.find((row) => row.label === "通用") || docs[0];
  const clauses = await query(
    `SELECT c.jurisdiction, j.label AS region, c.clause_no, c.title, c.body, c.scope
     FROM clause_doc c LEFT JOIN jurisdiction j ON j.code = c.jurisdiction
     ORDER BY c.jurisdiction, c.clause_no`
  );
  const llm = await requestLlm(ctx);
  try {
    const response = await fetch("http://127.0.0.1:8766/api/exposure-tree/propose", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        messages: body.messages || [],
        label: item.label,
        document: item.document,
        generic: generic && generic.name !== item.name ? generic.document : null,
        clauses: clauses.map((row) => ({
          jurisdiction: row.jurisdiction,
          region: row.region,
          clause: row.clause_no,
          title: row.title,
          text: row.body,
          scope: row.scope
        })),
        ...(llm ? { llm } : {})
      })
    });
    const text = await response.text();
    let payload;
    try { payload = text ? JSON.parse(text) : { error: "服务异常" }; }
    catch { payload = { error: "服务异常" }; }
    if (payload && payload.action === "update") payload.action = "draft";
    if (payload && payload.action === "draft" && payload.document) {
      payload.document.name = item.name;
      payload.label = item.label;
    }
    ctx.status = response.status;
    ctx.body = payload;
  } catch (err) {
    console.error(err);
    ctx.status = 502;
    ctx.body = { error: "服务异常" };
  }
});

router.get("/exposure-tree/chat", async (ctx) => {
  ctx.body = await exposureChat(String(ctx.query.name || ""), String(ctx.query.version || ""));
});

router.post("/exposure-tree/chat", async (ctx) => {
  ctx.body = await saveExposureChat(ctx.request.body || {});
});

router.post("/exposure-tree/provision", async (ctx) => {
  ctx.body = await provisionExposureDocs(ctx.request.body || {});
});

router.post("/exposure-tree/copy", async (ctx) => {
  ctx.body = await copyExposureDoc(ctx.request.body || {});
});

router.post("/exposure-tree/delete", async (ctx) => {
  ctx.body = await deleteExposureDoc(ctx.request.body || {});
});

router.post("/exposure-tree/save", async (ctx) => {
  ctx.body = await saveExposureDoc(ctx.request.body || {});
});

router.post("/agent/chat", async (ctx) => {
  try {
    const { llm: ignored, ...payload } = ctx.request.body || {};
    const llm = await requestLlm(ctx);
    const response = await fetch("http://127.0.0.1:8766/api/agent/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(llm ? { ...payload, llm } : payload)
    });
    const text = await response.text();
    let body;
    try { body = text ? JSON.parse(text) : { error: "服务异常" }; }
    catch { body = { error: "服务异常" }; }
    ctx.status = response.status;
    ctx.body = body;
  } catch (err) {
    console.error(err);
    ctx.status = 502;
    ctx.body = { error: "服务异常" };
  }
});

router.post("/rules/chat", async (ctx) => {
  try {
    const { llm: ignored, ...payload } = ctx.request.body || {};
    const llm = await requestLlm(ctx);
    const response = await fetch("http://127.0.0.1:8766/api/rules/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(llm ? { ...payload, llm } : payload)
    });
    const text = await response.text();
    let body;
    try { body = text ? JSON.parse(text) : { error: "服务异常" }; }
    catch { body = { error: "服务异常" }; }
    ctx.status = response.status;
    ctx.body = body;
  } catch (err) {
    console.error(err);
    ctx.status = 502;
    ctx.body = { error: "服务异常" };
  }
});

// ---------------------------------------------------------------- 流动性产品配置
// 产品、字段、规则、参数表都按 (jurisdiction, rule_version) 读取；配置维护只改这一版。

router.get("/liquidity/versions", async (ctx) => {
  ctx.body = await liquidityVersions(String(ctx.query.jurisdiction || ""));
});
router.get("/liquidity/meta", async (ctx) => { ctx.body = await liquidityMeta(ctx.query); });
router.get("/liquidity/products", async (ctx) => { ctx.body = await listLiquidityProducts(ctx.query); });
router.get("/liquidity/products/:code", async (ctx) => { ctx.body = await getLiquidityProduct(ctx.params.code, ctx.query); });
router.post("/liquidity/products", async (ctx) => { ctx.status = 201; ctx.body = await saveLiquidityProduct(ctx.request.body || {}); });
router.post("/liquidity/products/:code/copy", async (ctx) => {
  ctx.status = 201;
  ctx.body = await copyLiquidityProduct(ctx.params.code, ctx.request.body || {});
});
router.put("/liquidity/products/:code", async (ctx) => {
  ctx.body = await saveLiquidityProduct({ ...(ctx.request.body || {}), code: ctx.params.code });
});
router.delete("/liquidity/products/:code", async (ctx) => { ctx.body = await deleteLiquidityProduct(ctx.params.code, ctx.query); });
router.post("/liquidity/products/:code/groups/validate", async (ctx) => {
  ctx.body = await validateProductGroups(ctx.params.code, { ...ctx.query, ...(ctx.request.body || {}) });
});
router.post("/liquidity/products/:code/groups", async (ctx) => {
  ctx.status = 201;
  ctx.body = await saveLiquidityGroup(ctx.params.code, ctx.request.body || {});
});
router.put("/liquidity/products/:code/groups/:groupCode", async (ctx) => {
  ctx.body = await saveLiquidityGroup(ctx.params.code, { ...(ctx.request.body || {}), groupCode: ctx.params.groupCode });
});
router.delete("/liquidity/products/:code/groups/:groupCode", async (ctx) => {
  ctx.body = await deleteLiquidityGroup(ctx.params.code, ctx.params.groupCode, ctx.query);
});
router.post("/liquidity/products/:code/field-groups", async (ctx) => {
  ctx.status = 201;
  ctx.body = await saveLiquidityFieldGroup(ctx.params.code, ctx.request.body || {});
});
router.put("/liquidity/products/:code/field-groups/:groupCode", async (ctx) => {
  ctx.body = await saveLiquidityFieldGroup(ctx.params.code, { ...(ctx.request.body || {}), groupCode: ctx.params.groupCode });
});
router.delete("/liquidity/products/:code/field-groups/:groupCode", async (ctx) => {
  ctx.body = await deleteLiquidityFieldGroup(ctx.params.code, ctx.params.groupCode, ctx.query);
});
router.post("/liquidity/products/:code/rule-scopes", async (ctx) => {
  ctx.status = 201;
  ctx.body = await saveLiquidityRuleScope(ctx.params.code, ctx.request.body || {});
});
router.delete("/liquidity/products/:code/rule-scopes/:id", async (ctx) => {
  ctx.body = await deleteLiquidityRuleScope(ctx.params.id, { ...ctx.query, product_code: ctx.params.code });
});
router.post("/liquidity/products/:code/fields", async (ctx) => {
  ctx.status = 201;
  ctx.body = await saveLiquidityField(ctx.params.code, ctx.request.body || {});
});
router.put("/liquidity/products/:code/fields/:fieldCode", async (ctx) => {
  ctx.body = await saveLiquidityField(ctx.params.code, { ...(ctx.request.body || {}), code: ctx.params.fieldCode });
});
router.delete("/liquidity/products/:code/fields/:fieldCode", async (ctx) => {
  ctx.body = await deleteLiquidityField(ctx.params.code, ctx.params.fieldCode, ctx.query);
});
router.get("/liquidity/rules", async (ctx) => { ctx.body = await liquidityRules(ctx.query); });
router.get("/liquidity/params", async (ctx) => { ctx.body = await liquidityParams(ctx.query); });
router.get("/liquidity/dictionaries", async (ctx) => { ctx.body = await listLiquidityDictionaries(ctx.query); });
router.post("/liquidity/dictionaries", async (ctx) => {
  ctx.status = 201;
  ctx.body = await saveLiquidityDictionary(ctx.request.body || {});
});
router.put("/liquidity/dictionaries/:dictCode", async (ctx) => {
  ctx.body = await saveLiquidityDictionary({ ...(ctx.request.body || {}), dictCode: ctx.params.dictCode });
});
router.delete("/liquidity/dictionaries/:dictCode", async (ctx) => {
  ctx.body = await deleteLiquidityDictionary(ctx.params.dictCode, ctx.query);
});
router.post("/liquidity/dictionaries/:dictCode/items", async (ctx) => {
  ctx.status = 201;
  ctx.body = await saveLiquidityDictionaryItem(ctx.params.dictCode, ctx.request.body || {});
});
router.put("/liquidity/dictionaries/:dictCode/items/:itemCode", async (ctx) => {
  ctx.body = await saveLiquidityDictionaryItem(ctx.params.dictCode, { ...(ctx.request.body || {}), itemCode: ctx.params.itemCode });
});
router.delete("/liquidity/dictionaries/:dictCode/items/:itemCode", async (ctx) => {
  ctx.body = await deleteLiquidityDictionaryItem(ctx.params.dictCode, ctx.params.itemCode, ctx.query);
});

// ---------------------------------------------------------------- 流动性 HQLA
// 判定/抽样/加总/对账/导出在 Flask；这里存任务并转发。

router.get("/hqla/list-meta", async (ctx) => { ctx.body = await listMeta(); });
router.get("/hqla/reference", async (ctx) => { ctx.body = await referenceRows(); });
router.post("/hqla/reference", async (ctx) => { ctx.body = await upsertReference((ctx.request.body || {}).rows || []); });
router.get("/hqla/demo/:kind", async (ctx) => { ctx.body = await demoData(ctx.params.kind); });

router.get("/hqla/tasks/:id", async (ctx) => { ctx.body = await getTask(ctx.params.id); });
router.get("/hqla/tasks/:id/snapshot", async (ctx) => { ctx.body = await getTaskSnapshot(ctx.params.id); });
router.post("/hqla/tasks/:id/products/recognize", async (ctx) => {
  ctx.body = await recognizeTaskProducts(ctx.params.id, ctx.request.body || {});
});
router.get("/hqla/tasks/:id/recognitions", async (ctx) => { ctx.body = await listTaskRecognitions(ctx.params.id, ctx.query || {}); });
router.post("/hqla/tasks/:id/recognitions/confirm", async (ctx) => {
  ctx.body = await confirmTaskRecognitions(ctx.params.id, ctx.request.body || {});
});
router.post("/hqla/tasks/:id/fields/suggest", async (ctx) => {
  ctx.body = await suggestTaskFields(ctx.params.id, ctx.request.body || {});
});
router.get("/hqla/tasks/:id/fields", async (ctx) => { ctx.body = await listTaskFields(ctx.params.id, ctx.query || {}); });
router.post("/hqla/tasks/:id/fields/confirm", async (ctx) => {
  ctx.body = await confirmTaskFields(ctx.params.id, ctx.request.body || {});
});
router.get("/hqla/tasks/:id/preflight", async (ctx) => {
  ctx.body = await preflightTask(ctx.params.id, { allowPartial: ctx.query.allowPartial === "1" || ctx.query.allowPartial === "true" });
});
router.post("/hqla/tasks/:id/quality/run", async (ctx) => {
  ctx.body = await runTaskQuality(ctx.params.id, ctx.request.body || {});
});
router.get("/hqla/tasks/:id/quality/runs", async (ctx) => { ctx.body = await listTaskQualityRuns(ctx.params.id); });
router.get("/hqla/tasks/:id/quality/issues", async (ctx) => { ctx.body = await listTaskQualityIssues(ctx.params.id, ctx.query || {}); });
router.post("/hqla/tasks/:id/runs", async (ctx) => {
  ctx.body = await computeTaskRun(ctx.params.id, ctx.request.body || {});
});
router.get("/hqla/tasks/:id/runs", async (ctx) => { ctx.body = await listTaskRuns(ctx.params.id); });
router.get("/hqla/tasks/:id/audit", async (ctx) => { ctx.body = await listTaskAudit(ctx.params.id); });
router.get("/hqla/tasks/:id/runs/:runId", async (ctx) => { ctx.body = await getTaskRunDetail(ctx.params.id, ctx.params.runId); });
router.get("/hqla/tasks/:id/runs/:runId/results", async (ctx) => {
  ctx.body = await listTaskRunResults(ctx.params.id, ctx.params.runId, ctx.query || {});
});
router.get("/hqla/tasks/:id/runs/:runId/exceptions", async (ctx) => {
  ctx.body = await listTaskRunExceptions(ctx.params.id, ctx.params.runId, ctx.query || {});
});
router.get("/hqla/tasks/:id/runs/:runId/export.xlsx", async (ctx) => {
  const { buffer, filename } = await exportTaskRunWorkbook(ctx.params.id, ctx.params.runId);
  ctx.set("content-type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  ctx.set("content-disposition", `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
  ctx.body = buffer;
});
router.put("/hqla/tasks/:id", async (ctx) => { ctx.body = await updateTask(ctx.params.id, ctx.request.body || {}); });
router.delete("/hqla/tasks/:id", async (ctx) => { ctx.body = await deleteTask(ctx.params.id); });

router.post("/hqla/tasks/:id/identify", async (ctx) => { ctx.body = await identifyTaskDatasets(ctx.params.id); });
router.post("/hqla/tasks/:id/auto-map", async (ctx) => { ctx.body = await mapTaskDatasets(ctx.params.id); });
router.post("/hqla/tasks/:id/quality", async (ctx) => { ctx.body = await qualityTaskDatasets(ctx.params.id); });
router.post("/hqla/tasks/:id/archive", async (ctx) => {
  const body = ctx.request.body || {};
  ctx.body = await archiveTask(ctx.params.id, !!body.archived);
});
router.put("/hqla/tasks/:id/input", async (ctx) => { ctx.body = await saveInput(ctx.params.id, ctx.request.body || {}); });
router.put("/hqla/tasks/:id/datasets", async (ctx) => { ctx.body = await saveDatasets(ctx.params.id, ctx.request.body || {}); });
router.put("/hqla/tasks/:id/datasets/:datasetId", async (ctx) => {
  ctx.body = await saveDatasetMeta(ctx.params.id, ctx.params.datasetId, ctx.request.body || {});
});
router.delete("/hqla/tasks/:id/datasets/:datasetId", async (ctx) => {
  ctx.body = await deleteDataset(ctx.params.id, ctx.params.datasetId);
});
router.put("/hqla/tasks/:id/lists/:code", async (ctx) => { ctx.body = await saveList(ctx.params.id, ctx.params.code, ctx.request.body || {}); });
router.delete("/hqla/tasks/:id/lists/:code", async (ctx) => { ctx.body = await deleteList(ctx.params.id, ctx.params.code); });
router.put("/hqla/tasks/:id/config", async (ctx) => { ctx.body = await saveSimple(ctx.params.id, ctx.request.body || {}, { config: "config" }); });
router.put("/hqla/tasks/:id/sample", async (ctx) => { ctx.body = await saveSimple(ctx.params.id, ctx.request.body || {}, { sample: "sample" }); });
router.put("/hqla/tasks/:id/fetch", async (ctx) => {
  ctx.body = await saveSimple(ctx.params.id, ctx.request.body || {}, { fetchLog: "fetch_log", fetchSig: "fetch_sig" });
});
router.put("/hqla/tasks/:id/reported", async (ctx) => { ctx.body = await saveReported(ctx.params.id, ctx.request.body || {}); });

router.post("/hqla/tasks/:id/compute", async (ctx) => { ctx.body = await computeTask(ctx.params.id); });
router.post("/hqla/tasks/:id/lcr-compute", async (ctx) => { ctx.body = await computeLcr(ctx.params.id); });
router.post("/hqla/tasks/:id/sample", async (ctx) => { ctx.body = await planSample(ctx.params.id); });
router.post("/hqla/tasks/:id/list-hits", async (ctx) => {
  const body = ctx.request.body || {};
  ctx.body = await listHitsFor(ctx.params.id, String(body.code || ""));
});
router.post("/hqla/tasks/:id/export", async (ctx) => {
  const { buffer, filename } = await exportWorkbook(ctx.params.id);
  ctx.set("content-type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  ctx.set("content-disposition", `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
  ctx.body = buffer;
});

router.post("/hqla/inspect", async (ctx) => { ctx.body = await inspectUpload(ctx.request.body || {}); });
router.post("/hqla/parse", async (ctx) => { ctx.body = await parseUpload(ctx.request.body || {}); });
router.post("/hqla/inspect-workbook", async (ctx) => { ctx.body = await inspectWorkbook(ctx.request.body || {}); });
router.post("/hqla/parse-workbook", async (ctx) => { ctx.body = await parseWorkbook(ctx.request.body || {}); });

app.use(cors());
app.use(bodyParser({ jsonLimit: "32mb" }));
app.use((ctx, next) => requestContext.run({ owner: String(ctx.get("x-rwa-user") || "") }, next));
app.use(async (ctx, next) => {
  try {
    await next();
  } catch (err) {
    const status = Number(err.status) || 500;
    ctx.status = status;
    if (status >= 500) console.error(err);
    ctx.body = { error: status >= 500 ? "服务异常" : (err.message || "服务异常") };
  }
});

// V3.5 是唯一正式配置体系。旧表保留读取用于历史版本，但不再接受写入。
const LEGACY_WRITE = /^\/api\/(products|field-mappings|weights|weight-rules|bank-grades|mo-weights|crm|product-rules|ccf|exposure-class)(\/|$)/;
const LEGACY_TREE_WRITE = /^\/api\/exposure-tree\/(copy|delete|save|provision)$/;
app.use(async (ctx, next) => {
  if (ctx.method !== "GET" && ctx.method !== "HEAD" && (LEGACY_WRITE.test(ctx.path) || LEGACY_TREE_WRITE.test(ctx.path))) {
    ctx.throw(409, "旧配置体系已停止写入，请在监管规则维护工作台的 V3.5 配置中维护");
  }
  await next();
});

app.use(router.routes());
app.use(router.allowedMethods());

const port = Number(process.env.PORT || 8780);
app.listen(port, "127.0.0.1", () => {
  console.log("Koa listening on http://127.0.0.1:" + port);
});
