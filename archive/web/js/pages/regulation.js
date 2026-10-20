/* 监管版本页 */
function openExpFlowModal(kind, productKey, mode) {
  let k = "base";
  if (kind === "overview") k = "overview";
  else if (kind === "product") k = "product";
  const m = {
    kind: k,
    mode: (k !== "overview" && mode === "edit") ? "edit" : "view",
    err: ""
  };
  if (m.kind === "product") {
    m.productKey = productKey || state.product;
    if (!PRODUCTS[m.productKey]) return;
    ensureProductExpFlow(m.productKey);
  }
  state.expFlowModal = m;
}

function saveExpFlowModalJson() {
  const m = state.expFlowModal;
  if (!m || m.kind === "overview") return false;
  const ta = document.getElementById("expFlowModalJson");
  if (!ta) return false;
  let parsed;
  try {
    parsed = JSON.parse(ta.value);
  } catch (err) {
    m.err = "未保存。JSON 无法解析：" + (err && err.message ? err.message : String(err));
    return false;
  }
  const flowErrors = [];
  validateFlowJson(parsed, flowErrors);
  if (flowErrors.length) {
    m.err = formatJsonErrors(flowErrors);
    return false;
  }
  if (!parsed || typeof parsed !== "object") {
    m.err = "流程 JSON 必须是对象。";
    return false;
  }
  if (m.kind === "base") {
    let next;
    if (isLogicFlowJson(parsed)) {
      next = logicJsonToFlow(parsed, BASE_EXP_TEMPLATE);
    } else if (isRulesDoc(parsed)) {
      next = rulesDocToFlow(parsed, BASE_EXP_TEMPLATE);
    } else if (Array.isArray(parsed.categories)) {
      next = parsed;
    } else {
      m.err = "请保留 layers（逻辑视图）、categories 或 rules。";
      return false;
    }
    Object.keys(BASE_EXP_TEMPLATE).forEach((k) => { delete BASE_EXP_TEMPLATE[k]; });
    Object.assign(BASE_EXP_TEMPLATE, next);
    BASE_EXP_TEMPLATE.ref = false;
    if (!BASE_EXP_TEMPLATE.head || !BASE_EXP_TEMPLATE.head.length) {
      BASE_EXP_TEMPLATE.head = [
        { id: "proc:start", type: "process", label: "开始判定", content: { note: "标准字段已就绪" } },
        { id: "proc:product", type: "process", label: "识别产品", content: { note: "按产品类型进入对应瀑布" } }
      ];
    }
    m.err = "";
    m.mode = "view";
    state.expMsg = "通用流程的字段与公式已更新。";
    return true;
  }
  const key = m.productKey || state.product;
  const prod = PRODUCTS[key];
  if (!prod) {
    m.err = "产品不存在。";
    return false;
  }
  if (parsed.ref === true || parsed.mode === "ref") {
    prod.expFlow = makeExpFlowRef();
    m.err = "";
    m.mode = "view";
    state.expMsg = "「" + prod.label + "」已设为引用通用流程。";
    return true;
  }
  let nextFlow;
  if (isLogicFlowJson(parsed)) {
    const fallback = isExpFlowRef(prod.expFlow) ? BASE_EXP_TEMPLATE : prod.expFlow;
    nextFlow = logicJsonToFlow(parsed, fallback);
  } else if (isRulesDoc(parsed)) {
    const fallback = isExpFlowRef(prod.expFlow) ? BASE_EXP_TEMPLATE : prod.expFlow;
    nextFlow = rulesDocToFlow(parsed, fallback);
  } else if (Array.isArray(parsed.categories)) {
    nextFlow = parsed;
  } else {
    m.err = "请保留 layers（逻辑视图）、categories 或 rules；或设 mode:\"ref\"。";
    return false;
  }
  nextFlow.id = nextFlow.id || ("exp_flow_" + key);
  nextFlow.name = nextFlow.name || (prod.label + " · 分类流程");
  nextFlow.based_on = nextFlow.based_on || BASE_EXP_TEMPLATE.id;
  nextFlow.ref = false;
  nextFlow.customized = true;
  if (!nextFlow.head) nextFlow.head = cloneExpFlow(BASE_EXP_TEMPLATE).head;
  prod.expFlow = nextFlow;
  m.err = "";
  m.mode = "view";
  state.expMsg = isRulesDoc(parsed)
    ? ("「" + prod.label + "」已按规则文件写入分类瀑布。")
    : ("「" + prod.label + "」字段与公式已保存。");
  return true;
}

