<script setup>
import { ref } from "vue";
import { createClause, deleteClause, deleteClauses, fetchClauses, saveClause } from "@/api/rule";
import { useContext } from "@/composables/useContext";
import { runBatch, useBatchNote, usePick } from "@/composables/usePick";
import AsyncView from "@/components/AsyncView.vue";
import RuleForm from "@/components/RuleForm.vue";
import { askConfirm } from "@/utils/confirm";

const { session } = useContext();
const q = ref("");
const form = ref(null);
const error = ref("");
const saving = ref(false);
const view = ref(null);
const pick = usePick();
const batch = useBatchNote();
const load = () => fetchClauses({ jurisdiction: session.jurisdiction, q: q.value });

function lines(value) {
  return String(value || "").split("\n").map((item) => item.trim()).filter(Boolean);
}

function blank() {
  return {
    creating: true,
    id: "",
    jurisdiction: session.jurisdiction || (session.jurisdictions[0] ? session.jurisdictions[0].code : ""),
    doc: "",
    docVersion: "",
    clause: "",
    title: "",
    text: "",
    scope: "",
    effectiveFrom: "",
    source: "",
    refsText: ""
  };
}

function create() {
  error.value = "";
  form.value = blank();
}

function edit(row) {
  error.value = "";
  form.value = {
    ...row,
    effectiveFrom: row.effectiveFrom || "",
    refsText: (row.referencedBy || []).join("\n"),
    creating: false
  };
}

function payload(row) {
  return {
    id: row.id,
    jurisdiction: row.jurisdiction,
    doc: row.doc,
    docVersion: row.docVersion,
    clause: row.clause,
    title: row.title,
    text: row.text,
    scope: row.scope,
    effectiveFrom: row.effectiveFrom || null,
    source: row.source,
    referencedBy: lines(row.refsText)
  };
}

async function refresh() {
  if (view.value) await view.value.reload();
}

async function save() {
  error.value = "";
  saving.value = true;
  try {
    const body = payload(form.value);
    if (form.value.creating) await createClause(body);
    else await saveClause(form.value.id, body);
    form.value = null;
    await refresh();
  } catch (err) {
    error.value = err.message;
  } finally {
    saving.value = false;
  }
}

async function remove() {
  const yes = await askConfirm("删除条款「" + form.value.clause + "」。被专属规则或 EAD 规则引用的条款删不掉。", {
    title: "删除条款",
    confirmText: "删除",
    danger: true
  });
  if (!yes) return;
  error.value = "";
  saving.value = true;
  try {
    await deleteClause(form.value.id);
    form.value = null;
    await refresh();
  } catch (err) {
    error.value = err.message;
  } finally {
    saving.value = false;
  }
}

async function removeSelected(rows) {
  const result = await runBatch(pick, rows, "id", deleteClauses, batch, form, (row) => row.id);
  if (result) await refresh();
}
</script>

<template>
  <p v-if="batch.state.text" class="notice" :class="batch.state.kind">{{ batch.state.text }}</p>
  <div class="inline-fields" style="margin-bottom: 12px">
    <input v-model="q" type="search" placeholder="条款编号、标题或制度" />
    <button type="button" class="btn sm primary" @click="create">新建</button>
  </div>
  <AsyncView ref="view" :key="q" :load="load">
    <template #default="{ data }">
      <div class="panel">
        <div class="panel-head">
          <h3>监管条款</h3>
          <span class="sub">{{ data.length }} 条</span>
          <span class="spacer"></span>
          <button type="button" class="btn sm danger" :disabled="!pick.visibleIds(data).length" @click="removeSelected(data)">删除所选</button>
        </div>
        <div class="panel-body tight">
          <table class="tbl compact">
            <thead>
              <tr>
                <th class="pick" @click.stop><input type="checkbox" :checked="pick.allOn(data)" @change="pick.toggleAll(data)" /></th>
                <th>条款</th><th>标题</th><th>地区</th><th>被引用</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in data" :key="row.id" class="clickable" @click="edit(row)">
                <td class="pick" @click.stop><input type="checkbox" :checked="pick.on(row.id)" @change="pick.toggle(row.id)" /></td>
                <td class="mono">{{ row.clause }}</td>
                <td>{{ row.title }}</td>
                <td>{{ row.jurisdiction }}</td>
                <td>{{ row.referencedBy.length }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </AsyncView>
  <RuleForm
    :open="!!form"
    :title="form ? (form.creating ? '新建条款' : form.clause + ' ' + form.title) : ''"
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
      <label class="field">地区
        <select v-model="form.jurisdiction">
          <option v-for="item in session.jurisdictions" :key="item.code" :value="item.code">{{ item.label }}</option>
        </select>
      </label>
      <label class="field">条款编号
        <input v-model="form.clause" type="text" />
      </label>
      <label class="field">标题
        <input v-model="form.title" type="text" />
      </label>
      <label class="field">制度
        <input v-model="form.doc" type="text" />
      </label>
      <label class="field">制度版本
        <input v-model="form.docVersion" type="text" />
      </label>
      <label class="field">生效日期
        <input v-model="form.effectiveFrom" type="date" />
      </label>
      <label class="field">来源
        <input v-model="form.source" type="text" />
      </label>
      <label class="field full">适用范围
        <input v-model="form.scope" type="text" />
      </label>
      <label class="field full">原文
        <textarea v-model="form.text"></textarea>
      </label>
      <label class="field full">引用规则
        <textarea v-model="form.refsText"></textarea>
        <span class="hint">一行一个规则名。保存时替换这一条条款下的引用。</span>
      </label>
    </template>
  </RuleForm>
</template>
