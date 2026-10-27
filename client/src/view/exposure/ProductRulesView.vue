<script setup>
import { ref } from "vue";
import { createProductRule, deleteProductRule, deleteProductRules, fetchProductRules, saveProductRule } from "@/api/exposure";
import { useContext } from "@/composables/useContext";
import { runBatch, useBatchNote, usePick } from "@/composables/usePick";
import { fetchProducts } from "@/api/product";
import AsyncView from "@/components/AsyncView.vue";
import RuleForm from "@/components/RuleForm.vue";
import { fillForm, finishSave, useAgentForm } from "@/composables/useAgentForm";
import { askConfirm } from "@/utils/confirm";

const { scopeVersion } = useContext();
const code = ref("");
const form = ref(null);
const error = ref("");
const saving = ref(false);
const view = ref(null);
const pick = usePick();
const batch = useBatchNote();
const listed = ref([]);
const load = async () => {
  const [products, rules] = await Promise.all([fetchProducts(), fetchProductRules()]);
  const version = scopeVersion.value;
  const scoped = products.filter((item) => item.ruleVersion === version);
  listed.value = scoped;
  return [
    scoped,
    rules.filter((item) => item.version === version)
  ];
};
const labels = { draft: "草稿", reviewing: "审核中", published: "已发布", superseded: "已被取代", disabled: "已停用" };

function rulesOf(rows) {
  return (rows || []).filter((item) => !code.value || item.product === code.value);
}
function countFor(rows, product) {
  return (rows || []).filter((item) => item.product === product).length;
}

function create(products) {
  error.value = "";
  form.value = {
    creating: true,
    id: "",
    product: code.value || (products[0] ? products[0].code : ""),
    name: "",
    label: "",
    priority: 0,
    version: scopeVersion.value,
    when: "",
    targetClass: "",
    targetSub: "",
    weight: "",
    clause: "",
    status: "draft"
  };
}

function edit(row) {
  error.value = "";
  form.value = { ...row, creating: false };
}

useAgentForm(() => ({
  forms: [{
    id: "product-rule",
    title: "产品专属规则",
    fields: [
      { key: "id", label: "编号" },
      { key: "product", label: "产品", options: listed.value.map((item) => item.code) },
      { key: "name", label: "规则编码" },
      { key: "label", label: "规则" },
      { key: "priority", label: "顺序" },
      { key: "status", label: "状态", options: Object.keys(labels) },
      { key: "version", label: "规则版本" },
      { key: "clause", label: "条款" },
      { key: "targetClass", label: "暴露大类" },
      { key: "targetSub", label: "子类" },
      { key: "weight", label: "权重" },
      { key: "when", label: "条件" }
    ],
    apply(values) {
      error.value = "";
      form.value = fillForm({
        creating: true,
        id: "",
        product: code.value || (listed.value[0] ? listed.value[0].code : ""),
        name: "",
        label: "",
        priority: 0,
        version: scopeVersion.value,
        when: "",
        targetClass: "",
        targetSub: "",
        weight: "",
        clause: "",
        status: "draft"
      }, values);
    },
    save: finishSave(() => save(), error)
  }]
}));

function payload(row) {
  return {
    id: row.id,
    product: row.product,
    name: row.name,
    label: row.label,
    priority: Number(row.priority),
    version: row.version,
    when: row.when,
    targetClass: row.targetClass,
    targetSub: row.targetSub,
    weight: row.weight,
    clause: row.clause,
    status: row.status
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
    if (form.value.creating) await createProductRule(body);
    else await saveProductRule(form.value.id, body);
    code.value = body.product;
    form.value = null;
    await refresh();
  } catch (err) {
    error.value = err.message;
  } finally {
    saving.value = false;
  }
}

async function remove() {
  const yes = await askConfirm("删除专属规则「" + form.value.label + "」。", {
    title: "删除专属规则",
    confirmText: "删除",
    danger: true
  });
  if (!yes) return;
  error.value = "";
  saving.value = true;
  try {
    await deleteProductRule(form.value.id);
    form.value = null;
    await refresh();
  } catch (err) {
    error.value = err.message;
  } finally {
    saving.value = false;
  }
}

async function removeSelected(rows) {
  const result = await runBatch(pick, rows, "id", deleteProductRules, batch, form, (row) => row.id);
  if (result) await refresh();
}
</script>

