/* 菜单、客户、产品、字段、监管版本和页面状态 */
const NAV_GROUPS = [
  { id: "home", label: "总览", page: "dashboard" },
  {
    id: "config",
    label: "规则配置",
    items: [
      { id: "versions", label: "监管规则版本" },
      { id: "clauses", label: "监管条款库" },
      { id: "fields", label: "产品标准字段" }
    ]
  },
  {
    id: "class",
    label: "暴露分类规则",
    items: [
      { id: "generic", label: "通用暴露分类" },
      { id: "productRules", label: "产品专属规则" },
      { id: "tree", label: "分类决策树" },
      { id: "assistant", label: "规则助手" }
    ]
  },
  {
    id: "ead",
    label: "EAD 计算规则",
    items: [
      { id: "eadOn", label: "表内 EAD" },
      { id: "eadOff", label: "表外 EAD" }
    ]
  },
  {
    id: "run",
    label: "计量执行",
    items: [
      { id: "wizard", label: "计量向导" },
      { id: "results", label: "结果明细" },
      { id: "batches", label: "计量批次" },
      { id: "export", label: "审计底稿" }
    ]
  }
];

/* 不单独占菜单。挂在原型对应页面的页内切换上。 */
const PAGE_SECTIONS = {
  versions: [
    { id: "versions", label: "版本" },
    { id: "params", label: "共用参数" }
  ],
  fields: [
    { id: "fields", label: "标准字段" },
    { id: "kbFields", label: "知识库字段" }
  ],
  generic: [
    { id: "generic", label: "分类规则" },
    { id: "exposure", label: "产品线路" },
    { id: "crm", label: "缓释" }
  ],
  tree: [
    { id: "tree", label: "决策树" },
    { id: "weights", label: "权重表" }
  ],
  eadOff: [
    { id: "eadOff", label: "表外规则" },
    { id: "ccf", label: "转换系数" }
  ],
  wizard: [
    { id: "wizard", label: "计量向导" },
    { id: "engine", label: "底稿计算" }
  ]
};

const PAGES = NAV_GROUPS.reduce((list, g) => {
  if (g.page) list.push({ id: g.page, label: g.label });
  (g.items || []).forEach((item) => list.push(item));
  return list;
}, []);

/* 客户：按行业分类横向扩展；知识库（本客户 / 全部检索）均为静默同步 */
const CLIENT_CATEGORIES = ["银行", "保险", "零售", "证券"];
const CUSTOMERS = [
  { id: "c-city", name: "示例城商行", code: "CITY", category: "银行", note: "城商行口径示意" },
  { id: "c-joint", name: "示例股份行", code: "JOINT", category: "银行", note: "股份行口径示意" },
  { id: "c-rural", name: "示例农商行", code: "RURAL", category: "银行", note: "农商行口径示意" },
  { id: "c-life", name: "示例寿险公司", code: "LIFE", category: "保险", note: "寿险机构口径示意" },
  { id: "c-pc", name: "示例财险公司", code: "PC", category: "保险", note: "财险机构口径示意" },
  { id: "c-retail", name: "示例零售银行", code: "RETAIL", category: "零售", note: "零售条线 / 个人业务示意" },
  { id: "c-consumer", name: "示例消费金融", code: "CF", category: "零售", note: "消费金融公司示意" },
  { id: "c-broker", name: "示例证券公司", code: "SEC", category: "证券", note: "券商口径示意" }
];

const state = {
  page: "dashboard",
  clientId: "c-city",
  navOpen: null,
  product: "loan",
  fieldTab: "def",
  fieldMode: null, // null | sync | bulk | create | type
  fieldBulkWay: "paste", // paste | pack | kb | copy
  fieldPaste: "",
  fieldSyncPhase: "idle", // idle | loading | done
  fieldPushPhase: "idle",
  fieldKbPick: {},
  fieldPackPick: {},
  fieldMsg: "",
  fieldDraft: { id: "", zh: "", type: "字符串", sample: "", required: false },
  typeDraft: { label: "", note: "" },
  typeGenPhase: "idle", // idle | loading | done
  typeGenMsg: "",
  expTypeModal: false, // 分类判断页内新建产品类型（不跳转字段页）
  fieldEditMsg: "",
  bankTier: "first",
  weightFilter: "all",
  selectedField: 0,
  selectedWeight: 0,
  selectedCcf: 0,
  selectedCrm: 0,
  selectedParam: 0,
  selectedExposure: "",
  confirmedLeaf: "",
  expScope: "product", // base = 通用流程模板；product = 某产品的分类树
  expNodePopover: false, // 点击画布节点后右侧悬浮详情
  expExpanded: {},
  expZoom: 0.85,
  expPan: { x: 80, y: 20 },
  expCenterPending: true, // 仅打开总览或刚展开产品时居中
  expEnsureVisible: "", // 点节点时，只在被挡住的情况下平移露出
  maintMsg: "",
  expEdit: null,
  expAccordion: true,
  expMsg: "",
  expJsonErr: "",
  expFlowModal: null, // { kind:'overview'|'base'|'product', productKey?, mode:'view'|'edit', err? }
  selectedVersion: "CN-2025",
  regRegion: "全部",
  regPackView: "全部",
  regRuleId: "",
  regCreateOpen: false,
  regMsg: "",
  regKbPhase: "idle", // idle | loading | done
  regDraft: {
    name: "", shortName: "", region: "中国大陆", status: "草案",
    from: "2026-07-01", to: "", updatedAt: "2026-10-13",
    note: ""
  },
  paramCreateOpen: false,
  paramDraft: { id: "", group: "期限优惠", name: "", value: "", unit: "", used: "" },
  selectedTrade: 0,
  calcStage: 0, // 0 映射 · 1 计算 · 2 追溯
  paperRows: [],
  classifyStep: 1, // 1 确认字段 · 2 明细打标
  classifyFieldPick: {}, // fieldKey -> selected for judgment
  classifyPick: {}, // rowId -> selected
  classifyTags: {}, // rowId -> "大类||子类"
  classifyOverride: {}, // legId -> { category, subclass, ... }
  mapPhase: "idle", // idle | loading | ready | confirmed | clarify
  clarify: null,
  mapFile: "",
  mapError: "",
  uploadBook: null,
  mapAssignments: {},
  mapSuggested: {},
  mapReasons: {},
  mapTouched: {},
  // 多笔暴露：表内 / 表外可同时试算（亿元）
  calcLegs: [
    {
      id: "leg1", name: "流动资金贷款", offbalance: false,
      balanceYi: 100, impairmentYi: 10, nominalYi: 50, ccfRuleId: "CCF_COMMIT_40",
      originalRwRuleId: "CN_CORP_001",
      crmApps: [
        { ruleId: "CRM_COL_GOV", coverageYi: 10, eligible: true, maturityMatch: true, currencyMatch: true, haircut: 0, floorExempt: true, correlated: false, rwRuleId: "CN_SOV_001" },
        { ruleId: "CRM_GUAR_PSE", coverageYi: 50, eligible: true, maturityMatch: true, currencyMatch: true, haircut: 0, floorExempt: false, correlated: false, rwRuleId: "CN_PSE_003" }
      ]
    }
  ],
  selectedLeg: 0,
  agentOpen: false,
  agentDraft: "",
  agentBusy: false,
  agentChats: {}
};

