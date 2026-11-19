<script setup>
import { ref, watch } from "vue";
import { createClause, deleteClause, deleteClauses, fetchClauseImpact, fetchClauses, saveClause, saveClauseRelations } from "@/api/rule";
import { useContext } from "@/composables/useContext";
import { runBatch, useBatchNote, usePick } from "@/composables/usePick";
import AsyncView from "@/components/AsyncView.vue";
import RuleForm from "@/components/RuleForm.vue";
import { fillForm, finishSave, useAgentForm } from "@/composables/useAgentForm";
import { askConfirm } from "@/utils/confirm";

const { session, scopeVersion } = useContext();
const q = ref("");
const form = ref(null);
const error = ref("");
const saving = ref(false);
const view = ref(null);
const pick = usePick();
const batch = useBatchNote();
const impact = ref(null);
const load = () => fetchClauses({ jurisdiction: session.jurisdiction, q: q.value, version: scopeVersion.value });
watch(scopeVersion, () => { if (view.value) view.value.reload(); });

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
    refsText: "",
    relationsText: "",
    revision: 0
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
    relationsText: (row.relations || []).map((item) => item.rule_node_id + "|" + item.relation_type).join("\n"),
    creating: false
  };
  impact.value = null;
  fetchClauseImpact(row.id).then((data) => { impact.value = data; }).catch(() => { impact.value = null; });
}

function parseRelations(text) {
  return lines(text).map((line) => {
    const [node, type] = line.split("|").map((item) => item.trim());
    return { rule_node_id: node, relation_type: type || "REFERENCE" };
  }).filter((item) => item.rule_node_id);
}

useAgentForm(() => ({
  forms: [{
    id: "clause",
    title: "监管条款",
    fields: [
      { key: "id", label: "编号" },
      { key: "jurisdiction", label: "地区", options: session.jurisdictions.map((item) => item.code) },
      { key: "clause", label: "条款编号" },
      { key: "title", label: "标题" },
      { key: "doc", label: "制度" },
      { key: "docVersion", label: "制度版本" },
      { key: "effectiveFrom", label: "生效日期" },
      { key: "source", label: "来源" },
      { key: "scope", label: "适用范围" },
      { key: "text", label: "原文" },
      { key: "refsText", label: "引用规则" }
    ],
    apply(values) {
      error.value = "";
      form.value = fillForm(blank(), values);
    },
    save: finishSave(() => save(), error)
  }]
}));

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
    referencedBy: lines(row.refsText),
    baseRevision: row.revision
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
    const saved = form.value.creating ? await createClause(body) : await saveClause(form.value.id, body);
    if (form.value.relationsText != null) {
      await saveClauseRelations(saved.id, parseRelations(form.value.relationsText));
    }
    form.value = null;
    impact.value = null;
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
    <input v-model="q" type="search" placeholder="条款编号、标题、制度或制度版本" />
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
                <th>条款</th><th>标题</th><th>制度版本</th><th>地区</th><th>被引用</th><th>结构化引用</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in data" :key="row.id" class="clickable" @click="edit(row)">
                <td class="pick" @click.stop><input type="checkbox" :checked="pick.on(row.id)" @change="pick.toggle(row.id)" /></td>
                <td class="mono">{{ row.clause }}</td>
                <td>{{ row.title }}</td>
                <td>{{ row.docVersion }}</td>
                <td>{{ row.jurisdiction }}</td>
                <td>{{ row.referencedBy.length }}</td>
                <td>{{ (row.relations || []).length }}</td>
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
      <label class="field full">结构化规则节点引用
        <textarea v-model="form.relationsText"></textarea>
        <span class="hint">一行一个「规则节点编码 | 引用类型」，例如 LOAN_CORP | REFERENCE。</span>
      </label>
      <div v-if="impact" class="field full">
        <label>影响分析</label>
        <div class="small">
          结构化引用 {{ impact.relations.length }} 条，文本引用 {{ impact.referencedBy.length }} 条，
          EAD 规则 {{ impact.eadRules.length }} 条，产品专属规则 {{ impact.productRules.length }} 条。
        </div>
        <div v-if="impact.eadRules.length || impact.productRules.length" class="mono small" style="margin-top: 4px">
          {{ impact.eadRules.map((item) => item.id).concat(impact.productRules.map((item) => item.id)).join("、") }}
        </div>
      </div>
    </template>
  </RuleForm>
</template>
