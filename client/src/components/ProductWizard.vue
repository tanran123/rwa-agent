<script setup>
import { computed, onMounted, ref } from "vue";
import {
  createRuleDocument, fetchRuleDocument, saveRuleDocument
} from "@/api/config";
import { askConfirm } from "@/utils/confirm";

const props = defineProps({
  registry: { type: Object, default: null },
  docs: { type: Array, default: () => [] },
  jurisdiction: { type: String, default: "" },
  version: { type: String, default: "" },
  initial: { type: Object, default: null }
});
const emit = defineEmits(["close", "saved"]);

const STEPS = [
  { id: 1, label: "产品组信息" },
  { id: 2, label: "标准字段" },
  { id: 3, label: "字段映射" },
  { id: 4, label: "规则预览" }
];
const FAMILIES = ["LOAN", "BOND", "INTERBANK", "SFT", "DERIVATIVE", "EQUITY", "OFF_BALANCE", "TREASURY", "OTHER"];

const step = ref(1);
const error = ref("");
const saving = ref(false);
const loading = ref(true);
const classDoc = ref(null);
const weightDoc = ref(null);
const mappingDoc = ref(null);
const mappingMeta = ref(null);
const originalSources = ref([]);
const activeSource = ref("");
const search = ref("");

const form = ref({
  family: "LOAN",
  codesText: "",
  mappingRef: "LOAN_DATA_MAPPING",
  mappingVersion: "1.0.0",
  exposureType: "ON_BALANCE",
  sourceSystem: "PRODUCT_SYSTEM",
  note: ""
});
const fields = ref([]);
const links = ref([]);
const newField = ref({ name: "", label: "", type: "string", unit: "" });

const familyMappingRef = (family) => family + "_DATA_MAPPING";
const isCopy = computed(() => !!(props.initial && props.initial.copy));
const editIndex = computed(() => (props.initial && !props.initial.copy ? props.initial.index : -1));

const codes = computed(() => form.value.codesText.split(/\n|,|，/).map((item) => item.trim()).filter(Boolean));
const mappedTargets = computed(() => new Set(links.value.map((link) => link.target)));
const mappedSources = computed(() => new Set(links.value.map((link) => link.source)));

const exposureFields = computed(() => {
  const list = [];
  const seen = new Set();
  const push = (field, docLabel) => {
    if (!field || !field.name || seen.has(field.name)) return;
    seen.add(field.name);
    list.push({
      name: field.name,
      label: field.label || field.name,
      type: field.type || "string",
      source: field.source || "",
      doc: docLabel
    });
  };
  ((classDoc.value && classDoc.value.fields) || []).forEach((field) => push(field, "分类"));
  ((weightDoc.value && weightDoc.value.fields) || []).forEach((field) => push(field, "权重"));
  const known = new Set(list.map((field) => field.name));
  links.value.forEach((link) => {
    if (!known.has(link.target)) {
      known.add(link.target);
      list.push({ name: link.target, label: link.target, type: "string", source: "", doc: "未定义" });
    }
  });
  return list;
});

const filteredExposure = computed(() => {
  const text = search.value.trim().toLowerCase();
  if (!text) return exposureFields.value;
  return exposureFields.value.filter((field) => (field.name + " " + field.label + " " + field.doc).toLowerCase().includes(text));
});

const ROW = 30;
const LEFT_W = 250;
const RIGHT_X = 310;

function rowY(index) {
  return index * ROW + ROW / 2 + 2;
}

function sourceIndex(name) {
  return fields.value.findIndex((field) => field.name === name);
}

function targetIndex(name) {
  return filteredExposure.value.findIndex((field) => field.name === name);
}

const linePaths = computed(() => links.value.map((link, index) => {
  const si = sourceIndex(link.source);
  const ti = targetIndex(link.target);
  if (si < 0 || ti < 0) return null;
  const x1 = LEFT_W;
  const y1 = rowY(si);
  const x2 = RIGHT_X;
  const y2 = rowY(ti);
  return {
    ...link,
    index: index,
    d: "M" + x1 + "," + y1 + " C" + (x1 + 34) + "," + y1 + " " + (x2 - 34) + "," + y2 + " " + x2 + "," + y2
  };
}).filter(Boolean));

const canvasHeight = computed(() => Math.max(fields.value.length, filteredExposure.value.length) * ROW + 12);