function F(id, type, sample, req, source) {
  return { id: id, type: type, sample: sample, required: req === "必填", source: source || "kb", zh: "" };
}

function cloneFields(list) {
  return (list || []).map((f) => ({
    id: f.id, type: f.type, sample: f.sample, required: !!f.required,
    source: f.source || "kb", zh: f.zh || ""
  }));
}

/* 知识库中已有的产品类型模板：新建类型后按名称匹配再同步 */
const KB_PRODUCT_LIBRARY = [
  {
    id: "loan", label: "贷款",
    aliases: ["对公贷款", "公司贷款", "贷款业务", "流动资金贷款"],
    kbSpace: "产品标准字段 · 贷款",
    classes: [],
    skipRules: ["fi_bank"],
    fields: [
      F("product_type", "枚举", "贷款", "必填"),
      F("product_sub_type", "枚举", "流动资金贷款", "必填"),
      F("counterparty_type", "枚举", "公司", "必填"),
      F("counterparty_rating", "字符串", "A", "选填"),
      F("investment_grade", "布尔", "true", "选填"),
      F("sme", "布尔", "false", "选填"),
      F("bank_category", "枚举", "第一档银行", "必填"),
      F("original_maturity", "数值(月)", "36", "选填"),
      F("remaining_maturity", "数值(月)", "24", "选填"),
      F("balance", "数值", "100000000", "必填"),
      F("impairment", "数值", "10000000", "必填"),
      F("collateral_type", "枚举", "国债", "选填"),
      F("collateral_value", "数值", "12000000", "选填"),
      F("guarantee_type", "枚举", "公共部门", "选填"),
      F("guarantee_amount", "数值", "50000000", "选填"),
      F("ltv", "数值%", "55", "选填"),
      F("cashflow_dependent", "布尔", "false", "选填"),
      F("default_status", "枚举", "正常", "必填"),
      F("currency", "枚举", "CNY", "必填")
    ]
  },
  {
    id: "bond", label: "债券",
    aliases: ["债券投资", "债券业务", "固收"],
    kbSpace: "产品标准字段 · 债券",
    classes: [],
    fields: [
      F("product_type", "枚举", "债券", "必填"),
      F("issuer_type", "枚举", "主权", "必填"),
      F("issuer_rating", "字符串", "AA", "选填"),
      F("seniority", "枚举", "Senior", "必填"),
      F("listed", "布尔", "Yes", "选填"),
      F("maturity", "字符串", "3Y", "必填"),
      F("balance", "数值", "50000000", "必填"),
      F("impairment", "数值", "0", "必填"),
      F("default_status", "枚举", "Normal", "必填")
    ]
  },
  {
    id: "term", label: "定期",
    aliases: ["定期", "定期存款", "同业定期"],
    kbSpace: "产品标准字段 · 定期",
    classes: [],
    fields: [
      F("product_type", "枚举", "存款", "必填"),
      F("deposit_type", "枚举", "定期", "必填"),
      F("counterparty_type", "枚举", "银行", "必填"),
      F("bank_category", "枚举", "第一档银行", "必填"),
      F("counterparty_rating", "字符串", "A+", "选填"),
      F("original_maturity", "数值(月)", "3", "选填"),
      F("balance", "数值", "20000000", "必填"),
      F("impairment", "数值", "0", "必填")
    ]
  },
  {
    id: "demand", label: "活期",
    aliases: ["活期", "活期存款", "同业活期"],
    kbSpace: "产品标准字段 · 活期",
    classes: [],
    fields: [
      F("product_type", "枚举", "存款", "必填"),
      F("deposit_type", "枚举", "活期", "必填"),
      F("counterparty_type", "枚举", "银行", "必填"),
      F("bank_category", "枚举", "第一档银行", "必填"),
      F("counterparty_rating", "字符串", "A+", "选填"),
      F("original_maturity", "数值(月)", "0", "选填"),
      F("balance", "数值", "20000000", "必填"),
      F("impairment", "数值", "0", "必填")
    ]
  },
  {
    id: "commitment", label: "贷款承诺(表外)",
    aliases: ["贷款承诺", "表外", "承诺", "授信承诺"],
    kbSpace: "产品标准字段 · 贷款承诺",
    classes: [],
    skipRules: ["fi_bank"],
    fields: [
      F("product_type", "枚举", "贷款承诺", "必填"),
      F("cancelable", "布尔", "false", "必填"),
      F("nominal", "数值", "50000000", "必填"),
      F("counterparty_type", "枚举", "公司", "必填"),
      F("investment_grade", "布尔", "false", "选填"),
      F("bank_category", "枚举", "第一档银行", "必填")
    ]
  }
];

/* 本客户已建产品类型（可新建；字段在类型下维护） */
const PRODUCTS = {};
KB_PRODUCT_LIBRARY.forEach((tpl) => {
  PRODUCTS[tpl.id] = {
    label: tpl.label,
    kbSpace: tpl.kbSpace,
    kbMatchId: tpl.id,
    classes: (tpl.classes || []).slice(),
    skipRules: (tpl.skipRules || []).slice(),
    fields: cloneFields(tpl.fields)
  };
});

