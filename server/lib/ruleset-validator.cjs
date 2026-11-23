"use strict";

// 规则配置文档的校验。语法以 docs/信用风险规则/schema/ 下的三份 Schema 为准：
// stc-exposure-risk-weight-v3.5.schema.json、stc-product-registry-v1.1.0.schema.json、
// stc-data-mapping-v1.1.0.schema.json。这里只实现 Schema 用到的关键字，不引入额外依赖。
// 返回字符串数组，空数组表示通过。

const NAME = /^[A-Z][A-Z0-9_]+$/;
const VERSION = /^\d+\.\d+\.\d+$/;
const FIELD_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;
const NODE_ID = /^[A-Za-z][A-Za-z0-9_.-]*$/;
const TABLE_ID = /^T_[A-Z0-9_]+$/;
const LIST_ID = /^L_[A-Z0-9_]+$/;
const PARAM_REF = /^T_[A-Z0-9_]+#[A-Z0-9_]+$/;
const CONTEXT_REF = /^\$context\.[A-Za-z][A-Za-z0-9_.]*$/;
const TARGET_FIELD = /^[a-z][a-z0-9_]*$/;
const VALIDATION_RULE_ID = /^V[0-9]{3,}$/;

const FIELD_TYPES = ["enum", "list", "number", "string", "boolean", "date"];
const FIELD_SOURCES = ["column", "calc"];
const FIELD_LEVELS = ["OBLIGOR", "FACILITY", "COLLATERAL", "SETTLEMENT", "PORTFOLIO", "DATA_PREP", "OUTPUT"];
const MISSING_POLICIES = ["fail", "manual_review", "not_applicable", "default"];
const RULE_TYPES = ["exposure_classification", "risk_weight"];
const STATUSES = ["DRAFT", "REVIEW", "APPROVED", "RETIRED"];
const OPS = [
  "eq", "neq", "in", "not_in", "contains", "not_contains", "lt", "lte", "gt",
  "gte", "between", "exists", "is_null"
];
const VALUE_OPS = ["eq", "neq", "in", "not_in", "contains", "not_contains", "lt", "lte", "gt", "gte"];
const LIST_TYPES = ["positive", "negative", "enumerated"];
const LIST_SOURCES = ["READY", "PENDING_SOURCE", "RETIRED"];
const ADJUSTMENT_OPERATIONS = ["set", "floor", "cap", "add", "multiply", "ladder_floor"];
const FAMILIES = ["LOAN", "BOND", "INTERBANK", "SFT", "DERIVATIVE", "EQUITY", "OFF_BALANCE", "TREASURY", "OTHER"];
const EXPOSURE_TYPES = ["ON_BALANCE", "OFF_BALANCE", "CCR", "SETTLEMENT", "MIXED"];
const SELECTION_BASIS = ["MEASUREMENT_DATE", "REPORTING_DATE", "LATEST_APPROVED"];
const SOURCE_TYPES = ["string", "number", "boolean", "date", "derived", "constant"];
const MAPPING_TARGET_TYPES = ["string", "number", "boolean", "date", "enum", "list"];
const TRANSFORM_TYPES = ["direct", "code_mapping", "numeric_conversion", "date_conversion", "calculation", "conditional", "constant"];
const VALIDATION_ACTIONS = ["fail", "manual_review", "not_applicable", "default"];
const MAPPING_ROLES = ["RULE_INPUT", "COMPUTED", "PLATFORM_PREPARED", "RULESET_INTERFACE", "EXTENDED"];
const DERIVATION_KINDS = ["list_membership", "list_lookup", "table_lookup", "band", "threshold", "ratio", "criteria", "cases"];

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isScalar(value) {
  return value === null || ["string", "number", "boolean"].includes(typeof value);
}

function isDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function keysOf(value) {
  return isObject(value) ? Object.keys(value) : [];
}

function only(obj, allowed, path, errors) {
  keysOf(obj).forEach((key) => {
    if (!allowed.includes(key)) errors.push(path + "." + key + "：Schema 未定义这个属性");
  });
}

function enumValue(value, allowed, path, errors) {
  if (value != null && !allowed.includes(value)) errors.push(path + "：取值 " + JSON.stringify(value) + " 不在 " + allowed.join(" / ") + " 内");
}

function nonEmptyString(value, path, errors) {
  if (typeof value !== "string" || !value.trim()) errors.push(path + "：必须是非空字符串");
}

/** 校验一个规则集文档（分类或风险权重）。refs 可传已入库的参数表和名单做交叉引用。 */
function validateRuleDocument(doc, refs) {
  const errors = [];
  const knownTables = new Set(((refs && refs.tables) || []).map((item) => String(item)));
  const knownLists = new Set(((refs && refs.lists) || []).map((item) => String(item)));
  if (!isObject(doc)) return ["文档必须是 JSON 对象"];

  only(doc, [
    "$schema", "$id", "name", "title", "rule_type", "domain", "version", "status",
    "effective_from", "effective_to", "regulatory_basis", "scope", "fields", "field_groups",
    "tables", "rules", "otherwise", "output_schema", "settings", "note", "lists", "data_contract"
  ], "规则集", errors);

  if (!NAME.test(String(doc.name || ""))) errors.push("name：必须匹配 ^[A-Z][A-Z0-9_]+$");
  nonEmptyString(doc.title, "title", errors);
  enumValue(doc.rule_type, RULE_TYPES, "rule_type", errors);
  if (doc.domain != null && doc.domain !== "STC") errors.push("domain：只能是 STC");
  if (!VERSION.test(String(doc.version || ""))) errors.push("version：必须匹配 \\d+.\\d+.\\d+");
  enumValue(doc.status, STATUSES, "status", errors);
  if (doc.effective_from != null && !isDate(doc.effective_from)) errors.push("effective_from：日期格式应为 YYYY-MM-DD");
  if (doc.effective_to != null && !isDate(doc.effective_to)) errors.push("effective_to：日期格式应为 YYYY-MM-DD");

  const groups = validateFieldGroups(doc.field_groups, errors);
  validateFields(doc.fields, errors, groups);
  const fieldNames = new Set((Array.isArray(doc.fields) ? doc.fields : []).map((field) => field && field.name));
  const declaredTables = validateTables(doc.tables, errors);
  const declaredLists = validateLists(doc.lists, errors);
  const ruleIds = new Set();
  validateRules(doc.rules, "rules", { errors, fieldNames, declaredTables, declaredLists, ruleIds });
  if (doc.otherwise != null) validateResult(doc.otherwise, "otherwise", errors);

  validateOutputSchema(doc, errors);
  validateSettings(doc.settings, errors);
  validateDataContract(doc.data_contract, errors);

  // 参数表 / 名单：文档内声明的，以及参照库里已入库的。
  collectTableRefs(doc).forEach((ref) => {
    if (!declaredTables.has(ref) && !knownTables.has(ref)) errors.push("引用的参数表 " + ref + " 未在 tables 中声明");
  });
  collectListRefs(doc).forEach((ref) => {
    if (!declaredLists.has(ref) && !knownLists.has(ref)) errors.push("引用的名单 " + ref + " 未在 lists 中声明");
  });
  return errors;
}

