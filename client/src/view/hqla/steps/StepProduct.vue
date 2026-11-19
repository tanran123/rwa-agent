<script setup>
import { computed, onMounted, ref, watch } from "vue";
import { confirmRecognitions, getTaskSnapshot, listRecognitions, recognizeProducts } from "@/api/hqla";

const props = defineProps({ task: Object, meta: Object, reload: Function });

const busy = ref(false);
const error = ref("");
const note = ref("");
const catalog = ref([]);
const rows = ref([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(50);
const filters = ref({ datasetId: "", status: "", productCode: "", q: "" });
const selected = ref([]);
const batchProduct = ref("");
const changed = ref({});
const modelErrors = ref([]);

const datasets = computed(() => (props.task && props.task.datasets) || []);
const products = computed(() => catalog.value.length ? catalog.value : ((props.meta && props.meta.products) || []));
const productMap = computed(() => new Map(products.value.map((product) => [product.code, product])));
const pageCount = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)));
const statusOptions = [
  ["", "全部状态"],
  ["pending", "待确认"],
  ["confirmed", "已确认"],
  ["unmatched", "无法识别"],
  ["conflict", "存在冲突"]
];

const STATUS = {
  pending: { label: "待确认", tone: "amber" },
  confirmed: { label: "已确认", tone: "green" },
  unmatched: { label: "无法识别", tone: "red" },
  conflict: { label: "存在冲突", tone: "red" }
};

function statusOf(row) {
  return STATUS[row.status] || { label: row.status || "待确认", tone: "muted" };
}

function productName(code) {
  const product = productMap.value.get(code);
  return product ? product.name : code || "—";
}

function excerpt(raw) {
  const values = Object.entries(raw || {})
    .filter(([key, value]) => !key.startsWith("_") && value !== null && value !== undefined && String(value).trim() !== "")
    .slice(0, 4)
    .map(([key, value]) => key + "：" + String(value).slice(0, 24));
  return values.join(" · ") || "—";
}

function candidatesText(row) {
  const list = Array.isArray(row.candidates) ? row.candidates : [];
  return list.slice(0, 3).map((item) => productName(item.productCode) + " " + item.score).join(" / ");
}

function rowCode(row) {
  return changed.value[row.recordId] != null ? changed.value[row.recordId] : row.productCode || "";
}

function setRowCode(row, value) {
  changed.value = { ...changed.value, [row.recordId]: value };
}

function allOnPageSelected() {
  return rows.value.length > 0 && rows.value.every((row) => selected.value.includes(row.recordId));
}

function toggleAll() {
  if (allOnPageSelected()) {
    const pageIds = new Set(rows.value.map((row) => row.recordId));
    selected.value = selected.value.filter((id) => !pageIds.has(id));
  } else {
    const next = new Set(selected.value);
    rows.value.forEach((row) => next.add(row.recordId));
    selected.value = [...next];
  }
}

function toggleRow(row) {
  selected.value = selected.value.includes(row.recordId)
    ? selected.value.filter((id) => id !== row.recordId)
    : [...selected.value, row.recordId];
}

async function loadSnapshot() {
  try {
    const snapshot = await getTaskSnapshot(props.task.id);
    catalog.value = (snapshot.config && snapshot.config.products) || [];
  } catch (err) {
    catalog.value = [];
  }
}

async function load() {
  busy.value = true;
  error.value = "";
  try {
    const result = await listRecognitions(props.task.id, {
      datasetId: filters.value.datasetId || undefined,
      status: filters.value.status || undefined,
      productCode: filters.value.productCode || undefined,
      q: filters.value.q || undefined,
      page: page.value,
      pageSize: pageSize.value
    });
    rows.value = result.rows || [];
    total.value = Number(result.total) || 0;
    const next = { ...changed.value };
    rows.value.forEach((row) => {
      if (next[row.recordId] == null) next[row.recordId] = row.productCode || "";
    });
    changed.value = next;
  } catch (err) {
    error.value = err.message;
  } finally {
    busy.value = false;
  }
}

async function recognize() {
  busy.value = true;
  error.value = "";
  note.value = "";
  modelErrors.value = [];
  try {
    const result = await recognizeProducts(props.task.id, {
      datasetId: filters.value.datasetId || undefined,
      forceConfirmed: false
    });
    modelErrors.value = (result.datasets || []).filter((item) => item.modelError).map((item) => item.sheet + "：" + item.modelError);
    note.value = "识别完成：输入版本 v" + result.inputVersion + "，共 " + (result.datasets || []).reduce((sum, item) => sum + (item.records || 0), 0) + " 条记录。";
    page.value = 1;
    await load();
    if (props.reload) await props.reload();
  } catch (err) {
    error.value = err.message;
  } finally {
    busy.value = false;
  }
}

async function confirmRow(row) {
  const code = rowCode(row);
  if (!code) { error.value = "请先选择确认产品"; return; }
  busy.value = true;
  error.value = "";
  try {
    await confirmRecognitions(props.task.id, { recordIds: [row.recordId], productCode: code });
    await load();
    if (props.reload) await props.reload();
  } catch (err) {
    error.value = err.message;
  } finally {
    busy.value = false;
  }
}

async function confirmSelected() {
  if (!selected.value.length) { error.value = "请先选择记录"; return; }
  if (!batchProduct.value) { error.value = "请选择批量确认的产品"; return; }
  busy.value = true;
  error.value = "";
  try {
    await confirmRecognitions(props.task.id, { recordIds: selected.value, productCode: batchProduct.value });
    selected.value = [];
    await load();
    if (props.reload) await props.reload();
  } catch (err) {
    error.value = err.message;
  } finally {
    busy.value = false;
  }
}