function productKeys() {
  return Object.keys(PRODUCTS);
}

function currentProduct() {
  if (!PRODUCTS[state.product]) {
    const keys = productKeys();
    state.product = keys[0] || "";
  }
  return PRODUCTS[state.product] || null;
}

function slugifyProductId(name) {
  const map = { "贷款": "loan", "债券": "bond", "定期": "term", "活期": "demand", "承诺": "commitment" };
  for (const k of Object.keys(map)) {
    if (String(name || "").indexOf(k) >= 0 && !PRODUCTS[map[k]]) return map[k];
  }
  let base = String(name || "type")
    .trim()
    .toLowerCase()
    .replace(/[／/]/g, "_")
    .replace(/[^\w\u4e00-\u9fff]+/g, "_")
    .replace(/^_+|_+$/g, "") || "type";
  if (/^[\u4e00-\u9fff]/.test(base) || !/^[a-zA-Z_]/.test(base)) base = "p_" + base;
  base = base.replace(/[^\w]/g, "_").slice(0, 32) || "type";
  let id = base;
  let n = 2;
  while (PRODUCTS[id]) { id = base + "_" + n; n += 1; }
  return id;
}

function findKbProductMatch(prodOrName) {
  const label = typeof prodOrName === "string"
    ? prodOrName
    : ((prodOrName && (prodOrName.label || "")) || "");
  const text = String(label).trim().toLowerCase();
  if (!text) return null;
  let best = null;
  let bestScore = 0;
  KB_PRODUCT_LIBRARY.forEach((tpl) => {
    const names = [tpl.label].concat(tpl.aliases || []).map((x) => String(x).toLowerCase());
    names.forEach((n) => {
      let score = 0;
      if (text === n) score = 100;
      else if (text.indexOf(n) >= 0 || n.indexOf(text) >= 0) score = Math.min(text.length, n.length) + 20;
      if (score > bestScore) { bestScore = score; best = tpl; }
    });
  });
  return bestScore >= 20 ? best : null;
}

function syncProductFromKb(productKey, opts) {
  const prod = PRODUCTS[productKey];
  if (!prod) return { ok: false, matched: false, added: 0, msg: "类型不存在" };
  const tpl = findKbProductMatch(prod);
  if (!tpl) {
    prod.kbMatchId = "";
    return {
      ok: true, matched: false, added: 0,
      msg: "知识库暂无与「" + prod.label + "」相关的产品模板，请在本类型下自行维护字段。"
    };
  }
  const keepCustom = !(opts && opts.replaceAll);
  const customKeep = keepCustom ? prod.fields.filter((f) => f.source === "custom") : [];
  const exist = {};
  customKeep.forEach((f) => { exist[f.id] = true; });
  const incoming = cloneFields(tpl.fields).map((f) => {
    f.source = "kb";
    return f;
  }).filter((f) => !exist[f.id]);
  prod.fields = customKeep.concat(incoming);
  prod.kbSpace = tpl.kbSpace;
  prod.kbMatchId = tpl.id;
  if (tpl.classes && tpl.classes.length) prod.classes = tpl.classes.slice();
  incoming.forEach((f) => {
    if (f.zh && !FIELD_LABEL[f.id]) FIELD_LABEL[f.id] = f.zh;
  });
  return {
    ok: true, matched: true, added: incoming.length, template: tpl,
    msg: "已匹配知识库「" + tpl.label + "」，同步 " + incoming.length + " 个字段"
      + (customKeep.length ? "（保留自维护 " + customKeep.length + " 个）" : "") + "。"
  };
}

/* 知识库里可勾选加入的字段目录（按主题成组，便于一批添加） */
const KB_FIELD_CATALOG = [
  { group: "缓释 / CRM", items: [
    { id: "collateral_eligible", type: "布尔", sample: "true", required: false, zh: "质物是否合格" },
    { id: "guarantee_eligible", type: "布尔", sample: "true", required: false, zh: "保证是否合格" },
    { id: "crm_maturity_match", type: "布尔", sample: "true", required: false, zh: "缓释期限匹配" },
    { id: "crm_currency_match", type: "布尔", sample: "true", required: false, zh: "缓释币种匹配" },
    { id: "haircut", type: "数值%", sample: "0", required: false, zh: "估值折扣" }
  ]},
  { group: "房地产", items: [
    { id: "property_type", type: "枚举", sample: "居住", required: false, zh: "房产类型" },
    { id: "ltv", type: "数值%", sample: "60", required: false, zh: "LTV" },
    { id: "cashflow_dependent", type: "布尔", sample: "false", required: false, zh: "依赖房地产现金流" }
  ]},
  { group: "表外", items: [
    { id: "nominal", type: "数值", sample: "50000000", required: true, zh: "名义金额" },
    { id: "cancelable", type: "布尔", sample: "false", required: false, zh: "可无条件撤销" },
    { id: "ccf_override", type: "数值%", sample: "", required: false, zh: "CCF 覆盖值" }
  ]},
  { group: "评级与档次", items: [
    { id: "counterparty_rating", type: "字符串", sample: "A", required: false, zh: "交易对手评级" },
    { id: "investment_grade", type: "布尔", sample: "false", required: false, zh: "是否投资级" },
    { id: "bank_category", type: "枚举", sample: "第一档银行", required: true, zh: "银行档次" }
  ]}
];

const FIELD_PACKS = [
  {
    id: "crm", name: "CRM 缓释包", desc: "质物/保证合格、期限币种、折扣共 5 个字段",
    fields: KB_FIELD_CATALOG[0].items
  },
  {
    id: "re", name: "房地产包", desc: "房产类型、LTV、现金流依赖",
    fields: KB_FIELD_CATALOG[1].items
  },
  {
    id: "off", name: "表外包", desc: "名义金额、可撤销、CCF 覆盖",
    fields: KB_FIELD_CATALOG[2].items
  },
  {
    id: "core", name: "通用核心包", desc: "余额、减值、币种、违约状态",
    fields: [
      { id: "balance", type: "数值", sample: "0", required: true, zh: "账面余额" },
      { id: "impairment", type: "数值", sample: "0", required: true, zh: "减值准备" },
      { id: "currency", type: "枚举", sample: "CNY", required: true, zh: "币种" },
      { id: "default_status", type: "枚举", sample: "正常", required: true, zh: "违约状态" }
    ]
  }
];

