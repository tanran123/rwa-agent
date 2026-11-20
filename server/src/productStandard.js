import { query } from "./db.js";
import { resolveVersionRef } from "./ruleVersion.js";

/**
 * EAD / 信用风险缓释配置共用的产品清单。
 *
 * 产品清单和标准字段优先读「产品标准字段配置」写入的 product_registry 文档；
 * 该监管版本还没有产品注册时，才回退到旧的 product_type / product_field，
 * 保证澳门这类历史版本仍能打开。
 */

const FAMILY_META = {
  LOAN: { label: "贷款产品", icon: "贷", color: "#0f766e" },
  BOND: { label: "债券产品", icon: "债", color: "#1d4ed8" },
  INTERBANK: { label: "同业与存款", icon: "存", color: "#7c3aed" },
  SFT: { label: "证券融资", icon: "融", color: "#b45309" },
  DERIVATIVE: { label: "衍生工具", icon: "衍", color: "#be123c" },
  EQUITY: { label: "股权与资本工具", icon: "股", color: "#0e7490" },
  OFF_BALANCE: { label: "表外业务", icon: "表", color: "#4d7c0f" },
  TREASURY: { label: "资金与结算", icon: "资", color: "#475569" },
  OTHER: { label: "其他产品", icon: "其", color: "#64748b" }
};

function json(value) {
  if (value == null) return null;
  if (typeof value === "string") {
    try { return JSON.parse(value); } catch { return null; }
  }
  return value;
}

function legacyProducts(products, fields) {
  return products.map((row) => ({
    code: row.code,
    label: row.label,
    icon: row.icon,
    color: row.color,
    ruleVersion: row.rule_version,
    fields: fields
      .filter((field) => field.product_code === row.code)
      .map((field) => ({
        code: field.code,
        name: field.name,
        meaning: field.meaning,
        stdField: field.std_field,
        required: !!field.required,
        sourceSystem: field.source_system,
        sourceField: field.source_field
      }))
  }));
}

export async function configProducts(version = "") {
  const [registryRows, legacyRows, legacyFieldRows, mappingRows] = await Promise.all([
    query("SELECT rule_version, body FROM rule_document WHERE kind = 'product_registry'"),
    query("SELECT code, label, icon, color, rule_version FROM product_type ORDER BY code"),
    query(
      `SELECT product_code, code, name, meaning, std_field, required, source_system, source_field
       FROM product_field ORDER BY id`
    ),
    query("SELECT rule_version, body FROM rule_document WHERE kind = 'data_mapping'")
  ]);

  const mappingByRef = new Map();
  mappingRows.forEach((row) => {
    const body = json(row.body) || {};
    if (body.mapping_name) mappingByRef.set(row.rule_version + "|" + body.mapping_name, body);
  });

  const registryVersions = new Set();
  const products = [];
  const seen = new Set();

  registryRows.forEach((row) => {
    const body = json(row.body) || {};
    const entries = Array.isArray(body.product_mappings) ? body.product_mappings : [];
    if (!entries.length) return;
    registryVersions.add(row.rule_version);
    entries.forEach((entry) => {
      if (!entry || !entry.product_family) return;
      const key = row.rule_version + "|" + entry.product_family;
      if (seen.has(key)) return;
      seen.add(key);
      const meta = FAMILY_META[entry.product_family] || {
        label: entry.product_family, icon: "产", color: "#64748b"
      };
      const mapping = mappingByRef.get(row.rule_version + "|" + entry.data_mapping_ref) || {};
      const targetBySource = {};
      (mapping.mappings || []).forEach((item) => {
        if (!item || !item.source_field || !item.target_field) return;
        if (!targetBySource[item.source_field]) targetBySource[item.source_field] = item.target_field;
      });
      const fields = [];
      const seenFields = new Set();
      (entry.standard_fields || []).forEach((field) => {
        if (!field || !field.name || seenFields.has(field.name)) return;
        seenFields.add(field.name);
        fields.push({
          code: field.name,
          name: field.label || field.name,
          labelEn: field.label_en || "",
          meaning: field.description || field.label || field.name,
          description: field.description || field.label || field.name,
          descriptionEn: field.description_en || "",
          stdField: targetBySource[field.name] || field.name,
          group: field.group || "",
          required: !!field.required,
          status: field.status || "ACTIVE",
          unit: field.unit || "",
          precision: field.precision == null ? null : field.precision,
          scale: field.scale == null ? null : field.scale,
          format: field.format || "",
          defaultValue: field.default_value || "",
          dictionary: field.dictionary || "",
          enumValues: Array.isArray(field.enum_values) ? field.enum_values : [],
          sourceHint: field.source_hint || "",
          aliases: Array.isArray(field.aliases) ? field.aliases : [],
          sourceSystem: mapping.source_system || "",
          sourceField: field.name
        });
      });
      products.push({
        code: entry.product_family,
        label: meta.label,
        icon: meta.icon,
        color: meta.color,
        ruleVersion: row.rule_version,
        dataMappingRef: entry.data_mapping_ref || "",
        standardFieldGroups: (entry.standard_field_groups || []).map((group) => ({
          id: group.group_id,
          group_id: group.group_id,
          label: group.label || group.group_id,
          labelEn: group.label_en || "",
          description: group.description || "",
          order: typeof group.order === "number" ? group.order : null,
          fieldCount: (entry.standard_fields || []).filter((field) => field.group === group.group_id).length
        })),
        businessGroups: Object.entries(entry.product_profiles || {}).map(([code, profile]) => ({
          code,
          candidateExposureClasses: (profile.candidate_exposure_classes || []).slice(),
          note: profile.note || ""
        })),
        candidateExposureClasses: (entry.candidate_exposure_classes || []).slice(),
        productCodes: (entry.product_codes || []).slice(),
        fields: fields
      });
    });
  });

  const legacy = legacyProducts(legacyRows, legacyFieldRows)
    .filter((product) => !registryVersions.has(product.ruleVersion))
    .map((product) => Object.assign({ candidateExposureClasses: [], productCodes: [], standardFieldGroups: [], businessGroups: [] }, product));
  const all = products.concat(legacy);
  return version ? all.filter((product) => product.ruleVersion === version) : all;
}

