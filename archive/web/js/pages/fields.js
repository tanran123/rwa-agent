/* 产品字段页，以及上传列对照 */
function fieldIds(prod) {
  return (prod.fields || []).map((f) => f.id);
}

function addFieldsToProduct(productKey, items, source) {
  const prod = PRODUCTS[productKey];
  if (!prod) return 0;
  const exist = {};
  prod.fields.forEach((f) => { exist[f.id] = true; });
  let n = 0;
  items.forEach((item) => {
    if (!item || !item.id || exist[item.id]) return;
    prod.fields.push({
      id: item.id,
      type: item.type || "字符串",
      sample: item.sample == null ? "" : String(item.sample),
      required: !!item.required,
      source: source || "custom",
      zh: item.zh || FIELD_LABEL[item.id] || item.id
    });
    if (!FIELD_LABEL[item.id] && item.zh) FIELD_LABEL[item.id] = item.zh;
    exist[item.id] = true;
    n += 1;
  });
  return n;
}

function parseFieldPaste(text) {
  const rows = [];
  String(text || "").split(/\n+/).forEach((line) => {
    line = line.trim();
    if (!line || line.indexOf("字段") === 0 || line.indexOf("id") === 0) return;
    const parts = line.split(/[\t,，|]/).map((x) => x.trim()).filter(Boolean);
    if (parts.length < 1) return;
    const id = parts[0].replace(/^standard\./, "");
    if (!/^[a-zA-Z_][\w]*$/.test(id)) return;
    rows.push({
      id: id,
      type: parts[1] || "字符串",
      sample: parts[2] || "",
      required: /必填|true|1|yes/i.test(parts[3] || ""),
      zh: parts[4] || FIELD_LABEL[id] || id
    });
  });
  return rows;
}

const FIELD_TYPE_OPTS = ["枚举", "字符串", "布尔", "数值", "数值(月)", "数值%"];

function fieldTypeOptions(selected) {
  return FIELD_TYPE_OPTS.map((t) =>
    "<option value=\"" + esc(t) + "\"" + (selected === t ? " selected" : "") + ">" + esc(t) + "</option>"
  ).join("");
}

function renderFieldCreateModal(prod) {
  const d = state.fieldDraft || {};
  const body = "<p class=\"lead\">在类型「" + esc(prod.label) + "」下自行新增字段，保存后记为自维护并静默写入。</p>"
    + "<div class=\"reg-form-grid\">"
    + "<div class=\"field\"><label>字段 ID <span class=\"req\">必填</span></label>"
    + "<input id=\"fldNewId\" value=\"" + esc(d.id || "") + "\" placeholder=\"如 provision_ratio\" /></div>"
    + "<div class=\"field\"><label>中文名</label>"
    + "<input id=\"fldNewZh\" value=\"" + esc(d.zh || "") + "\" placeholder=\"如 准备占比\" /></div>"
    + "<div class=\"field\"><label>类型</label><select id=\"fldNewType\">" + fieldTypeOptions(d.type || "字符串") + "</select></div>"
    + "<div class=\"field\"><label>约束</label><select id=\"fldNewReq\">"
    + "<option value=\"0\"" + (!d.required ? " selected" : "") + ">选填</option>"
    + "<option value=\"1\"" + (d.required ? " selected" : "") + ">必填</option></select></div>"
    + "<div class=\"field full\"><label>示例值</label>"
    + "<input id=\"fldNewSample\" value=\"" + esc(d.sample || "") + "\" placeholder=\"映射示意用\" /></div>"
    + "</div>"
    + (state.fieldMsg ? "<div class=\"banner warn\" style=\"margin-top:12px\">" + esc(state.fieldMsg) + "</div>" : "");
  return modalShell({
    title: "新建字段 · " + prod.label,
    sub: "字段挂在当前产品类型下维护。",
    body: body,
    foot: "<button type=\"button\" class=\"btn\" data-modal-dismiss>取消</button>"
      + "<button type=\"button\" class=\"btn btn-primary\" data-field-create-save>保存字段</button>"
  });
}

