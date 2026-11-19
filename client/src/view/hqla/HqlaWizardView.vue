<script setup>
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { getTask, reviewTask, updateTask } from "@/api/hqla";
import { fetchLiquidityMeta } from "@/api/liquidity";
import { useContext } from "@/composables/useContext";
import { auth } from "@/utils/auth";
import StepBasic from "./steps/StepBasic.vue";
import StepImport from "./steps/StepImport.vue";
import StepProduct from "./steps/StepProduct.vue";
import StepMapping from "./steps/StepMapping.vue";
import StepQuality from "./steps/StepQuality.vue";
import StepCalc from "./steps/StepCalc.vue";
import StepResult from "./steps/StepResult.vue";

const route = useRoute();
const router = useRouter();
const { session } = useContext();

const task = ref(null);
const meta = ref(null);
const loading = ref(true);
const error = ref("");

const STEPS = [
  { key: "basic", title: "基本信息", desc: "继承主任务和子任务信息，只读展示配置快照" },
  { key: "import", title: "Excel 数据导入", desc: "上传原始工作簿，按 Sheet 解析为数据集" },
  { key: "product", title: "产品自动识别", desc: "按数据集识别产品，低置信度人工确认" },
  { key: "mapping", title: "标准字段 Mapping", desc: "Excel 表头映射到产品标准字段" },
  { key: "quality", title: "数据质量检查", desc: "字段完整性、金额格式、重复与负值" },
  { key: "calc", title: "自动计量计算", desc: "HQLA、现金流入流出与 LCR 汇总" },
  { key: "result", title: "结果复核与输出", desc: "产品结果、单笔追溯与归档" }
];
const COMPONENTS = [StepBasic, StepImport, StepProduct, StepMapping, StepQuality, StepCalc, StepResult];

const STATUS = {
  draft: { label: "草稿", tone: "muted" },
  doing: { label: "进行中", tone: "warn" },
  done: { label: "已完成", tone: "ok" },
  archived: { label: "已归档", tone: "muted" }
};

const step = computed(() => Math.min(7, Math.max(1, Number(task.value && task.value.step) || 1)));
const stepComponent = computed(() => COMPONENTS[step.value - 1]);
const cfg = computed(() => (task.value && task.value.cfg) || {});
const datasets = computed(() => (task.value && task.value.datasets) || []);

const checks = computed(() => {
  const t = task.value;
  if (!t) return [];
  const list = t.datasets || [];
  const c = t.cfg || {};
  const quality = t.qualityRun;
  const run = t.currentRun;
  const qualityOk = !!(
    quality &&
    Number(quality.inputVersion) === Number(t.inputVersion) &&
    quality.status === "succeeded"
  );
  const runOk = !!(
    run &&
    ["succeeded", "partial_failed"].includes(run.status) &&
    Number(run.inputVersion) === Number(t.inputVersion)
  );
  const reviewed = t.reviewStatus === "reviewed" || !!(c.review && c.review.status === "reviewed");
  return [
    !!(c.ruleVersion && (c.snapshotId || c.snapshotLockedAt)),
    list.length > 0,
    !!(t.recognition && t.recognition.total > 0 && !t.recognition.pending && !t.recognition.unmatched && !t.recognition.conflict),
    !!(t.fieldMappingCount > 0 || list.some((item) => Object.keys(item.mapping || {}).length)),
    qualityOk,
    runOk,
    reviewed
  ];
});

const pct = computed(() => {
  if (!task.value) return 0;
  if (task.value.status === "done" || task.value.status === "archived") return 100;
  const current = step.value;
  return Math.round((((current - 1) + (checks.value[current - 1] ? 1 : 0.15)) / 7) * 100);
});

