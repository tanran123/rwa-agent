<script setup>
import { ref } from "vue";
import { fetchTokenLogs } from "@/api/admin";
import AsyncView from "@/components/AsyncView.vue";

function day(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const filters = ref({ from: day(-30), to: day(), user: "all", model: "all" });
const query = ref({ ...filters.value });
const key = ref(JSON.stringify(query.value));

const load = () => fetchTokenLogs(query.value);

function apply() {
  query.value = { ...filters.value };
  key.value = JSON.stringify(query.value);
}

function reset() {
  filters.value = { from: day(-30), to: day(), user: "all", model: "all" };
  apply();
}

function range(days) {
  filters.value.from = day(-(days - 1));
  filters.value.to = day();
  apply();
}

function num(value) {
  return Number(value || 0).toLocaleString("zh-CN");
}

function csv(rows) {
  return rows
    .map((row) => row.map((value) => `"${String(value == null ? "" : value).replace(/"/g, '""')}"`).join(","))
    .join("\n");
}

function exportRows(data) {
  const rows = [["时间", "请求 ID", "模型", "场景", "用户", "机构", "Prompt", "Completion", "Total", "延迟(秒)", "状态"]];
  data.rows.forEach((row) => rows.push([row.at, row.requestId, row.model, row.scene, row.user, row.org, row.prompt, row.completion, row.total, row.latency, row.status]));
  const blob = new Blob(["﻿" + csv(rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `RWA_Token调用_${data.summary.from || "不限"}_至_${data.summary.to || "不限"}.csv`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 500);
}
</script>

<template>
  <AsyncView :key="key" :load="load">
    <template #default="{ data }">
      <div class="panel" style="margin-bottom: 12px">
        <div class="panel-body">
          <div class="adm-query">
            <label>开始日期<input v-model="filters.from" type="date" /></label>
            <label>结束日期<input v-model="filters.to" type="date" /></label>
            <label>用户
              <select v-model="filters.user">
                <option value="all">全部用户</option>
                <option v-for="item in data.users" :key="item" :value="item">{{ item }}</option>
              </select>
            </label>
            <label>模型
              <select v-model="filters.model">
                <option value="all">全部模型</option>
                <option v-for="item in data.models" :key="item" :value="item">{{ item }}</option>
              </select>
            </label>
            <button type="button" class="btn sm primary" @click="apply">查询</button>
            <button type="button" class="btn sm ghost" @click="reset">重置</button>
            <span class="adm-quick">
              <button type="button" class="adm-role-chip" @click="range(7)">近 7 天</button>
              <button type="button" class="adm-role-chip" @click="range(30)">近 30 天</button>
            </span>
          </div>
        </div>
      </div>

      <div class="adm-summary">
        <b>统计结果</b>
        <span>{{ data.summary.from || "不限" }} 至 {{ data.summary.to || "不限" }}</span>
        <span>用户：{{ data.summary.user === "all" ? "全部" : data.summary.user }}</span>
        <span>模型：{{ data.summary.model === "all" ? "全部" : data.summary.model }}</span>
        <span>调用 <b>{{ data.summary.count }}</b> 次</span>
        <span>Token <b>{{ num(data.summary.total) }}</b></span>
        <span>成功率 <b>{{ data.summary.successRate }}%</b></span>
        <span class="spacer"></span>
        <button type="button" class="btn sm ghost" @click="exportRows(data)">导出当前结果</button>
      </div>

      <div class="panel">
        <div class="panel-head"><h3>调用明细</h3><span class="sub">{{ data.rows.length }} 条</span></div>
        <div class="panel-body tight">
          <table class="tbl compact">
            <thead>
              <tr>
                <th>时间</th><th>请求 ID</th><th>模型</th><th>场景</th><th>用户 / 机构</th>
                <th style="text-align: right">Prompt</th><th style="text-align: right">Completion</th><th style="text-align: right">Total</th>
                <th style="text-align: right">延迟</th><th>状态</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in data.rows" :key="row.id">
                <td class="mono">{{ row.at }}</td>
                <td class="mono">{{ row.requestId }}</td>
                <td>{{ row.model }}</td>
                <td>{{ row.scene }}</td>
                <td>{{ row.user }}<div class="dim">{{ row.org || "—" }}</div></td>
                <td class="mono" style="text-align: right">{{ num(row.prompt) }}</td>
                <td class="mono" style="text-align: right">{{ num(row.completion) }}</td>
                <td class="mono" style="text-align: right"><b>{{ num(row.total) }}</b></td>
                <td class="mono" style="text-align: right">{{ Number(row.latency).toFixed(1) }}s</td>
                <td><span class="tag" :class="row.status === 'success' ? 'ok' : 'danger'">{{ row.status === "success" ? "成功" : "失败" }}</span></td>
              </tr>
              <tr v-if="!data.rows.length"><td colspan="10" class="dim">当前时间区间 / 用户条件下没有调用记录</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </AsyncView>
</template>
