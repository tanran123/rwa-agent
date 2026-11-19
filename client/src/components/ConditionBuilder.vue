<script setup>
import { computed } from "vue";

const props = defineProps({
  modelValue: { default: null },
  fields: { type: Array, default: () => [] },
  dictionaries: { type: Array, default: () => [] }
});
const emit = defineEmits(["update:modelValue"]);

const OP_LABELS = {
  eq: "等于", neq: "不等于", in: "属于", not_in: "不属于",
  contains: "包含", not_contains: "不包含", gt: "大于", gte: "大于等于",
  lt: "小于", lte: "小于等于", between: "区间", before: "早于",
  after: "晚于", exists: "存在", is_null: "为空"
};
const ARRAY_OPS = ["in", "not_in", "between"];
const STRING_OPS = ["eq", "neq", "in", "not_in", "contains", "not_contains", "exists", "is_null"];
const NUMBER_OPS = ["eq", "neq", "gt", "gte", "lt", "lte", "between", "exists", "is_null"];
const DATE_OPS = ["eq", "neq", "before", "after", "between", "exists", "is_null"];
const BOOLEAN_OPS = ["eq", "exists", "is_null"];

const activeFields = computed(() => props.fields.filter((field) => field.status === "ACTIVE"));
const fieldMap = computed(() => new Map(activeFields.value.map((field) => [field.code, field])));
const dictionaryMap = computed(() => new Map((props.dictionaries || []).map((dict) => [dict.code, dict])));

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function opsOf(field) {
  const type = String((field && field.dataType) || "").toUpperCase();
  if (["INTEGER", "DECIMAL", "NUMBER", "PERCENT", "CURRENCY"].includes(type)) return NUMBER_OPS;
  if (type === "DATE") return DATE_OPS;
  if (type === "BOOLEAN") return BOOLEAN_OPS;
  return STRING_OPS;
}

function isBoolean(field) {
  return String((field && field.dataType) || "").toUpperCase() === "BOOLEAN";
}

function isDate(field) {
  return String((field && field.dataType) || "").toUpperCase() === "DATE";
}

function isNumeric(field) {
  return ["INTEGER", "DECIMAL", "NUMBER", "PERCENT", "CURRENCY"].includes(String((field && field.dataType) || "").toUpperCase());
}

function dictionaryItems(field) {
  if (!field || !field.dictionary) return [];
  const dict = dictionaryMap.value.get(field.dictionary);
  return dict ? (dict.items || []).filter((item) => item.status === "ACTIVE") : [];
}

function ensureTree() {
  return props.modelValue && typeof props.modelValue === "object"
    ? props.modelValue
    : { logic: "AND", conditions: [] };
}

function commit(next) {
  emit("update:modelValue", clone(next));
}

function firstValue(field, op) {
  if (op === "exists" || op === "is_null") return null;
  if (op === "between") return ["", ""];
  if (op === "in" || op === "not_in") return [];
  if (isBoolean(field)) return true;
  return "";
}

function makeCondition(field) {
  const picked = field || activeFields.value[0];
  if (!picked) return null;
  const op = opsOf(picked)[0] || "eq";
  return { field: picked.code, op, value: firstValue(picked, op) };
}

function addCondition() {
  const tree = clone(ensureTree());
  const node = makeCondition();
  if (!node) return;
  tree.conditions = tree.conditions || [];
  tree.conditions.push(node);
  commit(tree);
}

function addGroup() {
  const tree = clone(ensureTree());
  tree.conditions = tree.conditions || [];
  const node = makeCondition();
  tree.conditions.push({ logic: "AND", conditions: node ? [node] : [] });
  commit(tree);
}

function addSubCondition(tree, groupIndex) {
  const next = clone(tree);
  const node = makeCondition();
  if (!node) return;
  next.conditions[groupIndex].conditions.push(node);
  commit(next);
}

function removeNode(tree, index) {
  const next = clone(tree);
  next.conditions.splice(index, 1);
  commit(next);
}

function removeSubNode(tree, groupIndex, index) {
  const next = clone(tree);
  next.conditions[groupIndex].conditions.splice(index, 1);
  commit(next);
}

function setLogic(tree, value) {
  const next = clone(tree);
  next.logic = value;
  commit(next);
}

function setSubLogic(tree, groupIndex, value) {
  const next = clone(tree);
  next.conditions[groupIndex].logic = value;
  commit(next);
}

function setField(tree, index, code, subIndex = -1) {
  const next = clone(tree);
  const node = subIndex >= 0 ? next.conditions[index].conditions[subIndex] : next.conditions[index];
  const field = fieldMap.value.get(code);
  node.field = code;
  node.op = opsOf(field)[0] || "eq";
  node.value = firstValue(field, node.op);
  commit(next);
}

