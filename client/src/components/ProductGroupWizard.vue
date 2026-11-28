<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import Drawer from "@/components/Drawer.vue";
import { askConfirm } from "@/utils/confirm";
import {
  assistProductGroup,
  assistProductGroupStream,
  assistProductGroupWorkflow,
  assistProductGroupWorkflowResume
} from "@/api/product";
import GroupPlanRail from "./productGroup/GroupPlanRail.vue";
import GroupHeader from "./productGroup/GroupHeader.vue";
import RegulatoryFieldSection from "./productGroup/RegulatoryFieldSection.vue";
import DecisionSection from "./productGroup/DecisionSection.vue";
import ProductGroupAssistant from "./product-group/ProductGroupAssistant.vue";
import { DECISION_CLASSES, DECISION_LABELS, emptyProgress, emptySelection } from "./productGroup/constants";
import { decisionMappingText, decisionSignature, decisionStandardText, mappingTransformSummary, stageLabel, summarizeDecisionList } from "./productGroup/helpers";

const props = defineProps({
  open: { type: Boolean, default: false },
  family: { type: String, default: "" },
  entryIndex: { type: Number, default: 0 },
  version: { type: String, default: "" },
  readOnly: { type: Boolean, default: false },
  exposureClasses: { type: Array, default: () => [] },
  getDraft: { type: Function, default: null }
});
const emit = defineEmits(["close", "apply-fields", "apply-mappings", "apply-groups", "apply-dictionaries", "save-all"]);

const SESSION_SCHEMA = 3;
const MESSAGE_LIMIT = 16;
const MESSAGE_CHAR_BUDGET = 12000;

const loading = ref(false);
const bulkRunning = ref(false);
const bulkStop = ref(false);
const bulkDone = ref(0);
const bulkTotal = ref(0);
const loadedClassKey = ref("");
const briefLoading = ref(false);
const error = ref("");
const notice = ref("");
const plan = ref([]);
const currentIndex = ref(0);
const brief = ref(null);
const proposal = ref(null);
const messages = ref([]);
const statuses = ref({});
const proposals = ref({});
const previousProposals = ref({});
const selections = ref({});
const confirmations = ref({});
const appliedStats = ref({});
const proposalTab = ref("overview");
const generatedAt = ref("");
// 时间线排序用：建议是哪个时刻生成的，本轮工作流是什么时候开始的。
const proposalTimes = ref({});
const runStartedAt = ref(0);
const progress = ref(emptyProgress());
const liveAnswer = ref("");
const workflowIntent = ref(null);
const workflowPlan = ref([]);
const workflowFindings = ref([]);
const workflowConflicts = ref([]);
const workflowDiff = ref({});
const workflowRequiresApproval = ref(false);
const workflowThreadId = ref("");
const workflowRunId = ref("");
const workflowProposalId = ref("");
const workflowDraftDigest = ref("");
const lastWorkflowPayload = ref(null);
const useWorkflow = ref(true);
const activeTarget = ref("");
const assistantOpen = ref(true);
const assistantWidth = ref(360);
const assistantResizing = ref(false);
const assistantDraft = ref("");
const assistantFilter = ref("all");
const leftWidth = ref(250);
const leftCollapsed = ref(false);
const leftResizing = ref(false);
const runLog = ref([]);

let resizeStartX = 0;
let resizeStartWidth = 0;
let assistantResizeStartX = 0;
let assistantResizeStartWidth = 0;
let saveTimer = null;
let controller = null;
let storageWarned = false;

const storageKey = computed(() => "rwa.productGroupWizard." + (props.version || "") + "." + (props.family || ""));
const exposureClassKey = computed(() => props.exposureClasses.slice().sort().join("|"));
const current = computed(() => plan.value[currentIndex.value] || null);
const currentStatus = computed(() => (current.value ? statuses.value[current.value.id] || "pending" : "pending"));
const finished = computed(() => plan.value.length > 0 && plan.value.every((group) => {
  const status = statuses.value[group.id];
  return status === "confirmed" || status === "skipped";
}));

const briefFields = computed(() => (brief.value && brief.value.fields) || []);
const decisions = computed(() => (proposal.value && proposal.value.decisions) || []);
const proposalFields = computed(() => (proposal.value && proposal.value.standardFields) || []);
const proposalMappings = computed(() => (proposal.value && proposal.value.mappings) || []);
const newGroups = computed(() => (proposal.value && proposal.value.newStandardGroups) || []);
const newDictionaries = computed(() => (proposal.value && proposal.value.newDictionaries) || []);

const selection = computed(() => {
  const id = current.value ? current.value.id : "";
  const raw = selections.value[id];
  if (!raw) return emptySelection();
  return {
    decisions: Array.isArray(raw.decisions) ? raw.decisions : [],
    fields: Array.isArray(raw.fields) ? raw.fields : [],
    mappings: Array.isArray(raw.mappings) ? raw.mappings : [],
    dictionaries: Array.isArray(raw.dictionaries) ? raw.dictionaries : []
  };
});

const currentConfirmations = computed(() => (current.value ? confirmations.value[current.value.id] || [] : []));

const blockingFindings = computed(() => {
  const selected = new Set(selection.value.decisions);
  return workflowFindings.value.filter((finding) => {
    if (!finding || finding.severity !== "error") return false;
    if (!finding.targetField) return true;
    return selected.has(finding.targetField);
  });
});
const blockingConflicts = computed(() => {
  const selected = new Set(selection.value.decisions);
  return workflowConflicts.value.filter((conflict) => {
    if (!conflict) return false;
    if (!conflict.targetField) return true;
    return selected.has(conflict.targetField);
  });
});
const blockedCount = computed(() => {
  const targets = new Set();
  blockingFindings.value.forEach((finding) => targets.add(finding.targetField || "__group__"));
  blockingConflicts.value.forEach((conflict) => targets.add(conflict.targetField || "__group__"));
  return targets.size;
});
const blocked = computed(() => blockedCount.value > 0);

const proposalDiff = computed(() => {
  const id = current.value ? current.value.id : "";
  const previous = id ? previousProposals.value[id] : null;
  const now = proposal.value;
  if (!previous || !now) return { has: false, added: [], removed: [], changed: [], dictionaries: [] };
  const before = new Map(((previous.decisions) || []).map((item) => [item.targetField, decisionSignature(item)]));
  const after = new Map(((now.decisions) || []).map((item) => [item.targetField, decisionSignature(item)]));
  const added = [];
  const changed = [];
  const removed = [];
  after.forEach((signature, target) => {
    if (!before.has(target)) added.push(target);
    else if (before.get(target) !== signature) changed.push(target);
  });
  before.forEach((signature, target) => {
    if (!after.has(target)) removed.push(target);
  });
  const beforeDictionaries = new Set(((previous.newDictionaries) || []).map((item) => item.dict_code));
  const dictionaries = ((now.newDictionaries) || []).map((item) => item.dict_code).filter((code) => !beforeDictionaries.has(code));
  return { has: added.length + removed.length + changed.length + dictionaries.length > 0, added, removed, changed, dictionaries };
});

const diffForDisplay = computed(() => {
  const diff = workflowDiff.value || {};
  const has = ((diff.addedDecisions || []).length
    + (diff.changedDecisions || []).length
    + (diff.removedDecisions || []).length
    + (diff.addedDictionaries || []).length) > 0;
  if (!has) return proposalDiff.value;
  return {
    has: true,
    added: diff.addedDecisions || [],
    changed: diff.changedDecisions || [],
    removed: diff.removedDecisions || [],
    dictionaries: diff.addedDictionaries || []
  };
});

