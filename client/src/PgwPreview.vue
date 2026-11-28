<script setup>
import { ref } from "vue";
import ProductGroupWizard from "@/components/ProductGroupWizard.vue";
const open = ref(true);
</script>
<template>
  <ProductGroupWizard :open="open" family="一般公司贷款" version="v3.3" :entry-index="0" :exposure-classes="['corporate']" :get-draft="() => ({ standardFields: [], mappings: [], dirty: false })" @close="open = false" />
</template>
