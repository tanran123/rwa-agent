<script setup>
import { computed, ref } from "vue";
import Drawer from "@/components/Drawer.vue";

const props = defineProps({ task: Object, finish: Function });
const drawer = ref(false);
const activeRow = ref(null);
const checks = ref({ hqla: false, exceptions: false, params: false });

const result = computed(() => {
  const summary = (props.task && props.task.summary) || null;
  return summary && summary.calculation ? summary.calculation : null;
});
const reviewed = computed(() => !!(props.task && props.task.cfg && props.task.cfg.review && props.task.cfg.review.status === "reviewed"));
const allChecked = computed(() => checks.value.hqla && checks.value.exceptions && checks.value.params);

function money(value) {
  if (value == null || Number.isNaN(Number(value))) return "—";
  return Number(value).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function pct(value) {
  return value == null ? "—" : Number(value).toFixed(2) + "%";
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

function exportResult() {
  if (!result.value) return;
  const rows = [["product_code", "product_name", "side", "records", "success", "exceptions", "amount", "contribution", "param_key", "rate"]];
  result.value.products.forEach((item) => rows.push([
    item.productCode, item.productName, item.side, item.records, item.success,
    item.exceptions, item.amount, item.contribution, item.rateKey, item.rate
  ]));
  csv(`lcr_result_${props.task.id}.csv`, rows);
}

function exportExceptions() {
  if (!result.value) return;
  const rows = [["dataset", "row_no", "business_id", "product_code", "reason"]];
  (result.value.exceptions || []).forEach((item) => rows.push([
    item.dataset, item.rowNo, item.businessId, item.productCode, item.reason
  ]));
  csv(`lcr_exceptions_${props.task.id}.csv`, rows);
}

function exportEvidence() {
  if (!result.value) return;
  const rows = [["dataset", "row_no", "business_id", "product", "side", "amount_field", "amount", "rate_key", "rate", "level", "contribution"]];
  (result.value.rows || []).forEach((item) => rows.push([
    item.dataset, item.rowNo, item.businessId, item.productCode, item.side,
    item.amountField, item.amount, item.rateKey, item.rate, item.level, item.contribution
  ]));
  csv(`lcr_evidence_${props.task.id}.csv`, rows);
}
</script>

<template>
  <div v-if="!result" class="panel">
    <div class="panel-body">
      <div class="empty">还没有计算结果。请先在第六步执行「自动计量计算」。</div>
    </div>
  </div>

  <template v-else>
    <div class="lq-result-grid">
      <div class="lq-result-card"><span>流动性覆盖率（LCR）</span><b>{{ pct(result.lcr) }}</b><em>监管下限 {{ pct((result.metrics.lcrMin || 1) * 100) }}</em></div>
      <div class="lq-result-card"><span>计算记录数</span><b>{{ (result.stats.records || 0).toLocaleString("zh-CN") }}</b><em>{{ result.stats.datasets }} 个数据集</em></div>
      <div class="lq-result-card"><span>成功处理</span><b>{{ (result.stats.success || 0).toLocaleString("zh-CN") }}</b><em>成功率 {{ result.stats.records ? ((result.stats.success / result.stats.records) * 100).toFixed(2) + "%" : "—" }}</em></div>
      <div class="lq-result-card"><span>异常记录</span><b>{{ result.stats.exceptions }}</b><em>可下钻查看</em></div>
    </div>

    <div class="panel">
      <div class="panel-head"><h3>产品维度结果</h3><span class="sub">第二层：产品明细汇总</span></div>
      <div class="panel-body tight">
        <table class="tbl">
          <thead><tr><th>产品</th><th class="num">记录数</th><th class="num">成功</th><th class="num">异常</th><th class="num">金额</th><th class="num">结果摘要</th></tr></thead>
          <tbody>
            <tr v-for="product in result.products" :key="product.productCode">
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

    <div class="grid c2">
      <div class="panel">
        <div class="panel-head"><h3>单笔业务追溯</h3><span class="sub">原始 Excel → 标准字段 → 规则判断 → 分类 → 折扣率 → 结果</span></div>
        <div class="panel-body tight">
          <table class="tbl">
            <thead><tr><th>数据集</th><th>行号</th><th>业务编号</th><th>产品</th><th class="num">金额</th><th class="num">贡献</th><th></th></tr></thead>
            <tbody>
              <tr v-for="(row, index) in (result.rows || []).slice(0, 12)" :key="index">
                <td>{{ row.dataset }}</td>
                <td class="mono">{{ row.rowNo }}</td>
                <td class="mono small">{{ row.businessId || "—" }}</td>
                <td>{{ row.productName || row.productCode }}</td>
                <td class="num mono">{{ money(row.amount) }}</td>
                <td class="num mono">{{ money(row.contribution) }}</td>
                <td class="num"><button type="button" class="btn sm" @click="openRow(row)">查看</button></td>
              </tr>
            </tbody>
          </table>
          <p class="dim" style="font-size: 11.5px; padding: 8px 10px 0">共 {{ (result.rows || []).length }} 条追溯记录（最多保留 500 条），导出底稿可查看。</p>
        </div>
      </div>
      <div class="panel">
        <div class="panel-head"><h3>输出与归档</h3></div>
        <div class="panel-body">
          <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 10px">
            <button type="button" class="btn primary" @click="exportResult">导出计量结果（CSV）</button>
            <button type="button" class="btn" @click="exportEvidence">导出计算底稿（CSV）</button>
            <button type="button" class="btn" @click="exportExceptions">导出异常清单（CSV）</button>
          </div>
          <p class="dim" style="font-size: 11.5px">导出内容：任务信息、版本快照、产品结果、异常清单、单笔追溯证据。</p>

          <div class="lq-review">
            <h4>复核确认</h4>
            <label class="chk"><input v-model="checks.hqla" type="checkbox" /> 已核对 HQLA 分档与上限调整</label>
            <label class="chk"><input v-model="checks.exceptions" type="checkbox" /> 已核对异常记录与数据质量结论</label>
            <label class="chk"><input v-model="checks.params" type="checkbox" /> 已核对规则版本、参数表与名单版本</label>
          </div>
          <div style="margin-top: 12px">
            <span v-if="reviewed" class="tag green">已复核并归档</span>
            <button v-else type="button" class="btn primary" :disabled="!allChecked" @click="finish">完成复核并归档</button>
          </div>
          <p v-if="!reviewed && !allChecked" class="dim" style="font-size: 11.5px; margin-top: 6px">三项复核都勾选后才能归档。</p>
        </div>
      </div>
    </div>
  </template>

  <Drawer :open="drawer" title="计算证据链" @close="drawer = false">
    <template v-if="activeRow">
      <div class="kv small">
        <div class="k">数据集 / 行号</div><div class="mono">{{ activeRow.dataset }} · 第 {{ activeRow.rowNo }} 行</div>
        <div class="k">业务主键</div><div class="mono">{{ activeRow.businessId || "—" }}</div>
        <div class="k">产品</div><div>{{ activeRow.productName }} · {{ activeRow.productCode }}</div>
        <div class="k">计量侧别</div><div>{{ { ASSET: "资产端", INFLOW: "现金流入", OUTFLOW: "现金流出" }[activeRow.side] }}</div>
      </div>
      <h4>规则执行路径</h4>
      <div class="pkg" style="margin-bottom: 6px"><span class="mono small">产品识别 → {{ activeRow.productCode }}</span></div>
      <div class="pkg" style="margin-bottom: 6px"><span class="mono small">字段 Mapping → Excel「{{ activeRow.amountField }}」</span></div>
      <div class="pkg" style="margin-bottom: 6px"><span class="mono small">参数查表 → {{ activeRow.rateKey }} = {{ activeRow.rate }}</span></div>
      <h4>参数与公式</h4>
      <div class="formula">
        金额 {{ money(activeRow.amount) }} × 系数 {{ activeRow.rate }}
        <span v-if="activeRow.level"> · {{ activeRow.level }}</span>
        <br>{{ activeRow.basis || "参数表依据" }}
      </div>
      <h4>结果</h4>
      <div class="kv small">
        <div class="k">计量贡献</div><div class="mono"><b>{{ money(activeRow.contribution) }}</b></div>
        <div class="k">执行时间</div><div class="mono small">{{ result.runAt }}</div>
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
.lq-review { border-top: 1px dashed var(--line); margin-top: 12px; padding-top: 10px; display: flex; flex-direction: column; gap: 6px; }
.lq-review h4 { margin: 0 0 2px; font-size: 12.5px; }
.lq-review label { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #334155; }
@media (max-width: 900px) { .lq-result-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style>
