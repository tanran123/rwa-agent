<script setup>
import { computed, onMounted, ref } from "vue";
import { getRun, listRunExceptions, listRunResults, listRuns, exportRunWorkbook, downloadBlob } from "@/api/hqla";
import Drawer from "@/components/Drawer.vue";

const props = defineProps({ task: Object, finish: Function });

const busy = ref(false);
const exporting = ref(false);
const error = ref("");
const runs = ref([]);
const runId = ref("");
const detail = ref(null);
const results = ref([]);
const resultTotal = ref(0);
const resultPage = ref(1);
const resultPageSize = ref(50);
const resultFilter = ref({ productCode: "", q: "" });
const exceptions = ref([]);
const exceptionTotal = ref(0);
const exceptionPage = ref(1);
const exceptionPageSize = ref(50);
const exceptionFilter = ref({ level: "", q: "" });
const drawer = ref(false);
const activeRow = ref(null);

const datasets = computed(() => (props.task && props.task.datasets) || []);
const taskResult = computed(() => {
  const summary = (props.task && props.task.summary) || null;
  return summary && summary.calculation ? summary.calculation : null;
});
const runMetrics = computed(() => {
  if (detail.value && detail.value.run && detail.value.run.metrics) return detail.value.run.metrics;
  if (props.task && props.task.currentRun && props.task.currentRun.metrics) return props.task.currentRun.metrics;
  return (taskResult.value && taskResult.value.metrics) || {};
});
const runStats = computed(() => {
  if (detail.value && detail.value.run && detail.value.run.stats) return detail.value.run.stats;
  if (props.task && props.task.currentRun && props.task.currentRun.stats) return props.task.currentRun.stats;
  return (taskResult.value && taskResult.value.stats) || {};
});
const runLcr = computed(() => {
  const summary = detail.value && Array.isArray(detail.value.summary) ? detail.value.summary : [];
  const hit = summary.find((item) => item.key === "lcr");
  if (hit) return hit.value;
  return taskResult.value ? taskResult.value.lcr : null;
});
const resultPageCount = computed(() => Math.max(1, Math.ceil(resultTotal.value / resultPageSize.value)));
const exceptionPageCount = computed(() => Math.max(1, Math.ceil(exceptionTotal.value / exceptionPageSize.value)));
const productOptions = computed(() => {
  const products = (taskResult.value && taskResult.value.products) || [];
  return products.map((item) => ({ code: item.productCode, name: item.productName }));
});

