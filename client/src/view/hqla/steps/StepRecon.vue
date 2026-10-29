<script setup>
import { computed, ref } from "vue";
import { downloadBlob, exportWorkbook, saveConfig, saveReported, demo } from "@/api/hqla";

const props = defineProps({ task: Object, result: Object, reload: Function });

const basis = ref("reported");
const busy = ref(false);
const error = ref("");

const cfg = computed(() => (props.result && props.result.cfgSnapshot) || props.task.cfg || {});
const agg = computed(() => (basis.value === "judged" ? props.result && props.result.aggJ : props.result && props.result.agg) || null);
const caps = computed(() => (props.result && props.result.caps) || null);
const recon = computed(() => (props.result && props.result.recon) || null);
const levelDefs = computed(() => cfg.value.levels || []);
const ccyGroups = computed(() => cfg.value.currencyGroups || []);

const ccyCodes = computed(() => (agg.value && agg.value.ccyCodes) || []);
const finalTotal = computed(() => (caps.value ? caps.value.after.total : 0));
const reportedWeighted = computed(() => (props.result && props.result.agg ? props.result.agg.totals.weighted : 0));
const capsApplied = computed(() => !!(caps.value && caps.value.enabled && (caps.value.binding.l2 || caps.value.binding.l2b)));

const bridge = computed(() => {
  if (!props.result) return [];
  return ["L1", "L2A", "L2B", "NA"].map((lv) => {
    const before = props.result.agg.matrix[lv] ? props.result.agg.matrix[lv].totalWeighted : 0;
    const after = props.result.aggJ.matrix[lv] ? props.result.aggJ.matrix[lv].totalWeighted : 0;
    return { level: lv, label: (levelDefs.value.find((l) => l.code === lv) || { label: lv }).label, before, after, delta: after - before };
  });
});

const bridgeTotals = computed(() => bridge.value.reduce((acc, x) => ({ before: acc.before + x.before, after: acc.after + x.after }), { before: 0, after: 0 }));