function typeMatchBannerHtml(label) {
  const preview = findKbProductMatch(label || "");
  return preview
    ? ("将挂接知识库「<strong>" + esc(preview.label) + "</strong>」· " + preview.fields.length + " 个字段，再对照通用模板生成。")
    : "暂无知识库匹配；仍可创建，用已有/空字段对照通用模板生成瀑布。";
}

function refreshTypeMatchPreview() {
  const banner = document.getElementById("typeMatchBanner");
  if (!banner) return;
  const label = (state.typeDraft && state.typeDraft.label) || "";
  banner.innerHTML = typeMatchBannerHtml(label);
}

function renderTypeCreateModal() {
  const d = state.typeDraft || {};
  const onExpPage = state.page === "exposure" || state.expTypeModal;
  const body = "<p class=\"lead\">在<strong>当前分类判断页</strong>以<strong>通用流程模板</strong>为底，结合产品及相关字段生成瀑布流，直接画到图上。"
    + "字段对不上的节点会标 <strong>!</strong>。</p>"
    + "<div class=\"reg-form-grid\">"
    + "<div class=\"field full\"><label>类型名称 <span class=\"req\">必填</span></label>"
    + "<input id=\"typeNewLabel\" value=\"" + esc(d.label || "") + "\" placeholder=\"如：贷款、债券、贸易融资\" /></div>"
    + "<div class=\"field full\"><label>说明（可选）</label>"
    + "<input id=\"typeNewNote\" value=\"" + esc(d.note || "") + "\" placeholder=\"本客户口径备注\" /></div>"
    + "</div>"
    + "<div class=\"banner\" id=\"typeMatchBanner\" style=\"margin-top:12px\">"
    + typeMatchBannerHtml(d.label || "")
    + "</div>"
    + (state.fieldMsg ? "<div class=\"banner warn\" style=\"margin-top:10px\">" + esc(state.fieldMsg) + "</div>" : "");
  return modalShell({
    title: "新建产品类型",
    sub: onExpPage
      ? "留在本页 · 通用模板 → 产品瀑布 → 上图"
      : ("客户「" + currentCustomer().name + "」· 通用模板 × 产品字段"),
    body: body,
    foot: "<button type=\"button\" class=\"btn\" data-modal-dismiss>取消</button>"
      + "<button type=\"button\" class=\"btn btn-primary\" data-type-create-save>生成并放到图上</button>"
  });
}

function renderExpTypeGenBanner() {
  if (state.typeGenPhase !== "loading") return "";
  return "<div class=\"exp-gen-banner\" role=\"status\">"
    + "<span class=\"spin\"></span>"
    + "<div><strong>正在生成产品瀑布</strong>"
    + "<div class=\"meta\">" + esc(state.typeGenMsg || "以通用流程模板为底，结合产品字段生成中…") + "</div></div>"
    + "</div>";
}

