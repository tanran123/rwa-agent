export const NAV = [
  { id: "home", label: "总览", path: "/" },
  {
    id: "config",
    label: "规则配置",
    items: [
      { label: "监管规则版本", path: "/versions" },
      { label: "机构", path: "/orgs" },
      { label: "监管条款库", path: "/clauses" }
    ]
  },
  {
    id: "run",
    label: "任务运行",
    items: [
      { label: "任务工作台", path: "/tasks" },
      { label: "计量向导", path: "/wizard" },
      { label: "底稿计算", path: "/engine" },
      { label: "结果明细", path: "/results" }
    ]
  }
];

const PARENT = {
  "/params": "/versions",
  "/mappings": "/versions",
  "/fields": "/versions",
  "/exposure": "/versions",
  "/generic": "/versions",
  "/crm": "/versions",
  "/crm-config": "/versions",
  "/weights": "/versions",
  "/product-rules": "/versions",
  "/assistant": "/versions",
  "/ead": "/versions",
  "/ead-on": "/versions",
  "/ead-off": "/versions",
  "/ccf": "/versions",
  "/batches": "/results",
  "/export": "/results"
};

export function menuPath(path) {
  const p = String(path || "");
  if (p.indexOf("/tree") === 0) return "/versions";
  if (p.indexOf("/tasks/") === 0) return "/tasks";
  if (p.indexOf("/hqla") === 0) return "/tasks";
  if (p.indexOf("/versions") === 0) return "/versions";
  return PARENT[p] || p;
}
