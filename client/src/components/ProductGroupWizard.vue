<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import Drawer from "@/components/Drawer.vue";
import { assistProductGroup, assistProductGroupStream } from "@/api/product";
import { agentHtml } from "@/utils/agentText";

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

const DECISION_LABELS = {
  reuse: "复用",
  create: "新建",
  default: "默认值",
  system: "系统计算",
  skip: "跳过",
  missing: "缺失"
};
const DECISION_CLASSES = {
  reuse: "mint",
  create: "blue",
  default: "amber",
  system: "violet",
  skip: "gray",
  missing: "rose"
};
const MAPPING_TYPE_LABELS = {
  direct: "直接映射",
  constant: "固定默认值",
  transform: "码值转换",
  conditional: "条件映射",
  calculation: "计算派生",
  composite: "组合映射"
};
const TRANSFORM_TYPE_LABELS = {
  direct: "直接复制",
  constant: "常量赋值",
  code_mapping: "码值转换",
  conditional: "条件映射",
  calculation: "计算派生",
  numeric_conversion: "数值换算",
  date_conversion: "日期转换",
  composite: "组合映射"
};
const STAGE_LABELS = {
  reading_group: "读取监管字段",
  analyzing: "分析规则用途",
  generating: "生成字段级决策",
  answering: "整理详细回答",
  done: "生成完成"
};
const EMPTY_PROGRESS = () => ({
  active: false,
  stage: "",
  message: "",
  done: 0,
  total: 0,
  decisions: [],
  fields: [],
  mappings: [],
  dictionaries: []
});
const EMPTY_SELECTION = () => ({ decisions: [], fields: [], mappings: [], dictionaries: [] });
// 对话按产品保存完整历史；发给模型时再按条数和字符预算裁剪。
const SESSION_SCHEMA = 2;
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
const input = ref("");
const statuses = ref({});
const proposals = ref({});
const previousProposals = ref({});
const selections = ref({});
const appliedStats = ref({});
const proposalTab = ref("overview");
const generatedAt = ref("");
const confirmSkip = ref(false);
const confirmFresh = ref(false);
const progress = ref(EMPTY_PROGRESS());
const expandedField = ref("");
const expandedDecision = ref("");
const expandedProposalField = ref("");
const expandedProposalMapping = ref("");
const liveAnswer = ref("");
const fieldFilters = ref({ required: false, unmapped: false, system: false, type: "", keyword: "" });
let saveTimer = null;
let controller = null;
let storageWarned = false;

const storageKey = computed(() => "rwa.productGroupWizard." + (props.version || "") + "." + (props.family || ""));
const exposureClassKey = computed(() => props.exposureClasses.slice().sort().join("|"));
const current = computed(() => plan.value[currentIndex.value] || null);
const currentStatus = computed(() => (current.value ? statuses.value[current.value.id] || "pending" : ""));
const isLastPending = computed(() => plan.value.every((group, index) => {
  if (index === currentIndex.value) return true;
  const status = statuses.value[group.id];
  return status === "confirmed" || status === "skipped";
}));
const finished = computed(() => plan.value.length > 0 && plan.value.every((group) => {
  const status = statuses.value[group.id];
  return status === "confirmed" || status === "skipped";
}));
const confirmedCount = computed(() => plan.value.filter((group) => statuses.value[group.id] === "confirmed").length);
const skippedCount = computed(() => plan.value.filter((group) => statuses.value[group.id] === "skipped").length);
const progressPct = computed(() => plan.value.length ? Math.round(((confirmedCount.value + skippedCount.value) / plan.value.length) * 100) : 0);
const quickChips = computed(() => ["只处理必填字段", "复用已有标准字段", "固定默认值不建字段", "重新生成本组"]);
const adoption = computed(() => {
  let appliedFields = 0;
  let proposedFields = 0;
  let appliedMappings = 0;
  let proposedMappings = 0;
  let appliedDecisions = 0;
  let proposedDecisions = 0;
  Object.values(appliedStats.value).forEach((item) => {
    appliedFields += Number(item.fields) || 0;
    proposedFields += Number(item.proposedFields) || 0;
    appliedMappings += Number(item.mappings) || 0;
    proposedMappings += Number(item.proposedMappings) || 0;
    appliedDecisions += Number(item.decisions) || 0;
    proposedDecisions += Number(item.proposedDecisions) || 0;
  });
  return { fields: appliedFields, proposedFields, mappings: appliedMappings, proposedMappings, decisions: appliedDecisions, proposedDecisions };
});

const briefFields = computed(() => (brief.value && brief.value.fields) || []);
const visibleFields = computed(() => {
  const filter = fieldFilters.value;
  const keyword = String(filter.keyword || "").trim().toLowerCase();
  return briefFields.value.filter((field) => {
    const profile = fieldProfile(field);
    if (filter.required && !field.required) return false;
    if (filter.unmapped && field.mapped) return false;
    if (filter.system && !field.systemCalc) return false;
    if (filter.type && (field.type || "string") !== filter.type) return false;
    if (!keyword) return true;
    const hay = [
      field.name, field.label, profile.definition, profile.note,
      ...(field.usedBy || []).map((rule) => [rule.ruleId, rule.ruleLabel, rule.path, rule.whenText, rule.note].join(" "))
    ].join(" ").toLowerCase();
    return hay.includes(keyword);
  });
});
const fieldTypeOptions = computed(() => Array.from(new Set(briefFields.value.map((field) => field.type || "string"))));

const proposalFields = computed(() => (proposal.value && proposal.value.standardFields) || []);
const proposalMappings = computed(() => (proposal.value && proposal.value.mappings) || []);
const decisions = computed(() => (proposal.value && proposal.value.decisions) || []);
const newGroups = computed(() => (proposal.value && proposal.value.newStandardGroups) || []);
const newDictionaries = computed(() => (proposal.value && proposal.value.newDictionaries) || []);
const dictionaryIndex = computed(() => {
  const map = new Map();
  briefFields.value.forEach((field) => {
    const dict = field.profile && field.profile.dictionary;
    if (dict && dict.dict_code) map.set(dict.dict_code, dict);
  });
  ((proposal.value && proposal.value.newDictionaries) || []).forEach((dict) => {
    if (dict && dict.dict_code) map.set(dict.dict_code, dict);
  });
  ((proposal.value && proposal.value.standardFields) || []).forEach((field) => {
    const dict = field && field.dictionaryDetail;
    if (dict && dict.dict_code && !map.has(dict.dict_code)) map.set(dict.dict_code, dict);
  });
  return map;
});
const targetsByStandardField = computed(() => {
  const map = new Map();
  decisions.value.forEach((item) => {
    const name = item.standardField && item.standardField.name;
    if (!name) return;
    if (!map.has(name)) map.set(name, []);
    map.get(name).push({ targetField: item.targetField, targetLabel: item.targetLabel || item.targetField });
  });
  return map;
});
const missing = computed(() => (proposal.value && proposal.value.missing) || []);
const suggestions = computed(() => (proposal.value && proposal.value.suggestions) || []);
const decisionTotal = computed(() => decisions.value.length);
const decisionStats = computed(() => {
  const counts = { reuse: 0, create: 0, default: 0, system: 0, skip: 0, missing: 0 };
  decisions.value.forEach((item) => {
    counts[item.decisionType] = (counts[item.decisionType] || 0) + 1;
  });
  return counts;
});
const selection = computed(() => {
  const id = current.value ? current.value.id : "";
  const raw = selections.value[id];
  if (!raw) return EMPTY_SELECTION();
  return {
    decisions: Array.isArray(raw.decisions) ? raw.decisions : [],
    fields: Array.isArray(raw.fields) ? raw.fields : [],
    mappings: Array.isArray(raw.mappings) ? raw.mappings : [],
    dictionaries: Array.isArray(raw.dictionaries) ? raw.dictionaries : []
  };
});
const selectedDecisionCount = computed(() => selection.value.decisions.length);
const decisionSummary = computed(() => summarizeDecisionList(decisions.value));
const streamPct = computed(() => {
  if (!progress.value.total) return progress.value.active ? 8 : 0;
  return Math.min(100, Math.round(((progress.value.done || 0) / progress.value.total) * 100));
});
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

watch(() => props.open, (open) => {
  if (!open) {
    if (controller) controller.abort();
    saveSession();
    return;
  }
  error.value = "";
  notice.value = "";
  if (plan.value.length && loadedClassKey.value !== exposureClassKey.value) {
    plan.value = [];
    currentIndex.value = 0;
    brief.value = null;
    proposal.value = null;
    statuses.value = {};
    proposals.value = {};
    previousProposals.value = {};
    selections.value = {};
    appliedStats.value = {};
    messages.value = [];
    progress.value = EMPTY_PROGRESS();
  }
  if (!plan.value.length) start();
});

watch(exposureClassKey, (key) => {
  if (!props.open || bulkRunning.value || key === loadedClassKey.value) return;
  plan.value = [];
  currentIndex.value = 0;
  brief.value = null;
  proposal.value = null;
  statuses.value = {};
  proposals.value = {};
  previousProposals.value = {};
  selections.value = {};
  appliedStats.value = {};
  messages.value = [];
  progress.value = EMPTY_PROGRESS();
  start();
});

watch([plan, currentIndex, statuses, proposals, previousProposals, selections, appliedStats, messages], () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveSession, 300);
}, { deep: true });

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
      selections: selections.value,
      appliedStats: appliedStats.value,
      messages: messages.value,
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
    currentIndex.value = Number(data.currentIndex) || 0;
    statuses.value = data.statuses || {};
    proposals.value = data.proposals || {};
    previousProposals.value = data.previousProposals || {};
    selections.value = data.selections || {};
    appliedStats.value = data.appliedStats || {};
    messages.value = restoreMessages(data.messages);
    return true;
  } catch {
    return false;
  }
}

onMounted(() => window.addEventListener("beforeunload", saveSession));
onBeforeUnmount(() => {
  window.removeEventListener("beforeunload", saveSession);
  clearTimeout(saveTimer);
});

function messageSize(item) {
  return String(item.text || "").length + String(item.note || "").length;
}

// 保存和展示用完整对话；调用模型时保留首条 + 最近若干条，并按字符预算裁剪。
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
      await openGroup(currentIndex.value, true);
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
    messages.value = [];
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
  confirmSkip.value = false;
  confirmFresh.value = false;
  generatedAt.value = "";
  expandedField.value = "";
  expandedDecision.value = "";
  expandedProposalField.value = "";
  expandedProposalMapping.value = "";
  fieldFilters.value = { required: false, unmapped: false, system: false, type: "", keyword: "" };
  progress.value = EMPTY_PROGRESS();
  liveAnswer.value = "";
  proposalTab.value = "overview";
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

