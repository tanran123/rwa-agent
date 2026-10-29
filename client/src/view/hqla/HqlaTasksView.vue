<script setup>
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import {
  archiveTask, createTask, deleteTask, downloadJson, duplicateTask, exportTaskArchive,
  importTask, listTasks
} from "@/api/hqla";
import { askConfirm } from "@/utils/confirm";

const router = useRouter();
const tasks = ref([]);
const loading = ref(true);
const error = ref("");
const filter = ref("all");
const creating = ref(false);
const importing = ref(null);
const busy = ref(false);

const form = ref({ name: "", baseDate: "2025-12-31", institution: "总行（法人）", copyFrom: "" });

const STATUS = {
  draft: { label: "草稿", tone: "muted" },
  doing: { label: "进行中", tone: "warn" },
  done: { label: "已完成", tone: "ok" },
  archived: { label: "已归档", tone: "muted" }
};
const FILTERS = [["all", "全部"], ["doing", "进行中"], ["done", "已完成"], ["archived", "已归档"]];

async function load() {
  loading.value = true;
  error.value = "";
  try {
    tasks.value = await listTasks();
  } catch (err) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
}

const shown = computed(() => (filter.value === "all" ? tasks.value : tasks.value.filter((t) => t.status === filter.value)));

function progress(task) {
  const inputRows = Number(task.inputCount || 0);
  const checks = [
    inputRows > 0,
    Number(task.listCount || 0) > 0,
    !!((task.cfg && task.cfg.rules && task.cfg.rules.length) || task.cfg),
    !!(task.sample && task.sample.size),
    !!(task.fetchLog && task.fetchLog.length),
    !!task.runAt,
    !!task.summary
  ];
  const step = Math.min(7, Math.max(1, Number(task.step) || 1));
  const done = checks.filter(Boolean).length;
  const pct = task.status === "done" ? 100 : Math.round((((step - 1) + (checks[step - 1] ? 1 : 0.15)) / 7) * 100);
  return { pct, done, total: checks.length, step };
}

function num(value) {
  if (value == null || Number.isNaN(Number(value))) return "—";
  return Number(value).toLocaleString("zh-CN", { maximumFractionDigits: 0 });
}

function open(task) {
  router.push(`/hqla/${task.id}`);
}

async function submitCreate() {
  if (busy.value) return;
  busy.value = true;
  try {
    const task = await createTask({
      name: form.value.name.trim() || `HQLA 判定任务 ${new Date().toLocaleDateString("zh-CN")}`,
      baseDate: form.value.baseDate || "2025-12-31",
      institution: form.value.institution,
      copyFrom: form.value.copyFrom || null
    });
    creating.value = false;
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
  const ok = await askConfirm(`将删除任务「${task.name}」及其全部数据，确定继续？`, { title: "删除任务", danger: true });
  if (!ok) return;
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
    const task = await importTask(doc);
    importing.value.value = "";
    await load();
    router.push(`/hqla/${task.id}`);
  } catch (err) {
    error.value = err.message;
  }
}

onMounted(load);
</script>

