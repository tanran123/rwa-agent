<script setup>
import { conditionSentence, whenIntro, whenKey } from "@/utils/ruleText";

defineProps({
  when: { type: Object, required: true },
  book: { type: Object, required: true }
});
</script>

<template>
  <div class="cond-list">
    <div v-if="whenIntro(when)" class="cond-group-label">{{ whenIntro(when) }}</div>
    <template v-if="whenKey(when) === 'field'">
      <div class="cond">
        <span class="ci">·</span>
        <div>{{ conditionSentence(when, book) }}</div>
      </div>
    </template>
    <template v-else>
      <template v-for="(item, index) in when[whenKey(when)] || []" :key="index">
        <WhenList v-if="item.all || item.any" :when="item" :book="book" />
        <div v-else class="cond">
          <span class="ci">·</span>
          <div>{{ conditionSentence(item, book) }}</div>
        </div>
      </template>
    </template>
  </div>
</template>
