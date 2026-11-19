<script setup>
import { computed, ref } from "vue";
import {
  deleteDataset, inspectWorkbook, parseWorkbook, readFileBase64, saveDatasets
} from "@/api/hqla";
import { askConfirm } from "@/utils/confirm";

const props = defineProps({ task: Object, reload: Function });

const busy = ref(false);
const error = ref("");
const pending = ref(null);
const pendingContent = ref("");
const fileInput = ref(null);
const sourceName = ref("");

const datasets = computed(() => (props.task && props.task.datasets) || []);
const totalRows = computed(() => datasets.value.reduce((sum, item) => sum + (item.rows || []).length, 0));

async function onFile(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  busy.value = true;
  error.value = "";
  try {
    const content = await readFileBase64(file);
    const result = await inspectWorkbook({ filename: file.name, content });
    pending.value = result.sheets;
    pendingContent.value = content;
    sourceName.value = file.name;
  } catch (err) {
    error.value = err.message;
  } finally {
    busy.value = false;
    event.target.value = "";
  }
}

async function confirmImport() {
  if (!pending.value) return;
  busy.value = true;
  error.value = "";
  try {
    const result = await parseWorkbook({ filename: sourceName.value, content: pendingContent.value });    const rows = result.datasets.map((dataset) => ({
      ...dataset,
      headers: dataset.headers,
      rows: dataset.rows,
      mapping: {},
      quality: null,
      productCode: "",
      productName: "",
      confidence: null,
      level: "",
      confirmedAt: ""
    }));
    await saveDatasets(props.task.id, rows);
    pending.value = null;
    await props.reload();
  } catch (err) {
    error.value = err.message;
  } finally {
    busy.value = false;
  }
}

async function clearAll() {
  const yes = await askConfirm("将清除本任务已导入的全部数据集，确定继续？", { title: "清除数据", danger: true });
  if (!yes) return;
  await saveDatasets(props.task.id, []);
  await props.reload();
}

async function removeDataset(dataset) {
  const yes = await askConfirm(`将删除数据集「${dataset.sheet}」，确定继续？`, { title: "删除数据集", danger: true });
  if (!yes) return;
  await deleteDataset(props.task.id, dataset.id);
  await props.reload();
}
</script>

<template>
  <p v-if="error" class="notice danger">{{ error }}</p>

  <div class="panel">
    <div class="panel-head"><h3>导入计量数据</h3><span class="sub">第 2 步</span></div>
    <div class="panel-body">
      <p class="dim" style="font-size: 12px; margin: 0 0 10px">
        上传原始工作簿即可，无需提前按产品拆分；系统按 Sheet 解析为数据集，表头会自动识别。
      </p>
      <input ref="fileInput" type="file" accept=".xlsx,.xls,.csv" style="display: none" @change="onFile" />
      <div class="lq-upload" @click="fileInput.click()">
        <b>{{ busy ? "正在解析…" : "拖拽 Excel 文件至此处，或点击选择文件" }}</b>
        <span>支持 .xlsx / .xls / .csv</span>
      </div>

      <div v-if="pending" class="lq-import-preview">
        <div class="panel-head">
          <h3>解析预览</h3>
          <span class="sub">{{ sourceName }} · {{ pending.length }} 个 Sheet</span>
          <span class="spacer"></span>
          <button type="button" class="btn sm" @click="pending = null">取消</button>
          <button type="button" class="btn sm primary" :disabled="busy" @click="confirmImport">确认导入</button>
        </div>
        <table class="tbl">
          <thead><tr><th>Sheet</th><th>表头行</th><th class="num">数据行</th><th>字段预览</th></tr></thead>
          <tbody>
            <tr v-for="sheet in pending" :key="sheet.name">
              <td><strong>{{ sheet.name }}</strong></td>
              <td class="mono small">第 {{ sheet.headerRow }} 行</td>
              <td class="num mono">{{ sheet.rows.toLocaleString("zh-CN") }}</td>
              <td class="small dim">{{ (sheet.headers || []).slice(0, 6).join(" · ") }}{{ sheet.headers.length > 6 ? " …" : "" }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="datasets.length" style="margin-top: 12px">
        <div class="panel-head">
          <h3>已导入数据集</h3>
          <span class="sub">{{ datasets.length }} 个 Sheet · {{ totalRows.toLocaleString("zh-CN") }} 行</span>
          <span class="spacer"></span>
          <button type="button" class="btn sm danger" @click="clearAll">清空全部</button>
        </div>
        <table class="tbl">
          <thead><tr><th>Sheet</th><th class="num">数据行</th><th class="num">字段数</th><th>产品识别</th><th></th></tr></thead>
          <tbody>
            <tr v-for="dataset in datasets" :key="dataset.id">
              <td><strong>{{ dataset.sheet }}</strong><div class="mono dim" style="font-size: 10.5px">{{ dataset.id }}</div></td>
              <td class="num mono">{{ (dataset.rows || []).length.toLocaleString("zh-CN") }}</td>
              <td class="num mono">{{ (dataset.headers || []).length }}</td>
              <td>
                <span v-if="dataset.productCode" class="tag green">{{ dataset.productName || dataset.productCode }}</span>
                <span v-else class="tag muted">待识别</span>
              </td>
              <td class="num"><button type="button" class="btn sm danger" @click="removeDataset(dataset)">删除</button></td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-else class="empty" style="margin-top: 12px">尚未上传文件</div>
    </div>
  </div>
</template>

<style scoped>
.lq-upload {
  border: 1px dashed #cbd5e1;
  border-radius: 12px;
  background: #f8fafc;
  padding: 26px 16px;
  text-align: center;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.lq-upload:hover { border-color: #a5b4fc; background: #f5f7ff; }
.lq-upload b { font-size: 13px; }
.lq-upload span { font-size: 11.5px; color: var(--muted); }
.lq-import-preview { margin-top: 14px; }
</style>
