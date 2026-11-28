<script setup>
import { computed, ref } from "vue";

const props = defineProps({
  diff: { type: Object, default: null },
  conflicts: { type: Array, default: () => [] }
});
const emit = defineEmits(["locate-target"]);

const expanded = ref(false);
const hasDiff = computed(() => !!(props.diff && props.diff.has));
const total = computed(() => {
  if (!props.diff) return 0;
  return (props.diff.added || []).length + (props.diff.changed || []).length + (props.diff.removed || []).length + (props.diff.dictionaries || []).length;
});

function locate(target) {
  if (target) emit("locate-target", target);
}
</script>

<template>
  <div v-if="hasDiff || conflicts.length" class="pgw-diff-wrap">
    <div class="pgw-diff-line">
      <b>与上一版相比</b>
      <span v-if="hasDiff">{{ total }} 项变化</span>
      <span v-if="hasDiff" class="dim">
        新增 {{ (diff.added || []).length }} · 修改 {{ (diff.changed || []).length }} · 删除 {{ (diff.removed || []).length }} · 字典 {{ (diff.dictionaries || []).length }}
      </span>
      <span v-if="conflicts.length" class="tag rose">约束冲突 {{ conflicts.length }}</span>
      <button type="button" class="pgw-text-button" @click="expanded = !expanded">{{ expanded ? "收起" : "查看差异" }}</button>
    </div>
    <div v-if="expanded" class="pgw-diff-detail">
      <div v-if="(diff && diff.added || []).length" class="pgw-diff-row">
        <span class="dim">新增决策</span>
        <button v-for="target in diff.added" :key="'add-' + target" type="button" class="pgw-link-button" @click="locate(target)">{{ target }}</button>
      </div>
      <div v-if="(diff && diff.changed || []).length" class="pgw-diff-row">
        <span class="dim">修改决策</span>
        <button v-for="target in diff.changed" :key="'chg-' + target" type="button" class="pgw-link-button" @click="locate(target)">{{ target }}</button>
      </div>
      <div v-if="(diff && diff.removed || []).length" class="pgw-diff-row">
        <span class="dim">删除决策</span>
        <span v-for="target in diff.removed" :key="'del-' + target" class="mono">{{ target }}</span>
      </div>
      <div v-if="(diff && diff.dictionaries || []).length" class="pgw-diff-row">
        <span class="dim">新增字典</span>
        <span v-for="code in diff.dictionaries" :key="'dict-' + code" class="mono">{{ code }}</span>
      </div>
      <div v-for="(conflict, index) in conflicts" :key="'conflict-' + index" class="pgw-diff-row pgw-diff-conflict">
        <span class="tag rose">冲突</span>
        <span>{{ conflict.message || conflict.code || "约束冲突" }}</span>
        <button v-if="conflict.targetField" type="button" class="pgw-link-button" @click="locate(conflict.targetField)">{{ conflict.targetField }}</button>
      </div>
    </div>
  </div>
</template>
