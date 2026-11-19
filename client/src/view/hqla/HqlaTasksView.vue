<script setup>
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import {
  archiveTask, createTask, deleteTask, downloadJson, duplicateTask, exportTaskArchive,
  importTask, listTasks
} from "@/api/hqla";
import { fetchLiquidityVersions } from "@/api/liquidity";
import { useContext } from "@/composables/useContext";
import Drawer from "@/components/Drawer.vue";
import { askConfirm } from "@/utils/confirm";

const router = useRouter();
const { session } = useContext();
const tasks = ref([]);
const loading = ref(true);
const error = ref("");
const filter = ref("all");
const q = ref("");
const drawer = ref(false);
const busy = ref(false);
const versions = ref([]);
const fileInput = ref(null);
const form = ref(blankForm());

const STATUS = {
  draft: { label: "草稿", tone: "muted" },
  doing: { label: "进行中", tone: "warn" },
  done: { label: "已完成", tone: "ok" },
  archived: { label: "已归档", tone: "muted" }
};
const FILTERS = [["all", "全部"], ["doing", "进行中"], ["done", "已完成"], ["archived", "已归档"]];

function blankForm() {
  const current = versions.value.find((item) => item.productCount > 0) || versions.value[0];
  return {
    name: "流动性覆盖率（LCR）计量任务",
    baseDate: today(),
    institution: "总行（法人）",
    version: current ? current.version : "",
    copyFrom: ""
  };
}

function today() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}

async function load() {
  loading.value = true;
  error.value = "";
  try {
    const [rows, versionRows] = await Promise.all([
      listTasks(),
      fetchLiquidityVersions(session.jurisdiction || "HK")
    ]);
    tasks.value = rows;
    let available = versionRows.filter((item) => item.productCount > 0);
    if (!available.length) {
      const all = await fetchLiquidityVersions("");
      available = all.filter((item) => item.productCount > 0);
    }
    versions.value = available;
    if (!form.value.version && versions.value.length) form.value.version = versions.value[0].version;
  } catch (err) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
}

const shown = computed(() => {
  const text = q.value.trim().toLowerCase();
  return tasks.value.filter((task) => {
    if (filter.value !== "all" && task.status !== filter.value) return false;
    if (!text) return true;
    return [task.name, task.id, task.institution, task.cfg && task.cfg.ruleVersion, task.baseDate]
      .join(" ").toLowerCase().includes(text);
  });
});

const stats = computed(() => ({
  total: tasks.value.length,
  pendingReview: tasks.value.filter((task) => reviewStatus(task) === "pending").length,
  failed: tasks.value.filter((task) => task.status === "error").length,
  archived: tasks.value.filter((task) => task.status === "archived").length
}));

function reviewStatus(task) {
  return (task.cfg && task.cfg.review && task.cfg.review.status) || "none";
}

function reviewLabel(task) {
  const status = reviewStatus(task);
  return status === "reviewed" ? "已复核" : status === "pending" ? "待复核" : "未复核";
}

function reviewTone(task) {
  const status = reviewStatus(task);
  return status === "reviewed" ? "ok" : status === "pending" ? "warn" : "muted";
}

function progress(task) {
  const checks = [
    !!(task.cfg && task.cfg.ruleVersion),
    !!(task.datasetCount || (task.datasets && task.datasets.length)),
    Number(task.datasetCount) > 0 && Number(task.productCount) === Number(task.datasetCount),
    Number(task.mappedCount) > 0,
    Number(task.qualityCount) > 0,
    !!(task.summary && task.summary.stats),
    reviewStatus(task) === "reviewed"
  ];
  const step = Math.min(7, Math.max(1, Number(task.step) || 1));
  const pct = task.status === "done" || task.status === "archived" ? 100
    : Math.round(((step - 1 + (checks[step - 1] ? 1 : 0.15)) / 7) * 100);
  return { pct, done: checks.filter(Boolean).length };
}

function records(task) {
  return (task.summary && task.summary.stats && task.summary.stats.records) || 0;
}

function exceptions(task) {
  return (task.summary && task.summary.stats && task.summary.stats.exceptions) || 0;
}

function open(task) {
  router.push(`/hqla/${task.id}`);
}

function openCreate() {
  form.value = blankForm();
  drawer.value = true;
}

