<script setup>
import { askConfirm } from "@/utils/confirm";

defineProps({
  selectedCount: { type: Number, default: 0 },
  decisionTotal: { type: Number, default: 0 },
  readOnly: { type: Boolean, default: false },
  loading: { type: Boolean, default: false },
  blocked: { type: Boolean, default: false },
  blockedCount: { type: Number, default: 0 }
});
const emit = defineEmits(["select-all", "clear-selection", "regenerate", "regenerate-fresh", "apply"]);

async function freshRegenerate(event) {
  const details = event && event.currentTarget && event.currentTarget.closest("details");
  if (details) details.open = false;
  const yes = await askConfirm(
    "清空勾选重生成会清空本组的决策、标准字段、字典和映射选择，并清除已确认状态。",
    { title: "清空勾选重生成", confirmText: "清空并重生成", danger: true }
  );
  if (yes) emit("regenerate-fresh");
}
</script>

<template>
  <div class="pgw-decision-toolbar">
    <div class="pgw-toolbar-left">
      <span class="dim">已选 <b>{{ selectedCount }}</b> / {{ decisionTotal }}</span>
      <button type="button" class="btn xs" :disabled="readOnly" @click="emit('select-all')">全选</button>
      <button type="button" class="btn xs" :disabled="readOnly" @click="emit('clear-selection')">清空</button>
      <span v-if="blocked" class="tag rose">冲突 {{ blockedCount }} 项</span>
    </div>
    <div class="pgw-toolbar-right">
      <button type="button" class="btn sm" :disabled="readOnly || loading" @click="emit('regenerate')">重新生成</button>
      <details class="pgw-more">
        <summary class="btn sm" :class="{ disabled: readOnly || loading }">更多 ▾</summary>
        <div class="pgw-more-list" role="menu">
          <button type="button" role="menuitem" :disabled="readOnly || loading" @click="freshRegenerate($event)">清空勾选重生成</button>
        </div>
      </details>
      <button
        type="button"
        class="btn sm primary"
        :disabled="readOnly || !selectedCount || blocked"
        :title="blocked ? '存在冲突决策，请先按检查建议调整' : '只应用当前勾选的决策'"
        @click="emit('apply')"
      >
        确认本组并应用（{{ selectedCount }}）
      </button>
    </div>
  </div>
</template>
