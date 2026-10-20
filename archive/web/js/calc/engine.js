/* 试算、决策树行走和敞口计算 */
function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function yi(n) {
  return Number(n).toLocaleString("zh-CN", { maximumFractionDigits: 2 }) + " 亿";
}
function pct(n) { return (Number(n) * 100).toFixed(0) + "%"; }

function newCalcLeg(partial) {
  return Object.assign({
    id: "leg" + Date.now(),
    name: "新暴露",
    offbalance: false,
    balanceYi: 0, impairmentYi: 0, nominalYi: 50,
    ccfRuleId: "CCF_COMMIT_40",
    originalRwRuleId: "CN_CORP_001",
    crmApps: []
  }, partial || {});
}

function ccfRateOf(rule) {
  if (!rule) return 0;
  if (typeof rule.ccfRate === "number") return rule.ccfRate;
  const n = parseWeightNumber(rule.ccf);
  return n == null ? 0 : n;
}

function weightRateById(id) {
  const w = allWeightRows().find(function (x) { return x.id === id; });
  if (!w) return null;
  if (w.result && w.result.type === "const" && typeof w.result.risk_weight === "number") return w.result.risk_weight;
  if (w.result && w.result.type === "const") return parseWeightNumber(w.result.display || w.rw);
  return null;
}

function floorRate() {
  const n = parseWeightNumber(paramShown("RW_FLOOR"));
  return n == null ? 0.2 : n;
}

function defaultCrmApp(ruleId) {
  const rule = CRM_RULES.find(function (r) { return r.id === ruleId; }) || CRM_RULES[0];
  const rwRuleId = rule.substitute === "guarantor" ? "CN_PSE_003" : (rule.substitute === "provider" ? "CN_BANK_001" : "CN_SOV_001");
  return {
    ruleId: rule.id, coverageYi: 0, eligible: true, maturityMatch: true, currencyMatch: true,
    haircut: 0, floorExempt: false, correlated: false, rwRuleId: rwRuleId
  };
}

function constWeightOptions(selected) {
  return allWeightRows().filter(function (w) {
    return w.result && w.result.type === "const" && typeof w.result.risk_weight === "number";
  }).map(function (w) {
    return "<option value=\"" + esc(w.id) + "\"" + (w.id === selected ? " selected" : "") + ">"
      + esc(w.id + " · " + (w.rw || pct(w.result.risk_weight)) + " · " + (w.cls || "")) + "</option>";
  }).join("");
}

function currentUpload() {
  return state.uploadBook || SAMPLE_UPLOAD;
}

function uploadDetailRows() {
  return (currentUpload().rows || []).slice();
}

var UPLOAD_FIELD_HINTS = [
  ["product_sub_type", /业务品种|产品细类|产品名称/],
  ["product_type", /产品类型|业务类型/],
  ["counterparty_type", /客户类型|交易对手类型|对手类型/],
  ["counterparty_rating", /外部评级|发行人评级|客户评级/],
  ["investment_grade", /投资级/],
  ["balance", /贷款余额|账面余额|余额/],
  ["impairment", /减值准备|减值|损失准备/],
  ["collateral_type", /抵押物类型|押品类型|担保物类型/],
  ["collateral_value", /抵押物价值|押品价值/],
  ["guarantee_type", /保证人类型|保证类型/],
  ["guarantee_amount", /保证金额/],
  ["ltv", /LTV|贷款价值比|抵质押率/i],
  ["default_status", /五级分类|资产分类|风险分类/],
  ["currency", /币种/],
  ["original_maturity", /原始期限/],
  ["remaining_maturity", /剩余期限/],
  ["cashflow_dependent", /现金流|租金/]
];

function uploadCell(row, fieldId, headerRe) {
  const assigned = state.mapAssignments[fieldId];
  let letter = assigned && String(assigned).indexOf("__const__:") !== 0 ? assigned : "";
  if (!letter) {
    const col = (currentUpload().columns || []).find(function (item) {
      return headerRe.test(String(item.header || "").replace(/\s/g, ""));
    });
    letter = col ? col.letter : "";
  }
  if (!letter || !row) return "";
  return row[letter] == null ? "" : String(row[letter]);
}

/** 解析标准字段当前映射到的 Excel 列 / 常量，并给出取值示意 */
function resolveFieldAssign(fieldId, fallbackSample) {
  const assign = state.mapAssignments[fieldId] || "";
  if (!assign) {
    return { assign: "", value: String(fallbackSample == null || fallbackSample === "" ? "—" : fallbackSample), kind: "none" };
  }
  if (String(assign).indexOf("__const__:") === 0) {
    const v = assign.slice(10);
    return { assign: assign, value: v || "—", kind: "const" };
  }
  const col = (currentUpload().columns || []).find((c) => c.letter === assign);
  if (col) return { assign: assign, value: String(col.sample == null ? "—" : col.sample), kind: "col", col: col };
  return { assign: assign, value: "—", kind: "col" };
}

