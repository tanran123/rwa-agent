/* 计算页 */
function renderPaperClassifyBody() {
  const rows = paperResultRows();
  const priced = rows.reduce(function (sum, row) { return sum + row.rwa; }, 0);
  return "<div class=\"banner ok\">先看分类。共 " + rows.length + " 档。规则和模型都没定出权重的，直接在表里填百分比。</div>"
    + paperResultTable()
    + "<div class=\"calc-nav\">"
    + "<span></span>"
    + "<span style=\"display:flex;gap:8px\">" + paperDownloadLink()
    + "<button type=\"button\" class=\"btn btn-primary\" data-calc-stage=\"1\">分类完成 · 核对映射 →</button></span>"
    + "</div>"
    + "<p style=\"font-size:12px;color:var(--muted);margin-top:8px\">已计价风险加权资产 " + yi(priced) + "。</p>";
}

function renderCalcStart() {
  return "<div class=\"banner\">先把判定字段对到源表列。计算时会在每一行写入风险暴露类型和 RWA。</div>"
    + "<div class=\"upload-box\" data-upload-pick>"
    + "<strong>上传明细工作簿</strong>"
    + "<span>点击选择 .xlsx / .xlsm。先映射判定字段，再按行计算。</span>"
    + "</div>"
    + "<div class=\"toolbar\" style=\"margin-top:12px\">"
    + "<button type=\"button\" class=\"btn btn-primary\" data-upload-paper>按信用风险底稿计算</button>"
    + "<button type=\"button\" class=\"btn\" data-upload-catalog>用字段清单示例</button>"
    + "<button type=\"button\" class=\"btn\" data-upload-demo>没有文件时，用内置样例</button></div>"
    + (state.mapError ? "<div class=\"banner warn\">" + esc(state.mapError) + "</div>" : "");
}

