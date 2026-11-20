<script setup>
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  deleteLiquidityField, deleteLiquidityFieldGroup, deleteLiquidityGroup, deleteLiquidityRuleScope,
  deleteLiquidityDictionary, deleteLiquidityDictionaryItem, fetchLiquidityProduct,
  saveLiquidityDictionary, saveLiquidityDictionaryItem, saveLiquidityField, saveLiquidityFieldGroup,
  saveLiquidityGroup, saveLiquidityProduct, saveLiquidityRuleScope, validateLiquidityGroups
} from "@/api/liquidity";
import { useContext } from "@/composables/useContext";
import Drawer from "@/components/Drawer.vue";
import ConditionBuilder from "@/components/ConditionBuilder.vue";
import { askConfirm } from "@/utils/confirm";

const route = useRoute();
const router = useRouter();
const { session, scopeVersion } = useContext();

const TABS = [
  ["overview", "概览"],
  ["guide", "配置向导"],
  ["groups", "产品组"],
  ["fields", "标准字段"],
  ["rules", "规则配置"],
  ["preview", "规则预览"]
];
const SIDE_LABEL = { ASSET: "资产端", INFLOW: "现金流入", OUTFLOW: "现金流出" };
const STATUS_LABEL = { LIVE: "已启用", DRAFT: "草稿", DISABLED: "已停用" };
const ITEM_STATUS = { DONE: "已完成", PARTIAL: "部分完成", TODO: "待配置", ERROR: "存在问题", NA: "不适用" };
const ITEM_TONE = { DONE: "green", PARTIAL: "amber", TODO: "muted", ERROR: "red", NA: "muted" };
const CONDITION_STATUS = { CONFIGURED: "已配置", TODO: "未配置", ERROR: "存在冲突" };
const CONDITION_TONE = { CONFIGURED: "green", TODO: "muted", ERROR: "red" };
const DATA_TYPES = ["STRING", "INTEGER", "DECIMAL", "DATE", "BOOLEAN", "CURRENCY", "PERCENT"];
const BUSINESS_TYPES = ["金额", "利率", "比例", "日期", "数量", "标识", "业务属性", "币种", "其他"];
const VALUE_TYPES = ["FREE_TEXT", "CODE_DICT", "NUM_RANGE", "BOOLEAN"];
const SOURCE_TYPES = ["源字段", "派生", "人工输入", "外部数据"];
const ROLE_LABEL = { NONE: "不参与计量", VALUATION: "计量价值", AMOUNT: "业务金额", ACCRUED: "应计利息", UNDRAWN: "未提取额度" };

function normalizeTab(value) {
  const key = String(value || "overview");
  if (key === "setup") return "guide";
  if (key === "check") return "overview";
  return TABS.some(([name]) => name === key) ? key : "overview";
}

const loading = ref(true);
const error = ref("");
const data = ref(null);
const tab = ref(normalizeTab(route.query.tab || route.params.tab));
const completenessOpen = ref(String(route.query.tab || route.params.tab) === "check");

const tabLabel = computed(() => {
  const hit = TABS.find(([key]) => key === tab.value);
  return hit ? hit[1] : "概览";
});
const code = computed(() => String(route.params.code || ""));
const jurisdiction = computed(() => String(route.query.jurisdiction || session.jurisdiction || "HK"));
const version = computed(() => String(route.query.version || scopeVersion.value || ""));
const product = computed(() => (data.value ? data.value.product : null));
const groups = computed(() => (product.value ? product.value.groups || [] : []));
const fieldGroups = computed(() => (product.value ? product.value.fieldGroups || [] : []));
const fields = computed(() => (product.value ? product.value.fields || [] : []));
const dictionaries = computed(() => (data.value ? data.value.dictionaries || [] : []));
const packages = computed(() => (data.value ? data.value.rulePackages || [] : []));
const scopes = computed(() => (data.value ? data.value.ruleScopes || [] : []));
const completeness = computed(() => (product.value ? product.value.completeness : { score: 0, status: "未完善", items: [] }));
const activeFields = computed(() => fields.value.filter((field) => field.status === "ACTIVE"));
const fieldGroupMap = computed(() => new Map(fieldGroups.value.map((group) => [group.code, group])));
const groupMap = computed(() => new Map(groups.value.map((group) => [group.code, group])));

function itemOf(key) {
  return completeness.value.items.find((entry) => entry.key === key) || { status: "TODO", detail: "" };
}

const basicItem = computed(() => itemOf("basic"));
const groupsItem = computed(() => itemOf("groups"));
const fieldsItem = computed(() => itemOf("fields"));
const dictionariesItem = computed(() => itemOf("dictionaries"));
const rulesItem = computed(() => itemOf("rules"));
const previewItem = computed(() => itemOf("preview"));

const basicOpen = ref(false);
const basicError = ref("");
const basicSaving = ref(false);
const basicForm = ref(blankBasic());

const groupOpen = ref(false);
const groupEditingCode = ref("");
const groupError = ref("");
const groupSaving = ref(false);
const groupForm = ref(blankGroup());
const groupValidation = ref(null);

const fieldGroupOpen = ref(false);
const fieldGroupEditingCode = ref("");
const fieldGroupError = ref("");
const fieldGroupSaving = ref(false);
const fieldGroupForm = ref(blankFieldGroup());

const fieldOpen = ref(false);
const fieldEditingCode = ref("");
const fieldError = ref("");
const fieldSaving = ref(false);
const fieldForm = ref(blankField());
const selectedGroup = ref("");
const fieldQuery = ref("");

const dictOpen = ref(false);
const dictError = ref("");
const dictSaving = ref(false);
const dictEditingCode = ref("");
const dictForm = ref(blankDictionary());
const selectedDictCode = ref("");
const itemEditingCode = ref("");
const itemError = ref("");
const itemSaving = ref(false);
const itemForm = ref(blankItem());

const selectedScope = ref("");
const packagePickerOpen = ref(false);
const packageQuery = ref("");
const packageStage = ref("");
const selectedPackages = ref([]);
const scopeError = ref("");
const scopeSaving = ref(false);

const previewScope = ref("");
const previewRule = ref(null);

const scopeOptions = computed(() => {
  if (!product.value) return [];
  if (product.value.groupMode !== "GROUP") return [{ code: "", name: "产品级规则" }];
  return groups.value.filter((group) => group.status === "ACTIVE").map((group) => ({ code: group.code, name: group.name }));
});
const currentScope = computed(() => scopeOptions.value.find((entry) => entry.code === selectedScope.value) || scopeOptions.value[0] || null);
const currentScopes = computed(() => scopes.value.filter((scope) => scope.status === "ACTIVE" && (scope.groupCode || "") === (currentScope.value ? currentScope.value.code : "")));
const currentPackageIds = computed(() => new Set(currentScopes.value.map((scope) => scope.packageId)));
const scopePackages = computed(() => packages.value.filter((pack) => currentPackageIds.value.has(pack.packageId)));
const packageStages = computed(() => [...new Set(packages.value.map((pack) => pack.stageLabel))]);
const availablePackages = computed(() => {
  const word = packageQuery.value.trim().toLowerCase();
  return packages.value.filter((pack) => {
    if (currentPackageIds.value.has(pack.packageId)) return false;
    if (packageStage.value && pack.stageLabel !== packageStage.value) return false;
    if (!word) return true;
    return (pack.packageName + " " + pack.packageId).toLowerCase().includes(word);
  });
});

const previewScopes = computed(() => scopes.value.filter((scope) => scope.status === "ACTIVE" && (scope.groupCode || "") === (previewScope.value || "")));
const previewPackageIds = computed(() => new Set(previewScopes.value.map((scope) => scope.packageId)));
const previewPackages = computed(() => packages.value.filter((pack) => previewPackageIds.value.has(pack.packageId)));

const filteredFields = computed(() => {
  const word = fieldQuery.value.trim().toLowerCase();
  return fields.value.filter((field) => {
    if (selectedGroup.value && field.group !== selectedGroup.value) return false;
    if (!word) return true;
    return [field.name, field.code, field.group, field.businessType].join(" ").toLowerCase().includes(word);
  });
});
const selectedDictionary = computed(() => dictionaries.value.find((entry) => entry.code === selectedDictCode.value) || null);

