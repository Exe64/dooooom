'use strict';
/*
 * Tout le visuel est généré à la volée sur des canvas 64x64 :
 * textures de murs (baies, clim, portes...), sols, plafonds et sprites.
 * Chaque texture est convertie en Uint32Array (format ABGR little-endian)
 * accompagnée d'un masque "émissif" (pixels non assombris par la distance : LEDs, écrans).
 */
const TEX = 64;

function rng(seed) {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
}

function newCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function makeTexture(draw, seed = 1, ledSeed = 1) {
  const c = newCanvas(TEX, TEX);
  const g = c.getContext('2d');
  const em = new Uint8Array(TEX * TEX);
  const R = rng(seed), L = rng(ledSeed);
  const led = (x, y, w, h, col) => {
    g.fillStyle = col; g.fillRect(x, y, w, h);
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++)
      if (i >= 0 && i < TEX && j >= 0 && j < TEX) em[j * TEX + i] = 1;
  };
  draw(g, R, led, L);
  const px = new Uint32Array(g.getImageData(0, 0, TEX, TEX).data.buffer);
  return { px, em, canvas: c };
}

function noiseFill(g, R, x, y, w, h, r, gg, b, amp) {
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) {
    const n = (R() - 0.5) * amp;
    g.fillStyle = `rgb(${(r + n) | 0},${(gg + n) | 0},${(b + n) | 0})`;
    g.fillRect(i, j, 1, 1);
  }
}

/* ------------------------------------------------------------------ murs */

const EP_STRIPES = [['#1f4f7a', '#2e6da6'], ['#1f6a7a', '#3aa6c0'], ['#7a5a1f', '#c0902e'], ['#4a3a6a', '#7a62a6'], ['#7a1f2a', '#c0303e']];
function concrete(ep) { return (g, R) => drawConcrete(g, R, ep); }
function drawConcrete(g, R, ep = 0) {
  noiseFill(g, R, 0, 0, 64, 64, 92, 95, 100, 16);
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.fillRect(0, 0, 64, 1); g.fillRect(0, 0, 1, 64); g.fillRect(32, 0, 1, 40);
  g.fillStyle = 'rgba(255,255,255,0.08)';
  g.fillRect(1, 1, 63, 1); g.fillRect(33, 1, 1, 39);
  // bandeau bleu peint (signalétique datacenter)
  g.fillStyle = EP_STRIPES[ep][0]; g.fillRect(0, 40, 64, 6);
  g.fillStyle = EP_STRIPES[ep][1]; g.fillRect(0, 40, 64, 1);
  // plinthe
  g.fillStyle = '#3a3d42'; g.fillRect(0, 58, 64, 6);
  // taches
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
    // porte vitrée perforée : petits reflets
    let y = 4;
    while (y < 60) {
      const u = kind === 'S' ? 8 : (R() < 0.3 ? 8 : 5);
      if (y + u > 61) break;
      g.fillStyle = kind === 'S' ? '#1d2430' : kind === 'N' ? '#1a211d' : (R() < 0.5 ? '#262a30' : '#2e3238');
      g.fillRect(5, y, 54, u - 1);
      g.fillStyle = 'rgba(255,255,255,0.1)'; g.fillRect(5, y, 54, 1);
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
        for (let i = 7; i < 55; i += 3) {
          g.fillStyle = '#050505'; g.fillRect(i, y + 1, 2, 2);
          if (L() < 0.6) led(i, y + 3, 1, 1, L() < 0.6 ? '#3dff6a' : '#ffb52e');
        }
      }
      y += u;
    }
    if (kind === 'N') {
      const cols = ['#e8c21a', '#2a7de1', '#e8741a', '#d92d7a', '#8ad13a', '#e8e8e8'];
      for (let k = 0; k < 11; k++) {
        g.strokeStyle = cols[k % cols.length]; g.lineWidth = 1;
        g.beginPath();
        const x0 = 8 + R() * 46, y0 = 5 + R() * 45;
        g.moveTo(x0, y0);
        g.quadraticCurveTo(x0 + (R() - 0.5) * 22, 62, x0 + (R() - 0.5) * 18, 64);
        g.stroke();
      }
    }
    // étiquette
    g.fillStyle = '#d8d8d0'; g.fillRect(24, 0, 16, 3);
  };
}

