<script setup>
import { computed, ref, watch } from "vue";
import Drawer from "@/components/Drawer.vue";
import JsonConfigWorkbench from "@/components/JsonConfigWorkbench.vue";
import { fetchParameterTable, fetchReferenceList } from "@/api/config";
import { buildExposureModel } from "@/utils/exposureModel";

const props = defineProps({
  classification: { type: Object, default: null },
  weight: { type: Object, default: null },
  tables: { type: Array, default: () => [] },
  lists: { type: Array, default: () => [] },
  docs: { type: Array, default: () => [] },
  jurisdiction: { type: String, default: "" },
  version: { type: String, default: "" },
  scopeClasses: { type: Array, default: () => [] },
  embedded: { type: Boolean, default: false }
});
const emit = defineEmits(["import", "reload"]);

const view = ref("pano");
const focusedLane = ref("");
const zoom = ref(1);
const selectedNodeId = ref("");
const tableDetail = ref(null);
const listDetail = ref(null);
const flowCode = ref("");
const flowQuery = ref("");
const flowZoom = ref(1);

const model = computed(() => buildExposureModel(props.classification, props.weight, props.tables, props.lists));
const scopeSet = computed(() => new Set(props.scopeClasses || []));
const scopedMatrix = computed(() => {
  if (!scopeSet.value.size) return model.value.matrix;
  return model.value.matrix.filter((row) => scopeSet.value.has(row.code));
});

function mergeOutputs(list) {
  const items = [];
  const seen = new Set();
  (list || []).forEach((output) => {
    (output && output.items ? output.items : []).forEach((item) => {
      const key = item.kind + "\u0000" + item.id;
      if (seen.has(key)) return;
      seen.add(key);
      items.push(item);
    });
  });
  return {
    items: items,
    texts: items.map((item) => item.text),
    weights: items.filter((item) => item.kind === "fixed").map((item) => item.text),
    tables: items.filter((item) => item.kind === "table").map((item) => item.id)
  };
}

const scopedLanes = computed(() => {
  if (!scopeSet.value.size) return model.value.lanes;
  return model.value.lanes.map((lane) => {
    const rows = scopedMatrix.value.filter((row) => row.lane === lane.title || (lane.classes || []).includes(row.code));
    if (!rows.length) return null;
    const clsIds = Array.from(new Set(rows.flatMap((row) => row.clsIds)));
    const weightIds = Array.from(new Set(rows.flatMap((row) => row.weightIds)));
    const outputs = mergeOutputs(rows.map((row) => row.outputs));
    const topCls = clsIds.filter((id) => {
      const parent = model.value.nodes[id] ? model.value.nodes[id].parent : "";
      return !parent || !clsIds.includes(parent);
    });
    const subCls = clsIds.filter((id) => !topCls.includes(id));
    const weightRoots = weightIds.filter((id) => {
      const parent = model.value.nodes[id] ? model.value.nodes[id].parent : "";
      return !parent || !weightIds.includes(parent);
    });
    const fields = Array.from(new Set(clsIds.concat(weightIds).flatMap((id) => (model.value.nodes[id] || {}).fields || [])));
    return Object.assign({}, lane, {
      classes: rows.map((row) => row.code),
      clsIds: clsIds,
      weightIds: weightIds,
      s2: topCls,
      s3: subCls,
      s4: weightRoots,
      s5: outputs.texts,
      outputs: outputs,
      tables: outputs.tables,
      fields: fields,
      counts: {
        cls: clsIds.length,
        rw: weightIds.length,
        fields: fields.length,
        tables: outputs.tables.length
      }
    });
  }).filter(Boolean);
});

const displayCounts = computed(() => {
  if (!scopeSet.value.size) return model.value.counts;
  const clsIds = new Set();
  const weightIds = new Set();
  scopedMatrix.value.forEach((row) => {
    row.clsIds.forEach((id) => clsIds.add(id));
    row.weightIds.forEach((id) => weightIds.add(id));
  });
  return {
    clsNodes: clsIds.size,
    rwNodes: weightIds.size,
    lanes: scopedLanes.value.length,
    classes: scopedMatrix.value.length,
    tables: model.value.counts.tables,
    lists: model.value.counts.lists
  };
});

const selectedNode = computed(() => (selectedNodeId.value ? model.value.nodes[selectedNodeId.value] : null));

