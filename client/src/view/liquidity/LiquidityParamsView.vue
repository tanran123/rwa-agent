<script setup>
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { fetchLiquidityMeta, fetchLiquidityParams } from "@/api/liquidity";
import { useContext } from "@/composables/useContext";

const route = useRoute();
const router = useRouter();
const { session, scopeVersion } = useContext();
const loading = ref(true);
const error = ref("");
const data = ref({ params: [], tables: [], lists: [], meta: null });
const tab = ref("params");

const jurisdiction = computed(() => String(route.query.jurisdiction || session.jurisdiction || "HK"));
const version = computed(() => String(route.query.version || scopeVersion.value || ""));

async function load() {
  loading.value = true;
  error.value = "";
  try {
    if (route.query.jurisdiction && route.query.version) {
      const target = (session.versions || []).find(
        (item) => item.jurisdiction === jurisdiction.value && item.version === version.value
      );
      if (target) {
        session.jurisdiction = target.jurisdiction;
        session.versionId = target.id;
      }
    }
    const [params, meta] = await Promise.all([
      fetchLiquidityParams(jurisdiction.value, version.value),
      fetchLiquidityMeta(jurisdiction.value, version.value).catch(() => null)
    ]);
    data.value = { ...params, meta: params.meta || (meta ? meta.meta : null) };
  } catch (err) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<template>
  <p v-if="error" class="notice danger">{{ error }}</p>

  <div class="lq-hero">
    <div>
      <h2>清单与参数</h2>
      <p>
        跨产品共享配置：名单独立版本化、参数与系数表统一维护；入口在流动性产品管理之外，不隶属单一产品。
        当前版本 <b>{{ data.version || scopeVersion }}</b>
        <span v-if="data.meta"> · LCR 规则集 {{ data.meta.lcrVersion || "—" }}</span>
      </p>
    </div>
    <div class="lq-hero-actions">
      <button type="button" class="btn sm" @click="router.push('/liquidity-config')">返回产品管理</button>
    </div>
  </div>

  <div v-if="loading" class="empty">正在读取清单与参数…</div>

  <template v-else>
    <div class="lq-tabs">
      <button type="button" :class="{ on: tab === 'params' }" @click="tab = 'params'">参数表</button>
      <button type="button" :class="{ on: tab === 'tables' }" @click="tab = 'tables'">系数表</button>
      <button type="button" :class="{ on: tab === 'lists' }" @click="tab = 'lists'">名单中心</button>
    </div>

    <div v-if="tab === 'params'" class="panel">
      <div class="panel-head"><h3>参数</h3><span class="sub">{{ data.params.length }} 个 · 规则集通过参数 ID 引用</span></div>
      <div class="panel-body tight">
        <table class="tbl">
          <thead><tr><th>参数 ID</th><th>名称</th><th class="num">值</th><th>单位</th><th>依据</th></tr></thead>
          <tbody>
            <tr v-for="param in data.params" :key="param.id">
              <td class="mono small">{{ param.id }}</td>
              <td>{{ param.name }}</td>
              <td class="num mono">{{ param.value }}</td>
              <td class="small">{{ param.unit }}</td>
              <td class="small dim">{{ param.basis }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <template v-else-if="tab === 'tables'">
      <div v-for="table in data.tables" :key="table.id" class="panel">
        <div class="panel-head">
          <h3>{{ table.title }}</h3>
          <span class="sub mono">{{ table.id }} · {{ table.rows.length }} 行</span>
        </div>
        <div class="panel-body tight">
          <table class="tbl">
            <thead>
              <tr>
                <th v-for="column in Object.keys(table.rows[0] || {})" :key="column">{{ column }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, index) in table.rows" :key="index">
                <td v-for="column in Object.keys(table.rows[0] || {})" :key="column" :class="{ 'mono small': typeof row[column] === 'number' }">
                  {{ row[column] }}
                </td>
              </tr>
            </tbody>
          </table>
          <p class="dim" style="font-size: 11.5px; padding: 8px 10px 0">{{ table.note }}</p>
        </div>
      </div>
    </template>

    <template v-else>
      <div v-for="list in data.lists" :key="list.id" class="panel">
        <div class="panel-head">
          <h3>{{ list.title }}</h3>
          <span class="sub mono">{{ list.id }} · {{ list.version }} · {{ list.items.length }} 项</span>
        </div>
        <div class="panel-body tight">
          <table class="tbl">
            <thead>
              <tr>
                <th v-for="column in Object.keys(list.items[0] || {})" :key="column">{{ column }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(item, index) in list.items" :key="index">
                <td v-for="column in Object.keys(list.items[0] || {})" :key="column" :class="{ 'mono small': column !== 'name' }">
                  {{ item[column] }}
                </td>
              </tr>
            </tbody>
          </table>
          <p class="dim" style="font-size: 11.5px; padding: 8px 10px 0">{{ list.note }}</p>
        </div>
      </div>
    </template>
  </template>
</template>

<style scoped>
.lq-hero { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 14px; }
.lq-hero h2 { margin: 0 0 4px; font-size: 18px; }
.lq-hero p { margin: 0; color: var(--muted); font-size: 12.5px; max-width: 800px; }
.lq-hero-actions { display: flex; gap: 8px; }
.lq-tabs { display: flex; gap: 6px; align-items: center; margin-bottom: 12px; flex-wrap: wrap; }
.lq-tabs button { border: 1px solid var(--line); background: #fff; border-radius: 999px; padding: 5px 12px; font-size: 12px; color: #475569; }
.lq-tabs button.on { background: #eef2ff; border-color: #a5b4fc; color: #3730a3; font-weight: 600; }
</style>
