<script setup>
import { computed, reactive, ref } from "vue";
import { fetchCrmConfig, saveCrmConfig } from "@/api/crm";
import { useContext } from "@/composables/useContext";
import AsyncView from "@/components/AsyncView.vue";
import { askConfirm } from "@/utils/confirm";

/** 缓释配置只绑定这三个属性，与接口的 CRM_ATTRS 一致。三个都是必选。 */
const ATTRS = [
  { key: "crm_type", label: "缓释物类型",
    hint: "判定该笔是否为合格缓释物；此列为空视为该笔不存在" },
  { key: "crm_value", label: "考虑错配折扣后的价值",
    hint: "已由源数据按期限、币种等错配折扣折算的净额，作为覆盖依据" },
  { key: "crm_weight", label: "缓释物对应的风险权重",
    hint: "覆盖部分直接采用该权重" }
];

const { scopeVersion } = useContext();
const view = ref(null);
const data = ref(null);
const active = ref("");
const saving = ref(false);
const pageError = ref("");
const pageMessage = ref("");

/** 第 2 步的草稿。改动先落在 draft 上，点「保存绑定」才写回产品配置。 */
const draft = reactive({
  maxSlots: 1,
  slots: { crm_type: [], crm_value: [], crm_weight: [] }
});

/** 第 3 步的草稿。同样要点「保存字典」才写回产品配置。 */
const draftTypes = ref([]);

const product = computed(() => {
  if (!data.value || !data.value.products) return null;
  return data.value.products.find((item) => item.code === active.value) || null;
});

/** 绑定数组一律补到上限长度，改「最多支持笔数」不会丢已填的列名。 */
function fillSlots(source) {
  const limit = data.value ? data.value.maxSlotsLimit : 6;
  const out = {};
  ATTRS.forEach((attr) => {
    const list = Array.isArray(source && source[attr.key]) ? source[attr.key] : [];
    out[attr.key] = Array.from({ length: limit }, (_, index) => list[index] || "");
  });
  return out;
}

function normalizeTypes(list) {
  return (list || []).map((type) => ({
    code: String(type.code || "").trim(),
    name: String(type.name || "").trim(),
    note: String(type.note || "").trim()
  }));
}

function hydrate(cfg) {
  (cfg.products || []).forEach((item) => {
    item.slotColumns = fillSlots(item.slotColumns);
    if (!Array.isArray(item.eligibleTypes)) item.eligibleTypes = [];
    if (!item.maxSlots) item.maxSlots = 1;
    if (item.needed == null) item.needed = false;
  });
  return cfg;
}

/** 两份草稿都复位为「上次保存」的值（也就是产品对象上的值）。 */
function resetDraft(item) {
  draft.maxSlots = item ? item.maxSlots : 1;
  const slots = fillSlots(item ? item.slotColumns : null);
  ATTRS.forEach((attr) => { draft.slots[attr.key] = slots[attr.key]; });
  draftTypes.value = item ? item.eligibleTypes.map((type) => ({ ...type })) : [];
}

function scopedProducts(cfg) {
  const version = scopeVersion.value;
  return ((cfg && cfg.products) || []).filter((item) => item.ruleVersion === version);
}

async function load() {
  const cfg = hydrate(await fetchCrmConfig());
  data.value = cfg;
  const visible = scopedProducts(cfg);
  if (!active.value || !visible.some((item) => item.code === active.value)) {
    active.value = visible[0] ? visible[0].code : "";
  }
  resetDraft(product.value);
  return cfg;
}

function pick(code) {
  active.value = code;
  resetDraft(product.value);
  pageError.value = "";
  pageMessage.value = "";
}

const dirty = computed(() => {
  const item = product.value;
  if (!item) return false;
  if (Number(draft.maxSlots) !== Number(item.maxSlots)) return true;
  return ATTRS.some((attr) =>
    draft.slots[attr.key]
      .slice(0, draft.maxSlots)
      .some((value, index) =>
        String(value || "").trim() !== String((item.slotColumns[attr.key] || [])[index] || "").trim())
  );
});

const dirtyTypes = computed(() => {
  const item = product.value;
  if (!item) return false;
  return JSON.stringify(normalizeTypes(draftTypes.value)) !== JSON.stringify(normalizeTypes(item.eligibleTypes));
});

