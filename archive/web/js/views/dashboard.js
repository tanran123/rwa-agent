/** 首页 / 计量工作台 */
(function () {
  const { h, kpi, panel, tag, statusTag, notice, simBadge, fmtNum, fmtShort, pct2, makeTable } = UI;
  const V = window.Views;

  App.register('dashboard', (root) => {
    App.setHeader('首页 / 计量工作台', '按菜单顺序走：规则配置、暴露分类、EAD，然后计量。');
    root.innerHTML = '';

    const ctx = Store.state.ctx;
    const rs = Store.currentRuleset();
    const last = Store.state.lastRun;
    const totalNodes = Store.countNodes(rs);

    root.appendChild(h('div', { class: 'grid c4', style: { marginBottom: '16px' } },
      kpi('规则节点', String(totalNodes), `${(rs.rules || []).length} 个顶层分类`, { accent: true }),
      kpi('标准字段', String((rs.fields || []).length), '规则判断的统一输入'),
      kpi('最近批次', last ? last.summary.total + ' 笔' : '尚未运行',
        last ? `EAD ${fmtShort(last.summary.ead)} · RWA ${fmtShort(last.summary.rwa)}` : '从计量向导发起',
        { sm: true }),
      kpi('当前版本', (Store.currentVersion() || {}).version || '—', App.j2label(ctx.jurisdiction))));

    const steps = [
      ['1', '规则配置', '监管规则版本 → 监管条款库 → 产品标准字段', 'versions'],
      ['2', '暴露分类规则', '通用暴露分类 → 产品专属规则 → 分类决策树 → 规则助手', 'generic'],
      ['3', 'EAD 计算规则', '表内 EAD → 表外 EAD', 'eadOn'],
      ['4', '计量执行', '计量向导 → 结果明细 → 计量批次 → 审计底稿', 'wizard'],
    ];
    root.appendChild(h('div', { class: 'grid c2', style: { marginBottom: '16px' } },
      steps.map(([n, title, line, route]) => h('div', {
        class: 'fblock', style: { cursor: 'pointer' },
        onclick: () => App.go(route),
      },
        h('div', { class: 'fh' },
          h('span', { class: 'tag brand' }, n),
          h('span', { class: 'fname' }, title)),
        h('div', { class: 'fmean' }, line)))));

    const right = h('div');

    // 批次
    const batches = (Store.state.batches.length ? Store.state.batches : MASTER.BATCHES).slice(0, 5);
    const bt = h('table', { class: 'tbl compact' },
      h('thead', {}, h('tr', {}, ['批次编号', '基准日', '版本', '债项', 'EAD', 'RWA', '状态'].map((t) => h('th', {}, t)))),
      h('tbody', {}, batches.map((b) => h('tr', { class: 'clickable', onclick: () => App.go('batches') },
        h('td', { class: 'mono' }, b.id),
        h('td', {}, b.baseDate),
        h('td', {}, b.version),
        h('td', { class: 'num' }, b.imported),
        h('td', { class: 'num' }, b.onEad || b.offEad || b.ead ? fmtShort((b.onEad || 0) + (b.offEad || 0) || b.ead) : '—'),
        h('td', { class: 'num' }, b.rwa ? fmtShort(b.rwa) : '—'),
        h('td', {}, statusTag(b.status))))));
    right.appendChild(panel('最近计量批次', {
      actions: h('button', { class: 'btn sm', onclick: () => App.go('batches') }, '全部批次'),
    }, h('div', { class: 'table-wrap', style: { margin: '-15px' } }, bt)));

    root.appendChild(right);
  });
})();