function pageFields() {
  const prod = currentProduct();
  const keys = productKeys();
  if (!prod) {
    return ph("fields", "<div class=\"head-actions\">"
      + "<button type=\"button\" class=\"btn btn-primary\" data-field-mode=\"type\">新建类型</button></div>"
      + (state.fieldMode === "type" ? renderTypeCreateModal() : "")
      + "<div class=\"banner warn\">还没有产品类型。请先新建类型，再从知识库同步相关字段。</div>");
  }
  const customCount = prod.fields.filter((f) => f.source === "custom").length;
  const kbCount = prod.fields.filter((f) => f.source !== "custom").length;
  if (state.selectedField >= prod.fields.length) state.selectedField = Math.max(0, prod.fields.length - 1);
  const rows = prod.fields.map((f, i) => {
    return "<tr class=\"clickable" + (state.selectedField === i ? " selected" : "") + "\" data-field=\"" + i + "\">"
      + "<td><strong>" + esc(FIELD_LABEL[f.id] || f.zh || f.id) + "</strong>"
      + "<div class=\"mono\" style=\"color:var(--muted)\">standard." + esc(f.id) + "</div></td>"
      + "<td>" + esc(f.type) + "</td>"
      + "<td>" + esc(f.sample) + "</td>"
      + "<td>" + esc(sourceHeaderOf(f) || "—") + "</td>"
      + "<td style=\"color:var(--muted);font-size:12px\">" + esc(rulesUsingField(f.id).slice(0, 4).join("、") || "—") + "</td>"
      + "<td>" + (f.required ? "<span class=\"req\">必填</span>" : "<span class=\"opt\">选填</span>") + "</td>"
      + "</tr>";
  }).join("");
  const sel = prod.fields[state.selectedField] || prod.fields[0];
  const kbMatch = findKbProductMatch(prod);

  let modal = "";
  if (state.fieldMode === "type") {
    modal = renderTypeCreateModal();
  } else if (state.fieldMode === "create") {
    modal = renderFieldCreateModal(prod);
  } else if (state.fieldMode === "sync") {
    const libList = KB_PRODUCT_LIBRARY.map((tpl) =>
      "<li><strong>" + esc(tpl.label) + "</strong> · " + tpl.fields.length + " 个字段 · <span class=\"mono\">" + esc(tpl.kbSpace) + "</span>"
      + (kbMatch && kbMatch.id === tpl.id ? " <span class=\"tag ok\">将匹配</span>" : "")
      + "</li>"
    ).join("");
    modal = modalShell({
      title: "从知识库同步 · " + prod.label,
      sub: "按当前类型名称匹配知识库产品；有相关产品才拉取字段，自维护字段默认保留。",
      body: (state.fieldSyncPhase === "loading"
        ? "<div class=\"ai-bar wait\"><span class=\"spin\"></span>正在匹配并同步「" + esc(prod.label) + "」…</div>"
        : state.fieldSyncPhase === "done"
          ? "<div class=\"ai-bar\">" + esc(state.fieldMsg || "同步完成") + "</div>"
          : "<p class=\"lead\">当前类型「<strong>" + esc(prod.label) + "</strong>」"
            + (kbMatch
              ? (" → 将匹配「" + esc(kbMatch.label) + "」（" + kbMatch.fields.length + " 个字段）")
              : " → <strong>暂无匹配</strong>，同步后不会写入字段，请自行维护")
            + "。</p>"
            + "<p style=\"font-size:12px;color:var(--muted)\">知识库可匹配产品：</p>"
            + "<ul style=\"margin:0;padding-left:1.1em;font-size:13px;color:var(--muted)\">" + libList + "</ul>"
            + "<div class=\"banner\" style=\"margin-top:12px\">仅同步<strong>当前类型</strong>；无匹配时不影响已有自维护字段。</div>"),
      foot: "<button type=\"button\" class=\"btn\" data-modal-dismiss>取消</button>"
        + "<button type=\"button\" class=\"btn btn-primary\" data-field-sync" + (state.fieldSyncPhase === "loading" ? " disabled" : "") + ">同步当前类型</button>"
    });
  } else if (state.fieldMode === "bulk") {
    const ways = [
      ["paste", "粘贴表格", "一次贴多行：字段名,类型,示例,必填"],
      ["pack", "套用字段包", "CRM / 房地产 / 表外等整包加入"],
      ["kb", "知识库勾选", "从目录多选，按组一批加入"],
      ["copy", "从其他产品复制", "把已有产品的字段拷过来"]
    ];
    let body = "<p class=\"lead\">按产品类型维护一套标准字段，用下面任一方式一批加入。</p>"
      + "<div class=\"field-methods\">"
      + ways.map((w) =>
        "<button type=\"button\" class=\"field-method" + (state.fieldBulkWay === w[0] ? " active" : "") + "\" data-bulk-way=\"" + w[0] + "\">"
        + "<strong>" + esc(w[1]) + "</strong><span>" + esc(w[2]) + "</span></button>"
      ).join("") + "</div>";

    if (state.fieldBulkWay === "paste") {
      body += "<p>每行一个字段，可用逗号/制表符分隔。例：</p>"
        + "<pre style=\"font-size:11px;background:#f4f6f9;padding:8px;border-radius:8px;overflow:auto\">exposure_amount,数值,90000000,必填,风险暴露额\nprovision_ratio,数值%,12,选填,准备占比</pre>"
        + "<textarea class=\"field-paste\" id=\"fieldPasteBox\" placeholder=\"id,类型,示例,必填/选填,中文名\">"
        + esc(state.fieldPaste) + "</textarea>";
    } else if (state.fieldBulkWay === "pack") {
      body += FIELD_PACKS.map((pack) =>
        "<label class=\"kb-check\"><input type=\"checkbox\" data-pack-id=\"" + esc(pack.id) + "\""
        + (state.fieldPackPick[pack.id] ? " checked" : "") + " />"
        + "<div><strong>" + esc(pack.name) + "</strong>"
        + "<div class=\"meta\">" + esc(pack.desc) + " · " + pack.fields.length + " 个字段</div></div></label>"
      ).join("");
    } else if (state.fieldBulkWay === "kb") {
      body += KB_FIELD_CATALOG.map((g) =>
        "<div style=\"margin-bottom:10px\"><strong style=\"font-size:12px\">" + esc(g.group) + "</strong>"
        + g.items.map((item) =>
          "<label class=\"kb-check\"><input type=\"checkbox\" data-kb-id=\"" + esc(item.id) + "\""
          + (state.fieldKbPick[item.id] ? " checked" : "") + " />"
          + "<div><strong>" + esc(item.zh) + "</strong> <span class=\"mono\">" + esc(item.id) + "</span>"
          + "<div class=\"meta\">" + esc(item.type) + (item.required ? " · 必填" : " · 选填") + "</div></div></label>"
        ).join("") + "</div>"
      ).join("");
    } else {
      body += "<div class=\"field\"><label>源产品</label><select id=\"fieldCopyFrom\">"
        + Object.keys(PRODUCTS).filter((k) => k !== state.product).map((k) =>
          "<option value=\"" + k + "\">" + esc(PRODUCTS[k].label) + "（" + PRODUCTS[k].fields.length + " 个）</option>"
        ).join("") + "</select></div>"
        + "<p>只复制当前产品还没有的字段；来源记为自定义，保存时静默写入知识库。</p>";
    }
    if (state.fieldMsg) body += "<div class=\"banner ok\">" + esc(state.fieldMsg) + "</div>";

    modal = modalShell({
      wide: true,
      title: "批量添加字段 · " + prod.label,
      sub: "不要逐条新增，一批加入更合适。",
      body: body,
      foot: "<button type=\"button\" class=\"btn\" data-modal-dismiss>取消</button>"
        + "<button type=\"button\" class=\"btn btn-primary\" data-field-bulk-apply>加入当前产品</button>"
    });
  }

  const side = !sel
    ? ("<aside class=\"side\"><h3>" + esc(prod.label) + "</h3>"
      + "<p class=\"banner\">本类型暂无字段。可「从知识库同步」拉取相关产品，或「新建字段」自行维护。</p>"
      + "<div style=\"display:flex;flex-wrap:wrap;gap:8px;margin-top:10px\">"
      + "<button type=\"button\" class=\"btn btn-primary\" data-field-mode=\"sync\">从知识库同步</button>"
      + "<button type=\"button\" class=\"btn\" data-field-mode=\"create\">新建字段</button></div></aside>")
    : ("<aside class=\"side\"><h3>字段维护 · " + esc(prod.label) + "</h3>"
      + (state.fieldEditMsg ? "<div class=\"banner ok\" style=\"margin-bottom:10px\">" + esc(state.fieldEditMsg) + "</div>" : "")
      + "<div class=\"field\" style=\"margin-bottom:10px\"><label>中文名</label>"
      + "<input id=\"fldEditZh\" value=\"" + esc(FIELD_LABEL[sel.id] || sel.zh || "") + "\" /></div>"
      + "<div class=\"field\" style=\"margin-bottom:10px\"><label>字段 ID</label>"
      + "<input value=\"" + esc(sel.id) + "\" disabled title=\"ID 创建后不可改，映射键固定\" /></div>"
      + "<div class=\"field\" style=\"margin-bottom:10px\"><label>类型</label>"
      + "<select id=\"fldEditType\">" + fieldTypeOptions(sel.type) + "</select></div>"
      + "<div class=\"field\" style=\"margin-bottom:10px\"><label>银行源字段</label>"
      + "<input id=\"fldEditSource\" value=\"" + esc(sel.sourceHeader || sourceHeaderOf(sel)) + "\" placeholder=\"例如 贷款余额\" /></div>"
      + "<div class=\"field\" style=\"margin-bottom:10px\"><label>规则引用</label>"
      + "<p style=\"margin:0;font-size:12px;color:var(--muted)\">" + esc(rulesUsingField(sel.id).join("、") || "还没有权重或 CCF 条件引用这个字段") + "</p></div>"
      + "<div class=\"field\" style=\"margin-bottom:10px\"><label>示例值</label>"
      + "<input id=\"fldEditSample\" value=\"" + esc(sel.sample || "") + "\" /></div>"
      + "<div class=\"field\" style=\"margin-bottom:10px\"><label>约束</label>"
      + "<select id=\"fldEditReq\">"
      + "<option value=\"0\"" + (!sel.required ? " selected" : "") + ">选填</option>"
      + "<option value=\"1\"" + (sel.required ? " selected" : "") + ">必填</option></select></div>"
      + "<dl class=\"kv\" style=\"margin-top:4px\"><dt>来源</dt><dd>"
      + (sel.source === "custom" ? "自维护（已静默写入）" : "知识库（编辑后记为自维护）") + "</dd>"
      + "<dt>映射键</dt><dd class=\"mono\">standard." + esc(sel.id) + "</dd></dl>"
      + "<div style=\"display:flex;flex-wrap:wrap;gap:8px;margin-top:12px\">"
      + "<button type=\"button\" class=\"btn btn-primary\" data-field-save>保存修改</button>"
      + "<button type=\"button\" class=\"btn\" data-field-delete>删除</button>"
      + "</div>"
      + "<p style=\"font-size:12px;color:var(--muted);margin-top:12px\">在本类型下维护字段；也可批量添加。写入均为静默。</p>"
      + "</aside>");

  return ph("fields", "<div class=\"head-actions\">"
    + "<button type=\"button\" class=\"btn btn-primary\" data-field-mode=\"type\">新建类型</button>"
    + "<button type=\"button\" class=\"btn\" data-field-mode=\"sync\">从知识库同步</button>"
    + "<button type=\"button\" class=\"btn\" data-goto=\"engine\" data-calc-stage=\"0\">去计算 · 映射 →</button>"
    + "</div>")
    + "<div class=\"field-actions\">"
    + "<button type=\"button\" class=\"btn\" data-field-mode=\"create\">新建字段</button>"
    + "<button type=\"button\" class=\"btn\" data-field-mode=\"bulk\">批量添加字段</button>"
    + "</div>"
    + modal
    + "<div class=\"banner\">每个产品类型只有这一份标准字段。银行源字段映射到字段 ID，权重和 CCF 的条件按字段 ID 引用。流程：<strong>新建类型</strong> → <strong>知识库同步</strong>（有相关产品才拉取）→ 在右侧<strong>改这一条</strong>。"
    + " 当前「" + esc(prod.label) + "」：知识库 " + kbCount + " · 自维护 " + customCount
    + (kbMatch ? " · 可匹配「" + esc(kbMatch.label) + "」" : " · 暂无知识库匹配")
    + "。</div>"
    + "<div class=\"tabs\">"
    + keys.map((k) =>
      "<button type=\"button\" data-product=\"" + k + "\" class=\"" + (state.product === k ? "active" : "") + "\">"
      + esc(PRODUCTS[k].label) + " <span class=\"opt\">" + PRODUCTS[k].fields.length + "</span></button>"
    ).join("")
    + "<button type=\"button\" data-field-mode=\"type\" class=\"opt\" style=\"border-style:dashed\">＋ 类型</button>"
    + "</div>"
    + "<div class=\"split\">"
    + "<div class=\"panel\"><div class=\"panel-head\"><h2>" + esc(prod.label) + " · 标准字段</h2>"
    + "<span>" + prod.fields.length + " 个</span></div>"
    + "<div class=\"table-wrap\"><table class=\"data\"><thead><tr>"
    + "<th>字段</th><th>类型</th><th>示例</th><th>银行源字段</th><th>规则引用</th><th>约束</th></tr></thead><tbody>"
    + (rows || "<tr><td colspan=\"6\" style=\"color:var(--muted)\">暂无字段 · 请先同步知识库或新建字段</td></tr>") + "</tbody></table></div></div>"
    + side + "</div>";
}

