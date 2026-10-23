<script setup>
import { computed, ref, watch } from "vue";
import {
  createProduct, createProductField, deleteProduct, deleteProductField, deleteProductFields, deleteProducts,
  fetchProductFields, fetchProducts, saveProduct, saveProductField
} from "@/api/product";
import { useContext } from "@/composables/useContext";
import { runBatch, useBatchNote, usePick } from "@/composables/usePick";
import AsyncView from "@/components/AsyncView.vue";
import RuleForm from "@/components/RuleForm.vue";
import { askConfirm } from "@/utils/confirm";

const { session } = useContext();
const code = ref("");
const productForm = ref(null);
const fieldForm = ref(null);
const error = ref("");
const saving = ref(false);
const productsView = ref(null);
const fieldsView = ref(null);
const productPick = usePick();
const fieldPick = usePick();
const batch = useBatchNote();

watch(code, () => fieldPick.clear());

const loadProducts = async () => {
  const rows = await fetchProducts();
  if (!rows.some((item) => item.code === code.value)) code.value = rows[0] ? rows[0].code : "";
  return rows;
};
const loadFields = () => code.value ? fetchProductFields(code.value) : Promise.resolve([]);
const current = (rows) => (rows || []).find((item) => item.code === code.value) || {};

const versionOptions = computed(() => {
  const values = (session.versions || []).map((item) => item.version);
  const currentVersion = productForm.value && productForm.value.ruleVersion;
  if (currentVersion && values.indexOf(currentVersion) < 0) values.unshift(currentVersion);
  return values;
});

function lines(value) {
  return String(value || "").split("\n").map((item) => item.trim()).filter(Boolean);
}

function defaultVersion() {
  const picked = (session.versions || []).find((item) => item.id === session.versionId);
  if (picked) return picked.version;
  return session.versions[0] ? session.versions[0].version : "";
}

function blankProduct() {
  return {
    creating: true,
    code: "",
    label: "",
    icon: "",
    color: "",
    desc: "",
    ruleVersion: defaultVersion(),
    onboarding: "column",
    sampleCount: 0,
    system: ""
  };
}

function editProduct(row) {
  error.value = "";
  fieldForm.value = null;
  productForm.value = { ...row, creating: false };
}

function blankField() {
  return {
    creating: true,
    code: "",
    name: "",
    meaning: "",
    type: "number",
    unit: "",
    required: false,
    sourceSystem: "",
    sourceField: "",
    transform: "",
    validate: "",
    stdField: "",
    optionsText: "",
    refsText: ""
  };
}

function editField(row) {
  error.value = "";
  productForm.value = null;
  fieldForm.value = {
    ...row,
    stdField: row.stdField || "",
    optionsText: (row.options || []).join("\n"),
    refsText: (row.referencedBy || []).join("\n"),
    creating: false
  };
}

function productPayload(row) {
  return {
    code: row.code,
    label: row.label,
    icon: row.icon,
    color: row.color,
    desc: row.desc,
    ruleVersion: row.ruleVersion,
    onboarding: row.onboarding,
    sampleCount: Number(row.sampleCount),
    system: row.system
  };
}

function fieldPayload(row) {
  return {
    code: row.code,
    name: row.name,
    meaning: row.meaning,
    type: row.type,
    unit: row.unit,
    required: !!row.required,
    sourceSystem: row.sourceSystem,
    sourceField: row.sourceField,
    transform: row.transform,
    validate: row.validate,
    stdField: row.stdField,
    options: lines(row.optionsText),
    referencedBy: lines(row.refsText)
  };
}

function createProductRow() {
  error.value = "";
  fieldForm.value = null;
  productForm.value = blankProduct();
}

function createFieldRow() {
  error.value = "";
  productForm.value = null;
  fieldForm.value = blankField();
}

async function saveProductRow() {
  error.value = "";
  saving.value = true;
  try {
    const body = productPayload(productForm.value);
    const saved = productForm.value.creating ? await createProduct(body) : await saveProduct(productForm.value.code, body);
    code.value = saved.code;
    productForm.value = null;
    if (productsView.value) await productsView.value.reload();
  } catch (err) {
    error.value = err.message;
  } finally {
    saving.value = false;
  }
}

async function removeProduct() {
  const yes = await askConfirm("删除产品「" + productForm.value.label + "」会同时去掉它的标准字段、字段映射、EAD 配置、缓释配置和专属规则。", {
    title: "删除产品",
    confirmText: "删除",
    danger: true
  });
  if (!yes) return;
  error.value = "";
  saving.value = true;
  try {
    await deleteProduct(productForm.value.code);
    productForm.value = null;
    if (productsView.value) await productsView.value.reload();
  } catch (err) {
    error.value = err.message;
  } finally {
    saving.value = false;
  }
}

