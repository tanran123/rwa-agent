<script setup>
import { computed, onMounted, ref, watch } from "vue";
import { confirmFields, getTaskSnapshot, listFields, suggestFields } from "@/api/hqla";

const props = defineProps({ task: Object, meta: Object, reload: Function });

const busy = ref(false);
const error = ref("");
const note = ref("");
const catalog = ref([]);
const datasetId = ref("");
const productCode = ref("");
const productOptions = ref([]);
const rows = ref([]);
const stats = ref({ headers: 0, suggested: 0, confirmed: 0, missingRequired: 0 });
const missingRequired = ref([]);
const edits = ref({});

const datasets = computed(() => (props.task && props.task.datasets) || []);
const products = computed(() => catalog.value.length ? catalog.value : ((props.meta && props.meta.products) || []));
const product = computed(() => products.value.find((item) => item.code === productCode.value) || null);
const fieldOptions = computed(() => (product.value ? (product.value.fields || []).filter((field) => field.status !== "DISABLED") : []));
const dataset = computed(() => datasets.value.find((item) => item.id === datasetId.value) || null);

function selectedCode(row) {
  if (edits.value[row.sourceColumn] != null) return edits.value[row.sourceColumn];
  return row.fieldCode || row.suggestedFieldCode || "";
}

function setCode(row, value) {
  edits.value = { ...edits.value, [row.sourceColumn]: value };
}

function fieldName(code) {
  const field = fieldOptions.value.find((item) => item.code === code);
  return field ? field.name : "";
}

async function loadSnapshot() {
  try {
    const snapshot = await getTaskSnapshot(props.task.id);
    catalog.value = (snapshot.config && snapshot.config.products) || [];
  } catch (err) {
    catalog.value = [];
  }
}

async function loadProductOptions() {
  if (!datasetId.value) { productOptions.value = []; return; }
  try {
    const result = await listFields(props.task.id, { datasetId: datasetId.value });
    const list = Array.isArray(result.products) ? result.products : [];
    if (!list.length && dataset.value && dataset.value.productCode) list.push(dataset.value.productCode);
    productOptions.value = [...new Set(list)];
    if (!productOptions.value.includes(productCode.value)) productCode.value = productOptions.value[0] || "";
  } catch (err) {
    error.value = err.message;
  }
}

async function loadRows() {
  if (!datasetId.value || !productCode.value) { rows.value = []; return; }
  busy.value = true;
  error.value = "";
  try {
    const result = await listFields(props.task.id, { datasetId: datasetId.value, productCode: productCode.value });
    rows.value = result.rows || [];
    stats.value = result.stats || stats.value;
    missingRequired.value = result.missingRequired || [];
    edits.value = {};
  } catch (err) {
    error.value = err.message;
  } finally {
    busy.value = false;
  }
}

async function load() {
  await loadProductOptions();
  await loadRows();
}

async function suggest() {
  if (!datasetId.value || !productCode.value) return;
  busy.value = true;
  error.value = "";
  note.value = "";
  try {
    const result = await suggestFields(props.task.id, { datasetId: datasetId.value, productCode: productCode.value });
    const target = (result.datasets || [])[0];
    note.value = target && target.modelError
      ? "模型字段识别失败，已使用确定性兜底：" + target.modelError
      : "字段识别建议已更新。";
    await loadRows();
    if (props.reload) await props.reload();
  } catch (err) {
    error.value = err.message;
  } finally {
    busy.value = false;
  }
}

async function save() {
  if (!datasetId.value || !productCode.value) return;
  busy.value = true;
  error.value = "";
  note.value = "";
  try {
    const mappings = rows.value
      .map((row) => ({ sourceColumn: row.sourceColumn, fieldCode: selectedCode(row) }))
      .filter((item) => item.fieldCode);
    const result = await confirmFields(props.task.id, {
      datasetId: datasetId.value,
      productCode: productCode.value,
      mappings
    });
    rows.value = result.rows || rows.value;
    stats.value = result.stats || stats.value;
    missingRequired.value = result.missingRequired || [];
    edits.value = {};
    note.value = "字段对应已保存。";
    if (props.reload) await props.reload();
  } catch (err) {
    error.value = err.message;
  } finally {
    busy.value = false;
  }
}

