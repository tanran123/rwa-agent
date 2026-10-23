/**
 * 信用风险 RWA 计量流水线
 * ------------------------------------------------------------------
 * 严格区分三个相互独立、前后衔接的阶段：
 *   第一阶段：信用风险暴露分类   → 暴露大类 / 子类 + 命中规则
 *   第二阶段：EAD 计算           → 表内 EAD / 表外 EAD
 *   第三阶段：风险权重与 RWA     → RWA = 适用的信用风险暴露金额 × 适用风险权重
 *
 * 每笔债项保留完整证据链：
 *   原始数据 → 标准字段 → 规则判断 → 暴露分类 → EAD 计算 → 风险权重 → RWA → 监管依据
 */

(function (global) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const E = isNode ? require('./engine.cjs') : global.ExposeEngine;

  /* ---------------- 第一阶段：产品类型识别 ---------------- */
  function detectProduct(loan, rules) {
    const code = (loan.raw && (loan.raw.productCode || loan.raw.facilityType)) || '';
    for (const r of rules) {
      if (r.match.test(code)) return { product: r.product, basis: r.basis, confidence: 'high' };
    }
    // 退化判断：按科目号
    const gl = (loan.raw && loan.raw.glAcct) || '';
    if (/^10/.test(gl)) return { product: 'bond', basis: '按总账科目号推断为 101x 债券投资', confidence: 'medium' };
    if (/^212/.test(gl)) return { product: 'ib_call', basis: '按总账科目号推断为 212 存放同业（活期）', confidence: 'medium' };
    if (/^222/.test(gl)) return { product: 'ib_time', basis: '按总账科目号推断为 222 存放同业（定期）', confidence: 'medium' };
    if (/^90/.test(gl)) return { product: 'off_bs', basis: '按总账科目号推断为 90x 表外科目', confidence: 'medium' };
    return { product: null, basis: '无法从产品代码或科目号识别产品类型，需人工指定。', confidence: 'none' };
  }

  /* ---------------- 第二阶段：EAD 计算 ---------------- */
  const FE = isNode ? require('./formula.cjs') : global.FormulaEngine;

  function productMeta(code) {
    const list = (typeof MASTER !== 'undefined' && MASTER.PRODUCT_TYPES) || [];
    return list.find((p) => p.code === code) || null;
  }

  function eadMiss(kind, message) {
    return {
      kind, ruleId: null, ruleName: '未匹配到该产品的 EAD 规则',
      onEad: null, offEad: null, ead: null, steps: [], formula: '—',
      clause: null, params: [], error: message,
    };
  }

  function eadSkipped(kind, reason) {
    return {
      kind, ruleId: null, ruleName: '该产品无需配置 EAD 规则',
      onEad: null, offEad: null, ead: null, steps: [], formula: '—',
      clause: null, params: [], skipped: true,
      skipReason: reason || '用户已标记该产品无需配置 EAD 计算规则。', error: null,
    };
  }

  /** 适用条件是否命中。没有条件、或条件为空数组，都算无条件命中。 */
  function conditionsOk(rule, facts) {
    const when = rule && rule.conditions;
    if (!when || typeof when !== 'object') return true;
    const list = when.all || when.any;
    if (!Array.isArray(list) || !list.length) return true;
    return E.evalWhen(when, facts).ok;
  }

  /** 规则的结构化引用。库里存的是 JSON，可能已经被上层解析过。 */
  function structuredOf(rule) {
    const raw = rule && rule.structured;
    if (raw == null) return null;
    if (typeof raw === 'string') {
      try { return JSON.parse(raw); } catch { return null; }
    }
    return typeof raw === 'object' ? raw : null;
  }

  /** 公式求值用的事实表。结构化引用里的变量名已经是 std_field，std 里就有。 */
  function eadFacts(rule, std) {
    const facts = { ...std };
    (rule.fields || []).forEach((f) => {
      const key = f.stdField || f.code;
      if (key == null || std[key] == null) return;
      if (f.name) facts[f.name] = std[key];
      if (f.code) facts[f.code] = std[key];
      facts[key] = std[key];
    });
    return facts;
  }

  /**
   * 按产品配置的公式算 EAD。
   * eadConfig 形如 { [productCode]: { needed, reason, side, rules } }，由调用方从库里读好传进来。
   */
  function computeEad(loan, product, eadConfig) {
    const std = loan.std || {};
    const isOff = std.offbalance === 'yes';
    const kind = isOff ? 'off' : 'on';
    const meta = productMeta(product);
    const label = meta ? meta.label : (product || '');

    if (!product) {
      return eadMiss(kind, '计算 EAD 前必须先确定产品类型。未选择产品时，不套用其他产品的规则。');
    }

    const cfg = (eadConfig || {})[product] || null;
    if (!cfg) return eadMiss(kind, `产品「${label}」在 ead_product_config 里没有配置。`);
    if (cfg.needed === false || cfg.needed === 0) return eadSkipped(kind, cfg.reason);
    if (cfg.side !== kind) {
      return eadMiss(kind,
        `产品「${label}」配置的是${cfg.side === 'off' ? '表外' : '表内'} EAD 规则，`
        + `这笔债项走的是${isOff ? '表外' : '表内'}口径，两者对不上。`);
    }

    const published = (cfg.rules || []).filter((r) => r.status === 'published');
    if (!published.length) {
      return eadMiss(kind,
        `产品「${label}」已标记为需要配置 EAD 规则，但尚未配置${isOff ? '表外' : '表内'} EAD 计算规则。`);
    }

    // 同一产品下自上而下，第一条适用条件命中的规则生效；都没命中就退回第一条。
    const rule = published.find((r) => conditionsOk(r, std)) || published[0];

    const structured = structuredOf(rule);
    if (!structured) {
      return eadMiss(kind, `规则「${rule.name}」缺少结构化公式，无法计算。请在 EAD 计算规则页重新保存。`);
    }

    const facts = eadFacts(rule, std);
    // 表外：债项自带 ccf 时以债项为准，没带才用规则里配的。
    if (isOff) facts.CCF = std.ccf != null ? num(std.ccf) : (rule.ccf != null ? Number(rule.ccf) : null);

    const evaluated = FE.evaluateWithSteps(structured, facts);
    const ead = evaluated.value == null ? null : round2(evaluated.value);

    const steps = [];
    steps.push({ n: 1, label: '适用产品', expr: 'product', value: label,
      note: `只在「${label}」的${isOff ? '表外' : '表内'} EAD 规则中匹配，不使用其他产品的公式。` });
    steps.push({ n: 2, label: '命中规则', expr: rule.id, value: rule.name, note: rule.condition || '' });
    evaluated.steps.forEach((s) => {
      if (s.type === 'field') {
        steps.push({ n: steps.length + 1, label: s.label, expr: s.code, value: s.value,
          note: `取本产品的标准字段「${s.label}」。` });
      } else if (s.type === 'op') {
        steps.push({ n: steps.length + 1, label: s.op, expr: `${fmt(s.left)} ${s.op} ${fmt(s.right)}`, value: s.value });
      } else {
        steps.push({ n: steps.length + 1, label: s.fn, expr: `${s.fn}(${s.args.map(fmt).join(', ')})`, value: s.value });
      }
    });
    steps.push({ n: steps.length + 1, label: isOff ? '表外 EAD' : '表内 EAD', expr: rule.formula || '—', value: ead,
      note: `按「${rule.name}」的公式计算。` });

    return {
      kind, product, productLabel: label, ruleId: rule.id, ruleName: rule.name,
      ccf: isOff ? facts.CCF : null,
      onEad: isOff ? 0 : ead, offEad: isOff ? ead : 0, ead, steps,
      formula: rule.formula, clause: rule.clause || null, params: rule.params || [],
      error: ead == null ? '公式求值失败，引用的标准字段在这笔债项上取不到值。' : null,
    };
  }

  /* ---------------- 第三阶段：RWA ---------------- */
  function computeRwa(ead, riskWeight) {
    if (riskWeight == null || ead == null) return { rwa: null, steps: [] };
    const rwa = round2(ead * riskWeight);
    return {
      rwa,
      steps: [
        { n: 1, label: '适用的信用风险暴露金额（EAD）', expr: 'ead', value: ead },
        { n: 2, label: '适用风险权重', expr: 'risk_weight', value: riskWeight, display: pct(riskWeight) },
        { n: 3, label: '信用风险加权资产', expr: `${fmt(ead)} × ${pct(riskWeight)}`, value: rwa,
          note: '仅适用于标准法下的简化计算。需要进一步调整或采用其他计量方法的情形，以对应监管规则为准。' },
      ],
    };
  }

  /* ---------------- 主流程 ---------------- */
  function measure(loan, ctx) {
    const { ruleset, eadConfig, detectRules, productOverride, productById } = ctx;

    const stage1 = { name: '产品类型识别', status: 'ok', log: [] };
    const picked = productById && productById[loan.id];
    const det = picked
      ? { product: picked, basis: '从产品配置中选择', confidence: 'manual' }
      : productOverride
      ? { product: productOverride, basis: '用户在向导中人工确认/调整的产品类型。', confidence: 'manual' }
      : loan.productAssigned
      ? { product: loan.productAssigned, basis: loan.productBasis || '按工作表对应产品', confidence: 'high' }
      : detectProduct(loan, detectRules);
    stage1.product = det.product;
    stage1.basis = det.basis;
    stage1.confidence = det.confidence;
    if (!det.product) { stage1.status = 'exception'; stage1.error = det.basis; }

    const stage2 = { name: '信用风险暴露分类', status: 'ok', log: [] };
    let cls = null;
    const meta = ctx.rulesetByProduct && (ctx.rulesetByProduct[det.product || ""] || ctx.rulesetByProduct[""]);
    const active = meta ? meta.doc : ruleset;
    const facts = { ...(loan.std || {}) };
    if (facts.is_defaulted === 'yes' && facts.provision_ratio == null && num(facts.balance) > 0) {
      facts.provision_ratio = round4(num(facts.impairment) / num(facts.balance));
    }
    facts.instrument_type = facts.instrument_type || 'claim';
    const prs = ctx.productRuleset;
    if (det.product && prs && prs.fieldBindings) {
      Object.entries(prs.fieldBindings).forEach(([ruleField, b]) => {
        if (!b || !b.confirmed || !b.from) return;
        if (facts[ruleField] == null && facts[b.from] != null) {
          facts[ruleField] = facts[b.from];
        }
      });
    }
    delete facts._rating_choices;
    cls = E.classify(active, facts);
    stage2.trace = cls.trace;
    stage2.result = cls.result;
    stage2.facts = facts;
    if (!cls.classified) {
      stage2.status = 'exception';
      stage2.error = cls.errors.join('；') || '未命中任何暴露分类规则。';
    } else if (cls.result.riskWeight == null) {
      stage2.status = 'exception';
      stage2.error = `命中「${cls.result.ruleLabel}」但未能确定风险权重。`;
    }
    stage2.log = cls.warnings || [];

    const stage3 = { name: 'EAD 计算', status: 'ok', log: [] };
    let ead = null;
    if (det.product) {
      ead = computeEad(loan, det.product, eadConfig);
      stage3.result = ead;
      if (ead.skipped) {
        stage3.status = 'skipped';
        stage3.error = ead.skipReason;
      } else if (ead.error || ead.ead == null || Number.isNaN(ead.ead)) {
        stage3.status = 'exception';
        stage3.error = ead.error || 'EAD 计算失败，关键金额字段缺失。';
      }
    } else {
      stage3.status = 'skipped';
    }

    const stage4 = { name: '风险权重与 RWA', status: 'ok', log: [] };
    let rwa = { rwa: null, steps: [] };
    const weight = cls && cls.result ? cls.result.riskWeight : null;
    if (ead && ead.skipped) {
      stage4.status = 'skipped';
      stage4.error = ead.skipReason;
    } else if (ead && ead.ead != null && weight != null) {
      rwa = computeRwa(ead.ead, weight);
      stage4.result = { ...rwa, riskWeight: weight, weightTrace: cls.result.weightTrace, weightKind: cls.result.weightKind };
    } else {
      stage4.status = 'exception';
      stage4.error = '缺少 EAD 或风险权重，无法计算 RWA。';
    }

    const exceptions = [];
    if (loan.anomaly) exceptions.push({ level: 'warn', text: loan.anomalyDetail || loan.anomaly });
    if (stage1.status === 'exception') exceptions.push({ level: 'error', text: stage1.error });
    if (stage2.status === 'exception') exceptions.push({ level: 'error', text: stage2.error });
    if (stage3.status === 'exception') exceptions.push({ level: 'error', text: stage3.error });
    if (stage4.status === 'exception') exceptions.push({ level: 'error', text: stage4.error });
    if (cls && cls.warnings) cls.warnings.forEach((w) => exceptions.push({ level: 'info', text: w }));

    const status = exceptions.some((e) => e.level === 'error') ? 'exception'
      : exceptions.length ? 'warning' : 'ok';

    return {
      loanId: loan.id, customer: loan.customer, name: loan.name,
      product: det.product, productBasis: det.basis, confidence: det.confidence,
      raw: loan.raw, std: loan.std,
      stages: { product: stage1, classify: stage2, ead: stage3, rwa: stage4 },
      rulesetLabel: meta ? (meta.label || meta.title || "") : "",
      exposureClass: cls && cls.result ? (cls.result.topRuleLabel || cls.result.ruleLabel) : null,
      exposureSubClass: cls && cls.result ? cls.result.subClass : null,
      matchedRule: cls && cls.result ? cls.result.ruleName : null,
      matchedPath: cls && cls.result ? cls.result.path : null,
      riskWeight: weight, weightTrace: cls && cls.result ? cls.result.weightTrace : [],
      ead: ead ? ead.ead : null, onEad: ead ? ead.onEad : null, offEad: ead ? ead.offEad : null,
      rwa: rwa.rwa,
      reference: cls && cls.result ? cls.result.reference : null,
      status, exceptions,
    };
  }

  /** 批量计量一个批次 */
  function measureBatch(loans, ctx) {
    const results = loans.map((l) => measure(l, ctx));
    const summary = {
      total: results.length,
      ok: results.filter((r) => r.status === 'ok').length,
      warning: results.filter((r) => r.status === 'warning').length,
      exception: results.filter((r) => r.status === 'exception').length,
      onEad: round2(results.reduce((s, r) => s + (r.onEad || 0), 0)),
      offEad: round2(results.reduce((s, r) => s + (r.offEad || 0), 0)),
      ead: round2(results.reduce((s, r) => s + (r.ead || 0), 0)),
      rwa: round2(results.reduce((s, r) => s + (r.rwa || 0), 0)),
    };
    summary.rwaRate = summary.ead ? round4(summary.rwa / summary.ead) : 0;

    // 按暴露大类汇总
    const byClass = {};
    results.forEach((r) => {
      const k = r.exposureClass || '未分类';
      byClass[k] = byClass[k] || { count: 0, ead: 0, rwa: 0 };
      byClass[k].count++;
      byClass[k].ead += r.ead || 0;
      byClass[k].rwa += r.rwa || 0;
    });
    Object.values(byClass).forEach((v) => { v.ead = round2(v.ead); v.rwa = round2(v.rwa); });

    // 按产品汇总
    const byProduct = {};
    results.forEach((r) => {
      const k = r.product || '未识别';
      byProduct[k] = byProduct[k] || { count: 0, ead: 0, rwa: 0 };
      byProduct[k].count++;
      byProduct[k].ead += r.ead || 0;
      byProduct[k].rwa += r.rwa || 0;
    });
    Object.values(byProduct).forEach((v) => { v.ead = round2(v.ead); v.rwa = round2(v.rwa); });

    return { results, summary, byClass, byProduct };
  }

  /* ---------------- 工具 ---------------- */
  function num(v) { const n = Number(v); return Number.isNaN(n) ? 0 : n; }
  function round2(v) { return Math.round((v + Number.EPSILON) * 100) / 100; }
  function round4(v) { return Math.round((v + Number.EPSILON) * 10000) / 10000; }
  function fmt(v) {
    if (v == null || Number.isNaN(v)) return '—';
    return Number(v).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function pct(v) {
    if (v == null) return '—';
    return `${+(v * 100).toFixed(4)}%`;
  }

  const Pipeline = {
    detectProduct, computeEad, computeRwa, measure, measureBatch,
    productMeta, num, round2, round4, fmt, pct,
  };

  if (typeof window !== 'undefined') window.Pipeline = Pipeline;
  if (typeof module !== 'undefined' && module.exports) module.exports = Pipeline;
})(typeof window !== 'undefined' ? window : globalThis);
