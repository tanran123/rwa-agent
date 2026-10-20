/* 页面切换和事件 */
const RENDER = {
  overview: pageOverview,
  fields: pageFields,
  kbFields: pageFields,
  regulation: pageRegulation,
  params: pageParams,
  exposure: pageExposure,
  weights: pageWeights,
  ccf: pageCcf,
  crm: pageCrm,
  engine: pageEngine
};

const AUDIT_PAGES = {
  dashboard: 1, versions: 1, clauses: 1, fields: 1, generic: 1,
  productRules: 1, tree: 1, assistant: 1, eadOn: 1, eadOff: 1,
  wizard: 1, results: 1, batches: 1, export: 1, mapping: 1
};

if (typeof PAGE_AGENTS !== "undefined" && PAGE_AGENTS.fields && !PAGE_AGENTS.kbFields) {
  PAGE_AGENTS.kbFields = PAGE_AGENTS.fields;
}

function render() {
  if (state.page === "agent") state.page = "exposure";
  renderNav();
  renderClientSel();
  if (window.App && App.renderContext) App.renderContext();
  const appEl = document.getElementById("app");
  if (AUDIT_PAGES[state.page] && window.App && App.show) {
    appEl.classList.remove("exp-full");
    appEl.innerHTML = "<header class=\"page-head\" id=\"auditHead\"><div>"
      + "<div class=\"page-kicker\" id=\"auditCrumb\"></div>"
      + "<h1 id=\"auditTitle\"></h1><p id=\"auditBlurb\"></p></div></header>"
      + sectionTabsHtml(state.page)
      + "<div id=\"auditBody\"></div>";
    if (window.Store) Store.state.route = state.page;
    App.show(state.page);
    const dock = document.getElementById("agentDock");
    if (dock) dock.innerHTML = "";
    return;
  }
  appEl.classList.toggle("exp-full", state.page === "exposure");
  appEl.innerHTML = withSectionTabs((RENDER[state.page] || pageExposure)(), state.page);
  renderAgentDock();
  if (state.page === "exposure") {
    // 双帧：等舞台量到真实宽高后再居中（总览初始 / 展开均依赖此）
    requestAnimationFrame(() => {
      requestAnimationFrame(paintExpGraph);
    });
  }
}

function readNum(id, fallback) {
  const el = document.getElementById(id);
  if (!el) return fallback;
  const v = parseFloat(el.value);
  return Number.isFinite(v) ? v : fallback;
}

document.getElementById("topNav").addEventListener("click", (e) => {
  const toggle = e.target.closest("[data-nav-toggle]");
  if (toggle) {
    e.stopPropagation();
    const id = toggle.getAttribute("data-nav-toggle");
    state.navOpen = state.navOpen === id ? null : id;
    renderNav();
    return;
  }
  const btn = e.target.closest("[data-page]");
  if (!btn) return;
  state.page = btn.getAttribute("data-page");
  state.maintMsg = "";
    if (state.page === "exposure") {
    state.expCenterPending = true;
    if (state.expScope !== "base") state.expScope = "product";
  }
  state.navOpen = null;
  render();
});

document.addEventListener("click", (e) => {
  if (!state.navOpen) return;
  if (e.target.closest("#topNav")) return;
  state.navOpen = null;
  renderNav();
});

function maintField(id) {
  const el = document.getElementById(id);
  return el ? String(el.value == null ? "" : el.value).trim() : "";
}

function saveMaint(kind, id) {
  if (kind === "param") {
    const row = PARAMS.find((p) => p.id === id);
    if (!row) return "没找到这条参数。";
    const name = maintField("paramEditName");
    const value = maintField("paramEditValue");
    if (!name || !value) return "名称和当前值都要填。";
    row.name = name;
    row.value = value;
    row.used = maintField("paramEditUsed");
    return "已写入 " + id + "。监管版本里的参数说明会跟着变。";
  }
  if (kind === "weight") {
    const live = allWeightRows().find((w) => w.id === id);
    if (!live) return "没找到这条权重。";
    const pri = parseInt(maintField("rwEditPri"), 10);
    const bank = maintField("rwEditBank");
    const basis = maintField("rwEditBasis");
    if (live.grid) {
      const rw = maintField("rwEditRw");
      if (!rw) return "百分比要填。";
      const line = BANK_GRID.rows.find((r) => r.id === live.grid.row);
      if (!line) return "没找到评级表这一行。";
      line.weights[live.grid.col] = rw;
      return "已写入评级表 " + id + "。监管摘要会按这张表重算。";
    }
    const row = WEIGHTS.find((w) => w.id === id);
    if (!row) return "没找到这条权重。";
    const type = maintField("rwEditType") || (row.result && row.result.type) || "const";
    let display = maintField("rwEditRw");
    if (type === "counterparty") display = "按交易对手";
    else if (type === "unspecified") display = "权重表未列明";
    else if (type === "max") display = display || "90%";
    else if (!display) return "固定百分比要填。";
    row.conds = readCondEditor("rwCond", row.conds);
    if (!row.conds.length && type !== "const") return "至少留一条条件。";
    row.result = { type: type, display: display };
    if (type === "const" || type === "max") row.result.risk_weight = parseWeightNumber(display);
    if (type === "max") row.result.with = "counterparty";
    if (Number.isFinite(pri)) row.pri = pri;
    if (bank) row.bank = bank;
    row.basis = basis;
    syncWeightText(row);
    return "已写入 " + id + "。监管摘要和监管版本都会按这张表重算。";
  }
  if (kind === "mo-weight") {
    document.querySelectorAll("[data-mo-id]").forEach(function (el) {
      const rec = MO_WEIGHTS.find(function (r) { return r.id === el.getAttribute("data-mo-id"); });
      const i = parseInt(el.getAttribute("data-mo-i"), 10);
      if (!rec || !Number.isFinite(i)) return;
      rec.weights[i] = String(el.value || "").trim() || rec.weights[i];
    });
    syncMoRegulation();
    return "已写入澳门标准法权重。监管版本里的标准法说明会跟着变。";
  }
  if (kind === "ccf") {
    const row = CCF_RULES.find((r) => r.id === id);
    if (!row) return "没找到这条 CCF。";
    const type = maintField("ccfEditType");
    const ccf = maintField("ccfEditCcf");
    if (!type || !ccf) return "产品和系数都要填。";
    const note = maintField("ccfEditNote");
    const pri = parseInt(maintField("ccfEditPri"), 10);
    row.type = type;
    row.note = note || "一般";
    row.conds = readCcfCondEditor();
    row.ccf = ccf;
    row.ccfRate = parseWeightNumber(ccf);
    if (Number.isFinite(pri)) row.pri = pri;
    syncCcfText(row);
    return "已写入 " + id + "。监管版本里的 CCF 说明会跟着变。";
  }
  if (kind === "crm") {
    const row = CRM_RULES.find((r) => r.id === id);
    if (!row) return "没找到这条缓释。";
    const type = maintField("crmEditType");
    const tool = maintField("crmEditTool");
    const sub = maintField("crmEditSub");
    if (!type || !tool || !sub) return "类型、工具和替代方式都要填。";
    row.type = type;
    row.tool = tool;
    row.substitute = sub;
    const floorOn = document.getElementById("crmEditFloor");
    row.floorParam = floorOn && floorOn.checked ? "RW_FLOOR" : "";
    row.constraints = {
      maturity: !!(document.getElementById("crmEditMaturity") && document.getElementById("crmEditMaturity").checked),
      currency: !!(document.getElementById("crmEditCurrency") && document.getElementById("crmEditCurrency").checked),
      correlation: !!(document.getElementById("crmEditCorr") && document.getElementById("crmEditCorr").checked)
    };
    row.effect = crmEffect(row);
    return "已写入 " + id + "。覆盖部分的替代关系会跟着这条规则走。";
  }
  if (kind === "version") {
    const ver = VERSIONS.find((v) => v.id === id);
    if (!ver) return "没找到这个版本。";
    const status = maintField("regEditStatus");
    const from = maintField("regEditFrom");
    if (!status || !from) return "状态和生效日都要填。";
    ver.status = status;
    ver.from = from;
    ver.to = maintField("regEditTo") || "—";
    ver.updatedAt = maintField("regEditAt") || ver.updatedAt;
    ver.note = maintField("regEditNote");
    return "已保存版本说明。规则正文仍以对应菜单里的表为准。";
  }
  return "没有可保存的内容。";
}

function hideRouteTip() {
  const host = document.getElementById("expRouteTip");
  if (host) host.style.display = "none";
}

