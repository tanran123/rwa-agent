import { reactive } from "vue";

const KEY = "rwa-auth-v1";

function read() {
  try {
    const raw = sessionStorage.getItem(KEY) || localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || !data.user || !data.user.id) return null;
    return data.user;
  } catch {
    return null;
  }
}

const state = reactive({ user: read() });

export const auth = state;

export function currentUser() {
  return state.user;
}

export function setSession(payload, remember = true) {
  const user = {
    id: payload.user.id,
    username: payload.user.username,
    name: payload.user.name,
    roleId: payload.user.roleId,
    roleName: (payload.role && payload.role.name) || payload.user.roleName || "",
    dept: payload.user.dept || "",
    orgs: payload.user.orgs || [],
    menus: payload.menus || (payload.role && payload.role.menus) || []
  };
  state.user = user;
  const store = remember === false ? sessionStorage : localStorage;
  try {
    localStorage.removeItem(KEY);
    sessionStorage.removeItem(KEY);
    store.setItem(KEY, JSON.stringify({ user, at: Date.now() }));
  } catch {
    // 本机演示：浏览器禁用存储时只保留内存中的会话
  }
  return user;
}

export function clearSession() {
  state.user = null;
  try {
    localStorage.removeItem(KEY);
    sessionStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

/** 用服务端返回的最新角色和菜单更新本机会话，不改变“记住登录”所选存储。 */
export function refreshSession(payload) {
  const existing = state.user;
  if (!existing) return null;
  const user = {
    ...existing,
    id: payload.user.id,
    username: payload.user.username,
    name: payload.user.name,
    roleId: payload.user.roleId,
    roleName: (payload.role && payload.role.name) || payload.user.roleName || existing.roleName,
    dept: payload.user.dept || existing.dept,
    orgs: payload.user.orgs || existing.orgs,
    menus: payload.menus || (payload.role && payload.role.menus) || existing.menus
  };
  state.user = user;
  try {
    const store = localStorage.getItem(KEY) ? localStorage : sessionStorage;
    store.setItem(KEY, JSON.stringify({ user, at: Date.now() }));
  } catch {
    // ignore
  }
  return user;
}

export function can(menuId) {
  const user = state.user;
  if (!user) return false;
  const menus = user.menus || [];
  return menus.includes("*") || menus.includes(menuId);
}

export function isSuper() {
  const user = state.user;
  return !!user && (user.menus || []).includes("*");
}
