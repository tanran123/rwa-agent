import { query } from "./db.js";

function json(value) {
  if (value == null) return null;
  if (typeof value === "string") {
    try { return JSON.parse(value); } catch { return null; }
  }
  return value;
}

function docsFor(version, kind) {
  return query(
    "SELECT id, name, doc_version, body FROM rule_document WHERE rule_version = ? AND kind = ? ORDER BY name",
    [version, kind]
  );
}

function classLabels(doc) {
  const map = {};
  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    const result = node.result || {};
    if (result.exposure_class && result.label) map[result.exposure_class] = result.label;
    (node.children || []).forEach(walk);
    if (node.otherwise) walk(node.otherwise);
  };
  (doc.rules || []).forEach(walk);
  if (doc.otherwise) walk(doc.otherwise);
  return map;
}

function conditionClassValues(condition, out) {
  if (!condition || typeof condition !== "object") return;
  if (condition.field === "exposure_class") {
    if (condition.op === "eq" && condition.match != null) out.add(String(condition.match));
    if (condition.op === "in" && Array.isArray(condition.match)) condition.match.forEach((item) => out.add(String(item)));
  }
  (condition.all || []).forEach((item) => conditionClassValues(item, out));
  (condition.any || []).forEach((item) => conditionClassValues(item, out));
  if (condition.not) conditionClassValues(condition.not, out);
}

function conditionFields(condition, out) {
  if (!condition || typeof condition !== "object") return;
  if (typeof condition.field === "string" && condition.field) out.add(condition.field);
  (condition.all || []).forEach((item) => conditionFields(item, out));
  (condition.any || []).forEach((item) => conditionFields(item, out));
  if (condition.not) conditionFields(condition.not, out);
}

function inputRefs(value, out) {
  if (value == null) return;
  if (typeof value === "string") {
    const match = value.match(/^\$input\.([A-Za-z][A-Za-z0-9_]*)$/);
    if (match) out.add(match[1]);
    return;
  }
  if (Array.isArray(value)) { value.forEach((item) => inputRefs(item, out)); return; }
  if (typeof value === "object") Object.values(value).forEach((item) => inputRefs(item, out));
}

function scopedFieldNames(docs, selected) {
  const found = new Set();
  const walk = (nodes, inherited) => {
    (nodes || []).forEach((node) => {
      if (!node || typeof node !== "object") return;
      const own = new Set();
      conditionClassValues(node.when, own);
      const classes = own.size ? own : inherited;
      const inScope = !classes.size || Array.from(classes).some((code) => selected.has(code));
      if (inScope) {
        (node.fields || []).forEach((name) => { if (name) found.add(name); });
        conditionFields(node.when, found);
        inputRefs(node.result, found);
        inputRefs(node.parameter_lookup, found);
        inputRefs(node.adjustments, found);
      }
      walk(node.children, classes);
      if (node.otherwise) walk([node.otherwise], classes);
    });
  };
  docs.forEach((doc) => walk(doc.rules || [], new Set()));
  return includeDerivationInputs(docs, found);
}

function fieldDefinitions(docs) {
  const map = new Map();
  docs.forEach((doc) => {
    (doc.fields || []).forEach((field) => {
      if (field && field.name && !map.has(field.name)) map.set(field.name, field);
    });
  });
  return map;
}

/**
 * 派生字段只在规则条件里出现，它的输入字段（如 ecai_code）不会被规则直接引用。
 * 按 derivation 递归把输入字段并入分组范围，否则这些原始字段永远没有机会建映射。
 */
function includeDerivationInputs(docs, found) {
  const defs = fieldDefinitions(docs);
  const queue = Array.from(found);
  while (queue.length) {
    const field = defs.get(queue.shift());
    if (!field || !field.derivation) continue;
    derivationInputs(field.derivation).forEach((input) => {
      if (!input || found.has(input)) return;
      found.add(input);
      queue.push(input);
    });
  }
  return found;
}

