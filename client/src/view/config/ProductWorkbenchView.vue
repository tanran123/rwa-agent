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
const infoForm = ref({ codesText: "", mappingVersion: "", exposureType: "", targetProfileRef: "", note: "" });
const selectedClasses = ref([]);
const classSearch = ref("");
const fieldSearch = ref("");
const fields = ref([]);
const originalFields = ref([]);
const newField = ref({ name: "", label: "", type: "string", group: "", level: "", required: false, mapsTo: "" });
const fieldAddOpen = ref(false);
const fieldImportOpen = ref(false);
const fieldImportText = ref("");
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
const fieldRuleHits = computed(() => {
  const targetHits = {};
  classRules.value.concat(weightRules.value).forEach((rule) => {
    (rule.fields || []).forEach((field) => { targetHits[field] = (targetHits[field] || 0) + 1; });
  });
  const hits = {};
  activeFields.value.forEach((field) => {
    hits[field.name] = (field.maps_to || []).reduce((sum, target) => sum + (targetHits[target] || 0), 0);
  });
  return hits;
});
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
const candidateRows = computed(() => exposureModel.value.matrix.map((row) => ({
  code: row.code,
  label: row.label,
  lane: row.lane,
  clsCount: row.clsIds.length,
  rwCount: row.weightIds.length,
  selected: candidateSet.value.has(row.code)
})));
const filteredCandidates = computed(() => {
  const text = classSearch.value.trim().toLowerCase();
  if (!text) return candidateRows.value;
  return candidateRows.value.filter((item) => (item.code + " " + item.label + " " + item.lane).toLowerCase().includes(text));
});

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
    missing: missing
  };
});

const activeFields = computed(() => fields.value.filter((field) => !field.deleted));
const docGroupMeta = computed(() => {
  const map = {};
  [classDoc.value, weightDoc.value].forEach((doc) => {
    ((doc && doc.field_groups) || []).forEach((group, index) => {
      if (!group || !group.group_id || map[group.group_id]) return;
      map[group.group_id] = {
        label: group.label || group.group_id,
        order: typeof group.order === "number" ? group.order : index
      };
    });
  });
  return map;
});
const standardGroups = computed(() => {
  const map = new Map();
  ((entry.value && entry.value.standard_field_groups) || []).forEach((group, index) => {
    if (group && group.group_id) {
      const meta = docGroupMeta.value[group.group_id] || {};
      map.set(group.group_id, {
        id: group.group_id,
        label: meta.label || group.label || group.group_id,
        level: group.level || "",
        order: meta.order == null ? index : meta.order
      });
    }
  });
  fields.value.forEach((field) => {
    if (field.group && !map.has(field.group)) {
      const meta = docGroupMeta.value[field.group] || {};
      map.set(field.group, {
        id: field.group,
        label: meta.label || field.group,
        level: field.level || "",
        order: meta.order == null ? 999 : meta.order
      });
    }
  });
  return Array.from(map.values()).sort((left, right) => (left.order == null ? 999 : left.order) - (right.order == null ? 999 : right.order));
});
const groupedFields = computed(() => {
  const text = fieldSearch.value.trim().toLowerCase();
  const groups = standardGroups.value.map((group) => Object.assign({}, group, { fields: [] }));
  const byId = new Map(groups.map((group) => [group.id, group]));
  activeFields.value.forEach((field) => {
    if (text && !(field.name + " " + field.label + " " + (field.description || "")).toLowerCase().includes(text)) return;
    let group = byId.get(field.group);
    if (!group) {
      group = { id: field.group || "OTHER", label: field.group || "OTHER", level: field.level || "", fields: [] };
      byId.set(group.id, group);
      groups.push(group);
    }
    group.fields.push(field);
  });
  return groups.filter((group) => group.fields.length);
});

const headerMetrics = computed(() => ([
  { label: "标准字段", value: String(activeFields.value.length), sub: standardGroups.value.length + " 个分组" },
  { label: "Mapping", value: mappingCoverage.value.mapped + " / " + mappingCoverage.value.required, sub: "已映射必需 · " + mappingCoverage.value.pct + "%" },
  { label: "分类/权重规则", value: scopedNodeCounts.value.cls + " / " + scopedNodeCounts.value.rw, sub: selectedClasses.value.length + " 个候选暴露类型" },
  { label: "目标字段", value: String(mappingCoverage.value.targetFields), sub: "目标字段总数" }
]));

