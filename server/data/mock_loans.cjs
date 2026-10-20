(function (global) {
/**
 * 模拟债项明细数据
 * ---------------------------------------------------------------
 * 【模拟数据】全部客户号、合同号、金额均为虚构，仅用于系统原型演示，
 * 不含任何真实客户信息。字段口径参考银行信用风险底稿的常见列结构。
 *
 * 每一行同时保留：
 *   raw      —— 导入的原始数据（未标准化）
 *   std      —— 映射后的产品标准字段（规则引擎的输入）
 *   productHint —— 产品识别依据
 */

const MOCK_EXCEL_COLUMNS = [
  'GL A/C No.', 'Customer', 'Customer Name', 'Contract', 'Product Code', 'Currency Code',
  'Maturity Date', 'Value Balance', 'Value Balance(MOP)', 'Cust Type', 'Industry Code',
  'Collateral Type1', 'Collateral Value（MOP）1', 'Maturity Date', 'Overdue Days', 'Loan Class',
  'Impairment', 'Enterprise Size', 'Revenue', 'Issuer Rating', 'Off Balance',
  'Credit Limit(MOP)', 'Drawn Amount(MOP)', 'Facility Type', 'Bond Category', 'Issuer Type',
];

/* 基准日 2026-09-30 */
const MOCK_LOANS = [
  /* ---------------- 对公贷款 ---------------- */
  { id: 'L0001', customer: 'C90001', name: '【模拟】永利工程有限公司', product: 'corp_loan', raw: {
      glAcct: '2031110100', productCode: 'TL/R', ccy: 'MOP', balance: 52000000, maturity: '20280815',
      custType: 'C', collateralType: '909', collateralValue: 48000000, overdueDays: 0, loanClass: '正常',
      impairment: 260000, enterpriseSize: 'large', revenue: 780000000, industry: 'WL0037' },
    std: { instrument_type: 'claim', is_defaulted: 'no', counterparty_type: 'corporate', balance: 52000000,
      impairment: 260000, offbalance: 'no', remaining_maturity_months: 23, single_exposure: 52000000,
      exposure_share: 0.0184, enterprise_size: 'large', revenue_last_year: 780000000,
      has_property_collateral: 'yes', property_uses: ['commercial'], cashflow_dependent: 'no', ltv: 1.0833,
      product_code: 'TL/R' } },

  { id: 'L0002', customer: 'C90002', name: '【模拟】华兴贸易有限公司', product: 'corp_loan', raw: {
      glAcct: '2031110100', productCode: 'TL/NR', ccy: 'MOP', balance: 8600000, maturity: '20270630',
      custType: 'C', collateralType: '908', collateralValue: 12000000, overdueDays: 0, loanClass: '正常',
      impairment: 43000, enterpriseSize: 'small', revenue: 92000000, industry: 'WL0066' },
    std: { instrument_type: 'claim', is_defaulted: 'no', counterparty_type: 'corporate', balance: 8600000,
      impairment: 43000, offbalance: 'no', remaining_maturity_months: 9, single_exposure: 8600000,
      exposure_share: 0.0030, enterprise_size: 'small', revenue_last_year: 92000000,
      has_property_collateral: 'no', ltv: 0.7167, product_code: 'TL/NR' } },

  { id: 'L0003', customer: 'C90003', name: '【模拟】利丰置业有限公司', product: 'corp_loan', raw: {
      glAcct: '2051010100', productCode: 'RE/COM', ccy: 'MOP', balance: 96000000, maturity: '20310930',
      custType: 'C', collateralType: '909', collateralValue: 160000000, overdueDays: 0, loanClass: '正常',
      impairment: 480000, enterpriseSize: 'medium', revenue: 180000000, industry: 'RE0021' },
    std: { instrument_type: 'claim', is_defaulted: 'no', counterparty_type: 'corporate', balance: 96000000,
      impairment: 480000, offbalance: 'no', remaining_maturity_months: 60, single_exposure: 96000000,
      exposure_share: 0.0340, enterprise_size: 'medium', revenue_last_year: 180000000,
      has_property_collateral: 'yes', property_uses: ['commercial'], cashflow_dependent: 'yes', ltv: 0.6,
      product_code: 'RE/COM' } },

  { id: 'L0004', customer: 'C90004', name: '【模拟】恒基发展有限公司', product: 'corp_loan', raw: {
      glAcct: '2051020100', productCode: 'RE/COM', ccy: 'MOP', balance: 75000000, maturity: '20320331',
      custType: 'C', collateralType: '909', collateralValue: 100000000, overdueDays: 0, loanClass: '正常',
      impairment: 375000, enterpriseSize: 'large', revenue: 620000000, industry: 'RE0022' },
    std: { instrument_type: 'claim', is_defaulted: 'no', counterparty_type: 'corporate', balance: 75000000,
      impairment: 375000, offbalance: 'no', remaining_maturity_months: 66, single_exposure: 75000000,
      exposure_share: 0.0265, enterprise_size: 'large', revenue_last_year: 620000000,
      has_property_collateral: 'yes', property_uses: ['commercial'], cashflow_dependent: 'yes', ltv: 0.75,
      product_code: 'RE/COM' } },

  { id: 'L0005', customer: 'C90005', name: '【模拟】粤港澳物流有限公司', product: 'corp_loan', raw: {
      glAcct: '2031110100', productCode: 'TL/NR', ccy: 'MOP', balance: 3200000, maturity: '20261231',
      custType: 'C', collateralType: '—', collateralValue: 0, overdueDays: 128, loanClass: '次级',
      impairment: 900000, enterpriseSize: 'small', revenue: 45000000, industry: 'WL0090' },
    std: { instrument_type: 'claim', is_defaulted: 'yes', counterparty_type: 'corporate', balance: 3200000,
      impairment: 900000, offbalance: 'no', remaining_maturity_months: 3, single_exposure: 3200000,
      exposure_share: 0.0011, enterprise_size: 'small', revenue_last_year: 45000000,
      provision_ratio: 0.2813, product_code: 'TL/NR' } },

  { id: 'L0006', customer: 'C90006', name: '【模拟】南光建筑有限公司', product: 'corp_loan', raw: {
      glAcct: '2071010100', productCode: 'TL/NR', ccy: 'MOP', balance: 2800000, maturity: '20270331',
      custType: 'C', collateralType: '—', collateralValue: 0, overdueDays: 105, loanClass: '可疑',
      impairment: 280000, enterpriseSize: 'small', revenue: 38000000, industry: 'CN0012' },
    std: { instrument_type: 'claim', is_defaulted: 'yes', counterparty_type: 'corporate', balance: 2800000,
      impairment: 280000, offbalance: 'no', remaining_maturity_months: 6, single_exposure: 2800000,
      exposure_share: 0.0010, enterprise_size: 'small', revenue_last_year: 38000000,
      provision_ratio: 0.1, product_code: 'TL/NR' } },

  { id: 'L0007', customer: 'C90007', name: '【模拟】信德科技股份有限公司', product: 'corp_loan', raw: {
      glAcct: '2031110100', productCode: 'TL/NR', ccy: 'MOP', balance: 6800000, maturity: '20271231',
      custType: 'C', collateralType: '—', collateralValue: 0, overdueDays: 0, loanClass: '正常',
      impairment: 34000, enterpriseSize: 'small', revenue: 210000000, industry: 'IT0008' },
    std: { instrument_type: 'claim', is_defaulted: 'no', counterparty_type: 'corporate', balance: 6800000,
      impairment: 34000, offbalance: 'no', remaining_maturity_months: 15, single_exposure: 6800000,
      exposure_share: 0.0024, enterprise_size: 'small', revenue_last_year: 210000000,
      operating_normal: 'yes', no_major_violation_3y: 'yes', not_on_dishonest_list: 'yes',
      no_false_statements: 'yes', annual_audit_opinion: 'unqualified', no_default_3y: 'yes',
      loan_classification_normal: 'yes', financials_updated_within_6m: 'yes', debt_ratio: 0.58,
      no_other_material_risk: 'yes', product_code: 'TL/NR' } },

  { id: 'L0008', customer: 'C90008', name: '【模拟】澳门电力供应商行', product: 'corp_loan', raw: {
      glAcct: '2031110100', productCode: 'TL/R', ccy: 'MOP', balance: 42000000, maturity: '20290930',
      custType: 'C', collateralType: '—', collateralValue: 0, overdueDays: 0, loanClass: '正常',
      impairment: 210000, enterpriseSize: 'large', revenue: 1450000000, industry: 'UT0003' },
    std: { instrument_type: 'claim', is_defaulted: 'no', counterparty_type: 'corporate', balance: 42000000,
      impairment: 210000, offbalance: 'no', remaining_maturity_months: 36, single_exposure: 42000000,
      exposure_share: 0.0148, enterprise_size: 'large', revenue_last_year: 1450000000,
      operating_normal: 'yes', no_major_violation_3y: 'yes', not_on_dishonest_list: 'yes',
      no_false_statements: 'yes', annual_audit_opinion: 'unqualified', no_default_3y: 'yes',
      loan_classification_normal: 'yes', financials_updated_within_6m: 'yes', debt_ratio: 0.62,
      no_other_material_risk: 'yes', product_code: 'TL/R' } },

  /* ---------------- 个人贷款 ---------------- */
  { id: 'L0009', customer: 'P70001', name: '【模拟】陈大文', product: 'personal_loan', raw: {
      glAcct: '2052010100', productCode: 'MTG/RES', ccy: 'MOP', balance: 3800000, maturity: '20450930',
      custType: 'P', collateralType: '908', collateralValue: 7200000, overdueDays: 0, loanClass: '正常',
      impairment: 19000 },
    std: { instrument_type: 'claim', is_defaulted: 'no', counterparty_type: 'individual', balance: 3800000,
      impairment: 19000, offbalance: 'no', remaining_maturity_months: 228, single_exposure: 3800000,
      exposure_share: 0.0013, has_property_collateral: 'yes', property_uses: ['residential'],
      cashflow_dependent: 'no', ltv: 0.5278, product_code: 'MTG/RES' } },

  { id: 'L0010', customer: 'P70002', name: '【模拟】李美玲', product: 'personal_loan', raw: {
      glAcct: '2052010100', productCode: 'MTG/RES', ccy: 'MOP', balance: 5200000, maturity: '20460930',
      custType: 'P', collateralType: '908', collateralValue: 7500000, overdueDays: 0, loanClass: '正常',
      impairment: 26000 },
    std: { instrument_type: 'claim', is_defaulted: 'no', counterparty_type: 'individual', balance: 5200000,
      impairment: 26000, offbalance: 'no', remaining_maturity_months: 240, single_exposure: 5200000,
      exposure_share: 0.0018, has_property_collateral: 'yes', property_uses: ['residential'],
      cashflow_dependent: 'no', ltv: 0.6933, product_code: 'MTG/RES' } },

  { id: 'L0011', customer: 'P70003', name: '【模拟】黄志强', product: 'personal_loan', raw: {
      glAcct: '2052020100', productCode: 'MTG/MIX', ccy: 'MOP', balance: 2600000, maturity: '20400930',
      custType: 'P', collateralType: '910', collateralValue: 4000000, overdueDays: 0, loanClass: '正常',
      impairment: 13000 },
    std: { instrument_type: 'claim', is_defaulted: 'no', counterparty_type: 'individual', balance: 2600000,
      impairment: 13000, offbalance: 'no', remaining_maturity_months: 168, single_exposure: 2600000,
      exposure_share: 0.0009, has_property_collateral: 'yes', property_uses: ['mixed_use'],
      cashflow_dependent: 'no', ltv: 0.65, product_code: 'MTG/MIX' } },

  { id: 'L0012', customer: 'P70004', name: '【模拟】周小琳', product: 'personal_loan', raw: {
      glAcct: '2053010100', productCode: 'PL/CON', ccy: 'MOP', balance: 420000, maturity: '20290930',
      custType: 'P', collateralType: '—', collateralValue: 0, overdueDays: 0, loanClass: '正常',
      impairment: 2100 },
    std: { instrument_type: 'claim', is_defaulted: 'no', counterparty_type: 'individual', balance: 420000,
      impairment: 2100, offbalance: 'no', remaining_maturity_months: 36, single_exposure: 420000,
      exposure_share: 0.00015, product_code: 'PL/CON' } },

  { id: 'L0013', customer: 'P70005', name: '【模拟】吴国华', product: 'personal_loan', raw: {
      glAcct: '2053010100', productCode: 'PL/CON', ccy: 'MOP', balance: 16500000, maturity: '20310930',
      custType: 'P', collateralType: '—', collateralValue: 0, overdueDays: 0, loanClass: '正常',
      impairment: 82500 },
    std: { instrument_type: 'claim', is_defaulted: 'no', counterparty_type: 'individual', balance: 16500000,
      impairment: 82500, offbalance: 'no', remaining_maturity_months: 60, single_exposure: 16500000,
      exposure_share: 0.0058, product_code: 'PL/CON' } },

  { id: 'L0014', customer: 'P70006', name: '【模拟】郑丽华', product: 'personal_loan', raw: {
      glAcct: '2052010100', productCode: 'MTG/RES', ccy: 'MOP', balance: 6900000, maturity: '20470930',
      custType: 'P', collateralType: '908', collateralValue: 7000000, overdueDays: 0, loanClass: '正常',
      impairment: 34500 },
    std: { instrument_type: 'claim', is_defaulted: 'no', counterparty_type: 'individual', balance: 6900000,
      impairment: 34500, offbalance: 'no', remaining_maturity_months: 252, single_exposure: 6900000,
      exposure_share: 0.0024, has_property_collateral: 'yes', property_uses: ['residential'],
      cashflow_dependent: 'no', ltv: 0.9857, product_code: 'MTG/RES' } },

  /* ---------------- 债券投资 ---------------- */
  { id: 'B0001', customer: 'G00001', name: '【模拟】澳门特别行政区政府', product: 'bond', raw: {
      glAcct: '1011010100', productCode: 'BND/GOV', ccy: 'MOP', balance: 120000000, maturity: '20310930',
      issuerType: 'G', bondCategory: '国债', issuerRating: 'AAA', impairment: 0, custType: 'G' },
    std: { instrument_type: 'claim', is_defaulted: 'no', counterparty_type: 'cn_central_government',
      balance: 120000000, impairment: 0, offbalance: 'no', issuer_rating: 'aaa', product_code: 'BND/GOV' } },

  { id: 'B0002', customer: 'I00002', name: '【模拟】亚洲开发银行', product: 'bond', raw: {
      glAcct: '1012010100', productCode: 'BND/MDB', ccy: 'MOP', balance: 60000000, maturity: '20280930',
      issuerType: 'MDB', bondCategory: '金融债', issuerRating: 'AAA', impairment: 0, custType: 'G' },
    std: { instrument_type: 'claim', is_defaulted: 'no', counterparty_type: 'mdb',
      counterparty_name: '亚洲开发银行', balance: 60000000, impairment: 0, offbalance: 'no',
      issuer_rating: 'aaa', product_code: 'BND/MDB' } },

  { id: 'B0003', customer: 'I00003', name: '【模拟】大丰银行有限公司', product: 'bond', raw: {
      glAcct: '1013010100', productCode: 'BND/FI', ccy: 'MOP', balance: 45000000, maturity: '20290930',
      issuerType: 'B', bondCategory: '金融债', issuerRating: 'A', impairment: 225000, custType: 'B' },
    std: { instrument_type: 'claim', is_defaulted: 'no', counterparty_type: 'commercial_bank',
      balance: 45000000, impairment: 225000, offbalance: 'no', bank_tier: 'tier1',
      original_maturity_months: 36, counterparty_name: '【模拟】大丰银行有限公司', product_code: 'BND/FI' } },

  { id: 'B0004', customer: 'C90010', name: '【模拟】联丰企业有限公司', product: 'bond', raw: {
      glAcct: '1014010100', productCode: 'BND/CORP', ccy: 'MOP', balance: 18000000, maturity: '20290930',
      issuerType: 'C', bondCategory: '企业债', issuerRating: 'BBB', impairment: 180000, custType: 'C' },
    std: { instrument_type: 'claim', is_defaulted: 'no', counterparty_type: 'corporate', balance: 18000000,
      impairment: 180000, offbalance: 'no', issuer_rating: 'bbb', enterprise_size: 'medium',
      revenue_last_year: 240000000, single_exposure: 18000000, exposure_share: 0.0063,
      product_code: 'BND/CORP' } },

  /* ---------------- 同业活期 / 定期 / 存放同业 ---------------- */
  { id: 'I0001', customer: 'B80001', name: '【模拟】中国银行澳门分行', product: 'ib_call', raw: {
      glAcct: '2121010100', productCode: 'DUE/CALL', ccy: 'MOP', balance: 28000000, maturity: '20261001',
      custType: 'B', term: 0, counterpartyRating: 'A+', impairment: 0 },
    std: { instrument_type: 'claim', is_defaulted: 'no', counterparty_type: 'commercial_bank',
      balance: 28000000, impairment: 0, offbalance: 'no', bank_tier: 'tier1',
      original_maturity_months: 1, product_code: 'DUE/CALL' } },

  { id: 'I0002', customer: 'B80002', name: '【模拟】工银澳门', product: 'ib_call', raw: {
      glAcct: '2121010100', productCode: 'DUE/CALL', ccy: 'MOP', balance: 35000000, maturity: '20261001',
      custType: 'B', term: 0, counterpartyRating: 'A', impairment: 0 },
    std: { instrument_type: 'claim', is_defaulted: 'no', counterparty_type: 'commercial_bank',
      balance: 35000000, impairment: 0, offbalance: 'no', bank_tier: 'tier2',
      original_maturity_months: 1, product_code: 'DUE/CALL' } },

  { id: 'I0003', customer: 'F80003', name: '【模拟】某证券公司', product: 'ib_call', raw: {
      glAcct: '2122010100', productCode: 'DUE/CALL', ccy: 'MOP', balance: 9000000, maturity: '20261001',
      custType: 'F', term: 0, counterpartyRating: 'BBB', impairment: 0 },
    std: { instrument_type: 'claim', is_defaulted: 'no', counterparty_type: 'other_fi',
      balance: 9000000, impairment: 0, offbalance: 'no', is_subordinated: 'no',
      original_maturity_months: 1, product_code: 'DUE/CALL' } },

  { id: 'I0004', customer: 'B80004', name: '【模拟】大西洋银行', product: 'ib_time', raw: {
      glAcct: '2221010100', productCode: 'DUE/TIME', ccy: 'MOP', balance: 50000000, maturity: '20270930',
      custType: 'B', term: 12, counterpartyRating: 'A+', impairment: 0 },
    std: { instrument_type: 'claim', is_defaulted: 'no', counterparty_type: 'commercial_bank',
      balance: 50000000, impairment: 0, offbalance: 'no', bank_tier: 'tier1',
      original_maturity_months: 12, product_code: 'DUE/TIME' } },

  { id: 'I0005', customer: 'B80005', name: '【模拟】华侨永亨银行', product: 'ib_time', raw: {
      glAcct: '2221010100', productCode: 'DUE/TIME', ccy: 'MOP', balance: 42000000, maturity: '20270115',
      custType: 'B', term: 4, counterpartyRating: 'B', impairment: 0 },
    std: { instrument_type: 'claim', is_defaulted: 'no', counterparty_type: 'commercial_bank',
      balance: 42000000, impairment: 0, offbalance: 'no', bank_tier: 'tier2',
      original_maturity_months: 4, product_code: 'DUE/TIME' } },

  { id: 'I0006', customer: 'F80006', name: '【模拟】某财务公司', product: 'ib_time', raw: {
      glAcct: '2222010100', productCode: 'DUE/TIME', ccy: 'MOP', balance: 15000000, maturity: '20280331',
      custType: 'F', term: 18, counterpartyRating: 'BBB', impairment: 0 },
    std: { instrument_type: 'claim', is_defaulted: 'no', counterparty_type: 'other_fi',
      balance: 15000000, impairment: 0, offbalance: 'no', is_subordinated: 'no',
      original_maturity_months: 18, product_code: 'DUE/TIME' } },

  /* ---------------- 表外授信及承诺 ---------------- */
  { id: 'O0001', customer: 'C90011', name: '【模拟】建兴置业有限公司', product: 'off_bs', raw: {
      glAcct: '9011010100', productCode: 'OFF/LN', ccy: 'MOP', creditLimit: 30000000, drawn: 12000000,
      maturity: '20270331', facilityType: '贷款承诺（一年以内）', custType: 'C', impairment: 0 },
    std: { instrument_type: 'claim', is_defaulted: 'no', counterparty_type: 'corporate', offbalance: 'yes',
      offbalance_amount: 18000000, onbalance_amount: 12000000, balance: 12000000, impairment: 0,
      ccf: 0.2, original_maturity_months: 6, single_exposure: 30000000, exposure_share: 0.0106,
      product_code: 'OFF/LN' } },

  { id: 'O0002', customer: 'C90012', name: '【模拟】伟业制造有限公司', product: 'off_bs', raw: {
      glAcct: '9011020100', productCode: 'OFF/LN', ccy: 'MOP', creditLimit: 60000000, drawn: 20000000,
      maturity: '20280930', facilityType: '贷款承诺（一年以上）', custType: 'C', impairment: 0 },
    std: { instrument_type: 'claim', is_defaulted: 'no', counterparty_type: 'corporate', offbalance: 'yes',
      offbalance_amount: 40000000, onbalance_amount: 20000000, balance: 20000000, impairment: 0,
      ccf: 0.5, original_maturity_months: 24, single_exposure: 60000000, exposure_share: 0.0212,
      enterprise_size: 'medium', revenue_last_year: 280000000, product_code: 'OFF/LN' } },

  { id: 'O0003', customer: 'P70007', name: '【模拟】林小凤', product: 'off_bs', raw: {
      glAcct: '9031010100', productCode: 'OFF/CC', ccy: 'MOP', creditLimit: 300000, drawn: 60000,
      maturity: '20270930', facilityType: '信用卡未使用额度', custType: 'P', impairment: 0 },
    std: { instrument_type: 'claim', is_defaulted: 'no', counterparty_type: 'individual', offbalance: 'yes',
      offbalance_amount: 240000, onbalance_amount: 60000, balance: 60000, impairment: 0, ccf: 0.2,
      original_maturity_months: 12, single_exposure: 300000, exposure_share: 0.0001, product_code: 'OFF/CC' } },

  { id: 'O0004', customer: 'C90013', name: '【模拟】信和贸易有限公司', product: 'off_bs', raw: {
      glAcct: '9012010100', productCode: 'OFF/LC', ccy: 'MOP', creditLimit: 25000000, drawn: 8000000,
      maturity: '20270331', facilityType: '信用证', custType: 'C', impairment: 0 },
    std: { instrument_type: 'claim', is_defaulted: 'no', counterparty_type: 'corporate', offbalance: 'yes',
      offbalance_amount: 17000000, onbalance_amount: 8000000, balance: 8000000, impairment: 0, ccf: 0.2,
      original_maturity_months: 6, single_exposure: 25000000, exposure_share: 0.0088, product_code: 'OFF/LC' } },

  /* ---------------- 需要人工处理的异常记录 ---------------- */
  { id: 'X0001', customer: 'C90014', name: '【模拟】待补资料企业', product: 'corp_loan', anomaly: '字段缺失', raw: {
      glAcct: '2031110100', productCode: 'TL/NR', ccy: 'MOP', balance: 15000000, maturity: '20280331',
      custType: '—', collateralType: '—', collateralValue: 0, overdueDays: 0, loanClass: '正常',
      impairment: 75000, enterpriseSize: '—', revenue: 0, industry: '—' },
    std: { instrument_type: 'claim', is_defaulted: 'no', counterparty_type: null, balance: 15000000,
      impairment: 75000, offbalance: 'no', product_code: 'TL/NR' },
    anomalyDetail: '交易对手类型（Cust Type）为空，无法判定主体分支；企业划型为空，无法判断中小企业资格。' },

  { id: 'X0002', customer: 'C90015', name: '【模拟】房地产押品信息缺失', product: 'corp_loan', anomaly: '字段缺失', raw: {
      glAcct: '2051010100', productCode: 'RE/COM', ccy: 'MOP', balance: 58000000, maturity: '20320930',
      custType: 'C', collateralType: '909', collateralValue: 0, overdueDays: 0, loanClass: '正常',
      impairment: 290000, enterpriseSize: 'medium', revenue: 150000000, industry: 'RE0021' },
    std: { instrument_type: 'claim', is_defaulted: 'no', counterparty_type: 'corporate', balance: 58000000,
      impairment: 290000, offbalance: 'no', has_property_collateral: 'yes', property_uses: ['commercial'],
      cashflow_dependent: 'yes', ltv: null, product_code: 'RE/COM' },
    anomalyDetail: '押品评估价值为 0，无法计算贷款价值比（LTV），商用房地产档位无法确定，将走兜底分支。' },

  { id: 'X0003', customer: 'B80007', name: '【模拟】评级未更新的同业对手', product: 'ib_time', anomaly: '字段缺失', raw: {
      glAcct: '2221010100', productCode: 'DUE/TIME', ccy: 'MOP', balance: 22000000, maturity: '20280331',
      custType: 'B', term: 18, counterpartyRating: '—', impairment: 0 },
    std: { instrument_type: 'claim', is_defaulted: 'no', counterparty_type: 'commercial_bank',
      balance: 22000000, impairment: 0, offbalance: 'no', original_maturity_months: 18,
      product_code: 'DUE/TIME' },
    anomalyDetail: '交易对手评级为空，银行档次（第一档/第二档）无法自动确定，需风险条线人工选定。' },
];

/* 原始 Excel 表头（用于「导入」步骤的表头识别演示） */
const RAW_SHEET_HEADERS = [
  'GL A/C No.', 'Customer', 'Customer Name', 'Contract', 'Product Code', 'Currency Code',
  'Value Date', 'Maturity Date', 'Value Balance', 'Value Balance(MOP)', 'Cust Type',
  'Industry Code', 'Collateral Type1', 'Collateral Value（MOP）1', 'Overdue Days',
  'Loan Class', 'Impairment', 'Enterprise Size', 'Revenue', 'Issuer Rating',
  'Off Balance', 'Credit Limit(MOP)', 'Drawn Amount(MOP)', 'Facility Type',
];

/* 产品识别规则：模拟"根据产品代码与业务类型自动识别产品类型" */
const PRODUCT_DETECT_RULES = [
  { match: /^TL\//, product: 'corp_loan', basis: '产品代码以 TL/ 开头（Term Loan），且客户类型为 C（公司）' },
  { match: /^RE\//, product: 'corp_loan', basis: '产品代码以 RE/ 开头（Real Estate），房地产贷款' },
  { match: /^MTG\//, product: 'personal_loan', basis: '产品代码以 MTG/ 开头（Mortgage），客户类型为 P（自然人）' },
  { match: /^PL\//, product: 'personal_loan', basis: '产品代码以 PL/ 开头（Personal Loan），客户类型为 P（自然人）' },
  { match: /^BND\//, product: 'bond', basis: '产品代码以 BND/ 开头，科目为 101x（债券投资）' },
  { match: /^DUE\/CALL/, product: 'ib_call', basis: '产品代码 DUE/CALL，科目为 212（存放同业活期）' },
  { match: /^DUE\/TIME/, product: 'ib_time', basis: '产品代码 DUE/TIME，科目为 222（存放同业定期）' },
  { match: /^OFF\//, product: 'off_bs', basis: '产品代码以 OFF/ 开头，属于表外授信及承诺' },
];

const MOCK_DATA = { MOCK_LOANS, MOCK_EXCEL_COLUMNS, RAW_SHEET_HEADERS, PRODUCT_DETECT_RULES };

if (typeof window !== 'undefined') window.MOCK = MOCK_DATA;
if (typeof module !== 'undefined' && module.exports) module.exports = MOCK_DATA;
})(typeof window !== "undefined" ? window : globalThis);