function regionCode(region) {
  if (region === "香港") return "HK";
  if (region === "澳门") return "MO";
  return "CN";
}

function createRegulationVersion(draft) {
  const region = draft.region || "中国大陆";
  const code = regionCode(region);
  let id = code + "-" + String(draft.from || todayIso()).slice(0, 4);
  if (VERSIONS.some((v) => v.id === id)) id = id + "-" + String(Date.now()).slice(-4);
  const updatedAt = draft.updatedAt || todayIso();
  const kbSpace = draft.kbSpace || ("信用风险 · " + id);
  const ver = {
    id: id,
    region: region,
    name: draft.name || (region + " 监管规则 " + id),
    shortName: draft.shortName || draft.name || id,
    authority: region === "香港" ? "香港金融管理局（HKMA）" : region === "澳门" ? "澳门金融管理局（AMCM）" : "国家金融监督管理总局",
    basis: "由监管版本页新建 · 对齐知识库截取时点 " + updatedAt,
    reg: id.replace(/-/g, "_"),
    from: draft.from || todayIso(),
    to: draft.to && draft.to.trim() ? draft.to.trim() : "—",
    status: draft.status || "草案",
    rules: 0,
    bankTiers: region === "中国大陆" ? ["第一档银行", "第二档银行"] : ["本地银行（示意）"],
    methods: ["信用风险权重法", "表外 CCF", "CRM 缓释"],
    packs: [
      { name: "暴露分类", count: 0, desc: "待从知识库抽取" },
      { name: "风险权重", count: 0, desc: "待从知识库抽取" },
      { name: "CCF", count: 0, desc: "待从知识库抽取" },
      { name: "CRM 缓释", count: 0, desc: "待从知识库抽取" }
    ],
    useWhen: "新建版本，规则以知识空间「" + kbSpace + "」在 " + updatedAt + " 的截取为准；问答也将引用该时点。",
    note: draft.note || "持续更新时刷新「知识库截取时点」即可，写入均为静默同步。",
    updatedAt: updatedAt,
    kbSpace: kbSpace,
    kbClient: {},
    kbGlobal: { synced: false, at: "" }
  };
  VERSIONS.unshift(ver);
  return ver;
}