function showRouteTip(node) {
  const src = node.querySelector(".exp-tip");
  if (!src) return;
  let host = document.getElementById("expRouteTip");
  if (!host) {
    host = document.createElement("div");
    host.id = "expRouteTip";
    host.className = "exp-tip-fixed";
    document.body.appendChild(host);
  }
  host.innerHTML = src.innerHTML;
  host.style.display = "block";
  const rect = node.getBoundingClientRect();
  const width = 248;
  const height = host.offsetHeight || 160;
  const panel = document.querySelector(".exp-float");
  const panelBox = panel ? panel.getBoundingClientRect() : null;
  const limitRight = window.innerWidth - 12;
  let left = rect.right + 10;
  let top = rect.top;
  if (panelBox && left < panelBox.right + 8) left = panelBox.right + 10;
  if (left + width > limitRight) left = rect.left - width - 10;
  if (left < 8 || (panelBox && left < panelBox.right && left + width > panelBox.left)) {
    left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 12));
    top = rect.bottom + 8;
  }
  if (top + height > window.innerHeight - 12) top = Math.max(12, rect.top - height - 8);
  host.style.left = left + "px";
  host.style.top = top + "px";
}

document.getElementById("app").addEventListener("mouseover", (e) => {
  const node = e.target.closest && e.target.closest(".exp-node.route");
  if (!node || !node.querySelector(".exp-tip")) return;
  showRouteTip(node);
});
document.getElementById("app").addEventListener("mouseout", (e) => {
  const node = e.target.closest && e.target.closest(".exp-node.route");
  if (!node) return;
  const next = e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest(".exp-node.route");
  if (next === node) return;
  hideRouteTip();
});

document.getElementById("app").addEventListener("input", (e) => {
  if (expCfgLock) return;
  if (e.target.closest && e.target.closest("#expCfg")) {
    expCfgLock = true;
    expCfgReadForm();
    expCfgLock = false;
    return;
  }
  if (e.target && e.target.id === "expNodeJson" && document.getElementById("expCfg")) {
    expCfgLock = true;
    expCfgWriteForm();
    expCfgLock = false;
  }
});
document.getElementById("app").addEventListener("change", (e) => {
  if (expCfgLock) return;
  if (e.target.closest && e.target.closest("#expCfg")) {
    expCfgLock = true;
    expCfgReadForm();
    expCfgLock = false;
  }
});