/** 第一步：参与分类判断的标准字段（来源对应上传 Excel 列，可编辑） */
function classifyJudgeFields() {
  if (state.uploadBook && state.uploadBook.basis === "catalog") {
    return mapTableFields().map(function (field) {
      const resolved = resolveFieldAssign(field.id, "");
      return {
        id: field.id,
        key: "json." + field.id,
        field: field.label || field.id,
        value: resolved.value,
        assign: resolved.assign,
        kind: resolved.kind === "const" ? "const" : "column",
        role: "分类字段 · " + field.id,
        required: true,
        sample: ""
      };
    });
  }
  const prod = PRODUCTS[state.product] || PRODUCTS.loan;
  return (prod.fields || []).map((f) => {
    const resolved = resolveFieldAssign(f.id, f.sample);
    return {
      id: f.id,
      key: "standard." + f.id,
      field: FIELD_LABEL[f.id] || f.zh || f.id,
      value: resolved.value,
      assign: resolved.assign,
      kind: resolved.kind,
      role: f.required ? "必填 · 参与判定" : "选填 · 可参与判定",
      required: !!f.required,
      sample: f.sample
    };
  });
}

function excelSourceOptions(fieldId, currentAssign) {
  const suggest = (!state.uploadBook) ? SAMPLE_UPLOAD.aiSuggest[fieldId] : null;
  let html = "<option value=\"\">不映射 / 稍后补</option>";
  const seen = {};
  function addConst(value, selected) {
    const text = String(value || "").trim();
    if (!text || seen[text]) return;
    seen[text] = true;
    const cv = "__const__:" + text;
    html += "<option value=\"" + esc(cv) + "\"" + (selected ? " selected" : "") + ">常量 · "
      + esc(text) + "</option>";
  }
  if (String(currentAssign).indexOf("__const__:") === 0) addConst(currentAssign.slice(10), true);
  if (suggest && suggest.const) addConst(suggest.const, currentAssign === ("__const__:" + suggest.const));
  html += (currentUpload().columns || []).map((c) =>
    "<option value=\"" + esc(c.letter) + "\"" + (currentAssign === c.letter ? " selected" : "") + ">"
    + esc(c.letter + " · " + c.header) + "</option>"
  ).join("");
  return html;
}

function seedClassifyFields() {
  if (!state.classifyFieldPick) state.classifyFieldPick = {};
  classifyJudgeFields().forEach((f) => {
    if (state.classifyFieldPick[f.key] == null) state.classifyFieldPick[f.key] = true;
  });
}

function classifyTreeCategories() {
  const prodFlow = PRODUCTS[state.product] && ensureProductExpFlow(state.product);
  return (!prodFlow || isExpFlowRef(prodFlow) ? BASE_EXP_TEMPLATE.categories : prodFlow.categories) || [];
}

function classifyResultOptions() {
  const opts = [];
  function walk(nodes, catLabel) {
    (nodes || []).forEach(function (node) {
      const kids = node.children || [];
      const category = catLabel || node.label;
      if (!kids.length) {
        const rw = node.then && node.then.risk_weight;
        opts.push({
          category: category,
          subclass: node.label,
          ruleId: node.id || node.rule_id || "",
          weightRule: node.id || node.rule_id || "",
          rwHint: (rw && rw.display) || node.rw || "—"
        });
        return;
      }
      walk(kids, category);
    });
  }
  walk(classifyTreeCategories(), "");
  return opts;
}

function classifyTagKey(o) {
  return (o.category || "") + "||" + (o.subclass || "");
}

function classifyTagLabel(key) {
  if (!key) return "未打标";
  const parts = String(key).split("||");
  if (parts.length < 2) return key;
  return parts[0] + " · " + parts[1];
}

function findClassifyOpt(pred) {
  return classifyResultOptions().find(pred) || null;
}

function parseSheetNumber(value) {
  const n = parseFloat(String(value == null ? "" : value).replace(/,/g, "").replace(/[—–\-]/g, ""));
  return isFinite(n) ? n : null;
}

/** 上传明细列对到分类 JSON 的字段。对不上的不填，条件就不命中。 */
function assignedCell(row, fieldId) {
  const assigned = state.mapAssignments[fieldId];
  if (!assigned || String(assigned).indexOf("__const__:") === 0 || !row) return "";
  return row[assigned] == null ? "" : String(row[assigned]);
}

function assignedValue(row, fieldId) {
  const assigned = state.mapAssignments[fieldId];
  if (!assigned) return "";
  if (String(assigned).indexOf("__const__:") === 0) return String(assigned).slice(10);
  if (!row) return "";
  return row[assigned] == null ? "" : String(row[assigned]);
}

function instrumentFromText(prod) {
  const code = optionCode("instrument_type", prod);
  if (code) return code;
  if (/黄金/.test(prod)) return "gold";
  if (/现金/.test(prod)) return "cash";
  if (/股权|股票/.test(prod)) return "equity";
  if (/资产担保债券|covered/i.test(prod)) return "covered_bond";
  if (/其他资产|固定资产|无形资产/.test(prod)) return "other_asset";
  return "claim";
}

function maturityMonths(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  const year = raw.match(/^(\d+(?:\.\d+)?)\s*(Y|年)$/i);
  if (year) return Number(year[1]) * 12;
  const month = raw.match(/^(\d+(?:\.\d+)?)\s*(M|月)$/i);
  if (month) return Number(month[1]);
  const n = parseSheetNumber(raw);
  return n != null && n < 600 ? n : null;
}

function optionCode(fieldId, text) {
  const raw = String(text || "").trim();
  if (!raw) return "";
  const field = (state.classFields || []).filter(function (item) { return item.id === fieldId; })[0];
  if (!field) return "";
  const hit = (field.options || []).filter(function (opt) {
    return String(opt.code) === raw || String(opt.label) === raw;
  })[0];
  return hit ? String(hit.code) : "";
}

