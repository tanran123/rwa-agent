(function (global) {
/**
 * 风险暴露分类规则执行引擎
 * ------------------------------------------------------------------
 * 严格实现《权重法风险暴露分类 JSON 怎么写》定义的语义：
 *
 *   1. rules 自上而下，第一条命中就停，再走进它的 children。
 *   2. 这一层都不中时走 otherwise 指向的 fallback。
 *   3. 字段没有填时，引用它的条件不命中。
 *   4. 有 children 的节点不写 value；权重写在最终命中的那一档上。
 *   5. weight.same_as = counterparty_ordinary_claim 时，忘掉当前产品类别，
 *      只看交易对手是谁，从 rules 最外层再分一次。只分这一次，不会回到当前这条。
 *   6. weight.greater_of 里每一项都是一个权重，取最大的。
 *   7. skip 成立就当没有这条，子级也不进；被跳过的那条 when 本来会命中时，
 *      不再走同一层的 otherwise，退回外层继续下一条。
 *
 * 执行过程会留下完整的 trace，供决策树高亮、单笔追溯与 Markdown 底稿使用。
 */

const OPS = ['eq', 'in', 'contains', 'gt', 'gte', 'lt', 'lte'];

/** 取字段值；返回 undefined 表示"没有填"。 */
function rawValue(facts, name) {
  if (facts == null) return undefined;
  const v = facts[name];
  if (v === undefined || v === null || v === '') return undefined;
  return v;
}

function toNumber(v) {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = Number(v.replace(/,/g, '').trim());
    return Number.isNaN(n) ? undefined : n;
  }
  return undefined;
}

/**
 * 求值单个条件 {field, op, match}。
 * 关键语义：字段没填 → 不命中（返回 false），且要如实记录原因。
 */
function evalCondition(cond, facts) {
  const { field, op, match } = cond || {};
  if (!field || !OPS.includes(op)) {
    return { ok: false, missing: false, error: `非法条件 ${JSON.stringify(cond)}` };
  }
  const actual = rawValue(facts, field);
  if (actual === undefined) {
    return { ok: false, missing: true, actual: undefined, field, op, match };
  }

  switch (op) {
    case 'eq':
      return { ok: String(actual) === String(match), actual, field, op, match };
    case 'in': {
      const arr = Array.isArray(match) ? match : [match];
      return { ok: arr.map(String).includes(String(actual)), actual, field, op, match };
    }
    case 'contains': {
      // 多选字段里含有这一项
      const arr = Array.isArray(actual) ? actual : String(actual).split(/[,，;；|]/);
      return { ok: arr.map(String).includes(String(match)), actual, field, op, match };
    }
    case 'gt': case 'gte': case 'lt': case 'lte': {
      const a = toNumber(actual), b = toNumber(match);
      if (a === undefined || b === undefined) {
        return { ok: false, actual, field, op, match, error: '无法转为数字比较' };
      }
      const ok = op === 'gt' ? a > b : op === 'gte' ? a >= b : op === 'lt' ? a < b : a <= b;
      return { ok, actual: a, field, op, match: b };
    }
    default:
      return { ok: false, actual, field, op, match };
  }
}

/** 没有 when 的规则不命中，分类继续往下走。空的 all 仍视为成立。 */
function evalWhen(when, facts) {
  if (!when || typeof when !== 'object') return { ok: false, kind: 'none', items: [], missing: true };
  const kind = 'all' in when ? 'all' : 'any';
  const list = when[kind] || [];
  const items = list.map((c) => {
    if (c && typeof c === 'object' && ('all' in c || 'any' in c)) {
      const sub = evalWhen(c, facts);
      return { nested: true, kind: sub.kind, ...sub };
    }
    return evalCondition(c, facts);
  });
  const ok = kind === 'all' ? items.every((i) => i.ok) : items.some((i) => i.ok);
  return { ok, kind, items };
}

/**
 * 解析权重对象：
 *   { same_as: 'counterparty_ordinary_claim' }
 *   { greater_of: [ 0.9, { same_as: 'counterparty_ordinary_claim' } ] }
 * counterparty 解析函数由外部注入，用于实现"从最外层再分一次"。
 */
function resolveWeight(weight, ctx) {
  if (weight == null) return { value: null, trace: [] };
  if (typeof weight === 'number') return { value: weight, trace: [{ kind: 'const', value: weight }] };

  if (weight.same_as) {
    const r = ctx.counterpartyOrdinaryClaim();
    return {
      value: r.value,
      trace: [{
        kind: 'same_as',
        same_as: weight.same_as,
        resolved: r.value,
        note: '权重等于该交易对手普通债权的权重：忘掉当前产品类别，只看交易对手是谁，从规则最外层再分一次。',
        subPath: r.path,
        error: r.error,
      }],
    };
  }

  if (weight.greater_of) {
    const parts = weight.greater_of.map((item) => {
      if (typeof item === 'number') return { value: item, trace: { kind: 'const', value: item } };
      if (item && item.field) {
        const n = toNumber(ctx && ctx.facts ? ctx.facts[item.field] : undefined);
        return { value: n, trace: { kind: 'field', field: item.field, value: n } };
      }
      const r = resolveWeight(item, ctx);
      return { value: r.value, trace: r.trace[0] };
    });
    const nums = parts.map((p) => p.value).filter((v) => typeof v === 'number');
    const value = nums.length ? Math.max(...nums) : null;
    return {
      value,
      trace: [{
        kind: 'greater_of',
        candidates: parts.map((p) => p.value),
        resolved: value,
        note: `取 ${parts.map((p) => fmtWeight(p.value)).join(' 与 ')} 中的较大者。`,
        parts: parts.map((p) => p.trace),
      }],
    };
  }
  return { value: null, trace: [] };
}

function fmtWeight(w) {
  return typeof w === 'number' ? `${+(w * 100).toFixed(4)}%` : String(w);
}

/** otherwise 写成对象时，这个对象就是兜底节点；写成 true 时再读 fallback。 */
function fallbackNode(rule) {
  if (!rule || typeof rule !== 'object') return null;
  if (rule.fallback && typeof rule.fallback === 'object' && !Array.isArray(rule.fallback)) return rule.fallback;
  if (rule.otherwise && typeof rule.otherwise === 'object' && !Array.isArray(rule.otherwise)) return rule.otherwise;
  return null;
}

function assessmentBadge(rule) {
  const when = rule && rule.when;
  const list = when && (when.all || when.any || (when.field ? [when] : []));
  if (!list) return '';
  for (const item of list) {
    if (!item || item.field !== 'assessment_count') continue;
    const n = item.match != null ? item.match : item.value;
    const op = item.op || 'eq';
    if (op === 'eq' && Number(n) === 1) return '用该评级';
    if (op === 'eq' && Number(n) === 2) return '用较高权重';
    if (op === 'gte') return '两个较低里较高的一个';
    return '按评级个数取值';
  }
  return '';
}

/** 节点上显示的那一步。没有单独权重时不编一个百分比。 */
function ruleBadge(rule) {
  if (!rule) return '';
  if (typeof rule.value === 'number') return fmtWeight(rule.value);
  const w = rule.weight;
  if (w && typeof w === 'object') {
    if (w.same_as) return '按交易对手';
    if (Array.isArray(w.greater_of)) {
      let floor = null;
      let field = '';
      let counterparty = false;
      w.greater_of.forEach((item) => {
        if (typeof item === 'number') floor = item;
        else if (item && item.field) field = String(item.field);
        else if (item && item.same_as) counterparty = true;
      });
      if (field && !counterparty) {
        return (floor == null ? '' : fmtWeight(floor) + ' ') + '与已得权重较大值';
      }
      return fmtWeight(floor == null ? 0.9 : floor) + ' 与交易对手较大值';
    }
  }
  if (rule.collateral_value_factor != null && rule.collateral_value_factor !== '') {
    const n = Number(rule.collateral_value_factor);
    if (!Number.isNaN(n)) return '抵押品价值 × ' + fmtWeight(n);
  }
  const picked = assessmentBadge(rule);
  if (picked) return picked;
  if (Array.isArray(rule.pick)) return '按评级个数取值';
  if (typeof rule.formula === 'string' && rule.formula) return '缓释拆分';
  return '';
}

function ruleRole(rule) {
  if (!rule) return '';
  const id = String(rule.name || '');
  if (id.indexOf('crm_') === 0 || rule.formula || rule.covered || rule.collateral_value_factor != null) return 'crm';
  if (id.indexOf('multiple_assessments') === 0 || rule.pick) return 'assessment';
  return '';
}

/** 给规则节点生成稳定路径 id，便于决策树定位与审计引用。 */
function nodePath(parentPath, node, index) {
  return `${parentPath}/${index}:${node.name}`;
}

/**
 * 在一层里执行规则路由。
 * @returns 命中结果，含 trace
 */
function evalLayer(nodes, facts, opts) {
  const { basePath, ctx, depth, trace } = opts;
  const layerTrace = [];

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const path = nodePath(basePath, node, i);
    const entry = {
      path, name: node.name, label: node.label, index: i, depth,
      status: 'evaluating', condition: null, skipped: false, note: node.note || null,
      reference: node.reference || null,
    };

    // ---- skip：整段跳过，子级也不进 ----
    if (node.skip) {
      const sk = evalCondition(node.skip, facts);
      entry.skipTrace = sk;
      if (sk.ok) {
        entry.status = 'skipped';
        entry.skipped = true;
        entry.skipReason = `skip 条件成立（${sk.field} = ${sk.actual}），本段整段跳过，不再进入其子级，也不走本层 otherwise。`;
        layerTrace.push(entry);
        continue;  // 退回本层继续下一条
      }
    }

    // ---- when ----
    const w = evalWhen(node.when, facts);
    entry.condition = w;

    if (!w.ok) {
      entry.status = 'not-matched';
      layerTrace.push(entry);
      continue;
    }

    entry.status = 'matched';
    layerTrace.push(entry);

    // ---- 命中：先看有没有 children 要继续下钻 ----
    if (node.children && node.children.length) {
      const sub = evalLayer(node.children, facts, {
        basePath: path, ctx, depth: depth + 1, trace,
      });
      if (sub.result) {
        // 子层命中了：暴露大类取外层节点，子类取叶子
        entry.children = sub.trace;
        const merged = {
          ...sub.result,
          exposureClassLabel: node.label,
          topRuleName: node.name,
          topRuleLabel: node.label,
          topPath: path,
          topReference: node.reference || null,
        };
        return { result: merged, trace: layerTrace, node, path, viaChildren: true };
      }
      // 子层全不中 → 该节点自己的兜底。JSON 里 otherwise 本身就是那个节点。
      entry.children = sub.trace;
      entry.childrenExhausted = true;
      const fbNode = fallbackNode(node);
      if (fbNode) {
        const fbResult = enterFallback(fbNode, facts, path, ctx, depth, entry);
        if (fbResult) return { result: fbResult, trace: layerTrace, node, path };
      }
      // 子层全不中且本节点无兜底：本节点视为未命中，继续本层下一条
      entry.status = 'branch-exhausted';
      entry.exhaustReason = '子规则全部未命中，且本节点未配置兜底，继续同层下一条规则。';
      continue;
    }

    // ---- 叶子：产出权重 ----
    const out = evalTerminal(node, facts, { basePath: path, ctx, depth, node, path });
    if (out.result) {
      entry.outcome = out.result;
      return { result: out.result, trace: layerTrace, node, path };
    }
    entry.status = 'no-outcome';
    entry.exhaustReason = out.reason || '该节点没有任何产出。';
  }

  // ---- 整层都不中：走本层的 otherwise ----
  return { result: null, trace: layerTrace, exhausted: true };
}