document.getElementById("app").addEventListener("click", (e) => {
  const sectionTab = e.target.closest && e.target.closest("[data-section]");
  if (sectionTab) {
    state.page = sectionTab.getAttribute("data-section");
    state.maintMsg = "";
    state.navOpen = null;
    if (state.page === "exposure") {
      state.expCenterPending = true;
      if (state.expScope !== "base") state.expScope = "product";
    }
    render();
    return;
  }
  if (e.target.closest && e.target.closest("#auditBody")) return;
  const clarifySend = e.target.closest && e.target.closest("[data-clarify-send]");
  if (clarifySend) {
    sendClarify(clarifySend.getAttribute("data-clarify-send") || "");
    return;
  }
  const maintBtn = e.target.closest("[data-maint-save]");
  if (maintBtn) {
    const kind = maintBtn.getAttribute("data-maint-save");
    const text = saveMaint(kind, maintBtn.getAttribute("data-maint-id") || "");
    if (kind === "version") state.regMsg = text;
    else state.maintMsg = text;
    render();
    return;
  }
  if (e.target.hasAttribute("data-modal-backdrop") || e.target.closest("[data-modal-dismiss]")) {
    dismissModals();
    render();
    return;
  }

  if (e.target.closest("[data-exp-popover-close]")) {
    state.expNodePopover = false;
    render();
    return;
  }
  if (e.target.closest("[data-exp-add-child]")) {
    addChildOnSelected();
    return;
  }
  const childOpen = e.target.closest("[data-exp-child-open]");
  if (childOpen) {
    state.selectedExposure = childOpen.getAttribute("data-exp-child-open");
    state.expNodePopover = true;
    render();
    return;
  }
  const childRemove = e.target.closest("[data-exp-child-remove]");
  if (childRemove) {
    if (state.expScope === "product") materializeProductExpFlow(state.product);
    const raw = findRawExpNode(state.selectedExposure);
    if (raw && raw.node && removeExpChild(raw.node, childRemove.getAttribute("data-exp-child-remove"))) {
      markExpCustomized();
      state.expNodePopover = true;
      state.expMsg = "已删除「" + (raw.node.label || "当前节点") + "」的一个下级。";
      render();
    }
    return;
  }
  if (e.target.closest("[data-exp-cfg-add]")) {
    const condRoot = document.getElementById("expCfgConds");
    if (condRoot) {
      condRoot.insertAdjacentHTML("beforeend", expCfgRowHtml({}));
      expCfgReadForm();
    }
    return;
  }
  if (e.target.closest("[data-exp-cfg-remove]")) {
    const row = e.target.closest("[data-exp-cfg-row]");
    const condRoot = document.getElementById("expCfgConds");
    if (row && condRoot) {
      if (condRoot.querySelectorAll("[data-exp-cfg-row]").length > 1) row.remove();
      else {
        const field = row.querySelector("[data-exp-cfg-field]");
        const value = row.querySelector("[data-exp-cfg-value]");
        if (field) field.value = "";
        if (value) value.value = "";
      }
      expCfgReadForm();
    }
    return;
  }
  if (e.target.closest("[data-exp-json-save]")) {
    const ok = saveExpNodeJson();
    if (!ok) {
      const errEl = document.getElementById("expNodeJsonErr");
      if (errEl) errEl.textContent = state.expJsonErr || "";
      return;
    }
    state.expNodePopover = true;
    render();
    return;
  }
  if (e.target.closest("[data-exp-json-reset]")) {
    const flow = flowBeingEdited();
    const raw = findRawExpNode("step:route", flow);
    if (raw && raw.node) delete raw.node.manual_decision;
    const out = findRawExpNode("step:out", flow);
    if (out && out.node) delete out.node.manual_decision;
    state.expJsonErr = "";
    state.expMsg = "已恢复自动校验。";
    state.expNodePopover = true;
    render();
    return;
  }

  const expTab = e.target.closest("[data-exp-tab]");
  if (expTab) {
    const tab = expTab.getAttribute("data-exp-tab");
    state.expNodePopover = false;
    if (tab === "base") {
      state.expScope = "base";
      state.selectedExposure = "";
      state.expExpanded = {};
      state.confirmedLeaf = "";
      state.expCenterPending = true;
      state.expMsg = "通用流程模板是整棵分类树。各产品在此基础上去掉不适用的分支。";
    } else {
      state.expScope = "product";
      if (!PRODUCTS[state.product] && productKeys()[0]) state.product = productKeys()[0];
      state.selectedExposure = "";
      state.expExpanded = {};
      state.confirmedLeaf = "";
      state.expCenterPending = true;
      state.expMsg = "";
    }
    render();
    return;
  }

  const expFlowModalOpen = e.target.closest("[data-exp-flow-modal]");
  if (expFlowModalOpen) {
    e.stopPropagation();
    openExpFlowModal(
      expFlowModalOpen.getAttribute("data-exp-flow-modal"),
      expFlowModalOpen.getAttribute("data-product"),
      expFlowModalOpen.getAttribute("data-exp-flow-mode") || "view"
    );
    render();
    return;
  }
  const expFlowModalMode = e.target.closest("[data-exp-flow-modal-mode]");
  if (expFlowModalMode && state.expFlowModal) {
    state.expFlowModal.mode = expFlowModalMode.getAttribute("data-exp-flow-modal-mode") === "edit" ? "edit" : "view";
    state.expFlowModal.err = "";
    render();
    return;
  }
  if (e.target.closest("[data-exp-flow-modal-save]")) {
    saveExpFlowModalJson();
    render();
    return;
  }

  const expScopeEarly = e.target.closest("[data-exp-scope]");
  if (expScopeEarly) {
    const scope = expScopeEarly.getAttribute("data-exp-scope");
    const prodKey = expScopeEarly.getAttribute("data-product");
    state.expNodePopover = false;
    if (scope === "overview") {
      state.expScope = "product";
      if (!PRODUCTS[state.product] && productKeys()[0]) state.product = productKeys()[0];
      state.selectedExposure = "";
      state.expExpanded = {};
      state.confirmedLeaf = "";
      state.expCenterPending = true;
    } else if (scope === "base") {
      state.expScope = "base";
      state.selectedExposure = "";
      state.expExpanded = {};
      state.confirmedLeaf = "";
      state.expCenterPending = true;
      state.expMsg = "已打开通用流程模板，整棵分类树都在。";
    } else {
      state.expScope = "product";
      if (prodKey) state.product = prodKey;
      ensureProductExpFlow(state.product);
      state.selectedExposure = "";
      state.expExpanded = {};
      state.confirmedLeaf = "";
      state.expCenterPending = true;
      const entered = (PRODUCTS[state.product] || {}).label || "";
      state.expMsg = productSkipIds(state.product).length
        ? ("「" + entered + "」走同一套分类，已去掉不适用的分支。")
        : ("「" + entered + "」走同一套分类。");
    }
    render();
    return;
  }
  const goto = e.target.closest("[data-goto]");
  if (goto) {
    let target = goto.getAttribute("data-goto");
    if (target === "mapping") { target = "engine"; state.calcStage = 0; }
    state.page = target;
    if (goto.hasAttribute("data-calc-stage")) {
      state.calcStage = +goto.getAttribute("data-calc-stage");
    }
    if (goto.hasAttribute("data-field-mode")) {
      state.fieldMode = goto.getAttribute("data-field-mode");
      if (state.fieldMode === "type") state.typeDraft = { label: "", note: "" };
    }
    if (goto.getAttribute("data-set-off") === "1") {
      const ccfTxt = CCF_RULES[state.selectedCcf].ccf;
      const ccf = parseFloat(ccfTxt) / 100 || 0.4;
      state.calcLegs.push(newCalcLeg({
        name: CCF_RULES[state.selectedCcf].type || "表外暴露",
        offbalance: true, nominalYi: 50, ccf: ccf
      }));
      state.selectedLeg = state.calcLegs.length - 1;
      state.calcStage = 1;
    }
    render();
    return;
  }
  const prod = e.target.closest("[data-product]");
  if (prod && !prod.hasAttribute("data-exp-scope") && !prod.hasAttribute("data-exp-flow-modal")) {
    state.product = prod.getAttribute("data-product");
    state.selectedField = 0;
    state.fieldMsg = "";
    state.fieldSyncPhase = "idle";
    state.fieldPushPhase = "idle";
    render();
    return;
  }
  const field = e.target.closest("[data-field]");
  if (field) {
    state.selectedField = +field.getAttribute("data-field");
    state.fieldEditMsg = "";
    render();
    return;
  }

  const fieldMode = e.target.closest("[data-field-mode]");
  if (fieldMode) {
    const mode = fieldMode.getAttribute("data-field-mode") || null;
    state.regCreateOpen = false;
    state.paramCreateOpen = false;
    state.fieldMode = mode || null;
    state.fieldMsg = "";
    state.fieldEditMsg = "";
    state.fieldSyncPhase = "idle";
    state.fieldPushPhase = "idle";
    if (mode === "create") {
      state.fieldDraft = { id: "", zh: "", type: "字符串", sample: "", required: false };
    }
    if (mode === "type") {
      state.typeDraft = { label: "", note: "" };
    }
    if (mode === "bulk" && !state.fieldPaste) {
      state.fieldPaste = "exposure_amount,数值,90000000,必填,风险暴露额\nprovision_ratio,数值%,12,选填,准备占比\nshort_term_flag,布尔,false,选填,是否短期债权";
    }
    render();
    return;
  }
  if (e.target.closest("[data-exp-new-type]")) {
    state.expTypeModal = true;
    state.fieldMode = null;
    state.typeDraft = { label: "", note: "" };
    state.fieldMsg = "";
    state.page = "exposure";
    state.expScope = "product";
    render();
    return;
  }
  if (e.target.closest("[data-type-create-save]")) {
    if (state.typeGenPhase === "loading") return;
    const labelEl = document.getElementById("typeNewLabel");
    const noteEl = document.getElementById("typeNewNote");
    const label = ((labelEl && labelEl.value) || "").trim();
    const note = ((noteEl && noteEl.value) || "").trim();
    state.typeDraft = { label: label, note: note };
    if (!label) {
      state.fieldMsg = "请填写类型名称。";
      render();
      return;
    }
    if (productKeys().some((k) => PRODUCTS[k].label === label)) {
      state.fieldMsg = "已存在同名类型「" + label + "」，请直接切换 Tab 或换名称。";
      render();
      return;
    }
    const id = slugifyProductId(label);
    const match = findKbProductMatch(label);
    PRODUCTS[id] = {
      label: label,
      note: note,
      kbSpace: match ? match.kbSpace : ("产品标准字段 · " + label),
      kbMatchId: match ? match.id : "",
      fields: [],
      expFlow: makeExpFlowRef()
    };
    state.product = id;
    state.selectedField = 0;
    state.fieldMsg = "";
    if (match) syncProductFromKb(id, { silent: true });
    // 留在分类判断页：先展示通用模板底图，再生成并上图
    state.expTypeModal = false;
    state.fieldMode = null;
    state.page = "exposure";
    state.expScope = "base";
    state.expNodePopover = false;
    state.typeGenPhase = "loading";
    state.typeGenMsg = match
      ? ("以通用流程模板为底，已挂接「" + match.label + "」字段，正在生成「" + label + "」瀑布…")
      : ("以通用流程模板为底，结合「" + label + "」字段生成瀑布…");
    state.expCenterPending = true;
    state.expMsg = "生成中：通用模板 × 产品字段 → 产品瀑布。";
    render();
    generateProductFlowFromTemplate(id).then((result) => {
      state.typeGenPhase = "idle";
      state.typeGenMsg = "";
      state.page = "exposure";
      state.expScope = "product";
      state.product = id;
      state.expNodePopover = false;
      state.selectedExposure = "";
      state.expExpanded = {};
      state.confirmedLeaf = "";
      const gaps = (result && result.gaps) || [];
      const gapN = gaps.length;
      state.expMsg = (result && result.summary)
        ? result.summary
        : ("已为「" + label + "」生成分类瀑布并放到图上。");
      if (gapN) state.expMsg += " 有 " + gapN + " 处字段未对齐，节点已标 !。";
      else state.expMsg += " 产品字段已覆盖判定所需字段。";
      state.expCenterPending = true;
      render();
    });
    return;
  }
  if (e.target.closest("[data-field-create-save]")) {
    const idEl = document.getElementById("fldNewId");
    const zhEl = document.getElementById("fldNewZh");
    const typeEl = document.getElementById("fldNewType");
    const sampleEl = document.getElementById("fldNewSample");
    const reqEl = document.getElementById("fldNewReq");
    const id = ((idEl && idEl.value) || "").trim().replace(/^standard\./, "");
    const zh = ((zhEl && zhEl.value) || "").trim();
    const type = (typeEl && typeEl.value) || "字符串";
    const sample = (sampleEl && sampleEl.value) || "";
    const required = !!(reqEl && reqEl.value === "1");
    state.fieldDraft = { id: id, zh: zh, type: type, sample: sample, required: required };
    if (!id || !/^[a-zA-Z_][\w]*$/.test(id)) {
      state.fieldMsg = "请填写合法字段 ID（字母/下划线开头）。";
      render();
      return;
    }
    const prod = PRODUCTS[state.product];
    if (prod.fields.some((f) => f.id === id)) {
      state.fieldMsg = "字段「" + id + "」已存在，请换一个 ID 或直接在右侧编辑。";
      render();
      return;
    }
    const added = addFieldsToProduct(state.product, [{ id: id, type: type, sample: sample, required: required, zh: zh || id }], "custom");
    if (added) {
      if (zh) FIELD_LABEL[id] = zh;
      state.fieldMode = null;
      state.fieldMsg = "";
      state.fieldEditMsg = "已新建「" + (zh || id) + "」并静默写入知识库。";
      state.selectedField = prod.fields.findIndex((f) => f.id === id);
    }
    render();
    return;
  }
  if (e.target.closest("[data-field-save]")) {
    const prod = PRODUCTS[state.product];
    const sel = prod.fields[state.selectedField];
    if (!sel) return;
    const zhEl = document.getElementById("fldEditZh");
    const typeEl = document.getElementById("fldEditType");
    const sampleEl = document.getElementById("fldEditSample");
    const reqEl = document.getElementById("fldEditReq");
    const sourceEl = document.getElementById("fldEditSource");
    const zh = ((zhEl && zhEl.value) || "").trim();
    sel.type = (typeEl && typeEl.value) || sel.type;
    sel.sample = sampleEl ? sampleEl.value : sel.sample;
    sel.sourceHeader = sourceEl ? String(sourceEl.value || "").trim() : (sel.sourceHeader || "");
    sel.required = !!(reqEl && reqEl.value === "1");
    if (zh) {
      sel.zh = zh;
      FIELD_LABEL[sel.id] = zh;
    }
    sel.source = "custom";
    state.fieldEditMsg = "已保存「" + (FIELD_LABEL[sel.id] || sel.id) + "」并静默写入知识库。";
    render();
    return;
  }
  if (e.target.closest("[data-field-delete]")) {
    const prod = PRODUCTS[state.product];
    const sel = prod.fields[state.selectedField];
    if (!sel) return;
    const label = FIELD_LABEL[sel.id] || sel.zh || sel.id;
    if (!window.confirm("从本客户「" + prod.label + "」移除字段「" + label + "」？映射中对应项将一并失效。")) return;
    prod.fields.splice(state.selectedField, 1);
    state.selectedField = Math.min(state.selectedField, Math.max(0, prod.fields.length - 1));
    state.fieldEditMsg = "已移除「" + label + "」。";
    render();
    return;
  }
  const bulkWay = e.target.closest("[data-bulk-way]");
  if (bulkWay) {
    state.fieldBulkWay = bulkWay.getAttribute("data-bulk-way");
    state.fieldMsg = "";
    render();
    return;
  }
  if (e.target.closest("[data-field-sync]")) {
    state.fieldSyncPhase = "loading";
    render();
    setTimeout(function () {
      const key = state.product;
      const result = syncProductFromKb(key);
      state.fieldSyncPhase = "done";
      state.fieldMsg = result.msg;
      state.fieldEditMsg = result.msg;
      state.selectedField = 0;
      if (result.matched) {
        setTimeout(function () {
          state.fieldMode = null;
          state.fieldSyncPhase = "idle";
          render();
        }, 700);
      }
      render();
    }, 700);
    return;
  }
  if (e.target.closest("[data-field-bulk-apply]")) {
    const pasteEl = document.getElementById("fieldPasteBox");
    if (pasteEl) state.fieldPaste = pasteEl.value;
    let items = [];
    let source = "custom";
    if (state.fieldBulkWay === "paste") {
      items = parseFieldPaste(state.fieldPaste);
    } else if (state.fieldBulkWay === "pack") {
      FIELD_PACKS.forEach((pack) => {
        if (state.fieldPackPick[pack.id]) items = items.concat(pack.fields);
      });
      source = "custom";
    } else if (state.fieldBulkWay === "kb") {
      KB_FIELD_CATALOG.forEach((g) => {
        g.items.forEach((item) => {
          if (state.fieldKbPick[item.id]) items.push(item);
        });
      });
      source = "kb";
    } else if (state.fieldBulkWay === "copy") {
      const fromEl = document.getElementById("fieldCopyFrom");
      const fromKey = fromEl ? fromEl.value : Object.keys(PRODUCTS).find((k) => k !== state.product);
      const from = PRODUCTS[fromKey];
      if (from) {
        items = from.fields.map((f) => ({
          id: f.id, type: f.type, sample: f.sample, required: f.required, zh: FIELD_LABEL[f.id] || f.zh || f.id
        }));
      }
      source = "custom";
    }
    const added = addFieldsToProduct(state.product, items, source);
    state.fieldMsg = added
      ? ("已向「" + PRODUCTS[state.product].label + "」加入 " + added + " 个字段"
        + (items.length > added ? "（跳过 " + (items.length - added) + " 个已存在）" : "")
        + "，已静默写入知识库。")
      : (items.length ? "所选字段均已存在，未重复添加。" : "没有可加入的字段，请先勾选或粘贴。");
    state.selectedField = Math.max(0, PRODUCTS[state.product].fields.length - 1);
    if (added) state.fieldMode = null;
    render();
    return;
  }

  const calcStageBtn = e.target.closest("[data-calc-stage]");
  if (calcStageBtn && !calcStageBtn.hasAttribute("data-goto")) {
    state.calcStage = +calcStageBtn.getAttribute("data-calc-stage");
    if (state.calcStage === 0) {
      if (calcStageBtn.hasAttribute("data-cls-enter") || state.classifyStep !== 2) state.classifyStep = 1;
    }
    if (state.calcStage === 1) {
      syncCalcLegsFromUpload();
      if (fillOpenWeights()) return;
    }
    if (state.calcStage === 2) persistCalcTrace(calcEngine());
    render();
    return;
  }
  if (e.target.closest("[data-calc-download]")) {
    downloadCalcWorkbook(calcEngine());
    return;
  }
  if (e.target.closest("[data-cls-remap]")) {
    if (!state.uploadBook) return;
    state.calcStage = 0;
    state.classifyStep = 1;
    requestModelMapping();
    return;
  }
  const clsStep = e.target.closest("[data-cls-step]");
  if (clsStep) {
    const n = +clsStep.getAttribute("data-cls-step");
    if (n === 2 && unmappedJudgeCount()) {
      state.mapError = "还有字段没有来源。先发给模型映射，每一项都要对上。";
      render();
      return;
    }
    state.calcStage = 0;
    state.classifyStep = n === 2 ? 2 : 1;
    if (n === 2) state.mapError = "";
    render();
    return;
  }
  if (e.target.closest("[data-cls-autotag]")) {
    seedClassifyTags();
    uploadDetailRows().forEach((row) => {
      state.classifyPick[row.id] = true;
      state.classifyTags[row.id] = suggestRowClassifyTag(row);
    });
    render();
    return;
  }
  if (e.target.closest("[data-cls-fields-all]")) {
    seedClassifyFields();
    classifyJudgeFields().forEach((f) => { state.classifyFieldPick[f.key] = true; });
    render();
    return;
  }
  if (e.target.closest("[data-upload-pick]")) {
    if (state.mapPhase === "loading") return;
    const input = document.getElementById("sheetFile");
    if (input) input.click();
    return;
  }
  if (e.target.closest("[data-upload-paper]")) {
    if (state.mapPhase === "loading") return;
    state.page = "engine";
    state.calcStage = 0;
    state.mapPhase = "loading";
    state.mapWait = "map";
    state.mapError = "";
    state.mapFile = "Credit Risk Working 202609(1).xlsx";
    render();
    fetch("/api/working-paper")
      .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
      .then(function (pack) {
        if (!pack.ok || !pack.data || !pack.data.lines) {
          state.mapPhase = "idle";
          state.mapError = (pack.data && pack.data.error) || "没有读到底稿。";
          render();
          return;
        }
        const data = pack.data;
        const openEad = (data.lines || []).reduce(function (sum, line) {
          return sum + (typeof line.weight === "number" ? 0 : Number(line.ead_yi) || 0);
        }, 0);
        const rwaText = Number(data.rwa_thousand || 0).toLocaleString("zh-CN", { maximumFractionDigits: 2 });
        state.paperCoverage = data.coverage || [];
        state.paperRows = (data.process_rows || []).map(function (row) {
          const known = typeof row.weight === "number";
          return {
            sheet: row.sheet || "",
            excel_row: row.excel_row,
            header_row: row.header_row,
            name: row.name || "",
            exposure: row.exposure || "",
            weight: known ? row.weight : null,
            weight_text: known ? (row.weight_text || "") : "未定权重",
            ead: Number(row.ead) || 0,
            rwa: known ? row.rwa : null,
            trace: row.trace || "",
            steps: Array.isArray(row.steps) ? row.steps : [],
            open: !known
          };
        });
        state.uploadBook = {
          basis: "paper",
          file: data.file,
          sheet: "明细",
          headerRow: 1,
          columns: [],
          rows: [],
          paperNote: "来自「" + data.file + "」。按底稿表头强对应后，用明细金额计算。敞口 "
            + Number(data.ead_yi || 0).toLocaleString("zh-CN", { maximumFractionDigits: 2 })
            + " 亿元，风险加权资产 "
            + Number(data.rwa_yi || 0).toLocaleString("zh-CN", { maximumFractionDigits: 2 })
            + " 亿元（" + rwaText + " 千澳门元）。"
            + (data.model_note ? data.model_note + " " : "")
            + (openEad > 0.01
              ? "另有 " + openEad.toLocaleString("zh-CN", { maximumFractionDigits: 2 }) + " 亿元还没有权重，在结果表里手填百分比后计入。"
              : "")
            + " 对上 " + (data.mapped_fields || 0) + " / " + (data.field_count || 0) + " 个字段。"
        };
        state.mapFile = data.file;
        state.mapPhase = "confirmed";
        state.calcStage = state.paperRows.length ? 1 : 0;
        state.classifyStep = 2;
        state.calcLegs = (data.lines || []).map(function (line, index) {
          const known = typeof line.weight === "number";
          const weight = known ? line.weight : null;
          return newCalcLeg({
            id: "paper-" + index,
            name: line.part + " · " + line.section + " · " + (known ? (line.weight_text || "") : "未定权重"),
            fromPaper: true,
            weightOpen: !known,
            rwRate: weight,
            balanceYi: line.ead_yi,
            impairmentYi: 0,
            nominalYi: line.ead_yi,
            offbalance: false,
            crmApps: [],
            originalRwRuleId: "PAPER",
            paperClass: {
              category: line.part,
              subclass: line.section,
              leaf: (function () {
                const text = String(line.label || "");
                const cut = text.indexOf(" · ");
                return cut >= 0 ? text.slice(cut + 3) : (line.section || "");
              })(),
              path: ["底稿", line.part, line.section, line.label || ""].concat(line.model_reason ? ["模型：" + line.model_reason] : []),
              ruleId: "底稿",
              weightRule: "底稿",
              rwHint: known ? (line.weight_text || "") : "未定权重",
              rwRate: weight
            }
          });
        });
        state.selectedLeg = 0;
        render();
      })
      .catch(function () {
        state.mapPhase = "idle";
        state.mapError = "没有读到底稿。";
        render();
      });
    return;
  }
  if (e.target.closest("[data-upload-catalog]")) {
    if (state.mapPhase === "loading") return;
    state.page = "engine";
    state.calcStage = 1;
    state.classifyStep = 2;
    state.mapError = "";
    state.mapWait = "";
    state.classifyPick = {};
    state.classifyTags = {};
    state.classifyFieldPick = {};
    state.uploadBook = CATALOG_DEMO;
    state.mapFile = CATALOG_DEMO.file;
    const next = {};
    const reasons = {};
    Object.keys(CATALOG_DEMO.map).forEach(function (id) {
      next[id] = CATALOG_DEMO.map[id].letter;
      reasons[id] = CATALOG_DEMO.map[id].reason;
    });
    state.mapAssignments = next;
    state.mapSuggested = Object.assign({}, next);
    state.mapReasons = reasons;
    state.mapTouched = {};
    state.mapExtract = "已按产品字段清单里能取到的列填好。清单没有的分类字段不在这张表里。";
    state.mapPhase = "confirmed";
    seedClassifyTags();
    syncCalcLegsFromUpload();
    render();
    return;
  }
  if (e.target.closest("[data-upload-demo]")) {
    if (state.mapPhase === "loading") return;
    state.calcStage = 0;
    state.mapFile = SAMPLE_UPLOAD.file;
    state.mapError = "";
    state.mapExtract = "";
    state.mapWait = "";
    state.uploadBook = null;
    state.mapPhase = "loading";
    state.mapAssignments = {};
    state.mapSuggested = {};
    state.mapReasons = {};
    state.mapTouched = {};
    render();
    setTimeout(function () {
      if (state.page !== "engine") return;
      applyAiSuggestions();
      render();
    }, 900);
    return;
  }
  if (e.target.closest("[data-ai-remap]")) {
    state.calcStage = 0;
    if (state.uploadBook) {
      requestModelMapping();
      return;
    }
    state.mapPhase = "loading";
    state.mapWait = "";
    render();
    setTimeout(function () {
      if (state.page !== "engine") return;
      applyAiSuggestions();
      render();
    }, 700);
    return;
  }
  if (e.target.closest("[data-map-confirm]")) {
    state.mapPhase = "confirmed";
    state.calcStage = 1;
    syncCalcLegsFromUpload();
    render();
    return;
  }
  if (e.target.closest("[data-map-unlock]")) {
    state.mapPhase = "ready";
    state.calcStage = 0;
    render();
    return;
  }
  if (e.target.closest("[data-map-reset]")) {
    state.mapPhase = "idle";
    state.mapFile = "";
    state.uploadBook = null;
    state.mapError = "";
    state.mapAssignments = {};
    state.mapSuggested = {};
    state.mapReasons = {};
    state.mapTouched = {};
    state.calcStage = 0;
    render();
    return;
  }
  const regCreate = e.target.closest("[data-reg-create]");
  if (regCreate) {
    state.fieldMode = null;
    state.paramCreateOpen = false;
    state.regCreateOpen = true;
    state.regDraft = Object.assign({}, state.regDraft, {
      updatedAt: state.regDraft.updatedAt || todayIso(),
      from: state.regDraft.from || todayIso(),
      region: state.regRegion === "全部" ? "中国大陆" : state.regRegion
    });
    state.regMsg = "";
    render();
    return;
  }
  const paramCreate = e.target.closest("[data-param-create]");
  if (paramCreate) {
    state.fieldMode = null;
    state.regCreateOpen = false;
    state.paramCreateOpen = true;
    state.paramDraft = { id: "", group: PARAMS[0] ? PARAMS[0].group : "期限优惠", name: "", value: "", unit: "", used: "" };
    render();
    return;
  }
  if (e.target.closest("[data-param-create-save]")) {
    const id = (document.getElementById("paramId") || {}).value || "";
    const name = (document.getElementById("paramName") || {}).value || "";
    const value = (document.getElementById("paramValue") || {}).value || "";
    const group = (document.getElementById("paramGroup") || {}).value || "其他";
    const unit = (document.getElementById("paramUnit") || {}).value || "";
    const used = (document.getElementById("paramUsed") || {}).value || "";
    if (!id.trim() || !name.trim()) {
      alert("请填写参数 ID 与名称。");
      return;
    }
    if (PARAMS.some((p) => p.id === id.trim())) {
      alert("参数 ID 已存在。");
      return;
    }
    PARAMS.push({ id: id.trim(), group: group, name: name.trim(), value: value.trim() || "—", unit: unit.trim(), used: used.trim() || "新建参数 · 已静默写入知识库" });
    state.selectedParam = PARAMS.length - 1;
    state.paramCreateOpen = false;
    render();
    return;
  }
  if (e.target.closest("[data-reg-create-save]")) {
    const nameEl = document.getElementById("regName");
    const shortEl = document.getElementById("regShort");
    const regionEl = document.getElementById("regRegionSel");
    const statusEl = document.getElementById("regStatusSel");
    const fromEl = document.getElementById("regFrom");
    const toEl = document.getElementById("regTo");
    const updatedEl = document.getElementById("regUpdatedAt");
    const noteEl = document.getElementById("regNote");
    const updatedAt = updatedEl && updatedEl.value;
    if (!updatedAt) {
      state.regMsg = "";
      alert("请填写知识库截取时点（规则持续修订时用于锁定口径）。");
      return;
    }
    if (!fromEl || !fromEl.value) {
      alert("请填写生效日。");
      return;
    }
    state.regDraft = {
      name: nameEl ? nameEl.value.trim() : "",
      shortName: shortEl ? shortEl.value.trim() : "",
      region: regionEl ? regionEl.value : "中国大陆",
      status: statusEl ? statusEl.value : "草案",
      from: fromEl.value,
      to: toEl ? toEl.value : "",
      updatedAt: updatedAt,
      note: noteEl ? noteEl.value.trim() : ""
    };
    if (!state.regDraft.name) {
      alert("请填写版本名称。");
      return;
    }
    const ver = createRegulationVersion(state.regDraft);
    silentSyncVersion(ver);
    state.selectedVersion = ver.id;
    state.regRegion = ver.region;
    state.regCreateOpen = false;
    state.regMsg = "已创建版本 " + ver.id + "，截取时点 " + ver.updatedAt
      + "，已静默同步到知识库（本客户 + 全部检索）。";
    render();
    return;
  }
  const regRegion = e.target.closest("[data-reg-region]");
  if (regRegion) {
    state.regRegion = regRegion.getAttribute("data-reg-region");
    const cur = VERSIONS.find((v) => v.id === state.selectedVersion);
    const inFilter = cur && (state.regRegion === "全部" || cur.region === state.regRegion);
    if (!inFilter) {
      const first = VERSIONS.find((v) => state.regRegion === "全部" || v.region === state.regRegion);
      if (first) state.selectedVersion = first.id;
    }
    render();
    return;
  }
  const regPack = e.target.closest("[data-reg-pack]");
  if (regPack) {
    state.regPackView = regPack.getAttribute("data-reg-pack") || "全部";
    state.regRuleId = "";
    render();
    return;
  }
  const regRule = e.target.closest("[data-reg-rule]");
  if (regRule) {
    state.regRuleId = regRule.getAttribute("data-reg-rule") || "";
    render();
    return;
  }
  const ver = e.target.closest("[data-version]");
  if (ver) {
    state.selectedVersion = ver.getAttribute("data-version");
    state.regPackView = "全部";
    state.regRuleId = "";
    state.regMsg = "";
    render();
    return;
  }
  const exp = e.target.closest("[data-exp]");
  if (exp) { state.selectedExposure = exp.getAttribute("data-exp"); render(); return; }
  const w = e.target.closest("[data-weight]");
  if (w) { state.selectedWeight = +w.getAttribute("data-weight"); render(); return; }
  const ccfAdd = e.target.closest("[data-ccf-add-cond]");
  if (ccfAdd) {
    const row = CCF_RULES[state.selectedCcf];
    if (row) {
      row.type = maintField("ccfEditType") || row.type;
      row.note = maintField("ccfEditNote") || row.note;
      const ccf = maintField("ccfEditCcf");
      if (ccf) { row.ccf = ccf; row.ccfRate = parseWeightNumber(ccf); }
      row.conds = readCcfCondEditor();
      row.conds.push({ field: "cancelable", operator: "=", value: true });
    }
    render();
    return;
  }
  const ccfDel = e.target.closest("[data-ccf-del-cond]");
  if (ccfDel) {
    const row = CCF_RULES[state.selectedCcf];
    const i = +ccfDel.getAttribute("data-ccf-del-cond");
    if (row) {
      row.type = maintField("ccfEditType") || row.type;
      row.note = maintField("ccfEditNote") || row.note;
      const ccf = maintField("ccfEditCcf");
      if (ccf) { row.ccf = ccf; row.ccfRate = parseWeightNumber(ccf); }
      row.conds = readCcfCondEditor();
      if (row.conds) row.conds.splice(i, 1);
    }
    render();
    return;
  }
  const c = e.target.closest("[data-ccf]");
  if (c) { state.selectedCcf = +c.getAttribute("data-ccf"); render(); return; }
  const crm = e.target.closest("[data-crm]");
  if (crm) { state.selectedCrm = +crm.getAttribute("data-crm"); render(); return; }
  const param = e.target.closest("[data-param]");
  if (param) { state.selectedParam = +param.getAttribute("data-param"); render(); return; }
  const trade = e.target.closest("[data-trade]");
  if (trade) { state.selectedTrade = +trade.getAttribute("data-trade"); render(); return; }
  const wtab = e.target.closest("[data-wtab]");
  if (wtab) {
    state.weightFilter = wtab.getAttribute("data-wtab") === "catalog" ? "catalog" : "all";
    state.selectedWeight = 0;
    render();
    return;
  }
  if (e.target.closest("[data-reset-demo]")) {
    state.calcLegs = demoCalcLegs();
    state.selectedLeg = 0;
    state.calcStage = 1;
    render();
    return;
  }
  const legAdd = e.target.closest("[data-leg-add]");
  if (legAdd) {
    const kind = legAdd.getAttribute("data-leg-add");
    state.calcLegs.push(newCalcLeg(kind === "off"
      ? { name: "表外暴露 " + (state.calcLegs.length + 1), offbalance: true, nominalYi: 50, ccfRuleId: "CCF_COMMIT_40", crmApps: [] }
      : { name: "表内暴露 " + (state.calcLegs.length + 1), offbalance: false, balanceYi: 50, impairmentYi: 0, crmApps: [] }
    ));
    state.selectedLeg = state.calcLegs.length - 1;
    render();
    return;
  }
  const legRemove = e.target.closest("[data-leg-remove]");
  if (legRemove) {
    const i = +legRemove.getAttribute("data-leg-remove");
    if (state.calcLegs.length <= 1) return;
    state.calcLegs.splice(i, 1);
    state.selectedLeg = Math.min(state.selectedLeg, state.calcLegs.length - 1);
    render();
    return;
  }
  const crmAdd = e.target.closest("[data-crm-add]");
  if (crmAdd) {
    const i = +crmAdd.getAttribute("data-crm-add");
    const leg = state.calcLegs[i];
    if (!leg) return;
    if (!leg.crmApps) leg.crmApps = [];
    leg.crmApps.push(defaultCrmApp("CRM_COL_GOV"));
    state.selectedLeg = i;
    render();
    return;
  }
  const crmRemove = e.target.closest("[data-crm-remove]");
  if (crmRemove) {
    const i = +crmRemove.getAttribute("data-crm-remove");
    const k = +crmRemove.getAttribute("data-crm-i");
    const leg = state.calcLegs[i];
    if (leg && leg.crmApps) leg.crmApps.splice(k, 1);
    state.selectedLeg = i;
    render();
    return;
  }
  const legSel = e.target.closest("[data-leg-sel]");
  if (legSel && !e.target.closest("[data-leg-field],[data-leg-remove],[data-crm-field],[data-crm-add],[data-crm-remove]")) {
    state.selectedLeg = +legSel.getAttribute("data-leg-sel");
    render();
    return;
  }

  const expDemo = e.target.closest("[data-exp-demo]");
  if (expDemo) {
    const id = expDemo.getAttribute("data-exp-demo");
    state.expExpanded = {};
    state.expExpanded[id] = true;
    state.selectedExposure = id;
    state.confirmedLeaf = "";
    state.expNodePopover = true;
    state.expCenterPending = true;
    render();
    return;
  }
  const expSel = e.target.closest("[data-exp-sel]");
  if (expSel) {
    const id = expSel.getAttribute("data-exp-sel");
    const node = findExpNode(id);
    if (state.expScope === "overview" && node && node.kind === "route") {
      state.expNodePopover = true;
      if (node.productKey) {
        state.product = node.productKey;
        ensureProductExpFlow(state.product);
        if (!focusFirstExpLayer(state.product)) state.selectedExposure = id;
        state.expMsg = "已展开「" + PRODUCTS[state.product].label + "」线路瀑布；其它产品已置灰。";
        state.expCenterPending = true;
      } else {
        state.selectedExposure = id;
      }
      render();
      return;
    }
    if (state.expScope === "overview" && node && node.productKey) {
      state.product = node.productKey;
    }
    const keepExpanded = Object.assign({}, state.expExpanded);
    const keepLeaf = state.confirmedLeaf;
    state.selectedExposure = id;
    state.expNodePopover = true;
    state.expCenterPending = false;
    if (node && node.kind === "subclass") {
      state.confirmedLeaf = id;
      state.expExpanded = {};
      if (node.parent) state.expExpanded[node.parent] = true;
    } else if (node && (node.kind === "category" || String(id).indexOf("cat:") === 0)) {
      state.confirmedLeaf = "";
      state.expExpanded = {};
      state.expExpanded[id] = true;
    } else {
      state.expExpanded = keepExpanded;
      state.confirmedLeaf = keepLeaf;
    }
    if (state.expScope === "overview" && overviewActiveProductKey()) {
      state.expMsg = "正在查看「" + PRODUCTS[overviewActiveProductKey()].label + "」线路节点。";
    }
    render();
    return;
  }
  if (e.target.closest("[data-exp-reset-template]")) {
    if (state.expScope === "base" || !PRODUCTS[state.product]) return;
    if (!window.confirm("将「" + PRODUCTS[state.product].label + "」恢复为引用通用流程？本产品流程副本将被丢弃。")) return;
    PRODUCTS[state.product].expFlow = makeExpFlowRef();
    state.expMsg = "「" + PRODUCTS[state.product].label + "」已恢复引用通用流程。";
    focusFirstExpLayer(state.product);
    state.expCenterPending = true;
    render();
    return;
  }
  if (e.target.closest("[data-exp-fork]")) {
    if (state.expScope === "base" || !PRODUCTS[state.product]) return;
    materializeProductExpFlow(state.product);
    state.expMsg = "已为「" + PRODUCTS[state.product].label + "」生成流程副本，可独立修改 JSON。";
    render();
    return;
  }
  if (e.target.closest("[data-exp-toggle-json]")) {
    if (state.expScope === "overview") openExpFlowModal("overview", null, "view");
    else if (state.expScope === "base") openExpFlowModal("base", null, "view");
    else openExpFlowModal("product", state.product, "view");
    render();
    return;
  }
  if (e.target.closest("[data-exp-add]")) {
    addChildOnSelected();
    return;
  }
  if (e.target.closest("[data-exp-save-gate]")) {
    if (state.expScope === "product") materializeProductExpFlow(state.product);
    const raw = findRawExpNode(state.selectedExposure);
    if (raw && raw.scope === "category") {
      const labelEl = document.getElementById("expEditLabel");
      if (labelEl) raw.node.question = labelEl.value;
      markExpCustomized();
      state.expMsg = "已保存 gate 层问题" + (state.expScope === "product" ? "（产品副本）" : "（通用模板）") + "。";
      render();
    }
    return;
  }
  if (e.target.closest("[data-exp-save]")) {
    if (state.expScope === "product") materializeProductExpFlow(state.product);
    const raw = findRawExpNode(state.selectedExposure);
    if (raw && raw.scope === "leaf") {
      const jsonEl = document.getElementById("expEditJson");
      const labelEl = document.getElementById("expEditLabel");
      const rwEl = document.getElementById("expEditRw");
      const ruleEl = document.getElementById("expEditRule");
      if (jsonEl && jsonEl.value.trim()) {
        try {
          const parsed = JSON.parse(jsonEl.value);
          Object.keys(raw.node).forEach((k) => { delete raw.node[k]; });
          Object.assign(raw.node, parsed);
          if (!raw.node.type) raw.node.type = "leaf";
          if (!raw.node.id) raw.node.id = state.selectedExposure;
        } catch (err) {
          state.expMsg = "叶子 JSON 解析失败：" + (err && err.message ? err.message : String(err));
          render();
          return;
        }
      } else {
        if (labelEl) {
          raw.node.label = labelEl.value;
          if (raw.node.then) raw.node.then.sub_class = labelEl.value;
        }
        if (ruleEl) raw.node.rule_id = ruleEl.value;
        if (rwEl) {
          const disp = rwEl.value.trim();
          const num = parseFloat(String(disp).replace(/%/g, ""));
          if (raw.node.then && raw.node.then.risk_weight && typeof raw.node.then.risk_weight === "object") {
            raw.node.then.risk_weight.display = disp;
            if (Number.isFinite(num)) raw.node.then.risk_weight.value = num > 1 ? num / 100 : num;
          } else if (raw.node.then) {
            raw.node.then.risk_weight = rwConst(Number.isFinite(num) ? (num > 1 ? num / 100 : num) : 1, disp || "100%");
          }
        }
      }
      markExpCustomized();
      state.expMsg = "已保存叶子 JSON" + (state.expScope === "base" ? "（通用模板）" : "（产品流程）") + "。";
      render();
    }
    return;
  }
  const zoomBtn = e.target.closest("[data-exp-zoom]");
  if (zoomBtn) {
    const z = zoomBtn.getAttribute("data-exp-zoom");
    if (z === "+") state.expZoom = Math.min(2.2, state.expZoom + 0.12);
    else if (z === "-") state.expZoom = Math.max(0.08, state.expZoom - 0.12);
    else {
      state.expZoom = 0.85;
      state.expCenterPending = true;
      if (document.getElementById("expStage")) paintExpGraph();
      return;
    }
    if (document.getElementById("expWorld")) applyExpTransform();
    else render();
    return;
  }
});

