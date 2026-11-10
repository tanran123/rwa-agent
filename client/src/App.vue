<script setup>
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { NAV, menuPath } from "@/utils/nav";
import { auth, can, clearSession, refreshSession } from "@/utils/auth";
import { fetchSession, logoutSession } from "@/api/admin";
import { useContext } from "@/composables/useContext";
import SectionTabs from "@/components/SectionTabs.vue";
import VersionContext from "@/components/VersionContext.vue";
import AgentDock from "@/components/AgentDock.vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import { provideAgentForms } from "@/composables/useAgentForm";

const ICONS = {
  home: "M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z",
  config: "M7 3.5h7l4 4V20a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1zM14 3.5V8h4.5",
  class: "M5 7h14M5 12h14M5 17h9",
  ead: "M4 19h16M7 19V9M12 19V5M17 19v-6",
  crm: "M12 3.5 5.5 6.5v5c0 4.2 2.7 7.9 6.5 9.2 3.8-1.3 6.5-5 6.5-9.2v-5z",
  run: "M8 6.5v11l9-5.5z",
  system: "M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM12 3v2M12 19v2M4.2 7.5l1.7 1M18.1 15.5l1.7 1M4.2 16.5l1.7-1M18.1 8.5l1.7-1"
};

provideAgentForms();
const route = useRoute();
const router = useRouter();
const open = ref("");
const navShown = ref(false);
const { session, scopeVersion, loadBootstrap } = useContext();

const activePath = computed(() => menuPath(route.path));
const viewKey = computed(() => (route.meta.chart ? "tree" : route.path + "|" + session.jurisdiction + "|" + session.versionId + "|" + scopeVersion.value));
const isLogin = computed(() => route.path === "/login");
const user = computed(() => auth.user);

const visibleNav = computed(() =>
  NAV.map((group) => {
    if (group.path) return can(group.id) ? group : null;
    if (group.modules) {
      const modules = group.modules
        .map((module) => ({ ...module, items: (module.items || []).filter((item) => can(item.id)) }))
        .filter((module) => module.items.length);
      return modules.length ? { ...group, modules } : null;
    }
    const items = (group.items || []).filter((item) => can(item.id));
    return items.length ? { ...group, items } : null;
  }).filter(Boolean)
);

function moduleItems(group) {
  if (group.modules) return group.modules.flatMap((module) => module.items);
  return group.items || [];
}

async function boot() {
  loadBootstrap();
  if (!auth.user) return;
  try {
    const data = await fetchSession(auth.user.username);
    refreshSession(data);
  } catch (err) {
    if (/停用|不存在/.test(err.message || "")) {
      clearSession();
      router.replace("/login");
    }
  }
}

onMounted(boot);

watch(activePath, (path) => {
  const group = visibleNav.value.find((item) => moduleItems(item).some((child) => child.path === path));
  if (group) open.value = group.id;
}, { immediate: true });

function go(path) {
  navShown.value = false;
  router.push(path);
}
function toggle(id) {
  open.value = open.value === id ? "" : id;
}

async function logout() {
  try {
    await logoutSession({ username: user.value ? user.value.username : "" });
  } catch {
    // 退出以本地会话为准，日志写失败不挡住退出
  }
  clearSession();
  router.push("/login");
}
</script>

<template>
  <router-view v-if="isLogin" />
  <div v-else class="app-frame">
    <div v-if="navShown" class="side-mask" @click="navShown = false"></div>
    <aside class="side-nav" :class="{ shown: navShown }">
      <button type="button" class="side-brand" @click="go('/')">
        <span class="brand-mark">BR</span>
        <span class="brand-text">
          <strong>银行Bank return 计算工作平台</strong>
          <span>监管规则配置中心</span>
        </span>
      </button>
      <nav class="side-scroll" aria-label="页面">
        <template v-for="group in visibleNav" :key="group.id">
          <button
            v-if="group.path"
            type="button"
            class="side-link"
            :class="{ active: activePath === group.path }"
            @click="go(group.path)"
          >
            <svg class="side-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="ICONS[group.id]" /></svg>
            {{ group.label }}
          </button>
          <div v-else class="side-group">
            <button
              type="button"
              class="side-group-btn"
              :class="{ 'has-active': moduleItems(group).some((item) => item.path === activePath) }"
              @click="toggle(group.id)"
            >
              <svg class="side-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="ICONS[group.id]" /></svg>
              {{ group.label }}
              <span class="side-caret">{{ open === group.id ? "▴" : "▾" }}</span>
            </button>
            <div v-if="open === group.id" class="side-sub">
              <template v-if="group.modules">
                <template v-for="module in group.modules" :key="module.label">
                  <div v-if="module.label" class="side-module">{{ module.label }}</div>
                  <button
                    v-for="item in module.items"
                    :key="item.path"
                    type="button"
                    :class="{ active: activePath === item.path }"
                    @click="go(item.path)"
                  >{{ item.label }}</button>
                </template>
              </template>
              <template v-else>
                <button
                  v-for="item in group.items"
                  :key="item.path"
                  type="button"
                  :class="{ active: activePath === item.path }"
                  @click="go(item.path)"
                >{{ item.label }}</button>
              </template>
            </div>
          </div>
        </template>
      </nav>
      <div v-if="user" class="side-user">
        <span class="side-avatar">{{ user.name.slice(0, 1) }}</span>
        <div class="side-user-meta">
          <strong>{{ user.name }}</strong>
          <span>{{ user.roleName }}</span>
        </div>
        <button type="button" class="btn xs" @click="logout">退出</button>
      </div>
    </aside>
    <div class="app-main">
      <main class="main-col" :class="{ 'exp-full': route.meta.full, 'chart-page': route.meta.chart }">
        <header v-if="!route.meta.chart" class="page-head">
          <div>
            <button type="button" class="btn menu-toggle" @click="navShown = true">菜单</button>
            <div class="page-kicker">{{ route.meta.group }}</div>
            <h1>{{ route.meta.title }}</h1>
            <p v-if="route.meta.blurb">{{ route.meta.blurb }}</p>
          </div>
        </header>
        <SectionTabs />
        <AgentDock />
        <ConfirmDialog />
        <div id="auditBody">
          <VersionContext v-if="route.meta.versionContext" />
          <p v-if="session.error" class="notice danger">{{ session.error }}</p>
          <router-view :key="viewKey" />
        </div>
      </main>
    </div>
  </div>
</template>
