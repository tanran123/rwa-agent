<script setup>
import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { applyMeasureChoices, classifyMeasure, detectMeasureProducts, fetchMeasure, mapMeasureFields, saveMeasureRun, uploadWorkbook } from "@/api/batch";
import { fetchProducts } from "@/api/product";
import { useContext } from "@/composables/useContext";
import { askConfirm } from "@/utils/confirm";

const STATUS = { draft: "草稿", reviewing: "审核中", published: "已发布", superseded: "已被取代", disabled: "已停用" };
const router = useRouter();
const { session, currentVersion, versionOptions, setOrg, setJurisdiction } = useContext();
const pack = ref(null);
const error = ref("");
const step = ref(1);
const done = ref({});
const imported = ref(null);
const sheet = ref("term-Loan");
const headerRow = ref(14);
const fileName = ref("");
const classified = ref(false);
const mapOk = ref(false);
const eadProduct = ref("");
const batchName = ref("");
const saving = ref(false);
const savedId = ref("");
const saveError = ref("");
const uploadId = ref("");
const reading = ref(false);
const readError = ref("");
const truncated = ref(false);
const configuredProducts = ref([]);
const choiceId = ref("");
const autoProduct = ref({});
const autoColumn = ref({});
const applying = ref(false);
const stepError = ref("");
const nameTouched = ref(false);
const institutionText = ref("");
const steps = [
  "选择计量范围",
  "导入 Excel 债项明细",
  "识别产品类型",
  "字段映射确认",
  "执行暴露分类",
  "执行 EAD 计算",
  "执行信用风险缓释",
  "确定风险权重并计算 RWA",
  "查看计量结果及审计证据"
];

const intake = computed(() => (pack.value && pack.value.intake) || null);
const sheetsLabel = computed(() => {
  const read = (pack.value && pack.value.sheetsRead) || [];
  return read.length ? read.join("、") : sheet.value;
});
const productRulesets = computed(() => (pack.value && pack.value.productRulesets) || []);
const results = computed(() => (pack.value && pack.value.results) || []);
const maxStep = computed(() => {
  let next = 1;
  for (let i = 1; i <= 9; i += 1) if (done.value[i]) next = i + 1;
  return Math.min(next, 9);
});

