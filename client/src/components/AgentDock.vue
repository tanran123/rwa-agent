<script setup>
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { sendAgentChat } from "@/api/agent";
import { AGENT_FORMS, AGENT_PAGES, apisFor } from "@/utils/agentCatalog";
import { agentHtml } from "@/utils/agentText";
import { readAgentForms, useAgentFormSlot } from "@/composables/useAgentForm";
import { fetchExposureChat, fetchExposureClasses, proposeExposureTree, saveExposureChat, saveExposureTree } from "@/api/exposure";
import { useContext } from "@/composables/useContext";

const agentForms = useAgentFormSlot();
const route = useRoute();
const router = useRouter();
const { session, scopeVersion } = useContext();
const formSet = {};
AGENT_FORMS.forEach((item) => { formSet[item.id] = item.path; });
const open = ref(false);
const text = ref("");
const sending = ref(false);
const box = ref(null);
const dock = ref(null);
const chats = ref({});
const threads = ref({});
const dragging = ref(false);
let moved = false;

function loadPlace() {
  try {
    const raw = localStorage.getItem("rwa.agentDock");
    const body = raw ? JSON.parse(raw) : null;
    if (body && Number.isFinite(body.x) && Number.isFinite(body.y)) return { x: body.x, y: body.y };
  } catch (err) {
    return null;
  }
  return null;
}

function clampPlace(x, y, width, height) {
  const maxX = Math.max(8, window.innerWidth - width - 8);
  const maxY = Math.max(8, window.innerHeight - height - 8);
  return {
    x: Math.min(maxX, Math.max(8, x)),
    y: Math.min(maxY, Math.max(8, y))
  };
}

const place = ref(loadPlace());
const dockStyle = computed(() => (place.value ? { left: place.value.x + "px", top: place.value.y + "px" } : {}));
const dockBelow = computed(() => {
  const y = place.value ? place.value.y : window.innerHeight - 80;
  const below = window.innerHeight - y - 60;
  return below > y;
});
const panelHeight = computed(() => {
  const y = place.value ? place.value.y : window.innerHeight - 80;
  const room = dockBelow.value ? window.innerHeight - y - 80 : y - 16;
  return Math.max(320, Math.min(780, room)) + "px";
});
const dockStart = computed(() => {
  const x = place.value ? place.value.x : window.innerWidth - 180;
  return x < 260;
});

onMounted(() => {
  if (!place.value || !dock.value) return;
  const rect = dock.value.getBoundingClientRect();
  place.value = clampPlace(place.value.x, place.value.y, rect.width, rect.height);
});