function clip(value, limit) {
  const text = String(value == null ? "" : value).trim();
  return text.length > limit ? text.slice(0, limit) : text;
}

const OP_LABELS = {
  eq: "=", neq: "≠", ne: "≠", gt: ">", gte: "≥", lt: "<", lte: "≤",
  in: "属于", not_in: "不属于", contains: "包含", starts_with: "以…开头",
  ends_with: "以…结尾", exists: "有值", not_exists: "无值",
  is_null: "为空", not_null: "不为空"
};

/** 把规则节点的 when 结构压成一句可读条件，供字段画像展示。 */
function conditionText(condition) {
  if (!condition || typeof condition !== "object") return "";
  const parts = [];
  if (Array.isArray(condition.all) && condition.all.length) {
    const text = condition.all.map(conditionText).filter(Boolean).join(" 且 ");
    if (text) parts.push(text);
  }
  if (Array.isArray(condition.any) && condition.any.length) {
    const text = condition.any.map(conditionText).filter(Boolean).join(" 或 ");
    if (text) parts.push("（" + text + "）");
  }
  if (condition.not) {
    const text = conditionText(condition.not);
    if (text) parts.push("非（" + text + "）");
  }
  if (condition.field) {
    const op = OP_LABELS[condition.op] || condition.op || "满足";
    const raw = condition.match !== undefined ? condition.match : (condition.value !== undefined ? condition.value : condition.values);
    if (raw === undefined || raw === null || raw === "") {
      parts.push(condition.field + " " + op);
    } else if (Array.isArray(raw)) {
      parts.push(condition.field + " " + op + " " + raw.join(" / "));
    } else if (typeof raw === "boolean") {
      parts.push(condition.field + " " + op + " " + (raw ? "是" : "否"));
    } else {
      parts.push(condition.field + " " + op + " " + String(raw));
    }
  }
  return parts.filter(Boolean).join("；");
}

function derivationInputs(derivation) {
  const found = new Set();
  const addDirect = (value) => {
    if (typeof value === "string" && value.trim() && !value.includes("$input.")) found.add(value.trim());
  };
  const addRefs = (value) => {
    const matches = String(value).match(/\$input\.([A-Za-z0-9_]+)/g) || [];
    matches.forEach((item) => found.add(item.replace("$input.", "")));
  };
  const walk = (value) => {
    if (value == null) return;
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (typeof value === "string") {
      addRefs(value);
      return;
    }
    if (typeof value !== "object") return;
    addDirect(value.input);
    if (typeof value.field === "string" && value.field.trim()) found.add(value.field.trim());
    if (Array.isArray(value.inputs)) value.inputs.forEach(addDirect);
    if (Array.isArray(value.fields)) value.fields.forEach(addDirect);
    Object.values(value).forEach(walk);
  };
  walk(derivation);
  return Array.from(found);
}

/** 系统计算字段的派生说明：输入字段、表达式、查表引用。 */
function derivationView(derivation) {
  if (!derivation || typeof derivation !== "object") return null;
  const kind = String(derivation.kind || "");
  const labels = {
    criteria: "条件判定",
    cases: "条件分支",
    map: "按表映射",
    table_lookup: "查表取值",
    band: "区间查表",
    formula: "公式计算",
    group: "分组汇总"
  };
  const inputs = derivationInputs(derivation);
  const expression = String(derivation.expression || derivation.formula || "");
  const tableRef = String(derivation.table_id || derivation.bands_table || "");
  const caseCount = Array.isArray(derivation.cases) ? derivation.cases.length : 0;
  return {
    kind,
    kindLabel: labels[kind] || (kind ? kind + " 派生" : "派生"),
    inputs,
    expression,
    tableRef,
    caseCount,
    note: clip(derivation.note || derivation.description || "", 240),
    summary: [
      labels[kind] || kind,
      caseCount ? caseCount + " 个分支" : "",
      inputs.length ? "输入 " + inputs.join("、") : "",
      expression ? "表达式 " + expression : "",
      tableRef ? "表 " + tableRef : ""
    ].filter(Boolean).join("；")
  };
}

