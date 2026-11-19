<script setup>
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  createLiquidityField, deleteLiquidityField, fetchLiquidityProduct,
  saveLiquidityField, saveLiquidityProduct
} from "@/api/liquidity";
import { useContext } from "@/composables/useContext";
import Drawer from "@/components/Drawer.vue";
import { askConfirm } from "@/utils/confirm";

const route = useRoute();
const router = useRouter();
const { session, scopeVersion } = useContext();
const loading = ref(true);
const error = ref("");
const data = ref(null);
const tab = ref(String(route.query.tab || route.params.tab || "overview"));
const drawer = ref(false);
const editing = ref(false);
const saving = ref(false);
const formError = ref("");
const form = ref(blankField());
const setupStep = ref(1);
const setupSaving = ref(false);
const setupError = ref("");
const setupForm = ref(blankSetup());

function blankSetup() {
  return {
    name: "", category: "", productGroup: "", side: "ASSET", source: "",
    description: "", paramKey: "", domains: ["CAPITAL", "LIQUIDITY", "NSFR"]
  };
}

function loadSetup() {
  if (!product.value) return;
  setupForm.value = {
    name: product.value.name,
    category: product.value.category,
    productGroup: product.value.productGroup,
    side: product.value.side,
    source: product.value.source,
    description: product.value.description,
    paramKey: product.value.paramKey,
    domains: (product.value.domains || []).slice()
  };
}

async function saveSetup() {
  if (setupSaving.value || !product.value) return;
  setupSaving.value = true;
  setupError.value = "";
  try {
    await saveLiquidityProduct(product.value.code, {
      ...setupForm.value,
      jurisdiction: jurisdiction.value,
      version: version.value,
      status: product.value.status,
      ruleCount: product.value.ruleCount
    });
    await load();
    if (setupStep.value < 4) setupStep.value += 1;
  } catch (err) {
    setupError.value = err.message;
  } finally {
    setupSaving.value = false;
  }
}

const TABS = [
  ["overview", "概览"],
  ["setup", "配置向导"],
  ["groups", "产品组信息"],
  ["fields", "标准字段"],
  ["rules", "规则配置"],
  ["preview", "规则预览"],
  ["check", "配置完整性"]
];
const SIDE_LABEL = { ASSET: "资产端", INFLOW: "现金流入", OUTFLOW: "现金流出" };
const ROLE_LABEL = {
  NONE: "不参与计量", VALUATION: "计量价值", AMOUNT: "业务金额",
  ACCRUED: "应计利息", UNDRAWN: "未提取额度"
};

const jurisdiction = computed(() => String(route.query.jurisdiction || session.jurisdiction || "HK"));
const version = computed(() => String(route.query.version || scopeVersion.value || ""));
const product = computed(() => (data.value ? data.value.product : null));
const rules = computed(() => (data.value ? data.value.rules : []));

const ruleStages = computed(() => {
  const stages = new Map();
  rules.value.forEach((rule) => {
    const key = rule.packageId || "OTHER";
    if (!stages.has(key)) {
      stages.set(key, {
        packageId: key,
        title: rule.packageName || rule.packageId,
        sequence: rule.sequence,
        side: rule.side,
        rules: []
      });
    }
    stages.get(key).rules.push(rule);
  });
  return [...stages.values()].sort((a, b) => a.sequence - b.sequence || a.packageId.localeCompare(b.packageId));
});

const amountFields = computed(() => (product.value ? product.value.fields.filter((field) => field.role && field.role !== "NONE") : []));

function blankField() {
  return {
    code: "",
    name: "",
    category: "FC_ID",
    group: "基础信息",
    groupOrder: 1,
    dataType: "STRING",
    role: "NONE",
    required: false,
    valueType: "FREE_TEXT",
    dictionary: "",
    source: "",
    description: "",
    aliases: ""
  };
}