/* 一套标准字段；上传明细后由大模型把表头自动填到下拉框 */
const FIELD_LABEL = {
  product_type: "产品类型", product_sub_type: "产品细类", counterparty_type: "交易对手类型",
  counterparty_rating: "交易对手评级", investment_grade: "是否投资级", sme: "是否中小企业",
  bank_category: "银行档次", original_maturity: "原始期限(月)", remaining_maturity: "剩余期限(月)",
  balance: "账面余额", impairment: "减值准备", collateral_type: "质物类型",
  collateral_value: "质物价值", guarantee_type: "保证类型", guarantee_amount: "保证金额",
  ltv: "LTV", cashflow_dependent: "是否依赖房地产现金流", default_status: "违约状态",
  currency: "币种", issuer_type: "发行人类型", issuer_rating: "发行人评级",
  seniority: "清偿顺序", listed: "是否上市", maturity: "期限", deposit_type: "存款类型",
  rating: "评级", cancelable: "是否可无条件撤销", nominal: "名义金额"
};

const SAMPLE_UPLOAD = {
  file: "对公贷款明细_2025Q1.xlsx",
  sheet: "贷款明细",
  headerRow: 3,
  columns: [
    { letter: "A", header: "合同编号", sample: "LN-2025-008821" },
    { letter: "B", header: "业务品种", sample: "流动资金贷款" },
    { letter: "C", header: "客户类型", sample: "公司" },
    { letter: "D", header: "外部评级", sample: "A" },
    { letter: "E", header: "是否投资级", sample: "Y" },
    { letter: "F", header: "贷款余额", sample: "100,000,000.00" },
    { letter: "G", header: "减值准备", sample: "10,000,000.00" },
    { letter: "H", header: "抵押物类型", sample: "国债" },
    { letter: "I", header: "抵押物价值", sample: "12,000,000.00" },
    { letter: "J", header: "保证人类型", sample: "公共部门" },
    { letter: "K", header: "保证金额", sample: "50,000,000.00" },
    { letter: "L", header: "LTV", sample: "55" },
    { letter: "M", header: "币种", sample: "CNY" },
    { letter: "N", header: "五级分类", sample: "正常" },
    { letter: "O", header: "原始期限月", sample: "36" },
    { letter: "P", header: "剩余期限月", sample: "24" },
    { letter: "Q", header: "备注", sample: "—" }
  ],
  /* 上传后的业务明细行（样例）；分类判断是给「每一行」打标签 */
  rows: [
    { id: "r1", A: "LN-2025-008821", B: "流动资金贷款", C: "公司", D: "A", E: "Y", F: "100,000,000", G: "10,000,000", H: "国债", I: "12,000,000", J: "公共部门", K: "50,000,000", L: "—", M: "CNY", N: "正常", O: "36", P: "24", Q: "文档基准例" },
    { id: "r2", A: "LN-2025-009102", B: "个人住房按揭", C: "个人", D: "—", E: "N", F: "12,500,000", G: "0", H: "居住用房", I: "18,000,000", J: "—", K: "0", L: "45", M: "CNY", N: "正常", O: "240", P: "180", Q: "LTV 45%" },
    { id: "r3", A: "BK-2025-3301", B: "同业存放", C: "银行", D: "A+", E: "Y", F: "80,000,000", G: "0", H: "—", I: "0", J: "—", K: "0", L: "—", M: "CNY", N: "正常", O: "12", P: "6", Q: "第一档银行" },
    { id: "r4", A: "CM-2025-4408", B: "贷款承诺", C: "公司", D: "BBB", E: "N", F: "0", G: "0", H: "—", I: "0", J: "—", K: "0", L: "—", M: "CNY", N: "正常", O: "24", P: "18", Q: "表外名义 50 亿示意" },
    { id: "r5", A: "LN-2025-011055", B: "经营性物业贷", C: "公司", D: "BB", E: "N", F: "35,000,000", G: "2,000,000", H: "商用房产", I: "40,000,000", J: "—", K: "0", L: "72", M: "CNY", N: "关注", O: "60", P: "36", Q: "依赖租金现金流" },
    { id: "r6", A: "LN-2024-007701", B: "流动资金贷款", C: "公司", D: "CCC", E: "N", F: "8,000,000", G: "3,200,000", H: "—", I: "0", J: "—", K: "0", L: "—", M: "CNY", N: "次级", O: "24", P: "3", Q: "准备占比 40%" }
  ],
  /* 大模型建议：标准字段 id → 源列 letter */
  aiSuggest: {
    product_type: { letter: "", reason: "整表均为贷款，可用常量「贷款」", const: "贷款" },
    product_sub_type: { letter: "B", reason: "「业务品种」对产品细类" },
    counterparty_type: { letter: "C", reason: "「客户类型」对交易对手类型" },
    counterparty_rating: { letter: "D", reason: "「外部评级」对评级" },
    investment_grade: { letter: "E", reason: "「是否投资级」直接对应" },
    bank_category: { letter: "", reason: "表中无此列，建议常量「第一档银行」", const: "第一档银行" },
    balance: { letter: "F", reason: "「贷款余额」对账面余额" },
    impairment: { letter: "G", reason: "「减值准备」同名匹配" },
    collateral_type: { letter: "H", reason: "「抵押物类型」对质物类型" },
    collateral_value: { letter: "I", reason: "「抵押物价值」对质物价值" },
    guarantee_type: { letter: "J", reason: "「保证人类型」对保证类型" },
    guarantee_amount: { letter: "K", reason: "「保证金额」同名匹配" },
    ltv: { letter: "L", reason: "「LTV」同名匹配" },
    default_status: { letter: "N", reason: "「五级分类」映射违约状态" },
    currency: { letter: "M", reason: "「币种」同名匹配" },
    original_maturity: { letter: "O", reason: "「原始期限月」对应" },
    remaining_maturity: { letter: "P", reason: "「剩余期限月」对应" },
    sme: { letter: "", reason: "未找到明确列，留空由用户补" },
    cashflow_dependent: { letter: "", reason: "未找到明确列，留空由用户补" }
  }
};

