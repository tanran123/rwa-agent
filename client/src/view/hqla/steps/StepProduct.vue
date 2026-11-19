<script setup>
import { computed, ref, watch } from "vue";
import { identifyDatasets as runIdentify, saveDatasetMeta } from "@/api/hqla";

const props = defineProps({ task: Object, meta: Object, reload: Function });
const busy = ref(false);
const error = ref("");
const changed = ref({});

const SIDE_LABEL = { ASSET: "资产端", INFLOW: "现金流入", OUTFLOW: "现金流出" };
const datasets = computed(() => (props.task && props.task.datasets) || []);
const products = computed(() => (props.meta && props.meta.products) || []);
const confirmedAll = computed(() => datasets.value.length && datasets.value.every((item) => isConfirmed(item)));

function isConfirmed(dataset) {
  if (dataset.confirmedAt) return true;
  if (dataset.level === "CONFIRMED" || dataset.level === "HIGH") return true;
  return false;
}

function productOf(code) {
  return products.value.find((item) => item.code === code);
}

async function identify() {
  busy.value = true;
  error.value = "";
  try {
    const result = await runIdentify(props.task.id);
    (result.datasets || []).forEach((dataset) => {
      const current = datasets.value.find((item) => item.id === dataset.id);
      if (current) changed.value[current.id] = { productCode: dataset.productCode, candidates: dataset.candidates };
    });
    await props.reload();
  } catch (err) {
    error.value = err.message;
  } finally {
    busy.value = false;
  }
}

async function confirmDataset(dataset) {
  const code = changed.value[dataset.id] ? changed.value[dataset.id].productCode : dataset.productCode;
  const product = productOf(code);
  if (!product) { error.value = "请先选择产品"; return; }
  busy.value = true;
  error.value = "";
  try {
    await saveDatasetMeta(props.task.id, dataset.id, {
      productCode: product.code,
      productName: product.name,
      confidence: 100,
      level: "CONFIRMED",
      confirmedAt: new Date().toISOString().slice(0, 19).replace("T", " ")
    });
    await props.reload();
  } catch (err) {
    error.value = err.message;
  } finally {
    busy.value = false;
  }
}

function candidatesOf(dataset) {
  const entry = changed.value[dataset.id];
  return (entry && entry.candidates) || dataset.candidates || [];
}

watch(datasets, (rows) => {
  const next = { ...changed.value };
  (rows || []).forEach((dataset) => {
    const current = next[dataset.id];
    if (!current) {
      next[dataset.id] = { productCode: dataset.productCode || "", candidates: dataset.candidates || [] };
    } else if (!current.productCode) {
      current.productCode = dataset.productCode || "";
    }
  });
  changed.value = next;
}, { immediate: true, deep: false });
</script>

<template>
  <p v-if="error" class="notice danger">{{ error }}</p>

  <div class="panel">
    <div class="panel-head">
      <h3>产品识别结果</h3>
      <span class="sub">{{ datasets.length }} 个数据集 · 以 Sheet 为识别单位，低置信度需人工确认</span>
      <span class="spacer"></span>
      <button type="button" class="btn sm" :disabled="busy || !datasets.length" @click="identify">
        {{ busy ? "识别中…" : "重新识别" }}
      </button>
    </div>
    <div class="panel-body">
      <div v-if="!datasets.length" class="empty">请先在第二步导入 Excel 数据。</div>
      <div v-else class="lq-ds-grid">
        <div v-for="dataset in datasets" :key="dataset.id" class="lq-ds-card">
          <div class="lq-ds-head">
            <b>{{ dataset.sheet }}</b>
            <span class="tag" :class="isConfirmed(dataset) ? 'green' : dataset.level === 'LOW' ? 'red' : 'amber'">
              {{ isConfirmed(dataset) ? "已确认" : (dataset.confidence != null ? dataset.confidence + "%" : "待识别") }}
            </span>
          </div>
          <div class="lq-ds-meta">
            <span>{{ (dataset.rows || []).length.toLocaleString("zh-CN") }} 行</span>
            <span class="mono">{{ dataset.id }}</span>
          </div>
          <div class="lq-ds-result">
            识别为
            <b>{{ dataset.productName || productOf(dataset.productCode)?.name || "—" }}</b>
            <span class="mono dim">{{ dataset.productCode }}</span>
          </div>
          <div v-if="candidatesOf(dataset).length" class="lq-ds-candidates">
            候选：{{ candidatesOf(dataset).map((item) => item.name + " " + item.score + "%").join(" / ") }}
          </div>
          <div class="lq-ds-actions">
            <select v-model="changed[dataset.id].productCode" @focus="changed[dataset.id] = changed[dataset.id] || { candidates: dataset.candidates }">
              <option value="">选择产品</option>
              <option v-for="product in products" :key="product.code" :value="product.code">
                {{ SIDE_LABEL[product.side] }} · {{ product.name }}（{{ product.code }}）
              </option>
            </select>
            <button type="button" class="btn sm primary" :disabled="busy" @click="confirmDataset(dataset)">
              {{ isConfirmed(dataset) ? "重新确认" : "确认产品" }}
            </button>
          </div>
        </div>
      </div>
      <p class="dim" style="font-size: 11.5px; margin-top: 10px">
        中低置信度数据集需人工确认；同一 Sheet 混排多产品时，系统提示拆分而不是强行分类。
      </p>
    </div>
  </div>

  <div v-if="datasets.length" class="panel">
    <div class="panel-head"><h3>识别汇总</h3><span class="sub">{{ confirmedAll ? "全部数据集已确认" : "还有数据集未确认" }}</span></div>
    <div class="panel-body tight">
      <table class="tbl">
        <thead><tr><th>Sheet</th><th>产品</th><th>侧别</th><th class="num">数据行</th><th>状态</th></tr></thead>
        <tbody>
          <tr v-for="dataset in datasets" :key="dataset.id">
            <td>{{ dataset.sheet }}</td>
            <td>{{ dataset.productName || productOf(dataset.productCode)?.name || "—" }}</td>
            <td class="small">{{ SIDE_LABEL[(productOf(dataset.productCode) || {}).side] || "—" }}</td>
            <td class="num mono">{{ (dataset.rows || []).length.toLocaleString("zh-CN") }}</td>
            <td>
              <span class="tag" :class="isConfirmed(dataset) ? 'green' : 'amber'">
                {{ isConfirmed(dataset) ? "已确认" : "待确认" }}
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.lq-ds-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 12px; }
.lq-ds-card { border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px; display: flex; flex-direction: column; gap: 6px; }
.lq-ds-head { display: flex; align-items: center; gap: 8px; }
.lq-ds-head b { font-size: 13.5px; }
.lq-ds-head .tag { margin-left: auto; }
.lq-ds-meta { display: flex; gap: 10px; font-size: 11px; color: var(--muted); }
.lq-ds-result { font-size: 12.5px; }
.lq-ds-result b { margin: 0 4px; }
.lq-ds-candidates { font-size: 11px; color: var(--muted); }
.lq-ds-actions { display: flex; gap: 6px; align-items: center; margin-top: 4px; }
.lq-ds-actions select { flex: 1; min-width: 0; }
</style>