async function loadMappingForRef(ref) {
  const meta = props.docs.find((item) => item.kind === "data_mapping" && item.name === ref);
  mappingMeta.value = meta || null;
  if (!meta) {
    mappingDoc.value = null;
    fields.value = [];
    originalSources.value = [];
    links.value = [];
    return;
  }
  const result = await fetchRuleDocument(meta.id);
  mappingDoc.value = result.body;
  const seen = new Set();
  const initialFields = [];
  (result.body.mappings || []).forEach((item) => {
    if (!item || !item.source_field || seen.has(item.source_field)) return;
    seen.add(item.source_field);
    initialFields.push({
      name: item.source_field,
      label: item.description || item.source_field,
      type: item.source_type || "string",
      unit: item.unit || ""
    });
  });
  fields.value = initialFields;
  originalSources.value = initialFields.map((field) => field.name);
  links.value = (result.body.mappings || [])
    .filter((item) => item && item.source_field && item.target_field)
    .map((item) => ({ source: item.source_field, target: item.target_field }));
}

async function onFamilyChange(value) {
  form.value.family = value;
  if (!props.initial) {
    form.value.mappingRef = familyMappingRef(value);
    await loadMappingForRef(form.value.mappingRef);
  }
}

function addField() {
  error.value = "";
  const name = newField.value.name.trim();
  if (!name) {
    error.value = "字段名不能为空";
    return;
  }
  if (fields.value.some((field) => field.name === name)) {
    error.value = "字段名 " + name + " 重复";
    return;
  }
  fields.value.push({
    name: name,
    label: newField.value.label.trim() || name,
    type: newField.value.type,
    unit: newField.value.unit.trim()
  });
  newField.value = { name: "", label: "", type: "string", unit: "" };
}

function removeField(name) {
  fields.value = fields.value.filter((field) => field.name !== name);
  links.value = links.value.filter((link) => link.source !== name);
  if (activeSource.value === name) activeSource.value = "";
}

function pickSource(name) {
  activeSource.value = activeSource.value === name ? "" : name;
}

function pickTarget(name) {
  if (!activeSource.value) {
    error.value = "先点左侧的产品标准字段，再点右侧的敞口划分字段";
    return;
  }
  error.value = "";
  if (links.value.some((link) => link.source === activeSource.value && link.target === name)) return;
  if (links.value.some((link) => link.source !== activeSource.value && link.target === name)) {
    error.value = "敞口字段 " + name + " 已经映射到其它标准字段，每个目标字段只能有一条映射";
    return;
  }
  links.value.push({ source: activeSource.value, target: name });
  activeSource.value = "";
}

function removeLink(index) {
  links.value.splice(index, 1);
}

function targetLinked(name) {
  return links.value.some((link) => link.target === name);
}

function exposureType(field) {
  return (field && field.type) || "string";
}

function matchedRules(doc, targets) {
  const result = [];
  ((doc && doc.rules) || []).forEach((rule) => {
    const matched = new Set();
    const walk = (node) => {
      if (!node || typeof node !== "object") return;
      (node.fields || []).forEach((name) => { if (targets.has(name)) matched.add(name); });
      (node.children || []).forEach(walk);
      if (node.otherwise && node.otherwise.id) walk(node.otherwise);
    };
    walk(rule);
    if (matched.size) result.push({ id: rule.id, label: rule.label, fields: Array.from(matched) });
  });
  return result;
}

const targetNames = computed(() => new Set(links.value.map((link) => link.target)));
const classificationRules = computed(() => matchedRules(classDoc.value, targetNames.value));
const weightRules = computed(() => matchedRules(weightDoc.value, targetNames.value));
const ruleSets = computed(() => {
  const body = props.registry ? props.registry.body : {};
  return (body && body.default_rule_sets) || {};
});

function stepOneError() {
  if (!form.value.family) return "产品族不能为空";
  if (!codes.value.length) return "至少填一个产品代码";
  const invalidCode = codes.value.find((code) => !/^[A-Z][A-Z0-9_]+$/.test(code));
  if (invalidCode) return "产品代码 " + invalidCode + " 只能是大写字母、数字和下划线";
  if (!/^[A-Z][A-Z0-9_]+$/.test(form.value.mappingRef)) return "映射配置名只能是大写字母、数字和下划线";
  const index = editIndex.value;
  const others = new Set();
  ((props.registry && props.registry.body && props.registry.body.product_mappings) || []).forEach((item, at) => {
    if (at === index) return;
    (item.product_codes || []).forEach((code) => others.add(code));
  });
  const duplicated = codes.value.filter((code) => others.has(code));
  if (duplicated.length) return "产品代码已被其它产品组占用：" + duplicated.join(", ");
  return "";
}