function money(value) {
  if (value == null || value === "" || Number.isNaN(Number(value))) return "—";
  return Number(value).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function shortMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e8) return (n / 1e8).toFixed(2) + " 亿";
  if (abs >= 1e4) return (n / 1e4).toFixed(2) + " 万";
  return n.toFixed(2);
}
function pct(value) {
  if (value == null || Number.isNaN(Number(value))) return "—";
  return +(Number(value) * 100).toFixed(2) + "%";
}
function productLabel(code) {
  const configured = configuredProducts.value.find((item) => item.code === code);
  return (configured && configured.label) || (pack.value && pack.value.products[code]) || code || "未识别";
}
function versionText(item) {
  const extra = item.status && item.status !== "published" ? "（" + (STATUS[item.status] || item.status) + "）" : "";
  return item.version + extra;
}
const jurisdictionRow = computed(() => session.jurisdictions.find((item) => item.code === session.jurisdiction) || null);
const orgsHere = computed(() => session.orgs.filter((item) => item.jurisdiction === session.jurisdiction));
const versionProducts = computed(() => {
  const version = currentVersion.value && currentVersion.value.version;
  if (!version) return [];
  return configuredProducts.value.filter((item) => item.ruleVersion === version);
});
const productFieldCount = computed(() => versionProducts.value.reduce((sum, item) => sum + Number(item.fieldCount || 0), 0));
const productChoices = computed(() => (versionProducts.value.length ? versionProducts.value : configuredProducts.value));
const unrecognizedLoans = computed(() => ((intake.value && intake.value.loans) || []).filter((loan) => !loan.product));
const loansForProduct = computed(() => {
  const loans = (intake.value && intake.value.loans) || [];
  return [...loans.filter((loan) => !loan.product), ...loans.filter((loan) => loan.product)];
});
const eadRules = computed(() => {
  const rules = (pack.value && pack.value.rules && pack.value.rules.ead) || [];
  return rules.filter((rule) => rule.product === eadProduct.value);
});
const crmConfigRows = computed(() => (pack.value && pack.value.rules && pack.value.rules.crm) || []);
function orgName() {
  if (!orgsHere.value.length && institutionText.value) return institutionText.value;
  return (session.orgs.find((item) => item.id === session.orgId) || {}).name || "";
}
function suggestedName() {
  const parts = String(session.baseDate || "").split("-");
  const when = parts.length >= 2 ? parts[0] + "年" + Number(parts[1]) + "月" : "";
  return when + orgName() + "信用风险计量";
}
function onJurisdiction(code) {
  setJurisdiction(code);
  const list = session.orgs.filter((item) => item.jurisdiction === session.jurisdiction);
  if (!list.some((item) => item.id === session.orgId) && list[0]) setOrg(list[0].id);
  if (!nameTouched.value) batchName.value = suggestedName();
}
function onOrg(id) {
  setOrg(id);
  if (!nameTouched.value) batchName.value = suggestedName();
}
function onBaseDate(value) {
  session.baseDate = value;
  if (!nameTouched.value) batchName.value = suggestedName();
}
function resetMemory() {
  autoProduct.value = {};
  autoColumn.value = {};
  choiceId.value = "";
}
function rememberChoices(book) {
  const loans = (book.intake && book.intake.loans) || [];
  loans.forEach((loan) => {
    if (autoProduct.value[loan.id] == null) autoProduct.value[loan.id] = loan.product || "";
  });
  const mappings = (book.intake && book.intake.mappings) || {};
  Object.entries(mappings).forEach(([code, suggestions]) => {
    suggestions.forEach((item) => {
      const key = code + "\n" + item.stdCode;
      if (autoColumn.value[key] == null) autoColumn.value[key] = item.column || "";
    });
  });
}
function replacePack(book) {
  if (book.uploadId) uploadId.value = book.uploadId;
  if (book.choiceId) choiceId.value = book.choiceId;
  pack.value = book;
  const read = book.sheetsRead || [];
  if (read.length > 1) sheet.value = "";
  else if (book.sheet) sheet.value = book.sheet;
  if (book.intake && book.intake.headerRow) headerRow.value = book.intake.headerRow;
  rememberChoices(book);
}
function sheetScopeMatches() {
  const read = (pack.value && pack.value.sheetsRead) || [];
  if (!sheet.value) return read.length !== 1;
  return read.length === 1 && read[0] === sheet.value;
}
function productCodeOf(loan) {
  const raw = (loan && loan.raw) || {};
  const value = raw.productCode == null ? "" : String(raw.productCode).trim();
  return value;
}
async function pickProduct(loan, code) {
  loan.product = code;
  if (code) loan.basis = "从产品配置中选择";
  if (!code || !intake.value) return;
  const value = productCodeOf(loan);
  const others = intake.value.loans.filter((item) => item.id !== loan.id && productCodeOf(item) === value);
  if (!others.length) return;
  const yes = await askConfirm("是否把「" + productLabel(code) + "」也标到这些产品代码相同的债项上？", {
    title: "相同产品代码",
    detail: "产品代码「" + (value || "（空）") + "」还有 " + others.length + " 笔",
    confirmText: "是",
    cancelText: "否"
  });
  if (!yes || !intake.value) return;
  intake.value.loans.forEach((item) => {
    if (item.id === loan.id || productCodeOf(item) !== value) return;
    item.product = code;
    item.basis = "从产品配置中选择";
  });
}
async function detectProducts() {
  if (!intake.value || applying.value) return;
  if (!intake.value.loans.some((loan) => !loan.product)) return;
  applying.value = true;
  stepError.value = "";
  try {
    const detected = await detectMeasureProducts({
      uploadId: uploadId.value,
      version: (currentVersion.value && currentVersion.value.version) || "",
      samples: uploadId.value ? [] : intake.value.loans.slice(0, 120).map((loan) => loan.raw || {})
    });
    const byCode = {};
    (detected.groups || []).forEach((item) => {
      if (item.product) byCode[item.id] = item;
    });
    intake.value.loans.forEach((loan) => {
      if (loan.product) return;
      const hit = byCode[productCodeOf(loan)];
      if (!hit) return;
      loan.product = hit.product;
      loan.basis = "模型识别：" + (hit.reason || productLabel(hit.product));
    });
    if (detected.modelError) stepError.value = detected.modelError;
  } catch (err) {
    stepError.value = err.message || "模型没有识别产品";
    throw err;
  } finally {
    applying.value = false;
  }
}
async function applyChoices() {
  if (!intake.value || applying.value) return;
  const productsBody = {};
  intake.value.loans.forEach((loan) => {
    if (loan.product) productsBody[loan.id] = loan.product;
  });
  const headers = intake.value.headers || [];
  const columns = {};
  Object.entries(intake.value.mappings || {}).forEach(([code, suggestions]) => {
    const next = {};
    (suggestions || []).forEach((item) => {
      if (item.column && headers.includes(item.column)) next[item.stdCode] = item.column;
    });
    if (Object.keys(next).length) columns[code] = next;
  });
  if (!uploadId.value && !Object.keys(productsBody).length && !Object.keys(columns).length) return;
  applying.value = true;
  stepError.value = "";
  try {
    replacePack(await applyMeasureChoices({
      uploadId: uploadId.value,
      sheet: sheet.value,
      headerRow: headerRow.value,
      products: productsBody,
      columns
    }));
  } catch (err) {
    stepError.value = err.message || "没有按配置重算";
    throw err;
  } finally {
    applying.value = false;
  }
}
function acceptMappedColumns(mappings) {
  Object.entries(mappings || {}).forEach(([code, suggestions]) => {
    suggestions.forEach((item) => {
      autoColumn.value[code + "\n" + item.stdCode] = item.column || "";
    });
  });
}
async function fillMappings() {
  if (!intake.value) return;
  const codes = [...new Set(intake.value.loans.map((loan) => loan.product).filter(Boolean))];
  if (!codes.length) return;
  applying.value = true;
  stepError.value = "";
  try {
    const headers = intake.value.headers || [];
    const samples = uploadId.value ? [] : intake.value.loans.slice(0, 120).map((loan) => loan.raw || {});
    const mapped = await mapMeasureFields({ products: codes, headers, samples, uploadId: uploadId.value });
    if (pack.value && pack.value.intake) pack.value.intake.mappings = mapped.mappings || {};
    const products = {};
    intake.value.loans.forEach((loan) => {
      if (loan.product) products[loan.id] = loan.product;
    });
    const columns = {};
    Object.entries(mapped.mappings || {}).forEach(([code, suggestions]) => {
      const next = {};
      suggestions.forEach((item) => {
        if (item.column && headers.includes(item.column)) next[item.stdCode] = item.column;
      });
      if (Object.keys(next).length) columns[code] = next;
    });
    replacePack(await applyMeasureChoices({
      uploadId: uploadId.value,
      sheet: sheet.value,
      headerRow: headerRow.value,
      products,
      columns
    }));
    if (pack.value && pack.value.intake) pack.value.intake.mappings = mapped.mappings || {};
    acceptMappedColumns(mapped.mappings);
    if (mapped.modelError) stepError.value = mapped.modelError;
  } catch (err) {
    stepError.value = err.message || "字段没有对上";
    throw err;
  } finally {
    applying.value = false;
  }
}
function go(index) {
  const n = index + 1;
  if (n <= maxStep.value) step.value = n;
}
function crmLabel(row) {
  const crm = row.crm || {};
  if (crm.applied) return "已拆分";
  if (crm.status === "ineligible") return "不合格";
  if (crm.status === "off") return "未启用";
  return "不拆分";
}
async function runClassification() {
  if (!uploadId.value) {
    stepError.value = "请先上传工作簿。暴露分类交给权重计算。";
    return;
  }
  applying.value = true;
  stepError.value = "";
  try {
    const data = await classifyMeasure(uploadId.value);
    pack.value = { ...pack.value, ...data };
    classified.value = true;
  } catch (err) {
    stepError.value = err.message || "暴露分类没有跑完";
  } finally {
    applying.value = false;
  }
}
async function finish(n) {
  if (n === 2) {
    if (uploadId.value && !sheetScopeMatches()) {
      const reread = await rereadSheet();
      if (!reread) return;
    }
    try { await detectProducts(); } catch (err) { return; }
  }
  if (n === 3 || n === 4) {
    if (n === 3 && unrecognizedLoans.value.length) return;
    try { await applyChoices(); } catch (err) { return; }
    if (n === 3) {
      try { await fillMappings(); } catch (err) { return; }
    }
    classified.value = false;
  }
  if (n === 8) {
    if (saving.value) return;
    saving.value = true;
    saveError.value = "";
    try {
      const version = currentVersion.value || {};
      const saved = await saveMeasureRun({
        name: batchName.value,
        institution: orgName(),
        jurisdiction: session.jurisdiction,
        version: version.version || "",
        baseDate: session.baseDate,
        uploadId: uploadId.value,
        choiceId: choiceId.value
      });
      savedId.value = saved.id;
      done.value = { ...done.value, 8: true };
      step.value = 9;
    } catch (err) {
      saveError.value = err.message || "没有写入";
    } finally {
      saving.value = false;
    }
    return;
  }
  done.value = { ...done.value, [n]: true };
  step.value = Math.min(n + 1, 9);
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || "");
      const comma = text.indexOf(",");
      resolve(comma >= 0 ? text.slice(comma + 1) : text);
    };
    reader.onerror = () => reject(new Error("文件没有读出来"));
    reader.readAsDataURL(file);
  });
}
function applyBook(book) {
  truncated.value = !!book.truncated;
  replacePack(book);
  const loans = (book.intake && book.intake.loans) || [];
  imported.value = {
    source: book.filename || book.sourceFile || fileName.value || "上传的工作簿",
    rows: loans.length,
    cols: book.intake.headers.length,
    ok: loans.filter((loan) => loan.product).length,
    missing: loans.filter((loan) => !loan.product || loan.anomaly).length
  };
  classified.value = false;
  mapOk.value = false;
}
async function loadFile(event) {
  const file = event.target.files && event.target.files[0];
  fileName.value = file ? file.name : "";
  if (!file) return;
  reading.value = true;
  readError.value = "";
  resetMemory();
  try {
    const content = await fileToBase64(file);
    applyBook(await uploadWorkbook({ filename: file.name, content, headerRow: 1 }));
  } catch (err) {
    readError.value = err.message || "工作簿没有读出来";
  } finally {
    reading.value = false;
  }
}
async function rereadSheet() {
  if (!uploadId.value || reading.value) return;
  reading.value = true;
  readError.value = "";
  try {
    applyBook(await uploadWorkbook({
      uploadId: uploadId.value,
      sheet: sheet.value,
      headerRow: headerRow.value
    }));
    return true;
  } catch (err) {
    readError.value = err.message || "工作簿没有读出来";
    return false;
  } finally {
    reading.value = false;
  }
}
async function onSheetPick(value) {
  sheet.value = value;
  if (!uploadId.value) return;
  await rereadSheet();
}
function rawPreview(loan) {
  const raw = loan.raw || {};
  return {
    id: loan.id,
    gl: raw.glAcct,
    customer: loan.customer,
    name: loan.name,
    code: raw.productCode,
    ccy: raw.ccy,
    balance: raw.balance,
    cust: raw.custType || "（空）",
    collateral: raw.collateralType || "—",
    overdue: raw.overdueDays,
    loanClass: raw.loanClass
  };
}
const productStats = computed(() => {
  const bag = {};
  (intake.value ? intake.value.loans : []).forEach((loan) => {
    const key = loan.product || "";
    bag[key] = (bag[key] || 0) + 1;
  });
  return bag;
});
const productCodes = computed(() => [...new Set(results.value.map((row) => row.product).filter(Boolean))]);
watch(productCodes, (codes) => {
  if (codes.includes(eadProduct.value)) return;
  const rules = (pack.value && pack.value.rules && pack.value.rules.ead) || [];
  const withRule = codes.find((code) => rules.some((rule) => rule.product === code));
  eadProduct.value = withRule || codes[0] || "";
}, { immediate: true });
const eadRows = computed(() => results.value.filter((row) => !eadProduct.value || row.product === eadProduct.value));
const mapGroups = computed(() => {
  if (!intake.value) return [];
  return Object.entries(intake.value.mappings).map(([code, suggestions]) => ({
    code,
    label: productLabel(code),
    count: intake.value.loans.filter((loan) => loan.product === code).length,
    suggestions
  }));
});
const mapSummary = computed(() => {
  const all = mapGroups.value.flatMap((group) => group.suggestions);
  return {
    groups: mapGroups.value.length,
    fields: all.length,
    high: all.filter((item) => item.confidence >= 0.95).length,
    review: all.filter((item) => item.needsReview).length,
    none: all.filter((item) => !item.column).length
  };
});