function renderCalcClassifyBody(calc) {
  if (state.uploadBook && state.uploadBook.basis === "paper" && (state.paperCoverage || []).length) {
    return renderPaperCoverage();
  }
  if (state.mapPhase === "loading") {
    const waitText = state.mapWait === "map"
      ? "正在把这一屏的判定字段发给模型，每一项都要对上列或常量…"
      : (state.mapWait === "ask"
        ? "研判完了，正在看有没有要你确认的数据…"
        : "正在智能研判…");
    return "<div class=\"ai-bar wait\"><span class=\"spin\"></span>" + waitText + "</div>";
  }
  if (state.mapPhase === "clarify") return renderClarifyDialog();
  if (state.mapPhase === "idle") return renderCalcStart();
  seedClassifyFields();
  seedClassifyTags();
  const step = 1;
  const mapOk = state.mapPhase === "confirmed";
  const judgeFields = classifyJudgeFields();
  const pickedFields = judgeFields.filter((f) => state.classifyFieldPick[f.key] !== false);
  const detailRows = uploadDetailRows();
  const tagOpts = classifyResultOptions();
  const showCols = [
    ["A", "合同编号"], ["B", "业务品种"], ["C", "客户类型"], ["D", "评级"],
    ["E", "投资级"], ["F", "余额"], ["G", "减值"], ["N", "五级分类"], ["Q", "备注"]
  ];
  const stepBar = "<div class=\"cls-steps\">"
    + "<button type=\"button\" class=\"cls-step" + (step === 1 ? " active" : (step > 1 ? " done" : "")) + "\" data-cls-step=\"1\">"
    + "<span class=\"n\">" + (step > 1 ? "✓" : "1") + "</span>第一步 · 确认判定字段</button>"
    + "<button type=\"button\" class=\"cls-step" + (step === 2 ? " active" : "") + "\" data-cls-step=\"2\">"
    + "<span class=\"n\">2</span>第二步 · 给每行明细打标</button>"
    + "</div>";
  const tagSelect = (rowId, cur) => {
    const opts = tagOpts.slice();
    if (cur && !opts.some(function (o) { return classifyTagKey(o) === cur; })) {
      const parts = String(cur).split("||");
      opts.unshift({ category: parts[0] || "未归类", subclass: parts[1] || parts[0] || "未归类" });
    }
    return "<select data-cls-tag=\"" + esc(rowId) + "\" style=\"min-width:168px\">"
    + opts.map((o) => {
      const k = classifyTagKey(o);
      return "<option value=\"" + esc(k) + "\"" + (k === cur ? " selected" : "") + ">"
        + esc(o.category + " · " + o.subclass) + "</option>";
    }).join("")
    + "</select>";
  };

  if (step === 1) {
    const missing = pickedFields.filter(function (field) { return !field.assign; });
    const fieldRows = judgeFields.map((f) => {
      const picked = state.classifyFieldPick[f.key] !== false;
      const isConst = f.kind === "const";
      const reason = state.mapReasons[f.id] || "";
      const valueCell = isConst
        ? "<input data-cls-const=\"" + esc(f.id) + "\" value=\"" + esc(f.value === "—" ? "" : f.value)
          + "\" placeholder=\"常量取值\" style=\"width:100%;min-width:100px;border:1px solid var(--border);border-radius:8px;padding:5px 8px;font-size:12px\" />"
        : esc(f.value);
      return "<tr" + (picked ? "" : " style=\"opacity:.55\"") + ">"
        + "<td><input type=\"checkbox\" data-cls-field=\"" + esc(f.key) + "\"" + (picked ? " checked" : "") + " /></td>"
        + "<td><strong>" + esc(f.field) + "</strong>"
        + "<div class=\"mono\" style=\"color:var(--muted);font-size:11px\">" + esc(f.key) + "</div>"
        + (reason ? "<div style=\"font-size:11px;color:var(--muted);margin-top:4px\">" + esc(reason) + "</div>" : "")
        + "</td>"
        + "<td>" + valueCell + "</td>"
        + "<td><select data-cls-src=\"" + esc(f.id) + "\" style=\"min-width:160px;font-size:12px;padding:5px 8px;border:1px solid var(--border);border-radius:8px;background:#fff\">"
        + excelSourceOptions(f.id, f.assign) + "</select></td>"
        + "<td style=\"font-size:12px;color:var(--muted)\">" + esc(f.role) + "</td>"
        + "</tr>";
    }).join("");
    return (missing.length
        ? "<div class=\"banner warn\">还有 " + missing.length + " 个选用字段没有来源。点「发给模型映射」，每一项都会对上列，对不上的填成常量。</div>"
        : "<div class=\"banner ok\">判定字段都已有来源。列来自「" + esc(currentUpload().file)
          + "」。确认后开始计算，风险暴露类型和 RWA 会写在每一行上。</div>")
      + (state.mapError ? "<div class=\"banner warn\">" + esc(state.mapError) + "</div>" : "")
      + (state.mapExtract ? "<div class=\"banner\">" + esc(state.mapExtract) + "</div>" : "")
      + "<div class=\"panel\"><div class=\"panel-head\"><h2>判定字段</h2>"
      + "<span>已选 " + pickedFields.length + " / " + judgeFields.length
      + " · 已映射 " + (pickedFields.length - missing.length) + " / " + pickedFields.length
      + " · 工作表 " + esc(currentUpload().sheet) + "</span></div>"
      + "<div class=\"table-wrap\" style=\"max-height:420px\"><table class=\"data\"><thead><tr>"
      + "<th style=\"width:44px\">选用</th><th>字段</th><th>取值示意</th><th>来源（Excel 列）</th><th>作用</th>"
      + "</tr></thead><tbody>" + fieldRows + "</tbody></table></div></div>"
      + "<div class=\"calc-nav\">"
      + "<button type=\"button\" class=\"btn\" data-cls-remap" + (state.mapPhase === "loading" ? " disabled" : "") + ">发给模型映射</button>"
      + "<button type=\"button\" class=\"btn\" data-cls-fields-all>全选字段</button>"
      + "<button type=\"button\" class=\"btn btn-primary\" data-calc-stage=\"1\""
      + (pickedFields.length === 0 || missing.length ? " disabled" : "") + ">映射完成 · 开始计算 →</button>"
      + "</div>";
  }

  const fieldChips = pickedFields.map((f) =>
    "<span class=\"tag muted\" style=\"margin:2px 4px 2px 0\">" + esc(f.field) + "</span>"
  ).join("");
  const bodyRows = detailRows.map((row) => {
    const picked = state.classifyPick[row.id] !== false;
    const tag = state.classifyTags[row.id] || suggestRowClassifyTag(row);
    return "<tr" + (picked ? "" : " style=\"opacity:.5\"") + ">"
      + "<td><input type=\"checkbox\" data-cls-pick=\"" + esc(row.id) + "\"" + (picked ? " checked" : "") + " /></td>"
      + showCols.map((c) => "<td>" + esc(row[c[0]] == null ? "—" : row[c[0]]) + "</td>").join("")
      + "<td class=\"cls-tag-cell\">" + tagSelect(row.id, tag) + "</td>"
      + "</tr>";
  }).join("");
  const summary = {};
  detailRows.filter((row) => state.classifyPick[row.id] !== false).forEach((row) => {
    const tag = state.classifyTags[row.id] || suggestRowClassifyTag(row);
    summary[tag] = (summary[tag] || 0) + 1;
  });
  const summaryChips = Object.keys(summary).map((k) =>
    "<span class=\"tag accent\" style=\"margin:3px 6px 3px 0\">" + esc(classifyTagLabel(k))
    + " · " + summary[k] + " 笔</span>"
  ).join("");
  return stepBar
    + "<div class=\"banner ok\">第二步：基于已确认的判定字段，给上传的每一行业务明细打暴露分类标签（可手动改）。</div>"
    + "<div class=\"panel\" style=\"margin-bottom:12px\"><div class=\"panel-head\"><h2>已确认判定字段</h2>"
    + "<span>" + pickedFields.length + " 个</span></div>"
    + "<div style=\"padding:12px 16px\">" + (fieldChips || "<span class=\"opt\">未选字段</span>")
    + " <button type=\"button\" class=\"btn\" style=\"margin-left:8px\" data-cls-step=\"1\">改字段</button></div></div>"
    + "<div class=\"panel\" style=\"margin-bottom:12px\"><div class=\"panel-head\"><h2>标签汇总</h2>"
    + "<span>" + esc(state.mapFile || currentUpload().file) + " · " + detailRows.length + " 行</span></div>"
    + "<div style=\"padding:12px 16px\">" + (summaryChips || "<span class=\"opt\">尚未打标</span>") + "</div></div>"
    + "<div class=\"panel\"><div class=\"panel-head\"><h2>上传明细 · 打标</h2>"
    + "<span>" + esc(currentUpload().sheet) + "</span></div>"
    + "<div class=\"table-wrap\" style=\"max-height:380px\"><table class=\"data\"><thead><tr>"
    + "<th style=\"width:44px\">选用</th>"
    + showCols.map((c) => "<th>" + esc(c[1]) + "</th>").join("")
    + "<th>分类标签（可调）</th>"
    + "</tr></thead><tbody>" + bodyRows + "</tbody></table></div></div>"
    + "<div class=\"calc-nav\">"
    + "<button type=\"button\" class=\"btn\" data-cls-step=\"1\">← 回确认字段</button>"
    + "<button type=\"button\" class=\"btn\" data-cls-autotag>按建议一键打标</button>"
    + "<button type=\"button\" class=\"btn btn-primary\" data-calc-stage=\"1\">打标完成 · 核对映射 →</button>"
    + "</div>";
}