function drawCrac(g, R, led, L) {
  noiseFill(g, R, 0, 0, 64, 64, 196, 200, 204, 10);
  g.fillStyle = '#8d9399'; g.fillRect(0, 0, 64, 2); g.fillRect(0, 62, 64, 2); g.fillRect(0, 0, 2, 64); g.fillRect(31, 0, 2, 64); g.fillRect(62, 0, 2, 64);
  // grille de ventilation
  for (let y = 22; y < 58; y += 3) {
    g.fillStyle = '#5d636a'; g.fillRect(5, y, 23, 2); g.fillRect(36, y, 23, 2);
  }
  // écran de contrôle
  led(6, 6, 20, 10, '#082034');
  g.fillStyle = '#5fd3ff'; g.font = '7px monospace'; g.fillText('18°C', 8, 14);
  led(37, 8, 3, 2, L() < 0.8 ? '#3dff6a' : '#ff3b3b');
  g.fillStyle = '#2e6da6'; g.fillRect(43, 7, 16, 4);
  g.fillStyle = '#7a8087'; g.fillRect(37, 14, 22, 2);
}

function drawDoor(kind) {
  return (g, R, led, L) => {
    noiseFill(g, R, 0, 0, 64, 64, 110, 118, 128, 10);
    g.fillStyle = '#4d535b'; g.fillRect(0, 0, 64, 3); g.fillRect(0, 0, 3, 64); g.fillRect(61, 0, 3, 64);
    for (let x = 8; x < 58; x += 8) { g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x, 4, 1, 44); g.fillStyle = 'rgba(255,255,255,0.1)'; g.fillRect(x + 1, 4, 1, 44); }
    // hublot
    g.fillStyle = '#20262d'; g.fillRect(20, 10, 24, 16);
    g.fillStyle = '#0d1e2e'; g.fillRect(22, 12, 20, 12);
    g.fillStyle = 'rgba(120,180,255,0.35)'; g.fillRect(23, 13, 6, 2); g.fillRect(23, 15, 3, 3);
    // bandes de danger
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
      g.fillText(kind === 'red' ? 'ACCÈS ROUGE' : 'ACCÈS BLEU', 32, 38);
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

/* ------------------------------------------------------------- sols/plafonds */

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

function drawCeiling(light) {
  return (g, R, led) => {
    noiseFill(g, R, 0, 0, 64, 64, 44, 47, 52, 6);
    g.fillStyle = '#1c1e22'; g.fillRect(0, 0, 64, 1); g.fillRect(0, 0, 1, 64);
    if (light) {
      g.fillStyle = '#6c7078'; g.fillRect(10, 22, 44, 20);
      led(12, 24, 40, 16, '#dfe9f5');
      g.fillStyle = '#b8c6d6'; for (let x = 16; x < 50; x += 6) g.fillRect(x, 24, 1, 16);
    } else {
      // chemin de câbles
      g.fillStyle = '#3a3f45'; g.fillRect(26, 0, 12, 64);
      g.fillStyle = '#e8c21a'; g.fillRect(28, 0, 2, 64);
      g.fillStyle = '#2a7de1'; g.fillRect(31, 0, 2, 64);
      g.fillStyle = '#e8741a'; g.fillRect(34, 0, 2, 64);
    }
  };
}

/* ----------------------------------------------------------------- sprites */

function makeSprite(draw, size = 64) {
  const c = newCanvas(size, size);
  const g = c.getContext('2d');
  draw(g);
  return spriteFromCanvas(c);
}

function spriteFromCanvas(c) {
  const g = c.getContext('2d');
  const d = g.getImageData(0, 0, c.width, c.height).data;
  const px = new Uint32Array(d.buffer.slice(0));
  // alpha binaire
  for (let i = 0; i < px.length; i++) if ((px[i] >>> 24) < 110) px[i] = 0; else px[i] |= 0xff000000;
  return { px, w: c.width, h: c.height, canvas: c };
}

function ell(g, x, y, rx, ry, col) { g.fillStyle = col; g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); g.fill(); }
function ln(g, x0, y0, x1, y1, col, w) { g.strokeStyle = col; g.lineWidth = w; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); }

