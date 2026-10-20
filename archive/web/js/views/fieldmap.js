/**
 * 字段映射模块（供计量向导与产品规则向导复用）
 * ------------------------------------------------------------------
 * 模拟"智能体识别 Excel 表头 → 建议标准字段映射 → 用户确认"的过程。
 *
 * 设计要点：
 *   1. 智能体只给出建议与置信度，绝不自动落库。
 *   2. 低置信度或存在歧义的映射必须由用户逐条确认。
 *   3. 用户未确认前，调用方（向导）不放行到下一步。
 *   4. 用户的选择可回写到产品的预设映射，供后续批次复用。
 */
(function (global) {
  const { h, tag, notice, toast, openDrawer, pct2, fmtNum } = UI;

  /* ============ 模拟智能体的映射建议 ============ */
  /**
   * 依据 Excel 表头，为某个产品的标准字段生成映射建议。
   * 返回 [{ stdField, stdCode, ruleField, column, transform, confidence, reason, needsReview, value }]
   */
  function suggestMapping(productCode, headers, sampleRows) {
    const fields = MASTER.PRODUCT_FIELDS[productCode] || [];
    const preset = MASTER.FIELD_MAPPINGS[productCode] || [];
    const hs = (headers || []).map((x) => String(x));
    const out = [];

    fields.forEach((f) => {
      const pre = preset.find((m) => m.stdField === f.name);

      // 1) 命中已有预设映射
      if (pre && pre.srcField && pre.srcField !== '—') {
        const col = hs.find((x) => x.toLowerCase() === String(pre.srcField).toLowerCase())
          || hs.find((x) => x.toLowerCase().includes(String(pre.srcField).toLowerCase().slice(0, 8)));
        out.push({
          stdField: f.name, stdCode: f.code, ruleField: f.stdField,
          column: col || pre.srcField, transform: pre.via,
          confidence: col ? 0.98 : 0.72,
          reason: col
            ? `命中产品预设映射：${pre.srcSystem}.${pre.srcField}`
            : `预设映射指向 ${pre.srcField}，但当前表头未找到同名列，需人工确认`,
          needsReview: !col,
          source: 'preset',
          value: pre.sample,
        });
        return;
      }

      // 2) 按中文标签做模糊匹配
      const hit = hs.find((x) => x === f.name)
        || hs.find((x) => x.includes(f.name) || f.name.includes(x));
      if (hit) {
        out.push({
          stdField: f.name, stdCode: f.code, ruleField: f.stdField,
          column: hit, transform: '直接取值',
          confidence: hit === f.name ? 0.95 : 0.80,
          reason: hit === f.name ? '列名与标准字段名称完全一致' : `列名「${hit}」与标准字段名称近似`,
          needsReview: hit !== f.name,
          source: 'matched',
        });
        return;
      }

      // 3) 未能对上
      out.push({
        stdField: f.name, stdCode: f.code, ruleField: f.stdField,
        column: null, transform: '—',
        confidence: 0,
        reason: f.required
          ? '未在表头中找到匹配列。该字段为必填，缺失会导致引用它的规则条件不命中。'
          : '未在表头中找到匹配列。该字段为选填，未映射时引用它的条件不命中。',
        needsReview: true,
        source: 'none',
      });
    });

    return out;
  }

  /** 智能体的整体结论（用于向导顶部的摘要） */
  function summarize(suggestions) {
    const high = suggestions.filter((s) => s.confidence >= 0.95).length;
    const mid = suggestions.filter((s) => s.confidence > 0 && s.confidence < 0.95).length;
    const none = suggestions.filter((s) => !s.column).length;
    return {
      total: suggestions.length, high, mid, none,
      needConfirm: suggestions.filter((s) => s.needsReview).length,
    };
  }

  /**
   * 渲染「智能体建议 + 用户确认」表格。
   * @param opts.suggestions  建议数组（会被就地修改：用户确认状态写入 confirmed）
   * @param opts.onChange     每次用户操作后回调，用于刷新向导的放行状态
   * @param opts.headers      可选，供下拉选择
   * @param opts.compact      紧凑模式（用于向导内嵌）
   */
  function buildConfirmTable(opts) {
    const { suggestions, onChange, headers = [] } = opts;
    const wrap = h('div');

    // 摘要条
    const sumBox = h('div');
    function renderSummary() {
      const s = summarize(suggestions);
      sumBox.innerHTML = '';
      sumBox.appendChild(h('div', { class: 'grid c4' },
        UI.kpi('字段总数', String(s.total), `产品标准字段`, { sm: true }),
        UI.kpi('高置信度', String(s.high), '可直接采纳', { accent: true, sm: true }),
        UI.kpi('需人工确认', String(s.needConfirm), s.mid ? `其中 ${s.mid} 条为近似匹配` : '低置信或未匹配', { sm: true }),
        UI.kpi('未匹配到列', String(s.none), s.none ? '引用它的条件将不命中' : '全部已匹配', { sm: true })));
    }
    renderSummary();

    const tbody = h('tbody');
    function renderRows() {
      tbody.innerHTML = '';
      suggestions.forEach((s, i) => {
        const srcTag = s.source === 'preset' ? h('span', { class: 'tag info' }, '预设映射')
          : s.source === 'matched' ? h('span', { class: 'tag brand' }, '名称匹配')
          : h('span', { class: 'tag muted' }, '未匹配');

        // 列选择下拉
        const colSel = h('select', { style: { width: '190px', fontSize: '11.5px' } },
          [h('option', { value: '' }, '（不映射）'),
            ...headers.map((x) => h('option', { value: x, selected: x === s.column }, x)),
            ...(s.column && !headers.includes(s.column)
              ? [h('option', { value: s.column, selected: true }, s.column + '（预设）')] : [])]);
        colSel.onchange = () => {
          s.column = colSel.value || null;
          s.confidence = s.column ? 1 : 0;
          s.confirmed = !!s.column;
          s.reason = s.column ? '由用户手工指定。' : '用户选择不映射该字段。';
          s.source = 'user';
          renderRows(); renderSummary();
          if (onChange) onChange();
        };

        // 确认勾选
        const cb = h('input', { type: 'checkbox', checked: !!s.confirmed, disabled: !s.column });
        cb.onchange = () => { s.confirmed = cb.checked; if (onChange) onChange(); };

        const confTag = !s.column ? h('span', { class: 'tag danger' }, '未映射')
          : s.confirmed ? h('span', { class: 'tag ok' }, '已确认')
          : s.confidence >= 0.95 ? h('span', { class: 'tag ok' }, `高 ${Math.round(s.confidence * 100)}%`)
          : h('span', { class: 'tag warn' }, `待确认 ${Math.round(s.confidence * 100)}%`);

        tbody.appendChild(h('tr', { class: s.needsReview && !s.confirmed ? 'sel' : '' },
          h('td', { class: 'mono' }, s.stdCode),
          h('td', {}, s.stdField,
            (MASTER.PRODUCT_FIELDS[opts.productCode] || []).find((f) => f.name === s.stdField)?.required
              ? h('span', { class: 'tag danger', style: { marginLeft: '5px' } }, '必填') : null),
          h('td', { class: 'mono dim' }, s.ruleField || '—'),
          h('td', {}, colSel),
          h('td', { class: 'dim', style: { fontSize: '11px' } }, s.transform || '—'),
          h('td', {}, srcTag),
          h('td', {}, confTag),
          h('td', {}, h('label', { class: 'checkline' }, cb, s.confirmed ? '已确认' : '确认'))));
      });
    }
    renderRows();

    wrap.appendChild(sumBox);
    wrap.appendChild(h('div', { class: 'table-wrap', style: { marginTop: '12px' } },
      h('table', { class: 'tbl compact' },
        h('thead', {}, h('tr', {}, ['字段编码', '标准字段', '规则字段 name', 'Excel 列', '转换方式', '建议来源', '状态', '用户确认'].map((t) => h('th', {}, t)))),
        tbody)));

    return {
      el: wrap,
      refresh: () => { renderRows(); renderSummary(); },
      /** 全部采纳高置信度建议 */
      acceptAll: () => {
        suggestions.forEach((s) => { if (s.column) s.confirmed = true; });
        renderRows(); renderSummary(); if (onChange) onChange();
      },
      pending: () => suggestions.filter((s) => s.column && !s.confirmed).length,
      unmappedRequired: () => suggestions.filter((s) => !s.column
        && (MASTER.PRODUCT_FIELDS[opts.productCode] || []).find((f) => f.name === s.stdField)?.required).length,
    };
  }

  global.FieldMapping = { suggestMapping, summarize, buildConfirmTable };
})(window);
