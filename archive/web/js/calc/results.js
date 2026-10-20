/* 底稿结果、留痕和下载 */
function applyAiSuggestions() {
  const suggest = SAMPLE_UPLOAD.aiSuggest;
  const next = {};
  const reasons = {};
  Object.keys(suggest).forEach((id) => {
    const item = suggest[id];
    next[id] = item.letter || (item.const ? "__const__:" + item.const : "");
    reasons[id] = item.reason || "";
  });
  const prod = PRODUCTS[state.product] || PRODUCTS.loan;
  (prod.fields || []).forEach(function (field) {
    if (next[field.id]) return;
    const sample = String(field.sample || "").trim();
    if (!sample) return;
    next[field.id] = "__const__:" + sample;
    reasons[field.id] = reasons[field.id] || "样例没有这一列，用字段示例";
  });
  state.mapSuggested = Object.assign({}, next);
  state.mapAssignments = Object.assign({}, next);
  state.mapReasons = reasons;
  state.mapTouched = {};
  state.mapPhase = "ready";
}

function colByLetter(letter) {
  return (currentUpload().columns || []).find((c) => c.letter === letter) || null;
}

function weightPoints(rate) {
  const n = Number(rate) * 100;
  if (!isFinite(n)) return "";
  if (Math.abs(n - Math.round(n)) < 1e-6) return String(Math.round(n));
  return String(Math.round(n * 100) / 100);
}

function applyHandWeight(leg, raw) {
  const text = String(raw == null ? "" : raw).trim().replace(/%/g, "");
  const points = parseFloat(text);
  if (!leg.paperClass) leg.paperClass = {};
  if (!isFinite(points)) {
    if (leg.fromPaper) {
      leg.rwRate = null;
      leg.paperClass.rwRate = null;
      leg.paperClass.rwHint = "未定权重";
      const bits = String(leg.name || "").split(" · ");
      if (bits.length >= 2) {
        bits[bits.length - 1] = "未定权重";
        leg.name = bits.join(" · ");
      }
    } else {
      delete leg.handRw;
    }
    return;
  }
  const rate = points / 100;
  if (leg.fromPaper) {
    leg.rwRate = rate;
    leg.paperClass.rwRate = rate;
    leg.paperClass.rwHint = weightPoints(rate) + "%（手填）";
    const bits = String(leg.name || "").split(" · ");
    if (bits.length >= 2) {
      bits[bits.length - 1] = leg.paperClass.rwHint;
      leg.name = bits.join(" · ");
    }
  } else {
    leg.handRw = rate;
  }
}

function paperResultRows() {
  const rows = [];
  (state.calcLegs || []).forEach(function (leg, index) {
    if (!leg.fromPaper) return;
    const priced = calcOneLeg(leg);
    const cls = leg.paperClass || {};
    const open = !!leg.weightOpen;
    const filled = typeof leg.rwRate === "number";
    rows.push({
      index: index,
      name: leg.name || "",
      hint: cls.rwHint || "未定权重",
      path: (cls.path || []).join(" → "),
      ead: priced.ead,
      rwa: priced.rwa,
      open: open,
      filled: filled,
      points: filled ? weightPoints(leg.rwRate) : ""
    });
  });
  return rows;
}

function paperResultTable() {
  const rows = paperResultRows();
  const waiting = rows.filter(function (row) { return row.open && !row.filled; }).length;
  return (waiting
    ? "<div class=\"banner warn\">还有 " + waiting + " 档没有权重。在权重列填百分比，例如 75 表示 75%，填上后才计入风险加权资产。</div>"
    : "")
    + "<div class=\"panel\"><div class=\"panel-head\"><h2>分类与计算结果</h2><span>" + rows.length + " 档</span></div>"
    + "<div class=\"table-wrap\" style=\"max-height:480px\"><table class=\"data\"><thead><tr>"
    + "<th>分类</th><th>权重</th><th>敞口</th><th>风险加权资产</th></tr></thead><tbody>"
    + rows.map(function (row) {
      const weightCell = row.open
        ? "<input class=\"num-in\" data-paper-rw=\"" + row.index + "\" type=\"number\" min=\"0\" max=\"1250\" step=\"0.01\" placeholder=\"手填%\" value=\"" + esc(row.points) + "\" style=\"width:88px\" />"
        : esc(row.hint);
      const rwaCell = row.open && !row.filled ? "待手填" : yi(row.rwa);
      return "<tr><td>" + esc(row.name) + "</td><td>" + weightCell + "</td>"
        + "<td class=\"num\">" + yi(row.ead) + "</td><td class=\"num\"><strong>" + rwaCell + "</strong></td></tr>";
    }).join("")
    + "</tbody></table></div></div>";
}

