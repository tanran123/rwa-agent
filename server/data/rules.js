/* 风险权重、CCF、CRM 规则目录 */
/* 兼容：从 JSON 叶子生成旧版详情视图 */
function expRuleDetailFromNode(node) {
  const raw = findRawExpNode(node && node.id);
  const src = (raw && raw.node) || node;
  const j = nodeContentJson(Object.assign({ kind: "subclass" }, src));
  const when = ((j.match && j.match.all) || []).map((c) =>
    (c.field || "") + " " + (c.op || "") + " " + JSON.stringify(c.value)
  );
  return {
    when: when.length ? when : ["（无 match 条件）"],
    then: j.then,
    formula: j.formula,
    json: j,
    dsl: prettyJson(j)
  };
}

/** 只记类别和典型产品。权重句子由 WEIGHTS 拼出来。 */
const CLASS_GUIDE = [
  { cls: "现金及主权类", products: "现金、存放央行、国债、政策性金融债" },
  { cls: "公共部门实体", products: "地方政府一般债、专项债" },
  { cls: "金融机构", products: "同业存放、同业拆借、同业存单、买入返售" },
  { cls: "公司贷款", products: "流动资金贷款、项目贷款、贸易融资、银团贷款" },
  { cls: "专业贷款", products: "项目融资、设备融资、商品融资" },
  { cls: "个人贷款", products: "信用卡、消费贷、经营贷、按揭贷款" },
  { cls: "居住用房地产", products: "个人住房抵押贷款、按揭贷款" },
  { cls: "商用房地产", products: "经营性物业贷款、商铺/写字楼抵押融资" },
  { cls: "房地产开发", products: "房地产开发贷款、土地开发融资" },
  { cls: "股权及次级债权", products: "未上市股权、次级债、TLAC工具" },
  { cls: "已违约风险暴露", products: "已违约贷款、不良资产" }
];

function weightCatalog() {
  if (typeof refreshDerived === "function") refreshDerived();
  const rows = typeof allWeightRows === "function" ? allWeightRows() : WEIGHTS;
  return CLASS_GUIDE.map(function (g) {
    const lines = rows.filter(function (w) { return w.cls === g.cls; });
    return {
      cls: g.cls,
      products: g.products,
      rule: lines.length
        ? lines.map(function (w) { return w.cond + " " + w.rw; }).join("；")
        : "这一类还没有权重行"
    };
  });
}