const summaryLine = computed(() => {
  const t = task.value;
  if (!t) return "";
  const rows = datasets.value.reduce((sum, item) => sum + (item.rows || []).length, 0);
  switch (step.value) {
    case 1: return cfg.value.ruleVersion ? `继承主任务版本 ${cfg.value.ruleVersion} · 输入版本 v${t.inputVersion || 1}` : "缺少主任务监管规则版本";
    case 2: return `${datasets.value.length} 个数据集 · ${rows.toLocaleString("zh-CN")} 行`;
    case 3: {
      const r = t.recognition || {};
      return `${r.confirmed || 0} / ${r.total || 0} 条记录已确认产品${r.pending ? " · 待确认 " + r.pending : ""}${r.unmatched ? " · 无法识别 " + r.unmatched : ""}${r.conflict ? " · 冲突 " + r.conflict : ""}`;
    }
    case 4: return `${t.fieldMappingCount || 0} 条字段对应已确认`;
    case 5: {
      const quality = t.qualityRun;
      if (!quality) return "待执行质量检查";
      const stale = Number(quality.inputVersion) !== Number(t.inputVersion);
      return `输入版本 v${quality.inputVersion}${stale ? "（已过期）" : ""} · 阻断 ${quality.summary ? quality.summary.block : 0} · 警告 ${quality.summary ? quality.summary.warn : 0}`;
    }
    case 6: {
      const run = t.currentRun;
      if (!run) return "待执行计算";
      return `批次 #${run.runNo} · ${run.status} · LCR ${run.metrics && run.metrics.lcr != null ? Number(run.metrics.lcr).toFixed(2) + "%" : "—"}`;
    }
    case 7: {
      const run = t.currentRun;
      if (!run) return "待计算";
      return `LCR ${run.metrics && run.metrics.lcr != null ? Number(run.metrics.lcr).toFixed(2) + "%" : "—"} · ${run.exceptionCount} 条异常 · ${t.reviewStatus || "未复核"}`;
    }
    default: return "";
  }
});

async function loadTask() {
  task.value = await getTask(route.params.id);
  const c = task.value.cfg || {};
  if (c.ruleVersion) {
    const target = (session.versions || []).find((item) => item.version === c.ruleVersion);
    if (target) {
      session.jurisdiction = target.jurisdiction;
      session.versionId = target.id;
    }
  }
  try {
    meta.value = await fetchLiquidityMeta(
      c.jurisdiction || session.jurisdiction || "HK",
      c.ruleVersion || ""
    );
  } catch (err) {
    meta.value = { products: [], versions: [], meta: null };
  }
}

async function reload() {
  error.value = "";
  try {
    await loadTask();
  } catch (err) {
    error.value = err.message;
  }
}

async function goStep(n) {
  if (!task.value) return;
  const target = Math.min(7, Math.max(1, n));
  if (target > step.value + 1) {
    for (let index = step.value; index < target - 1; index += 1) {
      if (!checks.value[index]) {
        error.value = `请先完成第 ${index + 1} 步：${STEPS[index].title}`;
        return;
      }
    }
  }
  if (target > step.value && target > 1 && !checks.value[target - 2]) {
    error.value = `请先完成第 ${target - 1} 步：${STEPS[target - 2].title}`;
    return;
  }
  error.value = "";
  await updateTask(task.value.id, { step: target, status: task.value.status === "draft" ? "doing" : task.value.status });
  await reload();
}

async function finish() {
  if (!task.value) return;
  const reviewer = auth.user ? auth.user.username : "";
  await reviewTask(task.value.id, { reviewer });
  router.push(task.value.rwaTaskId ? `/tasks/${task.value.rwaTaskId}` : "/tasks");
}

watch(() => route.params.id, reload);

