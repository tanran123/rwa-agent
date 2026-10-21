import Koa from "koa";
import Router from "@koa/router";
import cors from "@koa/cors";
import bodyParser from "koa-bodyparser";
import { query } from "./db.js";
import { auditWorkbook, measureDemo } from "./measure.js";
import { paperView, uploadSamples } from "./paper.js";
import { trialEad } from "./ead.js";
import { readEadConfig, saveEadConfig } from "./eadConfig.js";

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
    publishedAt: row.published_at
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
    status: row.status
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
    orgs
  };
});

router.get("/dashboard", async (ctx) => {
  const docs = await query("SELECT body FROM exposure_document WHERE id = 1");
  const doc = json(docs[0] && docs[0].body) || { rules: [] };
  const batches = await query("SELECT * FROM measure_batch ORDER BY created_at, id LIMIT 5");
  const published = await query(
    "SELECT version, jurisdiction FROM rule_version WHERE status = 'published' ORDER BY effective_from DESC LIMIT 1"
  );
  ctx.body = {
    nodeCount: countNodes(doc),
    topRules: (doc.rules || []).length,
    fieldCount: (doc.fields || []).length,
    version: published[0] || null,
    batches: batches.map(batch)
  };
});

router.get("/rule-versions", async (ctx) => {
  const jur = ctx.query.jurisdiction;
  const rows = await query(
    "SELECT * FROM rule_version WHERE (? = '' OR jurisdiction = ?) ORDER BY jurisdiction, effective_from DESC",
    [jur || "", jur || ""]
  );
  ctx.body = rows.map(version);
});