async function submitCreate() {
  if (busy.value) return;
  const version = versions.value.find((item) => item.version === form.value.version);
  if (!version) { error.value = "请选择有流动性产品配置的监管规则版本"; return; }
  busy.value = true;
  try {
    session.jurisdiction = version.jurisdiction || session.jurisdiction;
    if (version.id) session.versionId = version.id;
    const task = await createTask({
      name: form.value.name.trim() || "流动性覆盖率（LCR）计量任务",
      baseDate: form.value.baseDate,
      institution: form.value.institution,
      copyFrom: form.value.copyFrom || null,
      cfg: {
        domain: "LCR",
        jurisdiction: version.jurisdiction || session.jurisdiction || "HK",
        ruleVersion: version.version,
        lcrVersion: version.lcrVersion || "",
        snapshot: {}
      }
    });
    drawer.value = false;
    router.push(`/hqla/${task.id}`);
  } catch (err) {
    error.value = err.message;
  } finally {
    busy.value = false;
  }
}

async function copy(task) {
  try {
    await duplicateTask(task.id);
    await load();
  } catch (err) {
    error.value = err.message;
  }
}

async function toggleArchive(task) {
  try {
    await archiveTask(task.id, task.status !== "archived");
    await load();
  } catch (err) {
    error.value = err.message;
  }
}

async function remove(task) {
  const yes = await askConfirm(`将删除任务「${task.name}」及其全部数据，确定继续？`, { title: "删除任务", danger: true });
  if (!yes) return;
  try {
    await deleteTask(task.id);
    await load();
  } catch (err) {
    error.value = err.message;
  }
}

async function exportOne(task) {
  try {
    const doc = await exportTaskArchive(task.id);
    downloadJson(doc, `${task.name.replace(/[\\/:*?"<>|]/g, "_")}_${task.id}.json`);
  } catch (err) {
    error.value = err.message;
  }
}

async function importFile(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  try {
    const doc = JSON.parse(await file.text());
    await importTask(doc);
    await load();
  } catch (err) {
    error.value = err.message;
  } finally {
    event.target.value = "";
  }
}

onMounted(load);
</script>

