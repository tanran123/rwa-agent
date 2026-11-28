<script setup>
import { computed } from "vue";
import DecisionSummary from "./DecisionSummary.vue";
import DecisionToolbar from "./DecisionToolbar.vue";
import VersionDiffBanner from "./VersionDiffBanner.vue";
import DecisionTabs from "./DecisionTabs.vue";
import DecisionList from "./DecisionList.vue";
import DecisionBatchBar from "./DecisionBatchBar.vue";
import { stageLabel } from "./helpers";

const props = defineProps({
  proposal: { type: Object, default: null },
  selection: { type: Object, default: () => ({ decisions: [], fields: [], mappings: [], dictionaries: [] }) },
  confirmations: { type: Array, default: () => [] },
  findings: { type: Array, default: () => [] },
  activeTarget: { type: String, default: "" },
  tab: { type: String, default: "overview" },
  loading: { type: Boolean, default: false },
  readOnly: { type: Boolean, default: false },
  progress: { type: Object, default: () => ({ active: false }) },
  generatedAt: { type: String, default: "" },
  groupLabel: { type: String, default: "" },
  groupStatus: { type: String, default: "pending" },
  diff: { type: Object, default: null },
  conflicts: { type: Array, default: () => [] },
  requiresApproval: { type: Boolean, default: false },
  blocked: { type: Boolean, default: false },
  blockedCount: { type: Number, default: 0 },
  briefFields: { type: Array, default: () => [] }
});
const emit = defineEmits([
  "generate",
  "regenerate",
  "regenerate-fresh",
  "apply",
  "toggle-selection",
  "select-all",
  "clear-selection",
  "change-tab",
  "locate-target",
  "locate-diff",
  "open-assistant"
]);

const decisions = computed(() => (props.proposal && props.proposal.decisions) || []);
const selectedCount = computed(() => (props.selection.decisions || []).length);

const decisionCounts = computed(() => {
  const counts = { reuse: 0, create: 0, default: 0, system: 0, skip: 0, missing: 0 };
  decisions.value.forEach((item) => {
    counts[item.decisionType] = (counts[item.decisionType] || 0) + 1;
  });
  return counts;
});

const tabCounts = computed(() => {
  const seen = new Set();
  decisions.value.forEach((item) => {
    if (item.standardField && item.standardField.name) seen.add(item.standardField.name);
  });
  return {
    overview: decisions.value.length,
    fields: seen.size,
    dictionaries: ((props.proposal && props.proposal.newDictionaries) || []).length,
    mappings: decisions.value.filter((item) => item.mapping).length,
    notes: ((props.proposal && props.proposal.fieldNotes) || []).length,
    missing: ((props.proposal && props.proposal.missing) || []).length
  };
});

const streamPct = computed(() => {
  if (!props.progress.total) return props.progress.active ? 8 : 0;
  return Math.min(100, Math.round(((props.progress.done || 0) / props.progress.total) * 100));
});
</script>