watch(datasetId, async () => {
  await loadProductOptions();
  await loadRows();
});
watch(productCode, loadRows);

onMounted(async () => {
  await loadSnapshot();
  datasetId.value = datasets.value.length ? datasets.value[0].id : "";
  await load();
  if (!productCode.value && datasets.value.length) await loadRows();
});
</script>

<template>
  <p v-if="error" class="notice danger">{{ error }}</p>
  <p v-if="note" class="notice ok">{{ note }}</p>

  <div class="panel">
    <div class="panel-head">
      <h3>标准字段识别</h3>
      <span class="sub">按「数据集 + 产品 + 原始列」维护；模型只给建议，人工确认后保存。</span>
      <span class="spacer"></span>
      <button type="button" class="btn sm" :disabled="busy || !productCode" @click="suggest">
        {{ busy ? "处理中…" : "自动识别字段" }}
      </button>
    </div>
    <div class="panel-body">
      <div class="inline-fields" style="margin-bottom: 10px">
        <select v-model="datasetId" style="min-width: 220px">
          <option v-for="item in datasets" :key="item.id" :value="item.id">
            {{ item.sheet }}（{{ item.rowCount || (item.rows || []).length }} 行）
          </option>
        </select>
        <select v-model="productCode" style="min-width: 240px">
          <option v-for="code in productOptions" :key="code" :value="code">
            {{ (products.find((item) => item.code === code) || {}).name || code }}（{{ code }}）
          </option>
        </select>
        <span class="spacer"></span>
        <span class="dim">{{ rows.length }} 个原始列 · 已确认 {{ stats.confirmed || 0 }} · 缺失必需 {{ missingRequired.length }}</span>
      </div>

      <div v-if="!datasets.length" class="empty">请先在第二步导入 Excel 数据。</div>
      <div v-else-if="!productOptions.length" class="empty">请先在第三步确认这个数据集的产品。</div>
      <div v-else-if="!productCode" class="empty">请选择产品。</div>
      <template v-else>
        <p v-if="missingRequired.length" class="notice warn">
          还有 {{ missingRequired.length }} 个规则必需字段没有对应原始列：{{ missingRequired.join("、") }}。
        </p>
        <table class="tbl">
          <thead>
            <tr><th>Excel 原始列</th><th>建议标准字段</th><th class="num">置信度</th><th>匹配说明</th><th>确认标准字段</th><th>必需</th></tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="row.sourceColumn">
              <td>{{ row.sourceColumn }}</td>
              <td>
                {{ row.suggestedFieldCode ? (row.suggestedFieldName || fieldName(row.suggestedFieldCode)) : "—" }}
                <div v-if="row.suggestedFieldCode" class="mono dim" style="font-size: 10.5px">{{ row.suggestedFieldCode }}</div>
              </td>
              <td class="num mono">{{ row.confidence == null ? "—" : row.confidence + "%" }}</td>
              <td class="small dim" style="max-width: 300px">{{ row.reason || "—" }}</td>
              <td>
                <select :value="selectedCode(row)" @change="setCode(row, $event.target.value)">
                  <option value="">不映射</option>
                  <option v-for="field in fieldOptions" :key="field.code" :value="field.code">
                    {{ field.name }}（{{ field.code }}）
                  </option>
                </select>
              </td>
              <td>
                <span v-if="row.required" class="tag amber">必需</span>
                <span v-else class="dim">—</span>
              </td>
            </tr>
          </tbody>
        </table>
        <div style="margin-top: 10px; display: flex; gap: 8px; align-items: center">
          <button type="button" class="btn primary" :disabled="busy" @click="save">保存字段对应</button>
          <span class="dim" style="font-size: 11.5px">字段对应保存为人工确认结果；自动建议保留在建议表，不会自动确认。</span>
        </div>
      </template>
    </div>
  </div>
</template>
