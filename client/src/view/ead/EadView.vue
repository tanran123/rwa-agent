<script setup>
import { computed, nextTick, reactive, ref } from "vue";
import { checkEadFormula, fetchEadConfig, saveEadConfig, trialEad } from "@/api/ead";
import { OP_LABELS } from "@/utils/ruleText";
import AsyncView from "@/components/AsyncView.vue";
import Drawer from "@/components/Drawer.vue";

const OPS = ["+", "−", "×", "÷", "(", ")"];
const FNS = ["max(", "min(", "abs(", "round("];
const COND_OPS = Object.keys(OP_LABELS);

const view = ref(null);
const data = ref(null);
const active = ref("");
const areas = reactive({});
const saving = ref(false);
const pageError = ref("");
const pageMessage = ref("");
const toast = ref("");

const trial = ref(false);
const trialProduct = ref(null);
const trialRule = ref(null);
const trialView = ref(null);
const trialInputs = ref({});
const trialError = ref("");

const product = computed(() => {
  if (!data.value || !data.value.products) return null;
  return data.value.products.find((item) => item.code === active.value) || null;
});

function ping(text) {
  toast.value = text;
  clearTimeout(ping.timer);
  ping.timer = setTimeout(() => { toast.value = ""; }, 2600);
}

/** 从接口拿到的规则补上编辑态字段：_check 决定能不能保存，conditions 一律补成 { all: [] }。 */
function hydrate(cfg) {
  (cfg.products || []).forEach((item) => {
    (item.rules || []).forEach((rule) => {
      rule._check = rule.structured
        ? { ok: true, errors: [], warnings: [], fields: rule.fields || [] }
        : { ok: false, errors: ["这条规则缺少结构化公式，请重新编写并保存。"], warnings: [], fields: [] };
      rule._checking = false;
      if (!rule.conditions || !Array.isArray(rule.conditions.all)) rule.conditions = { all: [] };
      rule.conditions.all.forEach((cond) => {
        if (Array.isArray(cond.match)) cond.match = cond.match.join(",");
        else if (cond.match != null) cond.match = String(cond.match);
      });
    });
  });
  return cfg;
}

async function load() {
  const cfg = hydrate(await fetchEadConfig());
  data.value = cfg;
  if (!active.value || !cfg.products.some((item) => item.code === active.value)) {
    active.value = cfg.products[0] ? cfg.products[0].code : "";
  }
  return cfg;
}

function pick(code) {
  active.value = code;
  pageError.value = "";
  pageMessage.value = "";
}

function statusOf(item) {
  if (!item.needed) return { cls: "muted", text: "无需配置" };
  if (!item.side) return { cls: "warn", text: "待选表内/表外" };
  if (!item.rules.length) return { cls: "danger", text: "未配置规则" };
  if (item.rules.every((rule) => rule._check && rule._check.ok)) return { cls: "ok", text: "已配置" };
  return { cls: "warn", text: "待完善" };
}

/* ---------------- 公式校验 ---------------- */
async function runCheck(item, rule) {
  rule._checking = true;
  try {
    const result = await checkEadFormula({ productCode: item.code, side: item.side, formula: rule.formula });
    rule._check = result;
    if (result.ok) rule.structured = result.structured;
  } catch (err) {
    rule._check = { ok: false, errors: [err.message], warnings: [], fields: [] };
  } finally {
    rule._checking = false;
  }
}

function scheduleCheck(item, rule) {
  clearTimeout(rule._timer);
  rule._timer = setTimeout(() => runCheck(item, rule), 350);
}

function insert(item, rule, snippet) {
  const ta = areas[rule.id];
  const text = rule.formula || "";
  const pad = ["+", "−", "×", "÷", ")"].includes(snippet) ? " " : "";
  if (!ta) {
    rule.formula = text + pad + snippet + pad;
  } else {
    const start = ta.selectionStart == null ? text.length : ta.selectionStart;
    const end = ta.selectionEnd == null ? text.length : ta.selectionEnd;
    rule.formula = text.slice(0, start) + pad + snippet + pad + text.slice(end);
    const caret = start + pad.length + snippet.length + pad.length;
    nextTick(() => {
      ta.focus();
      try { ta.setSelectionRange(caret, caret); } catch (e) { /* 忽略 */ }
    });
  }
  scheduleCheck(item, rule);
}

