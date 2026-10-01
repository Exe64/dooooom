'use strict';
/*
 * All visuals are generated on the fly on canvases:
 * wall textures (racks, CRAC units, doors...), floors, ceilings and sprites.
 * Drawing functions work in a 64x64 design space; canvases are 128x128 so that
 * text, logos, cables and curves get twice the detail while staying pixelated.
 * Each texture is converted to a Uint32Array (little-endian ABGR) together with
 * an "emissive" mask (pixels not darkened by distance: LEDs, screens).
 */
const TEX = 128;          // sprite resolution in texels (and wall textures in RETRO style)
const TS = TEX / 64;      // design space to texel scale
const WTEX_HI = 256;      // wall / floor / ceiling resolution in MODERN style
const SPR_HI = 256;       // sprite resolution in MODERN style (RETRO uses a TEX x TEX copy)
const STS = SPR_HI / 64;  // design space to texel scale for MODERN sprites

function rng(seed) {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
}

function newCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

// Wall / floor / ceiling texture: drawn at WTEX_HI for the MODERN style, plus a
// filtered TEX x TEX copy (`lo`) for the pixelated RETRO style.
function makeTexture(draw, seed = 1, ledSeed = 1) {
  const N = WTEX_HI, sc = N / 64;
  const c = newCanvas(N, N);
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.scale(sc, sc);
  const em = new Uint8Array(N * N);
  const R = rng(seed), L = rng(ledSeed);
  const led = (x, y, w, h, col) => {
    g.fillStyle = col; g.fillRect(x, y, w, h);
    const x0 = Math.floor(x * sc), x1 = Math.ceil((x + w) * sc), y0 = Math.floor(y * sc), y1 = Math.ceil((y + h) * sc);
    for (let j = y0; j < y1; j++) for (let i = x0; i < x1; i++)
      if (i >= 0 && i < N && j >= 0 && j < N) em[j * N + i] = 1;
  };
  draw(g, R, led, L);
  const px = new Uint32Array(g.getImageData(0, 0, N, N).data.buffer);
  const c2 = newCanvas(TEX, TEX), g2 = c2.getContext('2d');
  g2.imageSmoothingEnabled = true; g2.imageSmoothingQuality = 'high';
  g2.drawImage(c, 0, 0, TEX, TEX);
  const lpx = new Uint32Array(g2.getImageData(0, 0, TEX, TEX).data.buffer);
  const lem = new Uint8Array(TEX * TEX), f = N / TEX;
  for (let j = 0; j < TEX; j++) for (let i = 0; i < TEX; i++) lem[j * TEX + i] = em[(j * f) * N + i * f] | em[(j * f + 1) * N + i * f + 1];
  return { px, em, canvas: c, lo: { px: lpx, em: lem } };
}

// Fills a rectangle (design space) with per-texel noise around a base color.
function noiseFill(g, R, x, y, w, h, r, gg, b, amp) {
  const sc = g.getTransform().a;
  const X = Math.round(x * sc), Y = Math.round(y * sc), W = Math.round(w * sc), H = Math.round(h * sc);
  const id = g.getImageData(X, Y, W, H), d = id.data;
  for (let i = 0; i < W * H; i++) {
    const n = (R() - 0.5) * amp;
    d[i * 4] = r + n; d[i * 4 + 1] = gg + n; d[i * 4 + 2] = b + n; d[i * 4 + 3] = 255;
  }
  g.putImageData(id, X, Y);
}

// A patch cable with an outline, a colored body and a specular highlight.
// pts = [start, control, end, control, end, ...] (quadratic segments).
function cable(g, pts, col, w = 1.4) {
  const path = (dx = 0, dy = 0) => {
    g.beginPath(); g.moveTo(pts[0][0] + dx, pts[0][1] + dy);
    for (let i = 1; i + 1 < pts.length; i += 2) g.quadraticCurveTo(pts[i][0] + dx, pts[i][1] + dy, pts[i + 1][0] + dx, pts[i + 1][1] + dy);
  };
  g.lineCap = 'round'; g.lineJoin = 'round';
  path(); g.strokeStyle = 'rgba(0,0,0,0.8)'; g.lineWidth = w + 1; g.stroke();
  path(); g.strokeStyle = col; g.lineWidth = w; g.stroke();
  path(-w * 0.2, -w * 0.2); g.strokeStyle = 'rgba(255,255,255,0.45)'; g.lineWidth = w * 0.3; g.stroke();
}

// RJ45 plug seen from the front: colored boot + translucent latch.
function rj45(g, x, y, col) {
  g.fillStyle = '#000'; g.fillRect(x - 1.2, y - 1.2, 2.4, 3.2);
  g.fillStyle = col; g.fillRect(x - 1, y - 1, 2, 2.8);
  g.fillStyle = 'rgba(255,255,255,0.55)'; g.fillRect(x - 0.8, y - 1, 1.6, 0.8);
}

/* ----------------------------------------------------------------- walls */

const EP_STRIPES = [['#1f4f7a', '#2e6da6'], ['#1f6a7a', '#3aa6c0'], ['#7a5a1f', '#c0902e'], ['#4a3a6a', '#7a62a6'], ['#7a1f2a', '#c0303e']];
function concrete(ep) { return (g, R) => drawConcrete(g, R, ep); }
function drawConcrete(g, R, ep = 0) {
  noiseFill(g, R, 0, 0, 64, 64, 92, 95, 100, 16);
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.fillRect(0, 0, 64, 1); g.fillRect(0, 0, 1, 64); g.fillRect(32, 0, 1, 40);
  g.fillStyle = 'rgba(255,255,255,0.08)';
  g.fillRect(1, 1, 63, 1); g.fillRect(33, 1, 1, 39);
  // painted stripe (datacenter signage)
  g.fillStyle = EP_STRIPES[ep][0]; g.fillRect(0, 40, 64, 6);
  g.fillStyle = EP_STRIPES[ep][1]; g.fillRect(0, 40, 64, 1);
  // baseboard
  g.fillStyle = '#3a3d42'; g.fillRect(0, 58, 64, 6);
  // stains
  for (let i = 0; i < 6; i++) {
    g.fillStyle = `rgba(0,0,0,${0.05 + R() * 0.1})`;
    g.fillRect((R() * 60) | 0, (R() * 38) | 0, 2 + ((R() * 4) | 0), 1 + ((R() * 3) | 0));
  }
}

function drawWarning(g, R, led) {
  drawConcrete(g, R);
  g.fillStyle = '#f2c230';
  g.beginPath(); g.moveTo(32, 6); g.lineTo(52, 36); g.lineTo(12, 36); g.closePath(); g.fill();
  g.strokeStyle = '#111'; g.lineWidth = 2; g.stroke();
  g.fillStyle = '#111';
  g.beginPath(); g.moveTo(34, 14); g.lineTo(27, 26); g.lineTo(32, 26); g.lineTo(29, 33); g.lineTo(37, 22); g.lineTo(32, 22); g.lineTo(35, 14); g.fill();
  g.fillStyle = '#c21d1d'; g.fillRect(8, 47, 48, 9);
  g.fillStyle = '#fff'; g.font = 'bold 8px monospace'; g.textAlign = 'center';
  g.fillText('DANGER', 32, 54);
}

function drawRack(kind) {
  return (g, R, led, L) => {
    g.fillStyle = '#07090b'; g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#23272d'; g.fillRect(0, 0, 4, 64); g.fillRect(60, 0, 4, 64);
    g.fillStyle = '#3a4047'; g.fillRect(1, 0, 1, 64); g.fillRect(62, 0, 1, 64);
    g.fillStyle = '#2a2e34'; g.fillRect(0, 0, 64, 3);
    // server units, top to bottom
    let y = 4;
    while (y < 60) {
      const u = kind === 'S' ? 8 : (R() < 0.3 ? 8 : 5);
      if (y + u > 61) break;
      g.fillStyle = kind === 'S' ? '#1d2430' : kind === 'N' ? '#1a211d' : (R() < 0.5 ? '#262a30' : '#2e3238');
      const ux = kind === 'N' ? 11 : 5, uw = kind === 'N' ? 42 : 54;
      g.fillRect(ux, y, uw, u - 1);
      g.fillStyle = 'rgba(255,255,255,0.1)'; g.fillRect(ux, y, uw, 1);
      g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(ux, y + u - 2, uw, 1);
      if (kind === 'R') {
        g.fillStyle = '#14171b';
        for (let i = 8; i < 40; i += 3) g.fillRect(i, y + 2, 2, Math.max(1, u - 4));
        g.fillStyle = '#4b525b'; g.fillRect(42, y + 1, 1, u - 3);
        for (let i = 0; i < 3; i++) {
          const s = L();
          led(46 + i * 4, y + 2, 2, 1, s < 0.65 ? '#3dff6a' : s < 0.8 ? '#ffb52e' : s < 0.85 ? '#ff3b3b' : '#123018');
        }
      } else if (kind === 'S') {
        for (let i = 6; i < 57; i += 6) {
          g.fillStyle = '#3a4350'; g.fillRect(i, y + 1, 5, u - 3);
          g.fillStyle = '#566170'; g.fillRect(i, y + 1, 5, 1);
          led(i + 1, y + u - 3, 3, 1, L() < 0.75 ? '#4fb4ff' : '#0e2440');
        }
      } else {
        // switch / patch panel: a row of ports with link LEDs
        const patch = R() < 0.35;
        if (patch) { g.fillStyle = '#c9cdd1'; g.fillRect(11, y, 42, u - 1); }
        for (let i = 12; i < 52; i += 2.5) {
          g.fillStyle = '#050505'; g.fillRect(i, y + 1, 1.8, 1.8);
          if (!patch && L() < 0.6) led(i + 0.4, y + 3, 1, 0.8, L() < 0.6 ? '#3dff6a' : '#ffb52e');
        }
        if (patch) { g.fillStyle = '#333'; for (let i = 12; i < 52; i += 5) g.fillRect(i, y + 3.2, 1.2, 0.6); }
      }
      y += u;
    }
    if (kind === 'N') drawNetworkCabling(g, R);
    if (kind === 'R' && R() < 0.6) {
      // redundant power cords (A/B feeds) dropping down the right post
      cable(g, [[56, 8], [58, 10], [59.5, 16], [61, 40], [60.5, 64]], '#1a1a1a', 1.3);
      cable(g, [[56, 20], [58, 23], [61.5, 30], [62.5, 48], [62, 64]], '#b01818', 1.3);
    }
    // label
    g.fillStyle = '#d8d8d0'; g.fillRect(24, 0, 16, 3);
  };
}