function renderCalcLegCard(leg, idx, legResult) {
  const active = idx === state.selectedLeg;
  const r = legResult || calcOneLeg(leg);
  const cls = r.classify || effectiveClassify(leg);
  const crmOpts = CRM_RULES.map(function (rule) {
    return "<option value=\"" + esc(rule.id) + "\">" + esc(rule.id + " · " + rule.type) + "</option>";
  }).join("");
  const apps = (leg.crmApps || []).map(function (app, k) {
    const rule = CRM_RULES.find(function (item) { return item.id === app.ruleId; }) || CRM_RULES[0];
    const seg = (r.segs || []).find(function (s) { return s.appIndex === k; }) || {};
    return "<div style=\"border:1px solid var(--border);border-radius:10px;padding:10px 12px;margin:0 14px 8px\">"
      + "<div class=\"toolbar\" style=\"margin:0\">"
      + "<div class=\"field\"><label>缓释规则</label><select data-crm-field=\"ruleId\" data-leg=\"" + idx + "\" data-crm-i=\"" + k + "\">"
      + crmOpts.replace("value=\"" + esc(app.ruleId) + "\"", "value=\"" + esc(app.ruleId) + "\" selected")
      + "</select></div>"
      + "<div class=\"field\"><label>覆盖金额（亿）</label><input class=\"num-in\" data-crm-field=\"coverageYi\" data-leg=\"" + idx + "\" data-crm-i=\"" + k + "\" type=\"number\" step=\"1\" value=\"" + (app.coverageYi || 0) + "\" /></div>"
      + "<div class=\"field\"><label>替代权重规则</label><select data-crm-field=\"rwRuleId\" data-leg=\"" + idx + "\" data-crm-i=\"" + k + "\">" + constWeightOptions(app.rwRuleId) + "</select></div>"
      + "<div class=\"field\"><label>折扣（0–1）</label><input class=\"num-in\" data-crm-field=\"haircut\" data-leg=\"" + idx + "\" data-crm-i=\"" + k + "\" type=\"number\" step=\"0.01\" min=\"0\" max=\"1\" value=\"" + (app.haircut || 0) + "\" /></div>"
      + "<button type=\"button\" class=\"btn\" data-crm-remove=\"" + idx + "\" data-crm-i=\"" + k + "\">去掉</button>"
      + "</div>"
      + "<div style=\"display:flex;flex-wrap:wrap;gap:10px;font-size:12px;margin-top:6px\">"
      + "<label><input type=\"checkbox\" data-crm-field=\"eligible\" data-leg=\"" + idx + "\" data-crm-i=\"" + k + "\"" + (app.eligible ? " checked" : "") + " /> 合格</label>"
      + "<label><input type=\"checkbox\" data-crm-field=\"maturityMatch\" data-leg=\"" + idx + "\" data-crm-i=\"" + k + "\"" + (app.maturityMatch ? " checked" : "") + " /> 期限匹配</label>"
      + "<label><input type=\"checkbox\" data-crm-field=\"currencyMatch\" data-leg=\"" + idx + "\" data-crm-i=\"" + k + "\"" + (app.currencyMatch ? " checked" : "") + " /> 币种匹配</label>"
      + (rule.floorParam ? "<label><input type=\"checkbox\" data-crm-field=\"floorExempt\" data-leg=\"" + idx + "\" data-crm-i=\"" + k + "\"" + (app.floorExempt ? " checked" : "") + " /> 特定回购豁免底线</label>" : "")
      + (rule.constraints && rule.constraints.correlation ? "<label><input type=\"checkbox\" data-crm-field=\"correlated\" data-leg=\"" + idx + "\" data-crm-i=\"" + k + "\"" + (app.correlated ? " checked" : "") + " /> 与债务人高度正相关</label>" : "")
      + "</div>"
      + "<div style=\"font-size:12px;color:var(--muted);margin-top:6px\">" + esc(seg.note || "") + "</div>"
      + "</div>";
  }).join("");
  const pipes = (r.segs || []).filter(function (s) { return s.amount > 0; }).map(function (s) {
    return "<div style=\"font-size:12px;color:var(--muted)\">" + esc(s.name) + " " + yi(s.amount) + " × " + pct(s.rw) + " · " + esc(s.rule) + "</div>";
  }).join("");
  return "<div class=\"calc-leg" + (active ? " active" : "") + "\" data-leg-sel=\"" + idx + "\">"
    + "<div class=\"calc-leg-head\">"
    + "<span class=\"tag " + (leg.offbalance ? "warn" : "accent") + "\">" + (leg.offbalance ? "表外" : "表内") + "</span>"
    + "<span class=\"tag " + (cls.manual ? "warn" : "ok") + "\">" + esc(cls.category) + " · " + esc(cls.subclass)
    + (cls.rwHint ? (" · " + esc(cls.rwHint)) : "")
    + (cls.manual ? " · 手调" : "") + "</span>"
    + "<input style=\"min-width:168px;border:1px solid var(--border);border-radius:8px;padding:6px 10px;font-size:13px\" data-leg-field=\"name\" data-leg=\"" + idx + "\" value=\"" + esc(leg.name || "") + "\" />"
    + "<span class=\"spacer\"></span>"
    + "<span style=\"font-size:12px;color:var(--muted)\">EAD <b style=\"color:var(--text)\">" + yi(r.ead) + "</b> · RWA <b style=\"color:var(--text)\">" + yi(r.rwa) + "</b></span>"
    + "<button type=\"button\" class=\"btn\" data-leg-remove=\"" + idx + "\"" + (state.calcLegs.length <= 1 ? " disabled" : "") + ">删除</button>"
    + "</div>"
    + "<div class=\"toolbar\">"
    + "<div class=\"field\"><label>表内/表外</label><select data-leg-field=\"offbalance\" data-leg=\"" + idx + "\">"
    + "<option value=\"0\"" + (!leg.offbalance ? " selected" : "") + ">表内资产</option>"
    + "<option value=\"1\"" + (leg.offbalance ? " selected" : "") + ">表外（乘 CCF 规则）</option></select></div>"
    + (leg.offbalance
      ? "<div class=\"field\"><label>名义金额（亿）</label><input class=\"num-in\" data-leg-field=\"nominalYi\" data-leg=\"" + idx + "\" type=\"number\" step=\"1\" value=\"" + leg.nominalYi + "\" /></div>"
        + "<div class=\"field\"><label>CCF 规则</label><select data-leg-field=\"ccfRuleId\" data-leg=\"" + idx + "\">"
        + CCF_RULES.map(function (rule) {
          return "<option value=\"" + esc(rule.id) + "\"" + (leg.ccfRuleId === rule.id ? " selected" : "") + ">" + esc(rule.id + " · " + rule.ccf) + "</option>";
        }).join("")
        + "</select></div>"
      : "<div class=\"field\"><label>账面余额（亿）</label><input class=\"num-in\" data-leg-field=\"balanceYi\" data-leg=\"" + idx + "\" type=\"number\" step=\"1\" value=\"" + leg.balanceYi + "\" /></div>"
        + "<div class=\"field\"><label>减值准备（亿）</label><input class=\"num-in\" data-leg-field=\"impairmentYi\" data-leg=\"" + idx + "\" type=\"number\" step=\"1\" value=\"" + leg.impairmentYi + "\" /></div>")
    + (leg.fromPaper || (cls && typeof cls.rwRate === "number") ? ""
      : "<div class=\"field\"><label>手填权重（%）</label><input class=\"num-in\" data-hand-rw=\"" + idx + "\" type=\"number\" min=\"0\" max=\"1250\" step=\"0.01\" placeholder=\"如 100\" value=\"" + (typeof leg.handRw === "number" ? weightPoints(leg.handRw) : "") + "\" /></div>")
    + "<div class=\"field\"><label>原风险暴露权重</label><select data-leg-field=\"originalRwRuleId\" data-leg=\"" + idx + "\">"
    + (weightRateById(leg.originalRwRuleId) == null
      ? "<option value=\"" + esc(leg.originalRwRuleId || "") + "\" selected>决策树 · " + esc((cls.subclass || "本笔") + (cls.rwHint ? " " + cls.rwHint : "")) + "</option>"
      : "")
    + constWeightOptions(leg.originalRwRuleId) + "</select></div>"
    + "</div>"
    + "<div style=\"font-size:12px;color:var(--muted);padding:0 14px 8px\">" + esc((cls.path || []).join(" → "))
    + "。" + esc(r.eadNote || "") + "。未覆盖部分用决策树权重，树没定死时才用上面的权重表。</div>"
    + apps
    + "<div style=\"padding:0 14px 8px\"><button type=\"button\" class=\"btn\" data-crm-add=\"" + idx + "\">＋ 加一条缓释</button></div>"
    + (r.over ? "<div class=\"banner warn\" style=\"margin:0 14px 10px\">本笔缓释超过 EAD，已截断。</div>" : "")
    + "<div class=\"calc-leg-sum\">"
    + "<span>" + esc(r.eadNote || "") + " → EAD <b>" + yi(r.ead) + "</b></span>"
    + "<span>公式 <b>" + esc(r.formula) + "</b></span>"
    + pipes
    + "</div></div>";
}