/* ---------------- 第 1 步 ---------------- */
async function setNeeded(item, needed) {
  if (item.needed === needed) return;
  if (!needed) {
    const bound = boundCount(item);
    if (bound) {
      const ok = await askConfirm(
        "「" + item.label + "」当前已配置 " + bound + " 个属性绑定。标记为无需配置会清除这些绑定。",
        { title: "清除绑定", confirmText: "继续", danger: true }
      );
      if (!ok) return;
    }
    // 合格缓释物字典与「是否需要配置」无关，保留不动。
    ATTRS.forEach((attr) => { item.slotColumns[attr.key] = item.slotColumns[attr.key].map(() => ""); });
  }
  item.needed = needed;
  resetDraft(item);
  pageError.value = "";
  pageMessage.value = "";
}

/* ---------------- 第 2 步：草稿的读写 ---------------- */
function draftValue(key, slot) {
  return String((draft.slots[key] || [])[slot] || "").trim();
}

function draftBound() {
  const limit = Number(draft.maxSlots) || 1;
  let total = 0;
  ATTRS.forEach((attr) => {
    for (let slot = 0; slot < limit; slot += 1) if (draftValue(attr.key, slot)) total += 1;
  });
  return total;
}

function boundCount(item) {
  return ATTRS.reduce(
    (total, attr) => total + (item.slotColumns[attr.key] || []).slice(0, item.maxSlots)
      .filter((value) => String(value || "").trim()).length,
    0
  );
}

/** 第 2 步草稿写回产品配置。校验不过返回 false，什么都不改。 */
function applyDraft() {
  const item = product.value;
  if (!item) return false;
  const result = validateSlots(item, draft.slots, Number(draft.maxSlots) || 1);
  if (result.errors.length) {
    pageError.value = `「${item.label}」的缓释字段绑定没通过校验，共 ${result.errors.length} 项，先改好再保存。`;
    pageMessage.value = "";
    return false;
  }
  item.maxSlots = Number(draft.maxSlots) || 1;
  ATTRS.forEach((attr) => {
    item.slotColumns[attr.key] = draft.slots[attr.key].map((value) => String(value || "").trim());
  });
  return true;
}

/** 第 3 步草稿写回产品配置。校验不过返回 false，什么都不改。 */
function applyTypes() {
  const item = product.value;
  if (!item) return false;
  const errors = validateTypesList(draftTypes.value);
  if (errors.length) {
    pageError.value = `「${item.label}」的合格缓释物字典没通过校验，共 ${errors.length} 项，先改好再保存。`;
    pageMessage.value = "";
    return false;
  }
  item.eligibleTypes = normalizeTypes(draftTypes.value);
  return true;
}

/** 保存绑定：写回产品配置并立刻落库。 */
async function commitDraft() {
  if (!applyDraft()) return false;
  return persist(`「${product.value.label}」的缓释字段绑定已保存到 crm_slot_column。`);
}

async function discardDraft() {
  const item = product.value;
  if (!item) return;
  if (!dirty.value) {
    pageMessage.value = "当前没有未保存的改动。";
    return;
  }
  const ok = await askConfirm("将放弃「" + item.label + "」未保存的列名改动，恢复为上次保存的内容。", {
    title: "放弃改动",
    confirmText: "放弃",
    danger: true
  });
  if (!ok) return;
  resetDraft(item);
  pageError.value = "";
  pageMessage.value = "已重置为上次保存的内容。";
}

/* ---------------- 第 3 步：草稿的读写 ---------------- */
function addType() {
  draftTypes.value = draftTypes.value.concat([{ code: "", name: "", note: "" }]);
}

async function removeType(index) {
  const type = draftTypes.value[index];
  const ok = await askConfirm("将删除合格缓释物「" + (type.name || type.code || "（未命名）") + "」。", {
    title: "删除合格缓释物",
    confirmText: "删除",
    danger: true
  });
  if (!ok) return;
  const next = draftTypes.value.slice();
  next.splice(index, 1);
  draftTypes.value = next;
}

async function restoreDefault() {
  const ok = await askConfirm(
    "把「" + product.value.label + "」的合格缓释物字典还原为默认的 " + data.value.defaultTypes.length + " 类，当前字典会被替换。",
    { title: "还原字典", confirmText: "还原", danger: true }
  );
  if (!ok) return;
  draftTypes.value = data.value.defaultTypes.map((type) => ({ ...type }));
}

