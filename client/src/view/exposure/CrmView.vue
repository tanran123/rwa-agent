<script setup>
import { ref } from "vue";
import { createCrmRule, deleteCrmRule, deleteCrmRules, fetchCrm, saveCrmRule } from "@/api/exposure";
import { runBatch, useBatchNote, usePick } from "@/composables/usePick";
import AsyncView from "@/components/AsyncView.vue";
import RuleForm from "@/components/RuleForm.vue";
import { askConfirm } from "@/utils/confirm";

const substitute = {
  collateral: "覆盖部分取质物权重",
  guarantor: "覆盖部分取保证人权重",
  provider: "覆盖部分取保护提供方权重"
};
const form = ref(null);
const error = ref("");
const saving = ref(false);
const view = ref(null);
const pick = usePick();
const batch = useBatchNote();

function create() {
  error.value = "";
  form.value = {
    creating: true,
    id: "",
    type: "",
    tool: "",
    substitute: "collateral",
    floorParam: "",
    pri: 0,
    constraints: { maturity: false, currency: false, correlation: false }
  };
}

function edit(row) {
  error.value = "";
  const flags = row.constraints || {};
  form.value = {
    creating: false,
    id: row.id,
    type: row.type,
    tool: row.tool,
    substitute: row.substitute,
    floorParam: row.floorParam || "",
    pri: row.pri,
    constraints: {
      maturity: !!flags.maturity,
      currency: !!flags.currency,
      correlation: !!flags.correlation
    }
  };
}

function payload(row) {
  return {
    id: row.id,
    type: row.type,
    tool: row.tool,
    substitute: row.substitute,
    floorParam: row.floorParam,
    pri: Number(row.pri),
    constraints: row.constraints
  };
}

async function refresh() {
  if (view.value) await view.value.reload();
}

async function save() {
  error.value = "";
  saving.value = true;
  try {
    const body = payload(form.value);
    if (form.value.creating) await createCrmRule(body);
    else await saveCrmRule(form.value.id, body);
    form.value = null;
    await refresh();
  } catch (err) {
    error.value = err.message;
  } finally {
    saving.value = false;
  }
}

async function remove() {
  const yes = await askConfirm("删除缓释规则「" + form.value.type + "」。", {
    title: "删除缓释规则",
    confirmText: "删除",
    danger: true
  });
  if (!yes) return;
  error.value = "";
  saving.value = true;
  try {
    await deleteCrmRule(form.value.id);
    form.value = null;
    await refresh();
  } catch (err) {
    error.value = err.message;
  } finally {
    saving.value = false;
  }
}

async function removeSelected(rows) {
  const result = await runBatch(pick, rows, "id", deleteCrmRules, batch, form, (row) => row.id);
  if (result) await refresh();
}
</script>

<template>
  <p v-if="batch.state.text" class="notice" :class="batch.state.kind">{{ batch.state.text }}</p>
  <AsyncView ref="view" :load="fetchCrm">
    <template #default="{ data }">
      <div class="panel">
        <div class="panel-head">
          <h3>缓释工具</h3>
          <span class="sub">{{ data.length }} 条</span>
          <span class="spacer"></span>
          <button type="button" class="btn sm danger" :disabled="!pick.visibleIds(data).length" @click="removeSelected(data)">删除所选</button>
          <button type="button" class="btn sm primary" @click="create">新建</button>
        </div>
        <div class="panel-body tight">
          <table class="tbl compact">
            <thead>
              <tr>
                <th class="pick" @click.stop><input type="checkbox" :checked="pick.allOn(data)" @change="pick.toggleAll(data)" /></th>
                <th>类型</th><th>合格工具</th><th>覆盖部分</th><th>不计入</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in data" :key="row.id" class="clickable" @click="edit(row)">
                <td class="pick" @click.stop><input type="checkbox" :checked="pick.on(row.id)" @change="pick.toggle(row.id)" /></td>
                <td>{{ row.type }}</td>
                <td>{{ row.tool }}</td>
                <td>{{ substitute[row.substitute] || row.substitute }}</td>
                <td>
                  <span v-if="row.constraints.maturity">期限 </span>
                  <span v-if="row.constraints.currency">币种 </span>
                  <span v-if="row.constraints.correlation">相关 </span>
                  <span v-if="row.floorParam">底线 {{ row.floorParam }}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </AsyncView>
  <RuleForm
    :open="!!form"
    :title="form && form.creating ? '新建缓释规则' : '编辑缓释规则'"
    :error="error"
    :saving="saving"
    :creating="!!(form && form.creating)"
    @close="form = null"
    @save="save"
    @remove="remove"
  >
    <template v-if="form">
      <label class="field">编号
        <input v-model="form.id" type="text" :disabled="!form.creating" />
      </label>
      <label class="field">优先级
        <input v-model="form.pri" type="number" />
      </label>
      <label class="field">类型
        <input v-model="form.type" type="text" />
      </label>
      <label class="field">覆盖部分
        <select v-model="form.substitute">
          <option v-for="(label, key) in substitute" :key="key" :value="key">{{ label }}</option>
        </select>
      </label>
      <label class="field">底线参数
        <input v-model="form.floorParam" type="text" />
      </label>
      <label class="field full">合格工具
        <textarea v-model="form.tool"></textarea>
      </label>
      <label class="checkline"><input v-model="form.constraints.maturity" type="checkbox" /> 期限不计入</label>
      <label class="checkline"><input v-model="form.constraints.currency" type="checkbox" /> 币种不计入</label>
      <label class="checkline"><input v-model="form.constraints.correlation" type="checkbox" /> 相关不计入</label>
    </template>
  </RuleForm>
</template>