async function load() {
  loading.value = true;
  error.value = "";
  try {
    if (route.query.jurisdiction && route.query.version) {
      const target = (session.versions || []).find(
        (item) => item.jurisdiction === jurisdiction.value && item.version === version.value
      );
      if (target) {
        session.jurisdiction = target.jurisdiction;
        session.versionId = target.id;
      }
    }
    data.value = await fetchLiquidityProduct(route.params.code, jurisdiction.value, version.value);
    loadSetup();
  } catch (err) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
}

function goTab(key) {
  tab.value = key;
  router.replace({
    name: "liquidity-product",
    params: { code: route.params.code, tab: key },
    query: route.query
  });
}

function openCreateField() {
  editing.value = false;
  form.value = blankField();
  formError.value = "";
  drawer.value = true;
}

function openEditField(field) {
  editing.value = true;
  form.value = {
    code: field.code,
    name: field.name,
    category: field.category,
    group: field.group,
    groupOrder: field.groupOrder,
    dataType: field.dataType,
    role: field.role,
    required: field.required,
    valueType: field.valueType,
    dictionary: field.dictionary,
    source: field.source,
    description: field.description,
    aliases: (field.aliases || []).join(", ")
  };
  formError.value = "";
  drawer.value = true;
}

async function submitField() {
  if (saving.value) return;
  formError.value = "";
  if (!form.value.code.trim()) { formError.value = "请填写字段编码"; return; }
  if (!form.value.name.trim()) { formError.value = "请填写字段名称"; return; }
  saving.value = true;
  try {
    const body = {
      ...form.value,
      aliases: String(form.value.aliases || "").split(/[,，]/).map((item) => item.trim()).filter(Boolean),
      jurisdiction: jurisdiction.value,
      version: version.value
    };
    if (editing.value) await saveLiquidityField(route.params.code, form.value.code, body);
    else await createLiquidityField(route.params.code, body);
    drawer.value = false;
    await load();
  } catch (err) {
    formError.value = err.message;
  } finally {
    saving.value = false;
  }
}

async function removeField(field) {
  const yes = await askConfirm(`将从产品「${product.value.name}」删除字段「${field.name}」？`, { title: "删除字段", danger: true });
  if (!yes) return;
  try {
    await deleteLiquidityField(route.params.code, field.code, jurisdiction.value, version.value);
    await load();
  } catch (err) {
    error.value = err.message;
  }
}

watch(() => route.params.code, load);
watch(() => route.query.tab, (value) => { tab.value = String(value || "overview"); });
watch(() => route.params.tab, (value) => { if (value) tab.value = String(value); });
onMounted(load);
</script>

