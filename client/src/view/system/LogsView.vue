<script setup>
import { ref } from "vue";
import { fetchLoginLogs, fetchOperationLogs } from "@/api/admin";
import AsyncView from "@/components/AsyncView.vue";

const tab = ref("ops");
const load = async () => {
  const [ops, logins] = await Promise.all([fetchOperationLogs(), fetchLoginLogs()]);
  return { ops, logins };
};

function badge(row) {
  return row.status === "success" ? { cls: "ok", text: "成功" } : { cls: "danger", text: "失败" };
}

function csv(rows) {
  return rows
    .map((row) => row.map((value) => `"${String(value == null ? "" : value).replace(/"/g, '""')}"`).join(","))
    .join("\n");
}

function download(name, text) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 500);
}

function exportLogs(data) {
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  if (tab.value === "login") {
    const rows = [["时间", "账号", "姓名", "IP", "设备", "结果", "原因"]];
    data.logins.forEach((row) => rows.push([row.at, row.username, row.name, row.ip, row.device, row.status === "success" ? "成功" : "失败", row.reason]));
    download(`RWA_登录日志_${day}.csv`, csv(rows));
    return;
  }
  const rows = [["时间", "操作人", "动作", "对象", "说明"]];
  data.ops.forEach((row) => rows.push([row.at, row.actor, row.action, row.target, row.note]));
  download(`RWA_操作日志_${day}.csv`, csv(rows));
}
</script>

<template>
  <AsyncView :load="load">
    <template #default="{ data }">
      <div class="tabs">
        <button type="button" :class="{ active: tab === 'ops' }" @click="tab = 'ops'">操作日志</button>
        <button type="button" :class="{ active: tab === 'login' }" @click="tab = 'login'">登录日志</button>
        <span class="spacer"></span>
        <button type="button" class="btn sm ghost" @click="exportLogs(data)">导出当前日志</button>
      </div>

      <div class="panel">
        <div class="panel-head">
          <h3>{{ tab === "login" ? "登录日志" : "操作日志" }}</h3>
          <span class="sub">按时间倒序 · 最近 200 条</span>
        </div>
        <div class="panel-body tight">
          <table v-if="tab === 'login'" class="tbl compact">
            <thead><tr><th>时间</th><th>账号</th><th>姓名</th><th>IP</th><th>设备</th><th>结果</th><th>原因</th></tr></thead>
            <tbody>
              <tr v-for="row in data.logins" :key="row.id">
                <td class="mono">{{ row.at }}</td>
                <td class="mono">{{ row.username }}</td>
                <td>{{ row.name }}</td>
                <td class="mono">{{ row.ip }}</td>
                <td>{{ row.device }}</td>
                <td><span class="tag" :class="badge(row).cls">{{ badge(row).text }}</span></td>
                <td class="dim">{{ row.reason || "—" }}</td>
              </tr>
              <tr v-if="!data.logins.length"><td colspan="7" class="dim">暂无登录记录</td></tr>
            </tbody>
          </table>
          <table v-else class="tbl compact">
            <thead><tr><th>时间</th><th>操作人</th><th>动作</th><th>对象</th><th>说明</th></tr></thead>
            <tbody>
              <tr v-for="row in data.ops" :key="row.id">
                <td class="mono">{{ row.at }}</td>
                <td>{{ row.actor || "—" }}</td>
                <td><span class="tag info">{{ row.action }}</span></td>
                <td>{{ row.target || "—" }}</td>
                <td class="dim">{{ row.note || "" }}</td>
              </tr>
              <tr v-if="!data.ops.length"><td colspan="5" class="dim">暂无操作记录。登录后执行确认、配置、导出等动作会写入这里。</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </AsyncView>
</template>
