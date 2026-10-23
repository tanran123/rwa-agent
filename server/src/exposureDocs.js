import { readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { query } from "./db.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

function documentOf(value) {
  if (value == null) return null;
  if (typeof value === "string") return JSON.parse(value);
  return value;
}

function present(row) {
  return {
    name: row.name,
    title: row.title,
    label: row.label,
    sourceFile: row.source_file,
    document: documentOf(row.body)
  };
}

const LIST_SQL = "SELECT name, title, label, source_file, body FROM exposure_document WHERE seq > 0 ORDER BY seq, id";

export async function exposureDocs() {
  const rows = await query(LIST_SQL);
  return rows.map(present);
}

const OPS = { eq: true, in: true, gt: true, gte: true, lt: true, lte: true };

function reject(message) {
  const err = new Error(message);
  err.status = 400;
  throw err;
}

function mentioned(text, value) {
  const pct = value * 100;
  const pctText = Number.isInteger(pct) ? String(pct) : String(Math.round(pct * 10) / 10);
  if (text.includes(pctText + "%")) return true;
  const dec = String(value);
  return dec.includes(".") && text.includes(dec);
}

function leaves(document) {
  const rows = [];
  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    const children = node.children || [];
    if (!children.length && !node.otherwise) rows.push(node);
    children.forEach(walk);
    if (node.otherwise) walk(node.otherwise);
  };
  (document.rules || []).forEach(walk);
  return rows;
}

function checkWhen(when, fields, label) {
  if (!when || typeof when !== "object") reject("「" + label + "」的判断条件不完整");
  const groups = ["all", "any"];
  groups.forEach((key) => {
    const list = when[key];
    if (!list) return;
    if (!Array.isArray(list)) reject("「" + label + "」的判断条件不完整");
    list.forEach((item) => {
      const field = fields[item && item.field];
      if (!field) reject("「" + label + "」用了文档里没有的字段");
      if (!OPS[item.op]) reject("「" + label + "」用了文档里没有的比较");
      const codes = (field.options || []).map((option) => option.code);
      const values = Array.isArray(item.match) ? item.match : [item.match];
      if (codes.length && values.some((value) => typeof value === "string" && codes.indexOf(value) < 0)) {
        reject("「" + label + "」用了字段里没有的取值");
      }
    });
  });
}

function hasWeight(node) {
  if (typeof node.value === "number") return true;
  const weight = node.weight;
  if (!weight || typeof weight !== "object") return false;
  if (typeof weight.same_as === "string" && weight.same_as) return true;
  return Array.isArray(weight.greater_of) && weight.greater_of.length > 0;
}

function checkDocument(document) {
  if (!document || typeof document !== "object") reject("没有可写入的分类 JSON");
  if (!/^[a-z][a-z0-9_]{1,63}$/.test(document.name || "")) reject("分类 name 需要小写英文和下划线");
  if (!document.title) reject("分类没有标题");
  if (!Array.isArray(document.rules) || !document.rules.length) reject("分类里还没有规则");
  const fields = {};
  (document.fields || []).forEach((field) => {
    if (field && field.name) fields[field.name] = field;
  });
  const walk = (node) => {
    if (!node || typeof node !== "object" || !node.name || !node.label) reject("有一条规则缺 name 或名称");
    if (node.when) checkWhen(node.when, fields, node.label);
    const children = node.children || [];
    if (!Array.isArray(children)) reject("「" + node.label + "」的下级不是列表");
    children.forEach(walk);
    if (node.otherwise) walk(node.otherwise);
    if (!children.length && !node.otherwise && !hasWeight(node)) {
      reject("「" + node.label + "」没有权重，先不要写入");
    }
  };
  document.rules.forEach(walk);
}

async function nextSlot() {
  const rows = await query("SELECT COALESCE(MAX(id), 0) AS id, COALESCE(MAX(seq), 0) AS seq FROM exposure_document");
  return { id: Number(rows[0].id) + 1, seq: Number(rows[0].seq) + 1 };
}

async function insertDoc(label, document) {
  const slot = await nextSlot();
  await query(
    "INSERT INTO exposure_document (id, name, title, label, seq, source_file, body) VALUES (?, ?, ?, ?, ?, ?, CAST(? AS JSON))",
    [slot.id, document.name, document.title, label, slot.seq, label + "风险暴露.json", JSON.stringify(document)]
  );
}

export async function deleteExposureDoc(body) {
  const name = String((body && body.name) || "").trim();
  if (!name) reject("没有这份分类 JSON");
  const rows = await exposureDocs();
  const item = rows.find((row) => row.name === name);
  if (!item) reject("没有这份分类 JSON");
  if (item.label === "通用") reject("通用页签不能删除");
  const result = await query(
    "DELETE FROM exposure_document WHERE name = ? AND seq > 0 AND label <> ?",
    [name, "通用"]
  );
  if (!result.affectedRows) reject("没有这份分类 JSON");
  const chats = readChats();
  if (chats[name]) {
    delete chats[name];
    writeFileSync(CHAT_FILE, JSON.stringify(chats, null, 2) + "\n");
  }
  return { name, label: item.label };
}

