'use strict';
/*
 * MODERN on WebGL2: the monsters as animated 3D models (drawn by gl.js).
 *
 * Every model is built from primitives (boxes, ellipsoids, tubes, cones) in the
 * 64-unit design space of the sprites, so that it keeps their look and size:
 * x points forward (where the monster faces), y to its left, z up from its feet
 * (a sprite's pixel (sx, sy) is at y = 32 - sx, z = 64 - sy). Primitives are
 * grouped in rigid parts; each part has an animation channel (legs, arms, head,
 * spin...) and a pivot that the channel turns it around. Flat details (the BSOD
 * screen, the troll's sign, the envelope, tape labels, stickers) are textures
 * in one atlas. Dying and dead monsters keep their sprites (glitch and debris).
 *
 * Vertex: pos3 nrm3 col3 uv2 gloss spec flags (1 emissive, 2 textured).
 */
const Monsters3D = (() => {
  const STRIDE = 14;
  const hex = (h) => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
  const v3 = {
    add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
    sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
    mul: (a, k) => [a[0] * k, a[1] * k, a[2] * k],
    dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
    cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
    norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
  };

  /* ------------------------------------------------------------ atlas */
  const atlasItems = [];
  // A texture drawn in a w x h design space, 8 texels per unit.
  function tex(w, h, draw) {
    const c = document.createElement('canvas');
    c.width = Math.round(w * 8); c.height = Math.round(h * 8);
    const g = c.getContext('2d');
    g.scale(8, 8);
    draw(g, w, h);
    const it = { c, i: atlasItems.length };
    atlasItems.push(it);
    return it;
  }
  function packAtlas() {
    const S = 1024, pad = 2;
    let x = 0, y = 0, rowH = 0;
    for (const it of atlasItems) {
      if (x + it.c.width + pad > S) { x = 0; y += rowH + pad; rowH = 0; }
      it.x = x; it.y = y; x += it.c.width + pad; rowH = Math.max(rowH, it.c.height);
    }
    const cv = document.createElement('canvas');
    cv.width = S; cv.height = Math.max(4, 1 << Math.ceil(Math.log2(y + rowH + 1)));
    const g = cv.getContext('2d');
    for (const it of atlasItems) g.drawImage(it.c, it.x, it.y);
    for (const it of atlasItems) {
      it.u0 = (it.x + 0.5) / S; it.v0 = (it.y + 0.5) / cv.height;
      it.u1 = (it.x + it.c.width - 0.5) / S; it.v1 = (it.y + it.c.height - 0.5) / cv.height;
    }
    return cv;
  }

  /* -------------------------------------------------------- primitives */
  // A model under construction: parts {anim, pivot, v: []}; `cur` receives the primitives.
  let model = null, cur = null;
  function begin() { model = { parts: [] }; part('static'); }
  function part(anim, pivot = [0, 0, 0], o = {}) {
    cur = { anim, pivot, v: [], side: o.side || 0, k: o.k || 0 };
    model.parts.push(cur);
    return cur;
  }
  // o: {emit, gloss, spec, tex (atlas item), uv: [[u, v] x 3]}
  function tri(a, b, c, na, nb, nc, col, o, uv) {
    const flags = (o.emit ? 1 : 0) | (uv ? 2 : 0), g = o.gloss ?? 0.4, s = o.spec ?? 0.3;
    const put = (p, n, t) => cur.v.push(p[0], p[1], p[2], n[0], n[1], n[2], col[0], col[1], col[2], t ? t[0] : 0, t ? t[1] : 0, g, s, flags);
    put(a, na, uv && uv[0]); put(b, nb, uv && uv[1]); put(c, nc, uv && uv[2]);
  }
  function quad(p0, p1, p2, p3, n, col, o, it) {
    // u = 2 x item index + corner: resolved to atlas coordinates once it is packed
    const uv = it ? [[2 * it.i, 0], [2 * it.i + 1, 0], [2 * it.i + 1, 1], [2 * it.i, 1]] : null;
    tri(p0, p1, p2, n, n, n, col, o, uv && [uv[0], uv[1], uv[2]]);
    tri(p0, p2, p3, n, n, n, col, o, uv && [uv[0], uv[2], uv[3]]);
  }
  // Box centered on c with half sizes h, turned by yaw around z; o.tex: {front, back, left, right, top}.
  function box(c, h, color, o = {}) {
    const col = hex(color), cy = Math.cos(o.yaw || 0), sy = Math.sin(o.yaw || 0);
    const P = (x, y, z) => [c[0] + (x * h[0]) * cy - (y * h[1]) * sy, c[1] + (x * h[0]) * sy + (y * h[1]) * cy, c[2] + z * h[2]];
    const R = (n) => [n[0] * cy - n[1] * sy, n[0] * sy + n[1] * cy, n[2]];
    const t = o.tex || {}, oe = (f) => ({ ...o, emit: o.emit || (o.emitFaces && o.emitFaces.includes(f)) });
    // faces seen from outside: corners top-left, top-right, bottom-right, bottom-left
    quad(P(1, 1, 1), P(1, -1, 1), P(1, -1, -1), P(1, 1, -1), R([1, 0, 0]), t.front ? [1, 1, 1] : col, oe('front'), t.front);
    quad(P(-1, -1, 1), P(-1, 1, 1), P(-1, 1, -1), P(-1, -1, -1), R([-1, 0, 0]), t.back ? [1, 1, 1] : col, oe('back'), t.back);
    quad(P(-1, 1, 1), P(1, 1, 1), P(1, 1, -1), P(-1, 1, -1), R([0, 1, 0]), t.left ? [1, 1, 1] : col, oe('left'), t.left);
    quad(P(1, -1, 1), P(-1, -1, 1), P(-1, -1, -1), P(1, -1, -1), R([0, -1, 0]), t.right ? [1, 1, 1] : col, oe('right'), t.right);
    quad(P(-1, 1, 1), P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), [0, 0, 1], t.top ? [1, 1, 1] : col, oe('top'), t.top);
    quad(P(1, 1, -1), P(1, -1, -1), P(-1, -1, -1), P(-1, 1, -1), [0, 0, -1], col, oe('bottom'));
  }
  // Ellipsoid centered on c with radii r; o.bump: random lumps (organic look).
  function ellipsoid(c, r, color, o = {}) {
    const col = hex(color), seg = o.seg || 18, ring = o.ring || 12, bump = o.bump || 0;
    const R = o.rng || Math.random;
    const lump = [];
    for (let k = 0; k < (bump ? 6 : 0); k++) lump.push([R() * 6.28, R() * 3.14, R() * 2 + 1]);
    const pt = (i, j) => {
      const th = (i / seg) * Math.PI * 2, ph = (j / ring) * Math.PI;
      let s = 1;
      for (const [a, b, f] of lump) s += bump * Math.sin(th * f + a) * Math.sin(ph * f + b) * 0.5;
      const d = [Math.sin(ph) * Math.cos(th), Math.sin(ph) * Math.sin(th), Math.cos(ph)];
      return { p: [c[0] + d[0] * r[0] * s, c[1] + d[1] * r[1] * s, c[2] + d[2] * r[2] * s], n: v3.norm([d[0] / r[0], d[1] / r[1], d[2] / r[2]]) };
    };
    for (let j = 0; j < ring; j++) for (let i = 0; i < seg; i++) {
      const a = pt(i, j), b = pt(i + 1, j), cc = pt(i + 1, j + 1), d = pt(i, j + 1);
      if (j > 0) tri(a.p, d.p, b.p, a.n, d.n, b.n, col, o);
      if (j < ring - 1) tri(b.p, d.p, cc.p, b.n, d.n, cc.n, col, o);
    }
  }
  // Tube (truncated cone) from a to b, radii r0 and r1, with caps.
  function tube(a, b, r0, r1, color, o = {}) {
    const col = hex(color), n = o.sides || 12;
    const ax = v3.norm(v3.sub(b, a));
    const up = Math.abs(ax[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1];
    const e1 = v3.norm(v3.cross(ax, up)), e2 = v3.cross(ax, e1);
    const slope = (r0 - r1) / Math.max(1e-3, Math.hypot(...v3.sub(b, a)));
    const ring = (p, r, t) => v3.add(p, v3.add(v3.mul(e1, Math.cos(t) * r), v3.mul(e2, Math.sin(t) * r)));
    const nrm = (t) => v3.norm(v3.add(v3.add(v3.mul(e1, Math.cos(t)), v3.mul(e2, Math.sin(t))), v3.mul(ax, slope)));
    for (let i = 0; i < n; i++) {
      const t0 = i / n * Math.PI * 2, t1 = (i + 1) / n * Math.PI * 2;
      const p00 = ring(a, r0, t0), p01 = ring(a, r0, t1), p10 = ring(b, r1, t0), p11 = ring(b, r1, t1);
      tri(p00, p10, p11, nrm(t0), nrm(t0), nrm(t1), col, o);
      tri(p00, p11, p01, nrm(t0), nrm(t1), nrm(t1), col, o);
      if (o.caps !== false) {
        if (r0 > 0.01) tri(a, p01, p00, v3.mul(ax, -1), v3.mul(ax, -1), v3.mul(ax, -1), col, o);
        if (r1 > 0.01) tri(b, p10, p11, ax, ax, ax, col, o);
      }
    }
  }
  // A cable: a smooth tube through the points (Catmull-Rom).
  function cable(pts, r, color, o = {}) {
    const P = [pts[0], ...pts, pts[pts.length - 1]], out = [];
    for (let i = 1; i < P.length - 2; i++) for (let s = 0; s < 4; s++) {
      const t = s / 4, t2 = t * t, t3 = t2 * t;
      const f = (k) => 0.5 * ((2 * P[i][k]) + (-P[i - 1][k] + P[i + 1][k]) * t + (2 * P[i - 1][k] - 5 * P[i][k] + 4 * P[i + 1][k] - P[i + 2][k]) * t2 + (-P[i - 1][k] + 3 * P[i][k] - 3 * P[i + 1][k] + P[i + 2][k]) * t3);
      out.push([f(0), f(1), f(2)]);
    }
    out.push(pts[pts.length - 1]);
    for (let i = 0; i + 1 < out.length; i++) tube(out[i], out[i + 1], r, r, color, { ...o, sides: 7, caps: i === 0 || i === out.length - 2 });
  }
  const sp = (c, r, color, o) => ellipsoid(c, [r, r, r], color, { seg: 12, ring: 8, ...o });

  /* ------------------------------------------------------------ models */
  const SHELL = { gloss: 0.75, spec: 0.6 }, SKIN = { gloss: 0.3, spec: 0.15 }, METAL = { gloss: 0.7, spec: 0.7 };

  function bug() {
    begin();
    part('body', [0, 0, 16]);
    ellipsoid([-3, 0, 17], [15, 17, 11], '#2c9a37', SHELL);
    ellipsoid([-3, 0, 21], [13, 14, 7], '#3fc24c', SHELL);
    box([-3, 3, 27.6], [5, 0.4, 0.3], '#b6ffbf', { emit: true });
    box([-6, -4, 27.4], [0.4, 4, 0.3], '#b6ffbf', { emit: true });
    box([-4, 15, 21], [2, 1.2, 1], '#ff00ff', { emit: true });
    box([2, -14, 15], [1.6, 1.2, 1], '#00ffff', { emit: true });
    part('head', [6, 0, 26]);
    ellipsoid([10, 0, 30], [9, 11, 9], '#23702b', SHELL);
    for (const s of [1, -1]) {
      sp([16.5, s * 5, 31.5], 3, '#ff2a2a', { emit: true });
      cable([[12, s * 4, 37], [13, s * 8, 45], [16, s * 12, 51]], 0.8, '#23702b');
      sp([16, s * 12, 51], 1.6, '#3fc24c', SHELL);
    }
    part('jaw', [16, 0, 25]);
    for (const s of [1, -1]) tube([16, s * 3, 25], [22, s * 6, 20], 1.6, 0.6, '#0f2e13');
    // tripod gait: legs 0 and 2 of one side move with leg 1 of the other side
    for (let i = 0; i < 3; i++) for (const s of [1, -1]) {
      const x = -10 + i * 8;
      part((i + (s > 0 ? 0 : 1)) % 2 ? 'legB' : 'legA', [x, s * 10, 16]);
      cable([[x, s * 10, 16], [x + 1, s * 20, 15], [x + 2, s * 25, 7], [x + 3, s * 27, 0]], 1.5, '#1b4d21');
    }
    return model;
  }

  function drone() {
    begin();
    part('spin', [0, 0, 34]);
    sp([0, 0, 34], 18, '#8d2468', { seg: 22, ring: 14, gloss: 0.6, spec: 0.5 });
    const n = 16;
    for (let i = 0; i < n; i++) {
      const y = 1 - (i + 0.5) / n * 2, r = Math.sqrt(1 - y * y), t = i * 2.39996;
      const d = [r * Math.cos(t), r * Math.sin(t), y];
      if (d[0] > 0.75) continue;   // keep the eye clear
      tube(v3.add([0, 0, 34], v3.mul(d, 15)), v3.add([0, 0, 34], v3.mul(d, 25)), 1.6, 1.2, '#7a1f5c');
      sp(v3.add([0, 0, 34], v3.mul(d, 26)), 3.5, '#d93a8f', { gloss: 0.6, spec: 0.5 });
    }
    part('eye', [0, 0, 34]);
    ellipsoid([10, 0, 34], [9, 9, 9], '#f2f2f2', { gloss: 0.9, spec: 0.9, seg: 20 });
    ellipsoid([18.2, 0, 34], [1.5, 5, 5], '#ff1a1a', { emit: true });
    ellipsoid([19.2, 0, 34], [0.8, 2, 2], '#000000', {});
    ellipsoid([0, 0, 13], [8, 8, 1.6], '#33ccff', { emit: true });
    return model;
  }

  const BSOD = () => tex(28, 17, (g, w, h) => {
    g.fillStyle = '#1a5fd0'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#fff'; g.font = 'bold 10px monospace'; g.fillText(':(', 2, 11);
    g.fillRect(16, 4, 9, 1); g.fillRect(16, 7, 7, 1); g.fillRect(16, 10, 9, 1); g.fillRect(16, 13, 5, 1);
  });
  function bot() {
    begin();
    const screen = BSOD();
    for (const s of [1, -1]) {
      part(s > 0 ? 'legA' : 'legB', [0, s * 6.5, 19]);
      box([0, s * 6.5, 10], [3.5, 3.5, 9], '#3c4148', METAL);
      box([2, s * 6.5, 1.2], [5.5, 4.5, 1.2], '#1b1e22', METAL);
    }
    part('body', [0, 0, 19]);
    box([0, 0, 29], [8, 14, 11], '#50565e', METAL);
    box([0, 0, 40.4], [8.2, 14.2, 0.6], '#6a717a', METAL);
    for (let k = 0; k < 5; k++) box([8.1, 4, 23 + k * 3], [0.2, 6, 0.5], '#23262b');
    box([8.2, -7, 33], [0.3, 1, 1], '#3dff6a', { emit: true });
    box([8.2, -7, 29], [0.3, 1, 1], '#ffb52e', { emit: true });
    box([0, 0, 42], [3, 4, 2], '#2b2f35', METAL);
    part('head', [0, 0, 42]);
    box([0, 0, 52], [5, 16, 10], '#2b2f35', METAL);
    box([5.15, 0, 52.5], [0.2, 14, 8.5], '#ffffff', { tex: { front: screen }, emit: true });
    for (let k = 0; k < 4; k++) box([-5.1, 0, 47 + k * 3], [0.2, 10, 0.6], '#1b1e22');
    part('armL', [0, 18.5, 37], { side: 1 });
    box([0, 18.5, 30], [3.5, 3.5, 8], '#3c4148', METAL);
    part('gun', [0, -18.5, 37], { side: -1 });
    box([0, -18.5, 30], [3.5, 3.5, 8], '#3c4148', METAL);
    box([5, -18.5, 23], [8, 3, 3], '#222222', METAL);
    tube([12, -18.5, 24], [17, -18.5, 24], 1.2, 1.2, '#111111');
    return model;
  }

  const SIGN = () => tex(20, 11, (g, w, h) => {
    g.fillStyle = '#f2f2e0'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#c21d1d'; g.font = 'bold 6px monospace'; g.fillText('FIRST!', 1, 8);
  });
  function troll() {
    begin();
    const sign = SIGN();
    for (const s of [1, -1]) {
      part(s > 0 ? 'legA' : 'legB', [0, s * 9, 18]);
      box([0, s * 9, 9], [5, 5, 9], '#3d5a2a', SKIN);
    }
    part('body', [0, 0, 18]);
    ellipsoid([0, 0, 27], [14, 20, 16], '#5f8a3a', { ...SKIN, bump: 0.08, rng: rng(7) });
    ellipsoid([6, 0, 23], [9, 12, 9], '#7aa84c', SKIN);
    box([0, 0, 14], [13.5, 19, 2.6], '#5a3a1a', { gloss: 0.4, spec: 0.25 });
    part('head', [0, 0, 38]);
    ellipsoid([4, 0, 47], [11, 12, 11], '#6f9a44', { ...SKIN, bump: 0.05, rng: rng(9) });
    for (const s of [1, -1]) {
      sp([13.5, s * 6, 49], 3, '#ffffff', { gloss: 0.8, spec: 0.6 });
      sp([16, s * 6, 49], 1.3, '#cc0000', { emit: true });
      box([13, s * 6, 53.5], [1.5, 3.5, 0.9], '#2a3a1a', { yaw: s * 0.3 });
      ellipsoid([1, s * 12.5, 52], [2, 2.5, 5], '#6f9a44', SKIN);
    }
    box([13.5, 0, 41], [1.2, 5.5, 1.4], '#2a1a0a');
    for (const s of [1, -1]) box([14, s * 3.5, 41.5], [0.6, 1, 1.2], '#f2f2e0');
    part('armL', [0, 21, 36], { side: 1 });
    ellipsoid([0, 21, 28], [6, 6, 9], '#5f8a3a', SKIN);
    tube([3, 25, 14], [3, 25, 58], 1, 1, '#6b4a2a');
    box([4, 25, 53], [1, 10, 5.5], '#8a6a3a', { tex: { front: sign } });
    part('club', [0, -21, 36], { side: -1 });
    ellipsoid([0, -21, 28], [6, 6, 9], '#5f8a3a', SKIN);
    box([6, -24, 30], [2, 4, 15], '#2c3038', { yaw: 0, ...METAL });
    for (let k = 0; k < 6; k++) box([8.2, -24, 19 + k * 4], [0.3, 3, 1], '#d9dde2');
    return model;
  }

  const ENVELOPE = () => tex(44, 32, (g, w, h) => {
    g.fillStyle = '#f2efe0'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#b8b0a0'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(0, 0); g.lineTo(22, 20); g.lineTo(44, 0); g.stroke();
    g.fillStyle = '#c21d1d'; g.fillRect(30, 3, 10, 8);
    g.fillStyle = '#fff'; g.font = 'bold 6px monospace'; g.fillText('$', 33, 10);
    g.fillStyle = '#e8c21a'; g.font = 'bold 5px monospace'; g.fillText('SPAM', 4, 8);
    for (const [x, y] of [[14, 12], [30, 16]]) {
      g.fillStyle = '#fff'; g.beginPath(); g.arc(x, y, 4, 0, 7); g.fill();
      g.fillStyle = '#000'; g.beginPath(); g.arc(x, y, 2, 0, 7); g.fill();
    }
  });
  const ENVELOPE_BACK = () => tex(44, 32, (g, w, h) => {
    g.fillStyle = '#ece8d6'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#b8b0a0'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(0, 32); g.lineTo(22, 14); g.lineTo(44, 32); g.moveTo(0, 0); g.lineTo(20, 15); g.moveTo(44, 0); g.lineTo(24, 15); g.stroke();
  });
  function spam() {
    begin();
    const front = ENVELOPE(), back = ENVELOPE_BACK();
    for (const s of [1, -1]) {
      part(s > 0 ? 'legA' : 'legB', [0, s * 7.5, 16]);
      tube([0, s * 7.5, 16], [0, s * 7.5, 1.5], 2.5, 2.2, '#222222');
      box([2, s * 7.5, 1], [4, 3, 1], '#111111');
    }
    part('body', [0, 0, 16]);
    box([0, 0, 30], [3, 22, 16], '#f2efe0', { tex: { front, back }, gloss: 0.3, spec: 0.1 });
    part('mouth', [3.2, 0, 20]);
    ellipsoid([3.2, 0, 20], [0.6, 7, 2], '#660000', {});
    part('orbit', [0, 0, 30]);
    for (const s of [1, -1]) sp([0, s * 28, 50], 3, '#e8741a', { emit: true });
    return model;
  }

  function boss(pal) {
    return () => {
      begin();
      for (const s of [1, -1]) {
        part(s > 0 ? 'legA' : 'legB', [0, s * 12, 18]);
        box([0, s * 12, 9], [6, 6, 9], pal.dark, METAL);
        box([2, s * 12, 1], [8, 7, 1], '#111111', METAL);
      }
      part('body', [0, 0, 18]);
      box([0, 0, 27], [12, 22, 11], pal.body, METAL);
      box([0, 0, 38.6], [12.2, 22.2, 1.2], pal.light, METAL);
      for (let k = 0; k < 5; k++) box([-12.1, 0, 20 + k * 4], [0.3, 4, 1.2], pal.dark);
      // padlock
      box([12.6, 0, 17], [1.2, 7, 5.5], '#e8c21a', { gloss: 0.85, spec: 0.9 });
      cable([[12.6, -4.5, 22], [12.6, -4.5, 26], [12.6, 0, 28.5], [12.6, 4.5, 26], [12.6, 4.5, 22]], 1.3, '#e8c21a', { gloss: 0.85, spec: 0.9 });
      box([13.9, 0, 16.5], [0.2, 1, 2.5], '#000000');
      part('head', [0, 0, 40]);
      ellipsoid([2, 0, 51], [13, 16, 14], pal.head, { gloss: 0.5, spec: 0.3, seg: 22, ring: 14 });
      box([5, 0, 41], [9, 10, 4], pal.head, { gloss: 0.5, spec: 0.3 });
      for (const s of [1, -1]) {
        ellipsoid([12.5, s * 7, 51], [2.5, 5, 5], '#050505', {});
        sp([14.6, s * 7, 51], 2, pal.eye, { emit: true });
      }
      box([14.5, 0, 45.5], [0.6, 2, 2], '#000000');
      for (let k = -4; k <= 4; k += 2) box([14.1, k * 1.5, 38.5], [0.5, 1.2, 1.8], '#f4f0e6');
      for (const s of [1, -1]) {
        part(s > 0 ? 'armL' : 'gun', [0, s * 27, 36], { side: s });
        box([0, s * 27, 27], [6, 5, 10], pal.dark, METAL);
        tube([2, s * 27, 18], [13, s * 27, 18], 4, 4, '#111111', METAL);
        tube([12.8, s * 27, 18], [13.2, s * 27, 18], 2.6, 2.6, pal.shot, { emit: true });
      }
      return model;
    };
  }

  function spaghetti() {
    begin();
    const R = rng(77), cols = ['#e8c21a', '#2a7de1', '#e8741a', '#d92d7a', '#8ad13a', '#e8e8e8', '#20b8c8'];
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * Math.PI * 2, y = Math.cos(a) * 9, x = Math.sin(a) * 6;
      part(i % 2 ? 'legA' : 'legB', [x, y, 20]);
      cable([[x, y, 22], [x + 2, y * 1.3, 12], [x + 1, y * 1.5, 1]], 1.4, cols[i % cols.length]);
    }
    part('body', [0, 0, 20]);
    sp([0, 0, 34], 17, '#101216', { seg: 18, ring: 12 });
    for (let k = 0; k < 26; k++) {
      // loops of patch cable wrapped around the knot
      const ax = v3.norm([R() - 0.5, R() - 0.5, R() - 0.5]), e1 = v3.norm(v3.cross(ax, [0.3, 0.5, 0.8])), e2 = v3.cross(ax, e1);
      const r = 16 + R() * 4, a0 = R() * 6.28, len = 1.5 + R() * 2.5, pts = [];
      for (let s = 0; s <= 6; s++) {
        const t = a0 + s / 6 * len;
        pts.push(v3.add([0, 0, 34], v3.add(v3.mul(e1, Math.cos(t) * r), v3.mul(e2, Math.sin(t) * r))));
      }
      cable(pts, 1.2, cols[k % cols.length], { gloss: 0.6, spec: 0.4 });
    }
    part('head', [0, 0, 34]);
    for (const s of [1, -1]) {
      sp([15, s * 7, 40], 6.5, '#ffffff', { gloss: 0.9, spec: 0.7 });
      sp([20.5, s * 7, 40], 2.8, '#cc0000', { emit: true });
    }
    box([16.5, 0, 27], [1, 8, 2], '#330000');
    for (let k = -3; k <= 3; k++) box([17.6, k * 2.2, 28.4], [0.4, 0.7, 0.9], '#e8e8e8');
    for (const s of [1, -1]) {
      part(s > 0 ? 'armL' : 'gun', [0, s * 16, 34], { side: s });
      cable([[0, s * 16, 34], [3, s * 27, 38], [5, s * 28, 50], [6, s * 27, 58]], 1.6, s > 0 ? '#2a7de1' : '#e8741a');
      box([6, s * 27, 60], [2.5, 2, 3], s > 0 ? '#2a7de1' : '#e8741a', { gloss: 0.7, spec: 0.5 });
      box([6, s * 27, 64], [2.6, 2.1, 1.2], '#dceaf5', { gloss: 0.9, spec: 0.8 });
    }
    return model;
  }

  function hotspot() {
    begin();
    // flames: wobbly cones, self-lit
    [[24, 60, '#b8200a', 0], [19, 50, '#ff5a1a', 1], [13, 38, '#ffb000', 2], [6, 22, '#fff2a0', 3]].forEach(([r, h, c, i]) => {
      part('flame', [0, 0, 0], { k: i });
      const n = 16, rows = 8, col = hex(c);
      for (let j = 0; j < rows; j++) for (let s = 0; s < n; s++) {
        const P = (ss, jj) => {
          const t = ss / n * Math.PI * 2, f = jj / rows, w = 1 + 0.12 * Math.sin(t * 3 + i + jj);
          const rr = r * (1 - f) ** 0.8 * w;
          // inner layers sit toward the front, so that they show through the outer ones
          return [Math.cos(t) * rr * 0.75 + (24 - r) * 0.75 * (1 - f * 0.5), Math.sin(t) * rr, f * h];
        };
        const a = P(s, j), b = P(s + 1, j), cc = P(s + 1, j + 1), d = P(s, j + 1), nn = v3.norm([a[0], a[1], r * 0.4]);
        tri(a, b, cc, nn, nn, nn, col, { emit: true });
        tri(a, cc, d, nn, nn, nn, col, { emit: true });
      }
    });
    part('head', [0, 0, 30]);
    for (const s of [1, -1]) {
      box([16, s * 7, 32], [1, 5, 1.2], '#2a0800', { yaw: -s * 0.35 });
      box([17, s * 7, 29.5], [0.5, 1.6, 0.8], '#ffe14a', { emit: true });
    }
    box([15, 0, 19], [1, 6, 1.6], '#2a0800');
    part('static');
    tube([0, -24, 26], [0, -24, 56], 2.6, 2.6, '#f2f2f2', { gloss: 0.9, spec: 0.8 });
    tube([1.6, -24, 26], [1.6, -24, 54], 1.1, 1.1, '#e02020', { emit: true });
    sp([0, -24, 24], 4, '#e02020', { emit: true });
    return model;
  }

  function storm() {
    begin();
    part('body', [0, 0, 34]);
    for (const [x, sx, sy, r, c] of [[2, 18, 26, 11, '#3a3f4a'], [0, 32, 20, 14, '#454b58'], [2, 46, 26, 11, '#3a3f4a'], [6, 26, 30, 11, '#4e5563'], [5, 40, 31, 11, '#4e5563'], [-4, 32, 16, 9, '#5a6070'], [-6, 30, 26, 12, '#3a3f4a']]) {
      ellipsoid([x, 32 - sx, 56 - sy], [r * 1.1, r * 1.2, r * 0.85], c, { gloss: 0.2, spec: 0.05, bump: 0.1, rng: rng(sx) });
    }
    for (const s of [1, -1]) ellipsoid([17.5, s * 6, 31], [1.2, 3.5, 2.5], '#ff3030', { emit: true });
    part('bolt', [0, 0, 30]);
    cable([[4, 2, 30], [4, 8, 18], [4, 2, 17], [4, 6, 3]], 1.4, '#ffe14a', { emit: true });
    part('orbit', [0, 0, 12]);
    for (let k = 0; k < 6; k++) {
      const a = k / 6 * Math.PI * 2;
      box([Math.cos(a) * 20, Math.sin(a) * 20, 10 + (k % 3) * 5], [3.5, 3.5, 2.5], '#f2f2f2', { yaw: a, emitFaces: ['top'] });
      box([Math.cos(a) * 20, Math.sin(a) * 20, 12.6 + (k % 3) * 5], [3.6, 3.6, 0.3], '#2a7de1', { yaw: a });
    }
    return model;
  }

  const LTO = () => tex(24, 4, (g, w, h) => {
    g.fillStyle = '#e8e8e0'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#111'; g.font = '3px monospace'; g.fillText('LTO-4  L4  000427', 1, 3);
  });
  function bitrot() {
    begin();
    const label = LTO(), R = rng(9);
    const tape = (c, hs) => {
      box(c, hs, '#1d2a4a', { gloss: 0.55, spec: 0.4 });
      box([c[0] + hs[0] + 0.15, c[1], c[2] + hs[2] * 0.55], [0.15, hs[1] * 0.85, hs[2] * 0.22], '#ffffff', { tex: { front: label } });
    };
    for (const s of [1, -1]) {
      part(s > 0 ? 'legA' : 'legB', [0, s * 9, 18]);
      tape([0, s * 9, 9], [5, 5, 9]);
    }
    part('body', [0, 0, 18]);
    tape([0, 0, 28], [10, 18, 11]);
    for (let k = 0; k < 16; k++) {
      const y = (R() - 0.5) * 34, z = 18 + R() * 40;
      ellipsoid([z > 39 ? 8.5 : 10.4, y * (z > 39 ? 0.65 : 1), z], [1 + R() * 1.5, 1.5 + R() * 3, 1 + R() * 2], k % 2 ? '#4a7a2a' : '#6a9a3a', { seg: 8, ring: 6, gloss: 0.2 });
    }
    part('head', [0, 0, 39]);
    tape([0, 0, 47], [8, 12, 8]);
    for (const s of [1, -1]) {
      tube([8, s * 5, 48], [9.5, s * 5, 48], 4, 4, '#c9cdd1', METAL);
      tube([9.4, s * 5, 48], [9.8, s * 5, 48], 1.5, 1.5, '#cc0000', { emit: true });
    }
    for (const s of [1, -1]) {
      part(s > 0 ? 'armL' : 'gun', [0, s * 18, 34], { side: s });
      cable([[0, s * 18, 34], [4, s * 27, 26], [5, s * 26, 14], [8, s * 22, 10]], 1.8, '#5a3a1a', { gloss: 0.6, spec: 0.4 });
    }
    return model;
  }

  const LAPTOP = () => tex(20, 13, (g, w, h) => {
    g.fillStyle = '#9aa1a8'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#7855fa'; g.beginPath(); g.arc(6, 5, 2.5, 0, 7); g.fill();
    g.fillStyle = '#e8741a'; g.fillRect(11, 3, 5, 3);
    g.fillStyle = '#111'; g.font = 'bold 4px monospace'; g.fillText('SaaS', 5, 11);
  });
  function shadowit() {
    begin();
    const lap = LAPTOP();
    for (const s of [1, -1]) {
      part(s > 0 ? 'legA' : 'legB', [0, s * 6, 20]);
      box([0, s * 6, 10], [4, 4, 10], '#15101e', SKIN);
    }
    part('body', [0, 0, 20]);
    tube([0, 0, 18], [0, 0, 43], 15, 11, '#2c2240', { sides: 10, gloss: 0.2, spec: 0.1 });
    ellipsoid([0, 0, 48], [11, 11, 12], '#2c2240', { gloss: 0.2, spec: 0.1 });
    ellipsoid([6, 0, 46], [5, 8, 7], '#0a0810', {});
    for (const s of [1, -1]) box([10.6, s * 3.5, 47], [0.3, 2, 0.75], '#20e8ff', { emit: true });
    box([8, 13, 26], [1, 10, 6.5], '#9aa1a8', { tex: { front: lap }, ...METAL });
    part('scarf', [-2, -4, 42]);
    box([-12, -6, 42], [10, 1.5, 2.4], '#7855fa', { gloss: 0.3 });
    part('gun', [0, -14, 36], { side: -1 });
    tube([0, -14, 36], [6, -17, 28], 3, 2.5, '#2c2240', { sides: 8 });
    box([8, -18, 27], [0.4, 6, 4], '#e8c21a', { gloss: 0.8, spec: 0.8, yaw: 0.3 });
    return model;
  }

  /* --------------------------------------------------------------- build */
  // {type: {parts: [{anim, pivot, side, k, first, count}]}, data, atlas, stride}
  function build() {
    const makers = { bug, drone, bot, troll, spam, spaghetti, hotspot, storm, bitrot, shadowit };
    for (const [k, pal] of Object.entries(BOSS_PAL)) makers[k] = boss(pal);
    const models = {}, chunks = [];
    let n = 0;
    for (const [k, fn] of Object.entries(makers)) {
      const m = fn();
      models[k] = { parts: [] };
      for (const p of m.parts) {
        if (!p.v.length) continue;
        models[k].parts.push({ anim: p.anim, pivot: p.pivot, side: p.side, k: p.k, first: n, count: p.v.length / STRIDE, verts: p.v });
        n += p.v.length / STRIDE;
      }
    }
    const atlas = packAtlas();
    // texture corners were stored as 0..1 within each item: resolved now that the atlas is packed
    const data = new Float32Array(n * STRIDE);
    let o = 0;
    for (const m of Object.values(models)) for (const p of m.parts) {
      const v = p.verts;
      for (let i = 0; i < v.length; i += STRIDE) {
        if (!(v[i + 13] & 2)) continue;
        const idx = Math.floor(v[i + 9] / 2), it = atlasItems[idx], cu = v[i + 9] - idx * 2, cv = v[i + 10];
        v[i + 9] = it.u0 + (it.u1 - it.u0) * cu;
        v[i + 10] = it.v0 + (it.v1 - it.v0) * cv;
      }
      data.set(v, o); o += v.length; delete p.verts;
    }
    return { models, data, atlas, stride: STRIDE };
  }

  return { build };
})();
