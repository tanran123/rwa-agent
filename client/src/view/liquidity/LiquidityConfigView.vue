<script setup>
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  createLiquidityProduct, deleteLiquidityProduct, fetchLiquidityProducts,
  fetchLiquidityVersions, saveLiquidityProduct
} from "@/api/liquidity";
import { useContext } from "@/composables/useContext";
import Drawer from "@/components/Drawer.vue";
import { askConfirm } from "@/utils/confirm";

const route = useRoute();
const router = useRouter();
const { session, scopeVersion } = useContext();
const error = ref("");
const loading = ref(true);
const tab = ref("list");
const data = ref({ products: [], meta: null, jurisdiction: "", version: "" });
const availableVersions = ref([]);
const filters = ref({ q: "", category: "", side: "", status: "" });
const drawer = ref(false);
const editing = ref(false);
const saving = ref(false);
const formError = ref("");
const form = ref(blankForm());

const SIDE_LABEL = { ASSET: "资产端", INFLOW: "现金流入", OUTFLOW: "现金流出" };
const STATUS_LABEL = { LIVE: "已启用", DRAFT: "草稿", DISABLED: "已停用" };

function blankForm() {
  return {
    code: "",
    name: "",
    category: "",
    productGroup: "",
    side: "ASSET",
    source: "CORE_ASSET",
    status: "LIVE",
    description: "",
    paramKey: "",
    ruleCount: 0,
    domains: ["CAPITAL", "LIQUIDITY", "NSFR"]
  };
}

const jurisdiction = computed(() => data.value.jurisdiction || String(route.query.jurisdiction || session.jurisdiction || "HK"));
const version = computed(() => data.value.version || String(route.query.version || scopeVersion.value || ""));

async function load() {
  loading.value = true;
  error.value = "";
  try {
    const targetJurisdiction = String(route.query.jurisdiction || session.jurisdiction || "HK").toUpperCase();
    const targetVersion = String(route.query.version || scopeVersion.value || "");
    if (route.query.jurisdiction && route.query.version) {
      const target = (session.versions || []).find(
        (item) => item.jurisdiction === targetJurisdiction && item.version === targetVersion
      );
      if (target) {
        session.jurisdiction = targetJurisdiction;
        session.versionId = target.id;
      }
    }
    const result = await fetchLiquidityProducts(targetJurisdiction, targetVersion);
    data.value = result;
    if (!result.products.length) {
      const all = await fetchLiquidityVersions("");
      availableVersions.value = all.filter((item) => item.productCount > 0);
    } else {
      availableVersions.value = [];
    }
  } catch (err) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
}

const categories = computed(() => [...new Set(data.value.products.map((item) => item.category).filter(Boolean))]);

const filtered = computed(() => {
  const f = filters.value;
  const text = f.q.trim().toLowerCase();
  return data.value.products.filter((product) => {
    if (f.category && product.category !== f.category) return false;
    if (f.side && product.side !== f.side) return false;
    if (f.status && product.status !== f.status) return false;
    if (!text) return true;
    return [product.code, product.name, product.category, product.productGroup]
      .join(" ").toLowerCase().includes(text);
  });
});

const stats = computed(() => ({
  total: data.value.products.length,
  live: data.value.products.filter((item) => item.status === "LIVE").length,
  pending: data.value.products.filter((item) => item.completeness.score < 100).length,
  complete: data.value.products.filter((item) => item.completeness.score >= 100).length
}));

const pendingProducts = computed(() => data.value.products.filter((item) => item.completeness.score < 100));

function openCreate() {
  editing.value = false;
  form.value = blankForm();
  formError.value = "";
  drawer.value = true;
}

function openEdit(product) {
  editing.value = true;
  form.value = {
    code: product.code,
    name: product.name,
    category: product.category,
    productGroup: product.productGroup,
    side: product.side,
    source: product.source,
    status: product.status,
    description: product.description,
    paramKey: product.paramKey,
    ruleCount: product.ruleCount,
    domains: product.domains && product.domains.length ? product.domains : ["CAPITAL", "LIQUIDITY", "NSFR"]
  };
  formError.value = "";
  drawer.value = true;
}

