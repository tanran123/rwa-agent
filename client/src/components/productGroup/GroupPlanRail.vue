<script setup>
import { computed } from "vue";
import { STATUS_TEXT } from "./constants";

const props = defineProps({
  plan: { type: Array, default: () => [] },
  currentIndex: { type: Number, default: 0 },
  statuses: { type: Object, default: () => ({}) },
  appliedStats: { type: Object, default: () => ({}) },
  bulkRunning: { type: Boolean, default: false },
  bulkDone: { type: Number, default: 0 },
  bulkTotal: { type: Number, default: 0 },
  readOnly: { type: Boolean, default: false }
});
const emit = defineEmits(["select", "move", "reset", "bulk"]);

const confirmedCount = computed(() => props.plan.filter((group) => props.statuses[group.id] === "confirmed").length);
const finishedCount = computed(() => props.plan.filter((group) => ["confirmed", "skipped"].includes(props.statuses[group.id])).length);
const progressPct = computed(() => (props.plan.length ? Math.round((finishedCount.value / props.plan.length) * 100) : 0));
const finished = computed(() => props.plan.length > 0 && finishedCount.value === props.plan.length);

function statusOf(group) {
  return props.statuses[group.id] || "pending";
}

function adoptionOf(group) {
  const stat = props.appliedStats[group.id];
  if (!stat) return "";
  return "决策 " + stat.decisions + "/" + stat.proposedDecisions + " · 字段 " + stat.fields + "/" + stat.proposedFields;
}

function selectGroup(index) {
  emit("select", index);
}
</script>

<template>
  <aside class="pgw-left">
    <div class="pgw-left-head">
      <div class="pgw-left-title"><b>分组计划</b><span>{{ confirmedCount }} / {{ plan.length }} 已完成</span></div>
      <div class="pgw-progress"><i :style="{ width: progressPct + '%' }"></i></div>
    </div>
    <div class="pgw-groups">
      <div
        v-for="(group, index) in plan"
        :key="group.id"
        class="pgw-group-card"
        :class="{ active: index === currentIndex, done: statuses[group.id] === 'confirmed', skipped: statuses[group.id] === 'skipped' }"
        role="button"
        tabindex="0"
        @click="selectGroup(index)"
        @keydown.enter.prevent="selectGroup(index)"
        @keydown.space.prevent="selectGroup(index)"
      >
        <div class="pgw-group-main">
          <div class="pgw-group-title"><span class="pgw-num">{{ String(index + 1).padStart(2, "0") }}</span>{{ group.label }}</div>
          <div class="pgw-group-meta">{{ group.stats.fields }} 字段 · 必填 {{ group.stats.required }} · 未映射 {{ group.stats.unmapped }}</div>
          <div class="pgw-group-foot">
            <span class="pgw-status" :class="statusOf(group)">{{ STATUS_TEXT[statusOf(group)] || "未处理" }}</span>
            <span v-if="adoptionOf(group)" class="pgw-adopt">{{ adoptionOf(group) }}</span>
          </div>
        </div>
        <div class="pgw-reorder" @click.stop>
          <button type="button" :disabled="index === 0 || bulkRunning" title="上移" @click="emit('move', index, -1)">↑</button>
          <button type="button" :disabled="index === plan.length - 1 || bulkRunning" title="下移" @click="emit('move', index, 1)">↓</button>
        </div>
      </div>
      <p v-if="!plan.length" class="pgw-empty">还没有分组计划。</p>
    </div>
    <div class="pgw-left-foot">
      <button type="button" class="btn xs" :disabled="bulkRunning" @click="emit('reset')">重置进度</button>
      <button type="button" class="btn xs" :disabled="readOnly || (!bulkRunning && !plan.length)" @click="emit('bulk')">
        {{ bulkRunning ? "停止生成（" + bulkDone + "/" + bulkTotal + "）" : "批量生成" }}
      </button>
      <span class="spacer"></span>
      <span>{{ finished ? "已全部完成" : confirmedCount + "/" + plan.length }}</span>
    </div>
  </aside>
</template>
