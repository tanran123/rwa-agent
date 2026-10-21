<script setup>
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { fetchMeasure } from "@/api/batch";
import { useContext } from "@/composables/useContext";

const router = useRouter();
const { session, currentVersion } = useContext();
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

const steps = [
  "选择计量范围",
  "导入 Excel 债项明细",
  "识别产品类型",
  "字段映射确认",
  "执行暴露分类",
  "执行 EAD 计算",
  "确定风险权重并计算 RWA",
  "查看计量结果及审计证据"
];

const intake = computed(() => (pack.value && pack.value.intake) || null);
const results = computed(() => (pack.value && pack.value.results) || []);
const maxStep = computed(() => {
  let next = 1;
  for (let i = 1; i <= 8; i += 1) if (done.value[i]) next = i + 1;
  return Math.min(next, 8);
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
  return (pack.value && pack.value.products[code]) || code || "未识别";
}
function orgName() {
  return (session.orgs.find((item) => item.id === session.orgId) || {}).name || "澳门分行";
}
function go(index) {
  const n = index + 1;
  if (n <= maxStep.value) step.value = n;
}
function finish(n) {
  done.value = { ...done.value, [n]: true };
  step.value = Math.min(n + 1, 8);
}

function loadFile(event) {
  const file = event.target.files && event.target.files[0];
  fileName.value = file ? file.name : "";
  if (file) doImport(file.name);
}
function doImport(name) {
  const loans = intake.value.loans;
  imported.value = {
    source: name,
    rows: loans.length,
    cols: intake.value.headers.length,
    ok: loans.filter((loan) => !loan.anomaly).length,
    missing: loans.filter((loan) => loan.anomaly).length
  };
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

onMounted(async () => {
  batchName.value = "2026年9月" + orgName() + "信用风险计量";
  try {
    pack.value = await fetchMeasure();
  } catch (err) {
    error.value = (err.response && err.response.data && err.response.data.error) || "计量数据没有读到";
  }
});
</script>

<template>
  <div v-if="error" class="notice danger"><span class="ni">!</span><div>{{ error }}</div></div>
  <div v-else-if="!pack" class="loading"><span class="spin"></span>正在读取模拟债项和规则</div>
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
      <div class="panel-head"><h3>第一步：选择计量范围</h3><span class="sub">系统根据所选版本加载对应的产品字段、暴露分类规则及 EAD 计算规则</span></div>
      <div class="panel-body">
        <div class="grid c2">
          <div class="field"><label>司法管辖区</label><input :value="session.jurisdiction === 'MO' ? '澳门' : session.jurisdiction" readonly /></div>
          <div class="field"><label>监管规则版本</label><input :value="(currentVersion || {}).version || 'MO-SA-2026.1'" readonly /></div>
          <div class="field"><label>计量基准日</label><input :value="session.baseDate" readonly /></div>
          <div class="field"><label>银行或机构</label><input :value="orgName()" readonly /></div>
          <div class="field" style="grid-column: 1 / -1"><label>计量批次名称</label><input v-model="batchName" type="text" /></div>
        </div>
        <div class="notice info"><span class="ni">i</span><div>规则版本决定本次计量适用的全部规则。计量的规则版本会被固化记录在批次中，规则更新后，历史批次不会自动套用新规则。</div></div>
        <div class="grid c4">
          <div class="kpi accent"><div class="k-label">司法管辖区</div><div class="k-value sm">澳门</div><div class="k-foot">澳门金融管理局</div></div>
          <div class="kpi"><div class="k-label">监管规则版本</div><div class="k-value sm">{{ (currentVersion || {}).version || "MO-SA-2026.1" }}</div><div class="k-foot">已加载</div></div>
          <div class="kpi"><div class="k-label">计量基准日</div><div class="k-value sm">{{ session.baseDate }}</div><div class="k-foot">汇率与期限均以该日为基准</div></div>
          <div class="kpi"><div class="k-label">规则加载状态</div><div class="k-value sm">已加载</div><div class="k-foot">字段 {{ intake.fieldCount }} 个</div></div>
        </div>
        <div class="notice ok"><span class="ni">✓</span><div>系统已根据所选版本加载对应的产品字段（{{ intake.fieldCount }} 个）、暴露分类规则，以及 EAD 计算规则（表内 {{ intake.eadOn }} 条、表外 {{ intake.eadOff }} 条）。</div></div>
        <button type="button" class="btn primary" @click="finish(1)">确认范围，下一步 →</button>
      </div>
    </div>

    <div v-else-if="step === 2" class="panel">
      <div class="panel-head"><h3>第二步：导入 Excel 债项明细</h3><span class="sub">选择工作表、识别表头及数据区域、预览原始数据、映射至产品标准字段</span></div>
      <div class="panel-body">
        <template v-if="!imported">
          <div class="notice warn"><span class="ni">!</span><div>原型使用内置的模拟债项数据演示导入效果，未实现真实的 Excel 文件解析。下方展示表头识别、数据区域识别与原始数据预览。</div></div>
          <div class="grid c2">
            <div class="panel">
              <div class="panel-head"><h3>选择工作表</h3></div>
              <div class="panel-body">
                <div class="field"><label>工作表</label>
                  <select v-model="sheet"><option v-for="name in intake.sheets" :key="name">{{ name }}</option></select>
                </div>
                <div class="field"><label>表头所在行</label><input v-model.number="headerRow" type="number" /></div>
                <p class="dim">已识别表头 {{ intake.headers.length }} 列，数据区域从第 {{ headerRow + 1 }} 行开始。</p>
              </div>
            </div>
            <div class="panel">
              <div class="panel-head"><h3>上传文件</h3></div>
              <div class="panel-body">
                <label class="upload-box">
                  <strong>点击选择 Excel 文件，或直接加载内置模拟数据</strong>
                  <span>支持 .xlsx / .xls / .csv{{ fileName ? " · 已选择 " + fileName : "" }}</span>
                  <input type="file" accept=".xlsx,.xls,.csv" hidden @change="loadFile" />
                </label>
                <div class="btn-group" style="margin-top: 10px">
                  <button type="button" class="btn primary" @click="doImport('内置模拟数据')">加载模拟债项数据</button>
                </div>
              </div>
            </div>
          </div>
          <div class="panel" style="margin-top: 12px">
            <div class="panel-head"><h3>已识别的表头</h3><span class="sub">{{ intake.headers.length }} 列</span></div>
            <div class="panel-body tight"><div class="table-wrap">
              <table class="tbl compact">
                <thead><tr><th v-for="name in intake.headers" :key="name">{{ name }}</th></tr></thead>
                <tbody>
                  <tr v-for="loan in intake.loans.slice(0, 3)" :key="loan.id">
                    <td v-for="(name, index) in intake.headers" :key="name" class="mono">{{ Object.values(loan.raw)[index % Math.max(Object.values(loan.raw).length, 1)] }}</td>
                  </tr>
                </tbody>
              </table>
            </div></div>
          </div>
        </template>
        <template v-else>
          <div class="notice ok"><span class="ni">✓</span><div>已从「{{ sheet }}」读取 {{ imported.rows }} 行原始债项数据，表头 {{ imported.cols }} 列。来源：{{ imported.source }}。模拟导入使用的是内置模拟债项数据。</div></div>
          <div class="grid c4" style="margin-bottom: 14px">
            <div class="kpi accent"><div class="k-label">导入总记录数</div><div class="k-value">{{ imported.rows }}</div><div class="k-foot">工作表 {{ sheet }}</div></div>
            <div class="kpi"><div class="k-label">字段映射成功</div><div class="k-value">{{ imported.ok }}</div><div class="k-foot">覆盖率 {{ Math.round(imported.ok / imported.rows * 100) }}%</div></div>
            <div class="kpi"><div class="k-label">必填字段缺失</div><div class="k-value sm">{{ imported.missing }}</div><div class="k-foot">{{ imported.missing ? "需处理后才能继续" : "无缺失" }}</div></div>
            <div class="kpi"><div class="k-label">待处理记录</div><div class="k-value sm">{{ imported.missing }}</div><div class="k-foot">将进入异常清单</div></div>
          </div>
          <div class="panel">
            <div class="panel-head"><h3>原始债项数据预览</h3><span class="sub">显示前 12 行 · 原始字段尚未标准化</span></div>
            <div class="panel-body tight"><div class="table-wrap">
              <table class="tbl compact">
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
          <div class="btn-group" style="margin-top: 12px">
            <button type="button" class="btn primary" @click="finish(2)">下一步：识别产品类型 →</button>
            <button type="button" class="btn" @click="imported = null">重新导入</button>
          </div>
        </template>
      </div>
    </div>

    <div v-else-if="step === 3" class="panel">
      <div class="panel-head"><h3>第三步：识别产品类型</h3><span class="sub">根据产品代码、业务类型及相关字段自动识别，并展示识别依据</span></div>
      <div class="panel-body">
        <div class="notice ok"><span class="ni">✓</span><div>根据债项明细中的产品代码、业务类型及科目号，已自动识别 {{ intake.loans.length }} 笔债项的产品类型。</div></div>
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
              <tr v-for="loan in intake.loans" :key="loan.id">
                <td class="mono">{{ loan.id }}</td>
                <td>{{ loan.name }}</td>
                <td class="mono">{{ loan.raw.productCode }}</td>
                <td><span class="tag" :class="loan.product ? 'ok' : 'danger'">{{ loan.product ? productLabel(loan.product) : "未识别" }}</span></td>
                <td class="dim">{{ loan.basis }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="btn-group" style="margin-top: 12px">
          <button type="button" class="btn primary" @click="finish(3)">下一步：字段映射确认 →</button>
          <button type="button" class="btn" @click="step = 2">← 返回导入</button>
        </div>
      </div>
    </div>

    <div v-else-if="step === 4" class="panel">
      <div class="panel-head"><h3>第四步：字段映射确认</h3><span class="sub">按产品给出映射建议，确认后才进入暴露分类</span></div>
      <div class="panel-body">
        <div class="notice info"><span class="ni">i</span><div>按第三步确认的产品类型分组，对照导入的 Excel 表头给出映射建议。未映射的字段视为没填，引用它的规则条件不会命中。</div></div>
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
                  <td class="mono">{{ item.column || "未匹配" }}</td>
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
      <div class="panel-head"><h3>第五步：执行信用风险暴露分类</h3><span class="sub">调用该产品在当前监管版本下配置的暴露分类规则，逐笔执行规则路由</span></div>
      <div class="panel-body">
        <div class="notice info"><span class="ni">i</span><div>系统按每笔债项最终确认的产品类型，调用权重法风险暴露分类，逐笔输出暴露大类、子类和命中规则。</div></div>
        <button v-if="!classified" type="button" class="btn primary" @click="classified = true">开始逐笔执行分类</button>
        <template v-else>
          <div class="grid c4" style="margin: 14px 0">
            <div class="kpi accent"><div class="k-label">处理总数</div><div class="k-value">{{ pack.summary.total }}</div></div>
            <div class="kpi"><div class="k-label">分类成功</div><div class="k-value">{{ pack.summary.ok }}</div></div>
            <div class="kpi"><div class="k-label">待复核</div><div class="k-value sm">{{ pack.summary.warning }}</div></div>
            <div class="kpi"><div class="k-label">分类异常</div><div class="k-value sm">{{ pack.summary.exception }}</div></div>
          </div>
          <div class="table-wrap">
            <table class="tbl compact">
              <thead><tr><th>债项编号</th><th>客户名称</th><th>产品类型</th><th>暴露大类</th><th>暴露子类</th><th>命中规则</th><th>状态</th></tr></thead>
              <tbody>
                <tr v-for="row in results" :key="row.loanId">
                  <td class="mono">{{ row.loanId }}</td>
                  <td>{{ row.name }}</td>
                  <td>{{ productLabel(row.product) }}</td>
                  <td><span class="tag" :class="row.exposureClass ? 'brand' : 'danger'">{{ row.exposureClass || "未分类" }}</span></td>
                  <td>{{ row.exposureSubClass || "—" }}</td>
                  <td class="mono">{{ row.matchedRule || "—" }}</td>
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
      <div class="panel-head"><h3>第六步：执行 EAD 计算</h3><span class="sub">先选择产品，再调用该产品的 EAD 规则</span></div>
      <div class="panel-body">
        <div class="notice info"><span class="ni">i</span><div>EAD 按产品计算。表内 EAD、表外 EAD 与风险加权资产是不同阶段，不会套用其他产品的公式。</div></div>
        <div class="section-tabs" style="margin-bottom: 12px">
          <button v-for="code in productCodes" :key="code" type="button" class="section-tab" :class="{ active: eadProduct === code }" @click="eadProduct = code">{{ productLabel(code) }}</button>
        </div>
        <div v-if="!eadProduct" class="notice warn"><span class="ni">!</span><div>尚未选择产品。选择后才会展示该产品的 EAD 计算过程与结果。</div></div>
        <template v-else>
          <div class="table-wrap">
            <table class="tbl compact">
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
            <button type="button" class="btn primary" @click="finish(6)">下一步：确定风险权重并计算 RWA →</button>
          </div>
        </template>
      </div>
    </div>

    <div v-else-if="step === 7" class="panel">
      <div class="panel-head"><h3>第七步：确定风险权重并计算 RWA</h3><span class="sub">RWA = EAD × 适用风险权重</span></div>
      <div class="panel-body">
        <div class="grid c4" style="margin-bottom: 14px">
          <div class="kpi accent"><div class="k-label">EAD 合计</div><div class="k-value">{{ shortMoney(pack.summary.ead) }}</div></div>
          <div class="kpi"><div class="k-label">信用风险 RWA</div><div class="k-value">{{ shortMoney(pack.summary.rwa) }}</div></div>
          <div class="kpi"><div class="k-label">平均权重</div><div class="k-value sm">{{ pct(pack.summary.rwaRate) }}</div></div>
          <div class="kpi"><div class="k-label">异常 / 待复核</div><div class="k-value sm">{{ pack.summary.exception }} / {{ pack.summary.warning }}</div></div>
        </div>
        <div class="table-wrap">
          <table class="tbl compact">
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
        <button type="button" class="btn primary" style="margin-top: 12px" @click="finish(7)">下一步：查看计量结果 →</button>
      </div>
    </div>

    <div v-else class="panel">
      <div class="panel-head"><h3>第八步：查看计量结果及审计证据</h3></div>
      <div class="panel-body">
        <div class="notice ok"><span class="ni">✓</span><div>批次「{{ batchName }}」已按权重法风险暴露分类完成。逐笔证据在结果明细里，点一行可看 EAD 步骤。</div></div>
        <div class="grid c4">
          <div class="kpi accent"><div class="k-label">债项</div><div class="k-value">{{ pack.summary.total }}</div></div>
          <div class="kpi"><div class="k-label">EAD</div><div class="k-value">{{ shortMoney(pack.summary.ead) }}</div></div>
          <div class="kpi"><div class="k-label">RWA</div><div class="k-value">{{ shortMoney(pack.summary.rwa) }}</div></div>
          <div class="kpi"><div class="k-label">异常 / 待复核</div><div class="k-value sm">{{ pack.summary.exception }} / {{ pack.summary.warning }}</div></div>
        </div>
        <div class="btn-group">
          <button type="button" class="btn primary" @click="router.push('/results')">打开结果明细</button>
          <button type="button" class="btn" @click="router.push('/export')">导出审计底稿</button>
        </div>
      </div>
    </div>
  </template>
</template>
