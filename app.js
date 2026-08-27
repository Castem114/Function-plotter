/* app.js — 函数绘制器主程序
 *  - Plotter：坐标变换、网格/坐标轴、曲线 + 竖直直线、特殊点、悬停/钉选
 *  - UI：函数行管理、错误显示、纠错徽标、坐标读数、悬停信息框
 *  依赖：expr.js 暴露的 window.Expr
 */
(function () {
  'use strict';

  const PALETTE = [
    '#2b8a3e', '#1c7ed6', '#e8590c', '#ae3ec9',
    '#e03131', '#0ca678', '#f08c00', '#1971c2',
  ];
  const SUB = ['₀', '₁', '₂', '₃', '₄', '₅', '₆', '₇', '₈', '₉'];
  const sub = (n) => String(n).split('').map(d => SUB[+d]).join('');
  const TYPE_LABEL = { zero: '零点', max: '极大值', min: '极小值', inter: '交点', point: '点' };

  /* ===================== Plotter ===================== */
  class Plotter {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.dpr = window.devicePixelRatio || 1;
      this.xMin = -10; this.xMax = 10;
      this.yMin = -6; this.yMax = 6;
      this.functions = []; // [{ kind, fn?, xVal?, color, visible, label }]
      this.hover = null;       // { cursor:{x,y}, point, special }
      this.special = [];       // 特殊点
      this.pinned = [];        // 用户钉选
      this._specialSig = null;
      this._bindEvents();
      this.resize();
    }

    resize() {
      const rect = this.canvas.getBoundingClientRect();
      this.width = rect.width; this.height = rect.height;
      this.dpr = window.devicePixelRatio || 1;
      this.canvas.width = Math.round(this.width * this.dpr);
      this.canvas.height = Math.round(this.height * this.dpr);
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this.draw();
    }

    px(x) { return (x - this.xMin) / (this.xMax - this.xMin) * this.width; }
    py(y) { return this.height - (y - this.yMin) / (this.yMax - this.yMin) * this.height; }
    mx(px) { return this.xMin + (px / this.width) * (this.xMax - this.xMin); }
    my(py) { return this.yMin + (1 - py / this.height) * (this.yMax - this.yMin); }

    setView(xMin, xMax, yMin, yMax) {
      this.xMin = xMin; this.xMax = xMax; this.yMin = yMin; this.yMax = yMax;
      this.draw();
    }
    reset() { this.setView(-10, 10, -6, 6); }

    zoom(factor, cxPx, cyPy) {
      const cx = cxPx != null ? this.mx(cxPx) : (this.xMin + this.xMax) / 2;
      const cy = cyPy != null ? this.my(cyPy) : (this.yMin + this.yMax) / 2;
      const w = (this.xMax - this.xMin) / factor;
      const h = (this.yMax - this.yMin) / factor;
      const lx = (cx - this.xMin) / (this.xMax - this.xMin);
      const ly = (cy - this.yMin) / (this.yMax - this.yMin);
      this.xMin = cx - lx * w; this.xMax = cx + (1 - lx) * w;
      this.yMin = cy - ly * h; this.yMax = cy + (1 - ly) * h;
      this.draw();
    }
    panByPx(dxPx, dyPy) {
      const dx = -dxPx / this.width * (this.xMax - this.xMin);
      const dy = dyPy / this.height * (this.yMax - this.yMin);
      this.xMin += dx; this.xMax += dx;
      this.yMin += dy; this.yMax += dy;
      this.draw();
    }

    niceStep(range, target) {
      const raw = range / target;
      const p = Math.pow(10, Math.floor(Math.log10(raw)));
      const r = raw / p;
      let mult;
      if (r < 1.5) mult = 1; else if (r < 3) mult = 2; else if (r < 7) mult = 5; else mult = 10;
      return mult * p;
    }
    fmt(num) {
      if (num == null || !isFinite(num)) return '—';
      if (Math.abs(num) < 1e-9) return '0';
      const a = Math.abs(num);
      if (a >= 1e6 || a < 1e-4) return num.toExponential(2);
      return (Math.round(num * 1e5) / 1e5).toString();
    }

    draw() {
      const ctx = this.ctx;
      ctx.clearRect(0, 0, this.width, this.height);
      this.ensureSpecial();
      this.drawGrid(ctx);
      this.drawAxes(ctx);
      this.drawFunctions(ctx);
      this.drawSpecial(ctx);
      this.drawPinned(ctx);
      this.drawHover(ctx);
    }

    drawGrid(ctx) {
      const xStep = this.niceStep(this.xMax - this.xMin, 12);
      const yStep = this.niceStep(this.yMax - this.yMin, 8);
      ctx.save(); ctx.strokeStyle = '#eef1f4'; ctx.lineWidth = 1;
      const xSub = xStep / 5, ySub = yStep / 5;
      ctx.beginPath();
      for (let x = Math.ceil(this.xMin / xSub) * xSub; x <= this.xMax; x += xSub) { const X = this.px(x); ctx.moveTo(X, 0); ctx.lineTo(X, this.height); }
      for (let y = Math.ceil(this.yMin / ySub) * ySub; y <= this.yMax; y += ySub) { const Y = this.py(y); ctx.moveTo(0, Y); ctx.lineTo(this.width, Y); }
      ctx.stroke(); ctx.restore();
      ctx.save(); ctx.strokeStyle = '#dde2e8'; ctx.lineWidth = 1; ctx.beginPath();
      for (let x = Math.ceil(this.xMin / xStep) * xStep; x <= this.xMax; x += xStep) { const X = this.px(x); ctx.moveTo(X, 0); ctx.lineTo(X, this.height); }
      for (let y = Math.ceil(this.yMin / yStep) * yStep; y <= this.yMax; y += yStep) { const Y = this.py(y); ctx.moveTo(0, Y); ctx.lineTo(this.width, Y); }
      ctx.stroke(); ctx.restore();
      this._xStep = xStep; this._yStep = yStep;
    }
    drawAxes(ctx) {
      const x0 = this.px(0), y0 = this.py(0);
      ctx.save(); ctx.strokeStyle = '#495057'; ctx.fillStyle = '#495057';
      ctx.lineWidth = 1.5; ctx.font = '12px ui-sans-serif, system-ui, sans-serif';
      const yAxisOnScreen = y0 >= 0 && y0 <= this.height;
      const yLine = yAxisOnScreen ? y0 : (this.yMin >= 0 ? this.height - 1 : 0);
      ctx.beginPath(); ctx.moveTo(0, yLine); ctx.lineTo(this.width, yLine); ctx.stroke();
      this.arrow(ctx, this.width - 1, yLine, this.width - 9, yLine - 5);
      this.arrow(ctx, this.width - 1, yLine, this.width - 9, yLine + 5);
      const xAxisOnScreen = x0 >= 0 && x0 <= this.width;
      const xLine = xAxisOnScreen ? x0 : (this.xMin >= 0 ? 1 : this.width - 1);
      ctx.beginPath(); ctx.moveTo(xLine, 0); ctx.lineTo(xLine, this.height); ctx.stroke();
      this.arrow(ctx, xLine, 1, xLine - 5, 9);
      this.arrow(ctx, xLine, 1, xLine + 5, 9);
      const xStep = this._xStep, yStep = this._yStep;
      ctx.textBaseline = 'top'; ctx.textAlign = 'center';
      for (let x = Math.ceil(this.xMin / xStep) * xStep; x <= this.xMax; x += xStep) {
        if (Math.abs(x) < xStep / 2) continue;
        const X = this.px(x); ctx.beginPath(); ctx.moveTo(X, yLine - 3); ctx.lineTo(X, yLine + 3); ctx.stroke();
        ctx.fillText(this.fmt(x), X, Math.min(yLine + 5, this.height - 14));
      }
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      for (let y = Math.ceil(this.yMin / yStep) * yStep; y <= this.yMax; y += yStep) {
        if (Math.abs(y) < yStep / 2) continue;
        const Y = this.py(y); ctx.beginPath(); ctx.moveTo(xLine - 3, Y); ctx.lineTo(xLine + 3, Y); ctx.stroke();
        ctx.fillText(this.fmt(y), Math.max(xLine - 6, 30), Y);
      }
      if (xAxisOnScreen && yAxisOnScreen) { ctx.textAlign = 'right'; ctx.textBaseline = 'top'; ctx.fillText('0', x0 - 4, y0 + 4); }
      ctx.restore();
    }
    arrow(ctx, x1, y1, x2, y2) { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }

    /* ---- 曲线 + 竖直直线 ---- */
    drawFunctions(ctx) {
      const N = Math.max(Math.round(this.width * 2), 400);
      const yRange = this.yMax - this.yMin;
      const breakThreshold = yRange;
      const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
      const lo = -1e4, hi = this.height + 1e4;

      for (const f of this.functions) {
        if (!f.visible) continue;
        if (f.kind === 'vertical') {
          if (f.xVal == null || !isFinite(f.xVal)) continue;
          const X = this.px(f.xVal);
          if (X < -5 || X > this.width + 5) continue;
          ctx.save(); ctx.strokeStyle = f.color; ctx.lineWidth = 2.2;
          ctx.beginPath(); ctx.moveTo(X, 0); ctx.lineTo(X, this.height); ctx.stroke();
          ctx.fillStyle = f.color; ctx.font = '11px ui-monospace, monospace';
          ctx.textAlign = 'left'; ctx.textBaseline = 'top';
          ctx.fillText('x=' + this.fmt(f.xVal), Math.min(X + 4, this.width - 40), 6);
          ctx.restore();
          continue;
        }
        if (f.kind === 'implicit') { this.drawImplicit(ctx, f); continue; }
        if (!f.fn) continue;
        ctx.save(); ctx.strokeStyle = f.color; ctx.lineWidth = 2.2; ctx.lineJoin = 'round';
        ctx.beginPath();
        let prevY = null, started = false;
        for (let k = 0; k <= N; k++) {
          const x = this.xMin + (k / N) * (this.xMax - this.xMin);
          let y; try { y = f.fn(x); } catch (e) { y = NaN; }
          if (!isFinite(y)) { started = false; prevY = null; continue; }
          const X = this.px(x); const Y = clamp(this.py(y), lo, hi);
          if (started && prevY !== null && Math.abs(y - prevY) <= breakThreshold) ctx.lineTo(X, Y);
          else { ctx.moveTo(X, Y); started = true; }
          prevY = y;
        }
        ctx.stroke(); ctx.restore();
      }
    }

    /* ---- 隐式曲线 F(x,y)=0：Marching Squares ---- */
    drawImplicit(ctx, f) {
      if (!f.fn) return;
      const GX = Math.max(Math.round(this.width / 6), 60);
      const GY = Math.max(Math.round(this.height / 6), 60);
      const xMin = this.xMin, xMax = this.xMax, yMin = this.yMin, yMax = this.yMax;
      const dx = (xMax - xMin) / GX, dy = (yMax - yMin) / GY;
      const F = (i, j) => { const x = xMin + i * dx, y = yMax - j * dy; try { return f.fn(x, y); } catch (e) { return NaN; } };
      const grid = new Float32Array((GX + 1) * (GY + 1));
      for (let j = 0; j <= GY; j++) for (let i = 0; i <= GX; i++) grid[j * (GX + 1) + i] = F(i, j);
      const at = (i, j) => grid[j * (GX + 1) + i];
      ctx.save();
      ctx.strokeStyle = f.color; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.beginPath();
      for (let j = 0; j < GY; j++) {
        for (let i = 0; i < GX; i++) {
          const tl = at(i, j), tr = at(i + 1, j), br = at(i + 1, j + 1), bl = at(i, j + 1);
          if (!isFinite(tl) || !isFinite(tr) || !isFinite(br) || !isFinite(bl)) continue;
          const x0 = xMin + i * dx, x1 = x0 + dx;
          const y0 = yMax - j * dy, y1 = y0 - dy;
          const lerp = (a, b, va, vb) => (vb === va) ? null : a + (b - a) * (0 - va) / (vb - va);
          const top = lerp(x0, x1, tl, tr); const right = lerp(y0, y1, tr, br);
          const bottom = lerp(x0, x1, bl, br); const left = lerp(y0, y1, tl, bl);
          let code = 0; if (tl > 0) code |= 8; if (tr > 0) code |= 4; if (br > 0) code |= 2; if (bl > 0) code |= 1;
          // 边上的零点坐标 [x,y]（已线性插值）
          const E = { top: top != null ? [top, y0] : null, right: right != null ? [x1, right] : null, bottom: bottom != null ? [bottom, y1] : null, left: left != null ? [x0, left] : null };
          let pairs;
          switch (code) {
            case 1: case 14: pairs = [[E.bottom, E.left]]; break;
            case 2: case 13: pairs = [[E.bottom, E.right]]; break;
            case 3: case 12: pairs = [[E.left, E.right]]; break;
            case 4: case 11: pairs = [[E.top, E.right]]; break;
            case 6: case 9: pairs = [[E.top, E.bottom]]; break;
            case 7: case 8: pairs = [[E.top, E.left]]; break;
            case 5: pairs = [[E.top, E.right], [E.bottom, E.left]]; break; // 鞍点
            case 10: pairs = [[E.top, E.left], [E.bottom, E.right]]; break; // 鞍点
            default: pairs = [];
          }
          for (const [p1, p2] of pairs) {
            if (!p1 || !p2) continue;
            ctx.moveTo(this.px(p1[0]), this.py(p1[1]));
            ctx.lineTo(this.px(p2[0]), this.py(p2[1]));
          }
        }
      }
      ctx.stroke();
      ctx.restore();
    }

    /* ---- 特殊点检测（零点 / 极值 / 与其它图像交点）---- */
    ensureSpecial() {
      const r = (v) => Math.round(v * 1e5) / 1e5;
      let content = '';
      for (const f of this.functions) {
        content += (f.kind === 'vertical' ? 'v' + r(f.xVal) : 'f' + (f.fn ? '1' : '0')) + (f.visible ? 'y' : 'n') + '|';
      }
      const sig = r(this.xMin) + ',' + r(this.xMax) + '/' + content;
      if (sig === this._specialSig) return;
      this._specialSig = sig;
      this.computeSpecial();
    }

    bisect(g, a, b, iters = 40) {
      let ga = g(a), gb = g(b);
      if (!isFinite(ga) || !isFinite(gb) || ga * gb > 0) return null;
      for (let i = 0; i < iters; i++) {
        const m = (a + b) / 2, gm = g(m);
        if (!isFinite(gm)) return null;
        if (Math.abs(gm) < 1e-12) return m;
        if (ga * gm <= 0) { b = m; gb = gm; } else { a = m; ga = gm; }
      }
      return (a + b) / 2;
    }

    computeSpecial() {
      const N = 260;
      const fs = this.functions;
      const xMin = this.xMin, xMax = this.xMax, yMin = this.yMin, yMax = this.yMax;
      const xs = new Array(N + 1);
      for (let k = 0; k <= N; k++) xs[k] = xMin + (k / N) * (xMax - xMin);
      const funcIdx = [], verts = [], implIdx = [];
      for (let i = 0; i < fs.length; i++) {
        if (!fs[i].visible) continue;
        if (fs[i].kind === 'vertical') { if (isFinite(fs[i].xVal)) verts.push(i); }
        else if (fs[i].kind === 'function' && fs[i].fn) funcIdx.push(i);
        else if (fs[i].kind === 'implicit' && fs[i].fn) implIdx.push(i);
      }
      const ev = (i, x) => { try { return fs[i].fn(x); } catch (e) { return NaN; } };
      const Y = funcIdx.map(i => xs.map(x => ev(i, x)));
      const inViewY = y => isFinite(y) && y >= yMin - 1 && y <= yMax + 1;
      const pts = [];
      const push = (p) => { if (pts.length < 80) pts.push(p); };

      // 零点
      for (let a = 0; a < funcIdx.length; a++) {
        const i = funcIdx[a], y = Y[a];
        for (let k = 0; k < N; k++) {
          const ya = y[k], yb = y[k + 1];
          if (!isFinite(ya) || !isFinite(yb)) continue;
          if (ya === 0) {
            // 仅当为孤立零点时标记：相邻样本不同时为 0
            //   （避免 e^x / a^x 在左侧下溢为 0 的平台被误判成一串零点）
            const yprev = k > 0 ? y[k - 1] : NaN;
            const ynext = k < N ? y[k + 1] : NaN;
            const plateau = (k > 0 && yprev === 0) || (k < N && ynext === 0);
            if (!plateau) push({ type: 'zero', x: xs[k], y: 0, i });
          }
          else if (ya * yb < 0) {
            const root = this.bisect(x => ev(i, x), xs[k], xs[k + 1]);
            if (root != null && root >= xMin && root <= xMax) push({ type: 'zero', x: root, y: 0, i });
          }
        }
      }
      // 极值（导数符号变化）
      const h = Math.max((xMax - xMin) / N / 4, 1e-5);
      for (let a = 0; a < funcIdx.length; a++) {
        const i = funcIdx[a], y = Y[a];
        // 先判断函数值范围：若 max-min 相对极小 → 近常函数（含数值求导得到的常数
        // 如 (2x)'=2），其"导数"全是浮点噪声，跳过极值检测
        let maxY = -Infinity, minY = Infinity, maxAbsY = 0;
        for (let k = 0; k <= N; k++) {
          const v = y[k];
          if (!isFinite(v)) continue;
          if (v > maxY) maxY = v;
          if (v < minY) minY = v;
          if (Math.abs(v) > maxAbsY) maxAbsY = Math.abs(v);
        }
        const tolRange = 1e-9 * (1 + maxAbsY);
        if (maxY - minY < tolRange) continue; // 近常函数：无极值
        const d = x => { const y1 = ev(i, x - h), y2 = ev(i, x + h); if (!isFinite(y1) || !isFinite(y2)) return NaN; return (y2 - y1) / (2 * h); };
        // 先算出所有导数值，再以其最大幅度设定噪声阈值（相对，避免阈值随函数值范围
        // 放大而误杀极值附近的真实小导数；噪声 ~1e-14，真极值附近导数 >> 此阈值）
        const dks = new Array(N + 1);
        let maxAbsD = 0;
        for (let k = 0; k <= N; k++) {
          const dk = d(xs[k]); dks[k] = dk;
          if (isFinite(dk) && Math.abs(dk) > maxAbsD) maxAbsD = Math.abs(dk);
        }
        const tolD = 1e-9 * (1 + maxAbsD);
        let prevSign = 0;
        for (let k = 0; k <= N; k++) {
          const dk = dks[k];
          if (!isFinite(dk)) { prevSign = 0; continue; }
          const s = Math.abs(dk) < tolD ? 0 : Math.sign(dk);
          if (prevSign !== 0 && s !== 0 && s !== prevSign) {
            const root = this.bisect(d, xs[k - 1], xs[k]);
            if (root != null) {
              const y = ev(i, root);
              if (inViewY(y)) push({ type: prevSign > 0 ? 'max' : 'min', x: root, y, i });
            }
          }
          if (s !== 0) prevSign = s;
        }
      }
      // 函数两两交点
      //   注意：当两条曲线重合（ga≈0 且 gb≈0）时，整段都不标，避免两个相同函数被标满交点
      for (let a = 0; a < funcIdx.length; a++) for (let b = a + 1; b < funcIdx.length; b++) {
        const i = funcIdx[a], j = funcIdx[b];
        for (let k = 0; k < N; k++) {
          const ya = Y[a][k], yb = Y[b][k], ya2 = Y[a][k + 1], yb2 = Y[b][k + 1];
          const ga = ya - yb, gb = ya2 - yb2;
          if (!isFinite(ga) || !isFinite(gb)) continue;
          const tolG = 1e-6 * (1 + Math.max(Math.abs(ya), Math.abs(yb), Math.abs(ya2), Math.abs(yb2)));
          // 两端都接近 0 → 视为重合段，跳过
          if (Math.abs(ga) < tolG && Math.abs(gb) < tolG) continue;
          if (ga * gb < 0) {
            const root = this.bisect(x => ev(i, x) - ev(j, x), xs[k], xs[k + 1]);
            if (root != null) { const y = ev(i, root); if (inViewY(y)) push({ type: 'inter', x: root, y, i, j }); }
          } else if (Math.abs(ga) < tolG) {
            // 孤立交点恰好落在采样点上
            if (inViewY(ya)) push({ type: 'inter', x: xs[k], y: ya, i, j });
          }
        }
      }
      // 函数与竖直直线 x=c 的交点
      for (const i of funcIdx) for (const vi of verts) {
        const c = fs[vi].xVal;
        if (c < xMin || c > xMax) continue;
        const y = ev(i, c);
        if (inViewY(y)) push({ type: 'inter', x: c, y, i, j: vi, v: true });
      }
      // 隐式曲线 F(x,y)=0 的特殊点：与坐标轴、其它函数、竖直线的交点
      const impl = (ii, x, y) => { try { return fs[ii].fn(x, y); } catch (e) { return NaN; } };
      const ys = new Array(N + 1);
      for (let k = 0; k <= N; k++) ys[k] = yMin + (k / N) * (yMax - yMin);
      for (const ii of implIdx) {
        // 与 x 轴交点：F(x,0)=0
        for (let k = 0; k < N; k++) {
          const ga = impl(ii, xs[k], 0), gb = impl(ii, xs[k + 1], 0);
          if (!isFinite(ga) || !isFinite(gb) || (Math.abs(ga) < 1e-9 && Math.abs(gb) < 1e-9)) continue;
          if (ga * gb <= 0) { const r = this.bisect(x => impl(ii, x, 0), xs[k], xs[k + 1]); if (r != null && r >= xMin && r <= xMax) push({ type: 'inter', x: r, y: 0, i: ii, axis: 'x' }); }
        }
        // 与 y 轴交点：F(0,y)=0
        for (let k = 0; k < N; k++) {
          const ga = impl(ii, 0, ys[k]), gb = impl(ii, 0, ys[k + 1]);
          if (!isFinite(ga) || !isFinite(gb) || (Math.abs(ga) < 1e-9 && Math.abs(gb) < 1e-9)) continue;
          if (ga * gb <= 0) { const r = this.bisect(y => impl(ii, 0, y), ys[k], ys[k + 1]); if (r != null && r >= yMin && r <= yMax) push({ type: 'inter', x: 0, y: r, i: ii, axis: 'y' }); }
        }
        // 与其它函数 g(x) 交点：F(x, g(x))=0
        for (const fi of funcIdx) {
          for (let k = 0; k < N; k++) {
            const ga = impl(ii, xs[k], ev(fi, xs[k])), gb = impl(ii, xs[k + 1], ev(fi, xs[k + 1]));
            if (!isFinite(ga) || !isFinite(gb) || (Math.abs(ga) < 1e-9 && Math.abs(gb) < 1e-9)) continue;
            if (ga * gb <= 0) { const r = this.bisect(x => impl(ii, x, ev(fi, x)), xs[k], xs[k + 1]); if (r != null) { const yy = ev(fi, r); if (inViewY(yy)) push({ type: 'inter', x: r, y: yy, i: ii, j: fi, implFunc: true }); } }
          }
        }
        // 与竖直直线 x=c 交点：F(c, y)=0
        for (const vi of verts) {
          const c = fs[vi].xVal; if (c < xMin || c > xMax) continue;
          for (let k = 0; k < N; k++) {
            const ga = impl(ii, c, ys[k]), gb = impl(ii, c, ys[k + 1]);
            if (!isFinite(ga) || !isFinite(gb) || (Math.abs(ga) < 1e-9 && Math.abs(gb) < 1e-9)) continue;
            if (ga * gb <= 0) { const r = this.bisect(y => impl(ii, c, y), ys[k], ys[k + 1]); if (r != null && r >= yMin && r <= yMax) push({ type: 'inter', x: c, y: r, i: ii, j: vi, implVert: true }); }
          }
        }
      }
      // 去重 + 限数
      const tol = (xMax - xMin) * 1.5e-4, toly = (yMax - yMin) * 1.5e-4;
      const out = [];
      for (const p of pts) {
        if (out.some(q => Math.abs(q.x - p.x) < tol && Math.abs(q.y - p.y) < toly && q.type === p.type)) continue;
        out.push(p); if (out.length >= 50) break;
      }
      this.special = out;
    }

    colorOf(p) {
      // 隐式曲线的交点用其曲线颜色；函数交点用中性灰
      const f = this.functions[p.i];
      if (f && f.kind === 'implicit') return f.color;
      if (p.type === 'inter') return '#495057';
      return f ? f.color : '#495057';
    }

    drawSpecial(ctx) {
      for (const p of this.special) {
        const X = this.px(p.x), Y = this.py(p.y);
        if (X < -20 || X > this.width + 20 || Y < -20 || Y > this.height + 20) continue;
        ctx.save();
        ctx.setLineDash([3, 3]); ctx.lineWidth = 1.4;
        ctx.strokeStyle = this.colorOf(p);
        ctx.beginPath(); ctx.arc(X, Y, 7, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }
    }

    drawPinned(ctx) {
      for (const p of this.pinned) {
        const X = this.px(p.x), Y = this.py(p.y);
        if (!isFinite(X) || !isFinite(Y)) continue;
        ctx.save();
        ctx.fillStyle = p.color || '#1f2933';
        ctx.beginPath(); ctx.arc(X, Y, 6, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
        ctx.strokeStyle = p.color || '#1f2933'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(X, Y, 9, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
        // 钉选点的坐标常驻浮标（右上角）
        const lines = p.type
          ? [`${TYPE_LABEL[p.type] || '点'} ${p.label || ''}`, `(${this.fmt(p.x)}, ${this.fmt(p.y)})`]
          : [`${p.label || ''}`, `(${this.fmt(p.x)}, ${this.fmt(p.y)})`];
        this.drawFloatingLabel(ctx, X, Y, lines, p.color);
      }
    }

    drawHover(ctx) {
      if (!this.hover) return;
      const h = this.hover;
      if (h.cursor) {
        const X = this.px(h.cursor.x);
        ctx.save(); ctx.strokeStyle = 'rgba(33,37,41,0.22)'; ctx.setLineDash([3, 4]);
        ctx.beginPath(); ctx.moveTo(X, 0); ctx.lineTo(X, this.height); ctx.stroke();
        ctx.setLineDash([]); ctx.restore();
      }
      const hp = h.special || h.point;
      if (hp) {
        const X = this.px(hp.x), Y = this.py(hp.y);
        if (isFinite(X) && isFinite(Y) && Y > -20 && Y < this.height + 20) {
          ctx.save();
          ctx.fillStyle = hp.color || '#1f2933';
          ctx.beginPath(); ctx.arc(X, Y, 5.5, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
          ctx.restore();
        }
        // 在点的右上角浮出坐标标签
        const lines = hp.type
          ? [`${TYPE_LABEL[hp.type] || '点'} ${hp.label || ''}`, `(${this.fmt(hp.x)}, ${this.fmt(hp.y)})`]
          : [`${hp.label || ''}`, `(${this.fmt(hp.x)}, ${this.fmt(hp.y)})`];
        this.drawFloatingLabel(ctx, X, Y, lines, hp.color);
      } else if (h.cursor) {
        // 没碰到曲线时，在鼠标右上角显示坐标
        const X = this.px(h.cursor.x), Y = this.py(h.cursor.y);
        this.drawFloatingLabel(ctx, X, Y, [`(${this.fmt(h.cursor.x)}, ${this.fmt(h.cursor.y)})`], '#495057');
      }
    }

    // 在 (x,y) 像素的右上角绘制浮动坐标标签；接近边缘时自动翻转到左侧/下方
    drawFloatingLabel(ctx, x, y, lines, accent) {
      const padX = 6, padY = 4, lineH = 14;
      ctx.save();
      ctx.font = '12px ui-monospace, Menlo, Consolas, monospace';
      let w = 0;
      for (const ln of lines) w = Math.max(w, ctx.measureText(ln).width);
      const bw = w + padX * 2, h = lines.length * lineH + padY * 2;
      let bx = x + 12, by = y - h - 8;          // 默认：右上
      if (bx + bw > this.width - 2) bx = x - 12 - bw;   // 右边放不下 → 左侧
      if (bx < 2) bx = 2;
      if (by < 2) by = y + 12;                  // 上边放不下 → 下方
      if (by + h > this.height - 2) by = this.height - 2 - h;
      // 背景
      ctx.fillStyle = 'rgba(255,255,255,0.96)';
      ctx.strokeStyle = accent || '#868e96'; ctx.lineWidth = 1;
      this.roundRect(ctx, bx, by, bw, h, 5); ctx.fill(); ctx.stroke();
      // 文本
      ctx.fillStyle = '#1f2933'; ctx.textBaseline = 'top'; ctx.textAlign = 'left';
      for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i], bx + padX, by + padY + i * lineH);
      ctx.restore();
    }
    roundRect(ctx, x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }

    /* ---- 鼠标位置 → 最近的曲线点 / 特殊点 ---- */
    updateHoverFromPx(px, py) {
      const cx = this.mx(px), cy = this.my(py);
      const h = { cursor: { x: cx, y: cy }, point: null, special: null };
      let bestSp = null, bestSpD = 14;
      for (const p of this.special) {
        const X = this.px(p.x), Y = this.py(p.y);
        const d = Math.hypot(X - px, Y - py);
        if (d < bestSpD) { bestSpD = d; bestSp = p; }
      }
      if (bestSp) h.special = { x: bestSp.x, y: bestSp.y, type: bestSp.type, color: this.colorOf(bestSp), label: this.specialLabel(bestSp) };

      let bestPt = null, bestPtD = 13;
      for (const f of this.functions) {
        if (!f.visible) continue;
        if (f.kind === 'vertical') {
          if (f.xVal == null || !isFinite(f.xVal)) continue;
          const d = Math.abs(this.px(f.xVal) - px);
          if (d < bestPtD) { bestPtD = d; bestPt = { x: f.xVal, y: cy, color: f.color, label: f.label }; }
        } else if (f.kind === 'implicit') {
          continue; // 隐式曲线不参与“最近点”悬停
        } else if (f.fn) {
          let y; try { y = f.fn(cx); } catch (e) { y = NaN; }
          if (!isFinite(y)) continue;
          const d = Math.abs(this.py(y) - py);
          if (d < bestPtD) { bestPtD = d; bestPt = { x: cx, y, color: f.color, label: f.label }; }
        }
      }
      h.point = bestPt;
      this.hover = h;
      if (this.onHover) this.onHover(h);
      this.draw();
    }

    specialLabel(p) {
      const f = this.functions[p.i];
      // 隐式曲线与坐标轴交点
      if (p.type === 'inter' && p.axis === 'x') return (f ? f.label : '?') + '∩x轴';
      if (p.type === 'inter' && p.axis === 'y') return (f ? f.label : '?') + '∩y轴';
      if (p.type === 'inter' && p.j != null) {
        const g = this.functions[p.j];
        const la = f ? f.label : '?';
        const lb = g ? (g.kind === 'vertical' ? 'x=' + this.fmt(g.xVal) : g.label) : '?';
        return la + '∩' + lb;
      }
      return f ? f.label : '?';
    }

    /* ---- 点击钉选 ---- */
    handleClick(px, py) {
      // 0) 若点中已钉选的点 → 直接取消该钉选（点击即切换）
      const tolPinPx = 12;
      for (let i = this.pinned.length - 1; i >= 0; i--) {
        const q = this.pinned[i];
        const d = Math.hypot(this.px(q.x) - px, this.py(q.y) - py);
        if (d < tolPinPx) { this.removePin(i); return; }
      }
      // 1) 否则：找最近的特殊点钉选
      let bestSp = null, bestSpD = 14;
      for (const p of this.special) {
        const X = this.px(p.x), Y = this.py(p.y);
        const d = Math.hypot(X - px, Y - py);
        if (d < bestSpD) { bestSpD = d; bestSp = p; }
      }
      if (bestSp) { this.togglePin({ x: bestSp.x, y: bestSp.y, type: bestSp.type, color: this.colorOf(bestSp), label: this.specialLabel(bestSp) }); return; }
      // 2) 否则：找最近的曲线/竖直直线点钉选
      let bestPt = null, bestPtD = 13;
      const cx = this.mx(px), cy = this.my(py);
      for (const f of this.functions) {
        if (!f.visible) continue;
        if (f.kind === 'vertical') { const d = Math.abs(this.px(f.xVal) - px); if (d < bestPtD) { bestPtD = d; bestPt = { x: f.xVal, y: cy, color: f.color, label: f.label }; } }
        else if (f.kind === 'implicit') { continue; }
        else if (f.fn) { let y; try { y = f.fn(cx); } catch (e) { y = NaN; } if (!isFinite(y)) continue; const d = Math.abs(this.py(y) - py); if (d < bestPtD) { bestPtD = d; bestPt = { x: cx, y, color: f.color, label: f.label }; } }
      }
      if (bestPt) this.togglePin({ x: bestPt.x, y: bestPt.y, type: 'point', color: bestPt.color, label: bestPt.label });
    }

    togglePin(p) {
      const tol = (this.xMax - this.xMin) * 2e-4, toly = (this.yMax - this.yMin) * 2e-4;
      const idx = this.pinned.findIndex(q => Math.abs(q.x - p.x) < tol && Math.abs(q.y - p.y) < toly);
      if (idx >= 0) { this.pinned.splice(idx, 1); this.onPinsChange(); this.draw(); return; }
      if (this.pinned.length >= 12) this.pinned.shift();
      this.pinned.push(p);
      this.onPinsChange();
      this.draw();
    }
    removePin(i) { this.pinned.splice(i, 1); this.onPinsChange(); this.draw(); }

    /* ---- 交互 ---- */
    _bindEvents() {
      const cv = this.canvas;
      let dragging = false, lastX = 0, lastY = 0, moved = false, downX = 0, downY = 0;
      cv.addEventListener('mousedown', (e) => {
        dragging = true; moved = false;
        lastX = downX = e.offsetX; lastY = downY = e.offsetY;
        cv.style.cursor = 'grabbing';
      });
      window.addEventListener('mouseup', () => {
        if (dragging && !moved) this.handleClick(downX, downY);
        dragging = false; cv.style.cursor = 'grab';
      });
      cv.addEventListener('mousemove', (e) => {
        if (dragging) {
          const dx = e.offsetX - lastX, dy = e.offsetY - lastY;
          lastX = e.offsetX; lastY = e.offsetY;
          if (Math.abs(e.offsetX - downX) + Math.abs(e.offsetY - downY) > 4) moved = true;
          this.panByPx(dx, dy);
          this.updateHoverFromPx(e.offsetX, e.offsetY);
        } else {
          this.updateHoverFromPx(e.offsetX, e.offsetY);
        }
      });
      cv.addEventListener('mouseleave', () => { this.hover = null; if (this.onHover) this.onHover(null); this.draw(); });
      cv.addEventListener('wheel', (e) => {
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
        this.zoom(factor, e.offsetX, e.offsetY);
        this.updateHoverFromPx(e.offsetX, e.offsetY);
      }, { passive: false });

      let touchDist = 0, lastTouch = null, touchMoved = false;
      const rect = () => cv.getBoundingClientRect();
      cv.addEventListener('touchstart', (e) => {
        touchMoved = false;
        if (e.touches.length === 1) { dragging = true; const r = rect(); lastX = downX = e.touches[0].clientX - r.left; lastY = downY = e.touches[0].clientY - r.top; }
        else if (e.touches.length === 2) { dragging = false; touchDist = dist(e.touches[0], e.touches[1]); }
      }, { passive: true });
      cv.addEventListener('touchmove', (e) => {
        if (e.touches.length === 1 && dragging) {
          const t = e.touches[0]; const r = rect();
          const ox = t.clientX - r.left, oy = t.clientY - r.top;
          const dx = ox - lastX, dy = oy - lastY; lastX = ox; lastY = oy;
          if (Math.abs(ox - downX) + Math.abs(oy - downY) > 4) touchMoved = true;
          this.panByPx(dx, dy); this.updateHoverFromPx(ox, oy);
        } else if (e.touches.length === 2) {
          const nd = dist(e.touches[0], e.touches[1]); const r = rect(); const nc = mid(e.touches[0], e.touches[1]);
          if (touchDist) this.zoom(nd / touchDist, nc.x - r.left, nc.y - r.top);
          touchDist = nd;
        }
        e.preventDefault();
      }, { passive: false });
      cv.addEventListener('touchend', () => {
        if (dragging && !touchMoved) this.handleClick(downX, downY);
        dragging = false;
      }, { passive: true });
      function dist(a, b) { return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY); }
      function mid(a, b) { return { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 }; }
    }
  }

  /* ===================== UI ===================== */
  const els = {
    list: document.getElementById('fn-list'),
    addBtn: document.getElementById('add-fn'),
    canvas: document.getElementById('plot'),
    resetBtn: document.getElementById('reset-view'),
    zoomIn: document.getElementById('zoom-in'),
    zoomOut: document.getElementById('zoom-out'),
    readout: document.getElementById('readout'),
    hoverbox: document.getElementById('hoverbox'),
    examples: document.getElementById('examples'),
    exportBtn: document.getElementById('export-set'),
    importBtn: document.getElementById('import-set'),
    importFile: document.getElementById('import-file'),
  };

  const plotter = new Plotter(els.canvas);
  let rowSeq = 0;
  const rows = new Map();

  plotter.onHover = (h) => { updateReadout(h); updateHoverBox(h); };
  plotter.onPinsChange = () => updateHoverBox(plotter.hover);

  /* ===================== 数学输入（contenteditable：^ → 上标指数，→ 恢复，pi → π） ===================== */
  const SUP_CLASS = 'math-exp';
  // DOM → 原始表达式（sup 元素还原为 ^...；剥离零宽占位符）
  function serializeMath(node) {
    let s = '';
    node.childNodes.forEach(ch => {
      if (ch.nodeType === 3) s += ch.data.replace(/\u200b/g, '');
      else if (ch.nodeName === 'SUP' || (ch.classList && ch.classList.contains(SUP_CLASS))) s += '^' + serializeMath(ch);
      else s += serializeMath(ch);
    });
    return s;
  }
  function matchParen(raw, start) { let d = 0, j = start; for (; j < raw.length; j++) { if (raw[j] === '(') d++; else if (raw[j] === ')') { d--; if (d === 0) { j++; break; } } } return j; }
  // 上标指数的范围。eqMode（表达式含 =，即方程/隐式）时用标准法则：
  //   指数到一个“项”为止（遇 + - * / 空白 = 或未配对 ) 即止），故 x^2+y^2 = x²+y²（圆锥曲线）。
  // 否则（函数 y=f(x)）用“贪婪”法则：只有 → 退出标记 / 末尾 / 未配对 ) 才结束，
  //   故 2^2x+1（不按 →）= 2^(2x+1)。
  const EXIT_MARK = '\uE000';
  function exponentEnd(raw, start, eqMode) {
    let j = start, depth = 0;
    while (j < raw.length) {
      const c = raw[j];
      if (c === EXIT_MARK) break;
      if (c === '=') break;                                  // 方程的 = 不属于指数
      if (c === '(') depth++;
      else if (c === ')') { if (depth === 0) break; depth--; }
      else if (depth === 0 && eqMode && (c === '+' || c === '-' || c === '*' || c === '/' || c === ' ')) break;
      j++;
    }
    return j;
  }
  // 把“显示原文”转成“可解析原文”：每个 ^ 的指数用括号包起来，并剥离退出标记
  function toCompileRaw(raw) {
    const eqMode = raw.indexOf('=') >= 0;
    let out = '', i = 0;
    while (i < raw.length) {
      const c = raw[i];
      if (c === EXIT_MARK) { i++; continue; }
      if (c === '^') {
        const end = exponentEnd(raw, i + 1, eqMode);
        let inner = '';
        for (let k = i + 1; k < end; k++) if (raw[k] !== EXIT_MARK) inner += raw[k];
        out += '^(' + inner + ')';
        i = end;
      } else { out += c; i++; }
    }
    return out;
  }
  // 原始表达式 → DOM（含上标 sup）。空的 ^（如末尾待输）保留为字面字符，便于光标正常编辑
  function buildMathDom(raw, eqMode) {
    if (eqMode === undefined) eqMode = raw.indexOf('=') >= 0;
    const frag = document.createDocumentFragment();
    let i = 0;
    while (i < raw.length) {
      if (raw[i] === '^') {
        const end = exponentEnd(raw, i + 1, eqMode);
        if (end <= i + 1) {
          frag.appendChild(document.createTextNode('^'));
          i = i + 1;
        } else {
          const sup = document.createElement('SUP'); sup.className = SUP_CLASS;
          sup.appendChild(buildMathDom(raw.slice(i + 1, end), eqMode));
          frag.appendChild(sup);
          i = end;
        }
      } else {
        let j = i; while (j < raw.length && raw[j] !== '^') j++;
        frag.appendChild(document.createTextNode(raw.slice(i, j)));
        i = j;
      }
    }
    return frag;
  }
  function renderMathValue(el, raw) { el.innerHTML = ''; el.appendChild(buildMathDom(raw)); }
  function placeCaretAtEnd(el) {
    const sel = getSelection(); sel.removeAllRanges();
    const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); sel.addRange(r);
  }
  // 取光标在原始表达式中的字符索引（用 Range 克隆 + 序列化）
  function getCaretRawIndex(el) {
    const sel = getSelection(); if (!sel.rangeCount) return 0;
    const r = sel.getRangeAt(0).cloneRange();
    try { r.setStart(el, 0); } catch (e) { return 0; }
    return serializeMath(r.cloneContents()).length;
  }
  // 按原始表达式字符索引恢复光标（上标 ^ 计 1 字符，其内容紧随其后）
  function setCaretRawIndex(el, idx) {
    const sel = getSelection(); sel.removeAllRanges();
    const range = document.createRange(); let placed = false;
    function walk(node, acc) {
      if (node.nodeType === 3) {
        const len = node.data.length;
        if (!placed && idx <= acc + len) { range.setStart(node, Math.max(0, idx - acc)); range.collapse(true); placed = true; }
        return acc + len;
      }
      let a = acc;
      const isSup = node.nodeName === 'SUP' || (node.classList && node.classList.contains(SUP_CLASS));
      if (isSup) {
        if (!placed && idx <= a) { range.setStartBefore(node); range.collapse(true); placed = true; }
        a += 1; // '^'
      }
      for (const ch of node.childNodes) { a = walk(ch, a); if (placed) return a; }
      if (isSup && !placed && idx <= a) {
        // 光标在 ^ 之后的内容末尾（空上标 → 放到上标后基线，避免进入空元素）
        if (node.childNodes.length) range.setStartAfter(node.lastChild); else range.setStartAfter(node);
        range.collapse(true); placed = true;
      }
      return a;
    }
    walk(el, 0);
    if (!placed) { range.selectNodeContents(el); range.collapse(false); }
    sel.addRange(range);
  }
  // 重新渲染（保留光标）：序列化 → 重建上标 → 恢复光标
  function rerenderKeepCaret(el) {
    const idx = getCaretRawIndex(el);
    const raw = serializeMath(el);
    renderMathValue(el, raw);
    setCaretRawIndex(el, idx);
  }
  // 光标是否位于某个上标 <sup> 之内
  // 返回光标所在的最近 sup 元素（没有则 null）
  function caretInSup(el) {
    const sel = getSelection(); if (!sel.rangeCount) return null;
    let node = sel.getRangeAt(0).startContainer;
    while (node && node !== el) {
      if (node.classList && node.classList.contains(SUP_CLASS)) return node;
      node = node.parentNode;
    }
    return null;
  }
  // 光标是否位于某上标内容的“末尾”（其后在该上标内没有字符）
  //   只有此时按 → 才插入退出标记回到基线；否则 → 仅原生前移光标
  function caretAtEndOfSup(el) {
    const sup = caretInSup(el);
    if (!sup) return false;
    const sel = getSelection(); if (!sel.rangeCount) return false;
    const range = sel.getRangeAt(0); if (!range.collapsed) return false;
    const r = range.cloneRange();
    try { r.setEndAfter(sup); } catch (e) { return false; }
    return r.toString().replace(/[\uE000\u200b]/g, '') === '';
  }
  // 若光标前刚出现 "pi" → 替换为 "π"
  function maybeReplacePi() {
    const sel = getSelection(); if (!sel.rangeCount) return;
    const range = sel.getRangeAt(0); if (!range.collapsed) return;
    const node = range.startContainer; const off = range.startOffset;
    if (node.nodeType !== 3) return;
    const data = node.data;
    if (off >= 2 && data.slice(off - 2, off) === 'pi') {
      const r = document.createRange(); r.setStart(node, off - 2); r.setEnd(node, off);
      r.deleteContents();
      const t = document.createTextNode('π');
      r.insertNode(t);
      const nr = document.createRange(); nr.setStartAfter(t); nr.collapse(true);
      sel.removeAllRanges(); sel.addRange(nr);
    }
  }

  function makeRow(expr, color, visible = true) {
    const id = ++rowSeq;
    const li = document.createElement('div');
    li.className = 'fn-row';
    li.innerHTML = `
      <span class="swatch" style="background:${color}"></span>
      <button class="vis" title="显示/隐藏">●</button>
      <div class="fn-input" contenteditable="true" spellcheck="false" data-ph="如 sin(x)、ln2x、x=2"></div>
      <button class="diff" title="求导 d/dx">d/dx</button>
      <button class="del" title="删除">✕</button>
      <div class="corr"></div>
      <div class="err"></div>
      <div class="params"></div>
    `;
    els.list.appendChild(li);
    const input = li.querySelector('.fn-input');
    const errEl = li.querySelector('.err');
    const corrEl = li.querySelector('.corr');
    const paramEl = li.querySelector('.params');
    const visBtn = li.querySelector('.vis');
    const delBtn = li.querySelector('.del');
    const diffBtn = li.querySelector('.diff');
    const rec = { element: li, input, errEl, corrEl, paramEl, color, visible, fn: null, rawFn: null, kind: 'function', xVal: null,
      params: null, pvals: {}, pranges: {}, dynX: false };
    rows.set(id, rec);
    renderMathValue(input, expr);

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); return; }
      // 在上标指数内按 → ：仅当光标在指数内容末尾（其后无字符）时才插入退出标记回到基线；
      // 否则 → 原生前移光标（在指数中间不拆分）
      if (e.key === 'ArrowRight' && caretAtEndOfSup(input)) {
        e.preventDefault();
        const sel = getSelection();
        if (sel.rangeCount) {
          const r = sel.getRangeAt(0); r.deleteContents();
          const mark = document.createTextNode(EXIT_MARK);
          r.insertNode(mark);
          // 光标置于标记之后（重新渲染后即位于基线）
          const nr = document.createRange(); nr.setStartAfter(mark); nr.collapse(true);
          sel.removeAllRanges(); sel.addRange(nr);
        }
        rerenderKeepCaret(input);
        compile(id);
      }
    });
    input.addEventListener('input', () => {
      maybeReplacePi();
      rerenderKeepCaret(input);
      compile(id);
    });
    input.addEventListener('paste', (e) => {
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData('text');
      document.execCommand('insertText', false, text);
    });
    visBtn.addEventListener('click', () => { rec.visible = !rec.visible; visBtn.classList.toggle('off', !rec.visible); syncFunctions(); });
    delBtn.addEventListener('click', () => { if (rows.size === 1) { renderMathValue(input, ''); compile(id); return; } rows.delete(id); li.remove(); syncFunctions(); });
    // 求导：把当前表达式包成 (...)' 作为【新函数行】，不修改原函数
    diffBtn.addEventListener('click', () => {
      const raw = serializeMath(input).trim();
      if (!raw) return;
      // 竖直线 x=c（含动态 x=a）没有可导的 y=f(x)，忽略
      if (rec.kind === 'vertical') return;
      let wrapped;
      const eqAt = raw.indexOf('=');
      if (eqAt >= 0) {
        // 方程：只对右侧求导并保留左侧。y=x → y=(x)'；x^2+y^2=1 → x^2+y^2=(1)'
        const lhs = raw.slice(0, eqAt).trim();
        const rhs = raw.slice(eqAt + 1).trim();
        if (!lhs || !rhs) return;
        wrapped = lhs + '=(' + rhs + ")'";
      } else {
        // 普通函数/隐式表达式：(…)'
        wrapped = '(' + raw + ")'";
      }
      const color = PALETTE[rows.size % PALETTE.length];
      makeRow(wrapped, color);
      // 滚动到新行
      const last = els.list.lastElementChild;
      if (last) last.scrollIntoView({ block: 'nearest' });
    });
    compile(id);
    return id;
  }

  function compile(id) {
    const rec = rows.get(id);
    const text = toCompileRaw(serializeMath(rec.input)).trim();
    rec.errEl.textContent = ''; rec.corrEl.innerHTML = '';
    if (!text) { rec.fn = null; rec.rawFn = null; rec.kind = 'function'; rec.xVal = null; rec.params = null; rec.dynX = false; updateParamPanel(rec); syncFunctions(); return; }
    const r = Expr.analyze(text);
    if (!r.ok) { rec.fn = null; rec.rawFn = null; rec.kind = 'function'; rec.xVal = null; rec.params = null; rec.dynX = false; rec.errEl.textContent = '⚠ ' + r.error; updateParamPanel(rec); }
    else {
      rec.rawFn = r.fn || null; rec.kind = r.kind;
      if (r.kind === 'vertical') {
        rec.dynX = !!r.dynX;
        rec.xVal = r.dynX ? null : (r.xVal != null ? r.xVal : null);
      } else { rec.dynX = false; rec.xVal = null; }
      // 同步参数列表：保留仍在使用的旧值/旧范围，新参数给默认值
      syncParamState(rec, r.params || []);
      bindParams(rec);
      updateParamPanel(rec);
    }
    syncFunctions();
  }

  /* ---------- 参数滑块 ---------- */
  function syncParamState(rec, names) {
    const hasParams = names && names.length > 0;
    const oldVals = rec.pvals || {};
    const oldRanges = rec.pranges || {};
    rec.pvals = {}; rec.pranges = {};
    if (!hasParams) { rec.params = null; return; }
    rec.params = names.slice();
    names.forEach(n => {
      const ov = oldVals[n];
      rec.pvals[n] = (typeof ov === 'number' && isFinite(ov)) ? ov : 1;
      const or_ = oldRanges[n];
      rec.pranges[n] = (or_ && isFinite(or_.min) && isFinite(or_.max)) ? or_ : { min: -10, max: 10 };
    });
  }
  // 把参数闭包与当前值绑定：绘图时求值前把该行的参数注入全局槽
  function bindParams(rec) {
    if (!rec.rawFn) { rec.fn = null; return; }
    if (!rec.params) { rec.fn = rec.rawFn; return; }
    const vals = rec.pvals;
    const g = rec.rawFn;
    if (rec.kind === 'implicit') {
      rec.fn = (x, y) => { Expr.setParams(vals); return g(x, y); };
    } else {
      rec.fn = (x) => { Expr.setParams(vals); return g(x); };
    }
  }
  // 拖动滑块时的轻量节流重绘
  let _livePending = false;
  function liveDraw() {
    if (_livePending) return;
    _livePending = true;
    requestAnimationFrame(() => { _livePending = false; syncFunctions(); });
  }
  function fmtP(v) {
    if (!isFinite(v)) return '';
    return (Math.round(v * 1000) / 1000).toString();
  }
  // 渲染该行下方的参数滑块区（含取值范围控制）
  function updateParamPanel(rec) {
    const box = rec.paramEl;
    if (!box) return;
    if (!rec.params || !rec.params.length) { box.classList.remove('on'); box.innerHTML = ''; return; }
    box.classList.add('on');
    box.innerHTML = rec.params.map(n => `
      <div class="param-item" data-p="${escapeHtml(n)}">
        <div class="p-line">
          <b class="p-name">${escapeHtml(n)}</b>
          <input class="p-slider" type="range" min="${rec.pranges[n].min}" max="${rec.pranges[n].max}" step="0.001" value="${rec.pvals[n]}">
          <input class="p-val" type="number" step="any" value="${fmtP(rec.pvals[n])}">
        </div>
        <div class="p-range">
          <span>范围</span>
          <label>min <input class="p-min" type="number" step="any" value="${fmtP(rec.pranges[n].min)}"></label>
          <span>–</span>
          <label>max <input class="p-max" type="number" step="any" value="${fmtP(rec.pranges[n].max)}"></label>
        </div>
      </div>
    `).join('');
    box.querySelectorAll('.param-item').forEach(item => {
      const p = item.getAttribute('data-p');
      const slider = item.querySelector('.p-slider');
      const valIn = item.querySelector('.p-val');
      const minIn = item.querySelector('.p-min');
      const maxIn = item.querySelector('.p-max');
      const applyVal = (v) => {
        if (!isFinite(v)) return;
        rec.pvals[p] = v;
        slider.value = v; valIn.value = fmtP(v);
        liveDraw();
      };
      slider.addEventListener('input', () => applyVal(parseFloat(slider.value)));
      valIn.addEventListener('input', () => applyVal(parseFloat(valIn.value)));
      minIn.addEventListener('change', () => {
        const mn = parseFloat(minIn.value), mx = parseFloat(maxIn.value);
        if (!isFinite(mn)) { minIn.value = fmtP(rec.pranges[p].min); return; }
        rec.pranges[p].min = Math.min(mn, isFinite(mx) ? mx : rec.pranges[p].max);
        minIn.value = fmtP(rec.pranges[p].min);
        slider.min = rec.pranges[p].min;
        if (rec.pvals[p] < rec.pranges[p].min) applyVal(rec.pranges[p].min);
      });
      maxIn.addEventListener('change', () => {
        const mx = parseFloat(maxIn.value), mn = parseFloat(minIn.value);
        if (!isFinite(mx)) { maxIn.value = fmtP(rec.pranges[p].max); return; }
        rec.pranges[p].max = Math.max(mx, isFinite(mn) ? mn : rec.pranges[p].min);
        maxIn.value = fmtP(rec.pranges[p].max);
        slider.max = rec.pranges[p].max;
        if (rec.pvals[p] > rec.pranges[p].max) applyVal(rec.pranges[p].max);
      });
    });
  }

  function syncFunctions() {
    const fs = [];
    let fi = 0;
    for (const rec of rows.values()) {
      const entry = { color: rec.color, visible: rec.visible, kind: rec.kind };
      if (rec.kind === 'vertical') {
        if (rec.dynX && rec.fn) { try { rec.xVal = rec.fn(0); } catch (e) { rec.xVal = NaN; } } // 含参数的竖直线：按当前滑块值实时计算
        entry.xVal = rec.xVal; entry.label = 'x=' + plotter.fmt(rec.xVal);
      }
      else if (rec.kind === 'implicit') { entry.fn = rec.fn; entry.label = '隐式'; }
      else { entry.fn = rec.fn; entry.label = 'f' + sub(fi + 1); fi++; }
      fs.push(entry);
    }
    plotter._specialSig = null;
    plotter.functions = fs;
    plotter.draw();
    updateHoverBox(plotter.hover);
  }

  function updateReadout(h) {
    if (!h || !h.cursor) { els.readout.style.opacity = '0'; return; }
    const c = h.cursor;
    let html = `<span class="ro-coord">x = ${plotter.fmt(c.x)}</span><span class="ro-coord">y = ${plotter.fmt(c.y)}</span>`;
    let vi = 0;
    for (const rec of rows.values()) {
      if (!rec.visible) continue;
      if (rec.kind === 'vertical') {
        html += `<span class="ro-fn"><i style="background:${rec.color}"></i>x=${plotter.fmt(rec.xVal)}</span>`;
      } else if (rec.kind === 'implicit') {
        html += `<span class="ro-fn"><i style="background:${rec.color}"></i>隐式</span>`;
      } else if (rec.fn) {
        let y; try { y = rec.fn(c.x); } catch (e) { y = NaN; }
        const ys = isFinite(y) ? plotter.fmt(y) : '—';
        html += `<span class="ro-fn"><i style="background:${rec.color}"></i>f<sub>${vi + 1}</sub>(x) = ${ys}</span>`;
        vi++;
      }
    }
    els.readout.innerHTML = html;
    els.readout.style.opacity = '1';
  }

  function updateHoverBox(h) {
    const box = els.hoverbox;
    let top = '';
    if (h && h.special) {
      top = `<div class="hb-top"><span class="hb-tag ${h.special.type}">${TYPE_LABEL[h.special.type] || ''}</span>` +
        `<span class="hb-lbl">${escapeHtml(h.special.label || '')}</span>` +
        `<b>(${plotter.fmt(h.special.x)}, ${plotter.fmt(h.special.y)})</b></div>`;
    } else if (h && h.point) {
      top = `<div class="hb-top"><span class="hb-tag point">点</span>` +
        `<span class="hb-lbl">${escapeHtml(h.point.label || '')}</span>` +
        `<b>(${plotter.fmt(h.point.x)}, ${plotter.fmt(h.point.y)})</b></div>`;
    } else if (h && h.cursor) {
      top = `<div class="hb-top"><b>(${plotter.fmt(h.cursor.x)}, ${plotter.fmt(h.cursor.y)})</b></div>`;
    }
    const pins = plotter.pinned.map((p, i) =>
      `<div class="hb-pin"><span class="hb-tag ${p.type}">${TYPE_LABEL[p.type] || ''}</span>` +
      `<span class="hb-lbl">${escapeHtml(p.label || '')}</span>` +
      `<b>(${plotter.fmt(p.x)}, ${plotter.fmt(p.y)})</b>` +
      `<button class="hb-x" data-i="${i}" title="移除">✕</button></div>`
    ).join('');
    const pinsHtml = pins ? `<div class="hb-pins"><div class="hb-pins-h">钉选点</div>${pins}</div>` : '';
    if (!top && !pins) { box.style.display = 'none'; box.innerHTML = ''; return; }
    box.innerHTML = top + pinsHtml;
    box.style.display = 'block';
  }

  els.hoverbox.addEventListener('click', (e) => {
    const x = e.target.closest('.hb-x'); if (!x) return;
    e.stopPropagation();
    plotter.removePin(+x.getAttribute('data-i'));
  });

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]);
  }

  /* ---- 事件 ---- */
  els.addBtn.addEventListener('click', () => { const color = PALETTE[rows.size % PALETTE.length]; makeRow('', color); });
  els.resetBtn.addEventListener('click', () => plotter.reset());
  els.zoomIn.addEventListener('click', () => plotter.zoom(1.4));
  els.zoomOut.addEventListener('click', () => plotter.zoom(1 / 1.4));

  /* ---- 导出 / 导入函数集 ---- */
  // 导出：当前所有函数（表达式、颜色、可见性）+ 钉选点 + 视图范围 → JSON 文件下载
  els.exportBtn.addEventListener('click', () => {
    const data = {
      app: 'function-plotter',
      version: 1,
      view: { xMin: plotter.xMin, xMax: plotter.xMax, yMin: plotter.yMin, yMax: plotter.yMax },
      functions: [...rows.values()].map(r => ({
        expr: serializeMath(r.input),
        color: r.color,
        visible: r.visible,
        params: r.params ? r.params.map(n => ({ name: n, value: r.pvals[n], min: r.pranges[n].min, max: r.pranges[n].max })) : null,
      })),
      pins: plotter.pinned.map(p => ({ x: p.x, y: p.y, type: p.type, color: p.color, label: p.label })),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'functions.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  // 导入：读取 JSON，清空当前行，重建函数行 + 钉选点 + 视图
  els.importBtn.addEventListener('click', () => els.importFile.click());
  els.importFile.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        if (!data || !Array.isArray(data.functions)) throw new Error('JSON 中缺少 functions 数组');
        // 清空当前所有行
        for (const rec of rows.values()) rec.element.remove();
        rows.clear(); rowSeq = 0;
        // 重建函数行
        (data.functions.length ? data.functions : [{ expr: '', color: PALETTE[0], visible: true }]).forEach(f => {
          const id = makeRow(f.expr || '', f.color || PALETTE[rows.size % PALETTE.length], f.visible !== false);
          const rec = rows.get(id);
          // 恢复参数值与范围（若有）
          if (rec.params && f.params) {
            for (const pp of f.params) {
              if (rec.pvals.hasOwnProperty(pp.name)) {
                if (typeof pp.value === 'number') rec.pvals[pp.name] = pp.value;
                if (isFinite(pp.min) && isFinite(pp.max)) rec.pranges[pp.name] = { min: pp.min, max: pp.max };
              }
            }
            bindParams(rec); updateParamPanel(rec);
          }
        });
        syncFunctions();
        // 恢复钉选点
        if (Array.isArray(data.pins)) {
          plotter.pinned = data.pins
            .filter(p => p && isFinite(p.x) && isFinite(p.y))
            .slice(0, 12)
            .map(p => ({ x: +p.x, y: +p.y, type: p.type || 'point', color: p.color || '#1f2933', label: p.label || '' }));
          plotter.onPinsChange && plotter.onPinsChange();
        }
        // 恢复视图范围
        if (data.view && isFinite(data.view.xMin) && isFinite(data.view.xMax)) {
          plotter.setView(data.view.xMin, data.view.xMax, data.view.yMin, data.view.yMax);
        } else {
          plotter.draw();
        }
      } catch (err) {
        alert('导入失败：' + (err.message || err));
      }
      els.importFile.value = ''; // 允许再次选择同一文件
    };
    reader.readAsText(file);
  });

  /* ---- 初始化 ---- */

  window.addEventListener('resize', () => plotter.resize());
  window.addEventListener('keydown', (e) => {
    const ae = document.activeElement;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
    switch (e.key) {
      case 'ArrowLeft': plotter.panByPx(40, 0); break;
      case 'ArrowRight': plotter.panByPx(-40, 0); break;
      case 'ArrowUp': plotter.panByPx(0, 40); break;
      case 'ArrowDown': plotter.panByPx(0, -40); break;
      case '+': case '=': plotter.zoom(1.2); break;
      case '-': plotter.zoom(1 / 1.2); break;
      case '0': plotter.reset(); break;
    }
  });

  window.__plotter = plotter;
  window.__rows = rows; // 调试用：行记录（含参数值）
  window.__serializeMath = serializeMath; // 调试用：DOM→原始表达式
})();
