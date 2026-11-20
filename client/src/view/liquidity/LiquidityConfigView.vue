<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  copyLiquidityProduct, createLiquidityProduct, deleteLiquidityProduct, fetchLiquidityProducts,
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
const data = ref({ products: [], meta: null, jurisdiction: "", version: "" });
const availableVersions = ref([]);
const filters = ref({ q: "", category: "", side: "", status: "" });
const drawer = ref(false);
const editing = ref(false);
const copying = ref(false);
const copySource = ref("");
const openMenu = ref("");
const saving = ref(false);
const formError = ref("");
const form = ref(blankForm());

const SIDE_LABEL = { ASSET: "资产端", INFLOW: "现金流入", OUTFLOW: "现金流出" };
const STATUS_LABEL = { LIVE: "已启用", DRAFT: "草稿", DISABLED: "已停用" };
const ITEM_STATUS = { DONE: "完成", PARTIAL: "部分完成", TODO: "待完善" };

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
  page.value = 1;
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
    return [product.code, product.name, product.category, product.productGroup, ...(product.groups || []).map((group) => group.name)]
      .join(" ").toLowerCase().includes(text);
  });
});

const PAGE_SIZES = [12, 24, 48];
const page = ref(1);
const pageSize = ref(12);

const totalPages = computed(() => Math.max(1, Math.ceil(filtered.value.length / pageSize.value)));
const currentPage = computed(() => Math.min(Math.max(page.value, 1), totalPages.value));
const pageItems = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value;
  return filtered.value.slice(start, start + pageSize.value);
});
const pageNumbers = computed(() => {
  const total = totalPages.value;
  const current = currentPage.value;
  const start = Math.max(1, Math.min(current - 2, total - 4));
  const end = Math.min(total, start + 4);
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
});

watch(filters, () => { page.value = 1; }, { deep: true });
watch(pageSize, () => { page.value = 1; });

function goPage(value) {
  page.value = Math.min(Math.max(1, value), totalPages.value);
}

function resetFilters() {
  filters.value = { q: "", category: "", side: "", status: "" };
  page.value = 1;
}

function completenessTip(product) {
  return (product.completeness.items || [])
    .map((item) => `${item.label}：${ITEM_STATUS[item.status] || item.status}${item.detail ? "（" + item.detail + "）" : ""}`)
    .join("\n");
}

function closeMenu(event) {
  if (!(event.target instanceof Element) || !event.target.closest(".lq-more")) openMenu.value = "";
}

function openCreate() {
  editing.value = false;
  copying.value = false;
  copySource.value = "";
  form.value = blankForm();
  formError.value = "";
  drawer.value = true;
}

