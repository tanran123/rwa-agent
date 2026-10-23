<script setup>
import { useRouter } from "vue-router";
import { fetchBatches } from "@/api/batch";
import AsyncView from "@/components/AsyncView.vue";

const router = useRouter();
</script>

<template>
  <AsyncView :load="fetchBatches">
    <template #default="{ data }">
      <div class="panel">
        <div class="panel-head">
          <h3>计量批次</h3>
          <span class="sub">{{ data.length }} 个</span>
          <span class="spacer"></span>
          <button type="button" class="btn sm" @click="router.push('/wizard')">发起计量</button>
        </div>
        <div class="panel-body tight">
          <table class="tbl compact">
            <thead><tr><th>批次</th><th>机构</th><th>版本</th><th>基准日</th><th>导入</th><th>成功</th><th>异常</th><th>EAD</th><th>RWA</th><th>状态</th></tr></thead>
            <tbody>
              <tr v-for="row in data" :key="row.id" class="clickable" @click="router.push('/results?batch=' + row.id)">
                <td><span class="mono">{{ row.id }}</span><div>{{ row.name }}</div></td>
                <td>{{ row.institution }}</td>
                <td>{{ row.version }}</td>
                <td>{{ row.baseDate }}</td>
                <td class="num">{{ row.imported }}</td>
                <td class="num">{{ row.success }}</td>
                <td class="num">{{ row.exception }}</td>
                <td class="num">{{ row.ead ? Number(row.ead).toLocaleString("zh-CN") : "—" }}</td>
                <td class="num">{{ row.rwa ? Number(row.rwa).toLocaleString("zh-CN") : "—" }}</td>
                <td><span class="tag" :class="row.status === 'completed' ? 'ok' : row.status === 'failed' ? 'danger' : 'muted'">{{ row.status === "completed" ? "已完成" : row.status === "failed" ? "存在异常" : row.status === "running" ? "进行中" : row.status }}</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </AsyncView>
</template>
