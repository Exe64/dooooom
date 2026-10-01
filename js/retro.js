'use strict';
/*
 * RETRO style: a renderer that follows Doom's own limits.
 *
 * - 320x200 frame (VGA Mode 13h): a 320x168 3D view over a 32 pixel status bar.
 *   It is shown at 4:3, so its pixels are 1.2 times taller than wide; the vertical
 *   projection is divided by 1.2 so that the world keeps its proportions once stretched.
 * - One fixed 256 color palette made of strict ramps (like PLAYPAL). Every texture and
 *   sprite is quantized to it once; the frame is an array of palette indices.
 *   Flashes swap the whole palette for a pre-tinted copy: red when hurt, gold on
 *   pickups, green under TURBO (Doom's radiation suit palette).
 * - No 3D lights: every map cell gets a brightness from 0 to 255 (Doom's sector light,
 *   taken from the baked lightmap in steps of 16), and a 32 level COLORMAP darkens
 *   colors with distance down to near black, which makes the natural fog.
 *   Walls facing east-west get Doom's fake contrast; emissive texels stay full bright.
 * - Walls are 128 texel patches, floors and ceilings 64x64 flats.
 * - Sprites are strict billboards; monsters have 8 rotations; the weapon is drawn
 *   at the bottom center and swings when walking. No vertical look.
 * - The game logic and the frame run at 35 Hz (Doom tics).
 */
