<script setup>
import { computed, onMounted, ref } from "vue";
import { listQualityIssues, listQualityRuns, runQuality } from "@/api/hqla";

const props = defineProps({ task: Object, reload: Function });

const busy = ref(false);
const error = ref("");
const runs = ref([]);
const runId = ref("");
const issues = ref([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(50);
const filters = ref({ level: "", datasetId: "", q: "" });

const datasets = computed(() => (props.task && props.task.datasets) || []);
const run = computed(() => runs.value.find((item) => item.id === runId.value) || runs.value[0] || null);
const summary = computed(() => (run.value && run.value.summary) || null);
const pageCount = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)));
const LEVEL = { BLOCK: { label: "阻断", tone: "red" }, WARN: { label: "警告", tone: "amber" }, INFO: { label: "提示", tone: "blue" } };

function levelOf(value) {
  return LEVEL[value] || { label: value || "—", tone: "muted" };
}

function datasetSheet(id) {
  const found = datasets.value.find((item) => item.id === id);
  return found ? found.sheet : id;
}

function money(value) {
  if (value == null || Number.isNaN(Number(value))) return "—";
  return Number(value).toLocaleString("zh-CN");
}

async function loadRuns() {
  runs.value = await listQualityRuns(props.task.id);
  if (!runs.value.some((item) => item.id === runId.value)) runId.value = runs.value[0] ? runs.value[0].id : "";
}

async function loadIssues() {
  if (!run.value) { issues.value = []; total.value = 0; return; }
  const result = await listQualityIssues(props.task.id, {
    runId: run.value.id,
    level: filters.value.level || undefined,
    datasetId: filters.value.datasetId || undefined,
    q: filters.value.q || undefined,
    page: page.value,
    pageSize: pageSize.value
  });
  issues.value = result.rows || [];
  total.value = Number(result.total) || 0;
}

async function load() {
  busy.value = true;
  error.value = "";
  try {
    await loadRuns();
    await loadIssues();
  } catch (err) {
    error.value = err.message;
  } finally {
    busy.value = false;
  }
}

async function execute() {
  busy.value = true;
  error.value = "";
  try {
    const result = await runQuality(props.task.id);
    runId.value = result.run.id;
    await load();
    if (props.reload) await props.reload();
  } catch (err) {
    error.value = err.message;
  } finally {
    busy.value = false;
  }
}

function onFilter() {
  page.value = 1;
  loadIssues();
}

function goPage(delta) {
  const next = Math.min(pageCount.value, Math.max(1, page.value + delta));
  if (next !== page.value) {
    page.value = next;
    loadIssues();
  }
}

onMounted(load);
</script>

