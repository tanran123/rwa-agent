<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { isTopDrawer, nextDrawerId, setDrawerOpen } from "@/utils/drawerStack";

const props = defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, default: "" },
  wide: { type: Boolean, default: false },
  full: { type: Boolean, default: false },
  flush: { type: Boolean, default: false },
  headless: { type: Boolean, default: false },
  to: { type: [String, Object], default: "body" }
});
const emit = defineEmits(["close"]);
const shown = ref(false);
const drawerId = nextDrawerId();

watch(() => props.open, async (value) => {
  setDrawerOpen(drawerId, value);
  shown.value = false;
  if (!value) return;
  await nextTick();
  requestAnimationFrame(() => { shown.value = true; });
}, { immediate: true });

function onKeydown(event) {
  if (event.key !== "Escape") return;
  if (!props.open || !isTopDrawer(drawerId)) return;
  event.preventDefault();
  event.stopPropagation();
  emit("close");
}

onMounted(() => document.addEventListener("keydown", onKeydown));
onBeforeUnmount(() => {
  document.removeEventListener("keydown", onKeydown);
  setDrawerOpen(drawerId, false);
});
</script>

<template>
  <Teleport :to="to">
    <div v-if="open" class="drawer-mask" :class="{ open: shown }" @click="emit('close')"></div>
    <aside v-if="open" class="drawer" :class="{ wide, full, flush, open: shown }" role="dialog" aria-modal="true">
      <div v-if="!headless" class="drawer-head">
        <h3>{{ title }}</h3>
        <div class="spacer"></div>
        <button type="button" class="modal-close" aria-label="关闭" @click="emit('close')">×</button>
      </div>
      <div class="drawer-body">
        <slot />
      </div>
      <div v-if="$slots.footer" class="drawer-foot">
        <slot name="footer" />
      </div>
    </aside>
  </Teleport>
</template>
