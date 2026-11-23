<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import Drawer from "@/components/Drawer.vue";
import FieldPicker from "@/components/FieldPicker.vue";
import { askConfirm } from "@/utils/confirm";
import { fetchRuleDocument, fetchRuleDocuments } from "@/api/config";
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
  standardFieldGroups: { type: Array, default: () => [] },
  scopeClasses: { type: Array, default: () => [] },
  scopeClassLabels: { type: Object, default: () => ({}) },
  scopeFields: { type: Array, default: () => [] },
  scopeFieldDefs: { type: Array, default: () => [] },
  requiredFields: { type: Array, default: () => [] },
  readOnly: { type: Boolean, default: false },
  jurisdiction: { type: String, default: "" }
});
const emit = defineEmits(["save", "edit-scope", "update:dirty"]);
const route = useRoute();
const readOnly = computed(() => !!props.readOnly);

const classDoc = ref(null);
const weightDoc = ref(null);
const loading = ref(true);
const ready = ref(false);
const error = ref("");
const notice = ref("");
const links = ref([]);
const selectedId = ref("");
const configOpen = ref(false);
// 抽屉里的编辑是直接改 links 的；关闭抽屉时用这份快照回滚，保存时丢弃。
let editSnapshot = null;
let editSnapshotId = "";
let editHistoryIndex = -1;
const checkOpen = ref(false);
const stepPicker = ref("");
const editingStepId = ref("");
const testValues = ref({});
const testResult = ref(null);
const searchSource = ref("");
const searchTarget = ref("");
const targetFilterOpen = ref(false);
const sourceFilterOpen = ref(false);
const groupSource = ref("");
const groupTarget = ref("");
const statusSource = ref("all");
const statusTarget = ref("all");
const targetFilterCount = computed(() => (
  (groupTarget.value ? 1 : 0)
  + (statusTarget.value !== "all" ? 1 : 0)
  + (scopeActive.value && scopeFilter.value !== "scope" ? 1 : 0)
));
const sourceFilterCount = computed(() => (
  (groupSource.value ? 1 : 0)
  + (statusSource.value !== "all" ? 1 : 0)
));
const zoom = ref(1);
const pan = ref({ x: 12, y: 12 });
const canvas = ref(null);
const connecting = ref(null);
const highlight = ref("");
const selectedSources = ref([]);
const selectedTargets = ref([]);
const offsets = ref({});
const viewMode = ref((() => { try { return localStorage.getItem("rwa-fm-view") || "list"; } catch (err) { return "list"; } })());

function sideCollapsed(key) {
  try {
    const stored = localStorage.getItem(key);
    if (stored === "1") return true;
    if (stored === "0") return false;
  } catch (err) { /* 存储不可用时只看窗口宽度 */ }
  return window.innerWidth < 1360;
}
const targetCollapsed = ref(sideCollapsed("rwa-fm-side-target"));
const sourceCollapsed = ref(sideCollapsed("rwa-fm-side-source"));

function toggleSide(side) {
  const target = side === "target" ? targetCollapsed : sourceCollapsed;
  target.value = !target.value;
  try {
    localStorage.setItem(side === "target" ? "rwa-fm-side-target" : "rwa-fm-side-source", target.value ? "1" : "0");
  } catch (err) { /* 记不住就只影响这一次 */ }
}
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

// 画布交互
const canvasSearch = ref("");
const hoverNodeId = ref("");

// 撤销 / 重做
const history = ref([]);
const historyIndex = ref(-1);
const historyApplying = ref(false);
const HISTORY_LIMIT = 60;

// 抽屉与辅助面板
const showDiff = ref(false);
const showImport = ref(false);
const showScopeResolve = ref(false);
const showTemplates = ref(false);
const conflictNotice = ref("");
const savedAt = ref("");
const importLoading = ref(false);
const importOptions = ref([]);
const importDocId = ref("");
const importDoc = ref(null);
const importMode = ref("fill");
const importInScopeOnly = ref(true);
const storedTransform = ref(null);
const templateTargets = ref([]);
const templateSourceId = ref("");
const listPanel = ref(null);

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
      labelEn: field.labelEn || field.label_en || "",
      type: field.type || "string",
      unit: "",
      description: field.label || ""
    });
  });
  map.forEach((field) => {
    const standard = standardByName[field.name] || {};
    field.labelEn = field.labelEn || standard.labelEn || standard.label_en || "";
    field.inputMode = standard.inputMode || standard.input_mode || (field.type === "constant" ? "default" : "manual");
    field.defaultValue = String(standard.defaultValue ?? standard.default_value ?? field.defaultValue ?? "");
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

const scopeActive = computed(() => (props.scopeClasses || []).length > 0);
const scopeClassTitle = computed(() => (props.scopeClasses || []).map((code) => (props.scopeClassLabels || {})[code] || code).join("、"));
const scopeFieldSet = computed(() => new Set(props.scopeFields || []));
const scopeDefMap = computed(() => new Map((props.scopeFieldDefs || []).filter((field) => field && field.name).map((field) => [field.name, field])));
const requiredFieldSet = computed(() => new Set(props.requiredFields || []));

const allTargetFields = computed(() => {
  const list = [];
  const seen = new Set();
  const push = (field, docLabel) => {
    if (!field || !field.name || seen.has(field.name)) return;
    seen.add(field.name);
    const scopeDef = scopeDefMap.value.get(field.name) || null;
    const group = (scopeDef && scopeDef.group) || field.group || "UNGROUPED";
    const meta = targetGroupMeta.value.get(group);
    const source = field.source || "";
    list.push({
      name: field.name,
      label: field.label || field.name,
      labelEn: field.labelEn || field.label_en || "",
      type: field.type || "string",
      group: group,
      groupLabel: (scopeDef && scopeDef.groupLabel) || (meta ? meta.label : group === "UNGROUPED" ? "未分组" : group),
      groupOrder: scopeDef && scopeDef.groupOrder != null ? scopeDef.groupOrder : (meta ? meta.order : 999),
      required: field.required === true || field.missing_policy === "fail" || requiredFieldSet.value.has(field.name) || !!(scopeDef && scopeDef.required),
      missingPolicy: field.missing_policy || "",
      source: source,
      systemCalc: source === "calc" || !!(scopeDef && scopeDef.systemCalc),
      inScope: !scopeActive.value || scopeFieldSet.value.has(field.name),
      doc: docLabel
    });
  };
  ((classDoc.value && classDoc.value.fields) || []).forEach((field) => push(field, "分类"));
  ((weightDoc.value && weightDoc.value.fields) || []).forEach((field) => push(field, "权重"));
  (props.document.mappings || []).forEach((mapping) => {
    if (!mapping || !mapping.target_field || seen.has(mapping.target_field)) return;
    seen.add(mapping.target_field);
    const scopeDef = scopeDefMap.value.get(mapping.target_field) || null;
    const group = (scopeDef && scopeDef.group) || "UNGROUPED";
    const meta = targetGroupMeta.value.get(group);
    list.push({
      name: mapping.target_field,
      label: mapping.target_field,
      type: mapping.target_type || "string",
      group: group,
      groupLabel: (scopeDef && scopeDef.groupLabel) || (meta ? meta.label : "未在规则集定义"),
      groupOrder: scopeDef && scopeDef.groupOrder != null ? scopeDef.groupOrder : (meta ? meta.order : 1000),
      required: mapping.required === true || requiredFieldSet.value.has(mapping.target_field) || !!(scopeDef && scopeDef.required),
      missingPolicy: mapping.missing_policy || "",
      source: "",
      systemCalc: !!(scopeDef && scopeDef.systemCalc),
      inScope: !scopeActive.value || scopeFieldSet.value.has(mapping.target_field),
      doc: "未定义"
    });
  });
  return list;
});

const targetFields = computed(() => allTargetFields.value.filter((field) => !field.systemCalc));
const scopedTargetFields = computed(() => targetFields.value.filter((field) => field.inScope));
const outOfScopeTargetFields = computed(() => targetFields.value.filter((field) => !field.inScope));
const baseTargetFields = computed(() => (scopeActive.value ? scopedTargetFields.value : targetFields.value));
const mappingBaseTargets = computed(() => {
  if (!scopeActive.value) return targetFields.value;
  if (mappingStatus.value === "out-scope") return targetFields.value;
  return showOutOfScope.value ? targetFields.value : scopedTargetFields.value;
});
const visibleScopeTargets = computed(() => {
  if (!scopeActive.value) return targetFields.value;
  if (scopeFilter.value === "out") return outOfScopeTargetFields.value;
  if (scopeFilter.value === "all") return targetFields.value;
  return scopedTargetFields.value;
});
const scopedSystemTargets = computed(() => {
  const list = allTargetFields.value.filter((field) => field.systemCalc);
  if (!scopeActive.value || scopeFilter.value === "all") return list;
  if (scopeFilter.value === "out") return list.filter((field) => !scopeFieldSet.value.has(field.name));
  return list.filter((field) => scopeFieldSet.value.has(field.name));
});
const filteredSystemTargets = computed(() => {
  const text = searchTarget.value.trim().toLowerCase();
  if (statusTarget.value === "mapped" || statusTarget.value === "unmapped" || statusTarget.value === "required-unmapped") return [];
  return scopedSystemTargets.value.filter((field) => {
    if (statusTarget.value === "required" && !field.required) return false;
    if (groupTarget.value && (field.group || "UNGROUPED") !== groupTarget.value) return false;
    if (!text) return true;
    return (field.name + " " + field.label + " " + field.doc).toLowerCase().includes(text);
  });
});
const scopedSystemTargetCount = computed(() => allTargetFields.value.filter((field) => field.systemCalc && (!scopeActive.value || scopeFieldSet.value.has(field.name))).length);
const outOfScopeSystemTargetCount = computed(() => allTargetFields.value.filter((field) => field.systemCalc && scopeActive.value && !scopeFieldSet.value.has(field.name)).length);
const displayTargets = computed(() => filteredTargets.value.concat(filteredSystemTargets.value));
const displayScopeTargets = computed(() => visibleScopeTargets.value.concat(scopedSystemTargets.value));
const calcTargetNames = computed(() => new Set(allTargetFields.value.filter((field) => field.systemCalc).map((field) => field.name)));
const outOfScopeLinkCount = computed(() => {
  if (!scopeActive.value) return 0;
  const names = new Set(scopedTargetFields.value.map((field) => field.name));
  return links.value.filter((link) => targetFields.value.some((field) => field.name === link.target) && !names.has(link.target)).length;
});
const calcLinkCount = computed(() => links.value.filter((link) => calcTargetNames.value.has(link.target)).length);

const sourceMap = computed(() => {
  const map = {};
  sourceFields.value.forEach((field) => { map[field.name] = field; });
  return map;
});

const targetMap = computed(() => {
  const map = {};
  allTargetFields.value.forEach((field) => { map[field.name] = field; });
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
  const total = baseTargetFields.value.length;
  const mapped = baseTargetFields.value.filter((field) => mappedTargets.value.has(field.name)).length;
  const required = baseTargetFields.value.filter((field) => field.required);
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
const targetGroupOptions = computed(() => groupOptionsOf(displayScopeTargets.value));

const filteredSources = computed(() => {
  const text = searchSource.value.trim().toLowerCase();
  return sourceFields.value.filter((field) => {
    if (groupSource.value && (field.group || "UNGROUPED") !== groupSource.value) return false;
    if (statusSource.value === "mapped" && !mappedSourceCount.value.has(field.name)) return false;
    if (statusSource.value === "unmapped" && mappedSourceCount.value.has(field.name)) return false;
    if (statusSource.value === "unused" && mappedSourceCount.value.has(field.name)) return false;
    if (!text) return true;
    return (field.name + " " + field.label + " " + field.description).toLowerCase().includes(text);
  });
});

const filteredTargets = computed(() => {
  const text = searchTarget.value.trim().toLowerCase();
  return visibleScopeTargets.value.filter((field) => {
    if (groupTarget.value && (field.group || "UNGROUPED") !== groupTarget.value) return false;
    if (statusTarget.value === "mapped" && !mappedTargets.value.has(field.name)) return false;
    if (statusTarget.value === "unmapped" && mappedTargets.value.has(field.name)) return false;
    if (statusTarget.value === "required" && !field.required) return false;
    if (statusTarget.value === "required-unmapped" && (!field.required || mappedTargets.value.has(field.name))) return false;
    if (!text) return true;
    return (field.name + " " + field.label + " " + field.doc).toLowerCase().includes(text);
  });
});

// 供字段选择器使用：带上已用标记
const pickerSources = computed(() => sourceFields.value.map((field) => Object.assign({}, field, {
  mapped: mappedSourceCount.value.has(field.name)
})));

function fieldEnglishName(field) {
  return field.labelEn || field.label_en || field.name || "";
}

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
const targetGroups = computed(() => groupFields(displayTargets.value, targetGroupOf, selectedTargetSet.value));

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
  if (link.sources && link.sources.length) return link.sources;
  if (link.mappingType === "constant") return [];
  return [link.source];
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
    return new Set(mappingBaseTargets.value.map((field) => field.name));
  }
  const set = new Set(selectedTargets.value);
  links.value.forEach((link) => {
    if (lineSources(link).some((name) => selectedSourceSet.value.has(name))) set.add(link.target);
  });
  return set;
});

const visibleSources = computed(() => sourceFields.value.filter((field) => visibleSourceSet.value.has(field.name)));
const visibleTargets = computed(() => targetFields.value.filter((field) => visibleTargetSet.value.has(field.name)));

const hoverName = computed(() => String(hoverNodeId.value || "").replace(/^[st]_/, ""));
const canvasMatchNames = computed(() => {
  const text = canvasSearch.value.trim().toLowerCase();
  if (!text) return null;
  const set = new Set();
  sourceFields.value.forEach((field) => {
    if ((field.name + " " + field.label).toLowerCase().includes(text)) set.add(field.name);
  });
  targetFields.value.forEach((field) => {
    if ((field.name + " " + field.label).toLowerCase().includes(text)) set.add(field.name);
  });
  return set;
});

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

const configTitle = computed(() => {
  const link = selectedLink.value;
  if (!link) return "映射配置";
  const from = lineSources(link)
    .map((name) => {
      const field = sourceMap.value[name];
      return field && field.label && field.label !== name ? name + " · " + field.label : name;
    })
    .join(" + ");
  const target = targetMap.value[link.target];
  const to = target && target.label && target.label !== link.target ? link.target + " · " + target.label : link.target;
  return from + " → " + to;
});

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
  if (link.mappingType === "constant") return String(link.defaultValue || "").trim() ? "configured" : "pending";
  if (link.mappingType !== "direct" && !(link.steps || []).length) return "pending";
  return "configured";
}

