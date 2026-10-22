/**
 * EAD 公式解析器与校验器
 * ------------------------------------------------------------------
 * 公式用产品标准字段的名字引用字段，例如：
 *     EAD = 债项余额 − 减值准备
 *     EAD = 表内已提用金额 + 表外未提用金额 × CCF
 *
 * 解析产出两部分：
 *   1. 结构化引用（AST）—— 供引擎执行，不依赖中文名
 *   2. 校验结果 —— 语法是否合法、引用的字段是否都在该产品的标准字段范围内
 *
 * 支持的运算符：+ − * / × ÷ ( ) 与数字字面量。
 * 字段名可含中文、字母、数字、下划线、括号内单位（如「余额(MOP)」）。
 *
 * 校验和求值只有这一份。页面通过 POST /api/ead-formula/check 调它，不另写一套。
 */
(function (global) {
  /* ---------------- 词法分析 ---------------- */
  const OPS = {
    '+': 'add', '-': 'sub', '−': 'sub', '–': 'sub',
    '*': 'mul', '×': 'mul', 'x': 'mul', 'X': 'mul',
    '/': 'div', '÷': 'div',
  };
  const PREC = { add: 1, sub: 1, mul: 2, div: 2 };
  const FUNCS = { max: 2, min: 2, abs: 1, round: 1 };

  /** 把公式文本切成 token。字段名容错：允许中英文、数字、下划线，以及紧跟的 (单位)。 */
  function tokenize(text) {
    const tokens = [];
    let i = 0;
    const s = String(text || '');

    while (i < s.length) {
      const c = s[i];

      if (/\s/.test(c)) { i++; continue; }

      if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(s[i + 1] || ''))) {
        let j = i;
        while (j < s.length && /[0-9.]/.test(s[j])) j++;
        const raw = s.slice(i, j);
        const val = Number(raw);
        if (Number.isNaN(val)) throw new Error(`无法识别的数字「${raw}」（位置 ${i + 1}）`);
        tokens.push({ type: 'num', value: val, raw, pos: i });
        i = j;
        continue;
      }

      if (c === '(' || c === '（') { tokens.push({ type: 'lparen', pos: i }); i++; continue; }
      if (c === ')' || c === '）') { tokens.push({ type: 'rparen', pos: i }); i++; continue; }
      if (c === ',') { tokens.push({ type: 'comma', pos: i }); i++; continue; }

      // 等号（公式左侧的 EAD =）
      if (c === '=') { tokens.push({ type: 'eq', pos: i }); i++; continue; }

      if (OPS[c] && !(c === '-' && tokens.length === 0)) {
        tokens.push({ type: 'op', op: OPS[c], raw: c, pos: i });
        i++;
        continue;
      }
      if (c === '-') { tokens.push({ type: 'op', op: 'sub', raw: c, pos: i }); i++; continue; }

      if (/[一-龥A-Za-z_]/.test(c)) {
        let j = i;
        while (j < s.length && /[一-龥A-Za-z0-9_]/.test(s[j])) j++;
        let name = s.slice(i, j);
        let unit = null;
        if (s[j] === '(' || s[j] === '（') {
          // 括号既可能是单位（MOP）也可能是函数调用，向后找匹配右括号
          const open = s[j];
          const close = open === '(' ? ')' : '）';
          let k = j + 1, depth = 1;
          while (k < s.length && depth > 0) {
            if (s[k] === open) depth++;
            else if (s[k] === close) depth--;
            k++;
          }
          const inner = s.slice(j + 1, k - 1);
          if (/^[A-Za-z%]+$/.test(inner.trim())) {
            unit = inner.trim();
            name = name + '(' + inner.trim() + ')';
            j = k;
          }
        }
        tokens.push({ type: 'ident', name, unit, pos: i });
        i = j;
        continue;
      }

      throw new Error(`公式中出现无法识别的字符「${c}」（位置 ${i + 1}）`);
    }
    return tokens;
  }

  /* ---------------- 语法分析（递归下降） ---------------- */
  function parse(text) {
    const tokens = tokenize(text);
    let pos = 0;
    const peek = () => tokens[pos];
    const eat = (t) => { const tk = tokens[pos]; if (!tk || tk.type !== t) throw new Error(`语法错误：期望 ${t}`); pos++; return tk; };

    let lhs = null;
    if (peek() && peek().type === 'ident' && tokens[pos + 1] && tokens[pos + 1].type === 'eq') {
      lhs = tokens[pos].name;
      pos += 2;
    } else if (peek() && peek().type === 'eq') {
      throw new Error('公式缺少左侧结果字段名');
    }

    function parsePrimary() {
      const tk = peek();
      if (!tk) throw new Error('公式意外结束');
      if (tk.type === 'num') { pos++; return { kind: 'num', value: tk.value }; }
      if (tk.type === 'lparen') {
        pos++;
        const e = parseExpr();
        eat('rparen');
        return e;
      }
      if (tk.type === 'op' && tk.op === 'sub') {
        pos++;
        return { kind: 'neg', arg: parsePrimary() };
      }
      if (tk.type === 'ident') {
        pos++;
        if (peek() && peek().type === 'lparen') {
          const fn = tk.name.toLowerCase();
          if (!(fn in FUNCS)) throw new Error(`未知函数「${tk.name}」（第 ${tk.pos + 1} 个字符处）`);
          pos++;
          const args = [];
          if (peek() && peek().type !== 'rparen') {
            args.push(parseExpr());
            while (peek() && peek().type === 'comma') { pos++; args.push(parseExpr()); }
          }
          eat('rparen');
          if (args.length !== FUNCS[fn]) {
            throw new Error(`函数 ${tk.name} 需要 ${FUNCS[fn]} 个参数，实际 ${args.length} 个`);
          }
          return { kind: 'call', fn, args };
        }
        return { kind: 'field', name: tk.name };
      }
      throw new Error(`公式在「${tk.raw || tk.name || ''}」处语法有误`);
    }

    function parseExpr(minPrec) {
      let left = parsePrimary();
      while (true) {
        const tk = peek();
        if (!tk || tk.type !== 'op') break;
        const prec = PREC[tk.op];
        if (prec == null || prec < (minPrec || 0)) break;
        pos++;
        const right = parseExpr(prec + 1);
        left = { kind: 'bin', op: tk.op, left, right };
      }
      return left;
    }

    const ast = parseExpr(0);
    if (pos < tokens.length) {
      const tk = tokens[pos];
      throw new Error(`公式在「${tk.raw || tk.name || ''}」之后有多余内容`);
    }
    return { lhs, ast, tokens };
  }

  /* ---------------- 校验 ---------------- */
  /**
   * @param text        公式文本
   * @param allowed     允许的字段名数组（该产品标准字段的中文名 + 编码 + std_field）
   * @param opts.resultField  期望的结果字段名（如 'EAD'）
   * @returns { ok, errors[], warnings[], fields[], ast, lhs, structured }
   */
  function validate(text, allowed, opts = {}) {
    const errors = [];
    const warnings = [];
    const fields = [];
    let ast = null;
    let lhs = null;

    const resultField = opts.resultField || 'EAD';
    const allowCcf = !!opts.allowCcf;

    if (!String(text || '').trim()) {
      return { ok: false, errors: ['公式为空。'], warnings, fields, ast: null, lhs: null, structured: null };
    }

    try {
      const r = parse(text);
      ast = r.ast;
      lhs = r.lhs;
    } catch (e) {
      return { ok: false, errors: [e.message], warnings, fields, ast: null, lhs: null, structured: null };
    }

    if (lhs == null) {
      errors.push(`公式应写成「${resultField} = ...」的形式，以便明确计算结果写入哪个字段。`);
    } else if (lhs.toUpperCase() !== resultField.toUpperCase()) {
      errors.push(`公式左侧应为 ${resultField}，实际为「${lhs}」。`);
    }

    const seen = new Set();
    const walk = (n) => {
      if (!n) return;
      if (n.kind === 'field') {
        if (!seen.has(n.name)) { seen.add(n.name); fields.push(n.name); }
      } else if (n.kind === 'bin') { walk(n.left); walk(n.right); }
      else if (n.kind === 'neg') walk(n.arg);
      else if (n.kind === 'call') n.args.forEach(walk);
    };
    walk(ast);

    const allowedSet = new Set((allowed || []).map((x) => String(x)));
    const allowedLower = new Map((allowed || []).map((x) => [String(x).toLowerCase(), String(x)]));
    const unknown = [];
    fields.forEach((f) => {
      const isCcf = allowCcf && /^ccf$/i.test(f);
      if (isCcf) return;
      if (allowedSet.has(f)) return;
      if (allowedLower.has(f.toLowerCase())) return;
      unknown.push(f);
    });
    if (unknown.length) {
      errors.push(
        `公式引用了不属于本产品标准字段的计算项：${unknown.map((u) => `「${u}」`).join('、')}。` +
        'EAD 公式只能使用该产品在 product_field 里定义的标准字段。'
      );
    }

    if (!fields.length) {
      warnings.push('公式中没有任何字段引用，只由常量构成。请确认这是有意为之。');
    }

    const structured = ast ? toStructured(ast, opts.alias) : null;

    return { ok: errors.length === 0, errors, warnings, fields, ast, lhs, structured };
  }

  /** 把 AST 转成引擎可执行的结构化引用 */
  function toStructured(ast, alias) {
    const map = alias || {};
    const conv = (n) => {
      if (!n) return null;
      switch (n.kind) {
        case 'num': return { kind: 'const', value: n.value };
        case 'field': return { kind: 'var', name: map[n.name] || n.name, label: n.name };
        case 'neg': return { kind: 'neg', arg: conv(n.arg) };
        case 'bin': return { kind: 'bin', op: n.op, left: conv(n.left), right: conv(n.right) };
        case 'call': return { kind: 'call', fn: n.fn, args: n.args.map(conv) };
        default: return null;
      }
    };
    return conv(ast);
  }

  /* ---------------- 求值 ---------------- */
  function evaluate(structured, facts) {
    const ev = (n) => {
      if (!n) return null;
      switch (n.kind) {
        case 'const': return n.value;
        case 'var': {
          const v = facts[n.name];
          if (v == null || v === '') return null;
          const num = Number(v);
          return Number.isNaN(num) ? null : num;
        }
        case 'neg': { const a = ev(n.arg); return a == null ? null : -a; }
        case 'bin': {
          const a = ev(n.left), b = ev(n.right);
          if (a == null || b == null) return null;
          switch (n.op) {
            case 'add': return a + b;
            case 'sub': return a - b;
            case 'mul': return a * b;
            case 'div': return b === 0 ? null : a / b;
            default: return null;
          }
        }
        case 'call': {
          const args = n.args.map(ev);
          if (args.some((x) => x == null)) return null;
          switch (n.fn) {
            case 'max': return Math.max(...args);
            case 'min': return Math.min(...args);
            case 'abs': return Math.abs(args[0]);
            case 'round': return Math.round(args[0]);
            default: return null;
          }
        }
        default: return null;
      }
    };
    return ev(structured);
  }

  /** 求值并逐步展开，用于展示计算过程 */
  function evaluateWithSteps(structured, facts) {
    const steps = [];
    const ev = (n) => {
      if (!n) return null;
      switch (n.kind) {
        case 'const': return n.value;
        case 'var': {
          const v = facts[n.name];
          const num = v == null || v === '' ? null : Number(v);
          const val = Number.isNaN(num) ? null : num;
          steps.push({ type: 'field', label: n.label || n.name, code: n.name, value: val });
          return val;
        }
        case 'neg': { const a = ev(n.arg); return a == null ? null : -a; }
        case 'bin': {
          const a = ev(n.left), b = ev(n.right);
          if (a == null || b == null) return null;
          let v = null;
          if (n.op === 'add') v = a + b;
          else if (n.op === 'sub') v = a - b;
          else if (n.op === 'mul') v = a * b;
          else if (n.op === 'div') v = b === 0 ? null : a / b;
          const OP = { add: '+', sub: '−', mul: '×', div: '÷' };
          steps.push({ type: 'op', op: OP[n.op], left: a, right: b, value: v });
          return v;
        }
        case 'call': {
          const args = n.args.map(ev);
          if (args.some((x) => x == null)) return null;
          let v = null;
          if (n.fn === 'max') v = Math.max(...args);
          if (n.fn === 'min') v = Math.min(...args);
          if (n.fn === 'abs') v = Math.abs(args[0]);
          if (n.fn === 'round') v = Math.round(args[0]);
          steps.push({ type: 'fn', fn: n.fn, args, value: v });
          return v;
        }
        default: return null;
      }
    };
    const value = ev(structured);
    return { value, steps };
  }

  /** 把 AST 还原成规范化的公式文本（统一运算符与空格） */
  function stringify(ast) {
    const OP = { add: '+', sub: '−', mul: '×', div: '÷' };
    const rec = (n) => {
      if (!n) return '';
      switch (n.kind) {
        case 'const': return String(n.value);
        case 'field': return n.name;
        case 'neg': return '−' + rec(n.arg);
        case 'bin': {
          const l = rec(n.left), r = rec(n.right);
          const lp = n.left.kind === 'bin' && PREC[n.left.op] < PREC[n.op];
          const rp = n.right.kind === 'bin' && PREC[n.right.op] < PREC[n.op];
          return `${lp ? '(' + l + ')' : l} ${OP[n.op]} ${rp ? '(' + r + ')' : r}`;
        }
        case 'call': return `${n.fn}(${n.args.map(rec).join(', ')})`;
        default: return '';
      }
    };
    return rec(ast);
  }

  const FormulaEngine = { tokenize, parse, validate, evaluate, evaluateWithSteps, stringify, toStructured, FUNCS };
  if (typeof module !== 'undefined' && module.exports) module.exports = FormulaEngine;
  global.FormulaEngine = FormulaEngine;
})(typeof window !== 'undefined' ? window : globalThis);