// 当前分组建议的生成时刻；拿不到就排在最后，保持原来的显示顺序。
const proposalAt = computed(() => {
  const id = current.value ? current.value.id : "";
  return Number(proposalTimes.value[id]) || Number.MAX_SAFE_INTEGER;
});

const INTENT_LABELS = {
  answer: "知识问答",
  local_refine: "局部调整",
  global_refine: "整体调整",
  propose: "生成建议",
  review: "质量检查",
  composite: "复合任务"
};
const TASK_LABELS = {
  answer: "知识问答",
  local_refine: "局部调整",
  global_refine: "整体调整",
  propose: "生成建议",
  review: "质量检查",
  composite: "复合任务"
};
const assistantQuickActions = [
  { key: "required", label: "只处理必填字段" },
  { key: "reuse", label: "复用已有标准字段" },
  { key: "no-default", label: "固定默认值不建字段" },
  { key: "regenerate", label: "重新生成本组", primary: true }
];

const assistantStatus = computed(() => {
  if (loading.value) return { text: "运行中", tone: "busy" };
  if (workflowRequiresApproval.value) return { text: "待审批", tone: "warn" };
  if (workflowFindings.value.some((finding) => finding.severity === "error")) return { text: "需要处理", tone: "error" };
  if (proposal.value) return { text: "建议已生成", tone: "ok" };
  return { text: "待开始", tone: "idle" };
});

const assistantEvents = computed(() => {
  const events = [];
  const runKey = workflowRunId.value || "current";
  const list = messages.value;
  const messageEvent = (message, index) => ({
    id: "msg-" + index + "-" + (message.at || 0),
    type: message.role === "user" ? "user_message" : "assistant_answer",
    text: message.text,
    note: message.note || "",
    groupId: message.groupId || "",
    groupLabel: message.groupLabel || "",
    at: message.at
  });
  // 本轮的过程和结果卡片要落在用户这次提问之后、助手回答之前，
  // 否则回答会被顶到上一版结果卡片上面去。
  let split = list.length;
  for (let index = list.length - 1; index >= 0; index -= 1) {
    if (list[index].role === "user") {
      split = index + 1;
      break;
    }
  }
  list.slice(0, split).forEach((message, index) => events.push(messageEvent(message, index)));
  const runAt = runStartedAt.value || 0;
  if (workflowIntent.value) {
    const type = workflowIntent.value.type || "";
    events.push({
      id: "intent-" + runKey,
      type: "intent",
      title: "当前意图",
      typeLabel: INTENT_LABELS[type] || type,
      confidence: workflowIntent.value.confidence,
      at: runAt
    });
  }
  if (workflowPlan.value.length) {
    events.push({
      id: "plan-" + runKey,
      type: "plan",
      title: "执行计划",
      tasks: workflowPlan.value.map((task) => TASK_LABELS[task.type] || task.type),
      at: runAt
    });
  }
  if (runLog.value.length || progress.value.active) {
    events.push({
      id: "stage-" + runKey,
      type: "stage",
      title: stageLabel(progress.value.stage),
      message: progress.value.message,
      done: progress.value.done,
      total: progress.value.total,
      lines: runLog.value.map((line) => ({ kind: line.kind, text: line.text })),
      active: progress.value.active,
      at: runAt
    });
  }
  if (workflowFindings.value.length) {
    events.push({ id: "review-" + runKey, type: "review", title: "质量检查", findings: workflowFindings.value, at: runAt });
  }
  if (workflowConflicts.value.length) {
    events.push({ id: "conflict-" + runKey, type: "conflict", conflicts: workflowConflicts.value, at: runAt });
  }
  if (diffForDisplay.value && diffForDisplay.value.has) {
    const diff = diffForDisplay.value;
    // 本轮刚算出来的差异跟着本轮走；上一版留下的差异留在建议生成的那一刻。
    const diffAt = diff === proposalDiff.value ? proposalAt.value : runAt;
    events.push({
      id: "diff-" + runKey,
      type: "diff",
      title: "与上一版比较",
      diff: {
        addedDecisions: diff.added,
        changedDecisions: diff.changed,
        removedDecisions: diff.removed,
        addedDictionaries: diff.dictionaries
      },
      at: diffAt
    });
  }
  if (workflowRequiresApproval.value && !workflowConflicts.value.length) {
    events.push({
      id: "approval-" + runKey,
      type: "approval",
      title: "当前建议需要人工确认",
      text: "批准后工作流会继续执行并回填建议。",
      at: runAt
    });
  }
  if (proposal.value) {
    const list = proposal.value.decisions || [];
    const counts = { reuse: 0, create: 0, default: 0, system: 0, skip: 0, missing: 0 };
    list.forEach((item) => { counts[item.decisionType] = (counts[item.decisionType] || 0) + 1; });
    const stats = [
      { label: "复用", value: counts.reuse, tone: "mint" },
      { label: "新建", value: counts.create, tone: "blue" },
      { label: "默认值", value: counts.default, tone: "amber" },
      { label: "系统计算", value: counts.system, tone: "violet" },
      { label: "跳过", value: counts.skip, tone: "gray" },
      { label: "缺失", value: counts.missing, tone: "rose" }
    ];
    events.push({
      id: "rows-" + runKey,
      type: "field_decisions",
      title: "字段决策明细",
      selected: selection.value.decisions.length,
      rows: list.map((item) => ({
        targetField: item.targetField,
        targetLabel: item.targetLabel,
        tone: DECISION_CLASSES[item.decisionType] || "gray",
        decisionLabel: DECISION_LABELS[item.decisionType] || item.decisionType,
        standard: decisionStandardText(item),
        mapping: decisionMappingText(item),
        dictionary: item.dictionary ? item.dictionary.dict_code : "",
        confidence: item.confidence,
        reason: item.reason,
        ruleReason: item.ruleReason,
        mappingDetail: item.mapping ? mappingTransformSummary(item.mapping) : "",
        standardFieldLabel: item.standardField ? item.standardField.label : "",
        selected: selection.value.decisions.includes(item.targetField)
      })),
      at: proposalAt.value
    });
    events.push({
      id: "result-" + runKey,
      type: "result",
      title: "配置建议已生成",
      stats,
      text: proposal.value.summary || summarizeDecisionList(list),
      hasDiff: !!(diffForDisplay.value && diffForDisplay.value.has),
      canApply: !blocked.value && selection.value.decisions.length > 0,
      at: proposalAt.value
    });
  }
  // 本轮产生的回答（如果有）排在过程和结果卡片下面。
  list.slice(split).forEach((message, index) => events.push(messageEvent(message, split + index)));
  const lastAt = Number.MAX_SAFE_INTEGER;
  if (loading.value && liveAnswer.value.trim()) {
    // 模型边生成边显示，避免长回答期间面板看起来卡住。
    events.push({
      id: "live-" + runKey,
      type: "assistant_answer",
      text: liveAnswer.value,
      streaming: true,
      groupId: current.value ? current.value.id : "",
      groupLabel: current.value ? current.value.label : "",
      at: lastAt
    });
  }
  if (error.value) {
    events.push({ id: "error-" + runKey, type: "error", title: "处理失败", text: error.value, at: lastAt });
  }
  // 按发生时间排：老建议卡片不会被顶到最新回答下面。
  return events.sort((left, right) => (left.at || 0) - (right.at || 0));
});

