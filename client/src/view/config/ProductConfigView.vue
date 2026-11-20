<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  fetchRuleDocument, fetchRuleDocuments, saveRuleDocument, validateRuleBody
} from "@/api/config";
import { onBeforeRouteLeave, useRoute, useRouter } from "vue-router";
import { useContext } from "@/composables/useContext";
import AsyncView from "@/components/AsyncView.vue";
import ProductWizard from "@/components/ProductWizard.vue";
import JsonDocEditor from "@/components/JsonDocEditor.vue";
import { askConfirm } from "@/utils/confirm";
import {
  familyMeta, mappingTargetSet, matchedRuleCount, productStatus, STATUS_META, uniqueSources
} from "@/utils/productCatalog";

const { session, scopeVersion, currentVersion } = useContext();
const route = useRoute();
const router = useRouter();
const view = ref(null);
const docs = ref([]);
const notice = ref({ text: "", kind: "" });
const registry = ref(null);
const saving = ref(false);
const jsonMode = ref(false);
const validation = ref(null);
const savedBody = ref("");
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
const viewMode = ref("list");
const pageSize = ref(10);
const page = ref(1);
const cardMenu = ref(-1);

const jurisdiction = computed(() => String(route.query.jurisdiction || session.jurisdiction || "").toUpperCase());
const version = computed(() => String(route.query.version || scopeVersion.value || ""));
const versionMeta = computed(() => {
  const hit = session.versions.find((item) => item.jurisdiction === jurisdiction.value && item.version === version.value);
  return hit || currentVersion.value || null;
});
const readOnly = computed(() => !!versionMeta.value && versionMeta.value.status === "published");
const registryBody = computed(() => (registry.value ? registry.value.body : {}));
const dirty = computed(() => (registry.value ? JSON.stringify(registryBody.value) !== savedBody.value : false));

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

function openWizardCopy(row, index) {
  wizard.value = {
    initial: {
      index: -1,
      copy: true,
      mapping: Object.assign({}, row.entry || row, { product_codes: [] })
    }
  };
}