document.getElementById("sheetFile").addEventListener("change", (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = "";
  if (!file) return;
  if (!/\.(xlsx|xlsm)$/i.test(file.name)) {
    state.mapPhase = "idle";
    state.mapError = "请选择 .xlsx 或 .xlsm。";
    render();
    return;
  }
  state.page = "engine";
  state.calcStage = 0;
    state.mapFile = file.name;
  state.mapError = "";
  state.mapExtract = "";
  state.mapWait = "read";
  state.mapPhase = "loading";
  state.mapAssignments = {};
  state.mapSuggested = {};
  state.mapReasons = {};
  state.mapTouched = {};
  state.clarify = null;
  render();
  const body = new FormData();
  body.append("file", file);
  fetch("/api/sheet-preview", { method: "POST", body: body })
    .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
    .then(function (pack) {
      if (state.page !== "engine") return;
      if (!pack.ok || !pack.data || !pack.data.columns) {
        state.mapPhase = "idle";
        state.mapFile = "";
        state.uploadBook = null;
        state.mapError = (pack.data && pack.data.error) || "没有读到这张表。";
        render();
        return;
      }
      state.uploadBook = pack.data;
      state.mapFile = pack.data.file || file.name;
      if (pack.data.planNote) state.mapExtract = pack.data.planNote;
      startClarify();
    })
    .catch(function () {
      state.mapPhase = "idle";
      state.mapFile = "";
      state.uploadBook = null;
      state.mapError = "上传失败。请确认页面服务还开着，再选一次文件。";
      render();
    });
});