watch(() => props.open, (open) => {
  if (!open) {
    if (controller) controller.abort();
    saveSession();
    return;
  }
  error.value = "";
  notice.value = "";
  if (plan.value.length && loadedClassKey.value !== exposureClassKey.value) {
    resetData();
  }
  if (!plan.value.length) start();
}, { immediate: true });

watch(exposureClassKey, (key) => {
  if (!props.open || bulkRunning.value || key === loadedClassKey.value) return;
  resetData();
  start();
});

watch(
  [plan, currentIndex, statuses, proposals, previousProposals, proposalTimes, selections, confirmations, appliedStats, messages, activeTarget, assistantOpen, assistantWidth],
  () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveSession, 300);
  },
  { deep: true }
);

function resetData() {
  plan.value = [];
  currentIndex.value = 0;
  brief.value = null;
  proposal.value = null;
  statuses.value = {};
  proposals.value = {};
  previousProposals.value = {};
  proposalTimes.value = {};
  selections.value = {};
  confirmations.value = {};
  appliedStats.value = {};
  messages.value = [];
  progress.value = emptyProgress();
  activeTarget.value = "";
  proposalTab.value = "overview";
  runLog.value = [];
  liveAnswer.value = "";
  resetWorkflowState();
}

function resetWorkflowState() {
  workflowIntent.value = null;
  workflowPlan.value = [];
  workflowFindings.value = [];
  workflowConflicts.value = [];
  workflowDiff.value = {};
  workflowRequiresApproval.value = false;
}

function saveSession() {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (!plan.value.length) return;
  try {
    localStorage.setItem(storageKey.value, JSON.stringify({
      schema: SESSION_SCHEMA,
      plan: plan.value,
      currentIndex: currentIndex.value,
      statuses: statuses.value,
      proposals: proposals.value,
      previousProposals: previousProposals.value,
      proposalTimes: proposalTimes.value,
      selections: selections.value,
      confirmations: confirmations.value,
      appliedStats: appliedStats.value,
      messages: messages.value,
      activeTarget: activeTarget.value,
      assistantOpen: assistantOpen.value,
      assistantWidth: assistantWidth.value,
      classes: props.exposureClasses.slice().sort(),
      at: Date.now()
    }));
    storageWarned = false;
  } catch {
    if (!storageWarned) {
      storageWarned = true;
      notice.value = "浏览器存储空间不足，本次对话没有保存；请先导出草稿或清理站点数据。";
    }
  }
}

function restoreMessages(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (typeof item === "string") {
        return { role: "assistant", text: item, note: "", groupId: "", groupLabel: "", at: 0 };
      }
      if (!item || typeof item !== "object" || typeof item.text !== "string" || !item.text) return null;
      return {
        role: item.role === "user" ? "user" : "assistant",
        text: item.text,
        note: item.note ? String(item.note) : "",
        groupId: item.groupId ? String(item.groupId) : "",
        groupLabel: item.groupLabel ? String(item.groupLabel) : "",
        at: Number(item.at) || 0
      };
    })
    .filter(Boolean);
}

function deriveConfirmations(data) {
  const result = {};
  (data.plan || []).forEach((group) => {
    if ((data.statuses || {})[group.id] !== "confirmed") return;
    const selected = ((data.selections || {})[group.id] || {}).decisions;
    if (Array.isArray(selected)) result[group.id] = selected.slice();
  });
  return result;
}

function restoreSession() {
  try {
    const raw = localStorage.getItem(storageKey.value);
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (!Array.isArray(data.plan) || !data.plan.length) return false;
    const savedClasses = Array.isArray(data.classes) ? data.classes.slice().sort() : [];
    const currentClasses = props.exposureClasses.slice().sort();
    if (savedClasses.length !== currentClasses.length || savedClasses.some((code, index) => code !== currentClasses[index])) {
      try { localStorage.removeItem(storageKey.value); } catch { /* ignore */ }
      return false;
    }
    plan.value = data.plan;
    currentIndex.value = Math.min(Number(data.currentIndex) || 0, data.plan.length - 1);
    statuses.value = data.statuses || {};
    proposals.value = data.proposals || {};
    previousProposals.value = data.previousProposals || {};
    proposalTimes.value = data.proposalTimes || {};
    selections.value = data.selections || {};
    confirmations.value = data.confirmations || deriveConfirmations(data);
    appliedStats.value = data.appliedStats || {};
    messages.value = restoreMessages(data.messages);
    activeTarget.value = String(data.activeTarget || "");
    assistantOpen.value = data.assistantOpen !== false;
    assistantWidth.value = Number(data.assistantWidth) || 360;
    return true;
  } catch {
    return false;
  }
}

onMounted(() => window.addEventListener("beforeunload", saveSession));
onBeforeUnmount(() => {
  window.removeEventListener("beforeunload", saveSession);
  stopResize();
  stopAssistantResize();
  clearTimeout(saveTimer);
});

function messageSize(item) {
  return String(item.text || "").length + String(item.note || "").length;
}

function historyForModel() {
  const list = messages.value.filter((item) => item && item.text);
  if (!list.length) return [];
  const first = list[0];
  const recent = [];
  let chars = messageSize(first);
  for (let index = list.length - 1; index >= 1; index -= 1) {
    if (recent.length >= MESSAGE_LIMIT - 1) break;
    const item = list[index];
    const size = messageSize(item);
    if (recent.length && chars + size > MESSAGE_CHAR_BUDGET) break;
    recent.unshift(item);
    chars += size;
  }
  return [first, ...recent].map((item) => ({
    role: item.role === "user" ? "user" : "assistant",
    text: item.text,
    note: item.note || "",
    groupId: item.groupId || "",
    groupLabel: item.groupLabel || ""
  }));
}

function basePayload(action, extra = {}) {
  const draft = props.getDraft ? props.getDraft() : {};
  const id = current.value ? current.value.id : "";
  return {
    action,
    version: props.version,
    family: props.family,
    entryIndex: props.entryIndex,
    groupId: id,
    exposureClasses: props.exposureClasses.slice(),
    messages: historyForModel(),
    draftStandardFields: (draft && draft.standardFields) || [],
    draftMappings: (draft && draft.mappings) || [],
    draftDirty: !!(draft && draft.dirty),
    currentProposal: proposal.value,
    previousProposal: id ? previousProposals.value[id] || null : null,
    currentSelections: selection.value.decisions,
    ...extra
  };
}

async function start() {
  loading.value = true;
  error.value = "";
  bulkRunning.value = false;
  bulkStop.value = false;
  bulkDone.value = 0;
  bulkTotal.value = 0;
  try {
    if (restoreSession()) {
      loadedClassKey.value = exposureClassKey.value;
      const savedTarget = activeTarget.value;
      await openGroup(currentIndex.value, true);
      activeTarget.value = savedTarget;
      return;
    }
    const data = await assistProductGroup({
      action: "plan",
      version: props.version,
      family: props.family,
      entryIndex: props.entryIndex,
      exposureClasses: props.exposureClasses.slice()
    });
    plan.value = data.groups || [];
    loadedClassKey.value = exposureClassKey.value;
    currentIndex.value = 0;
    statuses.value = {};
    proposals.value = {};
    previousProposals.value = {};
    selections.value = {};
    confirmations.value = {};
    appliedStats.value = {};
    messages.value = [];
    activeTarget.value = "";
    if (plan.value.length) await openGroup(0, true);
  } catch (err) {
    error.value = err.message || "读取监管字段分组失败";
  } finally {
    loading.value = false;
  }
}

