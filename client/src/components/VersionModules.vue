<script setup>
import { CAPITAL_LINKS, LIQUIDITY_LINKS } from "@/utils/ruleLinks";

defineProps({
  disabled: { type: Boolean, default: false },
  exposureCount: { type: Number, default: 1 }
});

defineEmits(["open"]);
</script>

<template>
  <div class="grid c2">
    <div class="panel">
      <div class="panel-head">
        <h3>资本充足率</h3>
        <span class="sub">配置参数</span>
      </div>
      <div class="panel-body">
        <div style="display: grid; gap: 8px">
          <button
            v-for="(link, index) in CAPITAL_LINKS"
            :key="link.path"
            type="button"
            class="arch-item"
            :disabled="disabled"
            @click="$emit('open', link.path)"
          >
            <span class="idx">{{ index + 1 }}</span>
            <span>
              <strong>{{ link.label }}</strong>
              <span>{{ link.desc }}</span>
            </span>
            <span class="go">配置 →</span>
          </button>
        </div>
        <p v-if="disabled" class="notice" style="margin: 12px 0 0">
          保存版本后即可进入这些配置。
        </p>
        <p v-else-if="!exposureCount" class="notice warn" style="margin: 12px 0 0">
          这一版还没有风险暴露分类规则，点上面的「暴露分类规则」会先复制一份再进入。
        </p>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head">
        <h3>流动性</h3>
        <span class="sub">配置与计算</span>
      </div>
      <div class="panel-body">
        <div style="display: grid; gap: 8px">
          <button
            v-for="(link, index) in LIQUIDITY_LINKS"
            :key="link.path"
            type="button"
            class="arch-item"
            :disabled="disabled"
            @click="$emit('open', link.path)"
          >
            <span class="idx">{{ index + 1 }}</span>
            <span>
              <strong>{{ link.label }}</strong>
              <span>{{ link.desc }}</span>
            </span>
            <span class="go">进入 →</span>
          </button>
        </div>
        <p v-if="disabled" class="notice" style="margin: 12px 0 0">
          保存版本后即可进入这些配置。
        </p>
        <p v-else class="notice" style="margin: 12px 0 0">
          流动性产品、标准字段、参数表和监管名单都在「流动性产品管理」里按这一版维护；
          HQLA 计算任务按七个步骤完成导入、识别、映射、检查、计算和复核。
        </p>
      </div>
    </div>
  </div>
</template>