const WEIGHTS = [
  { id: "CN_SOV_CASH", cls: "现金及主权类", cond: "现金", rw: "0%", pri: 100, bank: "双档", basis: "现金" },
  { id: "CN_SOV_CB", cls: "现金及主权类", cond: "存放央行", rw: "0%", pri: 100, bank: "双档", basis: "对我国央行债权" },
  { id: "CN_SOV_001", cls: "现金及主权类", cond: "我国中央政府", rw: "0%", pri: 100, bank: "双档", basis: "对我国中央政府债权" },
  { id: "CN_SOV_POL", cls: "现金及主权类", cond: "开发性金融机构 / 政策性银行", rw: "0%", pri: 100, bank: "双档", basis: "开发性金融机构和政策性银行债权" },
  { id: "CN_SOV_MDB", cls: "现金及主权类", cond: "合格多边开发银行", rw: "0%", pri: 100, bank: "双档", basis: "合格多边开发银行债权" },
  { id: "CN_SOV_AA", cls: "现金及主权类", cond: "境外主权 AA- 及以上", rw: "0%", pri: 90, bank: "双档", basis: "境外主权按外部评级分档" },
  { id: "CN_SOV_B", cls: "现金及主权类", cond: "境外主权 B- 以下", rw: "150%", pri: 90, bank: "双档", basis: "B- 以下，不含 B- 本身" },
  { id: "CN_SOV_NR", cls: "现金及主权类", cond: "境外主权未评级", rw: "100%", pri: 85, bank: "双档", basis: "境外主权未评级" },
  { id: "CN_SOV_OTHER", cls: "现金及主权类", cond: "境外主权其他评级", rw: "权重表未列明", pri: 70, bank: "双档", basis: "权重表只写了 AA- 及以上、B- 以下和未评级" },
  { id: "CN_PSE_001", cls: "公共部门实体", cond: "省级及计划单列市政府一般债", rw: "10%", pri: 90, bank: "双档", basis: "地方政府一般债" },
  { id: "CN_PSE_002", cls: "公共部门实体", cond: "专项债", rw: "20%", pri: 90, bank: "双档", basis: "专项债" },
  { id: "CN_PSE_SOV", cls: "公共部门实体", cond: "视同我国主权且收入主要源于中央财政", rw: "20%", pri: 85, bank: "双档", basis: "视同我国主权的公共部门实体" },
  { id: "CN_PSE_003", cls: "公共部门实体", cond: "一般公共部门实体", rw: "50%", pri: 70, bank: "双档", basis: "一般公共部门实体" },
  { id: "CN_BANK_T2_ST", cls: "金融机构", cond: "第二档银行 · 短期", rw: "20%", pri: 90, bank: "第二档", basis: "第二档短期可 20%" },
  { id: "CN_BANK_T2", cls: "金融机构", cond: "第二档银行一般", rw: "40%", pri: 70, bank: "第二档", basis: "第二档银行一般为 40%" },
  { id: "CN_OFI_IG", cls: "金融机构", cond: "其他金融机构 · 投资级", rw: "75%", pri: 80, bank: "双档", basis: "其他金融机构投资级可 75%" },
  { id: "CN_OFI", cls: "金融机构", cond: "其他金融机构一般", rw: "100%", pri: 10, bank: "双档", basis: "其他金融机构一般 100%" },
  { id: "CN_CORP_T2", cls: "公司贷款", cond: "第二档银行 · 不单独划分投资级公司", rw: "100%", pri: 100, bank: "第二档", basis: "按一般公司 100%，不取消中小企业、小微企业分档" },
  { id: "CN_CORP_IG", cls: "公司贷款", cond: "投资级公司", rw: "75%", pri: 95, bank: "第一档", basis: "投资级公司 75%" },
  { id: "CN_CORP_MICRO", cls: "公司贷款", cond: "小微企业", rw: "75%", pri: 92, bank: "双档", basis: "小微企业 75%" },
  { id: "CN_CORP_SME", cls: "公司贷款", cond: "中小企业", rw: "85%", pri: 90, bank: "双档", basis: "中小企业 85%" },
  { id: "CN_CORP_001", cls: "公司贷款", cond: "一般公司", rw: "100%", pri: 10, bank: "双档", basis: "一般公司 100%" },
  { id: "CN_SL_T2", cls: "专业贷款", cond: "第二档银行", rw: "100%", pri: 100, bank: "第二档", basis: "第二档按一般公司 100%" },
  { id: "CN_SL_PRE", cls: "专业贷款", cond: "运营前阶段项目融资", rw: "130%", pri: 85, bank: "第一档", basis: "运营前阶段项目融资 130%" },
  { id: "CN_SL_OPS", cls: "专业贷款", cond: "运营阶段项目融资、物品融资、商品融资", rw: "100%", pri: 80, bank: "第一档", basis: "运营阶段及物品、商品融资 100%" },
  { id: "CN_RET_T2_MTG", cls: "个人贷款", cond: "第二档银行 · 个人住房抵押贷款", rw: "50%", pri: 100, bank: "第二档", basis: "第二档银行对个人住房抵押贷款 50%" },
  { id: "CN_RET_002", cls: "个人贷款", cond: "合格交易者个人", rw: "45%", pri: 95, bank: "双档", basis: "监管零售中的合格交易者个人 45%" },
  { id: "CN_RET_001", cls: "个人贷款", cond: "监管零售个人", rw: "75%", pri: 80, bank: "双档", basis: "监管零售个人 75%" },
  { id: "CN_RET_OTH", cls: "个人贷款", cond: "其他个人", rw: "100%", pri: 10, bank: "双档", basis: "其他个人 100%" },
  { id: "CN_RE_RES_T2", cls: "居住用房地产", cond: "第二档银行", rw: "按交易对手", pri: 100, bank: "第二档", basis: "第二档银行按交易对手计量" },
  { id: "CN_RE_RES_BAD", cls: "居住用房地产", cond: "不符合审慎要求", rw: "150%", pri: 95, bank: "第一档", basis: "不符合审慎要求 150%" },
  { id: "CN_RE_001", cls: "居住用房地产", cond: "不依赖现金流 · LTV≤50%", rw: "20%", pri: 90, bank: "第一档", basis: "不依赖现金流且 LTV≤50%" },
  { id: "CN_RE_IND100", cls: "居住用房地产", cond: "不依赖现金流 · LTV>100%", rw: "按交易对手", pri: 90, bank: "第一档", basis: "不依赖现金流且 LTV>100%" },
  { id: "CN_RE_002", cls: "居住用房地产", cond: "依赖现金流 · LTV≤50%", rw: "30%", pri: 90, bank: "第一档", basis: "依赖现金流且 LTV≤50%" },
  { id: "CN_RE_DEP105", cls: "居住用房地产", cond: "依赖现金流 · LTV>100%", rw: "105%", pri: 90, bank: "第一档", basis: "依赖现金流且 LTV>100%" },
  { id: "CN_RE_IND_MID", cls: "居住用房地产", cond: "不依赖现金流 · 50%<LTV≤100%", rw: "权重表未列明", pri: 88, bank: "第一档", basis: "权重表未给出这一档，不能补百分比" },
  { id: "CN_RE_DEP_MID", cls: "居住用房地产", cond: "依赖现金流 · 50%<LTV≤100%", rw: "权重表未列明", pri: 88, bank: "第一档", basis: "权重表未给出这一档，不能补百分比" },
  { id: "CN_CRE_T2", cls: "商用房地产", cond: "第二档银行", rw: "按交易对手", pri: 100, bank: "第二档", basis: "第二档银行按交易对手计量" },
  { id: "CN_CRE_BAD", cls: "商用房地产", cond: "不符合审慎要求", rw: "150%", pri: 95, bank: "第一档", basis: "不符合审慎要求 150%" },
  { id: "CN_CRE_001", cls: "商用房地产", cond: "不依赖现金流 · LTV≤60%", rw: "65%", pri: 90, bank: "第一档", basis: "不依赖现金流且 LTV≤60%" },
  { id: "CN_CRE_IND_ELSE", cls: "商用房地产", cond: "不依赖现金流 · 未达 LTV 条件", rw: "按交易对手", pri: 80, bank: "第一档", basis: "否则按交易对手计量" },
  { id: "CN_CRE_DEP60", cls: "商用房地产", cond: "依赖现金流 · LTV≤60%", rw: "75%", pri: 90, bank: "第一档", basis: "依赖现金流且 LTV≤60%" },
  { id: "CN_CRE_DEP80", cls: "商用房地产", cond: "依赖现金流 · LTV 60%–80%", rw: "90% 与交易对手较大值", pri: 90, bank: "第一档", basis: "取 90% 与交易对手权重的较大值" },
  { id: "CN_CRE_DEP110", cls: "商用房地产", cond: "依赖现金流 · LTV>80%", rw: "110%", pri: 90, bank: "第一档", basis: "依赖现金流且 LTV>80%" },
  { id: "CN_DEV_001", cls: "房地产开发", cond: "符合审慎要求", rw: "100%", pri: 90, bank: "双档", basis: "符合审慎要求 100%" },
  { id: "CN_DEV_002", cls: "房地产开发", cond: "其他", rw: "150%", pri: 70, bank: "双档", basis: "其他 150%" },
  { id: "CN_EQ_POL", cls: "股权及次级债权", cond: "对我国开发性金融机构、政策性银行的次级债权未扣除部分", rw: "100%", pri: 100, bank: "双档", basis: "次级债权中的这一类为 100%" },
  { id: "CN_EQ_001", cls: "股权及次级债权", cond: "金融机构股权投资未扣除部分", rw: "250%", pri: 80, bank: "双档", basis: "金融机构股权投资未扣除部分 250%" },
  { id: "CN_EQ_SUB", cls: "股权及次级债权", cond: "次级债权及 TLAC 工具一般", rw: "150%", pri: 80, bank: "双档", basis: "次级债权及 TLAC 工具一般 150%" },
  { id: "CN_EQ_002", cls: "股权及次级债权", cond: "其他工商企业股权投资", rw: "1250%", pri: 70, bank: "双档", basis: "其他工商企业股权投资一般 1250%" },
  { id: "CN_DEF_RES", cls: "已违约风险暴露", cond: "以居住用房为抵押且不依赖房地产现金流", rw: "100%", pri: 100, bank: "双档", basis: "已违约中的这一类为 100%" },
  { id: "CN_DEF_T2", cls: "已违约风险暴露", cond: "第二档银行", rw: "按交易对手", pri: 98, bank: "第二档", basis: "第二档银行按交易对手计量" },
  { id: "CN_DEF_001", cls: "已违约风险暴露", cond: "其他已违约 · 损失准备低于账面价值 20%", rw: "150%", pri: 95, bank: "第一档", basis: "损失准备低于账面价值 20%" },
  { id: "CN_DEF_002", cls: "已违约风险暴露", cond: "其他已违约 · 损失准备不低于账面价值 20%", rw: "100%", pri: 90, bank: "第一档", basis: "损失准备不低于账面价值 20%" }
];

