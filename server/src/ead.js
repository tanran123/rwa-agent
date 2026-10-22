import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";
import { eadConfigMap } from "./eadConfig.js";

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

function stepView(step) {
  const value = step.value;
  const display = typeof value === "number"
    ? (step.label === "CCF" ? pipeline.pct(value) : pipeline.fmt(value))
    : (step.display || String(value == null ? "" : value));
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

export async function trialEad(body) {
  global.MASTER = master;
  const product = body.product ? String(body.product) : "";
  if (!product) throw fail("要先选择产品");
  const side = body.side === "off" ? "off" : "on";
  const given = body.rule && typeof body.rule === "object" ? body.rule : null;
  if (given && !String(given.formula || "").trim()) throw fail("规则缺少计算公式");
  if (given && !given.structured) throw fail("规则缺少结构化公式，请先在公式编辑器里通过校验");

  // 传了规则就按编辑中的规则试算，否则按库里已保存的配置试算。
  const eadConfig = given
    ? { [product]: { needed: true, reason: "", side, rules: [{ ...given, status: "published", seq: 1 }] } }
    : await eadConfigMap();

  const loans = (mock.MOCK_LOANS || []).filter((loan) => {
    if (loan.product !== product) return false;
    const off = loan.std && loan.std.offbalance === "yes";
    return side === "off" ? off : !off;
  }).slice(0, 8);

  const givenStd = body.std && typeof body.std === "object" ? body.std : null;
  const std = givenStd || (loans[0] ? loans[0].std : {});
  const result = pipeline.computeEad({ std }, product, eadConfig);

  const hit = given || ((eadConfig[product] || {}).rules || []).find((rule) => rule.id === result.ruleId) || null;
  const inputs = {};
  ((hit && hit.fields) || []).forEach((field) => {
    const key = field.stdField || field.code;
    if (key) inputs[key] = std[key] == null ? null : std[key];
  });
  if (side === "off") inputs.CCF = hit && hit.ccf != null ? Number(hit.ccf) : (std.ccf == null ? null : std.ccf);

  const source = givenStd ? "input" : (loans[0] ? "sample" : "none");
  const hint = source === "sample"
    ? "使用该产品的一笔模拟债项"
    : source === "input"
      ? "按填写的金额重新计算"
      : "该产品没有模拟债项，请直接填输入参数";

  return {
    source,
    hint,
    inputs,
    result: {
      error: result.error || "",
      skipped: !!result.skipped,
      skipReason: result.skipReason || "",
      ead: result.ead == null ? "" : pipeline.fmt(result.ead),
      ruleId: result.ruleId || "",
      ruleName: result.ruleName || "",
      formula: result.formula || (given ? given.formula : ""),
      steps: (result.steps || []).map(stepView)
    },
    samples: loans.map((loan) => sampleView(loan, pipeline.computeEad(loan, product, eadConfig)))
  };
}
