// 字段映射的处理步骤定义、校验和执行。只做前端配置与预览，不参与正式计量。
// 步骤配置存放在数据映射文档 transform.parameters 下，保持 v1.1.0 数据映射 Schema 不变。

export const MAPPING_TYPES = [
  { key: "direct", label: "直接映射" },
  { key: "transform", label: "转换映射" },
  { key: "conditional", label: "条件映射" },
  { key: "calculation", label: "计算映射" },
  { key: "composite", label: "组合映射" }
];

const CONDITION_OPS = [
  { value: "eq", label: "等于" },
  { value: "neq", label: "不等于" },
  { value: "in", label: "属于" },
  { value: "not_in", label: "不属于" },
  { value: "contains", label: "包含" },
  { value: "gt", label: "大于" },
  { value: "gte", label: "大于等于" },
  { value: "lt", label: "小于" },
  { value: "lte", label: "小于等于" },
  { value: "exists", label: "有值" },
  { value: "is_null", label: "为空" }
];

const NULL_MODES = [
  { value: "keep", label: "保留原值" },
  { value: "null", label: "转为空值" },
  { value: "default", label: "替换为默认值" }
];

export const STEP_CATEGORIES = [
  {
    key: "clean",
    label: "数据清洗",
    types: [
      {
        key: "clean_null",
        label: "空值处理",
        fields: [
          { key: "mode", label: "处理方式", type: "select", options: NULL_MODES, default: "keep" },
          { key: "default", label: "默认值", type: "text", showWhen: { mode: "default" } }
        ],
        summary: (p) => (p.mode === "default" ? "空值 → " + p.default : p.mode === "null" ? "空值 → null" : "保留空值")
      },
      {
        key: "clean_default",
        label: "默认值替换",
        fields: [{ key: "default", label: "默认值", type: "text", default: "" }],
        summary: (p) => "空值 → " + (p.default || "（未填）")
      },
      {
        key: "clean_outlier",
        label: "异常值处理",
        fields: [
          { key: "min", label: "下限", type: "number" },
          { key: "max", label: "上限", type: "number" },
          { key: "action", label: "处理方式", type: "select", options: [{ value: "clamp", label: "截断到区间" }, { value: "null", label: "转为空值" }, { value: "default", label: "替换为默认值" }], default: "clamp" },
          { key: "default", label: "默认值", type: "text", showWhen: { action: "default" } }
        ],
        summary: (p) => "区间 " + (p.min ?? "−∞") + " ~ " + (p.max ?? "+∞") + "，" + (p.action === "null" ? "越界置空" : p.action === "default" ? "越界取默认值" : "越界截断")
      },
      {
        key: "clean_trim",
        label: "去除空格",
        fields: [{ key: "mode", label: "处理方式", type: "select", options: [{ value: "both", label: "两侧" }, { value: "left", label: "左侧" }, { value: "right", label: "右侧" }], default: "both" }],
        summary: (p) => (p.mode === "left" ? "去左侧空格" : p.mode === "right" ? "去右侧空格" : "去两侧空格")
      }
    ]
  },
  {
    key: "format",
    label: "格式转换",
    types: [
      {
        key: "convert_type",
        label: "数据类型转换",
        fields: [{ key: "to", label: "目标类型", type: "select", options: [{ value: "string", label: "文本" }, { value: "number", label: "数值" }, { value: "boolean", label: "布尔" }, { value: "date", label: "日期" }], default: "string" }],
        summary: (p) => "转为 " + (p.to || "文本")
      },
      {
        key: "date_format",
        label: "日期格式转换",
        fields: [
          { key: "to", label: "目标格式", type: "select", options: [{ value: "YYYY-MM-DD", label: "YYYY-MM-DD" }, { value: "YYYY/MM/DD", label: "YYYY/MM/DD" }, { value: "YYYYMMDD", label: "YYYYMMDD" }, { value: "YYYY-MM-DD HH:mm:ss", label: "YYYY-MM-DD HH:mm:ss" }], default: "YYYY-MM-DD" }
        ],
        summary: (p) => "日期格式 → " + (p.to || "YYYY-MM-DD")
      },
      {
        key: "precision",
        label: "数值精度转换",
        fields: [
          { key: "digits", label: "小数位数", type: "number", default: 2 },
          { key: "rounding", label: "舍入方式", type: "select", options: [{ value: "round", label: "四舍五入" }, { value: "floor", label: "向下取整" }, { value: "ceil", label: "向上取整" }], default: "round" }
        ],
        summary: (p) => "保留 " + (p.digits ?? 2) + " 位，" + (p.rounding || "四舍五入")
      },
      {
        key: "unit_convert",
        label: "单位转换",
        fields: [
          { key: "factor", label: "乘数", type: "number", default: 1 },
          { key: "offset", label: "偏移量", type: "number", default: 0 }
        ],
        summary: (p) => "值 × " + (p.factor ?? 1) + " + " + (p.offset ?? 0)
      }
    ]
  },
  {
    key: "condition",
    label: "条件处理",
    types: [
      {
        key: "cond_if",
        label: "IF 条件判断",
        fields: [
          { key: "when", label: "条件", type: "condition" },
          { key: "then", label: "成立取值", type: "text" },
          { key: "otherwise", label: "不成立取值", type: "text" }
        ],
        summary: () => "按条件二选一"
      },
      {
        key: "cond_multi",
        label: "多条件判断",
        fields: [
          { key: "when", label: "条件组", type: "condition" },
          { key: "then", label: "成立取值", type: "text" },
          { key: "otherwise", label: "不成立取值", type: "text" }
        ],
        summary: () => "多条件判断"
      },
      {
        key: "cond_assign",
        label: "条件赋值",
        fields: [
          { key: "when", label: "条件", type: "condition" },
          { key: "then", label: "成立取值", type: "text" }
        ],
        summary: () => "满足条件时赋值"
      },
      {
        key: "case_when",
        label: "CASE WHEN",
        fields: [
          { key: "cases", label: "分支", type: "cases" },
          { key: "default", label: "默认取值", type: "text" }
        ],
        summary: () => "多分支取值"
      }
    ]
  },
  {
    key: "calc",
    label: "数值计算",
    types: [
      {
        key: "calc_arith",
        label: "加减乘除",
        fields: [
          { key: "op", label: "运算符", type: "select", options: [{ value: "+", label: "+" }, { value: "-", label: "-" }, { value: "*", label: "×" }, { value: "/", label: "÷" }], default: "+" },
          { key: "operandField", label: "操作数字段", type: "field" },
          { key: "operandValue", label: "操作数常量", type: "number" }
        ],
        summary: (p) => "值 " + (p.op || "+") + " " + (p.operandField || p.operandValue || "（未填）")
      },
      {
        key: "calc_percent",
        label: "百分比计算",
        fields: [
          { key: "baseField", label: "分母字段", type: "field" },
          { key: "baseValue", label: "分母常量", type: "number" },
          { key: "mode", label: "输出", type: "select", options: [{ value: "percent", label: "百分数" }, { value: "ratio", label: "比值" }], default: "percent" }
        ],
        summary: () => "值 ÷ 分母"
      },
      { key: "calc_round", label: "四舍五入", fields: [{ key: "digits", label: "小数位数", type: "number", default: 0 }], summary: (p) => "保留 " + (p.digits ?? 0) + " 位" },
      { key: "calc_floor", label: "向下取整", fields: [], summary: () => "向下取整" },
      { key: "calc_ceil", label: "向上取整", fields: [], summary: () => "向上取整" }
    ]
  },
  {
    key: "text",
    label: "文本处理",
    types: [
      {
        key: "text_substr",
        label: "文本截取",
        fields: [
          { key: "start", label: "起始位置", type: "number", default: 0 },
          { key: "length", label: "长度", type: "number" }
        ],
        summary: (p) => "从第 " + (p.start ?? 0) + " 位起截取" + (p.length ? " " + p.length + " 位" : "")
      },
      {
        key: "text_replace",
        label: "文本替换",
        fields: [
          { key: "from", label: "查找", type: "text" },
          { key: "to", label: "替换为", type: "text" }
        ],
        summary: (p) => "替换「" + (p.from || "") + "」为「" + (p.to || "") + "」"
      },
      {
        key: "text_concat",
        label: "字符串拼接",
        fields: [
          { key: "fields", label: "参与字段", type: "fields" },
          { key: "separator", label: "分隔符", type: "text" }
        ],
        summary: (p) => "拼接 " + ((p.fields || []).length || 0) + " 个字段"
      },
      {
        key: "text_case",
        label: "大小写转换",
        fields: [{ key: "mode", label: "方式", type: "select", options: [{ value: "upper", label: "转为大写" }, { value: "lower", label: "转为小写" }], default: "upper" }],
        summary: (p) => (p.mode === "lower" ? "转为小写" : "转为大写")
      }
    ]
  },
  {
    key: "lookup",
    label: "字段取值",
    types: [
      { key: "const_value", label: "固定常量", fields: [{ key: "value", label: "常量值", type: "text" }], summary: (p) => "常量 " + (p.value || "（未填）") },
      {
        key: "code_map",
        label: "枚举字典转换",
        fields: [{ key: "map", label: "对照表", type: "pairs" }, { key: "default", label: "未命中取值", type: "text" }],
        summary: (p) => "字典 " + ((p.map || []).length || 0) + " 条"
      },
      {
        key: "code_map2",
        label: "编码映射",
        fields: [{ key: "map", label: "对照表", type: "pairs" }, { key: "default", label: "未命中取值", type: "text" }],
        summary: (p) => "编码映射 " + ((p.map || []).length || 0) + " 条"
      }
    ]
  }
];

