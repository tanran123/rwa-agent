<script setup>
import { ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { createOrg, deleteOrg, deleteOrgs, fetchOrgs, saveOrg } from "@/api/rule";
import { useContext } from "@/composables/useContext";
import { runBatch, useBatchNote, usePick } from "@/composables/usePick";
import AsyncView from "@/components/AsyncView.vue";
import RuleForm from "@/components/RuleForm.vue";
import { fillForm, finishSave, useAgentForm } from "@/composables/useAgentForm";
import { askConfirm } from "@/utils/confirm";

const { session, loadBootstrap } = useContext();
const route = useRoute();
const router = useRouter();
const form = ref(null);
const error = ref("");
const saving = ref(false);
const view = ref(null);
const original = ref(null);
const pick = usePick();
const batch = useBatchNote();
const region = ref(String(route.query.jurisdiction || session.jurisdiction || "").toUpperCase());
const load = () => fetchOrgs(region.value);

const jurLabel = (code) => (session.jurisdictions.find((item) => item.code === code) || {}).label || code;

function blank() {
  return {
    creating: true,
    id: "",
    name: "",
    jurisdiction: region.value || session.jurisdiction || (session.jurisdictions[0] ? session.jurisdictions[0].code : "")
  };
}

function create() {
  error.value = "";
  original.value = null;
  form.value = blank();
}

function edit(row) {
  error.value = "";
  original.value = row;
  form.value = { ...row, creating: false };
}

function closeForm() {
  form.value = null;
  original.value = null;
}

function changeRegion(code) {
  const next = String(code || "").toUpperCase();
  if (!next || next === region.value) return;
  region.value = next;
  pick.clear();
  batch.clear();
  if (route.query.jurisdiction !== next) {
    router.replace({ query: { ...route.query, jurisdiction: next } });
  }
  if (view.value) view.value.reload();
}

watch(() => route.query.jurisdiction, (code) => {
  if (route.path !== "/orgs") return;
  const next = String(code || session.jurisdiction || "").toUpperCase();
  if (!next || next === region.value) return;
  region.value = next;
  pick.clear();
  if (view.value) view.value.reload();
});

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
    closeForm();
    await loadBootstrap();
    const org = session.orgs.find((item) => item.id === body.id);
    if (org && org.jurisdiction !== region.value) {
      region.value = org.jurisdiction;
      router.replace({ query: { ...route.query, jurisdiction: org.jurisdiction } });
    }
    if (view.value) await view.value.reload();
  } catch (err) {
    error.value = err.message;
  } finally {
    saving.value = false;
  }
}

async function remove() {
  const source = original.value || form.value;
  if (!source) return;
  const yes = await askConfirm("删除机构「" + source.name + "」。被规则版本或计量批次引用的机构删不掉。", {
    title: "删除机构",
    confirmText: "删除",
    danger: true
  });
  if (!yes) return;
  error.value = "";
  saving.value = true;
  try {
    await deleteOrg(source.id);
    closeForm();
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
          <select class="org-region" :value="region" aria-label="地区" @change="changeRegion($event.target.value)">
            <option v-for="item in session.jurisdictions" :key="item.code" :value="item.code">{{ item.label }}</option>
          </select>
          <span class="sub">共 {{ data.length }} 个</span>
          <span class="spacer"></span>
          <button type="button" class="btn sm danger" :disabled="!pick.visibleIds(data).length" @click="removeSelected(data)">删除所选</button>
          <button type="button" class="btn sm primary" @click="create">新建</button>
        </div>
        <div class="panel-body tight">
          <div v-if="!data.length" class="empty">这个地区还没有机构。点「新建」添加，机构编号全局唯一、名称同地区唯一。</div>
          <table v-else class="tbl compact">
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
    :title="form ? (form.creating ? '新建机构' : (original ? original.name : form.name)) : ''"
    :error="error"
    :saving="saving"
    :creating="!!(form && form.creating)"
    @close="closeForm"
    @save="save"
    @remove="remove"
  >
    <template v-if="form">
      <label class="field">编号
        <input v-model="form.id" type="text" :disabled="!form.creating" />
      </label>
      <label class="field">名称
        <input v-model="form.name" type="text" />
        <span v-if="!form.creating && original && form.name !== original.name" class="hint">修改尚未保存；删除按原机构「{{ original.name }}」处理。</span>
      </label>
      <label class="field">地区
        <select v-model="form.jurisdiction">
          <option v-for="item in session.jurisdictions" :key="item.code" :value="item.code">{{ item.label }}</option>
        </select>
      </label>
    </template>
  </RuleForm>
</template>

<style scoped>
.org-region {
  width: auto;
  min-width: 104px;
  padding: 4px 8px;
  font-size: 12px;
}
</style>
