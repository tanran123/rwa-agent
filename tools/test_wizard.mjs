#!/usr/bin/env node
/**
 * 信用风险 RWA 计量向导串行测试：前端调用的同一组 Koa 接口，按向导顺序逐个调用。
 *
 * 默认用 output/uploads/UP-mvoyi799.xlsx（债券组合，表头第 1 行），
 * 全部债项按 bond 产品走，然后执行第 5 步分类。
 *
 * 用法：
 *   node tools/test_wizard.mjs
 *   node tools/test_wizard.mjs --save
 *   node tools/test_wizard.mjs --detect          # 额外调用模型识别产品
 *   node tools/test_wizard.mjs --file 某工作簿.xlsx --header-row 14 --product corp_loan \
 *     --columns '{"bal":"余额","cpt":"交易对手类型"}'
 *
 * 环境变量 WIZARD_BASE 可改 Koa 地址，默认 http://127.0.0.1:8780。
 */

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const BASE = process.env.WIZARD_BASE || "http://127.0.0.1:8780/api";

function arg(name, fallback) {
  const index = process.argv.indexOf("--" + name);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  return value && !value.startsWith("--") ? value : true;
}

const file = String(arg("file", "output/uploads/UP-mvoyi799.xlsx"));
const headerRow = Number(arg("header-row", 1));
const product = String(arg("product", "bond"));
const version = String(arg("version", "MO-SA-2026.1"));
const baseDate = String(arg("base-date", new Date().toISOString().slice(0, 10)));
const save = Boolean(arg("save", false));
const detect = Boolean(arg("detect", false));
const columns = JSON.parse(String(arg("columns", '{"bal":"Equiv to MOP","itp":"INDUSTRY","rat":"RATING","cat":"Account Type "}')));

async function post(route, body) {
  const response = await fetch(BASE + route, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { error: text.slice(0, 500) }; }
  if (!response.ok) {
    console.error("HTTP", response.status, route, data);
    process.exit(1);
  }
  return data;
}

async function get(route) {
  const response = await fetch(BASE + route);
  const text = await response.text();
  if (!response.ok) {
    console.error("HTTP", response.status, route, text.slice(0, 500));
    process.exit(1);
  }
  return JSON.parse(text);
}

function step(title) {
  console.log("\n=== " + title + " ===");
}

step("0. 服务与上下文");
const boot = await get("/bootstrap");
console.log("customers", boot.customers.length, "jurisdictions", boot.jurisdictions.map((x) => x.code).join(","), "versions", boot.versions.length);
const current = boot.versions.find((item) => item.version === version) || boot.versions[0];
console.log("使用版本", version, current ? "(" + (current.status || "") + ")" : "(未在版本清单里)");

step("1. 上传工作簿 POST /api/measure/workbook");
const buffer = await readFile(file);
const uploaded = await post("/measure/workbook", {
  filename: path.basename(file),
  content: buffer.toString("base64"),
  headerRow,
});
console.log("uploadId", uploaded.uploadId, "loans", uploaded.intake.loans.length, "headerRow", uploaded.intake.headerRow, "sheets", uploaded.sheetsRead);
console.log("自动识别到的产品", [...new Set(uploaded.intake.loans.map((x) => x.product).filter(Boolean))]);
await writeFile("/tmp/wizard-step2-upload.json", JSON.stringify(uploaded, null, 2));

if (detect) {
  step("2b. 模型识别产品 POST /api/measure/products");
  const detected = await post("/measure/products", { uploadId: uploaded.uploadId, version });
  console.log("groups", detected.groups);
  if (detected.modelError) console.log("modelError", detected.modelError);
}

step("3/4. 应用产品与字段映射 POST /api/measure/apply");
const products = Object.fromEntries(uploaded.intake.loans.map((loan) => [loan.id, product]));
const applied = await post("/measure/apply", {
  uploadId: uploaded.uploadId,
  sheet: uploaded.sheet,
  headerRow: uploaded.intake.headerRow,
  products,
  columns: { [product]: columns },
});
console.log("loans", applied.intake.loans.length, "mapping products", Object.keys(applied.intake.mappings));
console.log("mapping", applied.intake.mappings[product]);
console.log("summary", applied.summary);
await writeFile("/tmp/wizard-step4-apply.json", JSON.stringify(applied, null, 2));

step("5. 执行信用风险暴露分类 POST /api/measure/classify");
const classified = await post("/measure/classify", { uploadId: applied.uploadId, version });
console.log("traceDir", classified.traceDir);
console.log("classification", classified.classification && classified.classification.summary);
console.log("documents", classified.classification && classified.classification.documents);
const counts = {};
for (const row of classified.results) {
  const key = row.exposureClass || "未分类";
  counts[key] = (counts[key] || 0) + 1;
}
console.log("暴露大类分布", counts);
const attention = classified.results.filter((row) => row.status !== "ok");
console.log("非 ok 行", attention.length, attention.slice(0, 10).map((row) => ({
  loanId: row.loanId, class: row.exposureClass, sub: row.exposureSubClass, weight: row.riskWeight, status: row.status, trace: row.traceUrl,
})));
await writeFile("/tmp/wizard-step5-classify.json", JSON.stringify(classified, null, 2));

step("6/7. EAD 与缓释（查看 pack.results，不另调接口）");
const sample = classified.results.find((row) => row.ead != null) || classified.results[0];
console.log({
  loanId: sample.loanId, onEad: sample.onEad, offEad: sample.offEad, ead: sample.ead,
  eadFormula: sample.eadFormula, riskWeight: sample.riskWeight, rwa: sample.rwa, crm: sample.crm,
});
console.log("summary onEad/offEad/ead/rwa", {
  onEad: classified.summary.onEad, offEad: classified.summary.offEad, ead: classified.summary.ead, rwa: classified.summary.rwa,
});

if (save) {
  step("8/9. 写入批次并读取结果明细 POST /api/measure/runs");
  const name = "串行测试-" + new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const batch = await post("/measure/runs", {
    name,
    institution: "自动化测试机构",
    jurisdiction: "MO",
    version,
    baseDate,
    uploadId: applied.uploadId,
  });
  console.log("batch", { id: batch.id, name: batch.name, imported: batch.imported, success: batch.success, exception: batch.exception, ead: batch.ead, rwa: batch.rwa });
  const lines = await get("/batches/" + encodeURIComponent(batch.id) + "/lines");
  console.log("lines", lines.length, "first", lines.slice(0, 3).map((row) => ({
    loanId: row.loanId, class: row.exposureClass, weight: row.weight, ead: row.ead, rwa: row.rwa, status: row.status,
  })));
  await writeFile("/tmp/wizard-step9-batch.json", JSON.stringify({ batch, lines }, null, 2));
}

console.log("\n完成。中间结果：/tmp/wizard-step2-upload.json /tmp/wizard-step4-apply.json /tmp/wizard-step5-classify.json");