const TYPE_INDEX = {};
STEP_CATEGORIES.forEach((category) => {
  category.types.forEach((type) => {
    TYPE_INDEX[type.key] = { ...type, category: category.key, categoryLabel: category.label };
  });
});

export function stepType(key) {
  return TYPE_INDEX[key] || null;
}

export function stepDefaults(key) {
  const type = TYPE_INDEX[key];
  if (!type) return {};
  const params = {};
  (type.fields || []).forEach((field) => {
    if (field.type === "condition") params[field.key] = null;
    else if (field.type === "cases") params[field.key] = [];
    else if (field.type === "pairs") params[field.key] = [];
    else if (field.type === "fields") params[field.key] = [];
    else if (field.default !== undefined) params[field.key] = field.default;
    else params[field.key] = "";
  });
  return params;
}

export function stepSummary(step) {
  const type = TYPE_INDEX[step.type];
  if (!type) return step.type || "";
  try {
    return type.summary ? type.summary(step.params || {}) : type.label;
  } catch (err) {
    return type.label;
  }
}

export function newStep(key) {
  const type = TYPE_INDEX[key];
  return {
    id: "step_" + Date.now() + "_" + Math.floor(Math.random() * 1000),
    type: key,
    category: type ? type.category : "",
    name: type ? type.label : key,
    enabled: true,
    params: stepDefaults(key)
  };
}

