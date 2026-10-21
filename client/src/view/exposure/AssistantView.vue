<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { fetchAssistant, sendRuleChat } from "@/api/assistant";
import RuleDetail from "@/components/RuleDetail.vue";
import TreeNode from "@/components/TreeNode.vue";

const router = useRouter();
const loading = ref(true);
const error = ref("");
const script = ref([]);
const shown = ref([]);
const draft = ref(null);
const saved = ref(false);
const toast = ref("");
const detail = ref(null);
const chatEl = ref(null);
const text = ref("");
const sending = ref(false);
let timer = 0;
let cursor = 0;

const savedNode = {
  name: "fi_bank_credit_cooperative",
  label: "农村信用合作社（银行档）",
  when: {
    all: [
      { field: "counterparty_type", op: "eq", match: "commercial_bank" },
      { field: "is_credit_cooperative", op: "eq", match: "yes" }
    ]
  },
  value: 0.5,
  note: "【模拟·由自然语言助手生成】交易对手为农村信用合作社，归入商业银行风险暴露第二档中长期，权重 50%。关联第22条。"
};

function ping(text, kind) {
  toast.value = kind + "|" + text;
  clearTimeout(ping.timer);
  ping.timer = setTimeout(() => { toast.value = ""; }, 2200);
}

function stop() {
  clearTimeout(timer);
  timer = 0;
}

async function reveal() {
  await nextTick();
  const box = chatEl.value;
  if (box) box.scrollTop = box.scrollHeight;
}

function step() {
  if (cursor >= script.value.length) return;
  const turn = script.value[cursor++];
  shown.value = [...shown.value, turn];
  if (turn.draft) draft.value = turn.draft;
  reveal();
  if (cursor >= script.value.length || turn.draft) return;
  timer = setTimeout(step, turn.role === "user" ? 700 : 900);
}

function replay() {
  stop();
  shown.value = [];
  draft.value = null;
  saved.value = false;
  detail.value = null;
  cursor = 0;
  step();
}

function rich(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\n/g, "<br>");
}

function onKey(event) {
  if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
  event.preventDefault();
  send();
}

async function send() {
  const content = text.value.trim();
  if (!content || sending.value) return;
  stop();
  cursor = script.value.length;
  text.value = "";
  const pending = { role: "assistant", text: "正在问知识库…", pending: true };
  shown.value = [...shown.value, { role: "user", text: content }, pending];
  sending.value = true;
  reveal();
  try {
    const messages = shown.value
      .filter((item) => item.text && !item.pending)
      .map((item) => ({ role: item.role === "user" ? "user" : "assistant", content: item.text }))
      .slice(-8);
    const result = await sendRuleChat(messages);
    pending.text = (result && result.reply) || "没有返回回答";
  } catch (err) {
    pending.text = err.message || "这次没有问成";
    pending.fail = true;
  } finally {
    pending.pending = false;
    shown.value = shown.value.slice();
    sending.value = false;
    reveal();
  }
}

function saveDraft() {
  saved.value = true;
  ping("规则已记在这次对话里。监管分类树本身没有改。", "ok");
  reveal();
}

onMounted(async () => {
  try {
    script.value = await fetchAssistant();
    step();
  } catch (err) {
    error.value = err.message || "加载失败";
  } finally {
    loading.value = false;
  }
});

onBeforeUnmount(stop);
</script>