function usageMap(documents) {
  const map = {};
  const push = (name, item) => {
    if (!name) return;
    if (!map[name]) map[name] = [];
    if (!map[name].some((entry) => (
      entry.kind === item.kind
      && entry.ruleId === item.ruleId
      && entry.path === item.path
      && entry.whenText === item.whenText
    ))) map[name].push(item);
  };
  const walk = (nodes, kind, parents) => {
    (nodes || []).forEach((node) => {
      if (!node || typeof node !== "object") return;
      const ruleId = node.id || "";
      const nodePath = parents.concat(ruleId || node.label || "未命名");
      const base = {
        kind,
        ruleId,
        ruleLabel: node.label || "",
        path: nodePath.join(" › "),
        whenText: conditionText(node.when),
        note: clip(node.note || (node.result && node.result.note) || "", 240),
        article: (node.regulatory_basis && node.regulatory_basis.article) || ""
      };
      const names = new Set(node.fields || []);
      conditionFields(node.when, names);
      names.forEach((name) => push(name, { ...base }));
      (node.adjustments || []).forEach((adjustment, index) => {
        if (!adjustment || typeof adjustment !== "object") return;
        const adjNames = new Set(adjustment.fields || []);
        conditionFields(adjustment.when, adjNames);
        const path = base.path + " › 调整 " + (index + 1);
        const item = {
          kind,
          ruleId,
          ruleLabel: (node.label || "") + "（调整 " + (index + 1) + "）",
          path,
          whenText: conditionText(adjustment.when),
          note: clip(adjustment.note || adjustment.label || (adjustment.result && adjustment.result.note) || "", 240),
          article: (adjustment.regulatory_basis && adjustment.regulatory_basis.article) || base.article
        };
        adjNames.forEach((name) => push(name, { ...item }));
      });
      walk(node.children, kind, nodePath);
      if (node.otherwise) walk([node.otherwise], kind, nodePath);
    });
  };
  documents.forEach(([doc, kind]) => walk((doc && doc.rules) || [], kind, []));
  return map;
}

function groupMetaOf(documents) {
  const map = {};
  documents.forEach(([doc]) => {
    (doc && doc.field_groups ? doc.field_groups : []).forEach((group, index) => {
      if (!group || !group.group_id || map[group.group_id]) return;
      map[group.group_id] = {
        label: group.label || group.group_id,
        description: group.description || "",
        order: typeof group.order === "number" ? group.order : index
      };
    });
  });
  return map;
}