const configChecks = computed(() => ([
  { label: "产品组信息完整", ok: selectedClasses.value.length > 0 && !!(entry.value && entry.value.data_mapping_ref) },
  { label: "产品标准字段有效", ok: activeFields.value.length > 0 },
  { label: "已选择适用风险暴露类型", ok: selectedClasses.value.length > 0 },
  { label: "每个暴露类型存在分类规则", ok: selectedClasses.value.length > 0 && candidateRows.value.filter((item) => item.selected).every((item) => item.clsCount > 0) },
  { label: "每个暴露类型关联权重规则", ok: selectedClasses.value.length > 0 && candidateRows.value.filter((item) => item.selected).every((item) => item.rwCount > 0) },
  { label: "必需业务输入字段已全部映射", ok: mappingCoverage.value.missing === 0 && mappingCoverage.value.mapped > 0 },
  { label: "映射转换逻辑有效", ok: (mappingBody.value.mappings || []).every((item) => item.transform) }
]));
const failedChecks = computed(() => configChecks.value.filter((item) => !item.ok).length);
const ruleOverview = computed(() => ([
  { label: "产品", value: meta.value.name, sub: entry.value ? entry.value.product_family : "" },
  { label: "暴露类型", value: String(selectedClasses.value.length), sub: "已选择" },
  { label: "分类规则", value: String(scopedNodeCounts.value.cls), sub: "节点" },
  { label: "权重规则", value: String(scopedNodeCounts.value.rw), sub: "节点" },
  { label: "字段完整性", value: mappingCoverage.value.mapped + " / " + mappingCoverage.value.required, sub: mappingCoverage.value.pct + "%" }
]));

