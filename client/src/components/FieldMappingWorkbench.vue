<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import Drawer from "@/components/Drawer.vue";
import { askConfirm } from "@/utils/confirm";
import { fetchRuleDocument } from "@/api/config";
import WhenEditor from "@/components/WhenEditor.vue";
import {
  MAPPING_TYPES, STEP_CATEGORIES, engineTransformType, mappingTypeLabel, newStep,
  runLink, stepCategoryLabel, stepSummary, stepType, validateLink
} from "@/utils/mappingSteps";

const props = defineProps({
  meta: { type: Object, default: null },
  document: { type: Object, required: true },
  docs: { type: Array, default: () => [] },
  standardFields: { type: Array, default: () => [] },
  standardFieldGroups: { type: Array, default: () => [] }
});
const emit = defineEmits(["save"]);

const classDoc = ref(null);
const weightDoc = ref(null);
const loading = ref(true);
const error = ref("");
const notice = ref("");
const links = ref([]);
const selectedId = ref("");
const configOpen = ref(false);
const checkOpen = ref(false);
const stepPicker = ref("");
const editingStepId = ref("");
const testValues = ref({});
const testResult = ref(null);
const searchSource = ref("");
const searchTarget = ref("");
const groupSource = ref("");
const groupTarget = ref("");
const statusSource = ref("all");
const statusTarget = ref("all");
const zoom = ref(1);
const pan = ref({ x: 12, y: 12 });
const canvas = ref(null);
const connecting = ref(null);
const highlight = ref("");
const selectedSources = ref([]);
const selectedTargets = ref([]);
const offsets = ref({});
const viewMode = ref((() => { try { return localStorage.getItem("rwa-fm-view") || "list"; } catch (err) { return "list"; } })());
const openSourceGroups = ref({});
const openTargetGroups = ref({});
const mappingSearch = ref("");
const mappingStatus = ref("all");
const mappingLimit = ref(20);
const selectedMappings = ref([]);
const newSources = ref({});
const initialLinks = ref([]);
let panState = null;
let nodeDrag = null;

const NODE_W = 250;
const NODE_H = 46;
const ROW_H = 56;
const LEFT_X = 16;
const RIGHT_X = 490;
const WORLD_W = 760;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const standardGroupMeta = computed(() => {
  const map = new Map();
  (props.standardFieldGroups || []).forEach((group, index) => {
    const id = group && (group.group_id || group.id);
    if (!id) return;
    map.set(id, {
      label: group.label || id,
      order: index
    });
  });
  return map;
});

const sourceFields = computed(() => {
  const map = new Map();
  (props.document.mappings || []).forEach((mapping) => {
    if (!mapping || !mapping.source_field || map.has(mapping.source_field)) return;
    map.set(mapping.source_field, {
      name: mapping.source_field,
      label: mapping.description || mapping.source_field,
      type: mapping.source_type || "string",
      unit: mapping.unit || "",
      description: mapping.description || ""
    });
  });
  const standardByName = {};
  (props.standardFields || []).forEach((field) => {
    if (!field || !field.name) return;
    standardByName[field.name] = field;
    if (map.has(field.name)) return;
    map.set(field.name, {
      name: field.name,
      label: field.label || field.name,
      type: field.type || "string",
      unit: "",
      description: field.label || ""
    });
  });
  map.forEach((field) => {
    const standard = standardByName[field.name] || {};
    const group = standard.group || "UNGROUPED";
    const meta = standardGroupMeta.value.get(group);
    field.group = group;
    field.groupLabel = meta ? meta.label : group === "UNGROUPED" ? "未分组" : group;
    field.groupOrder = meta ? meta.order : 999;
  });
  return Array.from(map.values());
});

const targetGroupMeta = computed(() => {
  const map = new Map();
  let sequence = 0;
  const add = (doc) => {
    (doc && doc.field_groups ? doc.field_groups : []).forEach((group, index) => {
      if (!group || !group.group_id || map.has(group.group_id)) return;
      map.set(group.group_id, {
        label: group.label || group.group_id,
        order: typeof group.order === "number" ? group.order : index + sequence
      });
      sequence += 1;
    });
  };
  add(classDoc.value);
  add(weightDoc.value);
  return map;
});

const targetFields = computed(() => {
  const list = [];
  const seen = new Set();
  const push = (field, docLabel) => {
    if (!field || !field.name || seen.has(field.name)) return;
    seen.add(field.name);
    const group = field.group || "UNGROUPED";
    const meta = targetGroupMeta.value.get(group);
    list.push({
      name: field.name,
      label: field.label || field.name,
      type: field.type || "string",
      group: group,
      groupLabel: meta ? meta.label : group === "UNGROUPED" ? "未分组" : group,
      groupOrder: meta ? meta.order : 999,
      required: field.required === true || field.missing_policy === "fail",
      missingPolicy: field.missing_policy || "",
      doc: docLabel
    });
  };
  ((classDoc.value && classDoc.value.fields) || []).forEach((field) => push(field, "分类"));
  ((weightDoc.value && weightDoc.value.fields) || []).forEach((field) => push(field, "权重"));
  (props.document.mappings || []).forEach((mapping) => {
    if (!mapping || !mapping.target_field || seen.has(mapping.target_field)) return;
    seen.add(mapping.target_field);
    list.push({
      name: mapping.target_field,
      label: mapping.target_field,
      type: mapping.target_type || "string",
      group: "UNGROUPED",
      groupLabel: "未在规则集定义",
      groupOrder: 1000,
      required: mapping.required === true,
      missingPolicy: mapping.missing_policy || "",
      doc: "未定义"
    });
  });
  return list;
});

const sourceMap = computed(() => {
  const map = {};
  sourceFields.value.forEach((field) => { map[field.name] = field; });
  return map;
});

const targetMap = computed(() => {
  const map = {};
  targetFields.value.forEach((field) => { map[field.name] = field; });
  return map;
});

const mappedTargets = computed(() => {
  const set = new Set();
  links.value.forEach((link) => set.add(link.target));
  return set;
});

const mappedSourceCount = computed(() => {
  const set = new Set();
  links.value.forEach((link) => (link.sources || [link.source]).forEach((name) => set.add(name)));
  return set;
});

const completion = computed(() => {
  const total = targetFields.value.length;
  const mapped = targetFields.value.filter((field) => mappedTargets.value.has(field.name)).length;
  const required = targetFields.value.filter((field) => field.required);
  const requiredMapped = required.filter((field) => mappedTargets.value.has(field.name)).length;
  return {
    total: total,
    mapped: mapped,
    rate: total ? Math.round((mapped / total) * 100) : 0,
    required: required.length,
    requiredMapped: requiredMapped,
    requiredRate: required.length ? Math.round((requiredMapped / required.length) * 100) : 100
  };
});

function groupOptionsOf(fields) {
  const seen = new Map();
  fields.forEach((field) => {
    const code = field.group || "UNGROUPED";
    if (!seen.has(code)) seen.set(code, field.groupLabel || code);
  });
  return Array.from(seen.entries()).map(([code, label]) => ({ code, label }));
}
const sourceGroupOptions = computed(() => groupOptionsOf(sourceFields.value));
const targetGroupOptions = computed(() => groupOptionsOf(targetFields.value));

const filteredSources = computed(() => {
  const text = searchSource.value.trim().toLowerCase();
  return sourceFields.value.filter((field) => {
    if (groupSource.value && (field.group || "UNGROUPED") !== groupSource.value) return false;
    if (statusSource.value === "mapped" && !mappedSourceCount.value.has(field.name)) return false;
    if (statusSource.value === "unmapped" && mappedSourceCount.value.has(field.name)) return false;
    if (!text) return true;
    return (field.name + " " + field.label + " " + field.description).toLowerCase().includes(text);
  });
});

const filteredTargets = computed(() => {
  const text = searchTarget.value.trim().toLowerCase();
  return targetFields.value.filter((field) => {
    if (groupTarget.value && (field.group || "UNGROUPED") !== groupTarget.value) return false;
    if (statusTarget.value === "mapped" && !mappedTargets.value.has(field.name)) return false;
    if (statusTarget.value === "unmapped" && mappedTargets.value.has(field.name)) return false;
    if (statusTarget.value === "required" && !field.required) return false;
    if (!text) return true;
    return (field.name + " " + field.label + " " + field.doc).toLowerCase().includes(text);
  });
});

function sourceGroupOf(field) {
  return {
    key: "g:" + (field.group || "UNGROUPED"),
    label: field.groupLabel || field.group || "未分组",
    order: field.groupOrder == null ? 999 : field.groupOrder
  };
}

function targetGroupOf(field) {
  return {
    key: "g:" + (field.group || "UNGROUPED"),
    label: field.groupLabel || field.group || "未分组",
    order: field.groupOrder == null ? 999 : field.groupOrder
  };
}

function groupFields(fields, groupOf, selectedSet) {
  const map = new Map();
  fields.forEach((field) => {
    const group = groupOf(field);
    if (!map.has(group.key)) {
      map.set(group.key, { key: group.key, label: group.label, order: group.order, fields: [], selected: 0 });
    }
    const item = map.get(group.key);
    item.fields.push(field);
    if (selectedSet && selectedSet.has(field.name)) item.selected += 1;
  });
  return Array.from(map.values()).sort((left, right) => {
    const delta = (left.order == null ? 999 : left.order) - (right.order == null ? 999 : right.order);
    return delta || String(left.label).localeCompare(String(right.label), "zh");
  });
}

