<script setup>
import { computed, ref } from "vue";
import Drawer from "@/components/Drawer.vue";

const props = defineProps({ task: Object, result: Object, reload: Function });

const scope = ref(null);
const status = ref("all");
const dim = ref(null);
const reason = ref(null);
const query = ref("");
const trace = ref(null);

const hasSample = computed(() => !!(props.task.sample && props.task.sample.size && props.result && props.result.stats && props.task.sample.size < props.result.stats.securities));
const currentScope = computed(() => scope.value || (hasSample.value ? "sample" : "full"));

const allRows = computed(() => {
  if (currentScope.value === "sample" && props.task.sample) return (props.result && props.result.sampleRows) || [];
  return ((props.result && props.result.rows) || []).filter((r) => !r.isAdjustment);
});

const stats = computed(() => {
  const out = { all: allRows.value.length, fail: 0, warn: 0, pass: 0, skip: 0 };
  allRows.value.forEach((r) => { out[r.status] = (out[r.status] || 0) + 1; });
  return out;
});

const dims = computed(() => {
  const out = { gate1: 0, classification: 0, valuation: 0, maturity: 0, rating: 0 };
  allRows.value.forEach((r) => {
    if (r.gate1 && r.gate1.status === "fail") out.gate1 += 1;
    Object.entries(r.checks || {}).forEach(([key, check]) => {
      if (out[key] != null && check.status === "fail") out[key] += 1;
    });
  });
  return out;
});

const view = computed(() => {
  let list = allRows.value;
  if (status.value !== "all") list = list.filter((r) => r.status === status.value);
  if (dim.value === "gate1") list = list.filter((r) => r.gate1 && r.gate1.status === "fail");
  else if (dim.value) list = list.filter((r) => r.checks[dim.value] && r.checks[dim.value].status === "fail");
  if (reason.value) list = list.filter((r) => r.gate1 && (r.gate1.failures || []).some((x) => x.label === reason.value));
  if (query.value) {
    const q = query.value.toLowerCase();
    list = list.filter((r) => String(r.secId || "").toLowerCase().includes(q)
      || (r.ref && String(r.ref.name || "").toLowerCase().includes(q))
      || String(r.key || "").toLowerCase().includes(q));
  }
  return list;
});

const reasons = computed(() => {
  const out = {};
  allRows.value.forEach((r) => {
    if (!r.gate1 || r.gate1.status !== "fail") return;
    (r.gate1.failures || []).forEach((f) => { out[f.label] = (out[f.label] || 0) + 1; });
  });
  return Object.entries(out).sort((a, b) => b[1] - a[1]);
});

const LEVEL = { L1: "Level 1", L2A: "Level 2A", L2B: "Level 2B", NA: "不合格", UNK: "未识别" };
const TONE = { L1: "ok", L2A: "info", L2B: "warn", NA: "danger" };
const levelText = (code) => LEVEL[code] || code;

function gateTone(r) {
  if (!r.gate1) return "muted";
  if (r.gate1.status === "fail") return "danger";
  if (r.gate1.status === "pass_with_note") return "warn";
  return "ok";
}
function gateLabel(r) {
  if (!r.gate1) return "—";
  if (r.gate1.status === "fail") return "不合格";
  if (r.gate1.status === "pass_with_note") return "部分";
  return "通过";
}
function shortReason(r) {
  if (r.gate1 && r.gate1.status === "fail") return `关卡一：${(r.gate1.failures[0] || {}).label || "不合格"}`;
  if (r.judged.level === "NA") return r.gate2 && r.gate2.reason ? String(r.gate2.reason).slice(0, 26) : "未命中任何档位";
  if (r.checks.classification && r.checks.classification.status === "fail") return `分类：申报 ${levelText(r.item)} → 判定 ${levelText(r.judged.level)}`;
  if (r.checks.valuation && r.checks.valuation.status === "fail") return "估值差异超容差";
  if (r.checks.maturity && r.checks.maturity.status === "fail") return "已到期";
  if (r.checks.maturity && r.checks.maturity.status === "warn") return "期限内到期，需核对 C6";
  if (r.checks.rating && r.checks.rating.status === "warn") return "评级缺失，需人工确认";
  return "";
}
function statusLabel(value) {
  return { pass: "通过", warn: "关注", fail: "异常", skip: "不适用" }[value] || value;
}
function statusTone(value) {
  return { pass: "ok", warn: "warn", fail: "danger", skip: "muted" }[value] || "muted";
}

