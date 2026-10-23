import { spawn } from "child_process";
import { createRequire } from "module";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { pool, query } from "./db.js";
import { eadConfigMap } from "./eadConfig.js";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { writeXlsx } = require(path.join(root, "server/lib/xlsx-writer.cjs"));
let cached = null;

function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function round4(value) {
  return Math.round((Number(value) + Number.EPSILON) * 10000) / 10000;
}

function documentOf(value) {
  if (value == null) return null;
  if (typeof value === "string") return JSON.parse(value);
  return value;
}

function numOrNull(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

const EMPTY_CELL = new Set(["", "—", "-", "－"]);

function cell(loan, column) {
  if (!column) return null;
  const raw = loan.raw || {};
  if (Object.prototype.hasOwnProperty.call(raw, column) && !EMPTY_CELL.has(String(raw[column] == null ? "" : raw[column]).trim())) {
    return raw[column];
  }
  const std = loan.std || {};
  if (Object.prototype.hasOwnProperty.call(std, column) && std[column] != null && !EMPTY_CELL.has(String(std[column]).trim())) {
    return std[column];
  }
  return null;
}

async function loadRuleset(name) {
  const tabs = await query(
    "SELECT name, title, label, seq FROM exposure_document WHERE seq > 0 ORDER BY seq, id"
  );
  const sql = name
    ? "SELECT id, name, title, body FROM exposure_document WHERE name = ? LIMIT 1"
    : "SELECT id, name, title, body FROM exposure_document WHERE id = 1";
  const rows = await query(sql, name ? [name] : []);
  if (!rows[0]) {
    const error = new Error(name ? "没有这份分类" : "分类 JSON 不在库里");
    error.status = name ? 400 : 404;
    throw error;
  }
  return {
    id: rows[0].id,
    name: rows[0].name,
    title: rows[0].title,
    doc: documentOf(rows[0].body),
    tabs: tabs.map((row) => ({ name: row.name, title: row.title, label: row.label, seq: Number(row.seq) }))
  };
}

async function loadCatalog() {
  const [docs, products] = await Promise.all([
    query("SELECT id, name, title, label, seq, body FROM exposure_document ORDER BY seq, id"),
    query("SELECT code, label FROM product_type")
  ]);
  const parsed = docs.map((row) => ({
    id: row.id,
    name: row.name,
    title: row.title,
    label: row.label || "",
    seq: Number(row.seq),
    doc: documentOf(row.body)
  }));
  const tabs = parsed.filter((item) => item.seq > 0);
  const general = tabs.find((item) => item.label === "通用") || parsed.find((item) => item.id === 1) || parsed[0];
  const labels = {};
  products.forEach((row) => { labels[row.code] = row.label; });
  return { tabs, general, labels };
}

function documentForProduct(label, tabs, general) {
  const text = String(label || "");
  const hits = tabs.filter((item) => item.label && item.label !== "通用" && text.includes(item.label));
  hits.sort((a, b) => b.label.length - a.label.length);
  return hits[0] || general;
}

async function crmSnapshot() {
  const [configs, columns, types] = await Promise.all([
    query("SELECT product_code, needed, reason, max_slots FROM crm_product_config"),
    query("SELECT product_code, attr, slot, column_name FROM crm_slot_column ORDER BY product_code, attr, slot"),
    query("SELECT product_code, code, name, note, seq FROM crm_eligible_type ORDER BY product_code, seq, code")
  ]);
  const byProduct = {};
  configs.forEach((row) => {
    byProduct[row.product_code] = {
      code: row.product_code,
      needed: !!Number(row.needed),
      reason: row.reason || "",
      maxSlots: Number(row.max_slots) || 1,
      columns: { crm_type: [], crm_value: [], crm_weight: [] },
      types: []
    };
  });
  columns.forEach((row) => {
    const item = byProduct[row.product_code];
    if (!item || !item.columns[row.attr]) return;
    item.columns[row.attr][Number(row.slot) - 1] = row.column_name;
  });
  types.forEach((row) => {
    const item = byProduct[row.product_code];
    if (!item) return;
    item.types.push({ code: row.code, name: row.name, note: row.note || "" });
  });
  return byProduct;
}

function assessCrm(row, byProduct) {
  const cfg = byProduct[row.product];
  const debtorWeight = row.riskWeight == null ? null : Number(row.riskWeight);
  if (!cfg || !cfg.needed) {
    return {
      status: "off",
      applied: false,
      note: (cfg && cfg.reason) || "该产品未启用信用风险缓释",
      debtorWeight,
      slots: []
    };
  }
  const slots = [];
  for (let i = 0; i < cfg.maxSlots; i += 1) {
    const typeColumn = cfg.columns.crm_type[i] || "";
    const valueColumn = cfg.columns.crm_value[i] || "";
    const weightColumn = cfg.columns.crm_weight[i] || "";
    if (!typeColumn && !valueColumn && !weightColumn) continue;
    const type = cell(row, typeColumn);
    const value = cell(row, valueColumn);
    const weight = cell(row, weightColumn);
    const typeText = type == null ? "" : String(type);
    const eligible = cfg.types.find((item) => item.code === typeText || item.name === typeText);
    slots.push({
      slot: i + 1,
      typeColumn,
      valueColumn,
      weightColumn,
      type: typeText,
      value,
      weight,
      eligible: eligible ? eligible.code : ""
    });
  }
  const filled = slots.filter((item) => item.type);
  if (filled.length && filled.some((item) => !item.eligible)) {
    return {
      status: "ineligible",
      applied: false,
      note: "字典外的类型视为不合格，缓释不予认定。原债务人权重不变。",
      debtorWeight,
      slots
    };
  }
  const facts = row.std || {};
  const covered = numOrNull(facts.covered_amount);
  const uncovered = numOrNull(facts.uncovered_amount);
  const protection = numOrNull(facts.protection_weight);
  const missing = [];
  if (covered == null) missing.push("covered_amount");
  if (uncovered == null) missing.push("uncovered_amount");
  if (protection == null) missing.push("protection_weight");
  if (facts.same_currency == null || facts.same_currency === "") missing.push("same_currency");
  if (facts.collateral_kind == null || facts.collateral_kind === "") missing.push("collateral_kind");
  if (missing.length || debtorWeight == null) {
    return {
      status: "skipped",
      applied: false,
      note: "覆盖金额、未覆盖金额、保护方权重、币种是否相同、抵押品类型缺任何一项时，不拆分。原债务人权重不变。",
      missing,
      debtorWeight,
      slots
    };
  }
  const zero = facts.same_currency === "yes" && (
    facts.collateral_kind === "cash_deposit"
    || (facts.collateral_kind === "sovereign_debt" && Number(facts.sovereign_market_haircut) === 0.8)
  );
  const used = zero ? 0 : Math.max(protection, 0.2);
  const rwa = round2(covered * used + uncovered * debtorWeight);
  return {
    status: "applied",
    applied: true,
    note: "被覆盖部分按保护方权重，未覆盖部分仍用原债务人权重。",
    debtorWeight,
    protectionWeightUsed: used,
    rwa,
    slots
  };
}

function attachCrm(out, byProduct) {
  let changed = false;
  out.results.forEach((row) => {
    row.crm = assessCrm(row, byProduct);
    if (row.crm.applied && row.crm.rwa != null) {
      row.rwa = row.crm.rwa;
      changed = true;
    }
  });
  if (!changed) return;
  out.summary.rwa = round2(out.results.reduce((sum, row) => sum + (row.rwa || 0), 0));
  out.summary.rwaRate = out.summary.ead ? round4(out.summary.rwa / out.summary.ead) : 0;
}

function suggestMapping(productCode, headers, master) {
  const fields = (master.PRODUCT_FIELDS && master.PRODUCT_FIELDS[productCode]) || [];
  const preset = (master.FIELD_MAPPINGS && master.FIELD_MAPPINGS[productCode]) || [];
  const hs = (headers || []).map((item) => String(item));
  return fields.map((field) => {
    const pre = preset.find((item) => item.stdField === field.name);
    if (pre && pre.srcField && pre.srcField !== "—") {
      const needle = String(pre.srcField).toLowerCase();
      const col = hs.find((item) => item.toLowerCase() === needle);
      return {
        stdField: field.name,
        stdCode: field.code,
        ruleField: field.stdField,
        required: !!field.required,
        column: col || null,
        transform: pre.via,
        confidence: col ? 0.98 : 0,
        reason: col
          ? "命中产品预设映射：" + pre.srcSystem + "." + pre.srcField
          : "预设来源列「" + pre.srcField + "」不在这张表的表头里",
        needsReview: !col,
        source: col ? "preset" : "none"
      };
    }
    const hit = hs.find((item) => item === field.name)
      || hs.find((item) => item.includes(field.name) || field.name.includes(item));
    if (hit) {
      const exact = hit === field.name;
      return {
        stdField: field.name,
        stdCode: field.code,
        ruleField: field.stdField,
        required: !!field.required,
        column: hit,
        transform: "直接取值",
        confidence: exact ? 0.95 : 0.8,
        reason: exact ? "列名与标准字段名称完全一致" : "列名「" + hit + "」与标准字段名称近似",
        needsReview: !exact,
        source: "matched"
      };
    }
    return {
      stdField: field.name,
      stdCode: field.code,
      ruleField: field.stdField,
      required: !!field.required,
      column: null,
      transform: "—",
      confidence: 0,
      reason: field.required
        ? "未在表头中找到匹配列。该字段为必填，缺失会导致引用它的规则条件不命中。"
        : "未在表头中找到匹配列。该字段为选填，未映射时引用它的条件不命中。",
      needsReview: true,
      source: "none"
    };
  });
}

const COUNTERPARTY_CODE = {
  C: "corporate",
  P: "individual",
  B: "commercial_bank",
  "公司": "corporate",
  "个人": "individual",
  "自然人": "individual",
  "商业银行": "commercial_bank"
};

function storedValue(ruleField, value) {
  if (ruleField !== "counterparty_type" || value == null) return value;
  const text = String(value).trim();
  return COUNTERPARTY_CODE[text] || COUNTERPARTY_CODE[text.toUpperCase()] || value;
}

const RATING_RANK = [
  "AAA", "AA+", "AA", "AA-", "A+", "A", "A-",
  "BBB+", "BBB", "BBB-", "BB+", "BB", "BB-", "B+", "B", "B-",
  "CCC", "CC", "C", "D"
];
const MOODY_SCALE = [
  ["Aaa", "AAA"], ["Aa1", "AA+"], ["Aa2", "AA"], ["Aa3", "AA-"],
  ["A1", "A+"], ["A2", "A"], ["A3", "A-"],
  ["Baa1", "BBB+"], ["Baa2", "BBB"], ["Baa3", "BBB-"],
  ["Ba1", "BB+"], ["Ba2", "BB"], ["Ba3", "BB-"],
  ["B1", "B+"], ["B2", "B"], ["B3", "B-"],
  ["Caa", "CCC"], ["Ca", "CC"]
];

function optionCodes(doc, field) {
  const found = ((doc && doc.fields) || []).find((item) => item.name === field);
  return new Set(((found && found.options) || []).map((item) => item.code).filter(Boolean));
}

function rawEntries(raw) {
  return Object.entries(raw || {}).map(([key, value]) => [String(key).trim(), value]);
}

function headerExact(raw, ...names) {
  const wanted = new Set(names.map((name) => name.toUpperCase()));
  for (const [key, value] of rawEntries(raw)) {
    if (!wanted.has(key.toUpperCase())) continue;
    if (value == null || String(value).trim() === "") continue;
    return value;
  }
  return undefined;
}

function hasHeader(raw, name) {
  const wanted = name.toUpperCase();
  return rawEntries(raw).some(([key]) => key.toUpperCase() === wanted);
}

function countryText(raw) {
  for (const [key, value] of rawEntries(raw)) {
    const upper = key.toUpperCase();
    if (!upper.includes("COUNTRY") && !key.includes("国别") && !key.includes("國別")) continue;
    if (upper.includes("CODE")) continue;
    if (typeof value === "string" && value.trim() && Number.isNaN(Number(value))) return value.trim();
  }
  return "";
}

function isPrc(country) {
  const upper = String(country || "").toUpperCase().trim();
  if (["CN", "CHN", "PRC", "CHINA"].includes(upper) || upper.startsWith("CN ") || upper.startsWith("CHINA")) return true;
  return String(country || "").includes("中国") || String(country || "").includes("中國");
}

function firstCode(codes, candidates) {
  return candidates.find((code) => codes.has(code)) || "";
}

function counterpartyCode(text, country, codes) {
  const raw = String(text == null ? "" : text).trim();
  if (!raw || !codes.size) return "";
  const upper = raw.toUpperCase();
  let candidates = [];
  if (["P", "INDIVIDUAL"].includes(upper) || raw.includes("个人") || raw.includes("自然人")) candidates = ["individual"];
  else if (upper === "BANK" || raw.includes("银行") || raw.includes("同业") || raw.includes("同業")) candidates = ["commercial_bank", "bank"];
  else if (["MDBS", "MDB"].includes(upper)) candidates = ["mdb"];
  else if (["PSES", "PSE", "MUNICIPAL", "GOV"].includes(upper)) candidates = ["pse"];
  else if (upper === "SOVEREIGN" || raw.includes("主权") || raw.includes("主權") || raw.includes("财政部") || raw.includes("財政部")) {
    const inCell = ["CN", "MO"].some((token) => upper.includes(token)) || raw.includes("中国") || raw.includes("澳门") || raw.includes("我國");
    candidates = [inCell ? "cn_central_government" : "foreign_sovereign"];
    if (candidates[0] === "cn_central_government" || candidates[0] === "foreign_sovereign") {
      if (isPrc(country)) candidates = ["cn_central_government"];
      else if (country) candidates = ["foreign_sovereign"];
    }
  } else if (["C", "CORP", "CORPORATE"].includes(upper) || raw.includes("公司") || raw.includes("企业")) {
    candidates = ["corporate"];
  }
  return firstCode(codes, candidates);
}

function industryCode(text, codes) {
  const raw = String(text == null ? "" : text).trim();
  if (!raw || !codes.size) return "";
  const table = {
    BANK: ["bank", "commercial_bank"],
    MDBS: ["mdbs", "mdb"],
    MDB: ["mdbs", "mdb"],
    CORP: ["corp", "corporate"],
    CORPORATE: ["corp", "corporate"],
    PSES: ["pses", "pse"],
    PSE: ["pses", "pse"],
    MUNICIPAL: ["municipal", "pse"],
    GOV: ["gov", "pse"],
    SOVEREIGN: ["sovereign", "foreign_sovereign"]
  };
  return firstCode(codes, table[raw.toUpperCase()] || []);
}

function ratingCodes(text) {
  const cleaned = String(text || "").replace(/／/g, "/").replace(/\s+/g, " ").trim();
  const found = [];
  const keep = (code) => {
    const token = String(code || "").replace(/\s/g, "");
    if (RATING_RANK.includes(token) && !found.includes(token)) found.push(token);
  };
  for (const pattern of [/(?:標普|标普|S&P|SP)\s*([A-D]{1,3}\s*[+-]?)/g, /(?:惠譽|惠誉|Fitch)\s*([A-D]{1,3}\s*[+-]?)/g]) {
    for (const match of cleaned.matchAll(pattern)) keep(match[1]);
  }
  for (const match of cleaned.matchAll(/(?:穆迪|Moody's|Moodys)\s*([A-C][a-z0-9]+)/g)) {
    const token = match[1];
    const scale = MOODY_SCALE.find(([raw]) => token.startsWith(raw));
    if (scale) keep(scale[1]);
  }
  if (!found.length && /^[A-D]{1,3}[+-]?$/.test(cleaned)) keep(cleaned);
  if (!found.length) {
    const scale = MOODY_SCALE.find(([raw]) => cleaned.includes(raw));
    if (scale) keep(scale[1]);
  }
  if (found.length) return found;
  if (["NR", "N/A", "NA", "UNRATED", "无", "無"].includes(cleaned.toUpperCase())) return ["unrated"];
  return [];
}

function worstRating(codes) {
  const ranked = codes.filter((code) => RATING_RANK.includes(code));
  const pool = ranked.length ? ranked : codes;
  return pool.slice().sort((a, b) => RATING_RANK.indexOf(b) - RATING_RANK.indexOf(a))[0] || "";
}

function countHit(count, when) {
  if (!when || when.field !== "assessment_count") return false;
  const expected = Number(when.match);
  if (!Number.isFinite(expected)) return false;
  const op = when.op || "eq";
  if (op === "eq") return count === expected;
  if (op === "gte") return count >= expected;
  if (op === "gt") return count > expected;
  if (op === "lte") return count <= expected;
  if (op === "lt") return count < expected;
  return false;
}

function chooseAssessment(pairs, rule) {
  const distinct = new Set(pairs.map((item) => item[0]));
  if (pairs.length === 1 || distinct.size === 1) return pairs[0][1];
  let use = "";
  for (const item of (rule && rule.pick) || []) {
    if (item && countHit(pairs.length, item.when)) {
      use = item.use || "";
      break;
    }
  }
  if (use === "higher_weight") return pairs.slice().sort((a, b) => b[0] - a[0])[0][1];
  if (use === "higher_of_two_lowest_weights") {
    const ordered = pairs.slice().sort((a, b) => a[0] - b[0]).slice(0, 2);
    return ordered.sort((a, b) => b[0] - a[0])[0][1];
  }
  return worstRating(pairs.map((item) => item[1]));
}

function chooseIssuerRating(engine, doc, facts, codes) {
  const rule = ((doc && doc.rules) || []).find((item) => item.name === "multiple_assessments");
  const applies = new Set((rule && rule.applies_to) || []);
  if (!rule || !applies.has("issuer_rating")) return worstRating(codes);
  const pairs = [];
  codes.forEach((code) => {
    const hit = engine.classify(doc, { ...facts, issuer_rating: code });
    const weight = hit.result && hit.result.riskWeight;
    if (typeof weight === "number") pairs.push([weight, code]);
  });
  if (!pairs.length) return worstRating(codes);
  return chooseAssessment(pairs, rule);
}

export const MDB_OFFICIAL = [
  ["IBRD", "世界银行集团"],
  ["IFC", "世界银行集团"],
  ["ASIAN DEVELOPMENT", "亚洲开发银行"],
  ["ASIA ", "亚洲开发银行"],
  ["EBRD", "欧洲复兴开发银行"],
  ["IADB", "泛美开发银行"],
  ["EIB", "欧洲投资银行"],
  ["NIB", "北欧投资银行"],
  ["ISDB", "伊斯兰开发银行"],
  ["COE", "欧洲理事会开发银行"]
];

function mdbOfficialName(raw) {
  const blob = rawEntries(raw).map(([, value]) => (typeof value === "string" ? value : "")).join(" ").toUpperCase();
  const found = MDB_OFFICIAL.find(([token]) => blob.includes(token));
  return found ? found[1] : "";
}

function seedAmount(std, raw) {
  if (std.balance != null && std.balance !== "") return;
  const value = headerExact(raw, "Value Balance(MOP)", "Equiv to MOP", "O/S BAL_MOP");
  if (value == null || value === "") return;
  const n = Number(String(value).replace(/,/g, ""));
  if (Number.isFinite(n)) std.balance = n;
}

export function seedSheetFacts(loan, doc, engine) {
  const std = loan.std || (loan.std = {});
  const raw = loan.raw || {};
  seedAmount(std, raw);
  const industries = optionCodes(doc, "industry");
  if (industries.size && !industries.has(String(std.industry || ""))) {
    const code = industryCode(headerExact(raw, "INDUSTRY"), industries);
    if (code) std.industry = code;
  }
  const grades = optionCodes(doc, "credit_quality_grade");
  if (grades.size && !grades.has(String(std.credit_quality_grade || ""))) {
    const gradeCell = headerExact(raw, "RATING GRADES");
    const grade = gradeCell == null ? "" : String(gradeCell).trim();
    if (grades.has(grade)) std.credit_quality_grade = grade;
    else if (grades.has("unrated") && ratingCodes(String(headerExact(raw, "RATING") || "")).includes("unrated")) {
      std.credit_quality_grade = "unrated";
    }
  }
  const places = optionCodes(doc, "issuer_jurisdiction");
  if (places.size && !places.has(String(std.issuer_jurisdiction || ""))) {
    const country = countryText(raw).toUpperCase();
    let place = "";
    if (country === "MO" || country.includes("MACAU") || country.includes("澳门")) place = "mo";
    else if (isPrc(country)) place = "cn";
    else if (country === "HK" || country.includes("HONG KONG") || country.includes("香港")) place = "hk";
    else if (country) place = "other";
    if (places.has(place)) std.issuer_jurisdiction = place;
  }
  const parties = optionCodes(doc, "counterparty_type");
  const current = std.counterparty_type == null ? "" : String(std.counterparty_type);
  if (!parties.has(current)) {
    const code = counterpartyCode(headerExact(raw, "Cust Type", "INDUSTRY"), countryText(raw), parties);
    if (code) std.counterparty_type = code;
  }
  const ratingNow = std.issuer_rating == null ? "" : String(std.issuer_rating);
  const ratingOptions = optionCodes(doc, "issuer_rating");
  const ratingKnown = ratingOptions.size
    ? ratingOptions.has(ratingNow)
    : RATING_RANK.includes(ratingNow) || ratingNow === "unrated";
  if (ratingKnown || !hasHeader(raw, "RATING")) return;
  const cell = headerExact(raw, "RATING");
  if (cell == null || String(cell).trim() === "") {
    std.issuer_rating = "unrated";
    return;
  }
  const found = ratingCodes(String(cell)).filter((code) => code !== "unrated");
  if (found.length >= 2) {
    std.issuer_rating = chooseIssuerRating(engine, doc, { ...std, instrument_type: std.instrument_type || "claim" }, found);
  } else if (found.length === 1) {
    std.issuer_rating = found[0];
  } else {
    const one = ratingCodes(String(cell));
    if (one.length === 1) std.issuer_rating = one[0];
  }
  if (std.counterparty_type === "mdb" && !std.counterparty_name) {
    const official = mdbOfficialName(raw);
    if (official) std.counterparty_name = official;
  }
  const zeroList = optionCodes(doc, "is_mdb_zero_list");
  if (zeroList.has("yes") && std.industry === "mdbs" && !std.is_mdb_zero_list && mdbOfficialName(raw)) {
    std.is_mdb_zero_list = "yes";
  }
}

const RAW_ALIAS = {
  "Product Code": "productCode",
  "GL A/C No.": "glAcct",
  "Facility Type": "facilityType",
  "Customer": "customer",
  "Customer Name": "name"
};

const uploads = new Map();

function rememberUpload(id, item) {
  uploads.set(id, item);
  if (uploads.size <= 4) return;
  const oldest = [...uploads.entries()].sort((a, b) => a[1].at - b[1].at)[0];
  uploads.delete(oldest[0]);
}

const READ_XLSX = `
import json, sys
from io import BytesIO
import openpyxl
sheet_name = sys.argv[1] if len(sys.argv) > 1 else ""
try:
    header_row = int(sys.argv[2]) if len(sys.argv) > 2 and sys.argv[2] else 1
except ValueError:
    header_row = 1
AMOUNT = ("value balance(mop)", "equiv to mop", "o/s bal_mop", "信贷敞口", "信貸敞口", "剩余可使用额度")

def headers_of(raw_header):
    while raw_header and (raw_header[-1] is None or str(raw_header[-1]).strip() == ""):
        raw_header = raw_header[:-1]
    headers = []
    seen = {}
    for idx, cell in enumerate(raw_header):
        text = "" if cell is None else str(cell).strip()
        if not text:
            text = "列" + str(idx + 1)
        if text in seen:
            seen[text] += 1
            text = text + "_" + str(seen[text])
        else:
            seen[text] = 1
        headers.append(text)
    return headers

def is_detail(headers):
    blob = " ".join(headers).lower()
    return any(token in blob for token in AMOUNT)

def cell_value(value):
    if hasattr(value, "isoformat"):
        return value.isoformat()
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return "" if value is None else value

wb = openpyxl.load_workbook(BytesIO(sys.stdin.buffer.read()), data_only=True, read_only=True)
names = list(wb.sheetnames)
if not names:
    print(json.dumps({"error": "工作簿里没有工作表"}, ensure_ascii=False))
    raise SystemExit(0)
chosen = [sheet_name] if sheet_name in names else ([] if sheet_name == "" else [names[0]])
if not chosen:
    chosen = names
body = []
headers = []
read = []
skipped = []
truncated = False
for name in chosen:
    ws = wb[name]
    grid = []
    for row in ws.iter_rows(values_only=True):
        grid.append(list(row))
        if len(grid) > header_row + 2001:
            break
    if header_row < 1 or header_row > len(grid):
        skipped.append(name)
        continue
    sheet_headers = headers_of(grid[header_row - 1])
    if sheet_name == "" and not is_detail(sheet_headers):
        skipped.append(name)
        continue
    read.append(name)
    for text in sheet_headers:
        if text not in headers:
            headers.append(text)
    for offset, raw in enumerate(grid[header_row:]):
        cells = raw[:len(sheet_headers)]
        if all(v is None or str(v).strip() == "" for v in cells):
            continue
        if len(body) >= 2000:
            truncated = True
            break
        item = {"__sheet": name, "__row": header_row + 1 + offset}
        for i, header in enumerate(sheet_headers):
            item[header] = cell_value(raw[i] if i < len(raw) else None)
        body.append(item)
    if truncated:
        break
if not read:
    print(json.dumps({"error": "没有读到带金额列的明细表"}, ensure_ascii=False))
    raise SystemExit(0)
print(json.dumps({
    "sheets": names,
    "sheet": read[0],
    "sheetsRead": read,
    "skipped": skipped,
    "headerRow": header_row,
    "headers": headers,
    "rows": body,
    "rowCount": len(body),
    "truncated": truncated
}, ensure_ascii=False))
`;

const WRITE_XLSX = `
import json, sys, base64
from io import BytesIO
import openpyxl
from openpyxl.styles import Font, PatternFill

payload = json.load(sys.stdin)
columns = payload.get("columns") or []
header_row = int(payload.get("headerRow") or 1)
book = openpyxl.load_workbook(BytesIO(base64.b64decode(payload.get("xlsx") or "")))
fill = PatternFill("solid", fgColor="1A5F4A")
font = Font(bold=True, color="FFFFFF")
written = 0
for name, items in (payload.get("sheets") or {}).items():
    if name not in book.sheetnames:
        continue
    ws = book[name]
    start = 0
    last = 1
    if header_row >= 1 and header_row <= ws.max_row:
        for cell in ws[header_row]:
            if cell.value not in (None, ""):
                last = cell.column
            if cell.value == columns[0] if columns else False:
                following = [ws.cell(header_row, cell.column + i).value for i in range(len(columns))]
                if following == columns:
                    start = cell.column
    if start < 1:
        start = last + 1
        for offset, title in enumerate(columns):
            cell = ws.cell(header_row, start + offset, title)
            cell.fill = fill
            cell.font = font
    for item in items:
        excel_row = int(item.get("row") or 0)
        if excel_row < 1:
            continue
        values = item.get("values") or []
        for offset, value in enumerate(values):
            ws.cell(excel_row, start + offset, None if value is None else value)
        written += 1
buf = BytesIO()
book.save(buf)
print(json.dumps({"content": base64.b64encode(buf.getvalue()).decode("ascii"), "written": written}, ensure_ascii=False))
`;

function pythonBin() {
  const local = path.join(root, ".venv/bin/python");
  return existsSync(local) ? local : "python3";
}

const MAP_FIELDS = `
import json, sys
from agent.subagents.weight.calc.model import suggest_standard_fields
payload = json.load(sys.stdin)
print(json.dumps(suggest_standard_fields(payload.get("headers") or [], payload.get("fields") or [], payload.get("samples") or [], payload.get("columnValues") or {}), ensure_ascii=False))
`;

const DETECT_PRODUCTS = `
import json, sys
from agent.subagents.weight.calc.model import suggest_product_types
payload = json.load(sys.stdin)
print(json.dumps(suggest_product_types(payload.get("groups") or [], payload.get("products") or []), ensure_ascii=False))
`;

function cellText(value) {
  if (value == null) return "";
  const text = String(value).trim();
  if (!text) return "";
  return text.length > 60 ? text.slice(0, 60) : text;
}

function rowsForSampling(body) {
  const stored = body && body.uploadId && uploads.get(String(body.uploadId));
  const loans = stored && stored.pack && stored.pack.intake && stored.pack.intake.loans;
  if (Array.isArray(loans) && loans.length) return loans.map((loan) => loan.raw || {});
  return Array.isArray(body && body.samples) ? body.samples : [];
}

function sampleForModel(headers, rows) {
  const columnValues = {};
  headers.forEach((header) => { columnValues[header] = []; });
  const samples = [];
  const limit = Math.min(rows.length, 120);
  for (let i = 0; i < limit; i += 1) {
    const row = rows[i] || {};
    const next = {};
    headers.forEach((header) => {
      const text = cellText(row[header]);
      if (!text) return;
      if (samples.length < 3) next[header] = row[header];
      const bag = columnValues[header];
      if (bag.length < 5 && !bag.includes(text)) bag.push(text);
    });
    if (Object.keys(next).length && samples.length < 3) samples.push(next);
  }
  Object.keys(columnValues).forEach((header) => {
    if (!columnValues[header].length) delete columnValues[header];
  });
  return { samples, columnValues };
}

const SAMPLE_KEYS = ["Product Code", "productCode", "Facility Type", "facilityType", "GL A/C No.", "glAcct", "Customer Name", "name", "Account Type"];

function productCodeValue(row) {
  if (!row || typeof row !== "object") return "";
  const direct = row.productCode != null ? String(row.productCode).trim() : "";
  if (direct) return direct;
  const header = row["Product Code"] != null ? String(row["Product Code"]).trim() : "";
  return header;
}

function sampleCells(row) {
  const keys = Object.keys(row || {});
  const ordered = [...SAMPLE_KEYS.filter((key) => keys.includes(key)), ...keys.filter((key) => !SAMPLE_KEYS.includes(key))];
  const next = {};
  ordered.forEach((key) => {
    if (Object.keys(next).length >= 12) return;
    const text = cellText(row[key]);
    if (text) next[key] = text;
  });
  return next;
}

function productGroups(rows) {
  const groups = new Map();
  rows.forEach((row) => {
    const id = productCodeValue(row);
    if (!groups.has(id)) groups.set(id, { id, count: 0, samples: [] });
    const group = groups.get(id);
    group.count += 1;
    if (group.samples.length < 3) {
      const sample = sampleCells(row);
      if (Object.keys(sample).length) group.samples.push(sample);
    }
  });
  return [...groups.values()];
}

function detectWithModel(groups, products) {
  return new Promise((resolve, reject) => {
    const child = spawn(pythonBin(), ["-c", DETECT_PRODUCTS], {
      cwd: root,
      env: { ...process.env, PYTHONPATH: root }
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => { out += chunk; });
    child.stderr.on("data", (chunk) => { err += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        const error = new Error((err || "模型没有识别产品").trim().split("\n").pop() || "模型没有识别产品");
        error.status = 400;
        reject(error);
        return;
      }
      try { resolve(JSON.parse(out).mapping || {}); }
      catch (parseError) { reject(parseError); }
    });
    child.stdin.write(JSON.stringify({ groups, products }));
    child.stdin.end();
  });
}

export async function detectMeasureProducts(body) {
  const version = body && body.version ? String(body.version) : "";
  let products = await query("SELECT code, label, description, rule_version FROM product_type ORDER BY code");
  if (version && products.some((item) => item.rule_version === version)) {
    products = products.filter((item) => item.rule_version === version);
  }
  const groups = productGroups(rowsForSampling(body));
  const catalog = products.map((item) => ({ code: item.code, label: item.label, description: item.description }));
  if (!groups.length || !catalog.length) return { groups: [], modelError: catalog.length ? "" : "没有已配置的产品" };
  try {
    const mapped = await detectWithModel(groups, catalog);
    return {
      groups: groups.map((group) => {
        const slot = mapped[group.id] || {};
        return { id: group.id, count: group.count, product: slot.product || "", reason: slot.reason || "" };
      }),
      modelError: ""
    };
  } catch (err) {
    return { groups: groups.map((group) => ({ id: group.id, count: group.count, product: "", reason: "" })), modelError: err.message || "模型没有识别产品" };
  }
}

function mapWithModel(headers, fields, samples, columnValues) {
  return new Promise((resolve, reject) => {
    const child = spawn(pythonBin(), ["-c", MAP_FIELDS], {
      cwd: root,
      env: { ...process.env, PYTHONPATH: root }
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => { out += chunk; });
    child.stderr.on("data", (chunk) => { err += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        const error = new Error((err || "模型没有对上").trim().split("\n").pop() || "模型没有对上");
        error.status = 400;
        reject(error);
        return;
      }
      try { resolve(JSON.parse(out).mapping || {}); }
      catch (parseError) { reject(parseError); }
    });
    child.stdin.write(JSON.stringify({ headers, fields, samples, columnValues }));
    child.stdin.end();
  });
}

function localHeader(field, headers) {
  const wanted = [field.name, field.code, field.std_field, field.source_field].filter((item) => item && item !== "—");
  for (const name of wanted) {
    const hit = headers.find((header) => String(header).toLowerCase() === String(name).toLowerCase());
    if (hit) return { column: hit, by: name };
  }
  return null;
}

export async function mapMeasureFields(body) {
  const headers = Array.isArray(body && body.headers) ? body.headers.map((item) => String(item)) : [];
  const codes = [...new Set(((body && body.products) || []).filter(Boolean).map((item) => String(item)))];
  const drawn = sampleForModel(headers, rowsForSampling(body));
  const samples = drawn.samples;
  const columnValues = drawn.columnValues;
  if (!codes.length) return { mappings: {}, modelError: "" };
  const marks = codes.map(() => "?").join(", ");
  const rows = await query(
    `SELECT product_code, code, name, meaning, std_field, source_field, required, options_json
     FROM product_field WHERE product_code IN (${marks}) ORDER BY id`,
    codes
  );
  const byProduct = {};
  rows.forEach((row) => {
    if (!byProduct[row.product_code]) byProduct[row.product_code] = [];
    byProduct[row.product_code].push(row);
  });
  const mappings = {};
  const pending = [];
  codes.forEach((code) => {
    const fields = byProduct[code] || [];
    const suggestions = fields.map((field) => {
      const hit = localHeader(field, headers);
      return {
        stdField: field.name,
        stdCode: field.code,
        ruleField: field.std_field || "",
        required: !!Number(field.required),
        column: hit ? hit.column : null,
        transform: hit ? "直接取值" : "—",
        confidence: hit ? 0.98 : 0,
        reason: hit ? "与产品标准字段「" + hit.by + "」一致" : "产品标准字段没有对上表头",
        needsReview: !hit,
        source: hit ? "standard" : "none"
      };
    });
    suggestions.forEach((item) => {
      if (!item.column) pending.push({ code, item, field: fields.find((row) => row.code === item.stdCode) || {} });
    });
    mappings[code] = suggestions;
  });
  let modelError = "";
  if (pending.length && headers.length) {
    try {
      const mapped = await mapWithModel(headers, pending.map((row) => {
        let options = row.field.options_json;
        if (typeof options === "string") {
          try { options = JSON.parse(options); } catch { options = []; }
        }
        return {
          id: row.code + "." + row.item.stdCode,
          name: row.item.stdField,
          meaning: row.field.meaning || "",
          source: row.field.source_field || "",
          options: Array.isArray(options) ? options : []
        };
      }), samples, columnValues);
      pending.forEach((row) => {
        const slot = mapped[row.code + "." + row.item.stdCode];
        if (!slot || !slot.column) return;
        row.item.column = slot.column;
        row.item.reason = "模型对应：" + (slot.reason || row.item.stdField);
        row.item.source = "model";
        row.item.confidence = 0.7;
        row.item.needsReview = true;
        row.item.transform = "模型对应";
      });
    } catch (err) {
      modelError = err.message || "模型没有对上";
    }
  }
  return { mappings, modelError };
}

function parseXlsx(buffer, sheet, headerRow) {
  return new Promise((resolve, reject) => {
    const child = spawn(pythonBin(), ["-c", READ_XLSX, String(sheet || ""), String(headerRow || 1)]);
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => { out += chunk; });
    child.stderr.on("data", (chunk) => { err += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        const error = new Error("读不了这个工作簿");
        error.status = 400;
        error.cause = err;
        reject(error);
        return;
      }
      try { resolve(JSON.parse(out)); }
      catch (parseError) { reject(parseError); }
    });
    child.stdin.write(buffer);
    child.stdin.end();
  });
}

const LOAN_SHEETS = new Set(["term-Loan", "Mortgage", "BILLS"]);
const BOND_SHEETS = new Set(["Bonds"]);

function assignedProduct(sheet, loan, detected) {
  const name = String(sheet || "");
  if (BOND_SHEETS.has(name) || name.includes("债券") || name.includes("债权")) {
    return { product: "bond", basis: "工作表「" + name + "」对应债券投资" };
  }
  if (LOAN_SHEETS.has(name) || name.includes("贷款")) {
    if (detected.product === "corp_loan" || detected.product === "personal_loan") {
      return { product: detected.product, basis: detected.basis };
    }
    const cust = String(headerExact(loan.raw, "Cust Type") || "").trim().toUpperCase();
    if (cust === "P") return { product: "personal_loan", basis: "工作表「" + name + "」上 Cust Type 为 P，对应个人贷款" };
    return { product: "corp_loan", basis: "工作表「" + name + "」对应对公贷款" };
  }
  if (!detected.product) return null;
  return { product: detected.product, basis: detected.basis };
}

function loansFromRows(headers, rows, master, pipeline, detectRules) {
  const counts = {};
  return rows.map((row) => {
    const raw = {};
    headers.forEach((name) => {
      raw[name] = row[name];
      if (RAW_ALIAS[name]) raw[RAW_ALIAS[name]] = row[name];
    });
    const sheetName = row.__sheet ? String(row.__sheet) : "";
    if (sheetName) raw.sheet = sheetName;
    counts[sheetName] = (counts[sheetName] || 0) + 1;
    const loan = {
      id: (sheetName || "R") + "-" + counts[sheetName],
      customer: raw.customer == null ? "" : String(raw.customer),
      name: raw.name == null ? "" : String(raw.name),
      excelRow: Number(row.__row) || 0,
      raw,
      std: {}
    };
    const found = pipeline.detectProduct(loan, detectRules);
    const assigned = assignedProduct(sheetName, loan, found);
    if (assigned) {
      loan.productAssigned = assigned.product;
      loan.productBasis = assigned.basis;
    }
    const productCode = assigned ? assigned.product : found.product;
    const fields = (productCode && master.PRODUCT_FIELDS && master.PRODUCT_FIELDS[productCode]) || [];
    const suggestions = productCode ? suggestMapping(productCode, headers, master) : [];
    suggestions.forEach((item) => {
      if (!item.column || !item.ruleField) return;
      const value = row[item.column];
      if (value == null || value === "") return;
      loan.std[item.ruleField] = storedValue(item.ruleField, value);
    });
    fields.forEach((field) => {
      if (!field.stdField || loan.std[field.stdField] != null) return;
      const header = headers.find((name) => name === field.stdField || name === field.code || name === field.name);
      if (!header || row[header] == null || row[header] === "") return;
      loan.std[field.stdField] = storedValue(field.stdField, row[header]);
    });
    return loan;
  });
}

function choicesOf(body) {
  const products = body && body.products && typeof body.products === "object" ? body.products : {};
  const columns = body && body.columns && typeof body.columns === "object" ? body.columns : {};
  const productById = {};
  Object.entries(products).forEach(([id, code]) => {
    if (id && code) productById[String(id)] = String(code);
  });
  const columnsByProduct = {};
  Object.entries(columns).forEach(([product, map]) => {
    if (!product || !map || typeof map !== "object") return;
    const next = {};
    Object.entries(map).forEach(([stdCode, column]) => {
      if (stdCode && column) next[String(stdCode)] = String(column);
    });
    if (Object.keys(next).length) columnsByProduct[String(product)] = next;
  });
  return {
    rulesetName: body && body.rulesetName ? String(body.rulesetName) : "",
    productById,
    columnsByProduct
  };
}

function fillStd(loan, product, headers, master, columnsByProduct) {
  const suggestions = product ? suggestMapping(product, headers, master) : [];
  const overrides = (columnsByProduct && columnsByProduct[product]) || {};
  const std = {};
  suggestions.forEach((item) => {
    const column = Object.prototype.hasOwnProperty.call(overrides, item.stdCode) ? overrides[item.stdCode] : item.column;
    if (!column || !item.ruleField || !loan.raw) return;
    const value = loan.raw[column];
    if (value == null || value === "") return;
    std[item.ruleField] = storedValue(item.ruleField, value);
  });
  const fields = (product && master.PRODUCT_FIELDS && master.PRODUCT_FIELDS[product]) || [];
  fields.forEach((field) => {
    if (!field.stdField || std[field.stdField] != null || !loan.raw) return;
    const header = (headers || []).find((name) => name === field.stdField || name === field.code || name === field.name);
    if (!header || loan.raw[header] == null || loan.raw[header] === "") return;
    std[field.stdField] = storedValue(field.stdField, loan.raw[header]);
  });
  return Object.keys(std).length ? std : null;
}

async function measureLoans(loans, intakeMeta, choices) {
  const picked = choices || { rulesetName: "", productById: {}, columnsByProduct: {} };
  const master = require(path.join(root, "server/data/master_data.cjs"));
  const mock = require(path.join(root, "server/data/mock_loans.cjs"));
  const pipeline = require(path.join(root, "server/lib/pipeline.cjs"));
  global.MASTER = master;
  const headers = intakeMeta.headers;
  const prepared = loans.map((loan) => {
    const product = picked.productById[loan.id];
    const code = product || pipeline.detectProduct(loan, mock.PRODUCT_DETECT_RULES).product;
    if (!product && !(code && picked.columnsByProduct[code])) return loan;
    const std = fillStd(loan, code, headers, master, picked.columnsByProduct);
    return std ? { ...loan, std } : loan;
  });
  const catalog = await loadCatalog();
  const engine = require(path.join(root, "server/lib/engine.cjs"));
  const rulesetByProduct = { "": catalog.general };
  const productOf = (loan) => picked.productById[loan.id] || loan.productAssigned || pipeline.detectProduct(loan, mock.PRODUCT_DETECT_RULES).product || "";
  prepared.forEach((loan) => {
    const code = productOf(loan);
    const chosen = documentForProduct(catalog.labels[code] || "", catalog.tabs, catalog.general);
    rulesetByProduct[code || ""] = chosen;
    seedSheetFacts(loan, chosen.doc, engine);
  });
  const doc = catalog.general.doc;
  const eadConfig = await eadConfigMap();
  const crm = await crmSnapshot();
  const out = pipeline.measureBatch(prepared, {
    ruleset: doc,
    rulesetByProduct,
    eadConfig,
    detectRules: mock.PRODUCT_DETECT_RULES,
    productById: picked.productById
  });
  attachCrm(out, crm);
  const products = {};
  (master.PRODUCT_TYPES || []).forEach((item) => { products[item.code] = item.label; });
  const detected = prepared.map((loan) => {
    const chosen = picked.productById[loan.id];
    const found = chosen
      ? { product: chosen, basis: "从产品配置中选择", confidence: "manual" }
      : loan.productAssigned
      ? { product: loan.productAssigned, basis: loan.productBasis || "按工作表对应产品", confidence: "high" }
      : pipeline.detectProduct(loan, mock.PRODUCT_DETECT_RULES);
    return {
      id: loan.id,
      customer: loan.customer,
      name: loan.name,
      raw: loan.raw || {},
      std: loan.std || {},
      anomaly: loan.anomaly || "",
      anomalyDetail: loan.anomalyDetail || "",
      product: found.product,
      basis: found.basis,
      confidence: found.confidence
    };
  });
  const mappings = {};
  detected.forEach((loan) => {
    if (loan.product && !mappings[loan.product]) {
      const suggestions = suggestMapping(loan.product, headers, master);
      const overrides = picked.columnsByProduct[loan.product] || {};
      suggestions.forEach((item) => {
        if (Object.prototype.hasOwnProperty.call(overrides, item.stdCode)) item.column = overrides[item.stdCode];
      });
      mappings[loan.product] = suggestions;
    }
  });
  const pack = {
    sourceFile: intakeMeta.sourceFile || "",
    intake: {
      sheets: intakeMeta.sheets,
      headerRow: intakeMeta.headerRow,
      headers,
      fieldCount: Array.isArray(doc.fields) ? doc.fields.length : 0,
      eadOn: Object.values(eadConfig).filter((c) => c.side === "on").reduce((n, c) => n + c.rules.length, 0),
      eadOff: Object.values(eadConfig).filter((c) => c.side === "off").reduce((n, c) => n + c.rules.length, 0),
      crmOn: Object.values(crm).filter((item) => item.needed).length,
      exposureTabs: catalog.tabs.map((item) => ({ name: item.name, title: item.title, label: item.label, seq: item.seq })),
      loans: detected,
      mappings
    },
    ruleset: catalog.general.name || "",
    rulesetTitle: catalog.general.title || "",
    productRulesets: [...new Set(prepared.map((loan) => productOf(loan) || ""))].map((code) => {
      const meta = rulesetByProduct[code] || catalog.general;
      return {
        product: code,
        label: catalog.labels[code] || (code ? code : "未识别"),
        ruleset: meta.name,
        rulesetLabel: meta.label || meta.title,
        rulesetTitle: meta.title
      };
    }),
    rules: {
      exposure: { id: catalog.general.id, name: catalog.general.name, title: catalog.general.title },
      exposureTabs: catalog.tabs.map((item) => ({ name: item.name, title: item.title, label: item.label, seq: item.seq })),
      ead: Object.entries(eadConfig).flatMap(([product, item]) => (item.rules || []).map((rule) => ({
        id: rule.id,
        product,
        name: rule.name,
        formula: rule.formula,
        side: item.side,
        clause: rule.clause,
        status: rule.status
      }))),
      crm: Object.values(crm).map((item) => ({
        code: item.code,
        needed: item.needed,
        reason: item.reason,
        maxSlots: item.maxSlots,
        columns: item.columns,
        types: item.types.map((type) => ({ code: type.code, name: type.name }))
      }))
    },
    summary: out.summary,
    byClass: out.byClass,
    byProduct: out.byProduct,
    products,
    results: out.results.map((row, index) => ({
      loanId: row.loanId,
      customer: row.customer,
      name: row.name,
      product: row.product,
      sheet: prepared[index] && prepared[index].raw ? prepared[index].raw.sheet || "" : "",
      excelRow: prepared[index] ? prepared[index].excelRow || 0 : 0,
      rulesetLabel: row.rulesetLabel || "",
      balance: row.std ? row.std.balance : null,
      exposureClass: row.exposureClass,
      exposureSubClass: row.exposureSubClass,
      matchedRule: row.matchedRule,
      riskWeight: row.riskWeight,
      onEad: row.onEad,
      offEad: row.offEad,
      ead: row.ead,
      rwa: row.rwa,
      status: row.status,
      reference: row.reference,
      exceptions: row.exceptions || [],
      eadFormula: row.stages && row.stages.ead && row.stages.ead.result ? row.stages.ead.result.formula : "",
      eadSteps: row.stages && row.stages.ead && row.stages.ead.result ? row.stages.ead.result.steps || [] : [],
      rwaSteps: row.stages && row.stages.rwa && row.stages.rwa.result ? row.stages.rwa.result.steps || [] : [],
      crm: row.crm || null
    })).map((row) => ({
      ...row,
      ead: row.ead == null ? null : round2(row.ead),
      onEad: row.onEad == null ? null : round2(row.onEad),
      offEad: row.offEad == null ? null : round2(row.offEad),
      rwa: row.rwa == null ? null : round2(row.rwa)
    }))
  };
  return pack;
}

export async function measureDemo() {
  if (cached) return cached;
  const mock = require(path.join(root, "server/data/mock_loans.cjs"));
  cached = await measureLoans(mock.MOCK_LOANS, {
    sheets: ["term-Loan", "Bonds", "Mortgage", "212 222 存放同业", "額度詳情表"],
    headerRow: 14,
    headers: mock.RAW_SHEET_HEADERS,
    sourceFile: ""
  });
  return cached;
}

export async function readUploadedWorkbook(body) {
  const headerRow = Number(body && body.headerRow) || 1;
  let id = String((body && body.uploadId) || "");
  let stored = id && uploads.get(id);
  let buffer = stored && stored.buffer;
  let filename = stored ? stored.filename : String((body && body.filename) || "上传.xlsx");
  if (!buffer) {
    const content = String((body && body.content) || "");
    if (!content) {
      const error = new Error("没有上传文件");
      error.status = 400;
      throw error;
    }
    buffer = Buffer.from(content, "base64");
    id = "UP-" + Date.now().toString(36);
  }
  if (!buffer.length || buffer.length > 20 * 1024 * 1024) {
    const error = new Error("文件是空的，或超过 20MB");
    error.status = 400;
    throw error;
  }
  const parsed = await parseXlsx(buffer, body && body.sheet, headerRow);
  if (parsed.error) {
    const error = new Error(parsed.error);
    error.status = 400;
    throw error;
  }
  const master = require(path.join(root, "server/data/master_data.cjs"));
  const mock = require(path.join(root, "server/data/mock_loans.cjs"));
  const pipeline = require(path.join(root, "server/lib/pipeline.cjs"));
  const loans = loansFromRows(parsed.headers, parsed.rows, master, pipeline, mock.PRODUCT_DETECT_RULES);
  const pack = await measureLoans(loans, {
    sheets: parsed.sheets,
    headerRow: parsed.headerRow,
    headers: parsed.headers,
    sourceFile: filename
  }, choicesOf(body));
  let annotated = null;
  let workbookError = "";
  try {
    annotated = await annotateWorkbook(buffer, pack);
  } catch (err) {
    workbookError = err.message || "结果没有写进工作簿";
  }
  rememberUpload(id, { buffer, filename, pack, annotated, workbookError, at: Date.now() });
  return {
    uploadId: id,
    filename,
    sheet: parsed.sheet,
    sheetsRead: parsed.sheetsRead || [parsed.sheet],
    skipped: parsed.skipped || [],
    rowCount: parsed.rowCount,
    truncated: parsed.truncated,
    ...pack,
    workbookReady: !!annotated,
    workbookError
  };
}

const RESULT_TITLES = [
  "产品类型",
  "暴露分类",
  "暴露大类",
  "暴露子类",
  "命中规则",
  "风险权重",
  "表内 EAD",
  "表外 EAD",
  "EAD",
  "EAD 公式",
  "信用风险 RWA",
  "计量状态",
  "监管依据",
  "信用风险缓释",
  "EAD 计算步骤",
  "风险权重与 RWA",
  "提示"
];

const LINE_STATUS = { ok: "正常", warning: "待复核", exception: "异常" };

function stepText(steps) {
  return (steps || []).map((step) => {
    const shown = step.display != null ? step.display : (step.value == null ? "" : String(step.value));
    const head = step.n + ". " + step.label + (shown === "" ? "" : " " + shown);
    return step.note ? head + " " + step.note : head;
  }).join("\n");
}

function resultCells(row, products) {
  const ref = row.reference || {};
  const basis = [ref.doc, ref.clause].filter(Boolean).join(" ");
  return [
    (products && products[row.product]) || row.product || "未识别",
    row.rulesetLabel || "—",
    row.exposureClass || "未分类",
    row.exposureSubClass || "—",
    row.matchedRule || "—",
    weightText(row.riskWeight) || "—",
    row.onEad == null ? null : Number(row.onEad),
    row.offEad == null ? null : Number(row.offEad),
    row.ead == null ? null : Number(row.ead),
    row.eadFormula || "—",
    row.rwa == null ? null : Number(row.rwa),
    LINE_STATUS[row.status] || row.status || "",
    basis || "—",
    row.crm && row.crm.note ? row.crm.note : "—",
    stepText(row.eadSteps) || "—",
    stepText(row.rwaSteps) || "—",
    (row.exceptions || []).map((item) => item.text).filter(Boolean).join("\n")
  ];
}

function runPython(script, stdin) {
  return new Promise((resolve, reject) => {
    const child = spawn(pythonBin(), ["-c", script]);
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => { out += chunk; });
    child.stderr.on("data", (chunk) => { err += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        const error = new Error("结果没有写进工作簿");
        error.status = 400;
        error.cause = err;
        reject(error);
        return;
      }
      try { resolve(JSON.parse(out)); }
      catch (parseError) { reject(parseError); }
    });
    child.stdin.end(stdin);
  });
}

