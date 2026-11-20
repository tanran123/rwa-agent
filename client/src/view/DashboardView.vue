<script setup>
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { fetchDashboard } from "@/api/dashboard";
import { useContext } from "@/composables/useContext";
import AsyncView from "@/components/AsyncView.vue";

const router = useRouter();
const { session, currentVersion } = useContext();
const view = ref(null);

const configEntries = [
  { no: "1", name: "监管规则版本", path: "/versions", desc: "版本信息、监管条款库、发布与配置快照。资本充足率和流动性的配置都挂在某一版下面。", meta: "先选版本" },
  { no: "2", name: "产品标准字段", path: "/product-config", desc: "产品注册、标准字段和字段映射，决定每条规则读取哪些字段。", meta: "规则输入" },
  { no: "3", name: "敞口划分", path: "/exposure-config", desc: "规则全景、分类矩阵和 JSON 配置：暴露分类、风险权重、参数表和监管名单。", meta: "分类与权重" },
  { no: "4", name: "EAD 计算规则", path: "/ead", desc: "按产品配置表内或表外 EAD 公式，同一产品二者互斥。", meta: "逐产品配置" },
  { no: "5", name: "信用风险缓释", path: "/crm-config", desc: "按产品绑定缓释字段，并维护合格缓释物字典。", meta: "缓释认定" },
  { no: "6", name: "流动性产品管理", path: "/liquidity-config", desc: "当前 LCR 规则版本下的产品、标准字段、规则包和清单参数。", meta: "LCR 配置" }
];

const calcEntries = [
  { no: "1", name: "任务工作台", path: "/tasks", desc: "按季度查看主任务，统计资本充足率和流动性子任务的数量与进度。", meta: "全部任务" },
  { no: "2", name: "新建主任务", path: "/tasks/new", desc: "选择季度、监管版本和机构，检查规则配置后创建主任务和初始子任务。", meta: "创建入口" },
  { no: "3", name: "计量批次管理", path: "/batches", desc: "每次计量生成的批次固定当时的规则版本，历史批次不随规则改动。", meta: "批次留痕" }
];

const versionLabels = { draft: "草稿", published: "已发布", superseded: "已被取代", disabled: "已停用" };
const taskStatus = {
  draft: { label: "待开始", tone: "muted" },
  doing: { label: "进行中", tone: "warn" },
  done: { label: "已完成", tone: "ok" }
};

const jurLabel = computed(() => {
  const hit = session.jurisdictions.find((item) => item.code === session.jurisdiction);
  return hit ? hit.label : session.jurisdiction;
});

const currentStatus = computed(() => {
  const version = currentVersion.value;
  if (!version) return "";
  return versionLabels[version.status] || version.status;
});

const tasks = computed(() => {
  const rows = view.value && view.value.tasks ? view.value.tasks : [];
  return rows.filter((task) => task.jurisdiction === session.jurisdiction);
});

const taskStats = computed(() => {
  const list = tasks.value;
  const subs = list.reduce((all, task) => all.concat(task.subs || []), []);
  const capital = subs.filter((sub) => sub.module !== "liquidity");
  const liquidity = subs.filter((sub) => sub.module === "liquidity");
  const archived = capital.filter((sub) => sub.status === "archived" || sub.status === "done");
  return {
    total: list.length,
    doing: list.filter((task) => task.status === "doing").length,
    done: list.filter((task) => task.status === "done").length,
    subs: subs.length,
    capital: capital.length,
    archived: archived.length,
    liquidity: liquidity.length,
    recent: list.slice(0, 6)
  };
});

const latestBatch = computed(() => {
  const rows = view.value && view.value.batches ? view.value.batches : [];
  const mine = rows.filter((row) => row.jurisdiction === session.jurisdiction);
  return mine[0] || null;
});

function go(path) {
  router.push(path);
}

async function load() {
  const data = await fetchDashboard();
  view.value = data;
  return data;
}
</script>