function stepTwoError() {
  if (!fields.value.length) return "至少登记一个标准字段";
  const seen = new Set();
  for (const field of fields.value) {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(field.name)) return "字段名 " + field.name + " 不合法";
    if (seen.has(field.name)) return "字段名 " + field.name + " 重复";
    seen.add(field.name);
  }
  return "";
}

function canNext() {
  if (step.value === 1) return stepOneError();
  if (step.value === 2) return stepTwoError();
  return "";
}

function next() {
  error.value = canNext();
  if (error.value) return;
  if (step.value < 4) step.value += 1;
}

function back() {
  error.value = "";
  if (step.value > 1) step.value -= 1;
}

async function load() {
  loading.value = true;
  error.value = "";
  try {
    const classMeta = props.docs.find((item) => item.kind === "exposure_classification");
    const weightMeta = props.docs.find((item) => item.kind === "risk_weight");
    const pending = [];
    pending.push(classMeta ? fetchRuleDocument(classMeta.id) : Promise.resolve(null));
    pending.push(weightMeta ? fetchRuleDocument(weightMeta.id) : Promise.resolve(null));
    if (props.initial && props.initial.mapping) {
      const mappingRef = props.initial.mapping.data_mapping_ref;
      const meta = props.docs.find((item) => item.kind === "data_mapping" && item.name === mappingRef);
      mappingMeta.value = meta || null;
      pending.push(meta ? fetchRuleDocument(meta.id) : Promise.resolve(null));
    } else {
      const defaultRef = form.value.mappingRef;
      const meta = props.docs.find((item) => item.kind === "data_mapping" && item.name === defaultRef);
      mappingMeta.value = meta || null;
      pending.push(meta ? fetchRuleDocument(meta.id) : Promise.resolve(null));
    }
    const [classResult, weightResult, mappingResult] = await Promise.all(pending);
    classDoc.value = classResult ? classResult.body : null;
    weightDoc.value = weightResult ? weightResult.body : null;
    mappingDoc.value = mappingResult ? mappingResult.body : null;

    if (props.initial && props.initial.mapping) {
      const mapping = props.initial.mapping;
      form.value = {
        family: mapping.product_family,
        codesText: (mapping.product_codes || []).join("\n"),
        mappingRef: mapping.data_mapping_ref,
        mappingVersion: mapping.data_mapping_version || "1.0.0",
        exposureType: mapping.exposure_type || "",
        sourceSystem: (mappingResult && mappingResult.body.source_system) || "PRODUCT_SYSTEM",
        note: mapping.note || ""
      };
      const seen = new Set();
      const initialFields = [];
      ((mappingResult && mappingResult.body.mappings) || []).forEach((item) => {
        if (!item || !item.source_field || seen.has(item.source_field)) return;
        seen.add(item.source_field);
        initialFields.push({
          name: item.source_field,
          label: item.description || item.source_field,
          type: item.source_type || "string",
          unit: item.unit || ""
        });
      });
      fields.value = initialFields;
      originalSources.value = initialFields.map((field) => field.name);
      links.value = ((mappingResult && mappingResult.body.mappings) || [])
        .filter((item) => item && item.source_field && item.target_field)
        .map((item) => ({ source: item.source_field, target: item.target_field }));
    } else if (mappingResult) {
      await loadMappingForRef(form.value.mappingRef);
    }
  } catch (err) {
    error.value = err.message || "加载失败";
  } finally {
    loading.value = false;
  }
}

