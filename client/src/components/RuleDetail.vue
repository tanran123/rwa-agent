<script setup>
import { computed, ref } from "vue";
import { weightText } from "@/utils/waterfall";
import { labelBook, pct2, summarizeWhen, whenKey } from "@/utils/ruleText";
import Drawer from "@/components/Drawer.vue";
import WhenList from "@/components/WhenList.vue";

const props = defineProps({
  node: { type: Object, default: null },
  path: { type: String, default: "" },
  index: { type: Number, default: 0 },
  depth: { type: Number, default: 0 },
  fallback: { type: Boolean, default: false },
  fields: { type: Array, default: () => [] },
  clauses: { type: Array, default: () => [] }
});
const emit = defineEmits(["close", "open"]);
const toast = ref("");

const book = computed(() => {
  const extra = [];
  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    (node.fields || []).forEach((field) => extra.push(field));
    (node.children || []).forEach(walk);
    if (node.otherwise && typeof node.otherwise === "object") walk(node.otherwise);
  };
  walk(props.node);
  return labelBook([...(props.fields || []), ...extra]);
});

const linked = computed(() => (props.clauses || []).filter((item) => (item.referencedBy || []).includes(props.node && props.node.name)));

const weightLine = computed(() => {
  const node = props.node;
  if (!node) return "—";
  if (typeof node.value === "number") return pct2(node.value);
  const text = weightText(node);
  if (text) return text;
  if (node.children && node.children.length) return "权重写在子档上";
  return "—";
});

const kind = computed(() => {
  const node = props.node;
  if (!node) return "—";
  if (node.children && node.children.length) return "分流节点（需继续下钻）";
  if (props.fallback) return "兜底节点";
  return "产出节点";
});

function childWeight(child) {
  if (typeof child.value === "number") return pct2(child.value);
  const text = weightText(child);
  if (text) return text;
  if (child.children && child.children.length) return child.children.length + " 子类";
  return "—";
}

function sourceTag(source) {
  if (source === "manual") return { cls: "warn", text: "人工填写" };
  if (source === "calc") return { cls: "info", text: "计算得出" };
  if (source) return { cls: "muted", text: "表中有列" };
  return null;
}

function openChild(child, index) {
  emit("open", {
    node: child,
    path: props.path + "/" + index + ":" + child.name,
    depth: props.depth + 1,
    index,
    fallback: false
  });
}

async function copyJson() {
  const text = JSON.stringify(props.node, null, 2);
  try {
    await navigator.clipboard.writeText(text);
    toast.value = "规则 JSON 已复制";
  } catch (error) {
    toast.value = "复制失败，请从下方 JSON 手动选择";
  }
  setTimeout(() => { toast.value = ""; }, 1800);
}
</script>

