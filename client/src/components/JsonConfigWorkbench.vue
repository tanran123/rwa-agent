<script setup>
import { computed, onMounted, ref, watch } from "vue";
import RefGridEditor from "@/components/RefGridEditor.vue";
import { fetchParameterTable, fetchReferenceList, saveParameterTable, saveReferenceList, saveRuleDocument, validateRuleBody } from "@/api/config";
import { contextOf, nodeView, summarizeConditions, conditionText, listCheckText } from "@/utils/ruleMap";
import { askConfirm } from "@/utils/confirm";

const props = defineProps({
  classification: { type: Object, default: null },
  weight: { type: Object, default: null },
  tables: { type: Array, default: () => [] },
  lists: { type: Array, default: () => [] },
  docs: { type: Array, default: () => [] },
  jurisdiction: { type: String, default: "" },
  ruleVersion: { type: String, default: "" },
  readonly: { type: Boolean, default: false }
});
const emit = defineEmits(["saved"]);

const activeFile = ref("cls");
const view = ref("logic");
const subView = ref("route");
const decisionQuery = ref("");
const selectedPath = ref("");
const outlineQuery = ref("");
const collapsed = ref({});
const showPanel = ref(false);
const issues = ref([]);
const notice = ref({ text: "", kind: "" });
const saving = ref(false);
const paramId = ref(props.tables[0] ? props.tables[0].id : "");
const listId = ref(props.lists[0] ? props.lists[0].id : "");
const bodies = ref({
  cls: props.classification ? clone(props.classification) : {},
  weight: props.weight ? clone(props.weight) : {}
});
const originals = ref({
  cls: props.classification ? clone(props.classification) : {},
  weight: props.weight ? clone(props.weight) : {}
});
const paramBodies = ref({});
const listBodies = ref({});
const paramOriginals = ref({});
const listOriginals = ref({});
const sourceText = ref("");
const sourceDirty = ref(false);

const FILE_TABS = [
  { key: "cls", label: "分类规则", icon: "CLS" },
  { key: "weight", label: "风险权重", icon: "RW" },
  { key: "param", label: "参数表", icon: "T" },
  { key: "list", label: "监管名单", icon: "L" }
];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const classMeta = computed(() => props.docs.find((item) => item.kind === "exposure_classification") || null);
const weightMeta = computed(() => props.docs.find((item) => item.kind === "risk_weight") || null);
const paramMeta = computed(() => props.tables.find((item) => item.id === paramId.value) || null);
const listMeta = computed(() => props.lists.find((item) => item.id === listId.value) || null);

const currentMeta = computed(() => {
  if (activeFile.value === "cls") return classMeta.value;
  if (activeFile.value === "weight") return weightMeta.value;
  if (activeFile.value === "param") return paramMeta.value;
  return listMeta.value;
});

const currentBody = computed(() => {
  if (activeFile.value === "cls") return bodies.value.cls;
  if (activeFile.value === "weight") return bodies.value.weight;
  if (activeFile.value === "param") return (paramId.value && paramBodies.value[paramId.value]) || null;
  return (listId.value && listBodies.value[listId.value]) || null;
});

const currentOriginal = computed(() => {
  if (activeFile.value === "cls") return originals.value.cls;
  if (activeFile.value === "weight") return originals.value.weight;
  if (activeFile.value === "param") return (paramId.value && paramOriginals.value[paramId.value]) || null;
  return (listId.value && listOriginals.value[listId.value]) || null;
});

const isJsonFile = computed(() => activeFile.value === "cls" || activeFile.value === "weight");
const isTableFile = computed(() => activeFile.value === "param" || activeFile.value === "list");

const dirty = computed(() => {
  if (sourceDirty.value) return true;
  if (!currentBody.value || !currentOriginal.value) return false;
  return JSON.stringify(currentBody.value) !== JSON.stringify(currentOriginal.value);
});

const schemaLabel = computed(() => {
  if (isJsonFile.value) return "STC v3.5";
  return activeFile.value === "param" ? "监管参数表" : "监管名单";
});

const referenceLabel = computed(() => {
  if (isJsonFile.value) {
    const body = currentBody.value || {};
    return (body.tables || []).length + " 参数表 · " + (body.lists || []).length + " 名单";
  }
  return activeFile.value === "param" ? props.tables.length + " 张参数表" : props.lists.length + " 份名单";
});

const fieldBook = computed(() => {
  const body = (activeFile.value === "cls" ? bodies.value.cls : activeFile.value === "weight" ? bodies.value.weight : {}) || {};
  const fields = {};
  (body.fields || []).forEach((field) => { if (field && field.name) fields[field.name] = field; });
  return { fields: fields, body: body };
});

const ruleContext = computed(() => {
  const body = (activeFile.value === "cls" ? bodies.value.cls : bodies.value.weight) || {};
  return contextOf(body, props.tables, props.lists);
});

const LEVEL_LABELS = {
  OBLIGOR: "客户/主体层面",
  FACILITY: "债项/交易层面",
  COLLATERAL: "抵质押品层面",
  SETTLEMENT: "结算层面",
  PORTFOLIO: "组合/计量层面",
  DATA_PREP: "数据准备层面",
  OUTPUT: "规则输出层面"
};

function currentRuleBody() {
  return (activeFile.value === "cls" ? bodies.value.cls : bodies.value.weight) || {};
}

function currentRuleKind() {
  return activeFile.value === "cls" ? "exposure_classification" : "risk_weight";
}

