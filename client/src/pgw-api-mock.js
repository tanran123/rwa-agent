const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const DICT_CP = { dict_code: "DICT_COUNTERPARTY_TYPE", dict_name: "交易对手类型", items: [{ code: "commercial_bank", label: "商业银行" }, { code: "corporate", label: "公司" }, { code: "pse", label: "公共部门实体" }] };
const DICT_FI = { dict_code: "DICT_FI_SUBTYPE", dict_name: "其他金融机构类型", items: [{ code: "securities", label: "证券公司" }, { code: "insurer", label: "保险公司" }] };
const DICT_AUDIT = { dict_code: "DICT_AUDIT", dict_name: "外部审计意见", items: [{ code: "none", label: "无报告" }, { code: "unqualified", label: "无保留" }] };
const RULE_SOV = { kind: "weight", ruleId: "sovereign", ruleLabel: "主权风险暴露", path: "result.exposure_class", whenText: "counterparty_type in 主权、央行、国际组织", note: "按交易对手类别确定是否归入主权风险暴露。", article: "附件2 第二部分" };
const RULE_FI = { kind: "weight", ruleId: "financial_institution", ruleLabel: "金融机构风险暴露", path: "result.exposure_class", whenText: "counterparty_type in 商业银行、其他金融机构", note: "商业银行还要继续判断资本充足条件。", article: "附件2 第二部分" };
const RULE_INV = { kind: "weight", ruleId: "investment_grade", ruleLabel: "投资级公司", path: "result.risk_weight", whenText: "audit_opinion = unqualified", note: "审计意见和财务条件共同决定是否适用投资级权重。", article: "附件2 第三部分" };

const STD_CP = { name: "counterparty_type", label: "交易对手", group: "交易对手", inputMode: "manual", type: "enum", description: "客户主数据中的交易对手类别。" };
const STD_FI = { name: "fi_subtype", label: "其他金融机构类型", group: "交易对手", inputMode: "manual", type: "enum", description: "其他金融机构的具体种类。" };

const FIELDS = [
  {
    name: "counterparty_type", label: "交易对手", type: "enum", required: true, systemCalc: false, mapped: true,
    usedBy: [RULE_SOV, RULE_FI],
    profile: {
      definition: "债务人属于哪一类主体。财政部对 cn_central_government，人民银行对 cn_central_bank。",
      note: "表头可能叫客户类型、发行人类型。", type: "enum", source: "column", required: true, missingPolicy: "manual",
      options: DICT_CP.items, dictionary: DICT_CP, systemCalc: false, derivation: null, parameterRefs: [], mapped: true,
      standardField: STD_CP, mapping: { sourceField: "counterparty_type", mappingType: "direct", transform: { type: "direct" }, reason: "主数据列名和码值可直接对应。", regulatoryReference: "附件2 第二部分" }
    }
  },
  {
    name: "fi_subtype", label: "其他金融机构类型", type: "enum", required: false, systemCalc: false, mapped: false,
    usedBy: [RULE_FI],
    profile: {
      definition: "其他金融机构的具体种类，仅当交易对手是其他金融机构时需要。", note: "", type: "enum", source: "column",
      required: false, missingPolicy: "", options: DICT_FI.items, dictionary: DICT_FI, systemCalc: false,
      derivation: null, parameterRefs: [], mapped: false, standardField: null, mapping: null
    }
  },
  {
    name: "annual_audit_opinion", label: "最新年报审计意见", type: "enum", required: true, systemCalc: false, mapped: false,
    usedBy: [RULE_INV],
    profile: {
      definition: "该公司或该机构最新年报的审计意见。投资级要求无保留 unqualified。", note: "这和商业银行评级用的 audit_opinion 不是同一列。",
      type: "enum", source: "column", required: true, missingPolicy: "manual", options: DICT_AUDIT.items, dictionary: DICT_AUDIT,
      systemCalc: false, derivation: null, parameterRefs: [], mapped: false, standardField: null, mapping: null
    }
  }
];

