<script setup>
defineProps({
  selectedCount: { type: Number, default: 0 },
  decisionTotal: { type: Number, default: 0 },
  fieldCount: { type: Number, default: 0 },
  mappingCount: { type: Number, default: 0 },
  dictionaryCount: { type: Number, default: 0 },
  readOnly: { type: Boolean, default: false },
  blocked: { type: Boolean, default: false }
});
const emit = defineEmits(["select-all", "clear-selection", "apply"]);
</script>

<template>
  <div class="pgw-batch-bar">
    <span class="dim">已选 <b>{{ selectedCount }}</b> / {{ decisionTotal }}</span>
    <button type="button" class="btn xs" :disabled="readOnly" @click="emit('select-all')">全选</button>
    <button type="button" class="btn xs" :disabled="readOnly" @click="emit('clear-selection')">清空</button>
    <span class="dim pgw-batch-detail">决策 {{ selectedCount }} · 字段 {{ fieldCount }} · 映射 {{ mappingCount }} · 字典 {{ dictionaryCount }}</span>
    <span class="spacer"></span>
    <button
      type="button"
      class="btn sm primary"
      :disabled="readOnly || !selectedCount || blocked"
      :title="blocked ? '存在冲突决策，请先按检查建议调整' : '只应用当前勾选的决策'"
      @click="emit('apply')"
    >
      确认应用（{{ selectedCount }}）
    </button>
  </div>
</template>
