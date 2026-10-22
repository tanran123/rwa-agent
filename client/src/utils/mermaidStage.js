function readTranslate(g) {
  const t = g.getAttribute("transform") || "";
  const m = /translate\(\s*([-\d.]+)[ ,]+([-\d.]+)\s*\)/.exec(t);
  return m ? { x: parseFloat(m[1]), y: parseFloat(m[2]) } : { x: 0, y: 0 };
}

function nodeBoxRoot(g) {
  const shape = g.querySelector("rect,circle,polygon,ellipse,path");
  const svg = g.ownerSVGElement;
  if (!shape || !svg) return { cx: 0, cy: 0, w: 0, h: 0 };
  const bb = shape.getBBox();
  const m = shape.getScreenCTM();
  const inv = svg.getScreenCTM().inverse();
  if (!m || !inv) return { cx: 0, cy: 0, w: bb.width, h: bb.height };
  const pt = (x, y) => {
    const q = svg.createSVGPoint();
    q.x = x;
    q.y = y;
    const r = q.matrixTransform(m).matrixTransform(inv);
    return { x: r.x, y: r.y };
  };
  const a = pt(bb.x, bb.y);
  const b = pt(bb.x + bb.width, bb.y + bb.height);
  const x1 = Math.min(a.x, b.x);
  const x2 = Math.max(a.x, b.x);
  const y1 = Math.min(a.y, b.y);
  const y2 = Math.max(a.y, b.y);
  return { cx: (x1 + x2) / 2, cy: (y1 + y2) / 2, w: x2 - x1, h: y2 - y1 };
}

function boxCenter(n) {
  return { x: n.x + n.dcx, y: n.y + n.dcy };
}

function anchorAt(n, fx, fy) {
  const c = boxCenter(n);
  return { x: c.x + fx * (n.w || 0), y: c.y + fy * (n.h || 0) };
}

