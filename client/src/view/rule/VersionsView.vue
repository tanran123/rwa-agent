<script setup>
import { ref } from "vue";
import { useRouter } from "vue-router";
import { createRuleVersion, deleteRuleVersion, deleteRuleVersions, fetchRuleVersions, saveRuleVersion } from "@/api/rule";
import { useContext } from "@/composables/useContext";
import { runBatch, useBatchNote, usePick } from "@/composables/usePick";
import AsyncView from "@/components/AsyncView.vue";
import RuleForm from "@/components/RuleForm.vue";
import { fillForm, finishSave, useAgentForm } from "@/composables/useAgentForm";
import { askConfirm } from "@/utils/confirm";

const { session } = useContext();
const router = useRouter();
const status = ref("");
const q = ref("");
const form = ref(null);
const error = ref("");
const saving = ref(false);
const busyRow = ref("");
const view = ref(null);
const pick = usePick();
const batch = useBatchNote();
const load = () => fetchRuleVersions();
const labels = { draft: "草稿", published: "已发布", superseded: "已被取代", disabled: "已停用" };
const tones = { draft: "muted", published: "ok", superseded: "muted", disabled: "danger" };

function shown(rows) {
  return rows || [];
}

function jurisdictionLabel(code) {
  return (session.jurisdictions.find((item) => item.code === code) || {}).label || code || "—";
}

function institutionOf(code) {
  const current = session.orgs.find((item) => item.id === session.orgId && item.jurisdiction === code);
  if (current) return current.name;
  const first = session.orgs.find((item) => item.jurisdiction === code);
  return first ? first.name : "";
}

function institutionOptions() {
  if (!form.value) return [];
  const names = session.orgs
    .filter((item) => item.jurisdiction === form.value.jurisdiction)
    .map((item) => item.name);
  if (form.value.institution && names.indexOf(form.value.institution) < 0) names.unshift(form.value.institution);
  return names;
}

function alignInstitution() {
  if (!form.value) return;
  const names = session.orgs
    .filter((item) => item.jurisdiction === form.value.jurisdiction)
    .map((item) => item.name);
  if (names.length && names.indexOf(form.value.institution) < 0) form.value.institution = names[0];
}

function blank() {
  const jurisdiction = session.jurisdiction || "HK";
  return {
    creating: true,
    id: "",
    jurisdiction,
    version: "",
    name: "",
    ruleType: "",
    effectiveFrom: "",
    effectiveTo: "",
    status: "draft",
    institution: institutionOf(jurisdiction),
    rulesetFile: "",
    publishedAt: "",
    author: "",
    changelog: ""
  };
}

function create() {
  error.value = "";
  form.value = null;
  router.push({ name: "version-new-workbench" });
}

