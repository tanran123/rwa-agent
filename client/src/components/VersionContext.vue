<script setup>
import { computed, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useContext } from "@/composables/useContext";
import { CAPITAL_LINKS, LIQUIDITY_LINKS, ruleLinkActive } from "@/utils/ruleLinks";
import { configStatusLabel } from "@/utils/versionText";

const props = defineProps({
  version: { type: Object, default: null },
  nav: { type: Boolean, default: true },
  workbench: { type: Boolean, default: false },
  editable: { type: Boolean, default: false },
  completeness: { type: Number, default: null }
});

defineEmits(["edit"]);

const route = useRoute();
const router = useRouter();
const { session, currentVersion } = useContext();
const detailOpen = ref(false);

const labels = { draft: "草稿", published: "已发布", superseded: "已被取代", disabled: "已停用" };
const tones = { draft: "muted", published: "ok", superseded: "muted", disabled: "danger" };

const shown = computed(() => props.version || currentVersion.value);

function openWorkbench() {
  if (!shown.value) return;
  router.push({ name: "version-workbench", params: { id: shown.value.id } });
}

function go(path) {
  if (!shown.value) return;
  session.jurisdiction = shown.value.jurisdiction;
  session.versionId = shown.value.id;
  router.push(path);
}

function active(path) {
  return ruleLinkActive(route.path, path);
}
</script>

<template>
  <template v-if="shown">
    <div class="panel vc-panel">
      <div class="vc-bar">
        <div class="vc-title">
          <h3>版本信息</h3>
          <span class="sub">{{ shown.id }}</span>
        </div>
        <div class="vc-summary">
          <div class="vc-item vc-version">
            <span>版本编号</span>
            <b class="mono">{{ shown.version }}</b>
          </div>
          <div class="vc-item vc-name">
            <span>规则名称</span>
            <b :title="shown.name">{{ shown.name }}</b>
          </div>
          <div class="vc-item">
            <span>状态</span>
            <b><span class="tag" :class="tones[shown.status]">{{ labels[shown.status] || shown.status }}</span></b>
          </div>
          <div class="vc-item">
            <span>适用机构</span>
            <b>{{ shown.institution || "未指定" }}</b>
          </div>
          <div class="vc-item vc-meta">
            <span>配置状态</span>
            <b>{{ configStatusLabel(shown.configStatus) }}</b>
          </div>
          <div v-if="completeness != null" class="vc-item vc-meta">
            <span>完整度</span>
            <b>{{ completeness }}%</b>
          </div>
        </div>
        <div class="vc-actions">
          <button type="button" class="btn sm" @click="detailOpen = !detailOpen">
            {{ detailOpen ? "收起详细 ▴" : "展开详细 ▾" }}
          </button>
          <button v-if="editable" type="button" class="btn sm primary" @click="$emit('edit')">编辑版本信息</button>
          <button v-if="!workbench" type="button" class="btn sm" @click="openWorkbench">维护工作台</button>
          <button type="button" class="btn sm" @click="router.push('/versions')">返回版本列表</button>
        </div>
      </div>
      <div v-if="detailOpen" class="vc-detail">
          <div class="grid c4">
          <div class="field">
            <label>司法管辖区</label>
            <div>{{ (session.jurisdictions.find((item) => item.code === shown.jurisdiction) || {}).label || shown.jurisdiction }}</div>
          </div>
          <div class="field">
            <label>生效日期</label>
            <div>{{ shown.effectiveFrom || "—" }}{{ shown.effectiveTo ? " 至 " + shown.effectiveTo : " 起" }}</div>
          </div>
          <div class="field">
            <label>规则文件</label>
            <div class="mono">{{ shown.rulesetFile || "—" }}</div>
          </div>
          <div class="field">
            <label>维护人</label>
            <div>{{ shown.author || "—" }}</div>
          </div>
          <div class="field">
            <label>发布时间</label>
            <div>{{ shown.publishedAt || "—" }}</div>
          </div>
          <div class="field">
            <label>变更说明</label>
            <div>{{ shown.changelog || "—" }}</div>
          </div>
          </div>
        </div>
    </div>

    <div v-if="nav" class="version-nav">
      <span class="vn-label">资本充足率</span>
      <button
        v-for="link in CAPITAL_LINKS"
        :key="link.path"
        type="button"
        :class="{ active: active(link.path) }"
        @click="go(link.path)"
      >{{ link.label }}</button>
      <span class="vn-label">流动性</span>
      <button
        v-for="link in LIQUIDITY_LINKS"
        :key="link.path"
        type="button"
        :class="{ active: active(link.path) }"
        @click="go(link.path)"
      >{{ link.label }}</button>
    </div>
  </template>
</template>


<style scoped>
.vc-panel {
  margin-bottom: 8px;
  padding: 5px 10px;
  overflow: visible;
}
.vc-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.vc-title {
  display: flex;
  align-items: baseline;
  gap: 6px;
  flex: 0 0 auto;
}
.vc-title h3 {
  margin: 0;
  font-size: 12px;
  line-height: 1.2;
}
.vc-title .sub {
  color: var(--muted);
  font-size: 9.5px;
}
.vc-summary {
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
  gap: 3px 13px;
  overflow: hidden;
}
.vc-item {
  display: flex;
  align-items: baseline;
  gap: 3px;
  min-width: 0;
  flex: 0 0 auto;
}
.vc-item > span {
  color: var(--muted);
  font-size: 9.5px;
  line-height: 1.2;
  white-space: nowrap;
}
.vc-item > b {
  color: #1e293b;
  font-size: 11.5px;
  font-weight: 500;
  line-height: 1.25;
  white-space: nowrap;
}
#auditBody .vc-version > b { font-size: 11.5px; }
.vc-name {
  flex: 0 1 320px;
  min-width: 100px;
}
.vc-name > b {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
}
.vc-meta > b {
  color: #475569;
  font-size: 11px;
}
.vc-actions {
  display: flex;
  align-items: center;
  gap: 5px;
  flex: 0 0 auto;
}
.vc-actions .btn {
  height: 26px;
  padding: 0 8px;
  font-size: 10.5px;
}
.vc-detail {
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px solid var(--border);
}
.vc-detail .field label {
  font-size: 10px;
}
#auditBody .vc-detail .field > div {
  font-size: 11.5px;
}
@media (max-width: 1200px) {
  .vc-bar { flex-wrap: wrap; }
  .vc-summary { flex: 1 1 100%; flex-wrap: wrap; order: 3; }
  .vc-actions { margin-left: auto; }
}
</style>
