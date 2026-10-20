<script setup>
import { fetchExposureClass } from "@/api/exposure";
import AsyncView from "@/components/AsyncView.vue";
import Waterfall from "@/components/Waterfall.vue";
</script>

<template>
  <AsyncView :load="fetchExposureClass">
    <template #default="{ data }">
      <Waterfall :document="data.document" :source="String(data.sourceFile || '').split('/').pop()" />
    </template>
  </AsyncView>
</template>