const selectedClass = computed(() => {
  const list = scopedMatrix.value;
  return list.find((item) => item.code === flowCode.value) || list[0] || null;
});

const flowGroups = computed(() => Object.entries(model.value.flowGroups).map(([lane, items]) => ({
  lane: lane,
  items: items.filter((item) => {
    if (scopeSet.value.size && !scopeSet.value.has(item.code)) return false;
    const text = flowQuery.value.trim().toLowerCase();
    return !text || (item.code + " " + item.label).toLowerCase().includes(text);
  })
})).filter((group) => group.items.length));

watch(model, () => {
  if (!scopedMatrix.value.some((item) => item.code === flowCode.value)) {
    flowCode.value = scopedMatrix.value[0] ? scopedMatrix.value[0].code : "";
  }
});

watch(scopeSet, () => {
  if (!scopedMatrix.value.some((item) => item.code === flowCode.value)) {
    flowCode.value = scopedMatrix.value[0] ? scopedMatrix.value[0].code : "";
  }
});

function nodeStatus(node) {
  if (!node) return { label: "", className: "" };
  if (node.kind === "rw" && node.rw === null) return { label: "人工复核", className: "warn" };
  if (node.kind === "cls" && !node.cls) return { label: "路由节点", className: "grp" };
  if (node.kind === "rw" && node.rw === "") return { label: "路由节点", className: "grp" };
  return { label: "已配置", className: "ok" };
}

function openNode(id) {
  if (!id) return;
  selectedNodeId.value = id;
}

function openTable(id) {
  if (!id) return;
  const meta = (props.tables || []).find((item) => item.tableId === id || item.id === id);
  const request = meta ? fetchParameterTable(meta.id) : Promise.resolve(null);
  request.then((item) => {
    tableDetail.value = item || { tableId: id, title: "参数表不可用", columns: [], rows: [] };
  }).catch(() => {
    tableDetail.value = { tableId: id, title: "参数表不可用", columns: [], rows: [] };
  });
}

function openList(id) {
  if (!id) return;
  const meta = (props.lists || []).find((item) => item.listId === id || item.id === id);
  const request = meta ? fetchReferenceList(meta.id) : Promise.resolve(null);
  request.then((item) => {
    listDetail.value = item || { listId: id, title: "名单不可用", columns: [], rows: [] };
  }).catch(() => {
    listDetail.value = { listId: id, title: "名单不可用", columns: [], rows: [] };
  });
}

function listLabel(id) {
  const item = model.value.listMap[id];
  return item ? item.title + (item.rowCount ? " · " + item.rowCount : " · 待载入") : id;
}

function isTableOutput(text) {
  return typeof text === "string" && /^T_[A-Z0-9_]+$/.test(text);
}

function openOutput(text) {
  if (isTableOutput(text)) openTable(text);
}

function chipClass(node) {
  if (!node) return "";
  const status = nodeStatus(node);
  return (node.kind === "rw" ? "rw" : "cls") + " " + (status.className === "warn" || status.className === "grp" ? status.className : "");
}

