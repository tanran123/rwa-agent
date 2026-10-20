<script setup>
import { ref } from "vue";
import { fetchClauses } from "@/api/rule";
import { useContext } from "@/composables/useContext";
import AsyncView from "@/components/AsyncView.vue";

const { session } = useContext();
const jur = ref("");
const q = ref("");
const open = ref(null);
const load = () => fetchClauses({ jurisdiction: jur.value, q: q.value });
</script>

<template>
  <div class="inline-fields" style="margin-bottom: 12px">
    <select v-model="jur">
      <option value="">全部地区</option>
      <option v-for="item in session.jurisdictions" :key="item.code" :value="item.code">{{ item.label }}</option>
    </select>
    <input v-model="q" type="search" placeholder="条款编号、标题或制度" />
  </div>
  <AsyncView :key="jur + q" :load="load">
    <template #default="{ data }">
      <div class="panel">
        <div class="panel-head"><h3>监管条款</h3><span class="sub">{{ data.length }} 条</span></div>
        <div class="panel-body tight">
          <table class="tbl compact">
            <thead><tr><th>条款</th><th>标题</th><th>地区</th><th>被引用</th></tr></thead>
            <tbody>
              <tr v-for="row in data" :key="row.id" class="clickable" @click="open = row">
                <td class="mono">{{ row.clause }}</td>
                <td>{{ row.title }}</td>
                <td>{{ row.jurisdiction }}</td>
                <td>{{ row.referencedBy.length }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <div v-if="open" class="panel" style="margin-top: 12px">
        <div class="panel-head"><h3>{{ open.clause }} {{ open.title }}</h3></div>
        <div class="panel-body">
          <p>{{ open.text }}</p>
          <p class="dim">{{ open.doc }} · {{ open.source }}</p>
          <p v-if="open.referencedBy.length">引用规则：{{ open.referencedBy.join("、") }}</p>
        </div>
      </div>
    </template>
  </AsyncView>
</template>