const DECISIONS = [
  { targetField: "counterparty_type", targetLabel: "交易对手", decisionType: "reuse", standardField: STD_CP, mapping: { sourceField: "counterparty_type", mappingType: "direct", transform: { type: "direct" }, reason: "主数据列名和码值可直接对应。" }, dictionary: DICT_CP, confidence: 0.96, reason: "产品主数据列名和码值可直接对应，历史映射已验证。", ruleReason: "主权、金融机构和公司规则都先读这个字段。" },
  { targetField: "fi_subtype", targetLabel: "其他金融机构类型", decisionType: "create", standardField: STD_FI, mapping: { sourceField: "客户细类", mappingType: "code_mapping", transformType: "code_mapping", transform: { type: "code_mapping", mapping: { "证券公司": "securities", "保险公司": "insurer" }, onUnmappedCode: "manual" }, reason: "客户细类码值与监管机构种类不是一套。" }, dictionary: DICT_FI, confidence: 0.84, reason: "产品表有客户细类，但没有监管口径的其他金融机构类型。", ruleReason: "其他金融机构需要按具体机构种类进入不同子规则。" },
  { targetField: "annual_audit_opinion", targetLabel: "最新年报审计意见", decisionType: "missing", standardField: null, mapping: null, confidence: 0.35, reason: "产品表没有年报审计意见列，底稿也未提供。", ruleReason: "投资级公司要求最近一年年报审计意见为无保留。" }
];

const PROPOSAL = {
  id: "PROP-MOCK-02",
  summary: "本组 3 个监管字段：复用 1、新建 1、缺失 1",
  groupPurpose: "复用交易对手主数据，新增金融机构子类，缺失项留给人工确认。",
  decisions: DECISIONS,
  standardFields: [STD_CP, STD_FI],
  mappings: [
    { targetField: "counterparty_type", sourceField: "counterparty_type", mappingType: "direct" },
    { targetField: "fi_subtype", sourceField: "客户细类", mappingType: "code_mapping" }
  ],
  newDictionaries: [DICT_FI],
  newStandardGroups: [{ group_id: "GRP_COUNTERPARTY", label: "交易对手分类", description: "商业银行和其他金融机构共用的交易对手字段。" }],
  fieldNotes: DECISIONS.map((item) => ({ targetField: item.targetField, purpose: item.ruleReason, standardField: item.standardField ? item.standardField.name : "不建标准字段", mappingType: item.decisionType })),
  missing: [{ targetField: "annual_audit_opinion", reason: "产品表没有年报审计意见列，底稿也未提供。", suggestedField: "annual_audit_opinion" }],
  suggestions: ["fi_subtype 需要人工确认口径后再建字段。"],
  warnings: ["产品表中「评级」列同时包含发行人评级和债项评级，已按字段含义拆分决策。"]
};
const SELECTION = { decisions: ["counterparty_type", "fi_subtype"], fields: ["counterparty_type", "fi_subtype"], mappings: ["counterparty_type", "fi_subtype"], dictionaries: ["DICT_FI_SUBTYPE"] };
const FINDINGS = [
  { id: "USER_CONSTRAINT:fi_subtype", code: "USER_CONSTRAINT", severity: "error", targetField: "fi_subtype", message: "用户约束为不新建标准字段", suggestedAction: "改为复用或跳过" },
  { id: "REQUIRED_UNMAPPED:annual_audit_opinion", code: "REQUIRED_UNMAPPED", severity: "error", targetField: "annual_audit_opinion", message: "必填监管字段没有决策", suggestedAction: "补充字段决策" }
];
const CONFLICTS = [{ code: "NO_NEW_FIELDS", targetField: "fi_subtype", message: "用户约束为不新建标准字段" }];
const DIFF = { addedDecisions: ["fi_subtype"], changedDecisions: ["counterparty_type"], removedDecisions: [], addedDictionaries: ["DICT_FI_SUBTYPE"] };
const PLAN = [
  { id: "g_business", label: "业务品种与资产形态", stats: { fields: 4, required: 2, unmapped: 1 } },
  { id: "g_counterparty", label: "交易对手类型", stats: { fields: 3, required: 2, unmapped: 2 } },
  { id: "g_bank", label: "商业银行资本与审计", stats: { fields: 4, required: 3, unmapped: 4 } }
];
const BRIEF = { id: "g_counterparty", label: "交易对手类型", description: "按交易对手主体类别进入主权、金融机构和公司规则。", stats: { fields: 3, required: 2, unmapped: 2 }, fields: FIELDS };

