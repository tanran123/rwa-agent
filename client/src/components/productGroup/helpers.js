const TYPE_LABELS = {
  string: "文本",
  number: "数值",
  boolean: "布尔",
  date: "日期",
  enum: "枚举",
  constant: "常量",
  derived: "派生",
  list: "列表"
};

export function fieldTypeLabel(type) {
  return TYPE_LABELS[type] || type || "文本";
}

export function fieldProfile(field) {
  if (field && field.profile) return field.profile;
  return {
    definition: (field && field.label) || "",
    note: "",
    type: (field && field.type) || "string",
    source: "column",
    required: !!(field && field.required),
    missingPolicy: "",
    options: (field && field.options) || [],
    dictionary: null,
    dictionaryCode: "",
    systemCalc: !!(field && field.systemCalc),
    derivation: null,
    parameterRefs: [],
    rules: (field && field.usedBy) || [],
    mapped: !!(field && field.mapped),
    mapping: null,
    standardField: null
  };
}

export function optionText(option) {
  if (!option) return "";
  return [option.code, option.label].filter(Boolean).join(" · ");
}

export function ruleSummary(rule) {
  return [rule && rule.path, rule && rule.whenText, rule && rule.note, rule && rule.article].filter(Boolean).join(" · ");
}

export function stageLabel(stage) {
  return {
    reading_group: "读取监管字段",
    analyzing: "分析规则用途",
    generating: "生成字段级决策",
    answering: "整理详细回答",
    done: "生成完成"
  }[stage] || stage || "生成中";
}

export function decisionStandardText(item) {
  if (item.decisionType === "default") return "不建标准字段";
  if (item.decisionType === "system") return "系统计算";
  if (item.standardField) return item.standardField.name;
  return "—";
}

export function decisionMappingText(item) {
  if (item.decisionType === "system") return "系统派生";
  if (item.decisionType === "skip") return "跳过";
  if (item.decisionType === "missing") return "待人工处理";
  const mapping = item.mapping;
  if (!mapping) return "—";
  if (mapping.mappingType === "constant") return "默认值 " + (mapping.defaultValue || "（空）");
  return mapping.sourceField || "—";
}

export function decisionDictionaryText(item) {
  return item.dictionary ? item.dictionary.dict_code : "—";
}

export function decisionSignature(item) {
  return [
    item.decisionType,
    item.standardField ? item.standardField.name : "",
    item.mapping ? item.mapping.mappingType : "",
    item.mapping ? (item.mapping.sourceField || "") : "",
    item.mapping ? (item.mapping.defaultValue || "") : ""
  ].join("|");
}

export function summarizeDecisionList(list) {
  const labels = [
    ["reuse", "复用"],
    ["create", "新建"],
    ["default", "默认值"],
    ["system", "系统计算"],
    ["skip", "跳过"],
    ["missing", "缺失"]
  ];
  const rows = Array.isArray(list) ? list : [];
  const counts = { reuse: 0, create: 0, default: 0, system: 0, skip: 0, missing: 0 };
  rows.forEach((item) => {
    counts[item.decisionType] = (counts[item.decisionType] || 0) + 1;
  });
  const parts = labels.filter(([key]) => counts[key]).map(([key, label]) => label + " " + counts[key]);
  return "本组 " + rows.length + " 个监管字段" + (parts.length ? "：" + parts.join("、") : "");
}

export function mappingTypeLabel(type) {
  return {
    direct: "直接映射",
    constant: "固定默认值",
    transform: "码值转换",
    conditional: "条件映射",
    calculation: "计算派生",
    composite: "组合映射"
  }[type] || type || "直接映射";
}

export function transformTypeLabel(type) {
  return {
    direct: "直接复制",
    constant: "常量赋值",
    code_mapping: "码值转换",
    conditional: "条件映射",
    calculation: "计算派生",
    numeric_conversion: "数值换算",
    date_conversion: "日期转换",
    composite: "组合映射"
  }[type] || (type ? type + " 转换" : "直接复制");
}

export function mappingTransformLabel(mapping) {
  const type = (mapping && mapping.transform && mapping.transform.type) || (mapping && mapping.transformType);
  if (type) return transformTypeLabel(type);
  return mappingTypeLabel(mapping && mapping.mappingType);
}

export function mappingCodeRows(mapping) {
  const table = mapping && mapping.transform && mapping.transform.mapping;
  if (!table || typeof table !== "object") return [];
  return Object.entries(table).map(([source, target]) => ({ source, target }));
}

export function mappingInputs(mapping) {
  return (mapping && mapping.transform && mapping.transform.inputs) || [];
}

export function sourceFieldText(mapping) {
  if (!mapping) return "";
  if (mapping.mappingType === "constant") return mapping.defaultValue || "（空）";
  return mapping.sourceField || "";
}

export function sourceFieldLabel(mapping) {
  const name = sourceFieldText(mapping);
  if (!name) return "";
  const label = mapping && mapping.sourceLabel;
  return label && label !== name ? label + " · " + name : name;
}

export function mappingTransformSummary(mapping) {
  if (!mapping) return "—";
  if (mapping.mappingType === "constant") return "固定为 " + (mapping.defaultValue || "（空）");
  const rows = mappingCodeRows(mapping);
  if (rows.length) return rows.length + " 条码值映射";
  const expression = mapping.transform && mapping.transform.expression;
  if (expression) return expression;
  const inputs = mappingInputs(mapping);
  if (inputs.length) return "输入 " + inputs.join("、");
  return mapping.mappingType === "direct" ? "直接复制" : "—";
}

export function buildDictionaryIndex(briefFields, proposal) {
  const map = new Map();
  (briefFields || []).forEach((field) => {
    const dict = field.profile && field.profile.dictionary;
    if (dict && dict.dict_code) map.set(dict.dict_code, dict);
  });
  ((proposal && proposal.newDictionaries) || []).forEach((dict) => {
    if (dict && dict.dict_code) map.set(dict.dict_code, dict);
  });
  ((proposal && proposal.standardFields) || []).forEach((field) => {
    const dict = field && field.dictionaryDetail;
    if (dict && dict.dict_code && !map.has(dict.dict_code)) map.set(dict.dict_code, dict);
  });
  return map;
}

export function dictionaryOf(code, index) {
  if (!code || !index) return null;
  return index.get(code) || null;
}

export function dictionaryItems(code, index) {
  const dict = dictionaryOf(code, index);
  return (dict && dict.items) || [];
}

export function dictionaryTitle(code, index) {
  const dict = dictionaryOf(code, index);
  return dict ? (dict.dict_name || dict.dict_code) : (code || "");
}

export function servedTargets(field, decisions) {
  const attached = field && field.servedTargetFields;
  if (Array.isArray(attached) && attached.length) return attached;
  const map = new Map();
  (decisions || []).forEach((item) => {
    const name = item.standardField && item.standardField.name;
    if (!name) return;
    if (!map.has(name)) map.set(name, []);
    map.get(name).push({ targetField: item.targetField, targetLabel: item.targetLabel || item.targetField });
  });
  return map.get(field && field.name) || [];
}

export function rulesOfTarget(name, briefFields) {
  const field = (briefFields || []).find((item) => item.name === name);
  return (field && field.usedBy) || [];
}

export function missingPolicyLabel(value) {
  return {
    manual: "人工处理",
    not_applicable: "不适用",
    default: "默认值",
    error: "阻断",
    warning: "提示"
  }[value] || value || "未设置";
}
