<script setup>
import { ref } from "vue";
import { fetchProductRules } from "@/api/exposure";
import { fetchProducts } from "@/api/product";
import AsyncView from "@/components/AsyncView.vue";

const code = ref("");
const load = () => Promise.all([fetchProducts(), fetchProductRules()]);

function rulesOf(rows) {
  return (rows || []).filter((item) => !code.value || item.product === code.value);
}
function countFor(rows, product) {
  return (rows || []).filter((item) => item.product === product).length;
}
</script>

<template>
  <AsyncView :load="load">
    <template #default="{ data }">
      <div class="panel">
        <div class="panel-head">
          <h3>产品专属规则向导</h3>
          <span class="sub">选择产品 → 看它挂上的通用规则分支</span>
        </div>
        <div class="panel-body">
          <div class="steps">
            <div class="step" :class="{ active: !code }"><span class="sn">1</span>选择产品</div>
            <span class="step-arrow">›</span>
            <div class="step" :class="{ active: !!code, done: !!code }"><span class="sn">2</span>通用规则分支</div>
          </div>
          <p class="dim" style="font-size: 12px">选择要查看的产品。同一产品的专属规则挂在通用分类下面。</p>
          <div class="grid c3">
            <button
              v-for="item in data[0]"
              :key="item.code"
              type="button"
              class="wiz-pick"
              :class="{ on: code === item.code }"
              @click="code = item.code"
            >
              <strong>{{ item.label }}</strong>
              <span class="dim">{{ countFor(data[1], item.code) }} 条专属规则 · {{ item.fieldCount }} 个标准字段</span>
            </button>
          </div>
        </div>
      </div>
      <div v-if="code" class="panel">
        <div class="panel-head">
          <h3>{{ (data[0].find((item) => item.code === code) || {}).label }}</h3>
          <span class="sub">{{ countFor(data[1], code) }} 条</span>
        </div>
        <div class="panel-body tight">
          <table class="tbl compact">
            <thead><tr><th>顺序</th><th>规则</th><th>条件</th><th>归入</th><th>权重</th><th>条款</th></tr></thead>
            <tbody>
              <tr v-for="row in rulesOf(data[1])" :key="row.id">
                <td>{{ row.priority }}</td>
                <td>{{ row.label }}<div class="mono dim">{{ row.name }}</div></td>
                <td>{{ row.when }}</td>
                <td>{{ row.targetClass }} · {{ row.targetSub }}</td>
                <td>{{ row.weight }}</td>
                <td class="mono">{{ row.clause }}</td>
              </tr>
            </tbody>
          </table>
          <p v-if="!countFor(data[1], code)" class="dim" style="padding: 14px">这个产品还没有专属规则，计量时直接用通用暴露分类。</p>
        </div>
      </div>
    </template>
  </AsyncView>
</template>