function applyProposal(data, preserve = false, previous = null) {
  if (!current.value || !data) return;
  const id = current.value.id;
  const groupLabel = current.value.label || id;
  if (previous) {
    previousProposals.value = { ...previousProposals.value, [id]: previous };
  }
  proposal.value = data;
  proposals.value = { ...proposals.value, [id]: data };
  generatedAt.value = new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  const old = selections.value[id];
  if (preserve && old) {
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
        fields: keepNewOrSelected(
          previous && previous.standardFields,
          data.standardFields,
          old.fields,
          (item) => item.name
        ),
        mappings: keepNewOrSelected(
          previous && previous.mappings,
          data.mappings,
          old.mappings,
          (item) => item.targetField
        ),
        dictionaries: keepNewOrSelected(
          previous && previous.newDictionaries,
          data.newDictionaries,
          old.dictionaries,
          (item) => item.dict_code
        )
      }
    };
  } else {
    selectProposal(data);
  }
  statuses.value = { ...statuses.value, [id]: "proposal_ready" };
  const summary = summarizeDecisionList(data.decisions || []);
  const message = String(data.message || "").trim();
  messages.value = messages.value.concat([{
    role: "assistant",
    text: message || summary,
    note: message && message !== summary ? summary : "",
    groupId: id,
    groupLabel,
    at: Date.now()
  }]);
}

async function runGeneration(action, options = {}) {
  if (!current.value || props.readOnly || loading.value) return;
  const id = current.value.id;
  const groupLabel = current.value.label || id;
  const previous = proposal.value || proposals.value[id] || null;
  const isAnswer = action === "answer";
  loading.value = true;
  error.value = "";
  notice.value = "";
  liveAnswer.value = "";
  progress.value = {
    ...EMPTY_PROGRESS(),
    active: true,
    stage: "reading_group",
    message: isAnswer ? "正在读取本组字段、字典和映射…" : "正在准备本组监管字段画像…",
    total: briefFields.value.length
  };
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
        },
        field(data) {
          if (data && data.field) progress.value.fields = progress.value.fields.concat([data.field]);
        },
        mapping(data) {
          if (data && data.mapping) progress.value.mappings = progress.value.mappings.concat([data.mapping]);
        },
        dictionary(data) {
          if (data && data.dictionary) progress.value.dictionaries = progress.value.dictionaries.concat([data.dictionary]);
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
      progress.value = EMPTY_PROGRESS();
      return;
    }
    error.value = err.message || "";
  }
  if (!result) {
    try {
      result = await assistProductGroup(payload);
    } catch (err) {
      error.value = err.message || (isAnswer ? "回答本组问题失败" : (action === "refine" ? "调整本组建议失败" : "生成本组建议失败"));
      progress.value = EMPTY_PROGRESS();
      liveAnswer.value = "";
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
    progress.value = EMPTY_PROGRESS();
    error.value = "";
    loading.value = false;
    controller = null;
    return;
  }
  progress.value = EMPTY_PROGRESS();
  error.value = "";
  // 请求期间切了分组就不要把结果写进新分组。
  if (!current.value || current.value.id !== id) {
    loading.value = false;
    controller = null;
    return;
  }
  applyProposal(result, options.preserve === true, previous);
  loading.value = false;
  controller = null;
}

function generate() {
  runGeneration("propose", { preserve: false });
}

function noteRegenerate(text) {
  if (!current.value || props.readOnly || loading.value || bulkRunning.value) return false;
  confirmFresh.value = false;
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
  runGeneration("propose", { preserve: true });
}

