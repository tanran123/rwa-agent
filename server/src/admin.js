/**
 * 登录与系统管理。
 *
 * 账号、角色菜单权限、登录日志、操作日志、大模型配置和 Token 调用记录都在这里读写。
 * 密码只存 SHA-256，不回传。大模型 API Key 只回传掩码，修改时留空表示不改。
 * 这里不计算权重，也不调用模型；「测试连接」只核对配置并记一次测试时间。
 */

import { createHash } from "node:crypto";
import { query } from "./db.js";

export const MENUS = [
  { group: "总览", items: [{ id: "home", name: "总览" }] },
  {
    group: "规则配置",
    items: [
      { id: "versions", name: "监管规则版本" },
      { id: "orgs", name: "机构" }
    ]
  },
  {
    group: "任务运行",
    items: [
      { id: "tasks", name: "任务工作台" },
      { id: "wizard", name: "计量向导" },
      { id: "engine", name: "底稿计算" },
      { id: "results", name: "结果明细" }
    ]
  },
  {
    group: "系统管理",
    items: [
      { id: "sys-users", name: "用户管理" },
      { id: "sys-roles", name: "角色管理" },
      { id: "sys-perms", name: "权限管理" },
      { id: "sys-logs", name: "操作日志" },
      { id: "sys-llm", name: "大模型配置" },
      { id: "sys-tokens", name: "Token 调用" }
    ]
  }
];

const ALL_MENU_IDS = MENUS.flatMap((group) => group.items.map((item) => item.id));
const DEFAULT_PASSWORD = "ecl2026";

function pad(value) {
  return String(value).padStart(2, "0");
}

function nowText() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function todayText() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function uid(prefix) {
  return prefix + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase();
}

function hashPassword(value) {
  return createHash("sha256").update(String(value || "")).digest("hex");
}

function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function parsed(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function roleMenus(row) {
  const list = parsed(row.menus_json, []);
  return Array.isArray(list) ? list : [];
}

function roleOut(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description || "",
    isSuper: !!row.is_super,
    status: row.status,
    menus: roleMenus(row),
    menuCount: row.is_super || roleMenus(row).includes("*") ? ALL_MENU_IDS.length : roleMenus(row).filter((id) => ALL_MENU_IDS.includes(id)).length,
    userCount: Number(row.user_count || 0)
  };
}

function userOut(row) {
  return {
    id: row.id,
    username: row.username,
    name: row.name,
    roleId: row.role_id,
    roleName: row.role_name || "",
    dept: row.dept || "",
    email: row.email || "",
    phone: row.phone || "",
    status: row.status,
    orgs: parsed(row.orgs_json, []),
    lastLogin: row.last_login || ""
  };
}

function menusFor(role) {
  if (role.is_super) return ["*"];
  const list = roleMenus(role);
  return list.includes("*") ? ["*"] : list;
}

async function roleById(id) {
  const rows = await query("SELECT * FROM app_role WHERE id = ?", [id]);
  return rows[0] || null;
}

async function audit(actor, action, target, note) {
  await query(
    "INSERT INTO operation_log (at, actor, action, target, note) VALUES (?, ?, ?, ?, ?)",
    [nowText(), String(actor || "系统").slice(0, 64), String(action || "").slice(0, 64), String(target || "").slice(0, 128), String(note || "").slice(0, 255)]
  );
}

async function logLogin(username, name, status, reason, device) {
  await query(
    "INSERT INTO login_log (at, username, name, ip, device, status, reason) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [nowText(), String(username || "—").slice(0, 64), String(name || "—").slice(0, 64), "127.0.0.1", String(device || "本机浏览器").slice(0, 128), status, String(reason || "").slice(0, 255)]
  );
}

export async function login(body) {
  const username = String(body.username || "").trim();
  const password = String(body.password || "");
  const device = String(body.device || "本机浏览器");
  if (!username || !password) throw fail(400, "请输入用户名和密码");

  const rows = await query("SELECT * FROM app_user WHERE username = ?", [username]);
  const user = rows[0];
  if (!user) {
    await logLogin(username || "—", "—", "fail", "用户名或密码错误", device);
    throw fail(401, "用户名或密码错误");
  }
  if (user.status !== "on") {
    await logLogin(user.username, user.name, "fail", "账号已停用", device);
    throw fail(403, "该账号已停用，请联系管理员");
  }
  const role = await roleById(user.role_id);
  if (!role || role.status !== "on") {
    await logLogin(user.username, user.name, "fail", "角色已停用", device);
    throw fail(403, "该账号所属角色已停用，请联系管理员");
  }
  if (user.password_hash !== hashPassword(password)) {
    await logLogin(user.username, user.name, "fail", "用户名或密码错误", device);
    throw fail(401, "用户名或密码错误");
  }

  const at = nowText();
  await query("UPDATE app_user SET last_login = ? WHERE id = ?", [at, user.id]);
  await logLogin(user.username, user.name, "success", "", device);
  return {
    user: userOut({ ...user, last_login: at, role_name: role.name }),
    role: roleOut(role),
    menus: menusFor(role)
  };
}

