<script setup>
import { computed, ref } from "vue";
import { createLlmConfig, fetchLlmConfigs, saveLlmConfig, setDefaultLlmConfig, testLlmConfig, toggleLlmConfig } from "@/api/admin";
import { auth } from "@/utils/auth";
import AsyncView from "@/components/AsyncView.vue";
import Drawer from "@/components/Drawer.vue";

const view = ref(null);
const form = ref(null);
const error = ref("");
const saving = ref(false);
const note = ref("");
const noteKind = ref("info");

const me = computed(() => auth.user || {});
const owner = computed(() => (auth.user ? auth.user.username : ""));

const load = () => fetchLlmConfigs(owner.value);

const providers = ["DeepSeek", "阿里云百炼", "Ollama", "OpenAI Compatible"];

function blank() {
  return {
    creating: true,
    id: "",
    name: "",
    provider: "DeepSeek",
    base: "https://api.deepseek.com",
    model: "deepseek-chat",
    apiKey: "",
    temperature: 0.2,
    maxTokens: 8192,
    timeout: 60,
    status: "on",
    isDefault: false
  };
}

function create() {
  error.value = "";
  form.value = blank();
}

function edit(row) {
  error.value = "";
  form.value = { ...row, creating: false, apiKey: "" };
}

async function refresh() {
  if (view.value) await view.value.reload();
}

function actor() {
  return me.value.name || me.value.username;
}

async function save() {
  error.value = "";
  if (!form.value.name.trim() || !form.value.base.trim() || !form.value.model.trim()) {
    error.value = "配置名称、Base URL、模型不能为空";
    return;
  }
  saving.value = true;
  try {
    const body = {
      owner: owner.value,
      name: form.value.name.trim(),
      provider: form.value.provider,
      base: form.value.base.trim(),
      model: form.value.model.trim(),
      apiKey: form.value.apiKey,
      temperature: form.value.temperature,
      maxTokens: form.value.maxTokens,
      timeout: form.value.timeout,
      status: form.value.status,
      isDefault: form.value.isDefault,
      actor: actor()
    };
    if (form.value.creating) await createLlmConfig(body);
    else await saveLlmConfig(form.value.id, body);
    form.value = null;
    note.value = "配置已保存";
    noteKind.value = "ok";
    await refresh();
  } catch (err) {
    error.value = err.message;
  } finally {
    saving.value = false;
  }
}

async function toggle(row) {
  try {
    await toggleLlmConfig(row.id, { owner: owner.value, actor: actor() });
    note.value = row.status === "on" ? "已停用 " + row.name : "已启用 " + row.name;
    noteKind.value = "info";
    await refresh();
  } catch (err) {
    note.value = err.message;
    noteKind.value = "danger";
  }
}

async function makeDefault(row) {
  try {
    await setDefaultLlmConfig(row.id, { owner: owner.value, actor: actor() });
    note.value = "已将「" + row.name + "」设为当前账号的默认模型";
    noteKind.value = "ok";
    await refresh();
  } catch (err) {
    note.value = err.message;
    noteKind.value = "danger";
  }
}

async function test(row) {
  try {
    const result = await testLlmConfig(row.id, { owner: owner.value, actor: actor() });
    note.value = `连接成功 · ${result.model} · 模拟延迟 ${result.latencyMs} ms · 鉴权 ${result.auth} · ${result.at}`;
    noteKind.value = "ok";
    await refresh();
  } catch (err) {
    note.value = err.message;
    noteKind.value = "danger";
  }
}
</script>

