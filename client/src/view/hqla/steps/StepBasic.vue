<script setup>
import { computed, ref, watch } from "vue";
import { updateTask } from "@/api/hqla";

const props = defineProps({ task: Object, meta: Object, reload: Function });
const saving = ref(false);
const error = ref("");
const form = ref(blank());

const SIDE_LABEL = { ASSET: "资产端", INFLOW: "现金流入", OUTFLOW: "现金流出" };
const SIDE_ORDER = ["ASSET", "INFLOW", "OUTFLOW"];

function blank() {
  const cfg = (props.task && props.task.cfg) || {};
  return {
    name: (props.task && props.task.name) || "",
    baseDate: (props.task && props.task.baseDate) || "",
    institution: (props.task && props.task.institution) || "",
    version: cfg.ruleVersion || "",
    jurisdiction: cfg.jurisdiction || "HK"
  };
}

const versions = computed(() => ((props.meta && props.meta.versions) || []).filter((item) => item.productCount > 0));
const products = computed(() => (props.meta && props.meta.products) || []);
const snapshot = computed(() => {
  const saved = props.meta && props.meta.meta && props.meta.meta.snapshot;
  if (saved && Object.keys(saved).length) return saved;
  const version = form.value.version || "—";
  return {
    rule_set: props.meta && props.meta.meta ? props.meta.meta.lcrVersion : version,
    product_config: "PRODUCTS-" + version,
    field_dictionary: "FIELDS-" + version,
    parameter: "PARAM-" + version,
    engine: "RULE-ENGINE-1.4.2"
  };
});

const locked = computed(() => !!(props.task && props.task.cfg && props.task.cfg.snapshotLockedAt));

function grouped(side) {
  return products.value.filter((product) => product.side === side);
}

async function save() {
  if (saving.value) return;
  error.value = "";
  if (!form.value.version) { error.value = "请选择监管规则版本"; return; }
  const version = versions.value.find((item) => item.version === form.value.version);
  saving.value = true;
  try {
    const cfg = {
      ...((props.task && props.task.cfg) || {}),
      domain: "LCR",
      jurisdiction: version ? version.jurisdiction : form.value.jurisdiction,
      ruleVersion: form.value.version,
      lcrVersion: version ? version.lcrVersion : "",
      snapshot: snapshot.value,
      snapshotLockedAt: (props.task.cfg && props.task.cfg.snapshotLockedAt) || new Date().toISOString().slice(0, 19).replace("T", " ")
    };
    await updateTask(props.task.id, {
      name: form.value.name,
      baseDate: form.value.baseDate,
      institution: form.value.institution,
      status: props.task.status === "draft" ? "doing" : props.task.status,
      config: cfg
    });
    await props.reload();
  } catch (err) {
    error.value = err.message;
  } finally {
    saving.value = false;
  }
}

watch(() => props.task, () => { form.value = blank(); }, { deep: false });
</script>

<template>
  <p v-if="error" class="notice danger">{{ error }}</p>

  <div class="panel">
    <div class="panel-head"><h3>任务基本信息</h3><span class="sub">第 1 步 · 确认后本任务锁定规则版本与快照</span></div>
    <div class="panel-body">
      <div class="grid c2">
        <div class="field"><label>任务名称</label><input v-model="form.name" type="text" /></div>
        <div class="field"><label>监管计量领域</label><input value="LCR 流动性覆盖率" disabled /></div>
        <div class="field"><label>计量期间</label><input v-model="form.baseDate" type="date" /></div>
        <div class="field">
          <label>监管规则版本</label>
          <select v-model="form.version">
            <option v-for="item in versions" :key="item.version" :value="item.version">
              {{ item.version }}（{{ item.lcrVersion || "未导入 LCR 规则" }}）
            </option>
          </select>
        </div>
        <div class="field"><label>机构</label><input v-model="form.institution" type="text" /></div>
        <div class="field">
          <label>规则版本状态</label>
          <input :value="locked ? '已锁定' : '待确认'" disabled />
        </div>
      </div>
      <p class="dim" style="font-size: 11.5px; margin-top: 8px">
        规则版本按计量基准日与监管适用要求选择，不默认取最新；保存后本任务锁定该版本。
      </p>
      <div style="margin-top: 12px">
        <button type="button" class="btn primary" :disabled="saving" @click="save">
          {{ saving ? "保存中…" : "保存并锁定版本" }}
        </button>
      </div>
    </div>
  </div>

  <div class="grid c2">
    <div class="panel">
      <div class="panel-head"><h3>版本快照</h3><span class="sub">锁定后不可变</span></div>
      <div class="panel-body tight">
        <table class="tbl">
          <thead><tr><th>组成</th><th>版本</th></tr></thead>
          <tbody>
            <tr><td>规则集</td><td class="mono small">{{ snapshot.rule_set }}</td></tr>
            <tr><td>产品定义</td><td class="mono small">{{ snapshot.product_config }}</td></tr>
            <tr><td>字段字典</td><td class="mono small">{{ snapshot.field_dictionary }}</td></tr>
            <tr><td>码值字典</td><td class="mono small">{{ snapshot.code_dictionary || "DICT-" + form.version }}</td></tr>
            <tr><td>参数表</td><td class="mono small">{{ snapshot.parameter }}</td></tr>
            <tr><td>规则引擎</td><td class="mono small">{{ snapshot.engine || "RULE-ENGINE-1.4.2" }}</td></tr>
          </tbody>
        </table>
        <p class="dim" style="font-size: 11.5px; padding: 8px 10px 0">六项快照一起锁定；后续配置调整不影响本任务。</p>
      </div>
    </div>
    <div class="panel">
      <div class="panel-head"><h3>本次适用产品范围</h3><span class="sub">只读预览 · {{ products.length }} 个产品</span></div>
      <div class="panel-body tight">
        <table class="tbl">
          <thead><tr><th>侧别</th><th>产品</th><th class="num">标准字段</th></tr></thead>
          <tbody>
            <template v-for="side in SIDE_ORDER" :key="side">
              <tr v-for="product in grouped(side)" :key="product.code">
                <td class="small">{{ SIDE_LABEL[side] }}</td>
                <td>{{ product.name }}<div class="mono dim" style="font-size: 10.5px">{{ product.code }}</div></td>
                <td class="num mono">{{ (product.fields || []).length }}</td>
              </tr>
            </template>
          </tbody>
        </table>
        <p class="dim" style="font-size: 11.5px; padding: 8px 10px 0">产品由规则版本与数据识别决定，不在此处逐个配置。</p>
      </div>
    </div>
  </div>
</template>
