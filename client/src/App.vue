<script setup>
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { NAV, menuPath } from "@/utils/nav";
import { useContext } from "@/composables/useContext";
import SectionTabs from "@/components/SectionTabs.vue";
import AgentDock from "@/components/AgentDock.vue";

const route = useRoute();
const router = useRouter();
const open = ref("");
const { session, versionOptions, setOrg, setJurisdiction, loadBootstrap } = useContext();

const STATUS = { draft: "草稿", reviewing: "审核中", published: "已发布", superseded: "已被取代", disabled: "已停用" };
const activePath = computed(() => menuPath(route.path));

function versionText(item) {
  const extra = item.status && item.status !== "published" ? "（" + (STATUS[item.status] || item.status) + "）" : "";
  return item.version + extra;
}

onMounted(loadBootstrap);

function go(path) {
  open.value = "";
  router.push(path);
}
</script>

<template>
  <div class="app-shell-top">
    <header class="app-top">
      <div class="brand">
        <span class="brand-mark">CR</span>
        <div class="brand-text">
          <strong>信用风险 RWA</strong>
          <span>监管规则配置中心</span>
        </div>
      </div>
      <div class="app-top-right">
        <nav class="top-nav" aria-label="页面">
          <template v-for="group in NAV" :key="group.id">
            <button
              v-if="group.path"
              type="button"
              :class="{ active: activePath === group.path }"
              @click="go(group.path)"
            >{{ group.label }}</button>
            <div
              v-else
              class="nav-group"
              :class="{ open: open === group.id, 'has-active': group.items.some((item) => item.path === activePath) }"
            >
              <button type="button" class="nav-group-btn" @click="open = open === group.id ? '' : group.id">
                {{ group.label }}<span class="caret">{{ open === group.id ? "▴" : "▾" }}</span>
              </button>
              <div class="nav-menu" role="menu">
                <button
                  v-for="(item, index) in group.items"
                  :key="item.path"
                  type="button"
                  :class="{ active: activePath === item.path }"
                  @click="go(item.path)"
                >
                  <span class="nav-no">{{ index + 1 }}</span>{{ item.label }}
                </button>
              </div>
            </div>
          </template>
        </nav>
        <div class="client-switch">
          <label>客户</label>
          <select v-model="session.customerId" aria-label="当前客户">
            <option v-for="item in session.customers" :key="item.id" :value="item.id">{{ item.name }}（{{ item.code }}）</option>
          </select>
        </div>
      </div>
    </header>
    <div class="audit-ctx-bar">
      <div class="client-switch">
        <label>机构</label>
        <select :value="session.orgId" aria-label="机构" @change="setOrg($event.target.value)">
          <option v-for="item in session.orgs" :key="item.id" :value="item.id">{{ item.name }}</option>
        </select>
      </div>
      <div class="client-switch">
        <label>地区</label>
        <select :value="session.jurisdiction" aria-label="地区" @change="setJurisdiction($event.target.value)">
          <option v-for="item in session.jurisdictions" :key="item.code" :value="item.code">{{ item.label }}</option>
        </select>
      </div>
      <div class="client-switch">
        <label>版本</label>
        <select v-model="session.versionId" aria-label="版本">
          <option v-for="item in versionOptions" :key="item.id" :value="item.id">{{ versionText(item) }}</option>
        </select>
      </div>
      <div class="client-switch">
        <label>基准日</label>
        <span class="ctx-date">{{ session.baseDate }}</span>
      </div>
      <button type="button" class="btn btn-primary" @click="go('/wizard')">发起计量</button>
    </div>
  </div>
  <main class="main-col" :class="{ 'exp-full': route.meta.full }">
    <header class="page-head">
      <div>
        <div class="page-kicker">{{ route.meta.group }}</div>
        <h1>{{ route.meta.title }}</h1>
        <p v-if="route.meta.blurb">{{ route.meta.blurb }}</p>
      </div>
    </header>
    <SectionTabs />
    <AgentDock />
    <div id="auditBody">
      <p v-if="session.error" class="notice danger">{{ session.error }}先执行 sql 目录里的两个脚本，再启动 Koa。</p>
      <router-view :key="route.path" />
    </div>
  </main>
</template>
