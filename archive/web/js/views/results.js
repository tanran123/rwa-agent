/** 模块六 / 七：计量结果明细、单笔追溯、Markdown 记录、Excel 导出、批次管理 */
(function () {
  const { h, panel, tag, notice, makeTable, openDrawer, openModal, toast, kv,
          statusTag, pct2, fmtNum, fmtShort, downloadBlob, confirmDialog } = UI;
  const V = window.Views;

  /* 若用户未运行向导就直接打开结果页，自动用模拟数据跑一遍 */
  function ensureResults() {
    if (Store.state.lastRun) return Store.state.lastRun;
    const rs = Store.currentRuleset();
    if (!rs) return null;
    const out = window.Pipeline.measureBatch(window.MOCK.MOCK_LOANS, {
      ruleset: rs, eadOnRules: MASTER.EAD_ON_RULES, eadOffRules: MASTER.EAD_OFF_RULES,
      detectRules: window.MOCK.PRODUCT_DETECT_RULES,
      productOverride: null,
    });
    const ver = Store.currentVersion();
    const fp = Store.rulesetFingerprint();
    const batch = {
      id: 'BATCH-AUTO-' + Store.state.ctx.jurisdiction + '-01',
      name: Store.state.ctx.batchName + '（自动演示）',
      institution: Store.state.ctx.institution, jurisdiction: Store.state.ctx.jurisdiction,
      version: ver.version, baseDate: Store.state.ctx.baseDate,
      imported: out.summary.total, success: out.summary.ok,
      exception: out.summary.exception + out.summary.warning,
      onEad: out.summary.onEad, offEad: out.summary.offEad, ead: out.summary.ead, rwa: out.summary.rwa,
      createdAt: new Date().toISOString().replace('T', ' ').slice(0, 19),
      status: out.summary.exception ? 'failed' : 'completed',
      fingerprint: fp, auto: true,
    };
    Store.state.lastRun = {
      results: out.results, summary: out.summary, batch,
      scope: { ...Store.state.ctx },
    };
    return Store.state.lastRun;
  }

  function mdView(md) {
    return h('div', {},
      notice('warn', '本记录为模拟生成，其中的监管条款、制度名称与权重数值均为虚构，仅用于演示审计复核过程。', '模拟记录声明：'),
      h('div', { class: 'md-view' }, md));
  }

  /* ==================== 计量结果明细 ==================== */
  App.register('results', (root) => {
    App.setHeader('计量结果明细', '逐笔债项计量结果与审计证据；点击任意债项进入该笔的完整计量详情页');
    root.innerHTML = '';

    const run = ensureResults();
    if (!run) {
      root.appendChild(notice('danger', '规则集尚未加载，无法展示计量结果。请检查是否通过本地 HTTP 服务打开页面。', '无法计量：'));
      return;
    }
    const { results, summary, batch, scope } = run;
    const ver = MASTER.RULE_VERSIONS.find((v) => v.version === batch.version) || Store.currentVersion();
    const fp = batch.fingerprint || Store.rulesetFingerprint();

    root.appendChild(h('div', { class: 'grid c4', style: { marginBottom: '14px' } },
      UI.kpi('债项总数', String(summary.total), batch.id + ' · ' + batch.version, { accent: true }),
      UI.kpi('EAD 合计', fmtShort(summary.ead), `表内 ${fmtShort(summary.onEad)} · 表外 ${fmtShort(summary.offEad)}`),
      UI.kpi('信用风险 RWA', fmtShort(summary.rwa), `平均权重 ${pct2(summary.rwaRate)}`, { accent: true }),
      UI.kpi('异常 / 待复核', `${summary.exception} / ${summary.warning}`,
        summary.exception ? '需人工处理' : '无阻断异常', { sm: true })));

    /* 筛选栏 */
    const prodSel = h('select', {}, [h('option', { value: '' }, '全部产品'),
      ...MASTER.PRODUCT_TYPES.map((p) => h('option', { value: p.code }, p.label))]);
    const classSel = h('select', {}, [h('option', { value: '' }, '全部暴露大类'),
      ...[...new Set(results.map((r) => r.exposureClass).filter(Boolean))].map((c) => h('option', { value: c }, c))]);
    const statusSel = h('select', {}, [h('option', { value: '' }, '全部计量状态'),
      h('option', { value: 'ok' }, '正常'), h('option', { value: 'warning' }, '待复核'), h('option', { value: 'exception' }, '异常')]);
    const search = h('input', { type: 'text', placeholder: '搜索债项编号、客户编号或命中规则…' });
    const onlyExc = h('input', { type: 'checkbox' });

    /* 表格 */
    const rows = results.map((r) => ({
      id: r.loanId, customer: r.customer, name: r.name,
      product: r.product, productLabel: V.productLabel(r.product),
      balance: r.std.balance, cls: r.exposureClass || '未分类', sub: r.exposureSubClass,
      rule: r.matchedRule, w: r.riskWeight, onEad: r.onEad, offEad: r.offEad, rwa: r.rwa,
      status: r.status, ref: r.reference ? (r.reference.clause || '') : '—',
      exc: (r.exceptions || []).map((e) => e.text).join(' '),
      _r: r,
    }));

    const cols = [
      { key: 'id', title: '债项编号', cls: 'mono' },
      { key: 'customer', title: '客户编号', cls: 'mono' },
      { key: 'productLabel', title: '产品类型' },
      { key: 'balance', title: '原始余额', num: true, value: (r) => fmtNum(r.balance) },
      { key: 'cls', title: '暴露大类', html: (r) => r.cls === '未分类'
        ? '<span class="tag danger">未分类</span>' : `<span class="tag brand">${UI.esc(r.cls)}</span>` },
      { key: 'sub', title: '暴露子类' },
      { key: 'rule', title: '命中规则', cls: 'mono' },
      { key: 'w', title: '风险权重', num: true, value: (r) => pct2(r.w) },
      { key: 'onEad', title: '表内 EAD', num: true, value: (r) => fmtNum(r.onEad) },
      { key: 'offEad', title: '表外 EAD', num: true, value: (r) => fmtNum(r.offEad) },
      { key: 'rwa', title: '信用风险 RWA', num: true, value: (r) => fmtNum(r.rwa) },
      { key: 'status', title: '计量状态', html: (r) => r.status === 'ok' ? '<span class="tag ok">正常</span>'
        : r.status === 'warning' ? '<span class="tag warn">待复核</span>' : '<span class="tag danger">异常</span>' },
      { key: 'ref', title: '监管依据', cls: 'dim' },
      { key: '_act', title: '规则执行轨迹', sortable: false, html: (r) => `
        <div class="btn-group">
          <button class="btn xs" data-act="trace" data-id="${r.id}">轨迹</button>
          <button class="btn xs" data-act="md" data-id="${r.id}">执行记录</button>
          <button class="btn xs" data-act="detail" data-id="${r.id}">追溯</button>
        </div>` },
    ];

    const tbl = makeTable({ columns: cols, rows, pageSize: 20, onRowClick: (r) => showDetail(r._r) });
    tbl.el.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      const r = rows.find((x) => x.id === btn.dataset.id);
      if (btn.dataset.act === 'trace') showTrace(r._r);
      if (btn.dataset.act === 'md') showMarkdown(r._r);
      if (btn.dataset.act === 'detail') showDetail(r._r);
    });

    prodSel.onchange = () => tbl.setFilter('product', prodSel.value);
    classSel.onchange = () => tbl.setFilter('cls', classSel.value);
    statusSel.onchange = () => tbl.setFilter('status', statusSel.value);
    search.oninput = () => tbl.setQuery(search.value);
    onlyExc.onchange = () => tbl.setFilter('status', onlyExc.checked ? 'exception' : '');

    root.appendChild(panel('逐笔计量结果明细表', {
      sub: `${rows.length} 笔 · 支持分页、筛选、排序与搜索`,
      tight: true,
      actions: h('div', { class: 'btn-group' },
        h('button', { class: 'btn sm', onclick: () => App.go('export') }, '导出 Excel 底稿'),
        h('button', { class: 'btn sm', onclick: () => exportAllMarkdown() }, '批量导出 Markdown')),
    },
      h('div', { class: 'inline-fields', style: { padding: '12px 15px 2px' } },
        h('div', { class: 'field' }, h('label', {}, '产品类型'), prodSel),
        h('div', { class: 'field' }, h('label', {}, '暴露大类'), classSel),
        h('div', { class: 'field' }, h('label', {}, '计量状态'), statusSel),
        h('div', { class: 'field', style: { flex: 1, minWidth: '200px' } }, h('label', {}, '关键字搜索'), search),
        h('div', { class: 'field' }, h('label', {}, ' '), h('label', { class: 'checkline' }, onlyExc, '仅看异常'))),
      tbl.el));

    /* 汇总 */
    const byClass = {}, byProduct = {};
    results.forEach((r) => {
      const k = r.exposureClass || '未分类';
      byClass[k] = byClass[k] || { n: 0, ead: 0, rwa: 0 };
      byClass[k].n++; byClass[k].ead += r.ead || 0; byClass[k].rwa += r.rwa || 0;
      const p = r.product || '未识别';
      byProduct[p] = byProduct[p] || { n: 0, ead: 0, rwa: 0 };
      byProduct[p].n++; byProduct[p].ead += r.ead || 0; byProduct[p].rwa += r.rwa || 0;
    });
    const totalRwa = summary.rwa;
    root.appendChild(h('div', { class: 'grid c2' },
      panel('按暴露大类汇总', { tight: true }, h('div', { class: 'table-wrap' },
        h('table', { class: 'tbl compact' },
          h('thead', {}, h('tr', {}, ['暴露大类', '笔数', 'EAD', 'RWA', '平均权重', '占比'].map((t) => h('th', {}, t)))),
          h('tbody', {}, Object.entries(byClass).sort((a, b) => b[1].rwa - a[1].rwa).map(([k, v]) => h('tr', {},
            h('td', {}, k), h('td', { class: 'num' }, String(v.n)),
            h('td', { class: 'num' }, fmtShort(v.ead)), h('td', { class: 'num strong' }, fmtShort(v.rwa)),
            h('td', { class: 'num' }, pct2(v.ead ? v.rwa / v.ead : 0)),
            h('td', { class: 'num' }, pct2(totalRwa ? v.rwa / totalRwa : 0)))))))),
      panel('按产品类型汇总', { tight: true }, h('div', { class: 'table-wrap' },
        h('table', { class: 'tbl compact' },
          h('thead', {}, h('tr', {}, ['产品类型', '笔数', 'EAD', 'RWA', '平均权重'].map((t) => h('th', {}, t)))),
          h('tbody', {}, Object.entries(byProduct).sort((a, b) => b[1].rwa - a[1].rwa).map(([k, v]) => h('tr', {},
            h('td', {}, V.productLabel(k)), h('td', { class: 'num' }, String(v.n)),
            h('td', { class: 'num' }, fmtShort(v.ead)), h('td', { class: 'num strong' }, fmtShort(v.rwa)),
            h('td', { class: 'num' }, pct2(v.ead ? v.rwa / v.ead : 0))))))))));

    /* 异常清单 */
    const excRows = results.filter((r) => r.status !== 'ok');
    if (excRows.length) {
      root.appendChild(panel('异常债项清单', {
        sub: `${excRows.length} 笔 · 可定位至相应的字段、规则或计算环节`,
        tight: true,
      }, h('div', { class: 'table-wrap' },
        h('table', { class: 'tbl' },
          h('thead', {}, h('tr', {}, ['债项编号', '客户名称', '产品类型', '异常环节', '具体问题', '定位'].map((t) => h('th', {}, t)))),
          h('tbody', {}, excRows.map((r) => {
            const stage = r.status === 'exception'
              ? (r.stages.classify.status === 'exception' ? '暴露分类' : r.stages.ead.status === 'exception' ? 'EAD 计算' : '风险权重')
              : '数据质量';
            return h('tr', { class: 'clickable', onclick: () => showDetail(r) },
              h('td', { class: 'mono' }, r.loanId),
              h('td', {}, r.name),
              h('td', {}, V.productLabel(r.product)),
              h('td', {}, h('span', { class: `tag ${r.status === 'exception' ? 'danger' : 'warn'}` }, stage)),
              h('td', { style: { fontSize: '11.5px' } }, (r.exceptions || []).map((e) => e.text).join('；')),
              h('td', {}, h('button', { class: 'btn xs', onclick: (e) => { e.stopPropagation(); showDetail(r); } }, '查看并定位')));
          }))))));
    }

    /* 抽屉函数 */
    const ctx = () => ({ ...Store.state.ctx, version: batch.version, fingerprint: fp, overrides: Store.state.overrides, baseDate: batch.baseDate, jurisdiction: batch.jurisdiction });

    function showTrace(r) {
      openDrawer({
        title: `规则执行轨迹 · ${r.loanId}`, wide: true,
        body: h('div', {}, kv([
          ['债项编号', r.loanId], ['产品类型', V.productLabel(r.product)],
          ['暴露大类', r.exposureClass || '—'], ['暴露子类', r.exposureSubClass || '—'],
          ['命中规则', { mono: true, node: h('code', {}, r.matchedRule || '—') }],
          ['规则路径', { mono: true, node: h('code', {}, r.matchedPath || '—') }],
        ]), h('div', { style: { marginTop: '13px' } }, V.ExecutionTrace(r.stages.classify))),
      });
    }

    function showMarkdown(r) {
      const md = V.buildMarkdown(r, ctx());
      openDrawer({
        title: `Markdown 规则执行记录 · ${r.loanId}`, wide: true, body: mdView(md),
        footer: [
          h('button', { class: 'btn', onclick: () => {
            downloadBlob(new Blob([md], { type: 'text/markdown;charset=utf-8' }), `${r.loanId}_规则执行记录.md`);
            toast('已下载 Markdown 规则执行记录', 'ok');
          } }, '下载 .md 文件'),
          h('button', { class: 'btn', onclick: () => UI.copyText(md, 'Markdown 内容已复制') }, '复制内容'),
        ],
      });
    }

    /* 单笔债项计量详情页（10 项证据链） */
    function showDetail(r) {
      const body = h('div', {});
      const ead = r.stages.ead.result;
      const rwa = r.stages.rwa.result;

      body.appendChild(h('div', { class: 'grid c4', style: { marginBottom: '13px' } },
        UI.kpi('暴露大类 / 子类', (r.exposureClass || '未分类'), r.exposureSubClass || '', { sm: true }),
        UI.kpi('命中规则', r.matchedRule || '—', V.productLabel(r.product), { accent: true, sm: true }),
        UI.kpi('EAD', fmtShort(r.ead), r.onEad ? `表内 ${fmtShort(r.onEad)}` : `表外 ${fmtShort(r.offEad)}`, { sm: true }),
        UI.kpi('信用风险 RWA', fmtShort(r.rwa), `风险权重 ${pct2(r.riskWeight)}`, { sm: true })));

      const steps = [
        ['1. 原始债项数据', () => kv(Object.entries(r.raw || {}).map(([k, v]) => [k, String(v == null || v === '' ? '（空）' : v)]))],
        ['2. 标准字段映射结果', () => kv(Object.entries(r.stages.classify.facts || r.std).map(([k, v]) => {
          const fv = UI.fieldValue(k, v);
          return [UI.label(k) + '（' + k + '）', { node: h('span', { class: fv.missing ? 'dim' : '' }, fv.text,
            fv.missing ? h('span', { class: 'tag warn', style: { marginLeft: '6px' } }, '未填，引用它的条件不命中') : null) }];
        }))],
        ['3. 产品类型识别结果', () => h('div', {}, kv([
          ['产品类型', V.productLabel(r.product)], ['识别依据', r.productBasis],
          ['识别置信度', r.confidence === 'high' ? '高' : r.confidence === 'medium' ? '中' : r.confidence === 'manual' ? '人工指定' : '未识别'],
        ]))],
        ['4-6. 暴露分类规则的逐步执行过程', () => V.ExecutionTrace(r.stages.classify)],
        ['7. 风险权重确定过程', () => weightTraceView(r.weightTrace)],
        ['8. EAD 计算过程', () => ead ? h('div', {}, ead.steps.map((s) => h('div', { class: 'step-line' },
          h('span', { class: 'sl-n' }, s.n),
          h('div', { class: 'sl-b' },
            h('div', {}, h('span', { class: 'sl-l' }, s.label), h('span', { class: 'sl-v' }, fmtNum(s.value))),
            h('div', {}, h('span', { class: 'sl-e' }, s.expr)),
            s.note ? h('div', { class: 'sl-note' }, s.note) : null)))) : h('div', { class: 'dim' }, '未执行 EAD 计算'),
          h('div', { class: 'notice ok', style: { marginTop: '9px' } }, h('span', { class: 'ni' }, '='),
            h('div', {}, 'EAD = ', h('b', {}, fmtNum(r.ead)), ead && ead.kind === 'off' ? '（表外 EAD）' : '（表内 EAD）'))],
        ['9. RWA 计算过程', () => rwa ? h('div', {}, rwa.steps.map((s) => h('div', { class: 'step-line' },
          h('span', { class: 'sl-n' }, s.n),
          h('div', { class: 'sl-b' },
            h('div', {}, h('span', { class: 'sl-l' }, s.label),
              h('span', { class: 'sl-v' }, s.label.includes('权重') ? pct2(s.value) : fmtNum(s.value))),
            h('div', {}, h('span', { class: 'sl-e' }, s.expr)),
            s.note ? h('div', { class: 'sl-note' }, s.note) : null))),
          h('div', { class: 'notice ok', style: { marginTop: '9px' } }, h('span', { class: 'ni' }, '='),
            h('div', {}, '信用风险 RWA = ', h('b', {}, fmtNum(r.rwa))))) : h('div', { class: 'dim' }, '未计算 RWA')],
        ['10. 关联监管条款及规则版本', () => {
          const cl = MASTER.CLAUSES.find((c) => (c.referencedBy || []).includes(r.matchedRule));
          return h('div', {},
            cl ? V.clauseCard(cl) : h('div', { class: 'dim' }, '本笔命中的规则在条款库中暂无直接关联条款。'),
            kv([
              ['监管版本', batch.version],
              ['规则集 ID', { mono: true, node: h('code', {}, fp.rulesetId) }],
              ['规则集指纹', { mono: true, node: h('code', {}, fp.hash) }],
              ['计量基准日', batch.baseDate],
              ['计量批次', batch.id],
            ]));
        }],
      ];

      if ((r.exceptions || []).length) {
        steps.push(['11. 异常及人工调整记录', () => h('div', {},
          r.exceptions.map((e) => h('div', { class: `notice ${e.level === 'error' ? 'danger' : e.level === 'warn' ? 'warn' : 'info'}`, style: { margin: '5px 0' } },
            h('span', { class: 'ni' }, e.level === 'error' ? '✕' : e.level === 'warn' ? '!' : 'ℹ'), h('div', {}, e.text))))]);
      }

      steps.forEach(([title, fn]) => {
        body.appendChild(h('div', { class: 'panel' },
          h('div', { class: 'panel-head' }, h('h3', {}, title)),
          h('div', { class: 'panel-body' }, fn())));
      });

      openDrawer({
        title: `单笔债项计量追溯 · ${r.loanId} ${r.name}`, wide: true, body,
        footer: [
          h('button', { class: 'btn', onclick: () => showMarkdown(r) }, '查看 Markdown 执行记录'),
          h('button', { class: 'btn', onclick: () => showTrace(r) }, '仅看规则轨迹'),
        ],
      });
    }

    function weightTraceView(wt) {
      if (!wt || !wt.length) return h('div', { class: 'dim' }, '无权重解析信息');
      const box = h('div', {});
      wt.forEach((t) => {
        if (t.kind === 'const') {
          box.appendChild(h('div', { class: 'notice ok' }, h('span', { class: 'ni' }, '='),
            h('div', {}, '规则直接给定常量权重：', h('b', {}, pct2(t.value)), t.note ? h('div', { class: 'dim', style: { fontSize: '11px' } }, t.note) : null)));
        } else if (t.kind === 'same_as') {
          box.appendChild(notice('info',
            `same_as: ${t.same_as} —— 权重等于该交易对手做一笔普通债权时的风险权重。分类已经知道这笔是房地产、已违约或合格资产担保债券之后，` +
            `权重不在这里定死，而是忘掉这个产品类别，只看交易对手是谁，从 rules 最外层再分一次。只分这一次，不会回到当前这条。`, '向交易对手取权重：'));
          box.appendChild(kv([
            ['重新分类命中路径', { mono: true, node: h('code', {}, t.subPath || '—') }],
            ['解析结果', t.resolved != null ? pct2(t.resolved) : '（未能解析）'],
          ]));
        } else if (t.kind === 'greater_of') {
          box.appendChild(notice('info', t.note, '取大者 greater_of：'));
          box.appendChild(h('div', { class: 'table-wrap' },
            h('table', { class: 'tbl compact' },
              h('thead', {}, h('tr', {}, ['候选', '来源', '取值'].map((x) => h('th', {}, x)))),
              h('tbody', {}, (t.candidates || []).map((cpt, i) => {
                const part = t.parts && t.parts[i];
                return h('tr', {}, h('td', {}, `候选 ${i + 1}`),
                  h('td', { class: 'dim' }, part && part.kind === 'same_as' ? '按交易对手普通债权权重' : '规则中的常量'),
                  h('td', { class: 'mono strong' }, pct2(cpt)));
              })))));
          box.appendChild(h('div', { class: 'notice ok' }, h('span', { class: 'ni' }, '⇈'),
            h('div', {}, '取最大值：', h('b', {}, pct2(t.resolved)))));
        }
      });
      return box;
    }

    function exportAllMarkdown() {
      const all = results.map((r) => `<!-- ${r.loanId} -->\n\n` + V.buildMarkdown(r, ctx())).join('\n\n---\n\n');
      const header = `# 规则执行记录汇总\n\n本文件包含批次 ${batch.id} 全部 ${results.length} 笔债项的规则执行记录。\n\n` +
        `> 【模拟数据】由银行资本充足率审计系统原型生成。\n\n---\n\n`;
      downloadBlob(new Blob([header + all], { type: 'text/markdown;charset=utf-8' }),
        `${batch.id}_规则执行记录汇总.md`);
      toast(`已导出 ${results.length} 笔债项的规则执行记录`, 'ok');
    }
  });

  /* ==================== 计量批次管理 ==================== */
  App.register('batches', (root) => {
    App.setHeader('计量批次管理', '每个批次固定当时的规则版本。规则更新后，历史批次不改。');
    root.innerHTML = '';

    const batches = Store.state.batches.length ? Store.state.batches : MASTER.BATCHES;

    const cols = [
      { key: 'id', title: '批次编号', cls: 'mono' },
      { key: 'name', title: '批次名称' },
      { key: 'institution', title: '银行/机构' },
      { key: 'jurisdiction', title: '监管地区', value: (r) => App.j2label(r.jurisdiction) },
      { key: 'version', title: '监管版本', cls: 'mono' },
      { key: 'baseDate', title: '计量基准日' },
      { key: 'imported', title: '导入债项', num: true },
      { key: 'success', title: '成功计量', num: true },
      { key: 'exception', title: '异常', num: true,
        html: (r) => r.exception ? `<span class="tag ${r.exception > 2 ? 'danger' : 'warn'}">${r.exception}</span>` : '<span class="tag muted">0</span>' },
      { key: 'ead', title: 'EAD 汇总', num: true, value: (r) => (r.onEad || 0) + (r.offEad || 0) || r.ead,
        html: (r) => fmtShort(((r.onEad || 0) + (r.offEad || 0)) || r.ead) },
      { key: 'rwa', title: 'RWA 汇总', num: true, value: (r) => r.rwa, html: (r) => fmtShort(r.rwa) },
      { key: 'createdAt', title: '创建时间' },
      { key: 'status', title: '处理状态', html: (r) => {
        const t = r.status === 'completed' ? 'ok' : r.status === 'failed' ? 'danger' : 'info';
        const l = r.status === 'completed' ? '已完成' : r.status === 'failed' ? '存在异常' : '进行中';
        return `<span class="tag ${t}">${l}</span>`;
      } },
      { key: '_act', title: '操作', sortable: false, html: (r) => `
        <div class="btn-group">
          <button class="btn xs" data-act="open" data-id="${r.id}">查看结果</button>
          <button class="btn xs" data-act="fp" data-id="${r.id}">规则版本</button>
        </div>` },
    ];
    const tbl = makeTable({
      columns: cols, rows: batches, pageSize: 12,
      onRowClick: (r) => openBatch(r),
      rowClass: (r) => (Store.state.lastRun && Store.state.lastRun.batch.id === r.id ? 'sel' : ''),
    });
    tbl.el.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      const b = batches.find((x) => x.id === btn.dataset.id);
      if (btn.dataset.act === 'open') openBatch(b);
      if (btn.dataset.act === 'fp') showFingerprint(b);
    });

    root.appendChild(panel('计量批次列表', {
      sub: `${batches.length} 个批次`,
      tight: true,
      actions: h('div', { class: 'btn-group' },
        h('button', { class: 'btn primary sm', onclick: () => App.go('wizard') }, '＋ 发起新计量'),
        h('button', { class: 'btn sm', onclick: () => showCompare() }, '批次对比')),
    }, tbl.el));

    /* 维度汇总 */
    const cur = Store.state.lastRun;
    if (cur) {
      const byClass = {}, byProduct = {}, byStatus = {};
      cur.results.forEach((r) => {
        const k = r.exposureClass || '未分类';
        byClass[k] = byClass[k] || { n: 0, ead: 0, rwa: 0 }; byClass[k].n++; byClass[k].ead += r.ead || 0; byClass[k].rwa += r.rwa || 0;
        const p = V.productLabel(r.product);
        byProduct[p] = byProduct[p] || { n: 0, ead: 0, rwa: 0 }; byProduct[p].n++; byProduct[p].ead += r.ead || 0; byProduct[p].rwa += r.rwa || 0;
        byStatus[r.status] = (byStatus[r.status] || 0) + 1;
      });
      const dimPanel = h('div', { class: 'panel' },
        h('div', { class: 'panel-head' }, h('h3', {}, `维度汇总 · ${cur.batch.name}`),
          h('span', { class: 'sub' }, '按暴露大类、产品类型、计量状态汇总')),
        h('div', { class: 'panel-body' }));
      const dp = dimPanel.querySelector('.panel-body');
      dp.appendChild(h('div', { class: 'grid c3' },
        sumTable('按暴露大类', Object.entries(byClass).sort((a, b) => b[1].rwa - a[1].rwa)),
        sumTable('按产品类型', Object.entries(byProduct).sort((a, b) => b[1].rwa - a[1].rwa)),
        (() => {
          const box = h('div', {});
          box.appendChild(h('div', { class: 'cond-group-label' }, '按计量状态'));
          Object.entries(byStatus).forEach(([s, n]) => box.appendChild(h('div', {
            class: 'fblock', style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
          }, h('span', {}, statusTag(s)), h('b', {}, String(n) + ' 笔'))));
          return box;
        })()));
      root.appendChild(dimPanel);

      function sumTable(title, entries) {
        return h('div', {}, h('div', { class: 'cond-group-label' }, title),
          h('div', { class: 'table-wrap' }, h('table', { class: 'tbl compact' },
            h('thead', {}, h('tr', {}, ['维度', '笔数', 'RWA'].map((t) => h('th', {}, t)))),
            h('tbody', {}, entries.map(([k, v]) => h('tr', {},
              h('td', {}, k), h('td', { class: 'num' }, String(v.n)),
              h('td', { class: 'num strong' }, fmtShort(v.rwa))))))));
      }
    }

    function openBatch(b) {
      const isCurrent = Store.state.lastRun && Store.state.lastRun.batch.id === b.id;
      const body = h('div', {});
      body.appendChild(kv([
        ['批次编号', b.id], ['批次名称', b.name],
        ['银行/机构', b.institution], ['监管地区', App.j2label(b.jurisdiction)],
        ['监管版本', b.version], ['计量基准日', b.baseDate],
        ['导入债项数量', String(b.imported)], ['成功计量数量', String(b.success)],
        ['异常数量', String(b.exception)],
        ['表内 EAD', fmtNum(b.onEad)], ['表外 EAD', fmtNum(b.offEad)],
        ['EAD 合计', fmtNum((b.onEad || 0) + (b.offEad || 0) || b.ead)],
        ['RWA 汇总', fmtNum(b.rwa)], ['创建时间', b.createdAt],
        ['处理状态', { node: statusTag(b.status) }],
      ]));
      if (b.fingerprint) {
        body.appendChild(h('div', { class: 'panel', style: { marginTop: '13px' } },
          h('div', { class: 'panel-head' }, h('h3', {}, '本批次固化的规则版本')),
          h('div', { class: 'panel-body' }, kv([
            ['规则集 ID', { mono: true, node: h('code', {}, b.fingerprint.rulesetId) }],
            ['规则节点数', String(b.fingerprint.nodes)],
            ['内容指纹', { mono: true, node: h('code', {}, b.fingerprint.hash) }],
            ['固化时间', b.fingerprint.frozenAt],
          ]), notice('info', '本批次始终按上述规则版本复现，不会因规则更新而改变。', '可复现性：'))));
      }
      openDrawer({
        title: `批次详情 · ${b.id}`, body,
        footer: [
          h('button', { class: 'btn', onclick: () => { UI.closeDrawer(); App.go('results'); } },
            isCurrent ? '查看本批次结果' : '查看当前结果'),
          h('button', { class: 'btn', onclick: () => { UI.closeDrawer(); App.go('export'); } }, '导出底稿'),
        ],
      });
    }

    function showFingerprint(b) {
      if (!b.fingerprint) { toast('本批次未记录规则指纹（历史模拟批次）', 'warn'); return; }
      openDrawer({
        title: `规则版本固化记录 · ${b.id}`,
        body: h('div', {},
          notice('info', '规则更新后，历史批次不能自动套用新规则，否则可能导致审计结果无法复现。', '设计原则：'),
          kv([
            ['批次', b.id], ['计量基准日', b.baseDate],
            ['监管版本', b.version],
            ['规则集 ID', { mono: true, node: h('code', {}, b.fingerprint.rulesetId) }],
            ['规则节点数', String(b.fingerprint.nodes)],
            ['内容指纹', { mono: true, node: h('code', {}, b.fingerprint.hash) }],
            ['固化时间', b.fingerprint.frozenAt],
          ])),
      });
    }

    function showCompare() {
      if (batches.length < 2) { toast('至少需要两个批次才能对比', 'warn'); return; }
      const rows = batches.map((b) => ({
        id: b.id, name: b.name, date: b.baseDate, ver: b.version,
        n: b.imported, succ: b.success, exc: b.exception,
        ead: ((b.onEad || 0) + (b.offEad || 0)) || b.ead, rwa: b.rwa,
      }));
      openModal({
        title: '计量批次对比', wide: true,
        body: h('div', {},
          notice('info', '不同批次可能使用不同的规则版本。对比时应注意版本差异对结果的影响，不能直接归因于业务变化。', '对比提示：'),
          h('div', { class: 'table-wrap' },
            h('table', { class: 'tbl' },
              h('thead', {}, h('tr', {}, ['批次编号', '名称', '基准日', '规则版本', '债项', '成功', '异常', 'EAD', 'RWA'].map((t) => h('th', {}, t)))),
              h('tbody', {}, rows.map((r) => h('tr', {},
                h('td', { class: 'mono' }, r.id), h('td', {}, r.name), h('td', {}, r.date),
                h('td', { class: 'mono' }, r.ver), h('td', { class: 'num' }, String(r.n)),
                h('td', { class: 'num' }, String(r.succ)), h('td', { class: 'num' }, String(r.exc)),
                h('td', { class: 'num' }, fmtShort(r.ead)), h('td', { class: 'num strong' }, fmtShort(r.rwa)))))))),
        footer: [h('button', { class: 'btn', onclick: () => md.close() }, '关闭')],
      });
    }
  });
})();