async function removeProductGroup(index) {
  if (readOnly.value) return;
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
    savedBody.value = JSON.stringify(saved.body);
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

async function onWizardSaved() {
  wizard.value = null;
  await loadAll();
}

async function loadAll() {
  if (route.query.jurisdiction && route.query.version) {
    const target = session.versions.find(
      (item) => item.jurisdiction === String(route.query.jurisdiction).toUpperCase() && item.version === String(route.query.version)
    );
    if (target) {
      session.jurisdiction = target.jurisdiction;
      session.versionId = target.id;
    }
  }
  const rows = await fetchRuleDocuments({ jurisdiction: jurisdiction.value, version: version.value });
  docs.value = rows;
  const registryMeta = rows.find((item) => item.kind === "product_registry");
  registry.value = registryMeta ? await fetchRuleDocument(registryMeta.id) : null;
  savedBody.value = registry.value ? JSON.stringify(registry.value.body) : "";
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

async function saveRegistry(nextBody) {
  if (!registry.value || readOnly.value) return;
  await saveDoc(registry.value, nextBody);
}

async function saveDoc(doc, nextBody) {
  if (nextBody) doc.body = nextBody;
  if (JSON.stringify(doc.body) === savedBody.value) {
    say("没有需要保存的修改。", "info");
    return;
  }
  saving.value = true;
  validation.value = null;
  try {
    const saved = await saveRuleDocument(doc.id, { body: doc.body });
    registry.value = saved;
    savedBody.value = JSON.stringify(saved.body);
    await refreshDocs();
    say("已保存 " + saved.name, "ok");
  } catch (err) {
    say(err.message, "danger");
  } finally {
    saving.value = false;
  }
}

async function validateCurrent() {
  const doc = registry.value;
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

watch([() => route.query.jurisdiction, () => route.query.version], async () => {
  if (view.value) await view.value.reload();
});

function warnBeforeUnload(event) {
  if (!dirty.value) return;
  event.preventDefault();
  event.returnValue = "";
}

onMounted(() => window.addEventListener("beforeunload", warnBeforeUnload));
onBeforeUnmount(() => window.removeEventListener("beforeunload", warnBeforeUnload));

onBeforeRouteLeave(async () => {
  if (!dirty.value) return true;
  return await askConfirm("产品配置还有未保存的修改，离开后会丢失。", {
    title: "未保存的修改",
    confirmText: "离开",
    danger: true
  });
});
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

  <div v-if="registry" class="section-tabs" style="margin-bottom: 12px">
    <button type="button" class="section-tab active" @click="jsonMode = false">产品管理</button>
    <span class="spacer"></span>
    <span v-if="readOnly" class="tag warn">已发布 · 只读</span>
    <button type="button" class="btn sm" @click="jsonMode = !jsonMode">{{ jsonMode ? "结构化编辑" : "JSON 原文" }}</button>
    <button type="button" class="btn sm" :disabled="saving" @click="validateCurrent">校验</button>
    <button
      type="button"
      class="btn sm primary"
      :disabled="saving || jsonMode || readOnly || !dirty"
      @click="saveRegistry()"
    >保存</button>
  </div>

  <p v-if="notice.text" class="notice" :class="notice.kind">{{ notice.text }}</p>
  <p v-if="readOnly" class="notice warn">当前版本已发布，产品配置只读；要修改请先到监管规则维护工作台撤回发布。</p>

  <AsyncView ref="view" :load="loadAll">
    <template #default>
      <div v-if="validation && validation.errors.length" class="notice danger">
        <strong>校验发现 {{ validation.errors.length }} 处问题</strong>
        <div v-for="(item, index) in validation.errors" :key="index" class="mono" style="font-size: 12px; margin-top: 4px">{{ item }}</div>
      </div>
      <p v-else-if="validation" class="notice ok">校验通过。</p>

      <div v-if="!registry" class="notice warn">
        这一版还没有产品注册和字段映射，本页没有可编辑的内容。产品规则文档按监管版本单独维护；切换左上角的监管版本可以查看其它版本的产品组。
      </div>
      <template v-else>
          <JsonDocEditor
            v-if="jsonMode"
            :body="registryBody"
            kind="product_registry"
            :jurisdiction="jurisdiction"
            :saving="saving"
            :read-only="readOnly"
            @update:body="registry.body = $event"
            @save="saveRegistry($event)"
            @notify="say($event, 'info')"
          />
          <template v-else>
            <div class="pr-hero">
              <div>
                <h2>产品管理 <span class="pr-total">{{ filteredCards.length }} / {{ productCards.length }}</span></h2>
                <p class="pr-stats-line">
                  全部产品 {{ productCards.length }} 个 · 已注册 {{ cardSummary.registered }} ·
                  配置中 {{ cardSummary.configuring }} · 配置异常 {{ cardSummary.error }} ·
                  Mapping 平均完成率 {{ cardSummary.mappingAvg }}% · 当前第 {{ page }}/{{ pageCount }} 页
                </p>
              </div>
              <span class="spacer"></span>
              <button type="button" class="btn primary" :disabled="readOnly" @click="openWizardNew">＋ 新建产品</button>
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
              <button type="button" class="btn primary" :disabled="readOnly" @click="openWizardNew">立即注册产品</button>
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
                  role="button"
                  tabindex="0"
                  @click="openWorkbench(card, 'info')"
                  @keydown.enter.self.prevent="openWorkbench(card, 'info')"
                  @keydown.space.self.prevent="openWorkbench(card, 'info')"
                >
                  <header class="pr-card-head">
                    <h3 :title="card.name">{{ card.name }}</h3>
                    <span class="pr-family-tag">{{ card.family }}</span>
                    <span class="pr-status" :class="card.statusKey">{{ card.status }}</span>
                    <div v-if="!readOnly" class="pr-more" @click.stop>
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
                    <tr
                      v-for="card in pagedCards"
                      :key="card.index + '_row'"
                      role="button"
                      tabindex="0"
                      @click="openWorkbench(card, 'info')"
                      @keydown.enter.self.prevent="openWorkbench(card, 'info')"
                      @keydown.space.self.prevent="openWorkbench(card, 'info')"
                    >
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

      </template>
    </template>
    </template>
  </AsyncView>

</template>