async function save() {
  if (!props.registry) {
    error.value = "这一版还没有产品规则注册文档";
    return;
  }
  error.value = stepOneError() || stepTwoError();
  if (error.value) {
    if (stepOneError()) step.value = 1;
    else step.value = 2;
    return;
  }
  const yes = await askConfirm(
    "保存后会把产品组「" + form.value.family + "」写进产品规则注册，并用当前映射覆盖 " + form.value.mappingRef + " 里这些标准字段原有的映射。其它字段的映射不受影响。",
    { title: "保存产品组向导", confirmText: "保存" }
  );
  if (!yes) return;
  saving.value = true;
  try {
    const registryBody = JSON.parse(JSON.stringify(props.registry.body));
    registryBody.product_mappings = registryBody.product_mappings || [];
    const entry = {
      product_family: form.value.family,
      product_codes: codes.value,
      data_mapping_ref: form.value.mappingRef
    };
    if (form.value.mappingVersion) entry.data_mapping_version = form.value.mappingVersion;
    if (form.value.exposureType) entry.exposure_type = form.value.exposureType;
    if (form.value.note) entry.note = form.value.note;
    const index = editIndex.value;
    if (index >= 0) registryBody.product_mappings[index] = entry;
    else registryBody.product_mappings.push(entry);
    await saveRuleDocument(props.registry.id, { body: registryBody });

    const body = mappingDoc.value
      ? JSON.parse(JSON.stringify(mappingDoc.value))
      : {
        $schema: "",
        mapping_name: form.value.mappingRef,
        title: form.value.family + " 产品数据字段映射",
        version: form.value.mappingVersion || "1.0.0",
        status: "DRAFT",
        product_family: form.value.family,
        source_system: form.value.sourceSystem || "PRODUCT_SYSTEM",
        standard_field_profile: "STC_STANDARD_FIELDS_V1",
        mappings: [],
        validation_rules: [],
        settings: {
          unmapped_target_policy: "not_applicable",
          retain_source_values: true,
          strict_enum_check: true
        },
        note: ""
      };
    body.mapping_name = form.value.mappingRef;
    body.product_family = form.value.family;
    body.source_system = form.value.sourceSystem || body.source_system || "PRODUCT_SYSTEM";
    body.version = form.value.mappingVersion || body.version || "1.0.0";
    body.title = body.title || (form.value.family + " 产品数据字段映射");
    const original = new Set(originalSources.value);
    const existing = new Map();
    (body.mappings || []).forEach((item) => {
      if (item && item.source_field && item.target_field) {
        existing.set(item.source_field + "\u0000" + item.target_field, item);
      }
    });
    const kept = (body.mappings || []).filter((item) => !original.has(item.source_field));
    const definitions = {};
    fields.value.forEach((field) => { definitions[field.name] = field; });
    const targetDefs = {};
    exposureFields.value.forEach((field) => { targetDefs[field.name] = field; });
    const created = links.value.map((link) => {
      const reused = existing.get(link.source + "\u0000" + link.target);
      if (reused) return reused;
      const source = definitions[link.source] || {};
      const target = targetDefs[link.target] || {};
      return {
        source_field: link.source,
        target_field: link.target,
        source_type: source.type || "string",
        target_type: exposureType(target),
        transform: { type: "direct" },
        required: true,
        missing_policy: "manual_review",
        description: source.label || "",
        regulatory_reference: ""
      };
    });
    body.mappings = kept.concat(created);
    if (mappingMeta.value) await saveRuleDocument(mappingMeta.value.id, { body: body });
    else {
      await createRuleDocument({
        jurisdiction: props.jurisdiction,
        ruleVersion: props.version,
        kind: "data_mapping",
        body: body
      });
    }
    emit("saved");
  } catch (err) {
    error.value = err.message || "保存失败";
  } finally {
    saving.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="panel pw-shell">
    <div class="panel-head">
      <h3>{{ isCopy ? "复制产品组" : initial ? "修改产品组" : "新建产品组" }}向导</h3>
      <span class="sub">{{ form.family }} · {{ form.mappingRef }}</span>
      <span class="spacer"></span>
      <button type="button" class="btn sm" @click="$emit('close')">关闭</button>
    </div>

    <div class="pw-steps">
      <button
        v-for="item in STEPS"
        :key="item.id"
        type="button"
        class="pw-step"
        :class="{ active: step === item.id, done: step > item.id }"
        @click="step = item.id"
      >
        <span class="pw-step-n">{{ item.id }}</span>
        {{ item.label }}
      </button>
    </div>

    <p v-if="error" class="notice danger">{{ error }}</p>
    <div v-if="loading" class="loading"><span class="spin"></span>正在读取规则和映射</div>

    <template v-else>
      <div v-show="step === 1" class="pw-body">
        <div class="grid c3">
          <label class="field">产品族
            <select :value="form.family" @change="onFamilyChange($event.target.value)">
              <option v-for="item in FAMILIES" :key="item" :value="item">{{ item }}</option>
            </select>
          </label>
          <label class="field">映射配置
            <input v-model="form.mappingRef" type="text" />
          </label>
          <label class="field">映射版本
            <input v-model="form.mappingVersion" type="text" />
          </label>
          <label class="field">来源系统
            <input v-model="form.sourceSystem" type="text" placeholder="PRODUCT_SYSTEM" />
          </label>
          <label class="field">暴露类型
            <select v-model="form.exposureType">
              <option value="">不填</option>
              <option value="ON_BALANCE">ON_BALANCE</option>
              <option value="OFF_BALANCE">OFF_BALANCE</option>
              <option value="SETTLEMENT">SETTLEMENT</option>
              <option value="CCR">CCR</option>
              <option value="MIXED">MIXED</option>
            </select>
          </label>
          <label class="field full">适用产品代码（一行一个）
            <textarea v-model="form.codesText" style="min-height: 160px" placeholder="CORPORATE_LOAN&#10;PERSONAL_LOAN"></textarea>
          </label>
          <label class="field full">备注
            <input v-model="form.note" type="text" />
          </label>
        </div>
        <p class="hint">产品代码会写进产品规则注册的 product_mappings；产品族决定使用哪一套数据字段映射。</p>
      </div>

      <div v-show="step === 2" class="pw-body">
        <div class="pw-add-row">
          <input v-model="newField.name" type="text" placeholder="字段名，如 LOAN_ASSET_ID" />
          <input v-model="newField.label" type="text" placeholder="中文名称" />
          <select v-model="newField.type">
            <option value="string">string</option>
            <option value="number">number</option>
            <option value="boolean">boolean</option>
            <option value="date">date</option>
            <option value="constant">constant</option>
            <option value="derived">derived</option>
          </select>
          <input v-model="newField.unit" type="text" placeholder="单位（可选）" />
          <button type="button" class="btn sm primary" @click="addField">新增字段</button>
        </div>
        <div class="pw-table-wrap">
          <table class="tbl compact">
            <thead><tr><th>字段名</th><th>中文名称</th><th>类型</th><th>单位</th><th>已映射</th><th></th></tr></thead>
            <tbody>
              <tr v-for="field in fields" :key="field.name">
                <td class="mono">{{ field.name }}</td>
                <td>{{ field.label }}</td>
                <td>{{ field.type }}</td>
                <td>{{ field.unit || "—" }}</td>
                <td><span class="tag" :class="mappedSources.has(field.name) ? 'ok' : 'muted'">{{ mappedSources.has(field.name) ? "是" : "否" }}</span></td>
                <td><button type="button" class="btn sm danger" @click="removeField(field.name)">删除</button></td>
              </tr>
            </tbody>
          </table>
          <p v-if="!fields.length" class="dim" style="padding: 12px">还没有标准字段。上面的输入框添加；切换产品族时会带出该族已有的映射字段。</p>
        </div>
        <p class="hint">标准字段是产品侧的数据字段。下一步把它们连到敞口划分规则集使用的字段。</p>
      </div>

      <div v-show="step === 3" class="pw-body">
        <div class="pw-map-head">
          <span class="pw-col-title">产品标准字段（{{ fields.length }}）</span>
          <span class="pw-col-title" style="left: 310px; position: absolute">敞口划分字段（{{ filteredExposure.length }}）</span>
          <span class="spacer"></span>
          <input v-model="search" class="pw-search" type="search" placeholder="筛选敞口字段" />
        </div>
        <p class="hint">先点左侧字段，再点右侧字段，生成一条映射连线；点右侧可连续映射同一个源字段。</p>
        <div class="pw-map" :style="{ height: canvasHeight + 'px' }">
          <svg class="pw-lines" :width="'100%'" :height="canvasHeight">
            <path v-for="(line, index) in linePaths" :key="index" :d="line.d" class="pw-line" />
          </svg>
          <div class="pw-col pw-left">
            <button
              v-for="(field, index) in fields"
              :key="field.name"
              type="button"
              class="pw-row"
              :class="{ active: activeSource === field.name, linked: mappedSources.has(field.name) }"
              :style="{ top: (index * ROW) + 'px' }"
              @click="pickSource(field.name)"
            >
              <span class="pw-dot"></span>
              <span class="pw-name mono">{{ field.name }}</span>
              <span class="pw-label">{{ field.label }}</span>
            </button>
          </div>
          <div class="pw-col pw-right">
            <button
              v-for="(field, index) in filteredExposure"
              :key="field.name"
              type="button"
              class="pw-row"
              :class="{ linked: targetLinked(field.name) }"
              :style="{ top: (index * ROW) + 'px' }"
              @click="pickTarget(field.name)"
            >
              <span class="pw-dot"></span>
              <span class="pw-name mono">{{ field.name }}</span>
              <span class="pw-label">{{ field.label }}</span>
              <span class="pw-doc">{{ field.doc }}</span>
            </button>
          </div>
        </div>
        <div class="pw-links">
          <span class="pw-col-title">映射关系（{{ links.length }}）</span>
          <button v-for="(link, index) in links" :key="index" type="button" class="pw-link-chip" @click="removeLink(index)">
            {{ link.source }} → {{ link.target }} ×
          </button>
          <span v-if="!links.length" class="dim">还没有映射。</span>
        </div>
      </div>

      <div v-show="step === 4" class="pw-body">
        <div class="grid c4">
          <div class="pw-summary"><span class="pw-k">产品族</span><strong>{{ form.family }}</strong></div>
          <div class="pw-summary"><span class="pw-k">产品代码</span><strong>{{ codes.length }}</strong></div>
          <div class="pw-summary"><span class="pw-k">标准字段</span><strong>{{ fields.length }}</strong></div>
          <div class="pw-summary"><span class="pw-k">已映射</span><strong>{{ links.length }}</strong></div>
        </div>
        <div class="pw-ruleset">
          <span class="pw-k">规则集</span>
          <span class="mono">{{ ruleSets.classification_rule_ref || "—" }} {{ ruleSets.classification_rule_version || "" }}</span>
          <span class="mono">→ {{ ruleSets.risk_weight_rule_ref || "—" }} {{ ruleSets.risk_weight_rule_version || "" }}</span>
        </div>
        <div class="grid c2" style="margin-top: 12px">
          <div class="panel">
            <div class="panel-head"><h3>可触达的暴露分类规则</h3><span class="sub">{{ classificationRules.length }} 条</span></div>
            <div class="panel-body tight">
              <table class="tbl compact">
                <thead><tr><th>规则</th><th>命中的映射字段</th></tr></thead>
                <tbody>
                  <tr v-for="rule in classificationRules" :key="rule.id">
                    <td><span class="mono">{{ rule.id }}</span><div class="dim">{{ rule.label }}</div></td>
                    <td class="mono dim">{{ rule.fields.join(", ") }}</td>
                  </tr>
                </tbody>
              </table>
              <p v-if="!classificationRules.length" class="dim" style="padding: 12px">当前映射的字段没有出现在分类规则里。</p>
            </div>
          </div>
          <div class="panel">
            <div class="panel-head"><h3>可触达的风险权重规则</h3><span class="sub">{{ weightRules.length }} 条</span></div>
            <div class="panel-body tight">
              <table class="tbl compact">
                <thead><tr><th>规则</th><th>命中的映射字段</th></tr></thead>
                <tbody>
                  <tr v-for="rule in weightRules" :key="rule.id">
                    <td><span class="mono">{{ rule.id }}</span><div class="dim">{{ rule.label }}</div></td>
                    <td class="mono dim">{{ rule.fields.join(", ") }}</td>
                  </tr>
                </tbody>
              </table>
              <p v-if="!weightRules.length" class="dim" style="padding: 12px">当前映射的字段没有出现在权重规则里。</p>
            </div>
          </div>
        </div>
        <p v-if="!classDoc || !weightDoc" class="notice warn">这一版还没有同时导入分类规则和风险权重规则，规则预览为空。</p>
      </div>

      <div class="pw-footer">
        <button type="button" class="btn" @click="$emit('close')">取消</button>
        <span class="spacer"></span>
        <button v-if="step > 1" type="button" class="btn" @click="back">上一步</button>
        <button v-if="step < 4" type="button" class="btn primary" @click="next">下一步</button>
        <button v-else type="button" class="btn primary" :disabled="saving" @click="save">{{ saving ? "保存中" : "保存产品组" }}</button>
      </div>
    </template>
  </div>
</template>
