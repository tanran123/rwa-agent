<script setup>
import { computed, ref, watch } from "vue";
import { createEadRule, fetchEadRules, trialEad, updateEadRule } from "@/api/ead";
import { fetchProducts } from "@/api/product";
import AsyncView from "@/components/AsyncView.vue";
import Drawer from "@/components/Drawer.vue";

const props = defineProps({ side: { type: String, default: "on" } });
const view = ref(null);
const code = ref("");
const rules = ref([]);
const products = ref([]);
const form = ref(null);
const detail = ref(null);
const trial = ref(null);
const trialInputs = ref({});
const trialView = ref(null);
const pageError = ref("");
const pageMessage = ref("");
const formError = ref("");
const busy = ref(false);

const product = computed(() => products.value.find((item) => item.code === code.value) || null);
const shown = computed(() => rules.value.filter((rule) => applies(rule, code.value)));

function applies(rule, productCode) {
  if (!rule || !productCode) return false;
  if (Array.isArray(rule.productCodes) && rule.productCodes.length) return rule.productCodes.includes(productCode);
  const meta = products.value.find((item) => item.code === productCode);
  return !!(meta && Array.isArray(rule.products) && rule.products.includes(meta.label));
}

function countOf(productCode) {
  return rules.value.filter((rule) => applies(rule, productCode)).length;
}

function statusText(status) {
  return status === "published" ? "已发布" : "草稿";
}

function ccfText(value) {
  if (value == null || value === "") return "—";
  const number = Number(value);
  if (Number.isNaN(number)) return String(value);
  return (number * 100).toFixed(0) + "%";
}

async function load() {
  const [ruleRows, productRows] = await Promise.all([
    fetchEadRules(props.side),
    fetchProducts()
  ]);
  rules.value = ruleRows;
  products.value = productRows;
  if (!code.value) {
    const withRules = productRows.find((item) => ruleRows.some((rule) => applies(rule, item.code)));
    const first = withRules || productRows[0];
    if (first) code.value = first.code;
  }
  return true;
}

function pick(productCode) {
  code.value = productCode;
  form.value = null;
  detail.value = null;
  trial.value = null;
  trialView.value = null;
  pageError.value = "";
  pageMessage.value = "";
}

function blank() {
  const item = product.value;
  const inputs = props.side === "on"
    ? ["债项余额(balance)", "减值准备(impairment)"]
    : ["表外未提用金额(offbalance_amount)", "信用转换系数(ccf)"];
  return {
    name: item ? item.label + "新建规则" : "",
    products: item ? [item.label] : [],
    productCodes: code.value ? [code.value] : [],
    version: item ? item.ruleVersion : "",
    status: "draft",
    inputsText: inputs.join("、"),
    formula: props.side === "on" ? "EAD = 债项余额 − 减值准备" : "EAD = 表内已提用金额 + 表外未提用金额 × CCF",
    stepsText: "",
    condition: item ? "仅适用于" + item.label : "",
    precision: 2,
    rounding: "四舍五入",
    resultField: props.side === "on" ? "on_balance_ead" : "off_balance_ead",
    clause: props.side === "on" ? "CL-MO-060" : "CL-MO-064",
    ccf: 0.2,
    params: [],
    isNew: true
  };
}

function openCreate() {
  if (!product.value) return;
  detail.value = null;
  trial.value = null;
  formError.value = "";
  form.value = blank();
}

function openEdit(rule) {
  detail.value = null;
  trial.value = null;
  formError.value = "";
  form.value = {
    ...rule,
    inputsText: (rule.inputs || []).join("、"),
    stepsText: (rule.steps || []).join("\n"),
    params: rule.params || [],
    isNew: false
  };
}

function payload(source) {
  return {
    side: props.side,
    name: source.name,
    products: source.products,
    productCodes: source.productCodes,
    version: source.version,
    status: source.status,
    inputs: String(source.inputsText || "").split(/[、,，]/).map((item) => item.trim()).filter(Boolean),
    formula: source.formula,
    steps: String(source.stepsText || "").split("\n").map((item) => item.trim()).filter(Boolean),
    condition: source.condition,
    precision: source.precision,
    rounding: source.rounding,
    resultField: source.resultField,
    clause: source.clause,
    params: source.params || [],
    ccf: props.side === "off" ? source.ccf : null
  };
}

