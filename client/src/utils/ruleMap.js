// 把 V3.5 规则集文档转成可读的树状视图：条件翻成中文逻辑，参数表和名单挂到节点上。
// 只做展示，不改规则 JSON。

const OP_TEXT = {
  eq: "等于",
  neq: "不等于",
  in: "属于",
  not_in: "不属于",
  contains: "包含",
  not_contains: "不包含",
  lt: "小于",
  lte: "小于等于",
  gt: "大于",
  gte: "大于等于",
  between: "介于",
  exists: "有值",
  is_null: "为空"
};

const ADJUST_TEXT = {
  set: "设为",
  floor: "不低于",
  cap: "不高于",
  add: "加",
  multiply: "乘以",
  ladder_floor: "按档位不低于"
};


function scalarText(value) {
  if (value === true) return "是";
  if (value === false) return "否";
  if (value == null) return "（空）";
  return String(value);
}

function valueText(value, field, codes) {
  if (Array.isArray(value)) return value.map((item) => valueText(item, field, codes)).join("、");
  if (value === true) return "是";
  if (value === false) return "否";
  if (value == null) return "（空）";
  const own = ((field && field.options) || []).find((option) => String(option.code) === String(value));
  if (own && own.label) return own.label;
  if (field && field.type === "number") return String(value);
  return codes[String(value)] != null ? codes[String(value)] : String(value);
}

function listNames(bindings, listTitles) {
  return (bindings || []).map((item) => {
    const id = item && item.list_id;
    return listTitles[id] ? id + "（" + listTitles[id] + "）" : id;
  }).filter(Boolean);
}

export function listCheckText(check, listTitles) {
  const include = listNames(check.include, listTitles);
  const exclude = listNames(check.exclude, listTitles);
  const parts = [];
  if (include.length) parts.push("命中名单 " + include.join(" 或 "));
  if (exclude.length) parts.push("且不在 " + exclude.join("、"));
  if (!parts.length) parts.push("名单判断");
  if (check.assign_to) parts.push("写入 " + check.assign_to);
  if (check.on_missing && check.on_missing !== "not_member") parts.push("未命中按 " + check.on_missing);
  return parts.join("，");
}

export function conditionText(condition, ctx) {
  if (!condition) return "";
  if (Array.isArray(condition.all)) {
    return "（" + condition.all.map((item) => conditionText(item, ctx)).join("；且 ") + "）";
  }
  if (Array.isArray(condition.any)) {
    return "（" + condition.any.map((item) => conditionText(item, ctx)).join("；或 ") + "）";
  }
  if (condition.not) return "非（" + conditionText(condition.not, ctx) + "）";
  if (condition.list_check) return listCheckText(condition.list_check, ctx.listTitles);

  const field = ctx.fields[condition.field];
  const name = field && field.label ? field.label : condition.field || "—";
  const op = condition.op || "eq";
  if (op === "exists") return "「" + name + "」有值";
  if (op === "is_null") return "「" + name + "」为空";
  if (op === "between") {
    return "「" + name + "」在 " + scalarText(condition.lower) + " 到 " + scalarText(condition.upper) + " 之间";
  }
  const right = condition.param_ref
    ? "参数 " + condition.param_ref
    : "「" + valueText(condition.match, field, ctx.codes) + "」";
  return "「" + name + "」" + (OP_TEXT[op] || op) + " " + right;
}

export function summarizeConditions(condition, ctx) {
  if (!condition) return "";
  if (condition.field || condition.list_check || condition.not) return conditionText(condition, ctx);
  const key = Array.isArray(condition.all) ? "all" : Array.isArray(condition.any) ? "any" : "";
  if (!key) return "";
  const parts = condition[key].map((item) => conditionText(item, ctx)).filter(Boolean);
  if (!parts.length) return "";
  return parts.join(key === "all" ? "；且 " : "；或 ");
}

export function basisText(basis) {
  if (!basis) return "";
  if (typeof basis === "string") return basis;
  if (Array.isArray(basis)) return basis.join("、");
  return [basis.instrument, basis.article, basis.section, basis.reference]
    .filter(Boolean)
    .join(" ");
}

function refsOf(condition, refs) {
  if (!condition || typeof condition !== "object") return;
  if (condition.param_ref) refs.tables.add(String(condition.param_ref).split("#")[0]);
  if (condition.list_check) {
    (condition.list_check.include || []).forEach((item) => item && item.list_id && refs.lists.add(item.list_id));
    (condition.list_check.exclude || []).forEach((item) => item && item.list_id && refs.lists.add(item.list_id));
  }
  (condition.all || []).forEach((item) => refsOf(item, refs));
  (condition.any || []).forEach((item) => refsOf(item, refs));
  if (condition.not) refsOf(condition.not, refs);
}