// Network rack cabling: vertical cable managers, patch cables with RJ45 plugs
// routed into the managers, colored bundles and velcro straps.
function drawNetworkCabling(g, R) {
  const cols = ['#e8c21a', '#2a7de1', '#e8741a', '#d92d7a', '#8ad13a', '#e8e8e8', '#20b8c8'];
  for (const mx of [4, 53]) {
    g.fillStyle = '#0b0c0e'; g.fillRect(mx, 3, 7, 61);
    // bundle inside the manager
    for (let k = 0; k < 7; k++) {
      const x = mx + 0.8 + k * 0.85;
      g.fillStyle = cols[(k + mx) % cols.length]; g.fillRect(x, 3, 0.7, 61);
    }
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(mx + 5.2, 3, 1.8, 61);
    // manager fingers
    for (let y = 5; y < 62; y += 4) { g.fillStyle = '#23262b'; g.fillRect(mx, y, 7, 1); g.fillStyle = '#3a3f45'; g.fillRect(mx, y, 7, 0.4); }
    // velcro straps
    for (let y = 14; y < 62; y += 16) { g.fillStyle = '#1f3fa8'; g.fillRect(mx - 0.3, y, 7.6, 1.6); g.fillStyle = '#3b63d6'; g.fillRect(mx - 0.3, y, 7.6, 0.5); }
  }
  // patch cables from ports into the nearest manager
  for (let k = 0; k < 16; k++) {
    const px = 12.5 + Math.floor(R() * 16) * 2.5, py = 6 + Math.floor(R() * 9) * 6;
    const left = px < 32;
    const ex = left ? 9 : 55, drop = 3 + R() * 7;
    const col = cols[Math.floor(R() * cols.length)];
    cable(g, [[px, py + 1], [px, py + drop], [(px + ex) / 2, py + drop + 1.5], [ex - (left ? -0.5 : 0.5), py + drop + 3], [ex + (left ? -2 : 2), py + drop + 4]], col, 1.3);
    rj45(g, px, py, col);
  }
}

function drawCrac(g, R, led, L) {
  noiseFill(g, R, 0, 0, 64, 64, 196, 200, 204, 10);
  g.fillStyle = '#8d9399'; g.fillRect(0, 0, 64, 2); g.fillRect(0, 62, 64, 2); g.fillRect(0, 0, 2, 64); g.fillRect(31, 0, 2, 64); g.fillRect(62, 0, 2, 64);
  // air grille
  for (let y = 22; y < 58; y += 3) {
    g.fillStyle = '#5d636a'; g.fillRect(5, y, 23, 2); g.fillRect(36, y, 23, 2);
  }
  // control display
  led(6, 6, 20, 10, '#082034');
  g.fillStyle = '#5fd3ff'; g.font = '7px monospace'; g.fillText('64°F', 8, 14);
  led(37, 8, 3, 2, L() < 0.8 ? '#3dff6a' : '#ff3b3b');
  g.fillStyle = '#2e6da6'; g.fillRect(43, 7, 16, 4);
  g.fillStyle = '#7a8087'; g.fillRect(37, 14, 22, 2);
}

function drawDoor(kind) {
  return (g, R, led, L) => {
    noiseFill(g, R, 0, 0, 64, 64, 110, 118, 128, 10);
    g.fillStyle = '#4d535b'; g.fillRect(0, 0, 64, 3); g.fillRect(0, 0, 3, 64); g.fillRect(61, 0, 3, 64);
    for (let x = 8; x < 58; x += 8) { g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x, 4, 1, 44); g.fillStyle = 'rgba(255,255,255,0.1)'; g.fillRect(x + 1, 4, 1, 44); }
    // window
    g.fillStyle = '#20262d'; g.fillRect(20, 10, 24, 16);
    g.fillStyle = '#0d1e2e'; g.fillRect(22, 12, 20, 12);
    g.fillStyle = 'rgba(120,180,255,0.35)'; g.fillRect(23, 13, 6, 2); g.fillRect(23, 15, 3, 3);
    // hazard stripes
    for (let x = -8; x < 64; x += 8) {
      g.fillStyle = '#f2c230';
      g.beginPath(); g.moveTo(x, 64); g.lineTo(x + 4, 64); g.lineTo(x + 12, 52); g.lineTo(x + 8, 52); g.fill();
    }
    g.fillStyle = '#111'; g.fillRect(0, 51, 64, 1);
    if (kind) {
      const col = kind === 'red' ? '#c62020' : '#1f58d6';
      const hi = kind === 'red' ? '#ff4040' : '#4fa0ff';
      g.fillStyle = col; g.fillRect(3, 32, 58, 8);
      g.fillStyle = '#fff'; g.font = 'bold 6px monospace'; g.textAlign = 'center';
      g.fillText(kind === 'red' ? 'RED ACCESS' : 'BLUE ACCESS', 32, 38);
      g.fillStyle = '#222'; g.fillRect(52, 42, 7, 8);
      led(54, 43, 3, 2, hi);
    } else {
      g.fillStyle = '#2b2f35'; g.fillRect(52, 34, 6, 8);
      led(54, 35, 2, 2, '#3dff6a');
    }
  };
}

function drawExit(g, R, led, L) {
  g.fillStyle = '#16181b'; g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#2b2f35'; g.fillRect(2, 2, 60, 60);
  led(7, 7, 50, 28, '#021408');
  g.fillStyle = '#3dff6a'; g.font = 'bold 9px monospace'; g.textAlign = 'center';
  g.fillText('REBOOT', 32, 20);
  g.font = '7px monospace'; g.fillText('> Y/N_', 32, 30);
  g.fillStyle = '#555'; g.fillRect(20, 41, 24, 16);
  led(24, 44, 16, 10, L() < 0.5 ? '#ff2a2a' : '#c01010');
  g.fillStyle = '#ffd0d0'; g.fillRect(27, 45, 6, 2);
  g.fillStyle = '#f2c230'; g.fillRect(2, 60, 60, 2);
}

/* ------------------------------------------------------- floors/ceilings */

function drawFloor(perf) {
  return (g, R) => {
    noiseFill(g, R, 0, 0, 64, 64, 128, 133, 140, 8);
    g.fillStyle = '#5c6168'; g.fillRect(0, 62, 64, 2); g.fillRect(62, 0, 2, 64);
    g.fillStyle = '#a5abb2'; g.fillRect(0, 0, 64, 2); g.fillRect(0, 0, 2, 64);
    if (perf) {
      for (let y = 8; y < 58; y += 4) for (let x = 8; x < 58; x += 4) {
        g.fillStyle = '#2d3136'; g.fillRect(x, y, 2, 2);
      }
      g.fillStyle = 'rgba(80,160,255,0.12)'; g.fillRect(6, 6, 52, 52);
    }
  };
}

function drawCeiling(kind) {
  return (g, R, led) => {
    noiseFill(g, R, 0, 0, 64, 64, 44, 47, 52, 6);
    g.fillStyle = '#1c1e22'; g.fillRect(0, 0, 64, 1); g.fillRect(0, 0, 1, 64);
    g.fillStyle = '#3a3e44'; g.fillRect(1, 1, 63, 0.5); g.fillRect(1, 1, 0.5, 63);
    if (kind === 'plain') return;
    if (kind === 'light') {
      g.fillStyle = '#6c7078'; g.fillRect(10, 22, 44, 20);
      led(12, 24, 40, 16, '#dfe9f5');
      g.fillStyle = '#b8c6d6'; for (let x = 16; x < 50; x += 6) g.fillRect(x, 24, 1, 16);
    } else {
      // wire-mesh cable tray with rounded bundles, and a yellow fiber duct
      g.fillStyle = '#1e2126'; g.fillRect(17, 0, 24, 64);
      const bundles = [['#3f78c0', '#10284a'], ['#c8702a', '#4a2408'], ['#b8b8b8', '#4a4a4a'], ['#78a83a', '#28400c'], ['#3f78c0', '#10284a']];
      bundles.forEach(([hi, lo], i) => {
        const x = 19 + i * 4.2, gr = g.createLinearGradient(x, 0, x + 4, 0);
        gr.addColorStop(0, lo); gr.addColorStop(0.45, hi); gr.addColorStop(1, lo);
        g.fillStyle = gr; g.fillRect(x, 0, 4, 64);
      });
      g.strokeStyle = 'rgba(160,168,176,0.55)'; g.lineWidth = 0.4;
      for (let y = 0; y < 64; y += 3) { g.beginPath(); g.moveTo(17, y); g.lineTo(41, y); g.stroke(); }
      for (let y = 6; y < 64; y += 16) { g.fillStyle = '#111'; g.fillRect(17, y, 24, 1.2); }
      g.fillStyle = '#8a9098'; g.fillRect(16, 0, 1.5, 64); g.fillRect(40.5, 0, 1.5, 64);
      g.fillStyle = '#c9a20a'; g.fillRect(45, 0, 9, 64);
      g.fillStyle = '#f2cc2a'; g.fillRect(46, 0, 7, 64);
      g.fillStyle = '#fbe37a'; g.fillRect(47, 0, 1.5, 64);
      for (let y = 10; y < 64; y += 21) { g.fillStyle = '#a8860a'; g.fillRect(45, y, 9, 1.5); }
    }
  };
}

/* ----------------------------------------------------------------- sprites */

// Draws a sprite in the 64x64 design space onto a SPR_HI canvas (MODERN), with a
// TEX x TEX copy in `lo` for RETRO. outline: thin dark outline so it reads against walls.
// keep: also return the canvas (used to derive the death frames).
function makeSprite(draw, outline = false, keep = false) {
  const c = newCanvas(SPR_HI, SPR_HI);
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.scale(STS, STS);
  draw(g);
  const spr = spriteFromCanvas(c, outline);
  if (keep) spr.canvas = c;
  return spr;
}