const CCF_RULES = [
  { id: "CCF_100", type: "贷款、保函、信用证垫款、远期资产购买、资产转让", cond: "信用风险仍在银行", ccf: "100%", pri: 50 },
  { id: "CCF_COMMIT_40", type: "贷款承诺", cond: "一般贷款承诺", ccf: "40%", pri: 60 },
  { id: "CCF_COMMIT_10", type: "贷款承诺", cond: "可随时无条件撤销", ccf: "10%", pri: 90 },
  { id: "CCF_CARD_40", type: "未使用信用卡额度", cond: "一般", ccf: "40%", pri: 60 },
  { id: "CCF_CARD_20", type: "未使用信用卡额度", cond: "自然人无担保循环授信 · 单卡≤100万且满足监控", ccf: "20%", pri: 90,
    conds: [
      { field: "counterparty_type", op: "=", value: "自然人" },
      { field: "card_limit", op: "≤", param: "CARD_LIMIT" },
      { text: "无担保循环授信且满足监控" }
    ] },
  { id: "CCF_NIF_50", type: "票据发行便利 / 循环认购便利", cond: "一般", ccf: "50%", pri: 60 },
  { id: "CCF_TRADE_20", type: "与贸易直接相关的短期或有项目", cond: "短期", ccf: "20%", pri: 70 },
  { id: "CCF_TRADE_50", type: "服务贸易国内信用证", cond: "服务贸易", ccf: "50%", pri: 70 },
  { id: "CCF_TXN_50", type: "与交易直接相关的或有项目", cond: "一般", ccf: "50%", pri: 60 }
];

