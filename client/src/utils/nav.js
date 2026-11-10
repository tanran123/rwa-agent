export const NAV = [
  { id: "home", label: "总览", path: "/" },
  {
    id: "config",
    label: "规则配置",
    items: [
      { id: "versions", label: "监管规则版本", path: "/versions" },
      { id: "orgs", label: "机构", path: "/orgs" }
    ]
  },
  {
    id: "run",
    label: "任务运行",
    items: [
      { id: "tasks", label: "任务工作台", path: "/tasks" },
      { id: "wizard", label: "计量向导", path: "/wizard" },
      { id: "engine", label: "底稿计算", path: "/engine" },
      { id: "results", label: "结果明细", path: "/results" }
    ]
  },
  {
    id: "system",
    label: "系统管理",
    items: [
      { id: "sys-users", label: "用户管理", path: "/system/users" },
      { id: "sys-roles", label: "角色管理", path: "/system/roles" },
      { id: "sys-perms", label: "权限管理", path: "/system/permissions" },
      { id: "sys-logs", label: "操作日志", path: "/system/logs" },
      { id: "sys-llm", label: "大模型配置", path: "/system/llm" },
      { id: "sys-tokens", label: "Token 调用", path: "/system/tokens" }
    ]
  }
];

const PARENT = {
  "/clauses": "/versions",
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

/** 菜单 id 与路由 path 的对应，供登录后的菜单权限过滤和路由守卫使用。 */
export const MENU_BY_PATH = {
  "/": "home",
  "/versions": "versions",
  "/orgs": "orgs",
  "/tasks": "tasks",
  "/wizard": "wizard",
  "/engine": "engine",
  "/results": "results",
  "/system/users": "sys-users",
  "/system/roles": "sys-roles",
  "/system/permissions": "sys-perms",
  "/system/logs": "sys-logs",
  "/system/llm": "sys-llm",
  "/system/tokens": "sys-tokens"
};

export function menuIdFor(path) {
  const p = menuPath(path);
  if (MENU_BY_PATH[p]) return MENU_BY_PATH[p];
  if (p.indexOf("/tasks") === 0) return "tasks";
  if (p.indexOf("/versions") === 0) return "versions";
  return "";
}