function validateFieldGroups(groups, errors) {
  const levels = new Map();
  if (!Array.isArray(groups) || !groups.length) {
    errors.push("field_groups：至少需要一个字段分组");
    return levels;
  }
  groups.forEach((group, index) => {
    const path = "field_groups[" + index + "]";
    if (!isObject(group)) {
      errors.push(path + "：必须是对象");
      return;
    }
    only(group, ["group_id", "label", "level", "description", "order", "field_count"], path, errors);
    if (!NAME.test(String(group.group_id || ""))) errors.push(path + ".group_id：必须匹配 ^[A-Z][A-Z0-9_]+$");
    else if (levels.has(group.group_id)) errors.push(path + ".group_id：字段分组 " + group.group_id + " 重复");
    nonEmptyString(group.label, path + ".label", errors);
    enumValue(group.level, FIELD_LEVELS, path + ".level", errors);
    if (group.order != null && !(Number.isInteger(group.order) && group.order >= 0)) errors.push(path + ".order：必须是非负整数");
    if (group.field_count != null && !(Number.isInteger(group.field_count) && group.field_count >= 0)) errors.push(path + ".field_count：必须是非负整数");
    if (group.group_id && !levels.has(group.group_id)) levels.set(group.group_id, group.level);
  });
  return levels;
}

function validateFields(fields, errors, groups) {
  if (!Array.isArray(fields) || !fields.length) {
    errors.push("fields：至少需要一个字段");
    return;
  }
  const seen = new Set();
  fields.forEach((field, index) => {
    const path = "fields[" + index + "]";
    if (!isObject(field)) {
      errors.push(path + "：必须是对象");
      return;
    }
    only(field, [
      "name", "label", "meaning", "note", "type", "source", "unit", "required",
      "missing_policy", "default_value", "extensible", "options", "prepared",
      "derivation", "parameter_refs", "traceability", "legacy_calc", "external_input", "external_provider", "group", "level"
    ], path, errors);
    if (!FIELD_NAME.test(String(field.name || ""))) errors.push(path + ".name：必须匹配 ^[A-Za-z][A-Za-z0-9_]*$");
    else if (seen.has(field.name)) errors.push(path + ".name：字段 " + field.name + " 重复");
    else seen.add(field.name);
    enumValue(field.type, FIELD_TYPES, path + ".type", errors);
    enumValue(field.source, FIELD_SOURCES, path + ".source", errors);
    enumValue(field.missing_policy, MISSING_POLICIES, path + ".missing_policy", errors);
    enumValue(field.level, FIELD_LEVELS, path + ".level", errors);
    if (!NAME.test(String(field.group || ""))) {
      errors.push(path + ".group：必须匹配 ^[A-Z][A-Z0-9_]+$，并指向 field_groups 中的分组");
    } else if (groups && groups.size && !groups.has(field.group)) {
      errors.push(path + ".group：字段分组 " + field.group + " 未在 field_groups 中声明");
    } else if (field.level && groups && groups.get(field.group) && field.level !== groups.get(field.group)) {
      errors.push(path + ".level：字段层面与分组 " + field.group + " 的 " + groups.get(field.group) + " 不一致");
    }

    if (field.type === "enum" && (!Array.isArray(field.options) || !field.options.length)) {
      errors.push(path + ".options：enum 字段必须给出 options");
    }
    if (Array.isArray(field.options)) {
      field.options.forEach((option, at) => {
        if (!isObject(option)) errors.push(path + ".options[" + at + "]：必须是对象");
        else if (option.label == null || option.code == null) errors.push(path + ".options[" + at + "]：label 和 code 都必填");
      });
    }
    if (field.missing_policy === "default" && !Object.prototype.hasOwnProperty.call(field, "default_value")) {
      errors.push(path + ".default_value：missing_policy 为 default 时必填");
    }
    if (field.source === "prepared") {
      if (!isObject(field.prepared)) errors.push(path + ".prepared：source 为 prepared 时必填");
      if (field.derivation != null) errors.push(path + ".derivation：prepared 字段不得再声明 derivation");
      else validatePrepared(field.prepared, path + ".prepared", errors);
    } else if (field.prepared != null) {
      errors.push(path + ".prepared：只有 source 为 prepared 时才能声明");
    }
    if (field.derivation != null) {
      if (field.source !== "calc") errors.push(path + ".derivation：只有 source 为 calc 时才能声明");
      validateDerivation(field.derivation, path + ".derivation", errors);
    }
    if ((field.source === "column" || field.source === "manual" || field.source === "external") && (field.prepared != null || field.derivation != null)) {
      errors.push(path + "：column / manual / external 字段不得声明 prepared 或 derivation");
    }
    if (field.external_input != null && typeof field.external_input !== "boolean") {
      errors.push(path + ".external_input：必须是布尔值");
    }
    if (field.source === "external" && field.external_input !== true) {
      errors.push(path + ".external_input：source 为 external 时必须为 true");
    }
    if (field.source !== "external" && field.external_input === true) {
      errors.push(path + ".external_input：只有 source 为 external 时才能为 true");
    }
    if (Array.isArray(field.parameter_refs)) {
      field.parameter_refs.forEach((ref, at) => {
        if (!TABLE_ID.test(String(ref))) errors.push(path + ".parameter_refs[" + at + "]：必须匹配 ^T_[A-Z0-9_]+$");
      });
    }
  });
}

function validatePrepared(prepared, path, errors) {
  if (!isObject(prepared)) return;
  only(prepared, [
    "stage", "contract_ref", "grain", "derived_from", "parameter_refs", "as_of_field",
    "batch_field", "split_of", "conservation", "reconciliation", "note"
  ], path, errors);
  enumValue(prepared.stage, ["EXCEL_DATA_PREP", "ETL", "UPSTREAM_SYSTEM"], path + ".stage", errors);
  nonEmptyString(prepared.contract_ref, path + ".contract_ref", errors);
  if (!Array.isArray(prepared.grain) || !prepared.grain.length) errors.push(path + ".grain：至少需要一个字段");
  if (prepared.conservation != null) {
    if (!isObject(prepared.conservation)) errors.push(path + ".conservation：必须是对象");
    else {
      nonEmptyString(prepared.conservation.sum_field, path + ".conservation.sum_field", errors);
      nonEmptyString(prepared.conservation.against_field, path + ".conservation.against_field", errors);
    }
  }
  enumValue(prepared.reconciliation, ["same_value_per_grain", "sum_to_original", "none"], path + ".reconciliation", errors);
}

