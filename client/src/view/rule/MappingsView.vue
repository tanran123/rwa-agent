<script setup>
import { fetchFieldMappings } from "@/api/product";
import AsyncView from "@/components/AsyncView.vue";
</script>

<template>
  <AsyncView :load="() => fetchFieldMappings()">
    <template #default="{ data }">
      <div class="panel">
        <div class="panel-head"><h3>源字段映射</h3><span class="sub">{{ data.length }} 条</span></div>
        <div class="panel-body tight">
          <table class="tbl compact">
            <thead><tr><th>产品</th><th>标准字段</th><th>源系统</th><th>源字段</th><th>转换</th><th>状态</th></tr></thead>
            <tbody>
              <tr v-for="(row, index) in data" :key="index">
                <td>{{ row.product }}</td>
                <td>{{ row.stdField }}<div class="mono dim">{{ row.stdCode }}</div></td>
                <td>{{ row.srcSystem }}</td>
                <td>{{ row.srcField }}</td>
                <td>{{ row.via }}</td>
                <td><span class="tag" :class="row.status === 'ok' ? 'ok' : row.status === 'warn' ? 'warn' : 'danger'">{{ row.status }}</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </AsyncView>
</template>
