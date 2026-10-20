<script setup>
import { codeText, OP_LABELS, whenKey } from "@/utils/ruleText";

defineProps({
  when: { type: Object, required: true },
  book: { type: Object, required: true },
  nested: { type: Boolean, default: false }
});
</script>

<template>
  <div class="cond-list">
    <div v-if="whenKey(when) === 'any'" class="cond-group-label">any — 以下成立一条即可</div>
    <template v-if="whenKey(when) === 'field'">
      <div class="cond">
        <span class="ci">·</span>
        <div>
          <span class="cf">{{ book.labels[when.field] || when.field }}</span>
          <span class="co"> {{ OP_LABELS[when.op] || when.op || "等于" }} </span>
          <span class="cv">{{ Array.isArray(when.match) ? when.match.map((item) => codeText(item, book.codes)).join(" 或 ") : codeText(when.match, book.codes) }}</span>
        </div>
      </div>
    </template>
    <template v-else>
      <template v-for="(item, index) in when[whenKey(when)] || []" :key="index">
        <template v-if="item.all || item.any">
          <div class="cond-group-label">{{ item.all ? "all 嵌套组" : "any 嵌套组" }}</div>
          <WhenList :when="item" :book="book" nested />
        </template>
        <div v-else class="cond">
          <span class="ci">·</span>
          <div>
            <span class="cf">{{ book.labels[item.field] || item.field }}</span>
            <span class="co"> {{ OP_LABELS[item.op] || item.op || "等于" }} </span>
            <span class="cv">{{ Array.isArray(item.match) ? item.match.map((code) => codeText(code, book.codes)).join(" 或 ") : codeText(item.match, book.codes) }}</span>
          </div>
        </div>
      </template>
    </template>
  </div>
</template>