const sourceGroups = computed(() => groupFields(filteredSources.value, sourceGroupOf, selectedSourceSet.value));
const targetGroups = computed(() => groupFields(filteredTargets.value, targetGroupOf, selectedTargetSet.value));

function groupOpen(kind, key) {
  const state = kind === "source" ? openSourceGroups.value : openTargetGroups.value;
  return !!state[key];
}

function toggleGroup(kind, key) {
  const state = kind === "source" ? openSourceGroups : openTargetGroups;
  state.value = { ...state.value, [key]: !state.value[key] };
}

function expandGroups(kind, open) {
  const groups = kind === "source" ? sourceGroups.value : targetGroups.value;
  const next = {};
  groups.forEach((group) => { next[group.key] = open; });
  if (kind === "source") openSourceGroups.value = next;
  else openTargetGroups.value = next;
}

const selectedSourceSet = computed(() => new Set(selectedSources.value));
const selectedTargetSet = computed(() => new Set(selectedTargets.value));

function lineSources(link) {
  return link.sources && link.sources.length ? link.sources : [link.source];
}

const visibleSourceSet = computed(() => {
  if (!selectedSources.value.length && !selectedTargets.value.length) {
    return new Set(sourceFields.value.map((field) => field.name));
  }
  const set = new Set(selectedSources.value);
  links.value.forEach((link) => {
    if (selectedTargetSet.value.has(link.target)) {
      lineSources(link).forEach((name) => set.add(name));
    }
  });
  return set;
});

const visibleTargetSet = computed(() => {
  if (!selectedSources.value.length && !selectedTargets.value.length) {
    return new Set(targetFields.value.map((field) => field.name));
  }
  const set = new Set(selectedTargets.value);
  links.value.forEach((link) => {
    if (lineSources(link).some((name) => selectedSourceSet.value.has(name))) set.add(link.target);
  });
  return set;
});

const visibleSources = computed(() => sourceFields.value.filter((field) => visibleSourceSet.value.has(field.name)));
const visibleTargets = computed(() => targetFields.value.filter((field) => visibleTargetSet.value.has(field.name)));

function offsetFor(kind, name) {
  const item = offsets.value[kind + ":" + name];
  return item ? { dx: item.dx || 0, dy: item.dy || 0 } : { dx: 0, dy: 0 };
}

const sourceNodes = computed(() => visibleSources.value.map((field, index) => {
  const offset = offsetFor("source", field.name);
  return {
    ...field,
    id: "s_" + field.name,
    kind: "source",
    x: LEFT_X + offset.dx,
    y: 28 + index * ROW_H + offset.dy,
    w: NODE_W,
    h: NODE_H,
    selected: selectedSourceSet.value.has(field.name)
  };
}));

const targetNodes = computed(() => visibleTargets.value.map((field, index) => {
  const offset = offsetFor("target", field.name);
  return {
    ...field,
    id: "t_" + field.name,
    kind: "target",
    x: RIGHT_X + offset.dx,
    y: 28 + index * ROW_H + offset.dy,
    w: NODE_W,
    h: NODE_H,
    mapped: mappedTargets.value.has(field.name),
    selected: selectedTargetSet.value.has(field.name)
  };
}));

const worldSize = computed(() => {
  let maxX = WORLD_W;
  let maxY = 200;
  sourceNodes.value.concat(targetNodes.value).forEach((node) => {
    maxX = Math.max(maxX, node.x + node.w + 40);
    maxY = Math.max(maxY, node.y + node.h + 40);
  });
  return { w: maxX, h: maxY };
});

const worldStyle = computed(() => ({
  transform: "translate(" + pan.value.x + "px," + pan.value.y + "px) scale(" + zoom.value + ")"
}));

const selectedLink = computed(() => links.value.find((link) => link.id === selectedId.value) || null);

const editingStep = computed(() => {
  if (!selectedLink.value) return null;
  return (selectedLink.value.steps || []).find((step) => step.id === editingStepId.value) || null;
});
const editingStepDef = computed(() => (editingStep.value ? stepType(editingStep.value.type) : null));

const stepOptions = computed(() => STEP_CATEGORIES);

const stepFields = computed(() => [
  { name: "$value", label: "当前值", type: "string" },
  ...sourceFields.value.map((field) => ({ name: field.name, label: field.label, type: field.type }))
]);


const issueMap = computed(() => {
  const map = {};
  links.value.forEach((link) => { map[link.id] = validateLink(link, sourceMap.value, targetMap.value); });
  return map;
});

function lineStatus(link) {
  if (link.enabled === false) return "disabled";
  if ((issueMap.value[link.id] || []).length) return "invalid";
  if (link.mappingType !== "direct" && !(link.steps || []).length) return "pending";
  return "configured";
}

function lineTitle(link) {
  const status = { configured: "已配置", pending: "待配置", invalid: "配置有误", disabled: "已禁用" }[lineStatus(link)] || "";
  return lineSources(link).join(" + ") + " → " + link.target + " · " + mappingTypeLabel(link.mappingType) + " · " + (link.steps || []).length + " 个步骤 · " + status;
}

const lines = computed(() => {
  const entries = [];
  links.value.forEach((link) => {
    lineSources(link).forEach((sourceName, sourceIndex) => {
      const from = sourceNodes.value.find((node) => node.name === sourceName);
      const to = targetNodes.value.find((node) => node.name === link.target);
      if (!from || !to) return;
      entries.push({ link: link, sourceName: sourceName, sourceIndex: sourceIndex, from: from, to: to });
    });
  });
  const byTarget = new Map();
  const bySource = new Map();
  entries.forEach((entry) => {
    if (!byTarget.has(entry.to.name)) byTarget.set(entry.to.name, []);
    byTarget.get(entry.to.name).push(entry);
    if (!bySource.has(entry.from.name)) bySource.set(entry.from.name, []);
    bySource.get(entry.from.name).push(entry);
  });
  byTarget.forEach((list) => list.sort((a, b) => a.from.y - b.from.y));
  bySource.forEach((list) => list.sort((a, b) => a.to.y - b.to.y));
  return entries.map((entry) => {
    const inList = byTarget.get(entry.to.name) || [];
    const outList = bySource.get(entry.from.name) || [];
    const inIndex = inList.indexOf(entry);
    const outIndex = outList.indexOf(entry);
    const x1 = entry.from.x + entry.from.w;
    const y1 = outList.length > 1
      ? entry.from.y + entry.from.h * (outIndex + 1) / (outList.length + 1)
      : entry.from.y + entry.from.h / 2;
    const x2 = entry.to.x;
    const y2 = inList.length > 1
      ? entry.to.y + entry.to.h * (inIndex + 1) / (inList.length + 1)
      : entry.to.y + entry.to.h / 2;
    const mx = (x1 + x2) / 2;
    return {
      id: entry.link.id + "_" + entry.sourceIndex,
      linkId: entry.link.id,
      d: "M" + x1 + "," + y1 + " C" + mx + "," + y1 + " " + mx + "," + y2 + " " + x2 + "," + y2,
      lx: mx,
      ly: (y1 + y2) / 2,
      selected: selectedId.value === entry.link.id,
      type: entry.link.mappingType,
      status: lineStatus(entry.link),
      title: lineTitle(entry.link),
      label: mappingTypeLabel(entry.link.mappingType) + " · " + (entry.link.steps || []).length + " 步"
    };
  });
});

const tempLine = computed(() => {
  if (!connecting.value) return null;
  const from = sourceNodes.value.find((node) => node.name === connecting.value.source);
  if (!from) return null;
  const x1 = from.x + from.w;
  const y1 = from.y + from.h / 2;
  const x2 = connecting.value.x;
  const y2 = connecting.value.y;
  const mx = (x1 + x2) / 2;
  return { d: "M" + x1 + "," + y1 + " C" + mx + "," + y1 + " " + mx + "," + y2 + " " + x2 + "," + y2 };
});

const LINK_STATUS_LABELS = {
  configured: "已映射",
  pending: "待配置",
  invalid: "配置有误",
  disabled: "已禁用"
};

const ruleFieldNames = computed(() => {
  const set = new Set();
  const walkDoc = (doc) => {
    const visit = (node) => {
      if (!node || typeof node !== "object") return;
      (node.fields || []).forEach((name) => set.add(name));
      (node.children || []).forEach(visit);
      if (node.otherwise && node.otherwise.id) visit(node.otherwise);
    };
    ((doc && doc.rules) || []).forEach(visit);
  };
  walkDoc(classDoc.value);
  walkDoc(weightDoc.value);
  return set;
});

const overview = computed(() => {
  const required = targetFields.value.filter((field) => field.required);
  const ruleFields = targetFields.value.filter((field) => ruleFieldNames.value.has(field.name));
  const ruleMapped = ruleFields.filter((field) => mappedTargets.value.has(field.name)).length;
  return {
    sourceTotal: sourceFields.value.length,
    sourceUsed: mappedSourceCount.value.size,
    targetTotal: targetFields.value.length,
    targetMapped: mappedTargets.value.size,
    requiredTotal: required.length,
    requiredUnmapped: required.filter((field) => !mappedTargets.value.has(field.name)).length,
    ruleTotal: ruleFields.length,
    ruleMapped: ruleMapped,
    progress: targetFields.value.length ? Math.round((mappedTargets.value.size / targetFields.value.length) * 100) : 0
  };
});

