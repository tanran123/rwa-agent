export const CAPITAL_LINKS = [
  { label: "产品标准字段", path: "/fields", desc: "规则写字段 name，不写 Excel 表头；标准字段和知识库字段都在这里维护。" },
  { label: "暴露分类规则", path: "/tree", desc: "按通用分类、产品线路和缓释维护这一版的暴露分类与风险权重。" },
  { label: "EAD 计算规则", path: "/ead", desc: "按产品配置表内或表外，同一产品二者互斥；表外转换系数同页维护。" },
  { label: "信用风险缓释", path: "/crm-config", desc: "按产品绑定缓释字段，并维护合格缓释物字典。" },
  { label: "监管条款库", path: "/clauses", desc: "条款原文和引用它的规则放在同一张表里。" },
  { label: "共用参数", path: "/params", desc: "多条规则共用的门槛；评级百分比在权重表里改。" }
];

export const LIQUIDITY_LINKS = [
  { label: "HQLA 计算任务", path: "/hqla", desc: "按任务组织明细、清单、判定标准与结论。" }
];

// 页内页签和子页都指回菜单里的那一项。
const ALIAS = {
  "/mappings": "/fields",
  "/generic": "/tree",
  "/exposure": "/tree",
  "/crm": "/tree",
  "/weights": "/tree",
  "/product-rules": "/tree",
  "/ead-on": "/ead",
  "/ead-off": "/ead",
  "/ccf": "/ead"
};

export function ruleLinkActive(current, path) {
  const at = String(current || "");
  if (at === path || at.indexOf(path + "/") === 0) return true;
  return ALIAS[at] === path;
}
