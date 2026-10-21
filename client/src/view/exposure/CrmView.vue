<script setup>
import { fetchCrm } from "@/api/exposure";
import AsyncView from "@/components/AsyncView.vue";

const substitute = {
  collateral: "覆盖部分取质物权重",
  guarantor: "覆盖部分取保证人权重",
  provider: "覆盖部分取保护提供方权重"
};
</script>

<template>
  <AsyncView :load="fetchCrm">
    <template #default="{ data }">
      <div class="panel">
        <div class="panel-head"><h3>缓释工具</h3><span class="sub">{{ data.length }} 条</span></div>
        <div class="panel-body tight">
          <table class="tbl compact">
            <thead><tr><th>类型</th><th>合格工具</th><th>覆盖部分</th><th>不计入</th></tr></thead>
            <tbody>
              <tr v-for="row in data" :key="row.id">
                <td>{{ row.type }}</td>
                <td>{{ row.tool }}</td>
                <td>{{ substitute[row.substitute] || row.substitute }}</td>
                <td>
                  <span v-if="row.constraints.maturity">期限 </span>
                  <span v-if="row.constraints.currency">币种 </span>
                  <span v-if="row.constraints.correlation">相关 </span>
                  <span v-if="row.floorParam">底线 {{ row.floorParam }}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </AsyncView>
</template>
