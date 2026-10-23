<script setup>
import Drawer from "@/components/Drawer.vue";

defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, default: "" },
  error: { type: String, default: "" },
  saving: { type: Boolean, default: false },
  creating: { type: Boolean, default: false }
});
defineEmits(["close", "save", "remove"]);
</script>

<template>
  <Drawer :open="open" :title="title" wide @close="$emit('close')">
    <p v-if="error" class="notice danger">{{ error }}</p>
    <div v-if="open" class="reg-form-grid">
      <slot />
    </div>
    <template #footer>
      <button v-if="open && !creating" type="button" class="btn danger" :disabled="saving" @click="$emit('remove')">删除</button>
      <span class="spacer"></span>
      <button type="button" class="btn" :disabled="saving" @click="$emit('close')">取消</button>
      <button type="button" class="btn primary" :disabled="saving" @click="$emit('save')">{{ saving ? "正在保存" : "保存" }}</button>
    </template>
  </Drawer>
</template>
