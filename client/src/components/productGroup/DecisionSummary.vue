<script setup>
import { computed, ref } from "vue";

const props = defineProps({
  proposal: { type: Object, required: true },
  counts: { type: Object, required: true },
  generatedAt: { type: String, default: "" },
  groupLabel: { type: String, default: "" }
});

const expanded = ref(false);
const summary = computed(() => {
  const list = props.proposal.decisions || [];
  return "本组 " + list.length + " 个监管字段，已形成 " + list.length + " 项处理决策";
});
const purpose = computed(() => props.proposal.groupPurpose || "只应用当前分组；确认后仍需点「保存全部」写入。");
const countItems = computed(() => ([
  ["reuse", "复用", "mint"],
  ["create", "新建", "blue"],
  ["default", "默认值", "amber"],
  ["system", "系统计算", "violet"],
  ["skip", "跳过", "gray"],
  ["missing", "缺失", "rose"]
]).map(([key, label, cls]) => ({ key, label, cls, value: props.counts[key] || 0 })));
</script>

<template>
  <div class="pgw-summary">
    <div class="pgw-summary-main">
      <div class="pgw-summary-title">{{ summary }}</div>
      <div class="pgw-summary-sub">生成于 {{ generatedAt }} · 仅作用域：{{ groupLabel }}</div>
    </div>
    <div class="pgw-summary-counts">
      <span
        v-for="item in countItems"
        :key="item.key"
        class="pgw-count-chip"
        :class="[item.cls, { zero: !item.value }]"
      >
        {{ item.label }} <b>{{ item.value }}</b>
      </span>
    </div>
    <div class="pgw-summary-purpose">
      <span class="pgw-summary-purpose-text" :class="{ clamp: !expanded }">{{ purpose }}</span>
      <button type="button" class="pgw-text-button" @click="expanded = !expanded">{{ expanded ? "收起" : "展开" }}</button>
    </div>
  </div>
</template>
