export const DECISION_LABELS = {
  reuse: "复用",
  create: "新建",
  default: "默认值",
  system: "系统计算",
  skip: "跳过",
  missing: "缺失"
};

export const DECISION_CLASSES = {
  reuse: "mint",
  create: "blue",
  default: "amber",
  system: "violet",
  skip: "gray",
  missing: "rose"
};

export const MAPPING_TYPE_LABELS = {
  direct: "直接映射",
  constant: "固定默认值",
  transform: "码值转换",
  conditional: "条件映射",
  calculation: "计算派生",
  composite: "组合映射"
};

export const TRANSFORM_TYPE_LABELS = {
  direct: "直接复制",
  constant: "常量赋值",
  code_mapping: "码值转换",
  conditional: "条件映射",
  calculation: "计算派生",
  numeric_conversion: "数值换算",
  date_conversion: "日期转换",
  composite: "组合映射"
};

export const STAGE_LABELS = {
  reading_group: "读取监管字段",
  analyzing: "分析规则用途",
  generating: "生成字段级决策",
  answering: "整理详细回答",
  done: "生成完成"
};

export const STATUS_TEXT = {
  pending: "未处理",
  proposal_ready: "已生成",
  confirmed: "已确认",
  skipped: "已跳过"
};

export const DECISION_TABS = [
  { key: "overview", label: "决策总览" },
  { key: "fields", label: "标准字段" },
  { key: "dictionaries", label: "字典" },
  { key: "mappings", label: "映射" },
  { key: "notes", label: "字段用途讲解" },
  { key: "missing", label: "仍需人工处理" }
];

export const QUICK_CHIPS = ["只处理必填字段", "复用已有标准字段", "固定默认值不建字段", "重新生成本组"];

export const emptySelection = () => ({ decisions: [], fields: [], mappings: [], dictionaries: [] });

export const emptyProgress = () => ({
  active: false,
  stage: "",
  message: "",
  done: 0,
  total: 0,
  decisions: [],
  fields: [],
  mappings: [],
  dictionaries: []
});
