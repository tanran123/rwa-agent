/**
 * UI 基础库：DOM 构造、格式化、抽屉/模态/提示、表格排序分页。
 */
(function (global) {
  const h = (tag, attrs, ...kids) => {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'html') el.innerHTML = v;
        else if (k === 'text') el.textContent = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
        else if (k === 'dataset') Object.assign(el.dataset, v);
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    kids.flat(Infinity).forEach((c) => {
      if (c == null || c === false) return;
      el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    });
    return el;
  };

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  /* ---------- 数字/格式 ---------- */
  const fmtNum = (v, d = 2) => {
    if (v == null || v === '' || Number.isNaN(Number(v))) return '—';
    return Number(v).toLocaleString('zh-CN', { minimumFractionDigits: d, maximumFractionDigits: d });
  };
  const fmtInt = (v) => (v == null || v === '' ? '—' : Number(v).toLocaleString('zh-CN'));
  /** 金额按万元/亿元简写，用于 KPI */
  const fmtShort = (v) => {
    if (v == null || Number.isNaN(Number(v))) return '—';
    const n = Number(v);
    const a = Math.abs(n);
    if (a >= 1e8) return `${(n / 1e8).toFixed(2)} 亿`;
    if (a >= 1e4) return `${(n / 1e4).toFixed(2)} 万`;
    return n.toFixed(2);
  };
  const pct = (v, d = 4) => (v == null || Number.isNaN(Number(v)) ? '—' : `${+(Number(v) * 100).toFixed(d)}%`);
  const pct2 = (v) => pct(v, 2);

  /* ---------- 字段值展示 ---------- */
  const FIELD_LABELS = {
    instrument_type: '工具', is_defaulted: '是否已违约', counterparty_type: '交易对手',
    counterparty_name: '交易对手名称', balance: '债项余额', impairment: '减值准备',
    offbalance: '是否表外', onbalance_amount: '表内余额', offbalance_amount: '表外未提用金额',
    ccf: '信用转换系数', original_maturity_months: '原始期限', remaining_maturity_months: '剩余期限',
    ltv: '贷款价值比', has_property_collateral: '是否有房地产抵押', property_uses: '抵押物用途',
    cashflow_dependent: '还款是否实质依赖房地产现金流', prudent: '是否符合审慎要求',
    single_exposure: '对单一债务人的风险暴露', exposure_share: '占全行信用风险暴露的比例',
    provision_ratio: '损失准备比例', bank_tier: '银行档次', product_code: '产品代码',
    issuer_rating: '外部评级', pse_region: '公共部门所在地', is_subordinated: '是否次级债权',
    cross_border_trade: '是否跨境货物贸易', enterprise_size: '企业划型',
    revenue_last_year: '最近一年营业收入', meets_minimum_capital: '是否满足最低资本要求',
    audit_opinion: '外部审计意见', product_name: '产品', fi_bank_applicable: '是否适用',
  };

  const CODE_LABELS = {
    claim: '债权', equity: '股权', covered_bond: '资产担保债券', cash: '现金',
    yes: '是', no: '否', unknown: '无法判断',
    cn_central_government: '我国中央政府', cn_central_bank: '我国中央银行',
    foreign_sovereign: '其他主权国家或经济实体', pse: '公共部门实体', mdb: '多边开发银行',
    commercial_bank: '商业银行', other_fi: '其他金融机构', development_fi: '开发性金融机构',
    policy_bank: '政策性银行', corporate: '公司', partnership: '合伙制企业',
    sole_proprietorship: '独资企业', spe: '特殊目的实体', other_non_individual: '其他非自然人',
    individual: '自然人', domestic: '境内', overseas: '境外',
    residential: '居住', commercial: '商用', mixed_use: '商住两用',
    tier1: '第一档', tier2: '第二档', micro: '微型', small: '小型', medium: '中型', large: '大型',
    none: '无报告', unqualified: '无保留', qualified: '保留', adverse: '否定',
    disclaimer: '无法表示', going_concern: '持续经营存疑',
    not_rated: '未评级', aaa: 'AAA', aa_plus: 'AA+', aa: 'AA', aa_minus: 'AA-',
    a_plus: 'A+', a: 'A', a_minus: 'A-', bbb_plus: 'BBB+', bbb: 'BBB', bbb_minus: 'BBB-',
    applicable: '适用', not_applicable: '不适用',
  };

  const label = (k) => FIELD_LABELS[k] || k;
  /** 把 code 翻成中文；数组则逐个翻译。 */
  const codeLabel = (v) => {
    if (Array.isArray(v)) return v.map(codeLabel).join('、');
    if (v === true) return '是';
    if (v === false) return '否';
    return CODE_LABELS[v] != null ? CODE_LABELS[v] : String(v);
  };
  /** 字段值的带单位展示 */
  const fieldValue = (name, v) => {
    if (v == null || v === '') return { text: '（未填）', missing: true };
    if (name === 'ltv' || name === 'exposure_share' || name === 'provision_ratio'
        || name === 'ccf' || name === 'debt_ratio' || name === 'covered_oc_ratio') {
      return { text: pct2(v), num: true };
    }
    if (name === 'balance' || name === 'impairment' || name === 'onbalance_amount'
        || name === 'offbalance_amount' || name === 'single_exposure' || name === 'revenue_last_year') {
      return { text: fmtNum(v), num: true };
    }
    if (name === 'original_maturity_months' || name === 'remaining_maturity_months') {
      return { text: `${v} 月`, num: true };
    }
    if (Array.isArray(v)) return { text: v.map(codeLabel).join('、') };
    return { text: codeLabel(v) };
  };

  /* ---------- 操作符展示 ---------- */
  const OP_LABELS = {
    eq: '等于', in: '属于集合', contains: '含有', gt: '大于', gte: '大于等于', lt: '小于', lte: '小于等于',
  };

  /* ---------- 状态标签 ---------- */
  const STATUS_TONE = {
    ok: 'ok', warning: 'warn', warn: 'warn', exception: 'danger', error: 'danger',
    published: 'ok', draft: 'muted', reviewing: 'warn', superseded: 'muted', disabled: 'danger',
    completed: 'ok', running: 'info', failed: 'danger', pending: 'muted',
  };
  const STATUS_LABEL = {
    ok: '正常', warning: '待复核', warn: '待复核', exception: '异常', error: '异常',
    published: '已发布', draft: '草稿', reviewing: '审核中', superseded: '已被取代', disabled: '已停用',
    completed: '已完成', running: '进行中', failed: '失败', pending: '待处理',
  };
  const tag = (cls, text) => h('span', { class: `tag ${cls || ''}` }, text);
  const statusTag = (s) => h('span', { class: `tag ${STATUS_TONE[s] || 'muted'}` }, STATUS_LABEL[s] || s);

  /**
   * 在下一帧执行；若 rAF 不可用或被节流（如无头浏览器、后台标签页），
   * 退回 setTimeout，保证浮层一定能打开 —— 否则会留下"遮罩在、弹窗不显示"的空洞状态。
   */
  function nextFrame(fn) {
    let done = false;
    const run = () => { if (!done) { done = true; fn(); } };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    setTimeout(run, 32);
  }

  /* ---------- 抽屉 ---------- */
  let maskEl = null;
  function ensureMask() {
    if (!maskEl) {
      maskEl = h('div', { class: 'drawer-mask', onclick: () => closeDrawer() });
      document.body.appendChild(maskEl);
    }
    return maskEl;
  }
  let currentDrawer = null;
  function openDrawer({ title, body, footer, wide }) {
    closeDrawer();
    const mask = ensureMask();
    const d = h('div', { class: `drawer${wide ? ' wide' : ''}` },
      h('div', { class: 'drawer-head' },
        h('h3', {}, title),
        h('div', { class: 'spacer' }),
        h('button', { class: 'btn sm', onclick: closeDrawer }, '关闭 ✕')),
      h('div', { class: 'drawer-body' }, body),
      footer ? h('div', { class: 'drawer-foot' }, footer) : null,
    );
    document.body.appendChild(d);
    currentDrawer = d;
    nextFrame(() => { mask.classList.add('open'); d.classList.add('open'); });
    return d;
  }
  function closeDrawer() {
    if (currentDrawer) {
      currentDrawer.classList.remove('open');
      const d = currentDrawer; currentDrawer = null;
      setTimeout(() => d.remove(), 240);
    }
    if (maskEl) maskEl.classList.remove('open');
  }

  /* ---------- 模态 ---------- */
  function openModal({ title, body, footer, wide, onClose }) {
    const mask = h('div', { class: 'modal-mask' });
    const m = h('div', { class: `modal${wide ? ' wide' : ''}` },
      h('div', { class: 'modal-head' }, title),
      h('div', { class: 'modal-body' }, body),
      footer ? h('div', { class: 'modal-foot' }, footer) : null,
    );
    mask.appendChild(m);
    const close = () => { mask.classList.remove('open'); setTimeout(() => mask.remove(), 180); if (onClose) onClose(); };
    mask.addEventListener('click', (e) => { if (e.target === mask) close(); });
    document.body.appendChild(mask);
    nextFrame(() => mask.classList.add('open'));
    return { el: mask, close };
  }
  function confirmDialog({ title, message, okText = '确认', danger }) {
    return new Promise((resolve) => {
      const ok = h('button', { class: `btn ${danger ? 'danger' : 'primary'}` }, okText);
      const cancel = h('button', { class: 'btn' }, '取消');
      const md = openModal({
        title: title || '请确认',
        body: h('div', { style: { fontSize: '13px', lineHeight: '1.75' } }, message),
        footer: [cancel, ok],
        onClose: () => resolve(false),
      });
      cancel.onclick = () => { md.close(); resolve(false); };
      ok.onclick = () => { md.close(); resolve(true); };
    });
  }

  /* ---------- Toast ---------- */
  function toast(msg, kind = '', ms = 2600) {
    let wrap = document.querySelector('.toasts');
    if (!wrap) { wrap = h('div', { class: 'toasts' }); document.body.appendChild(wrap); }
    const t = h('div', { class: `toast ${kind}` }, h('span', {}, kind === 'ok' ? '✓' : kind === 'err' ? '✕' : kind === 'warn' ? '!' : 'ℹ'), h('span', {}, msg));
    wrap.appendChild(t);
    setTimeout(() => { t.style.transition = 'opacity .2s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 220); }, ms);
  }

  /* ---------- 表格工具 ---------- */
  /** 生成可排序、可搜索、可分页的表格控制器 */
  function makeTable({ columns, rows, pageSize = 15, onRowClick, rowClass, emptyText = '暂无数据' }) {
    const state = { page: 1, sortKey: null, sortDir: 1, query: '', filters: {} };
    const wrap = h('div');
    const tableWrap = h('div', { class: 'table-wrap' });
    const pagerWrap = h('div');
    wrap.appendChild(tableWrap);
    wrap.appendChild(pagerWrap);

    function filtered() {
      let r = rows.slice();
      if (state.query) {
        const q = state.query.toLowerCase();
        r = r.filter((row) => columns.some((c) => {
          const v = c.value ? c.value(row) : row[c.key];
          return String(v == null ? '' : v).toLowerCase().includes(q);
        }));
      }
      for (const [k, v] of Object.entries(state.filters)) {
        if (v == null || v === '') continue;
        r = r.filter((row) => String(row[k]) === String(v));
      }
      if (state.sortKey) {
        const col = columns.find((c) => c.key === state.sortKey);
        r.sort((a, b) => {
          let av = col && col.value ? col.value(a) : a[state.sortKey];
          let bv = col && col.value ? col.value(b) : b[state.sortKey];
          if (av == null) return 1; if (bv == null) return -1;
          const an = Number(av), bn = Number(bv);
          const cmp = (!Number.isNaN(an) && !Number.isNaN(bn) && av !== '' && bv !== '')
            ? an - bn : String(av).localeCompare(String(bv), 'zh-CN');
          return cmp * state.sortDir;
        });
      }
      return r;
    }

    function render() {
      const all = filtered();
      const pages = Math.max(1, Math.ceil(all.length / pageSize));
      if (state.page > pages) state.page = pages;
      const start = (state.page - 1) * pageSize;
      const slice = all.slice(start, start + pageSize);

      const thead = h('thead', {}, h('tr', {}, columns.map((c) => h('th', {
        class: `${c.num ? 'num' : ''} ${c.sortable !== false ? 'sortable' : ''} ${c.cls || ''}`,
        onclick: c.sortable === false ? null : () => {
          if (state.sortKey === c.key) state.sortDir *= -1;
          else { state.sortKey = c.key; state.sortDir = 1; }
          render();
        },
      }, c.title, state.sortKey === c.key ? (state.sortDir > 0 ? ' ↑' : ' ↓') : ''))));

      const tbody = h('tbody', {}, slice.length ? slice.map((row, i) => {
        const cls = [onRowClick ? 'clickable' : '', rowClass ? rowClass(row) : ''].join(' ');
        const tr = h('tr', { class: cls }, columns.map((c) => {
          const v = c.value ? c.value(row) : row[c.key];
          const td = h('td', { class: `${c.num ? 'num' : ''} ${c.cls || ''}` });
          if (v instanceof Node) td.appendChild(v);
          else if (c.html) td.innerHTML = c.html(row);
          else td.textContent = v == null ? '—' : v;
          return td;
        }));
        if (onRowClick) tr.addEventListener('click', (e) => {
          if (e.target.closest('button, a, input, select')) return;
          onRowClick(row);
        });
        return tr;
      }) : h('tr', {}, h('td', { colspan: columns.length }, h('div', { class: 'empty' }, emptyText))));

      tableWrap.innerHTML = '';
      tableWrap.appendChild(h('table', { class: 'tbl' }, thead, tbody));

      // 分页
      pagerWrap.innerHTML = '';
      if (all.length > pageSize) {
        const btns = [];
        const add = (label, page, disabled, active) => {
          const b = h('button', { class: active ? 'active' : '', disabled: disabled || false }, label);
          if (!disabled && !active) b.onclick = () => { state.page = page; render(); };
          btns.push(b);
        };
        add('‹', state.page - 1, state.page === 1);
        const win = 2;
        for (let p = 1; p <= pages; p++) {
          if (p === 1 || p === pages || Math.abs(p - state.page) <= win) add(String(p), p, false, p === state.page);
          else if (Math.abs(p - state.page) === win + 1) btns.push(h('span', { class: 'dim', style: { padding: '0 2px' } }, '…'));
        }
        add('›', state.page + 1, state.page === pages);
        pagerWrap.appendChild(h('div', { class: 'pager' },
          h('span', { class: 'dim' }, `共 ${all.length} 条，第 ${state.page}/${pages} 页`),
          h('div', { class: 'spacer' }), ...btns));
      } else {
        pagerWrap.appendChild(h('div', { class: 'pager' }, h('span', { class: 'dim' }, `共 ${all.length} 条`)));
      }
    }

    render();
    return {
      el: wrap,
      refresh: render,
      setQuery(q) { state.query = q; state.page = 1; render(); },
      setFilter(k, v) { state.filters[k] = v; state.page = 1; render(); },
      getState: () => state,
    };
  }

  /* ---------- 小部件 ---------- */
  const kpi = (labelText, value, foot, opts = {}) => h('div', { class: `kpi${opts.accent ? ' accent' : ''}` },
    h('div', { class: 'k-label' }, labelText),
    h('div', { class: `k-value${opts.sm ? ' sm' : ''}` }, value),
    foot ? h('div', { class: 'k-foot' }, foot) : null);

  const simBadge = (text = '模拟数据') => h('span', { class: 'sim-badge' }, '⚠ ', text);

  const notice = (kind, text, title) => h('div', { class: `notice ${kind}` },
    h('span', { class: 'ni' }, kind === 'danger' || kind === 'warn' ? '!' : kind === 'ok' ? '✓' : 'ℹ'),
    h('div', {}, title ? h('b', {}, title + ' ') : null, text));

  const panel = (title, opts = {}, ...body) => h('div', { class: 'panel' },
    title ? h('div', { class: 'panel-head' },
      h('h3', {}, title),
      opts.sub ? h('span', { class: 'sub' }, opts.sub) : null,
      h('div', { class: 'spacer' }),
      opts.actions || null) : null,
    opts.actions && !title ? h('div', { class: 'panel-head' }, h('div', { class: 'spacer' }), opts.actions) : null,
    h('div', { class: `panel-body${opts.tight ? ' tight' : ''}` }, ...body));

  const kv = (pairs) => h('div', { class: 'kv' },
    pairs.map(([k, v]) => [h('div', { class: 'k' }, k), h('div', { class: 'v' + (v && v.mono ? ' mono' : '') }, v && v.node ? v.node : (v || '—'))]));

  /* 条件展示：把一个 condition 渲染成可读行 */
  function condRow(c, trace, fields) {
    const fname = c.field;
    const fl = label(fname);
    const opTxt = OP_LABELS[c.op] || c.op;
    const want = Array.isArray(c.match) ? c.match.map(codeLabel).join(' 或 ') : codeLabel(c.match);
    const has = trace && trace.actual !== undefined;
    let cls = '', icon = '·', actualTxt = '';
    if (trace) {
      if (trace.missing) { cls = 'miss'; icon = '!'; actualTxt = '（未填，条件不命中）'; }
      else if (trace.ok) { cls = 'pass'; icon = '✓'; }
      else { cls = 'fail'; icon = '✕'; }
      if (trace.actual !== undefined) {
        if (fname === 'ltv' || fname === 'exposure_share' || fname === 'provision_ratio'
            || fname === 'ccf' || fname === 'debt_ratio' || fname === 'covered_oc_ratio') {
          actualTxt = `实际 ${pct2(trace.actual)}`;
        } else if (typeof trace.actual === 'number') {
          actualTxt = `实际 ${fmtNum(trace.actual)}`;
        } else {
          actualTxt = `实际 ${codeLabel(trace.actual)}`;
        }
      }
    }
    return h('div', { class: `cond ${cls}` },
      h('span', { class: 'ci' }, icon),
      h('div', { class: 'cond-list', style: { gap: '2px' } },
        h('div', {},
          h('span', { class: 'cf' }, fl),
          h('span', { class: 'co' }, ` ${opTxt} `),
          h('span', { class: 'cv' }, want)),
        actualTxt ? h('div', { class: 'co', style: { fontSize: '10.5px' } }, actualTxt) : null));
  }

  const copyText = async (text, okMsg = '已复制到剪贴板') => {
    try {
      await navigator.clipboard.writeText(text);
      toast(okMsg, 'ok');
    } catch (e) {
      const ta = h('textarea', { style: { position: 'fixed', left: '-9999px' } });
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); toast(okMsg, 'ok'); } catch (e2) { toast('复制失败，请手动选择文本', 'err'); }
      ta.remove();
    }
  };

  const downloadBlob = (blob, filename) => {
    const a = h('a', { href: URL.createObjectURL(blob), download: filename });
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 400);
  };

  const UI = {
    h, esc, fmtNum, fmtInt, fmtShort, pct, pct2,
    label, codeLabel, fieldValue, OP_LABELS, FIELD_LABELS, CODE_LABELS,
    tag, statusTag, STATUS_TONE, STATUS_LABEL,
    openDrawer, closeDrawer, openModal, confirmDialog, toast,
    makeTable, kpi, simBadge, notice, panel, kv, condRow,
    copyText, downloadBlob,
  };
  global.UI = UI;
})(window);