function validateDerivation(derivation, path, errors) {
  if (!isObject(derivation)) {
    errors.push(path + "：必须是对象");
    return;
  }
  const kind = derivation.kind;
  enumValue(kind, DERIVATION_KINDS, path + ".kind", errors);
  if (!DERIVATION_KINDS.includes(kind)) return;
  if (kind === "list_membership") {
    if (!Array.isArray(derivation.include) || !derivation.include.length) errors.push(path + ".include：至少一项");
    validateListBindings(derivation.include, path + ".include", errors);
    validateListBindings(derivation.exclude, path + ".exclude", errors);
    if (!isObject(derivation.key) || !Object.keys(derivation.key).length) errors.push(path + ".key：至少一个键");
  }
  if (kind === "list_lookup") {
    if (!isObject(derivation.key) || !Object.keys(derivation.key).length) errors.push(path + ".key：至少一个键");
    if (!Array.isArray(derivation.map) || !derivation.map.length) errors.push(path + ".map：至少一项");
    (derivation.map || []).forEach((item, at) => {
      if (!LIST_ID.test(String((item || {}).list_id || ""))) errors.push(path + ".map[" + at + "].list_id：必须匹配 ^L_[A-Z0-9_]+$");
      if (!Object.prototype.hasOwnProperty.call(item || {}, "value")) errors.push(path + ".map[" + at + "].value：必填");
    });
  }
  if (kind === "table_lookup") {
    if (!TABLE_ID.test(String(derivation.table_id || ""))) errors.push(path + ".table_id：必须匹配 ^T_[A-Z0-9_]+$");
    if (!isObject(derivation.key) || !Object.keys(derivation.key).length) errors.push(path + ".key：至少一个键");
    nonEmptyString(derivation.value_field, path + ".value_field", errors);
  }
  if (kind === "band") {
    nonEmptyString(derivation.input, path + ".input", errors);
    if (!TABLE_ID.test(String(derivation.bands_table || ""))) errors.push(path + ".bands_table：必须匹配 ^T_[A-Z0-9_]+$");
    enumValue(derivation.boundary, ["lower_inclusive_upper_exclusive", "lower_exclusive_upper_inclusive"], path + ".boundary", errors);
  }
  if (kind === "threshold") {
    nonEmptyString(derivation.input, path + ".input", errors);
    enumValue(derivation.op, ["lte", "lt", "gte", "gt"], path + ".op", errors);
    if (!PARAM_REF.test(String(derivation.parameter_ref || ""))) errors.push(path + ".parameter_ref：必须匹配 ^T_[A-Z0-9_]+#[A-Z0-9_]+$");
  }
  if (kind === "ratio") {
    const numerator = derivation.numerator;
    if (!(typeof numerator === "string" || (Array.isArray(numerator) && numerator.length))) {
      errors.push(path + ".numerator：需要字段名或字段名数组");
    }
    nonEmptyString(derivation.denominator, path + ".denominator", errors);
  }
  if (kind === "criteria" && !isObject(derivation.when)) errors.push(path + ".when：必填");
  if (kind === "cases") {
    if (!Array.isArray(derivation.cases) || !derivation.cases.length) errors.push(path + ".cases：至少一项");
    (derivation.cases || []).forEach((item, at) => {
      if (!isObject(item) || !isObject(item.when)) errors.push(path + ".cases[" + at + "].when：必填");
      if (!Object.prototype.hasOwnProperty.call(item || {}, "value")) errors.push(path + ".cases[" + at + "].value：必填");
    });
  }
}

function validateListBindings(bindings, path, errors) {
  if (bindings == null) return;
  if (!Array.isArray(bindings)) {
    errors.push(path + "：必须是数组");
    return;
  }
  bindings.forEach((item, at) => {
    if (!LIST_ID.test(String((item || {}).list_id || ""))) errors.push(path + "[" + at + "].list_id：必须匹配 ^L_[A-Z0-9_]+$");
  });
}

function validateTables(tables, errors) {
  const declared = new Set();
  if (tables == null) return declared;
  if (!Array.isArray(tables)) {
    errors.push("tables：必须是数组");
    return declared;
  }
  tables.forEach((table, index) => {
    const path = "tables[" + index + "]";
    if (!isObject(table)) {
      errors.push(path + "：必须是对象");
      return;
    }
    only(table, ["table_id", "version", "required", "as_of_field", "description", "purpose", "repository"], path, errors);
    if (!TABLE_ID.test(String(table.table_id || ""))) errors.push(path + ".table_id：必须匹配 ^T_[A-Z0-9_]+$");
    else if (declared.has(table.table_id)) errors.push(path + ".table_id：参数表 " + table.table_id + " 重复");
    else declared.add(table.table_id);
    enumValue(table.purpose, ["regulatory_parameter", "reference_data", "lookup_data"], path + ".purpose", errors);
    if (table.repository != null && !String(table.repository).trim()) errors.push(path + ".repository：不能为空");
  });
  return declared;
}

function validateLists(lists, errors) {
  const declared = new Set();
  if (lists == null) return declared;
  if (!Array.isArray(lists)) {
    errors.push("lists：必须是数组");
    return declared;
  }
  lists.forEach((list, index) => {
    const path = "lists[" + index + "]";
    if (!isObject(list)) {
      errors.push(path + "：必须是对象");
      return;
    }
    ["list_id", "title", "list_type", "regulatory_source", "version", "entry_key", "repository"].forEach((key) => {
      if (list[key] == null) errors.push(path + "." + key + "：必填");
    });
    only(list, [
      "list_id", "title", "list_type", "regulatory_source", "version", "effective_from",
      "effective_to", "as_of_field", "entry_key", "entry_key_aliases", "entry_attributes",
      "columns", "match_basis", "normalisation", "content_hash", "file", "row_count",
      "source_status", "source_document", "repository", "note", "required", "on_unavailable"
    ], path, errors);
    if (!LIST_ID.test(String(list.list_id || ""))) errors.push(path + ".list_id：必须匹配 ^L_[A-Z0-9_]+$");
    else if (declared.has(list.list_id)) errors.push(path + ".list_id：名单 " + list.list_id + " 重复");
    else declared.add(list.list_id);
    enumValue(list.list_type, LIST_TYPES, path + ".list_type", errors);
    enumValue(list.match_basis, ["entity_id", "lei", "code", "name_exact", "name_normalised"], path + ".match_basis", errors);
    enumValue(list.source_status, LIST_SOURCES, path + ".source_status", errors);
    enumValue(list.on_unavailable, ["fail", "manual_review"], path + ".on_unavailable", errors);
    if (list.content_hash != null && !/^sha256:[a-f0-9]{64}$/.test(String(list.content_hash))) {
      errors.push(path + ".content_hash：必须匹配 ^sha256:[a-f0-9]{64}$");
    }
    if (list.effective_from != null && !isDate(list.effective_from)) errors.push(path + ".effective_from：日期格式应为 YYYY-MM-DD");
    if (list.effective_to != null && !isDate(list.effective_to)) errors.push(path + ".effective_to：日期格式应为 YYYY-MM-DD");
    if (list.row_count != null && !(Number.isInteger(list.row_count) && list.row_count >= 0)) errors.push(path + ".row_count：必须是非负整数");
  });
  return declared;
}