export function stepCategoryLabel(key) {
  const type = TYPE_INDEX[key];
  return type ? type.categoryLabel : "";
}

function isEmpty(value) {
  return value === null || value === undefined || value === "";
}

function toNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (isEmpty(value)) return null;
  const text = String(value).replace(/,/g, "").trim();
  const num = Number(text);
  return Number.isFinite(num) ? num : null;
}

function fieldValue(name, value, sample) {
  if (!name || name === "$value") return value;
  return sample ? sample[name] : undefined;
}

function compare(actual, op, expected) {
  const a = actual;
  const b = expected;
  if (op === "exists") return !isEmpty(a);
  if (op === "is_null") return isEmpty(a);
  if (op === "eq") return String(a ?? "") === String(b ?? "");
  if (op === "neq") return String(a ?? "") !== String(b ?? "");
  if (op === "in") return Array.isArray(b) ? b.map(String).includes(String(a ?? "")) : String(b ?? "").split(",").map((item) => item.trim()).includes(String(a ?? ""));
  if (op === "not_in") return !compare(a, "in", b);
  if (op === "contains") return String(a ?? "").includes(String(b ?? ""));
  const na = toNumber(a);
  const nb = toNumber(b);
  if (na == null || nb == null) return false;
  if (op === "gt") return na > nb;
  if (op === "gte") return na >= nb;
  if (op === "lt") return na < nb;
  if (op === "lte") return na <= nb;
  return false;
}

export function conditionMatches(condition, value, sample) {
  if (!condition || typeof condition !== "object") return false;
  if (Array.isArray(condition.all)) return condition.all.every((item) => conditionMatches(item, value, sample));
  if (Array.isArray(condition.any)) return condition.any.some((item) => conditionMatches(item, value, sample));
  if (condition.not) return !conditionMatches(condition.not, value, sample);
  if (!condition.field) return false;
  const actual = fieldValue(condition.field, value, sample);
  return compare(actual, condition.op || "eq", condition.match);
}

function formatDate(value, pattern) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("无法解析日期：" + value);
  const pad = (n) => String(n).padStart(2, "0");
  return String(pattern || "YYYY-MM-DD")
    .replace(/YYYY/g, String(date.getFullYear()))
    .replace(/MM/g, pad(date.getMonth() + 1))
    .replace(/DD/g, pad(date.getDate()))
    .replace(/HH/g, pad(date.getHours()))
    .replace(/mm/g, pad(date.getMinutes()))
    .replace(/ss/g, pad(date.getSeconds()));
}