const mappingRows = computed(() => {
  const text = mappingSearch.value.trim().toLowerCase();
  return targetFields.value.map((field) => {
    const link = targetLinks(field.name)[0] || null;
    const sources = link
      ? lineSources(link).map((name) => sourceMap.value[name] || { name: name, label: name, type: "string" })
      : [];
    const status = link ? lineStatus(link) : "unmapped";
    return {
      field: field,
      link: link,
      sources: sources,
      status: status,
      statusLabel: link ? (LINK_STATUS_LABELS[status] || status) : "待映射",
      typeLabel: link ? mappingTypeLabel(link.mappingType) : "—",
      stepCount: link ? (link.steps || []).length : 0,
      isRuleField: ruleFieldNames.value.has(field.name)
    };
  }).filter((row) => {
    if (mappingStatus.value === "pending" && row.link) return false;
    if (mappingStatus.value === "mapped" && !row.link) return false;
    if (mappingStatus.value === "error" && row.status !== "invalid") return false;
    if (mappingStatus.value === "disabled" && row.status !== "disabled") return false;
    if (mappingTypeFilter.value && (!row.link || row.link.mappingType !== mappingTypeFilter.value)) return false;
    if (!text) return true;
    return [
      row.field.name, row.field.label, row.field.type, row.field.doc,
      ...row.sources.map((item) => item.name + " " + item.label),
      row.typeLabel
    ].join(" ").toLowerCase().includes(text);
  });
});

const selectionActive = computed(() => selectedSources.value.length > 0 || selectedTargets.value.length > 0);
const linkedMappingRows = computed(() => {
  if (!selectionActive.value) return mappingRows.value;
  const sources = new Set(selectedSources.value);
  const targets = new Set(selectedTargets.value);
  return mappingRows.value.filter((row) => {
    if (targets.has(row.field.name)) return true;
    if (sources.size && row.sources.some((source) => sources.has(source.name))) return true;
    return false;
  });
});
const visibleMappingRows = computed(() => linkedMappingRows.value.slice(0, mappingLimit.value));
const hasMoreMappings = computed(() => linkedMappingRows.value.length > mappingLimit.value);
const selectedMappingCards = computed(() => links.value.filter((link) => selectedMappings.value.includes(link.id)).map((link) => ({ link: link })));
const allVisibleMappingSelected = computed(() => {
  const ids = visibleMappingRows.value.filter((row) => row.link).map((row) => row.link.id);
  return ids.length > 0 && ids.every((id) => selectedMappings.value.includes(id));
});

const expandedRows = ref([]);
const mappingTypeFilter = ref("");
const batchType = ref("direct");

function rowExpanded(name) {
  return expandedRows.value.includes(name);
}
function toggleRow(name) {
  expandedRows.value = rowExpanded(name)
    ? expandedRows.value.filter((item) => item !== name)
    : expandedRows.value.concat(name);
}

function removeRowMapping(row) {
  if (!row || !row.link) return;
  links.value = links.value.filter((link) => link.id !== row.link.id);
  selectedMappings.value = selectedMappings.value.filter((id) => id !== row.link.id);
  if (selectedId.value === row.link.id) configOpen.value = false;
}

function batchSetType() {
  const linksSelected = selectedMappingCards.value.map((card) => card.link);
  if (!linksSelected.length) return;
  linksSelected.forEach((link) => setMappingType(link, batchType.value));
  notice.value = "已把 " + linksSelected.length + " 条映射改为 " + mappingTypeLabel(batchType.value) + "，尚未保存";
}

function indexOfSource(name) {
  return filteredSources.value.findIndex((field) => field.name === name);
}
function indexOfTarget(name) {
  return filteredTargets.value.findIndex((field) => field.name === name);
}

function toggleMappingSelection(id) {
  selectedMappings.value = selectedMappings.value.includes(id)
    ? selectedMappings.value.filter((item) => item !== id)
    : selectedMappings.value.concat(id);
}

function toggleAllMappingSelection() {
  const ids = visibleMappingRows.value.filter((row) => row.link).map((row) => row.link.id);
  const allOn = ids.length && ids.every((id) => selectedMappings.value.includes(id));
  if (allOn) selectedMappings.value = selectedMappings.value.filter((id) => !ids.includes(id));
  else selectedMappings.value = Array.from(new Set(selectedMappings.value.concat(ids)));
}

async function removeSelectedMappings() {
  if (!selectedMappingCards.value.length) return;
  const yes = await askConfirm("取消选中的 " + selectedMappingCards.value.length + " 条映射关系。字段本身不会被删除。", {
    title: "批量取消映射",
    confirmText: "取消映射",
    danger: true
  });
  if (!yes) return;
  const ids = new Set(selectedMappingCards.value.map((card) => card.link.id));
  links.value = links.value.filter((link) => !ids.has(link.id));
  selectedMappings.value = [];
  selectedId.value = "";
  if (selectedId.value && !links.value.some((link) => link.id === selectedId.value)) configOpen.value = false;
}

async function batchDirectMap() {
  const sources = selectedSources.value.slice();
  const targets = selectedTargets.value.slice();
  if (!sources.length || !targets.length) {
    error.value = "先分别在左右两侧选择源字段和目标字段";
    return;
  }
  if (sources.length !== targets.length) {
    error.value = "批量直接映射要求左右两侧选中的数量一致";
    return;
  }
  const occupied = targets.filter((name) => mappedTargets.value.has(name));
  if (occupied.length) {
    error.value = "目标字段已经存在映射：" + occupied.join("、") + "，请取消选择后再批量建立";
    return;
  }
  const yes = await askConfirm("把选中的 " + sources.length + " 组字段按顺序建立直接映射。", {
    title: "批量建立直接映射",
    confirmText: "建立映射"
  });
  if (!yes) return;
  sources.forEach((sourceName, index) => {
    links.value.push({
      id: "link_new_" + Date.now() + "_" + index,
      source: sourceName,
      sources: [sourceName],
      target: targets[index],
      mappingType: "direct",
      steps: [],
      enabled: true,
      original: null
    });
  });
  selectedSources.value = [];
  selectedTargets.value = [];
  error.value = "";
  notice.value = "已建立 " + sources.length + " 条直接映射，尚未保存到文档";
}

function setViewMode(mode) {
  viewMode.value = mode;
  try { localStorage.setItem("rwa-fm-view", mode); } catch (err) { /* ignore */ }
  if (mode === "canvas") nextTick(fitVisible);
}

function setPrimarySource(link, name) {
  if (!name) {
    link.sources = [];
    link.source = "";
    return;
  }
  link.sources = [name];
  link.source = name;
}

function createLinkFromList(targetName) {
  const sourceName = newSources.value[targetName];
  if (!sourceName) {
    error.value = "先为目标字段选择源字段";
    return;
  }
  if (targetLinks(targetName).length) {
    editLink(targetLinks(targetName)[0]);
    return;
  }
  const link = {
    id: "link_new_" + Date.now(),
    source: sourceName,
    sources: [sourceName],
    target: targetName,
    mappingType: "direct",
    steps: [],
    enabled: true,
    original: null
  };
  links.value.push(link);
  editLink(link);
}

function saveAndClose() {
  if (!selectedLink.value) return;
  if (!lineSources(selectedLink.value)[0]) {
    error.value = "先选择源字段";
    return;
  }
  save();
  configOpen.value = false;
}

const issues = computed(() => {
  const list = [];
  links.value.forEach((link) => {
    (issueMap.value[link.id] || []).forEach((message) => list.push({ link: link, message: message }));
  });
  targetFields.value.filter((field) => field.required && !mappedTargets.value.has(field.name)).forEach((field) => {
    list.push({ link: null, message: "必填目标字段 " + field.name + " 还没有映射" });
  });
  return list;
});

function targetLinks(name) {
  return links.value.filter((link) => link.target === name);
}

function sourceLinkCount(name) {
  return links.value.filter((link) => lineSources(link).includes(name)).length;
}

function loadLinks() {
  links.value = (props.document.mappings || []).map((mapping, index) => {
    const params = (mapping.transform && mapping.transform.parameters) || {};
    const transformType = (mapping.transform && mapping.transform.type) || "direct";
    let mappingType = params.mappingType;
    if (!mappingType) {
      if (transformType === "direct") mappingType = "direct";
      else if (transformType === "conditional") mappingType = "conditional";
      else if (transformType === "calculation") mappingType = "calculation";
      else mappingType = "transform";
    }
    let steps = params.steps || [];
    if (!steps.length && mapping.transform && mapping.transform.mapping && typeof mapping.transform.mapping === "object") {
      const step = newStep("code_map");
      step.params.map = Object.keys(mapping.transform.mapping).map((from) => ({ from: from, to: mapping.transform.mapping[from] }));
      steps = [step];
    }
    return {
      id: "link_" + index + "_" + mapping.target_field,
      source: mapping.source_field,
      sources: params.sources && params.sources.length ? params.sources : [mapping.source_field],
      target: mapping.target_field,
      mappingType: mappingType,
      steps: steps,
      enabled: params.enabled !== false,
      original: mapping
    };
  });
  initialLinks.value = clone(links.value);
}

