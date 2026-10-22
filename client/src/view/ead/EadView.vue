<script setup>
import { computed, nextTick, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { fetchEadConfig, saveEadConfig, trialEad } from "@/api/ead";
import { sendAgentChat } from "@/api/agent";
import AsyncView from "@/components/AsyncView.vue";
import Drawer from "@/components/Drawer.vue";

const props = defineProps({ side: { type: String, default: "on" } });
const route = useRoute();
const view = ref(null);
const loaded = ref(null);
const pageError = ref("");
const pageMessage = ref("");
const saving = ref(false);

const chatEl = ref(null);
const shown = ref([]);
const text = ref("");
const sending = ref(false);
const draft = ref(null);

const trial = ref(null);
const trialProduct = ref("");
const trialView = ref(null);
const trialInputs = ref({});
const trialError = ref("");

const ruleCount = computed(() => {
  const list = loaded.value && loaded.value.config ? loaded.value.config.products : [];
  return (list || []).reduce((total, item) => total + ((item.rules || []).length), 0);
});

async function load() {
  const data = await fetchEadConfig(props.side);
  loaded.value = data;
  return data;
}

function jsonOf(value) {
  return JSON.stringify(value, null, 2);
}

function productOf(products, code) {
  return (products || []).find((item) => item.code === code) || null;
}

function labelOf(products, code) {
  const product = productOf(products, code);
  return product ? product.label : code + "（库里没有）";
}

function fieldText(products, code, stdField) {
  const product = productOf(products, code);
  const field = product ? (product.fields || []).find((item) => item.stdField === stdField) : null;
  return field ? field.name + "（" + stdField + "）" : stdField;
}

function ccfText(value) {
  if (value == null || value === "") return "—";
  const number = Number(value);
  if (Number.isNaN(number)) return String(value);
  return (number * 100).toFixed(0) + "%";
}

function statusText(status) {
  return status === "published" ? "已发布" : "草稿";
}

function reveal() {
  nextTick(() => {
    if (chatEl.value) chatEl.value.scrollTop = chatEl.value.scrollHeight;
  });
}

function onKey(event) {
  if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
  event.preventDefault();
  send();
}

async function send() {
  const content = text.value.trim();
  if (!content || sending.value || !loaded.value) return;
  text.value = "";
  draft.value = null;
  pageError.value = "";
  pageMessage.value = "";
  const pending = { role: "assistant", text: "正在交给智能体…", pending: true };
  shown.value = [...shown.value, { role: "user", text: content }, pending];
  sending.value = true;
  reveal();
  try {
    const messages = shown.value
      .filter((item) => item.text && !item.pending)
      .map((item) => ({ role: item.role, content: item.text }))
      .slice(-8);
    const data = await sendAgentChat(route.path, messages, loaded.value.config);
    pending.text = (data && data.reply) || "没有返回";
    if (data && data.draft) draft.value = data.draft;
  } catch (err) {
    pending.text = err.message || "这次没有问成";
    pending.fail = true;
  } finally {
    pending.pending = false;
    shown.value = shown.value.slice();
    sending.value = false;
    reveal();
  }
}

async function save() {
  if (!draft.value || saving.value) return;
  saving.value = true;
  pageError.value = "";
  pageMessage.value = "";
  try {
    loaded.value = await saveEadConfig(props.side, draft.value);
    draft.value = null;
    pageMessage.value = "配置已写入文件";
    if (view.value) await view.value.reload();
  } catch (err) {
    pageError.value = err.message;
  } finally {
    saving.value = false;
  }
}

function drop() {
  draft.value = null;
  pageMessage.value = "已丢弃草稿，配置文件没有改";
}

async function runTrial(code, rule) {
  pageError.value = "";
  if (!code) {
    pageError.value = "这个产品没有 code，不能试算";
    return;
  }
  // 配置里规则挂在自己的产品下，不带 productCodes；试算要按 computeEad 的口径补上。
  const shaped = { ...rule, productCodes: [code] };
  trial.value = shaped;
  trialProduct.value = code;
  trialView.value = null;
  trialError.value = "";
  try {
    const data = await trialEad({ product: code, side: props.side, rule: shaped });
    trialInputs.value = data.inputs;
    trialView.value = data;
  } catch (err) {
    trialError.value = err.message;
  }
}

async function rerun() {
  if (!trial.value) return;
  trialError.value = "";
  try {
    trialView.value = await trialEad({ product: trialProduct.value, side: props.side, rule: trial.value, std: trialInputs.value });
  } catch (err) {
    trialError.value = err.message;
  }
}

watch(() => props.side, () => {
  loaded.value = null;
  shown.value = [];
  text.value = "";
  draft.value = null;
  trial.value = null;
  trialProduct.value = "";
  trialView.value = null;
  pageError.value = "";
  pageMessage.value = "";
});
</script>

<template>
  <AsyncView :key="side" ref="view" :load="load">
    <template #default="{ data }">
      <div class="notice info">
        <span class="ni">ℹ</span>
        <div>
          这是{{ side === "on" ? "表内" : "表外" }} EAD 的计算配置。一个产品一份规则，规则只能引用该产品自己的标准字段。
          产品名和标准字段清单都从库里读（<span class="mono">product_type</span>、<span class="mono">product_field</span>），
          配置文件只写产品 code 和标准字段名。改配置走页面下方的对话，确认后才写文件。
        </div>
      </div>
      <div v-if="pageError" class="notice danger"><span class="ni">!</span><div>{{ pageError }}</div></div>
      <div v-if="pageMessage" class="notice ok"><span class="ni">✓</span><div>{{ pageMessage }}</div></div>
      <div v-if="data.issues.length" class="notice warn">
        <span class="ni">!</span>
        <div>配置与库里的产品/标准字段对不上：{{ data.issues.join("；") }}</div>
      </div>

      <div class="panel">
        <div class="panel-head">
          <h3>{{ data.config.name }}</h3>
          <span class="sub">规则版本 {{ data.config.version }} · {{ data.config.products.length }} 个产品 · {{ ruleCount }} 条规则</span>
        </div>
        <div class="panel-body tight">
          <div v-if="!data.config.products.length" class="empty">这份配置里还没有产品</div>
          <table v-else class="tbl compact">
            <thead>
              <tr>
                <th>产品（来自库）</th>
                <th>产品 code</th>
                <th>标准字段</th>
                <th>规则</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in data.config.products" :key="item.code">
                <td>{{ labelOf(data.products, item.code) }}</td>
                <td class="mono">{{ item.code }}</td>
                <td class="dim">
                  {{ (productOf(data.products, item.code) ? productOf(data.products, item.code).fields.length : 0) }} 个
                </td>
                <td>{{ (item.rules || []).length }} 条</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="panel">
        <div class="panel-head">
          <h3>配置 JSON</h3>
          <span class="sub mono">{{ data.file }}</span>
        </div>
        <div class="panel-body">
          <div class="codeblock">{{ jsonOf(data.config) }}</div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-head">
          <h3>分产品配置</h3>
          <span class="sub">标准字段清单来自 product_field，规则只能引用本产品的字段</span>
        </div>
        <div class="panel-body">
          <div v-for="item in data.config.products" :key="item.code" class="panel" style="margin-bottom: 14px">
            <div class="panel-head">
              <h3>{{ labelOf(data.products, item.code) }}</h3>
              <span class="sub mono">{{ item.code }}</span>
              <span class="spacer"></span>
              <span class="sub">{{ (item.rules || []).length }} 条规则</span>
            </div>

            <div class="panel-body">
              <div class="cond-group-label">该产品的标准字段（product_field）</div>
              <div v-if="!productOf(data.products, item.code) || !productOf(data.products, item.code).fields.length" class="empty">
                库里没有这个产品的标准字段
              </div>
              <table v-else class="tbl compact">
                <thead><tr><th>标准字段</th><th>中文名</th><th>本配置用到了</th></tr></thead>
                <tbody>
                  <tr v-for="field in productOf(data.products, item.code).fields" :key="field.stdField">
                    <td class="mono">{{ field.stdField }}</td>
                    <td>{{ field.name }}</td>
                    <td>
                      <span
                        v-if="(item.rules || []).some((rule) => (rule.inputs || []).includes(field.stdField))"
                        class="tag ok"
                      >✓</span>
                      <span v-else class="dim">—</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div v-for="rule in item.rules" :key="rule.id" class="panel-body">
              <div class="cond-group-label">{{ rule.id }} · {{ rule.name }}</div>
              <div class="kv">
                <div class="k">输入字段</div>
                <div class="v">
                  {{ (rule.inputs || []).map((std) => fieldText(data.products, item.code, std)).join("、") }}
                </div>
                <div class="k">计算公式</div><div class="v mono">{{ rule.formula }}</div>
                <div v-if="side === 'off'" class="k">信用转换系数</div>
                <div v-if="side === 'off'" class="v">{{ ccfText(rule.ccf) }}</div>
                <div class="k">适用条件</div><div class="v">{{ rule.condition }}</div>
                <div class="k">计算精度</div><div class="v">{{ rule.precision }} 位小数 · {{ rule.rounding }}</div>
                <div class="k">结果字段</div><div class="v mono">{{ rule.resultField }}</div>
                <div class="k">关联监管条款</div><div class="v">{{ rule.clause }}</div>
                <div class="k">状态</div>
                <div class="v"><span class="tag" :class="rule.status === 'published' ? 'ok' : 'muted'">{{ statusText(rule.status) }}</span></div>
              </div>
              <div v-if="rule.steps && rule.steps.length" style="margin-top: 8px">
                <div v-for="(step, index) in rule.steps" :key="index" class="step-line">
                  <span class="sl-n">{{ index + 1 }}</span>
                  <div class="sl-b">{{ step }}</div>
                </div>
              </div>
              <div v-if="rule.params && rule.params.length" class="panel-body tight">
                <table class="tbl compact">
                  <thead><tr><th>参数</th><th>取值</th><th>依据</th></tr></thead>
                  <tbody>
                    <tr v-for="param in rule.params" :key="param.name">
                      <td>{{ param.name }}</td>
                      <td class="mono">{{ param.value }}</td>
                      <td class="dim">{{ param.basis }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div class="btn-group" style="margin-top: 8px">
                <button type="button" class="btn sm" @click="runTrial(item.code, rule)">用模拟债项试算</button>
              </div>
            </div>

            <div v-if="!item.rules || !item.rules.length" class="panel-body">
              <div class="empty">这个产品还没有配置计算规则</div>
            </div>
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-head">
          <h3>与智能体对话修订配置</h3>
          <span class="sub">例如：把表外一年以上贷款承诺的 CCF 从 50% 改成 40%</span>
        </div>
        <div class="panel-body">
          <div ref="chatEl" class="chat">
            <div v-if="!shown.length" class="empty">把修订意见发给智能体，它会回一份整份 JSON 草稿，确认后才写文件。</div>
            <div v-for="(turn, index) in shown" :key="index" class="msg" :class="turn.role === 'user' ? 'user' : 'assistant'">
              <div class="mav">{{ turn.role === "user" ? "我" : "AI" }}</div>
              <div class="mb">
                <div v-if="turn.pending"><span class="spin"></span>{{ turn.text }}</div>
                <div v-else>{{ turn.text }}</div>
              </div>
            </div>
          </div>
          <div class="chat-compose">
            <textarea
              v-model="text"
              rows="2"
              placeholder="输入修订意见，回车发送"
              :disabled="sending"
              @keydown="onKey"
            ></textarea>
            <button type="button" class="btn primary" :disabled="sending || !text.trim()" @click="send">发送</button>
          </div>
          <div v-if="draft" style="margin-top: 14px">
            <div class="cond-group-label">智能体给出的修订草稿（还没写进文件）：</div>
            <div class="codeblock">{{ jsonOf(draft) }}</div>
            <div class="btn-group" style="margin-top: 10px">
              <button type="button" class="btn primary" :disabled="saving" @click="save">✓ 确认并保存</button>
              <button type="button" class="btn" @click="drop">丢弃草稿</button>
            </div>
          </div>
        </div>
      </div>
    </template>
  </AsyncView>

  <Drawer :open="!!trial" :title="trial ? '试算 · ' + trial.name : ''" wide @close="trial = null">
    <div v-if="trialError" class="notice danger"><span class="ni">!</span><div>{{ trialError }}</div></div>
    <div v-if="trial && trialView">
      <div class="notice info">
        <span class="ni">ℹ</span>
        <div>试算「{{ trial.name }}」时只取产品 {{ trialProduct }} 的模拟债项，并调用与正式计量相同的计算。</div>
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
          <span class="sub">{{ trialView.samples.length ? "只取该产品的 " + trialView.samples.length + " 笔" : "该产品无匹配债项" }}</span>
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