function pairMap(pairs) {
  const map = {};
  (pairs || []).forEach((pair) => {
    if (pair && pair.from !== undefined && pair.from !== "") map[String(pair.from)] = pair.to;
  });
  return map;
}

export function runStep(step, value, sample) {
  const params = step.params || {};
  let next = value;
  switch (step.type) {
    case "clean_null":
      if (isEmpty(value)) next = params.mode === "default" ? params.default : params.mode === "null" ? null : value;
      break;
    case "clean_default":
      if (isEmpty(value)) next = params.default ?? "";
      break;
    case "clean_outlier": {
      const num = toNumber(value);
      if (num == null) break;
      const min = params.min === "" || params.min == null ? null : Number(params.min);
      const max = params.max === "" || params.max == null ? null : Number(params.max);
      const outside = (min != null && num < min) || (max != null && num > max);
      if (!outside) break;
      if (params.action === "null") next = null;
      else if (params.action === "default") next = params.default ?? "";
      else next = Math.min(max == null ? num : max, Math.max(min == null ? num : min, num));
      break;
    }
    case "clean_trim":
      if (typeof value === "string") next = params.mode === "left" ? value.replace(/^\s+/, "") : params.mode === "right" ? value.replace(/\s+$/, "") : value.trim();
      break;
    case "convert_type":
      if (params.to === "number") {
        const num = toNumber(value);
        if (num == null && !isEmpty(value)) throw new Error("不能转为数值：" + value);
        next = num;
      } else if (params.to === "boolean") {
        next = value === true || String(value).toLowerCase() === "true" || String(value) === "1";
      } else if (params.to === "date") {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) throw new Error("不能转为日期：" + value);
        next = date.toISOString().slice(0, 10);
      } else next = value == null ? "" : String(value);
      break;
    case "date_format":
      next = formatDate(value, params.to);
      break;
    case "precision": {
      const num = toNumber(value);
      if (num == null) break;
      const factor = Math.pow(10, Number(params.digits) || 0);
      next = params.rounding === "floor" ? Math.floor(num * factor) / factor : params.rounding === "ceil" ? Math.ceil(num * factor) / factor : Math.round(num * factor) / factor;
      break;
    }
    case "unit_convert": {
      const num = toNumber(value);
      if (num == null) break;
      next = num * Number(params.factor ?? 1) + Number(params.offset ?? 0);
      break;
    }
    case "cond_if":
    case "cond_multi":
    case "cond_assign":
      next = conditionMatches(params.when, value, sample) ? params.then : (params.otherwise !== undefined ? params.otherwise : value);
      break;
    case "case_when": {
      let matched = false;
      (params.cases || []).forEach((item) => {
        if (matched) return;
        if (conditionMatches(item.when, value, sample)) {
          next = item.value;
          matched = true;
        }
      });
      if (!matched && params.default !== undefined) next = params.default;
      break;
    }
    case "calc_arith": {
      const left = toNumber(value);
      const right = params.operandField ? toNumber(fieldValue(params.operandField, value, sample)) : toNumber(params.operandValue);
      if (left == null || right == null) throw new Error("操作数不是数值");
      if (params.op === "+") next = left + right;
      else if (params.op === "-") next = left - right;
      else if (params.op === "*") next = left * right;
      else if (params.op === "/") {
        if (right === 0) throw new Error("除数为 0");
        next = left / right;
      }
      break;
    }
    case "calc_percent": {
      const num = toNumber(value);
      const base = params.baseField ? toNumber(fieldValue(params.baseField, value, sample)) : toNumber(params.baseValue);
      if (num == null || base == null || base === 0) throw new Error("分母不是有效数值");
      next = params.mode === "ratio" ? num / base : (num / base) * 100;
      break;
    }
    case "calc_round": {
      const num = toNumber(value);
      if (num == null) break;
      const factor = Math.pow(10, Number(params.digits) || 0);
      next = Math.round(num * factor) / factor;
      break;
    }
    case "calc_floor": {
      const num = toNumber(value);
      next = num == null ? value : Math.floor(num);
      break;
    }
    case "calc_ceil": {
      const num = toNumber(value);
      next = num == null ? value : Math.ceil(num);
      break;
    }
    case "text_substr":
      next = value == null ? value : String(value).substr(Number(params.start) || 0, params.length === "" || params.length == null ? undefined : Number(params.length));
      break;
    case "text_replace":
      next = value == null ? value : String(value).split(params.from || "").join(params.to || "");
      break;
    case "text_concat":
      next = (params.fields || []).map((name) => {
        const item = fieldValue(name, value, sample);
        return item == null ? "" : String(item);
      }).join(params.separator || "");
      break;
    case "text_case":
      next = value == null ? value : (params.mode === "lower" ? String(value).toLowerCase() : String(value).toUpperCase());
      break;
    case "const_value":
      next = params.value;
      break;
    case "code_map":
    case "code_map2": {
      const map = pairMap(params.map);
      const key = String(value ?? "");
      next = Object.prototype.hasOwnProperty.call(map, key) ? map[key] : (params.default !== undefined && params.default !== "" ? params.default : value);
      break;
    }
    default:
      break;
  }
  return next;
}

