/** 模块六（续）：Excel 审计底稿导出 */
(function () {
  const { h, panel, tag, notice, toast, kv, fmtNum, fmtShort, pct2, statusTag } = UI;
  const V = window.Views;

  App.register('export', (root) => {
    App.setHeader('Excel 审计底稿导出', '导出真实的 xlsx。底稿里的业务数据是模拟数据。');
    root.innerHTML = '';

    const run = Store.state.lastRun || (function () {
      const rs = Store.currentRuleset();
      if (!rs) return null;
      const out = window.Pipeline.measureBatch(window.MOCK.MOCK_LOANS, {
        ruleset: rs, eadOnRules: MASTER.EAD_ON_RULES, eadOffRules: MASTER.EAD_OFF_RULES,
        detectRules: window.MOCK.PRODUCT_DETECT_RULES,
      });
      const fp = Store.rulesetFingerprint();
      const batch = {
        id: 'BATCH-PREVIEW-' + Store.state.ctx.jurisdiction, name: Store.state.ctx.batchName + '（预览）',
        institution: Store.state.ctx.institution, jurisdiction: Store.state.ctx.jurisdiction,
        version: Store.currentVersion().version, baseDate: Store.state.ctx.baseDate,
        imported: out.summary.total, success: out.summary.ok, exception: out.summary.exception + out.summary.warning,
        onEad: out.summary.onEad, offEad: out.summary.offEad, ead: out.summary.ead, rwa: out.summary.rwa,
        createdAt: new Date().toISOString().replace('T', ' ').slice(0, 19), status: 'completed', fingerprint: fp,
      };
      Store.state.lastRun = { results: out.results, summary: out.summary, batch, scope: { ...Store.state.ctx } };
      return Store.state.lastRun;
    })();

    if (!run) {
      root.appendChild(notice('danger', '规则集尚未加载，无法生成底稿。请通过本地 HTTP 服务打开页面。', '无法导出：'));
      return;
    }

    const { results, summary, batch } = run;
    const fp = batch.fingerprint || Store.rulesetFingerprint();

    /* 工作表选择 */
    const SHEETS = [
      { key: 'readme', name: 'ReadMe', desc: '底稿说明、计量范围、监管版本及使用说明', rows: 1, on: true, fixed: true },
      { key: 'raw', name: '原始债项数据', desc: '导入的原始数据（未标准化的源字段）', rows: results.length },
      { key: 'mapping', name: '字段映射', desc: '源字段与标准字段映射关系及异常情况', rows: 40 },
      { key: 'classify', name: '暴露分类结果', desc: '逐笔债项分类结果及命中规则', rows: results.length },
      { key: 'ead', name: 'EAD计算明细', desc: '表内、表外 EAD 的计算过程', rows: results.length * 2 },
      { key: 'rwa', name: 'RWA计算明细', desc: '风险权重及 RWA 计算结果', rows: results.length },
      { key: 'trace', name: '规则执行轨迹', desc: '逐笔债项的规则命中路径', rows: results.length * 4 },
      { key: 'exc', name: '异常及调整记录', desc: '数据异常、未命中规则和人工调整情况', rows: results.filter((r) => r.status !== 'ok').length + 5 },
      { key: 'clause', name: '监管依据', desc: '所引用的监管制度及条款', rows: MASTER.CLAUSES.length },
    ];
    SHEETS.forEach((s) => { if (s.on === undefined) s.on = true; });

    const sheetPanel = h('div', { class: 'panel' },
      h('div', { class: 'panel-head' }, h('h3', {}, '底稿工作表'),
        h('span', { class: 'sub' }, `${SHEETS.length} 个工作表 · 通过债项唯一标识在不同工作表间关联`),
        h('div', { class: 'spacer' }),
        h('div', { class: 'btn-group' },
          h('button', { class: 'btn sm', onclick: () => { SHEETS.forEach((s) => { if (!s.fixed) s.on = true; }); renderSheets(); } }, '全选'),
          h('button', { class: 'btn sm', onclick: () => { SHEETS.forEach((s) => { if (!s.fixed) s.on = false; }); renderSheets(); } }, '全不选'))),
      h('div', { class: 'panel-body' }));
    function renderSheets() {
      const b = sheetPanel.querySelector('.panel-body');
      b.innerHTML = '';
      b.appendChild(h('div', { class: 'grid c3' }, SHEETS.map((s) => h('div', { class: 'fblock' },
        h('label', { class: 'checkline', style: { marginBottom: '5px' } },
          (() => {
            const cb = h('input', { type: 'checkbox', checked: s.on, disabled: s.fixed });
            cb.onchange = () => { s.on = cb.checked; };
            return cb;
          })(),
          h('span', { class: 'fname' }, s.name),
          s.fixed ? h('span', { class: 'tag brand' }, '必需') : null),
        h('div', { class: 'fmean', style: { fontSize: '11px' } }, s.desc),
        h('div', { class: 'fmeta' }, h('span', {}, `约 ${s.rows} 行`))))));
    }
    renderSheets();
    root.appendChild(sheetPanel);

    /* 底稿预览 */
    root.appendChild(panel('底稿内容预览', { sub: '各工作表的关键列与示例数据' },
      h('div', { class: 'table-wrap' },
        h('table', { class: 'tbl' },
          h('thead', {}, h('tr', {}, ['工作表', '关键列', '示例（第 1 条记录）'].map((t) => h('th', {}, t)))),
          h('tbody', {}, [
            ['ReadMe', '项目 / 内容', `批次编号 ${batch.id}；基准日 ${batch.baseDate}；监管版本 ${batch.version}`],
            ['原始债项数据', '债项编号、客户号、产品代码、账面余额、抵押品类型、逾期天数', `${results[0].loanId} · ${results[0].raw.productCode} · ${results[0].raw.balance}`],
            ['字段映射', '标准字段、来源系统、来源字段、转换方式、命中率', '债项余额 ← LOAN_BAL（数值转换）'],
            ['暴露分类结果', '债项编号、暴露大类、暴露子类、命中规则、规则路径', `${results[0].loanId} · ${results[0].exposureClass} · ${results[0].matchedRule}`],
            ['EAD计算明细', '债项编号、业务性质、计算步骤、输入值、EAD', `${results[0].loanId} · ${results[0].stages.ead.result ? results[0].stages.ead.result.kind : '—'} · ${fmtNum(results[0].ead)}`],
            ['RWA计算明细', '债项编号、EAD、风险权重、权重确定方式、RWA', `${results[0].loanId} · ${pct2(results[0].riskWeight)} · ${fmtNum(results[0].rwa)}`],
            ['规则执行轨迹', '债项编号、层级、规则名称、判断条件、实际值、判断结果', `${results[0].loanId} · L1 · ${results[0].matchedRule}`],
            ['异常及调整记录', '债项编号、异常类型、异常环节、具体问题、处理状态', `${results.filter(r => r.status !== 'ok').length} 条异常记录`],
            ['监管依据', '条款编号、制度名称、条款原文、被引用规则', `CL-MO-030 等 ${MASTER.CLAUSES.length} 条模拟条款`],
          ].map(([a, b, c]) => h('tr', {}, h('td', {}, h('span', { class: 'tag brand' }, a)),
            h('td', { class: 'dim' }, b), h('td', { class: 'mono', style: { fontSize: '11px' } }, c)))))),
      notice('info',
        '对于无法在 Excel 中完整展示的详细规则执行过程，底稿在「规则执行轨迹」工作表中提供债项唯一标识与关键节点摘要，' +
        '并支持单独导出该笔的 Markdown 规则执行记录作为附件。', '关于详细执行过程：')));

    /* 导出操作 */
    const opts = { detailLevel: 'full' };
    const levelSeg = h('div', { class: 'seg' },
      h('button', { class: 'active', onclick: (e) => {
        [...e.target.parentNode.children].forEach((c) => c.classList.remove('active'));
        e.target.classList.add('active'); opts.detailLevel = 'full';
      } }, '完整轨迹'),
      h('button', { onclick: (e) => {
        [...e.target.parentNode.children].forEach((c) => c.classList.remove('active'));
        e.target.classList.add('active'); opts.detailLevel = 'summary';
      } }, '仅关键节点'));

    root.appendChild(panel('导出审计底稿', { sub: '生成真实的 .xlsx 文件' },
      h('div', { class: 'inline-fields', style: { marginBottom: '14px' } },
        h('div', { class: 'field' }, h('label', {}, '规则执行轨迹详细程度'), levelSeg,
          h('div', { class: 'hint' }, '完整轨迹会导出每个判断节点的输入值与结果；仅关键节点只导出命中路径。')),
        h('div', { class: 'field' }, h('label', {}, '文件名'),
          (() => {
            const i = h('input', { type: 'text', value: `${batch.id}_审计底稿.xlsx`, style: { width: '320px' } });
            i.oninput = () => { opts.filename = i.value; };
            opts.filename = i.value;
            return i;
          })())),
      h('div', { class: 'grid c4', style: { marginBottom: '14px' } },
        UI.kpi('底稿工作表', String(SHEETS.filter((s) => s.on).length), '已选中的工作表', { accent: true }),
        UI.kpi('逐笔记录', String(results.length), '每笔保留唯一标识'),
        UI.kpi('规则轨迹行数', String(results.reduce((s, r) => s + countTrace(r), 0)), '跨工作表可关联'),
        UI.kpi('第二份附件', 'Markdown', '规则执行记录可单独导出', { sm: true })),
      h('div', { class: 'btn-group' },
        h('button', { class: 'btn primary', onclick: () => doExport(opts) }, '⤓ 导出 Excel 审计底稿'),
        h('button', { class: 'btn', onclick: () => exportMarkdownZip() }, '⤓ 导出全部 Markdown 记录'),
        h('button', { class: 'btn', onclick: () => previewReadme() }, '预览 ReadMe 内容')),
      notice('warn',
        '本原型生成的 Excel 为真实文件，可直接打开。但其中的业务数据、监管条款与计算结果均为模拟数据，' +
        '不得作为真实审计底稿使用。', '模拟数据声明：')));

    /* ---------------- 构建各工作表数据 ---------------- */
    function countTrace(r) {
      let n = 0;
      const walk = (ns) => (ns || []).forEach((t) => { n++; if (t.children) walk(t.children); });
      walk(r.stages.classify.trace);
      return n;
    }

    function buildReadmeSheet() {
      const rows = [
        ['银行资本充足率审计系统 · 计量底稿', ''],
        ['', ''],
        ['【重要声明】', '本底稿中的业务数据、监管规则、条款原文及计算结果均为【模拟数据】，仅用于系统原型演示，不得作为真实审计底稿或监管报送依据。'],
        ['', ''],
        ['一、计量范围', ''],
        ['计量批次编号', batch.id],
        ['计量批次名称', batch.name],
        ['银行/机构', batch.institution],
        ['司法管辖区', App.j2label(batch.jurisdiction)],
        ['监管规则版本', batch.version],
        ['规则集标识', fp.rulesetId],
        ['规则集内容指纹', fp.hash],
        ['规则节点总数', String(fp.nodes)],
        ['规则指纹固化时间', fp.frozenAt],
        ['计量基准日', batch.baseDate],
        ['底稿生成时间', new Date().toISOString().replace('T', ' ').slice(0, 19)],
        ['', ''],
        ['二、计量结果汇总', ''],
        ['导入债项数量', String(batch.imported)],
        ['成功计量数量', String(batch.success)],
        ['异常数量', String(batch.exception)],
        ['表内 EAD 合计', summary.onEad],
        ['表外 EAD 合计', summary.offEad],
        ['EAD 合计', summary.ead],
        ['信用风险 RWA 合计', summary.rwa],
        ['平均风险权重（RWA/EAD）', summary.rwaRate],
        ['', ''],
        ['三、计量方法与口径', ''],
        ['计量方法', '信用风险标准法（权重法）'],
        ['计量链路', '原始数据 → 标准字段 → 规则判断 → 暴露分类 → EAD 计算 → 风险权重 → RWA 结果 → 监管依据'],
        ['暴露分类', '依据产品标准字段与监管版本下配置的暴露分类规则，逐笔执行规则路由，确定暴露大类及子类'],
        ['EAD 计算', '表内 EAD = 账面余额 − 减值准备；表外 EAD = 表内已提用金额 + 表外未提用金额 × 信用转换系数'],
        ['RWA 计算', 'RWA = 适用的信用风险暴露金额 × 适用风险权重。该简化公式仅适用于标准法下的对应情形，其他计量方法以对应监管规则为准。'],
        ['计算精度', '2 位小数，四舍五入'],
        ['', ''],
        ['四、工作表说明', ''],
        ['原始债项数据', '导入的原始数据，保留源系统字段原貌，未做标准化'],
        ['字段映射', '源系统字段与产品标准字段的映射关系、转换方式、命中率及异常情况'],
        ['暴露分类结果', '逐笔债项的暴露大类、暴露子类、命中规则及规则路径'],
        ['EAD计算明细', '逐笔债项的表内/表外 EAD 计算步骤与输入值'],
        ['RWA计算明细', '逐笔债项的风险权重、权重确定方式及 RWA 计算结果'],
        ['规则执行轨迹', '逐笔债项的规则命中路径，含每个判断节点的条件、实际值与判断结果'],
        ['异常及调整记录', '数据异常、未命中规则、字段缺失及人工调整情况'],
        ['监管依据', '本次计量所引用的监管制度与条款（模拟）'],
        ['', ''],
        ['五、使用说明', ''],
        ['债项唯一标识', '「债项编号」在各工作表间保持唯一且一致，可用于跨表关联与逐笔复核。'],
        ['规则可复现性', '本批次固化使用上述规则版本与内容指纹。规则更新后本底稿不会自动套用新规则，以保证审计结果可复现。'],
        ['附件', '对于无法在 Excel 中完整展示的详细规则执行过程，可单独导出对应债项的 Markdown 规则执行记录。'],
        ['', ''],
        ['六、异常处理', ''],
        ['异常债项', `本批次共 ${batch.exception} 笔异常或待复核债项，详见「异常及调整记录」工作表。`],
      ];
      return { name: 'ReadMe', freeze: 0,
        columns: [{ title: '项目', width: 26 }, { title: '内容', width: 100 }], rows };
    }

    function buildRawSheet() {
      const keys = [...new Set(results.flatMap((r) => Object.keys(r.raw || {})))];
      return {
        name: '原始债项数据', freeze: 1,
        columns: [
          { title: '债项编号', width: 12 }, { title: '客户编号', width: 12 },
          { title: '客户名称', width: 24 }, { title: '产品类型', width: 14 },
          ...keys.map((k) => ({ title: k, width: Math.max(12, Math.min(k.length + 4, 22)) })),
        ],
        rows: results.map((r) => [
          r.loanId, r.customer, r.name, V.productLabel(r.product),
          ...keys.map((k) => (r.raw[k] === '' || r.raw[k] == null ? '' : r.raw[k])),
        ]),
      };
    }

    function buildMappingSheet() {
      const rows = [];
      Object.entries(MASTER.FIELD_MAPPINGS).forEach(([pcode, maps]) => {
        maps.forEach((m) => rows.push([
          V.productLabel(pcode), m.stdField, m.stdCode || '', m.srcSystem, m.srcField, m.via,
          m.hitRate, m.status === 'ok' ? '正常' : m.status === 'warn' ? '需确认' : '源字段缺失',
          m.sample || '',
        ]));
      });
      // 补充未映射字段
      Object.entries(MASTER.PRODUCT_FIELDS).forEach(([pcode, fields]) => {
        const mapped = new Set((MASTER.FIELD_MAPPINGS[pcode] || []).map((m) => m.stdField));
        fields.filter((f) => !mapped.has(f.name)).forEach((f) => rows.push([
          V.productLabel(pcode), f.name, f.stdField || '', '（未建立映射）', '—', '—', 0,
          f.required ? '必填字段未映射' : '选填字段未映射', '引用该字段的规则条件不会命中',
        ]));
      });
      return {
        name: '字段映射', freeze: 1,
        columns: [
          { title: '产品类型', width: 14 }, { title: '标准字段', width: 20 }, { title: '规则字段 name', width: 22 },
          { title: '来源系统', width: 18 }, { title: '来源系统字段', width: 26 }, { title: '转换方式', width: 34 },
          { title: '命中率', width: 10 }, { title: '状态', width: 16 }, { title: '转换示例 / 异常说明', width: 34 },
        ],
        rows,
      };
    }

    function buildClassifySheet() {
      return {
        name: '暴露分类结果', freeze: 1,
        columns: [
          { title: '债项编号', width: 12 }, { title: '客户编号', width: 12 }, { title: '产品类型', width: 14 },
          { title: '暴露大类', width: 20 }, { title: '暴露子类', width: 30 },
          { title: '命中规则编号', width: 18 }, { title: '命中规则名称', width: 26 },
          { title: '规则路径', width: 30 }, { title: '风险权重', width: 11 },
          { title: '权重确定方式', width: 18 }, { title: '判断节点数', width: 11 },
          { title: '监管条款', width: 22 }, { title: '分类状态', width: 12 },
        ],
        rows: results.map((r) => [
          r.loanId, r.customer, V.productLabel(r.product),
          r.exposureClass || '未分类', r.exposureSubClass || '',
          r.matchedRule || '', r.stages.classify.result ? r.stages.classify.result.ruleLabel : '',
          r.matchedPath || '',
          r.riskWeight == null ? '' : r.riskWeight,
          r.weightTrace && r.weightTrace[0]
            ? ({ const: '规则直接给定', same_as: '按交易对手取权重', greater_of: '取大者 greater_of' })[r.weightTrace[0].kind] : '',
          countTrace(r),
          r.reference ? `${r.reference.clause || ''} ${r.reference.doc || ''}`.trim() : '',
          r.stages.classify.status === 'ok' ? '正常' : r.stages.classify.status === 'exception' ? '异常' : '未执行',
        ]),
      };
    }

    function buildEadSheet() {
      const rows = [];
      results.forEach((r) => {
        const ead = r.stages.ead.result;
        if (!ead) {
          rows.push([r.loanId, V.productLabel(r.product), '未执行', '', '', '', '', '', '', '']);
          return;
        }
        ead.steps.forEach((s) => {
          rows.push([
            r.loanId, V.productLabel(r.product),
            ead.kind === 'off' ? '表外' : '表内',
            ead.ruleId || '', ead.ruleName, ead.formula,
            s.n, s.label, s.expr, s.value,
          ]);
        });
        // 汇总行
        rows.push([r.loanId, V.productLabel(r.product), ead.kind === 'off' ? '表外' : '表内',
          ead.ruleId || '', ead.ruleName, ead.formula, '合计', '合计 EAD', '', ead.ead]);
        rows.push([r.loanId, V.productLabel(r.product), ead.kind === 'off' ? '表外' : '表内',
          ead.ruleId || '', ead.ruleName, ead.formula, '拆分', '表内 EAD', '', ead.onEad]);
        rows.push([r.loanId, V.productLabel(r.product), ead.kind === 'off' ? '表外' : '表内',
          ead.ruleId || '', ead.ruleName, ead.formula, '拆分', '表外 EAD', '', ead.offEad]);
      });
      return {
        name: 'EAD计算明细', freeze: 1,
        columns: [
          { title: '债项编号', width: 12 }, { title: '产品类型', width: 14 }, { title: '业务性质', width: 10 },
          { title: '规则编号', width: 14 }, { title: '计算规则名称', width: 32 }, { title: '计算公式', width: 42 },
          { title: '步骤', width: 8 }, { title: '计算项', width: 26 }, { title: '表达式', width: 30 },
          { title: '数值', width: 18 },
        ],
        rows,
      };
    }

    function buildRwaSheet() {
      return {
        name: 'RWA计算明细', freeze: 1,
        columns: [
          { title: '债项编号', width: 12 }, { title: '产品类型', width: 14 },
          { title: '暴露大类', width: 20 }, { title: '暴露子类', width: 30 },
          { title: 'EAD', width: 18 }, { title: '风险权重', width: 11 },
          { title: '权重确定方式', width: 20 }, { title: '权重解析结果', width: 60 },
          { title: '计算公式', width: 34 }, { title: '信用风险 RWA', width: 18 },
          { title: '监管条款', width: 22 },
        ],
        rows: results.map((r) => [
          r.loanId, V.productLabel(r.product), r.exposureClass || '', r.exposureSubClass || '',
          r.ead, r.riskWeight == null ? '' : r.riskWeight,
          r.weightTrace && r.weightTrace[0]
            ? ({ const: '规则直接给定', same_as: '按交易对手取权重', greater_of: '取大者 greater_of' })[r.weightTrace[0].kind] : '',
          (r.weightTrace || []).map((t) => t.note || (t.kind === 'same_as' ? `same_as:${t.same_as} → ${pct2(t.resolved)}` : `${pct2(t.resolved)}`)).join('；'),
          r.rwa == null ? '' : `${fmtNum(r.ead)} × ${pct2(r.riskWeight)}`,
          r.rwa,
          r.reference ? (r.reference.clause || '') : '',
        ]),
      };
    }

    function buildTraceSheet() {
      const rows = [];
      results.forEach((r) => {
        const walk = (nodes, depth, parentLabel) => {
          (nodes || []).forEach((t) => {
            // 完整模式：每个节点一行；摘要模式：只导命中节点
            const isHit = t.status === 'matched';
            if (opts.detailLevel === 'full' || isHit) {
              rows.push([
                r.loanId, depth + 1, parentLabel || '顶层', t.index != null ? t.index + 1 : '',
                t.name, t.label,
                t.status === 'matched' ? '命中' : t.status === 'skipped' ? '跳过' : t.status === 'not-matched' ? '未命中' : t.status,
                (t.condition && t.condition.kind) || '',
                condSummary(t), t.skipReason || t.exhaustReason || '',
                t.outcome ? (typeof t.outcome.riskWeight === 'number' ? t.outcome.riskWeight : '') : '',
                t.outcome ? t.outcome.subClass : '',
              ]);
            }
            if (t.children) walk(t.children, depth + 1, t.label);
          });
        };
        walk(r.stages.classify.trace, 0, null);
      });
      return {
        name: '规则执行轨迹', freeze: 1,
        columns: [
          { title: '债项编号', width: 12 }, { title: '层级', width: 7 }, { title: '上级规则', width: 22 },
          { title: '本层顺序', width: 10 }, { title: '规则 name', width: 26 }, { title: '规则名称', width: 28 },
          { title: '判断结果', width: 10 }, { title: '条件组合', width: 10 },
          { title: '判断条件与实际值', width: 80 }, { title: '跳过/退回原因', width: 40 },
          { title: '产出权重', width: 11 }, { title: '产出暴露子类', width: 30 },
        ],
        rows,
      };
    }

    function condSummary(t) {
      if (!t.condition || !t.condition.items) return '';
      const parts = [];
      const walkItems = (items, kind) => {
        items.forEach((it) => {
          if (it.nested) {
            const sub = [];
            (it.items || []).forEach((s2) => {
              if (s2.nested) return;
              sub.push(condOne(s2));
            });
            parts.push(`[${it.kind === 'all' ? '且' : '或'}] ${sub.join(' ')}`);
          } else {
            parts.push(condOne(it));
          }
        });
      };
      walkItems(t.condition.items, t.condition.kind);
      return parts.join(' ');
    }
    function condOne(it) {
      if (!it || it.field == null) return '';
      const fv = it.actual === undefined ? '（未填）'
        : typeof it.actual === 'number' ? it.actual : UI.codeLabel(it.actual);
      const want = Array.isArray(it.match) ? it.match.map(UI.codeLabel).join('/')
        : typeof it.match === 'number' ? it.match : UI.codeLabel(it.match);
      const mark = it.missing ? '⚠缺失' : it.ok ? '✓' : '✕';
      return `${mark} ${UI.label(it.field)} ${UI.OP_LABELS[it.op] || it.op} ${want}（实际 ${fv}）`;
    }

    function buildExcSheet() {
      const rows = results.filter((r) => r.status !== 'ok').map((r) => {
        const stage = r.status === 'exception'
          ? (r.stages.classify.status === 'exception' ? '暴露分类' : r.stages.ead.status === 'exception' ? 'EAD 计算' : '风险权重确定')
          : '数据质量';
        return [
          r.loanId, r.name, V.productLabel(r.product), stage,
          r.status === 'exception' ? '异常' : '待复核',
          (r.exceptions || []).map((e) => e.text).join('；'),
          (r.exceptions || []).some((e) => /未填|缺失/.test(e.text)) ? '补充源数据后重新计量' : '人工确认后处理',
          Object.keys(Store.state.overrides || {}).includes(r.loanId)
            ? `产品类型人工调整为 ${V.productLabel(Store.state.overrides[r.loanId])}` : '无人工调整',
        ];
      });
      // 补上总体统计
      rows.unshift(['（统计）', `共 ${results.length} 笔债项`, '', '', '',
        `异常 ${summary.exception} 笔，待复核 ${summary.warning} 笔，正常 ${summary.ok} 笔`, '', '']);
      return {
        name: '异常及调整记录', freeze: 1,
        columns: [
          { title: '债项编号', width: 12 }, { title: '客户名称', width: 24 }, { title: '产品类型', width: 14 },
          { title: '异常环节', width: 16 }, { title: '级别', width: 10 }, { title: '具体问题', width: 78 },
          { title: '建议处理方式', width: 26 }, { title: '人工调整记录', width: 30 },
        ],
        rows,
      };
    }

    function buildClauseSheet() {
      return {
        name: '监管依据', freeze: 1,
        columns: [
          { title: '条款编号', width: 12 }, { title: '条款标题', width: 24 },
          { title: '司法管辖区', width: 12 }, { title: '制度名称', width: 34 },
          { title: '制度版本', width: 12 }, { title: '适用业务范围', width: 34 },
          { title: '生效日期', width: 13 }, { title: '来源文件', width: 34 },
          { title: '条款原文（模拟）', width: 90 }, { title: '被引用规则', width: 60 },
        ],
        rows: MASTER.CLAUSES.map((c) => [
          c.clause, c.title, App.j2label(c.jurisdiction), c.doc, c.docVersion, c.scope,
          c.effectiveFrom, c.source, c.text, (c.referencedBy || []).join('、'),
        ]),
      };
    }

    function buildSheets() {
      const builders = {
        readme: buildReadmeSheet, raw: buildRawSheet, mapping: buildMappingSheet,
        classify: buildClassifySheet, ead: buildEadSheet, rwa: buildRwaSheet,
        trace: buildTraceSheet, exc: buildExcSheet, clause: buildClauseSheet,
      };
      return SHEETS.filter((s) => s.on).map((s) => builders[s.key]());
    }

    function previewReadme() {
      const sh = buildReadmeSheet();
      UI.openDrawer({
        title: 'ReadMe 工作表内容预览',
        body: h('div', {},
          notice('info', '以下为 ReadMe 工作表的实际内容，导出时会完整写入 Excel。', '预览：'),
          h('div', { class: 'table-wrap' },
            h('table', { class: 'tbl compact' },
              h('thead', {}, h('tr', {}, ['项目', '内容'].map((t) => h('th', {}, t)))),
              h('tbody', {}, sh.rows.map((r) => h('tr', {},
                h('td', { style: { fontWeight: '600', width: '200px' } }, r[0]),
                h('td', { style: { fontSize: '11.5px', lineHeight: '1.6' } }, String(r[1] === '' ? '' : r[1])))))))),
      });
    }

    function doExport(o) {
      try {
        const sheets = buildSheets();
        const bytes = window.XlsxWriter.writeXlsx(sheets);
        const blob = new Blob([bytes], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        });
        const name = o.filename || `${batch.id}_审计底稿.xlsx`;
        UI.downloadBlob(blob, name);
        toast(`已导出审计底稿：${name}（${sheets.length} 个工作表，${(bytes.length / 1024).toFixed(1)} KB）`, 'ok', 4200);
      } catch (e) {
        console.error(e);
        toast('导出失败：' + e.message, 'err');
      }
    }

    function exportMarkdownZip() {
      const ctx = () => ({
        ...Store.state.ctx, version: batch.version, fingerprint: fp,
        overrides: Store.state.overrides, baseDate: batch.baseDate, jurisdiction: batch.jurisdiction,
      });
      const all = results.map((r) => `<!-- ${r.loanId} -->\n\n` + V.buildMarkdown(r, ctx())).join('\n\n---\n\n');
      const header = `# 规则执行记录汇总\n\n批次：${batch.id}（${batch.name}）\n计量基准日：${batch.baseDate}\n` +
        `监管版本：${batch.version}\n规则集指纹：${fp.hash}\n\n` +
        `> 【模拟数据】由银行资本充足率审计系统原型生成，监管条款与权重数值均为虚构。\n\n---\n\n`;
      UI.downloadBlob(new Blob([header + all], { type: 'text/markdown;charset=utf-8' }),
        `${batch.id}_规则执行记录汇总.md`);
      toast(`已导出 ${results.length} 笔债项的 Markdown 规则执行记录`, 'ok');
    }
  });
})();
