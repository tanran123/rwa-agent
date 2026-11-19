<script setup>
import { computed } from "vue";

const props = defineProps({
  condition: { type: Object, default: null },
  fields: { type: Array, default: () => [] },
  lists: { type: Array, default: () => [] },
  depth: { type: Number, default: 0 }
});
const emit = defineEmits(["update:condition", "remove"]);

const OPS = [
  { code: "eq", label: "等于" },
  { code: "neq", label: "不等于" },
  { code: "in", label: "属于" },
  { code: "not_in", label: "不属于" },
  { code: "contains", label: "包含" },
  { code: "not_contains", label: "不包含" },
  { code: "lt", label: "小于" },
  { code: "lte", label: "小于等于" },
  { code: "gt", label: "大于" },
  { code: "gte", label: "大于等于" },
  { code: "between", label: "介于" },
  { code: "exists", label: "有值" },
  { code: "is_null", label: "为空" }
];

const kind = computed(() => {
  const c = props.condition;
  if (!c) return "empty";
  if (c.all != null) return "all";
  if (c.any != null) return "any";
  if (c.not != null) return "not";
  if (c.list_check != null) return "list";
  return "field";
});

const field = computed(() => props.fields.find((item) => item && item.name === props.condition.field) || {});
const options = computed(() => field.value.options || []);
const needsValue = computed(() => props.condition && ["eq", "neq", "in", "not_in", "contains", "not_contains", "lt", "lte", "gt", "gte"].includes(props.condition.op));
const isMulti = computed(() => props.condition && ["in", "not_in"].includes(props.condition.op));
const usingParam = computed(() => props.condition && props.condition.param_ref != null);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function change(next) {
  emit("update:condition", next);
}

function pick(kindCode) {
  if (kindCode === "all") change({ all: [{ field: "", op: "eq", match: "" }] });
  else if (kindCode === "any") change({ any: [{ field: "", op: "eq", match: "" }] });
  else if (kindCode === "not") change({ not: { field: "", op: "eq", match: "" } });
  else if (kindCode === "list") change({ list_check: { include: [], key: {}, on_missing: "not_member" } });
  else change({ field: "", op: "eq", match: "" });
}

function updateField(key, value) {
  const next = clone(props.condition);
  next[key] = value;
  if (key === "field") {
    const picked = props.fields.find((item) => item && item.name === value);
    if (picked && picked.type === "enum" && picked.options && picked.options.length && !next.param_ref) {
      next.match = picked.options[0].code;
    }
  }
  change(next);
}

function setOp(op) {
  const next = clone(props.condition);
  next.op = op;
  if (op === "between") {
    next.lower = next.lower == null ? 0 : next.lower;
    next.upper = next.upper == null ? 0 : next.upper;
    delete next.match;
    delete next.param_ref;
  } else if (op === "exists" || op === "is_null") {
    delete next.match;
    delete next.lower;
    delete next.upper;
    delete next.param_ref;
  } else {
    delete next.lower;
    delete next.upper;
    if (next.match == null && next.param_ref == null) next.match = "";
  }
  change(next);
}

function matchText() {
  const value = props.condition ? props.condition.match : "";
  if (Array.isArray(value)) return value.join(", ");
  return value == null ? "" : String(value);
}

function coerce(text) {
  const type = field.value.type;
  if (type === "number") {
    const num = Number(text);
    return Number.isNaN(num) ? text : num;
  }
  if (type === "boolean") {
    if (text === "true") return true;
    if (text === "false") return false;
  }
  return text;
}

function setMatch(text) {
  const next = clone(props.condition);
  if (isMulti.value) {
    next.match = String(text).split(",").map((item) => item.trim()).filter(Boolean).map(coerce);
  } else {
    next.match = coerce(text);
  }
  delete next.param_ref;
  change(next);
}

function switchParam(on) {
  const next = clone(props.condition);
  if (on) {
    delete next.match;
    next.param_ref = "";
  } else {
    delete next.param_ref;
    next.match = "";
  }
  change(next);
}

function setParam(text) {
  const next = clone(props.condition);
  next.param_ref = text;
  change(next);
}

function childAt(key, index) {
  return props.condition[key][index];
}

function setChild(key, index, value) {
  const next = clone(props.condition);
  next[key][index] = value;
  change(next);
}

function removeChild(key, index) {
  const next = clone(props.condition);
  next[key].splice(index, 1);
  change(next);
}

function addChild(key) {
  const next = clone(props.condition);
  next[key].push({ field: "", op: "eq", match: "" });
  change(next);
}

function setNot(value) {
  const next = clone(props.condition);
  next.not = value;
  change(next);
}

function listCheck() {
  return props.condition && props.condition.list_check ? props.condition.list_check : {};
}

function updateCheck(key, value) {
  const next = clone(props.condition);
  next.list_check[key] = value;
  change(next);
}

function keyText() {
  const key = listCheck().key || {};
  return Object.keys(key).map((name) => name + "=" + key[name]).join("\n");
}