function setOp(tree, index, op, subIndex = -1) {
  const next = clone(tree);
  const node = subIndex >= 0 ? next.conditions[index].conditions[subIndex] : next.conditions[index];
  const field = fieldMap.value.get(node.field);
  node.op = op;
  node.value = firstValue(field, op);
  commit(next);
}

function setValue(tree, index, value, subIndex = -1) {
  const next = clone(tree);
  const node = subIndex >= 0 ? next.conditions[index].conditions[subIndex] : next.conditions[index];
  node.value = value;
  commit(next);
}

function setMulti(tree, index, event, subIndex = -1) {
  const values = Array.from(event.target.selectedOptions || []).map((option) => option.value);
  setValue(tree, index, values, subIndex);
}

function setBetween(tree, index, part, event, subIndex = -1) {
  const next = clone(tree);
  const node = subIndex >= 0 ? next.conditions[index].conditions[subIndex] : next.conditions[index];
  const current = Array.isArray(node.value) ? node.value.slice() : ["", ""];
  current[part] = event.target.value;
  node.value = current;
  commit(next);
}
</script>

<template>
  <div class="cb">
    <div v-if="!modelValue || !modelValue.conditions || !modelValue.conditions.length" class="cb-empty">
      尚未配置识别条件。启用产品组后，每条业务明细会按这里的条件自动归组。
    </div>
    <div v-else class="cb-root">
      <div class="cb-head">
        <span>满足</span>
        <select :value="modelValue.logic" @change="setLogic(modelValue, $event.target.value)">
          <option value="AND">全部条件（AND）</option>
          <option value="OR">任一条件（OR）</option>
        </select>
        <span>时命中本产品组</span>
      </div>
      <div v-for="(node, index) in modelValue.conditions" :key="index" class="cb-node">
        <div v-if="Array.isArray(node.conditions)" class="cb-sub">
          <div class="cb-head">
            <span>条件组满足</span>
            <select :value="node.logic" @change="setSubLogic(modelValue, index, $event.target.value)">
              <option value="AND">全部条件（AND）</option>
              <option value="OR">任一条件（OR）</option>
            </select>
            <span>时命中</span>
            <span class="spacer"></span>
            <button type="button" class="btn xs" @click="addSubCondition(modelValue, index)">＋ 条件</button>
            <button type="button" class="btn xs danger" @click="removeNode(modelValue, index)">删除组</button>
          </div>
          <div v-for="(child, childIndex) in node.conditions" :key="childIndex" class="cb-condition">
            <select :value="child.field" @change="setField(modelValue, index, $event.target.value, childIndex)">
              <option v-for="field in activeFields" :key="field.code" :value="field.code">
                {{ field.name }}（{{ field.code }}）
              </option>
            </select>
            <select :value="child.op" @change="setOp(modelValue, index, $event.target.value, childIndex)">
              <option v-for="op in opsOf(fieldMap.get(child.field))" :key="op" :value="op">{{ OP_LABELS[op] }}</option>
            </select>
            <template v-if="!['exists', 'is_null'].includes(child.op)">
              <select
                v-if="dictionaryItems(fieldMap.get(child.field)).length && !['in', 'not_in', 'between'].includes(child.op)"
                :value="child.value"
                @change="setValue(modelValue, index, $event.target.value, childIndex)"
              >
                <option value="">请选择码值</option>
                <option v-for="item in dictionaryItems(fieldMap.get(child.field))" :key="item.code" :value="item.code">
                  {{ item.name }}（{{ item.code }}）
                </option>
              </select>
              <select
                v-else-if="dictionaryItems(fieldMap.get(child.field)).length && ['in', 'not_in'].includes(child.op)"
                multiple
                :value="Array.isArray(child.value) ? child.value : []"
                @change="setMulti(modelValue, index, $event, childIndex)"
              >
                <option v-for="item in dictionaryItems(fieldMap.get(child.field))" :key="item.code" :value="item.code">
                  {{ item.name }}（{{ item.code }}）
                </option>
              </select>
              <select
                v-else-if="isBoolean(fieldMap.get(child.field))"
                :value="String(child.value)"
                @change="setValue(modelValue, index, $event.target.value === 'true', childIndex)"
              >
                <option value="true">是</option>
                <option value="false">否</option>
              </select>
              <template v-else-if="child.op === 'between'">
                <input
                  :type="isDate(fieldMap.get(child.field)) ? 'date' : isNumeric(fieldMap.get(child.field)) ? 'number' : 'text'"
                  :value="Array.isArray(child.value) ? child.value[0] : ''"
                  @input="setBetween(modelValue, index, 0, $event, childIndex)"
                />
                <input
                  :type="isDate(fieldMap.get(child.field)) ? 'date' : isNumeric(fieldMap.get(child.field)) ? 'number' : 'text'"
                  :value="Array.isArray(child.value) ? child.value[1] : ''"
                  @input="setBetween(modelValue, index, 1, $event, childIndex)"
                />
              </template>
              <input
                v-else
                :type="isDate(fieldMap.get(child.field)) ? 'date' : isNumeric(fieldMap.get(child.field)) ? 'number' : 'text'"
                :value="child.value"
                @input="setValue(modelValue, index, $event.target.value, childIndex)"
              />
            </template>
            <button type="button" class="btn xs danger" @click="removeSubNode(modelValue, index, childIndex)">删除</button>
          </div>
        </div>
        <template v-else>
          <div class="cb-condition">
            <select :value="node.field" @change="setField(modelValue, index, $event.target.value)">
              <option v-for="field in activeFields" :key="field.code" :value="field.code">
                {{ field.name }}（{{ field.code }}）
              </option>
            </select>
            <select :value="node.op" @change="setOp(modelValue, index, $event.target.value)">
              <option v-for="op in opsOf(fieldMap.get(node.field))" :key="op" :value="op">{{ OP_LABELS[op] }}</option>
            </select>
            <template v-if="!['exists', 'is_null'].includes(node.op)">
              <select
                v-if="dictionaryItems(fieldMap.get(node.field)).length && !['in', 'not_in', 'between'].includes(node.op)"
                :value="node.value"
                @change="setValue(modelValue, index, $event.target.value)"
              >
                <option value="">请选择码值</option>
                <option v-for="item in dictionaryItems(fieldMap.get(node.field))" :key="item.code" :value="item.code">
                  {{ item.name }}（{{ item.code }}）
                </option>
              </select>
              <select
                v-else-if="dictionaryItems(fieldMap.get(node.field)).length && ['in', 'not_in'].includes(node.op)"
                multiple
                :value="Array.isArray(node.value) ? node.value : []"
                @change="setMulti(modelValue, index, $event)"
              >
                <option v-for="item in dictionaryItems(fieldMap.get(node.field))" :key="item.code" :value="item.code">
                  {{ item.name }}（{{ item.code }}）
                </option>
              </select>
              <select
                v-else-if="isBoolean(fieldMap.get(node.field))"
                :value="String(node.value)"
                @change="setValue(modelValue, index, $event.target.value === 'true')"
              >
                <option value="true">是</option>
                <option value="false">否</option>
              </select>
              <template v-else-if="node.op === 'between'">
                <input
                  :type="isDate(fieldMap.get(node.field)) ? 'date' : isNumeric(fieldMap.get(node.field)) ? 'number' : 'text'"
                  :value="Array.isArray(node.value) ? node.value[0] : ''"
                  @input="setBetween(modelValue, index, 0, $event)"
                />
                <input
                  :type="isDate(fieldMap.get(node.field)) ? 'date' : isNumeric(fieldMap.get(node.field)) ? 'number' : 'text'"
                  :value="Array.isArray(node.value) ? node.value[1] : ''"
                  @input="setBetween(modelValue, index, 1, $event)"
                />
              </template>
              <input
                v-else
                :type="isDate(fieldMap.get(node.field)) ? 'date' : isNumeric(fieldMap.get(node.field)) ? 'number' : 'text'"
                :value="node.value"
                @input="setValue(modelValue, index, $event.target.value)"
              />
            </template>
            <button type="button" class="btn xs danger" @click="removeNode(modelValue, index)">删除</button>
          </div>
        </template>
      </div>
    </div>
    <div class="cb-actions">
      <button type="button" class="btn sm" @click="addCondition">＋ 添加条件</button>
      <button type="button" class="btn sm" @click="addGroup">＋ 添加条件组</button>
    </div>
  </div>
</template>

<style scoped>
.cb { display: flex; flex-direction: column; gap: 8px; }
.cb-empty { border: 1px dashed var(--line); border-radius: 8px; padding: 10px 12px; color: var(--muted); font-size: 12px; }
.cb-root { border: 1px solid var(--line); border-radius: 10px; padding: 10px; background: #fbfdff; display: flex; flex-direction: column; gap: 8px; }
.cb-sub { border: 1px dashed var(--line); border-radius: 8px; padding: 8px; background: #fff; display: flex; flex-direction: column; gap: 6px; }
.cb-head { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 11.5px; color: var(--muted); }
.cb-head select { width: auto; min-width: 120px; }
.cb-node { display: flex; flex-direction: column; gap: 6px; }
.cb-condition { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.cb-condition select { width: auto; min-width: 130px; }
.cb-condition input { width: 140px; }
.cb-condition select[multiple] { min-height: 58px; min-width: 160px; }
.cb-actions { display: flex; gap: 6px; flex-wrap: wrap; }
</style>
