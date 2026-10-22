<script setup>
import { nextTick, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { copyExposureTree, fetchExposureClass, fetchExposureClasses } from "@/api/exposure";
import { fetchClauses } from "@/api/rule";
import DecisionChart from "@/components/DecisionChart.vue";
import RuleDetail from "@/components/RuleDetail.vue";

const route = useRoute();
const router = useRouter();
const picked = ref(null);
const list = ref([]);
const current = ref("");
const doc = ref(null);
const clauses = ref([]);
const error = ref("");
const loading = ref(false);
const adding = ref(false);
const draft = ref("");
const addError = ref("");
const addBox = ref(null);
const changed = ref([]);
let seq = 0;

function nodeSign(node) {
  return JSON.stringify({
    label: node.label || "",
    when: node.when || null,
    value: typeof node.value === "number" ? node.value : null,
    weight: node.weight || null
  });
}

function signMap(document) {
  const map = {};
  const walk = (node) => {
    if (!node || typeof node !== "object" || !node.name) return;
    map[node.name] = nodeSign(node);
    (node.children || []).forEach(walk);
    if (node.otherwise) walk(node.otherwise);
  };
  ((document && document.rules) || []).forEach(walk);
  return map;
}

function changedNames(before, after) {
  const oldMap = signMap(before);
  const nextMap = signMap(after);
  return Object.keys(nextMap).filter((name) => oldMap[name] !== nextMap[name]);
}

async function show(name, rev) {
  const token = ++seq;
  error.value = "";
  try {
    if (rev || !list.value.length) {
      if (!doc.value) loading.value = true;
      list.value = (await fetchExposureClasses()) || [];
    }
    if (token !== seq) return;
    const item = name ? list.value.find((row) => row.name === name) : list.value[0];
    if (!item) throw new Error("没有这份分类 JSON");
    if (!rev && item.name === current.value && doc.value) return;
    current.value = item.name;
    loading.value = true;
    const pending = [fetchExposureClass(item.name)];
    if (!clauses.value.length) pending.push(fetchClauses().catch(() => []));
    const result = await Promise.all(pending);
    if (token !== seq) return;
    const nextDoc = result[0].document;
    changed.value = rev && doc.value ? changedNames(doc.value, nextDoc) : [];
    doc.value = nextDoc;
    if (result[1]) clauses.value = result[1];
  } catch (err) {
    if (token !== seq) return;
    if (!doc.value) error.value = err.message || "加载失败";
  } finally {
    if (token === seq) loading.value = false;
  }
}

function openTab(item, index) {
  if (item.name === current.value) return;
  picked.value = null;
  adding.value = false;
  router.push(index === 0 ? "/tree" : "/tree/" + item.name);
}

function beginAdd() {
  adding.value = true;
  draft.value = "";
  addError.value = "";
  nextTick(() => { if (addBox.value) addBox.value.focus(); });
}

async function commitAdd() {
  const label = draft.value.trim();
  if (!label || loading.value) return;
  addError.value = "";
  try {
    const saved = await copyExposureTree(label);
    adding.value = false;
    draft.value = "";
    picked.value = null;
    router.push({ path: "/tree/" + saved.name, query: { rev: String(Date.now()) } });
  } catch (err) {
    addError.value = err.message || "没有添加";
  }
}

function choose(payload) {
  picked.value = payload;
}

watch(() => (route.params.name || "") + "\n" + (route.query.rev || ""), () => {
  show(route.params.name || "", String(route.query.rev || ""));
}, { immediate: true });
</script>

<template>
  <div v-if="loading && !doc" class="loading"><span class="spin"></span>正在读取</div>
  <div v-else-if="error && !doc" class="notice danger">{{ error }}</div>
  <template v-else-if="doc">
    <div class="section-tabs" role="tablist">
      <button
        v-for="(item, index) in list"
        :key="item.name"
        type="button"
        class="section-tab"
        :class="{ active: current === item.name }"
        @click="openTab(item, index)"
>{{ item.label }}</button>
        <button v-if="!adding" type="button" class="section-tab" @click="beginAdd">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
          添加
        </button>
        <input
          v-else
          ref="addBox"
          v-model="draft"
          class="section-add"
          type="text"
          placeholder="页签名"
          @keydown.enter.prevent="commitAdd"
          @keydown.esc="adding = false"
        />
        <span v-if="addError" class="dim">{{ addError }}</span>
      </div>
    <div v-if="loading" class="loading"><span class="spin"></span>正在读取</div>
    <DecisionChart v-else :document="doc" :changed="changed" @select="choose" />
    <RuleDetail v-if="!loading"
      :node="picked && picked.node"
      :path="picked ? picked.path : ''"
      :index="picked ? picked.index : 0"
      :depth="picked ? picked.depth : 0"
      :fallback="!!(picked && picked.fallback)"
      :fields="doc.fields || []"
      :clauses="clauses"
      @close="picked = null"
      @open="choose"
    />
  </template>
</template>
