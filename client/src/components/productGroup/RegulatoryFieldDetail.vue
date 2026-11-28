<script setup>
import { computed } from "vue";
import {
  fieldProfile,
  fieldTypeLabel,
  mappingCodeRows,
  mappingTransformLabel,
  missingPolicyLabel,
  optionText
} from "./helpers";

const props = defineProps({
  field: { type: Object, required: true }
});

const profile = computed(() => fieldProfile(props.field));
const rules = computed(() => props.field.usedBy || profile.value.rules || []);
const dictionary = computed(() => profile.value.dictionary || null);
const dictionaryItems = computed(() => (dictionary.value && dictionary.value.items) || []);
</script>

<template>
  <div class="pgw-profile">
    <div class="pgw-profile-block">
      <h6>定义</h6>
      <p>{{ profile.definition || "规则文档没有提供定义。" }}</p>
      <p v-if="profile.note" class="dim">{{ profile.note }}</p>
    </div>

    <div class="pgw-profile-block">
      <h6>类型与取值</h6>
      <p>
        {{ fieldTypeLabel(profile.type) }} · 来源
        {{ profile.source === "calc" ? "系统计算" : profile.source === "external" ? "外部输入" : profile.source === "prepared" ? "平台预处理" : "数据字段" }}
      </p>
      <div v-if="(profile.options || []).length" class="pgw-option-list">
        <span v-for="option in profile.options" :key="option.code" class="pgw-option">{{ optionText(option) }}</span>
      </div>
      <div v-if="dictionary" class="pgw-dict-ref">
        字典 {{ dictionary.dict_name }}（{{ dictionary.dict_code }}）
        <div class="pgw-option-list">
          <span v-for="item in dictionaryItems.slice(0, 24)" :key="item.item_code || item.code" class="pgw-option">
            {{ item.item_code || item.code }} · {{ item.item_name || item.label }}
          </span>
        </div>
      </div>
      <p v-else-if="!(profile.options || []).length && !profile.systemCalc" class="dim">
        规则文档没有给出可选码值，生成时需要人工确认。
      </p>
    </div>

    <div v-if="profile.systemCalc" class="pgw-profile-block">
      <h6>系统计算</h6>
      <p>{{ profile.derivation ? profile.derivation.summary : "由计算引擎派生，不需要人工字段。" }}</p>
      <div v-if="profile.derivation && profile.derivation.inputs && profile.derivation.inputs.length" class="dim">
        派生输入：{{ profile.derivation.inputs.join("、") }}
      </div>
      <div v-if="profile.derivation && profile.derivation.expression" class="mono dim">
        {{ profile.derivation.expression }}
      </div>
      <div v-if="(profile.parameterRefs || []).length" class="dim">
        参数引用：{{ profile.parameterRefs.join("、") }}
      </div>
    </div>

    <div class="pgw-profile-block">
      <h6>为什么需要</h6>
      <div v-for="use in rules" :key="'why-' + use.kind + use.ruleId + use.path + use.whenText" class="pgw-why">
        <div><b>{{ use.kind === "weight" ? "权重规则" : "分类规则" }} {{ use.ruleId }}</b> <span class="dim">{{ use.ruleLabel }}</span></div>
        <div v-if="use.path" class="mono dim">{{ use.path }}</div>
        <div v-if="use.whenText">条件：{{ use.whenText }}</div>
        <div>{{ use.note || "引用该字段进行规则判断。" }}</div>
        <div v-if="use.article" class="mono dim">监管依据 {{ use.article }}</div>
      </div>
      <p v-if="!rules.length" class="dim">没有在规则节点中直接引用；可能是映射文档补充的目标字段。</p>
    </div>

    <div class="pgw-profile-block">
      <h6>当前映射</h6>
      <p>{{ profile.mapped ? "已映射" : "未映射" }}</p>
      <p v-if="profile.standardField" class="dim">
        标准字段 {{ profile.standardField.name }} ·
        {{ profile.standardField.inputMode === "default" ? "默认值" : "人工输入" }}
      </p>
      <template v-if="profile.mapping && profile.mapping.transform">
        <p class="dim">方式：{{ mappingTransformLabel(profile.mapping) }}</p>
        <p v-if="profile.mapping.transform.expression" class="mono dim">{{ profile.mapping.transform.expression }}</p>
        <div v-if="mappingCodeRows(profile.mapping).length" class="pgw-code-map">
          <div v-for="row in mappingCodeRows(profile.mapping)" :key="row.source" class="pgw-code-map-row">
            <span class="mono">{{ row.source }}</span>
            <span class="mono">{{ row.target }}</span>
          </div>
        </div>
      </template>
      <p class="dim">必填策略：{{ missingPolicyLabel(profile.missingPolicy) }}</p>
    </div>
  </div>
</template>
