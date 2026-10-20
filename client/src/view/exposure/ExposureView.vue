<script setup>
import { ref } from "vue";
import { fetchProductRules } from "@/api/exposure";
import { fetchProducts } from "@/api/product";
import AsyncView from "@/components/AsyncView.vue";

const code = ref("");
</script>

<template>
  <AsyncView :load="fetchProducts">
    <template #default="{ data }">
      <div class="section-tabs" style="margin-bottom: 12px">
        <button
          v-for="item in data"
          :key="item.code"
          type="button"
          class="section-tab"
          :class="{ active: (code || data[0].code) === item.code }"
          @click="code = item.code"
        >{{ item.label }}</button>
      </div>
      <AsyncView :key="code || data[0].code" :load="() => fetchProductRules(code || data[0].code)">
        <template #default="{ data: rules }">
          <div class="panel">
            <div class="panel-head"><h3>专属规则</h3><span class="sub">{{ rules.length }} 条</span></div>
            <div class="panel-body tight">
              <table class="tbl compact">
                <thead><tr><th>顺序</th><th>规则</th><th>条件</th><th>归入</th><th>权重</th></tr></thead>
                <tbody>
                  <tr v-for="row in rules" :key="row.id">
                    <td>{{ row.priority }}</td>
                    <td>{{ row.label }}<div class="mono dim">{{ row.name }}</div></td>
                    <td>{{ row.when }}</td>
                    <td>{{ row.targetClass }}</td>
                    <td>{{ row.weight }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </template>
      </AsyncView>
    </template>
  </AsyncView>
</template>
