/* 顶栏菜单和页头 */
function menuId(page) {
  const tabs = typeof PAGE_SECTIONS === "undefined" ? {} : PAGE_SECTIONS;
  for (const key in tabs) {
    if (tabs[key].some((tab) => tab.id === page)) return key;
  }
  return page;
}

function sectionTabsHtml(page) {
  const key = menuId(page);
  const tabs = (typeof PAGE_SECTIONS === "undefined" ? null : PAGE_SECTIONS[key]) || null;
  if (!tabs || tabs.length < 2) return "";
  return "<div class=\"section-tabs\" role=\"tablist\">"
    + tabs.map((tab) =>
      "<button type=\"button\" class=\"section-tab" + (tab.id === page ? " active" : "")
      + "\" data-section=\"" + tab.id + "\">" + esc(tab.label) + "</button>"
    ).join("")
    + "</div>";
}

function withSectionTabs(html, page) {
  const tabs = sectionTabsHtml(page);
  if (!tabs) return html;
  const mark = "</header>";
  const at = html.indexOf(mark);
  if (at < 0) return tabs + html;
  return html.slice(0, at + mark.length) + tabs + html.slice(at + mark.length);
}

function pageInGroup(group) {
  const id = menuId(state.page);
  if (group.page && group.page === id) return true;
  return (group.items || []).some((item) => item.id === id);
}

const PAGE_META = {
  overview: { kicker: "架构", kickerClass: "", title: "整体架构", blurb: "左边配置规则，右边跑计算。产品字段与监管版本可换，计算链路固定可追溯。" },
  fields: { kicker: "规则配置", kickerClass: "", title: "产品标准字段", blurb: "先新建产品类型，再从知识库同步相关产品字段；类型下可自行维护字段。" },
  regulation: { kicker: "规则配置", kickerClass: "", title: "监管规则版本", blurb: "按客户横向扩展。打开版本或切换客户时自动静默同步到知识库（本客户 + 全部检索）。" },
  params: { kicker: "规则配置", kickerClass: "", title: "规则参数", blurb: "只放多条规则共用的门槛：LTV 分界、期限、准备占比、质物权重底线、信用卡单卡上限。评级百分比在风险权重里改。" },
  exposure: { kicker: "规则配置", kickerClass: "", title: "分类判断瀑布流", blurb: "" },
  weights: { kicker: "规则配置", kickerClass: "", title: "风险权重规则", blurb: "无缓释时，表内 RWA =（资产账面价值 − 减值准备）× 风险权重。有缓释时按拆开的各部分分别乘对应权重。权重表没写的档位标成未列明。" },
  ccf: { kicker: "规则配置", kickerClass: "", title: "表外信用转换系数", blurb: "一行是一种表外类型加一个条件。试算按规则编号取系数，只在表外乘。" },
  crm: { kicker: "规则配置", kickerClass: "", title: "CRM 风险缓释", blurb: "这里维护合格工具，以及什么情况下这条缓释不计入。覆盖金额在试算里按笔填，未覆盖部分仍用原暴露权重。" },
  engine: { kicker: "计算", kickerClass: "calc", title: "RWA 计算", blurb: "映射 → 计算 → 追溯。映射把判定字段对到源表列，计算在每一行写入风险暴露类型、权重和 RWA。" }
};

function ph(pageId, actionsHtml) {
  const m = PAGE_META[pageId] || { kicker: "", kickerClass: "", title: "", blurb: "" };
  return "<header class=\"page-head\"><div>"
    + (m.kicker ? "<div class=\"page-kicker" + (m.kickerClass ? " " + m.kickerClass : "") + "\">" + esc(m.kicker) + "</div>" : "")
    + "<h1>" + esc(m.title) + "</h1>"
    + (m.blurb ? "<p>" + esc(m.blurb) + "</p>" : "")
    + "</div>"
    + (actionsHtml || "")
    + "</header>";
}

function renderNav() {
  document.getElementById("topNav").innerHTML = NAV_GROUPS.map((g) => {
    if (g.page) {
      return "<button type=\"button\" data-page=\"" + g.page + "\" class=\""
        + (state.page === g.page ? "active" : "") + "\">" + esc(g.label) + "</button>";
    }
    const open = state.navOpen === g.id;
    const active = pageInGroup(g);
    return "<div class=\"nav-group" + (open ? " open" : "") + (active ? " has-active" : "") + "\" data-nav-group=\"" + esc(g.id) + "\">"
      + "<button type=\"button\" class=\"nav-group-btn\" data-nav-toggle=\"" + esc(g.id) + "\">"
      + esc(g.label) + "<span class=\"caret\">" + (open ? "▴" : "▾") + "</span></button>"
      + "<div class=\"nav-menu\" role=\"menu\">"
      + g.items.map((item, index) =>
        "<button type=\"button\" data-page=\"" + item.id + "\" class=\""
        + (menuId(state.page) === item.id ? "active" : "") + "\">"
        + "<span class=\"nav-no\">" + (index + 1) + "</span>" + esc(item.label) + "</button>"
      ).join("")
      + "</div></div>";
  }).join("");
}
