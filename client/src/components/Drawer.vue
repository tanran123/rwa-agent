<script setup>
import { nextTick, ref, watch } from "vue";

const props = defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, default: "" },
  wide: { type: Boolean, default: false }
});
const emit = defineEmits(["close"]);
const shown = ref(false);

watch(() => props.open, async (value) => {
  shown.value = false;
  if (!value) return;
  await nextTick();
  requestAnimationFrame(() => { shown.value = true; });
}, { immediate: true });
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="drawer-mask" :class="{ open: shown }" @click="emit('close')"></div>
    <aside v-if="open" class="drawer" :class="{ wide, open: shown }" role="dialog" aria-modal="true">
      <div class="drawer-head">
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
