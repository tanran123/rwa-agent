/* 风险权重页 */
function weightResultEditor(sel) {
  const type = (sel.result && sel.result.type) || "const";
  const shown = type === "const" || type === "max" ? ((sel.result && sel.result.display) || sel.rw || "") : resultText(sel.result);
  const typeOpts = WEIGHT_RESULT_TYPES.map(function (pair) {
    return "<option value=\"" + pair[0] + "\"" + (type === pair[0] ? " selected" : "") + ">" + pair[1] + "</option>";
  }).join("");
  let valueBox = "";
  if (type === "const") {
    valueBox = "<div class=\"field\"><label>百分比</label><input id=\"rwEditRw\" value=\"" + esc(shown) + "\" /></div>";
  } else if (type === "max") {
    valueBox = "<div class=\"field\"><label>固定值</label><input id=\"rwEditRw\" value=\"" + esc((sel.result && sel.result.display) || "90%") + "\" />"
      + "<div style=\"font-size:11px;color:var(--muted);margin-top:4px\">与交易对手的普通债权权重取较大值。</div></div>";
  } else if (type === "counterparty") {
    valueBox = "<p style=\"font-size:12px;color:var(--muted)\">用交易对手自己的普通债权权重。公司走公司，个人走个人，银行走银行。只查一次。</p>";
  } else {
    valueBox = "<p style=\"font-size:12px;color:var(--muted)\">权重表没有给出这一档，保持未列明，路由会转人工，不补百分比。</p>";
  }
  return "<div class=\"field\"><label>结果类型</label><select id=\"rwEditType\">" + typeOpts + "</select></div>" + valueBox;
}