function startDrag(event) {
  if (event.button !== 0) return;
  const fromFab = event.target.closest(".agent-fab");
  const fromHead = event.target.closest(".agent-head");
  if (!fromFab && !fromHead) return;
  if (event.target.closest(".agent-close")) return;
  const node = dock.value;
  if (!node) return;
  const rect = node.getBoundingClientRect();
  const startX = event.clientX;
  const startY = event.clientY;
  moved = false;
  const move = (e) => {
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (!moved && Math.hypot(dx, dy) < 4) return;
    moved = true;
    dragging.value = true;
    place.value = clampPlace(rect.left + dx, rect.top + dy, rect.width, rect.height);
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    dragging.value = false;
    if (moved && place.value) {
      try { localStorage.setItem("rwa.agentDock", JSON.stringify(place.value)); } catch (err) { /* 位置记不住就留在这一次 */ }
    }
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

function toggle() {
  if (moved) {
    moved = false;
    return;
  }
  open.value = !open.value;
}

const isTree = computed(() => !!route.meta.chart);
const treeLabel = ref("");
const drafts = ref({});
const hydrated = {};
const saveTimers = {};
const chatKey = computed(() => (isTree.value ? "tree:" + scopeVersion.value + ":" + (route.params.name || "root") : route.path));
const role = computed(() => (isTree.value
  ? {
    name: "决策树助手",
    welcome: "可以说要改哪一条，也可以说要新增哪一类。改的话我先说明现在的意思。新增的话我按监管条款，从通用分类往外扩。"
  }
  : {
    name: "风险暴露权重智能体",
    role: "先做权重判断，再按名单做后续计算。",
    welcome: "先给出信用风险底稿 .xlsx。权重判断按分类规则取权重和敞口。转换系数、缓释和汇总还没进名单时会停住，不会另编一套数。"
  }));
const thread = computed(() => chats.value[chatKey.value] || [{ role: "bot", text: role.value.welcome, meta: role.value.name }]);
const awaitingRun = computed(() => {
  const rows = thread.value;
  const last = rows[rows.length - 1];
  return !!(last && last.offerRun);
});

watch(() => (isTree.value ? scopeVersion.value + "\n" + (route.params.name || "root") : ""), async () => {
  if (!isTree.value) return;
  const rows = (await fetchExposureClasses(scopeVersion.value)) || [];
  const name = route.params.name || "";
  const item = name ? rows.find((row) => row.name === name) : rows[0];
  treeLabel.value = item ? item.label : "";
}, { immediate: true });

function welcomeThread() {
  return [{ role: "bot", text: role.value.welcome, meta: role.value.name }];
}

function chatName(key) {
  const body = String(key || "");
  if (!body.startsWith("tree:")) return "";
  const rest = body.slice("tree:".length);
  const cut = rest.indexOf(":");
  const name = cut < 0 ? rest : rest.slice(cut + 1);
  return !name || name === "root" ? "" : name;
}

watch(chatKey, async (key) => {
  if (!String(key).startsWith("tree:")) {
    if (!chats.value[key]) chats.value = { ...chats.value, [key]: welcomeThread() };
    return;
  }
  if (hydrated[key]) return;
  hydrated[key] = "loading";
  try {
    const data = await fetchExposureChat(chatName(key), scopeVersion.value);
    const messages = (data.messages || []).filter((item) => item && item.text);
    if (messages.length) {
      chats.value = { ...chats.value, [key]: messages };
      if (data.draft && data.draft.document) {
        drafts.value = {
          ...drafts.value,
          [key]: { document: data.draft.document, stage: data.draft.stage === "save" ? "save" : "draft" }
        };
      }
      hydrated[key] = "ready";
      scroll();
      return;
    }
  } catch (err) {
    hydrated[key] = "";
  }
  if (!chats.value[key] || !chats.value[key].some((item) => item.role === "user")) {
    chats.value = { ...chats.value, [key]: welcomeThread() };
  }
  hydrated[key] = "ready";
}, { immediate: true });

function scheduleSave() {
  if (!isTree.value) return;
  const key = chatKey.value;
  if (hydrated[key] !== "ready") return;
  const rows = chats.value[key] || [];
  if (!rows.some((item) => item.role === "user")) return;
  clearTimeout(saveTimers[key]);
  const snapshot = rows.map((item) => ({ ...item }));
  const draft = drafts.value[key];
  const kept = draft && draft.document ? { stage: draft.stage, document: draft.document } : null;
  saveTimers[key] = setTimeout(() => {
    saveExposureChat(chatName(key), snapshot, kept, scopeVersion.value).catch(() => {});
  }, 400);
}

watch(chats, scheduleSave, { deep: true });
watch(drafts, scheduleSave, { deep: true });

watch(treeLabel, () => {
  if (!isTree.value) return;
  const key = chatKey.value;
  const rows = chats.value[key];
  if (rows && rows.some((row) => row.role === "user")) return;
  chats.value = {
    ...chats.value,
    [key]: [{ role: "bot", text: role.value.welcome, meta: role.value.name }]
  };
});

function scroll() {
  nextTick(() => {
    if (box.value) box.value.scrollTop = box.value.scrollHeight;
  });
}

function plain(value) {
  return String(value || "").trim().replace(/[。！!？?\s]/g, "");
}

function saidYes(value) {
  return ["确认", "确认了", "就这样", "可以", "没问题", "好的", "对", "对的"].indexOf(plain(value)) >= 0;
}

function saidSave(value) {
  return ["保存", "要保存", "需要保存", "保存吧"].indexOf(plain(value)) >= 0;
}

function quiet(rows) {
  return rows.map((row) => ({ ...row, offerConfirm: false, offerSave: false, offerRun: false, pending: false }));
}

function catalogBody() {
  const live = {};
  readAgentForms(agentForms).forEach((item) => { live[item.id] = item.fields; });
  const codes = (session.jurisdictions || []).map((item) => item.code);
  const orgs = (session.orgs || []).filter((item) => item.jurisdiction === session.jurisdiction).map((item) => item.name);
  const versions = (session.versions || []).filter((item) => item.jurisdiction === session.jurisdiction).map((item) => item.version);
  const page = AGENT_PAGES.find((item) => item.path === route.path);
  return {
    scope: { jurisdiction: session.jurisdiction || "", version: scopeVersion.value || "" },
    pages: [page || { path: route.path, title: "" }],
    apis: apisFor(route.path),
    forms: AGENT_FORMS.filter((item) => item.path === route.path).map((item) => ({
      path: item.path,
      id: item.id,
      title: item.title,
      fields: (live[item.id] || item.fields || []).map((field) => {
        const next = { key: field.key, label: field.label, options: field.options };
        if (field.key === "jurisdiction" && codes.length) next.options = codes;
        if (field.key === "institution" && orgs.length) next.options = orgs;
        if (field.key === "ruleVersion" && versions.length && !(next.options && next.options.length)) next.options = versions;
        return next;
      })
    }))
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForm(id) {
  for (let i = 0; i < 60; i += 1) {
    const found = readAgentForms(agentForms).find((row) => row.id === id);
    if (found) return found;
    await delay(50);
  }
  return null;
}

function cleanSteps(raw) {
  if (!Array.isArray(raw)) return [];
  const steps = [];
  raw.slice(0, 8).forEach((item) => {
    if (!item || typeof item !== "object") return;
    const form = typeof item.form === "string" && formSet[item.form] === route.path ? item.form : "";
    if (!form) return;
    steps.push({
      path: route.path,
      form,
      fields: item.fields && typeof item.fields === "object" ? item.fields : {},
      save: item.save === true
    });
  });
  return steps;
}

async function runActions(steps) {
  const notes = [];
  for (const step of steps) {
    if (!step.form || formSet[step.form] !== route.path) continue;
    const found = await waitForm(step.form);
    if (!found) {
      notes.push("页面上没有「" + step.form + "」");
      continue;
    }
    const applied = found.apply(step.fields || {});
    if (applied === false) {
      notes.push((found.title || step.form) + "：这一页现在填不进去");
      continue;
    }
    if (!step.save) continue;
    if (!found.save) {
      notes.push((found.title || step.form) + "：这一页不能从对话保存");
      continue;
    }
    try {
      await found.save();
    } catch (err) {
      notes.push((found.title || step.form) + "：" + (err.message || "没有保存"));
    }
  }
  return notes;
}

async function send(content, extra) {
  const decision = extra && (extra.confirm === true || extra.confirm === false) ? extra.confirm : null;
  const value = String(content || "").trim();
  if (!value || sending.value) return;
  if (awaitingRun.value && decision === null) return;
  const key = chatKey.value;
  const history = quiet(thread.value.filter((item) => item.role === "user" || item.meta !== "…"));
  const next = history.concat([
    { role: "user", text: value, meta: "你" },
    { role: "bot", text: "正在交给智能体", meta: role.value.name, pending: true }
  ]);
  chats.value = { ...chats.value, [key]: next };
  text.value = "";
  sending.value = true;
  scroll();
  try {
    const draft = drafts.value[key];
    const label = treeLabel.value || "当前页签";
    if (isTree.value && draft && draft.stage === "draft" && saidYes(value)) {
      drafts.value = { ...drafts.value, [key]: { document: draft.document, stage: "save" } };
      next[next.length - 1] = {
        role: "bot",
        text: "要不要保存到「" + label + "」？",
        meta: role.value.name,
        offerSave: true
      };
      chats.value = { ...chats.value, [key]: next.slice() };
      return;
    }
    if (isTree.value && draft && draft.stage === "save" && saidYes(value)) {
      next[next.length - 1] = {
        role: "bot",
        text: "已经确认过了。要不要保存到「" + label + "」？",
        meta: role.value.name,
        offerSave: true
      };
      chats.value = { ...chats.value, [key]: next.slice() };
      return;
    }
    if (isTree.value && draft && draft.stage === "draft" && saidSave(value)) {
      next[next.length - 1] = {
        role: "bot",
        text: "先确认这次修改。确认之后再决定要不要保存。",
        meta: role.value.name,
        offerConfirm: true
      };
      chats.value = { ...chats.value, [key]: next.slice() };
      return;
    }
    if (isTree.value && draft && draft.stage === "save" && saidSave(value)) {
      next[next.length - 1] = { role: "bot", text: "正在保存", meta: role.value.name, pending: true };
      chats.value = { ...chats.value, [key]: next.slice() };
      const saved = await saveExposureTree({
        action: "update",
        name: route.params.name || "",
        version: scopeVersion.value,
        label: treeLabel.value,
        document: draft.document,
        messages: next.filter((row) => row.role === "user").map((row) => row.text)
      });
      const rest = { ...drafts.value };
      delete rest[key];
      drafts.value = rest;
      next[next.length - 1] = {
        role: "bot",
        text: "已保存到「" + saved.label + "」。画布已更新。",
        meta: role.value.name
      };
      chats.value = { ...chats.value, [key]: next.slice() };
      const rev = String(Date.now());
      router.push(saved.first
        ? { path: "/tree", query: { rev } }
        : { path: "/tree/" + saved.name, query: { rev } });
      return;
    }
    const payload = history.filter((item) => item.role === "user" || item.role === "bot").slice(-7).map((item) => ({
      role: item.role === "bot" ? "assistant" : "user",
      content: item.text
    })).concat([{ role: "user", content: value }]);
    const data = isTree.value
      ? await proposeExposureTree(route.params.name || "", payload, scopeVersion.value)
      : await sendAgentChat(route.path, payload, undefined, threads.value[key], decision, catalogBody());
    if (!isTree.value && data.threadId) {
      threads.value = { ...threads.value, [key]: data.threadId };
    }
    const pages = data.pages || [];
    let reply = data.reply || "没有返回";
    const action = data.action === "update" ? "draft" : data.action;
    if (isTree.value && action === "draft" && data.document) {
      drafts.value = { ...drafts.value, [key]: { document: data.document, stage: "draft" } };
      next[next.length - 1] = { role: "bot", text: reply, meta: role.value.name, offerConfirm: true };
    } else {
      if (isTree.value) {
        const rest = { ...drafts.value };
        delete rest[key];
        drafts.value = rest;
      }
      const steps = !isTree.value ? cleanSteps(data.actions) : [];
      if (steps.length) {
        const notes = await runActions(steps);
        if (notes.length) reply = reply + "\n" + notes.join("\n");
      }
      next[next.length - 1] = {
        role: "bot",
        text: reply,
        meta: role.value.name,
        pages,
        offerRun: !isTree.value && data.confirm === true
      };
    }
    chats.value = { ...chats.value, [key]: next.slice() };
    if (pages[0]) router.push(pages[0].path);
  } catch (err) {
    const message = err.message || "智能体暂时没有连上。";
    next[next.length - 1] = { role: "bot", text: message, meta: role.value.name };
    chats.value = { ...chats.value, [key]: next.slice() };
  } finally {
    sending.value = false;
    scroll();
  }
}
</script>

<template>
  <div
    ref="dock"
    class="agent-dock"
    :class="{ placed: !!place, below: dockBelow, start: dockStart, dragging }"
    :style="dockStyle"
  >
    <button type="button" class="agent-fab" :class="{ open }" :title="role.name" @pointerdown="startDrag" @click="toggle">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 16.5 4.5 20.5 8.8 18.2A8 8 0 1 0 6 16.5z" /></svg>
      {{ isTree ? "决策树助手" : "AI 助手" }}
    </button>
    <aside v-show="open" class="agent-panel" :style="{ height: panelHeight }" aria-label="规则智能体">
      <div class="agent-head" @pointerdown="startDrag">
        <div class="agent-avatar">AI</div>
        <div>
          <strong>{{ role.name }}</strong>
          <span v-if="isTree && treeLabel" class="agent-product">{{ treeLabel }}</span>
          <span v-else-if="role.role">{{ role.role }}</span>
        </div>
        <button type="button" class="agent-close" aria-label="关闭" @click="open = false">×</button>
      </div>
      <div class="agent-chips">
        <button v-if="isTree" type="button" @click="send('我想改一条规则')">改一条规则</button>
        <button v-if="isTree" type="button" @click="send('我想新增一类')">新增一类</button>
        <button v-if="!isTree" type="button" @click="send('现在的计算做到哪一步')">计算做到哪一步</button>
        <button v-if="!isTree" type="button" @click="send('权重判断之后还有哪些计算')">后续计算</button>
      </div>
      <div ref="box" class="agent-msgs">
        <div v-for="(item, index) in thread" :key="index" class="bubble" :class="item.role === 'user' ? 'user' : 'bot'">
          <span class="meta">{{ item.meta }}</span>
          <span v-if="item.pending" class="spin"></span>
          <span v-if="item.pending || item.role === 'user'">{{ item.text }}</span>
          <div v-else class="body" v-html="agentHtml(item.text)"></div>
          <div v-if="item.offerConfirm || item.offerSave || item.offerRun || (item.pages && item.pages.length)" class="acts">
            <button v-if="item.offerConfirm" type="button" class="primary" @click="send('确认')">确认</button>
            <button v-if="item.offerRun" type="button" class="primary" @click="send('确认计算', { confirm: true })">确认</button>
            <button v-if="item.offerRun" type="button" @click="send('取消计算', { confirm: false })">取消</button>
            <button v-if="item.offerSave" type="button" class="primary" @click="send('保存')">保存</button>
            <button v-for="page in item.pages || []" :key="page.path" type="button" class="primary" @click="router.push(page.path)">{{ page.label }}</button>
          </div>
        </div>
      </div>
      <form class="agent-input" @submit.prevent="send(text)">
        <input v-model="text" :placeholder="awaitingRun ? '请先确认或取消这次计算' : (isTree ? '可以说要改哪一条，或要新增哪一类' : '给出底稿路径，或说要在这一页新建、修改')" :disabled="sending || awaitingRun" />
        <button type="submit" :disabled="sending || awaitingRun">发送</button>
      </form>
    </aside>
  </div>
</template>
