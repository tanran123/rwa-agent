/**
 * 流动性产品配置与 LCR 数据集处理。
 *
 * 产品、标准字段、规则、参数表、名单都按 (jurisdiction, rule_version) 版本化存储。
 * 这里只做读取、维护和数据准备；LCR 计算在 agent/core/hqla/lcr.py。
 */

import { query } from "./db.js";

function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function parseJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === "string") {
    try { return JSON.parse(value); } catch { return fallback; }
  }
  return value;
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function nowText() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function slug(value) {
  return String(value == null ? "" : value).replace(/[^A-Za-z0-9_.-]+/g, "-");
}

function uid(...parts) {
  return ["liquidity", ...parts].map(slug).join("-");
}

function text(value, size) {
  return String(value == null ? "" : value).slice(0, size);
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

// ---------------------------------------------------------------- 版本上下文

export async function liquidityVersions(jurisdiction = "HK") {
  const rows = await query(
    `SELECT rv.id, rv.jurisdiction, rv.version, rv.name, rv.status,
            m.lcr_version, m.lcr_version_name,
            (SELECT COUNT(*) FROM liquidity_product p
              WHERE p.jurisdiction = rv.jurisdiction AND p.rule_version = rv.version) AS productCount
       FROM rule_version rv
       LEFT JOIN liquidity_config_meta m
         ON m.jurisdiction = rv.jurisdiction AND m.rule_version = rv.version
      WHERE (? = '' OR rv.jurisdiction = ?)
      ORDER BY rv.jurisdiction, rv.status = 'published' DESC, rv.version DESC`,
    [jurisdiction, jurisdiction]
  );
  return rows.map((row) => ({
    id: row.id,
    jurisdiction: row.jurisdiction,
    version: row.version,
    name: row.name,
    status: row.status,
    lcrVersion: row.lcr_version || "",
    lcrVersionName: row.lcr_version_name || "",
    productCount: Number(row.productCount) || 0
  }));
}

async function versionContext(params = {}) {
  const jurisdiction = String(params.jurisdiction || "").toUpperCase();
  let version = String(params.version || "");
  if (!jurisdiction && !version) throw fail(400, "需要指定监管规则版本");
  if (!version) {
    const rows = await query(
      `SELECT rv.version FROM rule_version rv
        WHERE (? = '' OR rv.jurisdiction = ?)
        ORDER BY rv.status = 'published' DESC, rv.version DESC LIMIT 1`,
      [jurisdiction, jurisdiction]
    );
    version = rows.length ? rows[0].version : "";
  }
  if (!version) throw fail(404, "没有找到监管规则版本");
  let jur = jurisdiction;
  if (!jur) {
    const rows = await query("SELECT jurisdiction FROM rule_version WHERE version = ? LIMIT 1", [version]);
    jur = rows.length ? rows[0].jurisdiction : "HK";
  }
  return { jurisdiction: jur, version };
}

// ---------------------------------------------------------------- 行 → 对象

function fieldOut(row) {
  const attributes = parseJson(row.attributes_json, {});
  return {
    code: row.field_code,
    name: row.field_name,
    category: row.category,
    group: row.field_group,
    groupOrder: Number(row.group_order) || 0,
    dataType: row.data_type,
    role: row.role,
    required: !!Number(row.required),
    valueType: row.value_type,
    dictionary: row.dictionary || "",
    source: row.source_column || "",
    aliases: parseJson(row.aliases_json, []),
    description: row.description || "",
    status: row.status,
    sort: Number(row.sort_order) || 0,
    attributes,
    businessType: attributes.businessType || "",
    unit: attributes.unit || "",
    precision: attributes.precision == null ? null : attributes.precision,
    nullable: attributes.nullable == null ? null : !!attributes.nullable,
    defaultValue: attributes.defaultValue == null ? null : attributes.defaultValue,
    sourceType: attributes.sourceType || "",
    enum: Array.isArray(attributes.enum) ? attributes.enum : [],
    requiredNote: attributes.requiredNote || ""
  };
}

function identifiers(text) {
  return [...new Set(String(text || "").match(/[A-Za-z_][A-Za-z0-9_]{2,}/g) || [])];
}

function resultKeys(text) {
  const keys = [];
  const pattern = /([A-Za-z_][A-Za-z0-9_]*)\s*:/g;
  let match;
  while ((match = pattern.exec(String(text || "")))) {
    if (!keys.includes(match[1])) keys.push(match[1]);
  }
  return keys;
}

function ruleInputs(row) {
  const reserved = new Set(["true", "false", "null", "and", "or", "not", "in", "is"]);
  return identifiers(row.condition_text || "").filter((name) => {
    if (reserved.has(name.toLowerCase())) return false;
    return !/^[A-Z0-9_]+$/.test(name);
  });
}

function ruleOut(row) {
  return {
    id: row.rule_id,
    name: row.name,
    packageId: row.package_id,
    packageName: row.package_name,
    side: row.side,
    sequence: Number(row.sequence_no) || 0,
    priority: Number(row.priority) || 0,
    ruleType: row.rule_type,
    ruleTypeName: row.rule_type_name,
    condition: row.condition_text || "",
    result: row.result_text || "",
    basis: row.basis || "",
    description: row.description || "",
    products: parseJson(row.products_json, []),
    inputs: ruleInputs(row),
    outputs: resultKeys(row.result_text || ""),
    status: "ACTIVE"
  };
}

function productRowOut(row) {
  return {
    code: row.code,
    name: row.name,
    category: row.category,
    productGroup: row.product_group,
    side: row.side,
    source: row.source_system,
    status: row.status,
    description: row.description,
    domains: parseJson(row.domains_json, []),
    paramKey: row.param_key,
    ruleCount: Number(row.rule_count) || 0,
    groupMode: row.group_mode || "NONE",
    updatedAt: row.updated_at
  };
}

const SIDE_LABEL = { ASSET: "资产端", INFLOW: "现金流入", OUTFLOW: "现金流出" };
const STRING_OPS = ["eq", "neq", "in", "not_in", "contains", "not_contains", "exists", "is_null"];
const NUMBER_OPS = ["eq", "neq", "gt", "gte", "lt", "lte", "between", "exists", "is_null"];
const DATE_OPS = ["eq", "neq", "before", "after", "between", "exists", "is_null"];
const BOOLEAN_OPS = ["eq", "exists", "is_null"];

function fieldOps(dataType) {
  const type = String(dataType || "").toUpperCase();
  if (["INTEGER", "DECIMAL", "NUMBER", "PERCENT", "CURRENCY"].includes(type)) return NUMBER_OPS;
  if (type === "DATE") return DATE_OPS;
  if (type === "BOOLEAN") return BOOLEAN_OPS;
  return STRING_OPS;
}

function conditionFields(tree) {
  const found = [];
  function walk(node) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node.conditions)) {
      node.conditions.forEach(walk);
      return;
    }
    if (node.field) found.push(String(node.field));
  }
  walk(tree);
  return [...new Set(found)];
}

function validateConditions(tree, fieldsByCode, dictionaryMap) {
  const errors = [];
  if (!tree || typeof tree !== "object") {
    return { valid: false, errors: ["尚未配置识别条件"], fields: [] };
  }
  function walk(node, path) {
    if (!node || typeof node !== "object") {
      errors.push(path + " 不是有效的条件");
      return;
    }
    if (Array.isArray(node.conditions)) {
      if (node.logic !== "AND" && node.logic !== "OR") errors.push(path + " 条件组缺少 AND/OR");
      if (!node.conditions.length) errors.push(path + " 条件组为空");
      node.conditions.forEach((child, index) => walk(child, path + "." + (index + 1)));
      return;
    }
    const field = fieldsByCode.get(String(node.field || ""));
    if (!field) {
      errors.push(path + " 引用的字段不存在");
      return;
    }
    if (field.status !== "ACTIVE") errors.push(path + " 引用的字段已停用");
    const ops = fieldOps(field.dataType);
    const op = String(node.op || "");
    if (!ops.includes(op)) {
      errors.push(path + " 字段 " + field.code + " 不支持运算符 " + op);
      return;
    }
    if (op === "exists" || op === "is_null") return;
    const arrayOp = ["in", "not_in", "between"].includes(op);
    if (arrayOp) {
      if (!Array.isArray(node.value) || node.value.length < (op === "between" ? 2 : 1)) {
        errors.push(path + " " + op + " 需要数组值");
      } else if (op === "between" && node.value.length !== 2) {
        errors.push(path + " between 需要两个边界值");
      }
    } else if (node.value === undefined || node.value === null || node.value === "") {
      errors.push(path + " 缺少比较值");
    }
    const dictionary = field.dictionary ? dictionaryMap.get(field.dictionary) : null;
    if (dictionary) {
      const allowed = new Set((dictionary.items || []).filter((item) => item.status === "ACTIVE").map((item) => item.code));
      const values = arrayOp && Array.isArray(node.value) ? node.value : [node.value];
      values.forEach((value) => {
        if (value !== undefined && value !== null && value !== "" && !allowed.has(String(value))) {
          errors.push(path + " 码值 " + value + " 不在字典 " + field.dictionary + " 中");
        }
      });
    }
  }
  walk(tree, "条件");
  return { valid: errors.length === 0, errors, fields: conditionFields(tree) };
}

