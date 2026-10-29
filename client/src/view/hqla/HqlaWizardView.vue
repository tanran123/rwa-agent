<script setup>
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { computeTask, getTask, updateTask } from "@/api/hqla";
import { askConfirm } from "@/utils/confirm";
import StepInput from "./steps/StepInput.vue";
import StepLists from "./steps/StepLists.vue";
import StepConfig from "./steps/StepConfig.vue";
import StepSampling from "./steps/StepSampling.vue";
import StepFetch from "./steps/StepFetch.vue";
import StepCheck from "./steps/StepCheck.vue";
import StepRecon from "./steps/StepRecon.vue";

const route = useRoute();
const router = useRouter();

const task = ref(null);
const result = ref(null);
const loading = ref(true);
const error = ref("");
const computing = ref(false);

const STEPS = [
  { n: 1, title: "明细全量数据导入", desc: "导入客户提供的债券明细全量清单" },
  { n: 2, title: "内部基础参数清单", desc: "交易账簿、回购台账、关联方、政策性银行、结构性债、RMBS 批准" },
  { n: 3, title: "判定标准配置", desc: "关卡一排除项、关卡二分档、关卡三上限" },
  { n: 4, title: "抽样策略配置", desc: "全量 / 属性抽样 / 固定样本量，生成样本清单" },
  { n: 5, title: "外部数据获取", desc: "按抽样清单逐只抓取评级、风险权重、价格" },
  { n: 6, title: "逐笔核对与追溯", desc: "关卡一 / 关卡二判定与完整证据链" },
  { n: 7, title: "汇总重编与对账", desc: "Level × 币种加权、组合上限、与申报数对账" }
];

const STATUS = {
  draft: { label: "草稿", tone: "muted" },
  doing: { label: "进行中", tone: "warn" },
  done: { label: "已完成", tone: "ok" },
  archived: { label: "已归档", tone: "muted" }
};

const step = computed(() => Math.min(7, Math.max(1, Number(task.value && task.value.step) || 1)));
const stepComponent = computed(() => [StepInput, StepLists, StepConfig, StepSampling, StepFetch, StepCheck, StepRecon][step.value - 1]);

const checks = computed(() => {
  const t = task.value;
  if (!t) return [];
  return [
    !!(t.input && t.input.rows && t.input.rows.length),
    !!(t.lists && Object.keys(t.lists).some((key) => (t.lists[key].rows || []).length)),
    !!(t.cfg && t.cfg.rules && t.cfg.rules.length),
    !!(t.sample && t.sample.size),
    !!(t.fetchLog && t.fetchLog.length),
    !!t.runAt,
    !!t.summary
  ];
});

const pct = computed(() => {
  const t = task.value;
  if (!t) return 0;
  if (t.status === "done") return 100;
  const current = step.value;
  return Math.round((((current - 1) + (checks.value[current - 1] ? 1 : 0.15)) / 7) * 100);
});

const summaryLine = computed(() => {
  const t = task.value;
  if (!t) return "";
  const rows = (t.input && t.input.rows) || [];
  switch (step.value) {
    case 1: return rows.length ? `明细 ${rows.length} 行 · 合计 ${rows.reduce((a, r) => a + (r.amount || 0), 0).toLocaleString("zh-CN", { maximumFractionDigits: 0 })} 港元` : "尚未导入明细";
    case 2: return `明细 ${rows.length} 行 · 已载入清单 ${Object.keys(t.lists || {}).filter((k) => (t.lists[k].rows || []).length).length} 类`;
    case 3: return `启用规则 ${((t.cfg && t.cfg.rules) || []).filter((r) => r.enabled !== false).length} 条`;
    case 4: return t.sample ? `样本 ${t.sample.size} / ${t.sample.universe} 笔 · 种子 ${t.sample.seed}` : `待抽样 · 总体 ${rows.length} 行`;
    case 5: {
      const log = t.fetchLog || [];
      return log.length ? `已抓取 ${log.length} 笔 · 命中 ${log.filter((x) => x.status === "命中").length} 笔` : `待抓取 ${t.sample ? t.sample.size : 0} 笔`;
    }
    case 6: {
      const rows6 = (result.value && result.value.sampleRows) || [];
      return `样本 ${rows6.length} 笔 · 异常 ${rows6.filter((r) => r.status === "fail").length} · 关注 ${rows6.filter((r) => r.status === "warn").length}`;
    }
    case 7: return result.value && result.value.caps ? `最终 HQLA ${Math.round(result.value.caps.after.total / 1000).toLocaleString("zh-CN")} 千元` : "—";
    default: return "";
  }
});

function taskSig(t) {
  return JSON.stringify({
    n: (t.input && t.input.rows ? t.input.rows.length : 0),
    l: Object.keys(t.lists || {}).filter((k) => ((t.lists[k] || {}).rows || []).length).length,
    s: t.sample ? t.sample.size : 0,
    v: (t.cfg && t.cfg.standardVersion) || "",
    k: !!(t.cfg && t.cfg.locked),
    r: ((t.cfg && t.cfg.rules) || []).length
  });
}

