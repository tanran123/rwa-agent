function ratio(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  const pct = Math.round(n * 100000) / 1000;
  return (pct % 1 === 0 ? String(pct) : String(pct)) + "%";
}

function whenItems(when) {
  if (!when) return [];
  if (Array.isArray(when)) return when;
  if (Array.isArray(when.all)) return when.all;
  if (Array.isArray(when.any)) return when.any;
  if (when.field) return [when];
  return [];
}

function assessmentText(rule) {
  const hit = whenItems(rule && rule.when).find((item) => item && item.field === "assessment_count");
  if (!hit) return "";
  const n = hit.match != null ? hit.match : hit.value;
  if ((hit.op || "eq") === "eq" && Number(n) === 1) return "用该评级";
  if ((hit.op || "eq") === "eq" && Number(n) === 2) return "用较高权重";
  if (hit.op === "gte") return "两个较低里较高的一个";
  return "按评级个数取值";
}

function roleOf(rule) {
  const id = String((rule && (rule.name || rule.id)) || "");
  if (id.indexOf("crm_") === 0 || rule.formula || rule.covered || rule.collateral_value_factor != null) return "crm";
  if (id.indexOf("multiple_assessments") === 0 || rule.pick || whenItems(rule.when).some((item) => item && item.field === "assessment_count")) return "assessment";
  return "";
}

export function weightText(rule) {
  if (!rule || typeof rule !== "object") return "";
  if (typeof rule.value === "number") return ratio(rule.value);
  if (rule.value != null && rule.value !== "" && typeof rule.value !== "object") return String(rule.value);
  const weight = rule.weight;
  if (weight && weight.same_as) return "按交易对手";
  if (weight && Array.isArray(weight.greater_of)) {
    let floor = null;
    let field = "";
    weight.greater_of.forEach((item) => {
      if (typeof item === "number") floor = item;
      else if (item && item.field) field = item.field;
    });
    if (field) return (floor == null ? "" : ratio(floor) + " ") + "与已得权重较大值";
    return ratio(floor == null ? 0.9 : floor) + " 与交易对手较大值";
  }
  if (rule.collateral_value_factor != null && rule.collateral_value_factor !== "") {
    return "抵押品价值 × " + ratio(rule.collateral_value_factor);
  }
  const assessment = assessmentText(rule);
  if (assessment) return assessment;
  if (Array.isArray(rule.pick)) return "按评级个数取值";
  if (typeof rule.formula === "string" && rule.formula) return "缓释拆分";
  return "";
}

function childrenOf(rule) {
  const kids = (rule.children || []).map((child) => ({ rule: child, otherwise: false }));
  if (rule.otherwise && typeof rule.otherwise === "object") {
    kids.push({ rule: rule.otherwise, otherwise: true });
  }
  return kids;
}

export function countNodes(doc) {
  let total = 0;
  function walk(node) {
    if (!node || typeof node !== "object") return;
    total += 1;
    (node.children || []).forEach(walk);
    if (node.otherwise && typeof node.otherwise === "object") walk(node.otherwise);
  }
  (doc && doc.rules ? doc.rules : []).forEach(walk);
  (doc && doc.extensions ? doc.extensions : []).forEach((item) => (item.children || []).forEach(walk));
  return total;
}

export function layoutDocument(doc) {
  const rules = (doc && doc.rules ? doc.rules : []).map((rule) => ({ rule, otherwise: false }));
  if (doc && doc.otherwise && typeof doc.otherwise === "object") {
    rules.push({ rule: doc.otherwise, otherwise: true });
  }
  const nodes = [];
  const edges = [];
  const COL = 300;
  const ROW = 96;
  const GAP = 10;
  const NODE_W = 232;
  const NODE_H = 74;
  let seq = 0;

  function blockOf(entry) {
    const kids = childrenOf(entry.rule);
    if (!kids.length) return ROW;
    let sum = 0;
    kids.forEach((kid, index) => {
      sum += blockOf(kid);
      if (index < kids.length - 1) sum += GAP;
    });
    return Math.max(sum, ROW);
  }

  function place(list, depth, parentId, yTop) {
    let y = yTop;
    list.forEach((entry, index) => {
      const kids = childrenOf(entry.rule);
      const block = blockOf(entry);
      const id = "n" + (seq += 1);
      const role = roleOf(entry.rule);
      const leaf = !kids.length;
      const weight = weightText(entry.rule);
      const note = leaf
        ? ((entry.otherwise ? "本层都不成立" : "") + (weight ? ((entry.otherwise ? " · " : "") + weight) : (weight || (leaf ? "权重未单列" : ""))))
        : (weight || ((entry.otherwise ? "本层都不成立 · " : "") + kids.length + " 个下级"));
      const badge = role === "crm" ? "缓释" : (role === "assessment" ? "取值" : (depth === 0 ? "分类" : (leaf ? "权重" : "细分")));
      nodes.push({
        id,
        kind: depth === 0 ? "category" : "subclass",
        role,
        badge,
        label: depth === 0 ? ((index + 1) + ". " + (entry.rule.label || entry.rule.name)) : (entry.rule.label || entry.rule.name),
        note: note || (leaf ? "权重未单列" : kids.length + " 个下级"),
        x: 36 + depth * COL,
        y: y + (block - NODE_H) / 2,
        w: NODE_W,
        h: NODE_H
      });
      if (parentId) {
        edges.push({
          from: parentId,
          to: id,
          label: entry.otherwise ? "都不成立" : (index === 0 ? "是" : ""),
          dashed: !!entry.otherwise
        });
      }
      if (kids.length) place(kids, depth + 1, id, y);
      y += block;
      if (index < list.length - 1) y += GAP;
    });
  }

  place(rules, 0, null, 20);
  const tops = nodes.filter((node) => node.kind === "category");
  for (let i = 1; i < tops.length; i += 1) {
    const miss = rules[i] && rules[i].otherwise;
    const side = rules[i] && roleOf(rules[i].rule);
    edges.push({
      from: tops[i - 1].id,
      to: tops[i].id,
      label: miss ? "都不成立" : (side ? "另计" : "否，继续"),
      dashed: !!miss || !side
    });
  }
  return { nodes, edges };
}

export function edgePath(edges, nodes) {
  const byId = {};
  nodes.forEach((node) => { byId[node.id] = node; });
  return edges.map((edge) => {
    const a = byId[edge.from];
    const b = byId[edge.to];
    if (!a || !b) return null;
    const x1 = a.x + a.w;
    const y1 = a.y + a.h / 2;
    const x2 = b.x;
    const y2 = b.y + b.h / 2;
    const d = Math.abs(y1 - y2) < 8
      ? "M" + x1 + "," + y1 + " L" + x2 + "," + y2
      : "M" + x1 + "," + y1 + " L" + ((x1 + x2) / 2) + "," + y1 + " L" + ((x1 + x2) / 2) + "," + y2 + " L" + x2 + "," + y2;
    return { ...edge, d, lx: (x1 + x2) / 2, ly: (y1 + y2) / 2 - 8 };
  }).filter(Boolean);
}
