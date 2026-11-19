<script setup>
import { computed, ref, watch } from "vue";
import { autoMapDatasets, saveDatasetMeta } from "@/api/hqla";

const props = defineProps({ task: Object, meta: Object, reload: Function });
const busy = ref(false);
const error = ref("");
const selectedId = ref("");
const rows = ref([]);
const stats = ref(null);
const missingRequired = ref([]);

const datasets = computed(() => ((props.task && props.task.datasets) || []).filter((item) => item.productCode));
const allDatasets = computed(() => (props.task && props.task.datasets) || []);
const selected = computed(() => allDatasets.value.find((item) => item.id === selectedId.value) || null);
const product = computed(() => {
  if (!selected.value || !props.meta) return null;
  return (props.meta.products || []).find((item) => item.code === selected.value.productCode) || null;
});
const fieldOptions = computed(() => (product.value ? product.value.fields : []));
const amountMapped = computed(() => {
  const codes = ["amount", "book_value", "fair_value", "undrawn_amount"];
  return rows.value.some((row) => codes.includes(row.standard));
});

function loadRows(dataset) {
  if (!dataset) { rows.value = []; stats.value = null; missingRequired.value = []; return; }
  const meta = dataset.mappingMeta;
  if (meta && Array.isArray(meta.mappings)) {
    rows.value = meta.mappings.map((item) => ({ ...item }));
    stats.value = meta.stats;
    missingRequired.value = meta.missingRequired || [];
    return;
  }
  const plain = dataset.mapping || {};
  rows.value = (dataset.headers || []).map((header) => {
    const found = Object.entries(plain).find(([, excel]) => excel === header);
    const field = found ? fieldOptions.value.find((item) => item.code === found[0]) : null;
    return {
      excel: header,
      standard: found ? found[0] : "",
      standardName: field ? field.name : "",
      method: found ? "手工映射" : "未匹配",
      confidence: found ? 100 : 0,
      required: field ? !!(field.required || field.requiredByRule) : false,
      status: found ? "已确认" : "不适用"
    };
  });
  stats.value = {
    headers: rows.value.length,
    mapped: rows.value.filter((item) => item.standard).length,
    confirmed: rows.value.filter((item) => item.status === "已确认").length,
    pending: 0,
    missingRequired: 0,
    notApplicable: rows.value.filter((item) => item.status === "不适用").length
  };
  missingRequired.value = [];
}

watch(datasets, (list) => {
  if (!list.length) { selectedId.value = ""; return; }
  if (!list.some((item) => item.id === selectedId.value)) selectedId.value = list[0].id;
}, { immediate: true });

watch(selectedId, () => loadRows(selected.value));
watch(selected, (value) => loadRows(value), { deep: false });

async function autoMap() {
  busy.value = true;
  error.value = "";
  try {
    await autoMapDatasets(props.task.id);
    await props.reload();
    loadRows(selected.value);
  } catch (err) {
    error.value = err.message;
  } finally {
    busy.value = false;
  }
}

function changeStandard(row, code) {
  row.standard = code;
  const field = fieldOptions.value.find((item) => item.code === code);
  row.standardName = field ? field.name : "";
  row.method = code ? "手工映射" : "未匹配";
  row.confidence = code ? 100 : 0;
  row.required = field ? !!(field.required || field.requiredByRule) : false;
  row.status = code ? "已确认" : "不适用";
}

