// 往「大模型配置」里加一条本机账号的模型配置并启用。
//
// 用法（仓库根目录）：
//   node tools/add-llm-config.mjs --owner admin --name deepseek-v4.1-flash \
//     --provider Custom --base https://opencode.ai/zen/go/v1 \
//     --model deepseek-v4.1-flash --api-key sk-... [--default] [--test]
//
// API Key 只从命令行读，不写进仓库；配置落在 MySQL 的 llm_config，
// 和页面「新增配置」写的是同一张表、同一套字段。
// --base 填 OpenAI 兼容前缀（客户端会自己拼 /chat/completions）；
// 如果误填了完整的 .../chat/completions，这里会自动去掉。
// --default 同时设为当前账号的默认模型；--test 插入后测一次连接并记录 last_test。
// 脚本可重复执行：同一账号下 base + model 相同就更新那一条并重新启用。

import { query } from "../server/src/db.js";

function argument(name, fallback = "") {
  const index = process.argv.indexOf("--" + name);
  if (index < 0) return fallback;
  const next = process.argv[index + 1];
  return next && !next.startsWith("--") ? next : "on";
}

function flag(name) {
  return process.argv.includes("--" + name);
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function nowText() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function normalizeBase(raw) {
  return String(raw || "")
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/chat\/completions$/, "");
}

function maskKey(key) {
  const text = String(key || "");
  if (!text) return "未配置";
  if (text.length <= 8) return text.slice(0, 2) + "****";
  return text.slice(0, 4) + "****" + text.slice(-4);
}

async function main() {
  const owner = String(argument("owner", "")).trim();
  const name = String(argument("name", "")).trim();
  const provider = String(argument("provider", "Custom")).trim();
  const base = normalizeBase(argument("base", ""));
  const model = String(argument("model", "")).trim();
  const apiKey = String(argument("api-key", "")).trim();
  const asDefault = flag("default");
  const shouldTest = flag("test");

  if (!owner || !name || !base || !model) {
    console.error("缺少参数：--owner --name --base --model 必填");
    process.exit(2);
  }

  const owners = await query("SELECT username FROM app_user WHERE username = ?", [owner]);
  if (!owners.length) {
    console.error(`账号 ${owner} 不存在，无法写入该账号的模型配置`);
    process.exit(2);
  }

  const existing = await query(
    "SELECT * FROM llm_config WHERE owner = ? AND base_url = ? AND model = ? ORDER BY id LIMIT 1",
    [owner, base, model]
  );
  const at = nowText();
  let id = existing[0] ? existing[0].id : "";
  if (!id) {
    const rows = await query("SELECT id FROM llm_config");
    const used = new Set(rows.map((item) => item.id));
    let index = 0;
    do {
      index += 1;
      id = "LLM-" + pad(index);
    } while (used.has(id));
  }

  const key = apiKey || (existing[0] ? existing[0].api_key : "");
  const defaultFlag = asDefault ? 1 : existing[0] ? Number(existing[0].is_default) : 0;

  if (existing[0]) {
    await query(
      `UPDATE llm_config SET name = ?, provider = ?, api_key = ?, status = 'on', is_default = ? WHERE id = ?`,
      [name, provider, key, defaultFlag, id]
    );
    console.log(`已更新 ${id} · ${name}`);
  } else {
    await query(
      `INSERT INTO llm_config (id, owner, name, provider, base_url, model, api_key, temperature, max_tokens, timeout, status, is_default, last_test, calls)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0.2, 8192, 60, 'on', ?, '', 0)`,
      [id, owner, name, provider, base, model, key, defaultFlag]
    );
    console.log(`已新增 ${id} · ${name}`);
  }

  if (asDefault) {
    await query("UPDATE llm_config SET is_default = 0 WHERE owner = ? AND id <> ?", [owner, id]);
    console.log(`已设为 ${owner} 的默认模型`);
  }

  await query(
    "INSERT INTO operation_log (at, actor, action, target, note) VALUES (?, ?, ?, ?, ?)",
    [at, "add-llm-config", existing[0] ? "编辑大模型配置" : "新增大模型配置", name.slice(0, 128), model.slice(0, 255)]
  );

  console.log(`账号 ${owner} · 服务商 ${provider}`);
  console.log(`Base URL ${base}`);
  console.log(`模型 ${model} · 鉴权 ${maskKey(key)} · 状态 on${defaultFlag ? " · 默认" : ""}`);

  if (shouldTest) {
    const started = Date.now();
    try {
      const extra = new URL(base).hostname.endsWith("opencode.ai")
        ? { "x-opencode-session": "rwa-" + Date.now() }
        : {};
      const response = await fetch(base + "/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(key ? { authorization: "Bearer " + key } : {}),
          ...extra
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 1,
          temperature: 0
        }),
        signal: AbortSignal.timeout(20000)
      });
      if (!response.ok) throw new Error("HTTP " + response.status + " " + (await response.text()).slice(0, 160));
      await response.text();
      await query("UPDATE llm_config SET last_test = ? WHERE id = ?", [nowText(), id]);
      console.log(`连接成功 · ${Date.now() - started} ms · 已记录最近测试时间`);
    } catch (err) {
      console.error(`连接失败：${String(err.message || err).slice(0, 200)}`);
      process.exitCode = 1;
    }
  }

  await query("SELECT 1");
  const { pool } = await import("../server/src/db.js");
  await pool.end();
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
