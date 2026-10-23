<script setup>
import { ref } from "vue";
import { useRoute } from "vue-router";
import { fetchBatch, fetchMeasure } from "@/api/batch";
import AsyncView from "@/components/AsyncView.vue";
import Drawer from "@/components/Drawer.vue";

const route = useRoute();
const product = ref("");
function loadMeasure() {
  return route.query.batch ? fetchBatch(String(route.query.batch)) : fetchMeasure();
}
const klass = ref("");
const status = ref("");
const word = ref("");
const onlyBad = ref(false);
const picked = ref(null);

const STATUS = { ok: "正常", warning: "待复核", exception: "异常" };
const TONE = { ok: "ok", warning: "warn", exception: "danger" };

function money(value) {
  if (value == null || Number.isNaN(Number(value))) return "—";
  return Number(value).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function shortMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e8) return (n / 1e8).toFixed(2) + " 亿";
  if (abs >= 1e4) return (n / 1e4).toFixed(2) + " 万";
  return n.toFixed(2);
}
function pct(value) {
  if (value == null || Number.isNaN(Number(value))) return "—";
  return +(Number(value) * 100).toFixed(2) + "%";
}

function rowsOf(data) {
  const q = word.value.trim();
  return (data.results || []).filter((row) => {
    if (product.value && row.product !== product.value) return false;
    if (klass.value && (row.exposureClass || "未分类") !== klass.value) return false;
    if (status.value && row.status !== status.value) return false;
    if (onlyBad.value && row.status === "ok") return false;
    if (!q) return true;
    return [row.loanId, row.customer, row.name, row.matchedRule].join(" ").includes(q);
  });
}

const classesOf = (data) => [...new Set((data.results || []).map((row) => row.exposureClass).filter(Boolean))];
</script>

