/* 右下角规则智能体 */
function currentAgent() {
  return PAGE_AGENTS[state.page] || PAGE_AGENTS.overview;
}

function ensureAgentChat(pageId) {
  const id = pageId || state.page;
  if (!state.agentChats[id]) {
    const ag = PAGE_AGENTS[id] || PAGE_AGENTS.overview;
    state.agentChats[id] = [
      { role: "bot", text: ag.welcome, meta: ag.name }
    ];
  }
  return state.agentChats[id];
}

function pushAgentMsg(role, text, opts) {
  const pageId = (opts && opts.page) || state.page;
  const ag = PAGE_AGENTS[pageId] || currentAgent();
  const chat = ensureAgentChat(pageId);
  const msg = { role: role, text: text, meta: (opts && opts.meta) || (role === "bot" ? ag.name : "你") };
  if (opts && opts.actions) msg.actions = opts.actions;
  chat.push(msg);
  return msg;
}

function applyAgentAction(action) {
  if (!action) return { ok: false, text: "未识别到可执行操作。" };
  if (action.indexOf("goto:") === 0) {
    state.page = action.slice(5);
    return { ok: true, text: "已打开「" + ((PAGES.find((p) => p.id === state.page) || {}).label || state.page) + "」页面。右下角智能体会切换为该页助手。" };
  }
  if (action === "explain") {
    return { ok: true, text: "配置菜单维护监管版本、字段、参数、暴露、权重、CCF、CRM；计算菜单先分类，再核对该模型的字段并试算。规则可变、产品模型不变。" };
  }
  if (action === "reg:hk") {
    state.regRegion = "香港";
    state.selectedVersion = "HK-2026";
    return { ok: true, text: "已切换到香港草案 HK-2026。内地规则包不会串用。" };
  }
  if (action === "reg:cn") {
    state.regRegion = "中国大陆";
    state.selectedVersion = "CN-2025";
    return { ok: true, text: "已切回内地生效版本 CN-CAPITAL-2025。" };
  }
  if (action === "reg:open-create") {
    state.regCreateOpen = true;
    state.regDraft = Object.assign({}, state.regDraft, {
      name: "资本管理办法修订稿",
      shortName: "修订稿",
      region: state.regRegion === "全部" ? "中国大陆" : state.regRegion,
      status: "草案",
      from: todayIso(),
      to: "",
      updatedAt: todayIso(),
      note: "智能体打开新建表单"
    });
    state.regMsg = "";
    return { ok: true, text: "已打开新建版本表单。请填写生效日与知识库截取时点；保存后将静默同步到知识库。" };
  }
  if (action === "reg:kb-sync" || action === "reg:kb-client" || action === "reg:kb-global" || action === "reg:bump-time") {
    const ver = VERSIONS.find((v) => v.id === state.selectedVersion);
    if (!ver) return { ok: false, text: "未选中版本。" };
    if (action === "reg:bump-time") ver.updatedAt = todayIso();
    silentSyncVersion(ver);
    state.regMsg = "已静默同步版本 " + ver.id + " 到知识库（本客户 + 全部检索）· 时点 " + ver.updatedAt + "。";
    return { ok: true, text: state.regMsg };
  }
  if (action === "field:sync-all" || action === "field:sync-one") {
    state.page = "fields";
    state.fieldMode = "sync";
    state.fieldSyncPhase = "idle";
    const prod = currentProduct();
    return { ok: true, text: prod
      ? ("已打开「从知识库同步」：按类型「" + prod.label + "」匹配相关产品字段。")
      : "请先新建产品类型，再同步知识库。" };
  }
  if (action === "field:open-type") {
    state.page = "exposure";
    state.expScope = "product";
    state.expTypeModal = true;
    state.fieldMode = null;
    state.fieldMsg = "";
    state.typeDraft = { label: "", note: "" };
    return { ok: true, text: "已在分类判断页打开新建：将以通用模板为底生成产品瀑布并放到图上。" };
  }
  if (action === "field:open-create") {
    state.page = "fields";
    if (!currentProduct()) {
      state.fieldMode = "type";
      return { ok: true, text: "还没有产品类型，请先新建类型。" };
    }
    state.fieldMode = "create";
    state.fieldMsg = "";
    state.fieldDraft = { id: "", zh: "", type: "字符串", sample: "", required: false };
    return { ok: true, text: "已打开新建字段表单，字段将挂在「" + currentProduct().label + "」下。" };
  }
  if (action === "reg:new-mo") {
    state.regDraft = {
      name: "AMCM 资本充足规则（智能体新建草案）",
      shortName: "AMCM Draft+",
      region: "澳门",
      status: "草案",
      from: "2026-07-01",
      to: "",
      updatedAt: todayIso(),
      note: "由监管版本智能体新建"
    };
    const ver = createRegulationVersion(state.regDraft);
    silentSyncVersion(ver);
    state.regRegion = "澳门";
    state.selectedVersion = ver.id;
    state.regCreateOpen = false;
    state.regMsg = "已新建 " + ver.id + "，截取时点 " + ver.updatedAt + "，已静默同步到知识库。";
    return { ok: true, text: state.regMsg };
  }
  if (action === "field:add-ltv") {
    const added = addFieldsToProduct(state.product, [
      { id: "ltv", type: "数值%", sample: "65", required: false, zh: "贷款价值比" }
    ], "custom");
    FIELD_LABEL.ltv = "贷款价值比";
    state.selectedField = Math.max(0, PRODUCTS[state.product].fields.findIndex((f) => f.id === "ltv"));
    return { ok: true, text: added ? "已向「" + PRODUCTS[state.product].label + "」新增字段 ltv，并已静默写入知识库。" : "字段 ltv 已存在，未重复添加。" };
  }
  if (action === "field:req-ig") {
    const f = PRODUCTS[state.product].fields.find((x) => x.id === "investment_grade" || x.id === "inv_grade");
    if (!f) {
      addFieldsToProduct(state.product, [{ id: "investment_grade", type: "布尔", sample: "true", required: true, zh: "是否投资级" }], "custom");
      FIELD_LABEL.investment_grade = "是否投资级";
      state.selectedField = PRODUCTS[state.product].fields.length - 1;
      return { ok: true, text: "当前产品没有投资级字段，已新增 investment_grade 并设为必填。" };
    }
    f.required = true;
    state.selectedField = PRODUCTS[state.product].fields.indexOf(f);
    return { ok: true, text: "已将「" + (FIELD_LABEL[f.id] || f.id) + "」设为必填。" };
  }
  if (action === "field:core") {
    const pack = FIELD_PACKS.find((x) => x.id === "core");
    const added = pack ? addFieldsToProduct(state.product, pack.fields, "kb") : 0;
    return { ok: true, text: "已从核心字段包补齐 " + added + " 个字段（已存在的会跳过）。" };
  }
  if (action === "map:demo") {
    state.page = "engine";
    state.calcStage = 0;
    state.uploadBook = null;
    state.mapError = "";
    state.mapFile = SAMPLE_UPLOAD.file;
    state.mapPhase = "loading";
    state.mapAssignments = {};
    state.mapSuggested = {};
    state.mapReasons = {};
    state.mapTouched = {};
    setTimeout(function () {
      if (state.page !== "engine") return;
      applyAiSuggestions();
      pushAgentMsg("bot", "表头已识别。请先把判定字段对到列，再开始计算。", { page: "engine" });
      render();
    }, 700);
    return { ok: true, text: "已进入计算 · 映射，正在识别表头…" };
  }
  if (action === "map:confirm") {
    if (state.mapPhase === "idle" || state.mapPhase === "loading") {
      return { ok: false, text: "还没有可核对的映射，请先上传或点「演示上传并识别」。" };
    }
    state.mapPhase = "confirmed";
    state.page = "engine";
    state.calcStage = 1;
    return { ok: true, text: "映射已完成，已进入计算。每一行会带上风险暴露类型和 RWA。" };
  }
  if (action === "map:unlock") {
    if (state.mapPhase !== "confirmed") return { ok: false, text: "当前未锁定，可直接修改映射。" };
    state.mapPhase = "ready";
    state.calcStage = 0;
    return { ok: true, text: "已解锁映射，回到映射。" };
  }
  if (action === "param:ltv60") {
    const p = PARAMS.find((x) => x.id === "LTV_RES_50");
    if (p) state.selectedParam = PARAMS.indexOf(p);
    state.page = "params";
    return { ok: true, text: "居住用房地产的 LTV 分界是 50% 和 100%，没有改成 60%。60% 和 80% 是商用房地产的分界。" };
  }
  if (action === "param:add") {
    state.page = "params";
    state.selectedParam = PARAMS.findIndex((p) => p.id === "TRADE_6M");
    return { ok: true, text: "跨境货物贸易的期限是 6 个月，和原始期限 3 个月是两条不同的优惠，都只适用于第一档 A+、A、B、C。" };
  }
  if (action === "param:reset-def") {
    const p = PARAMS.find((x) => x.id === "DEF_PROV");
    if (p) { p.value = "20%"; state.selectedParam = PARAMS.indexOf(p); }
    return { ok: true, text: "已恢复已违约准备占比门槛为 20%。" };
  }
  if (action === "exp:scope-overview") {
    state.page = "exposure";
    if (!currentProduct()) return { ok: false, text: "还没有产品类型，请先去产品标准字段新建类型。" };
    state.expScope = "product";
    state.selectedExposure = "";
    state.expExpanded = {};
    state.confirmedLeaf = "";
    state.expCenterPending = true;
    state.expMsg = "已打开「" + currentProduct().label + "」的分类。";
    return { ok: true, text: state.expMsg };
  }
  if (action === "exp:scope-base") {
    state.page = "exposure";
    state.expScope = "base";
    state.selectedExposure = "";
    state.expExpanded = {};
    state.confirmedLeaf = "";
    state.expCenterPending = true;
    state.expMsg = "已打开通用流程模板，整棵分类树都在。";
    return { ok: true, text: state.expMsg };
  }
  if (action === "exp:scope-product") {
    state.page = "exposure";
    if (!currentProduct()) return { ok: false, text: "还没有产品类型，请先去产品标准字段新建类型。" };
    state.expScope = "product";
    ensureProductExpFlow(state.product);
    state.selectedExposure = "";
    state.expExpanded = {};
    state.confirmedLeaf = "";
    state.expCenterPending = true;
    state.expMsg = productSkipIds(state.product).length
      ? ("「" + currentProduct().label + "」走同一套分类，已去掉不适用的分支。")
      : ("「" + currentProduct().label + "」走同一套分类。");
    return { ok: true, text: state.expMsg };
  }
  if (action === "exp:demo-corp") {
    state.page = "exposure";
    state.expExpanded = { "cat:corp": true };
    state.selectedExposure = "cat:corp";
    state.expCenterPending = true;
    return { ok: true, text: "已展开公司贷款。右侧是一般公司、投资级、中小企业和小微企业。第二档不单独划分投资级公司，按一般公司 100%。" };
  }
  if (action === "exp:demo-bank") {
    state.page = "exposure";
    state.expExpanded = { "cat:bank": true };
    state.selectedExposure = "cat:bank";
    state.expCenterPending = true;
    return { ok: true, text: "已演示「金融机构」层命中路径。" };
  }
  if (action === "exp:add-kcb") {
    return { ok: false, text: "权重表没有「科创板 / 高新」这一档，不能按 85% 新增。中小企业才是 85%。" };
  }
  if (action === "rw:add-ig70") {
    state.page = "weights";
    state.weightFilter = "公司贷款";
    state.bankTier = "first";
    state.selectedWeight = 0;
    return { ok: true, text: "投资级公司是 75%，不是 70%。已定位到 CN_CORP_IG，没有新增规则。" };
  }
  if (action === "rw:filter-corp") {
    state.weightFilter = "公司贷款";
    state.selectedWeight = 0;
    return { ok: true, text: "已筛选暴露类别为「公司贷款」。" };
  }
  if (action === "rw:tier2") {
    state.bankTier = "second";
    state.selectedWeight = 0;
    return { ok: true, text: "已切换到第二档银行视角（第一档专属规则会隐藏）。" };
  }
  if (action === "ccf:add") {
    state.page = "ccf";
    const i = CCF_RULES.findIndex((r) => r.id === "CCF_TRADE_20");
    state.selectedCcf = i >= 0 ? i : 0;
    return { ok: true, text: "没有单独的「跟单信用证 20%」。与贸易直接相关的短期或有项目是 20%，服务贸易国内信用证是 50%。" };
  }
  if (action === "ccf:pick40") {
    const i = CCF_RULES.findIndex((r) => String(r.ccf).indexOf("40") >= 0 || /一般承诺/.test(r.type + r.cond));
    state.selectedCcf = i >= 0 ? i : 0;
    return { ok: true, text: "已选中一般承诺类 CCF 40% 规则。" };
  }
  if (action === "ccf:to-engine") {
    const rule = CCF_RULES[state.selectedCcf] || CCF_RULES[0];
    state.calcLegs.push(newCalcLeg({
      name: rule.type || "表外暴露",
      offbalance: true, nominalYi: 50, ccfRuleId: rule.id, crmApps: []
    }));
    state.selectedLeg = state.calcLegs.length - 1;
    state.page = "engine";
    state.calcStage = 1;
    return { ok: true, text: "已在试算中新增一笔表外暴露，使用 " + rule.id + "（" + rule.ccf + "）。可与表内同时合计。" };
  }
  if (action === "crm:add-gold") {
    state.page = "crm";
    const i = CRM_RULES.findIndex((r) => r.id === "CRM_COL_CASH");
    state.selectedCrm = i >= 0 ? i : 0;
    return { ok: true, text: "黄金是合格质物。受保护部分取得质物本身的风险权重，权重表没有把黄金写成 0%。" };
  }
  if (action === "crm:pick-gov") {
    const i = CRM_RULES.findIndex((r) => /国债|政府|质物/.test(r.tool + r.type));
    state.selectedCrm = i >= 0 ? i : 0;
    return { ok: true, text: "已选中国债/政府类质押规则。" };
  }
  if (action === "crm:to-engine") {
    state.page = "engine";
    state.calcStage = 1;
    return { ok: true, text: "已打开计算 · 试算，可改质押/保证金额即时重算 CRM 拆分。" };
  }
  if (action === "eng:reset") {
    state.calcLegs = demoCalcLegs();
    state.selectedLeg = 0;
    state.calcStage = 1;
    return { ok: true, text: "已恢复文档基准例（单笔表内）：账面 100、减值 10、质押 10、保证 50 → RWA 55。可再添加表外。" };
  }
  if (action === "eng:off80") {
    state.calcLegs.push(newCalcLeg({
      name: "贷款承诺（表外）", offbalance: true,
      nominalYi: 50, ccfRuleId: "CCF_COMMIT_40", crmApps: []
    }));
    state.selectedLeg = state.calcLegs.length - 1;
    state.calcStage = 1;
    return { ok: true, text: "已追加贷款承诺：名义 50 亿 × CCF_COMMIT_40 的 40% = 等值表内 20 亿。系数来自 CCF 规则，不是另写的风险权重。" };
  }
  if (action === "eng:guar40") {
    const leg = state.calcLegs[state.selectedLeg] || state.calcLegs[0];
    if (leg) {
      if (!leg.crmApps) leg.crmApps = [];
      let app = leg.crmApps.find(function (item) { return item.ruleId === "CRM_GUAR_PSE"; });
      if (!app) {
        app = defaultCrmApp("CRM_GUAR_PSE");
        leg.crmApps.push(app);
      }
      app.coverageYi = 40;
    }
    state.calcStage = 1;
    return { ok: true, text: "当前笔保证覆盖已改为 40 亿，合计 RWA 已重算。" };
  }
  return { ok: false, text: "暂未支持该操作：" + action };
}