<template>
  <AsyncView :load="load">
    <template #default="{ data }">
      <div class="grid c4" style="margin-bottom: 16px">
        <div class="kpi accent">
          <div class="k-label">监管版本</div>
          <div class="k-value sm">{{ (currentVersion || {}).version || "—" }}</div>
          <div class="k-foot">{{ jurLabel }}<span v-if="currentStatus"> · {{ currentStatus }}</span></div>
        </div>
        <div class="kpi">
          <div class="k-label">规则节点</div>
          <div class="k-value">{{ data.nodeCount }}</div>
          <div class="k-foot">{{ data.topRules }} 个顶层分类</div>
        </div>
        <div class="kpi">
          <div class="k-label">标准字段</div>
          <div class="k-value">{{ data.fieldCount }}</div>
          <div class="k-foot">规则判断的统一输入</div>
        </div>
        <div class="kpi">
          <div class="k-label">主任务</div>
          <div class="k-value">{{ taskStats.total }}</div>
          <div class="k-foot">进行中 {{ taskStats.doing }} · 已完成 {{ taskStats.done }}</div>
        </div>
      </div>

      <section class="panel">
        <div class="panel-head">
          <h3>一、监管要求配置</h3>
          <span class="sub">先配齐并发布一个监管版本，计量才有依据</span>
          <span class="spacer"></span>
          <button type="button" class="btn sm" @click="go('/versions')">进入规则配置</button>
        </div>
        <div class="panel-body">
          <p class="dash-lead">配置按菜单顺序走，越靠前越基础：先在监管规则版本里选定这一版，再配产品标准字段和敞口划分，然后配 EAD 和信用风险缓释，最后配流动性产品。同一版本可以反复改草稿；校验通过并发布后版本只读，任务计算只认已发布的配置快照。</p>
          <div v-if="!currentVersion" class="notice warn">
            <span class="ni">!</span>
            <span>当前还没有可用的监管规则版本。先新建一版并配齐规则，才能创建任务。</span>
          </div>
          <div v-else-if="currentVersion.status !== 'published'" class="notice warn">
            <span class="ni">!</span>
            <span>当前版本 {{ currentVersion.version }} 还是{{ currentStatus }}：校验并发布后，任务工作台才能创建主任务。</span>
          </div>
          <div class="grid c3 entry-grid">
            <button v-for="entry in configEntries" :key="entry.path" type="button" class="entry-card" @click="go(entry.path)">
              <span class="entry-head">
                <span class="entry-no">{{ entry.no }}</span>
                <span class="entry-name">{{ entry.name }}</span>
              </span>
              <span class="entry-desc">{{ entry.desc }}</span>
              <span class="entry-foot">
                <span class="tag muted">{{ entry.meta }}</span>
                <span class="entry-go">进入 →</span>
              </span>
            </button>
          </div>
        </div>
      </section>

      <section class="panel">
        <div class="panel-head">
          <h3>二、任务计算</h3>
          <span class="sub">按季度建主任务，再把底稿跑成批次<span v-if="latestBatch"> · 最近批次 {{ latestBatch.name }}</span></span>
          <span class="spacer"></span>
          <button type="button" class="btn sm primary" @click="go('/tasks/new')">新建主任务</button>
        </div>
        <div class="panel-body">
          <p class="dash-lead">在任务工作台按季度新建主任务，创建时固定监管版本和机构，之后只改名称和基准日。任务详情里分别新增资本充足率和流动性子任务：资本充足率子任务进入计量向导上传底稿，流动性子任务打开 LCR 任务，计算完成的批次自动归档回对应子任务。</p>
          <div class="stat-strip">
            <div><b>{{ taskStats.total }}</b><span>主任务</span></div>
            <div><b>{{ taskStats.subs }}</b><span>子任务</span></div>
            <div><b>{{ taskStats.archived }}/{{ taskStats.capital }}</b><span>资本充足率已归档</span></div>
            <div><b>{{ taskStats.liquidity }}</b><span>流动性子任务</span></div>
          </div>
          <div class="grid c3 entry-grid">
            <button v-for="entry in calcEntries" :key="entry.path" type="button" class="entry-card" @click="go(entry.path)">
              <span class="entry-head">
                <span class="entry-no">{{ entry.no }}</span>
                <span class="entry-name">{{ entry.name }}</span>
              </span>
              <span class="entry-desc">{{ entry.desc }}</span>
              <span class="entry-foot">
                <span class="tag muted">{{ entry.meta }}</span>
                <span class="entry-go">进入 →</span>
              </span>
            </button>
          </div>
        </div>
      </section>

      <section class="panel" style="margin-bottom: 0">
        <div class="panel-head">
          <h3>最近任务</h3>
          <span v-if="taskStats.recent.length" class="sub">按更新时间列出最近 {{ taskStats.recent.length }} 个主任务</span>
          <span v-else class="sub">还没有主任务</span>
          <span class="spacer"></span>
          <button type="button" class="btn sm ghost" @click="go('/tasks')">全部任务</button>
        </div>
        <div class="panel-body tight">
          <table v-if="taskStats.recent.length" class="tbl compact">
            <thead>
              <tr><th>任务名称</th><th>基准日</th><th>版本</th><th>机构</th><th class="num">资本充足率</th><th class="num">流动性</th><th>状态</th><th>更新时间</th></tr>
            </thead>
            <tbody>
              <tr v-for="task in taskStats.recent" :key="task.id" class="clickable" @click="go('/tasks/' + task.id)">
                <td>{{ task.name }}</td>
                <td>{{ task.baseDate }}</td>
                <td>{{ task.version }}</td>
                <td>{{ task.institution }}</td>
                <td class="num">{{ task.archivedCount }}/{{ task.capitalCount }}</td>
                <td class="num">{{ task.liquidityCount || "—" }}</td>
                <td>
                  <span class="tag" :class="(taskStatus[task.status] || {}).tone">{{ (taskStatus[task.status] || {}).label || task.status }}</span>
                </td>
                <td class="dim">{{ task.updatedAt }}</td>
              </tr>
            </tbody>
          </table>
          <div v-else class="empty">
            <div class="ei">◎</div>
            <div>还没有主任务。先完成监管要求配置并发布，再按季度新建主任务。</div>
            <div class="btn-group" style="justify-content: center; margin-top: 12px">
              <button type="button" class="btn sm primary" @click="go('/tasks/new')">新建主任务</button>
            </div>
          </div>
        </div>
      </section>
    </template>
  </AsyncView>