function exportCsv() {
  const lines = [["行号", "证券代码", "债券名称", "申报档位", "关卡一", "判定档位", "风险权重", "30天跌幅", "币种组", "金额(HKD)", "综合", "原因"].join(",")];
  view.value.forEach((r) => {
    lines.push([
      r.lineNo, r.secId,
      `"${String((r.ref && r.ref.name) || "").replace(/"/g, '""')}"`,
      levelText(r.item),
      r.gate1 ? (r.gate1.status === "fail" ? "不合格" : "通过") : "—",
      levelText(r.judged.level),
      r.rw == null ? "" : `${r.rw}%`,
      r.price30 == null ? "" : `${r.price30}%`,
      r.ccyGroup, r.amount == null ? "" : r.amount,
      statusLabel(r.status),
      `"${shortReason(r).replace(/"/g, '""')}"`
    ].join(","));
  });
  const blob = new Blob([`﻿${lines.join("\n")}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `逐笔核对_${view.value.length}笔.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function money(value) {
  if (value == null) return "—";
  return Number(value).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
</script>

<template>
  <div class="panel" style="margin-bottom: 12px">
    <div class="panel-head">
      <h3>⑥ 逐笔核对与追溯</h3>
      <span class="sub">样本 {{ allRows.length }} 笔 · 异常 {{ stats.fail }} · 关注 {{ stats.warn }} · 通过 {{ stats.pass }}</span>
      <span class="spacer"></span>
      <div class="seg">
        <button type="button" :class="{ active: currentScope === 'full' }" @click="scope = 'full'">全量</button>
        <button type="button" :class="{ active: currentScope === 'sample' }" :disabled="!task.sample" @click="scope = 'sample'">
          {{ task.sample ? `抽样 ${task.sample.size} 笔` : "抽样（未生成）" }}
        </button>
      </div>
      <button type="button" class="btn sm" @click="exportCsv">导出当前结果</button>
    </div>
    <div class="panel-body tight">
      <div style="display: flex; gap: 6px; flex-wrap: wrap; align-items: center; margin-bottom: 10px">
        <button v-for="[key, label, count] in [['all','全部',stats.all],['fail','异常',stats.fail],['warn','关注',stats.warn],['pass','通过',stats.pass]]" :key="key" type="button" class="btn sm" :class="{ primary: status === key }" @click="status = key">
          {{ label }} ({{ count }})
        </button>
        <span class="dim">|</span>
        <button type="button" class="btn sm" :class="{ primary: dim === 'gate1' }" @click="dim = dim === 'gate1' ? null : 'gate1'">关卡一不合格 {{ dims.gate1 }}</button>
        <button type="button" class="btn sm" :class="{ primary: dim === 'classification' }" @click="dim = dim === 'classification' ? null : 'classification'">分类异常 {{ dims.classification }}</button>
        <button type="button" class="btn sm" :class="{ primary: dim === 'valuation' }" @click="dim = dim === 'valuation' ? null : 'valuation'">估值异常 {{ dims.valuation }}</button>
        <button type="button" class="btn sm" :class="{ primary: dim === 'maturity' }" @click="dim = dim === 'maturity' ? null : 'maturity'">期限异常 {{ dims.maturity }}</button>
        <button type="button" class="btn sm" :class="{ primary: dim === 'rating' }" @click="dim = dim === 'rating' ? null : 'rating'">评级异常 {{ dims.rating }}</button>
        <span class="dim">|</span>
        <input v-model="query" type="text" placeholder="搜索证券代码 / 债券名称" style="width: 220px; font-size: 12px" />
        <button type="button" class="btn sm" @click="status = 'all'; dim = null; reason = null; query = ''">重置筛选</button>
      </div>

      <table class="tbl compact">
        <thead>
          <tr>
            <th class="num">#</th><th>证券 / 债券名称</th><th>申报</th><th>关卡一</th><th>关卡二</th>
            <th class="num">风险权重</th><th class="num">30天跌幅</th><th class="num">金额(HKD)</th><th>综合</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in view" :key="row.i" class="clickable" @click="trace = row">
            <td class="num">{{ row.lineNo }}</td>
            <td>
              <div class="mono" style="font-size: 11.5px">{{ row.secId }}</div>
              <div class="dim" style="font-size: 10.5px; max-width: 210px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">{{ row.ref ? row.ref.name : "未匹配外部信息" }}</div>
            </td>
            <td>{{ levelText(row.item) }}</td>
            <td><span class="tag" :class="gateTone(row)" :title="row.gate1 ? row.gate1.summary : ''">{{ gateLabel(row) }}</span></td>
            <td><span class="tag" :class="TONE[row.judged.level] || 'muted'">{{ levelText(row.judged.level) }}</span></td>
            <td class="num">{{ row.rw == null ? "—" : row.rw + "%" }}</td>
            <td class="num">{{ row.price30 == null ? "—" : row.price30 + "%" }}</td>
            <td class="num">{{ money(row.amount) }}</td>
            <td>
              <span class="tag" :class="statusTone(row.status)">{{ statusLabel(row.status) }}</span>
              <div class="dim" style="font-size: 10px; max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">{{ shortReason(row) }}</div>
            </td>
          </tr>
        </tbody>
      </table>
      <p class="dim" style="font-size: 11px; margin-top: 10px">点击任意行可查看该笔债券的完整证据链：关卡一 6 项检查、关卡二逐条件比对、估值推导与外部信息。</p>
    </div>
  </div>

  <div class="panel">
    <div class="panel-head"><h3>⑥-b 关卡一不合格原因分布</h3><span class="sub">点击任一行可筛出对应债券</span></div>
    <div class="panel-body tight">
      <table v-if="reasons.length" class="tbl compact">
        <thead><tr><th>排除条件</th><th class="num">涉及笔数</th><th class="num">占样本比例</th></tr></thead>
        <tbody>
          <tr v-for="[label, count] in reasons" :key="label" class="clickable" @click="reason = reason === label ? null : label; status = 'all'; dim = null">
            <td>{{ label }}</td>
            <td class="num">{{ count }}</td>
            <td class="num">{{ allRows.length ? ((count / allRows.length) * 100).toFixed(1) : 0 }}%</td>
          </tr>
        </tbody>
      </table>
      <div v-else class="empty">样本中没有因通用合格性被排除的债券</div>
    </div>
  </div>

  <Drawer :open="!!trace" :title="trace ? `逐笔追溯 · ${trace.secId}` : ''" wide @close="trace = null">
    <template v-if="trace">
      <div class="grid c4" style="margin-bottom: 12px">
        <div class="kpi"><div class="k-label">申报档位</div><div class="k-value sm">{{ levelText(trace.item) }}</div><div class="k-foot">{{ trace.itemRaw }}</div></div>
        <div class="kpi"><div class="k-label">规则判定</div><div class="k-value sm">{{ levelText(trace.judged.level) }}</div><div class="k-foot">{{ trace.judged.blockedByGate1 ? "关卡一未通过" : `${trace.judged.ruleId || "—"}` }}</div></div>
        <div class="kpi"><div class="k-label">申报金额</div><div class="k-value sm">{{ money(trace.amount) }}</div><div class="k-foot">HKD</div></div>
        <div class="kpi"><div class="k-label">综合结论</div><div class="k-value sm">{{ statusLabel(trace.status) }}</div><div class="k-foot">{{ trace.ref ? `外部匹配：${trace.matchBy}` : "未匹配外部信息" }}</div></div>
      </div>

      <div v-if="trace.gate1" class="panel" style="margin-bottom: 12px">
        <div class="panel-head"><h3>关卡一 · 通用合格性</h3><span class="spacer"></span><span class="tag" :class="gateTone(trace)">{{ gateLabel(trace) }}</span></div>
        <div class="panel-body">
          <div v-for="check in trace.gate1.checks" :key="check.code" style="margin-bottom: 8px">
            <b>{{ check.label }}</b>
            <span class="dim">（{{ check.status === "pass" ? "通过" : check.status === "fail" ? "不合格" : "未执行" }}）</span>
            <div class="dim" style="font-size: 11.5px; line-height: 1.6">{{ check.detail }}</div>
          </div>
        </div>
      </div>

      <div v-if="trace.gate2" class="panel" style="margin-bottom: 12px">
        <div class="panel-head"><h3>关卡二 · 分档判定</h3><span class="spacer"></span><span class="tag" :class="TONE[trace.judged.level] || 'muted'">{{ levelText(trace.judged.level) }}</span></div>
        <div class="panel-body">
          <div style="font-size: 11.5px; margin-bottom: 8px; line-height: 1.7">
            <div><b>{{ trace.gate2.ruleId ? trace.gate2.ruleId + " " : "" }}</b>{{ trace.gate2.ruleLabel }}</div>
            <div class="dim">条款：{{ trace.judged.clause }} · 折扣系数 {{ Math.round(((task.cfg && task.cfg.levels || []).find((l) => l.code === trace.judged.level) || { weight: 0 }).weight * 100) }}%</div>
            <div v-if="trace.gate2.reason" style="color: var(--danger)">{{ trace.gate2.reason }}</div>
          </div>
          <div v-for="(check, i) in trace.gate2.checks || []" :key="i" style="margin-bottom: 6px">
            <span :style="{ color: check.ok ? 'var(--ok)' : 'var(--danger)' }">{{ check.ok ? "✓" : "✕" }}</span>
            <b style="margin-left: 4px">{{ check.name }}</b>
            <span class="dim"> 要求 {{ check.expect }}</span>
            <div class="dim" style="font-size: 11px">实际 {{ check.actual }}</div>
          </div>
        </div>
      </div>

      <div class="panel" style="margin-bottom: 12px">
        <div class="panel-head"><h3>四项核对</h3></div>
        <div class="panel-body">
          <div v-for="key in ['classification', 'valuation', 'maturity', 'rating']" :key="key" style="margin-bottom: 8px">
            <b>{{ { classification: '分类核对', valuation: '估值核对', maturity: '期限核对', rating: '评级核对' }[key] }}</b>
            <span class="dim">（{{ statusLabel((trace.checks[key] || {}).status) }}）</span>
            <div class="dim" style="font-size: 11.5px; line-height: 1.6">{{ (trace.checks[key] || {}).text }}</div>
          </div>
        </div>
      </div>

      <div v-if="trace.ref" class="panel">
        <div class="panel-head"><h3>外部债券信息</h3><span class="spacer"></span><span class="tag muted">{{ trace.matchBy || "参考库" }}</span></div>
        <div class="panel-body">
          <table class="tbl compact">
            <tbody>
              <tr><td class="dim">债券名称</td><td>{{ trace.ref.name }}</td><td class="dim">ISIN</td><td>{{ trace.ref.isin || "—" }}</td></tr>
              <tr><td class="dim">发行人</td><td>{{ trace.ref.issuer }}</td><td class="dim">债券评级</td><td>{{ trace.ref.rating || "未评级" }}</td></tr>
              <tr><td class="dim">风险权重</td><td>{{ trace.ref.rw == null ? "缺失（按发行人类型推定）" : trace.ref.rw + "%" }}</td><td class="dim">30 天跌幅</td><td>{{ trace.ref.p30 == null ? "缺失" : trace.ref.p30 + "%" }}</td></tr>
              <tr><td class="dim">到期日 / 剩余</td><td>{{ trace.ref.mat || "—" }} / {{ trace.remainingDays == null ? "—" : trace.remainingDays + " 天" }}</td><td class="dim">票面利率</td><td>{{ trace.ref.cp == null ? "—" : trace.ref.cp + "%" }}</td></tr>
              <tr><td class="dim">上市 / 会计分类</td><td>{{ trace.ref.listed || "—" }} / {{ trace.ref.acct || "—" }}</td><td class="dim">市值 / 应计</td><td>{{ money(trace.ref.mv) }} / {{ money(trace.ref.acc) }}</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </Drawer>
</template>
