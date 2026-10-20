<script setup>
import { ref } from "vue";
import { fetchEadRules } from "@/api/ead";
import { fetchProducts } from "@/api/product";
import AsyncView from "@/components/AsyncView.vue";

const props = defineProps({ side: { type: String, default: "on" } });
const code = ref("");
const load = () => Promise.all([
  fetchEadRules(props.side),
  fetchProducts()
]);
</script>

<template>
  <AsyncView :load="load">
    <template #default="{ data }">
      <div class="section-tabs" style="margin-bottom: 12px">
        <button type="button" class="section-tab" :class="{ active: !code }" @click="code = ''">全部产品</button>
        <button
          v-for="item in data[1]"
          :key="item.code"
          type="button"
          class="section-tab"
          :class="{ active: code === item.code }"
          @click="code = item.code"
        >{{ item.label }}</button>
      </div>
      <div v-for="rule in data[0].filter((item) => !code || (item.productCodes || []).includes(code))" :key="rule.id" class="panel" style="margin-bottom: 12px">
        <div class="panel-head">
          <h3>{{ rule.name }}</h3>
          <span class="tag" :class="rule.status === 'published' ? 'ok' : 'muted'">{{ rule.status }}</span>
        </div>
        <div class="panel-body">
          <p><strong>{{ rule.formula }}</strong></p>
          <p class="dim">{{ rule.condition }}</p>
          <p v-if="rule.ccf != null">信用转换系数 {{ rule.ccf }}</p>
          <ol>
            <li v-for="(step, index) in rule.steps || []" :key="index">{{ step }}</li>
          </ol>
        </div>
      </div>
      <p v-if="!data[0].filter((item) => !code || (item.productCodes || []).includes(code)).length" class="notice warn">这个产品没有{{ side === 'on' ? '表内' : '表外' }}规则。</p>
    </template>
  </AsyncView>
</template>