router.get("/clauses", async (ctx) => {
  const jur = ctx.query.jurisdiction || "";
  const q = "%" + (ctx.query.q || "") + "%";
  const rows = await query(
    `SELECT * FROM clause_doc
     WHERE (? = '' OR jurisdiction = ?)
       AND (clause_no LIKE ? OR title LIKE ? OR doc LIKE ?)
     ORDER BY jurisdiction, clause_no`,
    [jur, jur, q, q, q]
  );
  const refs = await query("SELECT clause_id, rule_name FROM clause_ref");
  const byId = {};
  refs.forEach((item) => {
    (byId[item.clause_id] || (byId[item.clause_id] = [])).push(item.rule_name);
  });
  ctx.body = rows.map((row) => ({
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
    referencedBy: byId[row.id] || []
  }));
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

router.get("/field-mappings", async (ctx) => {
  const code = ctx.query.product || "";
  const rows = await query(
    "SELECT * FROM field_mapping WHERE (? = '' OR product_code = ?) ORDER BY id",
    [code, code]
  );
  ctx.body = rows.map((row) => ({
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

router.get("/exposure-class", async (ctx) => {
  const rows = await query("SELECT name, title, source_file, body FROM exposure_document WHERE id = 1");
  if (!rows[0]) ctx.throw(404, "分类 JSON 不在库里");
  ctx.body = {
    name: rows[0].name,
    title: rows[0].title,
    sourceFile: rows[0].source_file,
    document: json(rows[0].body)
  };
});

router.get("/params", async (ctx) => {
  const rows = await query("SELECT id, grp, name, value, unit, used_for AS usedFor FROM rule_param ORDER BY id");
  ctx.body = rows;
});

router.put("/params/:id", async (ctx) => {
  const value = String((ctx.request.body && ctx.request.body.value) || "").trim();
  if (!value) ctx.throw(400, "参数值不能为空");
  const ret = await query("UPDATE rule_param SET value = ? WHERE id = ?", [value, ctx.params.id]);
  if (!ret.affectedRows) ctx.throw(404, "参数不存在");
  const rows = await query("SELECT id, grp, name, value, unit, used_for AS usedFor FROM rule_param WHERE id = ?", [ctx.params.id]);
  ctx.body = rows[0];
});

router.get("/weights", async (ctx) => {
  const [rules, grades, mo] = await Promise.all([
    query("SELECT id, class_name AS cls, cond_text AS cond, risk_weight AS rw, priority AS pri, bank_tier AS bank, basis FROM weight_rule ORDER BY class_name, priority DESC"),
    query("SELECT id, label, priority AS pri, basis, weights_json, ids_json, param_id AS paramId FROM bank_grade_row ORDER BY priority"),
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

router.get("/ead-config", async (ctx) => {
  ctx.body = await readEadConfig(ctx.query.side);
});

router.put("/ead-config", async (ctx) => {
  const body = ctx.request.body || {};
  ctx.body = await saveEadConfig(body.side, body.config);
});

router.post("/ead-trial", async (ctx) => {
  ctx.body = trialEad(ctx.request.body || {});
});

router.get("/ccf", async (ctx) => {
  const rows = await query("SELECT id, type_name AS type, cond_text AS cond, ccf, priority AS pri, conds_json FROM ccf_rule ORDER BY priority DESC");
  ctx.body = rows.map((row) => ({ ...row, conds: json(row.conds_json) }));
});

router.get("/crm", async (ctx) => {
  const rows = await query("SELECT id, type_name AS type, tool, substitute, floor_param AS floorParam, constraints_json, priority AS pri FROM crm_rule ORDER BY priority DESC");
  ctx.body = rows.map((row) => ({ ...row, constraints: json(row.constraints_json) }));
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
  const id = "BATCH-" + new Date().toISOString().slice(0, 10).replace(/-/g, "") + "-" + Math.random().toString(36).slice(2, 6).toUpperCase();
  const row = {
    id,
    name: body.name || "新建计量批次",
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
  ctx.body = { ...row, imported: 0, success: 0, exception: 0, onEad: 0, offEad: 0, ead: 0, rwa: 0 };
});

router.get("/measure", async (ctx) => {
  ctx.body = measureDemo();
});

router.get("/working-paper", async (ctx) => {
  ctx.body = paperView(ctx.query.offset, ctx.query.limit);
});

router.get("/upload-samples", async (ctx) => {
  ctx.body = uploadSamples();
});

router.get("/audit.xlsx", async (ctx) => {
  const body = auditWorkbook();
  ctx.set("content-type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  ctx.set("content-disposition", "attachment; filename*=UTF-8''" + encodeURIComponent("信用风险RWA审计底稿.xlsx"));
  ctx.body = body;
});

router.get("/assistant", async (ctx) => {
  const rows = await query("SELECT seq, role, body FROM assistant_turn ORDER BY seq");
  ctx.body = rows.map((row) => ({ seq: row.seq, ...(json(row.body) || {}), role: row.role }));
});

router.post("/agent/chat", async (ctx) => {
  try {
    const response = await fetch("http://127.0.0.1:8766/api/agent/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(ctx.request.body || {})
    });
    const text = await response.text();
    let body;
    try { body = text ? JSON.parse(text) : { error: "智能体没有返回" }; }
    catch { body = { error: "智能体没有返回可读内容" }; }
    ctx.status = response.status;
    ctx.body = body;
  } catch (err) {
    ctx.status = 502;
    ctx.body = { error: "智能体服务没开，或暂时连不上。" };
  }
});

router.post("/rules/chat", async (ctx) => {
  try {
    const response = await fetch("http://127.0.0.1:8766/api/rules/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(ctx.request.body || {})
    });
    const text = await response.text();
    let body;
    try { body = text ? JSON.parse(text) : { error: "规则对话没有返回" }; }
    catch { body = { error: "规则对话没有返回可读内容" }; }
    ctx.status = response.status;
    ctx.body = body;
  } catch (err) {
    ctx.status = 502;
    ctx.body = { error: "规则对话服务没开，或暂时连不上。" };
  }
});

app.use(cors());
app.use(bodyParser());
app.use(async (ctx, next) => {
  try {
    await next();
  } catch (err) {
    const status = err.status || 500;
    ctx.status = status;
    ctx.body = { error: status === 500 ? "数据库还没连上，或表还没建。" : err.message };
    if (status === 500) console.error(err);
  }
});
app.use(router.routes());
app.use(router.allowedMethods());

const port = Number(process.env.PORT || 8780);
app.listen(port, "127.0.0.1", () => {
  console.log("Koa listening on http://127.0.0.1:" + port);
});
