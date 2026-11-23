<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

const props = defineProps({
  modelValue: { type: String, default: "" },
  fields: { type: Array, default: () => [] },
  placeholder: { type: String, default: "选择字段" },
  disabled: { type: Boolean, default: false },
  allowEmpty: { type: Boolean, default: false }
});
const emit = defineEmits(["update:modelValue"]);

const open = ref(false);
const query = ref("");
const active = ref(0);
const root = ref(null);
const input = ref(null);

const selected = computed(() => props.fields.find((field) => field.name === props.modelValue) || null);
const display = computed(() => (selected.value ? selected.value.name + " · " + (selected.value.label || selected.value.name) : ""));

const filtered = computed(() => {
  const text = query.value.trim().toLowerCase();
  if (!text) return props.fields;
  return props.fields.filter((field) => {
    const hay = [field.name, field.label, field.groupLabel, field.description].join(" ").toLowerCase();
    return hay.includes(text);
  });
});

const groups = computed(() => {
  const map = new Map();
  filtered.value.forEach((field) => {
    const key = field.group || field.groupLabel || "UNGROUPED";
    if (!map.has(key)) map.set(key, { key: key, label: field.groupLabel || key, fields: [] });
    map.get(key).fields.push(field);
  });
  return Array.from(map.values());
});

const flat = computed(() => groups.value.reduce((list, group) => list.concat(group.fields), []));

watch(filtered, () => {
  if (active.value >= flat.value.length) active.value = 0;
});

function show() {
  if (props.disabled) return;
  open.value = true;
  query.value = "";
  active.value = 0;
  nextTick(() => input.value && input.value.focus());
}

function close() {
  open.value = false;
  query.value = "";
}

function choose(field) {
  if (!field) return;
  emit("update:modelValue", field.name);
  close();
}

function clear() {
  emit("update:modelValue", "");
  close();
}

function onFocus() {
  if (!open.value) show();
}

function onInput(event) {
  query.value = event.target.value;
  open.value = true;
  active.value = 0;
}

function onKeydown(event) {
  event.stopPropagation();
  if (!open.value && (event.key === "ArrowDown" || event.key === "Enter")) {
    show();
    event.preventDefault();
    return;
  }
  if (event.key === "Escape") {
    close();
    event.preventDefault();
    return;
  }
  if (event.key === "ArrowDown") {
    active.value = Math.min(active.value + 1, flat.value.length - 1);
    event.preventDefault();
  } else if (event.key === "ArrowUp") {
    active.value = Math.max(active.value - 1, 0);
    event.preventDefault();
  } else if (event.key === "Enter") {
    choose(flat.value[active.value]);
    event.preventDefault();
  }
}

function onDocPointer(event) {
  if (root.value && !root.value.contains(event.target)) close();
}

onMounted(() => document.addEventListener("pointerdown", onDocPointer));
onBeforeUnmount(() => document.removeEventListener("pointerdown", onDocPointer));
</script>

<template>
  <div ref="root" class="field-picker" :class="{ disabled: disabled }">
    <input
      ref="input"
      class="field-picker-input"
      type="text"
      autocomplete="off"
      :disabled="disabled"
      :placeholder="placeholder"
      :value="open ? query : display"
      :title="display"
      @focus="onFocus"
      @input="onInput"
      @keydown="onKeydown"
    />
    <button v-if="allowEmpty && modelValue" type="button" class="field-picker-clear" title="清空" @click.stop="clear">×</button>
    <div v-if="open" class="field-picker-menu">
      <p v-if="!flat.length" class="field-picker-empty">没有匹配的字段</p>
      <div v-for="group in groups" :key="group.key" class="field-picker-group">
        <div class="field-picker-group-head">{{ group.label }}（{{ group.fields.length }}）</div>
        <button
          v-for="field in group.fields"
          :key="field.name"
          type="button"
          class="field-picker-item"
          :class="{ active: flat.indexOf(field) === active, chosen: field.name === modelValue }"
          @click="choose(field)"
          @mouseenter="active = flat.indexOf(field)"
        >
          <span class="mono">{{ field.name }}</span>
          <span class="field-picker-label">{{ field.label }}</span>
          <span class="field-picker-type">{{ field.type }}</span>
          <span v-if="field.inputMode === 'default'" class="field-picker-tag">默认 {{ field.defaultValue || "" }}</span>
          <span v-else-if="field.mapped" class="field-picker-tag">已用</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.field-picker { position: relative; min-width: 0; }
.field-picker-input {
  width: 100%;
  box-sizing: border-box;
  padding: 5px 8px;
  border: 1px solid var(--border, #d8dee9);
  border-radius: 7px;
  background: #fff;
  font: inherit;
  font-size: 11.5px;
  color: inherit;
}
.field-picker-input:focus { outline: none; border-color: #0f766e; box-shadow: 0 0 0 2px rgba(15, 118, 110, .12); }
.field-picker.disabled .field-picker-input { background: #f1f5f9; color: #94a3b8; }
.field-picker-clear {
  position: absolute;
  right: 4px;
  top: 50%;
  transform: translateY(-50%);
  border: 0;
  background: transparent;
  color: #94a3b8;
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
}
.field-picker-menu {
  position: absolute;
  z-index: 40;
  left: 0;
  right: 0;
  top: calc(100% + 4px);
  max-height: 300px;
  overflow: auto;
  border: 1px solid #d8dee9;
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 12px 30px rgba(15, 23, 42, .16);
  padding: 4px 0;
}
.field-picker-empty { margin: 0; padding: 8px 10px; font-size: 11px; color: #94a3b8; }
.field-picker-group-head {
  position: sticky;
  top: 0;
  padding: 4px 9px;
  background: #f8fafc;
  font-size: 10px;
  font-weight: 700;
  color: #64748b;
  border-bottom: 1px solid #eef2f7;
}
.field-picker-item {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 5px 9px;
  border: 0;
  background: transparent;
  text-align: left;
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}
.field-picker-item:hover, .field-picker-item.active { background: #f0faf6; }
.field-picker-item.chosen { color: #0f766e; font-weight: 650; }
.field-picker-item .mono { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.field-picker-label { color: #64748b; font-size: 10.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.field-picker-type { margin-left: auto; color: #94a3b8; font-size: 9.5px; }
.field-picker-tag { padding: 0 4px; border-radius: 4px; background: #e0f2fe; color: #0369a1; font-size: 9px; }
</style>
