<script setup>
import { computed, onMounted, ref } from "vue";
import { countNodes, edgePath, layoutDocument } from "@/utils/waterfall";

const props = defineProps({
  document: { type: Object, required: true },
  source: { type: String, default: "" }
});

const stage = ref(null);
const zoom = ref(1);
const pan = ref({ x: 24, y: 24 });
const selected = ref("");

const model = computed(() => layoutDocument(props.document || { rules: [] }));
const paths = computed(() => edgePath(model.value.edges, model.value.nodes));
const canvas = computed(() => {
  let width = 900;
  let height = 640;
  model.value.nodes.forEach((node) => {
    width = Math.max(width, node.x + node.w + 120);
    height = Math.max(height, node.y + node.h + 120);
  });
  return { width: width + "px", height: height + "px" };
});
const worldStyle = computed(() => ({
  transform: "translate(" + pan.value.x + "px," + pan.value.y + "px) scale(" + zoom.value + ")"
}));

function fit() {
  const box = stage.value;
  if (!box || !model.value.nodes.length) return;
  let maxX = 0;
  model.value.nodes.forEach((node) => { maxX = Math.max(maxX, node.x + node.w); });
  const fitW = (Math.max(240, box.clientWidth) - 28) / Math.max(1, maxX);
  zoom.value = Math.max(0.42, Math.min(1.05, fitW));
  pan.value = { x: 12, y: 12 };
}

function zoomBy(factor) {
  zoom.value = Math.max(0.08, Math.min(2.2, zoom.value * factor));
}

let drag = null;
function down(event) {
  if (event.target.closest(".exp-node") || event.target.closest("button")) return;
  drag = { x: event.clientX, y: event.clientY, ox: pan.value.x, oy: pan.value.y };
  stage.value.setPointerCapture(event.pointerId);
}
function move(event) {
  if (!drag) return;
  pan.value = { x: drag.ox + event.clientX - drag.x, y: drag.oy + event.clientY - drag.y };
}
function up() { drag = null; }
function wheel(event) {
  zoomBy(event.deltaY < 0 ? 1.08 : 1 / 1.08);
}

onMounted(fit);
</script>

<template>
  <div class="exp-shell class-only">
    <div class="exp-toolbar">
      <button type="button" class="btn" @click="zoomBy(1 / 1.12)">−</button>
      <button type="button" class="btn" @click="fit">适配</button>
      <button type="button" class="btn" @click="zoomBy(1.12)">+</button>
      <span class="hint">{{ countNodes(document) }} 个节点 · {{ source }}</span>
    </div>
    <div
      ref="stage"
      class="exp-stage"
      @pointerdown="down"
      @pointermove="move"
      @pointerup="up"
      @wheel.prevent="wheel"
    >
      <div class="exp-world" :style="worldStyle">
        <svg class="waterfall-svg" :style="canvas">
          <defs>
            <marker id="wfArrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
              <path d="M0,0 L6,3 L0,6 Z" fill="#1a5f4a" />
            </marker>
          </defs>
          <path
            v-for="(edge, index) in paths"
            :key="index"
            :d="edge.d"
            :class="edge.dashed ? 'no-path' : 'flow'"
            marker-end="url(#wfArrow)"
          />
          <text
            v-for="(edge, index) in paths"
            v-show="edge.label"
            :key="'t' + index"
            :x="edge.lx"
            :y="edge.ly"
            text-anchor="middle"
          >{{ edge.label }}</text>
        </svg>
        <div
          v-for="node in model.nodes"
          :key="node.id"
          class="exp-node compact"
          :class="[node.kind, node.role === 'crm' ? 'role-crm' : '', node.role === 'assessment' ? 'role-assess' : '', selected === node.id ? 'selected' : '']"
          :style="{ left: node.x + 'px', top: node.y + 'px', width: node.w + 'px' }"
          @click.stop="selected = node.id"
        >
          <span class="exp-badge">{{ node.badge }}</span>
          <span class="exp-label">{{ node.label }}</span>
          <span class="exp-note">{{ node.note }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.waterfall-svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
  pointer-events: none;
}
.waterfall-svg path { fill: none; stroke: #2a6b57; stroke-width: 2; }
.waterfall-svg path.no-path { stroke: #94a3b8; stroke-dasharray: 4 5; }
.waterfall-svg text {
  font-size: 10px;
  fill: #64748b;
  font-weight: 600;
  paint-order: stroke;
  stroke: #f7f9fb;
  stroke-width: 4px;
}
</style>