const OUTLINE = 0xff0c0a0a;
// Converts a canvas to sprite pixels; a canvas larger than TEX also gets its RETRO copy (lo).
function spriteFromCanvas(c, outline = false) {
  const spr = spritePixels(c, outline);
  if (c.width > TEX) {
    const c2 = newCanvas(TEX, TEX), g2 = c2.getContext('2d');
    g2.imageSmoothingEnabled = true; g2.imageSmoothingQuality = 'high';
    g2.drawImage(c, 0, 0, TEX, TEX);
    spr.lo = spritePixels(c2, outline);
  } else spr.lo = spr;
  return spr;
}
function spritePixels(c, outline) {
  const g = c.getContext('2d');
  const w = c.width, h = c.height;
  const d = g.getImageData(0, 0, w, h).data;
  const px = new Uint32Array(d.buffer.slice(0));
  // drop faint pixels, keep partial alpha on the edges (blended by the renderer)
  for (let i = 0; i < px.length; i++) { const a = px[i] >>> 24; if (a < 60) px[i] = 0; else if (a > 230) px[i] |= 0xff000000; }
  if (outline) {
    for (let pass = 0; pass < 1; pass++) {
      const src = px.slice();
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (src[i]) continue;
        if ((x > 0 && src[i - 1]) || (x < w - 1 && src[i + 1]) || (y > 0 && src[i - w]) || (y < h - 1 && src[i + w])) px[i] = OUTLINE;
      }
    }
  }
  return { px, w, h };
}

function ell(g, x, y, rx, ry, col) { g.fillStyle = col; g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); g.fill(); }
function ln(g, x0, y0, x1, y1, col, w) { g.strokeStyle = col; g.lineWidth = w; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); }

// Bug: neon-green glitch insect
function drawBug(g, phase, atk) {
  for (let i = 0; i < 3; i++) {
    const y = 44 + i * 5, o = ((i + phase) % 2 ? 3 : -3);
    ln(g, 20, y, 5, y + 10 + o, '#1b4d21', 3);
    ln(g, 44, y, 59, y + 10 - o, '#1b4d21', 3);
  }
  ell(g, 32, 47, 17, 13, '#2c9a37');
  ell(g, 32, 45, 13, 9, '#3fc24c');
  g.strokeStyle = '#b6ffbf'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(22, 47); g.lineTo(28, 47); g.lineTo(28, 52); g.lineTo(36, 52); g.moveTo(40, 42); g.lineTo(40, 48); g.lineTo(44, 48); g.stroke();
  g.fillStyle = '#b6ffbf'; g.fillRect(27, 51, 2, 2); g.fillRect(39, 41, 2, 2);
  ell(g, 32, 32, 12, 10, '#23702b');
  // glitch
  g.fillStyle = '#ff00ff'; g.fillRect(16, 38 + phase * 3, 6, 2);
  g.fillStyle = '#00ffff'; g.fillRect(42, 50 - phase * 2, 5, 2);
  ell(g, 27, 30, 3, 3, '#ff2a2a'); ell(g, 37, 30, 3, 3, '#ff2a2a');
  g.fillStyle = '#ffd0d0'; g.fillRect(26, 29, 1, 1); g.fillRect(36, 29, 1, 1);
  const m = atk ? 7 : 2;
  ln(g, 28, 38, 24 - m, 44, '#0f2e13', 3); ln(g, 36, 38, 40 + m, 44, '#0f2e13', 3);
  if (atk) ell(g, 32, 41, 4, 3, '#600');
  ln(g, 28, 24, 20, 12 + phase * 2, '#23702b', 2); ln(g, 36, 24, 44, 12 - phase * 2, '#23702b', 2);
}

// Viral drone: spiky sphere (virus-like) with a single eye
function drawDrone(g, phase, atk) {
  const cx = 32, cy = 30;
  for (let i = 0; i < 12; i++) {
    const a = i / 12 * Math.PI * 2 + phase * 0.13;
    const x1 = cx + Math.cos(a) * 25, y1 = cy + Math.sin(a) * 25;
    ln(g, cx + Math.cos(a) * 15, cy + Math.sin(a) * 15, x1, y1, '#7a1f5c', 3);
    ell(g, x1, y1, 3.5, 3.5, atk ? '#ffcc00' : '#d93a8f');
  }
  ell(g, cx, cy, 18, 18, '#8d2468');
  ell(g, cx - 4, cy - 5, 11, 10, '#b3368a');
  ell(g, cx, cy, 9, 9, '#f2f2f2');
  ell(g, cx, cy, 5, 5, atk ? '#ffee00' : '#ff1a1a');
  ell(g, cx, cy, 2, 2, '#000');
  g.fillStyle = '#fff'; g.fillRect(cx - 4, cy - 5, 2, 2);
  // anti-grav thruster
  g.fillStyle = '#3cf'; g.fillRect(24, 52, 16, 2 + phase);
}

// BSOD bot: robot with a blue-screen monitor for a head
function drawBot(g, phase, atk) {
  const lo = phase ? 3 : -3;
  // legs
  g.fillStyle = '#3c4148'; g.fillRect(22, 44, 7, 18 + lo); g.fillRect(35, 44, 7, 18 - lo);
  g.fillStyle = '#1b1e22'; g.fillRect(20, 60 + lo, 10, 4 - Math.max(0, lo)); g.fillRect(33, 60 - lo, 10, 4 - Math.max(0, -lo));
  // torso (server tower)
  g.fillStyle = '#50565e'; g.fillRect(18, 24, 28, 22);
  g.fillStyle = '#6a717a'; g.fillRect(18, 24, 28, 2);
  g.fillStyle = '#23262b'; for (let y = 29; y < 44; y += 3) g.fillRect(22, y, 12, 1);
  g.fillStyle = '#3dff6a'; g.fillRect(38, 30, 2, 2); g.fillStyle = '#ffb52e'; g.fillRect(38, 34, 2, 2);
  // arms + gun
  g.fillStyle = '#3c4148'; g.fillRect(10, 26, 7, 16); g.fillRect(47, 26, 7, 12);
  g.fillStyle = '#222'; g.fillRect(44, 36, 16, 6); g.fillRect(52, 34, 4, 2);
  if (atk) { ell(g, 60, 39, 5, 5, '#ffee55'); ell(g, 60, 39, 2.5, 2.5, '#fff'); }
  // BSOD monitor head
  g.fillStyle = '#2b2f35'; g.fillRect(16, 2, 32, 22);
  g.fillStyle = '#1a5fd0'; g.fillRect(18, 4, 28, 17);
  g.fillStyle = '#fff'; g.font = 'bold 10px monospace'; g.fillText(':(', 21, 15);
  g.fillRect(34, 8, 9, 1); g.fillRect(34, 11, 7, 1); g.fillRect(34, 14, 9, 1); g.fillRect(34, 17, 5, 1);
  g.fillStyle = '#2b2f35'; g.fillRect(28, 21, 8, 4);
}

// Boss: five variants (one per episode), same body, different colors and emblem
const BOSS_PAL = {
  botnet:     { body: '#1f4a24', light: '#2f6a34', dark: '#0f2612', head: '#9fdc8f', eye: '#3dff6a', shot: '#3dff6a', glyph: ['@', '#'] },
  miner:      { body: '#6a4a0f', light: '#8a661a', dark: '#3a2806', head: '#f2d27a', eye: '#ffb000', shot: '#ffb000', glyph: ['₿', 'Ξ'] },
  rootkit:    { body: '#241a3a', light: '#3a2a5a', dark: '#120c1e', head: '#b8a8e0', eye: '#c04dff', shot: '#c04dff', glyph: ['#', '$'] },
  zeroday:    { body: '#0f4a5a', light: '#1a6a7a', dark: '#06262e', head: '#bff4ff', eye: '#00e5ff', shot: '#00e5ff', glyph: ['0', '!'] },
  ransomware: { body: '#5a1414', light: '#7a1c1c', dark: '#2a0d0d', head: '#e8e0d0', eye: '#ff2020', shot: '#c04dff', glyph: ['$', '₿'] },
};
function drawBoss(pal) {
  return (g, phase, atk) => {
    const lo = phase ? 4 : -4;
    g.fillStyle = pal.dark; g.fillRect(14, 46, 12, 18 + Math.min(0, lo)); g.fillRect(38, 46, 12, 18 - Math.max(0, lo));
    g.fillStyle = pal.body; g.fillRect(10, 26, 44, 24);
    g.fillStyle = pal.light; g.fillRect(10, 26, 44, 3);
    // padlock
    g.strokeStyle = '#e8c21a'; g.lineWidth = 3; g.beginPath(); g.arc(32, 35, 5, Math.PI, 0); g.stroke();
    g.fillStyle = '#e8c21a'; g.fillRect(25, 35, 14, 11);
    g.fillStyle = '#000'; g.fillRect(31, 38, 2, 5);
    // arm cannons
    g.fillStyle = pal.dark; g.fillRect(0, 28, 10, 20); g.fillRect(54, 28, 10, 20);
    g.fillStyle = '#111'; g.fillRect(1, 46, 8, 6); g.fillRect(55, 46, 8, 6);
    if (atk) { ell(g, 5, 55, 5, 5, pal.shot); ell(g, 59, 55, 5, 5, pal.shot); ell(g, 5, 55, 2, 2, '#fff'); ell(g, 59, 55, 2, 2, '#fff'); }
    // skull
    ell(g, 32, 14, 16, 14, pal.head);
    g.fillStyle = pal.head; g.fillRect(22, 18, 20, 10);
    ell(g, 25, 13, 5, 5, '#000'); ell(g, 39, 13, 5, 5, '#000');
    ell(g, 25, 13, 2, 2, atk ? '#fff' : pal.eye); ell(g, 39, 13, 2, 2, atk ? '#fff' : pal.eye);
    g.fillStyle = '#000'; g.beginPath(); g.moveTo(32, 17); g.lineTo(29, 22); g.lineTo(35, 22); g.fill();
    for (let x = 23; x < 42; x += 3) g.fillRect(x, 24, 1, 4);
    g.fillStyle = pal.eye; g.font = 'bold 7px monospace'; g.fillText(pal.glyph[0], 1, 8 + phase * 2); g.fillText(pal.glyph[1], 56, 10 - phase * 2);
  };
}

