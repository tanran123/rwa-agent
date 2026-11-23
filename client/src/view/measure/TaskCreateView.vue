<script setup>
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { createTask, fetchTaskReadiness } from "@/api/tasks";
import { useContext } from "@/composables/useContext";

const router = useRouter();
const { session, loadBootstrap } = useContext();

const step = ref(1);
const form = ref({ name: "", jurisdiction: "", versionId: "", institution: "", baseDate: "" });
const readiness = ref(null);
const loadingReadiness = ref(false);
const loadingVersions = ref(false);
const versionChoices = ref([]);
const versionCheckError = ref("");
let versionCheckToken = 0;
const saving = ref(false);
const error = ref("");
const includeCapital = ref(true);
const includeLiquidity = ref(true);
const capitalName = ref("资本充足率计量");
const liquidityName = ref("流动性计量");

const STEPS = ["基本信息", "规则配置检查", "初始子任务"];

function versionsFor(code) {
  return (session.versions || []).filter((item) => item.jurisdiction === code);
}

function orgsFor(code) {
  return (session.orgs || []).filter((item) => item.jurisdiction === code);
}

function quarterName(value) {
  const parts = String(value || "").split("-");
  if (parts.length < 2 || !Number(parts[1])) return "信用风险计量任务";
  return parts[0] + " 年第 " + (Math.floor((Number(parts[1]) - 1) / 3) + 1) + " 季度信用风险计量";
}

const selectedVersion = computed(() => (session.versions || []).find((item) => item.id === form.value.versionId) || null);
const selectedOrg = computed(() => orgsFor(form.value.jurisdiction).find((item) => item.name === form.value.institution) || null);
const eadReady = computed(() => {
  const ead = readiness.value && readiness.value.ead;
  return !!ead && ead.neededCount > 0 && ead.readyCount === ead.neededCount;
});
const crmReady = computed(() => {
  const crm = readiness.value && readiness.value.crm;
  return !!crm && (crm.neededCount === 0 || crm.readyCount === crm.neededCount);
});
const liquidityReady = computed(() => {
  const liquidity = readiness.value && readiness.value.liquidity;
  return !!liquidity && liquidity.usableCount > 0 && liquidity.tableCount > 0 && liquidity.paramCount > 0 && liquidity.listCount > 0;
});
const crmNeededCount = computed(() => (readiness.value && readiness.value.crm ? readiness.value.crm.neededCount : 0));
const liquidityPartial = computed(() => {
  const liquidity = readiness.value && readiness.value.liquidity;
  return !!liquidity && liquidity.productCount > 0 && liquidity.usableCount > 0 && liquidity.usableCount < liquidity.productCount;
});
const liquidityMissingCount = computed(() => {
  const liquidity = readiness.value && readiness.value.liquidity;
  return liquidity ? Math.max(0, liquidity.productCount - liquidity.usableCount) : 0;
});

const VERSION_STATUS_TEXT = {
  draft: "草稿",
  reviewing: "审核中",
  published: "已发布",
  superseded: "已取代",
  disabled: "已停用"
};

function versionReason(version, read) {
  if (!version) return "版本不存在";
  if (version.status === "superseded") return "已取代";
  if (version.status === "disabled") return "已停用";
  if (version.status !== "published") {
    const base = "未发布（" + (VERSION_STATUS_TEXT[version.status] || version.status) + "）";
    const issues = (read && read.issues ? read.issues : [])
      .filter((text) => !/版本未发布|正式配置快照/.test(text))
      .slice(0, 1);
    return issues.length ? base + " · " + issues[0] : base;
  }
  if (!read || !read.snapshotId) return "无正式快照";
  if (!read.ok) return (read.issues && read.issues[0]) || "规则配置不完整";
  return "";
}