function validateRules(rules, path, context) {
  if (!Array.isArray(rules) || !rules.length) {
    context.errors.push(path + "：至少需要一条规则");
    return;
  }
  rules.forEach((node, index) => validateNode(node, path + "[" + index + "]", context));
}

function validateNode(node, path, context) {
  if (!isObject(node)) {
    context.errors.push(path + "：必须是对象");
    return;
  }
  only(node, [
    "id", "name", "label", "note", "when", "skip", "on_unknown", "result",
    "children", "otherwise", "fields", "regulatory_basis", "adjustments", "set", "parameter_lookup"
  ], path, context.errors);
  if (!NODE_ID.test(String(node.id || ""))) context.errors.push(path + ".id：必须匹配 ^[A-Za-z][A-Za-z0-9_.-]*$");
  else if (context.ruleIds.has(node.id)) context.errors.push(path + ".id：节点 " + node.id + " 重复");
  else context.ruleIds.add(node.id);
  nonEmptyString(node.label, path + ".label", context.errors);
  enumValue(node.on_unknown, ["manual_review", "fail", "continue", "use_otherwise"], path + ".on_unknown", context.errors);

  const forms = ["when", "result", "children", "skip", "parameter_lookup", "set"].filter((key) => node[key] != null);
  if (!forms.length) context.errors.push(path + "：when / result / children / skip / parameter_lookup / set 至少要有一个");

  if (node.when != null) validateCondition(node.when, path + ".when", context);
  if (node.result != null) validateResult(node.result, path + ".result", context.errors);
  if (node.children != null) {
    if (!Array.isArray(node.children) || !node.children.length) context.errors.push(path + ".children：至少需要一个子节点");
    else node.children.forEach((child, index) => validateNode(child, path + ".children[" + index + "]", context));
  }
  if (node.otherwise != null) {
    if (isObject(node.otherwise) && (node.otherwise.id != null || node.otherwise.children != null || node.otherwise.when != null)) {
      validateNode(node.otherwise, path + ".otherwise", context);
    } else {
      validateResult(node.otherwise, path + ".otherwise", context.errors);
    }
  }
  if (node.fields != null) {
    if (!Array.isArray(node.fields)) context.errors.push(path + ".fields：必须是数组");
    else node.fields.forEach((fieldName, at) => {
      if (!context.fieldNames.has(fieldName)) context.errors.push(path + ".fields[" + at + "]：字段 " + fieldName + " 未在顶层 fields 中定义");
    });
  }
  if (node.adjustments != null) validateAdjustments(node.adjustments, path + ".adjustments", context.errors);
  if (node.set != null) {
    if (!isObject(node.set)) context.errors.push(path + ".set：必须是对象");
    else Object.keys(node.set).forEach((key) => {
      const value = node.set[key];
      if (!isScalar(value)) context.errors.push(path + ".set." + key + "：只能是字面量或字符串引用");
    });
  }
  if (node.parameter_lookup != null) {
    const lookup = node.parameter_lookup;
    if (!isObject(lookup)) context.errors.push(path + ".parameter_lookup：必须是对象");
    else {
      only(lookup, [
        "table_id", "key", "assign_to", "match_mode", "on_missing", "default_value",
        "description", "regulatory_basis"
      ], path + ".parameter_lookup", context.errors);
      if (!TABLE_ID.test(String(lookup.table_id || ""))) context.errors.push(path + ".parameter_lookup.table_id：必须匹配 ^T_[A-Z0-9_]+$");
      if (!isObject(lookup.key) || !Object.keys(lookup.key).length) context.errors.push(path + ".parameter_lookup.key：至少一个键");
      if (!CONTEXT_REF.test(String(lookup.assign_to || ""))) context.errors.push(path + ".parameter_lookup.assign_to：必须匹配 ^\\$context\\.[A-Za-z][A-Za-z0-9_.]*$");
      enumValue(lookup.match_mode, ["exact", "first_match"], path + ".parameter_lookup.match_mode", context.errors);
      enumValue(lookup.on_missing, ["fail", "manual_review", "use_default"], path + ".parameter_lookup.on_missing", context.errors);
      if (lookup.on_missing === "use_default" && !Object.prototype.hasOwnProperty.call(lookup, "default_value")) {
        context.errors.push(path + ".parameter_lookup.default_value：on_missing 为 use_default 时必填");
      }
    }
  }
}

function validateCondition(condition, path, context) {
  if (!isObject(condition)) {
    context.errors.push(path + "：必须是对象");
    return;
  }
  if (condition.all != null) {
    only(condition, ["all"], path, context.errors);
    if (!Array.isArray(condition.all) || !condition.all.length) context.errors.push(path + ".all：至少一项");
    else condition.all.forEach((item, index) => validateCondition(item, path + ".all[" + index + "]", context));
    return;
  }
  if (condition.any != null) {
    only(condition, ["any"], path, context.errors);
    if (!Array.isArray(condition.any) || !condition.any.length) context.errors.push(path + ".any：至少一项");
    else condition.any.forEach((item, index) => validateCondition(item, path + ".any[" + index + "]", context));
    return;
  }
  if (condition.not != null) {
    only(condition, ["not"], path, context.errors);
    validateCondition(condition.not, path + ".not", context);
    return;
  }
  if (condition.list_check != null) {
    only(condition, ["list_check"], path, context.errors);
    validateListCheck(condition.list_check, path + ".list_check", context);
    return;
  }
  only(condition, ["field", "op", "match", "lower", "upper", "param_ref"], path, context.errors);
  if (!FIELD_NAME.test(String(condition.field || ""))) context.errors.push(path + ".field：必须匹配 ^[A-Za-z][A-Za-z0-9_]*$");
  else if (!context.fieldNames.has(condition.field)) context.errors.push(path + ".field：字段 " + condition.field + " 未在顶层 fields 中定义");
  if (!OPS.includes(condition.op)) {
    context.errors.push(path + ".op：必须是 " + OPS.join(" / "));
    return;
  }
  if (condition.op === "between") {
    if (condition.lower == null || condition.upper == null) context.errors.push(path + "：between 需要 lower 和 upper");
    if (condition.match != null || condition.param_ref != null) context.errors.push(path + "：between 不得同时写 match 或 param_ref");
    if (condition.lower != null && !isScalar(condition.lower)) context.errors.push(path + ".lower：只能是字面量或字符串引用");
    if (condition.upper != null && !isScalar(condition.upper)) context.errors.push(path + ".upper：只能是字面量或字符串引用");
    return;
  }
  if (condition.op === "exists" || condition.op === "is_null") {
    if (condition.match != null || condition.lower != null || condition.upper != null || condition.param_ref != null) {
      context.errors.push(path + "：" + condition.op + " 不能带 match / lower / upper / param_ref");
    }
    return;
  }
  if (VALUE_OPS.includes(condition.op)) {
    if (condition.match == null && condition.param_ref == null) context.errors.push(path + "：" + condition.op + " 需要 match 或 param_ref");
    if (condition.match != null && condition.param_ref != null) context.errors.push(path + "：match 和 param_ref 只能二选一");
    if (condition.lower != null || condition.upper != null) context.errors.push(path + "：" + condition.op + " 不能带 lower / upper");
    if (condition.param_ref != null && !PARAM_REF.test(String(condition.param_ref))) {
      context.errors.push(path + ".param_ref：必须匹配 ^T_[A-Z0-9_]+#[A-Z0-9_]+$");
    }
  }
}