function buildGroupPlan(
  documents,
  allTargets,
  coveredTargets,
  inScopeNames,
  standardGroups,
  mappingByTarget,
  standardByName,
  dictionaryByCode
) {
  const usages = usageMap(documents);
  const meta = groupMetaOf(documents);
  const groups = new Map();
  allTargets.forEach((field) => {
    if (field.externalInput) return;
    if (inScopeNames.size && !inScopeNames.has(field.name)) return;
    const groupId = field.group || "UNGROUPED";
    if (!groups.has(groupId)) {
      const info = meta[groupId] || {};
      groups.set(groupId, {
        id: groupId,
        label: info.label || groupId,
        description: info.description || "",
        order: info.order == null ? 999 : info.order,
        fields: []
      });
    }
    const mapping = (mappingByTarget && mappingByTarget.get(field.name)) || null;
    const standard = mapping && mapping.sourceField
      ? (standardByName && standardByName.get(mapping.sourceField)) || null
      : null;
    const dictionary = field.dictionaryCode
      ? (dictionaryByCode && dictionaryByCode.get(field.dictionaryCode)) || null
      : null;
    const rules = usages[field.name] || [];
    groups.get(groupId).fields.push({
      name: field.name,
      label: field.label,
      type: field.type,
      required: field.required,
      options: field.options || [],
      systemCalc: field.systemCalc,
      externalInput: field.externalInput === true,
      preparedInput: field.preparedInput === true,
      mapped: coveredTargets.has(field.name),
      usedBy: rules,
      profile: {
        definition: field.meaning || field.description || "",
        note: field.note || "",
        type: field.type || "string",
        source: field.source || "column",
        required: field.required === true,
        missingPolicy: field.missingPolicy || "",
        options: field.options || [],
        dictionary,
        dictionaryCode: field.dictionaryCode || "",
        systemCalc: field.systemCalc === true,
        derivation: derivationView(field.derivation),
        parameterRefs: field.parameterRefs || [],
        rules,
        mapped: coveredTargets.has(field.name),
        mapping: mapping || null,
        standardField: standard ? {
          name: standard.name,
          label: standard.label,
          inputMode: standard.inputMode,
          defaultValue: standard.defaultValue || ""
        } : null
      }
    });
  });
  const standardById = new Map((standardGroups || []).map((group) => [group.group_id, group]));
  return Array.from(groups.values())
    .sort((left, right) => left.order - right.order || left.label.localeCompare(right.label))
    .map((group) => {
      const standard = standardById.get(group.id);
      const required = group.fields.filter((field) => field.required);
      const classificationFields = group.fields.filter((field) => field.usedBy.some((item) => item.kind === "classification"));
      const weightFields = group.fields.filter((field) => field.usedBy.some((item) => item.kind === "weight"));
      return {
        id: group.id,
        label: group.label,
        description: group.description,
        order: group.order,
        standardGroup: standard ? { group_id: standard.group_id, label: standard.label } : null,
        suggestedStandardGroup: standard ? null : {
          group_id: group.id,
          label: group.label,
          description: group.description || group.label
        },
        stats: {
          fields: group.fields.length,
          required: required.length,
          unmapped: group.fields.filter((field) => !field.mapped && !field.systemCalc).length,
          systemCalc: group.fields.filter((field) => field.systemCalc).length,
          classificationFields: classificationFields.length,
          weightFields: weightFields.length
        },
        fields: group.fields
      };
    });
}

function targetFields(docs, mapping) {
  const list = [];
  const seen = new Set();
  const push = (field) => {
    if (!field || !field.name || seen.has(field.name)) return;
    seen.add(field.name);
    list.push({
      name: field.name,
      label: field.label || field.name,
      type: field.type || "string",
      required: field.required === true,
      group: field.group || "",
      options: (field.options || []).slice(0, 50).map((item) => ({ code: item.code, label: item.label || item.code })),
      source: field.source || "column",
      systemCalc: (field.source || "column") === "calc",
      externalInput: (field.source || "column") === "external",
      preparedInput: (field.source || "column") === "prepared",
      meaning: clip(field.meaning || "", 600),
      note: clip(field.note || "", 400),
      description: clip(field.meaning || field.note || field.description, 200),
      missingPolicy: field.missing_policy || "",
      dictionaryCode: field.dictionary || "",
      derivation: field.derivation || null,
      parameterRefs: field.parameter_refs || [],
      unit: field.unit || ""
    });
  };
  docs.forEach((doc) => {
    (doc.fields || []).forEach(push);
  });
  ((mapping && mapping.mappings) || []).forEach((item) => {
    if (!item || !item.target_field || seen.has(item.target_field)) return;
    seen.add(item.target_field);
    list.push({
      name: item.target_field,
      label: item.target_field,
      type: item.target_type || "string",
      required: item.required === true,
      group: item.target_group || "",
      options: [],
      source: "column",
      systemCalc: false,
      externalInput: false,
      preparedInput: false,
      meaning: clip(item.description || "", 600),
      note: "",
      description: clip(item.description, 200),
      missingPolicy: item.missing_policy || "",
      dictionaryCode: "",
      derivation: null,
      parameterRefs: [],
      unit: item.unit || ""
    });
  });
  return list.sort((left, right) => (
    Number(right.required) - Number(left.required)
    || String(left.group).localeCompare(String(right.group))
    || String(left.name).localeCompare(String(right.name))
  ));
}

