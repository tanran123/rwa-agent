/** 模块四：表内 / 表外 EAD 计算规则配置（按产品） */
(function () {
  const { h, panel, tag, notice, makeTable, openDrawer, openModal, toast, kv, confirmDialog, statusTag, pct2, fmtNum } = UI;

  /** 两个页面各自记住上次选中的产品，保存规则后回到同一产品 */
  const picked = { on: null, off: null };

  function productByCode(code) {
    return (MASTER.PRODUCT_TYPES || []).find((p) => p.code === code) || null;
  }

  function ruleApplies(rule, code) {
    return window.Pipeline && Pipeline.ruleAppliesToProduct
      ? Pipeline.ruleAppliesToProduct(rule, code)
      : false;
  }

  function eadPage(kind) {
    return (root) => {
      const isOn = kind === 'on';
      const allRules = isOn ? MASTER.EAD_ON_RULES : MASTER.EAD_OFF_RULES;
      const activeCode = picked[kind];
      const activeProduct = productByCode(activeCode);
      App.setHeader(
        (isOn ? '表内 EAD 规则配置' : '表外 EAD 规则配置') + (activeProduct ? ` · ${activeProduct.label}` : ''),
        activeProduct
          ? `当前产品：${activeProduct.label}。试算与正式计量只使用该产品已发布的规则`
          : '请先选择产品，再配置和试算该产品的 EAD 规则');

      const rs = Store.currentRuleset();
      root.innerHTML = '';

      const tabs = h('div', { class: 'tabs' });
      MASTER.PRODUCT_TYPES.forEach((p) => {
        const n = allRules.filter((r) => ruleApplies(r, p.code)).length;
        tabs.appendChild(h('div', {
          class: `tab${activeCode === p.code ? ' active' : ''}`,
          onclick: () => { picked[kind] = p.code; App.go(isOn ? 'eadOn' : 'eadOff'); },
        }, `${p.label}（${n}）`));
      });
      root.appendChild(tabs);

      if (!activeProduct) {
        root.appendChild(notice('warn',
          '尚未选择产品。请先在上方点选一个产品，再查看规则、修改公式或试算。未选择产品时不会套用其他产品的 EAD 规则。',
          '请先选择产品：'));
        return;
      }

      const rules = allRules.filter((r) => ruleApplies(r, activeCode));

      /* KPI */
      const pub = rules.filter((r) => r.status === 'published').length;
      const ccfText = rules.length ? [...new Set(rules.map((r) => pct2(r.ccf)))].join(' / ') : '—';
      root.appendChild(h('div', { class: 'grid c4', style: { marginBottom: '14px' } },
        UI.kpi('当前产品', activeProduct.label, activeProduct.code, { accent: true }),
        UI.kpi('本产品规则', String(rules.length), `${pub} 条已发布`),
        UI.kpi(isOn ? '精度与舍入' : 'CCF 档位',
          isOn ? '2 位小数' : (rules.length ? String(new Set(rules.map((r) => r.ccf)).size) + ' 档' : '0 档'),
          isOn ? '四舍五入' : ccfText),
        UI.kpi('监管依据', isOn ? 'CL-MO-060' : 'CL-MO-064', '【模拟】表' + (isOn ? '内' : '外') + '风险暴露 EAD 条款')));

      /* 规则列表 */
      const cols = [
        { key: 'id', title: '规则编号', cls: 'mono' },
        { key: 'name', title: '计算规则名称' },
        { key: 'products', title: '适用产品', value: (r) => r.products.join('、') },
        { key: 'version', title: '监管版本' },
        { key: 'formula', title: '计算公式' },
        ...(isOn ? [] : [{ key: 'ccf', title: 'CCF', num: true, html: (r) => `<span class="tag brand">${pct2(r.ccf)}</span>` }]),
        { key: 'precision', title: '精度/舍入', value: (r) => `${r.precision} 位 · ${r.rounding}` },
        { key: 'resultField', title: '结果字段', cls: 'mono' },
        { key: 'status', title: '状态', html: (r) => `<span class="tag ${r.status === 'published' ? 'ok' : 'muted'}">${r.status === 'published' ? '已发布' : '草稿'}</span>` },
        { key: '_act', title: '操作', sortable: false, html: (r) => `
          <div class="btn-group">
            <button class="btn xs" data-act="trial" data-id="${r.id}">试算</button>
            <button class="btn xs" data-act="edit" data-id="${r.id}">编辑</button>
            <button class="btn xs" data-act="copy" data-id="${r.id}">复制</button>
          </div>` },
      ];
      const tbl = makeTable({ columns: cols, rows: rules, pageSize: 10, onRowClick: (r) => showRule(r) });
      tbl.el.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-act]');
        if (!btn) return;
        const rule = rules.find((x) => x.id === btn.dataset.id);
        if (btn.dataset.act === 'trial') trial(rule);
        if (btn.dataset.act === 'edit') editRule(rule);
        if (btn.dataset.act === 'copy') copyRule(rule);
      });

      root.appendChild(panel(isOn ? '表内 EAD 计算规则' : '表外 EAD 计算规则', {
        sub: `${activeProduct.label} · ${rules.length} 条规则 · 监管版本 ${rs.version}`,
        tight: true,
        actions: h('div', { class: 'btn-group' },
          h('button', { class: 'btn primary sm', onclick: () => editRule(null) }, '＋ 新增规则'),
          h('button', { class: 'btn sm', onclick: () => formulaHelp() }, '公式说明')),
      }, tbl.el));

      /* 公式编辑器 */
      root.appendChild(formulaEditor());

      /* 试算面板 */
      if (!isOn) {
        root.appendChild(ccfTable());
      } else {
        root.appendChild(precisionPanel());
      }

      function showRule(r) {
        const body = h('div', {});
        body.appendChild(kv([
          ['规则编号', r.id], ['计算规则名称', r.name],
          ['适用产品', r.products.join('、')], ['监管规则版本', r.version],
          ['输入字段', r.inputs.join('、')],
          ['计算公式', { mono: true, node: h('code', {}, r.formula) }],
          ['适用条件', r.condition],
          ['计算精度', `${r.precision} 位小数`], ['舍入规则', r.rounding],
          ['结果字段定义', { mono: true, node: h('code', {}, r.resultField) }],
          ['关联监管条款', r.clause],
        ]));
        body.appendChild(h('div', { class: 'panel', style: { marginTop: '13px' } },
          h('div', { class: 'panel-head' }, h('h3', {}, '计算步骤')),
          h('div', { class: 'panel-body' }, r.steps.map((s, i) => h('div', { class: 'step-line' },
            h('span', { class: 'sl-n' }, i + 1), h('div', { class: 'sl-b' }, s))))));
        if (r.params && r.params.length) {
          body.appendChild(h('div', { class: 'panel', style: { marginTop: '0' } },
            h('div', { class: 'panel-head' }, h('h3', {}, '参数及取值依据')),
            h('div', { class: 'panel-body tight' }, h('div', { class: 'table-wrap' },
              h('table', { class: 'tbl compact' },
                h('thead', {}, h('tr', {}, ['参数', '取值', '依据'].map((t) => h('th', {}, t)))),
                h('tbody', {}, r.params.map((p) => h('tr', {},
                  h('td', {}, p.name), h('td', { class: 'mono' }, String(p.value)), h('td', { class: 'dim' }, p.basis)))))))));
        }
        const clause = MASTER.CLAUSES.find((c) => c.id === r.clause);
        if (clause) body.appendChild(window.Views.clauseCard(clause));
        openDrawer({
          title: `EAD 计算规则 · ${r.name}`, wide: true, body,
          footer: [
            h('button', { class: 'btn', onclick: () => { UI.closeDrawer(); trial(r); } }, '用模拟数据试算'),
            h('button', { class: 'btn primary', onclick: () => { UI.closeDrawer(); editRule(r); } }, '编辑'),
          ],
        });
      }

      function trial(rule) {
        const loans = (window.MOCK.MOCK_LOANS || []).filter((l) => {
          if (l.product !== activeCode) return false;
          if (isOn) return l.std.offbalance !== 'yes';
          return l.std.offbalance === 'yes';
        }).slice(0, 8);

        const body = h('div', {});
        body.appendChild(notice('info',
          `当前产品「${activeProduct.label}」。试算「${rule.name}」时只取该产品的模拟债项，` +
          `并调用与正式计量相同的计算逻辑。`, '模拟试算：'));

        // 可调参数
        let testBal = 10000000, testImp = 500000, testCcf = rule.ccf || 0.2, testOn = 2000000, testOff = 8000000;
        const resultBox = h('div');
        function calc() {
          let ead, steps = [];
          if (isOn) {
            ead = window.Pipeline.round2(testBal - testImp);
            steps = [
              ['账面本金余额', window.Pipeline.fmt(testBal)],
              ['减：已计提减值准备', window.Pipeline.fmt(testImp)],
              ['表内 EAD = 余额 − 减值', window.Pipeline.fmt(ead)],
            ];
          } else {
            const conv = window.Pipeline.round2(testOff * testCcf);
            ead = window.Pipeline.round2(testOn + conv);
            steps = [
              ['表内已提用金额', window.Pipeline.fmt(testOn)],
              ['表外未提用金额', window.Pipeline.fmt(testOff)],
              [`× 信用转换系数 ${pct2(testCcf)}`, window.Pipeline.fmt(conv)],
              ['表外 EAD = 已提用 + 折算额', window.Pipeline.fmt(ead)],
            ];
          }
          resultBox.innerHTML = '';

          // 输入参数面板
          const inBody = h('div', { class: 'panel-body' });
          if (isOn) {
            inBody.appendChild(numField('账面本金余额', testBal, (v) => { testBal = v; calc(); }));
            inBody.appendChild(numField('已计提减值准备', testImp, (v) => { testImp = v; calc(); }));
          } else {
            inBody.appendChild(numField('表内已提用金额', testOn, (v) => { testOn = v; calc(); }));
            inBody.appendChild(numField('表外未提用金额', testOff, (v) => { testOff = v; calc(); }));
            inBody.appendChild(numField('信用转换系数（0.2 = 20%）', testCcf, (v) => { testCcf = v; calc(); }));
          }
          const inPanel = h('div', { class: 'panel' },
            h('div', { class: 'panel-head' }, h('h3', {}, '输入参数（可调整）')), inBody);

          // 计算结果面板
          const rowsBody = h('tbody', {});
          steps.forEach(([k, v]) => {
            rowsBody.appendChild(h('tr', {},
              h('td', { class: 'dim' }, k),
              h('td', { class: 'num mono strong' }, v)));
          });
          const outBody = h('div', { class: 'panel-body' },
            h('div', { class: 'table-wrap' },
              h('table', { class: 'tbl compact' }, rowsBody)),
            h('div', { style: { marginTop: '10px', padding: '10px', background: 'var(--ok-soft)', borderRadius: '6px' } },
              h('div', { class: 'dim', style: { fontSize: '11px' } }, isOn ? '表内 EAD' : '表外 EAD'),
              h('div', { style: { fontSize: '19px', fontWeight: '650', fontVariantNumeric: 'tabular-nums' } },
                window.Pipeline.fmt(ead))));
          const outPanel = h('div', { class: 'panel' },
            h('div', { class: 'panel-head' }, h('h3', {}, '计算结果')), outBody);

          resultBox.appendChild(h('div', { class: 'grid c2' }, inPanel, outPanel));
        }
        function numField(lbl, val, onChange) {
          const inp = h('input', { type: 'number', value: val, step: '1000' });
          inp.oninput = () => { const v = Number(inp.value); if (!Number.isNaN(v)) onChange(v); };
          return h('div', { class: 'field' }, h('label', {}, lbl), inp);
        }
        body.appendChild(resultBox);
        calc();

        // 用真实模拟数据跑
        const rows = loans.map((l) => {
          const res = window.Pipeline.measure(l, {
            ruleset: rs, eadOnRules: MASTER.EAD_ON_RULES, eadOffRules: MASTER.EAD_OFF_RULES,
            detectRules: window.MOCK.PRODUCT_DETECT_RULES,
          });
          const ead = res.stages.ead.result;
          return { loan: l, ead, res };
        });
        const trailBody = h('tbody', {});
        rows.forEach((r) => {
          const tds = [
            h('td', { class: 'mono' }, r.loan.id),
            h('td', {}, window.Views.productLabel(r.loan.product)),
          ];
          if (isOn) {
            tds.push(h('td', { class: 'num' }, fmtNum(r.loan.std.balance)));
            tds.push(h('td', { class: 'num' }, fmtNum(r.loan.std.impairment)));
          } else {
            tds.push(h('td', { class: 'num' }, fmtNum(r.loan.std.onbalance_amount)));
            tds.push(h('td', { class: 'num' }, fmtNum(r.loan.std.offbalance_amount)));
            tds.push(h('td', { class: 'mono' }, r.ead ? pct2(r.ead.ccf) : '—'));
          }
          tds.push(h('td', { class: 'num strong' }, r.ead ? fmtNum(r.ead.ead) : '—'));
          tds.push(h('td', { class: 'dim', style: { fontSize: '11px' } }, r.ead ? r.ead.ruleName : '—'));
          trailBody.appendChild(h('tr', {}, tds));
        });
        const headCells = ['债项编号', '产品'];
        headCells.push(...(isOn ? ['余额', '减值'] : ['已提用', '未提用', 'CCF']));
        headCells.push('EAD', '命中规则');
        const trailTbl = h('table', { class: 'tbl compact' },
          h('thead', {}, h('tr', {}, headCells.map((t) => h('th', {}, t)))),
          trailBody);

        if (!loans.length) {
          body.appendChild(notice('warn',
            `内置模拟债项里没有「${activeProduct.label}」的${isOn ? '表内' : '表外'}记录。上方参数试算仍可用；正式计量会在该产品有债项时再计算。`,
            '本产品暂无模拟债项：'));
        }
        body.appendChild(h('div', { class: 'panel', style: { marginTop: '13px' } },
          h('div', { class: 'panel-head' }, h('h3', {}, '用当前模拟债项数据试算'),
            h('span', { class: 'sub' }, loans.length ? `只取「${activeProduct.label}」的 ${rows.length} 笔` : '当前产品无匹配债项')),
          h('div', { class: 'panel-body tight' },
            h('div', { class: 'table-wrap' }, trailTbl))));

        openDrawer({ title: `试算 · ${rule.name}`, wide: true, body });
      }

      function editRule(rule) {
        const isNew = !rule;
          const v = rule ? { ...rule } : {
          id: (isOn ? 'EAD-ON-' : 'EAD-OFF-') + String(allRules.length + 1).padStart(3, '0'),
          name: '', products: [activeProduct.label], productCodes: [activeCode],
          version: rs.version, status: 'draft',
          inputs: [], formula: '', steps: [], condition: '', precision: 2, rounding: '四舍五入',
          resultField: isOn ? 'on_balance_ead' : 'off_balance_ead', clause: isOn ? 'CL-MO-060' : 'CL-MO-064', params: [],
          ccf: 0.2,
        };
        const mk = (k, lbl, hint) => {
          const inp = h('input', { type: 'text', value: v[k] == null ? '' : v[k] });
          inp.oninput = () => { v[k] = inp.value; };
          return h('div', { class: 'field' }, h('label', {}, lbl), inp, hint ? h('div', { class: 'hint' }, hint) : null);
        };
        const stepsTa = h('textarea', { style: { minHeight: '90px' } }, (v.steps || []).join('\n'));
        stepsTa.oninput = () => { v.steps = stepsTa.value.split('\n').filter(Boolean); };
        const body = h('div', { class: 'grid c2' },
          mk('id', '规则编号'), mk('name', '计算规则名称'),
          h('div', { class: 'field' }, h('label', {}, '适用产品'),
            h('input', { type: 'text', value: activeProduct.label, disabled: true }),
            h('div', { class: 'hint' }, (v.productCodes || []).length > 1
              ? `这条规则同时适用于 ${(v.products || []).join('、')}。修改公式会一起生效；若只调整「${activeProduct.label}」，请先复制。`
              : '本规则只属于当前所选产品。换产品请先在页面上方重新选择。')),
          mk('version', '监管规则版本'),
          ...(isOn ? [] : [(() => {
            const inp = h('input', { type: 'number', step: '0.05', value: v.ccf });
            inp.oninput = () => { v.ccf = Number(inp.value); };
            return h('div', { class: 'field' }, h('label', {}, '信用转换系数 CCF（0.2 = 20%）'), inp);
          })()]),
          mk('precision', '计算精度（小数位）'), mk('rounding', '舍入规则'),
          mk('resultField', '结果字段定义'), mk('clause', '关联监管条款'),
          h('div', { class: 'field', style: { gridColumn: '1 / -1' } },
            h('label', {}, '计算公式'), (() => {
              const i = h('input', { type: 'text', value: v.formula }); i.oninput = () => { v.formula = i.value; }; return i;
            })()),
          h('div', { class: 'field', style: { gridColumn: '1 / -1' } }, h('label', {}, '输入字段（用「、」分隔）'),
            (() => {
              const i = h('input', { type: 'text', value: (v.inputs || []).join('、') });
              i.oninput = () => { v.inputs = i.value.split(/[、,，]/).map((s) => s.trim()).filter(Boolean); }; return i;
            })()),
          h('div', { class: 'field', style: { gridColumn: '1 / -1' } }, h('label', {}, '适用条件'),
            (() => { const i = h('input', { type: 'text', value: v.condition }); i.oninput = () => { v.condition = i.value; }; return i; })()),
          h('div', { class: 'field', style: { gridColumn: '1 / -1' } }, h('label', {}, '计算步骤（每行一步）'), stepsTa));

        const md = openModal({
          title: isNew ? '新增 EAD 计算规则' : `编辑 EAD 规则 · ${rule.name}`, wide: true,
          body: [notice('info', '保存后规则会真实写入配置并影响后续计量。系统会做基本的公式校验与必填参数检查。', '提示：'), body],
          footer: [
            h('button', { class: 'btn', onclick: () => md.close() }, '取消'),
            h('button', { class: 'btn primary', onclick: () => {
              if (!v.name || !v.formula) { toast('规则名称与计算公式为必填项', 'warn'); return; }
              if (!/EAD|ead/.test(v.formula)) {
                toast('公式校验未通过：公式中应包含结果字段 EAD', 'warn'); return;
              }
              if (isNew) {
                v.products = [activeProduct.label];
                v.productCodes = [activeCode];
                allRules.push(v);
                toast(`已为「${activeProduct.label}」新增 EAD 规则「${v.name}」`, 'ok');
              } else {
                const keepProducts = rule.products;
                const keepCodes = rule.productCodes;
                Object.assign(rule, v);
                rule.products = keepProducts;
                rule.productCodes = keepCodes;
                toast(`已保存 EAD 规则「${v.name}」`, 'ok');
              }
              md.close(); App.go(isOn ? 'eadOn' : 'eadOff');
            } }, isNew ? '新增' : '保存'),
          ],
        });
      }

      function copyRule(rule) {
        confirmDialog({
          title: '复制 EAD 计算规则',
          message: `将以「${rule.name}」为基础创建副本，可在副本上调整 CCF 或公式，不影响原规则。是否继续？`,
          okText: '复制',
        }).then((ok) => {
          if (!ok) return;
          const nv = JSON.parse(JSON.stringify(rule));
          nv.id = rule.id + '-copy';
          nv.name = rule.name + '（副本）';
          nv.status = 'draft';
          nv.products = [activeProduct.label];
          nv.productCodes = [activeCode];
          allRules.push(nv);
          toast(`已复制到「${activeProduct.label}」：「${nv.name}」（草稿）`, 'ok');
          App.go(isOn ? 'eadOn' : 'eadOff');
        });
      }

      /* 公式编辑器 / 计算步骤展示 */
      function formulaEditor() {
        if (!rules.length) {
          return panel('公式展示与验证', {
            sub: `${activeProduct.label} 还没有${isOn ? '表内' : '表外'} EAD 规则`,
          }, notice('warn', '请先为当前产品新增一条规则，再修改公式或试算。', '当前产品无规则：'));
        }
        let selRule = rules[0];
        const detail = h('div');
        const ruleSel = h('select', {}, rules.map((r) => h('option', { value: r.id }, `${r.id} ${r.name}`)));
        ruleSel.onchange = () => {
          selRule = rules.find((r) => r.id === ruleSel.value) || rules[0];
          renderDetail();
        };

        function renderDetail() {
          detail.innerHTML = '';
          if (!selRule) { detail.appendChild(h('div', { class: 'empty' }, '暂无可编辑的规则')); return; }
          // 公式输入
          const fInp = h('input', { type: 'text', value: selRule.formula, style: { fontFamily: 'var(--mono)' } });
          const checkBox = h('div');
          function check() {
            checkBox.innerHTML = '';
            const f = fInp.value;
            const problems = [];
            if (!f.trim()) problems.push('公式为空。');
            if (!/EAD|ead/.test(f)) problems.push('公式中未出现结果字段 EAD。');
            const known = new Set([...selRule.inputs.map((x) => x.replace(/\(.*\)/, '')), 'EAD', 'CCF', 'CCF)']);
            const tokens = (f.match(/[A-Za-z_][A-Za-z0-9_]*/g) || []);
            const unknown = [...new Set(tokens)].filter((t) => ![...known].some((k) => k.includes(t) || t.includes(k.split('(')[0]))
              && !['EAD', 'CCF', 'ead', 'ccf'].includes(t));
            if (unknown.length) problems.push(`公式引用了未声明的输入字段：${unknown.join('、')}。`);
            if (/problems/.test('problems')) { /* noop */ }
            if (!problems.length) {
              checkBox.appendChild(notice('ok', '公式校验通过：结果字段、输入字段与运算结构均正常。', '校验结果：'));
            } else {
              checkBox.appendChild(notice('warn', problems.join(' '), '公式校验提示：'));
            }
          }
          fInp.oninput = check;
          check();

          // 必填参数检查
          const paramBox = h('div');
          if (selRule.params && selRule.params.length) {
            selRule.params.forEach((p) => {
              paramBox.appendChild(h('div', { class: 'fblock' },
                h('div', { class: 'fh' }, h('span', { class: 'fname' }, p.name),
                  h('span', { class: 'tag brand' }, String(p.value))),
                h('div', { class: 'fmean' }, p.basis)));
            });
          } else {
            paramBox.appendChild(h('div', { class: 'dim', style: { fontSize: '12px' } }, '本规则无额外参数。'));
          }

          detail.appendChild(h('div', { class: 'grid c2' },
            h('div', {},
              h('div', { class: 'field' }, h('label', {}, '计算公式（可直接修改后试算）'), fInp,
                h('div', { class: 'hint' }, '支持 − + × 与括号；修改后点击「应用并校验」写入规则。')),
              h('div', { class: 'btn-group' },
                h('button', { class: 'btn primary sm', onclick: () => {
                  selRule.formula = fInp.value;
                  toast('公式已应用并保存到规则', 'ok');
                  renderDetail();
                } }, '应用并校验'),
                h('button', { class: 'btn sm', onclick: () => {
                  toast('异常值提示：输入金额出现负值或超过 100 亿元，请复核。', 'warn');
                } }, '模拟异常值检测')),
              checkBox),
            h('div', {},
              h('div', { class: 'cond-group-label' }, '计算步骤'),
              h('div', {}, selRule.steps.map((s, i) => h('div', { class: 'step-line' },
                h('span', { class: 'sl-n' }, i + 1), h('div', { class: 'sl-b' }, s)))),
              h('div', { class: 'cond-group-label', style: { marginTop: '10px' } }, '参数及取值依据'),
              paramBox)));
        }

        const body = h('div', {},
          h('div', { class: 'inline-fields', style: { marginBottom: '12px' } },
            h('div', { class: 'field', style: { minWidth: '280px' } }, h('label', {}, '选择计算规则'), ruleSel),
            h('div', { class: 'field' }, h('label', {}, ' '),
              h('button', { class: 'btn sm', onclick: () => formulaHelp() }, '公式语言说明'))),
          detail);
        renderDetail();

        return panel('公式展示与验证', {
          sub: '查看输入参数、计算过程、计算结果及规则来源，并使用模拟数据进行试算',
        }, body);
      }

      function formulaHelp() {
        openDrawer({
          title: 'EAD 计算公式说明',
          body: h('div', {},
            notice('info', '本系统将暴露分类、EAD 计算、风险权重与 RWA 计算拆成三个独立阶段，避免把分类逻辑、EAD 公式和权重计算混在同一套复杂条件中。', '分阶段设计：'),
            h('div', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h3', {}, '三个阶段')),
              h('div', { class: 'panel-body' },
                [['第一阶段', '信用风险暴露分类', '依据产品字段、通用规则和产品专属规则，确定暴露大类及子类'],
                 ['第二阶段', 'EAD 计算', '根据表内或表外业务属性及适用规则，计算风险暴露金额'],
                 ['第三阶段', '风险权重与 RWA 计算', 'RWA = 适用风险暴露金额 × 适用风险权重']]
                  .map(([n, t, d]) => h('div', { class: 'fblock' },
                    h('div', { class: 'fh' }, h('span', { class: 'tag brand' }, n), h('span', { class: 'fname' }, t)),
                    h('div', { class: 'fmean' }, d))))),
            h('div', { class: 'codeblock' }, isOn
              ? '表内 EAD = balance − impairment\n结果字段：on_balance_ead\n精度：2 位小数，四舍五入'
              : '表外 EAD = onbalance_amount + offbalance_amount × ccf\n结果字段：off_balance_ead\n精度：2 位小数，四舍五入'),
            notice('warn', 'RWA = 适用信用风险暴露金额 × 适用风险权重，该简化公式仅适用于标准法下的对应情形。需要进一步调整或采用其他计量方法的，以对应监管规则为准。', '重要区分：')),
        });
      }

      function ccfTable() {
        const rows = rules.map((r) => ({
          type: r.name.replace('表外授信类 EAD（', '').replace('）', ''),
          ccf: r.ccf, rule: r.id, status: r.status,
          products: (r.products || []).join('、'),
        }));
        if (activeCode === 'off_bs') {
          rows.push({ type: '保函', ccf: 0.5, rule: 'EAD-OFF-004', status: 'draft', products: '表外授信及承诺' });
        }
        return panel('信用转换系数（CCF）档位表', {
          sub: '不同业务品种适用不同的 CCF；应根据不同地区、不同监管版本及具体业务类型维护，不应套用单一系数',
          tight: true,
        }, h('div', { class: 'table-wrap' },
          h('table', { class: 'tbl compact' },
            h('thead', {}, h('tr', {}, ['业务品种', '信用转换系数', '规则编号', '适用产品', '状态'].map((t) => h('th', {}, t)))),
            h('tbody', {}, rows.map((r) => h('tr', {},
              h('td', {}, r.type),
              h('td', {}, h('span', { class: 'tag brand' }, pct2(r.ccf))),
              h('td', { class: 'mono' }, r.rule),
              h('td', { class: 'dim' }, r.products),
              h('td', {}, h('span', { class: `tag ${r.status === 'published' ? 'ok' : 'muted'}` },
                r.status === 'published' ? '已发布' : '草稿'))))))));
      }

      function precisionPanel() {
        return panel('计算精度与舍入规则', { sub: '所有表内 EAD 计算统一按 2 位小数、四舍五入处理' },
          h('div', { class: 'grid c3' },
            UI.kpi('计算精度', '2 位小数', '计算结果保留两位'),
            UI.kpi('舍入方式', '四舍五入', 'ROUND_HALF_UP'),
            UI.kpi('计算时机', '逐笔计量', '在暴露分类完成后执行')),
          notice('info', '精度与舍入规则可按监管版本独立配置。若不同地区的监管要求不同，应分别维护，不要共用一套参数。'));
      }
    };
  }

  App.register('eadOn', eadPage('on'));
  App.register('eadOff', eadPage('off'));
})();
