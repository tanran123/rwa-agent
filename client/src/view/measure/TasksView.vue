<script setup>
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { createTask, deleteTask, fetchTasks, updateTask } from "@/api/tasks";
import { useContext } from "@/composables/useContext";
import AsyncView from "@/components/AsyncView.vue";
import { askConfirm } from "@/utils/confirm";

const router = useRouter();
const { session } = useContext();
const view = ref(null);
const error = ref("");
const busy = ref(false);
const form = ref(null);
const editingId = ref("");
const tasks = ref([]);
const filters = ref({ q: "", jurisdiction: "", version: "", institution: "", status: "", from: "", to: "" });

const TASK_STATUS = {
  draft: { label: "待开始", tone: "muted" },
  doing: { label: "进行中", tone: "warn" },
  done: { label: "已完成", tone: "ok" }
};

function versionsFor(code) {
  return session.versions.filter((item) => item.jurisdiction === code);
}

function orgsFor(code) {
  return session.orgs.filter((item) => item.jurisdiction === code);
}

function quarterName(value) {
  const parts = String(value || "").split("-");
  if (parts.length < 2 || !Number(parts[1])) return "信用风险计量任务";
  return parts[0] + " 年第 " + (Math.floor((Number(parts[1]) - 1) / 3) + 1) + " 季度信用风险计量";
}

function blankForm() {
  const code = session.jurisdiction || (session.jurisdictions[0] ? session.jurisdictions[0].code : "");
  const versions = versionsFor(code);
  const current = versions.find((item) => item.id === session.versionId)
    || versions.find((item) => item.status === "published")
    || versions[0];
  const orgs = orgsFor(code);
  const org = orgs.find((item) => item.id === session.orgId) || orgs[0];
  return {
    name: quarterName(session.baseDate),
    jurisdiction: code,
    versionId: current ? current.id : "",
    institution: org ? org.name : "",
    baseDate: session.baseDate || ""
  };
}

function onFormJurisdiction() {
  if (!form.value) return;
  const versions = versionsFor(form.value.jurisdiction);
  const orgs = orgsFor(form.value.jurisdiction);
  form.value.versionId = versions.length ? versions[0].id : "";
  form.value.institution = orgs.length ? orgs[0].name : "";
}

function openCreate() {
  error.value = "";
  editingId.value = "";
  form.value = null;
  router.push({ name: "task-create" });
}

function clearFilters() {
  filters.value = { q: "", jurisdiction: "", version: "", institution: "", status: "", from: "", to: "" };
}

const filterOptions = computed(() => ({
  jurisdictions: [...new Set(tasks.value.map((item) => item.jurisdiction).filter(Boolean))],
  versions: [...new Set(tasks.value.map((item) => item.version).filter(Boolean))],
  institutions: [...new Set(tasks.value.map((item) => item.institution).filter(Boolean))]
}));

const filteredTasks = computed(() => {
  const f = filters.value;
  const text = f.q.trim().toLowerCase();
  return tasks.value.filter((task) => {
    if (f.jurisdiction && task.jurisdiction !== f.jurisdiction) return false;
    if (f.version && task.version !== f.version) return false;
    if (f.institution && task.institution !== f.institution) return false;
    if (f.status && task.status !== f.status) return false;
    if (f.from && String(task.baseDate || "") < f.from) return false;
    if (f.to && String(task.baseDate || "") > f.to) return false;
    if (!text) return true;
    return [task.name, task.id, task.version, task.institution, task.jurisdiction, task.baseDate]
      .join(" ").toLowerCase().includes(text);
  });
});

const summary = computed(() => {
  const rows = filteredTasks.value;
  return {
    total: rows.length,
    doing: rows.filter((item) => item.status === "doing").length,
    done: rows.filter((item) => item.status === "done").length,
    draft: rows.filter((item) => item.status === "draft").length,
    ead: rows.reduce((sum, item) => sum + (Number(item.ead) || 0), 0),
    rwa: rows.reduce((sum, item) => sum + (Number(item.rwa) || 0), 0)
  };
});

function openEdit(task) {
  error.value = "";
  editingId.value = task.id;
  const version = session.versions.find((item) => item.jurisdiction === task.jurisdiction && item.version === task.version);
  form.value = {
    name: task.name,
    jurisdiction: task.jurisdiction,
    versionId: version ? version.id : "",
    institution: task.institution,
    baseDate: task.baseDate || ""
  };
}

async function load() {
  const rows = await fetchTasks();
  tasks.value = rows;
  return rows;
}

async function refresh() {
  if (view.value) await view.value.reload();
}

function shortMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e8) return (n / 1e8).toFixed(2) + " 亿";
  if (abs >= 1e4) return (n / 1e4).toFixed(2) + " 万";
  return n.toFixed(2);
}

function capitalPercent(task) {
  return task.capitalCount ? Math.round((task.archivedCount / task.capitalCount) * 100) : 0;
}

async function saveTask() {
  if (busy.value || !form.value) return;
  const data = form.value;
  const version = session.versions.find((item) => item.id === data.versionId);
  busy.value = true;
  error.value = "";
  try {
    if (editingId.value) {
      await updateTask(editingId.value, { name: data.name, baseDate: data.baseDate });
      form.value = null;
      editingId.value = "";
      await refresh();
    } else {
      const saved = await createTask({
        name: data.name,
        jurisdiction: data.jurisdiction,
        institution: data.institution,
        version: version ? version.version : "",
        baseDate: data.baseDate
      });
      form.value = null;
      editingId.value = "";
      router.push({ name: "task-detail", params: { id: saved.id } });
    }
  } catch (err) {
    error.value = err.message;
  } finally {
    busy.value = false;
  }
}

async function removeTask(task) {
  const ok = await askConfirm(`将删除主任务「${task.name}」及其全部子任务。已归档的计量批次仍保留在结果明细里。确定继续？`, {
    title: "删除主任务",
    danger: true
  });
  if (!ok) return;
  error.value = "";
  try {
    await deleteTask(task.id);
    await refresh();
  } catch (err) {
    error.value = err.message;
  }
}

function openTask(task) {
  router.push({ name: "task-detail", params: { id: task.id } });
}
</script>