function dictionaryView(dict) {
  return {
    dict_code: dict.dict_code || dict.code || "",
    dict_name: dict.dict_name || dict.name || "",
    description: clip(dict.description || "", 200),
    items: (dict.items || [])
      .filter((item) => item && item.status !== "DISABLED")
      .slice(0, 80)
      .map((item) => ({
        item_code: item.item_code || item.code || "",
        item_name: item.item_name || item.name || "",
        status: item.status || "ACTIVE"
      }))
  };
}

function standardFieldView(field) {
  return {
    name: field.name,
    label: field.label || field.name,
    labelEn: field.label_en || field.labelEn || "",
    group: field.group || "",
    type: field.type || "string",
    inputMode: field.input_mode || (field.type === "constant" ? "default" : "manual"),
    sharedDefaults: field.shared_defaults === true,
    defaultValue: String(field.default_value ?? ""),
    required: !!field.required,
    dictionary: field.dictionary || "",
    enumValues: Array.isArray(field.enum_values) ? field.enum_values.slice(0, 20) : [],
    description: clip(field.description || field.label || field.name, 100)
  };
}

function draftMappingView(item, docByTarget) {
  const mappingType = String(item.mappingType || item.mapping_type || "direct");
  const view = {
    targetField: item.targetField || item.target_field || "",
    sourceField: item.sourceField || item.source_field || "",
    mappingType,
    defaultValue: mappingType === "constant" ? String(item.defaultValue ?? item.default_value ?? "") : "",
    transformType: mappingType === "constant" ? "constant" : "direct"
  };
  const doc = docByTarget ? docByTarget.get(view.targetField) : null;
  if (doc) {
    const docView = mappingView(doc);
    // 草稿和映射文档的源字段一致时，转换规则以映射文档为准。
    if (docView.sourceField === view.sourceField) return docView;
    return {
      ...view,
      targetType: docView.targetType,
      targetGroup: docView.targetGroup,
      required: docView.required
    };
  }
  return view;
}

function mappingView(item) {
  const transform = item.transform || {};
  const parameters = transform.parameters || {};
  let mappingType = parameters.mappingType || "direct";
  if (transform.type === "constant") mappingType = "constant";
  else if (transform.type === "conditional") mappingType = "conditional";
  else if (transform.type === "calculation") mappingType = "calculation";
  else if (transform.type === "code_mapping") mappingType = "transform";
  const mapping = transform.mapping && typeof transform.mapping === "object" && !Array.isArray(transform.mapping)
    ? Object.fromEntries(Object.entries(transform.mapping).map(([key, value]) => [String(key), String(value)]))
    : null;
  return {
    targetField: item.target_field || "",
    sourceField: item.source_field || "",
    mappingType,
    defaultValue: mappingType === "constant" ? String(parameters.value ?? item.default_value ?? "") : "",
    transformType: transform.type || "direct",
    transform: {
      type: transform.type || "direct",
      expression: String(transform.expression || ""),
      inputs: Array.isArray(transform.inputs) ? transform.inputs.map(String) : [],
      mapping,
      onUnmappedCode: String(transform.on_unmapped_code || ""),
      outputUnit: String(transform.output_unit || "")
    },
    sourceType: item.source_type || "",
    targetType: item.target_type || "",
    required: item.required === true,
    missingPolicy: item.missing_policy || "",
    description: item.description || "",
    regulatoryReference: item.regulatory_reference || "",
    role: item.role || "",
    targetGroup: item.target_group || ""
  };
}