function inferAgentAction(text) {
  const t = String(text || "");
  const ag = currentAgent();
  const hit = (ag.chips || []).find((c) => t.indexOf(c.label.replace(/\s/g, "")) >= 0 || t.indexOf(c.label) >= 0);
  if (hit) return hit.action;
  if (/香港/.test(t)) return "reg:hk";
  if (/内地|大陆|2025/.test(t) && state.page === "regulation") return "reg:cn";
  if (/打开新建|新建版本/.test(t) && state.page === "regulation") return "reg:open-create";
  if (/全部检索|全局/.test(t) && state.page === "regulation") return "reg:kb-global";
  if (/本客户|沉淀到本/.test(t) && state.page === "regulation") return "reg:kb-client";
  if (/更新时点|刷新/.test(t) && state.page === "regulation") return "reg:bump-time";
  if (/新建类型|新建产品类型|产品类型/.test(t) && /新建|新增|打开/.test(t)) return "field:open-type";
  if (/同步当前|同步.*类型|同步.*字段|从知识库同步/.test(t)) return "field:sync-one";
  if (/打开新建|新建字段|自己维护|自行维护/.test(t)) return "field:open-create";
  if (/澳门/.test(t) && /新建|新增|草案/.test(t)) return "reg:new-mo";
  if (/LTV|ltv/.test(t) && /新增|添加|加/.test(t)) return "field:add-ltv";
  if (/投资级/.test(t) && /必填/.test(t)) return "field:req-ig";
  if (/核心字段|补齐/.test(t)) return "field:core";
  if (/上传|识别/.test(t) && state.page === "engine") return "map:demo";
  if (/确认映射/.test(t)) return "map:confirm";
  if (/公司/.test(t) && /演示|命中/.test(t)) return "exp:demo-corp";
  if (/总览|分线|识别产品/.test(t)) return "exp:scope-product";
  if (/基础模板|基础流程|通用模板|通用流程/.test(t)) return "exp:scope-base";
  if (/产品流程|产品线路|当前产品.*流程/.test(t)) return "exp:scope-product";
  if (/科创|高新/.test(t)) return "exp:add-kcb";
  if (/70%|投资级/.test(t) && state.page === "weights") return "rw:add-ig70";
  if (/恢复|文档示例|基准/.test(t) && state.page === "engine") return "eng:reset";
  if (/表外/.test(t) && state.page === "engine") return "eng:off80";
  if (/保证/.test(t) && /40/.test(t)) return "eng:guar40";
  if (/黄金/.test(t)) return "crm:add-gold";
  if (/信用证/.test(t)) return "ccf:add";
  if (/解释|分工|架构/.test(t)) return "explain";
  return null;
}

