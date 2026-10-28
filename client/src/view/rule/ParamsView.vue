<script setup>
import { ref } from "vue";
import { createParam, deleteParam, deleteParams, fetchParams, saveParam } from "@/api/rule";
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

function blank() {
  return { creating: true, id: "", grp: "", name: "", value: "", unit: "", usedFor: "" };
}

function create() {
  error.value = "";
  form.value = blank();
}

function edit(row) {
  error.value = "";
  form.value = { ...row, creating: false };
}

function payload(row) {
  return { id: row.id, grp: row.grp, name: row.name, value: row.value, unit: row.unit, usedFor: row.usedFor };
}

useAgentForm({
  forms: [{
    id: "param",
    title: "共用参数",
    fields: [
      { key: "id", label: "编号" },
      { key: "grp", label: "分组" },
      { key: "name", label: "名称" },
      { key: "value", label: "值" },
      { key: "unit", label: "单位" },
      { key: "usedFor", label: "用途" }
    ],
    apply(values) {
      error.value = "";
      form.value = fillForm(blank(), values);
    },
    save: finishSave(() => save(), error)
  }]
});

async function refresh() {
  if (view.value) await view.value.reload();
}

async function save() {
  error.value = "";
  saving.value = true;
  try {
    const body = payload(form.value);
    if (form.value.creating) await createParam(body);
    else await saveParam(form.value.id, body);
    form.value = null;
    await refresh();
  } catch (err) {
    error.value = err.message;
  } finally {
    saving.value = false;
  }
}

async function remove() {
  const yes = await askConfirm("删除参数「" + form.value.name + "」。被银行评级档、转换系数或 EAD 规则引用的参数删不掉。", {
    title: "删除参数",
    confirmText: "删除",
    danger: true
  });
  if (!yes) return;
  error.value = "";
  saving.value = true;
  try {
    await deleteParam(form.value.id);
    form.value = null;
    await refresh();
  } catch (err) {
    error.value = err.message;
  } finally {
    saving.value = false;
  }
}

async function removeSelected(rows) {
  const result = await runBatch(pick, rows, "id", deleteParams, batch, form, (row) => row.id);
  if (result) await refresh();
}
</script>

<template>
  <p v-if="batch.state.text" class="notice" :class="batch.state.kind">{{ batch.state.text }}</p>
  <AsyncView ref="view" :load="fetchParams">
    <template #default="{ data }">
      <div class="panel">
        <div class="panel-head">
          <h3>共用参数</h3>
          <span class="sub">{{ data.length }} 项</span>
          <span class="spacer"></span>
          <button type="button" class="btn sm danger" :disabled="!pick.visibleIds(data).length" @click="removeSelected(data)">删除所选</button>
          <button type="button" class="btn sm primary" @click="create">新建</button>
        </div>
        <div class="panel-body tight">
          <table class="tbl">
            <thead>
              <tr>
                <th class="pick" @click.stop><input type="checkbox" :checked="pick.allOn(data)" @change="pick.toggleAll(data)" /></th>
                <th>分组</th><th>名称</th><th>值</th><th>单位</th><th>用途</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in data" :key="row.id" class="clickable" @click="edit(row)">
                <td class="pick" @click.stop><input type="checkbox" :checked="pick.on(row.id)" @change="pick.toggle(row.id)" /></td>
                <td>{{ row.grp }}</td>
                <td>{{ row.name }}</td>
                <td class="mono">{{ row.value }}</td>
                <td>{{ row.unit }}</td>
                <td class="dim">{{ row.usedFor }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </AsyncView>
  <RuleForm
    :open="!!form"
    :title="form && form.creating ? '新建参数' : '编辑参数'"
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
      <label class="field">分组
        <input v-model="form.grp" type="text" />
      </label>
      <label class="field">名称
        <input v-model="form.name" type="text" />
      </label>
      <label class="field">值
        <input v-model="form.value" type="text" />
      </label>
      <label class="field">单位
        <input v-model="form.unit" type="text" />
      </label>
      <label class="field full">用途
        <textarea v-model="form.usedFor"></textarea>
      </label>
    </template>
  </RuleForm>
</template>
