<script setup>
import { ref } from "vue";
import {
  createBankGrade, createMoWeight, createWeightRule, deleteBankGrade, deleteMoWeight, deleteWeightRule,
  fetchWeights, saveBankGrade, saveMoWeight, saveWeightRule
} from "@/api/exposure";
import AsyncView from "@/components/AsyncView.vue";
import RuleForm from "@/components/RuleForm.vue";
import { askConfirm } from "@/utils/confirm";

const klass = ref("");
const form = ref(null);
const error = ref("");
const saving = ref(false);
const view = ref(null);
const titles = { rule: "权重规则", grade: "第一档银行评级", mo: "澳门评级档" };

function lines(value) {
  return String(value || "").split("\n").map((item) => item.trim()).filter(Boolean);
}

function create(kind) {
  error.value = "";
  if (kind === "rule") {
    form.value = { kind, creating: true, id: "", cls: "", cond: "", rw: "", pri: 0, bank: "", basis: "" };
  } else if (kind === "grade") {
    form.value = { kind, creating: true, id: "", label: "", pri: 0, basis: "", weightsText: "", idsText: "", paramId: "" };
  } else {
    form.value = { kind, creating: true, id: "", bucket: "", weightsText: "", note: "" };
  }
}

function editRule(row) {
  error.value = "";
  form.value = { kind: "rule", creating: false, ...row };
}

function editGrade(row) {
  error.value = "";
  form.value = {
    kind: "grade",
    creating: false,
    id: row.id,
    label: row.label,
    pri: row.pri,
    basis: row.basis,
    weightsText: (row.weights || []).join("\n"),
    idsText: (row.ids || []).join("\n"),
    paramId: row.paramId || ""
  };
}

function editMo(row) {
  error.value = "";
  form.value = {
    kind: "mo",
    creating: false,
    id: row.id,
    bucket: row.bucket,
    weightsText: (row.weights || []).join("\n"),
    note: row.note || ""
  };
}

async function refresh() {
  if (view.value) await view.value.reload();
}

async function save() {
  error.value = "";
  saving.value = true;
  try {
    const row = form.value;
    if (row.kind === "rule") {
      const body = { id: row.id, cls: row.cls, cond: row.cond, rw: row.rw, pri: Number(row.pri), bank: row.bank, basis: row.basis };
      if (row.creating) await createWeightRule(body);
      else await saveWeightRule(row.id, body);
    } else if (row.kind === "grade") {
      const body = {
        id: row.id,
        label: row.label,
        pri: Number(row.pri),
        basis: row.basis,
        weights: lines(row.weightsText),
        ids: lines(row.idsText),
        paramId: row.paramId
      };
      if (row.creating) await createBankGrade(body);
      else await saveBankGrade(row.id, body);
    } else {
      const body = { id: row.id, bucket: row.bucket, weights: lines(row.weightsText), note: row.note };
      if (row.creating) await createMoWeight(body);
      else await saveMoWeight(row.id, body);
    }
    form.value = null;
    await refresh();
  } catch (err) {
    error.value = err.message;
  } finally {
    saving.value = false;
  }
}

