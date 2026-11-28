<script setup>
import { computed, nextTick, onMounted, ref, watch } from "vue";
import AssistantEventCard from "./AssistantEventCard.vue";
import AssistantComposer from "./AssistantComposer.vue";

const props = defineProps({
  width: { type: Number, default: 380 },
  resizing: { type: Boolean, default: false },
  statusText: { type: String, default: "待开始" },
  statusTone: { type: String, default: "idle" },
  groupLabel: { type: String, default: "当前分组" },
  events: { type: Array, default: () => [] },
  filter: { type: String, default: "all" },
  loading: { type: Boolean, default: false },
  readOnly: { type: Boolean, default: false },
  quickActions: { type: Array, default: () => [] },
  modelValue: { type: String, default: "" }
});
const emit = defineEmits(["close", "resize-start", "resize-reset", "update:filter", "update:modelValue", "send", "action"]);

const MESSAGE_TYPES = ["user_message", "assistant_answer"];
const timelineRef = ref(null);
const nearBottom = ref(true);
const newCount = ref(0);

const filtered = computed(() => {
  const list = props.events || [];
  if (props.filter === "chat") return list.filter((event) => MESSAGE_TYPES.includes(event.type));
  if (props.filter === "result") return list.filter((event) => !MESSAGE_TYPES.includes(event.type));
  return list;
});

function dividerOf(event, index) {
  if (!MESSAGE_TYPES.includes(event.type) || !event.groupId) return "";
  const previous = filtered.value
    .slice(0, index)
    .reverse()
    .find((item) => MESSAGE_TYPES.includes(item.type));
  if (previous && previous.groupId === event.groupId) return "";
  return event.groupLabel || event.groupId;
}

function onScroll() {
  const el = timelineRef.value;
  if (!el) return;
  const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
  nearBottom.value = distance < 80;
  if (nearBottom.value) newCount.value = 0;
}
function toBottom() {
  nextTick(() => {
    const el = timelineRef.value;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    nearBottom.value = true;
    newCount.value = 0;
  });
}
function focusEvent(type) {
  const el = timelineRef.value && timelineRef.value.querySelector('[data-event-type="' + type + '"]');
  if (!el) return;
  if (el.scrollIntoView) el.scrollIntoView({ block: "start", behavior: "smooth" });
}
defineExpose({ focusEvent, toBottom });

const signature = computed(() => {
  const list = filtered.value;
  const last = list[list.length - 1];
  return list.length + ":" + (last ? String(last.text || last.title || "").length : 0) + ":" + props.filter;
});
watch(signature, () => {
  if (nearBottom.value) toBottom();
  else if (!props.loading || filtered.value.length) newCount.value += 1;
});
watch(() => props.filter, () => toBottom());
onMounted(() => {
  if (filtered.value.length) toBottom();
});
</script>

<template>
  <aside class="pga" :style="{ width: width + 'px' }">
    <div
      class="pga-resize"
      :class="{ active: resizing }"
      title="拖动调整助手宽度，双击恢复默认"
      @mousedown.prevent="emit('resize-start', $event)"
      @dblclick="emit('resize-reset')"
    ></div>

    <header class="pga-head">
      <div class="pga-head-main">
        <b>智能助手</b>
        <span class="pga-status" :class="statusTone">
          <i class="pga-dot"></i>{{ statusText }}
        </span>
        <span class="spacer"></span>
        <button type="button" class="pga-close" aria-label="收起智能助手" @click="emit('close')">×</button>
      </div>
      <div class="pga-head-sub">
        <span class="pga-group" :title="groupLabel">{{ groupLabel }}</span>
        <span class="spacer"></span>
        <select :value="filter" title="筛选交付过程" @change="emit('update:filter', $event.target.value)">
          <option value="all">全部过程</option>
          <option value="chat">只看对话</option>
          <option value="result">只看结果</option>
        </select>
      </div>
    </header>

    <div ref="timelineRef" class="pga-timeline" @scroll.passive="onScroll">
      <div v-if="!filtered.length" class="pga-empty">
        <div class="pga-empty-title">可以开始分组配置</div>
        <div>提出调整意见，或直接问当前分组的字段、字典、规则和映射细节。</div>
      </div>
      <template v-for="(event, index) in filtered" :key="event.id">
        <div v-if="dividerOf(event, index)" class="pga-divider">{{ dividerOf(event, index) }}</div>
        <AssistantEventCard
          :data-event-type="event.type"
          :event="event"
          :read-only="readOnly"
          :loading="loading"
          @action="emit('action', $event)"
        />
      </template>
    </div>

    <button v-if="newCount && !nearBottom" type="button" class="pga-new" @click="toBottom">
      有新消息 ↓ <em>{{ newCount > 9 ? "9+" : newCount }}</em>
    </button>

    <AssistantComposer
      :model-value="modelValue"
      :quick-actions="quickActions"
      :loading="loading"
      :read-only="readOnly"
      :placeholder="'输入调整意见，或提问「' + groupLabel + '」的字段、字典、映射细节…'"
      @update:model-value="emit('update:modelValue', $event)"
      @send="emit('send', $event)"
      @action="emit('action', $event)"
    />
  </aside>
