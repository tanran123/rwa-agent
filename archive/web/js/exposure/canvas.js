/* 分类瀑布画布 */
function findExpNode(id) {
  if (String(id || "").indexOf("route:") === 0) {
    if (id === "route:base") {
      return { id: id, kind: "route", label: "通用流程模板", note: "各产品默认可引用 · 不在总览兜底", productKey: null };
    }
    if (id === "route:empty") {
      return { id: id, kind: "route", label: "暂无产品线路", note: "请先新建产品类型" };
    }
    const key = id.slice(6);
    const prod = PRODUCTS[key];
    const st = productExpStatus(key);
    return {
      id: id, kind: "route", label: prod ? prod.label : key,
      note: st.label, productKey: key,
      match: { all: [{ field: "product_type", op: "eq", value: prod ? prod.label : key }] }
    };
  }
  const overviewKey = overviewActiveProductKey();
  const cats = overviewKey
    ? categoriesFromFlow(flowForProductKey(overviewKey), overviewKey)
    : expCategories();
  if (state.expScope === "overview" && (id === "proc:start" || id === "proc:product")) {
    const __expHead = expHead();
    for (let i = 0; i < __expHead.length; i++) if (__expHead[i].id === id) return __expHead[i];
  }
  function findDrawn(nodes, parent) {
    for (let j = 0; j < (nodes || []).length; j++) {
      const node = nodes[j];
      if (node.id === id) {
        return Object.assign({
          kind: parent ? "subclass" : "category",
          parent: parent ? parent.id : undefined,
          parentLabel: parent ? parent.label : undefined,
          productKey: overviewKey || undefined
        }, node);
      }
      const hit = findDrawn(node.children, node);
      if (hit) return hit;
    }
    return null;
  }
  for (let i = 0; i < cats.length; i++) {
    const hit = findDrawn([cats[i]], null);
    if (hit) return hit;
  }
  if (id === "res:rw") {
    return {
      id: id, kind: "result", label: "风险权重",
      note: "暴露类别与原 RW", productKey: overviewKey || undefined
    };
  }
  if (id === "rule:hit") {
    return {
      id: id, kind: "rule", label: "RWA 计算",
      note: "表内、表外分别汇总", productKey: overviewKey || undefined
    };
  }
  const flowForChain = overviewKey
    ? flowForProductKey(overviewKey)
    : activeExpFlow();
  const bookHit = chainOf(flowForChain, "books").find((s) => s.id === id);
  if (bookHit) {
    return Object.assign({
      productKey: overviewKey || undefined,
      note: bookHit.note || ""
    }, bookHit);
  }
  const tailHit = chainOf(flowForChain, "tail").find((s) => s.id === id);
  if (tailHit) {
    return Object.assign({
      productKey: overviewKey || undefined,
      note: tailHit.note || ""
    }, tailHit);
  }
  return null;
}

function resolveExpFocus() {
  const overviewKey = overviewActiveProductKey();
  const cats = overviewKey
    ? categoriesFromFlow(flowForProductKey(overviewKey), overviewKey)
    : expCategories();
  return resolveFocusForCategories(cats);
}

