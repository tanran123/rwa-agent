<script setup>
import { ref, watch } from "vue";
import { useRoute } from "vue-router";
import { fetchBatch, fetchBatches } from "@/api/batch";
import { useContext } from "@/composables/useContext";
import AsyncView from "@/components/AsyncView.vue";
import Drawer from "@/components/Drawer.vue";

const route = useRoute();
const { session, scopeVersion } = useContext();
const product = ref("");
const batchId = ref(route.query.batch ? String(route.query.batch) : "");
watch(() => route.query.batch, (value) => { batchId.value = value ? String(value) : ""; });
async function loadMeasure() {
  const list = await fetchBatches();
  const batches = (list || [])
    .filter((row) => row.jurisdiction === session.jurisdiction && row.version === scopeVersion.value)
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  const details = await Promise.all(batches.map((row) => fetchBatch(row.id)));
  const products = {};
  const results = [];
  details.forEach((data) => {
    Object.assign(products, data.products || {});
    (data.results || []).forEach((line) => {
      results.push({ ...line, batchId: data.batchId, batchName: data.name || data.batchId });
    });
  });
  return { batches, products, results };
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
function stepShown(step) {
  if (!step) return "—";
  if (step.display) return step.display;
  if (typeof step.value === "number") return money(step.value);
  if (step.value == null || step.value === "") return "—";
  return String(step.value);
}

function rowsOf(data) {
  const q = word.value.trim();
  return (data.results || []).filter((row) => {
    if (batchId.value && row.batchId !== batchId.value) return false;
    if (product.value && row.product !== product.value) return false;
    if (klass.value && (row.exposureClass || "未分类") !== klass.value) return false;
    if (status.value && row.status !== status.value) return false;
    if (onlyBad.value && row.status === "ok") return false;
    if (!q) return true;
    return [row.batchName, row.loanId, row.customer, row.name, row.matchedRule].join(" ").includes(q);
  });
}

function summaryOf(data) {
  const rows = rowsOf(data);
  const summary = { total: rows.length, ok: 0, warning: 0, exception: 0, onEad: 0, offEad: 0, ead: 0, rwa: 0, rwaRate: 0 };
  rows.forEach((row) => {
    if (row.status === "ok") summary.ok += 1;
    else if (row.status === "warning") summary.warning += 1;
    else if (row.status === "exception") summary.exception += 1;
    summary.onEad += Number(row.onEad) || 0;
    summary.offEad += Number(row.offEad) || 0;
    summary.ead += Number(row.ead) || 0;
    summary.rwa += Number(row.rwa) || 0;
  });
  summary.rwaRate = summary.ead ? summary.rwa / summary.ead : 0;
  return summary;
}

function batchLabel(data) {
  const names = [...new Set(rowsOf(data).map((row) => row.batchName).filter(Boolean))];
  if (names.length === 1) return names[0];
  if (!names.length) {
    const picked = (data.batches || []).find((row) => row.id === batchId.value);
    return picked ? picked.name : "没有批次";
  }
  return "共 " + names.length + " 个批次";
}

const classesOf = (data) => [...new Set((data.results || []).map((row) => row.exposureClass).filter(Boolean))];
</script>

<template>
  <AsyncView :load="loadMeasure">
    <template #default="{ data }">
      <div class="grid c4" style="margin-bottom: 14px">
        <div class="kpi accent">
          <div class="k-label">债项总数</div>
          <div class="k-value">{{ summaryOf(data).total }}</div>
          <div class="k-foot">{{ batchLabel(data) }}</div>
        </div>
        <div class="kpi">
          <div class="k-label">EAD 合计</div>
          <div class="k-value">{{ shortMoney(summaryOf(data).ead) }}</div>
          <div class="k-foot">表内 {{ shortMoney(summaryOf(data).onEad) }} · 表外 {{ shortMoney(summaryOf(data).offEad) }}</div>
        </div>
        <div class="kpi accent">
          <div class="k-label">信用风险 RWA</div>
          <div class="k-value">{{ shortMoney(summaryOf(data).rwa) }}</div>
          <div class="k-foot">平均权重 {{ pct(summaryOf(data).rwaRate) }}</div>
        </div>
        <div class="kpi">
          <div class="k-label">异常 / 待复核</div>
          <div class="k-value sm">{{ summaryOf(data).exception }} / {{ summaryOf(data).warning }}</div>
          <div class="k-foot">{{ summaryOf(data).exception ? "需人工处理" : "无阻断异常" }}</div>
        </div>
      </div>

      <div class="panel" style="margin-bottom: 14px">
        <div class="panel-head">
          <h3>结果明细清单</h3>
          <span class="sub">{{ data.batches.length }} 次执行 · 按批次名称区分</span>
        </div>
        <div class="panel-body tight">
          <table class="tbl compact">
            <thead>
              <tr>
                <th>批次名称</th><th>基准日</th><th>版本</th><th>导入</th><th>成功</th><th>异常</th><th>EAD</th><th>RWA</th><th>状态</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in data.batches" :key="row.id" class="clickable" @click="batchId = batchId === row.id ? '' : row.id">
                <td>{{ row.name }}</td>
                <td>{{ row.baseDate }}</td>
                <td>{{ row.version }}</td>
                <td class="num">{{ row.imported }}</td>
                <td class="num">{{ row.success }}</td>
                <td class="num">{{ row.exception }}</td>
                <td class="num">{{ money(row.ead) }}</td>
                <td class="num">{{ money(row.rwa) }}</td>
                <td><span class="tag" :class="row.status === 'completed' ? 'ok' : row.status === 'failed' ? 'danger' : 'muted'">{{ row.status === "completed" ? "已完成" : row.status === "failed" ? "存在异常" : row.status === "running" ? "进行中" : row.status }}</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="panel">
        <div class="panel-head">
          <h3>逐笔计量结果明细表</h3>
          <span class="sub">{{ rowsOf(data).length }} 笔</span>
        </div>
        <div class="inline-fields" style="padding: 12px 15px 2px">
          <div class="field">
            <label>批次名称</label>
            <select v-model="batchId">
              <option value="">全部批次</option>
              <option v-for="row in data.batches" :key="row.id" :value="row.id">{{ row.name }}</option>
            </select>
          </div>
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
            <input v-model="word" type="text" placeholder="批次名称、债项编号、客户编号或命中规则" />
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
                <th>批次名称</th><th>债项编号</th><th>客户编号</th><th>产品类型</th><th>原始余额</th>
                <th>暴露大类</th><th>暴露子类</th><th>命中规则</th><th>风险权重</th>
                <th>表内 EAD</th><th>表外 EAD</th><th>信用风险 RWA</th><th>计量状态</th><th>监管依据</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in rowsOf(data)" :key="row.batchId + '-' + row.loanId" class="clickable" @click="picked = row">
                <td>{{ row.batchName }}</td>
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
                <div class="k">批次名称</div><div class="v">{{ picked.batchName }}</div>
                <div class="k">客户</div><div class="v">{{ picked.customer }} · {{ picked.name }}</div>
                <div class="k">产品</div><div class="v">{{ data.products[picked.product] || picked.product || "未识别" }}</div>
                <div class="k">暴露子类</div><div class="v">{{ picked.exposureSubClass || "—" }}</div>
                <div class="k">命中规则</div><div class="v mono">{{ picked.matchedRule || "—" }}</div>
                <div class="k">表内 / 表外 EAD</div><div class="v">{{ money(picked.onEad) }} / {{ money(picked.offEad) }}</div>
                <div class="k">EAD 公式</div><div class="v">{{ picked.eadFormula || "—" }}</div>
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
            <div class="panel-head"><h3>EAD 计算过程</h3></div>
            <div class="panel-body">
              <div v-for="(step, index) in picked.eadSteps" :key="index" class="step-line">
                <span class="sl-n">{{ step.n || index + 1 }}</span>
                <div class="sl-b">
                  <div><span class="sl-l">{{ step.label }}</span> <span v-if="step.expr" class="sl-e">{{ step.expr }}</span><span class="sl-v">{{ stepShown(step) }}</span></div>
                  <div v-if="step.note" class="sl-note">{{ step.note }}</div>
                </div>
              </div>
            </div>
          </div>
          <div v-if="picked.rwaSteps && picked.rwaSteps.length" class="panel">
            <div class="panel-head"><h3>RWA 计算过程</h3></div>
            <div class="panel-body">
              <div v-for="(step, index) in picked.rwaSteps" :key="index" class="step-line">
                <span class="sl-n">{{ step.n || index + 1 }}</span>
                <div class="sl-b">
                  <div><span class="sl-l">{{ step.label }}</span> <span v-if="step.expr" class="sl-e">{{ step.expr }}</span><span class="sl-v">{{ stepShown(step) }}</span></div>
                  <div v-if="step.note" class="sl-note">{{ step.note }}</div>
                </div>
              </div>
            </div>
          </div>
          <div v-if="picked.crm" class="panel">
            <div class="panel-head"><h3>信用风险缓释</h3></div>
            <div class="panel-body">
              <div class="kv">
                <div class="k">结论</div><div class="v">{{ picked.crm.note || "—" }}</div>
              </div>
              <div v-for="slot in picked.crm.slots || []" :key="slot.slot" class="step-line">
                <span class="sl-n">{{ slot.slot }}</span>
                <div class="sl-b">
                  <div>
                    <span class="sl-l">第 {{ slot.slot }} 笔</span>
                    <span v-if="slot.typeColumn" class="sl-e">{{ slot.typeColumn }}</span>
                    <span class="sl-v">{{ slot.type || "—" }}</span>
                  </div>
                  <div class="sl-note">金额 {{ slot.value == null ? "—" : money(slot.value) }} · 权重 {{ slot.weight == null ? "—" : pct(slot.weight) }}<template v-if="slot.valueColumn"> · {{ slot.valueColumn }}</template></div>
                </div>
              </div>
            </div>
          </div>
          <div v-if="!(picked.eadSteps && picked.eadSteps.length) && !(picked.rwaSteps && picked.rwaSteps.length)" class="notice info">
            <span class="ni">i</span>
            <div>这一笔没有留下 EAD 或 RWA 的计算步骤。</div>
          </div>
        </template>
      </Drawer>
    </template>
  </AsyncView>
</template>
