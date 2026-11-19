// 分类规则 + 风险权重规则的分层决策流程图布局。
// 三列：分类树 → exposure_class 结果 → 权重树；同一列内自上而下，第一条命中即生效。
// 只做展示，不改规则 JSON。

import { contextOf, nodeView, resultText } from "./ruleMap";

const NODE_W = 286;
const NODE_H = 96;
const HUB_W = 204;
const HUB_H = 70;
const GAP = 28;
const INDENT = 22;
const TOP_GAP = 42;
const COL_START = 24;
const COL_CLS = 252;
const COL_HUB_GAP = 104;
const COL_W_GAP = 116;

function orderText(index, total) {
  return (index + 1) + " / " + total;
}

function mergeRefs(base, extra, titles) {
  const list = [];
  (base || []).forEach((item) => {
    if (item && item.id) list.push({ id: item.id, title: item.title || (titles && titles[item.id]) || "" });
  });
  extra.forEach((id) => {
    if (!list.some((item) => item.id === id)) list.push({ id: id, title: (titles && titles[id]) || "" });
  });
  return list;
}

function refsFromFields(fieldNames, doc) {
  const tables = new Set();
  const lists = new Set();
  const definitions = {};
  ((doc && doc.fields) || []).forEach((field) => { if (field && field.name) definitions[field.name] = field; });
  const addBindings = (bindings) => (bindings || []).forEach((item) => {
    if (item && item.list_id) lists.add(item.list_id);
    if (item && Array.isArray(item.exclude_list_ids)) item.exclude_list_ids.forEach((id) => lists.add(id));
  });
  (fieldNames || []).forEach((name) => {
    const field = definitions[name];
    if (!field) return;
    (field.parameter_refs || []).forEach((id) => tables.add(id));
    const scanCondition = (condition) => {
      if (!condition || typeof condition !== "object") return;
      if (condition.param_ref) tables.add(String(condition.param_ref).split("#")[0]);
      if (condition.list_check) {
        addBindings(condition.list_check.include);
        addBindings(condition.list_check.exclude);
      }
      (condition.all || []).forEach(scanCondition);
      (condition.any || []).forEach(scanCondition);
      if (condition.not) scanCondition(condition.not);
    };
    const derivation = field.derivation;
    if (derivation) {
      if (derivation.table_id) tables.add(derivation.table_id);
      if (derivation.bands_table) tables.add(derivation.bands_table);
      if (derivation.parameter_ref) tables.add(String(derivation.parameter_ref).split("#")[0]);
      (derivation.parameter_refs || []).forEach((id) => tables.add(id));
      scanCondition(derivation.when);
      (derivation.cases || []).forEach((item) => scanCondition(item.when));
      if (derivation.kind === "list_membership") {
        addBindings(derivation.include);
        addBindings(derivation.exclude);
      }
      if (derivation.kind === "list_lookup") {
        (derivation.map || []).forEach((item) => addBindings([item]));
      }
    }
    if (field.prepared) (field.prepared.parameter_refs || []).forEach((id) => tables.add(id));
  });
  return { tables: tables, lists: lists };
}

function collectConditionFields(condition, set) {
  if (!condition || typeof condition !== "object") return;
  if (condition.field) set.add(condition.field);
  (condition.all || []).forEach((item) => collectConditionFields(item, set));
  (condition.any || []).forEach((item) => collectConditionFields(item, set));
  if (condition.not) collectConditionFields(condition.not, set);
}

function collectValueFields(value, set) {
  if (typeof value === "string" && value.startsWith("$input.")) {
    const name = value.slice(7).split(".")[0];
    if (name) set.add(name);
  }
}