const CRM_RULES = [
  { id: "CRM_COL_GOV", type: "合格质物", tool: "国债、央行票据、政策性金融债、高评级政府债券", substitute: "collateral", floorParam: "RW_FLOOR", constraints: { maturity: true, currency: false, correlation: true }, pri: 100 },
  { id: "CRM_COL_CASH", type: "合格质物", tool: "现金、黄金、合格商业银行债券/票据/承兑汇票", substitute: "collateral", floorParam: "RW_FLOOR", constraints: { maturity: true, currency: false, correlation: true }, pri: 100 },
  { id: "CRM_GUAR_PSE", type: "合格保证", tool: "我国公共部门实体、高评级主权、合格商业银行、合格多边开发银行", substitute: "guarantor", floorParam: "", constraints: { maturity: true, currency: true, correlation: false }, pri: 90 },
  { id: "CRM_GUAR_SOV", type: "合格保证", tool: "我国中央政府、央行、政策性银行、开发性金融机构", substitute: "guarantor", floorParam: "", constraints: { maturity: true, currency: true, correlation: false }, pri: 100 },
  { id: "CRM_CDS", type: "合格信用衍生工具", tool: "信用违约互换、信用风险缓释凭证/合约、信用保护合约/凭证、总收益互换", substitute: "provider", floorParam: "", constraints: { maturity: true, currency: true, correlation: false }, pri: 90 }
];

const CRM_SUBSTITUTE = {
  collateral: "覆盖部分取质物或发行人、承兑人的风险权重",
  guarantor: "覆盖部分取保证人的风险权重",
  provider: "覆盖部分取信用保护提供方的风险权重"
};

/** 第一档银行评级只维护这一张表。A+/A/B/C 的百分比不进规则参数。 */
const BANK_GRID = {
  grades: ["A+", "A", "B", "C"],
  rows: [
    { id: "general", label: "一般债权", pri: 80, basis: "第一档商业银行按评级分档", weights: ["30%", "40%", "75%", "150%"], ids: ["CN_BANK_001", "CN_BANK_A", "CN_BANK_B", "CN_BANK_C"] },
    { id: "short", label: "原始期限不超过", param: "SHORT_3M", field: "original_maturity", pri: 96, basis: "短期优惠", weights: ["20%", "20%", "50%", "150%"], ids: ["CN_BANK_002", "CN_BANK_A_ST", "CN_BANK_B_ST", "CN_BANK_C_ST"] },
    { id: "trade", label: "跨境货物贸易不超过", param: "TRADE_6M", field: "original_maturity", extra: { field: "cross_border_trade", operator: "=", value: true }, pri: 97, basis: "跨境货物贸易短期优惠", weights: ["20%", "20%", "50%", "150%"], ids: ["CN_BANK_AP_TR", "CN_BANK_A_TR", "CN_BANK_B_TR", "CN_BANK_C_TR"] }
  ]
};

const MO_GRADES = ["1 AAA–AA-", "2 A+–A-", "3 BBB+–BBB-", "4 BB+–BB-", "5 B+–B-", "6 CCC及以下", "未评级"];
const MO_WEIGHTS = [
  { id: "MO-RW-SOV", bucket: "主权", weights: ["0%", "20%", "50%", "100%", "100%", "150%", "100%"] },
  { id: "MO-RW-PSE", bucket: "公共部门实体", weights: ["20%", "50%", "100%", "100%", "100%", "150%", "100%"] },
  { id: "MO-RW-BANK", bucket: "银行 · 一般", weights: ["20%", "50%", "50%", "100%", "100%", "150%", "50%"] },
  { id: "MO-RW-BANK-ST", bucket: "银行 · 剩余期限≤3个月", weights: ["20%", "20%", "20%", "50%", "50%", "150%", "20%"] },
  { id: "MO-RW-CORP", bucket: "企业 / 非银", weights: ["20%", "50%", "100%", "100%", "150%", "150%", "100%"] },
  { id: "MO-RW-ZERO", bucket: "中华人民共和国财政部", weights: ["0%"], note: "发行人是财政部时直接 0%，不再查评级档" }
];

function paramById(id) {
  return PARAMS.find(function (p) { return p.id === id; }) || null;
}

function paramShown(id) {
  const p = paramById(id);
  if (!p) return id;
  if (p.unit && p.unit !== "%" && p.unit !== "RW") return p.value + p.unit;
  return p.value;
}

function condParamId(c) {
  if (!c) return "";
  if (c.param) return c.param;
  if (c.value && typeof c.value === "object" && c.value.param) return c.value.param;
  return "";
}

function condOperator(c) {
  return (c && (c.operator || c.op)) || "=";
}

function condValueText(c) {
  const param = condParamId(c);
  if (param) return paramShown(param);
  const v = c.value;
  if (Array.isArray(v)) return v.join(" | ");
  if (typeof v === "boolean") return v ? "true" : "false";
  return v == null ? "" : String(v);
}

function condText(conds) {
  return (conds || []).map(function (c) {
    if (c.text && !c.field) return c.text;
    const name = FIELD_LABEL[c.field] || c.field || "";
    return name + " " + condOperator(c) + " " + condValueText(c);
  }).filter(Boolean).join(" · ");
}

function parseWeightNumber(text) {
  const raw = String(text == null ? "" : text).trim();
  const n = parseFloat(raw.replace("%", ""));
  if (!Number.isFinite(n)) return null;
  return raw.indexOf("%") >= 0 || n > 1 ? n / 100 : n;
}

function inferWeightResult(rw) {
  const text = String(rw || "");
  if (text.indexOf("未列明") >= 0) return { type: "unspecified", display: "权重表未列明" };
  if (text.indexOf("较大值") >= 0) return { type: "max", display: "90%", with: "counterparty" };
  if (text.indexOf("交易对手") >= 0) return { type: "counterparty", display: "按交易对手" };
  return { type: "const", display: text };
}