function resultPayload() {
  return {
    intent: "propose", confidence: 0.88,
    plan: [{ type: "propose" }, { type: "review", scope: "group" }],
    proposal: PROPOSAL, selection: SELECTION, reviewFindings: FINDINGS, conflicts: CONFLICTS,
    diff: DIFF, requiresApproval: true, proposalId: PROPOSAL.id,
    message: "本组 3 个监管字段：复用 1、新建 1、缺失 1。建议复用交易对手主数据，新增金融机构子类，缺失项留给人工确认。"
  };
}

export function assistProductGroup(body) {
  const action = body && body.action;
  if (action === "plan") return delay(30).then(() => ({ stage: "plan", groups: PLAN }));
  if (action === "brief") return delay(30).then(() => ({ stage: "brief", group: { ...BRIEF, id: body.groupId, label: (PLAN.find((item) => item.id === body.groupId) || BRIEF).label } }));
  return delay(30).then(() => ({ message: "mock", ...resultPayload() }));
}
export async function assistProductGroupStream(body, handlers = {}) {
  handlers.result && handlers.result(resultPayload());
}
export async function assistProductGroupWorkflow(body, handlers = {}, signal) {
  const text = String((body && body.text) || "");
  if (text.includes("？") || text.includes("什么")) {
    handlers.intent && handlers.intent({ intent: { type: "answer", confidence: 0.8 } });
    handlers.result && handlers.result({ intent: "answer", message: "交易对手字段用于识别债务人主体类别，决定主权、金融机构和公司等规则分支。" });
    return;
  }
  handlers.intent && handlers.intent({ intent: { type: "propose", confidence: 0.88 } });
  handlers.plan && handlers.plan({ plan: [{ type: "propose" }, { type: "review", scope: "group" }] });
  handlers.status && handlers.status({ stage: "reading_group", message: "正在读取本组字段、字典和映射…", total: FIELDS.length });
  await delay(60);
  if (signal && signal.aborted) return;
  for (let index = 0; index < DECISIONS.length; index += 1) {
    handlers.decision && handlers.decision({ decision: DECISIONS[index], done: index + 1, total: DECISIONS.length });
    await delay(40);
    if (signal && signal.aborted) return;
  }
  handlers.field && handlers.field({ field: STD_CP });
  handlers.field && handlers.field({ field: STD_FI });
  handlers.mapping && handlers.mapping({ mapping: PROPOSAL.mappings[0] });
  handlers.mapping && handlers.mapping({ mapping: PROPOSAL.mappings[1] });
  handlers.dictionary && handlers.dictionary({ dictionary: DICT_FI });
  FINDINGS.forEach((finding) => handlers.review && handlers.review({ finding }));
  CONFLICTS.forEach((conflict) => handlers.conflict && handlers.conflict({ conflict }));
  handlers.diff && handlers.diff({ diff: DIFF });
  handlers.proposal && handlers.proposal({ proposal: PROPOSAL });
  handlers.approval_required && handlers.approval_required();
  handlers.result && handlers.result(resultPayload());
}
export async function assistProductGroupWorkflowResume(body, handlers = {}) {
  const result = resultPayload();
  result.requiresApproval = false;
  result.conflicts = [];
  handlers.result && handlers.result(result);
}