async function save() {
  if (!form.value) return;
  formError.value = "";
  busy.value = true;
  try {
    const body = payload(form.value);
    if (form.value.isNew) await createEadRule(body);
    else await updateEadRule(form.value.id, body);
    form.value = null;
    pageMessage.value = "规则已保存";
    if (view.value) await view.value.reload();
  } catch (err) {
    formError.value = err.message;
  } finally {
    busy.value = false;
  }
}

async function copy(rule) {
  if (!product.value) return;
  pageError.value = "";
  pageMessage.value = "";
  try {
    await createEadRule({
      ...payload({
        ...rule,
        inputsText: (rule.inputs || []).join("、"),
        stepsText: (rule.steps || []).join("\n")
      }),
      name: rule.name + "（副本）",
      status: "draft",
      products: [product.value.label],
      productCodes: [code.value]
    });
    pageMessage.value = "已复制为草稿";
    if (view.value) await view.value.reload();
  } catch (err) {
    pageError.value = err.message;
  }
}

async function runTrial(rule, std) {
  trial.value = rule;
  detail.value = null;
  form.value = null;
  pageError.value = "";
  try {
    const data = await trialEad({ product: code.value, side: props.side, rule, std: std || null });
    if (!std) trialInputs.value = data.inputs;
    trialView.value = data;
  } catch (err) {
    pageError.value = err.message;
    trial.value = null;
  }
}

async function rerun() {
  if (!trial.value) return;
  pageError.value = "";
  try {
    await runTrial(trial.value, trialInputs.value);
  } catch (err) {
    pageError.value = err.message;
  }
}

watch(() => props.side, () => {
  code.value = "";
  form.value = null;
  detail.value = null;
  trial.value = null;
  trialView.value = null;
  pageError.value = "";
  pageMessage.value = "";
});
</script>