function paperDownloadLink() {
  return "<button type=\"button\" class=\"btn btn-primary\" data-calc-download>下载计算结果</button>";
}

function traceRowsFromState(calc) {
  const paperRows = state.paperRows || [];
  if (paperRows.length) {
    return paperRows.map(function (row) {
      return {
        sheet: row.sheet || "",
        excel_row: row.excel_row,
        name: row.name || "",
        exposure: row.exposure || "",
        weight_text: row.weight_text || "",
        ead: row.ead,
        rwa: row.rwa,
        trace: row.trace || "",
        steps: row.steps || []
      };
    });
  }
  return ((calc && calc.legs) || []).map(function (item) {
    const leg = item.leg || {};
    const cls = item.classify || {};
    return {
      sheet: leg.sourceSheet || "",
      excel_row: leg.sourceRow,
      name: leg.name || "",
      exposure: (cls.category ? cls.category + " · " : "") + (cls.subclass || ""),
      weight_text: cls.rwHint || "",
      ead: item.ead,
      rwa: item.openWeight ? null : item.rwa,
      steps: item.steps || leg.traceSteps || []
    };
  });
}

function persistCalcTrace(calc) {
  const rows = traceRowsFromState(calc);
  if (!rows.length) return;
  const book = state.uploadBook || {};
  fetch("/api/calc-trace", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file: book.file || "计算", rows: rows })
  }).catch(function () {});
}

function downloadCalcWorkbook(calc) {
  persistCalcTrace(calc);
  const book = state.uploadBook || {};
  const paperRows = state.paperRows || [];
  const lines = paperRows.length
    ? paperRows.map(function (row) {
      const amount = Number(row.ead) || 0;
      return {
        sheet: row.sheet || "",
        excel_row: row.excel_row,
        header_row: row.header_row,
        exposure: row.exposure || "",
        weight: row.weight_text || "",
        ead: amount,
        rwa: typeof row.weight === "number" ? amount * row.weight : row.rwa,
        trace: row.trace || "",
        steps: row.steps || []
      };
    })
    : (calc.legs || []).map(function (item) {
      const leg = item.leg || {};
      const cls = item.classify || {};
      if (!leg.sourceRow) return null;
      return {
        sheet: leg.sourceSheet || book.sheet || "",
        excel_row: leg.sourceRow,
        header_row: leg.sourceHeader || book.headerRow,
        name: leg.name || "",
        exposure: (cls.category ? cls.category + " · " : "") + (cls.subclass || ""),
        weight: cls.rwHint || "",
        ead: (Number(item.ead) || 0) * 100000000,
        rwa: item.openWeight ? null : (Number(item.rwa) || 0) * 100000000,
        trace: (cls.path || []).join(" → "),
        steps: item.steps || leg.traceSteps || []
      };
    }).filter(Boolean);
  fetch("/api/calc-export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      uploadId: book.uploadId || "",
      ead: calc.ead,
      rwa: calc.rwa,
      lines: lines
    })
  })
    .then(function (res) {
      if (!res.ok) throw new Error("download");
      return res.blob();
    })
    .then(function (blob) {
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = String((book.file || "信用风险RWA")).replace(/\.xlsx$/i, "") + "_计算RWA.xlsx";
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    })
    .catch(function () {
      state.mapError = "计算结果没有下载成功。";
      render();
    });
}

function matchFieldIds(match, bag) {
  if (!match || typeof match !== "object") return;
  if (match.field) bag[match.field] = true;
  ["all", "any"].forEach(function (key) {
    const list = match[key];
    if (Array.isArray(list)) list.forEach(function (item) { matchFieldIds(item, bag); });
  });
}