function jsonBody(value) {
  return json(value) || {};
}

function versionOf(value) {
  return String(value || "").split(".").map((item) => Number(item) || 0);
}

function newer(left, right) {
  const a = versionOf(left);
  const b = versionOf(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if ((a[index] || 0) !== (b[index] || 0)) return (a[index] || 0) > (b[index] || 0);
  }
  return false;
}

/** 当前监管版本用到的规则文档：产品注册、分类、权重、字段映射。 */
export async function versionRuleDocuments(version) {
  if (!version) return { registry: null, classification: null, weight: null, mappings: [] };
  const rows = await query(
    "SELECT * FROM rule_document WHERE rule_version = ?",
    [version]
  );
  const registryRow = rows.find((row) => row.kind === "product_registry") || null;
  const registryBody = registryRow ? jsonBody(registryRow.body) : {};
  const sets = registryBody.default_rule_sets || {};
  const classificationRows = rows.filter((row) => row.kind === "exposure_classification");
  const weightRows = rows.filter((row) => row.kind === "risk_weight");
  const pickDoc = (list, ref) => {
    const named = ref ? list.find((row) => row.name === ref) : null;
    if (named) return named;
    return list.slice().sort((left, right) => newer(right.doc_version, left.doc_version) ? -1 : 1)[0] || null;
  };
  const wrap = (row) => row ? {
    id: row.id,
    name: row.name,
    docVersion: row.doc_version,
    doc: jsonBody(row.body)
  } : null;
  return {
    registry: registryRow ? { id: registryRow.id, name: registryRow.name, docVersion: registryRow.doc_version, doc: registryBody } : null,
    classification: wrap(pickDoc(classificationRows, sets.classification_rule_ref)),
    weight: wrap(pickDoc(weightRows, sets.risk_weight_rule_ref)),
    mappings: rows.filter((row) => row.kind === "data_mapping").map((row) => ({
      id: row.id,
      name: row.name,
      docVersion: row.doc_version,
      doc: jsonBody(row.body)
    }))
  };
}

/** 参数表和名单按 table_id / list_id 展开，供规则执行器查询。
 *  有 rule_version_id 时先取该版本的，没有版本的旧行作为兼容回退。 */