document.getElementById("clientSel").addEventListener("change", (e) => {
  state.clientId = e.target.value;
  const ver = VERSIONS.find((v) => v.id === state.selectedVersion);
  silentSyncVersion(ver);
  state.regMsg = "已切换到客户「" + currentCustomer().name + "」（" + currentCustomer().category + "），知识库已静默同步。";
  state.agentChats = {};
  render();
});

document.getElementById("app").addEventListener("change", (e) => {
  const id = e.target.id;
  if (id === "tierSel") { state.bankTier = e.target.value; state.selectedWeight = 0; render(); return; }
  if (id === "clsSel") { state.weightFilter = e.target.value; state.selectedWeight = 0; render(); return; }
  if (id === "rwEditType") {
    const btn = document.querySelector("[data-maint-save=\"weight\"]");
    const rid = btn && btn.getAttribute("data-maint-id");
    const row = WEIGHTS.find(function (w) { return w.id === rid; });
    if (row) {
      if (!row.result) row.result = inferWeightResult(row.rw);
      row.result.type = e.target.value;
      if (row.result.type === "counterparty") row.result.display = "按交易对手";
      else if (row.result.type === "unspecified") row.result.display = "权重表未列明";
      else if (row.result.type === "max") row.result.display = row.result.display && row.result.display.indexOf("%") >= 0 ? row.result.display : "90%";
      else if (!row.result.display || row.result.display.indexOf("交易对手") >= 0 || row.result.display.indexOf("未列明") >= 0) row.result.display = "100%";
      syncWeightText(row);
    }
    render();
    return;
  }
  if (id && id.indexOf("ccfCondField") === 0) {
    const i = parseInt(id.slice("ccfCondField".length), 10);
    const row = CCF_RULES[state.selectedCcf];
    if (row) {
      row.type = maintField("ccfEditType") || row.type;
      row.note = maintField("ccfEditNote") || row.note;
      const ccf = maintField("ccfEditCcf");
      if (ccf) { row.ccf = ccf; row.ccfRate = parseWeightNumber(ccf); }
      const pri = parseInt(maintField("ccfEditPri"), 10);
      if (Number.isFinite(pri)) row.pri = pri;
      row.conds = readCcfCondEditor();
      const item = row.conds[i];
      if (item) {
        delete item.param;
        if (item.field === "cancelable" || item.field === "monitor_met") item.value = true;
        else if (item.field === "card_limit") {
          item.operator = "≤";
          item.param = "CARD_LIMIT";
          item.value = { param: "CARD_LIMIT" };
        } else if (typeof item.value === "boolean") item.value = "";
      }
      render();
    }
    return;
  }
  const clsField = e.target.getAttribute && e.target.getAttribute("data-cls-field");
  if (clsField) {
    if (!state.classifyFieldPick) state.classifyFieldPick = {};
    state.classifyFieldPick[clsField] = !!e.target.checked;
    render();
    return;
  }
  const paperRw = e.target.getAttribute && e.target.getAttribute("data-paper-rw");
  if (paperRw != null) {
    const leg = state.calcLegs[+paperRw];
    if (leg) applyHandWeight(leg, e.target.value);
    render();
    return;
  }
  const srcRw = e.target.getAttribute && e.target.getAttribute("data-src-rw");
  if (srcRw != null) {
    const row = (state.paperRows || [])[+srcRw];
    if (row) {
      const text = String(e.target.value == null ? "" : e.target.value).trim().replace(/%/g, "");
      const points = parseFloat(text);
      if (!isFinite(points)) {
        row.weight = null;
        row.rwa = null;
        row.weight_text = "未定权重";
      } else {
        row.weight = points / 100;
        row.weight_text = weightPoints(row.weight) + "%（手填）";
        row.rwa = (Number(row.ead) || 0) * row.weight;
        row.steps = (row.steps || []).filter(function (item) { return item.title !== "手填权重"; });
        row.steps.push(traceStep("权重", "手填权重", {
          actual: weightPoints(row.weight) + "%",
          result: weightPoints(row.weight) + "%",
          hit: true,
          note: "页面手填"
        }));
        row.steps.push(traceStep("风险加权资产", "敞口 × 权重", {
          result: row.rwa,
          hit: true,
          note: traceValue(row.ead) + " × " + weightPoints(row.weight) + "% "
        }));
        row.steps = numberTraceSteps(row.steps);
      }
    }
    render();
    return;
  }
  const handRw = e.target.getAttribute && e.target.getAttribute("data-hand-rw");
  if (handRw != null) {
    const leg = state.calcLegs[+handRw];
    if (leg) applyHandWeight(leg, e.target.value);
    render();
    return;
  }
  const clsSrc = e.target.getAttribute && e.target.getAttribute("data-cls-src");
  if (clsSrc) {
    state.mapAssignments[clsSrc] = e.target.value;
    state.mapTouched[clsSrc] = true;
    if (state.mapPhase === "confirmed") state.mapPhase = "ready";
    render();
    return;
  }
  const clsConst = e.target.getAttribute && e.target.getAttribute("data-cls-const");
  if (clsConst) {
    const v = e.target.value.trim();
    state.mapAssignments[clsConst] = v ? ("__const__:" + v) : "";
    state.mapTouched[clsConst] = true;
    if (state.mapPhase === "confirmed") state.mapPhase = "ready";
    render();
    return;
  }
  const clsPick = e.target.getAttribute && e.target.getAttribute("data-cls-pick");
  if (clsPick) {
    state.classifyPick[clsPick] = !!e.target.checked;
    render();
    return;
  }
  const clsTag = e.target.getAttribute && e.target.getAttribute("data-cls-tag");
  if (clsTag) {
    state.classifyTags[clsTag] = e.target.value;
    render();
    return;
  }
  const crmField = e.target.getAttribute && e.target.getAttribute("data-crm-field");
  if (crmField) {
    const i = +e.target.getAttribute("data-leg");
    const k = +e.target.getAttribute("data-crm-i");
    const leg = state.calcLegs[i];
    const app = leg && leg.crmApps && leg.crmApps[k];
    if (!app) return;
    state.selectedLeg = i;
    if (crmField === "eligible" || crmField === "maturityMatch" || crmField === "currencyMatch" || crmField === "floorExempt" || crmField === "correlated") app[crmField] = !!e.target.checked;
    else if (crmField === "coverageYi" || crmField === "haircut") app[crmField] = parseFloat(e.target.value) || 0;
    else app[crmField] = e.target.value;
    render();
    return;
  }
  const legField = e.target.getAttribute && e.target.getAttribute("data-leg-field");
  if (legField != null) {
    const i = +e.target.getAttribute("data-leg");
    const leg = state.calcLegs[i];
    if (!leg) return;
    state.selectedLeg = i;
    if (legField === "offbalance") leg.offbalance = e.target.value === "1";
    else if (legField === "name" || legField === "ccfRuleId" || legField === "originalRwRuleId") leg[legField] = e.target.value;
    else leg[legField] = parseFloat(e.target.value) || 0;
    render();
    return;
  }
  if (id === "mapProdSel") {
    state.product = e.target.value;
    if (state.uploadBook && (state.mapPhase === "ready" || state.mapPhase === "confirmed")) {
      requestModelMapping();
    } else if (state.mapPhase === "ready" || state.mapPhase === "confirmed") {
      state.mapPhase = "loading";
      state.mapWait = "";
      render();
      setTimeout(function () {
        if (state.page !== "engine") return;
        applyAiSuggestions();
        render();
      }, 500);
    } else {
      render();
    }
    return;
  }
  const assign = e.target.getAttribute && e.target.getAttribute("data-assign");
  if (assign) {
    state.mapAssignments[assign] = e.target.value;
    state.mapTouched[assign] = true;
    if (state.mapPhase === "confirmed") state.mapPhase = "ready";
    render();
    return;
  }
  if (e.target.id === "fieldPasteBox") {
    state.fieldPaste = e.target.value;
    return;
  }
  const packId = e.target.getAttribute && e.target.getAttribute("data-pack-id");
  if (packId) {
    state.fieldPackPick[packId] = !!e.target.checked;
    return;
  }
  const kbId = e.target.getAttribute && e.target.getAttribute("data-kb-id");
  if (kbId) {
    state.fieldKbPick[kbId] = !!e.target.checked;
    return;
  }
});