function groupOut(row, scopes, fieldsByCode, dictionaryMap) {
  const conditions = parseJson(row.conditions_json, null);
  const validation = conditions ? validateConditions(conditions, fieldsByCode, dictionaryMap) : { valid: false, errors: ["尚未配置识别条件"] };
  const packageIds = scopes
    .filter((scope) => (scope.groupCode || "") === row.group_code && scope.status === "ACTIVE")
    .map((scope) => scope.packageId);
  return {
    code: row.group_code,
    name: row.group_name,
    description: row.description || "",
    conditions,
    status: row.status,
    sortOrder: Number(row.sort_order) || 0,
    updatedAt: row.updated_at || "",
    conditionStatus: !conditions ? "TODO" : validation.valid ? "CONFIGURED" : "ERROR",
    conditionErrors: validation.errors,
    conditionFields: validation.fields,
    rulePackageIds: [...new Set(packageIds)],
    rulePackageCount: new Set(packageIds).size
  };
}

function fieldGroupOut(row, fields) {
  return {
    code: row.group_code,
    name: row.group_name,
    parentCode: row.parent_code || "",
    description: row.description || "",
    sortOrder: Number(row.sort_order) || 0,
    status: row.status,
    count: fields.filter((field) => field.group === row.group_code).length
  };
}

function dictionaryOut(row, items) {
  return {
    code: row.dict_code,
    name: row.dict_name,
    description: row.description || "",
    type: row.dict_type || "PUBLIC",
    productCode: row.product_code || "",
    status: row.status,
    items: items.map((item) => ({
      code: item.item_code,
      name: item.item_name,
      description: item.description || "",
      sortOrder: Number(item.sort_order) || 0,
      status: item.status
    }))
  };
}

function packagesOf(ruleRows) {
  const map = new Map();
  ruleRows.forEach((rule) => {
    if (!map.has(rule.packageId)) {
      map.set(rule.packageId, {
        packageId: rule.packageId,
        packageName: rule.packageName,
        side: rule.side,
        sequence: rule.sequence,
        stageLabel: rule.sequence === 10 ? "资格认定" : rule.sequence === 20 ? "等级 / 类别" : "阶段 " + rule.sequence,
        rules: []
      });
    }
    map.get(rule.packageId).rules.push(rule);
  });
  return [...map.values()]
    .map((pack) => ({
      ...pack,
      ruleCount: pack.rules.length,
      inputs: [...new Set(pack.rules.flatMap((rule) => rule.inputs))],
      outputs: [...new Set(pack.rules.flatMap((rule) => rule.outputs))],
      rules: pack.rules.slice().sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))
    }))
    .sort((a, b) => a.sequence - b.sequence || a.packageId.localeCompare(b.packageId));
}

function appliesToProduct(rule, code) {
  const products = rule.products || [];
  return !products.length || products.includes(code);
}

function fieldReferences(fields, groups, scopes, packages, fieldCodeSet, productCode) {
  const map = new Map(fields.map((field) => [field.code, { groups: [], rules: [] }]));
  groups.forEach((group) => {
    conditionFields(group.conditions).forEach((code) => {
      if (!map.has(code)) return;
      if (!map.get(code).groups.includes(group.name)) map.get(code).groups.push(group.name);
    });
  });
  const packageIds = new Set(scopes.filter((scope) => scope.status === "ACTIVE").map((scope) => scope.packageId));
  packages.filter((pack) => packageIds.has(pack.packageId)).forEach((pack) => {
    pack.rules.filter((rule) => appliesToProduct(rule, productCode)).forEach((rule) => {
      rule.inputs.forEach((code) => {
        if (!fieldCodeSet.has(code)) return;
        if (!map.get(code).rules.includes(rule.id)) map.get(code).rules.push(rule.id);
      });
    });
  });
  return map;
}

function item(key, label, weight, status, detail, module, target, applicable = true) {
  return { key, label, weight, status, detail, module, target, applicable };
}

function completenessOf(product, ctx) {
  const items = [];
  const fields = ctx.fields;
  const groups = ctx.groups;
  const groupMode = product.groupMode || "NONE";
  const activeGroups = groups.filter((group) => group.status === "ACTIVE");

  const basicOk = !!(product.code && product.name && product.category && product.side && product.source);
  items.push(item(
    "basic", "产品基本信息", 15,
    basicOk ? "DONE" : product.code && product.name ? "PARTIAL" : "TODO",
    basicOk ? "产品编码、名称、业务大类、侧别和来源系统已填写" : "缺少产品名称、业务大类、侧别或来源系统",
    "overview", "overview"
  ));

  if (groupMode !== "GROUP") {
    items.push(item("groups", "产品组配置", 20, "NA", "未启用产品组，直接使用产品级规则", "groups", "groups", false));
  } else if (!activeGroups.length) {
    items.push(item("groups", "产品组配置", 20, "TODO", "已启用产品组，但还没有产品组", "groups", "groups"));
  } else {
    const invalid = activeGroups.filter((group) => group.conditionStatus !== "CONFIGURED");
    const noRules = activeGroups.filter((group) => !group.rulePackageCount);
    const status = invalid.length ? "ERROR" : noRules.length ? "PARTIAL" : "DONE";
    const detail = invalid.length
      ? invalid.map((group) => group.name).join("、") + " 的识别条件不完整"
      : noRules.length
        ? noRules.map((group) => group.name).join("、") + " 尚未关联规则包"
        : activeGroups.length + " 个产品组已配置识别条件和规则包";
    items.push(item("groups", "产品组配置", 20, status, detail, "groups", "groups"));
  }

  const required = fields.filter((field) => field.required || field.requiredByRule);
  const groupCodes = new Set(ctx.fieldGroups.map((group) => group.code));
  const missingGroup = fields.filter((field) => !field.group || !groupCodes.has(field.group));
  const dictionaryFields = fields.filter((field) => field.valueType === "CODE_DICT" || (field.dictionary && field.dictionary !== ""));
  const missingDictionary = dictionaryFields.filter((field) => !field.dictionary || !ctx.dictionaryMap.has(field.dictionary));
  const fieldStatus = !fields.length ? "TODO" : required.length && !missingGroup.length && !missingDictionary.length ? "DONE" : "PARTIAL";
  const fieldDetail = !fields.length
    ? "尚未配置标准字段"
    : missingGroup.length
      ? missingGroup.length + " 个字段未归入有效分组"
      : missingDictionary.length
        ? missingDictionary.length + " 个枚举字段未关联码值字典"
        : required.length + " 个必需字段已定义";
  items.push(item("fields", "标准字段配置", 20, fieldStatus, fieldDetail, "fields", "fields"));

  const referencedDictionaries = [...new Set(dictionaryFields.map((field) => field.dictionary).filter(Boolean))];
  if (!referencedDictionaries.length) {
    items.push(item("dictionaries", "码值字典", 15, "NA", "没有引用码值字典的枚举字段", "fields", "fields", false));
  } else {
    const invalid = referencedDictionaries.filter((code) => {
      const dict = ctx.dictionaryMap.get(code);
      return !dict || dict.status !== "ACTIVE" || !dict.items.filter((entry) => entry.status === "ACTIVE").length;
    });
    items.push(item(
      "dictionaries", "码值字典", 15,
      invalid.length ? "ERROR" : "DONE",
      invalid.length ? invalid.join("、") + " 不存在、已停用或没有有效码值" : referencedDictionaries.length + " 个字典均有有效码值",
      "fields", "fields"
    ));
  }

  const activeScopes = ctx.scopes.filter((scope) => scope.status === "ACTIVE");
  const groupScopesOk = groupMode !== "GROUP" || !activeGroups.length
    ? true
    : activeGroups.every((group) => group.rulePackageCount > 0);
  const invalidPackages = activeScopes.filter((scope) => !ctx.packageMap.has(scope.packageId));
  const ruleStatus = !activeScopes.length ? "TODO" : invalidPackages.length ? "ERROR" : groupScopesOk ? "DONE" : "PARTIAL";
  const ruleDetail = !activeScopes.length
    ? groupMode === "GROUP" ? "尚未为产品组关联规则包" : "尚未为产品关联规则包"
    : invalidPackages.length
      ? invalidPackages.length + " 个规则包在当前版本不存在"
      : groupScopesOk
        ? activeScopes.length + " 条规则包关联"
        : "部分产品组尚未关联规则包";
  items.push(item("rules", "规则配置", 20, ruleStatus, ruleDetail, "rules", "rules"));

  const scopedPackages = ctx.packages.filter((pack) => activeScopes.some((scope) => scope.packageId === pack.packageId));
  const applicableRules = scopedPackages.flatMap((pack) => pack.rules.filter((rule) => appliesToProduct(rule, product.code)));
  const missingInputs = [...new Set(applicableRules.flatMap((rule) => rule.inputs))]
    .filter((code) => !ctx.fieldCodeSet.has(code));
  const previewStatus = !scopedPackages.length ? "TODO" : missingInputs.length ? "ERROR" : "DONE";
  const previewDetail = !scopedPackages.length
    ? "尚未关联规则包，无法生成规则预览"
    : missingInputs.length
      ? "规则引用的字段不存在：" + missingInputs.slice(0, 5).join("、")
      : scopedPackages.length + " 个规则包可以解析";
  items.push(item("preview", "规则预览", 10, previewStatus, previewDetail, "preview", "preview"));

  const applicable = items.filter((entry) => entry.applicable);
  const totalWeight = applicable.reduce((sum, entry) => sum + entry.weight, 0) || 1;
  const earned = applicable.reduce((sum, entry) => sum + entry.weight * (entry.status === "DONE" ? 1 : entry.status === "PARTIAL" ? 0.5 : 0), 0);
  const score = Math.round((earned / totalWeight) * 100);
  return {
    score,
    status: score >= 100 ? "已完善" : score >= 60 ? "部分完善" : "未完善",
    items
  };
}

