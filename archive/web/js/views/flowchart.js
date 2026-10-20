/**
 * 通用暴露分类规则 · 流程图可视化编辑器
 * ------------------------------------------------------------------
 * 把规则集的 rules 渲染成自上而下的决策流程图：
 *   - 每个节点是一个规则，连线即路由关系（父 → 子、父 → 兜底）
 *   - 支持新增节点、删除节点、调整同层顺序（即改变规则优先级）
 *   - 点击节点打开条件编辑器
 *   - 所有编辑实时写回规则集，并同步影响决策树与后续计量
 */
(function (global) {
  const { h, tag, notice, toast, openDrawer, openModal, confirmDialog, kv, pct2, condRow } = UI;

  const NODE_W = 216;
  const NODE_H = 62;
  const GAP_X = 26;
  const GAP_Y = 78;

  /**
   * 计算流程图布局：同层横向排列，父子纵向分层
   * 返回 { nodes:[{rule,path,x,y,w,h,depth,parent}], edges:[{from,to,kind}], width, height }
   */
  function layout(ruleset, collapsed) {
    const nodes = [];
    const edges = [];
    let maxDepthX = {};

    function walk(list, depth, parentKey, parentPath, edgeKind) {
      (list || []).forEach((n, i) => place(n, i, depth, parentKey, parentPath, edgeKind));
    }

    function place(n, i, depth, parentKey, parentPath, edgeKind) {
      const key = edgeKind === 'fallback' && parentKey
        ? parentKey + '>otherwise:' + n.name
        : `${parentPath}/${i}:${n.name}`;
      const x = (maxDepthX[depth] || 0);
      const y = depth * (NODE_H + GAP_Y);
      maxDepthX[depth] = x + NODE_W + GAP_X;
      const fb = window.ExposeEngine && ExposeEngine.fallbackNode(n);
      const nd = {
        key, rule: n, path: key, depth, index: i,
        x, y, w: NODE_W, h: NODE_H, parentKey,
        hasChildren: !!(n.children && n.children.length),
        hasFallback: !!fb,
        isFallback: edgeKind === 'fallback',
        isCollapsed: collapsed.has(key),
      };
      nodes.push(nd);
      if (parentKey) edges.push({ from: parentKey, to: key, kind: edgeKind || 'child' });
      if (!nd.isCollapsed) {
        if (nd.hasChildren) walk(n.children, depth + 1, key, key, 'child');
        if (fb) walk([fb], depth + 1, key, key + '>fb', 'fallback');
      }
    }

    walk(ruleset.rules, 0, null, '', 'child');
    const topFb = window.ExposeEngine && ExposeEngine.fallbackNode(ruleset);
    if (topFb) walk([topFb], 0, null, '>doc', 'fallback');
    const width = Math.max(...Object.values(maxDepthX), NODE_W + 40) + 40;
    const height = (Math.max(...nodes.map((n) => n.depth), 0) + 1) * (NODE_H + GAP_Y) + 40;
    return { nodes, edges, width, height };
  }

  /**
   * 渲染流程图编辑器
   * @param ruleset  规则集 resolves_to
   * @param onDirty  编辑后回调（用于刷新计量结果等）
   */
  function FlowEditor(ruleset, onDirty) {
    const collapsed = new Set();
    let selected = null;
    const wrap = h('div', { class: 'flow-wrap' });
    const canvas = h('div', { class: 'flow-canvas' });
    const svgNS = 'http://www.w3.org/2000/svg';
    let dragState = null;

    function render() {
      canvas.innerHTML = '';
      const L = layout(ruleset, collapsed);

      canvas.style.width = L.width + 'px';
      canvas.style.height = L.height + 'px';
      canvas.style.position = 'relative';

      // 连线层
      const svg = document.createElementNS(svgNS, 'svg');
      svg.setAttribute('class', 'flow-edges');
      svg.setAttribute('width', L.width);
      svg.setAttribute('height', L.height);
      const byKey = {};
      L.nodes.forEach((n) => { byKey[n.key] = n; });

      L.edges.forEach((e) => {
        const a = byKey[e.from], b = byKey[e.to];
        if (!a || !b) return;
        const x1 = a.x + a.w / 2, y1 = a.y + a.h;
        const x2 = b.x + b.w / 2, y2 = b.y;
        const my = (y1 + y2) / 2;
        const path = document.createElementNS(svgNS, 'path');
        path.setAttribute('d', `M ${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}`);
        path.setAttribute('class', 'flow-edge ' + (e.kind === 'fallback' ? 'fb' : 'ch'));
        path.setAttribute('marker-end', e.kind === 'fallback' ? 'url(#arrowFb)' : 'url(#arrowCh)');
        svg.appendChild(path);
      });

      // 箭头 marker
      const defs = document.createElementNS(svgNS, 'defs');
      [['arrowCh', '#94a3b8'], ['arrowFb', '#d97706']].forEach(([id, color]) => {
        const m = document.createElementNS(svgNS, 'marker');
        m.setAttribute('id', id);
        m.setAttribute('viewBox', '0 0 10 10');
        m.setAttribute('refX', '9');
        m.setAttribute('refY', '5');
        m.setAttribute('markerWidth', '6');
        m.setAttribute('markerHeight', '6');
        m.setAttribute('orient', 'auto-start-reverse');
        const p = document.createElementNS(svgNS, 'path');
        p.setAttribute('d', 'M 0 0 L 10 5 L 0 10 z');
        p.setAttribute('fill', color);
        m.appendChild(p);
        defs.appendChild(m);
      });
      svg.insertBefore(defs, svg.firstChild);
      canvas.appendChild(svg);

      // 节点层
      L.nodes.forEach((n) => {
        const r = n.rule;
        const cls = ['flow-node'];
        if (n.isFallback) cls.push('fallback');
        else if (n.hasChildren) cls.push('branch');
        else cls.push('leaf');
        if (selected === n.key) cls.push('sel');

        const role = window.ExposeEngine && ExposeEngine.ruleRole(r);
        if (role) cls.push(role);
        let wtext = (window.ExposeEngine && ExposeEngine.ruleBadge(r)) || '';
        if (!wtext && n.hasChildren) wtext = `${r.children.length} 子类`;
        else if (!wtext && !n.hasChildren) wtext = '权重未单列';

        const el = h('div', {
          class: cls.join(' '),
          style: { left: n.x + 'px', top: n.y + 'px', width: n.w + 'px', height: n.h + 'px' },
          title: (wtext ? wtext + ' · ' : '') + (r.note || '点击编辑；拖动可调整同层顺序'),
          onclick: () => { selected = n.key; render(); },
          ondblclick: () => editNode(n),
        },
          h('div', { class: 'fn-head' },
            h('span', { class: 'fn-idx' }, n.isFallback ? '否则' : `#${n.depth + 1}.${n.index + 1}`),
            h('span', { class: 'fn-label' }, r.label),
            wtext ? h('span', { class: 'fn-weight' }, wtext) : null),
          h('div', { class: 'fn-sub' },
            h('span', { class: 'mono' }, r.name),
            n.hasChildren
              ? h('span', {
                  class: 'fn-toggle',
                  onclick: (e) => {
                    e.stopPropagation();
                    if (collapsed.has(n.key)) collapsed.delete(n.key); else collapsed.add(n.key);
                    render();
                  },
                }, n.isCollapsed ? `▶ ${r.children.length}` : `▼ ${r.children.length}`)
              : null));

        // 同层拖动排序
        el.draggable = !n.isFallback;
        el.ondragstart = (e) => {
          if (n.isFallback) { e.preventDefault(); return; }
          dragState = n; e.dataTransfer.effectAllowed = 'move';
        };
        el.ondragover = (e) => {
          if (!dragState || dragState.parentKey !== n.parentKey || n.isFallback) return;
          e.preventDefault(); el.classList.add('drop-target');
        };
        el.ondragleave = () => el.classList.remove('drop-target');
        el.ondrop = (e) => {
          e.preventDefault(); el.classList.remove('drop-target');
          if (!dragState || dragState.parentKey !== n.parentKey || dragState.key === n.key) return;
          reorderSiblings(dragState, n);
        };

        canvas.appendChild(el);
      });
    }

    /** 把 from 节点移动到 to 节点的位置（同层重排 = 改优先级） */
    function reorderSiblings(from, to) {
      const parentPath = from.parentKey || '';
      // 找到承载这两个节点的数组
      let arr = ruleset.rules;
      if (parentPath) {
        const f = findNodeByKey(parentPath);
        arr = f && f.rule.children ? f.rule.children : ruleset.rules;
      }
      const fi = arr.indexOf(from.rule);
      const ti = arr.indexOf(to.rule);
      if (fi < 0 || ti < 0) return;
      arr.splice(fi, 1);
      arr.splice(ti, 0, from.rule);
      const layerName = parentPath ? (findNodeByKey(parentPath) || {}).rule.label : '顶层';
      toast(`已把「${from.rule.label}」移动到「${layerName}」的第 ${ti + 1} 位 —— 规则顺序即优先级`, 'ok');
      dragState = null;
      render();
      if (onDirty) onDirty();
    }

    function findNodeByKey(key) {
      const L = layout(ruleset, new Set());   // 全展开查找
      const n = L.nodes.find((x) => x.key === key);
      return n || null;
    }

    /** 取所有可选父节点 */
    function parentOptions() {
      const out = [{ key: '', label: '（顶层 rules，追加到末尾）' }];
      const L = layout(ruleset, new Set());
      L.nodes.filter((n) => !n.isFallback).forEach((n) => {
        out.push({ key: n.key, label: `${'　'.repeat(n.depth)}${n.rule.label}（${n.rule.name}）` });
      });
      return out;
    }

    function addNode(parentKey) {
      const v = { name: '', label: '', value: '', when: '', note: '' };
      const mk = (k, lbl, ph) => {
        const i = h('input', { type: 'text', placeholder: ph || '' });
        i.oninput = () => { v[k] = i.value; };
        return h('div', { class: 'field' }, h('label', {}, lbl), i);
      };
      const parentSel = h('select', {}, parentOptions().map((o) =>
        h('option', { value: o.key, selected: o.key === (parentKey || '') }, o.label)));
      parentSel.onchange = () => { v.parent = parentSel.value; };
      const whenTa = h('textarea', { placeholder: '例如：交易对手 等于 公司' });
      whenTa.oninput = () => { v.when = whenTa.value; };

      const md = openModal({
        title: '新增规则节点', wide: true,
        body: h('div', {},
          notice('info',
            '新节点会真实写入规则集，流程图、决策树与后续计量结果都会立即变化。' +
            '顺序即优先级 —— 新节点默认追加到所在层的末尾。', '生效说明：'),
          h('div', { class: 'grid c2' },
            mk('name', '规则 name（英文，文件内唯一）', 'corp_new_rule'),
            mk('label', '规则名称（中文显示名）', '新分类'),
            h('div', { class: 'field' }, h('label', {}, '挂载位置'), parentSel),
            mk('value', '风险权重 value（10% 写 0.1，留空则用 same_as）', '0.85'),
            h('div', { class: 'field', style: { gridColumn: '1 / -1' } }, h('label', {}, '判断条件（自然语言，将转为结构化条件）'), whenTa),
            h('div', { class: 'field', style: { gridColumn: '1 / -1' } }, h('label', {}, '备注 / 权重依据'),
              (() => { const t = h('textarea', {}); t.oninput = () => { v.note = t.value; }; return t; })()))),
        footer: [
          h('button', { class: 'btn', onclick: () => md.close() }, '取消'),
          h('button', {
            class: 'btn primary',
            onclick: () => {
              if (!v.name || !v.label) { toast('规则 name 与名称为必填', 'warn'); return; }
              if (findNodeByKey('') && ruleset.rules.some(function chk(x) { return x.name === v.name; })) {
                toast(`规则 name「${v.name}」已存在`, 'err'); return;
              }
              const node = {
                name: v.name, label: v.label,
                when: { all: [] },
                note: `【模拟·新增】${v.when || '（未填条件，恒成立）'}`,
              };
              const num = Number(v.value);
              if (v.value !== '' && !Number.isNaN(num)) node.value = num;
              else { node.weight = { same_as: 'counterparty_ordinary_claim' }; node.note += ' 权重按交易对手普通债权确定。'; }

              const pk = v.parent !== undefined ? v.parent : (parentKey || '');
              if (!pk) ruleset.rules.push(node);
              else {
                const found = findNodeByKey(pk);
                if (!found) { toast('找不到挂载位置', 'err'); return; }
                if (!found.rule.children) found.rule.children = [];
                found.rule.children.push(node);
              }
              md.close(); render();
              toast(`已新增节点「${v.label}」`, 'ok');
              if (onDirty) onDirty();
            },
          }, '新增'),
        ],
      });
    }

    function editNode(n) {
      if (n.isFallback) { editFallback(n); return; }
      const r = n.rule;
      const labelI = h('input', { type: 'text', value: r.label });
      const wI = h('input', { type: 'number', step: '0.01', value: typeof r.value === 'number' ? r.value : '' });
      const noteI = h('textarea', {}, r.note || '');
      const hasKids = n.hasChildren;

      const body = h('div', {},
        kv([
          ['规则 name', { mono: true, node: h('code', {}, r.name) }],
          ['层级 / 顺序', `第 ${n.depth + 1} 层，第 ${n.index + 1} 位`],
          ['节点类型', hasKids ? '分流节点（继续下钻）' : '产出节点'],
          ['子节点数', String((r.children || []).length)],
        ]),
        h('div', { class: 'panel', style: { marginTop: '12px' } },
          h('div', { class: 'panel-head' }, h('h3', {}, '属性编辑')),
          h('div', { class: 'panel-body' },
            h('div', { class: 'field' }, h('label', {}, '规则名称（中文显示名）'), labelI),
            hasKids
              ? notice('info', '本节点有子节点，权重写在子档上，此处不能设置 value。', '分流节点：')
              : h('div', { class: 'field' }, h('label', {}, '风险权重 value（10% 写 0.1）'), wI),
            h('div', { class: 'field' }, h('label', {}, '备注 / 权重依据'), noteI))),
        h('div', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h3', {}, '当前判断条件')),
          h('div', { class: 'panel-body' },
            r.when ? Views.renderWhenTree(r.when, null) : h('div', { class: 'dim' }, '无条件（恒成立）'))),
        h('div', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h3', {}, '结构操作')),
          h('div', { class: 'panel-body' },
            h('div', { class: 'btn-group' },
              h('button', { class: 'btn sm', onclick: () => { UI.closeDrawer(); addNode(n.key); } }, '＋ 在此节点下新增子规则'),
              h('button', { class: 'btn sm', onclick: () => moveNode(n) }, '调整位置'),
              h('button', { class: 'btn sm', onclick: () => addFallback(n) }, n.hasFallback ? '编辑兜底分支' : '＋ 添加兜底分支'),
              h('button', { class: 'btn sm danger', onclick: () => deleteNode(n) }, '删除此节点')))));

      openDrawer({
        title: `编辑规则节点 · ${r.label}`, wide: true, body,
        footer: [
          h('button', { class: 'btn', onclick: UI.closeDrawer }, '取消'),
          h('button', {
            class: 'btn primary',
            onclick: () => {
              r.label = labelI.value;
              r.note = noteI.value;
              if (!hasKids && wI.value !== '') { r.value = Number(wI.value); delete r.weight; }
              toast(`已保存「${r.label}」`, 'ok');
              UI.closeDrawer(); render();
              if (onDirty) onDirty();
            },
          }, '保存'),
        ],
      });
    }

    function editFallback(n) {
      const r = n.rule;
      const labelI = h('input', { type: 'text', value: r.label });
      const wI = h('input', { type: 'number', step: '0.01', value: typeof r.value === 'number' ? r.value : '' });
      openDrawer({
        title: `编辑兜底分支 · ${r.label}`,
        body: h('div', {},
          notice('info', '兜底分支在本层所有 when 都不成立时执行。它和 children 平级，自身也可以再带 children。', '兜底语义：'),
          kv([['name', { mono: true, node: h('code', {}, r.name) }],
              ['父节点', n.parentKey ? (findNodeByKey(n.parentKey) || {}).rule.label : '—'],
              ['当前权重', typeof r.value === 'number' ? pct2(r.value) : (r.weight ? '按交易对手取权重' : '—')]]),
          h('div', { class: 'panel', style: { marginTop: '12px' } },
            h('div', { class: 'panel-head' }, h('h3', {}, '属性')),
            h('div', { class: 'panel-body' },
              h('div', { class: 'field' }, h('label', {}, '名称'), labelI),
              h('div', { class: 'field' }, h('label', {}, '风险权重 value'), wI),
              h('div', { class: 'btn-group', style: { marginTop: '10px' } },
                h('button', { class: 'btn sm danger', onclick: () => removeFallback(n) }, '删除兜底分支'))))),
        footer: [
          h('button', { class: 'btn', onclick: UI.closeDrawer }, '取消'),
          h('button', {
            class: 'btn primary',
            onclick: () => {
              r.label = labelI.value;
              if (wI.value !== '') { r.value = Number(wI.value); delete r.weight; }
              UI.closeDrawer(); render();
              toast('兜底分支已保存', 'ok');
              if (onDirty) onDirty();
            },
          }, '保存'),
        ],
      });
    }

    function addFallback(n) {
      const parent = findNodeByKey(n.key);
      if (!parent) return;
      const i = h('input', { type: 'text', value: `${n.rule.name}_exhaust` });
      const l = h('input', { type: 'text', value: `${n.rule.label}未分档` });
      const w = h('input', { type: 'number', step: '0.01', value: '1' });
      const md = openModal({
        title: `为「${n.rule.label}」添加兜底分支`,
        body: h('div', {},
          notice('info', '添加后，当本节点下所有子规则的 when 都不成立时，将走这个兜底分支，而不是退回外层。', '效果：'),
          h('div', { class: 'field' }, h('label', {}, 'name'), i),
          h('div', { class: 'field' }, h('label', {}, '名称'), l),
          h('div', { class: 'field' }, h('label', {}, '风险权重 value'), w)),
        footer: [
          h('button', { class: 'btn', onclick: () => md.close() }, '取消'),
          h('button', {
            class: 'btn primary',
            onclick: () => {
              parent.rule.otherwise = true;
              parent.rule.fallback = {
                name: i.value, label: l.value, when: { all: [] }, value: Number(w.value),
                note: '【模拟·新增】兜底分支，本层都不中时执行。',
              };
              md.close();
              collapsed.delete(n.key);
              render();
              toast(`已为「${parent.rule.label}」添加兜底分支`, 'ok');
              if (onDirty) onDirty();
            },
          }, '添加'),
        ],
      });
    }

    function removeFallback(n) {
      confirmDialog({
        title: '删除兜底分支',
        message: `删除后，当本层所有子规则都不命中时，将退回外层继续判断，而不是走兜底。是否继续？`,
        okText: '删除', danger: true,
      }).then((ok) => {
        if (!ok) return;
        const parent = findNodeByKey(n.parentKey);
        if (parent) { delete parent.rule.otherwise; delete parent.rule.fallback; }
        UI.closeDrawer(); render();
        toast('已删除兜底分支', 'ok');
        if (onDirty) onDirty();
      });
    }

    function moveNode(n) {
      const siblings = (() => {
        if (!n.parentKey) return ruleset.rules;
        const p = findNodeByKey(n.parentKey);
        return p && p.rule.children ? p.rule.children : ruleset.rules;
      })();
      const cur = siblings.indexOf(n.rule);
      const body = h('div', {});
      body.appendChild(notice('info',
        '顺序即优先级：自上而下第一条命中即停止。调整顺序会直接改变计量结果。', '顺序语义：'));
      const list = h('div', {});
      function renderList() {
        list.innerHTML = '';
        siblings.forEach((r, i) => {
          list.appendChild(h('div', {
            class: 'fblock', style: {
              display: 'flex', alignItems: 'center', gap: '9px',
              borderColor: i === cur ? 'var(--brand-2)' : '',
            },
          },
            h('span', { class: 'tag brand' }, `#${i + 1}`),
            h('span', { class: 'fname', style: { flex: '1' } }, r.label),
            h('button', {
              class: 'btn xs', disabled: i === 0,
              onclick: () => { siblings.splice(i - 1, 0, siblings.splice(i, 1)[0]); cur = i - 1; renderList(); },
            }, '↑ 上移'),
            h('button', {
              class: 'btn xs', disabled: i === siblings.length - 1,
              onclick: () => { siblings.splice(i + 1, 0, siblings.splice(i, 1)[0]); cur = i + 1; renderList(); },
            }, '↓ 下移')));
        });
      }
      renderList();
      const layerLabel = n.parentKey ? (findNodeByKey(n.parentKey) || {}).rule.label : '顶层';
      openDrawer({
        title: `调整位置 · ${n.rule.label}`, body: h('div', {},
          h('div', { class: 'dim', style: { marginBottom: '10px', fontSize: '12px' } }, `所在层：${layerLabel}`),
          body.querySelector('.notice') ? body.querySelector('.notice') : null,
          list),
        footer: [
          h('button', { class: 'btn', onclick: UI.closeDrawer }, '取消'),
          h('button', {
            class: 'btn primary',
            onclick: () => { UI.closeDrawer(); render(); toast('顺序已更新', 'ok'); if (onDirty) onDirty(); },
          }, '完成'),
        ],
      });
      // 把 notice 移到前面
      const d = document.querySelector('.drawer.open .drawer-body');
      if (d && body.firstChild) d.insertBefore(body.firstChild, d.firstChild);
    }

    function deleteNode(n) {
      const kids = (n.rule.children || []).length;
      confirmDialog({
        title: '删除规则节点',
        message: `将删除「${n.rule.label}」（${n.rule.name}）` +
          (kids ? `，其下 ${kids} 个子规则会一并删除` : '') +
          `。删除后流程图、决策树与后续计量结果都会立即变化，此操作不可撤销。`,
        okText: '删除', danger: true,
      }).then((ok) => {
        if (!ok) return;
        let done = false;
        const sweep = (arr) => {
          for (let i = 0; i < arr.length; i++) {
            if (arr[i] === n.rule) { arr.splice(i, 1); done = true; return true; }
            if (arr[i].children && sweep(arr[i].children)) return true;
          }
          return false;
        };
        sweep(ruleset.rules);
        UI.closeDrawer(); render();
        toast(done ? `已删除「${n.rule.label}」` : '未找到该节点', done ? 'ok' : 'err');
        if (onDirty) onDirty();
      });
    }

    /* 工具栏 */
    function toolbar() {
      return h('div', { class: 'flow-toolbar' },
        h('button', { class: 'btn sm primary', onclick: () => addNode(null) }, '＋ 新增顶层规则'),
        h('button', { class: 'btn sm', onclick: () => { collapsed.clear(); render(); } }, '展开全部'),
        h('button', { class: 'btn sm', onclick: () => {
          const L = layout(ruleset, new Set());
          L.nodes.filter((n) => n.hasChildren).forEach((n) => collapsed.add(n.key));
          render();
        } }, '折叠全部分支'),
        h('div', { style: { flex: '1' } }),
        h('span', { class: 'tag outline' }, '拖动节点可调整同层顺序'),
        h('span', { class: 'tag brand' }, `${Store.countNodes(ruleset)} 个节点`));
    }

    function fullRender() {
      wrap.innerHTML = '';
      wrap.appendChild(toolbar());
      wrap.appendChild(canvas);
      wrap.appendChild(h('div', { class: 'flow-legend' },
        h('span', { class: 'lg' }, h('i', { class: 'dot branch' }), '分流节点（含子规则）'),
        h('span', { class: 'lg' }, h('i', { class: 'dot leaf' }), '产出节点（已定权重）'),
        h('span', { class: 'lg' }, h('i', { class: 'dot fallback' }), '兜底分支（否则）'),
        h('span', { class: 'lg' }, h('i', { class: 'line ch' }), '命中后继续下钻'),
        h('span', { class: 'lg' }, h('i', { class: 'line fb' }), '同级都不中的兜底路由')));
      render();
    }

    fullRender();
    return { el: wrap, refresh: fullRender, addNode };
  }

  global.FlowChart = { FlowEditor, layout };
})(window);
