<script setup>
import { computed, ref, watch } from "vue";
import {
  fetchRuleDocument, fetchRuleDocuments, saveRuleDocument, validateRuleBody
} from "@/api/config";
import { useRouter } from "vue-router";
import { useContext } from "@/composables/useContext";
import AsyncView from "@/components/AsyncView.vue";
import ProductWizard from "@/components/ProductWizard.vue";
import JsonDocEditor from "@/components/JsonDocEditor.vue";
import RuleForm from "@/components/RuleForm.vue";
import { askConfirm } from "@/utils/confirm";
import {
  familyMeta, mappingTargetSet, matchedRuleCount, productStatus, STATUS_META, uniqueSources
} from "@/utils/productCatalog";

const { session, scopeVersion } = useContext();
const router = useRouter();
const docs = ref([]);
const tab = ref("registry");
const notice = ref({ text: "", kind: "" });
const registry = ref(null);
const mapping = ref(null);
const productForm = ref(null);
const validationForm = ref(null);
const formError = ref("");
const saving = ref(false);
const jsonMode = ref(false);
const validation = ref(null);
const mappingId = ref("");
const wizard = ref(null);
const mappingBodies = ref({});
const classRuleDoc = ref(null);
const weightRuleDoc = ref(null);
const cardSearch = ref("");
const cardFamily = ref("");
const cardStatus = ref("");
const cardExposure = ref("");
const cardMapping = ref("");
const sortBy = ref("name");
const viewMode = ref("card");
const pageSize = ref(10);
const page = ref(1);
const cardMenu = ref(-1);

const jurisdiction = computed(() => session.jurisdiction || "");
const version = computed(() => scopeVersion.value);
const registryBody = computed(() => (registry.value ? registry.value.body : {}));
const mappingBody = computed(() => (mapping.value ? mapping.value.body : {}));
const mappingDocs = computed(() => docs.value.filter((item) => item.kind === "data_mapping"));