function productOut(row, ctx) {
  const product = productRowOut(row);
  const fields = ctx.fields;
  const references = fieldReferences(fields, ctx.groups, ctx.scopes, ctx.packages, ctx.fieldCodeSet, product.code);
  const list = fields.map((field) => ({
    ...field,
    requiredByRule: (references.get(field.code)?.rules || []).length > 0,
    references: references.get(field.code) || { groups: [], rules: [] }
  }));
  const required = list.filter((field) => field.required || field.requiredByRule);
  const packageIds = new Set(ctx.scopes.filter((scope) => scope.status === "ACTIVE").map((scope) => scope.packageId));
  const ruleIds = new Set(
    ctx.packages
      .filter((pack) => packageIds.has(pack.packageId))
      .flatMap((pack) => pack.rules.filter((rule) => appliesToProduct(rule, product.code)).map((rule) => rule.id))
  );
  const fieldGroups = ctx.fieldGroups.map((group) => ({ ...group, count: list.filter((field) => field.group === group.code).length }));
  return {
    ...product,
    fields: list,
    fieldGroups,
    groups: ctx.groups,
    productGroups: ctx.groups,
    ruleCount: ruleIds.size,
    requiredFields: required.map((field) => field.code),
    completeness: completenessOf(product, {
      ...ctx,
      fields: list,
      fieldGroups,
      dictionaryMap: ctx.dictionaryMap,
      packageMap: ctx.packageMap
    })
  };
}

// ---------------------------------------------------------------- 产品读取

async function loadVersionContext(jurisdiction, version, productCode = "") {
  const productFilter = productCode ? " AND product_code = ?" : "";
  const productParams = productCode ? [jurisdiction, version, productCode] : [jurisdiction, version];
  const [productRows, fieldRows, ruleRows, groupRows, fieldGroupRows, dictionaryRows, itemRows, scopeRows, metaRows] = await Promise.all([
    query(
      `SELECT * FROM liquidity_product WHERE jurisdiction = ? AND rule_version = ?${productCode ? " AND code = ?" : ""} ORDER BY side, category, name`,
      productCode ? [jurisdiction, version, productCode] : [jurisdiction, version]
    ),
    query(
      `SELECT * FROM liquidity_product_field WHERE jurisdiction = ? AND rule_version = ?${productFilter} ORDER BY product_code, sort_order, id`,
      productParams
    ),
    query("SELECT * FROM liquidity_rule WHERE jurisdiction = ? AND rule_version = ? ORDER BY sequence_no, priority DESC, rule_id", [jurisdiction, version]),
    query(
      `SELECT * FROM liquidity_product_group WHERE jurisdiction = ? AND rule_version = ?${productFilter} ORDER BY product_code, sort_order, group_code`,
      productParams
    ),
    query(
      `SELECT * FROM liquidity_field_group WHERE jurisdiction = ? AND rule_version = ?${productFilter} ORDER BY product_code, sort_order, group_code`,
      productParams
    ),
    query("SELECT * FROM liquidity_dictionary WHERE jurisdiction = ? AND rule_version = ? ORDER BY dict_code", [jurisdiction, version]),
    query("SELECT * FROM liquidity_dictionary_item WHERE jurisdiction = ? AND rule_version = ? ORDER BY dict_code, sort_order, id", [jurisdiction, version]),
    query(
      `SELECT * FROM liquidity_rule_scope WHERE jurisdiction = ? AND rule_version = ?${productFilter} ORDER BY product_code, group_code, package_id`,
      productParams
    ),
    query("SELECT * FROM liquidity_config_meta WHERE jurisdiction = ? AND rule_version = ?", [jurisdiction, version])
  ]);

  const itemsByDict = new Map();
  itemRows.forEach((row) => {
    if (!itemsByDict.has(row.dict_code)) itemsByDict.set(row.dict_code, []);
    itemsByDict.get(row.dict_code).push(row);
  });
  const dictionaries = dictionaryRows.map((row) => dictionaryOut(row, itemsByDict.get(row.dict_code) || []));
  const dictionaryMap = new Map(dictionaries.map((entry) => [entry.code, entry]));

  const fieldsByProduct = new Map();
  fieldRows.forEach((row) => {
    if (!fieldsByProduct.has(row.product_code)) fieldsByProduct.set(row.product_code, []);
    fieldsByProduct.get(row.product_code).push(fieldOut(row));
  });

  const scopesByProduct = new Map();
  scopeRows.forEach((row) => {
    if (!scopesByProduct.has(row.product_code)) scopesByProduct.set(row.product_code, []);
    scopesByProduct.get(row.product_code).push({
      id: row.id,
      groupCode: row.group_code || "",
      packageId: row.package_id,
      status: row.status,
      updatedAt: row.updated_at || ""
    });
  });

  const rules = ruleRows.map(ruleOut);
  const packages = packagesOf(rules);
  const packageMap = new Map(packages.map((pack) => [pack.packageId, pack]));

  const groupsByProduct = new Map();
  groupRows.forEach((row) => {
    const fields = fieldsByProduct.get(row.product_code) || [];
    const fieldsByCode = new Map(fields.map((field) => [field.code, field]));
    if (!groupsByProduct.has(row.product_code)) groupsByProduct.set(row.product_code, []);
    groupsByProduct.get(row.product_code).push(
      groupOut(row, scopesByProduct.get(row.product_code) || [], fieldsByCode, dictionaryMap)
    );
  });
  groupsByProduct.forEach((list) => list.sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code)));

  const fieldGroupsByProduct = new Map();
  fieldGroupRows.forEach((row) => {
    if (!fieldGroupsByProduct.has(row.product_code)) fieldGroupsByProduct.set(row.product_code, []);
    fieldGroupsByProduct.get(row.product_code).push(fieldGroupOut(row, fieldsByProduct.get(row.product_code) || []));
  });
  fieldGroupsByProduct.forEach((list) => list.sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code)));

  const meta = metaRows.length ? {
    lcrVersion: metaRows[0].lcr_version,
    lcrVersionName: metaRows[0].lcr_version_name,
    snapshot: parseJson(metaRows[0].snapshot_json, {}),
    source: metaRows[0].source
  } : null;

  return {
    jurisdiction, version, meta,
    productRows, fieldsByProduct, groupsByProduct, fieldGroupsByProduct, scopesByProduct,
    dictionaries, dictionaryMap, rules, packages, packageMap
  };
}