async function openGroup(index, internal = false) {
  if (bulkRunning.value && !internal) return;
  if (index < 0 || index >= plan.value.length) return;
  if (controller) controller.abort();
  currentIndex.value = index;
  brief.value = null;
  proposal.value = proposals.value[plan.value[index].id] || null;
  generatedAt.value = "";
  progress.value = emptyProgress();
  runLog.value = [];
  liveAnswer.value = "";
  proposalTab.value = "overview";
  activeTarget.value = "";
  resetWorkflowState();
  briefLoading.value = true;
  try {
    const data = await assistProductGroup(basePayload("brief", { groupId: plan.value[index].id }));
    brief.value = data.group || null;
    proposal.value = proposals.value[plan.value[index].id] || proposal.value;
    if (proposal.value && !selections.value[plan.value[index].id]) selectProposal(proposal.value);
  } catch (err) {
    error.value = err.message || "读取本组监管字段失败";
  } finally {
    briefLoading.value = false;
  }
}

function selectProposal(body) {
  if (!current.value) return;
  const id = current.value.id;
  selections.value = {
    ...selections.value,
    [id]: {
      decisions: ((body && body.decisions) || [])
        .filter((item) => item.decisionType !== "missing")
        .map((item) => item.targetField),
      fields: ((body && body.standardFields) || []).map((item) => item.name),
      mappings: ((body && body.mappings) || []).map((item) => item.targetField),
      dictionaries: ((body && body.newDictionaries) || []).map((item) => item.dict_code)
    }
  };
}

function normalizeSelection(raw) {
  if (!raw) return null;
  if (Array.isArray(raw)) return { decisions: raw, fields: [], mappings: [], dictionaries: [] };
  return {
    decisions: Array.isArray(raw.decisions) ? raw.decisions : [],
    fields: Array.isArray(raw.fields) ? raw.fields : [],
    mappings: Array.isArray(raw.mappings) ? raw.mappings : [],
    dictionaries: Array.isArray(raw.dictionaries) ? raw.dictionaries : []
  };
}

function commitProposal(data, preserve = false, previous = null, options = {}) {
  if (!current.value || !data) return;
  const id = current.value.id;
  const groupLabel = current.value.label || id;
  if (previous) {
    previousProposals.value = { ...previousProposals.value, [id]: previous };
  }
  proposal.value = data;
  proposals.value = { ...proposals.value, [id]: data };
  proposalTimes.value = { ...proposalTimes.value, [id]: Date.now() };
  generatedAt.value = new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });

  const old = selections.value[id];
  const provided = normalizeSelection(options.selection);
  if (provided) {
    selections.value = { ...selections.value, [id]: provided };
  } else if (preserve && old) {
    const targets = (data.decisions || [])
      .filter((item) => item.decisionType !== "missing")
      .map((item) => item.targetField);
    const oldSelected = new Set(old.decisions || []);
    const previousTargets = new Set(((previous && previous.decisions) || []).map((item) => item.targetField));
    const kept = targets.filter((target) => oldSelected.has(target));
    const added = targets.filter((target) => !previousTargets.has(target));
    const keepNewOrSelected = (previousList, nextList, selectedList, keyOf) => {
      const before = new Set((previousList || []).map(keyOf));
      const selected = new Set(selectedList || []);
      return (nextList || [])
        .map(keyOf)
        .filter((key) => selected.has(key) || !before.has(key));
    };
    selections.value = {
      ...selections.value,
      [id]: {
        decisions: kept.concat(added),
        fields: keepNewOrSelected(previous && previous.standardFields, data.standardFields, old.fields, (item) => item.name),
        mappings: keepNewOrSelected(previous && previous.mappings, data.mappings, old.mappings, (item) => item.targetField),
        dictionaries: keepNewOrSelected(previous && previous.newDictionaries, data.newDictionaries, old.dictionaries, (item) => item.dict_code)
      }
    };
  } else {
    selectProposal(data);
  }

  const oldConfirmed = confirmations.value[id] || [];
  let keptConfirmations = [];
  if (preserve && previous) {
    const before = new Map((previous.decisions || []).map((item) => [item.targetField, decisionSignature(item)]));
    const after = new Map((data.decisions || []).map((item) => [item.targetField, item]));
    keptConfirmations = oldConfirmed.filter((target) => {
      const next = after.get(target);
      return !!next && before.get(target) === decisionSignature(next);
    });
  }
  confirmations.value = { ...confirmations.value, [id]: keptConfirmations };
  statuses.value = { ...statuses.value, [id]: "proposal_ready" };

  const summary = summarizeDecisionList(data.decisions || []);
  const message = String(options.message || data.message || "").trim();
  messages.value = messages.value.concat([{
    role: "assistant",
    text: message || summary,
    note: message && message !== summary ? summary : "",
    groupId: id,
    groupLabel,
    at: Date.now()
  }]);
}

function pushRunLine(kind, text) {
  const line = String(text || "").trim();
  if (!line) return;
  runLog.value = runLog.value.concat([{ kind, text: line }]);
}

async function runGeneration(action, options = {}) {
  if (!current.value || props.readOnly || loading.value) return;
  const id = current.value.id;
  const groupLabel = current.value.label || id;
  const previous = proposal.value || proposals.value[id] || null;
  const isAnswer = action === "answer";
  loading.value = true;
  runStartedAt.value = Date.now();
  error.value = "";
  notice.value = "";
  liveAnswer.value = "";
  runLog.value = [];
  progress.value = {
    ...emptyProgress(),
    active: true,
    stage: "reading_group",
    message: isAnswer ? "正在读取本组字段、字典和映射…" : "正在准备本组监管字段画像…",
    total: briefFields.value.length
  };
  pushRunLine("status", isAnswer ? "正在读取本组字段、字典和映射…" : "正在准备本组监管字段画像…");
  const payload = basePayload(action);
  let result = null;
  controller = new AbortController();
  try {
    if (typeof assistProductGroupStream === "function") {
      await assistProductGroupStream(payload, {
        status(data) {
          progress.value = {
            ...progress.value,
            stage: data.stage || progress.value.stage,
            message: data.message || progress.value.message,
            total: data.total || progress.value.total
          };
          pushRunLine("status", data && data.message ? data.message : "");
        },
        token(data) {
          if (data && data.text) liveAnswer.value += data.text;
        },
        decision(data) {
          if (!data || !data.decision) return;
          const list = progress.value.decisions.slice();
          if (!list.some((item) => item.targetField === data.decision.targetField)) list.push(data.decision);
          progress.value = {
            ...progress.value,
            decisions: list,
            done: data.done || list.length,
            total: data.total || progress.value.total
          };
          const decision = data.decision;
          const fieldName = decision.standardField && decision.standardField.name;
          pushRunLine("decision", "✓ " + decision.targetField + " · " + (decision.decisionType || "") + (fieldName ? " → " + fieldName : ""));
        },
        field(data) {
          if (!data || !data.field) return;
          progress.value.fields = progress.value.fields.concat([data.field]);
          pushRunLine("field", "＋ 标准字段 " + (data.field.name || ""));
        },
        mapping(data) {
          if (!data || !data.mapping) return;
          progress.value.mappings = progress.value.mappings.concat([data.mapping]);
          const source = data.mapping.sourceField ? " ← " + data.mapping.sourceField : "";
          pushRunLine("mapping", "↳ 映射 " + data.mapping.targetField + source);
        },
        dictionary(data) {
          if (!data || !data.dictionary) return;
          progress.value.dictionaries = progress.value.dictionaries.concat([data.dictionary]);
          pushRunLine("dictionary", "◈ 字典 " + (data.dictionary.dict_code || ""));
        },
        result(data) {
          result = data;
        },
        error(data) {
          error.value = (data && (data.error || data.message)) || "生成失败";
        }
      }, controller.signal);
    }
  } catch (err) {
    if (err && err.name === "AbortError") {
      loading.value = false;
      progress.value = emptyProgress();
      runLog.value = [];
      return;
    }
    error.value = err.message || "";
  }
  if (!result) {
    try {
      result = await assistProductGroup(payload);
    } catch (err) {
      error.value = err.message || (isAnswer ? "回答本组问题失败" : (action === "refine" ? "调整本组建议失败" : "生成本组建议失败"));
      progress.value = emptyProgress();
      liveAnswer.value = "";
      runLog.value = [];
      loading.value = false;
      controller = null;
      return;
    }
  }
  if (isAnswer) {
    const answer = String((result && (result.message || result.reply)) || liveAnswer.value || "").trim();
    messages.value = messages.value.concat([{
      role: "assistant",
      text: answer || "没有返回回答。",
      groupId: id,
      groupLabel,
      at: Date.now()
    }]);
    liveAnswer.value = "";
    progress.value = emptyProgress();
    runLog.value = [];
    error.value = "";
    loading.value = false;
    controller = null;
    return;
  }
  progress.value = emptyProgress();
  error.value = "";
  if (!current.value || current.value.id !== id) {
    runLog.value = [];
    loading.value = false;
    controller = null;
    return;
  }
  pushRunLine("status", "本组建议已生成，结果见下方「本组标准字段、字典与映射决策」。");
  commitProposal(result, options.preserve === true, previous);
  loading.value = false;
  controller = null;
}

