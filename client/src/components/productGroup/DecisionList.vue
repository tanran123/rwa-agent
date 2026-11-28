<script setup>
import { computed, ref } from "vue";
import { DECISION_CLASSES, DECISION_LABELS } from "./constants";
import {
  buildDictionaryIndex,
  decisionDictionaryText,
  decisionMappingText,
  decisionStandardText,
  dictionaryItems,
  dictionaryTitle,
  fieldTypeLabel,
  mappingCodeRows,
  mappingInputs,
  mappingTransformLabel,
  mappingTransformSummary,
  rulesOfTarget,
  servedTargets
} from "./helpers";

const props = defineProps({
  tab: { type: String, default: "overview" },
  proposal: { type: Object, required: true },
  selection: { type: Object, default: () => ({ decisions: [], fields: [], mappings: [], dictionaries: [] }) },
  confirmations: { type: Array, default: () => [] },
  findings: { type: Array, default: () => [] },
  activeTarget: { type: String, default: "" },
  briefFields: { type: Array, default: () => [] },
  readOnly: { type: Boolean, default: false }
});
const emit = defineEmits(["toggle-selection", "locate-target", "generate"]);

const expandedDecision = ref("");
const expandedField = ref("");
const expandedMapping = ref("");

const decisions = computed(() => props.proposal.decisions || []);
const dictionaries = computed(() => props.proposal.newDictionaries || []);
const fieldNotes = computed(() => props.proposal.fieldNotes || []);
const missing = computed(() => props.proposal.missing || []);
const dictionaryIndex = computed(() => buildDictionaryIndex(props.briefFields, props.proposal));

const standardFields = computed(() => {
  const seen = new Set();
  return decisions.value
    .filter((item) => item.standardField && !seen.has(item.standardField.name) && seen.add(item.standardField.name))
    .map((item) => ({
      ...item.standardField,
      dictionary: item.dictionary ? item.dictionary.dict_code : (item.standardField.dictionary || ""),
      defaultValue: item.mapping && item.mapping.mappingType === "constant" ? item.mapping.defaultValue : (item.standardField.defaultValue || ""),
      newField: item.decisionType === "create",
      confidence: item.confidence,
      reason: item.reason,
      decision: item
    }));
});

const mappingRows = computed(() => decisions.value
  .filter((item) => item.mapping)
  .map((item) => {
    const field = props.briefFields.find((entry) => entry.name === item.targetField);
    return {
      ...item.mapping,
      targetField: item.targetField,
      targetLabel: item.targetLabel || item.targetField,
      targetType: field ? field.type : "",
      targetRequired: field ? field.required : false,
      confidence: item.confidence,
      reason: item.reason,
      decision: item
    };
  }));

const confirmationSet = computed(() => new Set(props.confirmations || []));

function isSelected(kind, value) {
  return (props.selection[kind] || []).includes(value);
}

function toggle(kind, value) {
  if (props.readOnly) return;
  emit("toggle-selection", kind, value);
}

function locate(target) {
  if (target) emit("locate-target", target);
}

function findingFor(target) {
  return props.findings.find((finding) => finding.targetField === target && finding.severity === "error") || null;
}

function rowStatus(item) {
  if (item.decisionType === "missing") return { label: "缺失", cls: "rose" };
  if (!isSelected("decisions", item.targetField)) return { label: "未纳入", cls: "gray" };
  if (findingFor(item.targetField)) return { label: "冲突", cls: "rose" };
  if (confirmationSet.value.has(item.targetField)) return { label: "已确认", cls: "mint" };
  return { label: "待确认", cls: "blue" };
}

function rowClass(item) {
  return {
    low: item.confidence < 0.7,
    off: !isSelected("decisions", item.targetField),
    linked: props.activeTarget === item.targetField,
    blocked: isSelected("decisions", item.targetField) && !!findingFor(item.targetField)
  };
}

function fieldLinked(field) {
  return servedTargets(field, decisions.value).some((target) => target.targetField === props.activeTarget);
}