<template>
  <p class="notice info">
    当前账号：<b>{{ me.name }}</b>（{{ me.username }}）· 仅显示本账号的模型配置。API Key 只回传掩码；编辑时留空表示不修改。
  </p>
  <p v-if="note" class="notice" :class="noteKind">{{ note }}</p>

  <AsyncView ref="view" :load="load">
    <template #default="{ data }">
      <div class="inline-fields" style="margin-bottom: 12px">
        <button type="button" class="btn sm primary" @click="create">＋ 新增配置</button>
        <span class="sub">{{ data.length }} 个配置 · 每个账号只能维护自己的模型服务</span>
      </div>

      <div v-if="!data.length" class="panel">
        <div class="panel-body dim">当前账号尚未配置大模型。新增后，本账号的对话和计量助手会使用这里的默认模型。</div>
      </div>

      <div v-else class="adm-llm-grid">
        <div v-for="row in data" :key="row.id" class="adm-llm-card" :class="{ def: row.isDefault }">
          <div class="adm-llm-h">
            <span class="adm-provider">{{ row.provider || "未指定服务商" }}</span>
            <span v-if="row.isDefault" class="tag ok">我的默认</span>
            <span class="tag" :class="row.status === 'on' ? 'ok' : 'muted'">{{ row.status === "on" ? "已启用" : "已停用" }}</span>
          </div>
          <div class="adm-llm-name">{{ row.name }}<span class="mono">{{ row.id }}</span></div>
          <div class="adm-llm-meta">
            <div><span>模型</span><b class="mono">{{ row.model }}</b></div>
            <div><span>Base URL</span><b class="mono" :title="row.base">{{ row.base }}</b></div>
            <div><span>参数</span><b>temp {{ row.temperature }} · {{ row.maxTokens }} tokens · {{ row.timeout }}s</b></div>
            <div><span>鉴权</span><b class="mono">{{ row.keyMasked }}</b></div>
            <div><span>最近测试</span><b class="mono">{{ row.lastTest || "—" }}</b></div>
            <div><span>调用次数</span><b>{{ row.calls }}</b></div>
          </div>
          <div class="adm-llm-a">
            <button type="button" class="btn ghost xs" @click="test(row)">测试连接</button>
            <button type="button" class="btn ghost xs" @click="edit(row)">编辑</button>
            <button type="button" class="btn ghost xs" :disabled="row.isDefault" @click="makeDefault(row)">设为默认</button>
            <button type="button" class="btn ghost xs" @click="toggle(row)">{{ row.status === "on" ? "停用" : "启用" }}</button>
          </div>
        </div>
      </div>
    </template>
  </AsyncView>

  <Drawer :open="!!form" :title="form ? (form.creating ? '新增大模型配置' : '编辑大模型 · ' + form.name) : ''" wide @close="form = null">
    <p v-if="error" class="notice danger">{{ error }}</p>
    <div v-if="form" class="reg-form-grid">
      <label class="field">配置名称
        <input v-model="form.name" type="text" placeholder="例如：DeepSeek V4" />
      </label>
      <label class="field">服务商
        <input v-model="form.provider" type="text" list="llmProviders" />
        <datalist id="llmProviders"><option v-for="item in providers" :key="item" :value="item" /></datalist>
      </label>
      <label class="field full">Base URL
        <input v-model="form.base" type="text" placeholder="https://api.deepseek.com" />
      </label>
      <label class="field">模型
        <input v-model="form.model" type="text" placeholder="deepseek-chat" />
      </label>
      <label class="field">API Key
        <input v-model="form.apiKey" type="text" :placeholder="form.creating ? 'sk-...' : '留空表示不修改现有密钥'" />
      </label>
      <label class="field">Temperature
        <input v-model.number="form.temperature" type="number" step="0.1" min="0" max="2" />
      </label>
      <label class="field">最大 Token
        <input v-model.number="form.maxTokens" type="number" />
      </label>
      <label class="field">超时（秒）
        <input v-model.number="form.timeout" type="number" />
      </label>
      <label class="field">状态
        <select v-model="form.status">
          <option value="on">启用</option>
          <option value="off">停用</option>
        </select>
      </label>
      <label class="field full check">
        <span><input v-model="form.isDefault" type="checkbox" /> 设为当前账号的默认模型</span>
      </label>
    </div>
    <template #footer>
      <span class="spacer"></span>
      <button type="button" class="btn" :disabled="saving" @click="form = null">取消</button>
      <button type="button" class="btn primary" :disabled="saving" @click="save">{{ saving ? "正在保存" : "保存" }}</button>
    </template>
  </Drawer>
</template>