function handleAgentUserText(text) {
  const raw = String(text || "").trim();
  if (!raw || state.agentBusy) return;
  pushAgentMsg("user", raw);
  state.agentDraft = "";
  state.agentBusy = true;
  renderAgentDock();
  const action = inferAgentAction(raw);
  const pageBefore = state.page;
  setTimeout(function () {
    state.agentBusy = false;
    if (action) {
      const result = applyAgentAction(action);
      pushAgentMsg("bot", result.text, { page: pageBefore });
    } else {
      const ag = PAGE_AGENTS[pageBefore] || PAGE_AGENTS.overview;
      const chips = (ag.chips || []).map((c) => "「" + c.label + "」").join("、");
      pushAgentMsg("bot", "我是本页的「" + ag.name + "」。可以点下方快捷指令，或试着说：" + chips + "。对知识库的写入均为静默同步。", { page: pageBefore });
    }
    render();
    scrollAgentMsgs();
  }, 420);
}

function scrollAgentMsgs() {
  const el = document.getElementById("agentMsgs");
  if (el) el.scrollTop = el.scrollHeight;
}

function renderAgentDock() {
  const dock = document.getElementById("agentDock");
  if (!dock) return;
  const ag = currentAgent();
  ensureAgentChat(state.page);
  const chat = state.agentChats[state.page] || [];
  const chips = (ag.chips || []).map((c) =>
    "<button type=\"button\" data-agent-chip=\"" + esc(c.action) + "\">" + esc(c.label) + "</button>"
  ).join("");
  const msgs = chat.map((m) => {
    const acts = (m.actions || []).map((a) =>
      "<button type=\"button\" class=\"" + (a.primary ? "primary" : "") + "\" data-agent-act=\"" + esc(a.action) + "\">" + esc(a.label) + "</button>"
    ).join("");
    return "<div class=\"bubble " + (m.role === "user" ? "user" : "bot") + "\">"
      + "<span class=\"meta\">" + esc(m.meta || (m.role === "user" ? "你" : ag.name)) + "</span>"
      + esc(m.text).replace(/\n/g, "<br>")
      + (acts ? "<div class=\"acts\">" + acts + "</div>" : "")
      + "</div>";
  }).join("");
  const fabIcon = state.agentOpen
    ? "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" aria-hidden=\"true\"><path d=\"M6 6l12 12M18 6L6 18\"/></svg>"
    : "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M4.5 6.5A2.5 2.5 0 0 1 7 4h10a2.5 2.5 0 0 1 2.5 2.5v7A2.5 2.5 0 0 1 17 16H9.2L5.5 19.2V16A2.5 2.5 0 0 1 4.5 13.5v-7z\"/></svg>";
  dock.innerHTML = "<button type=\"button\" class=\"agent-fab" + (state.agentOpen ? " open" : "") + "\" data-agent-toggle title=\"" + esc(ag.name) + "\" aria-label=\"" + esc(ag.name) + "\">"
    + fabIcon + "</button>"
    + "<aside class=\"agent-panel" + (state.agentOpen ? "" : " hidden") + "\" aria-label=\"规则智能体\">"
    + "<div class=\"agent-head\">"
    + "<div class=\"agent-avatar\">AI</div>"
    + "<div><strong>" + esc(ag.name) + "</strong><span>" + esc(ag.role) + "</span></div>"
    + "<button type=\"button\" class=\"agent-close\" data-agent-toggle aria-label=\"关闭\">×</button>"
    + "</div>"
    + "<div class=\"agent-chips\">" + chips + "</div>"
    + "<div class=\"agent-msgs\" id=\"agentMsgs\">" + msgs
    + (state.agentBusy ? "<div class=\"bubble bot\"><span class=\"meta\">" + esc(ag.name) + "</span>思考中…</div>" : "")
    + "</div>"
    + "<form class=\"agent-input\" id=\"agentForm\">"
    + "<input id=\"agentInput\" placeholder=\"对本页规则说：新增 / 修改…\" value=\"" + esc(state.agentDraft) + "\" autocomplete=\"off\" />"
    + "<button type=\"submit\"" + (state.agentBusy ? " disabled" : "") + ">发送</button>"
    + "</form></aside>";
  if (state.agentOpen) requestAnimationFrame(scrollAgentMsgs);
}