const usableVersionCount = computed(() => versionChoices.value.filter((item) => item.state === "usable").length);
const hasUsableVersion = computed(() => usableVersionCount.value > 0);
const versionCheckFailed = computed(() =>
  !loadingVersions.value
  && !hasUsableVersion.value
  && versionChoices.value.some((item) => item.state === "check_failed")
);

async function readinessWithRetry(version, code) {
  try {
    return await fetchTaskReadiness(version, code);
  } catch (first) {
    await new Promise((resolve) => setTimeout(resolve, 300));
    return fetchTaskReadiness(version, code);
  }
}

async function loadVersionChoices(code, preferredId = "") {
  const token = ++versionCheckToken;
  loadingVersions.value = true;
  versionCheckError.value = "";
  versionChoices.value = [];
  form.value.versionId = "";
  const versions = versionsFor(code);
  try {
    const reads = await Promise.all(versions.map(async (version) => {
      try {
        const read = await readinessWithRetry(version.version, code);
        const reason = versionReason(version, read);
        return {
          version,
          read,
          state: reason ? "unavailable" : "usable",
          reason,
          error: ""
        };
      } catch (err) {
        return {
          version,
          read: null,
          state: "check_failed",
          reason: "检查失败",
          error: err.message || "Network Error"
        };
      }
    }));
    if (token !== versionCheckToken) return;
    versionChoices.value = reads;
    const usable = reads.filter((item) => item.state === "usable");
    if (!usable.length && reads.some((item) => item.state === "check_failed")) {
      versionCheckError.value = "版本可用性检查未完成，请重试检查";
    }
    const preferred = usable.find((item) => item.version.id === preferredId)
      || usable.find((item) => item.version.id === session.versionId)
      || usable[0];
    form.value.versionId = preferred ? preferred.version.id : "";
  } finally {
    if (token === versionCheckToken) loadingVersions.value = false;
  }
}

function retryVersionCheck() {
  readiness.value = null;
  loadVersionChoices(form.value.jurisdiction, form.value.versionId);
}

async function initialForm() {
  const code = session.jurisdiction || (session.jurisdictions[0] ? session.jurisdictions[0].code : "");
  const orgs = orgsFor(code);
  const org = orgs.find((item) => item.id === session.orgId) || orgs[0];
  form.value = {
    name: quarterName(session.baseDate),
    jurisdiction: code,
    versionId: "",
    institution: org ? org.name : "",
    baseDate: session.baseDate || new Date().toISOString().slice(0, 10)
  };
  await loadVersionChoices(code, session.versionId);
}

async function onJurisdiction() {
  const orgs = orgsFor(form.value.jurisdiction);
  form.value.institution = orgs[0] ? orgs[0].name : "";
  readiness.value = null;
  await loadVersionChoices(form.value.jurisdiction);
}

function onBaseDate(value) {
  form.value.baseDate = value;
  if (!form.value.name || /季度信用风险计量$/.test(form.value.name)) form.value.name = quarterName(value);
}

async function checkReadiness() {
  const version = selectedVersion.value;
  if (!version) {
    error.value = "请先选择监管规则版本";
    return false;
  }
  loadingReadiness.value = true;
  error.value = "";
  try {
    readiness.value = await fetchTaskReadiness(version.version, form.value.jurisdiction);
    return readiness.value.ok;
  } catch (err) {
    error.value = err.message || "规则配置检查失败";
    readiness.value = null;
    return false;
  } finally {
    loadingReadiness.value = false;
  }
}

async function next() {
  error.value = "";
  if (step.value === 1) {
    if (!form.value.name.trim()) { error.value = "请填写主任务名称"; return; }
    if (!form.value.jurisdiction) { error.value = "请选择司法管辖区"; return; }
    if (!selectedVersion.value) {
      error.value = versionCheckFailed.value
        ? "版本可用性检查失败，请先重试检查"
        : "当前辖区没有可用的监管规则版本，请先完成规则配置和发布";
      return;
    }
    if (!form.value.institution) { error.value = "请选择机构"; return; }
    if (!form.value.baseDate) { error.value = "请填写计量基准日"; return; }
    step.value = 2;
    await checkReadiness();
    return;
  }
  if (step.value === 2) {
    if (!readiness.value || !readiness.value.ok) {
      error.value = "规则配置不完整，不能继续创建主任务";
      return;
    }
    step.value = 3;
  }
}