function applyUploadSuggestions() {
  const book = currentUpload();
  const next = {};
  const reasons = {};
  const used = {};
  UPLOAD_FIELD_HINTS.forEach(function (pair) {
    const col = (book.columns || []).find(function (item) {
      return !used[item.letter] && pair[1].test(String(item.header || "").replace(/\s/g, ""));
    });
    if (!col) return;
    used[col.letter] = true;
    next[pair[0]] = col.letter;
    reasons[pair[0]] = "表头「" + col.header + "」";
  });
  state.mapSuggested = next;
  state.mapAssignments = Object.assign({}, next);
  state.mapReasons = reasons;
  state.mapTouched = {};
  state.classifyTags = {};
  state.mapPhase = "ready";
}

function usingClassFields() {
  return !!(state.uploadBook && state.classFields && state.classFields.length);
}

function mapTableFields() {
  if (state.uploadBook && state.uploadBook.basis === "catalog") {
    const byId = {};
    (state.classFields || []).forEach(function (field) { byId[field.id] = field; });
    return (state.uploadBook.fieldIds || []).map(function (id) {
      return byId[id] || { id: id, label: id, source: "column" };
    });
  }
  if (!usingClassFields()) {
    const prod = PRODUCTS[state.product] || PRODUCTS.loan;
    return prod.fields || [];
  }
  return state.classFields.slice().sort(function (a, b) {
    const rank = function (field) {
      return field.source === "manual" || field.source === "calc" ? 1 : 0;
    };
    return rank(a) - rank(b);
  });
}