</template>

<style scoped>
.pga { position: relative; flex: 0 0 auto; min-width: 320px; max-width: 560px; display: flex; flex-direction: column; min-height: 0; border: 1px solid #e2e8f0; border-radius: 14px; background: #fff; overflow: hidden; }
.pga-resize { position: absolute; left: -4px; top: 0; bottom: 0; width: 9px; cursor: col-resize; z-index: 4; background: transparent; transition: background .15s; }
.pga-resize:hover, .pga-resize.active { background: #cbe2d7; }
.pga-head { flex: 0 0 auto; display: flex; flex-direction: column; gap: 3px; padding: 7px 10px 6px; border-bottom: 1px solid #f1f5f9; background: #fbfcfe; }
.pga-head-main { display: flex; align-items: center; gap: 8px; }
.pga-head-main b { color: #14533e; font-size: 12.5px; }
.pga-head-main .spacer { flex: 1; }
.pga-close { width: 22px; height: 22px; border: 0; border-radius: 5px; background: transparent; color: #94a3b8; cursor: pointer; font-size: 16px; line-height: 1; }
.pga-close:hover { background: #f1f5f9; color: #0f172a; }
.pga-status { display: inline-flex; align-items: center; gap: 4px; padding: 0 6px; border-radius: 999px; background: #f1f5f9; color: #475569; font-size: 9.5px; line-height: 17px; white-space: nowrap; }
.pga-dot { width: 5px; height: 5px; border-radius: 50%; background: #94a3b8; }
.pga-status.ok { background: #ebf5f1; color: #14533e; }
.pga-status.ok .pga-dot { background: #19614a; }
.pga-status.busy { background: #eff6ff; color: #1d4ed8; }
.pga-status.busy .pga-dot { background: #1d4ed8; animation: pga-pulse 1s ease-in-out infinite; }
.pga-status.warn { background: #fffbeb; color: #92400e; }
.pga-status.warn .pga-dot { background: #d97706; }
.pga-status.error { background: #fff1f2; color: #be123c; }
.pga-status.error .pga-dot { background: #be123c; }
@keyframes pga-pulse { 0%, 100% { opacity: .35; } 50% { opacity: 1; } }
.pga-head-sub { display: flex; align-items: center; gap: 6px; min-width: 0; }
.pga-head-sub .spacer { flex: 1; }
.pga-group { min-width: 0; color: #94a3b8; font-size: 9.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pga-head-sub select { flex: 0 0 auto; height: 22px; max-width: 92px; border: 1px solid #e2e8f0; border-radius: 5px; background: #fff; color: #64748b; font-size: 9.5px; }
.pga-timeline { flex: 1; min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: 7px; padding: 9px 10px 12px; background: #fff; scroll-behavior: auto; }
.pga-empty { padding: 24px 8px; color: #94a3b8; font-size: 11px; line-height: 1.7; }
.pga-empty-title { margin-bottom: 4px; color: #475569; font-size: 12px; font-weight: 600; }
.pga-divider { margin: 4px 0 0; color: #94a3b8; font-size: 9px; font-weight: 600; letter-spacing: .04em; }
.pga-new { position: absolute; left: 50%; bottom: 132px; transform: translateX(-50%); z-index: 5; padding: 4px 10px; border: 1px solid #cbe2d7; border-radius: 999px; background: #fff; color: #14533e; font-size: 10px; box-shadow: 0 4px 12px rgba(15,23,42,.12); cursor: pointer; }
.pga-new em { font-style: normal; color: #19614a; font-weight: 650; }
@media (max-width: 1360px) {
  .pga { position: absolute; top: 0; right: 0; bottom: 0; width: min(420px, 100%) !important; max-width: none; border-radius: 0; box-shadow: -12px 0 28px rgba(15,23,42,.16); z-index: 20; }
  .pga-resize { display: none; }
}
@media (max-width: 720px) {
  .pga { left: 0; width: 100% !important; border-radius: 0; box-shadow: none; }
}
</style>
