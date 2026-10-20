<script setup>
import { fetchCcf } from "@/api/ead";
import AsyncView from "@/components/AsyncView.vue";
</script>

<template>
  <AsyncView :load="fetchCcf">
    <template #default="{ data }">
      <div class="panel">
        <div class="panel-head"><h3>信用转换系数</h3><span class="sub">{{ data.length }} 条</span></div>
        <div class="panel-body tight">
          <table class="tbl compact">
            <thead><tr><th>类型</th><th>条件</th><th>系数</th><th>优先级</th></tr></thead>
            <tbody>
              <tr v-for="row in data" :key="row.id">
                <td>{{ row.type }}</td>
                <td>{{ row.cond }}</td>
                <td class="strong">{{ row.ccf }}</td>
                <td>{{ row.pri }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </AsyncView>
</template>
