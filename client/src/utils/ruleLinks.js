export const CAPITAL_LINKS = [
  { label: "敞口划分", path: "/exposure-config", desc: "先确定分类规则与风险权重规则，以及它们引用的参数表和监管名单。" },
  { label: "产品标准字段", path: "/product-config", desc: "再登记产品组、产品代码和标准字段，并把字段映射到敞口划分使用的字段。" },
  { label: "EAD 计算规则", path: "/ead", desc: "按产品配置表内或表外，同一产品二者互斥；表外转换系数同页维护。" },
  { label: "信用风险缓释", path: "/crm-config", desc: "按产品绑定缓释字段，并维护合格缓释物字典。" },
  { label: "监管条款库", path: "/clauses", desc: "条款原文和引用它的规则放在同一张表里。" }
];

export const LIQUIDITY_LINKS = [
  { label: "流动性产品管理", path: "/liquidity-config", desc: "注册 LCR 产品，确定侧别、来源系统和标准字段，并维护每个产品的规则范围。" },
  { label: "清单与参数", path: "/liquidity-params", desc: "维护 HQLA 折扣率、现金流入/流出率、上限参数和监管名单。" },
  { label: "HQLA 计算任务", path: "/hqla", desc: "七步计量：基本信息 → 数据导入 → 产品识别 → 字段 Mapping → 质量检查 → 计算 → 复核输出。" }
];

// 页内页签和子页都指回菜单里的那一项。
const ALIAS = {
  "/mappings": "/product-config",
  "/fields": "/product-config",
  "/generic": "/exposure-config",
  "/exposure": "/exposure-config",
  "/crm": "/tree",
  "/weights": "/exposure-config",
  "/product-rules": "/exposure-config",
  "/tree": "/exposure-config",
  "/ead-on": "/ead",
  "/ead-off": "/ead",
  "/ccf": "/ead",
  "/liquidity-products": "/liquidity-config"
};

export function ruleLinkActive(current, path) {
  const at = String(current || "");
  if (at === path || at.indexOf(path + "/") === 0) return true;
  return ALIAS[at] === path;
}
