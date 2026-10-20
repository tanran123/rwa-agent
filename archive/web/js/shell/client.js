/* 当前客户 */
function todayIso() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return d.getFullYear() + "-" + m + "-" + day;
}

function currentCustomer() {
  return CUSTOMERS.find((t) => t.id === state.clientId) || CUSTOMERS[0];
}

function ensureVerKb(ver) {
  if (!ver.kbClient) ver.kbClient = {};
  if (!ver.kbGlobal) ver.kbGlobal = { synced: false, at: "" };
  return ver;
}

function verClientSynced(ver) {
  ensureVerKb(ver);
  const row = ver.kbClient[state.clientId];
  return !!(row && row.synced);
}

function verGlobalSynced(ver) {
  ensureVerKb(ver);
  return !!(ver.kbGlobal && ver.kbGlobal.synced);
}

function markVerDeposit(ver, scope) {
  ensureVerKb(ver);
  const at = ver.updatedAt || todayIso();
  if (scope === "global") {
    ver.kbGlobal = { synced: true, at: at };
  } else {
    ver.kbClient[state.clientId] = { synced: true, at: at };
  }
  if (!ver.kbSpace) ver.kbSpace = "信用风险 · " + ver.id;
}

/** 静默同步到知识库：本客户 + 全部检索，无需手动点按钮 */
function silentSyncVersion(ver) {
  if (!ver) return;
  if (!ver.updatedAt) ver.updatedAt = todayIso();
  markVerDeposit(ver, "client");
  markVerDeposit(ver, "global");
}

function renderClientSel() {
  const el = document.getElementById("clientSel");
  if (!el) return;
  el.innerHTML = CLIENT_CATEGORIES.map((cat) => {
    const rows = CUSTOMERS.filter((c) => c.category === cat);
    if (!rows.length) return "";
    return "<optgroup label=\"" + esc(cat) + "\">"
      + rows.map((c) =>
        "<option value=\"" + esc(c.id) + "\"" + (state.clientId === c.id ? " selected" : "") + ">"
        + esc(c.name) + "（" + esc(c.code) + "）</option>"
      ).join("")
      + "</optgroup>";
  }).join("");
}