function resultText(result) {
  if (!result) return "";
  if (result.type === "counterparty") return "按交易对手";
  if (result.type === "max") return (result.display || "90%") + " 与交易对手较大值";
  if (result.type === "unspecified") return "权重表未列明";
  return result.display || "";
}

function syncWeightText(w) {
  w.cond = (w.conds && w.conds.length) ? condText(w.conds) : "本类其余";
  if (w.result) w.rw = resultText(w.result);
  return w;
}

function syncCcfText(r) {
  r.cond = r.note || ((r.conds && r.conds.length) ? ccfCondText(r.conds) : "一般");
  return r;
}

function crmEffect(r) {
  let text = CRM_SUBSTITUTE[r.substitute] || "覆盖部分另取权重";
  if (r.floorParam) {
    text += "。一般不低于参数 " + r.floorParam + "（当前 " + paramShown(r.floorParam) + "），特定回购可豁免";
  }
  const c = r.constraints || {};
  const bits = [];
  if (c.maturity && r.substitute === "guarantor") bits.push("剩余期限短于风险暴露的，不具备缓释作用");
  else if (c.maturity) bits.push("期限短于风险暴露的，需按规定调整");
  if (c.currency) bits.push("币种错配时要调整");
  if (c.correlation) bits.push("与债务人信用风险高度正相关时，缓释效果受限");
  if (bits.length) text += "。" + bits.join("；");
  text += "。未覆盖部分仍用原风险暴露的权重";
  return text;
}

function bankGridRules() {
  const out = [];
  BANK_GRID.rows.forEach(function (row) {
    BANK_GRID.grades.forEach(function (grade, i) {
      const conds = [
        { field: "bank_category", operator: "=", value: "第一档银行" },
        { field: "counterparty_rating", operator: "=", value: grade }
      ];
      if (row.extra) conds.push(row.extra);
      if (row.param) conds.push({ field: row.field || "original_maturity", operator: "≤", value: { param: row.param } });
      out.push(syncWeightText({
        id: row.ids[i],
        cls: "金融机构",
        exposure_class: "BANK",
        conds: conds,
        result: { type: "const", display: row.weights[i], risk_weight: parseWeightNumber(row.weights[i]) },
        pri: row.pri,
        bank: "第一档",
        basis: row.basis + " · " + grade,
        grid: { row: row.id, col: i }
      }));
    });
  });
  return out;
}

function allWeightRows() {
  const out = [];
  let injected = false;
  WEIGHTS.forEach(function (w) {
    if (w.cls === "金融机构" && !injected) {
      bankGridRules().forEach(function (g) { out.push(g); });
      injected = true;
    }
    out.push(w);
  });
  if (!injected) bankGridRules().forEach(function (g) { out.push(g); });
  return out;
}

function refreshDerived() {
  WEIGHTS.forEach(syncWeightText);
  CCF_RULES.forEach(syncCcfText);
  CRM_RULES.forEach(function (r) { r.effect = crmEffect(r); });
}

function rulesUsingField(id) {
  const hits = [];
  allWeightRows().forEach(function (w) {
    (w.conds || []).forEach(function (c) {
      if (c.field === id) hits.push(w.id);
    });
  });
  CCF_RULES.forEach(function (r) {
    (r.conds || []).forEach(function (c) {
      if (c.field === id) hits.push(r.id);
    });
  });
  if (id === "collateral_type" || id === "collateral_value") hits.push("合格质物");
  if (id === "guarantee_type" || id === "guarantee_amount") hits.push("合格保证");
  if (id === "remaining_maturity" || id === "currency") hits.push("缓释约束");
  const seen = {};
  return hits.filter(function (x) {
    if (seen[x]) return false;
    seen[x] = true;
    return true;
  });
}

function sourceHeaderOf(f) {
  if (!f) return "";
  if (f.sourceHeader) return f.sourceHeader;
  const sug = SAMPLE_UPLOAD.aiSuggest[f.id];
  if (sug && sug.letter) {
    const col = SAMPLE_UPLOAD.columns.find(function (c) { return c.letter === sug.letter; });
    if (col) return col.header;
  }
  if (sug && sug.const) return "常量 · " + sug.const;
  return "";
}

function activeConfigVersion() {
  return state.selectedVersion || "CN-2025";
}

function configScopeNote(page) {
  const id = activeConfigVersion();
  if (id === "CN-2025") return "";
  const ver = VERSIONS.find(function (v) { return v.id === id; });
  const name = ver ? ver.shortName : id;
  if (id === "MO-2026" && page === "weights") return "";
  const mo = id === "MO-2026"
    ? "澳门这套在「风险权重」里维护标准法分档。CCF、缓释和 LTV 参数属于内地权重法，这里不套用。"
    : "这一版没有另写可维护的数字。不把内地 2025 的权重、CCF、缓释和参数套过来。";
  return "<div class=\"banner warn\">当前监管版本是「" + esc(name) + "」。" + mo
    + "</div><p style=\"margin-top:12px\"><button type=\"button\" class=\"btn btn-primary\" data-version=\"CN-2025\">改看内地 2025 的这张表</button></p>";
}