function validateListCheck(check, path, context) {
  if (!isObject(check)) {
    context.errors.push(path + "：必须是对象");
    return;
  }
  only(check, ["include", "exclude", "key", "match_mode", "assign_to", "on_missing", "on_stale"], path, context.errors);
  validateListBindings(check.include, path + ".include", context.errors);
  if (!Array.isArray(check.include) || !check.include.length) context.errors.push(path + ".include：至少一项");
  validateListBindings(check.exclude, path + ".exclude", context.errors);
  if (!isObject(check.key) || !Object.keys(check.key).length) context.errors.push(path + ".key：至少一个键");
  enumValue(check.match_mode, ["exact", "normalised"], path + ".match_mode", context.errors);
  enumValue(check.on_missing, ["not_member", "unknown", "manual_review", "fail"], path + ".on_missing", context.errors);
  enumValue(check.on_stale, ["unknown", "manual_review", "fail"], path + ".on_stale", context.errors);
  if (check.assign_to != null && !CONTEXT_REF.test(String(check.assign_to))) context.errors.push(path + ".assign_to：必须匹配 ^\\$context\\.[A-Za-z][A-Za-z0-9_.]*$");
}

function validateResult(result, path, errors) {
  if (!isObject(result)) {
    errors.push(path + "：必须是对象");
    return;
  }
  only(result, ["code", "label", "category", "exposure_class", "risk_weight", "value", "attributes", "note"], path, errors);
  ["risk_weight", "value"].forEach((key) => {
    if (result[key] != null && !isScalar(result[key])) errors.push(path + "." + key + "：只能是字面量或字符串引用");
  });
  if (result.attributes != null) {
    if (!isObject(result.attributes)) errors.push(path + ".attributes：必须是对象");
    else Object.keys(result.attributes).forEach((key) => {
      if (!isScalar(result.attributes[key])) errors.push(path + ".attributes." + key + "：只能是字面量或字符串引用");
    });
  }
  if (!Object.keys(result).length) errors.push(path + "：结果不能为空对象");
}

function validateAdjustments(adjustments, path, errors) {
  if (!Array.isArray(adjustments)) {
    errors.push(path + "：必须是数组");
    return;
  }
  adjustments.forEach((item, index) => {
    const at = path + "[" + index + "]";
    if (!isObject(item)) {
      errors.push(at + "：必须是对象");
      return;
    }
    only(item, ["adjustment_id", "label", "when", "target", "operation", "value", "ladder", "ladder_table", "regulatory_basis", "note"], at, errors);
    if (item.target !== "result.risk_weight") errors.push(at + ".target：只能是 result.risk_weight");
    if (!ADJUSTMENT_OPERATIONS.includes(item.operation)) errors.push(at + ".operation：取值不在允许范围");
    if (item.operation === "ladder_floor") {
      if (item.value != null) errors.push(at + ".value：ladder_floor 不得写 value");
      if (!Array.isArray(item.ladder) && !TABLE_ID.test(String(item.ladder_table || ""))) {
        errors.push(at + "：ladder_floor 需要 ladder 或 ladder_table");
      }
    } else if (item.operation != null) {
      if (typeof item.value !== "number") errors.push(at + ".value：非 ladder_floor 的调整需要数值 value");
      if (item.ladder != null || item.ladder_table != null) errors.push(at + "：非 ladder_floor 不得写 ladder / ladder_table");
    }
    if (item.ladder_table != null && !TABLE_ID.test(String(item.ladder_table))) errors.push(at + ".ladder_table：必须匹配 ^T_[A-Z0-9_]+$");
    if (item.ladder != null) {
      if (!Array.isArray(item.ladder) || !item.ladder.length) errors.push(at + ".ladder：至少一项");
      else item.ladder.forEach((step, stepIndex) => {
        if (!isObject(step)) errors.push(at + ".ladder[" + stepIndex + "]：必须是对象");
        else if (typeof step.value !== "number") errors.push(at + ".ladder[" + stepIndex + "].value：必须是数值");
      });
    }
  });
}

function validateOutputSchema(doc, errors) {
  const output = doc.output_schema;
  if (!isObject(output)) {
    errors.push("output_schema：必填");
    return;
  }
  const fields = Array.isArray(output.fields) ? output.fields : [];
  const required = doc.rule_type === "exposure_classification" ? "exposure_class" : "risk_weight";
  if (!fields.some((field) => (field || {}).name === required)) {
    errors.push("output_schema.fields：必须包含 " + required);
  }
  fields.forEach((field, index) => {
    if (!isObject(field) || !field.name || !field.type) errors.push("output_schema.fields[" + index + "]：name 和 type 必填");
    else enumValue(field.type, ["string", "number", "boolean", "object", "array"], "output_schema.fields[" + index + "].type", errors);
  });
}

function validateSettings(settings, errors) {
  if (settings == null) return;
  if (!isObject(settings)) {
    errors.push("settings：必须是对象");
    return;
  }
  only(settings, ["matching_mode", "unknown_policy", "list_version_policy"], "settings", errors);
  enumValue(settings.matching_mode, ["first_match", "all_match"], "settings.matching_mode", errors);
  enumValue(settings.unknown_policy, ["manual_review", "fail", "use_otherwise"], "settings.unknown_policy", errors);
  enumValue(settings.list_version_policy, ["pinned", "latest_effective"], "settings.list_version_policy", errors);
}

function validateDataContract(contract, errors) {
  if (contract == null) return;
  if (!isObject(contract)) {
    errors.push("data_contract：必须是对象");
    return;
  }
  only(contract, ["grain", "uniqueness", "required_fields", "consistency", "conservation", "traceability"], "data_contract", errors);
  if (contract.grain != null && (!Array.isArray(contract.grain) || !contract.grain.length)) errors.push("data_contract.grain：至少需要一个字段");
}

function walkNodes(rules, visit) {
  (Array.isArray(rules) ? rules : []).forEach((node) => {
    if (!isObject(node)) return;
    visit(node);
    if (Array.isArray(node.children)) walkNodes(node.children, visit);
    if (isObject(node.otherwise) && (node.otherwise.id != null || node.otherwise.children != null || node.otherwise.when != null)) {
      walkNodes([node.otherwise], visit);
    }
  });
}

