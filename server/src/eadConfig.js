import { readFileSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { query } from "./db.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const FILES = {
  on: path.join(root, "agent/subagents/ead/knowledge/表内EAD计算配置.json"),
  off: path.join(root, "agent/subagents/ead/knowledge/表外EAD计算配置.json")
};

function which(value) {
  return value === "off" ? "off" : "on";
}

function fail(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function readConfig(side) {
  let raw;
  try {
    raw = readFileSync(FILES[side], "utf8");
  } catch {
    throw fail("读不到配置文件 " + FILES[side], 500);
  }
  let config;
  try {
    config = JSON.parse(raw);
  } catch {
    throw fail(FILES[side] + " 不是合法 JSON", 500);
  }
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw fail(FILES[side] + " 顶层必须是 JSON 对象", 500);
  }
  if (!Array.isArray(config.products)) throw fail(FILES[side] + " 缺少 products 数组", 500);
  return config;
}

function codesOf(config) {
  const codes = [];
  config.products.forEach((item) => {
    const code = item && item.code;
    if (code && !codes.includes(String(code))) codes.push(String(code));
  });
  return codes;
}

/** 产品类型和标准字段都从库里读，配置只写产品 code 和标准字段名。 */
async function productsOf(codes) {
  if (!codes.length) return [];
  const marks = codes.map(() => "?").join(",");
  const rows = await query(
    "SELECT code, label FROM product_type WHERE code IN (" + marks + ") ORDER BY code",
    codes
  );
  const fields = await query(
    "SELECT product_code, std_field, name FROM product_field WHERE product_code IN (" + marks + ") AND std_field IS NOT NULL ORDER BY id",
    codes
  );
  return rows.map((row) => ({
    code: row.code,
    label: row.label,
    fields: fields
      .filter((field) => field.product_code === row.code)
      .map((field) => ({ stdField: field.std_field, name: field.name }))
  }));
}

/** 配置里的产品 code 和字段名必须能在库里指到，指不到就报出来。 */
function checkAgainstDb(config, products) {
  const known = new Map(products.map((item) => [item.code, item]));
  const issues = [];
  config.products.forEach((item) => {
    const code = String((item && item.code) || "");
    const product = known.get(code);
    if (!product) {
      issues.push("产品 " + code + " 不在 product_type 里");
      return;
    }
    const available = product.fields.map((field) => field.stdField);
    (Array.isArray(item.rules) ? item.rules : []).forEach((rule) => {
      const name = (rule && rule.id) || code + " 下未编号的规则";
      (Array.isArray(rule && rule.inputs) ? rule.inputs : []).forEach((input) => {
        if (!available.includes(String(input))) {
          issues.push(name + "：产品 " + code + " 没有标准字段 " + input);
        }
      });
    });
  });
  return issues;
}

async function view(side, config) {
  const products = await productsOf(codesOf(config));
  return {
    side,
    file: FILES[side],
    config,
    products,
    issues: checkAgainstDb(config, products)
  };
}

export async function readEadConfig(value) {
  const side = which(value);
  return view(side, readConfig(side));
}

/** 计量和试算要的规则数组：按产品摊平，补上 productCodes。同步读文件，不查库。 */
export function readEadRules(value) {
  const config = readConfig(which(value));
  const flat = [];
  config.products.forEach((item) => {
    const code = String((item && item.code) || "");
    (Array.isArray(item.rules) ? item.rules : []).forEach((rule) => {
      flat.push({ ...rule, productCodes: code ? [code] : [] });
    });
  });
  return flat;
}

export async function saveEadConfig(value, config) {
  const side = which(value);
  if (!config || typeof config !== "object" || Array.isArray(config)) throw fail("config 必须是 JSON 对象");
  if (!Array.isArray(config.products)) throw fail("config 缺少 products 数组");
  if (config.side && config.side !== side) throw fail("config.side 与请求的 side 不一致");
  config.products.forEach((item, index) => {
    const at = "第 " + (index + 1) + " 个产品";
    if (!item || typeof item !== "object" || Array.isArray(item)) throw fail(at + "不是对象");
    if (!String(item.code || "").trim()) throw fail(at + "缺少 code");
    if (!Array.isArray(item.rules)) throw fail(at + "缺少 rules 数组");
    item.rules.forEach((rule, order) => {
      const where = at + "的第 " + (order + 1) + " 条规则";
      if (!rule || typeof rule !== "object" || Array.isArray(rule)) throw fail(where + "不是对象");
      if (!String(rule.id || "").trim()) throw fail(where + "缺少 id");
      if (!String(rule.formula || "").trim()) throw fail(where + "缺少 formula");
    });
  });
  const checked = await view(side, config);
  if (checked.issues.length) {
    throw fail("配置与库里的产品/标准字段对不上：" + checked.issues.join("；"));
  }
  writeFileSync(FILES[side], JSON.stringify(config, null, 2) + "\n", "utf8");
  return checked;
}
