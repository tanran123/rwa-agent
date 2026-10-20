<script setup>
import { computed } from "vue";
import { weightText } from "@/utils/waterfall";

const props = defineProps({
  node: { type: Object, required: true },
  depth: { type: Number, default: 0 },
  index: { type: Number, default: 0 },
  path: { type: String, default: "" },
  fallback: { type: Boolean, default: false },
  collapsed: { type: Object, default: () => ({}) },
  selected: { type: String, default: "" }
});

const emit = defineEmits(["select", "toggle"]);

const otherwise = computed(() => (
  props.node.otherwise && typeof props.node.otherwise === "object" ? props.node.otherwise : null
));
const hasKids = computed(() => (props.node.children && props.node.children.length) || otherwise.value);
const open = computed(() => !props.collapsed[props.path]);
const badge = computed(() => {
  const text = weightText(props.node);
  if (text) return text;
  if (props.node.children && props.node.children.length) return props.node.children.length + " 个子类";
  if (otherwise.value) return "兜底";
  return "权重未单列";
});
const kind = computed(() => {
  if (props.fallback || props.node.otherwise === true) return "fallback";
  if (hasKids.value) return "branch";
  return "leaf";
});

function choose() {
  emit("select", { node: props.node, path: props.path, depth: props.depth, index: props.index, fallback: props.fallback });
}
</script>

<template>
  <div class="tnode-wrap">
    <div class="tnode" :class="[kind, selected === path ? 'hit' : '']" title="点击查看规则详情与监管依据" @click="choose">
      <span v-if="hasKids" class="toggle-c" @click.stop="emit('toggle', path)">{{ open ? "▼" : "▶" }}</span>
      <span class="tidx">{{ fallback ? "否则" : "#" + depth + "." + (index + 1) }}</span>
      <span class="ticon" :style="{ color: fallback ? 'var(--warn)' : 'var(--ink-3)' }">{{ fallback ? "↳" : (hasKids ? "◆" : "○") }}</span>
      <div style="min-width: 0">
        <div class="tlabel">{{ node.label || node.name }}</div>
        <div class="tmeta">{{ node.name }}{{ fallback ? " · 本层都不命中时走这里" : "" }}</div>
      </div>
      <span class="tweight" :class="{ empty: badge === '权重未单列' }">{{ badge }}</span>
    </div>
    <div v-if="hasKids && open" class="tchildren">
      <TreeNode
        v-for="(child, i) in node.children || []"
        :key="child.name + i"
        :node="child"
        :depth="depth + 1"
        :index="i"
        :path="path + '/' + i + ':' + child.name"
        :collapsed="collapsed"
        :selected="selected"
        @select="emit('select', $event)"
        @toggle="emit('toggle', $event)"
      />
      <TreeNode
        v-if="otherwise"
        :node="otherwise"
        :depth="depth + 1"
        :index="-1"
        fallback
        :path="path + '>otherwise'"
        :collapsed="collapsed"
        :selected="selected"
        @select="emit('select', $event)"
        @toggle="emit('toggle', $event)"
      />
    </div>
  </div>
</template>