function generate() {
  if (useWorkflow.value) runWorkflow("生成本组建议", { fallbackAction: "propose" });
  else runGeneration("propose", { preserve: false });
}

function noteRegenerate(text) {
  if (!current.value || props.readOnly || loading.value || bulkRunning.value) return false;
  const group = current.value;
  messages.value = messages.value.concat([{
    role: "user",
    text,
    groupId: group.id,
    groupLabel: group.label,
    at: Date.now()
  }]);
  return true;
}

function regenerate() {
  if (!noteRegenerate("重新生成本组")) return;
  if (useWorkflow.value) runWorkflow("重新生成本组", { fallbackAction: "propose" });
  else runGeneration("propose", { preserve: true });
}

function regenerateFresh() {
  if (!noteRegenerate("清空勾选后重新生成本组")) return;
  if (current.value) confirmations.value = { ...confirmations.value, [current.value.id]: [] };
  if (useWorkflow.value) runWorkflow("清空勾选后重新生成本组", { reset: true, fallbackAction: "propose" });
  else runGeneration("propose", { preserve: false });
}

function hasMappableTargets(group) {
  const stats = group && group.stats ? group.stats : {};
  return Number(stats.fields || 0) - Number(stats.systemCalc || 0) > 0;
}

function toggleBulk() {
  if (bulkRunning.value) {
    bulkStop.value = true;
    return;
  }
  generateAll();
}

async function generateAll() {
  if (props.readOnly || loading.value || bulkRunning.value) return;
  const groups = plan.value.filter(hasMappableTargets);
  if (!groups.length) {
    notice.value = "所有分组都没有需要人工映射的字段。";
    return;
  }
  bulkRunning.value = true;
  bulkStop.value = false;
  bulkDone.value = 0;
  bulkTotal.value = groups.length;
  notice.value = "";
  error.value = "";
  const failed = [];
  const skipped = [];
  for (let index = 0; index < plan.value.length; index += 1) {
    if (!props.open || bulkStop.value) break;
    const group = plan.value[index];
    if (!hasMappableTargets(group)) continue;
    await openGroup(index, true);
    if (!props.open) break;
    if (!brief.value) {
      failed.push(group.label);
      error.value = "";
      continue;
    }
    if (!(brief.value.fields || []).some((field) => !field.systemCalc)) {
      skipped.push(group.label);
      continue;
    }
    await runGeneration("propose", { preserve: true });
    if (error.value) {
      failed.push(group.label);
      error.value = "";
    } else {
      bulkDone.value += 1;
    }
  }
  bulkRunning.value = false;
  if (bulkStop.value) {
    notice.value = "已停止：完成 " + bulkDone.value + " / " + bulkTotal.value + " 组。";
    bulkStop.value = false;
    return;
  }
  const parts = ["已生成 " + bulkDone.value + " 组建议"];
  if (skipped.length) parts.push("跳过 " + skipped.length + " 组（仅系统计算字段）");
  if (failed.length) parts.push("失败 " + failed.length + " 组：" + failed.join("、"));
  notice.value = parts.join("；") + "。请逐组确认后保存。";
}

function draftDigest() {
  const draft = props.getDraft ? props.getDraft() : {};
  const text = JSON.stringify({ draft, selection: selections.value[current.value ? current.value.id : ""] || {} });
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return "client:" + (hash >>> 0).toString(16);
}

function groupPayload(text, options = {}) {
  const id = current.value ? current.value.id : "";
  const selectionToSend = options.reset ? emptySelection() : (selections.value[id] || emptySelection());
  const payload = {
    ...basePayload("auto"),
    text,
    threadId: workflowThreadId.value || [props.version || "", props.family || "", id].join(":"),
    runId: workflowRunId.value || ("RUN-" + Date.now().toString(36).toUpperCase()),
    proposalId: workflowProposalId.value || (proposal.value && proposal.value.id) || "",
    draftDigest: draftDigest(),
    selection: selectionToSend,
    constraints: options.constraints || [],
    baseDraftDigest: workflowDraftDigest.value,
    approvalStatus: options.approval ? "approved" : ""
  };
  lastWorkflowPayload.value = payload;
  return payload;
}

function pushWorkflowDecision(data) {
  if (!data || !data.decision) return;
  const list = progress.value.decisions.slice();
  if (!list.some((item) => item.targetField === data.decision.targetField)) list.push(data.decision);
  progress.value = { ...progress.value, decisions: list, done: data.done || list.length, total: data.total || progress.value.total };
}

function handleWorkflowEvents(handlers) {
  return {
    status(data) { handlers.status(data); },
    intent(data) { workflowIntent.value = data.intent || null; },
    plan(data) { workflowPlan.value = data.plan || []; },
    token(data) { if (data && data.text) liveAnswer.value += data.text; },
    decision: pushWorkflowDecision,
    field(data) { if (data && data.field) progress.value.fields = progress.value.fields.concat([data.field]); },
    mapping(data) { if (data && data.mapping) progress.value.mappings = progress.value.mappings.concat([data.mapping]); },
    dictionary(data) { if (data && data.dictionary) progress.value.dictionaries = progress.value.dictionaries.concat([data.dictionary]); },
    review(data) { if (data && data.finding) workflowFindings.value = workflowFindings.value.concat([data.finding]); },
    diff(data) { workflowDiff.value = data.diff || {}; },
    proposal(data) { if (data && data.proposal) { workflowProposalId.value = (data.proposal && data.proposal.id) || workflowProposalId.value; } },
    conflict(data) { if (data && data.conflict) workflowConflicts.value = workflowConflicts.value.concat([data.conflict]); },
    approval_required() { workflowRequiresApproval.value = true; },
    result(data) { handlers.result(data); },
    error(data) { handlers.error(data); }
  };
}

