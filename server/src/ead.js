import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";
import { query } from "./db.js";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const pipeline = require(path.join(root, "server/lib/pipeline.cjs"));
const master = require(path.join(root, "server/data/master_data.cjs"));
const mock = require(path.join(root, "server/data/mock_loans.cjs"));

function json(value) {
  if (value == null) return null;
  if (typeof value === "string") {
    try { return JSON.parse(value); } catch { return null; }
  }
  return value;
}

function fail(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function text(value, max, label) {
  const out = value == null ? "" : String(value).trim();
  if (out.length > max) throw fail(label + "不能超过 " + max + " 个字");
  return out;
}

export function presentEad(row) {
  const body = json(row.body) || {};
  return {
    ...body,
    id: row.id,
    side: row.side,
    name: row.name,
    version: row.version,
    status: row.status,
    formula: row.formula,
    condition: row.condition_text,
    ccf: row.ccf == null ? (body.ccf == null ? null : Number(body.ccf)) : Number(row.ccf),
    clause: row.clause_id,
    inputs: body.inputs || [],
    steps: body.steps || [],
    products: body.products || [],
    productCodes: body.productCodes || [],
    precision: body.precision,
    rounding: body.rounding || "",
    resultField: body.resultField || "",
    params: body.params || []
  };
}

async function productsOf(codes) {
  if (!codes.length) throw fail("要先选择产品");
  const rows = await query(
    "SELECT code, label, rule_version FROM product_type WHERE code IN (" + codes.map(() => "?").join(",") + ")",
    codes
  );
  const missing = codes.filter((code) => !rows.some((row) => row.code === code));
  if (missing.length) throw fail("产品不存在：" + missing.join("、"));
  return codes.map((code) => rows.find((row) => row.code === code));
}

function nextId(side, ids) {
  const prefix = side === "off" ? "EAD-OFF-" : "EAD-ON-";
  let n = 0;
  ids.forEach((id) => {
    if (!String(id).startsWith(prefix)) return;
    const match = String(id).slice(prefix.length).match(/^(\d+)/);
    if (match) n = Math.max(n, Number(match[1]));
  });
  const id = prefix + String(n + 1).padStart(3, "0");
  if (id.length > 32) throw fail("规则编号太长");
  return id;
}

async function pack(side, body, id) {
  const name = text(body.name, 128, "规则名称");
  const formula = text(body.formula, 255, "计算公式");
  if (!name || !formula) throw fail("规则名称与计算公式为必填项");
  if (!/EAD|ead/.test(formula)) throw fail("公式校验未通过：公式中应包含结果字段 EAD");
  const status = body.status === "published" ? "published" : body.status === "draft" ? "draft" : "";
  if (!status) throw fail("状态只能是草稿或已发布");
  const codes = Array.isArray(body.productCodes) ? body.productCodes.map((code) => text(code, 32, "产品")) : [];
  const products = await productsOf(codes.filter(Boolean));
  const clause = text(body.clause, 32, "关联监管条款");
  if (!clause) throw fail("关联监管条款不能为空");
  const condition = text(body.condition, 255, "适用条件");
  const version = text(body.version, 40, "监管规则版本") || products[0].rule_version;
  const ccf = side === "off" ? pipeline.num(body.ccf) : null;
  const steps = Array.isArray(body.steps) ? body.steps.map((step) => String(step)).filter(Boolean) : [];
  const inputs = Array.isArray(body.inputs) ? body.inputs.map((item) => String(item)).filter(Boolean) : [];
  const params = Array.isArray(body.params) ? body.params : [];
  const precision = Number(body.precision);
  const stored = {
    id,
    name,
    products: products.map((item) => item.label),
    productCodes: products.map((item) => item.code),
    version,
    status,
    inputs,
    formula,
    steps,
    condition,
    precision: Number.isNaN(precision) ? 2 : precision,
    rounding: text(body.rounding, 40, "舍入规则") || "四舍五入",
    resultField: text(body.resultField, 64, "结果字段") || (side === "on" ? "on_balance_ead" : "off_balance_ead"),
    clause,
    params,
    ccf
  };
  return { stored, ccf, clause, condition, version, name, formula, status };
}

export async function listEad(side) {
  const rows = await query("SELECT * FROM ead_rule WHERE side = ? ORDER BY id", [side === "off" ? "off" : "on"]);
  return rows.map(presentEad);
}

export async function createEad(side, body) {
  const which = side === "off" ? "off" : "on";
  const existing = await query("SELECT id FROM ead_rule WHERE side = ?", [which]);
  const id = nextId(which, existing.map((row) => row.id));
  const packed = await pack(which, body, id);
  await query(
    `INSERT INTO ead_rule (id, side, name, version, status, formula, condition_text, ccf, clause_id, body)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, which, packed.name, packed.version, packed.status, packed.formula, packed.condition, packed.ccf, packed.clause, JSON.stringify(packed.stored)]
  );
  const rows = await query("SELECT * FROM ead_rule WHERE id = ?", [id]);
  return presentEad(rows[0]);
}

export async function updateEad(id, body) {
  const rows = await query("SELECT * FROM ead_rule WHERE id = ?", [id]);
  if (!rows[0]) throw Object.assign(fail("规则不存在"), { status: 404 });
  const side = rows[0].side;
  const current = presentEad(rows[0]);
  const packed = await pack(side, { ...current, ...body, productCodes: body.productCodes || current.productCodes }, id);
  await query(
    `UPDATE ead_rule
     SET name = ?, version = ?, status = ?, formula = ?, condition_text = ?, ccf = ?, clause_id = ?, body = ?
     WHERE id = ?`,
    [packed.name, packed.version, packed.status, packed.formula, packed.condition, packed.ccf, packed.clause, JSON.stringify(packed.stored), id]
  );
  const saved = await query("SELECT * FROM ead_rule WHERE id = ?", [id]);
  return presentEad(saved[0]);
}

function loanStd(side, input, rule) {
  if (side === "off") {
    return {
      offbalance: "yes",
      onbalance_amount: pipeline.num(input.onbalance_amount),
      offbalance_amount: pipeline.num(input.offbalance_amount),
      ccf: input.ccf == null || input.ccf === "" ? pipeline.num(rule.ccf) : pipeline.num(input.ccf)
    };
  }
  return {
    offbalance: "no",
    balance: pipeline.num(input.balance),
    impairment: pipeline.num(input.impairment)
  };
}

function exampleStd(side, rule) {
  if (side === "off") {
    return { offbalance: "yes", onbalance_amount: 2000000, offbalance_amount: 8000000, ccf: rule.ccf == null ? 0.2 : pipeline.num(rule.ccf) };
  }
  return { offbalance: "no", balance: 10000000, impairment: 500000 };
}

function stepView(step) {
  const value = step.value;
  const display = typeof value === "number" && step.label !== "信用转换系数 CCF" ? pipeline.fmt(value) : (step.display || String(value == null ? "" : value));
  return { n: step.n, label: step.label, display, note: step.note || "" };
}

function sampleView(loan, result) {
  const std = loan.std || {};
  return {
    id: loan.id,
    name: loan.name,
    balance: pipeline.fmt(std.balance),
    impairment: pipeline.fmt(std.impairment),
    onbalanceAmount: pipeline.fmt(std.onbalance_amount),
    offbalanceAmount: pipeline.fmt(std.offbalance_amount),
    ccf: std.ccf == null ? "" : pipeline.pct(std.ccf),
    ead: result && result.ead != null ? pipeline.fmt(result.ead) : "",
    ruleName: result && result.ruleName ? result.ruleName : "",
    error: result && result.error ? result.error : ""
  };
}

export function trialEad(body) {
  global.MASTER = master;
  const side = body.side === "off" ? "off" : "on";
  const product = body.product ? String(body.product) : "";
  if (!product) throw fail("要先选择产品");
  const rule = { ...(body.rule || {}), status: "published" };
  if (!rule.formula) throw fail("规则名称与计算公式为必填项");
  const loans = (mock.MOCK_LOANS || []).filter((loan) => {
    if (loan.product !== product) return false;
    const off = loan.std && loan.std.offbalance === "yes";
    return side === "off" ? off : !off;
  }).slice(0, 8);
  const given = body.std && typeof body.std === "object";
  const std = given ? loanStd(side, body.std, rule) : (loans[0] ? loanStd(side, loans[0].std, rule) : exampleStd(side, rule));
  const poolOn = side === "on" ? [rule] : [];
  const poolOff = side === "off" ? [rule] : [];
  const result = pipeline.computeEad({ std }, product, poolOn, poolOff);
  const source = given ? "input" : (loans[0] ? "sample" : "example");
  const hint = source === "sample"
    ? "使用该产品的一笔模拟债项"
    : source === "example"
      ? "该产品没有模拟债项，使用了一组示例金额"
      : "按填写的金额重新计算";
  return {
    source,
    hint,
    inputs: side === "off"
      ? { onbalance_amount: std.onbalance_amount, offbalance_amount: std.offbalance_amount, ccf: std.ccf }
      : { balance: std.balance, impairment: std.impairment },
    result: {
      error: result.error || "",
      ead: result.ead == null ? "" : pipeline.fmt(result.ead),
      ruleId: result.ruleId || "",
      ruleName: result.ruleName || "",
      formula: result.formula || rule.formula || "",
      steps: (result.steps || []).map(stepView)
    },
    samples: loans.map((loan) => sampleView(loan, pipeline.computeEad(loan, product, poolOn, poolOff)))
  };
}
