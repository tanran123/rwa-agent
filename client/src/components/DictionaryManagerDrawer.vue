<script setup>
import { computed, ref, watch } from "vue";
import Drawer from "@/components/Drawer.vue";
import { saveRuleDocument } from "@/api/config";
import { askConfirm } from "@/utils/confirm";

const props = defineProps({
  open: { type: Boolean, default: false },
  registry: { type: Object, default: null },
  dictionaries: { type: Array, default: () => [] },
  fields: { type: Array, default: () => [] }
});
const emit = defineEmits(["close", "saved"]);

const list = ref([]);
const selectedCode = ref("");
const dictForm = ref(blankDict());
const itemForm = ref(blankItem());
const editingDictCode = ref("");
const editingItemCode = ref("");
const errors = ref([]);
const saving = ref(false);
const notice = ref("");

function blankDict() {
  return { dict_code: "", dict_name: "", dict_name_en: "", description: "", status: "ACTIVE", items: [] };
}
function blankItem() {
  return { item_code: "", item_name: "", item_name_en: "", description: "", sort_order: 10, status: "ACTIVE" };
}
function clone(value) {
  return JSON.parse(JSON.stringify(value == null ? null : value));
}
function reset() {
  list.value = clone(props.dictionaries || []);
  selectedCode.value = list.value[0] ? list.value[0].dict_code : "";
  editingDictCode.value = "";
  editingItemCode.value = "";
  dictForm.value = blankDict();
  itemForm.value = blankItem();
  errors.value = [];
  notice.value = "";
}
watch(() => props.open, (open) => { if (open) reset(); });

const selectedDictionary = computed(() => list.value.find((item) => item.dict_code === selectedCode.value) || null);
const selectedItems = computed(() => (selectedDictionary.value && selectedDictionary.value.items) || []);
const referenceFields = computed(() => (code) => (props.fields || []).filter((field) => field.dictionary === code));

function selectDict(code) {
  selectedCode.value = code;
  editingDictCode.value = "";
  editingItemCode.value = "";
  dictForm.value = blankDict();
  itemForm.value = blankItem();
}

function editDict(dict) {
  editingDictCode.value = dict.dict_code;
  dictForm.value = {
    dict_code: dict.dict_code,
    dict_name: dict.dict_name || "",
    dict_name_en: dict.dict_name_en || "",
    description: dict.description || "",
    status: dict.status || "ACTIVE",
    items: []
  };
}

function saveDict() {
  const form = dictForm.value;
  const problems = [];
  if (!/^[A-Z][A-Z0-9_]+$/.test(String(form.dict_code || "").trim())) problems.push("字典编码必须匹配 ^[A-Z][A-Z0-9_]+$");
  if (!editingDictCode.value && list.value.some((item) => item.dict_code === form.dict_code.trim())) problems.push("字典编码已存在");
  if (!form.dict_name.trim()) problems.push("字典中文名称不能为空");
  if (!form.dict_name_en.trim()) problems.push("字典英文名称不能为空");
  errors.value = problems;
  if (problems.length) return;
  if (editingDictCode.value) {
    const target = list.value.find((item) => item.dict_code === editingDictCode.value);
    if (target) {
      target.dict_name = form.dict_name.trim();
      target.dict_name_en = form.dict_name_en.trim();
      target.description = form.description.trim();
      target.status = form.status;
    }
    selectedCode.value = editingDictCode.value;
  } else {
    list.value.push({
      dict_code: form.dict_code.trim(),
      dict_name: form.dict_name.trim(),
      dict_name_en: form.dict_name_en.trim(),
      description: form.description.trim(),
      status: form.status,
      items: []
    });
    selectedCode.value = form.dict_code.trim();
  }
  editingDictCode.value = "";
  dictForm.value = blankDict();
  notice.value = "字典已修改，点「保存到当前版本」生效。";
}

async function removeDict(dict) {
  const refs = referenceFields(dict.dict_code);
  if (refs.length) {
    errors.value = ["字典「" + dict.dict_name + "」被 " + refs.length + " 个字段引用，不能删除；请先调整字段或停用字典"];
    return;
  }
  const yes = await askConfirm("删除字典「" + dict.dict_name + "」及其全部码值？", { title: "删除字典", confirmText: "删除", danger: true });
  if (!yes) return;
  list.value = list.value.filter((item) => item.dict_code !== dict.dict_code);
  if (selectedCode.value === dict.dict_code) selectedCode.value = list.value[0] ? list.value[0].dict_code : "";
  errors.value = [];
  notice.value = "字典已删除，点「保存到当前版本」生效。";
}

function editItem(item) {
  editingItemCode.value = item.item_code;
  itemForm.value = {
    item_code: item.item_code,
    item_name: item.item_name || "",
    item_name_en: item.item_name_en || "",
    description: item.description || "",
    sort_order: typeof item.sort_order === "number" ? item.sort_order : 10,
    status: item.status || "ACTIVE"
  };
}