/* ---------------- 三步配置 ---------------- */
function setNeeded(item, value) {
  if (item.needed === value) return;
  if (!value && item.rules.length) {
    const ok = window.confirm(`「${item.label}」当前有 ${item.rules.length} 条规则。标记为无需配置会同时清除这些规则，该产品在计量时不再计算 EAD。是否继续？`);
    if (!ok) return;
    item.rules = [];
    item.side = null;
    ping(`已将「${item.label}」标记为无需配置，规则已清除`);
    return;
  }
  item.needed = value;
  ping(value ? `已将「${item.label}」标记为需要配置` : `已将「${item.label}」标记为无需配置`);
}

function blankRule(item) {
  const off = item.side === "off";
  const n = item.rules.length + 1;
  return {
    id: `EAD-${off ? "OFF" : "ON"}-${item.code.slice(0, 2).toUpperCase()}-${String(n).padStart(3, "0")}`,
    name: `${item.label}${off ? "表外" : "表内"} EAD`,
    condition: "",
    conditions: { all: [] },
    formula: "EAD = ",
    precision: 2,
    rounding: "四舍五入",
    resultField: off ? "off_balance_ead" : "on_balance_ead",
    clause: off ? "CL-MO-064" : "CL-MO-060",
    status: "draft",
    ccf: off ? 0.2 : null,
    params: [],
    _check: { ok: false, errors: ["公式为空。"], warnings: [], fields: [] },
    _checking: false
  };
}

function setSide(item, side) {
  if (item.side === side) return;
  const label = side === "on" ? "表内" : "表外";
  if (item.rules.length) {
    const ok = window.confirm(`表内与表外 EAD 互斥。切换到${label}会清除当前的 ${item.rules.length} 条规则，并新建一条待配置规则。是否继续？`);
    if (!ok) return;
  }
  item.side = side;
  item.rules = [blankRule(item)];
  ping(`「${item.label}」已切换为${label} EAD，请编写公式`);
}

function addRule(item) {
  item.rules.push(blankRule(item));
  ping("已新增一条规则，请编写公式并保存");
}

function removeRule(item, index) {
  const rule = item.rules[index];
  const ok = window.confirm(`将删除「${rule.name}」。若这是该产品唯一的规则，该产品在计量时会因缺少 EAD 规则而报异常。是否继续？`);
  if (!ok) return;
  item.rules.splice(index, 1);
  ping("规则已删除");
}

function moveRule(item, index, step) {
  const next = index + step;
  if (next < 0 || next >= item.rules.length) return;
  const moved = item.rules.splice(index, 1)[0];
  item.rules.splice(next, 0, moved);
}

/* ---------------- 适用条件 ---------------- */
function addCond(rule) {
  if (!rule.conditions || !Array.isArray(rule.conditions.all)) rule.conditions = { all: [] };
  rule.conditions.all.push({ field: "", op: "eq", match: "" });
}

function removeCond(rule, index) {
  rule.conditions.all.splice(index, 1);
}

/** 比较值按运算符还原成引擎要的类型：in 拆成数组，大小比较转数字。 */
function coerceMatch(op, text) {
  const raw = String(text == null ? "" : text).trim();
  if (op === "in") return raw.split(/[,，]/).map((x) => x.trim()).filter(Boolean);
  if (op === "gt" || op === "gte" || op === "lt" || op === "lte") {
    const number = Number(raw);
    return Number.isNaN(number) ? raw : number;
  }
  return raw;
}

/** 空行丢掉，剩下的按运算符还原类型。空数组 = 无条件。 */
function conditionsPayload(rule) {
  const list = rule.conditions && Array.isArray(rule.conditions.all) ? rule.conditions.all : [];
  return {
    all: list
      .filter((cond) => String(cond.field || "").trim() || String(cond.match || "").trim())
      .map((cond) => ({
        field: cond.field,
        op: cond.op || "eq",
        match: coerceMatch(cond.op || "eq", cond.match)
      }))
  };
}