function mappingFields() {
  return classifyJudgeFields().map(function (field) {
    const src = (state.classFields || []).filter(function (item) { return item.id === field.id; })[0];
    const options = ((src && src.options) || []).slice(0, 30).map(function (opt) {
      return (opt.label || opt.code) + "=" + opt.code;
    });
    return {
      id: field.id,
      label: field.field,
      required: true,
      hint: (src && src.meaning) || field.role || "",
      sample: field.sample || "",
      options: options
    };
  });
}

function unmappedJudgeCount() {
  seedClassifyFields();
  return classifyJudgeFields().filter(function (field) {
    return state.classifyFieldPick[field.key] !== false && !field.assign;
  }).length;
}

function applyModelMapping(data) {
  const mapping = (data && data.mapping) || {};
  const reasons = (data && data.reasons) || {};
  const allowed = {};
  (currentUpload().columns || []).forEach(function (col) { allowed[col.letter] = true; });
  const next = {};
  const why = {};
  const used = {};
  Object.keys(mapping).forEach(function (id) {
    const slot = mapping[id];
    let letter = "";
    let constant = "";
    let reason = "";
    if (slot && typeof slot === "object") {
      letter = String(slot.column || slot.letter || "").toUpperCase();
      constant = String(slot.const || slot.value || "").trim();
      reason = slot.reason || reasons[id] || "";
    } else {
      const token = String(slot || "").trim();
      if (/^[A-Za-z]+$/.test(token)) letter = token.toUpperCase();
      else constant = token;
      reason = reasons[id] || "";
    }
    if (letter && allowed[letter] && !used[letter]) {
      next[id] = letter;
      why[id] = reason || ("模型对应到 " + letter);
      used[letter] = true;
      return;
    }
    if (constant) {
      next[id] = "__const__:" + constant;
      why[id] = reason || "表里没有这一列，模型填了常量";
    }
  });
  state.mapAssignments = next;
  classifyJudgeFields().forEach(function (field) {
    if (next[field.id]) return;
    const sample = String(field.sample || "").trim() || "未提供";
    next[field.id] = "__const__:" + sample;
    why[field.id] = why[field.id] || "表里没有对应列，先用字段示例";
  });
  state.mapSuggested = Object.assign({}, next);
  state.mapAssignments = next;
  state.mapReasons = why;
  state.mapTouched = {};
  state.classifyTags = {};
  state.mapExtract = (data && data.extract) || "";
  state.mapPhase = "ready";
  const missing = unmappedJudgeCount();
  state.mapError = missing ? ("还有 " + missing + " 个字段没有来源。") : "";
}