// Bug : insecte-glitch vert fluo
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

// Drone viral : sphère à spicules (façon virus) avec un œil
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
  // hélice/antigrav
  g.fillStyle = '#3cf'; g.fillRect(24, 52, 16, 2 + phase);
}

// Bot BSOD : robot avec un moniteur écran bleu en guise de tête
function drawBot(g, phase, atk) {
  const lo = phase ? 3 : -3;
  // jambes
  g.fillStyle = '#3c4148'; g.fillRect(22, 44, 7, 18 + lo); g.fillRect(35, 44, 7, 18 - lo);
  g.fillStyle = '#1b1e22'; g.fillRect(20, 60 + lo, 10, 4 - Math.max(0, lo)); g.fillRect(33, 60 - lo, 10, 4 - Math.max(0, -lo));
  // torse (tour de serveur)
  g.fillStyle = '#50565e'; g.fillRect(18, 24, 28, 22);
  g.fillStyle = '#6a717a'; g.fillRect(18, 24, 28, 2);
  g.fillStyle = '#23262b'; for (let y = 29; y < 44; y += 3) g.fillRect(22, y, 12, 1);
  g.fillStyle = '#3dff6a'; g.fillRect(38, 30, 2, 2); g.fillStyle = '#ffb52e'; g.fillRect(38, 34, 2, 2);
  // bras + arme
  g.fillStyle = '#3c4148'; g.fillRect(10, 26, 7, 16); g.fillRect(47, 26, 7, 12);
  g.fillStyle = '#222'; g.fillRect(44, 36, 16, 6); g.fillRect(52, 34, 4, 2);
  if (atk) { ell(g, 60, 39, 5, 5, '#ffee55'); ell(g, 60, 39, 2.5, 2.5, '#fff'); }
  // tête moniteur BSOD
  g.fillStyle = '#2b2f35'; g.fillRect(16, 2, 32, 22);
  g.fillStyle = '#1a5fd0'; g.fillRect(18, 4, 28, 17);
  g.fillStyle = '#fff'; g.font = 'bold 10px monospace'; g.fillText(':(', 21, 15);
  g.fillRect(34, 8, 9, 1); g.fillRect(34, 11, 7, 1); g.fillRect(34, 14, 9, 1); g.fillRect(34, 17, 5, 1);
  g.fillStyle = '#2b2f35'; g.fillRect(28, 21, 8, 4);
}

// Boss : cinq variantes (une par épisode), même carcasse, couleurs et emblème différents
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
    // cadenas
    g.strokeStyle = '#e8c21a'; g.lineWidth = 3; g.beginPath(); g.arc(32, 35, 5, Math.PI, 0); g.stroke();
    g.fillStyle = '#e8c21a'; g.fillRect(25, 35, 14, 11);
    g.fillStyle = '#000'; g.fillRect(31, 38, 2, 5);
    // bras-canons
    g.fillStyle = pal.dark; g.fillRect(0, 28, 10, 20); g.fillRect(54, 28, 10, 20);
    g.fillStyle = '#111'; g.fillRect(1, 46, 8, 6); g.fillRect(55, 46, 8, 6);
    if (atk) { ell(g, 5, 55, 5, 5, pal.shot); ell(g, 59, 55, 5, 5, pal.shot); ell(g, 5, 55, 2, 2, '#fff'); ell(g, 59, 55, 2, 2, '#fff'); }
    // crâne
    ell(g, 32, 14, 16, 14, pal.head);
    g.fillStyle = pal.head; g.fillRect(22, 18, 20, 10);
    ell(g, 25, 13, 5, 5, '#000'); ell(g, 39, 13, 5, 5, '#000');
    ell(g, 25, 13, 2, 2, atk ? '#fff' : pal.eye); ell(g, 39, 13, 2, 2, atk ? '#fff' : pal.eye);
    g.fillStyle = '#000'; g.beginPath(); g.moveTo(32, 17); g.lineTo(29, 22); g.lineTo(35, 22); g.fill();
    for (let x = 23; x < 42; x += 3) g.fillRect(x, 24, 1, 4);
    g.fillStyle = pal.eye; g.font = 'bold 7px monospace'; g.fillText(pal.glyph[0], 1, 8 + phase * 2); g.fillText(pal.glyph[1], 56, 10 - phase * 2);
  };
}