export function fieldsOfNode(raw) {
  const set = new Set();
  (raw.fields || []).forEach((name) => set.add(name));
  collectConditionFields(raw.when, set);
  (raw.adjustments || []).forEach((item) => {
    collectConditionFields(item.when, set);
    (item.ladder || []).forEach((step) => collectConditionFields(step.when, set));
  });
  const scan = (value) => {
    if (value == null) return;
    if (Array.isArray(value)) { value.forEach(scan); return; }
    if (typeof value === "object") {
      Object.keys(value).forEach((key) => scan(value[key]));
      return;
    }
    collectValueFields(value, set);
  };
  scan(raw.result);
  scan(raw.set);
  scan(raw.parameter_lookup);
  return Array.from(set).filter(Boolean);
}

export function expandableWeightIds(weight) {
  const ids = [];
  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node.children) && node.children.length) ids.push(node.id);
    (node.children || []).forEach(walk);
    if (node.otherwise && node.otherwise.id) walk(node.otherwise);
  };
  ((weight && weight.rules) || []).forEach(walk);
  return ids;
}

export function routeEdgePath(a, b, inSlot, outSlot) {
  if (!a || !b) return null;
  if (a.stage === "start" && b.stage === "weight") {
    const x1 = a.x + a.w / 2;
    const y1 = a.y;
    const x2 = b.x + b.w / 2;
    const y2 = b.y;
    const top = Math.max(26, Math.min(y1, y2) - 26);
    return { d: "M" + x1 + "," + y1 + " L" + x1 + "," + top + " L" + x2 + "," + top + " L" + x2 + "," + y2, lx: (x1 + x2) / 2, ly: top + 12 };
  }
  if (b.x >= a.x + a.w + 8) {
    const x1 = a.x + a.w;
    const y1 = outSlot && outSlot.count > 1
      ? a.y + a.h * (outSlot.index + 1) / (outSlot.count + 1)
      : a.y + a.h / 2;
    const x2 = b.x;
    const y2 = inSlot && inSlot.count > 1
      ? b.y + b.h * (inSlot.index + 1) / (inSlot.count + 1)
      : b.y + b.h / 2;
    const mx = x1 + Math.max(36, (x2 - x1) / 2);
    return { d: "M" + x1 + "," + y1 + " L" + mx + "," + y1 + " L" + mx + "," + y2 + " L" + x2 + "," + y2, lx: mx, ly: (y1 + y2) / 2 - 6 };
  }
  const x1 = a.x + a.w / 2;
  const y1 = a.y + a.h;
  const x2 = b.x + b.w / 2;
  const y2 = b.y;
  const mid = y1 + Math.max(14, (y2 - y1) / 2);
  return { d: "M" + x1 + "," + y1 + " L" + x1 + "," + mid + " L" + x2 + "," + mid + " L" + x2 + "," + y2, lx: (x1 + x2) / 2, ly: mid - 6 };
}