function knownCounterpartyCode(text) {
  const raw = String(text || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  const known = {
    commercial_bank: "commercial_bank",
    other_fi: "other_fi",
    development_fi: "development_fi",
    policy_bank: "policy_bank",
    corporate: "corporate",
    individual: "individual",
    cn_central_government: "cn_central_government",
    cn_central_bank: "cn_central_bank",
    foreign_sovereign: "foreign_sovereign",
    foreign_central_bank: "foreign_central_bank",
    pse: "pse",
    mdb: "mdb"
  };
  return known[raw] || "";
}

function factsFromUploadRow(row) {
  const prod = assignedValue(row, "instrument_type") || assignedValue(row, "product_sub_type") || assignedValue(row, "product_type") || uploadCell(row, "product_sub_type", /业务品种|产品细类|产品名称/);
  const cp = assignedValue(row, "counterparty_type") || assignedValue(row, "issuer_type") || assignedValue(row, "counterparty_name") || uploadCell(row, "counterparty_type", /客户类型|交易对手类型|对手类型|发行人类型|交易对手名称|对手方/);
  const grade = assignedValue(row, "is_defaulted") || assignedValue(row, "default_status") || uploadCell(row, "default_status", /五级分类|资产分类|风险分类/);
  const note = uploadCell(row, "", /备注|附注/);
  const collateral = assignedCell(row, "has_property_collateral") || assignedCell(row, "property_uses") || uploadCell(row, "collateral_type", /抵押物类型|押品类型|担保物类型/);
  const blob = prod + collateral + note;
  const seniority = assignedValue(row, "seniority");
  const facts = {
    instrument_type: instrumentFromText(prod),
    treat_as_equity: "no",
    is_subordinated: /次级|subordinated/i.test(seniority) ? "yes" : "no",
    is_defaulted: optionCode("is_defaulted", grade) || (/次级|可疑|损失|已违约|逾期|loss|default/i.test(grade) ? "yes" : "no")
  };
  const rating = assignedValue(row, "issuer_rating") || assignedValue(row, "counterparty_rating");
  if (rating && rating !== "—") facts.issuer_rating = /unrated|未评级|无评级/i.test(rating) ? "unrated" : String(rating).trim();
  if (/第二档/.test(note)) facts.bank_tier = "tier2";
  else if (/第一档/.test(note)) facts.bank_tier = "tier1";
  if (grade === "正常") facts.loan_classification_normal = "yes";
  const cpCode = optionCode("counterparty_type", cp) || knownCounterpartyCode(cp);
  const cpNorm = String(cp || "").trim();
  if (cpCode) facts.counterparty_type = cpCode;
  else if (/^BANK$/i.test(cpNorm) || /银行/.test(cp) || /同业|存放/.test(prod) || /foreign\s+banks?|interbank|nostro/i.test(prod + " " + cp)) facts.counterparty_type = "commercial_bank";
  else if (/SOVEREIGN|主权/i.test(cpNorm) || /财政部|中央政府/.test(note)) {
    facts.counterparty_type = /外国|境外|其他国家/.test(note) ? "foreign_sovereign" : "cn_central_government";
  } else if (/^P$/i.test(cpNorm) || /个人|自然人/.test(cp)) facts.counterparty_type = "individual";
  else if (/^C$/i.test(cpNorm) || /公司|企业/.test(cp)) facts.counterparty_type = "corporate";
  if (/居住|住房|按揭|RESIDENTIAL/i.test(blob)) {
    facts.has_property_collateral = "yes";
    facts.property_uses = ["residential"];
    facts.cashflow_dependent = "no";
  }
  if (/商用|物业/.test(blob)) {
    facts.has_property_collateral = "yes";
    facts.property_uses = ["commercial"];
    facts.cashflow_dependent = /租金|现金流/.test(blob) ? "yes" : "no";
  }
  const ltv = parseSheetNumber(assignedCell(row, "ltv") || uploadCell(row, "ltv", /LTV|贷款价值比|抵质押率/i));
  if (ltv != null) facts.ltv = ltv > 3 ? ltv / 100 : ltv;
  const balance = parseSheetNumber(assignedValue(row, "single_exposure") || assignedValue(row, "balance") || uploadCell(row, "balance", /贷款余额|账面余额|余额|本金|principal/i));
  const provision = parseSheetNumber(assignedValue(row, "impairment") || uploadCell(row, "impairment", /减值准备|减值|损失准备/));
  const ratioCell = assignedCell(row, "provision_ratio");
  if (ratioCell) {
    const ratio = parseSheetNumber(ratioCell);
    if (ratio != null && balance != null && balance > 0 && ratio > 1) facts.provision_ratio = ratio / balance;
    else if (ratio != null) facts.provision_ratio = ratio > 1 ? ratio / 100 : ratio;
  } else if (balance != null && provision != null && balance > 0) {
    facts.provision_ratio = provision / balance;
  }
  if (balance != null) facts.single_exposure = balance;
  const dpd = parseSheetNumber(uploadCell(row, "", /DPD|逾期天数/));
  if (dpd != null && dpd > 90) facts.is_defaulted = "yes";
  const months = maturityMonths(assignedValue(row, "original_maturity_months") || assignedValue(row, "original_maturity") || assignedValue(row, "maturity") || uploadCell(row, "original_maturity", /原始期限|期限|maturity/i));
  if (months != null) facts.original_maturity_months = months;
  if (facts.single_exposure != null) {
    let total = 0;
    uploadDetailRows().forEach(function (item) {
      const amount = parseSheetNumber(assignedCell(item, "single_exposure"));
      if (amount) total += amount;
    });
    if (total > 0) facts.exposure_share = facts.single_exposure / total;
  }
  if (/信用卡/.test(prod)) facts.is_credit_card = "yes";
  if (/不依赖/.test(note)) facts.cashflow_dependent = "no";
  if (/贷款|按揭|物业|承诺|透支|额度|信用卡|票据/.test(prod) && !/同业|存放/.test(prod)) facts.fi_bank_applicable = "not_applicable";
  return facts;
}

function legFromUploadRow(row, index) {
  const facts = factsFromUploadRow(row);
  const hit = classifyFacts(facts);
  const balance = Number(facts.single_exposure) || 0;
  const ratio = typeof facts.provision_ratio === "number" ? facts.provision_ratio : 0;
  const yiBal = balance / 100000000;
  const product = assignedValue(row, "instrument_type") || assignedValue(row, "product_type") || "";
  const who = assignedValue(row, "counterparty_name") || assignedValue(row, "issuer_type") || assignedValue(row, "counterparty_type") || "";
  const rowName = row.A && row.A !== product ? row.A : "";
  const ccf = parseSheetNumber(row.M);
  const off = ccf != null && /额度|表外|承诺|未使用/.test(product + (row.O || ""));
  return newCalcLeg({
    id: "up-" + (row.id || index),
    name: [rowName, product, who].filter(Boolean).join(" · ") || ("暴露 " + (index + 1)),
    offbalance: off,
    balanceYi: yiBal,
    impairmentYi: Math.round(yiBal * ratio * 10000) / 10000,
    nominalYi: yiBal,
    ccfRate: off ? ccf : null,
    facts: facts,
    originalRwRuleId: (hit && hit.ruleId) || "CN_CORP_001",
    crmApps: [],
    sourceSheet: (state.uploadBook && state.uploadBook.sheet) || "",
    sourceRow: row.excelRow,
    sourceHeader: state.uploadBook && state.uploadBook.headerRow
  });
}

function syncCalcLegsFromUpload() {
  const book = state.uploadBook;
  if (!book || !(book.rows || []).length) return;
  const rows = uploadDetailRows().filter(function (row) {
    return !state.classifyPick || state.classifyPick[row.id] !== false;
  });
  if (!rows.length) return;
  state.calcLegs = rows.map(legFromUploadRow);
  state.selectedLeg = 0;
  state.openWeightNote = "";
}

function legNeedsOpenGrade(leg) {
  if (!leg || leg.gradeNote) return false;
  const facts = leg.facts || {};
  const hit = classifyFacts(facts);
  if (typeof hit.rwRate === "number") return false;
  const text = (hit.category || "") + (hit.subclass || "");
  if (facts.counterparty_type === "commercial_bank" || /商业银行/.test(text)) return true;
  if (/共同抵押/.test(text)) return true;
  if (/已违约/.test(text) && facts.provision_ratio == null) return true;
  return false;
}

function fillOpenWeights() {
  const legs = (state.calcLegs || []).filter(legNeedsOpenGrade);
  if (!legs.length || (state.uploadBook && state.uploadBook.basis === "paper")) return false;
  state.openWeightWait = true;
  render();
  fetch("/api/open-weights", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      rows: legs.map(function (leg) {
        return {
          id: leg.id,
          name: leg.name || "",
          sheet: leg.sourceSheet || "",
          ead_yi: leg.balanceYi || 0,
          facts: leg.facts || {}
        };
      })
    })
  })
    .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
    .then(function (pack) {
      state.openWeightWait = false;
      const data = pack.data || {};
      if (!pack.ok || data.error) {
        state.openWeightNote = (data && data.error) || "资本档次没有补上，这些行仍可手填权重。";
        render();
        return;
      }
      const byId = {};
      (data.rows || []).forEach(function (row) { if (row && row.id) byId[row.id] = row; });
      (state.calcLegs || []).forEach(function (leg) {
        const row = byId[leg.id];
        if (!row) return;
        leg.facts = Object.assign({}, leg.facts || {}, row.facts || {});
        if (row.reason) leg.gradeNote = row.reason;
        else if (typeof row.rw === "number") leg.gradeNote = row.rw_text || "已按规则补上权重";
      });
      state.openWeightNote = data.note || "";
      render();
    })
    .catch(function () {
      state.openWeightWait = false;
      state.openWeightNote = "资本档次没有补上，这些行仍可手填权重。";
      render();
    });
  return true;
}