/** 总览：整棵分类树一次铺开，不按「当前命中」收起其它分支 */
function buildGlobalGraph(categories) {
  const cats = categories || expCategories();
  const nodes = [];
  const edges = [];
  const COL = 300;
  const ROW = 96;
  const SIB_GAP = 10;
  const NODE_W = 232;
  const NODE_H = 74;

  function blockOf(node) {
    const kids = node.children || [];
    if (!kids.length) return ROW;
    let sum = 0;
    kids.forEach(function (kid, i) {
      sum += blockOf(kid);
      if (i < kids.length - 1) sum += SIB_GAP;
    });
    return Math.max(sum, ROW);
  }

  function place(list, depth, parentId, yTop) {
    let y = yTop;
    list.forEach(function (item, idx) {
      const kids = item.children || [];
      const block = blockOf(item);
      const leaf = !kids.length;
      const role = item.role || "";
      const step = role === "crm" || role === "assessment";
      const weight = leaf && item.rw && item.rw !== "—" ? item.rw : "";
      const note = leaf
        ? ((step ? (item.otherwise ? "本层都不成立" : "") : ((item.otherwise ? "本层都不成立" : "") + (weight ? ((item.otherwise ? " · " : "") + weight) : ""))))
        : (item.summary || ((item.otherwise ? "本层都不成立 · " : "") + kids.length + " 个下级"));
      const badge = role === "crm"
        ? "缓释"
        : (role === "assessment" ? "取值" : (depth === 0 ? "分类" : (leaf ? "权重" : "细分")));
      nodes.push({
        id: item.id,
        kind: depth === 0 ? "category" : "subclass",
        badge: badge,
        role: role || undefined,
        pill: (leaf && step) ? weight : "",
        label: depth === 0 ? ((idx + 1) + ". " + item.label) : item.label,
        note: note,
        x: 36 + depth * COL,
        y: y + (block - NODE_H) / 2,
        w: NODE_W,
        h: NODE_H,
        parent: parentId || undefined,
        compact: true,
        globalNode: true
      });
      if (parentId) {
        edges.push({
          from: parentId,
          to: item.id,
          label: item.otherwise ? "都不成立" : (idx === 0 ? "是" : ""),
          flow: true,
          yesPath: !item.otherwise,
          noPath: !!item.otherwise
        });
      }
      if (kids.length) place(kids, depth + 1, item.id, y);
      y += block;
      if (idx < list.length - 1) y += SIB_GAP;
    });
  }

  place(cats, 0, null, 20);
  for (let i = 1; i < cats.length; i++) {
    const side = cats[i].role === "crm" || cats[i].role === "assessment";
    edges.push({
      from: cats[i - 1].id,
      to: cats[i].id,
      label: cats[i].otherwise ? "都不成立" : (side ? "另计" : "否，继续"),
      flow: !side && !cats[i].otherwise,
      noPath: !!cats[i].otherwise || !side
    });
  }
  return { nodes: nodes, edges: edges, focusIdx: 0, global: true };
}

function buildExpGraph() {
  const nodes = [];
  const edges = [];
  const focus = resolveExpFocus();
  const focusIdx = focus.focusIdx;
  const hitSubclassId = focus.hitSubclassId;
  const NODE_W = 210;
  const cats = expCategories();
  const anchorY = 36;
  const x = 40;
  if (state.selectedExposure === "proc:start" || state.selectedExposure === "proc:product") {
    state.selectedExposure = (cats[0] && cats[0].id) || "";
  }

  appendWaterfallByLevel(nodes, edges, {
    cats: cats,
    focusIdx: focusIdx,
    hitSubclassId: hitSubclassId,
    startX: x,
    anchorY: anchorY,
    prevId: null,
    nodeW: NODE_W,
    flow: activeExpFlow()
  });

  return { nodes: nodes, edges: edges, focusIdx: focusIdx };
}

