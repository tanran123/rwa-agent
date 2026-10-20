/* CRM 缓释页 */
function pageCrm() {
  const locked = configScopeNote("crm");
  if (locked) return ph("crm") + locked;
  refreshDerived();
  const sel = CRM_RULES[state.selectedCrm];
  const rows = CRM_RULES.map((r, i) =>
    "<tr class=\"clickable" + (i === state.selectedCrm ? " selected" : "") + "\" data-crm=\"" + i + "\">"
    + "<td class=\"mono\">" + esc(r.id) + "</td>"
    + "<td><span class=\"tag accent\">" + esc(r.type) + "</span></td>"
    + "<td>" + esc(r.tool) + "</td>"
    + "<td>" + esc(CRM_SUBSTITUTE[r.substitute] || "") + "</td>"
    + "<td>" + esc(crmBlockText(r)) + "</td></tr>"
  ).join("");
  const msg = state.maintMsg && state.page === "crm" ? "<div class=\"banner ok\">" + esc(state.maintMsg) + "</div>" : "";
  const c = (sel && sel.constraints) || {};
  const subOpts = Object.keys(CRM_SUBSTITUTE).map(function (key) {
    return "<option value=\"" + key + "\"" + (sel && sel.substitute === key ? " selected" : "") + ">" + esc(CRM_SUBSTITUTE[key]) + "</option>";
  }).join("");
  const editor = sel
    ? ("<aside class=\"side\"><h3>" + esc(sel.id) + "</h3>"
      + "<div class=\"field\"><label>类型</label><input id=\"crmEditType\" value=\"" + esc(sel.type) + "\" /></div>"
      + "<div class=\"field\"><label>合格工具</label><textarea id=\"crmEditTool\" rows=\"3\">" + esc(sel.tool) + "</textarea></div>"
      + "<div class=\"field\"><label>覆盖部分改用</label><select id=\"crmEditSub\">" + subOpts + "</select></div>"
      + "<label class=\"kb-check\"><input type=\"checkbox\" id=\"crmEditFloor\"" + (sel.floorParam ? " checked" : "") + " /> 质物权重低于底线时抬到 " + esc(paramShown("RW_FLOOR")) + "（特定回购可在试算里豁免）</label>"
      + "<label class=\"kb-check\"><input type=\"checkbox\" id=\"crmEditMaturity\"" + (c.maturity ? " checked" : "") + " /> 期限短于暴露时，这条缓释不计入</label>"
      + "<label class=\"kb-check\"><input type=\"checkbox\" id=\"crmEditCurrency\"" + (c.currency ? " checked" : "") + " /> 币种不一致时，这条缓释不计入</label>"
      + "<label class=\"kb-check\"><input type=\"checkbox\" id=\"crmEditCorr\"" + (c.correlation ? " checked" : "") + " /> 与债务人高度正相关时，这条缓释不计入</label>"
      + "<p style=\"font-size:11px;color:var(--muted)\">质物一般不勾币种，币种错配通常不调整。保证和信用衍生工具勾上币种。</p>"
      + "<div class=\"field\"><label>这条规则</label><pre style=\"font-size:11px;background:#f4f6f9;padding:8px;border-radius:8px;overflow:auto;max-height:180px;white-space:pre-wrap\">" + esc(prettyJson(crmRuleDoc(sel))) + "</pre></div>"
      + "<button type=\"button\" class=\"btn btn-primary\" data-maint-save=\"crm\" data-maint-id=\"" + esc(sel.id) + "\">保存这条缓释</button>"
      + "<button type=\"button\" class=\"btn\" style=\"width:100%;margin-top:8px\" data-goto=\"engine\">交互拆分试算 →</button>"
      + "</aside>")
    : "";
  return ph("crm")
    + msg
    + "<div class=\"banner\">当前维护「资本管理办法 2025」。这里只维护合格工具，以及什么情况下这条缓释不计入。覆盖金额、是否合格、折扣在试算里按笔填。覆盖部分取替代权重，未覆盖部分仍用原暴露权重。</div>"
    + "<div class=\"split\"><div class=\"panel\"><div class=\"panel-head\"><h2>CRM_Rule</h2><span>" + CRM_RULES.length + " 条</span></div>"
    + "<div class=\"table-wrap\"><table class=\"data\"><thead><tr>"
    + "<th>Rule ID</th><th>类型</th><th>合格工具</th><th>覆盖部分取</th><th>不计入</th></tr></thead><tbody>" + rows + "</tbody></table></div></div>"
    + editor + "</div>";
}
