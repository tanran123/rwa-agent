<script setup>
import { computed, reactive, ref } from "vue";
import RegulatoryFieldDetail from "./RegulatoryFieldDetail.vue";
import { DECISION_CLASSES, DECISION_LABELS } from "./constants";
import { decisionStandardText, fieldProfile, fieldTypeLabel } from "./helpers";

const props = defineProps({
  fields: { type: Array, default: () => [] },
  proposal: { type: Object, default: null },
  findings: { type: Array, default: () => [] },
  activeTarget: { type: String, default: "" },
  loading: { type: Boolean, default: false },
  readOnly: { type: Boolean, default: false },
  hasGroup: { type: Boolean, default: false }
});
const emit = defineEmits(["locate-target", "generate", "show-missing"]);

const filters = reactive({ required: false, unmapped: false, system: false, type: "", keyword: "" });
const expandedField = ref("");

const decisionByTarget = computed(() => {
  const map = new Map();
  ((props.proposal && props.proposal.decisions) || []).forEach((item) => {
    if (item && item.targetField) map.set(item.targetField, item);
  });
  return map;
});

const typeOptions = computed(() => Array.from(new Set(props.fields.map((field) => field.type || "string"))));

const visibleFields = computed(() => {
  const keyword = String(filters.keyword || "").trim().toLowerCase();
  return props.fields.filter((field) => {
    if (filters.required && !field.required) return false;
    if (filters.unmapped && field.mapped) return false;
    if (filters.system && !field.systemCalc) return false;
    if (filters.type && (field.type || "string") !== filters.type) return false;
    if (!keyword) return true;
    const profile = fieldProfile(field);
    const hay = [
      field.name,
      field.label,
      profile.definition,
      profile.note,
      ...(field.usedBy || []).map((rule) => [rule.ruleId, rule.ruleLabel, rule.path, rule.whenText, rule.note].join(" "))
    ].join(" ").toLowerCase();
    return hay.includes(keyword);
  });
});

function currentDecision(field) {
  return decisionByTarget.value.get(field.name) || null;
}

function currentTag(decision) {
  if (!decision) return "gray";
  return DECISION_CLASSES[decision.decisionType] || "gray";
}

function currentLabel(decision) {
  if (!decision) return props.proposal ? "未覆盖" : "待生成";
  return DECISION_LABELS[decision.decisionType] || decision.decisionType;
}

function currentText(decision) {
  if (!decision) return props.proposal ? "未覆盖" : "待生成";
  if (decision.decisionType === "default") return (decision.mapping && decision.mapping.defaultValue ? decision.mapping.defaultValue : "（空）");
  if (decision.decisionType === "system") return "系统派生";
  if (decision.decisionType === "skip") return "跳过";
  if (decision.decisionType === "missing") return "待人工处理";
  return decisionStandardText(decision);
}

function rowClass(field) {
  return {
    linked: props.activeTarget === field.name,
    blocked: props.findings.some((finding) => finding.targetField === field.name && finding.severity === "error")
  };
}

function toggleDetail(name) {
  expandedField.value = expandedField.value === name ? "" : name;
}

function rowClick(field, event) {
  if (event.target.closest("button, a, input, select, label")) return;
  if (props.activeTarget === field.name) {
    toggleDetail(field.name);
    return;
  }
  emit("locate-target", field.name);
}

function generate() {
  emit("generate");
}

function clearFilters() {
  filters.required = false;
  filters.unmapped = false;
  filters.system = false;
  filters.type = "";
  filters.keyword = "";
}
</script>

