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
  lines.forEach((line) => {
    const trimmed = line.trim();
    const item = itemText(trimmed);
    if (!trimmed) {
      flushPara();
      flushList();
      return;
    }
    if (item) {
      flushPara();
      list.push(item);
      return;
    }
    flushList();
    para.push(trimmed);
  });
  flushPara();
  flushList();
  return blocks.join("");
}