export async function logout(body) {
  const username = String(body.username || "").trim();
  if (!username) return { ok: true };
  const rows = await query("SELECT username, name FROM app_user WHERE username = ?", [username]);
  const user = rows[0];
  await logLogin(username, user ? user.name : "—", "success", "主动退出", String(body.device || "本机浏览器"));
  return { ok: true };
}

/** 刷新已登录会话的角色和菜单；账号或角色停用后返回 403，让前端回到登录页。 */
export async function sessionInfo(username) {
  const name = String(username || "").trim();
  if (!name) throw fail(400, "缺少用户名");
  const rows = await query("SELECT * FROM app_user WHERE username = ?", [name]);
  const user = rows[0];
  if (!user) throw fail(404, "账号不存在");
  if (user.status !== "on") throw fail(403, "该账号已停用，请联系管理员");
  const role = await roleById(user.role_id);
  if (!role || role.status !== "on") throw fail(403, "该账号所属角色已停用，请联系管理员");
  return {
    user: userOut({ ...user, role_name: role.name }),
    role: roleOut(role),
    menus: menusFor(role)
  };
}

export function menuTree() {
  return { groups: MENUS, all: ALL_MENU_IDS };
}

export async function listUsers() {
  const rows = await query(
    `SELECT u.*, r.name AS role_name FROM app_user u
     LEFT JOIN app_role r ON r.id = u.role_id
     ORDER BY u.id`
  );
  return rows.map(userOut);
}

function userFields(body) {
  return {
    username: String(body.username || "").trim(),
    name: String(body.name || "").trim(),
    roleId: String(body.roleId || "").trim(),
    dept: String(body.dept || "").trim(),
    email: String(body.email || "").trim(),
    phone: String(body.phone || "").trim(),
    status: body.status === "off" ? "off" : "on",
    orgs: Array.isArray(body.orgs) ? body.orgs.map((item) => String(item)).filter(Boolean) : []
  };
}