function blankBasic() {
  return { name: "", category: "", side: "ASSET", source: "", status: "LIVE", paramKey: "", description: "" };
}
function blankGroup() {
  return { groupCode: "", name: "", description: "", status: "ACTIVE", sortOrder: groups.value.length + 1, conditions: null };
}
function blankFieldGroup() {
  return { groupCode: "", name: "", parentCode: "", description: "", sortOrder: fieldGroups.value.length + 1, status: "ACTIVE" };
}
function blankField() {
  return {
    code: "", name: "", group: "", category: "", groupOrder: 1, dataType: "STRING", role: "NONE",
    required: false, valueType: "FREE_TEXT", dictionary: "", source: "", aliases: "",
    description: "", status: "ACTIVE", businessType: "", unit: "", precision: null,
    nullable: null, defaultValue: "", sourceType: "", requiredNote: "", enumText: ""
  };
}
function blankDictionary() {
  return { dictCode: "", name: "", description: "", dictType: "PUBLIC", productCode: "", status: "ACTIVE" };
}
function blankItem() {
  return { itemCode: "", name: "", description: "", sortOrder: 0, status: "ACTIVE" };
}

function groupName(value) {
  const group = fieldGroupMap.value.get(value);
  return group ? group.name : value || "未分组";
}

async function load() {
  loading.value = true;
  error.value = "";
  try {
    data.value = await fetchLiquidityProduct(code.value, jurisdiction.value, version.value);
    if (completenessOpen.value) tab.value = "overview";
    const usable = (data.value.product.groups || []).filter((group) => group.status === "ACTIVE");
    if (data.value.product.groupMode === "GROUP" && usable.length) {
      if (!usable.some((group) => group.code === selectedScope.value)) selectedScope.value = usable[0].code;
    } else {
      selectedScope.value = "";
    }
    if (!scopeOptions.value.some((entry) => entry.code === previewScope.value)) {
      previewScope.value = scopeOptions.value.length ? scopeOptions.value[0].code : "";
    }
    if (selectedGroup.value && !fieldGroupMap.value.has(selectedGroup.value)) selectedGroup.value = "";
    if (!selectedDictCode.value && dictionaries.value.length) selectedDictCode.value = dictionaries.value[0].code;
    if (selectedDictCode.value && !dictionaries.value.some((dict) => dict.code === selectedDictCode.value)) {
      selectedDictCode.value = dictionaries.value.length ? dictionaries.value[0].code : "";
    }
    groupValidation.value = null;
    scopeError.value = "";
    previewRule.value = null;
  } catch (err) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
}

function goTab(key) {
  tab.value = key;
  router.replace({ name: "liquidity-product", params: { code: code.value }, query: { ...route.query, tab: key } });
}
function goParams() {
  router.push({ path: "/liquidity-params", query: { jurisdiction: jurisdiction.value, version: version.value } });
}
function openCompleteness() {
  completenessOpen.value = true;
}
function goFromCompleteness(item) {
  completenessOpen.value = false;
  if (item && item.target) goTab(item.target);
}

function basePayload() {
  return {
    code: product.value.code,
    name: product.value.name,
    category: product.value.category,
    productGroup: product.value.productGroup,
    side: product.value.side,
    source: product.value.source,
    status: product.value.status,
    description: product.value.description,
    domains: product.value.domains,
    paramKey: product.value.paramKey,
    groupMode: product.value.groupMode,
    jurisdiction: jurisdiction.value,
    version: version.value
  };
}

function openBasicEdit() {
  basicError.value = "";
  const current = product.value;
  basicForm.value = {
    name: current.name, category: current.category, side: current.side, source: current.source,
    status: current.status, paramKey: current.paramKey, description: current.description
  };
  basicOpen.value = true;
}
async function saveBasic() {
  if (basicSaving.value) return;
  basicSaving.value = true;
  basicError.value = "";
  try {
    await saveLiquidityProduct(code.value, { ...basePayload(), ...basicForm.value });
    basicOpen.value = false;
    await load();
  } catch (err) {
    basicError.value = err.message;
  } finally {
    basicSaving.value = false;
  }
}

async function setGroupMode(mode) {
  if (!product.value || product.value.groupMode === mode) return;
  if (mode === "NONE" && groups.value.length) {
    const yes = await askConfirm("切换为不启用产品组后，已配置的产品组会保留但不再参与规则识别，产品级规则将直接生效。确定继续？", {
      title: "切换产品组模式", confirmText: "切换"
    });
    if (!yes) return;
  }
  try {
    await saveLiquidityProduct(code.value, { ...basePayload(), groupMode: mode });
    await load();
  } catch (err) {
    error.value = err.message;
  }
}

function openGroupCreate() {
  if (product.value.groupMode !== "GROUP") {
    error.value = "请先启用产品组模式";
    return;
  }
  groupEditingCode.value = "";
  groupForm.value = blankGroup();
  groupError.value = "";
  groupOpen.value = true;
}
function openGroupEdit(group) {
  groupEditingCode.value = group.code;
  groupForm.value = {
    groupCode: group.code, name: group.name, description: group.description,
    status: group.status, sortOrder: group.sortOrder,
    conditions: group.conditions ? JSON.parse(JSON.stringify(group.conditions)) : null
  };
  groupError.value = "";
  groupOpen.value = true;
}
async function saveGroup() {
  if (groupSaving.value) return;
  groupSaving.value = true;
  groupError.value = "";
  try {
    await saveLiquidityGroup(code.value, groupEditingCode.value, {
      ...groupForm.value, jurisdiction: jurisdiction.value, version: version.value
    });
    groupOpen.value = false;
    await load();
  } catch (err) {
    groupError.value = err.message;
  } finally {
    groupSaving.value = false;
  }
}
async function removeGroup(group) {
  const yes = await askConfirm(`删除产品组「${group.name}」？已关联规则包时需要先解除关联。`, { title: "删除产品组", danger: true });
  if (!yes) return;
  try {
    await deleteLiquidityGroup(code.value, group.code, jurisdiction.value, version.value);
    await load();
  } catch (err) {
    error.value = err.message;
  }
}
async function runGroupValidation() {
  try {
    groupValidation.value = await validateLiquidityGroups(code.value, jurisdiction.value, version.value);
  } catch (err) {
    error.value = err.message;
  }
}
function groupsToRules(group) {
  selectedScope.value = group.code;
  goTab("rules");
}

function openFieldGroupCreate() {
  fieldGroupEditingCode.value = "";
  fieldGroupForm.value = blankFieldGroup();
  fieldGroupError.value = "";
  fieldGroupOpen.value = true;
}
function openFieldGroupEdit(group) {
  fieldGroupEditingCode.value = group.code;
  fieldGroupForm.value = {
    groupCode: group.code, name: group.name, parentCode: group.parentCode || "",
    description: group.description, sortOrder: group.sortOrder, status: group.status
  };
  fieldGroupError.value = "";
  fieldGroupOpen.value = true;
}
async function saveFieldGroup() {
  if (fieldGroupSaving.value) return;
  fieldGroupSaving.value = true;
  fieldGroupError.value = "";
  try {
    await saveLiquidityFieldGroup(code.value, fieldGroupEditingCode.value, {
      ...fieldGroupForm.value, jurisdiction: jurisdiction.value, version: version.value
    });
    fieldGroupOpen.value = false;
    await load();
  } catch (err) {
    fieldGroupError.value = err.message;
  } finally {
    fieldGroupSaving.value = false;
  }
}
async function removeFieldGroup(group) {
  const yes = await askConfirm(`删除字段分组「${group.name}」？分组下还有字段时不能删除。`, { title: "删除字段分组", danger: true });
  if (!yes) return;
  try {
    await deleteLiquidityFieldGroup(code.value, group.code, jurisdiction.value, version.value);
    if (selectedGroup.value === group.code) selectedGroup.value = "";
    await load();
  } catch (err) {
    error.value = err.message;
  }
}