<template>
  <p v-if="error" class="notice danger">{{ error }}</p>

  <div class="panel">
    <div class="panel-head">
      <h3>数据质量检查</h3>
      <span class="tag" :class="summary ? (summary.hasBlock ? 'red' : summary.hasWarn ? 'amber' : 'green') : 'muted'">
        {{ summary ? (summary.hasBlock ? "存在阻断" : summary.hasWarn ? "存在警告" : "全部通过") : "待检查" }}
      </span>
      <span class="spacer"></span>
      <select v-model="runId" @change="loadIssues" style="width: auto; min-width: 180px">
        <option value="">选择检查批次</option>
        <option v-for="item in runs" :key="item.id" :value="item.id">
          {{ item.id }} · 输入版本 v{{ item.inputVersion }} · {{ item.status }}
        </option>
      </select>
      <button type="button" class="btn sm primary" :disabled="busy || !datasets.length" @click="execute">
        {{ busy ? "检查中…" : "执行质量检查" }}
      </button>
    </div>
    <div class="panel-body">
      <p class="dim" style="font-size: 12px; margin: 0 0 10px">
        四层检查：数据结构 → 字段质量 → 业务逻辑 → 监管参数。BLOCK 阻止正式计算，WARN 允许继续但需要披露。
      </p>
      <div v-if="!datasets.length" class="empty">请先在第二步导入 Excel 数据。</div>
      <template v-else-if="summary">
        <div class="lq-statrow">
          <div class="lq-mini"><span>记录总数</span><b>{{ money(summary.total) }}</b></div>
          <div class="lq-mini"><span>通过</span><b>{{ money(summary.pass) }}</b></div>
          <div class="lq-mini"><span>阻断记录</span><b :class="{ danger: summary.block }">{{ money(summary.block) }}</b></div>
          <div class="lq-mini"><span>警告记录</span><b>{{ money(summary.warn) }}</b></div>
          <div class="lq-mini"><span>问题数</span><b>{{ money(summary.issues) }}</b></div>
        </div>
        <table class="tbl" style="margin-bottom: 10px">
          <thead><tr><th>数据集</th><th class="num">记录数</th><th>结果</th><th>缺失必需字段</th><th>检查项</th></tr></thead>
          <tbody>
            <tr v-for="item in summary.datasets" :key="item.datasetId">
              <td>{{ item.sheet }}</td>
              <td class="num mono">{{ money(item.records) }}</td>
              <td>
                <span class="tag" :class="item.status === 'BLOCK' ? 'red' : item.status === 'WARN' ? 'amber' : 'green'">
                  {{ item.status === "BLOCK" ? "阻断" : item.status === "WARN" ? "警告" : "通过" }}
                </span>
              </td>
              <td class="small dim">{{ (item.missingRequired || []).join("、") || "—" }}</td>
              <td class="small dim">{{ (item.checks || []).map((check) => check.type + "：" + check.status).join(" · ") || "—" }}</td>
            </tr>
          </tbody>
        </table>
        <div class="inline-fields" style="margin-bottom: 8px">
          <select v-model="filters.level" @change="onFilter">
            <option value="">全部级别</option>
            <option value="BLOCK">阻断</option>
            <option value="WARN">警告</option>
            <option value="INFO">提示</option>
          </select>
          <select v-model="filters.datasetId" @change="onFilter">
            <option value="">全部数据集</option>
            <option v-for="dataset in datasets" :key="dataset.id" :value="dataset.id">{{ dataset.sheet }}</option>
          </select>
          <input v-model="filters.q" type="search" placeholder="搜索问题描述" style="flex: 1; min-width: 180px" @keyup.enter="onFilter" />
          <span class="spacer"></span>
          <span class="dim">共 {{ total }} 条 · 第 {{ page }} / {{ pageCount }} 页</span>
        </div>
        <table class="tbl">
          <thead><tr><th>级别</th><th>数据集 / 行</th><th>产品</th><th>字段</th><th>类型</th><th>问题描述</th><th>状态</th></tr></thead>
          <tbody>
            <tr v-for="item in issues" :key="item.id">
              <td><span class="tag" :class="levelOf(item.level).tone">{{ levelOf(item.level).label }}</span></td>
              <td>{{ datasetSheet(item.datasetId) }}<div class="mono dim" style="font-size: 10.5px">第 {{ item.rowNo }} 行</div></td>
              <td class="mono small">{{ item.productCode || "—" }}</td>
              <td class="mono small">{{ item.fieldCode || "—" }}</td>
              <td class="small">{{ item.issueType }}</td>
              <td class="small">{{ item.message }}</td>
              <td><span class="tag muted">{{ item.status }}</span></td>
            </tr>
          </tbody>
        </table>
        <p v-if="!issues.length" class="empty">没有符合条件的问题。</p>
        <div v-if="pageCount > 1" class="inline-fields" style="margin-top: 10px; justify-content: flex-end">
          <button type="button" class="btn sm" :disabled="page <= 1" @click="goPage(-1)">上一页</button>
          <span class="dim">第 {{ page }} / {{ pageCount }} 页</span>
          <button type="button" class="btn sm" :disabled="page >= pageCount" @click="goPage(1)">下一页</button>
        </div>
        <p v-if="summary.hasBlock" class="notice warn" style="margin-top: 10px">
          存在阻断问题。正式计算默认不能继续；如需对可计算记录做部分计算，请在下一步勾选「允许部分计算」。
        </p>
      </template>
      <div v-else class="empty">还没有质量检查结果。点击「执行质量检查」开始。</div>
    </div>
  </div>
</template>

<style scoped>
.lq-statrow { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 8px; margin-bottom: 10px; }
.lq-mini { background: #f8fafc; border: 1px solid var(--line); border-radius: 9px; padding: 8px 10px; }
.lq-mini span { display: block; font-size: 11px; color: var(--muted); }
.lq-mini b { font-size: 18px; }
.lq-mini b.danger { color: #b42318; }
@media (max-width: 900px) { .lq-statrow { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style>