/** 进入兜底节点。它自己还可以再有 children 和 otherwise。 */
function enterFallback(fb, facts, path, ctx, depth, entry) {
  if (fb.when && !evalWhen(fb.when, facts).ok) return null;
  const fbPath = path + '>otherwise';
  if (fb.children && fb.children.length) {
    const sub = evalLayer(fb.children, facts, {
      basePath: fbPath, ctx, depth: depth + 1, trace: [],
    });
    entry.fallbackChildren = sub.trace;
    if (sub.result) return sub.result;
    const nested = fallbackNode(fb);
    if (nested) {
      const nestedResult = enterFallback(nested, facts, fbPath, ctx, depth + 1, entry);
      if (nestedResult) return nestedResult;
    }
    if (typeof fb.value !== 'number' && !fb.weight) return null;
  }
  const term = evalTerminal(fb, facts, { basePath: fbPath, ctx, depth: depth + 1, node: fb, path: fbPath });
  entry.fallbackUsed = term;
  return term.result;
}

/** 求一个终结节点（叶子或 fallback）的产出。 */
function evalTerminal(node, facts, opts) {
  const { ctx, path } = opts;
  if (node.when && !evalWhen(node.when, facts).ok) {
    return { result: null, reason: '兜底节点的 when 不成立。' };
  }
  const weightTrace = [];
  let value = null;
  let weightKind = 'none';

  if (typeof node.value === 'number') {
    value = node.value;
    weightKind = 'const';
    weightTrace.push({ kind: 'const', value, note: `规则直接给定风险权重 ${fmtWeight(value)}。` });
  } else if (node.weight) {
    const r = resolveWeight(node.weight, ctx);
    value = r.value;
    weightKind = node.weight.same_as ? 'same_as' : 'greater_of';
    weightTrace.push(...r.trace);
  }

  return {
    result: {
      ruleName: node.name,
      ruleLabel: node.label,
      path,
      exposureClassLabel: node.label,
      topRuleName: node.name,
      topRuleLabel: node.label,
      topPath: path,
      topReference: node.reference || null,
      exposureClass: node.exposure_class || node.class || null,
      subClass: node.label,
      riskWeight: value,
      weightKind,
      weightTrace,
      note: node.note || null,
      reference: node.reference || ctx.defaultReference || null,
    },
  };
}