/* ---------------- 保存 ---------------- */
function payload() {
  return {
    version: data.value.version,
    products: data.value.products.map((item) => ({
      code: item.code,
      needed: item.needed,
      reason: item.reason || "",
      side: item.side,
      rules: item.rules.map((rule) => ({
        id: rule.id,
        name: rule.name,
        condition: rule.condition,
        conditions: conditionsPayload(rule),
        formula: rule.formula,
        precision: rule.precision,
        rounding: rule.rounding,
        resultField: rule.resultField,
        clause: rule.clause,
        status: rule.status,
        ccf: rule.ccf,
        params: rule.params || []
      }))
    }))
  };
}

async function save() {
  const bad = data.value.products.find((item) =>
    item.needed && item.side && item.rules.some((rule) => !(rule._check && rule._check.ok)));
  if (bad) {
    pageError.value = `「${bad.label}」有规则没通过公式校验，先改好再保存。`;
    return;
  }
  saving.value = true;
  pageError.value = "";
  pageMessage.value = "";
  try {
    data.value = hydrate(await saveEadConfig(payload()));
    pageMessage.value = "配置已保存到 ead_product_config / ead_product_rule";
  } catch (err) {
    pageError.value = err.message;
  } finally {
    saving.value = false;
  }
}

/* ---------------- 试算 ---------------- */
function fieldLabel(item, key) {
  const field = (item.fields || []).find((x) => (x.stdField || x.code) === key);
  return field ? field.name + "（" + key + "）" : key;
}

async function runTrial(item, rule) {
  trialProduct.value = item;
  trialRule.value = rule;
  trial.value = true;
  trialView.value = null;
  trialError.value = "";
  try {
    const result = await trialEad({ product: item.code, side: item.side, rule });
    trialInputs.value = result.inputs;
    trialView.value = result;
  } catch (err) {
    trialError.value = err.message;
  }
}

async function rerun() {
  trialError.value = "";
  try {
    const result = await trialEad({
      product: trialProduct.value.code,
      side: trialProduct.value.side,
      rule: trialRule.value,
      std: trialInputs.value
    });
    trialView.value = result;
  } catch (err) {
    trialError.value = err.message;
  }
}
</script>

