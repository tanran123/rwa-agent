<script setup>
import { computed, onMounted, ref } from "vue";
import { computeRun, getPreflight, listRuns } from "@/api/hqla";

const props = defineProps({ task: Object, reload: Function });

const busy = ref(false);
const error = ref("");
const preflight = ref(null);
const runs = ref([]);
const allowPartial = ref(false);

const result = computed(() => {
  const summary = (props.task && props.task.summary) || null;
  return summary && summary.calculation ? summary.calculation : null;
});
const currentRun = computed(() => (props.task && props.task.currentRun) || runs.value[0] || null);
const datasets = computed(() => (props.task && props.task.datasets) || []);
const gate = computed(() => preflight.value || { ok: false, checks: [], blocking: [], warnings: [] });

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

async function load() {
  busy.value = true;
  error.value = "";
  try {
    preflight.value = await getPreflight(props.task.id, allowPartial.value);
    runs.value = await listRuns(props.task.id);
  } catch (err) {
    error.value = err.message;
  } finally {
    busy.value = false;
  }
}

async function run() {
  busy.value = true;
  error.value = "";
  try {
    await computeRun(props.task.id, { allowPartial: allowPartial.value });
    await load();
    if (props.reload) await props.reload();
  } catch (err) {
    error.value = err.message;
  } finally {
    busy.value = false;
  }
}

async function togglePartial(value) {
  allowPartial.value = value;
  await load();
}

onMounted(load);
</script>