// 打字只记草稿。整页 render 会拆掉输入框，中文输入法组字会被打断。
let typeLabelComposing = false;
document.getElementById("app").addEventListener("submit", (e) => {
  if (e.target && e.target.id === "clarifyForm") {
    e.preventDefault();
    const input = document.getElementById("clarifyInput");
    sendClarify(input ? input.value : "");
  }
});
document.getElementById("app").addEventListener("compositionstart", (e) => {
  if (e.target && (e.target.id === "typeNewLabel" || e.target.id === "typeNewNote")) typeLabelComposing = true;
});
document.getElementById("app").addEventListener("compositionend", (e) => {
  if (!e.target || (e.target.id !== "typeNewLabel" && e.target.id !== "typeNewNote")) return;
  typeLabelComposing = false;
  state.typeDraft = state.typeDraft || { label: "", note: "" };
  if (e.target.id === "typeNewLabel") state.typeDraft.label = e.target.value;
  else state.typeDraft.note = e.target.value;
  if (e.target.id === "typeNewLabel") refreshTypeMatchPreview();
});
document.getElementById("app").addEventListener("input", (e) => {
  if (e.target && e.target.id === "clarifyInput" && state.clarify) state.clarify.draft = e.target.value;
  if (e.target && e.target.id === "fieldPasteBox") state.fieldPaste = e.target.value;
  if (e.target && e.target.id === "typeNewLabel") {
    state.typeDraft = state.typeDraft || { label: "", note: "" };
    state.typeDraft.label = e.target.value;
    const noteEl = document.getElementById("typeNewNote");
    if (noteEl) state.typeDraft.note = noteEl.value;
    if (typeLabelComposing || e.isComposing) return;
    refreshTypeMatchPreview();
  }
  if (e.target && e.target.id === "typeNewNote") {
    state.typeDraft = state.typeDraft || { label: "", note: "" };
    state.typeDraft.note = e.target.value;
  }
});

