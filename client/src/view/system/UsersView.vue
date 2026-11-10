<script setup>
import { computed, ref } from "vue";
import { createUser, fetchRoles, fetchUsers, resetUserPassword, saveUser, toggleUser } from "@/api/admin";
import { useContext } from "@/composables/useContext";
import { auth } from "@/utils/auth";
import { askConfirm } from "@/utils/confirm";
import AsyncView from "@/components/AsyncView.vue";
import Drawer from "@/components/Drawer.vue";

const { session } = useContext();
const view = ref(null);
const form = ref(null);
const error = ref("");
const saving = ref(false);
const note = ref("");
const roles = ref([]);

const me = computed(() => auth.user || {});
const orgOptions = computed(() => session.orgs || []);

const load = async () => {
  const [users, list] = await Promise.all([fetchUsers(), fetchRoles()]);
  roles.value = list;
  return { users, roles: list };
};

function orgLabel(orgs) {
  const list = Array.isArray(orgs) ? orgs : [];
  if (list.includes("*") || !list.length) return "全部机构";
  return list.map((id) => {
    const org = (session.orgs || []).find((item) => item.id === id);
    return org ? org.name : id;
  }).join("、");
}

function blank() {
  return {
    creating: true,
    id: "",
    username: "",
    name: "",
    roleId: "",
    dept: "",
    email: "",
    phone: "",
    password: "",
    status: "on",
    orgs: []
  };
}

function create(roles) {
  error.value = "";
  const next = blank();
  next.roleId = roles && roles.length ? roles[roles.length - 1].id : "";
  form.value = next;
}

function edit(row) {
  error.value = "";
  form.value = { ...row, creating: false, password: "", orgs: [...(row.orgs || [])] };
}

async function refresh() {
  if (view.value) await view.value.reload();
}

async function save() {
  error.value = "";
  const row = form.value;
  if (!row) return;
  if (!row.username.trim() || !row.name.trim()) {
    error.value = "用户名和姓名不能为空";
    return;
  }
  if (!row.roleId) {
    error.value = "请选择角色";
    return;
  }
  saving.value = true;
  try {
    const body = {
      username: row.username.trim(),
      name: row.name.trim(),
      roleId: row.roleId,
      dept: row.dept,
      email: row.email,
      phone: row.phone,
      status: row.status,
      orgs: row.orgs,
      password: row.password || undefined,
      actor: me.value.name || me.value.username
    };
    if (row.creating) await createUser(body);
    else await saveUser(row.id, body);
    form.value = null;
    note.value = "用户已保存";
    await refresh();
  } catch (err) {
    error.value = err.message;
  } finally {
    saving.value = false;
  }
}

async function toggle(row) {
  if (row.id === me.value.id) {
    note.value = "不能停用当前登录账号";
    return;
  }
  saving.value = true;
  try {
    await toggleUser(row.id, { actor: me.value.name || me.value.username });
    note.value = row.status === "on" ? "已停用 " + row.name : "已启用 " + row.name;
    await refresh();
  } catch (err) {
    note.value = err.message;
  } finally {
    saving.value = false;
  }
}

async function reset(row) {
  const yes = await askConfirm(`将「${row.name}」的密码重置为 ecl2026？`, {
    title: "重置密码",
    confirmText: "重置"
  });
  if (!yes) return;
  saving.value = true;
  try {
    await resetUserPassword(row.id, { actor: me.value.name || me.value.username });
    note.value = "密码已重置为 ecl2026";
  } catch (err) {
    note.value = err.message;
  } finally {
    saving.value = false;
  }
}

function toggleOrg(id, all) {
  if (!form.value) return;
  if (all) {
    form.value.orgs = form.value.orgs.includes("*") ? [] : ["*"];
    return;
  }
  const list = (form.value.orgs || []).filter((item) => item !== "*");
  form.value.orgs = list.includes(id) ? list.filter((item) => item !== id) : [...list, id];
}
</script>