const fieldGroups = computed(() => {
  const body = currentRuleBody();
  const declared = body.field_groups || [];
  const byGroup = {};
  (body.fields || []).forEach((field) => {
    const key = field.group || "__other";
    if (!byGroup[key]) byGroup[key] = [];
    byGroup[key].push(field);
  });
  const groups = declared.map((group, index) => ({
    group_id: group.group_id,
    path: (activeFile.value === "cls" ? "cls" : "rw") + ".field_groups." + index,
    label: group.label || group.group_id,
    level: group.level || "",
    level_label: LEVEL_LABELS[group.level] || group.level || "",
    description: group.description || "",
    order: group.order,
    fields: byGroup[group.group_id] || []
  }));
  if (byGroup.__other) {
    groups.push({
      group_id: "__other",
      label: "未分组字段",
      level: "",
      level_label: "",
      description: "这些字段还没有声明 group",
      fields: byGroup.__other
    });
  }
  return groups;
});

const subViews = computed(() => {
  if (activeFile.value === "param") return [{ key: "schema", label: "参数表结构" }, { key: "refs", label: "引用关系" }];
  if (activeFile.value === "list") return [{ key: "schema", label: "名单结构" }, { key: "refs", label: "引用关系" }];
  if (activeFile.value === "cls") {
    return [
      { key: "route", label: "分类路由" },
      { key: "groups", label: "字段分组" },
      { key: "cond", label: "条件树" },
      { key: "flow", label: "流程图" }
    ];
  }
  return [
    { key: "table", label: "决策表" },
    { key: "groups", label: "字段分组" },
    { key: "cond", label: "条件树" },
    { key: "flow", label: "流程图" }
  ];
});

const routeRows = computed(() => {
  if (!isJsonFile.value) return [];
  const body = currentRuleBody();
  const root = activeFile.value === "cls" ? "cls.rules" : "rw.rules";
  return (body.rules || []).map((node, index) => ({
    node: node,
    index: index + 1,
    path: root + "." + index,
    id: node.id || "节点 " + (index + 1),
    label: node.label || "",
    className: (node.result && node.result.exposure_class) || "",
    view: nodeView(node, currentRuleKind(), ruleContext.value)
  }));
});

function walkDecision(nodes, basePath, top, rows) {
  (nodes || []).forEach((node, index) => {
    if (!node || typeof node !== "object") return;
    const path = basePath + "." + index;
    const owner = top || node.id;
    if (node.result && Object.prototype.hasOwnProperty.call(node.result, "risk_weight")) {
      rows.push({
        node: node,
        path: path,
        top: owner,
        view: nodeView(node, "risk_weight", ruleContext.value),
        weight: node.result.risk_weight,
        table: (node.result.attributes && node.result.attributes.table_id) || node.result.table_id || "",
        basis: (node.result.regulatory_basis && node.result.regulatory_basis.article) || node.result.category || ""
      });
    }
    walkDecision(node.children, path + ".children", owner, rows);
    if (node.otherwise && node.otherwise.id) walkDecision([node.otherwise], path + ".otherwise", owner, rows);
  });
}

const decisionRows = computed(() => {
  if (!isJsonFile.value) return [];
  const rows = [];
  walkDecision(currentRuleBody().rules, activeFile.value === "cls" ? "cls.rules" : "rw.rules", "", rows);
  const text = decisionQuery.value.trim().toLowerCase();
  return rows.filter((row) => {
    if (!text) return true;
    return [row.node.id, row.node.label, row.view.whenText, row.view.resultText, row.top]
      .join(" ").toLowerCase().includes(text);
  });
});

function openRow(path) {
  selectedPath.value = path;
  if (view.value === "source") view.value = "logic";
}

function locateGroup(group) {
  selectedPath.value = group.path;
  view.value = "struct";
  subView.value = "groups";
}

function locateField(name) {
  const body = currentRuleBody();
  const index = (body.fields || []).findIndex((field) => field.name === name);
  if (index < 0) return;
  selectedPath.value = (activeFile.value === "cls" ? "cls" : "rw") + ".fields." + index;
  view.value = "logic";
}

function weightText(value) {
  if (value === null) return "人工复核";
  if (typeof value === "number") return value + "%";
  return value == null ? "—" : String(value);
}

const ruleStats = computed(() => {
  const body = currentRuleBody();
  const classes = new Set();
  const walk = (nodes) => (nodes || []).forEach((node) => {
    if (!node) return;
    if (node.result && node.result.exposure_class) classes.add(node.result.exposure_class);
    walk(node.children);
  });
  walk(body.rules);
  return {
    nodes: (function count(nodes) {
      let total = 0;
      (nodes || []).forEach((node) => {
        total += 1;
        total += count(node.children);
      });
      return total;
    })(body.rules),
    fields: (body.fields || []).length,
    groups: (body.field_groups || []).length,
    tables: (body.tables || []).length,
    lists: (body.lists || []).length,
    classes: classes.size
  };
});

function flattenCondition(condition, depth, rows) {
  const list = rows || [];
  if (!condition) return list;
  if (Array.isArray(condition.all)) {
    list.push({ depth: depth || 0, kind: "group", text: "AND · 同时满足" });
    condition.all.forEach((item) => flattenCondition(item, (depth || 0) + 1, list));
    return list;
  }
  if (Array.isArray(condition.any)) {
    list.push({ depth: depth || 0, kind: "group", text: "OR · 任一满足" });
    condition.any.forEach((item) => flattenCondition(item, (depth || 0) + 1, list));
    return list;
  }
  if (condition.not) {
    list.push({ depth: depth || 0, kind: "group", text: "NOT · 排除" });
    flattenCondition(condition.not, (depth || 0) + 1, list);
    return list;
  }
  if (condition.list_check) {
    list.push({ depth: depth || 0, kind: "leaf", text: listCheckText(condition.list_check, ruleContext.value.listTitles || {}) });
    return list;
  }
  list.push({ depth: depth || 0, kind: "leaf", text: conditionText(condition, ruleContext.value) });
  return list;
}

