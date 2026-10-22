<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import mermaidUrl from "@/assets/mermaid.min.js?url";
import { toMermaid } from "@/utils/waterfall";
import { mountMermaidStage } from "@/utils/mermaidStage";

const props = defineProps({
  document: { type: Object, required: true },
  changed: { type: Array, default: () => [] }
});
const emit = defineEmits(["select"]);

const canvas = ref(null);
const stage = ref(null);
const graph = ref(null);
const mmd = ref("");
const error = ref("");
const view = ref("chart");
const stats = ref({ rules: 0, leaves: 0 });
const title = ref("暴露分类决策树");

let lookup = {};
let stageCtl = null;
let renderSeq = 0;
let mermaidReady = false;
let mermaidPromise = null;

function loadMermaid() {
  if (window.mermaid && window.mermaid.render) return Promise.resolve(window.mermaid);
  if (mermaidPromise) return mermaidPromise;
  mermaidPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = mermaidUrl;
    script.onload = () => {
      if (window.mermaid && window.mermaid.render) resolve(window.mermaid);
      else reject(new Error("Mermaid 加载失败"));
    };
    script.onerror = () => reject(new Error("Mermaid 加载失败"));
    document.head.appendChild(script);
  });
  return mermaidPromise;
}

function dispose() {
  if (stageCtl) {
    stageCtl.dispose();
    stageCtl = null;
  }
}

function pick(raw) {
  const text = String(raw || "");
  const id = lookup[text] ? text : ((text.match(/ROOT|N\d+/) || [])[0] || "");
  const item = lookup[id];
  if (!item || !item.node) return;
  emit("select", item);
}

async function draw() {
  const token = ++renderSeq;
  error.value = "";
  const model = toMermaid(props.document || { rules: [] }, props.changed || []);
  mmd.value = model.mmd;
  lookup = model.lookup;
  stats.value = { rules: model.rules, leaves: model.leaves };
  title.value = (props.document && props.document.title) || "暴露分类决策树";
  if (!canvas.value || !stage.value || !graph.value) return;
  try {
    const mermaid = await loadMermaid();
    if (token !== renderSeq) return;
    if (!mermaidReady) {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "loose",
        theme: "base",
        fontFamily: '-apple-system,"PingFang SC","Microsoft YaHei",sans-serif',
        flowchart: {
          curve: "basis",
          nodeSpacing: 26,
          rankSpacing: 52,
          useMaxWidth: false,
          htmlLabels: true,
          padding: 10
        },
        themeVariables: {
          background: "#0b1020",
          primaryColor: "#1e3a8a",
          primaryTextColor: "#eff6ff",
          primaryBorderColor: "#93c5fd",
          lineColor: "#5b7099",
          textColor: "#e8eefc",
          fontSize: "13px",
          edgeLabelBackground: "#0f1729",
          tertiaryColor: "#111a2e"
        }
      });
      mermaidReady = true;
    }
    await mermaid.parse(model.mmd);
    const rendered = await mermaid.render("theGraph" + token, model.mmd);
    if (token !== renderSeq || !graph.value) return;
    dispose();
    graph.value.innerHTML = rendered.svg;
    const svg = graph.value.querySelector("svg");
    if (svg) svg.style.maxWidth = "none";
    stageCtl = mountMermaidStage(canvas.value, stage.value, graph.value, pick);
    (model.changed || []).forEach((id) => {
      const node = graph.value.querySelector("g.node[data-id='" + id + "']");
      if (node) node.classList.add("changed");
    });
    if (model.changed && model.changed.length) stageCtl.revealNode(model.changed[0]);
  } catch (e) {
    if (token !== renderSeq) return;
    error.value = "Mermaid 渲染失败：\n" + (e && e.message ? e.message : e);
  }
}

function zoomIn() { if (stageCtl) stageCtl.zoomIn(); }
function zoomOut() { if (stageCtl) stageCtl.zoomOut(); }
function resetZoom() { if (stageCtl) stageCtl.resetZoom(); }
function restore() { if (stageCtl) stageCtl.restore(); }

function download() {
  const blob = new Blob([mmd.value], { type: "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "exposure-decision-tree.mmd";
  a.click();
  URL.revokeObjectURL(a.href);
}

watch(() => [props.document, (props.changed || []).join("\n")], () => { if (graph.value) draw(); });
onMounted(draw);
onBeforeUnmount(dispose);
</script>

<template>
  <div class="dt-shell">
    <header class="dt-head">
      <h3>{{ title }}<small>由 JSON 规则集机械推导 · 首个命中者生效 · 共 {{ stats.rules }} 条规则 / {{ stats.leaves }} 个结论</small></h3>
      <span class="dt-grow"></span>
      <div class="dt-zoom">
        <button type="button" title="缩小" @click="zoomOut">−</button>
        <button type="button" title="放大" @click="zoomIn">+</button>
        <button type="button" @click="resetZoom">重置缩放</button>
        <button type="button" title="还原所有节点到自动布局位置" @click="restore">还原布局</button>
      </div>
      <select v-model="view">
        <option value="chart">决策图</option>
        <option value="src">Mermaid 源码</option>
      </select>
      <button type="button" @click="download">下载 .mmd</button>
    </header>
    <div v-show="error" class="dt-err">{{ error }}</div>
    <div v-show="view === 'chart'" ref="canvas" class="dt-canvas">
      <div ref="stage" class="dt-stage"><div ref="graph" class="mermaid"></div></div>
    </div>
    <pre v-show="view === 'src'" class="dt-src">{{ mmd }}</pre>
    <div v-show="view === 'chart'" class="dt-legend">
      <span><span class="sw" style="background:#1e3a8a;border:1px solid #93c5fd"></span><b>菱形</b> 判定条件</span>
      <span><span class="sw" style="background:#065f46;border:1px solid #34d399"></span><b>矩形</b> 风险权重</span>
      <span><span class="sw" style="background:#78350f;border:1px solid #fbbf24"></span><b>斜框</b> 参照口径</span>
      <span v-if="changed.length"><span class="sw" style="background:#9a3412;border:1px solid #fde68a"></span><b>高亮</b> 刚修改</span>
      <span class="dt-legend-foot"><b>拖动节点</b>重排 · <b>拖动空白</b>平移 · ⌘/Ctrl+滚轮缩放</span>
    </div>
  </div>
</template>