async function saveFieldRow() {
  error.value = "";
  saving.value = true;
  try {
    const body = fieldPayload(fieldForm.value);
    if (fieldForm.value.creating) await createProductField(code.value, body);
    else await saveProductField(code.value, fieldForm.value.code, body);
    fieldForm.value = null;
    if (fieldsView.value) await fieldsView.value.reload();
    if (productsView.value) await productsView.value.reload();
  } catch (err) {
    error.value = err.message;
  } finally {
    saving.value = false;
  }
}

async function removeField() {
  const yes = await askConfirm("删除字段「" + fieldForm.value.name + "」。", {
    title: "删除字段",
    confirmText: "删除",
    danger: true
  });
  if (!yes) return;
  error.value = "";
  saving.value = true;
  try {
    await deleteProductField(code.value, fieldForm.value.code);
    fieldForm.value = null;
    if (fieldsView.value) await fieldsView.value.reload();
    if (productsView.value) await productsView.value.reload();
  } catch (err) {
    error.value = err.message;
  } finally {
    saving.value = false;
  }
}

async function removeProducts(rows) {
  const result = await runBatch(productPick, rows, "code", deleteProducts, batch, productForm, (row) => row.code);
  if (!result) return;
  if (result.deleted.indexOf(code.value) >= 0) fieldForm.value = null;
  if (productsView.value) await productsView.value.reload();
}

async function removeFields(rows) {
  const result = await runBatch(fieldPick, rows, "code", (ids) => deleteProductFields(code.value, ids), batch, fieldForm, (row) => row.code);
  if (!result) return;
  if (fieldsView.value) await fieldsView.value.reload();
  if (productsView.value) await productsView.value.reload();
}
</script>

