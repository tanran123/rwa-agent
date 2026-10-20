<script setup>
import { onMounted, ref } from "vue";

const props = defineProps({
  load: { type: Function, required: true }
});
const data = ref(null);
const error = ref("");
const loading = ref(true);

async function run() {
  loading.value = true;
  error.value = "";
  try {
    data.value = await props.load();
  } catch (err) {
    error.value = err.message || "加载失败";
    data.value = null;
  } finally {
    loading.value = false;
  }
}

onMounted(run);
defineExpose({ reload: run, data });
</script>

<template>
  <div v-if="loading" class="loading"><span class="spin"></span>正在从接口读取</div>
  <div v-else-if="error" class="notice danger">{{ error }}</div>
  <slot v-else :data="data" :reload="run" />
</template>