export async function copyExposureDoc(body) {
  const label = String((body && body.label) || "").trim();
  if (!label || /[\\/]/.test(label) || label.includes(".")) reject("页签名不能包含路径");
  const rows = await exposureDocs();
  const source = rows[0];
  if (!source) reject("没有通用分类");
  if (rows.some((item) => item.label === label)) reject("已经有这个页签");
  const document = JSON.parse(JSON.stringify(source.document));
  let name = "mo_product_" + Date.now().toString(36);
  while (rows.some((item) => item.name === name)) name += "x";
  document.name = name;
  document.title = label;
  await insertDoc(label, document);
  return { name, title: document.title, label, first: false };
}

export async function saveExposureDoc(body) {
  const action = body && body.action;
  const document = body && body.document;
  const said = (body && body.messages || []).map((item) => String(item || "")).join("\n");
  const rows = await exposureDocs();
  let existing = rows.find((item) => item.name === (document && document.name));
  if (action === "update") {
    const pinned = body.name ? rows.find((item) => item.name === body.name) : rows[0];
    if (!pinned) reject("没有这份分类 JSON");
    if (!document || typeof document !== "object") reject("没有可写入的分类 JSON");
    document.name = pinned.name;
    if (!document.title) document.title = pinned.title;
    existing = pinned;
  }
  checkDocument(document);
  if (action === "update" && !existing) reject("没有这份分类 JSON");
  if (action === "update") {
    const names = leaves(document).map((node) => node.name);
    leaves(existing.document).forEach((node) => {
      if (names.indexOf(node.name) < 0) reject("「" + node.label + "」不在这次结果里，先不要写入");
    });
  }
  const fresh = leaves(document).filter((node) => {
    if (action !== "update") return true;
    const previous = leaves(existing.document).find((item) => item.name === node.name);
    return !previous || previous.value !== node.value;
  });
  fresh.forEach((node) => {
    if (typeof node.value !== "number") return;
    if (!mentioned(said, node.value)) reject("「" + node.label + "」的权重没有出现在对话里，先不要写入");
  });
  if (action === "update") {
    const result = await query(
      "UPDATE exposure_document SET title = ?, body = CAST(? AS JSON) WHERE name = ? AND seq > 0",
      [document.title, JSON.stringify(document), document.name]
    );
    if (!result.affectedRows) reject("没有这份分类 JSON");
  } else if (action === "add") {
    if (existing) reject("已经有这份分类 JSON");
    const label = String(body.label || "").trim();
    if (!label || /[\\/]/.test(label) || label.includes(".")) reject("页签名不能包含路径");
    if (rows.some((item) => item.label === label)) reject("已经有这个页签");
    await insertDoc(label, document);
  } else {
    reject("这次没有要写入的分类");
  }
  const saved = await exposureDocs();
  const item = saved.find((row) => row.name === document.name);
  return {
    name: item.name,
    title: item.title,
    label: item.label,
    first: saved[0] && saved[0].name === item.name
  };
}

export async function exposureDoc(name) {
  const rows = await query(
    "SELECT name, title, label, source_file, body FROM exposure_document WHERE name = ? AND seq > 0",
    [name]
  );
  return rows[0] ? present(rows[0]) : null;
}

const CHAT_FILE = join(ROOT, "决策树对话.json");

function readChats() {
  try {
    const body = JSON.parse(readFileSync(CHAT_FILE, "utf8"));
    return body && typeof body === "object" && !Array.isArray(body) ? body : {};
  } catch (err) {
    return {};
  }
}

async function chatItem(name) {
  const rows = await exposureDocs();
  const item = name ? rows.find((row) => row.name === name) : rows[0];
  if (!item) reject("没有这份分类 JSON");
  return item;
}

function chatMessage(item) {
  if (!item || (item.role !== "user" && item.role !== "bot")) return null;
  const text = String(item.text || "").trim();
  if (!text || item.pending) return null;
  return {
    role: item.role,
    text: text.slice(0, 8000),
    meta: String(item.meta || "").slice(0, 40),
    offerConfirm: !!item.offerConfirm,
    offerSave: !!item.offerSave
  };
}

export async function exposureChat(name) {
  const item = await chatItem(String(name || ""));
  const row = readChats()[item.name] || {};
  const messages = Array.isArray(row.messages) ? row.messages.map(chatMessage).filter(Boolean) : [];
  const draft = row.draft && row.draft.document && typeof row.draft.document === "object"
    ? { stage: row.draft.stage === "save" ? "save" : "draft", document: row.draft.document }
    : null;
  return { name: item.name, messages, draft };
}

export async function saveExposureChat(body) {
  const item = await chatItem(String((body && body.name) || ""));
  const messages = ((body && body.messages) || []).map(chatMessage).filter(Boolean).slice(-40);
  const draftBody = body && body.draft;
  const draft = draftBody && draftBody.document && typeof draftBody.document === "object"
    ? { stage: draftBody.stage === "save" ? "save" : "draft", document: draftBody.document }
    : null;
  const all = readChats();
  all[item.name] = { messages, draft };
  writeFileSync(CHAT_FILE, JSON.stringify(all, null, 2) + "\n");
  return { name: item.name };
}
