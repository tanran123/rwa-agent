<script setup>
import { computed, ref } from "vue";
import { computeLcr, updateTask } from "@/api/hqla";

const props = defineProps({ task: Object, reload: Function });
const busy = ref(false);
const error = ref("");

const result = computed(() => {
  const summary = (props.task && props.task.summary) || null;
  return summary && summary.calculation ? summary.calculation : null;
});
const datasets = computed(() => (props.task && props.task.datasets) || []);

function money(value) {
  if (value == null || Number.isNaN(Number(value))) return "—";
  return Number(value).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function pct(value) {
  if (value == null) return "—";
  return Number(value).toFixed(2) + "%";
}

async function run() {
  busy.value = true;
  error.value = "";
  try {
    const computed = await computeLcr(props.task.id);
    const summary = {
      ...((props.task && props.task.summary) || {}),
      stats: computed.stats,
      metrics: computed.metrics,
      lcr: computed.lcr,
      calculation: computed,
      calculatedAt: computed.runAt
    };
    await updateTask(props.task.id, {
      status: "doing",
      step: Math.max(6, Number(props.task.step) || 6),
      summary,
      runAt: computed.runAt,
      config: { ...((props.task && props.task.cfg) || {}), review: { status: "pending", readyAt: computed.runAt } }
    });
    await props.reload();
  } catch (err) {
    error.value = err.message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <p v-if="error" class="notice danger">{{ error }}</p>

  <div class="panel">
    <div class="panel-head">
      <h3>自动计量计算</h3>
      <span class="tag" :class="result ? 'green' : 'muted'">{{ result ? "计算完成" : "待执行" }}</span>
      <span class="spacer"></span>
      <button type="button" class="btn sm primary" :disabled="busy || !datasets.length" @click="run">
        {{ busy ? "计算中…" : result ? "重新计算" : "执行计算" }}
      </button>
    </div>
    <div class="panel-body">
      <p class="dim" style="font-size: 12px; margin: 0 0 10px">
        规则路由与执行顺序由前序步骤自动确定：数据集 → 产品规则 → 明细计算 → 监管指标汇总。
      </p>
      <div class="lq-chain">
        <div v-for="(item, index) in [
          ['原始业务明细', 'Excel 数据按数据集标准化'],
          ['产品识别与字段 Mapping', '按产品字段契约校验'],
          ['产品规则路由', '按产品与监管领域匹配规则包'],
          ['规则引擎执行', '条件判断 / 名单匹配 / 分类路由 / 参数查表 / 数值计算'],
          ['监管指标汇总', 'HQLA → 现金流入流出 → LCR']
        ]" :key="item[0]" class="lq-chain-node">
          <b>{{ index + 1 }}. {{ item[0] }}</b>
          <span>{{ item[1] }}</span>
        </div>
      </div>

      <div v-if="!datasets.length" class="empty">请先完成数据导入、产品识别和字段 Mapping。</div>
      <table v-else class="tbl" style="margin-top: 12px">
        <thead><tr><th>数据集</th><th>产品</th><th class="num">记录数</th><th class="num">成功</th><th class="num">异常</th><th>状态</th></tr></thead>
        <tbody>
          <tr v-for="dataset in datasets" :key="dataset.id">
            <td>{{ dataset.sheet }}</td>
            <td>{{ dataset.productName || dataset.productCode || "—" }}</td>
            <td class="num mono">{{ (dataset.rows || []).length.toLocaleString("zh-CN") }}</td>
            <td class="num mono">{{ result && result.datasets ? ((result.datasets.find((item) => item.id === dataset.id) || {}).success || 0) : "—" }}</td>
            <td class="num mono">{{ result && result.datasets ? ((result.datasets.find((item) => item.id === dataset.id) || {}).exceptions || 0) : "—" }}</td>
            <td>
              <span class="tag" :class="dataset.quality && dataset.quality.status === 'BLOCK' ? 'red' : 'green'">
                {{ dataset.quality ? (dataset.quality.status === "BLOCK" ? "阻断" : "可计算") : "未检查" }}
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>

  <div v-if="result" class="panel">
    <div class="panel-head"><h3>计算结果</h3><span class="sub">执行时间 {{ result.runAt }}</span></div>
    <div class="panel-body">
      <div class="lq-result-grid">
        <div class="lq-result-card"><span>流动性覆盖率（LCR）</span><b>{{ pct(result.lcr) }}</b><em>监管下限 {{ pct((result.metrics.lcrMin || 1) * 100) }}</em></div>
        <div class="lq-result-card"><span>HQLA</span><b>{{ money(result.metrics.hqla) }}</b><em>上限调整前 {{ money(result.metrics.hqlaBeforeCaps) }}</em></div>
        <div class="lq-result-card"><span>现金流入</span><b>{{ money(result.metrics.inflow) }}</b><em>认可 {{ money(result.metrics.recognizedInflow) }}</em></div>
        <div class="lq-result-card"><span>现金流出</span><b>{{ money(result.metrics.outflow) }}</b><em>净流出 {{ money(result.metrics.netOutflow) }}</em></div>
      </div>
      <table class="tbl" style="margin-top: 12px">
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