async function runWorkflow(text, options = {}) {
  if (!current.value || props.readOnly || loading.value || bulkRunning.value) return;
  const id = current.value.id;
  const previous = proposal.value || proposals.value[id] || null;
  loading.value = true;
  runStartedAt.value = Date.now();
  error.value = "";
  notice.value = "";
  liveAnswer.value = "";
  runLog.value = [];
  workflowFindings.value = [];
  workflowConflicts.value = [];
  workflowDiff.value = {};
  workflowRequiresApproval.value = false;
  progress.value = { ...emptyProgress(), active: true, stage: "reading_group", message: "正在准备分组智能配置…", total: briefFields.value.length };
  pushRunLine("status", "正在准备分组智能配置…");
  controller = new AbortController();
  const payload = groupPayload(text, options);
  workflowRunId.value = payload.runId;
  workflowThreadId.value = payload.threadId;
  workflowDraftDigest.value = payload.draftDigest;
  const api = options.resume ? assistProductGroupWorkflowResume : assistProductGroupWorkflow;
  try {
    await api(payload, handleWorkflowEvents({
      status(data) {
        progress.value = {
          ...progress.value,
          stage: data.stage || progress.value.stage,
          message: data.message || progress.value.message,
          total: data.total || progress.value.total
        };
        pushRunLine("status", data.message || "");
      },
      result(result) {
        if (!result) return;
        if (!current.value || current.value.id !== id) return;
        workflowIntent.value = result.intent ? { type: result.intent, confidence: result.confidence, plan: result.plan } : workflowIntent.value;
        workflowPlan.value = result.plan || workflowPlan.value;
        workflowFindings.value = result.reviewFindings || workflowFindings.value;
        workflowConflicts.value = result.conflicts || workflowConflicts.value;
        workflowDiff.value = result.diff || workflowDiff.value;
        workflowRequiresApproval.value = !!result.requiresApproval;
        workflowProposalId.value = result.proposalId || workflowProposalId.value;
        if (result.intent === "answer") {
          const answer = String(result.message || liveAnswer.value || "").trim();
          if (answer) {
            messages.value = messages.value.concat([{
              role: "assistant",
              text: answer,
              groupId: id,
              groupLabel: current.value ? current.value.label : id,
              at: Date.now()
            }]);
          }
          liveAnswer.value = "";
          progress.value = emptyProgress();
          return;
        }
        if (result.proposal) {
          commitProposal(result.proposal, !options.reset, previous, {
            selection: result.selection,
            message: result.message || result.proposal.message || ""
          });
        } else if (result.message) {
          messages.value = messages.value.concat([{
            role: "assistant",
            text: String(result.message),
            groupId: id,
            groupLabel: current.value ? current.value.label : id,
            at: Date.now()
          }]);
        }
        progress.value = emptyProgress();
      },
      error(data) {
        error.value = (data && (data.error || data.message)) || "分组智能配置失败";
      }
    }), controller.signal);
  } catch (err) {
    if (err && err.name === "AbortError") {
      loading.value = false;
      progress.value = emptyProgress();
      return;
    }
    error.value = err.message || "分组智能配置失败";
    if (!options.resume) {
      loading.value = false;
      try {
        await runGeneration(String(options.fallbackAction || "refine"), { preserve: !options.reset });
      } catch { /* keep workflow error */ }
    }
  } finally {
    loading.value = false;
    progress.value = emptyProgress();
    controller = null;
  }
}

async function resumeWorkflow() {
  if (!lastWorkflowPayload.value) return;
  await runWorkflow(lastWorkflowPayload.value.text || "继续", { resume: true, approval: true });
}

async function applyReviewFinding(finding) {
  if (!finding || loading.value || props.readOnly) return;
  const text = String(finding.suggestedAction || ("按检查建议调整 " + (finding.targetField || "本组字段"))).trim();
  const group = current.value;
  messages.value = messages.value.concat([{
    role: "user",
    text,
    groupId: group ? group.id : "",
    groupLabel: group ? group.label : "",
    at: Date.now()
  }]);
  await runWorkflow(text, { fallbackAction: "refine" });
  if (finding.targetField) locateTarget(finding.targetField, "assistant");
}

async function handleAssistantSend(text) {
  const value = String(text || "").trim();
  if (!value || loading.value || props.readOnly) return;
  const group = current.value;
  messages.value = messages.value.concat([{
    role: "user",
    text: value,
    groupId: group ? group.id : "",
    groupLabel: group ? group.label : "",
    at: Date.now()
  }]);
  await runWorkflow(value);
}

async function retryWorkflow() {
  if (lastWorkflowPayload.value && lastWorkflowPayload.value.text) {
    await runWorkflow(lastWorkflowPayload.value.text, { fallbackAction: "refine" });
    return;
  }
  regenerate();
}

async function fixAllFindings() {
  const actions = workflowFindings.value.map((finding) => finding.suggestedAction).filter(Boolean);
  if (!actions.length) return;
  await handleAssistantSend("按检查建议调整：" + actions.join("；"));
}

function focusDiff() {
  const diff = document.querySelector(".pgw-diff-wrap");
  if (diff) diff.scrollIntoView({ block: "center", behavior: "smooth" });
}

async function copyResult() {
  const text = proposal.value ? (proposal.value.summary || summarizeDecisionList(proposal.value.decisions || [])) : "";
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    notice.value = "已复制本组配置结果。";
  } catch {
    notice.value = "复制失败，请手动选择文本。";
  }
}

function handleAssistantAction(payload) {
  const key = payload && payload.key;
  if (key === "apply-finding") { applyReviewFinding(payload.finding); return; }
  if (key === "approve") { resumeWorkflow(); return; }
  if (key === "regenerate") { regenerate(); return; }
  if (key === "apply-group") { applyGroup(); return; }
  if (key === "retry") { retryWorkflow(); return; }
  if (key === "fix-all") { fixAllFindings(); return; }
  if (key === "focus-diff") { focusDiff(); return; }
  if (key === "copy-result") { copyResult(); return; }
  if (key === "keep") { notice.value = "已保留当前草稿，未应用模型建议。"; return; }
  if (payload && payload.label) handleAssistantSend(payload.label);
}

function resetAssistantWidth() {
  assistantWidth.value = 360;
}

function toggleSelection(kind, value) {
  if (!current.value) return;
  const id = current.value.id;
  const currentSelection = selections.value[id] || emptySelection();
  const list = currentSelection[kind] || [];
  const next = list.includes(value) ? list.filter((item) => item !== value) : list.concat(value);
  if (kind === "decisions" && list.includes(value)) {
    confirmations.value = {
      ...confirmations.value,
      [id]: (confirmations.value[id] || []).filter((target) => target !== value)
    };
  }
  selections.value = {
    ...selections.value,
    [id]: { ...currentSelection, [kind]: next }
  };
}

function selectAllDecisions() {
  if (!current.value || props.readOnly) return;
  const id = current.value.id;
  const currentSelection = selections.value[id] || emptySelection();
  selections.value = {
    ...selections.value,
    [id]: {
      ...currentSelection,
      decisions: decisions.value.filter((item) => item.decisionType !== "missing").map((item) => item.targetField),
      fields: proposalFields.value.map((item) => item.name),
      mappings: proposalMappings.value.map((item) => item.targetField),
      dictionaries: newDictionaries.value.map((item) => item.dict_code)
    }
  };
}