/**
 * 主入口：对一笔债项执行完整的暴露分类。
 *
 * @param {object} ruleset  resolves_to 部分
 * @param {object} facts    标准字段取值
 * @param {object} options  { extensions: boolean }
 * @returns {object} { classified, trace, weightTrace, matchedRule, errors, warnings }
 */
function classify(ruleset, facts, options = {}) {
  const useExt = options.extensions !== false;
  const allRules = ruleset.rules || [];
  const extRules = (ruleset.extensions || []).map((e) => ({ ...e, __extension: true }));

  const topTrace = [];
  const errors = [];
  const warnings = [];

  // 交易对手普通债权权重：忘掉当前产品类别，只看交易对手是谁，从最外层再分一次。
  // 只分这一次，不会回到当前这条 —— 用一个 depth 守卫防止无限递归。
  let counterpartyDepth = 0;
  const ctx = {
    facts,
    defaultReference: ruleset.reference || null,
    counterpartyOrdinaryClaim() {
      if (counterpartyDepth > 0) {
        return { value: null, path: null, error: '递归解析交易对手权重，已中止。' };
      }
      counterpartyDepth++;
      try {
        // 用一个只保留主体类别字段的 facts 副本，避免房地产/产品特征再次命中
        const cpFacts = {
          counterparty_type: facts.counterparty_type,
          instrument_type: 'claim',
          is_defaulted: 'no',
        };
        const sub = evalLayer(allRules, cpFacts, {
          basePath: 'cp', ctx: {
            ...ctx,
            facts: cpFacts,
            counterpartyOrdinaryClaim: () => ({ value: null, path: null, error: '嵌套解析已中止。' }),
          }, depth: 0, trace: [],
        });
        if (sub.result) {
          return { value: sub.result.riskWeight, path: sub.path, ruleLabel: sub.result.ruleLabel };
        }
        return { value: null, path: null, error: '未能解析出该交易对手的普通债权权重。' };
      } finally {
        counterpartyDepth--;
      }
    },
  };

  const layer = evalLayer(allRules, facts, {
    basePath: '', ctx, depth: 0, trace: topTrace,
  });

  let final = layer.result;

  // ---- 扩展：挂在已经命中的某条规则下面，不插进 rules 中间 ----
  if (final && useExt && extRules.length) {
    for (const ext of extRules) {
      if (ext.attach_to !== final.ruleName) continue;
      const extLayer = evalLayer(ext.children || [], facts, {
        basePath: `${final.path}>ext:${ext.attach_to}`, ctx, depth: 0, trace: [],
      });
      ext.__trace = extLayer.trace;
      if (extLayer.result) {
        // 扩展只在原分类之下细分，不改变暴露大类
        final = {
          ...final,
          subClass: extLayer.result.subClass,
          extensionRule: extLayer.result.ruleName,
          extensionTrace: extLayer.trace,
          parentClass: final.ruleLabel,
        };
        warnings.push(`命中银行自定义扩展「${extLayer.result.ruleLabel}」，暴露大类仍为「${final.ruleLabel}」。`);
      } else {
        warnings.push(`扩展「${ext.attach_to}」未细分命中，保留原分类。`);
      }
      break;
    }
  }

  if (!final) {
    const top = fallbackNode(ruleset);
    if (top) {
      final = {
        ruleName: top.name,
        ruleLabel: top.label,
        path: '>otherwise/' + top.name,
        exposureClassLabel: top.label,
        topRuleName: top.name,
        topRuleLabel: top.label,
        riskWeight: typeof top.value === 'number' ? top.value : null,
        weightKind: typeof top.value === 'number' ? 'const' : 'none',
        weightTrace: [],
        note: top.note || null,
        reference: top.reference || null,
      };
    } else {
      errors.push('未命中任何暴露分类规则，且规则集未配置兜底。该笔债项应进入人工处理流程。');
    }
  }
  if (final && final.riskWeight == null) {
    errors.push(`命中规则「${final.ruleLabel}」，但未能确定风险权重，需人工确认。`);
  } else if (final && final.riskWeight != null && !(final.riskWeight >= 0)) {
    errors.push(`风险权重 ${final.riskWeight} 非法。`);
  }
  if (layer.exhausted && !final) {
    warnings.push('该笔债项走完整个规则集仍未命中，属于异常债项。');
  }

  return {
    classified: !!final,
    result: final,
    trace: layer.trace,
    matchedRule: final ? final.ruleName : null,
    errors, warnings,
    counterpartyDepthUsed: counterpartyDepth,
  };
}