/** 保存字典：写回产品配置并立刻落库。 */
async function commitTypes() {
  if (!applyTypes()) return false;
  return persist(`「${product.value.label}」的合格缓释物字典已保存到 crm_eligible_type。`);
}

async function discardTypes() {
  const item = product.value;
  if (!item) return;
  if (!dirtyTypes.value) {
    pageMessage.value = "当前没有未保存的改动。";
    return;
  }
  const ok = await askConfirm("将放弃「" + item.label + "」未保存的字典改动，恢复为上次保存的内容。", {
    title: "放弃改动",
    confirmText: "放弃",
    danger: true
  });
  if (!ok) return;
  resetDraft(item);
  pageError.value = "";
  pageMessage.value = "已重置为上次保存的内容。";
}

/* ---------------- 校验 ---------------- */
/** 列名绑定的校验。草稿和已保存的配置共用这一段。 */
function validateSlots(item, slots, limit) {
  const errors = [];
  const warnings = [];
  const available = item.sourceColumns.flat;
  const availableSet = new Set(available);
  const value = (key, slot) => String((slots[key] || [])[slot] || "").trim();

  if (!available.length) {
    warnings.push(
      "本产品标准字段里没有可用于缓释的源表列，绑定下拉是空的。" +
      "先到「产品标准字段」为该产品维护缓释相关标准字段并填写源表列名。"
    );
  }

  // 三个属性都是必选：第 1 笔必须填满，其余笔要么整笔留空、要么三个都填。
  for (let slot = 0; slot < limit; slot += 1) {
    const filled = ATTRS.filter((attr) => value(attr.key, slot));
    const mustFill = slot === 0 && available.length > 0;
    if (!filled.length && !mustFill) continue;
    const missing = ATTRS.filter((attr) => !value(attr.key, slot));
    if (missing.length) {
      errors.push(
        `第 ${slot + 1} 笔的「${missing.map((attr) => attr.label).join("」「")}」还没选列名。` +
        `三个属性都是必选，${filled.length ? "同一笔要么三个都填，要么整笔留空。" : "第 1 笔必须填满。"}`
      );
    }
  }

  ATTRS.forEach((attr) => {
    const list = (slots[attr.key] || []).slice(0, limit).map((x) => String(x || "").trim());
    const dup = list.filter((x, index) => x && list.indexOf(x) !== index);
    if (dup.length) {
      errors.push(`「${attr.label}」的列名重复：${Array.from(new Set(dup)).join("、")}。同一属性各笔必须对应不同的源表列。`);
    }
    list.forEach((x, slot) => {
      if (x && !availableSet.has(x)) {
        errors.push(
          `第 ${slot + 1} 笔的「${attr.label}」填了「${x}」，不在本产品标准字段维护的源表列范围内` +
          `（可选 ${available.length} 列）。请从下拉清单中选择。`
        );
      }
    });
  });

  for (let slot = 0; slot < limit; slot += 1) {
    const seen = new Map();
    ATTRS.forEach((attr) => {
      const column = value(attr.key, slot);
      if (!column) return;
      if (seen.has(column)) {
        errors.push(`第 ${slot + 1} 笔的「${seen.get(column)}」与「${attr.label}」填了同一个列名「${column}」。同一笔内不同属性必须来自不同的列。`);
        return;
      }
      seen.set(column, attr.label);
    });
  }

  return { errors, warnings };
}

/** 字典编码的校验，草稿和已保存的配置共用。 */
function validateTypesList(list) {
  const errors = [];
  const codes = [];
  (list || []).forEach((type, index) => {
    const code = String(type.code || "").trim();
    const name = String(type.name || "").trim();
    if (!code) errors.push(`第 ${index + 1} 条合格缓释物没填类型编码。编码是列取值的匹配依据。`);
    else if (codes.includes(code)) errors.push(`合格缓释物类型编码重复：${code}。`);
    else codes.push(code);
    if (!name) errors.push(`${code ? "类型编码「" + code + "」" : `第 ${index + 1} 条合格缓释物`}没填名称。`);
  });
  return errors;
}