function productContext(ctx, row) {
  const fields = ctx.fieldsByProduct.get(row.code) || [];
  return {
    fields,
    groups: ctx.groupsByProduct.get(row.code) || [],
    fieldGroups: ctx.fieldGroupsByProduct.get(row.code) || [],
    scopes: ctx.scopesByProduct.get(row.code) || [],
    dictionaries: ctx.dictionaries,
    dictionaryMap: ctx.dictionaryMap,
    rules: ctx.rules,
    packages: ctx.packages,
    packageMap: ctx.packageMap,
    fieldCodeSet: new Set(fields.map((field) => field.code))
  };
}

export async function listLiquidityProducts(params = {}) {
  const { jurisdiction, version } = await versionContext(params);
  const ctx = await loadVersionContext(jurisdiction, version);
  return {
    jurisdiction,
    version,
    meta: ctx.meta,
    products: ctx.productRows.map((row) => productOut(row, productContext(ctx, row)))
  };
}

export async function getLiquidityProduct(code, params = {}) {
  const { jurisdiction, version } = await versionContext(params);
  const ctx = await loadVersionContext(jurisdiction, version, code);
  const row = ctx.productRows.find((item) => item.code === code);
  if (!row) throw fail(404, "没有找到这个流动性产品");
  const context = productContext(ctx, row);
  return {
    jurisdiction,
    version,
    product: productOut(row, context),
    rulePackages: ctx.packages.map((pack) => ({
      ...pack,
      rules: pack.rules.map((rule) => ({ ...rule, applicable: appliesToProduct(rule, code) }))
    })),
    ruleScopes: context.scopes,
    dictionaries: ctx.dictionaries.filter((entry) => entry.type === "PUBLIC" || entry.productCode === code)
  };
}

export async function listLiquidityDictionaries(params = {}) {
  const { jurisdiction, version } = await versionContext(params);
  const productCode = String(params.product_code || params.productCode || "");
  const ctx = await loadVersionContext(jurisdiction, version);
  return {
    jurisdiction,
    version,
    dictionaries: ctx.dictionaries.filter((entry) => entry.type === "PUBLIC" || !productCode || entry.productCode === productCode)
  };
}

export async function liquidityMeta(params = {}) {
  const { jurisdiction, version } = await versionContext(params);
  const ctx = await loadVersionContext(jurisdiction, version);
  const versions = await liquidityVersions(jurisdiction);
  return {
    jurisdiction,
    version,
    meta: ctx.meta,
    versions,
    packages: ctx.packages.map((pack) => ({
      packageId: pack.packageId,
      name: pack.packageName,
      side: pack.side,
      sequence: pack.sequence,
      stage: pack.stageLabel
    })),
    products: ctx.productRows
      .filter((row) => row.status !== "DISABLED")
      .map((row) => {
        const product = productOut(row, productContext(ctx, row));
        return {
          code: product.code,
          name: product.name,
          side: product.side,
          category: product.category,
          description: product.description || "",
          status: product.status,
          groupMode: product.groupMode || "NONE",
          paramKey: product.paramKey || "",
          fields: product.fields,
          requiredFields: product.requiredFields
        };
      })
  };
}

export async function liquidityRules(params = {}) {
  const { jurisdiction, version } = await versionContext(params);
  const rows = await query(
    "SELECT * FROM liquidity_rule WHERE jurisdiction = ? AND rule_version = ? ORDER BY sequence_no, priority DESC, rule_id",
    [jurisdiction, version]
  );
  return { jurisdiction, version, rules: rows.map(ruleOut) };
}

export async function liquidityParams(params = {}) {
  const { jurisdiction, version } = await versionContext(params);
  const [paramRows, tables, lists, metaRows] = await Promise.all([
    query("SELECT * FROM liquidity_param WHERE jurisdiction = ? AND rule_version = ? ORDER BY param_id", [jurisdiction, version]),
    query("SELECT * FROM liquidity_param_table WHERE jurisdiction = ? AND rule_version = ? ORDER BY table_id", [jurisdiction, version]),
    query("SELECT * FROM liquidity_list WHERE jurisdiction = ? AND rule_version = ? ORDER BY list_id", [jurisdiction, version]),
    query("SELECT * FROM liquidity_config_meta WHERE jurisdiction = ? AND rule_version = ?", [jurisdiction, version])
  ]);
  return {
    jurisdiction,
    version,
    meta: metaRows.length ? {
      lcrVersion: metaRows[0].lcr_version,
      lcrVersionName: metaRows[0].lcr_version_name,
      snapshot: parseJson(metaRows[0].snapshot_json, {})
    } : null,
    params: paramRows.map((row) => ({
      id: row.param_id, name: row.name, value: Number(row.value), unit: row.unit, basis: row.basis
    })),
    tables: tables.map((row) => ({
      id: row.table_id, title: row.title, kind: row.kind,
      rows: parseJson(row.rows_json, []), note: row.note
    })),
    lists: lists.map((row) => ({
      id: row.list_id, title: row.title, type: row.list_type, version: row.list_version,
      items: parseJson(row.items_json, []), note: row.note
    }))
  };
}

// ---------------------------------------------------------------- 维护写入

export async function saveLiquidityProduct(body = {}) {
  const { jurisdiction, version } = await versionContext(body);
  const code = text(body.code, 64).trim();
  if (!code) throw fail(400, "产品编码不能为空");
  if (!String(body.name || "").trim()) throw fail(400, "产品名称不能为空");
  const side = ["ASSET", "INFLOW", "OUTFLOW"].includes(body.side) ? body.side : "ASSET";
  const existing = await query(
    "SELECT group_mode FROM liquidity_product WHERE jurisdiction = ? AND rule_version = ? AND code = ?",
    [jurisdiction, version, code]
  );
  const groupMode = ["NONE", "GROUP"].includes(body.groupMode)
    ? body.groupMode
    : existing.length ? existing[0].group_mode || "NONE" : "NONE";
  if (groupMode === "NONE") {
    const groupScopes = await query(
      "SELECT COUNT(*) AS n FROM liquidity_rule_scope WHERE jurisdiction = ? AND rule_version = ? AND product_code = ? AND group_code <> ''",
      [jurisdiction, version, code]
    );
    if (Number(groupScopes[0] && groupScopes[0].n) > 0) {
      throw fail(409, "该产品还有产品组级规则关联，请先在规则配置中解除，再切换为不启用产品组");
    }
  }
  if (groupMode === "GROUP") {
    const productScopes = await query(
      "SELECT COUNT(*) AS n FROM liquidity_rule_scope WHERE jurisdiction = ? AND rule_version = ? AND product_code = ? AND group_code = ''",
      [jurisdiction, version, code]
    );
    if (Number(productScopes[0] && productScopes[0].n) > 0) {
      throw fail(409, "该产品还有产品级规则关联，请先在规则配置中解除，再启用产品组");
    }
  }
  const now = nowText();
  await query(
    `INSERT INTO liquidity_product
       (id, jurisdiction, rule_version, code, name, category, product_group, side, source_system,
        status, description, domains_json, param_key, rule_count, group_mode, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       name = VALUES(name), category = VALUES(category), product_group = VALUES(product_group),
       side = VALUES(side), source_system = VALUES(source_system), status = VALUES(status),
       description = VALUES(description), domains_json = VALUES(domains_json),
       param_key = VALUES(param_key), group_mode = VALUES(group_mode), updated_at = VALUES(updated_at)`,
    [
      uid(jurisdiction, version, code), jurisdiction, version, code, text(body.name, 128),
      text(body.category, 64), text(body.productGroup, 64), side, text(body.source, 64),
      text(body.status || "LIVE", 16), text(body.description, 500),
      JSON.stringify(Array.isArray(body.domains) ? body.domains : ["CAPITAL", "LIQUIDITY", "NSFR"]),
      text(body.paramKey, 64), num(body.ruleCount), groupMode, now
    ]
  );
  return getLiquidityProduct(code, { jurisdiction, version });
}