function renderPaperRunBody(calc) {
  return "<div class=\"banner ok\">" + esc((state.uploadBook && state.uploadBook.paperNote) || "数字来自信用风险底稿。") + "</div>"
    + "<div class=\"metric-row\">"
    + "<div class=\"metric\"><label>合计 EAD</label><strong>" + yi(calc.ead) + "</strong><small>" + (calc.legs || []).length + " 档</small></div>"
    + "<div class=\"metric\"><label>合计 RWA</label><strong>" + yi(calc.rwa) + "</strong><small>权重未定的不计入</small></div>"
    + "<div class=\"metric\"><label>资本（8%）</label><strong>" + yi(calc.rwa * 0.08) + "</strong><small>示意</small></div>"
    + "</div>"
    + paperResultTable()
    + "<div class=\"calc-nav\">"
    + "<button type=\"button\" class=\"btn\" data-calc-stage=\"0\">← 回映射</button>"
    + "<span style=\"display:flex;gap:8px\">" + paperDownloadLink()
    + "<button type=\"button\" class=\"btn btn-primary\" data-calc-stage=\"2\">查看结果追溯 →</button></span>"
    + "</div>";
}

function renderCalcRunBody(calc) {
  if (state.uploadBook && state.uploadBook.basis === "paper" && paperResultRows().length) {
    return renderPaperRunBody(calc);
  }
  const ead = calc.ead;
  const bar = calc.segs.map((seg, i) => {
    const colors = ["#1a5f4a", "#2f8f6e", "#0f766e", "#b45309", "#94a3b8", "#64748b"];
    const w = ead > 0 ? (seg.amount / ead * 100) : 0;
    return "<span style=\"width:" + Math.max(w, seg.amount > 0 ? 2 : 0) + "%;background:" + colors[i % colors.length] + "\">"
      + (w > 14 ? esc(seg.name) : "") + "</span>";
  }).join("");
  const segRows = calc.segs.map((seg) =>
    "<tr><td>" + esc(seg.name) + "</td>"
    + "<td class=\"num\">" + yi(seg.amount) + "</td>"
    + "<td class=\"num\">" + pct(seg.rw) + "</td>"
    + "<td class=\"num\"><strong>" + yi(seg.rwa) + "</strong></td>"
    + "<td class=\"mono\">" + esc(seg.rule) + "</td></tr>"
  ).join("");
  const mapOk = state.mapPhase === "confirmed";
  const legCards = (calc.legs || []).map((r, i) => renderCalcLegCard(r.leg, i, r)).join("");
  const catalog = state.uploadBook && state.uploadBook.basis === "catalog";
  const paper = state.uploadBook && state.uploadBook.basis === "paper";
  return (paper
      ? "<div class=\"banner ok\">" + esc(state.uploadBook.paperNote || "数字来自信用风险底稿。") + "</div>"
      : catalog
      ? "<div class=\"banner ok\">这批明细的列来自《信用风险RWA-产品字段清单》。金额是清单里的澳门元，这里折成亿元，再按权重法决策树计算 RWA。</div>"
      : mapOk
      ? "<div class=\"banner ok\">映射已确认（" + esc(PRODUCTS[state.product].label) + "）· 监管版本 "
        + esc(state.selectedVersion) + "。每笔卡片上的标签来自上一步分类判断。</div>"
      : "<div class=\"banner warn\">尚未核对映射。可先用文档示例试算，或回上一步核对该模型的字段。</div>")
    + "<div class=\"head-actions\" style=\"margin-bottom:12px\">"
    + (paper ? "<button type=\"button\" class=\"btn btn-primary\" data-calc-download>下载计算结果</button>" : "")
    + "<button type=\"button\" class=\"btn\" data-leg-add=\"on\">＋ 添加表内</button>"
    + "<button type=\"button\" class=\"btn\" data-leg-add=\"off\">＋ 添加表外</button>"
    + "<button type=\"button\" class=\"btn\" data-reset-demo>恢复文档示例</button>"
    + "</div>"
    + "<div class=\"calc-legs\">" + legCards + "</div>"
    + "<div class=\"metric-row\">"
    + "<div class=\"metric\"><label>合计 EAD</label><strong>" + yi(calc.ead) + "</strong>"
    + "<small>表内 " + calc.onCount + " 笔 · 表外 " + calc.offCount + " 笔</small></div>"
    + "<div class=\"metric\"><label>合计 RWA</label><strong>" + yi(calc.rwa) + "</strong><small>" + esc(state.selectedVersion) + "</small></div>"
    + "<div class=\"metric\"><label>资本（8%）</label><strong>" + yi(calc.rwa * 0.08) + "</strong><small>示意</small></div>"
    + "<div class=\"metric\"><label>缓释节省</label><strong>" + yi(Math.max(0, (calc.fullUncovered || 0) - calc.rwa)) + "</strong><small>相对全额未缓释</small></div>"
    + "</div>"
    + "<div class=\"panel\"><div class=\"panel-head\"><h2>合计 CRM 拆分</h2><span>多笔汇总</span></div>"
    + "<div style=\"padding:16px 18px\">"
    + "<div class=\"split-bar\">" + bar + "</div>"
    + "<div class=\"table-wrap\" style=\"max-height:none\"><table class=\"data\"><thead><tr>"
    + "<th>部分</th><th>暴露</th><th>RW</th><th>RWA</th><th>规则</th></tr></thead><tbody>"
    + segRows
    + "<tr style=\"font-weight:650\"><td>合计</td><td class=\"num\">" + yi(calc.ead) + "</td><td></td>"
    + "<td class=\"num\">" + yi(calc.rwa) + "</td><td></td></tr></tbody></table></div>"
    + "<div class=\"formula-box\">" + esc(calc.formula) + "</div></div></div>"
    + "<div class=\"calc-nav\">"
    + "<button type=\"button\" class=\"btn\" data-calc-stage=\"0\">← 回映射</button>"
    + "<span style=\"display:flex;gap:8px\">"
    + "<button type=\"button\" class=\"btn btn-primary\" data-calc-download>下载计算结果</button>"
    + "<button type=\"button\" class=\"btn\" data-calc-stage=\"2\">查看结果追溯 →</button>"
    + "</span></div>";
}