<template>
  <p v-if="note" class="notice info">{{ note }}</p>
  <AsyncView ref="view" :load="load">
    <template #default="{ data }">
      <div class="inline-fields" style="margin-bottom: 12px">
        <button type="button" class="btn sm primary" @click="create(data.roles)">＋ 新增用户</button>
        <span class="sub">{{ data.users.length }} 个账号 · 角色 {{ data.roles.length }} 个</span>
      </div>
      <div class="panel">
        <div class="panel-head">
          <h3>账号列表</h3>
          <span class="sub">当前登录：{{ me.name }}（{{ me.username }}）· {{ me.roleName }}</span>
        </div>
        <div class="panel-body tight">
          <table class="tbl compact">
            <thead>
              <tr><th>用户</th><th>角色</th><th>部门</th><th>授权机构</th><th>最近登录</th><th>状态</th><th style="width: 220px">操作</th></tr>
            </thead>
            <tbody>
              <tr v-for="row in data.users" :key="row.id">
                <td>
                  <strong>{{ row.name }}</strong>
                  <div class="mono dim">{{ row.username }} · {{ row.email || "—" }}</div>
                </td>
                <td><span class="tag" :class="row.roleId === 'R0' ? 'brand' : 'muted'">{{ row.roleName || "未分配" }}</span></td>
                <td>{{ row.dept || "—" }}</td>
                <td class="mono">{{ orgLabel(row.orgs) }}</td>
                <td class="mono">{{ row.lastLogin || "—" }}</td>
                <td><span class="tag" :class="row.status === 'on' ? 'ok' : 'muted'">{{ row.status === "on" ? "已启用" : "已停用" }}</span></td>
                <td>
                  <div class="adm-actions">
                    <button type="button" class="btn ghost xs" @click="edit(row)">编辑</button>
                    <button type="button" class="btn ghost xs" @click="reset(row)">重置密码</button>
                    <button type="button" class="btn ghost xs" :disabled="row.id === me.id" @click="toggle(row)">{{ row.status === "on" ? "停用" : "启用" }}</button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </AsyncView>

  <Drawer :open="!!form" :title="form ? (form.creating ? '新增用户' : '编辑用户 · ' + form.name) : ''" wide @close="form = null">
    <p v-if="error" class="notice danger">{{ error }}</p>
    <div v-if="form" class="reg-form-grid">
      <label class="field">用户名
        <input v-model="form.username" type="text" :readonly="!form.creating" placeholder="登录账号，创建后不可修改" />
      </label>
      <label class="field">姓名
        <input v-model="form.name" type="text" placeholder="真实姓名" />
      </label>
      <label class="field">角色
        <select v-model="form.roleId">
          <option value="" disabled>请选择角色</option>
          <option v-for="role in roles" :key="role.id" :value="role.id" :disabled="role.status !== 'on'">{{ role.name }}{{ role.status === "on" ? "" : "（已停用）" }}</option>
        </select>
      </label>
      <label class="field">部门
        <input v-model="form.dept" type="text" />
      </label>
      <label class="field">邮箱
        <input v-model="form.email" type="text" placeholder="name@example.com" />
      </label>
      <label class="field">手机
        <input v-model="form.phone" type="text" />
      </label>
      <label class="field">{{ form.creating ? "初始密码" : "新密码" }}
        <input v-model="form.password" type="text" :placeholder="form.creating ? '留空则使用 ecl2026' : '留空则不修改'" />
      </label>
      <label class="field">状态
        <select v-model="form.status">
          <option value="on">启用</option>
          <option value="off">停用</option>
        </select>
      </label>
      <label class="field full">授权机构
        <div class="adm-checks">
          <label class="adm-check"><input type="checkbox" :checked="form.orgs.includes('*')" @change="toggleOrg('*', true)" /> 全部机构</label>
          <label v-for="org in orgOptions" :key="org.id" class="adm-check">
            <input type="checkbox" :checked="form.orgs.includes(org.id)" :disabled="form.orgs.includes('*')" @change="toggleOrg(org.id, false)" />
            {{ org.name }}（{{ org.jurisdiction }}）
          </label>
        </div>
        <span class="hint">不选表示未指定；菜单权限由角色控制，机构范围只约束任务与数据的使用范围。</span>
      </label>
    </div>
    <template #footer>
      <span class="spacer"></span>
      <button type="button" class="btn" :disabled="saving" @click="form = null">取消</button>
      <button type="button" class="btn primary" :disabled="saving" @click="save">{{ saving ? "正在保存" : "保存" }}</button>
    </template>
  </Drawer>
</template>