<template>
  <p v-if="error" class="notice danger">{{ error }}</p>

  <div class="lq-hero">
    <div>
      <h2>流动性覆盖率（LCR）计量任务</h2>
      <p>
        计量任务是一条可追溯流水线：规则版本 → 数据导入 → 产品识别 → 字段 Mapping → 质量检查 → 计算 → 复核输出。
      </p>
    </div>
    <div class="lq-hero-actions">
      <input ref="fileInput" type="file" accept=".json" style="display: none" @change="importFile" />
      <button type="button" class="btn sm" @click="fileInput.click()">导入归档</button>
      <button type="button" class="btn primary" @click="openCreate">＋ 新建计量任务</button>
    </div>
  </div>

  <div class="lq-stats">
    <div class="lq-stat"><span>任务总数</span><b>{{ stats.total }}</b><em>含历史归档</em></div>
    <div class="lq-stat"><span>待复核</span><b>{{ stats.pendingReview }}</b><em>需人工确认</em></div>
    <div class="lq-stat"><span>计算失败</span><b>{{ stats.failed }}</b><em>需排查</em></div>
    <div class="lq-stat"><span>已归档</span><b>{{ stats.archived }}</b><em>只读</em></div>
  </div>

  <div class="panel lq-filters">
    <div class="panel-body">
      <div class="lq-filter-row">
        <input v-model="q" type="search" placeholder="搜索任务名称 / ID / 机构 / 规则版本" />
        <div class="lq-tabs" style="margin: 0">
          <button v-for="[key, label] in FILTERS" :key="key" type="button" :class="{ on: filter === key }" @click="filter = key">
            {{ label }}
          </button>
        </div>
        <span class="spacer"></span>
        <span class="dim">{{ shown.length }} / {{ tasks.length }}</span>
      </div>
    </div>
  </div>

  <div class="panel">
    <div class="panel-head">
      <h3>任务清单</h3>
      <span class="sub">状态与复核标记分离：计算完成、数据异常、待复核各自独立</span>
    </div>
    <div class="panel-body tight">
      <div v-if="loading" class="empty">正在读取任务…</div>
      <div v-else-if="!tasks.length" class="empty">
        <div class="ei">▤</div>
        <div>还没有 LCR 计量任务。点击「新建计量任务」开始。</div>
      </div>
      <div v-else-if="!shown.length" class="empty">没有符合条件的任务。</div>
      <table v-else class="tbl compact">
        <thead>
          <tr>
            <th>任务名称</th><th>监管领域</th><th>计量期间</th><th>规则版本</th>
            <th>状态</th><th>复核</th><th class="num">记录数</th><th class="num">异常</th><th>进度</th><th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="task in shown" :key="task.id" class="clickable" @click="open(task)">
            <td>
              <strong>{{ task.name }}</strong>
              <div class="dim" style="font-size: 10.5px">{{ task.id }} · {{ task.institution }}</div>
            </td>
            <td><span class="tag blue">LCR</span></td>
            <td class="mono small">{{ task.baseDate || "—" }}</td>
            <td class="mono small">{{ (task.cfg && task.cfg.ruleVersion) || "—" }}</td>
            <td><span class="tag" :class="(STATUS[task.status] || {}).tone || 'muted'">{{ (STATUS[task.status] || {}).label || task.status }}</span></td>
            <td><span class="tag" :class="reviewTone(task)">{{ reviewLabel(task) }}</span></td>
            <td class="num mono">{{ records(task) ? records(task).toLocaleString("zh-CN") : "—" }}</td>
            <td class="num mono" :class="{ danger: exceptions(task) }">{{ exceptions(task) || "—" }}</td>
            <td style="min-width: 100px">
              <div class="lq-progress">
                <div class="lq-progress-bar"><i :style="{ width: progress(task).pct + '%' }"></i></div>
                <span :class="{ ok: progress(task).pct >= 100 }">{{ progress(task).pct }}%</span>
              </div>
            </td>
            <td @click.stop>
              <div style="display: flex; gap: 4px; flex-wrap: wrap">
                <button type="button" class="btn sm primary" @click="open(task)">详情</button>
                <button type="button" class="btn sm" @click="copy(task)">复制</button>
                <button type="button" class="btn sm" @click="toggleArchive(task)">{{ task.status === "archived" ? "取消归档" : "归档" }}</button>
                <button type="button" class="btn sm" @click="exportOne(task)">导出</button>
                <button type="button" class="btn sm danger" @click="remove(task)">删除</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>

  <Drawer :open="drawer" title="新建 LCR 计量任务" @close="drawer = false">
    <div class="grid c1">
      <div class="field"><label>任务名称</label><input v-model="form.name" type="text" /></div>
      <div class="field"><label>监管计量领域</label><input value="LCR 流动性覆盖率" disabled /></div>
      <div class="field"><label>计量期间</label><input v-model="form.baseDate" type="date" /></div>
      <div class="field">
        <label>监管规则版本</label>
        <select v-model="form.version">
          <option v-for="item in versions" :key="item.version" :value="item.version">
            {{ item.version }}（{{ item.lcrVersion || "未导入 LCR 规则" }}）
          </option>
        </select>
      </div>
      <div class="field"><label>机构</label><input v-model="form.institution" type="text" /></div>
    </div>
    <p class="dim" style="font-size: 11.5px">
      规则版本按计量基准日与监管适用要求选择，不默认取最新；确认后本任务锁定该版本。
    </p>
    <template #footer>
      <button type="button" class="btn" @click="drawer = false">取消</button>
      <span class="spacer"></span>
      <button type="button" class="btn primary" :disabled="busy" @click="submitCreate">{{ busy ? "创建中…" : "创建并进入向导" }}</button>
    </template>
  </Drawer>
</template>

<style scoped>
.lq-hero { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 14px; }
.lq-hero h2 { margin: 0 0 4px; font-size: 18px; }
.lq-hero p { margin: 0; color: var(--muted); font-size: 12.5px; max-width: 820px; }
.lq-hero-actions { display: flex; gap: 8px; align-items: center; }
.lq-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin-bottom: 12px; }
.lq-stat { background: #fff; border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; }
.lq-stat span { font-size: 11.5px; color: var(--muted); display: block; }
.lq-stat b { font-size: 20px; display: block; line-height: 1.3; }
.lq-stat em { font-style: normal; font-size: 11px; color: var(--muted); }
.lq-tabs { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.lq-tabs button { border: 1px solid var(--line); background: #fff; border-radius: 999px; padding: 5px 12px; font-size: 12px; color: #475569; }
.lq-tabs button.on { background: #eef2ff; border-color: #a5b4fc; color: #3730a3; font-weight: 600; }
.lq-filter-row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.lq-filter-row input[type="search"] { flex: 1 1 280px; max-width: 380px; width: auto; }
.lq-filters .panel-body { padding: 10px 12px; }
.lq-progress { display: flex; align-items: center; gap: 6px; }
.lq-progress-bar { flex: 1; height: 7px; background: #eef2ff; border-radius: 6px; overflow: hidden; min-width: 56px; }
.lq-progress-bar i { display: block; height: 100%; background: #f59e0b; }
.lq-progress span { font-size: 10.5px; color: #b45309; }
.lq-progress span.ok { color: #047857; }
@media (max-width: 900px) { .lq-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style>