<template>
  <Drawer :open="!!node" :title="node ? '规则详情 · ' + (node.label || node.name) : ''" wide @close="emit('close')">
    <template v-if="node">
      <div class="notice info">
        <span class="ni">ℹ</span>
        <div>规则路径 <code class="mono">{{ path || node.name }}</code> · 本节点是一条结构化规则对象，既用于决策树展示，也用于实际执行与审计追溯。</div>
      </div>
      <div v-if="node.example" class="notice warn">
        <span class="ni">!</span>
        <div>本节点标记为 example: true，属于随规则集附带的示例，可删除。</div>
      </div>

      <div class="panel">
        <div class="panel-head"><h3>规则基本信息</h3></div>
        <div class="panel-body">
          <div class="kv">
            <div class="k">规则 name</div><div class="v mono">{{ node.name }}</div>
            <div class="k">显示名称</div><div class="v">{{ node.label || "—" }}</div>
            <div class="k">规则编号</div><div class="v mono">{{ node.rule_id || node.ruleId || "—" }}</div>
            <div class="k">本层顺序</div><div class="v">{{ fallback || index < 0 ? "兜底" : (index + 1) }}</div>
            <div class="k">节点类型</div><div class="v">{{ kind }}</div>
            <div class="k">风险权重</div><div class="v">{{ weightLine }}</div>
            <div class="k">是否兜底</div><div class="v">{{ fallback ? "是，本层都不命中时走这里" : "否" }}</div>
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-head"><h3>判断条件</h3></div>
        <div class="panel-body">
          <template v-if="node.skip">
            <div class="cond-group-label">本产品不适用这条时，整段跳过</div>
            <WhenList :when="node.skip.field ? node.skip : node.skip" :book="book" />
            <div class="hint" style="margin: 6px 0 10px; font-size: 11px; color: var(--ink-3)">skip 成立就当没有这条，子级也不进；被跳过的那条 when 本来会命中时，不再走同一层的 otherwise，退回外层继续下一条。</div>
          </template>
          <WhenList v-if="whenKey(node.when)" :when="node.when" :book="book" />
          <p v-if="!node.skip && !whenKey(node.when)" class="dim">这一层没有单独写 when。</p>
        </div>
      </div>

      <div v-if="node.fields && node.fields.length" class="panel">
        <div class="panel-head">
          <h3>本节点声明的字段（{{ node.fields.length }}）</h3>
          <span class="sub">只给这一条和它下面的子类使用</span>
        </div>
        <div class="panel-body">
          <div v-for="field in node.fields" :key="field.name" class="fblock">
            <div class="fh">
              <span class="fname">{{ field.label || field.name }}</span>
              <span class="fcode">{{ field.name }}</span>
              <span v-if="sourceTag(field.source)" :class="'tag ' + sourceTag(field.source).cls">{{ sourceTag(field.source).text }}</span>
              <span v-if="field.type" class="tag outline">{{ field.type }}</span>
            </div>
            <div v-if="field.meaning" class="fmean">{{ field.meaning }}</div>
            <div v-if="field.options && field.options.length" class="fopts">
              <span v-for="option in field.options" :key="option.code" class="tag">{{ option.label }} = {{ option.code }}</span>
            </div>
          </div>
        </div>
      </div>

      <div v-if="node.note" class="panel">
        <div class="panel-head"><h3>权重依据 / 备注</h3></div>
        <div class="panel-body"><div style="line-height: 1.75; font-size: 12.5px">{{ node.note }}</div></div>
      </div>

      <div v-if="linked.length" class="panel">
        <div class="panel-head">
          <h3>关联监管条款（模拟）</h3>
          <span class="sub">计量时记录实际命中规则对应的条款，形成追溯链路</span>
        </div>
        <div class="panel-body">
          <div v-for="clause in linked" :key="clause.id" class="clause">
            <div class="ct"><span>{{ clause.clause }}</span><span>{{ clause.title }}</span><span class="sim-badge">模拟条款</span></div>
            <div class="ctext">{{ clause.text }}</div>
            <div class="cmeta">
              <span>制度：{{ clause.doc }}（{{ clause.docVersion }}）</span>
              <span>适用：{{ clause.scope }}</span>
              <span>生效：{{ clause.effectiveFrom }}</span>
              <span>来源：{{ clause.source }}</span>
            </div>
          </div>
        </div>
      </div>

      <div v-if="node.children && node.children.length" class="panel">
        <div class="panel-head"><h3>子规则（{{ node.children.length }}）</h3></div>
        <div class="panel-body tight">
          <table class="tbl compact">
            <thead>
              <tr><th>顺序</th><th>name</th><th>名称</th><th>权重</th><th>条件摘要</th></tr>
            </thead>
            <tbody>
              <tr v-for="(child, childIndex) in node.children" :key="child.name" class="clickable" @click="openChild(child, childIndex)">
                <td>{{ childIndex + 1 }}</td>
                <td class="mono">{{ child.name }}</td>
                <td>{{ child.label }}</td>
                <td>{{ childWeight(child) }}</td>
                <td class="dim">{{ summarizeWhen(child.when, book) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <details class="panel" style="margin-bottom: 0">
        <summary class="panel-head" style="cursor: pointer"><h3>查看结构化规则对象（JSON）</h3></summary>
        <div class="panel-body"><div class="codeblock">{{ JSON.stringify(node, null, 2) }}</div></div>
      </details>
    </template>
    <template #footer>
      <button type="button" class="btn" @click="copyJson">复制 JSON</button>
    </template>
  </Drawer>
  <Teleport to="body">
    <div v-if="toast" class="toasts"><div class="toast ok">{{ toast }}</div></div>
  </Teleport>
</template>
