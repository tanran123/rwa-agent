<script setup>
import { computed, ref } from "vue";
import { fetchPaper, fetchUploadSamples } from "@/api/batch";

const stages = [
  { title: "映射", detail: "把判定字段对到源表的列" },
  { title: "计算", detail: "在源表每一行写入风险暴露类型和 RWA" },
  { title: "追溯", detail: "回看规则和手填的权重" }
];

const stage = ref(0);
const mode = ref("");
const loading = ref(false);
const error = ref("");
const paper = ref(null);
const samples = ref(null);
const fileName = ref("");

const yi = (value) => Number(value || 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " 亿";
const money = (value) => Number(value || 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const sampleFields = computed(() => {
  if (!samples.value) return [];
  const book = samples.value.sample;
  return Object.entries(book.aiSuggest).map(([id, item]) => {
    const col = book.columns.find((column) => column.letter === item.letter);
    return { id, reason: item.reason, letter: item.letter, header: col ? col.header : (item.const || "未对上列"), constant: item.const || "" };
  });
});
const catalogFields = computed(() => {
  if (!samples.value) return [];
  const book = samples.value.catalog;
  return Object.entries(book.map).map(([id, item]) => {
    const col = book.columns.find((column) => column.letter === item.letter);
    return { id, reason: item.reason, header: col ? col.letter + " " + col.header : "未对上列" };
  });
});

async function ensureSamples() {
  if (!samples.value) samples.value = await fetchUploadSamples();
}
async function loadPaper() {
  loading.value = true;
  error.value = "";
  try {
    paper.value = await fetchPaper(0);
    mode.value = "paper";
    stage.value = 1;
  } catch (err) {
    error.value = (err.response && err.response.data && err.response.data.error) || "没有读到底稿。";
    mode.value = "";
  } finally {
    loading.value = false;
  }
}
async function loadCatalog() {
  loading.value = true;
  error.value = "";
  try {
    await ensureSamples();
    mode.value = "catalog";
    stage.value = 1;
  } catch (err) {
    error.value = "字段清单示例没有读到。";
  } finally {
    loading.value = false;
  }
}
async function loadSample() {
  loading.value = true;
  error.value = "";
  try {
    await ensureSamples();
    mode.value = "sample";
    stage.value = 0;
  } catch (err) {
    error.value = "内置样例没有读到。";
  } finally {
    loading.value = false;
  }
}
function pickFile(event) {
  const file = event.target.files && event.target.files[0];
  fileName.value = file ? file.name : "";
  if (file) error.value = "已选择「" + file.name + "」。这一页按信用风险底稿计算时，读取的是已算好的底稿结果，不重新解析任意工作簿。";
}
</script>

<template>
  <div class="calc-stages">
    <button v-for="(item, index) in stages" :key="item.title" type="button" class="calc-stage" :class="{ active: stage === index, done: index < stage }" @click="stage = index">
      <span class="no">{{ index < stage ? "✓" : index + 1 }}</span>
      <span><strong>{{ item.title }}</strong><small>{{ item.detail }}</small></span>
    </button>
  </div>

  <div v-if="error" class="banner warn">{{ error }}</div>
  <div v-if="loading" class="loading"><span class="spin"></span>正在读取上传内容和计算结果</div>

  <template v-if="!mode">
    <div class="banner">先把判定字段对到源表列。计算时会在每一行写入风险暴露类型和 RWA。</div>
    <label class="upload-box">
      <strong>上传明细工作簿</strong>
      <span>点击选择 .xlsx / .xlsm。先映射判定字段，再按行计算。{{ fileName ? "已选择 " + fileName : "" }}</span>
      <input type="file" accept=".xlsx,.xlsm,.xls" hidden @change="pickFile" />
    </label>
    <div class="btn-group" style="margin-top: 12px">
      <button type="button" class="btn primary" :disabled="loading" @click="loadPaper">按信用风险底稿计算</button>
      <button type="button" class="btn" :disabled="loading" @click="loadCatalog">用字段清单示例</button>
      <button type="button" class="btn" :disabled="loading" @click="loadSample">没有文件时，用内置样例</button>
    </div>
  </template>

  <template v-else-if="mode === 'paper' && paper">
    <div v-if="stage === 0" class="panel">
      <div class="panel-head"><h3>底稿字段对应</h3><span class="sub">{{ paper.file }} · 对上 {{ paper.mappedFields }} / {{ paper.fieldCount }} 个字段</span></div>
      <div class="panel-body tight"><div class="table-wrap">
        <table class="tbl compact">
          <thead><tr><th>字段</th><th>各表取值</th></tr></thead>
          <tbody>
            <tr v-for="item in paper.coverage" :key="item.id">
              <td>{{ item.label }}<div class="mono dim">{{ item.id }}</div></td>
              <td>{{ (item.hits || []).join("；") }}</td>
            </tr>
          </tbody>
        </table>
      </div></div>
    </div>
    <template v-else-if="stage === 1">
      <div class="banner ok">来自「{{ paper.file }}」。敞口 {{ yi(paper.eadYi) }}，风险加权资产 {{ yi(paper.rwaYi) }}。{{ paper.modelNote }}</div>
      <div class="grid c4" style="margin-bottom: 12px">
        <div class="kpi accent"><div class="k-label">合计敞口</div><div class="k-value sm">{{ yi(paper.eadYi) }}</div><div class="k-foot">{{ paper.rowCount }} 行</div></div>
        <div class="kpi"><div class="k-label">合计 RWA</div><div class="k-value sm">{{ yi(paper.rwaYi) }}</div></div>
        <div class="kpi"><div class="k-label">尚未定权重</div><div class="k-value sm">{{ yi(paper.unpricedYi) }}</div></div>
        <div class="kpi"><div class="k-label">工作表</div><div class="k-value sm">{{ paper.sheetPlan.length }}</div></div>
      </div>
      <div class="panel" style="margin-bottom: 12px">
        <div class="panel-head"><h3>识别到的工作表</h3></div>
        <div class="panel-body tight"><div class="table-wrap">
          <table class="tbl compact">
            <thead><tr><th>工作表</th><th>表头行</th><th>识别原因</th></tr></thead>
            <tbody>
              <tr v-for="item in paper.sheetPlan" :key="item.sheet">
                <td>{{ item.sheet }}</td><td class="num">{{ item.header_row }}</td><td>{{ item.reason || "—" }}</td>
              </tr>
            </tbody>
          </table>
        </div></div>
      </div>
      <div class="panel">
        <div class="panel-head"><h3>源表明细</h3><span class="sub">列出前 {{ paper.rows.length }} 行，全部 {{ paper.rowCount }} 行</span></div>
        <div class="panel-body tight"><div class="table-wrap">
          <table class="tbl compact">
            <thead><tr><th>工作表</th><th>行</th><th>名称</th><th>风险暴露类型</th><th>权重</th><th>敞口</th><th>风险加权资产</th></tr></thead>
            <tbody>
              <tr v-for="(row, index) in paper.rows" :key="row.sheet + '-' + row.excelRow + '-' + index">
                <td>{{ row.sheet }}</td>
                <td class="num">{{ row.excelRow }}</td>
                <td>{{ row.name || "—" }}</td>
                <td>{{ row.exposure }}</td>
                <td class="num">{{ row.weightText }}</td>
                <td class="num">{{ money(row.ead) }}</td>
                <td class="num">{{ row.rwa == null ? "待手填" : money(row.rwa) }}</td>
              </tr>
            </tbody>
          </table>
        </div></div>
      </div>
    </template>
    <template v-else>
      <div class="grid c3" style="margin-bottom: 12px">
        <div class="kpi"><div class="k-label">敞口</div><div class="k-value sm">{{ yi(paper.eadYi) }}</div></div>
        <div class="kpi"><div class="k-label">风险加权资产</div><div class="k-value sm">{{ yi(paper.rwaYi) }}</div></div>
        <div class="kpi"><div class="k-label">基准日</div><div class="k-value sm">{{ paper.asOf }}</div></div>
      </div>
      <div class="banner ok">{{ paper.note }}</div>
      <div class="panel">
        <div class="panel-head"><h3>分类汇总</h3><span class="sub">{{ paper.lines.length }} 档</span></div>
        <div class="panel-body tight"><div class="table-wrap">
          <table class="tbl compact">
            <thead><tr><th>部分</th><th>分类</th><th>权重</th><th>笔数</th><th>敞口（亿）</th><th>RWA（亿）</th></tr></thead>
            <tbody>
              <tr v-for="(line, index) in paper.lines" :key="index">
                <td>{{ line.part }}</td>
                <td>{{ line.label }}</td>
                <td class="num">{{ line.weight_text || "未定权重" }}</td>
                <td class="num">{{ line.count }}</td>
                <td class="num">{{ Number(line.ead_yi).toFixed(2) }}</td>
                <td class="num">{{ line.rwa_yi == null ? "—" : Number(line.rwa_yi).toFixed(2) }}</td>
              </tr>
            </tbody>
          </table>
        </div></div>
      </div>
    </template>
  </template>

  <template v-else-if="mode === 'catalog' && samples">
    <div class="banner ok">已按产品字段清单里能取到的列填好。清单没有的分类字段不在这张表里。文件：{{ samples.catalog.file }}</div>
    <div class="panel" style="margin-bottom: 12px">
      <div class="panel-head"><h3>判定字段</h3><span class="sub">{{ samples.catalog.sheet }} · 表头第 {{ samples.catalog.headerRow }} 行</span></div>
      <div class="panel-body tight"><div class="table-wrap">
        <table class="tbl compact">
          <thead><tr><th>字段</th><th>来源列</th><th>依据</th></tr></thead>
          <tbody>
            <tr v-for="item in catalogFields" :key="item.id">
              <td class="mono">{{ item.id }}</td><td>{{ item.header }}</td><td>{{ item.reason }}</td>
            </tr>
          </tbody>
        </table>
      </div></div>
    </div>
    <div class="panel">
      <div class="panel-head"><h3>上传明细</h3><span class="sub">{{ samples.catalog.rows.length }} 行</span></div>
      <div class="panel-body tight"><div class="table-wrap">
        <table class="tbl compact">
          <thead><tr><th v-for="col in samples.catalog.columns" :key="col.letter">{{ col.header }}</th></tr></thead>
          <tbody>
            <tr v-for="row in samples.catalog.rows" :key="row.id">
              <td v-for="col in samples.catalog.columns" :key="col.letter">{{ row[col.letter] }}</td>
            </tr>
          </tbody>
        </table>
      </div></div>
    </div>
  </template>

  <template v-else-if="mode === 'sample' && samples">
    <div class="banner">内置样例「{{ samples.sample.file }}」· 工作表 {{ samples.sample.sheet }} · 表头第 {{ samples.sample.headerRow }} 行。</div>
    <div v-if="stage === 0" class="panel">
      <div class="panel-head"><h3>判定字段</h3></div>
      <div class="panel-body tight"><div class="table-wrap">
        <table class="tbl compact">
          <thead><tr><th>字段</th><th>来源</th><th>依据</th></tr></thead>
          <tbody>
            <tr v-for="item in sampleFields" :key="item.id">
              <td class="mono">{{ item.id }}</td>
              <td>{{ item.letter ? item.letter + " " + item.header : item.constant || item.header }}</td>
              <td>{{ item.reason }}</td>
            </tr>
          </tbody>
        </table>
      </div></div>
      <div class="panel-body"><button type="button" class="btn primary" @click="stage = 1">映射完成 · 开始计算 →</button></div>
    </div>
    <div v-else class="panel">
      <div class="panel-head"><h3>上传明细</h3><span class="sub">{{ samples.sample.rows.length }} 行</span></div>
      <div class="panel-body tight"><div class="table-wrap">
        <table class="tbl compact">
          <thead><tr><th v-for="col in samples.sample.columns" :key="col.letter">{{ col.header }}</th></tr></thead>
          <tbody>
            <tr v-for="row in samples.sample.rows" :key="row.id">
              <td v-for="col in samples.sample.columns" :key="col.letter">{{ row[col.letter] }}</td>
            </tr>
          </tbody>
        </table>
      </div></div>
    </div>
  </template>
</template>