// Troll de forum : grosse brute verte avec une pancarte "FIRST!"
function drawTroll(g, phase, atk) {
  const lo = phase ? 3 : -3;
  g.fillStyle = '#3d5a2a'; g.fillRect(18, 46, 10, 18 + Math.min(0, lo)); g.fillRect(36, 46, 10, 18 - Math.max(0, lo));
  ell(g, 32, 38, 20, 16, '#5f8a3a');
  ell(g, 32, 42, 12, 9, '#7aa84c');
  g.fillStyle = '#5a3a1a'; g.fillRect(12, 48, 40, 6);
  // bras + massue (clavier ergonomique cassé)
  ell(g, 11, 36, 6, 9, '#5f8a3a'); ell(g, 53, 36, 6, 9, '#5f8a3a');
  const cx = atk ? 60 : 56, cy = atk ? 8 : 16;
  g.save(); g.translate(cx, cy); g.rotate(atk ? 0.9 : 0.2);
  g.fillStyle = '#2c3038'; g.fillRect(-4, -2, 8, 30);
  g.fillStyle = '#d9dde2'; for (let y = 0; y < 26; y += 4) g.fillRect(-3, y, 6, 2);
  g.restore();
  // pancarte
  g.fillStyle = '#6b4a2a'; g.fillRect(6, 10, 2, 28);
  g.fillStyle = '#f2f2e0'; g.fillRect(0, 6, 20, 11);
  g.fillStyle = '#c21d1d'; g.font = 'bold 6px monospace'; g.fillText('FIRST!', 1, 14);
  // tête
  ell(g, 32, 18, 12, 11, '#6f9a44');
  ell(g, 26, 16, 3, 3, '#fff'); ell(g, 38, 16, 3, 3, '#fff');
  g.fillStyle = '#c00'; g.fillRect(26, 16, 2, 2); g.fillRect(38, 16, 2, 2);
  g.fillStyle = '#2a3a1a'; g.fillRect(24, 11, 6, 2); g.fillRect(35, 11, 6, 2);
  g.fillStyle = '#2a1a0a'; g.fillRect(27, 23, 11, atk ? 5 : 2);
  g.fillStyle = '#f2f2e0'; g.fillRect(28, 23, 2, 3); g.fillRect(35, 23, 2, 3);
  ell(g, 20, 12, 3, 5, '#6f9a44'); ell(g, 44, 12, 3, 5, '#6f9a44');
}