function openFieldCreate() {
  fieldEditingCode.value = "";
  fieldForm.value = blankField();
  fieldForm.value.group = selectedGroup.value || (fieldGroups.value[0] ? fieldGroups.value[0].code : "");
  fieldError.value = "";
  fieldOpen.value = true;
}
function openFieldEdit(field) {
  fieldEditingCode.value = field.code;
  fieldForm.value = {
    code: field.code, name: field.name, group: field.group, category: field.category,
    groupOrder: field.groupOrder, dataType: field.dataType, role: field.role, required: field.required,
    valueType: field.valueType, dictionary: field.dictionary, source: field.source,
    aliases: (field.aliases || []).join(", "), description: field.description, status: field.status,
    businessType: field.businessType, unit: field.unit, precision: field.precision,
    nullable: field.nullable, defaultValue: field.defaultValue, sourceType: field.sourceType,
    requiredNote: field.requiredNote, enumText: (field.enum || []).join(", ")
  };
  fieldError.value = "";
  fieldOpen.value = true;
}
async function saveField() {
  if (fieldSaving.value) return;
  fieldSaving.value = true;
  fieldError.value = "";
  try {
    const body = {
      ...fieldForm.value,
      aliases: String(fieldForm.value.aliases || "").split(/[,，]/).map((item) => item.trim()).filter(Boolean),
      enum: String(fieldForm.value.enumText || "").split(/[,，]/).map((item) => item.trim()).filter(Boolean),
      jurisdiction: jurisdiction.value,
      version: version.value
    };
    await saveLiquidityField(code.value, fieldEditingCode.value, body);
    fieldOpen.value = false;
    await load();
  } catch (err) {
    fieldError.value = err.message;
  } finally {
    fieldSaving.value = false;
  }
}
async function removeField(field) {
  const yes = await askConfirm(`删除标准字段「${field.name}」？被产品组条件或规则引用时系统会提示。`, { title: "删除标准字段", danger: true });
  if (!yes) return;
  try {
    await deleteLiquidityField(code.value, field.code, jurisdiction.value, version.value);
    await load();
  } catch (err) {
    error.value = err.message;
  }
}

function openDictionaryManager() {
  dictError.value = "";
  dictEditingCode.value = "";
  dictForm.value = blankDictionary();
  if (dictionaries.value.length && !selectedDictCode.value) selectedDictCode.value = dictionaries.value[0].code;
  dictOpen.value = true;
}
function openDictionaryCreate() {
  dictEditingCode.value = "";
  dictForm.value = blankDictionary();
  dictError.value = "";
}
function openDictionaryEdit(dict) {
  dictEditingCode.value = dict.code;
  dictForm.value = {
    dictCode: dict.code, name: dict.name, description: dict.description,
    dictType: dict.type, productCode: dict.productCode, status: dict.status
  };
  dictError.value = "";
}
async function saveDictionary() {
  if (dictSaving.value) return;
  dictSaving.value = true;
  dictError.value = "";
  try {
    await saveLiquidityDictionary({
      ...dictForm.value,
      productCode: dictForm.value.dictType === "PRODUCT" ? product.value.code : "",
      originalCode: dictEditingCode.value,
      jurisdiction: jurisdiction.value,
      version: version.value
    });
    if (!selectedDictCode.value) selectedDictCode.value = dictForm.value.dictCode;
    await load();
  } catch (err) {
    dictError.value = err.message;
  } finally {
    dictSaving.value = false;
  }
}
async function removeDictionary(dict) {
  const yes = await askConfirm(`删除码值字典「${dict.name}」？被标准字段引用时不能删除。`, { title: "删除码值字典", danger: true });
  if (!yes) return;
  try {
    await deleteLiquidityDictionary(dict.code, jurisdiction.value, version.value);
    if (selectedDictCode.value === dict.code) selectedDictCode.value = "";
    await load();
  } catch (err) {
    dictError.value = err.message;
  }
}
function openItemCreate() {
  itemEditingCode.value = "";
  itemForm.value = blankItem();
  itemError.value = "";
}
function openItemEdit(item) {
  itemEditingCode.value = item.code;
  itemForm.value = { itemCode: item.code, name: item.name, description: item.description, sortOrder: item.sortOrder, status: item.status };
  itemError.value = "";
}
async function saveItem() {
  if (itemSaving.value || !selectedDictionary.value) return;
  itemSaving.value = true;
  itemError.value = "";
  try {
    await saveLiquidityDictionaryItem(selectedDictionary.value.code, itemEditingCode.value, {
      ...itemForm.value, productCode: product.value.code, jurisdiction: jurisdiction.value, version: version.value
    });
    itemEditingCode.value = "";
    itemForm.value = blankItem();
    await load();
  } catch (err) {
    itemError.value = err.message;
  } finally {
    itemSaving.value = false;
  }
}
async function removeItem(item) {
  const yes = await askConfirm(`删除码值「${item.name}」？被识别条件引用时不能删除。`, { title: "删除码值", danger: true });
  if (!yes) return;
  try {
    await deleteLiquidityDictionaryItem(selectedDictionary.value.code, item.code, jurisdiction.value, version.value, product.value.code);
    await load();
  } catch (err) {
    itemError.value = err.message;
  }
}

function openPackagePicker() {
  if (!currentScope.value) {
    scopeError.value = "请先创建并启用产品组";
    return;
  }
  packageQuery.value = "";
  packageStage.value = "";
  selectedPackages.value = [];
  scopeError.value = "";
  packagePickerOpen.value = true;
}
function togglePackage(packageId) {
  const index = selectedPackages.value.indexOf(packageId);
  if (index >= 0) selectedPackages.value.splice(index, 1);
  else selectedPackages.value.push(packageId);
}
async function addPackages() {
  if (!selectedPackages.value.length || scopeSaving.value) return;
  scopeSaving.value = true;
  scopeError.value = "";
  try {
    for (const packageId of selectedPackages.value) {
      await saveLiquidityRuleScope(code.value, {
        groupCode: currentScope.value.code, packageId, status: "ACTIVE",
        jurisdiction: jurisdiction.value, version: version.value
      });
    }
    packagePickerOpen.value = false;
    await load();
  } catch (err) {
    await load();
    scopeError.value = err.message;
  } finally {
    scopeSaving.value = false;
  }
}
async function removeScope(packageId) {
  const scope = currentScopes.value.find((entry) => entry.packageId === packageId);
  if (!scope) return;
  const yes = await askConfirm("解除这个规则包与当前规则适用对象的关联？", { title: "解除规则包", danger: true });
  if (!yes) return;
  try {
    await deleteLiquidityRuleScope(code.value, scope.id, jurisdiction.value, version.value);
    await load();
  } catch (err) {
    scopeError.value = err.message;
  }
}
function previewRules(pack) {
  return (pack.rules || []).filter((rule) => rule.applicable !== false);
}
function selectPreviewRule(rule) {
  previewRule.value = rule;
}
function fieldOf(codeValue) {
  return fields.value.find((field) => field.code === codeValue) || null;
}
function inputFields(rule) {
  return (rule.inputs || []).map(fieldOf).filter(Boolean);
}

watch(selectedScope, (value) => {
  if (!scopeOptions.value.some((entry) => entry.code === value)) return;
  previewScope.value = value;
});
watch(() => route.query.tab, (value) => {
  tab.value = normalizeTab(value);
  if (String(value) === "check") completenessOpen.value = true;
});
watch(() => route.params.tab, (value) => {
  if (!value) return;
  tab.value = normalizeTab(value);
  if (String(value) === "check") completenessOpen.value = true;
});
watch(() => route.params.code, load);
onMounted(load);
</script>

