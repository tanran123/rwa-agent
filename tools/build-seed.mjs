/**
 * 从现有主数据和分类 JSON 生成 sql/002_seed.sql。
 * node tools/build-seed.mjs
 */
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const MASTER = require(join(root, "server/data/master_data.cjs"));
const rulesSrc = readFileSync(join(root, "server/data/rules.js"), "utf8");
const classDoc = JSON.parse(readFileSync(
  join(root, "agent/subagents/weight/knowledge/权重法风险暴露分类.json"),
  "utf8"
));

function extractValue(src, name) {
  const key = `const ${name} = `;
  const at = src.indexOf(key);
  if (at < 0) throw new Error("找不到 " + name);
  let j = at + key.length;
  while (/\s/.test(src[j])) j += 1;
  let depth = 0;
  let inStr = false;
  let q = "";
  let esc = false;
  for (let k = j; k < src.length; k += 1) {
    const c = src[k];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (c === "\\") { esc = true; continue; }
      if (c === q) inStr = false;
      continue;
    }
    if (c === '"' || c === "'") { inStr = true; q = c; continue; }
    if (c === "{" || c === "[") depth += 1;
    else if (c === "}" || c === "]") {
      depth -= 1;
      if (depth === 0) return JSON.parse(JSON.stringify(eval("(" + src.slice(j, k + 1) + ")")));
    }
  }
  throw new Error(name + " 没有结束");
}

const WEIGHTS = extractValue(rulesSrc, "WEIGHTS");
const CCF_RULES = extractValue(rulesSrc, "CCF_RULES");
const CRM_RULES = extractValue(rulesSrc, "CRM_RULES");
const BANK_GRID = extractValue(rulesSrc, "BANK_GRID");
const MO_WEIGHTS = extractValue(rulesSrc, "MO_WEIGHTS");

const PARAMS = [
  ["LTV_RES_50", "居住房地产", "LTV 分界 50%", "50%", "%", "居住用房地产权重条件引用。不依赖现金流且不超过此值、依赖现金流且不超过此值，各走一条权重。"],
  ["LTV_RES_100", "居住房地产", "LTV 分界 100%", "100%", "%", "居住用房地产权重条件引用。超过此值时，不依赖现金流改为查交易对手，依赖现金流另有一条固定权重。"],
  ["LTV_CRE_60", "商用房地产", "LTV 分界 60%", "60%", "%", "商用房地产权重条件引用。不超过此值才用该档固定权重，否则改查交易对手或下一档。"],
  ["LTV_CRE_80", "商用房地产", "LTV 分界 80%", "80%", "%", "商用房地产、依赖现金流：介于 60% 分界与此值之间时，与 90% 取较大；超过此值另有一条固定权重。"],
  ["SHORT_3M", "期限优惠", "短期原始期限", "3", "月", "第一档银行评级表的短期行引用。百分比在风险权重的评级表里改。"],
  ["TRADE_6M", "期限优惠", "跨境货物贸易期限", "6", "月", "第一档银行评级表的跨境货物贸易行引用。百分比在风险权重的评级表里改。"],
  ["DEF_PROV", "已违约", "准备占比门槛", "20%", "%", "已违约权重条件引用。低于此值和不低于此值是两条不同的固定权重。"],
  ["RW_FLOOR", "CRM", "质物质押 RW 底线", "20%", "RW", "合格质物的覆盖部分引用。一般不低于此值，特定回购可豁免。"],
  ["CARD_LIMIT", "CCF", "合格信用卡单卡上限", "100", "万元", "未使用信用卡额度的 20% 那条引用。还要满足监控。"]
];

const CUSTOMERS = [
  ["c-city", "示例城商行", "CITY", "银行", "城商行口径示意"],
  ["c-joint", "示例股份行", "JOINT", "银行", "股份行口径示意"],
  ["c-rural", "示例农商行", "RURAL", "银行", "农商行口径示意"],
  ["c-life", "示例寿险公司", "LIFE", "保险", "寿险机构口径示意"],
  ["c-pc", "示例财险公司", "PC", "保险", "财险机构口径示意"],
  ["c-retail", "示例零售银行", "RETAIL", "零售", "零售条线 / 个人业务示意"],
  ["c-consumer", "示例消费金融", "CF", "零售", "消费金融公司示意"],
  ["c-broker", "示例证券公司", "SEC", "证券", "券商口径示意"]
];

