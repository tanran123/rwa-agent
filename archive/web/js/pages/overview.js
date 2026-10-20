/* 总览页 */
function pageOverview() {
  const configItems = [
    ["regulation", "1", "监管版本", "先选内地 / 香港 / 澳门用哪套规矩"],
    ["fields", "2", "产品字段", "按产品维护一套标准字段（贷款、债券…）"],
    ["exposure", "3", "分类判断", "各产品走同一套分类，跳过不适用分支"],
    ["weights", "4", "风险权重", "各类暴露对应 RW 与 priority"],
    ["ccf", "5", "CCF", "表外名义金额先乘转换系数"],
    ["crm", "6", "CRM 缓释", "合格质物 / 保证拆分覆盖"],
    ["params", "7", "规则参数", "LTV、期限、准备占比等门槛"]
  ];
  const calcSteps = [
    ["0", "映射", "把判定字段对到源表的列"],
    ["1", "计算", "在源表每一行写入风险暴露类型和 RWA"],
    ["2", "追溯", "回看规则和手填的权重"]
  ];
  return ph("overview")
    + "<div class=\"arch-hero\">"
    + "<p>系统分两块：<em>规则配置</em>维护「算什么规矩」，<em>计算</em>用已确认映射跑一笔 RWA。"
    + "数据与产品模型不变，换监管版本只换规则包。</p>"
    + "</div>"
    + "<div class=\"arch-lanes\">"
    + "<section class=\"arch-lane config\">"
    + "<div class=\"arch-lane-head\"><div>"
    + "<h2>规则配置</h2>"
    + "<p>顶栏「规则配置」菜单 · 配置好再进计算</p>"
    + "</div><span class=\"tag muted\">可变</span></div>"
    + "<div class=\"arch-lane-body\">"
    + configItems.map((x) =>
      "<button type=\"button\" class=\"arch-item\" data-goto=\"" + x[0] + "\">"
      + "<span class=\"idx\">" + x[1] + "</span>"
      + "<span><strong>" + esc(x[2]) + "</strong><span>" + esc(x[3]) + "</span></span>"
      + "<span class=\"go\">打开</span></button>"
    ).join("")
    + "</div></section>"
    + "<section class=\"arch-lane calc\">"
    + "<div class=\"arch-lane-head\"><div>"
    + "<h2>计算</h2>"
    + "<p>顶栏「计算」· 先映射字段，再在源表每一行计算</p>"
    + "</div><span class=\"tag accent\">确定</span></div>"
    + "<div class=\"arch-lane-body\"><div class=\"arch-flow\">"
    + calcSteps.map((x, i) =>
      "<div class=\"arch-flow-step\">"
      + "<div class=\"arch-flow-rail\"><span class=\"arch-flow-dot\">" + (i + 1) + "</span>"
      + (i < calcSteps.length - 1 ? "<span class=\"arch-flow-line\"></span>" : "")
      + "</div>"
      + "<button type=\"button\" class=\"arch-flow-card\" data-goto=\"engine\" data-calc-stage=\"" + x[0] + "\">"
      + "<strong>" + esc(x[1]) + "</strong><span>" + esc(x[2]) + "</span></button>"
      + "</div>"
    ).join("")
    + "</div></div></section>"
    + "</div>"
    + "<div class=\"arch-note\">"
    + "<strong>客户：</strong>右上角按行业（银行 / 保险 / 零售 / 证券）切换客户。"
    + "<strong> 知识库：</strong>切换客户 / 打开版本时静默同步（本客户 + 全部检索）。"
    + "<strong> 计算：</strong>规则引擎确定性出数，可追溯版本与时点。"
    + "</div>";
}
