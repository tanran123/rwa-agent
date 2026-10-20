const FIELD_LABELS = {
  instrument_type: "工具",
  is_defaulted: "是否已违约",
  counterparty_type: "交易对手",
  counterparty_name: "交易对手名称",
  balance: "债项余额",
  impairment: "减值准备",
  offbalance: "是否表外",
  onbalance_amount: "表内余额",
  offbalance_amount: "表外未提用金额",
  ccf: "信用转换系数",
  original_maturity_months: "原始期限",
  remaining_maturity_months: "剩余期限",
  ltv: "贷款价值比",
  has_property_collateral: "是否有房地产抵押",
  property_uses: "抵押物用途",
  cashflow_dependent: "还款是否实质依赖房地产现金流",
  prudent: "是否符合审慎要求",
  single_exposure: "对单一债务人的风险暴露",
  exposure_share: "占全行信用风险暴露的比例",
  provision_ratio: "损失准备比例",
  bank_tier: "银行档次",
  product_code: "产品代码",
  issuer_rating: "外部评级",
  pse_region: "公共部门所在地",
  is_subordinated: "是否次级债权",
  cross_border_trade: "是否跨境货物贸易",
  enterprise_size: "企业划型",
  revenue_last_year: "最近一年营业收入",
  meets_minimum_capital: "是否满足最低资本要求",
  audit_opinion: "外部审计意见",
  product_name: "产品",
  fi_bank_applicable: "是否适用"
};

const CODE_LABELS = {
  claim: "债权",
  equity: "股权",
  covered_bond: "资产担保债券",
  cash: "现金",
  yes: "是",
  no: "否",
  unknown: "无法判断",
  cn_central_government: "我国中央政府",
  cn_central_bank: "我国中央银行",
  foreign_sovereign: "其他主权国家或经济实体",
  pse: "公共部门实体",
  mdb: "多边开发银行",
  commercial_bank: "商业银行",
  other_fi: "其他金融机构",
  development_fi: "开发性金融机构",
  policy_bank: "政策性银行",
  corporate: "公司",
  partnership: "合伙制企业",
  sole_proprietorship: "独资企业",
  spe: "特殊目的实体",
  other_non_individual: "其他非自然人",
  individual: "自然人",
  domestic: "境内",
  overseas: "境外",
  residential: "居住",
  commercial: "商用",
  mixed_use: "商住两用",
  tier1: "第一档",
  tier2: "第二档",
  micro: "微型",
  small: "小型",
  medium: "中型",
  large: "大型",
  none: "无报告",
  unqualified: "无保留",
  qualified: "保留",
  adverse: "否定",
  disclaimer: "无法表示",
  going_concern: "持续经营存疑",
  not_rated: "未评级",
  applicable: "适用",
  not_applicable: "不适用"
};

export const OP_LABELS = {
  eq: "等于",
  in: "属于集合",
  contains: "含有",
  gt: "大于",
  gte: "大于等于",
  lt: "小于",
  lte: "小于等于"
};

export function pct2(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return +(n * 100).toFixed(2) + "%";
}

export function labelBook(fields) {
  const labels = { ...FIELD_LABELS };
  const codes = { ...CODE_LABELS };
  (fields || []).forEach((field) => {
    if (!field || !field.name) return;
    if (field.label) labels[field.name] = field.label;
    (field.options || []).forEach((option) => {
      if (option && option.code != null && option.label) codes[String(option.code)] = option.label;
    });
  });
  return { labels, codes };
}

export function codeText(value, codes) {
  if (Array.isArray(value)) return value.map((item) => codeText(item, codes)).join("、");
  if (value === true) return "是";
  if (value === false) return "否";
  if (value == null) return "—";
  const key = String(value);
  return codes[key] != null ? codes[key] : key;
}

export function whenKey(when) {
  if (!when) return "";
  if (Array.isArray(when.all)) return "all";
  if (Array.isArray(when.any)) return "any";
  if (when.field) return "field";
  return "";
}

export function summarizeWhen(when, book) {
  if (!when) return "—";
  const key = whenKey(when);
  if (key === "field") {
    const value = Array.isArray(when.match) ? when.match.map((item) => codeText(item, book.codes)).join("|") : codeText(when.match, book.codes);
    return (book.labels[when.field] || when.field) + " " + (OP_LABELS[when.op] || when.op || "等于") + " " + value;
  }
  if (!key) return "—";
  const parts = when[key].map((item) => {
    if (item && (item.all || item.any)) return "(" + summarizeWhen(item, book) + ")";
    const value = Array.isArray(item.match) ? item.match.map((code) => codeText(code, book.codes)).join("|") : codeText(item.match, book.codes);
    return (book.labels[item.field] || item.field) + " " + (OP_LABELS[item.op] || item.op || "等于") + " " + value;
  });
  return parts.join(key === "all" ? " 且 " : " 或 ");
}