async function loadDocs() {
  loading.value = true;
  error.value = "";
  try {
    const classMeta = props.docs.find((item) => item.kind === "exposure_classification");
    const weightMeta = props.docs.find((item) => item.kind === "risk_weight");
    const [classResult, weightResult] = await Promise.all([
      classMeta ? fetchRuleDocument(classMeta.id) : Promise.resolve(null),
      weightMeta ? fetchRuleDocument(weightMeta.id) : Promise.resolve(null)
    ]);
    classDoc.value = classResult ? classResult.body : null;
    weightDoc.value = weightResult ? weightResult.body : null;
  } catch (err) {
    error.value = err.message || "加载目标字段失败";
  } finally {
    loading.value = false;
  }
}

function fit() {
  const box = canvas.value;
  if (!box) return;
  const available = Math.max(320, box.clientWidth - 24);
  zoom.value = Math.max(0.35, Math.min(1, available / WORLD_W));
  pan.value = { x: 12, y: 12 };
}

function zoomBy(factor) {
  zoom.value = Math.max(0.2, Math.min(2.2, zoom.value * factor));
}

function fitVisible() {
  const box = canvas.value;
  const nodes = sourceNodes.value.concat(targetNodes.value);
  if (!box || !nodes.length) {
    fit();
    return;
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  nodes.forEach((node) => {
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x + node.w);
    maxY = Math.max(maxY, node.y + node.h);
  });
  const width = Math.max(120, maxX - minX);
  const height = Math.max(120, maxY - minY);
  const availableW = Math.max(260, box.clientWidth - 48);
  const availableH = Math.max(200, box.clientHeight - 48);
  const next = Math.min(1.25, Math.max(0.3, Math.min(availableW / width, availableH / height)));
  zoom.value = next;
  pan.value = {
    x: (box.clientWidth - width * next) / 2 - minX * next,
    y: (box.clientHeight - height * next) / 2 - minY * next
  };
}

const layoutKey = computed(() => "rwa-fm-layout:" + ((props.meta && props.meta.name) || (props.document && props.document.mapping_name) || "default"));

function loadOffsets() {
  try {
    offsets.value = JSON.parse(localStorage.getItem(layoutKey.value) || "{}") || {};
  } catch (err) {
    offsets.value = {};
  }
}
function saveOffsets() {
  try { localStorage.setItem(layoutKey.value, JSON.stringify(offsets.value)); } catch (err) { /* ignore */ }
}
function autoLayout() {
  offsets.value = {};
  saveOffsets();
  nextTick(fitVisible);
}
function resetLayout() {
  offsets.value = {};
  saveOffsets();
  nextTick(fit);
}

let sourceAnchor = -1;
let targetAnchor = -1;

function pickSourceRow(field, index, event) {
  if (event && event.shiftKey && sourceAnchor >= 0) {
    const list = filteredSources.value;
    const start = Math.min(sourceAnchor, index);
    const end = Math.max(sourceAnchor, index);
    const names = list.slice(start, end + 1).map((item) => item.name);
    selectedSources.value = Array.from(new Set(selectedSources.value.concat(names)));
  } else {
    toggleSource(field.name);
  }
  sourceAnchor = index;
}

function pickTargetRow(field, index, event) {
  if (event && event.shiftKey && targetAnchor >= 0) {
    const list = filteredTargets.value;
    const start = Math.min(targetAnchor, index);
    const end = Math.max(targetAnchor, index);
    const names = list.slice(start, end + 1).map((item) => item.name);
    selectedTargets.value = Array.from(new Set(selectedTargets.value.concat(names)));
  } else {
    toggleTarget(field.name);
  }
  targetAnchor = index;
}

function toggleSource(name) {
  selectedSources.value = selectedSources.value.includes(name)
    ? selectedSources.value.filter((item) => item !== name)
    : selectedSources.value.concat(name);
}
function toggleTarget(name) {
  selectedTargets.value = selectedTargets.value.includes(name)
    ? selectedTargets.value.filter((item) => item !== name)
    : selectedTargets.value.concat(name);
}
function selectAllSources() { selectedSources.value = filteredSources.value.map((field) => field.name); }
function clearSources() { selectedSources.value = []; }
function selectAllTargets() { selectedTargets.value = filteredTargets.value.map((field) => field.name); }
function clearTargets() { selectedTargets.value = []; }

function clearSourceFilters() {
  searchSource.value = "";
  groupSource.value = "";
  statusSource.value = "all";
  selectedSources.value = [];
}
function clearTargetFilters() {
  searchTarget.value = "";
  groupTarget.value = "";
  statusTarget.value = "all";
  selectedTargets.value = [];
}