function saveItem() {
  if (!selectedDictionary.value) {
    errors.value = ["请先选择或新建字典"];
    return;
  }
  const form = itemForm.value;
  const problems = [];
  if (!String(form.item_code || "").trim()) problems.push("码值编码不能为空");
  if (!editingItemCode.value && selectedItems.value.some((item) => item.item_code === form.item_code.trim())) problems.push("码值编码已存在");
  if (!form.item_name.trim()) problems.push("码值中文名称不能为空");
  if (!form.item_name_en.trim()) problems.push("码值英文名称不能为空");
  errors.value = problems;
  if (problems.length) return;
  if (editingItemCode.value) {
    const target = selectedItems.value.find((item) => item.item_code === editingItemCode.value);
    if (target) {
      target.item_name = form.item_name.trim();
      target.item_name_en = form.item_name_en.trim();
      target.description = form.description.trim();
      target.sort_order = Number(form.sort_order) || 0;
      target.status = form.status;
    }
  } else {
    selectedDictionary.value.items.push({
      item_code: form.item_code.trim(),
      item_name: form.item_name.trim(),
      item_name_en: form.item_name_en.trim(),
      description: form.description.trim(),
      sort_order: Number(form.sort_order) || 0,
      status: form.status
    });
  }
  selectedDictionary.value.items.sort((left, right) => (left.sort_order || 0) - (right.sort_order || 0));
  editingItemCode.value = "";
  itemForm.value = blankItem();
  notice.value = "码值已修改，点「保存到当前版本」生效。";
}

async function removeItem(item) {
  const yes = await askConfirm("删除码值「" + item.item_name + "」？已经使用这个码值的历史数据不会自动改变。", { title: "删除码值", confirmText: "删除", danger: true });
  if (!yes) return;
  selectedDictionary.value.items = selectedItems.value.filter((entry) => entry.item_code !== item.item_code);
  if (editingItemCode.value === item.item_code) {
    editingItemCode.value = "";
    itemForm.value = blankItem();
  }
  notice.value = "码值已删除，点「保存到当前版本」生效。";
}