function clearDecisions() {
  if (!current.value || props.readOnly) return;
  const id = current.value.id;
  const currentSelection = selections.value[id] || emptySelection();
  confirmations.value = { ...confirmations.value, [id]: [] };
  selections.value = {
    ...selections.value,
    [id]: { ...currentSelection, decisions: [], fields: [], mappings: [], dictionaries: [] }
  };
}

function applyGroup() {
  if (bulkRunning.value || props.readOnly || !current.value || !proposal.value) return;
  if (blocked.value) {
    error.value = "存在冲突决策，请先在右侧助手里按检查建议调整后再应用。";
    return;
  }
  const legacy = !decisions.value.length;
  const chosen = decisions.value.filter((item) => (
    item.decisionType !== "missing" && selection.value.decisions.includes(item.targetField)
  ));
  const chosenFields = new Set(chosen.map((item) => item.standardField && item.standardField.name).filter(Boolean));
  const referencedByAny = new Set(decisions.value.map((item) => item.standardField && item.standardField.name).filter(Boolean));
  const fields = [];
  const addField = (field) => {
    if (!field || !field.name || fields.some((item) => item.name === field.name)) return;
    fields.push(field);
  };
  proposalFields.value.forEach((field) => {
    if (!selection.value.fields.includes(field.name)) return;
    if (referencedByAny.has(field.name) && !chosenFields.has(field.name)) return;
    addField(field);
  });
  chosen.forEach((item) => {
    if (item.standardField) addField(item.standardField);
  });

  const mappings = [];
  const addMapping = (mapping) => {
    if (!mapping || !mapping.targetField || mappings.some((item) => item.targetField === mapping.targetField)) return;
    mappings.push(mapping);
  };
  chosen.forEach((item) => {
    if (item.mapping) addMapping(item.mapping);
  });
  proposalMappings.value.forEach((mapping) => {
    if (!legacy && !selection.value.decisions.includes(mapping.targetField)) return;
    if (selection.value.mappings.includes(mapping.targetField)) addMapping(mapping);
  });
  chosen.forEach((item) => {
    if (item.mapping) return;
    if ((item.decisionType === "reuse" || item.decisionType === "create") && item.standardField) {
      addMapping({
        targetField: item.targetField,
        sourceField: item.standardField.name,
        mappingType: "direct",
        defaultValue: null
      });
    } else if (item.decisionType === "default") {
      const value = item.defaultValue || "";
      if (value) {
        addMapping({ targetField: item.targetField, sourceField: "", mappingType: "constant", defaultValue: value });
      }
    }
  });

  const dictionaries = newDictionaries.value.filter((item) => selection.value.dictionaries.includes(item.dict_code));
  const hasOutput = chosen.length > 0 || fields.length > 0 || mappings.length > 0;
  if (newGroups.value.length && hasOutput) emit("apply-groups", newGroups.value);
  if (dictionaries.length && hasOutput) emit("apply-dictionaries", dictionaries);
  if (fields.length) emit("apply-fields", fields);
  if (mappings.length) emit("apply-mappings", mappings);
  const id = current.value.id;
  statuses.value = { ...statuses.value, [id]: "confirmed" };
  confirmations.value = { ...confirmations.value, [id]: chosen.map((item) => item.targetField) };
  appliedStats.value = {
    ...appliedStats.value,
    [id]: {
      decisions: chosen.length,
      fields: fields.length,
      mappings: mappings.length,
      dictionaries: dictionaries.length,
      proposedDecisions: decisions.value.length,
      proposedFields: proposalFields.value.length,
      proposedMappings: proposalMappings.value.length
    }
  };
  notice.value = "本组已应用到本地草稿：决策 " + chosen.length + " 条、字段 " + fields.length + " 个、映射 " + mappings.length + " 条、字典 " + dictionaries.length + " 个，尚未保存。";
}

function skipGroup() {
  if (bulkRunning.value || !current.value || props.readOnly) return;
  const id = current.value.id;
  statuses.value = { ...statuses.value, [id]: "skipped" };
  confirmations.value = { ...confirmations.value, [id]: [] };
  nextGroup();
}

async function resetFlow() {
  if (bulkRunning.value) return;
  const yes = await askConfirm(
    "重置会删除当前版本和产品族的本地分组进度、勾选与确认状态，并重新拉取分组计划。",
    { title: "重置分组进度", confirmText: "重置", danger: true }
  );
  if (!yes) return;
  try { localStorage.removeItem(storageKey.value); } catch { /* ignore */ }
  bulkRunning.value = false;
  bulkStop.value = false;
  bulkDone.value = 0;
  bulkTotal.value = 0;
  resetData();
  notice.value = "已重置分组进度和对话。";
  start();
}

function nextGroup() {
  if (bulkRunning.value) return;
  const next = plan.value.findIndex((group, index) => index > currentIndex.value && !["confirmed", "skipped"].includes(statuses.value[group.id]));
  if (next >= 0) {
    openGroup(next);
    return;
  }
  const first = plan.value.findIndex((group) => !["confirmed", "skipped"].includes(statuses.value[group.id]));
  if (first >= 0) openGroup(first);
}

function prevGroup() {
  if (bulkRunning.value) return;
  if (currentIndex.value > 0) openGroup(currentIndex.value - 1);
}

function moveGroup(index, delta) {
  if (bulkRunning.value) return;
  const target = index + delta;
  if (target < 0 || target >= plan.value.length) return;
  const list = plan.value.slice();
  const [item] = list.splice(index, 1);
  list.splice(target, 0, item);
  plan.value = list;
  if (currentIndex.value === index) currentIndex.value = target;
  else if (currentIndex.value === target) currentIndex.value = index;
}