export function runLink(link, sample) {
  const steps = (link.steps || []).filter((step) => step.enabled !== false);
  const records = [];
  let value = ((link.sources || [link.source])[0]);
  value = sample ? sample[value] : undefined;
  let ok = true;
  let error = "";
  let failedIndex = -1;
  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    const before = value;
    try {
      value = runStep(step, value, sample || {});
      records.push({ index: i, id: step.id, name: step.name, type: step.type, enabled: true, before: before, after: value, ok: true, error: "" });
    } catch (err) {
      ok = false;
      error = err.message;
      failedIndex = i;
      records.push({ index: i, id: step.id, name: step.name, type: step.type, enabled: true, before: before, after: null, ok: false, error: err.message });
      break;
    }
  }
  return { ok: ok, records: records, output: value, error: error, failedIndex: failedIndex };
}

export function validateStep(step) {
  const type = TYPE_INDEX[step.type];
  if (!type) return ["未知的处理类型：" + step.type];
  const issues = [];
  (type.fields || []).forEach((field) => {
    if (field.showWhen) {
      const key = Object.keys(field.showWhen)[0];
      if ((step.params || {})[key] !== field.showWhen[key]) return;
    }
    const value = (step.params || {})[field.key];
    if (field.type === "condition" && (!value || !value.field)) issues.push("「" + field.label + "」还没有配置完整");
    if (field.type === "cases" && (!Array.isArray(value) || !value.length)) issues.push("「" + field.label + "」至少需要一条分支");
    if (field.type === "pairs" && (!Array.isArray(value) || !value.length)) issues.push("「" + field.label + "」至少需要一条对照");
  });
  return issues;
}

export function validateLink(link, sourceFields, targetDefs) {
  const issues = [];
  const sources = link.sources && link.sources.length ? link.sources : [link.source];
  if (!targetDefs[link.target]) issues.push("目标字段 " + link.target + " 不存在");
  sources.forEach((name) => {
    if (!sourceFields[name]) issues.push("源字段 " + name + " 不存在");
  });
  if (link.mappingType === "composite" && sources.length < 2) issues.push("组合映射至少需要两个源字段");
  if (!link.mappingType) issues.push("还没有选择映射方式");
  (link.steps || []).forEach((step, index) => {
    validateStep(step).forEach((item) => issues.push("步骤 " + (index + 1) + "（" + step.name + "）：" + item));
  });
  const target = targetDefs[link.target];
  if (target && sources.length === 1 && sourceFields[sources[0]] && target.type && sourceFields[sources[0]].type) {
    const sourceType = sourceFields[sources[0]].type;
    const typed = ["string", "number", "date", "boolean"].includes(sourceType);
    if (typed && sourceType !== target.type && ["number", "date", "boolean"].includes(target.type) && !(link.steps || []).length) {
      issues.push("源字段 " + sources[0] + " 是 " + sourceType + "，目标字段 " + link.target + " 是 " + target.type + "，需要增加类型转换步骤");
    }
  }
  return issues;
}

export function engineTransformType(mappingType, steps) {
  if (mappingType === "direct") return "direct";
  if (mappingType === "conditional") return "conditional";
  if (mappingType === "calculation") return "calculation";
  if ((steps || []).some((step) => step.type === "code_map" || step.type === "code_map2")) return "code_mapping";
  return "calculation";
}

export function mappingTypeLabel(key) {
  const item = MAPPING_TYPES.find((type) => type.key === key);
  return item ? item.label : key || "未设置";
}

export { CONDITION_OPS, NULL_MODES };