function renderRegCreateModal() {
  const d = state.regDraft;
  const body = "<p class=\"lead\">规则会持续修订：除「生效日」外，必须登记<strong>知识库截取时点</strong>。"
    + "知识库按截取时点锁定口径，不绑定本地文档。</p>"
    + "<div class=\"reg-form-grid\">"
    + "<div class=\"field grow\"><label>版本名称</label><input id=\"regName\" value=\"" + esc(d.name) + "\" placeholder=\"如：资本管理办法（2026 修订）\" /></div>"
    + "<div class=\"field\"><label>短名称</label><input id=\"regShort\" value=\"" + esc(d.shortName) + "\" placeholder=\"列表显示名\" /></div>"
    + "<div class=\"field\"><label>监管地区</label><select id=\"regRegionSel\">"
    + ["中国大陆", "香港", "澳门"].map((r) =>
      "<option value=\"" + esc(r) + "\"" + (d.region === r ? " selected" : "") + ">" + esc(r) + "</option>"
    ).join("")
    + "</select></div>"
    + "<div class=\"field\"><label>状态</label><select id=\"regStatusSel\">"
    + ["草案", "生效中", "已失效"].map((s) =>
      "<option value=\"" + esc(s) + "\"" + (d.status === s ? " selected" : "") + ">" + esc(s) + "</option>"
    ).join("")
    + "</select></div>"
    + "<div class=\"field\"><label>生效日</label><input id=\"regFrom\" type=\"date\" value=\"" + esc(d.from) + "\" /></div>"
    + "<div class=\"field\"><label>失效日（可空=持续有效）</label><input id=\"regTo\" type=\"date\" value=\"" + esc(d.to || "") + "\" /></div>"
    + "<div class=\"field\"><label>知识库截取时点 <span class=\"req\">必填</span></label>"
    + "<input id=\"regUpdatedAt\" type=\"date\" value=\"" + esc(d.updatedAt || todayIso()) + "\" /></div>"
    + "<div class=\"field full\"><label>说明</label><input id=\"regNote\" value=\"" + esc(d.note) + "\" placeholder=\"本次修订要点\" /></div>"
    + "</div>"
    + "<div class=\"banner\" style=\"margin-top:12px\">创建后自动静默同步到知识库（本客户 + 全部检索），供智能体问答。</div>";
  return modalShell({
    wide: true,
    title: "新建监管版本",
    sub: "弹出填写，不挤占当前列表与详情。",
    body: body,
    foot: "<button type=\"button\" class=\"btn\" data-modal-dismiss>取消</button>"
      + "<button type=\"button\" class=\"btn btn-primary\" data-reg-create-save>创建版本</button>"
  });
}

function renderParamCreateModal() {
  const d = state.paramDraft;
  const groups = Array.from(new Set(PARAMS.map((p) => p.group)));
  const body = "<p class=\"lead\">新增参数供权重 / LTV 等规则引用，不改规则结构。保存后静默写入知识库。</p>"
    + "<div class=\"reg-form-grid\">"
    + "<div class=\"field\"><label>参数 ID</label><input id=\"paramId\" value=\"" + esc(d.id) + "\" placeholder=\"如 SHORT_6M\" /></div>"
    + "<div class=\"field\"><label>分组</label><select id=\"paramGroup\">"
    + groups.map((g) => "<option value=\"" + esc(g) + "\"" + (d.group === g ? " selected" : "") + ">" + esc(g) + "</option>").join("")
    + "</select></div>"
    + "<div class=\"field\"><label>名称</label><input id=\"paramName\" value=\"" + esc(d.name) + "\" placeholder=\"显示名称\" /></div>"
    + "<div class=\"field\"><label>值</label><input id=\"paramValue\" value=\"" + esc(d.value) + "\" placeholder=\"如 60%\" /></div>"
    + "<div class=\"field\"><label>单位</label><input id=\"paramUnit\" value=\"" + esc(d.unit) + "\" placeholder=\"%、月、RW\" /></div>"
    + "<div class=\"field full\"><label>用途说明</label><input id=\"paramUsed\" value=\"" + esc(d.used) + "\" placeholder=\"被哪些规则引用\" /></div>"
    + "</div>";
  return modalShell({
    title: "新增规则参数",
    body: body,
    foot: "<button type=\"button\" class=\"btn\" data-modal-dismiss>取消</button>"
      + "<button type=\"button\" class=\"btn btn-primary\" data-param-create-save>保存参数</button>"
  });
}