function exportAllDraft() {
  const body = {
    product: props.family,
    version: props.version,
    plan: plan.value,
    statuses: statuses.value,
    proposals: proposals.value,
    selections: selections.value,
    confirmations: confirmations.value,
    appliedStats: appliedStats.value
  };
  const blob = new Blob([JSON.stringify(body, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = (props.family || "PRODUCT") + "_分组生成草稿.json";
  a.click();
  URL.revokeObjectURL(a.href);
}

function exportGroup() {
  if (!current.value) return;
  const body = {
    group: { id: current.value.id, label: current.value.label, stats: current.value.stats },
    brief: brief.value,
    proposal: proposal.value,
    selection: selection.value,
    confirmations: currentConfirmations.value
  };
  const blob = new Blob([JSON.stringify(body, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "GROUP_" + current.value.id + ".json";
  a.click();
  URL.revokeObjectURL(a.href);
}

function saveAll() {
  emit("save-all");
}

function closeDetails(event) {
  const details = event && event.currentTarget && event.currentTarget.closest("details");
  if (details) details.open = false;
}

function handleExportAll(event) {
  closeDetails(event);
  exportAllDraft();
}

function handleReset(event) {
  closeDetails(event);
  resetFlow();
}

function locateTarget(targetField, source = "field") {
  if (!targetField) return;
  activeTarget.value = targetField;
  if (proposalTab.value !== "overview" && proposal.value) proposalTab.value = "overview";
  nextTick(() => {
    const safe = window.CSS && CSS.escape ? CSS.escape(targetField) : targetField;
    const selector = source === "field"
      ? '[data-target="' + safe + '"]'
      : source === "decision"
        ? '[data-field="' + safe + '"]'
        : '[data-target="' + safe + '"]';
    const row = document.querySelector(selector);
    if (row) {
      const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      row.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
    }
  });
}

function openAssistant() {
  assistantOpen.value = true;
}

function showMissing(targetField) {
  if (!targetField) return;
  activeTarget.value = targetField;
  proposalTab.value = "missing";
  nextTick(() => {
    const safe = window.CSS && CSS.escape ? CSS.escape(targetField) : targetField;
    const row = document.querySelector('[data-target="' + safe + '"]');
    if (row) row.scrollIntoView({ block: "nearest", behavior: "auto" });
  });
}

function toggleLeft() {
  leftCollapsed.value = !leftCollapsed.value;
}

function toggleAssistant() {
  assistantOpen.value = !assistantOpen.value;
}

function startResize(event) {
  leftResizing.value = true;
  resizeStartX = event.clientX;
  resizeStartWidth = leftWidth.value;
  window.addEventListener("mousemove", onResize);
  window.addEventListener("mouseup", stopResize);
}

function onResize(event) {
  if (!leftResizing.value) return;
  const next = resizeStartWidth + (event.clientX - resizeStartX);
  leftWidth.value = Math.max(180, Math.min(460, next));
}

function stopResize() {
  leftResizing.value = false;
  window.removeEventListener("mousemove", onResize);
  window.removeEventListener("mouseup", stopResize);
}

function startAssistantResize(event) {
  assistantResizing.value = true;
  assistantResizeStartX = event.clientX;
  assistantResizeStartWidth = assistantWidth.value;
  window.addEventListener("mousemove", onAssistantResize);
  window.addEventListener("mouseup", stopAssistantResize);
}

function onAssistantResize(event) {
  if (!assistantResizing.value) return;
  const next = assistantResizeStartWidth - (event.clientX - assistantResizeStartX);
  assistantWidth.value = Math.max(300, Math.min(480, next));
}

function stopAssistantResize() {
  assistantResizing.value = false;
  window.removeEventListener("mousemove", onAssistantResize);
  window.removeEventListener("mouseup", stopAssistantResize);
}
</script>

<template>
  <Drawer :open="open" full flush headless title="分组生成向导" @close="emit('close')">
    <div class="pgw-app">
      <div class="pgw-top">
        <span class="pgw-pill">分组生成向导</span>
        <div class="pgw-crumb">
          {{ family || "产品" }} <span>/</span> {{ version || "监管版本" }}
          <strong v-if="brief">{{ brief.label }}</strong>
        </div>
        <span class="spacer"></span>
        <button type="button" class="btn sm" @click="toggleLeft">{{ leftCollapsed ? "显示分组计划" : "隐藏分组计划" }}</button>
        <button type="button" class="btn sm" @click="toggleAssistant">{{ assistantOpen ? "收起助手" : "显示助手" }}</button>
        <button type="button" class="btn sm primary" :disabled="readOnly || !plan.length" @click="saveAll">保存全部</button>
        <details class="pgw-more">
          <summary class="btn sm">更多 ▾</summary>
          <div class="pgw-more-list" role="menu">
            <button type="button" role="menuitem" @click="handleExportAll($event)">导出全部草稿 JSON</button>
            <button type="button" role="menuitem" @click="handleReset($event)">重置分组进度</button>
          </div>
        </details>
        <button type="button" class="btn sm" @click="emit('close')">关闭</button>
      </div>

      <div class="pgw-body">
        <GroupPlanRail
          v-show="!leftCollapsed"
          :style="{ width: leftWidth + 'px' }"
          :plan="plan"
          :current-index="currentIndex"
          :statuses="statuses"
          :applied-stats="appliedStats"
          :bulk-running="bulkRunning"
          :bulk-done="bulkDone"
          :bulk-total="bulkTotal"
          :read-only="readOnly"
          @select="openGroup"
          @move="moveGroup"
          @reset="resetFlow"
          @bulk="toggleBulk"
        />
        <div
          v-if="!leftCollapsed"
          class="pgw-splitter"
          :class="{ active: leftResizing }"
          title="拖动调整分组计划宽度"
          @mousedown.prevent="startResize"
          @dblclick="toggleLeft"
        ></div>

        <main class="pgw-main">
          <GroupHeader
            v-if="current"
            :group="current"
            :status="currentStatus"
            :finished="finished"
            :read-only="readOnly"
            :bulk-running="bulkRunning"
            @prev="prevGroup"
            @next="nextGroup"
            @skip="skipGroup"
            @export="exportGroup"
          />

          <div class="pgw-scroll">
            <p v-if="error" class="notice danger">{{ error }}</p>
            <p v-if="notice" class="notice info">{{ notice }}</p>

            <div v-if="loading && !plan.length" class="pgw-empty">正在读取分组计划…</div>
            <div v-else-if="!plan.length" class="pgw-empty">还没有分组计划。</div>
            <template v-else>
              <RegulatoryFieldSection
                :fields="briefFields"
                :proposal="proposal"
                :findings="workflowFindings"
                :active-target="activeTarget"
                :loading="briefLoading"
                :read-only="readOnly"
                :has-group="!!current"
                @locate-target="(target) => locateTarget(target, 'field')"
                @generate="generate"
                @show-missing="showMissing"
              />

              <DecisionSection
                :proposal="proposal"
                :selection="selection"
                :confirmations="currentConfirmations"
                :findings="workflowFindings"
                :active-target="activeTarget"
                :tab="proposalTab"
                :loading="loading"
                :read-only="readOnly"
                :progress="progress"
                :generated-at="generatedAt"
                :group-label="current ? current.label : ''"
                :group-status="currentStatus"
                :diff="diffForDisplay"
                :conflicts="workflowConflicts"
                :blocked="blocked"
                :blocked-count="blockedCount"
                :requires-approval="workflowRequiresApproval"
                :brief-fields="briefFields"
                @generate="generate"
                @regenerate="regenerate"
                @regenerate-fresh="regenerateFresh"
                @apply="applyGroup"
                @toggle-selection="toggleSelection"
                @select-all="selectAllDecisions"
                @clear-selection="clearDecisions"
                @change-tab="(tab) => proposalTab = tab"
                @locate-target="(target) => locateTarget(target, 'decision')"
                @locate-diff="(target) => locateTarget(target, 'diff')"
                @open-assistant="openAssistant"
              />
            </template>
          </div>
        </main>

        <ProductGroupAssistant
          v-if="assistantOpen"
          :width="assistantWidth"
          :resizing="assistantResizing"
          :status-text="assistantStatus.text"
          :status-tone="assistantStatus.tone"
          :group-label="current ? current.label : '当前分组'"
          :events="assistantEvents"
          :filter="assistantFilter"
          :loading="loading"
          :read-only="readOnly"
          :quick-actions="assistantQuickActions"
          :model-value="assistantDraft"
          @update:model-value="assistantDraft = $event"
          @update:filter="assistantFilter = $event"
          @send="handleAssistantSend"
          @action="handleAssistantAction"
          @resize-start="startAssistantResize"
          @resize-reset="resetAssistantWidth"
          @close="assistantOpen = false"
        />
        <div v-if="assistantOpen" class="pgw-assistant-backdrop" @click="assistantOpen = false"></div>
      </div>
    </div>
  </Drawer>
</template>
