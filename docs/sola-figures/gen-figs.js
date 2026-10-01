// Diagrams for the write-up of test_programs/sola.fxc: the delay line and
// the tap, one grain, the one-lag-per-tick search, and why the lag matters.
// The numbers come from the same constants as test_programs/gen-sola.js.
//
//   node docs/sola-figures/gen-figs.js     writes fig*.svg beside this file
//   docs/sola-figures/render.sh            rasterises them to 2x PNG (macOS, Chrome)
const fs = require('fs');
const path = require('path');

const N = 436, F = 1460, E = 1024, H = 404, R = 200, C = 256, RING = 2048;
const CB = 33, PBASE = 1258, W4 = 400;

const col = {
  line: '#d9dde3', edge: '#6b7280', text: '#1f2937', dim: '#6b7280',
  exc: '#eef2f7', a: '#2563eb', b: '#ea580c', near: '#16a34a', far: '#7c3aed',
  search: '#fde68a', fade: '#fed7aa', grid: '#e5e7eb',
};
const font = `font-family="Helvetica, Arial, sans-serif"`;
const txt = (x, y, s, o = {}) =>
  `<text x="${x}" y="${y}" ${font} font-size="${o.size || 15}" fill="${o.fill || col.text}" text-anchor="${o.anchor || 'start'}" ${o.weight ? `font-weight="${o.weight}"` : ''} ${o.style ? `font-style="${o.style}"` : ''}>${s}</text>`;