<template>
  <p v-if="error" class="notice danger">{{ error }}</p>

  <p class="notice info">
    每个季度是一个主任务。主任务创建时固定监管规则版本和机构；任务清单统计两个工作模块的子任务数量和进度，
    点任务进入详情工作台，再在资本充足率或流动性模块下新增子任务。
  </p>

  <div class="task-summary">
    <div class="task-summary-item"><span>主任务</span><b>{{ summary.total }}</b><em>当前筛选</em></div>
    <div class="task-summary-item"><span>进行中</span><b>{{ summary.doing }}</b><em>有待办子任务</em></div>
    <div class="task-summary-item"><span>已完成</span><b>{{ summary.done }}</b><em>资本充足率全部归档</em></div>
    <div class="task-summary-item"><span>待开始</span><b>{{ summary.draft }}</b><em>还没有子任务</em></div>
    <div class="task-summary-item wide"><span>EAD / RWA</span><b>{{ shortMoney(summary.ead) }} / {{ shortMoney(summary.rwa) }}</b><em>只汇总当前筛选的已归档批次</em></div>
  </div>

  <div class="panel task-filters">
    <div class="panel-body">
      <div class="task-filter-row">
        <input v-model="filters.q" type="search" placeholder="搜索主任务名称 / ID / 机构" />
        <select v-model="filters.jurisdiction">
          <option value="">全部地区</option>
          <option v-for="item in filterOptions.jurisdictions" :key="item" :value="item">{{ item }}</option>
        </select>
        <select v-model="filters.version">
          <option value="">全部版本</option>
          <option v-for="item in filterOptions.versions" :key="item" :value="item">{{ item }}</option>
        </select>
        <select v-model="filters.institution">
          <option value="">全部机构</option>
          <option v-for="item in filterOptions.institutions" :key="item" :value="item">{{ item }}</option>
        </select>
        <select v-model="filters.status">
          <option value="">全部状态</option>
          <option value="draft">待开始</option>
          <option value="doing">进行中</option>
          <option value="done">已完成</option>
        </select>
        <input v-model="filters.from" type="date" title="基准日起" />
        <span class="dim">至</span>
        <input v-model="filters.to" type="date" title="基准日止" />
        <button type="button" class="btn sm" @click="clearFilters">清空筛选</button>
        <span class="spacer"></span>
        <span class="dim" style="font-size: 11.5px">显示 {{ filteredTasks.length }} / {{ tasks.length }}</span>
      </div>
    </div>
  </div>

  <div v-if="form" class="panel" style="margin-bottom: 14px">
    <div class="panel-head">
      <h3>{{ editingId ? "编辑主任务" : "新建主任务" }}</h3>
      <span class="sub">{{ editingId ? "监管版本、机构在创建时固定，只能改名称和基准日" : "监管版本和机构创建后固定，所有子任务继承" }}</span>
      <span class="spacer"></span>
      <button type="button" class="btn sm" @click="form = null">取消</button>
    </div>
    <div class="panel-body">
      <div class="grid c2">
        <div class="field">
          <label>主任务名称</label>
          <input v-model="form.name" type="text" placeholder="如：2026 年第 4 季度信用风险计量" />
        </div>
        <div class="field">
          <label>司法管辖区</label>
          <select v-model="form.jurisdiction" :disabled="!!editingId" @change="onFormJurisdiction">
            <option v-for="item in session.jurisdictions" :key="item.code" :value="item.code">{{ item.label }}</option>
          </select>
        </div>
        <div class="field">
          <label>监管规则版本</label>
          <select v-model="form.versionId" :disabled="!!editingId">
            <option v-for="item in versionsFor(form.jurisdiction)" :key="item.id" :value="item.id">
              {{ item.version }}{{ item.status && item.status !== "published" ? "（" + item.status + "）" : "" }}
            </option>
          </select>
        </div>
        <div class="field">
          <label>机构</label>
          <select v-model="form.institution" :disabled="!!editingId">
            <option v-for="item in orgsFor(form.jurisdiction)" :key="item.id" :value="item.name">{{ item.name }}</option>
          </select>
        </div>
        <div class="field">
          <label>计量基准日</label>
          <input v-model="form.baseDate" type="date" />
        </div>
      </div>
      <div style="margin-top: 12px">
        <button type="button" class="btn primary" :disabled="busy" @click="saveTask">
          {{ editingId ? "保存主任务" : "创建主任务" }}
        </button>
      </div>
    </div>
  </div>

  <AsyncView ref="view" :load="load">
    <template #default="{ data }">
      <div class="panel">
        <div class="panel-head">
          <h3>任务清单</h3>
          <span class="sub">{{ filteredTasks.length }} 个主任务 · 统计资本充足率和流动性子任务的数量与进度</span>
          <span class="spacer"></span>
          <button type="button" class="btn sm primary" @click="openCreate">新建主任务</button>
        </div>
        <div class="panel-body tight">
          <div v-if="!tasks.length" class="empty">
            <div class="ei">▤</div>
            <div>还没有主任务。点击「新建主任务」开始一个季度的计量。</div>
          </div>
          <div v-else-if="!filteredTasks.length" class="empty">
            <div class="ei">⌕</div>
            <div>没有符合条件的任务。换个关键词或清空筛选。</div>
          </div>
          <table v-else class="tbl compact">
            <thead>
              <tr>
                <th>主任务</th><th>监管版本 · 机构</th><th>状态</th>
                <th>资本充足率</th><th>流动性</th><th class="num">EAD</th><th class="num">RWA</th><th>更新时间</th><th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="task in filteredTasks" :key="task.id" class="clickable" @click="openTask(task)">
                <td>
                  <strong>{{ task.name }}</strong>
                  <div class="dim" style="font-size: 10.5px">{{ task.id }} · 基准日 {{ task.baseDate }}</div>
                </td>
                <td>
                  {{ task.version }}
                  <div class="dim" style="font-size: 10.5px">{{ task.institution }} · {{ task.jurisdiction }}</div>
                </td>
                <td>
                  <span class="tag" :class="(TASK_STATUS[task.status] || {}).tone || 'muted'">
                    {{ (TASK_STATUS[task.status] || {}).label || task.status }}
                  </span>
                </td>
                <td>
                  <div v-if="task.capitalCount" style="min-width: 110px">
                    <div class="dim" style="font-size: 11px">{{ task.archivedCount }} / {{ task.capitalCount }} 已归档 · {{ capitalPercent(task) }}%</div>
                    <div class="progress" :class="{ ok: capitalPercent(task) === 100 }">
                      <i :style="{ width: capitalPercent(task) + '%' }"></i>
                    </div>
                  </div>
                  <span v-else class="dim">未建子任务</span>
                </td>
                <td>
                  <div v-if="task.liquidityCount">{{ task.liquidityArchived || 0 }} / {{ task.liquidityCount }} 已归档</div>
                  <span v-else class="dim">未建子任务</span>
                  <div v-if="task.liquidityCount" class="dim" style="font-size: 10.5px">在 HQLA 任务执行</div>
                </td>
                <td class="num">{{ task.archivedCount ? shortMoney(task.ead) : "—" }}</td>
                <td class="num">{{ task.archivedCount ? shortMoney(task.rwa) : "—" }}</td>
                <td class="dim" style="font-size: 11px">{{ task.updatedAt || "—" }}</td>
                <td @click.stop>
                  <div style="display: flex; gap: 4px; flex-wrap: wrap">
                    <button type="button" class="btn sm primary" @click="openTask(task)">进入</button>
                    <button type="button" class="btn sm" @click="openEdit(task)">编辑</button>
                    <button type="button" class="btn sm danger" @click="removeTask(task)">删除</button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </AsyncView>
</template>