function regenerateFresh() {
  confirmFresh.value = false;
  if (!noteRegenerate("清空勾选后重新生成本组")) return;
  runGeneration("propose", { preserve: false });
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

async function send() {
  const text = input.value.trim();
  if (!text || loading.value || props.readOnly) return;
  input.value = "";
  const group = current.value;
  messages.value = messages.value.concat([{
    role: "user",
    text,
    groupId: group ? group.id : "",
    groupLabel: group ? group.label : "",
    at: Date.now()
  }]);
  await runGeneration(looksLikeQuestion(text) ? "answer" : "refine", { preserve: true });
}

function toggleSelection(kind, value) {
  if (!current.value) return;
  const id = current.value.id;
  const currentSelection = selections.value[id] || EMPTY_SELECTION();
  const list = currentSelection[kind] || [];
  const next = list.includes(value) ? list.filter((item) => item !== value) : list.concat(value);
  selections.value = {
    ...selections.value,
    [id]: { ...currentSelection, [kind]: next }
  };
}

function selectAllDecisions() {
  if (!current.value) return;
  const id = current.value.id;
  const currentSelection = selections.value[id] || EMPTY_SELECTION();
  selections.value = {
    ...selections.value,
    [id]: {
      ...currentSelection,
      decisions: decisions.value
        .filter((item) => item.decisionType !== "missing")
        .map((item) => item.targetField),
      fields: proposalFields.value.map((item) => item.name),
      mappings: proposalMappings.value.map((item) => item.targetField),
      dictionaries: newDictionaries.value.map((item) => item.dict_code)
    }
  };
}

function clearDecisions() {
  if (!current.value) return;
  const id = current.value.id;
  const currentSelection = selections.value[id] || EMPTY_SELECTION();
  selections.value = {
    ...selections.value,
    [id]: { ...currentSelection, decisions: [], fields: [], mappings: [], dictionaries: [] }
  };
}

function applyGroup() {
  if (bulkRunning.value || props.readOnly || !current.value || !proposal.value) return;
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
  if (bulkRunning.value || !current.value) return;
  statuses.value = { ...statuses.value, [current.value.id]: "skipped" };
  confirmSkip.value = false;
  nextGroup();
}

function resetFlow() {
  if (bulkRunning.value) return;
  try { localStorage.removeItem(storageKey.value); } catch { /* ignore */ }
  bulkRunning.value = false;
  bulkStop.value = false;
  bulkDone.value = 0;
  bulkTotal.value = 0;
  plan.value = [];
  currentIndex.value = 0;
  brief.value = null;
  proposal.value = null;
  statuses.value = {};
  proposals.value = {};
  previousProposals.value = {};
  selections.value = {};
  appliedStats.value = {};
  messages.value = [];
  confirmSkip.value = false;
  confirmFresh.value = false;
  progress.value = EMPTY_PROGRESS();
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
    appliedStats: appliedStats.value
  };
  const blob = new Blob([JSON.stringify(body, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = (props.family || "PRODUCT") + "_分组生成草稿.json";
  a.click();
  URL.revokeObjectURL(a.href);
}

function quickAction(text) {
  if (text === "重新生成本组") {
    regenerate();
    return;
  }
  input.value = text;
  send();
}

function exportGroup() {
  if (!current.value) return;
  const body = {
    group: { id: current.value.id, label: current.value.label, stats: current.value.stats },
    brief: brief.value,
    proposal: proposal.value,
    selection: selection.value
  };
  const blob = new Blob([JSON.stringify(body, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "GROUP_" + current.value.id + ".json";
  a.click();
  URL.revokeObjectURL(a.href);
}

function groupAdoption(group) {
  const stat = appliedStats.value[group.id];
  if (!stat) return "";
  return "决策 " + stat.decisions + "/" + stat.proposedDecisions + " · 字段 " + stat.fields + "/" + stat.proposedFields;
}

function statusText(group) {
  const status = statuses.value[group.id];
  if (status === "confirmed") return "已确认";
  if (status === "skipped") return "已跳过";
  if (status === "proposal_ready") return "已生成";
  return "未处理";
}

function showGroupDivider(index) {
  const item = messages.value[index];
  if (!item || !item.groupId) return false;
  if (index === 0) return true;
  return messages.value[index - 1].groupId !== item.groupId;
}

function saveAll() {
  emit("save-all");
}

function fieldProfile(field) {
  if (field && field.profile) return field.profile;
  return {
    definition: (field && field.label) || "",
    note: "",
    type: (field && field.type) || "string",
    source: "column",
    required: !!(field && field.required),
    missingPolicy: "",
    options: (field && field.options) || [],
    dictionary: null,
    dictionaryCode: "",
    systemCalc: !!(field && field.systemCalc),
    derivation: null,
    rules: (field && field.usedBy) || [],
    mapped: !!(field && field.mapped),
    mapping: null,
    standardField: null
  };
}

function fieldTypeLabel(type) {
  return {
    string: "文本",
    number: "数值",
    boolean: "布尔",
    date: "日期",
    enum: "枚举",
    constant: "常量",
    derived: "派生"
  }[type] || type || "文本";
}

function dictionaryOf(code) {
  if (!code) return null;
  return dictionaryIndex.value.get(code) || null;
}

function dictionaryItems(code) {
  const dict = dictionaryOf(code);
  return (dict && dict.items) || [];
}

function dictionaryTitle(code) {
  const dict = dictionaryOf(code);
  return dict ? (dict.dict_name || dict.dict_code) : (code || "");
}

function servedTargets(field) {
  const attached = field && field.servedTargetFields;
  if (Array.isArray(attached) && attached.length) return attached;
  return targetsByStandardField.value.get(field && field.name) || [];
}

function briefFieldOf(name) {
  return briefFields.value.find((field) => field.name === name) || null;
}

function rulesOfTarget(name) {
  const field = briefFieldOf(name);
  return (field && field.usedBy) || [];
}

function mappingTypeLabel(type) {
  return MAPPING_TYPE_LABELS[type] || type || "直接映射";
}

function transformTypeLabel(type) {
  return TRANSFORM_TYPE_LABELS[type] || (type ? type + " 转换" : "直接复制");
}

function mappingTransformLabel(mapping) {
  const type = (mapping && mapping.transform && mapping.transform.type) || (mapping && mapping.transformType);
  if (type) return transformTypeLabel(type);
  return mappingTypeLabel(mapping && mapping.mappingType);
}

function mappingCodeRows(mapping) {
  const table = mapping && mapping.transform && mapping.transform.mapping;
  if (!table || typeof table !== "object") return [];
  return Object.entries(table).map(([source, target]) => ({ source, target }));
}

function mappingInputs(mapping) {
  return (mapping && mapping.transform && mapping.transform.inputs) || [];
}

function sourceFieldText(mapping) {
  if (!mapping) return "";
  if (mapping.mappingType === "constant") return mapping.defaultValue || "（空）";
  return mapping.sourceField || "";
}

function sourceFieldLabel(mapping) {
  const name = sourceFieldText(mapping);
  if (!name) return "";
  const label = mapping && mapping.sourceLabel;
  return label && label !== name ? label + " · " + name : name;
}

function mappingTransformSummary(mapping) {
  if (!mapping) return "—";
  if (mapping.mappingType === "constant") return "固定为 " + (mapping.defaultValue || "（空）");
  const rows = mappingCodeRows(mapping);
  if (rows.length) return rows.length + " 条码值映射";
  const expression = mapping.transform && mapping.transform.expression;
  if (expression) return expression;
  const inputs = mappingInputs(mapping);
  if (inputs.length) return "输入 " + inputs.join("、");
  return mapping.mappingType === "direct" ? "直接复制" : "—";
}

function toggleProposalField(name) {
  expandedProposalField.value = expandedProposalField.value === name ? "" : name;
}

function toggleProposalMapping(target) {
  expandedProposalMapping.value = expandedProposalMapping.value === target ? "" : target;
}

const QUESTION_HINTS = ["?", "？", "什么", "是什么", "为什么", "哪些", "哪个", "怎么", "如何", "详细", "解释", "介绍", "列出", "包含", "说明", "查一下", "看看", "是否", "有没有", "多少"];
const REFINE_HINTS = ["重新生成", "只处理", "复用已有", "固定默认值", "不建", "跳过", "改成", "改为", "不要", "换成", "新增", "删除", "应用"];

function looksLikeQuestion(text) {
  const value = String(text || "");
  if (REFINE_HINTS.some((word) => value.includes(word))) return false;
  return QUESTION_HINTS.some((word) => value.includes(word));
}

function fieldValueText(field) {
  const profile = fieldProfile(field);
  if (profile.systemCalc) {
    return profile.derivation ? profile.derivation.kindLabel : "系统计算";
  }
  if (profile.dictionary) {
    return "字典 " + profile.dictionary.dict_name + "（" + (profile.dictionary.items || []).length + " 个码值）";
  }
  if ((profile.options || []).length) return (profile.options || []).length + " 个取值";
  if (profile.type === "enum") return "待补充枚举";
  return "—";
}

function fieldMappingText(field) {
  const profile = fieldProfile(field);
  if (profile.systemCalc) return "系统计算";
  const mapping = profile.mapping;
  if (!mapping) return field.mapped ? "已映射" : "未映射";
  if (mapping.mappingType === "constant") return "默认值 " + (mapping.defaultValue || "（空）");
  return mapping.sourceField || "—";
}

function optionText(option) {
  if (!option) return "";
  return (option.code || "") + (option.label && option.label !== option.code ? " · " + option.label : "");
}

function ruleSummary(rule) {
  return [rule.path, rule.whenText, rule.note, rule.article].filter(Boolean).join(" · ");
}

function stageLabel(stage) {
  return STAGE_LABELS[stage] || stage || "生成中";
}

function decisionLabel(type) {
  return DECISION_LABELS[type] || type;
}

function decisionClass(type) {
  return DECISION_CLASSES[type] || "gray";
}

function decisionStandardText(item) {
  if (item.decisionType === "default") return "不建标准字段";
  if (item.decisionType === "system") return "系统计算";
  if (item.standardField) return item.standardField.name;
  return "—";
}

function decisionMappingText(item) {
  if (item.decisionType === "system") return "系统派生";
  if (item.decisionType === "skip") return "跳过";
  if (item.decisionType === "missing") return "待人工处理";
  const mapping = item.mapping;
  if (!mapping) return "—";
  if (mapping.mappingType === "constant") return "默认值 " + (mapping.defaultValue || "（空）");
  return mapping.sourceField || "—";
}

function decisionDictionaryText(item) {
  return item.dictionary ? item.dictionary.dict_code : "—";
}

function decisionSignature(item) {
  return [
    item.decisionType,
    item.standardField ? item.standardField.name : "",
    item.mapping ? item.mapping.mappingType : "",
    item.mapping ? (item.mapping.sourceField || "") : "",
    item.mapping ? (item.mapping.defaultValue || "") : ""
  ].join("|");
}

function summarizeDecisionList(list) {
  const labels = [
    ["reuse", "复用"],
    ["create", "新建"],
    ["default", "默认值"],
    ["system", "系统计算"],
    ["skip", "跳过"],
    ["missing", "缺失"]
  ];
  const rows = Array.isArray(list) ? list : [];
  const counts = { reuse: 0, create: 0, default: 0, system: 0, skip: 0, missing: 0 };
  rows.forEach((item) => {
    counts[item.decisionType] = (counts[item.decisionType] || 0) + 1;
  });
  const parts = labels.filter(([key]) => counts[key]).map(([key, label]) => label + " " + counts[key]);
  return "本组 " + rows.length + " 个监管字段" + (parts.length ? "：" + parts.join("、") : "");
}

function toggleDecisionDetail(target) {
  expandedDecision.value = expandedDecision.value === target ? "" : target;
}

function toggleFieldDetail(name) {
  expandedField.value = expandedField.value === name ? "" : name;
}

function resetFilters() {
  fieldFilters.value = { required: false, unmapped: false, system: false, type: "", keyword: "" };
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
        <button type="button" class="btn sm" :disabled="readOnly || (!bulkRunning && loading) || !plan.length" :title="bulkRunning ? '停止后续分组' : '按计划逐组生成，保留各组已勾选决策'" @click="toggleBulk">
          {{ bulkRunning ? "停止生成（" + bulkDone + "/" + bulkTotal + "）" : "一键生成全部分组" }}
        </button>
        <button type="button" class="btn sm" @click="exportAllDraft">导出全部草稿 JSON</button>
        <button type="button" class="btn sm primary" :disabled="readOnly" @click="saveAll">保存全部</button>
        <button type="button" class="btn sm" @click="emit('close')">关闭</button>
      </div>

      <div class="pgw-body">
        <aside class="pgw-left">
          <div class="pgw-left-head">
            <div class="pgw-left-title"><b>分组计划</b><span>{{ confirmedCount }} / {{ plan.length }} 已完成</span></div>
            <div class="pgw-progress"><i :style="{ width: progressPct + '%' }"></i></div>
            <div class="pgw-left-stats">
              <span>已确认 {{ confirmedCount }}</span>
              <span>已跳过 {{ skippedCount }}</span>
              <span>{{ progressPct }}%</span>
            </div>
          </div>
          <div class="pgw-groups">
            <div
              v-for="(group, index) in plan"
              :key="group.id"
              class="pgw-group-card"
              :class="{ active: index === currentIndex, done: statuses[group.id] === 'confirmed', skipped: statuses[group.id] === 'skipped' }"
              @click="openGroup(index)"
            >
              <div class="pgw-group-main">
                <div class="pgw-group-title"><span class="pgw-num">{{ String(index + 1).padStart(2, "0") }}</span>{{ group.label }}</div>
                <div class="pgw-group-meta">{{ group.stats.fields }} 字段 · 必填 {{ group.stats.required }} · 未映射 {{ group.stats.unmapped }}</div>
                <div class="pgw-group-foot">
                  <span class="pgw-status" :class="statuses[group.id] || 'pending'">{{ statusText(group) }}</span>
                  <span v-if="groupAdoption(group)" class="pgw-adopt">{{ groupAdoption(group) }}</span>
                </div>
              </div>
              <div class="pgw-reorder" @click.stop>
                <button type="button" :disabled="index === 0" title="上移" @click="moveGroup(index, -1)">↑</button>
                <button type="button" :disabled="index === plan.length - 1" title="下移" @click="moveGroup(index, 1)">↓</button>
              </div>
            </div>
            <p v-if="!plan.length" class="pgw-empty">还没有分组计划。</p>
          </div>
          <div class="pgw-left-foot">
            <button type="button" class="btn sm" @click="resetFlow">重置进度</button>
            <span class="spacer"></span>
            <span>{{ finished ? "已全部完成" : confirmedCount + "/" + plan.length }}</span>
          </div>
        </aside>

        <main class="pgw-main">
          <div class="pgw-main-head">
            <div>
              <div class="pgw-main-title">
                {{ brief ? brief.label : "监管字段分组" }}
                <span class="mono">{{ brief ? brief.id : "" }}</span>
              </div>
              <div class="pgw-main-sub">
                <template v-if="brief">
                  <span>{{ brief.stats.fields }} 字段</span>
                  <span>必填 {{ brief.stats.required }}</span>
                  <span>未映射 {{ brief.stats.unmapped }}</span>
                  <span v-if="brief.stats.systemCalc">系统计算 {{ brief.stats.systemCalc }}</span>
                </template>
                <span class="pgw-status" :class="currentStatus">{{ current ? statusText(current) : "未选择" }}</span>
              </div>
            </div>
            <div class="pgw-actions">
              <button type="button" class="btn sm" :disabled="currentIndex <= 0" @click="prevGroup">← 上一组</button>
              <template v-if="confirmSkip">
                <span class="pgw-confirm-inline">
                  确认跳过？
                  <button type="button" class="btn sm" @click="skipGroup">跳过</button>
                  <button type="button" class="btn sm" @click="confirmSkip = false">取消</button>
                </span>
              </template>
              <button v-else type="button" class="btn sm" :disabled="readOnly || !current" @click="confirmSkip = true">跳过本组</button>
              <button type="button" class="btn sm" :disabled="finished" @click="nextGroup">下一组 →</button>
              <button type="button" class="btn sm" @click="exportGroup">导出本组</button>
            </div>
          </div>

          <div class="pgw-scroll">
            <p v-if="error" class="notice danger">{{ error }}</p>
            <p v-if="notice" class="notice info">{{ notice }}</p>

            <div class="pgw-kpis">
              <div class="pgw-kpi"><div class="k">已确认分组</div><div class="v">{{ confirmedCount }} <small>/ {{ plan.length }}</small></div></div>
              <div class="pgw-kpi"><div class="k">已跳过分组</div><div class="v">{{ skippedCount }}</div></div>
              <div class="pgw-kpi"><div class="k">标准字段采纳率</div><div class="v">{{ adoption.fields }} <small>/ {{ adoption.proposedFields }}</small></div></div>
              <div class="pgw-kpi"><div class="k">决策采纳率</div><div class="v">{{ adoption.decisions }} <small>/ {{ adoption.proposedDecisions }}</small></div></div>
            </div>

            <div v-if="briefLoading" class="pgw-empty">正在读取本组监管字段…</div>
            <div v-else-if="!brief && plan.length" class="pgw-empty">选择左侧分组开始。</div>

            <section v-if="brief">
              <div class="pgw-section-head">
                <span class="pgw-section-title">1. 本组监管字段与规则用途</span>
                <span class="dim">显示 {{ visibleFields.length }} / {{ briefFields.length }}</span>
              </div>
              <div class="pgw-field-filters">
                <label class="pgw-check"><input v-model="fieldFilters.required" type="checkbox" /> 只看必填</label>
                <label class="pgw-check"><input v-model="fieldFilters.unmapped" type="checkbox" /> 只看未映射</label>
                <label class="pgw-check"><input v-model="fieldFilters.system" type="checkbox" /> 只看系统计算</label>
                <select v-model="fieldFilters.type">
                  <option value="">全部类型</option>
                  <option v-for="type in fieldTypeOptions" :key="type" :value="type">{{ fieldTypeLabel(type) }}</option>
                </select>
                <input v-model="fieldFilters.keyword" type="search" placeholder="搜索字段、中文名或规则" />
                <button type="button" class="btn xs" @click="resetFilters">清除</button>
              </div>
              <div class="pgw-table-box">
                <table class="pgw-table">
                  <thead>
                    <tr>
                      <th style="width: 170px">监管字段</th>
                      <th style="width: 120px">中文名</th>
                      <th style="width: 76px">类型</th>
                      <th>取值 / 字典</th>
                      <th style="width: 190px">规则用途</th>
                      <th style="width: 48px">必填</th>
                      <th style="width: 110px">当前映射</th>
                      <th style="width: 40px"></th>
                    </tr>
                  </thead>
                  <tbody>
                    <template v-for="field in visibleFields" :key="field.name">
                      <tr class="pgw-click-row" @click="toggleFieldDetail(field.name)">
                        <td>
                          <span class="mono pgw-strong">{{ field.name }}</span>
                          <span v-if="field.systemCalc" class="tag blue">系统计算</span>
                        </td>
                        <td>{{ field.label }}</td>
                        <td>{{ fieldTypeLabel(field.type) }}</td>
                        <td>{{ fieldValueText(field) }}</td>
                        <td>
                          <span v-for="use in field.usedBy" :key="use.kind + use.ruleId + use.path + use.whenText" class="pgw-rule-wrap">
                            <span class="pgw-rule-chip" :class="use.kind">{{ use.kind === "weight" ? "权重" : "分类" }} <span class="mono">{{ use.ruleId }}</span></span>
                            <span class="pgw-rule-tip">
                              <b>{{ use.ruleLabel || use.ruleId }}</b>
                              <span v-if="use.path" class="mono">{{ use.path }}</span>
                              <span v-if="use.whenText">条件：{{ use.whenText }}</span>
                              <span>{{ use.note || "引用该字段进行规则判断" }}</span>
                              <span v-if="use.article" class="mono">{{ use.article }}</span>
                            </span>
                          </span>
                          <span v-if="!field.usedBy.length" class="dim">—</span>
                        </td>
                        <td>{{ field.required ? "是" : "否" }}</td>
                        <td><span class="tag" :class="field.mapped ? 'green' : 'amber'">{{ fieldMappingText(field) }}</span></td>
                        <td class="dim">{{ expandedField === field.name ? "▾" : "▸" }}</td>
                      </tr>
                      <tr v-if="expandedField === field.name" class="pgw-detail-row">
                        <td colspan="8">
                          <div class="pgw-profile">
                            <div class="pgw-profile-block">
                              <h6>定义</h6>
                              <p>{{ fieldProfile(field).definition || "规则文档没有提供定义。" }}</p>
                              <p v-if="fieldProfile(field).note" class="dim">{{ fieldProfile(field).note }}</p>
                            </div>
                            <div class="pgw-profile-block">
                              <h6>类型与取值</h6>
                              <p>{{ fieldTypeLabel(fieldProfile(field).type) }} · 来源 {{ fieldProfile(field).source === "calc" ? "系统计算" : fieldProfile(field).source === "external" ? "外部输入" : fieldProfile(field).source === "prepared" ? "平台预处理" : "数据字段" }}</p>
                              <div v-if="(fieldProfile(field).options || []).length" class="pgw-option-list">
                                <span v-for="option in fieldProfile(field).options" :key="option.code" class="pgw-option">{{ optionText(option) }}</span>
                              </div>
                              <div v-if="fieldProfile(field).dictionary" class="pgw-dict-ref">
                                字典 {{ fieldProfile(field).dictionary.dict_name }}（{{ fieldProfile(field).dictionary.dict_code }}）
                                <div class="pgw-option-list">
                                  <span v-for="item in (fieldProfile(field).dictionary.items || []).slice(0, 24)" :key="item.item_code" class="pgw-option">{{ item.item_code }} · {{ item.item_name }}</span>
                                </div>
                              </div>
                              <p v-else-if="!(fieldProfile(field).options || []).length && !fieldProfile(field).systemCalc" class="dim">规则文档没有给出可选码值，生成时需要人工确认。</p>
                            </div>
                            <div v-if="fieldProfile(field).systemCalc" class="pgw-profile-block">
                              <h6>系统计算</h6>
                              <p>{{ fieldProfile(field).derivation ? fieldProfile(field).derivation.summary : "由计算引擎派生，不需要人工字段。" }}</p>
                              <div v-if="fieldProfile(field).derivation && fieldProfile(field).derivation.inputs.length" class="dim">
                                派生输入：{{ fieldProfile(field).derivation.inputs.join("、") }}
                              </div>
                              <div v-if="fieldProfile(field).derivation && fieldProfile(field).derivation.expression" class="mono dim">
                                {{ fieldProfile(field).derivation.expression }}
                              </div>
                              <div v-if="(fieldProfile(field).parameterRefs || []).length" class="dim">
                                参数引用：{{ fieldProfile(field).parameterRefs.join("、") }}
                              </div>
                            </div>
                            <div class="pgw-profile-block">
                              <h6>为什么需要</h6>
                              <div v-for="use in field.usedBy" :key="'why-' + use.kind + use.ruleId + use.path + use.whenText" class="pgw-why">
                                <div><b>{{ use.kind === "weight" ? "权重规则" : "分类规则" }} {{ use.ruleId }}</b> <span class="dim">{{ use.ruleLabel }}</span></div>
                                <div v-if="use.path" class="mono dim">{{ use.path }}</div>
                                <div v-if="use.whenText">条件：{{ use.whenText }}</div>
                                <div>{{ use.note || "引用该字段进行规则判断。" }}</div>
                                <div v-if="use.article" class="mono dim">监管依据 {{ use.article }}</div>
                              </div>
                              <p v-if="!field.usedBy.length" class="dim">没有在规则节点中直接引用；可能是映射文档补充的目标字段。</p>
                            </div>
                            <div class="pgw-profile-block">
                              <h6>当前映射</h6>
                              <p>{{ fieldMappingText(field) }}</p>
                              <p v-if="fieldProfile(field).standardField" class="dim">标准字段 {{ fieldProfile(field).standardField.name }} · {{ fieldProfile(field).standardField.inputMode === "default" ? "默认值" : "人工输入" }}</p>
                              <template v-if="fieldProfile(field).mapping && fieldProfile(field).mapping.transform">
                                <p class="dim">方式：{{ mappingTransformLabel(fieldProfile(field).mapping) }}</p>
                                <p v-if="fieldProfile(field).mapping.transform.expression" class="mono dim">{{ fieldProfile(field).mapping.transform.expression }}</p>
                                <div v-if="mappingCodeRows(fieldProfile(field).mapping).length" class="pgw-code-map">
                                  <div v-for="row in mappingCodeRows(fieldProfile(field).mapping)" :key="row.source" class="pgw-code-map-row">
                                    <span class="mono">{{ row.source }}</span>
                                    <span class="mono">{{ row.target }}</span>
                                  </div>
                                </div>
                              </template>
                              <p class="dim">必填策略：{{ fieldProfile(field).missingPolicy || "未设置" }}</p>
                            </div>
                          </div>
                        </td>
                      </tr>
                    </template>
                  </tbody>
                </table>
                <p v-if="!visibleFields.length" class="pgw-empty">没有符合筛选条件的监管字段。</p>
              </div>
            </section>

            <section>
              <div class="pgw-section-head">
                <span class="pgw-section-title">2. 本组标准字段、字典与映射决策</span>
                <span v-if="proposal" class="dim">生成于 {{ generatedAt }} · 仅作用域：{{ brief ? brief.label : "" }}</span>
              </div>

              <div v-if="progress.active" class="pgw-stream">
                <div class="pgw-stream-head">
                  <b>{{ stageLabel(progress.stage) }}</b>
                  <span class="dim">{{ progress.message }}</span>
                </div>
                <div class="pgw-stream-bar"><i :style="{ width: streamPct + '%' }"></i></div>
                <div class="dim">{{ progress.done }} / {{ progress.total }} 个监管字段已决策</div>
                <ul class="pgw-stream-list">
                  <li v-for="item in progress.decisions" :key="item.targetField">
                    <span class="mono">{{ item.targetField }}</span>
                    <span class="tag" :class="decisionClass(item.decisionType)">{{ decisionLabel(item.decisionType) }}</span>
                    <span class="dim">{{ item.reason }}</span>
                  </li>
                </ul>
              </div>

              <div v-if="!proposal && !progress.active" class="pgw-empty-proposal">
                <div class="pgw-empty-title">尚未生成本组建议</div>
                <div class="dim">会读取本组监管字段画像、规则用途、已有标准字段和字典，为每个字段生成一条决策。</div>
                <button type="button" class="btn primary" :disabled="readOnly || loading || bulkRunning || !brief" @click="generate">{{ loading ? "正在生成…" : "生成本组建议" }}</button>
              </div>

              <template v-else-if="proposal">
                <div class="pgw-banner">
                  <div class="pgw-banner-main">
                    <div class="pgw-banner-title">{{ decisionSummary }}</div>
                    <div class="pgw-banner-sub">
                      {{ proposal.groupPurpose || "只应用当前分组；确认后仍需点「保存全部」写入。" }}
                    </div>
                    <div class="pgw-banner-counts">
                      <span class="tag mint">复用 {{ decisionStats.reuse }}</span>
                      <span class="tag blue">新建 {{ decisionStats.create }}</span>
                      <span class="tag amber">默认值 {{ decisionStats.default }}</span>
                      <span class="tag violet">系统计算 {{ decisionStats.system }}</span>
                      <span class="tag gray">跳过 {{ decisionStats.skip }}</span>
                      <span class="tag rose">缺失 {{ decisionStats.missing }}</span>
                    </div>
                  </div>
                  <div class="pgw-banner-actions">
                    <button type="button" class="btn sm" :disabled="readOnly || loading || bulkRunning || !brief" @click="regenerate">重新生成</button>
                    <template v-if="confirmFresh">
                      <span class="pgw-confirm-inline">
                        确认清空勾选？
                        <button type="button" class="btn sm" @click="regenerateFresh">重生成</button>
                        <button type="button" class="btn sm" @click="confirmFresh = false">取消</button>
                      </span>
                    </template>
                    <button v-else type="button" class="btn sm" :disabled="readOnly || loading || bulkRunning || !brief" @click="confirmFresh = true">清空勾选重生成</button>
                    <button type="button" class="btn sm primary" :disabled="readOnly || (!selectedDecisionCount && !selection.fields.length)" @click="applyGroup">确认本组并应用（{{ selectedDecisionCount }}）</button>
                  </div>
                </div>

                <div v-if="proposalDiff.has" class="pgw-diff">
                  <b>与上一版比较</b>
                  <span v-if="proposalDiff.added.length">新增决策 {{ proposalDiff.added.join("、") }}</span>
                  <span v-if="proposalDiff.changed.length">修改决策 {{ proposalDiff.changed.join("、") }}</span>
                  <span v-if="proposalDiff.removed.length">删除决策 {{ proposalDiff.removed.join("、") }}</span>
                  <span v-if="proposalDiff.dictionaries.length">新增字典 {{ proposalDiff.dictionaries.join("、") }}</span>
                </div>

                <div v-if="newGroups.length" class="pgw-new-groups">
                  <div class="pgw-subhead">建议新建标准字段分组</div>
                  <div v-for="group in newGroups" :key="group.group_id" class="pgw-new-group">
                    <b>{{ group.label || group.group_id }}</b>
                    <span class="mono">{{ group.group_id }}</span>
                    <span class="dim">{{ group.description }}</span>
                  </div>
                </div>

                <div class="pgw-tabs">
                  <button type="button" :class="{ active: proposalTab === 'overview' }" @click="proposalTab = 'overview'">决策总览 <em>{{ decisions.length }}</em></button>
                  <button type="button" :class="{ active: proposalTab === 'fields' }" @click="proposalTab = 'fields'">标准字段 <em>{{ proposalFields.length }}</em></button>
                  <button type="button" :class="{ active: proposalTab === 'dictionaries' }" @click="proposalTab = 'dictionaries'">字典 <em>{{ newDictionaries.length }}</em></button>
                  <button type="button" :class="{ active: proposalTab === 'mappings' }" @click="proposalTab = 'mappings'">映射 <em>{{ proposalMappings.length }}</em></button>
                  <button type="button" :class="{ active: proposalTab === 'notes' }" @click="proposalTab = 'notes'">字段用途讲解 <em>{{ (proposal.fieldNotes || []).length }}</em></button>
                  <button type="button" :class="{ active: proposalTab === 'missing' }" @click="proposalTab = 'missing'">仍需人工处理 <em :class="{ danger: missing.length }">{{ missing.length }}</em></button>
                </div>

                <div v-if="proposalTab === 'overview'">
                  <div class="pgw-tab-tools">
                    <button type="button" class="btn xs" @click="selectAllDecisions">全选</button>
                    <button type="button" class="btn xs" @click="clearDecisions">全不选</button>
                    <span class="dim">已选 {{ selectedDecisionCount }} / {{ decisionTotal }}</span>
                  </div>
                  <div class="pgw-table-box">
                    <table class="pgw-table">
                      <thead>
                        <tr>
                          <th style="width: 30px"></th>
                          <th style="width: 150px">目标字段</th>
                          <th style="width: 84px">决策</th>
                          <th style="width: 160px">标准字段</th>
                          <th style="width: 110px">字典</th>
                          <th>映射 / 默认值</th>
                          <th style="width: 90px">置信度</th>
                          <th style="width: 30px"></th>
                        </tr>
                      </thead>
                      <tbody>
                        <template v-for="item in decisions" :key="item.targetField">
                          <tr :class="{ low: item.confidence < 0.7, off: !selection.decisions.includes(item.targetField) }">
                            <td><input type="checkbox" :checked="selection.decisions.includes(item.targetField)" @change="toggleSelection('decisions', item.targetField)" /></td>
                            <td>
                              <div class="mono pgw-strong">{{ item.targetField }}</div>
                              <div class="dim">{{ item.targetLabel }}</div>
                            </td>
                            <td><span class="tag" :class="decisionClass(item.decisionType)">{{ decisionLabel(item.decisionType) }}</span></td>
                            <td class="mono">{{ decisionStandardText(item) }}</td>
                            <td class="mono">{{ decisionDictionaryText(item) }}</td>
                            <td>
                              <div class="mono">{{ decisionMappingText(item) }}</div>
                              <div v-if="item.reason" class="dim pgw-reason">{{ item.reason }}</div>
                            </td>
                            <td><span class="pgw-confidence" :class="{ low: item.confidence < 0.7 }">{{ Math.round((item.confidence || 0) * 100) }}%</span></td>
                            <td class="dim pgw-pointer" @click="toggleDecisionDetail(item.targetField)">{{ expandedDecision === item.targetField ? "▾" : "▸" }}</td>
                          </tr>
                          <tr v-if="expandedDecision === item.targetField" class="pgw-detail-row">
                            <td colspan="8">
                              <div class="pgw-decision-detail">
                                <div>
                                  <h6>为什么这样决策</h6>
                                  <p>{{ item.reason || "—" }}</p>
                                </div>
                                <div v-if="item.ruleReason">
                                  <h6>规则用途</h6>
                                  <p>{{ item.ruleReason }}</p>
                                </div>
                                <div v-if="item.standardField">
                                  <h6>标准字段</h6>
                                  <p class="mono">{{ item.standardField.name }} · {{ item.standardField.label }}</p>
                                  <p class="dim">{{ item.standardField.group }} · {{ item.standardField.inputMode === "default" ? "默认值" : "人工输入" }} · {{ item.standardField.type }}</p>
                                  <p v-if="item.standardField.description" class="dim">{{ item.standardField.description }}</p>
                                </div>
                                <div v-if="item.dictionary">
                                  <h6>字典</h6>
                                  <p class="mono">{{ item.dictionary.dict_code }} · {{ item.dictionary.dict_name }}</p>
                                  <div class="pgw-option-list">
                                    <span v-for="row in item.dictionary.items" :key="row.item_code" class="pgw-option">{{ row.item_code }} · {{ row.item_name }}</span>
                                  </div>
                                </div>
                                <div v-if="item.mapping">
                                  <h6>映射</h6>
                                  <p class="mono">
                                    {{ item.mapping.sourceField || "（无源字段）" }} → {{ item.targetField }}
                                    · {{ item.mapping.mappingType }}
                                    <span v-if="item.mapping.defaultValue"> · 默认值 {{ item.mapping.defaultValue }}</span>
                                  </p>
                                  <p v-if="item.mapping.reason" class="dim">{{ item.mapping.reason }}</p>
                                </div>
                              </div>
                            </td>
                          </tr>
                        </template>
                      </tbody>
                    </table>
                    <p v-if="!decisions.length" class="pgw-empty">本组没有字段决策。</p>
                  </div>
                </div>

                <div v-if="proposalTab === 'fields'" class="pgw-table-box">
                  <table class="pgw-table">
                    <thead><tr><th style="width: 30px"></th><th style="width: 180px">标准字段</th><th style="width: 150px">中文名</th><th>服务的监管字段</th><th style="width: 120px">分组 / 输入方式</th><th style="width: 48px">必填</th><th style="width: 170px">字典 / 默认值</th><th style="width: 78px">置信度</th><th style="width: 150px">理由</th><th style="width: 28px"></th></tr></thead>
                    <tbody>
                      <template v-for="field in proposalFields" :key="field.name">
                        <tr class="pgw-click-row" :class="{ low: field.confidence < 0.7, off: !selection.fields.includes(field.name) }" @click="toggleProposalField(field.name)">
                          <td @click.stop><input type="checkbox" :checked="selection.fields.includes(field.name)" @change="toggleSelection('fields', field.name)" /></td>
                          <td>
                            <div><span class="mono pgw-strong">{{ field.name }}</span> <span class="tag" :class="field.newField ? 'mint' : 'gray'">{{ field.newField ? "新增" : "复用" }}</span></div>
                            <div class="mono dim">{{ fieldTypeLabel(field.type) }} · {{ field.type }}</div>
                          </td>
                          <td>
                            <div>{{ field.label }}</div>
                            <div v-if="field.labelEn && field.labelEn !== field.label" class="dim">{{ field.labelEn }}</div>
                          </td>
                          <td>
                            <template v-if="servedTargets(field).length">
                              <div v-for="target in servedTargets(field)" :key="target.targetField" class="pgw-target-line">
                                <span class="mono">{{ target.targetField }}</span>
                                <span class="dim">{{ target.targetLabel }}</span>
                              </div>
                            </template>
                            <span v-else class="dim">—</span>
                          </td>
                          <td>
                            <div class="mono">{{ field.group || "—" }}</div>
                            <div class="dim">{{ field.inputMode === "default" ? "默认值" : "人工输入" }}</div>
                          </td>
                          <td>{{ field.required ? "是" : "否" }}</td>
                          <td>
                            <div v-if="field.dictionary" class="mono">
                              {{ dictionaryTitle(field.dictionary) }}
                              <span class="dim">（{{ field.dictionary }} · {{ dictionaryItems(field.dictionary).length }} 个码值）</span>
                            </div>
                            <div v-else-if="field.defaultValue" class="mono">默认值 {{ field.defaultValue }}</div>
                            <span v-else class="dim">—</span>
                          </td>
                          <td><span class="pgw-confidence" :class="{ low: field.confidence < 0.7 }">{{ Math.round((field.confidence || 0) * 100) }}%</span></td>
                          <td class="dim">{{ field.reason }}</td>
                          <td class="dim pgw-pointer">{{ expandedProposalField === field.name ? "▾" : "▸" }}</td>
                        </tr>
                        <tr v-if="expandedProposalField === field.name" class="pgw-detail-row">
                          <td colspan="10">
                            <div class="pgw-profile">
                              <div class="pgw-profile-block">
                                <h6>字段定义</h6>
                                <p>{{ field.description || "当前上下文没有字段说明。" }}</p>
                                <p class="dim">英文名 {{ field.labelEn || "—" }} · 来源 {{ field.sourceHint || "—" }}</p>
                                <p v-if="(field.aliases || []).length" class="dim">别名：{{ field.aliases.join("、") }}</p>
                                <div v-if="(field.enumValues || []).length" class="pgw-option-list">
                                  <span v-for="value in field.enumValues" :key="value" class="pgw-option">{{ value }}</span>
                                </div>
                              </div>
                              <div class="pgw-profile-block">
                                <h6>字典</h6>
                                <template v-if="field.dictionary">
                                  <p class="mono">{{ field.dictionary }} · {{ dictionaryTitle(field.dictionary) }}</p>
                                  <p v-if="dictionaryOf(field.dictionary) && dictionaryOf(field.dictionary).description" class="dim">{{ dictionaryOf(field.dictionary).description }}</p>
                                  <div v-if="dictionaryItems(field.dictionary).length" class="pgw-option-list">
                                    <span v-for="item in dictionaryItems(field.dictionary)" :key="item.item_code" class="pgw-option">{{ item.item_code }} · {{ item.item_name }}</span>
                                  </div>
                                  <p v-else class="dim">当前上下文没有该字典的码值。</p>
                                </template>
                                <p v-else class="dim">该字段不使用字典。</p>
                              </div>
                              <div class="pgw-profile-block">
                                <h6>服务的监管字段与规则</h6>
                                <div v-for="target in servedTargets(field)" :key="'rule-' + target.targetField" class="pgw-why">
                                  <div><span class="mono pgw-strong">{{ target.targetField }}</span> <span class="dim">{{ target.targetLabel }}</span></div>
                                  <div v-for="rule in rulesOfTarget(target.targetField)" :key="rule.kind + rule.ruleId + rule.path" class="dim">
                                    {{ rule.kind === "weight" ? "权重" : "分类" }} {{ rule.ruleId }} · {{ ruleSummary(rule) }}
                                  </div>
                                  <div v-if="!rulesOfTarget(target.targetField).length" class="dim">规则文档没有记录直接用途。</div>
                                </div>
                                <p v-if="!servedTargets(field).length" class="dim">当前决策没有把它映射到监管字段。</p>
                              </div>
                              <div class="pgw-profile-block">
                                <h6>复用 / 新建依据</h6>
                                <p>{{ field.reason || "—" }}</p>
                                <p v-if="field.existingStandardField" class="dim">
                                  已有字段：{{ field.existingStandardField.label }} · {{ field.existingStandardField.group }} ·
                                  {{ fieldTypeLabel(field.existingStandardField.type) }} · {{ field.existingStandardField.inputMode === "default" ? "默认值" : "人工输入" }}
                                </p>
                                <p class="dim">置信度 {{ Math.round((field.confidence || 0) * 100) }}%{{ field.confidence < 0.7 ? "（低，需要人工确认）" : "" }}</p>
                              </div>
                            </div>
                          </td>
                        </tr>
                      </template>
                    </tbody>
                  </table>
                  <p v-if="!proposalFields.length" class="pgw-empty">本组没有新的标准字段建议。</p>
                </div>

                <div v-if="proposalTab === 'dictionaries'" class="pgw-table-box">
                  <table class="pgw-table">
                    <thead><tr><th style="width: 30px"></th><th style="width: 180px">字典编码</th><th style="width: 160px">字典名称</th><th style="width: 70px">码值数</th><th>码值预览</th></tr></thead>
                    <tbody>
                      <tr v-for="dict in newDictionaries" :key="dict.dict_code" :class="{ off: !selection.dictionaries.includes(dict.dict_code) }">
                        <td><input type="checkbox" :checked="selection.dictionaries.includes(dict.dict_code)" @change="toggleSelection('dictionaries', dict.dict_code)" /></td>
                        <td class="mono pgw-strong">{{ dict.dict_code }}</td>
                        <td>{{ dict.dict_name }}</td>
                        <td>{{ (dict.items || []).length }}</td>
                        <td class="dim">{{ (dict.items || []).slice(0, 12).map((item) => item.item_code + " " + item.item_name).join(" · ") }}</td>
                      </tr>
                    </tbody>
                  </table>
                  <p v-if="!newDictionaries.length" class="pgw-empty">本组没有新建字典建议；已有字典会在标准字段里复用。</p>
                </div>

                <div v-if="proposalTab === 'mappings'" class="pgw-table-box">
                  <table class="pgw-table">
                    <thead><tr><th style="width: 30px"></th><th style="width: 180px">目标字段</th><th style="width: 190px">来源标准字段 / 默认值</th><th style="width: 100px">方式</th><th>转换规则</th><th style="width: 78px">置信度</th><th style="width: 160px">理由</th><th style="width: 28px"></th></tr></thead>
                    <tbody>
                      <template v-for="item in proposalMappings" :key="item.targetField">
                        <tr class="pgw-click-row" :class="{ low: item.confidence < 0.7, off: !selection.mappings.includes(item.targetField) }" @click="toggleProposalMapping(item.targetField)">
                          <td @click.stop><input type="checkbox" :checked="selection.mappings.includes(item.targetField)" @change="toggleSelection('mappings', item.targetField)" /></td>
                          <td>
                            <div class="mono pgw-strong">{{ item.targetField }}</div>
                            <div class="dim">{{ item.targetLabel }}<span v-if="item.targetType"> · {{ fieldTypeLabel(item.targetType) }}</span><span v-if="item.targetRequired"> · 必填</span></div>
                          </td>
                          <td>
                            <template v-if="item.mappingType === 'constant'">
                              <div class="mono">默认值 {{ item.defaultValue || "（空）" }}</div>
                            </template>
                            <template v-else>
                              <div class="mono">{{ item.sourceField }}</div>
                              <div class="dim">{{ item.sourceLabel }}<span v-if="item.sourceType"> · {{ fieldTypeLabel(item.sourceType) }}</span><span v-if="item.sourceInputMode"> · {{ item.sourceInputMode === "default" ? "默认值" : "人工输入" }}</span></div>
                            </template>
                          </td>
                          <td>
                            <div>{{ mappingTransformLabel(item) }}</div>
                            <div class="mono dim">{{ item.mappingType }}</div>
                          </td>
                          <td class="dim">{{ mappingTransformSummary(item) }}</td>
                          <td><span class="pgw-confidence" :class="{ low: item.confidence < 0.7 }">{{ Math.round((item.confidence || 0) * 100) }}%</span></td>
                          <td class="dim">{{ item.reason }}</td>
                          <td class="dim pgw-pointer">{{ expandedProposalMapping === item.targetField ? "▾" : "▸" }}</td>
                        </tr>
                        <tr v-if="expandedProposalMapping === item.targetField" class="pgw-detail-row">
                          <td colspan="8">
                            <div class="pgw-decision-detail">
                              <div>
                                <h6>字段对照</h6>
                                <p class="mono">{{ item.sourceField || "（无源字段）" }} → {{ item.targetField }}</p>
                                <p class="dim">目标：{{ item.targetLabel }} · {{ fieldTypeLabel(item.targetType) }}{{ item.targetRequired ? " · 必填" : "" }}</p>
                                <p v-if="item.sourceField" class="dim">来源：{{ item.sourceLabel || item.sourceField }}{{ item.sourceType ? " · " + fieldTypeLabel(item.sourceType) : "" }}{{ item.sourceInputMode ? " · " + (item.sourceInputMode === "default" ? "默认值" : "人工输入") : "" }}</p>
                                <p v-if="item.sourceDictionary" class="dim">来源字典：{{ dictionaryTitle(item.sourceDictionary) }}（{{ item.sourceDictionary }}）</p>
                              </div>
                              <div>
                                <h6>转换规则</h6>
                                <p>方式：{{ mappingTransformLabel(item) }}<span class="mono dim"> · {{ item.transformType || item.mappingType }}</span></p>
                                <p v-if="item.transform && item.transform.expression" class="mono">表达式：{{ item.transform.expression }}</p>
                                <p v-if="mappingInputs(item).length" class="dim">输入字段：{{ mappingInputs(item).join("、") }}</p>
                                <p v-if="item.defaultValue" class="mono">默认值：{{ item.defaultValue }}</p>
                                <p v-if="item.transform && item.transform.onUnmappedCode" class="dim">未命中码值：{{ item.transform.onUnmappedCode }}</p>
                                <div v-if="mappingCodeRows(item).length" class="pgw-code-map">
                                  <div class="pgw-code-map-head"><span>源码值</span><span>目标码值</span></div>
                                  <div v-for="row in mappingCodeRows(item)" :key="row.source" class="pgw-code-map-row">
                                    <span class="mono">{{ row.source }}</span>
                                    <span class="mono">{{ row.target }}</span>
                                  </div>
                                </div>
                              </div>
                              <div>
                                <h6>空值与校验</h6>
                                <p>缺失策略：{{ item.missingPolicy || "—" }}</p>
                                <p v-if="item.description" class="dim">{{ item.description }}</p>
                                <p class="dim">{{ item.reason || "—" }}</p>
                              </div>
                              <div>
                                <h6>监管依据与置信度</h6>
                                <p>{{ item.regulatoryReference || "映射文档没有标注监管依据。" }}</p>
                                <p class="dim">置信度 {{ Math.round((item.confidence || 0) * 100) }}%{{ item.confidence < 0.7 ? "（低，需要人工确认）" : "" }}</p>
                              </div>
                            </div>
                          </td>
                        </tr>
                      </template>
                    </tbody>
                  </table>
                  <p v-if="!proposalMappings.length" class="pgw-empty">本组没有新的映射建议。</p>
                </div>

                <div v-if="proposalTab === 'notes'" class="pgw-note-list">
                  <div v-for="note in proposal.fieldNotes || []" :key="note.targetField" class="pgw-note">
                    <div><span class="mono pgw-strong">{{ note.targetField }}</span><div class="dim">{{ note.purpose }}</div></div>
                    <div class="pgw-note-side"><span class="mono">{{ note.standardField || (note.mappingType === "system" ? "系统计算（跳过）" : "不建标准字段") }}</span><span class="dim">{{ note.mappingType || "" }}</span></div>
                  </div>
                  <p v-if="!(proposal.fieldNotes || []).length" class="pgw-empty">没有字段用途讲解。</p>
                </div>

                <div v-if="proposalTab === 'missing'" class="pgw-table-box">
                  <table class="pgw-table">
                    <thead><tr><th>目标字段</th><th>原因</th><th>建议标准字段</th></tr></thead>
                    <tbody>
                      <tr v-for="item in missing" :key="item.targetField">
                        <td><span class="mono pgw-strong">{{ item.targetField }}</span> <span class="tag rose">必填缺失</span></td>
                        <td>{{ item.reason }}</td>
                        <td class="mono">{{ item.suggestedField || "—" }}</td>
                      </tr>
                    </tbody>
                  </table>
                  <p v-if="!missing.length" class="pgw-empty">没有仍需人工处理的字段。</p>
                </div>

                <div v-if="suggestions.length" class="pgw-suggestions">
                  <span class="dim">建议：</span>
                  <span v-for="(item, index) in suggestions" :key="index" class="pgw-suggestion">{{ item }}</span>
                </div>
                <div v-if="(proposal.warnings || []).length" class="pgw-warnings">
                  <div v-for="(item, index) in proposal.warnings" :key="index">⚠ {{ item }}</div>
                </div>
              </template>
            </section>
          </div>

          <div class="pgw-chat">
            <div class="pgw-chat-log">
              <div v-if="!messages.length" class="pgw-chat-empty">可以提出调整意见，也可以直接问字段、字典、规则和映射的细节。</div>
              <template v-for="(item, index) in messages" :key="index">
                <div v-if="showGroupDivider(index)" class="pgw-msg-group">{{ item.groupLabel || item.groupId }}</div>
                <div class="pgw-msg" :class="item.role">
                  <span class="pgw-role">{{ item.role === "user" ? "你" : "助手" }}</span>
                  <div class="pgw-msg-body">
                    <div v-if="item.role === 'assistant'" class="pgw-rich" v-html="agentHtml(item.text)"></div>
                    <span v-else>{{ item.text }}</span>
                    <div v-if="item.note" class="pgw-msg-note">{{ item.note }}</div>
                  </div>
                </div>
              </template>
              <div v-if="liveAnswer" class="pgw-msg assistant">
                <span class="pgw-role">助手</span>
                <div class="pgw-msg-body"><div class="pgw-rich" v-html="agentHtml(liveAnswer)"></div></div>
              </div>
            </div>
            <div class="pgw-chips">
              <span class="dim">快捷：</span>
              <button v-for="chip in quickChips" :key="chip" type="button" class="pgw-chip" :disabled="loading || readOnly" @click="quickAction(chip)">{{ chip }}</button>
            </div>
            <form class="pgw-chat-form" @submit.prevent="send">
              <input v-model="input" type="text" :disabled="readOnly || loading" :placeholder="'输入调整意见，或提问「' + (brief ? brief.label : '当前分组') + '」的字段、字典、映射细节…'" />
              <button type="submit" class="btn primary" :disabled="readOnly || loading || !input.trim()">{{ loading ? "处理中…" : "发送" }}</button>
            </form>
          </div>
        </main>
      </div>
    </div>
  </Drawer>
</template>

<style scoped>
.pgw-app { height: 100%; min-height: 0; display: flex; flex-direction: column; background: #f4f6f8; color: #0f172a; }
.pgw-top { flex: 0 0 auto; display: flex; align-items: center; gap: 14px; margin: 10px 14px 0; padding: 9px 14px; border: 1px solid #e2e8f0; border-radius: 12px; background: #fff; }
.pgw-pill { padding: 5px 12px; border-radius: 8px; background: #ebf5f1; color: #14533e; font-size: 12px; font-weight: 650; white-space: nowrap; }
.pgw-crumb { display: flex; align-items: center; gap: 7px; color: #94a3b8; font-size: 11.5px; border-left: 1px solid #e2e8f0; padding-left: 14px; }
.pgw-crumb strong { color: #334155; font-family: var(--mono); font-weight: 500; }
.pgw-top .spacer { flex: 1; }
.pgw-app .btn { height: 30px; padding: 0 10px; border-radius: 7px; font-size: 11.5px; }
.pgw-app .btn.primary { background: #19614a; border-color: #19614a; color: #fff; }
.pgw-app .btn.primary:hover:not(:disabled) { background: #144f3c; }
.pgw-app .btn.xs { height: 24px; padding: 0 7px; font-size: 10.5px; }
.pgw-body { flex: 1; min-height: 0; display: flex; gap: 12px; padding: 10px 14px 12px; overflow: hidden; }
.pgw-left { width: 300px; flex: 0 0 auto; display: flex; flex-direction: column; min-height: 0; border: 1px solid #e2e8f0; border-radius: 14px; background: #fff; overflow: hidden; }
.pgw-left-head { padding: 12px 14px 10px; border-bottom: 1px solid #f1f5f9; display: flex; flex-direction: column; gap: 8px; }
.pgw-left-title { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 12.5px; }
.pgw-left-title span { color: #94a3b8; font-size: 10.5px; }
.pgw-progress { height: 6px; border-radius: 999px; background: #f1f5f9; overflow: hidden; }
.pgw-progress i { display: block; height: 100%; border-radius: 999px; background: #19614a; transition: width .25s; }
.pgw-left-stats { display: flex; justify-content: space-between; color: #64748b; font-size: 10px; }
.pgw-groups { flex: 1; min-height: 0; overflow: auto; padding: 7px; display: flex; flex-direction: column; gap: 4px; }
.pgw-group-card { display: flex; gap: 4px; padding: 9px 9px 8px; border: 1px solid transparent; border-radius: 10px; cursor: pointer; }
.pgw-group-card:hover { background: #f8fafc; border-color: #e2e8f0; }
.pgw-group-card.active { background: #ebf5f1; border-color: #cbe2d7; }
.pgw-group-card.done .pgw-group-title { color: #14533e; }
.pgw-group-card.skipped { opacity: .55; }
.pgw-group-main { flex: 1; min-width: 0; }
.pgw-group-title { font-size: 12px; font-weight: 600; color: #1e293b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pgw-num { color: #94a3b8; font-family: var(--mono); font-size: 9.5px; margin-right: 5px; }
.pgw-group-meta { margin-top: 2px; color: #94a3b8; font-size: 9.5px; }
.pgw-group-foot { display: flex; align-items: center; gap: 6px; margin-top: 4px; }
.pgw-status { font-size: 9.5px; padding: 0 5px; border-radius: 4px; background: #f1f5f9; color: #475569; }
.pgw-status.confirmed { background: #ebf5f1; color: #14533e; }
.pgw-status.skipped { background: #f1f5f9; color: #94a3b8; }
.pgw-status.proposal_ready { background: #eff6ff; color: #1d4ed8; }
.pgw-adopt { font-size: 9px; color: #94a3b8; }
.pgw-reorder { display: flex; flex-direction: column; gap: 1px; }
.pgw-reorder button { width: 18px; height: 16px; border: 0; background: transparent; color: #94a3b8; cursor: pointer; font-size: 10px; border-radius: 3px; }
.pgw-reorder button:hover:not(:disabled) { background: #e2e8f0; color: #0f172a; }
.pgw-reorder button:disabled { opacity: .25; cursor: not-allowed; }
.pgw-left-foot { padding: 8px 10px; border-top: 1px solid #f1f5f9; display: flex; align-items: center; gap: 8px; font-size: 10.5px; color: #64748b; background: #fafbfc; }
.pgw-left-foot .spacer { flex: 1; }
.pgw-main { flex: 1; min-width: 0; display: flex; flex-direction: column; min-height: 0; border: 1px solid #e2e8f0; border-radius: 14px; background: #fff; overflow: hidden; }
.pgw-main-head { flex: 0 0 auto; display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; padding: 11px 16px; border-bottom: 1px solid #f1f5f9; background: rgba(235,245,241,.55); }
.pgw-main-title { font-size: 14px; font-weight: 700; }
.pgw-main-title .mono { margin-left: 6px; color: #94a3b8; font-size: 10.5px; font-weight: 400; }
.pgw-main-sub { display: flex; align-items: center; gap: 9px; margin-top: 3px; color: #64748b; font-size: 10.5px; }
.pgw-actions { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; }
.pgw-confirm-inline { display: inline-flex; align-items: center; gap: 5px; padding: 2px 6px; border: 1px solid #fde68a; border-radius: 7px; background: #fffbeb; color: #92400e; font-size: 10.5px; }
.pgw-scroll { flex: 1; min-height: 0; overflow: auto; padding: 14px 16px; display: flex; flex-direction: column; gap: 16px; }
.pgw-kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 9px; }
.pgw-kpi { padding: 10px 12px; border: 1px solid #e2e8f0; border-radius: 10px; background: #fafbfc; }
.pgw-kpi .k { color: #64748b; font-size: 10.5px; }
.pgw-kpi .v { margin-top: 3px; font-size: 20px; font-weight: 700; color: #0f172a; font-variant-numeric: tabular-nums; }
.pgw-kpi .v small { font-size: 10.5px; font-weight: 400; color: #94a3b8; }
.pgw-section-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
.pgw-section-title { font-size: 12.5px; font-weight: 650; color: #0f172a; }
.pgw-check { display: inline-flex; align-items: center; gap: 4px; font-size: 10.5px; color: #64748b; }
.pgw-field-filters { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 7px; }
.pgw-field-filters select, .pgw-field-filters input[type="search"] { height: 26px; padding: 0 7px; border: 1px solid #e2e8f0; border-radius: 6px; font-size: 10.5px; background: #fff; }
.pgw-field-filters input[type="search"] { width: 210px; }
.pgw-table-box { border: 1px solid #e2e8f0; border-radius: 10px; overflow: hidden; }
.pgw-table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 11px; }
.pgw-table th { padding: 7px 9px; background: #f8fafc; border-bottom: 1px solid #e2e8f0; text-align: left; color: #64748b; font-size: 10px; font-weight: 600; white-space: nowrap; }
.pgw-table td { padding: 7px 9px; border-bottom: 1px solid #f1f5f9; vertical-align: top; color: #334155; word-break: break-word; }
.pgw-table tr:last-child td { border-bottom: 0; }
.pgw-table tbody tr:hover { background: #f8fafc; }
.pgw-table tr.low { background: #fffbeb; }
.pgw-table tr.off { opacity: .5; background: #fafbfc; }
.pgw-table input[type="checkbox"] { width: 13px; height: 13px; }
.pgw-click-row { cursor: pointer; }
.pgw-detail-row td { background: #fafcfb; padding: 10px 12px; }
.pgw-strong { font-weight: 600; color: #0f172a; }
.pgw-pointer { cursor: pointer; }
.pgw-reason { margin-top: 2px; font-size: 10px; }
.pgw-rule-wrap { position: relative; display: inline-block; margin: 0 4px 3px 0; }
.pgw-rule-chip { display: inline-flex; align-items: center; gap: 3px; padding: 1px 6px; border-radius: 4px; font-size: 9.5px; font-weight: 500; cursor: help; }
.pgw-rule-chip.weight { background: #ebf5f1; color: #14533e; }
.pgw-rule-chip.classification { background: #eff6ff; color: #1d4ed8; }
.pgw-rule-tip { position: absolute; left: 0; bottom: calc(100% + 5px); z-index: 30; width: 280px; display: none; flex-direction: column; gap: 3px; padding: 8px 10px; border-radius: 8px; background: #0f172a; color: #fff; font-size: 10.5px; line-height: 1.5; box-shadow: 0 8px 22px rgba(15,23,42,.25); }
.pgw-rule-wrap:hover .pgw-rule-tip { display: flex; }
.pgw-rule-tip .mono { color: #6ee7b7; }
.pgw-profile { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.pgw-profile-block { padding: 9px 11px; border: 1px solid #e2e8f0; border-radius: 8px; background: #fff; font-size: 10.5px; line-height: 1.55; }
.pgw-profile-block h6 { margin: 0 0 4px; color: #475569; font-size: 10px; font-weight: 650; }
.pgw-profile-block p { margin: 0 0 3px; }
.pgw-option-list { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
.pgw-option { padding: 1px 6px; border-radius: 4px; background: #f1f5f9; color: #475569; font-size: 9.5px; }
.pgw-code-map { margin-top: 5px; border: 1px solid #e2e8f0; border-radius: 6px; overflow: hidden; }
.pgw-code-map-head, .pgw-code-map-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 8px; padding: 3px 7px; }
.pgw-code-map-head { background: #f8fafc; color: #64748b; font-size: 9.5px; font-weight: 600; }
.pgw-code-map-row { border-top: 1px solid #f1f5f9; color: #334155; font-size: 10px; }
.pgw-dict-ref { margin-top: 5px; padding: 6px 7px; border-radius: 6px; background: #f8fafc; }
.pgw-why { padding: 5px 0; border-top: 1px dashed #e2e8f0; }
.pgw-why:first-of-type { border-top: 0; padding-top: 0; }
.pgw-empty-proposal { border: 1px dashed #cbd5e1; border-radius: 10px; background: #fafbfc; padding: 30px 18px; display: flex; flex-direction: column; align-items: center; gap: 7px; }
.pgw-empty-title { font-size: 13px; font-weight: 600; }
.pgw-banner { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 11px 13px; border: 1px solid #d4e8df; border-radius: 10px; background: #ebf5f1; }
.pgw-banner-main { min-width: 0; }
.pgw-banner-title { font-size: 12px; font-weight: 600; color: #14533e; }
.pgw-banner-sub { margin-top: 3px; color: #64748b; font-size: 10.5px; }
.pgw-banner-counts { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 6px; }
.pgw-banner-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 5px; flex: 0 0 auto; }
.pgw-diff { display: flex; flex-wrap: wrap; gap: 8px; padding: 8px 11px; border: 1px solid #bfdbfe; border-radius: 8px; background: #eff6ff; color: #1e3a8a; font-size: 10.5px; }
.pgw-new-groups { display: flex; flex-direction: column; gap: 5px; }
.pgw-subhead { font-size: 10.5px; font-weight: 600; color: #475569; }
.pgw-new-group { display: flex; align-items: baseline; gap: 7px; padding: 7px 9px; border: 1px solid #bfdbfe; border-radius: 8px; background: #eff6ff; font-size: 10.5px; }
.pgw-tabs { display: flex; gap: 3px; flex-wrap: wrap; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; margin-top: 10px; }
.pgw-tabs button { border: 0; background: transparent; padding: 4px 9px; border-radius: 6px; color: #475569; font-size: 11px; cursor: pointer; }
.pgw-tabs button:hover { background: #f1f5f9; }
.pgw-tabs button.active { background: #ebf5f1; color: #14533e; font-weight: 650; }
.pgw-tabs em { margin-left: 3px; font-style: normal; color: #94a3b8; font-size: 9.5px; }
.pgw-tabs em.danger { color: #dc2626; }
.pgw-tab-tools { display: flex; align-items: center; gap: 6px; margin: 7px 0; }
.pgw-confidence { color: #14533e; font-weight: 600; font-size: 10px; }
.pgw-confidence.low { color: #92400e; background: #fef3c7; padding: 0 4px; border-radius: 4px; }
.pgw-decision-detail { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 9px; }
.pgw-decision-detail > div { padding: 8px 10px; border: 1px solid #e2e8f0; border-radius: 7px; background: #fff; font-size: 10.5px; line-height: 1.55; }
.pgw-decision-detail h6 { margin: 0 0 3px; color: #475569; font-size: 10px; font-weight: 650; }
.pgw-decision-detail p { margin: 0 0 2px; }
.pgw-note-list { display: flex; flex-direction: column; gap: 5px; }
.pgw-note { display: flex; justify-content: space-between; gap: 12px; padding: 7px 9px; border: 1px solid #f1f5f9; border-radius: 8px; background: #fbfcfd; font-size: 10.5px; }
.pgw-note-side { flex: 0 0 180px; text-align: right; display: flex; flex-direction: column; gap: 2px; }
.pgw-suggestions { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; font-size: 10.5px; }
.pgw-suggestion { padding: 2px 7px; border-radius: 5px; background: #f1f5f9; color: #475569; }
.pgw-warnings { display: flex; flex-direction: column; gap: 3px; padding: 7px 9px; border: 1px solid #fde68a; border-radius: 7px; background: #fffbeb; color: #92400e; font-size: 10.5px; }
.pgw-stream { display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; border: 1px solid #bfdbfe; border-radius: 10px; background: #eff6ff; }
.pgw-stream-head { display: flex; align-items: baseline; gap: 8px; color: #1e3a8a; font-size: 11px; }
.pgw-stream-head .dim { color: #64748b; }
.pgw-stream-bar { height: 6px; border-radius: 999px; background: #dbeafe; overflow: hidden; }
.pgw-stream-bar i { display: block; height: 100%; border-radius: 999px; background: #1d4ed8; transition: width .2s; }
.pgw-stream-list { max-height: 150px; overflow: auto; margin: 2px 0 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 3px; font-size: 10.5px; }
.pgw-stream-list li { display: flex; align-items: center; gap: 6px; }
.pgw-empty { padding: 14px; color: #94a3b8; font-size: 11px; }
.pgw-chat { flex: 0 0 auto; display: flex; flex-direction: column; gap: 6px; padding: 9px 14px; border-top: 1px solid #e2e8f0; background: #f8fafc; }
.pgw-chat-log { max-height: 320px; overflow: auto; display: flex; flex-direction: column; gap: 5px; padding: 7px 10px; border: 1px solid #e2e8f0; border-radius: 8px; background: #fff; font-size: 10.5px; }
.pgw-chat-empty { color: #94a3b8; }
.pgw-msg { display: flex; gap: 6px; }
.pgw-msg-group { margin: 7px 0 1px; color: #94a3b8; font-size: 9.5px; font-weight: 600; letter-spacing: .04em; }
.pgw-msg-body { flex: 1; min-width: 0; line-height: 1.6; }
.pgw-msg-note { margin-top: 3px; color: #94a3b8; font-size: 9.5px; }
.pgw-rich :deep(p) { margin: 0 0 4px; }
.pgw-rich :deep(ul) { margin: 0 0 4px; padding-left: 16px; }
.pgw-rich :deep(li) { margin: 1px 0; }
.pgw-rich :deep(strong) { color: #0f172a; font-weight: 650; }
.pgw-rich :deep(.md-h) { margin: 6px 0 3px; color: #14533e; }
.pgw-rich :deep(.md-code) { margin: 4px 0; padding: 6px 8px; border-radius: 6px; background: #f1f5f9; color: #334155; font-size: 10px; white-space: pre-wrap; }
.pgw-rich :deep(.md-table) { width: 100%; margin: 4px 0; border-collapse: collapse; font-size: 10px; }
.pgw-rich :deep(.md-table th), .pgw-rich :deep(.md-table td) { padding: 3px 6px; border: 1px solid #e2e8f0; text-align: left; vertical-align: top; }
.pgw-rich :deep(.md-table th) { background: #f8fafc; color: #475569; }
.pgw-rich :deep(hr) { margin: 6px 0; border: 0; border-top: 1px solid #e2e8f0; }
.pgw-target-line { display: flex; flex-direction: column; gap: 1px; margin-bottom: 2px; }
.pgw-role { flex: 0 0 26px; color: #64748b; font-weight: 650; }
.pgw-chips { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; }
.pgw-chip { border: 1px solid #e2e8f0; background: #fff; color: #475569; padding: 2px 7px; border-radius: 5px; font-size: 10px; cursor: pointer; }
.pgw-chip:hover:not(:disabled) { background: #ebf5f1; color: #14533e; border-color: #cbe2d7; }
.pgw-chat-form { display: flex; gap: 7px; }
.pgw-chat-form input { flex: 1; min-width: 0; height: 34px !important; padding: 0 10px !important; font-size: 11.5px !important; border-radius: 7px; }
.pgw-chat-form .btn { height: 34px; }
.tag.mint { background: #ebf5f1; color: #14533e; }
.tag.gray { background: #f1f5f9; color: #475569; }
.tag.rose { background: #ffe4e6; color: #be123c; }
.tag.blue { background: #eff6ff; color: #1d4ed8; }
.tag.amber { background: #fffbeb; color: #92400e; }
.tag.violet { background: #f5f3ff; color: #6d28d9; }
@media (max-width: 1100px) {
  .pgw-left { width: 250px; }
  .pgw-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .pgw-profile, .pgw-decision-detail { grid-template-columns: minmax(0, 1fr); }
}
</style>
