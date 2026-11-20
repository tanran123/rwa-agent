<script setup>
import { computed, ref, watch } from "vue";
import Drawer from "@/components/Drawer.vue";

const props = defineProps({
  open: { type: Boolean, default: false },
  field: { type: Object, default: null },
  originalName: { type: String, default: "" },
  groups: { type: Array, default: () => [] },
  dictionaries: { type: Array, default: () => [] },
  existingNames: { type: Array, default: () => [] }
});
const emit = defineEmits(["close", "save", "dictionaries"]);

const TYPES = ["string", "number", "boolean", "date", "enum", "derived", "constant"];
const form = ref(blank());
const enumText = ref("");
const errors = ref([]);

function blank() {
  return {
    name: "",
    label: "",
    label_en: "",
    type: "string",
    group: "",
    required: false,
    status: "ACTIVE",
    unit: "",
    precision: null,
    scale: null,
    format: "",
    default_value: "",
    description: "",
    description_en: "",
    dictionary: "",
    source_hint: "",
    aliases: []
  };
}

function reset() {
  const source = props.field || {};
  const next = blank();
  Object.keys(next).forEach((key) => {
    if (source[key] !== undefined && source[key] !== null) next[key] = source[key];
  });
  next.required = !!source.required;
  next.dictionary = source.dictionary || "";
  next.label_en = source.label_en || source.labelEn || "";
  next.aliases = Array.isArray(source.aliases) ? source.aliases.slice() : [];
  form.value = next;
  enumText.value = (Array.isArray(source.enum_values) ? source.enum_values : [])
    .map((item) => item.code + (item.label ? "=" + item.label : ""))
    .join("\n");
  errors.value = [];
}

watch(() => props.open, (open) => { if (open) reset(); });
watch(() => props.field, () => { if (props.open) reset(); });

const isNew = computed(() => !props.originalName);
const activeDictionaries = computed(() => (props.dictionaries || []).filter((item) => item.status !== "DISABLED"));
const selectedDictionary = computed(() => activeDictionaries.value.find((item) => item.dict_code === form.value.dictionary) || null);
const dictionaryItems = computed(() => ((selectedDictionary.value && selectedDictionary.value.items) || []).filter((item) => item.status !== "DISABLED"));
const aliasesText = computed({
  get: () => (form.value.aliases || []).join(", "),
  set: (value) => { form.value.aliases = String(value || "").split(/[,，;；\s]+/).map((item) => item.trim()).filter(Boolean); }
});

function numberValue(value) {
  if (value === "" || value == null) return null;
  const next = Number(value);
  return Number.isInteger(next) && next >= 0 ? next : null;
}

function parsedEnums() {
  return String(enumText.value || "").split(/[\n;；]+/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const index = line.indexOf("=");
    if (index < 0) return { code: line, label: line };
    return { code: line.slice(0, index).trim(), label: line.slice(index + 1).trim() };
  }).filter((item) => item.code);
}

function save() {
  const next = form.value;
  const list = [];
  if (!next.name.trim()) list.push("字段编码不能为空");
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(next.name.trim())) list.push("字段编码只能使用字母、数字和下划线");
  if (props.existingNames.some((name) => name === next.name.trim() && name !== props.originalName)) list.push("字段编码 " + next.name.trim() + " 已存在");
  if (!next.label.trim()) list.push("中文名称不能为空");
  if (!next.label_en.trim()) list.push("英文名称不能为空");
  if (!next.group) list.push("请选择字段所属分组");
  if (!TYPES.includes(next.type)) list.push("数据类型不合法");
  if (next.type === "enum" && !next.dictionary && !parsedEnums().length) list.push("enum 字段必须选择字典或填写临时枚举值");
  if (next.dictionary && !selectedDictionary.value) list.push("所选字典不存在或已停用");
  if (next.dictionary && selectedDictionary.value && !dictionaryItems.value.length) list.push("所选字典没有可用码值");
  errors.value = list;
  if (list.length) return;
  emit("save", {
    name: next.name.trim(),
    label: next.label.trim(),
    label_en: next.label_en.trim(),
    type: next.type,
    group: next.group,
    required: !!next.required,
    status: next.status,
    unit: next.unit.trim(),
    precision: numberValue(next.precision),
    scale: numberValue(next.scale),
    format: next.format.trim(),
    default_value: next.default_value.trim(),
    description: next.description.trim() || next.label.trim(),
    description_en: next.description_en.trim(),
    dictionary: next.dictionary,
    enum_values: next.dictionary ? [] : parsedEnums(),
    source_hint: next.source_hint.trim(),
    aliases: next.aliases.slice()
  });
}
</script>

