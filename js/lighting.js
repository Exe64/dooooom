'use strict';
/*
 * Lighting and post-processing for the software renderer.
 *
 * Light: an RGB lightmap with LG x LG texels per map cell, packed like the
 * pixels (little-endian ABGR: R in the low byte), where 128 means 1.0 and 255
 * about 2.0 (overbright pools under the ceiling panels). The static part is
 * baked once per level: episode ambient, ceiling light panels with shadows,
 * colored glow from exit signs, doors, CRAC units and branded racks, and
 * ambient occlusion along the walls. Every frame, dynamic lights (muzzle
 * flash, projectiles, explosions, armed UPS) are added on top of a copy.
 *
 * Post: a cheap bloom (bright pass of the emissive pixels at 1/4 resolution, box
 * blurred, upscaled and added back into the frame buffer). The vignette is a CSS layer
 * (index.html). Both, and the dynamic lights, are skipped in LOW quality.
 */

const LG = 4;

// Per-episode mood: ambient tint, ceiling panel color, distance fog color (0-255).
const LIGHT_MOODS = [
  { amb: [0.66, 0.68, 0.72], lamp: [0.95, 0.97, 1.05], fog: [18, 22, 30] },   // clean rooms: neutral white
  { amb: [0.56, 0.66, 0.80], lamp: [0.80, 0.95, 1.20], fog: [8, 26, 46] },    // cooling zone: icy blue
  { amb: [0.58, 0.68, 0.62], lamp: [0.95, 1.05, 0.90], fog: [6, 26, 18] },    // network core: green tinge
  { amb: [0.56, 0.50, 0.64], lamp: [1.25, 0.90, 0.60], fog: [18, 10, 28] },   // cold archives: sodium lamps, purple dark
  { amb: [0.70, 0.64, 0.58], lamp: [1.10, 1.00, 0.85], fog: [32, 20, 12] },   // hyperscale: warm haze
];

// Wall tiles that cast colored light on the floor in front of them: [r, g, b, strength].
const WALL_GLOW = {
  X: [0.3, 1.0, 0.4, 0.9], C: [0.4, 0.75, 1.0, 0.35], W: [1.0, 0.75, 0.2, 0.2],
  1: [1.0, 0.2, 0.15, 0.55], 2: [0.25, 0.45, 1.0, 0.55],
  R: [0.3, 1.0, 0.5, 0.14], S: [0.3, 0.7, 1.0, 0.14], N: [0.4, 1.0, 0.6, 0.18],
  3: [0.3, 0.6, 1.0, 0.4], 4: [1.0, 0.55, 0.15, 0.4], 5: [0.3, 0.8, 1.0, 0.4], 6: [0.3, 0.6, 1.0, 0.4], 7: [0.55, 0.4, 1.0, 0.45],
};

// Dynamic light colors by projectile / effect kind: [r, g, b, strength, radius].
const PROJ_LIGHT = {
  orb: [1.0, 0.25, 0.85, 0.7, 2.2], bolt: [1.0, 0.75, 0.2, 0.7, 2.2], boss: [0.75, 0.3, 1.0, 1.0, 3],
  plasma: [0.4, 0.8, 1.0, 0.9, 2.6], zip: [0.7, 0.6, 1.0, 0.7, 2.2], miner: [1.0, 0.85, 0.2, 1.0, 3],
  botnet: [0.5, 1.0, 0.55, 1.0, 3], zeroday: [0.6, 1.0, 1.0, 1.0, 3], fire: [1.0, 0.45, 0.1, 1.0, 2.8],
  rot: [0.75, 1.0, 0.4, 0.8, 2.6], sfp: [1.0, 0.55, 0.15, 0.8, 2.6],
};
const FX_LIGHT = {
  spark: [1.0, 0.8, 0.4, 0.5, 1.6], bigBoom: [1.0, 0.6, 0.25, 1.4, 6], boom: [1.0, 0.55, 0.2, 0.9, 3.5],
  nutanix: [0.6, 0.45, 1.0, 1.2, 3.5], plasmaHit: [0.45, 0.8, 1.0, 1.0, 3],
};