function pageExposure() {
  const keys = productKeys();
  if (state.expScope !== "base") state.expScope = "product";
  if (!PRODUCTS[state.product] && keys[0]) state.product = keys[0];
  const sel = state.expNodePopover ? findExpNode(state.selectedExposure) : null;
  const isBase = state.expScope === "base";
  const isProduct = state.expScope === "product" && !!PRODUCTS[state.product];
  const prod = PRODUCTS[state.product];
  const status = isProduct ? productExpStatus(state.product) : null;
  const productSkips = isProduct ? productSkipIds(state.product) : [];
  const scopeLabel = isBase ? "通用流程模板" : ((prod ? prod.label : "产品") + (productSkips.length ? " · 同一套分类，已去掉不适用分支" : " · 同一套分类"));
  const referencing = isProduct && status && status.ref;

  const nav = "<div class=\"exp-nav-sec\">产品</div>"
    + (keys.length ? keys.map((k, idx) => {
      const active = isProduct && state.product === k;
      const skips = productSkipIds(k);
      return "<button type=\"button\" class=\"exp-nav-item" + (active ? " active" : "") + "\" data-exp-scope=\"product\" data-product=\"" + esc(k) + "\">"
        + "<span class=\"tw\">" + (idx + 1) + "</span><span class=\"nav-main\">" + esc(PRODUCTS[k].label)
        + "<span class=\"meta\">" + esc(skips.length ? "同一套分类 · 已跳过不适用" : "同一套分类") + "</span></span></button>";
    }).join("") : "<div class=\"banner\" style=\"margin:8px\">暂无产品线路。请先到「产品标准字段」新建类型。</div>")
    + "<div class=\"exp-nav-foot\">"
    + "<button type=\"button\" class=\"btn\" style=\"width:100%\" data-exp-new-type>＋ 新建产品类型</button>"
    + "</div>";

  const headActions = isBase
    ? ("<button type=\"button\" class=\"btn\" data-exp-tab=\"routes\">← 回分类判定</button>"
      + "<button type=\"button\" class=\"btn btn-primary\" data-exp-flow-modal=\"base\" data-exp-flow-mode=\"edit\">编辑通用流程 JSON</button>"
      + "<button type=\"button\" class=\"btn\" data-exp-flow-modal=\"base\" data-exp-flow-mode=\"view\">查看流程 JSON</button>"
      + "<button type=\"button\" class=\"btn\" data-exp-demo=\"defaulted\">演示：已违约</button>"
      + "<button type=\"button\" class=\"btn\" data-exp-demo=\"fi\">演示：金融机构</button>"
      + "<button type=\"button\" class=\"btn\" data-exp-demo=\"corporate_general\">演示：公司</button>"
      + "<button type=\"button\" class=\"btn\" data-exp-add>在选中节点下加下级</button>")
    : ((isProduct ? "<button type=\"button\" class=\"btn btn-primary\" data-exp-flow-modal=\"product\" data-product=\"" + esc(state.product) + "\" data-exp-flow-mode=\"edit\">编辑流程 JSON</button>" : "")
      + (isProduct ? "<button type=\"button\" class=\"btn\" data-exp-flow-modal=\"product\" data-product=\"" + esc(state.product) + "\" data-exp-flow-mode=\"view\">查看流程 JSON</button>" : "")
      + "<button type=\"button\" class=\"btn\" data-exp-demo=\"defaulted\">演示：已违约</button>"
      + "<button type=\"button\" class=\"btn\" data-exp-demo=\"fi\">演示：金融机构</button>"
      + "<button type=\"button\" class=\"btn\" data-exp-demo=\"corporate_general\">演示：公司</button>"
      + "<button type=\"button\" class=\"btn\" data-exp-add" + (referencing ? " title=\"将生成产品流程副本\"" : "") + ">在选中节点下加下级</button>"
      + (isProduct ? "<button type=\"button\" class=\"btn\" data-exp-reset-template>恢复引用通用流程</button>" : "")
      + (referencing ? "<button type=\"button\" class=\"btn\" data-exp-fork>生成本产品副本</button>" : ""));

  const expTabs = "<div class=\"exp-tabs\" role=\"tablist\" aria-label=\"分类判断视图\">"
    + "<button type=\"button\" role=\"tab\" class=\"exp-tab" + (!isBase ? " active" : "") + "\" data-exp-tab=\"routes\" aria-selected=\"" + (!isBase ? "true" : "false") + "\">分类判定</button>"
    + "<button type=\"button\" role=\"tab\" class=\"exp-tab" + (isBase ? " active" : "") + "\" data-exp-tab=\"base\" aria-selected=\"" + (isBase ? "true" : "false") + "\">通用流程模板</button>"
    + "</div>";

  return ph("exposure", "<div class=\"head-actions\">" + headActions + "</div>")
    + (state.expFlowModal ? renderExpFlowModal() : "")
    + (state.expTypeModal && state.typeGenPhase !== "loading" ? renderTypeCreateModal() : "")
    + "<div class=\"exp-shell\">"
    + "<div class=\"exp-toolbar\">"
    + expTabs
    + "<button type=\"button\" class=\"btn\" data-exp-zoom=\"-\">−</button>"
    + "<button type=\"button\" class=\"btn\" data-exp-zoom=\"+\">+</button>"
    + "<button type=\"button\" class=\"btn\" data-exp-zoom=\"1\">重置视图</button>"
    + "<span class=\"exp-legend\">"
    + ("<span><i style=\"background:#e8f3ef\"></i>表内线</span>"
        + "<span><i style=\"background:#e0f2fe\"></i>表外线</span>"
        + "<span><i style=\"background:#f8fafc\"></i>已否决</span>"
        + "<span><i style=\"background:#e8f3ef\"></i>本层命中</span>"
        + "<span><i style=\"background:#fff\"></i>右列细分</span>"
        + "<span><i style=\"background:#d9f7e7\"></i>风险权重</span>"
        + "<span><i style=\"background:#ede9fe\"></i>缓释拆分</span>"
        + "<span><i style=\"background:#e0f2fe\"></i>评级取值</span>"
        + "<span><i style=\"background:#fff1d6\"></i>RWA</span>"
        + "<span><i style=\"background:#f0fdf6\"></i>结果依据</span>")
    + "</span>"
    + (isBase ? "<button type=\"button\" class=\"btn\" data-exp-flow-modal=\"base\" data-exp-flow-mode=\"view\">查看 JSON</button>"
      + "<button type=\"button\" class=\"btn btn-primary\" data-exp-flow-modal=\"base\" data-exp-flow-mode=\"edit\">编辑 JSON</button>" : "")
    + "<span class=\"hint\">" + esc(scopeLabel)
    + " · 按宽度铺开，往下拖可看后面的分支</span>"
    + "<span class=\"tag muted\" id=\"expZoomLabel\">" + Math.round(state.expZoom * 100) + "%</span>"
    + "</div>"
    + "<nav class=\"exp-nav\" aria-label=\"线路导航\"><h3>线路</h3>"
    + "<p style=\"padding:0 12px 8px;margin:0;font-size:11px;color:var(--muted)\">"
    + (isBase ? "这是各产品的底稿，分支都在。产品只去掉不适用的" : "每个产品都基于这套模板，只去掉它不适用的分支") + "</p>"
    + nav + "</nav>"
    + "<div class=\"exp-stage\" id=\"expStage\">"
    + renderExpTypeGenBanner()
    + "<div class=\"exp-world\" id=\"expWorld\" style=\"transform:translate(" + state.expPan.x + "px," + state.expPan.y + "px) scale(" + state.expZoom + ")\">"
    + "<svg id=\"expSvg\"></svg>"
    + "<div id=\"expNodes\"></div></div></div>"
    + renderExpNodePopover(sel)
    + "</div>";
}