function modelFieldUsers() {
  const pairs = [];
  (state.calcLegs || []).forEach(function (leg) {
    const pc = leg.paperClass || {};
    if (leg.fromPaper && (pc.leaf || pc.subclass)) {
      pairs.push({ category: pc.subclass || "", leaf: pc.leaf || pc.subclass });
    }
  });
  Object.keys(state.classifyTags || {}).forEach(function (id) {
    if (state.classifyPick[id] === false) return;
    const parts = String(state.classifyTags[id] || "").split("||");
    if (parts[0] || parts[1]) pairs.push({ category: parts[0] || "", leaf: parts[1] || parts[0] });
  });
  const users = {};
  function walk(node, inherited, categoryLabel) {
    const bag = {};
    Object.keys(inherited).forEach(function (id) { bag[id] = true; });
    const local = {};
    matchFieldIds(node.match, local);
    if (node.skip && node.skip.field) local[node.skip.field] = true;
    Object.keys(local).forEach(function (id) { bag[id] = true; });
    const root = categoryLabel || node.label;
    const hit = pairs.some(function (pair) {
      return pair.leaf === node.label && (!pair.category || pair.category === root || pair.leaf === pair.category);
    });
    if (hit) {
      Object.keys(bag).forEach(function (id) {
        if (!users[id]) users[id] = {};
        users[id][root + " · " + node.label] = true;
      });
    }
    (node.children || []).forEach(function (child) { walk(child, bag, root); });
  }
  (BASE_EXP_TEMPLATE.categories || []).forEach(function (cat) { walk(cat, {}, cat.label); });
  return users;
}

function renderPaperCoverage() {
  const users = modelFieldUsers();
  const needed = Object.keys(users);
  const fields = needed.length
    ? (state.paperCoverage || []).filter(function (field) { return users[field.id]; })
    : (state.paperCoverage || []);
  const rows = fields.map(function (field) {
    const hits = field.hits || [];
    const models = users[field.id] ? Object.keys(users[field.id]) : [];
    return "<tr><td><strong>" + esc(field.label || field.id) + "</strong>"
      + "<div class=\"mono\" style=\"color:var(--muted)\">" + esc(field.id) + "</div></td>"
      + "<td>" + (models.length ? models.map(function (name) { return esc(name); }).join("<br>") : "—") + "</td>"
      + "<td>" + (hits.length
        ? hits.map(function (hit) { return esc(hit); }).join("<br>")
        : "<span class=\"opt\">底稿没有</span>")
      + "</td></tr>";
  }).join("");
  const mapped = fields.filter(function (field) { return (field.hits || []).length; }).length;
  return "<div class=\"banner ok\">判定字段已经对到源表列，对上 " + mapped + " / " + fields.length + " 个。开始计算后，每一行会加上风险暴露类型、权重和 RWA。"
    + "</div>"
    + "<div class=\"calc-nav\">"
    + "<span></span>"
    + "<span style=\"display:flex;gap:8px\">"
    + paperDownloadLink()
    + "<button type=\"button\" class=\"btn btn-primary\" data-calc-stage=\"1\">开始计算 →</button>"
    + "</span></div>"
    + "<div class=\"panel\"><div class=\"panel-head\"><h2>本批模型要用的字段</h2><span>Credit Risk Working 202609</span></div>"
    + "<div class=\"table-wrap\" style=\"max-height:520px\"><table class=\"data\"><thead><tr><th>分类字段</th><th>用于模型</th><th>底稿对应</th></tr></thead><tbody>"
    + (rows || "<tr><td colspan=\"3\" class=\"opt\">还没有分类结果，先做分类判断。</td></tr>")
    + "</tbody></table></div></div>";
}