<template>
  <p v-if="batch.state.text" class="notice" :class="batch.state.kind">{{ batch.state.text }}</p>
  <AsyncView ref="view" :load="load">
    <template #default="{ data }">
      <div class="panel">
        <div class="panel-head">
          <h3>产品专属规则向导</h3>
          <span class="sub">选择产品 → 看它挂上的通用规则分支</span>
          <span class="spacer"></span>
          <button type="button" class="btn sm primary" @click="create(data[0])">新建</button>
        </div>
        <div class="panel-body">
          <div class="steps">
            <div class="step" :class="{ active: !code }"><span class="sn">1</span>选择产品</div>
            <span class="step-arrow">›</span>
            <div class="step" :class="{ active: !!code, done: !!code }"><span class="sn">2</span>通用规则分支</div>
          </div>
          <p class="dim" style="font-size: 12px">选择要查看的产品。同一产品的专属规则挂在通用分类下面。点一行可以改。</p>
          <div class="grid c3">
            <button
              v-for="item in data[0]"
              :key="item.code"
              type="button"
              class="wiz-pick"
              :class="{ on: code === item.code }"
              @click="code = item.code"
            >
              <strong>{{ item.label }}</strong>
              <span class="dim">{{ countFor(data[1], item.code) }} 条专属规则 · {{ item.fieldCount }} 个标准字段</span>
            </button>
          </div>
        </div>
      </div>
      <div v-if="code" class="panel">
        <div class="panel-head">
          <h3>{{ (data[0].find((item) => item.code === code) || {}).label }}</h3>
          <span class="sub">{{ countFor(data[1], code) }} 条</span>
          <span class="spacer"></span>
          <button type="button" class="btn sm danger" :disabled="!pick.visibleIds(rulesOf(data[1])).length" @click="removeSelected(rulesOf(data[1]))">删除所选</button>
        </div>
        <div class="panel-body tight">
          <table class="tbl compact">
            <thead>
              <tr>
                <th class="pick" @click.stop><input type="checkbox" :checked="pick.allOn(rulesOf(data[1]))" @change="pick.toggleAll(rulesOf(data[1]))" /></th>
                <th>顺序</th><th>规则</th><th>条件</th><th>归入</th><th>权重</th><th>条款</th><th>状态</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in rulesOf(data[1])" :key="row.id" class="clickable" @click="edit(row)">
                <td class="pick" @click.stop><input type="checkbox" :checked="pick.on(row.id)" @change="pick.toggle(row.id)" /></td>
                <td>{{ row.priority }}</td>
                <td>{{ row.label }}<div class="mono dim">{{ row.name }}</div></td>
                <td>{{ row.when }}</td>
                <td>{{ row.targetClass }} · {{ row.targetSub }}</td>
                <td>{{ row.weight }}</td>
                <td class="mono">{{ row.clause }}</td>
                <td>{{ labels[row.status] || row.status }}</td>
              </tr>
            </tbody>
          </table>
          <p v-if="!countFor(data[1], code)" class="dim" style="padding: 14px">这个产品还没有专属规则，计量时直接用通用暴露分类。</p>
        </div>
      </div>
      <RuleForm
        :open="!!form"
        :title="form && form.creating ? '新建专属规则' : '编辑专属规则'"
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
          <label class="field">产品
            <select v-model="form.product">
              <option v-for="item in data[0]" :key="item.code" :value="item.code">{{ item.label }}</option>
            </select>
          </label>
          <label class="field">规则编码
            <input v-model="form.name" type="text" />
          </label>
          <label class="field">规则
            <input v-model="form.label" type="text" />
          </label>
          <label class="field">顺序
            <input v-model="form.priority" type="number" />
          </label>
          <label class="field">状态
            <select v-model="form.status">
              <option v-for="(label, key) in labels" :key="key" :value="key">{{ label }}</option>
            </select>
          </label>
          <label class="field">规则版本
            <input v-model="form.version" type="text" />
          </label>
          <label class="field">条款
            <input v-model="form.clause" type="text" />
          </label>
          <label class="field">暴露大类
            <input v-model="form.targetClass" type="text" />
          </label>
          <label class="field">子类
            <input v-model="form.targetSub" type="text" />
          </label>
          <label class="field">权重
            <input v-model="form.weight" type="text" />
          </label>
          <label class="field full">条件
            <textarea v-model="form.when"></textarea>
          </label>
        </template>
      </RuleForm>
    </template>
  </AsyncView>
</template>
