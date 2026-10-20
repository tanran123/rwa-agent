<script setup>
import { onMounted, ref } from "vue";
import { fetchParams, saveParam } from "@/api/rule";

const rows = ref([]);
const draft = ref({});
const error = ref("");
const message = ref("");

async function load() {
  error.value = "";
  try {
    rows.value = await fetchParams();
    rows.value.forEach((row) => {
      if (draft.value[row.id] == null) draft.value[row.id] = row.value;
    });
  } catch (err) {
    error.value = err.message;
  }
}

async function save(row) {
  message.value = "";
  await saveParam(row.id, draft.value[row.id]);
  message.value = row.name + " 已保存";
  draft.value[row.id] = null;
  await load();
}

onMounted(load);
</script>

<template>
  <p v-if="error" class="notice danger">{{ error }}</p>
  <p v-if="message" class="notice ok">{{ message }}</p>
  <div class="panel">
    <div class="panel-head"><h3>共用参数</h3><span class="sub">{{ rows.length }} 项</span></div>
    <div class="panel-body tight">
      <table class="tbl">
        <thead><tr><th>分组</th><th>名称</th><th>值</th><th>用途</th><th></th></tr></thead>
        <tbody>
          <tr v-for="row in rows" :key="row.id">
            <td>{{ row.grp }}</td>
            <td>{{ row.name }}</td>
            <td><input v-model="draft[row.id]" style="width: 88px" /></td>
            <td class="dim">{{ row.usedFor }}</td>
            <td><button type="button" class="btn sm" @click="save(row)">保存</button></td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