/** 列名来自《信用风险RWA-产品字段清单》。金额用清单里的示例量级，单位澳门元。 */
const CATALOG_DEMO = {
  file: "信用风险RWA-产品字段清单.xlsx",
  sheet: "演示明细",
  headerRow: 4,
  basis: "catalog",
  columns: [
    { letter: "A", header: "产品表", sample: "定期贷款" },
    { letter: "B", header: "Customer Name", sample: "澳门某贸易公司" },
    { letter: "C", header: "Cust Type", sample: "C" },
    { letter: "D", header: "INDUSTRY", sample: "CORP" },
    { letter: "E", header: "Value Balance(MOP)", sample: "100,000,000" },
    { letter: "F", header: "TOTAL ECL", sample: "10,000,000" },
    { letter: "G", header: "Description1", sample: "—" },
    { letter: "H", header: "Collateral Value（MOP）1", sample: "0" },
    { letter: "I", header: "五級分類", sample: "正常" },
    { letter: "J", header: "DPD", sample: "0" },
    { letter: "K", header: "Value Date", sample: "20240101" },
    { letter: "L", header: "Maturity Date", sample: "20270101" },
    { letter: "M", header: "CCF", sample: "—" },
    { letter: "N", header: "本地中小企", sample: "N" },
    { letter: "O", header: "备注", sample: "公司贷款" },
    { letter: "P", header: "贷款价值比", sample: "—" },
    { letter: "Q", header: "损失准备占比", sample: "0.10" },
    { letter: "R", header: "原始期限月", sample: "36" }
  ],
  rows: [
    { id: "c1", A: "定期贷款", B: "澳门某贸易公司", C: "C", D: "CORP", E: "100000000", F: "10000000", G: "—", H: "0", I: "正常", J: "0", K: "20240101", L: "20270101", M: "—", N: "N", O: "公司贷款", P: "—", Q: "0.10", R: "36" },
    { id: "c2", A: "住宅按揭", B: "陈大文", C: "P", D: "—", E: "50000000", F: "0", G: "RESIDENTIAL PROPERTY", H: "100000000", I: "正常", J: "0", K: "20200101", L: "20400101", M: "—", N: "N", O: "不依赖租金", P: "0.50", Q: "0", R: "240" },
    { id: "c3", A: "存放同业", B: "BANCO LUSO INTERNACIONAL, S.A.", C: "BANK", D: "BANK", E: "180000000", F: "0", G: "—", H: "0", I: "正常", J: "0", K: "20260701", L: "20260901", M: "—", N: "N", O: "第二档银行，存放期约 2 个月", P: "—", Q: "0", R: "2" },
    { id: "c4", A: "活期透支", B: "某零售客户", C: "P", D: "—", E: "20000000", F: "8000000", G: "—", H: "0", I: "Loss", J: "450", K: "20220101", L: "20260101", M: "—", N: "Y", O: "五级 Loss，准备占账面 40%", P: "—", Q: "0.40", R: "48" },
    { id: "c5", A: "债券", B: "中华人民共和国财政部", C: "SOVEREIGN", D: "SOVEREIGN", E: "50000000", F: "0", G: "—", H: "0", I: "正常", J: "0", K: "20240101", L: "20290101", M: "—", N: "N", O: "我国中央政府", P: "—", Q: "0", R: "60" },
    { id: "c6", A: "額度詳情表", B: "某公司未用额度", C: "C", D: "CORP", E: "40000000", F: "0", G: "—", H: "0", I: "正常", J: "0", K: "20250101", L: "20270101", M: "0.40", N: "N", O: "表外未使用额度", P: "—", Q: "0", R: "24" },
    { id: "c7", A: "信用卡未使用额度", B: "持卡人", C: "P", D: "—", E: "1000000", F: "0", G: "—", H: "0", I: "正常", J: "0", K: "20230101", L: "20280101", M: "—", N: "N", O: "已使用额度", P: "—", Q: "0", R: "60" }
  ],
  fieldIds: [
    "instrument_type", "counterparty_name", "counterparty_type", "is_defaulted",
    "single_exposure", "provision_ratio", "has_property_collateral", "property_uses",
    "ltv", "original_maturity_months", "is_credit_card", "cashflow_dependent"
  ],
  map: {
    instrument_type: { letter: "A", reason: "产品表。清单里的 13 张产品表都是债权。" },
    counterparty_name: { letter: "B", reason: "Customer Name，清单里的客户名称。" },
    counterparty_type: { letter: "C", reason: "Cust Type。C 公司，P 个人，BANK 商业银行，SOVEREIGN 主权。" },
    is_defaulted: { letter: "I", reason: "五級分類。Loss、次级、可疑，或 DPD 超过 90 天，视为已违约。" },
    single_exposure: { letter: "E", reason: "Value Balance(MOP)，清单里的账面余额。" },
    provision_ratio: { letter: "Q", reason: "TOTAL ECL 除以 Value Balance(MOP)。" },
    has_property_collateral: { letter: "G", reason: "Description1。有居住或商用抵押才算有房地产抵押。" },
    property_uses: { letter: "G", reason: "Description1。RESIDENTIAL PROPERTY 视为居住。" },
    ltv: { letter: "P", reason: "Value Balance(MOP) 除以 Collateral Value（MOP）1。清单没有单独的 LTV 列。" },
    original_maturity_months: { letter: "R", reason: "Maturity Date 减 Value Date，换成月。" },
    is_credit_card: { letter: "A", reason: "产品表是信用卡时为是，其余为否。" },
    cashflow_dependent: { letter: "O", reason: "备注写明依赖租金则为是，写明不依赖则为否。" }
  }
};