const ORGS = [
  ["mo-branch", "澳门分行", "MO"],
  ["hq", "总行（法人）", "CN"],
  ["hk-branch", "香港分行", "HK"]
];

function q(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  if (typeof value === "boolean") return value ? "1" : "0";
  return "'" + String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";
}

function js(value) {
  return q(JSON.stringify(value ?? null));
}

function row(values) {
  return "(" + values.map(q).join(", ") + ")";
}

function insert(table, columns, tuples) {
  if (!tuples.length) return "";
  const lines = [];
  const size = 40;
  for (let i = 0; i < tuples.length; i += size) {
    const chunk = tuples.slice(i, i + size);
    lines.push(
      "INSERT INTO " + table + " (" + columns.join(", ") + ") VALUES\n"
      + chunk.map((item) => "  " + row(item)).join(",\n")
      + ";"
    );
  }
  return lines.join("\n");
}

const lines = [];
lines.push("-- 由 tools/build-seed.mjs 从现有主数据和权重法风险暴露分类.json 生成");
lines.push("-- 先执行 001_schema.sql");
lines.push("USE rwa;");
lines.push("SET NAMES utf8mb4;");
lines.push("");

lines.push(insert("jurisdiction",
  ["code", "label", "regulator", "currency", "currency_label"],
  MASTER.JURISDICTIONS.map((item) => [item.code, item.label, item.regulator, item.currency, item.currencyLabel])));

lines.push(insert("customer",
  ["id", "name", "code", "category", "note"],
  CUSTOMERS));

lines.push(insert("org_unit",
  ["id", "name", "jurisdiction"],
  ORGS));

lines.push(insert("rule_version",
  ["id", "jurisdiction", "version", "name", "rule_type", "effective_from", "effective_to", "status", "institution", "ruleset_file", "published_at", "author", "changelog"],
  MASTER.RULE_VERSIONS.map((item) => [
    item.id, item.jurisdiction, item.version, item.name, item.ruleType,
    item.effectiveFrom, item.effectiveTo, item.status, item.institution,
    item.rulesetFile, item.publishedAt, item.author, item.changelog
  ])));

lines.push(insert("clause_doc",
  ["id", "jurisdiction", "doc", "doc_version", "clause_no", "title", "body", "scope", "effective_from", "source"],
  MASTER.CLAUSES.map((item) => [
    item.id, item.jurisdiction, item.doc, item.docVersion, item.clause, item.title,
    item.text, item.scope, item.effectiveFrom, item.source
  ])));

const refs = [];
MASTER.CLAUSES.forEach((item) => {
  (item.referencedBy || []).forEach((name) => refs.push([item.id, name]));
});
lines.push(insert("clause_ref", ["clause_id", "rule_name"], refs));

lines.push(insert("product_type",
  ["code", "label", "icon", "color", "description", "rule_version", "onboarding", "sample_count", "source_system"],
  MASTER.PRODUCT_TYPES.map((item) => [
    item.code, item.label, item.icon, item.color, item.desc,
    item.ruleVersion, item.onboarding, item.sampleCount, item.system
  ])));

const fields = [];
Object.entries(MASTER.PRODUCT_FIELDS).forEach(([product, list]) => {
  list.forEach((item) => fields.push([
    product, item.code, item.name, item.meaning, item.type, item.unit || "",
    item.required ? 1 : 0, item.sourceSystem, item.sourceField, item.transform,
    item.validate, JSON.stringify(item.options || []), JSON.stringify(item.referencedBy || []),
    item.stdField
  ]));
});
lines.push(insert("product_field",
  ["product_code", "code", "name", "meaning", "data_type", "unit", "required", "source_system", "source_field", "transform_rule", "validate_rule", "options_json", "referenced_json", "std_field"],
  fields.map((item) => item.map((value, index) => (index === 11 || index === 12) ? value : value))));