function annotateWorkbook(buffer, pack) {
  const sheets = {};
  (pack.results || []).forEach((row) => {
    if (!row.sheet || !row.excelRow) return;
    if (!sheets[row.sheet]) sheets[row.sheet] = [];
    sheets[row.sheet].push({ row: row.excelRow, values: resultCells(row, pack.products) });
  });
  if (!Object.keys(sheets).length) {
    const error = new Error("没有对上工作表行，结果没有写入");
    error.status = 400;
    throw error;
  }
  const payload = JSON.stringify({
    xlsx: buffer.toString("base64"),
    headerRow: Number(pack.intake && pack.intake.headerRow) || 1,
    columns: RESULT_TITLES,
    sheets
  });
  return runPython(WRITE_XLSX, payload).then((parsed) => {
    if (!parsed || parsed.error || !parsed.content) {
      const error = new Error((parsed && parsed.error) || "结果没有写进工作簿");
      error.status = 400;
      throw error;
    }
    return Buffer.from(parsed.content, "base64");
  });
}

export function annotatedUpload(uploadId) {
  const stored = uploads.get(String(uploadId || ""));
  if (!stored || !stored.annotated) {
    const error = new Error(stored && stored.workbookError ? stored.workbookError : "上传的工作簿已经不在，请重新导入后再下载");
    error.status = 400;
    throw error;
  }
  const filename = String(stored.filename || "上传.xlsx").replace(/\.(xlsx|xlsm)$/i, "");
  return { filename: filename + "_风险暴露分类.xlsx", buffer: stored.annotated };
}

