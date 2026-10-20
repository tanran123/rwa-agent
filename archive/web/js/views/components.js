/**
 * 共享视图组件：暴露分类决策树、规则详情、监管条款、执行轨迹、Markdown 记录。
 * 决策树完全由真实规则数据动态生成，不使用固定图片。
 */
(function (global) {
  const { h, tag, statusTag, label, codeLabel, pct2, fmtNum, condRow, openDrawer, toast, simBadge } = UI;

  /* ================= 决策树 ================= */
  /**
   * @param ruleset      规则集 resolves_to
   * @param opts.facts   若提供，则高亮该笔债项的实际命中路径
   * @param opts.trace   规则执行 trace，用于标注命中/未命中/跳过
   * @param opts.onSelect 点击节点回调
   */
  function DecisionTree(ruleset, opts = {}) {
    const hitPaths = new Set();
    const statusByPath = {};
    if (opts.trace) {
      const walkT = (nodes, base) => {
        (nodes || []).forEach((t) => {
          statusByPath[t.path] = t.status;
          if (t.status === 'matched') hitPaths.add(t.path);
          if (t.children) walkT(t.children, t.path);
          if (t.fallbackUsed && t.fallbackUsed.result) {
            hitPaths.add(t.fallbackUsed.result.path);
          }
        });
      };
      walkT(opts.trace, '');
      // matchedPath 一定是最终命中
      if (opts.result && opts.result.path) hitPaths.add(opts.result.path);
    }

    const collapsed = new Set();
    const root = h('div', { class: 'tree-h' });

    function renderNodes(nodes, parentPath, depth) {
      const box = h('div', { class: 'tchildren', style: depth === 0 ? { marginLeft: '0', paddingLeft: '0', border: 'none' } : {} });
      (nodes || []).forEach((n, i) => {
        const path = `${parentPath}/${i}:${n.name}`;
        const wrap = h('div', { class: 'tnode-wrap' });

        const hasC = n.children && n.children.length;
        const fb = window.ExposeEngine && ExposeEngine.fallbackNode(n);
        const hasFb = !!fb;
        const isHit = hitPaths.has(path);
        const st = statusByPath[path];
        const classes = ['tnode'];
        if (hasC || hasFb) classes.push('branch'); else if (n.otherwise) classes.push('fallback'); else classes.push('leaf');
        if (isHit) classes.push('hit');
        if (st === 'not-matched') classes.push('miss');
        if (st === 'skipped') classes.push('skipped');
        if (st === 'branch-exhausted') classes.push('exhausted');

        let wtext = (window.ExposeEngine && ExposeEngine.ruleBadge(n)) || '';
        let wcls = '';
        if (!wtext && hasC) wtext = `${n.children.length} 个子类`;
        else if (!wtext && hasFb) wtext = '兜底';
        else if (!wtext) { wtext = '权重未单列'; wcls = 'empty'; }

        const idx = h('span', { class: 'tidx' }, `#${depth}.${i + 1}`);

        // 折叠按钮
        const toggle = (hasC || hasFb)
          ? h('span', {
              class: 'toggle-c',
              onclick: (e) => {
                e.stopPropagation();
                if (collapsed.has(path)) collapsed.delete(path); else collapsed.add(path);
                renderAll();
              },
            }, collapsed.has(path) ? '▶' : '▼')
          : null;

        const icon = isHit ? '●' : (st === 'skipped' ? '⊘' : (hasC || hasFb ? '◆' : '○'));

        const el = h('div', {
          class: classes.join(' '),
          title: '点击查看规则详情与监管依据',
          onclick: () => { if (opts.onSelect) opts.onSelect(n, { path, depth, index: i }); else showRuleDetail(n, { path }, ruleset); },
        },
          toggle,
          idx,
          h('span', { class: 'ticon', style: { color: isHit ? 'var(--ok)' : 'var(--ink-3)' } }, icon),
          h('div', { style: { minWidth: '0' } },
            h('div', { class: 'tlabel' }, n.label),
            h('div', { class: 'tmeta' }, n.name + (st === 'skipped' ? ' · 本产品不适用，整段跳过' : ''))),
          h('span', { class: `tweight ${wcls}` }, wtext));

        wrap.appendChild(el);

        if ((hasC || hasFb) && !collapsed.has(path)) {
          const kidsBox = h('div', { class: 'tchildren' });
          if (hasC) kidsBox.appendChild(renderNodes(n.children, path, depth + 1));
          if (hasFb) {
            kidsBox.appendChild(renderFallback(fb, `${path}>otherwise`, depth + 1));
          }
          wrap.appendChild(kidsBox);
        }
        box.appendChild(wrap);
      });
      return box;
    }

    function renderFallback(fb, path, depth) {
      const fbHit = hitPaths.has(path);
      const badge = (window.ExposeEngine && ExposeEngine.ruleBadge(fb)) || (fb.children && fb.children.length ? `${fb.children.length} 个子类` : '权重未单列');
      const box = h('div', { class: 'tnode-wrap' });
      box.appendChild(h('div', { class: `tnode fallback${fbHit ? ' hit' : ''}`,
        onclick: () => (opts.onSelect ? opts.onSelect(fb, { path, depth, index: -1, isFallback: true }) : showRuleDetail(fb, { path }, ruleset)) },
        h('span', { class: 'tidx' }, '否则'),
        h('span', { class: 'ticon', style: { color: 'var(--warn)' } }, '↳'),
        h('div', { style: { minWidth: '0' } },
          h('div', { class: 'tlabel' }, fb.label),
          h('div', { class: 'tmeta' }, fb.name + ' · 本层都不命中时走这里')),
        h('span', { class: `tweight ${badge === '权重未单列' ? 'empty' : ''}` }, badge)));
      if (fb.children && fb.children.length) box.appendChild(renderNodes(fb.children, path, depth + 1));
      const nested = window.ExposeEngine && ExposeEngine.fallbackNode(fb);
      if (nested) box.appendChild(renderFallback(nested, path + '>otherwise', depth + 1));
      return box;
    }

    function renderAll() {
      root.innerHTML = '';
      root.appendChild(renderNodes(ruleset.rules, '', 0));
      const top = window.ExposeEngine && ExposeEngine.fallbackNode(ruleset);
      if (top) root.appendChild(renderFallback(top, '>otherwise', 0));
      // 扩展
      if (ruleset.extensions && ruleset.extensions.length) {
        const extBox = h('div', { style: { marginTop: '16px' } });
        extBox.appendChild(h('div', { class: 'cond-group-label', style: { marginBottom: '7px' } },
          '银行自定义扩展（挂在已命中的规则之下，不插进 rules 中间）'));
        ruleset.extensions.forEach((e, i) => {
          const target = (ruleset.rules || []).length && findNodeByName(ruleset.rules, e.attach_to);
          extBox.appendChild(h('div', { class: 'notice info', style: { marginBottom: '8px' } },
            h('span', { class: 'ni' }, '⤷'),
            h('div', {}, `attach_to = `, h('code', { class: 'mono' }, e.attach_to),
              target ? `（${target.label}）` : '（未找到对应规则）',
              e.label ? h('div', { class: 'dim', style: { fontSize: '11px' } }, e.label) : null)));
          extBox.appendChild(renderNodes(e.children || [], `ext${i}`, 1));
        });
        root.appendChild(extBox);
      }
    }
    renderAll();

    return { el: root, rerender: renderAll };
  }

  function findNodeByName(nodes, name) {
    for (const n of nodes || []) {
      if (n.name === name) return n;
      const r = findNodeByName(n.children, name);
      if (r) return r;
    }
    return null;
  }

  /* ================= 规则详情抽屉 ================= */
  function showRuleDetail(node, meta, ruleset) {
    const clauses = clauseNodesFor(node);
    const body = h('div', {});

    body.appendChild(h('div', { class: 'notice info' },
      h('span', { class: 'ni' }, 'ℹ'),
      h('div', {}, '规则路径 ', h('code', { class: 'mono' }, meta.path || node.name),
        ' · 本节点是一条结构化规则对象，既用于决策树展示，也用于实际执行与审计追溯。')));
    if (node.example) body.appendChild(h('div', { class: 'notice warn' }, h('span', { class: 'ni' }, '!'),
      h('div', {}, '本节点标记为 example: true，属于随规则集附带的示例，可删除。')));

    // 基本信息
    body.appendChild(h('div', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h3', {}, '规则基本信息')), h('div', { class: 'panel-body' },
      UI.kv([
        ['规则 name', { mono: true, node: h('span', {}, node.name) }],
        ['显示名称', node.label],
        ['规则编号', { mono: true, node: h('span', {}, node.rule_id || node.ruleId || '—') }],
        ['本层顺序', `${(meta.index || 0) + 1}${meta.index < 0 ? '（兜底）' : ''}`],
        ['节点类型', hasChildren(node) ? '分流节点（需继续下钻）' : (node.otherwise ? '兜底节点' : '产出节点')],
        ['风险权重', node.value != null ? pct2(node.value)
          : node.weight ? (node.weight.same_as ? `按交易对手（same_as: ${node.weight.same_as}）`
            : `取大者 greater_of: ${node.weight.greater_of.map((x) => typeof x === 'number' ? pct2(x) : '按交易对手').join(' / ')}`)
          : (hasChildren(node) ? '权重写在子档上' : '—')],
        ['是否兜底', node.otherwise ? '是，本层都不命中时走这里' : '否'],
      ]))));

    // 判断条件
    const condBox = h('div', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h3', {}, '判断条件')));
    const cb = h('div', { class: 'panel-body' });
    if (node.skip) {
      cb.appendChild(h('div', { class: 'cond-group-label' }, 'skip — 本产品不适用这条时整段跳过'));
      cb.appendChild(h('div', { class: 'cond-list' }, condRow(node.skip, null)));
      cb.appendChild(h('div', { class: 'hint', style: { margin: '6px 0 10px', fontSize: '11px', color: 'var(--ink-3)' } },
        'skip 成立就当没有这条，子级也不进；被跳过的那条 when 本来会命中时，不再走同一层的 otherwise，退回外层继续下一条。'));
    }
    if (node.when) {
      const k = 'all' in node.when ? 'all' : 'any';
      cb.appendChild(h('div', { class: 'cond-group-label' },
        k === 'all' ? 'when.all — 以下每一条都要成立' : 'when.any — 以下成立一条即可'));
      cb.appendChild(h('div', { class: 'cond-list' }, renderWhenTree(node.when, null)));
    }
    condBox.appendChild(cb);
    body.appendChild(condBox);

    // 本节点声明的字段
    if (node.fields && node.fields.length) {
      const fb = h('div', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h3', {}, `本节点声明的字段（${node.fields.length}）`),
        h('span', { class: 'sub' }, '只给这一条和它下面的子类使用')), h('div', { class: 'panel-body' }));
      node.fields.forEach((f) => fb.querySelector('.panel-body').appendChild(fieldBlock(f)));
      body.appendChild(fb);
    }

    // 备注
    if (node.note) {
      body.appendChild(h('div', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h3', {}, '权重依据 / 备注')),
        h('div', { class: 'panel-body' }, h('div', { style: { lineHeight: '1.75', fontSize: '12.5px' } }, node.note))));
    }

    // 监管条款
    if (clauses.length) {
      const cl = h('div', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h3', {}, '关联监管条款（模拟）'),
        h('span', { class: 'sub' }, '计量时记录实际命中规则对应的条款，形成追溯链路')), h('div', { class: 'panel-body' }));
      clauses.forEach((c) => cl.querySelector('.panel-body').appendChild(clauseCard(c)));
      body.appendChild(cl);
    }

    // 子规则
    if (hasChildren(node)) {
      body.appendChild(h('div', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h3', {}, `子规则（${node.children.length}）`)),
        h('div', { class: 'panel-body tight' },
          h('table', { class: 'tbl compact' },
            h('thead', {}, h('tr', {}, ['顺序', 'name', '名称', '权重', '条件摘要'].map((t) => h('th', {}, t)))),
            h('tbody', {}, node.children.map((c, i) => h('tr', {
              class: 'clickable',
              onclick: () => showRuleDetail(c, { path: `${meta.path}/${i}:${c.name}`, depth: (meta.depth || 0) + 1, index: i }, ruleset),
            },
              h('td', {}, String(i + 1)),
              h('td', { class: 'mono' }, c.name),
              h('td', {}, c.label),
              h('td', {}, c.value != null ? pct2(c.value) : (c.weight ? (c.weight.same_as ? '按交易对手' : '取大者') : (c.children ? `${c.children.length} 子类` : '—'))),
              h('td', { class: 'dim' }, summarizeWhen(c.when)))))))));
    }

    // 原始 JSON
    body.appendChild(h('details', { class: 'panel', style: { marginBottom: '0' } },
      h('summary', { class: 'panel-head', style: { cursor: 'pointer' } }, h('h3', {}, '查看结构化规则对象（JSON）')),
      h('div', { class: 'panel-body' }, h('div', { class: 'codeblock' }, JSON.stringify(node, null, 2)))));

    openDrawer({
      title: `规则详情 · ${node.label}`,
      wide: true,
      body,
      footer: [
        h('button', { class: 'btn', onclick: () => UI.copyText(JSON.stringify(node, null, 2), '规则 JSON 已复制') }, '复制 JSON'),
      ],
    });
  }

  function hasChildren(n) { return !!(n.children && n.children.length); }

  function summarizeWhen(when) {
    if (!when) return '—';
    const k = 'all' in when ? 'all' : 'any';
    const parts = (when[k] || []).map((c) => {
      if (c.all || c.any) return `(${summarizeWhen(c)})`;
      const v = Array.isArray(c.match) ? c.match.map(codeLabel).join('|') : codeLabel(c.match);
      return `${label(c.field)} ${UI.OP_LABELS[c.op] || c.op} ${v}`;
    });
    return parts.join(k === 'all' ? ' 且 ' : ' 或 ');
  }

  /** 递归渲染 when 结构 */
  function renderWhenTree(when, trace) {
    const k = 'all' in when ? 'all' : 'any';
    const items = when[k] || [];
    const traces = trace ? trace.items : null;
    const box = h('div', { class: 'cond-list' });
    if (k === 'any') box.appendChild(h('div', { class: 'cond-group-label' }, 'any — 以下成立一条即可'));
    items.forEach((c, i) => {
      const t = traces ? traces[i] : null;
      if (c.all || c.any) {
        box.appendChild(h('div', { class: 'cond-group-label' }, c.all ? 'all 嵌套组' : 'any 嵌套组'));
        box.appendChild(renderWhenTree(c, t && t.nested ? t : null));
      } else {
        box.appendChild(condRow(c, t));
      }
    });
    return box;
  }

  const fieldBlock = (f) => h('div', { class: 'fblock' },
    h('div', { class: 'fh' },
      h('span', { class: 'fname' }, f.label || f.name),
      h('span', { class: 'fcode' }, f.name),
      f.source ? h('span', { class: `tag ${f.source === 'manual' ? 'warn' : f.source === 'calc' ? 'info' : 'muted'}` },
        f.source === 'manual' ? '人工填写' : f.source === 'calc' ? '计算得出' : '表中有列') : null,
      f.type ? h('span', { class: 'tag outline' }, f.type) : null),
    f.meaning ? h('div', { class: 'fmean' }, f.meaning) : null,
    f.options && f.options.length ? h('div', { class: 'fopts' },
      f.options.map((o) => h('span', { class: 'tag' }, `${o.label} = ${o.code}`))) : null);

  function clauseNodesFor(node) {
    const out = [];
    (MASTER.CLAUSES || []).forEach((c) => {
      if ((c.referencedBy || []).includes(node.name)) out.push(c);
    });
    return out;
  }

  const clauseCard = (c) => h('div', { class: 'clause' },
    h('div', { class: 'ct' }, h('span', {}, c.clause), h('span', {}, c.title),
      h('span', { class: 'sim-badge' }, '模拟条款')),
    h('div', { class: 'ctext' }, c.text),
    h('div', { class: 'cmeta' },
      h('span', {}, `制度：${c.doc}（${c.docVersion}）`),
      h('span', {}, `适用：${c.scope}`),
      h('span', {}, `生效：${c.effectiveFrom}`),
      h('span', {}, `来源：${c.source}`)));

  /* ================= 执行轨迹 ================= */
  /** 把 engine trace 渲染成逐步执行过程 */
  function ExecutionTrace(classifyStage, opts = {}) {
    const box = h('div', {});
    const trace = classifyStage.trace || [];
    const result = classifyStage.result;

    if (!trace.length) {
      box.appendChild(h('div', { class: 'empty' }, '无执行轨迹。'));
      return box;
    }

    // 逐层展开
    function renderLayer(nodes, depth, parentLabel) {
      const wrap = h('div', { style: { marginBottom: '9px' } });
      wrap.appendChild(h('div', { class: 'cond-group-label' },
        depth === 0 ? '第 1 层 · 顶层路由（自上而下，第一条命中就停）' : `第 ${depth + 1} 层 · 进入「${parentLabel}」的子规则`));

      (nodes || []).forEach((t) => {
        const cls = t.status === 'matched' ? 'pass'
          : t.status === 'skipped' ? 'skipped' : t.status === 'not-matched' ? 'fail' : 'miss';
        const bg = t.status === 'matched' ? 'var(--ok-soft)'
          : t.status === 'skipped' ? '#f6f7f9' : t.status === 'not-matched' ? '#fbfcfd' : 'var(--warn-soft)';

        const head = h('div', { class: 'step-line', style: { background: bg, borderRadius: '4px', padding: '7px 9px', marginBottom: '4px' } },
          h('span', { class: 'sl-n' }, t.index + 1),
          h('div', { class: 'sl-b' },
            h('div', {},
              h('span', { class: 'sl-l' }, t.label),
              h('span', { class: 'tidx', style: { marginLeft: '7px' } }, t.name),
              h('span', { style: { marginLeft: '7px' } },
                statusTag(t.status === 'matched' ? 'ok'
                  : t.status === 'skipped' ? 'muted'
                  : t.status === 'not-matched' ? 'muted' : 'warn')),
              t.skipped ? h('span', { class: 'tag warn', style: { marginLeft: '5px' } }, '整段跳过') : null),
            t.skipped ? h('div', { class: 'sl-note' }, t.skipReason) : null,
            t.exhaustReason ? h('div', { class: 'sl-note' }, t.exhaustReason) : null),
          t.outcome ? h('span', { class: 'sl-v', style: { color: 'var(--ok)' } },
            typeof t.outcome.riskWeight === 'number' ? pct2(t.outcome.riskWeight) : '按交易对手') : null);
        wrap.appendChild(head);

        // 条件逐条
        if (t.condition && t.condition.items && t.condition.items.length) {
          const cb = h('div', { class: 'cond-list', style: { margin: '5px 0 6px 26px' } });
          t.condition.items.forEach((it, i) => {
            if (it.nested) {
              cb.appendChild(h('div', { class: 'cond-group-label' }, `${it.kind === 'all' ? 'all' : 'any'} 嵌套组 → ${it.ok ? '成立' : '不成立'}`));
              (it.items || []).forEach((sub) => cb.appendChild(sub.nested ? h('div', { class: 'dim', style: { paddingLeft: '11px' } }, '（更深层嵌套）') : condRow(sub, sub)));
            } else {
              cb.appendChild(condRow(it, it));
            }
          });
          wrap.appendChild(cb);
        }

        // 命中的下一步下钻
        if (t.children && t.children.length) {
          wrap.appendChild(renderLayer(t.children, depth + 1, t.label));
        }
        if (t.fallbackUsed && t.fallbackUsed.result) {
          wrap.appendChild(h('div', { class: 'notice warn', style: { margin: '5px 0 0 26px' } },
            h('span', { class: 'ni' }, '↳'),
            h('div', {}, `子规则全部未命中，走本层兜底「${t.fallbackUsed.result.ruleLabel}」，权重 `,
              h('b', {}, typeof t.fallbackUsed.result.riskWeight === 'number' ? pct2(t.fallbackUsed.result.riskWeight) : '—'))));
        }
      });
      return wrap;
    }

    box.appendChild(renderLayer(trace, 0, null));

    // 最终结果
    if (result) {
      box.appendChild(h('div', { class: 'notice ok', style: { marginTop: '11px' } },
        h('span', { class: 'ni' }, '✓'),
        h('div', {},
          h('div', {}, `最终命中规则：`, h('b', {}, result.ruleLabel), ' ', h('code', { class: 'mono' }, result.ruleName)),
          h('div', { style: { marginTop: '3px' } }, `暴露大类 `, h('b', {}, result.topRuleLabel || result.ruleLabel),
            ` · 暴露子类 `, h('b', {}, result.subClass || '—'),
            ` · 风险权重 `, h('b', {}, typeof result.riskWeight === 'number' ? pct2(result.riskWeight) : '未确定')))));
    } else {
      box.appendChild(h('div', { class: 'notice danger', style: { marginTop: '11px' } },
        h('span', { class: 'ni' }, '✕'),
        h('div', {}, '走完整个规则集仍未命中任何分类，属于异常债项，应进入人工处理流程。')));
    }

    // 权重解析
    if (result && result.weightTrace && result.weightTrace.length) {
      const wt = h('div', { class: 'panel', style: { marginTop: '12px', marginBottom: '0' } },
        h('div', { class: 'panel-head' }, h('h3', {}, '风险权重的确定依据')));
      const wb = h('div', { class: 'panel-body' });
      result.weightTrace.forEach((t) => {
        if (t.kind === 'const') {
          wb.appendChild(h('div', { class: 'step-line' }, h('span', { class: 'sl-n' }, '='),
            h('div', { class: 'sl-b' }, h('div', { class: 'sl-l' }, '规则直接给定的常量权重'),
              h('div', { class: 'sl-note' }, t.note))));
        } else if (t.kind === 'same_as') {
          wb.appendChild(h('div', { class: 'step-line' }, h('span', { class: 'sl-n' }, '↺'),
            h('div', { class: 'sl-b' },
              h('div', { class: 'sl-l' }, `向交易对手取权重 same_as: `, h('code', { class: 'mono' }, t.same_as || 'counterparty_ordinary_claim')),
              h('div', { class: 'sl-note' }, t.note),
              t.subPath ? h('div', { class: 'sl-note' }, `重新分类命中：`, h('code', { class: 'mono' }, t.subPath)) : null,
              h('div', {}, `得到权重 `, h('b', {}, typeof t.resolved === 'number' ? pct2(t.resolved) : '未能解析')))));
        } else if (t.kind === 'greater_of') {
          const cands = h('div', { class: 'cond-list', style: { marginTop: '5px' } });
          (t.candidates || []).forEach((c, i) => {
            const part = t.parts && t.parts[i];
            cands.appendChild(h('div', { class: 'cond' },
              h('span', { class: 'ci' }, String(i + 1)),
              h('div', {}, typeof c === 'number' ? pct2(c) : '未能解析'),
              (part && part.kind === 'same_as')
                ? h('span', { class: 'co', style: { marginLeft: '7px' } },
                    `（交易对手普通债权权重 → ${pct2(part.resolved)}）`)
                : null));
          });
          const inner = h('div', { class: 'sl-b' },
            h('div', { class: 'sl-l' }, 'greater_of — 取以下各项的最大值'),
            h('div', { class: 'sl-note' }, t.note),
            cands,
            h('div', { style: { marginTop: '4px' } }, '取大者得到 ', h('b', {}, pct2(t.resolved))));
          wb.appendChild(h('div', { class: 'step-line' }, h('span', { class: 'sl-n' }, '⇈'), inner));
        }
      });
      wt.appendChild(wb);
      box.appendChild(wt);
    }

    return box;
  }

  /* ================= Markdown 规则执行记录 ================= */
  /** 生成一笔债项的结构化 Markdown 规则执行记录 */
  function buildMarkdown(rec, ctx) {
    const L = [];
    const p = (s) => L.push(s);
    const money = (v) => (v == null ? '—' : Number(v).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

    p('# 规则执行记录 · ' + rec.loanId);
    p('');
    p('> 【模拟数据】本记录由系统按实际执行的规则路径自动生成，用于审计复核演示。');
    p('> 其中的监管条款、制度名称与权重数值均为虚构，不得作为真实监管依据。');
    p('');
    p('## 一、债项基本信息');
    p('');
    p('| 项目 | 内容 |');
    p('| --- | --- |');
    p(`| 债项编号 | ${rec.loanId} |`);
    p(`| 客户编号 | ${rec.customer} |`);
    p(`| 客户名称 | ${rec.name} |`);
    p(`| 产品类型 | ${productLabel(rec.product)}（识别依据：${rec.productBasis}） |`);
    p(`| 计量基准日 | ${ctx.baseDate} |`);
    p(`| 监管地区 | ${jurisdictionLabel(ctx.jurisdiction)} |`);
    p(`| 监管版本 | ${ctx.version} |`);
    p(`| 规则集 | ${ctx.fingerprint.rulesetId} · 指纹 ${ctx.fingerprint.hash} · 规则节点 ${ctx.fingerprint.nodes} 个 |`);
    p(`| 计量时间 | ${ctx.fingerprint.frozenAt} |`);
    p(`| 计量状态 | ${UI.STATUS_LABEL[rec.status] || rec.status} |`);
    p('');
    p('## 二、原始数据');
    p('');
    p('| 字段 | 原值 |');
    p('| --- | --- |');
    Object.entries(rec.raw || {}).forEach(([k, v]) => p(`| ${k} | ${v === '' || v == null ? '（空）' : v} |`));
    p('');
    p('## 三、标准字段取值（规则判断的输入）');
    p('');
    p('| 标准字段 | 取值 | 说明 |');
    p('| --- | --- | --- |');
    Object.entries(rec.stages.classify.facts || rec.std || {}).forEach(([k, v]) => {
      const fv = UI.fieldValue(k, v);
      p(`| ${UI.label(k)}（${k}） | ${fv.text} | ${fv.missing ? '**未填，引用它的条件不命中**' : ''} |`);
    });
    p('');
    p('## 四、命中规则及判断顺序');
    p('');
    p(`- 暴露大类：**${rec.exposureClass || '未分类'}**`);
    p(`- 暴露子类：**${rec.exposureSubClass || '—'}**`);
    p(`- 命中规则：\`${rec.matchedRule || '—'}\``);
    p(`- 规则路径：\`${rec.matchedPath || '—'}\``);
    p('');
    p('### 逐层执行过程');
    p('');
    const walkTrace = (nodes, depth) => {
      (nodes || []).forEach((t) => {
        const indent = '  '.repeat(depth);
        const st = t.status === 'matched' ? '✓ 命中' : t.status === 'skipped' ? '⊘ 跳过' : t.status === 'not-matched' ? '✕ 未命中' : '! ' + t.status;
        p(`${indent}- ${st} · **${t.label}** \`${t.name}\``);
        if (t.skipped) p(`${indent}  - 跳过原因：${t.skipReason}`);
        if (t.condition && t.condition.items) {
          t.condition.items.forEach((it) => {
            if (it.nested) {
              p(`${indent}  - ${it.kind === 'all' ? '全部成立' : '任一成立'}嵌套组 → ${it.ok ? '成立' : '不成立'}`);
              (it.items || []).forEach((s) => { if (!s.nested) p(`${indent}    - ${condText(s)}`); });
            } else {
              p(`${indent}  - ${condText(it)}`);
            }
          });
        }
        if (t.outcome) p(`${indent}  - 产出：暴露子类 ${t.outcome.subClass}，风险权重 ${typeof t.outcome.riskWeight === 'number' ? pct2(t.outcome.riskWeight) : '待定'}`);
        if (t.children) walkTrace(t.children, depth + 1);
        if (t.fallbackUsed && t.fallbackUsed.result) {
          p(`${indent}  - ↳ 子规则全不中，走兜底「${t.fallbackUsed.result.ruleLabel}」`);
        }
      });
    };
    walkTrace(rec.stages.classify.trace, 0);
    p('');
    p('## 五、暴露分类结果');
    p('');
    p(`| 项目 | 结果 |`);
    p(`| --- | --- |`);
    p(`| 暴露大类 | ${rec.exposureClass || '—'} |`);
    p(`| 暴露子类 | ${rec.exposureSubClass || '—'} |`);
    p(`| 命中规则 | ${rec.matchedRule || '—'} |`);
    p('');
    p('## 六、EAD 计算过程');
    p('');
    const ead = rec.stages.ead.result;
    if (ead) {
      p(`- 计算规则：\`${ead.ruleId || '—'}\` ${ead.ruleName}`);
      p(`- 计算公式：${ead.formula}`);
      p(`- 业务性质：${ead.kind === 'off' ? '表外业务' : '表内业务'}`);
      p('');
      p('| 步骤 | 计算项 | 表达式 | 结果 |');
      p('| --- | --- | --- | --- |');
      ead.steps.forEach((s) => p(`| ${s.n} | ${s.label} | \`${s.expr}\` | ${money(s.value)} |`));
      p('');
      p(`- **表内 EAD：${money(ead.onEad)}**`);
      p(`- **表外 EAD：${money(ead.offEad)}**`);
      p(`- **合计 EAD：${money(ead.ead)}**`);
    } else {
      p('（未执行 EAD 计算）');
    }
    p('');
    p('## 七、风险权重与 RWA 计算过程');
    p('');
    p(`- 适用风险权重：**${pct2(rec.riskWeight)}**`);
    (rec.weightTrace || []).forEach((t) => {
      if (t.kind === 'const') p(`  - 规则直接给定的常量权重。`);
      else if (t.kind === 'same_as') p(`  - 向交易对手取权重（same_as: ${t.same_as}），重新分类命中 \`${t.subPath}\`，得到 ${pct2(t.resolved)}。`);
      else if (t.kind === 'greater_of') p(`  - greater_of 取大者：${(t.candidates || []).map((c) => pct2(c)).join(' 与 ')} → ${pct2(t.resolved)}。`);
    });
    const rwa = rec.stages.rwa.result;
    if (rwa) {
      p('');
      p('| 步骤 | 计算项 | 表达式 | 结果 |');
      p('| --- | --- | --- | --- |');
      rwa.steps.forEach((s) => p(`| ${s.n} | ${s.label} | \`${s.expr}\` | ${s.value != null && s.label.includes('权重') ? pct2(s.value) : money(s.value)} |`));
      p('');
      p(`- **信用风险加权资产 RWA = ${money(rwa.rwa)}**`);
      p('');
      p('> RWA = 适用的信用风险暴露金额 × 适用风险权重。该简化公式仅适用于标准法下的对应情形，');
      p('> 需要进一步调整或采用其他计量方法的，以对应监管规则为准。');
    }
    p('');
    p('## 八、监管条款引用');
    p('');
    const clauses = (MASTER.CLAUSES || []).filter((c) => (c.referencedBy || []).includes(rec.matchedRule));
    if (clauses.length) {
      clauses.forEach((c) => {
        p(`### ${c.clause} ${c.title}`);
        p('');
        p(`- 制度：${c.doc}（${c.docVersion}）`);
        p(`- 适用业务范围：${c.scope}`);
        p(`- 生效日期：${c.effectiveFrom}`);
        p(`- 来源文件：${c.source}`);
        p('');
        p(`> ${c.text}`);
        p('');
      });
    } else {
      p(`本笔命中的规则 \`${rec.matchedRule}\` 在条款库中暂无直接关联条款，需人工补充。`);
      p('');
    }
    p('## 九、异常及人工调整记录');
    p('');
    if ((rec.exceptions || []).length) {
      rec.exceptions.forEach((e) => p(`- [${e.level === 'error' ? '异常' : e.level === 'warn' ? '待复核' : '提示'}] ${e.text}`));
    } else {
      p('- 本次计量未发现异常，无需人工调整。');
    }
    if (ctx.overrides && Object.keys(ctx.overrides).length) {
      p('');
      p('### 人工调整');
      Object.entries(ctx.overrides).forEach(([id, pcode]) => {
        if (id === rec.loanId) p(`- 产品类型由人工指定为「${productLabel(pcode)}」。`);
      });
    }
    p('');
    p('---');
    p('');
    p('*本记录由银行资本充足率审计系统自动生成。每笔债项保留完整证据链：*');
    p('*原始数据 → 标准字段 → 规则判断 → 暴露分类 → EAD 计算 → 风险权重 → RWA 结果 → 监管依据。*');
    return L.join('\n');
  }

  function condText(it) {
    if (!it || it.nested) return '（嵌套组）';
    const fv = it.actual === undefined ? '（未填）' : (typeof it.actual === 'number' ? it.actual : codeLabel(it.actual));
    const want = Array.isArray(it.match) ? it.match.map(codeLabel).join('/') : (typeof it.match === 'number' ? it.match : codeLabel(it.match));
    const mark = it.missing ? '⚠ 缺失' : it.ok ? '✓' : '✕';
    return `${mark} ${label(it.field)} ${UI.OP_LABELS[it.op] || it.op} ${want} → 实际 ${fv}`;
  }

  function productLabel(code) {
    const p = (MASTER.PRODUCT_TYPES || []).find((x) => x.code === code);
    return p ? p.label : (code || '未识别');
  }
  function jurisdictionLabel(code) {
    const j = (MASTER.JURISDICTIONS || []).find((x) => x.code === code);
    return j ? j.label : code;
  }

  global.Views = {
    DecisionTree, showRuleDetail, ExecutionTrace, buildMarkdown,
    clauseCard, fieldBlock, summarizeWhen, renderWhenTree, condText,
    productLabel, jurisdictionLabel, findNodeByName,
  };
})(window);
