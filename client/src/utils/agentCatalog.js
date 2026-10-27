export const AGENT_PAGES = [
  { path: "/", title: "首页 / 计量工作台" },
  { path: "/versions", title: "监管规则版本管理" },
  { path: "/orgs", title: "机构" },
  { path: "/params", title: "共用参数" },
  { path: "/clauses", title: "监管条款库" },
  { path: "/fields", title: "产品标准字段管理" },
  { path: "/mappings", title: "字段映射" },
  { path: "/generic", title: "通用暴露分类规则" },
  { path: "/exposure", title: "产品线路" },
  { path: "/crm", title: "信用风险缓释" },
  { path: "/product-rules", title: "产品专属暴露分类规则" },
  { path: "/tree", title: "暴露分类规则" },
  { path: "/weights", title: "风险权重" },
  { path: "/assistant", title: "自然语言规则配置助手" },
  { path: "/ead", title: "EAD 计算规则配置" },
  { path: "/ccf", title: "信用转换系数" },
  { path: "/crm-config", title: "信用风险缓释配置" },
  { path: "/wizard", title: "信用风险 RWA 计量向导" },
  { path: "/engine", title: "底稿计算" },
  { path: "/results", title: "计量结果明细" },
  { path: "/batches", title: "计量批次管理" },
  { path: "/export", title: "Excel 审计底稿导出" }
];

export const AGENT_APIS = [
  "GET /bootstrap",
  "GET /dashboard",
  "GET /orgs",
  "POST /orgs",
  "PUT /orgs/:id",
  "DELETE /orgs/:id",
  "POST /orgs/batch-delete",
  "GET /rule-versions",
  "POST /rule-versions",
  "PUT /rule-versions/:id",
  "DELETE /rule-versions/:id",
  "POST /rule-versions/batch-delete",
  "GET /clauses",
  "POST /clauses",
  "PUT /clauses/:id",
  "DELETE /clauses/:id",
  "POST /clauses/batch-delete",
  "GET /params",
  "POST /params",
  "PUT /params/:id",
  "DELETE /params/:id",
  "POST /params/batch-delete",
  "GET /products",
  "POST /products",
  "PUT /products/:code",
  "DELETE /products/:code",
  "POST /products/batch-delete",
  "GET /products/:code/fields",
  "POST /products/:code/fields",
  "PUT /products/:code/fields/:fieldCode",
  "DELETE /products/:code/fields/:fieldCode",
  "POST /products/:code/fields/batch-delete",
  "GET /field-mappings",
  "POST /field-mappings",
  "PUT /field-mappings/:id",
  "DELETE /field-mappings/:id",
  "POST /field-mappings/batch-delete",
  "GET /exposure-classes",
  "GET /exposure-class",
  "GET /weights",
  "POST /weight-rules",
  "PUT /weight-rules/:id",
  "DELETE /weight-rules/:id",
  "POST /weight-rules/batch-delete",
  "POST /bank-grades",
  "PUT /bank-grades/:id",
  "DELETE /bank-grades/:id",
  "POST /bank-grades/batch-delete",
  "POST /mo-weights",
  "PUT /mo-weights/:id",
  "DELETE /mo-weights/:id",
  "POST /mo-weights/batch-delete",
  "GET /crm",
  "POST /crm",
  "PUT /crm/:id",
  "DELETE /crm/:id",
  "POST /crm/batch-delete",
  "GET /product-rules",
  "POST /product-rules",
  "PUT /product-rules/:id",
  "DELETE /product-rules/:id",
  "POST /product-rules/batch-delete",
  "POST /exposure-tree/propose",
  "POST /exposure-tree/save",
  "POST /exposure-tree/copy",
  "POST /exposure-tree/delete",
  "POST /exposure-tree/provision",
  "GET /exposure-tree/chat",
  "POST /exposure-tree/chat",
  "GET /ead-config",
  "PUT /ead-config",
  "POST /ead-formula/check",
  "POST /ead-trial",
  "GET /ccf",
  "POST /ccf",
  "PUT /ccf/:id",
  "DELETE /ccf/:id",
  "POST /ccf/batch-delete",
  "GET /crm-config",
  "PUT /crm-config",
  "GET /batches",
  "GET /batches/:id",
  "GET /batches/:id/lines",
  "POST /batches",
  "GET /measure",
  "POST /measure/runs",
  "POST /measure/workbook",
  "POST /measure/apply",
  "POST /measure/map",
  "POST /measure/products",
  "POST /measure/classify",
  "GET /working-paper",
  "GET /upload-samples",
  "GET /assistant",
  "POST /rules/chat"
];

const STATUS = ["draft", "reviewing", "published", "superseded", "disabled"];

