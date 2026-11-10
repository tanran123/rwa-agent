<script setup>
import { ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { fetchMenus, fetchRoles, saveRoleMenus } from "@/api/admin";
import { auth } from "@/utils/auth";
import AsyncView from "@/components/AsyncView.vue";

const route = useRoute();
const router = useRouter();
const view = ref(null);
const selected = ref(String(route.query.role || ""));
const checked = ref([]);
const note = ref("");
const error = ref("");
const saving = ref(false);

const load = async () => {
  const [roles, tree] = await Promise.all([fetchRoles(), fetchMenus()]);
  if (!selected.value || !roles.some((row) => row.id === selected.value)) {
    const fallback = roles.find((row) => !row.isSuper) || roles[0];
    selected.value = fallback ? fallback.id : "";
  }
  seed(roles.find((row) => row.id === selected.value));
  return { roles, tree };
};

function seed(role) {
  checked.value = role ? [...(role.menus || [])] : [];
}

function select(role) {
  selected.value = role.id;
  seed(role);
  error.value = "";
  router.replace({ path: "/system/permissions", query: { role: role.id } });
}

function has(id) {
  return checked.value.includes("*") || checked.value.includes(id);
}

function isSuperRole(roles) {
  const role = (roles || []).find((row) => row.id === selected.value);
  return !!role && role.isSuper;
}

function toggle(id, superRole) {
  if (superRole) return;
  const list = checked.value.filter((item) => item !== "*");
  checked.value = list.includes(id) ? list.filter((item) => item !== id) : [...list, id];
}

function allOn(groups, superRole) {
  if (superRole) return;
  checked.value = groups.flatMap((group) => group.items.map((item) => item.id));
}

function none() {
  checked.value = [];
}

async function save(roles) {
  const role = (roles || []).find((row) => row.id === selected.value);
  if (!role || role.isSuper) {
    error.value = "超级管理员默认拥有全部菜单权限";
    return;
  }
  saving.value = true;
  error.value = "";
  try {
    await saveRoleMenus(role.id, { menus: checked.value, actor: auth.user ? auth.user.name : "" });
    note.value = "已保存「" + role.name + "」的菜单权限";
    if (view.value) await view.value.reload();
  } catch (err) {
    error.value = err.message;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <p v-if="note" class="notice ok">{{ note }}</p>
  <p v-if="error" class="notice danger">{{ error }}</p>
  <AsyncView ref="view" :load="load">
    <template #default="{ data }">
      <div class="panel" style="margin-bottom: 12px">
        <div class="panel-body">
          <div class="adm-role-pick">
            <span class="sub">当前角色</span>
            <button
              v-for="role in data.roles"
              :key="role.id"
              type="button"
              class="adm-role-chip"
              :class="{ on: role.id === selected }"
              @click="select(role)"
            >{{ role.name }}<em>{{ role.isSuper ? "全部" : role.menuCount }}</em></button>
          </div>
        </div>
      </div>

      <div class="inline-fields" style="margin-bottom: 12px">
        <button type="button" class="btn sm ghost" :disabled="isSuperRole(data.roles)" @click="allOn(data.tree.groups, isSuperRole(data.roles))">全选</button>
        <button type="button" class="btn sm ghost" :disabled="isSuperRole(data.roles)" @click="none">清空</button>
        <span class="spacer"></span>
        <span class="sub">已选 {{ checked.includes("*") ? "全部" : checked.length }} 个菜单</span>
        <button type="button" class="btn sm primary" :disabled="saving || isSuperRole(data.roles)" @click="save(data.roles)">{{ saving ? "正在保存" : "保存权限" }}</button>
      </div>

      <p v-if="isSuperRole(data.roles)" class="notice warn">超级管理员默认拥有全部菜单权限，不可取消。如需限制，请新建普通角色。</p>

      <div class="panel">
        <div class="panel-head">
          <h3>{{ (data.roles.find((row) => row.id === selected) || {}).name || "角色" }} · 菜单权限</h3>
          <span class="sub">这里控制的是「能否看到入口」，项目级数据权限仍由用户授权机构控制。</span>
        </div>
        <div class="panel-body">
          <div class="adm-menu-grid">
            <div v-for="group in data.tree.groups" :key="group.group" class="adm-menu-group">
              <div class="adm-menu-gt">{{ group.group }}</div>
              <label v-for="item in group.items" :key="item.id" class="adm-menu-row">
                <input
                  type="checkbox"
                  :checked="has(item.id)"
                  :disabled="isSuperRole(data.roles)"
                  @change="toggle(item.id, isSuperRole(data.roles))"
                />
                <span class="adm-menu-name">{{ item.name }}</span>
                <span class="mono dim">{{ item.id }}</span>
              </label>
            </div>
          </div>
        </div>
      </div>

      <div class="panel" style="margin-top: 12px">
        <div class="panel-head"><h3>当前角色可访问的导航</h3></div>
        <div class="panel-body">
          <div class="adm-preview">
            <span v-for="group in data.tree.groups" :key="group.group">
              <template v-for="item in group.items" :key="item.id">
                <span v-if="has(item.id)" class="adm-preview-chip">{{ item.name }}</span>
              </template>
            </span>
          </div>
        </div>
      </div>
    </template>
  </AsyncView>
</template>