<template>
  <p v-if="error" class="notice danger">{{ error }}</p>

  <div class="panel">
    <div class="panel-head">
      <h3>计算前检查</h3>
      <span class="tag" :class="gate.ok ? 'green' : 'red'">{{ gate.ok ? "可以计算" : "存在阻断" }}</span>
      <span class="spacer"></span>
      <label class="inline-fields" style="font-size: 12px; gap: 6px">
        <input type="checkbox" :checked="allowPartial" @change="togglePartial($event.target.checked)" />
        允许部分计算（排除 BLOCK 记录）
      </label>
      <button type="button" class="btn sm" :disabled="busy" @click="load">重新检查</button>
    </div>
    <div class="panel-body tight">
      <table class="tbl">
        <thead><tr><th>检查项</th><th>结果</th><th>说明</th></tr></thead>
        <tbody>
          <tr v-for="check in gate.checks" :key="check.key">
            <td>{{ check.label }}</td>
            <td>
              <span class="tag" :class="check.status === 'PASS' ? 'green' : check.status === 'WARN' ? 'amber' : 'red'">
                {{ check.status === "PASS" ? "通过" : check.status === "WARN" ? "警告" : "阻断" }}
              </span>
            </td>
            <td class="small dim">{{ check.detail }}</td>
          </tr>
        </tbody>
      </table>
      <p v-if="gate.blocking.length" class="notice danger" style="margin-top: 8px">
        {{ gate.blocking.join("；") }}
      </p>
      <p v-if="gate.excludedRecordIds && gate.excludedRecordIds.length" class="notice warn" style="margin-top: 8px">
        按部分计算将排除 {{ gate.excludedRecordIds.length }} 条记录，并在计算统计和异常清单中披露。
      </p>
    </div>
  </div>

  <div class="panel">
    <div class="panel-head">
      <h3>自动计量计算</h3>
      <span class="tag" :class="runStatus(currentRun).tone">{{ runStatus(currentRun).label }}</span>
      <span class="spacer"></span>
      <button type="button" class="btn sm primary" :disabled="busy || !gate.ok" @click="run">
        {{ busy ? "计算中…" : currentRun ? "重新计算" : "执行计算" }}
      </button>
    </div>
    <div class="panel-body">
      <p class="dim" style="font-size: 12px; margin: 0 0 10px">
        计算只读取任务配置快照、逐笔产品确认和字段对应；每次计算形成独立批次，保存快照、输入版本和引擎版本。
      </p>
      <div class="lq-chain">
        <div v-for="(item, index) in [
          ['数据标准化', 'Excel 原始列 → 标准字段'],
          ['产品确认与字段对应', '逐笔产品和字段准备'],
          ['规则路由', '按产品和侧别匹配参数'],
          ['监管计算', '折扣率 / 流入率 / 流出率'],
          ['指标汇总', 'HQLA → 现金流入流出 → LCR']
        ]" :key="item[0]" class="lq-chain-node">
          <b>{{ index + 1 }}. {{ item[0] }}</b>
          <span>{{ item[1] }}</span>
        </div>
      </div>

      <div v-if="result" class="lq-result-grid" style="margin-top: 12px">
        <div class="lq-result-card"><span>流动性覆盖率（LCR）</span><b>{{ pct(result.lcr) }}</b><em>监管下限 {{ pct((result.metrics.lcrMin || 1) * 100) }}</em></div>
        <div class="lq-result-card"><span>HQLA</span><b>{{ money(result.metrics.hqla) }}</b><em>调整前 {{ money(result.metrics.hqlaBeforeCaps) }}</em></div>
        <div class="lq-result-card"><span>现金流入</span><b>{{ money(result.metrics.inflow) }}</b><em>认可 {{ money(result.metrics.recognizedInflow) }}</em></div>
        <div class="lq-result-card"><span>现金流出</span><b>{{ money(result.metrics.outflow) }}</b><em>净流出 {{ money(result.metrics.netOutflow) }}</em></div>
      </div>
      <table v-if="result" class="tbl" style="margin-top: 12px">
        <thead><tr><th>产品</th><th>侧别</th><th class="num">记录数</th><th class="num">成功</th><th class="num">异常</th><th class="num">金额</th><th class="num">计量贡献</th><th>参数键</th></tr></thead>
        <tbody>
          <tr v-for="product in result.products" :key="product.productCode">
            <td>{{ product.productName }}<div class="mono dim" style="font-size: 10.5px">{{ product.productCode }}</div></td>
            <td class="small">{{ { ASSET: "资产端", INFLOW: "现金流入", OUTFLOW: "现金流出" }[product.side] || product.side }}</td>
            <td class="num mono">{{ product.records }}</td>
            <td class="num mono">{{ product.success }}</td>
            <td class="num mono" :class="{ danger: product.exceptions }">{{ product.exceptions }}</td>
            <td class="num mono">{{ money(product.amount) }}</td>
            <td class="num mono">{{ money(product.contribution) }}</td>
            <td class="mono small">{{ product.rateKey }}<span v-if="product.rate != null" class="dim"> · {{ product.rate }}</span></td>
          </tr>
        </tbody>
      </table>
      <div v-if="!datasets.length" class="empty">请先完成数据导入、产品识别和字段对应。</div>
    </div>
  </div>

  <div v-if="runs.length" class="panel">
    <div class="panel-head"><h3>计算批次</h3><span class="sub">{{ runs.length }} 次计算</span></div>
    <div class="panel-body tight">
      <table class="tbl">
        <thead><tr><th>批次</th><th>输入版本</th><th>快照</th><th>引擎</th><th>状态</th><th class="num">记录</th><th class="num">异常</th><th>开始</th><th>完成</th></tr></thead>
        <tbody>
          <tr v-for="item in runs" :key="item.id">
            <td class="mono small">{{ item.id }}<div class="dim">#{{ item.runNo }}</div></td>
            <td class="mono">v{{ item.inputVersion }}</td>
            <td class="mono small">{{ item.snapshotId || "—" }}</td>
            <td class="mono small">{{ item.engineVersion }}</td>
            <td><span class="tag" :class="runStatus(item).tone">{{ runStatus(item).label }}</span></td>
            <td class="num mono">{{ (item.stats && item.stats.records) || 0 }}</td>
            <td class="num mono" :class="{ danger: item.exceptionCount }">{{ item.exceptionCount }}</td>
            <td class="small dim">{{ item.startedAt }}</td>
            <td class="small dim">{{ item.finishedAt || "—" }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.lq-chain { display: flex; flex-direction: column; gap: 6px; }
.lq-chain-node { border: 1px solid var(--line); background: #f8fafc; border-radius: 9px; padding: 8px 11px; display: flex; flex-direction: column; gap: 2px; }
.lq-chain-node b { font-size: 12.5px; }
.lq-chain-node span { font-size: 11.5px; color: var(--muted); }
.lq-result-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
.lq-result-card { border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; }
.lq-result-card span { display: block; font-size: 11.5px; color: var(--muted); }
.lq-result-card b { display: block; font-size: 19px; }
.lq-result-card em { font-style: normal; font-size: 11px; color: var(--muted); }
@media (max-width: 900px) { .lq-result-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style>