// Forum troll: big green brute holding a "FIRST!" sign
function drawTroll(g, phase, atk) {
  const lo = phase ? 3 : -3;
  g.fillStyle = '#3d5a2a'; g.fillRect(18, 46, 10, 18 + Math.min(0, lo)); g.fillRect(36, 46, 10, 18 - Math.max(0, lo));
  ell(g, 32, 38, 20, 16, '#5f8a3a');
  ell(g, 32, 42, 12, 9, '#7aa84c');
  g.fillStyle = '#5a3a1a'; g.fillRect(12, 48, 40, 6);
  // arms + club (a broken ergonomic keyboard)
  ell(g, 11, 36, 6, 9, '#5f8a3a'); ell(g, 53, 36, 6, 9, '#5f8a3a');
  const cx = atk ? 60 : 56, cy = atk ? 8 : 16;
  g.save(); g.translate(cx, cy); g.rotate(atk ? 0.9 : 0.2);
  g.fillStyle = '#2c3038'; g.fillRect(-4, -2, 8, 30);
  g.fillStyle = '#d9dde2'; for (let y = 0; y < 26; y += 4) g.fillRect(-3, y, 6, 2);
  g.restore();
  // sign
  g.fillStyle = '#6b4a2a'; g.fillRect(6, 10, 2, 28);
  g.fillStyle = '#f2f2e0'; g.fillRect(0, 6, 20, 11);
  g.fillStyle = '#c21d1d'; g.font = 'bold 6px monospace'; g.fillText('FIRST!', 1, 14);
  // head
  ell(g, 32, 18, 12, 11, '#6f9a44');
  ell(g, 26, 16, 3, 3, '#fff'); ell(g, 38, 16, 3, 3, '#fff');
  g.fillStyle = '#c00'; g.fillRect(26, 16, 2, 2); g.fillRect(38, 16, 2, 2);
  g.fillStyle = '#2a3a1a'; g.fillRect(24, 11, 6, 2); g.fillRect(35, 11, 6, 2);
  g.fillStyle = '#2a1a0a'; g.fillRect(27, 23, 11, atk ? 5 : 2);
  g.fillStyle = '#f2f2e0'; g.fillRect(28, 23, 2, 3); g.fillRect(35, 23, 2, 3);
  ell(g, 20, 12, 3, 5, '#6f9a44'); ell(g, 44, 12, 3, 5, '#6f9a44');
}

// Spammer: walking envelope spitting @ signs
function drawSpammer(g, phase, atk) {
  const lo = phase ? 3 : -3;
  g.fillStyle = '#222'; g.fillRect(22, 48, 5, 16 + Math.min(0, lo)); g.fillRect(37, 48, 5, 16 - Math.max(0, lo));
  g.fillStyle = '#f2efe0'; g.fillRect(10, 18, 44, 32);
  g.strokeStyle = '#b8b0a0'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(10, 18); g.lineTo(32, 38); g.lineTo(54, 18); g.stroke();
  g.fillStyle = '#c21d1d'; g.fillRect(40, 21, 10, 8);
  g.fillStyle = '#fff'; g.font = 'bold 6px monospace'; g.fillText('$', 43, 28);
  // eyes + mouth
  ell(g, 24, 30, 4, 4, '#fff'); ell(g, 40, 34, 4, 4, '#fff');
  ell(g, 24, 30, 2, 2, '#000'); ell(g, 40, 34, 2, 2, '#000');
  ell(g, 32, 44, 7, atk ? 5 : 2, '#600');
  g.fillStyle = atk ? '#ffe14a' : '#e8741a'; g.font = 'bold 10px monospace';
  g.fillText('@', 2, 14 + phase * 2); g.fillText('@', 52, 12 - phase * 2);
  g.fillStyle = '#e8c21a'; g.font = 'bold 5px monospace'; g.fillText('SPAM', 14, 26);
}

// Generic death frames: the sprite "glitches" into slices, then a pile of debris.
function glitchFrame(src, amount) {
  const N = src.width, sc = N / 64;
  const c = newCanvas(N, N), g = c.getContext('2d');
  const R = rng(amount * 7 + 3), band = 4 * sc;
  for (let y = 0; y < N; y += band) {
    const off = ((R() - 0.5) * amount * 2 * sc) | 0;
    g.drawImage(src, 0, y, N, band, off, y + amount / 2 * sc, N, band);
  }
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = 'rgba(255,0,80,0.3)'; g.fillRect(0, 0, N, N);
  return spriteFromCanvas(c);
}

function debrisFrame(colors, seed) {
  return makeSprite((g) => {
    const R = rng(seed);
    for (let i = 0; i < 22; i++) {
      g.fillStyle = colors[i % colors.length];
      const w = 3 + R() * 9, h = 2 + R() * 4;
      g.fillRect(8 + R() * (48 - w), 56 + R() * (8 - h), w, h);
    }
    g.fillStyle = '#3dff6a'; g.fillRect(20 + R() * 20, 58, 2, 1);
    g.fillStyle = '#ff2a2a'; g.fillRect(20 + R() * 20, 60, 2, 1);
  });
}

function buildEnemySprites(drawFn, debrisCols, seed) {
  const walk = [0, 1].map((p) => makeSprite((g) => drawFn(g, p, false), true, true));
  const atk = makeSprite((g) => drawFn(g, 0, true), true);
  const die = [glitchFrame(walk[0].canvas, 6), glitchFrame(walk[1].canvas, 14)];
  for (const w of walk) w.canvas = null;   // only needed to derive the death frames
  return { walk, atk, die, dead: debrisFrame(debrisCols, seed) };
}

// Cage nut: square M6 nut inside its spring cage (wings)
function drawCageNut(g, x, y, s, rot) {
  g.save(); g.translate(x, y); g.rotate(rot); g.scale(s, s);
  g.fillStyle = '#8f969e'; g.fillRect(-9, -7, 18, 14);             // cage
  g.fillStyle = '#6a7078'; g.fillRect(-13, -4, 4, 8); g.fillRect(9, -4, 4, 8); // wings
  g.fillStyle = '#c9ced4'; g.fillRect(-6, -6, 12, 12);              // nut
  g.fillStyle = '#e8ecf0'; g.fillRect(-6, -6, 12, 2);
  ell(g, 0, 0, 3.5, 3.5, '#2a2e34');                                // threaded hole
  g.restore();
}

// 3.5" hard drive
function drawHdd(g, x, y, s, rot) {
  g.save(); g.translate(x, y); g.rotate(rot); g.scale(s, s);
  g.fillStyle = '#9aa1a8'; g.fillRect(-10, -7, 20, 14);
  g.fillStyle = '#c9ced4'; g.fillRect(-10, -7, 20, 2);
  ell(g, -2, 0, 5, 5, '#b4bac1'); ell(g, -2, 0, 1.5, 1.5, '#5a6068');
  g.fillStyle = '#1a4a1a'; g.fillRect(-10, 5, 20, 2);
  g.fillStyle = '#fff'; g.fillRect(4, -5, 5, 8);
  g.fillStyle = '#c21d1d'; g.fillRect(4, -5, 5, 2);
  g.restore();
}

/* ------------------------------------------ special racks (hypervisors) */

function specialRack(brand) {
  return (g, R, led, L) => {
    drawRack('R')(g, R, led, L);
    const b = BRANDS[brand];
    // lit brand banner
    led(4, 3, 56, 24, b.bg);
    b.logo(g);
    g.fillStyle = b.bg; g.fillRect(0, 60, 64, 4);
    // brand-colored LEDs on the servers
    for (let y = 31; y < 58; y += 6) led(46 + ((y / 6) % 2) * 4, y, 2, 1, L() < 0.7 ? b.led : '#1a1a1a');
  };
}

// Draws text, shrinking the font until it fits in maxW; returns its width.
function fitText(g, text, x, y, maxW, size, weight = 'bold') {
  let sz = size;
  do { g.font = `${weight} ${sz}px sans-serif`; sz -= 0.5; } while (g.measureText(text).width > maxW && sz > 3);
  g.fillText(text, x, y);
  return g.measureText(text).width;
}

const BRANDS = {
  // Broadcom (VMware ESXi): Broadcom red, round badge with a white pulse
  esxi: { name: 'BROADCOM ESXi', bg: '#1c1c1c', led: '#cc092f', logo(g) {
    ell(g, 14, 13, 8, 8, '#cc092f');
    g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.beginPath();
    g.moveTo(8, 15); g.lineTo(11, 15); g.lineTo(13, 8); g.lineTo(15, 17); g.lineTo(17, 11); g.lineTo(18, 15); g.lineTo(21, 15); g.stroke();
    g.fillStyle = '#fff'; fitText(g, 'BROADCOM', 24, 12, 34, 7);
    g.fillStyle = '#cc092f'; fitText(g, 'ESXi', 30, 23, 24, 9);
  } },
  // Proxmox: the orange and black "X" on a light background
  proxmox: { name: 'PROXMOX VE', bg: '#f2f2f2', led: '#e57000', logo(g) {
    g.lineWidth = 3.5;
    g.strokeStyle = '#e57000'; g.beginPath(); g.moveTo(7, 6); g.lineTo(19, 20); g.stroke();
    g.strokeStyle = '#000'; g.beginPath(); g.moveTo(19, 6); g.lineTo(7, 20); g.stroke();
    g.strokeStyle = '#e57000'; g.lineWidth = 3.5; g.beginPath(); g.moveTo(7, 6); g.lineTo(12, 12); g.stroke();
    g.fillStyle = '#000'; const pw = fitText(g, 'PROXMO', 22, 13, 30, 8);
    g.fillStyle = '#e57000'; g.fillText('X', 22 + pw, 13);
    g.fillStyle = '#555'; fitText(g, 'Virtual Env.', 23, 22, 34, 5, 'normal');
  } },
  // Vates (XCP-ng / Xen Orchestra)
  vates: { name: 'VATES XCP-ng', bg: '#0f1d3d', led: '#2f9bff', logo(g) {
    g.fillStyle = '#2f9bff'; g.beginPath(); g.moveTo(6, 6); g.lineTo(11, 6); g.lineTo(14, 16); g.lineTo(17, 6); g.lineTo(22, 6); g.lineTo(16, 21); g.lineTo(12, 21); g.closePath(); g.fill();
    g.fillStyle = '#fff'; fitText(g, 'VATES', 25, 13, 32, 9);
    g.fillStyle = '#2f9bff'; fitText(g, 'XCP-ng', 26, 22, 32, 7);
  } },
  // Hyper-V: the four Microsoft squares
  hyperv: { name: 'MICROSOFT HYPER-V', bg: '#1b1b1b', led: '#00a4ef', logo(g) {
    g.fillStyle = '#f25022'; g.fillRect(6, 6, 7, 7);
    g.fillStyle = '#7fba00'; g.fillRect(14, 6, 7, 7);
    g.fillStyle = '#00a4ef'; g.fillRect(6, 14, 7, 7);
    g.fillStyle = '#ffb900'; g.fillRect(14, 14, 7, 7);
    g.fillStyle = '#fff'; fitText(g, 'Hyper-V', 24, 17, 34, 9);
  } },
  // Nutanix: charcoal background, white wordmark, Iris purple "X"
  nutanix: { name: 'NUTANIX', bg: '#131313', led: '#7855fa', logo(g) {
    g.fillStyle = '#fff'; const nw = fitText(g, 'NUTANI', 5, 16, 42, 11);
    const x0 = 6 + nw;
    g.lineWidth = 2.5;
    g.strokeStyle = '#7855fa'; g.beginPath(); g.moveTo(x0, 8); g.lineTo(x0 + 8, 16); g.stroke();
    g.strokeStyle = '#b6a4ff'; g.beginPath(); g.moveTo(x0 + 8, 8); g.lineTo(x0, 16); g.stroke();
    g.fillStyle = '#7855fa'; g.fillRect(5, 20, 50, 3);
  } },
};
const SPECIAL_TILES = { '3': 'esxi', '4': 'proxmox', '5': 'vates', '6': 'hyperv', '7': 'nutanix' };