const DOC_OP = { eq: "=", neq: "≠", lt: "<", lte: "≤", gt: ">", gte: "≥", in: "in" };

function leafByRuleId() {
  const map = {};
  (BASE_EXP_TEMPLATE.categories || []).forEach(function (cat) {
    (cat.children || []).forEach(function (ch) {
      if (ch.rule_id) map[ch.rule_id] = ch;
    });
  });
  return map;
}

function paramForLeafValue(field, op, value, exposure) {
  if (field === "original_maturity" && op === "lte" && value === 3) return "SHORT_3M";
  if (field === "original_maturity" && op === "lte" && value === 6) return "TRADE_6M";
  if (field === "provision_ratio" && (value === 0.2 || value === 20)) return "DEF_PROV";
  if (field !== "ltv") return "";
  const n = Number(value);
  if (exposure === "RE_RESIDENTIAL" && (n === 0.5 || n === 50)) return "LTV_RES_50";
  if (exposure === "RE_RESIDENTIAL" && (n === 1 || n === 100)) return "LTV_RES_100";
  if (exposure === "RE_COMMERCIAL" && (n === 0.6 || n === 60)) return "LTV_CRE_60";
  if (exposure === "RE_COMMERCIAL" && (n === 0.8 || n === 80)) return "LTV_CRE_80";
  return "";
}

function condFromLeaf(c, exposure) {
  const operator = DOC_OP[c.op] || c.op || "=";
  const param = paramForLeafValue(c.field, c.op, c.value, exposure);
  if (param) return { field: c.field, operator: operator, value: { param: param } };
  return { field: c.field, operator: operator, value: c.value };
}

function resultFromLeaf(rw) {
  const src = rw || {};
  if (src.type === "counterparty") return { type: "counterparty", display: "按交易对手" };
  if (src.type === "max") return { type: "max", display: "90%", with: "counterparty", risk_weight: typeof src.with === "number" ? src.with : 0.9 };
  if (src.type === "unspecified") return { type: "unspecified", display: "权重表未列明" };
  const n = typeof src.value === "number" ? src.value : parseWeightNumber(src.display);
  return { type: "const", display: src.display || ((n != null ? (n * 100) + "%" : "")), risk_weight: n };
}

function weightRuleDoc(w) {
  const conditions = (w.conds || []).filter(function (c) { return c.field; }).map(function (c) {
    const param = condParamId(c);
    return {
      field: c.field,
      operator: condOperator(c),
      value: param ? { param: param } : c.value
    };
  });
  const result = {};
  if (w.result && w.result.type && w.result.type !== "const") result.type = w.result.type;
  if (w.result && typeof w.result.risk_weight === "number") result.risk_weight = w.result.risk_weight;
  else if (!result.type && w.result && w.result.type === "const") result.risk_weight = parseWeightNumber(w.result.display || w.rw);
  return {
    rule_id: w.id,
    exposure_class: w.exposure_class || "",
    conditions: conditions,
    result: result,
    priority: w.pri
  };
}

function shapeConfigTables() {
  FIELD_LABEL.card_limit = "单卡上限";
  FIELD_LABEL.provision_ratio = "准备占比";
  FIELD_LABEL.cross_border_trade = "跨境货物贸易";
  FIELD_LABEL.micro_enterprise = "是否小微企业";
  FIELD_LABEL.prudent = "是否符合审慎要求";
  FIELD_LABEL.qualified_trader = "是否合格交易者";
  FIELD_LABEL.project_phase = "项目阶段";
  FIELD_LABEL.sovereign_foreign = "是否境外主权";
  FIELD_LABEL.revenue_from_central = "收入主要源于中央财政";
  const leaves = leafByRuleId();
  WEIGHTS.forEach(function (w) {
    const leaf = leaves[w.id];
    if (leaf && leaf.then) w.exposure_class = leaf.then.exposure_class || w.exposure_class || "";
    const parts = leaf ? flattenMatch(leaf.match) : [];
    if (parts.length) {
      w.conds = parts.map(function (c) { return condFromLeaf(c, w.exposure_class); });
      w.result = resultFromLeaf(leaf.then && leaf.then.risk_weight);
    } else if (!w.conds || w.conds.some(function (c) { return c.text && !c.field; }) || !w.result) {
      w.conds = [];
      w.result = w.result && w.result.type ? w.result : inferWeightResult(w.rw);
      if (w.result.type === "const" && typeof w.result.risk_weight !== "number") w.result.risk_weight = parseWeightNumber(w.result.display || w.rw);
    }
    if (w.result && w.result.type === "const" && !w.result.display) w.result.display = w.rw;
    syncWeightText(w);
  });
  const retail = WEIGHTS.find(function (w) { return w.id === "CN_RET_001"; });
  if (retail) {
    retail.exposure_class = "RETAIL";
    retail.conds = [{ field: "product_sub_type", operator: "in", value: ["信用卡", "贷记卡", "消费贷", "消费贷款", "经营贷"] }];
    retail.result = { type: "const", display: "75%", risk_weight: 0.75 };
    syncWeightText(retail);
  }
  shapeCcfRules();
  refreshDerived();
}
shapeConfigTables();

