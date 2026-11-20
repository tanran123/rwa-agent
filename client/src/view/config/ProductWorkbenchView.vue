<script setup>
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  fetchParameterTables, fetchReferenceLists, fetchRuleDocument, fetchRuleDocuments, saveRuleDocument
} from "@/api/config";
import { fetchProductGroupMappings } from "@/api/product";
import { useContext } from "@/composables/useContext";
import ExposureOverview from "@/components/ExposureOverview.vue";
import FieldMappingWorkbench from "@/components/FieldMappingWorkbench.vue";
import StandardFieldDrawer from "@/components/StandardFieldDrawer.vue";
import FieldGroupDrawer from "@/components/FieldGroupDrawer.vue";
import DictionaryManagerDrawer from "@/components/DictionaryManagerDrawer.vue";
import { buildExposureModel } from "@/utils/exposureModel";
import {
  familyMeta, mappingTargetSet, matchedRules, productStatus, STATUS_META
} from "@/utils/productCatalog";
import { askConfirm } from "@/utils/confirm";

const route = useRoute();
const router = useRouter();
const { session, scopeVersion, loadBootstrap } = useContext();

const MODULES = [
  { key: "info", label: "产品组信息" },
  { key: "fields", label: "标准字段" },
  { key: "exposure", label: "适用风险暴露类型" },
  { key: "mapping", label: "字段映射" },
  { key: "rules", label: "规则预览" }
];

const docs = ref([]);
const registry = ref(null);
const entryIndex = ref(-1);
const mappingMeta = ref(null);
const mappingDoc = ref(null);
const classDoc = ref(null);
const weightDoc = ref(null);
const tables = ref([]);
const lists = ref([]);
const groupMappings = ref({});
const loading = ref(true);
const error = ref("");
const notice = ref({ text: "", kind: "" });
const saving = ref(false);
const mappingVisited = ref(false);
const infoForm = ref({ codesText: "", mappingVersion: "", targetProfileRef: "", note: "" });
const selectedClasses = ref([]);
const classSearch = ref("");
const showSelectedOnly = ref(false);
const fieldSearch = ref("");
const ALL_FIELD_GROUP = "__all__";
const activeFieldGroup = ref(ALL_FIELD_GROUP);
const fieldNavOpen = ref(true);
const fields = ref([]);
const originalFields = ref([]);
const fieldEditorOpen = ref(false);
const fieldDraft = ref(null);
const editingFieldName = ref("");
const groupEditorOpen = ref(false);
const dictionaryOpen = ref(false);
const groupEdits = ref([]);
const dictionaries = ref([]);
const fieldImportOpen = ref(false);
const fieldImportText = ref("");
const fieldImportPreview = ref([]);
const active = ref("info");

const family = computed(() => String(route.params.family || ""));
const jurisdiction = computed(() => session.jurisdiction || "");
const version = computed(() => scopeVersion.value);
const moduleKey = computed(() => {
  const key = String(route.params.module || "info");
  return MODULES.some((item) => item.key === key) ? key : "info";
});

const entry = computed(() => {
  if (!registry.value || entryIndex.value < 0) return null;
  return (registry.value.body.product_mappings || [])[entryIndex.value] || null;
});
const meta = computed(() => familyMeta(entry.value ? entry.value.product_family : family.value));
const mappingBody = computed(() => (mappingDoc.value ? mappingDoc.value.body : {}));
const statusKey = computed(() => productStatus(mappingBody.value));
const status = computed(() => STATUS_META[statusKey.value] || STATUS_META.draft);
const targets = computed(() => mappingTargetSet(mappingBody.value));
const classRules = computed(() => matchedRules(classDoc.value, targets.value));
const weightRules = computed(() => matchedRules(weightDoc.value, targets.value));
const ruleSets = computed(() => (registry.value && registry.value.body && registry.value.body.default_rule_sets) || {});
const businessGroups = computed(() => {
  const profiles = (entry.value && entry.value.product_profiles) || {};
  return Object.entries(profiles).map(([code, profile]) => {
    const mapping = groupMappings.value[code] || {};
    return {
      code,
      candidateExposureClasses: (profile && profile.candidate_exposure_classes) || [],
      members: String((profile && profile.note) || "").split(",").map((item) => item.trim()).filter(Boolean),
      mappingRef: mapping.mappingRef || "",
      coveragePct: mapping.coveragePct,
      coveredTargets: mapping.coveredTargets,
      requiredTargets: mapping.requiredTargets,
      missingTargets: mapping.missingTargets || []
    };
  });
});

const exposureModel = computed(() => buildExposureModel(classDoc.value, weightDoc.value, tables.value, lists.value));
const candidateSet = computed(() => new Set(selectedClasses.value));
const selectedMatrix = computed(() => exposureModel.value.matrix.filter((row) => candidateSet.value.has(row.code)));
const scopedNodeCounts = computed(() => {
  const clsIds = new Set();
  const weightIds = new Set();
  selectedMatrix.value.forEach((row) => {
    row.clsIds.forEach((id) => clsIds.add(id));
    row.weightIds.forEach((id) => weightIds.add(id));
  });
  return { cls: clsIds.size, rw: weightIds.size };
});
const targetFieldDefs = computed(() => {
  const map = {};
  [classDoc.value, weightDoc.value].forEach((doc) => {
    ((doc && doc.fields) || []).forEach((field) => {
      if (field && field.name && !map[field.name]) map[field.name] = field;
    });
  });
  return map;
});
function nodeFieldNames(row) {
  const set = new Set();
  [...row.clsIds, ...row.weightIds].forEach((id) => {
    const node = exposureModel.value.nodes[id];
    (node && node.fields || []).forEach((name) => { if (name) set.add(name); });
  });
  set.delete("exposure_class");
  return [...set].filter((name) => {
    const def = targetFieldDefs.value[name];
    return !def || def.source !== "calc";
  });
}
const candidateRows = computed(() => exposureModel.value.matrix.map((row) => {
  const names = nodeFieldNames(row);
  const required = names.filter((name) => {
    const def = targetFieldDefs.value[name];
    return def && def.required === true && (def.source || "column") === "column";
  });
  return {
    code: row.code,
    label: row.label,
    lane: row.lane,
    clsCount: row.clsIds.length,
    rwCount: row.weightIds.length,
    fieldCount: names.length,
    requiredCount: required.length,
    selected: candidateSet.value.has(row.code)
  };
}));
const filteredCandidates = computed(() => {
  const text = classSearch.value.trim().toLowerCase();
  return candidateRows.value.filter((item) => {
    if (showSelectedOnly.value && !item.selected) return false;
    if (!text) return true;
    return (item.code + " " + item.label + " " + item.lane).toLowerCase().includes(text);
  });
});
const scopeClassLabels = computed(() => Object.fromEntries(candidateRows.value.map((item) => [item.code, item.label])));
const scopedFieldNames = computed(() => {
  const set = new Set();
  selectedMatrix.value.forEach((row) => nodeFieldNames(row).forEach((name) => set.add(name)));
  Object.values(targetFieldDefs.value).forEach((def) => {
    if (def && def.name && def.required === true && (def.source || "column") === "column" && def.name !== "exposure_class") {
      set.add(def.name);
    }
  });
  return [...set];
});
const savedExposureClasses = computed(() => {
  const own = entry.value && Array.isArray(entry.value.candidate_exposure_classes)
    ? entry.value.candidate_exposure_classes
    : [];
  const fallback = (mappingBody.value && mappingBody.value.candidate_exposure_classes) || [];
  return (own.length ? own : fallback).slice().sort();
});
const exposureDirty = computed(() => JSON.stringify(selectedClasses.value.slice().sort()) !== JSON.stringify(savedExposureClasses.value));
const exposureChecks = computed(() => {
  const selected = candidateRows.value.filter((item) => item.selected);
  return [
    { label: "已选择至少一个适用风险暴露类型", ok: selected.length > 0 },
    { label: "每个暴露类型存在分类规则", ok: selected.length > 0 && selected.every((item) => item.clsCount > 0) },
    { label: "每个暴露类型关联权重规则", ok: selected.length > 0 && selected.every((item) => item.rwCount > 0) }
  ];
});
const failedExposureChecks = computed(() => exposureChecks.value.filter((item) => !item.ok).length);
const scopedRequiredFieldNames = computed(() => scopedFieldNames.value.filter((name) => {
  const def = targetFieldDefs.value[name];
  return def && def.required === true && (def.source || "column") === "column";
}));
const scopedMappingCoverage = computed(() => {
  if (!selectedClasses.value.length || !scopedFieldNames.value.length) return mappingCoverage.value;
  const mapped = mappingTargetSet(mappingBody.value);
  const required = scopedRequiredFieldNames.value;
  const targets = required.length ? required : scopedFieldNames.value;
  const hit = targets.filter((name) => mapped.has(name)).length;
  return {
    mapped: hit,
    required: targets.length,
    pct: targets.length ? Math.round(hit / targets.length * 100) : 0,
    targetFields: scopedFieldNames.value.length,
    missing: targets.filter((name) => !mapped.has(name)),
    missingCount: targets.filter((name) => !mapped.has(name)).length
  };
});
const scopeStats = computed(() => ({
  types: selectedClasses.value.length,
  cls: scopedNodeCounts.value.cls,
  rw: scopedNodeCounts.value.rw,
  fields: scopedFieldNames.value.length,
  required: scopedRequiredFieldNames.value.length
}));
function toggleAllCandidates() {
  selectedClasses.value = candidateRows.value.map((item) => item.code);
}
function clearCandidates() {
  selectedClasses.value = [];
}