function pageRegulation() {
  const list = VERSIONS.filter((v) => state.regRegion === "全部" || v.region === state.regRegion);
  const ver = VERSIONS.find((v) => v.id === state.selectedVersion) || list[0] || VERSIONS[0];
  const statusClass = ver.status === "生效中" ? "ok" : ver.status === "草案" ? "warn" : "muted";
  const periodText = !ver.to || ver.to === "—"
    ? ("自 " + ver.from + " 起持续有效")
    : (ver.from + " 至 " + ver.to);
  const allRules = versionRules(ver.id);
  const filteredRules = ensureRegRuleSelection(ver);
  const selectedRule = filteredRules.find((r) => r.id === state.regRuleId) || null;
  const packFilter = state.regPackView || "全部";
  const packs = ["全部"].concat((ver.packs || []).map((p) => p.name)).map((name) => {
    const meta = (ver.packs || []).find((p) => p.name === name);
    const count = name === "全部"
      ? allRules.length
      : allRules.filter((r) => r.pack === name).length || (meta ? meta.count : 0);
    const desc = name === "全部" ? "查看本版本全部规则" : (meta ? meta.desc : "");
    return "<button type=\"button\" class=\"reg-pack" + (packFilter === name ? " active" : "") + "\" data-reg-pack=\"" + esc(name) + "\">"
      + "<strong>" + esc(name) + "</strong>"
      + "<span>" + count + " 条 · " + esc(desc) + "</span></button>";
  }).join("");
  const ruleListHtml = filteredRules.length
    ? filteredRules.map((r) =>
      "<button type=\"button\" class=\"reg-rule-item" + (selectedRule && selectedRule.id === r.id ? " active" : "") + "\" data-reg-rule=\"" + esc(r.id) + "\">"
      + "<strong>" + esc(r.title) + "</strong>"
      + "<span>" + esc(r.id) + " · " + esc(r.pack) + "</span></button>"
    ).join("")
    : "<div class=\"banner\" style=\"margin:12px\">该规则包暂无明细，可在知识库补充后同步。</div>";
  const ruleDetailHtml = selectedRule
    ? ("<div class=\"rule-id\">" + esc(selectedRule.id) + " · " + esc(selectedRule.pack) + "</div>"
      + "<h4>" + esc(selectedRule.title) + "</h4>"
      + "<div class=\"rule-body\">" + esc(selectedRule.body) + "</div>"
      + "<div class=\"rule-meta\">依据：" + esc(selectedRule.cite || "—")
      + " · 版本 " + esc(ver.shortName || ver.name)
      + " · 截取时点 " + esc(ver.updatedAt || "—") + "</div>")
    : "<p style=\"margin:0;color:var(--muted);font-size:13px\">请选择左侧规则查看全文。</p>";
  const tierTags = (ver.bankTiers || []).map((t) => "<span class=\"tag accent\">" + esc(t) + "</span> ").join("");
  const methodTags = (ver.methods || []).map((m) => "<span class=\"tag\">" + esc(m) + "</span> ").join("");
  const customer = currentCustomer();
  silentSyncVersion(ver);
  const clientOk = verClientSynced(ver);
  const globalOk = verGlobalSynced(ver);

  return ph("regulation", "<div class=\"head-actions\">"
    + "<button type=\"button\" class=\"btn btn-primary\" data-reg-create=\"1\">新建版本</button></div>")
    + (state.regMsg ? "<div class=\"banner ok\">" + esc(state.regMsg) + "</div>" : "")
    + (state.regCreateOpen ? renderRegCreateModal() : "")
    + "<div class=\"banner\">当前客户 <strong>" + esc(customer.name) + "</strong>（" + esc(customer.category) + " · " + esc(customer.code) + "）。"
    + "打开版本或切换客户时<strong>静默同步</strong>到知识库（本客户 + 全部检索）。所有上传均为静默，无需确认。</div>"
    + "<div class=\"tabs\">"
    + ["全部", "中国大陆", "香港", "澳门"].map((r) =>
      "<button type=\"button\" data-reg-region=\"" + esc(r) + "\" class=\"" + (state.regRegion === r ? "active" : "") + "\">" + esc(r) + "</button>"
    ).join("")
    + "</div>"
    + "<div class=\"split split-wide\">"
    + "<div class=\"versions\">"
    + list.map((v) =>
      "<div class=\"ver" + (ver.id === v.id ? " active" : "") + "\" data-version=\"" + esc(v.id) + "\">"
      + "<span class=\"ver-dot\"></span><div>"
      + "<strong>" + esc(v.shortName || v.name) + "</strong>"
      + "<span>" + esc(v.region) + " · <span class=\"tag " + (v.status === "生效中" ? "ok" : v.status === "草案" ? "warn" : "muted") + "\">"
      + esc(v.status) + "</span> · 已录入 " + versionRules(v.id).length + " 条</span>"
      + "<span style=\"display:block;margin-top:2px\">更新 " + esc(v.updatedAt || "—")
      + (verClientSynced(v) ? " · <span class=\"tag ok\">本客户</span>" : " · <span class=\"tag warn\">同步中</span>")
      + (verGlobalSynced(v) ? " · <span class=\"tag accent\">全部检索</span>" : "")
      + "</span>"
      + "</div></div>"
    ).join("")
    + (list.length ? "" : "<div class=\"banner\">该区域暂无版本。</div>")
    + "</div>"
    + "<div class=\"panel\">"
    + "<div class=\"reg-hero\">"
    + "<div><h2>" + esc(ver.name) + "</h2>"
    + "<p>" + esc(ver.note || "") + "</p></div>"
    + "<span class=\"tag " + statusClass + "\" style=\"font-size:13px;padding:6px 10px\">" + esc(ver.status) + "</span>"
    + "</div>"
    + "<div class=\"reg-facts\">"
    + "<div class=\"reg-fact\"><label>监管地区</label><strong>" + esc(ver.region) + "</strong><small>" + esc(ver.authority) + "</small></div>"
    + "<div class=\"reg-fact\"><label>生效区间</label><strong>" + esc(periodText) + "</strong><small>版本编号 " + esc(ver.id) + "</small></div>"
    + "<div class=\"reg-fact\"><label>知识库截取时点</label><strong>" + esc(ver.updatedAt || "—") + "</strong>"
    + "<small>持续修订时以此锁定问答与计算口径</small></div>"
    + "<div class=\"reg-fact\"><label>规则条数</label><strong>" + allRules.length + " 条</strong><small>"
    + (ver.id === "CN-2025" ? "按权重 / CCF / CRM / 参数表现算" : "本版本自有说明") + "</small></div>"
    + "</div>"
    + "<details class=\"reg-tech\">"
    + "<summary>改这一版的说明</summary>"
    + "<div class=\"inner\">"
    + "<p style=\"margin:0 0 10px\">"
    + (ver.id === "CN-2025"
      ? "这里只改状态、日期和版本说明。权重、CCF、缓释和参数不要在这里再写一遍，去对应菜单改，下面的明细会跟着变。"
      : "这里改状态、日期和版本说明。这一版的规则正文仍是占位，不另写一套数字。")
    + "</p>"
    + "<div class=\"field\"><label>状态</label><select id=\"regEditStatus\">"
    + ["生效中", "草案", "已失效"].map(function (s) {
      return "<option value=\"" + s + "\"" + (ver.status === s ? " selected" : "") + ">" + s + "</option>";
    }).join("")
    + "</select></div>"
    + "<div class=\"field\"><label>生效日</label><input id=\"regEditFrom\" value=\"" + esc(ver.from || "") + "\" /></div>"
    + "<div class=\"field\"><label>失效日</label><input id=\"regEditTo\" value=\"" + esc(ver.to || "") + "\" placeholder=\"持续有效填 —\" /></div>"
    + "<div class=\"field\"><label>截取时点</label><input id=\"regEditAt\" value=\"" + esc(ver.updatedAt || "") + "\" /></div>"
    + "<div class=\"field\"><label>版本说明</label><textarea id=\"regEditNote\" rows=\"3\">" + esc(ver.note || "") + "</textarea></div>"
    + "<button type=\"button\" class=\"btn btn-primary\" data-maint-save=\"version\" data-maint-id=\"" + esc(ver.id) + "\">保存版本说明</button>"
    + "</div></details>"
    + "<div class=\"reg-section\">"
    + "<h3>知识库 · 规则明细</h3>"
    + "<p>" + (ver.id === "CN-2025"
      ? "内地 2025 先列出来源文件，其余明细由风险权重、CCF、CRM、规则参数四张表现算。改数字或条件去对应菜单。"
      : (ver.id === "MO-2026"
        ? "澳门这一版用来演示知识库：三份金管局文件，加上已经解读出的五条计算规则和标准法权重。随函报表没有附上，不写填报行号。"
        : "按规则包查看已录入的规则说明。计算和问答用的是这一版在截取时点下的同一套规则，不另编条款号。")) + "</p>"
    + "<div class=\"reg-packs\">" + packs + "</div>"
    + "<div class=\"reg-rule-layout\">"
    + "<div class=\"reg-rule-list\">" + ruleListHtml + "</div>"
    + "<div class=\"reg-rule-detail\">" + ruleDetailHtml + "</div>"
    + "</div>"
    + "<div class=\"reg-kb\" style=\"margin-top:12px\">"
    + "<div class=\"kb-mark\">本</div>"
    + "<div><strong>本客户 · " + esc(customer.name) + "</strong>"
    + "<span>" + (clientOk
      ? ("已同步 · " + esc((ver.kbClient[state.clientId] || {}).at || ver.updatedAt || "—") + " · 仅本客户工作区 / 问答")
      : "同步中…")
    + "</span></div>"
    + "</div>"
    + "<div class=\"reg-kb\" style=\"margin-top:10px\">"
    + "<div class=\"kb-mark\" style=\"background:#e8f3ef;color:#134e3a\">全</div>"
    + "<div><strong>全部检索 · 全局库</strong>"
    + "<span>" + (globalOk
      ? ("已同步 · " + esc((ver.kbGlobal || {}).at || ver.updatedAt || "—") + " · 跨客户问答可命中")
      : "同步中…")
    + "</span></div>"
    + "</div>"
    + "<p style=\"margin:10px 0 0;font-size:12px;color:var(--muted)\">知识空间 <span class=\"mono\">" + esc(ver.kbSpace || "知识库") + "</span>"
    + " · 截取时点 <span class=\"mono\">" + esc(ver.updatedAt || "—") + "</span></p>"
    + "</div>"
    + "<div class=\"reg-meta-strip\">"
    + "<div class=\"meta-block\"><span class=\"meta-label\">适用</span>" + tierTags + "</div>"
    + "<span class=\"meta-sep\" aria-hidden=\"true\"></span>"
    + "<div class=\"meta-block\"><span class=\"meta-label\">方法</span>" + methodTags + "</div>"
    + "<span class=\"meta-sep\" aria-hidden=\"true\"></span>"
    + "<div class=\"meta-block\" style=\"flex:1;min-width:180px\"><span class=\"meta-label\">依据</span>"
    + "<span>" + esc(ver.basis) + "</span></div>"
    + "</div>"
    + "<div class=\"reg-more\">"
    + "<details class=\"reg-tech\">"
    + "<summary>版本说明与追溯口径</summary>"
    + "<div class=\"inner\">"
    + "<p style=\"margin:0 0 8px\">" + esc(ver.useWhen) + "</p>"
    + "<p style=\"margin:0 0 6px;font-size:12px;color:var(--muted)\">结果追溯时锁定：</p>"
    + "<ul class=\"reg-steps\" style=\"padding-left:1.1em\">"
    + "<li>版本 <strong>" + esc(ver.shortName || ver.name) + "</strong> · 截取时点 <strong>" + esc(ver.updatedAt || "—") + "</strong></li>"
    + "<li>命中规则编号（如 " + esc((allRules[0] || {}).id || "RW-xxx") + "）与知识空间</li>"
    + "<li>问答按同一版本 + 时点检索，避免用到后来修订的条款</li>"
    + "</ul>"
    + "<p style=\"margin:10px 0 0;font-size:12px;color:var(--muted)\">计算页「结果追溯」会自动带出版本与规则链，此处仅作口径说明。</p>"
    + "</div></details>"
    + "<details class=\"reg-tech\">"
    + "<summary>机器配置（开发 / 对接）</summary>"
    + "<div class=\"inner\">"
    + "<div class=\"dsl\"><span class=\"kw\">版本编号</span>: <span class=\"val\">" + esc(ver.id) + "</span>\n"
    + "<span class=\"kw\">生效日</span>: <span class=\"val\">" + esc(ver.from) + "</span>\n"
    + "<span class=\"kw\">失效日</span>: <span class=\"val\">" + esc(ver.to) + "</span>\n"
    + "<span class=\"kw\">知识库截取时点</span>: <span class=\"val\">" + esc(ver.updatedAt || "") + "</span>\n"
    + "<span class=\"kw\">知识空间</span>: <span class=\"val\">" + esc(ver.kbSpace || "") + "</span>\n"
    + "<span class=\"kw\">本客户同步</span>: <span class=\"val\">" + (clientOk ? "true" : "false") + "</span>\n"
    + "<span class=\"kw\">全部检索</span>: <span class=\"val\">" + (globalOk ? "true" : "false") + "</span>\n"
    + "<span class=\"kw\">客户</span>: <span class=\"val\">" + esc(state.clientId) + "</span>\n"
    + "<span class=\"kw\">行业</span>: <span class=\"val\">" + esc(customer.category || "") + "</span></div>"
    + "</div></details>"
    + "</div>"
    + "</div></div>";
}

