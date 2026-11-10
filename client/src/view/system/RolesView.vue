<script setup>
import { ref } from "vue";
import { useRouter } from "vue-router";
import { createRole, fetchRoles, saveRole, toggleRole } from "@/api/admin";
import { auth } from "@/utils/auth";
import AsyncView from "@/components/AsyncView.vue";
import Drawer from "@/components/Drawer.vue";

const router = useRouter();
const view = ref(null);
const form = ref(null);
const error = ref("");
const saving = ref(false);
const note = ref("");

const load = () => fetchRoles();

function blank() {
  return { creating: true, id: "", name: "", description: "", status: "on" };
}

function create() {
  error.value = "";
  form.value = blank();
}

function edit(row) {
  error.value = "";
  form.value = { ...row, creating: false };
}

async function refresh() {
  if (view.value) await view.value.reload();
}

async function save() {
  error.value = "";
  if (!form.value.name.trim()) {
    error.value = "角色名称不能为空";
    return;
  }
  saving.value = true;
  try {
    const body = {
      name: form.value.name.trim(),
      description: form.value.description,
      status: form.value.status,
      actor: auth.user ? auth.user.name : ""
    };
    if (form.value.creating) await createRole(body);
    else await saveRole(form.value.id, body);
    form.value = null;
    note.value = "角色已保存";
    await refresh();
  } catch (err) {
    error.value = err.message;
  } finally {
    saving.value = false;
  }
}

async function toggle(row) {
  saving.value = true;
  try {
    await toggleRole(row.id, { actor: auth.user ? auth.user.name : "" });
    note.value = row.status === "on" ? "已停用 " + row.name : "已启用 " + row.name;
    await refresh();
  } catch (err) {
    note.value = err.message;
  } finally {
    saving.value = false;
  }
}

function permissions(row) {
  router.push({ path: "/system/permissions", query: { role: row.id } });
}
</script>

<template>
  <p v-if="note" class="notice info">{{ note }}</p>
  <div class="inline-fields" style="margin-bottom: 12px">
    <button type="button" class="btn sm primary" @click="create">＋ 新增角色</button>
    <span class="sub">角色停用后，其下账号保留数据但无法登录。</span>
  </div>
  <AsyncView ref="view" :load="load">
    <template #default="{ data }">
      <div class="panel">
        <div class="panel-head"><h3>角色列表</h3><span class="sub">{{ data.length }} 个角色</span></div>
        <div class="panel-body tight">
          <table class="tbl compact">
            <thead>
              <tr><th>角色</th><th>描述</th><th style="text-align: right">用户数</th><th style="text-align: right">菜单权限</th><th>状态</th><th style="width: 230px">操作</th></tr>
            </thead>
            <tbody>
              <tr v-for="row in data" :key="row.id">
                <td>
                  <strong>{{ row.name }}</strong>
                  <div class="mono dim">{{ row.id }}{{ row.isSuper ? " · 内置" : "" }}</div>
                </td>
                <td>{{ row.description || "—" }}</td>
                <td style="text-align: right">{{ row.userCount }}</td>
                <td style="text-align: right">{{ row.isSuper ? "全部" : row.menuCount + " 个" }}</td>
                <td><span class="tag" :class="row.status === 'on' ? 'ok' : 'muted'">{{ row.status === "on" ? "已启用" : "已停用" }}</span></td>
                <td>
                  <div class="adm-actions">
                    <button type="button" class="btn ghost xs" @click="edit(row)">编辑</button>
                    <button type="button" class="btn ghost xs" @click="permissions(row)">配置权限</button>
                    <span v-if="row.isSuper" class="tag muted">不可停用</span>
                    <button v-else type="button" class="btn ghost xs" @click="toggle(row)">{{ row.status === "on" ? "停用" : "启用" }}</button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </AsyncView>

  <div class="adm-notes">
    <div class="panel">
      <div class="panel-head"><h3>角色权限说明</h3></div>
      <div class="panel-body">
        <ul class="tight-list">
          <li><b>超级管理员</b>：全部菜单、用户与配置权限，不可停用。</li>
          <li><b>验证主管</b>：全部项目读写、审批与配置查看。</li>
          <li><b>验证经理 / 专员</b>：按机构授权读写与执行；不进入系统配置。</li>
          <li><b>审批人 / 只读</b>：以查看与审批为主，不修改结构。</li>
        </ul>
      </div>
    </div>
    <div class="panel">
      <div class="panel-head"><h3>权限变更影响</h3></div>
      <div class="panel-body">
        <p>修改角色菜单后，左侧导航在账号下次登录或刷新后按新权限重绘；正在编辑的业务数据不会回滚。用户级机构授权仍独立控制任务与数据的使用范围。</p>
        <p class="notice warn">真实环境中角色变更应走审批流程，并记录变更前后差异。</p>
      </div>
    </div>
  </div>

  <Drawer :open="!!form" :title="form ? (form.creating ? '新增角色' : '编辑角色 · ' + form.name) : ''" @close="form = null">
    <p v-if="error" class="notice danger">{{ error }}</p>
    <div v-if="form" class="reg-form-grid">
      <label class="field">角色名称
        <input v-model="form.name" type="text" />
      </label>
      <label class="field">状态
        <select v-model="form.status">
          <option value="on">启用</option>
          <option value="off">停用</option>
        </select>
      </label>
      <label class="field full">描述
        <input v-model="form.description" type="text" />
      </label>
      <p class="field full hint">菜单权限在「权限管理」页签中配置。</p>
    </div>
    <template #footer>
      <span class="spacer"></span>
      <button type="button" class="btn" :disabled="saving" @click="form = null">取消</button>
      <button type="button" class="btn primary" :disabled="saving" @click="save">{{ saving ? "正在保存" : "保存" }}</button>
    </template>
  </Drawer>
</template>