function pageWeights() {
  const locked = configScopeNote("weights");
  if (locked) return ph("weights") + locked;
  if (activeConfigVersion() === "MO-2026") return pageMoWeights();
  refreshDerived();
  const pool = allWeightRows();
  const filtered = pool.filter((w) => {
    if (state.bankTier === "first" && w.bank === "第二档") return false;
    if (state.bankTier === "second" && w.bank === "第一档") return false;
    if (state.weightFilter !== "all" && w.cls.indexOf(state.weightFilter) < 0) return false;
    return true;
  });
  const idx = Math.min(state.selectedWeight, Math.max(0, filtered.length - 1));
  const sel = filtered[idx];
  const rows = filtered.map((w, i) =>
    "<tr class=\"clickable" + (i === idx ? " selected" : "") + "\" data-weight=\"" + i + "\">"
    + "<td class=\"mono\">" + esc(w.id) + "</td><td>" + esc(w.cls) + "</td><td>" + esc(w.cond) + "</td>"
    + "<td class=\"num\"><strong>" + esc(w.rw) + "</strong></td><td class=\"num\">" + w.pri + "</td>"
    + "<td><span class=\"tag\">" + esc(w.bank) + "</span></td></tr>"
  ).join("");
  const catalog = weightCatalog().map((c) =>
    "<tr><td><strong>" + esc(c.cls) + "</strong></td><td>" + esc(c.products) + "</td><td style=\"color:var(--muted)\">" + esc(c.rule) + "</td></tr>"
  ).join("");
  const msg = state.maintMsg && state.page === "weights" ? "<div class=\"banner ok\">" + esc(state.maintMsg) + "</div>" : "";
  const grid = BANK_GRID.grades.map(function (g, col) {
    return "<th>" + esc(g) + "</th>";
  }).join("");
  const gridRows = BANK_GRID.rows.map(function (row) {
    const cells = row.weights.map(function (w, col) {
      return "<td class=\"num\"><strong>" + esc(w) + "</strong></td>";
    }).join("");
    const gate = row.param ? (" · " + esc(row.label) + " " + esc(paramShown(row.param))) : (" · " + esc(row.label));
    return "<tr><td>第一档" + gate + "</td>" + cells + "</tr>";
  }).join("");
  const editor = sel
    ? ("<aside class=\"side\"><h3>" + esc(sel.id) + "</h3>"
      + "<p style=\"margin:0 0 10px;color:var(--muted);font-size:12px\">" + esc(sel.cls) + (sel.exposure_class ? " · " + esc(sel.exposure_class) : "") + (sel.grid ? " · 评级表里的一格" : "") + "</p>"
      + "<div class=\"field\"><label>可执行 JSON</label><pre style=\"font-size:11px;background:#f4f6f9;padding:8px;border-radius:8px;overflow:auto;max-height:220px;white-space:pre-wrap\">" + esc(prettyJson(weightRuleDoc(sel))) + "</pre></div>"
      + (sel.grid
        ? ("<div class=\"field\"><label>百分比</label><input id=\"rwEditRw\" value=\"" + esc(sel.rw) + "\" />"
          + "<div style=\"font-size:11px;color:var(--muted);margin-top:4px\">条件来自银行档、评级和规则参数里的期限，这里只改这一格的百分比。</div></div>")
        : (condEditorHtml(sel.conds, "rwCond") + weightResultEditor(sel)
          + "<div class=\"field\"><label>优先级</label><input id=\"rwEditPri\" value=\"" + esc(sel.pri) + "\" /></div>"
          + "<div class=\"field\"><label>银行档</label><select id=\"rwEditBank\">"
          + ["双档", "第一档", "第二档"].map(function (b) {
            return "<option value=\"" + b + "\"" + (sel.bank === b ? " selected" : "") + ">" + b + "</option>";
          }).join("")
          + "</select></div>"
          + "<div class=\"field\"><label>说明</label><textarea id=\"rwEditBasis\" rows=\"3\">" + esc(sel.basis || "") + "</textarea></div>"))
      + "<button type=\"button\" class=\"btn btn-primary\" data-maint-save=\"weight\" data-maint-id=\"" + esc(sel.id) + "\">保存这条权重</button>"
      + "</aside>")
    : "";
  return ph("weights")
    + msg
    + "<div class=\"banner\">当前维护「资本管理办法 2025」。每条权重的条件是字段、运算符和值，结果写在 risk_weight 里。右侧 JSON 就是这条规则的可执行形式，不另存一句中文条件。第一档银行的评级百分比在下面这张表里改。分类瀑布不从这里生成。</div>"
    + (state.weightFilter === "catalog" ? "" : "<div class=\"panel\" style=\"margin-bottom:14px\"><div class=\"panel-head\"><h2>第一档银行评级表</h2><span>改某一格请在右侧选中对应行</span></div>"
      + "<div class=\"table-wrap\"><table class=\"data\"><thead><tr><th>条件</th>" + grid + "</tr></thead><tbody>" + gridRows + "</tbody></table></div></div>")
    + "<div class=\"tabs\">"
    + "<button type=\"button\" data-wtab=\"rules\" class=\"" + (state.weightFilter !== "catalog" ? "active" : "") + "\">结构化规则</button>"
    + "<button type=\"button\" data-wtab=\"catalog\" class=\"" + (state.weightFilter === "catalog" ? "active" : "") + "\">监管摘要表</button>"
    + "</div>"
    + (state.weightFilter === "catalog"
      ? "<div class=\"panel\"><div class=\"panel-head\"><h2>表内风险权重 · 按暴露类别</h2><span>由权重表拼出</span></div>"
        + "<div class=\"table-wrap\" style=\"max-height:560px\"><table class=\"data\"><thead><tr>"
        + "<th>风险暴露类别</th><th>典型银行产品</th><th>权重法规则</th></tr></thead><tbody>"
        + catalog + "</tbody></table></div></div>"
      : "<div class=\"toolbar\">"
        + "<div class=\"field\"><label>银行档次</label><select id=\"tierSel\">"
        + "<option value=\"first\"" + (state.bankTier === "first" ? " selected" : "") + ">第一档</option>"
        + "<option value=\"second\"" + (state.bankTier === "second" ? " selected" : "") + ">第二档</option>"
        + "<option value=\"all\"" + (state.bankTier === "all" ? " selected" : "") + ">全部</option></select></div>"
        + "<div class=\"field\"><label>暴露类别</label><select id=\"clsSel\">"
        + ["all","现金及主权类","公共部门实体","金融机构","公司贷款","专业贷款","个人贷款","居住用房地产","商用房地产","房地产开发","股权及次级债权","已违约风险暴露"]
          .map((c) => "<option value=\"" + c + "\"" + (state.weightFilter === c ? " selected" : "") + ">"
            + (c === "all" ? "全部" : c) + "</option>").join("")
        + "</select></div></div>"
        + "<div class=\"split\"><div class=\"panel\"><div class=\"panel-head\"><h2>Risk_Weight_Rule</h2><span>" + filtered.length + " 条</span></div>"
        + "<div class=\"table-wrap\"><table class=\"data\"><thead><tr>"
        + "<th>Rule ID</th><th>类别</th><th>条件</th><th>RW</th><th>优先级</th><th>档</th></tr></thead><tbody>"
        + rows + "</tbody></table></div></div>"
        + editor + "</div>");
}