/* ------------------------------------------------------------ mini-bosses */

// Cable Spaghetti Monster: a knot of patch cables with googly eyes and RJ45 tentacles
function drawSpaghetti(g, phase, atk) {
  const R = rng(77);
  const cols = ['#e8c21a', '#2a7de1', '#e8741a', '#d92d7a', '#8ad13a', '#e8e8e8', '#20b8c8'];
  for (let i = 0; i < 6; i++) {
    const x = 14 + i * 7, sw = (phase ? 3 : -3) * (i % 2 ? 1 : -1);
    cable(g, [[x + 4, 42], [x + sw, 54], [x - 2 + sw, 63]], cols[i], 2.2);
  }
  ell(g, 32, 30, 20, 17, '#101216');
  for (let k = 0; k < 34; k++) {
    const a = R() * Math.PI * 2, r = 6 + R() * 13, a2 = a + 0.8 + R() * 1.6;
    const p0 = [32 + Math.cos(a) * r, 30 + Math.sin(a) * r * 0.85], p2 = [32 + Math.cos(a2) * r, 30 + Math.sin(a2) * r * 0.85];
    const pc = [32 + Math.cos((a + a2) / 2) * (r + 7), 30 + Math.sin((a + a2) / 2) * (r + 7) * 0.85];
    cable(g, [p0, pc, p2], cols[k % cols.length], 1.8);
  }
  // arms ending with RJ45 plugs
  const ay = atk ? 6 : 16;
  cable(g, [[16, 30], [4, 26], [5, ay]], '#2a7de1', 2.2); rj45(g, 5, ay - 2, '#2a7de1');
  cable(g, [[48, 30], [60, 26], [59, ay + 2]], '#e8741a', 2.2); rj45(g, 59, ay, '#e8741a');
  ell(g, 25, 26, 6, 6, '#fff'); ell(g, 39, 25, 7, 7, '#fff');
  ell(g, 26 + phase, 27, 2.5, 2.5, '#c00'); ell(g, 38 + phase, 26, 3, 3, '#c00');
  g.fillStyle = '#300'; g.fillRect(24, 36, 16, atk ? 6 : 3);
  g.fillStyle = '#e8e8e8'; for (let x = 25; x < 40; x += 3) g.fillRect(x, 36, 1.6, 2);
}

// Hot Spot: an overheated flame elemental escaped from the hot aisle
function drawHotspot(g, phase, atk) {
  const flame = (w, h, col, wob) => {
    g.fillStyle = col; g.beginPath(); g.moveTo(32 - w, 62);
    g.quadraticCurveTo(32 - w - 4, 62 - h * 0.5, 32 - w * 0.3 + wob, 62 - h * 0.75);
    g.quadraticCurveTo(32 + wob, 62 - h * 0.95, 32 + wob * 1.5, 62 - h);
    g.quadraticCurveTo(32 + w * 0.5 + wob, 62 - h * 0.7, 32 + w + 4, 62 - h * 0.4);
    g.quadraticCurveTo(32 + w + 2, 62 - h * 0.1, 32 + w, 62); g.closePath(); g.fill();
  };
  const f = phase ? 3 : -3;
  flame(24, 60, '#b8200a', f); flame(19, 50, '#ff5a1a', -f); flame(13, 38, '#ffb000', f * 0.7); flame(6, 22, '#fff2a0', -f * 0.5);
  // angry face
  g.fillStyle = '#2a0800'; g.beginPath(); g.moveTo(20, 30); g.lineTo(30, 34); g.lineTo(21, 37); g.fill();
  g.beginPath(); g.moveTo(44, 30); g.lineTo(34, 34); g.lineTo(43, 37); g.fill();
  g.fillStyle = atk ? '#fff' : '#ffe14a'; g.fillRect(23, 34, 3, 1.5); g.fillRect(38, 34, 3, 1.5);
  g.fillStyle = '#2a0800'; g.fillRect(26, 43, 12, atk ? 6 : 3);
  // thermometer
  g.fillStyle = '#f2f2f2'; g.fillRect(52, 8, 5, 30); ell(g, 54.5, 40, 4, 4, '#f2f2f2');
  g.fillStyle = '#e02020'; g.fillRect(53.5, 10, 2, 30); ell(g, 54.5, 40, 2.8, 2.8, '#e02020');
  g.fillStyle = '#fff'; g.font = 'bold 6px monospace'; g.fillText('203°F', 36, 8);
}

// Packet Storm: a DDoS thunder cloud full of packets
function drawStorm(g, phase, atk) {
  const pk = (x, y) => { g.fillStyle = '#f2f2f2'; g.fillRect(x, y, 7, 5); g.fillStyle = '#2a7de1'; g.fillRect(x, y, 7, 1.5); };
  const R = rng(5 + phase);
  for (let i = 0; i < 7; i++) pk(6 + R() * 48, 40 + R() * 20);
  // lightning
  g.fillStyle = atk ? '#fff6b0' : '#ffe14a';
  g.beginPath(); g.moveTo(28, 34); g.lineTo(22, 50); g.lineTo(28, 49); g.lineTo(24, 63); g.lineTo(36, 44); g.lineTo(30, 45); g.lineTo(34, 34); g.fill();
  // cloud
  for (const [x, y, r, c] of [[18, 26, 11, '#3a3f4a'], [32, 20, 14, '#454b58'], [46, 26, 11, '#3a3f4a'], [26, 30, 11, '#4e5563'], [40, 31, 11, '#4e5563'], [32, 16, 9, '#5a6070']]) ell(g, x, y, r, r * 0.8, c);
  ell(g, 26, 26, 3.5, 2.5, atk ? '#fff' : '#ff3030'); ell(g, 38, 26, 3.5, 2.5, atk ? '#fff' : '#ff3030');
  g.fillStyle = '#ffe14a'; g.font = 'bold 6px monospace'; g.fillText('SYN SYN SYN', 8 + phase * 2, 8);
}

// Bit Rot: a moldy golem made of stacked LTO tape cartridges
function drawBitrot(g, phase, atk) {
  const lto = (x, y, w, h) => {
    g.fillStyle = '#1d2a4a'; g.fillRect(x, y, w, h);
    g.fillStyle = '#2e4270'; g.fillRect(x, y, w, 1.5);
    g.fillStyle = '#e8e8e0'; g.fillRect(x + 2, y + 2, w - 4, 3);
    g.fillStyle = '#111'; g.font = '3px monospace'; g.fillText('LTO-4', x + 3, y + 4.5);
  };
  const lo = phase ? 3 : -3;
  lto(18, 46 + Math.min(0, lo), 10, 18); lto(36, 46 - Math.max(0, lo), 10, 18);
  lto(14, 26, 36, 22);
  // magnetic tape arms
  cable(g, [[14, 30], [4, atk ? 14 : 40], [8, atk ? 6 : 52]], '#5a3a1a', 3);
  cable(g, [[50, 30], [60, atk ? 14 : 40], [56, atk ? 6 : 52]], '#5a3a1a', 3);
  lto(20, 8, 24, 18);
  // reel eyes
  for (const x of [27, 37]) { ell(g, x, 16, 4, 4, '#c9cdd1'); ell(g, x, 16, 1.5, 1.5, atk ? '#ffe14a' : '#c00'); ln(g, x - 3, 16, x + 3, 16, '#555', 0.6); }
  // mold
  const R = rng(9);
  for (let i = 0; i < 16; i++) ell(g, 16 + R() * 32, 10 + R() * 50, 1.5 + R() * 3, 1 + R() * 2, i % 2 ? '#4a7a2a' : '#6a9a3a');
  g.fillStyle = '#8ad13a'; g.font = 'bold 5px monospace'; g.fillText('0', 6, 58 - phase * 4); g.fillText('1', 56, 50 + phase * 4);
}

// Shadow IT: a hooded ninja running unauthorized SaaS on a corporate credit card
function drawShadowIT(g, phase, atk) {
  const lo = phase ? 3 : -3;
  g.fillStyle = '#15101e'; g.fillRect(22, 44, 8, 20 + Math.min(0, lo)); g.fillRect(34, 44, 8, 20 - Math.max(0, lo));
  // scarf
  g.fillStyle = '#7855fa'; g.beginPath(); g.moveTo(40, 22); g.lineTo(62, 16 + phase * 4); g.lineTo(60, 24 + phase * 3); g.lineTo(40, 27); g.fill();
  // hoodie
  g.fillStyle = '#2c2240'; g.beginPath(); g.moveTo(16, 46); g.lineTo(20, 22); g.lineTo(44, 22); g.lineTo(48, 46); g.closePath(); g.fill();
  ell(g, 32, 16, 11, 12, '#2c2240');
  ell(g, 32, 18, 8, 7, '#0a0810');
  g.fillStyle = '#20e8ff'; g.fillRect(27, 17, 4, 1.5); g.fillRect(34, 17, 4, 1.5);
  // laptop with stickers
  g.fillStyle = '#9aa1a8'; g.fillRect(12, 32, 20, 13);
  g.fillStyle = '#7855fa'; ell(g, 18, 37, 2.5, 2.5, '#7855fa'); g.fillStyle = '#e8741a'; g.fillRect(23, 35, 5, 3);
  g.fillStyle = '#111'; g.font = 'bold 4px monospace'; g.fillText('SaaS', 17, 43);
  // credit card
  g.save(); g.translate(atk ? 54 : 48, atk ? 26 : 38); g.rotate(atk ? -0.6 : 0.2);
  g.fillStyle = '#e8c21a'; g.fillRect(-6, -4, 12, 8); g.fillStyle = '#222'; g.fillRect(-6, -2, 12, 2);
  g.restore();
}

