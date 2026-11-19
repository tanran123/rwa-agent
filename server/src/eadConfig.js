import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";
import { pool, query } from "./db.js";
import { configProducts } from "./productStandard.js";
import { resolveVersionRef } from "./ruleVersion.js";
import { assertRevision, assertVersionWritable, latestConfigRevision, recordRevision } from "./configAudit.js";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const FormulaEngine = require(path.join(root, "server/lib/formula.cjs"));

function fail(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function json(value) {
  if (value == null) return null;
  if (typeof value === "string") {
    try { return JSON.parse(value); } catch { return null; }
  }
  return value;
}

/** 公式里能用哪些名字：标准字段的中文名、编码、std_field，表外再加 CCF。 */
function allowListOf(fields, side) {
  const allowed = ["EAD"];
  fields.forEach((field) => {
    if (field.name) allowed.push(field.name);
    if (field.code) allowed.push(field.code);
    if (field.stdField) allowed.push(field.stdField);
  });
  if (side === "off") allowed.push("CCF");
  return allowed;
}

/** 公式里的名字 → std_field，落库的结构化引用只认 std_field。 */
function aliasOf(fields) {
  const map = { CCF: "CCF" };
  fields.forEach((field) => {
    const key = field.stdField || field.code;
    if (!key) return;
    if (field.name) map[field.name] = key;
    if (field.code) map[field.code] = key;
    map[key] = key;
  });
  return map;
}

function check(product, side, formula) {
  return FormulaEngine.validate(String(formula || ""), allowListOf(product.fields, side), {
    resultField: "EAD",
    allowCcf: side === "off",
    alias: aliasOf(product.fields)
  });
}

/** 适用条件的运算符，与 server/lib/engine.cjs 的 OPS 一致。 */
const OPS = ["eq", "in", "contains", "gt", "gte", "lt", "lte"];

/**
 * 适用条件：{ all: [ { field, op, match } ] }，空数组表示无条件。
 * field 必须是该产品的标准字段，op 必须是 engine.cjs 认识的那几个。
 */
function checkConditions(product, conditions) {
  const issues = [];
  if (conditions == null) return issues;
  const kind = conditions.all ? "all" : (conditions.any ? "any" : null);
  if (!kind) {
    issues.push("适用条件要写成 { all: [...] } 或 { any: [...] }");
    return issues;
  }
  const list = conditions[kind];
  if (!Array.isArray(list)) {
    issues.push("适用条件的 " + kind + " 必须是数组");
    return issues;
  }
  list.forEach((item, index) => {
    const at = "第 " + (index + 1) + " 个条件";
    if (!item || typeof item !== "object") { issues.push(at + "不是对象"); return; }
    const field = String(item.field || "");
    const known = product.fields.find((x) => x.name === field || x.code === field || x.stdField === field);
    if (!known) issues.push(at + "：产品 " + product.code + " 没有标准字段 " + (field || "（空）"));
    if (!OPS.includes(String(item.op || ""))) issues.push(at + "：不认识运算符 " + (item.op || "（空）"));
    if (item.match == null || item.match === "") issues.push(at + "：没填比较值");
  });
  return issues;
}

/** 条件里的 field 统一存 std_field，取值时好对上。 */
function normalizeConditions(product, conditions) {
  if (!conditions) return { all: [] };
  const kind = conditions.all ? "all" : "any";
  const list = Array.isArray(conditions[kind]) ? conditions[kind] : [];
  return {
    [kind]: list.map((item) => {
      const field = String((item && item.field) || "");
      const known = product.fields.find((x) => x.name === field || x.code === field || x.stdField === field);
      return {
        field: known ? (known.stdField || known.code) : field,
        op: String((item && item.op) || "eq"),
        match: item ? item.match : ""
      };
    })
  };
}

export function ruleView(row) {
  return {
    id: row.id,
    name: row.name,
    seq: Number(row.seq),
    condition: row.condition_text || "",
    conditions: json(row.conditions_json) || { all: [] },
    formula: row.formula,
    fields: json(row.fields_json) || [],
    structured: json(row.structured_json),
    precision: Number(row.precision_digits),
    rounding: row.rounding,
    resultField: row.result_field,
    clause: row.clause_id,
    status: row.status,
    ccf: row.ccf == null ? null : Number(row.ccf),
    params: json(row.params_json) || []
  };
}

/** 把库里的配置读成 { [productCode]: { needed, reason, side, rules } }，给计算用。
 *  指定 version 时只取该版本；没有该版本行时回退到未版本化的旧行。 */
export async function eadConfigMap(version = "", jurisdiction = "") {
  const versionId = version ? await resolveVersionRef(version, jurisdiction) : "";
  const load = (scoped) => Promise.all([
    query(
      scoped
        ? "SELECT product_code, needed, reason, side, rule_version_id FROM ead_product_config WHERE rule_version_id = ? OR rule_version_id = ''"
        : "SELECT product_code, needed, reason, side, rule_version_id FROM ead_product_config",
      scoped ? [versionId] : []
    ),
    query(
      scoped
        ? "SELECT * FROM ead_product_rule WHERE rule_version_id = ? OR rule_version_id = '' ORDER BY product_code, seq"
        : "SELECT * FROM ead_product_rule ORDER BY product_code, seq",
      scoped ? [versionId] : []
    )
  ]);
  let [configs, rules] = await load(!!versionId);
  // 迁移前没有版本行的历史版本仍按旧口径读取，避免改变已有计量结果。
  if (versionId && !configs.length) [configs, rules] = await load(false);
  const map = {};
  const codes = Array.from(new Set(configs.map((row) => row.product_code)));
  codes.forEach((code) => {
    const own = versionId ? configs.find((row) => row.product_code === code && row.rule_version_id === versionId) : null;
    const row = own || configs.find((item) => item.product_code === code && item.rule_version_id === (versionId ? "" : item.rule_version_id));
    if (!row) return;
    const ruleVersionId = row.rule_version_id || "";
    map[code] = {
      needed: !!Number(row.needed),
      reason: row.reason || "",
      side: row.side,
      rules: rules
        .filter((rule) => rule.product_code === code && (rule.rule_version_id || "") === ruleVersionId)
        .map(ruleView)
    };
  });
  return map;
}

function configRowOf(configs, code, versionId) {
  const own = versionId ? configs.find((row) => row.product_code === code && row.rule_version_id === versionId) : null;
  if (own) return own;
  return configs.find((row) => row.product_code === code && !row.rule_version_id) || null;
}

export async function readEadConfig({ version = "", jurisdiction = "" } = {}) {
  const versionId = version ? await resolveVersionRef(version, jurisdiction) : "";
  const [products, configs, rules] = await Promise.all([
    configProducts(version),
    query(
      versionId
        ? "SELECT product_code, needed, reason, side, version, rule_version_id FROM ead_product_config WHERE rule_version_id = ? OR rule_version_id = ''"
        : "SELECT product_code, needed, reason, side, version, rule_version_id FROM ead_product_config",
      versionId ? [versionId] : []
    ),
    query(
      versionId
        ? "SELECT * FROM ead_product_rule WHERE rule_version_id = ? OR rule_version_id = '' ORDER BY product_code, seq"
        : "SELECT * FROM ead_product_rule ORDER BY product_code, seq",
      versionId ? [versionId] : []
    )
  ]);

  const list = products.map((product) => {
    const row = configRowOf(configs, product.code, versionId);
    const ruleVersionId = row ? (row.rule_version_id || "") : "";
    return {
      code: product.code,
      label: product.label,
      icon: product.icon,
      color: product.color,
      ruleVersion: product.ruleVersion,
      fields: product.fields,
      needed: row ? !!Number(row.needed) : true,
      reason: row ? row.reason || "" : "",
      side: row ? row.side : null,
      rules: rules
        .filter((rule) => rule.product_code === product.code && (rule.rule_version_id || "") === ruleVersionId)
        .map(ruleView)
    };
  });

  const issues = [];
  list.forEach((product) => {
    if (!product.needed) return;
    if (!product.side) { issues.push(`${product.label}：还没选表内还是表外`); return; }
    if (!product.rules.length) { issues.push(`${product.label}：标了需要配置，但还没有规则`); return; }
    product.rules.forEach((rule) => {
      (rule.fields || []).forEach((field) => {
        if (!product.fields.some((x) => (x.stdField || x.code) === (field.stdField || field.code))) {
          issues.push(`${rule.id}：产品 ${product.code} 没有标准字段 ${field.stdField || field.code}`);
        }
      });
    });
  });

  return {
    version: version || (configs[0] ? configs[0].version : ""),
    ruleVersionId: versionId,
    configRevision: versionId ? await latestConfigRevision(versionId, "ead_config") : 0,
    products: list,
    issues
  };
}

export async function checkEadFormula(productCode, side, formula, version = "") {
  const products = await configProducts(version);
  const product = products.find((item) => item.code === productCode && (!version || item.ruleVersion === version))
    || products.find((item) => item.code === productCode)
    || (await configProducts("")).find((item) => item.code === productCode);
  if (!product) throw fail("产品不存在：" + productCode);
  const which = side === "off" ? "off" : "on";
  const result = check(product, which, formula);
  return {
    ok: result.ok,
    errors: result.errors,
    warnings: result.warnings,
    fields: result.fields.filter((name) => name !== "CCF").map((name) => {
      const field = product.fields.find((x) => x.name === name || x.code === name || x.stdField === name);
      return { name: field ? field.name : name, code: field ? field.code : null, stdField: field ? (field.stdField || field.code) : null };
    }),
    structured: result.structured
  };
}

function stamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + " " +
    pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
}