<template>
  <Drawer :open="open" wide :title="isNew ? '新增标准字段' : '编辑标准字段 · ' + form.name" @close="emit('close')">
    <p v-if="errors.length" class="notice danger">
      <span class="ni">!</span>
      <div>{{ errors.join("；") }}</div>
    </p>

    <div class="panel">
      <div class="panel-head"><h3>基本信息</h3><span class="sub">字段编码保存后不建议修改</span></div>
      <div class="panel-body">
        <div class="grid c2">
          <div class="field"><label>字段编码</label><input v-model="form.name" :disabled="!isNew" placeholder="如 LOAN_ASSET_ID" /></div>
          <div class="field"><label>所属分组</label>
            <select v-model="form.group">
              <option value="">选择分组</option>
              <option v-for="group in groups" :key="group.id" :value="group.id">{{ group.label }}（{{ group.id }}）</option>
            </select>
          </div>
          <div class="field"><label>中文名称</label><input v-model="form.label" placeholder="如 资产唯一编号" /></div>
          <div class="field"><label>英文名称</label><input v-model="form.label_en" placeholder="如 Asset Unique ID" /></div>
          <div class="field"><label>数据类型</label>
            <select v-model="form.type"><option v-for="type in TYPES" :key="type" :value="type">{{ type }}</option></select>
          </div>
          <div class="field"><label>状态</label>
            <select v-model="form.status"><option value="ACTIVE">启用</option><option value="DISABLED">停用</option></select>
          </div>
        </div>
        <label class="pws-inline-check" style="margin-top: 10px"><input v-model="form.required" type="checkbox" /> 必填字段</label>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head"><h3>类型与格式</h3><span class="sub">金额、比率和日期字段建议填写</span></div>
      <div class="panel-body">
        <div class="grid c4">
          <div class="field"><label>单位</label><input v-model="form.unit" placeholder="HKD / % / 天" /></div>
          <div class="field"><label>精度（总位数）</label><input v-model.number="form.precision" type="number" min="0" /></div>
          <div class="field"><label>小数位</label><input v-model.number="form.scale" type="number" min="0" /></div>
          <div class="field"><label>格式</label><input v-model="form.format" placeholder="YYYY-MM-DD" /></div>
        </div>
        <div class="field" style="margin-top: 10px"><label>默认值</label><input v-model="form.default_value" /></div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head"><h3>码值与字典</h3><span class="sub">优先使用版本级字典</span></div>
      <div class="panel-body">
        <div class="field"><label>码值字典</label>
          <div class="dict-select-row">
            <select v-model="form.dictionary">
              <option value="">不使用字典</option>
              <option v-for="dict in activeDictionaries" :key="dict.dict_code" :value="dict.dict_code">{{ dict.dict_name }}（{{ dict.dict_code }}）</option>
            </select>
            <button type="button" class="btn sm" @click="emit('dictionaries')">管理字典</button>
          </div>
        </div>
        <div v-if="selectedDictionary" class="dict-preview">
          <div class="dict-preview-head">
            <b>{{ selectedDictionary.dict_name }}</b>
            <span class="mono">{{ selectedDictionary.dict_code }}</span>
            <span class="dim">{{ dictionaryItems.length }} 个可用码值</span>
          </div>
          <div class="dict-chips">
            <span v-for="item in dictionaryItems" :key="item.item_code" class="tag blue" :title="item.description || ''">{{ item.item_code }} · {{ item.item_name }}</span>
          </div>
        </div>
        <div v-if="form.type === 'enum' && !form.dictionary" class="field" style="margin-top: 10px">
          <label>临时枚举值（每行一个，格式 CODE=名称）</label>
          <textarea v-model="enumText" rows="4" placeholder="CORP=公司&#10;SME=中小企业"></textarea>
        </div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head"><h3>说明与来源</h3><span class="sub">用于字段映射、模型识别和文档导出</span></div>
      <div class="panel-body">
        <div class="grid c2">
          <div class="field"><label>中文说明</label><textarea v-model="form.description" rows="2"></textarea></div>
          <div class="field"><label>英文说明</label><textarea v-model="form.description_en" rows="2"></textarea></div>
          <div class="field"><label>来源列名</label><input v-model="form.source_hint" placeholder="源系统常见列名" /></div>
          <div class="field"><label>别名（逗号分隔）</label><input v-model="aliasesText" /></div>
        </div>
      </div>
    </div>

    <template #footer>
      <button type="button" class="btn" @click="emit('close')">取消</button>
      <span class="spacer"></span>
      <button type="button" class="btn primary" @click="save">保存字段</button>
    </template>
  </Drawer>
</template>

<style scoped>
.dict-select-row { display: flex; align-items: center; gap: 8px; }
.dict-select-row select { flex: 1; }
.dict-preview {
  margin-top: 10px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #f8fafc;
}
.dict-preview-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 12px;
}
.dict-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 6px;
}
</style>