function renderStepTable(steps) {
  const body = (steps || []).map(function (step) {
    const hit = step.hit === true ? "命中" : (step.hit === false ? "未命中" : "");
    return "<tr><td class=\"num\">" + esc(step.seq) + "</td><td>" + esc(step.stage) + "</td><td>" + esc(step.title) + "</td>"
      + "<td class=\"mono\">" + esc(step.field || "") + "</td>"
      + "<td>" + esc(step.actual || "") + "</td>"
      + "<td>" + esc((step.op || "") + (step.expected ? " " + step.expected : "")) + "</td>"
      + "<td>" + esc(hit) + "</td>"
      + "<td>" + esc(step.result || "") + "</td>"
      + "<td>" + esc(step.note || "") + "</td></tr>";
  }).join("");
  return "<div class=\"table-wrap\"><table class=\"data\"><thead><tr>"
    + "<th>序号</th><th>阶段</th><th>步骤</th><th>字段</th><th>实际值</th><th>规则</th><th>命中</th><th>结果</th><th>说明</th>"
    + "</tr></thead><tbody>" + body + "</tbody></table></div>";
}

function renderTracePanels(rows) {
  const shown = rows.slice(0, 40);
  const panels = shown.map(function (row) {
    const where = [row.sheet, row.excel_row != null && row.excel_row !== "" ? ("第 " + row.excel_row + " 行") : ""].filter(Boolean).join(" · ");
    const steps = row.steps || [];
    return "<div class=\"panel\" style=\"margin-top:12px\"><div class=\"panel-head\"><h2>" + esc(row.name || "未命名") + "</h2><span>" + esc(where || row.exposure || "") + "</span></div>"
      + (steps.length
        ? renderStepTable(steps)
        : "<div style=\"padding:14px 18px;color:var(--muted)\">这一行还没有分步记录。" + (row.trace ? esc(row.trace) : "") + "</div>")
      + "</div>";
  }).join("");
  const more = rows.length > shown.length
    ? "<div class=\"banner\">页面列出前 " + shown.length + " 行。全部 " + rows.length + " 行的步骤在下载工作簿的「计算留痕」表，也写在 data/traces 的 JSON 里。</div>"
    : "";
  return more + panels;
}