/* ------------------------------------------------- volumetric decor props */

// Faces are small canvases drawn in a design space (w x h), at TS x resolution.
function face(w, h, draw) {
  const c = newCanvas(Math.round(w * STS), Math.round(h * STS));
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.scale(STS, STS);
  draw(g, w, h);
  return c;
}

/*
 * Orthographic rendering of axis-aligned boxes seen from `yaw`, with a slight
 * downward pitch, so props show their real faces as the player walks around them
 * (Doom-style rotation frames). Boxes: {x, y, z, w, d, h, faces:{front,back,left,right,top}}
 * in world units; the map y axis points south, hence the mirrored screen x.
 */
const PITCH = 0.2;
function drawBoxes(g, boxes, yaw, ppu, cx, baseY) {
  const cp = Math.cos(PITCH), sp = Math.sin(PITCH), cy = Math.cos(yaw), sy = Math.sin(yaw);
  const proj = (x, y, z) => {
    const xr = x * cy - y * sy, yr = x * sy + y * cy;
    return [cx - xr * ppu, baseY - z * cp * ppu - yr * sp * ppu];
  };
  const light = [-0.55, -0.83];
  for (const b of boxes) {
    const x0 = b.x - b.w / 2, x1 = b.x + b.w / 2, y0 = b.y - b.d / 2, y1 = b.y + b.d / 2, z0 = b.z, z1 = b.z + b.h;
    // [face, origin, u end, v end, normal]; u runs to the viewer's right, v downwards
    const quads = [
      ['front', [x1, y0, z1], [x0, y0, z1], [x1, y0, z0], [0, -1]],
      ['back', [x0, y1, z1], [x1, y1, z1], [x0, y1, z0], [0, 1]],
      ['left', [x0, y0, z1], [x0, y1, z1], [x0, y0, z0], [-1, 0]],
      ['right', [x1, y1, z1], [x1, y0, z1], [x1, y1, z0], [1, 0]],
    ];
    for (const [name, o, u, v, n] of quads) {
      const ny = n[0] * sy + n[1] * cy;
      if (ny >= -0.02) continue;
      quad(g, b.faces[name] || b.faces.side, proj(...o), proj(...u), proj(...v), 0.2 - 0.16 * (n[0] * light[0] + n[1] * light[1]));
    }
    quad(g, b.faces.top, proj(x0, y1, z1), proj(x1, y1, z1), proj(x0, y0, z1), 0);
  }
}
function quad(g, tex, p0, p1, p2, shadeAmt) {
  if (!tex) return;
  const tw = tex.width, th = tex.height;
  g.save();
  g.setTransform((p1[0] - p0[0]) / tw, (p1[1] - p0[1]) / tw, (p2[0] - p0[0]) / th, (p2[1] - p0[1]) / th, p0[0], p0[1]);
  g.drawImage(tex, 0, 0);
  if (shadeAmt > 0) { g.fillStyle = `rgba(0,0,0,${Math.min(0.7, shadeAmt)})`; g.fillRect(0, 0, tw, th); }
  g.restore();
}

const DECOR_FRAMES = 16;
// Renders a prop in DECOR_FRAMES orientations. `size` = world units covered by the sprite.
function propFrames(boxes, size, extra) {
  const ppu = SPR_HI / size;
  const radius = Math.max(...boxes.map((b) => Math.hypot(b.w, b.d) / 2 + Math.hypot(b.x, b.y)));
  const margin = radius * Math.sin(PITCH) * ppu + 2;
  const frames = [];
  for (let k = 0; k < DECOR_FRAMES; k++) {
    const yaw = k / DECOR_FRAMES * Math.PI * 2;
    const c = newCanvas(SPR_HI, SPR_HI), g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    drawBoxes(g, boxes, yaw, ppu, SPR_HI / 2, SPR_HI - margin);
    if (extra) extra(g, yaw, ppu, SPR_HI / 2, SPR_HI - margin);
    frames.push(spriteFromCanvas(c, true));
  }
  return { frames, scale: size, z: -margin / ppu };
}

function buildDecor() {
  const cardboard = (label) => face(32, 26, (g, w, h) => {
    g.fillStyle = '#b58a55'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#a37848'; g.fillRect(0, 0, w, 1); g.fillRect(0, h - 1, w, 1); g.fillRect(0, 0, 1, h); g.fillRect(w - 1, 0, 1, h);
    g.fillStyle = '#d8b882'; g.fillRect(w / 2 - 2, 0, 4, 4);
    if (label === 'front') {
      g.fillStyle = '#c21d1d'; g.font = 'bold 5px monospace'; g.fillText('FRAGILE', 5, 13);
      g.strokeStyle = '#c21d1d'; g.lineWidth = 0.6; g.strokeRect(4, 8, 24, 7);
      g.fillStyle = '#222'; g.font = '3px monospace'; g.fillText('1U SERVER x4', 6, 21);
    } else if (label === 'side') {
      g.strokeStyle = '#222'; g.lineWidth = 1;
      for (const x of [10, 20]) { g.beginPath(); g.moveTo(x, 20); g.lineTo(x, 9); g.moveTo(x - 3, 12); g.lineTo(x, 8); g.lineTo(x + 3, 12); g.stroke(); }
    } else {
      g.fillStyle = '#f2f2f2'; g.fillRect(6, 7, 18, 11);
      g.fillStyle = '#222'; for (let x = 8; x < 22; x += 1.5) g.fillRect(x, 13, x % 3 ? 0.6 : 1, 4);
      g.font = '3px monospace'; g.fillText('SHIP TO: DC', 7, 11);
    }
  });
  const cardTop = face(32, 32, (g, w, h) => {
    g.fillStyle = '#c49a62'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#9a7445'; g.fillRect(0, h / 2 - 0.5, w, 1);
    g.fillStyle = 'rgba(230,220,190,0.8)'; g.fillRect(w / 2 - 3, 0, 6, h);
  });
  const pallet = face(36, 5, (g, w, h) => {
    g.fillStyle = '#7a5a34'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#2a1a0a'; g.fillRect(4, 2, 10, 3); g.fillRect(22, 2, 10, 3);
    g.fillStyle = '#9a764a'; g.fillRect(0, 0, w, 1);
  });
  const palletTop = face(36, 36, (g, w, h) => {
    g.fillStyle = '#2a1a0a'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#9a764a'; for (let x = 0; x < w; x += 7) g.fillRect(x, 0, 5, h);
  });
  const crate = propFrames([
    { x: 0, y: 0, z: 0, w: 0.9, d: 0.9, h: 0.12, faces: { side: pallet, top: palletTop } },
    { x: 0, y: 0, z: 0.12, w: 0.78, d: 0.78, h: 0.6, faces: { front: cardboard('front'), back: cardboard('label'), left: cardboard('side'), right: cardboard('side'), top: cardTop } },
  ], 1.35);

  const upsFront = face(28, 30, (g, w, h) => {
    g.fillStyle = '#1a1c20'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#2c3038'; g.fillRect(0, 0, w, 1.5);
    g.fillStyle = '#f2c230'; g.fillRect(0, 9, w, 8);
    g.fillStyle = '#111'; g.font = 'bold 4.5px monospace'; g.fillText('UPS 48V', 3, 15);
    for (let x = 4; x < 20; x += 4) { g.fillStyle = '#3dff6a'; g.fillRect(x, 22, 2.4, 1.4); }
    g.fillStyle = '#c21d1d'; g.fillRect(21, 21, 4, 3);
    g.fillStyle = '#f2c230'; g.beginPath(); g.moveTo(14, 25); g.lineTo(17, 29); g.lineTo(11, 29); g.fill();
  });
  const upsSide = face(22, 30, (g, w, h) => {
    g.fillStyle = '#16181b'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#2c3038'; for (let y = 5; y < 26; y += 3) g.fillRect(3, y, w - 6, 1.2);
    g.fillStyle = '#f2c230'; g.fillRect(0, 9, w, 2);
  });
  const upsTop = face(28, 22, (g, w, h) => { g.fillStyle = '#23262b'; g.fillRect(0, 0, w, h); g.fillStyle = '#34383f'; g.fillRect(2, 2, w - 4, h - 4); });
  const red = face(4, 4, (g) => { g.fillStyle = '#c21d1d'; g.fillRect(0, 0, 4, 4); });
  const blk = face(4, 4, (g) => { g.fillStyle = '#111'; g.fillRect(0, 0, 4, 4); });
  const ups = propFrames([
    { x: 0, y: 0, z: 0, w: 0.56, d: 0.44, h: 0.6, faces: { front: upsFront, back: upsFront, left: upsSide, right: upsSide, top: upsTop } },
    { x: -0.14, y: 0, z: 0.6, w: 0.08, d: 0.08, h: 0.05, faces: { side: red, top: red } },
    { x: 0.14, y: 0, z: 0.6, w: 0.08, d: 0.08, h: 0.05, faces: { side: blk, top: blk } },
  ], 1.1);

  const coolerFront = face(20, 40, (g, w, h) => {
    g.fillStyle = '#e8ebee'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#c9cdd1'; g.fillRect(0, 0, w, 1.5);
    g.fillStyle = '#2a2e34'; g.fillRect(3, 6, 14, 10);
    g.fillStyle = '#c21d1d'; g.fillRect(5, 8, 3, 4); g.fillStyle = '#1f58d6'; g.fillRect(12, 8, 3, 4);
    g.fillStyle = '#9aa1a8'; g.fillRect(3, 18, 14, 2);
    g.fillStyle = '#1f58d6'; g.fillRect(3, 30, 14, 3);
  });
  const coolerSide = face(20, 40, (g, w, h) => { g.fillStyle = '#dde1e5'; g.fillRect(0, 0, w, h); g.fillStyle = '#b8bec4'; for (let y = 26; y < 38; y += 3) g.fillRect(3, y, w - 6, 1); });
  const coolerTop = face(20, 20, (g, w, h) => { g.fillStyle = '#c9cdd1'; g.fillRect(0, 0, w, h); ell(g, w / 2, h / 2, 6, 6, '#8a9098'); });
  const cooler = propFrames([
    { x: 0, y: 0, z: 0, w: 0.32, d: 0.32, h: 0.62, faces: { front: coolerFront, back: coolerSide, left: coolerSide, right: coolerSide, top: coolerTop } },
  ], 1.2, (g, yaw, ppu, cx, baseY) => {
    // water jug: a cylinder, the same from every angle
    const top = baseY - 0.62 * Math.cos(PITCH) * ppu, r = 0.15 * ppu, hgt = 0.34 * ppu;
    g.fillStyle = 'rgba(70,150,255,0.95)';
    g.fillRect(cx - r, top - hgt, r * 2, hgt);
    ell(g, cx, top - hgt, r, r * 0.35, 'rgba(120,190,255,1)');
    ell(g, cx, top, r, r * 0.35, 'rgba(50,120,230,1)');
    g.fillStyle = 'rgba(210,235,255,0.9)'; g.fillRect(cx - r * 0.6, top - hgt * 0.9, r * 0.25, hgt * 0.75);
    g.fillStyle = 'rgba(40,100,210,1)'; g.fillRect(cx - r, top - hgt * 0.45, r * 2, r * 0.25);
  });

  // fire extinguisher: a cylinder, drawn once with shading
  const ext = makeSprite((g) => {
    const gr = g.createLinearGradient(27, 0, 38, 0);
    gr.addColorStop(0, '#6a0808'); gr.addColorStop(0.35, '#e83a3a'); gr.addColorStop(1, '#700a0a');
    g.fillStyle = gr; g.fillRect(27, 38, 11, 25);
    ell(g, 32.5, 38, 5.5, 2.5, '#a81818');
    g.fillStyle = '#222'; g.fillRect(30, 32, 5, 6); g.fillRect(35, 33, 7, 2);
    cable(g, [[36, 35], [42, 40], [40, 50]], '#1a1a1a', 1.4);
    g.fillStyle = '#eee'; g.fillRect(28.5, 46, 8, 6); g.fillStyle = '#c21d1d'; g.font = '3px monospace'; g.fillText('CO2', 29.5, 50.5);
  }, true);

  return { x: crate, B: ups, f: cooler, e: { frames: [ext], scale: 0.6, z: 0 } };
}