export async function saveLiquidityGroup(code, body = {}) {
  const { jurisdiction, version } = await versionContext(body);
  const products = await query(
    "SELECT group_mode FROM liquidity_product WHERE jurisdiction = ? AND rule_version = ? AND code = ?",
    [jurisdiction, version, code]
  );
  if (!products.length) throw fail(404, "没有找到这个流动性产品");
  if (products[0].group_mode !== "GROUP") throw fail(400, "请先启用产品组模式，再新增产品组");
  const groupCode = text(body.groupCode || body.code, 64).trim();
  if (!groupCode) throw fail(400, "产品组编码不能为空");
  if (!String(body.name || body.groupName || "").trim()) throw fail(400, "产品组名称不能为空");
  const groupName = text(body.name || body.groupName, 128);
  const conditions = body.conditions == null ? null : body.conditions;
  if (conditions != null && typeof conditions === "object") {
    const ctx = await loadVersionContext(jurisdiction, version, code);
    const fields = ctx.fieldsByProduct.get(code) || [];
    const validation = validateConditions(conditions, new Map(fields.map((field) => [field.code, field])), ctx.dictionaryMap);
    if (!validation.valid) throw fail(400, validation.errors.join("；"));
  }
  await query(
    `INSERT INTO liquidity_product_group
       (id, jurisdiction, rule_version, product_code, group_code, group_name, description,
        conditions_json, status, sort_order, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       group_name = VALUES(group_name), description = VALUES(description),
       conditions_json = VALUES(conditions_json), status = VALUES(status),
       sort_order = VALUES(sort_order), updated_at = VALUES(updated_at)`,
    [
      uid(jurisdiction, version, "pg", code, groupCode), jurisdiction, version, code, groupCode,
      groupName, text(body.description, 500),
      conditions == null ? null : JSON.stringify(conditions),
      body.status === "DISABLED" ? "DISABLED" : "ACTIVE", num(body.sortOrder), nowText()
    ]
  );
  return getLiquidityProduct(code, { jurisdiction, version });
}

export async function deleteLiquidityGroup(code, groupCode, params = {}) {
  const { jurisdiction, version } = await versionContext({ ...params, product_code: code });
  const scopes = await query(
    "SELECT COUNT(*) AS n FROM liquidity_rule_scope WHERE jurisdiction = ? AND rule_version = ? AND product_code = ? AND group_code = ?",
    [jurisdiction, version, code, groupCode]
  );
  if (Number(scopes[0] && scopes[0].n) > 0) {
    throw fail(409, "该产品组已关联规则包，请先在规则配置中解除关联");
  }
  await query(
    "DELETE FROM liquidity_product_group WHERE jurisdiction = ? AND rule_version = ? AND product_code = ? AND group_code = ?",
    [jurisdiction, version, code, groupCode]
  );
  return getLiquidityProduct(code, { jurisdiction, version });
}

export async function validateProductGroups(code, params = {}) {
  const { jurisdiction, version } = await versionContext({ ...params, product_code: code });
  const ctx = await loadVersionContext(jurisdiction, version, code);
  const product = productContext(ctx, { code });
  const groups = product.groups || [];
  const seen = new Map();
  const warnings = [];
  const results = groups.map((group) => {
    const key = group.conditions ? JSON.stringify(group.conditions) : "";
    if (key) {
      if (seen.has(key)) warnings.push("产品组「" + seen.get(key) + "」和「" + group.name + "」的识别条件完全相同");
      else seen.set(key, group.name);
    }
    if (group.status === "ACTIVE" && !group.rulePackageCount) {
      warnings.push("产品组「" + group.name + "」尚未关联规则包");
    }
    return {
      code: group.code,
      name: group.name,
      status: group.status,
      valid: group.conditionStatus === "CONFIGURED",
      conditionStatus: group.conditionStatus,
      errors: group.conditionErrors || [],
      rulePackageCount: group.rulePackageCount
    };
  });
  return {
    valid: results.every((entry) => entry.status !== "ACTIVE" || entry.valid) && !warnings.length,
    groups: results,
    warnings,
    note: "配置阶段只能检查字段、运算符、码值和重复条件；数据级重叠、覆盖和未匹配需要在导入业务数据后校验。"
  };
}

export async function saveLiquidityFieldGroup(code, body = {}) {
  const { jurisdiction, version } = await versionContext(body);
  const products = await query(
    "SELECT 1 FROM liquidity_product WHERE jurisdiction = ? AND rule_version = ? AND code = ? LIMIT 1",
    [jurisdiction, version, code]
  );
  if (!products.length) throw fail(404, "没有找到这个流动性产品");
  const groupCode = text(body.groupCode || body.code, 64).trim();
  if (!groupCode) throw fail(400, "字段分组编码不能为空");
  if (!String(body.name || body.groupName || "").trim()) throw fail(400, "字段分组名称不能为空");
  const parentCode = text(body.parentCode, 64);
  if (parentCode && parentCode === groupCode) throw fail(400, "上级分组不能是自身");
  await query(
    `INSERT INTO liquidity_field_group
       (id, jurisdiction, rule_version, product_code, group_code, group_name, parent_code,
        description, sort_order, status, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       group_name = VALUES(group_name), parent_code = VALUES(parent_code),
       description = VALUES(description), sort_order = VALUES(sort_order),
       status = VALUES(status), updated_at = VALUES(updated_at)`,
    [
      uid(jurisdiction, version, "fg", code, groupCode), jurisdiction, version, code, groupCode,
      text(body.name || body.groupName, 128), parentCode, text(body.description, 500),
      num(body.sortOrder), body.status === "DISABLED" ? "DISABLED" : "ACTIVE", nowText()
    ]
  );
  return getLiquidityProduct(code, { jurisdiction, version });
}

export async function deleteLiquidityFieldGroup(code, groupCode, params = {}) {
  const { jurisdiction, version } = await versionContext({ ...params, product_code: code });
  const used = await query(
    "SELECT COUNT(*) AS n FROM liquidity_product_field WHERE jurisdiction = ? AND rule_version = ? AND product_code = ? AND field_group = ?",
    [jurisdiction, version, code, groupCode]
  );
  if (Number(used[0] && used[0].n) > 0) throw fail(409, "该分组下还有标准字段，请先移动或删除字段");
  await query(
    "DELETE FROM liquidity_field_group WHERE jurisdiction = ? AND rule_version = ? AND product_code = ? AND group_code = ?",
    [jurisdiction, version, code, groupCode]
  );
  return getLiquidityProduct(code, { jurisdiction, version });
}

export async function saveLiquidityDictionary(body = {}) {
  const { jurisdiction, version } = await versionContext(body);
  const dictCode = text(body.dictCode || body.code, 64).trim();
  if (!dictCode) throw fail(400, "字典编码不能为空");
  if (!String(body.name || body.dictName || "").trim()) throw fail(400, "字典名称不能为空");
  const dictType = body.dictType === "PRODUCT" ? "PRODUCT" : "PUBLIC";
  await query(
    `INSERT INTO liquidity_dictionary
       (id, jurisdiction, rule_version, dict_code, dict_name, description, dict_type, product_code, status, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       dict_name = VALUES(dict_name), description = VALUES(description),
       dict_type = VALUES(dict_type), product_code = VALUES(product_code),
       status = VALUES(status), updated_at = VALUES(updated_at)`,
    [
      uid(jurisdiction, version, "dict", dictCode), jurisdiction, version, dictCode,
      text(body.name || body.dictName, 128), text(body.description, 500), dictType,
      dictType === "PRODUCT" ? text(body.productCode, 64) : "",
      body.status === "DISABLED" ? "DISABLED" : "ACTIVE", nowText()
    ]
  );
  return listLiquidityDictionaries({ jurisdiction, version, product_code: body.productCode || "" });
}

export async function deleteLiquidityDictionary(dictCode, params = {}) {
  const { jurisdiction, version } = await versionContext(params);
  const used = await query(
    "SELECT COUNT(*) AS n FROM liquidity_product_field WHERE jurisdiction = ? AND rule_version = ? AND dictionary = ?",
    [jurisdiction, version, dictCode]
  );
  if (Number(used[0] && used[0].n) > 0) throw fail(409, "该字典已被标准字段引用，不能删除");
  await query("DELETE FROM liquidity_dictionary_item WHERE jurisdiction = ? AND rule_version = ? AND dict_code = ?", [jurisdiction, version, dictCode]);
  await query("DELETE FROM liquidity_dictionary WHERE jurisdiction = ? AND rule_version = ? AND dict_code = ?", [jurisdiction, version, dictCode]);
  return { ok: true };
}