function applyExpTransform() {
  const world = document.getElementById("expWorld");
  const label = document.getElementById("expZoomLabel");
  if (world) {
    world.style.transform = "translate(" + state.expPan.x + "px," + state.expPan.y + "px) scale(" + state.expZoom + ")";
  }
  if (label) label.textContent = Math.round(state.expZoom * 100) + "%";
}

/** 只在打开总览或刚展开一条产品时居中；点单个节点不再把整图拽过来 */
function centerExpOnFocus(model, byId) {
  const stage = document.getElementById("expStage");
  if (!stage || !model || !byId) return;
  if (model.global) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    (model.nodes || []).forEach(function (n) {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + (n.w || 220));
      maxY = Math.max(maxY, n.y + (n.h || 56));
    });
    if (!isFinite(minX)) return;
    const viewW = Math.max(240, stage.clientWidth);
    const treeW = Math.max(1, maxX - minX);
    const fitW = (viewW - 28) / treeW;
    // 按高度适配会缩成左边一条。铺满宽度，从顶部看起，往下拖看其余分支。
    state.expZoom = Math.max(0.42, Math.min(1.05, fitW));
    state.expPan = {
      x: Math.round(12 - minX * state.expZoom),
      y: Math.round(12 - minY * state.expZoom)
    };
    applyExpTransform();
    return;
  }
  const selected = state.selectedExposure;
  const focusIds = {};
  const activeKey = model.activeProduct || overviewActiveProductKey();

  if (model.overview && !activeKey) {
    (model.nodes || []).forEach((n) => {
      if (n.kind === "process" || n.kind === "route") focusIds[n.id] = true;
    });
  } else if (selected && byId[selected]) {
    focusIds[selected] = true;
    const picked = byId[selected];
    if (picked.parent && byId[picked.parent]) focusIds[picked.parent] = true;
    if (activeKey && byId["route:" + activeKey]) focusIds["route:" + activeKey] = true;
  } else {
    const hit = (model.nodes || []).filter((n) => n.gateStatus === "gate-hit")[0];
    if (hit) focusIds[hit.id] = true;
    else if (model.nodes && model.nodes[0]) focusIds[model.nodes[0].id] = true;
  }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let count = 0;
  Object.keys(focusIds).forEach((id) => {
    const n = byId[id];
    if (!n) return;
    const h = n.h || 72;
    const w = n.w || 200;
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + w);
    maxY = Math.max(maxY, n.y + h);
    count += 1;
  });
  if (!count || !isFinite(minX)) {
    const n = byId[selected] || (model.nodes && model.nodes[0]);
    if (!n) return;
    minX = n.x; minY = n.y;
    maxX = n.x + (n.w || 200); maxY = n.y + (n.h || 72);
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const viewW = Math.max(240, stage.clientWidth);
  const viewH = Math.max(200, stage.clientHeight);
  const z = state.expZoom || 1;
  state.expPan = {
    x: Math.round(viewW / 2 - cx * z),
    y: Math.round(viewH / 2 - cy * z)
  };
  applyExpTransform();
}

