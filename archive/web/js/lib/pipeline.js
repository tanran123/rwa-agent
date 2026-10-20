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
  const E = isNode ? require('./engine.js') : global.ExposeEngine;

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
  function productMeta(code) {
    const list = (typeof MASTER !== 'undefined' && MASTER.PRODUCT_TYPES) || [];
    return list.find((p) => p.code === code) || null;
  }

  /** 规则是否适用于该产品。有 productCodes 时以代码为准，否则退回中文产品名。 */
  function ruleAppliesToProduct(rule, productCode) {
    if (!rule || !productCode) return false;
    if (Array.isArray(rule.productCodes) && rule.productCodes.length) {
      return rule.productCodes.includes(productCode);
    }
    const meta = productMeta(productCode);
    return !!(meta && Array.isArray(rule.products) && rule.products.includes(meta.label));
  }

  function eadMiss(kind, message) {
    return {
      kind, ruleId: null, ruleName: '未匹配到该产品的 EAD 规则',
      onEad: null, offEad: null, ead: null, steps: [], formula: '—',
      clause: null, params: [], error: message,
    };
  }

  function computeEad(loan, product, eadOnRules, eadOffRules) {
    const std = loan.std || {};
    const isOff = std.offbalance === 'yes';
    const kind = isOff ? 'off' : 'on';
    const meta = productMeta(product);
    const label = meta ? meta.label : (product || '');

    if (!product) {
      return eadMiss(kind, '计算 EAD 前必须先确定产品类型。未选择产品时，不套用其他产品的规则。');
    }

    const pool = (isOff ? eadOffRules : eadOnRules) || [];
    const published = pool.filter((r) => r.status === 'published' && ruleAppliesToProduct(r, product));
    if (!published.length) {
      return eadMiss(kind, `产品「${label}」没有已发布的${isOff ? '表外' : '表内'} EAD 规则，无法计算。`);
    }

    const steps = [];
    let rule = null;

    if (isOff) {
      const ccf = std.ccf;
      rule = published.find((r) => r.ccf != null && Math.abs(r.ccf - ccf) < 1e-9) || published[0];
      const offAmt = num(std.offbalance_amount);
      const onAmt = num(std.onbalance_amount);
      const useCcf = rule.ccf != null ? rule.ccf : ccf;
      const converted = round2(offAmt * useCcf);
      const includeDrawn = /已提用/.test(rule.formula || '') || (rule.inputs || []).some((s) => /onbalance|已提用/.test(s));
      const ead = includeDrawn ? round2(onAmt + converted) : converted;

      steps.push({ n: 1, label: '适用产品', expr: 'product', value: label, note: `只在「${label}」的表外 EAD 规则中匹配，不使用其他产品的公式。` });
      steps.push({ n: 2, label: '命中规则', expr: rule.id, value: rule.name, note: rule.condition || '' });
      if (includeDrawn) {
        steps.push({ n: 3, label: '表内已提用金额', expr: 'onbalance_amount', value: onAmt, note: '已提用并计入表内的部分，全额计入 EAD。' });
      }
      steps.push({ n: steps.length + 1, label: '表外未提用金额', expr: 'offbalance_amount', value: offAmt, note: '授信额度中尚未提用的部分。' });
      steps.push({ n: steps.length + 1, label: '信用转换系数 CCF', expr: 'ccf', value: useCcf, note: `按「${rule.name}」的档位取 ${(useCcf * 100).toFixed(0)}%。` });
      steps.push({ n: steps.length + 1, label: '折算后表外等值金额', expr: `${fmt(offAmt)} × ${useCcf}`, value: converted, note: '未提用金额 × 信用转换系数。' });
      steps.push({ n: steps.length + 1, label: '表外 EAD', expr: includeDrawn ? `${fmt(onAmt)} + ${fmt(converted)}` : fmt(converted), value: ead, note: includeDrawn ? '表内已提用部分 + 折算后的表外等值金额。' : '本规则不叠加已提用金额，只取表外余额乘以 CCF。' });

      return { kind: 'off', product, productLabel: label, ruleId: rule.id, ruleName: rule.name,
        ccf: useCcf, onEad: 0, offEad: ead, ead, steps, formula: rule.formula,
        clause: rule.clause || null, params: rule.params || [] };
    }

    rule = published[0];
    const bal = num(std.balance);
    const imp = num(std.impairment);
    const deduct = /减值/.test(rule.formula || '') || (rule.inputs || []).some((s) => /impairment|减值/.test(s));
    const ead = deduct ? round2(bal - imp) : round2(bal);
    steps.push({ n: 1, label: '适用产品', expr: 'product', value: label, note: `只使用「${label}」已发布的表内 EAD 规则「${rule.name}」。` });
    steps.push({ n: 2, label: '账面本金余额', expr: 'balance', value: bal, note: '该笔债项的账面本金余额，不含利息。' });
    if (deduct) {
      steps.push({ n: 3, label: '已计提减值准备', expr: 'impairment', value: imp, note: '表内债权类 EAD 需从账面余额中扣减。' });
      steps.push({ n: 4, label: '表内 EAD', expr: `${fmt(bal)} − ${fmt(imp)}`, value: ead, note: '账面余额扣除已计提的损失准备。' });
    } else {
      steps.push({ n: 3, label: '表内 EAD', expr: fmt(bal), value: ead, note: '本产品规则按账面价值计量，不扣减减值准备。' });
    }

    return { kind: 'on', product, productLabel: label, ruleId: rule.id, ruleName: rule.name,
      onEad: ead, offEad: 0, ead, steps, formula: rule.formula,
      clause: rule.clause || null, params: rule.params || [] };
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
    const { ruleset, eadOnRules, eadOffRules, detectRules, productOverride } = ctx;

    const stage1 = { name: '产品类型识别', status: 'ok', log: [] };
    const det = productOverride
      ? { product: productOverride, basis: '用户在向导中人工确认/调整的产品类型。', confidence: 'manual' }
      : detectProduct(loan, detectRules);
    stage1.product = det.product;
    stage1.basis = det.basis;
    stage1.confidence = det.confidence;
    if (!det.product) { stage1.status = 'exception'; stage1.error = det.basis; }

    const stage2 = { name: '信用风险暴露分类', status: 'ok', log: [] };
    let cls = null;
    if (det.product) {
      const facts = { ...loan.std };
      // 补齐跨产品通用推导字段
      if (facts.is_defaulted === 'yes' && facts.provision_ratio == null && num(facts.balance) > 0) {
        facts.provision_ratio = round4(num(facts.impairment) / num(facts.balance));
      }
      facts.instrument_type = facts.instrument_type || 'claim';

      // 若该产品已建立专属规则集，按其字段绑定把产品数据喂进通用规则的字段。
      // 产品专属规则建立在通用规则之上：绑定只负责字段对接，不新增分类逻辑。
      const prs = ctx.productRuleset;
      if (prs && prs.fieldBindings) {
        Object.entries(prs.fieldBindings).forEach(([ruleField, b]) => {
          if (!b || !b.confirmed || !b.from) return;
          if (facts[ruleField] == null && facts[b.from] != null) {
            facts[ruleField] = facts[b.from];
          }
        });
      }

      cls = E.classify(ruleset, facts);
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
    } else {
      stage2.status = 'skipped';
      stage2.error = '产品类型未识别，无法执行分类。';
    }

    const stage3 = { name: 'EAD 计算', status: 'ok', log: [] };
    let ead = null;
    if (det.product) {
      ead = computeEad(loan, det.product, eadOnRules, eadOffRules);
      stage3.result = ead;
      if (ead.error || ead.ead == null || Number.isNaN(ead.ead)) {
        stage3.status = 'exception';
        stage3.error = ead.error || 'EAD 计算失败，关键金额字段缺失。';
      }
    } else {
      stage3.status = 'skipped';
    }

    const stage4 = { name: '风险权重与 RWA', status: 'ok', log: [] };
    let rwa = { rwa: null, steps: [] };
    const weight = cls && cls.result ? cls.result.riskWeight : null;
    if (ead && ead.ead != null && weight != null) {
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
    ruleAppliesToProduct, productMeta,
    num, round2, round4, fmt, pct,
  };

  if (typeof window !== 'undefined') window.Pipeline = Pipeline;
  if (typeof module !== 'undefined' && module.exports) module.exports = Pipeline;
})(typeof window !== 'undefined' ? window : globalThis);
