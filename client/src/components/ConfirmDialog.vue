<script setup>
import { nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { confirmState, settleConfirm } from "@/utils/confirm";

const box = ref(null);

function onKey(event) {
  if (!confirmState.open) return;
  if (event.key === "Escape") {
    event.preventDefault();
    settleConfirm(false);
  }
}

onMounted(() => window.addEventListener("keydown", onKey));
onUnmounted(() => window.removeEventListener("keydown", onKey));

watch(() => confirmState.open, (open) => {
  if (!open) return;
  nextTick(() => {
    if (box.value) box.value.focus();
  });
});
</script>

<template>
  <Teleport to="body">
    <div v-if="confirmState.open" class="modal-backdrop front" @click.self="settleConfirm(false)">
      <div ref="box" class="modal-dialog confirm" role="dialog" aria-modal="true" tabindex="-1">
        <div class="modal-head">
          <div>
            <h3>{{ confirmState.title }}</h3>
            <p v-if="confirmState.detail">{{ confirmState.detail }}</p>
          </div>
          <button type="button" class="modal-close" aria-label="关闭" @click="settleConfirm(false)">×</button>
        </div>
        <div class="modal-body">
          <p class="lead">{{ confirmState.message }}</p>
        </div>
        <div class="modal-foot">
          <button type="button" class="btn" @click="settleConfirm(false)">{{ confirmState.cancelText }}</button>
          <button type="button" class="btn" :class="confirmState.danger ? 'danger' : 'btn-primary'" @click="settleConfirm(true)">{{ confirmState.confirmText }}</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