function lineTitle(link) {
  const status = { configured: "已配置", pending: "待配置", invalid: "配置有误", disabled: "已禁用" }[lineStatus(link)] || "";
  const value = link.mappingType === "constant" ? " 默认值 " + (link.defaultValue || "（空）") : "";
  return lineSources(link).join(" + ") + " → " + link.target + " · " + mappingTypeLabel(link.mappingType) + value + " · " + (link.steps || []).length + " 个步骤 · " + status;
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
      sourceName: entry.sourceName,
      targetName: entry.to.name,
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
  const required = baseTargetFields.value.filter((field) => field.required);
  const ruleFields = baseTargetFields.value.filter((field) => ruleFieldNames.value.has(field.name));
  const ruleMapped = ruleFields.filter((field) => mappedTargets.value.has(field.name)).length;
  return {
    sourceTotal: sourceFields.value.length,
    sourceUsed: mappedSourceCount.value.size,
    targetTotal: baseTargetFields.value.length,
    targetMapped: baseTargetFields.value.filter((field) => mappedTargets.value.has(field.name)).length,
    requiredTotal: required.length,
    requiredUnmapped: required.filter((field) => !mappedTargets.value.has(field.name)).length,
    ruleTotal: ruleFields.length,
    ruleMapped: ruleMapped,
    progress: baseTargetFields.value.length ? Math.round(baseTargetFields.value.filter((field) => mappedTargets.value.has(field.name)).length / baseTargetFields.value.length * 100) : 0
  };
});

const mappingRowsAll = computed(() => {
  const inScopeNames = new Set(scopedTargetFields.value.map((field) => field.name));
  return mappingBaseTargets.value.map((field) => {
    const link = targetLinks(field.name)[0] || null;
    const sources = link
      ? lineSources(link).map((name) => sourceMap.value[name] || { name: name, label: name, type: "string" })
      : [];
    const sourceLabels = sources
      .filter((item) => item.label && item.label !== item.name)
      .map((item) => item.label);
    const status = link ? lineStatus(link) : "unmapped";
    const issues = link ? (issueMap.value[link.id] || []) : [];
    return {
      field: field,
      link: link,
      sources: sources,
      sourceLabelText: sourceLabels.join(" + "),
      status: status,
      statusLabel: link ? (LINK_STATUS_LABELS[status] || status) : "待映射",
      typeLabel: link ? mappingTypeLabel(link.mappingType) : "—",
      stepCount: link ? (link.steps || []).length : 0,
      isRuleField: ruleFieldNames.value.has(field.name),
      inScope: !scopeActive.value || inScopeNames.has(field.name),
      issueText: issues.join("；")
    };
  });
});

/** 状态页签和表格共用同一套判定，页签上的数字就是点进去能看到的行数。 */
function rowMatchesStatus(row, key) {
  if (key === "pending") return !row.link;
  if (key === "required-pending") return !!row.field.required && !row.link;
  if (key === "mapped") return !!row.link;
  if (key === "error") return row.status === "invalid";
  if (key === "disabled") return row.status === "disabled";
  if (key === "out-scope") return !row.inScope;
  return true;
}

const mappingRowsScoped = computed(() => {
  const text = mappingSearch.value.trim().toLowerCase();
  return mappingRowsAll.value.filter((row) => {
    if (ruleOnly.value && !row.isRuleField) return false;
    if (mappingTypeFilter.value && (!row.link || row.link.mappingType !== mappingTypeFilter.value)) return false;
    if (!text) return true;
    return [
      row.field.name, row.field.label, row.field.type, row.field.doc,
      ...row.sources.map((item) => item.name + " " + item.label),
      row.typeLabel
    ].join(" ").toLowerCase().includes(text);
  });
});

const mappingRows = computed(() => mappingRowsScoped.value.filter((row) => rowMatchesStatus(row, mappingStatus.value)));