export async function saveLiquidityDictionaryItem(dictCode, body = {}) {
  const { jurisdiction, version } = await versionContext(body);
  const itemCode = text(body.itemCode || body.code, 64).trim();
  if (!itemCode) throw fail(400, "码值编码不能为空");
  if (!String(body.name || body.itemName || "").trim()) throw fail(400, "码值名称不能为空");
  await query(
    `INSERT INTO liquidity_dictionary_item
       (jurisdiction, rule_version, dict_code, item_code, item_name, description, sort_order, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       item_name = VALUES(item_name), description = VALUES(description),
       sort_order = VALUES(sort_order), status = VALUES(status)`,
    [
      jurisdiction, version, dictCode, itemCode, text(body.name || body.itemName, 128),
      text(body.description, 255), num(body.sortOrder), body.status === "DISABLED" ? "DISABLED" : "ACTIVE"
    ]
  );
  return listLiquidityDictionaries({ jurisdiction, version, product_code: body.productCode || "" });
}

export async function deleteLiquidityDictionaryItem(dictCode, itemCode, params = {}) {
  const { jurisdiction, version } = await versionContext(params);
  const groups = await query(
    "SELECT group_name, conditions_json FROM liquidity_product_group WHERE jurisdiction = ? AND rule_version = ?",
    [jurisdiction, version]
  );
  for (const group of groups) {
    const conditions = parseJson(group.conditions_json, null);
    const values = [];
    (function walk(node) {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node.conditions)) { node.conditions.forEach(walk); return; }
      if (node.value !== undefined) values.push(node.value);
    })(conditions);
    if (values.some((value) => value === itemCode || (Array.isArray(value) && value.includes(itemCode)))) {
      throw fail(409, "码值已被产品组「" + group.group_name + "」的识别条件引用，不能删除");
    }
  }
  await query(
    "DELETE FROM liquidity_dictionary_item WHERE jurisdiction = ? AND rule_version = ? AND dict_code = ? AND item_code = ?",
    [jurisdiction, version, dictCode, itemCode]
  );
  return listLiquidityDictionaries({ jurisdiction, version, product_code: params.product_code || params.productCode || "" });
}

export async function saveLiquidityRuleScope(code, body = {}) {
  const { jurisdiction, version } = await versionContext(body);
  const groupCode = text(body.groupCode, 64);
  const packageId = text(body.packageId, 64).trim();
  if (!packageId) throw fail(400, "请选择规则包");
  const products = await query(
    "SELECT group_mode FROM liquidity_product WHERE jurisdiction = ? AND rule_version = ? AND code = ?",
    [jurisdiction, version, code]
  );
  if (!products.length) throw fail(404, "没有找到这个流动性产品");
  if (groupCode) {
    if (products[0].group_mode !== "GROUP") throw fail(400, "该产品未启用产品组，不能按产品组关联规则");
    const group = await query(
      "SELECT 1 FROM liquidity_product_group WHERE jurisdiction = ? AND rule_version = ? AND product_code = ? AND group_code = ? LIMIT 1",
      [jurisdiction, version, code, groupCode]
    );
    if (!group.length) throw fail(404, "没有找到这个产品组");
  } else if (products[0].group_mode === "GROUP") {
    throw fail(400, "该产品已启用产品组，请在具体产品组下关联规则包");
  }
  const packageRows = await query(
    "SELECT 1 FROM liquidity_rule WHERE jurisdiction = ? AND rule_version = ? AND package_id = ? LIMIT 1",
    [jurisdiction, version, packageId]
  );
  if (!packageRows.length) throw fail(404, "当前版本没有这个规则包");
  await query(
    `INSERT INTO liquidity_rule_scope
       (id, jurisdiction, rule_version, product_code, group_code, package_id, status, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE status = VALUES(status), updated_at = VALUES(updated_at)`,
    [
      uid(jurisdiction, version, "scope", code, groupCode || "PRODUCT", packageId), jurisdiction, version,
      code, groupCode, packageId, body.status === "DISABLED" ? "DISABLED" : "ACTIVE", nowText()
    ]
  );
  return getLiquidityProduct(code, { jurisdiction, version });
}

export async function deleteLiquidityRuleScope(id, params = {}) {
  const { jurisdiction, version } = await versionContext(params);
  await query(
    "DELETE FROM liquidity_rule_scope WHERE id = ? AND jurisdiction = ? AND rule_version = ?",
    [id, jurisdiction, version]
  );
  return { ok: true };
}

export async function copyLiquidityProduct(code, body = {}) {
  const { jurisdiction, version } = await versionContext(body);
  const rows = await query(
    "SELECT * FROM liquidity_product WHERE jurisdiction = ? AND rule_version = ? AND code = ?",
    [jurisdiction, version, code]
  );
  if (!rows.length) throw fail(404, "没有找到要复制的流动性产品");
  const source = rows[0];

  const base = String(code).slice(0, 54) || "PRODUCT";
  let newCode = base + "_COPY";
  let suffix = 1;
  while (true) {
    const exists = await query(
      "SELECT 1 FROM liquidity_product WHERE jurisdiction = ? AND rule_version = ? AND code = ? LIMIT 1",
      [jurisdiction, version, newCode]
    );
    if (!exists.length) break;
    suffix += 1;
    newCode = base + "_COPY" + suffix;
  }

  const name = String(body.name || "").trim() || source.name + "（副本）";
  const side = ["ASSET", "INFLOW", "OUTFLOW"].includes(body.side) ? body.side : source.side;
  await query(
    `INSERT INTO liquidity_product
       (id, jurisdiction, rule_version, code, name, category, product_group, side, source_system,
        status, description, domains_json, param_key, rule_count, group_mode, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      uid(jurisdiction, version, newCode), jurisdiction, version, newCode, text(name, 128),
      body.category != null ? text(body.category, 64) : source.category,
      body.productGroup != null ? text(body.productGroup, 64) : source.product_group,
      side,
      body.source != null ? text(body.source, 64) : source.source_system,
      "DISABLED",
      body.description != null ? text(body.description, 500) : source.description,
      JSON.stringify(Array.isArray(body.domains) ? body.domains : parseJson(source.domains_json, ["CAPITAL", "LIQUIDITY", "NSFR"])),
      body.paramKey != null ? text(body.paramKey, 64) : source.param_key,
      Number(source.rule_count) || 0,
      source.group_mode || "NONE",
      nowText()
    ]
  );

  await query(
    `INSERT INTO liquidity_product_field
       (jurisdiction, rule_version, product_code, field_code, field_name, category, field_group,
        group_order, data_type, role, required, value_type, dictionary, source_column,
        aliases_json, description, status, sort_order, attributes_json)
     SELECT jurisdiction, rule_version, ?, field_code, field_name, category, field_group,
            group_order, data_type, role, required, value_type, dictionary, source_column,
            aliases_json, description, status, sort_order, attributes_json
       FROM liquidity_product_field
      WHERE jurisdiction = ? AND rule_version = ? AND product_code = ?`,
    [newCode, jurisdiction, version, code]
  );

  const fieldGroups = await query(
    "SELECT * FROM liquidity_field_group WHERE jurisdiction = ? AND rule_version = ? AND product_code = ?",
    [jurisdiction, version, code]
  );
  for (const group of fieldGroups) {
    await query(
      `INSERT INTO liquidity_field_group
         (id, jurisdiction, rule_version, product_code, group_code, group_name, parent_code,
          description, sort_order, status, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        uid(jurisdiction, version, "fg", newCode, group.group_code), jurisdiction, version, newCode,
        group.group_code, group.group_name, group.parent_code || "", group.description || "",
        Number(group.sort_order) || 0, group.status || "ACTIVE", nowText()
      ]
    );
  }

  const groups = await query(
    "SELECT * FROM liquidity_product_group WHERE jurisdiction = ? AND rule_version = ? AND product_code = ?",
    [jurisdiction, version, code]
  );
  for (const group of groups) {
    await query(
      `INSERT INTO liquidity_product_group
         (id, jurisdiction, rule_version, product_code, group_code, group_name, description,
          conditions_json, status, sort_order, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        uid(jurisdiction, version, "pg", newCode, group.group_code), jurisdiction, version, newCode,
        group.group_code, group.group_name, group.description || "", group.conditions_json || null,
        group.status || "ACTIVE", Number(group.sort_order) || 0, nowText()
      ]
    );
  }

  const scopes = await query(
    "SELECT * FROM liquidity_rule_scope WHERE jurisdiction = ? AND rule_version = ? AND product_code = ?",
    [jurisdiction, version, code]
  );
  for (const scope of scopes) {
    await query(
      `INSERT INTO liquidity_rule_scope
         (id, jurisdiction, rule_version, product_code, group_code, package_id, status, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        uid(jurisdiction, version, "scope", newCode, scope.group_code || "PRODUCT", scope.package_id),
        jurisdiction, version, newCode, scope.group_code || "", scope.package_id,
        scope.status || "ACTIVE", nowText()
      ]
    );
  }

  const rules = await query(
    "SELECT rule_id, products_json FROM liquidity_rule WHERE jurisdiction = ? AND rule_version = ?",
    [jurisdiction, version]
  );
  for (const rule of rules) {
    const products = parseJson(rule.products_json, []);
    if (!Array.isArray(products) || !products.includes(code) || products.includes(newCode)) continue;
    await query(
      "UPDATE liquidity_rule SET products_json = ? WHERE jurisdiction = ? AND rule_version = ? AND rule_id = ?",
      [JSON.stringify([...products, newCode]), jurisdiction, version, rule.rule_id]
    );
  }

  return getLiquidityProduct(newCode, { jurisdiction, version });
}