async function persist() {
  if (!props.registry) {
    errors.value = ["没有找到产品注册文档"];
    return;
  }
  const problems = [];
  const seen = new Set();
  list.value.forEach((dict) => {
    if (seen.has(dict.dict_code)) problems.push(dict.dict_code + "：字典编码重复");
    seen.add(dict.dict_code);
    if (!dict.dict_name || !dict.dict_name.trim()) problems.push(dict.dict_code + "：中文名称不能为空");
    if (!dict.dict_name_en || !dict.dict_name_en.trim()) problems.push(dict.dict_code + "：英文名称不能为空");
    if (!Array.isArray(dict.items) || !dict.items.length) problems.push(dict.dict_code + "：至少需要一个码值");
  });
  errors.value = problems;
  if (problems.length) return;
  saving.value = true;
  notice.value = "";
  try {
    const body = clone(props.registry.body || {});
    body.dictionaries = clone(list.value);
    const saved = await saveRuleDocument(props.registry.id, { body, baseRevision: props.registry.revision });
    list.value = clone(saved.body.dictionaries || []);
    emit("saved", saved);
    notice.value = "码值字典已保存到当前监管版本。";
  } catch (err) {
    errors.value = [err.message || "字典保存失败"];
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <Drawer :open="open" wide title="码值字典" @close="emit('close')">
    <p v-if="errors.length" class="notice danger"><span class="ni">!</span><div>{{ errors.join("；") }}</div></p>
    <p v-if="notice" class="notice ok"><span class="ni">✓</span><div>{{ notice }}</div></p>
    <p class="hint">字典按监管版本保存；标准字段只保存字典编码。被字段引用的字典不能删除，只能停用。</p>

    <div class="dict-layout">
      <div class="panel">
        <div class="panel-head">
          <h3>字典</h3>
          <span class="spacer"></span>
          <button type="button" class="btn xs" @click="selectDict(''); editingDictCode = ''; dictForm = blankDict()">＋</button>
        </div>
        <div class="panel-body dict-list">
          <button
            v-for="dict in list"
            :key="dict.dict_code"
            type="button"
            class="dict-item"
            :class="{ on: selectedCode === dict.dict_code }"
            @click="selectDict(dict.dict_code)"
          >
            <span>{{ dict.dict_name }}</span>
            <b>{{ (dict.items || []).length }}</b>
          </button>
          <p v-if="!list.length" class="dim" style="padding: 10px">还没有字典。</p>
        </div>
      </div>

      <div class="panel">
        <div class="panel-head">
          <h3>{{ editingDictCode ? "编辑字典" : "新增字典" }}</h3>
          <span class="spacer"></span>
          <button type="button" class="btn sm" @click="saveDict">保存字典</button>
        </div>
        <div class="panel-body">
          <div class="grid c2">
            <div class="field"><label>字典编码</label><input v-model="dictForm.dict_code" :disabled="!!editingDictCode" placeholder="如 CUST_TYPE" /></div>
            <div class="field"><label>中文名称</label><input v-model="dictForm.dict_name" placeholder="如 交易对手类型" /></div>
            <div class="field"><label>英文名称</label><input v-model="dictForm.dict_name_en" placeholder="如 Counterparty Type" /></div>
            <div class="field"><label>状态</label><select v-model="dictForm.status"><option value="ACTIVE">启用</option><option value="DISABLED">停用</option></select></div>
          </div>
          <div class="field" style="margin-top: 10px"><label>说明</label><textarea v-model="dictForm.description" rows="2"></textarea></div>
          <div v-if="selectedDictionary" class="dict-actions">
            <button type="button" class="btn sm" @click="editDict(selectedDictionary)">编辑当前字典</button>
            <button type="button" class="btn sm danger" @click="removeDict(selectedDictionary)">删除当前字典</button>
            <span class="dim">被 {{ referenceFields(selectedDictionary.dict_code).length }} 个字段引用</span>
          </div>
        </div>
      </div>
    </div>

    <div v-if="selectedDictionary" class="panel" style="margin-top: 10px">
      <div class="panel-head">
        <h3>{{ selectedDictionary.dict_name }} · 码值</h3>
        <span class="sub mono">{{ selectedDictionary.dict_code }} · {{ selectedItems.length }} 项</span>
        <span class="spacer"></span>
        <button type="button" class="btn sm" @click="editingItemCode = ''; itemForm = blankItem()">＋ 新增码值</button>
      </div>
      <div class="panel-body">
        <div class="grid c4">
          <div class="field"><label>码值编码</label><input v-model="itemForm.item_code" :disabled="!!editingItemCode" /></div>
          <div class="field"><label>中文名称</label><input v-model="itemForm.item_name" /></div>
          <div class="field"><label>英文名称</label><input v-model="itemForm.item_name_en" /></div>
          <div class="field"><label>排序</label><input v-model.number="itemForm.sort_order" type="number" /></div>
          <div class="field"><label>状态</label><select v-model="itemForm.status"><option value="ACTIVE">启用</option><option value="DISABLED">停用</option></select></div>
          <div class="field" style="grid-column: span 3"><label>说明</label><input v-model="itemForm.description" /></div>
        </div>
        <div class="btn-group" style="margin-top: 10px">
          <button type="button" class="btn sm primary" @click="saveItem">{{ editingItemCode ? "保存码值" : "新增码值" }}</button>
          <button v-if="editingItemCode" type="button" class="btn sm" @click="editingItemCode = ''; itemForm = blankItem()">取消编辑</button>
        </div>
        <div class="table-wrap" style="margin-top: 10px">
          <table class="tbl compact">
            <thead><tr><th>码值编码</th><th>中文名称</th><th>英文名称</th><th class="num">排序</th><th>状态</th><th style="width: 110px">操作</th></tr></thead>
            <tbody>
              <tr v-for="item in selectedItems" :key="item.item_code">
                <td class="mono small">{{ item.item_code }}</td>
                <td>{{ item.item_name }}</td>
                <td>{{ item.item_name_en }}</td>
                <td class="num">{{ item.sort_order }}</td>
                <td><span class="tag" :class="item.status === 'DISABLED' ? 'muted' : 'green'">{{ item.status === "DISABLED" ? "停用" : "启用" }}</span></td>
                <td>
                  <button type="button" class="btn sm" @click="editItem(item)">编辑</button>
                  <button type="button" class="btn sm danger" @click="removeItem(item)">删除</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <template #footer>
      <button type="button" class="btn" @click="emit('close')">关闭</button>
      <span class="spacer"></span>
      <button type="button" class="btn primary" :disabled="saving" @click="persist">{{ saving ? "保存中…" : "保存到当前版本" }}</button>
    </template>
  </Drawer>
</template>

<style scoped>
.dict-layout {
  display: grid;
  grid-template-columns: 230px minmax(0, 1fr);
  gap: 12px;
  align-items: start;
}
.dict-list {
  display: grid;
  gap: 4px;
  max-height: 320px;
  overflow: auto;
}
.dict-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  border: 1px solid transparent;
  background: none;
  text-align: left;
  padding: 7px 9px;
  border-radius: 7px;
  font-size: 12px;
  color: #334155;
  cursor: pointer;
}
.dict-item:hover { background: #f1f5f9; }
.dict-item.on { background: #eef2ff; border-color: #c7d2fe; color: #3730a3; font-weight: 600; }
.dict-item b { font-size: 11px; color: var(--muted); }
.dict-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}
@media (max-width: 900px) {
  .dict-layout { grid-template-columns: 1fr; }
}
</style>
