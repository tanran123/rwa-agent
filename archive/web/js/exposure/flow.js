/* 分类判断的流程模型和 JSON 转换 */
/* 分类判断流程：整份用 JSON 描述；条件 / 结果 / 公式也是 JSON */
function cond(field, op, value) {
  return { field: field, op: op, value: value };
}
function matchAll(list) {
  return { all: list };
}
function rwConst(rate, display) {
  return { type: "const", value: rate, display: display || ((rate * 100) + "%") };
}
function rwLookup(table, keyField, display) {
  return { type: "lookup", table: table, key: keyField, display: display || "lookup" };
}
function rwFormula(expr, display) {
  return { type: "formula", expr: expr, display: display || JSON.stringify(expr) };
}
function rwFollow(display) {
  const text = display || "按交易对手";
  if (text.indexOf("较大值") >= 0) {
    const picked = text.match(/([\d.]+)\s*%/);
    const floor = picked ? parseFloat(picked[1]) / 100 : 0.9;
    return {
      type: "max",
      display: text,
      with: floor,
      note: "取 " + ratioText(floor) + " 与交易对手普通债权权重的较大值。交易对手只查一次权重，不把产品瀑布再跑一遍。"
    };
  }
  return { type: "counterparty", display: text.indexOf("交易对手") >= 0 ? text : "按交易对手", note: "改用交易对手自己的普通债权权重。公司走公司，个人走个人，银行走银行。只查一次，不把产品瀑布再跑一遍。" };
}
function leafRule(opts) {
  const o = opts || {};
  const rw = o.rw || rwConst(1, "100%");
  return {
    id: o.id,
    type: "leaf",
    label: o.label,
    priority: o.priority == null ? 50 : o.priority,
    rule_id: o.rule_id || String(o.id || "").replace(/^sub:/, "EXP_").toUpperCase().replace(/-/g, "_"),
    match: o.match || { all: [] },
    then: {
      exposure_class: o.exposure_class || "",
      sub_class: o.sub_class || o.label || "",
      risk_weight: rw
    },
    formula: o.formula || null,
    content: o.content || {}
  };
}
function gateLayer(opts) {
  const o = opts || {};
  return {
    id: o.id,
    type: "gate",
    label: o.label,
    question: o.question,
    match: o.match || { all: [] },
    on_match: "expand_children",
    on_miss: "next_layer",
    children: o.children || []
  };
}

