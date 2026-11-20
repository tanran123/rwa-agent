<script setup>
import { computed, watch } from "vue";
import { useContext } from "@/composables/useContext";

const props = defineProps({
  form: { type: Object, required: true },
  error: { type: String, default: "" },
  saving: { type: Boolean, default: false },
  creating: { type: Boolean, default: false }
});

defineEmits(["save", "cancel"]);

const { session } = useContext();
const HK = "HK";
const jurisdictionLabels = (code) => (session.jurisdictions.find((item) => item.code === code) || {}).label || code;
const jurisdictionOptions = computed(() => session.jurisdictions || []);
const orgOptions = computed(() => (session.orgs || []).filter((item) => item.jurisdiction === props.form.jurisdiction));

watch(() => session.ready, () => {
  if (!props.form.jurisdiction) {
    props.form.jurisdiction = session.jurisdiction || HK;
  }
}, { immediate: true });

watch(() => props.form.jurisdiction, () => {
  if (!props.form.institution || !orgOptions.value.some((item) => item.name === props.form.institution)) {
    props.form.institution = orgOptions.value[0] ? orgOptions.value[0].name : "";
  }
});
</script>

<template>
  <div class="panel">
    <div class="panel-head">
      <h3>{{ creating ? "新建监管规则版本" : "编辑版本信息" }}</h3>
      <span class="sub">{{ creating ? "录入地区和规则名称后保存，直接进入监管规则维护工作台" : "修改版本核心信息，保存后仍回到维护工作台" }}</span>
      <span class="spacer"></span>
      <button type="button" class="btn sm" @click="$emit('cancel')">取消</button>
    </div>
    <div class="panel-body">
      <p v-if="error" class="notice danger">{{ error }}</p>
      <div class="grid c2">
        <label class="field">地区
          <select v-model="form.jurisdiction">
            <option v-for="item in jurisdictionOptions" :key="item.code" :value="item.code">{{ item.label }}</option>
          </select>
        </label>
        <label class="field">规则名称
          <input v-model="form.name" type="text" placeholder="如：香港银行业（资本）规则" />
        </label>
        <label class="field">生效日期
          <input v-model="form.effectiveFrom" type="date" />
        </label>
        <label class="field">失效日期
          <input v-model="form.effectiveTo" type="date" />
        </label>
        <label class="field">适用机构
          <select v-model="form.institution">
            <option value="">未指定</option>
            <option v-for="item in orgOptions" :key="item.id" :value="item.name">
              {{ item.name }}（{{ jurisdictionLabels(item.jurisdiction) }}）
            </option>
          </select>
        </label>
      </div>
      <div style="margin-top: 12px; display: flex; gap: 8px">
        <button v-if="creating" type="button" class="btn primary" :disabled="saving" @click="$emit('save', 'draft')">
          {{ saving ? "正在保存" : "保存并进入工作台" }}
        </button>
        <button v-else type="button" class="btn primary" :disabled="saving" @click="$emit('save')">
          {{ saving ? "正在保存" : "保存版本信息" }}
        </button>
      </div>
    </div>
  </div>
</template>
