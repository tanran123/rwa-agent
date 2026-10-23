<script setup>
import { ref } from "vue";
import { createRuleVersion, deleteRuleVersion, deleteRuleVersions, fetchRuleVersions, saveRuleVersion } from "@/api/rule";
import { useContext } from "@/composables/useContext";
import { runBatch, useBatchNote, usePick } from "@/composables/usePick";
import AsyncView from "@/components/AsyncView.vue";
import RuleForm from "@/components/RuleForm.vue";
import { askConfirm } from "@/utils/confirm";

const { session } = useContext();
const jur = ref("");
const status = ref("");
const q = ref("");
const form = ref(null);
const error = ref("");
const saving = ref(false);
const view = ref(null);
const pick = usePick();
const batch = useBatchNote();
const load = () => fetchRuleVersions(jur.value);
const labels = { draft: "草稿", reviewing: "审核中", published: "已发布", superseded: "已被取代", disabled: "已停用" };
const tones = { draft: "muted", reviewing: "warn", published: "ok", superseded: "muted", disabled: "danger" };

const jurLabel = (code) => (session.jurisdictions.find((item) => item.code === code) || {}).label || code;

function shown(rows) {
  const word = q.value.trim();
  return (rows || []).filter((row) => {
    if (status.value && labels[row.status] !== status.value && row.status !== status.value) return false;
    if (!word) return true;
    return (row.version + row.name).includes(word);
  });
}

function blank() {
  return {
    creating: true,
    id: "",
    jurisdiction: session.jurisdiction || (session.jurisdictions[0] ? session.jurisdictions[0].code : ""),
    version: "",
    name: "",
    ruleType: "",
    effectiveFrom: "",
    effectiveTo: "",
    status: "draft",
    institution: "",
    rulesetFile: "",
    publishedAt: "",
    author: "",
    changelog: ""
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
    effectiveTo: row.effectiveTo || "",
    creating: false
  };
}

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
    if (form.value.creating) await createRuleVersion(body);
    else await saveRuleVersion(form.value.id, body);
    form.value = null;
    await refresh();
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

function openVersion(row) {
  session.versionId = row.id;
  session.jurisdiction = row.jurisdiction;
}
</script>

<template>
  <p v-if="batch.state.text" class="notice" :class="batch.state.kind">{{ batch.state.text }}</p>
  <AsyncView ref="view" :key="jur" :load="load">
    <template #default="{ data }">
      <div class="panel">
        <div class="panel-head">
          <h3>监管规则版本列表</h3>
          <span class="sub">共 {{ data.length }} 个版本</span>
          <span class="spacer"></span>
          <button type="button" class="btn sm danger" :disabled="!pick.visibleIds(shown(data)).length" @click="removeSelected(shown(data))">删除所选</button>
          <button type="button" class="btn sm primary" @click="create">新建</button>
        </div>
        <div class="panel-body">
          <div class="inline-fields" style="margin-bottom: 12px">
            <label class="field">司法管辖区
              <select v-model="jur">
                <option value="">全部地区</option>
                <option v-for="item in session.jurisdictions" :key="item.code" :value="item.code">{{ item.label }}</option>
              </select>
            </label>
            <label class="field">规则状态
              <select v-model="status">
                <option value="">全部状态</option>
                <option v-for="(label, key) in labels" :key="key" :value="label">{{ label }}</option>
              </select>
            </label>
            <label class="field" style="flex: 1">关键字
              <input v-model="q" type="search" placeholder="搜索版本编号或规则名称…" />
            </label>
          </div>
          <table class="tbl compact">
            <thead>
              <tr>
                <th class="pick" @click.stop><input type="checkbox" :checked="pick.allOn(shown(data))" @change="pick.toggleAll(shown(data))" /></th>
                <th>司法管辖区</th><th>版本编号</th><th>规则名称</th><th>规则类型</th><th>生效日期</th><th>适用机构</th><th>状态</th><th>维护人</th><th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in shown(data)" :key="row.id" class="clickable" @click="edit(row)">
                <td class="pick" @click.stop><input type="checkbox" :checked="pick.on(row.id)" @change="pick.toggle(row.id)" /></td>
                <td>{{ jurLabel(row.jurisdiction) }}</td>
                <td class="mono">{{ row.version }}</td>
                <td>{{ row.name }}</td>
                <td>{{ row.ruleType }}</td>
                <td>{{ row.effectiveFrom }}{{ row.effectiveTo ? " 至 " + row.effectiveTo : " 起" }}</td>
                <td>{{ row.institution }}</td>
                <td><span class="tag" :class="tones[row.status]">{{ labels[row.status] || row.status }}</span></td>
                <td>{{ row.author }}</td>
                <td><button type="button" class="btn sm" @click.stop="openVersion(row)">打开</button></td>
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
        <select v-model="form.jurisdiction">
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
        <input v-model="form.institution" type="text" />
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