<template>
  <AsyncView :load="loadMeasure">
    <template #default="{ data }">
      <div class="grid c4" style="margin-bottom: 14px">
        <div class="kpi accent">
          <div class="k-label">债项总数</div>
          <div class="k-value">{{ data.summary.total }}</div>
          <div class="k-foot">{{ data.batchId || "BATCH-AUTO-MO-01" }} · {{ data.version || "MO-SA-2026.1" }}</div>
        </div>
        <div class="kpi">
          <div class="k-label">EAD 合计</div>
          <div class="k-value">{{ shortMoney(data.summary.ead) }}</div>
          <div class="k-foot">表内 {{ shortMoney(data.summary.onEad) }} · 表外 {{ shortMoney(data.summary.offEad) }}</div>
        </div>
        <div class="kpi accent">
          <div class="k-label">信用风险 RWA</div>
          <div class="k-value">{{ shortMoney(data.summary.rwa) }}</div>
          <div class="k-foot">平均权重 {{ pct(data.summary.rwaRate) }}</div>
        </div>
        <div class="kpi">
          <div class="k-label">异常 / 待复核</div>
          <div class="k-value sm">{{ data.summary.exception }} / {{ data.summary.warning }}</div>
          <div class="k-foot">{{ data.summary.exception ? "需人工处理" : "无阻断异常" }}</div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-head">
          <h3>逐笔计量结果明细表</h3>
          <span class="sub">{{ rowsOf(data).length }} 笔 · 规则 {{ data.ruleset }}</span>
        </div>
        <div class="inline-fields" style="padding: 12px 15px 2px">
          <div class="field">
            <label>产品类型</label>
            <select v-model="product">
              <option value="">全部产品</option>
              <option v-for="(label, code) in data.products" :key="code" :value="code">{{ label }}</option>
            </select>
          </div>
          <div class="field">
            <label>暴露大类</label>
            <select v-model="klass">
              <option value="">全部暴露大类</option>
              <option v-for="name in classesOf(data)" :key="name" :value="name">{{ name }}</option>
            </select>
          </div>
          <div class="field">
            <label>计量状态</label>
            <select v-model="status">
              <option value="">全部计量状态</option>
              <option value="ok">正常</option>
              <option value="warning">待复核</option>
              <option value="exception">异常</option>
            </select>
          </div>
          <div class="field grow">
            <label>关键字搜索</label>
            <input v-model="word" type="text" placeholder="债项编号、客户编号或命中规则" />
          </div>
          <div class="field check">
            <label>&nbsp;</label>
            <label class="checkline"><input v-model="onlyBad" type="checkbox" /> 只看异常和待复核</label>
          </div>
        </div>
        <div class="panel-body tight">
          <div class="table-wrap">
          <table class="tbl compact">
            <thead>
              <tr>
                <th>债项编号</th><th>客户编号</th><th>产品类型</th><th>原始余额</th>
                <th>暴露大类</th><th>暴露子类</th><th>命中规则</th><th>风险权重</th>
                <th>表内 EAD</th><th>表外 EAD</th><th>信用风险 RWA</th><th>计量状态</th><th>监管依据</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in rowsOf(data)" :key="row.loanId" class="clickable" @click="picked = row">
                <td class="mono">{{ row.loanId }}</td>
                <td class="mono">{{ row.customer }}</td>
                <td>{{ data.products[row.product] || row.product || "未识别" }}</td>
                <td class="num">{{ money(row.balance) }}</td>
                <td><span class="tag" :class="row.exposureClass ? 'brand' : 'danger'">{{ row.exposureClass || "未分类" }}</span></td>
                <td>{{ row.exposureSubClass || "—" }}</td>
                <td class="mono">{{ row.matchedRule || "—" }}</td>
                <td class="num">{{ pct(row.riskWeight) }}</td>
                <td class="num">{{ money(row.onEad) }}</td>
                <td class="num">{{ money(row.offEad) }}</td>
                <td class="num">{{ money(row.rwa) }}</td>
                <td><span class="tag" :class="TONE[row.status] || 'muted'">{{ STATUS[row.status] || row.status }}</span></td>
                <td class="dim">{{ row.reference && row.reference.clause ? row.reference.clause : "—" }}</td>
              </tr>
            </tbody>
          </table>
          </div>
        </div>
      </div>

      <Drawer :open="!!picked" :title="picked ? picked.loanId + ' · ' + (picked.name || '') : ''" wide @close="picked = null">
        <template v-if="picked">
          <div class="grid c4" style="margin-bottom: 12px">
            <div class="kpi accent"><div class="k-label">暴露大类</div><div class="k-value sm">{{ picked.exposureClass || "未分类" }}</div></div>
            <div class="kpi"><div class="k-label">风险权重</div><div class="k-value sm">{{ pct(picked.riskWeight) }}</div></div>
            <div class="kpi"><div class="k-label">EAD</div><div class="k-value sm">{{ money(picked.ead) }}</div></div>
            <div class="kpi"><div class="k-label">RWA</div><div class="k-value sm">{{ money(picked.rwa) }}</div></div>
          </div>
          <div class="panel">
            <div class="panel-head"><h3>这一笔</h3></div>
            <div class="panel-body">
              <div class="kv">
                <div class="k">客户</div><div class="v">{{ picked.customer }} · {{ picked.name }}</div>
                <div class="k">产品</div><div class="v">{{ data.products[picked.product] || picked.product || "未识别" }}</div>
                <div class="k">暴露子类</div><div class="v">{{ picked.exposureSubClass || "—" }}</div>
                <div class="k">命中规则</div><div class="v mono">{{ picked.matchedRule || "—" }}</div>
                <div class="k">表内 / 表外 EAD</div><div class="v">{{ money(picked.onEad) }} / {{ money(picked.offEad) }}</div>
                <div class="k">EAD 公式</div><div class="v">{{ picked.eadFormula || "—" }}</div>
                <div class="k">信用风险缓释</div><div class="v">{{ picked.crm && picked.crm.note ? picked.crm.note : "—" }}</div>
                <div class="k">监管依据</div><div class="v">{{ picked.reference ? (picked.reference.doc || "") + " " + (picked.reference.clause || "") : "—" }}</div>
              </div>
            </div>
          </div>
          <div v-if="picked.exceptions && picked.exceptions.length" class="panel">
            <div class="panel-head"><h3>提示</h3></div>
            <div class="panel-body">
              <div v-for="(item, index) in picked.exceptions" :key="index" class="notice" :class="item.level === 'error' ? 'danger' : item.level === 'warn' ? 'warn' : 'info'">
                <span class="ni">{{ item.level === 'error' || item.level === 'warn' ? '!' : 'ℹ' }}</span>
                <div>{{ item.text }}</div>
              </div>
            </div>
          </div>
          <div v-if="picked.eadSteps && picked.eadSteps.length" class="panel">
            <div class="panel-head"><h3>EAD 计算步骤</h3></div>
            <div class="panel-body">
              <div v-for="(step, index) in picked.eadSteps" :key="index" class="step-line">
                <div>{{ step.n }}. {{ step.label }} <span class="mono">{{ step.display || step.value }}</span></div>
                <div v-if="step.note" class="dim">{{ step.note }}</div>
              </div>
            </div>
          </div>
        </template>
      </Drawer>
    </template>
  </AsyncView>
</template>