/** 节点已在视口里就不动；只有被挡住时才平移刚好露出它 */
function nudgeExpNodeIntoView(id, byId) {
  const stage = document.getElementById("expStage");
  const n = id && byId ? byId[id] : null;
  if (!stage || !n) {
    applyExpTransform();
    return;
  }
  const z = state.expZoom || 1;
  const pad = 28;
  const viewL = pad;
  const viewT = pad;
  const viewR = Math.max(viewL + 80, stage.clientWidth - pad);
  const viewB = Math.max(viewT + 80, stage.clientHeight - pad);
  const left = state.expPan.x + n.x * z;
  const top = state.expPan.y + n.y * z;
  const right = state.expPan.x + (n.x + (n.w || 200)) * z;
  const bottom = state.expPan.y + (n.y + (n.h || 72)) * z;
  let dx = 0;
  let dy = 0;
  if (left < viewL) dx = viewL - left;
  else if (right > viewR) dx = viewR - right;
  if (top < viewT) dy = viewT - top;
  else if (bottom > viewB) dy = viewB - bottom;
  if (dx || dy) {
    state.expPan = {
      x: Math.round(state.expPan.x + dx),
      y: Math.round(state.expPan.y + dy)
    };
  }
  applyExpTransform();
}

function classDocCategories() {
  const doc = window.Store && Store.currentRuleset && Store.currentRuleset();
  if (!doc || !Array.isArray(doc.rules) || typeof rulesDocToFlow !== "function") return [];
  const flow = rulesDocToFlow(doc);
  return (flow.categories || []).map(normalizeExpCategory);
}

function paintClassWaterfall() {
  if (state.page !== "generic") return;
  paintExpGraph(buildGlobalGraph(classDocCategories()));
}