<template>
  <section class="pgw-decision-section">
    <div class="pgw-section-head">
      <span class="pgw-section-title">02 标准字段、字典与映射决策</span>
    </div>

    <div v-if="progress.active" class="pgw-progress-strip">
      <div class="pgw-progress-strip-head">
        <b>{{ stageLabel(progress.stage) }}</b>
        <span class="dim">{{ progress.message }}</span>
      </div>
      <div class="pgw-progress-bar"><i :style="{ width: streamPct + '%' }"></i></div>
      <div class="dim">{{ progress.done || 0 }} / {{ progress.total || 0 }} 个监管字段已决策</div>
    </div>

    <div v-if="findings.length" class="pgw-review-strip">
      <span class="tag amber">检查问题 {{ findings.length }}</span>
      <span class="dim">部分决策需要人工确认</span>
      <span class="spacer"></span>
      <button type="button" class="btn xs" @click="emit('open-assistant')">查看</button>
    </div>

    <div v-if="requiresApproval" class="pgw-review-strip">
      <span class="tag rose">需要人工确认</span>
      <span class="dim">当前建议等待你批准后才会生效</span>
      <span class="spacer"></span>
      <button type="button" class="btn xs" @click="emit('open-assistant')">打开助手</button>
    </div>

    <div v-if="loading && !proposal" class="pgw-empty-proposal">
      <div class="pgw-empty-title">正在生成本组建议…</div>
      <div class="dim">会读取本组监管字段画像、规则用途、已有标准字段和字典。</div>
    </div>

    <div v-else-if="!proposal && !progress.active" class="pgw-empty-proposal">
      <div class="pgw-empty-title">{{ groupStatus === "skipped" ? "本组已跳过" : "尚未生成本组建议" }}</div>
      <div class="dim">
        {{ groupStatus === "skipped"
          ? "跳过的分组不会生成建议稿，也不会应用任何字段或映射。"
          : "会读取本组监管字段画像、规则用途、已有标准字段和字典，为每个字段生成一条决策。" }}
      </div>
      <button
        v-if="groupStatus !== 'skipped'"
        type="button"
        class="btn primary"
        :disabled="readOnly || loading"
        @click="emit('generate')"
      >
        {{ loading ? "正在生成…" : "生成本组建议" }}
      </button>
    </div>

    <template v-else-if="proposal">
      <DecisionSummary
        :proposal="proposal"
        :counts="decisionCounts"
        :generated-at="generatedAt"
        :group-label="groupLabel"
      />

      <VersionDiffBanner :diff="diff" :conflicts="conflicts" @locate-target="emit('locate-diff', $event)" />

      <div v-if="(proposal.newStandardGroups || []).length" class="pgw-new-groups">
        <div class="pgw-subhead">建议新建标准字段分组</div>
        <div v-for="group in proposal.newStandardGroups" :key="group.group_id" class="pgw-new-group">
          <b>{{ group.label || group.group_id }}</b>
          <span class="mono">{{ group.group_id }}</span>
          <span class="dim">{{ group.description }}</span>
        </div>
      </div>

      <div class="pgw-decision-sticky">
        <DecisionToolbar
          :selected-count="selectedCount"
          :decision-total="decisions.length"
          :read-only="readOnly"
          :loading="loading"
          :blocked="blocked"
          :blocked-count="blockedCount"
          @select-all="emit('select-all')"
          @clear-selection="emit('clear-selection')"
          @regenerate="emit('regenerate')"
          @regenerate-fresh="emit('regenerate-fresh')"
          @apply="emit('apply')"
        />
        <DecisionTabs :tab="tab" :counts="tabCounts" @change="emit('change-tab', $event)" />
      </div>

      <DecisionList
        :tab="tab"
        :proposal="proposal"
        :selection="selection"
        :confirmations="confirmations"
        :findings="findings"
        :active-target="activeTarget"
        :brief-fields="briefFields"
        :read-only="readOnly"
        @toggle-selection="(kind, value) => emit('toggle-selection', kind, value)"
        @locate-target="emit('locate-target', $event)"
        @generate="emit('generate')"
      />

      <div v-if="(proposal.suggestions || []).length" class="pgw-suggestions">
        <span class="dim">建议：</span>
        <span v-for="(item, index) in proposal.suggestions" :key="index" class="pgw-suggestion">{{ item }}</span>
      </div>
      <div v-if="(proposal.warnings || []).length" class="pgw-warnings">
        <div v-for="(item, index) in proposal.warnings" :key="index">⚠ {{ item }}</div>
      </div>

      <DecisionBatchBar
        :selected-count="selectedCount"
        :decision-total="decisions.length"
        :field-count="(selection.fields || []).length"
        :mapping-count="(selection.mappings || []).length"
        :dictionary-count="(selection.dictionaries || []).length"
        :read-only="readOnly"
        :blocked="blocked"
        @select-all="emit('select-all')"
        @clear-selection="emit('clear-selection')"
        @apply="emit('apply')"
      />
    </template>
  </section>
</template>
