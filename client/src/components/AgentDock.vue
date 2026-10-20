<script setup>
import { computed, nextTick, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { sendAgentChat } from "@/api/agent";

const route = useRoute();
const router = useRouter();
const open = ref(false);
const text = ref("");
const sending = ref(false);
const box = ref(null);
const chats = ref({});

const role = computed(() => ({
  name: "风险暴露权重智能体",
  role: "先做权重判断，再按名单做后续计算。",
  welcome: "先给出信用风险底稿 .xlsx。权重判断按分类规则取权重和敞口。转换系数、缓释和汇总还没进名单时会停住，不会另编一套数。"
}));
const thread = computed(() => chats.value[route.path] || [{ role: "bot", text: role.value.welcome, meta: role.value.name }]);

watch(route, () => {
  if (!chats.value[route.path]) {
    chats.value = { ...chats.value, [route.path]: [{ role: "bot", text: role.value.welcome, meta: role.value.name }] };
  }
}, { immediate: true });

function scroll() {
  nextTick(() => {
    if (box.value) box.value.scrollTop = box.value.scrollHeight;
  });
}

async function send(content) {
  const value = String(content || "").trim();
  if (!value || sending.value) return;
  const history = thread.value.filter((item) => item.role === "user" || item.meta !== "…");
  const next = history.concat([
    { role: "user", text: value, meta: "你" },
    { role: "bot", text: "正在交给智能体", meta: role.value.name, pending: true }
  ]);
  chats.value = { ...chats.value, [route.path]: next };
  text.value = "";
  sending.value = true;
  scroll();
  try {
    const payload = history.filter((item) => item.role === "user" || item.role === "bot").slice(-7).map((item) => ({
      role: item.role === "bot" ? "assistant" : "user",
      content: item.text
    })).concat([{ role: "user", content: value }]);
    const data = await sendAgentChat(route.path, payload);
    const pages = data.pages || [];
    next[next.length - 1] = { role: "bot", text: data.reply || "没有返回", meta: role.value.name, pages };
    chats.value = { ...chats.value, [route.path]: next.slice() };
    if (pages[0]) router.push(pages[0].path);
  } catch (err) {
    const message = (err.response && err.response.data && err.response.data.error) || "智能体暂时没有连上。";
    next[next.length - 1] = { role: "bot", text: message, meta: role.value.name };
    chats.value = { ...chats.value, [route.path]: next.slice() };
  } finally {
    sending.value = false;
    scroll();
  }
}
</script>

<template>
  <div>
    <button type="button" class="agent-fab" :class="{ open }" :title="role.name" @click="open = !open">
      {{ open ? "×" : "AI" }}
    </button>
    <aside v-show="open" class="agent-panel" aria-label="规则智能体">
      <div class="agent-head">
        <div class="agent-avatar">AI</div>
        <div><strong>{{ role.name }}</strong><span>{{ role.role }}</span></div>
        <button type="button" class="agent-close" aria-label="关闭" @click="open = false">×</button>
      </div>
      <div class="agent-chips">
        <button type="button" @click="send('现在的计算做到哪一步')">计算做到哪一步</button>
        <button type="button" @click="send('权重判断之后还有哪些计算')">后续计算</button>
      </div>
      <div ref="box" class="agent-msgs">
        <div v-for="(item, index) in thread" :key="index" class="bubble" :class="item.role === 'user' ? 'user' : 'bot'">
          <span class="meta">{{ item.meta }}</span>
          <span v-if="item.pending" class="spin"></span>{{ item.text }}
          <div v-if="item.pages && item.pages.length" class="acts">
            <button v-for="page in item.pages" :key="page.path" type="button" class="primary" @click="router.push(page.path)">{{ page.label }}</button>
          </div>
        </div>
      </div>
      <form class="agent-input" @submit.prevent="send(text)">
        <input v-model="text" placeholder="给出底稿路径，或问后续计算" :disabled="sending" />
        <button type="submit" :disabled="sending">发送</button>
      </form>
    </aside>
  </div>
</template>
