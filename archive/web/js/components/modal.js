/* 弹窗壳和流程 JSON 弹窗 */
function modalShell(opts) {
  const o = opts || {};
  const sizeCls = o.xl ? " xl" : (o.wide ? " wide" : "");
  return "<div class=\"modal-backdrop\" data-modal-backdrop>"
    + "<div class=\"modal-dialog" + sizeCls + "\" role=\"dialog\" aria-modal=\"true\">"
    + "<div class=\"modal-head\"><div>"
    + "<h3>" + esc(o.title || "") + "</h3>"
    + (o.sub ? "<p>" + o.sub + "</p>" : "")
    + "</div><button type=\"button\" class=\"modal-close\" data-modal-dismiss aria-label=\"关闭\">×</button></div>"
    + "<div class=\"modal-body\">" + (o.body || "") + "</div>"
    + (o.foot ? "<div class=\"modal-foot\">" + o.foot + "</div>" : "")
    + "</div></div>";
}

function dismissModals() {
  state.regCreateOpen = false;
  state.fieldMode = null;
  state.paramCreateOpen = false;
  state.fieldSyncPhase = "idle";
  state.fieldPushPhase = "idle";
  state.expFlowModal = null;
  if (state.typeGenPhase !== "loading") {
    state.expTypeModal = false;
    state.fieldMsg = "";
  }
}

function resolveFlowForModal(modal) {
  if (!modal) return null;
  if (modal.kind === "overview") return BASE_EXP_TEMPLATE;
  if (modal.kind === "base") return BASE_EXP_TEMPLATE;
  const key = modal.productKey || state.product;
  const prod = PRODUCTS[key];
  if (!prod) return null;
  const flow = ensureProductExpFlow(key);
  if (isExpFlowRef(flow)) {
    return {
      mode: "ref",
      product_id: key,
      product: prod.label,
      based_on: BASE_EXP_TEMPLATE.id,
      note: "当前引用通用流程；编辑并保存将生成本产品副本。",
      resolves_to: BASE_EXP_TEMPLATE
    };
  }
  return flow;
}

function renderExpFlowModal() {
  const m = state.expFlowModal;
  if (!m) return "";
  const isOverview = m.kind === "overview";
  const isBase = m.kind === "base";
  const key = m.productKey || state.product;
  const prod = (!isOverview && !isBase) ? PRODUCTS[key] : null;
  const resolved = resolveFlowForModal(m);
  const isRef = !isOverview && !isBase && resolved && resolved.mode === "ref";
  const editable = !isOverview;
  const rawFlow = isRef ? (resolved.resolves_to || BASE_EXP_TEMPLATE) : resolved;
  const displayObj = isOverview
    ? logicViewOfOverview(resolved)
    : logicViewOfFlow(isRef
      ? { mode: "ref", based_on: resolved.based_on, resolves_to: rawFlow }
      : rawFlow);
  const title = isOverview
    ? "总览 · 字段与分线"
    : (isBase ? "通用流程 · 字段与公式" : ("产品流程 · " + ((prod && prod.label) || key)));
  const sub = isOverview
    ? "看用了哪些字段、如何分到各产品线路"
    : (isBase
      ? ("关注 fields_used / when / calc · " + (BASE_EXP_TEMPLATE.id || ""))
      : (isRef
        ? ("引用通用流程公式 · 编辑保存后生成副本")
        : ("关注判定字段与计算公式 · " + ((prod && prod.expFlow && prod.expFlow.id) || ("exp_flow_" + key)))));
  const body = "<p class=\"lead\">" + (isOverview
    ? "只展示分线逻辑与字段，不含样式。各产品公式请在对应线路中查看。"
    : "可以直接改这份 JSON。带 rules 的分类文件也可以整份粘贴，保存时会转成这张瀑布。") + "</p>"
    + (m.err ? "<div class=\"banner warn\">" + esc(m.err) + "</div>" : "")
    + (isRef && !editable ? "<div class=\"banner\">本产品尚未分叉，以下为<strong>通用模板</strong>的字段与公式。</div>" : "")
    + (editable
      ? ("<textarea id=\"expFlowModalJson\" class=\"field-paste\" style=\"min-height:420px;font-size:11px;line-height:1.45\">"
        + esc(prettyJson(displayObj)) + "</textarea>")
      : ("<div class=\"dsl\" style=\"max-height:480px\">" + esc(prettyJson(displayObj)) + "</div>"));
  const foot = "<button type=\"button\" class=\"btn\" data-modal-dismiss>关闭</button>"
    + (editable
      ? "<button type=\"button\" class=\"btn btn-primary\" data-exp-flow-modal-save>保存流程</button>"
      : "");
  return modalShell({
    xl: true,
    title: title,
    sub: sub,
    body: body,
    foot: foot
  });
}