function money(value) {
  if (value == null || Number.isNaN(Number(value))) return "—";
  return Number(value).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function pct(value) {
  return value == null ? "—" : Number(value).toFixed(2) + "%";
}
function runStatus(run) {
  if (!run) return { label: "待执行", tone: "muted" };
  if (run.status === "succeeded") return { label: "已完成", tone: "green" };
  if (run.status === "partial_failed") return { label: "部分完成", tone: "amber" };
  if (run.status === "failed") return { label: "失败", tone: "red" };
  return { label: run.status, tone: "muted" };
}

async function loadRuns() {
  runs.value = await listRuns(props.task.id);
  if (!runs.value.some((item) => item.id === runId.value)) {
    runId.value = (props.task && props.task.currentRunId) || (runs.value[0] && runs.value[0].id) || "";
  }
}

async function loadRun() {
  if (!runId.value) { detail.value = null; return; }
  detail.value = await getRun(props.task.id, runId.value);
  resultPage.value = 1;
  exceptionPage.value = 1;
  await Promise.all([loadResults(), loadExceptions()]);
}

async function loadResults() {
  if (!runId.value) { results.value = []; resultTotal.value = 0; return; }
  const response = await listRunResults(props.task.id, runId.value, {
    productCode: resultFilter.value.productCode || undefined,
    q: resultFilter.value.q || undefined,
    page: resultPage.value,
    pageSize: resultPageSize.value
  });
  results.value = response.rows || [];
  resultTotal.value = Number(response.total) || 0;
}

async function loadExceptions() {
  if (!runId.value) { exceptions.value = []; exceptionTotal.value = 0; return; }
  const response = await listRunExceptions(props.task.id, runId.value, {
    level: exceptionFilter.value.level || undefined,
    q: exceptionFilter.value.q || undefined,
    page: exceptionPage.value,
    pageSize: exceptionPageSize.value
  });
  exceptions.value = response.rows || [];
  exceptionTotal.value = Number(response.total) || 0;
}

async function load() {
  busy.value = true;
  error.value = "";
  try {
    await loadRuns();
    await loadRun();
  } catch (err) {
    error.value = err.message;
  } finally {
    busy.value = false;
  }
}

function changeRun() {
  loadRun();
}
function onResultFilter() {
  resultPage.value = 1;
  loadResults();
}
function onExceptionFilter() {
  exceptionPage.value = 1;
  loadExceptions();
}
function goResultPage(delta) {
  const next = Math.min(resultPageCount.value, Math.max(1, resultPage.value + delta));
  if (next !== resultPage.value) { resultPage.value = next; loadResults(); }
}
function goExceptionPage(delta) {
  const next = Math.min(exceptionPageCount.value, Math.max(1, exceptionPage.value + delta));
  if (next !== exceptionPage.value) { exceptionPage.value = next; loadExceptions(); }
}
function openRow(row) {
  activeRow.value = row;
  drawer.value = true;
}
function csv(name, rows) {
  const text = "﻿" + rows.map((row) => row.map((cell) => {
    const value = cell == null ? "" : String(cell);
    return /[",\n]/.test(value) ? '"' + value.replace(/"/g, '""') + '"' : value;
  }).join(",")).join("\n");
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
function exportResults() {
  const rows = [["dataset_id", "record_id", "product_code", "product_name", "side", "business_id", "raw_amount", "rate_key", "rate", "amount", "level", "category", "status"]];
  results.value.forEach((item) => rows.push([
    item.datasetId, item.recordId, item.productCode, item.productName, item.side, item.businessId,
    item.rawAmount, item.rateKey, item.rate, item.amount, item.level, item.category, item.status
  ]));
  csv(`lcr_results_${props.task.id}_${runId.value}.csv`, rows);
}
function exportExceptions() {
  const rows = [["dataset_id", "record_id", "product_code", "level", "code", "message"]];
  exceptions.value.forEach((item) => rows.push([
    item.datasetId, item.recordId, item.productCode, item.level, item.code, item.message
  ]));
  csv(`lcr_exceptions_${props.task.id}_${runId.value}.csv`, rows);
}
async function exportRunExcel() {
  if (!runId.value || exporting.value) return;
  exporting.value = true;
  error.value = "";
  try {
    const blob = await exportRunWorkbook(props.task.id, runId.value);
    const name = `LCR底稿_${props.task.name || "LCR"}_${runId.value}.xlsx`.replace(/[\\/:*?"<>|]/g, "_");
    downloadBlob(blob, name);
  } catch (err) {
    error.value = err.message;
  } finally {
    exporting.value = false;
  }
}
function finish() {
  if (props.finish) props.finish();
}

onMounted(load);
</script>

<template>
  <p v-if="error" class="notice danger">{{ error }}</p>

  <div v-if="!runs.length" class="panel">
    <div class="panel-body"><div class="empty">还没有计算结果。请先在第六步执行「自动计量计算」。</div></div>
  </div>

  <template v-else>
    <div class="panel">
      <div class="panel-head">
        <h3>结果输出</h3>
        <span class="sub">结果只读取已保存的计算批次</span>
        <span class="spacer"></span>
        <select v-model="runId" @change="changeRun" style="width: auto; min-width: 220px">
          <option v-for="item in runs" :key="item.id" :value="item.id">
            {{ item.id }} · #{{ item.runNo }} · 输入版本 v{{ item.inputVersion }} · {{ runStatus(item).label }}
          </option>
        </select>
        <button type="button" class="btn sm primary" :disabled="busy || exporting || !runId" @click="exportRunExcel">
          {{ exporting ? "导出中…" : "导出 Excel 底稿" }}
        </button>
        <button type="button" class="btn sm" :disabled="busy || !runId" @click="load">刷新</button>
      </div>
    </div>

    <div class="lq-result-grid">
      <div class="lq-result-card"><span>流动性覆盖率（LCR）</span><b>{{ pct(runLcr) }}</b><em>监管下限 {{ pct((runMetrics.lcrMin || 1) * 100) }}</em></div>
      <div class="lq-result-card"><span>计算记录数</span><b>{{ (runStats.records || 0).toLocaleString("zh-CN") }}</b><em>参与 {{ runStats.eligible == null ? "—" : runStats.eligible }} 条</em></div>
      <div class="lq-result-card"><span>成功处理</span><b>{{ (runStats.success || 0).toLocaleString("zh-CN") }}</b><em>成功率 {{ runStats.records ? ((runStats.success / runStats.records) * 100).toFixed(2) + "%" : "—" }}</em></div>
      <div class="lq-result-card"><span>异常记录</span><b>{{ runStats.exceptions || 0 }}</b><em>排除 {{ runStats.excluded || 0 }} 条</em></div>
    </div>

    <div class="panel">
      <div class="panel-head"><h3>产品维度结果</h3><span class="sub">第二层：产品明细汇总</span></div>
      <div class="panel-body tight">
        <table class="tbl">
          <thead><tr><th>产品</th><th class="num">记录数</th><th class="num">成功</th><th class="num">异常</th><th class="num">金额</th><th class="num">结果摘要</th></tr></thead>
          <tbody>
            <tr v-for="product in (taskResult ? taskResult.products : [])" :key="product.productCode">
              <td>{{ product.productName }}<div class="mono dim" style="font-size: 10.5px">{{ product.productCode }}</div></td>
              <td class="num mono">{{ product.records }}</td>
              <td class="num mono">{{ product.success }}</td>
              <td class="num mono" :class="{ danger: product.exceptions }">{{ product.exceptions }}</td>
              <td class="num mono">{{ money(product.amount) }}</td>
              <td class="mono small">{{ { ASSET: "HQLA", INFLOW: "现金流入", OUTFLOW: "现金流出" }[product.side] }} {{ money(product.contribution) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head">
        <h3>逐笔结果（{{ resultTotal }}）</h3>
        <span class="spacer"></span>
        <select v-model="resultFilter.productCode" @change="onResultFilter">
          <option value="">全部产品</option>
          <option v-for="product in productOptions" :key="product.code" :value="product.code">{{ product.name }}（{{ product.code }}）</option>
        </select>
        <input v-model="resultFilter.q" type="search" placeholder="搜索业务编号或记录编号" style="width: 200px" @keyup.enter="onResultFilter" />
        <button type="button" class="btn sm" @click="onResultFilter">筛选</button>
        <button type="button" class="btn sm" :disabled="!results.length" @click="exportResults">导出当前结果</button>
      </div>
      <div class="panel-body tight">
        <table class="tbl">
          <thead><tr><th>数据集</th><th>记录</th><th>产品</th><th>业务编号</th><th class="num">金额</th><th class="num">贡献</th><th>等级 / 类别</th><th></th></tr></thead>
          <tbody>
            <tr v-for="row in results" :key="row.id">
              <td class="mono small">{{ row.datasetId }}</td>
              <td class="mono small">{{ row.recordId }}</td>
              <td>{{ row.productName || row.productCode }}<div class="mono dim" style="font-size: 10.5px">{{ row.productCode }}</div></td>
              <td class="mono small">{{ row.businessId || "—" }}</td>
              <td class="num mono">{{ money(row.rawAmount) }}</td>
              <td class="num mono"><b>{{ money(row.amount) }}</b></td>
              <td class="small">{{ row.level || "—" }}<div class="dim">{{ row.category || "" }}</div></td>
              <td class="num"><button type="button" class="btn sm" @click="openRow(row)">查看</button></td>
            </tr>
          </tbody>
        </table>
        <div class="inline-fields" style="margin-top: 10px; justify-content: flex-end">
          <button type="button" class="btn sm" :disabled="resultPage <= 1" @click="goResultPage(-1)">上一页</button>
          <span class="dim">第 {{ resultPage }} / {{ resultPageCount }} 页</span>
          <button type="button" class="btn sm" :disabled="resultPage >= resultPageCount" @click="goResultPage(1)">下一页</button>
        </div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head">
        <h3>计算异常（{{ exceptionTotal }}）</h3>
        <span class="spacer"></span>
        <select v-model="exceptionFilter.level" @change="onExceptionFilter">
          <option value="">全部级别</option><option value="WARN">警告</option><option value="BLOCK">阻断</option>
        </select>
        <input v-model="exceptionFilter.q" type="search" placeholder="搜索异常原因" style="width: 200px" @keyup.enter="onExceptionFilter" />
        <button type="button" class="btn sm" @click="onExceptionFilter">筛选</button>
        <button type="button" class="btn sm" :disabled="!exceptions.length" @click="exportExceptions">导出异常</button>
      </div>
      <div class="panel-body tight">
        <table class="tbl">
          <thead><tr><th>级别</th><th>数据集</th><th>记录</th><th>产品</th><th>原因</th><th>状态</th></tr></thead>
          <tbody>
            <tr v-for="row in exceptions" :key="row.id">
              <td><span class="tag" :class="row.level === 'BLOCK' ? 'red' : 'amber'">{{ row.level }}</span></td>
              <td class="mono small">{{ row.datasetId }}</td>
              <td class="mono small">{{ row.recordId || "—" }}</td>
              <td class="mono small">{{ row.productCode || "—" }}</td>
              <td class="small">{{ row.message }}</td>
              <td><span class="tag muted">{{ row.status }}</span></td>
            </tr>
          </tbody>
        </table>
        <div class="inline-fields" style="margin-top: 10px; justify-content: flex-end">
          <button type="button" class="btn sm" :disabled="exceptionPage <= 1" @click="goExceptionPage(-1)">上一页</button>
          <span class="dim">第 {{ exceptionPage }} / {{ exceptionPageCount }} 页</span>
          <button type="button" class="btn sm" :disabled="exceptionPage >= exceptionPageCount" @click="goExceptionPage(1)">下一页</button>
        </div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head"><h3>结果输出</h3><span class="sub">当前批次 {{ runId }}</span></div>
      <div class="panel-body">
        <p class="dim" style="font-size: 12px; margin: 0 0 10px">
          计算结果已保存为独立批次。可直接导出 Excel 底稿，或返回主任务继续处理其他模块。
        </p>
        <button type="button" class="btn primary" @click="finish">返回主任务</button>
      </div>
    </div>
  </template>

  <Drawer :open="drawer" title="计算证据链" @close="drawer = false">
    <template v-if="activeRow">
      <div class="kv small">
        <div class="k">数据集 / 记录</div><div class="mono">{{ activeRow.datasetId }} · {{ activeRow.recordId }}</div>
        <div class="k">业务主键</div><div class="mono">{{ activeRow.businessId || "—" }}</div>
        <div class="k">产品</div><div>{{ activeRow.productName }} · {{ activeRow.productCode }}</div>
        <div class="k">计量侧别</div><div>{{ { ASSET: "资产端", INFLOW: "现金流入", OUTFLOW: "现金流出" }[activeRow.side] }}</div>
      </div>
      <h4>参数与公式</h4>
      <div class="formula">
        金额 {{ money(activeRow.rawAmount) }} × 系数 {{ activeRow.rate }}
        <span v-if="activeRow.level"> · {{ activeRow.level }}</span>
        <br>{{ (activeRow.detail && activeRow.detail.basis) || "参数表依据" }}
      </div>
      <h4>结果</h4>
      <div class="kv small">
        <div class="k">计量贡献</div><div class="mono"><b>{{ money(activeRow.amount) }}</b></div>
        <div class="k">类别</div><div>{{ activeRow.category || "—" }}</div>
      </div>
    </template>
  </Drawer>
</template>

<style scoped>
.lq-result-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin-bottom: 12px; }
.lq-result-card { background: #fff; border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; }
.lq-result-card span { display: block; font-size: 11.5px; color: var(--muted); }
.lq-result-card b { display: block; font-size: 20px; }
.lq-result-card em { font-style: normal; font-size: 11px; color: var(--muted); }
@media (max-width: 900px) { .lq-result-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style>