function openCopy(product) {
  editing.value = false;
  form.value = {
    ...openCopyPayload(product),
    code: product.code + "_COPY",
    name: product.name + "（副本）",
    status: "DRAFT"
  };
  formError.value = "";
  drawer.value = true;
}

function openCopyPayload(product) {
  return {
    code: product.code,
    name: product.name,
    category: product.category,
    productGroup: product.productGroup,
    side: product.side,
    source: product.source,
    status: product.status,
    description: product.description,
    paramKey: product.paramKey,
    ruleCount: product.ruleCount,
    domains: product.domains || []
  };
}

async function submit() {
  if (saving.value) return;
  formError.value = "";
  if (!form.value.code.trim()) { formError.value = "请填写产品编码"; return; }
  if (!form.value.name.trim()) { formError.value = "请填写产品名称"; return; }
  saving.value = true;
  try {
    const body = { ...form.value, jurisdiction: jurisdiction.value, version: version.value };
    if (editing.value) await saveLiquidityProduct(form.value.code, body);
    else await createLiquidityProduct(body);
    drawer.value = false;
    await load();
  } catch (err) {
    formError.value = err.message;
  } finally {
    saving.value = false;
  }
}

async function toggleStatus(product) {
  const disabled = product.status === "DISABLED";
  const yes = await askConfirm(
    disabled ? `重新启用产品「${product.name}」？` : `停用产品「${product.name}」？停用后不进入新的计量任务。`,
    { title: disabled ? "启用产品" : "停用产品", danger: !disabled }
  );
  if (!yes) return;
  try {
    await saveLiquidityProduct(product.code, {
      ...openCopyPayload(product),
      jurisdiction: jurisdiction.value,
      version: version.value,
      status: disabled ? "LIVE" : "DISABLED"
    });
    await load();
  } catch (err) {
    error.value = err.message;
  }
}

async function remove(product) {
  const yes = await askConfirm(`将删除产品「${product.name}」及其标准字段，确定继续？`, { title: "删除产品", danger: true });
  if (!yes) return;
  try {
    await deleteLiquidityProduct(product.code, jurisdiction.value, version.value);
    await load();
  } catch (err) {
    error.value = err.message;
  }
}

function openProduct(product, tabKey = "overview") {
  router.push({
    name: "liquidity-product",
    params: { code: product.code },
    query: { tab: tabKey, jurisdiction: jurisdiction.value, version: version.value }
  });
}

async function switchVersion(item) {
  const target = (session.versions || []).find(
    (row) => row.jurisdiction === item.jurisdiction && row.version === item.version
  );
  if (target) {
    session.jurisdiction = target.jurisdiction;
    session.versionId = target.id;
  }
  await router.push({
    path: "/liquidity-config",
    query: { jurisdiction: item.jurisdiction, version: item.version }
  });
  await load();
}

onMounted(load);
</script>

