<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";
import { fetchExposureOverview } from "@/api/config";
import { useContext } from "@/composables/useContext";
import ExposureOverview from "@/components/ExposureOverview.vue";

const route = useRoute();
const router = useRouter();
const store = useStore();
const { session, currentVersion, scopeVersion, loadBootstrap } = useContext();
const pageLoading = ref(true);
const pageError = ref("");
const scopeNotice = ref("");
const docs = ref([]);
const classification = ref(null);
const weight = ref(null);
const tables = ref([]);
const lists = ref([]);

const jurisdiction = computed(() => session.jurisdiction || "");
const version = computed(() => scopeVersion.value);
const readonly = computed(() => currentVersion.value && currentVersion.value.status === "published");

function applyScope() {
  const queryJurisdiction = String(route.query.jurisdiction || "");
  const hasVersionParam = Object.prototype.hasOwnProperty.call(route.query, "version");
  const queryVersion = String(route.query.version || "").trim();
  if (!queryJurisdiction && !hasVersionParam) return "";
  if (hasVersionParam && !queryVersion) {
    const actual = (queryJurisdiction
      ? (session.versions || []).find((item) => item.jurisdiction === queryJurisdiction && item.id === session.versionId)
        || (session.versions || []).find((item) => item.jurisdiction === queryJurisdiction && item.status === "published")
        || (session.versions || []).find((item) => item.jurisdiction === queryJurisdiction)
      : currentVersion.value);
    if (!actual) {
      const err = new Error("未指定版本号，且当前没有可用的监管规则版本");
      err.hideContext = true;
      throw err;
    }
    session.jurisdiction = actual.jurisdiction;
    session.versionId = actual.id;
    const nextQuery = { ...route.query, jurisdiction: actual.jurisdiction, version: actual.version };
    router.replace({ query: nextQuery });
    return "未指定版本号，已使用当前版本 " + actual.version;
  }
  if (queryJurisdiction && !queryVersion) {
    const actual = (session.versions || []).find((item) => item.jurisdiction === queryJurisdiction && item.id === session.versionId)
      || (session.versions || []).find((item) => item.jurisdiction === queryJurisdiction && item.status === "published")
      || (session.versions || []).find((item) => item.jurisdiction === queryJurisdiction);
    if (!actual) {
      const err = new Error("司法管辖区 " + queryJurisdiction + " 没有可用的监管规则版本，请返回版本列表重新选择");
      err.hideContext = true;
      throw err;
    }
    session.jurisdiction = queryJurisdiction;
    session.versionId = actual.id;
    router.replace({ query: { ...route.query, jurisdiction: actual.jurisdiction, version: actual.version } });
    return "未指定版本号，已使用当前版本 " + actual.version;
  }
  const target = (session.versions || []).find(
    (item) => item.jurisdiction === queryJurisdiction && item.version === queryVersion
  );
  if (target) {
    session.jurisdiction = queryJurisdiction;
    session.versionId = target.id;
    return "";
  }
  if (queryJurisdiction && !(session.versions || []).some((item) => item.jurisdiction === queryJurisdiction)) {
    const err = new Error("司法管辖区 " + queryJurisdiction + " 不存在，请返回版本列表重新选择");
    err.hideContext = true;
    throw err;
  }
  const actual = currentVersion.value;
  if (!actual) throw new Error("指定版本不存在，且当前没有可用的监管规则版本");
  session.jurisdiction = actual.jurisdiction;
  session.versionId = actual.id;
  const message = "指定版本 " + (queryVersion || "（空）") + " 不存在，已切换到 " + actual.version;
  router.replace({
    query: { ...route.query, jurisdiction: actual.jurisdiction, version: actual.version }
  });
  return message;
}

async function load() {
  pageLoading.value = true;
  pageError.value = "";
  scopeNotice.value = "";
  store.commit("setVersionContextHidden", false);
  try {
    if (!session.ready) await loadBootstrap();
    scopeNotice.value = applyScope();
    const overview = await fetchExposureOverview({
      jurisdiction: jurisdiction.value,
      version: version.value
    });
    docs.value = overview.docs || [];
    tables.value = overview.tables || [];
    lists.value = overview.lists || [];
    classification.value = overview.classification || null;
    weight.value = overview.weight || null;
  } catch (err) {
    pageError.value = err.message || "加载规则全景失败";
    store.commit("setVersionContextHidden", !!err.hideContext);
  } finally {
    pageLoading.value = false;
  }
}

onMounted(load);
onBeforeUnmount(() => {
  store.commit("setVersionContextHidden", false);
});
</script>

<template>
  <div class="xp-page">
    <div v-if="pageLoading" class="loading"><span class="spin"></span>正在读取规则全景</div>
    <div v-else-if="pageError" class="notice danger">{{ pageError }}</div>
    <template v-else>
      <p v-if="scopeNotice" class="notice warn">{{ scopeNotice }}</p>
      <ExposureOverview
        :classification="classification"
        :weight="weight"
        :tables="tables"
        :lists="lists"
        :docs="docs"
        :jurisdiction="jurisdiction"
        :version="version"
        :readonly="readonly"
        @reload="load"
      />
    </template>
  </div>
</template>