<template>
  <p v-if="batch.state.text" class="notice" :class="batch.state.kind">{{ batch.state.text }}</p>
  <AsyncView ref="productsView" :load="loadProducts">
    <template #default="{ data }">
      <div class="field-actions">
        <button type="button" class="btn sm danger" :disabled="!productPick.visibleIds(data, 'code').length" @click="removeProducts(data)">删除所选</button>
        <button type="button" class="btn sm primary" @click="createProductRow">新建产品</button>
      </div>
      <div class="grid c4" style="margin-bottom: 14px">
        <div
          v-for="item in data"
          :key="item.code"
          class="fblock"
          :style="{ cursor: 'pointer', borderColor: code === item.code ? 'var(--brand-2)' : '' }"
          @click="code = item.code"
        >
          <div class="fh">
            <input type="checkbox" :checked="productPick.on(item.code)" @click.stop @change="productPick.toggle(item.code)" />
            <span
              :style="{
                width: '22px', height: '22px', borderRadius: '5px', background: item.color, color: '#fff',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '11px', fontWeight: '700', flex: '0 0 22px'
              }"
            >{{ item.icon }}</span>
            <span class="fname">{{ item.label }}</span>
            <span class="fcode">{{ item.code }}</span>
          </div>
          <div class="fmean">{{ item.desc }}</div>
          <div class="fmeta">
            <span>{{ item.fieldCount }} 个标准字段</span>
            <span>{{ item.system }}</span>
            <span class="tag" :class="item.onboarding === 'manual' ? 'warn' : 'muted'">{{ item.onboarding === 'manual' ? '人工录入' : '列式导入' }}</span>
          </div>
          <div class="field-actions">
            <button type="button" class="btn sm" @click.stop="editProduct(item)">编辑</button>
          </div>
        </div>
      </div>
      <AsyncView ref="fieldsView" :key="code" :load="loadFields">
        <template #default="{ data: fields }">
          <div class="panel">
            <div class="panel-head">
              <h3>{{ current(data).label }} · 标准字段配置</h3>
              <span class="sub">{{ fields.length }} 个字段，其中 {{ fields.filter((row) => row.required).length }} 个必填 · 关联监管规则版本 {{ current(data).ruleVersion }}</span>
              <span class="spacer"></span>
              <button type="button" class="btn sm danger" :disabled="!fieldPick.visibleIds(fields, 'code').length" @click="removeFields(fields)">删除所选</button>
              <button type="button" class="btn sm primary" :disabled="!code" @click="createFieldRow">新建字段</button>
            </div>
            <div class="panel-body tight">
              <table class="tbl compact">
                <thead>
                  <tr>
                    <th class="pick" @click.stop><input type="checkbox" :checked="fieldPick.allOn(fields, 'code')" @change="fieldPick.toggleAll(fields, 'code')" /></th>
                    <th>字段编码</th><th>标准字段名称</th><th>对应规则字段</th><th>数据类型</th><th>必填</th><th>来源系统</th><th>来源字段</th><th>转换规则</th><th>被引用</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="row in fields" :key="row.code" class="clickable" @click="editField(row)">
                    <td class="pick" @click.stop><input type="checkbox" :checked="fieldPick.on(row.code)" @change="fieldPick.toggle(row.code)" /></td>
                    <td class="mono">{{ row.code }}</td>
                    <td>{{ row.name }}</td>
                    <td class="mono">{{ row.stdField || "—" }}</td>
                    <td><span class="tag outline">{{ row.type }}{{ row.unit ? " · " + row.unit : "" }}</span></td>
                    <td><span class="tag" :class="row.required ? 'danger' : 'muted'">{{ row.required ? "必填" : "选填" }}</span></td>
                    <td>{{ row.sourceSystem }}</td>
                    <td class="mono">{{ row.sourceField }}</td>
                    <td>{{ row.transform }}</td>
                    <td><span class="tag" :class="(row.referencedBy || []).length ? 'brand' : 'muted'">{{ (row.referencedBy || []).length ? (row.referencedBy.length + " 条条款") : "—" }}</span></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </template>
      </AsyncView>
    </template>
  </AsyncView>
  <RuleForm
    :open="!!productForm"
    :title="productForm && productForm.creating ? '新建产品' : '编辑产品'"
    :error="error"
    :saving="saving"
    :creating="!!(productForm && productForm.creating)"
    @close="productForm = null"
    @save="saveProductRow"
    @remove="removeProduct"
  >
    <template v-if="productForm">
      <label class="field">产品编码
        <input v-model="productForm.code" type="text" :disabled="!productForm.creating" />
      </label>
      <label class="field">名称
        <input v-model="productForm.label" type="text" />
      </label>
      <label class="field">图标
        <input v-model="productForm.icon" type="text" />
      </label>
      <label class="field">颜色
        <input v-model="productForm.color" type="text" />
      </label>
      <label class="field">规则版本
        <select v-model="productForm.ruleVersion">
          <option v-for="item in versionOptions" :key="item" :value="item">{{ item }}</option>
        </select>
      </label>
      <label class="field">接入方式
        <select v-model="productForm.onboarding">
          <option value="column">列式导入</option>
          <option value="manual">人工录入</option>
        </select>
      </label>
      <label class="field">样例笔数
        <input v-model="productForm.sampleCount" type="number" />
      </label>
      <label class="field">来源系统
        <input v-model="productForm.system" type="text" />
      </label>
      <label class="field full">说明
        <textarea v-model="productForm.desc"></textarea>
      </label>
    </template>
  </RuleForm>
  <RuleForm
    :open="!!fieldForm"
    :title="fieldForm && fieldForm.creating ? '新建字段' : '编辑字段'"
    :error="error"
    :saving="saving"
    :creating="!!(fieldForm && fieldForm.creating)"
    @close="fieldForm = null"
    @save="saveFieldRow"
    @remove="removeField"
  >
    <template v-if="fieldForm">
      <label class="field">字段编码
        <input v-model="fieldForm.code" type="text" :disabled="!fieldForm.creating" />
      </label>
      <label class="field">标准字段名称
        <input v-model="fieldForm.name" type="text" />
      </label>
      <label class="field">对应规则字段
        <input v-model="fieldForm.stdField" type="text" />
      </label>
      <label class="field">数据类型
        <select v-model="fieldForm.type">
          <option value="number">number</option>
          <option value="enum">enum</option>
        </select>
      </label>
      <label class="field">单位
        <input v-model="fieldForm.unit" type="text" />
      </label>
      <label class="field">必填
        <select v-model="fieldForm.required">
          <option :value="true">必填</option>
          <option :value="false">选填</option>
        </select>
      </label>
      <label class="field">来源系统
        <input v-model="fieldForm.sourceSystem" type="text" />
      </label>
      <label class="field">来源字段
        <input v-model="fieldForm.sourceField" type="text" />
      </label>
      <label class="field full">含义
        <textarea v-model="fieldForm.meaning"></textarea>
      </label>
      <label class="field full">转换规则
        <input v-model="fieldForm.transform" type="text" />
      </label>
      <label class="field full">校验规则
        <input v-model="fieldForm.validate" type="text" />
      </label>
      <label class="field full">枚举取值
        <textarea v-model="fieldForm.optionsText"></textarea>
        <span class="hint">一行一个。number 类型留空。</span>
      </label>
      <label class="field full">被引用条款
        <textarea v-model="fieldForm.refsText"></textarea>
        <span class="hint">一行一个条款编号。</span>
      </label>
    </template>
  </RuleForm>
</template>