export function nodeRefs(node) {
  const refs = { tables: new Set(), lists: new Set() };
  refsOf(node.when, refs);
  if (node.parameter_lookup && node.parameter_lookup.table_id) refs.tables.add(node.parameter_lookup.table_id);
  (node.adjustments || []).forEach((item) => {
    if (item.ladder_table) refs.tables.add(item.ladder_table);
    refsOf(item.when, refs);
  });
  if (node.otherwise && node.otherwise.id) {
    const child = nodeRefs(node.otherwise);
    child.tables.forEach((id) => refs.tables.add(id));
    child.lists.forEach((id) => refs.lists.add(id));
  }
  return refs;
}

function weightText(value) {
  if (value == null) return "";
  if (typeof value === "number") return value + "%";
  return String(value);
}

export function resultText(result, kind, ctx) {
  if (!result) return "";
  if (kind === "risk_weight") {
    if (result.risk_weight === null) {
      return "转人工复核" + (result.note ? "：" + result.note : "");
    }
    const weight = weightText(result.risk_weight);
    const label = result.label ? "（" + result.label + "）" : "";
    if (weight) return "风险权重 " + weight + label;
    if (result.value != null) return "风险权重 " + weightText(result.value) + label;
    return result.label || "未给出权重";
  }
  const group = result.exposure_class || "";
  const label = result.label ? "（" + result.label + "）" : "";
  if (group) return "归入 " + group + label;
  return result.label || "未给出分类";
}

function adjustmentsOf(node, ctx) {
  return (node.adjustments || []).map((item) => {
    const op = ADJUST_TEXT[item.operation] || item.operation || "";
    let value = "";
    if (item.operation === "ladder_floor") value = item.ladder_table || "档位表";
    else if (item.value != null) value = String(item.value);
    const when = item.when ? "，当 " + summarizeConditions(item.when, ctx) : "";
    return (item.adjustment_id ? item.adjustment_id + "：" : "") + op + " " + value + when;
  });
}

export function nodeView(node, kind, ctx) {
  const refs = nodeRefs(node);
  const children = (node.children || []).map((child) => nodeView(child, kind, ctx));
  const otherwise = node.otherwise && node.otherwise.id
    ? nodeView(node.otherwise, kind, ctx)
    : node.otherwise
      ? {
        id: "",
        label: "否则",
        otherwise: true,
        whenText: "",
        resultText: resultText(node.otherwise, kind, ctx),
        note: (node.otherwise && node.otherwise.note) || "",
        basis: basisText(node.otherwise && node.otherwise.regulatory_basis),
        adjustments: [],
        tables: [],
        lists: [],
        children: []
      }
      : null;
  const result = node.result || null;
  return {
    id: node.id || "",
    label: node.label || node.id || "",
    whenText: summarizeConditions(node.when, ctx),
    resultText: resultText(result, kind, ctx),
    note: node.note || "",
    basis: basisText(node.regulatory_basis),
    fields: Array.isArray(node.fields) ? node.fields.slice() : [],
    when: node.when || null,
    adjustments: adjustmentsOf(node, ctx),
    lookup: node.parameter_lookup
      ? "查询参数表 " + node.parameter_lookup.table_id + "，写入 " + node.parameter_lookup.assign_to
      : "",
    tables: Array.from(refs.tables).map((id) => ({ id, title: ctx.tableTitles[id] || "" })),
    lists: Array.from(refs.lists).map((id) => ({ id, title: ctx.listTitles[id] || "" })),
    children,
    otherwise
  };
}

export function contextOf(document, tableMeta, listMeta) {
  const doc = document || {};
  const fields = {};
  (doc.fields || []).forEach((field) => {
    if (field && field.name) fields[field.name] = field;
  });
  const codes = {};
  (doc.fields || []).forEach((field) => {
    (field.options || []).forEach((option) => {
      if (option && option.code != null) codes[String(option.code)] = option.label;
    });
  });
  const tableTitles = {};
  (doc.tables || []).forEach((table) => {
    if (table && table.table_id) tableTitles[table.table_id] = table.description || "";
  });
  (tableMeta || []).forEach((table) => {
    if (table && table.tableId) tableTitles[table.tableId] = table.title || tableTitles[table.tableId] || "";
  });
  const listTitles = {};
  (doc.lists || []).forEach((list) => {
    if (list && list.list_id) listTitles[list.list_id] = list.title || "";
  });
  (listMeta || []).forEach((list) => {
    if (list && list.listId) listTitles[list.listId] = list.title || listTitles[list.listId] || "";
  });
  return { fields, codes, tableTitles, listTitles, doc };
}