const VERSIONS = [
  {
    id: "CN-2025",
    region: "中国大陆",
    name: "商业银行资本管理办法（2025）",
    shortName: "资本管理办法 2025",
    authority: "国家金融监督管理总局",
    basis: "《商业银行资本管理办法》权重法相关条款",
    reg: "Capital_Management_Measures",
    from: "2025-01-01",
    to: "—",
    status: "生效中",
    rules: 86,
    bankTiers: ["第一档银行", "第二档银行"],
    methods: ["信用风险权重法", "表外 CCF", "CRM 缓释"],
    packs: [
      { name: "监管文件", count: 1, desc: "管理办法，不另编条款号" },
      { name: "暴露分类", count: 28, desc: "主权 / 银行 / 公司 / 零售 / 房地产等" },
      { name: "风险权重", count: 32, desc: "评级、LTV、投资级等条件" },
      { name: "CCF", count: 9, desc: "承诺、信用卡、贸易或有" },
      { name: "CRM 缓释", count: 12, desc: "质物、保证、信用衍生" },
      { name: "规则参数", count: 9, desc: "LTV、期限、准备占比、缓释底线、信用卡上限" }
    ],
    useWhen: "计算内地口径信用风险 RWA 时选用本版本。结果反查到本规则包和规则编号，不另编条款号。",
    note: "当前默认版本。第二档银行不单独划分投资级公司，按一般公司 100% 处理；中小企业、小微企业仍按各自权重。",
    updatedAt: "2025-09-18",
    kbSpace: "信用风险 · 资本管理办法 2025",
    kbClient: { "c-city": { synced: true, at: "2025-09-18" }, "c-joint": { synced: true, at: "2025-09-20" } },
    kbGlobal: { synced: true, at: "2025-09-18" }
  },
  {
    id: "CN-2024",
    region: "中国大陆",
    name: "商业银行资本管理办法（2024）",
    shortName: "资本管理办法 2024",
    authority: "国家金融监督管理总局",
    basis: "2024 年版资本管理办法（已由 2025 版承接）",
    reg: "Capital_Management_Measures",
    from: "2024-01-01",
    to: "2024-12-31",
    status: "已失效",
    rules: 72,
    bankTiers: ["第一档银行", "第二档银行"],
    methods: ["信用风险权重法", "表外 CCF", "CRM 缓释"],
    packs: [
      { name: "暴露分类", count: 0, desc: "历史版本占位，不另写一套分类" },
      { name: "风险权重", count: 0, desc: "历史版本占位，不另写权重数字" },
      { name: "CCF", count: 8, desc: "表外转换" },
      { name: "CRM 缓释", count: 10, desc: "缓释工具" },
      { name: "规则参数", count: 2, desc: "历史参数集" }
    ],
    useWhen: "仅用于历史回溯、监管对照。新业务请改用 2025 版。",
    note: "已失效版本，计算页默认不会选用；需要对比时再手动切换。",
    updatedAt: "2024-12-20",
    kbSpace: "信用风险 · 资本管理办法 2024",
    kbClient: { "c-city": { synced: true, at: "2024-12-20" } },
    kbGlobal: { synced: true, at: "2024-12-20" }
  },
  {
    id: "HK-2026",
    region: "香港",
    name: "HKMA 巴塞尔资本规则（2026 草案）",
    shortName: "HKMA Basel 2026",
    authority: "香港金融管理局（HKMA）",
    basis: "HKMA Basel capital framework（草案）",
    reg: "HKMA_Basel",
    from: "2026-01-01",
    to: "—",
    status: "草案",
    rules: 54,
    bankTiers: ["持牌银行（示意）"],
    methods: ["信用风险标准法（示意）", "表外 CCF", "CRM"],
    packs: [
      { name: "暴露分类", count: 18, desc: "香港口径分类（草案）" },
      { name: "风险权重", count: 20, desc: "与内地分档不同" },
      { name: "CCF", count: 8, desc: "表外转换" },
      { name: "CRM 缓释", count: 6, desc: "缓释工具" },
      { name: "规则参数", count: 2, desc: "草案参数" }
    ],
    useWhen: "香港地区监管口径试算。规则仍在草案，写入生产前需合规确认。",
    note: "与内地规则包隔离；切换区域不会串用条款。",
    updatedAt: "2026-03-02",
    kbSpace: "信用风险 · HKMA Basel 2026",
    kbClient: {},
    kbGlobal: { synced: false, at: "" }
  },
  {
    id: "MO-2026",
    region: "澳门",
    name: "澳门金管局资本计量（已解读）",
    shortName: "AMCM 已解读",
    authority: "澳门金融管理局（AMCM）",
    basis: "第011/2015-AMCM号公告、第015/B/2022-DSB/AMCM号通告、第028/B/2015-DSB/AMCM号通告",
    reg: "AMCM_Capital",
    from: "2015-01-01",
    to: "—",
    status: "生效中",
    rules: 48,
    bankTiers: ["本地信用机构"],
    methods: ["信用风险标准法", "市场风险标准法"],
    packs: [
      { name: "监管文件", count: 3, desc: "公告和通告" },
      { name: "信用风险", count: 2, desc: "正回购、外汇互换对手" },
      { name: "市场风险", count: 3, desc: "回购利率、利率互换、外汇敞口" },
      { name: "标准法权重", count: 6, desc: "样例工作簿读出的权重档" }
    ],
    useWhen: "演示澳门口径时选用。五条计算规则已从文件和样例里解读出来，不套内地权重表。",
    note: "演示知识库。第028/B/2015-DSB/AMCM号通告公开文本只有函件，随函报表没附上，不写填报行号。",
    updatedAt: "2026-10-15",
    kbSpace: "信用风险 · AMCM Capital 2026",
    kbClient: {},
    kbGlobal: { synced: false, at: "" }
  }
];