const mappingCoverage = computed(() => {
  const coverage = mappingBody.value.coverage || {};
  const mapped = Number(coverage.mapped_required || 0);
  const missing = (coverage.missing_required || []).length;
  const targetFields = Number(coverage.target_fields || 0);
  const required = mapped + missing || targetFields;
  return {
    mapped: mapped,
    required: required,
    targetFields: targetFields,
    pct: required ? Math.round(mapped / required * 100) : 0,
    missing: missing,
    missingCount: missing
  };
});

const activeFields = computed(() => fields.value.filter((field) => !field.deleted));
const missingEnglishCount = computed(() => activeFields.value.filter((field) => !(field.labelEn || field.label_en)).length);
const docGroupMeta = computed(() => {
  const map = {};
  [classDoc.value, weightDoc.value].forEach((doc) => {
    ((doc && doc.field_groups) || []).forEach((group, index) => {
      if (!group || !group.group_id || map[group.group_id]) return;
      map[group.group_id] = {
        label: group.label || group.group_id,
        labelEn: group.label_en || "",
        level: group.level || "",
        description: group.description || "",
        order: typeof group.order === "number" ? group.order : index
      };
    });
  });
  return map;
});
function asciiOnly(value) {
  return !!value && !/[^\x00-\x7F]/.test(String(value));
}
function readableGroup(code) {
  return String(code || "").split("_").map((word) => word ? word.charAt(0) + word.slice(1).toLowerCase() : "").join(" ").trim();
}
const standardGroups = computed(() => {
  const map = new Map();
  const source = groupEdits.value.length
    ? groupEdits.value.map((group) => ({ ...group, group_id: group.id }))
    : ((entry.value && entry.value.standard_field_groups) || []);
  source.forEach((group, index) => {
    const id = group.id || group.group_id;
    if (!id) return;
    const meta = docGroupMeta.value[id] || {};
    const rawLabel = group.label || "";
    const label = (!rawLabel || asciiOnly(rawLabel)) ? (meta.label || rawLabel || id) : rawLabel;
    map.set(id, {
      id,
      label,
      labelEn: group.labelEn || group.label_en || (asciiOnly(rawLabel) && rawLabel !== id ? rawLabel : "") || meta.labelEn || readableGroup(id),
      level: group.level || meta.level || "FACILITY",
      description: group.description || meta.description || "",
      order: typeof group.order === "number" ? group.order : (meta.order == null ? index : meta.order)
    });
  });
  fields.value.forEach((field) => {
    if (!field.group || map.has(field.group)) return;
    const meta = docGroupMeta.value[field.group] || {};
    map.set(field.group, {
      id: field.group,
      label: meta.label || field.group,
      labelEn: meta.labelEn || readableGroup(field.group),
      level: meta.level || "FACILITY",
      description: meta.description || "",
      order: meta.order == null ? 999 : meta.order
    });
  });
  return Array.from(map.values()).sort((left, right) => (left.order == null ? 999 : left.order) - (right.order == null ? 999 : right.order));
});
const fieldQuery = computed(() => fieldSearch.value.trim().toLowerCase());
function dictionaryName(code) {
  const dict = dictionaries.value.find((item) => item.dict_code === code);
  return dict ? dict.dict_name : "";
}
function groupLabelOf(code) {
  const group = standardGroups.value.find((item) => item.id === code);
  return group ? group.label : code;
}
function fieldMatches(field) {
  if (!fieldQuery.value) return true;
  return (field.name + " " + field.label + " " + (field.labelEn || field.label_en || "") + " " + (field.description || "") + " " + dictionaryName(field.dictionary)).toLowerCase().includes(fieldQuery.value);
}
const matchedFields = computed(() => activeFields.value.filter((field) => fieldMatches(field)));
const groupOrder = computed(() => new Map(standardGroups.value.map((group, index) => [group.id, index])));
const groupEditorGroups = computed(() => standardGroups.value.map((group) => ({
  ...group,
  total: activeFields.value.filter((field) => field.group === group.id).length
})));
const fieldGroupNav = computed(() => ([
  {
    id: ALL_FIELD_GROUP,
    label: "全部字段",
    code: "ALL",
    total: activeFields.value.length,
    matched: matchedFields.value.length
  },
  ...standardGroups.value.map((group) => ({
    id: group.id,
    label: group.label,
    code: group.id,
    total: activeFields.value.filter((field) => field.group === group.id).length,
    matched: matchedFields.value.filter((field) => field.group === group.id).length
  }))
]));
const activeFieldGroupId = computed(() => (
  fieldGroupNav.value.some((group) => group.id === activeFieldGroup.value) ? activeFieldGroup.value : ALL_FIELD_GROUP
));
const selectedFieldGroup = computed(() => fieldGroupNav.value.find((group) => group.id === activeFieldGroupId.value) || fieldGroupNav.value[0]);
const showFieldGroupColumn = computed(() => activeFieldGroupId.value === ALL_FIELD_GROUP);
const visibleFields = computed(() => {
  const list = activeFieldGroupId.value === ALL_FIELD_GROUP
    ? matchedFields.value
    : matchedFields.value.filter((field) => field.group === activeFieldGroupId.value);
  if (activeFieldGroupId.value !== ALL_FIELD_GROUP) return list;
  return list.slice().sort((left, right) => {
    const a = groupOrder.value.get(left.group);
    const b = groupOrder.value.get(right.group);
    return (a == null ? 999 : a) - (b == null ? 999 : b);
  });
});
function selectFieldGroup(id) {
  activeFieldGroup.value = id;
}
function resetFieldGroupSelection() {
  const first = standardGroups.value.find((group) => activeFields.value.some((field) => field.group === group.id));
  activeFieldGroup.value = first ? first.id : ALL_FIELD_GROUP;
}
function openFieldCreate() {
  editingFieldName.value = "";
  fieldDraft.value = {
    name: "",
    label: "",
    label_en: "",
    type: "string",
    group: activeFieldGroupId.value === ALL_FIELD_GROUP ? "" : activeFieldGroupId.value,
    required: false,
    status: "ACTIVE",
    description: "",
    dictionary: "",
    enum_values: []
  };
  fieldEditorOpen.value = true;
}
function openFieldEdit(field) {
  editingFieldName.value = field.name;
  fieldDraft.value = JSON.parse(JSON.stringify(field));
  fieldEditorOpen.value = true;
}
function copyField(field) {
  editingFieldName.value = "";
  const copy = JSON.parse(JSON.stringify(field));
  copy.name = field.name + "_COPY";
  copy.label = field.label + "（副本）";
  copy.label_en = field.labelEn || field.label_en || "";
  copy.required = false;
  fieldDraft.value = copy;
  fieldEditorOpen.value = true;
}
function handleFieldSave(field) {
  const normalized = { ...field, labelEn: field.label_en, label_en: field.label_en };
  if (editingFieldName.value) {
    fields.value = fields.value.map((item) => item.name === editingFieldName.value ? { ...item, ...normalized, count: item.count || 0 } : item);
  } else {
    fields.value.push({ ...normalized, count: 0 });
  }
  fieldEditorOpen.value = false;
  fieldDraft.value = null;
  editingFieldName.value = "";
  activeFieldGroup.value = field.group;
  say("字段已修改，点「保存并同步映射」写入产品注册", "info");
}
function openGroupEditor() {
  groupEditorOpen.value = true;
}
function handleGroupSave(groups) {
  groupEdits.value = groups.map((group) => ({ ...group }));
  groupEditorOpen.value = false;
  if (!groups.some((group) => group.id === activeFieldGroup.value)) activeFieldGroup.value = ALL_FIELD_GROUP;
  say("字段分组已修改，点「保存并同步映射」写入产品注册", "info");
}
function openDictionaries() {
  dictionaryOpen.value = true;
}
function handleDictionariesSaved(doc) {
  registry.value = doc;
  dictionaries.value = (doc.body && doc.body.dictionaries) || [];
  say("码值字典已保存", "ok");
}
watch(fieldSearch, (value, previous) => {
  const now = String(value || "").trim();
  const before = String(previous || "").trim();
  if (now && !before) {
    activeFieldGroup.value = ALL_FIELD_GROUP;
  } else if (!now && before && activeFieldGroup.value === ALL_FIELD_GROUP) {
    resetFieldGroupSelection();
  }
});



