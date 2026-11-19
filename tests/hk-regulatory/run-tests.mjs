/**
 * 香港 STC 监管配置 + 信用风险 RWA 计量向导自动化测试。
 *
 * 运行：
 *   node tests/hk-regulatory/run-tests.mjs
 *
 * 可用环境变量：
 *   PLAYWRIGHT_CORE  playwright-core 模块路径
 *   CHROME_PATH      Chromium 可执行文件路径
 *   BASE_URL         默认 http://127.0.0.1:5173
 */
import { createRequire } from "module";
import { readFileSync, mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { pool, query } from "../../server/src/db.js";

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = join(ROOT, "output/tests/hk-regulatory", new Date().toISOString().replace(/[:.]/g, "-"));
mkdirSync(OUT, { recursive: true });

const PLAYWRIGHT_CORE = process.env.PLAYWRIGHT_CORE
  || "/Users/tlliu/Library/Application Support/QClaw/openclaw/node_modules/playwright-core";
const CHROME_PATH = process.env.CHROME_PATH
  || "/Users/tlliu/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const BASE_URL = process.env.BASE_URL || "http://127.0.0.1:5173";
const VERSION = "HK-SA-2026.1";
const ONLY = new Set(String(process.env.ONLY || "").split(",").map((item) => item.trim()).filter(Boolean));
const FIXTURE_20 = join(ROOT, "tests/hk-regulatory/fixtures/STC_20_CASES.xlsx");
const FIXTURE_BAD = join(ROOT, "tests/hk-regulatory/fixtures/INCOMPLETE_LOAN.xlsx");
const FIXTURE_FULL = join(ROOT, "tests/hk-regulatory/fixtures/STC_LOAN_FULL.xlsx");
const FAMILIES = {
  LOAN: { label: "贷款产品", fields: 124 },
  BOND: { label: "债券产品", fields: 91 },
  INTERBANK: { label: "同业与存款", fields: 86 },
  SFT: { label: "证券融资", fields: 79 },
  DERIVATIVE: { label: "衍生工具", fields: 83 },
  EQUITY: { label: "股权与资本工具", fields: 74 },
  OFF_BALANCE: { label: "表外业务", fields: 87 },
  TREASURY: { label: "资金与结算", fields: 65 }
};

const results = [];
let page = null;
let browser = null;
let eadBackup = { configs: [], rules: [] };
let listBackup = [];
let eadReady = false;
let wiz20 = null;
let savedBatchId = "";
let createdTaskId = "";

function pass(id, name, actual = "") {
  results.push({ id, name, status: "PASS", actual, at: new Date().toISOString() });
  console.log(`PASS ${id} ${name}`);
}
function fail(id, name, error) {
  results.push({ id, name, status: "FAIL", actual: String(error && error.message || error), at: new Date().toISOString() });
  console.log(`FAIL ${id} ${name}:`, error && error.message || error);
}
function skip(id, name, reason) {
  results.push({ id, name, status: "SKIP", actual: reason, at: new Date().toISOString() });
  console.log(`SKIP ${id} ${name}: ${reason}`);
}
async function test(id, name, fn) {
  if (ONLY.size && !ONLY.has(id)) return;
  try {
    const actual = await fn();
    pass(id, name, typeof actual === "string" ? actual : JSON.stringify(actual));
  } catch (error) {
    fail(id, name, error);
  }
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}
function equal(actual, expected, message) {
  if (actual !== expected) throw new Error((message || "值不一致") + "：实际 " + actual + "，预期 " + expected);
}
function includes(text, part, message) {
  if (!String(text || "").includes(part)) throw new Error((message || "文本不包含") + "：" + part);
}

async function api(path, { method = "GET", body, retry = 1 } = {}) {
  let last = null;
  for (let attempt = 0; attempt <= retry; attempt += 1) {
    try {
      return await page.evaluate(async ({ path, method, body }) => {
        const response = await fetch(path, {
          method,
          headers: { "Content-Type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body)
        });
        const text = await response.text();
        let data = null;
        try { data = text ? JSON.parse(text) : null; } catch { data = text; }
        if (!response.ok) {
          const error = new Error(path + " " + response.status + " " + (typeof data === "string" ? data : JSON.stringify(data)));
          error.status = response.status;
          error.data = data;
          throw error;
        }
        return data;
      }, { path, method, body });
    } catch (error) {
      last = error;
      if (attempt < retry) await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  throw last;
}

async function apiBinary(path) {
  return page.evaluate(async (url) => {
    const response = await fetch(url);
    const buffer = await response.arrayBuffer();
    return { ok: response.ok, status: response.status, size: buffer.byteLength, type: response.headers.get("content-type") || "" };
  }, path);
}

async function login() {
  await page.goto(BASE_URL + "/login", { waitUntil: "networkidle" });
  await page.fill("#loginUser", "admin");
  await page.fill("#loginPass", "admin123");
  await page.click("button[type=submit]");
  await page.waitForTimeout(1600);
}

async function openHkExposure() {
  await page.goto(BASE_URL + "/exposure-config?jurisdiction=HK&version=" + VERSION, { waitUntil: "networkidle" });
  await page.waitForTimeout(1400);
}

function jsonText(value) {
  if (value == null) return null;
  return typeof value === "string" ? value : JSON.stringify(value);
}

async function snapshotEad() {
  eadBackup = {
    configs: await query("SELECT * FROM ead_product_config"),
    rules: await query("SELECT * FROM ead_product_rule")
  };
}

async function restoreEad() {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query("DELETE FROM ead_product_rule");
    await conn.query("DELETE FROM ead_product_config");
    for (const row of eadBackup.configs) {
      await conn.query("INSERT INTO ead_product_config SET ?", row);
    }
    for (const row of eadBackup.rules) {
      const copy = { ...row };
      ["conditions_json", "fields_json", "structured_json", "params_json"].forEach((key) => {
        if (copy[key] != null) copy[key] = jsonText(copy[key]);
      });
      await conn.query("INSERT INTO ead_product_rule SET ?", copy);
    }
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

async function setupEad() {
  const config = await api("/api/ead-config", { retry: 2 });
  const products = (config.products || []).filter((item) => item.ruleVersion === VERSION && FAMILIES[item.code]);
  if (!products.length) throw new Error("香港产品族为空");
  const payload = {
    version: VERSION,
    products: products.map((item) => {
      const off = item.code === "OFF_BALANCE";
      return {
        code: item.code,
        ruleVersion: item.ruleVersion,
        needed: true,
        reason: "自动化测试配置",
        side: off ? "off" : "on",
        rules: [{
          id: "TEST-EAD-" + item.code,
          name: item.code + " 自动化测试 EAD",
          condition: "",
          conditions: { all: [] },
          formula: "EAD = exposure_amount",
          precision: 2,
          rounding: "四舍五入",
          resultField: off ? "off_balance_ead" : "on_balance_ead",
          clause: "TEST",
          status: "draft",
          ccf: off ? 0.5 : null,
          params: []
        }]
      };
    })
  };
  await api("/api/ead-config", { method: "PUT", body: { config: payload }, retry: 2 });
  eadReady = true;
}

async function setupLists() {
  const ids = ["L_STC_SOVEREIGN", "L_STC_PSE_LOCAL"];
  const rows = await query("SELECT id, list_id, columns_json, rows_json FROM rule_list WHERE jurisdiction='HK' AND list_id IN (?,?)", ids);
  listBackup = rows.map((row) => ({
    id: row.id,
    rows_json: Array.isArray(row.rows_json) ? row.rows_json : JSON.parse(row.rows_json || "[]")
  }));
  for (const row of rows) {
    const columns = Array.isArray(row.columns_json) ? row.columns_json : JSON.parse(row.columns_json || "[]");
    const data = Array.isArray(row.rows_json) ? row.rows_json : JSON.parse(row.rows_json || "[]");
    const entity = row.list_id === "L_STC_SOVEREIGN" ? "SOV-TEST" : "PSE-TEST";
    if (!data.some((item) => Array.isArray(item) && item[columns.indexOf("entity_id")] === entity)) {
      data.push(columns.map((column) => column === "entity_id" ? entity : column === "entity_level" ? "NATIONAL" : column === "status" ? "ACTIVE" : ""));
    }
    await query("UPDATE rule_list SET rows_json=? WHERE id=?", [JSON.stringify(data), row.id]);
  }
}

async function restoreLists() {
  for (const item of listBackup) {
    await query("UPDATE rule_list SET rows_json=? WHERE id=?", [JSON.stringify(item.rows_json), item.id]);
  }
}

async function fetchDocs() {
  const meta = await api("/api/rule-documents?jurisdiction=HK&version=" + VERSION, { retry: 2 });
  const docs = [];
  for (const item of meta) docs.push(await api("/api/rule-documents/" + encodeURIComponent(item.id), { retry: 2 }));
  return docs;
}

function walkRules(nodes, visit) {
  (nodes || []).forEach((node) => {
    visit(node);
    walkRules(node.children, visit);
    if (node.otherwise) walkRules([node.otherwise], visit);
  });
}

function collectConditionFields(condition, fields) {
  if (!condition || typeof condition !== "object") return;
  if (condition.field) fields.add(condition.field);
  (condition.all || []).forEach((item) => collectConditionFields(item, fields));
  (condition.any || []).forEach((item) => collectConditionFields(item, fields));
  if (condition.not) collectConditionFields(condition.not, fields);
}

async function run20Api() {
  const content = readFileSync(FIXTURE_20).toString("base64");
  const up = await api("/api/measure/workbook", {
    method: "POST",
    body: { filename: "STC_20_CASES.xlsx", content, headerRow: 1, version: VERSION, jurisdiction: "HK" },
    retry: 2
  });
  const products = {};
  up.intake.loans.forEach((loan) => { if (loan.product) products[loan.id] = loan.product; });
  const codes = [...new Set(Object.values(products))];
  const columns = {};
  Object.entries(up.intake.mappings || {}).forEach(([code, items]) => {
    const map = {};
    items.forEach((item) => { if (item.column) map[item.stdCode] = item.column; });
    if (Object.keys(map).length) columns[code] = map;
  });
  const mapped = { mappings: up.intake.mappings || {} };
  await api("/api/measure/apply", {
    method: "POST",
    body: { uploadId: up.uploadId, headerRow: 1, version: VERSION, jurisdiction: "HK", products, columns },
    retry: 2
  });
  const classified = await api("/api/measure/classify", {
    method: "POST", body: { uploadId: up.uploadId, version: VERSION }, retry: 2
  });
  const weighted = await api("/api/measure/weight", {
    method: "POST", body: { uploadId: up.uploadId, version: VERSION }, retry: 2
  });
  return { up, mapped, classified, weighted, products, codes, columns };
}

async function runBadApi() {
  const content = readFileSync(FIXTURE_BAD).toString("base64");
  const up = await api("/api/measure/workbook", {
    method: "POST",
    body: { filename: "INCOMPLETE_LOAN.xlsx", content, headerRow: 1, version: VERSION, jurisdiction: "HK" }
  });
  const products = {};
  up.intake.loans.forEach((loan) => { if (loan.product) products[loan.id] = loan.product; });
  const columns = {};
  Object.entries(up.intake.mappings || {}).forEach(([code, items]) => {
    const map = {};
    items.forEach((item) => { if (item.column) map[item.stdCode] = item.column; });
    if (Object.keys(map).length) columns[code] = map;
  });
  await api("/api/measure/apply", { method: "POST", body: { uploadId: up.uploadId, headerRow: 1, version: VERSION, jurisdiction: "HK", products, columns } });
  const classified = await api("/api/measure/classify", { method: "POST", body: { uploadId: up.uploadId, version: VERSION } });
  const weighted = await api("/api/measure/weight", { method: "POST", body: { uploadId: up.uploadId, version: VERSION } });
  return { up, classified, weighted };
}

async function dbQuery(sql, params = [], retry = 3) {
  let last = null;
  for (let attempt = 0; attempt <= retry; attempt += 1) {
    try { return await query(sql, params); }
    catch (error) { last = error; await new Promise((resolve) => setTimeout(resolve, 1200)); }
  }
  throw last;
}

async function cleanupBatch(batchId) {
  await dbQuery("DELETE FROM measure_line WHERE batch_id = ?", [batchId]);
  await dbQuery("DELETE FROM measure_batch WHERE id = ?", [batchId]);
}

async function main() {
  const { chromium } = require(PLAYWRIGHT_CORE);
  browser = await chromium.launch({ headless: true, executablePath: CHROME_PATH });
  page = await browser.newPage({ viewport: { width: 1680, height: 1100 } });
  page.on("pageerror", (error) => console.log("pageerror", error.message));
  await login();
  await snapshotEad();
  await setupLists();

  // ------------------------------------------------------------ A. 配置准确性
  let docs = null;
  await test("REG-01", "香港监管版本和规则文档可读取", async () => {
    const versions = await api("/api/rule-documents?jurisdiction=HK&version=" + VERSION);
    assert(versions.length >= 11, "香港规则文档数量不足");
    return versions.length + " 份文档";
  });

  await test("REG-02", "暴露分类文档标识和版本", async () => {
    docs = await fetchDocs();
    const doc = docs.find((item) => item.kind === "exposure_classification");
    assert(doc, "缺少暴露分类文档");
    equal(doc.name, "STC_EXPOSURE_CLASSIFICATION", "文档名");
    equal(doc.docVersion, "1.2.0", "文档版本");
    return doc.id;
  });

  await test("REG-29", "规则文档 ID 与文档版本一致", async () => {
    if (!docs) docs = await fetchDocs();
    const bad = docs.filter((item) => !String(item.id).includes(item.docVersion)).map((item) => item.id + " / " + item.docVersion);
    equal(bad.length, 0, "ID 与 doc_version 不一致：" + bad.join("；"));
    return docs.length + " 份文档 ID 一致";
  });

  await test("REG-03", "暴露分类文档校验通过", async () => {
    assert(docs, "前置文档读取失败");
    const doc = docs.find((item) => item.kind === "exposure_classification");
    const result = await api("/api/rule-documents/" + encodeURIComponent(doc.id) + "/validate", { method: "POST" });
    equal(result.ok, true, "校验结果");
    equal(result.errors.length, 0, "错误数");
    return "0 个错误";
  });

  await test("REG-04", "暴露分类结构数量正确", async () => {
    const doc = docs.find((item) => item.kind === "exposure_classification").body;
    let nodes = 0;
    walkRules(doc.rules, () => { nodes += 1; });
    equal(doc.rules.length, 22, "顶层规则");
    equal(nodes, 34, "规则节点");
    equal(doc.fields.length, 91, "字段");
    equal(doc.field_groups.length, 12, "字段分组");
    return { rules: doc.rules.length, nodes, fields: doc.fields.length, groups: doc.field_groups.length };
  });

  await test("REG-05", "风险权重文档标识和版本", async () => {
    const doc = docs.find((item) => item.kind === "risk_weight");
    assert(doc, "缺少风险权重文档");
    equal(doc.name, "STC_RISK_WEIGHT", "文档名");
    equal(doc.docVersion, "1.2.0", "文档版本");
    return doc.id;
  });

  await test("REG-06", "风险权重文档校验通过", async () => {
    const doc = docs.find((item) => item.kind === "risk_weight");
    const result = await api("/api/rule-documents/" + encodeURIComponent(doc.id) + "/validate", { method: "POST" });
    equal(result.ok, true, "校验结果");
    equal(result.errors.length, 0, "错误数");
    return "0 个错误";
  });

  await test("REG-07", "风险权重结构数量正确", async () => {
    const doc = docs.find((item) => item.kind === "risk_weight").body;
    let nodes = 0;
    walkRules(doc.rules, () => { nodes += 1; });
    equal(doc.rules.length, 21, "顶层规则");
    equal(nodes, 97, "规则节点");
    equal(doc.fields.length, 129, "字段");
    equal(doc.field_groups.length, 15, "字段分组");
    return { rules: doc.rules.length, nodes, fields: doc.fields.length, groups: doc.field_groups.length };
  });

  await test("REG-08", "产品注册版本和校验", async () => {
    const doc = docs.find((item) => item.kind === "product_registry");
    assert(doc, "缺少产品注册");
    equal(doc.docVersion, "1.1.0", "产品注册版本");
    const result = await api("/api/rule-documents/" + encodeURIComponent(doc.id) + "/validate", { method: "POST" });
    equal(result.ok, true, "校验结果");
    equal(result.errors.length, 0, "错误数");
    return doc.id;
  });

  let products = null;
  await test("REG-09", "产品族清单为 8 个", async () => {
    products = await api("/api/product-standard/products?version=" + VERSION);
    equal(products.length, 8, "产品族数量");
    const codes = products.map((item) => item.code).sort();
    equal(codes.join(","), "BOND,DERIVATIVE,EQUITY,INTERBANK,LOAN,OFF_BALANCE,SFT,TREASURY", "产品族编码");
    return codes.join(",");
  });

  await test("REG-10", "产品代码和业务产品组代码 80 个且唯一", async () => {
    assert(products, "前置产品清单失败");
    const all = products.flatMap((item) => item.productCodes || []);
    equal(new Set(all).size, all.length, "产品代码唯一性");
    equal(all.length, 80, "产品代码和业务产品组代码总数");
    return all.length + " 个产品代码（含业务产品组）";
  });

  await test("REG-11", "标准字段数量和产品族一致", async () => {
    for (const product of products) {
      equal(product.fields.length, FAMILIES[product.code].fields, product.code + " 字段数");
    }
    const total = products.reduce((sum, item) => sum + item.fields.length, 0);
    equal(total, 689, "标准字段合计");
    return total + " 个标准字段";
  });

  await test("REG-12", "标准字段分组和层级合法", async () => {
    const levels = new Set(["OBLIGOR", "FACILITY", "COLLATERAL", "SETTLEMENT", "PORTFOLIO", "DATA_PREP", "OUTPUT"]);
    for (const product of products) {
      const groups = new Set((product.standardFieldGroups || []).map((item) => item.group_id));
      for (const field of product.fields) {
        assert(groups.has(field.group), product.code + " 字段 " + field.code + " 分组未声明");
        if (field.level) assert(levels.has(field.level), product.code + " 字段 " + field.code + " 层级非法");
      }
    }
    return "全部合法";
  });

  await test("REG-13", "候选暴露类型都属于分类输出", async () => {
    const doc = docs.find((item) => item.kind === "exposure_classification").body;
    const classes = new Set();
    walkRules(doc.rules, (node) => {
      if (node.result && node.result.exposure_class) classes.add(node.result.exposure_class);
    });
    if (doc.otherwise && doc.otherwise.exposure_class) classes.add(doc.otherwise.exposure_class);
    for (const product of products) {
      for (const code of product.candidateExposureClasses || []) {
        assert(classes.has(code), product.code + " 候选类别 " + code + " 不在分类输出中");
      }
    }
    return classes.size + " 个分类输出类别";
  });

  let mappingDocs = null;
  await test("REG-14", "字段映射文档完整且校验通过", async () => {
    mappingDocs = docs.filter((item) => item.kind === "data_mapping");
    equal(mappingDocs.length, 8, "字段映射文档数");
    for (const doc of mappingDocs) {
      const result = await api("/api/rule-documents/" + encodeURIComponent(doc.id) + "/validate", { method: "POST" });
      equal(result.ok, true, doc.name + " 校验");
      equal(result.errors.length, 0, doc.name + " 错误数");
    }
    return mappingDocs.length + " 份";
  });

  await test("REG-15", "映射源字段都在产品标准字段中", async () => {
    for (const product of products) {
      const doc = mappingDocs.find((item) => item.body && item.body.mapping_name === product.dataMappingRef);
      assert(doc, product.code + " 缺少映射文档");
      const fields = new Set(product.fields.map((item) => item.code));
      for (const mapping of doc.body.mappings || []) {
        assert(fields.has(mapping.source_field), product.code + " 映射源字段 " + mapping.source_field + " 不在标准字段中");
      }
    }
    return "全部匹配";
  });

  await test("REG-16", "规则引用的输入字段都有映射", async () => {
    const classification = docs.find((item) => item.kind === "exposure_classification").body;
    const weight = docs.find((item) => item.kind === "risk_weight").body;
    const derived = new Set([...(classification.fields || []), ...(weight.fields || [])].filter((field) => field.derivation).map((field) => field.name));
    const refs = new Set();
    [classification, weight].forEach((doc) => walkRules(doc.rules, (node) => {
      collectConditionFields(node.when, refs);
      (node.adjustments || []).forEach((item) => collectConditionFields(item.when, refs));
    }));
    const targets = new Set();
    mappingDocs.forEach((doc) => (doc.body.mappings || []).forEach((item) => targets.add(item.target_field)));
    const missing = [...refs].filter((field) => field !== "exposure_class" && !derived.has(field) && !targets.has(field));
    equal(missing.length, 0, "未映射规则输入字段：" + missing.join(","));
    return refs.size + " 个引用字段";
  });

  await test("REG-17", "参数表和名单数量及规则引用", async () => {
    const tables = await api("/api/parameter-tables?jurisdiction=HK");
    const lists = await api("/api/reference-lists?jurisdiction=HK");
    equal(tables.length, 23, "参数表数量");
    equal(lists.length, 7, "名单数量");
    const tableIds = new Set(tables.map((item) => item.tableId));
    const listIds = new Set(lists.map((item) => item.listId));
    for (const doc of docs.filter((item) => ["exposure_classification", "risk_weight"].includes(item.kind))) {
      (doc.body.tables || []).forEach((item) => assert(tableIds.has(item.table_id || item.id), "缺少参数表 " + (item.table_id || item.id)));
      (doc.body.lists || []).forEach((item) => assert(listIds.has(item.list_id || item.id), "缺少名单 " + (item.list_id || item.id)));
    }
    return { tables: tables.length, lists: lists.length };
  });

  await test("REG-18", "规则 ID 唯一且字段引用存在", async () => {
    for (const doc of docs.filter((item) => ["exposure_classification", "risk_weight"].includes(item.kind))) {
      const fieldNames = new Set((doc.body.fields || []).map((field) => field.name));
      const ids = new Set();
      const refs = new Set();
      walkRules(doc.body.rules, (node) => {
        assert(node.id, doc.name + " 存在无 id 节点");
        assert(!ids.has(node.id), doc.name + " 规则 id 重复：" + node.id);
        ids.add(node.id);
        collectConditionFields(node.when, refs);
      });
      for (const field of refs) assert(fieldNames.has(field), doc.name + " 条件引用未定义字段：" + field);
    }
    return "唯一且字段存在";
  });

  await test("REG-19", "产品族显示名称正确", async () => {
    for (const product of products) equal(product.label, FAMILIES[product.code].label, product.code + " 名称");
    return "全部正确";
  });

  // ------------------------------------------------------------ 配置页面 UI
  await test("REG-20", "产品管理首页卡片、列表和搜索", async () => {
    await openHkExposure();
    await page.locator(".version-nav button", { hasText: "产品标准字段" }).click();
    await page.waitForSelector(".pr-card", { timeout: 12000 });
    await page.waitForTimeout(400);
    equal(await page.locator(".pr-card").count(), 8, "卡片数量");
    await page.locator(".pr-seg button", { hasText: "列表" }).click();
    await page.waitForTimeout(400);
    equal(await page.locator(".pr-table tbody tr").count(), 8, "列表行数");
    await page.locator(".pr-toolbar .pr-search").fill("贷款");
    await page.waitForTimeout(300);
    equal(await page.locator(".pr-table tbody tr").count(), 1, "搜索后行数");
    includes(await page.locator(".pr-table tbody tr").first().innerText(), "贷款产品", "搜索结果");
    await page.locator(".pr-seg button", { hasText: "卡片" }).click();
    await page.waitForTimeout(300);
    return "8/8，搜索 1";
  });

  await test("REG-21", "产品组信息页签", async () => {
    if (!(await page.locator(".pr-card").count())) {
      await openHkExposure();
      await page.locator(".version-nav button", { hasText: "产品标准字段" }).click();
      await page.waitForSelector(".pr-card", { timeout: 12000 });
    }
    await page.locator(".pr-card", { hasText: "贷款产品" }).first().click();
    await page.waitForTimeout(1800);
    includes(await page.locator(".pws-head-metrics").innerText(), "124", "标准字段");
    includes(await page.locator(".pws-head-metrics").innerText(), "54 / 54", "Mapping");
    includes(await page.locator(".pws-head-metrics").innerText(), "13 / 30", "规则节点");
    const tabs = await page.locator(".pws-modtabs button").allInnerTexts();
    assert(tabs.length >= 4, "模块页签不足 4 个");
    ["产品组信息", "标准字段", "字段映射", "规则预览"].forEach((label) => assert(tabs.includes(label), "缺少页签 " + label));
    equal(await page.locator(".pws-expcard.on").count(), 8, "已选候选类别");
    equal(await page.locator(".pws-group-card").count(), 5, "贷款业务产品组");
    return "124 / 54-54 / 13-30 / 8 类 / 5 个业务产品组";
  });

  await test("REG-22", "产品标准字段页签", async () => {
    await page.locator(".pws-modtabs button", { hasText: "标准字段" }).click();
    await page.waitForSelector(".pws-fieldtable", { timeout: 6000 });
    await page.waitForTimeout(300);
    const fieldHead = await page.locator(".panel-head").filter({ hasText: "产品标准字段" }).innerText();
    includes(fieldHead, "124 个字段", "字段数");
    equal(await page.locator(".pws-fieldtable tr.grp").count(), 11, "分组数");
    return "124 个字段，11 个分组";
  });

  await test("REG-23", "字段映射页签分组来源", async () => {
    await page.locator(".pws-modtabs button", { hasText: "字段映射" }).click();
    await page.waitForTimeout(1800);
    const left = page.locator(".fm-side").first();
    const right = page.locator(".fm-side").last();
    includes(await left.locator(".fm-group-head").first().innerText(), "产品与交易识别", "左侧标准字段分组");
    includes(await right.locator(".fm-group-head").first().innerText(), "产品与交易识别", "右侧规则字段分组");
    return "左右分组均按字段分组";
  });

  await test("REG-24", "规则预览页签和候选过滤", async () => {
    await page.locator(".pws-modtabs button", { hasText: "规则预览" }).click();
    await page.waitForTimeout(1200);
    equal(await page.locator(".xp-tabs button").count(), 4, "规则视图数");
    equal(await page.locator(".xp-lane").count(), 5, "贷款产品触达车道数");
    await page.locator(".xp-tabs button", { hasText: "JSON 配置" }).click();
    await page.waitForTimeout(800);
    includes(await page.locator("body").innerText(), "STC v3.5", "JSON 版本标识");
    return "4 个视图，5 条车道，v3.5";
  });

  await test("REG-25", "敞口划分四个视图和 8 条业务分支", async () => {
    await openHkExposure();
    equal(await page.locator(".xp-tabs button").count(), 4, "视图数");
    equal(await page.locator(".xp-lane").count(), 8, "业务分支数");
    return "4 个视图，8 条分支";
  });

  await test("REG-26", "EAD 页面产品来源", async () => {
    await page.locator(".version-nav button", { hasText: "EAD 计算规则" }).click();
    await page.waitForTimeout(1500);
    equal(await page.locator(".ead-item").count(), 8, "产品族数");
    await page.locator(".ead-item", { hasText: "贷款产品" }).first().click();
    await page.waitForTimeout(400);
    includes(await page.locator(".ead-right-head").innerText(), "124", "标准字段数");
    return "8 个产品族，贷款 124 字段";
  });

  await test("REG-27", "信用风险缓释页面产品来源", async () => {
    await page.goto(BASE_URL + "/exposure-config?jurisdiction=HK&version=" + VERSION, { waitUntil: "networkidle" });
    await page.waitForTimeout(1000);
    await page.locator(".version-nav button", { hasText: "信用风险缓释" }).click();
    await page.waitForTimeout(1500);
    equal(await page.locator(".ead-item").count(), 8, "产品族数");
    await page.locator(".ead-item", { hasText: "贷款产品" }).first().click();
    await page.waitForTimeout(400);
    includes(await page.locator(".ead-right-head").innerText(), "124", "标准字段数");
    return "8 个产品族，贷款 124 字段";
  });

  await test("REG-28", "产品标准字段接口", async () => {
    const list = await api("/api/product-standard/products?version=" + VERSION);
    equal(list.length, 8, "产品数");
    equal(list.reduce((sum, item) => sum + item.fields.length, 0), 689, "字段数");
    return "8 个产品，689 个字段";
  });

  await test("REG-30", "业务产品组和自动映射覆盖", async () => {
    const groups = await api("/api/product-standard/group-mappings?version=" + VERSION);
    equal(groups.groups.length, 13, "业务产品组数");
    const failed = groups.groups.filter((item) => item.coveragePct !== 100);
    equal(failed.length, 0, "映射覆盖不足的组：" + failed.map((item) => item.groupCode + ":" + item.coveragePct).join(","));
    for (const item of groups.groups) assert(item.candidateExposureClasses.length > 0, item.groupCode + " 没有候选暴露类型");
    return "13 个业务产品组，映射覆盖率全部 100%";
  });

  // ------------------------------------------------------------ B. 计量向导
  await page.goto(BASE_URL + "/wizard", { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  await test("WIZ-01", "向导 9 步顺序", async () => {
    const labels = await page.locator(".stepper .step, .steps .step").allInnerTexts();
    const expected = ["选择计量范围","导入 Excel 债项明细","识别产品类型","字段映射确认","执行暴露分类","执行风险权重","执行 EAD 计算","执行信用风险缓释","计算 RWA 并查看结果"];
    equal(labels.length, 9, "步骤数");
    labels.forEach((text, index) => includes(text, expected[index], "第 " + (index + 1) + " 步"));
    return labels.map((text) => text.replace(/\n/g, " ")).join(" → ");
  });

  await test("WIZ-02", "香港版本产品统计", async () => {
    await page.locator(".field select").nth(0).selectOption({ label: "香港" });
    await page.waitForTimeout(400);
    const version = page.locator(".field select").nth(1);
    const options = await version.locator("option").allInnerTexts();
    const index = options.findIndex((item) => item.includes(VERSION));
    assert(index >= 0, "没有 HK-SA-2026.1");
    await version.selectOption({ index });
    await page.waitForTimeout(800);
    const kpi = await page.locator(".kpi", { hasText: "该版本产品字段" }).innerText();
    includes(kpi, "689", "字段数");
    includes(kpi, "8 个产品", "产品数");
    return kpi.replace(/\n/g, " / ");
  });

  await test("WIZ-03", "导入 20 案例工作簿", async () => {
    await page.locator("button", { hasText: "确认范围，下一步" }).click();
    await page.waitForTimeout(400);
    await page.locator("input[type=file]").setInputFiles(FIXTURE_20);
    await page.waitForFunction(() => document.body.innerText.includes("20 行"), null, { timeout: 12000 });
    const text = await page.locator("body").innerText();
    includes(text, "20 行", "导入行数");
    return "20 行";
  });

  // 后续 API 用例先准备测试 EAD 配置
  try {
    await setupEad();
  } catch (error) {
    eadReady = false;
    console.log("EAD 测试配置失败:", error.message);
  }

  await test("WIZ-04", "识别产品类型 20 笔覆盖 8 个产品族", async () => {
    wiz20 = await run20Api();
    const families = new Set(wiz20.up.intake.loans.map((loan) => loan.product).filter(Boolean));
    equal(wiz20.up.intake.loans.length, 20, "债项数");
    equal(wiz20.up.intake.loans.filter((loan) => loan.product).length, 20, "已识别产品数");
    equal(families.size, 8, "产品族数");
    return [...families].sort().join(",");
  });

  await test("WIZ-05", "字段映射来自产品标准字段", async () => {
    assert(wiz20, "前置 20 案例失败");
    const loan = wiz20.mapped.mappings.LOAN || [];
    equal(loan.length, 124, "贷款产品映射建议数");
    assert(loan.some((item) => item.constant), "没有常量字段");
    assert(loan.some((item) => item.column), "没有匹配到 Excel 列的字段");
    return "124 个标准字段建议，含常量字段";
  });

  await test("WIZ-06", "20 笔全部完成暴露分类", async () => {
    assert(wiz20, "前置 20 案例失败");
    const rows = wiz20.classified.results;
    equal(rows.length, 20, "结果数");
    equal(rows.filter((row) => row.status === "exception").length, 0, "分类异常数");
    const classes = new Set(rows.map((row) => row.exposureClass));
    assert(classes.size >= 12, "暴露类别覆盖不足：" + classes.size);
    return classes.size + " 个暴露类别：" + [...classes].sort().join(",");
  });

  await test("WIZ-07", "分类步骤不输出风险权重", async () => {
    assert(wiz20, "前置 20 案例失败");
    const withWeight = wiz20.classified.results.filter((row) => row.riskWeight != null);
    equal(withWeight.length, 0, "分类结果携带风险权重的笔数");
    return "0 笔携带风险权重";
  });

  await test("WIZ-08", "风险权重执行结果", async () => {
    assert(wiz20, "前置 20 案例失败");
    if (!eadReady) throw new Error("EAD 测试配置未就绪");
    const summary = wiz20.weighted.weight.summary;
    equal(summary.determined, 16, "已确定权重");
    equal(summary.manual, 4, "人工复核");
    equal(summary.blocked, 0, "阻断");
    return JSON.stringify(summary);
  });

  await test("WIZ-09", "代表案例分类和权重正确", async () => {
    assert(wiz20, "前置 20 案例失败");
    const byCode = {};
    wiz20.weighted.results.forEach((row) => {
      const loan = wiz20.weighted.intake.loans.find((item) => item.id === row.loanId);
      byCode[loan.raw["Product Code"]] = row;
    });
    const expected = {
      CORPORATE_LOAN: ["CORPORATE", "20.0%"],
      PERSONAL_LOAN: ["RETAIL_OTHER", "100.0%"],
      RESIDENTIAL_MORTGAGE: ["REAL_ESTATE", "20.0%"],
      REAL_ESTATE_DEVELOPMENT_LOAN: ["REAL_ESTATE", "150.0%"],
      PROJECT_FINANCE_LOAN: ["SPECIALISED_LENDING", "50.0%"],
      SUBORDINATED_LOAN: ["SUBORDINATED_DEBT", "150.0%"],
      GOVERNMENT_BOND: ["SOVEREIGN", "0.0%"],
      MDB_BOND: ["MDB", "20.0%"],
      BANK_BOND: ["BANK", "20.0%"],
      LISTED_EQUITY: ["SIGNIFICANT_CAPITAL_INVESTMENT", "250.0%"],
      CASH_ON_HAND: ["CASH_AND_GOLD", "0.0%"]
    };
    for (const [code, [cls, weight]] of Object.entries(expected)) {
      const row = byCode[code];
      assert(row, "缺少案例 " + code);
      equal(row.exposureClass, cls, code + " 分类");
      equal(row.riskWeightText, weight, code + " 权重");
    }
    return Object.keys(expected).length + " 个代表案例";
  });

  await test("WIZ-10", "执行 EAD 并覆盖表内表外", async () => {
    assert(wiz20, "前置 20 案例失败");
    if (!eadReady) throw new Error("EAD 测试配置未就绪");
    const rows = wiz20.weighted.results;
    equal(rows.filter((row) => row.ead != null).length, 20, "有 EAD 的笔数");
    equal(rows.filter((row) => row.onEad != null).length, 19, "表内笔数");
    equal(rows.filter((row) => row.offEad != null).length, 1, "表外笔数");
    equal(Math.round(wiz20.weighted.summary.ead), 32550000, "EAD 合计");
    return "20 笔，表内 19 / 表外 1，合计 32,550,000";
  });

  await test("WIZ-11", "信用风险缓释步骤不报错", async () => {
    assert(wiz20, "前置 20 案例失败");
    const off = wiz20.weighted.results.filter((row) => row.crm && row.crm.status === "off").length;
    equal(off, 20, "未启用缓释笔数");
    return "20 笔未启用缓释，流程正常";
  });

  await test("WIZ-12", "RWA 计算", async () => {
    assert(wiz20, "前置 20 案例失败");
    const rows = wiz20.weighted.results;
    equal(rows.filter((row) => row.rwa != null).length, 16, "有 RWA 的笔数");
    equal(rows.filter((row) => row.riskWeight == null && row.rwa != null).length, 0, "人工复核却算出 RWA 的笔数");
    equal(Math.round(wiz20.weighted.summary.rwa), 21730000, "RWA 合计");
    return "16 笔有 RWA，合计 21,730,000";
  });

  await test("WIZ-13", "候选暴露类型不匹配时阻断权重", async () => {
    const bad = await runBadApi();
    const badClass = bad.classified.results[0].exposureClass;
    assert(["CORPORATE", "OTHER"].includes(badClass), "分类结果异常：" + badClass);
    assert(bad.weighted.weight.summary.blocked >= 1, "权重步骤没有阻断");
    assert(bad.weighted.results[0].weightStatus === "warning", "权重状态不是待复核");
    const text = (bad.weighted.results[0].exceptions || []).map((item) => item.text).join("；");
    includes(text, "不在产品候选暴露类型中", "异常提示");
    return "OTHER 被阻断并提示候选类型不匹配";
  });

  await test("WIZ-14", "不存在版本的规则检查失败", async () => {
    const readiness = await api("/api/rwa-tasks/readiness?version=NOT-EXIST&jurisdiction=HK");
    equal(readiness.ok, false, "readiness.ok");
    assert(readiness.issues.length > 0, "没有返回缺失原因");
    return readiness.issues.join("；");
  });

  await test("WIZ-15", "缺规则时禁止创建主任务", async () => {
    const response = await page.evaluate(async () => {
      const r = await fetch("/api/rwa-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "自动测试-非法版本", jurisdiction: "HK", institution: "香港测试银行", version: "NOT-EXIST", baseDate: "2026-09-30" })
      });
      return { status: r.status, body: await r.json().catch(() => ({})) };
    });
    equal(response.status, 400, "HTTP 状态");
    includes(JSON.stringify(response.body), "规则配置不完整", "错误提示");
    return "HTTP 400";
  });

  await test("WIZ-16", "新建主任务和初始子任务", async () => {
    const name = "ZZ 自动化测试主任务 " + Date.now();
    const task = await api("/api/rwa-tasks", {
      method: "POST",
      body: {
        name, jurisdiction: "HK", institution: "香港测试银行", version: VERSION, baseDate: "2026-09-30",
        subtasks: [{ name: "资本充足率计量", module: "capital" }, { name: "流动性计量", module: "liquidity" }]
      }
    });
    createdTaskId = task.id;
    equal(task.capitalCount, 1, "资本充足率子任务");
    equal(task.liquidityCount, 1, "流动性子任务");
    await api("/api/rwa-tasks/" + encodeURIComponent(task.id), { method: "DELETE" });
    createdTaskId = "";
    return task.id + "，2 个子任务，已清理";
  });

  await test("WIZ-17", "任务工作台统计和搜索", async () => {
    await page.goto(BASE_URL + "/tasks", { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    equal(await page.locator(".task-summary-item").count(), 5, "统计卡片");
    const rowsBefore = await page.locator("tbody tr").count();
    assert(rowsBefore >= 1, "任务清单为空");
    await page.locator(".task-filter-row input[type=search]").fill("信用风险");
    await page.waitForTimeout(300);
    const rowsAfter = await page.locator("tbody tr").count();
    assert(rowsAfter <= rowsBefore, "搜索后行数异常");
    return "统计 5 项，搜索 " + rowsBefore + " → " + rowsAfter;
  });

  await test("WIZ-18", "新建主任务三步向导和规则检查", async () => {
    await page.goto(BASE_URL + "/tasks/new", { waitUntil: "networkidle" });
    await page.waitForTimeout(1000);
    equal(await page.locator(".task-create-step").count(), 3, "步骤数");
    await page.locator(".panel select").nth(0).selectOption({ label: "香港" });
    await page.waitForTimeout(400);
    const version = page.locator(".panel select").nth(1);
    const options = await version.locator("option").allInnerTexts();
    const index = options.findIndex((item) => item.includes(VERSION));
    assert(index >= 0, "没有香港版本");
    await version.selectOption({ index });
    await page.locator("button", { hasText: "下一步：检查规则配置" }).click();
    await page.waitForTimeout(2200);
    const text = await page.locator(".panel-body").last().innerText();
    includes(text, "规则配置完整，可以创建主任务", "规则检查");
    includes(text, "8 个产品族", "产品数");
    includes(text, "689 个标准字段", "字段数");
    return "3 步，香港配置检查通过";
  });

  await test("WIZ-19", "规则执行留痕抽屉", async () => {
    await page.goto(BASE_URL + "/wizard", { waitUntil: "networkidle" });
    await page.waitForTimeout(1000);
    await page.locator(".field select").nth(0).selectOption({ label: "香港" });
    await page.waitForTimeout(300);
    const version = page.locator(".field select").nth(1);
    const options = await version.locator("option").allInnerTexts();
    const index = options.findIndex((item) => item.includes(VERSION));
    await version.selectOption({ index });
    await page.waitForTimeout(500);
    await page.locator("button", { hasText: "确认范围，下一步" }).click();
    await page.waitForTimeout(300);
    await page.locator("input[type=file]").setInputFiles(FIXTURE_FULL);
    await page.waitForFunction(() => document.body.innerText.includes("1 行"), null, { timeout: 15000 });
    await page.locator("button", { hasText: "下一步：识别产品类型" }).click();
    await page.waitForSelector("button:has-text('下一步：字段映射确认')", { timeout: 15000 });
    await page.waitForFunction(() => {
      const button = [...document.querySelectorAll("button")].find((item) => item.innerText.includes("下一步：字段映射确认"));
      return button && !button.disabled;
    }, null, { timeout: 20000 });
    await page.locator("button", { hasText: "下一步：字段映射确认" }).click();
    await page.waitForFunction(() => {
      const text = document.body.innerText;
      return text.includes("字段映射确认") && (
        [...document.querySelectorAll("button")].some((item) => item.innerText.includes("一键确认全部")) ||
        [...document.querySelectorAll("button")].some((item) => item.innerText.includes("下一步：执行暴露分类"))
      );
    }, null, { timeout: 60000 });
    const confirm = page.locator("button", { hasText: "一键确认全部" });
    if (await confirm.count()) await confirm.click();
    await page.waitForSelector("button:has-text('下一步：执行暴露分类')", { timeout: 20000 });
    await page.locator("button", { hasText: "下一步：执行暴露分类" }).click();
    await page.waitForTimeout(400);
    await page.locator("button", { hasText: "开始逐笔执行分类" }).click();
    await page.waitForTimeout(8000);
    const traceButton = page.locator("tbody tr").first().locator("button", { hasText: "查看" });
    await traceButton.click();
    await page.waitForSelector(".drawer", { timeout: 6000 });
    const drawer = await page.locator(".drawer-body").innerText();
    includes(drawer, "暴露分类命中", "分类留痕");
    includes(drawer, "字段值", "字段值留痕");
    await page.locator(".drawer .modal-close").click().catch(() => {});
    return "抽屉显示分类留痕和字段值";
  });

  await test("WIZ-20", "写入计量批次并清理", async () => {
    assert(wiz20, "前置 20 案例失败");
    const name = "ZZ 自动化计量批次 " + Date.now();
    let saved = null;
    let lastError = null;
    for (let attempt = 0; attempt < 3 && !saved; attempt += 1) {
      try {
        saved = await api("/api/measure/runs", {
          method: "POST",
          body: {
            name,
            institution: "香港测试银行",
            jurisdiction: "HK",
            version: VERSION,
            baseDate: "2026-09-30",
            uploadId: wiz20.up.uploadId
          }
        });
      } catch (error) {
        lastError = error;
        const rows = await dbQuery("SELECT id FROM measure_batch WHERE name = ?", [name]).catch(() => []);
        if (rows[0]) saved = { id: rows[0].id };
        else await new Promise((resolve) => setTimeout(resolve, 1500));
      }
    }
    if (!saved) throw lastError || new Error("批次写入失败");
    savedBatchId = saved.id;
    const rows = await dbQuery("SELECT COUNT(*) AS n FROM measure_line WHERE batch_id = ?", [saved.id]);
    equal(Number(rows[0].n), 20, "批次明细数");
    await cleanupBatch(saved.id);
    savedBatchId = "";
    return saved.id + "，20 条明细，已清理";
  });

  await test("WIZ-21", "写回工作簿可以下载", async () => {
    assert(wiz20, "前置 20 案例失败");
    const file = await apiBinary("/api/measure/workbook.xlsx?uploadId=" + encodeURIComponent(wiz20.up.uploadId));
    equal(file.ok, true, "HTTP 状态");
    assert(file.size > 5000, "下载文件过小：" + file.size);
    return file.size + " bytes";
  });

  // 截图留档
  await openHkExposure();
  await page.screenshot({ path: join(OUT, "exposure-overview.png"), fullPage: true });
  await page.goto(BASE_URL + "/tasks", { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(OUT, "task-workbench.png"), fullPage: true });
}

async function teardown() {
  try { await restoreEad(); } catch (error) { console.error("恢复 EAD 配置失败", error.message); }
  try { await restoreLists(); } catch (error) { console.error("恢复名单失败", error.message); }
  if (savedBatchId) {
    try { await cleanupBatch(savedBatchId); } catch (error) { console.error("清理批次失败", error.message); }
  }
  if (createdTaskId) {
    try { await api("/api/rwa-tasks/" + encodeURIComponent(createdTaskId), { method: "DELETE" }); } catch (error) { console.error("清理任务失败", error.message); }
  }
  if (browser) await browser.close();
}

function report() {
  const total = results.length;
  const counts = results.reduce((acc, item) => { acc[item.status] = (acc[item.status] || 0) + 1; return acc; }, {});
  const lines = [];
  lines.push("# 香港 STC 监管配置与 RWA 计量向导自动化测试报告\n");
  lines.push("- 测试版本：`" + VERSION + "`");
  lines.push("- 执行时间：" + new Date().toISOString());
  lines.push("- 用例总数：" + total);
  lines.push("- PASS：" + (counts.PASS || 0));
  lines.push("- FAIL：" + (counts.FAIL || 0));
  lines.push("- SKIP：" + (counts.SKIP || 0));
  lines.push("\n## 结果明细\n");
  lines.push("| 编号 | 测试点 | 状态 | 实际结果 |");
  lines.push("| --- | --- | --- | --- |");
  for (const item of results) {
    lines.push("| " + item.id + " | " + item.name + " | " + item.status + " | " + String(item.actual || "").replace(/\|/g, "\\|").replace(/\n/g, "<br>") + " |");
  }
  writeFileSync(join(OUT, "REPORT.md"), lines.join("\n"), "utf8");
  writeFileSync(join(OUT, "results.json"), JSON.stringify({ version: VERSION, generatedAt: new Date().toISOString(), summary: counts, results }, null, 2), "utf8");
  console.log("\n===== 测试汇总 =====");
  console.log("总数", total, "PASS", counts.PASS || 0, "FAIL", counts.FAIL || 0, "SKIP", counts.SKIP || 0);
  console.log("报告：", join(OUT, "REPORT.md"));
  return counts.FAIL || 0;
}

let exitCode = 0;
try {
  await main();
} catch (error) {
  console.error("测试执行中断", error);
  results.push({ id: "SYS-ERROR", name: "测试执行中断", status: "FAIL", actual: error.message, at: new Date().toISOString() });
  exitCode = 1;
} finally {
  await teardown();
  const failures = report();
  if (failures) exitCode = 1;
  process.exit(exitCode);
}
