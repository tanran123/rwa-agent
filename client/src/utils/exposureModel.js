// 把分类规则集、权重规则集、参数表和名单整理成全景图 / 分类矩阵 / 决策流程需要的模型。
import { contextOf, nodeRefs, nodeView } from "@/utils/ruleMap";
import { fieldsOfNode } from "@/utils/decisionFlow";
import {
  STC_LANE_GROUPS, STC_LANE_ORDER, STC_CLASS_ORDER, classLaneLabel, stcLaneAvailable
} from "@/utils/exposureLanes";

function walkNodes(nodes, visit, parent) {
  (nodes || []).forEach((node) => {
    if (!node || typeof node !== "object") return;
    visit(node, parent);
    walkNodes(node.children, visit, node);
    if (node.otherwise && node.otherwise.id) walkNodes([node.otherwise], visit, node);
  });
}

function classValuesOf(condition, values) {
  if (!condition || typeof condition !== "object") return;
  if (condition.field === "exposure_class") {
    if (condition.op === "eq" && condition.match != null) values.push(condition.match);
    if (condition.op === "in" && Array.isArray(condition.match)) values.push(...condition.match);
  }
  (condition.all || []).forEach((item) => classValuesOf(item, values));
  (condition.any || []).forEach((item) => classValuesOf(item, values));
  if (condition.not) classValuesOf(condition.not, values);
}

function classSetOf(node) {
  const values = [];
  classValuesOf(node.when, values);
  return Array.from(new Set(values));
}

function fieldRefs(fieldNames, doc) {
  const tables = new Set();
  const lists = new Set();
  const definitions = {};
  ((doc && doc.fields) || []).forEach((field) => { if (field && field.name) definitions[field.name] = field; });
  const addBindings = (bindings) => (bindings || []).forEach((item) => {
    if (item && item.list_id) lists.add(item.list_id);
    if (item && Array.isArray(item.exclude_list_ids)) item.exclude_list_ids.forEach((id) => lists.add(id));
  });
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
  (fieldNames || []).forEach((name) => {
    const field = definitions[name];
    if (!field) return;
    (field.parameter_refs || []).forEach((id) => tables.add(id));
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
      if (derivation.kind === "list_lookup") (derivation.map || []).forEach((item) => addBindings([item]));
    }
    if (field.prepared) (field.prepared.parameter_refs || []).forEach((id) => tables.add(id));
  });
  return { tables: Array.from(tables), lists: Array.from(lists) };
}

function tableRefsOf(node, doc) {
  const refs = nodeRefs(node);
  const fields = fieldsOfNode(node);
  return unique(Array.from(refs.tables || []).concat(fieldRefs(fields, doc).tables));
}

function listRefsOf(node, doc) {
  const refs = nodeRefs(node);
  const fields = fieldsOfNode(node);
  return unique(Array.from(refs.lists || []).concat(fieldRefs(fields, doc).lists));
}

function collectDescendants(ids, nodeMap) {
  const out = [];
  const walk = (id) => {
    const node = nodeMap[id];
    if (!node) return;
    out.push(id);
    (node.children || []).forEach(walk);
  };
  (ids || []).forEach(walk);
  return out;
}

function unique(list) {
  return Array.from(new Set(list));
}

function weightOutputs(weightIds, nodeMap) {
  const items = [];
  const seen = new Set();
  const add = (kind, id, text) => {
    if (!id || seen.has(kind + "\u0000" + id)) return;
    seen.add(kind + "\u0000" + id);
    items.push({ kind: kind, id: id, text: text });
  };
  weightIds.forEach((id) => {
    const node = nodeMap[id];
    if (!node) return;
    const result = (node.json && node.json.result) || {};
    const attributes = result.attributes || {};
    if (typeof node.rw === "number") add("fixed", node.rw + "%", node.rw + "%");
    else if (node.rw === null) add("fixed", "MANUAL", "人工复核");
    const tableIds = [];
    if (attributes.table_id) tableIds.push(attributes.table_id);
    if (result.table_id) tableIds.push(result.table_id);
    if (result.parameter_table) tableIds.push(result.parameter_table);
    (attributes.table_ids || []).forEach((tableId) => tableIds.push(tableId));
    tableIds.filter(Boolean).forEach((tableId) => add("table", tableId, tableId));
  });
  return {
    items: items,
    texts: items.map((item) => item.text),
    weights: items.filter((item) => item.kind === "fixed").map((item) => item.text),
    tables: items.filter((item) => item.kind === "table").map((item) => item.id)
  };
}

