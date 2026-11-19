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

function initialForm() {
  const code = session.jurisdiction || (session.jurisdictions[0] ? session.jurisdictions[0].code : "");
  const versions = versionsFor(code);
  const current = versions.find((item) => item.id === session.versionId)
    || versions.find((item) => item.status === "published")
    || versions[0];
  const orgs = orgsFor(code);
  const org = orgs.find((item) => item.id === session.orgId) || orgs[0];
  form.value = {
    name: quarterName(session.baseDate),
    jurisdiction: code,
    versionId: current ? current.id : "",
    institution: org ? org.name : "",
    baseDate: session.baseDate || new Date().toISOString().slice(0, 10)
  };
}

function onJurisdiction() {
  const versions = versionsFor(form.value.jurisdiction);
  const orgs = orgsFor(form.value.jurisdiction);
  form.value.versionId = versions[0] ? versions[0].id : "";
  form.value.institution = orgs[0] ? orgs[0].name : "";
  readiness.value = null;
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
    if (!selectedVersion.value) { error.value = "请选择监管规则版本"; return; }
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
  initialForm();
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
            <select v-model="form.versionId" @change="readiness = null">
              <option v-for="item in versionsFor(form.jurisdiction)" :key="item.id" :value="item.id">
                {{ item.version }}{{ item.status && item.status !== "published" ? "（" + item.status + "）" : "" }}
              </option>
            </select>
          </label>
          <label class="field">机构
            <select v-model="form.institution">
              <option v-for="item in orgsFor(form.jurisdiction)" :key="item.id" :value="item.name">{{ item.name }}</option>
            </select>
          </label>
        </div>
        <p class="hint">机构、司法管辖区和监管规则版本创建后固定，不能修改；主任务名称和基准日可以后续调整。</p>
        <div class="btn-group">
          <button type="button" class="btn primary" @click="next">下一步：检查规则配置 →</button>
        </div>
      </div>
    </div>

    <div v-else-if="step === 2" class="panel">
      <div class="panel-head">
        <h3>第二步：规则配置检查</h3>
        <span class="sub">只检查，不在这里修改规则</span>
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
          <div class="task-check-list">
            <div :class="readiness.registry ? 'ok' : 'bad'">{{ readiness.registry ? "✓" : "✗" }} 产品注册 {{ readiness.registry ? "v" + readiness.registry.version : "缺失" }}</div>
            <div :class="readiness.classification ? 'ok' : 'bad'">{{ readiness.classification ? "✓" : "✗" }} 暴露分类规则集</div>
            <div :class="readiness.weight ? 'ok' : 'bad'">{{ readiness.weight ? "✓" : "✗" }} 风险权重规则集</div>
            <div :class="readiness.mappingCount ? 'ok' : 'bad'">{{ readiness.mappingCount ? "✓" : "✗" }} 字段映射文档 {{ readiness.mappingCount }} 份</div>
            <div :class="readiness.fieldCount ? 'ok' : 'bad'">{{ readiness.fieldCount ? "✓" : "✗" }} 产品标准字段 {{ readiness.fieldCount }} 个</div>
          </div>
          <div v-if="!readiness.ok" class="notice danger" style="margin-top: 12px">
            <span class="ni">!</span>
            <div>
              <div>当前版本不能创建主任务：</div>
              <div v-for="item in readiness.issues" :key="item">{{ item }}</div>
            </div>
          </div>
          <div v-else class="notice ok" style="margin-top: 12px"><span class="ni">✓</span><div>规则配置完整，可以创建主任务。</div></div>
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
              <span class="dim">在流动性 HQLA 页面执行</span>
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