const configChecks = computed(() => ([
  { label: "产品组信息完整", ok: !!(entry.value && entry.value.data_mapping_ref) && (entry.value.product_codes || []).length > 0 },
  { label: "产品标准字段有效", ok: activeFields.value.length > 0 },
  { label: "必需业务输入字段已全部映射", ok: scopedMappingCoverage.value.missingCount === 0 && scopedMappingCoverage.value.mapped > 0 },
  { label: "映射转换逻辑有效", ok: (mappingBody.value.mappings || []).every((item) => item.transform) }
]));
const failedChecks = computed(() => configChecks.value.filter((item) => !item.ok).length);
const ruleOverview = computed(() => ([
  { label: "产品", value: meta.value.name, sub: entry.value ? entry.value.product_family : "" },
  { label: "暴露类型", value: String(selectedClasses.value.length), sub: "已选择" },
  { label: "分类规则", value: String(scopedNodeCounts.value.cls), sub: "节点" },
  { label: "权重规则", value: String(scopedNodeCounts.value.rw), sub: "节点" },
  { label: "字段完整性", value: scopedMappingCoverage.value.mapped + " / " + scopedMappingCoverage.value.required, sub: scopedMappingCoverage.value.pct + "%" }
]));

function say(text, kind = "info") {
  notice.value = { text: text, kind: kind };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function definitionToField(definition, item) {
  const name = definition.name || (item && item.source_field) || "";
  const label = definition.label || (item && item.description) || name;
  return {
    name,
    label,
    labelEn: definition.label_en || definition.labelEn || "",
    label_en: definition.label_en || definition.labelEn || "",
    type: definition.type || (item && item.source_type) || "string",
    group: definition.group || (item && item.target_group) || "OTHER",
    required: definition.required !== undefined ? !!definition.required : !!(item && item.required !== false),
    status: definition.status || "ACTIVE",
    unit: definition.unit || (item && item.unit) || "",
    precision: definition.precision == null ? null : definition.precision,
    scale: definition.scale == null ? null : definition.scale,
    format: definition.format || "",
    default_value: definition.default_value || "",
    description: definition.description || (item && item.description) || label,
    description_en: definition.description_en || "",
    dictionary: definition.dictionary || "",
    enum_values: Array.isArray(definition.enum_values) ? definition.enum_values : [],
    source_hint: definition.source_hint || name,
    aliases: Array.isArray(definition.aliases) ? definition.aliases : [],
    count: 0
  };
}

function syncFieldsFromMapping() {
  const definitions = {};
  ((entry.value && entry.value.standard_fields) || []).forEach((field) => {
    if (field && field.name && !definitions[field.name]) definitions[field.name] = field;
  });
  const mapping = {};
  (mappingBody.value.mappings || []).forEach((item) => {
    if (!item || !item.source_field) return;
    if (!mapping[item.source_field]) {
      mapping[item.source_field] = definitionToField(definitions[item.source_field] || {}, item);
    }
    mapping[item.source_field].count += 1;
  });
  Object.keys(definitions).forEach((name) => {
    if (!mapping[name]) mapping[name] = definitionToField(definitions[name], null);
  });
  fields.value = Object.values(mapping);
  originalFields.value = fields.value.map((field) => field.name);
}

function syncInfoFromEntry() {
  if (!entry.value) return;
  infoForm.value = {
    codesText: (entry.value.product_codes || []).join("\n"),
    mappingVersion: entry.value.data_mapping_version || "",
    targetProfileRef: entry.value.target_profile_ref || "",
    note: entry.value.note || ""
  };
  selectedClasses.value = (entry.value.candidate_exposure_classes || (mappingBody.value.candidate_exposure_classes || [])).slice();
}

async function load() {
  loading.value = true;
  error.value = "";
  try {
    if (!session.ready) await loadBootstrap();
    const queryJurisdiction = String(route.query.jurisdiction || "");
    const queryVersion = String(route.query.version || "");
    if (queryJurisdiction && queryVersion) {
      const target = (session.versions || []).find((item) => item.jurisdiction === queryJurisdiction && item.version === queryVersion);
      if (target) {
        session.jurisdiction = queryJurisdiction;
        session.versionId = target.id;
      }
    }
    const rows = await fetchRuleDocuments({ jurisdiction: jurisdiction.value, version: version.value });
    docs.value = rows;
    const registryMeta = rows.find((item) => item.kind === "product_registry");
    if (!registryMeta) throw new Error("这一版还没有产品规则注册");
    registry.value = await fetchRuleDocument(registryMeta.id);
    dictionaries.value = (registry.value.body.dictionaries || []).slice();
    groupEdits.value = [];
    const entries = (registry.value.body.product_mappings || []).map((item, index) => ({ item: item, index: index }));
    const candidates = entries.filter((item) => item.item.product_family === family.value);
    if (!candidates.length) throw new Error("没有找到产品 " + family.value);
    const requested = Number(route.query.entry);
    const picked = candidates.find((item) => item.index === requested) || candidates[0];
    entryIndex.value = picked.index;
    syncInfoFromEntry();

    const mappingMetaRow = rows.find((item) => item.kind === "data_mapping" && item.name === picked.item.data_mapping_ref);
    mappingMeta.value = mappingMetaRow || null;
    mappingDoc.value = mappingMetaRow ? await fetchRuleDocument(mappingMetaRow.id) : null;
    syncInfoFromEntry();
    syncFieldsFromMapping();
    resetFieldGroupSelection();

    const classMeta = rows.find((item) => item.kind === "exposure_classification");
    const weightMeta = rows.find((item) => item.kind === "risk_weight");
    const [classResult, weightResult, tableRows, listRows, groupMapResult] = await Promise.all([
      classMeta ? fetchRuleDocument(classMeta.id) : Promise.resolve(null),
      weightMeta ? fetchRuleDocument(weightMeta.id) : Promise.resolve(null),
      fetchParameterTables(jurisdiction.value, version.value),
      fetchReferenceLists(jurisdiction.value, version.value),
      fetchProductGroupMappings(version.value)
    ]);
    classDoc.value = classResult ? classResult.body : null;
    weightDoc.value = weightResult ? weightResult.body : null;
    tables.value = tableRows || [];
    lists.value = listRows || [];
    groupMappings.value = Object.fromEntries(((groupMapResult && groupMapResult.groups) || []).map((item) => [item.groupCode, item]));
    active.value = moduleKey.value;
  } catch (err) {
    error.value = err.message || "加载产品配置失败";
  } finally {
    loading.value = false;
  }
}

async function switchModule(key) {
  if (!MODULES.some((item) => item.key === key)) return;
  if (key !== active.value && active.value === "exposure" && exposureDirty.value) {
    const yes = await askConfirm("适用风险暴露类型还有未保存的修改，离开后这些修改会丢失。", {
      title: "离开适用风险暴露类型",
      confirmText: "离开",
      cancelText: "继续编辑"
    });
    if (!yes) return;
    selectedClasses.value = savedExposureClasses.value.slice();
  }
  active.value = key;
  if (key === "mapping") mappingVisited.value = true;
  router.replace({
    name: "product-workbench",
    params: { family: family.value, module: key },
    query: {
      entry: String(entryIndex.value),
      jurisdiction: jurisdiction.value,
      version: version.value
    }
  });
}

async function backToList() {
  if (active.value === "exposure" && exposureDirty.value) {
    const yes = await askConfirm("适用风险暴露类型还有未保存的修改，离开后这些修改会丢失。", {
      title: "离开产品配置工作台",
      confirmText: "离开",
      cancelText: "继续编辑"
    });
    if (!yes) return;
  }
  router.push("/product-config");
}

async function saveExposureScope() {
  if (!registry.value || entryIndex.value < 0) return;
  if (!selectedClasses.value.length) {
    say("至少选择一个适用风险暴露类型", "warn");
    return;
  }
  if (!exposureDirty.value) {
    say("适用风险暴露类型没有变化", "info");
    return;
  }
  const outOfScope = (mappingBody.value.mappings || []).filter((item) => (
    item && item.target_field && !scopedFieldNames.value.includes(item.target_field)
  )).length;
  saving.value = true;
  try {
    const body = clone(registry.value.body);
    body.product_mappings[entryIndex.value] = Object.assign({}, body.product_mappings[entryIndex.value], {
      candidate_exposure_classes: selectedClasses.value.slice()
    });
    const saved = await saveRuleDocument(registry.value.id, { body: body, baseRevision: registry.value.revision });
    registry.value = saved;
    syncInfoFromEntry();
    say(
      outOfScope
        ? "适用风险暴露类型已保存；有 " + outOfScope + " 条已有映射不在新范围内，字段映射中会折叠提示"
        : "适用风险暴露类型已保存",
      "ok"
    );
  } catch (err) {
    say(err.message, "danger");
  } finally {
    saving.value = false;
  }
}

async function saveInfo() {
  if (!registry.value || entryIndex.value < 0) return;
  const codes = infoForm.value.codesText.split(/\n|,|，/).map((item) => item.trim()).filter(Boolean);
  if (!codes.length) {
    say("至少需要一个适用产品代码", "warn");
    return;
  }
  const duplicated = [];
  (registry.value.body.product_mappings || []).forEach((item, index) => {
    if (index === entryIndex.value) return;
    (item.product_codes || []).forEach((code) => { if (codes.includes(code)) duplicated.push(code); });
  });
  if (duplicated.length) {
    say("产品代码已被其它产品组占用：" + duplicated.join("、"), "danger");
    return;
  }
  saving.value = true;
  try {
    const body = clone(registry.value.body);
    const current = body.product_mappings[entryIndex.value];
    const next = Object.assign({}, current, { product_codes: codes });
    if (infoForm.value.mappingVersion) next.data_mapping_version = infoForm.value.mappingVersion;
    else delete next.data_mapping_version;
    if (infoForm.value.targetProfileRef) next.target_profile_ref = infoForm.value.targetProfileRef;
    else delete next.target_profile_ref;
    if (infoForm.value.note) next.note = infoForm.value.note;
    else delete next.note;
    body.product_mappings[entryIndex.value] = next;
    const saved = await saveRuleDocument(registry.value.id, { body: body, baseRevision: registry.value.revision });
    registry.value = saved;
    say("产品组信息已保存", "ok");
  } catch (err) {
    say(err.message, "danger");
  } finally {
    saving.value = false;
  }
}

function toggleCandidate(code) {
  selectedClasses.value = selectedClasses.value.includes(code)
    ? selectedClasses.value.filter((item) => item !== code)
    : selectedClasses.value.concat(code);
}

async function removeField(name) {
  const yes = await askConfirm("删除标准字段「" + name + "」后，保存时会同时删除它已有的映射关系。", {
    title: "删除标准字段",
    confirmText: "删除",
    danger: true
  });
  if (!yes) return;
  fields.value = fields.value.filter((field) => field.name !== name);
}

function activeDictionaryItems(code) {
  const dict = dictionaries.value.find((item) => item.dict_code === code);
  return dict ? (dict.items || []).filter((item) => item.status !== "DISABLED") : [];
}

function validateFieldList() {
  const problems = [];
  const seen = new Set();
  const groupIds = new Set(standardGroups.value.map((group) => group.id));
  fields.value.forEach((field) => {
    if (!field.name || !/^[A-Za-z][A-Za-z0-9_]*$/.test(field.name)) problems.push("字段编码不合法：" + (field.name || "（空）"));
    if (seen.has(field.name)) problems.push("字段编码重复：" + field.name);
    seen.add(field.name);
    if (!String(field.label || "").trim()) problems.push(field.name + "：中文名称不能为空");
    if (!originalFields.value.includes(field.name) && !String(field.labelEn || field.label_en || "").trim()) problems.push(field.name + "：新增字段必须填写英文名称");
    if (!field.group || !groupIds.has(field.group)) problems.push(field.name + "：所属分组不存在");
    if (field.type === "enum" && !field.dictionary && !(field.enum_values || []).length) problems.push(field.name + "：enum 字段必须配置字典或临时枚举值");
    if (field.dictionary && !activeDictionaryItems(field.dictionary).length) problems.push(field.name + "：字典 " + field.dictionary + " 没有可用码值");
  });
  return problems;
}

function fieldPayload(field) {
  return {
    name: field.name,
    label: field.label || field.name,
    label_en: String(field.labelEn || field.label_en || "").trim(),
    type: field.type || "string",
    group: field.group || "OTHER",
    required: !!field.required,
    status: field.status || "ACTIVE",
    unit: field.unit || "",
    precision: field.precision == null || field.precision === "" ? null : Number(field.precision),
    scale: field.scale == null || field.scale === "" ? null : Number(field.scale),
    format: field.format || "",
    default_value: field.default_value || "",
    description: field.description || field.label || field.name,
    description_en: field.description_en || "",
    dictionary: field.dictionary || "",
    enum_values: Array.isArray(field.enum_values) ? field.enum_values : [],
    source_hint: field.source_hint || field.name,
    aliases: Array.isArray(field.aliases) ? field.aliases : []
  };
}

async function saveFields() {
  if (!mappingMeta.value) {
    say("这个产品组还没有字段映射文档，先在字段映射里建立映射。", "warn");
    return;
  }
  if (!fields.value.length) {
    say("至少保留一个标准字段", "warn");
    return;
  }
  const problems = validateFieldList();
  if (problems.length) {
    say("字段校验没有通过：" + problems.slice(0, 4).join("；"), "danger");
    return;
  }
  const removed = originalFields.value.filter((name) => !fields.value.some((field) => field.name === name));
  if (removed.length) {
    const yes = await askConfirm("保存字段会删除 " + removed.length + " 个已移除字段的映射关系。", {
      title: "保存标准字段",
      confirmText: "保存",
      danger: true
    });
    if (!yes) return;
  }
  saving.value = true;
  try {
    const definitions = {};
    fields.value.forEach((field) => { definitions[field.name] = field; });
    const body = clone(mappingBody.value);
    body.mappings = (body.mappings || [])
      .filter((item) => !removed.includes(item.source_field))
      .map((item) => {
        const definition = definitions[item.source_field];
        if (!definition) return item;
        const next = Object.assign({}, item, {
          source_type: definition.type,
          description: definition.label
        });
        if (definition.unit) next.unit = definition.unit;
        else delete next.unit;
        return next;
      });
    const savedMapping = await saveRuleDocument(mappingMeta.value.id, { body: body, baseRevision: mappingMeta.value.revision });

    const registryBody = clone(registry.value.body);
    const registryEntry = registryBody.product_mappings[entryIndex.value];
    registryBody.field_schema_version = 2;
    registryBody.dictionaries = clone(dictionaries.value || []);
    registryBody.product_mappings[entryIndex.value] = Object.assign({}, registryEntry, {
      standard_fields: fields.value.map(fieldPayload),
      standard_field_groups: standardGroups.value.map((group) => ({
        group_id: group.id,
        label: group.label || group.id,
        label_en: group.labelEn || readableGroup(group.id),
        description: group.description || "",
        order: typeof group.order === "number" ? group.order : 999,
        field_count: fields.value.filter((field) => field.group === group.id).length
      }))
    });
    const savedRegistry = await saveRuleDocument(registry.value.id, { body: registryBody, baseRevision: registry.value.revision });
    registry.value = savedRegistry;
    dictionaries.value = (savedRegistry.body && savedRegistry.body.dictionaries) || [];
    groupEdits.value = [];
    mappingDoc.value = savedMapping;
    syncFieldsFromMapping();
    if (!fieldGroupNav.value.some((group) => group.id === activeFieldGroup.value)) resetFieldGroupSelection();
    say("标准字段已保存，并同步映射字段类型", "ok");
  } catch (err) {
    say(err.message, "danger");
  } finally {
    saving.value = false;
  }
}

function openFieldImport() {
  fieldImportOpen.value = true;
  fieldImportText.value = "";
}

function parseEnumText(value) {
  return String(value || "").split(/[;；|]+/).map((item) => item.trim()).filter(Boolean).map((item) => {
    const index = item.indexOf("=");
    if (index < 0) return { code: item, label: item };
    return { code: item.slice(0, index).trim(), label: item.slice(index + 1).trim() };
  }).filter((item) => item.code);
}

function applyFieldImport() {
  fieldImportPreview.value = [];
  const rows = fieldImportText.value.split(/\n+/).map((line) => line.split(/[,\t]/).map((item) => item.trim())).filter((parts) => parts.length >= 1 && parts[0]);
  if (!rows.length) {
    say("没有可导入的行", "warn");
    return;
  }
  const groupIds = new Set(standardGroups.value.map((group) => group.id));
  const namesInFile = new Set();
  rows.forEach((parts, index) => {
    const [name, label, labelEn, type, group, required, unit, precision, scale, format, dictionary, enumText, description, descriptionEn, sourceHint, aliases, status] = parts;
    const field = {
      name,
      label: label || name,
      labelEn: labelEn || "",
      label_en: labelEn || "",
      type: type || "string",
      group: group || "",
      required: ["true", "1", "是"].includes(String(required || "").toLowerCase()),
      status: status === "DISABLED" ? "DISABLED" : "ACTIVE",
      unit: unit || "",
      precision: precision ? Number(precision) : null,
      scale: scale ? Number(scale) : null,
      format: format || "",
      default_value: "",
      description: description || label || name,
      description_en: descriptionEn || "",
      dictionary: dictionary || "",
      enum_values: parseEnumText(enumText),
      source_hint: sourceHint || name,
      aliases: String(aliases || "").split(/[;；]+/).map((item) => item.trim()).filter(Boolean),
      count: 0
    };
    const errors = [];
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) errors.push("字段编码不合法");
    if (namesInFile.has(name)) errors.push("本次导入中字段编码重复");
    namesInFile.add(name);
    if (!field.label.trim()) errors.push("中文名称不能为空");
    if (!field.labelEn.trim()) errors.push("英文名称不能为空");
    if (!field.group) errors.push("分组编码不能为空");
    else if (!groupIds.has(field.group)) errors.push("分组 " + field.group + " 不存在");
    if (!["string", "number", "boolean", "date", "enum", "derived", "constant"].includes(field.type)) errors.push("数据类型不合法");
    if (field.precision != null && (!Number.isInteger(field.precision) || field.precision < 0)) errors.push("精度必须是非负整数");
    if (field.scale != null && (!Number.isInteger(field.scale) || field.scale < 0)) errors.push("小数位必须是非负整数");
    if (field.dictionary && !activeDictionaryItems(field.dictionary).length) errors.push("字典 " + field.dictionary + " 不存在或没有可用码值");
    if (field.type === "enum" && !field.dictionary && !field.enum_values.length) errors.push("enum 字段必须配置字典或临时枚举值");
    fieldImportPreview.value.push({ line: index + 1, field, errors });
  });
}