export async function deleteLiquidityProduct(code, params = {}) {
  const { jurisdiction, version } = await versionContext(params);
  const used = await query("SELECT COUNT(*) AS n FROM hqla_task_dataset WHERE product_code = ?", [code]);
  if (Number(used[0] && used[0].n) > 0) {
    throw fail(409, "该产品已被历史计量任务引用，不能删除；请改为停用");
  }
  const rules = await query(
    "SELECT rule_id, products_json FROM liquidity_rule WHERE jurisdiction = ? AND rule_version = ?",
    [jurisdiction, version]
  );
  for (const rule of rules) {
    const products = parseJson(rule.products_json, []);
    if (!Array.isArray(products) || !products.includes(code)) continue;
    await query(
      "UPDATE liquidity_rule SET products_json = ? WHERE jurisdiction = ? AND rule_version = ? AND rule_id = ?",
      [JSON.stringify(products.filter((item) => item !== code)), jurisdiction, version, rule.rule_id]
    );
  }
  await query("DELETE FROM liquidity_product_field WHERE jurisdiction = ? AND rule_version = ? AND product_code = ?", [jurisdiction, version, code]);
  await query("DELETE FROM liquidity_product_group WHERE jurisdiction = ? AND rule_version = ? AND product_code = ?", [jurisdiction, version, code]);
  await query("DELETE FROM liquidity_field_group WHERE jurisdiction = ? AND rule_version = ? AND product_code = ?", [jurisdiction, version, code]);
  await query("DELETE FROM liquidity_rule_scope WHERE jurisdiction = ? AND rule_version = ? AND product_code = ?", [jurisdiction, version, code]);
  await query("DELETE FROM liquidity_product WHERE jurisdiction = ? AND rule_version = ? AND code = ?", [jurisdiction, version, code]);
  return { ok: true };
}

export async function saveLiquidityField(code, body = {}) {
  const { jurisdiction, version } = await versionContext(body);
  const fieldCode = text(body.code || body.fieldCode, 64).trim();
  if (!fieldCode) throw fail(400, "字段编码不能为空");
  if (!String(body.name || "").trim()) throw fail(400, "字段名称不能为空");
  const rows = await query(
    "SELECT COALESCE(MAX(sort_order), 0) AS maxOrder FROM liquidity_product_field WHERE jurisdiction = ? AND rule_version = ? AND product_code = ?",
    [jurisdiction, version, code]
  );
  const order = num(rows[0] && rows[0].maxOrder) + 1;
  const attributes = {
    ...(body.attributes && typeof body.attributes === "object" ? body.attributes : {}),
    businessType: body.businessType || "",
    unit: body.unit || "",
    precision: body.precision == null || body.precision === "" ? null : Number(body.precision),
    nullable: body.nullable == null ? null : !!body.nullable,
    defaultValue: body.defaultValue == null ? null : body.defaultValue,
    sourceType: body.sourceType || "",
    enum: Array.isArray(body.enum) ? body.enum : [],
    hint: body.hint || "",
    example: body.example || "",
    requiredNote: body.requiredNote || ""
  };
  await query(
    `INSERT INTO liquidity_product_field
       (jurisdiction, rule_version, product_code, field_code, field_name, category, field_group,
        group_order, data_type, role, required, value_type, dictionary, source_column,
        aliases_json, description, status, sort_order, attributes_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       field_name = VALUES(field_name), category = VALUES(category), field_group = VALUES(field_group),
       group_order = VALUES(group_order), data_type = VALUES(data_type), role = VALUES(role),
       required = VALUES(required), value_type = VALUES(value_type), dictionary = VALUES(dictionary),
       source_column = VALUES(source_column), aliases_json = VALUES(aliases_json),
       description = VALUES(description), status = VALUES(status),
       attributes_json = VALUES(attributes_json)`,
    [
      jurisdiction, version, code, fieldCode, text(body.name, 128), text(body.category, 64),
      text(body.group, 64), num(body.groupOrder), text(body.dataType || "STRING", 24),
      text(body.role || "NONE", 24), body.required ? 1 : 0, text(body.valueType || "FREE_TEXT", 24),
      text(body.dictionary, 64), text(body.source, 128),
      JSON.stringify(Array.isArray(body.aliases) ? body.aliases : []),
      text(body.description, 500), text(body.status || "ACTIVE", 16), order, JSON.stringify(attributes)
    ]
  );
  return getLiquidityProduct(code, { jurisdiction, version });
}

export async function deleteLiquidityField(code, fieldCode, params = {}) {
  const { jurisdiction, version } = await versionContext(params);
  const groups = await query(
    "SELECT group_name, conditions_json FROM liquidity_product_group WHERE jurisdiction = ? AND rule_version = ? AND product_code = ?",
    [jurisdiction, version, code]
  );
  for (const group of groups) {
    if (conditionFields(parseJson(group.conditions_json, null)).includes(fieldCode)) {
      throw fail(409, "字段已被产品组「" + group.group_name + "」的识别条件引用，不能删除");
    }
  }
  const rules = await query(
    "SELECT rule_id, condition_text FROM liquidity_rule WHERE jurisdiction = ? AND rule_version = ?",
    [jurisdiction, version]
  );
  const pattern = new RegExp("(^|[^A-Za-z0-9_])" + fieldCode.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "([^A-Za-z0-9_]|$)");
  const hit = rules.find((rule) => pattern.test(String(rule.condition_text || "")));
  if (hit) throw fail(409, "字段已被规则「" + hit.rule_id + "」引用，不能删除");
  await query(
    "DELETE FROM liquidity_product_field WHERE jurisdiction = ? AND rule_version = ? AND product_code = ? AND field_code = ?",
    [jurisdiction, version, code, fieldCode]
  );
  return getLiquidityProduct(code, { jurisdiction, version });
}

// ---------------------------------------------------------------- 数据集：识别 / 映射 / 质量

function norm(value) {
  return String(value == null ? "" : value)
    .toLowerCase()
    .replace(/[\s_\-/\\()（）:：,，.。]+/g, "")
    .replace(/金额|余额|数值|合计|\(.*?\)|（.*?）/g, "");
}

function fieldNames(field) {
  return [field.code, field.name, field.source, ...(field.aliases || [])].filter(Boolean);
}

function matchScore(header, field) {
  const target = norm(header);
  if (!target) return 0;
  for (const name of fieldNames(field)) {
    const candidate = norm(name);
    if (!candidate) continue;
    if (candidate === target) return 100;
  }
  for (const name of fieldNames(field)) {
    const candidate = norm(name);
    if (candidate.length >= 2 && target.includes(candidate)) return 82;
    if (target.length >= 2 && candidate.includes(target)) return 70;
  }
  return 0;
}