<template>
  <p v-if="error" class="notice danger">{{ error }}</p>

  <div class="lq-hero">
    <div>
      <h2>流动性产品管理</h2>
      <p>
        配置的唯一入口：产品组、标准字段、规则配置和规则预览都在产品内完成；
        清单与参数作为跨产品共享配置。当前版本
        <b>{{ version }}</b>
        <span v-if="data.meta"> · LCR 规则集 {{ data.meta.lcrVersion || "—" }}</span>
      </p>
    </div>
    <div class="lq-hero-badge">
      <b>{{ stats.total }}</b>
      <span>个产品 · {{ stats.live }} 已启用</span>
    </div>
  </div>

  <div class="lq-stats">
    <div class="lq-stat"><span>产品总数</span><b>{{ stats.total }}</b><em>已注册产品</em></div>
    <div class="lq-stat"><span>已启用</span><b>{{ stats.live }}</b><em>正常使用</em></div>
    <div class="lq-stat"><span>待完善配置</span><b>{{ stats.pending }}</b><em>存在配置缺项</em></div>
    <div class="lq-stat"><span>已完善</span><b>{{ stats.complete }}</b><em>可用于计量</em></div>
  </div>

  <div class="lq-tabs">
    <button type="button" :class="{ on: tab === 'list' }" @click="tab = 'list'">产品清单</button>
    <button type="button" :class="{ on: tab === 'check' }" @click="tab = 'check'">产品配置检查</button>
    <span class="spacer"></span>
    <button type="button" class="btn sm" @click="router.push('/liquidity-params')">清单与参数</button>
  </div>

  <template v-if="tab === 'list'">
    <div class="panel lq-filters">
      <div class="panel-body">
        <div class="lq-filter-row">
          <input v-model="filters.q" type="search" placeholder="搜索产品编码 / 名称 / 产品组" />
          <select v-model="filters.category">
            <option value="">全部业务大类</option>
            <option v-for="item in categories" :key="item" :value="item">{{ item }}</option>
          </select>
          <select v-model="filters.side">
            <option value="">全部侧别</option>
            <option value="ASSET">资产端</option>
            <option value="INFLOW">现金流入</option>
            <option value="OUTFLOW">现金流出</option>
          </select>
          <select v-model="filters.status">
            <option value="">全部状态</option>
            <option value="LIVE">已启用</option>
            <option value="DRAFT">草稿</option>
            <option value="DISABLED">已停用</option>
          </select>
          <span class="spacer"></span>
          <span class="dim">{{ filtered.length }} / {{ data.products.length }} 个产品</span>
          <button type="button" class="btn sm primary" @click="openCreate">＋ 新建产品</button>
        </div>
      </div>
    </div>

    <div v-if="loading" class="empty">正在读取流动性产品…</div>
    <div v-else-if="!filtered.length" class="empty">
      <div class="ei">▤</div>
      <div>{{ data.products.length ? "没有符合条件的产品" : "当前版本还没有流动性产品配置。" }}</div>
      <div v-if="!data.products.length && availableVersions.length" style="margin-top: 10px">
        <p class="dim" style="font-size: 11.5px; margin: 0 0 6px">以下版本已导入流动性产品：</p>
        <button
          v-for="item in availableVersions"
          :key="item.jurisdiction + item.version"
          type="button"
          class="btn sm"
          style="margin: 0 4px"
          @click="switchVersion(item)"
        >
          {{ item.jurisdiction }} · {{ item.version }}（{{ item.productCount }}）
        </button>
      </div>
    </div>
    <div v-else class="lq-cards">
      <div v-for="product in filtered" :key="product.code" class="lq-card">
        <div class="lq-card-head">
          <b>{{ product.name }}</b>
          <span class="tag" :class="product.status === 'LIVE' ? 'green' : product.status === 'DRAFT' ? 'amber' : 'muted'">
            {{ STATUS_LABEL[product.status] || product.status }}
          </span>
        </div>
        <div class="lq-card-code">{{ product.code }} · {{ product.category }}</div>
        <p class="lq-card-desc">{{ product.description }}</p>
        <div class="lq-card-nums">
          <span><em>标准字段</em><b>{{ product.fields.length }}</b></span>
          <span><em>关联规则</em><b>{{ product.ruleCount }}</b></span>
          <span><em>产品组</em><b>{{ product.productGroups.length }}</b></span>
          <span><em>侧别</em><b>{{ SIDE_LABEL[product.side] || product.side }}</b></span>
        </div>
        <div class="lq-progress">
          <div class="lq-progress-bar"><i :style="{ width: product.completeness.score + '%' }"></i></div>
          <span :class="{ ok: product.completeness.score >= 100 }">{{ product.completeness.score }}%</span>
        </div>
        <div class="lq-card-actions">
          <button type="button" class="btn sm" @click="openProduct(product, 'groups')">产品组信息</button>
          <button type="button" class="btn sm" @click="openProduct(product, 'fields')">标准字段</button>
          <button type="button" class="btn sm" @click="openProduct(product, 'rules')">规则配置</button>
          <button type="button" class="btn sm" @click="openProduct(product, 'preview')">规则预览</button>
          <button type="button" class="btn sm primary" @click="openProduct(product, 'overview')">打开</button>
        </div>
        <div class="lq-card-foot">
          <button type="button" class="btn sm" @click="openEdit(product)">编辑</button>
          <button type="button" class="btn sm" @click="openCopy(product)">复制</button>
          <button type="button" class="btn sm" @click="toggleStatus(product)">{{ product.status === "DISABLED" ? "启用" : "停用" }}</button>
          <button type="button" class="btn sm danger" @click="remove(product)">删除</button>
          <span class="spacer"></span>
          <span class="dim">{{ product.updatedAt || "" }}</span>
        </div>
      </div>
    </div>
  </template>

  <div v-else class="panel">
    <div class="panel-head">
      <h3>配置完整性检查</h3>
      <span class="sub">{{ pendingProducts.length }} 个产品待完善 · 按产品适用的规则范围计算，不要求配置全部监管规则</span>
    </div>
    <div class="panel-body tight">
      <table class="tbl">
        <thead>
          <tr><th>产品</th><th>侧别</th><th>完整性</th><th>状态</th><th>缺项</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="product in data.products" :key="product.code">
            <td>
              <strong>{{ product.name }}</strong>
              <div class="dim" style="font-size: 10.5px">{{ product.code }} · {{ product.category }}</div>
            </td>
            <td>{{ SIDE_LABEL[product.side] || product.side }}</td>
            <td style="width: 180px">
              <div class="lq-progress">
                <div class="lq-progress-bar"><i :style="{ width: product.completeness.score + '%' }"></i></div>
                <span :class="{ ok: product.completeness.score >= 100 }">{{ product.completeness.score }}%</span>
              </div>
            </td>
            <td>
              <span class="tag" :class="product.completeness.score >= 100 ? 'green' : 'amber'">
                {{ product.completeness.status }}
              </span>
            </td>
            <td class="dim">{{ product.completeness.items.filter((item) => item.status !== "DONE").map((item) => item.label).join("、") || "—" }}</td>
            <td class="num"><button type="button" class="btn sm" @click="openProduct(product, 'check')">查看缺项</button></td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>

  <Drawer :open="drawer" :title="editing ? '编辑流动性产品' : '新建流动性产品'" wide @close="drawer = false">
    <p v-if="formError" class="notice danger">{{ formError }}</p>
    <div class="grid c2">
      <div class="field">
        <label>产品编码</label>
        <input v-model="form.code" type="text" :disabled="editing" placeholder="如 LOAN_CORP" />
      </div>
      <div class="field">
        <label>产品名称</label>
        <input v-model="form.name" type="text" placeholder="如 对公贷款" />
      </div>
      <div class="field">
        <label>业务大类</label>
        <input v-model="form.category" type="text" placeholder="如 贷款及垫款类" />
      </div>
      <div class="field">
        <label>产品组</label>
        <input v-model="form.productGroup" type="text" placeholder="如 LOAN" />
      </div>
      <div class="field">
        <label>计量侧别</label>
        <select v-model="form.side">
          <option value="ASSET">资产端</option>
          <option value="INFLOW">现金流入</option>
          <option value="OUTFLOW">现金流出</option>
        </select>
      </div>
      <div class="field">
        <label>来源系统</label>
        <input v-model="form.source" type="text" placeholder="如 CORE_LOAN" />
      </div>
      <div class="field">
        <label>参数键</label>
        <input v-model="form.paramKey" type="text" placeholder="如 L2A_CORPORATE" />
      </div>
      <div class="field">
        <label>状态</label>
        <select v-model="form.status">
          <option value="LIVE">已启用</option>
          <option value="DRAFT">草稿</option>
          <option value="DISABLED">已停用</option>
        </select>
      </div>
    </div>
    <div class="field">
      <label>产品说明</label>
      <textarea v-model="form.description" rows="3"></textarea>
    </div>
    <p class="dim" style="font-size: 11.5px">
      参数键决定计算时引用哪一行 HQLA 折扣率 / 现金流入率 / 现金流出率；留空时该产品会在计算步骤报异常。
    </p>
    <template #footer>
      <button type="button" class="btn" @click="drawer = false">取消</button>
      <span class="spacer"></span>
      <button type="button" class="btn primary" :disabled="saving" @click="submit">{{ saving ? "保存中…" : "保存" }}</button>
    </template>
  </Drawer>