function confirmFieldImport() {
  const valid = fieldImportPreview.value.filter((row) => !row.errors.length);
  if (!valid.length) return;
  valid.forEach((row) => {
    const existing = fields.value.find((field) => field.name === row.field.name);
    if (existing) Object.assign(existing, row.field);
    else fields.value.push({ ...row.field });
  });
  fieldImportOpen.value = false;
  fieldImportText.value = "";
  fieldImportPreview.value = [];
  say("已导入 " + valid.length + " 个字段，保存后写入产品注册", "ok");
}

function downloadJson(name, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function exportFields() {
  downloadJson("STC_FIELDS_" + (entry.value ? entry.value.product_family : "PRODUCT") + ".json", {
    product_family: entry.value ? entry.value.product_family : "",
    mapping: entry.value ? entry.value.data_mapping_ref : "",
    mapping_version: entry.value ? entry.value.data_mapping_version || "" : "",
    field_schema_version: 2,
    fields: activeFields.value.map(fieldPayload),
    groups: standardGroups.value.map((group) => ({
      group_id: group.id,
      label: group.label,
      label_en: group.labelEn,
      description: group.description,
      order: group.order
    })),
    dictionaries: clone(dictionaries.value || [])
  });
}

function exportProductRules() {
  downloadJson("STC_PRODUCT_RULES_" + (entry.value ? entry.value.product_family : "PRODUCT") + ".json", {
    product_family: entry.value ? entry.value.product_family : "",
    candidate_exposure_classes: selectedClasses.value.slice(),
    classification_rule_ref: ruleSets.value.classification_rule_ref || "",
    classification_rule_version: ruleSets.value.classification_rule_version || "",
    risk_weight_rule_ref: ruleSets.value.risk_weight_rule_ref || "",
    risk_weight_rule_version: ruleSets.value.risk_weight_rule_version || "",
    classification_rules: classRules.value.map((rule) => rule.id),
    risk_weight_rules: weightRules.value.map((rule) => rule.id)
  });
}

async function saveMapping(body) {
  if (!mappingMeta.value) return;
  saving.value = true;
  try {
    const saved = await saveRuleDocument(mappingMeta.value.id, { body: body, baseRevision: mappingMeta.value.revision });
    mappingDoc.value = saved;
    syncFieldsFromMapping();
    say("字段映射已保存", "ok");
  } catch (err) {
    say(err.message, "danger");
  } finally {
    saving.value = false;
  }
}

function openExposureConfig() {
  router.push("/exposure-config");
}

watch(
  () => route.params.module,
  () => {
    active.value = moduleKey.value;
    if (moduleKey.value === "mapping") mappingVisited.value = true;
  }
);

onMounted(async () => {
  await nextTick();
  await load();
  if (moduleKey.value === "mapping") mappingVisited.value = true;
});
</script>

<template>
  <div class="pws-shell">
    <div class="pws-top">
      <button type="button" class="btn sm" @click="backToList">← 返回产品管理</button>
      <span class="spacer"></span>
      <span class="dim" style="font-size: 12px">{{ jurisdiction }} · {{ version }}</span>
    </div>

    <div v-if="loading" class="loading"><span class="spin"></span>正在读取产品配置</div>
    <div v-else-if="error" class="notice danger">{{ error }}</div>

    <template v-else-if="entry">
      <div class="pws-prodhead">
        <div class="pws-head-main">
          <div class="pws-head-title">
            <h1>{{ meta.name }}</h1>
            <span class="pws-tag blue">{{ entry.product_family }}</span>
            <span class="pr-status" :class="statusKey">{{ status.label }}</span>
          </div>
          <div class="pws-subline">
            <span class="mono">{{ entry.data_mapping_ref }} v{{ entry.data_mapping_version || mappingBody.version || "—" }}</span>
            <span v-if="mappingBody.source_system">{{ mappingBody.source_system }}</span>
            <span>映射 {{ scopedMappingCoverage.mapped }} / {{ scopedMappingCoverage.required }} · {{ scopedMappingCoverage.pct }}%</span>
            <span>规则 {{ ruleSets.classification_rule_ref || "—" }} / {{ ruleSets.risk_weight_rule_ref || "—" }}</span>
          </div>
        </div>
      </div>

      <nav class="pws-modtabs">
        <button
          v-for="item in MODULES"
          :key="item.key"
          type="button"
          :class="{ on: moduleKey === item.key }"
          @click="switchModule(item.key)"
        >{{ item.label }}</button>
        <span class="spacer"></span>
        <button type="button" class="btn sm" @click="openExposureConfig">在敞口划分查看规则</button>
      </nav>

      <p v-if="notice.text" class="notice" :class="notice.kind">{{ notice.text }}</p>

      <section v-show="moduleKey === 'info'" class="pws-module">
        <div class="panel">
          <div class="panel-head">
            <h3>产品组信息</h3>
            <span class="spacer"></span>
            <span class="dim" style="font-size: 11.5px">保存写入产品规则注册</span>
            <button type="button" class="btn sm primary" :disabled="saving" @click="saveInfo">{{ saving ? "保存中" : "保存产品组信息" }}</button>
          </div>
          <div class="panel-body">
            <div class="pws-formgrid">
              <label>产品族<input :value="entry.product_family" type="text" disabled /></label>
              <label>映射配置<input :value="entry.data_mapping_ref" type="text" disabled /></label>
              <label>映射版本<input v-model="infoForm.mappingVersion" type="text" /></label>
              <label>目标画像引用<input v-model="infoForm.targetProfileRef" type="text" placeholder="例如 LOAN" /></label>
              <label>适用产品代码数<input :value="(entry.product_codes || []).length" type="text" disabled /></label>
              <label class="wide">备注<textarea v-model="infoForm.note" rows="2"></textarea></label>
              <label class="wide">适用产品代码（每行一个）<textarea v-model="infoForm.codesText" rows="3"></textarea></label>

              <div v-if="businessGroups.length" class="wide pws-groups">
                <div class="pws-group-head">
                  <b>业务产品组</b>
                  <span class="mini">标准字段和字段映射继承产品族；覆盖情况按业务产品组统计</span>
                </div>
                <div class="pws-group-grid">
                  <div v-for="group in businessGroups" :key="group.code" class="pws-group-card">
                    <div class="pws-group-title"><span class="mono">{{ group.code }}</span></div>
                    <div class="pws-group-members" :title="group.members.join('、')">
                      成员产品代码 {{ group.members.length }} 个 · 映射 {{ group.mappingRef || "—" }}
                    </div>
                    <div class="pws-group-coverage" :class="{ warn: group.coveragePct != null && group.coveragePct < 100 }">
                      {{ group.coveragePct == null ? "映射覆盖待计算" : "规则输入映射 " + group.coveredTargets + " / " + group.requiredTargets + "（" + group.coveragePct + "%）" }}
                    </div>
                  </div>
                </div>
              </div>

              <div class="wide pws-publish">
                <div class="pws-pubhead">
                  <b>配置检查</b>
                  <span class="tag" :class="failedChecks ? 'amber' : 'green'">{{ failedChecks ? failedChecks + " 项未通过" : "全部通过" }}</span>
                </div>
                <div class="pws-checklist">
                  <div v-for="check in configChecks" :key="check.label" :class="check.ok ? 'ok' : 'bad'">
                    {{ check.ok ? "✓" : "✗" }} {{ check.label }}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section v-show="moduleKey === 'fields'" class="pws-module">
        <div class="panel">
          <div class="panel-head">
            <h3>产品标准字段</h3>
            <span class="tag">{{ activeFields.length }} 个字段 · {{ standardGroups.length }} 分组</span>
            <span v-if="missingEnglishCount" class="tag amber">英文名待补 {{ missingEnglishCount }}</span>
            <span class="spacer"></span>
            <input v-model="fieldSearch" class="pws-search" type="search" placeholder="搜索编码 / 中英文名 / 说明 / 字典" />
            <button type="button" class="btn sm" @click="openFieldCreate">＋ 字段</button>
            <button type="button" class="btn sm" @click="openGroupEditor">分组管理</button>
            <button type="button" class="btn sm" @click="openDictionaries">码值字典</button>
            <button type="button" class="btn sm" @click="openFieldImport">批量导入</button>
            <button type="button" class="btn sm" @click="exportFields">导出字段</button>
            <button type="button" class="btn sm primary" :disabled="saving" @click="saveFields">{{ saving ? "保存中" : "保存并同步映射" }}</button>
          </div>
          <div class="panel-body">

            <div v-if="fieldImportOpen" class="pws-import">
              <div class="pws-import-head">
                <b>批量导入标准字段</b>
                <span class="mini">列顺序：字段编码, 中文名, 英文名, 类型, 分组编码, 必填, 单位, 精度, 小数位, 格式, 字典编码, 临时枚举, 中文说明, 英文说明, 来源列名, 别名, 状态</span>
              </div>
              <textarea v-model="fieldImportText" rows="6" placeholder="CUST_NO,客户号,Customer No,string,OBLIGOR_PROFILE,true,,,,,CUST_TYPE,,,,,,"></textarea>
              <p class="hint">临时枚举写 `CODE=名称`，多个用分号分隔；别名用分号分隔。导入先解析，逐行显示错误，确认后只写入没有错误的行。</p>
              <div class="pws-import-acts">
                <button type="button" class="btn sm" @click="fieldImportOpen = false; fieldImportPreview = []">取消</button>
                <button type="button" class="btn sm" @click="applyFieldImport">解析预览</button>
                <button type="button" class="btn sm primary" :disabled="!fieldImportPreview.some((row) => !row.errors.length)" @click="confirmFieldImport">确认导入</button>
              </div>
              <div v-if="fieldImportPreview.length" class="table-wrap" style="margin-top: 10px">
                <table class="tbl compact">
                  <thead><tr><th style="width: 54px">行号</th><th>字段编码</th><th>中文名</th><th>英文名</th><th>错误</th></tr></thead>
                  <tbody>
                    <tr v-for="row in fieldImportPreview" :key="row.line" :class="{ 'row-bad': row.errors.length }">
                      <td class="num">{{ row.line }}</td>
                      <td class="mono small">{{ row.field.name }}</td>
                      <td>{{ row.field.label }}</td>
                      <td>{{ row.field.labelEn || "—" }}</td>
                      <td><span v-if="row.errors.length" class="tag danger">{{ row.errors.join("；") }}</span><span v-else class="tag green">可导入</span></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div class="pws-field-split" :class="{ collapsed: !fieldNavOpen }">
              <aside v-show="fieldNavOpen" class="pws-groupnav">
                <div class="pws-groupnav-head">
                  <span>字段分组</span>
                  <button type="button" class="pws-gn-toggle" title="收起分组导航" @click="fieldNavOpen = false">‹</button>
                </div>
                <div class="pws-groupnav-list">
                  <button
                    v-for="group in fieldGroupNav"
                    :key="group.id"
                    type="button"
                    class="pws-groupnav-item"
                    :class="{ on: activeFieldGroupId === group.id, faded: fieldQuery && !group.matched, empty: group.total === 0 }"
                    @click="selectFieldGroup(group.id)"
                  >
                    <span class="pws-gn-row">
                      <b>{{ group.label }}</b>
                      <span class="pws-gn-count">{{ fieldQuery ? group.matched + " / " + group.total : group.total }}</span>
                    </span>
                    <span class="pws-gn-code mono">{{ group.code }}</span>
                  </button>
                </div>
                <div class="pws-groupnav-foot">
                  <button type="button" class="btn xs" @click="openGroupEditor">编辑分组</button>
                </div>
              </aside>

              <div class="pws-fieldmain">
                <div class="pws-fieldmain-head">
                  <div>
                    <h4>{{ selectedFieldGroup.label }}</h4>
                    <span class="mini">
                      <span class="mono">{{ selectedFieldGroup.code }}</span>
                      · {{ fieldQuery ? selectedFieldGroup.matched + " 个匹配 / " : "" }}{{ selectedFieldGroup.total }} 个字段
                    </span>
                  </div>
                  <div class="pws-fieldmain-actions">
                    <button v-if="!fieldNavOpen" type="button" class="btn sm" @click="fieldNavOpen = true">显示分组</button>
                    <button type="button" class="btn sm" @click="openFieldCreate">＋ 新增字段</button>
                  </div>
                </div>

                <div class="pws-field-scroll">
                  <table class="pws-fieldtable">
                    <thead>
                      <tr>
                        <th style="width: 190px">字段编码</th>
                        <th style="width: 160px">中文名</th>
                        <th style="width: 170px">英文名</th>
                        <th v-if="showFieldGroupColumn" style="width: 160px">所属分组</th>
                        <th style="width: 86px">类型</th>
                        <th style="width: 52px">必填</th>
                        <th style="width: 140px">字典</th>
                        <th style="width: 64px">状态</th>
                        <th style="width: 150px">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="field in visibleFields" :key="field.name">
                        <td class="pws-field-code" :title="field.name"><span class="mono">{{ field.name }}</span></td>
                        <td>{{ field.label }}</td>
                        <td><span v-if="field.labelEn || field.label_en">{{ field.labelEn || field.label_en }}</span><span v-else class="tag amber">待补</span></td>
                        <td v-if="showFieldGroupColumn">{{ groupLabelOf(field.group) }}</td>
                        <td><span class="tag">{{ field.type }}</span></td>
                        <td class="pws-field-check">{{ field.required ? "是" : "否" }}</td>
                        <td><span v-if="field.dictionary" class="tag blue" :title="field.dictionary">{{ dictionaryName(field.dictionary) || field.dictionary }}</span><span v-else class="dim">—</span></td>
                        <td><span class="tag" :class="field.status === 'DISABLED' ? 'muted' : 'green'">{{ field.status === "DISABLED" ? "停用" : "启用" }}</span></td>
                        <td>
                          <button type="button" class="btn xs" @click="openFieldEdit(field)">编辑</button>
                          <button type="button" class="btn xs" @click="copyField(field)">复制</button>
                          <button type="button" class="btn xs danger" @click="removeField(field.name)">删除</button>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                  <p v-if="!visibleFields.length" class="dim" style="padding: 16px">
                    {{ fieldQuery ? "没有匹配的标准字段。" : "这个分组还没有标准字段。" }}
                  </p>
                </div>
              </div>
            </div>
            <p class="hint">标准字段按产品注册的 standard_fields 保存；保存时同步映射文档的源字段类型和说明。字段到规则字段的映射只在「字段映射」里维护，产品注册不再保存映射目标。</p>
          </div>
        </div>
      </section>

      <StandardFieldDrawer
        :open="fieldEditorOpen"
        :field="fieldDraft"
        :original-name="editingFieldName"
        :groups="standardGroups"
        :dictionaries="dictionaries"
        :existing-names="fields.map((field) => field.name)"
        @close="fieldEditorOpen = false"
        @save="handleFieldSave"
        @dictionaries="openDictionaries"
      />
      <FieldGroupDrawer
        :open="groupEditorOpen"
        :groups="groupEditorGroups"
        @close="groupEditorOpen = false"
        @save="handleGroupSave"
      />
      <DictionaryManagerDrawer
        :open="dictionaryOpen"
        :registry="registry"
        :dictionaries="dictionaries"
        :fields="activeFields"
        @close="dictionaryOpen = false"
        @saved="handleDictionariesSaved"
      />

      <section v-show="moduleKey === 'exposure'" class="pws-module">
        <div class="panel">
          <div class="panel-head">
            <h3>适用风险暴露类型</h3>
            <span class="tag">{{ selectedClasses.length }} 个已选</span>
            <span v-if="exposureDirty" class="tag amber">有未保存修改</span>
            <span class="spacer"></span>
            <span class="dim" style="font-size: 11.5px">选择结果决定字段映射的监管目标字段范围</span>
            <button type="button" class="btn sm primary" :disabled="saving || !exposureDirty" @click="saveExposureScope">{{ saving ? "保存中" : "保存适用风险暴露类型" }}</button>
          </div>
          <div class="panel-body">
            <div class="notice info">
              <span class="ni">i</span>
              <div>只显示分类规则和权重规则实际引用到的字段。选中的暴露类型越多，字段映射需要覆盖的监管目标字段越多。</div>
            </div>

            <div class="pws-exp-toolbar">
              <input v-model="classSearch" class="pws-search" type="search" placeholder="搜索暴露类型编码 / 名称 / 业务分支" />
              <label class="pws-inline-check"><input v-model="showSelectedOnly" type="checkbox" /> 只看已选</label>
              <button type="button" class="btn sm" @click="toggleAllCandidates">全选</button>
              <button type="button" class="btn sm" @click="clearCandidates">清空</button>
              <span class="spacer"></span>
              <span class="dim" style="font-size: 11px">
                分类节点 {{ scopeStats.cls }} · 权重节点 {{ scopeStats.rw }} · 涉及字段 {{ scopeStats.fields }} · 必填字段 {{ scopeStats.required }}
              </span>
            </div>

            <div class="table-wrap">
              <table class="tbl compact">
                <thead>
                  <tr>
                    <th style="width: 42px"></th>
                    <th>暴露类型</th>
                    <th style="width: 190px">业务分支</th>
                    <th class="num" style="width: 86px">分类节点</th>
                    <th class="num" style="width: 86px">权重节点</th>
                    <th class="num" style="width: 86px">涉及字段</th>
                    <th class="num" style="width: 86px">必填字段</th>
                    <th style="width: 150px">规则</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="item in filteredCandidates"
                    :key="item.code"
                    class="pws-exp-row"
                    :class="{ 'pws-exp-row-on': item.selected }"
                    @click="toggleCandidate(item.code)"
                  >
                    <td><input type="checkbox" :checked="item.selected" @click.stop @change="toggleCandidate(item.code)" /></td>
                    <td>
                      <b>{{ item.label }}</b>
                      <div class="mono dim" style="font-size: 10.5px">{{ item.code }}</div>
                    </td>
                    <td>{{ item.lane }}</td>
                    <td class="num">{{ item.clsCount }}</td>
                    <td class="num">{{ item.rwCount }}</td>
                    <td class="num">{{ item.fieldCount }}</td>
                    <td class="num">{{ item.requiredCount }}</td>
                    <td>
                      <span class="tag" :class="item.clsCount ? 'green' : 'danger'">分类 {{ item.clsCount ? "有" : "缺" }}</span>
                      <span class="tag" :class="item.rwCount ? 'green' : 'danger'">权重 {{ item.rwCount ? "有" : "缺" }}</span>
                    </td>
                  </tr>
                </tbody>
              </table>
              <p v-if="!filteredCandidates.length" class="dim" style="padding: 16px">
                {{ showSelectedOnly ? "还没有已选的暴露类型。" : "没有匹配的暴露类型。" }}
              </p>
            </div>

            <div class="wide pws-publish" style="margin-top: 12px">
              <div class="pws-pubhead">
                <b>范围检查</b>
                <span class="tag" :class="failedExposureChecks ? 'amber' : 'green'">{{ failedExposureChecks ? failedExposureChecks + " 项待处理" : "通过" }}</span>
              </div>
              <div class="pws-checklist">
                <div v-for="check in exposureChecks" :key="check.label" :class="check.ok ? 'ok' : 'bad'">
                  {{ check.ok ? "✓" : "✗" }} {{ check.label }}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section v-show="moduleKey === 'mapping'" class="pws-module">
        <div v-if="!mappingMeta" class="notice warn">这个产品组还没有字段映射文档。</div>
        <FieldMappingWorkbench
          v-else-if="mappingVisited"
          :meta="mappingMeta"
          :document="mappingBody"
          :docs="docs"
          :standard-fields="activeFields"
          :standard-field-groups="standardGroups"
          :scope-classes="selectedClasses"
          :scope-class-labels="scopeClassLabels"
          :scope-fields="scopedFieldNames"
          @save="saveMapping"
          @edit-scope="switchModule('exposure')"
        />
      </section>

      <section v-show="moduleKey === 'rules'" class="pws-module">
        <div class="panel">
          <div class="panel-head">
            <h3>产品规则预览</h3>
            <span class="tag">{{ selectedClasses.length }} 类 · 分类 {{ scopedNodeCounts.cls }} / 权重 {{ scopedNodeCounts.rw }} 节点</span>
            <span class="spacer"></span>
            <span class="dim" style="font-size: 11.5px">只展示当前产品候选暴露类型触达的规则</span>
            <button type="button" class="btn sm" @click="exportProductRules">导出产品规则清单</button>
          </div>
          <div class="panel-body">
            <div class="pws-rule-overview">
              <div v-for="item in ruleOverview" :key="item.label" class="pws-ov">
                <span class="k">{{ item.label }}</span>
                <b>{{ item.value }}</b>
                <span class="s">{{ item.sub }}</span>
              </div>
            </div>
            <ExposureOverview
              embedded
              :classification="classDoc"
              :weight="weightDoc"
              :tables="tables"
              :lists="lists"
              :docs="docs"
              :jurisdiction="jurisdiction"
              :version="version"
              :scope-classes="selectedClasses"
            />
          </div>
        </div>
      </section>
    </template>
  </div>
</template>