const WEIGHT_RESULT_TYPES = [
  ["const", "固定百分比"],
  ["counterparty", "查交易对手"],
  ["max", "与固定值取较大"],
  ["unspecified", "权重表未列明"]
];

function condEditorHtml(conds, prefix) {
  const ops = ["=", "≠", "≤", "≥", "<", ">", "in"];
  const fields = Object.keys(FIELD_LABEL);
  return (conds || []).map(function (c, i) {
    if (c.text && !c.field) {
      return "<div class=\"field\"><label>条件说明</label><input id=\"" + prefix + "Text" + i + "\" value=\"" + esc(c.text) + "\" /></div>";
    }
    const pickedOp = condOperator(c);
    const pickedParam = condParamId(c);
    const shownValue = pickedParam ? "" : (Array.isArray(c.value) ? c.value.join(" | ") : (typeof c.value === "boolean" ? (c.value ? "true" : "false") : (c.value == null ? "" : c.value)));
    const fieldOpts = fields.map(function (fid) {
      return "<option value=\"" + esc(fid) + "\"" + (c.field === fid ? " selected" : "") + ">"
        + esc((FIELD_LABEL[fid] || fid) + " · " + fid) + "</option>";
    }).join("");
    const opOpts = ops.map(function (op) {
      return "<option" + (pickedOp === op ? " selected" : "") + ">" + op + "</option>";
    }).join("");
    const paramOpts = "<option value=\"\">手填比较值</option>" + PARAMS.map(function (p) {
      return "<option value=\"" + esc(p.id) + "\"" + (pickedParam === p.id ? " selected" : "") + ">"
        + esc(p.name + " · " + paramShown(p.id)) + "</option>";
    }).join("");
    return "<div class=\"field\"><label>条件 " + (i + 1) + "</label><select id=\"" + prefix + "Field" + i + "\">" + fieldOpts + "</select></div>"
      + "<div class=\"field\"><label>比较</label><div style=\"display:flex;gap:8px\">"
      + "<select id=\"" + prefix + "Op" + i + "\" style=\"width:72px\">" + opOpts + "</select>"
      + "<select id=\"" + prefix + "Param" + i + "\" style=\"flex:1\">" + paramOpts + "</select></div></div>"
      + "<div class=\"field\"><label>比较值</label><input id=\"" + prefix + "Value" + i + "\" value=\"" + esc(shownValue) + "\" />"
      + "<div style=\"font-size:11px;color:var(--muted);margin-top:4px\">选了参数就用参数的当前值，比较值留空。</div></div>";
  }).join("");
}