function renderPaperTraceBody(calc) {
  const rows = (state.paperRows || []).map(function (row) {
    return {
      name: row.name, sheet: row.sheet, excel_row: row.excel_row,
      exposure: row.exposure, trace: row.trace, steps: row.steps || []
    };
  });
  return "<div class=\"metric-row\">"
    + "<div class=\"metric\"><label>敞口</label><strong>" + yi(calc.ead) + "</strong></div>"
    + "<div class=\"metric\"><label>风险加权资产</label><strong>" + yi(calc.rwa) + "</strong></div>"
    + "<div class=\"metric\"><label>监管版本</label><strong style=\"font-size:15px\">" + esc(state.selectedVersion) + "</strong></div>"
    + "</div>"
    + "<div class=\"banner ok\">每一行按取值、分类条件、权重、敞口、风险加权资产留下步骤。下载的工作簿有「计算留痕」表，同一份也存在 data/traces。</div>"
    + renderTracePanels(rows)
    + "<div class=\"calc-nav\">"
    + "<button type=\"button\" class=\"btn\" data-calc-stage=\"1\">← 回计算</button>"
    + "<span style=\"display:flex;gap:8px\">"
    + "<button type=\"button\" class=\"btn\" data-calc-stage=\"0\">回映射</button>"
    + paperDownloadLink()
    + "</span></div>";
}

