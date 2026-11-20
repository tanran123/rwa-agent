<script setup>
import { computed } from "vue";

const props = defineProps({
  document: { type: Object, required: true },
  saving: { type: Boolean, default: false },
  readonly: { type: Boolean, default: false }
});
const emit = defineEmits(["update", "save"]);

const columns = computed(() => props.document.columns || []);
const rows = computed(() => props.document.rows || []);

function clone() {
  return JSON.parse(JSON.stringify(props.document));
}

function setCell(rowIndex, columnIndex, value) {
  const next = clone();
  next.rows[rowIndex][columnIndex] = value;
  emit("update", next);
}

function addRow() {
  const next = clone();
  next.rows.push(columns.value.map(() => ""));
  emit("update", next);
}

function removeRow(index) {
  const next = clone();
  next.rows.splice(index, 1);
  emit("update", next);
}
</script>

<template>
  <div class="panel">
    <div class="panel-head">
      <h3>{{ document.title }}</h3>
      <span class="sub mono">{{ document.tableId || document.listId }} · {{ document.version }}</span>
      <span class="spacer"></span>
      <span v-if="readonly" class="tag muted">已发布只读</span>
      <button type="button" class="btn sm" :disabled="readonly" @click="addRow">新增一行</button>
      <button type="button" class="btn sm primary" :disabled="saving || readonly" @click="$emit('save')">{{ saving ? "保存中" : "保存" }}</button>
    </div>
    <div class="panel-body tight">
      <table class="tbl compact">
        <thead>
          <tr>
            <th v-for="column in columns" :key="column">{{ column }}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, rowIndex) in rows" :key="rowIndex">
            <td v-for="(cell, columnIndex) in row" :key="columnIndex">
              <input :value="cell" type="text" :readonly="readonly" style="width: 100%; min-width: 80px" @change="setCell(rowIndex, columnIndex, $event.target.value)" />
            </td>
            <td><button type="button" class="btn sm danger" :disabled="readonly" @click="removeRow(rowIndex)">删除</button></td>
          </tr>
        </tbody>
      </table>
      <p v-if="!rows.length" class="dim" style="padding: 14px">还没有数据行。名单正文可以在页面补录，也可以从 docs 下的 CSV 重新导入。</p>
    </div>
  </div>
</template>