function say(text, kind = "info") {
  notice.value = { text: text, kind: kind };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function syncFieldsFromMapping() {
  const definitions = {};
  ((entry.value && entry.value.standard_fields) || []).forEach((field) => {
    if (field && field.name) definitions[field.name] = field;
  });
  const mapping = {};
  (mappingBody.value.mappings || []).forEach((item) => {
    if (!item || !item.source_field) return;
    const definition = definitions[item.source_field] || {};
    if (!mapping[item.source_field]) {
      mapping[item.source_field] = {
        name: item.source_field,
        label: definition.label || item.description || item.source_field,
        type: definition.type || item.source_type || "string",
        group: definition.group || item.target_group || "OTHER",
        level: definition.level || "",
        required: definition.required !== undefined ? !!definition.required : item.required !== false,
        maps_to: [],
        description: item.description || definition.label || "",
        unit: item.unit || "",
        count: 0
      };
    }
    if (item.target_field && !mapping[item.source_field].maps_to.includes(item.target_field)) {
      mapping[item.source_field].maps_to.push(item.target_field);
    }
    mapping[item.source_field].count += 1;
  });
  ((entry.value && entry.value.standard_fields) || []).forEach((definition) => {
    if (!definition || !definition.name || mapping[definition.name]) return;
    mapping[definition.name] = {
      name: definition.name,
      label: definition.label || definition.name,
      type: definition.type || "string",
      group: definition.group || "OTHER",
      level: definition.level || "",
      required: !!definition.required,
      maps_to: (definition.maps_to || []).slice(),
      description: definition.label || "",
      unit: "",
      count: 0
    };
  });
  fields.value = Object.keys(mapping).map((key) => mapping[key]);
  originalFields.value = fields.value.map((field) => field.name);
}

function syncInfoFromEntry() {
  if (!entry.value) return;
  infoForm.value = {
    codesText: (entry.value.product_codes || []).join("\n"),
    mappingVersion: entry.value.data_mapping_version || "",
    exposureType: entry.value.exposure_type || "",
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

    const classMeta = rows.find((item) => item.kind === "exposure_classification");
    const weightMeta = rows.find((item) => item.kind === "risk_weight");
    const [classResult, weightResult, tableRows, listRows, groupMapResult] = await Promise.all([
      classMeta ? fetchRuleDocument(classMeta.id) : Promise.resolve(null),
      weightMeta ? fetchRuleDocument(weightMeta.id) : Promise.resolve(null),
      fetchParameterTables(jurisdiction.value),
      fetchReferenceLists(jurisdiction.value),
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

function switchModule(key) {
  if (!MODULES.some((item) => item.key === key)) return;
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

function backToList() {
  router.push("/product-config");
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
  if (!selectedClasses.value.length) {
    say("至少选择一个适用风险暴露类型", "warn");
    return;
  }
  saving.value = true;
  try {
    const body = clone(registry.value.body);
    const current = body.product_mappings[entryIndex.value];
    const next = Object.assign({}, current, { product_codes: codes });
    if (infoForm.value.mappingVersion) next.data_mapping_version = infoForm.value.mappingVersion;
    else delete next.data_mapping_version;
    if (infoForm.value.exposureType) next.exposure_type = infoForm.value.exposureType;
    else delete next.exposure_type;
    if (infoForm.value.targetProfileRef) next.target_profile_ref = infoForm.value.targetProfileRef;
    else delete next.target_profile_ref;
    if (selectedClasses.value.length) next.candidate_exposure_classes = selectedClasses.value.slice();
    else delete next.candidate_exposure_classes;
    if (infoForm.value.note) next.note = infoForm.value.note;
    else delete next.note;
    body.product_mappings[entryIndex.value] = next;
    const saved = await saveRuleDocument(registry.value.id, { body: body });
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

function addField() {
  const name = newField.value.name.trim();
  if (!name) {
    say("字段名不能为空", "warn");
    return;
  }
  if (fields.value.some((field) => field.name === name)) {
    say("字段 " + name + " 已存在", "warn");
    return;
  }
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) {
    say("字段名只能包含字母、数字和下划线", "warn");
    return;
  }
  const mapsTo = newField.value.mapsTo.split(/[,，\s]+/).map((item) => item.trim()).filter(Boolean);
  fields.value.push({
    name: name,
    label: newField.value.label.trim() || name,
    type: newField.value.type,
    group: newField.value.group || (standardGroups.value[0] ? standardGroups.value[0].id : "OTHER"),
    level: newField.value.level || (standardGroups.value[0] ? standardGroups.value[0].level : ""),
    required: !!newField.value.required,
    maps_to: mapsTo,
    description: newField.value.label.trim() || name,
    count: 0
  });
  newField.value = { name: "", label: "", type: "string", group: "", level: "", required: false, mapsTo: "" };
  fieldAddOpen.value = false;
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

async function saveFields() {
  if (!mappingMeta.value) {
    say("这个产品组还没有字段映射文档，先在字段映射里建立映射。", "warn");
    return;
  }
  if (!fields.value.length) {
    say("至少保留一个标准字段", "warn");
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
    const savedMapping = await saveRuleDocument(mappingMeta.value.id, { body: body });

    const registryBody = clone(registry.value.body);
    const registryEntry = registryBody.product_mappings[entryIndex.value];
    registryBody.product_mappings[entryIndex.value] = Object.assign({}, registryEntry, {
      standard_fields: fields.value.map((field) => {
        const item = {
          name: field.name,
          label: field.label || field.name,
          type: field.type || "string",
          group: field.group || "OTHER",
          required: !!field.required,
          maps_to: (field.maps_to || []).slice()
        };
        if (field.level) item.level = field.level;
        return item;
      }),
      standard_field_groups: standardGroups.value.map((group) => ({
        group_id: group.id,
        label: group.label || group.id,
        level: group.level || "FACILITY",
        field_count: fields.value.filter((field) => field.group === group.id).length
      })).filter((group) => group.field_count > 0)
    });
    const savedRegistry = await saveRuleDocument(registry.value.id, { body: registryBody });
    registry.value = savedRegistry;
    mappingDoc.value = savedMapping;
    syncFieldsFromMapping();
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

function applyFieldImport() {
  const rows = fieldImportText.value.split(/\n+/).map((line) => line.split(/[,\t]/).map((item) => item.trim())).filter((parts) => parts.length >= 1 && parts[0]);
  rows.forEach(([name, label, type, group, level, required, mapsTo]) => {
    const existing = fields.value.find((field) => field.name === name);
    const maps = (mapsTo || "").split(/[;；\s]+/).map((item) => item.trim()).filter(Boolean);
    if (existing) {
      existing.label = label || existing.label;
      existing.type = type || existing.type;
      existing.group = group || existing.group;
      existing.level = level || existing.level;
      existing.required = String(required).toLowerCase() === "true" || String(required) === "1";
      if (maps.length) existing.maps_to = maps;
      return;
    }
    fields.value.push({
      name: name,
      label: label || name,
      type: type || "string",
      group: group || (standardGroups.value[0] ? standardGroups.value[0].id : "OTHER"),
      level: level || "",
      required: String(required).toLowerCase() === "true" || String(required) === "1",
      maps_to: maps,
      description: label || name,
      count: 0
    });
  });
  fieldImportOpen.value = false;
  fieldImportText.value = "";
  say("字段导入完成，保存后写入产品注册", "ok");
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
    fields: activeFields.value.map((field) => ({
      name: field.name,
      label: field.label,
      type: field.type,
      group: field.group,
      level: field.level,
      required: !!field.required,
      maps_to: field.maps_to || []
    }))
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
    const saved = await saveRuleDocument(mappingMeta.value.id, { body: body });
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
            <span>映射 {{ mappingCoverage.mapped }} / {{ mappingCoverage.required }} · {{ mappingCoverage.pct }}%</span>
            <span>规则 {{ ruleSets.classification_rule_ref || "—" }} / {{ ruleSets.risk_weight_rule_ref || "—" }}</span>
          </div>
        </div>
        <div class="pws-head-metrics">
          <div v-for="item in headerMetrics" :key="item.label">
            <b>{{ item.value }}</b>
            <span>{{ item.label }} · {{ item.sub }}</span>
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
            <h3>产品组信息与适用范围</h3>
            <span class="tag">{{ selectedClasses.length }} 个暴露类型</span>
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
              <label>暴露类型
                <select v-model="infoForm.exposureType">
                  <option value="">不填</option>
                  <option value="ON_BALANCE">ON_BALANCE</option>
                  <option value="OFF_BALANCE">OFF_BALANCE</option>
                  <option value="SETTLEMENT">SETTLEMENT</option>
                  <option value="CCR">CCR</option>
                  <option value="MIXED">MIXED</option>
                </select>
              </label>
              <label>适用产品代码数<input :value="(entry.product_codes || []).length" type="text" disabled /></label>
              <label class="wide">备注<textarea v-model="infoForm.note" rows="2"></textarea></label>
              <label class="wide">适用产品代码（每行一个）<textarea v-model="infoForm.codesText" rows="5"></textarea></label>

              <div class="wide pws-expsec">
                <div class="pws-exphead">
                  <b>适用风险暴露类型</b>
                  <span class="mini">来源：分类规则集 v{{ (classDoc && classDoc.version) || "" }} 的 exposure_class，勾选后参与产品规则预览</span>
                  <span class="spacer"></span>
                  <input v-model="classSearch" class="pws-search" type="search" placeholder="搜索暴露类型编码 / 名称" />
                </div>
                <div class="pws-expgrid">
                  <label
                    v-for="item in filteredCandidates"
                    :key="item.code"
                    class="pws-expcard"
                    :class="{ on: item.selected }"
                  >
                    <input type="checkbox" :checked="item.selected" @change="toggleCandidate(item.code)" />
                    <span class="pws-exp-top"><b>{{ item.label }}</b><span class="mono">{{ item.code }}</span></span>
                    <span class="pws-exp-meta">
                      <span class="tag">{{ item.lane }}</span>
                      <span class="tag blue">分类 {{ item.clsCount }}</span>
                      <span class="tag violet">权重 {{ item.rwCount }}</span>
                    </span>
                  </label>
                </div>
                <p v-if="!filteredCandidates.length" class="dim" style="padding: 10px 0">没有匹配的暴露类型。</p>
              </div>

              <div v-if="businessGroups.length" class="wide pws-groups">
                <div class="pws-group-head">
                  <b>业务产品组</b>
                  <span class="mini">标准字段和字段映射继承产品族；候选风险暴露类型按业务产品组维护</span>
                </div>
                <div class="pws-group-grid">
                  <div v-for="group in businessGroups" :key="group.code" class="pws-group-card">
                    <div class="pws-group-title"><span class="mono">{{ group.code }}</span></div>
                    <div class="pws-group-meta">
                      <span v-for="code in group.candidateExposureClasses" :key="code" class="tag blue">{{ code }}</span>
                    </div>
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
            <span class="spacer"></span>
            <input v-model="fieldSearch" class="pws-search" type="search" placeholder="搜索字段编码 / 名称 / 说明" />
            <button type="button" class="btn sm" @click="fieldAddOpen = !fieldAddOpen">＋ 字段</button>
            <button type="button" class="btn sm" @click="openFieldImport">批量导入</button>
            <button type="button" class="btn sm" @click="exportFields">导出字段</button>
            <button type="button" class="btn sm primary" :disabled="saving" @click="saveFields">{{ saving ? "保存中" : "保存并同步映射" }}</button>
          </div>
          <div class="panel-body">
            <div v-if="fieldAddOpen" class="pws-add-row">
              <input v-model="newField.name" type="text" placeholder="字段编码" />
              <input v-model="newField.label" type="text" placeholder="字段名称" />
              <select v-model="newField.group">
                <option value="">选择分组</option>
                <option v-for="group in standardGroups" :key="group.id" :value="group.id">{{ group.label }}</option>
                <option value="OTHER">OTHER</option>
              </select>
              <select v-model="newField.type">
                <option value="string">string</option>
                <option value="number">number</option>
                <option value="boolean">boolean</option>
                <option value="date">date</option>
                <option value="enum">enum</option>
                <option value="derived">derived</option>
                <option value="constant">constant</option>
              </select>
              <select v-model="newField.level">
                <option value="">层级</option>
                <option value="OBLIGOR">OBLIGOR</option>
                <option value="FACILITY">FACILITY</option>
                <option value="COLLATERAL">COLLATERAL</option>
                <option value="SETTLEMENT">SETTLEMENT</option>
                <option value="PORTFOLIO">PORTFOLIO</option>
                <option value="DATA_PREP">DATA_PREP</option>
                <option value="OUTPUT">OUTPUT</option>
              </select>
              <label class="pws-inline-check"><input v-model="newField.required" type="checkbox" /> 必填</label>
              <input v-model="newField.mapsTo" type="text" placeholder="映射目标，逗号分隔" />
              <button type="button" class="btn sm primary" @click="addField">添加字段</button>
            </div>

            <div v-if="fieldImportOpen" class="pws-import">
              <div class="pws-import-head">
                <b>批量导入标准字段</b>
                <span class="mini">列顺序：字段编码, 字段名称, 类型, 分组, 层级, 必填, 映射目标（逗号或分号分隔）</span>
              </div>
              <textarea v-model="fieldImportText" rows="7" placeholder="CUST_NO,客户号,string,OBLIGOR_PROFILE,OBLIGOR,true,obligor_entity_id"></textarea>
              <div class="pws-import-acts">
                <button type="button" class="btn sm" @click="fieldImportOpen = false">取消</button>
                <button type="button" class="btn sm primary" @click="applyFieldImport">导入</button>
              </div>
            </div>

            <div class="pws-field-scroll">
              <table class="pws-fieldtable">
                <thead>
                  <tr>
                    <th style="width: 170px">字段编码</th>
                    <th style="width: 180px">字段名称</th>
                    <th style="width: 210px">所属分组</th>
                    <th style="width: 110px">类型</th>
                    <th style="width: 150px">层级</th>
                    <th style="width: 54px">必填</th>
                    <th>映射目标</th>
                    <th style="width: 78px">引用</th>
                    <th style="width: 52px"></th>
                  </tr>
                </thead>
                <tbody>
                  <template v-for="group in groupedFields" :key="group.id">
                    <tr class="grp">
                      <td colspan="9">
                        {{ group.label }} · {{ group.fields.length }} 个字段
                        <span class="mini" style="margin-left: 8px">{{ group.id }}</span>
                      </td>
                    </tr>
                    <tr v-for="field in group.fields" :key="field.name">
                      <td><span class="mono">{{ field.name }}</span></td>
                      <td><input v-model="field.label" type="text" /></td>
                      <td>
                        <select v-model="field.group">
                          <option v-for="item in standardGroups" :key="item.id" :value="item.id">{{ item.label }}</option>
                          <option value="OTHER">OTHER</option>
                        </select>
                      </td>
                      <td>
                        <select v-model="field.type">
                          <option value="string">string</option>
                          <option value="number">number</option>
                          <option value="boolean">boolean</option>
                          <option value="date">date</option>
                          <option value="enum">enum</option>
                          <option value="derived">derived</option>
                          <option value="constant">constant</option>
                        </select>
                      </td>
                      <td>
                        <select v-model="field.level">
                          <option value="">—</option>
                          <option value="OBLIGOR">OBLIGOR</option>
                          <option value="FACILITY">FACILITY</option>
                          <option value="COLLATERAL">COLLATERAL</option>
                          <option value="SETTLEMENT">SETTLEMENT</option>
                          <option value="PORTFOLIO">PORTFOLIO</option>
                          <option value="DATA_PREP">DATA_PREP</option>
                          <option value="OUTPUT">OUTPUT</option>
                        </select>
                      </td>
                      <td style="text-align: center"><input v-model="field.required" type="checkbox" /></td>
                      <td>
                        <input type="text" :value="(field.maps_to || []).join(', ')" @change="field.maps_to = $event.target.value.split(/[,，\s]+/).filter(Boolean)" />
                        <span class="mini">映射 {{ field.count }} 条</span>
                      </td>
                      <td><span class="mini">规则 {{ fieldRuleHits[field.name] || 0 }}</span></td>
                      <td><button type="button" class="btn sm danger" @click="removeField(field.name)">删除</button></td>
                    </tr>
                  </template>
                </tbody>
              </table>
              <p v-if="!groupedFields.length" class="dim" style="padding: 16px">没有匹配的标准字段。</p>
            </div>
            <p class="hint">标准字段按产品注册的 standard_fields 保存；保存时同步更新映射文档的源字段类型和说明。分组顺序来自 standard_field_groups。</p>
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
          @save="saveMapping"
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