const BASE_EXP_TEMPLATE = {
  id: "exp_flow_base_cn_2025",
  name: "通用流程模板",
  version: "1.0",
  kind: "waterfall",
  meta: {
    jurisdiction: "CN",
    method: "信用风险权重法",
    regulation: "资本管理办法 2025",
    description: "打开页面后改用知识库里的风险暴露分类。股权在前，已违约紧随其后。某一支标不适用就整段跳过，不落入同一层兜底。",
    default_first: false,
    default_first_note: "已违约在股权之后、房地产和公司之前。股权即使违约也先归股权。",
    tree_align: "knowledge/权重法风险暴露分类.json"
  },
  engine: {
    mode: "waterfall",
    on_yes: "branch_right_to_subclass_then_weight",
    on_no: "continue_down",
    child_select: "first_match_then_children"
  },
  formulas: {
    ead_on: {
      op: "sub",
      args: [{ var: "balance" }, { var: "impairment" }],
      display: "EAD = balance - impairment"
    },
    ead_off: {
      op: "mul",
      args: [{ var: "nominal" }, { var: "ccf" }],
      display: "EAD = nominal × CCF"
    },
    rwa: {
      op: "mul",
      args: [{ var: "ead" }, { ref: "risk_weight" }],
      display: "无缓释拆分时 RWA = EAD × 风险权重"
    },
    rwa_on: {
      op: "sum",
      args: [
        { op: "mul", args: [{ var: "seg_exposure" }, { var: "seg_rw" }] }
      ],
      display: "表内 RWA = Σ(各部分风险暴露 × 对应权重)"
    },
    rwa_off: {
      op: "sum",
      args: [
        { op: "mul", args: [{ var: "nominal" }, { var: "ccf" }, { var: "seg_rw" }] }
      ],
      display: "表外 RWA = Σ(名义金额 × CCF × 各部分对应权重)"
    },
    rwa_crm_split: {
      op: "sum",
      args: [
        { op: "mul", args: [{ var: "seg_amount" }, { var: "seg_rw" }] }
      ],
      display: "RWA = Σ(各部分 × 对应权重)"
    }
  },
  head: [
    {
      id: "proc:start", type: "process", label: "开始判定",
      content: { note: "标准字段已就绪", require: ["standard_fields_ready"] }
    },
    {
      id: "proc:product", type: "process", label: "识别产品",
      content: { note: "按产品类型进入对应瀑布副本", require: ["product_type"] }
    }
  ],
  /** 最后计算才分的两条线：表内不乘 CCF，表外先乘 CCF */
  books: [
    {
      id: "line:on", kind: "onbook", label: "表内",
      note: "Σ((账面 − 减值) × 权重)",
      when: { field: "offbalance", op: "neq", value: true },
      formula_ref: "formulas.rwa_on",
      content: { basis: "表内 RWA = Σ(各部分风险暴露 × 对应权重)，不乘信用转换系数" }
    },
    {
      id: "line:off", kind: "ccf", label: "表外",
      note: "Σ(名义 × CCF × 权重)",
      when: { field: "offbalance", op: "eq", value: true },
      formula_ref: "formulas.rwa_off",
      content: { basis: "表外 RWA = Σ(名义金额 × CCF × 各部分对应权重)" }
    }
  ],
  /** 定权之后：路由校验 → 缓释 → 表内/表外模板 → 回执 */
  tail: [
    {
      id: "step:route", kind: "rule", label: "路由校验",
      note: "只校验，不计算",
      content: {}
    },
    {
      id: "step:crm", kind: "crm", label: "缓释拆分",
      note: "覆盖部分 · 未覆盖部分",
      formula_ref: "formulas.rwa_crm_split",
      content: { basis: "合格质物、保证、信用衍生工具的覆盖部分改用对应权重；未覆盖部分仍用原权重" }
    },
    {
      id: "step:out", kind: "result", label: "结果与依据",
      note: "路由回执",
      content: {}
    }
  ],
  categories: [
    gateLayer({
      id: "cat:sov", label: "现金及主权类", question: "是否现金及主权类？",
      match: matchAll([cond("issuer_type", "in", ["现金", "央行", "中央政府", "主权", "政策性银行", "开发性金融机构", "多边开发银行", "MDB"])]),
      children: [
        leafRule({ id: "sub:cash", label: "现金", priority: 100, rule_id: "CN_SOV_CASH", exposure_class: "SOVEREIGN", sub_class: "现金", match: matchAll([cond("issuer_type", "eq", "现金")]), rw: rwConst(0, "0%"), content: { basis: "现金" } }),
        leafRule({ id: "sub:cb", label: "存放央行", priority: 100, rule_id: "CN_SOV_CB", exposure_class: "SOVEREIGN", sub_class: "央行", match: matchAll([cond("issuer_type", "eq", "央行")]), rw: rwConst(0, "0%"), content: { basis: "存放央行" } }),
        leafRule({ id: "sub:cg", label: "我国中央政府", priority: 100, rule_id: "CN_SOV_001", exposure_class: "SOVEREIGN", sub_class: "中央政府", match: matchAll([cond("issuer_type", "in", ["中央政府", "主权"]), cond("sovereign_foreign", "eq", false)]), rw: rwConst(0, "0%"), content: { basis: "对我国中央政府债权 0%" } }),
        leafRule({ id: "sub:policy", label: "政策性银行 / 开发性金融机构", priority: 100, rule_id: "CN_SOV_POL", exposure_class: "SOVEREIGN", sub_class: "政策性银行", match: matchAll([cond("issuer_type", "in", ["政策性银行", "开发性金融机构"])]), rw: rwConst(0, "0%"), content: { basis: "政策性银行、开发性金融机构 0%" } }),
        leafRule({ id: "sub:mdb", label: "合格多边开发银行", priority: 100, rule_id: "CN_SOV_MDB", exposure_class: "SOVEREIGN", sub_class: "多边开发银行", match: matchAll([cond("issuer_type", "in", ["多边开发银行", "MDB"])]), rw: rwConst(0, "0%"), content: { basis: "合格多边开发银行 0%" } }),
        leafRule({ id: "sub:sov-aa", label: "境外主权 AA- 及以上", priority: 90, rule_id: "CN_SOV_AA", exposure_class: "SOVEREIGN", sub_class: "境外主权 AA-", match: matchAll([cond("sovereign_foreign", "eq", true), cond("issuer_rating", "in", ["AAA", "AA+", "AA", "AA-"])]), rw: rwConst(0, "0%"), content: { basis: "境外主权 AA- 及以上 0%" } }),
        leafRule({ id: "sub:sov-b", label: "境外主权 B- 以下", priority: 90, rule_id: "CN_SOV_B", exposure_class: "SOVEREIGN", sub_class: "境外主权 B- 以下", match: matchAll([cond("sovereign_foreign", "eq", true), cond("issuer_rating", "in", ["CCC", "CC", "C", "D"])]), rw: rwConst(1.5, "150%"), content: { basis: "境外主权 B- 以下 150%" } }),
        leafRule({ id: "sub:sov-nr", label: "境外主权未评级", priority: 85, rule_id: "CN_SOV_NR", exposure_class: "SOVEREIGN", sub_class: "境外主权未评级", match: matchAll([cond("sovereign_foreign", "eq", true), cond("issuer_rating", "in", ["未评级", "NR", "无"])]), rw: rwConst(1.0, "100%"), content: { basis: "境外主权未评级 100%" } }),
        leafRule({ id: "sub:sov-other", label: "境外主权其他评级", priority: 70, rule_id: "CN_SOV_OTHER", exposure_class: "SOVEREIGN", sub_class: "境外主权其他评级", match: matchAll([cond("sovereign_foreign", "eq", true)]), rw: { type: "unspecified", display: "权重表未列明" }, content: { basis: "权重表只写了 AA- 及以上 0%、B- 以下 150%、未评级 100%，其余评级未列明" } })
      ]
    }),
    gateLayer({
      id: "cat:pse", label: "公共部门实体", question: "是否公共部门实体？",
      match: matchAll([cond("issuer_type", "in", ["公共部门", "地方政府", "PSE"])]),
      children: [
        leafRule({ id: "sub:pse-gen", label: "省级一般债", priority: 90, rule_id: "CN_PSE_001", exposure_class: "PSE", sub_class: "省级一般债", match: matchAll([cond("product_sub_type", "in", ["一般债", "省级一般债"])]), rw: rwConst(0.1, "10%"), content: { basis: "省级及计划单列市政府一般债 10%" } }),
        leafRule({ id: "sub:pse-spec", label: "专项债", priority: 90, rule_id: "CN_PSE_002", exposure_class: "PSE", sub_class: "专项债", match: matchAll([cond("product_sub_type", "eq", "专项债")]), rw: rwConst(0.2, "20%"), content: { basis: "专项债 20%" } }),
        leafRule({ id: "sub:pse-sov", label: "视同我国主权", priority: 85, rule_id: "CN_PSE_SOV", exposure_class: "PSE", sub_class: "视同主权", match: matchAll([cond("revenue_from_central", "eq", true)]), rw: rwConst(0.2, "20%"), content: { basis: "收入主要源于中央财政 20%" } }),
        leafRule({ id: "sub:pse-other", label: "一般公共部门", priority: 70, rule_id: "CN_PSE_003", exposure_class: "PSE", sub_class: "一般公共部门", rw: rwConst(0.5, "50%"), content: { basis: "一般公共部门实体 50%" } })
      ]
    }),
    gateLayer({
      id: "cat:bank", label: "金融机构", question: "是否金融机构？",
      match: matchAll([cond("counterparty_type", "in", ["银行", "金融机构", "同业"])]),
      children: [
        leafRule({ id: "sub:bank-ap-st", label: "第一档 · A+ · 短期", priority: 96, rule_id: "CN_BANK_002", exposure_class: "BANK", sub_class: "第一档 A+ 短期", match: matchAll([cond("bank_category", "eq", "第一档银行"), cond("counterparty_rating", "eq", "A+"), cond("original_maturity", "lte", 3)]), rw: rwConst(0.2, "20%"), content: { basis: "原始期限 3 个月以内降至 20%" } }),
        leafRule({ id: "sub:bank-a-st", label: "第一档 · A · 短期", priority: 96, rule_id: "CN_BANK_A_ST", exposure_class: "BANK", sub_class: "第一档 A 短期", match: matchAll([cond("bank_category", "eq", "第一档银行"), cond("counterparty_rating", "eq", "A"), cond("original_maturity", "lte", 3)]), rw: rwConst(0.2, "20%"), content: { basis: "短期 A 档 20%" } }),
        leafRule({ id: "sub:bank-b-st", label: "第一档 · B · 短期", priority: 96, rule_id: "CN_BANK_B_ST", exposure_class: "BANK", sub_class: "第一档 B 短期", match: matchAll([cond("bank_category", "eq", "第一档银行"), cond("counterparty_rating", "eq", "B"), cond("original_maturity", "lte", 3)]), rw: rwConst(0.5, "50%"), content: { basis: "短期 B 档 50%" } }),
        leafRule({ id: "sub:bank-c-st", label: "第一档 · C · 短期", priority: 96, rule_id: "CN_BANK_C_ST", exposure_class: "BANK", sub_class: "第一档 C 短期", match: matchAll([cond("bank_category", "eq", "第一档银行"), cond("counterparty_rating", "eq", "C"), cond("original_maturity", "lte", 3)]), rw: rwConst(1.5, "150%"), content: { basis: "短期 C 档仍为 150%" } }),
        leafRule({ id: "sub:bank-ap-tr", label: "第一档 · A+ · 跨境贸易 6 个月", priority: 97, rule_id: "CN_BANK_AP_TR", exposure_class: "BANK", sub_class: "第一档 A+ 贸易", match: matchAll([cond("bank_category", "eq", "第一档银行"), cond("counterparty_rating", "eq", "A+"), cond("cross_border_trade", "eq", true), cond("original_maturity", "lte", 6)]), rw: rwConst(0.2, "20%"), content: { basis: "跨境货物贸易 6 个月以内降至 20%" } }),
        leafRule({ id: "sub:bank-a-tr", label: "第一档 · A · 跨境贸易 6 个月", priority: 97, rule_id: "CN_BANK_A_TR", exposure_class: "BANK", sub_class: "第一档 A 贸易", match: matchAll([cond("bank_category", "eq", "第一档银行"), cond("counterparty_rating", "eq", "A"), cond("cross_border_trade", "eq", true), cond("original_maturity", "lte", 6)]), rw: rwConst(0.2, "20%"), content: { basis: "跨境货物贸易 6 个月以内降至 20%" } }),
        leafRule({ id: "sub:bank-b-tr", label: "第一档 · B · 跨境贸易 6 个月", priority: 97, rule_id: "CN_BANK_B_TR", exposure_class: "BANK", sub_class: "第一档 B 贸易", match: matchAll([cond("bank_category", "eq", "第一档银行"), cond("counterparty_rating", "eq", "B"), cond("cross_border_trade", "eq", true), cond("original_maturity", "lte", 6)]), rw: rwConst(0.5, "50%"), content: { basis: "跨境货物贸易 6 个月以内降至 50%" } }),
        leafRule({ id: "sub:bank-c-tr", label: "第一档 · C · 跨境贸易 6 个月", priority: 97, rule_id: "CN_BANK_C_TR", exposure_class: "BANK", sub_class: "第一档 C 贸易", match: matchAll([cond("bank_category", "eq", "第一档银行"), cond("counterparty_rating", "eq", "C"), cond("cross_border_trade", "eq", true), cond("original_maturity", "lte", 6)]), rw: rwConst(1.5, "150%"), content: { basis: "跨境货物贸易 6 个月以内为 150%" } }),
        leafRule({ id: "sub:bank-ap", label: "第一档 · A+", priority: 80, rule_id: "CN_BANK_001", exposure_class: "BANK", sub_class: "第一档 A+", match: matchAll([cond("bank_category", "eq", "第一档银行"), cond("counterparty_rating", "eq", "A+")]), rw: rwConst(0.3, "30%"), content: { basis: "第一档 A+ 30%" } }),
        leafRule({ id: "sub:bank-a", label: "第一档 · A", priority: 80, rule_id: "CN_BANK_A", exposure_class: "BANK", sub_class: "第一档 A", match: matchAll([cond("bank_category", "eq", "第一档银行"), cond("counterparty_rating", "eq", "A")]), rw: rwConst(0.4, "40%"), content: { basis: "第一档 A 40%" } }),
        leafRule({ id: "sub:bank-b", label: "第一档 · B", priority: 80, rule_id: "CN_BANK_B", exposure_class: "BANK", sub_class: "第一档 B", match: matchAll([cond("bank_category", "eq", "第一档银行"), cond("counterparty_rating", "eq", "B")]), rw: rwConst(0.75, "75%"), content: { basis: "第一档 B 75%" } }),
        leafRule({ id: "sub:bank-c", label: "第一档 · C", priority: 80, rule_id: "CN_BANK_C", exposure_class: "BANK", sub_class: "第一档 C", match: matchAll([cond("bank_category", "eq", "第一档银行"), cond("counterparty_rating", "eq", "C")]), rw: rwConst(1.5, "150%"), content: { basis: "第一档 C 150%" } }),
        leafRule({ id: "sub:bank2-st", label: "第二档 · 短期", priority: 90, rule_id: "CN_BANK_T2_ST", exposure_class: "BANK", sub_class: "第二档短期", match: matchAll([cond("bank_category", "eq", "第二档银行"), cond("original_maturity", "lte", 3)]), rw: rwConst(0.2, "20%"), content: { basis: "第二档短期 20%" } }),
        leafRule({ id: "sub:bank2", label: "第二档银行", priority: 70, rule_id: "CN_BANK_T2", exposure_class: "BANK", sub_class: "第二档银行", match: matchAll([cond("bank_category", "eq", "第二档银行")]), rw: rwConst(0.4, "40%"), content: { basis: "第二档一般 40%" } }),
        leafRule({ id: "sub:ofi-ig", label: "其他金融机构 · 投资级", priority: 80, rule_id: "CN_OFI_IG", exposure_class: "BANK", sub_class: "其他金融机构投资级", match: matchAll([cond("investment_grade", "eq", true)]), rw: rwConst(0.75, "75%"), content: { basis: "其他金融机构投资级 75%" } }),
        leafRule({ id: "sub:ofi", label: "其他金融机构", priority: 10, rule_id: "CN_OFI", exposure_class: "BANK", sub_class: "其他金融机构", rw: rwConst(1.0, "100%"), content: { basis: "其他金融机构一般 100%" } })
      ]
    }),
    gateLayer({
      id: "cat:corp", label: "公司贷款", question: "是否公司贷款？",
      match: matchAll([cond("product_sub_type", "in", ["流动资金贷款", "项目贷款", "贸易融资", "银团贷款", "贷款承诺"])]),
      children: [
        leafRule({
          id: "sub:corp-t2", label: "第二档 · 不单独分投资级", priority: 100, rule_id: "CN_CORP_T2",
          exposure_class: "CORPORATE", sub_class: "第二档公司",
          match: matchAll([cond("bank_category", "eq", "第二档银行"), cond("investment_grade", "eq", true)]),
          rw: rwConst(1.0, "100%"),
          content: { basis: "第二档不单独划分投资级公司，按一般公司 100%" }
        }),
        leafRule({
          id: "sub:corp-ig", label: "投资级公司", priority: 95, rule_id: "CN_CORP_IG",
          exposure_class: "CORPORATE", sub_class: "投资级公司",
          match: matchAll([cond("investment_grade", "eq", true), cond("bank_category", "eq", "第一档银行")]),
          rw: rwConst(0.75, "75%"),
          content: { basis: "投资级公司 75%" }
        }),
        leafRule({
          id: "sub:corp-micro", label: "小微企业", priority: 92, rule_id: "CN_CORP_MICRO",
          exposure_class: "CORPORATE", sub_class: "小微企业",
          match: matchAll([cond("micro_enterprise", "eq", true)]),
          rw: rwConst(0.75, "75%"),
          content: { basis: "小微企业 75%" }
        }),
        leafRule({
          id: "sub:corp-sme", label: "中小企业", priority: 90, rule_id: "CN_CORP_SME",
          exposure_class: "CORPORATE", sub_class: "中小企业",
          match: matchAll([cond("sme", "eq", true)]),
          rw: rwConst(0.85, "85%"),
          content: { basis: "中小企业 85%" }
        }),
        leafRule({
          id: "sub:corp-gen", label: "一般公司", priority: 10, rule_id: "CN_CORP_001",
          exposure_class: "CORPORATE", sub_class: "一般公司",
          rw: rwConst(1.0, "100%"),
          content: { basis: "一般公司 100%" }
        })
      ]
    }),
    gateLayer({
      id: "cat:sl", label: "专业贷款", question: "是否专业贷款？",
      match: matchAll([cond("product_sub_type", "in", ["项目融资", "设备融资", "商品融资", "物品融资"])]),
      children: [
        leafRule({ id: "sub:sl-t2", label: "第二档银行", priority: 100, rule_id: "CN_SL_T2", exposure_class: "SPECIALIZED", sub_class: "第二档", match: matchAll([cond("bank_category", "eq", "第二档银行")]), rw: rwConst(1.0, "100%"), content: { basis: "第二档按一般公司 100%" } }),
        leafRule({ id: "sub:sl-pre", label: "项目融资(运营前)", priority: 85, rule_id: "CN_SL_PRE", exposure_class: "SPECIALIZED", sub_class: "运营前", match: matchAll([cond("project_phase", "eq", "运营前")]), rw: rwConst(1.3, "130%"), content: { basis: "运营前阶段项目融资 130%" } }),
        leafRule({ id: "sub:sl-ops", label: "运营期 / 物品 / 商品", priority: 80, rule_id: "CN_SL_OPS", exposure_class: "SPECIALIZED", sub_class: "运营期", rw: rwConst(1.0, "100%"), content: { basis: "运营阶段、物品融资、商品融资 100%" } })
      ]
    }),
    gateLayer({
      id: "cat:ret", label: "个人贷款", question: "是否个人贷款？",
      match: matchAll([cond("product_sub_type", "in", ["信用卡", "消费贷", "消费贷款", "经营贷", "按揭贷款"])]),
      children: [
        leafRule({ id: "sub:ret-mtg-t2", label: "第二档 · 个人住房抵押", priority: 100, rule_id: "CN_RET_T2_MTG", exposure_class: "RETAIL", sub_class: "第二档住房", match: matchAll([cond("bank_category", "eq", "第二档银行"), cond("product_sub_type", "in", ["按揭贷款", "个人住房抵押贷款"])]), rw: rwConst(0.5, "50%"), content: { basis: "第二档个人住房抵押贷款 50%" } }),
        leafRule({ id: "sub:ret-q", label: "合格交易者", priority: 95, rule_id: "CN_RET_002", exposure_class: "RETAIL", sub_class: "合格交易者", match: matchAll([cond("qualified_trader", "eq", true)]), rw: rwConst(0.45, "45%"), content: { basis: "合格交易者个人 45%" } }),
        leafRule({ id: "sub:ret-card", label: "监管零售 · 信用卡", priority: 80, rule_id: "CN_RET_CARD", exposure_class: "RETAIL", sub_class: "信用卡", match: matchAll([cond("product_sub_type", "in", ["信用卡", "贷记卡"])]), rw: rwConst(0.75, "75%"), content: { basis: "监管零售个人 75%" } }),
        leafRule({ id: "sub:ret-cons", label: "监管零售 · 消费/经营", priority: 80, rule_id: "CN_RET_CONS", exposure_class: "RETAIL", sub_class: "消费经营", match: matchAll([cond("product_sub_type", "in", ["消费贷", "消费贷款", "经营贷"])]), rw: rwConst(0.75, "75%"), content: { basis: "监管零售个人 75%" } }),
        leafRule({ id: "sub:ret-other", label: "其他个人", priority: 10, rule_id: "CN_RET_OTH", exposure_class: "RETAIL", sub_class: "其他个人", rw: rwConst(1.0, "100%"), content: { basis: "其他个人 100%" } })
      ]
    }),
    gateLayer({
      id: "cat:re-res", label: "居住用房地产", question: "是否居住用房地产？",
      match: matchAll([cond("product_sub_type", "in", ["个人住房抵押贷款", "按揭贷款", "住房按揭"])]),
      children: [
        leafRule({ id: "sub:res-t2", label: "第二档银行", priority: 100, rule_id: "CN_RE_RES_T2", exposure_class: "RE_RESIDENTIAL", sub_class: "第二档", match: matchAll([cond("bank_category", "eq", "第二档银行")]), rw: rwFollow("按交易对手"), content: { basis: "第二档按交易对手计量" } }),
        leafRule({ id: "sub:res-bad", label: "不符合审慎要求", priority: 95, rule_id: "CN_RE_RES_BAD", exposure_class: "RE_RESIDENTIAL", sub_class: "不符审慎", match: matchAll([cond("prudent", "eq", false)]), rw: rwConst(1.5, "150%"), content: { basis: "不符合审慎要求 150%" } }),
        leafRule({ id: "sub:res-ind20", label: "不依赖现金流 · LTV≤50%", priority: 90, rule_id: "CN_RE_001", exposure_class: "RE_RESIDENTIAL", sub_class: "不依赖 LTV≤50%", match: matchAll([cond("cashflow_dependent", "eq", false), cond("ltv", "lte", 0.5)]), rw: rwConst(0.2, "20%"), content: { basis: "不依赖现金流且 LTV≤50% 为 20%" } }),
        leafRule({ id: "sub:res-ind100", label: "不依赖现金流 · LTV>100%", priority: 90, rule_id: "CN_RE_IND100", exposure_class: "RE_RESIDENTIAL", sub_class: "不依赖 LTV>100%", match: matchAll([cond("cashflow_dependent", "eq", false), cond("ltv", "gt", 1)]), rw: rwFollow("按交易对手"), content: { basis: "不依赖现金流且 LTV>100% 按交易对手" } }),
        leafRule({ id: "sub:res-dep30", label: "依赖现金流 · LTV≤50%", priority: 90, rule_id: "CN_RE_002", exposure_class: "RE_RESIDENTIAL", sub_class: "依赖 LTV≤50%", match: matchAll([cond("cashflow_dependent", "eq", true), cond("ltv", "lte", 0.5)]), rw: rwConst(0.3, "30%"), content: { basis: "依赖现金流且 LTV≤50% 为 30%" } }),
        leafRule({ id: "sub:res-dep105", label: "依赖现金流 · LTV>100%", priority: 90, rule_id: "CN_RE_DEP105", exposure_class: "RE_RESIDENTIAL", sub_class: "依赖 LTV>100%", match: matchAll([cond("cashflow_dependent", "eq", true), cond("ltv", "gt", 1)]), rw: rwConst(1.05, "105%"), content: { basis: "依赖现金流且 LTV>100% 为 105%" } }),
        leafRule({ id: "sub:res-ind-mid", label: "不依赖现金流 · 50%<LTV≤100%", priority: 88, rule_id: "CN_RE_IND_MID", exposure_class: "RE_RESIDENTIAL", sub_class: "不依赖中间档", match: matchAll([cond("cashflow_dependent", "eq", false), cond("ltv", "gt", 0.5), cond("ltv", "lte", 1)]), rw: { type: "unspecified", display: "权重表未列明" }, content: { basis: "权重表只写了 LTV≤50% 为 20%、LTV>100% 按交易对手，中间档未列明" } }),
        leafRule({ id: "sub:res-dep-mid", label: "依赖现金流 · 50%<LTV≤100%", priority: 88, rule_id: "CN_RE_DEP_MID", exposure_class: "RE_RESIDENTIAL", sub_class: "依赖中间档", match: matchAll([cond("cashflow_dependent", "eq", true), cond("ltv", "gt", 0.5), cond("ltv", "lte", 1)]), rw: { type: "unspecified", display: "权重表未列明" }, content: { basis: "权重表只写了 LTV≤50% 为 30%、LTV>100% 为 105%，中间档未列明" } })
      ]
    }),
    gateLayer({
      id: "cat:re-cre", label: "商用房地产", question: "是否商用房地产？",
      match: matchAll([cond("product_sub_type", "in", ["经营性物业贷款", "商铺抵押", "写字楼抵押", "商用房贷"])]),
      children: [
        leafRule({ id: "sub:cre-t2", label: "第二档银行", priority: 100, rule_id: "CN_CRE_T2", exposure_class: "RE_COMMERCIAL", sub_class: "第二档", match: matchAll([cond("bank_category", "eq", "第二档银行")]), rw: rwFollow("按交易对手"), content: { basis: "第二档按交易对手计量" } }),
        leafRule({ id: "sub:cre-bad", label: "不符合审慎要求", priority: 95, rule_id: "CN_CRE_BAD", exposure_class: "RE_COMMERCIAL", sub_class: "不符审慎", match: matchAll([cond("prudent", "eq", false)]), rw: rwConst(1.5, "150%"), content: { basis: "不符合审慎要求 150%" } }),
        leafRule({ id: "sub:cre-ind", label: "不依赖现金流 · LTV≤60%", priority: 90, rule_id: "CN_CRE_001", exposure_class: "RE_COMMERCIAL", sub_class: "不依赖 LTV≤60%", match: matchAll([cond("cashflow_dependent", "eq", false), cond("ltv", "lte", 0.6)]), rw: rwConst(0.65, "65%"), content: { basis: "不依赖现金流且 LTV≤60% 为 65%" } }),
        leafRule({ id: "sub:cre-ind-else", label: "不依赖现金流 · 其余", priority: 80, rule_id: "CN_CRE_IND_ELSE", exposure_class: "RE_COMMERCIAL", sub_class: "不依赖其余", match: matchAll([cond("cashflow_dependent", "eq", false)]), rw: rwFollow("按交易对手"), content: { basis: "不依赖现金流且未达 LTV 条件时按交易对手" } }),
        leafRule({ id: "sub:cre-dep60", label: "依赖现金流 · LTV≤60%", priority: 90, rule_id: "CN_CRE_DEP60", exposure_class: "RE_COMMERCIAL", sub_class: "依赖 LTV≤60%", match: matchAll([cond("cashflow_dependent", "eq", true), cond("ltv", "lte", 0.6)]), rw: rwConst(0.75, "75%"), content: { basis: "依赖现金流且 LTV≤60% 为 75%" } }),
        leafRule({ id: "sub:cre-dep80", label: "依赖现金流 · LTV 60%–80%", priority: 90, rule_id: "CN_CRE_DEP80", exposure_class: "RE_COMMERCIAL", sub_class: "依赖 LTV60-80", match: matchAll([cond("cashflow_dependent", "eq", true), cond("ltv", "gt", 0.6), cond("ltv", "lte", 0.8)]), rw: rwFollow("90% 与交易对手较大值"), content: { basis: "60%–80% 取 90% 与交易对手权重较大值" } }),
        leafRule({ id: "sub:cre-dep110", label: "依赖现金流 · LTV>80%", priority: 90, rule_id: "CN_CRE_DEP110", exposure_class: "RE_COMMERCIAL", sub_class: "依赖 LTV>80%", match: matchAll([cond("cashflow_dependent", "eq", true), cond("ltv", "gt", 0.8)]), rw: rwConst(1.1, "110%"), content: { basis: "依赖现金流且 LTV>80% 为 110%" } })
      ]
    }),
    gateLayer({
      id: "cat:re-dev", label: "房地产开发", question: "是否房地产开发？",
      match: matchAll([cond("product_sub_type", "in", ["房地产开发贷款", "土地开发融资", "房地产开发"])]),
      children: [
        leafRule({ id: "sub:dev-ok", label: "符合审慎要求", priority: 90, rule_id: "CN_DEV_001", exposure_class: "RE_DEV", sub_class: "符合审慎", match: matchAll([cond("prudent", "eq", true)]), rw: rwConst(1.0, "100%"), content: { basis: "符合审慎要求 100%" } }),
        leafRule({ id: "sub:dev-bad", label: "其他", priority: 70, rule_id: "CN_DEV_002", exposure_class: "RE_DEV", sub_class: "其他", rw: rwConst(1.5, "150%"), content: { basis: "其他 150%" } })
      ]
    }),
    gateLayer({
      id: "cat:eq", label: "股权及次级债权", question: "是否股权或次级债权？",
      match: matchAll([cond("product_sub_type", "in", ["股权", "未上市股权", "次级债", "TLAC"])]),
      children: [
        leafRule({ id: "sub:eq-pol", label: "开发性机构/政策性银行次级债", priority: 100, rule_id: "CN_EQ_POL", exposure_class: "EQUITY", sub_class: "政策性次级债", match: matchAll([cond("issuer_type", "in", ["开发性金融机构", "政策性银行"]), cond("product_sub_type", "eq", "次级债")]), rw: rwConst(1.0, "100%"), content: { basis: "对我国开发性金融机构和政策性银行次级债权未扣除部分 100%" } }),
        leafRule({ id: "sub:eq-fi", label: "金融机构股权", priority: 80, rule_id: "CN_EQ_001", exposure_class: "EQUITY", sub_class: "金融机构股权", match: matchAll([cond("issuer_type", "in", ["银行", "金融机构"])]), rw: rwConst(2.5, "250%"), content: { basis: "金融机构股权投资未扣除部分 250%" } }),
        leafRule({ id: "sub:eq-sub", label: "次级债权及 TLAC", priority: 80, rule_id: "CN_EQ_SUB", exposure_class: "EQUITY", sub_class: "次级债权", match: matchAll([cond("product_sub_type", "in", ["次级债", "TLAC"])]), rw: rwConst(1.5, "150%"), content: { basis: "次级债权及 TLAC 工具一般 150%" } }),
        leafRule({ id: "sub:eq-corp", label: "工商企业股权", priority: 70, rule_id: "CN_EQ_002", exposure_class: "EQUITY", sub_class: "工商企业股权", rw: rwConst(12.5, "1250%"), content: { basis: "其他工商企业股权投资一般 1250%" } })
      ]
    }),
    gateLayer({
      id: "cat:def", label: "已违约风险暴露", question: "是否已违约？",
      match: matchAll([cond("default_status", "in", ["已违约", "Default", "违约"])]),
      children: [
        leafRule({
          id: "sub:def-res", label: "居住用房抵押且不依赖房地产现金流", priority: 100, rule_id: "CN_DEF_RES",
          exposure_class: "DEFAULT", sub_class: "居住用房抵押",
          match: matchAll([cond("collateral_type", "in", ["居住用房", "住房"]), cond("cashflow_dependent", "eq", false)]),
          rw: rwConst(1.0, "100%"),
          content: { basis: "已违约 · 以居住用房为抵押且不依赖房地产现金流，100%" }
        }),
        leafRule({
          id: "sub:def-t2", label: "第二档银行", priority: 98, rule_id: "CN_DEF_T2",
          exposure_class: "DEFAULT", sub_class: "第二档",
          match: matchAll([cond("bank_category", "eq", "第二档银行")]),
          rw: rwFollow("按交易对手"),
          content: { basis: "已违约 · 第二档按交易对手" }
        }),
        leafRule({
          id: "sub:def-hi", label: "损失准备低于账面价值 20%", priority: 95, rule_id: "CN_DEF_001",
          exposure_class: "DEFAULT", sub_class: "准备不足20%",
          match: matchAll([cond("provision_ratio", "lt", 0.2)]),
          rw: rwConst(1.5, "150%"),
          content: { basis: "其他已违约 · 损失准备低于账面价值 20%，150%" }
        }),
        leafRule({
          id: "sub:def-lo", label: "损失准备不低于账面价值 20%", priority: 90, rule_id: "CN_DEF_002",
          exposure_class: "DEFAULT", sub_class: "准备充足",
          match: matchAll([cond("provision_ratio", "gte", 0.2)]),
          rw: rwConst(1.0, "100%"),
          content: { basis: "其他已违约 · 损失准备不低于账面价值 20%，100%" }
        })
      ]
    })
  ],
  customized: false
};

function cloneExpFlow(src) {
  const raw = JSON.parse(JSON.stringify(src || BASE_EXP_TEMPLATE));
  raw.customized = false;
  raw.ref = false;
  if (raw.meta) raw.meta = Object.assign({}, raw.meta, { cloned_from: (src && src.id) || BASE_EXP_TEMPLATE.id });
  return raw;
}

/** 产品默认只引用基础流程；首次修改再物化为独立副本 */
function makeExpFlowRef() {
  return {
    ref: true,
    based_on: BASE_EXP_TEMPLATE.id,
    customized: false,
    name: "引用 · " + (BASE_EXP_TEMPLATE.name || "通用流程模板")
  };
}

function isExpFlowRef(flow) {
  return !flow || flow.ref === true || !Array.isArray(flow.categories);
}

function materializeProductExpFlow(productKey) {
  const prod = PRODUCTS[productKey];
  if (!prod) return null;
  if (!isExpFlowRef(prod.expFlow)) return prod.expFlow;
  const copy = cloneExpFlow(BASE_EXP_TEMPLATE);
  copy.id = "exp_flow_" + productKey;
  copy.name = prod.label + " · 分类流程";
  copy.based_on = BASE_EXP_TEMPLATE.id;
  copy.ref = false;
  copy.customized = false;
  prod.expFlow = copy;
  return copy;
}