function classFlow() {
  const cls = selectedClass.value;
  if (!cls) return { boxes: [], edges: [], width: 980, height: 520 };
  const clsSet = new Set(cls.clsIds);
  const rwSet = new Set(cls.weightIds);
  const clsLevels = flowLevels(clsSet);
  const rwLevels = flowLevels(rwSet);
  const fieldSet = new Set();
  clsSet.forEach((id) => (model.value.nodes[id].fields || []).forEach((name) => fieldSet.add(name)));
  rwSet.forEach((id) => (model.value.nodes[id].fields || []).forEach((name) => fieldSet.add(name)));
  const fields = Array.from(fieldSet);
  const outItems = (cls.outputs && cls.outputs.items ? cls.outputs.items : []).slice(0, 8);
  const boxOf = (id) => {
    const node = model.value.nodes[id];
    const status = nodeStatus(node);
    return {
      id: id,
      kind: node.kind,
      title: id,
      label: node.label,
      sub: node.label,
      when: node.whenText,
      rw: node.rw,
      status: status.label,
      statusClass: status.className
    };
  };
  const layers = [
    {
      key: "input",
      title: "输入字段",
      boxes: [{ id: "__input", kind: "input", title: "输入字段", sub: fields.length + " 个字段", fields: fields }]
    }
  ];
  clsLevels.forEach((ids, index) => {
    layers.push({ key: "cls" + index, title: index ? "细分与资格" : "暴露分类", boxes: ids.map(boxOf) });
  });
  layers.push({
    key: "result",
    title: "分类结果",
    boxes: [{ id: "__result", kind: "result", title: cls.code, sub: cls.label }]
  });
  rwLevels.forEach((ids, index) => {
    layers.push({ key: "rw" + index, title: index ? "权重分支" : "风险权重", boxes: ids.map(boxOf) });
  });
  layers.push({
    key: "outs",
    title: "权重输出",
    boxes: [{ id: "__outs", kind: "outs", title: "权重输出", sub: "", outputs: outItems }]
  });

  const width = 980;
  const gap = 20;
  const top = 18;
  const perRow = 4;
  const rowGap = 24;
  const dimsOf = (box) => {
    if (box.kind === "input") return { w: 300, h: 92 };
    if (box.kind === "result") return { w: 220, h: 72 };
    if (box.kind === "outs") {
      return { w: Math.min(660, 160 + outItems.length * 112), h: 64 + Math.ceil(Math.max(1, outItems.length) / 4) * 22 };
    }
    return { w: 210, h: 104 };
  };
  let y = top;
  const boxes = [];
  const pos = {};
  layers.forEach((layer) => {
    const rows = [];
    for (let i = 0; i < layer.boxes.length; i += perRow) rows.push(layer.boxes.slice(i, i + perRow));
    rows.forEach((row) => {
      const dims = row.map(dimsOf);
      const total = dims.reduce((sum, item) => sum + item.w, 0) + gap * (row.length - 1);
      let x = Math.max(20, (width - total) / 2);
      const rowHeight = Math.max.apply(null, dims.map((item) => item.h));
      row.forEach((box, index) => {
        const dim = dims[index];
        box.x = x;
        box.y = y;
        box.w = dim.w;
        box.h = dim.h;
        pos[box.id] = { x: x, y: y, w: dim.w, h: dim.h };
        boxes.push(box);
        x += dim.w + gap;
      });
      y += rowHeight + rowGap;
    });
    y += 14;
  });

  const edges = [];
  const add = (from, to) => {
    if (!pos[from] || !pos[to]) return;
    const a = pos[from];
    const b = pos[to];
    const x1 = a.x + a.w / 2;
    const y1 = a.y + a.h;
    const x2 = b.x + b.w / 2;
    const y2 = b.y;
    const mid = (y1 + y2) / 2;
    edges.push({ from: from, to: to, d: "M" + x1 + "," + y1 + " L" + x1 + "," + mid + " L" + x2 + "," + mid + " L" + x2 + "," + y2 });
  };

  if (clsLevels.length) clsLevels[0].forEach((id) => add("__input", id));
  else add("__input", "__result");
  clsLevels.forEach((ids, level) => {
    ids.forEach((id) => {
      const kids = (model.value.nodes[id].children || []).filter((child) => clsSet.has(child));
      if (kids.length) kids.forEach((kid) => add(id, kid));
      else if (level === clsLevels.length - 1) add(id, "__result");
    });
  });
  if (rwLevels.length) rwLevels[0].forEach((id) => add("__result", id));
  else add("__result", "__outs");
  rwLevels.forEach((ids, level) => {
    ids.forEach((id) => {
      const kids = (model.value.nodes[id].children || []).filter((child) => rwSet.has(child));
      if (kids.length) kids.forEach((kid) => add(id, kid));
      else if (level === rwLevels.length - 1) add(id, "__outs");
    });
  });

  return { boxes: boxes, edges: edges, width: width, height: y + 10 };
}

function flowLevels(set) {
  const roots = Array.from(set).filter((id) => {
    const node = model.value.nodes[id];
    return node && (!node.parent || !set.has(node.parent));
  });
  const levels = [];
  const seen = new Set();
  let current = roots;
  while (current.length) {
    current = current.filter((id) => !seen.has(id));
    if (!current.length) break;
    current.forEach((id) => seen.add(id));
    levels.push(current);
    const next = [];
    current.forEach((id) => {
      (model.value.nodes[id].children || []).forEach((child) => {
        if (set.has(child) && !seen.has(child) && !next.includes(child)) next.push(child);
      });
    });
    current = next;
  }
  const rest = Array.from(set).filter((id) => !seen.has(id));
  if (rest.length) levels.push(rest);
  return levels;
}