export async function buildProductAssistContext({
  version,
  family,
  entryIndex,
  mode,
  messages,
  currentProposal,
  draftStandardFields,
  draftMappings,
  draftDirty,
  scopeClasses
}) {
  if (!version) throw Object.assign(new Error("缺少监管版本"), { status: 400 });
  const [registryRows, clsRows, rwRows] = await Promise.all([
    query("SELECT id, body, revision FROM rule_document WHERE rule_version = ? AND kind = 'product_registry'", [version]),
    docsFor(version, "exposure_classification"),
    docsFor(version, "risk_weight")
  ]);
  const registry = registryRows
    .map((row) => ({ id: row.id, revision: row.revision, body: json(row.body) || {} }))
    .find((row) => Array.isArray(row.body.product_mappings) && row.body.product_mappings.length);
  if (!registry) throw Object.assign(new Error("当前版本没有产品注册"), { status: 404 });
  const entries = registry.body.product_mappings || [];
  const entry = entries.find((item) => item && item.product_family === family)
    || entries[Number(entryIndex)]
    || null;
  if (!entry) throw Object.assign(new Error("没有找到产品 " + family), { status: 404 });

  const mappingRows = entry.data_mapping_ref
    ? await query(
      "SELECT id, body, revision FROM rule_document WHERE rule_version = ? AND kind = 'data_mapping' AND name = ? ORDER BY id DESC LIMIT 1",
      [version, entry.data_mapping_ref]
    )
    : [];
  const mappingDoc = mappingRows[0] ? (json(mappingRows[0].body) || {}) : {};
  const constantBySource = {};
  (mappingDoc.mappings || []).forEach((item) => {
    if (!item || !item.source_field || !item.transform) return;
    if (item.transform.type !== "constant") return;
    const value = item.transform.parameters && item.transform.parameters.value;
    if (value == null) return;
    if (!constantBySource[item.source_field]) constantBySource[item.source_field] = new Set();
    constantBySource[item.source_field].add(String(value));
  });

  const classification = clsRows[0] ? (json(clsRows[0].body) || {}) : {};
  const weight = rwRows[0] ? (json(rwRows[0].body) || {}) : {};
  const labels = Object.assign({}, classLabels(classification), classLabels(weight));
  const classes = (entry.candidate_exposure_classes || []).map((code) => ({
    code: String(code),
    label: labels[code] || String(code),
    required: true
  }));

  const allTargets = targetFields([classification, weight], mappingDoc);
  // 字段映射页会把当前勾选的暴露类型传进来；没有传时沿用产品注册里保存的范围。
  const scopeCodes = Array.isArray(scopeClasses) ? scopeClasses : entry.candidate_exposure_classes;
  const selectedCodes = new Set((scopeCodes || []).map(String));
  const inScopeNames = scopedFieldNames([classification, weight], selectedCodes);
  const scopedTargets = inScopeNames.size
    ? allTargets.filter((field) => !field.systemCalc && !field.externalInput && (field.required || inScopeNames.has(field.name)))
    : allTargets.filter((field) => !field.systemCalc && !field.externalInput);
  const coveredTargets = new Set((mappingDoc.mappings || []).map((item) => item && item.target_field).filter(Boolean));
  // 只把必填字段和尚未覆盖的目标字段发给模型，控制上下文和生成稿长度。
  // refine 时保留全部目标字段，方便根据对话调整已覆盖字段。
  const relevantTargets = mode === "refine"
    ? scopedTargets
    : scopedTargets.filter((field) => field.required || !coveredTargets.has(field.name));
  const targetList = (relevantTargets.length ? relevantTargets : scopedTargets).slice(0, 120);

  const groups = (entry.standard_field_groups || []).map((group) => ({
    group_id: group.group_id,
    label: group.label || group.group_id,
    labelEn: group.label_en || ""
  }));

  const similar = [];
  // 按确认口径：参考范围只取同版本、同产品族；当前产品本身已有的字段和映射
  // 通过 existing* 传入，这里只放同族同版本的其它 entry（通常为空）。
  entries.forEach((item, index) => {
    if (!item || index === entries.indexOf(entry) || item.product_family !== family) return;
    similar.push({
      family: item.product_family,
      standardFields: (item.standard_fields || []).map(standardFieldView).slice(0, 120)
    });
  });

  const standardGroups = (entry.standard_field_groups || []).map((group) => ({
    group_id: group.group_id,
    label: group.label || group.group_id,
    label_en: group.label_en || "",
    description: group.description || "",
    order: group.order
  }));

  const existingStandardFields = Array.isArray(draftStandardFields)
    ? draftStandardFields.map(standardFieldView)
    : (entry.standard_fields || []).map((field) => {
      const view = standardFieldView(field);
      const values = constantBySource[field.name];
      if (values && values.size === 1 && !view.defaultValue) view.defaultValue = [...values][0];
      if (values && values.size > 1) view.sharedDefaults = true;
      return view;
    });
  const docMappingByTarget = new Map(
    (mappingDoc.mappings || [])
      .filter((item) => item && item.target_field)
      .map((item) => [item.target_field, item])
  );
  const existingMappings = Array.isArray(draftMappings)
    ? draftMappings.map((item) => draftMappingView(item, docMappingByTarget))
    : (mappingDoc.mappings || []).map(mappingView);
  const mappingByTarget = new Map(
    existingMappings.filter((item) => item && item.targetField).map((item) => [item.targetField, item])
  );
  const standardByName = new Map(
    existingStandardFields.filter((item) => item && item.name).map((item) => [item.name, item])
  );
  const dictionaryByCode = new Map(
    (registry.body.dictionaries || [])
      .map(dictionaryView)
      .filter((item) => item.dict_code)
      .map((item) => [item.dict_code, item])
  );
  const coveredForPlan = new Set(mappingByTarget.keys());
  const plan = buildGroupPlan(
    [[classification, "classification"], [weight, "weight"]],
    allTargets,
    coveredForPlan,
    inScopeNames,
    standardGroups,
    mappingByTarget,
    standardByName,
    dictionaryByCode
  );

  return {
    mode: mode || "generate_standard_fields",
    product: {
      family: entry.product_family,
      label: entry.product_label || entry.label || entry.product_name || entry.product_family,
      productCodes: entry.product_codes || [],
      mappingRef: entry.data_mapping_ref || "",
      mappingVersion: entry.data_mapping_version || "",
      targetProfileRef: entry.target_profile_ref || "",
      note: entry.note || "",
      description: entry.description || entry.note || "",
      standardFieldGroups: groups,
      sourceSystem: mappingDoc.source_system || ""
    },
    exposureClasses: classes,
    targetFields: targetList,
    externalInputs: allTargets
      .filter((field) => field.externalInput && (!inScopeNames.size || inScopeNames.has(field.name)))
      .map((field) => ({
        name: field.name,
        label: field.label,
        type: field.type,
        group: field.group,
        required: false,
        systemCalc: false,
        externalInput: true
      })),
    knownTargetFields: allTargets.filter((field) => !field.systemCalc && !field.externalInput).map((field) => field.name),
    scopedTargetFields: targetList.map((field) => field.name),
    standardFieldGroups: standardGroups,
    groupPlan: plan,
    existingStandardFields,
    existingMappings,
    draftDirty: draftDirty === true,
    dictionaries: Array.from(dictionaryByCode.values()).slice(0, 80),
    similarProducts: similar,
    messages: Array.isArray(messages) ? messages.slice(-20) : [],
    currentProposal: currentProposal || null,
    revisions: {
      registry: registry.revision,
      mapping: mappingRows[0] ? mappingRows[0].revision : null
    }
  };
}