const frozenStale = computed(() => {
  const t = task.value;
  return !!(t && t.frozenAt && t.frozenSig && t.frozenSig !== taskSig(t));
});

async function loadTask() {
  task.value = await getTask(route.params.id);
}

async function recompute() {
  if (!task.value) return;
  computing.value = true;
  try {
    result.value = await computeTask(task.value.id);
  } catch (err) {
    error.value = err.message;
  } finally {
    computing.value = false;
  }
}

async function reload() {
  error.value = "";
  try {
    await loadTask();
    await recompute();
  } catch (err) {
    error.value = err.message;
  }
}

async function goStep(n) {
  if (n > step.value && n > 1 && !checks.value[n - 2]) {
    let need = n - 1;
    for (let i = 0; i < n - 1; i += 1) {
      if (!checks.value[i]) { need = i + 1; break; }
    }
    error.value = `请先完成第 ${need} 步：${STEPS[need - 1].title}`;
    return;
  }
  await updateTask(task.value.id, { step: n });
  await reload();
}

async function finish() {
  if (!result.value) return;
  const t = task.value;
  const summary = {
    securities: result.value.stats ? result.value.stats.securities : 0,
    gate1Fail: result.value.stats ? result.value.stats.gate1Fail : 0,
    fail: result.value.stats ? result.value.stats.fail : 0,
    warn: result.value.stats ? result.value.stats.warn : 0,
    hqla: result.value.caps ? result.value.caps.before.total : 0,
    reported: result.value.agg ? result.value.agg.totals.weighted : null,
    diff: result.value.recon ? result.value.recon.summary.diff : null
  };
  const nextSig = taskSig(t);
  await updateTask(t.id, {
    status: "done",
    step: 7,
    summary,
    runAt: result.value.runAt,
    frozenAt: new Date().toISOString().replace("T", " ").slice(0, 19),
    frozenSig: nextSig
  });
  router.push("/hqla");
}

async function unfreeze() {
  const ok = await askConfirm("将清除冻结状态并按当前数据重算，原冻结结论会被覆盖。确定继续？", { title: "重新计算" });
  if (!ok) return;
  await updateTask(task.value.id, { status: "doing", frozenAt: null, frozenSig: null });
  await reload();
}

async function next() {
  if (step.value === 7) return finish();
  await goStep(step.value + 1);
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
    <div style="display: flex; gap: 14px; align-items: center; flex-wrap: wrap; margin-bottom: 10px">
      <span class="tag" :class="(STATUS[task.status] || {}).tone || 'muted'">{{ (STATUS[task.status] || {}).label || task.status }}</span>
      <span class="dim" style="font-size: 11.5px">{{ task.id }} · {{ task.institution }} · 基准日 {{ task.baseDate }}</span>
      <span class="dim" style="font-size: 11.5px">{{ summaryLine }}</span>
      <span class="spacer"></span>
      <div class="progress" style="width: 160px"><i :style="{ width: pct + '%' }"></i></div>
      <span class="dim" style="font-size: 11px">{{ pct }}%</span>
      <button type="button" class="btn sm" @click="router.push('/hqla')">返回任务清单</button>
    </div>

    <div v-if="frozenStale" class="notice warn" style="margin-bottom: 10px">
      结论已冻结，但数据或判定标准已变更。冻结时间 {{ task.frozenAt }}；如需更新结论，请点击「重新计算」。
      <button type="button" class="btn sm" style="margin-left: 8px" @click="unfreeze">重新计算</button>
    </div>

    <div class="panel">
      <div class="panel-head">
        <h3>{{ task.name }}</h3>
        <span class="sub">第 {{ step }} / 7 步 · {{ STEPS[step - 1].desc }}</span>
      </div>
      <div class="panel-body">
        <div class="steps">
          <div
            v-for="item in STEPS"
            :key="item.n"
            class="step"
            :class="{ active: item.n === step, done: item.n < step }"
            :title="item.desc"
            @click="goStep(item.n)"
          >
            <span class="sn">{{ item.n < step ? "✓" : item.n }}</span>
            <span>{{ item.title }}</span>
          </div>
        </div>

        <p v-if="computing" class="dim" style="font-size: 11.5px">正在计算…</p>

        <component
          :is="stepComponent"
          :task="task"
          :result="result"
          :reload="reload"
        />
      </div>
    </div>

    <div style="display: flex; gap: 8px; align-items: center; margin-top: 14px">
      <button type="button" class="btn" :disabled="step <= 1" @click="goStep(step - 1)">上一步</button>
      <button type="button" class="btn-primary" @click="next">
        {{ step === 7 ? "完成任务" : `下一步：${STEPS[step].title}` }}
      </button>
      <span class="spacer"></span>
      <span v-if="step === 1" class="dim" style="font-size: 11px">导入后点击「下一步」继续</span>
    </div>
  </template>
</template>