function productFieldIdSet(productKey) {
  const prod = PRODUCTS[productKey];
  const set = {};
  ((prod && prod.fields) || []).forEach((f) => {
    if (f && f.id) set[f.id] = true;
  });
  return set;
}

/** 节点判定/公式用到的字段，相对产品字段的缺口 */
function missingFieldsForExpNode(nodeId, productKey) {
  const key = productKey || state.product || overviewActiveProductKey();
  if (!key || !PRODUCTS[key]) return [];
  const have = productFieldIdSet(key);
  const flow = flowForProductKey(key);
  let raw = null;
  (flow.categories || []).forEach((cat) => {
    if (cat.id === nodeId) raw = cat;
    (cat.children || []).forEach((ch) => {
      if (ch.id === nodeId) raw = ch;
    });
  });
  if (!raw) return [];
  if (Array.isArray(raw.field_gaps) && raw.field_gaps.length) {
    return raw.field_gaps.filter((f) => !have[f]);
  }
  const used = {};
  collectLogicFields(raw.match, used);
  collectLogicFields(raw.formula, used);
  return Object.keys(used).filter((f) => f && !have[f] && f !== "ead" && f !== "risk_weight" && f !== "rwa");
}

function annotateFlowFieldGaps(flow, fieldIds) {
  const have = {};
  (fieldIds || []).forEach((id) => { if (id) have[id] = true; });
  const gaps = [];
  (flow.categories || []).forEach((cat) => {
    const used = {};
    collectLogicFields(cat.match, used);
    const missing = Object.keys(used).filter((f) => !have[f]);
    if (missing.length) {
      cat.field_gaps = missing;
      cat.field_gap_note = "产品字段未覆盖本层判定条件";
      gaps.push({ node_id: cat.id, missing_fields: missing, note: cat.field_gap_note });
    } else {
      delete cat.field_gaps;
      delete cat.field_gap_note;
    }
    (cat.children || []).forEach((ch) => {
      const cu = {};
      collectLogicFields(ch.match, cu);
      collectLogicFields(ch.formula, cu);
      const cm = Object.keys(cu).filter((f) => !have[f] && f !== "ead" && f !== "risk_weight" && f !== "rwa");
      if (cm.length) {
        ch.field_gaps = cm;
        ch.field_gap_note = "产品字段未覆盖本细分条件";
        gaps.push({ node_id: ch.id, missing_fields: cm, note: ch.field_gap_note });
      } else {
        delete ch.field_gaps;
        delete ch.field_gap_note;
      }
    });
  });
  flow.field_gaps = gaps;
  return gaps;
}

function compactBaseFlowForApi(flow) {
  return {
    id: flow.id,
    name: flow.name,
    categories: (flow.categories || []).map((cat) => {
      const used = {};
      collectLogicFields(cat.match, used);
      return {
        id: cat.id,
        label: cat.label,
        question: cat.question,
        fields: Object.keys(used),
        children: (cat.children || []).map((ch) => {
          const cu = {};
          collectLogicFields(ch.match, cu);
          collectLogicFields(ch.formula, cu);
          return {
            id: ch.id,
            label: ch.label,
            fields: Object.keys(cu),
            rule_id: ruleIdOf(ch)
          };
        })
      };
    })
  };
}

/** 通用模板 + 产品字段 → 调模型生成；失败则本地标缺口 */
function generateProductFlowFromTemplate(productKey) {
  const prod = PRODUCTS[productKey];
  if (!prod) return Promise.resolve({ ok: false, text: "产品不存在" });
  const fields = (prod.fields || []).map((f) => ({
    id: f.id,
    zh: FIELD_LABEL[f.id] || f.zh || f.id,
    type: f.type,
    required: !!f.required
  }));
  const base = cloneExpFlow(BASE_EXP_TEMPLATE);
  const applyLocal = function (summary, source) {
    const flow = cloneExpFlow(BASE_EXP_TEMPLATE);
    flow.id = "exp_flow_" + productKey;
    flow.name = prod.label + " · 分类流程";
    flow.based_on = BASE_EXP_TEMPLATE.id;
    flow.ref = false;
    flow.customized = true;
    flow.generated_by = source || "local";
    const gaps = annotateFlowFieldGaps(flow, fields.map((f) => f.id));
    prod.expFlow = flow;
    prod.flowGenMeta = {
      source: source || "local",
      summary: summary || ("已基于通用模板生成「" + prod.label + "」流程"),
      gap_count: gaps.length
    };
    return { ok: true, gaps: gaps, summary: prod.flowGenMeta.summary, source: prod.flowGenMeta.source };
  };
  return fetch("/api/exp/generate-flow", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      product_label: prod.label,
      product_fields: fields,
      base_flow: base
    })
  }).then((res) => res.json().then((data) => ({ res: res, data: data })))
    .then((pack) => {
      if (!pack.res.ok || !pack.data || !pack.data.flow) {
        return applyLocal(
          (pack.data && pack.data.error)
            ? ("模型暂不可用，已本地对照字段：" + pack.data.error)
            : "模型暂不可用，已按通用模板本地对照产品字段并标出缺口。",
          "local"
        );
      }
      const flow = pack.data.flow;
      flow.id = flow.id || ("exp_flow_" + productKey);
      flow.name = flow.name || (prod.label + " · 分类流程");
      flow.based_on = BASE_EXP_TEMPLATE.id;
      flow.ref = false;
      flow.customized = true;
      flow.generated_by = pack.data.source || "llm";
      const gaps = Array.isArray(pack.data.gaps)
        ? pack.data.gaps
        : annotateFlowFieldGaps(flow, fields.map((f) => f.id));
      if (!flow.field_gaps) annotateFlowFieldGaps(flow, fields.map((f) => f.id));
      prod.expFlow = flow;
      prod.flowGenMeta = {
        source: pack.data.source || "llm",
        summary: pack.data.summary || "",
        gap_count: (flow.field_gaps || gaps || []).length,
        fallback_error: pack.data.fallback_error || ""
      };
      return {
        ok: true,
        gaps: flow.field_gaps || gaps,
        summary: prod.flowGenMeta.summary,
        source: prod.flowGenMeta.source
      };
    })
    .catch(() => applyLocal("无法连接生成服务，已本地对照通用模板与产品字段并标出缺口。", "local"));
}

function rwDisplayOf(node) {
  if (!node) return "—";
  if (node.rw) return node.rw;
  const rw = node.then && node.then.risk_weight;
  if (!rw) return "—";
  if (typeof rw === "string") return rw;
  return rw.display || (rw.value != null ? ((rw.value * 100) + "%") : "—");
}

function ruleIdOf(node) {
  if (!node) return "";
  return node.rule_id || node.rule || node.id || "";
}

function normalizeExpNode(ch, parent) {
  const kids = (ch.children || []).map(function (kid) { return normalizeExpNode(kid, ch); });
  const nested = kids.length > 0;
  const role = ch.role || (parent && parent.role) || "";
  return {
    id: ch.id,
    kind: "subclass",
    type: ch.type || (nested ? "gate" : "leaf"),
    label: ch.label,
    priority: ch.priority,
    rule: ruleIdOf(ch),
    rule_id: ruleIdOf(ch),
    role: role,
    summary: ch.summary || "",
    rw: nested
      ? (ch.summary || (ch.otherwise ? "兜底" : (role === "crm" ? "缓释" : role === "assessment" ? "取值" : "细分")))
      : rwDisplayOf(ch),
    match: ch.match,
    then: ch.then,
    formula: ch.formula,
    content: ch.content,
    question: ch.question,
    otherwise: !!ch.otherwise,
    skip: ch.skip || null,
    children: kids,
    parent: parent ? parent.id : null,
    parentLabel: parent ? parent.label : ""
  };
}

function normalizeExpCategory(cat) {
  if (!cat) return cat;
  return {
    id: cat.id,
    kind: "category",
    type: cat.type || "gate",
    label: cat.label,
    question: cat.question,
    role: cat.role || "",
    summary: cat.summary || "",
    match: cat.match,
    on_match: cat.on_match,
    on_miss: cat.on_miss,
    otherwise: !!cat.otherwise,
    skip: cat.skip || null,
    content: cat.content,
    formula: cat.formula,
    children: (cat.children || []).map(function (ch) { return normalizeExpNode(ch, cat); })
  };
}

function productSkipIds(productKey) {
  const prod = productKey && PRODUCTS[productKey];
  return (prod && prod.skipRules) || [];
}

function omitSkipped(nodes, skipSet) {
  const out = [];
  (nodes || []).forEach(function (node) {
    if (!node || skipSet[node.id]) return;
    const copy = Object.assign({}, node);
    if (Array.isArray(copy.children)) {
      const before = copy.children.length;
      copy.children = omitSkipped(copy.children, skipSet);
      if (copy.children.length < before) {
        copy.question = (copy.question || copy.label || "") + "（已跳过不适用分支，不落入本层兜底）";
      }
    }
    out.push(copy);
  });
  return out;
}

function ensureProductExpFlow(productKey) {
  const prod = PRODUCTS[productKey];
  if (!prod) return null;
  if (!prod.expFlow) prod.expFlow = makeExpFlowRef();
  return prod.expFlow;
}

function activeExpFlow() {
  if (state.expScope === "overview" || state.expScope === "base" || !state.product || !PRODUCTS[state.product]) {
    return BASE_EXP_TEMPLATE;
  }
  const flow = ensureProductExpFlow(state.product);
  if (isExpFlowRef(flow)) return BASE_EXP_TEMPLATE;
  return flow;
}

/** 总览：开始判定 → 识别产品 → 按产品分线（每条线各自维护） */
function buildOverviewMasterJson() {
  const keys = productKeys();
  return {
    id: "exp_master_overview",
    name: "分类判断 · 总览",
    kind: "router",
    version: "1.0",
    head: [
      { id: "proc:start", type: "process", label: "开始判定", content: { note: "标准字段已就绪" } },
      { id: "proc:product", type: "process", label: "识别产品", content: { note: "按产品类型进入不同线路" } }
    ],
    routes: keys.map((k) => {
      const st = productExpStatus(k);
      return {
        id: "route:" + k,
        type: "route",
        product_id: k,
        label: PRODUCTS[k].label,
        level: 1,
        classes: productClassLabels(k),
        match: { all: [{ field: "product_type", op: "eq", value: PRODUCTS[k].label }] },
        note: "与其它产品同级 · 命中即进入本线路",
        flow: st.ref
          ? { mode: "ref", based_on: BASE_EXP_TEMPLATE.id }
          : { mode: "override", flow_id: (PRODUCTS[k].expFlow && PRODUCTS[k].expFlow.id) || ("exp_flow_" + k), customized: !!st.customized },
        field_count: PRODUCTS[k].fields.length
      };
    }),
    note: "识别产品后进入同级产品线路之一；无通用模板兜底。"
  };
}

function flowForProductKey(productKey) {
  if (!productKey || !PRODUCTS[productKey]) return BASE_EXP_TEMPLATE;
  const flow = ensureProductExpFlow(productKey);
  return isExpFlowRef(flow) ? BASE_EXP_TEMPLATE : flow;
}

function productClassIds(productKey) {
  const prod = productKey && PRODUCTS[productKey];
  const ids = prod && prod.classes;
  return Array.isArray(ids) && ids.length ? ids : null;
}

function productClassLabels(productKey) {
  const ids = productClassIds(productKey) || [];
  const order = {};
  (BASE_EXP_TEMPLATE.categories || []).forEach(function (cat, i) { order[cat.id] = i; });
  return ids.slice().sort(function (a, b) {
    return (order[a] == null ? 99 : order[a]) - (order[b] == null ? 99 : order[b]);
  }).map(function (id) {
    const cat = (BASE_EXP_TEMPLATE.categories || []).find(function (c) { return c.id === id; });
    return cat ? cat.label : "";
  }).filter(Boolean);
}

function productClassText(productKey) {
  const labels = productClassLabels(productKey);
  return labels.length ? labels.join("、") : "";
}

function categoriesFromFlow(flow, productKey) {
  let raw = (flow && flow.categories) || [];
  const skipIds = productSkipIds(productKey);
  if (skipIds.length) {
    const skipSet = {};
    skipIds.forEach(function (id) { skipSet[id] = true; });
    raw = omitSkipped(raw, skipSet);
  }
  const cats = raw.map(normalizeExpCategory);
  const ids = productClassIds(productKey);
  if (!ids) return cats;
  const allow = {};
  ids.forEach(function (id) { allow[id] = true; });
  const filtered = cats.filter(function (c) {
    return allow[c.id] || c.role === "crm" || c.role === "assessment";
  });
  return filtered.length ? filtered : cats;
}

/** 默认聚焦流程第一层判定（及首个细分），用于点产品 / 进模板 */
function focusFirstExpLayer(productKey) {
  const flow = productKey
    ? flowForProductKey(productKey)
    : (state.expScope === "base" ? BASE_EXP_TEMPLATE : activeExpFlow());
  const cats = categoriesFromFlow(flow, productKey);
  const focusCat = cats[0] || null;
  state.expExpanded = {};
  if (!focusCat) return null;
  state.expExpanded[focusCat.id] = true;
  const firstSub = (focusCat.children && focusCat.children[0]) || null;
  state.selectedExposure = firstSub ? firstSub.id : focusCat.id;
  state.confirmedLeaf = firstSub ? firstSub.id : "";
  return focusCat;
}

/** 总览下当前展开的产品线路（点选产品或其瀑布节点后） */
function overviewActiveProductKey() {
  if (state.expScope !== "overview") return null;
  const sel = state.selectedExposure || "";
  if (sel.indexOf("route:") === 0 && sel !== "route:empty" && sel !== "route:base") {
    const k = sel.slice(6);
    return PRODUCTS[k] ? k : null;
  }
  if (PRODUCTS[state.product] && (
    sel.indexOf("cat:") === 0 || sel.indexOf("sub:") === 0
    || sel === "res:rw" || sel === "line:on" || sel === "line:off"
    || sel === "step:route" || sel === "step:crm" || sel === "step:rwa" || sel === "step:out"
    || sel === "rule:hit" || sel === "step:ccf"
  )) {
    return state.product;
  }
  return null;
}

function findChildPath(nodes, id, path) {
  const acc = path || [];
  for (let i = 0; i < (nodes || []).length; i++) {
    const node = nodes[i];
    if (node.id === id) return acc.concat([node]);
    const sub = findChildPath(node.children, id, acc.concat([node]));
    if (sub) return sub;
  }
  return null;
}

function subclassColumns(focusCat, selectedId) {
  const top = (focusCat && focusCat.children) || [];
  if (!top.length) return [];
  const enter = focusCat.role === "crm" ? "是 · 缓释" : (focusCat.role === "assessment" ? "是 · 取值" : "是 · 细分");
  const columns = [{ parentId: focusCat.id, nodes: top, enter: enter }];
  const path = findChildPath(top, selectedId, []) || [];
  path.forEach(function (node) {
    if (node.children && node.children.length) {
      columns.push({
        parentId: node.id,
        nodes: node.children,
        enter: node.otherwise ? "都不成立" : "继续"
      });
    }
  });
  return columns;
}

function resolveFocusForCategories(cats) {
  const selected = state.selectedExposure;
  let focusIdx = -1;
  let hitSubclassId = null;
  (cats || []).forEach((cat, idx) => {
    if (cat.id === selected) focusIdx = idx;
    const path = findChildPath(cat.children, selected, []);
    if (path) {
      focusIdx = idx;
      hitSubclassId = selected;
    }
  });
  if (focusIdx < 0) {
    const openedIdx = (cats || []).findIndex((c) => state.expExpanded[c.id]);
    focusIdx = openedIdx >= 0 ? openedIdx : 0;
  }
  const focusCat = (cats || [])[focusIdx] || null;
  if (!hitSubclassId && focusCat && focusCat.children[0]) hitSubclassId = focusCat.children[0].id;
  return { focusIdx: focusIdx, focusCat: focusCat, hitSubclassId: hitSubclassId };
}

function chainOf(flow, key) {
  const own = flow && flow[key];
  if (Array.isArray(own) && own.length) return own;
  return BASE_EXP_TEMPLATE[key] || [];
}

/**
 * 按层级分列：判定列（否→往下）→ 细分 → 定权 → 路由校验 → 缓释 → 计算时分表内/表外。
 */