const conditionLines = computed(() => flattenCondition(selectedRaw.value && selectedRaw.value.when, 0, []));

function itemRaw(item) {
  if (!item) return null;
  const base = activeFile.value === "cls" ? bodies.value.cls : bodies.value.weight;
  return getByPath(base, item.path.replace(/^(cls|rw)\./, ""));
}

const flowChain = computed(() => {
  if (!isJsonFile.value || !selectedItem.value || !["cls", "rw"].includes(selectedItem.value.kind)) return [];
  const chain = [];
  let item = selectedItem.value;
  while (item) {
    if (["cls", "rw"].includes(item.kind)) chain.unshift(item);
    item = outline.value.find((entry) => entry.path === item.parent) || null;
  }
  return chain.map((entry) => {
    const raw = itemRaw(entry);
    const view = raw && typeof raw === "object" ? nodeView(raw, currentRuleKind(), ruleContext.value) : null;
    return {
      id: entry.id,
      label: (view && view.label) || entry.label || entry.id,
      condition: (view && view.whenText) || "",
      result: (view && view.resultText) || ""
    };
  });
});

function buildRuleOutline(body, kind, rootPath) {
  const items = [];
  const groupDefs = (body && body.field_groups) || [];
  if (groupDefs.length) {
    const groupsGroup = {
      path: rootPath + ".field_groups",
      id: "分组",
      label: "字段分组（" + groupDefs.length + "）",
      kind: "group",
      depth: 0,
      parent: "",
      hasChildren: true
    };
    items.push(groupsGroup);
    groupDefs.forEach((group, index) => {
      items.push({
        path: rootPath + ".field_groups." + index,
        id: group.group_id || "分组 " + (index + 1),
        label: group.label || "",
        kind: "fieldgroup",
        depth: 1,
        parent: groupsGroup.path
      });
    });
  }
  const fieldsGroup = {
    path: rootPath + ".fields",
    id: "字段",
    label: "字段定义（" + ((body && body.fields) || []).length + "）",
    kind: "group",
    depth: 0,
    parent: "",
    hasChildren: true
  };
  items.push(fieldsGroup);
  ((body && body.fields) || []).forEach((field, index) => {
    items.push({
      path: rootPath + ".fields." + index,
      id: field.name || "字段 " + (index + 1),
      label: field.label || "",
      kind: "field",
      depth: 1,
      parent: fieldsGroup.path
    });
  });

  const rulesGroup = {
    path: rootPath + ".rules",
    id: "规则",
    label: "规则节点（" + ((body && body.rules) || []).length + "）",
    kind: "group",
    depth: 0,
    parent: "",
    hasChildren: true
  };
  items.push(rulesGroup);

  const walk = (nodes, basePath, depth, parentPath) => {
    (nodes || []).forEach((node, index) => {
      if (!node || typeof node !== "object") return;
      const path = basePath + "." + index;
      items.push({
        path: path,
        id: node.id || "节点 " + (index + 1),
        label: node.label || "",
        kind: kind,
        depth: depth,
        parent: parentPath,
        hasChildren: !!(node.children && node.children.length)
      });
      if (node.children && node.children.length) {
        walk(node.children, path + ".children", depth + 1, path);
      }
      if (node.otherwise && node.otherwise.id) {
        items.push({
          path: path + ".otherwise",
          id: node.otherwise.id,
          label: node.otherwise.label || "否则",
          kind: kind,
          depth: depth + 1,
          parent: path,
          hasChildren: !!(node.otherwise.children && node.otherwise.children.length)
        });
      }
    });
  };
  walk((body && body.rules) || [], rootPath + ".rules", 1, rulesGroup.path);
  return items;
}

function buildTableOutline(body) {
  if (!body) return [];
  const items = [];
  const columns = body.columns || [];
  items.push({ path: "columns", id: "columns", label: "表头（" + columns.length + "）", kind: "group", depth: 0, parent: "" });
  columns.forEach((column, index) => {
    items.push({ path: "columns." + index, id: column, label: "列", kind: "column", depth: 1, parent: "columns" });
  });
  items.push({ path: "rows", id: "rows", label: "数据行（" + (body.rows || []).length + "）", kind: "group", depth: 0, parent: "" });
  (body.rows || []).forEach((row, index) => {
    items.push({ path: "rows." + index, id: "第 " + (index + 1) + " 行", label: columns.slice(0, 2).join(" / "), kind: "row", depth: 1, parent: "rows" });
  });
  return items;
}

const outline = computed(() => {
  if (isJsonFile.value) {
    return buildRuleOutline(currentBody.value, activeFile.value === "cls" ? "cls" : "rw", activeFile.value === "cls" ? "cls" : "rw");
  }
  return buildTableOutline(currentBody.value);
});

function hiddenByCollapse(item) {
  let parent = item.parent;
  while (parent) {
    if (collapsed.value[parent]) return true;
    const found = outline.value.find((entry) => entry.path === parent);
    parent = found ? found.parent : "";
  }
  return false;
}

const filteredOutline = computed(() => {
  const text = outlineQuery.value.trim().toLowerCase();
  const items = outline.value.filter((item) => !hiddenByCollapse(item));
  if (!text) return items;
  return items.filter((item) => (item.id + " " + item.label + " " + item.path).toLowerCase().includes(text));
});

const selectedItem = computed(() => outline.value.find((item) => item.path === selectedPath.value) || null);

function getByPath(root, path) {
  if (!root) return null;
  const keys = String(path || "").split(".").filter(Boolean);
  let current = root;
  for (const key of keys) {
    if (current == null) return null;
    current = current[key];
  }
  return current;
}