function back() {
  error.value = "";
  if (step.value > 1) step.value -= 1;
}

async function create() {
  if (saving.value) return;
  if (!readiness.value || !readiness.value.ok) {
    error.value = "请先通过规则配置检查";
    step.value = 2;
    return;
  }
  const subtasks = [];
  if (includeCapital.value) subtasks.push({ name: capitalName.value.trim() || "资本充足率计量", module: "capital" });
  if (includeLiquidity.value) subtasks.push({ name: liquidityName.value.trim() || "流动性计量", module: "liquidity" });
  saving.value = true;
  error.value = "";
  try {
    const version = selectedVersion.value;
    const saved = await createTask({
      name: form.value.name.trim(),
      jurisdiction: form.value.jurisdiction,
      institution: form.value.institution,
      version: version ? version.version : "",
      baseDate: form.value.baseDate,
      subtasks
    });
    router.push({ name: "task-detail", params: { id: saved.id } });
  } catch (err) {
    error.value = err.message;
  } finally {
    saving.value = false;
  }
}

onMounted(async () => {
  if (!session.ready) await loadBootstrap();
  await initialForm();
});
</script>

<template>
  <div class="task-create">
    <div class="task-create-head">
      <button type="button" class="btn sm" @click="router.push('/tasks')">← 返回任务工作台</button>
    </div>

    <div class="task-create-steps">
      <div v-for="(label, index) in STEPS" :key="label" class="task-create-step" :class="{ active: step === index + 1, done: step > index + 1 }">
        <span class="sn">{{ step > index + 1 ? "✓" : index + 1 }}</span>
        <span>{{ label }}</span>
        <span v-if="index < STEPS.length - 1" class="arrow">›</span>
      </div>
    </div>

    <p v-if="error" class="notice danger">{{ error }}</p>

    <div v-if="step === 1" class="panel">
      <div class="panel-head">
        <h3>第一步：基本信息</h3>
        <span class="sub">名称、地区和版本决定这次计量任务的范围</span>
      </div>
      <div class="panel-body">
        <div class="grid c2">
          <label class="field">主任务名称
            <input v-model="form.name" type="text" placeholder="如：2026 年第 4 季度信用风险计量" />
          </label>
          <label class="field">计量基准日
            <input :value="form.baseDate" type="date" @input="onBaseDate($event.target.value)" />
          </label>
          <label class="field">司法管辖区
            <select v-model="form.jurisdiction" @change="onJurisdiction">
              <option v-for="item in session.jurisdictions" :key="item.code" :value="item.code">{{ item.label }}</option>
            </select>
          </label>
          <label class="field">监管规则版本
            <select v-model="form.versionId" :disabled="loadingVersions" @change="readiness = null">
              <option value="" disabled>{{ loadingVersions ? "正在检查可用版本…" : "请选择可用监管规则版本" }}</option>
              <optgroup label="可用版本">
                <option v-for="item in versionChoices.filter((entry) => entry.state === 'usable')" :key="item.version.id" :value="item.version.id">
                  {{ item.version.version }} · 已发布 · 规则完整
                </option>
              </optgroup>
              <optgroup v-if="versionChoices.some((entry) => entry.state === 'unavailable')" label="不可用版本">
                <option v-for="item in versionChoices.filter((entry) => entry.state === 'unavailable')" :key="item.version.id" :value="item.version.id" disabled>
                  {{ item.version.version }} · {{ item.reason }}
                </option>
              </optgroup>
              <optgroup v-if="versionChoices.some((entry) => entry.state === 'check_failed')" label="检查失败">
                <option v-for="item in versionChoices.filter((entry) => entry.state === 'check_failed')" :key="item.version.id" :value="item.version.id" disabled>
                  {{ item.version.version }} · {{ item.reason }}：{{ item.error }}
                </option>
              </optgroup>
            </select>
            <span v-if="versionCheckError" class="hint">
              {{ versionCheckError }}
              <button type="button" class="btn xs" style="margin-left: 6px" :disabled="loadingVersions" @click="retryVersionCheck">重试检查</button>
            </span>
            <span v-else-if="!loadingVersions && !hasUsableVersion" class="hint">当前辖区没有可用版本，请先在监管规则维护工作台完成配置、校验和发布。</span>
          </label>
          <label class="field">机构
            <select v-model="form.institution">
              <option v-for="item in orgsFor(form.jurisdiction)" :key="item.id" :value="item.name">{{ item.name }}</option>
            </select>
          </label>
        </div>
        <p class="hint">机构、司法管辖区和监管规则版本创建后固定，不能修改；主任务名称和基准日可以后续调整。</p>
        <div class="btn-group">
          <button type="button" class="btn primary" :disabled="loadingVersions || !hasUsableVersion" @click="next">下一步：检查规则配置 →</button>
        </div>
      </div>
    </div>

    <div v-else-if="step === 2" class="panel">
      <div class="panel-head">
        <h3>第二步：规则配置检查</h3>
        <span class="sub">同时检查资本充足率和流动性两套配置，不在这里修改规则</span>
        <span class="spacer"></span>
        <button type="button" class="btn sm" :disabled="loadingReadiness" @click="checkReadiness">{{ loadingReadiness ? "检查中" : "重新检查" }}</button>
      </div>
      <div class="panel-body">
        <div v-if="loadingReadiness" class="loading"><span class="spin"></span>正在检查当前版本的规则配置</div>
        <template v-else-if="readiness">
          <div class="grid c4" style="margin-bottom: 14px">
            <div class="kpi"><div class="k-label">产品注册</div><div class="k-value sm">{{ readiness.productCount }} 个产品族</div><div class="k-foot">{{ readiness.fieldCount }} 个标准字段</div></div>
            <div class="kpi"><div class="k-label">暴露分类</div><div class="k-value sm">{{ readiness.classification ? readiness.classification.version : "缺失" }}</div><div class="k-foot">{{ readiness.classification ? readiness.classification.name : "未找到分类规则" }}</div></div>
            <div class="kpi"><div class="k-label">风险权重</div><div class="k-value sm">{{ readiness.weight ? readiness.weight.version : "缺失" }}</div><div class="k-foot">{{ readiness.weight ? readiness.weight.name : "未找到权重规则" }}</div></div>
            <div class="kpi"><div class="k-label">字段映射</div><div class="k-value sm">{{ readiness.mappingCount }} 份</div><div class="k-foot">按产品族映射到规则输入字段</div></div>
          </div>
          <div class="grid c4" style="margin-bottom: 14px">
            <div class="kpi"><div class="k-label">EAD 配置</div><div class="k-value sm">{{ readiness.ead ? readiness.ead.readyCount + " / " + readiness.ead.neededCount : "—" }}</div><div class="k-foot">已配置 / 需配置产品</div></div>
            <div class="kpi"><div class="k-label">缓释配置</div><div class="k-value sm">{{ readiness.crm ? readiness.crm.readyCount + " / " + readiness.crm.neededCount : "—" }}</div><div class="k-foot">{{ crmNeededCount === 0 ? "本版本无缓释配置要求" : "已配置 / 需配置产品" }}</div></div>
            <div class="kpi"><div class="k-label">参数表 / 名单</div><div class="k-value sm">{{ readiness.parameterTableCount }} / {{ readiness.referenceListCount }}</div><div class="k-foot">资本充足率配置</div></div>
            <div class="kpi">
              <div class="k-label">流动性配置</div>
              <div class="k-value sm">
                {{ readiness.liquidity ? readiness.liquidity.usableCount + " / " + readiness.liquidity.productCount : "—" }}
                <span v-if="liquidityPartial" class="tag amber" style="font-size: 9.5px">待完善</span>
              </div>
              <div class="k-foot" :style="liquidityPartial ? 'color:#92400e' : ''">
                <template v-if="liquidityPartial">{{ liquidityMissingCount }} 个产品未配置完整 · </template>
                {{ readiness.liquidity ? readiness.liquidity.tableCount + " 张参数表 · " + readiness.liquidity.listCount + " 份名单" : "未读取" }}
              </div>
            </div>
          </div>
          <div class="task-check-list">
            <div :class="readiness.published ? 'ok' : 'bad'">{{ readiness.published ? "✓" : "✗" }} 监管规则版本已发布</div>
            <div :class="readiness.snapshotId ? 'ok' : 'bad'">{{ readiness.snapshotId ? "✓" : "✗" }} 正式配置快照</div>
            <div :class="readiness.registry ? 'ok' : 'bad'">{{ readiness.registry ? "✓" : "✗" }} 产品注册 {{ readiness.registry ? "v" + readiness.registry.version : "缺失" }}</div>
            <div :class="readiness.classification ? 'ok' : 'bad'">{{ readiness.classification ? "✓" : "✗" }} 暴露分类规则集</div>
            <div :class="readiness.weight ? 'ok' : 'bad'">{{ readiness.weight ? "✓" : "✗" }} 风险权重规则集</div>
            <div :class="readiness.mappingCount ? 'ok' : 'bad'">{{ readiness.mappingCount ? "✓" : "✗" }} 字段映射文档 {{ readiness.mappingCount }} 份</div>
            <div :class="readiness.fieldCount ? 'ok' : 'bad'">{{ readiness.fieldCount ? "✓" : "✗" }} 产品标准字段 {{ readiness.fieldCount }} 个</div>
            <div :class="eadReady ? 'ok' : 'bad'">{{ eadReady ? "✓" : "✗" }} EAD 计算规则</div>
            <div :class="crmReady ? 'ok' : 'bad'">{{ crmReady ? "✓" : "✗" }} 信用风险缓释{{ crmNeededCount === 0 ? "（本版本无要求）" : "" }}</div>
            <div :class="readiness.parameterTableCount ? 'ok' : 'bad'">{{ readiness.parameterTableCount ? "✓" : "✗" }} 规则参数表 {{ readiness.parameterTableCount }} 张</div>
            <div :class="readiness.referenceListCount ? 'ok' : 'bad'">{{ readiness.referenceListCount ? "✓" : "✗" }} 监管名单 {{ readiness.referenceListCount }} 份</div>
            <div :class="liquidityReady ? (liquidityPartial ? 'warn' : 'ok') : 'bad'">
              {{ liquidityReady ? (liquidityPartial ? "⚠" : "✓") : "✗" }} 流动性产品、参数和名单{{ liquidityPartial ? "（" + liquidityMissingCount + " 个产品未配置完整）" : "" }}
            </div>
          </div>
          <div v-if="!readiness.ok" class="notice danger" style="margin-top: 12px">
            <span class="ni">!</span>
            <div>
              <div>当前版本不能创建主任务：</div>
              <div v-for="item in readiness.issues" :key="item">{{ item }}</div>
            </div>
          </div>
          <div v-else class="notice ok" style="margin-top: 12px"><span class="ni">✓</span><div>规则配置完整，可以创建主任务。</div></div>
          <div v-if="readiness.ok && liquidityPartial" class="notice warn" style="margin-top: 12px">
            <span class="ni">!</span>
            <div>流动性有 {{ liquidityMissingCount }} 个产品未配置完整；仍可创建主任务，进入 LCR 配置后补齐。</div>
          </div>
        </template>
        <div v-else class="empty">还没有检查结果。点「重新检查」。</div>
        <div class="btn-group">
          <button type="button" class="btn" @click="back">← 返回基本信息</button>
          <button type="button" class="btn primary" :disabled="loadingReadiness || !readiness || !readiness.ok" @click="next">下一步：设置初始子任务 →</button>
        </div>
      </div>
    </div>

    <div v-else class="panel">
      <div class="panel-head">
        <h3>第三步：初始子任务</h3>
        <span class="sub">可以现在建，也可以创建后到任务详情页再添加</span>
      </div>
      <div class="panel-body">
        <div class="task-subtask-option">
          <label>
            <input v-model="includeCapital" type="checkbox" />
            <span>
              <b>资本充足率子任务</b>
              <span class="dim">进入计量向导，执行分类、风险权重、EAD、缓释和 RWA</span>
            </span>
          </label>
          <input v-if="includeCapital" v-model="capitalName" type="text" placeholder="资本充足率计量" />
        </div>
        <div class="task-subtask-option">
          <label>
            <input v-model="includeLiquidity" type="checkbox" />
            <span>
              <b>流动性子任务</b>
              <span class="dim">进入 LCR 计量任务向导，执行导入、识别、Mapping、质量检查和 LCR 计算</span>
            </span>
          </label>
          <input v-if="includeLiquidity" v-model="liquidityName" type="text" placeholder="流动性计量" />
        </div>
        <div class="notice info">
          <span class="ni">i</span>
          <div>主任务将固定在 {{ form.jurisdiction }} · {{ selectedVersion ? selectedVersion.version : "未选择版本" }} · {{ form.institution }}，基准日 {{ form.baseDate }}。</div>
        </div>
        <div class="btn-group">
          <button type="button" class="btn" :disabled="saving" @click="back">← 返回规则检查</button>
          <button type="button" class="btn primary" :disabled="saving" @click="create">{{ saving ? "正在创建" : "创建主任务" }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.task-create-head { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 14px; }
.task-create-head h2 { margin: 8px 0 4px; font-size: 20px; }
.task-create-head p { margin: 0; color: var(--muted); font-size: 12.5px; }
.task-create-steps {
  display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
  padding: 12px 16px; margin-bottom: 14px;
  border: 1px solid var(--border); border-radius: 12px; background: #fff;
}
.task-create-step { display: inline-flex; align-items: center; gap: 7px; color: var(--muted); font-size: 12px; }
.task-create-step .sn {
  width: 22px; height: 22px; display: inline-flex; align-items: center; justify-content: center;
  border-radius: 50%; background: #f2f4f7; color: #667085; font-size: 11px; font-weight: 700;
}
.task-create-step.active { color: var(--accent); font-weight: 650; }
.task-create-step.active .sn { background: var(--accent); color: #fff; }
.task-create-step.done .sn { background: #d1fae5; color: #047857; }
.task-create-step .arrow { margin: 0 5px; color: #cbd2dc; }
.task-check-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 6px 12px; font-size: 12px; }
.task-check-list .ok { color: #047857; }
.task-check-list .bad { color: #b42318; }
.task-check-list .warn { color: #92400e; }
.task-subtask-option {
  display: grid; grid-template-columns: 1fr 260px; gap: 12px; align-items: center;
  padding: 10px 12px; margin-bottom: 10px; border: 1px solid var(--border); border-radius: 10px; background: #fff;
}
.task-subtask-option label { display: flex; align-items: flex-start; gap: 8px; font-size: 12px; }
.task-subtask-option label b { display: block; font-size: 12.5px; }
.task-subtask-option label .dim { display: block; margin-top: 2px; font-size: 11px; }
.task-subtask-option input[type="text"] { width: 100%; }
@media (max-width: 900px) { .task-subtask-option { grid-template-columns: 1fr; } }
</style>
