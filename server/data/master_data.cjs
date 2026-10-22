(function (global) {
/**
 * 系统主数据：司法管辖区、监管规则版本、监管条款库、产品类型与标准字段、
 * 原始字段映射、EAD 计算规则。全部为【模拟数据】。
 *
 * 业务链路：监管规则版本 → 产品标准字段 → 原始字段映射 → 通用暴露分类规则
 *           → 产品专属暴露分类规则 → 表内/表外 EAD 规则 → 风险权重 → RWA
 */

/* ============================ 司法管辖区 ============================ */
const JURISDICTIONS = [
  { code: 'MO', label: '澳门', regulator: '【模拟】澳门金融管理局 (AMCM)', currency: 'MOP', currencyLabel: '澳门元' },
  { code: 'CN', label: '内地', regulator: '【模拟】国家金融监督管理总局', currency: 'CNY', currencyLabel: '人民币' },
  { code: 'HK', label: '香港', regulator: '【模拟】香港金融管理局 (HKMA)', currency: 'HKD', currencyLabel: '港元' },
];

/* ========================== 监管规则版本 =========================== */
const RULE_VERSIONS = [
  {
    id: 'rv-mo-2026-1', jurisdiction: 'MO', version: 'MO-SA-2026.1',
    name: '澳门资本充足率监管规则（权重法）', ruleType: '资本充足率',
    effectiveFrom: '2026-01-01', effectiveTo: null, status: 'published',
    institution: '澳门分行（法人）', rulesetFile: 'ruleset_cn_mo.json',
    publishedAt: '2025-12-18 09:30', author: '规则管理员 · 陈敏',
    changelog: '在 2025 版基础上调整商用房地产依赖现金流档位的权重下限，并对齐资产担保债券的资产池合格条件。',
  },
  {
    id: 'rv-mo-2025-2', jurisdiction: 'MO', version: 'MO-SA-2025.2',
    name: '澳门资本充足率监管规则（权重法）· 历史版', ruleType: '资本充足率',
    effectiveFrom: '2025-07-01', effectiveTo: '2025-12-31', status: 'superseded',
    institution: '澳门分行（法人）', rulesetFile: 'ruleset_cn_mo.json',
    publishedAt: '2025-06-20 14:10', author: '规则管理员 · 陈敏',
    changelog: '历史版本，已被 MO-SA-2026.1 取代。历史计量批次仍按本版规则还原。',
  },
  {
    id: 'rv-mo-2026-draft', jurisdiction: 'MO', version: 'MO-SA-2026.2-draft',
    name: '澳门资本充足率监管规则（征求意见稿）', ruleType: '资本充足率',
    effectiveFrom: '2026-07-01', effectiveTo: null, status: 'draft',
    institution: '澳门分行（法人）', rulesetFile: 'ruleset_cn_mo.json',
    publishedAt: '—', author: '规则管理员 · 陈敏',
    changelog: '草稿：拟新增本地中小企业专项分类，尚在征求意见，未发布。',
  },
  {
    id: 'rv-cn-2026-1', jurisdiction: 'CN', version: 'CN-SA-2026.1',
    name: '内地资本管理办法（权重法）', ruleType: '资本充足率',
    effectiveFrom: '2026-01-01', effectiveTo: null, status: 'published',
    institution: '总行（法人）', rulesetFile: 'ruleset_cn.json',
    publishedAt: '2025-11-30 10:00', author: '规则管理员 · 李伟',
    changelog: '首次发布，建立内地风险暴露分类与风险权重规则基线。',
  },
  {
    id: 'rv-cn-2026-review', jurisdiction: 'CN', version: 'CN-SA-2026.1-review',
    name: '内地资本管理办法（修订送审稿）', ruleType: '资本充足率',
    effectiveFrom: '2026-10-01', effectiveTo: null, status: 'reviewing',
    institution: '总行（法人）', rulesetFile: 'ruleset_cn.json',
    publishedAt: '—', author: '规则管理员 · 李伟',
    changelog: '审核中：投资级公司认定条件拟收紧，等待风险条线会签。',
  },
  {
    id: 'rv-hk-2025-2', jurisdiction: 'HK', version: 'HK-SA-2025.2',
    name: '香港银行业（资本）规则（权重法）', ruleType: '资本充足率',
    effectiveFrom: '2025-07-01', effectiveTo: null, status: 'published',
    institution: '香港分行', rulesetFile: 'ruleset_hk.json',
    publishedAt: '2025-06-15 16:40', author: '规则管理员 · 黄嘉怡',
    changelog: '按当地口径维护监管零售与中小企业权重，独立于内地与澳门版本。',
  },
  {
    id: 'rv-hk-2024-1', jurisdiction: 'HK', version: 'HK-SA-2024.1',
    name: '香港银行业（资本）规则（权重法）· 已停用', ruleType: '资本充足率',
    effectiveFrom: '2024-01-01', effectiveTo: '2025-06-30', status: 'disabled',
    institution: '香港分行', rulesetFile: 'ruleset_hk.json',
    publishedAt: '2023-12-20 11:20', author: '规则管理员 · 黄嘉怡',
    changelog: '已停用，仅供历史批次追溯参考。',
  },
];

const RULE_TYPES = ['资本充足率', '信用风险', '风险暴露分类', '风险权重', '表内 EAD', '表外 EAD'];
const RULE_STATUS = {
  draft: { label: '草稿', tone: 'muted' },
  reviewing: { label: '审核中', tone: 'warn' },
  published: { label: '已发布', tone: 'ok' },
  superseded: { label: '已被取代', tone: 'muted' },
  disabled: { label: '已停用', tone: 'danger' },
};

/* =========================== 监管条款库 ============================ */
/* 全部标注为模拟条款，不得作为真实监管依据。 */
const CLAUSES = [
  { id: 'CL-MO-015', jurisdiction: 'MO', doc: '【模拟】澳门AMCM资本充足率指引', docVersion: '2026版',
    clause: '第15条', title: '主权及中央银行风险暴露',
    text: '【模拟条款原文】对澳门特别行政区政府及中央银行的风险暴露，风险权重为 0%。对其他主权国家或经济实体的风险暴露，按其外部信用评级确定风险权重。',
    scope: '所有产品的对主权及中央银行债权', effectiveFrom: '2026-01-01', source: '【模拟】AMCM 2026 年第 3 号通告附件',
    referencedBy: ['sovereign', 'sovereign_domestic', 'sovereign_foreign_aaa', 'sovereign_foreign_a', 'sovereign_foreign_bbb', 'sovereign_foreign_other'] },
  { id: 'CL-MO-016', jurisdiction: 'MO', doc: '【模拟】澳门AMCM资本充足率指引', docVersion: '2026版',
    clause: '第16条', title: '公共部门实体风险暴露',
    text: '【模拟条款原文】对境内公共部门实体的债权，风险权重为 50%；对境外公共部门实体的债权，风险权重为 100%，另有规定的从其规定。',
    scope: '所有产品的对公共部门实体债权', effectiveFrom: '2026-01-01', source: '【模拟】AMCM 2026 年第 3 号通告附件',
    referencedBy: ['pse', 'pse_domestic', 'pse_overseas'] },
  { id: 'CL-MO-018', jurisdiction: 'MO', doc: '【模拟】澳门AMCM资本充足率指引', docVersion: '2026版',
    clause: '第18条', title: '多边开发银行风险暴露',
    text: '【模拟条款原文】对合格多边开发银行的债权，风险权重为 0%。合格名单由监管机构另行公布，并在名单更新时同步维护。',
    scope: '所有产品的对多边开发银行债权', effectiveFrom: '2026-01-01', source: '【模拟】AMCM 2026 年第 3 号通告附件',
    referencedBy: ['mdb_qualified'] },
  { id: 'CL-MO-022', jurisdiction: 'MO', doc: '【模拟】澳门AMCM资本充足率指引', docVersion: '2026版',
    clause: '第22条', title: '商业银行风险暴露',
    text: '【模拟条款原文】对商业银行的债权，按是否满足最低资本要求、其他各级资本要求及外部审计意见划分为 A+、A、B、C 四档；C 档风险权重为 150%。原始期限三个月以内，或跨境货物贸易且原始期限不超过六个月的，适用短期风险权重。',
    scope: '所有产品的对商业银行债权', effectiveFrom: '2026-01-01', source: '【模拟】AMCM 2026 年第 3 号通告附件',
    referencedBy: ['fi_bank', 'fi_bank_c', 'fi_bank_tier1', 'fi_bank_tier1_short', 'fi_bank_tier1_long', 'fi_bank_tier2', 'fi_bank_tier2_short', 'fi_bank_tier2_long', 'fi_bank_exhaust'] },
  { id: 'CL-MO-030', jurisdiction: 'MO', doc: '【模拟】澳门AMCM资本充足率指引', docVersion: '2026版',
    clause: '第30条', title: '居住用房地产风险暴露',
    text: '【模拟条款原文】以居住用房地产设定抵押、且还款不实质依赖该房地产现金流的债权，按贷款价值比分档确定风险权重，比例越低权重越低。商住两用房地产归入商用房地产处理。',
    scope: '对公贷款、个人贷款的房地产抵押类债权', effectiveFrom: '2026-01-01', source: '【模拟】AMCM 2026 年第 3 号通告附件',
    referencedBy: ['re_residential', 're_residential_ltv_le50', 're_residential_ltv_le60', 're_residential_ltv_le80', 're_residential_ltv_le90', 're_residential_ltv_gt90'] },
  { id: 'CL-MO-031', jurisdiction: 'MO', doc: '【模拟】澳门AMCM资本充足率指引', docVersion: '2026版',
    clause: '第31条', title: '商用房地产风险暴露',
    text: '【模拟条款原文】以商用房地产设定抵押的债权，区分还款是否实质依赖该房地产现金流。实质依赖且贷款价值比高于 60% 但不超过 80% 的，风险权重取 90% 与该交易对手普通债权风险权重的较大者。',
    scope: '对公贷款、个人贷款的商用房地产抵押类债权', effectiveFrom: '2026-01-01', source: '【模拟】AMCM 2026 年第 3 号通告附件',
    referencedBy: ['re_commercial', 're_commercial_dep_lt60', 're_commercial_dep_le80', 're_commercial_dep_gt80', 're_commercial_nondep_lt60', 're_commercial_nondep_gt60', 're_commercial_exhaust'] },
  { id: 'CL-MO-036', jurisdiction: 'MO', doc: '【模拟】澳门AMCM资本充足率指引', docVersion: '2026版',
    clause: '第36条', title: '已违约风险暴露',
    text: '【模拟条款原文】债务人逾期超过 90 天，或不处置抵押品就可能无法全额偿还的，认定为已违约。损失准备占账面价值比例不低于 20% 的，风险权重为 100%；低于 20% 的，风险权重为 150%。',
    scope: '所有产品', effectiveFrom: '2026-01-01', source: '【模拟】AMCM 2026 年第 3 号通告附件',
    referencedBy: ['defaulted', 'defaulted_provision_ge20', 'defaulted_provision_lt20'] },
  { id: 'CL-MO-042', jurisdiction: 'MO', doc: '【模拟】澳门AMCM资本充足率指引', docVersion: '2026版',
    clause: '第42条', title: '监管零售风险暴露',
    text: '【模拟条款原文】对单一自然人或小微企业的债权，对单一债务人风险暴露不超过 1000 万元，且占全行信用风险暴露比例不超过 0.5% 的，认定为监管零售风险暴露，风险权重为 75%。',
    scope: '个人贷款、小微企业贷款', effectiveFrom: '2026-01-01', source: '【模拟】AMCM 2026 年第 3 号通告附件',
    referencedBy: ['regulatory_retail'] },
  { id: 'CL-MO-045', jurisdiction: 'MO', doc: '【模拟】澳门AMCM资本充足率指引', docVersion: '2026版',
    clause: '第45条', title: '公司风险暴露',
    text: '【模拟条款原文】公司风险暴露中，符合中小企业划型标准、最近一年营业收入不超过 3 亿元、对单一债务人风险暴露不超过 1000 万元的，适用中小企业权重。同时满足十项投资级认定条件的，适用投资级公司权重。',
    scope: '对公贷款、债券投资', effectiveFrom: '2026-01-01', source: '【模拟】AMCM 2026 年第 3 号通告附件',
    referencedBy: ['corporate_general', 'corporate_sme', 'corporate_ig', 'corporate_general_other'] },
  { id: 'CL-MO-050', jurisdiction: 'MO', doc: '【模拟】澳门AMCM资本充足率指引', docVersion: '2026版',
    clause: '第50条', title: '资产担保债券',
    text: '【模拟条款原文】同时满足资产池仅含合格资产、资产池名义价值与未偿还债券名义价值之比不低于 110%、至少每半年可取得披露信息三项条件的，为合格资产担保债券。不合格的，按交易对手普通债权确定权重。',
    scope: '债券投资', effectiveFrom: '2026-01-01', source: '【模拟】AMCM 2026 年第 3 号通告附件',
    referencedBy: ['covered_bond', 'covered_bond_qualified', 'covered_bond_rw_same_as_counterparty'] },
  { id: 'CL-MO-060', jurisdiction: 'MO', doc: '【模拟】澳门AMCM资本充足率指引', docVersion: '2026版',
    clause: '第60条', title: '表内风险暴露 EAD',
    text: '【模拟条款原文】表内风险暴露的违约风险暴露等于账面余额扣除已计提的损失准备后的金额。',
    scope: '所有表内业务', effectiveFrom: '2026-01-01', source: '【模拟】AMCM 2026 年第 3 号通告附件', referencedBy: [] },
  { id: 'CL-MO-064', jurisdiction: 'MO', doc: '【模拟】澳门AMCM资本充足率指引', docVersion: '2026版',
    clause: '第64条', title: '表外风险暴露 EAD',
    text: '【模拟条款原文】表外项目的违约风险暴露等于表外余额乘以相应的信用转换系数，再加上已计入表内的部分。不同业务品种的信用转换系数按其性质确定。',
    scope: '表外授信及承诺', effectiveFrom: '2026-01-01', source: '【模拟】AMCM 2026 年第 3 号通告附件', referencedBy: [] },
  { id: 'CL-CN-015', jurisdiction: 'CN', doc: '【模拟】商业银行资本管理办法', docVersion: '2026版',
    clause: '第十五条', title: '风险暴露分类与权重',
    text: '【模拟条款原文】商业银行应按本办法规定的分类标准划分信用风险暴露，并按对应的风险权重计量风险加权资产。',
    scope: '全部信用风险暴露', effectiveFrom: '2026-01-01', source: '【模拟】附件2 权重法风险权重表',
    referencedBy: ['sovereign', 'fi_bank', 'corporate_general'] },
  { id: 'CL-HK-020', jurisdiction: 'HK', doc: '【模拟】香港银行业（资本）规则', docVersion: '2025版',
    clause: '第20条', title: '监管零售组合',
    text: '【模拟条款原文】符合监管零售组合认定标准的风险暴露，风险权重为 75%。',
    scope: '个人贷款、中小企业贷款', effectiveFrom: '2025-07-01', source: '【模拟】香港金管局规则附件', referencedBy: ['regulatory_retail'] },
];

/* ========================== 产品类型管理 =========================== */
const PRODUCT_TYPES = [
  { code: 'corp_loan', label: '对公贷款', icon: '企', color: '#2563eb',
    desc: '向企业、事业单位发放的贷款，含流动资金贷款、项目贷款、房地产开发贷款。',
    ruleVersion: 'MO-SA-2026.1', onboarding: 'column',
    sampleCount: 12, system: 'CL-D-101（信贷核心系统）' },
  { code: 'personal_loan', label: '个人贷款', icon: '个', color: '#0891b2',
    desc: '向自然人发放的贷款，含个人经营性贷款、个人消费贷款、住房按揭。',
    ruleVersion: 'MO-SA-2026.1', onboarding: 'column', sampleCount: 6, system: 'CL-D-101（信贷核心系统）' },
  { code: 'bond', label: '债券投资', icon: '债', color: '#7c3aed',
    desc: '自营账户持有的债券，含国债、金融债、企业债、资产担保债券。',
    ruleVersion: 'MO-SA-2026.1', onboarding: 'column', sampleCount: 4, system: 'IB-D-001（投资业务系统）' },
  { code: 'ib_call', label: '同业活期', icon: '活', color: '#059669',
    desc: '存放同业的活期款项，按整个存放期分类，而非按到期日分类。',
    ruleVersion: 'MO-SA-2026.1', onboarding: 'column', sampleCount: 3, system: 'IB-D-001（投资业务系统）' },
  { code: 'ib_time', label: '同业定期', icon: '定', color: '#0d9488',
    desc: '存放同业的定期款项，按整个存放期分类，不是按到期日。容易和「同业活期」搞混。',
    ruleVersion: 'MO-SA-2026.1', onboarding: 'column', sampleCount: 3, system: 'IB-D-001（投资业务系统）' },
  { code: 'due_from_bank', label: '存放同业', icon: '存', color: '#65a30d',
    desc: '212、222 科目下的存放同业款项，按存放期长短适用不同权重。',
    ruleVersion: 'MO-SA-2026.1', onboarding: 'column', sampleCount: 3, system: '212/222 科目' },
  { code: 'off_bs', label: '表外授信及承诺', icon: '外', color: '#ea580c',
    desc: '未使用的信贷额度、信用证、保函等，需按信用转换系数折算为等值表内金额。',
    ruleVersion: 'MO-SA-2026.1', onboarding: 'column', sampleCount: 8, system: '額度詳情表' },
  { code: 'other_credit', label: '其他信用风险暴露', icon: '他', color: '#64748b',
    desc: '上述产品之外的信用风险暴露，含股权、衍生品等。',
    ruleVersion: 'MO-SA-2026.1', onboarding: 'manual', sampleCount: 2, system: '—' },
];

/* ==================== 产品标准字段（按产品维护） ==================== */
/* 每个字段：编码、名称、业务含义、数据类型、是否必填、来源系统及字段、
   转换规则、校验规则、可选值、被哪些规则引用。 */
const PRODUCT_FIELDS = {
  corp_loan: [
    { code: 'bal', name: '债项余额', meaning: '这笔债项的账面本金余额，已折算为计量币种，不含利息。', type: 'number', unit: '元', required: true,
      sourceSystem: 'CL-D-101', sourceField: 'LOAN_BAL', transform: '数值转换（去千分位）', validate: '必须大于 0，且不超过 100 亿元',
      options: [], referencedBy: ['CL-MO-045'], stdField: 'balance' },
    { code: 'cpt', name: '交易对手类型', meaning: '债务人的主体性质，决定进入哪一条主体分支。', type: 'enum', unit: '', required: true,
      sourceSystem: 'CL-D-101', sourceField: 'CPTY_TYPE', transform: '枚举映射：C→公司，P→自然人，B→商业银行',
      validate: '必须在枚举范围内', options: ['公司', '自然人', '商业银行', '其他金融机构', '公共部门实体', '特殊目的实体'],
      referencedBy: ['CL-MO-022', 'CL-MO-042', 'CL-MO-045'], stdField: 'counterparty_type' },
    { code: 'ccy', name: '币种', meaning: '债项原币种，需按基准日汇率折算为计量币种。', type: 'enum', unit: '', required: true,
      sourceSystem: 'CL-D-101', sourceField: 'CCY', transform: '字典映射 + 汇率折算', validate: '必须为有效 ISO 币种',
      options: ['MOP', 'CNY', 'HKD', 'USD'], referencedBy: [], stdField: null },
    { code: 'mat', name: '剩余期限', meaning: '自计量基准日至到期日的月数，不是原始期限。', type: 'number', unit: '月', required: true,
      sourceSystem: 'CL-D-101', sourceField: 'MATURITY_DATE', transform: '（到期日 − 基准日）/ 30，向上取整', validate: '必须大于 0',
      options: [], referencedBy: ['CL-MO-022'], stdField: 'remaining_maturity_months' },
    { code: 'grnt', name: '担保方式', meaning: '本笔贷款的主要担保方式，决定是否需要判断房地产抵押。', type: 'enum', unit: '', required: true,
      sourceSystem: 'CL-D-101', sourceField: 'GUARANTEE_TYPE', transform: '字典映射', validate: '必须在枚举范围内',
      options: ['信用', '保证', '抵押', '质押'], referencedBy: ['CL-MO-030', 'CL-MO-031'], stdField: 'has_property_collateral' },
    { code: 'coll', name: '抵质押品类型', meaning: '押品的具体类型，用于判断是否为房地产及其用途。', type: 'enum', unit: '', required: false,
      sourceSystem: '抵押品詳情表', sourceField: 'Collateral Type1', transform: '字典映射', validate: '抵押方式下必填',
      options: ['居住用房', '商用房', '商住两用', '厂房', '存单', '股权'], referencedBy: ['CL-MO-030', 'CL-MO-031'], stdField: 'property_uses' },
    { code: 'ltv', name: '贷款价值比', meaning: '债项余额 / 押品评估价值。50% 记作 0.5。', type: 'number', unit: '比值', required: false,
      sourceSystem: '计算字段', sourceField: '—', transform: '债项余额 ÷ 押品评估价值（MOP）', validate: '0 < 值 ≤ 2',
      options: [], referencedBy: ['CL-MO-030', 'CL-MO-031'], stdField: 'ltv' },
    { code: 'eval', name: '交易对手评级', meaning: '外部评级机构给出的债务人评级，用于投资级判断。', type: 'enum', unit: '', required: false,
      sourceSystem: '同業rating', sourceField: 'RATING', transform: '评级映射（S&P 口径）', validate: '必须在评级枚举内',
      options: ['AAA', 'AA', 'A', 'BBB', 'BB', 'B', '未评级'], referencedBy: [], stdField: 'issuer_rating' },
    { code: 'size', name: '企业划型', meaning: '按国家划型标准确定的企业规模，影响中小企业认定。', type: 'enum', unit: '', required: false,
      sourceSystem: '本地中小企', sourceField: 'SIZE_TYPE', transform: '字典映射', validate: '必须在枚举范围内',
      options: ['大型', '中型', '小型', '微型'], referencedBy: ['CL-MO-045'], stdField: 'enterprise_size' },
    { code: 'rev', name: '最近一年营业收入', meaning: '单位元。3 亿记作 300000000。中小企业不超过 3 亿。', type: 'number', unit: '元', required: false,
      sourceSystem: '本地中小企', sourceField: 'REVENUE', transform: '单位换算（万元→元，×10000）', validate: '≥ 0',
      options: [], referencedBy: ['CL-MO-045'], stdField: 'revenue_last_year' },
    { code: 'ovd', name: '逾期天数', meaning: '自应还日起的逾期天数，用于推导是否已违约。', type: 'number', unit: '天', required: true,
      sourceSystem: 'CL-D-101', sourceField: 'OVERDUE_DAYS', transform: '数值转换', validate: '≥ 0',
      options: [], referencedBy: ['CL-MO-036'], stdField: null },
    { code: 'cls', name: '五级分类', meaning: '本行对该笔债项的风险分类，与逾期天数共同推导已违约。', type: 'enum', unit: '', required: true,
      sourceSystem: 'CL-D-101', sourceField: 'LOAN_CLASS', transform: '字典映射', validate: '必须在五级分类内',
      options: ['正常', '关注', '次级', '可疑', '损失'], referencedBy: ['CL-MO-036'], stdField: null },
  ],
  personal_loan: [
    { code: 'bal', name: '债项余额', meaning: '账面本金余额，不含利息。', type: 'number', unit: '元', required: true,
      sourceSystem: 'CL-D-101', sourceField: 'LOAN_BAL', transform: '数值转换', validate: '大于 0',
      options: [], referencedBy: ['CL-MO-042'], stdField: 'balance' },
    { code: 'cpt', name: '交易对手类型', meaning: '固定为自然人。', type: 'enum', unit: '', required: true,
      sourceSystem: 'CL-D-101', sourceField: 'CPTY_TYPE', transform: '固定取值 P→自然人', validate: '必须为自然人',
      options: ['自然人'], referencedBy: ['CL-MO-042'], stdField: 'counterparty_type' },
    { code: 'sng', name: '对单一债务人风险暴露', meaning: '该自然人在本行的全部信用风险暴露合计，用于监管零售门槛判断。', type: 'number', unit: '元', required: true,
      sourceSystem: '计算字段', sourceField: '—', transform: '按客户号汇总所有债项余额', validate: '大于 0',
      options: [], referencedBy: ['CL-MO-042'], stdField: 'single_exposure' },
    { code: 'shr', name: '占全行信用风险暴露比例', meaning: '该客户暴露 / 全行信用风险暴露总额。0.5% 记作 0.005。', type: 'number', unit: '比值', required: true,
      sourceSystem: '计算字段', sourceField: '—', transform: '该客户暴露 ÷ 全行暴露总额', validate: '0 ≤ 值 ≤ 1',
      options: [], referencedBy: ['CL-MO-042'], stdField: 'exposure_share' },
    { code: 'coll', name: '抵质押品类型', meaning: '押品类型，住房按揭需识别是否居住用房地产。', type: 'enum', unit: '', required: false,
      sourceSystem: '抵押品詳情表', sourceField: 'Collateral Type1', transform: '字典映射', validate: '抵押方式下必填',
      options: ['居住用房', '商用房', '商住两用', '存单'], referencedBy: ['CL-MO-030'], stdField: 'property_uses' },
    { code: 'ltv', name: '贷款价值比', meaning: '贷款余额 / 押品评估价值。', type: 'number', unit: '比值', required: false,
      sourceSystem: '计算字段', sourceField: '—', transform: '贷款余额 ÷ 押品评估价值', validate: '0 < 值 ≤ 2',
      options: [], referencedBy: ['CL-MO-030'], stdField: 'ltv' },
  ],
  bond: [
    { code: 'bal', name: '债券余额', meaning: '债券摊余成本或公允价值，按账务类别确定。', type: 'number', unit: '元', required: true,
      sourceSystem: 'IB-D-001', sourceField: 'BOND_BAL', transform: '数值转换', validate: '大于 0',
      options: [], referencedBy: ['CL-MO-050'], stdField: 'balance' },
    { code: 'itp', name: '发行人类型', meaning: '债券发行人的主体性质。', type: 'enum', unit: '', required: true,
      sourceSystem: 'IB-D-001', sourceField: 'ISSUER_TYPE', transform: '枚举映射', validate: '必须在枚举范围内',
      options: ['我国中央政府', '我国中央银行', '公共部门实体', '多边开发银行', '商业银行', '其他金融机构', '公司'],
      referencedBy: ['CL-MO-015', 'CL-MO-018'], stdField: 'counterparty_type' },
    { code: 'rat', name: '发行人评级', meaning: '境外主权、其他中央银行、其他多边开发银行使用的外部评级。', type: 'enum', unit: '', required: false,
      sourceSystem: '同業rating', sourceField: 'ISSUER_RATING', transform: '评级映射', validate: '必须在评级枚举内',
      options: ['AAA', 'AA+', 'AA', 'AA-', 'A+', 'A', 'A-', 'BBB', '未评级'], referencedBy: ['CL-MO-015'], stdField: 'issuer_rating' },
    { code: 'cat', name: '债券类别', meaning: '用于识别是否为资产担保债券。', type: 'enum', unit: '', required: true,
      sourceSystem: 'IB-D-001', sourceField: 'BOND_CAT', transform: '字典映射', validate: '必须在枚举范围内',
      options: ['国债', '地方政府债', '金融债', '企业债', '资产担保债券'], referencedBy: ['CL-MO-050'], stdField: 'instrument_type' },
  ],
  ib_call: [
    { code: 'bal', name: '余额', meaning: '存放同业的活期余额。', type: 'number', unit: '元', required: true,
      sourceSystem: 'IB-D-001', sourceField: 'DUE_BAL', transform: '数值转换', validate: '大于 0',
      options: [], referencedBy: ['CL-MO-022'], stdField: 'balance' },
    { code: 'cpt', name: '交易对手类型', meaning: '同业对手的主体性质，通常为商业银行。', type: 'enum', unit: '', required: true,
      sourceSystem: 'IB-D-001', sourceField: 'CPTY_TYPE', transform: '固定取值', validate: '商业银行或其他金融机构',
      options: ['商业银行', '其他金融机构', '中央银行'], referencedBy: ['CL-MO-022'], stdField: 'counterparty_type' },
    { code: 'rat', name: '交易对手评级', meaning: '同业对手的外部评级，用于银行分档。', type: 'enum', unit: '', required: true,
      sourceSystem: '同業rating', sourceField: 'RATING', transform: '评级映射', validate: '必须在评级枚举内',
      options: ['A+', 'A', 'B', 'C'], referencedBy: ['CL-MO-022'], stdField: 'issuer_rating' },
  ],
  ib_time: [
    { code: 'bal', name: '余额', meaning: '存放同业的定期余额。', type: 'number', unit: '元', required: true,
      sourceSystem: 'IB-D-001', sourceField: 'DUE_BAL', transform: '数值转换', validate: '大于 0',
      options: [], referencedBy: ['CL-MO-022'], stdField: 'balance' },
    { code: 'cpt', name: '交易对手类型', meaning: '同业对手的主体性质。', type: 'enum', unit: '', required: true,
      sourceSystem: 'IB-D-001', sourceField: 'CPTY_TYPE', transform: '固定取值', validate: '商业银行或其他金融机构',
      options: ['商业银行', '其他金融机构'], referencedBy: ['CL-MO-022'], stdField: 'counterparty_type' },
    { code: 'term', name: '整个存放期', meaning: '按整个存放期分类，而非到期日分类。这是同业存放最容易搞错的地方。', type: 'number', unit: '月', required: true,
      sourceSystem: '212/222 科目', sourceField: 'PLACEMENT_TERM', transform: '（到期日 − 起存日）/ 30，向上取整', validate: '大于 0',
      options: [], referencedBy: ['CL-MO-022'], stdField: 'original_maturity_months' },
    { code: 'rat', name: '交易对手评级', meaning: '同业对手的外部评级。', type: 'enum', unit: '', required: true,
      sourceSystem: '同業rating', sourceField: 'RATING', transform: '评级映射', validate: '必须在评级枚举内',
      options: ['A+', 'A', 'B', 'C'], referencedBy: ['CL-MO-022'], stdField: 'issuer_rating' },
  ],
  due_from_bank: [
    { code: 'bal', name: '余额', meaning: '212、222 科目下的存放同业余额。', type: 'number', unit: '元', required: true,
      sourceSystem: '212/222 科目', sourceField: 'DUE_BAL', transform: '数值转换', validate: '大于 0',
      options: [], referencedBy: ['CL-MO-022'], stdField: 'balance' },
    { code: 'term', name: '整个存放期', meaning: '按整个存放期分类，不是按到期日。', type: 'number', unit: '月', required: true,
      sourceSystem: '212/222 科目', sourceField: 'TERM', transform: '（到期日 − 起存日）/ 30', validate: '大于 0',
      options: [], referencedBy: ['CL-MO-022'], stdField: 'original_maturity_months' },
    { code: 'cpt', name: '交易对手类型', meaning: '同业对手主体性质。', type: 'enum', unit: '', required: true,
      sourceSystem: '212/222 科目', sourceField: 'CPTY_TYPE', transform: '固定取值', validate: '在枚举范围内',
      options: ['商业银行', '其他金融机构'], referencedBy: ['CL-MO-022'], stdField: 'counterparty_type' },
  ],
  off_bs: [
    { code: 'tot', name: '授信总额度', meaning: '银行授予客户的总额度。', type: 'number', unit: '元', required: true,
      sourceSystem: '額度詳情表', sourceField: 'CREDIT_LIMIT', transform: '数值转换', validate: '大于 0',
      options: [], referencedBy: ['CL-MO-064'], stdField: 'offbalance_amount' },
    { code: 'drn', name: '已提用金额', meaning: '已提用并计入表内的部分。', type: 'number', unit: '元', required: true,
      sourceSystem: '額度詳情表', sourceField: 'DRAWN_AMT', transform: '数值转换', validate: '≥ 0 且 ≤ 授信总额度',
      options: [], referencedBy: ['CL-MO-064'], stdField: 'onbalance_amount' },
    { code: 'cat', name: '业务品种', meaning: '决定信用转换系数的档位。', type: 'enum', unit: '', required: true,
      sourceSystem: '額度詳情表', sourceField: 'FACILITY_TYPE', transform: '字典映射', validate: '必须在枚举范围内',
      options: ['贷款承诺（一年以内）', '贷款承诺（一年以上）', '信用证', '保函', '信用卡未使用额度'],
      referencedBy: ['CL-MO-064'], stdField: 'product_name' },
    { code: 'cpt', name: '交易对手类型', meaning: '客户的主体性质。', type: 'enum', unit: '', required: true,
      sourceSystem: '額度詳情表', sourceField: 'CPTY_TYPE', transform: '枚举映射', validate: '在枚举范围内',
      options: ['公司', '自然人', '商业银行'], referencedBy: ['CL-MO-045'], stdField: 'counterparty_type' },
  ],
  other_credit: [
    { code: 'bal', name: '余额', meaning: '股权或其他资产的账面价值。', type: 'number', unit: '元', required: true,
      sourceSystem: '—', sourceField: '—', transform: '人工录入', validate: '大于 0',
      options: [], referencedBy: [], stdField: 'balance' },
    { code: 'itp', name: '工具类型', meaning: '股权、资产担保债券或债权。', type: 'enum', unit: '', required: true,
      sourceSystem: '—', sourceField: '—', transform: '人工录入', validate: '在枚举范围内',
      options: ['股权', '资产担保债券', '债权'], referencedBy: ['CL-MO-050'], stdField: 'instrument_type' },
  ],
};

/* ======================= 原始字段映射（示例） ======================= */
const FIELD_MAPPINGS = {
  corp_loan: [
    { stdField: '债项余额', stdCode: 'balance', srcSystem: 'CL-D-101', srcField: 'LOAN_BAL', via: '数值转换（去千分位、去空格）', status: 'ok', hitRate: 1.0, sample: '13,950,881.25 → 13950881.25' },
    { stdField: '交易对手类型', stdCode: 'counterparty_type', srcSystem: 'CL-D-101', srcField: 'CPTY_TYPE', via: '枚举映射：C→公司，P→自然人，B→商业银行', status: 'ok', hitRate: 1.0, sample: 'C → corporate' },
    { stdField: '剩余期限', stdCode: 'remaining_maturity_months', srcSystem: 'CL-D-101', srcField: 'MATURITY_DATE', via: '（到期日 − 基准日）/ 30，向上取整', status: 'ok', hitRate: 0.98, sample: '20281018 − 20260930 → 25 月' },
    { stdField: '担保方式', stdCode: 'has_property_collateral', srcSystem: 'CL-D-101', srcField: 'GUARANTEE_TYPE', via: '字典映射：抵押→yes，其余→no', status: 'ok', hitRate: 1.0, sample: '抵押 → yes' },
    { stdField: '抵质押品类型', stdCode: 'property_uses', srcSystem: '抵押品詳情表', srcField: 'Collateral Type1', via: '字典映射：909→商用，908→居住', status: 'warn', hitRate: 0.91, sample: '909 → commercial' },
    { stdField: '贷款价值比', stdCode: 'ltv', srcSystem: '计算字段', srcField: 'LOAN_BAL ÷ Collateral Value1', via: '两列相除', status: 'ok', hitRate: 0.94, sample: '52.69 ÷ 880000 → 0.00006' },
    { stdField: '逾期天数', stdCode: '—', srcSystem: 'CL-D-101', srcField: 'OVERDUE_DAYS', via: '数值转换', status: 'missing', hitRate: 0.0, sample: '源系统无此字段，需信贷部门补充' },
    { stdField: '企业划型', stdCode: 'enterprise_size', srcSystem: '本地中小企', srcField: 'SIZE_TYPE', via: '字典映射', status: 'ok', hitRate: 0.96, sample: 'S → small' },
  ],
  bond: [
    { stdField: '债券余额', stdCode: 'balance', srcSystem: 'IB-D-001', srcField: 'BOND_BAL', via: '数值转换', status: 'ok', hitRate: 1.0, sample: '50,000,000 → 50000000' },
    { stdField: '发行人类型', stdCode: 'counterparty_type', srcSystem: 'IB-D-001', srcField: 'ISSUER_TYPE', via: '枚举映射', status: 'ok', hitRate: 1.0, sample: 'GOV → cn_central_government' },
    { stdField: '债券类别', stdCode: 'instrument_type', srcSystem: 'IB-D-001', srcField: 'BOND_CAT', via: '字典映射：资产担保债券→covered_bond', status: 'warn', hitRate: 0.88, sample: 'CB → covered_bond' },
  ],
  ib_time: [
    { stdField: '余额', stdCode: 'balance', srcSystem: 'IB-D-001', srcField: 'DUE_BAL', via: '数值转换', status: 'ok', hitRate: 1.0, sample: '20,000,000 → 20000000' },
    { stdField: '整个存放期', stdCode: 'original_maturity_months', srcSystem: '212/222 科目', srcField: '起存日、到期日', via: '（到期日 − 起存日）/ 30，向上取整', status: 'ok', hitRate: 1.0, sample: '20260101→20270101 → 13 月' },
  ],
  off_bs: [
    { stdField: '表外未提用金额', stdCode: 'offbalance_amount', srcSystem: '額度詳情表', srcField: '总额度 − 已提用', via: '两列相减', status: 'ok', hitRate: 1.0, sample: '5000000 − 1000000 → 4000000' },
    { stdField: '信用转换系数', stdCode: 'ccf', srcSystem: '计算字段', srcField: '业务品种', via: '按品种档位查表：一年以内 0.2，一年以上 0.5，信用证 0.2，保函 0.5', status: 'ok', hitRate: 1.0, sample: '贷款承诺（一年以内）→ 0.2' },
  ],
};

/* 表内 / 表外 EAD 计算规则不在这里，在 tools/build-seed.mjs 的 EAD_PRODUCT_CONFIG，
   灌进 ead_product_config 和 ead_product_rule 两张表。 */

/* ======================= 产品专属暴露分类规则 ====================== */
/* 这些是"产品视角"的规则子集，与规则集 JSON 中的条目一一对应。
   同一套规则数据既能用于决策树展示，也能用于实际执行和审计追溯。 */
const PRODUCT_EXPOSURE_RULES = {
  corp_loan: [
    { ruleId: 'MO-CL-001', name: 're_residential', label: '居住用房地产风险暴露', priority: 10, version: 'MO-SA-2026.1',
      when: '是否有房地产抵押 = 是 AND 抵押物用途 含 居住 AND 还款实质依赖房地产现金流 = 否',
      targetClass: '居住用房地产风险暴露', targetSub: '按贷款价值比分档', weight: '20%–50%', clause: 'CL-MO-030', status: 'published' },
    { ruleId: 'MO-CL-002', name: 're_commercial', label: '商用房地产风险暴露', priority: 11, version: 'MO-SA-2026.1',
      when: '是否有房地产抵押 = 是 AND 抵押物用途 含 商用',
      targetClass: '商用房地产风险暴露', targetSub: '按现金流依赖与贷款价值比分档', weight: '60%–max(90%,交易对手)', clause: 'CL-MO-031', status: 'published' },
    { ruleId: 'MO-CL-003', name: 'defaulted', label: '已违约风险暴露', priority: 12, version: 'MO-SA-2026.1',
      when: '是否已违约 = 是（逾期 > 90 天或五级分类为次级/可疑/损失）',
      targetClass: '已违约风险暴露', targetSub: '按损失准备比例分档', weight: '100% / 150%', clause: 'CL-MO-036', status: 'published' },
    { ruleId: 'MO-CL-004', name: 'corporate_sme', label: '中小企业风险暴露', priority: 20, version: 'MO-SA-2026.1',
      when: '交易对手 = 公司 AND 企业划型 ∈ {微型,小型,中型} AND 最近一年营业收入 ≤ 3亿 AND 对单一债务人暴露 ≤ 1000万',
      targetClass: '公司风险暴露', targetSub: '中小企业风险暴露', weight: '85%', clause: 'CL-MO-045', status: 'published' },
    { ruleId: 'MO-CL-005', name: 'corporate_ig', label: '投资级公司风险暴露', priority: 21, version: 'MO-SA-2026.1',
      when: '十项投资级认定条件同时满足（经营正常、无重大违法、未失信、财报无虚假、审计无保留、三年无违约、分类正常、财务更新及时、资产负债率 ≤ 70%、无其他重大风险）',
      targetClass: '公司风险暴露', targetSub: '投资级公司风险暴露', weight: '75%', clause: 'CL-MO-045', status: 'published' },
    { ruleId: 'MO-CL-006', name: 'corporate_general_other', label: '一般公司风险暴露', priority: 22, version: 'MO-SA-2026.1',
      when: '交易对手 = 公司，且未命中以上两条（兜底）',
      targetClass: '公司风险暴露', targetSub: '一般公司风险暴露', weight: '100%', clause: 'CL-MO-045', status: 'published' },
  ],
  bond: [
    { ruleId: 'MO-BD-001', name: 'sovereign', label: '对主权及中央银行的暴露', priority: 10, version: 'MO-SA-2026.1',
      when: '发行人类型 ∈ {我国中央政府, 我国中央银行, 其他主权国家或经济实体}',
      targetClass: '主权及中央银行', targetSub: '按外部评级分档', weight: '0%–100%', clause: 'CL-MO-015', status: 'published' },
    { ruleId: 'MO-BD-002', name: 'covered_bond', label: '合格资产担保债券', priority: 11, version: 'MO-SA-2026.1',
      when: '工具 = 资产担保债券 AND 资产池仅含合格资产 AND 资产池名义价值比 ≥ 110% AND 每半年可取得披露',
      targetClass: '资产担保债券', targetSub: '合格 / 不合格', weight: '10% 或回退交易对手', clause: 'CL-MO-050', status: 'published' },
    { ruleId: 'MO-BD-003', name: 'mdb_qualified', label: '对合格多边开发银行的暴露', priority: 12, version: 'MO-SA-2026.1',
      when: '发行人类型 = 多边开发银行 AND 交易对手名称 ∈ 合格名单 13 家',
      targetClass: '多边开发银行', targetSub: '合格多边开发银行', weight: '0%', clause: 'CL-MO-018', status: 'published' },
  ],
  ib_call: [
    { ruleId: 'MO-IB-001', name: 'fi_bank', label: '对商业银行的暴露', priority: 10, version: 'MO-SA-2026.1',
      when: '交易对手 = 商业银行 AND 是否适用 = 适用，按资本达标情况与审计意见分 A+/A/B/C 档',
      targetClass: '商业银行风险暴露', targetSub: '第一档 / 第二档', weight: '20%–150%', clause: 'CL-MO-022', status: 'published' },
    { ruleId: 'MO-IB-002', name: 'fi_other', label: '对其他金融机构的暴露', priority: 11, version: 'MO-SA-2026.1',
      when: '交易对手 ∈ {其他金融机构, 开发性金融机构, 政策性银行} AND 是否次级债权 = 否',
      targetClass: '其他金融机构', targetSub: '短期 / 中长期', weight: '20% / 100%', clause: 'CL-MO-022', status: 'published' },
  ],
  ib_time: [
    { ruleId: 'MO-IT-001', name: 'fi_bank', label: '对商业银行的暴露', priority: 10, version: 'MO-SA-2026.1',
      when: '交易对手 = 商业银行，按整个存放期判断短期档（≤3 个月）或中长期档',
      targetClass: '商业银行风险暴露', targetSub: '第一档 / 第二档', weight: '20%–50%', clause: 'CL-MO-022', status: 'published' },
  ],
  off_bs: [
    { ruleId: 'MO-OB-001', name: 'regulatory_retail', label: '监管零售风险暴露', priority: 10, version: 'MO-SA-2026.1',
      when: '交易对手 ∈ {自然人, 独资企业, 合伙制企业} AND 对单一债务人暴露 ≤ 1000万 AND 占全行比例 ≤ 0.5%',
      targetClass: '监管零售组合', targetSub: '监管零售风险暴露', weight: '75%', clause: 'CL-MO-042', status: 'published' },
    { ruleId: 'MO-OB-002', name: 'corporate_general', label: '公司风险暴露', priority: 11, version: 'MO-SA-2026.1',
      when: '交易对手 = 公司，按中小企业 / 投资级 / 一般分档',
      targetClass: '公司风险暴露', targetSub: '中小企业 / 投资级 / 一般', weight: '75%–100%', clause: 'CL-MO-045', status: 'published' },
  ],
};

/* 通用暴露分类规则（不依赖具体产品字段的判定框架） */
const GENERIC_RULES = [
  { id: 'GEN-001', name: '暴露大类及子类定义', desc: '定义风险暴露的一级大类（主权、公共部门、多边开发银行、商业银行、其他金融机构、公司、个人、监管零售、房地产、已违约、其他）及各自子类。',
    items: 11, status: 'published', version: 'MO-SA-2026.1' },
  { id: 'GEN-002', name: '通用判断条件', desc: '交易对手主体性质、工具形态、是否已违约、房地产抵押等跨产品的通用判断条件。',
    items: 8, status: 'published', version: 'MO-SA-2026.1' },
  { id: 'GEN-003', name: '规则优先级', desc: '自上而下，第一条命中即停止并进入其子级。顺序即规则，禁止重排。',
    items: 14, status: 'published', version: 'MO-SA-2026.1' },
  { id: 'GEN-004', name: '规则匹配方式', desc: 'when 采用 all（全部成立）与 any（成立其一）两种组合，可相互嵌套；字段未填时条件不命中。',
    items: 2, status: 'published', version: 'MO-SA-2026.1' },
  { id: 'GEN-005', name: '默认路由与异常处理', desc: '同一层全部不命中时走 otherwise 指向的兜底节点；skip 成立时整段跳过并退回外层，不落入本层兜底。',
    items: 2, status: 'published', version: 'MO-SA-2026.1' },
];

/* ========================= 计算批次（模拟） ======================== */
const BATCHES = [
  { id: 'BATCH-202609-MO-01', name: '2026年9月澳门分行信用风险计量', institution: '澳门分行',
    jurisdiction: 'MO', version: 'MO-SA-2026.1', baseDate: '2026-09-30',
    imported: 38, success: 35, exception: 3,
    onEad: 0, offEad: 0, rwa: 0, createdAt: '2026-10-08 09:12', status: 'completed' },
  { id: 'BATCH-202606-MO-01', name: '2026年6月澳门分行信用风险计量', institution: '澳门分行',
    jurisdiction: 'MO', version: 'MO-SA-2025.2', baseDate: '2026-06-30',
    imported: 36, success: 34, exception: 2,
    onEad: 0, offEad: 0, rwa: 0, createdAt: '2026-07-05 14:30', status: 'completed' },
  { id: 'BATCH-202609-CN-01', name: '2026年9月总行信用风险计量', institution: '总行（法人）',
    jurisdiction: 'CN', version: 'CN-SA-2026.1', baseDate: '2026-09-30',
    imported: 25, success: 24, exception: 1,
    onEad: 0, offEad: 0, rwa: 0, createdAt: '2026-10-09 10:05', status: 'completed' },
];

/* ==================== 自然语言规则助手的模拟对话 =================== */
const NL_ASSISTANT_SCRIPT = [
  {
    role: 'user',
    text: '针对当前澳门监管版本下的对公贷款，新增一条针对特定交易对手类型的暴露分类规则，并关联相应监管条款。',
  },
  {
    role: 'assistant',
    text: '我识别到以下配置意图，请确认：',
    extract: [
      { k: '适用地区', v: '澳门' },
      { k: '监管版本', v: 'MO-SA-2026.1（当前生效版本）' },
      { k: '适用产品', v: '对公贷款' },
      { k: '规则类型', v: '产品专属暴露分类规则' },
    ],
    ask: '请补充「特定交易对手类型」具体指哪一类，以及命中后应归入的暴露大类与子类。',
  },
  {
    role: 'user',
    text: '交易对手是农村信用合作社，归入商业银行风险暴露，权重按第二档中长期处理，关联第22条。',
  },
  {
    role: 'assistant',
    text: '已生成结构化规则草稿，请确认后保存。',
    draft: {
      rule_id: 'MO-CL-007',
      jurisdiction: 'MO',
      rule_version: 'MO-SA-2026.1',
      product_type: '对公贷款',
      priority: 13,
      conditions: {
        all: [
          { field: 'counterparty_type', op: 'eq', match: 'commercial_bank' },
          { field: 'is_credit_cooperative', op: 'eq', match: 'yes' },
        ],
      },
      result: { exposure_class: '商业银行风险暴露', sub_class: '第二档商业银行', risk_weight_kind: 'const', risk_weight: 0.5 },
      next_rule: 'fi_bank_tier2_long',
      regulatory_reference: { doc: '【模拟】澳门AMCM资本充足率指引', clause: '第22条' },
    },
    checks: [
      { level: 'warn', text: '条件引用了字段 is_credit_cooperative，该字段尚未在产品标准字段中声明，需先在对公贷款产品下新增。' },
      { level: 'info', text: '农村合作银行、村镇银行、农村信用合作社按口径可并入 commercial_bank，也可另设新 code。本次采用新增独立字段的方式，避免影响既有规则。' },
      { level: 'warn', text: '拟设优先级 13 与现有规则 fi_bank（优先级 8）存在重叠区间：交易对手为商业银行时，fi_bank 会先命中。建议将本规则挂在 fi_bank 的 children 下，而非插入 rules 中间。' },
    ],
    treeEffect: '确认后，本规则将出现在决策树「对商业银行的暴露」节点之下，作为其子档之一，不改变外层顺序。',
  },
];

const MASTER_DATA = {
  JURISDICTIONS, RULE_VERSIONS, RULE_TYPES, RULE_STATUS, CLAUSES,
  PRODUCT_TYPES, PRODUCT_FIELDS, FIELD_MAPPINGS,
  PRODUCT_EXPOSURE_RULES, GENERIC_RULES,
  BATCHES, NL_ASSISTANT_SCRIPT,
};

if (typeof window !== 'undefined') window.MASTER = MASTER_DATA;
if (typeof module !== 'undefined' && module.exports) module.exports = MASTER_DATA;
})(typeof window !== "undefined" ? window : globalThis);
