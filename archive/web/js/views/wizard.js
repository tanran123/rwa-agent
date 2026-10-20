/** 模块五：信用风险 RWA 计量向导（七步） */
(function () {
  const { h, panel, tag, notice, makeTable, openDrawer, openModal, toast, kv,
          statusTag, pct2, fmtNum, fmtShort, confirmDialog, condRow } = UI;
  const V = window.Views;

  const STEPS = [
    { id: 1, label: '选择计量范围' },
    { id: 2, label: '导入 Excel 债项明细' },
    { id: 3, label: '识别产品类型' },
    { id: 4, label: '字段映射确认' },
    { id: 5, label: '执行暴露分类' },
    { id: 6, label: '执行 EAD 计算' },
    { id: 7, label: '确定风险权重并计算 RWA' },
    { id: 8, label: '查看计量结果及审计证据' },
  ];

  App.register('wizard', (root) => {
    App.setHeader('信用风险 RWA 计量向导', '分步骤完成从计量范围选择、数据导入到计量结果查看的全过程');

    const W = {
      step: 1,
      scope: {
        jurisdiction: Store.state.ctx.jurisdiction,
        versionId: Store.state.ctx.versionId,
        baseDate: Store.state.ctx.baseDate,
        institution: Store.state.ctx.institution,
        batchName: '2026年9月' + Store.state.ctx.institution + '信用风险计量',
      },
      imported: null,      // 导入结果
      products: null,      // 产品识别结果
      measured: null,      // 计量结果
      done: {},            // 各步骤是否已完成
      sheet: 'term-Loan',
      headerRow: 14,
    };

    const stepsBar = h('div', { class: 'steps' });
    const bodyEl = h('div');

    function renderSteps() {
      stepsBar.innerHTML = '';
      STEPS.forEach((s, i) => {
        const done = W.done[s.id];
        const cls = ['step'];
        if (W.step === s.id) cls.push('active');
        else if (done) cls.push('done');
        stepsBar.appendChild(h('div', {
          class: cls.join(' '),
          onclick: () => { if (s.id <= maxReachable()) { W.step = s.id; render(); } else toast('请先完成前面的步骤', 'warn'); },
        }, h('span', { class: 'sn' }, done && W.step !== s.id ? '✓' : String(s.id)), h('span', {}, s.label)));
        if (i < STEPS.length - 1) stepsBar.appendChild(h('span', { class: 'step-arrow' }, '›'));
      });
    }

    function maxReachable() {
      let m = 1;
      for (let i = 1; i <= 8; i++) { if (W.done[i]) m = i + 1; }
      return Math.min(m, 8);
    }

    function render() {
      renderSteps();
      bodyEl.innerHTML = '';
      const fn = [null, step1, step2, step3, step4, step5, step6, step7, step8][W.step];
      fn();
    }

    root.innerHTML = '';
    root.appendChild(panel('计量向导', { sub: '每一步的处理进度、成功数量与异常数量都会实时反映' }, stepsBar));
    root.appendChild(bodyEl);
    render();

    /* ---------------- 第一步：选择计量范围 ---------------- */
    function step1() {
      const jurs = MASTER.JURISDICTIONS;
      const jurSel = h('select', {}, jurs.map((j) => h('option', { value: j.code, selected: j.code === W.scope.jurisdiction }, `${j.label} · ${j.regulator}`)));
      const verSel = h('select', {});
      const instSel = h('select', {}, ['澳门分行', '总行（法人）', '香港分行'].map((i) => h('option', { value: i, selected: i === W.scope.institution }, i)));
      const dateInp = h('input', { type: 'date', value: W.scope.baseDate });
      const nameInp = h('input', { type: 'text', value: W.scope.batchName });

      function fillVersions() {
        verSel.innerHTML = '';
        MASTER.RULE_VERSIONS.filter((v) => v.jurisdiction === W.scope.jurisdiction)
          .forEach((v) => verSel.appendChild(h('option', { value: v.id, selected: v.id === W.scope.versionId },
            `${v.version} — ${v.name}（${MASTER.RULE_STATUS[v.status].label}）`)));
      }
      fillVersions();
      jurSel.onchange = () => {
        W.scope.jurisdiction = jurSel.value;
        const pub = MASTER.RULE_VERSIONS.find((v) => v.jurisdiction === jurSel.value && v.status === 'published');
        W.scope.versionId = pub ? pub.id : MASTER.RULE_VERSIONS.find((v) => v.jurisdiction === jurSel.value).id;
        fillVersions();
        refreshSummary();
      };
      verSel.onchange = () => { W.scope.versionId = verSel.value; refreshSummary(); };
      instSel.onchange = () => { W.scope.institution = instSel.value; nameInp.value = `2026年9月${instSel.value}信用风险计量`; refreshSummary(); };
      dateInp.onchange = () => { W.scope.baseDate = dateInp.value; refreshSummary(); };
      nameInp.oninput = () => { W.scope.batchName = nameInp.value; };

      const summary = h('div');
      function refreshSummary() {
        summary.innerHTML = '';
        const ver = MASTER.RULE_VERSIONS.find((v) => v.id === W.scope.versionId);
        const loadOk = !!Store.state.rulesets[W.scope.jurisdiction];
        if (!loadOk) {
          summary.appendChild(notice('warn', `尚未加载 ${App.j2label(W.scope.jurisdiction)} 的规则集。点击下方「加载规则配置」按钮。`, '提示：'));
        }
        summary.appendChild(h('div', { class: 'grid c4' },
          UI.kpi('司法管辖区', App.j2label(W.scope.jurisdiction), (MASTER.JURISDICTIONS.find(j => j.code === W.scope.jurisdiction) || {}).regulator, { accent: true, sm: true }),
          UI.kpi('监管规则版本', ver ? ver.version : '—', ver ? MASTER.RULE_STATUS[ver.status].label + ' · 生效 ' + ver.effectiveFrom : '', { sm: true }),
          UI.kpi('计量基准日', W.scope.baseDate, '汇率与期限均以该日为基准', { sm: true }),
          UI.kpi('规则加载状态', loadOk ? '已加载' : '未加载', loadOk ? `规则节点 ${Store.countNodes(Store.state.rulesets[W.scope.jurisdiction].resolves_to)} 个` : '需先加载', { sm: true })));
        let rs = null;
        if (loadOk) {
          rs = Store.state.rulesets[W.scope.jurisdiction].resolves_to;
          summary.appendChild(notice('ok',
            `系统已根据所选版本加载对应的产品字段（${(rs.fields || []).length} 个）、暴露分类规则（${Store.countNodes(rs)} 个节点）` +
            `及 EAD 计算规则（表内 ${MASTER.EAD_ON_RULES.length} 条、表外 ${MASTER.EAD_OFF_RULES.length} 条）。`, '规则范围已确定：'));
        }
        summary.appendChild(h('div', { class: 'btn-group' },
          loadOk
            ? h('button', { class: 'btn primary', onclick: () => { applyScope('计量范围已确认'); W.done[1] = true; W.step = 2; render(); } }, '确认范围，下一步 →')
            : h('button', { class: 'btn primary', onclick: async () => {
                try { await Store.loadRuleset(W.scope.jurisdiction); toast(`已加载 ${App.j2label(W.scope.jurisdiction)} 规则配置`, 'ok'); refreshSummary(); }
                catch (e) { toast('加载失败：' + e.message, 'err'); }
              } }, '加载规则配置')));
      }

      /** 把当前选择写回计量上下文。定义在 refreshSummary 之外，
          否则按钮的 onclick 闭包引用不到它（会抛 applyScope is not defined）。 */
      function applyScope(msg) {
        Store.state.ctx.jurisdiction = W.scope.jurisdiction;
        Store.state.ctx.versionId = W.scope.versionId;
        Store.state.ctx.baseDate = W.scope.baseDate;
        Store.state.ctx.institution = W.scope.institution;
        Store.state.ctx.batchName = W.scope.batchName;
        Store.persist();
        App.renderTopbar();
        toast(msg, 'ok');
      }

      refreshSummary();

      bodyEl.appendChild(panel('第一步：选择计量范围', { sub: '系统根据所选版本加载对应的产品字段、暴露分类规则及 EAD 计算规则' },
        h('div', { class: 'grid c2' },
          h('div', { class: 'field' }, h('label', {}, '司法管辖区'), jurSel),
          h('div', { class: 'field' }, h('label', {}, '监管规则版本'), verSel),
          h('div', { class: 'field' }, h('label', {}, '计量基准日'), dateInp),
          h('div', { class: 'field' }, h('label', {}, '银行或机构'), instSel),
          h('div', { class: 'field', style: { gridColumn: '1 / -1' } }, h('label', {}, '计量批次名称'), nameInp)),
        notice('info', '规则版本决定本次计量适用的全部规则。计量的规则版本会被固化记录在批次中 —— 规则更新后，历史批次不会自动套用新规则。', '版本固化：'),
        summary));
    }

    /* ---------------- 第二步：导入 Excel ---------------- */
    function step2() {
      const sheets = ['term-Loan', 'Bonds', 'Mortgage', '212 222 存放同业', '額度詳情表'];
      const sheetSel = h('select', {}, sheets.map((s) => h('option', { value: s, selected: s === W.sheet }, s)));
      sheetSel.onchange = () => { W.sheet = sheetSel.value; renderImport(); };

      const importBox = h('div');
      function renderImport() {
        importBox.innerHTML = '';
        if (!W.imported) {
          importBox.appendChild(notice('warn',
            '原型使用内置的模拟债项数据演示导入效果，未实现真实的 Excel 文件解析。' +
            '下方展示了表头识别、数据区域识别与原始数据预览的完整交互。', '模拟导入声明：'));
          importBox.appendChild(h('div', { class: 'grid c2' },
            h('div', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h3', {}, '选择工作表')),
              h('div', { class: 'panel-body' },
                h('div', { class: 'field' }, h('label', {}, '工作表'), sheetSel),
                h('div', { class: 'field' }, h('label', {}, '表头所在行'), (() => {
                  const i = h('input', { type: 'number', value: W.headerRow });
                  i.oninput = () => { W.headerRow = Number(i.value); renderImport(); }; return i;
                })()),
                h('div', { class: 'hint' }, `已识别表头 ${window.MOCK.RAW_SHEET_HEADERS.length} 列，数据区域从第 ${W.headerRow + 1} 行开始。`))),
            h('div', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h3', {}, '上传文件')),
              h('div', { class: 'panel-body' },
                h('div', {
                  style: {
                    border: '2px dashed var(--line)', borderRadius: '8px', padding: '26px',
                    textAlign: 'center', color: 'var(--ink-3)', cursor: 'pointer', background: 'var(--panel-2)',
                  },
                  onclick: () => {
                    const inp = h('input', { type: 'file', accept: '.xlsx,.xls,.csv' });
                    inp.onchange = () => {
                      const f = inp.files && inp.files[0];
                      toast(f ? `已选择「${f.name}」。原型不解析真实文件，将加载内置模拟数据。` : '未选择文件', f ? 'ok' : 'warn');
                      doImport(f ? f.name : '模拟数据');
                    };
                    inp.click();
                  },
                },
                  h('div', { style: { fontSize: '26px', opacity: '.4' } }, '⇪'),
                  h('div', { style: { marginTop: '7px' } }, '点击选择 Excel 文件，或直接加载内置模拟数据'),
                  h('div', { class: 'dim', style: { fontSize: '11px', marginTop: '4px' } }, '支持 .xlsx / .xls / .csv'))),
                h('div', { class: 'btn-group', style: { marginTop: '10px' } },
                  h('button', { class: 'btn primary', onclick: () => doImport('内置模拟数据') }, '加载模拟债项数据'),
                  h('button', { class: 'btn ghost', onclick: () => toast('真实 Excel 解析需引入 SheetJS 等库，原型未实现', 'warn') }, '了解限制')))));
          // 表头预览
          const ht = h('div', { class: 'panel' },
            h('div', { class: 'panel-head' }, h('h3', {}, '已识别的表头'), h('span', { class: 'sub' }, `${window.MOCK.RAW_SHEET_HEADERS.length} 列`)),
            h('div', { class: 'panel-body tight' }, h('div', { class: 'table-wrap' },
              h('table', { class: 'tbl compact' },
                h('thead', {}, h('tr', {}, window.MOCK.RAW_SHEET_HEADERS.map((c) => h('th', {}, c)))),
                h('tbody', {}, [0, 1, 2].map((r) => h('tr', {}, window.MOCK.RAW_SHEET_HEADERS.map((c, i) => {
                  const loans = window.MOCK.MOCK_LOANS;
                  const l = loans[r % loans.length];
                  const vals = Object.values(l.raw || {});
                  return h('td', { class: 'mono', style: { fontSize: '11px' } }, String(vals[i % Math.max(vals.length, 1)] || ''));
                }))))))));
          importBox.appendChild(ht);
          return;
        }

        /* 导入完成 */
        const imp = W.imported;
        importBox.appendChild(notice('ok',
          `已从「${imp.sheet}」读取 ${imp.rows} 行原始债项数据，表头 ${imp.cols} 列。` +
          `模拟导入：本原型不解析真实 Excel 文件，使用的是内置模拟债项数据。`, '导入完成：'));
        importBox.appendChild(h('div', { class: 'grid c4', style: { marginBottom: '14px' } },
          UI.kpi('导入总记录数', String(imp.rows), `工作表 ${imp.sheet}`, { accent: true }),
          UI.kpi('字段映射成功', String(imp.ok), `覆盖率 ${Math.round(imp.ok / imp.rows * 100)}%`),
          UI.kpi('必填字段缺失', String(imp.missing), imp.missing ? '需处理后才能继续' : '无缺失', { sm: true }),
          UI.kpi('待处理记录', String(imp.pending), imp.pending ? '将进入异常清单' : '无', { sm: true })));

        /* 原始数据预览 */
        const rawCols = ['GL A/C No.', 'Customer', 'Customer Name', 'Product Code', 'Currency Code',
          'Value Balance(MOP)', 'Cust Type', 'Collateral Type1', 'Overdue Days', 'Loan Class'];
        const rawRows = imp.loans.slice(0, 12).map((l) => ({
          id: l.id,
          'GL A/C No.': l.raw.glAcct, Customer: l.customer, 'Customer Name': l.name,
          'Product Code': l.raw.productCode, 'Currency Code': l.raw.ccy,
          'Value Balance(MOP)': fmtNum(l.raw.balance), 'Cust Type': l.raw.custType || '（空）',
          'Collateral Type1': l.raw.collateralType || '—', 'Overdue Days': l.raw.overdueDays,
          'Loan Class': l.raw.loanClass,
        }));
        const rawTbl = makeTable({
          columns: [{ key: 'id', title: '债项编号', cls: 'mono' },
            ...rawCols.map((c) => ({ key: c, title: c, num: c.includes('Balance') || c === 'Overdue Days' }))],
          rows: rawRows, pageSize: 12,
        });
        importBox.appendChild(panel('原始债项数据预览', { sub: `显示前 ${rawRows.length} 行 · 原始字段尚未标准化`, tight: true }, rawTbl.el));

        /* 标准字段映射结果 */
        const mapRows = imp.loans.slice(0, 10).map((l) => {
          const std = l.std || {};
          return {
            id: l.id,
            交易对手: std.counterparty_type ? UI.codeLabel(std.counterparty_type) : h('span', { class: 'tag danger' }, '缺失'),
            债项余额: std.balance != null ? fmtNum(std.balance) : '—',
            是否已违约: std.is_defaulted ? UI.codeLabel(std.is_defaulted) : '—',
            剩余期限: std.remaining_maturity_months != null ? std.remaining_maturity_months + ' 月' : '—',
            房地产抵押: std.has_property_collateral ? UI.codeLabel(std.has_property_collateral) : '—',
            贷款价值比: std.ltv != null ? pct2(std.ltv) : '—',
            _status: l.anomaly ? '问题' : '正常',
          };
        });
        const mapTbl = makeTable({
          columns: [
            { key: 'id', title: '债项编号', cls: 'mono' },
            { key: '交易对手', title: '交易对手' }, { key: '债项余额', title: '债项余额', num: true },
            { key: '是否已违约', title: '是否已违约' }, { key: '剩余期限', title: '剩余期限' },
            { key: '房地产抵押', title: '房地产抵押' }, { key: '贷款价值比', title: '贷款价值比', num: true },
            { key: '_status', title: '识别状态', html: (r) => r._status === '问题'
              ? '<span class="tag warn">字段缺失</span>' : '<span class="tag ok">正常</span>' },
          ],
          rows: mapRows, pageSize: 10,
        });
        importBox.appendChild(panel('原始字段 → 产品标准字段映射结果', {
          sub: '映射把 Excel 表头对到字段 name，单元格原文对到 code',
          tight: true,
          actions: h('button', { class: 'btn sm', onclick: () => App.go('mapping') }, '查看完整映射配置'),
        }, mapTbl.el));

        /* 异常清单 */
        const anomalies = imp.loans.filter((l) => l.anomaly);
        if (anomalies.length) {
          const at = h('div', { class: 'panel' },
            h('div', { class: 'panel-head' }, h('h3', {}, `识别出的异常数据（${anomalies.length}）`),
              h('span', { class: 'sub' }, '必填字段缺失或不符合数据标准')),
            h('div', { class: 'panel-body tight' }));
          at.querySelector('.panel-body').appendChild(h('div', { class: 'table-wrap' },
            h('table', { class: 'tbl compact' },
              h('thead', {}, h('tr', {}, ['债项编号', '客户', '异常类型', '具体问题', '处理方式'].map((t) => h('th', {}, t)))),
              h('tbody', {}, anomalies.map((l) => h('tr', {},
                h('td', { class: 'mono' }, l.id), h('td', {}, l.name),
                h('td', {}, h('span', { class: 'tag warn' }, l.anomaly)),
                h('td', { style: { fontSize: '11.5px' } }, l.anomalyDetail),
                h('td', {}, '继续计量，走到兜底或标记待复核')))))));
          importBox.appendChild(at);
        }

        importBox.appendChild(h('div', { class: 'btn-group' },
          h('button', { class: 'btn primary', onclick: () => { W.done[2] = true; W.step = 3; render(); } }, '下一步：识别产品类型 →'),
          h('button', { class: 'btn', onclick: () => { W.imported = null; renderImport(); } }, '重新导入')));
      }

      function doImport(name) {
        const loans = window.MOCK.MOCK_LOANS;
        W.imported = {
          sheet: W.sheet, rows: loans.length, cols: window.MOCK.RAW_SHEET_HEADERS.length,
          ok: loans.length - loans.filter((l) => l.anomaly).length,
          missing: loans.filter((l) => l.anomaly).length,
          pending: loans.filter((l) => l.anomaly).length,
          loans, source: name,
        };
        toast(`已导入 ${loans.length} 条债项记录（来源：${name}）`, 'ok');
        renderImport();
      }

      bodyEl.appendChild(panel('第二步：导入 Excel 债项明细', { sub: '选择工作表、识别表头及数据区域、预览原始数据、映射至产品标准字段' }, importBox));
      renderImport();
    }

    /* ---------------- 第三步：识别产品类型 ---------------- */
    function step3() {
      if (!W.products) detectAll();
      const box = h('div');

      function renderProducts() {
        box.innerHTML = '';
        const p = W.products;
        box.appendChild(notice('ok',
          `根据债项明细中的产品代码、业务类型及科目号，已自动识别 ${p.total} 笔债项的产品类型。` +
          `其中 ${p.confident} 笔依据充分，${p.uncertain} 笔依据较弱，${p.failed} 笔无法识别。`, '识别完成：'));
        box.appendChild(h('div', { class: 'grid c4', style: { marginBottom: '14px' } },
          UI.kpi('已识别', String(p.total), `覆盖率 ${Math.round(p.total / W.imported.rows * 100)}%`, { accent: true }),
          UI.kpi('依据充分', String(p.confident), '产品代码与产品类型匹配'),
          UI.kpi('无法识别', String(p.failed), p.failed ? '需人工指定产品类型' : '无', { sm: true }),
          UI.kpi('人工调整', String(Object.keys(Store.state.overrides).length), '用户在向导中修改的数量', { sm: true })));

        // 按产品汇总
        const byP = {};
        p.list.forEach((r) => { byP[r.product || '未识别'] = (byP[r.product || '未识别'] || 0) + 1; });
        box.appendChild(panel('产品类型识别结果分布',
          h('div', { class: 'grid c4' },
            Object.entries(byP).map(([code, cnt]) => {
              const pt = MASTER.PRODUCT_TYPES.find((x) => x.code === code);
              return UI.kpi(pt ? pt.label : '未识别', String(cnt) + ' 笔', pt ? pt.system : '需人工指定', { sm: true });
            }))));

        // 明细表
        const rows = p.list.map((r) => ({ ...r }));
        const cols = [
          { key: 'id', title: '债项编号', cls: 'mono' },
          { key: 'name', title: '客户名称' },
          { key: 'productCode', title: '产品代码', cls: 'mono' },
          { key: 'product', title: '识别结果', value: (r) => V.productLabel(r.product),
            html: (r) => r.product
              ? `<span class="tag ok">${V.productLabel(r.product)}</span>`
              : '<span class="tag danger">未识别</span>' },
          { key: 'confidence', title: '识别依据',
            html: (r) => `<span class="dim" style="font-size:11px">${UI.esc(r.basis)}</span>` },
          { key: 'overridden', title: '人工调整', value: (r) => (r.overridden ? '是' : '否'),
            html: (r) => r.overridden ? '<span class="tag warn">已调整</span>' : '<span class="tag muted">—</span>' },
          { key: '_act', title: '操作', sortable: false, html: (r) => `
            <div class="btn-group">
              <button class="btn xs" data-act="set" data-id="${r.id}">修改</button>
              <button class="btn xs" data-act="detail" data-id="${r.id}">依据</button>
            </div>` },
        ];
        const tbl = makeTable({ columns: cols, rows, pageSize: 15 });
        tbl.el.addEventListener('click', (e) => {
          const btn = e.target.closest('button[data-act]');
          if (!btn) return;
          const r = rows.find((x) => x.id === btn.dataset.id);
          if (btn.dataset.act === 'set') setProduct(r);
          if (btn.dataset.act === 'detail') {
            openDrawer({
              title: `识别依据 · ${r.id}`,
              body: h('div', {},
                kv([
                  ['债项编号', r.id], ['客户名称', r.name],
                  ['产品代码', { mono: true, node: h('code', {}, r.productCode || '—') }],
                  ['总账科目号', { mono: true, node: h('code', {}, r.glAcct || '—') }],
                  ['识别结果', r.product ? V.productLabel(r.product) : '未识别'],
                  ['识别依据', r.basis],
                  ['识别置信度', r.confidence === 'high' ? '高（产品代码直接匹配）' : r.confidence === 'medium' ? '中（按科目号推断）' : r.confidence === 'manual' ? '人工指定' : '无法识别'],
                ]),
                notice('info', '系统按产品代码前缀匹配产品识别规则；无法匹配时按总账科目号推断；仍无法识别则进入异常清单，需人工指定后才能继续计量。', '识别逻辑：')),
            });
          }
        });
        box.appendChild(panel('逐笔产品类型识别结果', {
          sub: `${rows.length} 笔 · 可逐笔确认、修改或批量调整`,
          tight: true,
          actions: h('div', { class: 'btn-group' },
            h('button', { class: 'btn sm', onclick: () => batchAdjust() }, '批量调整'),
            h('button', { class: 'btn sm', onclick: () => { detectAll(); renderProducts(); toast('已重新执行产品识别', 'ok'); } }, '重新识别')),
        }, tbl.el));

        // 无法识别清单
        const failed = rows.filter((r) => !r.product);
        if (failed.length) {
          box.appendChild(notice('danger',
            `有 ${failed.length} 笔债项无法识别产品类型（${failed.map((f) => f.id).join('、')}）。` +
            '这些记录在人工指定产品类型之前无法进入计量流程，将在后续步骤中被标记为异常。', '需要人工处理：'));
        }

        box.appendChild(h('div', { class: 'btn-group' },
          h('button', { class: 'btn primary', onclick: () => { W.done[3] = true; W.step = 4; render(); } }, '下一步：字段映射确认 →'),
          h('button', { class: 'btn', onclick: () => { W.step = 2; render(); } }, '← 返回导入')));
      }

      function detectAll() {
        const list = W.imported.loans.map((l) => {
          const det = window.Pipeline.detectProduct(l, window.MOCK.PRODUCT_DETECT_RULES);
          const ov = Store.state.overrides[l.id];
          return {
            id: l.id, name: l.name, productCode: l.raw.productCode, glAcct: l.raw.glAcct,
            product: ov || det.product, basis: ov ? '用户人工指定。' : det.basis,
            confidence: ov ? 'manual' : det.confidence, overridden: !!ov,
          };
        });
        W.products = {
          list,
          total: list.filter((x) => x.product).length,
          confident: list.filter((x) => x.confidence === 'high').length,
          uncertain: list.filter((x) => x.confidence === 'medium' || x.confidence === 'manual').length,
          failed: list.filter((x) => !x.product).length,
        };
      }

      function setProduct(r) {
        const sel = h('select', {}, [h('option', { value: '' }, '（未识别）'),
          ...MASTER.PRODUCT_TYPES.map((p) => h('option', { value: p.code, selected: p.code === r.product }, p.label))]);
        sel.onchange = () => {
          if (sel.value) Store.state.overrides[r.id] = sel.value;
          else delete Store.state.overrides[r.id];
          Store.persist();
          detectAll(); renderProducts();
          toast(`债项 ${r.id} 的产品类型已更新`, 'ok');
          md.close();
        };
        const md = openModal({
          title: `修改产品类型 · ${r.id}`,
          body: h('div', {},
            kv([['当前识别结果', r.product ? V.productLabel(r.product) : '未识别'], ['识别依据', r.basis]]),
            h('div', { class: 'field', style: { marginTop: '13px' } }, h('label', {}, '指定产品类型'), sel),
            notice('info', '人工指定的产品类型会覆盖自动识别结果，并决定该笔债项调用哪一套产品专属暴露分类规则。', '影响：')),
          footer: [h('button', { class: 'btn', onclick: () => md.close() }, '取消')],
        });
      }

      function batchAdjust() {
        const sel = h('select', {}, MASTER.PRODUCT_TYPES.map((p) => h('option', { value: p.code }, p.label)));
        const target = h('select', {},
          [h('option', { value: 'mtg' }, '产品代码以 MTG/ 开头'),
            h('option', { value: 'tl' }, '产品代码以 TL/ 开头'),
            h('option', { value: 'bnd' }, '产品代码以 BND/ 开头'),
            h('option', { value: 'all' }, '全部记录')]);
        const md = openModal({
          title: '批量调整产品类型',
          body: h('div', {},
            notice('info', '批量调整适用于同一批数据中产品代码规则一致的情形。调整结果会逐笔记录人工调整痕迹。', '说明：'),
            h('div', { class: 'field' }, h('label', {}, '匹配范围'), target),
            h('div', { class: 'field' }, h('label', {}, '指定产品类型'), sel)),
          footer: [
            h('button', { class: 'btn', onclick: () => md.close() }, '取消'),
            h('button', { class: 'btn primary', onclick: () => {
              let n = 0;
              W.products.list.forEach((r) => {
                const hit = target.value === 'all' ? true
                  : target.value === 'mtg' ? /^MTG\//.test(r.productCode || '')
                  : target.value === 'tl' ? /^TL\//.test(r.productCode || '')
                  : /^BND\//.test(r.productCode || '');
                if (hit) { Store.state.overrides[r.id] = sel.value; n++; }
              });
              Store.persist(); detectAll(); renderProducts(); md.close();
              toast(`已批量调整 ${n} 笔债项的产品类型`, 'ok');
            } }, '执行批量调整'),
          ],
        });
      }

      bodyEl.appendChild(panel('第三步：识别产品类型', { sub: '根据产品代码、业务类型及相关字段自动识别，并展示识别依据' }, box));
      renderProducts();
    }

    /* ---------------- 第四步：字段映射确认 ---------------- */
    /**
     * 智能体按"已经确认的产品类型"分组，对每组给出标准字段映射建议；
     * 用户逐组确认后，才允许进入下一步。
     */
    function step4() {
      const box = h('div');
      const gate = h('div');           // 放行状态提示
      const groupsBox = h('div');      // 每个产品的映射确认区

      if (!W.products) {
        bodyEl.appendChild(panel('第四步：字段映射确认',
          notice('danger', '尚未识别产品类型，请先完成第三步。', '缺少前置步骤：')));
        return;
      }

      // 按已确认的产品类型分组
      const byProduct = {};
      W.products.list.forEach((r) => {
        if (!r.product) return;
        (byProduct[r.product] = byProduct[r.product] || []).push(r);
      });

      // 为每个产品生成一次映射建议（同一产品只确认一次）
      W.mappings = W.mappings || {};
      Object.keys(byProduct).forEach((pcode) => {
        if (!W.mappings[pcode]) {
          const sug = FieldMapping.suggestMapping(
            pcode, window.MOCK.RAW_SHEET_HEADERS, window.MOCK.MOCK_LOANS);
          W.mappings[pcode] = { product: pcode, suggestions: sug, table: null, loans: byProduct[pcode].length };
        } else {
          W.mappings[pcode].loans = byProduct[pcode].length;
        }
      });

      const unmappedCount = W.products.list.filter((r) => !r.product).length;

      box.appendChild(notice('info',
        '智能体已按第三步确认的产品类型分组，读取每个产品的标准字段定义（label / meaning / source / options），' +
        '再对照导入的 Excel 表头给出映射建议。' +
        '未映射的字段视为没填，引用它的规则条件不会命中 —— 因此必填字段的缺失必须由你处理或确认后放行。', '智能体映射建议：'));

      if (unmappedCount) {
        box.appendChild(notice('warn',
          `有 ${unmappedCount} 笔债项的产品类型尚未识别，它们不参与本次映射确认，将带着字段缺失进入计量并落入兜底分类。`,
          '存在未识别产品：'));
      }

      /* 汇总 */
      const allSug = Object.values(W.mappings).flatMap((m) => m.suggestions);
      const sum = FieldMapping.summarize(allSug);
      box.appendChild(h('div', { class: 'grid c4', style: { marginBottom: '14px' } },
        UI.kpi('产品分组', String(Object.keys(W.mappings).length), `覆盖 ${allSug.length} 个字段映射`, { accent: true }),
        UI.kpi('高置信度建议', String(sum.high), '可直接采纳'),
        UI.kpi('需人工确认', String(sum.needConfirm), `${sum.mid} 条近似匹配`, { sm: true }),
        UI.kpi('未匹配到列', String(sum.none), sum.none ? '引用它的条件将不命中' : '全部已匹配', { sm: true })));

      /* 每个产品一个面板 */
      Object.values(W.mappings).forEach((m) => {
        const pt = MASTER.PRODUCT_TYPES.find((x) => x.code === m.product);
        const table = FieldMapping.buildConfirmTable({
          productCode: m.product,
          suggestions: m.suggestions,
          headers: window.MOCK.RAW_SHEET_HEADERS,
          onChange: () => renderGate(),
        });
        m.table = table;

        const actions = h('div', { class: 'btn-group' },
          h('button', {
            class: 'btn sm',
            onclick: () => { table.acceptAll(); toast(`已采纳「${pt ? pt.label : m.product}」的全部高置信度建议`, 'ok'); },
          }, '采纳全部建议'),
          h('button', {
            class: 'btn sm',
            onclick: () => showMappingDetail(m, pt),
          }, '查看智能体判断依据'));

        groupsBox.appendChild(panel(`${pt ? pt.label : m.product} · 字段映射确认`, {
          sub: `${m.loans} 笔债项归属该产品 · ${m.suggestions.length} 个标准字段`,
          actions,
        }, table.el));
      });

      /* 放行门禁 */
      function renderGate() {
        gate.innerHTML = '';
        const pending = Object.values(W.mappings).reduce((s, m) => s + (m.table ? m.table.pending() : 0), 0);
        const unmappedReq = Object.values(W.mappings).reduce((s, m) => s + (m.table ? m.table.unmappedRequired() : 0), 0);
        const confirmed = Object.values(W.mappings).every((m) => m.confirmed);

        if (confirmed) {
          gate.appendChild(notice('ok',
            '全部产品的字段映射均已由用户确认，可以进入下一步执行暴露分类。', '确认完成：'));
          gate.appendChild(h('div', { class: 'btn-group' },
            h('button', { class: 'btn primary', onclick: () => { W.done[4] = true; W.step = 5; render(); } }, '下一步：执行暴露分类 →'),
            h('button', { class: 'btn', onclick: () => { W.step = 3; render(); } }, '← 返回产品识别'),
            h('button', { class: 'btn ghost', onclick: () => { W.mappings = {}; render(); } }, '重新生成映射建议')));
          return;
        }

        const problems = [];
        if (pending) problems.push(`还有 ${pending} 条已匹配的字段未勾选确认。`);
        if (unmappedReq) problems.push(`有 ${unmappedReq} 个必填字段未匹配到 Excel 列 —— 请指定列，或确认接受该字段缺失（引用它的规则条件将不命中）。`);
        gate.appendChild(notice('warn', problems.join(' ') + ' 逐条确认后即可放行。', '尚未放行：'));
        gate.appendChild(h('div', { class: 'btn-group' },
          h('button', { class: 'btn primary', onclick: confirmAll }, '一键确认全部（含接受缺失）'),
          h('button', { class: 'btn', onclick: () => { W.step = 3; render(); } }, '← 返回产品识别')));
      }

      function confirmAll() {
        Object.values(W.mappings).forEach((m) => {
          if (m.table) m.table.acceptAll();
          m.confirmed = true;
          m.suggestions.forEach((s) => { s.confirmed = true; });
        });
        toast('已确认全部产品的字段映射', 'ok');
        renderGate();
      }

      function showMappingDetail(m, pt) {
        const body = h('div', {});
        body.appendChild(notice('info',
          `智能体对「${pt ? pt.label : m.product}」的判断依据。每条建议记录了它依据哪条线索得出：` +
          `产品预设映射、列名与标准字段名称匹配、或未能对上。`, '判断依据：'));
        const tb = h('tbody');
        m.suggestions.forEach((s) => {
          tb.appendChild(h('tr', {},
            h('td', { class: 'mono' }, s.stdCode),
            h('td', {}, s.stdField),
            h('td', {}, s.column ? h('code', { class: 'mono' }, s.column) : h('span', { class: 'tag danger' }, '未匹配')),
            h('td', { style: { fontSize: '11.5px' } }, s.reason),
            h('td', {}, s.column ? tag(s.confidence >= 0.95 ? 'ok' : 'warn', Math.round(s.confidence * 100) + '%') : '—')));
        });
        body.appendChild(h('div', { class: 'table-wrap' },
          h('table', { class: 'tbl compact' },
            h('thead', {}, h('tr', {}, ['字段编码', '标准字段', '匹配到的列', '判断依据', '置信度'].map((t) => h('th', {}, t)))),
            tb)));
        body.appendChild(h('div', { class: 'panel', style: { marginTop: '13px' } },
          h('div', { class: 'panel-head' }, h('h3', {}, '产品的标准字段定义（智能体读取的输入）')),
          h('div', { class: 'panel-body' },
            (MASTER.PRODUCT_FIELDS[m.product] || []).map((f) => Views.fieldBlock(f)))));
        openDrawer({ title: `映射判断依据 · ${pt ? pt.label : m.product}`, wide: true, body });
      }

      renderGate();
      bodyEl.appendChild(panel('第四步：字段映射确认', {
        sub: '智能体按产品给出映射建议，用户逐条确认后才进入暴露分类',
      }, box, groupsBox, gate));
    }

    /* ---------------- 第五步：执行暴露分类 ---------------- */
    function step5() {
      const box = h('div');
      const progress = h('div');
      bodyEl.appendChild(panel('第五步：执行信用风险暴露分类', {
        sub: '调用该产品在当前监管版本下配置的暴露分类规则，逐笔执行规则路由',
      }, notice('info',
        '系统按每笔债项最终确认的产品类型，调用该产品的暴露分类规则，逐笔执行规则路由，' +
        '并输出暴露大类、子类、命中规则、规则执行顺序、每个判断节点的输入值与判断结果、关联监管条款。', '执行方式：'),
        h('div', { class: 'btn-group' },
          h('button', { class: 'btn primary', onclick: runClassification }, '▶ 开始逐笔执行分类'),
          h('button', { class: 'btn', onclick: () => App.go('tree') }, '查看决策树')),
        progress,
        box));

      function runClassification() {
        progress.innerHTML = '';
        box.innerHTML = '';
        const rs = Store.currentRuleset();
        const loans = W.imported.loans;
        let i = 0;
        const bar = h('i', { style: { width: '0%' } });
        const status = h('div', { class: 'dim', style: { fontSize: '12px', marginTop: '6px' } }, '准备执行…');
        progress.appendChild(h('div', { style: { margin: '14px 0' } },
          h('div', { class: 'progress' }, bar), status));

        const results = [];
        const tick = () => {
          const t0 = performance.now();
          const batch = 3;
          for (let k = 0; k < batch && i < loans.length; k++, i++) {
            const l = loans[i];
            const res = window.Pipeline.measure(l, {
              ruleset: rs, eadOnRules: MASTER.EAD_ON_RULES, eadOffRules: MASTER.EAD_OFF_RULES,
              detectRules: window.MOCK.PRODUCT_DETECT_RULES,
              productOverride: Store.state.overrides[l.id],
              // 若该产品已生成专属规则集，则按其字段绑定执行
              productRuleset: (window.ProductRules && ProductRules.getProductRuleSet(
                Store.state.overrides[l.id] || window.Pipeline.detectProduct(l, window.MOCK.PRODUCT_DETECT_RULES).product)) || null,
            });
            results.push(res);
          }
          const pctv = Math.round(i / loans.length * 100);
          bar.style.width = pctv + '%';
          status.textContent = `正在执行规则路由… ${i}/${loans.length} 笔（${pctv}%）`;
          if (i < loans.length) { setTimeout(tick, 60); return; }
          bar.style.width = '100%';
          status.textContent = `分类执行完成，共处理 ${loans.length} 笔债项。`;
          W.classified = results;
          showResult(results);
        };
        setTimeout(tick, 120);

        function showResult(results) {
          const ok = results.filter((r) => r.stages.classify.status === 'ok').length;
          const exc = results.filter((r) => r.stages.classify.status === 'exception').length;
          const skipped = results.filter((r) => r.stages.classify.status === 'skipped').length;

          box.appendChild(h('div', { class: 'grid c4', style: { marginTop: '14px' } },
            UI.kpi('处理总数', String(results.length), '逐笔执行规则路由', { accent: true }),
            UI.kpi('分类成功', String(ok), `占 ${Math.round(ok / results.length * 100)}%`),
            UI.kpi('分类异常', String(exc), exc ? '未命中规则或权重未定' : '无异常', { sm: true }),
            UI.kpi('未执行', String(skipped), skipped ? '产品类型未识别' : '无', { sm: true })));

          const rows = results.map((r) => ({
            id: r.loanId, name: r.name, product: V.productLabel(r.product),
            cls: r.exposureClass || '（未分类）', sub: r.exposureSubClass || '—',
            rule: r.matchedRule || '—',
            hops: countHops(r.stages.classify.trace),
            status: r.stages.classify.status,
            note: (r.exceptions || []).map((e) => e.text).join(' '),
            _r: r,
          }));
          const cols = [
            { key: 'id', title: '债项编号', cls: 'mono' },
            { key: 'name', title: '客户名称' },
            { key: 'product', title: '产品类型' },
            { key: 'cls', title: '暴露大类', html: (r) => r._r.exposureClass
              ? `<span class="tag brand">${UI.esc(r.cls)}</span>` : '<span class="tag danger">未分类</span>' },
            { key: 'sub', title: '暴露子类' },
            { key: 'rule', title: '命中规则', cls: 'mono' },
            { key: 'hops', title: '判断节点数', num: true, value: (r) => r.hops },
            { key: 'status', title: '状态', html: (r) => r._r.status === 'ok'
              ? '<span class="tag ok">正常</span>' : r._r.status === 'warning'
              ? '<span class="tag warn">待复核</span>' : '<span class="tag danger">异常</span>' },
            { key: '_act', title: '轨迹', sortable: false, html: (r) => `<button class="btn xs" data-act="trace" data-id="${r.id}">查看执行过程</button>` },
          ];
          const tbl = makeTable({ columns: cols, rows, pageSize: 15, onRowClick: (r) => showTrace(r._r) });
          tbl.el.addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-act]');
            if (btn) { const r = rows.find((x) => x.id === btn.dataset.id); showTrace(r._r); }
          });
          box.appendChild(panel('逐笔分类结果', { sub: `${results.length} 笔 · 点击任意行查看该笔的完整规则执行过程`, tight: true }, tbl.el));

          box.appendChild(h('div', { class: 'btn-group' },
            h('button', { class: 'btn primary', onclick: () => { W.done[5] = true; W.step = 6; render(); } }, '下一步：执行 EAD 计算 →'),
            h('button', { class: 'btn', onclick: () => { W.step = 3; render(); } }, '← 返回产品识别')));
        }

        function countHops(trace) {
          let n = 0;
          const walk = (ns) => (ns || []).forEach((t) => { n++; if (t.children) walk(t.children); });
          walk(trace); return n;
        }

        function showTrace(r) {
          openDrawer({
            title: `规则执行过程 · ${r.loanId}`,
            wide: true,
            body: h('div', {},
              kv([
                ['债项编号', r.loanId], ['客户名称', r.name],
                ['产品类型', V.productLabel(r.product)],
                ['暴露大类', r.exposureClass || '未分类'],
                ['暴露子类', r.exposureSubClass || '—'],
                ['命中规则', r.matchedRule || '—'],
              ]),
              h('div', { style: { marginTop: '14px' } }, V.ExecutionTrace(r.stages.classify))),
            footer: [
              h('button', { class: 'btn', onclick: () => { UI.closeDrawer(); App.go('results'); } }, '在结果明细中查看'),
              h('button', { class: 'btn primary', onclick: () => {
                const ctx = { ...Store.state.ctx, version: Store.currentVersion().version, fingerprint: Store.rulesetFingerprint(), overrides: Store.state.overrides };
                const md = V.buildMarkdown(r, ctx);
                openDrawer({ title: `Markdown 规则执行记录 · ${r.loanId}`, wide: true, body: mdView(md) });
              } }, '查看规则执行记录'),
            ],
          });
        }
      }
    }

    /* ---------------- 第六步：执行 EAD 计算 ---------------- */
    function step6() {
      const allResults = W.classified || [];
      const box = h('div');
      const productCodes = [];
      allResults.forEach((r) => { if (r.product && !productCodes.includes(r.product)) productCodes.push(r.product); });
      if (W.eadProduct && !productCodes.includes(W.eadProduct)) W.eadProduct = null;

      box.appendChild(notice('info',
        'EAD 按产品计算：先选择产品，再调用该产品已发布的表内或表外规则。' +
        '表内 EAD、表外 EAD 与风险加权资产 RWA 是不同阶段的计量概念，不会套用其他产品的公式。', '先选择产品：'));

      const tabs = h('div', { class: 'tabs' });
      productCodes.forEach((code) => {
        const n = allResults.filter((r) => r.product === code).length;
        tabs.appendChild(h('div', {
          class: `tab${W.eadProduct === code ? ' active' : ''}`,
          onclick: () => { W.eadProduct = code; render(); },
        }, `${V.productLabel(code)}（${n}）`));
      });
      box.appendChild(tabs);

      if (!W.eadProduct) {
        box.appendChild(notice('warn',
          '尚未选择产品。选择后才会展示该产品的 EAD 计算过程与结果。', '计算未开始：'));
        box.appendChild(h('div', { class: 'btn-group' },
          h('button', { class: 'btn', onclick: () => App.go('eadOn') }, '配置表内 EAD 规则'),
          h('button', { class: 'btn', onclick: () => App.go('eadOff') }, '配置表外 EAD 规则')));
        bodyEl.appendChild(panel('第六步：执行 EAD 计算', {
          sub: '先选择产品，再调用该产品的 EAD 规则',
        }, box));
        return;
      }

      const results = allResults.filter((r) => r.product === W.eadProduct);
      box.appendChild(notice('ok',
        `当前产品：${V.productLabel(W.eadProduct)}。下列 ${results.length} 笔只使用该产品的 EAD 规则。`, '已选择产品：'));

      const onRows = results.filter((r) => r.stages.ead.result && r.stages.ead.result.kind === 'on');
      const offRows = results.filter((r) => r.stages.ead.result && r.stages.ead.result.kind === 'off');

      box.appendChild(h('div', { class: 'grid c4', style: { marginBottom: '14px' } },
        UI.kpi('表内业务笔数', String(onRows.length), `表内 EAD 合计 ${fmtShort(onRows.reduce((s, r) => s + (r.onEad || 0), 0))}`, { accent: true }),
        UI.kpi('表外业务笔数', String(offRows.length), `表外 EAD 合计 ${fmtShort(offRows.reduce((s, r) => s + (r.offEad || 0), 0))}`),
        UI.kpi('EAD 合计', fmtShort(results.reduce((s, r) => s + (r.ead || 0), 0)), '表内 + 表外'),
        UI.kpi('计算异常', String(results.filter((r) => r.stages.ead.status === 'exception').length), '关键金额字段缺失', { sm: true })));

      const rows = results.map((r) => ({
        id: r.loanId, name: r.name, product: V.productLabel(r.product),
        kind: r.stages.ead.result ? (r.stages.ead.result.kind === 'off' ? '表外' : '表内') : '—',
        raw: r.stages.ead.result && r.stages.ead.result.kind === 'off'
          ? `${fmtNum(r.std.onbalance_amount)} + ${fmtNum(r.std.offbalance_amount)}`
          : fmtNum(r.std.balance),
        param: r.stages.ead.result
          ? (r.stages.ead.result.kind === 'off' ? pct2(r.stages.ead.result.ccf) : `减值 ${fmtNum(r.std.impairment)}`)
          : '—',
        formula: r.stages.ead.result ? r.stages.ead.result.formula : '—',
        onEad: r.onEad, offEad: r.offEad, ead: r.ead,
        rule: r.stages.ead.result ? r.stages.ead.result.ruleId : '—',
        status: r.stages.ead.status,
        _r: r,
      }));
      const cols = [
        { key: 'id', title: '债项编号', cls: 'mono' },
        { key: 'product', title: '产品类型' },
        { key: 'kind', title: '业务性质', html: (r) => r.kind === '表外'
          ? '<span class="tag warn">表外</span>' : '<span class="tag muted">表内</span>' },
        { key: 'raw', title: '原始金额', num: true },
        { key: 'param', title: '适用参数', num: true },
        { key: 'formula', title: '计算公式', cls: 'dim', value: (r) => r.formula },
        { key: 'onEad', title: '表内 EAD', num: true, value: (r) => fmtNum(r.onEad) },
        { key: 'offEad', title: '表外 EAD', num: true, value: (r) => fmtNum(r.offEad) },
        { key: 'ead', title: '合计 EAD', num: true, value: (r) => fmtNum(r.ead) },
        { key: '_act', title: '计算过程', sortable: false, html: (r) => `<button class="btn xs" data-act="calc" data-id="${r.id}">查看步骤</button>` },
      ];
      const tbl = makeTable({ columns: cols, rows, pageSize: 15, onRowClick: (r) => showCalc(r._r) });
      tbl.el.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-act]');
        if (btn) { const r = rows.find((x) => x.id === btn.dataset.id); showCalc(r._r); }
      });
      box.appendChild(panel('逐笔 EAD 计算结果', { sub: `${results.length} 笔 · 点击任意行查看计算步骤`, tight: true }, tbl.el));

      box.appendChild(h('div', { class: 'btn-group' },
        h('button', { class: 'btn primary', onclick: () => { W.done[6] = true; W.step = 7; render(); } }, '下一步：确定风险权重并计算 RWA →'),
        h('button', { class: 'btn', onclick: () => App.go('eadOff') }, '查看 EAD 规则配置')));

      bodyEl.appendChild(panel('第六步：执行 EAD 计算', {
        sub: `${V.productLabel(W.eadProduct)} · 调用该产品的表内或表外 EAD 规则`,
      }, box));

      function showCalc(r) {
        const ead = r.stages.ead.result;
        openDrawer({
          title: `EAD 计算过程 · ${r.loanId}`,
          wide: true,
          body: h('div', {},
            kv([
              ['债项编号', r.loanId], ['客户名称', r.name],
              ['产品类型', V.productLabel(r.product)],
              ['业务性质', ead && ead.kind === 'off' ? '表外业务' : '表内业务'],
              ['适用规则', ead ? `${ead.ruleId} ${ead.ruleName}` : '—'],
              ['计算公式', { mono: true, node: h('code', {}, ead ? ead.formula : '—') }],
            ]),
            h('div', { class: 'panel', style: { marginTop: '13px' } },
              h('div', { class: 'panel-head' }, h('h3', {}, '计算步骤')),
              h('div', { class: 'panel-body' },
                ead ? ead.steps.map((s) => h('div', { class: 'step-line' },
                  h('span', { class: 'sl-n' }, s.n),
                  h('div', { class: 'sl-b' },
                    h('div', {}, h('span', { class: 'sl-l' }, s.label),
                      h('span', { class: 'sl-v' }, fmtNum(s.value))),
                    h('div', {}, h('span', { class: 'sl-e' }, s.expr)),
                    s.note ? h('div', { class: 'sl-note' }, s.note) : null))) : h('div', { class: 'empty' }, '无计算步骤'))),
            ead && ead.params && ead.params.length
              ? h('div', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h3', {}, '参数及参数来源')),
                  h('div', { class: 'panel-body tight' }, h('div', { class: 'table-wrap' },
                    h('table', { class: 'tbl compact' },
                      h('thead', {}, h('tr', {}, ['参数', '取值', '取值依据'].map((t) => h('th', {}, t)))),
                      h('tbody', {}, ead.params.map((p) => h('tr', {},
                        h('td', {}, p.name), h('td', { class: 'mono' }, String(p.value)), h('td', { class: 'dim' }, p.basis))))))))
              : null,
            h('div', { class: 'notice ok', style: { marginTop: '12px' } },
              h('span', { class: 'ni' }, '='),
              h('div', {}, `本笔 EAD = `, h('b', {}, fmtNum(ead ? ead.ead : null)),
                ead && ead.kind === 'off' ? `（表外 EAD，尚未计算 RWA）` : `（表内 EAD，尚未计算 RWA）`))),
        });
      }
    }

    /* ---------------- 第七步：风险权重与 RWA ---------------- */
    function step7() {
      const results = W.classified || [];
      const box = h('div');

      box.appendChild(notice('warn',
        'RWA = 适用的信用风险暴露金额 × 适用风险权重。该简化公式仅适用于标准法下的对应情形；' +
        '对于需要进一步调整或采用其他计量方式的情形，应以对应监管规则为准，不能视为所有计量方法的通用公式。', '计算口径：'));

      const done = results.filter((r) => r.rwa != null);
      const byWeight = {};
      done.forEach((r) => {
        const k = r.riskWeight == null ? '未定' : pct2(r.riskWeight);
        byWeight[k] = byWeight[k] || { n: 0, ead: 0, rwa: 0 };
        byWeight[k].n++; byWeight[k].ead += r.ead || 0; byWeight[k].rwa += r.rwa || 0;
      });

      box.appendChild(h('div', { class: 'grid c4', style: { marginBottom: '14px' } },
        UI.kpi('已计算 RWA', String(done.length) + ' 笔', `共 ${results.length} 笔`, { accent: true }),
        UI.kpi('EAD 合计', fmtShort(results.reduce((s, r) => s + (r.ead || 0), 0)), '全部债项'),
        UI.kpi('RWA 合计', fmtShort(results.reduce((s, r) => s + (r.rwa || 0), 0)), '信用风险加权资产'),
        UI.kpi('平均风险权重', pct2(results.reduce((s, r) => s + (r.ead || 0), 0)
          ? results.reduce((s, r) => s + (r.rwa || 0), 0) / results.reduce((s, r) => s + (r.ead || 0), 0) : null),
          'RWA / EAD（加权平均）', { sm: true })));

      /* 权重分布 */
      box.appendChild(panel('风险权重分布（标准法档位）', { sub: '按适用风险权重汇总 EAD 与 RWA' },
        h('div', { class: 'table-wrap' },
          h('table', { class: 'tbl' },
            h('thead', {}, h('tr', {}, ['风险权重', '笔数', 'EAD', 'RWA', '占 RWA 比重'].map((t) => h('th', {}, t)))),
            h('tbody', {}, Object.entries(byWeight).sort((a, b) => parseFloat(b[0]) - parseFloat(a[0])).map(([w, v]) => {
              const totalRwa = results.reduce((s, r) => s + (r.rwa || 0), 0);
              return h('tr', {},
                h('td', {}, h('span', { class: 'tag brand' }, w)),
                h('td', { class: 'num' }, String(v.n)),
                h('td', { class: 'num' }, fmtNum(v.ead)),
                h('td', { class: 'num strong' }, fmtNum(v.rwa)),
                h('td', { class: 'num' }, pct2(totalRwa ? v.rwa / totalRwa : 0)));
            }))))));

      /* 逐笔 */
      const rows = results.map((r) => ({
        id: r.loanId, name: r.name, cls: r.exposureClass, sub: r.exposureSubClass,
        ead: r.ead, w: r.riskWeight, rwa: r.rwa, rule: r.matchedRule,
        kind: r.weightTrace && r.weightTrace[0] ? r.weightTrace[0].kind : 'const',
        _r: r,
      }));
      const cols = [
        { key: 'id', title: '债项编号', cls: 'mono' },
        { key: 'cls', title: '暴露大类' },
        { key: 'sub', title: '暴露子类' },
        { key: 'ead', title: 'EAD', num: true, value: (r) => fmtNum(r.ead) },
        { key: 'w', title: '风险权重', num: true, value: (r) => pct2(r.w),
          html: (r) => `<span class="tag ${r.kind === 'const' ? 'muted' : 'info'}">${pct2(r.w)}</span>` },
        { key: 'kind', title: '权重确定方式', value: (r) => r.kind,
          html: (r) => r.kind === 'const' ? '规则直接给定'
            : r.kind === 'same_as' ? '按交易对手取权重'
            : r.kind === 'greater_of' ? '取大者 greater_of' : '—' },
        { key: 'rwa', title: '信用风险 RWA', num: true, value: (r) => fmtNum(r.rwa) },
        { key: '_act', title: '权重依据', sortable: false, html: (r) => `<button class="btn xs" data-act="w" data-id="${r.id}">查看依据</button>` },
      ];
      const tbl = makeTable({ columns: cols, rows, pageSize: 15, onRowClick: (r) => showWeight(r._r) });
      tbl.el.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-act="w"]');
        if (btn) { const r = rows.find((x) => x.id === btn.dataset.id); showWeight(r._r); }
      });
      box.appendChild(panel('逐笔风险权重与 RWA', { sub: '点击任意行查看风险权重的确定依据与计算过程', tight: true }, tbl.el));

      box.appendChild(h('div', { class: 'btn-group' },
        h('button', { class: 'btn primary', onclick: () => { W.done[7] = true; W.step = 8; render(); } }, '下一步：查看计量结果及审计证据 →')));

      bodyEl.appendChild(panel('第七步：确定风险权重并计算 RWA', {
        sub: '结合暴露分类结果与适用风险权重计算风险加权资产',
      }, box));

      function showWeight(r) {
        const rwa = r.stages.rwa.result;
        const body = h('div', {});

        body.appendChild(h('div', { class: 'grid c3', style: { marginBottom: '13px' } },
          UI.kpi('暴露大类', r.exposureClass || '—', r.exposureSubClass || '', { sm: true }),
          UI.kpi('适用风险权重', pct2(r.riskWeight), weightKindLabel(r.weightTrace), { accent: true, sm: true }),
          UI.kpi('信用风险 RWA', fmtNum(r.rwa), `EAD ${fmtNum(r.ead)}`, { sm: true })));

        body.appendChild(h('div', { class: 'panel' },
          h('div', { class: 'panel-head' }, h('h3', {}, '风险权重的确定依据')),
          h('div', { class: 'panel-body' }, weightTraceView(r.weightTrace))));

        if (rwa) {
          const rwaSteps = h('div', { class: 'panel-body' });
          rwa.steps.forEach((s) => {
            const isW = s.label.includes('权重');
            rwaSteps.appendChild(h('div', { class: 'step-line' },
              h('span', { class: 'sl-n' }, s.n),
              h('div', { class: 'sl-b' },
                h('div', {},
                  h('span', { class: 'sl-l' }, s.label),
                  h('span', { class: 'sl-v' }, isW ? pct2(s.value) : fmtNum(s.value))),
                h('div', {}, h('span', { class: 'sl-e' }, s.expr)),
                s.note ? h('div', { class: 'sl-note' }, s.note) : null)));
          });
          body.appendChild(h('div', { class: 'panel' },
            h('div', { class: 'panel-head' }, h('h3', {}, 'RWA 计算过程')), rwaSteps));
        }

        const clause = MASTER.CLAUSES.find((x) => (x.referencedBy || []).includes(r.matchedRule));
        if (clause) {
          body.appendChild(h('div', { class: 'panel' },
            h('div', { class: 'panel-head' }, h('h3', {}, '关联监管条款')),
            h('div', { class: 'panel-body' }, V.clauseCard(clause))));
        }

        openDrawer({ title: `风险权重与 RWA 确定过程 · ${r.loanId}`, wide: true, body });
      }

      function weightKindLabel(wt) {
        if (!wt || !wt.length) return '';
        return ({ const: '规则直接给定', same_as: '按交易对手取权重', greater_of: '取大者 greater_of' })[wt[0].kind] || '';
      }

      function weightTraceView(wt) {
        if (!wt || !wt.length) return h('div', { class: 'empty' }, '无权重解析信息');
        const box = h('div', {});
        wt.forEach((t) => {
          if (t.kind === 'const') {
            box.appendChild(h('div', { class: 'notice ok' }, h('span', { class: 'ni' }, '='),
              h('div', {}, '规则直接给定常量权重：', h('b', {}, pct2(t.value)))));
          } else if (t.kind === 'same_as') {
            box.appendChild(notice('info',
              `same_as: ${t.same_as} —— 权重等于该交易对手做一笔普通债权时的风险权重。` +
              `分类已经知道这笔是房地产、已违约或合格资产担保债券之后，权重不在这里定死，` +
              `而是忘掉这个产品类别，只看交易对手是谁，从 rules 最外层再分一次。只分这一次，不会回到当前这条。`, '向交易对手取权重：'));
            box.appendChild(kv([
              ['重新分类命中路径', { mono: true, node: h('code', {}, t.subPath || '—') }],
              ['解析结果', t.resolved != null ? pct2(t.resolved) : '（未能解析）'],
            ]));
          } else if (t.kind === 'greater_of') {
            box.appendChild(notice('info', t.note, '取大者 greater_of：'));
            box.appendChild(h('div', { class: 'table-wrap' },
              h('table', { class: 'tbl compact' },
                h('thead', {}, h('tr', {}, ['候选权重', '来源', '取值'].map((x) => h('th', {}, x)))),
                h('tbody', {}, (t.candidates || []).map((cpt, i) => {
                  const part = t.parts && t.parts[i];
                  return h('tr', {},
                    h('td', {}, `候选 ${i + 1}`),
                    h('td', { class: 'dim' }, part && part.kind === 'same_as' ? '按交易对手普通债权权重' : '规则中的常量'),
                    h('td', { class: 'mono strong' }, pct2(cpt)));
                })))));
            box.appendChild(h('div', { class: 'notice ok' }, h('span', { class: 'ni' }, '⇈'),
              h('div', {}, '取以上各项的最大值：', h('b', {}, pct2(t.resolved)))));
          }
        });
        return box;
      }
    }

    /* ---------------- 第八步：结果与审计证据 ---------------- */
    function step8() {
      const results = W.classified || [];
      const box = h('div');

      /* 计算并登记批次 */
      const totalEad = results.reduce((s, r) => s + (r.ead || 0), 0);
      const totalOn = results.reduce((s, r) => s + (r.onEad || 0), 0);
      const totalOff = results.reduce((s, r) => s + (r.offEad || 0), 0);
      const totalRwa = results.reduce((s, r) => s + (r.rwa || 0), 0);
      const excCount = results.filter((r) => r.status === 'exception').length;
      const warnCount = results.filter((r) => r.status === 'warning').length;
      const okCount = results.filter((r) => r.status === 'ok').length;

      const ver = MASTER.RULE_VERSIONS.find((v) => v.id === W.scope.versionId);
      const fp = Store.rulesetFingerprint();

      const summary = {
        total: results.length, ok: okCount, warning: warnCount, exception: excCount,
        onEad: totalOn, offEad: totalOff, ead: totalEad, rwa: totalRwa,
        rwaRate: totalEad ? totalRwa / totalEad : 0,
      };

      // 登记到 store（只登记一次）
      if (!W.registered) {
        const batchId = 'BATCH-' + W.scope.baseDate.replace(/-/g, '') + '-' + W.scope.jurisdiction + '-' + String((Store.state.batches.length + 1)).padStart(2, '0');
        W.batchId = batchId;
        const batch = {
          id: batchId, name: W.scope.batchName, institution: W.scope.institution,
          jurisdiction: W.scope.jurisdiction, version: ver.version, baseDate: W.scope.baseDate,
          imported: results.length, success: okCount, exception: excCount + warnCount,
          onEad: totalOn, offEad: totalOff, ead: totalEad, rwa: totalRwa,
          createdAt: new Date().toISOString().replace('T', ' ').slice(0, 19),
          status: excCount ? 'failed' : 'completed',
          fingerprint: fp,
        };
        Store.state.batches.unshift(batch);
        Store.state.lastRun = { results, summary, batch, scope: { ...W.scope } };
        W.registered = true;
        Store.persist();
      }

      box.appendChild(notice('ok',
        `计量批次「${W.scope.batchName}」已完成，共 ${results.length} 笔债项，` +
        `表内 EAD ${fmtShort(totalOn)}、表外 EAD ${fmtShort(totalOff)}、信用风险 RWA ${fmtShort(totalRwa)}。` +
        `批次编号 ${W.batchId}。`, '计量完成：'));

      box.appendChild(h('div', { class: 'grid c6', style: { marginBottom: '14px' } },
        UI.kpi('债项总数', String(results.length), W.scope.baseDate + ' 基准', { accent: true }),
        UI.kpi('计量成功', String(okCount), `占 ${Math.round(okCount / results.length * 100)}%`),
        UI.kpi('表内 EAD', fmtShort(totalOn), '账面余额 − 减值准备'),
        UI.kpi('表外 EAD', fmtShort(totalOff), '含信用转换系数折算'),
        UI.kpi('信用风险 RWA', fmtShort(totalRwa), `平均权重 ${pct2(summary.rwaRate)}`, { accent: true }),
        UI.kpi('异常 / 待复核', `${excCount} / ${warnCount}`, excCount ? '需人工处理' : '无阻断异常', { sm: true })));

      /* 逐笔明细表（第七步的核心交付） */
      const rows = results.map((r) => ({
        id: r.loanId, customer: r.customer, name: r.name, product: V.productLabel(r.product),
        balance: r.std.balance, cls: r.exposureClass, sub: r.exposureSubClass,
        rule: r.matchedRule, w: r.riskWeight, onEad: r.onEad, offEad: r.offEad, rwa: r.rwa,
        status: r.status, exc: (r.exceptions || []).map((e) => e.text).join(' '),
        ref: r.reference ? `${r.reference.clause || ''} ${r.reference.doc || ''}`.trim() : '—',
        _r: r,
      }));
      const cols = [
        { key: 'id', title: '债项编号', cls: 'mono' },
        { key: 'customer', title: '客户编号', cls: 'mono' },
        { key: 'product', title: '产品类型' },
        { key: 'balance', title: '原始余额', num: true, value: (r) => fmtNum(r.balance) },
        { key: 'cls', title: '暴露大类', html: (r) => r.cls ? `<span class="tag brand">${UI.esc(r.cls)}</span>` : '<span class="tag danger">未分类</span>' },
        { key: 'sub', title: '暴露子类' },
        { key: 'rule', title: '命中规则', cls: 'mono' },
        { key: 'w', title: '风险权重', num: true, value: (r) => pct2(r.w) },
        { key: 'onEad', title: '表内 EAD', num: true, value: (r) => fmtNum(r.onEad) },
        { key: 'offEad', title: '表外 EAD', num: true, value: (r) => fmtNum(r.offEad) },
        { key: 'rwa', title: '信用风险 RWA', num: true, value: (r) => fmtNum(r.rwa) },
        { key: 'status', title: '计量状态', html: (r) => r._r.status === 'ok' ? '<span class="tag ok">正常</span>'
          : r._r.status === 'warning' ? '<span class="tag warn">待复核</span>' : '<span class="tag danger">异常</span>' },
        { key: 'ref', title: '监管依据', cls: 'dim' },
        { key: '_act', title: '追溯', sortable: false, html: (r) => `
          <div class="btn-group">
            <button class="btn xs" data-act="trace" data-id="${r.id}">规则执行轨迹</button>
            <button class="btn xs" data-act="md" data-id="${r.id}">执行记录</button>
          </div>` },
      ];
      const tbl = makeTable({ columns: cols, rows, pageSize: 15, onRowClick: (r) => showLoanDetail(r._r) });
      tbl.el.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-act]');
        if (!btn) return;
        const r = rows.find((x) => x.id === btn.dataset.id);
        if (btn.dataset.act === 'trace') showTraceOnly(r._r);
        if (btn.dataset.act === 'md') showMarkdown(r._r);
      });
      box.appendChild(panel('逐笔计量结果明细', {
        sub: `${results.length} 笔 · 点击任意行进入该笔债项的完整计量追溯`,
        tight: true,
        actions: h('div', { class: 'btn-group' },
          h('button', { class: 'btn sm', onclick: () => App.go('results') }, '完整结果页'),
          h('button', { class: 'btn primary sm', onclick: () => App.go('export') }, '导出 Excel 底稿')),
      }, tbl.el));

      /* 按暴露大类汇总 */
      const byClass = {};
      results.forEach((r) => {
        const k = r.exposureClass || '未分类';
        byClass[k] = byClass[k] || { n: 0, ead: 0, rwa: 0 };
        byClass[k].n++; byClass[k].ead += r.ead || 0; byClass[k].rwa += r.rwa || 0;
      });
      const clsBody = h('tbody', {});
      Object.entries(byClass).sort((a, b) => b[1].rwa - a[1].rwa).forEach(([k, v]) => {
        clsBody.appendChild(h('tr', {},
          h('td', {}, k), h('td', { class: 'num' }, String(v.n)),
          h('td', { class: 'num' }, fmtNum(v.ead)), h('td', { class: 'num strong' }, fmtNum(v.rwa)),
          h('td', { class: 'num' }, pct2(v.ead ? v.rwa / v.ead : 0)),
          h('td', { class: 'num' }, pct2(totalRwa ? v.rwa / totalRwa : 0))));
      });
      clsBody.appendChild(h('tr', { style: { fontWeight: '600', background: 'var(--panel-2)' } },
        h('td', {}, '合计'), h('td', { class: 'num' }, String(results.length)),
        h('td', { class: 'num' }, fmtNum(totalEad)), h('td', { class: 'num' }, fmtNum(totalRwa)),
        h('td', { class: 'num' }, pct2(summary.rwaRate)), h('td', { class: 'num' }, '100%')));

      box.appendChild(panel('按暴露大类汇总', { sub: '支持按产品类型、暴露大类、暴露子类、计量状态等维度汇总' },
        h('div', { class: 'table-wrap' },
          h('table', { class: 'tbl' },
            h('thead', {}, h('tr', {}, ['暴露大类', '笔数', 'EAD', 'RWA', '平均风险权重', '占 RWA 比重'].map((t) => h('th', {}, t)))),
            clsBody))));

      box.appendChild(h('div', { class: 'btn-group' },
        h('button', { class: 'btn primary', onclick: () => App.go('export') }, '导出 Excel 审计底稿'),
        h('button', { class: 'btn', onclick: () => App.go('results') }, '查看完整结果明细'),
        h('button', { class: 'btn', onclick: () => App.go('batches') }, '查看计量批次'),
        h('button', { class: 'btn', onclick: () => { W.step = 1; W.done = {}; W.imported = null; W.products = null; W.classified = null; W.registered = false; render(); } }, '发起新的计量')));

      bodyEl.appendChild(panel('第八步：查看计量结果及审计证据', {
        sub: '逐笔债项计量结果与完整证据链',
      }, box));

      /* 明细抽屉 */
      function showLoanDetail(r) {
        const ctx = { ...Store.state.ctx, version: ver.version, fingerprint: fp, overrides: Store.state.overrides };
        const body = h('div', {});
        body.appendChild(h('div', { class: 'grid c4', style: { marginBottom: '13px' } },
          UI.kpi('暴露大类', r.exposureClass || '未分类', r.exposureSubClass || '', { sm: true }),
          UI.kpi('风险权重', pct2(r.riskWeight), r.matchedRule || '', { accent: true, sm: true }),
          UI.kpi('EAD', fmtShort(r.ead), r.onEad ? `表内 ${fmtShort(r.onEad)}` : `表外 ${fmtShort(r.offEad)}`, { sm: true }),
          UI.kpi('信用风险 RWA', fmtShort(r.rwa), '', { sm: true })));

        body.appendChild(h('div', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h3', {}, '原始债项数据')),
          h('div', { class: 'panel-body' }, kv(Object.entries(r.raw || {}).map(([k, v]) => [k, String(v == null || v === '' ? '（空）' : v)])))));

        body.appendChild(h('div', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h3', {}, '标准字段映射结果')),
          h('div', { class: 'panel-body' }, kv(Object.entries(r.stages.classify.facts || r.std)
            .map(([k, v]) => {
              const fv = UI.fieldValue(k, v);
              return [UI.label(k) + '（' + k + '）',
                { node: h('span', { class: fv.missing ? 'dim' : '' }, fv.text,
                  fv.missing ? h('span', { class: 'tag warn', style: { marginLeft: '6px' } }, '未填，引用它的条件不命中') : null) }];
            })))));

        body.appendChild(h('div', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h3', {}, '暴露分类规则的逐步执行过程'),
          h('span', { class: 'sub' }, '每个节点的条件、实际字段值、判断结果')),
          h('div', { class: 'panel-body' }, V.ExecutionTrace(r.stages.classify))));

        const ead = r.stages.ead.result;
        body.appendChild(h('div', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h3', {}, 'EAD 计算过程')),
          h('div', { class: 'panel-body' }, ead ? ead.steps.map((s) => h('div', { class: 'step-line' },
            h('span', { class: 'sl-n' }, s.n),
            h('div', { class: 'sl-b' }, h('div', {}, h('span', { class: 'sl-l' }, s.label), h('span', { class: 'sl-v' }, fmtNum(s.value))),
              s.note ? h('div', { class: 'sl-note' }, s.note) : null))) : '—')));

        openDrawer({
          title: `单笔债项计量追溯 · ${r.loanId}`, wide: true, body,
          footer: [
            h('button', { class: 'btn', onclick: () => showMarkdown(r) }, '查看 Markdown 规则执行记录'),
            h('button', { class: 'btn primary', onclick: () => { UI.closeDrawer(); App.go('results'); } }, '在结果明细中查看'),
          ],
        });
      }

      function showTraceOnly(r) {
        openDrawer({ title: `规则执行轨迹 · ${r.loanId}`, wide: true, body: V.ExecutionTrace(r.stages.classify) });
      }

      function showMarkdown(r) {
        const ctx = { ...Store.state.ctx, version: ver.version, fingerprint: fp, overrides: Store.state.overrides };
        openDrawer({
          title: `Markdown 规则执行记录 · ${r.loanId}`, wide: true,
          body: mdView(V.buildMarkdown(r, ctx)),
          footer: [
            h('button', { class: 'btn', onclick: () => {
              const md = V.buildMarkdown(r, ctx);
              UI.downloadBlob(new Blob([md], { type: 'text/markdown;charset=utf-8' }), `${r.loanId}_规则执行记录.md`);
              toast('Markdown 规则执行记录已下载', 'ok');
            } }, '下载 .md 文件'),
            h('button', { class: 'btn', onclick: () => UI.copyText(V.buildMarkdown(r, ctx), 'Markdown 内容已复制') }, '复制内容'),
          ],
        });
      }
    }

    function mdView(md) {
      return h('div', {},
        notice('warn', '本记录为模拟生成，其中的监管条款、制度名称与权重数值均为虚构，仅用于演示审计复核过程。', '模拟记录声明：'),
        h('div', { class: 'md-view' }, md));
    }
  });
})();