function goPage(delta) {
  const next = Math.min(pageCount.value, Math.max(1, page.value + delta));
  if (next !== page.value) {
    page.value = next;
    load();
  }
}

watch(filters, () => { page.value = 1; load(); }, { deep: true });
watch(() => props.task && props.task.id, async () => {
  await loadSnapshot();
  page.value = 1;
  await load();
});

onMounted(async () => {
  await loadSnapshot();
  await load();
});
</script>

<template>
  <p v-if="error" class="notice danger">{{ error }}</p>
  <p v-if="note" class="notice ok">{{ note }}</p>
  <p v-if="modelErrors.length" class="notice warn">
    模型识别失败，已使用确定性兜底规则：{{ modelErrors.join("；") }}
  </p>

  <div class="panel">
    <div class="panel-head">
      <h3>产品识别结果</h3>
      <span class="sub">以逐笔记录为识别单位；模型只给建议，人工确认后才进入后续步骤。</span>
      <span class="spacer"></span>
      <button type="button" class="btn sm" :disabled="busy || !datasets.length" @click="recognize">
        {{ busy ? "处理中…" : "重新识别" }}
      </button>
    </div>
    <div class="panel-body">
      <div class="inline-fields" style="margin-bottom: 10px">
        <select v-model="filters.datasetId">
          <option value="">全部数据集</option>
          <option v-for="dataset in datasets" :key="dataset.id" :value="dataset.id">
            {{ dataset.sheet }}（{{ dataset.rowCount || (dataset.rows || []).length }} 行）
          </option>
        </select>
        <select v-model="filters.status">
          <option v-for="[value, label] in statusOptions" :key="value" :value="value">{{ label }}</option>
        </select>
        <select v-model="filters.productCode">
          <option value="">全部产品</option>
          <option v-for="product in products" :key="product.code" :value="product.code">
            {{ product.name }}（{{ product.code }}）
          </option>
        </select>
        <input v-model="filters.q" type="search" placeholder="搜索记录内容或记录编号" style="flex: 1; min-width: 180px" />
        <span class="spacer"></span>
        <span class="dim">共 {{ total }} 条 · 第 {{ page }} / {{ pageCount }} 页</span>
      </div>

      <div class="inline-fields" style="margin-bottom: 10px">
        <select v-model="batchProduct" style="min-width: 220px">
          <option value="">批量确认产品</option>
          <option v-for="product in products" :key="product.code" :value="product.code">
            {{ product.name }}（{{ product.code }}）
          </option>
        </select>
        <button type="button" class="btn sm primary" :disabled="busy || !selected.length || !batchProduct" @click="confirmSelected">
          批量确认（{{ selected.length }}）
        </button>
      </div>

      <div v-if="!datasets.length" class="empty">请先在第二步导入 Excel 数据。</div>
      <div v-else-if="!rows.length" class="empty">还没有识别结果。点击「重新识别」开始。</div>
      <table v-else class="tbl">
        <thead>
          <tr>
            <th><input type="checkbox" :checked="allOnPageSelected()" @change="toggleAll" /></th>
            <th>数据集 / 行</th><th>记录摘要</th><th>建议产品</th><th class="num">置信度</th><th>状态</th><th>确认产品</th><th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.recordId">
            <td><input type="checkbox" :checked="selected.includes(row.recordId)" @change="toggleRow(row)" /></td>
            <td>
              <strong>{{ row.datasetSheet || row.datasetId }}</strong>
              <div class="mono dim" style="font-size: 10.5px">第 {{ row.rowNo }} 行 · {{ row.recordId }}</div>
            </td>
            <td class="small" style="max-width: 320px">{{ excerpt(row.raw) }}</td>
            <td>
              {{ row.suggestedProductCode ? productName(row.suggestedProductCode) : "—" }}
              <div v-if="row.candidates && row.candidates.length" class="dim" style="font-size: 10.5px">
                候选：{{ candidatesText(row) }}
              </div>
              <div v-if="row.reason" class="dim" style="font-size: 10.5px">{{ row.reason }}</div>
            </td>
            <td class="num mono">{{ row.confidence == null ? "—" : row.confidence + "%" }}</td>
            <td><span class="tag" :class="statusOf(row).tone">{{ statusOf(row).label }}</span></td>
            <td>
              <select :value="rowCode(row)" @change="setRowCode(row, $event.target.value)">
                <option value="">请选择</option>
                <option v-for="product in products" :key="product.code" :value="product.code">
                  {{ product.name }}（{{ product.code }}）
                </option>
              </select>
            </td>
            <td class="num">
              <button type="button" class="btn sm primary" :disabled="busy" @click="confirmRow(row)">
                {{ row.status === "confirmed" ? "重新确认" : "确认" }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>

      <div v-if="pageCount > 1" class="inline-fields" style="margin-top: 10px; justify-content: flex-end">
        <button type="button" class="btn sm" :disabled="page <= 1" @click="goPage(-1)">上一页</button>
        <span class="dim">第 {{ page }} / {{ pageCount }} 页</span>
        <button type="button" class="btn sm" :disabled="page >= pageCount" @click="goPage(1)">下一页</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tbl td { vertical-align: top; }
</style>