/* items */
function drawItem(type) {
  return (g) => {
    switch (type) {
      case '+': // coffee
        g.fillStyle = '#eee'; g.fillRect(24, 46, 14, 16);
        g.fillStyle = '#6b3b1a'; g.fillRect(25, 46, 12, 3);
        g.strokeStyle = '#eee'; g.lineWidth = 2; g.beginPath(); g.arc(39, 53, 4, -Math.PI / 2, Math.PI / 2); g.stroke();
        g.fillStyle = '#c21d1d'; g.fillRect(24, 52, 14, 3);
        g.strokeStyle = 'rgba(230,230,230,0.9)'; g.lineWidth = 1;
        g.beginPath(); g.moveTo(28, 44); g.quadraticCurveTo(26, 40, 29, 36); g.moveTo(33, 44); g.quadraticCurveTo(35, 40, 32, 35); g.stroke();
        break;
      case 'H': // medkit
        g.fillStyle = '#f2f2f2'; g.fillRect(18, 44, 28, 20);
        g.fillStyle = '#bbb'; g.fillRect(18, 44, 28, 2);
        g.fillStyle = '#d81e1e'; g.fillRect(29, 47, 6, 14); g.fillRect(25, 51, 14, 6);
        break;
      case 'A': // firewall
        g.fillStyle = '#b8471a'; g.beginPath(); g.moveTo(32, 30); g.lineTo(48, 36); g.lineTo(46, 54); g.lineTo(32, 64); g.lineTo(18, 54); g.lineTo(16, 36); g.closePath(); g.fill();
        g.fillStyle = '#e8741a';
        for (let y = 38; y < 58; y += 5) for (let x = 20 + ((y / 5) % 2) * 4; x < 44; x += 8) g.fillRect(x, y, 6, 3);
        g.fillStyle = '#ffdf40'; g.beginPath(); g.moveTo(32, 36); g.lineTo(37, 46); g.lineTo(32, 43); g.lineTo(27, 46); g.fill();
        break;
      case 'a': // box of cage nuts
        g.fillStyle = '#6b4a2a'; g.fillRect(16, 50, 32, 14);
        g.fillStyle = '#8a6438'; g.fillRect(16, 50, 32, 3);
        for (let i = 0; i < 4; i++) drawCageNut(g, 21 + i * 7, 47, 0.45, i * 0.4);
        g.fillStyle = '#fff'; g.font = '5px monospace'; g.fillText('M6 x50', 19, 61);
        break;
      case 's': // jumbo frames
        g.fillStyle = '#7a1a1a'; g.fillRect(18, 48, 28, 16);
        g.fillStyle = '#a82a2a'; g.fillRect(18, 48, 28, 3);
        g.fillStyle = '#e03030'; for (let x = 21; x < 44; x += 5) g.fillRect(x, 42, 3, 7);
        g.fillStyle = '#e8c21a'; for (let x = 21; x < 44; x += 5) g.fillRect(x, 47, 3, 2);
        break;
      case 'c': // energy cell
        g.fillStyle = '#2a2f35'; g.fillRect(22, 40, 20, 24);
        g.fillStyle = '#3dff6a'; g.fillRect(25, 44, 14, 16);
        g.fillStyle = '#b6ffbf'; g.fillRect(25, 44, 14, 3);
        g.fillStyle = '#555'; g.fillRect(28, 37, 8, 3);
        break;
      case 'r': case 'u': { // badges
        const col = type === 'r' ? '#d42020' : '#1f58d6';
        g.fillStyle = '#e8e8e8'; g.fillRect(22, 44, 20, 14);
        g.fillStyle = col; g.fillRect(22, 44, 20, 4);
        g.fillStyle = '#c9a227'; g.fillRect(25, 51, 5, 4);
        g.fillStyle = '#666'; g.fillRect(33, 51, 7, 1); g.fillRect(33, 54, 5, 1);
        g.strokeStyle = col; g.lineWidth = 1; g.beginPath(); g.moveTo(32, 44); g.lineTo(28, 34); g.lineTo(36, 34); g.closePath(); g.stroke();
        break;
      }
      case 'F': // packet shotgun
        g.fillStyle = '#3a2a1a'; g.fillRect(8, 52, 16, 6);
        g.fillStyle = '#555c64'; g.fillRect(22, 50, 34, 4); g.fillRect(22, 55, 34, 3);
        g.fillStyle = '#2a2e34'; g.fillRect(26, 58, 12, 3);
        break;
      case 'M': // Gatling riveter
        g.fillStyle = '#444a52'; g.fillRect(10, 48, 22, 12);
        for (let i = 0; i < 4; i++) { g.fillStyle = i % 2 ? '#6a717a' : '#555c64'; g.fillRect(30, 49 + i * 3, 26, 2); }
        g.fillStyle = '#e8c21a'; g.fillRect(14, 58, 10, 5);
        break;
      case 'L': // Overclock cannon
        g.fillStyle = '#2a2f35'; g.fillRect(10, 46, 40, 14);
        g.fillStyle = '#3cf'; g.fillRect(14, 50, 24, 6);
        g.fillStyle = '#9ef'; g.fillRect(14, 50, 24, 2);
        g.fillStyle = '#555'; g.fillRect(48, 49, 8, 8);
        break;
      case 'x': // pallet of boxed servers
        g.fillStyle = '#6b4a2a'; g.fillRect(6, 58, 52, 6);
        g.fillStyle = '#b58a55'; g.fillRect(8, 22, 48, 36);
        g.fillStyle = '#9a7445'; g.fillRect(8, 38, 48, 2); g.fillRect(31, 22, 2, 36);
        g.fillStyle = '#d8b882'; g.fillRect(8, 22, 48, 3);
        g.fillStyle = '#222'; g.font = 'bold 6px monospace'; g.fillText('FRAGILE', 12, 33); g.fillText('1U x4', 36, 50);
        g.strokeStyle = '#222'; g.beginPath(); g.moveTo(14, 44); g.lineTo(14, 52); g.moveTo(12, 46); g.lineTo(14, 44); g.lineTo(16, 46); g.stroke();
        break;
      case 'j': // energy drink
        g.fillStyle = '#1a1a1a'; g.fillRect(26, 38, 12, 26);
        g.fillStyle = '#3dff6a'; g.fillRect(26, 44, 12, 12);
        g.fillStyle = '#111'; g.font = 'bold 7px monospace'; g.fillText('24', 27, 53);
        g.fillStyle = '#aaa'; g.fillRect(27, 36, 10, 2);
        break;
      case 'k': // SFP modules (rockets)
        g.fillStyle = '#2a2e34'; g.fillRect(16, 48, 32, 16);
        g.fillStyle = '#454b53'; g.fillRect(16, 48, 32, 3);
        for (let x = 19; x < 46; x += 7) { g.fillStyle = '#c9cdd1'; g.fillRect(x, 38, 5, 12); g.fillStyle = '#1f58d6'; g.fillRect(x, 36, 5, 3); }
        g.fillStyle = '#e8c21a'; g.font = '5px monospace'; g.fillText('SFP+', 24, 60);
        break;
      case 'g': // hard drive
        drawHdd(g, 32, 50, 1.3, 0);
        break;
      case 'K': // SFP bazooka
        g.fillStyle = '#3a4a2a'; g.fillRect(6, 48, 52, 9);
        g.fillStyle = '#4c6038'; g.fillRect(6, 48, 52, 2);
        g.fillStyle = '#222'; g.fillRect(24, 57, 6, 6); g.fillRect(36, 57, 4, 5);
        g.fillStyle = '#c9cdd1'; g.fillRect(56, 49, 6, 7); g.fillStyle = '#1f58d6'; g.fillRect(58, 47, 3, 2);
        break;
      case 'G': // stack of hard drives
        drawHdd(g, 32, 60, 1.4, 0); drawHdd(g, 30, 52, 1.4, 0); drawHdd(g, 33, 44, 1.4, 0);
        break;
      case 'Y': // ZIP compressor
        g.fillStyle = '#6a4ae0'; g.fillRect(10, 44, 44, 14);
        g.fillStyle = '#8a6aff'; g.fillRect(10, 44, 44, 3);
        g.fillStyle = '#e8c21a'; g.fillRect(22, 44, 6, 14);
        for (let y = 46; y < 58; y += 3) { g.fillStyle = '#555'; g.fillRect(23, y, 4, 1); }
        g.fillStyle = '#3dff6a'; g.fillRect(52, 48, 8, 6);
        g.fillStyle = '#fff'; g.font = 'bold 6px monospace'; g.fillText('ZIP', 33, 54);
        break;
      case 'B': // UPS battery
        g.fillStyle = '#1a1c20'; g.fillRect(14, 22, 36, 42);
        g.fillStyle = '#2c3038'; g.fillRect(14, 22, 36, 4);
        g.fillStyle = '#f2c230'; g.fillRect(14, 36, 36, 12);
        g.fillStyle = '#111'; g.font = 'bold 6px monospace'; g.fillText('UPS 48V', 17, 44);
        g.fillStyle = '#c21d1d'; g.fillRect(18, 18, 6, 4); g.fillStyle = '#222'; g.fillRect(40, 18, 6, 4);
        g.fillStyle = '#3dff6a'; g.fillRect(18, 54, 4, 2); g.fillRect(24, 54, 4, 2); g.fillRect(30, 54, 4, 2);
        break;
      case 'f': // water cooler
        g.fillStyle = '#d8dde3'; g.fillRect(22, 36, 20, 28);
        g.fillStyle = '#aab'; g.fillRect(22, 36, 20, 2);
        g.fillStyle = 'rgba(80,160,255,0.95)'; g.beginPath(); g.ellipse(32, 24, 11, 13, 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#bfe0ff'; g.fillRect(26, 16, 3, 10);
        g.fillStyle = '#1f58d6'; g.fillRect(28, 34, 8, 3);
        g.fillStyle = '#c21d1d'; g.fillRect(26, 44, 3, 3); g.fillStyle = '#1f58d6'; g.fillRect(35, 44, 3, 3);
        break;
      case 'e': // fire extinguisher
        g.fillStyle = '#b01515'; g.fillRect(28, 38, 9, 26);
        g.fillStyle = '#d82a2a'; g.fillRect(28, 38, 3, 26);
        g.fillStyle = '#222'; g.fillRect(29, 33, 7, 5); g.fillRect(36, 34, 6, 2); g.fillRect(40, 36, 2, 10);
        g.fillStyle = '#eee'; g.fillRect(29, 46, 7, 6);
        break;
    }
  };
}

function orbSprite(core, glow, r) {
  return makeSprite((g) => {
    ell(g, 32, 32, r, r, glow);
    ell(g, 32, 32, r * 0.6, r * 0.6, core);
    ell(g, 32, 32, r * 0.25, r * 0.25, '#fff');
  });
}

function sparkSprite(cols, n, seed) {
  return makeSprite((g) => {
    const R = rng(seed);
    for (let i = 0; i < n; i++) {
      const a = R() * Math.PI * 2, d = R() * 14;
      g.fillStyle = cols[i % cols.length];
      g.fillRect(32 + Math.cos(a) * d, 32 + Math.sin(a) * d, 2 + R() * 3, 2 + R() * 3);
    }
  });
}

/* -------------------------------------------------------------- assembly */

const Assets = {};

function buildAssets() {
  const variants = (fn, n, frames) => {
    const out = [];
    for (let v = 0; v < n; v++) {
      const fr = [];
      for (let f = 0; f < frames; f++) fr.push(makeTexture(fn, 11 + v * 17, 101 + v * 31 + f * 7));
      out.push(fr);
    }
    return out;
  };
  Assets.walls = {
    '#': variants(concrete(0), 2, 1),
    'W': variants(drawWarning, 1, 1),
    'R': variants(drawRack('R'), 3, 2),
    'S': variants(drawRack('S'), 2, 2),
    'N': variants(drawRack('N'), 3, 2),
    'C': variants(drawCrac, 1, 2),
    'D': variants(drawDoor(null), 1, 1),
    '1': variants(drawDoor('red'), 1, 2),
    '2': variants(drawDoor('blue'), 1, 2),
    'X': variants(drawExit, 1, 2),
  };
  for (const [ch, brand] of Object.entries(SPECIAL_TILES)) Assets.walls[ch] = variants(specialRack(brand), 1, 2);
  // concrete (and secret fake walls) in each episode's colors
  Assets.concrete = [0, 1, 2, 3, 4].map((ep) => variants(concrete(ep), 2, 1));
  Assets.floor = [makeTexture(drawFloor(false), 5), makeTexture(drawFloor(true), 6)];
  Assets.ceil = [makeTexture(drawCeiling('plain'), 7), makeTexture(drawCeiling('light'), 8), makeTexture(drawCeiling('tray'), 9)];

  Assets.enemies = {
    bug: buildEnemySprites(drawBug, ['#2c9a37', '#1b4d21', '#3fc24c', '#ff00ff'], 3),
    drone: buildEnemySprites(drawDrone, ['#8d2468', '#d93a8f', '#7a1f5c', '#f2f2f2'], 4),
    bot: buildEnemySprites(drawBot, ['#50565e', '#3c4148', '#1a5fd0', '#2b2f35'], 5),
    troll: buildEnemySprites(drawTroll, ['#5f8a3a', '#3d5a2a', '#2c3038', '#f2f2e0'], 7),
    spam: buildEnemySprites(drawSpammer, ['#f2efe0', '#b8b0a0', '#c21d1d', '#222'], 8),
  };
  let bs = 10;
  for (const [k, pal] of Object.entries(BOSS_PAL)) Assets.enemies[k] = buildEnemySprites(drawBoss(pal), [pal.body, pal.head, '#e8c21a', pal.dark], bs++);
  Assets.enemies.spaghetti = buildEnemySprites(drawSpaghetti, ['#e8c21a', '#2a7de1', '#e8741a', '#d92d7a'], 20);
  Assets.enemies.hotspot = buildEnemySprites(drawHotspot, ['#3a1a0a', '#6a2a0a', '#222', '#555'], 21);
  Assets.enemies.storm = buildEnemySprites(drawStorm, ['#3a3f4a', '#5a6070', '#f2f2f2', '#ffe14a'], 22);
  Assets.enemies.bitrot = buildEnemySprites(drawBitrot, ['#1d2a4a', '#4a7a2a', '#6b4a2a', '#2a2a2a'], 23);
  Assets.enemies.shadowit = buildEnemySprites(drawShadowIT, ['#1a1426', '#2c2240', '#e8c21a', '#555'], 24);
  Assets.items = {};
  for (const k of '+HAascruFMLejkgKGY') Assets.items[k] = makeSprite(drawItem(k), true);
  Assets.decor = buildDecor();
  Assets.proj = {
    orb: orbSprite('#ff3bd0', '#7a1f5c', 7),
    bolt: orbSprite('#ffe14a', '#ff5a1a', 5),
    boss: orbSprite('#c04dff', '#4a0f7a', 10),
    plasma: orbSprite('#9ef', '#1a7de1', 7),
    zip: orbSprite('#d6c8ff', '#6a4ae0', 6),
    miner: orbSprite('#ffe14a', '#a86a00', 10),
    botnet: orbSprite('#b6ffbf', '#1f6a24', 10),
    zeroday: orbSprite('#e0ffff', '#008aa8', 10),
    fire: [0, 1].map((i) => makeSprite((g) => { ell(g, 32, 32, 10 + i, 10 + i, '#c8300a'); ell(g, 32, 33, 7, 7, '#ff8a1a'); ell(g, 32, 34, 4, 4, '#ffe890'); })),
    rot: orbSprite('#c8ff7a', '#3a6a1a', 8),
    packet: makeSprite((g) => { g.fillStyle = '#f2f2f2'; g.fillRect(22, 26, 20, 13); g.fillStyle = '#2a7de1'; g.fillRect(22, 26, 20, 4); g.fillStyle = '#ffe14a'; g.fillRect(24, 32, 16, 1.5); g.fillRect(24, 35, 10, 1.5); }, true),
    plug: [0, 1].map((i) => makeSprite((g) => { g.save(); g.translate(32, 32); g.rotate(i * Math.PI / 2); g.fillStyle = '#e8c21a'; g.fillRect(-4, -8, 8, 10); g.fillStyle = 'rgba(220,240,255,0.9)'; g.fillRect(-5, 2, 10, 7); g.fillStyle = '#c9a227'; for (let k = -4; k < 5; k += 2) g.fillRect(k, 7, 1, 2); g.restore(); }, true)),
    card: [0, 1, 2, 3].map((i) => makeSprite((g) => { g.save(); g.translate(32, 32); g.rotate(i * Math.PI / 4); g.fillStyle = '#e8c21a'; g.fillRect(-10, -6, 20, 12); g.fillStyle = '#222'; g.fillRect(-10, -3, 20, 3); g.fillStyle = '#c9a227'; g.fillRect(-7, 1, 5, 3); g.restore(); }, true)),
    nut: [0, 1, 2, 3].map((i) => makeSprite((g) => drawCageNut(g, 32, 32, 1.3, i * Math.PI / 8))),
    hdd: [0, 1, 2, 3].map((i) => makeSprite((g) => drawHdd(g, 32, 32, 1.6, i * Math.PI / 2))),
    sfp: [0, 1].map((i) => makeSprite((g) => {
      ell(g, 32, 32, 10 + i * 2, 8 + i * 2, '#ff7a1a'); ell(g, 32, 32, 6, 5, '#ffe14a');
      g.fillStyle = '#c9cdd1'; g.fillRect(24, 26, 16, 12); g.fillStyle = '#1f58d6'; g.fillRect(24, 26, 16, 3);
    })),
  };
  Assets.fx = {
    spark: [sparkSprite(['#ffe14a', '#fff', '#ff9a1a'], 14, 1), sparkSprite(['#ff9a1a', '#555'], 8, 2)],
    bigBoom: [sparkSprite(['#fff', '#ffe14a', '#ff9a1a', '#ff5a1a'], 90, 7), sparkSprite(['#ff5a1a', '#ff9a1a', '#555', '#333'], 70, 8), sparkSprite(['#444', '#666', '#ff5a1a'], 40, 9)],
    smoke: [sparkSprite(['#777', '#999', '#555'], 18, 12), sparkSprite(['#555', '#444'], 10, 13)],
    nutanix: [sparkSprite(['#fff', '#7855fa', '#b6a4ff'], 40, 10), sparkSprite(['#7855fa', '#b6a4ff'], 24, 11)],
    boom: [sparkSprite(['#fff', '#ffe14a', '#ff5a1a'], 40, 3), sparkSprite(['#ff5a1a', '#c04dff', '#444'], 30, 4)],
    plasmaHit: [sparkSprite(['#fff', '#9ef', '#3cf'], 26, 5), sparkSprite(['#3cf', '#1a7de1'], 14, 6)],
  };
}
