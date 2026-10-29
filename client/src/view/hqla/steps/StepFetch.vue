<script setup>
import { computed, ref } from "vue";
import { reference, saveFetch, upsertReference } from "@/api/hqla";

const props = defineProps({ task: Object, result: Object, reload: Function });

const busy = ref(false);
const error = ref("");
const refCount = ref(null);
const manual = ref(null);

const log = computed(() => props.task.fetchLog || []);
const hit = computed(() => log.value.filter((x) => x.status === "命中").length);
const missList = computed(() => log.value.filter((x) => x.status !== "命中"));
const rowsInScope = computed(() => {
  if (props.task.sample) return (props.result && props.result.sampleRows) || [];
  return ((props.result && props.result.rows) || []).filter((r) => !r.isAdjustment);
});
const withRef = computed(() => rowsInScope.value.filter((r) => r.ref));
const lackRw = computed(() => withRef.value.filter((r) => r.ref.rw == null).length);
const lackP30 = computed(() => withRef.value.filter((r) => r.ref.p30 == null).length);
const lackRating = computed(() => withRef.value.filter((r) => !r.ref.rating || /unrated|未评级/i.test(String(r.ref.rating))).length);

const sig = computed(() => JSON.stringify({ ids: (props.task.sample ? props.task.sample.indices : []).slice(0, 500), src: refCount.value || "" }));
const stale = computed(() => !!(log.value.length && props.task.fetchSig && props.task.fetchSig !== sig.value));

function levelText(code) {
  return { L1: "Level 1", L2A: "Level 2A", L2B: "Level 2B", NA: "不合格" }[code] || code;
}

function summarize(ref) {
  const bits = [];
  if (ref.rating) bits.push(`评级 ${ref.rating}`);
  if (ref.rw != null) bits.push(`RW ${ref.rw}%`);
  if (ref.p30 != null) bits.push(`30天 ${ref.p30}%`);
  if (ref.mat) bits.push(`到期 ${ref.mat}`);
  return bits.join(" · ");
}

async function loadReferenceInfo() {
  try {
    const rows = await reference();
    refCount.value = rows.length;
  } catch (err) {
    refCount.value = null;
  }
}

async function doFetch() {
  if (!rowsInScope.value.length) {
    error.value = "请先完成抽样（第 4 步）";
    return;
  }
  busy.value = true;
  error.value = "";
  try {
    const out = rowsInScope.value.map((row) => ({
      secId: row.secId,
      status: row.ref ? "命中" : "未命中",
      by: row.ref ? row.matchBy || "参考库" : "—",
      fields: row.ref ? summarize(row.ref) : ""
    }));
    await saveFetch(props.task.id, out, sig.value);
    await props.reload();
  } catch (err) {
    error.value = err.message;
  } finally {
    busy.value = false;
  }
}