function appendWaterfallByLevel(nodes, edges, opts) {
  const cats = opts.cats || [];
  if (!cats.length) return;
  const focusIdx = opts.focusIdx == null ? 0 : opts.focusIdx;
  const hitSubclassId = opts.hitSubclassId;
  const NODE_W = opts.nodeW || 210;
  const CAT_H = 78;
  const STEP_H = 118;
  const SUB_W = 220;
  const SUB_H = 96;
  const SUB_GAP = 168;
  const RES_W = 168;
  const BRANCH_GAP = 56;
  const flowSrc = opts.productKey
    ? flowForProductKey(opts.productKey)
    : (opts.flow || activeExpFlow());
  const books = chainOf(flowSrc, "books");
  const colX = opts.startX;
  const overviewBranch = !!opts.overviewBranch;
  const productKey = opts.productKey;
  // 大类纵向位置固定。换选中项时不再把整列上拉，避免点击后节点乱跳。
  const anchorY = opts.anchorY == null ? 36 : opts.anchorY;
  const y0 = Math.max(24, anchorY);
  let prevId = opts.prevId;

  cats.forEach((cat, idx) => {
    const side = cat.role === "crm" || cat.role === "assessment";
    const status = idx === focusIdx ? "gate-hit" : (side ? "gate-side" : (idx < focusIdx ? "gate-pass" : "gate-pending"));
    const note = side
      ? (cat.summary || (cat.role === "crm" ? "缓释拆分" : "按评级个数取值"))
      : (idx < focusIdx
        ? "否 → 继续往下"
        : idx === focusIdx
          ? ((cat.question || "命中本层") + " · 是 → 右列细分")
          : "尚未走到");
    const cy = y0 + idx * STEP_H;
    nodes.push({
      id: cat.id, kind: "category", label: (idx + 1) + ". " + cat.label,
      badge: cat.role === "crm" ? "缓释" : (cat.role === "assessment" ? "取值" : undefined),
      role: cat.role || undefined,
      note: note, gateStatus: status,
      x: colX, y: cy, w: NODE_W, h: CAT_H,
      canOpen: true, open: idx === focusIdx,
      overviewBranch: overviewBranch || undefined,
      productKey: productKey
    });
    if (prevId) {
      edges.push({
        from: prevId, to: cat.id,
        label: idx === 0 ? (opts.enterLabel || "进入流程") : (side ? "另计" : "否，继续"),
        flow: !side && idx <= focusIdx,
        noPath: !side && idx > 0 && idx <= focusIdx,
        overviewBranch: overviewBranch || undefined
      });
    }
    prevId = cat.id;
  });

  const focusCat = cats[focusIdx];
  if (!focusCat) return;
  const focusNode = nodes.find((n) => n.id === focusCat.id);
  const focusY = focusNode ? focusNode.y : anchorY;
  const columns = subclassColumns(focusCat, hitSubclassId);
  const selectedPath = findChildPath(focusCat.children || [], hitSubclassId, []) || [];
  const pathIds = {};
  selectedPath.forEach(function (node) { pathIds[node.id] = true; });
  let subX = colX + NODE_W + BRANCH_GAP;
  columns.forEach(function (col) {
    const kids = col.nodes || [];
    const blockH = Math.max(kids.length - 1, 0) * SUB_GAP + SUB_H;
    const safeTop = Math.max(24, Math.round(focusY + CAT_H / 2 - blockH / 2));
    kids.forEach(function (ch, cidx) {
      const nested = (ch.children || []).length;
      const sy = safeTop + cidx * SUB_GAP;
      const role = ch.role || "";
      const step = role === "crm" || role === "assessment";
      const text = ch.rw || "—";
      const prefix = ch.otherwise ? "本层都不成立 · " : "";
      const rwNote = nested
        ? (prefix + (step ? text : "继续细分"))
        : (step ? prefix : (prefix + "RW " + text));
      nodes.push({
        id: ch.id, kind: "subclass", label: ch.label,
        badge: role === "crm" ? "缓释" : (role === "assessment" ? "取值" : undefined),
        role: role || undefined,
        note: rwNote,
        pill: (!nested && step) ? text : "",
        x: subX, y: sy, w: SUB_W, h: SUB_H, parent: col.parentId,
        overviewBranch: overviewBranch || undefined,
        productKey: productKey
      });
      edges.push({
        from: col.parentId, to: ch.id,
        label: cidx === 0 ? col.enter : "",
        flow: !!pathIds[ch.id],
        yesPath: true,
        fanOut: true,
        overviewBranch: overviewBranch || undefined
      });
    });
    subX += SUB_W + BRANCH_GAP;
  });

  const ruleY = focusY;
  const hitLeaf = selectedPath.length ? selectedPath[selectedPath.length - 1] : null;
  const leafId = hitLeaf && !(hitLeaf.children || []).length ? hitLeaf.id : "";
  const rwObj = hitLeaf && hitLeaf.then && hitLeaf.then.risk_weight;
  const weightKind = rwObj && rwObj.type;
  const loopsToCounterparty = weightKind === "counterparty" || weightKind === "max";
  const stepKind = weightKind === "haircut" || weightKind === "split" || weightKind === "assessment";
  const resultLabel = weightKind === "assessment" ? "评级取值" : (stepKind ? "缓释计算" : "风险权重");
  const resultNote = stepKind
    ? (rwObj.display || resultLabel)
    : (weightKind === "max_field"
      ? (rwObj.display || "与已得权重较大值")
      : (loopsToCounterparty ? "按交易对手普通债权" : "暴露类别与原 RW"));
  // 命中叶子后：风险权重 → 路由校验 → 缓释拆分 → 计算时分表内/表外 → 回执
  const rwX = subX;
  nodes.push({
    id: "res:rw", kind: "result", label: resultLabel,
    badge: weightKind === "assessment" ? "取值" : (stepKind ? "缓释" : undefined),
    role: weightKind === "assessment" ? "assessment" : (stepKind ? "crm" : undefined),
    note: resultNote,
    x: rwX, y: ruleY, w: RES_W, h: 76,
    overviewBranch: overviewBranch || undefined,
    productKey: productKey
  });
  if (leafId) {
    edges.push({
      from: leafId, to: "res:rw", label: stepKind ? "按此计算" : "定权",
      flow: true, yesPath: true,
      overviewBranch: overviewBranch || undefined
    });
  }
  if (loopsToCounterparty && cats[0]) {
    edges.push({
      from: "res:rw", to: cats[0].id,
      label: "按交易对手重分一次",
      flow: true, loop: true,
      overviewBranch: overviewBranch || undefined
    });
  }

  const tail = chainOf(flowSrc, "tail").filter(function (step) { return step.id !== "step:rwa"; });
  let tailPrev = "res:rw";
  let tailX = rwX + RES_W + BRANCH_GAP;
  const TAIL_W = 168;
  const BOOK_W = 188;
  const BOOK_H = 76;
  const BOOK_GAP = 22;
  tail.forEach((step, sidx) => {
    if (step.id === "step:out" && books.length) {
      const pairH = books.length * BOOK_H + (books.length - 1) * BOOK_GAP;
      let bookTop = ruleY + 38 - pairH / 2;
      if (bookTop < 24) bookTop = 24;
      const viewing = !productKey || productKey === (overviewActiveProductKey() || state.product);
      const routeGate = viewing ? buildRouteDecision(productKey) : null;
      books.forEach((b, i) => {
        nodes.push({
          id: b.id, kind: b.kind || "process", label: b.label,
          note: (routeGate && routeGate.next_action !== "calculate" ? "未放行 · " : "") + (b.note || ""),
          x: tailX, y: bookTop + i * (BOOK_H + BOOK_GAP), w: BOOK_W, h: BOOK_H,
          overviewBranch: overviewBranch || undefined, productKey: productKey,
          formula_ref: b.formula_ref, content: b.content, when: b.when
        });
        edges.push({
          from: tailPrev, to: b.id,
          label: i === 0 ? "分线计算" : "",
          flow: true, yesPath: true, fanOut: true,
          overviewBranch: overviewBranch || undefined
        });
      });
      tailX += BOOK_W + BRANCH_GAP;
      nodes.push({
        id: step.id, kind: step.kind || "result", label: step.label,
        note: step.note || "",
        x: tailX, y: ruleY, w: TAIL_W, h: 76,
        overviewBranch: overviewBranch || undefined,
        productKey: productKey,
        formula_ref: step.formula_ref,
        content: step.content
      });
      books.forEach((b, i) => {
        edges.push({
          from: b.id, to: step.id,
          label: i === 0 ? "汇总" : "",
          flow: true, yesPath: true,
          overviewBranch: overviewBranch || undefined
        });
      });
      tailPrev = step.id;
      tailX += TAIL_W + BRANCH_GAP;
      return;
    }
    const kind = step.kind || "process";
    nodes.push({
      id: step.id, kind: kind, label: step.label,
      note: step.note || "",
      x: tailX, y: ruleY, w: TAIL_W, h: 76,
      overviewBranch: overviewBranch || undefined,
      productKey: productKey,
      formula_ref: step.formula_ref,
      content: step.content
    });
    edges.push({
      from: tailPrev, to: step.id,
      label: step.id === "step:route" ? "校验" : (step.id === "step:crm" ? "再拆分" : ""),
      flow: true, yesPath: true,
      overviewBranch: overviewBranch || undefined
    });
    tailPrev = step.id;
    tailX += TAIL_W + BRANCH_GAP;
  });
}

function appendProductWaterfallBranch(nodes, edges, routeNode, productKey) {
  const flow = flowForProductKey(productKey);
  const cats = categoriesFromFlow(flow, productKey);
  if (!cats.length || !routeNode) return;
  const focus = resolveFocusForCategories(cats);
  appendWaterfallByLevel(nodes, edges, {
    cats: cats,
    focusIdx: focus.focusIdx,
    hitSubclassId: focus.hitSubclassId,
    startX: routeNode.x + (routeNode.w || 200) + 56,
    anchorY: routeNode.y,
    prevId: routeNode.id,
    enterLabel: "进入流程",
    nodeW: routeNode.w || 200,
    productKey: productKey,
    overviewBranch: true
  });
}

function buildOverviewGraph() {
  const keys = productKeys();
  const nodes = [];
  const edges = [];
  const NODE_W = 220;
  const HEAD_GAP = 52;
  const ROUTE_Y0 = 28;
  const activeKey = overviewActiveProductKey();
  const classLists = keys.map(productClassLabels);
  const routeHeights = classLists.map(function () { return 96; });
  const routeTops = [];
  let cursorY = ROUTE_Y0;
  routeHeights.forEach(function (h) {
    routeTops.push(cursorY);
    cursorY += h + 16;
  });
  const stackBottom = routeTops.length ? routeTops[routeTops.length - 1] + routeHeights[routeHeights.length - 1] : ROUTE_Y0;
  const spineY = ROUTE_Y0 + Math.max(0, (stackBottom - ROUTE_Y0) / 2 - 34);
  let x = 40;

  nodes.push({
    id: "proc:start", kind: "process", label: "开始判定",
    note: "标准字段已就绪", x: x, y: spineY, w: NODE_W, h: 68
  });
  x += NODE_W + HEAD_GAP;
  nodes.push({
    id: "proc:product", kind: "process", label: "识别产品",
    note: activeKey
      ? ("已命中 · " + PRODUCTS[activeKey].label)
      : "点击右侧产品展开其流程",
    x: x, y: spineY, w: NODE_W, h: 70
  });
  edges.push({ from: "proc:start", to: "proc:product", label: "然后", flow: true });
  x += NODE_W + 72;

  if (!keys.length) {
    nodes.push({
      id: "route:empty", kind: "route", label: "暂无产品线路",
      note: "请先在产品标准字段新建类型", x: x, y: spineY, w: NODE_W, h: 72
    });
    edges.push({ from: "proc:product", to: "route:empty", label: "待配置", flow: false });
  } else {
    let selectedRoute = null;
    keys.forEach((k, i) => {
      const st = productExpStatus(k);
      const isActive = activeKey === k;
      const labels = classLists[i] || [];
      const ry = routeTops[i];
      const node = {
        id: "route:" + k, kind: "route", label: PRODUCTS[k].label,
        note: (isActive ? "当前展开 · " : "") + st.label,
        classes: labels,
        productKey: k, x: x, y: ry, w: NODE_W, h: routeHeights[i], level: 1
      };
      nodes.push(node);
      if (isActive) selectedRoute = node;
      edges.push({
        from: "proc:product", to: "route:" + k,
        flow: true,
        yesPath: true,
        routeEdge: true
      });
    });
    if (selectedRoute && activeKey) {
      appendProductWaterfallBranch(nodes, edges, selectedRoute, activeKey);
    }
  }
  return { nodes: nodes, edges: edges, focusIdx: -1, overview: true, activeProduct: activeKey };
}

function productExpStatus(productKey) {
  const prod = PRODUCTS[productKey];
  if (!prod) return { ref: true, label: "未挂接" };
  ensureProductExpFlow(productKey);
  if (isExpFlowRef(prod.expFlow)) return { ref: true, customized: false, label: "引用通用流程" };
  if (prod.expFlow.customized) return { ref: false, customized: true, label: "已改副本" };
  return { ref: false, customized: false, label: "已生成副本" };
}

function expHead() {
  const flow = activeExpFlow();
  const head = flow.head || BASE_EXP_TEMPLATE.head;
  if (state.expScope !== "base" && PRODUCTS[state.product]) {
    return head.map((p) => {
      if (p.id !== "proc:product") return Object.assign({ kind: "process" }, p);
      const content = Object.assign({}, p.content || {}, { note: "当前产品 · " + PRODUCTS[state.product].label });
      return Object.assign({ kind: "process" }, p, { content: content, note: content.note });
    });
  }
  return head.map((p) => Object.assign({ kind: "process", note: (p.content && p.content.note) || p.note || "" }, p));
}

function expCategories() {
  const key = state.expScope === "product" ? state.product : null;
  return categoriesFromFlow(activeExpFlow(), key);
}

function findRawExpNode(id, flow) {
  flow = flow || activeExpFlow();
  const head = flow.head || [];
  for (let i = 0; i < head.length; i++) if (head[i].id === id) return { scope: "head", node: head[i], index: i, flow: flow };
  const cats = flow.categories || [];
  function walkRaw(nodes, parent) {
    for (let j = 0; j < (nodes || []).length; j++) {
      if (nodes[j].id === id) return { scope: parent ? "leaf" : "category", node: nodes[j], index: j, parent: parent, flow: flow };
      const hit = walkRaw(nodes[j].children, nodes[j]);
      if (hit) return hit;
    }
    return null;
  }
  for (let i = 0; i < cats.length; i++) {
    if (cats[i].id === id) return { scope: "category", node: cats[i], index: i, parent: null, flow: flow };
    const hit = walkRaw(cats[i].children, cats[i]);
    if (hit) return hit;
  }
  const books = flow.books || [];
  for (let i = 0; i < books.length; i++) if (books[i].id === id) return { scope: "book", node: books[i], index: i, flow: flow };
  const tail = flow.tail || [];
  for (let i = 0; i < tail.length; i++) if (tail[i].id === id) return { scope: "tail", node: tail[i], index: i, flow: flow };
  return null;
}

function flowBeingEdited() {
  if (state.expScope === "overview") {
    const key = overviewActiveProductKey() || (PRODUCTS[state.product] ? state.product : "");
    if (key && PRODUCTS[key]) return materializeProductExpFlow(key);
    return BASE_EXP_TEMPLATE;
  }
  if (state.expScope === "product" && PRODUCTS[state.product]) return materializeProductExpFlow(state.product);
  return BASE_EXP_TEMPLATE;
}

function applyLogicJsonToNode(node, scope, parsed) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "JSON 必须是对象。";
  if (scope === "leaf") {
    const keptChildren = node.children;
    if (parsed.match || parsed.type === "leaf" || parsed.type === "gate") {
      const keepId = node.id;
      Object.keys(node).forEach(function (k) { delete node[k]; });
      Object.assign(node, parsed);
      node.id = parsed.id || keepId;
      if (Array.isArray(parsed.children)) node.children = parsed.children;
      else if (keptChildren && keptChildren.length) node.children = keptChildren;
      node.type = (node.children && node.children.length) ? "gate" : (node.type || "leaf");
      return "";
    }
    if (parsed.label != null) node.label = parsed.label;
    if (parsed.rule_id != null) node.rule_id = parsed.rule_id;
    if (parsed.priority != null) node.priority = parsed.priority;
    if (parsed.when) node.match = Array.isArray(parsed.when) ? { all: parsed.when } : parsed.when;
    if (parsed.question != null) node.question = parsed.question;
    if (parsed.otherwise != null) node.otherwise = !!parsed.otherwise;
    if (parsed.then && typeof parsed.then === "object") {
      node.then = node.then || {};
      if (parsed.then.exposure_class != null) node.then.exposure_class = parsed.then.exposure_class;
      if (parsed.then.sub_class != null) node.then.sub_class = parsed.then.sub_class;
      if (parsed.then.risk_weight != null) {
        const rw = parsed.then.risk_weight;
        node.then.risk_weight = (typeof rw === "object") ? rw : parseRwLogic(String(rw));
      }
    }
    if (parsed.content && typeof parsed.content === "object") node.content = parsed.content;
    return "";
  }
  if (scope === "category") {
    const children = node.children;
    if (parsed.match || parsed.type === "gate") {
      const keepId = node.id;
      Object.keys(node).forEach(function (k) { delete node[k]; });
      Object.assign(node, parsed);
      node.id = parsed.id || keepId;
      if (!node.children) node.children = children;
      if (!node.type) node.type = "gate";
      return "";
    }
    if (parsed.label != null) node.label = parsed.label;
    if (parsed.question != null) node.question = parsed.question;
    if (parsed.when) node.match = Array.isArray(parsed.when) ? { all: parsed.when } : parsed.when;
    if (parsed.otherwise != null) node.otherwise = !!parsed.otherwise;
    node.children = children;
    return "";
  }
  ["label", "note", "kind", "when", "formula_ref", "question"].forEach(function (k) {
    if (parsed[k] !== undefined) node[k] = parsed[k];
  });
  if (parsed.content && typeof parsed.content === "object") node.content = parsed.content;
  const decision = (parsed.content && parsed.content.status) ? parsed.content : (parsed.status ? parsed : null);
  if (decision && (scope === "tail") && (node.id === "step:route" || node.id === "step:out")) {
    node.manual_decision = {
      status: decision.status,
      matched_rule_id: decision.matched_rule_id == null ? null : decision.matched_rule_id,
      calc_template_id: decision.calc_template_id == null ? null : decision.calc_template_id,
      required_fields: decision.required_fields || [],
      missing_fields: decision.missing_fields || [],
      next_action: decision.next_action,
      explanation: decision.explanation || ""
    };
    if (decision.candidates) node.manual_decision.candidates = decision.candidates;
  }
  return "";
}

function applyCalcJson(flow, sel, calc, raw) {
  if (!calc || typeof calc !== "object") return;
  flow.formulas = flow.formulas || {};
  if (sel.kind === "onbook" || sel.kind === "ccf") {
    const rwaKey = sel.kind === "onbook" ? "rwa_on" : "rwa_off";
    const eadKey = sel.kind === "onbook" ? "ead_on" : "ead_off";
    if (calc.rwa && (calc.rwa.op || calc.rwa.args)) flow.formulas[rwaKey] = calc.rwa;
    const ead = calc.ead && (calc.ead.ast || (calc.ead.op ? calc.ead : null));
    if (ead && ead.op) flow.formulas[eadKey] = ead;
    return;
  }
  if (sel.kind === "crm") {
    const src = (calc.rwa && (calc.rwa.ast || calc.rwa)) || null;
    if (src && src.op) flow.formulas.rwa_crm_split = src;
    return;
  }
  if (raw && raw.scope === "leaf" && raw.node) {
    raw.node.formula = raw.node.formula || {};
    if (calc.rwa && calc.rwa.ast) raw.node.formula.rwa = calc.rwa.ast;
    else if (calc.rwa && calc.rwa.op) raw.node.formula.rwa = calc.rwa;
    if (calc.ead && calc.ead.ast) raw.node.formula.ead = calc.ead.ast;
    else if (calc.ead && calc.ead.op) raw.node.formula.ead = calc.ead;
  }
}

