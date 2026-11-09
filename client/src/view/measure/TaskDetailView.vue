<script setup>
import { ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { createSubtask, deleteSubtask, fetchTask, updateSubtask } from "@/api/tasks";
import AsyncView from "@/components/AsyncView.vue";
import { askConfirm } from "@/utils/confirm";

const route = useRoute();
const router = useRouter();
const view = ref(null);
const error = ref("");
const addingModule = ref("");
const subForm = ref({ name: "" });
const editingSub = ref("");
const subEdit = ref({ name: "" });

const MODULES = [
  { key: "capital", label: "资本充足率" },
  { key: "liquidity", label: "流动性" }
];

const TASK_STATUS = {
  draft: { label: "待开始", tone: "muted" },
  doing: { label: "进行中", tone: "warn" },
  done: { label: "已完成", tone: "ok" }
};

async function load() {
  return fetchTask(route.params.id);
}

async function refresh() {
  if (view.value) await view.value.reload();
}

function moduleSubs(task, module) {
  return (task.subs || []).filter((sub) => (sub.module === "liquidity" ? "liquidity" : "capital") === module);
}

function shortMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e8) return (n / 1e8).toFixed(2) + " 亿";
  if (abs >= 1e4) return (n / 1e4).toFixed(2) + " 万";
  return n.toFixed(2);
}

function openAdd(module) {
  error.value = "";
  editingSub.value = "";
  addingModule.value = module;
  subForm.value = { name: "" };
}

async function saveSub(task) {
  error.value = "";
  try {
    await createSubtask(task.id, { name: subForm.value.name, module: addingModule.value });
    addingModule.value = "";
    subForm.value = { name: "" };
    await refresh();
  } catch (err) {
    error.value = err.message;
  }
}

function openSubEdit(sub) {
  error.value = "";
  addingModule.value = "";
  editingSub.value = sub.id;
  subEdit.value = { name: sub.name };
}

async function saveSubEdit(task) {
  error.value = "";
  try {
    await updateSubtask(task.id, editingSub.value, { name: subEdit.value.name });
    editingSub.value = "";
    await refresh();
  } catch (err) {
    error.value = err.message;
  }
}

async function removeSub(task, sub) {
  const ok = await askConfirm(`将删除子任务「${sub.name}」。已归档的计量批次仍保留在结果明细里。确定继续？`, {
    title: "删除子任务",
    danger: true
  });
  if (!ok) return;
  error.value = "";
  try {
    await deleteSubtask(task.id, sub.id);
    await refresh();
  } catch (err) {
    error.value = err.message;
  }
}

function openWizard(task, sub) {
  router.push({ path: "/wizard", query: { task: task.id, sub: sub.id } });
}

function openResults(sub) {
  router.push({ path: "/results", query: { batch: sub.batchId } });
}

function openHqla() {
  router.push("/hqla");
}
</script>