// Spammeur : enveloppe ambulante qui crache des @
function drawSpammer(g, phase, atk) {
  const lo = phase ? 3 : -3;
  g.fillStyle = '#222'; g.fillRect(22, 48, 5, 16 + Math.min(0, lo)); g.fillRect(37, 48, 5, 16 - Math.max(0, lo));
  g.fillStyle = '#f2efe0'; g.fillRect(10, 18, 44, 32);
  g.strokeStyle = '#b8b0a0'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(10, 18); g.lineTo(32, 38); g.lineTo(54, 18); g.stroke();
  g.fillStyle = '#c21d1d'; g.fillRect(40, 21, 10, 8);
  g.fillStyle = '#fff'; g.font = 'bold 6px monospace'; g.fillText('$', 43, 28);
  // yeux + bouche
  ell(g, 24, 30, 4, 4, '#fff'); ell(g, 40, 34, 4, 4, '#fff');
  ell(g, 24, 30, 2, 2, '#000'); ell(g, 40, 34, 2, 2, '#000');
  ell(g, 32, 44, 7, atk ? 5 : 2, '#600');
  g.fillStyle = atk ? '#ffe14a' : '#e8741a'; g.font = 'bold 10px monospace';
  g.fillText('@', 2, 14 + phase * 2); g.fillText('@', 52, 12 - phase * 2);
  g.fillStyle = '#e8c21a'; g.font = 'bold 5px monospace'; g.fillText('SPAM', 14, 26);
}

// Frame de mort générique : l'image "glitche" en tranches, puis tas de débris.
function glitchFrame(src, amount) {
  const c = newCanvas(64, 64), g = c.getContext('2d');
  const R = rng(amount * 7 + 3);
  for (let y = 0; y < 64; y += 4) {
    const off = ((R() - 0.5) * amount * 2) | 0;
    g.drawImage(src, 0, y, 64, 4, off, y + amount / 2, 64, 4);
  }
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = 'rgba(255,0,80,0.3)'; g.fillRect(0, 0, 64, 64);
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
  const walk = [0, 1].map((p) => makeSprite((g) => drawFn(g, p, false)));
  const atk = makeSprite((g) => drawFn(g, 0, true));
  return {
    walk, atk,
    die: [glitchFrame(walk[0].canvas, 6), glitchFrame(walk[1].canvas, 14)],
    dead: debrisFrame(debrisCols, seed),
  };
}

// Écrou cagé : écrou carré M6 dans sa cage à ressort (ailettes)
function drawCageNut(g, x, y, s, rot) {
  g.save(); g.translate(x, y); g.rotate(rot); g.scale(s, s);
  g.fillStyle = '#8f969e'; g.fillRect(-9, -7, 18, 14);             // cage
  g.fillStyle = '#6a7078'; g.fillRect(-13, -4, 4, 8); g.fillRect(9, -4, 4, 8); // ailettes
  g.fillStyle = '#c9ced4'; g.fillRect(-6, -6, 12, 12);              // écrou
  g.fillStyle = '#e8ecf0'; g.fillRect(-6, -6, 12, 2);
  ell(g, 0, 0, 3.5, 3.5, '#2a2e34');                                // taraudage
  g.restore();
}

// Disque dur 3,5"
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

/* --------------------------------------------- racks spéciaux (hyperviseurs) */

function specialRack(brand) {
  return (g, R, led, L) => {
    drawRack('R')(g, R, led, L);
    const b = BRANDS[brand];
    // bandeau de marque éclairé
    led(4, 3, 56, 24, b.bg);
    b.logo(g);
    g.fillStyle = b.bg; g.fillRect(0, 60, 64, 4);
    // LEDs aux couleurs de la marque sur les serveurs
    for (let y = 31; y < 58; y += 6) led(46 + ((y / 6) % 2) * 4, y, 2, 1, L() < 0.7 ? b.led : '#1a1a1a');
  };
}

// Écrit un texte en réduisant la police jusqu'à ce qu'il tienne dans maxW ; renvoie sa largeur.
function fitText(g, text, x, y, maxW, size, weight = 'bold') {
  let sz = size;
  do { g.font = `${weight} ${sz}px sans-serif`; sz -= 0.5; } while (g.measureText(text).width > maxW && sz > 3);
  g.fillText(text, x, y);
  return g.measureText(text).width;
}

