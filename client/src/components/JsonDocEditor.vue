<script setup>
import { ref, watch } from "vue";
import { validateRuleBody } from "@/api/config";

const props = defineProps({
  body: { type: Object, required: true },
  kind: { type: String, default: "" },
  jurisdiction: { type: String, default: "" },
  saving: { type: Boolean, default: false },
  readOnly: { type: Boolean, default: false }
});
const emit = defineEmits(["update:body", "save", "notify"]);

const text = ref(JSON.stringify(props.body, null, 2));
const parseError = ref("");
const errors = ref(null);
const busy = ref(false);

watch(
  () => props.body,
  (value) => { text.value = JSON.stringify(value, null, 2); parseError.value = ""; },
  { deep: true }
);

function parsed() {
  try {
    const value = JSON.parse(text.value);
    parseError.value = "";
    return value;
  } catch (err) {
    parseError.value = "JSON 解析失败：" + err.message;
    return null;
  }
}

function apply() {
  const value = parsed();
  if (!value) return;
  emit("update:body", value);
  emit("notify", "JSON 已应用到当前编辑，保存后才会写入数据库。");
}

async function validate() {
  const value = parsed();
  if (!value) return;
  busy.value = true;
  try {
    const result = await validateRuleBody({ kind: props.kind, body: value, jurisdiction: props.jurisdiction });
    errors.value = result.errors || [];
    emit("notify", result.ok ? "校验通过" : "校验发现 " + errors.value.length + " 处问题");
  } catch (err) {
    errors.value = [err.message];
  } finally {
    busy.value = false;
  }
}

async function save() {
  const value = parsed();
  if (!value) return;
  emit("update:body", value);
  emit("save", value);
}
</script>

<template>
  <div class="panel">
    <div class="panel-head">
      <h3>JSON 原文</h3>
      <span class="sub">整份文档按 V3.5 Schema 编辑</span>
      <span class="spacer"></span>
      <button type="button" class="btn sm" :disabled="readOnly" @click="apply">解析并应用</button>
      <button type="button" class="btn sm" :disabled="busy" @click="validate">校验</button>
      <button type="button" class="btn sm primary" :disabled="saving || readOnly" @click="save">保存</button>
    </div>
    <div class="panel-body">
      <p v-if="parseError" class="notice danger">{{ parseError }}</p>
      <textarea
        v-model="text"
        :readonly="readOnly"
        spellcheck="false"
        style="width: 100%; min-height: 460px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; line-height: 1.5"
      ></textarea>
      <div v-if="errors && errors.length" class="notice danger" style="margin-top: 10px">
        <strong>{{ errors.length }} 处问题</strong>
        <div v-for="(item, index) in errors" :key="index" class="mono" style="font-size: 12px; margin-top: 4px">{{ item }}</div>
      </div>
      <p v-else-if="errors" class="notice ok" style="margin-top: 10px">校验通过，没有发现问题。</p>
    </div>
  </div>
</template>