function requestModelMapping() {
  const book = state.uploadBook;
  if (!book) return;
  state.mapPhase = "loading";
  state.mapWait = "map";
  state.mapError = "";
  render();
  fetch("/api/sheet-map", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      file: book.file || state.mapFile,
      sheet: book.sheet,
      header_row: book.headerRow,
      row_count: book.rowCount || (book.rows || []).length,
      headers: (book.columns || []).map(function (col) {
        return {
          column: col.letter,
          header: col.header,
          samples: col.samples || (col.sample && col.sample !== "—" ? [col.sample] : [])
        };
      }),
      rows: (book.rows || []).slice(0, 40),
      fields: mappingFields(),
      decisions: (book && book.decisions) || ""
    })
  })
    .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
    .then(function (pack) {
      if (state.page !== "engine" || !state.uploadBook) return;
      if (!pack.ok || !pack.data || !pack.data.mapping) {
        state.mapPhase = "ready";
        state.mapError = (pack.data && pack.data.error) || "模型没有返回字段对应。可以再发一次，或手动选列。";
        render();
        return;
      }
      applyModelMapping(pack.data);
      render();
    })
    .catch(function () {
      if (!state.uploadBook) return;
      state.mapPhase = "ready";
      state.mapError = "模型对应失败。已保留上次结果，可以再发一次，或手动选列。";
      render();
    });
}