document.getElementById("agentDock").addEventListener("click", (e) => {
  if (e.target.closest("[data-agent-toggle]")) {
    state.agentOpen = !state.agentOpen;
    renderAgentDock();
    if (state.agentOpen) {
      const input = document.getElementById("agentInput");
      if (input) input.focus();
    }
    return;
  }
  const chip = e.target.closest("[data-agent-chip]");
  if (chip) {
    const action = chip.getAttribute("data-agent-chip");
    const label = chip.textContent.trim();
    if (state.agentBusy) return;
    const pageBefore = state.page;
    pushAgentMsg("user", label, { page: pageBefore });
    state.agentBusy = true;
    renderAgentDock();
    setTimeout(function () {
      state.agentBusy = false;
      const result = applyAgentAction(action);
      pushAgentMsg("bot", result.text, { page: pageBefore });
      render();
      scrollAgentMsgs();
    }, 380);
    return;
  }
  const act = e.target.closest("[data-agent-act]");
  if (act) {
    const action = act.getAttribute("data-agent-act");
    if (action === "noop") return;
    const result = applyAgentAction(action);
    pushAgentMsg("bot", result.text);
    render();
    return;
  }
});

document.getElementById("agentDock").addEventListener("submit", (e) => {
  if (e.target && e.target.id === "agentForm") {
    e.preventDefault();
    const input = document.getElementById("agentInput");
    handleAgentUserText(input ? input.value : "");
  }
});

