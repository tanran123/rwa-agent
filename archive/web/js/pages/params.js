/* 规则参数页 */
function pageParams() {
  const locked = configScopeNote("params");
  if (locked) return ph("params") + locked;
  const sel = PARAMS[state.selectedParam];
  const rows = PARAMS.map((p, i) =>
    "<tr class=\"clickable" + (i === state.selectedParam ? " selected" : "") + "\" data-param=\"" + i + "\">"
    + "<td class=\"mono\">" + esc(p.id) + "</td><td>" + esc(p.group) + "</td>"
    + "<td>" + esc(p.name) + "</td><td class=\"num\"><strong>" + esc(p.value) + "</strong></td>"
    + "<td>" + esc(p.unit) + "</td></tr>"
  ).join("");
  const msg = state.maintMsg && state.page === "params" ? "<div class=\"banner ok\">" + esc(state.maintMsg) + "</div>" : "";
  return ph("params", "<div class=\"head-actions\"><button type=\"button\" class=\"btn btn-primary\" data-param-create=\"1\">新增参数</button></div>")
    + (state.paramCreateOpen ? renderParamCreateModal() : "")
    + msg
    + "<div class=\"banner\">当前维护「资本管理办法 2025」。这里只放多条规则共用的门槛。A+、A、B、C 的百分比在风险权重的评级表里改，不在这里再存一份。</div>"
    + "<div class=\"split\">"
    + "<div class=\"panel\"><div class=\"panel-head\"><h2>参数表</h2><span>" + PARAMS.length + " 项</span></div>"
    + "<div class=\"table-wrap\"><table class=\"data\"><thead><tr>"
    + "<th>ID</th><th>分组</th><th>名称</th><th>值</th><th>单位</th></tr></thead><tbody>"
    + rows + "</tbody></table></div></div>"
    + (sel ? ("<aside class=\"side\"><h3>" + esc(sel.id) + "</h3>"
      + "<p style=\"margin:0 0 10px;color:var(--muted);font-size:12px\">" + esc(sel.group) + (sel.unit ? (" · " + sel.unit) : "") + "</p>"
      + "<div class=\"field\"><label>名称</label><input id=\"paramEditName\" value=\"" + esc(sel.name) + "\" /></div>"
      + "<div class=\"field\"><label>当前值</label><input id=\"paramEditValue\" value=\"" + esc(sel.value) + "\" /></div>"
      + "<div class=\"field\"><label>用途</label><textarea id=\"paramEditUsed\" rows=\"4\">" + esc(sel.used || "") + "</textarea></div>"
      + "<button type=\"button\" class=\"btn btn-primary\" data-maint-save=\"param\" data-maint-id=\"" + esc(sel.id) + "\">保存这条参数</button>"
      + "</aside>") : "")
    + "</div>";
}