export function mountMermaidStage(canvas, stage, graph, onQuietClick) {
  const NODES = new Map();
  const EDGES = [];
  let z = 1;
  let tx = 0;
  let ty = 0;
  let pan = null;
  let nd = null;

  function svgEl() {
    return graph.querySelector("svg");
  }

  function keyOf(n) {
    for (const [k, v] of NODES) if (v === n) return k;
    return null;
  }

  function routeEdge(e) {
    const s = NODES.get(e.src);
    const d = NODES.get(e.dst);
    if (!s || !d) return;
    const a = anchorAt(s, e.sFx, e.sFy);
    const b = anchorAt(d, e.dFx, e.dFy);
    const sHoriz = Math.abs(e.sFx) >= Math.abs(e.sFy);
    const dHoriz = Math.abs(e.dFx) >= Math.abs(e.dFy);
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const k = Math.max(20, Math.min(110, dist * 0.42));
    let c1;
    let c2;
    if (sHoriz) {
      const dir = e.sFx >= 0 ? 1 : -1;
      c1 = { x: a.x + dir * k, y: a.y };
    } else {
      const dir = e.sFy >= 0 ? 1 : -1;
      c1 = { x: a.x, y: a.y + dir * k };
    }
    if (dHoriz) {
      const dir = e.dFx >= 0 ? 1 : -1;
      c2 = { x: b.x + dir * k, y: b.y };
    } else {
      const dir = e.dFy >= 0 ? 1 : -1;
      c2 = { x: b.x, y: b.y + dir * k };
    }
    e.path.setAttribute("d", "M" + a.x + "," + a.y + "C" + c1.x + "," + c1.y + " " + c2.x + "," + c2.y + " " + b.x + "," + b.y);
    if (e.label) {
      const mx = (a.x + 3 * c1.x + 3 * c2.x + b.x) / 8;
      const my = (a.y + 3 * c1.y + 3 * c2.y + b.y) / 8;
      e.label.setAttribute("transform", "translate(" + mx + ", " + my + ")");
    }
  }

  function registerGraph() {
    const svg = svgEl();
    if (!svg) return;
    svg.querySelectorAll("g.node").forEach((g) => {
      const id = g.getAttribute("data-id") || g.id;
      const p = readTranslate(g);
      const box = nodeBoxRoot(g);
      NODES.set(id, {
        g,
        x: p.x,
        y: p.y,
        ox: p.x,
        oy: p.y,
        w: box.w,
        h: box.h,
        dcx: box.cx - p.x,
        dcy: box.cy - p.y
      });
    });
    const paths = svg.querySelectorAll("g.edgePaths > path");
    const labels = svg.querySelectorAll("g.edgeLabels > g.edgeLabel");
    paths.forEach((p) => {
      const id = p.getAttribute("id") || "";
      let src = null;
      let dst = null;
      const m = /^L-(.+)-(\d+)$/.exec(id);
      if (m) {
        const body = m[1];
        for (const cand of NODES.keys()) {
          if (body === cand) continue;
          if (body.startsWith(cand + "-")) {
            const rest = body.slice(cand.length + 1);
            if (NODES.has(rest)) {
              src = cand;
              dst = rest;
              break;
            }
          }
        }
      }
      if (!src || !dst) {
        const cls = p.getAttribute("class") || "";
        const a = /\bLS-(\S+)/.exec(cls);
        const b = /\bLE-(\S+)/.exec(cls);
        if (a && b) {
          src = a[1];
          dst = b[1];
        }
      }
      if (!src || !dst || !NODES.has(src) || !NODES.has(dst)) return;
      const nums = (p.getAttribute("d") || "").match(/-?[\d.]+(?:e[-+]?\d+)?/gi);
      if (!nums || nums.length < 4) return;
      const px = nums.map(Number);
      const sN = NODES.get(src);
      const dN = NODES.get(dst);
      const sC = boxCenter(sN);
      const dC = boxCenter(dN);
      EDGES.push({
        path: p,
        label: null,
        src,
        dst,
        sFx: (px[0] - sC.x) / (sN.w || 1),
        sFy: (px[1] - sC.y) / (sN.h || 1),
        dFx: (px[px.length - 2] - dC.x) / (dN.w || 1),
        dFy: (px[px.length - 1] - dC.y) / (dN.h || 1)
      });
    });
    labels.forEach((l, i) => {
      if (EDGES[i]) EDGES[i].label = l;
    });
    EDGES.forEach(routeEdge);
  }

  function apply() {
    stage.style.transform = "translate(" + tx + "px, " + ty + "px) scale(" + z + ")";
  }

  function stageOrigin() {
    const style = window.getComputedStyle(canvas);
    return {
      x: parseFloat(style.paddingLeft) || 0,
      y: parseFloat(style.paddingTop) || 0
    };
  }

  function revealBox(node, anchor) {
    if (!node) return;
    const cr = canvas.getBoundingClientRect();
    const rr = node.getBoundingClientRect();
    if (anchor === "center") {
      tx += cr.left + cr.width / 2 - (rr.left + rr.width / 2);
      ty += cr.top + cr.height / 2 - (rr.top + rr.height / 2);
    } else {
      tx += cr.left + 28 - rr.left;
      ty += cr.top + (cr.height - rr.height) / 2 - rr.top;
    }
    apply();
  }

  function revealRoot() {
    revealBox(graph.querySelector("g.node[data-id='ROOT']") || graph.querySelector("g.node"), "left");
  }

  function fitToWidth() {
    const svg = svgEl();
    if (!svg) return;
    const vb = (svg.getAttribute("viewBox") || "").split(/\s+/).map(Number);
    if (vb.length === 4 && vb[2] > 0) {
      const avail = canvas.clientWidth - 60;
      z = Math.min(1, Math.max(0.72, avail / vb[2]));
    }
    tx = 0;
    ty = 0;
    apply();
    revealRoot();
  }

  function zoomAt(clientX, clientY, delta) {
    const prev = z;
    const next = Math.min(3, Math.max(0.15, prev + delta));
    if (next === prev) return;
    const cr = canvas.getBoundingClientRect();
    const origin = stageOrigin();
    const px = clientX - cr.left - origin.x;
    const py = clientY - cr.top - origin.y;
    const localX = (px - tx) / prev;
    const localY = (py - ty) / prev;
    z = next;
    tx = px - localX * z;
    ty = py - localY * z;
    apply();
  }

  function svgScale() {
    const svg = svgEl();
    if (!svg) return 1;
    const m = svg.getScreenCTM();
    if (!m || !m.a) return 1;
    return 1 / m.a;
  }

  function onWheel(e) {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      zoomAt(e.clientX, e.clientY, -e.deltaY * 0.0015);
      return;
    }
    tx -= e.deltaX;
    ty -= e.deltaY;
    apply();
  }

  function onCanvasDown(e) {
    if (e.button !== 0) return;
    if (e.target.closest && e.target.closest("g.node")) return;
    e.preventDefault();
    pan = { x: e.clientX, y: e.clientY };
    canvas.classList.add("grabbing");
  }

  function onMove(e) {
    if (pan) {
      tx += e.clientX - pan.x;
      ty += e.clientY - pan.y;
      pan.x = e.clientX;
      pan.y = e.clientY;
      apply();
    }
    if (!nd) return;
    const k = svgScale();
    const nx = nd.ox + (e.clientX - nd.sx) * k;
    const ny = nd.oy + (e.clientY - nd.sy) * k;
    nd.n.x = nx;
    nd.n.y = ny;
    nd.n.g.setAttribute("transform", "translate(" + nx + ", " + ny + ")");
    const id = keyOf(nd.n);
    EDGES.forEach((ed) => {
      if (ed.src === id || ed.dst === id) routeEdge(ed);
    });
  }

  function onUp(e) {
    if (nd) {
      const moved = e && Math.hypot(e.clientX - nd.sx, e.clientY - nd.sy) >= 4;
      const id = keyOf(nd.n);
      nd.n.g.classList.remove("dragging");
      canvas.classList.remove("nodedrag");
      nd = null;
      if (!moved && onQuietClick) onQuietClick(id);
    }
    pan = null;
    canvas.classList.remove("grabbing");
  }

  function onNodeDown(e) {
    const g = e.target.closest && e.target.closest("g.node");
    if (!g || !graph.contains(g)) return;
    const id = g.getAttribute("data-id") || g.id;
    const n = NODES.get(id);
    if (!n) return;
    e.preventDefault();
    e.stopPropagation();
    const p = readTranslate(g);
    nd = { n, sx: e.clientX, sy: e.clientY, ox: p.x, oy: p.y };
    g.classList.add("dragging");
    canvas.classList.add("nodedrag");
  }

  registerGraph();
  fitToWidth();
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("mousedown", onCanvasDown);
  document.addEventListener("mousedown", onNodeDown);
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);

  return {
    zoomIn() {
      const cr = canvas.getBoundingClientRect();
      zoomAt(cr.left + cr.width / 2, cr.top + cr.height / 2, 0.15);
    },
    zoomOut() {
      const cr = canvas.getBoundingClientRect();
      zoomAt(cr.left + cr.width / 2, cr.top + cr.height / 2, -0.15);
    },
    resetZoom() {
      z = 1;
      tx = 0;
      ty = 0;
      apply();
      revealRoot();
    },
    revealNode(id) {
      const node = graph.querySelector("g.node[data-id='" + id + "']");
      if (!node) return;
      z = Math.max(z, 0.9);
      apply();
      revealBox(node, "center");
    },
    restore() {
      NODES.forEach((n) => {
        n.x = n.ox;
        n.y = n.oy;
        n.g.setAttribute("transform", "translate(" + n.ox + ", " + n.oy + ")");
      });
      EDGES.forEach(routeEdge);
      fitToWidth();
    },
    dispose() {
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("mousedown", onCanvasDown);
      document.removeEventListener("mousedown", onNodeDown);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
  };
}