export function layoutDecisionFlow(options) {
  const classification = options.classification || {};
  const weight = options.weight || {};
  const expandedSet = new Set(options.expanded || []);
  const clsCtx = contextOf(classification, options.tables, options.lists);
  const wCtx = contextOf(weight, options.tables, options.lists);
  const tableTitles = {};
  (options.tables || []).forEach((item) => { if (item && item.tableId) tableTitles[item.tableId] = item.title || ""; });
  const listTitles = {};
  (options.lists || []).forEach((item) => { if (item && item.listId) listTitles[item.listId] = item.title || ""; });

  const nodes = [];
  const edges = [];
  const details = {};
  const byId = {};
  const producers = [];
  let seq = 0;

  function addNode(input) {
    const id = input.prefix + "_" + String(input.rawId || input.id || "").replace(/[^A-Za-z0-9_]/g, "_") + (input.suffix ? "_" + input.suffix : "");
    let unique = id;
    while (byId[unique]) unique = id + "_" + (++seq);
    const node = {
      id: unique,
      stage: input.stage,
      documentKind: input.documentKind || "",
      rawId: input.rawId || "",
      title: input.title || "",
      badge: input.badge || "",
      condition: input.condition || "",
      result: input.result || "",
      manual: !!input.manual,
      expandable: !!input.expandable,
      open: !!input.open,
      childCount: input.childCount || 0,
      tables: input.tables || [],
      lists: input.lists || [],
      fields: input.fields || [],
      x: input.x,
      y: input.y,
      w: input.w,
      h: input.h,
      raw: input.raw || null,
      view: input.view || null
    };
    nodes.push(node);
    byId[unique] = node;
    details[unique] = {
      stage: node.stage,
      documentKind: node.documentKind,
      id: node.rawId || node.title,
      label: input.detailLabel || node.title,
      view: node.view,
      raw: node.raw,
      childIds: [],
      tables: node.tables,
      lists: node.lists,
      fields: node.fields,
      expandable: node.expandable,
      expanded: node.open,
      code: input.code || "",
      producers: input.producers || [],
      weightRules: input.weightRules || []
    };
    return node;
  }

  function pushEdge(from, to, label, kind, dashed) {
    edges.push({ from: from, to: to, label: label || "", kind: kind || "", dashed: !!dashed });
  }

  // ---------------------------------------------------------------- 分类树

  function placeCls(raw, index, total, depth, y) {
    const view = nodeView(raw, "exposure_classification", clsCtx);
    const nodeFields = fieldsOfNode(raw);
    const fieldRefs = refsFromFields(nodeFields, classification);
    const node = addNode({
      prefix: "C",
      rawId: raw.id,
      stage: "classification",
      documentKind: "exposure_classification",
      title: raw.label || raw.id,
      badge: depth ? "分类 · 细分" : "分类 " + orderText(index, total),
      condition: view.whenText,
      result: view.resultText,
      tables: mergeRefs(view.tables, fieldRefs.tables, tableTitles),
      lists: mergeRefs(view.lists, fieldRefs.lists, listTitles),
      fields: nodeFields,
      x: COL_CLS + depth * INDENT,
      y: y,
      w: NODE_W - depth * INDENT,
      h: NODE_H,
      raw: raw,
      view: view
    });
    if (raw.result && raw.result.exposure_class) {
      producers.push({
        nodeId: node.id,
        rawId: raw.id,
        label: raw.label,
        className: raw.result.exposure_class,
        classLabel: raw.result.label || raw.result.exposure_class,
        y: y + NODE_H / 2,
        otherwise: false
      });
    }
    let exit = node.id;
    let cursor = y + NODE_H + GAP;
    const kids = (raw.children || []).slice();
    if (raw.otherwise && raw.otherwise.id) kids.push(raw.otherwise);
    kids.forEach((kid, kidIndex) => {
      const isElse = kid === raw.otherwise && raw.otherwise.id;
      const placed = placeCls(kid, kidIndex, kids.length, depth + 1, cursor);
      if (kidIndex === 0) {
        pushEdge(node.id, placed.id, isElse ? "否则" : "成立，继续细分", isElse ? "fallback" : "branch", isElse);
      } else {
        pushEdge(exit, placed.id, "否则", "fallback", true);
      }
      exit = placed.exit;
      cursor = placed.bottom + GAP;
    });
    if (raw.otherwise && !raw.otherwise.id && raw.otherwise.exposure_class) {
      producers.push({
        nodeId: exit,
        rawId: raw.id + "·否则",
        label: raw.otherwise.label || "否则",
        className: raw.otherwise.exposure_class,
        classLabel: raw.otherwise.label || raw.otherwise.exposure_class,
        y: y + NODE_H / 2,
        otherwise: true
      });
    }
    return { id: node.id, exit: exit, bottom: cursor - GAP };
  }

  const clsRules = classification.rules || [];
  const universalCount = (weight.rules || []).filter((raw) => classesOf(raw).length === 0).length;
  const clsStartY = 40 + universalCount * (NODE_H + GAP) + Math.max(0, (NODE_H - HUB_H) / 2);
  let cursorY = clsStartY;
  let lastTopExit = "";
  clsRules.forEach((raw, index) => {
    const placed = placeCls(raw, index, clsRules.length, 0, cursorY);
    if (index === 0) {
      const start = addNode({
        prefix: "START",
        rawId: "INPUT",
        stage: "start",
        title: "输入：标准化暴露记录",
        badge: "① 输入",
        condition: "按分类规则自上而下判断，第一条成立的规则生效。",
        x: COL_START,
        y: cursorY + (NODE_H - 96) / 2,
        w: 176,
        h: 96
      });
      pushEdge(start.id, placed.id, "开始分类", "start", false);
      details[start.id] = { stage: "start", label: "输入：标准化暴露记录", view: null, raw: null, childIds: [] };
    } else {
      pushEdge(lastTopExit, placed.id, "", "fallback", true);
    }
    lastTopExit = placed.exit;
    cursorY = placed.bottom + TOP_GAP;
  });

  // ---------------------------------------------------------------- 分类结果

  const classGroups = new Map();
  producers.forEach((item) => {
    if (!classGroups.has(item.className)) classGroups.set(item.className, []);
    classGroups.get(item.className).push(item);
  });
  if (classification.otherwise && classification.otherwise.exposure_class) {
    const code = classification.otherwise.exposure_class;
    if (!classGroups.has(code)) classGroups.set(code, []);
    classGroups.get(code).push({
      nodeId: lastTopExit,
      rawId: "OTHERWISE",
      label: classification.otherwise.label || "其他暴露",
      className: code,
      classLabel: classification.otherwise.label || code,
      y: 40,
      otherwise: true
    });
  }
  const hubX = COL_CLS + NODE_W + INDENT + COL_HUB_GAP;
  const hubList = [];
  let hubY = clsStartY;
  Array.from(classGroups.entries()).forEach(([code, list]) => {
    const average = list.reduce((sum, item) => sum + item.y, 0) / Math.max(1, list.length);
    const y = Math.max(average - HUB_H / 2, hubY);
    const node = addNode({
      prefix: "HUB",
      rawId: code,
      stage: "class",
      title: code,
      detailLabel: list[0].classLabel || code,
      badge: "exposure_class",
      code: code,
      condition: list[0].classLabel || code,
      x: hubX,
      y: y,
      w: HUB_W,
      h: HUB_H,
      producers: list.map((item) => ({ id: item.rawId, label: item.label, otherwise: item.otherwise, nodeId: item.nodeId })),
      weightRules: []
    });
    list.forEach((item) => {
      if (byId[item.nodeId]) pushEdge(item.nodeId, node.id, item.otherwise ? "否则归入" : "归入", "result", false);
    });
    hubList.push(node);
    hubY = y + HUB_H + GAP;
  });

  // ---------------------------------------------------------------- 权重树

  function classesOf(raw) {
    const values = [];
    const walk = (condition) => {
      if (!condition || typeof condition !== "object") return;
      if (condition.field === "exposure_class") {
        if (condition.op === "eq" && condition.match != null) values.push(condition.match);
        if (condition.op === "in" && Array.isArray(condition.match)) values.push(...condition.match);
      }
      (condition.all || []).forEach(walk);
      (condition.any || []).forEach(walk);
      if (condition.not) walk(condition.not);
    };
    walk(raw.when);
    return Array.from(new Set(values));
  }

  function placeWeight(raw, index, total, depth, y) {
    const view = nodeView(raw, "risk_weight", wCtx);
    const nodeFields = fieldsOfNode(raw);
    const fieldRefs = refsFromFields(nodeFields, weight);
    const open = expandedSet.has(raw.id);
    const kids = (raw.children || []).slice();
    const manual = !!(raw.result && raw.result.risk_weight === null);
    const node = addNode({
      prefix: "W",
      rawId: raw.id,
      stage: "weight",
      documentKind: "risk_weight",
      title: raw.label || raw.id,
      badge: depth ? "权重 · 细分" : "权重 " + orderText(index, total),
      condition: view.whenText,
      result: view.resultText,
      tables: mergeRefs(view.tables, fieldRefs.tables, tableTitles),
      lists: mergeRefs(view.lists, fieldRefs.lists, listTitles),
      fields: nodeFields,
      manual: manual,
      expandable: kids.length > 0,
      open: open && kids.length > 0,
      childCount: kids.length,
      x: COL_CLS + NODE_W + INDENT + COL_HUB_GAP + HUB_W + COL_W_GAP + depth * INDENT,
      y: y,
      w: NODE_W - depth * INDENT,
      h: NODE_H,
      raw: raw,
      view: view
    });
    let exit = node.id;
    let cursor = y + NODE_H + GAP;
    if (open) {
      const list = kids.slice();
      if (raw.otherwise && raw.otherwise.id) list.push(raw.otherwise);
      list.forEach((kid, kidIndex) => {
        const isElse = kid === raw.otherwise && raw.otherwise.id;
        const placed = placeWeight(kid, kidIndex, list.length, depth + 1, cursor);
        if (kidIndex === 0) pushEdge(node.id, placed.id, isElse ? "否则" : "成立，继续细分", isElse ? "fallback" : "branch", isElse);
        else pushEdge(exit, placed.id, "否则", "fallback", true);
        exit = placed.exit;
        cursor = placed.bottom + GAP;
      });
      if (raw.otherwise && !raw.otherwise.id && raw.otherwise.risk_weight !== undefined) {
        const elseNode = addNode({
          prefix: "W_ELSE",
          rawId: raw.id + "_ELSE",
          stage: "weight",
          documentKind: "risk_weight",
          title: "否则",
          badge: "权重 · 否则",
          result: resultText(raw.otherwise, "risk_weight", wCtx),
          manual: raw.otherwise.risk_weight === null,
          x: COL_CLS + NODE_W + INDENT + COL_HUB_GAP + HUB_W + COL_W_GAP + (depth + 1) * INDENT,
          y: cursor,
          w: NODE_W - (depth + 1) * INDENT,
          h: NODE_H,
          raw: raw.otherwise,
          view: { whenText: "以上子规则都不成立", resultText: resultText(raw.otherwise, "risk_weight", wCtx), tables: [], lists: [], adjustments: [] }
        });
        pushEdge(exit, elseNode.id, "否则", "fallback", true);
        exit = elseNode.id;
        cursor = cursor + NODE_H + GAP;
      }
    }
    return { id: node.id, exit: exit, bottom: cursor - GAP };
  }

  const weightRules = weight.rules || [];
  const hubCenter = new Map();
  hubList.forEach((hub) => hubCenter.set(details[hub.id].code, hub.y + HUB_H / 2));
  let weightCursor = 40;
  const rootNodes = [];
  const rootPlans = weightRules.map((raw, index) => {
    const classes = classesOf(raw);
    const centers = classes.map((code) => hubCenter.get(code)).filter((value) => value != null);
    const desired = centers.length ? centers.reduce((sum, value) => sum + value, 0) / centers.length : 40;
    return { raw: raw, index: index, classes: classes, desired: desired };
  }).sort((a, b) => a.desired - b.desired || a.index - b.index);
  rootPlans.forEach((plan) => {
    const y = Math.max(weightCursor, plan.desired - NODE_H / 2);
    const placed = placeWeight(plan.raw, plan.index, weightRules.length, 0, y);
    rootNodes.push({ raw: plan.raw, rootId: placed.id, classes: plan.classes });
    weightCursor = placed.bottom + GAP;
  });

  const rootByClass = new Map();
  rootNodes.forEach((item) => {
    item.classes.forEach((code) => {
      if (!rootByClass.has(code)) rootByClass.set(code, []);
      rootByClass.get(code).push(item);
    });
  });

  let weightOtherwiseNode = null;
  if (weight.otherwise) {
    weightOtherwiseNode = addNode({
      prefix: "W_OTHERWISE",
      rawId: "OTHERWISE",
      stage: "weight",
      documentKind: "risk_weight",
      title: weight.otherwise.label || "权重规则未命中",
      badge: "权重 · 兜底",
      condition: "以上权重规则全部不成立",
      result: resultText(weight.otherwise, "risk_weight", wCtx),
      manual: weight.otherwise.risk_weight === null,
      x: COL_CLS + NODE_W + INDENT + COL_HUB_GAP + HUB_W + COL_W_GAP,
      y: weightCursor,
      w: NODE_W,
      h: NODE_H,
      raw: weight.otherwise,
      view: { whenText: "以上权重规则全部不成立", resultText: resultText(weight.otherwise, "risk_weight", wCtx), tables: [], lists: [], adjustments: [] }
    });
    const lastRoot = rootNodes[rootNodes.length - 1];
    if (lastRoot) {
      const lastNode = byId[lastRoot.rootId];
      if (lastNode) pushEdge(lastNode.id, weightOtherwiseNode.id, "全部不成立", "fallback", true);
    }
  }

  // 类别 → 权重规则
  const startNode = nodes.find((node) => node.stage === "start");
  hubList.forEach((hub) => {
    const detail = details[hub.id];
    const roots = rootByClass.get(detail.code) || [];
    detail.weightRules = roots.map((item) => ({ id: item.raw.id, label: item.raw.label, graphId: item.rootId }));
    if (!roots.length && weightOtherwiseNode) {
      pushEdge(hub.id, weightOtherwiseNode.id, "无对应权重规则", "handoff", true);
    }
    roots.forEach((item) => {
      pushEdge(hub.id, item.rootId, "", "handoff", false);
    });
    hub.result = roots.length ? "→ " + roots.length + " 条权重规则" : "→ 转人工复核";
  });

  // 无类别条件的权重规则从输入直接进入
  rootNodes.filter((item) => !item.classes.length).forEach((item) => {
    if (startNode) pushEdge(startNode.id, item.rootId, "全局覆盖", "handoff", true);
  });

  // 子节点元信息
  nodes.forEach((node) => {
    const detail = details[node.id];
    if (!detail || !detail.raw) return;
    const kids = [];
    (detail.raw.children || []).forEach((child) => {
      if (child && child.id) kids.push(child.id);
    });
    if (detail.raw.otherwise && detail.raw.otherwise.id) kids.push(detail.raw.otherwise.id);
    detail.childIds = kids;
  });

  // 路径与画布尺寸
  let width = 0;
  let height = 0;
  nodes.forEach((node) => {
    width = Math.max(width, node.x + node.w);
    height = Math.max(height, node.y + node.h);
  });
  const incoming = new Map();
  const outgoing = new Map();
  edges.forEach((edge) => {
    if (!incoming.has(edge.to)) incoming.set(edge.to, []);
    incoming.get(edge.to).push(edge);
    if (!outgoing.has(edge.from)) outgoing.set(edge.from, []);
    outgoing.get(edge.from).push(edge);
  });
  incoming.forEach((list) => {
    list.sort((a, b) => (byId[a.from] ? byId[a.from].y : 0) - (byId[b.from] ? byId[b.from].y : 0));
    list.forEach((edge, index) => { edge.inSlot = { index: index, count: list.length }; });
  });
  outgoing.forEach((list) => {
    list.sort((a, b) => (byId[a.to] ? byId[a.to].y : 0) - (byId[b.to] ? byId[b.to].y : 0));
    list.forEach((edge, index) => { edge.outSlot = { index: index, count: list.length }; });
  });
  const paths = edges.map((edge) => {
    const routed = routeEdgePath(byId[edge.from], byId[edge.to], edge.inSlot, edge.outSlot);
    return routed ? { ...edge, ...routed } : null;
  }).filter(Boolean);

  return {
    nodes,
    edges: paths,
    details,
    size: { w: width + 40, h: height + 40 },
    stats: {
      classification: nodes.filter((node) => node.stage === "classification").length,
      classes: hubList.length,
      weight: nodes.filter((node) => node.stage === "weight").length,
      expanded: expandedSet.size,
      edges: paths.length,
      manual: nodes.filter((node) => node.manual).length
    }
  };
}