document.getElementById("agentDock").addEventListener("input", (e) => {
  if (e.target && e.target.id === "agentInput") state.agentDraft = e.target.value;
});

const bootAudit = (window.App && App.boot) ? App.boot() : Promise.resolve();
bootAudit.then(function () {
  return fetch("/api/exposure-class").then(function (res) { return res.json(); });
}).then(function (data) {
  const flow = data && data.flow;
  if (!flow || !Array.isArray(flow.categories) || !flow.categories.length) return;
  BASE_EXP_TEMPLATE.categories = flow.categories;
  BASE_EXP_TEMPLATE.id = flow.id || BASE_EXP_TEMPLATE.id;
  BASE_EXP_TEMPLATE.name = flow.name || BASE_EXP_TEMPLATE.name;
  BASE_EXP_TEMPLATE.source = flow.source || "";
  if (flow.meta) BASE_EXP_TEMPLATE.meta = Object.assign({}, BASE_EXP_TEMPLATE.meta, flow.meta);
  if (flow.engine) BASE_EXP_TEMPLATE.engine = Object.assign({}, BASE_EXP_TEMPLATE.engine, flow.engine);
  if (Array.isArray(flow.fields) && flow.fields.length) state.classFields = flow.fields;
}).catch(function () {}).then(function () { render(); });
