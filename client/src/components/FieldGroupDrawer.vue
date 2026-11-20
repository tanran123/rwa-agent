<script setup>
import { ref, watch } from "vue";
import Drawer from "@/components/Drawer.vue";

const props = defineProps({
  open: { type: Boolean, default: false },
  groups: { type: Array, default: () => [] }
});
const emit = defineEmits(["close", "save"]);

const list = ref([]);
const errors = ref([]);
const draft = ref({ id: "", label: "", label_en: "", description: "", order: 999 });

function reset() {
  list.value = (props.groups || []).map((group) => ({
    id: group.id || group.group_id,
    label: group.label || "",
    labelEn: group.labelEn || group.label_en || "",
    description: group.description || "",
    order: typeof group.order === "number" ? group.order : 999,
    total: group.total || group.fieldCount || 0
  })).sort((left, right) => left.order - right.order);
  draft.value = { id: "", label: "", label_en: "", description: "", order: (list.value[list.value.length - 1] || {}).order + 10 || 10 };
  errors.value = [];
}
watch(() => props.open, (open) => { if (open) reset(); });

function addGroup() {
  const next = draft.value;
  const problems = [];
  if (!/^[A-Z][A-Z0-9_]+$/.test(String(next.id || "").trim())) problems.push("分组编码必须匹配 ^[A-Z][A-Z0-9_]+$");
  if (list.value.some((group) => group.id === next.id.trim())) problems.push("分组编码已存在");
  if (!next.label.trim()) problems.push("中文名称不能为空");
  if (!next.label_en.trim()) problems.push("英文名称不能为空");
  errors.value = problems;
  if (problems.length) return;
  list.value.push({
    id: next.id.trim(),
    label: next.label.trim(),
    labelEn: next.label_en.trim(),
    description: String(next.description || "").trim(),
    order: Number(next.order) || 999,
    total: 0
  });
  draft.value = { id: "", label: "", label_en: "", description: "", order: Number(next.order) + 10 || 999 };
  list.value.sort((left, right) => left.order - right.order);
}

function removeGroup(group) {
  if (group.total) {
    errors.value = ["分组「" + group.label + "」还有 " + group.total + " 个字段，移动字段后才能删除"];
    return;
  }
  list.value = list.value.filter((item) => item.id !== group.id);
  errors.value = [];
}

function save() {
  const problems = [];
  const seen = new Set();
  list.value.forEach((group) => {
    if (!group.label.trim()) problems.push(group.id + "：中文名称不能为空");
    if (!group.labelEn.trim()) problems.push(group.id + "：英文名称不能为空");
    if (seen.has(group.id)) problems.push(group.id + "：分组编码重复");
    seen.add(group.id);
    if (!Number.isFinite(Number(group.order))) problems.push(group.id + "：顺序必须是数字");
  });
  errors.value = problems;
  if (problems.length) return;
  emit("save", list.value.map((group) => ({
    id: group.id,
    label: group.label.trim(),
    labelEn: group.labelEn.trim(),
    description: String(group.description || "").trim(),
    order: Number(group.order) || 999
  })).sort((left, right) => left.order - right.order));
}
</script>

<template>
  <Drawer :open="open" wide title="字段所属分组" @close="emit('close')">
    <p v-if="errors.length" class="notice danger"><span class="ni">!</span><div>{{ errors.join("；") }}</div></p>
    <p class="hint">分组编码用于规则和字段引用，创建后不要修改。页面显示中文名称；英文名称用于导出和英文界面。</p>

    <div class="panel">
      <div class="panel-head"><h3>新增分组</h3></div>
      <div class="panel-body">
        <div class="grid c4">
          <div class="field"><label>分组编码</label><input v-model="draft.id" placeholder="如 PRODUCT_TRANSACTION" /></div>
          <div class="field"><label>中文名称</label><input v-model="draft.label" placeholder="如 产品与交易识别" /></div>
          <div class="field"><label>英文名称</label><input v-model="draft.label_en" placeholder="如 Product & Transaction" /></div>
          <div class="field"><label>顺序</label><input v-model.number="draft.order" type="number" /></div>
        </div>
        <div class="field" style="margin-top: 10px"><label>说明</label><input v-model="draft.description" /></div>
        <div class="btn-group" style="margin-top: 10px">
          <button type="button" class="btn sm primary" @click="addGroup">＋ 添加分组</button>
        </div>
      </div>
    </div>

    <div class="panel" style="margin-top: 10px">
      <div class="panel-head"><h3>分组清单</h3><span class="sub">{{ list.length }} 个分组</span></div>
      <div class="panel-body tight">
        <div class="table-wrap">
          <table class="tbl compact">
            <thead><tr><th style="width: 190px">分组编码</th><th>中文名称</th><th>英文名称</th><th style="width: 90px">顺序</th><th style="width: 70px">字段数</th><th style="width: 64px">操作</th></tr></thead>
            <tbody>
              <tr v-for="group in list" :key="group.id">
                <td class="mono small">{{ group.id }}</td>
                <td><input v-model="group.label" type="text" /></td>
                <td><input v-model="group.labelEn" type="text" /></td>
                <td><input v-model.number="group.order" type="number" /></td>
                <td class="num">{{ group.total }}</td>
                <td><button type="button" class="btn sm danger" :disabled="group.total > 0" :title="group.total > 0 ? '有字段引用，不能删除' : ''" @click="removeGroup(group)">删除</button></td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-if="!list.length" class="dim" style="padding: 14px">还没有分组。</p>
      </div>
    </div>

    <template #footer>
      <button type="button" class="btn" @click="emit('close')">取消</button>
      <span class="spacer"></span>
      <button type="button" class="btn primary" @click="save">保存分组</button>
    </template>
  </Drawer>
</template>