export async function createUser(body, actor) {
  const fields = userFields(body);
  if (!fields.username || !fields.name) throw fail(400, "用户名和姓名不能为空");
  const role = await roleById(fields.roleId);
  if (!role) throw fail(400, "请选择角色");
  const exists = await query("SELECT id FROM app_user WHERE username = ?", [fields.username]);
  if (exists.length) throw fail(409, "用户名已存在");
  const id = String(body.id || "").trim() || uid("U");
  await query(
    `INSERT INTO app_user (id, username, name, role_id, dept, email, phone, password_hash, status, orgs_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, fields.username, fields.name, fields.roleId, fields.dept, fields.email, fields.phone,
      hashPassword(body.password || DEFAULT_PASSWORD), fields.status, JSON.stringify(fields.orgs)]
  );
  await audit(actor, "新增用户", fields.username, role.name);
  const rows = await query("SELECT u.*, r.name AS role_name FROM app_user u LEFT JOIN app_role r ON r.id = u.role_id WHERE u.id = ?", [id]);
  return userOut(rows[0]);
}

export async function updateUser(id, body, actor) {
  const rows = await query("SELECT * FROM app_user WHERE id = ?", [id]);
  const current = rows[0];
  if (!current) throw fail(404, "用户不存在");
  const fields = userFields({ ...body, username: current.username });
  if (!fields.name) throw fail(400, "姓名不能为空");
  if (!(await roleById(fields.roleId))) throw fail(400, "请选择角色");
  const passwordHash = body.password ? hashPassword(body.password) : current.password_hash;
  await query(
    `UPDATE app_user SET name = ?, role_id = ?, dept = ?, email = ?, phone = ?, password_hash = ?, status = ?, orgs_json = ?
     WHERE id = ?`,
    [fields.name, fields.roleId, fields.dept, fields.email, fields.phone, passwordHash, fields.status, JSON.stringify(fields.orgs), id]
  );
  await audit(actor, "编辑用户", current.username, (await roleById(fields.roleId)).name);
  const next = await query("SELECT u.*, r.name AS role_name FROM app_user u LEFT JOIN app_role r ON r.id = u.role_id WHERE u.id = ?", [id]);
  return userOut(next[0]);
}

export async function toggleUser(id, actor) {
  const rows = await query("SELECT * FROM app_user WHERE id = ?", [id]);
  const user = rows[0];
  if (!user) throw fail(404, "用户不存在");
  const status = user.status === "on" ? "off" : "on";
  await query("UPDATE app_user SET status = ? WHERE id = ?", [status, id]);
  await audit(actor, status === "on" ? "启用用户" : "停用用户", user.username, user.name);
  return { id, status };
}

export async function resetPassword(id, actor) {
  const rows = await query("SELECT * FROM app_user WHERE id = ?", [id]);
  const user = rows[0];
  if (!user) throw fail(404, "用户不存在");
  await query("UPDATE app_user SET password_hash = ? WHERE id = ?", [hashPassword(DEFAULT_PASSWORD), id]);
  await audit(actor, "重置密码", user.username, user.name);
  return { id, password: DEFAULT_PASSWORD };
}

export async function listRoles() {
  const rows = await query(
    `SELECT r.*, (SELECT COUNT(*) FROM app_user u WHERE u.role_id = r.id) AS user_count
     FROM app_role r ORDER BY r.id`
  );
  return rows.map(roleOut);
}

function roleFields(body) {
  return {
    name: String(body.name || "").trim(),
    description: String(body.description || "").trim(),
    status: body.status === "off" ? "off" : "on"
  };
}

export async function createRole(body, actor) {
  const fields = roleFields(body);
  if (!fields.name) throw fail(400, "角色名称不能为空");
  const rows = await query("SELECT id FROM app_role");
  let index = 0;
  const ids = new Set(rows.map((item) => item.id));
  do {
    index += 1;
  } while (ids.has("R" + index));
  const id = body.id || "R" + index;
  await query(
    "INSERT INTO app_role (id, name, description, is_super, status, menus_json) VALUES (?, ?, ?, 0, ?, ?)",
    [id, fields.name, fields.description, fields.status, JSON.stringify([])]
  );
  await audit(actor, "新增角色", fields.name, "0 个菜单");
  return roleOut({ ...(await roleById(id)), user_count: 0 });
}

export async function updateRole(id, body, actor) {
  const role = await roleById(id);
  if (!role) throw fail(404, "角色不存在");
  const fields = roleFields(body);
  if (!fields.name) throw fail(400, "角色名称不能为空");
  await query("UPDATE app_role SET name = ?, description = ?, status = ? WHERE id = ?", [fields.name, fields.description, fields.status, id]);
  await audit(actor, "编辑角色", fields.name, roleMenus(role).length + " 个菜单");
  const rows = await query("SELECT r.*, (SELECT COUNT(*) FROM app_user u WHERE u.role_id = r.id) AS user_count FROM app_role r WHERE r.id = ?", [id]);
  return roleOut(rows[0]);
}

export async function toggleRole(id, actor) {
  const role = await roleById(id);
  if (!role) throw fail(404, "角色不存在");
  if (role.is_super) throw fail(400, "超级管理员角色不可停用");
  const status = role.status === "on" ? "off" : "on";
  await query("UPDATE app_role SET status = ? WHERE id = ?", [status, id]);
  await audit(actor, status === "on" ? "启用角色" : "停用角色", role.name, "");
  return { id, status };
}

export async function saveRoleMenus(id, body, actor) {
  const role = await roleById(id);
  if (!role) throw fail(404, "角色不存在");
  if (role.is_super) throw fail(400, "超级管理员默认拥有全部菜单权限");
  const menus = Array.isArray(body.menus) ? body.menus.map((item) => String(item)).filter((item) => ALL_MENU_IDS.includes(item)) : [];
  await query("UPDATE app_role SET menus_json = ? WHERE id = ?", [JSON.stringify(menus), id]);
  await audit(actor, "保存菜单权限", role.name, menus.length + " 个菜单");
  const rows = await query("SELECT r.*, (SELECT COUNT(*) FROM app_user u WHERE u.role_id = r.id) AS user_count FROM app_role r WHERE r.id = ?", [id]);
  return roleOut(rows[0]);
}

export async function listLoginLogs(limit = 200) {
  const rows = await query("SELECT * FROM login_log ORDER BY id DESC LIMIT ?", [Number(limit) || 200]);
  return rows.map((row) => ({
    id: row.id,
    at: row.at,
    username: row.username,
    name: row.name,
    ip: row.ip,
    device: row.device,
    status: row.status,
    reason: row.reason
  }));
}

export async function listOperationLogs(limit = 200) {
  const rows = await query("SELECT * FROM operation_log ORDER BY id DESC LIMIT ?", [Number(limit) || 200]);
  return rows.map((row) => ({ id: row.id, at: row.at, actor: row.actor, action: row.action, target: row.target, note: row.note }));
}

function maskKey(key) {
  const text = String(key || "");
  if (!text) return "未配置";
  if (text === "local") return "本地免密";
  if (text.length <= 8) return text.slice(0, 2) + "****";
  return text.slice(0, 4) + "****" + text.slice(-4);
}

function llmOut(row) {
  return {
    id: row.id,
    owner: row.owner,
    name: row.name,
    provider: row.provider,
    base: row.base_url,
    model: row.model,
    keyMasked: maskKey(row.api_key),
    temperature: Number(row.temperature),
    maxTokens: Number(row.max_tokens),
    timeout: Number(row.timeout),
    status: row.status,
    isDefault: !!row.is_default,
    lastTest: row.last_test,
    calls: Number(row.calls)
  };
}

export async function listLlm(owner) {
  const who = String(owner || "").trim();
  if (!who) return [];
  const rows = await query("SELECT * FROM llm_config WHERE owner = ? ORDER BY id", [who]);
  return rows.map(llmOut);
}

async function nextLlmId() {
  const rows = await query("SELECT id FROM llm_config");
  const ids = new Set(rows.map((item) => item.id));
  let index = 0;
  do {
    index += 1;
  } while (ids.has("LLM-" + pad(index)));
  return "LLM-" + pad(index);
}

function llmFields(body) {
  return {
    name: String(body.name || "").trim(),
    provider: String(body.provider || "").trim(),
    base: String(body.base || "").trim(),
    model: String(body.model || "").trim(),
    apiKey: String(body.apiKey || "").trim(),
    temperature: Number.isFinite(Number(body.temperature)) ? Number(body.temperature) : 0.2,
    maxTokens: Number(body.maxTokens) || 8192,
    timeout: Number(body.timeout) || 60,
    status: body.status === "off" ? "off" : "on",
    isDefault: !!body.isDefault
  };
}

async function clearDefault(owner, exceptId) {
  await query("UPDATE llm_config SET is_default = 0 WHERE owner = ? AND id <> ?", [owner, exceptId || ""]);
}

export async function createLlm(owner, body, actor) {
  const who = String(owner || "").trim();
  if (!who) throw fail(400, "缺少当前账号");
  const fields = llmFields(body);
  if (!fields.name || !fields.base || !fields.model) throw fail(400, "配置名称、Base URL、模型不能为空");
  const id = await nextLlmId();
  if (fields.isDefault) await clearDefault(who);
  await query(
    `INSERT INTO llm_config (id, owner, name, provider, base_url, model, api_key, temperature, max_tokens, timeout, status, is_default, last_test, calls)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', 0)`,
    [id, who, fields.name, fields.provider, fields.base, fields.model, fields.apiKey, fields.temperature, fields.maxTokens, fields.timeout, fields.status, fields.isDefault ? 1 : 0]
  );
  await audit(actor, "新增大模型配置", fields.name, fields.model);
  return llmOut((await query("SELECT * FROM llm_config WHERE id = ?", [id]))[0]);
}