const line = (x1, y1, x2, y2, c, w = 1.5, extra = '') => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${c}" stroke-width="${w}" ${extra}/>`;
const rect = (x, y, w, h, fill, extra = '') => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" ${extra}/>`;
const arrow = (x1, y1, x2, y2, c, w = 2) => {
  const a = Math.atan2(y2 - y1, x2 - x1), s = 9;
  const p1 = `${x2 - s * Math.cos(a - 0.45)},${y2 - s * Math.sin(a - 0.45)}`;
  const p2 = `${x2 - s * Math.cos(a + 0.45)},${y2 - s * Math.sin(a + 0.45)}`;
  return line(x1, y1, x2, y2, c, w) + `<polygon points="${x2},${y2} ${p1} ${p2}" fill="${c}"/>`;
};
const svg = (w, h, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">\n<rect width="${w}" height="${h}" fill="#ffffff"/>\n${body}\n</svg>\n`;

// ---------------------------------------------------------------- fig 1: the delay line and the tap
{
  const W = 1200, Hh = 420, x0 = 80, x1 = 1120, y = 150, bh = 36;
  const X = d => x0 + (x1 - x0) * d / RING;
  let s = '';
  s += txt(x0, 40, 'The delay line and the tap', { size: 22, weight: 'bold' });
  s += txt(x0, 66, 'Delay 0 is where this tick’s input is written. Every tick, everything in the line is one sample older, so its contents drift to the right.', { fill: col.dim });
  // bar
  s += rect(x0, y, x1 - x0, bh, col.line);
  s += rect(X(N), y, X(F) - X(N), bh, col.exc, `stroke="${col.edge}" stroke-width="1.5"`);
  // ticks
  for (const [d, l] of [[0, '0'], [N, '436'], [F, '1460'], [RING, '2048']]) {
    s += line(X(d), y + bh, X(d), y + bh + 8, col.edge);
    s += txt(X(d), y + bh + 26, l, { anchor: 'middle', fill: col.dim, size: 14 });
  }
  s += txt(X(0) + 4, y - 12, 'input written here', { fill: col.dim, size: 14 });
  s += txt(X(N), y - 12, 'near edge', { anchor: 'middle', fill: col.text, size: 14, weight: 'bold' });
  s += txt(X(F), y - 12, 'far edge', { anchor: 'middle', fill: col.text, size: 14, weight: 'bold' });
  s += txt((X(N) + X(F)) / 2, y + bh / 2 + 5, 'the tap’s 1024-sample excursion', { anchor: 'middle', fill: col.text, size: 14 });
  s += txt(X(1600) + 20, y + bh + 50, 'delay, samples →', { fill: col.dim, size: 14 });
  // drift arrow
  s += arrow(X(60), y + bh / 2, X(400), y + bh / 2, col.dim, 1.5);
  s += txt(X(60), y + bh / 2 + 5, '', {});
  s += txt(X(230), y + bh / 2 - 8, 'contents drift, 1 sample / tick', { anchor: 'middle', fill: col.dim, size: 12 });
  // tap
  const tx = X(N + E / 2);
  s += arrow(tx, y + bh + 95, tx, y + bh + 4, col.a, 3);
  s += txt(tx, y + bh + 115, 'tap, starts at 948', { anchor: 'middle', fill: col.a, size: 14, weight: 'bold' });
  // direction notes
  const ny = 320;
  s += arrow(tx + 16, ny, X(F) - 6, ny, col.a, 2.5);
  s += txt(X(F) + 12, ny + 5, 'octave down', { size: 14, weight: 'bold' });
  s += txt(X(F) + 12, ny + 24, 'step = +0.5 / tick: delay grows,', { size: 13, fill: col.dim });
  s += txt(X(F) + 12, ny + 41, 'the tap reads at half speed', { size: 13, fill: col.dim });
  s += arrow(tx - 16, ny, X(N) + 6, ny, col.a, 2.5);
  s += txt(X(N) - 12, ny + 5, 'octave up', { anchor: 'end', size: 14, weight: 'bold' });
  s += txt(X(N) - 12, ny + 24, 'step = \u22121 / tick: delay shrinks,', { anchor: 'end', size: 13, fill: col.dim });
  s += txt(X(N) - 12, ny + 41, 'the tap reads at double speed', { anchor: 'end', size: 13, fill: col.dim });
  s += txt(x0, ny + 90, 'step = 1 \u2212 ratio.  At unity step = 0 and the tap sits still: no splices at all.', { fill: col.dim, size: 14 });
  fs.writeFileSync(path.join(__dirname, 'fig1-tap.svg'), svg(W, Hh, s));
}

// ---------------------------------------------------------------- fig 2: one grain, delay vs time
{
  const W = 1200, Hh = 780;
  const panel = (top, dir) => {
    const step = dir === 'down' ? 0.5 : -1;
    const from = dir === 'down' ? N : F, to = dir === 'down' ? F : N;
    const T = E / Math.abs(step);            // ticks per grain
    const x0 = 90, x1 = 1130, y0 = top + 40, y1 = top + 280;
    const total = T + C + 260;
    const X = t => x0 + (x1 - x0) * t / total;
    const Y = d => y1 - (y1 - y0) * (d - 150) / (1750 - 150);
    const lag = dir === 'down' ? 80 : -80;
    const bStart = dir === 'down' ? N + lag : F - lag;
    let s = '';
    s += txt(x0, top + 20, dir === 'down' ? 'Octave down: step = +0.5, one grain is 2048 ticks' : 'Octave up: step = −1, one grain is 1024 ticks', { size: 17, weight: 'bold' });
    // grid
    for (const d of [N, F]) {
      s += line(x0, Y(d), x1, Y(d), col.grid, 1, 'stroke-dasharray="4 4"');
      s += txt(x0 - 8, Y(d) + 5, d, { anchor: 'end', fill: col.dim, size: 13 });
    }
    s += txt(x0 - 8, Y(N) + 22, 'near', { anchor: 'end', fill: col.dim, size: 12 });
    s += txt(x0 - 8, Y(F) - 12, 'far', { anchor: 'end', fill: col.dim, size: 12 });
    s += line(x0, y1, x1, y1, col.edge, 1);
    s += line(x0, y0, x0, y1, col.edge, 1);
    s += txt(x1, y1 + 18, 'time, ticks →', { anchor: 'end', fill: col.dim, size: 13 });
    s += txt(x0 - 60, y0 - 8, 'delay', { fill: col.dim, size: 13 });
    // bands
    const tReq = T - H, tSpl = T;
    s += rect(X(tReq), y0, X(tSpl) - X(tReq), y1 - y0, col.search, 'opacity="0.55"');
    s += rect(X(tSpl), y0, X(tSpl + C) - X(tSpl), y1 - y0, col.fade, 'opacity="0.7"');
    // tap A
    s += line(X(0), Y(from), X(tSpl), Y(to), col.a, 3);
    // tap A keeps going a little past the edge? no: at splice A is at the edge and keeps walking during the fade, then dropped
    const aEnd = to + step * C;
    s += line(X(tSpl), Y(to), X(tSpl + C), Y(aEnd), col.a, 3, 'stroke-dasharray="6 5"');
    // tap B
    s += line(X(tSpl), Y(bStart), X(total), Y(bStart + step * (total - tSpl)), col.b, 3);
    // markers
    const mark = (t, d, label, c, dy) => {
      s += `<circle cx="${X(t)}" cy="${Y(d)}" r="5" fill="${c}"/>`;
      s += txt(X(t), Y(d) + dy, label, { anchor: 'middle', fill: c, size: 13, weight: 'bold' });
    };
    const reqD = from + step * tReq;
    mark(tReq, reqD, 'request', col.text, dir === 'down' ? -12 : 24);
    mark(tSpl, to, 'splice', col.text, dir === 'down' ? -14 : 26);
    // labels for bands
    s += txt((X(tReq) + X(tSpl)) / 2, y1 - 10, 'search, 404 ticks', { anchor: 'middle', size: 13 });
    s += txt((X(tSpl) + X(tSpl + C)) / 2, dir === 'down' ? y1 - 10 : (y0 + y1) / 2 + 30, 'fade, 256 ticks', { anchor: 'middle', size: 13 });
    // lag brace
    const lx = X(tSpl) + 14;
    s += line(lx, Y(dir === 'down' ? N : F), lx, Y(bStart), col.b, 1.5);
    s += line(lx - 4, Y(dir === 'down' ? N : F), lx + 4, Y(dir === 'down' ? N : F), col.b, 1.5); s += line(lx - 4, Y(bStart), lx + 4, Y(bStart), col.b, 1.5);
    s += txt(lx + 10, Y(bStart) + (dir === 'down' ? 30 : -16), dir === 'down' ? 'B seated at 436 + best lag' : 'B seated at 1460 \u2212 best lag', { fill: col.b, size: 13 });
    // legend
    s += line(x1 - 420, top + 16, x1 - 390, top + 16, col.a, 3); s += txt(x1 - 384, top + 21, 'tap A (live)', { size: 13 });
    s += line(x1 - 280, top + 16, x1 - 250, top + 16, col.b, 3); s += txt(x1 - 244, top + 21, 'tap B (fading in, then becomes A)', { size: 13 });
    s += txt(X(420), Y(from + step * 420) + (dir === 'down' ? 28 : -14), 'A walks the excursion at step per tick', { fill: col.a, size: 13 });
    s += txt(X(total) - 4, Y(bStart + step * (total - tSpl)) + (dir === 'down' ? -12 : 26), 'B is now the live tap', { anchor: 'end', fill: col.b, size: 13 });
    return s;
  };
  let s = '';
  s += txt(90, 36, 'One grain: request, search, splice, fade', { size: 22, weight: 'bold' });
  s += txt(90, 60, 'The tap\u2019s delay against time. 404 ticks before it reaches an edge the search starts; at the edge a second tap is seated at the other end,', { fill: col.dim, size: 14 });
  s += txt(90, 78, 'offset by the best lag, and faded in. A keeps walking until the fade is done (dashed), then B is the live tap and the cycle repeats.', { fill: col.dim, size: 14 });
  s += panel(100, 'down');
  s += panel(440, 'up');
  fs.writeFileSync(path.join(__dirname, 'fig2-grain.svg'), svg(W, Hh, s));
}

// ---------------------------------------------------------------- fig 3: the search, one lag per tick
{
  const W = 1200, Hh = 790, x0 = 60, x1 = 1140, bh = 30;
  const X = d => x0 + (x1 - x0) * d / RING;
  let s = '';
  s += txt(x0, 36, 'The search: one lag per tick', { size: 22, weight: 'bold' });
  s += txt(x0, 60, 'The near window is frozen into MR0..MR99 at the request. The far window is read at fixed addresses every tick, so the drift of the delay line sweeps the lag.', { fill: col.dim, size: 14 });
  const row = (y, tick, title, sub) => {
    const nearAt = CB + tick;                  // where the captured content now sits
    const oldAt = nearAt + E;                  // the content 1024 samples older than it
    s += txt(x0, y - 10, title, { size: 14, weight: 'bold' });
    if (tick === H) s += txt(x0 + 420, y + bh + 40, sub, { size: 13, fill: col.dim });
    else s += txt(x0 + 420, y - 10, sub, { size: 13, fill: col.dim });
    s += rect(x0, y, x1 - x0, bh, col.line);
    s += rect(X(N), y, X(F) - X(N), bh, col.exc, `stroke="${col.edge}" stroke-width="1"`);
    // captured content, drifting
    s += rect(X(nearAt), y + 4, X(nearAt + W4) - X(nearAt), bh - 8, col.near, 'opacity="0.85"');
    // the content 1024 older, drifting
    s += rect(X(oldAt), y + 4, X(oldAt + W4) - X(oldAt), bh - 8, col.near, 'opacity="0.35"');
    // far read box, fixed
    s += rect(X(PBASE), y - 3, X(PBASE + W4) - X(PBASE), bh + 6, 'none', `stroke="${col.far}" stroke-width="2.5"`);
    if (tick === 0) {
      s += rect(X(CB), y - 3, X(CB + W4) - X(CB), bh + 6, 'none', `stroke="${col.near}" stroke-width="2.5"`);
      s += txt(X(CB + W4 / 2), y + bh + 20, 'near window, delay 33..429, copied to MR0..99', { anchor: 'middle', fill: col.near, size: 13 });
      s += txt(X(PBASE + W4 / 2), y + bh + 20, 'far window read, delay 1258..1654 (fixed)', { anchor: 'middle', fill: col.far, size: 13 });
      s += txt(X(N), y - 8, '436', { anchor: 'middle', fill: col.dim, size: 12 });
      s += txt(X(F), y - 8, '1460', { anchor: 'middle', fill: col.dim, size: 12 });
    } else if (tick === H) {
      s += txt(X(nearAt + W4 / 2), y + bh + 20, 'the captured content, now under the near edge', { anchor: 'middle', fill: col.near, size: 13 });
      const lag = 80;
      s += arrow(X(F), y - 26, X(F), y - 4, col.a, 2.5);
      s += txt(X(F) + 8, y - 12, 'tap A at the far edge', { fill: col.a, size: 13, weight: 'bold' });
      s += arrow(X(N + lag), y - 26, X(N + lag), y - 4, col.b, 2.5);
      s += txt(X(N + lag) + 8, y - 12, 'tap B seated at 436 + best lag', { fill: col.b, size: 13, weight: 'bold' });
    } else {
      s += txt(X(nearAt + W4 / 2), y + bh + 20, 'the captured content, drifted', { anchor: 'middle', fill: col.near, size: 13 });
      const lag = tick - 1 - R;
      const cx = X(oldAt + W4 / 2);
      s += txt(cx, y + bh + 38, `the same content, 1024 older: lag ${lag > 0 ? '+' : ''}${lag}`, { anchor: 'middle', fill: col.near, size: 13 });
      if (lag !== 0) {
        const ya = y + bh + 12;
        s += arrow(X(oldAt), ya, X(PBASE), ya, col.far, 1.5);
      }
    }
  };
  row(120, 0, 'Request (tick 0)', 'capture the near window; countdown = 404');
  row(240, 1, 'Tick 1: lag −200', '100 MACs: MR0..99 × the far window');
  row(360, 201, 'Tick 201: lag 0', 'the nominal splice, 1024 samples apart');
  row(480, 401, 'Tick 401: lag +200', 'all 401 lags scored; best is in MR101');
  row(610, 404, 'Tick 404: splice (octave down)', 'B is placed where the best lag said the signal matches what A is reading');
  // mr box legend
  const ly = 720;
  s += rect(x0, ly, 22, 14, col.near, 'opacity="0.85"'); s += txt(x0 + 30, ly + 12, 'the near window’s content, drifting one sample per tick', { size: 13 });
  s += rect(x0 + 470, ly, 22, 14, col.near, 'opacity="0.35"'); s += txt(x0 + 500, ly + 12, 'the same content, one grain (1024 samples) older', { size: 13 });
  s += rect(x0 + 860, ly, 22, 14, 'none', `stroke="${col.far}" stroke-width="2.5"`); s += txt(x0 + 890, ly + 12, 'far window read addresses', { size: 13 });
  s += txt(x0, ly + 40, 'The lag is how far the older copy sits from the fixed read box. Nothing moves the box; the delay line moves the signal.', { fill: col.dim, size: 14 });
  fs.writeFileSync(path.join(__dirname, 'fig3-search.svg'), svg(W, Hh, s));
}

// ---------------------------------------------------------------- fig 4: why the lag matters
{
  const W = 1200, Hh = 520, x0 = 80, x1 = 1140;
  const P = 70.6;   // samples per period: 1024 / P = 14.5, so the nominal lag is half a period off
  const wave = n => Math.sin(2 * Math.PI * n / P) + 0.35 * Math.sin(4 * Math.PI * n / P + 0.6);
  const Tn = 520;     // samples shown
  const X = n => x0 + (x1 - x0) * n / Tn;
  const fadeStart = 130;
  const panel = (top, lagOff, title, note) => {
    const yc = top + 90, amp = 34;
    let s = '';
    s += txt(x0, top + 12, title, { size: 16, weight: 'bold' });
    s += txt(x0, top + 32, note, { size: 13, fill: col.dim });
    s += rect(X(fadeStart), yc - amp - 12, X(fadeStart + C) - X(fadeStart), 2 * amp + 24, col.fade, 'opacity="0.5"');
    s += txt(X(fadeStart + C / 2), yc + amp + 32, 'crossfade, 256 samples', { anchor: 'middle', size: 12, fill: col.dim });
    const path = (f, c, w, dash) => {
      let d = '';
      for (let n = 0; n <= Tn; n++) d += (n ? 'L' : 'M') + X(n).toFixed(1) + ',' + (yc - amp * f(n)).toFixed(1);
      return `<path d="${d}" fill="none" stroke="${c}" stroke-width="${w}" ${dash ? `stroke-dasharray="${dash}"` : ''}/>`;
    };
    const a = n => wave(n), b = n => wave(n + E + lagOff);
    const g = n => Math.min(1, Math.max(0, (n - fadeStart) / C));
    const out = n => a(n) * (1 - g(n)) + b(n) * g(n);
    s += path(a, col.a, 1.5, '3 3');
    s += path(b, col.b, 1.5, '3 3');
    s += path(out, col.text, 2.2);
    
    s += line(x0 + 700, top + 12, x0 + 730, top + 12, col.a, 1.5); s += txt(x0 + 736, top + 17, 'tap A', { size: 12 });
    s += line(x0 + 790, top + 12, x0 + 820, top + 12, col.b, 1.5); s += txt(x0 + 826, top + 17, 'tap B', { size: 12 });
    s += line(x0 + 880, top + 12, x0 + 910, top + 12, col.text, 2.2); s += txt(x0 + 916, top + 17, 'output', { size: 12 });
    return s;
  };
  let s = '';
  s += txt(x0, 36, 'Why the lag matters', { size: 22, weight: 'bold' });
  s += txt(x0, 60, 'A tone whose period doesn’t divide the grain. Tap B reads the signal one grain earlier than tap A; the search shifts where by up to ±200 samples.', { size: 14, fill: col.dim });
  s += panel(90, 0, 'At the nominal lag (0): the two taps are half a period out of phase', 'The crossfade adds two opposed copies and the output collapses in the middle of the fade: the familiar wobble.');
  s += panel(300, Math.round(P / 2), 'At the best lag (+35, half a period): the taps are in phase', 'The score is highest where the copies line up, and the fade is between two identical signals (A and B sit under the output). Nothing to hear.');
  fs.writeFileSync(path.join(__dirname, 'fig4-lag.svg'), svg(W, Hh, s));
}
console.log('ok');