function readCondEditor(prefix, prev) {
  return (prev || []).map(function (c, i) {
    const textEl = document.getElementById(prefix + "Text" + i);
    if (textEl && !c.field) {
      const text = String(textEl.value || "").trim();
      return text ? { text: text } : null;
    }
    const field = maintField(prefix + "Field" + i);
    const op = maintField(prefix + "Op" + i) || "=";
    const param = maintField(prefix + "Param" + i);
    const value = maintField(prefix + "Value" + i);
    if (!field) return null;
    const item = { field: field, operator: op, op: op };
    if (param) {
      item.param = param;
      item.value = { param: param };
    } else if (value === "true" || value === "false") item.value = value === "true";
    else if (op === "in") item.value = value.split("|").map(function (s) { return s.trim(); }).filter(Boolean);
    else item.value = value;
    return item;
  }).filter(Boolean);
}

function syncMoRegulation() {
  const rules = VERSION_RULES["MO-2026"] || [];
  function setBody(id, body) {
    const hit = rules.find(function (r) { return r.id === id; });
    if (hit) hit.body = body;
  }
  MO_WEIGHTS.forEach(function (r) {
    if (r.id === "MO-RW-BANK-ST") return;
    if (r.id === "MO-RW-ZERO") {
      setBody(r.id, "发行人是中华人民共和国财政部时，风险权重直接为 " + (r.weights[0] || "0%") + "，不再查评级档。");
      return;
    }
    if (r.id === "MO-RW-BANK") {
      const st = MO_WEIGHTS.find(function (x) { return x.id === "MO-RW-BANK-ST"; });
      setBody(r.id, "一般期限：" + r.weights.join("、") + "。\n剩余期限不超过 3 个月的短期档：" + (st ? st.weights.join("、") : "") + "。");
      return;
    }
    setBody(r.id, "Grade 1 至 6、未评级：" + r.weights.join("、") + "。\n这组数字来自已读过的样例，不是通告正文里的行号。");
  });
}