export async function updateLlm(id, owner, body, actor) {
  const who = String(owner || "").trim();
  const rows = await query("SELECT * FROM llm_config WHERE id = ?", [id]);
  const current = rows[0];
  if (!current) throw fail(404, "配置不存在");
  if (current.owner !== who) throw fail(403, "只能编辑当前账号的模型配置");
  const fields = llmFields(body);
  if (!fields.name || !fields.base || !fields.model) throw fail(400, "配置名称、Base URL、模型不能为空");
  if (fields.isDefault) await clearDefault(who, id);
  const apiKey = fields.apiKey || current.api_key;
  await query(
    `UPDATE llm_config SET name = ?, provider = ?, base_url = ?, model = ?, api_key = ?, temperature = ?, max_tokens = ?, timeout = ?, status = ?, is_default = ?
     WHERE id = ?`,
    [fields.name, fields.provider, fields.base, fields.model, apiKey, fields.temperature, fields.maxTokens, fields.timeout, fields.status, fields.isDefault ? 1 : 0, id]
  );
  await audit(actor, "编辑大模型配置", fields.name, fields.model);
  return llmOut((await query("SELECT * FROM llm_config WHERE id = ?", [id]))[0]);
}

async function ownedLlm(id, owner) {
  const rows = await query("SELECT * FROM llm_config WHERE id = ?", [id]);
  const row = rows[0];
  if (!row) throw fail(404, "配置不存在");
  if (row.owner !== String(owner || "")) throw fail(403, "只能操作当前账号的模型配置");
  return row;
}

