/* CCF 页 */
function ccfCondEditorHtml(conds) {
  const fields = ["cancelable", "counterparty_type", "card_limit", "monitor_met", "product_sub_type", "original_maturity"];
  const boolFields = { cancelable: true, monitor_met: true };
  return (conds || []).map(function (c, i) {
    const pickedOp = condOperator(c);
    const pickedParam = condParamId(c);
    const fieldOpts = fields.map(function (fid) {
      return "<option value=\"" + fid + "\"" + (c.field === fid ? " selected" : "") + ">" + esc((FIELD_LABEL[fid] || fid) + " · " + fid) + "</option>";
    }).join("");
    const opOpts = ["=", "≠", "≤", "≥", "in"].map(function (op) {
      return "<option" + (pickedOp === op ? " selected" : "") + ">" + op + "</option>";
    }).join("");
    let valueBox = "";
    if (boolFields[c.field]) {
      const yes = c.value === true || c.value === "true";
      valueBox = "<select id=\"ccfCondBool" + i + "\"><option value=\"true\"" + (yes ? " selected" : "") + ">是</option><option value=\"false\"" + (!yes ? " selected" : "") + ">否</option></select>";
    } else if (c.field === "card_limit") {
      valueBox = "<select id=\"ccfCondParam" + i + "\"><option value=\"\">手填</option><option value=\"CARD_LIMIT\"" + (pickedParam === "CARD_LIMIT" ? " selected" : "") + ">单卡上限 · " + esc(paramShown("CARD_LIMIT")) + "</option></select>";
    } else {
      const shown = Array.isArray(c.value) ? c.value.join(" | ") : (c.value == null ? "" : c.value);
      valueBox = "<input id=\"ccfCondValue" + i + "\" value=\"" + esc(shown) + "\" />";
    }
    return "<div style=\"border:1px solid var(--border);border-radius:8px;padding:8px;margin-bottom:8px\">"
      + "<div class=\"field\"><label>判定 " + (i + 1) + "</label><select id=\"ccfCondField" + i + "\">" + fieldOpts + "</select></div>"
      + "<div class=\"field\"><label>比较</label><div style=\"display:flex;gap:8px\"><select id=\"ccfCondOp" + i + "\" style=\"width:72px\">" + opOpts + "</select><div style=\"flex:1\">" + valueBox + "</div></div></div>"
      + "<button type=\"button\" class=\"btn\" data-ccf-del-cond=\"" + i + "\">去掉这条判定</button></div>";
  }).join("");
}

function readCcfCondEditor() {
  const out = [];
  for (let i = 0; ; i++) {
    const fieldEl = document.getElementById("ccfCondField" + i);
    if (!fieldEl) break;
    const field = fieldEl.value;
    const opEl = document.getElementById("ccfCondOp" + i);
    const op = opEl ? opEl.value : "=";
    const item = { field: field, operator: op };
    const boolEl = document.getElementById("ccfCondBool" + i);
    const paramEl = document.getElementById("ccfCondParam" + i);
    const valueEl = document.getElementById("ccfCondValue" + i);
    if (boolEl) item.value = boolEl.value === "true";
    else if (paramEl && paramEl.value) {
      item.param = paramEl.value;
      item.value = { param: paramEl.value };
    } else if (valueEl) {
      const value = String(valueEl.value || "").trim();
      item.value = op === "in" ? value.split("|").map(function (s) { return s.trim(); }).filter(Boolean) : value;
    }
    if (field) out.push(item);
  }
  return out;
}

function pageCcf() {
  const locked = configScopeNote("ccf");
  if (locked) return ph("ccf") + locked;
  refreshDerived();
  const sel = CCF_RULES[state.selectedCcf];
  const rows = CCF_RULES.map((r, i) => {
    const tests = r.conds && r.conds.length ? ccfCondText(r.conds) : "";
    return "<tr class=\"clickable" + (i === state.selectedCcf ? " selected" : "") + "\" data-ccf=\"" + i + "\">"
      + "<td class=\"mono\">" + esc(r.id) + "</td><td>" + esc(r.type) + "</td>"
      + "<td>" + esc(r.note || r.cond || "一般") + (tests ? "<div class=\"mono\" style=\"color:var(--muted);font-size:11px\">" + esc(tests) + "</div>" : "") + "</td>"
      + "<td class=\"num\"><strong>" + esc(r.ccf) + "</strong></td><td class=\"num\">" + r.pri + "</td></tr>";
  }).join("");
  const msg = state.maintMsg && state.page === "ccf" ? "<div class=\"banner ok\">" + esc(state.maintMsg) + "</div>" : "";
  const editor = sel
    ? ("<aside class=\"side\"><h3>" + esc(sel.id) + "</h3>"
      + "<div class=\"field\"><label>表外类型</label><textarea id=\"ccfEditType\" rows=\"2\">" + esc(sel.type) + "</textarea></div>"
      + "<div class=\"field\"><label>条件</label><input id=\"ccfEditNote\" value=\"" + esc(sel.note || "一般") + "\" />"
      + "<div style=\"font-size:11px;color:var(--muted);margin-top:4px\">一般、短期这种写在条件上。需要用字段判断时，再加下面的判定。</div></div>"
      + ccfCondEditorHtml(sel.conds)
      + "<button type=\"button\" class=\"btn\" style=\"width:100%;margin-bottom:10px\" data-ccf-add-cond=\"1\">＋ 添加判定</button>"
      + "<div class=\"field\"><label>信用转换系数</label><input id=\"ccfEditCcf\" value=\"" + esc(sel.ccf) + "\" /></div>"
      + "<div class=\"field\"><label>优先级</label><input id=\"ccfEditPri\" value=\"" + esc(sel.pri) + "\" /></div>"
      + "<div class=\"field\"><label>这条规则</label><pre style=\"font-size:11px;background:#f4f6f9;padding:8px;border-radius:8px;overflow:auto;max-height:180px;white-space:pre-wrap\">" + esc(prettyJson(ccfRuleDoc(sel))) + "</pre></div>"
      + "<button type=\"button\" class=\"btn btn-primary\" data-maint-save=\"ccf\" data-maint-id=\"" + esc(sel.id) + "\">保存这条 CCF</button>"
      + "<button type=\"button\" class=\"btn\" style=\"width:100%;margin-top:8px\" data-goto=\"engine\" data-set-off=\"1\">用此 CCF 试算 →</button>"
      + "</aside>")
    : "";
  return ph("ccf")
    + msg
    + "<div class=\"banner\">当前维护「资本管理办法 2025」。一行是一种表外类型加一个条件。试算按规则编号取系数，表外等值金额 = 名义金额 × 这条规则的 CCF。</div>"
    + "<div class=\"split\"><div class=\"panel\"><div class=\"panel-head\"><h2>CCF_Rule</h2><span>" + CCF_RULES.length + " 条</span></div>"
    + "<div class=\"table-wrap\"><table class=\"data\"><thead><tr>"
    + "<th>Rule ID</th><th>表外类型</th><th>条件</th><th>CCF</th><th>优先级</th></tr></thead><tbody>"
    + rows + "</tbody></table></div></div>"
    + editor + "</div>";
}