<template>
  <p v-if="error" class="notice danger">{{ error }}</p>

  <AsyncView ref="view" :load="load">
    <template #default="{ data }">
      <div class="panel">
        <div class="panel-head">
          <h3>主任务信息</h3>
          <span class="sub">{{ data.id }}</span>
          <span class="spacer"></span>
          <button type="button" class="btn sm" @click="router.push('/tasks')">返回任务清单</button>
        </div>
        <div class="panel-body">
          <div class="grid c4">
            <div class="field">
              <label>主任务名称</label>
              <div>{{ data.name }}</div>
            </div>
            <div class="field">
              <label>监管规则版本</label>
              <div class="mono">{{ data.version }}</div>
            </div>
            <div class="field">
              <label>机构</label>
              <div>{{ data.institution }}</div>
            </div>
            <div class="field">
              <label>司法管辖区</label>
              <div>{{ data.jurisdiction }}</div>
            </div>
            <div class="field">
              <label>计量基准日</label>
              <div>{{ data.baseDate }}</div>
            </div>
            <div class="field">
              <label>状态</label>
              <div>
                <span class="tag" :class="(TASK_STATUS[data.status] || {}).tone || 'muted'">
                  {{ (TASK_STATUS[data.status] || {}).label || data.status }}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div v-for="module in MODULES" :key="module.key" class="panel">
        <div class="panel-head">
          <h3>{{ module.label }}</h3>
          <span class="sub">{{ moduleSubs(data, module.key).length }} 个子任务</span>
          <span class="spacer"></span>
          <button type="button" class="btn sm primary" @click="openAdd(module.key)">新增子任务</button>
        </div>
        <div class="panel-body tight">
          <div v-if="!moduleSubs(data, module.key).length && addingModule !== module.key" class="empty">
            <div class="ei">▤</div>
            <div>
              {{ module.key === "liquidity"
                ? "还没有流动性子任务。点「新增子任务」登记。"
                : "还没有资本充足率子任务。点「新增子任务」，再进入计量向导。" }}
            </div>
          </div>
          <table v-else class="tbl compact">
            <thead>
              <tr><th>子任务</th><th>状态</th><th class="num">EAD</th><th class="num">RWA</th><th>操作</th></tr>
            </thead>
            <tbody>
              <template v-for="sub in moduleSubs(data, module.key)" :key="sub.id">
                <tr v-if="editingSub !== sub.id">
                  <td>
                    {{ sub.name }}
                    <div class="dim" style="font-size: 10.5px">
                      {{ sub.module === "liquidity" ? "在流动性页签执行" : (sub.batchName || "尚未归档计量批次") }}
                    </div>
                  </td>
                  <td>
                    <span v-if="sub.module === 'liquidity'" class="tag accent">流动性</span>
                    <span v-else class="tag" :class="sub.status === 'archived' ? 'ok' : 'muted'">
                      {{ sub.status === "archived" ? "已归档" : "未计算" }}
                    </span>
                  </td>
                  <td class="num">{{ sub.ead == null ? "—" : shortMoney(sub.ead) }}</td>
                  <td class="num">{{ sub.rwa == null ? "—" : shortMoney(sub.rwa) }}</td>
                  <td>
                    <div style="display: flex; gap: 4px; flex-wrap: wrap">
                      <template v-if="sub.module === 'liquidity'">
                        <button type="button" class="btn sm primary" @click="openHqla">打开流动性任务</button>
                      </template>
                      <template v-else>
                        <button type="button" class="btn sm primary" @click="openWizard(data, sub)">
                          {{ sub.status === "archived" ? "重新计量" : "进入计量" }}
                        </button>
                        <button v-if="sub.batchId" type="button" class="btn sm" @click="openResults(sub)">查看结果</button>
                      </template>
                      <button type="button" class="btn sm" @click="openSubEdit(sub)">编辑</button>
                      <button type="button" class="btn sm danger" @click="removeSub(data, sub)">删除</button>
                    </div>
                  </td>
                </tr>
                <tr v-else>
                  <td colspan="5">
                    <div class="inline-fields" style="padding: 0">
                      <div class="field">
                        <label>子任务名称</label>
                        <input v-model="subEdit.name" type="text" />
                      </div>
                      <button type="button" class="btn sm primary" @click="saveSubEdit(data)">保存</button>
                      <button type="button" class="btn sm" @click="editingSub = ''">取消</button>
                    </div>
                  </td>
                </tr>
              </template>

              <tr v-if="addingModule === module.key">
                <td colspan="5">
                  <div class="inline-fields" style="padding: 0">
                    <div class="field">
                      <label>子任务名称</label>
                      <input
                        v-model="subForm.name"
                        type="text"
                        :placeholder="module.key === 'liquidity' ? '如：HQLA 债务证券测试' : '如：商业银行风险暴露计量'"
                      />
                    </div>
                    <button type="button" class="btn sm primary" @click="saveSub(data)">保存</button>
                    <button type="button" class="btn sm" @click="addingModule = ''">取消</button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </AsyncView>
</template>