function shapeCcfRules() {
  FIELD_LABEL.monitor_met = "是否满足监控";
  const specs = {
    CCF_100: { note: "信用风险仍在银行", conds: [], ccfRate: 1 },
    CCF_COMMIT_40: { note: "一般", conds: [], ccfRate: 0.4 },
    CCF_COMMIT_10: { note: "可随时无条件撤销", conds: [{ field: "cancelable", operator: "=", value: true }], ccfRate: 0.1 },
    CCF_CARD_40: { note: "一般", conds: [], ccfRate: 0.4 },
    CCF_CARD_20: { note: "合格", conds: [{ field: "counterparty_type", operator: "=", value: "自然人" }, { field: "card_limit", operator: "≤", value: { param: "CARD_LIMIT" } }, { field: "monitor_met", operator: "=", value: true }], ccfRate: 0.2 },
    CCF_NIF_50: { note: "一般", conds: [], ccfRate: 0.5 },
    CCF_TRADE_20: { note: "短期", conds: [], ccfRate: 0.2 },
    CCF_TRADE_50: { note: "服务贸易", conds: [], ccfRate: 0.5 },
    CCF_TXN_50: { note: "与交易相关", conds: [], ccfRate: 0.5 }
  };
  CCF_RULES.forEach(function (r) {
    const spec = specs[r.id];
    if (!spec) return;
    r.exposure_type = r.type;
    r.note = spec.note;
    r.conds = spec.conds.map(function (c) { return Object.assign({}, c); });
    r.ccfRate = spec.ccfRate;
    r.ccf = (spec.ccfRate * 100) + "%";
  });
}

function ccfCondText(conds) {
  return (conds || []).map(function (c) {
    const name = FIELD_LABEL[c.field] || c.field || "";
    const param = condParamId(c);
    let shown = param ? paramShown(param) : c.value;
    if (shown === true) shown = "是";
    if (shown === false) shown = "否";
    if (Array.isArray(shown)) shown = shown.join(" | ");
    return name + " " + condOperator(c) + " " + shown;
  }).filter(Boolean).join(" · ");
}

function ccfRuleDoc(r) {
  return {
    rule_id: r.id,
    exposure_type: r.type,
    conditions: (r.conds || []).filter(function (c) { return c.field; }).map(function (c) {
      const param = condParamId(c);
      return { field: c.field, operator: condOperator(c), value: param ? { param: param } : c.value };
    }),
    result: { ccf: typeof r.ccfRate === "number" ? r.ccfRate : parseWeightNumber(r.ccf) },
    priority: r.pri
  };
}

function crmRuleDoc(r) {
  const c = r.constraints || {};
  const tail = {
    eligible: true,
    maturity_match: !!c.maturity,
    currency_match: !!c.currency
  };
  if (r.substitute === "guarantor") {
    return Object.assign({ crm_id: r.id, type: "GUARANTEE", guarantor_type: r.tool }, tail);
  }
  if (r.substitute === "provider") {
    return Object.assign({ crm_id: r.id, type: "CDS", protection_type: r.tool }, tail);
  }
  return Object.assign({ crm_id: r.id, type: "COLLATERAL", collateral_type: r.tool }, tail);
}

function crmBlockText(r) {
  const c = r.constraints || {};
  const bits = [];
  if (c.maturity) bits.push("期限短于暴露");
  if (c.currency) bits.push("币种不一致");
  if (c.correlation) bits.push("高度正相关");
  if (r.floorParam) bits.push("低于底线要抬升");
  return bits.length ? bits.join(" · ") : "无额外拦截";
}

const PORTFOLIO = [
  { id: "LN-8821", product: "流动资金贷款", cls: "公司贷款 / 一般公司", ead: 90, rw: "拆分", rwa: 55, note: "10×0% + 50×50% + 30×100% = 55" },
  { id: "LN-1102", product: "个人住房按揭", cls: "居住房地产", ead: 12.5, rw: "20%", rwa: 2.5, note: "LTV 45% · 不依赖现金流" },
  { id: "BK-3301", product: "同业存放", cls: "金融机构 A+", ead: 8, rw: "30%", rwa: 2.4, note: "第一档 · 期限 12 月" },
  { id: "CM-4408", product: "贷款承诺", cls: "公司 / 表外", ead: 20, rw: "100%", rwa: 20, note: "名义 50 × CCF 40%" },
  { id: "EQ-0101", product: "未上市股权", cls: "其他工商企业股权", ead: 1.2, rw: "1250%", rwa: 15, note: "其他工商企业股权投资一般 1250%" }
];

const CALC_STAGES = [
  {
    id: "map",
    title: "① 映射",
    short: "映射",
    detail: "把判定字段对到源表的列"
  },
  {
    id: "run",
    title: "② 计算",
    short: "计算",
    detail: "在源表每一行写入风险暴露类型和 RWA"
  },
  {
    id: "trace",
    title: "③ 追溯",
    short: "追溯",
    detail: "回看规则和手填的权重"
  }
];