const selectedRaw = computed(() => {
  if (!selectedItem.value) return null;
  if (isJsonFile.value) {
    const base = activeFile.value === "cls" ? bodies.value.cls : bodies.value.weight;
    const path = selectedItem.value.path.replace(/^(cls|rw)\./, "");
    return getByPath(base, path);
  }
  return getByPath(currentBody.value, selectedItem.value.path);
});

const selectedRuleView = computed(() => {
  if (!isJsonFile.value || !selectedItem.value || !["cls", "rw"].includes(selectedItem.value.kind)) return null;
  const raw = selectedRaw.value;
  if (!raw || typeof raw !== "object") return null;
  return nodeView(raw, activeFile.value === "cls" ? "exposure_classification" : "risk_weight", ruleContext.value);
});

const outlineCount = computed(() => outline.value.filter((item) => item.kind !== "group").length);

function selectPath(path) {
  selectedPath.value = path;
  if (view.value === "source") view.value = "logic";
}

function toggleCollapse(path) {
  collapsed.value = { ...collapsed.value, [path]: !collapsed.value[path] };
}

function expandAll(open) {
  if (open) collapsed.value = {};
  else {
    const next = {};
    outline.value.forEach((item) => { if (item.hasChildren) next[item.path] = true; });
    collapsed.value = next;
  }
}

async function switchFile(key) {
  if (key !== activeFile.value && dirty.value) {
    const yes = await askConfirm("当前配置有未保存的修改，切换后会丢掉这些修改。", {
      title: "未保存的修改", confirmText: "继续切换", danger: true
    });
    if (!yes) return;
  }
  activeFile.value = key;
  selectedPath.value = "";
  subView.value = key === "weight" ? "table" : key === "cls" ? "route" : "schema";
  issues.value = [];
  notice.value = { text: "", kind: "" };
  sourceDirty.value = false;
  if (key === "param") loadParam(paramId.value);
  if (key === "list") loadList(listId.value);
  syncSource();
}

async function loadParam(id) {
  if (!id || paramBodies.value[id]) return;
  try {
    const doc = await fetchParameterTable(id);
    paramBodies.value = { ...paramBodies.value, [id]: clone(doc) };
    paramOriginals.value = { ...paramOriginals.value, [id]: clone(doc) };
    if (activeFile.value === "param" && paramId.value === id) syncSource();
  } catch (err) {
    notice.value = { text: err.message || "参数表读取失败", kind: "danger" };
  }
}

async function loadList(id) {
  if (!id || listBodies.value[id]) return;
  try {
    const doc = await fetchReferenceList(id);
    listBodies.value = { ...listBodies.value, [id]: clone(doc) };
    listOriginals.value = { ...listOriginals.value, [id]: clone(doc) };
    if (activeFile.value === "list" && listId.value === id) syncSource();
  } catch (err) {
    notice.value = { text: err.message || "名单读取失败", kind: "danger" };
  }
}

function syncSource() {
  if (!currentBody.value) {
    sourceText.value = "";
    return;
  }
  sourceText.value = JSON.stringify(currentBody.value, null, 2);
  sourceDirty.value = false;
}

function applySource() {
  try {
    const parsed = JSON.parse(sourceText.value);
    if (activeFile.value === "cls") bodies.value = { ...bodies.value, cls: parsed };
    else if (activeFile.value === "weight") bodies.value = { ...bodies.value, weight: parsed };
    else if (activeFile.value === "param") paramBodies.value = { ...paramBodies.value, [paramId.value]: parsed };
    else listBodies.value = { ...listBodies.value, [listId.value]: parsed };
    sourceDirty.value = false;
    notice.value = { text: "JSON 已应用到当前文件", kind: "ok" };
  } catch (err) {
    notice.value = { text: "JSON 解析失败：" + err.message, kind: "danger" };
  }
}

function onSourceInput() {
  sourceDirty.value = true;
}

async function validate() {
  issues.value = [];
  notice.value = { text: "", kind: "" };
  if (isJsonFile.value) {
    try {
      const result = await validateRuleBody({
        kind: activeFile.value === "cls" ? "exposure_classification" : "risk_weight",
        body: currentBody.value,
        jurisdiction: props.jurisdiction,
        ruleVersion: props.ruleVersion
      });
      issues.value = result.errors || [];
    } catch (err) {
      issues.value = [err.message];
    }
  } else {
    const body = currentBody.value;
    if (!body) issues.value = ["没有读取到" + (activeFile.value === "param" ? "参数表" : "名单")];
    else {
      if (!Array.isArray(body.columns) || !body.columns.length) issues.value.push("columns 不能为空");
      const width = (body.columns || []).length;
      (body.rows || []).forEach((row, index) => {
        if (!Array.isArray(row) || row.length !== width) issues.value.push("第 " + (index + 1) + " 行列数与表头不一致");
      });
    }
  }
  showPanel.value = true;
  notice.value = { text: issues.value.length ? "校验发现 " + issues.value.length + " 处问题" : "校验通过", kind: issues.value.length ? "danger" : "ok" };
}