</template>

<style scoped>
#auditBody .dash-lead {
  margin: 0 0 14px;
  max-width: 900px;
  font-size: 12.5px;
  color: var(--muted);
  line-height: 1.75;
}
.entry-grid {
  margin-top: 4px;
}
.panel-body .notice {
  margin-bottom: 14px;
}
.entry-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  padding: 14px 16px;
  text-align: left;
  font: inherit;
  color: inherit;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 12px;
  cursor: pointer;
  transition: border-color .15s ease, box-shadow .15s ease, transform .15s ease;
}
.entry-card:hover {
  border-color: #9dc4b5;
  box-shadow: var(--shadow);
  transform: translateY(-1px);
}
.entry-card:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.entry-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.entry-no {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  flex: none;
  border-radius: 50%;
  background: var(--accent-soft);
  color: #134e3a;
  font-size: 11px;
  font-weight: 700;
}
.entry-name {
  font-size: 13.5px;
  font-weight: 650;
}
.entry-desc {
  font-size: 12px;
  color: var(--muted);
  line-height: 1.6;
}
.entry-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: auto;
}
.entry-go {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--accent);
}
.stat-strip {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 14px;
}
.stat-strip > div {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 12px;
  background: #f8fafc;
  border: 1px solid var(--border);
  border-radius: 10px;
}
.stat-strip b {
  font-size: 17px;
  font-weight: 700;
  letter-spacing: -.02em;
  line-height: 1.3;
}
.stat-strip span {
  font-size: 11px;
  color: var(--muted);
}
@media (max-width: 1000px) {
  #auditBody .entry-grid.entry-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 720px) {
  #auditBody .entry-grid.entry-grid,
  .stat-strip {
    grid-template-columns: 1fr;
  }
}
</style>