const ENGINE_STEPS = [
  { title: "产品识别", detail: "贷款 · 流动资金贷款" },
  { title: "映射", detail: "判定字段对到源表列；计算时把风险暴露类型和 RWA 写回每一行" },
  { title: "监管规则选择", detail: "内地 · 资本管理办法 2025 · 第一档银行" },
  { title: "路由校验", detail: "缺字段、多条规则或权重未列明时停住，不进入计算" },
  { title: "缓释拆分", detail: "合格质物、合格保证、未覆盖部分，分别取对应权重" },
  { title: "表内 / 表外", detail: "最后才分两条线。表内用账面减减值；表外再乘信用转换系数" },
  { title: "结果及依据", detail: "回看规则编号、监管版本和生效日，不编造条款号" }
];

const PAGE_AGENTS = {
  overview: {
    short: "架构",
    name: "架构智能体",
    role: "解释整体链路，并帮你跳到对应配置 / 计算页。",
    welcome: "我是架构智能体。可以问「配置和计算怎么分工」，或直接让我打开某一页。",
    chips: [
      { label: "解释配置与计算", action: "explain" },
      { label: "打开监管版本", action: "goto:regulation" },
      { label: "打开分类判断", action: "goto:exposure" },
      { label: "打开 RWA 计算", action: "goto:engine" }
    ]
  },
  regulation: {
    short: "版本",
    name: "监管版本智能体",
    role: "新建带截取时点的版本；切换客户 / 打开版本时自动静默同步到知识库。",
    welcome: "可以说「新建版本」或「切到香港」。对知识库的写入一律静默，无需确认。",
    chips: [
      { label: "打开新建版本", action: "reg:open-create" },
      { label: "切到香港版本", action: "reg:hk" },
      { label: "切回内地版本", action: "reg:cn" }
    ]
  },
  fields: {
    short: "字段",
    name: "产品字段智能体",
    role: "新建产品类型 → 知识库匹配同步 → 类型下维护字段。",
    welcome: "可说「新建类型」「同步当前类型」或「新建字段」。",
    chips: [
      { label: "新建产品类型", action: "field:open-type" },
      { label: "同步当前类型", action: "field:sync-one" },
      { label: "打开新建字段", action: "field:open-create" },
      { label: "新增 LTV 字段", action: "field:add-ltv" }
    ]
  },
  params: {
    short: "参数",
    name: "规则参数智能体",
    role: "调整 LTV、期限、准备占比这类门槛。评级百分比去风险权重里改。",
    welcome: "居住用房的 LTV 分界是 50% 和 100%，商用房地产才是 60% 和 80%。不能把居住分界改成 60%。",
    chips: [
      { label: "查看居住 LTV 50%", action: "param:ltv60" },
      { label: "查看跨境贸易 6 个月", action: "param:add" },
      { label: "查看准备门槛 20%", action: "param:reset-def" }
    ]
  },
  exposure: {
    short: "暴露",
    name: "分类判断智能体",
    role: "各产品走同一套分类，只跳过不适用的分支。",
    welcome: "点左边某个产品看分类。贷款会去掉不适用的分支。也可以打开通用流程模板。",
    chips: [
      { label: "打开通用流程模板", action: "exp:scope-base" },
      { label: "切到产品线路", action: "exp:scope-product" },
      { label: "演示公司命中", action: "exp:demo-corp" }
    ]
  },
  weights: {
    short: "权重",
    name: "风险权重智能体",
    role: "新增 / 调整 Risk_Weight_Rule，按 priority 匹配。",
    welcome: "投资级公司是 75%，不能改成 70%。可以说「只看公司贷款」或「切到第二档」。",
    chips: [
      { label: "核对投资级 75%", action: "rw:add-ig70" },
      { label: "筛选公司贷款", action: "rw:filter-corp" },
      { label: "切到第二档", action: "rw:tier2" }
    ]
  },
  ccf: {
    short: "CCF",
    name: "CCF 智能体",
    role: "维护表外信用转换系数，并可带到计算页试算。",
    welcome: "与贸易直接相关的短期或有项目是 20%，服务贸易国内信用证是 50%。没有单独的跟单信用证档。",
    chips: [
      { label: "查看贸易相关 20%", action: "ccf:add" },
      { label: "选中一般承诺 40%", action: "ccf:pick40" },
      { label: "带到计算页试算", action: "ccf:to-engine" }
    ]
  },
  crm: {
    short: "CRM",
    name: "CRM 缓释智能体",
    role: "维护合格缓释工具与拆分效果，可跳转交互试算。",
    welcome: "黄金、现金、国债都是合格质物。覆盖部分用质物自己的风险权重，不把黄金写成 0%。",
    chips: [
      { label: "查看黄金质物", action: "crm:add-gold" },
      { label: "选中国债质押", action: "crm:pick-gov" },
      { label: "打开拆分试算", action: "crm:to-engine" }
    ]
  },
  engine: {
    short: "计算",
    name: "RWA 计算智能体",
    role: "覆盖映射、计算和追溯，可对话改数或推进步骤。",
    welcome: "计算三步：映射 → 计算 → 追溯。先把判定字段对到源表列，计算时在每一行写入风险暴露类型和 RWA。",
    chips: [
      { label: "演示上传并识别", action: "map:demo" },
      { label: "核对完成并试算", action: "map:confirm" },
      { label: "恢复文档示例", action: "eng:reset" },
      { label: "追加表外 50×40%", action: "eng:off80" }
    ]
  }
};