const maps = [];
Object.entries(MASTER.FIELD_MAPPINGS).forEach(([product, list]) => {
  list.forEach((item) => maps.push([
    product, item.stdField, item.stdCode, item.srcSystem, item.srcField,
    item.via, item.status, item.hitRate, item.sample
  ]));
});
lines.push(insert("field_mapping",
  ["product_code", "std_field", "std_code", "src_system", "src_field", "via", "status", "hit_rate", "sample"],
  maps));

lines.push(
  "INSERT INTO exposure_document (id, name, title, source_file, body) VALUES ("
  + [1, classDoc.name, classDoc.title, "agent/subagents/weight/knowledge/权重法风险暴露分类.json", JSON.stringify(classDoc)].map(q).join(", ")
  + ");"
);

lines.push(insert("rule_param",
  ["id", "grp", "name", "value", "unit", "used_for"],
  PARAMS));

lines.push(insert("weight_rule",
  ["id", "class_name", "cond_text", "risk_weight", "priority", "bank_tier", "basis"],
  WEIGHTS.map((item) => [item.id, item.cls, item.cond, item.rw, item.pri, item.bank, item.basis])));

lines.push(insert("bank_grade_row",
  ["id", "label", "priority", "basis", "weights_json", "ids_json", "param_id"],
  BANK_GRID.rows.map((item) => [
    item.id, item.label, item.pri, item.basis,
    JSON.stringify(item.weights), JSON.stringify(item.ids), item.param || null
  ])));

lines.push(insert("mo_weight_row",
  ["id", "bucket", "weights_json", "note"],
  MO_WEIGHTS.map((item) => [item.id, item.bucket, JSON.stringify(item.weights), item.note || ""])));

/* ead_rule 不在这里灌数。表内 / 表外 EAD 计算规则的唯一数据源是
   agent/subagents/ead/knowledge/ 下的两个配置文件，由 Koa 直接读写。 */

lines.push(insert("ccf_rule",
  ["id", "type_name", "cond_text", "ccf", "priority", "conds_json"],
  CCF_RULES.map((item) => [item.id, item.type, item.cond, item.ccf, item.pri, item.conds ? JSON.stringify(item.conds) : null])));

lines.push(insert("crm_rule",
  ["id", "type_name", "tool", "substitute", "floor_param", "constraints_json", "priority"],
  CRM_RULES.map((item) => [
    item.id, item.type, item.tool, item.substitute, item.floorParam || "",
    JSON.stringify(item.constraints || {}), item.pri
  ])));

const productRules = [];
Object.entries(MASTER.PRODUCT_EXPOSURE_RULES).forEach(([product, list]) => {
  list.forEach((item) => productRules.push([
    item.ruleId, product, item.name, item.label, item.priority, item.version,
    item.when, item.targetClass, item.targetSub, item.weight, item.clause, item.status
  ]));
});
lines.push(insert("product_exposure_rule",
  ["id", "product_code", "rule_name", "label", "priority", "version", "when_text", "target_class", "target_sub", "weight_text", "clause_id", "status"],
  productRules));

lines.push(insert("measure_batch",
  ["id", "name", "institution", "jurisdiction", "version", "base_date", "imported", "success_count", "exception_count", "on_ead", "off_ead", "ead", "rwa", "created_at", "status"],
  MASTER.BATCHES.map((item) => [
    item.id, item.name, item.institution, item.jurisdiction, item.version, item.baseDate,
    item.imported, item.success, item.exception,
    item.onEad || 0, item.offEad || 0, (item.onEad || 0) + (item.offEad || 0) || item.ead || 0, item.rwa || 0,
    item.createdAt, item.status
  ])));

lines.push(insert("assistant_turn",
  ["seq", "role", "body"],
  MASTER.NL_ASSISTANT_SCRIPT.map((item, index) => [index + 1, item.role, JSON.stringify(item)])));

const out = join(root, "sql/002_seed.sql");
writeFileSync(out, lines.filter(Boolean).join("\n\n") + "\n");
console.log("wrote", out, "bytes", readFileSync(out).length);
