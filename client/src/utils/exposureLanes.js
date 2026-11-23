// 香港 STC 规则集的业务分支展示配置，与 STC_监管规则全景图 的「业务分支 / 判断阶段」一致。
// 只负责全景图、分类矩阵和决策流程的分组展示，不参与分类、权重或金额计算。
// 节点编号来自 docs/信用风险规则/ 下的分类与权重规则集；缺号时退回按顶层节点自动分组。

export const STC_LANE_GROUPS = [
  {
    key: "sovereign",
    title: "主权及公共部门",
    desc: "主权、中央银行、公共部门实体、多边开发银行与国际组织",
    entry: "obligor_type∈{SOVEREIGN,CENTRAL_BANK,INTERNATIONAL_ORGANISATION} 或 obligor_type∈{PSE_LOCAL,PSE_NON_LOCAL}",
    s2: ["CLS500", "CLS510", "CLS520", "CLS530"],
    s3: [],
    s4: ["RW100", "RW110", "RW120", "RW130"]
  },
  {
    key: "bank",
    title: "银行及金融机构",
    desc: "银行、合资格非银行金融机构、合资格担保债券",
    entry: "obligor_type=BANK 或 obligor_type=QNBFI",
    s2: ["CLS600", "CLS610"],
    s3: ["CLS600-10", "CLS600-90", "CLS610-10", "CLS610-95", "CLS610-90"],
    s4: ["RW140"]
  },
  {
    key: "corporate",
    title: "公司及专业贷款",
    desc: "一般公司、小企业、物品／商品／项目融资",
    entry: "specialised_lending_type∈{OBJECT_FINANCE,COMMODITIES_FINANCE,PROJECT_FINANCE} 或 obligor_type∈{CORPORATE,OTHER}",
    s2: ["CLS700", "CLS710"],
    s3: [],
    s4: ["RW170", "RW180"]
  },
  {
    key: "retail",
    title: "零售与个人",
    desc: "监管零售、其他个人零售、IPO 融资",
    entry: "ipo_purpose_qualified_flag=TRUE 且 ipo_fini_settlement_flag=TRUE 且 ipo_funds_controlled_flag=TRUE 且 ipo_period_active_flag=TRUE 或 retail_obligor_eligible_flag=TRUE 且 retail_excluded_flag=FALSE 且 re_exposure_flag=FALSE 且 retail_transaction_form_flag=TRUE 且 retail_single_obligor_exposure_hkd≤RETAIL_SINGLE_OBLIGOR_LIMIT_HKD 且 retail_portfolio_ratio≤RETAIL_PORTFOLIO_RATIO_LIMIT",
    s2: ["CLS300", "CLS400", "CLS410"],
    s3: [],
    s4: ["RW190", "RW200"]
  },
  {
    key: "realestate",
    title: "房地产",
    desc: "ADC、监管房地产（含住宅／商业、IPRE）、其他房地产",
    entry: "re_exposure_flag=TRUE 且 property_type∈{RESIDENTIAL,COMMERCIAL,RESIDENTIAL_UNDER_CONSTRUCTION}",
    s2: ["CLS800"],
    s3: ["CLS800-10", "CLS800-15", "CLS800-20", "CLS800-90"],
    s4: ["RW210"]
  },
  {
    key: "equity",
    title: "股权与资本工具",
    desc: "股权、重大资本投资、金融部门资本工具、次级债",
    entry: "financial_sector_capital_instrument_flag=TRUE 或 subordinated_debt_flag=TRUE",
    s2: ["CLS070", "CLS150", "CLS200"],
    s3: ["CLS200-30", "CLS200-40", "CLS200-90"],
    s4: ["RW220", "RW230", "RW240"]
  },
  {
    key: "cash",
    title: "现金与结算",
    desc: "现金、黄金、清算及结算项目",
    entry: "asset_form∈{CASH_LEGAL_TENDER,GOVERNMENT_DEBT_CERTIFICATE,GOLD_ALLOCATED,GOLD_UNALLOCATED,GOLD_NO_LIABILITY_SUPPORT} 或 exposure_type=SETTLEMENT 或 clearing_item_flag=TRUE 或 collection_item_flag=TRUE 或 settlement_method∈{DVP,NON_DVP}",
    s2: ["CLS100", "CLS110"],
    s3: [],
    s4: ["RW250", "RW260"]
  },
  {
    key: "special",
    title: "特殊与结构化",
    desc: "CLN、一篮子信用衍生工具、其他暴露",
    entry: "cln_flag=TRUE 且 cln_basket_type∈{SINGLE_NAME,NOT_APPLICABLE} 或 cln_basket_type∈{FIRST_TO_DEFAULT,SECOND_TO_DEFAULT,NTH_TO_DEFAULT,PRO_RATA}",
    s2: ["CLS010", "CLS020", "CLS900"],
    s3: [],
    s4: ["RW270", "RW280", "RW290"]
  }
];