function isPlainObject(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function pushJsonErr(errors, path, msg) {
  errors.push((path ? path + "：" : "") + msg);
}

function formatJsonErrors(errors) {
  if (!errors.length) return "";
  return "未保存。JSON 未通过校验：\n" + errors.map(function (e, i) { return (i + 1) + ". " + e; }).join("\n");
}

function validateCondList(list, path, errors) {
    const ops = { eq: 1, neq: 1, in: 1, contains: 1, lt: 1, lte: 1, gt: 1, gte: 1 };
  if (!Array.isArray(list)) {
    pushJsonErr(errors, path, "必须是条件数组");
    return;
  }
  list.forEach(function (c, i) {
    const p = path + "[" + i + "]";
    if (!isPlainObject(c)) {
      pushJsonErr(errors, p, "必须是对象");
      return;
    }
    if (typeof c.field !== "string" || !c.field) pushJsonErr(errors, p + ".field", "必须是非空字符串");
    if (typeof c.op !== "string" || !ops[c.op]) pushJsonErr(errors, p + ".op", "只能是 eq、neq、in、contains、lt、lte、gt、gte");
    if (!Object.prototype.hasOwnProperty.call(c, "value")) pushJsonErr(errors, p + ".value", "不能缺");
  });
}

function validateMatch(match, path, errors) {
  if (Array.isArray(match)) {
    validateCondList(match, path, errors);
    return;
  }
  if (!isPlainObject(match)) {
    pushJsonErr(errors, path, "必须是条件数组，或带 all / any 的对象");
    return;
  }
  if (Array.isArray(match.all)) validateCondList(match.all, path + ".all", errors);
  else if (Array.isArray(match.any)) validateCondList(match.any, path + ".any", errors);
  else if (match.field) validateCondList([match], path, errors);
  else pushJsonErr(errors, path, "需要 all、any 或 field");
}

function isRulesDoc(parsed) {
  return !!(isPlainObject(parsed) && Array.isArray(parsed.rules) && !Array.isArray(parsed.layers) && !Array.isArray(parsed.categories));
}

function validateRuleCond(cond, path, errors) {
  const ops = { eq: 1, neq: 1, in: 1, contains: 1, lt: 1, lte: 1, gt: 1, gte: 1 };
  if (typeof cond.field !== "string" || !cond.field) pushJsonErr(errors, path + ".field", "必须是非空字符串");
  if (typeof cond.op !== "string" || !ops[cond.op]) pushJsonErr(errors, path + ".op", "只能是 eq、neq、in、contains、lt、lte、gt、gte");
  if (!Object.prototype.hasOwnProperty.call(cond, "value") && !Object.prototype.hasOwnProperty.call(cond, "match")) {
    pushJsonErr(errors, path, "需要 value 或 match");
  }
}

function validateRuleMatch(match, path, errors) {
  if (!isPlainObject(match)) {
    pushJsonErr(errors, path, "必须是带 all / any 的对象");
    return;
  }
  const key = Array.isArray(match.all) ? "all" : (Array.isArray(match.any) ? "any" : "");
  if (!key) {
    if (match.field) validateRuleCond(match, path, errors);
    else pushJsonErr(errors, path, "需要 all、any 或 field");
    return;
  }
  match[key].forEach(function (item, i) {
    const p = path + "." + key + "[" + i + "]";
    if (!isPlainObject(item)) {
      pushJsonErr(errors, p, "必须是对象");
      return;
    }
    if (item.all || item.any) validateRuleMatch(item, p, errors);
    else validateRuleCond(item, p, errors);
  });
}

function validateRuleNode(rule, path, errors) {
  if (!isPlainObject(rule)) {
    pushJsonErr(errors, path, "必须是对象");
    return;
  }
  const id = rule.name || rule.id;
  if (typeof id !== "string" || !id) pushJsonErr(errors, path + ".name", "必须是非空字符串");
  if (typeof rule.label !== "string" || !rule.label.trim()) pushJsonErr(errors, path + ".label", "必须是非空字符串");
  if (rule.when) validateRuleMatch(rule.when, path + ".when", errors);
  if (rule.children != null && !Array.isArray(rule.children)) pushJsonErr(errors, path + ".children", "必须是数组");
  (Array.isArray(rule.children) ? rule.children : []).forEach(function (child, i) {
    validateRuleNode(child, path + ".children[" + i + "]", errors);
  });
  if (rule.otherwise != null) {
    if (!isPlainObject(rule.otherwise)) pushJsonErr(errors, path + ".otherwise", "必须是对象");
    else validateRuleNode(rule.otherwise, path + ".otherwise", errors);
  }
}

function ratioText(number) {
  const points = Math.round(number * 1000000) / 10000;
  return String(points) + "%";
}

function matchFromWhen(when) {
  if (!isPlainObject(when)) return { all: [] };
  function one(item) {
    if (!isPlainObject(item)) return null;
    if (item.all || item.any) return matchFromWhen(item);
    const value = Object.prototype.hasOwnProperty.call(item, "value") ? item.value : item.match;
    return { field: item.field, op: item.op || "eq", value: value };
  }
  if (Array.isArray(when.all)) return { all: when.all.map(one).filter(Boolean) };
  if (Array.isArray(when.any)) return { any: when.any.map(one).filter(Boolean) };
  if (when.field) return { all: [one(when)].filter(Boolean) };
  return { all: [] };
}

function ruleWhenItems(when) {
  if (!when) return [];
  if (Array.isArray(when)) return when;
  if (Array.isArray(when.all)) return when.all;
  if (Array.isArray(when.any)) return when.any;
  if (when.field) return [when];
  return [];
}

function ruleHasField(rule, name) {
  return ruleWhenItems(rule && rule.when).some(function (item) { return item && item.field === name; });
}

function ruleRoleOf(rule) {
  if (!rule) return "";
  const id = String(rule.name || rule.id || "");
  if (id.indexOf("crm_") === 0 || rule.formula || rule.covered || rule.collateral_value_factor != null) return "crm";
  if (id.indexOf("multiple_assessments") === 0 || rule.pick || ruleHasField(rule, "assessment_count")) return "assessment";
  return "";
}

function assessmentStepText(rule) {
  let hit = null;
  ruleWhenItems(rule && rule.when).forEach(function (item) {
    if (item && item.field === "assessment_count") hit = item;
  });
  if (!hit) return "";
  const n = hit.match != null ? hit.match : hit.value;
  if ((hit.op || "eq") === "eq" && Number(n) === 1) return "用该评级";
  if ((hit.op || "eq") === "eq" && Number(n) === 2) return "用较高权重";
  if (hit.op === "gte") return "两个较低里较高的一个";
  return "按评级个数取值";
}

function calcStepOf(rule) {
  if (!rule || typeof rule !== "object") return null;
  if (rule.collateral_value_factor != null && rule.collateral_value_factor !== "") {
    const n = Number(rule.collateral_value_factor);
    if (isFinite(n)) return { type: "haircut", display: "抵押品价值 × " + ratioText(n), factor: n };
  }
  const picked = assessmentStepText(rule);
  if (picked) return { type: "assessment", display: picked };
  if (Array.isArray(rule.pick) || (rule.pick && Array.isArray(rule.pick.use))) return { type: "assessment", display: "按评级个数取值" };
  if (ruleHasField(rule, "crm_tool_count")) return { type: "split", display: "按工具拆分" };
  if (typeof rule.formula === "string" && rule.formula) {
    return { type: "split", display: "覆盖部分 × 缓释权重 + 未覆盖部分 × 原权重", formula: rule.formula };
  }
  return null;
}

function weightFromRule(rule) {
  if (rule.value != null && rule.value !== "" && typeof rule.value !== "object") {
    if (typeof rule.value === "number") return rwConst(rule.value, ratioText(rule.value));
    return { type: "unspecified", display: String(rule.value) };
  }
  const weight = rule.weight;
  if (isPlainObject(weight) && weight.same_as === "counterparty_ordinary_claim") return rwFollow("按交易对手");
  if (isPlainObject(weight) && Array.isArray(weight.greater_of)) {
    let floor = null;
    let fieldName = "";
    weight.greater_of.forEach(function (item) {
      if (typeof item === "number") floor = item;
      else if (item && typeof item === "object" && item.field) fieldName = String(item.field);
    });
    if (fieldName) {
      return {
        type: "max_field",
        display: (floor == null ? "" : ratioText(floor) + " ") + "与已得权重较大值",
        with: floor,
        field: fieldName
      };
    }
    if (floor == null) floor = 0.9;
    return {
      type: "max",
      display: ratioText(floor) + " 与交易对手较大值",
      with: floor,
      note: "取 " + ratioText(floor) + " 与交易对手普通债权权重中较大的一个。"
    };
  }
  const step = calcStepOf(rule);
  if (step) return step;
  return { type: "unspecified", display: "权重未单列" };
}

function ruleToFlowNode(rule, exposureClass) {
  const id = String(rule.name || rule.id || "");
  const label = String(rule.label || id);
  const children = (Array.isArray(rule.children) ? rule.children : [])
    .filter(isPlainObject)
    .map(function (child) { return ruleToFlowNode(child, exposureClass); });
  if (isPlainObject(rule.otherwise)) {
    const fallback = ruleToFlowNode(rule.otherwise, exposureClass);
    fallback.otherwise = true;
    children.push(fallback);
  }
  const node = {
    id: id,
    type: children.length ? "gate" : "leaf",
    label: label,
    question: label.charAt(label.length - 1) === "？" ? label : (label + "？"),
    match: matchFromWhen(rule.when),
    on_match: "expand_children",
    on_miss: "next_layer",
    children: children
  };
  const role = ruleRoleOf(rule);
  const step = calcStepOf(rule);
  if (role) node.role = role;
  if (step && step.formula) node.formula = step.formula;
  if (children.length && step && step.display) node.summary = step.display;
  const note = String(rule.description || rule.note || "").trim();
  if (note) node.content = { basis: note };
  if (isPlainObject(rule.skip) && rule.skip.field) {
    node.skip = { field: rule.skip.field, op: rule.skip.op || "eq", match: rule.skip.match };
  }
  if (!children.length) {
    node.rule_id = id;
    node.priority = 50;
    node.then = {
      exposure_class: exposureClass,
      sub_class: label,
      risk_weight: weightFromRule(rule)
    };
  }
  return node;
}

function rulesDocToFlow(parsed, fallback) {
  const base = fallback ? cloneExpFlow(fallback) : cloneExpFlow(BASE_EXP_TEMPLATE);
  const className = String(parsed.name || parsed.label || base.id || "");
  base.id = parsed.name || base.id;
  base.name = parsed.label || parsed.name || base.name;
  base.ref = false;
  base.customized = true;
  base.meta = Object.assign({}, base.meta || {}, {
    description: parsed.description || (base.meta && base.meta.description) || "",
    tree_align: parsed.name || ""
  });
  base.categories = parsed.rules.filter(isPlainObject).map(function (rule) {
    return ruleToFlowNode(rule, className);
  });
  if (isPlainObject(parsed.otherwise)) {
    const fallbackNode = ruleToFlowNode(parsed.otherwise, className);
    fallbackNode.otherwise = true;
    base.categories.push(fallbackNode);
  }
  delete base.field_gaps;
  return base;
}

function validateFormulaNode(node, path, errors) {
  if (!isPlainObject(node)) {
    pushJsonErr(errors, path, "公式必须是对象");
    return;
  }
  if (isPlainObject(node.ast)) {
    validateFormulaNode(node.ast, path + ".ast", errors);
    return;
  }
  if (node.op) {
    if (typeof node.op !== "string" || !node.op) pushJsonErr(errors, path + ".op", "必须是非空字符串");
    if (!Array.isArray(node.args)) pushJsonErr(errors, path + ".args", "必须是数组");
    return;
  }
  if (node.var || node.ref || node.const != null || node.type === "const" || node.type === "lookup" || node.type === "counterparty") return;
  if (typeof node.expr === "string") return;
  pushJsonErr(errors, path, "需要 op/args、ast、var、const 或 ref");
}

function validateRouteDecision(d, path, errors) {
  const statuses = { ok: 1, missing_input: 1, rule_conflict: 1, unsupported: 1 };
  const actions = { ask_user: 1, calculate: 1, escalate: 1 };
  const tpls = { tpl_on: 1, tpl_off: 1 };
  if (!isPlainObject(d)) {
    pushJsonErr(errors, path, "路由回执必须是对象");
    return;
  }
  const p = path ? path + "." : "";
  if (!statuses[d.status]) pushJsonErr(errors, p + "status", "只能是 ok、missing_input、rule_conflict、unsupported");
  if (!actions[d.next_action]) pushJsonErr(errors, p + "next_action", "只能是 ask_user、calculate、escalate");
  if (!(d.calc_template_id == null || tpls[d.calc_template_id])) {
    pushJsonErr(errors, p + "calc_template_id", "只能是 tpl_on、tpl_off 或 null");
  }
  if (!(d.matched_rule_id == null || typeof d.matched_rule_id === "string")) {
    pushJsonErr(errors, p + "matched_rule_id", "必须是字符串或 null");
  }
  if (typeof d.explanation !== "string") pushJsonErr(errors, p + "explanation", "必须是字符串");
  ["required_fields", "missing_fields"].forEach(function (key) {
    const list = d[key];
    if (!Array.isArray(list) || list.some(function (x) { return typeof x !== "string" || !x; })) {
      pushJsonErr(errors, p + key, "必须是非空字符串组成的数组");
    }
  });
  if (d.candidates != null && !Array.isArray(d.candidates)) pushJsonErr(errors, p + "candidates", "必须是数组");
  if (d.status === "ok") {
    if (d.next_action && d.next_action !== "calculate") pushJsonErr(errors, path || "回执", "status 为 ok 时 next_action 必须是 calculate");
    if (!tpls[d.calc_template_id]) pushJsonErr(errors, path || "回执", "status 为 ok 时 calc_template_id 必须是 tpl_on 或 tpl_off");
    if (typeof d.matched_rule_id !== "string" || !d.matched_rule_id) pushJsonErr(errors, path || "回执", "status 为 ok 时要有 matched_rule_id");
    if (Array.isArray(d.missing_fields) && d.missing_fields.length) pushJsonErr(errors, path || "回执", "status 为 ok 时 missing_fields 必须是空数组");
  }
  if (d.status === "missing_input") {
    if (d.next_action && d.next_action !== "ask_user") pushJsonErr(errors, path || "回执", "缺字段时 next_action 必须是 ask_user");
    if (d.calc_template_id != null) pushJsonErr(errors, path || "回执", "缺字段时 calc_template_id 必须是 null");
    if (!Array.isArray(d.missing_fields) || !d.missing_fields.length) pushJsonErr(errors, path || "回执", "缺字段时 missing_fields 不能为空");
  }
  if (d.status === "rule_conflict") {
    if (d.next_action && d.next_action !== "ask_user" && d.next_action !== "escalate") {
      pushJsonErr(errors, path || "回执", "规则冲突时 next_action 只能是 ask_user 或 escalate");
    }
    if (d.calc_template_id != null) pushJsonErr(errors, path || "回执", "规则冲突时 calc_template_id 必须是 null");
  }
  if (d.status === "unsupported") {
    if (d.next_action && d.next_action !== "escalate") pushJsonErr(errors, path || "回执", "不适用时 next_action 必须是 escalate");
    if (d.calc_template_id != null) pushJsonErr(errors, path || "回执", "不适用时 calc_template_id 必须是 null");
  }
}

function validateNodeLogicJson(sel, parsed, errors) {
  if (!isPlainObject(parsed)) {
    pushJsonErr(errors, "", "JSON 必须是对象，不能是数组或 null");
    return;
  }
  if (sel && (sel.id === "step:route" || sel.id === "step:out")) {
    const decision = (isPlainObject(parsed.content) && parsed.content.status) ? parsed.content : (parsed.status ? parsed : null);
    if (!decision) pushJsonErr(errors, "content", "路由回执需要 status");
    else validateRouteDecision(decision, isPlainObject(parsed.content) && parsed.content.status ? "content" : "", errors);
    return;
  }
  if (sel && sel.id === "res:rw") {
    if (!isPlainObject(parsed.then)) pushJsonErr(errors, "then", "必须是对象");
    else if (parsed.then.risk_weight == null || parsed.then.risk_weight === "") pushJsonErr(errors, "then.risk_weight", "不能为空");
    return;
  }
  if (sel && (sel.kind === "onbook" || sel.kind === "ccf" || sel.kind === "crm")) {
    if (parsed.label != null && typeof parsed.label !== "string") pushJsonErr(errors, "label", "必须是字符串");
    if (parsed.when) validateMatch(parsed.when, "when", errors);
    return;
  }
  if (sel && sel.kind === "category" || parsed.type === "gate") {
    if (parsed.label != null && typeof parsed.label !== "string") pushJsonErr(errors, "label", "必须是字符串");
    if (typeof parsed.label === "string" && !parsed.label.trim()) pushJsonErr(errors, "label", "不能为空");
    if (parsed.question != null && typeof parsed.question !== "string") pushJsonErr(errors, "question", "必须是字符串");
    if (parsed.when) validateMatch(parsed.when, "when", errors);
    if (parsed.match) validateMatch(parsed.match, "match", errors);
    return;
  }
  if (sel && sel.kind === "subclass" || parsed.type === "leaf") {
    if (typeof parsed.label !== "string" || !parsed.label.trim()) pushJsonErr(errors, "label", "必须是非空字符串");
    if (parsed.rule_id != null && (typeof parsed.rule_id !== "string" || !parsed.rule_id)) pushJsonErr(errors, "rule_id", "必须是非空字符串");
    if (parsed.priority != null && typeof parsed.priority !== "number") pushJsonErr(errors, "priority", "必须是数字");
    if (parsed.when) validateMatch(parsed.when, "when", errors);
    if (parsed.match) validateMatch(parsed.match, "match", errors);
    if (parsed.then != null && !isPlainObject(parsed.then)) pushJsonErr(errors, "then", "必须是对象");
    return;
  }
  if (parsed.label != null && typeof parsed.label !== "string") pushJsonErr(errors, "label", "必须是字符串");
  if (parsed.when) validateMatch(parsed.when, "when", errors);
  if (parsed.match) validateMatch(parsed.match, "match", errors);
}

function validateCalcJson(calc, errors) {
  if (!isPlainObject(calc)) {
    pushJsonErr(errors, "公式", "必须是对象");
    return;
  }
  if (calc.rwa) validateFormulaNode(calc.rwa, "公式.rwa", errors);
  if (calc.ead) validateFormulaNode(calc.ead, "公式.ead", errors);
  if (calc.lines != null && (!Array.isArray(calc.lines) || calc.lines.some(function (line) { return typeof line !== "string"; }))) {
    pushJsonErr(errors, "公式.lines", "必须是字符串数组");
  }
}

function validateFlowJson(parsed, errors) {
  if (!isPlainObject(parsed)) {
    pushJsonErr(errors, "", "流程 JSON 必须是对象");
    return;
  }
  if (parsed.ref === true || parsed.mode === "ref") return;
  if (parsed.formulas != null) {
    if (!isPlainObject(parsed.formulas)) pushJsonErr(errors, "formulas", "必须是对象");
    else Object.keys(parsed.formulas).forEach(function (key) {
      const f = parsed.formulas[key];
      if (!isPlainObject(f)) pushJsonErr(errors, "formulas." + key, "必须是对象");
      else if (f.op || f.args || f.ast) validateFormulaNode(f, "formulas." + key, errors);
    });
  }
  if (Array.isArray(parsed.layers)) {
    if (!parsed.layers.length) pushJsonErr(errors, "layers", "至少要有一个判定层");
    parsed.layers.forEach(function (layer, i) {
      const p = "layers[" + i + "]";
      if (!isPlainObject(layer)) {
        pushJsonErr(errors, p, "必须是对象");
        return;
      }
      if (typeof layer.id !== "string" || !layer.id) pushJsonErr(errors, p + ".id", "必须是非空字符串");
      if (typeof layer.label !== "string" || !layer.label.trim()) pushJsonErr(errors, p + ".label", "必须是非空字符串");
      if (layer.when) validateMatch(layer.when, p + ".when", errors);
      const kids = layer.if_yes || layer.children;
      if (kids != null && !Array.isArray(kids)) pushJsonErr(errors, p + ".if_yes", "必须是数组");
      (Array.isArray(kids) ? kids : []).forEach(function (ch, j) {
        const cp = p + ".if_yes[" + j + "]";
        if (!isPlainObject(ch)) {
          pushJsonErr(errors, cp, "必须是对象");
          return;
        }
        if (typeof ch.id !== "string" || !ch.id) pushJsonErr(errors, cp + ".id", "必须是非空字符串");
        if (typeof ch.label !== "string" || !ch.label.trim()) pushJsonErr(errors, cp + ".label", "必须是非空字符串");
        if (ch.when) validateMatch(ch.when, cp + ".when", errors);
        if (ch.then != null && !isPlainObject(ch.then)) pushJsonErr(errors, cp + ".then", "必须是对象");
        if (ch.priority != null && typeof ch.priority !== "number") pushJsonErr(errors, cp + ".priority", "必须是数字");
      });
    });
    return;
  }
  if (Array.isArray(parsed.categories)) {
    if (!parsed.categories.length) pushJsonErr(errors, "categories", "至少要有一个判定层");
    parsed.categories.forEach(function (cat, i) {
      const p = "categories[" + i + "]";
      if (!isPlainObject(cat)) {
        pushJsonErr(errors, p, "必须是对象");
        return;
      }
      if (typeof cat.id !== "string" || !cat.id) pushJsonErr(errors, p + ".id", "必须是非空字符串");
      if (cat.match) validateMatch(cat.match, p + ".match", errors);
      if (cat.children != null && !Array.isArray(cat.children)) pushJsonErr(errors, p + ".children", "必须是数组");
      (cat.children || []).forEach(function (ch, j) {
        const cp = p + ".children[" + j + "]";
        if (!isPlainObject(ch)) {
          pushJsonErr(errors, cp, "必须是对象");
          return;
        }
        if (typeof ch.id !== "string" || !ch.id) pushJsonErr(errors, cp + ".id", "必须是非空字符串");
        if (ch.match) validateMatch(ch.match, cp + ".match", errors);
        if (ch.then != null && !isPlainObject(ch.then)) pushJsonErr(errors, cp + ".then", "必须是对象");
      });
    });
    return;
  }
  if (Array.isArray(parsed.rules)) {
    if (!parsed.rules.length) pushJsonErr(errors, "rules", "至少要有一条规则");
    parsed.rules.forEach(function (rule, i) {
      validateRuleNode(rule, "rules[" + i + "]", errors);
    });
    return;
  }
  pushJsonErr(errors, "", "需要 layers、categories、rules，或把 mode 设为 ref");
}

function saveExpNodeJson() {
  const logicEl = document.getElementById("expNodeJson");
  if (!logicEl) return false;
  const sel = findExpNode(state.selectedExposure);
  if (!sel) {
    state.expJsonErr = "没有选中节点。";
    return false;
  }
  let parsed;
  try {
    parsed = JSON.parse(logicEl.value);
  } catch (err) {
    state.expJsonErr = "未保存。JSON 无法解析：" + (err && err.message ? err.message : String(err));
    return false;
  }
  let calc = null;
  const calcEl = document.getElementById("expNodeCalcJson");
  if (calcEl && calcEl.value.trim()) {
    try {
      calc = JSON.parse(calcEl.value);
    } catch (err) {
      state.expJsonErr = "未保存。公式 JSON 无法解析：" + (err && err.message ? err.message : String(err));
      return false;
    }
  }
  const errors = [];
  validateNodeLogicJson(sel, parsed, errors);
  if (calc) validateCalcJson(calc, errors);
  if (errors.length) {
    state.expJsonErr = formatJsonErrors(errors);
    return false;
  }
  const flow = flowBeingEdited();
  let raw = findRawExpNode(sel.id, flow);
  if (!raw && sel.id === "res:rw") {
    const leafId = parsed.receives_from || state.confirmedLeaf;
    raw = leafId ? findRawExpNode(leafId, flow) : null;
    if (raw && raw.scope === "leaf" && parsed.then) {
      raw.node.then = raw.node.then || {};
      if (parsed.then.risk_weight != null) {
        const rw = parsed.then.risk_weight;
        if (typeof rw === "object") raw.node.then.risk_weight = rw;
        else raw.node.then.risk_weight = parseRwLogic(rw);
      }
      if (calc) applyCalcJson(flow, sel, calc, raw);
      if (state.expScope !== "base") markExpCustomized();
      state.expJsonErr = "";
      state.expMsg = "已保存「" + (raw.node.label || raw.node.id) + "」的权重。";
      return true;
    }
  }
  if (!raw) {
    state.expJsonErr = "这个节点没有可写回的流程 JSON。";
    return false;
  }
  const err = applyLogicJsonToNode(raw.node, raw.scope, parsed);
  if (err) {
    state.expJsonErr = err;
    return false;
  }
  if (calc) applyCalcJson(flow, sel, calc, raw);
  if (state.expScope !== "base") markExpCustomized();
  state.expJsonErr = "";
  state.expMsg = "已保存「" + (raw.node.label || raw.node.id) + "」的 JSON。";
  return true;
}

function nodeContentJson(node) {
  if (!node) return {};
  if (node.kind === "process" || node.type === "process") {
    return {
      id: node.id,
      type: "process",
      label: node.label,
      content: node.content || { note: node.note || "" }
    };
  }
  if (node.kind === "category" || node.type === "gate") {
    return {
      id: node.id,
      type: "gate",
      label: node.label,
      question: node.question,
      match: node.match || {},
      on_match: node.on_match || "expand_children",
      on_miss: node.on_miss || "next_layer"
    };
  }
  return {
    id: node.id,
    type: "leaf",
    label: node.label,
    priority: node.priority,
    rule_id: ruleIdOf(node),
    match: node.match || {},
    then: node.then || {
      exposure_class: node.parentLabel || "",
      sub_class: node.label,
      risk_weight: { type: "const", display: node.rw || "—" }
    },
    formula: node.formula || activeExpFlow().formulas || {},
    content: node.content || {}
  };
}

function resolveFormulaRef(f, flow) {
  if (!f || typeof f !== "object") return f;
  if (typeof f.ref === "string") {
    const key = f.ref.replace(/^formulas\./, "");
    const catalog = (flow && flow.formulas) || {};
    if (catalog[key]) return catalog[key];
    if (f.ref === "then.risk_weight" || f.ref === "then.risk_weight.value") {
      return { var: "risk_weight" };
    }
  }
  return f;
}

/** 程序可读 AST：op / var / const / lookup */
function formulaToAst(f, flow, depth) {
  if (depth > 8) return null;
  const node = resolveFormulaRef(f, flow);
  if (node == null) return null;
  if (typeof node === "number" || typeof node === "boolean") return { const: node };
  if (typeof node === "string") return { const: node };
  if (typeof node !== "object") return null;
  if (node.var) return { var: node.var };
  if (node.type === "const" || node.const != null) {
    return { const: node.value != null ? node.value : node.const };
  }
  if (node.lookup || (node.type === "lookup" && node.table)) {
    return { lookup: node.lookup || node.table, key: node.key };
  }
  if (node.op) {
    return {
      op: node.op,
      args: (node.args || []).map((a) => formulaToAst(a, flow, (depth || 0) + 1)).filter(Boolean)
    };
  }
  if (node.expr && typeof node.expr === "object") return formulaToAst(node.expr, flow, (depth || 0) + 1);
  return null;
}

function astToExpr(ast) {
  if (!ast) return "";
  if (ast.var) return ast.var;
  if (ast.const != null) return String(ast.const);
  if (ast.lookup) return "lookup(\"" + ast.lookup + "\", " + ast.key + ")";
  if (!ast.op) return "";
  const args = (ast.args || []).map(astToExpr);
  if (ast.op === "sub") return "(" + args.join(" - ") + ")";
  if (ast.op === "mul") return "(" + args.join(" * ") + ")";
  if (ast.op === "add" || ast.op === "sum") return "(" + args.join(" + ") + ")";
  if (ast.op === "div") return "(" + args.join(" / ") + ")";
  if (ast.op === "max") return "max(" + args.join(", ") + ")";
  if (ast.op === "min") return "min(" + args.join(", ") + ")";
  return ast.op + "(" + args.join(", ") + ")";
}

function collectAstVars(ast, out) {
  if (!ast) return;
  if (ast.var) out[ast.var] = true;
  if (ast.key) out[ast.key] = true;
  (ast.args || []).forEach((a) => collectAstVars(a, out));
}

function rwToCalcNode(rw) {
  if (rw == null) return { const: 1 };
  if (typeof rw === "number") return { const: rw };
  if (typeof rw === "string") {
    const m = rw.match(/([\d.]+)\s*%/);
    if (m) return { const: parseFloat(m[1]) / 100 };
    return { const: rw };
  }
  if (rw.type === "const" || rw.value != null) return { const: rw.value };
  if (rw.type === "lookup" || rw.table) return { lookup: rw.table || rw.lookup, key: rw.key };
  if (rw.type === "formula") return formulaToAst(rw.expr, activeExpFlow(), 0);
  return { var: "risk_weight" };
}

/** 叶子 / 公式枢纽的机器可读计算块 */
function buildMachineCalc(sel) {
  const flow = (sel && sel.productKey)
    ? flowForProductKey(sel.productKey)
    : (overviewActiveProductKey()
      ? flowForProductKey(overviewActiveProductKey())
      : activeExpFlow());
  const then = sel.then || {};
  const rw = then.risk_weight;
  const formula = sel.formula || {
    rwa: { op: "mul", args: [{ var: "ead" }, { var: "risk_weight" }] }
  };
  let eadAst = formula.ead ? formulaToAst(formula.ead, flow, 0) : null;
  const eadFromBook = !eadAst;
  if (!eadAst) eadAst = { var: "ead" };
  let rwaAst = formulaToAst(formula.rwa, flow, 0);
  if (!rwaAst) {
    rwaAst = { op: "mul", args: [{ var: "ead" }, { var: "risk_weight" }] };
  }
  const rwAst = rwToCalcNode(rw);
  const inputs = {};
  collectAstVars(eadAst, inputs);
  collectAstVars(rwaAst, inputs);
  collectAstVars(rwAst, inputs);
  delete inputs.ead;
  delete inputs.risk_weight;
  return {
    engine: "rwa_expr_v1",
    inputs: Object.keys(inputs).sort(),
    outputs: ["ead", "risk_weight", "rwa"],
    risk_weight: {
      display: rwLogicText(rw) || sel.rw || null,
      ast: rwAst
    },
    ead: {
      expr: eadFromBook ? null : astToExpr(eadAst),
      from: eadFromBook ? "book_line" : "leaf",
      ast: eadAst
    },
    rwa: {
      expr: astToExpr(rwaAst),
      ast: rwaAst
    }
  };
}

/** 命中叶子 → 公式枢纽 calc + 向结果节点分发 */
function buildCalcHubPair() {
  const focus = resolveExpFocus();
  const leaf = focus && focus.hitSubclassId ? findExpNode(focus.hitSubclassId) : null;
  const calc = leaf && leaf.kind === "subclass"
    ? buildMachineCalc(leaf)
    : {
      engine: "rwa_expr_v1",
      inputs: ["ead"],
      outputs: ["ead", "risk_weight", "rwa"],
      risk_weight: { display: null, ast: { var: "risk_weight" } },
      ead: {
        expr: null,
        from: "book_line",
        ast: { var: "ead" }
      },
      rwa: {
        expr: "(ead * risk_weight)",
        ast: { op: "mul", args: [{ var: "ead" }, { var: "risk_weight" }] }
      }
    };
  return {
    calc: calc,
    dispatch: {
      from: "res:rw",
      to: "step:route",
      next: ["step:route", "step:crm", "step:rwa", "step:out"],
      outputs: ["exposure_class", "risk_weight", "ead", "rwa"],
      source_rule_id: leaf ? ruleIdOf(leaf) : null,
      source_subclass: leaf ? leaf.id : null
    }
  };
}

function pageCite(page, label) {
  return { page: page, label: label };
}

function resultProductKey() {
  const overview = overviewActiveProductKey();
  if (overview && PRODUCTS[overview]) return overview;
  if (PRODUCTS[state.product]) return state.product;
  const keys = productKeys();
  return keys.length ? keys[0] : null;
}

/** 标准字段只认「产品字段」页上当前产品已有的项 */
function fieldZh(id, hit) {
  if (hit && hit.zh) return hit.zh;
  if (FIELD_LABEL[id]) return FIELD_LABEL[id];
  let found = "";
  KB_FIELD_CATALOG.forEach(function (group) {
    (group.items || []).forEach(function (item) {
      if (item.id === id && item.zh) found = item.zh;
    });
  });
  return found || id;
}

function fieldCite(id, productKey) {
  const prod = productKey && PRODUCTS[productKey];
  const hit = prod && (prod.fields || []).find(function (f) { return f.id === id; });
  return {
    id: id,
    zh: fieldZh(id, hit),
    from: pageCite("fields", "产品字段"),
    product: prod ? prod.label : null,
    on_product: !!hit
  };
}

/** 阈值只认「规则参数」页 */
function paramCite(id) {
  const p = PARAMS.find(function (x) { return x.id === id; });
  return {
    id: id,
    name: p ? p.name : id,
    value: p ? p.value : null,
    unit: p ? p.unit : null,
    from: pageCite("params", "规则参数")
  };
}

function paramsForExposure(cls) {
  const ids = [];
  if (cls === "DEFAULT") ids.push("DEF_PROV");
  if (cls === "BANK") ids.push("SHORT_3M", "TRADE_6M");
  if (cls === "RE_RESIDENTIAL") ids.push("LTV_RES_50", "LTV_RES_100");
  if (cls === "RE_COMMERCIAL") ids.push("LTV_CRE_60", "LTV_CRE_80");
  return ids.map(paramCite);
}

function matchFieldCites(match, productKey) {
  const ids = {};
  collectLogicFields(match, ids);
  return Object.keys(ids).sort().map(function (id) { return fieldCite(id, productKey); });
}

function ccfCandidates(productKey) {
  const prod = productKey && PRODUCTS[productKey];
  const label = prod ? prod.label : "";
  let rules = [];
  if (productKey === "commitment" || label.indexOf("承诺") >= 0) {
    rules = CCF_RULES.filter(function (r) { return r.type.indexOf("承诺") >= 0; });
  } else if (label.indexOf("信用卡") >= 0) {
    rules = CCF_RULES.filter(function (r) { return r.type.indexOf("信用卡") >= 0; });
  }
  return rules.map(function (r) {
    return {
      id: r.id,
      type: r.type,
      cond: r.cond,
      ccf: r.ccf,
      priority: r.pri,
      from: pageCite("ccf", "CCF")
    };
  });
}

/** 路由结果：只判断用哪条规则、哪个计算模板、缺哪些字段，不计算 RWA */
function buildRouteDecision(productKeyOverride) {
  const productKey = productKeyOverride || resultProductKey();
  const routeFlow = productKey ? flowForProductKey(productKey) : activeExpFlow();
  const routeStep = chainOf(routeFlow, "tail").filter(function (s) { return s.id === "step:route"; })[0];
  if (routeStep && routeStep.manual_decision && routeStep.manual_decision.status) {
    return routeStep.manual_decision;
  }
  const prod = productKey && PRODUCTS[productKey];
  const ver = VERSIONS.find(function (v) { return v.id === state.selectedVersion; }) || null;
  const cats = productKey
    ? categoriesFromFlow(flowForProductKey(productKey), productKey)
    : expCategories();
  const raw = state.selectedExposure || "";
  const tailish = {
    "step:route": 1, "step:crm": 1, "step:out": 1, "res:rw": 1,
    "line:on": 1, "line:off": 1, "step:rwa": 1
  };
  const selected = tailish[raw] ? (state.confirmedLeaf || "") : raw;
  let focusCat = null;
  let selectedNode = null;
  (cats || []).forEach(function (cat) {
    if (cat.id === selected) focusCat = cat;
    const path = findChildPath(cat.children, selected, []);
    if (path) {
      focusCat = cat;
      selectedNode = path[path.length - 1];
    }
  });
  if (!focusCat && selected && (cats || []).some(function (cat) { return cat.id === raw; })) {
    focusCat = (cats || []).filter(function (cat) { return cat.id === raw; })[0];
  }
  const children = (focusCat && focusCat.children) || [];
  const explicit = (selectedNode && !(selectedNode.children || []).length ? selectedNode : null)
    || children.filter(function (ch) { return ch.id === selected; })[0]
    || null;
  const only = children.length === 1 ? children[0] : null;
  const leaf = explicit || only;
  const candidates = children.map(function (ch) {
    return { rule_id: ch.rule_id || ch.rule || ch.id, label: ch.label, priority: ch.priority };
  });
  const hasBalance = !!(prod && (prod.fields || []).some(function (f) { return f.id === "balance"; }));
  const hasNominal = !!(prod && (prod.fields || []).some(function (f) { return f.id === "nominal"; }));
  let template = null;
  if (hasNominal && !hasBalance) template = "tpl_off";
  else if (hasBalance && !hasNominal) template = "tpl_on";

  let status = "ok";
  let next = "calculate";
  let explanation = "";
  let conflictCandidates = null;

  if (!prod) {
    status = "unsupported";
    next = "escalate";
    explanation = "没有产品，不在规则适用范围内。";
  } else if (!ver) {
    status = "rule_conflict";
    next = "escalate";
    explanation = "没有选中监管版本，规则配置与地区对不上，需要人工确认。";
  } else if (state.expScope === "product" && !(prod.classes || []).length) {
    status = "unsupported";
    next = "escalate";
    explanation = "「" + prod.label + "」没有配置风险暴露大类，不在当前规则适用范围内。";
  } else if (!leaf && candidates.length > 1) {
    status = "rule_conflict";
    next = "ask_user";
    conflictCandidates = candidates;
    explanation = "大类「" + (focusCat ? focusCat.label : "") + "」有 " + candidates.length + " 条规则可能适用，需要确认用哪一条。";
  } else if (!leaf && (cats || []).length) {
    status = "rule_conflict";
    next = "ask_user";
    conflictCandidates = [];
    (cats || []).forEach(function (cat) {
      (cat.children || []).forEach(function (ch) {
        conflictCandidates.push({
          rule_id: ch.rule_id || ch.rule || ch.id,
          label: cat.label + " / " + ch.label,
          priority: ch.priority
        });
      });
    });
    explanation = "还没有确认细分规则。请先选定一条，再进入计算。";
  } else if (!leaf) {
    status = "unsupported";
    next = "escalate";
    explanation = "还没有命中细分规则。";
  } else if (hasBalance && hasNominal) {
    status = "rule_conflict";
    next = "ask_user";
    conflictCandidates = [
      { calc_template_id: "tpl_on", label: "表内" },
      { calc_template_id: "tpl_off", label: "表外" }
    ];
    explanation = "产品同时有账面余额和名义金额，需要确认走表内还是表外计算模板。";
  }
  const rwObj = leaf && leaf.then && leaf.then.risk_weight;
  let needsRerun = false;
  if (status === "ok" && rwObj && rwObj.type === "unspecified") {
    status = "rule_conflict";
    next = "escalate";
    template = null;
    explanation = "「" + (leaf.label || "") + "」在权重表里没有给出风险权重，不能自行补数，需要人工确认。";
  } else if (status === "ok" && rwObj && rwObj.type === "counterparty") {
    needsRerun = true;
    template = null;
  }

  const required = [];
  const seen = {};
  function addReq(id) {
    if (!id || seen[id] || id === "ead" || id === "risk_weight" || id === "rwa") return;
    seen[id] = true;
    required.push(id);
  }
  if (leaf) {
    const ids = {};
    collectLogicFields(leaf.match, ids);
    if (focusCat) collectLogicFields(focusCat.match, ids);
    Object.keys(ids).forEach(addReq);
  }
  if (status === "ok" && template === "tpl_on") {
    addReq("balance");
    addReq("impairment");
  }
  if (status === "ok" && template === "tpl_off") addReq("nominal");

  const missing = required.filter(function (id) {
    return !(prod && (prod.fields || []).some(function (f) { return f.id === id; }));
  });
  if (status === "ok" && missing.length) {
    status = "missing_input";
    next = "ask_user";
    template = null;
    explanation = "命中规则还缺字段：" + missing.join("、") + "。先到产品字段页补齐，再进入计算。";
  } else if (status === "ok") {
    const ruleId = leaf.rule_id || leaf.rule || leaf.id;
    explanation = "已命中 " + ruleId + "，必填字段齐全，可以进入"
      + (template === "tpl_off" ? "表外" : "表内")
      + "计算模板。这里只做路由，RWA 由计算模板执行。";
  }

  const out = {
    status: status,
    matched_rule_id: (status === "ok" || status === "missing_input") && leaf
      ? (leaf.rule_id || leaf.rule || leaf.id)
      : null,
    calc_template_id: status === "ok" ? template : null,
    required_fields: required,
    missing_fields: missing,
    next_action: next,
    explanation: explanation
  };
  if (conflictCandidates) out.candidates = conflictCandidates;
  return out;
}

/** 节点悬浮框：名称 + 精简 JSON；计算节点含程序可读 calc */
function nodeLogicPopoverJson(sel) {
  if (!sel) return {};
  if (sel.kind === "route") {
    const fields = {};
    collectLogicFields(sel.match, fields);
    return {
      purpose: "产品分线路由：识别 product_type 后进入该产品瀑布",
      product: sel.label,
      product_id: sel.productKey || null,
      classes: productClassLabels(sel.productKey),
      when: flattenMatch(sel.match),
      fields_used: Object.keys(fields)
    };
  }
  if (sel.kind === "process") {
    return {
      purpose: "流程起点 / 识别步骤，不参与 RW 计算",
      id: sel.id,
      label: sel.label,
      note: (sel.content && sel.content.note) || sel.note || ""
    };
  }
  if (sel.kind === "onbook" || sel.kind === "ccf") {
    const flow = (sel.productKey ? flowForProductKey(sel.productKey) : null) || activeExpFlow();
    const on = sel.kind === "onbook";
    const rwaKey = on ? "rwa_on" : "rwa_off";
    const eadKey = on ? "ead_on" : "ead_off";
    const rwaF = flow.formulas && flow.formulas[rwaKey];
    const eadF = flow.formulas && flow.formulas[eadKey];
    return {
      purpose: on
        ? "表内计算模板。路由 status 为 ok 之后才执行：RWA = Σ((账面 − 减值) 的各部分 × 对应权重)，不乘信用转换系数。"
        : "表外计算模板。路由 status 为 ok 之后才执行：RWA = Σ(名义金额 × 信用转换系数 × 各部分权重)。",
      id: sel.id,
      label: sel.label,
      line: on ? "on_balance" : "off_balance",
      route: (function () {
        const gate = buildRouteDecision();
        return { status: gate.status, next_action: gate.next_action, calc_template_id: gate.calc_template_id };
      })(),
      when: sel.when || null,
      formula_ref: sel.formula_ref || ("formulas." + rwaKey),
      calc: {
        lines: [formulaCalcText(rwaF), formulaCalcText(eadF)].filter(Boolean),
        rwa: rwaF || null,
        ead: eadF ? { expr: formulaCalcText(eadF), ast: eadF } : null
      },
      content: sel.content || {}
    };
  }
  if (sel.kind === "crm") {
    const flow = (sel.productKey ? flowForProductKey(sel.productKey) : null) || activeExpFlow();
    const f = flow.formulas && flow.formulas.rwa_crm_split;
    return {
      purpose: "CRM 缓释：分类和原权重已经确定。覆盖部分改用质物或保证人的权重，未覆盖部分沿用原权重。表内、表外两条线在下一步才分开计算。",
      id: sel.id,
      label: sel.label,
      formula_ref: sel.formula_ref || "formulas.rwa_crm_split",
      calc: f ? { rwa: { expr: formulaCalcText(f), ast: f } } : null,
      content: sel.content || {}
    };
  }
  if (sel.kind === "category") {
    const fields = {};
    collectLogicFields(sel.match, fields);
    const gapKey = sel.productKey || overviewActiveProductKey() || state.product;
    const missing = missingFieldsForExpNode(sel.id, gapKey);
    return {
      purpose: sel.role === "crm"
        ? ("信用风险缓释。" + (sel.summary || "覆盖部分按缓释规则算，未覆盖部分沿用原来的风险权重。"))
        : (sel.role === "assessment"
          ? ("多个外部评级。" + (sel.summary || "按评级个数选定一个评级，再用该评级走原来的分类。"))
          : "瀑布判定层（同列上下）：when 命中则右进细分列，否则继续往下"),
      id: sel.id,
      label: sel.label,
      question: sel.question,
      when: sel.match || { all: [] },
      otherwise: !!sel.otherwise,
      fields_used: Object.keys(fields),
      field_gaps: missing.length ? {
        missing_fields: missing,
        note: "产品标准字段未覆盖；图上 ! 表示需补字段或改条件"
      } : null
    };
  }
  if (sel.kind === "subclass") {
    const then = sel.then || {};
    const fields = {};
    collectLogicFields(sel.match, fields);
    const gapKey = sel.productKey || overviewActiveProductKey() || state.product;
    const missing = missingFieldsForExpNode(sel.id, gapKey);
    return {
      purpose: sel.role === "crm"
        ? "这一步是缓释算法，不另写一个风险权重。覆盖部分按这里算，未覆盖部分沿用原来的权重。"
        : (sel.role === "assessment"
          ? "这一步按评级个数选定一个外部评级，再用该评级走原来的分类。这里不另写一个风险权重。"
          : "只做风险暴露分类和风险权重，不在这里算 RWA。权重表没写的档位标成未列明，路由校验会拦住。"),
      id: sel.id,
      label: sel.label,
      rule_id: ruleIdOf(sel),
      priority: sel.priority,
      question: sel.question || "",
      otherwise: !!sel.otherwise,
      when: sel.match || { all: [] },
      then: {
        exposure_class: then.exposure_class || "",
        sub_class: then.sub_class || sel.label || "",
        risk_weight: rwLogicText(then.risk_weight) || sel.rw || null
      },
      fields_used: Object.keys(fields).sort(),
      field_gaps: missing.length ? {
        missing_fields: missing,
        note: "产品标准字段未覆盖；图上 ! 表示需补字段或改条件"
      } : null,
      next: "res:rw"
    };
  }
  if (sel.id === "step:route") {
    return {
      purpose: "只校验配置和字段，不计算 RWA。status 为 ok、next_action 为 calculate 时，才进入表内或表外计算模板。",
      role: "route_check",
      id: sel.id,
      label: sel.label,
      content: buildRouteDecision()
    };
  }
  if (sel.kind === "rule") {
    const flow = (sel.productKey ? flowForProductKey(sel.productKey) : null) || activeExpFlow();
    const formulas = (flow && flow.formulas) || {};
    return {
      purpose: "RWA 计算：风险暴露已由表内或表外线给出，权重已按缓释拆分。两条线各自汇总，不再共用一个先乘权重再折算的公式。",
      role: "rwa_by_book",
      id: sel.id,
      label: sel.label,
      receives_from: "step:crm",
      calc: {
        lines: [
          formulaCalcText(formulas.rwa_on) || "表内 RWA = Σ(各部分风险暴露 × 对应权重)",
          formulaCalcText(formulas.rwa_off) || "表外 RWA = Σ(名义金额 × CCF × 各部分对应权重)"
        ],
        rwa_on: formulas.rwa_on || null,
        rwa_off: formulas.rwa_off || null
      },
      next: "step:out"
    };
  }
  if (sel.kind === "result" && sel.id === "res:rw") {
    const pair = buildCalcHubPair();
    return {
      purpose: "确定原风险权重。下一步先做路由校验；校验通过后，缓释覆盖部分才改用质物或保证人的权重。",
      role: "weight_gate",
      id: sel.id,
      label: sel.label,
      receives_from: pair.dispatch.source_subclass,
      source_rule_id: pair.dispatch.source_rule_id,
      then: {
        risk_weight: pair.calc.risk_weight && pair.calc.risk_weight.display
      },
      next: "step:route"
    };
  }
  if (sel.kind === "result") {
    return {
      purpose: "路由回执。只有 status 为 ok 时，calc_template_id 才是 tpl_on 或 tpl_off。RWA 由计算模板执行，这里不给数字。",
      role: "route_receipt",
      id: sel.id,
      label: sel.label,
      content: buildRouteDecision()
    };
  }
  return { id: sel.id, label: sel.label || sel.question || sel.id };
}

var expCfgDraft = null;
var expCfgLock = false;
var EXP_CFG_OPS = [
  ["eq", "等于"],
  ["neq", "不等于"],
  ["in", "其中之一"],
  ["contains", "包含"],
  ["gt", "大于"],
  ["gte", "大于等于"],
  ["lt", "小于"],
  ["lte", "小于等于"]
];

function expCfgPack(when) {
  if (!when) return { join: "all", items: [], nested: false };
  if (Array.isArray(when)) return { join: "all", items: when, nested: when.some(function (c) { return c && (c.all || c.any); }) };
  if (Array.isArray(when.any)) return { join: "any", items: when.any, nested: when.any.some(function (c) { return c && (c.all || c.any); }) };
  if (Array.isArray(when.all)) return { join: "all", items: when.all, nested: when.all.some(function (c) { return c && (c.all || c.any); }) };
  if (when.field) return { join: "all", items: [when], nested: false };
  return { join: "all", items: [], nested: false };
}

function expCfgValueText(c) {
  const v = c && c.value != null ? c.value : (c && c.match);
  if (Array.isArray(v)) return v.join(", ");
  if (v == null) return "";
  return String(v);
}

function expCfgParseValue(op, raw) {
  const text = String(raw == null ? "" : raw).trim();
  if (op === "in") return text.split(/[,，]/).map(function (s) { return s.trim(); }).filter(Boolean);
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  return text;
}

function expCfgRowHtml(c) {
  const op = (c && c.op) || "eq";
  return "<div class=\"exp-cfg-row\" data-exp-cfg-row>"
    + "<input type=\"text\" data-exp-cfg-field placeholder=\"字段\" value=\"" + esc((c && c.field) || "") + "\" />"
    + "<select data-exp-cfg-op>" + EXP_CFG_OPS.map(function (pair) {
      return "<option value=\"" + pair[0] + "\"" + (op === pair[0] ? " selected" : "") + ">" + pair[1] + "</option>";
    }).join("") + "</select>"
    + "<input type=\"text\" data-exp-cfg-value placeholder=\"比较值\" value=\"" + esc(expCfgValueText(c || {})) + "\" />"
    + "<button type=\"button\" class=\"exp-cfg-remove\" data-exp-cfg-remove aria-label=\"删除条件\">×</button>"
    + "</div>";
}

var expChildSeq = 0;

function makeExpChild(parent) {
  expChildSeq += 1;
  const id = "sub:custom-" + Date.now() + "-" + expChildSeq;
  const label = "新下级";
  const node = leafRule({
    id: id,
    label: label,
    priority: 50,
    exposure_class: (parent.then && parent.then.exposure_class) || parent.label || "",
    sub_class: label,
    rw: { type: "const", value: 1, display: "100%" },
    content: { basis: "待编辑条件" }
  });
  node.question = label + "？";
  node.children = [];
  return node;
}

function addExpChildUnder(node) {
  if (!node) return null;
  if (!Array.isArray(node.children)) node.children = [];
  const child = makeExpChild(node);
  let movedWeight = false;
  if (!node.children.length && node.then && node.then.risk_weight) {
    child.then.risk_weight = node.then.risk_weight;
    if (node.rule_id) child.rule_id = node.rule_id;
    delete node.then;
    delete node.rule_id;
    movedWeight = true;
  }
  const elseIdx = node.children.findIndex(function (item) { return item.otherwise; });
  if (elseIdx >= 0) node.children.splice(elseIdx, 0, child);
  else node.children.push(child);
  node.type = "gate";
  return { child: child, movedWeight: movedWeight };
}

function removeExpChild(node, childId) {
  if (!node || !Array.isArray(node.children)) return false;
  const idx = node.children.findIndex(function (item) { return item.id === childId; });
  if (idx < 0) return false;
  node.children.splice(idx, 1);
  if (!node.children.length) {
    node.type = "leaf";
    if (!node.then) {
      node.then = {
        exposure_class: node.label || "",
        sub_class: node.label || "",
        risk_weight: { type: "const", value: 1, display: "100%" }
      };
    }
  }
  return true;
}

function addChildOnSelected() {
  if (state.expScope === "product") materializeProductExpFlow(state.product);
  let raw = state.selectedExposure ? findRawExpNode(state.selectedExposure) : null;
  if (!raw || (raw.scope !== "category" && raw.scope !== "leaf")) {
    const cats = (activeExpFlow().categories) || [];
    raw = cats[0] ? findRawExpNode(cats[0].id) : null;
  }
  if (!raw || !raw.node) return;
  const added = addExpChildUnder(raw.node);
  if (!added) return;
  markExpCustomized();
  state.selectedExposure = added.child.id;
  state.expNodePopover = true;
  state.expMsg = "已在「" + (raw.node.label || "当前节点") + "」下新增下级。"
    + (added.movedWeight ? "原来的权重写在这个新下级上。" : "");
  render();
}

function renderExpChildrenBlock(sel) {
  const kids = sel.children || [];
  const rows = kids.map(function (kid) {
    return "<div class=\"exp-cfg-row\">"
      + "<button type=\"button\" class=\"btn\" data-exp-child-open=\"" + esc(kid.id) + "\">" + esc(kid.label || kid.id) + "</button>"
      + (kid.otherwise ? "<span class=\"tag\">都不成立</span>" : "<span class=\"tag muted\">条件</span>")
      + "<button type=\"button\" class=\"exp-cfg-remove\" data-exp-child-remove=\"" + esc(kid.id) + "\" aria-label=\"删除下级\">×</button>"
      + "</div>";
  }).join("");
  return "<div class=\"field\"><label class=\"k\">下级</label>"
    + (rows || "<p class=\"exp-cfg-note\">这一级还没有下级。加上之后，权重写在最末一级。</p>")
    + "<button type=\"button\" class=\"btn\" data-exp-add-child style=\"margin-top:6px\">＋ 加一个下级</button></div>";
}

function renderExpCfgForm(logic, sel) {
  const pack = expCfgPack(logic.when);
  const hasKids = !!(sel.children && sel.children.length);
  const leaf = sel.kind === "subclass" && !hasKids;
  const weight = leaf && logic.then ? (logic.then.risk_weight == null ? "" : String(logic.then.risk_weight)) : "";
  const plainWeight = /^[\d.]+%$/.test(weight) || weight.indexOf("交易对手") >= 0 || weight.indexOf("较大值") >= 0;
  const stepField = (sel.role === "crm" || sel.role === "assessment") && !plainWeight;
  return "<div class=\"exp-cfg\" id=\"expCfg\">"
    + (sel.summary ? "<p class=\"exp-cfg-note\">" + esc(sel.summary) + "</p>" : "")
    + "<div class=\"field\"><label class=\"k\">名称</label>"
    + "<input type=\"text\" data-exp-cfg-label value=\"" + esc(logic.label || "") + "\" /></div>"
    + "<div class=\"field\"><label class=\"k\">问句</label>"
    + "<input type=\"text\" data-exp-cfg-question value=\"" + esc(logic.question || "") + "\" /></div>"
    + "<div class=\"field\"><label class=\"k\">条件关系</label>"
    + "<select data-exp-cfg-join>"
    + "<option value=\"all\"" + (pack.join === "all" ? " selected" : "") + ">并且 all · 每条都要成立</option>"
    + "<option value=\"any\"" + (pack.join === "any" ? " selected" : "") + ">或者 any · 成立一条即可</option>"
    + "</select></div>"
    + (pack.nested
      ? "<p class=\"exp-cfg-note\">条件里还有嵌套的 all / any，请直接改下面的 JSON。改名称、问句和权重仍会写回 JSON。</p>"
      : ("<div class=\"field\"><label class=\"k\">条件</label><div id=\"expCfgConds\">"
        + (pack.items.length ? pack.items.map(expCfgRowHtml).join("") : expCfgRowHtml({}))
        + "</div>"
        + "<button type=\"button\" class=\"btn\" data-exp-cfg-add style=\"margin-top:6px\">＋ 加一条条件</button></div>"))
    + "<label class=\"exp-cfg-check\"><input type=\"checkbox\" data-exp-cfg-otherwise" + (logic.otherwise ? " checked" : "") + " /> 本层都不成立时走这里</label>"
    + (leaf
      ? ("<div class=\"field\"><label class=\"k\">" + (stepField ? "这一步" : "权重") + "</label>"
        + "<input type=\"text\" data-exp-cfg-weight value=\"" + esc(weight) + "\" placeholder=\"" + (stepField ? "这一步怎么算" : "如 250% 或 按交易对手") + "\" /></div>"
        + (stepField ? "<p class=\"exp-cfg-note\">" + (sel.role === "assessment" ? "选定一个评级后，用它走原来的分类。" : "覆盖部分按这里算，未覆盖部分沿用原来的权重。") + "</p>" : ""))
      : (hasKids ? "<p class=\"exp-cfg-note\">" + (sel.summary ? "点开下级看每一种算法。" : "这一级已经有下级，权重写在下级里。") + "</p>" : ""))
    + renderExpChildrenBlock(sel)
    + "</div>";
}

function expCfgReadForm() {
  const root = document.getElementById("expCfg");
  if (!root || !expCfgDraft) return;
  const draft = expCfgDraft;
  const labelEl = root.querySelector("[data-exp-cfg-label]");
  const questionEl = root.querySelector("[data-exp-cfg-question]");
  const joinEl = root.querySelector("[data-exp-cfg-join]");
  const otherwiseEl = root.querySelector("[data-exp-cfg-otherwise]");
  const weightEl = root.querySelector("[data-exp-cfg-weight]");
  if (labelEl) draft.label = labelEl.value;
  if (questionEl) draft.question = questionEl.value;
  if (otherwiseEl) draft.otherwise = !!otherwiseEl.checked;
  if (weightEl) {
    draft.then = draft.then || {};
    draft.then.risk_weight = weightEl.value.trim();
    if (!draft.then.sub_class) draft.then.sub_class = draft.label;
  }
  const condRoot = document.getElementById("expCfgConds");
  if (condRoot && joinEl) {
    const items = [];
    condRoot.querySelectorAll("[data-exp-cfg-row]").forEach(function (row) {
      const field = (row.querySelector("[data-exp-cfg-field]").value || "").trim();
      const op = row.querySelector("[data-exp-cfg-op]").value || "eq";
      const value = expCfgParseValue(op, row.querySelector("[data-exp-cfg-value]").value);
      items.push({ field: field, op: op, value: value });
    });
    draft.when = joinEl.value === "any" ? { any: items } : { all: items };
  }
  const ta = document.getElementById("expNodeJson");
  if (ta) ta.value = prettyJson(draft);
}

function expCfgWriteForm() {
  const root = document.getElementById("expCfg");
  const ta = document.getElementById("expNodeJson");
  if (!root || !ta) return;
  let parsed;
  try { parsed = JSON.parse(ta.value); } catch (e) { return; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
  expCfgDraft = parsed;
  const labelEl = root.querySelector("[data-exp-cfg-label]");
  const questionEl = root.querySelector("[data-exp-cfg-question]");
  const joinEl = root.querySelector("[data-exp-cfg-join]");
  const otherwiseEl = root.querySelector("[data-exp-cfg-otherwise]");
  const weightEl = root.querySelector("[data-exp-cfg-weight]");
  if (labelEl && parsed.label != null) labelEl.value = String(parsed.label);
  if (questionEl && parsed.question != null) questionEl.value = String(parsed.question);
  if (otherwiseEl) otherwiseEl.checked = !!parsed.otherwise;
  if (weightEl && parsed.then && parsed.then.risk_weight != null) weightEl.value = String(parsed.then.risk_weight);
  const pack = expCfgPack(parsed.when);
  if (joinEl) joinEl.value = pack.join === "any" ? "any" : "all";
  const condRoot = document.getElementById("expCfgConds");
  if (condRoot && !pack.nested) {
    const items = pack.items.length ? pack.items : [{}];
    condRoot.innerHTML = items.map(expCfgRowHtml).join("");
  }
}

function renderExpNodePopover(sel) {
  if (!sel || !state.expNodePopover) return "";
  const name = sel.question || sel.label || sel.id || "节点";
  const logic = nodeLogicPopoverJson(sel);
  const kindLabel = sel.role === "crm" ? "缓释" : (sel.role === "assessment" ? "取值" : ({
    process: "起点", category: "判定层", subclass: "细分",
    rule: sel.id === "step:route" ? "路由" : "RWA", result: "权重/结果", route: "产品线路",
    onbook: "表内线", ccf: "表外线", crm: "缓释拆分"
  }[sel.kind] || sel.kind || ""));
  const hasCalc = !!(logic.calc && (logic.calc.ead || logic.calc.rwa || (logic.calc.lines && logic.calc.lines.length)));
  const purpose = logic.purpose || "";
  const calcBlock = hasCalc
    ? ("<div class=\"exp-float-calc\">"
      + "<p class=\"exp-float-sec-label\">① 公式 calc（程序可读）</p>"
      + "<p class=\"exp-float-sec-desc\">"
      + (sel.id === "step:rwa"
        ? "表内、表外各用自己的汇总式。风险暴露在分线时已经算完，这里只乘拆分后的权重。"
        : "引擎按此 JSON 计算。可以直接改，保存后写回公式。")
      + "</p>"
      + ((logic.calc.lines || []).map(function (line) {
        return "<p class=\"exp-float-calc-line\">" + esc(line) + "</p>";
      }).join(""))
      + (logic.calc.ead && logic.calc.ead.expr
        ? "<p class=\"exp-float-calc-line\">ead = " + esc(logic.calc.ead.expr) + "</p>" : "")
      + (logic.calc.rwa && logic.calc.rwa.expr
        ? "<p class=\"exp-float-calc-line\">rwa = " + esc(logic.calc.rwa.expr) + "</p>" : "")
      + (logic.calc.risk_weight && logic.calc.risk_weight.display
        ? "<p class=\"exp-float-calc-line\">risk_weight = " + esc(String(logic.calc.risk_weight.display)) + "</p>" : "")
      + "<textarea id=\"expNodeCalcJson\" class=\"exp-json-edit\" spellcheck=\"false\">"
      + esc(prettyJson(logic.calc)) + "</textarea></div>")
    : "";
  const rest = Object.assign({}, logic);
  delete rest.calc;
  delete rest.purpose;
  const configurable = sel.kind === "category" || sel.kind === "subclass";
  expCfgDraft = configurable ? rest : null;
  const cfgBlock = configurable ? renderExpCfgForm(rest, sel) : "";
  const logicTitle = configurable
    ? "JSON"
    : (sel.id === "step:route"
    ? "② 路由回执"
    : (sel.kind === "rule"
    ? "② 两条线的汇总"
    : (sel.id === "res:rw"
      ? "② 定权逻辑"
      : (sel.kind === "onbook" || sel.kind === "ccf"
        ? "② 分线公式"
        : (sel.kind === "result"
          ? "② 路由回执"
          : "② 节点逻辑（判定 / 路由）")))));
  const logicDesc = configurable
    ? "改上面的配置，这里会跟着变；改这里，上面的配置也会跟着变。保存后写回这棵树。"
    : (sel.id === "step:route" || (sel.kind === "result" && sel.id !== "res:rw")
    ? "可以直接改这份回执。保存后按你写的执行；要回到自动校验，点恢复自动。"
    : (sel.kind === "rule"
    ? "可以直接改汇总公式，保存后写回。"
    : (sel.id === "res:rw"
      ? "可以直接改定权结果，保存后写回当前规则。"
      : (sel.kind === "onbook" || sel.kind === "ccf"
        ? "可以直接改表内或表外公式，保存后写回计算模板。"
        : (sel.kind === "result"
          ? "可以直接改这份回执，保存后按你写的执行。"
          : "可以直接改 when / then / 权重。保存后写回这条规则。")))));
  const routeStep = findRawExpNode("step:route");
  const manual = !!(routeStep && routeStep.node && routeStep.node.manual_decision);
  return "<aside class=\"exp-float" + (configurable ? " cfg-open" : "") + "\" role=\"dialog\" aria-label=\"节点详情\">"
    + "<div class=\"exp-float-head\">"
    + "<div><strong>" + esc(name) + "</strong>"
    + (purpose ? "<p class=\"exp-float-sec-desc\" style=\"margin-top:6px\">" + esc(purpose) + "</p>" : "")
    + "<div class=\"tags\"><span class=\"tag accent\">" + esc(kindLabel) + "</span>"
    + (hasCalc ? "<span class=\"tag ok\">含公式</span>" : "")
    + (sel.kind === "result" ? "<span class=\"tag\">只分发</span>" : "")
    + "</div></div>"
    + "<button type=\"button\" class=\"exp-float-close\" data-exp-popover-close aria-label=\"关闭\">×</button>"
    + "</div>"
    + "<div class=\"exp-float-body\">"
    + (cfgBlock
      ? ("<div class=\"exp-float-sec\"><p class=\"exp-float-sec-label\">配置</p>"
        + "<p class=\"exp-float-sec-desc\">改这里会写进下面的 JSON。保存后画布跟着变。</p>"
        + cfgBlock + "</div>")
      : "")
    + calcBlock
    + "<div class=\"exp-float-sec\">"
    + "<p class=\"exp-float-sec-label\">" + esc(logicTitle) + "</p>"
    + "<p class=\"exp-float-sec-desc\">" + esc(logicDesc) + "</p>"
    + "<textarea id=\"expNodeJson\" class=\"exp-json-edit\" spellcheck=\"false\">" + esc(prettyJson(rest)) + "</textarea>"
    + (state.expJsonErr ? "<p class=\"exp-json-err\" id=\"expNodeJsonErr\">" + esc(state.expJsonErr) + "</p>" : "<p class=\"exp-json-err\" id=\"expNodeJsonErr\"></p>")
    + "<div class=\"exp-json-actions\">"
    + "<button type=\"button\" class=\"btn btn-primary\" data-exp-json-save>" + (configurable ? "保存到分类树" : "保存 JSON") + "</button>"
    + (manual ? "<button type=\"button\" class=\"btn\" data-exp-json-reset>恢复自动校验</button>" : "")
    + "</div>"
    + "</div>"
    + "</div></aside>";
}

function prettyJson(obj) {
  try { return JSON.stringify(obj, null, 2); } catch (e) { return String(obj); }
}

function flattenMatch(match) {
  if (!match) return [];
  if (Array.isArray(match)) return match;
  if (Array.isArray(match.all)) return match.all;
  if (Array.isArray(match.any)) return match.any;
  return [match];
}

function collectLogicFields(v, out) {
  if (v == null) return;
  if (Array.isArray(v)) {
    v.forEach((x) => collectLogicFields(x, out));
    return;
  }
  if (typeof v !== "object") return;
  if (typeof v.field === "string") out[v.field] = true;
  if (typeof v.var === "string") out[v.var] = true;
  if (v.lookup && typeof v.key === "string") out[v.key] = true;
  Object.keys(v).forEach((k) => {
    if (k === "display" || k === "label" || k === "type" || k === "id" || k === "note") return;
    collectLogicFields(v[k], out);
  });
}

function formulaCalcText(f) {
  if (f == null) return null;
  if (typeof f === "string") return f;
  if (f.display) return f.display;
  if (f.ref) return "引用 " + f.ref;
  if (f.op === "sub" && f.args) return (f.args.map(formulaCalcText).join(" − "));
  if (f.op === "mul" && f.args) return (f.args.map(formulaCalcText).join(" × "));
  if (f.op === "sum" && f.args) return "Σ(" + f.args.map(formulaCalcText).join(", ") + ")";
  if (f.var) return f.var;
  if (f.lookup) return "lookup(" + f.lookup + ", " + f.key + ")";
  try { return JSON.stringify(f); } catch (e) { return String(f); }
}

function rwLogicText(rw) {
  if (rw == null) return null;
  if (typeof rw === "string" || typeof rw === "number") return String(rw);
  if (rw.display) return rw.display;
  if (rw.type === "const" && rw.value != null) return ((rw.value * 100) + "%");
  if (rw.type === "lookup") return "lookup(" + rw.table + ", " + rw.key + ")";
  if (rw.type === "formula") return formulaCalcText(rw.expr) || rw.display;
  return formulaCalcText(rw);
}

/** 用户可读的逻辑 JSON：字段、判定、公式与怎么算；不含样式 / 画布信息 */
function logicViewOfFlow(flow) {
  if (!flow) return {};
  if (flow.mode === "ref" || flow.ref === true) {
    return {
      mode: "ref",
      based_on: flow.based_on || BASE_EXP_TEMPLATE.id,
      note: "引用通用流程的字段判定与计算公式",
      resolves_to: logicViewOfFlow(flow.resolves_to || BASE_EXP_TEMPLATE)
    };
  }
  const formulas = {};
  const allFields = {};
  Object.keys(flow.formulas || {}).forEach((k) => {
    const f = flow.formulas[k];
    const fields = {};
    collectLogicFields(f, fields);
    Object.keys(fields).forEach((x) => { allFields[x] = true; });
    formulas[k] = {
      calc: formulaCalcText(f),
      fields: Object.keys(fields),
      op: f.op,
      args: f.args
    };
  });
  const layers = (flow.categories || []).map((cat) => {
    collectLogicFields(cat.match, allFields);
    return {
      id: cat.id,
      label: cat.label,
      question: cat.question,
      when: matchForLogic(cat.match),
      if_yes: (function mapKids(list) {
        return (list || []).map(function (ch) {
          collectLogicFields(ch.match, allFields);
          const then = ch.then || {};
          const row = {
            id: ch.id,
            label: ch.label,
            rule_id: ch.rule_id || ch.rule,
            priority: ch.priority,
            otherwise: ch.otherwise || undefined,
            when: matchForLogic(ch.match),
            then: {
              exposure_class: then.exposure_class || "",
              sub_class: then.sub_class || ch.label || "",
              risk_weight: rwLogicText(then.risk_weight) || ch.rw || null
            }
          };
          if (ch.children && ch.children.length) row.if_yes = mapKids(ch.children);
          return row;
        });
      })(cat.children)
    };
  });
  return {
    id: flow.id,
    name: flow.name,
    meta: flow.meta || null,
    fields_used: Object.keys(allFields).sort(),
    formulas: formulas,
    books: (flow.books || []).map((s) => ({
      id: s.id,
      kind: s.kind,
      label: s.label,
      note: s.note || "",
      when: s.when || null,
      formula_ref: s.formula_ref || null
    })),
    layers: layers,
    tail: (flow.tail || []).map((s) => ({
      id: s.id,
      kind: s.kind,
      label: s.label,
      note: s.note || "",
      formula_ref: s.formula_ref || null
    }))
  };
}

function logicViewOfOverview(master) {
  const m = master || buildOverviewMasterJson();
  return {
    id: m.id,
    name: m.name,
    note: m.note || "识别产品后进入对应线路的判定与公式",
    fields_used: ["product_type"],
    routes: (m.routes || []).map((r) => ({
      product: r.label,
      product_id: r.product_id,
      when: flattenMatch(r.match),
      flow: r.flow && r.flow.mode === "ref"
        ? { mode: "ref", based_on: r.flow.based_on, note: "使用通用流程的字段与公式" }
        : { mode: "override", flow_id: r.flow && r.flow.flow_id, note: "本产品独立公式" }
    }))
  };
}

function isLogicFlowJson(obj) {
  return !!(obj && Array.isArray(obj.layers) && !Array.isArray(obj.categories));
}

function parseRwLogic(text) {
  if (text == null) return { type: "unspecified", display: "权重表未列明" };
  if (typeof text === "object") return text;
  const s = String(text).trim();
  if (!s || s.indexOf("未列明") >= 0 || s.indexOf("未单列") >= 0) return { type: "unspecified", display: s || "权重表未列明" };
  if (s.indexOf("抵押品价值") >= 0) {
    const picked = s.match(/([\d.]+)\s*%/);
    return { type: "haircut", display: s, factor: picked ? parseFloat(picked[1]) / 100 : null };
  }
  if (s.indexOf("按工具拆分") >= 0 || s.indexOf("覆盖部分") >= 0 || s.indexOf("未覆盖部分") >= 0) return { type: "split", display: s };
  if (s.indexOf("用该评级") >= 0 || s.indexOf("较高权重") >= 0 || s.indexOf("较低") >= 0 || s.indexOf("按评级个数") >= 0) {
    return { type: "assessment", display: s };
  }
  if (s.indexOf("已得权重") >= 0) {
    const picked = s.match(/([\d.]+)\s*%/);
    return { type: "max_field", display: s, with: picked ? parseFloat(picked[1]) / 100 : null };
  }
  if (s.indexOf("交易对手") >= 0 || s.indexOf("较大值") >= 0) return rwFollow(s);
  const m = s.match(/^([\d.]+)\s*%?$/);
  if (m) {
    const n = parseFloat(m[1]);
    const rate = n > 1.5 && s.indexOf("%") >= 0 ? n / 100 : (n > 3 ? n / 100 : n);
    return rwConst(rate, s.indexOf("%") >= 0 ? s : ((rate * 100) + "%"));
  }
  if (s.indexOf("lookup(") === 0) return { type: "lookup", display: s };
  return { type: "unspecified", display: s };
}

function matchForLogic(match) {
  if (!match) return { all: [] };
  if (Array.isArray(match)) return { all: match };
  if (Array.isArray(match.all) || Array.isArray(match.any)) return match;
  return { all: [match] };
}

function layerChildToNode(ch) {
  const then = ch.then || {};
  const kids = ch.if_yes || ch.children || [];
  const node = {
    id: ch.id,
    type: kids.length ? "gate" : "leaf",
    label: ch.label,
    question: ch.question,
    priority: ch.priority == null ? 50 : ch.priority,
    rule_id: ch.rule_id || ch.rule,
    otherwise: ch.otherwise || undefined,
    match: matchForLogic(ch.when || ch.match),
    children: kids.map(layerChildToNode)
  };
  if (!kids.length) {
    node.then = {
      exposure_class: then.exposure_class || "",
      sub_class: then.sub_class || ch.label || "",
      risk_weight: parseRwLogic(then.risk_weight)
    };
    node.formula = (ch.calc && ch.calc.detail) || ch.formula || null;
    node.content = {};
  }
  return node;
}

function logicJsonToFlow(parsed, fallback) {
  const base = fallback ? cloneExpFlow(fallback) : cloneExpFlow(BASE_EXP_TEMPLATE);
  base.id = parsed.id || base.id;
  base.name = parsed.name || base.name;
  base.ref = false;
  base.customized = true;
  if (parsed.formulas && typeof parsed.formulas === "object") {
    base.formulas = base.formulas || {};
    Object.keys(parsed.formulas).forEach((k) => {
      const src = parsed.formulas[k] || {};
      if (src.op || src.args) {
        base.formulas[k] = {
          op: src.op,
          args: src.args,
          display: src.calc || src.display || (base.formulas[k] && base.formulas[k].display)
        };
      } else if (src.calc || src.display) {
        base.formulas[k] = Object.assign({}, base.formulas[k] || {}, {
          display: src.calc || src.display
        });
      }
    });
  }
  if (Array.isArray(parsed.layers)) {
    base.categories = parsed.layers.map((layer) => ({
      id: layer.id,
      type: "gate",
      label: layer.label,
      question: layer.question,
      match: matchForLogic(layer.when || layer.match),
      on_match: "expand_children",
      on_miss: "next_layer",
      children: (layer.if_yes || layer.children || []).map(layerChildToNode)
    }));
  }
  return base;
}

function markExpCustomized() {
  if (state.expScope === "base") return;
  const flow = materializeProductExpFlow(state.product);
  if (flow) {
    flow.customized = true;
    flow.ref = false;
  }
}

/* 已有产品默认引用基础流程（不立刻深拷贝） */
productKeys().forEach((k) => {
  if (!PRODUCTS[k].expFlow) PRODUCTS[k].expFlow = makeExpFlowRef();
});
