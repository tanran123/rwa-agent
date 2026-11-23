// 为香港资本充足率版本补齐 EAD 计算字段并生成 EAD 规则。
//
// 用法（仓库根目录）：
//   node tools/seed-hk-ead.mjs
//   node tools/seed-hk-ead.mjs --version HK-SA-2026.1 --jurisdiction HK
//
// 做的事：
//   1. 在产品注册的每个产品族下补一个「EAD 计算」标准字段分组和三个字段；
//   2. 为 8 个产品族生成一条已发布的 EAD 规则：
//      表内 EAD = 表内 EAD 基础金额；表外 EAD = 表内基础金额 + 表外基础金额 × CCF。
//
// 表内/表外基础金额需要由数据准备或字段映射提供；如果当前数据只有映射后的
// 暴露金额，可在 EAD 页面上把公式改回 EAD = 暴露金额。
//
// 脚本可重复执行：字段已存在就跳过；EAD 规则按产品覆盖同一版本的行。

import { pool } from "../server/src/db.js";
import { ruleDocuments, ruleDocument, saveRuleDocument } from "../server/src/ruleDocs.js";
import { readEadConfig, saveEadConfig } from "../server/src/eadConfig.js";

function argument(name, fallback) {
  const index = process.argv.indexOf("--" + name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const VERSION = argument("version", "HK-SA-2026.1");
const JURISDICTION = argument("jurisdiction", "HK");
const ACTOR = "seed-hk-ead";

const EAD_GROUP = {
  group_id: "EAD_CALC",
  label: "EAD 计算",
  label_en: "EAD Calculation",
  description: "表内/表外 EAD 计算使用的基础金额与信用转换系数",
  order: 15,
  field_count: 3
};

const EAD_FIELDS = [
  {
    name: "EAD_ON_BAL_AMT",
    label: "表内EAD基础金额",
    label_en: "On-balance EAD Base Amount",
    type: "number",
    unit: "HKD",
    group: "EAD_CALC",
    required: false,
    status: "ACTIVE",
    input_mode: "manual",
    default_value: "",
    precision: null,
    scale: null,
    format: "",
    dictionary: "",
    enum_values: [],
    aliases: [],
    source_hint: "EAD_ON_BAL_AMT",
    description: "EAD 计算使用的表内余额或已提用金额；由产品数据准备提供，可在字段映射中绑定源字段。",
    description_en: "On-balance balance or drawn amount used in the EAD calculation.",
    meaning: "EAD 计算使用的表内余额或已提用金额"
  },
  {
    name: "EAD_OFF_BAL_AMT",
    label: "表外EAD基础金额",
    label_en: "Off-balance EAD Base Amount",
    type: "number",
    unit: "HKD",
    group: "EAD_CALC",
    required: false,
    status: "ACTIVE",
    input_mode: "manual",
    default_value: "",
    precision: null,
    scale: null,
    format: "",
    dictionary: "",
    enum_values: [],
    aliases: [],
    source_hint: "EAD_OFF_BAL_AMT",
    description: "EAD 计算使用的表外授信总额度或未提用承诺金额；由产品数据准备提供，可在字段映射中绑定源字段。",
    description_en: "Off-balance credit limit or undrawn commitment amount used in the EAD calculation.",
    meaning: "EAD 计算使用的表外授信总额度或未提用承诺金额"
  },
  {
    name: "EAD_CCF_RATE",
    label: "信用转换系数EAD",
    label_en: "Credit Conversion Factor (EAD)",
    type: "number",
    unit: "%",
    group: "EAD_CALC",
    required: false,
    status: "ACTIVE",
    input_mode: "manual",
    default_value: "",
    precision: null,
    scale: null,
    format: "",
    dictionary: "",
    enum_values: [],
    aliases: [],
    source_hint: "EAD_CCF_RATE",
    description: "按附表6确定的信用转换系数；表外 EAD 规则可用规则级 CCF 覆盖。",
    description_en: "Credit conversion factor under Schedule 6; an off-balance EAD rule may override it with its own CCF.",
    meaning: "按附表6确定的信用转换系数"
  }
];

const RULE_CODES = {
  LOAN: "LN",
  BOND: "BD",
  INTERBANK: "IB",
  SFT: "SF",
  DERIVATIVE: "DV",
  EQUITY: "EQ",
  OFF_BALANCE: "OB",
  TREASURY: "TR"
};

function hasSameField(field, next) {
  return field && field.name === next.name;
}

function ensureProductFields(entry) {
  let changed = false;
  if (!Array.isArray(entry.standard_field_groups)) entry.standard_field_groups = [];
  if (!entry.standard_field_groups.some((group) => group && group.group_id === EAD_GROUP.group_id)) {
    entry.standard_field_groups.push({ ...EAD_GROUP });
    changed = true;
  } else {
    const group = entry.standard_field_groups.find((item) => item && item.group_id === EAD_GROUP.group_id);
    if (group.field_count !== EAD_GROUP.field_count) {
      group.field_count = EAD_GROUP.field_count;
      changed = true;
    }
  }
  if (!Array.isArray(entry.standard_fields)) entry.standard_fields = [];
  EAD_FIELDS.forEach((next) => {
    const index = entry.standard_fields.findIndex((field) => hasSameField(field, next));
    if (index < 0) {
      entry.standard_fields.push({ ...next });
      changed = true;
    } else if (entry.standard_fields[index].label !== next.label
      || entry.standard_fields[index].description !== next.description
      || entry.standard_fields[index].unit !== next.unit) {
      Object.assign(entry.standard_fields[index], {
        label: next.label,
        description: next.description,
        unit: next.unit
      });
      changed = true;
    }
  });
  return changed;
}

async function ensureRegistryFields() {
  const metas = await ruleDocuments({ jurisdiction: JURISDICTION, version: VERSION, kind: "product_registry" });
  if (!metas.length) throw new Error("找不到产品注册：" + JURISDICTION + " / " + VERSION);
  const doc = await ruleDocument(metas[0].id);
  if (!doc || !doc.body) throw new Error("产品注册没有正文：" + metas[0].id);
  const body = doc.body;
  let changed = false;
  (body.product_mappings || []).forEach((entry) => {
    if (!entry || !entry.product_family) return;
    if (ensureProductFields(entry)) changed = true;
  });
  if (!changed) {
    console.log("标准字段已存在，跳过产品注册更新。");
    return { id: doc.id, revision: doc.revision, changed: false };
  }
  await saveRuleDocument(doc.id, { body, baseRevision: doc.revision });
  console.log("已更新产品注册标准字段：" + doc.id + "（revision " + doc.revision + " → " + (doc.revision + 1) + "）");
  return { id: doc.id, revision: doc.revision + 1, changed: true };
}

async function seedEadRules() {
  const config = await readEadConfig({ version: VERSION, jurisdiction: JURISDICTION });
  const products = (config.products || []).filter((item) => RULE_CODES[item.code]);
  if (!products.length) throw new Error("当前版本没有可配置的产品：" + VERSION);

  const payload = {
    version: config.version || VERSION,
    baseRevision: config.configRevision,
    products: products.map((item) => {
      const off = item.code === "OFF_BALANCE";
      const short = RULE_CODES[item.code];
      const side = off ? "off" : "on";
      return {
        code: item.code,
        ruleVersion: item.ruleVersion,
        needed: true,
        reason: "香港资本充足率 EAD 基础配置",
        side,
        rules: [{
          id: "EAD-" + (off ? "OFF" : "ON") + "-" + short + "-001",
          name: item.label + (off ? "表外 EAD" : "表内 EAD"),
          condition: off
            ? "表外 EAD = 表内基础金额（已提用）+ 表外基础金额（授信总额度）× 规则 CCF；基础金额由产品数据准备提供。"
            : "表内 EAD 取表内 EAD 基础金额（余额/已提用金额）；基础金额由产品数据准备提供。",
          conditions: { all: [] },
          formula: off
            ? "EAD = 表内EAD基础金额 + 表外EAD基础金额 × CCF"
            : "EAD = 表内EAD基础金额",
          precision: 2,
          rounding: "四舍五入",
          resultField: off ? "off_balance_ead" : "on_balance_ead",
          clause: off ? "s.71/附表6" : "s.71",
          status: "published",
          ccf: off ? 0.2 : null,
          params: []
        }]
      };
    })
  };

  const saved = await saveEadConfig(payload, { version: VERSION, jurisdiction: JURISDICTION, actor: ACTOR });
  console.log("已保存 EAD 规则：" + saved.products.filter((item) => RULE_CODES[item.code]).length + " 个产品");
  saved.products.filter((item) => RULE_CODES[item.code]).forEach((item) => {
    console.log("  " + item.code + " · " + (item.side === "off" ? "表外" : "表内") + " · " + item.rules.length + " 条规则 · " + item.rules[0].formula);
  });
  return saved;
}

try {
  const registry = await ensureRegistryFields();
  console.log("产品注册：" + registry.id);
  await seedEadRules();
} catch (err) {
  console.error("失败：" + (err && err.message ? err.message : err));
  process.exitCode = 1;
} finally {
  await pool.end();
}