<template>
  <AsyncView :key="side" ref="view" :load="load">
    <template #default>
      <div class="notice info">
        <span class="ni">ℹ</span>
        <div>{{ side === "on" ? "表内" : "表外" }} EAD 按产品维护。先点选产品，再查看规则和试算。未选择产品时不计算。</div>
      </div>
      <div class="section-tabs">
        <button
          v-for="item in products"
          :key="item.code"
          type="button"
          class="section-tab"
          :class="{ active: code === item.code }"
          @click="pick(item.code)"
        >{{ item.label }}（{{ countOf(item.code) }}）</button>
      </div>
      <div v-if="pageError" class="notice danger"><span class="ni">!</span><div>{{ pageError }}</div></div>
      <div v-if="pageMessage" class="notice ok"><span class="ni">✓</span><div>{{ pageMessage }}</div></div>
      <div v-if="!code" class="notice warn">
        <span class="ni">!</span>
        <div>请先选择产品。选择后才会列出该产品的规则。计算只匹配这个产品已发布的规则。</div>
      </div>
      <div v-else class="panel">
        <div class="panel-head">
          <h3>{{ product.label }} · {{ side === "on" ? "表内" : "表外" }}规则</h3>
          <span class="spacer"></span>
          <button type="button" class="btn primary sm" @click="openCreate">新增规则</button>
        </div>
        <div class="panel-body tight">
          <div v-if="!shown.length" class="empty">该产品还没有{{ side === "on" ? "表内" : "表外" }} EAD 规则</div>
          <table v-else class="tbl compact">
            <thead>
              <tr>
                <th>编号</th>
                <th>名称</th>
                <th>公式</th>
                <th v-if="side === 'off'">CCF</th>
                <th>状态</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="rule in shown" :key="rule.id" class="clickable" :class="{ sel: (detail && detail.id === rule.id) || (trial && trial.id === rule.id) }" @click="detail = rule">
                <td class="mono">{{ rule.id }}</td>
                <td>{{ rule.name }}</td>
                <td class="mono">{{ rule.formula }}</td>
                <td v-if="side === 'off'"><span class="tag brand">{{ ccfText(rule.ccf) }}</span></td>
                <td><span class="tag" :class="rule.status === 'published' ? 'ok' : 'muted'">{{ statusText(rule.status) }}</span></td>
                <td>
                  <button type="button" class="btn sm" @click.stop="runTrial(rule)">试算</button>
                  <button type="button" class="btn sm" @click.stop="openEdit(rule)">编辑</button>
                  <button type="button" class="btn sm" @click.stop="copy(rule)">复制</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </AsyncView>

  <Drawer :open="!!detail" :title="detail ? 'EAD 计算规则 · ' + detail.name : ''" wide @close="detail = null">
    <div v-if="detail" class="panel">
      <div class="panel-body">
        <div class="kv">
          <div class="k">规则编号</div><div class="v mono">{{ detail.id }}</div>
          <div class="k">计算规则名称</div><div class="v">{{ detail.name }}</div>
          <div class="k">适用产品</div><div class="v">{{ (detail.products || []).join("、") }}</div>
          <div class="k">监管规则版本</div><div class="v">{{ detail.version }}</div>
          <div class="k">输入字段</div><div class="v">{{ (detail.inputs || []).join("、") }}</div>
          <div class="k">计算公式</div><div class="v mono">{{ detail.formula }}</div>
          <div class="k">适用条件</div><div class="v">{{ detail.condition }}</div>
          <div class="k">计算精度</div><div class="v">{{ detail.precision }} 位小数</div>
          <div class="k">舍入规则</div><div class="v">{{ detail.rounding }}</div>
          <div class="k">结果字段</div><div class="v mono">{{ detail.resultField }}</div>
          <div class="k">关联监管条款</div><div class="v">{{ detail.clause }}</div>
          <div class="k">状态</div><div class="v">{{ statusText(detail.status) }}</div>
        </div>
      </div>
    </div>
    <div v-if="detail && detail.steps && detail.steps.length" class="panel">
      <div class="panel-head"><h3>计算步骤</h3></div>
      <div class="panel-body">
        <div v-for="(step, index) in detail.steps" :key="index" class="step-line">
          <span class="sl-n">{{ index + 1 }}</span>
          <div class="sl-b">{{ step }}</div>
        </div>
      </div>
    </div>
    <div v-if="detail && detail.params && detail.params.length" class="panel">
      <div class="panel-head"><h3>参数及取值依据</h3></div>
      <div class="panel-body tight">
        <table class="tbl compact">
          <thead><tr><th>参数</th><th>取值</th><th>依据</th></tr></thead>
          <tbody>
            <tr v-for="item in detail.params" :key="item.name">
              <td>{{ item.name }}</td>
              <td class="mono">{{ item.value }}</td>
              <td class="dim">{{ item.basis }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
    <template v-if="detail" #footer>
      <button type="button" class="btn" @click="runTrial(detail)">用模拟数据试算</button>
      <button type="button" class="btn primary" @click="openEdit(detail)">编辑</button>
    </template>
  </Drawer>

  <Drawer :open="!!form" :title="form ? (form.isNew ? '新增 EAD 计算规则' : '编辑 EAD 规则 · ' + form.name) : ''" wide @close="form = null">
    <div v-if="form">
      <div class="notice info">
        <span class="ni">ℹ</span>
        <div>保存后写入当前库。试算和正式计量都按公式是否包含「减值」「已提用」决定扣减和叠加，不会把公式当成另一套计算器。</div>
      </div>
      <div v-if="formError" class="notice danger"><span class="ni">!</span><div>{{ formError }}</div></div>
      <div class="grid c2">
        <label class="field">计算规则名称
          <input v-model="form.name" type="text" />
        </label>
        <label class="field">适用产品
          <input type="text" :value="product ? product.label : ''" disabled />
          <div class="hint">本规则属于当前所选产品。换产品请先在页面上重新选择。多产品共用的规则，编辑时不会改适用产品。</div>
        </label>
        <label class="field">监管规则版本
          <input v-model="form.version" type="text" />
        </label>
        <label class="field">状态
          <select v-model="form.status">
            <option value="draft">草稿</option>
            <option value="published">已发布</option>
          </select>
        </label>
        <label v-if="side === 'off'" class="field">信用转换系数 CCF（0.2 = 20%）
          <input v-model="form.ccf" type="number" step="0.05" />
        </label>
        <label class="field">计算精度（小数位）
          <input v-model="form.precision" type="number" />
        </label>
        <label class="field">舍入规则
          <input v-model="form.rounding" type="text" />
        </label>
        <label class="field">结果字段定义
          <input v-model="form.resultField" type="text" />
        </label>
        <label class="field">关联监管条款
          <input v-model="form.clause" type="text" />
        </label>
        <label class="field" style="grid-column: 1 / -1">计算公式
          <input v-model="form.formula" type="text" />
        </label>
        <label class="field" style="grid-column: 1 / -1">输入字段（用「、」分隔）
          <input v-model="form.inputsText" type="text" />
        </label>
        <label class="field" style="grid-column: 1 / -1">适用条件
          <input v-model="form.condition" type="text" />
        </label>
        <label class="field" style="grid-column: 1 / -1">计算步骤（每行一步）
          <textarea v-model="form.stepsText"></textarea>
        </label>
      </div>
    </div>
    <template v-if="form" #footer>
      <button type="button" class="btn" @click="form = null">取消</button>
      <button type="button" class="btn primary" :disabled="busy" @click="save">{{ form.isNew ? "新增" : "保存" }}</button>
    </template>
  </Drawer>

  <Drawer :open="!!trial" :title="trial ? '试算 · ' + trial.name : ''" wide @close="trial = null">
    <div v-if="trial && trialView">
      <div class="notice info">
        <span class="ni">ℹ</span>
        <div>当前产品「{{ product ? product.label : "" }}」。试算「{{ trial.name }}」时只取该产品的模拟债项，并调用与正式计量相同的计算。</div>
      </div>
      <p>{{ trialView.hint }}</p>
      <div v-if="trialView.result.error" class="notice danger"><span class="ni">!</span><div>{{ trialView.result.error }}</div></div>
      <div v-else class="grid c2">
        <div class="panel">
          <div class="panel-head"><h3>输入参数（可调整）</h3></div>
          <div class="panel-body">
            <template v-if="side === 'on'">
              <label class="field">账面本金余额
                <input v-model="trialInputs.balance" type="number" step="1000" />
              </label>
              <label class="field">已计提减值准备
                <input v-model="trialInputs.impairment" type="number" step="1000" />
              </label>
            </template>
            <template v-else>
              <label class="field">表内已提用金额
                <input v-model="trialInputs.onbalance_amount" type="number" step="1000" />
              </label>
              <label class="field">表外未提用金额
                <input v-model="trialInputs.offbalance_amount" type="number" step="1000" />
              </label>
              <label class="field">信用转换系数（0.2 = 20%）
                <input v-model="trialInputs.ccf" type="number" step="0.05" />
              </label>
            </template>
            <button type="button" class="btn primary sm" @click="rerun">按这些金额试算</button>
          </div>
        </div>
        <div class="panel">
          <div class="panel-head"><h3>计算结果</h3></div>
          <div class="panel-body tight">
            <table class="tbl compact">
              <tbody>
                <tr v-for="step in trialView.result.steps" :key="step.n">
                  <td>{{ step.n }}. {{ step.label }}</td>
                  <td class="num">{{ step.display }}</td>
                  <td class="dim">{{ step.note }}</td>
                </tr>
              </tbody>
            </table>
            <div class="panel-body">
              <div class="dim">{{ side === "on" ? "表内 EAD" : "表外 EAD" }}</div>
              <div class="k-value">{{ trialView.result.ead }}</div>
              <p class="dim">规则 {{ trialView.result.ruleId }} · {{ trialView.result.formula }}</p>
            </div>
          </div>
        </div>
      </div>
      <div class="panel">
        <div class="panel-head">
          <h3>用当前模拟债项数据试算</h3>
          <span class="sub">{{ trialView.samples.length ? "只取当前产品的 " + trialView.samples.length + " 笔" : "当前产品无匹配债项" }}</span>
        </div>
        <div class="panel-body tight">
          <div v-if="!trialView.samples.length" class="empty">内置模拟债项里没有这个产品的{{ side === "on" ? "表内" : "表外" }}记录。上方参数试算仍可用。</div>
          <table v-else class="tbl compact">
            <thead>
              <tr>
                <th>债项编号</th>
                <th v-if="side === 'on'">余额</th>
                <th v-if="side === 'on'">减值</th>
                <th v-if="side === 'off'">已提用</th>
                <th v-if="side === 'off'">未提用</th>
                <th v-if="side === 'off'">CCF</th>
                <th>EAD</th>
                <th>命中规则</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in trialView.samples" :key="row.id">
                <td class="mono">{{ row.id }}</td>
                <td v-if="side === 'on'" class="num">{{ row.balance }}</td>
                <td v-if="side === 'on'" class="num">{{ row.impairment }}</td>
                <td v-if="side === 'off'" class="num">{{ row.onbalanceAmount }}</td>
                <td v-if="side === 'off'" class="num">{{ row.offbalanceAmount }}</td>
                <td v-if="side === 'off'" class="mono">{{ row.ccf }}</td>
                <td class="num strong">{{ row.error || row.ead }}</td>
                <td class="dim">{{ row.ruleName }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </Drawer>
</template>
