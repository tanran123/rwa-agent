/** 模块一：监管规则版本管理 + 监管条款库 */
(function () {
  const { h, panel, tag, statusTag, notice, makeTable, openModal, openDrawer, toast, confirmDialog,
          kv, fmtNum, pct2, simBadge } = UI;
  const V = window.Views;

  /* ==================== 监管规则版本管理 ==================== */
  App.register('versions', (root) => {
    App.setHeader('监管规则版本管理', '三地规则分开维护。在已有版本上复制后再改，避免互相覆盖。');
    root.innerHTML = '';

    const ctx = Store.state.ctx;
    const rs = Store.currentRuleset();

    /* 版本列表 */
    const cols = [
      { key: 'jurisdiction', title: '司法管辖区', value: (r) => App.j2label(r.jurisdiction), width: '90px' },
      { key: 'version', title: '版本编号', cls: 'mono' },
      { key: 'name', title: '规则名称' },
      { key: 'ruleType', title: '规则类型' },
      { key: 'effectiveFrom', title: '生效日期', value: (r) => r.effectiveFrom + (r.effectiveTo ? ` 至 ${r.effectiveTo}` : ' 起') },
      { key: 'institution', title: '适用机构' },
      { key: 'status', title: '状态', value: (r) => MASTER.RULE_STATUS[r.status].label,
        html: (r) => `<span class="tag ${MASTER.RULE_STATUS[r.status].tone}">${MASTER.RULE_STATUS[r.status].label}</span>` },
      { key: 'author', title: '维护人' },
      { key: '_act', title: '操作', sortable: false, html: (r) => `
        <div class="btn-group">
          <button class="btn xs" data-act="open" data-id="${r.id}">打开</button>
          <button class="btn xs" data-act="edit" data-id="${r.id}">编辑</button>
          <button class="btn xs" data-act="copy" data-id="${r.id}">复制</button>
          <button class="btn xs" data-act="cmp" data-id="${r.id}">版本对比</button>
        </div>` },
    ];

    const filterBar = h('div', { class: 'inline-fields' });
    const jurSel = h('select', {}, [h('option', { value: '' }, '全部地区'),
      ...MASTER.JURISDICTIONS.map((j) => h('option', { value: j.code }, j.label))]);
    const stSel = h('select', {}, [h('option', { value: '' }, '全部状态'),
      ...Object.entries(MASTER.RULE_STATUS).map(([k, v]) => h('option', { value: v.label }, v.label))]);
    const search = h('input', { type: 'text', placeholder: '搜索版本编号或规则名称…' });
    filterBar.append(
      h('div', { class: 'field' }, h('label', {}, '司法管辖区'), jurSel),
      h('div', { class: 'field' }, h('label', {}, '规则状态'), stSel),
      h('div', { class: 'field', style: { flex: '1', minWidth: '200px' } }, h('label', {}, '关键字'), search));

    const tbl = makeTable({
      columns: cols,
      rows: MASTER.RULE_VERSIONS.map((v) => ({ ...v })),
      pageSize: 10,
      rowClass: (r) => (r.id === ctx.versionId ? 'sel' : ''),
      onRowClick: (r) => openVersionDetail(r),
    });
    jurSel.onchange = () => { tbl.setQuery(''); tbl.setFilter('jurisdiction', jurSel.value); tbl.setQuery(search.value); };
    stSel.onchange = () => { tbl.setQuery(''); tbl.setFilter('status', stSel.value); tbl.setQuery(search.value); };
    search.oninput = () => tbl.setQuery(search.value);

    // 事件委托处理行内按钮
    tbl.el.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      const id = btn.dataset.id;
      const ver = MASTER.RULE_VERSIONS.find((x) => x.id === id);
      if (!ver) return;
      if (btn.dataset.act === 'open') switchTo(ver);
      if (btn.dataset.act === 'edit') editVersion(ver);
      if (btn.dataset.act === 'copy') copyVersion(ver);
      if (btn.dataset.act === 'cmp') compareVersion(ver);
    });

    root.appendChild(panel('监管规则版本列表', {
      sub: `共 ${MASTER.RULE_VERSIONS.length} 个版本`,
      tight: true,
      actions: h('div', { class: 'btn-group' },
        h('button', { class: 'btn primary sm', onclick: () => editVersion(null) }, '＋ 新建版本'),
        h('button', { class: 'btn sm', onclick: () => toast('已导出规则版本清单（模拟）', 'ok') }, '导出清单')),
    }, filterBar, tbl.el));

    /* 当前版本详情 */
    root.appendChild(currentVersionPanel());

    /** 切换到某版本 */
    function switchTo(ver) {
      Store.state.ctx.jurisdiction = ver.jurisdiction;
      Store.state.ctx.versionId = ver.id;
      Store.loadRuleset(ver.jurisdiction).then(() => {
        Store.persist();
        App.renderTopbar();
        toast(`已切换至 ${ver.version}（${App.j2label(ver.jurisdiction)}）`, 'ok');
        App.go('versions');
      });
    }

    function openVersionDetail(ver) {
      const body = h('div', {});
      body.appendChild(kv([
        ['版本编号', ver.version], ['规则名称', ver.name],
        ['司法管辖区', App.j2label(ver.jurisdiction)],
        ['监管机构', (MASTER.JURISDICTIONS.find(j => j.code === ver.jurisdiction) || {}).regulator],
        ['适用机构', ver.institution], ['规则类型', ver.ruleType],
        ['生效日期', ver.effectiveFrom], ['失效日期', ver.effectiveTo || '（未设失效日期）'],
        ['状态', { node: h('span', { class: `tag ${MASTER.RULE_STATUS[ver.status].tone}` }, MASTER.RULE_STATUS[ver.status].label) }],
        ['维护人', ver.author], ['发布时间', ver.publishedAt],
        ['规则集文件', { mono: true, node: h('code', {}, ver.rulesetFile) }],
      ]));
      body.appendChild(h('div', { class: 'panel', style: { marginTop: '13px' } },
        h('div', { class: 'panel-head' }, h('h3', {}, '版本变更说明')),
        h('div', { class: 'panel-body', style: { fontSize: '12.5px', lineHeight: '1.75' } }, ver.changelog)));
      if (ver.effectiveTo) {
        body.appendChild(notice('warn', `本版本已于 ${ver.effectiveTo} 失效。历史计量批次仍按其当时使用的版本还原，不会自动套用新规则。`, '历史版本：'));
      }
      openDrawer({
        title: `版本详情 · ${ver.version}`,
        body,
        footer: [
          h('button', { class: 'btn', onclick: () => compareVersion(ver) }, '版本对比'),
          h('button', { class: 'btn primary', onclick: () => { UI.closeDrawer(); switchTo(ver); } }, '设为当前计量版本'),
        ],
      });
    }

    function editVersion(ver) {
      const isNew = !ver;
      const f = {
        jurisdiction: ver ? ver.jurisdiction : ctx.jurisdiction,
        version: ver ? ver.version : '',
        name: ver ? ver.name : '',
        ruleType: ver ? ver.ruleType : '资本充足率',
        effectiveFrom: ver ? ver.effectiveFrom : '2026-01-01',
        effectiveTo: ver ? (ver.effectiveTo || '') : '',
        status: ver ? ver.status : 'draft',
        institution: ver ? ver.institution : ctx.institution,
        author: ver ? ver.author : '当前用户',
        changelog: ver ? ver.changelog : '',
      };
      const mk = (k, labelText, type = 'text', opts) => {
        const inp = type === 'select'
          ? h('select', {}, opts.map(([v, l]) => h('option', { value: v, selected: v === f[k] }, l)))
          : h('input', { type, value: f[k] });
        inp.oninput = inp.onchange = () => { f[k] = inp.value; };
        return h('div', { class: 'field' }, h('label', {}, labelText), inp);
      };
      const body = h('div', { class: 'grid c2' },
        mk('jurisdiction', '司法管辖区', 'select', MASTER.JURISDICTIONS.map((j) => [j.code, j.label])),
        mk('version', '版本编号'),
        mk('name', '规则名称'),
        mk('ruleType', '规则类型', 'select', MASTER.RULE_TYPES.map((t) => [t, t])),
        mk('effectiveFrom', '生效日期', 'date'),
        mk('effectiveTo', '失效日期（可空）', 'date'),
        mk('status', '状态', 'select', Object.entries(MASTER.RULE_STATUS).map(([k2, v]) => [k2, v.label])),
        mk('institution', '适用机构'),
        h('div', { class: 'field', style: { gridColumn: '1 / -1' } },
          h('label', {}, '版本变更说明'),
          (() => { const t = h('textarea', {}, f.changelog); t.oninput = () => { f.changelog = t.value; }; return t; })()));

      const md = openModal({
        title: isNew ? '新建监管规则版本' : `编辑版本 · ${ver.version}`,
        wide: true,
        body: [notice('info', '新建版本时可从既有版本复制规则内容，避免不同地区的监管要求相互覆盖。', '提示：'), body],
        footer: [
          h('button', { class: 'btn', onclick: () => md.close() }, '取消'),
          h('button', {
            class: 'btn primary',
            onclick: () => {
              if (!f.version || !f.name) { toast('版本编号与规则名称为必填项', 'warn'); return; }
              if (isNew) {
                const nv = { id: 'rv-new-' + Date.now(), ...f, rulesetFile: Store.JURIS_FILES[f.jurisdiction],
                  publishedAt: '—', effectiveTo: f.effectiveTo || null };
                MASTER.RULE_VERSIONS.unshift(nv);
                toast(`已新建版本 ${f.version}，状态为草稿`, 'ok');
              } else {
                Object.assign(ver, f, { effectiveTo: f.effectiveTo || null });
                toast(`已保存版本 ${f.version} 的修改`, 'ok');
              }
              md.close(); App.go('versions');
            },
          }, isNew ? '创建' : '保存'),
        ],
      });
    }

    function copyVersion(ver) {
      const nv = {
        ...ver,
        id: 'rv-copy-' + Date.now(),
        version: ver.version.replace(/-\d+(\.\d+)?$/, '') + '-copy',
        name: ver.name + '（副本）',
        status: 'draft',
        effectiveFrom: ver.effectiveFrom,
        effectiveTo: null,
        publishedAt: '—',
        changelog: `由 ${ver.version} 复制而来。可在本地区已有版本基础上调整规则，不影响原版本。`,
      };
      confirmDialog({
        title: '复制监管规则版本',
        message: `将以「${ver.version}」为基础创建新版本「${nv.version}」，状态为草稿。` +
          `复制后两个版本相互独立，修改新版本不会影响原版本与其历史计量批次。是否继续？`,
        okText: '复制',
      }).then((ok) => {
        if (!ok) return;
        MASTER.RULE_VERSIONS.unshift(nv);
        toast(`已复制为 ${nv.version}（草稿）`, 'ok');
        App.go('versions');
      });
    }

    function compareVersion(ver) {
      const others = MASTER.RULE_VERSIONS.filter((x) => x.jurisdiction === ver.jurisdiction && x.id !== ver.id);
      if (!others.length) { toast('本地区暂无其他版本可供对比', 'warn'); return; }
      const other = others[0];
      const rsA = rs;
      const rows = [];
      const walk = (nodes, path, depth) => {
        (nodes || []).forEach((n, i) => {
          rows.push({ depth, name: n.name, label: n.label, weight: n.value, path });
          walk(n.children, path + '/' + i, depth + 1);
        });
      };
      walk(rsA.rules, '', 0);
      const body = h('div', {});
      body.appendChild(notice('info',
        `正在对比「${ver.version}」与「${other.version}」。左侧为当前加载的规则集结构，` +
        `右侧为另一版本的元数据。真实环境中应逐条比对规则条件与权重差异并生成变更清单。`, '版本对比：'));
      body.appendChild(h('div', { class: 'grid c2' },
        h('div', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h3', {}, ver.version + ' · 规则结构')),
          h('div', { class: 'panel-body tight' }, h('div', { class: 'table-wrap', style: { maxHeight: '380px', overflowY: 'auto' } },
            h('table', { class: 'tbl compact' },
              h('thead', {}, h('tr', {}, ['层级', '规则 name', '名称', '权重'].map((t) => h('th', {}, t)))),
              h('tbody', {}, rows.map((r) => h('tr', {},
                h('td', { style: { paddingLeft: (8 + r.depth * 14) + 'px' } }, r.depth === 0 ? '顶层' : '└ 子级'),
                h('td', { class: 'mono' }, r.name),
                h('td', {}, r.label),
                h('td', {}, r.weight != null ? pct2(r.weight) : '—')))))))),
        h('div', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h3', {}, other.version + ' · 版本信息')),
          h('div', { class: 'panel-body' }, kv([
            ['版本编号', other.version], ['规则名称', other.name],
            ['生效日期', `${other.effectiveFrom}${other.effectiveTo ? ' 至 ' + other.effectiveTo : ' 起'}`],
            ['状态', MASTER.RULE_STATUS[other.status].label],
            ['维护人', other.author],
            ['变更说明', other.changelog],
          ])))));
      const md = openModal({ title: `版本对比 · ${ver.version} ↔ ${other.version}`, wide: true, body,
        footer: [h('button', { class: 'btn', onclick: () => md.close() }, '关闭')] });
    }

    function currentVersionPanel() {
      const ver = Store.currentVersion();
      const fp = Store.rulesetFingerprint();
      return panel('当前计量版本（规则集指纹）', {
        sub: '每次计量都记录所使用的规则版本、参数版本与执行时间；规则更新后历史批次不会自动套用新规则',
      },
        kv([
          ['版本', `${ver.version}（${App.j2label(ver.jurisdiction)}）`],
          ['规则集 ID', { mono: true, node: h('code', {}, fp.rulesetId) }],
          ['规则节点总数', String(fp.nodes)],
          ['内容指纹', { mono: true, node: h('code', {}, fp.hash) }],
          ['指纹生成时间', fp.frozenAt],
          ['规则文件', { mono: true, node: h('code', {}, ver.rulesetFile) }],
        ]),
        h('div', { class: 'btn-group', style: { marginTop: '12px' } },
          h('button', { class: 'btn sm', onclick: () => App.go('tree') }, '查看决策树'),
          h('button', { class: 'btn sm', onclick: () => App.go('assistant') }, '自然语言改规则'),
          h('button', { class: 'btn sm', onclick: () => UI.copyText(JSON.stringify(rs, null, 2), '规则集 JSON 已复制') }, '复制规则集 JSON')));
    }
  });

  /* ==================== 监管条款库 ==================== */
  App.register('clauses', (root) => {
    App.setHeader('监管条款库', '条款和引用它的规则放在同一张表里。点一行看原文和引用。');
    root.innerHTML = '';

    const jurSel = h('select', {}, [h('option', { value: '' }, '全部地区'),
      ...MASTER.JURISDICTIONS.map((j) => h('option', { value: j.code }, j.label))]);
    const search = h('input', { type: 'text', placeholder: '搜索条款编号、标题或制度名称…' });

    const rows = MASTER.CLAUSES.map((c) => ({ ...c }));

    const cols = [
      { key: 'clause', title: '条款编号', cls: 'mono' },
      { key: 'title', title: '条款标题' },
      { key: 'jurisdiction', title: '司法管辖区', value: (r) => App.j2label(r.jurisdiction) },
      { key: 'doc', title: '制度名称' },
      { key: 'docVersion', title: '制度版本' },
      { key: 'scope', title: '适用业务范围' },
      { key: 'effectiveFrom', title: '生效日期' },
      { key: 'n', title: '被引用', sortable: true, num: true,
        value: (r) => (r.referencedBy || []).length,
        html: (r) => `<span class="tag ${(r.referencedBy||[]).length ? 'brand' : 'muted'}">${(r.referencedBy||[]).length} 条规则</span>` },
    ];

    const tbl = makeTable({ columns: cols, rows, pageSize: 12, onRowClick: (r) => showClause(r) });
    jurSel.onchange = () => { tbl.setQuery(search.value); tbl.setFilter('jurisdiction', jurSel.value); };
    search.oninput = () => tbl.setQuery(search.value);

    root.appendChild(panel('监管条款列表', {
      sub: `共 ${rows.length} 条模拟条款`,
      tight: true,
      actions: h('div', { class: 'btn-group' },
        h('button', { class: 'btn primary sm', onclick: () => toast('新建条款需接入监管制度原文库（原型未实现）', 'warn') }, '＋ 新增条款'),
        h('button', { class: 'btn sm', onclick: () => App.go('tree') }, '在决策树中查看关联')),
    },
      h('div', { class: 'inline-fields', style: { padding: '12px 15px 2px' } },
        h('div', { class: 'field' }, h('label', {}, '司法管辖区'), jurSel),
        h('div', { class: 'field', style: { flex: 1, minWidth: '220px' } }, h('label', {}, '关键字'), search)),
      tbl.el));

    function findRuleAcross(name) {
      const rs = Store.currentRuleset();
      if (!rs) return null;
      const found = Store.findRule(name);
      return found ? found.node : null;
    }

    function showClause(c) {
      const body = h('div', {});
      body.appendChild(h('div', { class: 'clause' },
        h('div', { class: 'ct' }, h('span', {}, c.clause), h('span', {}, c.title), h('span', { class: 'sim-badge' }, '模拟条款')),
        h('div', { class: 'ctext' }, c.text)));
      body.appendChild(kv([
        ['监管机构及司法管辖区', App.j2label(c.jurisdiction) + ' · ' + (MASTER.JURISDICTIONS.find(j => j.code === c.jurisdiction) || {}).regulator],
        ['制度名称', c.doc], ['制度版本', c.docVersion],
        ['具体条款编号', c.clause], ['适用业务范围', c.scope],
        ['生效日期', c.effectiveFrom], ['来源文件', c.source],
      ]));
      const refs = (c.referencedBy || []).map((rn) => {
        const f = findRuleAcross(rn);
        return h('tr', { class: 'clickable', onclick: () => { UI.closeDrawer(); App.go('tree'); } },
          h('td', { class: 'mono' }, rn),
          h('td', {}, f ? f.label : '（当前规则集中未找到）'));
      });
      body.appendChild(h('div', { class: 'panel', style: { marginTop: '13px' } },
        h('div', { class: 'panel-head' }, h('h3', {}, `被以下计量规则引用（${(c.referencedBy || []).length}）`)),
        h('div', { class: 'panel-body tight' }, h('div', { class: 'table-wrap' },
          h('table', { class: 'tbl compact' },
            h('thead', {}, h('tr', {}, ['规则 name', '规则名称'].map((t) => h('th', {}, t)))),
            h('tbody', {}, refs.length ? refs : h('tr', {}, h('td', { colspan: 2 }, h('div', { class: 'empty' }, '暂无引用')))))))));
      openDrawer({ title: `监管条款 · ${c.clause} ${c.title}`, body });
    }
  });
})();