function factsFromLeg(leg) {
  const name = String((leg && leg.name) || "");
  const facts = {
    instrument_type: /股权/.test(name) ? "equity" : "claim",
    treat_as_equity: "no",
    is_subordinated: "no",
    is_defaulted: /违约|次级|可疑|损失/.test(name) ? "yes" : "no",
    counterparty_type: "corporate"
  };
  if (/第二档/.test(name)) facts.bank_tier = "tier2";
  else if (/第一档/.test(name)) facts.bank_tier = "tier1";
  if (/同业|存放|银行/.test(name)) facts.counterparty_type = "commercial_bank";
  else if (/个人/.test(name)) facts.counterparty_type = "individual";
  if (/住房|按揭|居住/.test(name)) {
    facts.has_property_collateral = "yes";
    facts.property_uses = ["residential"];
    facts.cashflow_dependent = "no";
    facts.counterparty_type = "individual";
  }
  if (/商用|物业/.test(name)) {
    facts.has_property_collateral = "yes";
    facts.property_uses = ["commercial"];
    facts.cashflow_dependent = /租金|现金流/.test(name) ? "yes" : "no";
  }
  if (/贷款|按揭|物业|承诺/.test(name) && !/同业|存放/.test(name)) facts.fi_bank_applicable = "not_applicable";
  if (leg && leg.balanceYi > 0 && leg.impairmentYi != null) facts.provision_ratio = leg.impairmentYi / leg.balanceYi;
  return facts;
}

