import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const pipeline = require(path.join(root, "server/lib/pipeline.cjs"));
const master = require(path.join(root, "server/data/master_data.cjs"));
const mock = require(path.join(root, "server/data/mock_loans.cjs"));

function fail(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
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
