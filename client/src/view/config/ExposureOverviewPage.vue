<script setup>
import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import {
  fetchParameterTables, fetchReferenceLists, fetchRuleDocument, fetchRuleDocuments, importRuleDocuments, previewRuleDocumentsImport
} from "@/api/config";
import { useContext } from "@/composables/useContext";
import ExposureOverview from "@/components/ExposureOverview.vue";
import { askConfirm } from "@/utils/confirm";

const route = useRoute();
const { session, scopeVersion, loadBootstrap } = useContext();
const loading = ref(true);
const error = ref("");
const docs = ref([]);
const classification = ref(null);
const weight = ref(null);
const tables = ref([]);
const lists = ref([]);

const jurisdiction = computed(() => session.jurisdiction || "");
const version = computed(() => scopeVersion.value);

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
    const [docRows, tableRows, listRows] = await Promise.all([
      fetchRuleDocuments({ jurisdiction: jurisdiction.value, version: version.value }),
      fetchParameterTables(jurisdiction.value, version.value),
      fetchReferenceLists(jurisdiction.value, version.value)
    ]);
    docs.value = docRows;
    tables.value = tableRows;
    lists.value = listRows;
    const classMeta = docRows.find((item) => item.kind === "exposure_classification");
    const weightMeta = docRows.find((item) => item.kind === "risk_weight");
    const [classDoc, weightDoc] = await Promise.all([
      classMeta ? fetchRuleDocument(classMeta.id) : Promise.resolve(null),
      weightMeta ? fetchRuleDocument(weightMeta.id) : Promise.resolve(null)
    ]);
    classification.value = classDoc ? classDoc.body : null;
    weight.value = weightDoc ? weightDoc.body : null;
  } catch (err) {
    error.value = err.message || "加载规则全景失败";
  } finally {
    loading.value = false;
  }
}

async function importDocs() {
  loading.value = true;
  error.value = "";
  try {
    const preview = await previewRuleDocumentsImport({ jurisdiction: jurisdiction.value || "HK", version: version.value });
    const docs = preview.documentChanges || {};
    const text = [
      "把 docs/信用风险规则/ 下的香港 STC 规则集、参数表和名单导入当前版本。",
      "文档：新增 " + (docs.added || 0) + "、更新 " + (docs.updated || 0) + "、不变 " + (docs.same || 0) + "。",
      "参数表：新增 " + (preview.parameterTables.added || 0) + "、更新 " + (preview.parameterTables.updated || 0) + "。",
      "名单：新增 " + (preview.referenceLists.added || 0) + "、更新 " + (preview.referenceLists.updated || 0) + "。",
      "导入前会自动生成一份配置快照，同名文档会被覆盖。"
    ].join("\n");
    const yes = await askConfirm(text, { title: "导入预览", confirmText: "确认导入" });
    if (!yes) { loading.value = false; return; }
    await importRuleDocuments({ jurisdiction: jurisdiction.value || "HK", version: version.value });
    await load();
  } catch (err) {
    error.value = err.message || "导入失败";
    loading.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="xp-page">
    <div v-if="loading" class="loading"><span class="spin"></span>正在读取规则全景</div>
    <div v-else-if="error" class="notice danger">{{ error }}</div>
    <ExposureOverview
      v-else
      :classification="classification"
      :weight="weight"
      :tables="tables"
      :lists="lists"
      :docs="docs"
      :jurisdiction="jurisdiction"
      :version="version"
      @import="importDocs"
      @reload="load"
    />
  </div>
</template>
