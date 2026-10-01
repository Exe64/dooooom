'use strict';
/*
 * First-person weapons.
 *
 * Each weapon is a tiny 3D model (boxes and tubes) in camera space
 * (x right, y down, z forward, in meters), rendered once at startup in
 * perspective with per-face lighting, then pixelated (alpha threshold,
 * slight posterization, dark outline) into sprites at 2 texels per screen
 * pixel. At runtime the game only blits the right pose, with bobbing,
 * recoil and a dynamic muzzle flash.
 */
const WeaponArt = (() => {
  let S = 2;                   // texels per logical screen pixel (2 RETRO, 4 MODERN)
  let PIXEL = true;            // RETRO: binary alpha, posterized colors, dark outline
  const VW = 480, VHH = 230;   // logical size of the 3D view (matches game.js)
  const CX = 240, CY = 115;    // vanishing point = crosshair
  // per-weapon framing: focal length, screen offset, and a model placement (yaw/pitch around a pivot, then shift)
  let view = { f: 340, ox: 0, oy: 0 };

  /* ---------------------------------------------------------- vector math */
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const LIGHT = norm([-0.35, -0.9, 0.25]);   // from above, slightly ahead: bright tops, shaded backs

  // Rotation basis from yaw (around y), pitch (around x) and roll (around z).
  function basis(yaw = 0, pitch = 0, roll = 0) {
    const rot = (v) => {
      let [x, y, z] = v;
      // roll
      [x, y] = [x * Math.cos(roll) - y * Math.sin(roll), x * Math.sin(roll) + y * Math.cos(roll)];
      // pitch
      [y, z] = [y * Math.cos(pitch) - z * Math.sin(pitch), y * Math.sin(pitch) + z * Math.cos(pitch)];
      // yaw
      [x, z] = [x * Math.cos(yaw) + z * Math.sin(yaw), -x * Math.sin(yaw) + z * Math.cos(yaw)];
      return [x, y, z];
    };
    return { u: rot([1, 0, 0]), v: rot([0, 1, 0]), w: rot([0, 0, 1]) };
  }

  /* ------------------------------------------------------------ primitives */
  // A face: {pts, col:[r,g,b], emit, tex, center}
  function box(c, h, col, o = {}) {
    const B = basis(o.yaw, o.pitch, o.roll);
    const P = (sx, sy, sz) => add(c, add(add(mul(B.u, sx * h[0]), mul(B.v, sy * h[1])), mul(B.w, sz * h[2])));
    const faces = {
      top: [P(-1, -1, 1), P(1, -1, 1), P(1, -1, -1), P(-1, -1, -1)],
      bottom: [P(-1, 1, -1), P(1, 1, -1), P(1, 1, 1), P(-1, 1, 1)],
      front: [P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1)],
      back: [P(1, -1, -1), P(-1, -1, -1), P(-1, 1, -1), P(1, 1, -1)],
      left: [P(-1, -1, -1), P(-1, -1, 1), P(-1, 1, 1), P(-1, 1, -1)],
      right: [P(1, -1, 1), P(1, -1, -1), P(1, 1, -1), P(1, 1, 1)],
    };
    const out = [];
    for (const [name, pts] of Object.entries(faces)) {
      const fc = (o.cols && o.cols[name]) || col;
      out.push({ pts, col: fc, emit: o.emit || (o.emitFaces && o.emitFaces.includes(name)), tex: o.tex && o.tex[name], center: c });
    }
    return out;
  }

  // A tube (truncated cone) from p0 to p1, with optional end caps.
  function tube(p0, p1, r0, r1, col, o = {}) {
    const n = o.sides || 12;
    const ax = norm(sub(p1, p0));
    const up = Math.abs(ax[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
    const e1 = norm(cross(ax, up)), e2 = cross(ax, e1);
    const ring = (p, r, a) => add(p, add(mul(e1, Math.cos(a) * r), mul(e2, Math.sin(a) * r)));
    const c = mul(add(p0, p1), 0.5);
    const out = [];
    const a0 = o.phase || 0;
    for (let i = 0; i < n; i++) {
      const a = a0 + i / n * Math.PI * 2, b = a0 + (i + 1) / n * Math.PI * 2;
      out.push({ pts: [ring(p0, r0, a), ring(p0, r0, b), ring(p1, r1, b), ring(p1, r1, a)], col, emit: o.emit, center: c });
    }
    const cap = (p, r, cc) => {
      const pts = [];
      for (let i = 0; i < n; i++) pts.push(ring(p, r, a0 + i / n * Math.PI * 2));
      out.push({ pts, col: cc, emit: o.capEmit, center: c });
    };
    if (o.capBack !== false) cap(p0, r0, o.capCol || col);
    if (o.capFront !== false) cap(p1, r1, o.frontCol || o.capCol || col);
    return out;
  }

  /* ----------------------------------------------------------- rendering */
  const NEAR = 0.08;
  const project = (p) => { const z = Math.max(NEAR, p[2]); return [CX + view.ox + view.f * p[0] / z, CY + view.oy + view.f * p[1] / z]; };

  function texTri(g, img, p0, p1, p2, t0, t1, t2) {
    // maps texture triangle t0,t1,t2 onto screen triangle p0,p1,p2
    const [x0, y0] = p0, [x1, y1] = p1, [x2, y2] = p2;
    const [u0, v0] = t0, [u1, v1] = t1, [u2, v2] = t2;
    const d = (u1 - u0) * (v2 - v0) - (u2 - u0) * (v1 - v0);
    if (Math.abs(d) < 1e-6) return;
    const a = ((x1 - x0) * (v2 - v0) - (x2 - x0) * (v1 - v0)) / d;
    const b = ((y1 - y0) * (v2 - v0) - (y2 - y0) * (v1 - v0)) / d;
    const c = ((x2 - x0) * (u1 - u0) - (x1 - x0) * (u2 - u0)) / d;
    const e = ((y2 - y0) * (u1 - u0) - (y1 - y0) * (u2 - u0)) / d;
    g.save();
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.lineTo(x2, y2); g.closePath(); g.clip();
    g.transform(a, b, c, e, x0 - a * u0 - c * v0, y0 - b * u0 - e * v0);
    g.drawImage(img, 0, 0);
    g.restore();
  }

  // Applies the framing transform of the current view to a model point.
  function place(p) {
    const pv = view.pivot || [0.12, 0.15, 0.5];
    let [x, y, z] = sub(p, pv);
    const yw = view.yaw || 0, pt = view.pitch || 0;
    [y, z] = [y * Math.cos(pt) - z * Math.sin(pt), y * Math.sin(pt) + z * Math.cos(pt)];
    [x, z] = [x * Math.cos(yw) + z * Math.sin(yw), -x * Math.sin(yw) + z * Math.cos(yw)];
    return add(add([x, y, z], pv), view.shift || [0, 0, 0]);
  }

  function render(rawFaces) {
    const faces = rawFaces.map((f) => ({ ...f, pts: f.pts.map(place), center: place(f.center) }));
    const c = document.createElement('canvas');
    c.width = VW * S; c.height = VHH * S;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = !PIXEL;
    g.scale(S, S);
    const vis = [];
    for (const f of faces) {
      let n = norm(cross(sub(f.pts[1], f.pts[0]), sub(f.pts[2], f.pts[0])));
      const fc = mul(f.pts.reduce((s, p) => add(s, p), [0, 0, 0]), 1 / f.pts.length);
      if (dot(n, sub(fc, f.center)) < 0) n = mul(n, -1);   // make the normal point outwards
      if (dot(n, fc) >= 0) continue;                        // back face
      if (f.pts.some((p) => p[2] < NEAR)) continue;         // behind the near plane
      vis.push({ f, n, z: fc[2] });
    }
    vis.sort((a, b) => b.z - a.z);
    for (const { f, n } of vis) {
      const pts = f.pts.map(project);
      const lit = f.emit ? 1 : 0.34 + 0.8 * Math.max(0, dot(n, LIGHT)) + 0.12 * Math.max(0, -n[2]);
      g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
      g.closePath();
      if (f.tex) {
        const tw = f.tex.width, th = f.tex.height;
        texTri(g, f.tex, pts[0], pts[1], pts[2], [0, 0], [tw, 0], [tw, th]);
        texTri(g, f.tex, pts[0], pts[2], pts[3], [0, 0], [tw, th], [0, th]);
        if (!f.emit) {
          g.fillStyle = lit < 1 ? `rgba(0,0,0,${Math.min(0.8, 1 - lit)})` : `rgba(255,255,255,${Math.min(0.3, lit - 1)})`;
          g.fill();
        }
      } else {
        const k = Math.min(1.25, lit);
        g.fillStyle = `rgb(${Math.min(255, f.col[0] * k) | 0},${Math.min(255, f.col[1] * k) | 0},${Math.min(255, f.col[2] * k) | 0})`;
        g.fill();
        // thin darker seam keeps small parts readable
        g.strokeStyle = 'rgba(0,0,0,0.18)'; g.lineWidth = PIXEL ? 0.5 : 0.35; g.stroke();
      }
    }
    return finalize(c);
  }

  // RETRO pixel-art pass: binary alpha, light posterization, dark outline. MODERN keeps
  // the anti-aliased edges and full color depth. Then crop to the opaque area.
  function finalize(c) {
    const g = c.getContext('2d');
    const w = c.width, h = c.height;
    const id = g.getImageData(0, 0, w, h), d = id.data;
    const a = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
      if (!PIXEL) { if (d[i * 4 + 3] > 0) a[i] = 1; continue; }
      if (d[i * 4 + 3] < 120) { d[i * 4 + 3] = 0; continue; }
      a[i] = 1; d[i * 4 + 3] = 255;
      for (let k = 0; k < 3; k++) d[i * 4 + k] = Math.min(255, Math.round(d[i * 4 + k] / 10) * 10);
    }
    let x0 = w, y0 = h, x1 = 0, y1 = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (a[i]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; continue; }
      if (PIXEL && ((x > 0 && a[i - 1]) || (x < w - 1 && a[i + 1]) || (y > 0 && a[i - w]) || (y < h - 1 && a[i + w]))) {
        d[i * 4] = 12; d[i * 4 + 1] = 10; d[i * 4 + 2] = 10; d[i * 4 + 3] = 255;
      }
    }
    g.putImageData(id, 0, 0);
    x0 = Math.max(0, x0 - 1); y0 = Math.max(0, y0 - 1); x1 = Math.min(w - 1, x1 + 1); y1 = Math.min(h - 1, y1 + 1);
    const out = document.createElement('canvas');
    out.width = x1 - x0 + 1; out.height = y1 - y0 + 1;
    out.getContext('2d').drawImage(c, -x0, -y0);
    return { c: out, x: x0 / S, y: y0 / S, w: out.width / S, h: out.height / S };
  }

  /* -------------------------------------------------------------- textures */
  function tex(w, h, draw) {
    const c = document.createElement('canvas');
    c.width = w * 4; c.height = h * 4;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.scale(4, 4);
    draw(g, w, h);
    return c;
  }

  /* ------------------------------------------------------------ materials */
  const C = {
    skin: [214, 160, 118], glove: [34, 34, 38], shirt: [106, 58, 168], vest: [30, 30, 34],
    steel: [150, 158, 168], dark: [52, 56, 62], black: [24, 26, 30], orange: [232, 116, 26],
    wood: [120, 82, 44], olive: [74, 92, 50], yellow: [232, 194, 26], purple: [96, 70, 210],
    silver: [200, 206, 212], blue: [31, 88, 214], cyan: [60, 200, 255], green: [61, 255, 106],
  };

  // Arm coming from a bottom corner of the screen, ending with a fingerless glove at `hand`.
  function arm(side, hand, o = {}) {
    const sh = side > 0 ? [0.3, 0.5, 0.16] : [-0.28, 0.5, 0.16];
    const elbow = o.elbow || (side > 0 ? [0.26, 0.36, 0.24] : [-0.22, 0.36, 0.26]);
    const wrist = add(hand, mul(norm(sub(elbow, hand)), 0.045));
    const out = [
      ...tube(sh, elbow, 0.085, 0.075, C.shirt, { sides: 10 }),
      ...tube(elbow, wrist, 0.052, 0.04, C.skin, { sides: 10 }),
      ...box(hand, [0.04, 0.036, 0.046], C.glove, { yaw: o.yaw || 0, pitch: o.pitch || 0, roll: o.roll || 0 }),
    ];
    // bare finger tips sticking out of the fingerless glove
    const B = basis(o.yaw || 0, o.pitch || 0, o.roll || 0);
    for (let k = 0; k < 3; k++) {
      const p = add(hand, add(add(mul(B.u, (k - 1) * 0.024 * -side), mul(B.v, -0.03)), mul(B.w, 0.03)));
      out.push(...box(p, [0.01, 0.009, 0.014], C.skin, { yaw: o.yaw || 0, pitch: o.pitch || 0 }));
    }
    return out;
  }

  /* ---------------------------------------------------------------- models */
  function keyboard() {
    const keys = tex(56, 20, (g, w, h) => {
      g.fillStyle = '#1b1d22'; g.fillRect(0, 0, w, h);
      for (let r = 0; r < 4; r++) for (let k = 0; k < 14; k++) {
        g.fillStyle = (k + r * 3) % 11 === 0 ? '#e8741a' : '#d9dde2';
        g.fillRect(1.5 + k * 3.8 + (r % 2), 1.5 + r * 4.3, 3, 3.2);
        g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(1.5 + k * 3.8 + (r % 2), 4.2 + r * 4.3, 3, 0.5);
      }
      const gr = g.createLinearGradient(0, 0, w, 0);
      ['#ff3060', '#ffb000', '#3dff6a', '#20b8ff', '#b050ff'].forEach((c, i) => gr.addColorStop(i / 4, c));
      g.fillStyle = gr; g.fillRect(0, h - 1.2, w, 1.2);
    });
    return [
      ...box([0.06, 0.2, 0.38], [0.2, 0.016, 0.075], C.black, { yaw: -0.35, roll: -0.25, tex: { top: keys } }),
      ...arm(1, [0.22, 0.24, 0.34], { yaw: -0.3, roll: -0.25 }),
    ];
  }

  function nutPistol(loaded) {
    const side = tex(24, 8, (g, w, h) => {
      g.fillStyle = '#e8741a'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#111'; g.font = 'bold 4px monospace'; g.fillText('M6', 2, 6);
      g.fillStyle = '#ffb05a'; g.fillRect(0, 0, w, 1);
    });
    const out = [
      ...box([0.13, 0.125, 0.47], [0.028, 0.022, 0.12], C.orange, { tex: { left: side } }),
      ...box([0.13, 0.165, 0.46], [0.026, 0.02, 0.1], C.black),
      ...tube([0.13, 0.13, 0.59], [0.13, 0.13, 0.66], 0.012, 0.012, C.dark, { frontCol: [10, 10, 10] }),
      ...box([0.13, 0.22, 0.4], [0.02, 0.055, 0.026], C.black, { pitch: 0.35 }),
      // tubular magazine of cage nuts on the left side
      ...tube([0.095, 0.11, 0.36], [0.095, 0.11, 0.57], 0.015, 0.015, C.steel, { sides: 8 }),
    ];
    for (let k = 0; k < 5; k++) out.push(...box([0.079, 0.11, 0.39 + k * 0.04], [0.004, 0.011, 0.011], C.silver));
    if (loaded) out.push(...box([0.13, 0.13, 0.672], [0.014, 0.014, 0.005], C.silver, { emitFaces: ['back'] }));
    out.push(...arm(1, [0.14, 0.25, 0.4], { pitch: 0.3 }));
    return { faces: out, muzzle: [0.13, 0.13, 0.68] };
  }

  function shotgun(pump) {
    const zf = pump ? -0.07 : 0;
    const out = [
      ...box([0.11, 0.17, 0.33], [0.045, 0.03, 0.08], C.dark),
      ...tube([0.09, 0.135, 0.3], [0.09, 0.135, 0.82], 0.016, 0.016, C.steel, { frontCol: [8, 8, 8] }),
      ...tube([0.13, 0.135, 0.3], [0.13, 0.135, 0.82], 0.016, 0.016, C.steel, { frontCol: [8, 8, 8] }),
      ...box([0.11, 0.118, 0.56], [0.006, 0.004, 0.26], C.dark),
      ...box([0.11, 0.165, 0.58 + zf], [0.05, 0.022, 0.08], C.wood),
      ...box([0.12, 0.23, 0.3], [0.024, 0.06, 0.03], C.wood, { pitch: 0.4 }),
      ...arm(1, [0.13, 0.27, 0.3], { pitch: 0.35 }),
      ...arm(-1, [0.1, 0.2, 0.58 + zf], { roll: 0.2, elbow: [-0.2, 0.42, 0.34] }),
    ];
    return { faces: out, muzzle: [0.11, 0.135, 0.83] };
  }

  function gatling(spin) {
    const out = [
      ...box([0.1, 0.18, 0.38], [0.065, 0.05, 0.11], C.dark),
      ...box([0.1, 0.18, 0.5], [0.056, 0.044, 0.012], C.orange),
      // hopper full of cage nuts
      ...box([0.155, 0.125, 0.4], [0.02, 0.018, 0.045], C.wood),
    ];
    for (let k = 0; k < 6; k++) out.push(...box([0.146 + (k % 2) * 0.018, 0.105, 0.37 + Math.floor(k / 2) * 0.028], [0.006, 0.003, 0.006], C.silver));
    for (let k = 0; k < 6; k++) {
      const a = spin + k / 6 * Math.PI * 2;
      const ox = Math.cos(a) * 0.028, oy = Math.sin(a) * 0.028;
      out.push(...tube([0.1 + ox, 0.14 + oy, 0.48], [0.1 + ox, 0.14 + oy, 0.86], 0.009, 0.009, C.steel, { sides: 6, frontCol: [10, 10, 10] }));
    }
    out.push(...tube([0.1, 0.14, 0.62], [0.1, 0.14, 0.65], 0.045, 0.045, C.orange, { sides: 12 }));
    out.push(...tube([0.1, 0.14, 0.82], [0.1, 0.14, 0.84], 0.043, 0.043, C.dark, { sides: 12 }));
    out.push(...arm(1, [0.12, 0.27, 0.36], { pitch: 0.3 }), ...arm(-1, [0.04, 0.12, 0.46], { elbow: [-0.2, 0.36, 0.3] }));
    return { faces: out, muzzle: [0.1, 0.14, 0.87] };
  }

  function bazooka(loaded) {
    const band = tex(16, 4, (g, w, h) => { g.fillStyle = '#e8c21a'; g.fillRect(0, 0, w, h); g.fillStyle = '#111'; for (let x = -4; x < w; x += 3) { g.beginPath(); g.moveTo(x, h); g.lineTo(x + 1.5, h); g.lineTo(x + 3.5, 0); g.lineTo(x + 2, 0); g.fill(); } });
    const out = [
      ...tube([0.2, 0.095, 0.12], [0.2, 0.075, 0.95], 0.075, 0.075, C.olive, { sides: 16, frontCol: [14, 16, 12] }),
      ...tube([0.2, 0.093, 0.25], [0.2, 0.09, 0.3], 0.081, 0.081, [58, 72, 40], { sides: 16 }),
      ...tube([0.2, 0.078, 0.85], [0.2, 0.077, 0.95], 0.083, 0.083, [58, 72, 40], { sides: 16, frontCol: [10, 10, 10] }),
      ...box([0.13, 0.03, 0.45], [0.014, 0.02, 0.05], C.black),
      ...box([0.2, 0.2, 0.42], [0.02, 0.05, 0.025], C.black, { pitch: 0.3 }),
      ...box([0.2, 0.012, 0.6], [0.045, 0.003, 0.03], C.yellow, { tex: { top: band } }),
      ...arm(1, [0.2, 0.26, 0.42], { pitch: 0.3 }),
    ];
    if (loaded) {
      out.push(...box([0.2, 0.077, 0.97], [0.022, 0.014, 0.04], C.silver));
      out.push(...box([0.2, 0.06, 0.95], [0.02, 0.004, 0.02], C.blue));
    }
    return { faces: out, muzzle: [0.2, 0.077, 0.98] };
  }

  function hardDrive(holding) {
    const label = tex(20, 28, (g, w, h) => {
      g.fillStyle = '#9aa1a8'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#c9ced4'; g.fillRect(0, 0, w, 1);
      g.fillStyle = '#b4bac1'; g.beginPath(); g.arc(w / 2, 11, 7, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#5a6068'; g.beginPath(); g.arc(w / 2, 11, 2, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#fff'; g.fillRect(3, 19, 14, 7); g.fillStyle = '#c21d1d'; g.fillRect(3, 19, 14, 2);
      g.fillStyle = '#111'; g.font = 'bold 3px monospace'; g.fillText('4 TB', 5, 25);
    });
    if (!holding) return { faces: arm(1, [0.12, 0.08, 0.6], { pitch: -0.5, elbow: [0.26, 0.3, 0.36] }), muzzle: [0.12, 0.05, 0.62] };
    return {
      faces: [
        ...box([0.14, 0.15, 0.36], [0.055, 0.013, 0.075], C.steel, { yaw: -0.2, pitch: -0.35, tex: { top: label } }),
        ...arm(1, [0.18, 0.2, 0.32], { yaw: -0.2, pitch: -0.3 }),
      ],
      muzzle: [0.14, 0.14, 0.4],
    };
  }

  function zipCompressor() {
    const zipper = tex(6, 40, (g, w, h) => {
      g.fillStyle = '#e8c21a'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#8a7a2a'; for (let y = 1; y < h; y += 2) g.fillRect(1, y, w - 2, 0.8);
    });
    const screen = tex(16, 10, (g, w, h) => {
      g.fillStyle = '#062a10'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#3dff6a'; g.font = 'bold 4px monospace'; g.fillText('.ZIP', 2, 6);
      g.fillRect(2, 7.5, 9, 1);
    });
    const out = [
      ...box([0.1, 0.18, 0.46], [0.05, 0.045, 0.16], C.purple),
      ...box([0.1, 0.133, 0.46], [0.012, 0.002, 0.15], C.yellow, { tex: { top: zipper } }),
      ...box([0.048, 0.17, 0.42], [0.002, 0.026, 0.05], [10, 40, 16], { tex: { right: screen, left: screen }, emit: true }),
      ...tube([0.1, 0.17, 0.62], [0.1, 0.165, 0.72], 0.032, 0.02, C.dark, { frontCol: [182, 164, 255], capEmit: true }),
      ...arm(1, [0.15, 0.27, 0.4], { pitch: 0.3 }), ...arm(-1, [0.03, 0.2, 0.5], { elbow: [-0.2, 0.4, 0.32] }),
    ];
    return { faces: out, muzzle: [0.1, 0.165, 0.74] };
  }

  function plasma() {
    const out = [
      ...box([0.1, 0.19, 0.46], [0.05, 0.05, 0.16], [36, 40, 46]),
      ...box([0.1, 0.138, 0.46], [0.03, 0.004, 0.12], [70, 76, 86]),
      ...tube([0.1, 0.15, 0.3], [0.1, 0.15, 0.78], 0.02, 0.02, C.dark, { frontCol: [60, 200, 255], capEmit: true }),
    ];
    for (let k = 0; k < 4; k++) out.push(...tube([0.1, 0.15, 0.52 + k * 0.06], [0.1, 0.15, 0.545 + k * 0.06], 0.04, 0.04, C.cyan, { emit: true }));
    out.push(...arm(1, [0.14, 0.28, 0.42], { pitch: 0.3 }), ...arm(-1, [0.03, 0.22, 0.48], { elbow: [-0.2, 0.42, 0.32] }));
    return { faces: out, muzzle: [0.1, 0.15, 0.8] };
  }

  // Framing of each weapon on screen: focal length and 2D offset of the vanishing point.
  const VIEWS = {
    keyboard: { f: 300, ox: 0, oy: -95, shift: [0, 0.08, 0.06] },
    pistol: { f: 380, ox: -40, oy: -100, shift: [0, 0.1, 0] },
    shotgun: { f: 380, ox: -45, oy: -95, shift: [0, 0.1, 0] },
    gatling: { f: 380, ox: -50, oy: -95, shift: [0, 0.1, 0] },
    bazooka: { f: 360, ox: -20, oy: -40, shift: [0, 0.06, 0] },
    hdd: { f: 300, ox: -40, oy: -165, shift: [0, 0.1, 0.04] },
    zip: { f: 380, ox: -45, oy: -100, shift: [0, 0.1, 0.06] },
    plasma: { f: 380, ox: -45, oy: -100, shift: [0, 0.1, 0.06] },
  };




  /* ----------------------------------------------------------- build all */
  // opts: {pixel: true} for the RETRO look (2 texels per pixel), {pixel: false} for MODERN (4).
  function build(opts = { pixel: true }) {
    PIXEL = opts.pixel; S = PIXEL ? 2 : 4;
    const make = (m, v) => { view = Object.assign({ f: 340, ox: 0, oy: 0 }, v); const r = render(m.faces || m); r.muzzle = m.muzzle ? project(place(m.muzzle)) : null; return r; };
    return {
      keyboard: make(keyboard(), VIEWS.keyboard),
      pistol: [make(nutPistol(true), VIEWS.pistol), make(nutPistol(false), VIEWS.pistol)],
      shotgun: [make(shotgun(false), VIEWS.shotgun), make(shotgun(true), VIEWS.shotgun)],
      gatling: [0, 1, 2, 3].map((i) => make(gatling(i / 4 * Math.PI / 3), VIEWS.gatling)),
      bazooka: [make(bazooka(true), VIEWS.bazooka), make(bazooka(false), VIEWS.bazooka)],
      hdd: [make(hardDrive(true), VIEWS.hdd), make(hardDrive(false), VIEWS.hdd)],
      zip: make(zipCompressor(), VIEWS.zip),
      plasma: make(plasma(), VIEWS.plasma),
    };
  }

  return { build };
})();
