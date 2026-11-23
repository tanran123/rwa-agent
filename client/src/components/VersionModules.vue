<script setup>
import { computed } from "vue";
import { CAPITAL_LINKS, LIQUIDITY_LINKS } from "@/utils/ruleLinks";

const props = defineProps({
  disabled: { type: Boolean, default: false },
  exposureCount: { type: Number, default: 1 },
  modules: { type: Array, default: () => [] },
  published: { type: Boolean, default: false }
});

defineEmits(["open"]);

const PATH = {
  documents: "/exposure-config",
  products: "/product-config",
  ead: "/ead",
  crm: "/crm-config",
  clauses: "/clauses",
  liquidity: "/liquidity-config"
};

const TONE = { ok: "green", warning: "amber", error: "red" };
const LABEL = { ok: "已配置", warning: "待完善", error: "有阻断" };

const capital = computed(() => {
  if (!props.modules.length) return CAPITAL_LINKS;
  return props.modules
    .filter((item) => item.key !== "liquidity")
    .map((item) => ({
      key: item.key,
      label: item.label,
      path: PATH[item.key] || "/exposure-config",
      desc: item.status === "ok" ? "已配置" : (item.errors[0] || item.warnings[0] || "待完善"),
      module: item
    }));
});

const liquidity = computed(() => {
  // CAR 版本也要保留流动性入口；只有 LCR 版本才用 overview 返回的流动性模块状态。
  if (!props.modules.length || !props.modules.some((item) => item.key === "liquidity")) return LIQUIDITY_LINKS;
  return props.modules
    .filter((item) => item.key === "liquidity")
    .map((item) => ({
      key: item.key,
      label: item.label,
      path: PATH[item.key] || "/liquidity-config",
      desc: item.status === "ok" ? "已配置" : (item.errors[0] || item.warnings[0] || "待完善"),
      module: item
    }));
});
</script>

<template>
  <div class="grid c2">
    <div class="panel">
      <div class="panel-head">
        <h3>资本充足率</h3>
        <span class="sub">配置参数</span>
        <span v-if="published" class="tag muted">已发布只读</span>
      </div>
      <div class="panel-body">
        <div style="display: grid; gap: 8px">
          <button
            v-for="(link, index) in capital"
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
              <span v-if="link.module" class="sub" style="display: block; margin-top: 4px">
                对象 {{ link.module.count }} · 阻断 {{ link.module.errors.length }} · 提示 {{ link.module.warnings.length }}
              </span>
            </span>
            <span class="go">
              <span v-if="link.module" class="tag" :class="TONE[link.module.status]">{{ LABEL[link.module.status] }}</span>
              配置 →
            </span>
          </button>
        </div>
        <p v-if="disabled" class="notice" style="margin: 12px 0 0">
          保存版本后即可进入这些配置。
        </p>
        <p v-else-if="!exposureCount && !modules.length" class="notice warn" style="margin: 12px 0 0">
          这一版还没有风险暴露分类规则，点上面的「暴露分类规则」会先复制一份再进入。
        </p>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head">
        <h3>流动性</h3>
        <span class="sub">配置</span>
        <span v-if="published" class="tag muted">已发布只读</span>
      </div>
      <div class="panel-body">
        <div style="display: grid; gap: 8px">
          <button
            v-for="(link, index) in liquidity"
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
              <span v-if="link.module" class="sub" style="display: block; margin-top: 4px">
                对象 {{ link.module.count }} · 阻断 {{ link.module.errors.length }} · 提示 {{ link.module.warnings.length }}
              </span>
            </span>
            <span class="go">
              <span v-if="link.module" class="tag" :class="TONE[link.module.status]">{{ LABEL[link.module.status] }}</span>
              配置 →
            </span>
          </button>
        </div>
        <p v-if="disabled" class="notice" style="margin: 12px 0 0">
          保存版本后即可进入这些配置。
        </p>
        <p v-else-if="!modules.length" class="notice" style="margin: 12px 0 0">
          流动性产品、标准字段、参数表和监管名单都在「流动性产品管理」里按这一版维护。
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.arch-item {
  background: #fff;
  border-color: #dbe5f0;
}
.arch-item:hover {
  border-color: #8fb9a9;
  background: #f7fbf9;
}
.arch-item .idx {
  background: #eef7f3;
  color: #0f766e;
}
.arch-item strong {
  color: #1e293b;
}
.arch-item .go {
  color: var(--accent);
  font-weight: 650;
}
.arch-item:hover .go {
  color: #0b5c3b;
}
.arch-item .tag.green {
  background: #dcfce7;
  color: #047857;
}
.arch-item .tag.amber {
  background: #fef3c7;
  color: #92400e;
}
.arch-item .tag.red {
  background: #fee2e2;
  color: #b91c1c;
}
</style>