const CLASSIFY_WEIGHT = `
import json, sys
from agent.subagents.weight.program import run
done = run({"source": sys.argv[1], "dest": sys.argv[2]})
result = done.get("result") or {}
rows = []
for row in result.get("process_rows") or []:
    weight = row.get("weight")
    rows.append({
        "sheet": row.get("sheet") or "",
        "excelRow": row.get("excel_row"),
        "exposure": row.get("exposure") or "",
        "weight": weight if isinstance(weight, (int, float)) else None,
        "trace": row.get("trace") or ""
    })
print(json.dumps({
    "stopped": bool(done.get("stopped")),
    "stopReason": done.get("stop_reason") or "",
    "annotated": done.get("annotated") or "",
    "traceFile": done.get("trace_file") or "",
    "note": result.get("note") or "",
    "plan": result.get("sheet_plan") or [],
    "rows": rows
}, ensure_ascii=False))
`;

function runWeight(source, dest) {
  return new Promise((resolve, reject) => {
    const child = spawn(pythonBin(), ["-c", CLASSIFY_WEIGHT, source, dest], {
      cwd: root,
      env: { ...process.env, PYTHONPATH: root + path.delimiter + (process.env.PYTHONPATH || "") }
    });
    let out = "";
    let err = "";
    const timer = setTimeout(() => child.kill(), 300000);
    child.stdout.on("data", (chunk) => { out += chunk; });
    child.stderr.on("data", (chunk) => { err += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        const error = new Error((err || out || "权重计算没有完成").trim().slice(-500) || "权重计算没有完成");
        error.status = 400;
        reject(error);
        return;
      }
      const line = out.trim().split("\n").filter((item) => item.startsWith("{")).pop() || out;
      try { resolve(JSON.parse(line)); }
      catch (parseError) {
        const error = new Error("权重计算没有返回逐笔结果");
        error.status = 400;
        error.cause = parseError;
        reject(error);
      }
    });
  });
}