const Light = {
  high: true,
  w: 0, h: 0,
  map: null,       // what the renderer samples (static, or static + dynamic)
  base: null,      // baked static light
  fog: [0, 0, 0],
  dirty: false,    // true when map holds dynamic lights
  vis: null,       // per-cell visibility scratch for dynamic lights
  r: null, g: null, b: null, // float scratch for dynamic accumulation

  // Is this cell opaque for the static bake? Doors count as open so that
  // their frames and the rooms behind them get lit.
  _solid(L, cx, cy) {
    if (cx < 0 || cy < 0 || cx >= L.w || cy >= L.h) return true;
    const i = cy * L.w + cx;
    if (!L.map[i]) return false;
    const d = L.doors[i];
    return !d || d.secret;
  },

  _los(L, x0, y0, x1, y1) {
    const dx = x1 - x0, dy = y1 - y0, n = Math.ceil(Math.hypot(dx, dy) / 0.2);
    for (let k = 1; k < n; k++) {
      const t = k / n;
      if (this._solid(L, (x0 + dx * t) | 0, (y0 + dy * t) | 0)) return false;
    }
    return true;
  },

  bake(L) {
    const lw = L.w * LG, lh = L.h * LG, n = lw * lh;
    const mood = LIGHT_MOODS[L.def.episode % LIGHT_MOODS.length];
    const amb = L.def.ambient;
    const R = new Float32Array(n).fill(mood.amb[0] * amb);
    const G = new Float32Array(n).fill(mood.amb[1] * amb);
    const B = new Float32Array(n).fill(mood.amb[2] * amb);
    const self = this;
    // Point light with smooth falloff and per-texel shadow test.
    function point(x, y, rad, cr, cg, cb, k) {
      const sx0 = Math.max(0, Math.floor((x - rad) * LG)), sx1 = Math.min(lw - 1, Math.ceil((x + rad) * LG));
      const sy0 = Math.max(0, Math.floor((y - rad) * LG)), sy1 = Math.min(lh - 1, Math.ceil((y + rad) * LG));
      const r2 = rad * rad;
      for (let sy = sy0; sy <= sy1; sy++) {
        const py = (sy + 0.5) / LG;
        for (let sx = sx0; sx <= sx1; sx++) {
          const px = (sx + 0.5) / LG;
          const d2 = (px - x) * (px - x) + (py - y) * (py - y);
          if (d2 >= r2) continue;
          if (self._solid(L, px | 0, py | 0) || !self._los(L, x, y, px, py)) continue;
          const f = 1 - d2 / r2, a = f * f * k, i = sy * lw + sx;
          R[i] += cr * a; G[i] += cg * a; B[i] += cb * a;
        }
      }
    }
    for (let y = 0; y < L.h; y++) for (let x = 0; x < L.w; x++) {
      const i = y * L.w + x;
      if (L.map[i]) continue;
      if (L.ceil[i] === 1) point(x + 0.5, y + 0.5, 3.4, mood.lamp[0], mood.lamp[1], mood.lamp[2], 0.5);
      // glowing walls light the cell in front of their face
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const t = L.map[(y + dy) * L.w + x + dx];
        const gl = t && WALL_GLOW[String.fromCharCode(t)];
        if (gl) point(x + 0.5 + dx * 0.3, y + 0.5 + dy * 0.3, 1.9, gl[0], gl[1], gl[2], gl[3]);
      }
    }
    // ambient occlusion: darken texels close to solid neighbors
    for (let sy = 0; sy < lh; sy++) for (let sx = 0; sx < lw; sx++) {
      const px = (sx + 0.5) / LG, py = (sy + 0.5) / LG, cx = px | 0, cy = py | 0;
      const i = sy * lw + sx;
      let ao = 1;
      if (this._solid(L, cx, cy)) ao = 0.5;
      else {
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if ((!dx && !dy) || !this._solid(L, cx + dx, cy + dy)) continue;
          const ex = dx < 0 ? px - cx : dx > 0 ? cx + 1 - px : 0;
          const ey = dy < 0 ? py - cy : dy > 0 ? cy + 1 - py : 0;
          const dist = Math.hypot(ex, ey);
          const a = 0.62 + 0.38 * Math.min(1, dist / 0.55);
          if (a < ao) ao = a;
        }
      }
      R[i] *= ao; G[i] *= ao; B[i] *= ao;
    }
    const base = new Uint32Array(n);
    const q = (v) => { v = Math.round(v * 128); return v > 255 ? 255 : v < 0 ? 0 : v; };
    for (let i = 0; i < n; i++) base[i] = (q(B[i]) << 16) | (q(G[i]) << 8) | q(R[i]);
    this.w = lw; this.h = lh;
    this.base = base;
    this.map = new Uint32Array(base);
    this.r = new Float32Array(0);
    this.vis = new Int8Array(L.w * L.h);
    this.fog = mood.fog;
    this.dirty = false;
  },

  // Adds the frame's dynamic lights on top of the baked lightmap.
  update(L, P) {
    if (!this.base) return;
    const lights = [];
    if (this.high) {
      if (P.flashT > 0 && !P.dead) {
        const c = INV && INV.cur === 7 ? [0.4, 0.8, 1.0] : INV && INV.cur === 6 ? [0.7, 0.6, 1.0] : [1.0, 0.75, 0.4];
        lights.push([P.x + Math.cos(P.a) * 0.4, P.y + Math.sin(P.a) * 0.4, 5, c[0], c[1], c[2], 0.8]);
      }
      for (const p of L.proj) {
        const d = PROJ_LIGHT[p.kind];
        if (d) lights.push([p.x, p.y, d[4], d[0], d[1], d[2], d[3]]);
      }
      for (const f of L.fx) {
        const d = FX_LIGHT[f.kind];
        if (!d) continue;
        const k = 1 - f.t / f.dur;
        lights.push([f.x, f.y, d[4], d[0], d[1], d[2], d[3] * k]);
      }
      for (const b of L.barrels) {
        if (!b.dead && b.fuse >= 0) lights.push([b.x, b.y, 2.5, 1.0, 0.15, 0.1, 0.6 + 0.4 * Math.sin(performance.now() / 50)]);
      }
    }
    if (!lights.length) {
      if (this.dirty) { this.map.set(this.base); this.dirty = false; }
      return;
    }
    this.map.set(this.base);
    this.dirty = true;
    for (const l of lights) this._add(L, l[0], l[1], l[2], l[3] * l[6], l[4] * l[6], l[5] * l[6]);
  },

  _add(L, x, y, rad, cr, cg, cb) {
    const lw = this.w, map = this.map;
    const cx0 = Math.max(0, Math.floor(x - rad)), cx1 = Math.min(L.w - 1, Math.floor(x + rad));
    const cy0 = Math.max(0, Math.floor(y - rad)), cy1 = Math.min(L.h - 1, Math.floor(y + rad));
    const r2 = rad * rad;
    // light reaches a cell when its center is in sight of the source
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
      const i = cy * L.w + cx, ccx = cx + 0.5, ccy = cy + 0.5;
      if (L.map[i] && !(L.doors[i] && L.doors[i].open > 0.5)) continue;
      const d2 = (ccx - x) * (ccx - x) + (ccy - y) * (ccy - y);
      if (d2 > (rad + 0.8) * (rad + 0.8)) continue;
      if ((x | 0) !== cx || (y | 0) !== cy) {
        const d = Math.sqrt(d2);
        castRay(x, y, (ccx - x) / d, (ccy - y) / d);
        if (RH.d < d - 0.5) continue;
      }
      const R = cr * 128, G = cg * 128, B = cb * 128;
      for (let sy = cy * LG; sy < cy * LG + LG; sy++) {
        const py = (sy + 0.5) / LG - y;
        for (let sx = cx * LG; sx < cx * LG + LG; sx++) {
          const px = (sx + 0.5) / LG - x, q = px * px + py * py;
          if (q >= r2) continue;
          const f = 1 - q / r2, a = f * f;
          const j = sy * lw + sx, v = map[j];
          let r = (v & 255) + R * a, g = ((v >> 8) & 255) + G * a, b = ((v >> 16) & 255) + B * a;
          if (r > 255) r = 255; if (g > 255) g = 255; if (b > 255) b = 255;
          map[j] = ((b | 0) << 16) | ((g | 0) << 8) | (r | 0);
        }
      }
    }
  },

  // Bilinear sample at world position, packed.
  sample(x, y) {
    const map = this.map, lw = this.w;
    let lx = x * LG - 0.5, ly = y * LG - 0.5;
    if (lx < 0) lx = 0; if (ly < 0) ly = 0;
    if (lx > lw - 2) lx = lw - 2; if (ly > this.h - 2) ly = this.h - 2;
    const ix = lx | 0, iy = ly | 0, i = iy * lw + ix;
    const tx = ((lx - ix) * 256) | 0, ty = ((ly - iy) * 256) | 0;
    return lerpPx(lerpPx(map[i], map[i + 1], tx), lerpPx(map[i + lw], map[i + lw + 1], tx), ty);
  },
};

