<script setup>
import { ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { loginSession } from "@/api/admin";
import { setSession } from "@/utils/auth";

const router = useRouter();
const route = useRoute();
const username = ref("");
const password = ref("");
const remember = ref(true);
const showPassword = ref(false);
const error = ref("");
const busy = ref(false);

const demo = [
  { u: "admin", p: "admin123", n: "王静", r: "超级管理员" },
  { u: "liuyang", p: "ecl2026", n: "刘洋", r: "验证主管" },
  { u: "wangjing", p: "ecl2026", n: "李强", r: "验证经理" },
  { u: "reviewer", p: "ecl2026", n: "外部评审", r: "只读 · 已停用" }
];

function fill(item) {
  username.value = item.u;
  password.value = item.p;
  error.value = "";
}

async function submit() {
  if (busy.value) return;
  error.value = "";
  if (!username.value.trim() || !password.value) {
    error.value = "请输入用户名和密码";
    return;
  }
  busy.value = true;
  try {
    const data = await loginSession({
      username: username.value.trim(),
      password: password.value,
      device: navigator.userAgent,
      remember: remember.value
    });
    setSession(data, remember.value);
    const redirect = typeof route.query.redirect === "string" ? route.query.redirect : "/";
    router.replace(redirect === "/login" ? "/" : redirect);
  } catch (err) {
    error.value = err.message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="login-page">
    <section class="lg-brand">
      <div class="lg-brand-top">
        <span class="lg-mark">BR</span>
        银行Bank return 计算工作平台
      </div>
      <div class="lg-hero">
        <div class="lg-kicker">CREDIT RISK RWA WORKBENCH</div>
        <h1>监管规则、计量任务<br />与结果留痕，在一个工作台完成</h1>
        <p>按司法管辖区维护规则版本，按季度组织主任务与子任务，计量向导把风险权重、EAD、RWA 和计算过程写回工作簿。系统管理统一维护账号、角色权限、操作日志与模型调用。</p>
        <div class="lg-points">
          <div><b>01</b><span>监管规则版本</span><em>资本充足率与流动性配置分开维护，版本信息一处录入、各配置页共用。</em></div>
          <div><b>02</b><span>任务工作台</span><em>一个季度一个主任务，资本充足率与流动性子任务分别执行并归档。</em></div>
          <div><b>03</b><span>权限与留痕</span><em>角色控制可见菜单，登录、配置变更和模型调用均留记录。</em></div>
        </div>
      </div>
      <div class="lg-brand-foot">
        <span>演示环境 · 业务数据为模拟数据</span>
        <span>v1.0</span>
      </div>
    </section>

    <section class="lg-panel">
      <div class="lg-card">
        <div class="lg-card-head">
          <span class="lg-mark sm">BR</span>
          <div>
            <h2>登录工作台</h2>
            <p>使用平台账号进入监管规则配置与计量任务</p>
          </div>
        </div>
        <form class="lg-form" @submit.prevent="submit">
          <label class="lg-label" for="loginUser">用户名</label>
          <div class="lg-input">
            <span>@</span>
            <input id="loginUser" v-model="username" type="text" autocomplete="username" placeholder="请输入用户名" />
          </div>
          <label class="lg-label" for="loginPass">密码</label>
          <div class="lg-input">
            <span>••</span>
            <input id="loginPass" v-model="password" :type="showPassword ? 'text' : 'password'" autocomplete="current-password" placeholder="请输入密码" />
            <button type="button" class="lg-eye" @click="showPassword = !showPassword">{{ showPassword ? "隐藏" : "显示" }}</button>
          </div>
          <div class="lg-row">
            <label class="lg-check"><input v-model="remember" type="checkbox" /> 记住登录状态</label>
            <span class="lg-help">忘记密码请联系管理员</span>
          </div>
          <p v-if="error" class="lg-error">{{ error }}</p>
          <button type="submit" class="btn primary lg-submit" :disabled="busy">{{ busy ? "正在登录" : "登录" }}</button>
        </form>

        <div class="lg-demo">
          <div class="lg-demo-h"><b>演示账号</b><span>点击填入，密码随账号带出</span></div>
          <button v-for="item in demo" :key="item.u" type="button" class="lg-demo-row" @click="fill(item)">
            <span class="lg-av">{{ item.n.slice(0, 1) }}</span>
            <span class="lg-demo-b"><b>{{ item.n }} · {{ item.r }}</b><em>{{ item.u }} / {{ item.p }}</em></span>
            <span class="lg-demo-u">填入</span>
          </button>
        </div>
        <p class="lg-foot">登录会写入登录日志。账号或所属角色停用后无法登录。生产环境应由服务端会话与密钥托管替代本机演示登录。</p>
      </div>
    </section>
  </div>
</template>
