/**
 * 应用状态与数据访问层
 * ---------------------------------------------------------------
 * 负责：加载规则集、维护当前计量上下文（地区/版本/基准日/机构）、
 * 维护计量批次与其结果、把规则编辑写回规则集（配置真正驱动计算）。
 */
(function (global) {
  const LS_KEY = 'rwa-audit-state-v1';

  const state = {
    rulesets: {},          // jurisdiction -> ruleset 对象（可被编辑）
    loaded: {},
    ctx: {                 // 当前计量上下文
      jurisdiction: 'MO',
      versionId: 'rv-mo-2026-1',
      baseDate: '2026-09-30',
      institution: '澳门分行',
      batchName: '2026年9月澳门分行信用风险计量',
    },
    batches: [],           // 历史批次（含本次运行）
    lastRun: null,         // 最近一次计量结果
    overrides: {},         // 产品类型人工调整 { loanId: productCode }
    ruleEdits: {},         // 用户新增/修改的规则，按地区版本保存
    route: 'dashboard',
  };

  const JURIS_FILES = {
    MO: 'data/ruleset_cn_mo.json',
    CN: 'data/ruleset_cn.json',
    HK: 'data/ruleset_hk.json',
  };

  /** 规则集也以 JS 形式内嵌，使得双击 file:// 打开也能正常工作 */
  const JURIS_GLOBALS = { MO: 'RULESET_MO', CN: 'RULESET_CN', HK: 'RULESET_HK' };

  /** 深拷贝，避免规则编辑污染源数据 */
  const clone = (o) => JSON.parse(JSON.stringify(o));

  async function loadRuleset(jur) {
    if (state.rulesets[jur]) return state.rulesets[jur];

    // 优先使用内嵌的 JS 规则集：不依赖 fetch，file:// 下也能加载
    const g = JURIS_GLOBALS[jur];
    if (g && global[g]) {
      state.rulesets[jur] = clone(global[g]);
      state.loaded[jur] = true;
      return state.rulesets[jur];
    }

    // 回退：通过 HTTP 读取 JSON 文件
    const url = JURIS_FILES[jur] || JURIS_FILES.MO;
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const doc = await res.json();
      state.rulesets[jur] = doc;
      state.loaded[jur] = true;
      return doc;
    } catch (e) {
      throw new Error(
        `无法加载 ${App.j2label(jur)} 的规则集（${url}）：${e.message}。` +
        `请确认 data/ruleset_${jur.toLowerCase()}.js 存在，或改用本地 HTTP 服务打开。`
      );
    }
  }

  async function loadClassDoc() {
    if (state.classDoc) return state.classDoc;
    const res = await fetch('/api/exposure-class.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const doc = await res.json();
    if (!doc || !Array.isArray(doc.rules)) throw new Error('分类 JSON 没有 rules');
    state.classDoc = clone(doc);
    state.classSource = '权重法风险暴露分类.json';
    return state.classDoc;
  }

  const currentRuleset = () => {
    if (state.classDoc) return state.classDoc;
    const doc = state.rulesets[state.ctx.jurisdiction];
    return doc ? doc.resolves_to : null;
  };

  const currentVersion = () =>
    MASTER.RULE_VERSIONS.find((v) => v.id === state.ctx.versionId)
    || MASTER.RULE_VERSIONS.find((v) => v.jurisdiction === state.ctx.jurisdiction && v.status === 'published');

  /* ---------------- 规则集遍历工具 ---------------- */
  /** 深度优先遍历所有规则节点（含 children 与 fallback） */
  function walkRules(nodes, fn, parentPath = '', depth = 0, parentLabel = null) {
    (nodes || []).forEach((n, i) => {
      const path = `${parentPath}/${i}:${n.name}`;
      fn(n, { path, depth, index: i, parentPath, parentLabel });
      if (n.children) walkRules(n.children, fn, path, depth + 1, n.label);
      const fb = global.ExposeEngine && ExposeEngine.fallbackNode(n);
      if (fb) walkRules([fb], fn, `${path}>otherwise`, depth + 1, n.label);
    });
  }

  function findRule(name) {
    const rs = currentRuleset();
    if (!rs) return null;
    let found = null;
    walkRules(rs.rules, (n, meta) => { if (n.name === name) found = { node: n, meta }; });
    const topFb = global.ExposeEngine && ExposeEngine.fallbackNode(rs);
    if (!found && topFb) walkRules([topFb], (n, meta) => { if (n.name === name) found = { node: n, meta }; }, '>otherwise');
    if (!found && rs.extensions) {
      rs.extensions.forEach((e, i) => {
        walkRules(e.children, (n, meta) => {
          if (n.name === name) found = { node: n, meta: { ...meta, extension: e, extIndex: i } };
        }, `ext${i}`, 0);
      });
    }
    return found;
  }

  /** 把一条规则加到某个父节点的 children 末尾（或顶层） */
  function addRule(rule, parentName) {
    const rs = currentRuleset();
    if (!rs) return;
    if (!parentName) { rs.rules.push(rule); return; }
    const p = findRule(parentName);
    if (!p) throw new Error(`找不到父规则 ${parentName}`);
    if (!p.node.children) p.node.children = [];
    p.node.children.push(rule);
  }

  function removeRule(name) {
    const rs = currentRuleset();
    if (!rs) return false;
    let done = false;
    const sweep = (arr) => {
      for (let i = 0; i < arr.length; i++) {
        if (arr[i].name === name) { arr.splice(i, 1); done = true; return true; }
        if (arr[i].children && sweep(arr[i].children)) return true;
        if (arr[i].fallback && arr[i].fallback.name === name) { delete arr[i].fallback; delete arr[i].otherwise; done = true; return true; }
      }
      return false;
    };
    sweep(rs.rules);
    if (rs.extensions) rs.extensions.forEach((e) => e.children && sweep(e.children));
    return done;
  }

  /** 更新规则节点的字段 */
  function updateRule(name, patch) {
    const f = findRule(name);
    if (!f) return false;
    Object.assign(f.node, patch);
    return true;
  }

  /** 冻结当前规则集的版本指纹，供审计追溯使用 */
  function rulesetFingerprint() {
    const rs = currentRuleset();
    const s = JSON.stringify(rs);
    let hash = 0;
    for (let i = 0; i < s.length; i++) { hash = ((hash << 5) - hash + s.charCodeAt(i)) | 0; }
    return {
      rulesetId: rs.id, version: rs.version,
      nodes: countNodes(rs), hash: (hash >>> 0).toString(16).padStart(8, '0'),
      frozenAt: new Date().toISOString().replace('T', ' ').slice(0, 19),
    };
  }

  function countNodes(rs) {
    let n = 0;
    walkRules(rs.rules, () => { n++; });
    (rs.extensions || []).forEach((e) => walkRules(e.children, () => { n++; }));
    return n;
  }

  /** 收集规则集里实际用到的所有字段（含节点级 fields） */
  function collectFields(rs) {
    const byName = {};
    (rs.fields || []).forEach((f) => { byName[f.name] = { ...f, scope: '顶层' }; });
    walkRules(rs.rules, (n, meta) => {
      (n.fields || []).forEach((f) => {
        if (!byName[f.name]) byName[f.name] = { ...f, scope: n.label || n.name };
      });
    });
    (rs.extensions || []).forEach((e) => walkRules(e.children, (n) => {
      (n.fields || []).forEach((f) => { if (!byName[f.name]) byName[f.name] = { ...f, scope: n.label || n.name }; });
    }));
    return byName;
  }

  /** 统计每条规则被哪些产品引用（用于"被哪些计量规则引用"） */
  function rulesReferencedByProducts(ruleName, products, productsRules) {
    const out = [];
    Object.entries(productsRules).forEach(([code, rules]) => {
      if (rules.some((r) => r.name === ruleName)) {
        const p = products.find((x) => x.code === code);
        out.push(p ? p.label : code);
      }
    });
    return out;
  }

  /* ---------------- 本地持久化 ---------------- */
  function persist() {
    try {
      const slim = {
        ctx: state.ctx,
        overrides: state.overrides,
        batches: state.batches.map((b) => ({ ...b, results: undefined })),
      };
      localStorage.setItem(LS_KEY, JSON.stringify(slim));
    } catch (e) { /* 忽略配额错误 */ }
  }
  function restore() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      const s = JSON.parse(raw);
      if (s.ctx) Object.assign(state.ctx, s.ctx);
      if (s.overrides) state.overrides = s.overrides;
      if (s.batches && s.batches.length) state.batches = s.batches;
    } catch (e) { /* 忽略 */ }
  }
  function resetAll() {
    localStorage.removeItem(LS_KEY);
    state.batches = []; state.overrides = {}; state.lastRun = null;
  }

  global.Store = {
    state, clone, loadRuleset, loadClassDoc, currentRuleset, currentVersion,
    walkRules, findRule, addRule, removeRule, updateRule,
    rulesetFingerprint, countNodes, collectFields, rulesReferencedByProducts,
    persist, restore, resetAll, JURIS_FILES,
  };
})(window);