function clarifyPayload(message) {
  const book = state.uploadBook || {};
  const messages = ((state.clarify && state.clarify.messages) || []).map(function (item) {
    return { role: item.role === "user" ? "user" : "assistant", content: item.text || "" };
  });
  if (message) messages.push({ role: "user", content: message });
  return {
    uploadId: book.uploadId || "",
    plan: book.plan || [],
    note: book.planNote || state.mapExtract || "",
    messages: messages
  };
}

function applyClarifyTable(table) {
  const book = state.uploadBook;
  if (!book || !table || !(table.columns || []).length) return;
  book.sheet = table.sheet || book.sheet;
  book.headerRow = table.headerRow || book.headerRow;
  book.columns = table.columns;
  book.rows = table.rows || [];
  book.rowCount = table.rowCount || book.rows.length;
}

function finishClarify(pack) {
  const data = (pack && pack.data) || {};
  const book = state.uploadBook;
  if (!book) return;
  if (!pack.ok || data.error) {
    state.clarify = null;
    state.mapExtract = (state.mapExtract ? state.mapExtract + " " : "") + "确认这一步没有完成，先按研判结果映射。";
    requestModelMapping();
    return;
  }
  if (data.ready) {
    if (data.decisions) book.decisions = data.decisions;
    if (data.reply) state.mapExtract = data.reply + (data.decisions ? " " + data.decisions : "");
    applyClarifyTable(data.table);
    state.clarify = null;
    requestModelMapping();
    return;
  }
  const messages = (state.clarify && state.clarify.messages) ? state.clarify.messages.slice() : [];
  if (data.reply || (data.questions || []).length) {
    messages.push({
      role: "assistant",
      text: data.reply || "需要你确认下面几项。",
      questions: data.questions || []
    });
  }
  state.clarify = { messages: messages, draft: "", busy: false };
  state.mapPhase = "clarify";
  state.mapWait = "";
  render();
}