function downloadMiss() {
  const lines = [["证券代码", "申报档位", "金额(HKD)"].join(",")];
  missList.value.forEach((item) => {
    const row = rowsInScope.value.find((r) => r.secId === item.secId) || {};
    lines.push([item.secId, levelText(row.item), row.amount == null ? "" : row.amount].join(","));
  });
  const blob = new Blob([`﻿${lines.join("\n")}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "未命中清单.csv";
  link.click();
  URL.revokeObjectURL(url);
}

function openManual() {
  manual.value = missList.value.map((item) => {
    const row = rowsInScope.value.find((r) => r.secId === item.secId) || {};
    return { key: row.key || item.secId, secId: item.secId, name: (row.ref && row.ref.name) || "", rating: "", rw: "", p30: "" };
  });
}

async function saveManual() {
  const rows = manual.value
    .filter((item) => item.rating || item.rw !== "" || item.p30 !== "")
    .map((item) => ({
      id: item.key,
      name: item.name,
      rating: item.rating || "Unrated",
      rw: item.rw === "" ? null : Number(item.rw),
      p30: item.p30 === "" ? null : Number(item.p30)
    }));
  if (!rows.length) {
    error.value = "未填写任何字段";
    return;
  }
  busy.value = true;
  try {
    await upsertReference(rows);
    await saveFetch(props.task.id, [], null);
    manual.value = null;
    await props.reload();
    await loadReferenceInfo();
  } catch (err) {
    error.value = err.message;
  } finally {
    busy.value = false;
  }
}

loadReferenceInfo();
</script>

<template>
  <p v-if="error" class="notice danger">{{ error }}</p>

  <div class="panel" style="margin-bottom: 12px">
    <div class="panel-head">
      <h3>⑤ 外部数据获取</h3>
      <span class="sub">按第 4 步的样本清单逐只抓取：评级、风险权重、30 天跌幅、市值 / 应计、债券条款</span>
      <span class="spacer"></span>
      <button type="button" class="btn sm primary" :disabled="busy" @click="doFetch">{{ log.length ? "重新抓取" : `按样本抓取（${rowsInScope.length} 笔）` }}</button>
    </div>
    <div class="panel-body">
      <p v-if="stale" class="notice warn">样本或数据源已变更，当前取数日志可能与样本不匹配，请点击「重新抓取」。</p>

      <div class="grid c4" style="margin-bottom: 12px">
        <div class="kpi"><div class="k-label">当前数据源</div><div class="k-value sm">{{ refCount == null ? "未载入" : refCount + " 只" }}</div><div class="k-foot">外部债券参考库（MySQL）</div></div>
        <div class="kpi"><div class="k-label">抓取范围</div><div class="k-value sm">{{ task.sample ? `样本 ${task.sample.size} 笔` : `全量 ${rowsInScope.length} 行` }}</div><div class="k-foot">{{ task.sample ? "按第 4 步抽样结果" : "尚未抽样" }}</div></div>
        <div class="kpi"><div class="k-label">已命中</div><div class="k-value sm">{{ hit }}</div><div class="k-foot">{{ log.length ? `共 ${log.length} 次抓取` : "尚未抓取" }}</div></div>
        <div class="kpi"><div class="k-label">未命中</div><div class="k-value sm">{{ missList.length }}</div><div class="k-foot">{{ missList.length ? "需补录或更换数据源" : "—" }}</div></div>
      </div>

      <div class="sum-bar">
        <div class="si"><div class="sl">缺风险权重</div><div class="sv" :style="{ color: lackRw ? 'var(--warn)' : 'inherit' }">{{ lackRw }} 笔</div></div>
        <div class="si"><div class="sl">缺 30 天跌幅</div><div class="sv" :style="{ color: lackP30 ? 'var(--warn)' : 'inherit' }">{{ lackP30 }} 笔</div></div>
        <div class="si"><div class="sl">缺债项评级（主权类可不适用）</div><div class="sv" :style="{ color: lackRating ? 'var(--warn)' : 'inherit' }">{{ lackRating }} 笔</div></div>
        <div class="si"><div class="sl">样本已取数</div><div class="sv">{{ withRef.length }} / {{ rowsInScope.length }}</div></div>
      </div>

      <div v-if="missList.length" style="margin-top: 12px">
        <p class="notice warn">
          有 {{ missList.length }} 笔未取到外部信息：{{ missList.slice(0, 5).map((x) => x.secId).join("、") }}{{ missList.length > 5 ? " 等" : "" }}。缺少评级 / 风险权重 / 价格将影响分档判定。
        </p>
        <div style="display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px">
          <button type="button" class="btn sm" @click="downloadMiss">导出未命中清单</button>
          <button type="button" class="btn sm" @click="openManual">手工补录</button>
        </div>
      </div>

      <table v-if="log.length" class="tbl compact" style="margin-top: 12px">
        <thead><tr><th>证券代码</th><th>状态</th><th>来源</th><th>取到的关键字段</th></tr></thead>
        <tbody>
          <tr v-for="(item, i) in log.slice(0, 300)" :key="i">
            <td class="mono" style="font-size: 11px">{{ String(item.secId).replace(/.*[\\|-]/, "") }}</td>
            <td><span class="tag" :class="item.status === '命中' ? 'ok' : 'warn'">{{ item.status }}</span></td>
            <td class="dim">{{ item.by || "—" }}</td>
            <td class="dim" style="font-size: 11px">{{ item.fields || "—" }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>

  <div v-if="manual" class="panel">
    <div class="panel-head">
      <h3>手工补录外部信息（{{ manual.length }} 笔）</h3>
      <span class="spacer"></span>
      <button type="button" class="btn sm" @click="manual = null">取消</button>
      <button type="button" class="btn sm primary" :disabled="busy" @click="saveManual">保存补录</button>
    </div>
    <div class="panel-body tight">
      <p class="dim" style="font-size: 11.5px; margin-bottom: 8px">补录的信息会写入外部参考库并覆盖同名证券，随后可重新抓取。</p>
      <table class="tbl compact">
        <thead><tr><th>证券代码</th><th>债项评级</th><th>风险权重(%)</th><th>30 天跌幅(%)</th></tr></thead>
        <tbody>
          <tr v-for="item in manual" :key="item.secId">
            <td class="mono" style="font-size: 11px">{{ item.secId }}</td>
            <td><input v-model="item.rating" type="text" placeholder="如 A1" style="width: 80px; font-size: 11px" /></td>
            <td><input v-model="item.rw" type="number" placeholder="%" style="width: 64px; font-size: 11px" /></td>
            <td><input v-model="item.p30" type="number" placeholder="%" style="width: 64px; font-size: 11px" /></td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
