<script setup>
import { ref } from "vue";
import { STATUS_TEXT } from "./constants";

defineProps({
  group: { type: Object, default: null },
  status: { type: String, default: "pending" },
  finished: { type: Boolean, default: false },
  readOnly: { type: Boolean, default: false },
  bulkRunning: { type: Boolean, default: false }
});
const emit = defineEmits(["prev", "next", "skip", "export"]);

const confirmSkip = ref(false);

function skip() {
  confirmSkip.value = false;
  emit("skip");
}

function exportGroup(event) {
  const details = event && event.currentTarget && event.currentTarget.closest("details");
  if (details) details.open = false;
  emit("export");
}
</script>

<template>
  <div v-if="group" class="pgw-main-head">
    <div>
      <div class="pgw-main-title">
        {{ group.label }}
        <span class="mono">{{ group.id }}</span>
      </div>
      <div class="pgw-main-sub">
        <span>{{ group.stats.fields }} 字段</span>
        <span>必填 {{ group.stats.required }}</span>
        <span>未映射 {{ group.stats.unmapped }}</span>
        <span v-if="group.stats.systemCalc">系统计算 {{ group.stats.systemCalc }}</span>
        <span class="pgw-status" :class="status">{{ STATUS_TEXT[status] || "未处理" }}</span>
      </div>
    </div>
    <div class="pgw-actions">
      <button type="button" class="btn sm" @click="emit('prev')">← 上一组</button>
      <template v-if="confirmSkip">
        <span class="pgw-confirm-inline">
          确认跳过？
          <button type="button" class="btn xs" @click="skip">跳过</button>
          <button type="button" class="btn xs" @click="confirmSkip = false">取消</button>
        </span>
      </template>
      <button v-else type="button" class="btn sm" :disabled="readOnly || bulkRunning" @click="confirmSkip = true">跳过本组</button>
      <button type="button" class="btn sm" :disabled="finished || bulkRunning" @click="emit('next')">下一组 →</button>
      <details class="pgw-more">
        <summary class="btn sm">更多 ▾</summary>
        <div class="pgw-more-list" role="menu">
          <button type="button" role="menuitem" @click="exportGroup($event)">导出本组 JSON</button>
        </div>
      </details>
    </div>
  </div>
</template>