const BRANDS = {
  // Broadcom (VMware ESXi) : rouge Broadcom, pastille ronde à l'onde blanche
  esxi: { name: 'BROADCOM ESXi', bg: '#1c1c1c', led: '#cc092f', logo(g) {
    ell(g, 14, 13, 8, 8, '#cc092f');
    g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.beginPath();
    g.moveTo(8, 15); g.lineTo(11, 15); g.lineTo(13, 8); g.lineTo(15, 17); g.lineTo(17, 11); g.lineTo(18, 15); g.lineTo(21, 15); g.stroke();
    g.fillStyle = '#fff'; fitText(g, 'BROADCOM', 24, 12, 34, 7);
    g.fillStyle = '#cc092f'; fitText(g, 'ESXi', 30, 23, 24, 9);
  } },
  // Proxmox : le "X" orange et noir, fond clair
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
  // Hyper-V : les quatre carrés Microsoft
  hyperv: { name: 'MICROSOFT HYPER-V', bg: '#1b1b1b', led: '#00a4ef', logo(g) {
    g.fillStyle = '#f25022'; g.fillRect(6, 6, 7, 7);
    g.fillStyle = '#7fba00'; g.fillRect(14, 6, 7, 7);
    g.fillStyle = '#00a4ef'; g.fillRect(6, 14, 7, 7);
    g.fillStyle = '#ffb900'; g.fillRect(14, 14, 7, 7);
    g.fillStyle = '#fff'; fitText(g, 'Hyper-V', 24, 17, 34, 9);
  } },
  // Nutanix : fond anthracite, logotype blanc, "X" violet Iris
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

/* objets */
function drawItem(type) {
  return (g) => {
    switch (type) {
      case '+': // café
        g.fillStyle = '#eee'; g.fillRect(24, 46, 14, 16);
        g.fillStyle = '#6b3b1a'; g.fillRect(25, 46, 12, 3);
        g.strokeStyle = '#eee'; g.lineWidth = 2; g.beginPath(); g.arc(39, 53, 4, -Math.PI / 2, Math.PI / 2); g.stroke();
        g.fillStyle = '#c21d1d'; g.fillRect(24, 52, 14, 3);
        g.strokeStyle = 'rgba(230,230,230,0.9)'; g.lineWidth = 1;
        g.beginPath(); g.moveTo(28, 44); g.quadraticCurveTo(26, 40, 29, 36); g.moveTo(33, 44); g.quadraticCurveTo(35, 40, 32, 35); g.stroke();
        break;
      case 'H': // kit de secours
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
      case 'a': // boîte d'écrous cagés
        g.fillStyle = '#6b4a2a'; g.fillRect(16, 50, 32, 14);
        g.fillStyle = '#8a6438'; g.fillRect(16, 50, 32, 3);
        for (let i = 0; i < 4; i++) drawCageNut(g, 21 + i * 7, 47, 0.45, i * 0.4);
        g.fillStyle = '#fff'; g.font = '5px monospace'; g.fillText('M6 x50', 19, 61);
        break;
      case 's': // trames jumbo
        g.fillStyle = '#7a1a1a'; g.fillRect(18, 48, 28, 16);
        g.fillStyle = '#a82a2a'; g.fillRect(18, 48, 28, 3);
        g.fillStyle = '#e03030'; for (let x = 21; x < 44; x += 5) g.fillRect(x, 42, 3, 7);
        g.fillStyle = '#e8c21a'; for (let x = 21; x < 44; x += 5) g.fillRect(x, 47, 3, 2);
        break;
      case 'c': // cellule d'énergie
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
      case 'F': // fusil à paquets
        g.fillStyle = '#3a2a1a'; g.fillRect(8, 52, 16, 6);
        g.fillStyle = '#555c64'; g.fillRect(22, 50, 34, 4); g.fillRect(22, 55, 34, 3);
        g.fillStyle = '#2a2e34'; g.fillRect(26, 58, 12, 3);
        break;
      case 'M': // mitrailleuse
        g.fillStyle = '#444a52'; g.fillRect(10, 48, 22, 12);
        for (let i = 0; i < 4; i++) { g.fillStyle = i % 2 ? '#6a717a' : '#555c64'; g.fillRect(30, 49 + i * 3, 26, 2); }
        g.fillStyle = '#e8c21a'; g.fillRect(14, 58, 10, 5);
        break;
      case 'L': // canon overclock
        g.fillStyle = '#2a2f35'; g.fillRect(10, 46, 40, 14);
        g.fillStyle = '#3cf'; g.fillRect(14, 50, 24, 6);
        g.fillStyle = '#9ef'; g.fillRect(14, 50, 24, 2);
        g.fillStyle = '#555'; g.fillRect(48, 49, 8, 8);
        break;
      case 'x': // palette de serveurs en carton
        g.fillStyle = '#6b4a2a'; g.fillRect(6, 58, 52, 6);
        g.fillStyle = '#b58a55'; g.fillRect(8, 22, 48, 36);
        g.fillStyle = '#9a7445'; g.fillRect(8, 38, 48, 2); g.fillRect(31, 22, 2, 36);
        g.fillStyle = '#d8b882'; g.fillRect(8, 22, 48, 3);
        g.fillStyle = '#222'; g.font = 'bold 6px monospace'; g.fillText('FRAGILE', 12, 33); g.fillText('1U x4', 36, 50);
        g.strokeStyle = '#222'; g.beginPath(); g.moveTo(14, 44); g.lineTo(14, 52); g.moveTo(12, 46); g.lineTo(14, 44); g.lineTo(16, 46); g.stroke();
        break;
      case 'j': // boisson énergisante
        g.fillStyle = '#1a1a1a'; g.fillRect(26, 38, 12, 26);
        g.fillStyle = '#3dff6a'; g.fillRect(26, 44, 12, 12);
        g.fillStyle = '#111'; g.font = 'bold 7px monospace'; g.fillText('24', 27, 53);
        g.fillStyle = '#aaa'; g.fillRect(27, 36, 10, 2);
        break;
      case 'k': // modules SFP (roquettes)
        g.fillStyle = '#2a2e34'; g.fillRect(16, 48, 32, 16);
        g.fillStyle = '#454b53'; g.fillRect(16, 48, 32, 3);
        for (let x = 19; x < 46; x += 7) { g.fillStyle = '#c9cdd1'; g.fillRect(x, 38, 5, 12); g.fillStyle = '#1f58d6'; g.fillRect(x, 36, 5, 3); }
        g.fillStyle = '#e8c21a'; g.font = '5px monospace'; g.fillText('SFP+', 24, 60);
        break;
      case 'g': // disque dur
        drawHdd(g, 32, 50, 1.3, 0);
        break;
      case 'K': // bazooka SFP
        g.fillStyle = '#3a4a2a'; g.fillRect(6, 48, 52, 9);
        g.fillStyle = '#4c6038'; g.fillRect(6, 48, 52, 2);
        g.fillStyle = '#222'; g.fillRect(24, 57, 6, 6); g.fillRect(36, 57, 4, 5);
        g.fillStyle = '#c9cdd1'; g.fillRect(56, 49, 6, 7); g.fillStyle = '#1f58d6'; g.fillRect(58, 47, 3, 2);
        break;
      case 'G': // pile de disques durs
        drawHdd(g, 32, 60, 1.4, 0); drawHdd(g, 30, 52, 1.4, 0); drawHdd(g, 33, 44, 1.4, 0);
        break;
      case 'Y': // compresseur ZIP
        g.fillStyle = '#6a4ae0'; g.fillRect(10, 44, 44, 14);
        g.fillStyle = '#8a6aff'; g.fillRect(10, 44, 44, 3);
        g.fillStyle = '#e8c21a'; g.fillRect(22, 44, 6, 14);
        for (let y = 46; y < 58; y += 3) { g.fillStyle = '#555'; g.fillRect(23, y, 4, 1); }
        g.fillStyle = '#3dff6a'; g.fillRect(52, 48, 8, 6);
        g.fillStyle = '#fff'; g.font = 'bold 6px monospace'; g.fillText('ZIP', 33, 54);
        break;
      case 'B': // batterie d'onduleur
        g.fillStyle = '#1a1c20'; g.fillRect(14, 22, 36, 42);
        g.fillStyle = '#2c3038'; g.fillRect(14, 22, 36, 4);
        g.fillStyle = '#f2c230'; g.fillRect(14, 36, 36, 12);
        g.fillStyle = '#111'; g.font = 'bold 6px monospace'; g.fillText('UPS 48V', 17, 44);
        g.fillStyle = '#c21d1d'; g.fillRect(18, 18, 6, 4); g.fillStyle = '#222'; g.fillRect(40, 18, 6, 4);
        g.fillStyle = '#3dff6a'; g.fillRect(18, 54, 4, 2); g.fillRect(24, 54, 4, 2); g.fillRect(30, 54, 4, 2);
        break;
      case 'f': // fontaine à eau
        g.fillStyle = '#d8dde3'; g.fillRect(22, 36, 20, 28);
        g.fillStyle = '#aab'; g.fillRect(22, 36, 20, 2);
        g.fillStyle = 'rgba(80,160,255,0.95)'; g.beginPath(); g.ellipse(32, 24, 11, 13, 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#bfe0ff'; g.fillRect(26, 16, 3, 10);
        g.fillStyle = '#1f58d6'; g.fillRect(28, 34, 8, 3);
        g.fillStyle = '#c21d1d'; g.fillRect(26, 44, 3, 3); g.fillStyle = '#1f58d6'; g.fillRect(35, 44, 3, 3);
        break;
      case 'e': // extincteur
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

/* ------------------------------------------------------------ assemblage */

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
  // béton (et faux murs secrets) aux couleurs de chaque épisode
  Assets.concrete = [0, 1, 2, 3, 4].map((ep) => variants(concrete(ep), 2, 1));
  Assets.floor = [makeTexture(drawFloor(false), 5), makeTexture(drawFloor(true), 6)];
  Assets.ceil = [makeTexture(drawCeiling(false), 7), makeTexture(drawCeiling(true), 8)];

  Assets.enemies = {
    bug: buildEnemySprites(drawBug, ['#2c9a37', '#1b4d21', '#3fc24c', '#ff00ff'], 3),
    drone: buildEnemySprites(drawDrone, ['#8d2468', '#d93a8f', '#7a1f5c', '#f2f2f2'], 4),
    bot: buildEnemySprites(drawBot, ['#50565e', '#3c4148', '#1a5fd0', '#2b2f35'], 5),
    troll: buildEnemySprites(drawTroll, ['#5f8a3a', '#3d5a2a', '#2c3038', '#f2f2e0'], 7),
    spam: buildEnemySprites(drawSpammer, ['#f2efe0', '#b8b0a0', '#c21d1d', '#222'], 8),
  };
  let bs = 10;
  for (const [k, pal] of Object.entries(BOSS_PAL)) Assets.enemies[k] = buildEnemySprites(drawBoss(pal), [pal.body, pal.head, '#e8c21a', pal.dark], bs++);
  Assets.items = {};
  for (const k of '+HAascruFMLxejkgKGYBf') Assets.items[k] = makeSprite(drawItem(k));
  Assets.proj = {
    orb: orbSprite('#ff3bd0', '#7a1f5c', 7),
    bolt: orbSprite('#ffe14a', '#ff5a1a', 5),
    boss: orbSprite('#c04dff', '#4a0f7a', 10),
    plasma: orbSprite('#9ef', '#1a7de1', 7),
    zip: orbSprite('#d6c8ff', '#6a4ae0', 6),
    miner: orbSprite('#ffe14a', '#a86a00', 10),
    botnet: orbSprite('#b6ffbf', '#1f6a24', 10),
    zeroday: orbSprite('#e0ffff', '#008aa8', 10),
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