async function save() {
  if (props.readonly) {
    notice.value = { text: "当前版本已发布，配置只读；请先在版本工作台撤回发布", kind: "danger" };
    return;
  }
  if (!currentBody.value) return;
  saving.value = true;
  notice.value = { text: "", kind: "" };
  try {
    if (activeFile.value === "cls" || activeFile.value === "weight") {
      const meta = activeFile.value === "cls" ? classMeta.value : weightMeta.value;
      if (!meta) throw new Error("没有对应的规则文档");
      const saved = await saveRuleDocument(meta.id, { body: currentBody.value, baseRevision: meta.revision });
      if (activeFile.value === "cls") {
        bodies.value = { ...bodies.value, cls: clone(saved.body) };
        originals.value = { ...originals.value, cls: clone(saved.body) };
      } else {
        bodies.value = { ...bodies.value, weight: clone(saved.body) };
        originals.value = { ...originals.value, weight: clone(saved.body) };
      }
    } else if (activeFile.value === "param") {
      const saved = await saveParameterTable(paramId.value, { ...currentBody.value, baseRevision: currentBody.value.revision });
      paramBodies.value = { ...paramBodies.value, [paramId.value]: clone(saved) };
      paramOriginals.value = { ...paramOriginals.value, [paramId.value]: clone(saved) };
    } else {
      const saved = await saveReferenceList(listId.value, { ...currentBody.value, baseRevision: currentBody.value.revision });
      listBodies.value = { ...listBodies.value, [listId.value]: clone(saved) };
      listOriginals.value = { ...listOriginals.value, [listId.value]: clone(saved) };
    }
    sourceDirty.value = false;
    notice.value = { text: "已保存变更", kind: "ok" };
    emit("saved");
  } catch (err) {
    notice.value = { text: err.message || "保存失败", kind: "danger" };
  } finally {
    saving.value = false;
  }
}

function setParamBody(next) {
  paramBodies.value = { ...paramBodies.value, [paramId.value]: next };
}
function setListBody(next) {
  listBodies.value = { ...listBodies.value, [listId.value]: next };
}

function tableBody() {
  return currentBody.value || { title: "", columns: [], rows: [] };
}

watch(activeFile, () => { syncSource(); });
watch([paramId, listId], () => { syncSource(); });
watch(() => props.classification, (value) => {
  if (value) { bodies.value = { ...bodies.value, cls: clone(value) }; originals.value = { ...originals.value, cls: clone(value) }; syncSource(); }
});
watch(() => props.weight, (value) => {
  if (value) { bodies.value = { ...bodies.value, weight: clone(value) }; originals.value = { ...originals.value, weight: clone(value) }; syncSource(); }
});

onMounted(async () => {
  if (paramId.value) await loadParam(paramId.value);
  if (listId.value) await loadList(listId.value);
  syncSource();
});
</script>