// 分类矩阵和决策流程左侧的「所属分支」缩写，沿用规则全景图的分类分组。
export const STC_CLASS_LANE = {
  SOVEREIGN: "主权/PSE",
  PSE: "主权/PSE",
  MDB: "主权/PSE",
  UMB: "主权/PSE",
  BANK: "银行/QNBFI",
  ELIGIBLE_COVERED_BOND: "银行/QNBFI",
  QNBFI: "银行/QNBFI",
  CORPORATE: "公司及专业贷款",
  SPECIALISED_LENDING: "公司/专业贷款",
  RETAIL: "零售/IPO",
  RETAIL_OTHER: "零售/IPO",
  IPO_FINANCING: "零售/IPO",
  REAL_ESTATE: "房地产",
  EQUITY: "股权/资本工具",
  SIGNIFICANT_CAPITAL_INVESTMENT: "股权/资本工具",
  FINANCIAL_SECTOR_CAPITAL_INSTRUMENT: "股权/资本工具",
  SUBORDINATED_DEBT: "股权/资本工具",
  OTHER: "股权/资本工具",
  CASH_AND_GOLD: "现金/结算",
  SETTLEMENT: "现金/结算",
  CREDIT_LINKED_NOTE: "特殊/结构化",
  CREDIT_DERIVATIVE_BASKET: "特殊/结构化",
  DEFAULTED: "—",
  CAPITAL_DEDUCTION: "—",
  OUT_OF_SCOPE: "—"
};

export const STC_LANE_ORDER = [
  "主权/PSE",
  "银行/QNBFI",
  "公司/专业贷款",
  "零售/IPO",
  "房地产",
  "股权/资本工具",
  "现金/结算",
  "特殊/结构化",
  "其他/控制类"
];

// 分类矩阵和决策流程左侧的类别顺序，与 STC_监管规则全景图的类别列表一致。
export const STC_CLASS_ORDER = [
  "SOVEREIGN",
  "PSE",
  "MDB",
  "UMB",
  "BANK",
  "ELIGIBLE_COVERED_BOND",
  "QNBFI",
  "CORPORATE",
  "SPECIALISED_LENDING",
  "RETAIL",
  "RETAIL_OTHER",
  "IPO_FINANCING",
  "REAL_ESTATE",
  "EQUITY",
  "SIGNIFICANT_CAPITAL_INVESTMENT",
  "FINANCIAL_SECTOR_CAPITAL_INSTRUMENT",
  "SUBORDINATED_DEBT",
  "DEFAULTED",
  "CAPITAL_DEDUCTION",
  "CASH_AND_GOLD",
  "SETTLEMENT",
  "CREDIT_LINKED_NOTE",
  "CREDIT_DERIVATIVE_BASKET",
  "OTHER",
  "OUT_OF_SCOPE"
];

export function stcLaneAvailable(nodes) {
  return STC_LANE_GROUPS.every((lane) => lane.s2.some((id) => nodes[id]));
}

export function classLaneLabel(code) {
  return STC_CLASS_LANE[code] || "";
}
