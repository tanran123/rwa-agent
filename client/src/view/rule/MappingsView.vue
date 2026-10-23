<script setup>
import { ref } from "vue";
import {
  createFieldMapping, deleteFieldMapping, fetchFieldMappings, fetchProducts, saveFieldMapping
} from "@/api/product";
import AsyncView from "@/components/AsyncView.vue";
import RuleForm from "@/components/RuleForm.vue";
import { askConfirm } from "@/utils/confirm";

const form = ref(null);
const error = ref("");
const saving = ref(false);
const view = ref(null);
const load = () => Promise.all([fetchProducts(), fetchFieldMappings()]);
const statusClass = { ok: "ok", warn: "warn", missing: "danger" };

function blank(products) {
  return {
    creating: true,
    id: null,
    product: products[0] ? products[0].code : "",
    stdField: "",
    stdCode: "",
    srcSystem: "",
    srcField: "",
    via: "",
    status: "ok",
    hitRate: 0,
    sample: ""
  };
}

function create(products) {
  error.value = "";
  form.value = blank(products);
}

function edit(row) {
  error.value = "";
  form.value = { ...row, creating: false };
}

function payload(row) {
  return {
    product: row.product,
    stdField: row.stdField,
    stdCode: row.stdCode,
    srcSystem: row.srcSystem,
    srcField: row.srcField,
    via: row.via,
    status: row.status,
    hitRate: Number(row.hitRate),
    sample: row.sample
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
    if (form.value.creating) await createFieldMapping(body);
    else await saveFieldMapping(form.value.id, body);
    form.value = null;
    await refresh();
  } catch (err) {
    error.value = err.message;
  } finally {
    saving.value = false;
  }
}

async function remove() {
  const yes = await askConfirm("删除映射「" + form.value.stdField + "」。", {
    title: "删除映射",
    confirmText: "删除",
    danger: true
  });
  if (!yes) return;
  error.value = "";
  saving.value = true;
  try {
    await deleteFieldMapping(form.value.id);
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
      <div class="panel">
        <div class="panel-head">
          <h3>源字段映射</h3>
          <span class="sub">{{ data[1].length }} 条</span>
          <span class="spacer"></span>
          <button type="button" class="btn sm primary" @click="create(data[0])">新建</button>
        </div>
        <div class="panel-body tight">
          <table class="tbl compact">
            <thead><tr><th>产品</th><th>标准字段</th><th>源系统</th><th>源字段</th><th>转换</th><th>状态</th></tr></thead>
            <tbody>
              <tr v-for="row in data[1]" :key="row.id" class="clickable" @click="edit(row)">
                <td>{{ row.product }}</td>
                <td>{{ row.stdField }}<div class="mono dim">{{ row.stdCode }}</div></td>
                <td>{{ row.srcSystem }}</td>
                <td>{{ row.srcField }}</td>
                <td>{{ row.via }}</td>
                <td><span class="tag" :class="statusClass[row.status] || 'muted'">{{ row.status }}</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <RuleForm
        :open="!!form"
        :title="form && form.creating ? '新建映射' : '编辑映射'"
        :error="error"
        :saving="saving"
        :creating="!!(form && form.creating)"
        @close="form = null"
        @save="save"
        @remove="remove"
      >
        <template v-if="form">
          <label class="field">产品
            <select v-model="form.product">
              <option v-for="item in data[0]" :key="item.code" :value="item.code">{{ item.label }}</option>
            </select>
          </label>
          <label class="field">状态
            <select v-model="form.status">
              <option value="ok">ok</option>
              <option value="warn">warn</option>
              <option value="missing">missing</option>
            </select>
          </label>
          <label class="field">标准字段
            <input v-model="form.stdField" type="text" />
          </label>
          <label class="field">标准编码
            <input v-model="form.stdCode" type="text" />
          </label>
          <label class="field">源系统
            <input v-model="form.srcSystem" type="text" />
          </label>
          <label class="field">源字段
            <input v-model="form.srcField" type="text" />
          </label>
          <label class="field">命中率
            <input v-model="form.hitRate" type="number" step="0.0001" />
          </label>
          <label class="field full">转换
            <input v-model="form.via" type="text" />
          </label>
          <label class="field full">样例
            <input v-model="form.sample" type="text" />
          </label>
        </template>
      </RuleForm>
    </template>
  </AsyncView>
</template>