export async function parameterPayload(jurisdiction, version = "") {
  const versionId = version ? await resolveVersionRef(version, jurisdiction) : "";
  const [tableRows, listRows] = await Promise.all([
    query(
      versionId
        ? "SELECT * FROM rule_parameter_table WHERE (jurisdiction = ? OR ? = '') AND (rule_version_id = ? OR rule_version_id = '')"
        : "SELECT * FROM rule_parameter_table WHERE (? = '' OR jurisdiction = ?)",
      versionId ? [jurisdiction || "", jurisdiction || "", versionId] : [jurisdiction || "", jurisdiction || ""]
    ),
    query(
      versionId
        ? "SELECT * FROM rule_list WHERE (jurisdiction = ? OR ? = '') AND (rule_version_id = ? OR rule_version_id = '')"
        : "SELECT * FROM rule_list WHERE (? = '' OR jurisdiction = ?)",
      versionId ? [jurisdiction || "", jurisdiction || "", versionId] : [jurisdiction || "", jurisdiction || ""]
    )
  ]);
  const pick = (rows, key, idKey) => {
    const result = {};
    rows.filter((row) => !row.rule_version_id).forEach((row) => {
      result[row[key]] = row;
    });
    rows.filter((row) => row.rule_version_id).forEach((row) => {
      result[row[key]] = row;
    });
    const out = {};
    Object.entries(result).forEach(([id, row]) => {
      out[id] = {
        [idKey]: row[key],
        version: idKey === "tableId" ? row.table_version : row.list_version,
        columns: json(row.columns_json) || [],
        rows: json(row.rows_json) || []
      };
    });
    return out;
  };
  return {
    tables: pick(tableRows, "table_id", "tableId"),
    lists: pick(listRows, "list_id", "listId")
  };
}

function conditionFields(condition, fields) {
  if (!condition || typeof condition !== "object") return;
  if (condition.field) fields.add(condition.field);
  (condition.all || []).forEach((item) => conditionFields(item, fields));
  (condition.any || []).forEach((item) => conditionFields(item, fields));
  if (condition.not) conditionFields(condition.not, fields);
}

function ruleFieldsOf(node) {
  const fields = new Set(node.fields || []);
  conditionFields(node.when, fields);
  (node.adjustments || []).forEach((item) => {
    conditionFields(item.when, fields);
    (item.ladder || []).forEach((step) => conditionFields(step.when, fields));
  });
  return fields;
}

function collectClassFields(nodes, classFields) {
  (nodes || []).forEach((node) => {
    if (!node || typeof node !== "object") return;
    const fields = ruleFieldsOf(node);
    const classes = [];
    const result = node.result || {};
    if (result.exposure_class) classes.push(result.exposure_class);
    if (!classes.length) {
      const list = (node.when && (node.when.all || node.when.any)) || [];
      list.forEach((item) => {
        if (!item || item.field !== "exposure_class") return;
        if (item.op === "eq" && item.match) classes.push(item.match);
        if (item.op === "in" && Array.isArray(item.match)) classes.push(...item.match);
      });
    }
    classes.forEach((code) => {
      if (!classFields[code]) classFields[code] = new Set();
      fields.forEach((field) => classFields[code].add(field));
    });
    collectClassFields(node.children, classFields);
    if (node.otherwise) collectClassFields([node.otherwise], classFields);
  });
}

export async function productGroupMappings(version) {
  const [products, docs] = await Promise.all([
    configProducts(version),
    versionRuleDocuments(version)
  ]);
  const classFields = {};
  if (docs.classification && docs.classification.doc) collectClassFields(docs.classification.doc.rules, classFields);
  if (docs.weight && docs.weight.doc) collectClassFields(docs.weight.doc.rules, classFields);
  const mappingByName = new Map((docs.mappings || []).map((item) => [item.name, item.doc || {}]));
  const groups = [];
  products.forEach((product) => {
    const mapping = mappingByName.get(product.dataMappingRef) || {};
    const mappedTargets = new Set((mapping.mappings || []).map((item) => item.target_field).filter(Boolean));
    (product.businessGroups || []).forEach((group) => {
      const targets = new Set();
      (group.candidateExposureClasses || []).forEach((code) => {
        (classFields[code] ? Array.from(classFields[code]) : []).forEach((field) => {
          if (field !== "exposure_class") targets.add(field);
        });
      });
      const missing = Array.from(targets).filter((field) => !mappedTargets.has(field));
      groups.push({
        groupCode: group.code,
        productFamily: product.code,
        candidateExposureClasses: group.candidateExposureClasses,
        mappingRef: product.dataMappingRef,
        mappedTargets: mappedTargets.size,
        requiredTargets: targets.size,
        coveredTargets: targets.size - missing.length,
        coveragePct: targets.size ? Math.round((targets.size - missing.length) / targets.size * 100) : 100,
        missingTargets: missing
      });
    });
  });
  return { version, groups };
}
