<script setup>
import { ref } from "vue";
import { createProductRule, deleteProductRule, fetchProductRules, saveProductRule } from "@/api/exposure";
import { fetchProducts } from "@/api/product";
import AsyncView from "@/components/AsyncView.vue";
import RuleForm from "@/components/RuleForm.vue";
import { askConfirm } from "@/utils/confirm";

const code = ref("");
const form = ref(null);
const error = ref("");
const saving = ref(false);
const view = ref(null);
const labels = { draft: "草稿", reviewing: "审核中", published: "已发布", superseded: "已被取代", disabled: "已停用" };

function load() {
  return fetchProducts();
}

function create(products) {
  error.value = "";
  const picked = code.value || (products[0] ? products[0].code : "");
  form.value = {
    creating: true,
    id: "",
    product: picked,
    name: "",
    label: "",
    priority: 0,
    version: "",
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
</script>

<template>
  <AsyncView ref="view" :load="load">
    <template #default="{ data }">
      <div class="section-tabs" style="margin-bottom: 12px">
        <button
          v-for="item in data"
          :key="item.code"
          type="button"
          class="section-tab"
          :class="{ active: (code || data[0].code) === item.code }"
          @click="code = item.code"
        >{{ item.label }}</button>
        <button type="button" class="btn sm primary" @click="create(data)">新建</button>
      </div>
      <AsyncView :key="code || (data[0] && data[0].code)" :load="() => fetchProductRules(code || data[0].code)">
        <template #default="{ data: rules, reload }">
          <div class="panel">
            <div class="panel-head"><h3>专属规则</h3><span class="sub">{{ rules.length }} 条</span></div>
            <div class="panel-body tight">
              <table class="tbl compact">
                <thead><tr><th>顺序</th><th>规则</th><th>条件</th><th>归入</th><th>权重</th></tr></thead>
                <tbody>
                  <tr v-for="row in rules" :key="row.id" class="clickable" @click="edit(row)">
                    <td>{{ row.priority }}</td>
                    <td>{{ row.label }}<div class="mono dim">{{ row.name }}</div></td>
                    <td>{{ row.when }}</td>
                    <td>{{ row.targetClass }}</td>
                    <td>{{ row.weight }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
          <RuleForm
            :open="!!form"
            :title="form && form.creating ? '新建专属规则' : '编辑专属规则'"
            :error="error"
            :saving="saving"
            :creating="!!(form && form.creating)"
            @close="form = null"
            @save="save(reload)"
            @remove="remove(reload)"
          >
            <template v-if="form">
              <label class="field">编号
                <input v-model="form.id" type="text" :disabled="!form.creating" />
              </label>
              <label class="field">产品
                <select v-model="form.product">
                  <option v-for="item in data" :key="item.code" :value="item.code">{{ item.label }}</option>
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
  </AsyncView>
</template>