function say(text, kind = "info") {
  notice.value = { text, kind };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const mappingMetaByName = computed(() => {
  const map = {};
  docs.value
    .filter((item) => item.kind === "data_mapping")
    .forEach((item) => { map[item.name] = item; });
  return map;
});

function requiredTargetsOf(entry, body) {
  const targets = new Set();
  (entry.standard_fields || []).forEach((field) => {
    if (!field || field.required === false) return;
    (field.maps_to || []).forEach((target) => { if (target) targets.add(target); });
  });
  if (!targets.size) {
    ((body && body.mappings) || []).forEach((item) => {
      if (item && item.required !== false && item.target_field) targets.add(item.target_field);
    });
  }
  return targets;
}

function coverageOf(entry, body) {
  const reported = (body && body.coverage) || {};
  if (reported.target_fields || reported.mapped_required) {
    const mapped = Number(reported.mapped_required || 0);
    const missing = (reported.missing_required || []).length;
    const required = mapped + missing || Number(reported.target_fields || 0);
    return { required: required, mapped: mapped, pct: required ? Math.round(mapped / required * 100) : 0 };
  }
  const required = requiredTargetsOf(entry, body);
  const mapped = mappingTargetSet(body);
  const mappedCount = Array.from(required).filter((target) => mapped.has(target)).length;
  return {
    required: required.size,
    mapped: mappedCount,
    pct: required.size ? Math.round(mappedCount / required.size * 100) : 0
  };
}

const STATUS_RANK = { registered: 0, configuring: 1, error: 2, draft: 3 };

const productCards = computed(() => {
  const entries = (registry.value && registry.value.body && registry.value.body.product_mappings) || [];
  return entries.map((entry, index) => {
    const meta = familyMeta(entry.product_family);
    const body = mappingBodies.value[entry.data_mapping_ref];
    const sources = uniqueSources(body);
    const targets = mappingTargetSet(body);
    const statusKey = productStatus(body);
    const coverage = coverageOf(entry, body);
    const mappingMeta = mappingMetaByName.value[entry.data_mapping_ref];
    return {
      index: index,
      entry: entry,
      family: entry.product_family,
      name: meta.name,
      code: entry.product_family,
      category: meta.category,
      icon: meta.icon,
      color: meta.color,
      desc: entry.note || (body && body.title) || meta.desc,
      tags: entry.product_codes || [],
      statusKey: statusKey,
      status: STATUS_META[statusKey].label,
      fieldCount: sources.size,
      mappingCount: ((body && body.mappings) || []).length,
      mappedRequired: coverage.mapped,
      requiredCount: coverage.required,
      mappingPct: coverage.pct,
      mappingState: !body || !((body && body.mappings) || []).length ? "none" : coverage.pct >= 100 ? "done" : "doing",
      classRuleCount: matchedRuleCount(classRuleDoc.value, targets),
      weightRuleCount: matchedRuleCount(weightRuleDoc.value, targets),
      mappingName: entry.data_mapping_ref,
      mappingShort: String(entry.data_mapping_ref || "").replace(/_DATA_MAPPING$/, "") === entry.product_family
        ? ""
        : String(entry.data_mapping_ref || "").replace(/_DATA_MAPPING$/, ""),
      mappingVersion: entry.data_mapping_version || (body && body.version) || "1.1.0",
      exposureType: entry.exposure_type || "",
      updatedAt: (mappingMeta && mappingMeta.updatedAt) || "",
      hasMapping: !!body
    };
  });
});

/** 设计稿里「产品族」下拉直接按产品族过滤。 */
const cardFamilies = computed(() => {
  const set = new Set();
  productCards.value.forEach((card) => set.add(card.family));
  return Array.from(set);
});

const exposureTypes = computed(() => {
  const set = new Set();
  productCards.value.forEach((card) => { if (card.exposureType) set.add(card.exposureType); });
  return Array.from(set);
});

const filteredCards = computed(() => {
  const text = cardSearch.value.trim().toLowerCase();
  const rows = productCards.value.filter((card) => {
    if (cardFamily.value && card.family !== cardFamily.value) return false;
    if (cardStatus.value && card.statusKey !== cardStatus.value) return false;
    if (cardExposure.value && card.exposureType !== cardExposure.value) return false;
    if (cardMapping.value && card.mappingState !== cardMapping.value) return false;
    if (!text) return true;
    return [card.name, card.code, card.category, card.family, card.mappingName, card.desc, ...(card.tags || [])].join(" ").toLowerCase().includes(text);
  });
  return rows.sort((left, right) => {
    if (sortBy.value === "updated") return String(right.updatedAt || "").localeCompare(String(left.updatedAt || ""));
    if (sortBy.value === "status") return (STATUS_RANK[left.statusKey] ?? 9) - (STATUS_RANK[right.statusKey] ?? 9);
    return left.name.localeCompare(right.name, "zh");
  });
});

const pageCount = computed(() => Math.max(1, Math.ceil(filteredCards.value.length / pageSize.value)));
const pagedCards = computed(() => {
  const start = (page.value - 1) * pageSize.value;
  return filteredCards.value.slice(start, start + pageSize.value);
});

watch([cardSearch, cardFamily, cardStatus, cardExposure, cardMapping, sortBy, pageSize], () => {
  page.value = 1;
});
watch(pageCount, (value) => {
  if (page.value > value) page.value = value;
});

const cardSummary = computed(() => ({
  total: productCards.value.length,
  registered: productCards.value.filter((card) => card.statusKey === "registered").length,
  configuring: productCards.value.filter((card) => card.statusKey === "configuring").length,
  error: productCards.value.filter((card) => card.statusKey === "error").length,
  mappingAvg: productCards.value.length
    ? Math.round(productCards.value.reduce((sum, card) => sum + card.mappingPct, 0) / productCards.value.length)
    : 0
}));

function clearCardFilters() {
  cardSearch.value = "";
  cardFamily.value = "";
  cardStatus.value = "";
  cardExposure.value = "";
  cardMapping.value = "";
  sortBy.value = "name";
  page.value = 1;
}

function goPage(step) {
  page.value = Math.min(Math.max(1, page.value + step), pageCount.value);
}

function openWorkbench(card, module) {
  router.push({
    name: "product-workbench",
    params: { family: card.family, module: module },
    query: {
      entry: String(card.index),
      jurisdiction: jurisdiction.value,
      version: version.value
    }
  });
}

function openCardConfig(card) {
  const meta = docs.value.find((item) => item.kind === "data_mapping" && item.name === card.mappingName);
  if (!meta) {
    say("这个产品组还没有字段映射文档，请先通过配置向导创建。", "warn");
    return;
  }
  tab.value = "mappings";
  jsonMode.value = false;
  openMapping(meta.id);
}

function openWizardCopy(row, index) {
  wizard.value = {
    initial: {
      index: -1,
      copy: true,
      mapping: Object.assign({}, row, { product_codes: [] })
    }
  };
}

async function removeProductGroup(index) {
  const entry = ((registryBody.value && registryBody.value.product_mappings) || [])[index];
  if (!entry) return;
  const yes = await askConfirm("删除产品组「" + entry.product_family + "」不会删除对应的字段映射文档，但会把这个产品组从产品清单中移除。", {
    title: "删除产品组",
    confirmText: "删除",
    danger: true
  });
  if (!yes) return;
  saving.value = true;
  try {
    const body = clone(registryBody.value);
    body.product_mappings.splice(index, 1);
    const saved = await saveRuleDocument(registry.value.id, { body: body });
    registry.value = saved;
    cardMenu.value = -1;
    await refreshDocs();
    say("已删除产品组 " + entry.product_family, "ok");
  } catch (err) {
    say(err.message, "danger");
  } finally {
    saving.value = false;
  }
}

function toggleCardMenu(index) {
  cardMenu.value = cardMenu.value === index ? -1 : index;
}

function openWizardNew() {
  wizard.value = { initial: null };
}

function openWizardEdit(row, index) {
  wizard.value = { initial: { index: index, mapping: row } };
}

async function onWizardSaved() {
  wizard.value = null;
  await loadAll();
}

async function loadAll() {
  const rows = await fetchRuleDocuments({ jurisdiction: jurisdiction.value, version: version.value });
  docs.value = rows;
  const registryMeta = rows.find((item) => item.kind === "product_registry");
  registry.value = registryMeta ? await fetchRuleDocument(registryMeta.id) : null;
  const mappingMetas = rows.filter((item) => item.kind === "data_mapping");
  const classMeta = rows.find((item) => item.kind === "exposure_classification");
  const weightMeta = rows.find((item) => item.kind === "risk_weight");
  const [mappingResults, classResult, weightResult] = await Promise.all([
    Promise.all(mappingMetas.map((item) => fetchRuleDocument(item.id))),
    classMeta ? fetchRuleDocument(classMeta.id) : Promise.resolve(null),
    weightMeta ? fetchRuleDocument(weightMeta.id) : Promise.resolve(null)
  ]);
  const bodies = {};
  mappingResults.forEach((doc) => { if (doc) bodies[doc.name] = doc.body; });
  mappingBodies.value = bodies;
  classRuleDoc.value = classResult ? classResult.body : null;
  weightRuleDoc.value = weightResult ? weightResult.body : null;
  return rows;
}

async function refreshDocs() {
  docs.value = await fetchRuleDocuments({ jurisdiction: jurisdiction.value, version: version.value });
}

async function openMapping(id) {
  mappingId.value = id;
  mapping.value = await fetchRuleDocument(id);
  validation.value = null;
}

function setRegistry(key, value) {
  const next = clone(registry.value.body);
  if (value === "") delete next[key];
  else next[key] = value;
  registry.value.body = next;
}

function setDefaultRuleSet(key, value) {
  const next = clone(registry.value.body);
  next.default_rule_sets = next.default_rule_sets || {};
  if (value === "") delete next.default_rule_sets[key];
  else next.default_rule_sets[key] = value;
  registry.value.body = next;
}

function setPolicy(key, value) {
  const next = clone(registry.value.body);
  next.rule_set_version_policy = next.rule_set_version_policy || {};
  if (value === "") delete next.rule_set_version_policy[key];
  else next.rule_set_version_policy[key] = value === "true" ? true : value === "false" ? false : value;
  registry.value.body = next;
}

function setMapping(key, value) {
  const next = clone(mapping.value.body);
  if (value === "") delete next[key];
  else next[key] = value;
  mapping.value.body = next;
}

async function saveRegistry(nextBody) {
  if (!registry.value) return;
  await saveDoc(registry.value, nextBody);
}

async function saveMapping(nextBody) {
  if (!mapping.value) return;
  await saveDoc(mapping.value, nextBody);
}

async function saveDoc(doc, nextBody) {
  saving.value = true;
  validation.value = null;
  try {
    if (nextBody) doc.body = nextBody;
    const saved = await saveRuleDocument(doc.id, { body: doc.body });
    if (doc === registry.value) registry.value = saved;
    if (doc === mapping.value) mapping.value = saved;
    await refreshDocs();
    say("已保存 " + saved.name, "ok");
  } catch (err) {
    say(err.message, "danger");
  } finally {
    saving.value = false;
  }
}

async function validateCurrent() {
  const doc = tab.value === "registry" ? registry.value : mapping.value;
  if (!doc) return;
  saving.value = true;
  try {
    validation.value = await validateRuleBody({
      kind: doc.kind,
      body: doc.body,
      jurisdiction: jurisdiction.value,
      ruleVersion: doc.ruleVersion
    });
    say(validation.value.ok ? "校验通过" : "校验发现 " + validation.value.errors.length + " 处问题", validation.value.ok ? "ok" : "danger");
  } catch (err) {
    validation.value = { ok: false, errors: [err.message] };
  } finally {
    saving.value = false;
  }
}

// ---------------------------------------------------------------- 产品注册

function addProduct() {
  formError.value = "";
  productForm.value = {
    creating: true,
    product_family: "LOAN",
    codesText: "",
    data_mapping_ref: "LOAN_DATA_MAPPING",
    data_mapping_version: "1.0.0",
    exposure_type: "ON_BALANCE",
    note: ""
  };
}

function editProduct(row, index) {
  formError.value = "";
  productForm.value = {
    creating: false,
    index,
    product_family: row.product_family,
    codesText: (row.product_codes || []).join("\n"),
    data_mapping_ref: row.data_mapping_ref,
    data_mapping_version: row.data_mapping_version || "",
    exposure_type: row.exposure_type || "",
    note: row.note || ""
  };
}

async function saveProduct() {
  formError.value = "";
  const form = productForm.value;
  if (!form) return;
  const codes = String(form.codesText || "").split("\n").map((item) => item.trim()).filter(Boolean);
  if (!codes.length) {
    formError.value = "至少填一个产品代码";
    return;
  }
  const item = {
    product_family: form.product_family,
    product_codes: codes,
    data_mapping_ref: form.data_mapping_ref
  };
  if (form.data_mapping_version) item.data_mapping_version = form.data_mapping_version;
  if (form.exposure_type) item.exposure_type = form.exposure_type;
  if (form.note) item.note = form.note;
  const next = clone(registry.value.body);
  next.product_mappings = next.product_mappings || [];
  if (form.creating) next.product_mappings.push(item);
  else next.product_mappings[form.index] = item;
  saving.value = true;
  try {
    const saved = await saveRuleDocument(registry.value.id, { body: next });
    registry.value = saved;
    productForm.value = null;
    await refreshDocs();
    say("已更新产品组 " + item.product_family, "ok");
  } catch (err) {
    formError.value = err.message;
  } finally {
    saving.value = false;
  }
}

async function removeProduct(index) {
  const row = (registryBody.value.product_mappings || [])[index] || {};
  const yes = await askConfirm("删除产品族「" + (row.product_family || "") + "」下的 " + ((row.product_codes || []).length) + " 个产品代码。", {
    title: "删除产品注册项", confirmText: "删除", danger: true
  });
  if (!yes) return;
  const next = clone(registry.value.body);
  next.product_mappings.splice(index, 1);
  registry.value.body = next;
}

function addValidationRule() {
  formError.value = "";
  validationForm.value = { creating: true, rule_id: "", description: "", action: "manual_review", target_field: "", expression: "", regulatory_reference: "" };
}

function editValidationRule(row, index) {
  formError.value = "";
  validationForm.value = {
    creating: false,
    index,
    rule_id: row.rule_id || "",
    description: row.description || "",
    action: row.action || "manual_review",
    target_field: (row.target_field || []).join(", "),
    expression: row.expression || "",
    regulatory_reference: row.regulatory_reference || ""
  };
}

function saveValidationRule() {
  formError.value = "";
  const form = validationForm.value;
  if (!form.rule_id.trim()) {
    formError.value = "rule_id 不能为空";
    return;
  }
  const item = { rule_id: form.rule_id.trim(), description: form.description, action: form.action };
  const target = String(form.target_field || "").split(",").map((value) => value.trim()).filter(Boolean);
  if (target.length) item.target_field = target;
  if (form.expression) item.expression = form.expression;
  if (form.regulatory_reference) item.regulatory_reference = form.regulatory_reference;
  const next = clone(mapping.value.body);
  next.validation_rules = next.validation_rules || [];
  if (form.creating) next.validation_rules.push(item);
  else next.validation_rules[form.index] = item;
  mapping.value.body = next;
  validationForm.value = null;
}

async function removeValidationRule(index) {
  const yes = await askConfirm("删除校验规则。", { title: "删除校验规则", confirmText: "删除", danger: true });
  if (!yes) return;
  const next = clone(mapping.value.body);
  next.validation_rules.splice(index, 1);
  mapping.value.body = next;
}

function removeCurrentProduct() {
  const form = productForm.value;
  productForm.value = null;
  if (form && !form.creating) removeProductGroup(form.index);
}

function removeCurrentValidationRule() {
  const form = validationForm.value;
  validationForm.value = null;
  if (form && !form.creating) removeValidationRule(form.index);
}
</script>

<template>
  <div v-if="wizard" class="pw-overlay">
    <ProductWizard
      :registry="registry"
      :docs="docs"
      :jurisdiction="jurisdiction"
      :version="version"
      :initial="wizard.initial"
      @close="wizard = null"
      @saved="onWizardSaved"
    />
  </div>

  <div class="section-tabs" style="margin-bottom: 12px">
    <button type="button" class="section-tab active" @click="tab = 'registry'; jsonMode = false">产品管理</button>
    <span class="spacer"></span>
    <button type="button" class="btn sm" @click="jsonMode = !jsonMode">{{ jsonMode ? "结构化编辑" : "JSON 原文" }}</button>
    <button type="button" class="btn sm" :disabled="saving" @click="validateCurrent">校验</button>
    <button
      type="button"
      class="btn sm primary"
      :disabled="saving || jsonMode"
      @click="tab === 'registry' ? saveRegistry() : saveMapping()"
    >保存</button>
  </div>

  <p v-if="notice.text" class="notice" :class="notice.kind">{{ notice.text }}</p>

  <AsyncView :load="loadAll">
    <template #default>
      <div v-if="validation && validation.errors.length" class="notice danger">
        <strong>校验发现 {{ validation.errors.length }} 处问题</strong>
        <div v-for="(item, index) in validation.errors" :key="index" class="mono" style="font-size: 12px; margin-top: 4px">{{ item }}</div>
      </div>
      <p v-else-if="validation" class="notice ok">校验通过。</p>

      <template v-if="!registry && !mapping">
        <div class="notice warn">这一版还没有产品注册和字段映射。先到「敞口划分配置」导入 docs 样例，或在 JSON 模式下新建文档。</div>
      </template>

      <template v-else-if="tab === 'registry'">
        <div v-if="!registry" class="notice warn">这一版还没有产品规则注册。</div>
        <template v-else>
          <JsonDocEditor
            v-if="jsonMode"
            :body="registryBody"
            kind="product_registry"
            :jurisdiction="jurisdiction"
            :saving="saving"
            @update:body="registry.body = $event"
            @save="saveRegistry($event)"
            @notify="say($event, 'info')"
          />
          <template v-else>
            <div class="pr-hero">
              <div>
                <h2>产品管理 <span class="pr-total">{{ filteredCards.length }} / {{ productCards.length }}</span></h2>
                <p class="pr-stats-line">
                  产品 {{ productCards.length }} 个 · 已注册 {{ cardSummary.registered }} ·
                  配置中 {{ cardSummary.configuring }} · 配置异常 {{ cardSummary.error }} ·
                  Mapping 平均完成率 {{ cardSummary.mappingAvg }}% · 当前第 {{ page }}/{{ pageCount }} 页
                </p>
              </div>
              <span class="spacer"></span>
              <button type="button" class="btn primary" @click="openWizardNew">＋ 新建产品</button>
            </div>

            <div class="pr-toolbar">
              <input v-model="cardSearch" class="pr-search" type="search" placeholder="搜索产品名称 / 编码 / 产品代码" />
              <select v-model="cardStatus">
                <option value="">全部状态</option>
                <option value="draft">草稿</option>
                <option value="configuring">配置中</option>
                <option value="registered">已注册</option>
                <option value="error">配置异常</option>
              </select>
              <select v-if="exposureTypes.length" v-model="cardExposure">
                <option value="">全部暴露类型</option>
                <option v-for="item in exposureTypes" :key="item" :value="item">{{ item }}</option>
              </select>
              <select v-model="cardMapping">
                <option value="">全部映射状态</option>
                <option value="none">未开始</option>
                <option value="doing">进行中</option>
                <option value="done">已完成</option>
              </select>
              <select v-model="cardFamily">
                <option value="">全部产品族</option>
                <option v-for="item in cardFamilies" :key="item" :value="item">{{ item }}</option>
              </select>
              <select v-model="sortBy">
                <option value="name">按名称排序</option>
                <option value="updated">按最近更新</option>
                <option value="status">按配置状态</option>
              </select>
              <button type="button" class="btn sm" @click="clearCardFilters">清空筛选</button>
              <span class="spacer"></span>
              <div class="pr-seg" role="group" aria-label="视图切换">
                <button type="button" :class="{ on: viewMode === 'card' }" @click="viewMode = 'card'">卡片</button>
                <button type="button" :class="{ on: viewMode === 'list' }" @click="viewMode = 'list'">列表</button>
              </div>
              <select v-model.number="pageSize" class="pr-size">
                <option :value="10">10 条/页</option>
                <option :value="20">20 条/页</option>
                <option :value="50">50 条/页</option>
              </select>
            </div>

            <div v-if="!productCards.length" class="pr-empty">
              <div class="pr-empty-icon">产</div>
              <h3>当前还没有注册产品</h3>
              <p>从产品组开始登记适用产品代码、标准字段和字段映射。</p>
              <button type="button" class="btn primary" @click="openWizardNew">立即注册产品</button>
            </div>
            <div v-else-if="!filteredCards.length" class="pr-empty small">
              <h3>没有匹配的产品</h3>
              <p>换个关键词或调整筛选条件再试。</p>
              <button type="button" class="btn" @click="clearCardFilters">清空筛选</button>
            </div>

            <template v-else>
              <div v-if="viewMode === 'card'" class="pr-grid compact">
                <article
                  v-for="card in pagedCards"
                  :key="card.index + '_' + card.code"
                  class="pr-card compact"
                  @click="openWorkbench(card, 'info')"
                >
                  <header class="pr-card-head">
                    <h3 :title="card.name">{{ card.name }}</h3>
                    <span class="pr-family-tag">{{ card.family }}</span>
                    <span class="pr-status" :class="card.statusKey">{{ card.status }}</span>
                    <div class="pr-more" @click.stop>
                      <button type="button" class="pr-more-btn" title="更多操作" @click.stop="toggleCardMenu(card.index)">⋯</button>
                      <div v-if="cardMenu === card.index" class="pr-menu">
                        <button type="button" @click.stop="openWizardCopy(card.entry, card.index)">复制产品</button>
                        <button type="button" class="danger" @click.stop="removeProductGroup(card.index)">删除产品</button>
                      </div>
                    </div>
                  </header>

                  <div class="pr-code mono" :title="card.code + ' · ' + card.mappingName + ' v' + card.mappingVersion">{{ card.code }}<template v-if="card.mappingShort"> · {{ card.mappingShort }}</template> v{{ card.mappingVersion }}</div>

                  <div class="pr-metrics">
                    <div><b>{{ card.fieldCount }}</b><span>标准字段</span></div>
                    <div :title="'已映射必需目标字段 ' + card.mappedRequired + ' / ' + card.requiredCount">
                      <b>{{ card.mappedRequired }}<small>/{{ card.requiredCount }}</small></b>
                      <span>Mapping</span>
                    </div>
                    <div title="分类规则 / 风险权重规则节点数">
                      <b>{{ card.classRuleCount }}/{{ card.weightRuleCount }}</b>
                      <span>分类/权重</span>
                    </div>
                    <div title="适用产品代码数量"><b>{{ card.tags.length }}</b><span>产品代码</span></div>
                  </div>

                  <footer class="pr-quick" @click.stop>
                    <button type="button" @click.stop="openWorkbench(card, 'info')">产品组信息</button>
                    <button type="button" @click.stop="openWorkbench(card, 'fields')">标准字段</button>
                    <button type="button" @click.stop="openWorkbench(card, 'mapping')">字段映射<i>{{ card.mappingPct }}%</i></button>
                    <button type="button" @click.stop="openWorkbench(card, 'rules')">规则预览</button>
                  </footer>
                </article>
              </div>

              <div v-else class="pr-table-wrap">
                <table class="pr-table">
                  <thead>
                    <tr>
                      <th>产品名称</th><th>产品编码</th><th>产品族</th><th>状态</th>
                      <th>标准字段</th><th>Mapping</th><th>规则</th><th>产品代码</th><th>更新时间</th><th>快捷入口</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="card in pagedCards" :key="card.index + '_row'" @click="openWorkbench(card, 'info')">
                      <td><b>{{ card.name }}</b></td>
                      <td class="mono">{{ card.code }}</td>
                      <td>{{ card.family }}</td>
                      <td><span class="pr-status" :class="card.statusKey">{{ card.status }}</span></td>
                      <td>{{ card.fieldCount }}</td>
                      <td>{{ card.mappedRequired }}/{{ card.requiredCount }}（{{ card.mappingPct }}%）</td>
                      <td>{{ card.classRuleCount }} / {{ card.weightRuleCount }}</td>
                      <td>{{ card.tags.length }}</td>
                      <td class="mono">{{ card.updatedAt || "—" }}</td>
                      <td class="pr-quickcell" @click.stop>
                        <button type="button" @click.stop="openWorkbench(card, 'info')">信息</button>
                        <button type="button" @click.stop="openWorkbench(card, 'fields')">字段</button>
                        <button type="button" @click.stop="openWorkbench(card, 'mapping')">映射</button>
                        <button type="button" @click.stop="openWorkbench(card, 'rules')">规则</button>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div class="pr-pager">
                <button type="button" class="btn sm" :disabled="page <= 1" @click="goPage(-1)">上一页</button>
                <span class="pr-pager-info">第 {{ page }} / {{ pageCount }} 页 · 共 {{ filteredCards.length }} 条</span>
                <button type="button" class="btn sm" :disabled="page >= pageCount" @click="goPage(1)">下一页</button>
                <span class="spacer"></span>
                <span class="pr-pager-info">每页 {{ pageSize }} 条</span>
              </div>
            </template>

            <details class="pr-settings">
              <summary>注册表设置（规则集与版本策略）</summary>
              <div class="panel" style="margin-top: 10px">
                <div class="panel-head">
                  <h3>注册信息</h3>
                  <span class="sub mono">{{ registry.name }} · {{ registry.ruleVersion }}</span>
                </div>
                <div class="panel-body">
                  <div class="grid c4">
                    <label class="field">标题
                      <input :value="registryBody.title || ''" type="text" @change="setRegistry('title', $event.target.value)" />
                    </label>
                    <label class="field">文档版本
                      <input :value="registryBody.version || ''" type="text" @change="setRegistry('version', $event.target.value)" />
                    </label>
                    <label class="field">状态
                      <select :value="registryBody.status || 'DRAFT'" @change="setRegistry('status', $event.target.value)">
                        <option value="DRAFT">DRAFT</option><option value="REVIEW">REVIEW</option>
                        <option value="APPROVED">APPROVED</option><option value="RETIRED">RETIRED</option>
                      </select>
                    </label>
                    <label class="field">框架
                      <input :value="registryBody.framework || 'STC'" type="text" @change="setRegistry('framework', $event.target.value)" />
                    </label>
                    <label class="field">分类规则集
                      <input :value="(registryBody.default_rule_sets || {}).classification_rule_ref || ''" type="text" @change="setDefaultRuleSet('classification_rule_ref', $event.target.value)" />
                    </label>
                    <label class="field">分类规则版本
                      <input :value="(registryBody.default_rule_sets || {}).classification_rule_version || ''" type="text" @change="setDefaultRuleSet('classification_rule_version', $event.target.value)" />
                    </label>
                    <label class="field">权重规则集
                      <input :value="(registryBody.default_rule_sets || {}).risk_weight_rule_ref || ''" type="text" @change="setDefaultRuleSet('risk_weight_rule_ref', $event.target.value)" />
                    </label>
                    <label class="field">权重规则版本
                      <input :value="(registryBody.default_rule_sets || {}).risk_weight_rule_version || ''" type="text" @change="setDefaultRuleSet('risk_weight_rule_version', $event.target.value)" />
                    </label>
                    <label class="field">版本选择依据
                      <select :value="(registryBody.rule_set_version_policy || {}).selection_basis || 'MEASUREMENT_DATE'" @change="setPolicy('selection_basis', $event.target.value)">
                        <option value="MEASUREMENT_DATE">MEASUREMENT_DATE</option>
                        <option value="REPORTING_DATE">REPORTING_DATE</option>
                        <option value="LATEST_APPROVED">LATEST_APPROVED</option>
                      </select>
                    </label>
                    <label class="field">缺版本处理
                      <select :value="(registryBody.rule_set_version_policy || {}).on_missing_version || 'manual_review'" @change="setPolicy('on_missing_version', $event.target.value)">
                        <option value="manual_review">manual_review</option><option value="fail">fail</option>
                      </select>
                    </label>
                    <label class="field">要求版本同期
                      <select :value="String((registryBody.rule_set_version_policy || {}).require_same_version_date !== false)" @change="setPolicy('require_same_version_date', $event.target.value)">
                        <option value="true">是</option><option value="false">否</option>
                      </select>
                    </label>
                  </div>
                </div>
              </div>
            </details>
          </template>
        </template>
      </template>

    </template>
  </AsyncView>

  <RuleForm
    :open="!!productForm"
    :title="productForm && productForm.creating ? '新增产品族' : '编辑产品族'"
    :error="formError"
    :saving="false"
    @close="productForm = null"
    @save="saveProduct"
    @remove="removeCurrentProduct"
  >
    <template v-if="productForm">
      <label class="field">产品族
        <select v-model="productForm.product_family">
          <option value="LOAN">LOAN</option><option value="BOND">BOND</option>
          <option value="INTERBANK">INTERBANK</option><option value="SFT">SFT</option>
          <option value="DERIVATIVE">DERIVATIVE</option><option value="EQUITY">EQUITY</option>
          <option value="OFF_BALANCE">OFF_BALANCE</option><option value="TREASURY">TREASURY</option>
          <option value="OTHER">OTHER</option>
        </select>
      </label>
      <label class="field">映射配置
        <input v-model="productForm.data_mapping_ref" type="text" />
      </label>
      <label class="field">映射版本
        <input v-model="productForm.data_mapping_version" type="text" />
      </label>
      <label class="field">暴露类型
        <select v-model="productForm.exposure_type">
          <option value="">不填</option><option value="ON_BALANCE">ON_BALANCE</option>
          <option value="OFF_BALANCE">OFF_BALANCE</option><option value="CCR">CCR</option>
          <option value="SETTLEMENT">SETTLEMENT</option><option value="MIXED">MIXED</option>
        </select>
      </label>
      <label class="field full">产品代码（一行一个）
        <textarea v-model="productForm.codesText" style="min-height: 160px"></textarea>
      </label>
      <label class="field full">备注
        <input v-model="productForm.note" type="text" />
      </label>
    </template>
  </RuleForm>

  <RuleForm
    :open="!!validationForm"
    :title="validationForm && validationForm.creating ? '新增校验规则' : '编辑校验规则'"
    :error="formError"
    :saving="false"
    @close="validationForm = null"
    @save="saveValidationRule"
    @remove="removeCurrentValidationRule"
  >
    <template v-if="validationForm">
      <label class="field">rule_id
        <input v-model="validationForm.rule_id" type="text" placeholder="V001" />
      </label>
      <label class="field">动作
        <select v-model="validationForm.action">
          <option value="fail">fail</option><option value="manual_review">manual_review</option>
          <option value="not_applicable">not_applicable</option><option value="default">default</option>
        </select>
      </label>
      <label class="field full">说明
        <input v-model="validationForm.description" type="text" />
      </label>
      <label class="field full">目标字段（逗号分隔）
        <input v-model="validationForm.target_field" type="text" />
      </label>
      <label class="field full">表达式
        <input v-model="validationForm.expression" type="text" />
      </label>
      <label class="field full">监管依据
        <input v-model="validationForm.regulatory_reference" type="text" />
      </label>
    </template>
  </RuleForm>
</template>
