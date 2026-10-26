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
    ruleVersion: row.rule_version || "",
    document: documentOf(row.body)
  };
}

function versionOf(value) {
  return String(value || "").trim();
}

const DOC_SQL = "SELECT name, title, label, source_file, rule_version, body FROM exposure_document";

export async function exposureDocs(version) {
  const rows = await query(
    DOC_SQL + " WHERE seq > 0 AND rule_version = ? ORDER BY seq, id",
    [versionOf(version)]
  );
  return rows.map(present);
}

async function docByName(name) {
  const rows = await query(DOC_SQL + " WHERE name = ? AND seq > 0", [name]);
  return rows[0] ? present(rows[0]) : null;
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

function nodeByName(document, name) {
  let found = null;
  const walk = (node) => {
    if (found || !node || typeof node !== "object") return;
    if (node.name === name) {
      found = node;
      return;
    }
    (node.children || []).forEach(walk);
    if (node.otherwise) walk(node.otherwise);
  };
  ((document && document.rules) || []).forEach(walk);
  return found;
}

async function regulationText() {
  const rows = await query("SELECT body FROM clause_doc");
  return rows.map((row) => String(row.body || "")).join("\n");
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

async function insertDoc(label, document, version) {
  const slot = await nextSlot();
  await query(
    "INSERT INTO exposure_document (id, name, title, label, seq, source_file, rule_version, body) VALUES (?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON))",
    [slot.id, document.name, document.title, label, slot.seq, label + "风险暴露.json", versionOf(version), JSON.stringify(document)]
  );
}

function slug(version) {
  const text = String(version || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return text || "v";
}

function docName(base, version, taken) {
  const stem = String(base || "exposure").toLowerCase().replace(/[^a-z0-9_]/g, "_").replace(/^[^a-z]+/, "") || "exposure";
  let n = 0;
  let name = "";
  do {
    const suffix = n ? "_" + n.toString(36) : "";
    name = (stem + "_" + slug(version) + suffix).slice(0, 64);
    if (!/^[a-z]/.test(name)) name = ("x" + name).slice(0, 64);
    n += 1;
  } while (taken.has(name) && n < 1000);
  if (taken.has(name)) reject("分类 name 重复");
  taken.add(name);
  return name;
}

async function takenNames() {
  const rows = await query("SELECT name FROM exposure_document");
  return new Set(rows.map((row) => row.name));
}

async function sourceVersion(version, jurisdiction) {
  const peers = await query(
    "SELECT version, status FROM rule_version WHERE jurisdiction = ? AND version <> ? ORDER BY effective_from DESC",
    [jurisdiction, version]
  );
  const published = peers.filter((row) => row.status === "published").concat(peers);
  for (const row of published) {
    const hit = await query(
      "SELECT id FROM exposure_document WHERE seq > 0 AND rule_version = ? LIMIT 1",
      [row.version]
    );
    if (hit.length) return row.version;
  }
  const anchor = await query(
    "SELECT rule_version FROM exposure_document WHERE seq > 0 AND label = ? ORDER BY id LIMIT 1",
    ["通用"]
  );
  return anchor[0] ? anchor[0].rule_version : "";
}

export async function provisionExposureDocs(body) {
  const version = versionOf(body && body.version);
  if (!version) reject("没有规则版本");
  const versions = await query(
    "SELECT version, jurisdiction FROM rule_version WHERE version = ?",
    [version]
  );
  if (!versions.length) reject("没有这个规则版本");
  const owned = await query(
    "SELECT id FROM exposure_document WHERE seq > 0 AND rule_version = ? LIMIT 1",
    [version]
  );
  if (owned.length) reject("这个版本已经有风险暴露分类规则");
  const source = await sourceVersion(version, versions[0].jurisdiction);
  const rows = await query(
    DOC_SQL + " WHERE seq > 0 AND rule_version = ? ORDER BY seq, id",
    [source]
  );
  if (!rows.length) reject("还没有可以复制的风险暴露分类规则");
  const taken = await takenNames();
  const documents = [];
  for (const row of rows) {
    const document = JSON.parse(JSON.stringify(documentOf(row.body)));
    document.name = docName(document.name || row.name, version, taken);
    if (!document.title) document.title = row.title;
    await insertDoc(row.label, document, version);
    documents.push({ name: document.name, title: document.title, label: row.label });
  }
  return { version, source, documents };
}

export async function deleteExposureDoc(body) {
  const name = String((body && body.name) || "").trim();
  const version = versionOf(body && body.version);
  if (!name) reject("没有这份分类 JSON");
  const rows = await exposureDocs(version);
  const item = rows.find((row) => row.name === name);
  if (!item) reject("没有这份分类 JSON");
  if (item.label === "通用") reject("通用页签不能删除");
  const result = await query(
    "DELETE FROM exposure_document WHERE name = ? AND seq > 0 AND label <> ? AND rule_version = ?",
    [name, "通用", version]
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
  const version = versionOf(body && body.version);
  if (!version) reject("没有规则版本");
  if (!label || /[\\/]/.test(label) || label.includes(".")) reject("页签名不能包含路径");
  const rows = await exposureDocs(version);
  const source = rows.find((item) => item.label === "通用") || rows[0];
  if (!source) reject("这个版本还没有风险暴露分类规则");
  if (rows.some((item) => item.label === label)) reject("已经有这个页签");
  const document = JSON.parse(JSON.stringify(source.document));
  const taken = await takenNames();
  document.name = docName("mo_product_" + Date.now().toString(36), version, taken);
  document.title = label;
  await insertDoc(label, document, version);
  return { name: document.name, title: document.title, label, first: false };
}

export async function saveExposureDoc(body) {
  const action = body && body.action;
  const document = body && body.document;
  const said = (body && body.messages || []).map((item) => String(item || "")).join("\n");
  let version = versionOf(body && body.version);
  if (!version && body && body.name) {
    const pinned = await docByName(body.name);
    version = pinned ? pinned.ruleVersion : "";
  }
  const rows = await exposureDocs(version);
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
  const generic = rows.find((item) => item.label === "通用");
  const clauses = await regulationText();
  fresh.forEach((node) => {
    if (typeof node.value !== "number") return;
    if (mentioned(said, node.value)) return;
    if (action === "update") {
      const previous = leaves(existing.document).find((item) => item.name === node.name);
      const origin = generic && nodeByName(generic.document, node.name);
      if (!previous && origin && origin.value === node.value) return;
      if (!previous && mentioned(clauses, node.value)) return;
    }
    reject("「" + node.label + "」的权重没有出现在对话里，先不要写入");
  });
  if (action === "update") {
    const result = await query(
      "UPDATE exposure_document SET title = ?, body = CAST(? AS JSON) WHERE name = ? AND seq > 0 AND rule_version = ?",
      [document.title, JSON.stringify(document), document.name, version]
    );
    if (!result.affectedRows) reject("没有这份分类 JSON");
  } else if (action === "add") {
    if (existing) reject("已经有这份分类 JSON");
    const label = String(body.label || "").trim();
    if (!label || /[\\/]/.test(label) || label.includes(".")) reject("页签名不能包含路径");
    if (rows.some((item) => item.label === label)) reject("已经有这个页签");
    await insertDoc(label, document, version);
  } else {
    reject("这次没有要写入的分类");
  }
  const saved = await exposureDocs(version);
  const item = saved.find((row) => row.name === document.name);
  return {
    name: item.name,
    title: item.title,
    label: item.label,
    first: saved[0] && saved[0].name === item.name
  };
}

export async function exposureDoc(name, version) {
  const params = [name];
  let sql = DOC_SQL + " WHERE name = ? AND seq > 0";
  const scoped = versionOf(version);
  if (scoped) {
    sql += " AND rule_version = ?";
    params.push(scoped);
  }
  const rows = await query(sql, params);
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

async function chatItem(name, version) {
  const scoped = versionOf(version);
  if (name) {
    const item = await docByName(name);
    if (!item || (scoped && item.ruleVersion !== scoped)) reject("没有这份分类 JSON");
    return item;
  }
  const rows = await exposureDocs(scoped);
  if (!rows[0]) reject("没有这份分类 JSON");
  return rows[0];
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

export async function exposureChat(name, version) {
  const item = await chatItem(String(name || ""), version);
  const row = readChats()[item.name] || {};
  const messages = Array.isArray(row.messages) ? row.messages.map(chatMessage).filter(Boolean) : [];
  const draft = row.draft && row.draft.document && typeof row.draft.document === "object"
    ? { stage: row.draft.stage === "save" ? "save" : "draft", document: row.draft.document }
    : null;
  return { name: item.name, messages, draft };
}

export async function saveExposureChat(body) {
  const item = await chatItem(String((body && body.name) || ""), body && body.version);
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
