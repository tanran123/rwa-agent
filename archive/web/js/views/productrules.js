/**
 * 产品专属规则集（Product Rule Set）
 * ------------------------------------------------------------------
 * 设计依据：
 *   通用暴露分类规则提供分类框架（大类/子类、判定结构），
 *   产品专属规则在该框架之下，用「产品的标准字段」去喂「通用规则的字段」，
 *   从而为每个产品产出可执行的一套规则。
 *
 * 数据模型：
 *   {
 *     id, productCode, productLabel, version, status,
 *     basedOn: 规则集 id,               // 挂在哪个通用规则集之下
 *     fieldBindings: {                   // 产品标准字段 → 通用规则字段 的映射
 *        counterparty_type: { from: 'cpt', fromLabel: '交易对手类型',
 *                             transform: '枚举映射', confirmed: true, suggested: true }
 *     },
 *     overrides: { <ruleName>: { enabled, weight } },   // 对通用规则的调整
 *     attachments: [ <ruleName> ],       // 该产品额外启用的通用分支
 *     createdAt, createdBy
 *   }
 */
(function (global) {
  const { h, tag, notice, toast, openDrawer, openModal, confirmDialog, kv, pct2 } = UI;

  /* ============ 产品规则集存储 ============ */
  const productRuleSets = {};     // productCode -> ruleset

  function getProductRuleSet(productCode) {
    return productRuleSets[productCode] || null;
  }
  function saveProductRuleSet(rs) {
    rs.updatedAt = new Date().toISOString().replace('T', ' ').slice(0, 19);
    productRuleSets[rs.productCode] = rs;
    return rs;
  }
  function removeProductRuleSet(productCode) {
    delete productRuleSets[productCode];
  }
  function allProductRuleSets() {
    return Object.values(productRuleSets);
  }

  /* ============ 智能体：字段绑定建议 ============ */
  /**
   * 通用规则用到哪些字段？产品有哪些标准字段？给出绑定建议。
   * @param ruleset      通用规则集
   * @param productCode  产品类型
   */
  function suggestBindings(ruleset, productCode) {
    const stdFields = MASTER.PRODUCT_FIELDS[productCode] || [];
    // 通用规则实际引用的字段（顶层 + 节点级）
    const used = Store.collectFields(ruleset);
    const out = [];

    Object.entries(used).forEach(([name, def]) => {
      // 1) 产品有同名规则字段 → 直接绑定
      const exact = stdFields.find((f) => f.stdField === name);
      if (exact) {
        out.push({
          ruleField: name, ruleLabel: def.label || name,
          from: exact.code, fromLabel: exact.name,
          transform: exact.transform,
          confidence: 0.96, suggested: true, confirmed: true,
          reason: `产品的标准字段「${exact.name}」直接对应规则字段 ${name}`,
          type: def.type,
        });
        return;
      }
      // 2) 名称近似
      const near = stdFields.find((f) => f.name && (f.name.includes(def.label || '')
        || (def.label || '').includes(f.name)));
      if (near) {
        out.push({
          ruleField: name, ruleLabel: def.label || name,
          from: near.code, fromLabel: near.name,
          transform: near.transform,
          confidence: 0.72, suggested: true, confirmed: false,
          reason: `产品的「${near.name}」与规则字段「${def.label || name}」名称近似，需人工确认`,
          type: def.type,
        });
        return;
      }
      // 3) 绑不上
      out.push({
        ruleField: name, ruleLabel: def.label || name,
        from: null, fromLabel: null, transform: '—',
        confidence: 0, suggested: false, confirmed: false,
        reason: `产品「${MASTER.PRODUCT_TYPES.find((p) => p.code === productCode)?.label || productCode}」没有可用于该规则字段的标准字段。` +
          `引用它的条件在本产品下将永不命中。`,
        type: def.type,
        missing: true,
      });
    });

    return out;
  }

  /* ============ 智能体：通用规则适用性建议 ============ */
  /** 哪些通用规则对这个产品是适用的（基于产品标准字段能否支撑判断） */
  function suggestApplicable(ruleset, bindings) {
    const bound = new Set(bindings.filter((b) => b.from).map((b) => b.ruleField));
    const out = [];

    const walk = (nodes, depth, parentLabel) => {
      (nodes || []).forEach((n) => {
        const fieldsUsed = [];
        const collect = (w) => {
          if (!w) return;
          const k = 'all' in w ? 'all' : 'any';
          (w[k] || []).forEach((c) => {
            if (c.all || c.any) collect(c);
            else if (c.field) fieldsUsed.push(c.field);
          });
        };
        collect(n.when);

        const allBound = fieldsUsed.length === 0 || fieldsUsed.every((f) => bound.has(f));
        const missing = fieldsUsed.filter((f) => !bound.has(f));
        out.push({
          name: n.name, label: n.label, depth, parentLabel,
          fieldsUsed,
          applicable: allBound,
          missingFields: missing,
          recommended: allBound && !(n.children && n.children.length),
          reason: allBound
            ? '所需字段在本产品下均可绑定'
            : `缺少字段绑定：${missing.join('、')}，引用它的条件不会命中`,
        });
        walk(n.children, depth + 1, n.label);
      });
    };
    walk(ruleset.rules, 0, null);
    return out;
  }

  /* ============ 把产品规则集应用到事实数据 ============ */
  /**
   * 计量时：把原始 facts 按字段绑定翻译成规则字段。
   * 只在产品规则集存在且启用时生效。
   */
  function applyBindings(facts, prs) {
    if (!prs || !prs.fieldBindings) return facts;
    const out = { ...facts };
    Object.entries(prs.fieldBindings).forEach(([ruleField, b]) => {
      if (!b || !b.from || !b.confirmed) return;
      // facts 里已经是规则字段名了（来自产品标准字段映射），这里主要做缺省补齐
      if (out[ruleField] == null) {
        // 尝试按产品字段编码取
        if (facts[b.from] != null) out[ruleField] = facts[b.from];
      }
    });
    return out;
  }

  global.ProductRules = {
    getProductRuleSet, saveProductRuleSet, removeProductRuleSet, allProductRuleSets,
    suggestBindings, suggestApplicable, applyBindings,
  };
})(window);