<template>
  <div v-if="loading" class="loading"><span class="spin"></span>正在从接口读取</div>
  <div v-else-if="error" class="notice danger">{{ error }}</div>
  <div v-else class="panel">
    <div class="panel-head">
      <h3>对话式规则配置</h3>
      <span class="sub">示例：针对当前澳门监管版本下的对公贷款，新增一条针对特定交易对手类型的暴露分类规则</span>
    </div>
    <div class="panel-body">
      <div ref="chatEl" class="chat">
        <div v-for="(turn, index) in shown" :key="index" class="msg" :class="turn.role === 'user' ? 'user' : 'assistant'">
          <div class="mav">{{ turn.role === "user" ? "我" : "AI" }}</div>
          <div class="mb">
            <div v-html="rich(turn.text)"></div>
            <div v-if="turn.extract" class="extract-grid">
              <template v-for="item in turn.extract" :key="item.k">
                <div class="ek">{{ item.k }}</div>
                <div>{{ item.v }}</div>
              </template>
            </div>
            <div v-if="turn.ask" style="margin-top: 8px; color: var(--warn)">？ {{ turn.ask }}</div>
            <template v-if="turn.draft">
              <div class="cond-group-label" style="margin-top: 9px">转换为结构化规则：</div>
              <div class="codeblock">{{ JSON.stringify(turn.draft, null, 2) }}</div>
            </template>
            <template v-if="turn.checks">
              <div class="cond-group-label" style="margin-top: 9px">校验提示：</div>
              <div v-for="(item, checkIndex) in turn.checks" :key="checkIndex" class="notice" :class="item.level === 'warn' ? 'warn' : 'info'" style="margin: 6px 0 0">
                <span class="ni">{{ item.level === "warn" ? "!" : "ℹ" }}</span>
                <div>{{ item.text }}</div>
              </div>
            </template>
            <div v-if="turn.treeEffect" class="notice info" style="margin-top: 8px">
              <span class="ni">⑃</span>
              <div>{{ turn.treeEffect }}</div>
            </div>
          </div>
        </div>
      </div>

      <div class="chat-compose">
        <textarea
          v-model="text"
          rows="2"
          placeholder="输入要问的规则或条款，回车发送"
          :disabled="sending"
          @keydown="onKey"
        ></textarea>
        <button type="button" class="btn primary" :disabled="sending || !text.trim()" @click="send">发送</button>
      </div>

      <div style="margin-top: 14px; border-top: 1px solid var(--line-2); padding-top: 12px">
        <div v-if="saved" class="notice ok">
          <span class="ni">✓</span>
          <div>草稿已确认。它挂在「对商业银行的暴露」下面，作为这次对话的结果。监管分类决策树没有被改写。</div>
        </div>
        <div v-if="draft && !saved" class="btn-group">
          <button type="button" class="btn primary" @click="saveDraft">✓ 确认并保存规则</button>
          <button type="button" class="btn" @click="draft = null; ping('已丢弃草稿，未写入规则集', 'warn')">丢弃草稿</button>
          <button type="button" class="btn ghost" @click="detail = savedNode">查看规则详情</button>
          <button type="button" class="btn ghost" @click="ping('已采纳建议：规则挂在「对商业银行的暴露」之下，不改变外层顺序', 'ok')">采纳建议：挂到商业银行节点下</button>
        </div>
        <div class="btn-group" style="margin-top: 8px">
          <button type="button" class="btn" @click="replay">{{ shown.length ? "重新播放模拟对话" : "▶ 播放模拟对话" }}</button>
        </div>
      </div>

      <div v-if="saved" class="panel" style="margin-top: 14px; margin-bottom: 0">
        <div class="panel-head">
          <h3>这次对话确认的规则</h3>
          <span class="sub">农村信用合作社，作为商业银行风险暴露的子档</span>
        </div>
        <div class="panel-body">
          <div class="tree-canvas" style="max-height: 220px">
            <TreeNode :node="savedNode" path="/draft:fi_bank_credit_cooperative" />
          </div>
          <div class="btn-group" style="margin-top: 10px">
            <button type="button" class="btn sm primary" @click="router.push('/tree')">在完整决策树中查看</button>
          </div>
        </div>
      </div>
    </div>
  </div>

  <RuleDetail
    :node="detail"
    path="草稿（尚未保存）"
    @close="detail = null"
  />
  <Teleport to="body">
    <div v-if="toast" class="toasts">
      <div class="toast" :class="toast.startsWith('warn') ? 'warn' : 'ok'">{{ toast.slice(toast.indexOf('|') + 1) }}</div>
    </div>
  </Teleport>
</template>