function decisionClick(item, event) {
  if (event.target.closest("input, button, a, select, label")) return;
  if (props.activeTarget === item.targetField) {
    expandedDecision.value = expandedDecision.value === item.targetField ? "" : item.targetField;
    return;
  }
  locate(item.targetField);
}

function mappingClick(item, event) {
  if (event.target.closest("input, button, a, select, label")) return;
  if (props.activeTarget === item.targetField) {
    expandedMapping.value = expandedMapping.value === item.targetField ? "" : item.targetField;
    return;
  }
  locate(item.targetField);
}

function fieldClick(field) {
  expandedField.value = expandedField.value === field.name ? "" : field.name;
}

function noteClick(item) {
  locate(item.targetField);
}

function dictionaryOfDecision(item) {
  return item.dictionary || null;
}

function decisionDictionaryItems(item) {
  const dict = dictionaryOfDecision(item);
  if (!dict) return [];
  if (Array.isArray(dict.items) && dict.items.length) return dict.items;
  return dictionaryItems(dict.dict_code, dictionaryIndex.value);
}

function fieldDictionaryItems(field) {
  return dictionaryItems(field.dictionary, dictionaryIndex.value);
}
</script>

<template>
  <div class="pgw-decision-list">
    <template v-if="tab === 'overview'">
      <div class="pgw-table-box">
        <table class="pgw-table pgw-decision-table">
          <thead>
            <tr>
              <th style="width:28px"></th>
              <th style="width:150px">目标字段</th>
              <th style="width:80px">决策</th>
              <th style="width:140px">标准字段</th>
              <th style="width:120px">字典</th>
              <th>映射 / 默认值</th>
              <th style="width:72px">置信度</th>
              <th style="width:84px">状态</th>
              <th style="width:28px"></th>
            </tr>
          </thead>
          <tbody>
            <template v-for="item in decisions" :key="item.targetField">
              <tr :class="['pgw-click-row', rowClass(item)]" :data-target="item.targetField" @click="decisionClick(item, $event)">
                <td><input type="checkbox" :checked="isSelected('decisions', item.targetField)" :disabled="readOnly" :aria-label="'纳入 ' + item.targetField" @change="toggle('decisions', item.targetField)"></td>
                <td>
                  <div class="mono pgw-strong">{{ item.targetField }}</div>
                  <div class="dim">{{ item.targetLabel }}</div>
                </td>
                <td><span class="tag" :class="DECISION_CLASSES[item.decisionType] || 'gray'">{{ DECISION_LABELS[item.decisionType] || item.decisionType }}</span></td>
                <td class="mono">{{ decisionStandardText(item) }}</td>
                <td class="mono">{{ decisionDictionaryText(item) }}</td>
                <td>
                  <div class="mono">{{ decisionMappingText(item) }}</div>
                  <div v-if="item.reason" class="dim pgw-reason">{{ item.reason }}</div>
                </td>
                <td><span class="pgw-confidence" :class="{ low: item.confidence < 0.7 }">{{ Math.round((item.confidence || 0) * 100) }}%</span></td>
                <td><span class="tag" :class="rowStatus(item).cls">{{ rowStatus(item).label }}</span></td>
                <td class="dim">
                  <button type="button" class="pgw-chevron" :aria-expanded="expandedDecision === item.targetField" @click.stop="expandedDecision = expandedDecision === item.targetField ? '' : item.targetField">
                    {{ expandedDecision === item.targetField ? "▾" : "▸" }}
                  </button>
                </td>
              </tr>
              <tr v-if="expandedDecision === item.targetField" class="pgw-detail-row">
                <td colspan="9">
                  <div class="pgw-decision-detail">
                    <div>
                      <h6>为什么这样决策</h6>
                      <p>{{ item.reason || "—" }}</p>
                    </div>
                    <div v-if="item.ruleReason">
                      <h6>规则用途</h6>
                      <p>{{ item.ruleReason }}</p>
                    </div>
                    <div v-if="item.standardField">
                      <h6>标准字段</h6>
                      <p class="mono">{{ item.standardField.name }} · {{ item.standardField.label }}</p>
                      <p class="dim">{{ item.standardField.group }} · {{ item.standardField.inputMode === "default" ? "默认值" : "人工输入" }} · {{ item.standardField.type }}</p>
                      <p v-if="item.standardField.description" class="dim">{{ item.standardField.description }}</p>
                    </div>
                    <div v-if="item.dictionary">
                      <h6>字典</h6>
                      <p class="mono">{{ item.dictionary.dict_code }} · {{ item.dictionary.dict_name }}</p>
                      <div class="pgw-option-list">
                        <span v-for="row in decisionDictionaryItems(item)" :key="row.item_code || row.code" class="pgw-option">
                          {{ row.item_code || row.code }} · {{ row.item_name || row.label }}
                        </span>
                      </div>
                    </div>
                    <div v-if="item.mapping">
                      <h6>映射</h6>
                      <p class="mono">
                        {{ item.mapping.sourceField || "（无源字段）" }} → {{ item.targetField }}
                        · {{ item.mapping.mappingType }}
                        <span v-if="item.mapping.defaultValue"> · 默认值 {{ item.mapping.defaultValue }}</span>
                      </p>
                      <p v-if="item.mapping.reason" class="dim">{{ item.mapping.reason }}</p>
                    </div>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
        <p v-if="!decisions.length" class="pgw-empty">本组没有字段决策。</p>
      </div>
    </template>

    <template v-else-if="tab === 'fields'">
      <div class="pgw-table-box">
        <table class="pgw-table pgw-field-decision-table">
          <thead>
            <tr>
              <th style="width:28px"></th>
              <th style="width:170px">标准字段</th>
              <th style="width:130px">中文名</th>
              <th>服务的监管字段</th>
              <th style="width:110px">分组 / 输入方式</th>
              <th style="width:44px">必填</th>
              <th style="width:150px">字典 / 默认值</th>
              <th style="width:72px">置信度</th>
              <th style="width:140px">理由</th>
              <th style="width:28px"></th>
            </tr>
          </thead>
          <tbody>
            <template v-for="field in standardFields" :key="field.name">
              <tr :class="['pgw-click-row', { low: field.confidence < 0.7, off: !isSelected('fields', field.name), linked: fieldLinked(field) }]" @click="fieldClick(field)">
                <td @click.stop><input type="checkbox" :checked="isSelected('fields', field.name)" :disabled="readOnly" :aria-label="'纳入标准字段 ' + field.name" @change="toggle('fields', field.name)"></td>
                <td>
                  <div><span class="mono pgw-strong">{{ field.name }}</span> <span class="tag" :class="field.newField ? 'mint' : 'gray'">{{ field.newField ? "新增" : "复用" }}</span></div>
                  <div class="mono dim">{{ fieldTypeLabel(field.type) }} · {{ field.type }}</div>
                </td>
                <td>{{ field.label }}</td>
                <td>
                  <template v-if="servedTargets(field, decisions).length">
                    <button
                      v-for="target in servedTargets(field, decisions)"
                      :key="target.targetField"
                      type="button"
                      class="pgw-link-line"
                      @click.stop="locate(target.targetField)"
                    >
                      <span class="mono">{{ target.targetField }}</span>
                      <span class="dim">{{ target.targetLabel }}</span>
                    </button>
                  </template>
                  <span v-else class="dim">—</span>
                </td>
                <td>
                  <div class="mono">{{ field.group || "—" }}</div>
                  <div class="dim">{{ field.inputMode === "default" ? "默认值" : "人工输入" }}</div>
                </td>
                <td>{{ field.required ? "是" : "否" }}</td>
                <td>
                  <div v-if="field.dictionary" class="mono">
                    {{ dictionaryTitle(field.dictionary, dictionaryIndex) }}
                    <span class="dim">（{{ field.dictionary }} · {{ fieldDictionaryItems(field).length }} 个码值）</span>
                  </div>
                  <div v-else-if="field.defaultValue" class="mono">默认值 {{ field.defaultValue }}</div>
                  <span v-else class="dim">—</span>
                </td>
                <td><span class="pgw-confidence" :class="{ low: field.confidence < 0.7 }">{{ Math.round((field.confidence || 0) * 100) }}%</span></td>
                <td class="dim">{{ field.reason }}</td>
                <td class="dim">
                  <button type="button" class="pgw-chevron" :aria-expanded="expandedField === field.name" @click.stop="fieldClick(field)">
                    {{ expandedField === field.name ? "▾" : "▸" }}
                  </button>
                </td>
              </tr>
              <tr v-if="expandedField === field.name" class="pgw-detail-row">
                <td colspan="10">
                  <div class="pgw-profile">
                    <div class="pgw-profile-block">
                      <h6>字段定义</h6>
                      <p>{{ field.description || "当前上下文没有字段说明。" }}</p>
                      <p class="dim">英文名 {{ field.labelEn || "—" }} · 来源 {{ field.sourceHint || "—" }}</p>
                      <p v-if="(field.aliases || []).length" class="dim">别名：{{ field.aliases.join("、") }}</p>
                      <div v-if="(field.enumValues || []).length" class="pgw-option-list">
                        <span v-for="value in field.enumValues" :key="value" class="pgw-option">{{ value }}</span>
                      </div>
                    </div>
                    <div class="pgw-profile-block">
                      <h6>字典</h6>
                      <template v-if="field.dictionary">
                        <p class="mono">{{ field.dictionary }} · {{ dictionaryTitle(field.dictionary, dictionaryIndex) }}</p>
                        <div v-if="fieldDictionaryItems(field).length" class="pgw-option-list">
                          <span v-for="item in fieldDictionaryItems(field)" :key="item.item_code || item.code" class="pgw-option">
                            {{ item.item_code || item.code }} · {{ item.item_name || item.label }}
                          </span>
                        </div>
                        <p v-else class="dim">当前上下文没有该字典的码值。</p>
                      </template>
                      <p v-else class="dim">该字段不使用字典。</p>
                    </div>
                    <div class="pgw-profile-block">
                      <h6>服务的监管字段与规则</h6>
                      <div v-for="target in servedTargets(field, decisions)" :key="'rule-' + target.targetField" class="pgw-why">
                        <div><span class="mono pgw-strong">{{ target.targetField }}</span> <span class="dim">{{ target.targetLabel }}</span></div>
                        <div v-for="item in rulesOfTarget(target.targetField, briefFields)" :key="item.kind + item.ruleId + item.path" class="dim">
                          {{ item.kind === "weight" ? "权重" : "分类" }} {{ item.ruleId }} · {{ [item.path, item.whenText, item.note, item.article].filter(Boolean).join(" · ") }}
                        </div>
                        <div v-if="!rulesOfTarget(target.targetField, briefFields).length" class="dim">规则文档没有记录直接用途。</div>
                      </div>
                      <p v-if="!servedTargets(field, decisions).length" class="dim">当前决策没有把它映射到监管字段。</p>
                    </div>
                    <div class="pgw-profile-block">
                      <h6>复用 / 新建依据</h6>
                      <p>{{ field.reason || "—" }}</p>
                      <p v-if="field.existingStandardField" class="dim">
                        已有字段：{{ field.existingStandardField.label }} · {{ field.existingStandardField.group }} ·
                        {{ fieldTypeLabel(field.existingStandardField.type) }} ·
                        {{ field.existingStandardField.inputMode === "default" ? "默认值" : "人工输入" }}
                      </p>
                      <p class="dim">置信度 {{ Math.round((field.confidence || 0) * 100) }}%{{ field.confidence < 0.7 ? "（低，需要人工确认）" : "" }}</p>
                    </div>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
        <p v-if="!standardFields.length" class="pgw-empty">本组没有新的标准字段建议。</p>
      </div>
    </template>

    <template v-else-if="tab === 'dictionaries'">
      <div class="pgw-table-box">
        <table class="pgw-table">
          <thead><tr><th style="width:28px"></th><th style="width:180px">字典编码</th><th style="width:160px">字典名称</th><th style="width:70px">码值数</th><th>码值预览</th></tr></thead>
          <tbody>
            <tr v-for="dict in dictionaries" :key="dict.dict_code" :class="{ off: !isSelected('dictionaries', dict.dict_code) }">
              <td><input type="checkbox" :checked="isSelected('dictionaries', dict.dict_code)" :disabled="readOnly" :aria-label="'纳入字典 ' + dict.dict_code" @change="toggle('dictionaries', dict.dict_code)"></td>
              <td class="mono pgw-strong">{{ dict.dict_code }}</td>
              <td>{{ dict.dict_name }}</td>
              <td>{{ (dict.items || []).length }}</td>
              <td class="dim">{{ (dict.items || []).slice(0, 12).map((item) => (item.item_code || item.code) + " " + (item.item_name || item.label)).join(" · ") }}</td>
            </tr>
          </tbody>
        </table>
        <p v-if="!dictionaries.length" class="pgw-empty">本组没有新建字典建议；已有字典会在标准字段里复用。</p>
      </div>
    </template>

    <template v-else-if="tab === 'mappings'">
      <div class="pgw-table-box">
        <table class="pgw-table pgw-mapping-table">
          <thead>
            <tr>
              <th style="width:28px"></th>
              <th style="width:170px">目标字段</th>
              <th style="width:170px">来源标准字段 / 默认值</th>
              <th style="width:92px">方式</th>
              <th>转换规则</th>
              <th style="width:72px">置信度</th>
              <th style="width:84px">状态</th>
              <th style="width:28px"></th>
            </tr>
          </thead>
          <tbody>
            <template v-for="item in mappingRows" :key="item.targetField">
              <tr :class="['pgw-click-row', { low: item.confidence < 0.7, off: !isSelected('mappings', item.targetField), linked: activeTarget === item.targetField }]" :data-target="item.targetField" @click="mappingClick(item, $event)">
                <td><input type="checkbox" :checked="isSelected('mappings', item.targetField)" :disabled="readOnly" :aria-label="'纳入映射 ' + item.targetField" @change="toggle('mappings', item.targetField)"></td>
                <td>
                  <div class="mono pgw-strong">{{ item.targetField }}</div>
                  <div class="dim">{{ item.targetLabel }}<span v-if="item.targetType"> · {{ fieldTypeLabel(item.targetType) }}</span><span v-if="item.targetRequired"> · 必填</span></div>
                </td>
                <td>
                  <template v-if="item.mappingType === 'constant'">
                    <div class="mono">默认值 {{ item.defaultValue || "（空）" }}</div>
                  </template>
                  <template v-else>
                    <div class="mono">{{ item.sourceField }}</div>
                    <div class="dim">{{ item.sourceLabel || item.sourceField }}</div>
                  </template>
                </td>
                <td>
                  <div>{{ mappingTransformLabel(item) }}</div>
                  <div class="mono dim">{{ item.transformType || item.mappingType }}</div>
                </td>
                <td class="dim">{{ mappingTransformSummary(item) }}</td>
                <td><span class="pgw-confidence" :class="{ low: item.confidence < 0.7 }">{{ Math.round((item.confidence || 0) * 100) }}%</span></td>
                <td><span class="tag" :class="rowStatus(item.decision).cls">{{ rowStatus(item.decision).label }}</span></td>
                <td class="dim">
                  <button type="button" class="pgw-chevron" :aria-expanded="expandedMapping === item.targetField" @click.stop="expandedMapping = expandedMapping === item.targetField ? '' : item.targetField">
                    {{ expandedMapping === item.targetField ? "▾" : "▸" }}
                  </button>
                </td>
              </tr>
              <tr v-if="expandedMapping === item.targetField" class="pgw-detail-row">
                <td colspan="8">
                  <div class="pgw-decision-detail">
                    <div>
                      <h6>字段对照</h6>
                      <p class="mono">{{ item.sourceField || "（无源字段）" }} → {{ item.targetField }}</p>
                      <p class="dim">目标：{{ item.targetLabel }} · {{ fieldTypeLabel(item.targetType) }}{{ item.targetRequired ? " · 必填" : "" }}</p>
                      <p v-if="item.sourceField" class="dim">来源：{{ item.sourceLabel || item.sourceField }}{{ item.sourceType ? " · " + fieldTypeLabel(item.sourceType) : "" }}</p>
                      <p v-if="item.sourceDictionary" class="dim">来源字典：{{ dictionaryTitle(item.sourceDictionary, dictionaryIndex) }}（{{ item.sourceDictionary }}）</p>
                    </div>
                    <div>
                      <h6>转换规则</h6>
                      <p>方式：{{ mappingTransformLabel(item) }}<span class="mono dim"> · {{ item.transformType || item.mappingType }}</span></p>
                      <p v-if="item.transform && item.transform.expression" class="mono">表达式：{{ item.transform.expression }}</p>
                      <p v-if="mappingInputs(item).length" class="dim">输入字段：{{ mappingInputs(item).join("、") }}</p>
                      <p v-if="item.defaultValue" class="mono">默认值：{{ item.defaultValue }}</p>
                      <p v-if="item.transform && item.transform.onUnmappedCode" class="dim">未命中码值：{{ item.transform.onUnmappedCode }}</p>
                      <div v-if="mappingCodeRows(item).length" class="pgw-code-map">
                        <div class="pgw-code-map-head"><span>源码值</span><span>目标码值</span></div>
                        <div v-for="row in mappingCodeRows(item)" :key="row.source" class="pgw-code-map-row">
                          <span class="mono">{{ row.source }}</span>
                          <span class="mono">{{ row.target }}</span>
                        </div>
                      </div>
                    </div>
                    <div>
                      <h6>空值与校验</h6>
                      <p>缺失策略：{{ item.missingPolicy || "—" }}</p>
                      <p class="dim">{{ item.reason || "—" }}</p>
                    </div>
                    <div>
                      <h6>监管依据与置信度</h6>
                      <p>{{ item.regulatoryReference || "映射文档没有标注监管依据。" }}</p>
                      <p class="dim">置信度 {{ Math.round((item.confidence || 0) * 100) }}%{{ item.confidence < 0.7 ? "（低，需要人工确认）" : "" }}</p>
                    </div>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
        <p v-if="!mappingRows.length" class="pgw-empty">本组没有新的映射建议。</p>
      </div>
    </template>

    <template v-else-if="tab === 'notes'">
      <div class="pgw-note-list">
        <button v-for="note in fieldNotes" :key="note.targetField" type="button" class="pgw-note" :data-target="note.targetField" @click="noteClick(note)">
          <div>
            <span class="mono pgw-strong">{{ note.targetField }}</span>
            <div class="dim">{{ note.purpose }}</div>
          </div>
          <div class="pgw-note-side">
            <span class="mono">{{ note.standardField || (note.mappingType === "system" ? "系统计算（跳过）" : "不建标准字段") }}</span>
            <span class="dim">{{ note.mappingType || "" }}</span>
          </div>
        </button>
        <p v-if="!fieldNotes.length" class="pgw-empty">没有字段用途讲解。</p>
      </div>
    </template>

    <template v-else>
      <div class="pgw-table-box">
        <table class="pgw-table">
          <thead><tr><th>目标字段</th><th>原因</th><th>建议标准字段</th><th style="width:84px">状态</th></tr></thead>
          <tbody>
            <tr v-for="item in missing" :key="item.targetField" class="pgw-click-row" :data-target="item.targetField" @click="noteClick(item)">
              <td><span class="mono pgw-strong">{{ item.targetField }}</span> <span class="tag rose">必填缺失</span></td>
              <td>{{ item.reason }}</td>
              <td class="mono">{{ item.suggestedField || "—" }}</td>
              <td><span class="tag rose">缺失</span></td>
            </tr>
          </tbody>
        </table>
        <p v-if="!missing.length" class="pgw-empty">当前没有待人工处理事项。本组字段决策均已完成。</p>
      </div>
    </template>
  </div>
</template>