function startNodeDrag(node, event) {
  if (event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  const offset = offsetFor(node.kind, node.name);
  nodeDrag = {
    kind: node.kind,
    name: node.name,
    sx: event.clientX,
    sy: event.clientY,
    dx: offset.dx,
    dy: offset.dy,
    moved: false
  };
  window.addEventListener("pointermove", moveNodeDrag);
  window.addEventListener("pointerup", endNodeDrag);
}
function moveNodeDrag(event) {
  if (!nodeDrag) return;
  const mx = event.clientX - nodeDrag.sx;
  const my = event.clientY - nodeDrag.sy;
  if (Math.hypot(mx, my) > 3) nodeDrag.moved = true;
  offsets.value = {
    ...offsets.value,
    [nodeDrag.kind + ":" + nodeDrag.name]: { dx: nodeDrag.dx + mx / zoom.value, dy: nodeDrag.dy + my / zoom.value }
  };
}
function endNodeDrag() {
  window.removeEventListener("pointermove", moveNodeDrag);
  window.removeEventListener("pointerup", endNodeDrag);
  if (!nodeDrag) return;
  const dragged = nodeDrag;
  nodeDrag = null;
  if (dragged.moved) {
    saveOffsets();
    return;
  }
  if (dragged.kind === "source") toggleSource(dragged.name);
  else toggleTarget(dragged.name);
}

function onNodeDoubleClick(node) {
  if (node.kind === "target") {
    const link = targetLinks(node.name)[0];
    if (link) editLink(link);
    return;
  }
  const link = links.value.find((item) => lineSources(item).includes(node.name));
  if (link) editLink(link);
}

function onCanvasDown(event) {
  if (event.target.closest(".fm-node") || event.target.closest(".fm-line")) return;
  panState = { x: event.clientX, y: event.clientY, ox: pan.value.x, oy: pan.value.y };
  canvas.value.setPointerCapture(event.pointerId);
}
function onCanvasMove(event) {
  if (!panState) return;
  pan.value = { x: panState.ox + event.clientX - panState.x, y: panState.oy + event.clientY - panState.y };
}
function onCanvasUp() { panState = null; }

function onWheel(event) {
  if (event.shiftKey) {
    pan.value = { x: pan.value.x - event.deltaX, y: pan.value.y - event.deltaY };
    return;
  }
  zoomBy(event.deltaY < 0 ? 1.08 : 1 / 1.08);
}

function worldPoint(clientX, clientY) {
  const rect = canvas.value.getBoundingClientRect();
  return {
    x: (clientX - rect.left - pan.value.x) / zoom.value,
    y: (clientY - rect.top - pan.value.y) / zoom.value
  };
}

function startConnect(field, event) {
  if (event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  connecting.value = { source: field.name, x: 0, y: 0 };
  const point = worldPoint(event.clientX, event.clientY);
  connecting.value.x = point.x;
  connecting.value.y = point.y;
  window.addEventListener("pointermove", moveConnect);
  window.addEventListener("pointerup", endConnect);
}
function moveConnect(event) {
  if (!connecting.value) return;
  const point = worldPoint(event.clientX, event.clientY);
  connecting.value.x = point.x;
  connecting.value.y = point.y;
}
function endConnect(event) {
  window.removeEventListener("pointermove", moveConnect);
  window.removeEventListener("pointerup", endConnect);
  if (!connecting.value) return;
  const sourceName = connecting.value.source;
  connecting.value = null;
  const element = document.elementFromPoint(event.clientX, event.clientY);
  const node = element && element.closest ? element.closest(".fm-node.target") : null;
  if (!node) return;
  const targetName = node.getAttribute("data-name");
  if (!targetName) return;
  const existing = links.value.find((link) => link.target === targetName);
  if (existing) {
    selectedId.value = existing.id;
    configOpen.value = true;
    return;
  }
  const source = sourceMap.value[sourceName];
  if (!source) return;
  const link = {
    id: "link_new_" + Date.now(),
    source: sourceName,
    sources: [sourceName],
    target: targetName,
    mappingType: "direct",
    steps: [],
    enabled: true,
    original: null
  };
  links.value.push(link);
  selectedId.value = link.id;
  editLink(link);
}

function focusNode(node) {
  if (!node) return;
  highlight.value = node.id;
  pan.value = { x: pan.value.x, y: 80 - node.y * zoom.value };
}

function openSource(field) {
  focusNode(sourceNodes.value.find((node) => node.name === field.name));
}

function openTarget(field) {
  focusNode(targetNodes.value.find((node) => node.name === field.name));
  const link = targetLinks(field.name)[0];
  if (link) {
    selectedId.value = link.id;
    configOpen.value = true;
  }
}

function selectLine(line) {
  selectedId.value = line.linkId;
}

function editLine(linkId) {
  const link = links.value.find((item) => item.id === linkId);
  if (link) editLink(link);
}

function editLink(link) {
  selectedId.value = link.id;
  configOpen.value = true;
  editingStepId.value = "";
  testResult.value = null;
  testValues.value = {};
  lineSources(link).forEach((name) => {
    if (testValues.value[name] === undefined) {
      const field = sourceMap.value[name];
      testValues.value[name] = field && field.type === "number" ? 100 : field && field.type === "boolean" ? true : "示例";
    }
  });
}

function targetNodeTitle(field) {
  const link = targetLinks(field.name)[0];
  if (!link) return "未映射";
  const status = { configured: "已配置", pending: "待配置", invalid: "配置有误", disabled: "已禁用" }[lineStatus(link)] || "";
  return mappingTypeLabel(link.mappingType) + " · " + (link.steps || []).length + " 个处理步骤 · " + status;
}

function addSourceToLink(link, name) {
  if (!link.sources.includes(name)) link.sources = link.sources.concat(name);
}

function removeSourceFromLink(link, name) {
  if (link.sources.length <= 1) return;
  link.sources = link.sources.filter((item) => item !== name);
}

function toggleCompositeSource(link, name, checked) {
  if (checked) addSourceToLink(link, name);
  else removeSourceFromLink(link, name);
}

function addStep(link) {
  if (!stepPicker.value) return;
  const step = newStep(stepPicker.value);
  link.steps = (link.steps || []).concat(step);
  if (link.mappingType === "direct") link.mappingType = "transform";
  editingStepId.value = step.id;
  stepPicker.value = "";
}

function editStepLink(link, step) {
  editingStepId.value = step.id;
  const type = stepType(step.type);
  if (type && !step.name) step.name = type.label;
}

function setMappingType(link, value) {
  link.mappingType = value;
  if (value !== "composite" && link.sources.length > 1) link.sources = [link.sources[0]];
}

function removeStep(link, index) {
  link.steps.splice(index, 1);
  editingStepId.value = "";
}

function moveStep(link, index, delta) {
  const target = index + delta;
  if (target < 0 || target >= link.steps.length) return;
  const list = link.steps.slice();
  const item = list.splice(index, 1)[0];
  list.splice(target, 0, item);
  link.steps = list;
}

function addCase(step) {
  if (!step.params.cases) step.params.cases = [];
  step.params.cases.push({ when: { field: "$value", op: "eq", match: "" }, value: "" });
}
function removeCase(step) {
  step.params.cases.pop();
}
function addPair(step, key) {
  if (!step.params[key]) step.params[key] = [];
  step.params[key].push({ from: "", to: "" });
}
function removePair(step, key) {
  step.params[key].pop();
}
function toggleStepField(step, key, name, checked) {
  if (!step.params[key]) step.params[key] = [];
  if (checked) {
    if (!step.params[key].includes(name)) step.params[key] = step.params[key].concat(name);
  } else {
    step.params[key] = step.params[key].filter((item) => item !== name);
  }
}

function deleteLink() {
  if (!selectedLink.value) return;
  links.value = links.value.filter((link) => link.id !== selectedLink.value.id);
  selectedId.value = "";
  configOpen.value = false;
}

function fillSample() {
  const link = selectedLink.value;
  if (!link) return;
  const values = {};
  lineSources(link).forEach((name, index) => {
    const field = sourceMap.value[name];
    if (!field) return;
    if (field.type === "number") values[name] = 100 + index;
    else if (field.type === "boolean") values[name] = true;
    else if (field.type === "date") values[name] = "2026-01-01";
    else values[name] = "示例" + (index + 1);
  });
  testValues.value = values;
}

function runTest() {
  if (!selectedLink.value) return;
  const sample = {};
  Object.keys(testValues.value).forEach((key) => {
    sample[key] = testValues.value[key];
  });
  testResult.value = runLink(selectedLink.value, sample);
}

function openCheck() {
  checkOpen.value = true;
}

function currentBody() {
  const mappings = links.value.filter((link) => lineSources(link)[0]).map((link) => {
    const original = link.original || {};
    const source = sourceMap.value[link.sources[0]] || {};
    const target = targetMap.value[link.target] || {};
    const transform = Object.assign({}, original.transform || {});
    transform.type = engineTransformType(link.mappingType, link.steps);
    transform.parameters = Object.assign({}, (original.transform || {}).parameters || {}, {
      mappingType: link.mappingType,
      sources: link.sources,
      steps: link.steps,
      enabled: link.enabled !== false
    });
    return Object.assign({}, original, {
      source_field: link.sources[0],
      target_field: link.target,
      source_type: source.type || original.source_type || "string",
      target_type: target.type || original.target_type || "string",
      transform: transform,
      required: original.required !== undefined ? original.required : true,
      missing_policy: original.missing_policy || "manual_review",
      description: original.description || source.label || "",
      regulatory_reference: original.regulatory_reference || ""
    });
  });
  const body = clone(props.document);
  body.mappings = mappings;
  return body;
}

function save() {
  emit("save", currentBody());
}

function exportMappings() {
  const blob = new Blob([JSON.stringify(currentBody(), null, 2)], { type: "application/json;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = ((meta.value && meta.value.name) || (props.document && props.document.mapping_name) || "data-mapping") + ".json";
  a.click();
  URL.revokeObjectURL(a.href);
}

async function resetMappings() {
  const yes = await askConfirm("恢复为打开页面时的映射关系？当前未保存的修改会丢失。", {
    title: "重置映射",
    confirmText: "重置",
    danger: true
  });
  if (!yes) return;
  links.value = clone(initialLinks.value);
  selectedSources.value = [];
  selectedTargets.value = [];
  selectedMappings.value = [];
  notice.value = "已恢复到打开页面时的映射";
}

function clearSelections() {
  selectedSources.value = [];
  selectedTargets.value = [];
  selectedMappings.value = [];
}

watch(
  () => [props.document, props.docs],
  () => {
    loadLinks();
    nextTick(fit);
  },
  { deep: false }
);

watch([searchSource, groupSource, statusSource], () => {
  sourceAnchor = -1;
  if (searchSource.value.trim()) expandGroups("source", true);
});
watch([searchTarget, groupTarget, statusTarget], () => {
  targetAnchor = -1;
  if (searchTarget.value.trim()) expandGroups("target", true);
});
watch(mappingSearch, () => { mappingLimit.value = 20; });
watch(mappingStatus, () => { mappingLimit.value = 20; });
watch(() => [selectedSources.value.join("\n"), selectedTargets.value.join("\n")], () => { mappingLimit.value = 20; });

watch(
  () => [selectedSources.value.join("\n"), selectedTargets.value.join("\n")],
  () => {
    nextTick(() => {
      if (selectedSources.value.length || selectedTargets.value.length) fitVisible();
      else fit();
    });
  }
);

onMounted(async () => {
  window.addEventListener("keydown", onKey);
  loadOffsets();
  await loadDocs();
  loadLinks();
  await nextTick();
  fit();
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKey);
});

function onKey(event) {
  if (event.key !== "Delete" && event.key !== "Backspace") return;
  if (selectedLink.value && !configOpen.value) deleteLink();
}
</script>

<template>
  <div class="fm-shell">
    <div class="fm-head">
      <h3>字段映射</h3>
      <span class="sub mono">{{ (meta && meta.name) || (document && document.mapping_name) }}</span>
      <span class="fm-view-toggle">
        <button type="button" :class="{ active: viewMode === 'list' }" @click="setViewMode('list')">映射列表</button>
        <button type="button" :class="{ active: viewMode === 'canvas' }" @click="setViewMode('canvas')">关系画布</button>
      </span>
      <span class="spacer"></span>
      <button type="button" class="btn sm" @click="fit">适配</button>
      <button type="button" class="btn sm" @click="fitVisible">居中选中</button>
      <button type="button" class="btn sm" @click="autoLayout">自动布局</button>
      <button type="button" class="btn sm" @click="resetLayout">重置布局</button>
      <button type="button" class="btn sm" @click="zoomBy(1 / 1.12)">−</button>
      <button type="button" class="btn sm" @click="zoomBy(1.12)">+</button>
      <button type="button" class="btn sm" @click="openCheck">配置检查</button>
      <button type="button" class="btn sm primary" @click="save">保存映射</button>
    </div>

    <div class="fm-overview">
      <span>产品标准字段 <b>{{ overview.sourceUsed }}</b> / {{ overview.sourceTotal }}</span>
      <span>监管目标字段 <b>{{ overview.targetMapped }}</b> / {{ overview.targetTotal }}</span>
      <span :class="{ danger: overview.requiredUnmapped > 0 }">必填未映射 <b>{{ overview.requiredUnmapped }}</b> / {{ overview.requiredTotal }}</span>
      <span>规则字段覆盖 <b>{{ overview.ruleMapped }}</b> / {{ overview.ruleTotal }}</span>
      <span>映射关系 <b>{{ links.length }}</b></span>
      <span class="dim" style="font-size: 10.5px">映射进度</span>
      <span class="fm-progress"><i :style="{ width: overview.progress + '%' }"></i><em>{{ overview.progress }}%</em></span>
    </div>

    <p v-if="error" class="notice danger">{{ error }}</p>
    <p v-if="notice" class="notice ok">{{ notice }}</p>
    <div v-if="loading" class="loading"><span class="spin"></span>正在读取目标字段</div>

    <template v-else>
      <div class="fm-layout">
        <aside class="fm-side">
          <div class="fm-side-head">
            <strong>产品标准字段</strong><span class="dim">{{ filteredSources.length }} / {{ sourceFields.length }}</span>
          </div>
          <input v-model="searchSource" class="fm-search" type="search" placeholder="搜索字段" />
          <div class="fm-filters">
            <select v-model="groupSource">
              <option value="">全部字段大类</option>
              <option v-for="group in sourceGroupOptions" :key="group.code" :value="group.code">{{ group.label }}</option>
            </select>
            <select v-model="statusSource">
              <option value="all">全部状态</option>
              <option value="mapped">已映射</option>
              <option value="unmapped">未映射</option>
            </select>
          </div>
          <div class="fm-select-bar">
            <span>已选 <b>{{ selectedSources.length }}</b></span>
            <button type="button" class="btn sm" @click="selectAllSources">全选</button>
            <button type="button" class="btn sm" @click="clearSources">取消选择</button>
            <button type="button" class="btn sm" @click="clearSourceFilters">清空筛选</button>
          </div>
          <div class="fm-group-tools">
            <span>按标准字段所属分组</span>
            <button type="button" class="btn sm" @click="expandGroups('source', true)">展开</button>
            <button type="button" class="btn sm" @click="expandGroups('source', false)">收起</button>
          </div>
          <div class="fm-side-list">
            <div v-for="group in sourceGroups" :key="group.key" class="fm-group">
              <button type="button" class="fm-group-head" @click="toggleGroup('source', group.key)">
                <span>{{ group.label }}（{{ group.fields.length }}）</span>
                <span v-if="group.selected" class="fm-group-sel">已选 {{ group.selected }}</span>
                <span class="fm-group-arrow">{{ groupOpen('source', group.key) ? '▾' : '▸' }}</span>
              </button>
              <div v-show="groupOpen('source', group.key)">
                <div
                  v-for="field in group.fields"
                  :key="field.name"
                  class="fm-field-row"
                  :class="{ active: selectedSources.includes(field.name) || highlight === 's_' + field.name }"
                  role="button"
                  tabindex="0"
                  @click="pickSourceRow(field, indexOfSource(field.name), $event)"
                  @dblclick="openSource(field)"
                >
                  <input
                    type="checkbox"
                    class="fm-check"
                    :checked="selectedSources.includes(field.name)"
                    @click.stop
                    @change="toggleSource(field.name)"
                  />
                  <span class="fm-dot" :class="{ on: mappedSourceCount.has(field.name) }"></span>
                  <span class="fm-field-main">
                    <span class="mono fm-field-code" :title="field.name">{{ field.name }}</span>
                    <span class="fm-field-label" :title="field.label">{{ field.label }}</span>
                  </span>
                  <span class="fm-field-type">{{ field.type }}</span>
                  <span v-if="sourceLinkCount(field.name)" class="fm-field-count">{{ sourceLinkCount(field.name) }}</span>
                </div>
              </div>
            </div>
            <p v-if="!sourceGroups.length" class="dim" style="padding: 8px">
              {{ statusSource === 'unmapped' && sourceFields.length ? '源字段都已有映射，切换「全部状态」查看。' : '没有符合条件的源字段。' }}
            </p>
          </div>
        </aside>

        <section
          v-if="viewMode === 'canvas'"
          ref="canvas"
          class="fm-canvas"
          @pointerdown="onCanvasDown"
          @pointermove="onCanvasMove"
          @pointerup="onCanvasUp"
          @pointercancel="onCanvasUp"
          @wheel.prevent="onWheel"
        >
          <div class="fm-world" :style="worldStyle">
            <div class="fm-lane" style="left: 16px; top: 2px">源字段</div>
            <div class="fm-lane" style="left: 490px; top: 2px">目标字段</div>
            <svg class="fm-svg" :width="worldSize.w" :height="worldSize.h">
              <path
                v-for="line in lines"
                :key="line.id"
                :d="line.d"
                class="fm-line"
                :class="[line.type, line.status, { selected: line.selected }]"
                @click.stop="selectLine(line)"
                @dblclick.stop="editLine(line.linkId)"
              >
                <title>{{ line.title }}</title>
              </path>
              <text
                v-for="line in lines.filter((item) => item.selected)"
                :key="'lbl_' + line.id"
                :x="line.lx"
                :y="line.ly"
                class="fm-line-label"
              >{{ line.label }}</text>
              <path v-if="tempLine" :d="tempLine.d" class="fm-line temp" />
            </svg>

            <div
              v-for="node in sourceNodes"
              :key="node.id"
              class="fm-node source"
              :class="{ mapped: mappedSourceCount.has(node.name), active: node.selected || highlight === node.id, selected: node.selected }"
              :data-name="node.name"
              :title="node.name + ' · ' + node.label + ' · ' + node.type"
              :style="{ left: node.x + 'px', top: node.y + 'px', width: node.w + 'px', height: node.h + 'px' }"
              @pointerdown.stop="startNodeDrag(node, $event)"
              @dblclick.stop="onNodeDoubleClick(node)"
            >
              <span class="fm-node-code mono">{{ node.name }}</span>
              <span class="fm-node-label">{{ node.label }}</span>
              <span class="fm-node-type">{{ node.type }}</span>
              <span class="fm-node-handle" title="拖动这里建立映射" @pointerdown.stop="startConnect(node, $event)"></span>
            </div>

            <div
              v-for="node in targetNodes"
              :key="node.id"
              class="fm-node target"
              :class="{ mapped: node.mapped, active: node.selected || highlight === node.id, selected: node.selected, required: node.required }"
              :data-name="node.name"
              :title="node.name + ' · ' + node.label + ' · ' + node.type"
              :style="{ left: node.x + 'px', top: node.y + 'px', width: node.w + 'px', height: node.h + 'px' }"
              @pointerdown.stop="startNodeDrag(node, $event)"
              @dblclick.stop="onNodeDoubleClick(node)"
            >
              <span class="fm-node-code mono">{{ node.name }}</span>
              <span class="fm-node-label">{{ node.label }}</span>
              <span v-if="node.required" class="fm-required">必填</span>
              <span v-if="node.mapped" class="fm-mapped" :title="targetNodeTitle(node)">{{ targetNodeTitle(node) }}</span>
              <span class="fm-node-handle"></span>
            </div>
          </div>
        </section>

        <section v-else class="fm-map-panel">
          <div class="fm-map-toolbar">
            <h3>映射关系 <span class="sub">{{ linkedMappingRows.length }} / {{ mappingRows.length }}</span></h3>
            <input v-model="mappingSearch" class="fm-search" type="search" placeholder="搜索目标字段、源字段或说明" />
            <div class="fm-seg">
              <button type="button" :class="{ active: mappingStatus === 'all' }" @click="mappingStatus = 'all'">全部</button>
              <button type="button" :class="{ active: mappingStatus === 'pending' }" @click="mappingStatus = 'pending'">待映射</button>
              <button type="button" :class="{ active: mappingStatus === 'mapped' }" @click="mappingStatus = 'mapped'">已映射</button>
              <button type="button" :class="{ active: mappingStatus === 'error' }" @click="mappingStatus = 'error'">配置有误</button>
            </div>
            <select v-model="mappingTypeFilter">
              <option value="">全部映射方式</option>
              <option v-for="type in MAPPING_TYPES" :key="type.key" :value="type.key">{{ type.label }}</option>
            </select>
            <button type="button" class="btn sm" @click="resetMappings">重置</button>
            <button type="button" class="btn sm" @click="exportMappings">导出映射</button>
          </div>

          <div class="fm-midbar">
            <label><input type="checkbox" :checked="allVisibleMappingSelected" @change="toggleAllMappingSelection" /> 全选</label>
            <span>共 <b>{{ linkedMappingRows.length }}</b> 行</span>
            <span v-if="selectionActive" class="fm-linkhint">已按左右选中字段联动</span>
            <span class="spacer"></span>
            <div v-if="selectedSources.length || selectedTargets.length || selectedMappings.length" class="fm-batchbar">
              <span>已选 源 <b>{{ selectedSources.length }}</b> · 目标 <b>{{ selectedTargets.length }}</b> · 映射 <b>{{ selectedMappings.length }}</b></span>
              <button type="button" class="btn sm" :disabled="!selectedSources.length || selectedSources.length !== selectedTargets.length" @click="batchDirectMap">批量建立</button>
              <select v-model="batchType" class="fm-batch-type">
                <option v-for="type in MAPPING_TYPES" :key="type.key" :value="type.key">{{ type.label }}</option>
              </select>
              <button type="button" class="btn sm" :disabled="!selectedMappings.length" @click="batchSetType">批量改方式</button>
              <button type="button" class="btn sm danger" :disabled="!selectedMappings.length" @click="removeSelectedMappings">批量取消</button>
              <button type="button" class="btn sm" @click="clearSelections">清除选择</button>
            </div>
          </div>

          <div class="fm-table-scroll">
            <div class="fm-row head">
              <span></span>
              <span>目标标准字段</span>
              <span>源字段</span>
              <span>映射方式</span>
              <span>状态</span>
              <span></span>
            </div>
            <template v-for="row in visibleMappingRows" :key="row.field.name">
              <div class="fm-row" :class="[row.link ? row.status : 'pending', { opened: rowExpanded(row.field.name) }]" @click="toggleRow(row.field.name)">
                <input
                  type="checkbox"
                  class="fm-check"
                  :checked="row.link ? selectedMappings.includes(row.link.id) : selectedTargets.includes(row.field.name)"
                  @click.stop
                  @change="row.link ? toggleMappingSelection(row.link.id) : toggleTarget(row.field.name)"
                />
                <div class="tcell">
                  <span class="n">{{ row.field.name }}</span>
                  <span class="l">
                    {{ row.field.label }}
                    <span v-if="row.field.required" class="fm-inline-req">必填</span>
                    <span v-if="row.isRuleField" class="fm-inline-rule">规则</span>
                  </span>
                </div>
                <div class="scell">
                  {{ row.sources.length ? row.sources.map((source) => source.name).join(" + ") : "—" }}
                </div>
                <div class="mcell"><span class="tx">{{ row.typeLabel }}</span></div>
                <div class="stcell">
                  <i class="dot" :class="row.link ? row.status : 'pending'"></i>
                  {{ row.statusLabel }}
                  <span v-if="row.stepCount" class="dim">· {{ row.stepCount }} 步</span>
                </div>
                <button
                  type="button"
                  class="exp"
                  :title="row.link ? '编辑映射' : '展开建立映射'"
                  @click.stop="row.link ? editLink(row.link) : toggleRow(row.field.name)"
                >{{ row.link ? "↗" : "›" }}</button>
              </div>
              <div v-if="rowExpanded(row.field.name)" class="fm-row-detail">
                <template v-if="row.link">
                  <div class="fm-detail-grid">
                    <div>
                      <h6>源字段</h6>
                      <div v-for="source in row.sources" :key="source.name" class="fm-fieldcard">
                        <span class="n">{{ source.name }}</span>
                        <div class="m">{{ source.label }} · {{ source.type }}</div>
                      </div>
                    </div>
                    <div>
                      <h6>目标标准字段</h6>
                      <div class="fm-fieldcard">
                        <span class="n">{{ row.field.name }}</span>
                        <div class="m">
                          {{ row.field.label }} · {{ row.field.type }}
                          <span v-if="row.field.required"> · 必填</span>
                          <span v-if="row.isRuleField"> · 规则字段</span>
                        </div>
                      </div>
                    </div>
                    <div>
                      <h6>映射方式</h6>
                      <div class="fm-fieldcard">
                        <span class="n">{{ row.typeLabel }}</span>
                        <div class="m">{{ row.statusLabel }} · {{ row.stepCount }} 个处理步骤</div>
                      </div>
                      <div class="fm-detail-acts">
                        <button type="button" class="btn sm primary" @click.stop="editLink(row.link)">编辑映射</button>
                        <button type="button" class="btn sm danger" @click.stop="removeRowMapping(row)">取消映射</button>
                      </div>
                    </div>
                  </div>
                  <div v-if="(row.link.steps || []).length" class="fm-stepchips">
                    <span v-for="(step, index) in row.link.steps" :key="step.id" class="fm-stepchip">
                      <b>步骤 {{ index + 1 }} · {{ stepCategoryLabel(step.type) }}</b>
                      {{ step.name }} · {{ stepSummary(step) }}
                    </span>
                  </div>
                </template>
                <template v-else>
                  <div class="fm-pending-row">
                    <span>目标字段 {{ row.field.name }} 还没有映射。</span>
                    <select v-model="newSources[row.field.name]">
                      <option value="">选择源字段</option>
                      <option v-for="field in sourceFields" :key="field.name" :value="field.name">{{ field.name }} · {{ field.label }}</option>
                    </select>
                    <button type="button" class="btn sm primary" @click.stop="createLinkFromList(row.field.name)">建立映射</button>
                  </div>
                </template>
              </div>
            </template>
            <p v-if="!linkedMappingRows.length" class="dim" style="padding: 16px">{{ selectionActive ? "选中的字段没有匹配的映射关系。" : "没有符合条件的字段。" }}</p>
            <div v-if="hasMoreMappings" class="pr-more-row">
              <button type="button" class="btn" @click="mappingLimit += 20">加载更多</button>
            </div>
          </div>
        </section>

        <aside class="fm-side right">
          <div class="fm-side-head">
            <strong>监管目标字段</strong><span class="dim">{{ filteredTargets.length }} / {{ targetFields.length }}</span>
          </div>
          <input v-model="searchTarget" class="fm-search" type="search" placeholder="搜索字段" />
          <div class="fm-filters">
            <select v-model="groupTarget">
              <option value="">全部字段大类</option>
              <option v-for="group in targetGroupOptions" :key="group.code" :value="group.code">{{ group.label }}</option>
            </select>
            <select v-model="statusTarget">
              <option value="all">全部状态</option>
              <option value="mapped">已映射</option>
              <option value="unmapped">未映射</option>
              <option value="required">必填</option>
            </select>
          </div>
          <div class="fm-select-bar">
            <span>已选 <b>{{ selectedTargets.length }}</b></span>
            <button type="button" class="btn sm" @click="selectAllTargets">全选</button>
            <button type="button" class="btn sm" @click="clearTargets">取消选择</button>
            <button type="button" class="btn sm" @click="clearTargetFilters">清空筛选</button>
          </div>
          <div class="fm-group-tools">
            <span>按敞口划分字段分组</span>
            <button type="button" class="btn sm" @click="expandGroups('target', true)">展开</button>
            <button type="button" class="btn sm" @click="expandGroups('target', false)">收起</button>
          </div>
          <div class="fm-side-list">
            <div v-for="group in targetGroups" :key="group.key" class="fm-group">
              <button type="button" class="fm-group-head" @click="toggleGroup('target', group.key)">
                <span>{{ group.label }}（{{ group.fields.length }}）</span>
                <span v-if="group.selected" class="fm-group-sel">已选 {{ group.selected }}</span>
                <span class="fm-group-arrow">{{ groupOpen('target', group.key) ? '▾' : '▸' }}</span>
              </button>
              <div v-show="groupOpen('target', group.key)">
                <div
                  v-for="field in group.fields"
                  :key="field.name"
                  class="fm-field-row"
                  :class="{ active: selectedTargets.includes(field.name) || highlight === 't_' + field.name }"
                  role="button"
                  tabindex="0"
                  @click="pickTargetRow(field, indexOfTarget(field.name), $event)"
                  @dblclick="openTarget(field)"
                >
                  <input
                    type="checkbox"
                    class="fm-check"
                    :checked="selectedTargets.includes(field.name)"
                    @click.stop
                    @change="toggleTarget(field.name)"
                  />
                  <span class="fm-dot" :class="{ on: mappedTargets.has(field.name) }"></span>
                  <span class="fm-field-main">
                    <span class="mono fm-field-code" :title="field.name">{{ field.name }}</span>
                    <span class="fm-field-label" :title="field.label">{{ field.label }}</span>
                  </span>
                  <span class="fm-field-type">{{ field.type }}</span>
                  <span v-if="field.required" class="fm-field-required">必填</span>
                </div>
              </div>
            </div>
            <p v-if="!targetGroups.length" class="dim" style="padding: 8px">
              {{ statusTarget === 'unmapped' && targetFields.length ? '目标字段都已有映射，切换「全部状态」查看。' : '没有符合条件的目标字段。' }}
            </p>
          </div>
        </aside>
      </div>

      <div class="fm-stats">
        <span>源字段 {{ sourceFields.length }}</span>
        <span>目标字段 {{ targetFields.length }}</span>
        <span>已映射目标 {{ completion.mapped }} / {{ completion.total }}（{{ completion.rate }}%）</span>
        <span>必填已映射 {{ completion.requiredMapped }} / {{ completion.required }}（{{ completion.requiredRate }}%）</span>
        <span>映射关系 {{ links.length }}</span>
      </div>
    </template>

    <Drawer :open="configOpen" :title="selectedLink ? selectedLink.sources.join(' + ') + ' → ' + selectedLink.target : '映射配置'" @close="configOpen = false">
      <template v-if="selectedLink">
        <div class="fm-config-head">
          <label class="field">映射方式
            <select :value="selectedLink.mappingType" @change="setMappingType(selectedLink, $event.target.value)">
              <option v-for="type in MAPPING_TYPES" :key="type.key" :value="type.key">{{ type.label }}</option>
            </select>
          </label>
          <label class="fm-switch"><input v-model="selectedLink.enabled" type="checkbox" /> 启用</label>
          <span class="spacer"></span>
          <button type="button" class="btn sm danger" @click="deleteLink">删除映射</button>
        </div>

        <div v-if="selectedLink.mappingType !== 'composite'" class="fm-block">
          <h4>源字段</h4>
          <label class="field">源字段
            <select :value="lineSources(selectedLink)[0] || ''" @change="setPrimarySource(selectedLink, $event.target.value)">
              <option value="">选择源字段</option>
              <option v-for="field in sourceFields" :key="field.name" :value="field.name">{{ field.name }} · {{ field.label }}</option>
            </select>
          </label>
          <p class="dim">
            源类型 {{ (sourceMap[lineSources(selectedLink)[0]] || {}).type || "—" }} ·
            目标字段 {{ selectedLink.target }} · {{ (targetMap[selectedLink.target] || {}).type || "—" }}
          </p>
        </div>

        <div v-if="selectedLink.mappingType === 'composite'" class="fm-block">
          <h4>组合源字段（{{ selectedLink.sources.length }}）</h4>
          <div class="fm-source-checks">
            <label v-for="field in sourceFields" :key="field.name">
              <input
                type="checkbox"
                :checked="selectedLink.sources.includes(field.name)"
                @change="toggleCompositeSource(selectedLink, field.name, $event.target.checked)"
              />
              <span class="mono">{{ field.name }}</span>
            </label>
          </div>
        </div>

        <div class="fm-block">
          <h4>处理步骤（{{ (selectedLink.steps || []).length }}）</h4>
          <div class="fm-step-list">
            <div v-for="(step, index) in selectedLink.steps || []" :key="step.id" class="fm-step" :class="{ editing: editingStepId === step.id }">
              <button type="button" class="fm-step-name" @click="editStepLink(selectedLink, step)">
                <span class="fm-step-n">{{ index + 1 }}</span>
                <span>
                  <strong>{{ step.name }}</strong>
                  <span class="dim">{{ stepCategoryLabel(step.type) }} · {{ stepSummary(step) }}</span>
                </span>
              </button>
              <span class="spacer"></span>
              <label class="fm-switch"><input v-model="step.enabled" type="checkbox" /> 启用</label>
              <button type="button" class="btn sm" @click="moveStep(selectedLink, index, -1)">↑</button>
              <button type="button" class="btn sm" @click="moveStep(selectedLink, index, 1)">↓</button>
              <button type="button" class="btn sm danger" @click="removeStep(selectedLink, index)">删除</button>
            </div>
            <p v-if="!(selectedLink.steps || []).length" class="dim">还没有处理步骤。直接映射可以不配置步骤。</p>
          </div>
          <div class="fm-step-add">
            <select v-model="stepPicker">
              <option value="">选择处理类型</option>
              <optgroup v-for="category in stepOptions" :key="category.key" :label="category.label">
                <option v-for="type in category.types" :key="type.key" :value="type.key">{{ type.label }}</option>
              </optgroup>
            </select>
            <button type="button" class="btn sm primary" :disabled="!stepPicker" @click="addStep(selectedLink)">添加处理步骤</button>
          </div>
        </div>

        <div v-if="editingStep" class="fm-block fm-step-editor">
          <h4>{{ editingStep.name }} 参数</h4>
          <label class="field">步骤名称
            <input v-model="editingStep.name" type="text" />
          </label>
          <template v-for="field in editingStepDef ? editingStepDef.fields : []" :key="field.key">
            <template v-if="!field.showWhen || (editingStep.params[Object.keys(field.showWhen)[0]] === field.showWhen[Object.keys(field.showWhen)[0]])">
              <label v-if="field.type === 'text' || field.type === 'number'" class="field">
                {{ field.label }}
                <input v-model="editingStep.params[field.key]" :type="field.type === 'number' ? 'number' : 'text'" />
              </label>
              <label v-else-if="field.type === 'select'" class="field">
                {{ field.label }}
                <select v-model="editingStep.params[field.key]">
                  <option v-for="option in field.options" :key="option.value" :value="option.value">{{ option.label }}</option>
                </select>
              </label>
              <label v-else-if="field.type === 'field'" class="field">
                {{ field.label }}
                <select v-model="editingStep.params[field.key]">
                  <option value="">不引用字段</option>
                  <option v-for="item in sourceFields" :key="item.name" :value="item.name">{{ item.name }} · {{ item.label }}</option>
                </select>
              </label>
              <div v-else-if="field.type === 'condition'" class="field full">
                <span>{{ field.label }}</span>
                <WhenEditor
                  v-if="editingStep.params[field.key]"
                  :condition="editingStep.params[field.key]"
                  :fields="stepFields"
                  @update:condition="editingStep.params[field.key] = $event"
                />
                <button v-else type="button" class="btn sm" @click="editingStep.params[field.key] = { field: '$value', op: 'eq', match: '' }">添加条件</button>
              </div>
              <div v-else-if="field.type === 'cases'" class="field full">
                <span>{{ field.label }}</span>
                <div v-for="(item, caseIndex) in editingStep.params.cases || []" :key="caseIndex" class="fm-case">
                  <WhenEditor :condition="item.when" :fields="stepFields" @update:condition="item.when = $event" />
                  <input v-model="item.value" type="text" placeholder="取值" />
                  <button type="button" class="btn sm danger" @click="editingStep.params.cases.splice(caseIndex, 1)">删除</button>
                </div>
                <button type="button" class="btn sm" @click="addCase(editingStep)">添加分支</button>
                <button v-if="(editingStep.params.cases || []).length" type="button" class="btn sm" @click="removeCase(editingStep)">删除最后一支</button>
              </div>
              <div v-else-if="field.type === 'pairs'" class="field full">
                <span>{{ field.label }}</span>
                <div v-for="(item, pairIndex) in editingStep.params[field.key] || []" :key="pairIndex" class="fm-pair">
                  <input v-model="item.from" type="text" placeholder="源值" />
                  <span>→</span>
                  <input v-model="item.to" type="text" placeholder="目标值" />
                  <button type="button" class="btn sm danger" @click="editingStep.params[field.key].splice(pairIndex, 1)">删除</button>
                </div>
                <button type="button" class="btn sm" @click="addPair(editingStep, field.key)">添加一行</button>
                <button v-if="(editingStep.params[field.key] || []).length" type="button" class="btn sm" @click="removePair(editingStep, field.key)">删除最后一行</button>
              </div>
              <div v-else-if="field.type === 'fields'" class="field full">
                <span>{{ field.label }}</span>
                <div class="fm-source-checks">
                  <label v-for="item in sourceFields" :key="item.name">
                    <input
                      type="checkbox"
                      :checked="(editingStep.params[field.key] || []).includes(item.name)"
                      @change="toggleStepField(editingStep, field.key, item.name, $event.target.checked)"
                    />
                    <span class="mono">{{ item.name }}</span>
                  </label>
                </div>
              </div>
            </template>
          </template>
          <button type="button" class="btn sm primary" @click="editingStepId = ''">完成步骤配置</button>
        </div>

        <div class="fm-block">
          <div class="fm-test-head">
            <h4>映射测试</h4>
            <button type="button" class="btn sm" @click="fillSample">填充样例数据</button>
            <button type="button" class="btn sm primary" @click="runTest">运行测试</button>
          </div>
          <div class="fm-test-inputs">
            <label v-for="name in selectedLink.sources" :key="name" class="field">
              {{ name }}
              <input v-model="testValues[name]" type="text" />
            </label>
          </div>
          <p v-if="testResult" class="notice" :class="testResult.ok ? 'ok' : 'danger'">
            最终输出：{{ testResult.output == null ? "（空）" : testResult.output }}
            <span v-if="!testResult.ok">，失败步骤：第 {{ testResult.failedIndex + 1 }} 步，{{ testResult.error }}</span>
          </p>
          <table v-if="testResult && testResult.records.length" class="tbl compact">
            <thead><tr><th>#</th><th>步骤</th><th>输入</th><th>输出</th><th>结果</th></tr></thead>
            <tbody>
              <tr v-for="record in testResult.records" :key="record.id">
                <td>{{ record.index + 1 }}</td>
                <td>{{ record.name }}</td>
                <td class="mono">{{ record.before == null ? "—" : record.before }}</td>
                <td class="mono">{{ record.after == null ? "—" : record.after }}</td>
                <td><span class="tag" :class="record.ok ? 'ok' : 'danger'">{{ record.ok ? "成功" : record.error }}</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
        <div class="fm-drawer-foot">
          <button type="button" class="btn" @click="configOpen = false">关闭</button>
          <button type="button" class="btn primary" @click="saveAndClose">保存映射并关闭</button>
        </div>
    </Drawer>

    <Drawer :open="checkOpen" :title="'配置检查 · 完成率 ' + completion.rate + '%'" @close="checkOpen = false">
      <div class="fm-check-stats">
        <span>目标字段 {{ completion.mapped }} / {{ completion.total }}</span>
        <span>必填字段 {{ completion.requiredMapped }} / {{ completion.required }}</span>
        <span>问题 {{ issues.length }} 项</span>
      </div>
      <div v-for="(item, index) in issues" :key="index" class="fm-issue">
        <span class="tag danger">问题</span>
        <span>{{ item.message }}</span>
        <button v-if="item.link" type="button" class="btn sm" @click="checkOpen = false; editLink(item.link)">打开映射</button>
      </div>
      <p v-if="!issues.length" class="notice ok">没有发现问题。</p>
    </Drawer>
  </div>
</template>