function condExpected(cond) {
  if (!cond) return undefined;
  return cond.value != null ? cond.value : cond.match;
}

function matchTreeCond(cond, facts) {
  if (!cond || !cond.field) return false;
  if (!Object.prototype.hasOwnProperty.call(facts, cond.field)) return false;
  const actual = facts[cond.field];
  if (actual == null || actual === "") return false;
  const op = cond.op || "eq";
  const expected = condExpected(cond);
  if (op === "eq") return actual === expected || String(actual) === String(expected);
  if (op === "neq") return String(actual) !== String(expected);
  if (op === "in") {
    const list = Array.isArray(expected) ? expected : [expected];
    return list.some(function (item) { return item === actual || String(item) === String(actual); });
  }
  if (op === "contains") {
    const list = Array.isArray(actual) ? actual : String(actual).split(/[,，]/);
    return list.some(function (item) { return item === expected || String(item) === String(expected); });
  }
  const left = Number(actual);
  const right = Number(expected);
  if (!isFinite(left) || !isFinite(right)) return false;
  if (op === "gt") return left > right;
  if (op === "gte") return left >= right;
  if (op === "lt") return left < right;
  if (op === "lte") return left <= right;
  return false;
}

function matchTreeWhen(when, facts) {
  if (!when || typeof when !== "object") return false;
  if (Array.isArray(when.all)) {
    return when.all.length > 0 && when.all.every(function (item) { return matchTreeItem(item, facts); });
  }
  if (Array.isArray(when.any)) {
    return when.any.length > 0 && when.any.some(function (item) { return matchTreeItem(item, facts); });
  }
  if (when.field) return matchTreeCond(when, facts);
  return false;
}

function matchTreeItem(item, facts) {
  if (!item || typeof item !== "object") return false;
  if (item.all || item.any) return matchTreeWhen(item, facts);
  return matchTreeCond(item, facts);
}

function treeNodeSkipped(node, facts) {
  const skip = node && node.skip;
  if (!skip || !skip.field) return false;
  return matchTreeCond({ field: skip.field, op: skip.op || "eq", value: skip.match != null ? skip.match : skip.value }, facts);
}

function treeWeightOf(node) {
  const rw = node && node.then && node.then.risk_weight;
  if (!rw) return { type: "unspecified", display: (node && node.rw) || "权重未单列" };
  if (rw.type === "const" && typeof rw.value === "number") return { type: "const", value: rw.value, display: rw.display || ((rw.value * 100) + "%") };
  if (rw.type === "counterparty") return { type: "counterparty", display: rw.display || "按交易对手" };
  if (rw.type === "max") return { type: "max", floor: typeof rw.with === "number" ? rw.with : 0.9, display: rw.display || "较大值" };
  return { type: rw.type || "unspecified", display: rw.display || "权重未单列" };
}

function walkExposureLevel(nodes, facts) {
  const active = [];
  let skippedWouldHit = false;
  (nodes || []).forEach(function (node) {
    if (treeNodeSkipped(node, facts)) {
      if (matchTreeWhen(node.match, facts)) skippedWouldHit = true;
      return;
    }
    active.push(node);
  });
  let whenHit = false;
  for (let i = 0; i < active.length; i++) {
    const node = active[i];
    if (node.otherwise) {
      if (whenHit || skippedWouldHit) continue;
    } else if (!matchTreeWhen(node.match, facts)) {
      continue;
    } else {
      whenHit = true;
    }
    const kids = node.children || [];
    if (kids.length) {
      const child = walkExposureLevel(kids, facts);
      if (child && child.cancelled) {
        whenHit = false;
        continue;
      }
      if (child && child.node) return { node: child.node, path: [node].concat(child.path) };
      return { node: node, path: [node] };
    }
    return { node: node, path: [node] };
  }
  if (!whenHit && skippedWouldHit) return { cancelled: true };
  return null;
}

function ordinaryClaimFacts(facts) {
  const next = Object.assign({}, facts);
  next.instrument_type = "claim";
  next.treat_as_equity = "no";
  next.is_defaulted = "no";
  next.is_subordinated = "no";
  next.has_property_collateral = "no";
  delete next.property_uses;
  delete next.cashflow_dependent;
  delete next.ltv;
  return next;
}

function traceValue(value) {
  if (value == null || value === "") return "";
  if (Array.isArray(value)) return value.map(traceValue).join(", ");
  if (typeof value === "number" && Math.abs(value - Math.round(value)) < 1e-9) return String(Math.round(value));
  return String(value);
}

function traceOp(op) {
  const labels = { eq: "等于", neq: "不等于", in: "属于", contains: "包含", gt: "大于", gte: "大于等于", lt: "小于", lte: "小于等于" };
  return labels[op] || op || "等于";
}

function traceStep(stage, title, extra) {
  return Object.assign({
    stage: stage, title: title, field: "", op: "", expected: "", actual: "", hit: null, result: "", note: ""
  }, extra || {});
}

function numberTraceSteps(steps) {
  return (steps || []).map(function (item, index) {
    const copy = traceStep(item.stage, item.title, item);
    copy.seq = index + 1;
    copy.actual = traceValue(copy.actual);
    copy.expected = traceValue(copy.expected);
    copy.result = traceValue(copy.result);
    return copy;
  });
}