function refreshPackTotals(pack) {
  const results = pack.results || [];
  const summary = pack.summary || {};
  summary.total = results.length;
  summary.ok = results.filter((row) => row.status === "ok").length;
  summary.warning = results.filter((row) => row.status === "warning").length;
  summary.exception = results.filter((row) => row.status === "exception").length;
  summary.rwa = round2(results.reduce((sum, row) => sum + (Number(row.rwa) || 0), 0));
  summary.rwaRate = summary.ead ? round4(summary.rwa / summary.ead) : 0;
  const byClass = {};
  results.forEach((row) => {
    const key = row.exposureClass || "未分类";
    const item = byClass[key] || { count: 0, ead: 0, rwa: 0 };
    item.count += 1;
    item.ead += Number(row.ead) || 0;
    item.rwa += Number(row.rwa) || 0;
    byClass[key] = item;
  });
  Object.values(byClass).forEach((item) => {
    item.ead = round2(item.ead);
    item.rwa = round2(item.rwa);
  });
  pack.summary = summary;
  pack.byClass = byClass;
}

function applyWeightRows(pack, rows) {
  const byKey = new Map();
  rows.forEach((row) => {
    const excelRow = Number(row.excelRow);
    if (!row.sheet || !excelRow) return;
    byKey.set(row.sheet + "\n" + excelRow, row);
  });
  let matched = 0;
  (pack.results || []).forEach((row) => {
    const hit = byKey.get((row.sheet || "") + "\n" + Number(row.excelRow));
    row.rulesetLabel = "风险暴露分类";
    if (!hit) {
      row.exposureClass = "未分类";
      row.exposureSubClass = "";
      row.matchedRule = "";
      row.riskWeight = null;
      row.rwa = null;
      row.status = "exception";
      row.exceptions = [{ level: "error", text: "权重计算没有这一行" }];
      return;
    }
    matched += 1;
    const text = String(hit.exposure || "");
    const parts = text.split(" · ");
    row.exposureClass = parts[0] || "未分类";
    row.exposureSubClass = parts.length > 1 ? parts.slice(1).join(" · ") : "";
    row.matchedRule = hit.trace || "";
    if (hit.weight == null || Number.isNaN(Number(hit.weight))) {
      row.riskWeight = null;
      row.rwa = null;
      row.status = "exception";
      return;
    }
    row.riskWeight = Number(hit.weight);
    if (row.ead == null) {
      row.rwa = null;
      row.status = "exception";
      return;
    }
    row.rwa = round2(Number(row.ead) * row.riskWeight);
    const errors = (row.exceptions || []).filter((item) => item.level === "error" && !/风险权重|未归类|暴露分类/.test(item.text || ""));
    row.status = errors.length ? "exception" : ((row.exceptions || []).some((item) => item.level === "warn") ? "warning" : "ok");
  });
  pack.ruleset = "cn_sa_exposure_class";
  pack.rulesetTitle = "风险暴露分类";
  refreshPackTotals(pack);
  return matched;
}