export async function saveEadConfig(config, { version = "", jurisdiction = "", actor = "" } = {}) {
  if (!config || typeof config !== "object" || Array.isArray(config)) throw fail("config 必须是 JSON 对象");
  if (!Array.isArray(config.products)) throw fail("config 缺少 products 数组");

  const configVersion = String(config.version || version || "").trim();
  const versionId = configVersion ? await resolveVersionRef(configVersion, jurisdiction) : "";
  if (!configVersion) throw fail("缺少监管版本，不能保存 EAD 配置");
  if (!versionId) throw fail("找不到监管版本 " + configVersion);

  await assertVersionWritable(versionId);
  const currentRevision = await latestConfigRevision(versionId, "ead_config");
  assertRevision(currentRevision, config.baseRevision != null ? config.baseRevision : options.baseRevision, "EAD 配置");
  const products = await configProducts(configVersion);
  if (!products.length) throw fail("当前监管版本没有产品注册，不能保存 EAD 配置");
  const known = new Map(products.map((item) => [item.code, item]));

  const entries = [];
  const issues = [];

  config.products.forEach((item) => {
    if (!item || typeof item !== "object") return;
    const code = String(item.code || "");
    const product = known.get(code);
    // 只保存当前监管版本的产品；页面即使带上了其它版本的产品也不动。
    if (!product) return;

    const needed = item.needed !== false;
    const side = item.side === "on" || item.side === "off" ? item.side : null;
    const reason = String(item.reason || "").slice(0, 255);
    const rules = Array.isArray(item.rules) ? item.rules : [];
    if (side && !needed) throw fail(product.label + "：标了无需配置，就不能再选表内/表外");
    if (needed && !side && rules.length) throw fail(product.label + "：还没选表内还是表外，却有规则");

    const ruleRows = [];
    rules.forEach((rule, order) => {
      const where = product.label + " 的第 " + (order + 1) + " 条规则";
      if (!rule || typeof rule !== "object") throw fail(where + "不是对象");
      const id = String(rule.id || "").trim();
      if (!id) throw fail(where + "缺少 id");
      const formula = String(rule.formula || "").trim();
      const result = check(product, side || "on", formula);
      if (!result.ok) throw fail(where + "的公式没通过校验：" + result.errors.join(" "));
      if (side === "off" && (rule.ccf == null || rule.ccf === "" || Number.isNaN(Number(rule.ccf)))) {
        throw fail(where + "是表外规则，必须填 CCF 取值");
      }
      if (side !== "off" && rule.ccf != null && rule.ccf !== "") throw fail(where + "是表内规则，不能填 CCF");

      const conditionIssues = checkConditions(product, rule.conditions);
      if (conditionIssues.length) throw fail(where + "的适用条件有问题：" + conditionIssues.join("；"));

      const fields = result.fields.filter((name) => name !== "CCF").map((name) => {
        const field = product.fields.find((x) => x.name === name || x.code === name || x.stdField === name);
        return { name: field ? field.name : name, code: field ? field.code : null, stdField: field ? (field.stdField || field.code) : null };
      });
      fields.forEach((field) => {
        if (!field.stdField || !product.fields.some((x) => (x.stdField || x.code) === field.stdField)) {
          issues.push(`${id}：产品 ${code} 没有标准字段 ${field.stdField || field.name}`);
        }
      });

      ruleRows.push([
        versionId, id, code, order + 1, String(rule.name || "").slice(0, 128) || id,
        String(rule.condition || "").slice(0, 255),
        JSON.stringify(normalizeConditions(product, rule.conditions)),
        formula,
        JSON.stringify(fields), JSON.stringify(result.structured),
        Number.isFinite(Number(rule.precision)) ? Number(rule.precision) : 2,
        String(rule.rounding || "四舍五入").slice(0, 20),
        String(rule.resultField || (side === "off" ? "off_balance_ead" : "on_balance_ead")).slice(0, 64),
        String(rule.clause || (side === "off" ? "CL-MO-064" : "CL-MO-060")).slice(0, 32),
        rule.status === "published" ? "published" : "draft",
        side === "off" ? Number(rule.ccf) : null,
        JSON.stringify(Array.isArray(rule.params) ? rule.params : [])
      ]);
    });

    const published = !needed || (rules.length > 0 && rules.every((rule) => rule.status === "published"));
    entries.push({
      code, needed, reason, side, rules: ruleRows,
      decisionStatus: needed ? "REQUIRED" : "NOT_REQUIRED",
      status: published ? "APPROVED" : "DRAFT"
    });
  });

  if (issues.length) throw fail("配置与库里的标准字段对不上：" + issues.join("；"));

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    for (const entry of entries) {
      await connection.query(
        `INSERT INTO ead_product_config
           (rule_version_id, product_code, needed, reason, side, version, decision_status, revision, status, updated_by, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           needed = VALUES(needed), reason = VALUES(reason), side = VALUES(side),
           version = VALUES(version), decision_status = VALUES(decision_status),
           revision = revision + 1, status = VALUES(status), updated_by = VALUES(updated_by), updated_at = VALUES(updated_at)`,
        [versionId, entry.code, entry.needed ? 1 : 0, entry.reason, entry.side, configVersion, entry.decisionStatus, entry.status, actor, stamp()]
      );
      await connection.query(
        "DELETE FROM ead_product_rule WHERE rule_version_id = ? AND product_code = ?",
        [versionId, entry.code]
      );
      if (entry.rules.length) {
        await connection.query(
          `INSERT INTO ead_product_rule
            (rule_version_id, id, product_code, seq, name, condition_text, conditions_json, formula, fields_json, structured_json,
             precision_digits, rounding, result_field, clause_id, status, ccf, params_json, revision)
           VALUES ?`,
          [entry.rules.map((row) => row.concat([1]))]
        );
      }
    }
    await connection.commit();
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }

  await recordRevision({
    ruleVersionId: versionId, objectType: "ead_config", objectKey: "all", action: "UPDATE",
    before: { revision: currentRevision },
    after: { products: entries.map((item) => ({ code: item.code, needed: item.needed, side: item.side, rules: item.rules.length })) },
    actor
  });
  return readEadConfig({ version: configVersion, jurisdiction });
}