function fieldTraceLabel(fieldId) {
  const field = (state.classFields || []).filter(function (item) { return item.id === fieldId; })[0];
  return (field && field.label) || fieldId;
}

function assignmentNote(fieldId) {
  const assigned = state.mapAssignments && state.mapAssignments[fieldId];
  if (!assigned) return "规则或文本识别";
  if (String(assigned).indexOf("__const__:") === 0) return "常量 " + String(assigned).slice(10);
  const column = ((state.uploadBook && state.uploadBook.columns) || []).filter(function (item) { return item.letter === assigned; })[0];
  return "列 " + assigned + (column && column.header ? " " + column.header : "");
}

function factSteps(facts) {
  const steps = [];
  Object.keys(facts || {}).forEach(function (key) {
    if (!key || key.charAt(0) === "_") return;
    const value = facts[key];
    if (value == null || value === "") return;
    steps.push(traceStep("取值", fieldTraceLabel(key), {
      field: key,
      actual: value,
      hit: true,
      note: assignmentNote(key)
    }));
  });
  return steps;
}

function conditionSteps(match, facts, title) {
  const steps = [];
  function walk(node) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node.all)) {
      node.all.forEach(walk);
      return;
    }
    if (Array.isArray(node.any)) {
      node.any.forEach(walk);
      return;
    }
    if (!node.field) return;
    const expected = node.value != null ? node.value : node.match;
    steps.push(traceStep("分类", title, {
      field: node.field,
      op: traceOp(node.op || "eq"),
      expected: expected,
      actual: facts[node.field],
      hit: matchTreeCond(node, facts)
    }));
  }
  walk(match);
  return steps;
}

function walkSteps(path, facts) {
  const steps = [];
  (path || []).forEach(function (node) {
    const title = node.label || "";
    const conds = conditionSteps(node.match, facts, title);
    if (conds.length) steps.push.apply(steps, conds);
    else steps.push(traceStep("分类", title, {
      hit: true,
      note: node.otherwise ? "同层其余分支都未命中，落入这一档" : "进入这一档"
    }));
  });
  return steps;
}

/** 按知识库决策树走一笔。第一条命中再进下级；不适用的分支跳过，且不落入同一层兜底。 */
function classifyFacts(facts, ordinary) {
  const walked = walkExposureLevel(classifyTreeCategories(), facts);
  if (!walked || !walked.node) {
    return {
      category: "未归类", subclass: "未归类", path: ["未归类"], ruleId: "unclassified",
      weightRule: "unclassified", rwHint: "—", rwRate: null,
      steps: [traceStep("分类", "未归类", { hit: false, note: "决策树没有命中风险暴露类型" })]
    };
  }
  const node = walked.node;
  const labels = walked.path.map(function (item) { return item.label; });
  let weight = treeWeightOf(node);
  let rwRate = weight.type === "const" ? weight.value : null;
  let steps = walkSteps(walked.path, facts);
  if (!ordinary && (weight.type === "counterparty" || weight.type === "max")) {
    const again = classifyFacts(ordinaryClaimFacts(facts), true);
    const other = again && typeof again.rwRate === "number" ? again.rwRate : null;
    if (weight.type === "counterparty") {
      rwRate = other;
      weight = { display: other == null ? "按交易对手" : ((other * 100) + "%") };
    } else {
      rwRate = other == null ? weight.floor : Math.max(weight.floor, other);
      weight = { display: (rwRate * 100) + "%" };
    }
    (again && again.steps || []).forEach(function (item) {
      steps.push(Object.assign({}, item, { note: (item.note ? item.note + "；" : "") + "按交易对手的普通债权再走一次" }));
    });
  }
  return {
    category: labels[0] || node.label,
    subclass: labels[labels.length - 1] || node.label,
    path: labels,
    ruleId: node.id || node.rule_id || "",
    weightRule: node.id || node.rule_id || "",
    rwHint: weight.display || "—",
    rwRate: rwRate,
    steps: steps
  };
}

/** 按上传明细行，用决策树给出分类标签 */
function suggestRowClassifyTag(row) {
  const hit = classifyFacts(factsFromUploadRow(row));
  return hit ? classifyTagKey(hit) : "";
}

function seedClassifyTags() {
  if (!state.classifyPick) state.classifyPick = {};
  if (!state.classifyTags) state.classifyTags = {};
  uploadDetailRows().forEach((row) => {
    if (state.classifyPick[row.id] == null) state.classifyPick[row.id] = true;
    if (!state.classifyTags[row.id]) state.classifyTags[row.id] = suggestRowClassifyTag(row);
  });
}

/** 试算按知识库决策树给定分类和权重 */
function classifyLeg(leg) {
  if (leg && leg.paperClass) return leg.paperClass;
  if (leg && leg.facts) return classifyFacts(leg.facts);
  return classifyFacts(factsFromLeg(leg));
}

/** 合并人工覆盖后的分类结果（供试算 / 展示） */
function effectiveClassify(leg) {
  const auto = classifyLeg(leg);
  const ov = (state.classifyOverride || {})[leg.id];
  if (!ov || !ov.manual) return auto;
  return Object.assign({}, auto, {
    category: ov.category || auto.category,
    subclass: ov.subclass || auto.subclass,
    ruleId: ov.ruleId || auto.ruleId,
    weightRule: ov.weightRule || auto.weightRule,
    rwHint: ov.rwHint || auto.rwHint,
    manual: true
  });
}