export async function classifyUpload(uploadId) {
  const stored = uploads.get(String(uploadId || ""));
  if (!stored || !stored.buffer || !stored.pack) {
    const error = new Error("上传的工作簿已经不在，请重新导入后再执行分类");
    error.status = 400;
    throw error;
  }
  const dir = path.join(root, "output", "uploads");
  const bookDir = path.join(root, "output", "workbooks");
  mkdirSync(dir, { recursive: true });
  mkdirSync(bookDir, { recursive: true });
  const source = path.join(dir, String(uploadId).replace(/[^\w-]/g, "") + ".xlsx");
  const stem = String(stored.filename || "上传.xlsx").replace(/\.(xlsx|xlsm)$/i, "");
  const dest = path.join(bookDir, stem + "_风险暴露分类.xlsx");
  writeFileSync(source, stored.buffer);
  const done = await runWeight(source, dest);
  if (done.stopped) {
    const error = new Error(done.stopReason || "权重计算停住了");
    error.status = 400;
    throw error;
  }
  const matched = applyWeightRows(stored.pack, done.rows || []);
  if (!matched) {
    const error = new Error("权重计算没有对上上传的行");
    error.status = 400;
    throw error;
  }
  let workbookError = "";
  try {
    stored.annotated = await annotateWorkbook(stored.buffer, stored.pack);
  } catch (err) {
    workbookError = err.message || "结果没有写进工作簿";
    stored.annotated = null;
  }
  stored.workbookError = workbookError;
  stored.weightAnnotated = done.annotated || "";
  stored.traceFile = done.traceFile || "";
  return {
    ...stored.pack,
    workbookReady: !!stored.annotated,
    workbookError,
    weightNote: done.note || "",
    traceFile: stored.traceFile
  };
}