// Lerps two packed RGB values, t in 0..256.
function lerpPx(a, b, t) {
  const u = 256 - t;
  return ((((a & 0xff00ff) * u + (b & 0xff00ff) * t) >>> 8) & 0xff00ff) |
         ((((a & 0xff00) * u + (b & 0xff00) * t) >>> 8) & 0xff00);
}

/* ------------------------------------------------------- post-processing */

const Post = {
  bw: 0, bh: 0,
  acc: null, tmp: null, row: null, nz: null, xi: null, xf: null,

  init(w, h) {
    this.bw = w >> 2; this.bh = Math.ceil(h / 4);
    this.acc = new Float32Array(this.bw * this.bh * 3);
    this.tmp = new Float32Array(this.bw * this.bh * 3);
    this.row = new Float32Array((this.bw + 1) * 3);
    this.nz = new Uint8Array(this.bw);
    // horizontal upscale taps (index into row, weight)
    this.xi = new Int32Array(w); this.xf = new Float32Array(w);
    for (let x = 0; x < w; x++) {
      let sx = (x + 0.5) / 4 - 0.5;
      if (sx < 0) sx = 0;
      let ix = sx | 0;
      if (ix >= this.bw - 1) { ix = this.bw - 1; sx = ix; }
      this.xi[x] = ix * 3; this.xf[x] = sx - ix;
    }
  },

  // Bright pass over emissive pixels (glow mask) + blur, from the frame buffer (w x h, packed ABGR).
  bloom(buf, glow, w, h) {
    const bw = this.bw, bh = this.bh, acc = this.acc, tmp = this.tmp;
    const TH = 110, K = 1 / (4 * (255 - TH));
    let any = false;
    for (let by = 0; by < bh; by++) {
      for (let bx = 0; bx < bw; bx++) {
        let r = 0, g = 0, b = 0;
        for (let k = 0; k < 4; k++) {
          const y = by * 4 + (k >> 1) * 2 + 1, x = bx * 4 + (k & 1) * 2 + 1;
          if (y >= h) continue;
          const j = y * w + x;
          if (!glow[j]) continue;
          const c = buf[j];
          const cr = c & 255, cg = (c >> 8) & 255, cb = (c >> 16) & 255;
          const m = cr > cg ? (cr > cb ? cr : cb) : (cg > cb ? cg : cb);
          if (m <= TH) continue;
          const s = (m - TH) * K;
          r += cr * s; g += cg * s; b += cb * s;
        }
        const o = (by * bw + bx) * 3;
        acc[o] = r; acc[o + 1] = g; acc[o + 2] = b;
        if (r + g + b > 0) any = true;
      }
    }
    if (!any) return;
    this._blur(acc, tmp, bw, bh, 1, bw); this._blur(tmp, acc, bh, bw, bw, 1);
    this._blur(acc, tmp, bw, bh, 1, bw); this._blur(tmp, acc, bh, bw, bw, 1);
    this._composite(buf, w, h);
  },

  // Adds the blurred bright pass back onto the frame, upscaled bilinearly
  // (one vertical lerp per row, then two taps per pixel). Done on the CPU so
  // that machines without GPU canvas acceleration don't pay for a full-screen blend.
  _composite(buf, w, h) {
    const bw = this.bw, bh = this.bh, acc = this.acc, row = this.row, nz = this.nz, xi = this.xi, xf = this.xf;
    const GAIN = 1.6;
    for (let y = 0; y < h; y++) {
      let sy = (y + 0.5) / 4 - 0.5;
      if (sy < 0) sy = 0;
      let iy = sy | 0, fy = sy - iy;
      if (iy >= bh - 1) { iy = bh - 1; fy = 0; }
      const o0 = iy * bw * 3, o1 = Math.min(bh - 1, iy + 1) * bw * 3;
      let any = false;
      for (let bx = 0; bx < bw; bx++) {
        let lit = 0;
        for (let c = 0; c < 3; c++) {
          const k = bx * 3 + c, v = (acc[o0 + k] + (acc[o1 + k] - acc[o0 + k]) * fy) * GAIN;
          row[k] = v;
          if (v >= 1) lit = 1;
        }
        nz[bx] = lit;
        if (lit) any = true;
      }
      if (!any) continue;
      const ro = y * w;
      // 4 output pixels per bright-pass texel; skip blocks whose taps are all dark
      for (let bx = 0; bx < bw; bx++) {
        if (!nz[bx] && !(bx > 0 && nz[bx - 1]) && !(bx < bw - 1 && nz[bx + 1])) continue;
        for (let x = bx * 4; x < bx * 4 + 4; x++) {
          const a = xi[x], t = xf[x];
          const r = row[a] + (row[a + 3] - row[a]) * t;
          const g = row[a + 1] + (row[a + 4] - row[a + 1]) * t;
          const b = row[a + 2] + (row[a + 5] - row[a + 2]) * t;
          if (r + g + b < 3) continue;
          const c = buf[ro + x];
          let cr = (c & 255) + r, cg = ((c >> 8) & 255) + g, cb = ((c >> 16) & 255) + b;
          if (cr > 255) cr = 255; if (cg > 255) cg = 255; if (cb > 255) cb = 255;
          buf[ro + x] = 0xff000000 | (cb << 16) | (cg << 8) | cr;
        }
      }
    }
  },

  // Box blur (radius 2) along one axis: n samples per line, lines lines;
  // step is the stride between samples, lstride between lines (in pixels).
  _blur(src, dst, n, lines, step, lstride) {
    const R = 2, inv = 1 / (2 * R + 1);
    for (let l = 0; l < lines; l++) {
      const base = l * lstride;
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        for (let k = -R; k <= R; k++) sum += src[(base + Math.min(n - 1, Math.max(0, k)) * step) * 3 + c];
        for (let i = 0; i < n; i++) {
          dst[(base + i * step) * 3 + c] = sum * inv;
          const a = Math.min(n - 1, i + R + 1), b = Math.max(0, i - R);
          sum += src[(base + a * step) * 3 + c] - src[(base + b * step) * 3 + c];
        }
      }
    }
  },
};