function renderMappingBody() {
  if (state.uploadBook && state.uploadBook.basis === "paper" && state.paperCoverage && state.paperCoverage.length && state.mapPhase !== "loading") {
    return renderPaperCoverage();
  }
  const prod = PRODUCTS[state.product] || PRODUCTS.loan;
  const phase = state.mapPhase;
  const book = currentUpload();
  const cols = book.columns || [];
  const fieldUsers = modelFieldUsers();
  const neededIds = Object.keys(fieldUsers);
  const judgeMode = !!(state.uploadBook && state.uploadBook.basis !== "catalog" && state.uploadBook.basis !== "paper");
  let tableFields = judgeMode
    ? classifyJudgeFields().map(function (field) {
      return { id: field.id, label: field.field, required: true, source: "column" };
    })
    : mapTableFields();
  if (!judgeMode && neededIds.length) {
    const narrowed = tableFields.filter(function (field) { return fieldUsers[field.id]; });
    if (narrowed.length) tableFields = narrowed;
  }
  const mappedCount = tableFields.filter((f) => {
    const v = state.mapAssignments[f.id];
    return v && v !== "";
  }).length;
  const requiredMiss = tableFields.filter((f) => f.required && !state.mapAssignments[f.id]).length;

  if (phase === "idle") {
    return "<div class=\"banner\">还没有映射。先把判定字段对到源表列，计算时再写入每一行的风险暴露类型和 RWA。</div>"
      + (state.mapError ? "<div class=\"banner warn\">" + esc(state.mapError) + "</div>" : "")
      + "<div class=\"calc-nav\"><span></span>"
      + "<button type=\"button\" class=\"btn btn-primary\" data-calc-stage=\"0\">去映射 →</button></div>";
  }

  const aiBar = phase === "loading"
    ? "<div class=\"ai-bar wait\"><span class=\"spin\"></span>"
      + (state.mapWait === "map"
        ? "已把「" + esc(book.file || state.mapFile) + "」发给模型，请它按计算 RWA 提取要用的列…"
        : "正在读取「" + esc(state.mapFile || book.file) + "」…")
      + "</div>"
    : phase === "confirmed"
      ? "<div class=\"ai-bar\"><span class=\"tag ok\">已核对</span>"
        + "这套模型要用的字段已核对。可进入试算，或点「解锁修改」再改。</div>"
      : "<div class=\"ai-bar\"><span class=\"tag accent\">" + (state.uploadBook ? "模型已提取" : "大模型已预选") + "</span>"
        + (state.uploadBook && state.mapExtract ? esc(state.mapExtract) + " " : "")
        + "已自动填入 " + mappedCount + " / " + tableFields.length + " 个" + (judgeMode ? "判定字段" : (usingClassFields() ? "分类字段" : "标准字段")) + "。"
        + (judgeMode
          ? (requiredMiss ? " 还有 <strong>" + requiredMiss + "</strong> 个没有来源，每一项都要对上才能试算。" : " 每一项都已对应，可以进入试算。")
          : (usingClassFields()
          ? " 对不上的留空即可，确认后按已对上的列分类。"
          : (requiredMiss ? " 还有 <strong>" + requiredMiss + "</strong> 个必填未映射，请补选。" : " 必填已齐，核对后进入试算。")))
        + " 绿框为模型建议，蓝框为你改过的。</div>";

  const rows = tableFields.map((f) => {
    const id = f.id;
    const req = f.required;
    const val = state.mapAssignments[id] || "";
    const suggested = state.mapSuggested[id] || "";
    const touched = !!state.mapTouched[id];
    const isConst = val.indexOf("__const__:") === 0;
    const letter = isConst ? "" : val;
    const col = letter ? colByLetter(letter) : null;
    const reason = state.mapReasons[id] || "";
    const selClass = touched ? "user-pick" : (val && val === suggested ? "ai-pick" : "");
    let options = "<option value=\"\">不映射 / 稍后补</option>";
    if (isConst) {
      options += "<option value=\"" + esc(val) + "\" selected>常量 · " + esc(val.slice(10)) + "</option>";
    } else if (!state.uploadBook && SAMPLE_UPLOAD.aiSuggest[id] && SAMPLE_UPLOAD.aiSuggest[id].const) {
      const c = SAMPLE_UPLOAD.aiSuggest[id].const;
      options += "<option value=\"__const__:" + esc(c) + "\">常量 · " + esc(c) + "</option>";
    }
    options += cols.map((c) =>
      "<option value=\"" + esc(c.letter) + "\"" + (letter === c.letter ? " selected" : "") + ">"
      + esc(c.letter + " · " + c.header) + "</option>"
    ).join("");
    const sample = isConst
      ? ("常量：" + val.slice(10))
      : (col ? col.sample : "—");
    const sourceHint = phase === "loading" ? "…" : (
      isConst ? "<span class=\"tag muted\">常量</span>"
        : (col ? "<span class=\"src-pill\">" + esc(col.letter + " · " + col.header) + "</span>" : "<span class=\"opt\">未选</span>")
    );
    const title = f.label || FIELD_LABEL[id] || f.zh || id;
    const sourceTag = f.source === "manual"
      ? " <span class=\"opt\">按产品填</span>"
      : f.source === "calc"
        ? " <span class=\"opt\">计算得出</span>"
        : (req ? " <span class=\"req\">必填</span>" : " <span class=\"opt\">选填</span>");
    return "<tr>"
      + "<td><strong>" + esc(title) + "</strong>"
      + sourceTag
      + "<div class=\"mono\" style=\"color:var(--muted);margin-top:2px\">" + esc(judgeMode || !usingClassFields() ? ("standard." + id) : id) + "</div>"
      + (fieldUsers[id] ? "<div style=\"font-size:11px;color:var(--muted);margin-top:4px\">用于 " + esc(Object.keys(fieldUsers[id]).join("、")) + "</div>" : "")
      + (reason && phase !== "loading" ? "<div style=\"font-size:11px;color:var(--muted);margin-top:4px\">" + esc(reason) + "</div>" : "")
      + "</td>"
      + "<td>" + (phase === "loading"
        ? "<span class=\"opt\">识别中…</span>"
        : "<select class=\"" + selClass + "\" data-assign=\"" + esc(id) + "\">" + options + "</select>")
      + "</td>"
      + "<td>" + sourceHint + "</td>"
      + "<td class=\"sample\">" + esc(sample) + "</td>"
      + "</tr>";
  }).join("");

  return (state.mapError ? "<div class=\"banner warn\">" + esc(state.mapError) + "</div>" : "")
    + "<div class=\"upload-box has-file\" data-upload-pick>"
    + "<strong>" + esc(state.mapFile || book.file) + "</strong>"
    + "<span>工作表 " + esc(book.sheet) + " · 表头第 " + book.headerRow + " 行 · "
    + cols.length + " 列表头 · " + (book.rows || []).length + " 行"
    + (book.truncated ? "（文件更长，先载入前 300 行）" : "") + "</span>"
    + "<span style=\"margin-top:8px;color:var(--accent);font-weight:600\">点击再选一个文件</span></div>"
    + aiBar
    + "<div class=\"toolbar\" style=\"margin-bottom:12px\">"
    + "<div class=\"field\"><label>产品标准</label><select id=\"mapProdSel\">"
    + Object.keys(PRODUCTS).map((k) =>
      "<option value=\"" + k + "\"" + (state.product === k ? " selected" : "") + ">" + esc(PRODUCTS[k].label) + "</option>"
    ).join("")
    + "</select></div>"
    + "<div class=\"spacer\"></div>"
    + (phase !== "idle" ? "<button type=\"button\" class=\"btn\" data-map-reset>换一份文件</button>" : "")
    + "<button type=\"button\" class=\"btn\" data-ai-remap" + (phase === "loading" ? " disabled" : "") + ">重新识别</button>"
    + (phase === "confirmed"
      ? "<button type=\"button\" class=\"btn\" data-map-unlock>解锁修改</button>"
        + "<button type=\"button\" class=\"btn btn-primary\" data-calc-stage=\"1\">映射完成 · 开始计算 →</button>"
      : "<button type=\"button\" class=\"btn btn-primary\" data-map-confirm" + (requiredMiss || phase === "loading" ? " disabled" : "") + ">映射完成 · 开始计算</button>")
    + "</div>"
    + "<div class=\"panel\"><div class=\"panel-head\"><h2>" + (judgeMode ? "判定字段 ← 明细表头" : (neededIds.length && tableFields.length < mapTableFields().length ? "本模型要用的字段" : (usingClassFields() ? "分类 JSON 字段 ← 明细表头" : "标准字段 ← 明细表头"))) + "</h2>"
    + "<span>" + (usingClassFields() ? "只核对该模型要用的字段" : "一套标准 · 大模型先选 · 你可改") + "</span></div>"
    + "<div class=\"table-wrap\" style=\"max-height:420px\"><table class=\"data\"><thead><tr>"
    + "<th style=\"min-width:200px\">标准字段</th><th style=\"min-width:220px\">对应表头</th>"
    + "<th>来源</th><th>列中示例</th>"
    + "</tr></thead><tbody>" + rows + "</tbody></table></div></div>";
}