function weightText(value) {
  if (value == null || Number.isNaN(Number(value))) return "";
  const pct = Math.round(Number(value) * 1000) / 10;
  return (Number.isInteger(pct) ? String(pct) : String(pct)) + "%";
}

function lineDetail(row) {
  return {
    customer: row.customer,
    name: row.name,
    balance: row.balance,
    exposureSubClass: row.exposureSubClass,
    matchedRule: row.matchedRule,
    riskWeight: row.riskWeight,
    onEad: row.onEad,
    offEad: row.offEad,
    ead: row.ead,
    rwa: row.rwa,
    reference: row.reference,
    exceptions: row.exceptions || [],
    eadFormula: row.eadFormula || "",
    eadSteps: row.eadSteps || [],
    rwaSteps: row.rwaSteps || [],
    crm: row.crm || null
  };
}

let chosenDemo = null;

export async function applyMeasureChoices(body) {
  const choices = choicesOf(body);
  if (body && body.uploadId) return readUploadedWorkbook(body);
  const mock = require(path.join(root, "server/data/mock_loans.cjs"));
  const pack = await measureLoans(mock.MOCK_LOANS, {
    sheets: ["term-Loan", "Bonds", "Mortgage", "212 222 存放同业", "額度詳情表"],
    headerRow: 14,
    headers: mock.RAW_SHEET_HEADERS,
    sourceFile: ""
  }, choices);
  const choiceId = "CH-" + Date.now().toString(36);
  chosenDemo = { id: choiceId, pack };
  return { choiceId, ...pack };
}