function validateDraft(item) {
  if (!item || !item.needed) return { errors: [], warnings: [] };
  const bound = draftBound();
  const result = validateSlots(item, draft.slots, Number(draft.maxSlots) || 1);

  if (!draftTypes.value.length) {
    if (bound) result.errors.push("本产品的合格缓释物字典为空，已绑定的缓释字段不会被认定。请先在第 3 步维护字典。");
    else result.warnings.push("本产品的合格缓释物字典为空。字典里没有类型时，任何缓释都不会被认定。");
  }
  result.errors.push(...validateTypesList(draftTypes.value));
  if (!bound && item.sourceColumns.flat.length) {
    result.warnings.push("尚未填写任何列名。保存后该产品不会从源数据读取到缓释物。");
  }
  return result;
}

/** 非当前产品的校验：没有草稿，直接看已保存的绑定和字典。 */
function validateItem(item) {
  if (!item || !item.needed) return { errors: [] };
  const errors = validateSlots(item, item.slotColumns, item.maxSlots).errors;
  if (!item.eligibleTypes.length && boundCount(item)) errors.push("已绑定缓释字段，但合格缓释物字典为空。");
  errors.push(...validateTypesList(item.eligibleTypes));
  return { errors };
}

const check = computed(() => {
  const item = product.value;
  if (!item) return { errors: [], warnings: [] };
  return validateDraft(item);
});

/* ---------------- 保存 ---------------- */
function payload() {
  return {
    products: data.value.products.map((item) => ({
      code: item.code,
      needed: item.needed,
      reason: item.reason || "",
      maxSlots: item.maxSlots,
      slotColumns: ATTRS.reduce((all, attr) => {
        all[attr.key] = (item.slotColumns[attr.key] || [])
          .slice(0, item.maxSlots)
          .map((value) => String(value || "").trim());
        return all;
      }, {}),
      eligibleTypes: normalizeTypes(item.eligibleTypes)
    }))
  };
}

/** 把整份配置写到库，成功后用返回值重新灌一遍页面状态。 */
async function persist(message) {
  const bad = data.value.products.find((item) => item.needed && validateItem(item).errors.length);
  if (bad) {
    active.value = bad.code;
    resetDraft(product.value);
    pageError.value = `「${bad.label}」的配置没通过校验，先改好再保存。`;
    pageMessage.value = "";
    return false;
  }
  saving.value = true;
  pageError.value = "";
  pageMessage.value = "";
  try {
    data.value = hydrate(await saveCrmConfig(payload()));
    resetDraft(product.value);
    pageMessage.value = message;
    return true;
  } catch (err) {
    pageError.value = err.message;
    return false;
  } finally {
    saving.value = false;
  }
}

async function save() {
  // 草稿还没提交就先提交，避免「保存全部配置」把没点「保存绑定」「保存字典」的改动丢掉。
  if (dirtyTypes.value && !applyTypes()) return false;
  if (dirty.value && !applyDraft()) return false;
  return persist("配置已保存到 crm_product_config / crm_slot_column / crm_eligible_type");
}

function statusOf(item) {
  if (!item.needed) return { cls: "muted", text: "无需配置" };
  if (!item.eligibleTypes.length) return { cls: "danger", text: "无合格缓释物" };
  if (!item.sourceColumns.flat.length) return { cls: "danger", text: "无可用源表列" };
  if (!boundCount(item)) return { cls: "danger", text: "未绑定字段" };
  return { cls: "ok", text: `${item.maxSlots} 笔` };
}