<template>
  <div class="jw-shell">
    <div class="jw-top">
      <div class="jw-files">
        <button
          v-for="file in FILE_TABS"
          :key="file.key"
          type="button"
          class="jw-file"
          :class="{ on: activeFile === file.key }"
          @click="switchFile(file.key)"
        >
          <span class="ic">{{ file.icon }}</span>{{ file.label }}
          <i v-if="activeFile === file.key && dirty" class="jw-dirty-dot"></i>
        </button>
      </div>
      <span class="spacer"></span>
      <span class="jw-pill" :class="issues.length ? 'bad' : 'ok'">{{ issues.length ? issues.length + " 处问题" : "校验通过" }}</span>
      <span class="jw-pill">{{ schemaLabel }}</span>
      <span class="jw-pill">{{ referenceLabel }}</span>
      <button type="button" class="btn sm" @click="validate">校验</button>
      <span v-if="readonly" class="tag muted">已发布只读</span>
      <button type="button" class="btn sm primary" :disabled="saving || readonly" @click="save">{{ saving ? "保存中" : "保存变更" }}</button>
      <span class="jw-badge" :class="{ dirty: dirty }">{{ dirty ? "未保存" : "未修改" }}</span>
    </div>

    <p v-if="notice.text" class="notice" :class="notice.kind">{{ notice.text }}</p>

    <div class="jw-main">
      <aside class="jw-outline">
        <div class="jw-outline-head">
          <b>JSON Outline</b><span>{{ outlineCount }}</span>
        </div>
        <div class="jw-outline-search">
          <input v-model="outlineQuery" type="search" placeholder="搜索编号 / 名称 / JSONPath" />
        </div>
        <div v-if="activeFile === 'param'" class="jw-selector">
          <select v-model="paramId" @change="loadParam(paramId); syncSource()">
            <option v-for="item in tables" :key="item.id" :value="item.id">{{ item.tableId }}</option>
          </select>
        </div>
        <div v-if="activeFile === 'list'" class="jw-selector">
          <select v-model="listId" @change="loadList(listId); syncSource()">
            <option v-for="item in lists" :key="item.id" :value="item.id">{{ item.listId }}</option>
          </select>
        </div>
        <div class="jw-outline-tools">
          <button type="button" @click="expandAll(true)">展开全部</button>
          <button type="button" @click="expandAll(false)">折叠全部</button>
        </div>
        <div class="jw-outline-tree">
          <button
            v-for="item in filteredOutline"
            :key="item.path"
            type="button"
            class="jw-outline-item"
            :class="{ on: selectedPath === item.path, group: item.kind === 'group' }"
            :style="{ paddingLeft: (8 + item.depth * 12) + 'px' }"
            @click="selectPath(item.path)"
          >
            <span
              v-if="item.kind === 'group'"
              class="jw-caret"
              @click.stop="toggleCollapse(item.path)"
            >{{ collapsed[item.path] ? '▸' : '▾' }}</span>
            <span class="id mono">{{ item.id }}</span>
            <span class="lb">{{ item.label }}</span>
            <span v-if="item.kind === 'cls'" class="jw-ochip cls">分类</span>
            <span v-else-if="item.kind === 'rw'" class="jw-ochip rw">权重</span>
            <span v-else-if="item.kind === 'field'" class="jw-ochip rev">字段</span>
          </button>
          <p v-if="!filteredOutline.length" class="dim jw-outline-empty">没有匹配的节点。</p>
        </div>
        <div class="jw-outline-foot">
          <div class="path">{{ selectedPath || "/" }}</div>
          <div class="type">{{ selectedItem ? selectedItem.kind : "" }}</div>
        </div>
      </aside>

      <section class="jw-work">
        <div class="jw-work-head">
          <div class="jw-views">
            <button type="button" :class="{ on: view === 'logic' }" @click="view = 'logic'">业务逻辑</button>
            <button type="button" :class="{ on: view === 'struct' }" @click="view = 'struct'">规则结构</button>
            <button type="button" :class="{ on: view === 'source' }" @click="view = 'source'">JSON 源码</button>
          </div>
          <div v-if="view === 'struct'" class="jw-subviews">
            <button
              v-for="sub in subViews"
              :key="sub.key"
              type="button"
              :class="{ on: subView === sub.key }"
              @click="subView = sub.key"
            >{{ sub.label }}</button>
          </div>
          <span class="spacer"></span>
          <span class="dim" style="font-size: 11px">{{ currentMeta ? (currentMeta.name || currentMeta.tableId || currentMeta.listId) : "" }}</span>
        </div>

        <div class="jw-body">
          <template v-if="view === 'logic'">
            <RefGridEditor
              v-if="isTableFile && currentBody"
              :document="tableBody()"
              :saving="saving"
              :readonly="readonly"
              @update="activeFile === 'param' ? setParamBody($event) : setListBody($event)"
              @save="save"
            />
            <template v-else-if="isJsonFile">
              <div v-if="selectedRuleView" class="jw-card">
                <div class="jw-card-head">
                  <span class="jw-kid">{{ selectedItem.id }}</span>
                  <h2>{{ selectedRuleView.label }}</h2>
                  <span class="spacer"></span>
                  <span class="jw-pill">{{ activeFile === 'cls' ? '暴露分类' : '风险权重' }}</span>
                </div>
                <p v-if="selectedRuleView.note" class="dim">{{ selectedRuleView.note }}</p>
                <div class="jw-sect">
                  <h4>判断条件</h4>
                  <p class="jw-cond">{{ selectedRuleView.whenText || "（无附加条件）" }}</p>
                </div>
                <div class="jw-sect">
                  <h4>规则结果</h4>
                  <div class="jw-res">
                    <span class="big" :class="{ manual: activeFile === 'weight' && selectedRaw.result && selectedRaw.result.risk_weight === null }">
                      {{ activeFile === 'cls' ? (selectedRaw.result && selectedRaw.result.exposure_class || '—') : (selectedRuleView.resultText || '—') }}
                    </span>
                  </div>
                </div>
                <div v-if="selectedRuleView.fields && selectedRuleView.fields.length" class="jw-sect">
                  <h4>输入字段（{{ selectedRuleView.fields.length }}）</h4>
                  <div class="jw-chips">
                    <span v-for="field in selectedRuleView.fields" :key="field" class="jw-chip cls">{{ field }}</span>
                  </div>
                </div>
                <div v-if="selectedRuleView.tables && selectedRuleView.tables.length" class="jw-sect">
                  <h4>引用参数表</h4>
                  <div class="jw-chips"><span v-for="item in selectedRuleView.tables" :key="item.id" class="jw-chip ref">{{ item.id }}</span></div>
                </div>
                <div v-if="selectedRuleView.lists && selectedRuleView.lists.length" class="jw-sect">
                  <h4>引用名单</h4>
                  <div class="jw-chips"><span v-for="item in selectedRuleView.lists" :key="item.id" class="jw-chip ref">{{ item.id }}</span></div>
                </div>
                <div v-if="selectedRuleView.basis" class="jw-sect">
                  <h4>监管依据</h4><p>{{ selectedRuleView.basis }}</p>
                </div>
              </div>
              <div v-else-if="selectedItem && selectedItem.kind === 'field'" class="jw-card">
                <div class="jw-card-head"><span class="jw-kid">{{ selectedItem.id }}</span><h2>{{ selectedRaw.label || selectedItem.id }}</h2></div>
                <dl class="jw-kv">
                  <dt>类型</dt><dd>{{ selectedRaw.type || '—' }}</dd>
                  <dt>来源</dt><dd>{{ selectedRaw.source || '—' }}</dd>
                  <dt>分组</dt><dd>{{ selectedRaw.group || '—' }}</dd>
                  <dt>层面</dt><dd>{{ LEVEL_LABELS[selectedRaw.level] || selectedRaw.level || '—' }}</dd>
                  <dt>缺失处理</dt><dd>{{ selectedRaw.missing_policy || '—' }}</dd>
                  <dt>单位</dt><dd>{{ selectedRaw.unit || '—' }}</dd>
                  <dt>含义</dt><dd>{{ selectedRaw.meaning || '—' }}</dd>
                </dl>
              </div>
              <div v-else class="jw-overview">
                <div class="jw-card">
                  <div class="jw-card-head">
                    <h2>{{ currentBody.title || (activeFile === 'cls' ? '分类规则集' : '风险权重规则集') }}</h2>
                    <span class="jw-pill">{{ currentBody.status || 'DRAFT' }}</span>
                    <span class="jw-pill">v{{ currentBody.version || '—' }}</span>
                    <span class="spacer"></span>
                    <button type="button" class="btn sm" @click="view = 'source'">查看 JSON 源码</button>
                  </div>
                  <div class="jw-statline">
                    <span>规则节点 <b>{{ ruleStats.nodes }}</b></span>
                    <span v-if="activeFile === 'cls'">暴露类别 <b>{{ ruleStats.classes }}</b></span>
                    <span>字段 <b>{{ ruleStats.fields }}</b></span>
                    <span>字段分组 <b>{{ ruleStats.groups }}</b></span>
                    <span>参数表引用 <b>{{ ruleStats.tables }}</b></span>
                    <span>名单引用 <b>{{ ruleStats.lists }}</b></span>
                  </div>
                </div>

                <div v-if="activeFile === 'cls'" class="jw-card">
                  <div class="jw-card-head">
                    <h2>分类路由</h2>
                    <span class="dim">按 JSON 节点顺序执行；命中即停在对应类别</span>
                  </div>
                  <div class="jw-route-list">
                    <button v-for="row in routeRows" :key="row.path" type="button" class="jw-route" @click="openRow(row.path)">
                      <span class="no">{{ row.index }}</span>
                      <span class="main">
                        <span class="head"><span class="jid">{{ row.id }}</span><b>{{ row.label }}</b></span>
                        <span class="cond">{{ row.view.whenText || '（无附加条件，路由节点）' }}</span>
                        <span class="result"><span class="big">{{ row.className || '—' }}</span><span class="dim">{{ row.view.resultText }}</span></span>
                      </span>
                      <span class="go">查看</span>
                    </button>
                  </div>
                </div>

                <div v-else class="jw-card">
                  <div class="jw-card-head">
                    <h2>风险权重决策表</h2>
                    <span class="dim">{{ decisionRows.length }} 条可产出权重的规则 · 按 JSON 顺序优先</span>
                  </div>
                  <div class="jw-filter">
                    <input v-model="decisionQuery" type="search" placeholder="筛选：编号 / 类别 / 权重 / 条件字段" />
                  </div>
                  <table class="jw-dtable jw-decision">
                    <thead><tr><th>#</th><th>编号</th><th>顶层分支</th><th>适用条件</th><th>权重</th><th>参数表</th><th>依据</th></tr></thead>
                    <tbody>
                      <tr v-for="(row, index) in decisionRows" :key="row.path" @click="openRow(row.path)">
                        <td>{{ index + 1 }}</td>
                        <td class="mono">{{ row.node.id }}</td>
                        <td class="mono dim">{{ row.top }}</td>
                        <td class="cond">{{ row.view.whenText || '—' }}</td>
                        <td><span class="weight" :class="{ manual: row.weight === null }">{{ weightText(row.weight) }}</span></td>
                        <td><span v-if="row.table" class="jw-chip ref">{{ row.table }}</span><span v-else class="dim">—</span></td>
                        <td class="dim">{{ row.basis || '—' }}</td>
                      </tr>
                    </tbody>
                  </table>
                  <p v-if="!decisionRows.length" class="dim">没有匹配的规则。</p>
                </div>
              </div>
            </template>
          </template>

          <div v-else-if="view === 'struct'" class="jw-struct">
            <template v-if="isJsonFile">
              <div v-if="subView === 'groups'" class="jw-groups">
                <div class="jw-card">
                  <div class="jw-card-head">
                    <h2>字段分组</h2>
                    <span class="dim">V3.5：字段按「层面 level + 业务分组 group」归集，规则集声明 field_groups</span>
                  </div>
                  <p class="dim">共 {{ fieldGroups.length }} 个分组、{{ (currentBody.fields || []).length }} 个字段。分组与层面由规则集统一口径生成，产品注册与映射配置引用同一套 group_id。</p>
                </div>
                <div v-for="group in fieldGroups" :key="group.group_id" class="jw-card jw-group-card">
                  <div class="jw-group-head">
                    <span class="gid">{{ group.group_id }}</span>
                    <b>{{ group.label }}</b>
                    <span v-if="group.level_label" class="lvl">{{ group.level_label }}</span>
                    <span class="cnt">{{ group.fields.length }} 字段</span>
                    <span class="spacer"></span>
                    <button type="button" class="btn sm" @click="locateGroup(group)">在 Outline 查看</button>
                  </div>
                  <p v-if="group.description" class="dim">{{ group.description }}</p>
                  <div class="jw-chips">
                    <button
                      v-for="field in group.fields"
                      :key="field.name"
                      type="button"
                      class="jw-chip field"
                      @click="locateField(field.name)"
                    >
                      <span>{{ field.label || field.name }}</span><span class="mono">{{ field.name }}</span>
                    </button>
                    <span v-if="!group.fields.length" class="dim">没有字段</span>
                  </div>
                </div>
              </div>

              <div v-else-if="subView === 'cond'" class="jw-card">
                <template v-if="selectedRuleView">
                  <div class="jw-card-head">
                    <span class="jw-kid">{{ selectedItem.id }}</span>
                    <h2>{{ selectedRuleView.label }}</h2>
                    <span class="spacer"></span>
                    <span class="jw-pill">{{ selectedRuleView.when ? '规则节点' : '路由节点' }}</span>
                  </div>
                  <div class="jw-cond-grid">
                    <div>
                      <h4>条件树</h4>
                      <div class="jw-condtree">
                        <div
                          v-for="(line, index) in conditionLines"
                          :key="index"
                          class="line"
                          :class="line.kind"
                          :style="{ paddingLeft: line.depth * 18 + 'px' }"
                        >{{ line.text || '—' }}</div>
                        <p v-if="!conditionLines.length" class="dim">无附加条件，按顺序直接命中。</p>
                      </div>
                    </div>
                    <div>
                      <h4>判断结果</h4>
                      <div class="jw-res">
                        <span class="big" :class="{ manual: activeFile === 'weight' && selectedRaw.result && selectedRaw.result.risk_weight === null }">
                          {{ activeFile === 'cls' ? (selectedRaw.result && selectedRaw.result.exposure_class || '—') : (selectedRuleView.resultText || '—') }}
                        </span>
                      </div>
                      <p v-if="selectedRuleView.basis" class="dim">{{ selectedRuleView.basis }}</p>
                    </div>
                  </div>
                  <div v-if="selectedRuleView.fields && selectedRuleView.fields.length" class="jw-sect">
                    <h4>条件字段</h4>
                    <div class="jw-chips"><span v-for="field in selectedRuleView.fields" :key="field" class="jw-chip cls">{{ field }}</span></div>
                  </div>
                </template>
                <p v-else class="dim">从左侧 Outline 选择一个规则节点，查看条件树和判断结果。</p>
              </div>

              <div v-else-if="subView === 'flow'" class="jw-card">
                <div class="jw-card-head">
                  <h2>判断流程</h2>
                  <span class="dim">从顶层分支到当前节点，命中即停</span>
                </div>
                <div v-if="flowChain.length" class="jw-flowchain">
                  <template v-for="(step, index) in flowChain" :key="step.id">
                    <span v-if="index" class="arrow">→</span>
                    <div class="step" :class="{ current: index === flowChain.length - 1 }">
                      <span class="sid mono">{{ step.id }}</span>
                      <b>{{ step.label }}</b>
                      <p>{{ step.condition || '（无附加条件，路由节点）' }}</p>
                      <span class="res">{{ step.result }}</span>
                    </div>
                  </template>
                </div>
                <p v-else class="dim">选择一个规则节点，查看从顶层分支到当前节点的判断路径。</p>
              </div>

              <div v-else-if="subView === 'route'" class="jw-card">
                <div class="jw-card-head"><h2>分类路由</h2><span class="dim">按 JSON 节点顺序执行；命中即停在对应类别</span></div>
                <div class="jw-route-list">
                  <button v-for="row in routeRows" :key="row.path" type="button" class="jw-route" @click="openRow(row.path)">
                    <span class="no">{{ row.index }}</span>
                    <span class="main">
                      <span class="head"><span class="jid">{{ row.id }}</span><b>{{ row.label }}</b></span>
                      <span class="cond">{{ row.view.whenText || '（无附加条件，路由节点）' }}</span>
                      <span class="result"><span class="big">{{ row.className || '—' }}</span><span class="dim">{{ row.view.resultText }}</span></span>
                    </span>
                  </button>
                </div>
              </div>

              <div v-else class="jw-card">
                <div class="jw-card-head"><h2>风险权重决策表</h2><span class="dim">{{ decisionRows.length }} 条规则</span></div>
                <div class="jw-filter">
                  <input v-model="decisionQuery" type="search" placeholder="筛选：编号 / 类别 / 权重 / 条件字段" />
                </div>
                <table class="jw-dtable jw-decision">
                  <thead><tr><th>#</th><th>编号</th><th>顶层分支</th><th>适用条件</th><th>权重</th><th>参数表</th><th>依据</th></tr></thead>
                  <tbody>
                    <tr v-for="(row, index) in decisionRows" :key="row.path" @click="openRow(row.path)">
                      <td>{{ index + 1 }}</td>
                      <td class="mono">{{ row.node.id }}</td>
                      <td class="mono dim">{{ row.top }}</td>
                      <td class="cond">{{ row.view.whenText || '—' }}</td>
                      <td><span class="weight" :class="{ manual: row.weight === null }">{{ weightText(row.weight) }}</span></td>
                      <td><span v-if="row.table" class="jw-chip ref">{{ row.table }}</span><span v-else class="dim">—</span></td>
                      <td class="dim">{{ row.basis || '—' }}</td>
                    </tr>
                  </tbody>
                </table>
                <p v-if="!decisionRows.length" class="dim">没有匹配的规则。</p>
              </div>
            </template>

            <div v-else class="jw-card">
              <div class="jw-card-head"><h2>{{ subView === 'refs' ? '引用关系' : '表结构' }}</h2></div>
              <template v-if="subView === 'schema'">
                <dl class="jw-kv">
                  <dt>名称</dt><dd class="mono">{{ currentBody.tableId || currentBody.listId || '—' }}</dd>
                  <dt>标题</dt><dd>{{ currentBody.title || '—' }}</dd>
                  <dt>列</dt><dd>{{ (currentBody.columns || []).length }}</dd>
                  <dt>数据行</dt><dd>{{ (currentBody.rows || []).length }}</dd>
                </dl>
                <div class="jw-chips" style="margin-top: 10px">
                  <span v-for="column in currentBody.columns || []" :key="column" class="jw-chip ref">{{ column }}</span>
                </div>
              </template>
              <p v-else class="dim">引用关系在分类规则、风险权重规则和产品映射中按节点查看；参数表和名单的结构与数据在「业务逻辑」视图维护。</p>
            </div>
          </div>

          <div v-else class="jw-source">
            <div class="jw-source-bar">
              <span class="mono">{{ currentBody ? (currentBody.name || currentBody.tableId || currentBody.listId) : "" }}</span>
              <span class="spacer"></span>
              <button type="button" class="btn sm" @click="syncSource">格式化/还原</button>
              <button type="button" class="btn sm" :disabled="readonly" @click="applySource">应用 JSON</button>
            </div>
            <textarea v-model="sourceText" spellcheck="false" :readonly="readonly" @input="onSourceInput"></textarea>
          </div>
        </div>
      </section>

      <aside v-if="showPanel" class="jw-panel">
        <div class="jw-panel-head">
          <b>校验结果</b><span class="jw-pill">{{ issues.length }}</span>
          <span class="spacer"></span>
          <button type="button" class="btn sm" @click="showPanel = false">×</button>
        </div>
        <div class="jw-panel-body">
          <div v-for="(item, index) in issues" :key="index" class="jw-err">
            <span class="tag">问题</span><span>{{ item }}</span>
          </div>
          <p v-if="!issues.length" class="dim">没有发现问题。</p>
        </div>
      </aside>
    </div>
  </div>
</template>
