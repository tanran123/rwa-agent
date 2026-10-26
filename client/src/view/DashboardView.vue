<script setup>
import { computed } from "vue";
import { useRouter } from "vue-router";
import { fetchDashboard } from "@/api/dashboard";
import { useContext } from "@/composables/useContext";
import AsyncView from "@/components/AsyncView.vue";

const router = useRouter();
const { session, currentVersion, scopeVersion } = useContext();
const steps = [
  ["1", "规则配置", "版本、条款、字段、暴露分类、EAD、缓释", "/versions"],
  ["2", "暴露分类规则", "通用、贷款、债券各自一份分类 JSON", "/tree"],
  ["3", "EAD 计算规则", "按产品配置，表内和表外互斥", "/ead"],
  ["4", "计量执行", "计量向导 → 结果明细", "/wizard"]
];
const statusLabel = { completed: "已完成", running: "进行中", failed: "失败", draft: "草稿", pending: "待处理" };
const rank = { "BATCH-202609-MO-01": 0, "BATCH-202606-MO-01": 1, "BATCH-202609-CN-01": 2 };

const jurLabel = computed(() => {
  const hit = session.jurisdictions.find((item) => item.code === session.jurisdiction);
  return hit ? hit.label : session.jurisdiction;
});

function rowsOf(list) {
  return [...(list || [])]
    .filter((row) => row.jurisdiction === session.jurisdiction && row.version === scopeVersion.value)
    .sort((a, b) => (rank[a.id] ?? 9) - (rank[b.id] ?? 9) || String(a.id).localeCompare(String(b.id)));
}
function money(row) {
  const n = Number(row.onEad || 0) + Number(row.offEad || 0) || Number(row.ead || 0);
  return n ? n : "—";
}
</script>

<template>
  <AsyncView :load="fetchDashboard">
    <template #default="{ data }">
      <div class="grid c4" style="margin-bottom: 16px">
        <div class="kpi accent"><div class="k-label">规则节点</div><div class="k-value">{{ data.nodeCount }}</div><div class="k-foot">{{ data.topRules }} 个顶层分类</div></div>
        <div class="kpi"><div class="k-label">标准字段</div><div class="k-value">{{ data.fieldCount }}</div><div class="k-foot">规则判断的统一输入</div></div>
        <div class="kpi"><div class="k-label">最近批次</div><div class="k-value sm">尚未运行</div><div class="k-foot">从计量向导发起</div></div>
        <div class="kpi"><div class="k-label">当前版本</div><div class="k-value sm">{{ (currentVersion || {}).version || "—" }}</div><div class="k-foot">{{ jurLabel }}</div></div>
      </div>
      <div class="grid c2" style="margin-bottom: 16px">
        <div v-for="step in steps" :key="step[0]" class="fblock" style="cursor: pointer" @click="router.push(step[3])">
          <div class="fh"><span class="tag brand">{{ step[0] }}</span><span class="fname">{{ step[1] }}</span></div>
          <div class="fmean">{{ step[2] }}</div>
        </div>
      </div>
      <div class="panel">
        <div class="panel-head">
          <h3>最近计量批次</h3>
        </div>
        <div class="panel-body tight">
          <table class="tbl compact">
            <thead><tr><th>批次名称</th><th>基准日</th><th>版本</th><th>债项</th><th>EAD</th><th>RWA</th><th>状态</th></tr></thead>
            <tbody>
              <tr v-for="row in rowsOf(data.batches)" :key="row.id" class="clickable" @click="router.push('/results?batch=' + row.id)">
                <td>{{ row.name }}</td>
                <td>{{ row.baseDate }}</td>
                <td>{{ row.version }}</td>
                <td class="num">{{ row.imported }}</td>
                <td class="num">{{ money(row) }}</td>
                <td class="num">{{ Number(row.rwa) ? row.rwa : "—" }}</td>
                <td><span class="tag ok">{{ statusLabel[row.status] || row.status }}</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </AsyncView>
</template>