async function remove() {
  const yes = await askConfirm("删除这条" + (titles[form.value.kind] || "") + "。被银行评级档引用的权重规则删不掉。", {
    title: "删除",
    confirmText: "删除",
    danger: true
  });
  if (!yes) return;
  error.value = "";
  saving.value = true;
  try {
    if (form.value.kind === "rule") await deleteWeightRule(form.value.id);
    else if (form.value.kind === "grade") await deleteBankGrade(form.value.id);
    else await deleteMoWeight(form.value.id);
    form.value = null;
    await refresh();
  } catch (err) {
    error.value = err.message;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <AsyncView ref="view" :load="fetchWeights">
    <template #default="{ data }">
      <div class="inline-fields" style="margin-bottom: 12px">
        <select v-model="klass">
          <option value="">全部大类</option>
          <option v-for="name in [...new Set(data.rules.map((row) => row.cls))]" :key="name" :value="name">{{ name }}</option>
        </select>
      </div>
      <div class="panel" style="margin-bottom: 12px">
        <div class="panel-head">
          <h3>权重规则</h3>
          <span class="spacer"></span>
          <button type="button" class="btn sm primary" @click="create('rule')">新建</button>
        </div>
        <div class="panel-body tight">
          <table class="tbl compact">
            <thead><tr><th>大类</th><th>条件</th><th>权重</th><th>档</th><th>依据</th></tr></thead>
            <tbody>
              <tr v-for="row in data.rules.filter((item) => !klass || item.cls === klass)" :key="row.id" class="clickable" @click="editRule(row)">
                <td>{{ row.cls }}</td>
                <td>{{ row.cond }}</td>
                <td class="strong">{{ row.rw }}</td>
                <td>{{ row.bank }}</td>
                <td class="dim">{{ row.basis }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <div class="grid c2">
        <div class="panel">
          <div class="panel-head">
            <h3>第一档银行评级</h3>
            <span class="spacer"></span>
            <button type="button" class="btn sm primary" @click="create('grade')">新建</button>
          </div>
          <div class="panel-body tight">
            <table class="tbl compact">
              <thead><tr><th>情形</th><th>A+</th><th>A</th><th>B</th><th>C</th></tr></thead>
              <tbody>
                <tr v-for="row in data.grades" :key="row.id" class="clickable" @click="editGrade(row)">
                  <td>{{ row.label }}</td>
                  <td v-for="(weight, index) in row.weights" :key="index">{{ weight }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <div class="panel">
          <div class="panel-head">
            <h3>澳门评级档</h3>
            <span class="spacer"></span>
            <button type="button" class="btn sm primary" @click="create('mo')">新建</button>
          </div>
          <div class="panel-body tight">
            <table class="tbl compact">
              <thead><tr><th>类别</th><th>权重</th></tr></thead>
              <tbody>
                <tr v-for="row in data.mo" :key="row.id" class="clickable" @click="editMo(row)">
                  <td>{{ row.bucket }}</td>
                  <td>{{ row.weights.join(" / ") }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </template>
  </AsyncView>
  <RuleForm
    :open="!!form"
    :title="form ? ((form.creating ? '新建' : '编辑') + titles[form.kind]) : ''"
    :error="error"
    :saving="saving"
    :creating="!!(form && form.creating)"
    @close="form = null"
    @save="save"
    @remove="remove"
  >
    <template v-if="form && form.kind === 'rule'">
      <label class="field">编号
        <input v-model="form.id" type="text" :disabled="!form.creating" />
      </label>
      <label class="field">优先级
        <input v-model="form.pri" type="number" />
      </label>
      <label class="field">大类
        <input v-model="form.cls" type="text" />
      </label>
      <label class="field">档
        <input v-model="form.bank" type="text" />
      </label>
      <label class="field">权重
        <input v-model="form.rw" type="text" />
      </label>
      <label class="field full">条件
        <input v-model="form.cond" type="text" />
      </label>
      <label class="field full">依据
        <input v-model="form.basis" type="text" />
      </label>
    </template>
    <template v-else-if="form && form.kind === 'grade'">
      <label class="field">编号
        <input v-model="form.id" type="text" :disabled="!form.creating" />
      </label>
      <label class="field">优先级
        <input v-model="form.pri" type="number" />
      </label>
      <label class="field">情形
        <input v-model="form.label" type="text" />
      </label>
      <label class="field">参数
        <input v-model="form.paramId" type="text" />
      </label>
      <label class="field full">依据
        <input v-model="form.basis" type="text" />
      </label>
      <label class="field full">权重
        <textarea v-model="form.weightsText"></textarea>
        <span class="hint">一行一个，顺序对应评级列。</span>
      </label>
      <label class="field full">规则编号
        <textarea v-model="form.idsText"></textarea>
        <span class="hint">一行一个权重规则编号。</span>
      </label>
    </template>
    <template v-else-if="form">
      <label class="field">编号
        <input v-model="form.id" type="text" :disabled="!form.creating" />
      </label>
      <label class="field">类别
        <input v-model="form.bucket" type="text" />
      </label>
      <label class="field full">权重
        <textarea v-model="form.weightsText"></textarea>
        <span class="hint">一行一个。</span>
      </label>
      <label class="field full">说明
        <textarea v-model="form.note"></textarea>
      </label>
    </template>
  </RuleForm>
</template>