const neededCount = computed(() =>
  scopedProducts(data.value).filter((item) => item.needed).length);
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
              来自 product_type · 共 {{ scopedProducts(data).length }} 个产品
            </div>
          </div>
          <div class="ead-list">
            <div
              v-for="item in scopedProducts(data)"
              :key="item.code"
              class="ead-item"
              :class="{ on: active === item.code }"
              @click="pick(item.code)"
            >
              <span
                :style="{
                  width: '22px', height: '22px', borderRadius: '5px', background: item.color, color: '#fff',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '11px', fontWeight: 700, flex: '0 0 22px'
                }"
              >{{ item.icon }}</span>
              <div style="flex: 1; min-width: 0">
                <div class="ead-item-n">{{ item.label }}</div>
                <div class="ead-item-s">
                  <template v-if="item.needed">
                    {{ item.eligibleTypes.length }} 类合格缓释物 · {{ boundCount(item) }} 个属性绑定
                  </template>
                  <template v-else>未启用缓释配置</template>
                </div>
              </div>
              <span class="tag" :class="statusOf(item).cls">{{ statusOf(item).text }}</span>
            </div>
          </div>
          <div class="ead-left-foot">
            <div class="dim" style="font-size: 11px; line-height: 1.7">
              需要配置：{{ neededCount }} 个产品<br>
              无需配置：{{ scopedProducts(data).length - neededCount }} 个产品<br>
              新产品的默认状态是「无需配置」，先在第 1 步切成「需要配置」。<br>
              「保存绑定」「保存字典」「保存全部配置」都会立即写库。
            </div>
          </div>
        </div>

        <div class="ead-right">
          <template v-if="product">
            <div class="ead-right-head">
              <div>
                <b>{{ product.label }}</b>
                <div class="dim" style="font-size: 11px; margin-top: 2px">
                  产品编码 {{ product.code }} · 标准字段 {{ product.fields.length }} 个 ·
                  可用于缓释的源表列 {{ product.sourceColumns.flat.length }} 个
                </div>
              </div>
              <div style="flex: 1"></div>
              <div class="btn-group">
                <button type="button" class="btn sm primary" :disabled="saving" @click="save">
                  {{ saving ? "保存中…" : "保存全部配置" }}
                </button>
              </div>
            </div>

            <!-- 第 1 步 -->
            <div class="ead-step">
              <div class="ead-step-n">1</div>
              <div class="ead-step-b">
                <div class="ead-step-t">该产品是否需要配置缓释？</div>
                <div class="ead-step-d">
                  与 EAD 一致：并非所有产品都有缓释安排。标为「无需配置」的产品在计量时不做缓释拆分。
                </div>
                <div class="seg" style="margin-top: 9px">
                  <button type="button" :class="{ active: product.needed }" @click="setNeeded(product, true)">需要配置</button>
                  <button type="button" :class="{ active: !product.needed }" @click="setNeeded(product, false)">无需配置</button>
                </div>
                <div v-if="!product.needed" class="field" style="margin-top: 11px">
                  <label>无需配置的说明</label>
                  <input v-model="product.reason" type="text" placeholder="例如：该产品通常无缓释安排" />
                </div>
              </div>
            </div>

            <template v-if="!product.needed">
              <div class="empty" style="padding: 30px 20px">
                「{{ product.label }}」已标记为无需配置缓释。该产品在计量时不做缓释拆分，全部暴露按交易对手权重计算。
              </div>
            </template>

            <template v-else>
              <!-- 第 2 步 -->
              <div class="ead-step">
                <div class="ead-step-n">2</div>
                <div class="ead-step-b">
                  <div class="ead-step-t">缓释字段绑定（多笔缓释物）</div>
                  <div class="ead-step-d">
                    一笔债项可挂多笔缓释物，源数据按序号列组平铺存储。先指定最多支持几笔，再为每一笔逐类指定对应的列名。
                    可选的列只来自本产品标准字段里维护的源表列。三个属性都是必选。
                  </div>

                  <div class="field" style="margin-top: 10px; max-width: 240px">
                    <label>最多支持笔数</label>
                    <select v-model.number="draft.maxSlots">
                      <option v-for="n in data.maxSlotsLimit" :key="n" :value="n">{{ n }} 笔</option>
                    </select>
                  </div>

                  <div v-if="!product.sourceColumns.flat.length" class="empty" style="padding: 26px 20px">
                    本产品标准字段里没有可用于缓释的源表列，无法绑定。<br>
                    先到「产品标准字段」为该产品维护缓释相关标准字段，并填写其源表列名。
                  </div>

                  <div v-else class="tbl-wrap" style="margin-top: 12px">
                    <table class="tbl compact">
                      <thead>
                        <tr>
                          <th style="width: 250px">缓释物属性</th>
                          <th v-for="slot in draft.maxSlots" :key="slot">第 {{ slot }} 笔的列名</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr v-for="attr in ATTRS" :key="attr.key">
                          <td>
                            <div>
                              {{ attr.label }}
                              <span class="tag danger" style="margin-left: 5px">必需</span>
                            </div>
                            <div class="dim" style="font-size: 11px; line-height: 1.5">{{ attr.hint }}</div>
                          </td>
                          <td v-for="slot in draft.maxSlots" :key="slot">
                            <select v-model="draft.slots[attr.key][slot - 1]">
                              <option value="">（未绑定）</option>
                              <optgroup
                                v-for="group in product.sourceColumns.groups"
                                :key="group.label"
                                :label="group.label"
                              >
                                <option v-for="column in group.columns" :key="column" :value="column">{{ column }}</option>
                              </optgroup>
                            </select>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  <div class="btn-group" style="margin-top: 10px">
                    <button type="button" class="btn primary" :disabled="saving" @click="commitDraft">保存绑定</button>
                    <button type="button" class="btn" @click="discardDraft">重置</button>
                    <span v-if="dirty" class="dim" style="font-size: 11px; align-self: center">有未保存的改动</span>
                  </div>

                  <div v-if="check.errors.length" class="notice danger" style="margin-top: 12px">
                    <span class="ni">!</span>
                    <div>
                      校验未通过（{{ check.errors.length }} 项）：
                      <ul style="margin: 4px 0 0; padding-left: 16px">
                        <li v-for="(text, index) in check.errors" :key="index" style="margin-bottom: 3px">{{ text }}</li>
                      </ul>
                    </div>
                  </div>
                  <div v-if="check.warnings.length" class="notice warn" style="margin-top: 12px">
                    <span class="ni">!</span>
                    <div>
                      提示（{{ check.warnings.length }} 项）：
                      <ul style="margin: 4px 0 0; padding-left: 16px">
                        <li v-for="(text, index) in check.warnings" :key="index" style="margin-bottom: 3px">{{ text }}</li>
                      </ul>
                    </div>
                  </div>
                  <div v-if="!check.errors.length && !check.warnings.length" class="notice ok" style="margin-top: 12px">
                    <span class="ni">✓</span>
                    <div>列名绑定完整，未发现冲突。</div>
                  </div>
                </div>
              </div>

              <!-- 第 3 步 -->
              <div class="ead-step">
                <div class="ead-step-n">3</div>
                <div class="ead-step-b">
                  <div class="ead-step-t">
                    合格缓释物字典
                    <span class="tag muted" style="margin-left: 7px">{{ draftTypes.length }} 类</span>
                  </div>
                  <div class="ead-step-d">
                    缓释物类型字段的取值落在本产品的字典内即视为合格，字典外视为不合格，缓释不予认定。
                    字典按产品独立维护，只判定是否合格，不携带折扣率或权重取法。
                  </div>

                  <div class="btn-group" style="margin-top: 10px">
                    <button type="button" class="btn sm" @click="addType">＋ 新增合格缓释物</button>
                    <button type="button" class="btn sm" @click="restoreDefault">恢复默认</button>
                  </div>

                  <div v-if="!draftTypes.length" class="empty" style="padding: 26px 20px">
                    字典为空。字典里没有类型时，任何缓释都不会被认定。
                  </div>

                  <div v-else class="tbl-wrap" style="margin-top: 12px">
                    <table class="tbl compact">
                      <thead>
                        <tr>
                          <th style="width: 150px">类型编码</th>
                          <th style="width: 200px">名称</th>
                          <th>监管依据</th>
                          <th style="width: 70px"></th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr v-for="(type, index) in draftTypes" :key="index">
                          <td><input v-model="type.code" type="text" class="mono" placeholder="例如 cash" ></td>
                          <td><input v-model="type.name" type="text" placeholder="例如 现金及本机构发行的存款证" ></td>
                          <td><input v-model="type.note" type="text" placeholder="监管依据" ></td>
                          <td>
                            <button type="button" class="btn xs" @click="removeType(index)">删除</button>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  <div class="btn-group" style="margin-top: 10px">
                    <button type="button" class="btn primary" :disabled="saving" @click="commitTypes">保存字典</button>
                    <button type="button" class="btn" @click="discardTypes">重置</button>
                    <span v-if="dirtyTypes" class="dim" style="font-size: 11px; align-self: center">有未保存的改动</span>
                  </div>
                </div>
              </div>
            </template>
          </template>
        </div>
      </div>
    </template>
  </AsyncView>
</template>