</template>

<style scoped>
.lq-hero {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 14px;
}
.lq-hero h2 { margin: 0 0 4px; font-size: 18px; }
.lq-hero p { margin: 0; color: var(--muted); font-size: 12.5px; max-width: 780px; }
.lq-hero-badge {
  border: 1px solid var(--line);
  background: #fff;
  border-radius: 10px;
  padding: 8px 14px;
  text-align: right;
  white-space: nowrap;
}
.lq-hero-badge b { display: block; font-size: 20px; }
.lq-hero-badge span { font-size: 11.5px; color: var(--muted); }
.lq-stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 12px;
}
.lq-stat {
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 10px 12px;
}
.lq-stat span { font-size: 11.5px; color: var(--muted); display: block; }
.lq-stat b { font-size: 20px; display: block; line-height: 1.3; }
.lq-stat em { font-style: normal; font-size: 11px; color: var(--muted); }
.lq-tabs { display: flex; gap: 6px; align-items: center; margin-bottom: 10px; flex-wrap: wrap; }
.lq-tabs button {
  border: 1px solid var(--line);
  background: #fff;
  border-radius: 999px;
  padding: 5px 12px;
  font-size: 12px;
  color: #475569;
}
.lq-tabs button.on { background: #eef2ff; border-color: #a5b4fc; color: #3730a3; font-weight: 600; }
.lq-filter-row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.lq-filter-row input[type="search"] { flex: 1 1 260px; max-width: 360px; width: auto; }
.lq-filter-row select { flex: 0 0 auto; min-width: 140px; width: auto; }
.lq-filters .panel-body { padding: 10px 12px; }
.lq-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(330px, 1fr));
  gap: 12px;
}
.lq-card {
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 13px 15px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.lq-card-head { display: flex; align-items: center; gap: 8px; }
.lq-card-head b { font-size: 14px; }
.lq-card-head .tag { margin-left: auto; }
.lq-card-code { font-family: var(--mono); font-size: 11px; color: var(--muted); }
.lq-card-desc { margin: 0; font-size: 12px; color: var(--muted); min-height: 34px; }
.lq-card-nums {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 6px;
  border-top: 1px dashed var(--line);
  padding-top: 7px;
}
.lq-card-nums span { display: flex; flex-direction: column; gap: 1px; }
.lq-card-nums em { font-style: normal; font-size: 10.5px; color: var(--muted); }
.lq-card-nums b { font-size: 13px; }
.lq-progress { display: flex; align-items: center; gap: 8px; }
.lq-progress-bar { flex: 1; height: 7px; background: #eef2ff; border-radius: 6px; overflow: hidden; }
.lq-progress-bar i { display: block; height: 100%; background: #f59e0b; }
.lq-progress span { font-size: 11px; color: #b45309; min-width: 32px; text-align: right; }
.lq-progress span.ok { color: #047857; }
.lq-card-actions { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 5px; }
.lq-card-actions .btn { padding: 4px 6px; font-size: 11px; text-align: center; }
.lq-card-foot { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; margin-top: 2px; }
.lq-card-foot .btn { padding: 2px 7px; font-size: 10.5px; }
@media (max-width: 900px) {
  .lq-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .lq-card-actions { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
</style>
