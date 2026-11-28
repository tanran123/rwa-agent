<script setup>
import { nextTick, onMounted, ref, watch } from "vue";

const props = defineProps({
  modelValue: { type: String, default: "" },
  quickActions: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
  readOnly: { type: Boolean, default: false },
  placeholder: { type: String, default: "输入调整意见，或提问当前分组的字段、字典、映射细节…" }
});
const emit = defineEmits(["update:modelValue", "send", "action"]);

const area = ref(null);
const MAX_HEIGHT = 108;

function resize() {
  const el = area.value;
  if (!el) return;
  el.style.height = "auto";
  el.style.height = Math.min(MAX_HEIGHT, Math.max(58, el.scrollHeight)) + "px";
}
function onInput(event) {
  emit("update:modelValue", event.target.value);
  resize();
}
function submit() {
  const text = String(props.modelValue || "").trim();
  if (!text || props.loading || props.readOnly) return;
  emit("send", text);
  nextTick(resize);
}
watch(() => props.modelValue, () => nextTick(resize));
onMounted(resize);
</script>

<template>
  <div class="pgc">
    <div v-if="quickActions.length" class="pgc-actions">
      <button
        v-for="item in quickActions"
        :key="item.key"
        type="button"
        class="pgc-chip"
        :class="{ primary: item.primary }"
        :disabled="loading || readOnly"
        @click="emit('action', item)"
      >{{ item.label }}</button>
    </div>
    <form class="pgc-form" @submit.prevent="submit">
      <textarea
        ref="area"
        :value="modelValue"
        rows="2"
        :disabled="readOnly || loading"
        :placeholder="placeholder"
        @input="onInput"
        @keydown.enter.exact.prevent="submit"
      ></textarea>
      <button type="submit" class="pgc-send" :disabled="readOnly || loading || !modelValue.trim()">
        {{ loading ? "处理中…" : "发送" }}
      </button>
    </form>
    <div class="pgc-hint">Enter 发送 · Shift+Enter 换行</div>
  </div>
</template>

<style scoped>
.pgc { flex: 0 0 auto; border-top: 1px solid #f1f5f9; background: #f8fafc; }
.pgc-actions { display: flex; align-items: center; gap: 5px; padding: 6px 10px 0; overflow-x: auto; scrollbar-width: none; }
.pgc-actions::-webkit-scrollbar { display: none; }
.pgc-chip { flex: 0 0 auto; height: 22px; padding: 0 8px; border: 1px solid #e2e8f0; border-radius: 999px; background: #fff; color: #475569; font-size: 10px; cursor: pointer; white-space: nowrap; }
.pgc-chip:hover:not(:disabled) { border-color: #cbe2d7; background: #ebf5f1; color: #14533e; }
.pgc-chip.primary { border-color: #19614a; background: #19614a; color: #fff; }
.pgc-chip.primary:hover:not(:disabled) { background: #144f3c; color: #fff; }
.pgc-chip:disabled { opacity: .5; cursor: not-allowed; }
.pgc-form { display: flex; align-items: flex-end; gap: 7px; padding: 6px 10px 2px; }
.pgc-form textarea { flex: 1; min-width: 0; resize: none; min-height: 58px; max-height: 108px; padding: 7px 9px; border: 1px solid #e2e8f0; border-radius: 8px; background: #fff; color: #334155; font: inherit; font-size: 11.5px; line-height: 1.55; }
.pgc-form textarea:focus { outline: 2px solid #cbe2d7; outline-offset: -1px; }
.pgc-send { flex: 0 0 auto; height: 30px; padding: 0 12px; border: 1px solid #19614a; border-radius: 7px; background: #19614a; color: #fff; font-size: 11px; cursor: pointer; }
.pgc-send:hover:not(:disabled) { background: #144f3c; }
.pgc-send:disabled { opacity: .5; cursor: not-allowed; }
.pgc-hint { padding: 0 10px 6px; color: #94a3b8; font-size: 9px; }
</style>