<template>
  <p v-if="error" class="notice danger">{{ error }}</p>
  <div v-if="loading" class="empty">正在读取产品配置…</div>

  <template v-else-if="product">
    <nav class="lq-crumb" aria-label="面包屑导航">
      <button type="button" @click="router.push('/liquidity-config')">流动性产品管理</button>
      <span class="sep">›</span>
      <button
        type="button"
        @click="router.push({ name: 'liquidity-product', params: { code: code }, query: { ...route.query, tab: 'overview' } })"
      >{{ product.name }}</button>
      <span class="sep">›</span>
      <span class="current">{{ tabLabel }}</span>
    </nav>

    <div class="lq-product-head">
      <div>
        <h2>{{ product.name }}</h2>
        <p>
          <span class="mono">{{ product.code }}</span> · {{ product.category }} ·
          {{ SIDE_LABEL[product.side] || product.side }} ·
          {{ product.groupMode === "GROUP" ? "启用产品组" : "不启用产品组" }} · {{ version }}
        </p>
      </div>
      <div class="lq-product-head-actions">
        <span class="tag" :class="product.status === 'LIVE' ? 'green' : product.status === 'DRAFT' ? 'amber' : 'muted'">
          {{ STATUS_LABEL[product.status] || product.status }}
        </span>
        <button type="button" class="btn sm" @click="openCompleteness">配置完整性 {{ completeness.score }}%</button>
        <button type="button" class="btn sm" @click="openBasicEdit">编辑产品</button>
        <button type="button" class="btn sm" @click="router.push('/liquidity-config')">返回产品清单</button>
      </div>
    </div>

    <div class="lq-tabs">
      <button v-for="[key, label] in TABS" :key="key" type="button" :class="{ on: tab === key }" @click="goTab(key)">
        {{ label }}
      </button>
    </div>

    <div v-if="tab === 'overview'" class="grid c2">
      <div class="panel">
        <div class="panel-head">
          <h3>产品基本信息</h3>
          <span class="spacer"></span>
          <button type="button" class="btn sm" @click="openBasicEdit">编辑</button>
        </div>
        <div class="panel-body">
          <div class="kv small">
            <div class="k">产品编码</div><div class="mono">{{ product.code }}</div>
            <div class="k">产品名称</div><div>{{ product.name }}</div>
            <div class="k">业务大类</div><div>{{ product.category || "—" }}</div>
            <div class="k">计量侧别</div><div>{{ SIDE_LABEL[product.side] || product.side }}</div>
            <div class="k">业务分组</div><div>{{ product.productGroup || "—" }}</div>
            <div class="k">来源系统</div><div class="mono small">{{ product.source || "—" }}</div>
            <div class="k">参数键</div><div class="mono small">{{ product.paramKey || "—" }}</div>
            <div class="k">产品说明</div><div>{{ product.description || "—" }}</div>
          </div>
        </div>
      </div>
      <div class="panel">
        <div class="panel-head">
          <h3>产品组模式</h3>
          <span class="tag" :class="product.groupMode === 'GROUP' ? 'green' : 'muted'">
            {{ product.groupMode === "GROUP" ? "启用产品组" : "不启用产品组" }}
          </span>
        </div>
        <div class="panel-body">
          <p class="dim" style="margin-top: 0">
            {{ product.groupMode === "GROUP"
              ? "同一产品内部按标准字段识别条件自动归组，再按产品组关联规则包。"
              : "所有业务明细直接使用产品级规则，不需要产品组。" }}
          </p>
          <p v-if="product.groupMode === 'GROUP'" class="small">
            已配置 {{ groups.length }} 个产品组：{{ groups.map((group) => group.name).join("、") || "—" }}
          </p>
          <button type="button" class="btn sm" @click="goTab('groups')">查看产品组</button>
        </div>
      </div>
      <div class="panel" style="grid-column: 1 / -1">
        <div class="panel-head">
          <h3>配置情况</h3>
          <span class="sub">按模块查看当前配置状态</span>
          <span class="spacer"></span>
          <button type="button" class="btn sm" @click="openCompleteness">检查配置完整性</button>
        </div>
        <div class="panel-body tight">
          <table class="tbl">
            <thead><tr><th>配置模块</th><th>状态</th><th>说明</th><th></th></tr></thead>
            <tbody>
              <tr v-for="entry in completeness.items" :key="entry.key">
                <td>{{ entry.label }}</td>
                <td><span class="tag" :class="ITEM_TONE[entry.status]">{{ ITEM_STATUS[entry.status] }}</span></td>
                <td class="dim">{{ entry.detail }}</td>
                <td class="num"><button type="button" class="btn sm" @click="goTab(entry.target)">查看</button></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div v-else-if="tab === 'guide'" class="grid c2">
      <div class="panel">
        <div class="panel-head"><h3>1. 基本信息</h3><span class="tag" :class="ITEM_TONE[basicItem.status]">{{ ITEM_STATUS[basicItem.status] }}</span></div>
        <div class="panel-body">
          <p class="dim">{{ basicItem.detail }}</p>
          <button type="button" class="btn sm" @click="openBasicEdit">编辑基本信息</button>
        </div>
      </div>
      <div class="panel">
        <div class="panel-head"><h3>2. 产品组</h3><span class="tag" :class="ITEM_TONE[groupsItem.status]">{{ ITEM_STATUS[groupsItem.status] }}</span></div>
        <div class="panel-body">
          <p class="dim">{{ groupsItem.detail }}</p>
          <button type="button" class="btn sm" @click="goTab('groups')">进入产品组</button>
        </div>
      </div>
      <div class="panel">
        <div class="panel-head"><h3>3. 标准字段</h3><span class="tag" :class="ITEM_TONE[fieldsItem.status]">{{ ITEM_STATUS[fieldsItem.status] }}</span></div>
        <div class="panel-body">
          <p class="dim">{{ fieldsItem.detail }}</p>
          <p class="small">已定义 {{ fields.length }} 个字段，{{ fieldGroups.length }} 个分组；{{ dictionaries.length }} 个可用码值字典。</p>
          <button type="button" class="btn sm" @click="goTab('fields')">进入标准字段</button>
        </div>
      </div>
      <div class="panel">
        <div class="panel-head"><h3>4. 规则配置</h3><span class="tag" :class="ITEM_TONE[rulesItem.status]">{{ ITEM_STATUS[rulesItem.status] }}</span></div>
        <div class="panel-body">
          <p class="dim">{{ rulesItem.detail }}</p>
          <p class="small">{{ product.groupMode === "GROUP" ? "按产品组分别关联规则包。" : "在产品层面关联规则包。" }}</p>
          <button type="button" class="btn sm" @click="goTab('rules')">进入规则配置</button>
        </div>
      </div>
    </div>

    <div v-else-if="tab === 'groups'">
      <div class="panel">
        <div class="panel-head">
          <h3>产品组</h3>
          <span class="sub">产品组可选；启用后按标准字段识别条件自动归组。</span>
          <span class="spacer"></span>
          <button type="button" class="btn sm" :disabled="product.groupMode === 'NONE'" @click="setGroupMode('NONE')">不启用产品组</button>
          <button type="button" class="btn sm" :disabled="product.groupMode === 'GROUP'" @click="setGroupMode('GROUP')">启用产品组</button>
          <button type="button" class="btn sm primary" :disabled="product.groupMode !== 'GROUP'" @click="openGroupCreate">＋ 新增产品组</button>
          <button type="button" class="btn sm" :disabled="product.groupMode !== 'GROUP'" @click="runGroupValidation">校验识别条件</button>
        </div>
        <div class="panel-body">
          <p v-if="product.groupMode !== 'GROUP'" class="notice info">
            当前不启用产品组，所有业务明细直接使用产品级规则。
            <template v-if="scopes.some((scope) => !scope.groupCode && scope.status === 'ACTIVE')">
              当前产品已有产品级规则包；切换为启用产品组前，请先在「规则配置」中解除这些关联。
            </template>
          </p>
          <template v-else>
            <p v-if="groupValidation" class="notice" :class="groupValidation.valid ? 'ok' : 'warn'">
              {{ groupValidation.valid ? "识别条件校验通过。" : "识别条件存在问题，请查看下表。" }}
              <span class="dim">{{ groupValidation.note }}</span>
            </p>
            <div v-if="!groups.length" class="empty">还没有产品组。点击「新增产品组」开始配置。</div>
            <table v-else class="tbl">
              <thead>
                <tr><th>编码</th><th>名称</th><th>说明</th><th>识别条件</th><th>规则包</th><th>状态</th><th class="num">排序</th><th></th></tr>
              </thead>
              <tbody>
                <tr v-for="group in groups" :key="group.code">
                  <td class="mono small">{{ group.code }}</td>
                  <td><strong>{{ group.name }}</strong></td>
                  <td class="dim small">{{ group.description || "—" }}</td>
                  <td>
                    <span class="tag" :class="CONDITION_TONE[group.conditionStatus]">{{ CONDITION_STATUS[group.conditionStatus] || group.conditionStatus }}</span>
                    <div v-if="group.conditionErrors.length" class="dim" style="font-size: 10.5px">{{ group.conditionErrors[0] }}</div>
                  </td>
                  <td class="num">{{ group.rulePackageCount }}</td>
                  <td><span class="tag" :class="group.status === 'ACTIVE' ? 'green' : 'muted'">{{ group.status === "ACTIVE" ? "启用" : "停用" }}</span></td>
                  <td class="num mono">{{ group.sortOrder }}</td>
                  <td class="num">
                    <button type="button" class="btn sm" @click="openGroupEdit(group)">编辑</button>
                    <button type="button" class="btn sm" @click="groupsToRules(group)">规则</button>
                    <button type="button" class="btn sm danger" @click="removeGroup(group)">删除</button>
                  </td>
                </tr>
              </tbody>
            </table>
            <div v-if="groupValidation" class="panel" style="margin-top: 10px">
              <div class="panel-head"><h3>识别校验结果</h3><span class="sub">{{ groupValidation.valid ? "通过" : "需要处理" }}</span></div>
              <div class="panel-body tight">
                <table class="tbl">
                  <thead><tr><th>产品组</th><th>状态</th><th>规则包</th><th>问题</th></tr></thead>
                  <tbody>
                    <tr v-for="entry in groupValidation.groups" :key="entry.code">
                      <td>{{ entry.name }}</td>
                      <td><span class="tag" :class="entry.valid ? 'green' : 'red'">{{ entry.valid ? "通过" : "存在问题" }}</span></td>
                      <td class="num">{{ entry.rulePackageCount }}</td>
                      <td class="dim small">{{ entry.errors.join("；") || "—" }}</td>
                    </tr>
                  </tbody>
                </table>
                <p v-if="groupValidation.warnings.length" class="notice warn" style="margin: 8px">{{ groupValidation.warnings.join("；") }}</p>
              </div>
            </div>
          </template>
        </div>
      </div>
    </div>

    <div v-else-if="tab === 'fields'" class="lq-field-layout">
      <aside class="panel lq-group-tree">
        <div class="panel-head">
          <h3>字段分组</h3>
          <span class="spacer"></span>
          <button type="button" class="btn xs" @click="openFieldGroupCreate">＋</button>
        </div>
        <div class="panel-body">
          <button type="button" class="lq-tree-item" :class="{ on: selectedGroup === '' }" @click="selectedGroup = ''">
            <span>全部字段</span><b>{{ fields.length }}</b>
          </button>
          <button
            v-for="group in fieldGroups"
            :key="group.code"
            type="button"
            class="lq-tree-item"
            :class="{ on: selectedGroup === group.code }"
            @click="selectedGroup = group.code"
          >
            <span>{{ group.name }}</span><b>{{ group.count }}</b>
          </button>
          <div v-if="selectedGroup" class="lq-tree-actions">
            <button type="button" class="btn xs" @click="openFieldGroupEdit(fieldGroupMap.get(selectedGroup))">编辑分组</button>
            <button type="button" class="btn xs danger" @click="removeFieldGroup(fieldGroupMap.get(selectedGroup))">删除</button>
          </div>
        </div>
      </aside>
      <section class="panel">
        <div class="panel-head">
          <h3>标准字段（{{ filteredFields.length }}）</h3>
          <span class="sub">{{ fieldGroups.length }} 个分组 · {{ fields.filter((field) => field.required).length }} 个必填</span>
          <span class="spacer"></span>
          <input v-model="fieldQuery" type="search" placeholder="搜索字段名称或编码" style="width: 220px" />
          <button type="button" class="btn sm" @click="openDictionaryManager">码值字典</button>
          <button type="button" class="btn sm primary" @click="openFieldCreate">＋ 新增字段</button>
        </div>
        <div class="panel-body tight">
          <table class="tbl lq-fields-table">
            <thead>
              <tr><th>字段名称</th><th style="width: 140px">字段编码</th><th style="width: 96px">分组</th><th style="width: 90px">数据类型</th><th style="width: 90px">业务类型</th><th style="width: 50px">必填</th><th style="width: 120px">码值字典</th><th style="width: 90px">被引用</th><th style="width: 62px">状态</th><th style="width: 96px">操作</th></tr>
            </thead>
            <tbody>
              <tr v-for="field in filteredFields" :key="field.code">
                <td><strong>{{ field.name }}</strong><div class="dim" style="font-size: 10.5px">{{ field.requiredNote }}</div></td>
                <td class="mono small">{{ field.code }}</td>
                <td class="small">{{ groupName(field.group) }}</td>
                <td class="mono small">{{ field.dataType }}</td>
                <td class="small">{{ field.businessType || "—" }}</td>
                <td>{{ field.required ? "是" : "否" }}</td>
                <td class="mono small">{{ field.dictionary || "—" }}</td>
                <td class="small">
                  <span v-if="field.references.groups.length">条件 {{ field.references.groups.length }}</span>
                  <span v-if="field.references.rules.length"> · 规则 {{ field.references.rules.length }}</span>
                  <span v-if="!field.references.groups.length && !field.references.rules.length" class="dim">—</span>
                </td>
                <td><span class="tag" :class="field.status === 'ACTIVE' ? 'green' : 'muted'">{{ field.status === "ACTIVE" ? "启用" : "停用" }}</span></td>
                <td class="num">
                  <button type="button" class="btn sm" @click="openFieldEdit(field)">编辑</button>
                  <button type="button" class="btn sm danger" @click="removeField(field)">删除</button>
                </td>
              </tr>
            </tbody>
          </table>
          <p v-if="!filteredFields.length" class="empty">没有符合条件的标准字段。</p>
        </div>
      </section>
    </div>

    <div v-else-if="tab === 'rules'">
      <div class="panel">
        <div class="panel-head">
          <h3>规则配置</h3>
          <span class="sub">维护产品或产品组与当前监管规则版本下规则包的适用关系。</span>
          <span class="spacer"></span>
          <button type="button" class="btn sm" @click="goParams">清单与参数</button>
        </div>
      </div>
      <p v-if="!scopeOptions.length" class="notice warn">请先在「产品组」页签创建并启用产品组，再配置产品组级规则。</p>
      <div v-else class="lq-rules-layout">
        <aside class="panel lq-scope-nav">
          <div class="panel-head"><h3>规则适用对象</h3></div>
          <div class="panel-body">
            <button
              v-for="entry in scopeOptions"
              :key="entry.code"
              type="button"
              class="lq-tree-item"
              :class="{ on: selectedScope === entry.code }"
              @click="selectedScope = entry.code"
            >
              <span>{{ entry.name }}</span><b>{{ scopes.filter((scope) => scope.groupCode === entry.code && scope.status === "ACTIVE").length }}</b>
            </button>
          </div>
        </aside>
        <section class="panel">
          <div class="panel-head">
            <h3>{{ currentScope ? currentScope.name : "规则包" }}</h3>
            <span class="sub">{{ scopePackages.length }} 个规则包</span>
            <span class="spacer"></span>
            <button type="button" class="btn sm primary" @click="openPackagePicker">＋ 添加规则包</button>
          </div>
          <div class="panel-body">
            <p v-if="scopeError" class="notice danger">{{ scopeError }}</p>
            <p v-if="!scopePackages.length" class="empty">当前适用对象还没有关联规则包。</p>
            <div v-for="pack in scopePackages" :key="pack.packageId" class="panel" style="margin-bottom: 10px">
              <div class="panel-head">
                <h3>{{ pack.packageName }}</h3>
                <span class="sub mono">{{ pack.packageId }} · {{ pack.stageLabel }} · {{ pack.ruleCount }} 条规则</span>
                <span class="spacer"></span>
                <button type="button" class="btn sm danger" @click="removeScope(pack.packageId)">解除关联</button>
              </div>
              <div class="panel-body tight">
                <table class="tbl">
                  <thead><tr><th>规则编号</th><th>规则名称</th><th>类型</th><th class="num">优先级</th><th>输入变量</th><th>输出变量</th><th>适用</th></tr></thead>
                  <tbody>
                    <tr v-for="rule in pack.rules" :key="rule.id">
                      <td class="mono small">{{ rule.id }}</td>
                      <td>{{ rule.name }}</td>
                      <td class="small">{{ rule.ruleTypeName || rule.ruleType }}</td>
                      <td class="num mono">{{ rule.priority }}</td>
                      <td class="mono small">{{ (rule.inputs || []).join(", ") || "—" }}</td>
                      <td class="mono small">{{ (rule.outputs || []).join(", ") || "—" }}</td>
                      <td><span class="tag" :class="rule.applicable === false ? 'muted' : 'green'">{{ rule.applicable === false ? "本产品不适用" : "适用" }}</span></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>

    <div v-else-if="tab === 'preview'">
      <div class="panel">
        <div class="panel-head">
          <h3>规则预览</h3>
          <span class="sub">按当前适用对象展示规则执行路径，不执行计算。</span>
          <span class="spacer"></span>
          <select v-model="previewScope" style="width: auto; min-width: 180px">
            <option v-for="entry in scopeOptions" :key="entry.code" :value="entry.code">{{ entry.name }}</option>
          </select>
        </div>
      </div>
      <p v-if="!previewPackages.length" class="empty">当前适用对象还没有关联规则包，无法生成预览。</p>
      <div v-else class="lq-preview-layout">
        <div class="lq-flow">
          <div v-for="pack in previewPackages" :key="pack.packageId" class="lq-flow-node">
            <div class="lq-flow-stage">{{ pack.stageLabel }}</div>
            <div class="lq-flow-package">
              <b>{{ pack.packageName }}</b>
              <span class="mono small">{{ pack.packageId }} · {{ previewRules(pack).length }} 条适用规则</span>
            </div>
            <div class="lq-flow-rules">
              <button
                v-for="rule in previewRules(pack)"
                :key="rule.id"
                type="button"
                class="lq-flow-rule"
                :class="{ on: previewRule && previewRule.id === rule.id }"
                @click="selectPreviewRule(rule)"
              >{{ rule.id }} {{ rule.name }}</button>
              <span v-if="!previewRules(pack).length" class="dim small">本产品没有适用规则</span>
            </div>
          </div>
        </div>
        <div v-if="previewRule" class="panel lq-rule-detail">
          <div class="panel-head">
            <h3>{{ previewRule.id }} · {{ previewRule.name }}</h3>
            <span class="tag blue">{{ previewRule.ruleTypeName || previewRule.ruleType }}</span>
          </div>
          <div class="panel-body">
            <div class="kv small">
              <div class="k">规则包</div><div class="mono">{{ previewRule.packageName }}</div>
              <div class="k">阶段</div><div>{{ previewRule.sequence === 10 ? "资格认定" : "等级 / 类别" }}</div>
              <div class="k">优先级</div><div class="mono">{{ previewRule.priority }}</div>
              <div class="k">执行条件</div><div class="mono small">{{ previewRule.condition || "—" }}</div>
              <div class="k">输出结果</div><div class="mono small">{{ previewRule.result || "—" }}</div>
              <div class="k">监管依据</div><div>{{ previewRule.basis || "—" }}</div>
              <div class="k">输入字段</div><div class="mono small">{{ (previewRule.inputs || []).join(", ") || "—" }}</div>
              <div class="k">输出变量</div><div class="mono small">{{ (previewRule.outputs || []).join(", ") || "—" }}</div>
            </div>
            <table v-if="inputFields(previewRule).length" class="tbl" style="margin-top: 10px">
              <thead><tr><th>输入字段</th><th>编码</th><th>数据类型</th><th>业务类型</th><th>单位</th><th>所属分组</th></tr></thead>
              <tbody>
                <tr v-for="field in inputFields(previewRule)" :key="field.code">
                  <td>{{ field.name }}</td>
                  <td class="mono small">{{ field.code }}</td>
                  <td class="mono small">{{ field.dataType }}</td>
                  <td class="small">{{ field.businessType || "—" }}</td>
                  <td class="small">{{ field.unit || "—" }}</td>
                  <td class="small">{{ groupName(field.group) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>

    <Drawer :open="basicOpen" title="编辑产品基本信息" wide @close="basicOpen = false">
      <p v-if="basicError" class="notice danger">{{ basicError }}</p>
      <div class="grid c2">
        <div class="field"><label>产品名称</label><input v-model="basicForm.name" /></div>
        <div class="field"><label>业务大类</label><input v-model="basicForm.category" /></div>
        <div class="field"><label>计量侧别</label>
          <select v-model="basicForm.side">
            <option value="ASSET">资产端</option><option value="INFLOW">现金流入</option><option value="OUTFLOW">现金流出</option>
          </select>
        </div>
        <div class="field"><label>来源系统</label><input v-model="basicForm.source" /></div>
        <div class="field"><label>状态</label>
          <select v-model="basicForm.status">
            <option value="LIVE">已启用</option><option value="DRAFT">草稿</option><option value="DISABLED">已停用</option>
          </select>
        </div>
        <div class="field"><label>参数键</label><input v-model="basicForm.paramKey" /></div>
      </div>
      <div class="field"><label>产品说明</label><textarea v-model="basicForm.description" rows="3"></textarea></div>
      <template #footer>
        <button type="button" class="btn" @click="basicOpen = false">取消</button>
        <span class="spacer"></span>
        <button type="button" class="btn primary" :disabled="basicSaving" @click="saveBasic">{{ basicSaving ? "保存中…" : "保存" }}</button>
      </template>
    </Drawer>

    <Drawer :open="groupOpen" :title="groupEditingCode ? '编辑产品组' : '新增产品组'" wide @close="groupOpen = false">
      <p v-if="groupError" class="notice danger">{{ groupError }}</p>
      <div class="grid c2">
        <div class="field"><label>产品组编码</label><input v-model="groupForm.groupCode" :disabled="!!groupEditingCode" placeholder="如 NORMAL_LOAN" /></div>
        <div class="field"><label>产品组名称</label><input v-model="groupForm.name" placeholder="如 正常类贷款" /></div>
        <div class="field"><label>排序号</label><input v-model.number="groupForm.sortOrder" type="number" /></div>
        <div class="field"><label>状态</label>
          <select v-model="groupForm.status"><option value="ACTIVE">启用</option><option value="DISABLED">停用</option></select>
        </div>
      </div>
      <div class="field"><label>产品组说明</label><textarea v-model="groupForm.description" rows="2"></textarea></div>
      <div class="field">
        <label>识别条件</label>
        <ConditionBuilder
          v-model="groupForm.conditions"
          :fields="activeFields"
          :dictionaries="dictionaries"
        />
        <span class="hint">条件直接引用当前产品的标准字段；枚举字段的比较值来自码值字典。</span>
      </div>
      <template #footer>
        <button type="button" class="btn" @click="groupOpen = false">取消</button>
        <span class="spacer"></span>
        <button type="button" class="btn primary" :disabled="groupSaving" @click="saveGroup">{{ groupSaving ? "保存中…" : "保存" }}</button>
      </template>
    </Drawer>

    <Drawer :open="fieldGroupOpen" :title="fieldGroupEditingCode ? '编辑字段分组' : '新增字段分组'" @close="fieldGroupOpen = false">
      <p v-if="fieldGroupError" class="notice danger">{{ fieldGroupError }}</p>
      <div class="grid c2">
        <div class="field"><label>分组编码</label><input v-model="fieldGroupForm.groupCode" :disabled="!!fieldGroupEditingCode" placeholder="如 G_LOAN" /></div>
        <div class="field"><label>分组名称</label><input v-model="fieldGroupForm.name" placeholder="如 贷款属性" /></div>
        <div class="field"><label>上级分组</label>
          <select v-model="fieldGroupForm.parentCode">
            <option value="">无</option>
            <option v-for="group in fieldGroups" :key="group.code" :value="group.code">{{ group.name }}</option>
          </select>
        </div>
        <div class="field"><label>排序号</label><input v-model.number="fieldGroupForm.sortOrder" type="number" /></div>
        <div class="field"><label>状态</label>
          <select v-model="fieldGroupForm.status"><option value="ACTIVE">启用</option><option value="DISABLED">停用</option></select>
        </div>
      </div>
      <div class="field"><label>分组说明</label><textarea v-model="fieldGroupForm.description" rows="2"></textarea></div>
      <template #footer>
        <button type="button" class="btn" @click="fieldGroupOpen = false">取消</button>
        <span class="spacer"></span>
        <button type="button" class="btn primary" :disabled="fieldGroupSaving" @click="saveFieldGroup">{{ fieldGroupSaving ? "保存中…" : "保存" }}</button>
      </template>
    </Drawer>

    <Drawer :open="fieldOpen" :title="fieldEditingCode ? '编辑标准字段' : '新增标准字段'" wide @close="fieldOpen = false">
      <p v-if="fieldError" class="notice danger">{{ fieldError }}</p>
      <div class="grid c2">
        <div class="field"><label>字段编码</label><input v-model="fieldForm.code" :disabled="!!fieldEditingCode" placeholder="如 amount" /></div>
        <div class="field"><label>字段名称</label><input v-model="fieldForm.name" placeholder="如 业务金额" /></div>
        <div class="field"><label>所属分组</label>
          <select v-model="fieldForm.group">
            <option value="">未分组</option>
            <option v-for="group in fieldGroups" :key="group.code" :value="group.code">{{ group.name }}</option>
          </select>
        </div>
        <div class="field"><label>数据类型</label>
          <select v-model="fieldForm.dataType"><option v-for="type in DATA_TYPES" :key="type" :value="type">{{ type }}</option></select>
        </div>
        <div class="field"><label>业务类型</label>
          <select v-model="fieldForm.businessType"><option value="">未指定</option><option v-for="type in BUSINESS_TYPES" :key="type" :value="type">{{ type }}</option></select>
        </div>
        <div class="field"><label>计量角色</label>
          <select v-model="fieldForm.role"><option v-for="(label, key) in ROLE_LABEL" :key="key" :value="key">{{ label }}</option></select>
        </div>
        <div class="field"><label>单位</label><input v-model="fieldForm.unit" placeholder="HKD / % / 天" /></div>
        <div class="field"><label>精度</label><input v-model.number="fieldForm.precision" type="number" /></div>
        <div class="field"><label>值域类型</label>
          <select v-model="fieldForm.valueType"><option v-for="type in VALUE_TYPES" :key="type" :value="type">{{ type }}</option></select>
        </div>
        <div class="field"><label>码值字典</label>
          <select v-model="fieldForm.dictionary">
            <option value="">无</option>
            <option v-for="dict in dictionaries" :key="dict.code" :value="dict.code">{{ dict.name }}（{{ dict.code }}）</option>
          </select>
        </div>
        <div class="field"><label>来源类型</label>
          <select v-model="fieldForm.sourceType"><option value="">未指定</option><option v-for="type in SOURCE_TYPES" :key="type" :value="type">{{ type }}</option></select>
        </div>
        <div class="field"><label>来源列</label><input v-model="fieldForm.source" placeholder="如 BOOK_VALUE_AMT" /></div>
        <div class="field"><label>是否必填</label>
          <select v-model="fieldForm.required"><option :value="false">否</option><option :value="true">是</option></select>
        </div>
        <div class="field"><label>允许空值</label>
          <select v-model="fieldForm.nullable"><option :value="null">未指定</option><option :value="true">是</option><option :value="false">否</option></select>
        </div>
        <div class="field"><label>默认值</label><input v-model="fieldForm.defaultValue" /></div>
        <div class="field"><label>状态</label>
          <select v-model="fieldForm.status"><option value="ACTIVE">启用</option><option value="DISABLED">停用</option></select>
        </div>
      </div>
      <div class="field"><label>枚举值（逗号分隔，仅无字典时使用）</label><input v-model="fieldForm.enumText" /></div>
      <div class="field"><label>字段说明</label><textarea v-model="fieldForm.description" rows="2"></textarea></div>
      <div v-if="fieldEditingCode" class="panel">
        <div class="panel-head"><h3>引用情况</h3></div>
        <div class="panel-body">
          <p class="small">产品组识别条件：{{ (fields.find((field) => field.code === fieldEditingCode) || {}).references?.groups?.join("、") || "—" }}</p>
          <p class="small">规则：{{ (fields.find((field) => field.code === fieldEditingCode) || {}).references?.rules?.join("、") || "—" }}</p>
        </div>
      </div>
      <template #footer>
        <button type="button" class="btn" @click="fieldOpen = false">取消</button>
        <span class="spacer"></span>
        <button type="button" class="btn primary" :disabled="fieldSaving" @click="saveField">{{ fieldSaving ? "保存中…" : "保存" }}</button>
      </template>
    </Drawer>

    <Drawer :open="dictOpen" title="码值字典" wide @close="dictOpen = false">
      <p v-if="dictError" class="notice danger">{{ dictError }}</p>
      <p v-if="itemError" class="notice danger">{{ itemError }}</p>
      <div class="lq-dict-layout">
        <div class="panel">
          <div class="panel-head">
            <h3>字典</h3>
            <span class="spacer"></span>
            <button type="button" class="btn xs" @click="openDictionaryCreate">＋</button>
          </div>
          <div class="panel-body">
            <button
              v-for="dict in dictionaries"
              :key="dict.code"
              type="button"
              class="lq-tree-item"
              :class="{ on: selectedDictCode === dict.code }"
              @click="selectedDictCode = dict.code"
            >
              <span>{{ dict.name }}</span><b>{{ dict.items.length }}</b>
            </button>
            <div v-if="selectedDictionary" class="lq-tree-actions">
              <button type="button" class="btn xs" @click="openDictionaryEdit(selectedDictionary)">编辑字典</button>
              <button type="button" class="btn xs danger" @click="removeDictionary(selectedDictionary)">删除</button>
            </div>
          </div>
        </div>
        <div class="panel">
          <div class="panel-head">
            <h3>{{ dictEditingCode ? "编辑字典" : "新增字典" }}</h3>
            <span class="spacer"></span>
            <button type="button" class="btn xs primary" :disabled="dictSaving" @click="saveDictionary">{{ dictSaving ? "保存中…" : "保存字典" }}</button>
          </div>
          <div class="panel-body">
            <div class="grid c2">
              <div class="field"><label>字典编码</label><input v-model="dictForm.dictCode" :disabled="!!dictEditingCode" /></div>
              <div class="field"><label>字典名称</label><input v-model="dictForm.name" /></div>
              <div class="field"><label>字典类型</label>
                <select v-model="dictForm.dictType"><option value="PUBLIC">公共字典</option><option value="PRODUCT">产品专属</option></select>
              </div>
              <div class="field"><label>状态</label>
                <select v-model="dictForm.status"><option value="ACTIVE">启用</option><option value="DISABLED">停用</option></select>
              </div>
            </div>
            <div class="field"><label>说明</label><textarea v-model="dictForm.description" rows="2"></textarea></div>
          </div>
        </div>
      </div>
      <div v-if="selectedDictionary" class="panel" style="margin-top: 10px">
        <div class="panel-head">
          <h3>{{ selectedDictionary.name }} · 码值</h3>
          <span class="sub mono">{{ selectedDictionary.code }} · {{ selectedDictionary.items.length }} 项</span>
          <span class="spacer"></span>
          <button type="button" class="btn sm primary" @click="openItemCreate">＋ 新增码值</button>
        </div>
        <div class="panel-body">
          <div class="grid c4">
            <div class="field"><label>码值编码</label><input v-model="itemForm.itemCode" :disabled="!!itemEditingCode" /></div>
            <div class="field"><label>码值名称</label><input v-model="itemForm.name" /></div>
            <div class="field"><label>排序号</label><input v-model.number="itemForm.sortOrder" type="number" /></div>
            <div class="field"><label>状态</label>
              <select v-model="itemForm.status"><option value="ACTIVE">启用</option><option value="DISABLED">停用</option></select>
            </div>
          </div>
          <div class="inline-fields" style="margin: 8px 0">
            <button type="button" class="btn sm primary" :disabled="itemSaving" @click="saveItem">{{ itemSaving ? "保存中…" : itemEditingCode ? "保存码值" : "新增码值" }}</button>
            <button v-if="itemEditingCode" type="button" class="btn sm" @click="openItemCreate">取消编辑</button>
          </div>
          <table class="tbl">
            <thead><tr><th>码值编码</th><th>码值名称</th><th class="num">排序</th><th>状态</th><th></th></tr></thead>
            <tbody>
              <tr v-for="item in selectedDictionary.items" :key="item.code">
                <td class="mono small">{{ item.code }}</td>
                <td>{{ item.name }}</td>
                <td class="num mono">{{ item.sortOrder }}</td>
                <td><span class="tag" :class="item.status === 'ACTIVE' ? 'green' : 'muted'">{{ item.status === "ACTIVE" ? "启用" : "停用" }}</span></td>
                <td class="num">
                  <button type="button" class="btn sm" @click="openItemEdit(item)">编辑</button>
                  <button type="button" class="btn sm danger" @click="removeItem(item)">删除</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </Drawer>

    <Drawer :open="packagePickerOpen" title="选择规则包" wide @close="packagePickerOpen = false">
      <p v-if="scopeError" class="notice danger">{{ scopeError }}</p>
      <div class="inline-fields" style="margin-bottom: 10px">
        <input v-model="packageQuery" type="search" placeholder="搜索规则包编号或名称" style="flex: 1" />
        <select v-model="packageStage" style="width: auto; min-width: 160px">
          <option value="">全部阶段</option>
          <option v-for="stage in packageStages" :key="stage" :value="stage">{{ stage }}</option>
        </select>
      </div>
      <table class="tbl">
        <thead><tr><th></th><th>规则包</th><th>阶段</th><th>侧别</th><th class="num">规则数</th></tr></thead>
        <tbody>
          <tr v-for="pack in availablePackages" :key="pack.packageId">
            <td><input type="checkbox" :checked="selectedPackages.includes(pack.packageId)" @change="togglePackage(pack.packageId)" /></td>
            <td><strong>{{ pack.packageName }}</strong><div class="mono dim" style="font-size: 10.5px">{{ pack.packageId }}</div></td>
            <td class="small">{{ pack.stageLabel }}</td>
            <td class="small">{{ SIDE_LABEL[pack.side] || pack.side }}</td>
            <td class="num mono">{{ pack.ruleCount }}</td>
          </tr>
        </tbody>
      </table>
      <p v-if="!availablePackages.length" class="empty">没有可添加的规则包。</p>
      <template #footer>
        <button type="button" class="btn" @click="packagePickerOpen = false">取消</button>
        <span class="spacer"></span>
        <button type="button" class="btn primary" :disabled="scopeSaving || !selectedPackages.length" @click="addPackages">
          {{ scopeSaving ? "添加中…" : "添加所选规则包" }}
        </button>
      </template>
    </Drawer>

    <Drawer :open="completenessOpen" title="配置完整性" wide @close="completenessOpen = false">
      <div class="lq-progress" style="margin-bottom: 14px">
        <div class="lq-progress-bar"><i :style="{ width: completeness.score + '%' }"></i></div>
        <span :class="{ ok: completeness.score >= 100 }">{{ completeness.score }}% · {{ completeness.status }}</span>
      </div>
      <table class="tbl">
        <thead><tr><th>检查项</th><th>状态</th><th>说明</th><th></th></tr></thead>
        <tbody>
          <tr v-for="entry in completeness.items" :key="entry.key">
            <td>{{ entry.label }}</td>
            <td><span class="tag" :class="ITEM_TONE[entry.status]">{{ ITEM_STATUS[entry.status] }}</span></td>
            <td class="dim small">{{ entry.detail }}</td>
            <td class="num">
              <button type="button" class="btn sm" :disabled="entry.status === 'NA'" @click="goFromCompleteness(entry)">去处理</button>
            </td>
          </tr>
        </tbody>
      </table>
    </Drawer>
  </template>
</template>

<style scoped>
.lq-product-head { display: flex; justify-content: space-between; gap: 16px; margin-bottom: 12px; }
.lq-product-head h2 { margin: 0 0 4px; font-size: 18px; }
.lq-product-head p { margin: 0; color: var(--muted); font-size: 12.5px; }
.lq-product-head-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
.lq-tabs { display: flex; gap: 6px; align-items: center; margin-bottom: 12px; flex-wrap: wrap; }
.lq-tabs button { border: 1px solid var(--line); background: #fff; border-radius: 999px; padding: 5px 12px; font-size: 12px; color: #475569; }
.lq-tabs button.on { background: #eef2ff; border-color: #a5b4fc; color: #3730a3; font-weight: 600; }
.lq-field-layout { display: grid; grid-template-columns: 220px minmax(0, 1fr); gap: 12px; align-items: start; }
.lq-rules-layout { display: grid; grid-template-columns: 220px minmax(0, 1fr); gap: 12px; align-items: start; }
.lq-group-tree .panel-body, .lq-scope-nav .panel-body { display: flex; flex-direction: column; gap: 4px; }
.lq-tree-item { display: flex; align-items: center; justify-content: space-between; gap: 8px; border: 0; background: none; text-align: left; padding: 6px 8px; border-radius: 6px; font-size: 12px; color: #334155; cursor: pointer; }
.lq-tree-item:hover { background: #f1f5f9; }
.lq-tree-item.on { background: #eef2ff; color: #3730a3; font-weight: 600; }
.lq-tree-item b { font-size: 11px; color: var(--muted); }
.lq-tree-actions { display: flex; gap: 4px; margin-top: 6px; flex-wrap: wrap; }
.lq-preview-layout { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr); gap: 12px; align-items: start; }
.lq-flow { display: flex; flex-direction: column; gap: 8px; }
.lq-flow-node { border: 1px solid var(--line); background: #fff; border-radius: 10px; padding: 10px 12px; display: flex; flex-direction: column; gap: 4px; }
.lq-flow-stage { font-size: 10.5px; color: #3730a3; background: #eef2ff; border-radius: 999px; padding: 1px 8px; align-self: flex-start; }
.lq-flow-package { display: flex; flex-direction: column; gap: 1px; }
.lq-flow-package b { font-size: 13px; }
.lq-flow-package span { color: var(--muted); font-size: 10.5px; }
.lq-flow-rules { display: flex; flex-direction: column; gap: 3px; margin-top: 4px; }
.lq-flow-rule { border: 0; background: #f8fafc; border-radius: 6px; text-align: left; padding: 4px 7px; font-size: 11.5px; color: #334155; cursor: pointer; }
.lq-flow-rule:hover { background: #eef2ff; }
.lq-flow-rule.on { background: #eef2ff; color: #3730a3; font-weight: 600; }
.lq-rule-detail { position: sticky; top: 12px; }
.lq-progress { display: flex; align-items: center; gap: 8px; }
.lq-progress-bar { flex: 1; height: 8px; background: #eef2ff; border-radius: 6px; overflow: hidden; }
.lq-progress-bar i { display: block; height: 100%; background: #f59e0b; }
.lq-progress span { font-size: 11px; color: #b45309; }
.lq-progress span.ok { color: #047857; }
.lq-dict-layout { display: grid; grid-template-columns: 240px minmax(0, 1fr); gap: 12px; align-items: start; }
@media (max-width: 1000px) {
  .lq-field-layout, .lq-rules-layout, .lq-preview-layout, .lq-dict-layout { grid-template-columns: 1fr; }
  .lq-product-head { flex-direction: column; }
  .lq-product-head-actions { justify-content: flex-start; }
}

.lq-crumb {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
  color: var(--muted);
  font-size: 11.5px;
  line-height: 1.4;
}
.lq-crumb button {
  padding: 0;
  border: 0;
  background: none;
  color: #1d4ed8;
  font: inherit;
  cursor: pointer;
}
.lq-crumb button:hover { text-decoration: underline; }
.lq-crumb .sep { color: #cbd5e1; }
.lq-crumb .current { color: #334155; font-weight: 600; }

/* 标准字段清单紧凑化 */
.lq-fields-table { table-layout: fixed; font-size: 11px; }
.lq-fields-table th {
  padding: 6px 7px;
  font-size: 10.5px;
  line-height: 1.3;
  white-space: nowrap;
  background: #f8fafc;
}
.lq-fields-table td {
  padding: 5px 7px;
  font-size: 10.5px;
  line-height: 1.35;
  vertical-align: middle;
}
.lq-fields-table td strong { font-size: 11.5px; font-weight: 600; }
.lq-fields-table td .mono,
.lq-fields-table td .small { font-size: 10.5px; }
.lq-fields-table .tag { padding: 0 6px; font-size: 9.5px; }
.lq-fields-table .btn.sm {
  padding: 1px 6px;
  font-size: 10px;
  margin-left: 2px;
  white-space: nowrap;
}
</style>