<template>
  <AsyncView ref="view" :load="load">
    <template #default>
      <div v-if="pageError" class="notice danger"><span class="ni">!</span><div>{{ pageError }}</div></div>
      <div v-if="pageMessage" class="notice ok"><span class="ni">✓</span><div>{{ pageMessage }}</div></div>

      <div v-if="data" class="ead-layout">
        <div class="ead-left">
          <div class="ead-left-head">
            <b>产品清单</b>
            <div class="dim" style="font-size: 11px; margin-top: 2px">
              来自 product_type · 共 {{ data.products.length }} 个产品
            </div>
          </div>
          <div class="ead-list">
            <div
              v-for="item in data.products"
              :key="item.code"
              class="ead-item"
              :class="{ on: active === item.code }"
              @click="pick(item.code)"
            >
              <span
                style="width: 22px; height: 22px; border-radius: 5px; color: #fff; display: inline-flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; flex: 0 0 22px"
                :style="{ background: item.color }"
              >{{ item.icon }}</span>
              <div style="flex: 1; min-width: 0">
                <div class="ead-item-n">
                  {{ item.label }}
                  <span
                    v-if="item.needed && item.side"
                    class="tag"
                    :class="item.side === 'on' ? 'muted' : 'brand'"
                    style="margin-left: 6px; font-size: 9.5px"
                  >{{ item.side === "on" ? "表内" : "表外" }}</span>
                </div>
                <div class="ead-item-s">{{ item.fields.length }} 个标准字段 · {{ item.rules.length }} 条规则</div>
              </div>
              <span class="tag" :class="statusOf(item).cls">{{ statusOf(item).text }}</span>
            </div>
          </div>
          <div class="ead-left-foot">
            <div class="dim" style="font-size: 11px; line-height: 1.7">
              已保存的配置来自 ead_product_config / ead_product_rule 两张表。<br>
              改动先留在页面上，点右上角「保存全部配置」才写库。
            </div>
          </div>
        </div>

        <div class="ead-right">
          <template v-if="product">
            <div class="ead-right-head">
              <div>
                <b>{{ product.label }}</b>
                <div class="dim" style="font-size: 11px; margin-top: 2px">
                  产品编码 {{ product.code }} · 可用标准字段 {{ product.fields.length }} 个
                </div>
              </div>
              <div style="flex: 1"></div>
              <div class="btn-group">
                <button
                  type="button"
                  class="btn sm"
                  :disabled="!product.needed || !product.side || !product.rules.length"
                  @click="product.rules.length && runTrial(product, product.rules[0])"
                >用模拟债项试算</button>
                <button type="button" class="btn sm primary" :disabled="saving" @click="save">
                  {{ saving ? "保存中…" : "保存全部配置" }}
                </button>
              </div>
            </div>

            <!-- 第 1 步 -->
            <div class="ead-step">
              <div class="ead-step-n">1</div>
              <div class="ead-step-b">
                <div class="ead-step-t">该产品是否需要配置 EAD 计算规则？</div>
                <div class="ead-step-d">
                  标为「无需配置」的产品在计量时不算异常，只以提示出现在异常清单里。
                </div>
                <div class="seg" style="margin-top: 9px">
                  <button type="button" :class="{ active: product.needed }" @click="setNeeded(product, true)">需要配置</button>
                  <button type="button" :class="{ active: !product.needed }" @click="setNeeded(product, false)">无需配置</button>
                </div>
                <div v-if="!product.needed" class="field" style="margin-top: 11px">
                  <label>无需配置的说明（会显示在计量追溯中）</label>
                  <input v-model="product.reason" type="text" placeholder="例如：该产品按人工逐笔录入，不需要单独的 EAD 计算规则" />
                </div>
              </div>
            </div>

            <template v-if="!product.needed">
              <div class="empty" style="padding: 30px 20px">
                「{{ product.label }}」已标记为无需配置 EAD 计算规则。该产品在计量时不会计算 EAD，也不会被计为异常。
              </div>
            </template>

            <template v-else>
              <!-- 第 2 步 -->
              <div class="ead-step">
                <div class="ead-step-n">2</div>
                <div class="ead-step-b">
                  <div class="ead-step-t">配置哪一种 EAD？</div>
                  <div class="ead-step-d">
                    表内 EAD 与表外 EAD 互斥 —— 一个产品只会配置其中一种。切换会清除已配置的另一种规则。
                  </div>
                  <div class="ead-side-pick" style="margin-top: 10px">
                    <div class="ead-side" :class="{ on: product.side === 'on' }" @click="setSide(product, 'on')">
                      <div class="ead-side-t">表内 EAD<span v-if="product.side === 'on'" class="tag ok" style="margin-left: 7px">已选</span></div>
                      <div class="ead-side-d">EAD = 账面余额</div>
                    </div>
                    <div class="ead-side" :class="{ on: product.side === 'off' }" @click="setSide(product, 'off')">
                      <div class="ead-side-t">表外 EAD<span v-if="product.side === 'off'" class="tag ok" style="margin-left: 7px">已选</span></div>
                      <div class="ead-side-d">EAD = 已提用 + 未提用 × CCF</div>
                    </div>
                  </div>
                </div>
              </div>

              <div v-if="!product.side" class="empty" style="padding: 26px 20px">
                请先在上方选择配置表内 EAD 还是表外 EAD。
              </div>

              <!-- 第 3 步 -->
              <div v-else class="ead-step">
                <div class="ead-step-n">3</div>
                <div class="ead-step-b">
                  <div class="ead-step-t">
                    配置{{ product.side === "off" ? "表外" : "表内" }} EAD 计算规则
                    <span class="tag muted" style="margin-left: 7px">{{ product.rules.length }} 条</span>
                  </div>
                  <div class="ead-step-d">
                    同一产品下自上而下匹配，第一条适用条件命中的规则生效。公式左侧写 EAD =，右侧引用本产品的标准字段。
                  </div>

                  <div class="btn-group" style="margin-top: 10px">
                    <button type="button" class="btn sm" @click="addRule(product)">＋ 新增规则</button>
                  </div>

                  <div v-if="!product.rules.length" class="empty" style="padding: 26px 20px">
                    尚未配置{{ product.side === "off" ? "表外" : "表内" }} EAD 规则。
                  </div>

                  <div v-for="(rule, index) in product.rules" :key="rule.id" class="ead-card" style="margin-top: 12px">
                    <div class="ead-card-head">
                      <span class="tag brand">第 {{ index + 1 }} 条</span>
                      <span class="ead-card-n">{{ rule.name }}</span>
                      <span class="mono dim" style="font-size: 11px">{{ rule.id }}</span>
                      <span class="tag" :class="rule.status === 'published' ? 'ok' : 'muted'">
                        {{ rule.status === "published" ? "已发布" : "草稿" }}
                      </span>
                      <div style="flex: 1"></div>
                      <div class="btn-group">
                        <button type="button" class="btn xs" :disabled="index === 0" @click="moveRule(product, index, -1)">↑</button>
                        <button type="button" class="btn xs" :disabled="index === product.rules.length - 1" @click="moveRule(product, index, 1)">↓</button>
                        <button type="button" class="btn xs" @click="runTrial(product, rule)">试算</button>
                        <button type="button" class="btn xs danger" @click="removeRule(product, index)">删除</button>
                      </div>
                    </div>

                    <div class="ead-card-body">
                      <div class="grid c2">
                        <label class="field">规则名称
                          <input v-model="rule.name" type="text" />
                        </label>
                        <label class="field">规则说明
                          <input v-model="rule.condition" type="text" :placeholder="product.side === 'off' ? '例如：原始期限一年以内的贷款承诺' : '例如：适用于所有表内对公贷款'" />
                        </label>
                      </div>

                      <div class="ead-ccf">
                        <div class="ead-cond-head">
                          <b>适用条件</b>
                          <span class="dim" style="font-size: 11px; margin-left: 7px">
                            命中才用这条规则。留空表示无条件，对该产品的所有债项生效。
                          </span>
                        </div>
                        <div v-if="!rule.conditions.all.length" class="dim" style="font-size: 11.5px; padding: 5px 0">
                          无条件 —— 该规则对该产品的所有债项生效。
                        </div>
                        <div v-for="(cond, ci) in rule.conditions.all" :key="ci" class="ead-cond-row">
                          <select v-model="cond.field">
                            <option value="">（选择字段）</option>
                            <option v-for="field in product.fields" :key="field.code" :value="field.stdField || field.code">
                              {{ field.name }}（{{ field.stdField || field.code }}）
                            </option>
                          </select>
                          <select v-model="cond.op">
                            <option v-for="op in COND_OPS" :key="op" :value="op">{{ OP_LABELS[op] }}</option>
                          </select>
                          <input v-model="cond.match" type="text" placeholder="比较值" />
                          <button type="button" class="btn xs danger" @click="removeCond(rule, ci)">移除</button>
                        </div>
                        <button type="button" class="btn sm" style="margin-top: 6px" @click="addCond(rule)">＋ 添加条件</button>
                      </div>

                      <div v-if="product.side === 'off'" class="ead-ccf">
                        <div class="ead-cond-head">
                          <b>信用转换系数 CCF</b>
                          <span class="dim" style="font-size: 11px; margin-left: 7px">
                            表外项目按 CCF 折算为等值表内金额。同一产品下按 CCF 档位匹配规则。
                          </span>
                        </div>
                        <label class="field" style="max-width: 420px">
                          CCF 取值（0.2 表示 20%）
                          <div style="display: flex; align-items: center; gap: 8px">
                            <input v-model="rule.ccf" type="number" step="0.01" min="0" max="1" style="width: 130px" />
                            <span class="tag brand">{{ rule.ccf == null ? "—" : (Number(rule.ccf) * 100).toFixed(0) + "%" }}</span>
                          </div>
                        </label>
                      </div>

                      <div class="panel" style="margin-bottom: 0">
                        <div class="panel-head"><h3>计算公式</h3></div>
                        <div class="panel-body">
                          <label class="field">公式（左侧写 EAD =，右侧引用本产品标准字段）
                            <textarea
                              :ref="(el) => { areas[rule.id] = el }"
                              v-model="rule.formula"
                              :style="{ fontFamily: 'var(--mono)', fontSize: '13px', minHeight: '58px', lineHeight: '1.6' }"
                              :placeholder="product.side === 'off' ? '例如：EAD = 已提用金额 + 授信总额度 × CCF' : '例如：EAD = 债项余额'"
                              @input="scheduleCheck(product, rule)"
                            ></textarea>
                          </label>

                          <div class="fx-ops">
                            <button v-for="op in OPS" :key="op" type="button" class="fx-op" @click="insert(product, rule, op)">{{ op }}</button>
                            <button v-for="fn in FNS" :key="fn" type="button" class="fx-op fn" @click="insert(product, rule, fn)">{{ fn }} )</button>
                          </div>

                          <div v-if="rule._checking" class="fx-warn">
                            <span class="fx-ic">…</span><div class="fx-d">正在校验公式…</div>
                          </div>
                          <template v-else-if="rule._check">
                            <div v-if="rule._check.ok" class="fx-ok">
                              <span class="fx-ic">✓</span>
                              <div>
                                <div class="fx-t">公式校验通过</div>
                                <div class="fx-d">
                                  {{ (rule._check.fields || []).length
                                    ? "引用的计算项：" + rule._check.fields.map((f) => f.name + "（" + (f.stdField || f.code) + "）").join("、") + " —— 均属于本产品标准字段范围。"
                                    : "公式未引用任何字段。" }}
                                </div>
                              </div>
                            </div>
                            <div v-else class="fx-err">
                              <span class="fx-ic">✕</span>
                              <div>
                                <div class="fx-t">公式校验未通过</div>
                                <div v-for="(msg, i) in rule._check.errors" :key="i" class="fx-d">{{ msg }}</div>
                              </div>
                            </div>
                            <div v-for="(msg, i) in rule._check.warnings || []" :key="'w' + i" class="fx-warn">
                              <span class="fx-ic">!</span><div class="fx-d">{{ msg }}</div>
                            </div>
                            <details v-if="rule._check.ok && rule.structured" class="fx-struct">
                              <summary>查看结构化引用（引擎按此执行，不依赖中文名）</summary>
                              <div class="codeblock" style="margin-top: 6px; font-size: 10.5px">{{ JSON.stringify(rule.structured, null, 2) }}</div>
                            </details>
                          </template>

                          <div class="fx-picker">
                            <div class="fx-pk-title">
                              本产品标准字段（点击插入公式）
                              <span class="tag muted" style="margin-left: 7px">{{ product.fields.length }} 个</span>
                            </div>
                            <div class="fx-pk-list">
                              <div v-if="!product.fields.length" class="empty">
                                该产品在 product_field 里还没有标准字段，无法编写公式。
                              </div>
                              <button
                                v-for="field in product.fields"
                                :key="field.code"
                                type="button"
                                class="fx-fld"
                                :title="(field.meaning || '') + '（编码 ' + field.code + '，标准字段 ' + (field.stdField || '—') + '）'"
                                @click="insert(product, rule, field.name)"
                              >
                                <span class="fx-fld-n">{{ field.name }}</span>
                                <span class="fx-fld-c mono">{{ field.stdField || field.code }}</span>
                                <span v-if="field.required" class="fx-req">必填</span>
                              </button>
                              <button v-if="product.side === 'off'" type="button" class="fx-fld ccf" title="信用转换系数，由本规则配置" @click="insert(product, rule, 'CCF')">
                                <span class="fx-fld-n">CCF</span>
                                <span class="fx-fld-c mono">系数</span>
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div class="grid c3">
                        <label class="field">计算精度（小数位）
                          <input v-model="rule.precision" type="number" min="0" max="6" />
                        </label>
                        <label class="field">舍入规则
                          <select v-model="rule.rounding">
                            <option value="四舍五入">四舍五入</option>
                            <option value="向上取整">向上取整</option>
                            <option value="向下取整">向下取整</option>
                          </select>
                        </label>
                        <label class="field">关联监管条款
                          <input v-model="rule.clause" type="text" />
                        </label>
                        <label class="field">结果字段
                          <input v-model="rule.resultField" type="text" />
                        </label>
                        <label class="field">状态
                          <select v-model="rule.status">
                            <option value="draft">草稿</option>
                            <option value="published">已发布</option>
                          </select>
                        </label>
                      </div>

                      <div class="btn-group">
                        <button
                          type="button"
                          class="btn primary"
                          :disabled="!(rule._check && rule._check.ok)"
                          @click="rule.status = 'published'; ping('已把「' + rule.name + '」标为已发布，别忘了点保存全部配置')"
                        >保存规则</button>
                        <button type="button" class="btn" @click="runTrial(product, rule)">试算</button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </template>
          </template>
        </div>
      </div>
    </template>
  </AsyncView>

  <Drawer :open="trial" :title="trialRule ? '试算 · ' + trialRule.name : ''" wide @close="trial = false">
    <div v-if="trialError" class="notice danger"><span class="ni">!</span><div>{{ trialError }}</div></div>
    <div v-if="trialView && trialProduct">
      <div class="notice info">
        <span class="ni">ℹ</span>
        <div>试算「{{ trialRule ? trialRule.name : "" }}」时只取「{{ trialProduct.label }}」的模拟债项，并调用与正式计量相同的计算。</div>
      </div>
      <p>{{ trialView.hint }}</p>
      <div v-if="trialView.result.error" class="notice danger"><span class="ni">!</span><div>{{ trialView.result.error }}</div></div>
      <div v-else-if="trialView.result.skipped" class="notice warn"><span class="ni">!</span><div>{{ trialView.result.skipReason }}</div></div>
      <div v-else class="grid c2">
        <div class="panel">
          <div class="panel-head"><h3>输入参数（可调整）</h3></div>
          <div class="panel-body">
            <label v-for="(value, key) in trialInputs" :key="key" class="field">
              {{ fieldLabel(trialProduct, key) }}
              <input v-model="trialInputs[key]" type="number" step="0.01" />
            </label>
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
              <div class="dim">{{ trialProduct.side === "on" ? "表内 EAD" : "表外 EAD" }}</div>
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
          <div v-if="!trialView.samples.length" class="empty">内置模拟债项里没有这个产品的记录。上方参数试算仍可用。</div>
          <table v-else class="tbl compact">
            <thead>
              <tr>
                <th>债项编号</th>
                <th v-if="trialProduct.side === 'on'">余额</th>
                <th v-if="trialProduct.side === 'on'">减值</th>
                <th v-if="trialProduct.side === 'off'">已提用</th>
                <th v-if="trialProduct.side === 'off'">未提用</th>
                <th v-if="trialProduct.side === 'off'">CCF</th>
                <th>EAD</th>
                <th>命中规则</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in trialView.samples" :key="row.id">
                <td class="mono">{{ row.id }}</td>
                <td v-if="trialProduct.side === 'on'" class="num">{{ row.balance }}</td>
                <td v-if="trialProduct.side === 'on'" class="num">{{ row.impairment }}</td>
                <td v-if="trialProduct.side === 'off'" class="num">{{ row.onbalanceAmount }}</td>
                <td v-if="trialProduct.side === 'off'" class="num">{{ row.offbalanceAmount }}</td>
                <td v-if="trialProduct.side === 'off'" class="mono">{{ row.ccf }}</td>
                <td class="num strong">{{ row.error || row.ead }}</td>
                <td class="dim">{{ row.ruleName }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </Drawer>

  <Teleport to="body">
    <div v-if="toast" class="toasts"><div class="toast ok">{{ toast }}</div></div>
  </Teleport>
</template>