export function autoMapDataset(dataset, product) {
  const headers = (dataset.headers || []).filter((header) => String(header || "").trim());
  const fields = (product.fields || []).filter((field) => field.status !== "DISABLED");
  const used = new Set();
  const mappings = headers.map((header) => {
    let best = null;
    let bestScore = 0;
    fields.forEach((field) => {
      if (used.has(field.code)) return;
      const score = matchScore(header, field);
      if (score > bestScore) { best = field; bestScore = score; }
    });
    if (best && bestScore >= 60) used.add(best.code);
    return {
      excel: header,
      standard: best ? best.code : "",
      standardName: best ? best.name : "",
      method: bestScore >= 100 ? "自动匹配" : bestScore >= 60 ? "模糊匹配" : "未匹配",
      confidence: bestScore,
      required: best ? !!(best.required || best.requiredByRule) : false,
      status: bestScore >= 90 ? "已确认" : bestScore >= 60 ? "待确认" : "不适用"
    };
  });
  const mapped = new Set(mappings.filter((item) => item.standard).map((item) => item.standard));
  const missing = (product.requiredFields || []).filter((code) => !mapped.has(code));
  return {
    mappings,
    stats: {
      headers: headers.length,
      mapped: mapped.size,
      confirmed: mappings.filter((item) => item.status === "已确认").length,
      pending: mappings.filter((item) => item.status === "待确认").length,
      missingRequired: missing.length,
      notApplicable: mappings.filter((item) => item.status === "不适用").length
    },
    missingRequired: missing
  };
}

function cleanName(value) {
  return String(value == null ? "" : value)
    .toLowerCase()
    .replace(/[（(].*?[）)]/g, "")
    .replace(/(明细|数据|清单|台账|表)$/g, "")
    .replace(/[\s_\-/\\()（）:：,，.。]+/g, "");
}

export function identifyDatasets(datasets, products) {
  const list = Array.isArray(products) ? products : [];
  return (datasets || []).map((dataset) => {
    if (dataset.productCode && dataset.confirmedAt) return dataset;
    const headers = (dataset.headers || []).map((header) => String(header || ""));
    const sheetRaw = String(dataset.sheet || "");
    const sheet = cleanName(sheetRaw);
    const scored = list.map((product) => {
      let score = 0;
      const name = cleanName(product.name);
      const code = cleanName(product.code);
      const category = cleanName(product.category);
      if (name && sheet === name) score += 60;
      else if (name && sheet && (sheet.includes(name) || name.includes(sheet))) score += 48;
      if (code && (sheet.includes(code) || headers.some((header) => cleanName(header).includes(code)))) score += 40;
      if (category && sheet.includes(category)) score += 25;
      let headerHits = 0;
      (product.fields || []).forEach((field) => {
        if (headers.some((header) => matchScore(header, field) >= 70)) headerHits += 1;
      });
      score += Math.min(40, headerHits * 4);
      if (headers.some((header) => /金额|余额|价值|amount|value|balance/i.test(header))) score += 10;
      return { product, score: Math.min(99, score), headerHits };
    }).sort((a, b) => b.score - a.score);
    const best = scored[0];
    const confidence = best ? best.score : 0;
    const level = confidence >= 80 ? "HIGH" : confidence >= 55 ? "MEDIUM" : "LOW";
    return {
      ...dataset,
      productCode: dataset.productCode || (best ? best.product.code : ""),
      productName: dataset.productName || (best ? best.product.name : ""),
      confidence: dataset.confidence != null ? dataset.confidence : confidence,
      level: dataset.level || level,
      candidates: scored.slice(0, 3).filter((item) => item.score > 0).map((item) => ({
        code: item.product.code, name: item.product.name, score: item.score
      })),
      confirmedAt: dataset.confirmedAt || null
    };
  });
}

function rowValue(row, mapping, fieldCodes) {
  for (const code of fieldCodes) {
    const header = (mapping || {})[code];
    if (header && row[header] != null && row[header] !== "") return row[header];
    if (row[code] != null && row[code] !== "") return row[code];
  }
  return null;
}

function toNumber(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = String(value).replace(/[,，\s]/g, "").replace(/[（(]/g, "-").replace(/[）)]/g, "");
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

export function effectiveMapping(dataset) {
  const mapping = dataset.mapping || {};
  const out = {};
  Object.entries(mapping).forEach(([standard, excel]) => {
    if (excel && !standard.startsWith("__")) out[standard] = excel;
  });
  return out;
}

export function qualityDataset(dataset, product) {
  const rows = dataset.rows || [];
  const mapping = effectiveMapping(dataset);
  const amountCodes = ["amount", "book_value", "fair_value", "undrawn_amount"];
  const hasAmount = amountCodes.some((code) => mapping[code]);
  const required = product.requiredFields || [];
  const mapped = new Set(Object.keys(mapping));
  const missingRequired = required.filter((code) => !mapped.has(code));
  const badFormat = [];
  const missingAmount = [];
  const negative = [];
  const seen = new Map();
  const duplicate = [];
  rows.forEach((row, index) => {
    const amount = toNumber(rowValue(row, mapping, amountCodes));
    if (amount == null || amount === 0) missingAmount.push(index + 1);
    else if (amount < 0) negative.push(index + 1);
    if (amount == null && hasAmount && rowValue(row, mapping, amountCodes) != null) badFormat.push(index + 1);
    const key = rowValue(row, mapping, ["business_id"]);
    if (key != null && key !== "") {
      const text = String(key);
      if (seen.has(text)) duplicate.push(text);
      else seen.set(text, index + 1);
    }
  });
  const checks = [
    {
      type: "字段完整性",
      detail: missingRequired.length ? `缺少规则引用字段：${missingRequired.join(", ")}` : `${required.length} 个规则必需字段均已映射`,
      total: required.length,
      failed: missingRequired.length,
      status: hasAmount && !missingRequired.length ? "PASS" : !hasAmount ? "BLOCK" : "WARN",
      rows: missingRequired
    },
    {
      type: "金额格式",
      detail: badFormat.length ? `${badFormat.length} 行金额无法解析` : "金额列可解析",
      total: rows.length,
      failed: badFormat.length,
      status: badFormat.length ? "WARN" : "PASS",
      rows: badFormat
    },
    {
      type: "金额缺失",
      detail: missingAmount.length ? `${missingAmount.length} 行金额为空或为 0` : "每行都有金额",
      total: rows.length,
      failed: missingAmount.length,
      status: missingAmount.length ? "WARN" : "PASS",
      rows: missingAmount
    },
    {
      type: "业务主键重复",
      detail: duplicate.length ? `${duplicate.length} 个业务编号重复` : "业务编号唯一",
      total: rows.length,
      failed: duplicate.length,
      status: duplicate.length ? "WARN" : "PASS",
      rows: duplicate
    },
    {
      type: "负值金额",
      detail: negative.length ? `${negative.length} 行金额为负` : "没有负值金额",
      total: rows.length,
      failed: negative.length,
      status: negative.length ? "WARN" : "PASS",
      rows: negative
    }
  ];
  const status = checks.some((check) => check.status === "BLOCK") ? "BLOCK"
    : checks.some((check) => check.status === "WARN") ? "WARN" : "PASS";
  return { status, checks, amountMapped: hasAmount, missingRequired };
}

// ---------------------------------------------------------------- 计算输入

export async function lcrInput(task) {
  const cfg = task.cfg || {};
  const jurisdiction = String(cfg.jurisdiction || "HK").toUpperCase();
  const version = String(cfg.ruleVersion || "").trim();
  if (!version) throw fail(400, "任务还没有选择监管规则版本");
  const [catalogue, tableRows, paramRows] = await Promise.all([
    listLiquidityProducts({ jurisdiction, version }),
    query("SELECT * FROM liquidity_param_table WHERE jurisdiction = ? AND rule_version = ?", [jurisdiction, version]),
    query("SELECT * FROM liquidity_param WHERE jurisdiction = ? AND rule_version = ?", [jurisdiction, version])
  ]);
  const usable = catalogue.products.filter(
    (product) => product.status === "LIVE" && product.completeness.score >= 100
  );
  if (!usable.length) throw fail(400, "这一版没有可用于计量的产品（需已启用且配置完整）");
  return {
    task: {
      id: task.id,
      name: task.name,
      baseDate: task.baseDate,
      config: cfg,
      datasets: task.datasets || []
    },
    products: usable.map((product) => ({
      code: product.code, name: product.name, side: product.side, paramKey: product.paramKey,
      category: product.category, group: product.productGroup, fields: product.fields
    })),
    tables: tableRows.map((row) => ({ id: row.table_id, kind: row.kind, rows: parseJson(row.rows_json, []) })),
    params: paramRows.map((row) => ({ id: row.param_id, name: row.name, value: Number(row.value), unit: row.unit }))
  };
}