<template>
  <p v-if="error" class="notice danger">{{ error }}</p>
  <div v-if="loading" class="empty">正在读取产品配置…</div>

  <template v-else-if="product">
    <div class="lq-product-head">
      <div>
        <h2>{{ product.name }}</h2>
        <p>
          <span class="mono">{{ product.code }}</span> · {{ product.category }} ·
          {{ SIDE_LABEL[product.side] || product.side }} · {{ version }}
        </p>
      </div>
      <div class="lq-product-head-actions">
        <span class="tag" :class="product.status === 'LIVE' ? 'green' : product.status === 'DRAFT' ? 'amber' : 'muted'">
          {{ product.status === "LIVE" ? "已启用" : product.status === "DRAFT" ? "草稿" : "已停用" }}
        </span>
        <button type="button" class="btn sm" @click="router.push({ path: '/liquidity-config' })">返回产品清单</button>
      </div>
    </div>

    <div class="lq-tabs">
      <button v-for="[key, label] in TABS" :key="key" type="button" :class="{ on: tab === key }" @click="goTab(key)">
        {{ label }}
      </button>
    </div>

    <div v-if="tab === 'overview'" class="grid c2">
      <div class="panel">
        <div class="panel-head"><h3>产品概览</h3><span class="sub">配置完整性 {{ product.completeness.score }}%</span></div>
        <div class="panel-body">
          <div class="kv small">
            <div class="k">产品编码</div><div class="mono">{{ product.code }}</div>
            <div class="k">产品名称</div><div>{{ product.name }}</div>
            <div class="k">业务大类</div><div>{{ product.category || "—" }}</div>
            <div class="k">产品组</div><div>{{ product.productGroup || "—" }}</div>
            <div class="k">计量侧别</div><div>{{ SIDE_LABEL[product.side] || product.side }}</div>
            <div class="k">来源系统</div><div class="mono small">{{ product.source || "—" }}</div>
            <div class="k">参数键</div><div class="mono small">{{ product.paramKey || "—" }}</div>
            <div class="k">产品说明</div><div>{{ product.description || "—" }}</div>
          </div>
        </div>
      </div>
      <div class="panel">
        <div class="panel-head"><h3>适用监管领域</h3><span class="sub">一个产品多处复用</span></div>
        <div class="panel-body tight">
          <table class="tbl">
            <thead><tr><th>监管领域</th><th>适用状态</th><th>说明</th></tr></thead>
            <tbody>
              <tr v-for="domain in product.domains" :key="domain">
                <td>{{ { CAPITAL: "资本充足率", LIQUIDITY: "流动性覆盖率", NSFR: "净稳定资金比例" }[domain] || domain }}</td>
                <td><span class="tag green">适用</span></td>
                <td class="dim">该产品需配置此领域规则</td>
              </tr>
            </tbody>
          </table>
          <p class="dim" style="font-size: 11.5px; padding: 8px 10px 0">
            监管领域是产品的适用范围属性，不复制产品；进入规则配置时按领域筛选。
          </p>
        </div>
      </div>
      <div class="panel" style="grid-column: 1 / -1">
        <div class="panel-head"><h3>配置入口</h3></div>
        <div class="panel-body">
          <div class="lq-entry-cards">
            <button type="button" class="lq-entry" @click="goTab('setup')">
              <b>配置向导</b><span>按步骤完成产品配置</span>
            </button>
            <button type="button" class="lq-entry" @click="goTab('groups')">
              <b>产品组信息</b><span>{{ product.productGroups.length }} 个产品组</span>
            </button>
            <button type="button" class="lq-entry" @click="goTab('fields')">
              <b>标准字段</b><span>{{ product.fields.length }} 个字段</span>
            </button>
            <button type="button" class="lq-entry" @click="goTab('rules')">
              <b>规则配置</b><span>{{ rules.length }} 条规则</span>
            </button>
            <button type="button" class="lq-entry" @click="goTab('preview')">
              <b>规则预览</b><span>按阶段查看执行路径</span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <div v-else-if="tab === 'setup'" class="panel">
      <div class="panel-head">
        <h3>产品配置向导</h3>
        <span class="sub">第 {{ setupStep }} / 4 步</span>
      </div>
      <div class="panel-body">
        <p v-if="setupError" class="notice danger">{{ setupError }}</p>
        <div class="lq-tabs" style="margin-bottom: 12px">
          <button
            v-for="(label, index) in ['基本信息', '产品组与适用范围', '标准字段配置', '规则配置']"
            :key="label"
            type="button"
            :class="{ on: setupStep === index + 1 }"
            @click="setupStep = index + 1"
          >
            {{ index + 1 }}. {{ label }}
          </button>
        </div>

        <template v-if="setupStep === 1">
          <div class="grid c2">
            <div class="field"><label>产品编码</label><input :value="product.code" disabled /></div>
            <div class="field"><label>产品名称</label><input v-model="setupForm.name" /></div>
            <div class="field"><label>业务大类</label><input v-model="setupForm.category" /></div>
            <div class="field">
              <label>计量侧别</label>
              <select v-model="setupForm.side">
                <option value="ASSET">资产端</option><option value="INFLOW">现金流入</option><option value="OUTFLOW">现金流出</option>
              </select>
            </div>
            <div class="field"><label>来源系统</label><input v-model="setupForm.source" /></div>
            <div class="field"><label>参数键</label><input v-model="setupForm.paramKey" /></div>
          </div>
          <div class="field"><label>产品说明</label><textarea v-model="setupForm.description" rows="3"></textarea></div>
        </template>

        <template v-else-if="setupStep === 2">
          <div class="grid c2">
            <div class="field"><label>产品组</label><input v-model="setupForm.productGroup" placeholder="如 LOAN" /></div>
            <div class="field"><label>业务大类</label><input v-model="setupForm.category" /></div>
          </div>
          <label style="font-size: 11.5px; color: #475569">适用监管领域（可多选）</label>
          <div style="display: flex; gap: 16px; margin-top: 6px; flex-wrap: wrap">
            <label v-for="item in [
              ['CAPITAL', '资本充足率'], ['LIQUIDITY', '流动性覆盖率'], ['NSFR', '净稳定资金比例']
            ]" :key="item[0]" style="display: flex; align-items: center; gap: 6px; font-size: 12px">
              <input
                type="checkbox"
                :value="item[0]"
                :checked="setupForm.domains.includes(item[0])"
                @change="setupForm.domains = $event.target.checked
                  ? [...setupForm.domains, item[0]]
                  : setupForm.domains.filter((code) => code !== item[0])"
              />
              {{ item[1] }}
            </label>
          </div>
          <p class="dim" style="font-size: 11.5px; margin-top: 8px">
            产品组决定适用的字段模板与规则范围；监管领域是产品的适用范围属性，不复制产品。
          </p>
        </template>

        <template v-else-if="setupStep === 3">
          <div class="lq-statrow" style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px">
            <div class="lq-mini"><span>标准字段</span><b>{{ product.fields.length }}</b></div>
            <div class="lq-mini"><span>字段分组</span><b>{{ product.fieldGroups.length }}</b></div>
            <div class="lq-mini"><span>被规则引用</span><b>{{ product.fields.filter((field) => field.requiredByRule).length }}</b></div>
            <div class="lq-mini"><span>计量角色字段</span><b>{{ amountFields.length }}</b></div>
          </div>
          <div class="lq-chips">
            <span v-for="group in product.fieldGroups" :key="group.id" class="lq-chip">{{ group.name }}（{{ group.count }}）</span>
          </div>
          <button type="button" class="btn" @click="goTab('fields')">去维护标准字段 →</button>
        </template>

        <template v-else>
          <div class="lq-statrow" style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px">
            <div class="lq-mini"><span>关联规则</span><b>{{ rules.length }}</b></div>
            <div class="lq-mini"><span>规则包</span><b>{{ ruleStages.length }}</b></div>
            <div class="lq-mini"><span>产品组</span><b>{{ product.productGroups.length }}</b></div>
            <div class="lq-mini"><span>配置完整性</span><b>{{ product.completeness.score }}%</b></div>
          </div>
          <table class="tbl" style="margin-top: 8px">
            <thead><tr><th>规则包</th><th>阶段</th><th class="num">规则数</th></tr></thead>
            <tbody>
              <tr v-for="stage in ruleStages" :key="stage.packageId">
                <td class="mono small">{{ stage.packageId }} · {{ stage.title }}</td>
                <td class="small">{{ stage.sequence === 10 ? "资格认定" : "等级 / 类别" }}</td>
                <td class="num mono">{{ stage.rules.length }}</td>
              </tr>
            </tbody>
          </table>
          <p class="dim" style="font-size: 11.5px; margin-top: 8px">具体规则在「规则配置」页签只读展示；计算时按阶段和优先级执行。</p>
          <button type="button" class="btn" @click="goTab('rules')">查看规则配置 →</button>
        </template>

        <div style="display: flex; gap: 8px; margin-top: 14px">
          <button type="button" class="btn" :disabled="setupStep <= 1" @click="setupStep -= 1">← 上一步</button>
          <span class="spacer"></span>
          <button v-if="setupStep < 3" type="button" class="btn primary" :disabled="setupSaving" @click="saveSetup">
            {{ setupSaving ? "保存中…" : "保存并下一步 →" }}
          </button>
          <button v-else-if="setupStep === 3" type="button" class="btn primary" @click="setupStep = 4">下一步 →</button>
          <button v-else type="button" class="btn primary" @click="goTab('overview')">完成配置</button>
        </div>
      </div>
    </div>

    <div v-else-if="tab === 'groups'">
      <div class="panel">
        <div class="panel-head"><h3>产品组信息</h3><span class="sub">产品组决定适用的字段模板与规则范围</span></div>
        <div class="panel-body tight">
          <table class="tbl">
            <thead><tr><th>产品组</th><th>编码</th><th>类型</th><th>说明</th></tr></thead>
            <tbody>
              <tr v-for="group in product.productGroups" :key="group.code">
                <td><strong>{{ group.name }}</strong></td>
                <td class="mono small">{{ group.code }}</td>
                <td class="small">{{ group.kind }}</td>
                <td class="dim small">{{ group.desc }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <div class="panel">
        <div class="panel-head"><h3>规则适用范围</h3><span class="sub">按侧别自动确定</span></div>
        <div class="panel-body tight">
          <table class="tbl">
            <thead><tr><th>规则包</th><th>阶段</th><th>是否强制</th></tr></thead>
            <tbody>
              <tr v-for="stage in ruleStages" :key="stage.packageId">
                <td class="mono small">{{ stage.packageId }} · {{ stage.title }}</td>
                <td class="small">{{ stage.sequence === 10 ? "资格认定" : "等级 / 类别" }}</td>
                <td>
                  <span class="tag" :class="stage.sequence === 10 ? 'amber' : 'muted'">
                    {{ stage.sequence === 10 ? "必须配置" : "可选" }}
                  </span>
                </td>
              </tr>
              <tr>
                <td class="mono small">COEFF · 折扣率 / 费率</td>
                <td class="small">参数查表</td>
                <td><span class="tag amber">必须配置</span></td>
              </tr>
              <tr>
                <td class="mono small">CAP · 上限约束</td>
                <td class="small">组合层</td>
                <td><span class="tag muted">组合层统一</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div v-else-if="tab === 'fields'" class="panel">
      <div class="panel-head">
        <h3>标准字段（{{ product.fields.length }}）</h3>
        <span class="sub">{{ product.fieldGroups.length }} 个分组 · {{ amountFields.length }} 个计量角色字段</span>
        <span class="spacer"></span>
        <button type="button" class="btn sm primary" @click="openCreateField">＋ 新增字段</button>
      </div>
      <div class="panel-body">
        <div class="lq-chips">
          <span v-for="group in product.fieldGroups" :key="group.id" class="lq-chip">
            {{ group.name }}（{{ group.count }}）
          </span>
        </div>
        <table class="tbl">
          <thead>
            <tr>
              <th>字段名称</th><th>字段编码</th><th>分组</th><th>数据类型</th>
              <th>计量角色</th><th>值域</th><th>状态</th><th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="field in product.fields" :key="field.code">
              <td>
                <strong>{{ field.name }}</strong>
                <div v-if="field.required || field.requiredByRule" class="dim" style="font-size: 10.5px">
                  {{ field.required ? "字段必填" : "被规则引用" }}
                </div>
              </td>
              <td class="mono small">{{ field.code }}</td>
              <td class="small">{{ field.group || "—" }}</td>
              <td class="mono small">{{ field.dataType }}</td>
              <td class="small">{{ ROLE_LABEL[field.role] || field.role || "—" }}</td>
              <td class="small">
                {{ field.valueType }}
                <div v-if="field.dictionary" class="mono dim" style="font-size: 10.5px">{{ field.dictionary }}</div>
              </td>
              <td>
                <span class="tag" :class="field.status === 'ACTIVE' ? 'green' : 'muted'">
                  {{ field.status === "ACTIVE" ? "启用" : "停用" }}
                </span>
              </td>
              <td class="num">
                <button type="button" class="btn sm" @click="openEditField(field)">编辑</button>
                <button type="button" class="btn sm danger" @click="removeField(field)">删除</button>
              </td>
            </tr>
          </tbody>
        </table>
        <p class="dim" style="font-size: 11.5px; margin-top: 8px">
          字段元数据（类型、值域、码值）会驱动规则配置器的运算符与取值控件；被规则引用的字段在 Excel Mapping 中标记为必需。
        </p>
      </div>
    </div>

    <template v-else-if="tab === 'rules'">
      <div class="panel">
        <div class="panel-head"><h3>规则配置（{{ rules.length }} 条）</h3><span class="sub">按阶段与优先级只读展示</span></div>
        <div class="panel-body tight">
          <table class="tbl">
            <thead><tr><th>阶段</th><th>规则</th><th>类型</th><th>名称</th><th class="num">优先级</th><th>结果</th></tr></thead>
            <tbody>
              <tr v-for="rule in rules" :key="rule.id">
                <td class="dim small">{{ rule.packageName }}</td>
                <td class="mono small">{{ rule.id }}</td>
                <td><span class="tag blue">{{ rule.ruleTypeName || rule.ruleType }}</span></td>
                <td>{{ rule.name }}</td>
                <td class="num mono">{{ rule.priority }}</td>
                <td class="mono small dim">{{ rule.result }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>

    <template v-else-if="tab === 'preview'">
      <div class="panel">
        <div class="panel-head"><h3>规则执行路径</h3><span class="sub">按阶段顺序执行：资格认定 → 等级/类别 → 折扣率/费率 → 上限约束 → 最终计量</span></div>
        <div class="panel-body">
          <div class="lq-tree">
            <div v-for="(stage, index) in ruleStages" :key="stage.packageId" class="lq-tree-node">
              <b>{{ index + 1 }}. {{ stage.title }}</b>
              <span>{{ stage.rules.length }} 条规则（优先级从高到低）</span>
              <div v-for="rule in stage.rules.slice(0, 4)" :key="rule.id" class="lq-tree-rule">
                · {{ rule.id }} {{ rule.name }} → <code>{{ rule.result.split(",")[0] }}</code>
              </div>
            </div>
            <div class="lq-tree-node">
              <b>{{ ruleStages.length + 1 }}. 折扣率 / 费率查表</b>
              <span>按产品参数键 {{ product.paramKey || "（未配置）" }} 查 HQLA 折扣率或现金流入/流出率</span>
            </div>
            <div class="lq-tree-node">
              <b>{{ ruleStages.length + 2 }}. 上限约束与 LCR</b>
              <span>Level 2 合计 ≤ 40% · Level 2B ≤ 15% · 认可流入 ≤ 75% 流出 · LCR = HQLA ÷ 净流出 × 100%</span>
            </div>
          </div>
        </div>
      </div>
      <div class="grid c2">
        <div class="panel">
          <div class="panel-head"><h3>规则输出变量</h3><span class="sub">可被后续规则引用</span></div>
          <div class="panel-body tight">
            <table class="tbl">
              <thead><tr><th>变量</th><th>类型</th><th>产生阶段</th><th>说明</th></tr></thead>
              <tbody>
                <tr><td class="mono small">qualification_result</td><td class="small">BOOLEAN</td><td class="small">资格认定</td><td class="dim">资产/现金流是否通过资格判断</td></tr>
                <tr><td class="mono small">asset_level</td><td class="small">STRING</td><td class="small">等级分类</td><td class="dim">HQLA 等级（LEVEL_1 / LEVEL_2A / LEVEL_2B）</td></tr>
                <tr><td class="mono small">flow_category</td><td class="small">STRING</td><td class="small">流入/流出类别</td><td class="dim">现金流类别（如 RETAIL_TERM）</td></tr>
                <tr><td class="mono small">haircut_rate</td><td class="small">NUMBER</td><td class="small">折扣率认定</td><td class="dim">按等级查表得到的折算系数</td></tr>
                <tr><td class="mono small">runoff_rate</td><td class="small">NUMBER</td><td class="small">流失率认定</td><td class="dim">按存款类型与客户类型查表得到的流失率</td></tr>
                <tr><td class="mono small">final_hqla</td><td class="small">NUMBER</td><td class="small">最终计量</td><td class="dim">折算后的 HQLA 金额</td></tr>
              </tbody>
            </table>
          </div>
        </div>
        <div class="panel">
          <div class="panel-head"><h3>计算链</h3></div>
          <div class="panel-body tight">
            <table class="tbl">
              <tbody>
                <tr><td>单项计量</td><td class="mono small">金额 × 折扣率 / 流入率 / 流出率</td></tr>
                <tr><td>分档汇总</td><td class="mono small">Level 1 / 2A / 2B</td></tr>
                <tr><td>上限约束</td><td class="mono small">A15（15%）→ A40（40%）</td></tr>
                <tr><td>LCR</td><td class="mono small">HQLA ÷ 净流出 × 100%</td></tr>
              </tbody>
            </table>
            <p class="dim" style="font-size: 11.5px; margin-top: 8px">预览不执行计算；执行结果见计量任务的「自动计量计算」。</p>
          </div>
        </div>
      </div>
    </template>

    <template v-else-if="tab === 'check'">
      <div class="panel">
        <div class="panel-head">
          <h3>配置完整性</h3>
          <span class="tag" :class="product.completeness.score >= 100 ? 'green' : 'amber'">
            {{ product.completeness.score }}% · {{ product.completeness.status }}
          </span>
        </div>
        <div class="panel-body">
          <div class="lq-progress" style="margin-bottom: 14px">
            <div class="lq-progress-bar"><i :style="{ width: product.completeness.score + '%' }"></i></div>
            <span :class="{ ok: product.completeness.score >= 100 }">{{ product.completeness.score }}%</span>
          </div>
          <table class="tbl">
            <thead><tr><th>检查项</th><th class="num">权重</th><th>状态</th><th>详情</th></tr></thead>
            <tbody>
              <tr v-for="item in product.completeness.items" :key="item.key">
                <td>{{ item.label }}</td>
                <td class="num mono">{{ item.weight }}%</td>
                <td>
                  <span class="tag" :class="item.status === 'DONE' ? 'green' : item.status === 'PARTIAL' ? 'amber' : 'red'">
                    {{ item.status === "DONE" ? "已完成" : item.status === "PARTIAL" ? "部分完成" : "未完成" }}
                  </span>
                </td>
                <td class="dim small">{{ item.detail }}</td>
              </tr>
            </tbody>
          </table>
          <p class="dim" style="font-size: 11.5px; margin-top: 10px">
            完整性按产品适用的规则范围计算，不要求配置全部监管规则。
          </p>
        </div>
      </div>
    </template>
  </template>

  <Drawer :open="drawer" :title="editing ? '编辑标准字段' : '新增标准字段'" wide @close="drawer = false">
    <p v-if="formError" class="notice danger">{{ formError }}</p>
    <div class="grid c2">
      <div class="field"><label>字段编码</label><input v-model="form.code" :disabled="editing" placeholder="如 amount" /></div>
      <div class="field"><label>字段名称</label><input v-model="form.name" placeholder="如 业务金额" /></div>
      <div class="field"><label>所属分类</label><input v-model="form.category" placeholder="如 FC_CALC" /></div>
      <div class="field"><label>字段分组</label><input v-model="form.group" placeholder="如 金额与余额" /></div>
      <div class="field"><label>分组顺序</label><input v-model.number="form.groupOrder" type="number" /></div>
      <div class="field">
        <label>数据类型</label>
        <select v-model="form.dataType">
          <option value="STRING">STRING</option><option value="DECIMAL">DECIMAL</option>
          <option value="INTEGER">INTEGER</option><option value="BOOLEAN">BOOLEAN</option>
          <option value="DATE">DATE</option><option value="CURRENCY">CURRENCY</option>
        </select>
      </div>
      <div class="field">
        <label>计量角色</label>
        <select v-model="form.role">
          <option value="NONE">不参与计量</option><option value="VALUATION">计量价值</option>
          <option value="AMOUNT">业务金额</option><option value="ACCRUED">应计利息</option>
          <option value="UNDRAWN">未提取额度</option>
        </select>
      </div>
      <div class="field">
        <label>值域类型</label>
        <select v-model="form.valueType">
          <option value="FREE_TEXT">自由文本</option><option value="CODE_DICT">码值字典</option>
          <option value="NUM_RANGE">数值范围</option><option value="BOOLEAN">布尔</option>
        </select>
      </div>
      <div class="field"><label>码值字典</label><input v-model="form.dictionary" placeholder="如 DICT_CURRENCY" /></div>
      <div class="field"><label>源字段</label><input v-model="form.source" placeholder="如 BOOK_VALUE_AMT" /></div>
      <div class="field"><label>别名（逗号分隔）</label><input v-model="form.aliases" placeholder="如 账面余额, 账面金额" /></div>
      <div class="field">
        <label>是否必填</label>
        <select v-model="form.required">
          <option :value="false">否</option><option :value="true">是</option>
        </select>
      </div>
    </div>
    <div class="field"><label>字段说明</label><textarea v-model="form.description" rows="3"></textarea></div>
    <template #footer>
      <button type="button" class="btn" @click="drawer = false">取消</button>
      <span class="spacer"></span>
      <button type="button" class="btn primary" :disabled="saving" @click="submitField">{{ saving ? "保存中…" : "保存" }}</button>
    </template>
  </Drawer>
</template>

<style scoped>
.lq-product-head { display: flex; justify-content: space-between; gap: 16px; margin-bottom: 12px; }
.lq-product-head h2 { margin: 0 0 4px; font-size: 18px; }
.lq-product-head p { margin: 0; color: var(--muted); font-size: 12.5px; }
.lq-product-head-actions { display: flex; align-items: center; gap: 8px; }
.lq-tabs { display: flex; gap: 6px; align-items: center; margin-bottom: 12px; flex-wrap: wrap; }
.lq-tabs button { border: 1px solid var(--line); background: #fff; border-radius: 999px; padding: 5px 12px; font-size: 12px; color: #475569; }
.lq-tabs button.on { background: #eef2ff; border-color: #a5b4fc; color: #3730a3; font-weight: 600; }
.lq-entry-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; }
.lq-entry {
  border: 1px solid var(--line); background: #fff; border-radius: 10px; padding: 12px 14px;
  display: flex; flex-direction: column; gap: 4px; text-align: left; cursor: pointer;
}
.lq-entry:hover { border-color: #c7d2fe; background: #f8faff; }
.lq-entry b { font-size: 13px; }
.lq-entry span { font-size: 11.5px; color: var(--muted); }
.lq-chips { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 10px; }
.lq-chip { border: 1px solid var(--line); background: #f8fafc; border-radius: 999px; padding: 2px 10px; font-size: 11.5px; color: #475569; }
.lq-tree { display: flex; flex-direction: column; gap: 8px; }
.lq-tree-node { border: 1px solid var(--line); background: #f8fafc; border-radius: 10px; padding: 10px 12px; display: flex; flex-direction: column; gap: 4px; }
.lq-tree-node b { font-size: 12.5px; }
.lq-tree-node span { font-size: 11.5px; color: var(--muted); }
.lq-tree-rule { font-size: 11.5px; color: #475569; margin-left: 8px; }
.lq-tree-rule code { font-family: var(--mono); font-size: 11px; }
.lq-progress { display: flex; align-items: center; gap: 8px; }
.lq-progress-bar { flex: 1; height: 8px; background: #eef2ff; border-radius: 6px; overflow: hidden; }
.lq-progress-bar i { display: block; height: 100%; background: #f59e0b; }
.lq-progress span { font-size: 11px; color: #b45309; }
.lq-progress span.ok { color: #047857; }
.lq-mini { background: #f8fafc; border: 1px solid var(--line); border-radius: 9px; padding: 8px 10px; }
.lq-mini span { display: block; font-size: 11px; color: var(--muted); }
.lq-mini b { font-size: 17px; }
</style>