<template>
  <section class="pgw-field-section">
    <div class="pgw-section-head-wrap">
      <div class="pgw-section-head">
        <span class="pgw-section-title">01 监管字段与规则用途</span>
        <span class="dim">显示 <b>{{ visibleFields.length }}</b> / <b>{{ fields.length }}</b></span>
      </div>
      <div class="pgw-field-filters">
        <label class="pgw-check"><input v-model="filters.required" type="checkbox"> 只看必填</label>
        <label class="pgw-check"><input v-model="filters.unmapped" type="checkbox"> 只看未映射</label>
        <label class="pgw-check"><input v-model="filters.system" type="checkbox"> 只看系统计算</label>
        <select v-model="filters.type" aria-label="字段类型">
          <option value="">全部类型</option>
          <option v-for="type in typeOptions" :key="type" :value="type">{{ fieldTypeLabel(type) }}</option>
        </select>
        <input v-model="filters.keyword" type="search" placeholder="搜索字段、中文名或规则">
        <button type="button" class="btn xs" @click="clearFilters">清除</button>
      </div>
    </div>

    <div v-if="loading" class="pgw-empty">正在读取本组监管字段…</div>
    <div v-else-if="!hasGroup" class="pgw-empty">选择左侧分组开始。</div>
    <div v-else-if="!fields.length" class="pgw-empty">本组没有监管字段。</div>
    <div v-else class="pgw-table-box">
      <table class="pgw-table pgw-field-table">
        <thead>
          <tr>
            <th style="width:150px">监管字段</th>
            <th style="width:100px">中文名</th>
            <th style="width:150px">类型 / 取值</th>
            <th style="width:150px">规则用途</th>
            <th style="width:130px">当前处理</th>
            <th style="width:28px"></th>
          </tr>
        </thead>
        <tbody>
          <template v-for="field in visibleFields" :key="field.name">
            <tr
              class="pgw-click-row"
              :class="rowClass(field)"
              :data-field="field.name"
              tabindex="0"
              @click="rowClick(field, $event)"
              @keydown.enter.prevent="rowClick(field, $event)"
            >
              <td>
                <span class="mono pgw-strong">{{ field.name }}</span>
                <span v-if="field.required" class="tag amber pgw-required">必填</span>
                <span v-if="field.systemCalc" class="tag blue">系统计算</span>
              </td>
              <td>{{ field.label }}</td>
              <td>
                <div>{{ fieldTypeLabel(field.type) }}<span v-if="(field.options || []).length"> · {{ field.options.length }} 个取值</span></div>
                <div v-if="field.profile && field.profile.dictionary" class="dim">{{ field.profile.dictionary.dict_name }}</div>
              </td>
              <td>
                <template v-if="(field.usedBy || []).length">
                  <span
                    v-for="use in (field.usedBy || []).slice(0, 2)"
                    :key="use.kind + use.ruleId + use.path + use.whenText"
                    class="pgw-rule-wrap"
                    tabindex="0"
                  >
                    <span class="pgw-rule-chip" :class="use.kind">
                      {{ use.kind === "weight" ? "权重" : "分类" }} <span class="mono">{{ use.ruleId }}</span>
                    </span>
                    <span class="pgw-rule-tip">
                      <b>{{ use.ruleLabel || use.ruleId }}</b>
                      <span v-if="use.path" class="mono">{{ use.path }}</span>
                      <span v-if="use.whenText">条件：{{ use.whenText }}</span>
                      <span>{{ use.note || "引用该字段进行规则判断" }}</span>
                      <span v-if="use.article" class="mono">{{ use.article }}</span>
                    </span>
                  </span>
                  <button
                    v-if="field.usedBy.length > 2"
                    type="button"
                    class="pgw-rule-more"
                    @click.stop="toggleDetail(field.name)"
                  >+{{ field.usedBy.length - 2 }}</button>
                </template>
                <span v-else class="dim">—</span>
              </td>
              <td>
                <button
                  v-if="!currentDecision(field)"
                  type="button"
                  class="tag"
                  :class="currentTag(null)"
                  :disabled="readOnly"
                  @click.stop="proposal ? emit('show-missing', field.name) : generate()"
                >{{ currentLabel(null) }}</button>
                <button
                  v-else
                  type="button"
                  class="tag"
                  :class="currentTag(currentDecision(field))"
                  @click.stop="emit('locate-target', field.name)"
                >
                  {{ currentLabel(currentDecision(field)) }}
                  <span v-if="currentDecision(field).decisionType !== 'skip' && currentDecision(field).decisionType !== 'missing' && currentDecision(field).decisionType !== 'system'" class="pgw-tag-detail">
                    {{ currentText(currentDecision(field)) }}
                  </span>
                </button>
              </td>
              <td class="dim">
                <button type="button" class="pgw-chevron" :aria-expanded="expandedField === field.name" @click.stop="toggleDetail(field.name)">
                  {{ expandedField === field.name ? "▾" : "▸" }}
                </button>
              </td>
            </tr>
            <tr v-if="expandedField === field.name" class="pgw-detail-row">
              <td colspan="6">
                <RegulatoryFieldDetail :field="field" />
              </td>
            </tr>
          </template>
        </tbody>
      </table>
      <p v-if="!visibleFields.length" class="pgw-empty">没有符合筛选条件的监管字段。</p>
    </div>
  </section>
</template>