const Retro = (() => {
  const SW = 320, SH = 200, VHR = 168, HZ = VHR / 2, ASPECT = 1.2;
  const PLANE_R = 1.0;                           // 90 degree field of view
  const PROJX = (SW / 2) / PLANE_R, PROJY = PROJX / ASPECT;
  const LIGHTK = 10;                             // COLORMAP levels lost at distance 1 (Doom's scale lights)
  const WT = 128, FT = 64;                       // wall patch and flat sizes

  /* ------------------------------------------------------------- palette */
  const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  // 15 ramps of 16 shades (dark, middle at shade 10, light) plus 16 fixed brand and LED colors.
  const RAMPS = [
    [[0, 0, 0], [150, 150, 150], [255, 255, 255]],       // gray
    [[6, 8, 12], [96, 106, 120], [210, 220, 235]],       // steel (racks, metal)
    [[10, 9, 7], [122, 114, 100], [236, 228, 210]],      // concrete
    [[20, 0, 0], [200, 30, 20], [255, 170, 150]],        // red
    [[24, 8, 0], [230, 110, 10], [255, 215, 150]],       // orange
    [[22, 18, 0], [220, 190, 30], [255, 250, 190]],      // yellow
    [[16, 8, 3], [150, 100, 60], [245, 205, 160]],       // brown and skin
    [[0, 12, 2], [40, 150, 55], [180, 255, 190]],        // green
    [[10, 14, 4], [95, 130, 55], [215, 235, 170]],       // olive
    [[0, 14, 18], [0, 170, 200], [190, 250, 255]],       // cyan
    [[0, 3, 24], [30, 90, 215], [170, 200, 255]],        // blue
    [[3, 6, 16], [40, 62, 110], [160, 180, 225]],        // navy
    [[8, 3, 22], [110, 80, 230], [225, 215, 255]],       // purple (Nutanix Iris)
    [[18, 0, 14], [190, 50, 130], [255, 190, 230]],      // magenta
    [[2, 2, 3], [36, 39, 44], [74, 78, 86]],             // near black (rack fronts)
  ];
  const SPECIAL = ['#f25022', '#7fba00', '#00a4ef', '#ffb900', '#cc092f', '#e57000', '#2f9bff', '#7855fa',
    '#3dff6a', '#ff2a2a', '#ffe14a', '#20e8ff', '#ff00ff', '#00ffff', '#1a5fd0', '#b6a4ff'];
  const PAL = new Uint8Array(768);
  RAMPS.forEach(([d, m, l], r) => {
    for (let i = 0; i < 16; i++) {
      const [a, b, t] = i <= 10 ? [d, m, i / 10] : [m, l, (i - 10) / 5];
      for (let k = 0; k < 3; k++) PAL[(r * 16 + i) * 3 + k] = Math.round(a[k] + (b[k] - a[k]) * t);
    }
  });
  SPECIAL.forEach((h, i) => PAL.set(hex(h), (240 + i) * 3));

  function nearest(r, g, b) {
    let best = 0, bd = 1e9;
    for (let i = 0; i < 256; i++) {
      const pr = PAL[i * 3], dr = r - pr, dg = g - PAL[i * 3 + 1], db = b - PAL[i * 3 + 2];
      const rm = (r + pr) >> 1;
      const d = ((512 + rm) * dr * dr >> 8) + 4 * dg * dg + ((767 - rm) * db * db >> 8);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  let LUT = null;                                // RGB555 -> palette index
  const COLORMAP = new Uint8Array(32 * 256);     // [level][index], level 0 = full bright, 31 = near black
  const PALS = [];                               // 14 palettes, like PLAYPAL: 0 normal, 1-8 red, 9-12 gold, 13 green
  function init() {
    if (LUT) return;
    LUT = new Uint8Array(32768);
    for (let r = 0; r < 32; r++) for (let g = 0; g < 32; g++) for (let b = 0; b < 32; b++) {
      LUT[r << 10 | g << 5 | b] = nearest(r * 8 + 4, g * 8 + 4, b * 8 + 4);
    }
    for (let l = 0; l < 32; l++) {
      const k = 1 - l / 32;
      for (let i = 0; i < 256; i++) COLORMAP[l * 256 + i] = l ? nearest(PAL[i * 3] * k, PAL[i * 3 + 1] * k, PAL[i * 3 + 2] * k) : i;
    }
    const tint = (to, f) => {
      const p = new Uint32Array(256);
      for (let i = 0; i < 256; i++) {
        const c = [0, 1, 2].map((k) => Math.min(255, Math.round(PAL[i * 3 + k] + (to[k] - PAL[i * 3 + k]) * f)));
        p[i] = 0xff000000 | c[2] << 16 | c[1] << 8 | c[0];
      }
      return p;
    };
    PALS.push(tint([0, 0, 0], 0));
    for (let i = 1; i <= 8; i++) PALS.push(tint([255, 0, 0], i / 9));
    for (let i = 1; i <= 4; i++) PALS.push(tint([215, 186, 69], i / 8));
    PALS.push(tint([0, 256, 0], 0.125));
    buf = newCanvas(SW, SH);
    bctx = buf.getContext('2d');
    out = bctx.createImageData(SW, SH);
    out32 = new Uint32Array(out.data.buffer);
    wcan = newCanvas(SW, VHR);
    wctx = wcan.getContext('2d', { willReadFrequently: true });
    fcan = newCanvas(32, 32);
    fctx = fcan.getContext('2d', { willReadFrequently: true });
    COL = {};
  }
  const q555 = (c) => LUT[((c & 255) >> 3) << 10 | (((c >> 8) & 255) >> 3) << 5 | ((c >> 16) & 255) >> 3];
  let COL = {};
  const col = (h) => COL[h] !== undefined ? COL[h] : (COL[h] = nearest(...hex(h)));

  /* ------------------------------------------------- quantized assets */
  // Walls: the 128 texel copy, as palette indices.
  function qWall(t) {
    const lo = t.lo;
    if (!lo.q8) { const n = lo.px.length, i8 = new Uint8Array(n); for (let i = 0; i < n; i++) i8[i] = q555(lo.px[i]); lo.q8 = i8; }
    return lo;
  }
  // Flats: 64x64, box filtered from the 128 copy.
  function qFlat(t) {
    if (t.f64) return t.f64;
    const s = t.lo.px, e = t.lo.em, i8 = new Uint8Array(FT * FT), em = new Uint8Array(FT * FT);
    for (let y = 0; y < FT; y++) for (let x = 0; x < FT; x++) {
      let r = 0, g = 0, b = 0, n = 0;
      for (const o of [0, 1, WT, WT + 1]) {
        const j = (y * 2) * WT + x * 2 + o, c = s[j];
        r += c & 255; g += (c >> 8) & 255; b += (c >> 16) & 255; n += e[j] ? 1 : 0;
      }
      i8[y * FT + x] = LUT[(r >> 5) << 10 | (g >> 5) << 5 | (b >> 5)];
      em[y * FT + x] = n >= 2 ? 1 : 0;
    }
    return (t.f64 = { i8, em });
  }
  // Sprites: palette index per texel, -1 where transparent (binary alpha).
  function qSpr(s) {
    if (!s.q8) {
      const n = s.px.length, q = new Int16Array(n);
      for (let i = 0; i < n; i++) { const c = s.px[i]; q[i] = (c >>> 24) >= 128 ? q555(c) : -1; }
      s.q8 = q;
    }
    return s.q8;
  }

  /* ------------------------------------------------------ sector light */
  let SECT = null, sectBase = null;
  // Brightness 0-255 per cell, in steps of 16, from the baked lightmap (smoothed over 3x3 cells).
  function sectors() {
    if (sectBase === Light.base && SECT) return SECT;
    const w = L.w, h = L.h, base = Light.base, lw = w * LG;
    const raw = new Float32Array(w * h), open = (i) => !L.map[i] || L.doors[i];
    for (let cy = 0; cy < h; cy++) for (let cx = 0; cx < w; cx++) {
      let s = 0;
      for (let y = 0; y < LG; y++) for (let x = 0; x < LG; x++) {
        const v = base[(cy * LG + y) * lw + cx * LG + x];
        s += (v & 255) * 0.3 + ((v >> 8) & 255) * 0.59 + ((v >> 16) & 255) * 0.11;
      }
      raw[cy * w + cx] = s / (LG * LG * 128);
    }
    SECT = new Uint8Array(w * h);
    for (let cy = 0; cy < h; cy++) for (let cx = 0; cx < w; cx++) {
      let s = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const x = cx + dx, y = cy + dy;
        if (x < 0 || y < 0 || x >= w || y >= h || !open(y * w + x)) continue;
        const k = dx || dy ? 1 : 2;
        s += raw[y * w + x] * k; n += k;
      }
      const lum = n ? s / n : raw[cy * w + cx];
      SECT[cy * w + cx] = Math.max(0, Math.min(255, Math.round((200 + (lum - 1) * 220) / 16) * 16));
    }
    sectBase = Light.base;
    // new level: prepare the rotation frames of its monsters now rather than on first sight
    for (const e of L.enemies) buildRotations(Assets.enemies[e.type]);
    return SECT;
  }
  function sectAt(x, y) {
    const cx = x | 0, cy = y | 0;
    if (cx < 0 || cy < 0 || cx >= L.w || cy >= L.h) return 0;
    return SECT[cy * L.w + cx];
  }
  // COLORMAP level for a sector brightness seen at distance d (Doom's R_ScaleFromGlobalAngle lights).
  function level(sect, d, extra) {
    let ln = (sect >> 4) + extra;
    ln = ln < 0 ? 0 : ln > 15 ? 15 : ln;
    const l = Math.round((15 - ln) * 4 - LIGHTK / Math.max(d, 0.01));
    return l < 0 ? 0 : l > 31 ? 31 : l;
  }

  /* --------------------------------------------------------- the frame */
  const fb = new Uint8Array(SW * SH);
  const zb = new Float32Array(SW);
  let buf, bctx, out, out32, wcan, wctx, fcan, fctx;
  const rowLev = new Uint8Array(16);
  let extra = 0;

  function view3d() {
    const dirX = Math.cos(P.a), dirY = Math.sin(P.a);
    const plX = -dirY * PLANE_R, plY = dirX * PLANE_R;
    const w = L.w, h = L.h, S = SECT;
    const floors = Assets.floor.map(qFlat), ceils = Assets.ceil.map(qFlat);
    const concreteT = Assets.concrete[L.def.episode % 5];

    // floors and ceilings: 64x64 flats, light from the cell under each pixel
    const rdx0 = dirX - plX, rdy0 = dirY - plY, rdx1 = dirX + plX, rdy1 = dirY + plY;
    for (let y = HZ; y < VHR; y++) {
      const rowD = 0.5 * PROJY / (y - HZ + 0.5);
      for (let ln = 0; ln < 16; ln++) rowLev[ln] = level(ln << 4, rowD, extra);
      const stx = rowD * (rdx1 - rdx0) / SW, sty = rowD * (rdy1 - rdy0) / SW;
      let fx = P.x + rowD * rdx0, fy = P.y + rowD * rdy0;
      const fo = y * SW, co = (VHR - 1 - y) * SW;
      for (let x = 0; x < SW; x++, fx += stx, fy += sty) {
        if (fx < 0 || fy < 0 || fx >= w || fy >= h) { fb[fo + x] = 0; fb[co + x] = 0; continue; }
        const cx = fx | 0, cy = fy | 0, ci = cy * w + cx;
        const ti = (((fy - cy) * FT) | 0) << 6 | (((fx - cx) * FT) | 0);
        const lev = rowLev[S[ci] >> 4] << 8;
        const fl = floors[L.floor[ci]], ce = ceils[L.ceil[ci]];
        fb[fo + x] = fl.em[ti] ? fl.i8[ti] : COLORMAP[lev + fl.i8[ti]];
        fb[co + x] = ce.em[ti] ? ce.i8[ti] : COLORMAP[lev + ce.i8[ti]];
      }
    }

    // walls: one column per screen x, lit by the cell in front of the face
    for (let x = 0; x < SW; x++) {
      const cam = 2 * x / SW - 1;
      const rdx = dirX + plX * cam, rdy = dirY + plY * cam;
      castRay(P.x, P.y, rdx, rdy);
      const d = Math.max(RH.d, 0.02);
      zb[x] = d;
      if (!RH.tile) continue;
      const lh = PROJY / d, top = HZ - lh / 2;
      const y0 = Math.max(0, Math.ceil(top)), y1 = Math.min(VHR - 1, Math.floor(HZ + lh / 2));
      const vi = RH.my * w + RH.mx;
      const ch = String.fromCharCode(RH.tile);
      const vars = ch === '#' || ch === '?' ? concreteT : Assets.walls[ch];
      const frames = vars[L.variant[vi] % vars.length];
      const t = qWall(frames[(animFrame + L.variant[vi]) % frames.length]);
      let tx = (RH.wx * WT) | 0;
      if ((RH.side === 0 && rdx < 0) || (RH.side === 1 && rdy > 0)) tx = WT - 1 - tx;
      const fcx = RH.side === 0 ? (rdx < 0 ? RH.mx + 1 : RH.mx - 1) : RH.mx;
      const fcy = RH.side === 1 ? (rdy < 0 ? RH.my + 1 : RH.my - 1) : RH.my;
      const sect = fcx >= 0 && fcy >= 0 && fcx < w && fcy < h ? S[fcy * w + fcx] : 0;
      const lev = level(sect, d, extra + (RH.side === 0 ? 1 : -1)) << 8;
      const step = WT / lh, i8 = t.q8, em = t.em;
      let tp = (y0 - top) * step;
      for (let y = y0, o = y0 * SW + x; y <= y1; y++, tp += step, o += SW) {
        const ti = ((tp | 0) & (WT - 1)) << 7 | tx;
        fb[o] = em[ti] ? i8[ti] : COLORMAP[lev + i8[ti]];
      }
    }

    // sprites, back to front
    const invDet = 1 / (plX * dirY - dirX * plY);
    const list = [];
    const add = (x, y, spr, scale, z, flash, bright) => {
      const sx = x - P.x, sy = y - P.y;
      const ty = invDet * (-plY * sx + plX * sy);
      if (ty < 0.15) return;
      const tx = invDet * (dirY * sx - dirX * sy);
      list.push({ spr, scale, z, flash, bright, tx, ty, x, y });
    };
    collectSprites(add, true);
    list.sort((a, b) => b.ty - a.ty);
    for (const s of list) sprite(s);
  }

  function sprite(s) {
    const spr = s.spr.lo || s.spr, sw = spr.w, sh = spr.h, q = qSpr(spr);
    const sx = s.scale * PROJX / s.ty, sy = s.scale * PROJY / s.ty;
    const cx = (SW / 2) * (1 + s.tx / s.ty);
    const bottom = HZ + (0.5 - s.z) * PROJY / s.ty;
    const top = bottom - sy, left = cx - sx / 2;
    const x0 = Math.max(0, Math.ceil(left)), x1 = Math.min(SW - 1, Math.floor(left + sx));
    const y0 = Math.max(0, Math.ceil(top)), y1 = Math.min(VHR - 1, Math.floor(bottom));
    if (x0 > x1 || y0 > y1) return;
    const lev = (s.bright || s.flash ? 0 : level(sectAt(s.x, s.y), s.ty, extra)) << 8;
    const ix = sw / sx, iy = sh / sy;
    for (let x = x0; x <= x1; x++) {
      if (s.ty >= zb[x]) continue;
      const tx = ((x - left) * ix) | 0;
      if (tx < 0 || tx >= sw) continue;
      for (let y = y0; y <= y1; y++) {
        const ty = ((y - top) * iy) | 0;
        if (ty >= sh) break;
        const c = q[ty * sw + tx];
        if (c >= 0) fb[y * SW + x] = COLORMAP[lev + c];
      }
    }
  }

  // The weapon, drawn by game.js at 320x168 (2/3 horizontally, 2/3 / 1.2 vertically),
  // then quantized: lit by the player's sector, the muzzle flash full bright.
  const WS = SW / 480, WSY = WS / ASPECT;     // 480x230: the logical view of game.js
  function weapon() {
    if (P.dead) return;
    const lev = level(sectAt(P.x, P.y), 1e9, extra) - 23;
    const pass = (part, cm) => {
      wctx.setTransform(1, 0, 0, 1, 0, 0);
      wctx.clearRect(0, 0, SW, VHR);
      wctx.setTransform(WS, 0, 0, WSY, 0, VHR - VH * WSY);
      wctx.imageSmoothingEnabled = false;
      if (!drawWeapon(wctx, 0, 0, part)) return;
      const d = new Uint32Array(wctx.getImageData(0, 0, SW, VHR).data.buffer);
      for (let i = 0; i < d.length; i++) {
        const c = d[i];
        if ((c >>> 24) >= 120) fb[i] = COLORMAP[cm + q555(c)];
      }
    };
    pass('art', Math.max(0, lev) << 8);
    pass('fx', 0);
  }

  /* -------------------------------------------------- text and status bar */
  // 3x5 bitmap font (like Doom's tiny HUD digits); scaled for the big numbers.
  const GLYPHS = {
    0: '111101101101111', 1: '010110010010111', 2: '111001111100111', 3: '111001111001111', 4: '101101111001001',
    5: '111100111001111', 6: '111100111101111', 7: '111001001010010', 8: '111101111101111', 9: '111101111001111',
    A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110', E: '111100110100111',
    F: '111100110100100', G: '011100101101011', H: '101101111101101', I: '111010010010111', J: '001001001101010',
    K: '101101110101101', L: '100100100100111', M: '101111111101101', N: '111101101101101', O: '010101101101010',
    P: '110101110100100', Q: '010101101110011', R: '110101110101101', S: '011100010001110', T: '111010010010010',
    U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101', Y: '101101010010010',
    Z: '111001010100111', '%': '101001010100101', '/': '001001010100100', '-': '000000111000000', '.': '000000000000010',
    ':': '000010000010000', '!': '010010010000010', '?': '110001010000010', "'": '010010000000000', ',': '000000000010100',
    '(': '010100100100010', ')': '010001001001010', '+': '000010111010000', '#': '101111101111101', '$': '011110010011110',
    '@': '111101111100011', '=': '000111000111000', '>': '100010001010100', '<': '001010100010001', '_': '000000000000111',
    '&': '010101010101011', '"': '101101000000000', '*': '101010101000000', '[': '110100100100110', ']': '011001001001011',
  };
  const textW = (s, k = 1) => s.length * 4 * k - k;
  function text(s, x, y, c, k = 1, shadow = 0) {
    s = String(s).toUpperCase();
    if (shadow !== null) text1(s, x + 1, y + 1, shadow, k);
    text1(s, x, y, c, k);
  }
  function text1(s, x, y, c, k) {
    for (let n = 0; n < s.length; n++, x += 4 * k) {
      const gl = GLYPHS[s[n]];
      if (!gl) continue;
      for (let r = 0; r < 5; r++) for (let q = 0; q < 3; q++) {
        if (gl[r * 3 + q] === '1') rect(x + q * k, y + r * k, k, k, c);
      }
    }
  }
  function rect(x, y, w, h, c) {
    const x0 = Math.max(0, x | 0), x1 = Math.min(SW, (x + w) | 0), y0 = Math.max(0, y | 0), y1 = Math.min(SH, (y + h) | 0);
    for (let yy = y0; yy < y1; yy++) fb.fill(c, yy * SW + x0, yy * SW + x1);
  }
  const center = (s, y, c, k = 1) => text(s, ((SW - textW(s, k)) / 2) | 0, y, c, k);

  function statusBar() {
    const y = VHR, steel = (i) => 16 + i, gray = (i) => i;
    rect(0, y, SW, 32, steel(4));
    rect(0, y, SW, 1, steel(9)); rect(0, y + 1, SW, 1, steel(7));
    for (const x of [50, 108, 144, 178, 236, 250]) { rect(x, y + 2, 1, 30, steel(1)); rect(x + 1, y + 2, 1, 30, steel(6)); }
    const red = col('#ff4d2e'), dim = col('#9aa3ad'), yellow = col('#ffe14a'), black = 0;
    const big = (s, cx, c) => text(s, cx - (textW(s, 3) >> 1), y + 5, c, 3, black);
    const label = (s, cx) => text(s, cx - (textW(s) >> 1), y + 24, dim, 1, null);
    const w = WEAPONS[INV.cur];
    big(w.ammo ? String(INV.ammo[w.ammo]) : '--', 25, red); label('AMMO', 25);
    big(INV.hp + '%', 79, INV.hp > 30 ? red : col('#ff1a1a')); label('EGO', 79);
    for (let i = 0; i < 8; i++) {
      const c = i === INV.cur ? yellow : INV.weapons[i] ? gray(13) : steel(2);
      text(String(i + 1), 113 + (i % 4) * 8, y + 5 + ((i / 4) | 0) * 8, c, 1, null);
    }
    label('ARMS', 126);
    // the admin's face
    rect(145, y + 2, 33, 30, P.hurtT > 0 ? col('#5a0d00') : 224 + 2);
    fctx.setTransform(1, 0, 0, 1, 0, 0);
    fctx.clearRect(0, 0, 32, 32);
    fctx.setTransform(1, 0, 0, 1 / ASPECT * 1.05, 0, 0);
    drawFace(fctx, 16, 17);
    const fd = new Uint32Array(fctx.getImageData(0, 0, 32, 30).data.buffer);
    for (let yy = 0; yy < 30; yy++) for (let xx = 0; xx < 32; xx++) {
      const c = fd[yy * 32 + xx];
      if ((c >>> 24) >= 128) fb[(y + 2 + yy) * SW + 145 + xx] = q555(c);
    }
    big(INV.armor + '%', 207, col('#4fb4ff')); label('ARMOR', 207);
    const badge = (on, c, yy) => { rect(239, y + yy, 9, 6, on ? c : steel(2)); if (on) rect(240, y + yy + 4, 7, 1, gray(14)); };
    badge(L.keys.red, col('#d42020'), 6); badge(L.keys.blue, col('#1f58d6'), 16);
    AMMO_LABELS.forEach(([n, k], i) => {
      const yy = y + 2 + i * 6;
      text(n, 253, yy, dim, 1, null);
      const v = `${INV.ammo[k]}/${AMMO_MAX[k]}`;
      text(v, 318 - textW(v), yy, w.ammo === k ? yellow : col('#b8a040'), 1, null);
    });
  }

  function overlays() {
    const yellow = col('#ffe14a');
    L.msgs.forEach((m, i) => text(m.text, 2, 2 + i * 7, yellow));
    if (L.titleT > 0 && !showMap) {
      center(L.def.name, 34, col('#3dff6a'), 2);
      center(`EPISODE ${L.def.episode + 1}: ${EPISODES[L.def.episode].name}`, 50, col('#9aa3ad'));
    }
    if (L.subtitle && L.subtitle.t > 0) center(L.subtitle.text, VHR - 18, 15);
    const right = (s, y, c) => text(s, SW - 2 - textW(s), y, c);
    right(WEAPONS[INV.cur].name, VHR - 8, col('#9aa3ad'));
    right(`NUTANIX ${L.migrated}/${L.totalSpecials}`, 2, L.migrated === L.totalSpecials ? col('#b6a4ff') : col('#7855fa'));
    if (god) right('ROOT MODE', 9, col('#ffd700'));
    if (P.boostT > 0) right(`TURBO ${Math.ceil(P.boostT)}`, god ? 16 : 9, col('#3dff6a'));
    const boss = L.enemies.find((e) => ETYPES[e.type].boss && alive(e) && e.state !== 'idle');
    if (boss) {
      const T = ETYPES[boss.type], f = Math.max(0, boss.hp / T.hp);
      center(`${T.mini ? 'MINI-BOSS ' : ''}${T.name}: ${T.tag}`, 14, 15);
      rect(SW / 2 - 61, 21, 122, 6, 0);
      rect(SW / 2 - 60, 22, 120, 4, T.mini ? col('#6a3a08') : col('#7a0f0f'));
      rect(SW / 2 - 60, 22, Math.round(120 * f), 4, T.mini ? col('#ff9a1a') : col('#ff2a2a'));
    }
  }

  const MAPCOL = { '#': '#6b7178', '?': '#6b7178', R: '#2e8b3d', S: '#2e6da6', N: '#8a6d1f', C: '#b8bcc0', W: '#c2a020', X: '#3dff6a', D: '#9aa3ad',
    1: '#d42020', 2: '#1f58d6', 3: '#cc092f', 4: '#e57000', 5: '#2f9bff', 6: '#00a4ef', 7: '#7855fa' };
  function automap() {
    rect(0, 0, SW, VHR, 0);
    const cs = Math.min((SW - 16) / L.w, (VHR - 16) * ASPECT / L.h), csy = cs / ASPECT;
    const ox = (SW - cs * L.w) / 2, oy = 10 + (VHR - 12 - csy * L.h) / 2;
    for (let y = 0; y < L.h; y++) for (let x = 0; x < L.w; x++) {
      const t = L.map[y * L.w + x];
      if (!t) continue;
      const x0 = Math.round(ox + x * cs), y0 = Math.round(oy + y * csy);
      rect(x0, y0, Math.max(1, Math.round(ox + (x + 1) * cs) - x0), Math.max(1, Math.round(oy + (y + 1) * csy) - y0), col(MAPCOL[String.fromCharCode(t)] || '#666666'));
    }
    for (const e of L.enemies) if (alive(e)) rect(ox + e.x * cs - 1, oy + e.y * csy - 1, 2, 2, col('#ff3b3b'));
    for (let k = 0; k < 4; k++) rect(ox + (P.x + Math.cos(P.a) * k * 0.25) * cs - 1, oy + (P.y + Math.sin(P.a) * k * 0.25) * csy - 1, 2, 2, 15);
    rect(ox + P.x * cs - 1, oy + P.y * csy - 1, 3, 3, 15);
    center('DATACENTER MAP: ' + L.def.name, 2, col('#3dff6a'));
  }

  // Which PLAYPAL: damage reds first, then pickup gold, then the TURBO green.
  function palette() {
    if (P.dead) return Math.min(8, 2 + Math.floor(P.deadT * 4));
    if (P.hurtT > 0) return Math.max(1, Math.min(8, Math.ceil(P.hurtT / 0.35 * 6)));
    if (P.pickT > 0) return 8 + Math.max(1, Math.min(4, Math.ceil(P.pickT / 0.3 * 3)));
    if (P.boostT > 4 || (P.boostT > 0 && (P.boostT * 4 | 0) % 2)) return 13;
    return 0;
  }

  function frame() {
    init();
    sectors();
    extra = P.flashT > 0 ? (INV.cur === 2 || INV.cur === 4 ? 2 : 1) : 0;
    view3d();
    weapon();
    if (showMap) automap();
    overlays();
    statusBar();
    const pal = PALS[palette()];
    for (let i = 0; i < fb.length; i++) out32[i] = pal[fb[i]];
    bctx.putImageData(out, 0, 0);
    vctx.setTransform(1, 0, 0, 1, 0, 0);
    vctx.imageSmoothingEnabled = false;
    const sh = P.shake > 0 ? P.shake * 7 * view.width / SW : 0;
    if (sh) { vctx.fillStyle = '#000'; vctx.fillRect(0, 0, view.width, view.height); }
    vctx.drawImage(buf, 0, 0, SW, VHR, sh ? rand(-sh, sh) : 0, sh ? rand(-sh, sh) : 0, view.width, view.height * VHR / SH);
    vctx.drawImage(buf, 0, VHR, SW, SH - VHR, 0, view.height * VHR / SH, view.width, view.height * (SH - VHR) / SH);
  }

  return { frame, init, ASPECT: 4 / 3, PLANE: PLANE_R };
})();