useAgentForm(() => ({
  forms: [{
    id: "version",
    title: "监管规则配置",
    fields: [
      { key: "id", label: "编号" },
      { key: "jurisdiction", label: "地区", options: session.jurisdictions.map((item) => item.code) },
      { key: "version", label: "版本编号" },
      { key: "name", label: "规则名称" },
      { key: "ruleType", label: "规则类型" },
      { key: "status", label: "状态", options: Object.keys(labels) },
      { key: "effectiveFrom", label: "生效日期" },
      { key: "effectiveTo", label: "失效日期" },
      { key: "institution", label: "适用机构", options: session.orgs.filter((item) => item.jurisdiction === session.jurisdiction).map((item) => item.name) },
      { key: "rulesetFile", label: "规则文件" },
      { key: "publishedAt", label: "发布时间" },
      { key: "author", label: "维护人" },
      { key: "changelog", label: "变更说明" }
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
    version: row.version,
    name: row.name,
    ruleType: row.ruleType,
    effectiveFrom: row.effectiveFrom || null,
    effectiveTo: row.effectiveTo || null,
    status: row.status,
    institution: row.institution,
    rulesetFile: row.rulesetFile,
    publishedAt: row.publishedAt,
    author: row.author,
    changelog: row.changelog
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
    const saved = form.value.creating
      ? await createRuleVersion(body)
      : await saveRuleVersion(form.value.id, body);
    form.value = null;
    await refresh();
    if (saved && saved.id) openWorkbench(saved);
  } catch (err) {
    error.value = err.message;
  } finally {
    saving.value = false;
  }
}

async function remove() {
  const yes = await askConfirm("删除版本「" + form.value.version + "」。被产品、EAD、专属规则或计量批次引用的版本删不掉。", {
    title: "删除版本",
    confirmText: "删除",
    danger: true
  });
  if (!yes) return;
  error.value = "";
  saving.value = true;
  try {
    await deleteRuleVersion(form.value.id);
    form.value = null;
    await refresh();
  } catch (err) {
    error.value = err.message;
  } finally {
    saving.value = false;
  }
}

async function removeSelected(rows) {
  const result = await runBatch(pick, rows, "id", deleteRuleVersions, batch, form, (row) => row.id);
  if (result) await refresh();
}

function openWorkbench(row) {
  if (!row) return;
  session.versionId = row.id;
  session.jurisdiction = row.jurisdiction;
  router.push({ name: "version-workbench", params: { id: row.id } });
}

async function toggleStatus(row) {
  if (busyRow.value) return;
  const disabling = row.status !== "disabled";
  const yes = await askConfirm(
    disabling
      ? "停用「" + row.version + "」后，这一版不能再用于新建任务；已创建的任务仍按原发布快照复现。"
      : "启用「" + row.version + "」后恢复为草稿，可继续编辑，校验通过后再发布。",
    { title: disabling ? "停用版本" : "启用版本", confirmText: disabling ? "停用" : "启用", danger: disabling }
  );
  if (!yes) return;
  error.value = "";
  busyRow.value = row.id;
  try {
    await saveRuleVersion(row.id, { ...payload(row), status: disabling ? "disabled" : "draft" });
    await refresh();
  } catch (err) {
    error.value = err.message;
  } finally {
    busyRow.value = "";
  }
}

async function removeRow(row) {
  if (busyRow.value) return;
  const yes = await askConfirm("删除版本「" + row.version + "」。被规则文档、EAD、专属规则、快照、任务或计量批次引用的版本删不掉。", {
    title: "删除版本",
    confirmText: "删除",
    danger: true
  });
  if (!yes) return;
  error.value = "";
  busyRow.value = row.id;
  try {
    await deleteRuleVersion(row.id);
    await refresh();
  } catch (err) {
    error.value = err.message;
  } finally {
    busyRow.value = "";
  }
}
</script>

<template>
  <p v-if="error" class="notice danger">{{ error }}</p>
  <p v-if="batch.state.text" class="notice" :class="batch.state.kind">{{ batch.state.text }}</p>
  <AsyncView ref="view" :load="load">
    <template #default="{ data }">
      <div class="panel">
        <div class="panel-head">
          <h3>监管规则配置管理</h3>
          <span class="sub">全部监管辖区 · 监管规则版本</span>
          <span class="spacer"></span>
          <button type="button" class="btn sm primary" @click="create">新建</button>
        </div>
        <div class="panel-body">
          <table class="tbl compact">
            <thead>
              <tr>
                <th>地区</th><th>版本编号</th><th>规则名称</th><th>生效日期</th><th>适用机构</th><th>状态</th><th>配置状态</th><th>维护人</th><th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in shown(data)" :key="row.id" class="clickable" @click="openWorkbench(row)">
                <td>{{ jurisdictionLabel(row.jurisdiction) }}</td>
                <td class="mono">{{ row.version }}</td>
                <td>{{ row.name }}</td>
                <td>{{ row.effectiveFrom }}{{ row.effectiveTo ? " 至 " + row.effectiveTo : " 起" }}</td>
                <td>{{ row.institution }}</td>
                <td><span class="tag" :class="tones[row.status]">{{ labels[row.status] || row.status }}</span></td>
                <td class="small">{{ row.configStatus || "—" }}</td>
                <td>{{ row.author }}</td>
                <td>
                  <div class="btn-group">
                    <button type="button" class="btn sm primary" @click.stop="openWorkbench(row)">维护</button>
                    <button type="button" class="btn sm" :disabled="busyRow === row.id" @click.stop="toggleStatus(row)">{{ row.status === "disabled" ? "启用" : "停用" }}</button>
                    <button type="button" class="btn sm danger" :disabled="busyRow === row.id" @click.stop="removeRow(row)">删除</button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </AsyncView>
  <RuleForm
    :open="!!form"
    :title="form && form.creating ? '新建版本' : '编辑版本'"
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
        <select v-model="form.jurisdiction" @change="alignInstitution">
          <option v-for="item in session.jurisdictions" :key="item.code" :value="item.code">{{ item.label }}</option>
        </select>
      </label>
      <label class="field">版本编号
        <input v-model="form.version" type="text" />
      </label>
      <label class="field">规则名称
        <input v-model="form.name" type="text" />
      </label>
      <label class="field">规则类型
        <input v-model="form.ruleType" type="text" />
      </label>
      <label class="field">状态
        <select v-model="form.status">
          <option v-for="(label, key) in labels" :key="key" :value="key">{{ label }}</option>
        </select>
      </label>
      <label class="field">生效日期
        <input v-model="form.effectiveFrom" type="date" />
      </label>
      <label class="field">失效日期
        <input v-model="form.effectiveTo" type="date" />
      </label>
      <label class="field">适用机构
        <select v-model="form.institution">
          <option v-for="name in institutionOptions()" :key="name" :value="name">{{ name }}</option>
        </select>
        <span class="hint">与左上角机构同一份名单。没有要选的，先到「机构」里添加。</span>
      </label>
      <label class="field">规则文件
        <input v-model="form.rulesetFile" type="text" />
      </label>
      <label class="field">发布时间
        <input v-model="form.publishedAt" type="text" />
      </label>
      <label class="field">维护人
        <input v-model="form.author" type="text" />
      </label>
      <label class="field full">变更说明
        <textarea v-model="form.changelog"></textarea>
      </label>
    </template>
  </RuleForm>
</template>
