<script setup>
import { ref } from "vue";
import { createOrg, deleteOrg, deleteOrgs, fetchOrgs, saveOrg } from "@/api/rule";
import { useContext } from "@/composables/useContext";
import { runBatch, useBatchNote, usePick } from "@/composables/usePick";
import AsyncView from "@/components/AsyncView.vue";
import RuleForm from "@/components/RuleForm.vue";
import { fillForm, finishSave, useAgentForm } from "@/composables/useAgentForm";
import { askConfirm } from "@/utils/confirm";

const { session, setOrg, loadBootstrap } = useContext();
const form = ref(null);
const error = ref("");
const saving = ref(false);
const view = ref(null);
const pick = usePick();
const batch = useBatchNote();
const load = () => fetchOrgs(session.jurisdiction);

const jurLabel = (code) => (session.jurisdictions.find((item) => item.code === code) || {}).label || code;

function blank() {
  return {
    creating: true,
    id: "",
    name: "",
    jurisdiction: session.jurisdiction || (session.jurisdictions[0] ? session.jurisdictions[0].code : "")
  };
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
  return { id: row.id, name: row.name, jurisdiction: row.jurisdiction };
}

useAgentForm(() => ({
  forms: [{
    id: "org",
    title: "机构",
    fields: [
      { key: "id", label: "编号" },
      { key: "name", label: "名称" },
      { key: "jurisdiction", label: "地区", options: session.jurisdictions.map((item) => item.code) }
    ],
    apply(values) {
      error.value = "";
      form.value = fillForm(blank(), values);
    },
    save: finishSave(() => save(), error)
  }]
}));

async function refresh() {
  await loadBootstrap();
  if (view.value) await view.value.reload();
}

async function save() {
  error.value = "";
  saving.value = true;
  try {
    const body = payload(form.value);
    if (form.value.creating) await createOrg(body);
    else await saveOrg(form.value.id, body);
    form.value = null;
    await loadBootstrap();
    const org = session.orgs.find((item) => item.id === body.id);
    if (org && org.jurisdiction !== session.jurisdiction) setOrg(org.id);
    else if (view.value) await view.value.reload();
  } catch (err) {
    error.value = err.message;
  } finally {
    saving.value = false;
  }
}

async function remove() {
  const yes = await askConfirm("删除机构「" + form.value.name + "」。被规则版本或计量批次引用的机构删不掉。", {
    title: "删除机构",
    confirmText: "删除",
    danger: true
  });
  if (!yes) return;
  error.value = "";
  saving.value = true;
  try {
    await deleteOrg(form.value.id);
    form.value = null;
    await refresh();
  } catch (err) {
    error.value = err.message;
  } finally {
    saving.value = false;
  }
}

async function removeSelected(rows) {
  const result = await runBatch(pick, rows, "id", deleteOrgs, batch, form, (row) => row.id);
  if (result) await refresh();
}
</script>

<template>
  <p v-if="batch.state.text" class="notice" :class="batch.state.kind">{{ batch.state.text }}</p>
  <AsyncView ref="view" :load="load">
    <template #default="{ data }">
      <div class="panel">
        <div class="panel-head">
          <h3>机构</h3>
          <span class="sub">共 {{ data.length }} 个</span>
          <span class="spacer"></span>
          <button type="button" class="btn sm danger" :disabled="!pick.visibleIds(data).length" @click="removeSelected(data)">删除所选</button>
          <button type="button" class="btn sm primary" @click="create">新建</button>
        </div>
        <div class="panel-body tight">
          <table class="tbl compact">
            <thead>
              <tr>
                <th class="pick" @click.stop><input type="checkbox" :checked="pick.allOn(data)" @change="pick.toggleAll(data)" /></th>
                <th>编号</th><th>名称</th><th>地区</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in data" :key="row.id" class="clickable" @click="edit(row)">
                <td class="pick" @click.stop><input type="checkbox" :checked="pick.on(row.id)" @change="pick.toggle(row.id)" /></td>
                <td class="mono">{{ row.id }}</td>
                <td>{{ row.name }}</td>
                <td>{{ jurLabel(row.jurisdiction) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </AsyncView>
  <RuleForm
    :open="!!form"
    :title="form ? (form.creating ? '新建机构' : form.name) : ''"
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
      <label class="field">名称
        <input v-model="form.name" type="text" />
      </label>
      <label class="field">地区
        <select v-model="form.jurisdiction">
          <option v-for="item in session.jurisdictions" :key="item.code" :value="item.code">{{ item.label }}</option>
        </select>
      </label>
    </template>
  </RuleForm>
</template>
