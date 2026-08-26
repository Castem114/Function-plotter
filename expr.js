/* expr.js — 数学表达式 词法分析 + 递归下降解析 + 编译
 *
 * 负责把用户输入的字符串编译成一个 f(x) => number 的函数。
 * 内置“符号纠错”：ln -> 自然对数，pi/π -> 圆周率，e -> 自然常数，
 * √ -> sqrt，° -> 弧度换算，全角符号 -> 半角，×÷ -> 乘除 等。
 *
 * 仅依赖全局对象；无第三方依赖。
 */
(function (global) {
  'use strict';

  /* ---------- 函数表 ---------- */
  // 单参数函数：名字 -> 实现
  const FUNCS = {
    sin: Math.sin, cos: Math.cos, tan: Math.tan,
    asin: Math.asin, acos: Math.acos, atan: Math.atan,
    arcsin: Math.asin, arccos: Math.acos, arctan: Math.atan,
    sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
    asinh: Math.asinh, acosh: Math.acosh, atanh: Math.atanh,
    ln: Math.log,          // 自然对数 log_e
    log10: Math.log10,     // 常用对数
    log2: Math.log2,       // 以 2 为底
    sqrt: Math.sqrt,       // 平方根 √
    cbrt: Math.cbrt,       // 立方根
    abs: Math.abs,         // 绝对值
    floor: Math.floor,     // 向下取整
    ceil: Math.ceil,       // 向上取整
    round: Math.round,     // 四舍五入
    trunc: Math.trunc,     // 截断
    sign: Math.sign,       // 符号函数
    exp: Math.exp,          // 指数 e^x
    sec: x => 1 / Math.cos(x),
    csc: x => 1 / Math.sin(x),
    cot: x => 1 / Math.tan(x),
  };

  // 多参数 / 可变参数函数
  const FUNCS_MULTI = {
    // log(x) 常用对数；log(x, b) 以 b 为底
    log: (x, b) => (b === undefined ? Math.log10(x) : Math.log(x) / Math.log(b)),
    min: (...a) => Math.min(...a),
    max: (...a) => Math.max(...a),
    mod: (a, b) => ((a % b) + b) % b,
    pow: Math.pow,
    root: (x, n) => Math.sign(x) * Math.pow(Math.abs(x), 1 / n),
    gcd: (a, b) => { a = Math.abs(a); b = Math.abs(b); while (b) { [a, b] = [b, a % b]; } return a; },
    lcm: (a, b) => Math.abs(a * b) / (() => { a = Math.abs(a); b = Math.abs(b); while (b) { [a, b] = [b, a % b]; } return a; })(),
    atan2: Math.atan2,
    hypot: Math.hypot,
    logb: (x, b) => Math.log(x) / Math.log(b),
  };

  /* ---------- 常量 ---------- */
  const CONSTS = {
    pi: Math.PI,
    'π': Math.PI,
    e: Math.E,
    tau: Math.PI * 2,
    'τ': Math.PI * 2,
    phi: (1 + Math.sqrt(5)) / 2, // 黄金比
    inf: Infinity,
    infinity: Infinity,
    '∞': Infinity,
  };

  const VAR = 'x'; // 绘图自变量

  // 关键字集合（用于词法分析的最长匹配与拆分）
  const KEYWORDS = new Set([
    ...Object.keys(FUNCS),
    ...Object.keys(FUNCS_MULTI),
    ...Object.keys(CONSTS),
  ]);

  /* ---------- 符号含义（用于“纠错”提示） ---------- */
  const MEANINGS = {
    ln: '自然对数 ln (log_e)',
    log: '对数 log（log(x) 常用对数；log(x,b) 以 b 为底）',
    log10: '常用对数 log₁₀',
    log2: '以 2 为底对数',
    logb: '以指定底的对数',
    sqrt: '平方根 √',
    cbrt: '立方根 ∛',
    abs: '绝对值 |·|',
    sin: '正弦 sin', cos: '余弦 cos', tan: '正切 tan',
    sec: '正割 sec', csc: '余割 csc', cot: '余切 cot',
    asin: '反正弦', acos: '反余弦', atan: '反正切',
    arcsin: '反正弦', arccos: '反余弦', arctan: '反正切',
    sinh: '双曲正弦', cosh: '双曲余弦', tanh: '双曲正切',
    asinh: '反双曲正弦', acosh: '反双曲余弦', atanh: '反双曲正切',
    exp: '指数 e^x',
    floor: '向下取整 ⌊·⌋', ceil: '向上取整 ⌈·⌉',
    round: '四舍五入', trunc: '截断取整', sign: '符号函数',
    pi: '圆周率 π', 'π': '圆周率 π',
    e: '自然常数 e', tau: '常数 2π', 'τ': '常数 2π', phi: '黄金比 φ',
    inf: '无穷大 ∞', infinity: '无穷大 ∞', '∞': '无穷大 ∞',
    min: '最小值', max: '最大值', mod: '取模', pow: '幂运算',
    root: '开 n 次方', gcd: '最大公约数', lcm: '最小公倍数',
    atan2: '反正切(双参数)', hypot: '斜边长 √(a²+b²)',
    '√': '平方根', '°': '度→弧度 (×π/180)',
    '×': '乘号 → *', '÷': '除号 → /', '＾': '乘方 → ^',
    '²': '平方 → ^2', '³': '立方 → ^3', '¹': '一次方 → ^1',
  };

  /* ============================================================
   * 1. 规范化 / 符号纠错：把各种异形符号统一成可解析形式
   * ============================================================ */
  function normalize(input) {
    let s = String(input == null ? '' : input);
    const fixes = []; // 每项 { sym, desc }：原始符号 -> 转换说明

    const apply = (re, repl, sym, desc) => {
      if (re.test(s)) { s = s.replace(re, repl); fixes.push({ sym, desc }); }
    };

    // 全角括号 / 逗号
    // 注意：只匹配真正的全角符号，避免把半角 ( ) * 也算作“纠错”
    apply(/（/g, '(', '（', '半角 (');
    apply(/）/g, ')', '）', '半角 )');
    apply(/[，、]/g, ',', '，/、', '半角 ,');
    apply(/＋/g, '+', '＋', '半角 +');
    apply(/[－—–﹣]/g, '-', '－', '半角 -');
    apply(/[×✖✕]/g, '*', '×', '乘 *');
    apply(/[÷／∕]/g, '/', '÷', '除 /');
    apply(/＾/g, '^', '＾', '半角 ^');
    // 平方 / 立方 上标
    apply(/²/g, '^2', '²', '^2');
    apply(/³/g, '^3', '³', '^3');
    apply(/¹/g, '^1', '¹', '^1');
    // 根号：保留为特殊前缀符号，由词法/语法层处理（绑定到下一个运算数）
    if (/√/.test(s)) fixes.push({ sym: '√', desc: '平方根 sqrt(…)' });
    // 角度：30° -> 30*(pi/180)
    apply(/°/g, '*(pi/180)', '°', '弧度 (×π/180)');
    // 全角空格
    s = s.replace(/\u3000/g, ' ');
    // 各种空白统一
    s = s.replace(/\s+/g, ' ');
    return { text: s.trim(), fixes };
  }

  /* ============================================================
   * 2. 词法分析
   * ============================================================ */
  // 词法 token：{ type, value, text }
  // type ∈ NUM, CONST, FUNC, IDENT, LPAREN, RPAREN, COMMA, OP
  function tokenize(s) {
    const tokens = [];
    let i = 0;
    const n = s.length;
    const found = new Set(); // 命中的关键字（用于纠错提示）

    const isDigit = c => c >= '0' && c <= '9';
    const isLetter = c => /[A-Za-z_]/.test(c);

    while (i < n) {
      const c = s[i];

      if (c === ' ') { i++; continue; }

      // 数字（含小数与科学计数法 1e3、.5、2.5e-2）
      if (isDigit(c) || (c === '.' && isDigit(s[i + 1]))) {
        let j = i;
        while (j < n && isDigit(s[j])) j++;
        if (s[j] === '.') { j++; while (j < n && isDigit(s[j])) j++; }
        // 科学计数法：e 后跟可选符号与数字
        if (j < n && (s[j] === 'e' || s[j] === 'E')) {
          const k = j + 1;
          if (k < n && (s[k] === '+' || s[k] === '-')) {
            if (isDigit(s[k + 1])) { j = k + 1; while (j < n && isDigit(s[j])) j++; }
          } else if (isDigit(s[k])) {
            j = k; while (j < n && isDigit(s[j])) j++;
          }
        }
        const text = s.slice(i, j);
        tokens.push({ type: 'NUM', value: parseFloat(text), text });
        i = j;
        continue;
      }

      // 希腊字母单字符常量
      if (c === 'π' || c === 'τ' || c === '∞') {
        found.add(c);
        tokens.push({ type: 'CONST', value: CONSTS[c], text: c });
        i++;
        continue;
      }

      // 根号前缀 √：作为一元前缀，绑定到下一个运算数
      if (c === '√') {
        found.add('√');
        tokens.push({ type: 'SQRT', value: 'sqrt', text: '√' });
        i++;
        continue;
      }

      // 字母：做“关键字感知”拆分
      // 先尝试匹配最长关键字；否则取单字母作为变量标识符。
      // 这样 xpi -> x*pi，xsin -> x*sin，pix -> pi*x 等。
      if (isLetter(c)) {
        // 从当前位置起，逐段识别
        let seg = i;
        while (seg < n && isLetter(s[seg])) seg++;
        const word = s.slice(i, seg);
        // 尝试整体关键字
        if (KEYWORDS.has(word)) {
          found.add(word);
          tokens.push(makeKeywordToken(word));
          i = seg;
          continue;
        }
        // 拆分：在 word 内部按“最长关键字 / 单字母变量”切分
        let p = 0;
        const parts = [];
        while (p < word.length) {
          const rest = word.slice(p);
          let matched = null;
          // 关键字按长度降序尝试
          const kws = [...KEYWORDS].filter(k => rest.startsWith(k))
            .sort((a, b) => b.length - a.length);
          if (kws.length) {
            matched = kws[0];
            parts.push({ kw: matched });
            found.add(matched);
            p += matched.length;
          } else {
            // 单字母变量
            parts.push({ var: word[p] });
            p++;
          }
        }
        for (const part of parts) {
          if (part.kw) tokens.push(makeKeywordToken(part.kw));
          else tokens.push({ type: 'IDENT', value: part.var, text: part.var });
        }
        i = seg;
        continue;
      }

      // 括号 / 逗号
      if (c === '(') { tokens.push({ type: 'LPAREN', value: '(', text: c }); i++; continue; }
      if (c === ')') { tokens.push({ type: 'RPAREN', value: ')', text: c }); i++; continue; }
      if (c === ',') { tokens.push({ type: 'COMMA', value: ',', text: c }); i++; continue; }
      // 等号（仅用于 x= / y= 顶层形式）
      if (c === '=') { tokens.push({ type: 'EQ', value: '=', text: c }); i++; continue; }

      // 运算符
      if ('+-*/^!'.indexOf(c) >= 0) {
        tokens.push({ type: 'OP', value: c, text: c }); i++; continue;
      }

      // π 等 unicode 已处理；其它未识别字符报错
      throw new ExprError(`无法识别的字符 “${c}”`);
    }

    tokens.push({ type: 'EOF', value: null, text: '' });
    return { tokens, found };
  }

  function makeKeywordToken(name) {
    if (FUNCS[name] || FUNCS_MULTI[name]) return { type: 'FUNC', value: name, text: name };
    return { type: 'CONST', value: CONSTS[name], text: name };
  }

  /* ============================================================
   * 3. 递归下降解析（编译成闭包）
   *    优先级（低 → 高）：
   *    + -        （加/减，二元）
   //    * / 与隐式乘  （乘/除）
   *    一元 - +     （正负号）
   *    ^            （乘方，右结合）
   *    !            （阶乘，后缀）
   *    基本（数/常量/函数/括号/变量）
   * ============================================================ */
  function ExprError(message) {
    this.name = 'ExprError';
    this.message = message;
  }
  ExprError.prototype = Object.create(Error.prototype);

  function Parser(tokens) {
    this.toks = tokens;
    this.i = 0;
  }
  Parser.prototype.peek = function () { return this.toks[this.i]; };
  Parser.prototype.next = function () { return this.toks[this.i++]; };
  Parser.prototype.expect = function (type, text) {
    const t = this.peek();
    if (!t || t.type !== type || (text !== undefined && t.value !== text)) {
      throw new ExprError(text != null
        ? `此处需要 “${text}”，但得到 “${t ? t.text : '空'}”`
        : `此处需要 ${type}，但得到 “${t ? t.text : '空'}”`);
    }
    return this.next();
  };

  Parser.prototype.parse = function () {
    if (this.peek().type === 'EOF') throw new ExprError('表达式为空');
    const fn = this.parseExpr();
    if (this.peek().type !== 'EOF') {
      throw new ExprError(`多余的输入：“${this.peek().text}”`);
    }
    return fn;
  };

  // expr = term (('+'|'-') term)*
  Parser.prototype.parseExpr = function () {
    let left = this.parseTerm();
    for (;;) {
      const t = this.peek();
      if (t.type === 'OP' && (t.value === '+' || t.value === '-')) {
        this.next();
        const right = this.parseTerm();
        if (t.value === '+') { const l = left, r = right; left = x => l(x) + r(x); }
        else { const l = left, r = right; left = x => l(x) - r(x); }
      } else break;
    }
    return left;
  };

  // term = unary (('*'|'/') unary | implicit-unary)*
  Parser.prototype.parseTerm = function () {
    let left = this.parseUnary();
    for (;;) {
      const t = this.peek();
      if (t.type === 'OP' && (t.value === '*' || t.value === '/')) {
        this.next();
        const right = this.parseUnary();
        if (t.value === '*') { const l = left, r = right; left = x => l(x) * r(x); }
        else { const l = left, r = right; left = x => l(x) / r(x); }
      } else if (startsValue(t)) {
        // 隐式乘法：2x, 2(x+1), 2sin(x), (x)(x), x sin(x) ...
        const right = this.parseUnary();
        const l = left; left = x => l(x) * right(x);
      } else break;
    }
    return left;
  };

  // unary = ('+'|'-') unary | '√' unary | factor
  Parser.prototype.parseUnary = function () {
    const t = this.peek();
    if (t.type === 'OP' && (t.value === '-' || t.value === '+')) {
      this.next();
      const operand = this.parseUnary();
      if (t.value === '-') { const o = operand; return x => -o(x); }
      return operand;
    }
    if (t.type === 'SQRT') {
      this.next();
      const operand = this.parseUnary();
      const o = operand;
      return x => Math.sqrt(o(x));
    }
    return this.parseFactor();
  };

  // factor = postfix ('^' factor)?   （右结合）
  Parser.prototype.parseFactor = function () {
    const base = this.parsePostfix();
    const t = this.peek();
    if (t.type === 'OP' && t.value === '^') {
      this.next();
      const exp = this.parseFactor();
      const b = base, e = exp;
      return x => Math.pow(b(x), e(x));
    }
    return base;
  };

  // postfix = primary ('!')*
  Parser.prototype.parsePostfix = function () {
    let base = this.parsePrimary();
    for (;;) {
      const t = this.peek();
      if (t.type === 'OP' && t.value === '!') {
        this.next();
        const b = base;
        base = x => factorial(b(x));
      } else break;
    }
    return base;
  };

  // primary = NUM | CONST | FUNC '(' args ')' | IDENT | '(' expr ')'
  Parser.prototype.parsePrimary = function () {
    const t = this.peek();
    if (!t || t.type === 'EOF') throw new ExprError('表达式不完整');

    if (t.type === 'NUM') { this.next(); const v = t.value; return () => v; }
    if (t.type === 'CONST') { this.next(); const v = t.value; return () => v; }
    if (t.type === 'IDENT') {
      this.next();
      if (t.value === VAR) return x => x;
      throw new ExprError(`未知标识符 “${t.value}”：本绘制器自变量仅支持 x。请检查拼写，或用 * 连接，例如 x*sin(x)。`);
    }
    if (t.type === 'LPAREN') {
      this.next();
      const e = this.parseExpr();
      this.expect('RPAREN');
      return e;
    }
    if (t.type === 'FUNC') {
      this.next();
      // 带括号：正常调用  sin(x), log(x, 2)
      if (this.peek().type === 'LPAREN') {
        this.next();
        const args = [];
        if (this.peek().type !== 'RPAREN') {
          args.push(this.parseExpr());
          while (this.peek().type === 'COMMA') { this.next(); args.push(this.parseExpr()); }
        }
        this.expect('RPAREN');
        return applyFunc(t.value, args);
      }
      // 不带括号：取紧随其后的“隐式乘积”为参数
      //   lnx = ln(x), ln2x = ln(2x), sin2x = sin(2x), sinxcosx = sin(x)·cos(x)
      //   隐式乘积只含 隐式乘法 + 幂 + 阶乘 + √；遇到 + - * / , ) 另一函数 EOF 即止
      if (!canNoParen(t.value)) {
        throw new ExprError(`函数 ${t.value}() 需要用括号传参，例如 ${t.value}(x)`);
      }
      const arg = this.parseImplicitArg();
      const impl = noParenImpl(t.value);
      const a = arg;
      return x => impl(a(x));
    }
    throw new ExprError(`意外的符号 “${t.text}”`);
  };

  // 不带括号时可使用的函数：所有单参函数 + log（视作常用对数 log10）
  function canNoParen(name) {
    return !!FUNCS[name] || name === 'log';
  }
  function noParenImpl(name) {
    if (FUNCS[name]) return FUNCS[name];
    if (name === 'log') return Math.log10;
    throw new ExprError(`函数 ${name}() 不能省略括号`);
  }

  // 不带括号函数的参数：隐式乘积
  //   = argAtom (隐式 argAtom)*
  //   其中 argAtom = √ argAtom | 原子(含幂、阶乘)
  Parser.prototype.parseImplicitArg = function () {
    let left = this.parseArgAtom();
    for (;;) {
      const t = this.peek();
      // 隐式乘法仅对 数/常量/变量/左括号 生效；遇到函数即停止
      if (t.type === 'NUM' || t.type === 'CONST' || t.type === 'IDENT' || t.type === 'LPAREN') {
        const right = this.parseArgAtom();
        const l = left; left = x => l(x) * right(x);
      } else break;
    }
    return left;
  };

  // 参数中的一个原子：可带 √前缀、阶乘后缀、幂
  Parser.prototype.parseArgAtom = function () {
    let base = this.parseArgPrimary();
    while (this.peek().type === 'OP' && this.peek().value === '!') {
      this.next(); const b = base; base = x => factorial(b(x));
    }
    if (this.peek().type === 'OP' && this.peek().value === '^') {
      this.next(); const exp = this.parseUnary(); const b = base;
      base = x => Math.pow(b(x), exp(x));
    }
    return base;
  };

  // 参数原子核心：数/常量/变量/括号/√；函数在此上下文中是“停止”信号
  Parser.prototype.parseArgPrimary = function () {
    const t = this.peek();
    if (!t || t.type === 'EOF') throw new ExprError('函数缺少参数');
    if (t.type === 'NUM') { this.next(); const v = t.value; return () => v; }
    if (t.type === 'CONST') { this.next(); const v = t.value; return () => v; }
    if (t.type === 'IDENT') {
      this.next();
      if (t.value === VAR) return x => x;
      throw new ExprError(`未知标识符 “${t.value}”：自变量仅支持 x`);
    }
    if (t.type === 'LPAREN') {
      this.next(); const e = this.parseExpr(); this.expect('RPAREN'); return e;
    }
    if (t.type === 'SQRT') {
      this.next(); const o = this.parseArgAtom(); return x => Math.sqrt(o(x));
    }
    if (t.type === 'FUNC') {
      throw new ExprError(`函数参数中不能紧跟另一函数 “${t.value}”，请用括号，如 ln(sin(x))`);
    }
    throw new ExprError(`函数参数不完整，遇到 “${t.text}”`);
  };

  function startsValue(t) {
    return t && (t.type === 'NUM' || t.type === 'CONST' ||
      t.type === 'FUNC' || t.type === 'IDENT' || t.type === 'LPAREN');
  }

  function applyFunc(name, args) {
    if (FUNCS[name]) {
      if (args.length !== 1) throw new ExprError(`函数 ${name}() 需要 1 个参数，但收到 ${args.length} 个`);
      const a = args[0];
      return x => FUNCS[name](a(x));
    }
    if (FUNCS_MULTI[name]) {
      if (name === 'log') {
        if (args.length < 1 || args.length > 2) throw new ExprError(`函数 log() 参数个数为 1 或 2，但收到 ${args.length}`);
      } else if (args.length < 2) {
        throw new ExprError(`函数 ${name}() 至少需要 2 个参数`);
      }
      const f = FUNCS_MULTI[name];
      return x => f(...args.map(a => a(x)));
    }
    throw new ExprError(`未知函数 ${name}()`);
  }

  function factorial(n) {
    if (!isFinite(n) || n < 0) return NaN;
    const k = Math.floor(n);
    let r = 1;
    for (let j = 2; j <= k; j++) r *= j;
    return r;
  }

  /* ============================================================
   * 4. 对外 API：analyze(input)
   *    返回 { ok, kind, fn?, xVal?, normalized, corrections, error }
   *    kind: 'function' (y=f(x)) | 'vertical' (x=常数 → 竖直直线)
   * ============================================================ */
  function analyze(input) {
    let normalized, fixes;
    try {
      ({ text: normalized, fixes } = normalize(input));
    } catch (e) {
      return { ok: false, error: e.message || String(e), normalized: '', corrections: [] };
    }

    let tokens, found;
    try {
      ({ tokens, found } = tokenize(normalized));
    } catch (e) {
      return { ok: false, error: e.message || String(e), normalized, corrections: buildCorrections(found, fixes) };
    }

    // 识别顶层  x = ...  或  y = ...  形式
    //   x = c   → 竖直直线 x = c（c 为常数表达式）
    //   y = f   → 等价于 f(x)
    const head0 = tokens[0];
    const head1 = tokens[1];
    if (head0 && head0.type === 'IDENT' && head1 && head1.type === 'EQ' &&
      (head0.value === 'x' || head0.value === 'y')) {
      const isVertical = head0.value === 'x';
      // RHS token 序列（去掉前两个 + 末尾 EOF 后重新加 EOF）
      const rhs = tokens.slice(2, tokens.length - 1);
      if (rhs.length === 0) {
        return { ok: false, error: `${head0.value}= 后缺少表达式`, normalized, corrections: buildCorrections(found, fixes) };
      }
      // x= 的右边必须是常数（不含变量 x）
      if (isVertical && rhs.some(tk => tk.type === 'IDENT' && tk.value === VAR)) {
        return { ok: false, error: `x= 右侧应为常数，例如 x=2、x=pi`, normalized, corrections: buildCorrections(found, fixes) };
      }
      try {
        const rhsTok = rhs.concat([{ type: 'EOF', value: null, text: '' }]);
        const fn = new Parser(rhsTok).parse();
        if (isVertical) {
          const xVal = fn(0); // RHS 为常数
          if (!isFinite(xVal)) throw new ExprError('x= 右侧不是有效常数');
          return { ok: true, kind: 'vertical', xVal, normalized, corrections: buildCorrections(found, fixes), error: null };
        }
        return { ok: true, kind: 'function', fn, normalized, corrections: buildCorrections(found, fixes), error: null };
      } catch (e) {
        return { ok: false, error: e.message || String(e), normalized, corrections: buildCorrections(found, fixes) };
      }
    }

    // 其它位置出现 = 视为不支持
    if (tokens.some(tk => tk.type === 'EQ')) {
      return { ok: false, error: '暂仅支持 x=常数（竖直直线）或 y=表达式；无法解析此处的 “=”', normalized, corrections: buildCorrections(found, fixes) };
    }

    let fn;
    try {
      fn = new Parser(tokens).parse();
    } catch (e) {
      return { ok: false, error: e.message || String(e), normalized, corrections: buildCorrections(found, fixes) };
    }
    return { ok: true, kind: 'function', fn, normalized, corrections: buildCorrections(found, fixes), error: null };
  }

  function buildCorrections(found, fixes) {
    const list = [];
    const seen = new Set();
    const add = (symbol, meaning) => {
      if (seen.has(symbol)) return;
      seen.add(symbol);
      list.push({ symbol, meaning });
    };
    fixes.forEach(f => add(f.sym, f.desc));
    // 关键字按首次出现顺序加入
    [...found].forEach(k => add(k, MEANINGS[k] || k));
    return list;
  }

  // 调试：返回标准化后的文本
  function normalizeText(input) { return normalize(input).text; }

  global.Expr = { analyze, normalize: normalizeText, ExprError };
})(window);