/** 决策树渲染用：把 rules 摊平成节点列表（含位置与父子关系）。 */
function flattenRules(ruleset) {
  const out = [];
  const walk = (nodes, parentPath, depth, parentName) => {
    (nodes || []).forEach((n, i) => {
      const path = nodePath(parentPath, n, i);
      out.push({
        path, name: n.name, label: n.label, depth, parentName, index: i,
        when: n.when, skip: n.skip, value: n.value, weight: n.weight,
        note: n.note, reference: n.reference, fields: n.fields || [],
        hasChildren: !!(n.children && n.children.length),
        otherwise: !!fallbackNode(n), fallback: fallbackNode(n),
        childCount: (n.children || []).length,
        isLeafOutcome: (typeof n.value === 'number') || !!n.weight,
      });
      walk(n.children, path, depth + 1, n.name);
      const fb = fallbackNode(n);
      if (fb) walk([fb], path + '>otherwise', depth + 1, n.name);
    });
  };
  walk(ruleset.rules, '', 0, null);
  const top = fallbackNode(ruleset);
  if (top) walk([top], '>otherwise', 0, null);
  return out;
}

/** 把标准字段代入后，列出每一层"适用/不适用"的判断，用于决策树剪枝预览。 */
function applicableBranches(ruleset, facts) {
  const res = new Map();
  for (const n of flattenRules(ruleset)) {
    const w = evalWhen(n.when, facts);
    const sk = n.skip ? evalCondition(n.skip, facts) : null;
    res.set(n.path, {
      matched: w.ok,
      whenTrace: w,
      skipped: !!(sk && sk.ok),
      skipTrace: sk,
    });
  }
  return res;
}

const ExposeEngine = {
  classify, evalWhen, evalCondition, flattenRules, applicableBranches,
  resolveWeight, fmtWeight, fallbackNode, ruleBadge, ruleRole, OPS, toNumber,
};

if (typeof window !== 'undefined') window.ExposeEngine = ExposeEngine;
if (typeof module !== 'undefined' && module.exports) module.exports = ExposeEngine;
})(typeof window !== "undefined" ? window : globalThis);