async function saveMapping() {
  if (!selected.value) return;
  const plain = {};
  rows.value.forEach((row) => {
    if (row.standard) plain[row.standard] = row.excel;
  });
  const mapped = new Set(Object.keys(plain));
  const missing = (product.value ? product.value.requiredFields : []).filter((code) => !mapped.has(code));
  const payloadRows = rows.value.map((row) => ({ ...row }));
  const nextStats = {
    headers: payloadRows.length,
    mapped: mapped.size,
    confirmed: payloadRows.filter((item) => item.status === "已确认").length,
    pending: payloadRows.filter((item) => item.status === "待确认").length,
    missingRequired: missing.length,
    notApplicable: payloadRows.filter((item) => item.status === "不适用").length
  };
  busy.value = true;
  error.value = "";
  try {
    await saveDatasetMeta(props.task.id, selected.value.id, {
      mapping: plain,
      mappingMeta: { mappings: payloadRows, stats: nextStats, missingRequired: missing },
      quality: null
    });
    await props.reload();
  } catch (err) {
    error.value = err.message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <p v-if="error" class="notice danger">{{ error }}</p>

  <div class="panel">
    <div class="panel-head">
      <h3>标准字段 Mapping</h3>
      <span class="sub">必需字段由本次适用规则引用反推，不是产品全部字段；未被规则引用的字段允许不映射。</span>
      <span class="spacer"></span>
      <button type="button" class="btn sm" :disabled="busy || !datasets.length" @click="autoMap">
        {{ busy ? "处理中…" : "自动映射全部数据集" }}
      </button>
    </div>
    <div class="panel-body">
      <div v-if="!allDatasets.length" class="empty">请先在第二步导入 Excel 数据。</div>
      <div v-else-if="!datasets.length" class="empty">请先在第三步确认数据集对应的产品。</div>
      <template v-else>
        <div class="lq-tabs" style="margin-bottom: 10px">
          <button v-for="dataset in datasets" :key="dataset.id" type="button" :class="{ on: dataset.id === selectedId }" @click="selectedId = dataset.id">
            {{ dataset.sheet }}
            <span class="dim" style="font-size: 10.5px">{{ dataset.productCode }}</span>
          </button>
        </div>

        <template v-if="selected">
          <div class="lq-statrow">
            <div class="lq-mini"><span>Excel 字段</span><b>{{ rows.length }}</b></div>
            <div class="lq-mini"><span>已映射</span><b>{{ rows.filter((row) => row.standard).length }}</b></div>
            <div class="lq-mini"><span>必需字段</span><b>{{ (product && product.requiredFields || []).length }}</b></div>
            <div class="lq-mini"><span>缺失必需</span><b :class="{ danger: missingRequired.length }">{{ missingRequired.length }}</b></div>
          </div>

          <p v-if="!amountMapped" class="notice warn" style="margin: 8px 0">
            还没有映射金额字段（amount / book_value / fair_value / undrawn_amount），计算步骤会报金额缺失。
          </p>

          <table class="tbl">
            <thead>
              <tr><th>Excel 原始字段</th><th>产品标准字段</th><th>匹配方式</th><th class="num">置信度</th><th>必需</th><th>状态</th></tr>
            </thead>
            <tbody>
              <tr v-for="row in rows" :key="row.excel">
                <td>{{ row.excel }}</td>
                <td>
                  <select :value="row.standard" @change="changeStandard(row, $event.target.value)">
                    <option value="">不映射</option>
                    <option v-for="field in fieldOptions" :key="field.code" :value="field.code">
                      {{ field.name }}（{{ field.code }}）
                    </option>
                  </select>
                </td>
                <td class="small">{{ row.method }}</td>
                <td class="num mono">{{ row.confidence == null ? "—" : row.confidence + "%" }}</td>
                <td>
                  <span v-if="row.required" class="tag amber">必需</span>
                  <span v-else class="dim">—</span>
                </td>
                <td>
                  <span class="tag" :class="row.status === '已确认' ? 'green' : row.status === '待确认' ? 'amber' : 'muted'">
                    {{ row.status }}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
          <div style="display: flex; gap: 8px; align-items: center; margin-top: 10px">
            <button type="button" class="btn primary" :disabled="busy" @click="saveMapping">保存 Mapping</button>
            <span class="dim" style="font-size: 11.5px">Mapping 会保存为知识：同格式 Excel 下次优先复用；表头变化时重新识别并提示确认。</span>
          </div>
        </template>
      </template>
    </div>
  </div>
</template>

<style scoped>
.lq-tabs { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.lq-tabs button { border: 1px solid var(--line); background: #fff; border-radius: 999px; padding: 5px 12px; font-size: 12px; color: #475569; }
.lq-tabs button.on { background: #eef2ff; border-color: #a5b4fc; color: #3730a3; font-weight: 600; }
.lq-statrow { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin: 4px 0 10px; }
.lq-mini { background: #f8fafc; border: 1px solid var(--line); border-radius: 9px; padding: 8px 10px; }
.lq-mini span { display: block; font-size: 11px; color: var(--muted); }
.lq-mini b { font-size: 17px; }
.lq-mini b.danger { color: #b42318; }
</style>