function collectConditions(doc) {
  const list = [];
  const walkCondition = (condition) => {
    if (!isObject(condition)) return;
    if (condition.field != null) list.push(condition);
    ["all", "any"].forEach((key) => (condition[key] || []).forEach(walkCondition));
    if (condition.not) walkCondition(condition.not);
  };
  nodesOf(doc).forEach((item) => {
    walkCondition(item.when);
    (item.adjustments || []).forEach((adjustment) => walkCondition(adjustment.when));
    ((item.adjustments || []).map((adjustment) => adjustment.ladder) || []).forEach((ladder) => (ladder || []).forEach((step) => walkCondition(step.when)));
  });
  (doc.fields || []).forEach((field) => {
    if (field && field.derivation && field.derivation.kind === "criteria") walkCondition(field.derivation.when);
    if (field && field.derivation && field.derivation.kind === "cases") (field.derivation.cases || []).forEach((item) => walkCondition(item.when));
  });
  return list;
}

function nodesOf(doc) {
  const nodes = [];
  walkNodes(doc.rules, (node) => nodes.push(node));
  return nodes;
}

function collectTableRefs(doc) {
  const refs = new Set();
  nodesOf(doc).forEach((node) => {
    if (node.parameter_lookup && node.parameter_lookup.table_id) refs.add(node.parameter_lookup.table_id);
    (node.adjustments || []).forEach((adjustment) => {
      if (adjustment.ladder_table) refs.add(adjustment.ladder_table);
    });
  });
  collectConditions({ rules: doc.rules, fields: doc.fields }).forEach((condition) => {
    if (condition.param_ref) refs.add(String(condition.param_ref).split("#")[0]);
  });
  (Array.isArray(doc.fields) ? doc.fields : []).forEach((field) => {
    const derivation = field && field.derivation;
    if (!derivation) return;
    if (derivation.table_id) refs.add(derivation.table_id);
    if (derivation.bands_table) refs.add(derivation.bands_table);
    if (derivation.parameter_ref) refs.add(String(derivation.parameter_ref).split("#")[0]);
    (derivation.parameter_refs || []).forEach((ref) => refs.add(ref));
    if (derivation.kind === "list_lookup") (derivation.map || []).forEach((item) => {});
  });
  (Array.isArray(doc.tables) ? doc.tables : []).forEach((table) => {
    if (table && table.table_id) refs.delete(table.table_id);
  });
  return Array.from(refs);
}

function collectListRefs(doc) {
  const refs = new Set();
  const addBinding = (bindings) => (bindings || []).forEach((item) => { if (item && item.list_id) refs.add(item.list_id); });
  (Array.isArray(doc.fields) ? doc.fields : []).forEach((field) => {
    const derivation = field && field.derivation;
    if (!derivation) return;
    if (derivation.kind === "list_membership") {
      addBinding(derivation.include);
      addBinding(derivation.exclude);
    }
    if (derivation.kind === "list_lookup") (derivation.map || []).forEach((item) => { if (item && item.list_id) refs.add(item.list_id); });
  });
  const walkCondition = (condition) => {
    if (!isObject(condition)) return;
    if (condition.list_check) {
      addBinding(condition.list_check.include);
      addBinding(condition.list_check.exclude);
    }
    ["all", "any"].forEach((key) => (condition[key] || []).forEach(walkCondition));
    if (condition.not) walkCondition(condition.not);
  };
  nodesOf(doc).forEach((node) => { walkCondition(node.when); });
  (Array.isArray(doc.lists) ? doc.lists : []).forEach((list) => { if (list && list.list_id) refs.delete(list.list_id); });
  return Array.from(refs);
}

/** 检查分类与权重两个规则集的节点 ID 和字段引用是否闭合。 */
function validateRulePair(classification, weight) {
  const errors = [];
  if (!isObject(classification) || !isObject(weight)) return errors;
  const classValues = new Set();
  nodesOf(classification).forEach((node) => {
    const result = node.result || (node.otherwise && node.otherwise.exposure_class ? node.otherwise : null);
    if (result && result.exposure_class) classValues.add(result.exposure_class);
  });
  if (classification.otherwise && classification.otherwise.exposure_class) classValues.add(classification.otherwise.exposure_class);
  const weightValues = new Set();
  nodesOf(weight).forEach((node) => {
    (node.fields || []).forEach(() => {});
  });
  nodesOf(weight).forEach((node) => {
    const values = [];
    const walk = (condition) => {
      if (!isObject(condition)) return;
      if (condition.field === "exposure_class" && condition.op === "eq") values.push(condition.match);
      if (condition.field === "exposure_class" && condition.op === "in" && Array.isArray(condition.match)) values.push(...condition.match);
      ["all", "any"].forEach((key) => (condition[key] || []).forEach(walk));
      if (condition.not) walk(condition.not);
    };
    walk(node.when);
    values.forEach((value) => weightValues.add(value));
  });
  weightValues.forEach((value) => {
    if (value != null && !classValues.has(value)) errors.push("风险权重规则引用的 exposure_class = " + value + " 不在分类规则集的输出中");
  });
  return errors;
}