onMounted(async () => {
  loading.value = true;
  try {
    await reload();
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <p v-if="error" class="notice danger">{{ error }}</p>

  <div v-if="loading" class="empty">正在加载任务…</div>

  <template v-else-if="task">
    <div class="lq-wizard-head">
      <div>
        <h2>{{ task.name }}</h2>
        <p>
          <span class="mono">{{ task.id }}</span> · {{ task.institution }} · 基准日 {{ task.baseDate }} ·
          规则版本 {{ cfg.ruleVersion || "—" }}
        </p>
      </div>
      <div class="lq-wizard-actions">
        <span class="tag" :class="(STATUS[task.status] || {}).tone || 'muted'">{{ (STATUS[task.status] || {}).label || task.status }}</span>
        <div class="lq-progress" style="width: 150px">
          <div class="lq-progress-bar"><i :style="{ width: pct + '%' }"></i></div>
          <span :class="{ ok: pct >= 100 }">{{ pct }}%</span>
        </div>
        <button type="button" class="btn sm" @click="router.push(task.rwaTaskId ? `/tasks/${task.rwaTaskId}` : '/tasks')">返回主任务</button>
      </div>
    </div>

    <p class="dim" style="font-size: 11.5px; margin: 0 0 8px">{{ summaryLine }}</p>

    <div class="panel lq-step-panel">
      <div class="panel-body">
        <div class="lq-steps">
          <button
            v-for="(item, index) in STEPS"
            :key="item.key"
            type="button"
            class="lq-step"
            :class="{ on: index + 1 === step, done: index + 1 < step }"
            :title="item.desc"
            @click="goStep(index + 1)"
          >
            <span class="n">{{ index + 1 < step ? "✓" : index + 1 }}</span>
            <span>{{ item.title }}</span>
          </button>
        </div>

        <div class="panel-head" style="margin-bottom: 10px">
          <h3>第 {{ step }} 步 · {{ STEPS[step - 1].title }}</h3>
          <span class="sub">{{ STEPS[step - 1].desc }}</span>
        </div>

        <component
          :is="stepComponent"
          :task="task"
          :meta="meta"
          :result="result"
          :reload="reload"
          :finish="finish"
        />
      </div>
    </div>

    <div class="lq-step-nav">
      <button type="button" class="btn" @click="step <= 1 ? router.push('/hqla') : goStep(step - 1)">
        {{ step <= 1 ? "← 返回任务列表" : "← 上一步：" + STEPS[step - 2].title }}
      </button>
      <span class="spacer"></span>
      <button v-if="step < 7" type="button" class="btn primary" @click="goStep(step + 1)">下一步：{{ STEPS[step].title }} →</button>
      <button v-else type="button" class="btn primary" :disabled="(task.cfg && task.cfg.review && task.cfg.review.status === 'reviewed')" @click="finish">
        {{ task.cfg && task.cfg.review && task.cfg.review.status === "reviewed" ? "已复核并归档" : "完成复核并归档" }}
      </button>
    </div>
  </template>
</template>

<style scoped>
.lq-wizard-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 8px; }
.lq-wizard-head h2 { margin: 0 0 4px; font-size: 18px; }
.lq-wizard-head p { margin: 0; color: var(--muted); font-size: 12.5px; }
.lq-wizard-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.lq-steps { display: flex; gap: 4px; flex-wrap: wrap; padding: 4px 0 12px; }
.lq-step {
  display: flex; align-items: center; gap: 6px;
  border: 1px solid transparent; background: none; border-radius: 8px;
  padding: 5px 8px; font-size: 12px; color: #64748b;
}
.lq-step:hover { background: #f8fafc; color: #334155; }
.lq-step .n {
  width: 21px; height: 21px; border-radius: 50%; background: #f1f5f9; color: #475569;
  display: inline-flex; align-items: center; justify-content: center; font-size: 10.5px; font-weight: 600;
}
.lq-step.on { background: #eef2ff; color: #3730a3; font-weight: 600; }
.lq-step.on .n { background: #4f46e5; color: #fff; }
.lq-step.done .n { background: #059669; color: #fff; }
.lq-step-panel { padding: 12px 16px; }
.lq-step-nav { display: flex; align-items: center; gap: 8px; margin-top: 12px; flex-wrap: wrap; }
.lq-progress { display: flex; align-items: center; gap: 6px; }
.lq-progress-bar { flex: 1; height: 7px; background: #eef2ff; border-radius: 6px; overflow: hidden; }
.lq-progress-bar i { display: block; height: 100%; background: #f59e0b; }
.lq-progress span { font-size: 10.5px; color: #b45309; }
.lq-progress span.ok { color: #047857; }
</style>