function setKeyText(text) {
  const key = {};
  String(text || "").split("\n").forEach((line) => {
    const at = line.indexOf("=");
    if (at > 0) key[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  });
  updateCheck("key", key);
}

function toggleList(kindName, listId) {
  const check = listCheck();
  const current = Array.isArray(check[kindName]) ? check[kindName].slice() : [];
  const at = current.findIndex((item) => item.list_id === listId);
  if (at >= 0) current.splice(at, 1);
  else current.push({ list_id: listId });
  updateCheck(kindName, current);
}

function listOn(kindName, listId) {
  const check = listCheck();
  return (check[kindName] || []).some((item) => item.list_id === listId);
}
</script>

<template>
  <div class="cond-editor" :style="{ marginLeft: depth ? '14px' : '0' }">
    <template v-if="kind === 'empty'">
      <div class="field-actions">
        <button type="button" class="btn sm" @click="pick('field')">字段条件</button>
        <button type="button" class="btn sm" @click="pick('all')">全部满足</button>
        <button type="button" class="btn sm" @click="pick('any')">任一满足</button>
        <button type="button" class="btn sm" @click="pick('not')">否定</button>
        <button type="button" class="btn sm" @click="pick('list')">名单判断</button>
      </div>
    </template>

    <template v-else-if="kind === 'all' || kind === 'any'">
      <div class="panel-head" style="min-height: 0; padding: 0 0 6px">
        <strong>{{ kind === "all" ? "全部满足" : "任一满足" }}</strong>
        <span class="spacer"></span>
        <button type="button" class="btn sm" @click="addChild(kind)">添加</button>
        <button type="button" class="btn sm danger" @click="$emit('remove')">移除</button>
      </div>
      <div v-for="(item, index) in condition[kind]" :key="index" style="margin-bottom: 6px">
        <WhenEditor
          :condition="childAt(kind, index)"
          :fields="fields"
          :lists="lists"
          :depth="depth + 1"
          @update:condition="setChild(kind, index, $event)"
          @remove="removeChild(kind, index)"
        />
      </div>
    </template>

    <template v-else-if="kind === 'not'">
      <div class="panel-head" style="min-height: 0; padding: 0 0 6px">
        <strong>否定</strong>
        <span class="spacer"></span>
        <button type="button" class="btn sm danger" @click="$emit('remove')">移除</button>
      </div>
      <WhenEditor
        :condition="condition.not"
        :fields="fields"
        :lists="lists"
        :depth="depth + 1"
        @update:condition="setNot"
      />
    </template>

    <template v-else-if="kind === 'list'">
      <div class="grid c2">
        <label class="field">包含名单
          <span v-for="item in lists" :key="item.list_id" style="display: block; font-size: 12px">
            <input type="checkbox" :checked="listOn('include', item.list_id)" @change="toggleList('include', item.list_id)" />
            {{ item.list_id }}
          </span>
        </label>
        <label class="field">排除名单
          <span v-for="item in lists" :key="item.list_id" style="display: block; font-size: 12px">
            <input type="checkbox" :checked="listOn('exclude', item.list_id)" @change="toggleList('exclude', item.list_id)" />
            {{ item.list_id }}
          </span>
        </label>
        <label class="field full">匹配键（一行一个 field=value）
          <textarea :value="keyText()" @change="setKeyText($event.target.value)"></textarea>
        </label>
        <label class="field">命中后写入
          <input :value="listCheck().assign_to || ''" type="text" placeholder="$context.xxx" @change="updateCheck('assign_to', $event.target.value)" />
        </label>
        <label class="field">未命中处理
          <select :value="listCheck().on_missing || 'not_member'" @change="updateCheck('on_missing', $event.target.value)">
            <option value="not_member">not_member</option>
            <option value="unknown">unknown</option>
            <option value="manual_review">manual_review</option>
            <option value="fail">fail</option>
          </select>
        </label>
      </div>
      <div class="field-actions"><button type="button" class="btn sm danger" @click="$emit('remove')">移除这个条件</button></div>
    </template>

    <template v-else>
      <div class="grid c3">
        <label class="field">字段
          <select :value="condition.field" @change="updateField('field', $event.target.value)">
            <option value="">选择字段</option>
            <option v-for="item in fields" :key="item.name" :value="item.name">{{ item.name }}{{ item.label ? " · " + item.label : "" }}</option>
          </select>
        </label>
        <label class="field">操作
          <select :value="condition.op" @change="setOp($event.target.value)">
            <option v-for="item in OPS" :key="item.code" :value="item.code">{{ item.label }}（{{ item.code }}）</option>
          </select>
        </label>
        <label v-if="needsValue" class="field">引用参数表
          <span style="display: flex; align-items: center; gap: 6px">
            <input type="checkbox" :checked="usingParam" @change="switchParam($event.target.checked)" />
            <input v-if="usingParam" :value="condition.param_ref || ''" type="text" placeholder="T_STC_RW_CONSTANTS#MIN" @change="setParam($event.target.value)" />
          </span>
        </label>
      </div>

      <div v-if="condition.op === 'between'" class="grid c2">
        <label class="field">下限
          <input :value="condition.lower == null ? '' : condition.lower" type="number" step="any" @change="updateField('lower', Number($event.target.value))" />
        </label>
        <label class="field">上限
          <input :value="condition.upper == null ? '' : condition.upper" type="number" step="any" @change="updateField('upper', Number($event.target.value))" />
        </label>
      </div>

      <div v-else-if="needsValue && !usingParam" class="grid c2">
        <label v-if="field.type === 'enum' && !isMulti" class="field">取值
          <select :value="condition.match" @change="setMatch($event.target.value)">
            <option v-for="item in options" :key="String(item.code)" :value="item.code">{{ item.label }}（{{ item.code }}）</option>
          </select>
        </label>
        <label v-else-if="field.type === 'boolean' && !isMulti" class="field">取值
          <select :value="String(condition.match)" @change="setMatch($event.target.value)">
            <option value="true">true</option>
            <option value="false">false</option>
          </select>
        </label>
        <label v-else class="field">{{ isMulti ? "取值（逗号分隔）" : "取值" }}
          <input :value="matchText()" :type="field.type === 'number' && !isMulti ? 'number' : 'text'" @change="setMatch($event.target.value)" />
        </label>
      </div>

      <div class="field-actions" style="justify-content: flex-start">
        <button type="button" class="btn sm danger" @click="$emit('remove')">移除这个条件</button>
      </div>
    </template>
  </div>
</template>