/** 产品规则注册。 */
function validateProductRegistry(doc) {
  const errors = [];
  if (!isObject(doc)) return ["注册文档必须是 JSON 对象"];
  only(doc, [
    "$schema", "$id", "registry_name", "title", "version", "status", "jurisdiction",
    "framework", "effective_from", "effective_to", "default_rule_sets",
    "rule_set_version_policy", "product_mappings", "settings", "note",
    "dictionaries", "field_schema_version"
  ], "产品注册", errors);
  if (!NAME.test(String(doc.registry_name || ""))) errors.push("registry_name：必须匹配 ^[A-Z][A-Z0-9_]+$");
  nonEmptyString(doc.title, "title", errors);
  if (doc.version != null && !VERSION.test(String(doc.version))) errors.push("version：必须匹配 \\d+.\\d+.\\d+");
  if (doc.framework != null && doc.framework !== "STC") errors.push("framework：只能是 STC");
  const schemaV2 = Number(doc.field_schema_version || 0) >= 2;
  if (doc.field_schema_version != null && (!Number.isInteger(doc.field_schema_version) || doc.field_schema_version < 1)) {
    errors.push("field_schema_version：必须是正整数");
  }
  const dictionaryMap = new Map();
  if (doc.dictionaries != null && !Array.isArray(doc.dictionaries)) {
    errors.push("dictionaries：必须是数组");
  } else {
    (doc.dictionaries || []).forEach((dict, index) => {
      const path = "dictionaries[" + index + "]";
      if (!isObject(dict)) { errors.push(path + "：必须是对象"); return; }
      if (!NAME.test(String(dict.dict_code || ""))) errors.push(path + ".dict_code：必须匹配 ^[A-Z][A-Z0-9_]+$");
      else if (dictionaryMap.has(dict.dict_code)) errors.push(path + ".dict_code：字典编码 " + dict.dict_code + " 重复");
      nonEmptyString(dict.dict_name, path + ".dict_name", errors);
      if (schemaV2) nonEmptyString(dict.dict_name_en, path + ".dict_name_en", errors);
      enumValue(dict.status, ["ACTIVE", "DISABLED"], path + ".status", errors);
      const items = Array.isArray(dict.items) ? dict.items : [];
      if (!items.length) errors.push(path + ".items：至少需要一个码值");
      const itemSet = new Set();
      items.forEach((item, at) => {
        const itemPath = path + ".items[" + at + "]";
        if (!isObject(item)) { errors.push(itemPath + "：必须是对象"); return; }
        if (typeof item.item_code !== "string" || !item.item_code.trim()) errors.push(itemPath + ".item_code：必须是非空字符串");
        else if (itemSet.has(item.item_code)) errors.push(itemPath + ".item_code：码值 " + item.item_code + " 重复");
        else itemSet.add(item.item_code);
        nonEmptyString(item.item_name, itemPath + ".item_name", errors);
        if (schemaV2) nonEmptyString(item.item_name_en, itemPath + ".item_name_en", errors);
        enumValue(item.status, ["ACTIVE", "DISABLED"], itemPath + ".status", errors);
      });
      if (dict.dict_code) dictionaryMap.set(dict.dict_code, dict);
    });
  }
  const sets = doc.default_rule_sets;
  if (!isObject(sets)) errors.push("default_rule_sets：必填");
  else {
    only(sets, ["classification_rule_ref", "classification_rule_version", "risk_weight_rule_ref", "risk_weight_rule_version"], "default_rule_sets", errors);
    if (!NAME.test(String(sets.classification_rule_ref || ""))) errors.push("default_rule_sets.classification_rule_ref：必须匹配 ^[A-Z][A-Z0-9_]+$");
    if (!NAME.test(String(sets.risk_weight_rule_ref || ""))) errors.push("default_rule_sets.risk_weight_rule_ref：必须匹配 ^[A-Z][A-Z0-9_]+$");
  }
  const policy = doc.rule_set_version_policy;
  if (policy != null) {
    if (!isObject(policy)) errors.push("rule_set_version_policy：必须是对象");
    else {
      enumValue(policy.selection_basis, SELECTION_BASIS, "rule_set_version_policy.selection_basis", errors);
      enumValue(policy.on_missing_version, ["manual_review", "fail"], "rule_set_version_policy.on_missing_version", errors);
    }
  }
  if (!Array.isArray(doc.product_mappings) || !doc.product_mappings.length) {
    errors.push("product_mappings：至少需要一项");
    return errors;
  }
  const seen = new Set();
  doc.product_mappings.forEach((mapping, index) => {
    const path = "product_mappings[" + index + "]";
    if (!isObject(mapping)) {
      errors.push(path + "：必须是对象");
      return;
    }
    only(mapping, [
      "product_family", "product_codes", "data_mapping_ref", "data_mapping_version", "exposure_type",
      "note", "candidate_exposure_classes", "target_profile_ref", "standard_fields",
      "standard_field_groups", "product_profiles"
    ], path, errors);
    enumValue(mapping.product_family, FAMILIES, path + ".product_family", errors);
    if (!Array.isArray(mapping.product_codes) || !mapping.product_codes.length) errors.push(path + ".product_codes：至少一个产品代码");
    else mapping.product_codes.forEach((code, at) => {
      if (!NAME.test(String(code))) errors.push(path + ".product_codes[" + at + "]：必须匹配 ^[A-Z][A-Z0-9_]+$");
      else if (seen.has(code)) errors.push(path + ".product_codes[" + at + "]：产品代码 " + code + " 重复注册");
      else seen.add(code);
    });
    if (!NAME.test(String(mapping.data_mapping_ref || ""))) errors.push(path + ".data_mapping_ref：必须匹配 ^[A-Z][A-Z0-9_]+$");
    enumValue(mapping.exposure_type, EXPOSURE_TYPES, path + ".exposure_type", errors);
    if (!Array.isArray(mapping.candidate_exposure_classes) || !mapping.candidate_exposure_classes.length) {
      errors.push(path + ".candidate_exposure_classes：至少一个候选暴露类别");
    } else {
      mapping.candidate_exposure_classes.forEach((code, at) => {
        if (!NAME.test(String(code))) errors.push(path + ".candidate_exposure_classes[" + at + "]：必须匹配 ^[A-Z][A-Z0-9_]+$");
      });
    }
    const groupIds = new Set();
    (mapping.standard_field_groups || []).forEach((group, at) => {
      const groupPath = path + ".standard_field_groups[" + at + "]";
      if (!isObject(group)) { errors.push(groupPath + "：必须是对象"); return; }
      if (!NAME.test(String(group.group_id || ""))) errors.push(groupPath + ".group_id：必须匹配 ^[A-Z][A-Z0-9_]+$");
      else if (groupIds.has(group.group_id)) errors.push(groupPath + ".group_id：分组 " + group.group_id + " 重复");
      else groupIds.add(group.group_id);
      nonEmptyString(group.label, groupPath + ".label", errors);
      if (schemaV2) nonEmptyString(group.label_en, groupPath + ".label_en", errors);
      enumValue(group.level, FIELD_LEVELS, groupPath + ".level", errors);
      if (group.order != null && typeof group.order !== "number") errors.push(groupPath + ".order：必须是数字");
    });
    const fieldNames = new Set();
    if (!Array.isArray(mapping.standard_fields) || !mapping.standard_fields.length) {
      errors.push(path + ".standard_fields：至少一个标准字段");
    } else {
      mapping.standard_fields.forEach((field, at) => {
        const fieldPath = path + ".standard_fields[" + at + "]";
        if (!isObject(field)) { errors.push(fieldPath + "：必须是对象"); return; }
        nonEmptyString(field.name, fieldPath + ".name", errors);
        if (schemaV2) {
          if (fieldNames.has(field.name)) errors.push(fieldPath + ".name：字段编码 " + field.name + " 在本产品族内重复");
          else fieldNames.add(field.name);
          nonEmptyString(field.label, fieldPath + ".label", errors);
          nonEmptyString(field.group, fieldPath + ".group", errors);
          if (field.group && !groupIds.has(field.group)) errors.push(fieldPath + ".group：分组 " + field.group + " 不在 standard_field_groups 内");
          enumValue(field.status, ["ACTIVE", "DISABLED"], fieldPath + ".status", errors);
          if (field.input_mode != null) {
            enumValue(field.input_mode, ["manual", "default"], fieldPath + ".input_mode", errors);
            if (field.shared_defaults != null && typeof field.shared_defaults !== "boolean") {
              errors.push(fieldPath + ".shared_defaults：必须是布尔值");
            }
            if (field.input_mode === "default" && !String(field.default_value == null ? "" : field.default_value).trim() && field.shared_defaults !== true) {
              errors.push(fieldPath + ".default_value：输入方式为 default 时必填");
            }
          }
          if (field.dictionary != null && String(field.dictionary) !== "") {
            const dict = dictionaryMap.get(field.dictionary);
            if (!dict) errors.push(fieldPath + ".dictionary：字典 " + field.dictionary + " 不存在");
            else if (!(dict.items || []).some((item) => item && item.status !== "DISABLED")) errors.push(fieldPath + ".dictionary：字典 " + field.dictionary + " 没有可用码值");
          }
          if (field.type === "enum" && !field.dictionary && !(Array.isArray(field.enum_values) && field.enum_values.length)) {
            errors.push(fieldPath + "：enum 字段必须配置字典或临时枚举值");
          }
          ["precision", "scale"].forEach((key) => {
            if (field[key] != null && (!Number.isInteger(field[key]) || field[key] < 0)) errors.push(fieldPath + "." + key + "：必须是非负整数");
          });
        } else {
          if (!NAME.test(String(field.group || ""))) errors.push(fieldPath + ".group：必须匹配 ^[A-Z][A-Z0-9_]+$");
          enumValue(field.level, FIELD_LEVELS, fieldPath + ".level", errors);
        }
        enumValue(field.type, ["string", "number", "boolean", "date", "enum", "derived", "constant"], fieldPath + ".type", errors);
      });
    }
  });
  return errors;
}