function paintExpGraph(modelOverride) {
  const stage = document.getElementById("expStage");
  const world = document.getElementById("expWorld");
  const nodesEl = document.getElementById("expNodes");
  const svg = document.getElementById("expSvg");
  if (!stage || !world || !nodesEl || !svg) return;
  const parkedTip = document.getElementById("expRouteTip");
  if (parkedTip) parkedTip.style.display = "none";

  const model = modelOverride || buildGlobalGraph();
  const byId = {};
  model.nodes.forEach((n) => { byId[n.id] = n; });

  const selected = state.selectedExposure;
  const related = {};
  if (model.global) {
    model.nodes.forEach(function (n) { related[n.id] = true; });
  } else if (model.overview) {
    related["proc:start"] = true;
    related["proc:product"] = true;
    const activeKey = model.activeProduct || overviewActiveProductKey();
    const selRoute = activeKey ? ("route:" + activeKey) : null;
    if (selRoute) {
      related[selRoute] = true;
      model.nodes.forEach((n) => {
        if (!n.overviewBranch) return;
        if (n.kind === "category" && n.gateStatus === "gate-pending") return;
        related[n.id] = true;
      });
    } else {
      model.nodes.forEach((n) => {
        if (n.kind === "process" || n.kind === "route") related[n.id] = true;
      });
    }
  } else {
    expHead().forEach((p) => { related[p.id] = true; });
    model.nodes.forEach((n) => {
      if (n.kind === "category" && n.gateStatus !== "gate-pending") related[n.id] = true;
      if (n.kind === "subclass" || n.kind === "rule" || n.kind === "result"
        || n.kind === "onbook" || n.kind === "ccf" || n.kind === "crm") related[n.id] = true;
    });
  }
  related[selected] = true;

  nodesEl.innerHTML = model.nodes.map((n) => {
    const dim = n.gateStatus === "gate-pending" ? " dim" : (!related[n.id] ? " dim" : "");
    const sel = n.id === selected ? " selected" : "";
    const gateCls = n.gateStatus ? " " + n.gateStatus : "";
    const gapKey = n.productKey || (model.overview ? model.activeProduct : state.product);
    let missing = [];
    if ((n.kind === "category" || n.kind === "subclass") && !model.global && !n.globalNode) {
      missing = missingFieldsForExpNode(n.id, gapKey);
    } else if (n.kind === "route" && n.productKey) {
      const flow = flowForProductKey(n.productKey);
      const listed = (flow && flow.field_gaps) || [];
      if (listed.length) {
        missing = listed.reduce((acc, g) => acc.concat(g.missing_fields || []), []);
      } else {
        // 尚未生成标注时，现场对照通用模板与产品字段
        const classAllow = {};
        (productClassIds(n.productKey) || []).forEach(function (id) { classAllow[id] = true; });
        const scoped = productClassIds(n.productKey);
        (flow.categories || BASE_EXP_TEMPLATE.categories || []).forEach((cat) => {
          if (scoped && !classAllow[cat.id]) return;
          missing = missing.concat(missingFieldsForExpNode(cat.id, n.productKey));
          (cat.children || []).forEach((ch) => {
            missing = missing.concat(missingFieldsForExpNode(ch.id, n.productKey));
          });
        });
      }
      missing = Array.from(new Set(missing));
    }
    const hasGap = missing.length > 0;
    const kindLabel = n.badge || {
      process: "起点",
      category: n.gateStatus === "gate-hit" ? "本层命中" : n.gateStatus === "gate-pass" ? "已否决" : "待判定",
      subclass: "细分",
      rule: n.id === "step:route" ? "路由" : (n.id === "step:rwa" ? "RWA" : "计算"),
      result: n.id === "step:out" ? "结果" : "权重",
      route: "产品线路",
      onbook: "表内",
      ccf: "表外",
      crm: "缓释"
    }[n.kind] || n.kind;
    const rwMatch = n.kind === "subclass" && !n.pill && n.note ? String(n.note).match(/RW\s*([^·]+)/) : null;
    const noteText = n.pill ? (n.note || "") : (rwMatch ? String(n.note).replace(/^RW\s*[^·]+·\s*/, "") : n.note);
    const pillText = n.pill || (rwMatch ? ("RW " + rwMatch[1].trim()) : "");
    const classNames = n.classes || [];
    const isRouteCard = n.kind === "route" && classNames.length > 0;
    const gapShown = missing.slice(0, 6).join("、") + (missing.length > 6 ? (" 等 " + missing.length + " 个") : "");
    const gapTip = hasGap ? ("字段未对齐：" + gapShown) : "";
    const classHtml = classNames.map(function (name) {
      return "<span class=\"exp-class\">" + esc(name) + "</span>";
    }).join("");
    const routeTip = isRouteCard
      ? ("<div class=\"exp-tip\">"
        + "<div class=\"exp-tip-k\">大类 · " + classNames.length + "</div>"
        + "<span class=\"exp-classes\">" + classHtml + "</span>"
        + (noteText ? "<div class=\"exp-tip-meta\">" + esc(noteText) + "</div>" : "")
        + (hasGap ? "<div class=\"exp-tip-gap\">缺字段 " + esc(gapShown) + "</div>" : "")
        + "</div>")
      : "";
    const roleCls = n.role === "crm" ? " role-crm" : (n.role === "assessment" ? " role-assess" : "");
    return "<div class=\"exp-node " + esc(n.kind) + roleCls + (n.compact ? " compact" : "") + gateCls + sel + dim + (hasGap ? " has-gap" : "")
      + "\" data-exp-sel=\"" + esc(n.id) + "\" data-id=\"" + esc(n.id) + "\" style=\"left:"
      + n.x + "px;top:" + n.y + "px;width:" + (n.w || 210) + "px\">"
      + (hasGap
        ? ("<span class=\"exp-warn-icon\" title=\"" + esc(gapTip) + "\" aria-label=\"" + esc(gapTip) + "\">!</span>")
        : "")
      + "<span class=\"exp-badge\">" + esc(kindLabel) + "</span>"
      + "<span class=\"exp-label\">" + esc(n.label) + "</span>"
      + (isRouteCard
        ? "<span class=\"exp-note\">" + classNames.length + " 个大类</span>"
        : (classHtml ? "<span class=\"exp-classes\">" + classHtml + "</span>" : ""))
      + (isRouteCard ? "" : (noteText ? "<span class=\"exp-note\">" + esc(noteText) + "</span>" : ""))
      + (pillText ? "<span class=\"exp-rw\">" + esc(pillText) + "</span>" : "")
      + routeTip
      + "</div>";
  }).join("");

  // 用真实渲染高度校正连线锚点，避免卡片内容撑高后仍按估算高度重叠
  Array.prototype.forEach.call(nodesEl.querySelectorAll(".exp-node"), (el) => {
    const id = el.getAttribute("data-id");
    const n = byId[id];
    if (!n) return;
    n.h = Math.max(n.h || 0, Math.ceil(el.offsetHeight));
    n.w = Math.max(n.w || 0, Math.ceil(el.offsetWidth));
  });

  let maxX = 1100, maxY = 700;
  model.nodes.forEach((n) => {
    maxX = Math.max(maxX, n.x + n.w + 120);
    maxY = Math.max(maxY, n.y + (n.h || 64) + 120);
  });
  svg.setAttribute("width", maxX);
  svg.setAttribute("height", maxY);
  svg.style.width = maxX + "px";
  svg.style.height = maxY + "px";

  const anchor = (n, toward) => {
    const nh = n.h || 64;
    const cx = n.x + n.w / 2;
    const cy = n.y + nh / 2;
    const dx = toward.x + toward.w / 2 - cx;
    const dy = toward.y + (toward.h || 64) / 2 - cy;
    if (Math.abs(dx) > Math.abs(dy)) {
      return dx > 0
        ? { x: n.x + n.w, y: cy }
        : { x: n.x, y: cy };
    }
    return dy > 0
      ? { x: cx, y: n.y + nh }
      : { x: cx, y: n.y };
  };

  // 总览产品分线：主轴向右，竖总线后水平接入各产品（避免多条折线重叠）
  let routeFanHtml = "";
  if (model.overview) {
    const routeEdges = model.edges.filter((e) => e.routeEdge);
    const parent = byId["proc:product"];
    const children = routeEdges.map((e) => byId[e.to]).filter(Boolean);
    if (parent && children.length) {
      const activeKey = model.activeProduct || overviewActiveProductKey();
      const selRoute = activeKey ? ("route:" + activeKey) : null;
      const pRight = parent.x + parent.w;
      const pCy = parent.y + (parent.h || 64) / 2;
      const busX = pRight + Math.max(28, Math.round((children[0].x - pRight) * 0.45));
      const ys = children.map((c) => c.y + (c.h || 64) / 2).sort((a, b) => a - b);
      const busTop = ys[0];
      const busBottom = ys[ys.length - 1];
      const trunkCls = "route-trunk flow";
      const busCls = "route-bus flow";
      routeFanHtml += "<path class=\"" + trunkCls + "\" d=\"M" + pRight + "," + pCy + " L" + busX + "," + pCy + "\" style=\"marker-end:none\"></path>";
      if (busBottom > busTop) {
        routeFanHtml += "<path class=\"" + busCls + "\" d=\"M" + busX + "," + busTop + " L" + busX + "," + busBottom + "\" style=\"marker-end:none\"></path>";
      }
      routeFanHtml += "<text x=\"" + busX + "\" y=\"" + (busTop - 12) + "\" text-anchor=\"middle\">分线</text>";
      children.forEach((c) => {
        const cy = c.y + (c.h || 64) / 2;
        const left = c.x;
        const on = !selRoute || c.id === selRoute;
        const cls = "route-drop" + (on ? " flow" : " dim");
        const marker = on ? "url(#expArrowFlow)" : "url(#expArrow)";
        routeFanHtml += "<path class=\"" + cls + "\" d=\"M" + busX + "," + cy + " L" + left + "," + cy + "\" style=\"marker-end:" + marker + "\"></path>";
      });
    }
  }

  const paths = model.edges.map((e) => {
    if (model.overview && e.routeEdge) return ""; // 已由 routeFanHtml 统一绘制
    const a = byId[e.from], b = byId[e.to];
    if (!a || !b) return "";
    const p1 = anchor(a, b);
    const p2 = anchor(b, a);
    let mx = (p1.x + p2.x) / 2;
    let my = (p1.y + p2.y) / 2;
    let d;
    if (e.fanOut) {
      const outX = a.x + a.w;
      const outY = a.y + (a.h || 64) / 2;
      const inX = b.x;
      const inY = b.y + (b.h || 64) / 2;
      const stubX = outX + 40;
      mx = stubX + 10;
      my = inY - 10;
      d = "M" + outX + "," + outY + " L" + stubX + "," + outY + " L" + stubX + "," + inY + " L" + inX + "," + inY;
    } else if (Math.abs(p1.y - p2.y) < 8) {
      d = "M" + p1.x + "," + p1.y + " L" + p2.x + "," + p2.y;
    } else if (Math.abs(p1.x - p2.x) < 8) {
      d = "M" + p1.x + "," + p1.y + " L" + p2.x + "," + p2.y;
    } else {
      d = "M" + p1.x + "," + p1.y + " L" + mx + "," + p1.y + " L" + mx + "," + p2.y + " L" + p2.x + "," + p2.y;
    }
    const fromOk = related[e.from] || (byId[e.from] && byId[e.from].gateStatus !== "gate-pending");
    const toOk = related[e.to] || (byId[e.to] && byId[e.to].gateStatus !== "gate-pending");
    let onPath = !!(fromOk && toOk);
    if (model.overview && e.overviewBranch) {
      onPath = !!(related[e.from] && related[e.to]);
    }
    const dim = onPath ? "" : " dim";
    const flow = (e.flow || e.yesPath) && onPath ? " flow" : "";
    const noPath = e.noPath ? " no-path" : "";
    const yesPath = e.yesPath ? " yes-path" : "";
    const marker = (e.flow || e.yesPath) && onPath ? "url(#expArrowFlow)" : "url(#expArrow)";
    const label = (e.label && onPath)
      ? "<text x=\"" + mx + "\" y=\"" + (e.fanOut ? (my - 4) : (my - 8)) + "\" text-anchor=\"" + (e.fanOut ? "start" : "middle") + "\">" + esc(e.label) + "</text>"
      : "";
    return "<path class=\"" + flow + noPath + yesPath + dim + "\" d=\"" + d + "\" style=\"marker-end:" + marker + "\"></path>" + label;
  }).join("");
  svg.innerHTML = "<defs><marker id=\"expArrow\" markerWidth=\"8\" markerHeight=\"8\" refX=\"6\" refY=\"3\" orient=\"auto\">"
    + "<path d=\"M0,0 L6,3 L0,6 Z\" fill=\"#94a3b8\"></path></marker>"
    + "<marker id=\"expArrowFlow\" markerWidth=\"8\" markerHeight=\"8\" refX=\"6\" refY=\"3\" orient=\"auto\">"
    + "<path d=\"M0,0 L6,3 L0,6 Z\" fill=\"#1a5f4a\"></path></marker></defs>"
    + routeFanHtml + paths;

  if (state.expCenterPending) {
    state.expCenterPending = false;
    state.expEnsureVisible = "";
    centerExpOnFocus(model, byId);
  } else if (state.expEnsureVisible) {
    const visibleId = state.expEnsureVisible;
    state.expEnsureVisible = "";
    nudgeExpNodeIntoView(visibleId, byId);
  } else {
    applyExpTransform();
  }
  bindExpCanvas();
}

function bindExpCanvas() {
  const stage = document.getElementById("expStage");
  const world = document.getElementById("expWorld");
  if (!stage || !world || stage._expBound) return;
  stage._expBound = true;
  let dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;
  stage.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".exp-node") || e.target.closest("button")) return;
    dragging = true;
    world.classList.add("dragging");
    sx = e.clientX; sy = e.clientY;
    ox = state.expPan.x; oy = state.expPan.y;
    stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    state.expPan = { x: ox + (e.clientX - sx), y: oy + (e.clientY - sy) };
    applyExpTransform();
  });
  stage.addEventListener("pointerup", () => {
    dragging = false;
    world.classList.remove("dragging");
  });
  stage.addEventListener("wheel", (e) => {
    e.preventDefault();
    const rect = stage.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const prev = state.expZoom;
    const factor = e.deltaY < 0 ? 1.08 : 1 / 1.08;
    const next = Math.max(0.08, Math.min(2.2, prev * factor));
    // 以鼠标位置为中心缩放
    state.expPan = {
      x: mx - (mx - state.expPan.x) * (next / prev),
      y: my - (my - state.expPan.y) * (next / prev)
    };
    state.expZoom = next;
    applyExpTransform();
  }, { passive: false });
}
