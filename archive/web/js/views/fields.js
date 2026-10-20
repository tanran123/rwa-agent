/** 模块二：产品类型管理、产品标准字段、原始字段映射 */
(function () {
  const { h, panel, tag, notice, makeTable, openDrawer, openModal, toast, kv, simBadge, confirmDialog } = UI;

  /* ==================== 产品类型 + 标准字段 ==================== */
  App.register('fields', (root) => {
    App.setHeader('产品标准字段管理', '规则写字段 name，不写 Excel 表头。手工字段不要从表格对齐。');
    root.innerHTML = '';

    let activeProduct = Object.keys(MASTER.PRODUCT_FIELDS)[0];

    /* 产品类型卡片 */
    const prodGrid = h('div', { class: 'grid c4' });
    function renderProducts() {
      prodGrid.innerHTML = '';
      MASTER.PRODUCT_TYPES.forEach((p) => {
        const fields = MASTER.PRODUCT_FIELDS[p.code] || [];
        const card = h('div', {
          class: 'fblock', style: {
            cursor: 'pointer',
            borderColor: activeProduct === p.code ? 'var(--brand-2)' : '',
            boxShadow: activeProduct === p.code ? '0 0 0 2px rgba(43,108,176,.12)' : '',
          },
          onclick: () => { activeProduct = p.code; renderProducts(); renderFields(); },
        },
          h('div', { class: 'fh' },
            h('span', {
              style: {
                width: '22px', height: '22px', borderRadius: '5px', background: p.color, color: '#fff',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '11px', fontWeight: '700', flex: '0 0 22px',
              },
            }, p.icon),
            h('span', { class: 'fname' }, p.label),
            h('span', { class: 'fcode' }, p.code)),
          h('div', { class: 'fmean', style: { fontSize: '11px' } }, p.desc),
          h('div', { class: 'fmeta' },
            h('span', {}, `${fields.length} 个标准字段`),
            h('span', {}, p.system),
            h('span', { class: `tag ${p.onboarding === 'manual' ? 'warn' : 'muted'}` },
              p.onboarding === 'manual' ? '人工录入' : '列式导入')));
        prodGrid.appendChild(card);
      });
    }

    const fieldPanel = h('div');
    function renderFields() {
      fieldPanel.innerHTML = '';
      const p = MASTER.PRODUCT_TYPES.find((x) => x.code === activeProduct);
      const fields = MASTER.PRODUCT_FIELDS[activeProduct] || [];
      const reqCount = fields.filter((f) => f.required).length;

      const cols = [
        { key: 'code', title: '字段编码', cls: 'mono' },
        { key: 'name', title: '标准字段名称' },
        { key: 'stdField', title: '对应规则字段', value: (r) => r.stdField || '—', cls: 'mono' },
        { key: 'type', title: '数据类型', value: (r) => r.type, html: (r) => `<span class="tag outline">${r.type}${r.unit ? ' · ' + r.unit : ''}</span>` },
        { key: 'required', title: '必填', value: (r) => (r.required ? '是' : '否'),
          html: (r) => r.required ? '<span class="tag danger">必填</span>' : '<span class="tag muted">选填</span>' },
        { key: 'sourceSystem', title: '来源系统' },
        { key: 'sourceField', title: '来源字段', cls: 'mono' },
        { key: 'transform', title: '转换规则' },
        { key: 'n', title: '被引用', value: (r) => (r.referencedBy || []).length,
          html: (r) => (r.referencedBy || []).length
            ? `<span class="tag brand">${r.referencedBy.length} 条条款</span>` : '<span class="tag muted">—</span>' },
      ];

      const tbl = makeTable({
        columns: cols, rows: fields, pageSize: 20,
        onRowClick: (r) => showField(r, p),
      });

      fieldPanel.appendChild(panel(`${p.label} · 标准字段配置`, {
        sub: `${fields.length} 个字段，其中 ${reqCount} 个必填 · 关联监管规则版本 ${p.ruleVersion}`,
        tight: true,
        actions: h('div', { class: 'btn-group' },
          h('button', { class: 'btn primary sm', onclick: () => editField(null, p) }, '＋ 新增字段'),
          h('button', { class: 'btn sm', onclick: () => copyProduct(p) }, '复制产品配置'),
          h('button', { class: 'btn sm', onclick: () => App.go('productRules') }, '配置暴露分类规则'),
          h('button', { class: 'btn sm', onclick: () => showProductJson(p) }, '查看规则字段')),
      }, tbl.el));

      /* 字段分组明细 */
      const detail = h('div', { class: 'grid c2' });
      const groups = {
        '必填字段': fields.filter((f) => f.required),
        '选填字段': fields.filter((f) => !f.required),
      };
      Object.entries(groups).forEach(([gname, list]) => {
        const box = h('div', { class: 'panel' },
          h('div', { class: 'panel-head' }, h('h3', {}, gname), h('span', { class: 'sub' }, `${list.length} 个`)),
          h('div', { class: 'panel-body' }));
        const b = box.querySelector('.panel-body');
        if (!list.length) b.appendChild(h('div', { class: 'empty' }, '无'));
        list.forEach((f) => b.appendChild(fieldCard(f, p)));
        detail.appendChild(box);
      });
      fieldPanel.appendChild(detail);

      /* 被哪些规则引用 */
      const ruleRefs = {};
      fields.forEach((f) => (f.referencedBy || []).forEach((cl) => {
        ruleRefs[cl] = ruleRefs[cl] || [];
        ruleRefs[cl].push(f.name);
      }));
      const rrBox = h('div', { class: 'panel' },
        h('div', { class: 'panel-head' }, h('h3', {}, '字段被哪些计量规则引用'),
          h('span', { class: 'sub' }, '规则引用产品标准字段作为判断输入')),
        h('div', { class: 'panel-body tight' }));
      const rrTbl = h('table', { class: 'tbl compact' },
        h('thead', {}, h('tr', {}, ['监管条款', '引用的标准字段'].map((t) => h('th', {}, t)))),
        h('tbody', {}, Object.entries(ruleRefs).length ? Object.entries(ruleRefs).map(([cl, fs]) => h('tr', {},
          h('td', {}, h('span', { class: 'ruletag' }, cl)),
          h('td', {}, fs.join('、')))) : h('tr', {}, h('td', { colspan: 2 }, h('div', { class: 'empty' }, '暂无')))));
      rrBox.querySelector('.panel-body').appendChild(h('div', { class: 'table-wrap' }, rrTbl));
      fieldPanel.appendChild(rrBox);
    }

    function fieldCard(f, p) {
      return h('div', { class: 'fblock', style: { cursor: 'pointer' }, onclick: () => showField(f, p) },
        h('div', { class: 'fh' },
          h('span', { class: 'fname' }, f.name),
          h('span', { class: 'fcode' }, f.code),
          f.required ? h('span', { class: 'tag danger' }, '必填') : null,
          h('span', { class: 'tag outline' }, `${f.type}${f.unit ? ' · ' + f.unit : ''}`)),
        h('div', { class: 'fmean' }, f.meaning),
        h('div', { class: 'fmeta' },
          h('span', {}, `来源：${f.sourceSystem}.${f.sourceField}`),
          f.stdField ? h('span', {}, `规则字段：`, h('code', { class: 'mono' }, f.stdField)) : null,
          h('span', {}, `转换：${f.transform}`)),
        f.options && f.options.length
          ? h('div', { class: 'fopts' }, f.options.map((o) => h('span', { class: 'tag' }, o))) : null);
    }

    function showField(f, p) {
      const body = h('div', {});
      body.appendChild(kv([
        ['字段编码', f.code], ['标准字段名称', f.name],
        ['对应规则字段 name', { mono: true, node: h('code', {}, f.stdField || '—（不直接参与规则判断）') }],
        ['数据类型', `${f.type}${f.unit ? ' · 单位 ' + f.unit : ''}`],
        ['是否必填', f.required ? '必填' : '选填'],
        ['来源系统', f.sourceSystem], ['来源字段', { mono: true, node: h('code', {}, f.sourceField) }],
        ['转换规则', f.transform], ['校验规则', f.validate],
        ['可选值 / 枚举范围', f.options && f.options.length ? f.options.join('、') : '（无枚举约束）'],
        ['被哪些规则引用', (f.referencedBy || []).length ? f.referencedBy.join('、') : '（暂未被规则引用）'],
        ['所属产品', p.label],
      ]));
      // 找到规则集中的字段声明
      const rs = Store.currentRuleset();
      const declared = rs && (rs.fields || []).find((x) => x.name === f.stdField);
      if (declared) {
        body.appendChild(h('div', { class: 'panel', style: { marginTop: '13px' } },
          h('div', { class: 'panel-head' }, h('h3', {}, '规则集中的字段声明'),
            h('span', { class: 'sub' }, '大模型读 label / meaning / source / options 去对齐 Excel 表头')),
          h('div', { class: 'panel-body' }, window.Views.fieldBlock(declared))));
      }
      openDrawer({
        title: `标准字段 · ${f.name}`, body,
        footer: [
          h('button', { class: 'btn', onclick: () => { UI.closeDrawer(); editField(f, p); } }, '编辑'),
          h('button', { class: 'btn', onclick: () => App.go('wizard') }, '在计量向导中映射'),
        ],
      });
    }

    function editField(f, p) {
      const isNew = !f;
      const v = f ? { ...f } : {
        code: '', name: '', meaning: '', type: 'enum', unit: '', required: true,
        sourceSystem: '', sourceField: '', transform: '', validate: '', options: [], referencedBy: [], stdField: '',
      };
      const mk = (k, lbl, type = 'text', hint) => {
        const inp = type === 'select'
          ? h('select', {}, ['enum', 'list', 'number', 'string'].map((t) => h('option', { value: t, selected: t === v.type }, t)))
          : h('input', { type, value: v[k] == null ? '' : v[k] });
        inp.oninput = inp.onchange = () => { v[k] = inp.value; };
        return h('div', { class: 'field' }, h('label', {}, lbl), inp, hint ? h('div', { class: 'hint' }, hint) : null);
      };
      const optsInp = h('input', { type: 'text', value: (v.options || []).join('、'), placeholder: '用「、」分隔，例如：公司、自然人、商业银行' });
      optsInp.oninput = () => { v.options = optsInp.value.split(/[、,，]/).map((s) => s.trim()).filter(Boolean); };
      const body = h('div', { class: 'grid c2' },
        mk('code', '字段编码'), mk('name', '标准字段名称'),
        mk('type', '数据类型', 'select'), mk('unit', '单位（可选）', 'text', '比例填「比值」，金额填「元」，期限填「月」'),
        mk('sourceSystem', '来源系统'), mk('sourceField', '来源字段'),
        mk('stdField', '对应规则字段 name', 'text', '填写规则集 fields 中的 name；不参与规则判断则留空'),
        mk('required', '是否必填', 'select'),
        h('div', { class: 'field', style: { gridColumn: '1 / -1' } }, h('label', {}, '业务含义及数据定义'),
          (() => { const t = h('textarea', {}, v.meaning); t.oninput = () => { v.meaning = t.value; }; return t; })()),
        h('div', { class: 'field', style: { gridColumn: '1 / -1' } }, h('label', {}, '字段转换规则'),
          (() => { const t = h('textarea', {}, v.transform); t.oninput = () => { v.transform = t.value; }; return t; })()),
        h('div', { class: 'field', style: { gridColumn: '1 / -1' } }, h('label', {}, '可选值 / 枚举范围'), optsInp));
      // required 用 select 不合适，改成 checkbox
      const md = openModal({
        title: isNew ? `新增标准字段 · ${p.label}` : `编辑标准字段 · ${f.name}`,
        wide: true,
        body: [notice('info', '字段编码在系统内唯一；对应规则字段 name 需与规则集 fields 中的 name 保持一致，规则才能读到该字段。', '填写说明：'), body],
        footer: [
          h('button', { class: 'btn', onclick: () => md.close() }, '取消'),
          h('button', {
            class: 'btn primary',
            onclick: () => {
              if (!v.code || !v.name) { toast('字段编码与名称为必填项', 'warn'); return; }
              const list = MASTER.PRODUCT_FIELDS[p.code] = MASTER.PRODUCT_FIELDS[p.code] || [];
              if (isNew) { list.push(v); toast(`已新增标准字段「${v.name}」`, 'ok'); }
              else { Object.assign(f, v); toast(`已保存字段「${v.name}」`, 'ok'); }
              md.close(); renderFields();
            },
          }, isNew ? '新增' : '保存'),
        ],
      });
    }

    function copyProduct(p) {
      confirmDialog({
        title: '复制产品配置',
        message: `将以「${p.label}」为基础创建新产品类型的完整字段配置副本，可在副本上独立调整，不影响原产品。是否继续？`,
        okText: '复制',
      }).then((ok) => {
        if (!ok) return;
        const code = p.code + '_copy';
        const np = { ...p, code, label: p.label + '（副本）' };
        MASTER.PRODUCT_TYPES.push(np);
        MASTER.PRODUCT_FIELDS[code] = JSON.parse(JSON.stringify(MASTER.PRODUCT_FIELDS[p.code] || []));
        MASTER.PRODUCT_EXPOSURE_RULES[code] = JSON.parse(JSON.stringify(MASTER.PRODUCT_EXPOSURE_RULES[p.code] || []));
        toast(`已复制为「${np.label}」`, 'ok');
        activeProduct = code; renderProducts(); renderFields();
      });
    }

    function showProductJson(p) {
      const rs = Store.currentRuleset();
      const usedNames = new Set((MASTER.PRODUCT_FIELDS[p.code] || []).map((f) => f.stdField).filter(Boolean));
      const decl = (rs.fields || []).filter((f) => usedNames.has(f.name));
      openDrawer({
        title: `${p.label} · 关联的规则集字段声明`,
        body: h('div', {},
          notice('info', `本产品用到 ${decl.length} 个规则集字段。以下内容摘自规则集 JSON 的 fields 段，是规则引擎真正读取的定义。`, '说明：'),
          h('div', { class: 'codeblock' }, JSON.stringify(decl, null, 2))),
      });
    }

    renderProducts();
    renderFields();
    root.appendChild(panel('产品类型管理', {
      sub: `${MASTER.PRODUCT_TYPES.length} 个产品类型 · 点击卡片切换下方标准字段配置`,
      actions: h('div', { class: 'btn-group' },
        h('button', { class: 'btn primary sm', onclick: () => toast('新增产品类型：请在原型中扩展（演示为提示）', 'warn') }, '＋ 新增产品类型'),
        h('button', { class: 'btn sm', onclick: () => App.go('productRules') }, '配置暴露分类规则')),
    }, prodGrid));
    root.appendChild(fieldPanel);
  });
})();