export async function saveMeasureRun(body) {
  const uploaded = body && body.uploadId && uploads.get(body.uploadId);
  const chosen = body && body.choiceId && chosenDemo && chosenDemo.id === body.choiceId ? chosenDemo.pack : null;
  const data = uploaded ? uploaded.pack : (chosen || await measureDemo());
  const now = new Date();
  const id = "BATCH-" + now.toISOString().slice(0, 10).replace(/-/g, "") + "-" + Math.random().toString(36).slice(2, 6).toUpperCase();
  const createdAt = now.toISOString().slice(0, 19).replace("T", " ");
  const rules = {
    ...(data.rules || {}),
    products: data.products,
    ruleset: data.ruleset,
    rulesetTitle: data.rulesetTitle,
    summary: data.summary,
    sourceFile: data.sourceFile || ""
  };
  const header = {
    id,
    name: (body && body.name) || "新建计量批次",
    institution: (body && body.institution) || "",
    jurisdiction: (body && body.jurisdiction) || "MO",
    version: (body && body.version) || "",
    baseDate: (body && body.baseDate) || now.toISOString().slice(0, 10),
    imported: data.summary.total,
    success: data.summary.ok,
    exception: data.summary.exception,
    onEad: data.summary.onEad,
    offEad: data.summary.offEad,
    ead: data.summary.ead,
    rwa: data.summary.rwa,
    createdAt,
    status: "completed"
  };
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      `INSERT INTO measure_batch
        (id, name, institution, jurisdiction, version, base_date, imported, success_count, exception_count,
         on_ead, off_ead, ead, rwa, created_at, status, rules_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        header.id, header.name, header.institution, header.jurisdiction, header.version, header.baseDate,
        header.imported, header.success, header.exception, header.onEad, header.offEad, header.ead, header.rwa,
        header.createdAt, header.status, JSON.stringify(rules)
      ]
    );
    for (const row of data.results) {
      await conn.query(
        `INSERT INTO measure_line
          (batch_id, loan_id, customer_name, product_code, exposure_class, weight_text, ead, rwa, status, detail)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          header.id,
          row.loanId,
          row.name || "",
          row.product || "",
          row.exposureClass || "",
          weightText(row.riskWeight),
          row.ead == null ? 0 : row.ead,
          row.rwa == null ? 0 : row.rwa,
          row.status || "ok",
          JSON.stringify(lineDetail(row))
        ]
      );
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
  return { ...header, summary: data.summary, ruleset: data.ruleset, rulesetTitle: data.rulesetTitle };
}