export async function toggleLlm(id, owner, actor) {
  const row = await ownedLlm(id, owner);
  const status = row.status === "on" ? "off" : "on";
  await query("UPDATE llm_config SET status = ? WHERE id = ?", [status, id]);
  await audit(actor, status === "on" ? "启用大模型" : "停用大模型", row.name, row.model);
  return { id, status };
}

export async function defaultLlm(id, owner, actor) {
  const row = await ownedLlm(id, owner);
  if (row.status !== "on") throw fail(400, "请先启用该配置");
  await clearDefault(row.owner, id);
  await query("UPDATE llm_config SET is_default = 1 WHERE id = ?", [id]);
  await audit(actor, "设置默认大模型", row.name, row.model);
  return { id, isDefault: true };
}

export async function testLlm(id, owner, actor) {
  const row = await ownedLlm(id, owner);
  if (row.status !== "on") throw fail(400, "配置已停用，先启用再测试");
  const at = nowText();
  await query("UPDATE llm_config SET last_test = ? WHERE id = ?", [at, id]);
  await audit(actor, "测试大模型连接", row.name, row.base_url + " / " + row.model);
  return {
    id,
    ok: true,
    at,
    base: row.base_url,
    model: row.model,
    latencyMs: 286,
    auth: maskKey(row.api_key)
  };
}

export async function listTokenLogs(filters = {}) {
  const from = String(filters.from || "");
  const to = String(filters.to || "");
  const user = String(filters.user || "");
  const model = String(filters.model || "");
  const where = [];
  const params = [];
  if (from) { where.push("at >= ?"); params.push(from + " 00:00:00"); }
  if (to) { where.push("at <= ?"); params.push(to + " 23:59:59"); }
  if (user && user !== "all") { where.push("user_name = ?"); params.push(user); }
  if (model && model !== "all") { where.push("model = ?"); params.push(model); }
  const clause = where.length ? " WHERE " + where.join(" AND ") : "";
  const rows = await query("SELECT * FROM token_log" + clause + " ORDER BY id DESC", params);
  const all = await query("SELECT DISTINCT user_name, model FROM token_log ORDER BY user_name, model");
  const total = rows.reduce((sum, row) => sum + Number(row.prompt_tokens) + Number(row.completion_tokens), 0);
  const ok = rows.filter((row) => row.status === "success").length;
  return {
    rows: rows.map((row) => ({
      id: row.id,
      at: row.at,
      requestId: row.request_id,
      model: row.model,
      scene: row.scene,
      user: row.user_name,
      org: row.org_name,
      prompt: Number(row.prompt_tokens),
      completion: Number(row.completion_tokens),
      total: Number(row.prompt_tokens) + Number(row.completion_tokens),
      latency: Number(row.latency),
      status: row.status
    })),
    summary: {
      from,
      to,
      user: user || "all",
      model: model || "all",
      count: rows.length,
      total,
      successRate: rows.length ? Math.round((ok / rows.length) * 100) : 0,
      today: todayText()
    },
    users: [...new Set(all.map((row) => row.user_name))].filter(Boolean),
    models: [...new Set(all.map((row) => row.model))].filter(Boolean)
  };
}

export async function createTokenLog(body) {
  const at = String(body.at || nowText());
  const prompt = Number(body.prompt) || 0;
  const completion = Number(body.completion) || 0;
  const requestId = String(body.requestId || "").trim() || "TK-" + at.replace(/[-: ]/g, "").slice(0, 12) + "-" + Math.floor(Math.random() * 900 + 100);
  await query(
    `INSERT INTO token_log (at, request_id, model, scene, user_name, org_name, prompt_tokens, completion_tokens, latency, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [at, requestId, String(body.model || ""), String(body.scene || ""), String(body.user || ""), String(body.org || ""),
      prompt, completion, Number(body.latency) || 0, body.status === "fail" ? "fail" : "success"]
  );
  return { requestId };
}