function openEdit(product) {
  editing.value = true;
  copying.value = false;
  copySource.value = "";
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
  copying.value = true;
  copySource.value = product.code;
  form.value = {
    ...openCopyPayload(product),
    code: "",
    name: product.name + "（副本）",
    status: "DISABLED"
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
  if (!editing.value && !copying.value && !form.value.code.trim()) { formError.value = "请填写产品编码"; return; }
  if (!form.value.name.trim()) { formError.value = "请填写产品名称"; return; }
  saving.value = true;
  try {
    const body = { ...form.value, jurisdiction: jurisdiction.value, version: version.value };
    if (editing.value) {
      await saveLiquidityProduct(form.value.code, body);
      drawer.value = false;
      await load();
      return;
    }
    const saved = copying.value
      ? await copyLiquidityProduct(copySource.value, body)
      : await createLiquidityProduct(body);
    drawer.value = false;
    if (saved && saved.product) {
      openProduct(saved.product, "overview");
      return;
    }
    await load();
  } catch (err) {
    formError.value = err.message;
  } finally {
    saving.value = false;
  }
}

async function toggleStatus(product) {
  const disabled = product.status === "DISABLED";
  const incomplete = product.completeness.score < 100;
  const message = disabled
    ? incomplete
      ? `产品「${product.name}」配置完整性 ${product.completeness.score}%，启用后仍不能进入正式计量，直到配置完整。仍要启用？`
      : `重新启用产品「${product.name}」？`
    : `停用产品「${product.name}」？停用后不进入新的计量任务。`;
  const yes = await askConfirm(message, { title: disabled ? "启用产品" : "停用产品", danger: !disabled });
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
  const yes = await askConfirm(
    `删除产品「${product.name}」？将同时删除产品基础信息、产品组信息和 ${product.fields.length} 个标准字段，并解除与共享规则的关联。如果该产品已被历史计量任务引用，系统会拒绝删除，请改用停用。`,
    { title: "删除产品", danger: true }
  );
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

onMounted(() => {
  load();
  document.addEventListener("click", closeMenu);
});
onBeforeUnmount(() => document.removeEventListener("click", closeMenu));
</script>

<template>
  <p v-if="error" class="notice danger">{{ error }}</p>

  <div class="lq-hero">
    <div>
      <h2>流动性产品管理</h2>
      <p>管理当前 LCR 规则版本下的产品及其配置</p>
    </div>
    <div class="lq-hero-actions">
      <div class="lq-version-chip">
        <span>当前版本</span>
        <b>{{ version }}</b>
      </div>
      <button type="button" class="btn primary" @click="openCreate">＋ 新建产品</button>
    </div>
  </div>

  <div class="lq-toolbar">
    <input v-model="filters.q" class="lq-search" type="search" placeholder="搜索产品名称或编码" />
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
    <button type="button" class="btn sm" @click="resetFilters">重置</button>
  </div>

  <div class="lq-list-head">
    <div>
      <h3>产品列表</h3>
      <span class="sub">
        共 {{ filtered.length }} 个产品<template v-if="filtered.length !== data.products.length"> · 全部 {{ data.products.length }} 个</template>
        · 当前显示 {{ pageItems.length }} 个
      </span>
    </div>
  </div>

  <div v-if="loading" class="empty">正在读取流动性产品…</div>
  <div v-else-if="!data.products.length" class="empty">
    <div class="ei">▤</div>
    <div>当前版本暂无流动性产品</div>
    <p class="dim">可以切换到其他已导入产品的版本继续管理。</p>
    <div v-if="availableVersions.length" class="lq-version-list">
      <button
        v-for="item in availableVersions"
        :key="item.jurisdiction + item.version"
        type="button"
        class="lq-version-card"
        @click="switchVersion(item)"
      >
        <b>{{ item.version }}</b>
        <span>
          {{ item.productCount }} 个产品
          <template v-if="item.lcrVersion"> · LCR 规则集 {{ item.lcrVersion }}</template>
        </span>
        <em>已导入</em>
      </button>
    </div>
  </div>
  <div v-else-if="!filtered.length" class="empty">
    <div class="ei">▤</div>
    <div>没有找到符合条件的产品</div>
    <p class="dim">请调整筛选条件或重置筛选。</p>
    <button type="button" class="btn sm" @click="resetFilters">重置筛选</button>
  </div>
  <div v-else class="lq-cards">
    <div
      v-for="product in pageItems"
      :key="product.code"
      class="lq-card"
      :class="{ 'menu-open': openMenu === product.code }"
      @click="openProduct(product, 'overview')"
    >
      <div class="lq-card-head">
        <b>{{ product.name }}</b>
        <span class="tag" :class="product.status === 'LIVE' ? 'green' : product.status === 'DRAFT' ? 'amber' : 'muted'">
          {{ STATUS_LABEL[product.status] || product.status }}
        </span>
      </div>
      <div class="lq-card-meta">
        <span class="mono">{{ product.code }}</span>
        <span>{{ product.category }}</span>
        <span>{{ SIDE_LABEL[product.side] || product.side }}</span>
      </div>
      <p class="lq-card-desc">{{ product.description || "暂无产品说明" }}</p>
      <div class="lq-card-metrics">
        <span><em>产品组</em><b>{{ product.groupMode === "GROUP" ? product.productGroups.length : "—" }}</b></span>
        <span><em>标准字段</em><b>{{ product.fields.length }}</b></span>
        <span><em>关联规则</em><b>{{ product.ruleCount }}</b></span>
      </div>
      <div class="lq-completeness" :title="completenessTip(product)" @click.stop="openProduct(product, 'check')">
        <div class="lq-completeness-head">
          <span>配置完整性</span>
          <b :class="{ ok: product.completeness.score >= 100 }">{{ product.completeness.score }}%</b>
          <em>{{ product.completeness.status }}</em>
        </div>
        <div class="lq-progress-bar"><i :style="{ width: product.completeness.score + '%' }"></i></div>
      </div>
      <div class="lq-card-links" @click.stop>
        <button type="button" @click="openProduct(product, 'groups')">产品组信息</button>
        <button type="button" @click="openProduct(product, 'fields')">标准字段</button>
        <button type="button" @click="openProduct(product, 'rules')">规则配置</button>
        <button type="button" @click="openProduct(product, 'preview')">规则预览</button>
      </div>
      <div class="lq-more" @click.stop>
        <button
          type="button"
          class="lq-more-btn"
          :aria-expanded="openMenu === product.code"
          @click="openMenu = openMenu === product.code ? '' : product.code"
        >⋯</button>
        <div v-if="openMenu === product.code" class="lq-more-menu">
          <button type="button" @click="openEdit(product); openMenu = ''">编辑产品</button>
          <button type="button" @click="openCopy(product); openMenu = ''">复制产品</button>
          <button type="button" @click="toggleStatus(product); openMenu = ''">{{ product.status === "DISABLED" ? "启用产品" : "停用产品" }}</button>
          <button type="button" class="danger" @click="remove(product); openMenu = ''">删除产品</button>
        </div>
      </div>
      <span class="lq-card-open">点击卡片进入配置工作台 →</span>
    </div>
  </div>
  <div v-if="!loading && totalPages > 1" class="lq-pager">
    <span class="dim">共 {{ filtered.length }} 个产品 · 第 {{ currentPage }} / {{ totalPages }} 页</span>
    <span class="spacer"></span>
    <label class="lq-page-size">每页
      <select v-model.number="pageSize">
        <option v-for="size in PAGE_SIZES" :key="size" :value="size">{{ size }}</option>
      </select>
    </label>
    <div class="lq-pager-btns">
      <button type="button" class="btn sm" :disabled="currentPage <= 1" @click="goPage(currentPage - 1)">上一页</button>
      <button
        v-for="n in pageNumbers"
        :key="n"
        type="button"
        class="btn sm"
        :class="{ primary: n === currentPage }"
        @click="goPage(n)"
      >{{ n }}</button>
      <button type="button" class="btn sm" :disabled="currentPage >= totalPages" @click="goPage(currentPage + 1)">下一页</button>
    </div>
  </div>

  <Drawer :open="drawer" :title="editing ? '编辑流动性产品' : copying ? '复制流动性产品' : '新建流动性产品'" wide @close="drawer = false">
    <p v-if="formError" class="notice danger">{{ formError }}</p>
    <p v-if="copying" class="notice info">
      新编码会自动生成（源编码加 _COPY），副本默认停用；保存后进入产品配置工作台。
    </p>
    <div class="grid c2">
      <div class="field">
        <label>产品编码</label>
        <input v-model="form.code" type="text" :disabled="editing || copying" :placeholder="copying ? '保存时自动生成' : '如 LOAN_CORP'" />
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
        <select v-model="form.status" :disabled="copying">
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
      <button type="button" class="btn primary" :disabled="saving" @click="submit">
        {{ saving ? "保存中…" : copying ? "复制并进入配置" : editing ? "保存" : "新建并进入配置" }}
      </button>
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
.lq-version-chip {
  border: 1px solid var(--line);
  background: #fff;
  border-radius: 10px;
  padding: 8px 14px;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
  white-space: nowrap;
}
.lq-version-chip span { font-size: 11px; color: var(--muted); }
.lq-version-chip b { font-size: 15px; font-family: var(--mono); }
.lq-list-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 10px; margin: 4px 0 8px; }
.lq-list-head h3 { margin: 0 0 1px; font-size: 14px; }
.lq-list-head .sub { font-size: 11.5px; color: var(--muted); }
.lq-pager {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 12px;
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 8px 12px;
}
.lq-page-size { display: flex; align-items: center; gap: 6px; margin: 0; font-size: 11.5px; color: var(--muted); }
.lq-page-size select { width: auto; min-width: 70px; }
.lq-pager-btns { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.lq-pager-btns .btn { padding: 2px 8px; font-size: 11px; }
.lq-hero { margin-bottom: 8px; }
.lq-hero-actions { display: flex; align-items: center; gap: 8px; flex: 0 0 auto; }
.lq-version-chip { padding: 5px 10px; border-radius: 8px; }
.lq-version-chip span { font-size: 9.5px; }
.lq-version-chip b { font-size: 13px; }
.lq-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: nowrap;
  overflow-x: auto;
  padding: 2px 0 8px;
}
.lq-toolbar .lq-search {
  flex: 1 1 220px;
  min-width: 150px;
  height: 34px;
  padding: 5px 9px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: #fff;
  font-size: 12px;
  line-height: normal;
}
.lq-toolbar select {
  flex: 0 0 150px;
  width: 150px;
  height: 34px;
  min-width: 0;
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: #fff;
  font-size: 11.5px;
  line-height: normal;
  box-sizing: border-box;
}
.lq-toolbar .btn { flex: 0 0 auto; height: 34px; padding: 0 12px; }
.lq-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(330px, 1fr));
  gap: 12px;
}
.lq-card {
  position: relative;
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 13px 15px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.lq-card:hover { border-color: #c7d2fe; box-shadow: 0 4px 16px rgba(30, 64, 175, 0.08); }
.lq-card.menu-open { z-index: 5; }
.lq-card-head { display: flex; align-items: center; gap: 8px; }
.lq-card-head b { font-size: 14px; }
.lq-card-head .tag { margin-left: auto; }
.lq-card-meta { display: flex; flex-wrap: wrap; gap: 6px; font-size: 11px; color: var(--muted); }
.lq-card-desc { margin: 0; font-size: 12px; color: var(--muted); min-height: 34px; }
.lq-card-metrics {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
  border-top: 1px dashed var(--line);
  padding-top: 7px;
}
.lq-card-metrics span { display: flex; flex-direction: column; gap: 1px; }
.lq-card-metrics em { font-style: normal; font-size: 10.5px; color: var(--muted); }
.lq-card-metrics b { font-size: 15px; }
.lq-completeness { display: flex; flex-direction: column; gap: 4px; cursor: pointer; padding: 6px 0 2px; }
.lq-completeness-head { display: flex; align-items: center; gap: 8px; font-size: 11px; color: var(--muted); }
.lq-completeness-head b { color: #b45309; font-size: 11.5px; }
.lq-completeness-head b.ok { color: #047857; }
.lq-completeness-head em { font-style: normal; margin-left: auto; font-size: 10.5px; }
.lq-progress-bar { flex: 1; height: 7px; background: #eef2ff; border-radius: 6px; overflow: hidden; }
.lq-progress-bar i { display: block; height: 100%; background: #f59e0b; }
.lq-card-links { display: flex; flex-wrap: wrap; gap: 12px; border-top: 1px dashed var(--line); padding-top: 8px; }
.lq-card-links button { border: 0; background: none; padding: 0; font-size: 11.5px; color: #3730a3; cursor: pointer; }
.lq-card-links button:hover { text-decoration: underline; }
.lq-more { position: absolute; right: 12px; bottom: 10px; }
.lq-more-btn {
  border: 1px solid var(--line);
  background: #fff;
  border-radius: 6px;
  width: 26px;
  height: 24px;
  line-height: 1;
  cursor: pointer;
  font-size: 14px;
  color: #475569;
}
.lq-more-btn:hover { border-color: #c7d2fe; background: #f8faff; }
.lq-more-menu {
  position: absolute;
  right: 0;
  bottom: 28px;
  z-index: 20;
  min-width: 120px;
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.12);
  padding: 4px;
  display: flex;
  flex-direction: column;
}
.lq-more-menu button {
  border: 0;
  background: none;
  text-align: left;
  padding: 6px 9px;
  font-size: 12px;
  color: #334155;
  border-radius: 6px;
  cursor: pointer;
}
.lq-more-menu button:hover { background: #f1f5f9; }
.lq-more-menu button.danger { color: #b91c1c; }
.lq-card-open { font-size: 10.5px; color: #94a3b8; padding-right: 34px; min-height: 16px; }
.lq-version-list { display: grid; gap: 8px; max-width: 520px; margin: 10px auto 0; text-align: left; }
.lq-version-card {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 10px;
  align-items: center;
  border: 1px solid var(--line);
  background: #fff;
  border-radius: 10px;
  padding: 10px 12px;
  cursor: pointer;
  text-align: left;
}
.lq-version-card:hover { border-color: #c7d2fe; background: #f8faff; }
.lq-version-card b { font-family: var(--mono); font-size: 13px; }
.lq-version-card span { font-size: 11.5px; color: var(--muted); }
.lq-version-card em { font-style: normal; font-size: 10.5px; color: #047857; }
@media (max-width: 900px) {
  .lq-hero { flex-direction: column; }
  .lq-version-chip { align-items: flex-start; }
  .lq-pager-btns { width: 100%; }
}

/* 产品卡片紧凑化 */
.lq-cards {
  grid-template-columns: repeat(auto-fill, minmax(270px, 1fr));
  gap: 8px;
}
.lq-card {
  gap: 4px;
  padding: 9px 11px;
  border-radius: 8px;
  box-shadow: none;
}
.lq-card:hover { border-color: #c7d2fe; box-shadow: none; }
.lq-card-head { gap: 6px; }
.lq-card-head b { font-size: 12.5px; }
.lq-card-head .tag { padding: 0 6px; font-size: 9.5px; }
.lq-card-meta { gap: 5px; font-size: 10.5px; }
.lq-card-desc {
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  overflow: hidden; min-height: 0; font-size: 10.5px; line-height: 1.4;
}
.lq-card-metrics {
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  padding-top: 5px;
}
.lq-card-metrics span { gap: 0; }
.lq-card-metrics em { font-size: 9px; }
.lq-card-metrics b { font-size: 12px; line-height: 1.2; }
.lq-completeness { gap: 2px; padding: 3px 0 1px; }
.lq-completeness-head { gap: 6px; font-size: 10px; }
.lq-completeness-head b { font-size: 10.5px; }
.lq-completeness-head em { font-size: 9.5px; }
.lq-progress-bar { height: 5px; }
.lq-card-links { gap: 8px; padding-top: 5px; }
.lq-card-links button { font-size: 10.5px; }
.lq-more { right: 8px; bottom: 7px; }
.lq-more-btn { width: 22px; height: 20px; font-size: 12px; }
.lq-card-open { font-size: 9.5px; line-height: 1.3; min-height: 13px; padding-right: 26px; }
</style>