export const AGENT_FORMS = [
  {
    path: "/params",
    id: "param",
    title: "共用参数",
    fields: [
      { key: "id", label: "编号" },
      { key: "grp", label: "分组" },
      { key: "name", label: "名称" },
      { key: "value", label: "值" },
      { key: "unit", label: "单位" },
      { key: "usedFor", label: "用途" }
    ]
  },
  {
    path: "/orgs",
    id: "org",
    title: "机构",
    fields: [
      { key: "id", label: "编号" },
      { key: "name", label: "名称" },
      { key: "jurisdiction", label: "地区" }
    ]
  },
  {
    path: "/clauses",
    id: "clause",
    title: "监管条款",
    fields: [
      { key: "id", label: "编号" },
      { key: "jurisdiction", label: "地区" },
      { key: "clause", label: "条款编号" },
      { key: "title", label: "标题" },
      { key: "doc", label: "制度" },
      { key: "docVersion", label: "制度版本" },
      { key: "effectiveFrom", label: "生效日期" },
      { key: "source", label: "来源" },
      { key: "scope", label: "适用范围" },
      { key: "text", label: "原文" },
      { key: "refsText", label: "引用规则" }
    ]
  },
  {
    path: "/versions",
    id: "version",
    title: "监管规则版本",
    fields: [
      { key: "id", label: "编号" },
      { key: "jurisdiction", label: "地区" },
      { key: "version", label: "版本编号" },
      { key: "name", label: "规则名称" },
      { key: "ruleType", label: "规则类型" },
      { key: "status", label: "状态", options: STATUS },
      { key: "effectiveFrom", label: "生效日期" },
      { key: "effectiveTo", label: "失效日期" },
      { key: "institution", label: "适用机构" },
      { key: "rulesetFile", label: "规则文件" },
      { key: "publishedAt", label: "发布时间" },
      { key: "author", label: "维护人" },
      { key: "changelog", label: "变更说明" }
    ]
  },
  {
    path: "/fields",
    id: "product",
    title: "产品",
    fields: [
      { key: "code", label: "产品编码" },
      { key: "label", label: "名称" },
      { key: "icon", label: "图标" },
      { key: "color", label: "颜色" },
      { key: "ruleVersion", label: "规则版本" },
      { key: "onboarding", label: "接入方式", options: ["column", "manual"] },
      { key: "sampleCount", label: "样例笔数" },
      { key: "system", label: "来源系统" },
      { key: "desc", label: "说明" }
    ]
  },
  {
    path: "/fields",
    id: "field",
    title: "标准字段",
    fields: [
      { key: "code", label: "字段编码" },
      { key: "name", label: "标准字段名称" },
      { key: "stdField", label: "对应规则字段" },
      { key: "type", label: "数据类型", options: ["number", "enum"] },
      { key: "unit", label: "单位" },
      { key: "required", label: "必填", options: ["true", "false"] },
      { key: "sourceSystem", label: "来源系统" },
      { key: "sourceField", label: "来源字段" },
      { key: "meaning", label: "含义" },
      { key: "transform", label: "转换规则" },
      { key: "validate", label: "校验规则" },
      { key: "optionsText", label: "枚举取值" },
      { key: "refsText", label: "被引用条款" }
    ]
  },
  {
    path: "/mappings",
    id: "mapping",
    title: "字段映射",
    fields: [
      { key: "product", label: "产品" },
      { key: "status", label: "状态", options: ["ok", "warn", "missing"] },
      { key: "stdField", label: "标准字段" },
      { key: "stdCode", label: "标准编码" },
      { key: "srcSystem", label: "源系统" },
      { key: "srcField", label: "源字段" },
      { key: "hitRate", label: "命中率" },
      { key: "via", label: "转换" },
      { key: "sample", label: "样例" }
    ]
  },
  {
    path: "/ccf",
    id: "ccf",
    title: "转换系数",
    fields: [
      { key: "id", label: "编号" },
      { key: "pri", label: "优先级" },
      { key: "type", label: "类型" },
      { key: "ccf", label: "系数" },
      { key: "cond", label: "条件" },
      { key: "condsText", label: "附加条件" }
    ]
  },
  {
    path: "/crm",
    id: "crm-rule",
    title: "缓释规则",
    fields: [
      { key: "id", label: "编号" },
      { key: "pri", label: "优先级" },
      { key: "type", label: "类型" },
      { key: "substitute", label: "覆盖部分", options: ["collateral", "guarantor", "provider"] },
      { key: "floorParam", label: "底线参数" },
      { key: "tool", label: "合格工具" },
      { key: "constraints", label: "不计入，对象里用 maturity、currency、correlation" }
    ]
  },
  {
    path: "/weights",
    id: "weight-rule",
    title: "权重规则",
    fields: [
      { key: "id", label: "编号" },
      { key: "pri", label: "优先级" },
      { key: "cls", label: "大类" },
      { key: "bank", label: "档" },
      { key: "rw", label: "权重" },
      { key: "cond", label: "条件" },
      { key: "basis", label: "依据" }
    ]
  },
  {
    path: "/weights",
    id: "bank-grade",
    title: "第一档银行评级",
    fields: [
      { key: "id", label: "编号" },
      { key: "pri", label: "优先级" },
      { key: "label", label: "情形" },
      { key: "paramId", label: "参数" },
      { key: "basis", label: "依据" },
      { key: "weightsText", label: "权重" },
      { key: "idsText", label: "规则编号" }
    ]
  },
  {
    path: "/weights",
    id: "mo-weight",
    title: "澳门评级档",
    fields: [
      { key: "id", label: "编号" },
      { key: "bucket", label: "类别" },
      { key: "weightsText", label: "权重" },
      { key: "note", label: "说明" }
    ]
  },
  {
    path: "/exposure",
    id: "exposure-rule",
    title: "产品线路",
    fields: [
      { key: "id", label: "编号" },
      { key: "product", label: "产品" },
      { key: "name", label: "规则编码" },
      { key: "label", label: "规则" },
      { key: "priority", label: "顺序" },
      { key: "status", label: "状态", options: STATUS },
      { key: "version", label: "规则版本" },
      { key: "clause", label: "条款" },
      { key: "targetClass", label: "暴露大类" },
      { key: "targetSub", label: "子类" },
      { key: "weight", label: "权重" },
      { key: "when", label: "条件" }
    ]
  },
  {
    path: "/product-rules",
    id: "product-rule",
    title: "产品专属规则",
    fields: [
      { key: "id", label: "编号" },
      { key: "product", label: "产品" },
      { key: "name", label: "规则编码" },
      { key: "label", label: "规则" },
      { key: "priority", label: "顺序" },
      { key: "status", label: "状态", options: STATUS },
      { key: "version", label: "规则版本" },
      { key: "clause", label: "条款" },
      { key: "targetClass", label: "暴露大类" },
      { key: "targetSub", label: "子类" },
      { key: "weight", label: "权重" },
      { key: "when", label: "条件" }
    ]
  },
  {
    path: "/ead",
    id: "ead-rule",
    title: "EAD 规则",
    fields: [
      { key: "name", label: "规则名称" },
      { key: "condition", label: "规则说明" },
      { key: "formula", label: "公式" },
      { key: "ccf", label: "系数" },
      { key: "precision", label: "计算精度（小数位）" },
      { key: "rounding", label: "舍入规则", options: ["四舍五入", "向上取整", "向下取整"] },
      { key: "clause", label: "关联监管条款" },
      { key: "resultField", label: "结果字段" },
      { key: "status", label: "状态", options: ["draft", "published"] }
    ]
  },
  {
    path: "/crm-config",
    id: "crm-reason",
    title: "缓释说明",
    fields: [{ key: "reason", label: "无需配置的说明" }]
  },
  {
    path: "/crm-config",
    id: "crm-slot",
    title: "缓释字段绑定",
    fields: [
      { key: "maxSlots", label: "最多支持笔数" },
      { key: "crm_type", label: "第 1 笔缓释物类型" },
      { key: "crm_value", label: "第 1 笔考虑错配折扣后的价值" },
      { key: "crm_weight", label: "第 1 笔缓释物对应的风险权重" }
    ]
  },
  {
    path: "/crm-config",
    id: "crm-type",
    title: "合格缓释物",
    fields: [
      { key: "code", label: "编码" },
      { key: "name", label: "名称" },
      { key: "note", label: "监管依据" }
    ]
  }
];

const PAGE_API = {
  "/": ["/bootstrap", "/dashboard"],
  "/orgs": ["/orgs"],
  "/versions": ["/rule-versions"],
  "/params": ["/params"],
  "/clauses": ["/clauses"],
  "/fields": ["/products"],
  "/mappings": ["/field-mappings"],
  "/exposure": ["/product-rules", "/products"],
  "/product-rules": ["/product-rules", "/products"],
  "/crm": ["/crm"],
  "/weights": ["/weights", "/weight-rules", "/bank-grades", "/mo-weights"],
  "/ead": ["/ead-config", "/ead-formula/check", "/ead-trial"],
  "/ccf": ["/ccf"],
  "/crm-config": ["/crm-config"]
};

export function apisFor(path) {
  const prefixes = PAGE_API[path] || [];
  return AGENT_APIS.filter((line) => {
    const target = line.slice(line.indexOf(" ") + 1);
    return prefixes.some((prefix) => target === prefix || target.startsWith(prefix + "/"));
  });
}
