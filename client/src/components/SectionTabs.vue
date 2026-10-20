<script setup>
import { useRoute, useRouter } from "vue-router";

const route = useRoute();
const router = useRouter();
</script>

<template>
  <div v-if="route.meta.sections" class="section-tabs" role="tablist">
    <button
      v-for="tab in route.meta.sections"
      :key="tab.path"
      type="button"
      class="section-tab"
      :class="{ active: route.path === tab.path }"
      @click="router.push(tab.path)"
    >{{ tab.label }}</button>
  </div>
</template>