function pageMoWeights() {
  const head = MO_GRADES.map(function (g) { return "<th>" + esc(g) + "</th>"; }).join("");
  const rows = MO_WEIGHTS.map(function (r) {
    const cells = r.weights.map(function (w, i) {
      return "<td><input data-mo-id=\"" + esc(r.id) + "\" data-mo-i=\"" + i + "\" value=\"" + esc(w) + "\" style=\"width:72px\" /></td>";
    }).join("");
    const span = MO_GRADES.length - r.weights.length;
    const pad = span > 0 ? "<td colspan=\"" + span + "\" style=\"color:var(--muted)\">" + esc(r.note || "") + "</td>" : "";
    return "<tr><td><strong>" + esc(r.bucket) + "</strong><div class=\"mono\" style=\"color:var(--muted)\">" + esc(r.id) + "</div></td>" + cells + pad + "</tr>";
  }).join("");
  const msg = state.maintMsg && state.page === "weights" ? "<div class=\"banner ok\">" + esc(state.maintMsg) + "</div>" : "";
  return ph("weights")
    + msg
    + "<div class=\"banner\">当前维护「AMCM 已解读」。这一张是标准法权重：先定对手或发行人属于哪一档、哪一评级，查出一个百分比。查一次即可，不把内地的产品瀑布再跑一遍。财政部单独是 0%。</div>"
    + "<div class=\"panel\"><div class=\"panel-head\"><h2>标准法权重</h2><span>样例工作簿</span></div>"
    + "<div class=\"table-wrap\"><table class=\"data\"><thead><tr><th>对手 / 发行人</th>" + head + "</tr></thead><tbody>"
    + rows + "</tbody></table></div></div>"
    + "<p style=\"margin-top:12px\"><button type=\"button\" class=\"btn btn-primary\" data-maint-save=\"mo-weight\">保存这张评级表</button></p>";
}
