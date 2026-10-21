<script setup>
import { ref } from "vue";
import { fetchWeights } from "@/api/exposure";
import AsyncView from "@/components/AsyncView.vue";

const klass = ref("");
</script>

<template>
  <AsyncView :load="fetchWeights">
    <template #default="{ data }">
      <div class="inline-fields" style="margin-bottom: 12px">
        <select v-model="klass">
          <option value="">全部大类</option>
          <option v-for="name in [...new Set(data.rules.map((row) => row.cls))]" :key="name" :value="name">{{ name }}</option>
        </select>
      </div>
      <div class="panel" style="margin-bottom: 12px">
        <div class="panel-head"><h3>权重规则</h3></div>
        <div class="panel-body tight">
          <table class="tbl compact">
            <thead><tr><th>大类</th><th>条件</th><th>权重</th><th>档</th><th>依据</th></tr></thead>
            <tbody>
              <tr v-for="row in data.rules.filter((item) => !klass || item.cls === klass)" :key="row.id">
                <td>{{ row.cls }}</td>
                <td>{{ row.cond }}</td>
                <td class="strong">{{ row.rw }}</td>
                <td>{{ row.bank }}</td>
                <td class="dim">{{ row.basis }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <div class="grid c2">
        <div class="panel">
          <div class="panel-head"><h3>第一档银行评级</h3></div>
          <div class="panel-body tight">
            <table class="tbl compact">
              <thead><tr><th>情形</th><th>A+</th><th>A</th><th>B</th><th>C</th></tr></thead>
              <tbody>
                <tr v-for="row in data.grades" :key="row.id">
                  <td>{{ row.label }}</td>
                  <td v-for="(weight, index) in row.weights" :key="index">{{ weight }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <div class="panel">
          <div class="panel-head"><h3>澳门评级档</h3></div>
          <div class="panel-body tight">
            <table class="tbl compact">
              <thead><tr><th>类别</th><th>权重</th></tr></thead>
              <tbody>
                <tr v-for="row in data.mo" :key="row.id">
                  <td>{{ row.bucket }}</td>
                  <td>{{ row.weights.join(" / ") }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </template>
  </AsyncView>
</template>