function applyCrmApp(app, remain) {
  const rule = CRM_RULES.find(function (r) { return r.id === app.ruleId; }) || CRM_RULES[0];
  const steps = [];
  let cover = Math.max(0, Number(app.coverageYi) || 0);
  if (!app.eligible) {
    steps.push("不合格，覆盖不计入");
    cover = 0;
  } else {
    steps.push("合格");
    steps.push("覆盖 " + cover);
  }
  if (app.eligible && rule.constraints && rule.constraints.maturity && !app.maturityMatch) {
    steps.push("期限短于暴露，本工具不生效");
    cover = 0;
  } else if (app.eligible) {
    steps.push("期限匹配");
  }
  if (app.eligible && rule.constraints && rule.constraints.currency && !app.currencyMatch) {
    steps.push("币种不匹配，本工具不生效");
    cover = 0;
  } else if (app.eligible && rule.constraints && rule.constraints.currency) {
    steps.push("币种匹配");
  } else if (app.eligible) {
    steps.push("质物币种错配不调整");
  }
  if (app.eligible && rule.constraints && rule.constraints.correlation && app.correlated) {
    steps.push("与债务人高度正相关，缓释不生效");
    cover = 0;
  }
  const hair = Math.min(1, Math.max(0, Number(app.haircut) || 0));
  const adjusted = cover * (1 - hair);
  if (app.eligible) steps.push(hair > 0 ? ("折扣 " + pct(hair) + "，调整后 " + adjusted) : "折扣 0，调整后 " + adjusted);
  let rw = weightRateById(app.rwRuleId);
  if (rw == null) rw = 0;
  const floor = floorRate();
  if (cover > 0 && rule.floorParam && !app.floorExempt && rw < floor) {
    steps.push("底线 " + pct(floor));
    rw = floor;
  } else if (cover > 0 && rule.floorParam && app.floorExempt) {
    steps.push("特定回购豁免底线，沿用 " + pct(rw));
  }
  const amount = Math.min(adjusted, Math.max(0, remain));
  if (adjusted > remain + 1e-9) steps.push("超过剩余暴露，截到 " + amount);
  if (amount > 0) steps.push("替代权重 " + (app.rwRuleId || "") + " " + pct(rw) + "，原权重不改");
  const shortName = rule.id === "CRM_COL_GOV" ? "国债质押" : (rule.id === "CRM_GUAR_PSE" ? "公共部门保证" : rule.type);
  return {
    name: shortName, amount: amount, rw: rw, rule: rule.id,
    note: steps.join(" → "), rwa: amount * rw, asked: Math.max(0, Number(app.coverageYi) || 0)
  };
}

function calcOneLeg(leg) {
  const ccfRule = CCF_RULES.find(function (r) { return r.id === leg.ccfRuleId; }) || CCF_RULES[1];
  const ccf = typeof leg.ccfRate === "number" ? leg.ccfRate : ccfRateOf(ccfRule);
  leg.ccf = ccf;
  const fromPaper = !!(leg && leg.fromPaper);
  let ead = Math.max(0, (leg.balanceYi || 0) - (leg.impairmentYi || 0));
  let eadNote = fromPaper ? "明细账面余额，澳门元折成亿元" : "账面 − 减值";
  if (!fromPaper && leg.offbalance) {
    ead = Math.max(0, (leg.nominalYi || 0) * ccf);
    eadNote = "名义 × " + ccfRule.id + " 的 " + pct(ccf);
  }
  const cls = effectiveClassify(leg);
  const treeRw = cls && typeof cls.rwRate === "number" ? cls.rwRate : null;
  const originalRw = weightRateById(leg.originalRwRuleId);
  const handRw = typeof leg.handRw === "number" ? leg.handRw : null;
  const paperOpen = fromPaper && typeof leg.rwRate !== "number";
  const uncoveredRw = paperOpen
    ? 0
    : (fromPaper
      ? leg.rwRate
      : (handRw != null ? handRw : (treeRw == null ? (originalRw == null ? 1 : originalRw) : treeRw)));
  const uncoveredRule = fromPaper ? "底稿" : (treeRw == null ? (leg.originalRwRuleId || "CN_CORP_001") : (cls.ruleId || ""));
  const uncoveredNote = fromPaper
    ? ("底稿 " + ((cls.path || []).join(" · ")) + " · " + (cls.rwHint || pct(uncoveredRw)))
    : (treeRw == null
    ? ("决策树未给出固定权重，未覆盖部分沿用权重表 " + (leg.originalRwRuleId || "") + " " + pct(uncoveredRw))
    : ("决策树 " + ((cls.path || []).join(" → ")) + " · " + pct(uncoveredRw)));
  let remain = ead;
  const segs = [];
  let over = false;
  (leg.crmApps || []).forEach(function (app, k) {
    const asked = Math.max(0, Number(app.coverageYi) || 0);
    const seg = applyCrmApp(app, remain);
    seg.appIndex = k;
    if (asked > remain + 1e-9) over = true;
    remain = Math.max(0, remain - seg.amount);
    if (asked > 0 || seg.amount > 0) segs.push(seg);
  });
  segs.push({
    name: "未缓释",
    amount: remain,
    rw: uncoveredRw,
    rule: uncoveredRule,
    note: uncoveredNote + "，缓释不改这一档",
    rwa: remain * uncoveredRw,
    asked: remain
  });
  const rwa = segs.reduce(function (a, s) { return a + s.rwa; }, 0);
  const formula = paperOpen
    ? "权重还没填，这一档先不计入"
    : segs.filter(function (s) { return s.amount > 0; })
      .map(function (s) {
        const shown = fromPaper && cls && cls.rwHint ? cls.rwHint : pct(s.rw);
        return s.amount.toFixed(s.amount % 1 ? 2 : 0) + "×" + shown;
      })
      .join(" + ") + " = " + rwa.toFixed(2) + " 亿元";
  const openWeight = paperOpen || (!fromPaper && treeRw == null && handRw == null);
  const applied = handRw != null ? handRw : treeRw;
  const steps = (cls && cls.steps ? cls.steps.slice() : []);
  if (handRw != null) {
    steps.push(traceStep("权重", "手填权重", {
      actual: weightPoints(handRw) + "%",
      result: weightPoints(handRw) + "%",
      hit: true,
      note: "页面手填"
    }));
  } else if (typeof treeRw === "number") {
    steps.push(traceStep("权重", "规则权重", {
      result: cls.rwHint || pct(treeRw),
      hit: true,
      note: (leg && leg.gradeNote) || ""
    }));
  } else {
    steps.push(traceStep("权重", "权重未定", { hit: false, note: "决策树没有给出固定权重，待手填" }));
  }
  steps.push(traceStep("敞口", eadNote, {
    field: leg.offbalance ? "nominal" : "balance",
    actual: leg.offbalance ? leg.nominalYi : leg.balanceYi,
    result: ead,
    hit: true,
    note: eadNote
  }));
  if (segs.length > 1) {
    segs.forEach(function (seg) {
      steps.push(traceStep("缓释", seg.name, {
        actual: seg.amount,
        expected: pct(seg.rw),
        result: seg.rwa,
        hit: true,
        note: seg.note || ""
      }));
    });
  }
  steps.push(traceStep("风险加权资产", "敞口 × 权重", {
    result: openWeight ? "" : rwa,
    hit: !openWeight,
    note: openWeight ? "权重未填，不计入合计" : (traceValue(ead) + " × " + (applied == null ? "—" : pct(applied)) + " = " + traceValue(rwa))
  }));
  const usedFacts = fromPaper ? (leg.facts || null) : ((leg && leg.facts) || factsFromLeg(leg));
  const numbered = numberTraceSteps((usedFacts ? factSteps(usedFacts) : []).concat(steps));
  leg.traceSteps = numbered;
  return {
    ead: ead, eadNote: eadNote, segs: segs, rwa: rwa, formula: formula,
    over: over, offbalance: !!leg.offbalance, classify: cls, ccf: ccf, ccfRuleId: ccfRule.id,
    openWeight: openWeight,
    steps: numbered
  };
}

