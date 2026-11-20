<script setup>
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useContext } from "@/composables/useContext";

const route = useRoute();
const router = useRouter();
const { session, currentVersion } = useContext();

const onWorkbench = computed(() =>
  route.name === "version-workbench" || route.name === "version-new-workbench"
);

const workbenchPath = computed(() => {
  const queryVersion = String(route.query.version || "");
  if (queryVersion) {
    const code = String(route.query.jurisdiction || session.jurisdiction || "");
    const hit = session.versions.find((item) => item.version === queryVersion && (!code || item.jurisdiction === code));
    if (hit) return "/versions/" + hit.id + "/workbench";
  }
  const version = currentVersion.value;
  return version ? "/versions/" + version.id + "/workbench" : "/versions";
});

const trail = computed(() => {
  const items = [];
  if (route.meta.group === "任务运行") {
    items.push({ label: "任务工作台", path: "/tasks" });
    const taskId = String(route.query.task || "");
    if (taskId) items.push({ label: "任务详情工作台", path: "/tasks/" + taskId });
  } else {
    items.push({ label: "监管规则配置管理", path: "/versions" });
    if (!onWorkbench.value) items.push({ label: "监管规则维护工作台", path: workbenchPath.value });
  }
  if (route.meta.title) items.push({ label: route.meta.title, current: true });
  return items;
});

function open(item) {
  if (item.current) return;
  router.push(item.path);
}
</script>

<template>
  <nav class="page-path" aria-label="页面路径">
    <template v-for="(item, idx) in trail" :key="item.label + idx">
      <span v-if="idx" class="page-path-sep">/</span>
      <span v-if="item.current" class="page-path-now" aria-current="page">{{ item.label }}</span>
      <button v-else type="button" class="page-path-link" @click="open(item)">{{ item.label }}</button>
    </template>
  </nav>
</template>

<style scoped>
.page-path {
  flex: 0 0 auto;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin: 0 0 10px;
  font-size: 12px;
  line-height: 1.4;
  color: var(--muted);
}
.page-path-sep {
  color: #cbd5e1;
}
.page-path-link {
  padding: 0;
  border: 0;
  background: transparent;
  font: inherit;
  color: var(--accent);
  cursor: pointer;
}
.page-path-link:hover {
  text-decoration: underline;
}
.page-path-now {
  color: #1e293b;
  font-weight: 600;
}
</style>