function startClarify() {
  const book = state.uploadBook;
  if (!book || !book.uploadId) {
    requestModelMapping();
    return;
  }
  state.mapPhase = "loading";
  state.mapWait = "ask";
  state.clarify = { messages: [], draft: "", busy: true };
  render();
  fetch("/api/sheet-clarify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(clarifyPayload(""))
  })
    .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
    .then(finishClarify)
    .catch(function () {
      finishClarify({ ok: false, data: { error: "确认没有连上" } });
    });
}

function sendClarify(text) {
  const message = String(text || "").trim();
  if (!message || !state.clarify || state.clarify.busy) return;
  state.clarify.messages.push({ role: "user", text: message });
  state.clarify.draft = "";
  state.clarify.busy = true;
  render();
  fetch("/api/sheet-clarify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(clarifyPayload(""))
  })
    .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
    .then(finishClarify)
    .catch(function () {
      if (!state.clarify) return;
      state.clarify.busy = false;
      state.clarify.messages.push({ role: "assistant", text: "这次没有问成。可以再答一次，或点按研判结果继续。", questions: [] });
      render();
    });
}

function renderClarifyDialog() {
  const box = state.clarify || { messages: [], draft: "", busy: false };
  const log = (box.messages || []).map(function (item) {
    return "<div class=\"clarify-msg " + (item.role === "user" ? "user" : "bot") + "\">" + esc(item.text || "") + "</div>";
  }).join("");
  const last = (box.messages || []).filter(function (item) { return item.role !== "user"; }).slice(-1)[0];
  const asks = (!box.busy && last && last.questions || []).map(function (question) {
    const options = (question.options || []).map(function (opt) {
      return "<button type=\"button\" class=\"btn\" data-clarify-send=\"" + esc(opt) + "\">" + esc(opt) + "</button>";
    }).join("");
    return "<div class=\"clarify-ask\"><strong>" + esc(question.ask || "") + "</strong>" + options + "</div>";
  }).join("");
  return "<div class=\"banner\">研判里有几处会改变用哪一块数据。确认之后才映射和计算。</div>"
    + "<div class=\"clarify-box\">"
    + "<div class=\"panel-head\"><h2>确认用哪一块数据</h2><span>问完再映射</span></div>"
    + "<div class=\"clarify-log\">" + (log || "<div class=\"clarify-msg bot\">正在看研判结果…</div>") + "</div>"
    + (box.busy ? "<div class=\"ai-bar wait\" style=\"margin:0 16px 12px\"><span class=\"spin\"></span>正在根据你的回答判断…</div>" : asks)
    + "<form class=\"clarify-form\" id=\"clarifyForm\">"
    + "<input id=\"clarifyInput\" placeholder=\"直接回答，或补充要用哪一列、哪一张表\" value=\"" + esc(box.draft || "") + "\"" + (box.busy ? " disabled" : "") + " />"
    + "<button type=\"submit\" class=\"btn btn-primary\"" + (box.busy ? " disabled" : "") + ">发送</button>"
      + "<button type=\"button\" class=\"btn\" data-clarify-send=\"按当前判断继续\"" + (box.busy ? " disabled" : "") + ">按研判结果继续</button>"
    + "</form></div>";
}