function renderCalcTraceBody(calc) {
  if (state.uploadBook && state.uploadBook.basis === "paper" && (state.paperRows || []).length) {
    return renderPaperTraceBody(calc);
  }
  const traced = (calc.legs || []).filter(function (item) { return (item.steps || []).length; });
  if (traced.length) {
    const rows = traced.map(function (item) {
      const leg = item.leg || {};
      const cls = item.classify || {};
      return {
        name: leg.name,
        sheet: leg.sourceSheet || "",
        excel_row: leg.sourceRow,
        exposure: (cls.category ? cls.category + " · " : "") + (cls.subclass || ""),
        steps: item.steps
      };
    });
    return "<div class=\"metric-row\">"
      + "<div class=\"metric\"><label>敞口</label><strong>" + yi(calc.ead) + "</strong></div>"
      + "<div class=\"metric\"><label>风险加权资产</label><strong>" + yi(calc.rwa) + "</strong></div>"
      + "<div class=\"metric\"><label>监管版本</label><strong style=\"font-size:15px\">" + esc(state.selectedVersion) + "</strong></div>"
      + "</div>"
      + "<div class=\"banner ok\">每一行按取值、分类条件、权重、敞口、风险加权资产留下步骤。下载的工作簿有「计算留痕」表，同一份也存在 data/traces。</div>"
      + renderTracePanels(rows)
      + "<div class=\"calc-nav\">"
      + "<button type=\"button\" class=\"btn\" data-calc-stage=\"1\">← 回计算</button>"
      + "<button type=\"button\" class=\"btn\" data-calc-stage=\"0\">回映射</button>"
      + "<button type=\"button\" class=\"btn btn-primary\" data-calc-download>下载计算结果</button>"
      + "</div>";
  }
  const firstCls = (calc.legs && calc.legs[0] && calc.legs[0].classify) || null;
  const clsSummary = (calc.legs || []).map((r) => {
    const c = r.classify || classifyLeg(r.leg);
    return (r.leg.name || "暴露") + " → " + c.category + "/" + c.subclass + "（" + c.ruleId + "）";
  }).join("；");
  const dynamicSteps = ENGINE_STEPS.map((s) => {
    if (s.title === "分类判断" && firstCls) {
      return { title: s.title, detail: clsSummary || s.detail };
    }
    return s;
  });
  const portRows = PORTFOLIO.map((t, i) =>
    "<tr class=\"clickable" + (i === state.selectedTrade ? " selected" : "") + "\" data-trade=\"" + i + "\">"
    + "<td class=\"mono\">" + esc(t.id) + "</td><td>" + esc(t.product) + "</td><td>" + esc(t.cls) + "</td>"
    + "<td class=\"num\">" + t.ead + "</td><td class=\"num\">" + esc(t.rw) + "</td>"
    + "<td class=\"num\"><strong>" + t.rwa + "</strong></td><td style=\"color:var(--muted)\">" + esc(t.note) + "</td></tr>"
  ).join("");
  const portRwa = PORTFOLIO.reduce((s, t) => s + t.rwa, 0);
  const hitRules = [];
  (calc.legs || []).forEach(function (r) {
    if (r.classify && r.classify.ruleId) hitRules.push(r.classify.ruleId);
    if (r.offbalance && r.ccfRuleId) hitRules.push(r.ccfRuleId);
    (r.segs || []).forEach(function (s) { if (s.rule) hitRules.push(s.rule); });
  });
  const uniqHits = Array.from(new Set(hitRules));
  return "<div class=\"metric-row\">"
    + "<div class=\"metric\"><label>本笔 EAD</label><strong>" + yi(calc.ead) + "</strong></div>"
    + "<div class=\"metric\"><label>本笔 RWA</label><strong>" + yi(calc.rwa) + "</strong></div>"
    + "<div class=\"metric\"><label>监管版本</label><strong style=\"font-size:15px\">" + esc(state.selectedVersion) + "</strong></div>"
    + "</div>"
    + "<div class=\"panel\"><div class=\"panel-head\"><h2>规则链追溯</h2><span>从映射 → 计算 → RWA</span></div>"
    + "<div style=\"padding:16px 18px\">"
    + "<div class=\"trace\">"
    + dynamicSteps.map((s, i) =>
      "<div class=\"trace-item\"><strong>" + (i + 1) + ". " + esc(s.title) + "</strong><span>" + esc(s.detail) + "</span></div>"
    ).join("")
    + "</div>"
    + "<div class=\"banner ok\" style=\"margin-top:8px\">命中规则 <span class=\"mono\">" + esc(uniqHits.join(" · ")) + "</span>"
    + " · 公式 " + esc(calc.formula) + "</div>"
    + "</div></div>"
    + "<div class=\"panel\"><div class=\"panel-head\"><h2>组合样例（多产品）</h2>"
    + "<span>合计 RWA " + portRwa.toFixed(1) + " 亿</span></div>"
    + "<div class=\"table-wrap\" style=\"max-height:280px\"><table class=\"data\"><thead><tr>"
    + "<th>交易</th><th>产品</th><th>分类判断</th><th>EAD(亿)</th><th>RW</th><th>RWA(亿)</th><th>说明</th>"
    + "</tr></thead><tbody>" + portRows + "</tbody></table></div></div>"
    + "<div class=\"calc-nav\">"
    + "<button type=\"button\" class=\"btn\" data-calc-stage=\"1\">← 回计算</button>"
    + "<button type=\"button\" class=\"btn\" data-calc-stage=\"0\">回映射</button>"
    + "<button type=\"button\" class=\"btn btn-primary\" data-calc-download>下载计算结果</button>"
    + "</div>";
}

function renderSourceCalc(calc) {
  if (state.uploadBook && state.uploadBook.basis === "paper" && (state.paperRows || []).length) {
    return renderPaperSourceCalc();
  }
  const book = state.uploadBook;
  if (book && book.basis !== "paper" && (book.rows || []).length && (calc.legs || []).length) {
    return renderUploadSourceCalc(calc);
  }
  return renderCalcRunBody(calc);
}

function renderPaperSourceCalc() {
  const rows = state.paperRows || [];
  let ead = 0;
  let rwa = 0;
  let openCount = 0;
  rows.forEach(function (row) {
    const amount = (Number(row.ead) || 0) / 100000000;
    ead += amount;
    if (typeof row.weight === "number") rwa += amount * row.weight;
    else openCount += 1;
  });
  const shown = rows.slice(0, 400);
  const body = shown.map(function (row, index) {
    const amount = (Number(row.ead) || 0) / 100000000;
    const weightCell = row.open
      ? "<input class=\"num-in\" data-src-rw=\"" + index + "\" type=\"number\" min=\"0\" max=\"1250\" step=\"0.01\" placeholder=\"手填%\" value=\""
        + esc(typeof row.weight === "number" ? weightPoints(row.weight) : "") + "\" style=\"width:88px\" />"
      : esc(row.weight_text || "");
    const rwaCell = typeof row.weight === "number" ? yi(amount * row.weight) : "待手填";
    return "<tr><td>" + esc(row.sheet || "") + "</td>"
      + "<td class=\"num\">" + esc(row.excel_row == null ? "—" : row.excel_row) + "</td>"
      + "<td>" + esc(row.name || "—") + "</td>"
      + "<td>" + esc(row.exposure || "") + "</td>"
      + "<td>" + weightCell + "</td>"
      + "<td class=\"num\">" + yi(amount) + "</td>"
      + "<td class=\"num\"><strong>" + rwaCell + "</strong></td></tr>";
  }).join("");
  return (openCount
      ? "<div class=\"banner warn\">还有 " + openCount + " 行没有权重。在权重列填百分比，例如 75 表示 75%，这一行的 RWA 会马上重算。</div>"
      : "<div class=\"banner ok\">" + esc((state.uploadBook && state.uploadBook.paperNote) || "计算已经写到源表每一行。") + "</div>")
    + "<div class=\"metric-row\">"
    + "<div class=\"metric\"><label>合计敞口</label><strong>" + yi(ead) + "</strong><small>" + rows.length + " 行</small></div>"
    + "<div class=\"metric\"><label>合计 RWA</label><strong>" + yi(rwa) + "</strong><small>权重未定的不计入</small></div>"
    + "<div class=\"metric\"><label>资本（8%）</label><strong>" + yi(rwa * 0.08) + "</strong><small>示意</small></div>"
    + "</div>"
    + "<div class=\"panel\"><div class=\"panel-head\"><h2>源表明细</h2><span>"
    + (rows.length > shown.length ? ("页面显示前 " + shown.length + " 行，下载包含全部 " + rows.length + " 行") : (rows.length + " 行"))
    + "</span></div>"
    + "<div class=\"table-wrap\" style=\"max-height:560px\"><table class=\"data\"><thead><tr>"
    + "<th>来源表</th><th>行</th><th>名称</th><th>风险暴露类型</th><th>权重</th><th>敞口</th><th>风险加权资产</th>"
    + "</tr></thead><tbody>" + body + "</tbody></table></div></div>"
    + "<div class=\"calc-nav\">"
    + "<button type=\"button\" class=\"btn\" data-calc-stage=\"0\">← 回映射</button>"
    + "<span style=\"display:flex;gap:8px\">" + paperDownloadLink()
    + "<button type=\"button\" class=\"btn\" data-calc-stage=\"2\">查看结果追溯 →</button></span>"
    + "</div>";
}

