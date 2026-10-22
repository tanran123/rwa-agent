import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";
import { pool, query } from "./db.js";

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

/** 产品清单和标准字段都从库里读，配置只写产品 code 和标准字段。 */
async function productsWithFields() {
  const products = await query("SELECT code, label, icon, color FROM product_type ORDER BY code");
  const fields = await query(
    "SELECT product_code, code, name, meaning, std_field, required FROM product_field ORDER BY id"
  );
  return products.map((row) => ({
    code: row.code,
    label: row.label,
    icon: row.icon,
    color: row.color,
    fields: fields
      .filter((field) => field.product_code === row.code)
      .map((field) => ({
        name: field.name,
        code: field.code,
        stdField: field.std_field,
        meaning: field.meaning,
        required: !!field.required
      }))
  }));
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

function ruleView(row) {
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

/** 把库里的配置读成 { [productCode]: { needed, reason, side, rules } }，给计算用。 */
export async function eadConfigMap() {
  const [configs, rules] = await Promise.all([
    query("SELECT product_code, needed, reason, side FROM ead_product_config"),
    query("SELECT * FROM ead_product_rule ORDER BY product_code, seq")
  ]);
  const map = {};
  configs.forEach((row) => {
    map[row.product_code] = {
      needed: !!Number(row.needed),
      reason: row.reason || "",
      side: row.side,
      rules: rules.filter((rule) => rule.product_code === row.product_code).map(ruleView)
    };
  });
  return map;
}

export async function readEadConfig() {
  const [products, configs, rules] = await Promise.all([
    productsWithFields(),
    query("SELECT product_code, needed, reason, side, version FROM ead_product_config"),
    query("SELECT * FROM ead_product_rule ORDER BY product_code, seq")
  ]);
  const configOf = new Map(configs.map((row) => [row.product_code, row]));

  const list = products.map((product) => {
    const row = configOf.get(product.code);
    return {
      code: product.code,
      label: product.label,
      icon: product.icon,
      color: product.color,
      fields: product.fields,
      needed: row ? !!Number(row.needed) : true,
      reason: row ? row.reason || "" : "",
      side: row ? row.side : null,
      rules: rules.filter((rule) => rule.product_code === product.code).map(ruleView)
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

  return { version: configs[0] ? configs[0].version : "", products: list, issues };
}

export async function checkEadFormula(productCode, side, formula) {
  const products = await productsWithFields();
  const product = products.find((item) => item.code === productCode);
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

export async function saveEadConfig(config) {
  if (!config || typeof config !== "object" || Array.isArray(config)) throw fail("config 必须是 JSON 对象");
  if (!Array.isArray(config.products)) throw fail("config 缺少 products 数组");

  const products = await productsWithFields();
  const known = new Map(products.map((item) => [item.code, item]));

  const configRows = [];
  const ruleRows = [];
  const issues = [];

  config.products.forEach((item, index) => {
    const at = "第 " + (index + 1) + " 个产品";
    if (!item || typeof item !== "object") throw fail(at + "不是对象");
    const code = String(item.code || "");
    const product = known.get(code);
    if (!product) throw fail(at + "：产品 " + code + " 不在 product_type 里");

    const needed = item.needed !== false;
    const side = item.side === "on" || item.side === "off" ? item.side : null;
    const reason = String(item.reason || "").slice(0, 255);
    const rules = Array.isArray(item.rules) ? item.rules : [];
    if (side && !needed) throw fail(product.label + "：标了无需配置，就不能再选表内/表外");
    if (needed && !side && rules.length) throw fail(product.label + "：还没选表内还是表外，却有规则");

    configRows.push([code, needed ? 1 : 0, reason, side, String(config.version || "")]);

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
        id, code, order + 1, String(rule.name || "").slice(0, 128) || id,
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
  });

  if (issues.length) throw fail("配置与库里的标准字段对不上：" + issues.join("；"));

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query("DELETE FROM ead_product_rule");
    await connection.query("DELETE FROM ead_product_config");
    if (configRows.length) {
      await connection.query(
        "INSERT INTO ead_product_config (product_code, needed, reason, side, version) VALUES ?",
        [configRows]
      );
    }
    if (ruleRows.length) {
      await connection.query(
        `INSERT INTO ead_product_rule
          (id, product_code, seq, name, condition_text, conditions_json, formula, fields_json, structured_json,
           precision_digits, rounding, result_field, clause_id, status, ccf, params_json)
         VALUES ?`,
        [ruleRows]
      );
    }
    await connection.commit();
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }

  return readEadConfig();
}