watch(() => [session.orgId, session.baseDate, session.orgs.length], () => {
  if (!nameTouched.value) batchName.value = suggestedName();
});
onMounted(async () => {
  batchName.value = suggestedName();
  try {
    const [book, list] = await Promise.all([fetchMeasure(), fetchProducts()]);
    configuredProducts.value = list || [];
    replacePack(book);
  } catch (err) {
    error.value = (err.response && err.response.data && err.response.data.error) || "计量数据没有读到";
  }
});
</script>

<template>
  <div v-if="error" class="notice danger"><span class="ni">!</span><div>{{ error }}</div></div>
  <div v-else-if="!pack" class="loading"><span class="spin"></span>正在读取</div>
  <template v-else>
    <div class="panel" style="margin-bottom: 12px">
      <div class="panel-head">
        <h3>计量向导</h3>
        <span class="sub">每一步的处理进度、成功数量与异常数量都会实时反映</span>
      </div>
      <div class="panel-body">
        <div class="steps">
          <template v-for="(label, index) in steps" :key="label">
            <div class="step" :class="{ active: step === index + 1, done: done[index + 1] && step !== index + 1 }" @click="go(index)">
              <span class="sn">{{ done[index + 1] && step !== index + 1 ? "✓" : index + 1 }}</span>{{ label }}
            </div>
            <span v-if="index < steps.length - 1" class="step-arrow">›</span>
          </template>
        </div>
      </div>
    </div>

    <div v-if="step === 1" class="panel">
      <div class="panel-head"><h3>第一步：选择计量范围</h3><span class="sub">地区、版本和机构从已有配置里选。没有配置项时再填写</span></div>
      <div class="panel-body">
        <div class="grid c2">
          <div class="field"><label>司法管辖区</label>
            <select v-if="session.jurisdictions.length" :value="session.jurisdiction" @change="onJurisdiction($event.target.value)">
              <option v-for="item in session.jurisdictions" :key="item.code" :value="item.code">{{ item.label }}</option>
            </select>
            <input v-else v-model="session.jurisdiction" />
          </div>
          <div class="field"><label>监管规则版本</label>
            <select v-if="versionOptions.length" v-model="session.versionId">
              <option v-for="item in versionOptions" :key="item.id" :value="item.id">{{ versionText(item) }}</option>
            </select>
            <input v-else :value="(currentVersion || {}).version || ''" readonly />
          </div>
          <div class="field"><label>计量基准日</label>
            <input :value="session.baseDate" type="date" @input="onBaseDate($event.target.value)" />
          </div>
          <div class="field"><label>银行或机构</label>
            <select v-if="orgsHere.length" :value="session.orgId" @change="onOrg($event.target.value)">
              <option v-for="item in orgsHere" :key="item.id" :value="item.id">{{ item.name }}</option>
            </select>
            <input v-else :value="institutionText" @input="institutionText = $event.target.value" />
          </div>
          <div class="field" style="grid-column: 1 / -1"><label>计量批次名称</label><input v-model="batchName" type="text" @input="nameTouched = true" /></div>
        </div>
        <div class="notice info"><span class="ni">i</span><div>规则版本决定本次计量适用的全部规则。计量的规则版本会被固化记录在批次中，规则更新后，历史批次不会自动套用新规则。</div></div>
        <div class="grid c4">
          <div class="kpi accent"><div class="k-label">司法管辖区</div><div class="k-value sm">{{ jurisdictionRow ? jurisdictionRow.label : session.jurisdiction }}</div><div class="k-foot">{{ jurisdictionRow ? jurisdictionRow.regulator : "没有配置监管机构" }}</div></div>
          <div class="kpi"><div class="k-label">监管规则版本</div><div class="k-value sm">{{ (currentVersion || {}).version || "未选择" }}</div><div class="k-foot">{{ (currentVersion || {}).name || "没有配置版本" }}</div></div>
          <div class="kpi"><div class="k-label">计量基准日</div><div class="k-value sm">{{ session.baseDate }}</div><div class="k-foot">写入批次时使用这一天</div></div>
          <div class="kpi"><div class="k-label">该版本产品字段</div><div class="k-value sm">{{ productFieldCount }}</div><div class="k-foot">{{ versionProducts.length }} 个产品</div></div>
        </div>
        <div class="notice ok"><span class="ni">✓</span><div>已加载分类页签 {{ intake.exposureTabs.map((item) => item.label).join("、") }}。执行分类时按识别出的产品对应。EAD 规则表内 {{ intake.eadOn }} 条、表外 {{ intake.eadOff }} 条。信用风险缓释已启用 {{ intake.crmOn }} 个产品。</div></div>
        <button type="button" class="btn primary" @click="finish(1)">确认范围，下一步 →</button>
      </div>
    </div>

    <div v-else-if="step === 2" class="panel">
      <div class="panel-head"><h3>第二步：导入 Excel 债项明细</h3><span class="sub">选择工作表、识别表头及数据区域、预览原始数据、映射至产品标准字段</span></div>
      <div class="panel-body">
        <template v-if="!imported">
          <div v-if="reading" class="loading"><span class="spin"></span>正在读取</div>
          <div v-if="readError" class="notice danger"><span class="ni">!</span><div>{{ readError }}</div></div>
          <div class="notice info"><span class="ni">i</span><div>上传自己的 .xlsx 或 .xlsm。读到后可以选择工作表，表头行默认第 1 行，可以改。产品识别看 Product Code、GL A/C No.、Facility Type。标准字段按字段名称、字段编码或已配置的来源列对上，对不上的列在第四步标成未匹配。</div></div>
          <label class="upload-box">
            <strong>点击选择 Excel 文件</strong>
            <span>支持 .xlsx / .xlsm{{ fileName ? " · 已选择 " + fileName : "" }}</span>
            <input type="file" accept=".xlsx,.xlsm" hidden @change="loadFile" />
          </label>
        </template>
        <template v-else>
          <div v-if="readError" class="notice danger"><span class="ni">!</span><div>{{ readError }}</div></div>
          <div v-if="truncated" class="notice warn"><span class="ni">!</span><div>这个工作表超过 2000 行，这次只读了前 2000 行。</div></div>
          <div class="notice ok"><span class="ni">✓</span><div>已从「{{ sheetsLabel || "全部明细" }}」读取 {{ imported.rows }} 行，表头 {{ imported.cols }} 列。来源：{{ imported.source }}。识别产品只用这次读入的工作表。</div></div>
          <div v-if="uploadId" class="grid c2" style="margin-bottom: 12px">
            <div class="field"><label>工作表</label>
              <select v-if="intake.sheets.length" :value="sheet" :disabled="reading" @change="onSheetPick($event.target.value)">
                <option v-if="intake.sheets.length > 1" value="">全部明细</option>
                <option v-for="name in intake.sheets" :key="name" :value="name">{{ name }}</option>
              </select>
              <input v-else v-model="sheet" />
            </div>
            <div class="field"><label>表头所在行</label><input v-model.number="headerRow" type="number" /></div>
            <div class="btn-group">
              <button type="button" class="btn" :disabled="reading" @click="rereadSheet">{{ reading ? "正在读取" : "按当前工作表和表头重新读取" }}</button>
              <label class="btn">换一个文件<input type="file" accept=".xlsx,.xlsm" hidden @change="loadFile" /></label>
            </div>
          </div>
          <div class="grid c4" style="margin-bottom: 14px">
            <div class="kpi accent"><div class="k-label">导入总记录数</div><div class="k-value">{{ imported.rows }}</div><div class="k-foot">工作表 {{ sheetsLabel }}</div></div>
            <div class="kpi"><div class="k-label">字段映射成功</div><div class="k-value">{{ imported.ok }}</div><div class="k-foot">覆盖率 {{ Math.round(imported.ok / imported.rows * 100) }}%</div></div>
            <div class="kpi"><div class="k-label">必填字段缺失</div><div class="k-value sm">{{ imported.missing }}</div><div class="k-foot">{{ imported.missing ? "需处理后才能继续" : "无缺失" }}</div></div>
            <div class="kpi"><div class="k-label">待处理记录</div><div class="k-value sm">{{ imported.missing }}</div><div class="k-foot">将进入异常清单</div></div>
          </div>
          <div class="panel">
            <div class="panel-head"><h3>原始债项数据预览</h3><span class="sub">显示前 12 行</span></div>
            <div class="panel-body tight"><div class="table-wrap">
              <table v-if="uploadId" class="tbl compact">
                <thead><tr><th v-for="name in intake.headers" :key="name">{{ name }}</th></tr></thead>
                <tbody>
                  <tr v-for="loan in intake.loans.slice(0, 12)" :key="loan.id">
                    <td v-for="name in intake.headers" :key="name" class="mono">{{ loan.raw[name] }}</td>
                  </tr>
                </tbody>
              </table>
              <table v-else class="tbl compact">
                <thead><tr><th>债项编号</th><th>GL A/C No.</th><th>Customer</th><th>Customer Name</th><th>Product Code</th><th>Currency Code</th><th>Value Balance(MOP)</th><th>Cust Type</th><th>Collateral Type1</th><th>Overdue Days</th><th>Loan Class</th></tr></thead>
                <tbody>
                  <tr v-for="loan in intake.loans.slice(0, 12)" :key="loan.id">
                    <td class="mono">{{ rawPreview(loan).id }}</td>
                    <td class="mono">{{ rawPreview(loan).gl }}</td>
                    <td class="mono">{{ rawPreview(loan).customer }}</td>
                    <td>{{ rawPreview(loan).name }}</td>
                    <td class="mono">{{ rawPreview(loan).code }}</td>
                    <td>{{ rawPreview(loan).ccy }}</td>
                    <td class="num">{{ money(rawPreview(loan).balance) }}</td>
                    <td>{{ rawPreview(loan).cust }}</td>
                    <td>{{ rawPreview(loan).collateral }}</td>
                    <td class="num">{{ rawPreview(loan).overdue }}</td>
                    <td>{{ rawPreview(loan).loanClass }}</td>
                  </tr>
                </tbody>
              </table>
            </div></div>
          </div>
          <div v-if="imported.missing" class="panel" style="margin-top: 12px">
            <div class="panel-head"><h3>识别出的异常数据（{{ imported.missing }}）</h3><span class="sub">必填字段缺失或不符合数据标准</span></div>
            <div class="panel-body tight"><div class="table-wrap">
              <table class="tbl compact">
                <thead><tr><th>债项编号</th><th>客户</th><th>异常类型</th><th>具体问题</th><th>处理方式</th></tr></thead>
                <tbody>
                  <tr v-for="loan in intake.loans.filter((item) => item.anomaly)" :key="loan.id">
                    <td class="mono">{{ loan.id }}</td>
                    <td>{{ loan.name }}</td>
                    <td><span class="tag warn">{{ loan.anomaly }}</span></td>
                    <td>{{ loan.anomalyDetail }}</td>
                    <td>继续计量，走到兜底或标记待复核</td>
                  </tr>
                </tbody>
              </table>
            </div></div>
          </div>
          <div v-if="applying" class="loading"><span class="spin"></span>正在读取</div>
          <div v-if="stepError" class="notice danger"><span class="ni">!</span><div>{{ stepError }}</div></div>
          <div class="btn-group" style="margin-top: 12px">
            <button type="button" class="btn primary" :disabled="applying" @click="finish(2)">{{ applying ? "正在识别产品" : "下一步：识别产品类型 →" }}</button>
            <button type="button" class="btn" @click="imported = null">重新导入</button>
          </div>
        </template>
      </div>
    </div>

    <div v-else-if="step === 3" class="panel">
      <div class="panel-head"><h3>第三步：识别产品类型</h3><span class="sub">每一组产品代码都交给模型，从已配置的产品里选。选错了可以改</span></div>
      <div class="panel-body">
        <div v-if="applying" class="loading"><span class="spin"></span>正在读取</div>
        <div v-if="unrecognizedLoans.length" class="notice warn"><span class="ni">!</span><div>有 {{ unrecognizedLoans.length }} 笔模型没有对上已配置产品。请在「识别结果」里选择，选完才能进入字段映射。</div></div>
        <div v-else class="notice ok"><span class="ni">✓</span><div>已识别全部 {{ intake.loans.length }} 笔。识别错了可以在「识别结果」里改选。</div></div>
        <div class="grid c4" style="margin-bottom: 14px">
          <div v-for="(count, code) in productStats" :key="code" class="kpi">
            <div class="k-label">{{ code ? productLabel(code) : "未识别" }}</div>
            <div class="k-value sm">{{ count }} 笔</div>
          </div>
        </div>
        <div class="table-wrap">
          <table class="tbl compact">
            <thead><tr><th>债项编号</th><th>客户名称</th><th>产品代码</th><th>识别结果</th><th>识别依据</th></tr></thead>
            <tbody>
              <tr v-for="loan in loansForProduct" :key="loan.id">
                <td class="mono">{{ loan.id }}</td>
                <td>{{ loan.name }}</td>
                <td class="mono">{{ loan.raw.productCode || "（空）" }}</td>
                <td>
                  <select v-if="productChoices.length" :value="loan.product || ''" @change="pickProduct(loan, $event.target.value)">
                    <option value="">请选择</option>
                    <option v-if="loan.product && !productChoices.some((item) => item.code === loan.product)" :value="loan.product">{{ productLabel(loan.product) }}</option>
                    <option v-for="item in productChoices" :key="item.code" :value="item.code">{{ item.label }}</option>
                  </select>
                  <input v-else :value="loan.product || ''" placeholder="没有产品配置，请填写" @change="pickProduct(loan, $event.target.value.trim())" />
                  <span v-if="!loan.product" class="tag danger" style="margin-left: 6px">请选择</span>
                </td>
                <td class="dim">{{ loan.basis }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-if="stepError" class="notice danger"><span class="ni">!</span><div>{{ stepError }}</div></div>
        <div v-if="applying" class="loading"><span class="spin"></span>正在读取</div>
        <div class="btn-group" style="margin-top: 12px">
          <button type="button" class="btn primary" :disabled="applying || unrecognizedLoans.length > 0" @click="finish(3)">{{ applying ? "正在对应字段" : "下一步：字段映射确认 →" }}</button>
          <button type="button" class="btn" @click="step = 2">← 返回导入</button>
        </div>
      </div>
    </div>

    <div v-else-if="step === 4" class="panel">
      <div class="panel-head"><h3>第四步：字段映射确认</h3><span class="sub">按产品给出映射建议，确认后才进入暴露分类</span></div>
      <div class="panel-body">
        <div v-if="applying" class="loading"><span class="spin"></span>正在读取</div>
        <div class="notice info"><span class="ni">i</span><div>先读取该产品的标准字段，用字段名称、字段编码和来源列对表头。对不上的再交给模型，并附上各列抽样值，说明这些列用来做信用风险 RWA。模型给出的列可以改。仍然空着的字段视为没填。</div></div>
        <div class="grid c4" style="margin-bottom: 14px">
          <div class="kpi accent"><div class="k-label">产品分组</div><div class="k-value sm">{{ mapSummary.groups }}</div><div class="k-foot">覆盖 {{ mapSummary.fields }} 个字段映射</div></div>
          <div class="kpi"><div class="k-label">高置信度建议</div><div class="k-value sm">{{ mapSummary.high }}</div><div class="k-foot">可直接采纳</div></div>
          <div class="kpi"><div class="k-label">需人工确认</div><div class="k-value sm">{{ mapSummary.review }}</div></div>
          <div class="kpi"><div class="k-label">未匹配到列</div><div class="k-value sm">{{ mapSummary.none }}</div></div>
        </div>
        <div v-for="group in mapGroups" :key="group.code" class="panel" style="margin-bottom: 12px">
          <div class="panel-head"><h3>{{ group.label }} · 字段映射确认</h3><span class="sub">{{ group.count }} 笔 · {{ group.suggestions.length }} 个标准字段</span></div>
          <div class="panel-body tight"><div class="table-wrap">
            <table class="tbl compact">
              <thead><tr><th>字段编码</th><th>标准字段</th><th>Excel 列</th><th>判断依据</th><th>置信度</th></tr></thead>
              <tbody>
                <tr v-for="item in group.suggestions" :key="item.stdCode + item.stdField">
                  <td class="mono">{{ item.stdCode }}</td>
                  <td>{{ item.stdField }}<span v-if="item.required" class="tag danger" style="margin-left: 6px">必填</span></td>
                  <td>
                    <select v-if="intake.headers.length" :value="item.column || ''" @change="item.column = $event.target.value || null">
                      <option value="">未匹配</option>
                      <option v-if="item.column && !intake.headers.includes(item.column)" :value="item.column">{{ item.column }}</option>
                      <option v-for="name in intake.headers" :key="name" :value="name">{{ name }}</option>
                    </select>
                    <input v-else :value="item.column || ''" @change="item.column = $event.target.value || null" />
                  </td>
                  <td>{{ item.reason }}</td>
                  <td>{{ item.column ? Math.round(item.confidence * 100) + "%" : "—" }}</td>
                </tr>
              </tbody>
            </table>
          </div></div>
        </div>
        <div v-if="mapOk" class="notice ok"><span class="ni">✓</span><div>全部产品的字段映射均已确认，可以进入下一步执行暴露分类。</div></div>
        <div v-else class="notice warn"><span class="ni">!</span><div>确认映射后即可放行。未匹配的必填字段会带着缺失进入计量。</div></div>
        <div class="btn-group">
          <button v-if="!mapOk" type="button" class="btn primary" @click="mapOk = true">一键确认全部（含接受缺失）</button>
          <button v-else type="button" class="btn primary" @click="finish(4)">下一步：执行暴露分类 →</button>
          <button type="button" class="btn" @click="step = 3">← 返回产品识别</button>
        </div>
      </div>
    </div>

    <div v-else-if="step === 5" class="panel">
      <div class="panel-head"><h3>第五步：执行信用风险暴露分类</h3><span class="sub">把上传的工作簿交给权重计算，按风险暴露分类逐笔取权重</span></div>
      <div class="panel-body">
        <div class="notice info"><span class="ni">i</span><div>这一步把上传的工作簿交给权重计算，按风险暴露分类逐笔划分暴露并取权重。</div></div>
        <div v-if="applying" class="loading"><span class="spin"></span>正在读取</div>
        <div v-if="stepError" class="notice danger"><span class="ni">!</span><div>{{ stepError }}</div></div>
        <button v-if="!classified" type="button" class="btn primary" :disabled="applying" @click="runClassification">开始逐笔执行分类</button>
        <template v-else>
          <div class="grid c4" style="margin: 14px 0">
            <div class="kpi accent"><div class="k-label">处理总数</div><div class="k-value">{{ pack.summary.total }}</div></div>
            <div class="kpi"><div class="k-label">分类成功</div><div class="k-value">{{ pack.summary.ok }}</div></div>
            <div class="kpi"><div class="k-label">待复核</div><div class="k-value sm">{{ pack.summary.warning }}</div></div>
            <div class="kpi"><div class="k-label">分类异常</div><div class="k-value sm">{{ pack.summary.exception }}</div></div>
          </div>
          <div class="table-wrap">
            <table class="tbl compact">
              <thead><tr><th>债项编号</th><th>客户名称</th><th>产品类型</th><th>暴露分类</th><th>暴露大类</th><th>暴露子类</th><th>命中规则</th><th>风险权重</th><th>状态</th></tr></thead>
              <tbody>
                <tr v-for="row in results" :key="row.loanId">
                  <td class="mono">{{ row.loanId }}</td>
                  <td>{{ row.name }}</td>
                  <td>{{ productLabel(row.product) }}</td>
                  <td>{{ row.rulesetLabel || "—" }}</td>
                  <td><span class="tag" :class="row.exposureClass ? 'brand' : 'danger'">{{ row.exposureClass || "未分类" }}</span></td>
                  <td>{{ row.exposureSubClass || "—" }}</td>
                  <td class="mono">{{ row.matchedRule || "—" }}</td>
                  <td class="num">{{ pct(row.riskWeight) }}</td>
                  <td><span class="tag" :class="row.status === 'ok' ? 'ok' : row.status === 'warning' ? 'warn' : 'danger'">{{ row.status === "ok" ? "正常" : row.status === "warning" ? "待复核" : "异常" }}</span></td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="btn-group" style="margin-top: 12px">
            <button type="button" class="btn primary" @click="finish(5)">下一步：执行 EAD 计算 →</button>
          </div>
        </template>
      </div>
    </div>

    <div v-else-if="step === 6" class="panel">
      <div class="panel-head"><h3>第六步：执行 EAD 计算</h3><span class="sub">默认选中一组有 EAD 规则的产品，可以改选</span></div>
      <div class="panel-body">
        <div class="notice info"><span class="ni">i</span><div>EAD 按产品计算。表内 EAD、表外 EAD 与风险加权资产是不同阶段，不会套用其他产品的公式。</div></div>
        <div class="section-tabs" style="margin-bottom: 12px">
          <button v-for="code in productCodes" :key="code" type="button" class="section-tab" :class="{ active: eadProduct === code }" @click="eadProduct = code">{{ productLabel(code) }}</button>
        </div>
        <div v-if="!productCodes.length" class="notice warn"><span class="ni">!</span><div>这批债项没有识别出产品，没有可以计算的 EAD。</div></div>
        <div v-else-if="!eadRules.length" class="notice warn"><span class="ni">!</span><div>这个产品没有 EAD 配置。</div></div>
        <div v-else class="notice info"><span class="ni">i</span><div><span v-for="rule in eadRules" :key="rule.id">{{ rule.name }}：{{ rule.formula }}。 </span></div></div>
        <template v-if="eadProduct && eadRules.length">
          <div class="table-wrap">
            <table class="tbl compact cols-center">
              <thead><tr><th>债项编号</th><th>客户名称</th><th>表内 EAD</th><th>表外 EAD</th><th>EAD</th><th>公式</th></tr></thead>
              <tbody>
                <tr v-for="row in eadRows" :key="row.loanId">
                  <td class="mono">{{ row.loanId }}</td>
                  <td>{{ row.name }}</td>
                  <td class="num">{{ money(row.onEad) }}</td>
                  <td class="num">{{ money(row.offEad) }}</td>
                  <td class="num">{{ money(row.ead) }}</td>
                  <td>{{ row.eadFormula || "—" }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="btn-group" style="margin-top: 12px">
            <button type="button" class="btn primary" @click="finish(6)">下一步：执行信用风险缓释 →</button>
          </div>
        </template>
      </div>
    </div>

    <div v-else-if="step === 7" class="panel">
      <div class="panel-head"><h3>第七步：执行信用风险缓释</h3><span class="sub">按产品读取缓释配置。缺拆分字段时不改原债务人权重</span></div>
      <div class="panel-body">
        <div class="notice info"><span class="ni">i</span><div>缓释配置来自当前库。启用的产品会按已绑定的列读取缓释物；类型不在合格字典里不予认定。覆盖金额、未覆盖金额、保护方权重、币种和抵押品类型缺任何一项时不拆分，RWA 仍按原债务人权重计算。</div></div>
        <div class="table-wrap" style="margin-bottom: 12px">
          <table class="tbl compact">
            <thead><tr><th>产品</th><th>是否启用</th><th>合格缓释物</th></tr></thead>
            <tbody>
              <tr v-for="item in crmConfigRows" :key="item.code">
                <td>{{ productLabel(item.code) }}</td>
                <td>{{ item.needed ? "启用" : "未启用" }}</td>
                <td>{{ item.types && item.types.length ? item.types.map((type) => type.name).join("、") : "没有配置" }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="table-wrap">
          <table class="tbl compact">
            <thead><tr><th>债项编号</th><th>产品</th><th>结论</th><th>说明</th></tr></thead>
            <tbody>
              <tr v-for="row in results" :key="row.loanId">
                <td class="mono">{{ row.loanId }}</td>
                <td>{{ productLabel(row.product) }}</td>
                <td><span class="tag" :class="row.crm && row.crm.applied ? 'ok' : row.crm && row.crm.status === 'ineligible' ? 'danger' : 'muted'">{{ crmLabel(row) }}</span></td>
                <td>{{ row.crm && row.crm.note ? row.crm.note : "—" }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <button type="button" class="btn primary" style="margin-top: 12px" @click="finish(7)">下一步：确定风险权重并计算 RWA →</button>
      </div>
    </div>

    <div v-else-if="step === 8" class="panel">
      <div class="panel-head"><h3>第八步：确定风险权重并计算 RWA</h3><span class="sub">未拆分时 RWA = EAD × 原债务人风险权重</span></div>
      <div class="panel-body">
        <div class="grid c4" style="margin-bottom: 14px">
          <div class="kpi accent"><div class="k-label">EAD 合计</div><div class="k-value">{{ shortMoney(pack.summary.ead) }}</div></div>
          <div class="kpi"><div class="k-label">信用风险 RWA</div><div class="k-value">{{ shortMoney(pack.summary.rwa) }}</div></div>
          <div class="kpi"><div class="k-label">平均权重</div><div class="k-value sm">{{ pct(pack.summary.rwaRate) }}</div></div>
          <div class="kpi"><div class="k-label">异常 / 待复核</div><div class="k-value sm">{{ pack.summary.exception }} / {{ pack.summary.warning }}</div></div>
        </div>
        <div class="table-wrap">
          <table class="tbl compact cols-center">
            <thead><tr><th>债项编号</th><th>暴露大类</th><th>风险权重</th><th>EAD</th><th>RWA</th></tr></thead>
            <tbody>
              <tr v-for="row in results" :key="row.loanId">
                <td class="mono">{{ row.loanId }}</td>
                <td>{{ row.exposureClass || "未分类" }}</td>
                <td class="num">{{ pct(row.riskWeight) }}</td>
                <td class="num">{{ money(row.ead) }}</td>
                <td class="num">{{ money(row.rwa) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-if="pack.workbookError" class="notice danger"><span class="ni">!</span><div>{{ pack.workbookError }}</div></div>
        <div v-else-if="uploadId && pack.workbookReady" class="notice ok"><span class="ni">✓</span><div>风险权重、EAD、RWA 和计算过程已写在上传工作簿每一行的后面。</div></div>
        <div v-if="saveError" class="notice danger"><span class="ni">!</span><div>{{ saveError }}</div></div>
        <div class="btn-group" style="margin-top: 12px">
          <a v-if="uploadId && pack.workbookReady" class="btn" :href="'/api/measure/workbook.xlsx?uploadId=' + uploadId">下载写回的工作簿</a>
          <button type="button" class="btn primary" :disabled="saving" @click="finish(8)">{{ saving ? "正在写入" : "写入数据库并查看结果 →" }}</button>
        </div>
      </div>
    </div>

    <div v-else class="panel">
      <div class="panel-head"><h3>第九步：查看计量结果及审计证据</h3></div>
      <div class="panel-body">
        <div class="notice ok"><span class="ni">✓</span><div>批次「{{ batchName }}」已写入数据库，编号 {{ savedId }}。分类、EAD、缓释和 RWA 都记在这一笔里。<template v-if="uploadId && pack.workbookReady"> 上传的工作簿每一行后面也写了风险权重、EAD、RWA 和计算过程。</template></div></div>
        <div class="grid c4">
          <div class="kpi accent"><div class="k-label">债项</div><div class="k-value">{{ pack.summary.total }}</div></div>
          <div class="kpi"><div class="k-label">EAD</div><div class="k-value">{{ shortMoney(pack.summary.ead) }}</div></div>
          <div class="kpi"><div class="k-label">RWA</div><div class="k-value">{{ shortMoney(pack.summary.rwa) }}</div></div>
          <div class="kpi"><div class="k-label">异常 / 待复核</div><div class="k-value sm">{{ pack.summary.exception }} / {{ pack.summary.warning }}</div></div>
        </div>
        <div class="btn-group">
          <button type="button" class="btn primary" @click="router.push('/results?batch=' + savedId)">打开结果明细</button>
          <a v-if="uploadId && pack.workbookReady" class="btn" :href="'/api/measure/workbook.xlsx?uploadId=' + uploadId">下载写回的工作簿</a>
          <button type="button" class="btn" @click="router.push('/export')">导出审计底稿</button>
        </div>
      </div>
    </div>

  </template>
</template>