function thousand(value) {
  if (value == null) return "—";
  return Number(value).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function money(value) {
  if (value == null) return "—";
  return Number(value).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function levelLabel(code) {
  return (levelDefs.value.find((l) => l.code === code) || { label: code }).label;
}
function ccyLabel(code) {
  return (ccyGroups.value.find((g) => g.code === code) || { label: code }).label;
}

async function updateTolerance(key, value) {
  const next = JSON.parse(JSON.stringify(cfg.value));
  next.reconciliation = { ...(next.reconciliation || {}), [key]: Number(value) || 0 };
  await saveConfig(props.task.id, next);
  await props.reload();
}

async function loadDemoReported() {
  const data = await demo("reported");
  await saveReported(props.task.id, data.rows);
  await props.reload();
}

async function clearReported() {
  await saveReported(props.task.id, []);
  await props.reload();
}

async function exportXlsx() {
  busy.value = true;
  error.value = "";
  try {
    const blob = await exportWorkbook(props.task.id);
    const name = `HQLA底稿_${props.task.name || "HQLA"}_${props.task.baseDate || ""}.xlsx`.replace(/[\\/:*?"<>|]/g, "_");
    downloadBlob(blob, name);
  } catch (err) {
    error.value = err.message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <p v-if="error" class="notice danger">{{ error }}</p>
  <div v-if="!result || !result.rows" class="notice warn">请先导入明细数据。</div>

  <template v-else>
    <div class="grid c4" style="margin-bottom: 14px">
      <div class="kpi"><div class="k-label">本金合计</div><div class="k-value">{{ thousand(result.agg.totals.amount / 1000) }} 千元</div><div class="k-foot">{{ money(result.agg.totals.amount) }} 港元</div></div>
      <div class="kpi accent"><div class="k-label">最终 HQLA（含上限）</div><div class="k-value">{{ thousand(finalTotal / 1000) }} 千元</div><div class="k-foot">{{ capsApplied ? `上限剔除 ${thousand((caps.before.total - finalTotal) / 1000)} 千元` : "未触及组合上限" }}</div></div>
      <div class="kpi"><div class="k-label">客户申报加权</div><div class="k-value">{{ recon ? thousand(recon.summary.cybTotal) + " 千元" : "未载入" }}</div><div class="k-foot">{{ task.reported && task.reported.length ? `已载入 ${task.reported.length} 条条款行` : "未载入客户申报数（可选）" }}</div></div>
      <div class="kpi"><div class="k-label">判定差异</div><div class="k-value">{{ thousand((finalTotal - reportedWeighted) / 1000) }} 千元</div><div class="k-foot">{{ recon ? `重编对账差异 ${thousand(recon.summary.diff)} 千元（尾差）` : "判定后 − 客户申报" }}</div></div>
    </div>

    <div class="panel" style="margin-bottom: 12px">
      <div class="panel-head">
        <h3>⑦-1 汇总重编（单位：千港元）</h3>
        <span class="sub">{{ basis === "judged" ? "按本系统判定档位重排" : "按客户申报档位汇总（用于与申报数对账）" }}</span>
        <span class="spacer"></span>
        <div class="seg">
          <button type="button" :class="{ active: basis === 'reported' }" @click="basis = 'reported'">按申报档位</button>
          <button type="button" :class="{ active: basis === 'judged' }" @click="basis = 'judged'">按判定档位</button>
        </div>
      </div>
      <div class="panel-body tight">
        <div class="dim" style="font-size: 11.5px; margin-bottom: 6px">本金金额</div>
        <table class="tbl compact">
          <thead><tr><th>档位</th><th class="num">折扣系数</th><th v-for="c in ccyCodes" :key="'a' + c" class="num">{{ ccyLabel(c) }}</th><th class="num">合计</th></tr></thead>
          <tbody>
            <tr v-for="lv in ['L1', 'L2A', 'L2B']" :key="lv">
              <td>{{ levelLabel(lv) }}</td>
              <td class="num">{{ Math.round(((levelDefs.find((l) => l.code === lv) || { weight: 0 }).weight) * 100) }}%</td>
              <td v-for="c in ccyCodes" :key="lv + c" class="num">{{ thousand(agg.matrix[lv].ccy[c].amount / 1000) }}</td>
              <td class="num">{{ thousand(agg.matrix[lv].totalAmount / 1000) }}</td>
            </tr>
            <tr style="font-weight: 600">
              <td>合计</td><td></td>
              <td v-for="c in ccyCodes" :key="'ta' + c" class="num">{{ thousand(agg.totals.ccy[c].amount / 1000) }}</td>
              <td class="num">{{ thousand(agg.totals.amount / 1000) }}</td>
            </tr>
          </tbody>
        </table>

        <div class="dim" style="font-size: 11.5px; margin: 14px 0 6px">加权金额（乘折扣系数后）</div>
        <table class="tbl compact">
          <thead><tr><th>档位</th><th class="num">折扣系数</th><th v-for="c in ccyCodes" :key="'w' + c" class="num">{{ ccyLabel(c) }}</th><th class="num">合计</th></tr></thead>
          <tbody>
            <tr v-for="lv in ['L1', 'L2A', 'L2B']" :key="'w' + lv">
              <td>{{ levelLabel(lv) }}</td>
              <td class="num">{{ Math.round(((levelDefs.find((l) => l.code === lv) || { weight: 0 }).weight) * 100) }}%</td>
              <td v-for="c in ccyCodes" :key="'w' + lv + c" class="num">{{ thousand(agg.matrix[lv].ccy[c].weighted / 1000) }}</td>
              <td class="num">{{ thousand(agg.matrix[lv].totalWeighted / 1000) }}</td>
            </tr>
            <tr style="font-weight: 600">
              <td>合计</td><td></td>
              <td v-for="c in ccyCodes" :key="'tw' + c" class="num">{{ thousand(agg.totals.ccy[c].weighted / 1000) }}</td>
              <td class="num">{{ thousand(agg.totals.weighted / 1000) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="panel" style="margin-bottom: 12px">
      <div class="panel-head"><h3>⑦-1b 差异桥：判定后与申报口径的差异来源</h3><span class="sub">把「判定后 HQLA」与「客户申报加权」的差额拆到各档位</span></div>
      <div class="panel-body tight">
        <table class="tbl compact">
          <thead><tr><th>档位</th><th class="num">按申报档位加权</th><th class="num">按判定档位加权</th><th class="num">变动</th></tr></thead>
          <tbody>
            <tr v-for="item in bridge" :key="item.level">
              <td>{{ item.label }}</td>
              <td class="num">{{ thousand(item.before / 1000) }}</td>
              <td class="num">{{ thousand(item.after / 1000) }}</td>
              <td class="num" :style="{ color: Math.abs(item.delta) > 0.5 ? (item.delta > 0 ? 'var(--ok)' : 'var(--danger)') : 'inherit' }">
                {{ (item.delta > 0 ? "+" : "") + thousand(item.delta / 1000) }}
              </td>
            </tr>
            <tr style="font-weight: 600">
              <td>合计</td>
              <td class="num">{{ thousand(bridgeTotals.before / 1000) }}</td>
              <td class="num">{{ thousand(bridgeTotals.after / 1000) }}</td>
              <td class="num">{{ (bridgeTotals.after - bridgeTotals.before > 0 ? "+" : "") + thousand((bridgeTotals.after - bridgeTotals.before) / 1000) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="panel" style="margin-bottom: 12px">
      <div class="panel-head">
        <h3>⑦-2 与客户申报数对账</h3>
        <span class="sub">{{ task.reported && task.reported.length ? `已载入 ${task.reported.length} 条条款行` : "未载入客户申报数（可选）" }}</span>
        <span class="spacer"></span>
        <button type="button" class="btn sm" @click="loadDemoReported">载入内置申报数</button>
        <button type="button" class="btn sm" :disabled="!(task.reported && task.reported.length)" @click="clearReported">清空</button>
        <button type="button" class="btn sm primary" :disabled="busy" @click="exportXlsx">导出审计底稿</button>
      </div>
      <div class="panel-body tight">
        <template v-if="recon">
          <table class="tbl compact">
            <thead><tr><th>档位</th><th>币种组</th><th class="num">DTT 重编</th><th class="num">客户申报</th><th class="num">差异</th><th>结论</th></tr></thead>
            <tbody>
              <tr v-for="(item, i) in recon.rows" :key="i">
                <td>{{ item.ccy === "TOTAL" ? "小计" : levelLabel(item.level) }}</td>
                <td>{{ item.ccyLabel }}</td>
                <td class="num">{{ thousand(item.dtt) }}</td>
                <td class="num">{{ thousand(item.cyb) }}</td>
                <td class="num" :style="{ color: item.status === 'diff' ? 'var(--danger)' : 'inherit' }">{{ thousand(item.diff) }}</td>
                <td><span class="tag" :class="item.status === 'ok' ? 'ok' : 'danger'">{{ item.status === "ok" ? "一致" : "差异" }}</span></td>
              </tr>
            </tbody>
          </table>
          <div style="display: flex; gap: 16px; align-items: center; margin-top: 10px; flex-wrap: wrap">
            <span class="dim">对账容差</span>
            <label class="field" style="flex-direction: row; align-items: center; gap: 4px">
              <span class="dim">绝对（千元）</span>
              <input type="number" style="width: 90px" :value="(cfg.reconciliation || {}).toleranceThousand" @change="updateTolerance('toleranceThousand', $event.target.value)" />
            </label>
            <label class="field" style="flex-direction: row; align-items: center; gap: 4px">
              <span class="dim">相对</span>
              <input type="number" step="0.0001" style="width: 90px" :value="(cfg.reconciliation || {}).tolerancePct" @change="updateTolerance('tolerancePct', $event.target.value)" />
            </label>
          </div>
          <div class="sum-bar">
            <div class="si"><div class="sl">重编合计</div><div class="sv">{{ thousand(recon.summary.dttTotal) }} 千元</div></div>
            <div class="si"><div class="sl">申报合计</div><div class="sv">{{ thousand(recon.summary.cybTotal) }} 千元</div></div>
            <div class="si"><div class="sl">差异</div><div class="sv">{{ thousand(recon.summary.diff) }} 千元</div></div>
            <div class="si"><div class="sl">差异率</div><div class="sv">{{ (recon.summary.diffPct * 100).toFixed(4) }}%</div></div>
            <div class="si"><div class="sl">超容差格数</div><div class="sv">{{ recon.summary.exceptions }} / {{ recon.rows.length }}</div></div>
          </div>
        </template>
        <div v-else class="empty">未载入客户申报数；载入后可逐格比对重编结果与申报数。</div>
      </div>
    </div>

    <div v-if="caps" class="panel">
      <div class="panel-head">
        <h3>⑦-3 关卡三 · 组合上限</h3>
        <span class="sub">Level 2 ≤ {{ (caps.caps.l2Pct * 100).toFixed(0) }}% · Level 2B ≤ {{ (caps.caps.l2bPct * 100).toFixed(0) }}%（以最终 HQLA 为基数）</span>
      </div>
      <div class="panel-body tight">
        <div class="grid c3" style="margin-bottom: 10px">
          <div class="kpi" :class="{ accent: caps.binding.l2 }"><div class="k-label">Level 2 占比</div><div class="k-value sm">{{ (caps.ratios.l2After * 100).toFixed(2) }}%</div><div class="k-foot">上限 {{ (caps.caps.l2Pct * 100).toFixed(0) }}%</div></div>
          <div class="kpi" :class="{ accent: caps.binding.l2b }"><div class="k-label">Level 2B 占比</div><div class="k-value sm">{{ (caps.ratios.l2bAfter * 100).toFixed(2) }}%</div><div class="k-foot">上限 {{ (caps.caps.l2bPct * 100).toFixed(0) }}%</div></div>
          <div class="kpi"><div class="k-label">超限剔除</div><div class="k-value sm">{{ money(caps.excluded.l2 + caps.excluded.l2b) }}</div><div class="k-foot">Level 2 {{ money(caps.excluded.l2) }} · 2B {{ money(caps.excluded.l2b) }}</div></div>
        </div>
        <table class="tbl compact">
          <thead><tr><th>项目（港元）</th><th class="num">调整前</th><th class="num">调整后</th><th class="num">剔除</th></tr></thead>
          <tbody>
            <tr><td>Level 1</td><td class="num">{{ money(caps.before.l1) }}</td><td class="num">{{ money(caps.after.l1) }}</td><td class="num">{{ money(0) }}</td></tr>
            <tr><td>Level 2A</td><td class="num">{{ money(caps.before.l2a) }}</td><td class="num">{{ money(caps.after.l2a) }}</td><td class="num">{{ money(caps.before.l2a - caps.after.l2a) }}</td></tr>
            <tr><td>Level 2B</td><td class="num">{{ money(caps.before.l2b) }}</td><td class="num">{{ money(caps.after.l2b) }}</td><td class="num">{{ money(caps.before.l2b - caps.after.l2b) }}</td></tr>
            <tr style="font-weight: 600"><td>HQLA 合计</td><td class="num">{{ money(caps.before.total) }}</td><td class="num">{{ money(caps.after.total) }}</td><td class="num">{{ money(caps.before.total - caps.after.total) }}</td></tr>
          </tbody>
        </table>
        <p class="notice" :class="caps.binding.l2 || caps.binding.l2b ? 'warn' : 'ok'" style="margin-top: 10px">
          {{ caps.binding.l2 || caps.binding.l2b ? "已触及组合上限，超出部分需剔除后再申报。" : "未触及组合上限。" }}
        </p>
      </div>
    </div>
  </template>
</template>