<template>
  <p v-if="error" class="notice danger">{{ error }}</p>

  <p class="notice info">
    每个「计算任务」是一次独立的 HQLA 判定作业，拥有自己的债券明细、内部清单、判定标准、抽样结果与结论，互不影响。
    任务可导出为归档文件（JSON），便于交接与留痕。
  </p>

  <div v-if="creating" class="panel" style="margin-bottom: 14px">
    <div class="panel-head">
      <h3>新建计算任务</h3>
      <span class="spacer"></span>
      <button type="button" class="btn sm" @click="creating = false">取消</button>
    </div>
    <div class="panel-body">
      <div class="grid c2">
        <label class="field">
          <span>任务名称</span>
          <input v-model="form.name" type="text" placeholder="如：2025 年报 HQLA 债务证券测试" />
        </label>
        <label class="field">
          <span>基准日</span>
          <input v-model="form.baseDate" type="date" />
        </label>
        <label class="field">
          <span>机构</span>
          <select v-model="form.institution">
            <option>总行（法人）</option>
            <option>香港分行</option>
            <option>澳门分行</option>
          </select>
        </label>
        <label class="field">
          <span>判定标准来源</span>
          <select v-model="form.copyFrom">
            <option value="">不复制（使用系统默认判定标准）</option>
            <option v-for="task in tasks" :key="task.id" :value="task.id">复制自：{{ task.name }}</option>
          </select>
        </label>
      </div>
      <div style="margin-top: 12px">
        <button type="button" class="btn-primary" :disabled="busy" @click="submitCreate">创建并进入向导</button>
      </div>
    </div>
  </div>

  <div class="panel">
    <div class="panel-head">
      <h3>任务清单</h3>
      <span class="sub">{{ tasks.length }} 个任务</span>
      <span class="spacer"></span>
      <div class="seg">
        <button
          v-for="[code, label] in FILTERS"
          :key="code"
          type="button"
          :class="{ active: filter === code }"
          @click="filter = code"
        >{{ label }}</button>
      </div>
      <button type="button" class="btn sm primary" @click="creating = true">新建任务</button>
      <button type="button" class="btn sm" @click="importing.click()">导入归档</button>
      <input ref="importing" type="file" accept=".json" style="display: none" @change="importFile" />
    </div>

    <div class="panel-body tight">
      <p v-if="loading" class="empty">正在加载…</p>
      <div v-else-if="!shown.length" class="empty">
        <div class="ei">▤</div>
        <div>还没有计算任务。点击「新建任务」开始一次 HQLA 判定。</div>
      </div>
      <table v-else class="tbl compact">
        <thead>
          <tr>
            <th>任务编号</th><th>任务名称</th><th>状态</th><th>进度</th>
            <th class="num">明细行数</th><th class="num">样本</th><th class="num">关卡一不合格</th>
            <th class="num">判定后 HQLA(千元)</th><th>更新于</th><th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="task in shown" :key="task.id" class="clickable" @click="open(task)">
            <td class="mono" style="font-size: 11px">{{ task.id }}</td>
            <td>
              <div style="font-weight: 600">{{ task.name }}</div>
              <div class="dim" style="font-size: 10.5px">{{ task.institution }} · 基准日 {{ task.baseDate }}</div>
            </td>
            <td><span class="tag" :class="(STATUS[task.status] || {}).tone || 'muted'">{{ (STATUS[task.status] || {}).label || task.status }}</span></td>
            <td>
              <div class="progress" style="width: 90px; margin-bottom: 3px"><i :style="{ width: progress(task).pct + '%' }"></i></div>
              <div class="dim" style="font-size: 10.5px">第 {{ progress(task).step }} / 7 步 · {{ progress(task).done }}/{{ progress(task).total }}</div>
            </td>
            <td class="num">{{ task.inputCount || "—" }}</td>
            <td class="num">{{ (task.sample && task.sample.size) || "—" }}</td>
            <td class="num">{{ task.summary ? task.summary.gate1Fail : "—" }}</td>
            <td class="num">{{ task.summary && task.summary.hqla != null ? num(task.summary.hqla / 1000) : "—" }}</td>
            <td class="dim" style="font-size: 10.5px; white-space: nowrap">{{ String(task.updatedAt || "").slice(5, 16) }}</td>
            <td @click.stop>
              <div style="display: flex; gap: 4px; flex-wrap: wrap">
                <button type="button" class="btn sm" @click="open(task)">打开</button>
                <button type="button" class="btn sm" @click="copy(task)">复制</button>
                <button type="button" class="btn sm" @click="exportOne(task)">导出</button>
                <button type="button" class="btn sm" @click="toggleArchive(task)">{{ task.status === "archived" ? "取消归档" : "归档" }}</button>
                <button type="button" class="btn sm danger" @click="remove(task)">删除</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