export function buildExposureModel(classification, weight, tableMeta, listMeta) {
  const clsDoc = classification || {};
  const wDoc = weight || {};
  const clsCtx = contextOf(clsDoc, tableMeta, listMeta);
  const wCtx = contextOf(wDoc, tableMeta, listMeta);
  const tableMap = {};
  (tableMeta || []).forEach((item) => { if (item && item.tableId) tableMap[item.tableId] = item; });
  const listMap = {};
  (listMeta || []).forEach((item) => { if (item && item.listId) listMap[item.listId] = item; });

  const nodes = {};
  const topClsIds = [];
  const topRwIds = [];
  let clsCount = 0;
  let rwCount = 0;

  walkNodes(clsDoc.rules, (raw, parent) => {
    const view = nodeView(raw, "exposure_classification", clsCtx);
    const id = raw.id;
    if (!id) return;
    if (!parent) topClsIds.push(id);
    nodes[id] = {
      id: id,
      kind: "cls",
      label: raw.label || id,
      parent: parent ? parent.id : "",
      children: [],
      whenText: view.whenText,
      resultText: view.resultText,
      cls: (raw.result && raw.result.exposure_class) || "",
      rw: "",
      note: raw.note || "",
      basis: view.basis || "",
      fields: fieldsOfNode(raw),
      tableIds: tableRefsOf(raw, clsDoc),
      listIds: listRefsOf(raw, clsDoc),
      adjustments: view.adjustments || [],
      json: raw
    };
    clsCount += 1;
  });
  Object.keys(nodes).forEach((id) => {
    const parent = nodes[id].parent;
    if (parent && nodes[parent]) nodes[parent].children.push(id);
  });

  walkNodes(wDoc.rules, (raw, parent) => {
    const view = nodeView(raw, "risk_weight", wCtx);
    const id = raw.id;
    if (!id) return;
    if (!parent) topRwIds.push(id);
    const result = raw.result || {};
    const hasRw = Object.prototype.hasOwnProperty.call(result, "risk_weight");
    nodes[id] = {
      id: id,
      kind: "rw",
      label: raw.label || id,
      parent: parent ? parent.id : "",
      children: [],
      whenText: view.whenText,
      resultText: view.resultText,
      cls: "",
      rw: hasRw ? result.risk_weight : "",
      note: raw.note || "",
      basis: view.basis || "",
      fields: fieldsOfNode(raw),
      tableIds: tableRefsOf(raw, wDoc),
      listIds: listRefsOf(raw, wDoc),
      adjustments: view.adjustments || [],
      json: raw
    };
    rwCount += 1;
  });
  Object.keys(nodes).forEach((id) => {
    const node = nodes[id];
    if (node.kind !== "rw" || !node.parent || !nodes[node.parent]) return;
    nodes[node.parent].children.push(id);
  });

  const weightRoots = topRwIds.map((id) => ({ id: id, classes: classSetOf(nodes[id].json) }));
  const rootByClass = new Map();
  weightRoots.forEach((root) => {
    root.classes.forEach((code) => {
      if (!rootByClass.has(code)) rootByClass.set(code, []);
      rootByClass.get(code).push(root.id);
    });
  });
  const universalWeightRoots = weightRoots.filter((root) => !root.classes.length).map((root) => root.id);
  const universalByClass = {};
  collectDescendants(universalWeightRoots, nodes).forEach((id) => {
    if (universalWeightRoots.includes(id)) return;
    classSetOf(nodes[id].json).forEach((code) => {
      if (!universalByClass[code]) universalByClass[code] = [];
      universalByClass[code].push(id);
    });
  });

  const classProducers = new Map();
  Object.keys(nodes).forEach((id) => {
    const node = nodes[id];
    if (node.kind !== "cls" || !node.cls) return;
    if (!classProducers.has(node.cls)) classProducers.set(node.cls, []);
    classProducers.get(node.cls).push(id);
  });

  function topAncestor(id) {
    let node = nodes[id];
    while (node && node.parent) node = nodes[node.parent];
    return node || null;
  }

  const overlayClasses = new Set(["OUT_OF_SCOPE", "CAPITAL_DEDUCTION"]);
  const overlayIds = [];
  topClsIds.forEach((id) => {
    const node = nodes[id];
    if (overlayClasses.has(node.cls)) overlayIds.push(id);
  });
  universalWeightRoots.forEach((id) => overlayIds.push(id));
  const overlaySet = new Set(overlayIds);

  function buildLane(def) {
    const s2 = (def.s2 || []).filter((id) => nodes[id]);
    const s3 = (def.s3 || []).filter((id) => nodes[id]);
    const clsIds = unique(s2.concat(s3).flatMap((id) => collectDescendants([id], nodes)));
    const classes = unique(clsIds.map((nodeId) => nodes[nodeId].cls).filter(Boolean));
    const weightRootIds = def.s4
      ? unique(def.s4.filter((id) => nodes[id]))
      : unique(classes.flatMap((code) => rootByClass.get(code) || []));
    const weightIds = collectDescendants(weightRootIds, nodes);
    const outputs = weightOutputs(weightIds, nodes);
    const tableIds = outputs.tables.slice();
    const fields = unique(
      clsIds.flatMap((nodeId) => nodes[nodeId].fields)
        .concat(weightIds.flatMap((nodeId) => nodes[nodeId].fields))
    );
    return {
      key: def.key,
      title: def.title,
      desc: def.desc,
      entry: def.entry || "无附加入口条件",
      s2: s2,
      s3: s3,
      s4: weightRootIds,
      s5: outputs.texts,
      outputs: outputs,
      clsIds: clsIds,
      weightIds: weightIds,
      classes: classes,
      tables: tableIds,
      fields: fields,
      counts: {
        cls: clsIds.length,
        rw: weightIds.length,
        fields: fields.length,
        tables: tableIds.length
      }
    };
  }

  let lanes = [];
  const useStcLanes = stcLaneAvailable(nodes);
  if (useStcLanes) {
    lanes = STC_LANE_GROUPS.map((def) => buildLane(def));
  } else {
    const laneTopIds = topClsIds.filter((id) => !overlaySet.has(id));
    lanes = laneTopIds.map((id) => {
      const top = nodes[id];
      return buildLane({
        key: id,
        title: top.label,
        desc: top.whenText || "无附加入口条件",
        entry: top.whenText || "无附加入口条件",
        s2: [id],
        s3: top.children.slice(),
        s4: null
      });
    });
  }

  const classCodes = unique(Object.keys(nodes).filter((id) => nodes[id].kind === "cls" && nodes[id].cls).map((id) => nodes[id].cls));
  const classRank = (code) => {
    const index = STC_CLASS_ORDER.indexOf(code);
    return index < 0 ? STC_CLASS_ORDER.length : index;
  };
  classCodes.sort((a, b) => classRank(a) - classRank(b));

  const matrix = classCodes.map((code) => {
    const clsIds = classProducers.get(code) || [];
    const first = nodes[clsIds[0]];
    const top = first ? topAncestor(clsIds[0]) : null;
    const topLane = top ? STC_LANE_GROUPS.find((group) => group.s2.includes(top.id)) : null;
    const weightRootIds = rootByClass.get(code) || [];
    const weightIds = unique(
      (universalByClass[code] || [])
        .concat(collectDescendants(weightRootIds, nodes))
    );
    const outputs = weightOutputs(weightIds, nodes);
    return {
      code: code,
      label: first ? (first.json.result && first.json.result.label) || first.label : code,
      lane: topLane ? topLane.title : ((useStcLanes ? classLaneLabel(code) : "") || (top ? top.label : "—")),
      laneKey: top ? top.id : "",
      clsIds: clsIds,
      specialIds: [],
      weightRootIds: weightRootIds,
      primaryWeightIds: unique(weightRootIds.concat(universalByClass[code] || [])),
      moreWeightIds: weightIds.filter((id) => !weightRootIds.includes(id) && !(universalByClass[code] || []).includes(id)),
      weightIds: weightIds,
      out: outputs.texts,
      outputs: outputs,
      shared: [],
      rwMore: 0
    };
  });

  const rootUsage = new Map();
  matrix.forEach((row) => {
    row.weightRootIds.forEach((id) => {
      if (!rootUsage.has(id)) rootUsage.set(id, new Set());
      rootUsage.get(id).add(row.code);
    });
  });
  matrix.forEach((row) => {
    row.shared = row.weightRootIds
      .filter((id) => rootUsage.get(id).size > 1)
      .map((id) => ({ id: id, classes: rootUsage.get(id).size }));
    row.rwMore = Math.max(0, row.weightIds.length - row.weightRootIds.length);
  });

  const groupOf = (row) => (row.lane && row.lane !== "—" ? row.lane : "其他/控制类");
  const flowGroups = {};
  STC_LANE_ORDER.forEach((lane) => {
    const items = matrix.filter((row) => groupOf(row) === lane);
    if (items.length) flowGroups[lane] = items;
  });
  matrix.forEach((row) => {
    const lane = groupOf(row);
    if (!flowGroups[lane]) flowGroups[lane] = [];
    if (!flowGroups[lane].includes(row)) flowGroups[lane].push(row);
  });

  return {
    nodes: nodes,
    topClsIds: topClsIds,
    topRwIds: topRwIds,
    overlays: overlayIds,
    lanes: lanes,
    matrix: matrix,
    flowGroups: flowGroups,
    tableMap: tableMap,
    listMap: listMap,
    classCodes: classCodes,
    counts: {
      clsNodes: clsCount,
      rwNodes: rwCount,
      lanes: lanes.length,
      classes: classCodes.length,
      tables: Object.keys(tableMap).length,
      lists: Object.keys(listMap).length,
      fields: unique(Object.keys(nodes).flatMap((id) => nodes[id].fields || [])).length
    }
  };
}
