export const NAV = [
  { id: "home", label: "总览", path: "/" },
  {
    id: "config",
    label: "规则配置",
    items: [
      { label: "监管规则版本", path: "/versions" },
      { label: "监管条款库", path: "/clauses" },
      { label: "产品标准字段", path: "/fields" }
    ]
  },
  { id: "class", label: "暴露分类规则", path: "/tree" },
  {
    id: "ead",
    label: "EAD 计算规则",
    items: [
      { label: "表内 EAD", path: "/ead-on" },
      { label: "表外 EAD", path: "/ead-off" }
    ]
  },
  {
    id: "run",
    label: "计量执行",
    items: [
      { label: "计量向导", path: "/wizard" },
      { label: "结果明细", path: "/results" },
      { label: "计量批次", path: "/batches" },
      { label: "审计底稿", path: "/export" }
    ]
  }
];

const PARENT = {
  "/params": "/versions",
  "/mappings": "/fields",
  "/exposure": "/generic",
  "/crm": "/generic",
  "/weights": "/tree",
  "/ccf": "/ead-off",
  "/engine": "/wizard"
};

export function menuPath(path) {
  if (String(path || "").indexOf("/tree") === 0) return "/tree";
  return PARENT[path] || path;
}
