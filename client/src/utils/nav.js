export const NAV = [
  { id: "home", label: "总览", path: "/" },
  {
    id: "config",
    label: "规则配置",
    items: [
      { label: "监管规则版本", path: "/versions" },
      { label: "机构", path: "/orgs" },
      { label: "监管条款库", path: "/clauses" },
      { label: "产品标准字段", path: "/fields" },
      { label: "暴露分类规则", path: "/tree" },
      { label: "EAD 计算规则", path: "/ead" },
      { label: "信用风险缓释", path: "/crm-config" }
    ]
  },
  {
    id: "run",
    label: "计量执行",
    items: [
      { label: "计量向导", path: "/wizard" },
      { label: "结果明细", path: "/results" }
    ]
  }
];

const PARENT = {
  "/params": "/versions",
  "/mappings": "/fields",
  "/exposure": "/generic",
  "/crm": "/generic",
  "/weights": "/tree",
  "/ead-on": "/ead",
  "/ead-off": "/ead",
  "/engine": "/wizard",
  "/batches": "/results",
  "/export": "/results"
};

export function menuPath(path) {
  if (String(path || "").indexOf("/tree") === 0) return "/tree";
  return PARENT[path] || path;
}
