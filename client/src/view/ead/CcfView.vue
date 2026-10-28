<script setup>
import { ref } from "vue";
import { createCcf, deleteCcf, deleteCcfs, fetchCcf, saveCcf } from "@/api/ead";
import { runBatch, useBatchNote, usePick } from "@/composables/usePick";
import AsyncView from "@/components/AsyncView.vue";
import RuleForm from "@/components/RuleForm.vue";
import { fillForm, finishSave, useAgentForm } from "@/composables/useAgentForm";
import { askConfirm } from "@/utils/confirm";

const form = ref(null);
const error = ref("");
const saving = ref(false);
const view = ref(null);
const pick = usePick();
const batch = useBatchNote();

function create() {
  error.value = "";
  form.value = { creating: true, id: "", type: "", cond: "", ccf: "", pri: 0, condsText: "" };
}

function edit(row) {
  error.value = "";
  form.value = {
    creating: false,
    id: row.id,
    type: row.type,
    cond: row.cond,
    ccf: row.ccf,
    pri: row.pri,
    condsText: row.conds ? JSON.stringify(row.conds, null, 2) : ""
  };
}

useAgentForm({
  forms: [{
    id: "ccf",
    title: "转换系数",
    fields: [
      { key: "id", label: "编号" },
      { key: "pri", label: "优先级" },
      { key: "type", label: "类型" },
      { key: "ccf", label: "系数" },
      { key: "cond", label: "条件" },
      { key: "condsText", label: "附加条件" }
    ],
    apply(values) {
      error.value = "";
      form.value = fillForm({ creating: true, id: "", type: "", cond: "", ccf: "", pri: 0, condsText: "" }, values);
    },
    save: finishSave(() => save(), error)
  }]
});

function payload(row) {
  const raw = String(row.condsText || "").trim();
  let conds = null;
  if (raw) {
    try { conds = JSON.parse(raw); }
    catch { throw new Error("条件不是合法的 JSON"); }
    if (!Array.isArray(conds)) throw new Error("条件要是 JSON 数组");
  }
  return { id: row.id, type: row.type, cond: row.cond, ccf: row.ccf, pri: Number(row.pri), conds };
}

async function refresh() {
  if (view.value) await view.value.reload();
}

async function save() {
  error.value = "";
  saving.value = true;
  try {
    const body = payload(form.value);
    if (form.value.creating) await createCcf(body);
    else await saveCcf(form.value.id, body);
    form.value = null;
    await refresh();
  } catch (err) {
    error.value = err.message;
  } finally {
    saving.value = false;
  }
}

async function remove() {
  const yes = await askConfirm("删除转换系数「" + form.value.type + "」。", {
    title: "删除转换系数",
    confirmText: "删除",
    danger: true
  });
  if (!yes) return;
  error.value = "";
  saving.value = true;
  try {
    await deleteCcf(form.value.id);
    form.value = null;
    await refresh();
  } catch (err) {
    error.value = err.message;
  } finally {
    saving.value = false;
  }
}

async function removeSelected(rows) {
  const result = await runBatch(pick, rows, "id", deleteCcfs, batch, form, (row) => row.id);
  if (result) await refresh();
}
</script>

<template>
  <p v-if="batch.state.text" class="notice" :class="batch.state.kind">{{ batch.state.text }}</p>
  <AsyncView ref="view" :load="fetchCcf">
    <template #default="{ data }">
      <div class="panel">
        <div class="panel-head">
          <h3>信用转换系数</h3>
          <span class="sub">{{ data.length }} 条</span>
          <span class="spacer"></span>
          <button type="button" class="btn sm danger" :disabled="!pick.visibleIds(data).length" @click="removeSelected(data)">删除所选</button>
          <button type="button" class="btn sm primary" @click="create">新建</button>
        </div>
        <div class="panel-body tight">
          <table class="tbl compact">
            <thead>
              <tr>
                <th class="pick" @click.stop><input type="checkbox" :checked="pick.allOn(data)" @change="pick.toggleAll(data)" /></th>
                <th>类型</th><th>条件</th><th>系数</th><th>优先级</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in data" :key="row.id" class="clickable" @click="edit(row)">
                <td class="pick" @click.stop><input type="checkbox" :checked="pick.on(row.id)" @change="pick.toggle(row.id)" /></td>
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
  <RuleForm
    :open="!!form"
    :title="form && form.creating ? '新建转换系数' : '编辑转换系数'"
    :error="error"
    :saving="saving"
    :creating="!!(form && form.creating)"
    @close="form = null"
    @save="save"
    @remove="remove"
  >
    <template v-if="form">
      <label class="field">编号
        <input v-model="form.id" type="text" :disabled="!form.creating" />
      </label>
      <label class="field">优先级
        <input v-model="form.pri" type="number" />
      </label>
      <label class="field">类型
        <input v-model="form.type" type="text" />
      </label>
      <label class="field">系数
        <input v-model="form.ccf" type="text" />
      </label>
      <label class="field full">条件
        <input v-model="form.cond" type="text" />
      </label>
      <label class="field full">附加条件
        <textarea v-model="form.condsText"></textarea>
        <span class="hint">JSON 数组。留空表示没有。</span>
      </label>
    </template>
  </RuleForm>
</template>
