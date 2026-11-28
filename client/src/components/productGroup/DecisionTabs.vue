<script setup>
import { nextTick } from "vue";
import { DECISION_TABS } from "./constants";

const props = defineProps({
  tab: { type: String, default: "overview" },
  counts: { type: Object, default: () => ({}) }
});
const emit = defineEmits(["change"]);

function change(key) {
  if (key !== props.tab) emit("change", key);
}

function onKeydown(event) {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const current = DECISION_TABS.findIndex((item) => item.key === props.tab);
  let next = current;
  if (event.key === "ArrowLeft") next = (current - 1 + DECISION_TABS.length) % DECISION_TABS.length;
  if (event.key === "ArrowRight") next = (current + 1) % DECISION_TABS.length;
  if (event.key === "Home") next = 0;
  if (event.key === "End") next = DECISION_TABS.length - 1;
  change(DECISION_TABS[next].key);
  nextTick(() => {
    const buttons = event.currentTarget.querySelectorAll('[role="tab"]');
    if (buttons[next]) buttons[next].focus();
  });
}
</script>

<template>
  <div class="pgw-tabs" role="tablist" aria-label="决策视图" @keydown="onKeydown">
    <button
      v-for="item in DECISION_TABS"
      :key="item.key"
      type="button"
      role="tab"
      :data-tab="item.key"
      :aria-selected="tab === item.key"
      :class="{ active: tab === item.key }"
      @click="change(item.key)"
    >
      {{ item.label }}
      <em :class="{ danger: item.key === 'missing' && (counts.missing || 0) > 0 }">{{ counts[item.key] || 0 }}</em>
    </button>
  </div>
</template>
