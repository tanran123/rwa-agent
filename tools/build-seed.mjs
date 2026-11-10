/**
 * 从现有主数据和分类 JSON 生成 sql/002_seed.sql。
 * node tools/build-seed.mjs
 */
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const MASTER = require(join(root, "server/data/master_data.cjs"));
const FormulaEngine = require(join(root, "server/lib/formula.cjs"));
const rulesSrc = readFileSync(join(root, "server/data/rules.js"), "utf8");
const classDoc = JSON.parse(readFileSync(
  join(root, "agent/steps/weight/knowledge/权重法风险暴露分类.json"),
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

/** 合格缓释物字典的默认骨架。每个产品一份，可在「信用风险缓释配置」页逐产品增删改。 */
const DEFAULT_CRM_ELIGIBLE_TYPES = [
  { code: "cash", name: "现金及本机构发行的存款证",
    note: "现金，以及由承担该交易对手暴露的填報機構本身所發行之存款證或類似工具，存放於該填報機構。（第 80(a) 段）" },
  { code: "gold", name: "黄金", note: "黄金。（第 80(b) 段）" },
  { code: "gov_bond", name: "主权债务证券",
    note: "由主權發行、且信用品質級別為第 4 級或以上的債務證券。（第 80(c) 段）" },
  { code: "pse_bond", name: "公共部门实体债务证券",
    note: "由公共部門實體（PSEs）發行、且信用品質級別為第 4 級或以上的債務證券。（第 80(d) 段）" },
  { code: "guarantee", name: "第三方保证",
    note: "由合格保證人（主權、PSE、銀行，或其他風險權重為 20% 或更佳且低於交易對手風險權重之實體）提供之保證。（第 84–85 段）" }
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

/** 系统管理演示数据。密码只写 SHA-256，页面上的默认密码是 admin/admin123 或 ecl2026。 */
function hashPassword(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

const ADMIN_MENUS = ["home", "versions", "orgs", "tasks", "wizard", "engine", "results", "sys-users", "sys-roles", "sys-perms", "sys-logs", "sys-llm", "sys-tokens"];

const ROLES = [
  ["R0", "超级管理员", "平台全部功能与配置权限", 1, "on", ["*"]],
  ["R1", "验证主管", "全部项目读写、审批与配置查看", 0, "on", ADMIN_MENUS],
  ["R2", "验证经理", "所辖项目读写、执行与审计查看", 0, "on", ["home", "versions", "orgs", "tasks", "wizard", "engine", "results", "sys-logs", "sys-llm"]],
  ["R3", "验证专员", "所辖项目编制与执行", 0, "on", ["home", "versions", "tasks", "wizard", "engine", "results", "sys-llm"]],
  ["R4", "审批人", "方案与结论审批、只读项目", 0, "on", ["home", "versions", "tasks", "results", "sys-llm"]],
  ["R5", "只读", "仅查看被授权项目", 0, "on", ["home", "versions", "tasks", "results"]]
];

const USERS = [
  ["U1", "admin", "王静", "R0", "模型验证部", "wangjing@rwa-demo.cn", "138****1024", hashPassword("admin123"), "on", ["*"], "2026-11-09 09:12:00"],
  ["U2", "wangjing", "李强", "R2", "模型验证部", "liqiang@rwa-demo.cn", "139****2381", hashPassword("ecl2026"), "on", ["mo-branch"], "2026-11-08 17:40:00"],
  ["U3", "chenchen", "陈晨", "R3", "模型验证部", "chenchen@rwa-demo.cn", "137****6620", hashPassword("ecl2026"), "on", ["mo-branch", "hk-branch"], "2026-11-08 15:22:00"],
  ["U4", "zhaoqm", "赵启明", "R4", "风险审批部", "zhaoqm@rwa-demo.cn", "136****8891", hashPassword("ecl2026"), "on", ["*"], "2026-11-07 11:06:00"],
  ["U5", "reviewer", "外部评审", "R5", "外部评审", "review@rwa-demo.cn", "—", hashPassword("ecl2026"), "off", ["mo-branch"], "2026-10-28 14:18:00"],
  ["U6", "liuyang", "刘洋", "R1", "模型验证部", "liuyang@rwa-demo.cn", "135****0917", hashPassword("ecl2026"), "on", ["*"], "2026-11-09 08:45:00"]
];

const LOGIN_LOGS = [
  ["2026-11-09 09:12:00", "admin", "王静", "127.0.0.1", "Chrome 141 / macOS", "success", ""],
  ["2026-11-09 08:45:00", "liuyang", "刘洋", "10.20.8.16", "Edge 140 / Windows", "success", ""],
  ["2026-11-08 17:40:00", "wangjing", "李强", "10.20.8.21", "Chrome 141 / Windows", "success", ""],
  ["2026-11-08 15:22:00", "chenchen", "陈晨", "10.20.8.33", "Safari 18 / macOS", "success", ""],
  ["2026-11-08 09:04:00", "reviewer", "外部评审", "10.20.9.7", "Chrome 140 / Windows", "fail", "账号已停用"],
  ["2026-11-07 11:06:00", "zhaoqm", "赵启明", "10.20.8.12", "Chrome 141 / Windows", "success", ""],
  ["2026-11-07 08:51:00", "admin", "王静", "127.0.0.1", "Chrome 141 / macOS", "success", ""],
  ["2026-11-06 18:20:00", "unknown", "—", "10.20.9.44", "Chrome 139 / Windows", "fail", "用户名或密码错误"]
];

const OPERATION_LOGS = [
  ["2026-11-09 09:20:00", "王静", "保存菜单权限", "验证经理", "9 个菜单"],
  ["2026-11-09 09:05:00", "王静", "编辑大模型配置", "DeepSeek V4", "deepseek-chat"],
  ["2026-11-08 16:42:00", "刘洋", "新增用户", "chenchen", "验证专员"],
  ["2026-11-08 11:18:00", "李强", "重置密码", "wangjing", "李强"],
  ["2026-11-07 14:06:00", "王静", "停用用户", "reviewer", "外部评审"]
];

const LLM_CONFIGS = [
  ["LLM-01", "admin", "DeepSeek V4", "DeepSeek", "https://api.deepseek.com", "deepseek-chat", "sk-demo-deepseek-8f2a", 0.2, 8192, 60, "on", 1, "2026-11-09 09:02:00", 1284],
  ["LLM-02", "admin", "Qwen Max", "阿里云百炼", "https://dashscope.aliyuncs.com/compatible-mode/v1", "qwen-max", "sk-demo-qwen-31c7", 0.3, 6144, 60, "on", 0, "2026-11-08 16:35:00", 316],
  ["LLM-03", "wangjing", "Qwen Max", "阿里云百炼", "https://dashscope.aliyuncs.com/compatible-mode/v1", "qwen-max", "sk-demo-qwen-wj", 0.2, 6144, 60, "on", 1, "2026-11-08 11:20:00", 58],
  ["LLM-04", "liuyang", "本地 Llama", "Ollama", "http://127.0.0.1:11434/v1", "llama3.1:70b", "local", 0.1, 4096, 120, "on", 1, "2026-10-30 10:12:00", 42]
];

const TOKEN_LOGS = [
  ["2026-11-09 09:18:00", "TK-20261109-001", "DeepSeek V4", "暴露分类解析", "王静", "澳门分行", 18420, 3120, 8.4, "success"],
  ["2026-11-09 09:15:00", "TK-20261109-002", "DeepSeek V4", "信息完整性检查", "王静", "澳门分行", 9620, 1840, 5.1, "success"],
  ["2026-11-09 09:10:00", "TK-20261109-003", "DeepSeek V4", "底稿计算说明", "刘洋", "总行（法人）", 12800, 5210, 12.6, "success"],
  ["2026-11-09 08:58:00", "TK-20261109-004", "Qwen Max", "计量向导问答", "李强", "澳门分行", 7420, 2310, 7.2, "success"],
  ["2026-11-09 08:44:00", "TK-20261109-005", "DeepSeek V4", "智能体对话", "刘洋", "总行（法人）", 2180, 860, 2.8, "success"],
  ["2026-11-08 18:03:00", "TK-20261108-021", "DeepSeek V4", "字段映射建议", "李强", "澳门分行", 4360, 1120, 4.1, "success"],
  ["2026-11-08 17:42:00", "TK-20261108-020", "Qwen Max", "缓释规则问答", "陈晨", "香港分行", 11320, 2740, 9.8, "success"],
  ["2026-11-08 16:35:00", "TK-20261108-019", "Qwen Max", "方案摘要", "李强", "澳门分行", 6120, 1480, 5.4, "success"],
  ["2026-11-08 15:28:00", "TK-20261108-018", "DeepSeek V4", "暴露分类解析", "陈晨", "香港分行", 15280, 3620, 11.2, "success"],
  ["2026-11-08 11:07:00", "TK-20261108-017", "DeepSeek V4", "结论摘要", "王静", "澳门分行", 8840, 1620, 4.9, "success"],
  ["2026-11-08 10:32:00", "TK-20261108-016", "本地 Llama", "文档分类", "系统", "总行（法人）", 2280, 340, 21.6, "fail"],
  ["2026-11-07 17:51:00", "TK-20261107-015", "DeepSeek V4", "计量向导问答", "李强", "澳门分行", 6980, 2080, 6.3, "success"]
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
lines.push("-- 由 tools/build-seed.mjs 从现有主数据、权重法风险暴露分类.json，以及根目录四份分类 JSON 生成");
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

function locateJson(text) {
  const start = text.indexOf("{");
  if (start < 0) throw new Error("文件里没有 JSON");
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i += 1) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === "\"") inStr = false;
      continue;
    }
    if (c === "\"") inStr = true;
    else if (c === "{") depth += 1;
    else if (c === "}") {
      depth -= 1;
      if (depth === 0) return JSON.parse(text.slice(start, i + 1));
    }
  }
  throw new Error("JSON 没有结束");
}

const TREE_DOCS = [
  { id: 2, seq: 1, label: "通用", file: "通用信用风险暴露划分规则.md" },
  { id: 3, seq: 2, label: "贷款", file: "贷款风险暴露.md" },
  { id: 4, seq: 3, label: "债券", file: "债券风险暴露.md" },
  { id: 5, seq: 4, label: "市场化债券", file: "市场化债券风险暴露.json" }
];

const exposureRows = [[
  1, classDoc.name, classDoc.title, "", 0,
  "agent/steps/weight/knowledge/权重法风险暴露分类.json",
  "",
  JSON.stringify(classDoc)
]];
TREE_DOCS.forEach((item) => {
  const text = readFileSync(join(root, item.file), "utf8");
  const document = item.file.endsWith(".json") ? JSON.parse(text) : locateJson(text);
  exposureRows.push([
    item.id, document.name, document.title, item.label, item.seq, item.file, "MO-SA-2026.1", JSON.stringify(document)
  ]);
});
lines.push(insert("exposure_document",
  ["id", "name", "title", "label", "seq", "source_file", "rule_version", "body"],
  exposureRows));

lines.push(insert("weight_rule",
  ["id", "class_name", "cond_text", "risk_weight", "priority", "bank_tier", "basis"],
  WEIGHTS.map((item) => [item.id, item.cls, item.cond, item.rw, item.pri, item.bank, item.basis])));

lines.push(insert("bank_grade_row",
  ["id", "label", "priority", "basis", "weights_json", "ids_json"],
  BANK_GRID.rows.map((item) => [
    item.id, item.label, item.pri, item.basis,
    JSON.stringify(item.weights), JSON.stringify(item.ids)
  ])));

lines.push(insert("mo_weight_row",
  ["id", "bucket", "weights_json", "note"],
  MO_WEIGHTS.map((item) => [item.id, item.bucket, JSON.stringify(item.weights), item.note || ""])));

/* ---------------- EAD 计算配置（按产品，表内表外互斥） ---------------- */
/* 公式只能引用该产品在 PRODUCT_FIELDS 里已有的标准字段。
   结构化引用在这里算好落库，运行时不再解析公式。 */
const EAD_VERSION = "MO-SA-2026.1";
const EAD_PRODUCT_CONFIG = [
  { code: "corp_loan", side: "on", rules: [
    { id: "EAD-ON-CL-001", name: "对公贷款表内 EAD", formula: "EAD = 债项余额", condition: "适用于所有表内对公贷款" }] },
  { code: "personal_loan", side: "on", rules: [
    { id: "EAD-ON-PL-001", name: "个人贷款表内 EAD", formula: "EAD = 债项余额", condition: "适用于所有表内个人贷款" }] },
  { code: "bond", side: "on", rules: [
    { id: "EAD-ON-BD-001", name: "债券投资表内 EAD", formula: "EAD = 债券余额", condition: "适用于所有表内债券投资" }] },
  { code: "ib_call", side: "on", rules: [
    { id: "EAD-ON-IB-001", name: "同业活期表内 EAD", formula: "EAD = 余额", condition: "适用于所有存放同业活期" }] },
  { code: "ib_time", side: "on", rules: [
    { id: "EAD-ON-IT-001", name: "同业定期表内 EAD", formula: "EAD = 余额", condition: "适用于所有存放同业定期" }] },
  { code: "due_from_bank", side: "on", rules: [
    { id: "EAD-ON-DF-001", name: "存放同业表内 EAD", formula: "EAD = 余额", condition: "适用于所有存放同业款项" }] },
  { code: "other_credit", side: "on", rules: [
    { id: "EAD-ON-OC-001", name: "其他信用风险暴露表内 EAD", formula: "EAD = 余额", condition: "适用于股权等权益类表内业务" }] },
  { code: "off_bs", side: "off", rules: [
    { id: "EAD-OFF-OB-001", name: "表外授信及承诺 EAD",
      formula: "EAD = 已提用金额 + 授信总额度 × CCF", ccf: 0.2,
      condition: "按业务品种的信用转换系数折算；债项自带 ccf 时以债项为准" }] },
];

/** 一条 EAD 规则 → ead_product_rule 的一行。公式在这里先过一遍校验，过不了就不生成种子。 */
function eadRuleTuple(productCode, side, rule, seq) {
  const pf = MASTER.PRODUCT_FIELDS[productCode] || [];
  const alias = {};
  pf.forEach((f) => { const key = f.stdField || f.code; if (f.name) alias[f.name] = key; if (f.code) alias[f.code] = key; });
  const allowed = ["EAD"];
  pf.forEach((f) => { if (f.name) allowed.push(f.name); if (f.code) allowed.push(f.code); if (f.stdField) allowed.push(f.stdField); });
  if (side === "off") allowed.push("CCF");

  const check = FormulaEngine.validate(rule.formula, allowed, { resultField: "EAD", allowCcf: side === "off", alias });
  if (!check.ok) throw new Error(`${rule.id} 的公式没通过校验：${check.errors.join(" ")}`);

  const fields = check.fields.filter((name) => name !== "CCF").map((name) => {
    const f = pf.find((x) => x.name === name || x.code === name || x.stdField === name);
    return { name: f ? f.name : name, code: f ? f.code : null, stdField: f ? (f.stdField || f.code) : null };
  });

  return [
    rule.id, productCode, seq, rule.name, rule.condition || "", JSON.stringify(rule.conditions || { all: [] }), rule.formula,
    JSON.stringify(fields), JSON.stringify(check.structured), 2, "四舍五入",
    rule.resultField || (side === "off" ? "off_balance_ead" : "on_balance_ead"),
    rule.clause || (side === "off" ? "CL-MO-064" : "CL-MO-060"),
    rule.status || "published", rule.ccf == null ? null : rule.ccf, JSON.stringify(rule.params || [])
  ];
}

lines.push(insert("ead_product_config",
  ["product_code", "needed", "reason", "side", "version"],
  EAD_PRODUCT_CONFIG.map((item) => [item.code, item.needed === false ? 0 : 1, item.reason || "", item.side, EAD_VERSION])));

const eadRuleRows = [];
EAD_PRODUCT_CONFIG.forEach((item) => {
  (item.rules || []).forEach((rule, index) => eadRuleRows.push(eadRuleTuple(item.code, item.side, rule, index + 1)));
});
lines.push(insert("ead_product_rule",
  ["id", "product_code", "seq", "name", "condition_text", "conditions_json", "formula", "fields_json", "structured_json",
    "precision_digits", "rounding", "result_field", "clause_id", "status", "ccf", "params_json"],
  eadRuleRows));

lines.push(insert("ccf_rule",
  ["id", "type_name", "cond_text", "ccf", "priority", "conds_json"],
  CCF_RULES.map((item) => [item.id, item.type, item.cond, item.ccf, item.pri, item.conds ? JSON.stringify(item.conds) : null])));

lines.push(insert("crm_rule",
  ["id", "type_name", "tool", "substitute", "floor_param", "constraints_json", "priority"],
  CRM_RULES.map((item) => [
    item.id, item.type, item.tool, item.substitute, item.floorParam || "",
    JSON.stringify(item.constraints || {}), item.pri
  ])));

/** 每个产品一份默认合格缓释物字典。crm_product_config / crm_slot_column 不灌种子。 */
const crmEligibleRows = [];
MASTER.PRODUCT_TYPES.forEach((product) => {
  DEFAULT_CRM_ELIGIBLE_TYPES.forEach((type, index) => {
    crmEligibleRows.push([product.code, type.code, type.name, type.note, index + 1]);
  });
});
lines.push(insert("crm_eligible_type",
  ["product_code", "code", "name", "note", "seq"],
  crmEligibleRows));

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

lines.push(insert("app_role",
  ["id", "name", "description", "is_super", "status", "menus_json"],
  ROLES.map((item) => [item[0], item[1], item[2], item[3], item[4], JSON.stringify(item[5])])));

lines.push(insert("app_user",
  ["id", "username", "name", "role_id", "dept", "email", "phone", "password_hash", "status", "orgs_json", "last_login"],
  USERS.map((item) => [item[0], item[1], item[2], item[3], item[4], item[5], item[6], item[7], item[8], JSON.stringify(item[9]), item[10]])));

lines.push(insert("login_log",
  ["at", "username", "name", "ip", "device", "status", "reason"],
  LOGIN_LOGS));

lines.push(insert("operation_log",
  ["at", "actor", "action", "target", "note"],
  OPERATION_LOGS));

lines.push(insert("llm_config",
  ["id", "owner", "name", "provider", "base_url", "model", "api_key", "temperature", "max_tokens", "timeout", "status", "is_default", "last_test", "calls"],
  LLM_CONFIGS));

lines.push(insert("token_log",
  ["at", "request_id", "model", "scene", "user_name", "org_name", "prompt_tokens", "completion_tokens", "latency", "status"],
  TOKEN_LOGS));

const out = join(root, "sql/002_seed.sql");
writeFileSync(out, lines.filter(Boolean).join("\n\n") + "\n");
console.log("wrote", out, "bytes", readFileSync(out).length);
