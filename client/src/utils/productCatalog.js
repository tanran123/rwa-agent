// 产品目录的展示信息和配置指标，产品卡片页和产品配置工作台共用。
import { validateStep } from "@/utils/mappingSteps";

export const FAMILY_META = {
  LOAN: { name: "贷款产品", category: "贷款类", icon: "贷", color: "#0f766e", desc: "一般贷款、按揭、项目融资等" },
  BOND: { name: "债券产品", category: "债券类", icon: "债", color: "#1d4ed8", desc: "政府、金融、公司债券等" },
  INTERBANK: { name: "同业与存款", category: "存款类", icon: "存", color: "#7c3aed", desc: "同业存放、拆放、央行存款等" },
  SFT: { name: "证券融资", category: "其他产品", icon: "融", color: "#b45309", desc: "回购、逆回购、证券借贷等" },
  DERIVATIVE: { name: "衍生工具", category: "其他产品", icon: "衍", color: "#be123c", desc: "利率、汇率、信用衍生工具" },
  EQUITY: { name: "股权与资本工具", category: "其他产品", icon: "股", color: "#0e7490", desc: "上市/非上市股权、资本工具" },
  OFF_BALANCE: { name: "表外业务", category: "其他产品", icon: "表", color: "#4d7c0f", desc: "承诺、担保、信用证等" },
  TREASURY: { name: "资金与结算", category: "其他产品", icon: "资", color: "#475569", desc: "现金、黄金、待结算项目" }
};

export const STATUS_META = {
  draft: { label: "草稿", className: "draft" },
  configuring: { label: "配置中", className: "configuring" },
  registered: { label: "已注册", className: "registered" },
  error: { label: "配置异常", className: "error" }
};

export function familyMeta(family) {
  return FAMILY_META[family] || { name: family + " 产品", category: "其他产品", icon: "产", color: "#64748b", desc: "" };
}

export function uniqueSources(body) {
  const set = new Set();
  ((body && body.mappings) || []).forEach((item) => { if (item && item.source_field) set.add(item.source_field); });
  return set;
}

export function mappingTargetSet(body) {
  const set = new Set();
  ((body && body.mappings) || []).forEach((item) => { if (item && item.target_field) set.add(item.target_field); });
  return set;
}

export function structuralIssues(body) {
  let count = 0;
  const seen = new Set();
  ((body && body.mappings) || []).forEach((item) => {
    if (!item || !item.source_field || !item.target_field) count += 1;
    if (item && item.target_field) {
      if (seen.has(item.target_field)) count += 1;
      seen.add(item.target_field);
    }
    const steps = (item && item.transform && item.transform.parameters && item.transform.parameters.steps) || [];
    steps.forEach((step) => { if (validateStep(step).length) count += 1; });
  });
  return count;
}

export function productStatus(body) {
  if (!body || !(body.mappings || []).length) return "draft";
  if (structuralIssues(body)) return "error";
  if (body.status === "APPROVED") return "registered";
  return "configuring";
}

export function matchedRuleCount(doc, targets) {
  if (!doc || !targets.size) return 0;
  let count = 0;
  (doc.rules || []).forEach((rule) => {
    let hit = false;
    const walk = (node) => {
      if (hit || !node) return;
      if ((node.fields || []).some((field) => targets.has(field))) {
        hit = true;
        return;
      }
      (node.children || []).forEach(walk);
      if (node.otherwise && node.otherwise.id) walk(node.otherwise);
    };
    walk(rule);
    if (hit) count += 1;
  });
  return count;
}

export function matchedRules(doc, targets) {
  const result = [];
  if (!doc) return result;
  (doc.rules || []).forEach((rule) => {
    const matched = new Set();
    const walk = (node) => {
      if (!node || typeof node !== "object") return;
      (node.fields || []).forEach((field) => { if (targets.has(field)) matched.add(field); });
      (node.children || []).forEach(walk);
      if (node.otherwise && node.otherwise.id) walk(node.otherwise);
    };
    walk(rule);
    if (matched.size) result.push({ id: rule.id, label: rule.label, fields: Array.from(matched) });
  });
  return result;
}