/* 内地 2025 的明细由四张表现算。澳门是已解读的金管局文件，不套内地权重。香港还没有可演示的文件。 */
const VERSION_RULES = {
  "CN-2024": [
    { id: "CLS-CORP-24", pack: "暴露分类", title: "公司暴露（2024）", cite: "2024 版 · 分类",
      body: "2024 年版只保留版本入口，供历史回溯。这里不另写一套与 2025 不同的分类数字。" },
    { id: "RW-CORP-24", pack: "风险权重", title: "一般公司权重（2024）", cite: "2024 版 · 权重",
      body: "新业务用 2025 版权重表。这里不补写 2024 年单独的权重数字。" },
    { id: "CCF-COMM-24", pack: "CCF", title: "贷款承诺（2024）", cite: "2024 版 · CCF",
      body: "贷款承诺转换系数按 2024 年版表外规则执行；历史试算时锁定本版本截取时点。" },
    { id: "CRM-COL-24", pack: "CRM 缓释", title: "合格质物（2024）", cite: "2024 版 · CRM",
      body: "合格质物范围与底线按 2024 年版执行。回溯时勿混用 2025 规则包。" }
  ],
  "HK-2026": [
    { id: "HK-CLS-01", pack: "暴露分类", title: "香港口径分类（草案）", cite: "HKMA Basel · 草案",
      body: "香港标准法暴露分类草案示意。与内地规则包隔离，切换区域不会串用条款。" },
    { id: "HK-RW-01", pack: "风险权重", title: "香港权重分档（草案）", cite: "HKMA Basel · 草案",
      body: "文档只说明香港与内地规则不同。这里不填写香港权重数字，避免把草案当成已定稿。" },
    { id: "HK-CCF-01", pack: "CCF", title: "表外转换（草案）", cite: "HKMA · CCF",
      body: "表外项目信用转换系数按 HKMA 草案示意配置，可与内地版本对照试算。" }
  ],
  "MO-2026": [
    { id: "MO-DOC-011", pack: "监管文件", title: "第011/2015-AMCM号公告", cite: "偿付能力比率",
      body: "第2点：澳门本地信用机构偿付能力比率不得低于 8%，资本按 RWA 的 8% 计算。\n市场风险里把资本乘 12.5 得到 RWA，对应的就是这个 8%。" },
    { id: "MO-DOC-015", pack: "监管文件", title: "第015/B/2022-DSB/AMCM号通告", cite: "信用风险第6段 · 市场风险第10段",
      body: "信用风险第6段：对单个交易对手采用标准法，并遵守第028/B/2015-DSB/AMCM号通告随函的《信用风险回报填报说明》。\n市场风险第10段：采用标准法，并遵守同一通告随函的《市场风险回报填报说明》。" },
    { id: "MO-DOC-028", pack: "监管文件", title: "第028/B/2015-DSB/AMCM号通告", cite: "随函填报说明",
      body: "随函应有《信用风险回报填报说明》和《市场风险回报填报说明》。\n公开文本只有函件，报表没有附上。折现、附加因子、期限档都不写成通告行号。下面的步骤来自已经对过的样例。" },
    { id: "MO-REPO", pack: "信用风险", title: "正回购信用风险", cite: "第011/2015-AMCM号公告第2点；第015/B/2022号通告信用风险第6段",
      body: "折美元持仓 × 风险权重 = RWA。RWA × 8% = 资本。\n人民币（CNH）金额除以 7.2 得到美元，其他币种按原金额。发行人是中华人民共和国财政部时权重为 0。银行且剩余期限不超过 3 个月时用短期档。" },
    { id: "MO-CCR-FX", pack: "信用风险", title: "外汇互换对手信用风险", cite: "第015/B/2022号通告信用风险第6段",
      body: "信用暴露 = 远端两腿折现轧差 + 流入金额 × 附加因子。信用暴露 × 对手风险权重 = RWA。\n两腿一正一负，先折成澳门元再按剩余期限折现，流入减去流出，小于 0 记为 0。附加因子只乘在流入那一腿：不超过 12 个月 1%，不超过 60 个月 5%，更长 7.5%。银行对手按一般期限档，用 Fitch 评级查权重。" },
    { id: "MO-MR-REPO", pack: "市场风险", title: "回购利率市场风险", cite: "第015/B/2022号通告市场风险第10段",
      body: "资本 = 市值 × 特定风险 + 市值 × 期限档。RWA = 资本 × 12.5。\n政府类特定风险 0%，投资级企业 1%。期限档按剩余期限套用；各档比例在随函报表里，公开文本没有附上，这里不补百分比。" },
    { id: "MO-MR-IRS", pack: "市场风险", title: "利率互换市场风险", cite: "第015/B/2022号通告市场风险第10段",
      body: "资本 = |浮动腿加权 − 固定腿加权| × 2。RWA = 资本 × 12.5。\n每条腿用现值乘该腿剩余期限对应的期限档。两腿相减后取绝对值。期限档比例同样在未附上的报表里，不补数字。" },
    { id: "MO-MR-FX", pack: "市场风险", title: "外汇净敞口市场风险", cite: "第015/B/2022号通告市场风险第10段；第011/2015-AMCM号公告第2点",
      body: "单币种资本 = 净敞口 × 8%，这一行的 RWA 等于净敞口。\n全行把多头合计和空头合计分开加总，取金额较大的一边作为全行 RWA。" },
    { id: "MO-GRADE", pack: "标准法权重", title: "外部评级分档", cite: "样例工作簿 · 标准法",
      body: "评级符号对应 Grade，表里没有的符号按未评级。\nGrade 1：AAA 至 AA-。Grade 2：A+ 至 A-。Grade 3：BBB+ 至 BBB-。Grade 4：BB+ 至 BB-。Grade 5：B+ 至 B-。Grade 6：CCC 及以下。" },
    { id: "MO-RW-SOV", pack: "标准法权重", title: "主权", cite: "样例工作簿 · 标准法权重表",
      body: "Grade 1 至 6、未评级：0%、20%、50%、100%、100%、150%、100%。\n这组数字来自已读过的样例，不是通告正文里的行号。" },
    { id: "MO-RW-PSE", pack: "标准法权重", title: "公共部门实体", cite: "样例工作簿 · 标准法权重表",
      body: "Grade 1 至 6、未评级：20%、50%、100%、100%、100%、150%、100%。" },
    { id: "MO-RW-BANK", pack: "标准法权重", title: "银行", cite: "样例工作簿 · 标准法权重表",
      body: "一般期限：20%、50%、50%、100%、100%、150%、50%。\n剩余期限不超过 3 个月的短期档：20%、20%、20%、50%、50%、150%、20%。" },
    { id: "MO-RW-CORP", pack: "标准法权重", title: "企业 / 非银", cite: "样例工作簿 · 标准法权重表",
      body: "Grade 1 至 6、未评级：20%、50%、100%、100%、150%、150%、100%。" },
    { id: "MO-RW-ZERO", pack: "标准法权重", title: "财政部债权", cite: "正回购样例",
      body: "发行人是中华人民共和国财政部时，风险权重直接为 0%，不再查评级档。" }
  ]
};

