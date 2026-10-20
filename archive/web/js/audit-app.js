/**
 * 审计原型的路由。页面挂在现有顶栏下面，不再自建侧栏。
 */
(function (global) {
  const registry = {};
  const register = (id, fn) => { registry[id] = fn; };
  let rulesetError = null;

  const GROUP_OF = {
    dashboard: "总览",
    versions: "规则配置",
    clauses: "规则配置",
    fields: "规则配置",
    generic: "暴露分类规则",
    productRules: "暴露分类规则",
    tree: "暴露分类规则",
    assistant: "暴露分类规则",
    eadOn: "EAD 计算规则",
    eadOff: "EAD 计算规则",
    wizard: "计量执行",
    results: "计量执行",
    batches: "计量执行",
    export: "计量执行",
    mapping: "计量执行"
  };

  function setHeader(title, crumb) {
    const t = document.getElementById("auditTitle");
    const c = document.getElementById("auditCrumb");
    const b = document.getElementById("auditBlurb");
    const route = global.Store ? global.Store.state.route : "";
    if (c) c.textContent = GROUP_OF[route] || "";
    if (t) t.textContent = title || "";
    if (b) {
      b.textContent = crumb || "";
      b.hidden = !crumb;
    }
  }

  function paint(id) {
    const root = document.getElementById("auditBody");
    if (!root || !registry[id]) return;
    try {
      if (rulesetError && !global.Store.currentRuleset()) {
        root.innerHTML = "";
        setHeader("规则集未加载", "");
        root.appendChild(global.UI.notice("danger", String(rulesetError.message || rulesetError), "规则集加载失败"));
        return;
      }
      registry[id](root);
    } catch (err) {
      console.error(err);
      root.innerHTML = "";
      root.appendChild(global.UI.notice("danger", String(err && err.message || err), "页面渲染失败"));
    }
  }

  function go(id) {
    if (!registry[id]) {
      if (global.UI) global.UI.toast("页面 " + id + " 不存在", "err");
      return;
    }
    global.Store.state.route = id;
    if (typeof state !== "undefined" && state.page !== id) {
      state.page = id;
      state.navOpen = null;
      if (typeof render === "function") render();
      return;
    }
    paint(id);
  }

  function option(value, label, selected) {
    const o = document.createElement("option");
    o.value = value;
    o.textContent = label;
    o.selected = !!selected;
    return o;
  }

  function chip(label, node) {
    const box = document.createElement("div");
    box.className = "client-switch";
    const lab = document.createElement("label");
    lab.textContent = label;
    box.appendChild(lab);
    box.appendChild(node);
    return box;
  }

  function renderContext() {
    const el = document.getElementById("auditCtx");
    if (!el || !global.Store || !global.MASTER) return;
    const ctx = global.Store.state.ctx;
    el.innerHTML = "";

    const inst = document.createElement("select");
    ["澳门分行", "总行（法人）", "香港分行"].forEach((name) => {
      inst.appendChild(option(name, name, name === ctx.institution));
    });
    inst.onchange = () => {
      ctx.institution = inst.value;
      global.Store.persist();
      global.UI.toast("已切换机构：" + ctx.institution, "ok");
    };
    el.appendChild(chip("机构", inst));

    const jur = document.createElement("select");
    global.MASTER.JURISDICTIONS.forEach((x) => {
      jur.appendChild(option(x.code, x.label, x.code === ctx.jurisdiction));
    });
    jur.onchange = async () => {
      ctx.jurisdiction = jur.value;
      const first = global.MASTER.RULE_VERSIONS.find((x) => x.jurisdiction === ctx.jurisdiction && x.status === "published");
      if (first) ctx.versionId = first.id;
      try {
        await global.Store.loadRuleset(ctx.jurisdiction);
        rulesetError = null;
      } catch (e) {
        rulesetError = e;
      }
      global.Store.persist();
      global.UI.toast("已切换地区：" + j2label(ctx.jurisdiction), "ok");
      if (typeof global.render === "function") global.render();
    };
    el.appendChild(chip("地区", jur));

    const vers = global.MASTER.RULE_VERSIONS.filter((x) => x.jurisdiction === ctx.jurisdiction);
    const ver = document.createElement("select");
    vers.forEach((x) => {
      const status = global.MASTER.RULE_STATUS[x.status];
      const extra = x.status === "published" || !status ? "" : "（" + status.label + "）";
      ver.appendChild(option(x.id, x.version + extra, x.id === ctx.versionId));
    });
    ver.onchange = () => {
      ctx.versionId = ver.value;
      global.Store.persist();
      const current = global.Store.currentVersion();
      global.UI.toast("已切换规则版本：" + (current ? current.version : ver.value), "ok");
      if (typeof global.render === "function") global.render();
    };
    el.appendChild(chip("版本", ver));

    const date = document.createElement("span");
    date.className = "ctx-date";
    date.textContent = ctx.baseDate || "";
    el.appendChild(chip("基准日", date));

    const goBtn = document.createElement("button");
    goBtn.type = "button";
    goBtn.className = "btn btn-primary";
    goBtn.textContent = "发起计量";
    goBtn.onclick = () => go("wizard");
    el.appendChild(goBtn);
  }

  const j2label = (c) => (global.MASTER.JURISDICTIONS.find((x) => x.code === c) || {}).label || c;

  async function boot() {
    global.Store.restore();
    try {
      await global.Store.loadRuleset(global.Store.state.ctx.jurisdiction);
      await global.Store.loadClassDoc();
      rulesetError = null;
    } catch (e) {
      rulesetError = e;
      console.error(e);
    }
  }

  register("mapping", (root) => {
    setHeader("字段映射", "映射确认是计量向导里的一步，未确认的必填字段不能进入下一步");
    root.innerHTML = "";
    root.appendChild(global.UI.notice(
      "info",
      "在计量向导的「字段映射确认」里核对源字段和标准字段。向导会拦住还没确认的必填项。",
      "映射在向导中完成"
    ));
    root.appendChild(global.UI.h("div", { style: { marginTop: "12px" } },
      global.UI.h("button", { class: "btn primary", onclick: () => go("wizard") }, "打开计量向导")));
  });

  global.App = {
    boot,
    go,
    show: paint,
    register,
    setHeader,
    renderTopbar: renderContext,
    renderContext,
    renderNav: function () {
      if (typeof global.renderNav === "function") global.renderNav();
    },
    j2label
  };
})(window);