const flow = computed(classFlow);

function boxTypeLabel(kind) {
  return { input: "输入字段", cls: "暴露分类", rw: "风险权重", result: "分类结果", outs: "权重输出" }[kind] || "";
}

function zoomBy(delta) {
  zoom.value = Math.max(0.75, Math.min(1.4, Math.round((zoom.value + delta) * 10) / 10));
}

function selectLane(key) {
  focusedLane.value = focusedLane.value === key ? "" : key;
}
</script>

<template>
  <div class="xp-shell">
    <div class="xp-head">
      <div class="xp-tabs">
        <button type="button" :class="{ on: view === 'pano' }" @click="view = 'pano'">规则全景</button>
        <button type="button" :class="{ on: view === 'matrix' }" @click="view = 'matrix'">分类矩阵</button>
        <button type="button" :class="{ on: view === 'flow' }" @click="view = 'flow'">规则流程图</button>
        <button type="button" :class="{ on: view === 'json' }" @click="view = 'json'">JSON 配置</button>
      </div>
      <span class="spacer"></span>
      <span class="xp-meta" v-if="classification">
        分类 <b>{{ displayCounts.clsNodes }}</b> · 权重 <b>{{ displayCounts.rwNodes }}</b> ·
        车道 <b>{{ displayCounts.lanes }}</b> · 类别 <b>{{ displayCounts.classes }}</b> ·
        参数表 <b>{{ displayCounts.tables }}</b> · 名单 <b>{{ displayCounts.lists }}</b>
      </span>
      <span v-if="version" class="xp-vtag">v{{ version }}</span>
      <button v-if="!embedded" type="button" class="btn sm" @click="$emit('import')">导入 docs 样例</button>
      <div v-if="view === 'pano'" class="xp-zoom">
        <button type="button" @click="zoomBy(-0.1)">−</button>
        <span>{{ Math.round(zoom * 100) }}%</span>
        <button type="button" @click="zoomBy(0.1)">+</button>
      </div>
    </div>

    <div v-if="!classification || !weight" class="notice warn">
      还没有同时导入分类规则和风险权重规则，先点「导入 docs 样例」。
    </div>

    <template v-else>
      <div v-show="view === 'pano'" class="xp-view">
        <p class="xp-hint">横向为处理阶段，纵向为业务分支；最右列「参数与名单」可直接点开参数表与名单。点击分支名聚焦该路径，点击节点查看规则详情。</p>
        <div class="xp-pano-shell">
          <div class="xp-pano" :style="{ zoom: zoom }">
          <div class="xp-grid xp-head-row">
            <div class="xp-ph c0"><b>业务分支</b><span class="n">{{ scopedLanes.length }} 条主路径</span></div>
            <div class="xp-ph"><b>输入与范围</b><span class="n">入口条件</span></div>
            <div class="xp-ph"><b>暴露分类</b><span class="n">分类规则集</span></div>
            <div class="xp-ph"><b>细分与资格</b><span class="n">子分支 / 特殊认定</span></div>
            <div class="xp-ph"><b>风险权重</b><span class="n">权重规则集</span></div>
            <div class="xp-ph"><b>权重输出</b><span class="n">参数表 / 固定值</span></div>
            <div class="xp-ph"><b>参数与名单</b><span class="n">点击查看明细</span></div>
          </div>

          <div class="xp-overlay">
            <div class="xp-ov-name"><b>全局覆盖层</b><span>先于车道判断生效</span></div>
            <div class="xp-ov-body">
              <button
                v-for="id in model.overlays"
                :key="id"
                type="button"
                class="xp-nchip ov"
                @click="openNode(id)"
              >
                <i class="xp-dot" :class="nodeStatus(model.nodes[id]).className"></i><span class="id">{{ id }}</span><span class="lb">{{ model.nodes[id]?.label }}</span>
              </button>
              <span class="xp-faint">范围控制、资本扣除、违约覆盖等全局节点不归属单一车道</span>
            </div>
          </div>

          <div class="xp-lists">
            <div class="xp-ov-name"><b>监管名单</b><span>{{ displayCounts.lists }} 张 · 点击查看</span></div>
            <div class="xp-ov-body">
              <button v-for="item in lists" :key="item.id" type="button" class="xp-otag l" @click="openList(item.listId)">
                {{ item.title }} · {{ item.rowCount || 0 }}
              </button>
              <span v-if="!lists.length" class="xp-faint">没有名单</span>
            </div>
          </div>

          <div
            v-for="lane in scopedLanes"
            :key="lane.key"
            class="xp-lane"
            :class="{ focus: focusedLane === lane.key, dim: focusedLane && focusedLane !== lane.key }"
          >
            <div class="xp-lrow">
              <div class="xp-lname" @click="selectLane(lane.key)">
                <b><span class="chev">{{ focusedLane === lane.key ? '▾' : '▸' }}</span>{{ lane.title }}</b>
                <span>{{ lane.desc }}</span>
                <div class="cnt">
                  <span>分类 {{ lane.counts.cls }}</span><span>权重 {{ lane.counts.rw }}</span>
                  <span>字段 {{ lane.counts.fields }}</span><span>参数表 {{ lane.counts.tables }}</span>
                </div>
              </div>
              <div class="xp-cell"><div class="xp-entry">{{ lane.entry }}</div></div>
              <div class="xp-cell">
                <button v-for="id in lane.s2" :key="id" type="button" class="xp-nchip" :class="chipClass(model.nodes[id])" @click="openNode(id)">
                  <i class="xp-dot" :class="nodeStatus(model.nodes[id]).className"></i><span class="id">{{ id }}</span><span class="lb">{{ model.nodes[id]?.label }}</span>
                </button>
              </div>
              <div class="xp-cell">
                <button v-for="id in lane.s3" :key="id" type="button" class="xp-nchip" :class="chipClass(model.nodes[id])" @click="openNode(id)">
                  <i class="xp-dot" :class="nodeStatus(model.nodes[id]).className"></i><span class="id">{{ id }}</span><span class="lb">{{ model.nodes[id]?.label }}</span>
                </button>
                <span v-if="!lane.s3.length" class="xp-empty">无细分分支</span>
              </div>
              <div class="xp-cell">
                <button v-for="id in lane.s4" :key="id" type="button" class="xp-nchip rw" @click="openNode(id)">
                  <i class="xp-dot" :class="nodeStatus(model.nodes[id]).className"></i><span class="id">{{ id }}</span><span class="lb">{{ model.nodes[id]?.label }}</span>
                </button>
                <span v-if="!lane.s4.length" class="xp-empty">—</span>
              </div>
              <div class="xp-cell">
                <button
                  v-for="(text, index) in lane.s5"
                  :key="index"
                  type="button"
                  class="xp-otag"
                  :class="isTableOutput(text) ? 't' : 'f'"
                  @click="openOutput(text)"
                >{{ text }}</button>
                <span v-if="!lane.s5.length" class="xp-empty">—</span>
              </div>
              <div class="xp-cell">
                <button v-for="id in lane.tables" :key="id" type="button" class="xp-otag t" @click="openTable(id)">{{ id }}</button>
                <span v-if="!lane.tables.length" class="xp-empty">—</span>
              </div>
            </div>
          </div>
        </div>
        <div v-if="focusedLane" class="xp-path">
          <template v-for="lane in scopedLanes.filter((item) => item.key === focusedLane)" :key="lane.key">
            <div class="xp-path-head"><b>{{ lane.title }}</b><span>{{ lane.s2.length + lane.s3.length + lane.s4.length }} 个判断节点 · {{ lane.fields.length }} 个输入字段 · {{ lane.tables.length }} 张参数表</span></div>
            <div class="xp-path-flow">
              <span class="xp-otag">{{ lane.entry }}</span>
              <span v-for="id in lane.s2" :key="id" class="xp-step"><span class="lbl">分类</span><button type="button" class="xp-nchip cls" @click="openNode(id)">{{ id }}</button></span>
              <span v-for="id in lane.s3" :key="id" class="xp-step"><span class="lbl">细分</span><button type="button" class="xp-nchip cls" @click="openNode(id)">{{ id }}</button></span>
              <span v-for="id in lane.s4" :key="id" class="xp-step"><span class="lbl">权重</span><button type="button" class="xp-nchip rw" @click="openNode(id)">{{ id }}</button></span>
              <span v-for="(text, index) in lane.s5" :key="'o' + index" class="xp-step">
                <span class="lbl">输出</span>
                <button type="button" class="xp-otag" :class="isTableOutput(text) ? 't' : 'f'" @click="openOutput(text)">{{ text }}</button>
              </span>
            </div>
          </template>
        </div>
        </div>
      </div>

      <div v-show="view === 'matrix'" class="xp-view">
        <p class="xp-hint">行 = 监管暴露类别，列 = 判断阶段；单元格内为实际节点，点击查看。共享权重路径单独标注，便于比较类别差异。</p>
        <div class="xp-mx-head">
          <h2>分类矩阵</h2>
          <span class="sub">{{ scopedMatrix.length }} 个暴露类别 · 点击节点查看规则</span>
          <div class="xp-legend">
            <span><i style="background: var(--accent)"></i>分类节点</span>
            <span><i style="background: var(--violet)"></i>权重节点</span>
            <span><i style="background: #b45309"></i>参数表 / 共享路径</span>
          </div>
        </div>
        <div class="xp-mx-wrap">
          <table class="xp-mx">
            <thead><tr><th>暴露类别</th><th>所属分支</th><th>分类识别</th><th>细分与资格</th><th>权重路径</th><th>权重输出</th></tr></thead>
            <tbody>
              <tr v-for="row in scopedMatrix" :key="row.code">
                <td class="cls"><b>{{ row.code }}</b><span>{{ row.label }}</span></td>
                <td class="lane">{{ row.lane }}</td>
                <td>
                  <button v-for="id in row.clsIds" :key="id" type="button" class="xp-nchip cls" @click="openNode(id)">
                    <i class="xp-dot" :class="nodeStatus(model.nodes[id]).className"></i><span class="id">{{ id }}</span><span class="lb">{{ model.nodes[id]?.label }}</span>
                  </button>
                </td>
                <td><button v-for="id in row.specialIds" :key="id" type="button" class="xp-nchip cls" @click="openNode(id)">{{ id }}</button><span v-if="!row.specialIds.length" class="xp-empty">—</span></td>
                <td>
                  <span v-for="item in row.shared" :key="'s' + item.id" class="xp-otag m" @click="openNode(item.id)">
                    共享路径 · {{ item.classes }} 类
                  </span>
                  <button v-for="id in row.weightIds" :key="id" type="button" class="xp-nchip rw" @click="openNode(id)">
                    <i class="xp-dot" :class="nodeStatus(model.nodes[id]).className"></i><span class="id">{{ id }}</span><span class="lb">{{ model.nodes[id]?.label }}</span>
                  </button>
                  <span v-if="row.rwMore" class="xp-otag m">+{{ row.rwMore }} 个下游节点</span>
                  <span v-if="!row.weightIds.length" class="xp-empty">—</span>
                </td>
                <td>
                  <button v-for="(text, index) in row.out" :key="index" type="button" class="xp-otag" :class="isTableOutput(text) ? 't' : 'f'" @click="openOutput(text)">{{ text }}</button>
                  <span v-if="!row.out.length" class="xp-empty">—</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div v-show="view === 'flow'" class="xp-view">
        <p class="xp-hint">从输入字段开始，按暴露分类 → 分类结果 → 风险权重 → 权重输出判断；点击方框查看规则，点击参数表看明细。</p>
        <div class="xp-flow-wrap">
          <aside class="xp-flow-side">
            <div class="xp-flow-side-h"><b>暴露类别</b><input v-model="flowQuery" type="search" placeholder="搜索" /></div>
            <div class="xp-side-scroll">
              <div v-for="group in flowGroups" :key="group.lane" class="xp-sgroup">
                <div class="xp-sgh"><b>{{ group.lane }}</b><span>{{ group.items.length }}</span></div>
                <button
                  v-for="item in group.items"
                  :key="item.code"
                  type="button"
                  class="xp-sitem"
                  :class="{ on: selectedClass && item.code === selectedClass.code }"
                  @click="flowCode = item.code"
                >
                  <span class="code">{{ item.code }}</span><span class="lbl">{{ item.label }}</span>
                </button>
              </div>
            </div>
          </aside>
          <section class="xp-flow-main">
            <div class="xp-flow-bar">
              <b>{{ selectedClass ? selectedClass.code + ' · ' + selectedClass.label : '—' }}</b>
              <span class="sub" v-if="selectedClass">分类 {{ selectedClass.clsIds.length }} 节点 · 权重 {{ selectedClass.weightIds.length }} 节点 · 输出 {{ selectedClass.out.length }} 项</span>
              <span class="spacer"></span>
              <span class="sub">缩放</span>
              <button type="button" class="xp-zbtn" @click="flowZoom = Math.max(0.7, Math.round((flowZoom - 0.1) * 10) / 10)">−</button>
              <span class="xp-zval">{{ Math.round(flowZoom * 100) }}%</span>
              <button type="button" class="xp-zbtn" @click="flowZoom = Math.min(1.5, Math.round((flowZoom + 0.1) * 10) / 10)">＋</button>
            </div>
            <div class="xp-flow-viewport">
              <div class="xp-flow-canvas" :style="{ width: flow.width + 'px', height: flow.height + 'px', zoom: flowZoom }">
                <svg :width="flow.width" :height="flow.height" class="xp-flow-svg">
                  <defs>
                    <marker id="xp-ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
                      <path d="M0,0 L10,5 L0,10 z" fill="#b9c2cf" />
                    </marker>
                  </defs>
                  <path v-for="(edge, index) in flow.edges" :key="index" :d="edge.d" marker-end="url(#xp-ar)" />
                </svg>
                <div
                  v-for="box in flow.boxes"
                  :key="box.id"
                  class="xp-fbox"
                  :class="box.kind"
                  :style="{ left: box.x + 'px', top: box.y + 'px', width: box.w + 'px', height: box.h + 'px' }"
                  role="button"
                  tabindex="0"
                  @click="box.id.indexOf('__') === 0 ? null : openNode(box.id)"
                  @keydown.enter="box.id.indexOf('__') === 0 ? null : openNode(box.id)"
                >
                  <span v-if="box.status" class="xp-fbox-tag" :class="box.statusClass">{{ box.status }}</span>
                  <span class="k">{{ boxTypeLabel(box.kind) }}</span>
                  <div class="t">
                    {{ box.title }}<span v-if="box.kind === 'rw' && box.rw !== '' && box.rw !== undefined"> · {{ box.rw === null ? '人工复核' : box.rw + '%' }}</span>
                  </div>
                  <template v-if="box.kind === 'outs'">
                    <div class="xp-fbox-outs">
                      <span
                        v-for="item in box.outputs"
                        :key="item.kind + item.id"
                        class="xp-otag"
                        :class="item.kind === 'table' ? 't' : 'f'"
                        @click.stop="item.kind === 'table' ? openTable(item.id) : null"
                      >{{ item.text }}</span>
                    </div>
                  </template>
                  <template v-else>
                    <div class="s">{{ box.kind === 'input' ? (box.fields || []).slice(0, 4).join(' · ') : box.sub }}</div>
                    <div v-if="box.when" class="w">{{ box.when }}</div>
                  </template>
                </div>
              </div>
            </div>
            <div class="xp-flow-legend">
              <span><i style="background: #0e7490"></i>输入</span>
              <span><i style="background: var(--accent)"></i>分类规则</span>
              <span><i style="background: var(--ok)"></i>分类结果</span>
              <span><i style="background: var(--violet)"></i>权重规则</span>
              <span><i style="background: #b45309"></i>参数表</span>
              <span><i style="background: #6d28d9"></i>权重输出</span>
              <span class="xp-legend-note">实线 = 判断顺序；点方框看规则，点参数表看明细</span>
            </div>
          </section>
        </div>
      </div>

      <JsonConfigWorkbench
        v-if="view === 'json'"
        :classification="classification"
        :weight="weight"
        :tables="tables"
        :lists="lists"
        :docs="docs"
        :jurisdiction="jurisdiction"
        :rule-version="version"
        @saved="$emit('reload')"
      />
    </template>

    <Drawer :open="!!selectedNode" wide :title="selectedNode ? selectedNode.id + ' · ' + selectedNode.label : '规则详情'" @close="selectedNodeId = ''">
      <template v-if="selectedNode">
        <div class="xp-detail-head">
          <span class="xp-status" :class="nodeStatus(selectedNode).className">{{ nodeStatus(selectedNode).label }}</span>
          <span class="xp-status grp">{{ selectedNode.kind === 'rw' ? '风险权重' : '暴露分类' }}</span>
        </div>
        <div class="xp-sect"><h5>规则名称</h5><p><b>{{ selectedNode.label }}</b></p><p v-if="selectedNode.note" class="dim">{{ selectedNode.note }}</p></div>
        <div class="xp-sect"><h5>判断条件</h5><p class="mono">{{ selectedNode.whenText || '（无附加条件，路由节点）' }}</p></div>
        <div class="xp-sect"><h5>规则结果</h5><dl class="xp-kv">
          <template v-if="selectedNode.cls"><dt>暴露类别</dt><dd><code>{{ selectedNode.cls }}</code></dd></template>
          <template v-if="selectedNode.kind === 'rw'"><dt>风险权重</dt><dd><code>{{ selectedNode.rw === null ? '人工复核' : (selectedNode.rw === '' ? '—' : selectedNode.rw + '%') }}</code></dd></template>
          <template v-if="selectedNode.tableIds.length"><dt>参数表</dt><dd><button v-for="id in selectedNode.tableIds" :key="id" type="button" class="xp-chip" @click="openTable(id)">{{ id }}</button></dd></template>
          <template v-if="selectedNode.adjustments.length"><dt>调整项</dt><dd><div v-for="(item, index) in selectedNode.adjustments" :key="index">{{ item }}</div></dd></template>
        </dl></div>
        <div class="xp-sect"><h5>输入字段（{{ selectedNode.fields.length }}）</h5>
          <div class="xp-chipwrap"><span v-for="field in selectedNode.fields" :key="field" class="xp-chip">{{ field }}</span><span v-if="!selectedNode.fields.length" class="dim">不直接引用字段</span></div>
        </div>
        <div v-if="selectedNode.listIds.length" class="xp-sect"><h5>引用名单</h5><div class="xp-chipwrap"><button v-for="id in selectedNode.listIds" :key="id" type="button" class="xp-chip" @click="openList(id)">{{ listLabel(id) }}</button></div></div>
        <div class="xp-sect"><h5>监管依据</h5><p>{{ selectedNode.basis || '—' }}</p></div>
        <div class="xp-sect"><h5>上下游节点</h5><dl class="xp-kv">
          <dt>上级</dt><dd><button v-if="selectedNode.parent" type="button" class="xp-chip" @click="openNode(selectedNode.parent)">{{ selectedNode.parent }}</button><span v-else class="dim">顶层节点</span></dd>
          <dt>下级</dt><dd><button v-for="id in selectedNode.children" :key="id" type="button" class="xp-chip" @click="openNode(id)">{{ id }}</button><span v-if="!selectedNode.children.length" class="dim">无</span></dd>
        </dl></div>
        <details class="xp-json"><summary>查看规则 JSON 原文</summary><pre>{{ JSON.stringify(selectedNode.json, null, 1) }}</pre></details>
      </template>
    </Drawer>

    <Drawer :open="!!tableDetail" wide :title="tableDetail ? tableDetail.tableId + ' · ' + tableDetail.title : '参数表'" @close="tableDetail = null">
      <template v-if="tableDetail">
        <table class="xp-dtable">
          <thead><tr><th v-for="column in tableDetail.columns" :key="column">{{ column }}</th></tr></thead>
          <tbody>
            <tr v-for="(row, index) in tableDetail.rows" :key="index">
              <td v-for="(cell, cellIndex) in row" :key="cellIndex">{{ cell }}</td>
            </tr>
          </tbody>
        </table>
        <p v-if="!tableDetail.rows.length" class="dim">参数表还没有数据行。</p>
      </template>
    </Drawer>

    <Drawer :open="!!listDetail" wide :title="listDetail ? listDetail.listId + ' · ' + listDetail.title : '监管名单'" @close="listDetail = null">
      <template v-if="listDetail">
        <table class="xp-dtable">
          <thead><tr><th v-for="column in listDetail.columns" :key="column">{{ column }}</th></tr></thead>
          <tbody>
            <tr v-for="(row, index) in listDetail.rows" :key="index">
              <td v-for="(cell, cellIndex) in row" :key="cellIndex">{{ cell }}</td>
            </tr>
          </tbody>
        </table>
        <p v-if="!listDetail.rows.length" class="dim">名单还没有条目。</p>
      </template>
    </Drawer>
  </div>
</template>
