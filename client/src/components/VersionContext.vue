<script setup>
import { computed, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useContext } from "@/composables/useContext";
import { CAPITAL_LINKS, LIQUIDITY_LINKS, ruleLinkActive } from "@/utils/ruleLinks";

const props = defineProps({
  version: { type: Object, default: null },
  nav: { type: Boolean, default: true },
  workbench: { type: Boolean, default: false }
});

const route = useRoute();
const router = useRouter();
const { session, currentVersion } = useContext();
const detailOpen = ref(false);

const labels = { draft: "草稿", reviewing: "审核中", published: "已发布", superseded: "已被取代", disabled: "已停用" };
const tones = { draft: "muted", reviewing: "warn", published: "ok", superseded: "muted", disabled: "danger" };

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
    <div class="panel">
      <div class="panel-head">
        <h3>版本信息</h3>
        <span class="sub">{{ shown.id }}</span>
        <span class="spacer"></span>
        <button type="button" class="btn sm" @click="detailOpen = !detailOpen">
          {{ detailOpen ? "收起详细 ▴" : "展开详细 ▾" }}
        </button>
        <button v-if="!workbench" type="button" class="btn sm" @click="openWorkbench">维护工作台</button>
        <button type="button" class="btn sm" @click="router.push('/versions')">返回版本列表</button>
      </div>
      <div class="panel-body">
        <div class="grid c4">
          <div class="field">
            <label>版本编号</label>
            <div class="mono">{{ shown.version }}</div>
          </div>
          <div class="field">
            <label>规则名称</label>
            <div>{{ shown.name }}</div>
          </div>
          <div class="field">
            <label>状态</label>
            <div><span class="tag" :class="tones[shown.status]">{{ labels[shown.status] || shown.status }}</span></div>
          </div>
          <div class="field">
            <label>适用机构</label>
            <div>{{ shown.institution || "未指定" }}</div>
          </div>
        </div>
        <div
          v-if="detailOpen"
          class="grid c4"
          style="margin-top: 14px; padding-top: 14px; border-top: 1px solid var(--border)"
        >
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
