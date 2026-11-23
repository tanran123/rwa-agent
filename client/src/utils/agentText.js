function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function inline(value) {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/[*`]/g, "");
}

function itemText(line) {
  const marked = line.match(/^(?:[-*]|\u2705|\u2611\uFE0F?|\u2611)\s+(.*)$/);
  return marked ? marked[1] : "";
}

export function agentHtml(text) {
  const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  let list = [];
  let para = [];
  let code = [];
  let inCode = false;
  let table = [];
  const flushPara = () => {
    if (!para.length) return;
    blocks.push("<p>" + inline(para.join("")) + "</p>");
    para = [];
  };
  const flushList = () => {
    if (!list.length) return;
    blocks.push("<ul>" + list.map((item) => "<li>" + inline(item) + "</li>").join("") + "</ul>");
    list = [];
  };
  const flushCode = () => {
    if (!inCode) return;
    blocks.push('<pre class="md-code">' + escapeHtml(code.join("\n")) + "</pre>");
    code = [];
    inCode = false;
  };
  const flushTable = () => {
    if (!table.length) return;
    const rows = table
      .map((row) => row.split("|").slice(1, -1).map((cell) => cell.trim()))
      .filter((row) => row.length && !row.every((cell) => /^:?-{2,}:?$/.test(cell)));
    table = [];
    if (!rows.length) return;
    const head = rows[0];
    const rest = rows.slice(1);
    blocks.push(
      '<table class="md-table"><thead><tr>' +
      head.map((cell) => "<th>" + inline(cell) + "</th>").join("") +
      "</tr></thead><tbody>" +
      rest.map((row) => "<tr>" + row.map((cell) => "<td>" + inline(cell) + "</td>").join("") + "</tr>").join("") +
      "</tbody></table>"
    );
  };
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) {
      flushTable();
      if (inCode) flushCode();
      else {
        flushPara();
        flushList();
        inCode = true;
      }
      return;
    }
    if (inCode) {
      code.push(line);
      return;
    }
    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      flushPara();
      flushList();
      table.push(trimmed);
      return;
    }
    const item = itemText(trimmed);
    if (!trimmed) {
      flushPara();
      flushList();
      flushTable();
      return;
    }
    if (/^-{3,}$/.test(trimmed)) {
      flushPara();
      flushList();
      flushTable();
      blocks.push("<hr>");
      return;
    }
    const heading = trimmed.match(/^#{1,6}\s*(.+)$/);
    if (heading) {
      flushPara();
      flushList();
      flushTable();
      blocks.push('<p class="md-h"><strong>' + inline(heading[1]) + "</strong></p>");
      return;
    }
    if (item) {
      flushPara();
      flushTable();
      list.push(item);
      return;
    }
    flushList();
    flushTable();
    para.push(trimmed);
  });
  flushPara();
  flushList();
  flushTable();
  flushCode();
  return blocks.join("");
}