function versionRules(verId) {
  if (verId === "CN-2025") return rulesFromTables();
  return VERSION_RULES[verId] || [];
}

/** 内地 2025 只认这四张表。监管版本页按它们现算，避免同一句话写两遍。 */
function rulesFromTables() {
  if (typeof refreshDerived === "function") refreshDerived();
  const docs = [{
    id: "DOC-CN-CAP",
    pack: "监管文件",
    title: "商业银行资本管理办法",
    cite: "国家金融监督管理总局 · 权重法",
    body: "内地演示用的来源文件。暴露分类、风险权重、表外转换系数和缓释都按后面四张表维护，不另编条款号。\n大类顺序与表内风险权重表一致，已违约风险暴露在最后一类。"
  }];
  const classes = (typeof CLASS_GUIDE !== "undefined" ? CLASS_GUIDE : []).map(function (g) {
    const lines = (typeof WEIGHTS !== "undefined" ? WEIGHTS : []).filter(function (w) { return w.cls === g.cls; });
    return {
      id: "CLS_" + g.cls,
      pack: "暴露分类",
      title: g.cls,
      cite: "权重表 · 典型产品",
      body: "典型产品：" + g.products + "。\n权重共 " + lines.length + " 条，在「风险权重」里改条件和权重，这里会跟着变。"
    };
  });
  const weights = (typeof allWeightRows === "function" ? allWeightRows() : (typeof WEIGHTS !== "undefined" ? WEIGHTS : [])).map(function (w) {
    const kind = w.result && w.result.type === "counterparty" ? "查交易对手"
      : w.result && w.result.type === "max" ? "与固定值取较大"
        : w.result && w.result.type === "unspecified" ? "权重表未列明"
          : "固定百分比";
    return {
      id: w.id, pack: "风险权重", title: w.cond, cite: w.cls,
      body: (w.basis || w.cond) + "\n结果 " + kind + " · " + w.rw + " · 优先级 " + w.pri + " · " + w.bank
    };
  });
  const ccfs = (typeof CCF_RULES !== "undefined" ? CCF_RULES : []).map(function (r) {
    return {
      id: r.id, pack: "CCF", title: r.type, cite: r.cond,
      body: r.type + " · " + r.cond + "\n信用转换系数 " + r.ccf + " · 优先级 " + r.pri
    };
  });
  const crms = (typeof CRM_RULES !== "undefined" ? CRM_RULES : []).map(function (r) {
    return {
      id: r.id, pack: "CRM 缓释", title: r.tool, cite: r.type,
      body: r.type + "：" + r.tool + "\n" + r.effect
    };
  });
  const params = (typeof PARAMS !== "undefined" ? PARAMS : []).map(function (p) {
    return {
      id: p.id, pack: "规则参数", title: p.name, cite: p.group,
      body: p.id + " = " + p.value + (p.unit ? (" " + p.unit) : "") + "\n" + (p.used || "")
    };
  });
  return docs.concat(classes, weights, ccfs, crms, params);
}

function ensureRegRuleSelection(ver) {
  const rules = versionRules(ver.id);
  const pack = state.regPackView || "全部";
  const filtered = pack === "全部" ? rules : rules.filter((r) => r.pack === pack);
  if (!filtered.length) {
    state.regRuleId = "";
    return filtered;
  }
  if (!filtered.some((r) => r.id === state.regRuleId)) {
    state.regRuleId = filtered[0].id;
  }
  return filtered;
}

const PARAMS = [
  { id: "LTV_RES_50", group: "居住房地产", name: "LTV 分界 50%", value: "50%", unit: "%", used: "居住用房地产权重条件引用。不依赖现金流且不超过此值、依赖现金流且不超过此值，各走一条权重。" },
  { id: "LTV_RES_100", group: "居住房地产", name: "LTV 分界 100%", value: "100%", unit: "%", used: "居住用房地产权重条件引用。超过此值时，不依赖现金流改为查交易对手，依赖现金流另有一条固定权重。" },
  { id: "LTV_CRE_60", group: "商用房地产", name: "LTV 分界 60%", value: "60%", unit: "%", used: "商用房地产权重条件引用。不超过此值才用该档固定权重，否则改查交易对手或下一档。" },
  { id: "LTV_CRE_80", group: "商用房地产", name: "LTV 分界 80%", value: "80%", unit: "%", used: "商用房地产、依赖现金流：介于 60% 分界与此值之间时，与 90% 取较大；超过此值另有一条固定权重。" },
  { id: "SHORT_3M", group: "期限优惠", name: "短期原始期限", value: "3", unit: "月", used: "第一档银行评级表的短期行引用。百分比在风险权重的评级表里改。" },
  { id: "TRADE_6M", group: "期限优惠", name: "跨境货物贸易期限", value: "6", unit: "月", used: "第一档银行评级表的跨境货物贸易行引用。百分比在风险权重的评级表里改。" },
  { id: "DEF_PROV", group: "已违约", name: "准备占比门槛", value: "20%", unit: "%", used: "已违约权重条件引用。低于此值和不低于此值是两条不同的固定权重。" },
  { id: "RW_FLOOR", group: "CRM", name: "质物质押 RW 底线", value: "20%", unit: "RW", used: "合格质物的覆盖部分引用。一般不低于此值，特定回购可豁免。" },
  { id: "CARD_LIMIT", group: "CCF", name: "合格信用卡单卡上限", value: "100", unit: "万元", used: "未使用信用卡额度的 20% 那条引用。还要满足监控。" }
];