function jsonNum(value) {
  if (value == null || value === "" || value === "null") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function weightFromText(text) {
  if (text == null || text === "") return null;
  const n = Number(String(text).replace("%", "").trim());
  return Number.isFinite(n) ? n / 100 : null;
}

function presentLine(row) {
  const detail = documentOf(row.detail) || {};
  const reference = detail.reference || documentOf(row.detail_reference) || null;
  const crmNote = row.detail_crm_note && row.detail_crm_note !== "null" ? row.detail_crm_note : "";
  return {
    loanId: row.loan_id,
    customer: detail.customer || (row.detail_customer && row.detail_customer !== "null" ? row.detail_customer : ""),
    name: detail.name || row.customer_name || (row.detail_name && row.detail_name !== "null" ? row.detail_name : ""),
    product: row.product_code,
    balance: detail.balance == null ? jsonNum(row.detail_balance) : Number(detail.balance),
    exposureClass: row.exposure_class,
    exposureSubClass: detail.exposureSubClass || (row.detail_sub && row.detail_sub !== "null" ? row.detail_sub : ""),
    matchedRule: detail.matchedRule || (row.detail_rule && row.detail_rule !== "null" ? row.detail_rule : ""),
    riskWeight: detail.riskWeight == null ? (jsonNum(row.detail_weight) == null ? weightFromText(row.weight_text) : jsonNum(row.detail_weight)) : Number(detail.riskWeight),
    onEad: detail.onEad == null ? jsonNum(row.detail_on_ead) : Number(detail.onEad),
    offEad: detail.offEad == null ? jsonNum(row.detail_off_ead) : Number(detail.offEad),
    ead: Number(row.ead),
    rwa: Number(row.rwa),
    status: row.status,
    reference,
    exceptions: detail.exceptions || [],
    eadFormula: detail.eadFormula || (row.detail_formula && row.detail_formula !== "null" ? row.detail_formula : ""),
    eadSteps: detail.eadSteps || [],
    rwaSteps: detail.rwaSteps || [],
    crm: detail.crm || (crmNote ? { note: crmNote } : null)
  };
}

export async function readMeasureRun(id) {
  const rows = await query("SELECT * FROM measure_batch WHERE id = ?", [id]);
  if (!rows[0]) return null;
  const batch = rows[0];
  const rules = documentOf(batch.rules_json) || {};
  const lines = await query(
    `SELECT loan_id, customer_name, product_code, exposure_class, weight_text, ead, rwa, status,
            JSON_UNQUOTE(JSON_EXTRACT(detail, '$.customer')) AS detail_customer,
            JSON_UNQUOTE(JSON_EXTRACT(detail, '$.name')) AS detail_name,
            JSON_EXTRACT(detail, '$.balance') AS detail_balance,
            JSON_UNQUOTE(JSON_EXTRACT(detail, '$.exposureSubClass')) AS detail_sub,
            JSON_UNQUOTE(JSON_EXTRACT(detail, '$.matchedRule')) AS detail_rule,
            JSON_EXTRACT(detail, '$.riskWeight') AS detail_weight,
            JSON_EXTRACT(detail, '$.onEad') AS detail_on_ead,
            JSON_EXTRACT(detail, '$.offEad') AS detail_off_ead,
            JSON_UNQUOTE(JSON_EXTRACT(detail, '$.eadFormula')) AS detail_formula,
            JSON_UNQUOTE(JSON_EXTRACT(detail, '$.crm.note')) AS detail_crm_note,
            JSON_EXTRACT(detail, '$.reference') AS detail_reference
     FROM measure_line WHERE batch_id = ? ORDER BY id`,
    [id]
  );
  const summary = rules.summary || {
    total: lines.length,
    ok: lines.filter((row) => row.status === "ok").length,
    warning: lines.filter((row) => row.status === "warning").length,
    exception: Number(batch.exception_count) || 0,
    onEad: Number(batch.on_ead),
    offEad: Number(batch.off_ead),
    ead: Number(batch.ead),
    rwa: Number(batch.rwa),
    rwaRate: Number(batch.ead) ? round4(Number(batch.rwa) / Number(batch.ead)) : 0
  };
  return {
    batchId: batch.id,
    name: batch.name,
    institution: batch.institution,
    jurisdiction: batch.jurisdiction,
    version: batch.version,
    baseDate: String(batch.base_date).slice(0, 10),
    createdAt: batch.created_at,
    status: batch.status,
    ruleset: rules.ruleset || "",
    rulesetTitle: rules.rulesetTitle || "",
    products: rules.products || {},
    summary,
    results: lines.map(presentLine)
  };
}

function col(title, width) {
  return { title, width };
}

export async function auditWorkbook() {
  const data = await measureDemo();
  const label = (code) => data.products[code] || code || "未识别";
  const money = (value) => (value == null ? "" : Number(value));
  return Buffer.from(writeXlsx([
    {
      name: "ReadMe",
      freeze: 1,
      columns: [col("项目", 22), col("内容", 60)],
      rows: [
        ["规则", data.ruleset],
        ["债项", data.summary.total],
        ["表内 EAD", data.summary.onEad],
        ["表外 EAD", data.summary.offEad],
        ["EAD 合计", data.summary.ead],
        ["信用风险 RWA", data.summary.rwa],
        ["正常 / 待复核 / 异常", data.summary.ok + " / " + data.summary.warning + " / " + data.summary.exception],
        ["说明", "底稿里的业务数据是内置模拟债项，计算口径与计量结果明细相同。"]
      ]
    },
    {
      name: "原始债项数据",
      freeze: 1,
      columns: [col("债项编号", 12), col("客户编号", 12), col("客户名称", 28), col("产品代码", 16), col("币种", 10), col("余额", 16), col("客户类型", 12), col("押品", 16), col("逾期天数", 12), col("五级分类", 12)],
      rows: data.intake.loans.map((loan) => [
        loan.id, loan.customer, loan.name, loan.raw.productCode || "", loan.raw.ccy || "",
        money(loan.raw.balance), loan.raw.custType || "", loan.raw.collateralType || "",
        loan.raw.overdueDays ?? "", loan.raw.loanClass || ""
      ])
    },
    {
      name: "暴露分类结果",
      freeze: 1,
      columns: [col("债项编号", 12), col("客户名称", 28), col("产品类型", 14), col("暴露大类", 22), col("暴露子类", 28), col("命中规则", 28), col("风险权重", 12), col("状态", 10)],
      rows: data.results.map((row) => [
        row.loanId, row.name, label(row.product), row.exposureClass || "未分类",
        row.exposureSubClass || "", row.matchedRule || "", row.riskWeight, row.status
      ])
    },
    {
      name: "EAD计算明细",
      freeze: 1,
      columns: [col("债项编号", 12), col("产品类型", 14), col("表内 EAD", 16), col("表外 EAD", 16), col("EAD", 16), col("公式", 36)],
      rows: data.results.map((row) => [row.loanId, label(row.product), money(row.onEad), money(row.offEad), money(row.ead), row.eadFormula || ""])
    },
    {
      name: "RWA计算明细",
      freeze: 1,
      columns: [col("债项编号", 12), col("暴露大类", 22), col("风险权重", 12), col("EAD", 16), col("RWA", 16)],
      rows: data.results.map((row) => [row.loanId, row.exposureClass || "", row.riskWeight, money(row.ead), money(row.rwa)])
    }
  ]));
}