const statusCounts = computed(() => {
  const counts = {};
  ["all", "pending", "required-pending", "mapped", "error", "disabled", "out-scope"].forEach((key) => {
    counts[key] = mappingRowsScoped.value.filter((row) => rowMatchesStatus(row, key)).length;
  });
  return counts;
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
const suggestions = computed(() => {
  const map = {};
  visibleMappingRows.value.forEach((row) => {
    if (!row.link) map[row.field.name] = suggestSource(row.field.name);
  });
  return map;
});
const selectedMappingCards = computed(() => links.value.filter((link) => selectedMappings.value.includes(link.id)).map((link) => ({ link: link })));
const allVisibleRowsSelected = computed(() => {
  if (!visibleMappingRows.value.length) return false;
  return visibleMappingRows.value.every((row) => (
    row.link ? selectedMappings.value.includes(row.link.id) : selectedTargets.value.includes(row.field.name)
  ));
});

const expandedRows = ref([]);
const mappingTypeFilter = ref("");
const batchType = ref("direct");
const scopeFilter = ref("scope");
const showOutOfScope = ref(false);
const ruleOnly = ref(false);
const bindingTarget = ref("");

function rowExpanded(name) {
  return expandedRows.value.includes(name);
}
function toggleRow(name) {
  expandedRows.value = rowExpanded(name)
    ? expandedRows.value.filter((item) => item !== name)
    : expandedRows.value.concat(name);
}

function removeRowMapping(row) {
  if (!guardEdit()) return;
  if (!row || !row.link) return;
  links.value = links.value.filter((link) => link.id !== row.link.id);
  selectedMappings.value = selectedMappings.value.filter((id) => id !== row.link.id);
  if (selectedId.value === row.link.id) {
    clearEditSnapshot();
    configOpen.value = false;
  }
}

function batchSetType() {
  if (!guardEdit()) return;
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

function toggleAllVisibleRows() {
  const rows = visibleMappingRows.value;
  if (!rows.length) return;
  if (allVisibleRowsSelected.value) {
    const ids = rows.filter((row) => row.link).map((row) => row.link.id);
    const targets = rows.filter((row) => !row.link).map((row) => row.field.name);
    selectedMappings.value = selectedMappings.value.filter((id) => !ids.includes(id));
    selectedTargets.value = selectedTargets.value.filter((name) => !targets.includes(name));
    return;
  }
  selectedMappings.value = Array.from(new Set(selectedMappings.value.concat(rows.filter((row) => row.link).map((row) => row.link.id))));
  selectedTargets.value = Array.from(new Set(selectedTargets.value.concat(rows.filter((row) => !row.link).map((row) => row.field.name))));
}

function scrollToMappingList() {
  nextTick(() => {
    if (listPanel.value && listPanel.value.scrollIntoView) listPanel.value.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

function focusRequiredUnmapped() {
  mappingStatus.value = "required-pending";
  mappingLimit.value = 20;
  scrollToMappingList();
}

function focusInvalid() {
  mappingStatus.value = "error";
  mappingLimit.value = 20;
  scrollToMappingList();
}

function focusDisabled() {
  mappingStatus.value = "disabled";
  mappingLimit.value = 20;
  scrollToMappingList();
}

function focusOutOfScope() {
  mappingStatus.value = "out-scope";
  mappingLimit.value = 20;
  showOutOfScope.value = true;
  scrollToMappingList();
}

function toggleOutOfScope() {
  if (showOutOfScope.value) {
    showOutOfScope.value = false;
    if (mappingStatus.value === "out-scope") mappingStatus.value = "all";
    return;
  }
  focusOutOfScope();
}

function focusUnusedSources() {
  statusSource.value = "unused";
  scrollToMappingList();
}

function focusRuleFields() {
  ruleOnly.value = !ruleOnly.value;
  scrollToMappingList();
}

function clearMappingFocus() {
  mappingStatus.value = "all";
  ruleOnly.value = false;
  mappingLimit.value = 20;
}

const MAPPING_STATUS_LABELS = {
  all: "全部",
  pending: "待映射",
  "required-pending": "必填未映射",
  mapped: "已映射",
  error: "配置有误",
  disabled: "已停用",
  "out-scope": "范围外"
};
const mappingStatusLabel = computed(() => MAPPING_STATUS_LABELS[mappingStatus.value] || "");

async function removeSelectedMappings() {
  if (!guardEdit()) return;
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
  if (configOpen.value) {
    clearEditSnapshot();
    configOpen.value = false;
  }
}

async function batchDirectMap() {
  if (!guardEdit()) return;
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
  const pairs = sources.map((source, index) => ({ source: source, target: targets[index] }));
  const detail = pairs.slice(0, 10).map((pair) => pair.source + " → " + pair.target).join("\n")
    + (pairs.length > 10 ? "\n…… 共 " + pairs.length + " 组" : "");
  const yes = await askConfirm("确认按下面的对应关系建立直接映射？", {
    title: "批量建立直接映射",
    detail: detail,
    confirmText: "建立映射"
  });
  if (!yes) return;
  sources.forEach((sourceName, index) => {
    const source = sourceMap.value[sourceName] || {};
    const isDefault = (source.inputMode || "manual") === "default";
    links.value.push({
      id: newLinkId(),
      source: sourceName,
      sources: [sourceName],
      target: targets[index],
      mappingType: isDefault ? "constant" : "direct",
      defaultValue: isDefault ? String(source.defaultValue || "") : "",
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
  if (mode === "canvas") nextTick(fit);
}

function setPrimarySource(link, name) {
  if (!guardEdit()) return;
  if (!name) {
    link.sources = [];
    link.source = "";
    return;
  }
  link.sources = [name];
  link.source = name;
}

function createLinkFromList(targetName) {
  if (!guardEdit()) return;
  const sourceName = newSources.value[targetName];
  if (!sourceName) {
    error.value = "先为目标字段选择源字段";
    return;
  }
  if (targetLinks(targetName).length) {
    editLink(targetLinks(targetName)[0]);
    return;
  }
  const source = sourceMap.value[sourceName] || {};
  const isDefault = (source.inputMode || "manual") === "default";
  const link = {
    id: newLinkId(),
    source: sourceName,
    sources: [sourceName],
    target: targetName,
    mappingType: isDefault ? "constant" : "direct",
    defaultValue: isDefault ? String(source.defaultValue || "") : "",
    steps: [],
    enabled: true,
    original: null
  };
  links.value.push(link);
  editLink(link);
}

function saveAndClose() {
  if (!selectedLink.value) return;
  if (selectedLink.value.mappingType === "constant") {
    if (!String(selectedLink.value.defaultValue || "").trim()) {
      error.value = "先填写默认值";
      return;
    }
  } else if (!lineSources(selectedLink.value)[0]) {
    error.value = "先选择源字段";
    return;
  }
  save();
  clearEditSnapshot();
  configOpen.value = false;
}

const outOfScopeLinks = computed(() => {
  if (!scopeActive.value) return [];
  const names = new Set(scopedTargetFields.value.map((field) => field.name));
  const known = new Set(targetFields.value.map((field) => field.name));
  return links.value.filter((link) => known.has(link.target) && !names.has(link.target));
});

const issues = computed(() => {
  const list = [];
  links.value.forEach((link) => {
    (issueMap.value[link.id] || []).forEach((message) => {
      list.push({ severity: "error", category: "invalid", message: message, link: link, action: "edit" });
    });
    if (link.enabled === false) {
      list.push({ severity: "warning", category: "disabled", message: "映射 " + lineSources(link).join(" + ") + " → " + link.target + " 已停用", link: link, action: "edit" });
    }
    if (link.mappingType !== "direct" && !(link.steps || []).length) {
      list.push({ severity: "warning", category: "steps", message: "映射 " + lineSources(link).join(" + ") + " → " + link.target + " 还没配置处理步骤", link: link, action: "edit" });
    }
  });
  outOfScopeLinks.value.forEach((link) => {
    list.push({ severity: "warning", category: "out-scope", message: "映射 " + lineSources(link).join(" + ") + " → " + link.target + " 不在当前适用风险暴露类型范围内", link: link, action: "scope" });
  });
  links.value.forEach((link) => {
    if (calcTargetNames.value.has(link.target)) {
      list.push({ severity: "info", category: "calc", message: "映射目标 " + link.target + " 是系统计算字段，字段映射页不显示", link: link, action: "edit" });
    }
  });
  baseTargetFields.value.filter((field) => field.required && !mappedTargets.value.has(field.name)).forEach((field) => {
    list.push({ severity: "error", category: "required", message: "必填目标字段 " + field.name + " 还没有映射", field: field, action: "map" });
  });
  const rank = { error: 0, warning: 1, info: 2 };
  return list.sort((left, right) => rank[left.severity] - rank[right.severity]);
});

const ISSUE_GROUP_LABELS = {
  invalid: "配置错误",
  required: "必填未映射",
  disabled: "已停用映射",
  steps: "未配置处理步骤",
  "out-scope": "范围外映射",
  calc: "系统计算字段"
};
const ISSUE_GROUP_ORDER = ["invalid", "required", "disabled", "steps", "out-scope", "calc"];
const issueGroupOpen = ref({});

const groupedIssues = computed(() => {
  const map = new Map();
  issues.value.forEach((item) => {
    if (!map.has(item.category)) {
      map.set(item.category, { key: item.category, label: ISSUE_GROUP_LABELS[item.category] || item.category, severity: item.severity, items: [] });
    }
    map.get(item.category).items.push(item);
  });
  return ISSUE_GROUP_ORDER.filter((key) => map.has(key)).map((key) => map.get(key));
});

function issueGroupIsOpen(group) {
  const state = issueGroupOpen.value[group.key];
  return state === undefined ? group.severity === "error" : state;
}

function toggleIssueGroup(group) {
  issueGroupOpen.value = Object.assign({}, issueGroupOpen.value, { [group.key]: !issueGroupIsOpen(group) });
}

const issueCounts = computed(() => {
  const counts = { error: 0, warning: 0, info: 0 };
  issues.value.forEach((item) => { counts[item.severity] += 1; });
  return counts;
});
const issueSummary = computed(() => {
  let errors = 0;
  let warnings = 0;
  let info = 0;
  issues.value.forEach((item) => {
    if (item.severity === "error") errors += 1;
    else if (item.severity === "warning") warnings += 1;
    else if (item.severity === "info") info += 1;
  });
  return { errors, warnings, info, outOfScope: outOfScopeLinks.value.length };
});

function scrollToTarget(name) {
  nextTick(() => {
    const element = Array.from(document.querySelectorAll("[data-target]"))
      .find((item) => item.getAttribute("data-target") === String(name));
    if (element && element.scrollIntoView) element.scrollIntoView({ behavior: "smooth", block: "center" });
  });
}

function openIssue(item) {
  checkOpen.value = false;
  if (item.action === "scope") {
    showScopeResolve.value = true;
    return;
  }
  if (item.link) {
    editLink(item.link);
    return;
  }
  if (item.field) {
    mappingStatus.value = "all";
    mappingLimit.value = 20;
    if (!rowExpanded(item.field.name)) expandedRows.value = expandedRows.value.concat(item.field.name);
    const suggestion = suggestSource(item.field.name);
    if (suggestion && !newSources.value[item.field.name]) {
      newSources.value = Object.assign({}, newSources.value, { [item.field.name]: suggestion.name });
    }
    scrollToTarget(item.field.name);
  }
}

function removeOutOfScopeLink(link) {
  if (!guardEdit()) return;
  links.value = links.value.filter((item) => item.id !== link.id);
  selectedMappings.value = selectedMappings.value.filter((id) => id !== link.id);
}

async function removeAllOutOfScope() {
  if (!guardEdit()) return;
  if (!outOfScopeLinks.value.length) return;
  const yes = await askConfirm("删除全部 " + outOfScopeLinks.value.length + " 条范围外映射？", {
    title: "清理范围外映射",
    confirmText: "全部删除",
    danger: true
  });
  if (!yes) return;
  const ids = new Set(outOfScopeLinks.value.map((link) => link.id));
  links.value = links.value.filter((link) => !ids.has(link.id));
  selectedMappings.value = selectedMappings.value.filter((id) => !ids.has(id));
}

function targetLinks(name) {
  return links.value.filter((link) => link.target === name);
}

function sourceLinkCount(name) {
  return links.value.filter((link) => lineSources(link).includes(name)).length;
}

function newLinkId() {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return "link_" + crypto.randomUUID();
  } catch (err) { /* ignore */ }
  return "link_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
}

function linkFromMapping(mapping, id) {
  const params = (mapping.transform && mapping.transform.parameters) || {};
  const transformType = (mapping.transform && mapping.transform.type) || "direct";
  let mappingType = params.mappingType;
  if (!mappingType) {
    if (transformType === "direct") mappingType = "direct";
    else if (transformType === "constant") mappingType = "constant";
    else if (transformType === "conditional") mappingType = "conditional";
    else if (transformType === "calculation") mappingType = "calculation";
    else mappingType = "transform";
  }
  let steps = clone(params.steps || []);
  if (!steps.length && mapping.transform && mapping.transform.mapping && typeof mapping.transform.mapping === "object") {
    const step = newStep("code_map");
    step.params.map = Object.keys(mapping.transform.mapping).map((from) => ({ from: from, to: mapping.transform.mapping[from] }));
    steps = [step];
  }
  steps = steps.map((step, index) => {
    if (!step || step.id) return step;
    return Object.assign({}, step, { id: "step_" + index + "_" + (step.type || "step") });
  });
  return {
    id: id || newLinkId(),
    source: mapping.source_field || "",
    sources: clone(params.sources && params.sources.length ? params.sources : [mapping.source_field]).filter(Boolean),
    target: mapping.target_field,
    mappingType: mappingType,
    defaultValue: String(params.value ?? mapping.default_value ?? ""),
    steps: steps,
    enabled: params.enabled !== false,
    original: mapping
  };
}

function loadLinks() {
  const used = new Set();
  links.value = (props.document.mappings || []).map((mapping) => {
    const candidates = linkFromMapping(mapping, "");
    const sources = (candidates.sources || [candidates.source]).join("+");
    let base = "link:" + mapping.target_field + "|" + sources;
    let id = base;
    let seq = 1;
    while (used.has(id)) id = base + "#" + (seq++);
    used.add(id);
    return Object.assign(candidates, { id: id });
  });
  initialLinks.value = clone(links.value);
  resetHistory();
  ready.value = true;
}

function resetHistory() {
  history.value = [clone(links.value)];
  historyIndex.value = 0;
}

function pushHistory() {
  if (historyApplying.value) return;
  const snapshot = clone(links.value);
  const current = history.value[historyIndex.value];
  if (current && JSON.stringify(current) === JSON.stringify(snapshot)) return;
  history.value = history.value.slice(0, historyIndex.value + 1).concat([snapshot]);
  if (history.value.length > HISTORY_LIMIT) history.value = history.value.slice(history.value.length - HISTORY_LIMIT);
  historyIndex.value = history.value.length - 1;
}

function applyHistory(index) {
  if (readOnly.value) return;
  if (index < 0 || index >= history.value.length) return;
  const from = historyIndex.value;
  historyApplying.value = true;
  historyIndex.value = index;
  links.value = clone(history.value[index]);
  selectedMappings.value = [];
  selectedId.value = "";
  configOpen.value = false;
  clearEditSnapshot();
  error.value = "";
  notice.value = index < from
    ? (index === 0 ? "已撤销到打开页面时的状态" : "已撤销上一步修改")
    : "已重做一步修改";
  nextTick(() => { historyApplying.value = false; });
}

function undo() {
  applyHistory(historyIndex.value - 1);
}

function redo() {
  applyHistory(historyIndex.value + 1);
}

const canUndo = computed(() => historyIndex.value > 0);
const canRedo = computed(() => historyIndex.value < history.value.length - 1);

watch(links, () => {
  if (!historyApplying.value) pushHistory();
}, { deep: true });

const dirty = computed(() => JSON.stringify(links.value) !== JSON.stringify(initialLinks.value));

function markSaved() {
  initialLinks.value = clone(links.value);
  savedAt.value = new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  conflictNotice.value = "";
  resetHistory();
}

watch(dirty, (value) => emit("update:dirty", value), { immediate: true });

function guardEdit() {
  if (!readOnly.value) return true;
  error.value = "当前监管版本已发布，字段映射只读；请先撤回发布再修改。";
  return false;
}

const changeSummary = computed(() => {
  const before = new Map();
  (initialLinks.value || []).forEach((link) => {
    before.set(link.target, link);
  });
  const after = new Map();
  (links.value || []).forEach((link) => {
    after.set(link.target, link);
  });
  const added = [];
  const changed = [];
  const removed = [];
  after.forEach((link, target) => {
    const old = before.get(target);
    if (!old) added.push(link);
    else if (JSON.stringify(old) !== JSON.stringify(link)) changed.push({ before: old, after: link });
  });
  before.forEach((link, target) => {
    if (!after.has(target)) removed.push(link);
  });
  return { added: added, changed: changed, removed: removed };
});

function suggestSource(targetName) {
  const target = targetMap.value[targetName] || {};
  const normalize = (value) => String(value || "").toLowerCase().replace(/[\s_\-()（）]/g, "");
  const targetKeys = [normalize(target.name), normalize(target.label)].filter(Boolean);
  let best = null;
  let bestScore = 0;
  sourceFields.value.forEach((field) => {
    const name = normalize(field.name);
    const label = normalize(field.label);
    if (!name && !label) return;
    let score = 0;
    targetKeys.forEach((key) => {
      if (!key) return;
      if (name === key || label === key) score = Math.max(score, 100);
      else if (name && (name.includes(key) || key.includes(name)) && Math.min(name.length, key.length) >= 3) score = Math.max(score, 72);
      else if (label && (label.includes(key) || key.includes(label)) && Math.min(label.length, key.length) >= 2) score = Math.max(score, 60);
      else {
        const left = new Set(name.split(""));
        const right = new Set(key.split(""));
        let overlap = 0;
        left.forEach((ch) => { if (right.has(ch)) overlap += 1; });
        score = Math.max(score, Math.round((overlap / Math.max(left.size, 1)) * 40));
      }
    });
    if (score > bestScore) {
      bestScore = score;
      best = field;
    }
  });
  return bestScore >= 45 ? best : null;
}

function applySuggestion(targetName) {
  const field = suggestSource(targetName);
  if (!field) return;
  newSources.value = Object.assign({}, newSources.value, { [targetName]: field.name });
}

watch(dirty, (value) => {
  if (value) conflictNotice.value = "";
});

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
  pan.value = { x: 12, y: 56 };
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

function startBind(targetName) {
  if (!guardEdit()) return;
  bindingTarget.value = targetName;
  sourceCollapsed.value = false;
  error.value = "";
}

function cancelBind() {
  bindingTarget.value = "";
}

function onSourceRowClick(field, index, event) {
  if (bindingTarget.value) {
    bindSourceToTarget(field.name);
    return;
  }
  pickSourceRow(field, index, event);
}

/** 绑定模式下点右侧标准字段：直接建立/替换为目标字段的映射，不再打开抽屉。 */
function bindSourceToTarget(sourceName) {
  const targetName = bindingTarget.value;
  if (!targetName || !guardEdit()) return;
  const source = sourceMap.value[sourceName] || {};
  const isDefault = (source.inputMode || "manual") === "default";
  const link = targetLinks(targetName)[0] || null;
  if (link) {
    link.sources = [sourceName];
    link.source = sourceName;
    if (link.mappingType === "constant" && !isDefault) link.mappingType = "direct";
    if (link.mappingType === "constant") link.defaultValue = String(source.defaultValue || "");
    link.enabled = true;
  } else {
    links.value.push({
      id: newLinkId(),
      source: sourceName,
      sources: [sourceName],
      target: targetName,
      mappingType: isDefault ? "constant" : "direct",
      defaultValue: isDefault ? String(source.defaultValue || "") : "",
      steps: [],
      enabled: true,
      original: null
    });
  }
  bindingTarget.value = "";
  notice.value = "已将 " + targetName + " 绑定至 " + sourceName + "，尚未保存";
}

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
  if (field && field.systemCalc) {
    notice.value = "系统计算字段由计算引擎生成，不需要人工映射。";
    return;
  }
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
  const field = allTargetFields.value.find((item) => item.name === name);
  if (field && field.systemCalc) {
    notice.value = "系统计算字段由计算引擎生成，不需要人工映射。";
    return;
  }
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
  if (!guardEdit()) return;
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
  if (!guardEdit()) return;
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
async function endConnect(event) {
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
  if (!guardEdit()) return;
  const existing = links.value.find((link) => link.target === targetName);
  if (existing) {
    if (!lineSources(existing).includes(sourceName)) {
      const yes = await askConfirm("目标字段 " + targetName + " 已有映射，要把 " + sourceName + " 加入这条映射变成组合映射吗？", {
        title: "目标字段已有映射",
        confirmText: "加入组合映射",
        cancelText: "打开原映射"
      });
      if (yes) {
        existing.sources = lineSources(existing).concat(sourceName);
        existing.mappingType = "composite";
      }
    }
    selectedId.value = existing.id;
    configOpen.value = true;
    return;
  }
  const source = sourceMap.value[sourceName];
  if (!source) return;
  const isDefault = (source.inputMode || "manual") === "default";
  const link = {
    id: newLinkId(),
    source: sourceName,
    sources: [sourceName],
    target: targetName,
    mappingType: isDefault ? "constant" : "direct",
    defaultValue: isDefault ? String(source.defaultValue || "") : "",
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
  if (field && field.systemCalc) {
    notice.value = "系统计算字段由计算引擎生成，不需要人工映射。";
    return;
  }
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
  // 先把当前状态记入历史，取消编辑时可以连同抽屉里的中间步骤一起回滚。
  pushHistory();
  editHistoryIndex = historyIndex.value;
  editSnapshot = clone(link);
  editSnapshotId = link.id;
  selectedId.value = link.id;
  configOpen.value = true;
  editingStepId.value = "";
  testResult.value = null;
  testValues.value = {};
  if (link.mappingType === "constant" && !String(link.defaultValue || "").trim()) {
    const field = sourceMap.value[link.sources[0]] || {};
    link.defaultValue = field.defaultValue || "";
  }
  lineSources(link).forEach((name) => {
    if (testValues.value[name] === undefined) {
      const field = sourceMap.value[name];
      testValues.value[name] = field && field.type === "number" ? 100 : field && field.type === "boolean" ? true : "示例";
    }
  });
}

function clearEditSnapshot() {
  editSnapshot = null;
  editSnapshotId = "";
  editHistoryIndex = -1;
}

function closeConfig() {
  if (editSnapshot && editSnapshotId) {
    const snapshot = editSnapshot;
    const id = editSnapshotId;
    const restoreIndex = editHistoryIndex;
    historyApplying.value = true;
    links.value = links.value.map((link) => (link.id === id ? clone(snapshot) : link));
    if (restoreIndex >= 0 && restoreIndex < history.value.length) {
      history.value = history.value.slice(0, restoreIndex + 1);
      historyIndex.value = restoreIndex;
    }
    nextTick(() => { historyApplying.value = false; });
  }
  clearEditSnapshot();
  configOpen.value = false;
  editingStepId.value = "";
  testResult.value = null;
  testValues.value = {};
  error.value = "";
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
  if (!guardEdit()) return;
  if (checked) addSourceToLink(link, name);
  else removeSourceFromLink(link, name);
}

function addStep(link) {
  if (!guardEdit()) return;
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
  if (!guardEdit()) return;
  link.mappingType = value;
  if (value === "constant" && !String(link.defaultValue || "").trim()) {
    const source = sourceMap.value[link.sources[0]] || {};
    link.defaultValue = source.defaultValue || "";
  }
  if (value !== "composite" && link.sources.length > 1) link.sources = [link.sources[0]];
}

function removeStep(link, index) {
  if (!guardEdit()) return;
  link.steps.splice(index, 1);
  editingStepId.value = "";
}

function moveStep(link, index, delta) {
  if (!guardEdit()) return;
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
  if (!guardEdit()) return;
  if (!selectedLink.value) return;
  links.value = links.value.filter((link) => link.id !== selectedLink.value.id);
  selectedId.value = "";
  clearEditSnapshot();
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
  if (selectedLink.value.mappingType === "constant") {
    const value = selectedLink.value.defaultValue;
    testResult.value = {
      ok: String(value || "").trim() !== "",
      output: value,
      records: [{ index: 0, id: "constant", name: "默认值", before: "—", after: value, ok: String(value || "").trim() !== "", error: "" }],
      failedIndex: 0,
      error: String(value || "").trim() ? "" : "默认值为空"
    };
    return;
  }
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
  const mappings = links.value
    .filter((link) => lineSources(link)[0] || link.mappingType === "constant")
    .map((link) => {
    const original = link.original || {};
    const sourceName = link.sources[0] || "";
    const source = sourceMap.value[sourceName] || {};
    const target = targetMap.value[link.target] || {};
    const transform = Object.assign({}, original.transform || {});
    transform.type = engineTransformType(link.mappingType, link.steps);
    transform.parameters = Object.assign({}, (original.transform || {}).parameters || {}, {
      mappingType: link.mappingType,
      sources: link.sources,
      steps: link.steps,
      enabled: link.enabled !== false
    });
    if (link.mappingType === "constant") {
      transform.type = "constant";
      transform.parameters.value = link.defaultValue;
      transform.parameters.steps = [];
    }
    return Object.assign({}, original, {
      source_field: sourceName,
      target_field: link.target,
      source_type: link.mappingType === "constant" ? "constant" : (source.type || original.source_type || "string"),
      target_type: target.type || original.target_type || "string",
      transform: transform,
      required: original.required !== undefined ? original.required : true,
      missing_policy: original.missing_policy || target.missingPolicy || "manual_review",
      target_group: original.target_group || target.group || "PRODUCT_TRANSACTION",
      role: original.role || (target.systemCalc ? "COMPUTED" : "RULE_INPUT"),
      description: original.description || source.label || "",
      regulatory_reference: original.regulatory_reference || ""
    });
  });
  const body = clone(props.document);
  body.mappings = mappings;
  return body;
}

function exportReviewCsv() {
  const header = ["目标字段", "目标字段名", "必填", "源字段", "映射方式", "处理步骤", "状态", "说明"];
  const rows = mappingBaseTargets.value.map((field) => {
    const link = targetLinks(field.name)[0] || null;
    const sources = link ? lineSources(link).map((name) => (sourceMap.value[name] || { name: name })) : [];
    return [
      field.name,
      field.label,
      field.required ? "是" : "",
      sources.map((source) => source.name).join(" + "),
      link ? mappingTypeLabel(link.mappingType) : "",
      link ? (link.steps || []).map((step) => step.name).join(" → ") : "",
      link ? ((LINK_STATUS_LABELS[lineStatus(link)] || lineStatus(link))) : "待映射",
      link && link.original ? (link.original.description || "") : ""
    ];
  });
  const escape = (value) => '"' + String(value == null ? "" : value).replace(/"/g, '""') + '"';
  const csv = "﻿" + [header].concat(rows).map((line) => line.map(escape).join(",")).join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = ((props.meta && props.meta.name) || (props.document && props.document.mapping_name) || "data-mapping") + "-审阅表.csv";
  a.click();
  URL.revokeObjectURL(a.href);
}

async function openImport() {
  if (readOnly.value) return;
  showImport.value = true;
  importLoading.value = true;
  importDoc.value = null;
  importDocId.value = "";
  try {
    const params = props.jurisdiction ? { jurisdiction: props.jurisdiction, kind: "data_mapping" } : { kind: "data_mapping" };
    const rows = await fetchRuleDocuments(params);
    importOptions.value = rows.filter((item) => item.kind === "data_mapping" && (!props.meta || item.id !== props.meta.id));
  } catch (err) {
    error.value = err.message || "读取可导入的映射文档失败";
  } finally {
    importLoading.value = false;
  }
}

async function loadImportDoc(id) {
  importDocId.value = id;
  importDoc.value = null;
  if (!id) return;
  importLoading.value = true;
  try {
    importDoc.value = await fetchRuleDocument(id);
  } catch (err) {
    error.value = err.message || "读取映射文档失败";
  } finally {
    importLoading.value = false;
  }
}

const importPreview = computed(() => {
  if (!importDoc.value || !importDoc.value.body) return [];
  const known = new Set(targetFields.value.map((field) => field.name));
  return (importDoc.value.body.mappings || []).map((mapping) => {
    const target = mapping.target_field;
    const link = targetLinks(target)[0] || null;
    return {
      mapping: mapping,
      target: target,
      source: mapping.source_field,
      known: known.has(target),
      existing: !!link,
      inScope: !scopeActive.value || scopeFieldSet.value.has(target)
    };
  });
});

const importStats = computed(() => {
  const rows = importPreview.value.filter((row) => row.known);
  return {
    total: rows.length,
    fresh: rows.filter((row) => !row.existing).length,
    overwrite: rows.filter((row) => row.existing).length,
    outOfScope: rows.filter((row) => !row.inScope).length
  };
});

async function applyImport() {
  if (!guardEdit()) return;
  if (!importDoc.value) return;
  const candidates = importPreview.value.filter((row) => (
    row.known
    && (!importInScopeOnly.value || row.inScope)
    && (importMode.value === "overwrite" || !row.existing)
  ));
  if (!candidates.length) {
    error.value = "没有可导入的映射";
    return;
  }
  const yes = await askConfirm("导入 " + candidates.length + " 条映射？导入后仍需点击「保存映射」才会写入文档。", {
    title: "导入字段映射",
    detail: importMode.value === "overwrite" ? "同目标字段的现有映射会被覆盖。" : "只补充还没有映射的目标字段。",
    confirmText: "导入"
  });
  if (!yes) return;
  const targets = new Set(candidates.map((row) => row.target));
  if (importMode.value === "overwrite") {
    links.value = links.value.filter((link) => !targets.has(link.target));
  }
  candidates.forEach((row) => {
    links.value.push(linkFromMapping(row.mapping, newLinkId()));
  });
  notice.value = "已导入 " + candidates.length + " 条映射，尚未保存";
  showImport.value = false;
}

function copyTransform(link) {
  if (!link) return;
  storedTransform.value = {
    mappingType: link.mappingType,
    defaultValue: link.defaultValue || "",
    steps: clone(link.steps || [])
  };
  notice.value = "已复制转换配置，可粘贴到其它映射";
}

function pasteTransform(link) {
  if (!guardEdit()) return;
  if (!link || !storedTransform.value) return;
  link.mappingType = storedTransform.value.mappingType;
  link.defaultValue = storedTransform.value.defaultValue || "";
  link.steps = clone(storedTransform.value.steps);
  notice.value = "已粘贴转换配置，尚未保存";
}

function openTemplateApply(link) {
  if (!link || !storedTransform.value) return;
  templateSourceId.value = link.id;
  templateTargets.value = links.value.filter((item) => item.id !== link.id).map((item) => item.id);
  showTemplates.value = true;
}

function toggleTemplateTarget(id) {
  templateTargets.value = templateTargets.value.includes(id)
    ? templateTargets.value.filter((item) => item !== id)
    : templateTargets.value.concat(id);
}

function applyStoredTransform() {
  if (!guardEdit()) return;
  if (!storedTransform.value || !templateTargets.value.length) return;
  const ids = new Set(templateTargets.value);
  links.value.forEach((link) => {
    if (!ids.has(link.id)) return;
    link.mappingType = storedTransform.value.mappingType;
    link.defaultValue = storedTransform.value.defaultValue || "";
    link.steps = clone(storedTransform.value.steps);
  });
  notice.value = "已把转换配置应用到 " + ids.size + " 条映射，尚未保存";
  showTemplates.value = false;
}

function applyRouteSource() {
  const name = String(route.query.source || "");
  if (!name) return;
  selectedSources.value = [name];
  selectedTargets.value = [];
  selectedMappings.value = [];
  statusSource.value = "all";
  notice.value = "已筛选引用「" + name + "」的映射";
  scrollToMappingList();
}

// 工作台已挂载时再点标准字段里的「映射 N」，路由参数变化走这里。
watch(() => route.query.source, () => applyRouteSource());

function applyRouteTarget() {
  const name = String(route.query.target || "");
  if (!name) return;
  mappingStatus.value = "all";
  mappingLimit.value = 20;
  if (!rowExpanded(name)) expandedRows.value = expandedRows.value.concat(name);
  const link = targetLinks(name)[0];
  if (link) editLink(link);
  else {
    const suggestion = suggestSource(name);
    if (suggestion) newSources.value = Object.assign({}, newSources.value, { [name]: suggestion.name });
  }
  scrollToTarget(name);
}

function save() {
  if (!guardEdit()) return;
  emit("save", currentBody());
}

function exportMappings() {
  const name = (props.meta && props.meta.name) || (props.document && props.document.mapping_name) || "data-mapping";
  const blob = new Blob([JSON.stringify(currentBody(), null, 2)], { type: "application/json;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name + ".json";
  a.click();
  URL.revokeObjectURL(a.href);
  notice.value = "已导出 " + name + ".json";
}

async function resetMappings() {
  if (!guardEdit()) return;
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
  selectedId.value = "";
  configOpen.value = false;
  clearEditSnapshot();
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
watch(scopeActive, (active) => {
  scopeFilter.value = active ? "scope" : "all";
  showOutOfScope.value = false;
});
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

function beforeUnload(event) {
  if (!dirty.value) return;
  event.preventDefault();
  event.returnValue = "";
}

onMounted(async () => {
  window.addEventListener("keydown", onKey);
  window.addEventListener("beforeunload", beforeUnload);
  loadOffsets();
  await loadDocs();
  loadLinks();
  await nextTick();
  fit();
  applyRouteSource();
  applyRouteTarget();
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKey);
  window.removeEventListener("beforeunload", beforeUnload);
});

defineExpose({
  markSaved: markSaved,
  isDirty: function () { return dirty.value; },
  exportMappings: function () { exportMappings(); },
  exportReviewCsv: function () { exportReviewCsv(); },
  focusTarget: function (name) { applyRouteTargetByName(name); },
  applyMappingsProposal: function (list) { applyMappingsProposal(list); },
  applyMappingOperations: function (list) { return applyMappingOperations(list); },
  applyMappingFilter: function (filter) { applyMappingFilter(filter); },
  draftMappings: function () { return draftMappings(); },
  saveMappings: function () { save(); },
  isReady: function () { return ready.value; },
  currentBody: function () { return currentBody(); }
});

function draftMappings() {
  return links.value
    .filter((link) => link.target)
    .map((link) => ({
      targetField: link.target,
      sourceField: (link.sources && link.sources[0]) || link.source || "",
      mappingType: link.mappingType || "direct",
      defaultValue: link.defaultValue || ""
    }));
}

function applyMappingFilter(filter) {
  const body = filter || {};
  if (body.status) mappingStatus.value = body.status;
  if (body.keyword !== undefined) mappingSearch.value = body.keyword;
  if (body.mappingType !== undefined) mappingTypeFilter.value = body.mappingType;
  mappingLimit.value = 20;
}

function applyMappingOperations(list) {
  if (!guardEdit()) return 0;
  const operations = Array.isArray(list) ? list : [];
  let changed = 0;
  operations.forEach((item) => {
    if (!item) return;
    if (item.op === "set_mapping" && item.mapping) {
      applyMappingsProposal([item.mapping]);
      changed += 1;
    } else if (item.op === "remove_mapping" && item.targetField) {
      const before = links.value.length;
      links.value = links.value.filter((link) => link.target !== item.targetField);
      if (links.value.length !== before) changed += 1;
    }
  });
  return changed;
}

function applyMappingsProposal(list) {
  if (!guardEdit()) return;
  const items = Array.isArray(list) ? list : [];
  items.forEach((item) => {
    if (!item) return;
    const target = String(item.targetField || item.target_field || "");
    if (!target) return;
    const source = String(item.sourceField || item.source_field || "");
    const mappingType = String(item.mappingType || item.mapping_type || "direct");
    const defaultValue = String(item.defaultValue ?? item.default_value ?? "");
    const existing = links.value.find((link) => link.target === target);
    if (existing) {
      existing.mappingType = mappingType;
      existing.defaultValue = defaultValue;
      if (source) {
        existing.source = source;
        existing.sources = [source];
      } else if (mappingType === "constant") {
        existing.source = "";
        existing.sources = [];
        existing.steps = [];
      }
      return;
    }
    links.value.push({
      id: newLinkId(),
      source: source,
      sources: source ? [source] : [],
      target: target,
      mappingType: mappingType,
      defaultValue: defaultValue,
      steps: [],
      enabled: true,
      original: null
    });
  });
  notice.value = "已应用 " + items.length + " 条映射建议，尚未保存";
}

function applyRouteTargetByName(name) {
  const value = String(name || "");
  if (!value) return;
  mappingStatus.value = "all";
  mappingLimit.value = 20;
  if (!rowExpanded(value)) expandedRows.value = expandedRows.value.concat(value);
  const link = targetLinks(value)[0];
  if (link) editLink(link);
  scrollToTarget(value);
}

function onKey(event) {
  const target = event.target;
  const tag = target && target.tagName ? String(target.tagName).toLowerCase() : "";
  const typing = tag === "input" || tag === "textarea" || tag === "select" || (target && target.isContentEditable);
  const modifier = event.ctrlKey || event.metaKey;
  if (modifier && !typing && event.key.toLowerCase() === "z") {
    event.preventDefault();
    if (event.shiftKey) redo();
    else undo();
    return;
  }
  if (modifier && !typing && event.key.toLowerCase() === "y") {
    event.preventDefault();
    redo();
    return;
  }
  if (typing) return;
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
      <span v-if="readOnly" class="tag amber">已发布 · 只读</span>
      <span class="spacer"></span>
      <button type="button" class="btn sm" title="撤销 Ctrl+Z" :disabled="!canUndo || readOnly" @click="undo">↶ 撤销</button>
      <button type="button" class="btn sm" title="重做 Ctrl+Shift+Z" :disabled="!canRedo || readOnly" @click="redo">↷ 重做</button>
      <template v-if="viewMode === 'canvas'">
        <button type="button" class="btn sm" @click="fit">适配</button>
        <button type="button" class="btn sm" @click="fitVisible">居中选中</button>
        <button type="button" class="btn sm" @click="autoLayout">自动布局</button>
        <button type="button" class="btn sm" @click="resetLayout">重置布局</button>
        <button type="button" class="btn sm" @click="zoomBy(1 / 1.12)">−</button>
        <button type="button" class="btn sm" @click="zoomBy(1.12)">+</button>
      </template>
      <span v-if="dirty" class="fm-dirty" @click="showDiff = true">
        未保存 · 新增 {{ changeSummary.added.length }} · 修改 {{ changeSummary.changed.length }} · 删除 {{ changeSummary.removed.length }}
      </span>
      <span v-else-if="savedAt" class="fm-saved">已保存 {{ savedAt }}</span>
      <button type="button" class="btn sm" @click="openCheck">配置检查<span v-if="issueCounts.error" class="fm-badge">{{ issueCounts.error }}</span></button>
      <details class="fm-more">
        <summary class="btn sm">更多</summary>
        <div class="fm-more-menu">
          <button type="button" class="btn sm" :disabled="readOnly" @click="openImport">导入映射</button>
          <button type="button" class="btn sm" @click="exportReviewCsv">导出审阅表</button>
          <button type="button" class="btn sm" @click="exportMappings">导出 JSON</button>
          <button type="button" class="btn sm" :disabled="readOnly" @click="resetMappings">重置映射</button>
        </div>
      </details>
    </div>

    <div class="fm-statusbar">
      <div class="fm-scope">
        <span class="fm-scope-label">适用风险暴露类型</span>
        <template v-if="scopeActive">
          <span v-for="code in scopeClasses.slice(0, 4)" :key="code" class="tag blue" :title="scopeClassTitle">{{ scopeClassLabels[code] || code }}</span>
          <span v-if="scopeClasses.length > 4" class="tag blue" :title="scopeClassTitle">+{{ scopeClasses.length - 4 }}</span>
        </template>
        <span v-else class="tag amber">未选择</span>
        <span class="dim fm-scope-note">
          <template v-if="scopeActive">范围内 {{ scopedTargetFields.length + scopedSystemTargetCount }}（含系统计算 {{ scopedSystemTargetCount }}） · 范围外 {{ outOfScopeTargetFields.length + outOfScopeSystemTargetCount }}</template>
          <template v-else>未选择时显示全部非计算字段，建议先选择</template>
        </span>
        <span class="fm-scope-acts">
          <button type="button" class="btn sm" @click="emit('edit-scope')">调整范围</button>
          <button v-if="outOfScopeLinkCount" type="button" class="btn sm" @click="showScopeResolve = true">处理范围外 {{ outOfScopeLinkCount }}</button>
        </span>
      </div>
      <div class="fm-stats">
        <button type="button" class="fm-stat" :class="{ alert: overview.sourceUsed < overview.sourceTotal }" title="查看未被使用的源字段" @click="focusUnusedSources">
          产品标准字段 <b>{{ overview.sourceUsed }}</b> / {{ overview.sourceTotal }}
        </button>
        <button type="button" class="fm-stat" title="查看待映射目标字段" @click="clearMappingFocus(); mappingStatus = 'pending'">
          监管目标字段 <b>{{ overview.targetMapped }}</b> / {{ overview.targetTotal }}
        </button>
        <button type="button" class="fm-stat" :class="{ danger: overview.requiredUnmapped > 0 }" title="只看必填未映射" @click="focusRequiredUnmapped">
          必填未映射 <b>{{ overview.requiredUnmapped }}</b> / {{ overview.requiredTotal }}
        </button>
        <button type="button" class="fm-stat" :class="{ on: ruleOnly }" title="只看规则字段" @click="focusRuleFields">
          规则字段覆盖 <b>{{ overview.ruleMapped }}</b> / {{ overview.ruleTotal }}
        </button>
        <button type="button" class="fm-stat" :class="{ danger: issueSummary.errors > 0 }" title="打开配置检查" @click="openCheck">
          错误 <b>{{ issueSummary.errors }}</b>
        </button>
        <button type="button" class="fm-stat warn" :class="{ alert: issueSummary.warnings > 0 }" title="打开配置检查（含范围外映射）" @click="openCheck">
          警告 <b>{{ issueSummary.warnings }}</b>
        </button>
        <button v-if="issueSummary.info" type="button" class="fm-stat" title="系统计算字段等提示" @click="openCheck">
          提示 <b>{{ issueSummary.info }}</b>
        </button>
      </div>
    </div>

    <p v-if="readOnly" class="notice warn">当前监管版本已发布，字段映射只读。要修改请先到监管规则维护工作台撤回发布。</p>
    <p v-if="conflictNotice" class="notice danger">{{ conflictNotice }}</p>

    <p v-if="error" class="notice danger">{{ error }}</p>
    <p v-if="notice" class="notice ok">{{ notice }}</p>
    <div v-if="loading" class="loading"><span class="spin"></span>正在读取目标字段</div>

    <template v-else>
      <div class="fm-layout" :class="{ 'left-collapsed': targetCollapsed, 'right-collapsed': sourceCollapsed }">
        <aside class="fm-side target" :class="{ collapsed: targetCollapsed }">
          <div class="fm-side-head">
            <strong title="包含范围内、范围外和系统计算字段；顶部统计的是映射覆盖数">监管目标字段（全部）</strong><span class="dim">{{ displayTargets.length }} / {{ displayScopeTargets.length }}</span>
            <button type="button" class="fm-side-icon" title="展开全部字段分组" @click="expandGroups('target', true)">▾</button>
            <button type="button" class="fm-side-icon" title="收起全部字段分组" @click="expandGroups('target', false)">▸</button>
            <button type="button" class="fm-side-toggle" :title="targetCollapsed ? '展开监管目标字段' : '收起监管目标字段'" :aria-expanded="!targetCollapsed" @click="toggleSide('target')">{{ targetCollapsed ? "»" : "«" }}</button>
          </div>
          <input v-model="searchTarget" class="fm-search" type="search" placeholder="搜索字段" />
          <div class="fm-side-tools">
            <button type="button" class="btn xs" @click="targetFilterOpen = !targetFilterOpen">筛选<span v-if="targetFilterCount"> · {{ targetFilterCount }}</span></button>
            <span class="spacer"></span>
            <span class="fm-side-count">已选 <b>{{ selectedTargets.length }}</b></span>
            <button type="button" class="btn xs" @click="selectAllTargets">全选</button>
            <button type="button" class="btn xs" @click="clearTargets">清空</button>
          </div>
          <div v-show="targetFilterOpen" class="fm-filters">
            <select v-if="scopeActive" v-model="scopeFilter">
              <option value="scope">范围内</option>
              <option value="out">范围外</option>
              <option value="all">全部</option>
            </select>
            <select v-model="groupTarget">
              <option value="">全部字段大类</option>
              <option v-for="group in targetGroupOptions" :key="group.code" :value="group.code">{{ group.label }}</option>
            </select>
            <select v-model="statusTarget">
              <option value="all">全部状态</option>
              <option value="mapped">已映射</option>
              <option value="unmapped">未映射</option>
              <option value="required">必填</option>
              <option value="required-unmapped">必填未映射</option>
            </select>
            <button type="button" class="btn xs" @click="clearTargetFilters">清空筛选</button>
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
                  :class="{ active: selectedTargets.includes(field.name) || highlight === 't_' + field.name, calc: field.systemCalc }"
                  role="button"
                  tabindex="0"
                  @click="pickTargetRow(field, indexOfTarget(field.name), $event)"
                  @dblclick="openTarget(field)"
                >
                  <input
                    v-if="!field.systemCalc"
                    type="checkbox"
                    class="fm-check"
                    :checked="selectedTargets.includes(field.name)"
                    @click.stop
                    @change="toggleTarget(field.name)"
                  />
                  <span v-else class="fm-check-calc" title="系统计算字段">ƒ</span>
                  <span class="fm-dot" :class="{ on: mappedTargets.has(field.name) }"></span>
                  <span class="fm-field-main">
                    <span class="fm-field-name" :title="field.label">{{ field.label }}</span>
                    <span class="fm-field-code" :title="field.name">{{ fieldEnglishName(field) }}</span>
                  </span>
                  <span class="fm-field-type">{{ field.type }}</span>
                  <span v-if="field.systemCalc" class="tag blue">系统计算</span>
                  <span v-else-if="field.required" class="fm-field-required">必填</span>
                </div>
              </div>
            </div>
            <p v-if="!targetGroups.length" class="dim" style="padding: 8px">
              {{ statusTarget === 'unmapped' && visibleScopeTargets.length ? '目标字段都已有映射，切换「全部状态」查看。' : '没有符合条件的目标字段。' }}
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
          <div class="fm-canvas-tools">
            <input v-model="canvasSearch" type="search" placeholder="搜索画布字段" />
            <span class="fm-legend"><i class="direct"></i>直接 <i class="conditional"></i>条件 <i class="composite"></i>组合 <i class="calculation"></i>计算 <i class="invalid"></i>有误</span>
          </div>
          <div class="fm-world" :style="worldStyle">
            <div class="fm-lane" style="left: 16px; top: 2px">源字段</div>
            <div class="fm-lane" style="left: 490px; top: 2px">目标字段</div>
            <svg class="fm-svg" :width="worldSize.w" :height="worldSize.h">
              <path
                v-for="line in lines"
                :key="line.id"
                :d="line.d"
                class="fm-line"
                :class="[line.type, line.status, { selected: line.selected, faded: hoverName && line.sourceName !== hoverName && line.targetName !== hoverName }]"
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
              :class="{ mapped: mappedSourceCount.has(node.name), active: node.selected || highlight === node.id, selected: node.selected, match: canvasMatchNames && canvasMatchNames.has(node.name), faded: canvasMatchNames && !canvasMatchNames.has(node.name) }"
              :data-name="node.name"
              :title="node.name + ' · ' + node.label + ' · ' + node.type"
              :style="{ left: node.x + 'px', top: node.y + 'px', width: node.w + 'px', height: node.h + 'px' }"
              @mouseenter="hoverNodeId = node.id"
              @mouseleave="hoverNodeId = ''"
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
              :class="{ mapped: node.mapped, active: node.selected || highlight === node.id, selected: node.selected, required: node.required, match: canvasMatchNames && canvasMatchNames.has(node.name), faded: canvasMatchNames && !canvasMatchNames.has(node.name) }"
              :data-name="node.name"
              :title="node.name + ' · ' + node.label + ' · ' + node.type"
              :style="{ left: node.x + 'px', top: node.y + 'px', width: node.w + 'px', height: node.h + 'px' }"
              @mouseenter="hoverNodeId = node.id"
              @mouseleave="hoverNodeId = ''"
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
            <h3>
              映射关系 <span class="sub">{{ linkedMappingRows.length }} / {{ mappingRows.length }}</span>
              <span class="fm-progress" :title="'映射进度 ' + overview.progress + '%'"><i :style="{ width: overview.progress + '%' }"></i></span>
              <span class="fm-progress-num">{{ overview.progress }}%</span>
            </h3>
            <input v-model="mappingSearch" class="fm-search" type="search" placeholder="搜索目标字段、源字段或说明" />
            <div class="fm-seg">
              <button type="button" :class="{ active: mappingStatus === 'all' }" @click="mappingStatus = 'all'">全部<span class="cnt">{{ statusCounts.all }}</span></button>
              <button type="button" :class="{ active: mappingStatus === 'pending' }" @click="mappingStatus = 'pending'">待映射<span class="cnt">{{ statusCounts.pending }}</span></button>
              <button type="button" :class="{ active: mappingStatus === 'required-pending' }" @click="mappingStatus = 'required-pending'">必填未映射<span class="cnt" :class="{ alert: statusCounts['required-pending'] > 0 }">{{ statusCounts['required-pending'] }}</span></button>
              <button type="button" :class="{ active: mappingStatus === 'mapped' }" @click="mappingStatus = 'mapped'">已映射<span class="cnt">{{ statusCounts.mapped }}</span></button>
              <button type="button" :class="{ active: mappingStatus === 'error' }" @click="mappingStatus = 'error'">配置有误<span class="cnt" :class="{ alert: statusCounts.error > 0 }">{{ statusCounts.error }}</span></button>
              <button type="button" :class="{ active: mappingStatus === 'disabled' }" @click="mappingStatus = 'disabled'">已停用<span class="cnt">{{ statusCounts.disabled }}</span></button>
              <button v-if="scopeActive" type="button" :class="{ active: mappingStatus === 'out-scope' }" @click="mappingStatus = 'out-scope'">范围外<span class="cnt">{{ statusCounts['out-scope'] }}</span></button>
            </div>
            <select v-model="mappingTypeFilter">
              <option value="">全部映射方式</option>
              <option v-for="type in MAPPING_TYPES" :key="type.key" :value="type.key">{{ type.label }}</option>
            </select>
            <span v-if="ruleOnly || mappingStatus !== 'all'" class="fm-focus-chip">
              {{ ruleOnly ? "只看规则字段" : "" }}{{ ruleOnly && mappingStatusLabel ? " · " : "" }}{{ mappingStatus !== 'all' ? mappingStatusLabel : "" }}
              <button type="button" @click="clearMappingFocus">×</button>
            </span>
          </div>

          <div class="fm-batchbar fixed" :class="{ idle: !selectionActive && !selectedMappings.length }">
            <span class="fm-batch-summary">已选 <b>{{ selectedSources.length }}</b> / <b>{{ selectedTargets.length }}</b> / <b>{{ selectedMappings.length }}</b></span>
            <span v-if="selectionActive && !selectedSources.length && !selectedTargets.length && !selectedMappings.length" class="fm-linkhint">左右选中字段联动</span>
            <span class="spacer"></span>
            <template v-if="selectionActive || selectedMappings.length">
              <button type="button" class="btn sm" :disabled="readOnly || !selectedSources.length || selectedSources.length !== selectedTargets.length" @click="batchDirectMap">批量建立</button>
              <select v-model="batchType" class="fm-batch-type">
                <option v-for="type in MAPPING_TYPES" :key="type.key" :value="type.key">{{ type.label }}</option>
              </select>
              <button type="button" class="btn sm" :disabled="readOnly || !selectedMappings.length" @click="batchSetType">批量改方式</button>
              <button type="button" class="btn sm danger" :disabled="readOnly || !selectedMappings.length" @click="removeSelectedMappings">批量取消</button>
              <button type="button" class="btn sm" @click="clearSelections">清除选择</button>
            </template>
            <span v-else class="dim">在左右字段栏或表格勾选后可批量操作</span>
          </div>

          <div class="fm-table-scroll">
            <div class="fm-row head">
              <input
                type="checkbox"
                class="fm-check"
                :checked="allVisibleRowsSelected"
                title="全选本页"
                aria-label="全选本页"
                @change="toggleAllVisibleRows"
              />
              <span>目标标准字段 <em class="fm-head-note">共 {{ linkedMappingRows.length }} 行</em></span>
              <span>源字段</span>
              <span>映射方式</span>
              <span>状态</span>
              <span></span>
            </div>
            <template v-for="row in visibleMappingRows" :key="row.field.name">
              <div
                class="fm-row"
                :data-target="row.field.name"
                :class="[row.link ? row.status : 'pending', { opened: rowExpanded(row.field.name), binding: bindingTarget === row.field.name }]"
                @click="toggleRow(row.field.name)"
                @dblclick.stop="row.link ? editLink(row.link) : startBind(row.field.name)"
              >
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
                    <span class="lt">{{ row.field.label }}</span>
                    <span v-if="row.field.required" class="fm-inline-req">必填</span>
                    <span v-if="row.isRuleField" class="fm-inline-rule">规则</span>
                  </span>
                  <div v-if="row.issueText" class="fm-row-error" :title="row.issueText">⚠ {{ row.issueText }}</div>
                </div>
                <button
                  type="button"
                  class="scell fm-scell"
                  :class="{ binding: bindingTarget === row.field.name }"
                  :title="bindingTarget === row.field.name ? '在右侧选择要绑定的字段' : '点击后在右侧标准字段里选择源字段'"
                  @click.stop="bindingTarget === row.field.name ? cancelBind() : startBind(row.field.name)"
                >
                  <template v-if="row.link && row.link.mappingType === 'constant'">
                    默认值：{{ row.link.defaultValue || "（未填）" }}<span class="fm-scell-edit">更换</span>
                  </template>
                  <template v-else-if="row.sources.length">
                    <span class="n">{{ row.sources.map((source) => source.name).join(" + ") }}<span v-if="row.link" class="fm-scell-edit">更换</span></span>
                    <span v-if="row.sourceLabelText" class="l">{{ row.sourceLabelText }}</span>
                  </template>
                  <template v-else>—</template>
                </button>
                <div class="mcell"><span class="tx">{{ row.typeLabel }}</span></div>
                <div class="stcell">
                  <i class="dot" :class="row.link ? row.status : 'pending'"></i>
                  {{ row.statusLabel }}
                  <span v-if="row.stepCount" class="dim">· {{ row.stepCount }} 步</span>
                </div>
                <button
                  type="button"
                  class="btn xs exp"
                  :title="row.link ? '编辑映射' : '选择右侧字段建立映射'"
                  @click.stop="row.link ? editLink(row.link) : startBind(row.field.name)"
                >{{ row.link ? "编辑" : "建立" }}</button>
              </div>
              <div v-if="rowExpanded(row.field.name)" class="fm-row-detail">
                <template v-if="row.link">
                  <div class="fm-detail-grid">
                    <div>
                      <h6>源字段 / 默认值</h6>
                      <div v-if="row.link.mappingType === 'constant'" class="fm-fieldcard">
                        <span class="n">{{ row.link.defaultValue || "（未填默认值）" }}</span>
                        <div class="m">{{ row.sources.map((source) => source.name).join(" + ") }} · 常量赋值</div>
                      </div>
                      <template v-else>
                        <div v-for="source in row.sources" :key="source.name" class="fm-fieldcard">
                          <span class="n">{{ source.name }}</span>
                          <div class="m">{{ source.label }} · {{ source.type }}</div>
                        </div>
                      </template>
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
                    <span>目标字段 {{ row.field.name }}<template v-if="row.field.label && row.field.label !== row.field.name">（{{ row.field.label }}）</template> 还没有映射。</span>
                    <template v-if="suggestions[row.field.name]">
                      <span class="fm-suggest">建议</span>
                      <button type="button" class="btn sm" @click.stop="applySuggestion(row.field.name)">
                        {{ suggestions[row.field.name].name }} · {{ suggestions[row.field.name].label }}
                      </button>
                    </template>
                    <FieldPicker
                      v-model="newSources[row.field.name]"
                      :fields="pickerSources"
                      :disabled="readOnly"
                      placeholder="搜索并选择源字段"
                    />
                    <button type="button" class="btn sm primary" :disabled="readOnly" @click.stop="createLinkFromList(row.field.name)">建立映射</button>
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

        <aside class="fm-side source" :class="{ collapsed: sourceCollapsed, 'binding-active': !!bindingTarget }">
          <div class="fm-side-head">
            <strong>产品标准字段</strong><span class="dim">{{ filteredSources.length }} / {{ sourceFields.length }}</span>
            <button type="button" class="fm-side-icon" title="展开全部字段分组" @click="expandGroups('source', true)">▾</button>
            <button type="button" class="fm-side-icon" title="收起全部字段分组" @click="expandGroups('source', false)">▸</button>
            <button type="button" class="fm-side-toggle" :title="sourceCollapsed ? '展开产品标准字段' : '收起产品标准字段'" :aria-expanded="!sourceCollapsed" @click="toggleSide('source')">{{ sourceCollapsed ? "«" : "»" }}</button>
          </div>
          <div v-if="bindingTarget" class="fm-bind-banner">
            <span class="truncate">点击字段绑定至 <b class="mono">{{ bindingTarget }}</b></span>
            <span class="spacer"></span>
            <button type="button" @click="cancelBind">取消</button>
          </div>
          <input v-model="searchSource" class="fm-search" type="search" placeholder="搜索字段" />
          <div class="fm-side-tools">
            <button type="button" class="btn xs" @click="sourceFilterOpen = !sourceFilterOpen">筛选<span v-if="sourceFilterCount"> · {{ sourceFilterCount }}</span></button>
            <span class="spacer"></span>
            <span class="fm-side-count">已选 <b>{{ selectedSources.length }}</b></span>
            <button type="button" class="btn xs" @click="selectAllSources">全选</button>
            <button type="button" class="btn xs" @click="clearSources">清空</button>
          </div>
          <div v-show="sourceFilterOpen" class="fm-filters">
            <select v-model="groupSource">
              <option value="">全部字段大类</option>
              <option v-for="group in sourceGroupOptions" :key="group.code" :value="group.code">{{ group.label }}</option>
            </select>
            <select v-model="statusSource">
              <option value="all">全部状态</option>
              <option value="mapped">已映射</option>
              <option value="unmapped">未映射</option>
              <option value="unused">未被使用</option>
            </select>
            <button type="button" class="btn xs" @click="clearSourceFilters">清空筛选</button>
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
                  @click="onSourceRowClick(field, indexOfSource(field.name), $event)"
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
                    <span class="fm-field-name" :title="field.label">{{ field.label }}</span>
                    <span class="fm-field-code" :title="field.name">{{ fieldEnglishName(field) }}</span>
                  </span>
                  <span class="fm-field-type">{{ field.type }}</span>
                  <span v-if="field.inputMode === 'default'" class="fm-field-required" title="默认值字段">默认</span>
                  <span v-if="sourceLinkCount(field.name)" class="fm-field-count">{{ sourceLinkCount(field.name) }}</span>
                </div>
              </div>
            </div>
            <p v-if="!sourceGroups.length" class="dim" style="padding: 8px">
              {{ statusSource === 'unmapped' && sourceFields.length ? '源字段都已有映射，切换「全部状态」查看。' : '没有符合条件的源字段。' }}
            </p>
          </div>
        </aside>
      </div>
    </template>

    <Drawer :open="configOpen" :title="configTitle" @close="closeConfig">
      <template v-if="selectedLink">
        <div class="fm-config-head">
          <label class="field">映射方式
            <select :value="selectedLink.mappingType" :disabled="readOnly" @change="setMappingType(selectedLink, $event.target.value)">
              <option v-for="type in MAPPING_TYPES" :key="type.key" :value="type.key">{{ type.label }}</option>
            </select>
          </label>
          <label class="fm-switch"><input v-model="selectedLink.enabled" type="checkbox" :disabled="readOnly" /> 启用</label>
          <span class="spacer"></span>
          <button type="button" class="btn sm" @click="copyTransform(selectedLink)">复制转换</button>
          <button v-if="storedTransform" type="button" class="btn sm" :disabled="readOnly" @click="pasteTransform(selectedLink)">粘贴转换</button>
          <button v-if="storedTransform" type="button" class="btn sm" :disabled="readOnly" @click="openTemplateApply(selectedLink)">应用到其它字段</button>
          <button type="button" class="btn sm danger" :disabled="readOnly" @click="deleteLink">删除映射</button>
        </div>

        <div v-if="selectedLink.mappingType !== 'composite'" class="fm-block">
          <h4>源字段</h4>
          <label class="field">源字段
            <FieldPicker
              :model-value="lineSources(selectedLink)[0] || ''"
              :fields="pickerSources"
              :disabled="readOnly"
              allow-empty
              placeholder="搜索并选择源字段"
              @update:model-value="setPrimarySource(selectedLink, $event)"
            />
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

        <div v-if="selectedLink.mappingType === 'constant'" class="fm-block">
          <h4>默认值</h4>
          <label class="field">默认值
            <input v-model="selectedLink.defaultValue" :disabled="readOnly" placeholder="如 LOAN / HKD / 100" />
          </label>
          <p class="dim">默认值字段属于产品级常量，不依赖逐笔数据列；保存后映射以 constant 转换写入。</p>
        </div>

        <div v-if="selectedLink.mappingType !== 'constant'" class="fm-block">
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
              <label class="fm-switch"><input v-model="step.enabled" type="checkbox" :disabled="readOnly" /> 启用</label>
              <button type="button" class="btn sm" :disabled="readOnly" @click="moveStep(selectedLink, index, -1)">↑</button>
              <button type="button" class="btn sm" :disabled="readOnly" @click="moveStep(selectedLink, index, 1)">↓</button>
              <button type="button" class="btn sm danger" :disabled="readOnly" @click="removeStep(selectedLink, index)">删除</button>
            </div>
            <p v-if="!(selectedLink.steps || []).length" class="dim">
              {{ selectedLink.mappingType === "direct"
                ? "还没有处理步骤。直接映射可以不配置步骤。"
                : "还没有处理步骤。当前为" + mappingTypeLabel(selectedLink.mappingType) + "，请配置处理步骤。" }}
            </p>
          </div>
          <div class="fm-step-add">
            <select v-model="stepPicker">
              <option value="">选择处理类型</option>
              <optgroup v-for="category in stepOptions" :key="category.key" :label="category.label">
                <option v-for="type in category.types" :key="type.key" :value="type.key">{{ type.label }}</option>
              </optgroup>
            </select>
            <button type="button" class="btn sm primary" :disabled="readOnly || !stepPicker" @click="addStep(selectedLink)">添加处理步骤</button>
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
          <button type="button" class="btn" @click="closeConfig" title="放弃本次在抽屉里的修改">取消编辑</button>
          <button type="button" class="btn primary" :disabled="readOnly" @click="saveAndClose">保存映射并关闭</button>
        </div>
    </Drawer>

    <Drawer :open="checkOpen" :title="'配置检查 · 完成率 ' + completion.rate + '%'" @close="checkOpen = false">
      <div class="fm-check-stats">
        <span>目标字段 {{ completion.mapped }} / {{ completion.total }}</span>
        <span>必填字段 {{ completion.requiredMapped }} / {{ completion.required }}</span>
        <span class="tag danger">错误 {{ issueCounts.error }}</span>
        <span class="tag amber">警告 {{ issueCounts.warning }}</span>
        <span class="tag">提示 {{ issueCounts.info }}</span>
        <button v-if="outOfScopeLinkCount" type="button" class="btn sm" @click="checkOpen = false; showScopeResolve = true">处理范围外 {{ outOfScopeLinkCount }}</button>
      </div>
      <div v-for="group in groupedIssues" :key="group.key" class="fm-issue-group">
        <button type="button" class="fm-issue-group-head" @click="toggleIssueGroup(group)">
          <span class="tag" :class="group.severity === 'error' ? 'danger' : group.severity === 'warning' ? 'amber' : 'blue'">{{ group.severity === 'error' ? "错误" : group.severity === 'warning' ? "警告" : "提示" }}</span>
          <b>{{ group.label }}</b>
          <span class="dim">{{ group.items.length }} 项</span>
          <span class="spacer"></span>
          <span class="fm-group-arrow">{{ issueGroupIsOpen(group) ? "▾" : "▸" }}</span>
        </button>
        <div v-show="issueGroupIsOpen(group)">
          <div v-for="(item, index) in group.items" :key="group.key + '_' + index" class="fm-issue">
            <span>{{ item.message }}</span>
            <button type="button" class="btn sm" @click="openIssue(item)">
              {{ item.action === 'map' ? "去建立映射" : item.action === 'scope' ? "处理范围" : "打开映射" }}
            </button>
          </div>
        </div>
      </div>
      <p v-if="!issues.length" class="notice ok">没有发现问题。</p>
    </Drawer>

    <Drawer :open="showDiff" title="未保存的变更" wide @close="showDiff = false">
      <div class="fm-check-stats">
        <span>新增 <b>{{ changeSummary.added.length }}</b></span>
        <span>修改 <b>{{ changeSummary.changed.length }}</b></span>
        <span>删除 <b>{{ changeSummary.removed.length }}</b></span>
      </div>
      <div v-if="changeSummary.added.length" class="fm-diff-block">
        <h4>新增映射</h4>
        <div v-for="link in changeSummary.added" :key="'add_' + link.id" class="fm-diff-row">
          <span class="tag green">新增</span>
          <span class="mono">{{ lineSources(link).join(" + ") }} → {{ link.target }}</span>
        </div>
      </div>
      <div v-if="changeSummary.changed.length" class="fm-diff-block">
        <h4>修改映射</h4>
        <div v-for="item in changeSummary.changed" :key="'chg_' + item.after.id" class="fm-diff-row">
          <span class="tag amber">修改</span>
          <span class="mono">{{ lineSources(item.after).join(" + ") }} → {{ item.after.target }}</span>
          <span class="dim">{{ mappingTypeLabel(item.before.mappingType) }} → {{ mappingTypeLabel(item.after.mappingType) }} · {{ (item.after.steps || []).length }} 步</span>
        </div>
      </div>
      <div v-if="changeSummary.removed.length" class="fm-diff-block">
        <h4>删除映射</h4>
        <div v-for="link in changeSummary.removed" :key="'del_' + link.id" class="fm-diff-row">
          <span class="tag danger">删除</span>
          <span class="mono">{{ lineSources(link).join(" + ") }} → {{ link.target }}</span>
        </div>
      </div>
      <p v-if="!dirty" class="notice ok">当前没有未保存的修改。</p>
      <template #footer>
        <button type="button" class="btn" @click="showDiff = false">关闭</button>
        <button type="button" class="btn primary" :disabled="readOnly || !dirty" @click="showDiff = false; save()">保存映射</button>
      </template>
    </Drawer>

    <Drawer :open="showScopeResolve" title="范围外映射" wide @close="showScopeResolve = false">
      <p class="dim">这些映射的目标字段不在当前「适用风险暴露类型」范围内。可以保留（不影响已有配置），也可以删除。</p>
      <div v-for="link in outOfScopeLinks" :key="'scope_' + link.id" class="fm-diff-row">
        <span class="tag amber">范围外</span>
        <span class="mono">{{ lineSources(link).join(" + ") }} → {{ link.target }}</span>
        <span class="spacer"></span>
        <button type="button" class="btn sm danger" :disabled="readOnly" @click="removeOutOfScopeLink(link)">删除</button>
      </div>
      <p v-if="!outOfScopeLinks.length" class="notice ok">没有范围外映射。</p>
      <template #footer>
        <button type="button" class="btn" @click="showScopeResolve = false">关闭</button>
        <button type="button" class="btn danger" :disabled="readOnly || !outOfScopeLinks.length" @click="removeAllOutOfScope">全部删除</button>
      </template>
    </Drawer>

    <Drawer :open="showImport" title="导入字段映射" wide @close="showImport = false">
      <div class="fm-import">
        <label class="field">来源映射文档
          <select v-model="importDocId" :disabled="importLoading" @change="loadImportDoc(importDocId)">
            <option value="">选择映射文档</option>
            <option v-for="item in importOptions" :key="item.id" :value="item.id">{{ item.name }} · {{ item.ruleVersion || item.rule_version || "" }} · {{ item.docVersion || item.doc_version || "" }}</option>
          </select>
        </label>
        <label class="field">导入方式
          <select v-model="importMode">
            <option value="fill">只补充未映射的目标字段</option>
            <option value="overwrite">覆盖同目标字段的现有映射</option>
          </select>
        </label>
        <label class="fm-switch">
          <input v-model="importInScopeOnly" type="checkbox" /> 只导入当前适用风险暴露类型范围内的字段
        </label>
        <div v-if="importLoading" class="loading"><span class="spin"></span>正在读取映射文档</div>
        <template v-else-if="importDoc">
          <div class="fm-check-stats">
            <span>可导入 <b>{{ importStats.total }}</b></span>
            <span>新增 <b>{{ importStats.fresh }}</b></span>
            <span>已有 <b>{{ importStats.overwrite }}</b></span>
            <span v-if="importStats.outOfScope">范围外 <b>{{ importStats.outOfScope }}</b></span>
          </div>
          <table class="tbl compact">
            <thead><tr><th>目标字段</th><th>源字段</th><th>状态</th></tr></thead>
            <tbody>
              <tr v-for="row in importPreview.slice(0, 30)" :key="'imp_' + row.target">
                <td class="mono">{{ row.target }}</td>
                <td class="mono">{{ row.source }}</td>
                <td>
                  <span v-if="!row.known" class="tag">目标字段不在当前产品</span>
                  <span v-else-if="row.existing" class="tag amber">已有映射</span>
                  <span v-else class="tag green">可导入</span>
                </td>
              </tr>
            </tbody>
          </table>
          <p v-if="importPreview.length > 30" class="dim">仅显示前 30 条，共 {{ importPreview.length }} 条。</p>
        </template>
      </div>
      <template #footer>
        <button type="button" class="btn" @click="showImport = false">取消</button>
        <button type="button" class="btn primary" :disabled="readOnly || !importDoc" @click="applyImport">导入</button>
      </template>
    </Drawer>

    <Drawer :open="showTemplates" title="应用转换配置" wide @close="showTemplates = false">
      <p class="dim">把 {{ storedTransform ? mappingTypeLabel(storedTransform.mappingType) : "" }} · {{ storedTransform ? storedTransform.steps.length : 0 }} 个步骤应用到这个产品组下的其它映射。</p>
      <div class="fm-template-list">
        <label v-for="link in links.filter((item) => item.id !== templateSourceId)" :key="'tpl_' + link.id" class="fm-template-item">
          <input type="checkbox" :checked="templateTargets.includes(link.id)" @change="toggleTemplateTarget(link.id)" />
          <span class="mono">{{ lineSources(link).join(" + ") }} → {{ link.target }}</span>
        </label>
      </div>
      <template #footer>
        <button type="button" class="btn" @click="showTemplates = false">取消</button>
        <button type="button" class="btn primary" :disabled="readOnly || !templateTargets.length" @click="applyStoredTransform">应用</button>
      </template>
    </Drawer>
  </div>
</template>