function renderUploadSourceCalc(calc) {
  if (state.openWeightWait) {
    return "<div class=\"ai-bar wait\"><span class=\"spin\"></span>规则停在没有固定权重的档。正在按分类规则让模型补上资本档次，再算出权重…</div>";
  }
  const items = calc.legs || [];
  const body = items.map(function (item, index) {
    const leg = item.leg || {};
    const cls = item.classify || {};
    const open = typeof cls.rwRate !== "number" && typeof leg.handRw !== "number";
    const weightCell = open
      ? "<input class=\"num-in\" data-hand-rw=\"" + index + "\" type=\"number\" min=\"0\" max=\"1250\" step=\"0.01\" placeholder=\"手填%\" style=\"width:88px\" />"
      : esc(cls.rwHint || "");
    const rwaCell = item.openWeight ? "待手填" : yi(item.rwa);
    return "<tr><td>" + esc(leg.name || ("第 " + (index + 1) + " 行")) + "</td>"
      + "<td>" + esc((cls.category ? cls.category + " · " : "") + (cls.subclass || "")) + "</td>"
      + "<td>" + weightCell + "</td>"
      + "<td class=\"num\">" + yi(item.ead) + "</td>"
      + "<td class=\"num\"><strong>" + rwaCell + "</strong></td></tr>";
  }).join("");
  return "<div class=\"banner ok\">映射已经用在每一行上。风险暴露类型和 RWA 写在源表行旁边。</div>"
    + (state.openWeightNote ? "<div class=\"banner\">" + esc(state.openWeightNote) + "</div>" : "")
    + "<div class=\"metric-row\">"
    + "<div class=\"metric\"><label>合计敞口</label><strong>" + yi(calc.ead) + "</strong><small>" + items.length + " 行</small></div>"
    + "<div class=\"metric\"><label>合计 RWA</label><strong>" + (calc.openCount && !calc.rwa ? "待手填" : yi(calc.rwa)) + "</strong><small>" + (calc.openCount ? (calc.openCount + " 行待手填") : esc(state.selectedVersion)) + "</small></div>"
    + "</div>"
    + "<div class=\"panel\"><div class=\"panel-head\"><h2>源表明细</h2><span>" + items.length + " 行</span></div>"
    + "<div class=\"table-wrap\" style=\"max-height:560px\"><table class=\"data\"><thead><tr>"
    + "<th>名称</th><th>风险暴露类型</th><th>权重</th><th>敞口</th><th>风险加权资产</th>"
    + "</tr></thead><tbody>" + body + "</tbody></table></div></div>"
    + "<div class=\"calc-nav\">"
    + "<button type=\"button\" class=\"btn\" data-calc-stage=\"0\">← 回映射</button>"
    + "<span style=\"display:flex;gap:8px\">"
    + "<button type=\"button\" class=\"btn btn-primary\" data-calc-download>下载计算结果</button>"
    + "<button type=\"button\" class=\"btn\" data-calc-stage=\"2\">查看结果追溯 →</button>"
    + "</span></div>";
}

function pageEngine() {
  const stage = Math.max(0, Math.min(2, state.calcStage | 0));
  const calc = calcEngine();
  const stages = CALC_STAGES.map((s, i) =>
    "<button type=\"button\" class=\"calc-stage" + (i === stage ? " active" : "") + (i < stage ? " done" : "") + "\" data-calc-stage=\"" + i + "\">"
    + "<span class=\"no\">" + (i < stage ? "✓" : (i + 1)) + "</span>"
    + "<span><strong>" + esc(s.title) + "</strong><small>" + esc(s.detail) + "</small></span>"
    + "</button>"
  ).join("");
  let body = "";
  if (stage === 0) body = renderCalcClassifyBody(calc);
  else if (stage === 1) body = renderSourceCalc(calc);
  else body = renderCalcTraceBody(calc);

  return ph("engine")
    + "<div class=\"calc-stages\">" + stages + "</div>"
    + body;
}
