import { labelBook, summarizeWhen, whenKey } from "./ruleText";

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

function bookOf(doc) {
  const fields = [...(doc && doc.fields ? doc.fields : [])];
  function walk(node) {
    if (!node || typeof node !== "object") return;
    (node.fields || []).forEach((field) => fields.push(field));
    (node.children || []).forEach(walk);
    if (node.otherwise && typeof node.otherwise === "object") walk(node.otherwise);
  }
  (doc && doc.rules ? doc.rules : []).forEach(walk);
  if (doc && doc.otherwise && typeof doc.otherwise === "object") walk(doc.otherwise);
  (doc && doc.extensions ? doc.extensions : []).forEach((item) => {
    (item.fields || []).forEach((field) => fields.push(field));
    (item.children || []).forEach(walk);
  });
  return labelBook(fields);
}

function chartWhen(rule, book, otherwise, top) {
  if (top) return "以上全部未命中";
  const key = whenKey(rule && rule.when);
  const items = key ? rule.when[key] : null;
  if (!key || (Array.isArray(items) && !items.length)) return otherwise ? "其余情形" : "以上规则均未命中时";
  const text = summarizeWhen(rule.when, book);
  return text && text !== "—" ? text : "其余情形";
}

function shapeOf(rule, kids) {
  if (kids.length) return "judge";
  const weight = rule && rule.weight;
  if (weight && (weight.same_as || Array.isArray(weight.greater_of))) return "ref";
  return "weight";
}

function mermaidText(text) {
  return String(text == null ? "" : text)
    .replace(/&/g, " ")
    .replace(/[<>]/g, " ")
    .replace(/"/g, "'")
    .replace(/[[\]{}|#]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function wrapMermaid(text, size) {
  const clean = mermaidText(text);
  if (clean.length <= size) return clean;
  const lines = [];
  clean.split("，").forEach((piece, index, all) => {
    const clause = piece + (index < all.length - 1 ? "，" : "");
    if (!clause) return;
    if (clause.length <= size) {
      lines.push(clause);
      return;
    }
    let buf = "";
    for (let i = 0; i < clause.length; i++) {
      if (clause[i] === "或" && clause[i + 1] === "「" && buf.length >= 8) {
        lines.push(buf);
        buf = "";
      }
      buf += clause[i];
    }
    if (buf) lines.push(buf);
  });
  return lines.join("<br/>");
}

function refCaption(rule) {
  const weight = rule && rule.weight;
  if (weight && weight.same_as) return "→ 参照 " + weight.same_as;
  if (weight && Array.isArray(weight.greater_of)) {
    const fields = weight.greater_of.map((item) => {
      if (item && item.field) return item.field;
      if (typeof item === "number") return String(item);
      return "";
    }).filter(Boolean);
    return "→ 参照 " + (fields.join("、") || "greater_of");
  }
  return "→ 参照";
}

function classStmt(ids, name) {
  const lines = [];
  for (let i = 0; i < ids.length; i += 30) {
    lines.push("    class " + ids.slice(i, i + 30).join(",") + " " + name + ";");
  }
  return lines;
}

export function toMermaid(doc, changedNames) {
  const book = bookOf(doc || {});
  const rules = (doc && doc.rules ? doc.rules : []).map((rule) => ({ rule, otherwise: false, edge: rule.edge }));
  if (doc && doc.otherwise && typeof doc.otherwise === "object") {
    rules.push({ rule: doc.otherwise, otherwise: true, top: true });
  }
  (doc && doc.extensions ? doc.extensions : []).forEach((item, index) => {
    rules.push({
      rule: {
        name: "extension_" + index,
        label: "银行自定义扩展",
        children: item.children || [],
        attach_to: item.attach_to
      },
      otherwise: false,
      edge: item.attach_to ? "挂在 " + item.attach_to : "银行自定义扩展"
    });
  });
  const rootLine = doc && doc.rootLabel
    ? mermaidText(doc.rootLabel) + "<br/>按下列顺序依次判定<br/>首个命中者即适用"
    : "信用风险暴露<br/>按下列顺序依次判定<br/>首个命中者即适用";
  const lines = [
    "%% 由分类规则机械推导生成 —— 请勿手工编辑",
    "flowchart LR",
    "    ROOT([\"" + rootLine + "\"])",
    ""
  ];
  const judge = [];
  const weight = [];
  const ref = [];
  const changed = [];
  const mark = {};
  (changedNames || []).forEach((name) => { mark[name] = true; });
  const lookup = {};
  let seq = 0;

  function walk(list, parentId, depth, parentPath) {
    list.forEach((entry, index) => {
      const kids = childrenOf(entry.rule);
      const id = "N" + (seq += 1);
      const shape = shapeOf(entry.rule, kids);
      const label = mermaidText(entry.rule.label || entry.rule.name || "");
      const path = parentId === "ROOT"
        ? (entry.top ? ">otherwise" : "/" + index + ":" + (entry.rule.name || ""))
        : parentPath + "/" + (entry.otherwise ? "otherwise" : index + ":" + (entry.rule.name || ""));
      lookup[id] = {
        node: entry.rule,
        path,
        depth: depth + 1,
        index: entry.otherwise ? -1 : index,
        fallback: !!entry.otherwise
      };
      const edited = !!mark[entry.rule.name];
      if (shape === "judge") {
        lines.push("    " + id + "{{\"" + label + "\"}}");
        (edited ? changed : judge).push(id);
      } else if (shape === "ref") {
        lines.push("    " + id + "[/\"" + label + "<br/>" + mermaidText(refCaption(entry.rule)) + "\"/]");
        (edited ? changed : ref).push(id);
      } else {
        lines.push("    " + id + "[\"" + label + "<br/><b>" + mermaidText(weightText(entry.rule) || "权重未单列") + "</b>\"]");
        (edited ? changed : weight).push(id);
      }
      const edge = wrapMermaid(entry.edge || chartWhen(entry.rule, book, entry.otherwise, entry.top), 28);
      const arrow = parentId === "ROOT" ? "-.->" : "-->";
      lines.push("    " + parentId + " " + arrow + "|\"" + edge + "\"| " + id);
      lines.push("");
      if (kids.length) walk(kids, id, depth + 1, path);
    });
  }

  walk(rules, "ROOT", 0, "");
  lines.push("    classDef root fill:#e8eef8,stroke:#3b6cb5,stroke-width:2px,color:#1e3a5f;");
  lines.push("    classDef judge fill:#dbeafe,stroke:#3b82f6,stroke-width:2px,color:#1e3a8a;");
  lines.push("    classDef weight fill:#d1fae5,stroke:#059669,stroke-width:2px,color:#065f46;");
  lines.push("    classDef ref fill:#fef3c7,stroke:#d97706,stroke-width:2px,color:#78350f;");
  lines.push("    classDef changed fill:#ffedd5,stroke:#ea580c,stroke-width:4px,color:#9a3412;");
  lines.push("    class ROOT root;");
  classStmt(judge, "judge").forEach((line) => lines.push(line));
  classStmt(weight, "weight").forEach((line) => lines.push(line));
  classStmt(ref, "ref").forEach((line) => lines.push(line));
  classStmt(changed, "changed").forEach((line) => lines.push(line));
  return {
    mmd: lines.join("\n"),
    rules: doc && doc.rules ? doc.rules.length : 0,
    leaves: weight.length + ref.length + changed.length,
    changed,
    lookup
  };
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