/** 一套数据字段映射。 */
function validateDataMapping(doc) {
  const errors = [];
  if (!isObject(doc)) return ["映射文档必须是 JSON 对象"];
  only(doc, [
    "$schema", "$id", "mapping_name", "title", "version", "status", "product_family",
    "source_system", "effective_from", "effective_to", "standard_field_profile",
    "target_profile_ref", "candidate_exposure_classes", "coverage",
    "mappings", "validation_rules", "settings", "note"
  ], "字段映射", errors);
  if (!NAME.test(String(doc.mapping_name || ""))) errors.push("mapping_name：必须匹配 ^[A-Z][A-Z0-9_]+$");
  nonEmptyString(doc.title, "title", errors);
  if (!VERSION.test(String(doc.version || ""))) errors.push("version：必须匹配 \\d+.\\d+.\\d+");
  enumValue(doc.product_family, FAMILIES, "product_family", errors);
  nonEmptyString(doc.source_system, "source_system", errors);
  nonEmptyString(doc.target_profile_ref, "target_profile_ref", errors);
  if (doc.candidate_exposure_classes != null) {
    if (!Array.isArray(doc.candidate_exposure_classes) || !doc.candidate_exposure_classes.length) {
      errors.push("candidate_exposure_classes：至少一个暴露类别");
    } else {
      doc.candidate_exposure_classes.forEach((code, index) => {
        if (!NAME.test(String(code))) errors.push("candidate_exposure_classes[" + index + "]：必须匹配 ^[A-Z][A-Z0-9_]+$");
      });
    }
  }
  if (doc.coverage != null && !isObject(doc.coverage)) errors.push("coverage：必须是对象");
  if (!Array.isArray(doc.mappings) || !doc.mappings.length) {
    errors.push("mappings：至少需要一条映射");
    return errors;
  }
  const seen = new Set();
  doc.mappings.forEach((mapping, index) => {
    const path = "mappings[" + index + "]";
    if (!isObject(mapping)) {
      errors.push(path + "：必须是对象");
      return;
    }
    only(mapping, [
      "source_field", "target_field", "source_type", "target_type", "unit", "transform",
      "required", "missing_policy", "default_value", "description", "regulatory_reference",
      "target_group", "role"
    ], path, errors);
    const constantTransform = isObject(mapping.transform) && mapping.transform.type === "constant";
    if (constantTransform) {
      if (mapping.source_field != null && typeof mapping.source_field !== "string") {
        errors.push(path + ".source_field：必须是字符串");
      }
    } else {
      nonEmptyString(mapping.source_field, path + ".source_field", errors);
    }
    if (!TARGET_FIELD.test(String(mapping.target_field || ""))) errors.push(path + ".target_field：必须匹配 ^[a-z][a-z0-9_]*$");
    else if (seen.has(mapping.target_field)) errors.push(path + ".target_field：目标字段 " + mapping.target_field + " 重复");
    else seen.add(mapping.target_field);
    enumValue(mapping.source_type, SOURCE_TYPES, path + ".source_type", errors);
    enumValue(mapping.target_type, MAPPING_TARGET_TYPES, path + ".target_type", errors);
    enumValue(mapping.missing_policy, MISSING_POLICIES, path + ".missing_policy", errors);
    if (!NAME.test(String(mapping.target_group || ""))) errors.push(path + ".target_group：必须匹配 ^[A-Z][A-Z0-9_]+$");
    enumValue(mapping.role, MAPPING_ROLES, path + ".role", errors);
    if (!MAPPING_ROLES.includes(mapping.role)) errors.push(path + ".role：必填，取值为 " + MAPPING_ROLES.join(" / "));
    const transform = mapping.transform;
    if (!isObject(transform)) errors.push(path + ".transform：必填");
    else {
      only(transform, ["type", "mapping", "expression", "inputs", "output_unit", "on_unmapped_code", "parameters"], path + ".transform", errors);
      enumValue(transform.type, TRANSFORM_TYPES, path + ".transform.type", errors);
      enumValue(transform.on_unmapped_code, ["manual_review", "fail", "null"], path + ".transform.on_unmapped_code", errors);
      if (transform.type === "code_mapping" && !isObject(transform.mapping)) errors.push(path + ".transform.mapping：code_mapping 需要对照表");
      if (transform.type === "constant" && (!isObject(transform.parameters) || transform.parameters.value == null || String(transform.parameters.value).trim() === "")) {
        errors.push(path + ".transform.parameters.value：constant 转换必须填写默认值");
      }
    }
  });
  if (doc.validation_rules != null) {
    if (!Array.isArray(doc.validation_rules)) errors.push("validation_rules：必须是数组");
    else doc.validation_rules.forEach((rule, index) => {
      const path = "validation_rules[" + index + "]";
      if (!isObject(rule)) {
        errors.push(path + "：必须是对象");
        return;
      }
      only(rule, ["rule_id", "target_field", "description", "expression", "action", "regulatory_reference"], path, errors);
      if (!VALIDATION_RULE_ID.test(String(rule.rule_id || ""))) errors.push(path + ".rule_id：必须匹配 ^V[0-9]{3,}$");
      if (rule.target_field != null) {
        const targets = Array.isArray(rule.target_field) ? rule.target_field : [rule.target_field];
        targets.forEach((target, at) => {
          if (typeof target !== "string" || !target.trim()) errors.push(path + ".target_field[" + at + "]：必须是非空字符串");
        });
      }
      nonEmptyString(rule.description, path + ".description", errors);
      enumValue(rule.action, VALIDATION_ACTIONS, path + ".action", errors);
    });
  }
  return errors;
}

module.exports = {
  validateRuleDocument,
  validateRulePair,
  validateProductRegistry,
  validateDataMapping,
  collectTableRefs,
  collectListRefs
};
