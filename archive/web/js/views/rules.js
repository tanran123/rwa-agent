/** 模块三：通用暴露分类规则、产品专属规则、决策树、自然语言规则助手 */
(function () {
  const { h, panel, tag, notice, makeTable, openDrawer, openModal, toast, kv, confirmDialog, statusTag, pct2, fmtNum } = UI;
  const V = window.Views;

  /* ==================== 通用暴露分类规则（流程图编辑器） ==================== */
  App.register('generic', (root) => {
    App.setHeader('通用暴露分类规则', '分类瀑布。命中进入下级，本层都不成立再看下一条。');
    root.innerHTML = '';

    const rs = Store.currentRuleset();
    const src = Store.state.classSource || '当前规则集';

    const shell = h('div', { class: 'exp-shell class-only' });
    shell.innerHTML =
      '<div class="exp-toolbar">' +
        '<button type="button" class="btn" data-class-zoom="-">−</button>' +
        '<button type="button" class="btn" data-class-zoom="1">适配</button>' +
        '<button type="button" class="btn" data-class-zoom="+">+</button>' +
        '<span class="hint">' + Store.countNodes(rs) + ' 个节点 · ' + src + '</span>' +
      '</div>' +
      '<div class="exp-stage" id="expStage">' +
        '<div class="exp-world" id="expWorld">' +
          '<svg id="expSvg"></svg>' +
          '<div id="expNodes"></div>' +
        '</div>' +
      '</div>';
    root.appendChild(shell);
    shell.querySelectorAll('[data-class-zoom]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const z = btn.getAttribute('data-class-zoom');
        if (z === '1') {
          state.expZoom = 1;
          state.expPan = { x: 24, y: 24 };
          state.expCenterPending = true;
        } else {
          state.expZoom = Math.max(0.08, Math.min(2.2, state.expZoom * (z === '+' ? 1.12 : 1 / 1.12)));
        }
        paintClassWaterfall();
      });
    });
    const stage = shell.querySelector('#expStage');
    stage.addEventListener('click', (e) => {
      const node = e.target.closest('.exp-node');
      stage.querySelectorAll('.exp-node.selected').forEach((n) => n.classList.remove('selected'));
      if (node) node.classList.add('selected');
    });
    state.expCenterPending = true;
    state.expZoom = 1;
    state.expPan = { x: 24, y: 24 };
    requestAnimationFrame(() => paintClassWaterfall());
  });

  /* ==================== 产品专属暴露分类规则 · 向导 ==================== */
  App.register('productRules', (root) => {
    App.setHeader('产品专属暴露分类规则', '在通用分类框架基础上，用产品标准字段绑定通用规则字段，向导式建立每个产品的暴露分类规则');
    root.innerHTML = '';

    const rs = Store.currentRuleset();
    const P = {
      step: 1,
      productCode: null,
      bindings: null,     // 字段绑定建议
      applicable: null,   // 规则适用性
      draft: null,        // 正在编辑的产品规则集
    };
    const bodyEl = h('div');

    const STEPS = [
      { id: 1, label: '选择产品' },
      { id: 2, label: '选择通用规则分支' },
      { id: 3, label: '字段绑定确认' },
      { id: 4, label: '确认并生成产品规则集' },
    ];

    /* 已生成的产品规则集 */
    const existing = ProductRules.allProductRuleSets();
    if (existing.length) {
      const ep = h('div', { class: 'panel' },
        h('div', { class: 'panel-head' }, h('h3', {}, `已生成的产品规则集（${existing.length}）`),
          h('span', { class: 'sub' }, '这些规则集已挂在通用规则之下，计量时会按其产品生效')),
        h('div', { class: 'panel-body tight' }));
      const tb = h('tbody');
      existing.forEach((prs) => {
        tb.appendChild(h('tr', {},
          h('td', {}, prs.productLabel),
          h('td', { class: 'mono' }, prs.id),
          h('td', {}, prs.version),
          h('td', {}, `${Object.keys(prs.fieldBindings || {}).length} 个字段绑定`),
          h('td', {}, h('span', { class: 'tag ok' }, prs.status === 'published' ? '已发布' : '草稿')),
          h('td', { class: 'dim' }, prs.updatedAt || prs.createdAt),
          h('td', {},
            h('div', { class: 'btn-group' },
              h('button', { class: 'btn xs', onclick: () => showProductRuleSet(prs) }, '查看'),
              h('button', { class: 'btn xs', onclick: () => {
                P.step = 1; P.productCode = prs.productCode; P.draft = null;
                P.bindings = null; P.applicable = null; render();
              } }, '重新配置'),
              h('button', { class: 'btn xs danger', onclick: () => {
                confirmDialog({ title: '删除产品规则集', message: `删除后「${prs.productLabel}」将回退到使用通用规则。是否继续？`, okText: '删除', danger: true })
                  .then((ok) => { if (ok) { ProductRules.removeProductRuleSet(prs.productCode); toast('已删除', 'ok'); App.go('productRules'); } });
              } }, '删除')))));
      });
      ep.querySelector('.panel-body').appendChild(h('div', { class: 'table-wrap' },
        h('table', { class: 'tbl compact' },
          h('thead', {}, h('tr', {}, ['产品', '规则集编号', '版本', '绑定字段', '状态', '更新时间', '操作'].map((t) => h('th', {}, t)))),
          tb)));
      root.appendChild(ep);
    } else {
      root.appendChild(notice('info', '尚未为任何产品生成专属规则集。所有产品当前都直接使用通用暴露分类规则。', '当前状态：'));
    }

    root.appendChild(bodyEl);
    render();

    /* ---------- 步骤条 ---------- */
    function renderSteps() {
      const bar = h('div', { class: 'steps' });
      STEPS.forEach((s, i) => {
        const cls = ['step'];
        if (P.step === s.id) cls.push('active');
        else if (P.step > s.id) cls.push('done');
        bar.appendChild(h('div', { class: cls.join(' '), onclick: () => {
          if (s.id < P.step) { P.step = s.id; render(); }
          else toast('请先完成当前步骤', 'warn');
        } }, h('span', { class: 'sn' }, P.step > s.id ? '✓' : String(s.id)), h('span', {}, s.label)));
        if (i < STEPS.length - 1) bar.appendChild(h('span', { class: 'step-arrow' }, '›'));
      });
      return bar;
    }

    function render() {
      bodyEl.innerHTML = '';
      bodyEl.appendChild(panel('产品专属规则向导', { sub: '选择产品 → 选定通用规则分支 → 字段绑定 → 确认生成' }, renderSteps()));
      const fn = [null, step1, step2, step3, step4][P.step];
      fn();
    }

    /* ---------- 第一步：选择产品 ---------- */
    function step1() {
      const box = h('div');
      box.appendChild(h('div', { class: 'crosstab-hint dim', style: { fontSize: '12px', marginBottom: '10px' } },
        '选择要建立专属规则的产品。同一产品重复配置会覆盖其原有规则集。'));

      const grid = h('div', { class: 'grid c3' });
      MASTER.PRODUCT_TYPES.forEach((pt) => {
        const fields = MASTER.PRODUCT_FIELDS[pt.code] || [];
        const bound = fields.filter((f) => f.stdField).length;
        const already = ProductRules.getProductRuleSet(pt.code);
        grid.appendChild(h('div', {
          class: `wiz-pick${P.productCode === pt.code ? ' on' : ''}`,
          style: { flexDirection: 'column', alignItems: 'stretch' },
          onclick: () => { P.productCode = pt.code; P.bindings = null; P.applicable = null; P.draft = null; render(); },
        },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
            h('span', {
              style: {
                width: '22px', height: '22px', borderRadius: '5px', background: pt.color, color: '#fff',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: '700',
              },
            }, pt.icon),
            h('span', { class: 'fname', style: { flex: '1' } }, pt.label),
            already ? h('span', { class: 'tag ok' }, '已配置') : null),
          h('div', { class: 'fmean', style: { fontSize: '11px', marginTop: '5px' } }, pt.desc),
          h('div', { class: 'fmeta', style: { marginTop: '5px' } },
            h('span', {}, `${fields.length} 个标准字段`),
            h('span', {}, `${bound} 个可绑定到规则`))));
      });
      box.appendChild(grid);

      if (P.productCode) {
        const pt = MASTER.PRODUCT_TYPES.find((x) => x.code === P.productCode);
        box.appendChild(notice('ok', `已选择「${pt.label}」。下一步将列出通用规则中可用的分支。`, '选择结果：'));
        box.appendChild(h('div', { class: 'btn-group' },
          h('button', { class: 'btn primary', onclick: () => { P.step = 2; render(); } }, '下一步：选择通用规则分支 →')));
      }
      bodyEl.appendChild(panel('第一步：选择产品', {}, box));
    }

    /* ---------- 第二步：选择通用规则分支 ---------- */
    function step2() {
      const pt = MASTER.PRODUCT_TYPES.find((x) => x.code === P.productCode);
      const box = h('div');

      box.appendChild(notice('info',
        `从通用规则集中选择「${pt.label}」需要使用的分支。勾选的分支会进入该产品的规则集；` +
        `未勾选的分支在本产品计量时不参与判断。系统按产品标准字段的覆盖情况给出推荐。`, '选择依据：'));

      // 先算一遍绑定，用于推荐
      if (!P.bindings) P.bindings = ProductRules.suggestBindings(rs, P.productCode);
      if (!P.applicable) P.applicable = ProductRules.suggestApplicable(rs, P.bindings);
      if (!P.selected) {
        P.selected = new Set(P.applicable.filter((a) => a.applicable && a.depth === 0).map((a) => a.name));
      }

      const boundCount = P.bindings.filter((b) => b.from).length;
      box.appendChild(h('div', { class: 'grid c4', style: { marginBottom: '14px' } },
        UI.kpi('通用规则节点', String(P.applicable.length), `规则集 ${rs.id}`, { accent: true }),
        UI.kpi('字段可绑定', `${boundCount}/${P.bindings.length}`, '产品标准字段覆盖情况'),
        UI.kpi('推荐启用', String(P.applicable.filter((a) => a.applicable && a.depth === 0).length), '所需字段均可绑定'),
        UI.kpi('已勾选', String(P.selected.size), '进入产品规则集', { sm: true })));

      const listBox = h('div');
      // 只展示顶层与其子级
      const byTop = {};
      P.applicable.forEach((a) => {
        if (a.depth === 0) byTop[a.name] = { top: a, kids: [] };
      });
      P.applicable.forEach((a) => {
        if (a.depth > 0 && byTop[a.parentLabel]) {
          const tk = Object.keys(byTop).find((k) => byTop[k].top.label === a.parentLabel);
          if (tk) byTop[tk].kids.push(a);
        }
      });

      /** 把该分支引用的字段渲染成 ✓/✗ 提示（已绑定 / 未绑定） */
      function fieldHintEl(top) {
        const style = { marginTop: '4px', fontSize: '11px', color: 'var(--ink-3)' };
        if (!top.fieldsUsed.length) {
          return h('div', { style }, '无条件（兜底类节点）');
        }
        const parts = top.fieldsUsed.map((f) => {
          const b = P.bindings.find((x) => x.ruleField === f);
          return (b && b.from ? '✓' : '✗') + f;
        });
        return h('div', { style }, '引用字段：' + parts.join('  '));
      }

      Object.values(byTop).forEach(({ top, kids }) => {
        const cb = h('input', { type: 'checkbox', checked: P.selected.has(top.name) });
        cb.onchange = () => {
          if (cb.checked) { P.selected.add(top.name); kids.forEach((k) => P.selected.add(k.name)); }
          else { P.selected.delete(top.name); kids.forEach((k) => P.selected.delete(k.name)); }
          updateCount();
        };
        const row = h('div', { style: { border: '1px solid var(--line)', borderRadius: '6px', padding: '9px 11px', marginBottom: '7px' } },
          h('label', { class: 'checkline', style: { alignItems: 'flex-start' } },
            cb,
            h('div', { style: { flex: '1' } },
              h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
                h('span', { class: 'fname' }, top.label),
                h('span', { class: 'fcode' }, top.name),
                top.applicable
                  ? h('span', { class: 'tag ok' }, '推荐')
                  : h('span', { class: 'tag warn' }, '部分字段缺失'),
                kids.length ? h('span', { class: 'tag muted' }, `${kids.length} 个子档`) : null),
              h('div', { class: 'fmean', style: { marginTop: '3px' } }, top.reason),
              fieldHintEl(top))));
        listBox.appendChild(row);
      });

      function updateCount() {
        const k = box.querySelector('.kpi:last-child .k-value');
        if (k) k.textContent = String(P.selected.size);
      }

      box.appendChild(h('div', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h3', {}, '通用规则分支')),
        h('div', { class: 'panel-body' }, listBox)));

      box.appendChild(h('div', { class: 'btn-group' },
        h('button', { class: 'btn primary', onclick: () => {
          if (!P.selected.size) { toast('请至少选择一个通用规则分支', 'warn'); return; }
          P.step = 3; render();
        } }, '下一步：字段绑定确认 →'),
        h('button', { class: 'btn', onclick: () => { P.step = 1; render(); } }, '← 返回选择产品')));

      bodyEl.appendChild(panel('第二步：选择通用规则分支', { sub: `产品：${pt.label}` }, box));
    }

    /* ---------- 第三步：字段绑定确认 ---------- */
    function step3() {
      const pt = MASTER.PRODUCT_TYPES.find((x) => x.code === P.productCode);
      const box = h('div');

      box.appendChild(notice('info',
        '把产品的标准字段绑定到通用规则所引用的字段。' +
        '绑定后，该产品的数据就能喂进通用规则的判断条件。' +
        '绑定不上的字段，引用它的条件在本产品下永不命中 —— 这类分支应谨慎启用。', '绑定含义：'));

      const sum = {
        total: P.bindings.length,
        high: P.bindings.filter((b) => b.from && b.confidence >= 0.95).length,
        mid: P.bindings.filter((b) => b.from && b.confidence < 0.95).length,
        none: P.bindings.filter((b) => !b.from).length,
      };
      box.appendChild(h('div', { class: 'grid c4', style: { marginBottom: '14px' } },
        UI.kpi('规则字段总数', String(sum.total), '通用规则引用到的字段', { accent: true }),
        UI.kpi('高置信度绑定', String(sum.high), '产品字段直接对应'),
        UI.kpi('需人工确认', String(sum.mid), `${sum.mid} 条近似匹配`, { sm: true }),
        UI.kpi('无法绑定', String(sum.none), sum.none ? '相关条件不会命中' : '全部可绑定', { sm: true })));

      const tb = h('tbody');
      function renderRows() {
        tb.innerHTML = '';
        P.bindings.forEach((b) => {
          const stdFields = MASTER.PRODUCT_FIELDS[P.productCode] || [];
          const sel = h('select', { style: { width: '200px', fontSize: '11.5px' } },
            [h('option', { value: '' }, '（不绑定）'),
              ...stdFields.map((f) => h('option', { value: f.code, selected: f.code === b.from },
                `${f.name}（${f.code}）`))]);
          sel.onchange = () => {
            const f = stdFields.find((x) => x.code === sel.value);
            b.from = f ? f.code : null;
            b.fromLabel = f ? f.name : null;
            b.transform = f ? f.transform : '—';
            b.confirmed = !!f;
            b.confidence = f ? 1 : 0;
            b.reason = f ? '由用户手工指定。' : '用户选择不绑定该字段。';
            renderRows(); updateGate();
          };
          const cb = h('input', { type: 'checkbox', checked: !!b.confirmed, disabled: !b.from });
          cb.onchange = () => { b.confirmed = cb.checked; updateGate(); };

          tb.appendChild(h('tr', {},
            h('td', { class: 'mono' }, b.ruleField),
            h('td', {}, b.ruleLabel),
            h('td', {}, sel),
            h('td', { class: 'dim', style: { fontSize: '11px' } }, b.from ? (b.transform || '直接取值') : '—'),
            h('td', {},
              !b.from ? h('span', { class: 'tag danger' }, '无法绑定')
                : b.confirmed ? h('span', { class: 'tag ok' }, '已确认')
                : h('span', { class: 'tag warn' }, `待确认 ${Math.round(b.confidence * 100)}%`)),
            h('td', {}, h('label', { class: 'checkline' }, cb, '确认'))));
        });
      }
      renderRows();

      const gate = h('div');
      function updateGate() {
        gate.innerHTML = '';
        const pending = P.bindings.filter((b) => b.from && !b.confirmed).length;
        if (pending) {
          gate.appendChild(notice('warn', `还有 ${pending} 条绑定未确认。`, '尚未放行：'));
          gate.appendChild(h('div', { class: 'btn-group' },
            h('button', { class: 'btn', onclick: () => {
              P.bindings.forEach((b) => { if (b.from) b.confirmed = true; });
              renderRows(); updateGate();
            } }, '一键确认全部')));
        } else {
          gate.appendChild(notice('ok', '字段绑定已确认，可以生成产品规则集。', '确认完成：'));
          gate.appendChild(h('div', { class: 'btn-group' },
            h('button', { class: 'btn primary', onclick: () => { P.step = 4; render(); } }, '下一步：确认并生成 →'),
            h('button', { class: 'btn', onclick: () => { P.step = 2; render(); } }, '← 返回选择分支')));
        }
      }
      updateGate();

      box.appendChild(h('div', { class: 'panel' },
        h('div', { class: 'panel-head' }, h('h3', {}, '字段绑定'),
          h('span', { class: 'sub' }, '产品标准字段 → 通用规则字段'),
          h('div', { class: 'spacer' }),
          h('button', { class: 'btn sm', onclick: () => {
            P.bindings.forEach((b) => { if (b.from) b.confirmed = true; });
            renderRows(); updateGate(); toast('已确认全部绑定', 'ok');
          } }, '采纳全部建议')),
        h('div', { class: 'panel-body tight' }, h('div', { class: 'table-wrap' },
          h('table', { class: 'tbl compact' },
            h('thead', {}, h('tr', {}, ['规则字段', '含义', '绑定到产品字段', '转换方式', '状态', '用户确认'].map((t) => h('th', {}, t)))),
            tb)))));
      box.appendChild(gate);

      bodyEl.appendChild(panel('第三步：字段绑定确认', { sub: `产品：${pt.label}` }, box));
    }

    /* ---------- 第四步：确认并生成 ---------- */
    function step4() {
      const pt = MASTER.PRODUCT_TYPES.find((x) => x.code === P.productCode);
      const box = h('div');

      const bindings = {};
      P.bindings.forEach((b) => {
        if (b.from && b.confirmed) {
          bindings[b.ruleField] = {
            from: b.from, fromLabel: b.fromLabel,
            transform: b.transform, confirmed: true, suggested: b.confidence >= 0.95,
          };
        }
      });

      const prs = {
        id: `PRS-${P.productCode}-${rs.version}`,
        productCode: P.productCode,
        productLabel: pt.label,
        version: rs.version,
        status: 'published',
        basedOn: rs.id,
        basedOnLabel: rs.label,
        fieldBindings: bindings,
        attachments: [...P.selected],
        overrides: {},
        createdAt: new Date().toISOString().replace('T', ' ').slice(0, 19),
        createdBy: '当前用户',
      };
      P.draft = prs;

      box.appendChild(notice('info',
        '确认后将生成该产品的专属规则集。生成后：' +
        '① 该产品在计量时按此规则集的字段绑定执行通用规则；' +
        '② 决策树中可见产品专属规则的挂载位置；' +
        '③ 审计追溯会记录本产品规则集的编号与版本。', '生成后的效果：'));

      box.appendChild(h('div', { class: 'grid c4', style: { marginBottom: '14px' } },
        UI.kpi('产品', pt.label, prs.id, { accent: true, sm: true }),
        UI.kpi('绑定的字段', String(Object.keys(bindings).length), `共 ${P.bindings.length} 个规则字段`),
        UI.kpi('启用分支', String(P.selected.size), '进入产品规则集'),
        UI.kpi('基于规则集', rs.version, rs.id, { sm: true })));

      // 摘要
      const summaryTb = h('tbody');
      P.applicable.filter((a) => P.selected.has(a.name)).forEach((a) => {
        const miss = a.fieldsUsed.filter((f) => !bindings[f]);
        summaryTb.appendChild(h('tr', {},
          h('td', {}, a.depth ? '　└ ' + a.label : a.label),
          h('td', { class: 'mono dim' }, a.name),
          h('td', {}, a.fieldsUsed.length ? a.fieldsUsed.join('、') : '（无条件）'),
          h('td', {},
            miss.length ? h('span', { class: 'tag warn' }, `缺 ${miss.length} 个绑定`) : h('span', { class: 'tag ok' }, '可执行'))));
      });

      box.appendChild(h('div', { class: 'panel' },
        h('div', { class: 'panel-head' }, h('h3', {}, '将纳入本产品规则集的规则')),
        h('div', { class: 'panel-body tight' }, h('div', { class: 'table-wrap' },
          h('table', { class: 'tbl compact' },
            h('thead', {}, h('tr', {}, ['规则', 'name', '所需字段', '可执行性'].map((t) => h('th', {}, t)))),
            summaryTb)))));

      // JSON 预览
      box.appendChild(h('div', { class: 'panel' },
        h('div', { class: 'panel-head' }, h('h3', {}, '产品规则集结构（将写入系统）')),
        h('div', { class: 'panel-body' },
          h('div', { class: 'codeblock', style: { maxHeight: '230px', overflow: 'auto' } }, JSON.stringify(prs, null, 2)))));

      box.appendChild(h('div', { class: 'btn-group' },
        h('button', { class: 'btn primary', onclick: () => {
          ProductRules.saveProductRuleSet(prs);
          Store.state.pendingProductRulesets = ProductRules.allProductRuleSets().length;
          Store.state.lastRun = null;
          toast(`已生成「${pt.label}」的产品专属规则集 ${prs.id}`, 'ok');
          App.go('productRules');
        } }, '✓ 确认并生成产品规则集'),
        h('button', { class: 'btn', onclick: () => { P.step = 3; render(); } }, '← 返回字段绑定')));

      bodyEl.appendChild(panel('第四步：确认并生成', { sub: `产品：${pt.label}` }, box));
    }

    /* ---------- 查看已生成的产品规则集 ---------- */
    function showProductRuleSet(prs) {
      const body = h('div', {});
      body.appendChild(kv([
        ['规则集编号', { mono: true, node: h('code', {}, prs.id) }],
        ['产品', prs.productLabel],
        ['基于通用规则集', `${prs.basedOn}（${prs.version}）`],
        ['状态', prs.status === 'published' ? '已发布' : '草稿'],
        ['创建时间', prs.createdAt], ['更新时间', prs.updatedAt || '—'],
        ['创建人', prs.createdBy],
      ]));

      const btb = h('tbody');
      Object.entries(prs.fieldBindings || {}).forEach(([k, v]) => {
        btb.appendChild(h('tr', {},
          h('td', { class: 'mono' }, k),
          h('td', {}, v.fromLabel),
          h('td', { class: 'mono dim' }, v.from),
          h('td', { class: 'dim' }, v.transform || '直接取值'),
          h('td', {}, v.suggested ? h('span', { class: 'tag brand' }, '智能体建议') : h('span', { class: 'tag warn' }, '人工指定'))));
      });
      body.appendChild(h('div', { class: 'panel', style: { marginTop: '13px' } },
        h('div', { class: 'panel-head' }, h('h3', {}, `字段绑定（${Object.keys(prs.fieldBindings || {}).length}）`)),
        h('div', { class: 'panel-body tight' }, h('div', { class: 'table-wrap' },
          h('table', { class: 'tbl compact' },
            h('thead', {}, h('tr', {}, ['规则字段', '产品标准字段', '字段编码', '转换方式', '来源'].map((t) => h('th', {}, t)))),
            btb)))));

      body.appendChild(h('div', { class: 'panel' },
        h('div', { class: 'panel-head' }, h('h3', {}, `启用的通用规则分支（${(prs.attachments || []).length}）`)),
        h('div', { class: 'panel-body' },
          (prs.attachments || []).map((a) => h('span', { class: 'tag brand', style: { marginRight: '6px', marginBottom: '5px' } }, a)))));

      body.appendChild(h('div', { class: 'panel' },
        h('div', { class: 'panel-head' }, h('h3', {}, '完整结构')),
        h('div', { class: 'panel-body' },
          h('div', { class: 'codeblock' }, JSON.stringify(prs, null, 2)))));

      openDrawer({ title: `产品规则集 · ${prs.productLabel}`, wide: true, body });
    }
  });

  /* ==================== 暴露分类决策树 ==================== */
  App.register('tree', (root) => {
    App.setHeader('暴露分类决策树', '决策树根据实际配置动态生成；可高亮指定债项的实际命中路径，并对未命中、冲突或字段缺失的路径给出提示');
    root.innerHTML = '';

    const rs = Store.currentRuleset();

    /* 选择一笔债项用于高亮 */
    let selectedLoanId = '';
    let classifyResult = null;
    let trace = null;

    const loanSel = h('select', {},
      [h('option', { value: '' }, '（不高亮，查看完整决策树）'),
        ...window.MOCK.MOCK_LOANS.map((l) => h('option', { value: l.id },
          `${l.id} · ${l.name} · ${l.product}`))]);
    loanSel.value = selectedLoanId;

    const infoBox = h('div');

    function runHighlight() {
      const loan = window.MOCK.MOCK_LOANS.find((l) => l.id === selectedLoanId);
      if (!loan) { classifyResult = null; trace = null; renderTree(); renderInfo(); return; }
      const res = window.Pipeline.measure(loan, {
        ruleset: rs,
        eadOnRules: MASTER.EAD_ON_RULES, eadOffRules: MASTER.EAD_OFF_RULES,
        detectRules: window.MOCK.PRODUCT_DETECT_RULES,
        productOverride: Store.state.overrides[loan.id],
      });
      classifyResult = res.stages.classify.result;
      trace = res.stages.classify.trace;
      renderTree(); renderInfo();
    }

    loanSel.onchange = () => { selectedLoanId = loanSel.value; runHighlight(); };

    const treeHost = h('div');
    function renderTree() {
      treeHost.innerHTML = '';
      const t = V.DecisionTree(rs, {
        trace, result: classifyResult,
        facts: null,
        onSelect: (node, meta) => V.showRuleDetail(node, meta, rs),
      });
      treeHost.appendChild(t.el);
    }

    function renderInfo() {
      infoBox.innerHTML = '';
      if (!selectedLoanId) {
        infoBox.appendChild(notice('info',
          '上方为当前监管版本下完整的暴露分类决策树，由规则集 JSON 动态生成。' +
          '从下拉框选择一笔模拟债项，即可高亮它在树上的实际命中路径。', '使用说明：'));
        return;
      }
      const loan = window.MOCK.MOCK_LOANS.find((l) => l.id === selectedLoanId);
      const facts = {};
      Object.assign(facts, loan.std);
      const bars = h('div', { class: 'grid c4' },
        UI.kpi('债项编号', loan.id, loan.name, { sm: true }),
        UI.kpi('暴露大类', classifyResult ? (classifyResult.topRuleLabel || classifyResult.ruleLabel) : '未分类', '', { accent: true, sm: true }),
        UI.kpi('暴露子类', classifyResult ? classifyResult.subClass : '—', '', { sm: true }),
        UI.kpi('风险权重', classifyResult && classifyResult.riskWeight != null ? pct2(classifyResult.riskWeight) : '未确定',
          classifyResult ? `命中规则 ${classifyResult.ruleName}` : '', { sm: true }));
      infoBox.appendChild(bars);

      // 逐层命中摘要
      const hops = [];
      const walk = (nodes, depth) => {
        (nodes || []).forEach((t) => {
          if (t.status === 'matched') hops.push({ depth, label: t.label, name: t.name });
          if (t.status === 'skipped') hops.push({ depth, label: t.label, name: t.name, skipped: true });
          if (t.children) walk(t.children, depth + 1);
        });
      };
      walk(trace, 0);
      const hopBox = h('div', { class: 'panel' },
        h('div', { class: 'panel-head' }, h('h3', {}, '该笔债项在决策树上的实际路径'),
          h('span', { class: 'sub' }, `${hops.filter(x => !x.skipped).length} 次命中`)),
        h('div', { class: 'panel-body' },
          h('div', { style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px' } },
            hops.map((hp, i) => [
              h('span', {
                class: `tag ${hp.skipped ? 'muted' : 'ok'}`, style: { padding: '3px 9px', fontSize: '11.5px' },
                onclick: () => { const f = Store.findRule(hp.name); if (f) V.showRuleDetail(f.node, f.meta, rs); },
              }, `${'　'.repeat(hp.depth)}${hp.label}${hp.skipped ? '（跳过）' : ''}`),
              i < hops.length - 1 ? h('span', { class: 'dim' }, '→') : null,
            ]).flat())));
      infoBox.appendChild(hopBox);

      // 异常提示
      const warns = [];
      const walkW = (nodes) => {
        (nodes || []).forEach((t) => {
          if (t.status === 'branch-exhausted') warns.push(`「${t.label}」的子规则全部未命中且未配置兜底，已退回同层继续判断。`);
          if (t.status === 'skipped') warns.push(`「${t.label}」因 skip 条件成立整段跳过。`);
          if (t.status === 'not-matched') {
            const miss = (t.condition.items || []).filter((x) => !x.nested && x.missing);
            if (miss.length) warns.push(`「${t.label}」有 ${miss.length} 个字段未填（${miss.map(m => UI.label(m.field)).join('、')}），条件不命中。`);
          }
          if (t.children) walkW(t.children);
        });
      };
      walkW(trace);
      if (warns.length) {
        infoBox.appendChild(notice('warn', warns.slice(0, 6).join(' '), '路径提示：'));
      }
      infoBox.appendChild(h('div', { class: 'btn-group' },
        h('button', { class: 'btn sm', onclick: () => App.go('results') }, '在计量结果中查看'),
        h('button', { class: 'btn sm', onclick: () => { App.go('results'); setTimeout(() => toast('请在明细中点击该笔债项查看完整追溯', 'ok'), 300); } }, '查看单笔追溯')));
    }

    /* 工具栏 */
    const toolbar = h('div', { class: 'tree-toolbar' },
      h('span', { class: 'dim', style: { fontSize: '11.5px' } }, '高亮债项：'),
      (() => { loanSel.style.width = '340px'; return loanSel; })(),
      h('button', { class: 'btn sm', onclick: () => { selectedLoanId = ''; loanSel.value = ''; runHighlight(); } }, '清除高亮'),
      h('div', { style: { flex: '1' } }),
      h('span', { class: 'tag brand' }, `规则节点 ${Store.countNodes(rs)} 个`),
      h('span', { class: 'tag outline' }, `版本 ${rs.version}`),
      h('span', { class: 'tag ok' }, '动态生成'),
      h('button', { class: 'btn sm', onclick: () => toast('决策树展开状态已重置', 'ok') }, '展开全部'));

    root.appendChild(panel('暴露分类决策树', { sub: '点击节点看条件。绿框是一条规则，细分在它的下级里。' },
      toolbar, h('div', { class: 'tree-canvas' }, treeHost)));
    root.appendChild(infoBox);

    renderTree();
    renderInfo();
  });

  /* ==================== 自然语言规则助手 ==================== */
  App.register('assistant', (root) => {
    App.setHeader('自然语言规则配置助手', '先识别再生成。生成的规则要确认后才保存，对话是预置脚本。');
    root.innerHTML = '';

    const chat = h('div', { class: 'chat' });
    const inputArea = h('div');
    let scriptIndex = 0;
    let draftRule = null;

    function addMsg(m) {
      if (m.role === 'user') {
        chat.appendChild(h('div', { class: 'msg user' },
          h('div', { class: 'mav' }, '我'),
          h('div', { class: 'mb' }, m.text)));
      } else {
        const mb = h('div', { class: 'mb' }, m.text);
        if (m.extract) {
          mb.appendChild(h('div', { class: 'extract-grid' },
            m.extract.map((e) => [h('div', { class: 'ek' }, e.k), h('div', {}, e.v)]).flat()));
        }
        if (m.ask) mb.appendChild(h('div', { style: { marginTop: '8px', color: 'var(--warn)' } }, '❓ ' + m.ask));
        if (m.draft) {
          draftRule = m.draft;
          mb.appendChild(h('div', { class: 'cond-group-label', style: { marginTop: '9px' } }, '转换为结构化规则：'));
          mb.appendChild(h('div', { class: 'codeblock' }, JSON.stringify(m.draft, null, 2)));
        }
        if (m.checks) {
          mb.appendChild(h('div', { class: 'cond-group-label', style: { marginTop: '9px' } }, '校验提示：'));
          m.checks.forEach((c) => {
            mb.appendChild(h('div', { class: `notice ${c.level === 'warn' ? 'warn' : 'info'}`, style: { margin: '6px 0 0' } },
              h('span', { class: 'ni' }, c.level === 'warn' ? '!' : 'ℹ'), h('div', {}, c.text)));
          });
        }
        if (m.treeEffect) {
          mb.appendChild(h('div', { class: 'notice info', style: { marginTop: '8px' } },
            h('span', { class: 'ni' }, '⑃'), h('div', {}, m.treeEffect)));
        }
        chat.appendChild(h('div', { class: 'msg assistant' },
          h('div', { class: 'mav' }, 'AI'),
          mb));
      }
      chat.scrollTop = chat.scrollHeight;
      // 滚动外层容器
      const c = document.querySelector('.content');
      if (c) c.scrollTop = c.scrollHeight;
    }

    function advance() {
      if (scriptIndex >= MASTER.NL_ASSISTANT_SCRIPT.length) {
        inputArea.innerHTML = '';
        inputArea.appendChild(h('div', { class: 'notice ok' },
          h('span', { class: 'ni' }, '✓'),
          h('div', {}, '模拟对话已结束。上方草稿规则可点击「确认并保存」真实写入规则集，决策树会立即同步更新。')));
        renderActions();
        return;
      }
      const m = MASTER.NL_ASSISTANT_SCRIPT[scriptIndex++];
      addMsg(m);
      if (m.role === 'user') {
        setTimeout(advance, 700);
      } else if (m.draft) {
        renderActions();
      } else {
        setTimeout(advance, 900);
      }
    }

    function renderActions() {
      inputArea.innerHTML = '';
      if (!draftRule) return;
      const btnSave = h('button', { class: 'btn primary' }, '✓ 确认并保存规则');
      btnSave.onclick = () => saveDraft();
      const btnDiscard = h('button', { class: 'btn' }, '丢弃草稿');
      btnDiscard.onclick = () => { toast('已丢弃草稿，未写入规则集', 'warn'); inputArea.innerHTML = ''; };
      const btnDetail = h('button', { class: 'btn ghost' }, '查看规则详情');
      btnDetail.onclick = () => V.showRuleDetail(draftRule, { path: '草稿（尚未保存）', depth: 0, index: 0 }, Store.currentRuleset());
      const btnAdvice = h('button', { class: 'btn ghost' }, '采纳建议：挂到商业银行节点下');
      btnAdvice.onclick = () => toast('已采纳建议：规则将挂在「对商业银行的暴露」节点之下，作为其子档，不改变外层顺序', 'ok');
      inputArea.appendChild(h('div', { class: 'btn-group', style: { marginTop: '4px' } },
        btnSave, btnDiscard, btnDetail, btnAdvice));
    }

    function saveDraft() {
      const d = draftRule;
      // 真实写入决策树：作为 fi_bank 的子档
      const node = {
        name: 'fi_bank_credit_cooperative',
        label: '农村信用合作社（银行档）',
        when: { all: [
          { field: 'counterparty_type', op: 'eq', match: 'commercial_bank' },
          { field: 'is_credit_cooperative', op: 'eq', match: 'yes' },
        ] },
        value: 0.5,
        note: '【模拟·由自然语言助手生成】交易对手为农村信用合作社，归入商业银行风险暴露第二档中长期，权重 50%。关联第22条。',
        reference: { doc: '【模拟】澳门AMCM资本充足率指引', clause: '第22条', version: '2026版' },
      };
      if (Store.findRule(node.name)) { toast('该规则已存在，可能已保存过', 'warn'); return; }
      try {
        Store.addRule(node, 'fi_bank');
      } catch (e) { toast(e.message, 'err'); return; }
      // 补上字段声明
      const rs = Store.currentRuleset();
      if (!(rs.fields || []).find((f) => f.name === 'is_credit_cooperative')) {
        rs.fields.push({
          name: 'is_credit_cooperative', label: '是否农村信用合作社', type: 'enum', source: 'manual',
          meaning: '交易对手是否为农村信用合作社。由业务人员在产品字段中人工标识，不从 Excel 表头对齐。',
          options: [{ label: '是', code: 'yes' }, { label: '否', code: 'no' }],
        });
      }
      // 关联条款
      const c = MASTER.CLAUSES.find((x) => x.id === 'CL-MO-022');
      if (c && !(c.referencedBy || []).includes(node.name)) { c.referencedBy = c.referencedBy || []; c.referencedBy.push(node.name); }

      toast('规则已保存，并已同步反映在决策树中', 'ok');
      inputArea.innerHTML = '';
      inputArea.appendChild(h('div', { class: 'notice ok' },
        h('span', { class: 'ni' }, '✓'),
        h('div', {}, '规则已写入规则集，作为「对商业银行的暴露」的子档。决策树已同步更新，可在下方查看。')));
      renderTreePreview(node);
    }

    function renderTreePreview(node) {
      const rs = Store.currentRuleset();
      const box = h('div', { class: 'panel', style: { marginTop: '14px' } },
        h('div', { class: 'panel-head' }, h('h3', {}, '决策树已同步更新'),
          h('span', { class: 'sub' }, '新增规则出现在「对商业银行的暴露」节点之下，未改变外层 rules 顺序')),
        h('div', { class: 'panel-body' },
          h('div', { class: 'tree-canvas', style: { maxHeight: '300px', border: '1px solid var(--line-2)', borderRadius: '6px' } },
            (() => {
              const f = Store.findRule('fi_bank');
              const t = V.DecisionTree(f ? { rules: [f.node] } : { rules: [] }, {});
              return t.el;
            })()),
          h('div', { class: 'btn-group', style: { marginTop: '10px' } },
            h('button', { class: 'btn sm primary', onclick: () => App.go('tree') }, '在完整决策树中查看'),
            h('button', { class: 'btn sm', onclick: () => App.go('wizard') }, '用新规则重新计量'))));
      root.appendChild(box);
      const c = document.querySelector('.content');
      if (c) c.scrollTop = c.scrollHeight;
    }

    root.appendChild(panel('对话式规则配置', {
      sub: '示例：针对当前澳门监管版本下的对公贷款，新增一条针对特定交易对手类型的暴露分类规则，并关联相应监管条款',
    },
      chat,
      h('div', { style: { marginTop: '14px', borderTop: '1px solid var(--line-2)', paddingTop: '12px' } },
        inputArea,
        h('div', { class: 'btn-group' },
          h('button', { class: 'btn', onclick: () => {
            if (chat.children.length) { chat.innerHTML = ''; scriptIndex = 0; draftRule = null; }
            advance();
          } }, chat.children.length ? '重新播放模拟对话' : '▶ 播放模拟对话'),
          h('button', { class: 'btn ghost', onclick: () => toast('真实接入大模型需配置模型服务，原型未实现', 'warn') }, '接入真实模型（未实现）')))));

    // 自动播放
    advance();
  });
})();