function calcEngine() {
  const legs = state.calcLegs || [];
  const results = legs.map(function (leg) { return Object.assign({ leg: leg }, calcOneLeg(leg)); });
  const ead = results.reduce(function (a, r) { return a + r.ead; }, 0);
  const openCount = results.filter(function (r) { return r.openWeight; }).length;
  const rwa = results.reduce(function (a, r) { return a + (r.openWeight ? 0 : r.rwa); }, 0);
  const map = {};
  const order = [];
  results.forEach(function (r) {
    r.segs.forEach(function (s) {
      if (!(s.amount > 0)) return;
      const key = s.rule + "|" + s.name;
      if (!map[key]) {
        map[key] = { name: s.name, amount: 0, rwa: 0, rule: s.rule, note: s.note };
        order.push(key);
      }
      map[key].amount += s.amount;
      map[key].rwa += s.rwa;
    });
  });
  const segs = order.map(function (key) {
    const s = map[key];
    s.rw = s.amount > 0 ? s.rwa / s.amount : 0;
    return s;
  });
  const formula = results.length
    ? results.map(function (r, i) { return (r.leg.name || ("暴露" + (i + 1))) + " " + r.rwa.toFixed(r.rwa % 1 ? 2 : 0); })
      .join(" + ") + " = " + rwa.toFixed(rwa % 1 ? 2 : 0) + " 亿元"
    : "0";
  const fullUncovered = results.reduce(function (a, r) {
    if (r.leg && r.leg.fromPaper) return a + r.rwa;
    const rate = weightRateById(r.leg.originalRwRuleId);
    return a + r.ead * (rate == null ? 1 : rate);
  }, 0);
  return {
    ead: ead, segs: segs, rwa: rwa, formula: formula,
    over: results.some(function (r) { return r.over; }),
    legs: results,
    fullUncovered: fullUncovered,
    onCount: results.filter(function (r) { return !r.offbalance; }).length,
    offCount: results.filter(function (r) { return r.offbalance; }).length,
    openCount: openCount
  };
}

function demoCalcLegs() {
  return [
    newCalcLeg({
      id: "leg-demo-on", name: "流动资金贷款（表内）", offbalance: false,
      balanceYi: 100, impairmentYi: 10, originalRwRuleId: "CN_CORP_001",
      crmApps: [
        { ruleId: "CRM_COL_GOV", coverageYi: 10, eligible: true, maturityMatch: true, currencyMatch: true, haircut: 0, floorExempt: true, correlated: false, rwRuleId: "CN_SOV_001" },
        { ruleId: "CRM_GUAR_PSE", coverageYi: 50, eligible: true, maturityMatch: true, currencyMatch: true, haircut: 0, floorExempt: false, correlated: false, rwRuleId: "CN_PSE_003" }
      ]
    })
  ];
}
